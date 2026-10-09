import { describe, expect, it } from 'vitest';
import type { PageRow } from '../sync/types';
import { cededMark } from './cededCopy';
import { audienceOk, canOffer, defaultKeep, dialogHint, mergeGuard, mergeRows, mergedTarget, MAX_CHAIN, readPointer, restorePage } from './merge';

// Lo puro de *Merge* (E16): el puntero se valida siempre (C2), la cadena tiene tope, las guardas sin red, la audiencia
// local (C6), cuál queda (D644 con M9) y las filas de *Pending* (C3 punto 3, C9 b).

const P = 'proj';
function row(id: string, o: Partial<PageRow> = {}): PageRow {
  return { id, workspace_id: P, parent_id: 'folder', title: id, icon: null, sort_key: 'a', update_seq: 1, created_at: '', updated_at: '', deleted_at: null, ...o } as PageRow;
}
function treeOf(rows: PageRow[]) {
  const by = new Map(rows.map((r) => [r.id, r]));
  const isTrashed = (id: string): boolean => {
    for (let p = by.get(id); p; p = p.parent_id ? by.get(p.parent_id) : undefined) if (p.deleted_at) return true;
    return false;
  };
  return {
    get: (id: string) => by.get(id),
    isTrashed,
    trashed: (projectId?: string) => rows.filter((r) => r.deleted_at && (!projectId || r.workspace_id === projectId)),
    children: (id: string | null) => rows.filter((r) => r.parent_id === id && !r.deleted_at),
    isDescendant: (id: string, of: string) => {
      for (let p = by.get(id)?.parent_id; p; p = by.get(p)?.parent_id ?? null) if (p === of) return true;
      return false;
    },
  };
}
const merged = (into: string, seq = 1) => ({ settings: { merged: { into, seq, at: '2026-10-09T00:00:00Z' } }, deleted_at: '2026-10-09T00:00:00Z' });

describe('el puntero (C2)', () => {
  it('vale con B en la papelera y A viva, del mismo proyecto y que se ve; si no, no', () => {
    expect(mergedTarget(treeOf([row('a'), row('b', merged('a'))]), 'b')).toBe('a');
    // B viva (una versión vieja hizo Restore): sin efecto.
    expect(mergedTarget(treeOf([row('a'), row('b', { settings: merged('a').settings })]), 'b')).toBeNull();
    // A en la papelera, de otro proyecto, que no se ve o B misma.
    expect(mergedTarget(treeOf([row('a', { deleted_at: 'x' }), row('b', merged('a'))]), 'b')).toBeNull();
    expect(mergedTarget(treeOf([row('a', { workspace_id: 'otro' }), row('b', merged('a'))]), 'b')).toBeNull();
    expect(mergedTarget(treeOf([row('b', merged('a'))]), 'b')).toBeNull();
    expect(mergedTarget(treeOf([row('b', merged('b'))]), 'b')).toBeNull();
    // Una forma rara (lo escribe cualquier editor): no vale.
    expect(readPointer(row('b', { settings: { merged: { into: 3, seq: 'x' } } as never }))).toBeNull();
  });

  it('sigue una cadena (B → A → C) hasta el tope, y corta un ciclo', () => {
    expect(mergedTarget(treeOf([row('c'), row('a', merged('c')), row('b', merged('a'))]), 'b')).toBe('c');
    const chain = Array.from({ length: MAX_CHAIN + 1 }, (_, i) => row(`p${i}`, merged(`p${i + 1}`)));
    expect(mergedTarget(treeOf([...chain, row(`p${MAX_CHAIN + 1}`)]), 'p0')).toBeNull();
    expect(mergedTarget(treeOf([...chain.slice(1), row(`p${MAX_CHAIN + 1}`)]), 'p1')).toBe(`p${MAX_CHAIN + 1}`);
    expect(mergedTarget(treeOf([row('a', merged('b')), row('b', merged('a'))]), 'a')).toBeNull();
  });
});

describe('las guardas sin red y la audiencia (M1, M2, M4, C6)', () => {
  const ctx = (rows: PageRow[], online = true) => ({ tree: treeOf(rows), canMerge: (id: string) => id !== 'locked', sync: { online, lastSyncAt: online ? 1 : null } });
  it('las dos vivas, distintas, ninguna adentro de la otra, con red; quien no puede en una no ve el botón', () => {
    expect(mergeGuard(ctx([row('a'), row('b')]), 'a', 'b')).toBeNull();
    expect(mergeGuard(ctx([row('a'), row('b')]), 'a', 'a')).toBe('gone');
    expect(mergeGuard(ctx([row('a'), row('b', { deleted_at: 'x' })]), 'a', 'b')).toBe('gone');
    expect(mergeGuard(ctx([row('a'), row('b', { parent_id: 'a' })]), 'a', 'b')).toBe('inside');
    expect(mergeGuard(ctx([row('a'), row('b')], false), 'a', 'b')).toBe('offline');
    expect(canOffer(ctx([]), ['a', 'b'])).toBe(true);
    expect(canOffer(ctx([]), ['a', 'locked'])).toBe(false);
  });

  it('C6: mismo padre pasa; si no, solo dueño o admin y sin permisos de página ni link público en ninguna', () => {
    const t = treeOf([row('a', { parent_id: 'x' }), row('b', { parent_id: 'y' })]);
    const none = { ownGrants: false, publicLink: false };
    expect(audienceOk(treeOf([row('a'), row('b')]), 'member', 'a', 'b', null)).toBe(true);
    expect(audienceOk(t, 'owner', 'a', 'b', { a: none, b: none })).toBe(true);
    expect(audienceOk(t, 'member', 'a', 'b', { a: none, b: none })).toBe(false);
    expect(audienceOk(t, 'owner', 'a', 'b', { a: none, b: { ownGrants: true, publicLink: false } })).toBe(false);
    expect(audienceOk(t, 'admin', 'a', 'b', { a: { ownGrants: false, publicLink: true }, b: none })).toBe(false);
    expect(audienceOk(t, 'owner', 'a', 'b', { a: none, b: null })).toBe(false);
  });
});

describe('cuál queda (D644 con M9) y lo que dice el adelanto (D646, D708)', () => {
  it('la que tiene comentarios queda; con las dos, ninguna; si una no agrega nada, queda la otra; si no, la primera', () => {
    const o = (comments: Record<string, number>, nothing: [string, string] | null = null) => ({ comments: (id: string) => comments[id] ?? 0, nothing: (f: string, i: string) => !!nothing && nothing[0] === f && nothing[1] === i });
    expect(defaultKeep(['a', 'b'], o({ b: 1 }))).toBe('b');
    expect(defaultKeep(['a', 'b'], o({ a: 1, b: 2 }))).toBeNull();
    expect(defaultKeep(['a', 'b'], o({}, ['a', 'b']))).toBe('b');
    expect(defaultKeep(['a', 'b'], o({}))).toBe('a');
  });
  it('O10: mientras une, solo se dice si la red se cortó; antes de unir, el motivo que impide hacerlo', () => {
    expect(dialogHint(true, 'offline')).toBe('wait');
    expect(dialogHint(true, null)).toBeNull();
    // Lo demás cambia a medida que avanza la unión (la que se va entra a la papelera): no se muestra.
    expect(dialogHint(true, 'gone')).toBeNull();
    expect(dialogHint(true, 'checking')).toBeNull();
    expect(dialogHint(false, 'offline')).toBe('offline');
    expect(dialogHint(false, 'comments')).toBe('comments');
    expect(dialogHint(false, null)).toBeNull();
  });
});

describe('las filas de Pending de las uniones', () => {
  it('cambió después (seq o una subpágina nueva), y unida a una que está en la papelera (C9 b)', () => {
    const late = treeOf([row('a'), row('b', { ...merged('a', 2), update_seq: 3 })]);
    expect(mergeRows(late, P)).toEqual([{ kind: 'changed', from: 'b', into: 'a', kids: [] }]);
    const kid = treeOf([row('a'), row('b', { ...merged('a', 3), update_seq: 3 }), row('k', { parent_id: 'b' })]);
    expect(mergeRows(kid, P)).toEqual([{ kind: 'changed', from: 'b', into: 'a', kids: ['k'] }]);
    const seen = treeOf([row('a'), row('b', { settings: { merged: { into: 'a', seq: 3, at: '', kids: ['k'] } }, deleted_at: 'x', update_seq: 3 }), row('k', { parent_id: 'b' })]);
    expect(mergeRows(seen, P)).toEqual([]);
    const crossed = treeOf([row('a', merged('b')), row('b', merged('a'))]);
    expect(mergeRows(crossed, P).map((r) => [r.kind, r.from])).toEqual([
      ['intoTrashed', 'a'],
      ['intoTrashed', 'b'],
    ]);
  });
});

describe('Restore desde la app', () => {
  it('saca el puntero: mandarla después a la papelera a mano no la lee como unida', async () => {
    const rows = [row('a'), row('b', merged('a'))];
    const t = treeOf(rows);
    const tree = {
      get: t.get,
      restore: async (id: string) => void (rows.find((r) => r.id === id)!.deleted_at = null),
      setSetting: async (id: string, key: 'merged', value: undefined) => {
        const r = rows.find((x) => x.id === id)!;
        const settings = { ...r.settings } as Record<string, unknown>;
        if (value === undefined) delete settings[key];
        r.settings = settings;
      },
    };
    await restorePage(tree, 'b');
    rows[1].deleted_at = 'x';
    expect(mergedTarget(t, 'b')).toBeNull();
  });
});

describe('con la copia que cede (E15, D686)', () => {
  it('una copia cedida en la papelera no es una unida ni se lista; una unida que antes fue cedida no se lee como cedida', () => {
    const ceded = row('c', { deleted_at: '2026-10-09T10:00:00.000Z', settings: { ceded: { to: 'a', at: '2026-10-09T10:00:00.000Z' } } });
    const t = treeOf([row('a'), ceded]);
    expect(cededMark(ceded)).not.toBeNull();
    expect(mergedTarget(t, 'c')).toBeNull();
    expect(mergeRows(t, P)).toEqual([]);
    // El vigía la devolvió (quedó viva, repetida) y después se unió: otra hora de papelera, las dos claves.
    const both = row('c', { deleted_at: '2026-10-09T11:00:00.000Z', settings: { ceded: { to: 'a', at: '2026-10-09T10:00:00.000Z' }, merged: { into: 'a', seq: 1, at: '' } } });
    expect(cededMark(both)).toBeNull();
    expect(mergedTarget(treeOf([row('a'), both]), 'c')).toBe('a');
  });
});
