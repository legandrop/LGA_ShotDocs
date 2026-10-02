import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { ORIGIN_REPLACE } from '../sync/docs';
import { updateDocState } from '../sync/localDb';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { saveCollapse } from '../ui/collapseStore';
import { KEEP_PER_PROJECT, metaOf, ProjectReplace, type ReplaceDeps, type ReplaceRequest } from './projectReplace';

// El motor de reemplazar en todo el proyecto (Docs/Doc_Buscar.md, "Reemplazar en el proyecto" y "Cómo quedó
// (entrega 3)") con la base local de verdad (fake-indexeddb), `PageDocs` y el servidor de prueba: qué páginas se
// tocan, el registro antes de escribir, la protección del editor abierto, el guardado comprobado, deshacer, y dos
// dispositivos al azar (`REPLACE_RANDOM`).

const devices: Device[] = [];
afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.docs.dispose();
    d.db.close();
  }
});

async function device(server = new FakeServer(), dbName?: string): Promise<Device> {
  const d = await makeDevice(server, dbName);
  devices.push(d);
  return d;
}

/** Escribe párrafos al final de la página (como el editor) y la cierra. */
async function write(d: Device, pageId: string, texts: string[], ids?: string[]): Promise<void> {
  const doc = await d.docs.open(pageId);
  const fragment = doc.getXmlFragment(CONTENT_FRAGMENT);
  const fills: (() => void)[] = [];
  doc.transact(() => {
    if (fragment.length === 0) fragment.insert(0, [new Y.XmlElement('blockGroup')]);
    const group = fragment.get(0) as Y.XmlElement;
    group.insert(
      group.length,
      texts.map((text, i) => {
        const c = new Y.XmlElement('blockContainer');
        c.setAttribute('id', ids?.[i] ?? `b${Math.random().toString(36).slice(2, 9)}`);
        const heading = text.startsWith('# ');
        const p = new Y.XmlElement(heading ? 'heading' : 'paragraph');
        if (heading) p.setAttribute('level', 1 as never);
        const t = new Y.XmlText();
        p.insert(0, [t]);
        c.insert(0, [p]);
        fills.push(() => t.insert(0, heading ? text.slice(2) : text));
        return c;
      }),
    );
    for (const f of fills) f();
  });
  d.docs.close(pageId);
  await d.docs.flush();
}

/** El texto de la página (de lo guardado). */
async function textOf(d: Device, pageId: string): Promise<string> {
  const { doc } = await d.docs.indexSnapshot(pageId);
  const out = doc.getXmlFragment(CONTENT_FRAGMENT).toString().replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');
  doc.destroy();
  return out;
}

type Perms = { known: boolean; canEditPage(pageId: string): boolean };

function engineOf(d: Device, over: Partial<ReplaceDeps> = {}, perms: Perms = { known: true, canEditPage: () => true }): ProjectReplace {
  return new ProjectReplace({
    tree: d.tree,
    docs: d.docs,
    meta: metaOf(d.db),
    perms: () => perms,
    online: () => true,
    sync: () => d.engine.syncNow(),
    ...over,
  });
}

function request(d: Device, pageIds: string[], query = 'camara', replacement = 'Camera', extra: Partial<ReplaceRequest> = {}): ReplaceRequest {
  return { projectId: d.tree.workspaceId, pageIds, query, replacement, options: {}, ...extra };
}

async function threePages(d: Device) {
  const a = await d.tree.create(null, 'A');
  await write(d, a, ['la cámara uno', 'otra cámara']);
  const b = await d.tree.create(null, 'B');
  await write(d, b, ['sin nada', 'una cámara en B']);
  const c = await d.tree.create(null, 'C');
  await write(d, c, ['la cámara de C']);
  return { a, b, c };
}

describe('reemplazar y deshacer', () => {
  it('reemplaza en todas, queda guardado y pendiente de subir, y deshacer deja todo igual', async () => {
    const d = await device();
    const { a, b, c } = await threePages(d);
    await d.engine.syncNow();
    const before = await Promise.all([a, b, c].map((p) => textOf(d, p)));
    const engine = engineOf(d);
    const summary = await engine.prepare(request(d, [a, b, c]));
    expect([summary.count, summary.pageCount]).toEqual([4, 3]);
    const result = await engine.run(request(d, [a, b, c]));
    expect([result.replaced, result.pages, result.unsaved, result.stopped]).toEqual([4, 3, false, false]);
    expect(await textOf(d, a)).toBe('|la Camera uno|otra Camera|');
    // Se guardó como una edición local: falta subirla.
    expect((await d.docs.unsyncedPages()).sort()).toEqual([a, b, c].sort());
    await d.engine.syncNow();
    expect(await d.docs.unsyncedPages()).toEqual([]);
    const [last] = await engine.list(d.tree.workspaceId);
    expect([last.status, last.replaced, last.pages.length]).toEqual(['done', 4, 3]);
    const undone = await engine.undo(last.id);
    expect([undone.undone, undone.changed, undone.notApplied, undone.remaining]).toEqual([4, 0, 0, 0]);
    expect(await Promise.all([a, b, c].map((p) => textOf(d, p)))).toEqual(before);
    // Deshecho del todo: el registro se borra.
    expect(await engine.list(d.tree.workspaceId)).toEqual([]);
  });

  it('el registro sobrevive a cerrar la app: otro arranque con la misma base lo deshace', async () => {
    const server = new FakeServer();
    const name = crypto.randomUUID();
    const d = await device(server, name);
    const { a } = await threePages(d);
    const before = await textOf(d, a);
    await engineOf(d).run(request(d, [a]));
    d.engine.stop();
    d.docs.dispose();
    d.db.close();
    devices.splice(devices.indexOf(d), 1);
    const again = await device(server, name);
    const engine = engineOf(again);
    const [op] = await engine.list(again.tree.workspaceId);
    expect((await engine.undo(op.id)).undone).toBe(2);
    expect(await textOf(again, a)).toBe(before);
  });

  it('uno que quedó "corriendo" (se cerró la app a la mitad) se lista como cortado', async () => {
    const d = await device();
    const meta = metaOf(d.db);
    await meta.put('replace:op1', { id: 'op1', projectId: d.tree.workspaceId, at: 1, query: 'x', replacement: 'y', options: {}, status: 'running', pages: [], replaced: 0, planned: 3 });
    expect((await engineOf(d).list(d.tree.workspaceId))[0].status).toBe('stopped');
  });

  it('se guardan los últimos 5 por proyecto', async () => {
    const d = await device();
    const { a } = await threePages(d);
    const engine = engineOf(d);
    for (let i = 0; i < KEEP_PER_PROJECT + 2; i++) {
      await engine.run(request(d, [a], i % 2 === 0 ? 'camara' : 'camera', i % 2 === 0 ? 'Camera' : 'cámara'));
    }
    const list = await engine.list(d.tree.workspaceId);
    expect(list).toHaveLength(KEEP_PER_PROJECT);
    // Sin páginas sueltas de los borrados.
    const keys = await metaOf(d.db).keys('replace:');
    expect(keys.filter((k) => !list.some((h) => k.startsWith(`replace:${h.id}`)))).toEqual([]);
  });

  it('otro dispositivo cambió una después: deshace las demás y lo del otro queda', async () => {
    const server = new FakeServer();
    const d = await device(server);
    const other = await device(server);
    const { a } = await threePages(d);
    await d.engine.syncNow();
    const engine = engineOf(d);
    await engine.run(request(d, [a]));
    await d.engine.syncNow();
    await other.engine.syncNow();
    // El otro escribe adentro del primer reemplazo.
    const doc = await other.docs.open(a);
    const t = (((doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlText;
    t.insert(t.toString().indexOf('Camera') + 3, 'XYZ');
    other.docs.close(a);
    await other.docs.flush();
    await other.engine.syncNow();
    await d.engine.syncNow();
    const [op] = await engine.list(d.tree.workspaceId);
    const result = await engine.undo(op.id);
    expect([result.undone, result.changed]).toEqual([1, 1]);
    expect(await textOf(d, a)).toBe('|la CamXYZera uno|otra cámara|');
  });
});

describe('qué páginas se tocan', () => {
  it('sin datos de permisos no se toca nada, y una página salteada no recibe ninguna escritura', async () => {
    const d = await device();
    const { a, b } = await threePages(d);
    await d.engine.syncNow();
    const rows = async () => (await d.db.getAllFromIndex('docUpdates', 'pageId', a)).length;
    const before = await rows();
    const state = JSON.stringify(await d.docs.stateOf(a));
    const engine = engineOf(d, {}, { known: false, canEditPage: () => true });
    const result = await engine.run(request(d, [a, b]));
    expect(result.replaced).toBe(0);
    expect(result.blocked).toEqual({ permsUnknown: 2 });
    expect(await rows()).toBe(before);
    // Ni la guardia de versión ni una reparación: la página ni se abrió.
    expect(JSON.stringify(await d.docs.stateOf(a))).toBe(state);
  });

  it('solo lectura, papelera, sin bajar, ilegible, rechazada y desconocida: cada una se saltea con su motivo', async () => {
    const d = await device();
    const { a, b, c } = await threePages(d);
    const e = await d.tree.create(null, 'E');
    await write(d, e, ['cámara en una que se va a la papelera']);
    const f = await d.tree.create(null, 'F');
    await write(d, f, ['cámara en una a medio bajar']);
    const g = await d.tree.create(null, 'G');
    await write(d, g, ['cámara con algo desconocido']);
    const h = await d.tree.create(null, 'H');
    await write(d, h, ['cámara rechazada']);
    await d.engine.syncNow();
    // Algo que esta versión no conoce.
    const doc = await d.docs.open(g);
    const group = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
    const odd = new Y.XmlElement('blockContainer');
    odd.setAttribute('id', 'odd');
    odd.insert(0, [new Y.XmlElement('futureBlock')]);
    group.insert(group.length, [odd]);
    d.docs.close(g);
    await d.docs.flush();
    await d.tree.trash(e);
    await d.docs.markUnreadable(c);
    await updateDocState(d.db, h, (s) => {
      s.rejected = 'no';
    });
    // F: el servidor tiene más de lo que bajó el dispositivo.
    const tree = {
      get: (id: string) => {
        const row = d.tree.get(id);
        return row && id === f ? { ...row, update_seq: row.update_seq + 5 } : row;
      },
      isTrashed: (id: string) => d.tree.isTrashed(id),
      hasUnsentCreate: (id: string) => d.tree.hasUnsentCreate(id),
    };
    const engine = engineOf(d, { tree }, { known: true, canEditPage: (id) => id !== b });
    const result = await engine.run(request(d, [a, b, c, e, f, g, h]));
    expect(result.blocked).toEqual({ viewOnly: 1, unreadable: 1, trash: 1, missing: 1, unsupported: 1, rejected: 1 });
    expect(result.replaced).toBe(2);
    for (const p of [b, c, f, g, h]) expect(await textOf(d, p)).toContain('cámara');
  });

  it('Stop termina la página en curso y para', async () => {
    const d = await device();
    const { a, b, c } = await threePages(d);
    const engine = engineOf(d);
    const unsub = engine.subscribe(() => {
      if (engine.getProgress()?.done === 1) engine.stop();
    });
    const result = await engine.run(request(d, [a, b, c]));
    unsub();
    expect([result.stopped, result.pages]).toEqual([true, 1]);
    expect(await textOf(d, b)).toContain('cámara');
    expect((await engine.list(d.tree.workspaceId))[0].status).toBe('stopped');
  });
});

describe('lo que pidió la auditoría de la implementación', () => {
  it('ilegible mientras espera el candado (una bajada que la marca): no se escribe', async () => {
    const d = await device();
    const a = await d.tree.create(null, 'A');
    await write(d, a, ['la cámara']);
    const docs = Object.create(d.docs) as typeof d.docs;
    let first = true;
    docs.stateOf = async (id: string) => {
      const s = await d.docs.stateOf(id);
      // Como una bajada que toma el candado justo después de que el reemplazo miró el estado (la primera vez).
      if (first) {
        first = false;
        void d.docs.markUnreadable(id);
      }
      return s;
    };
    const result = await engineOf(d, { docs }).run(request(d, [a]));
    expect([result.replaced, result.blocked]).toEqual([0, { unreadable: 1 }]);
    expect(await textOf(d, a)).toBe('|la cámara|');
  });

  it('rechazada mientras espera el candado (una subida rechazada): no se escribe', async () => {
    const d = await device();
    const a = await d.tree.create(null, 'A');
    await write(d, a, ['la cámara']);
    const docs = Object.create(d.docs) as typeof d.docs;
    docs.edit = async (pageId, fn) => {
      await updateDocState(d.db, pageId, (s) => {
        s.rejected = 'forbidden';
      });
      return d.docs.edit(pageId, fn);
    };
    const result = await engineOf(d, { docs }).run(request(d, [a]));
    expect([result.replaced, result.blocked]).toEqual([0, { rejected: 1 }]);
    expect(await textOf(d, a)).toBe('|la cámara|');
  });

  it('el permiso sacado mientras espera el candado: no se escribe, y deshacer tampoco', async () => {
    const d = await device();
    const a = await d.tree.create(null, 'A');
    await write(d, a, ['la cámara']);
    let canEdit = true;
    const docs = Object.create(d.docs) as typeof d.docs;
    docs.edit = async (pageId, fn) => {
      canEdit = false;
      return d.docs.edit(pageId, fn);
    };
    const perms = { known: true, canEditPage: () => canEdit };
    const result = await engineOf(d, { docs }, perms).run(request(d, [a]));
    expect([result.replaced, result.blocked]).toEqual([0, { viewOnly: 1 }]);
    expect(await textOf(d, a)).toBe('|la cámara|');
    // Deshacer: reemplazado con permiso, y el permiso se va mientras el deshacer espera el candado.
    canEdit = true;
    const engine = engineOf(d, {}, perms);
    await engine.run(request(d, [a]));
    const [op] = await engine.list(d.tree.workspaceId);
    const undo = await engineOf(d, { docs }, perms).undo(op.id);
    expect([undo.undone, undo.remaining]).toEqual([0, 1]);
    expect(await textOf(d, a)).toBe('|la Camera|');
  });

  it('la × (sacar una de la lista): Replace all no la toca', async () => {
    const d = await device();
    const a = await d.tree.create(null, 'A');
    await write(d, a, ['uno cámara dos cámara tres cámara']);
    const engine = engineOf(d);
    const matches = await engine.matchesOf(a, 'camara', {});
    const result = await engine.run(request(d, [a], 'camara', 'X', { exclude: new Set([matches[1].key]) }));
    expect(result.replaced).toBe(2);
    expect(await textOf(d, a)).toBe('|uno X dos cámara tres X|');
  });

  it('la página abierta con el documento viejo (llegó algo que esta versión no puede mostrar): no se escribe', async () => {
    const d = await device();
    const a = await d.tree.create(null, 'A');
    await write(d, a, ['la cámara']);
    const live = await d.docs.open(a);
    // Como `applyRemote` cuando lo bajado no se puede mostrar: lo guardado tiene más que el documento abierto.
    (d.docs as unknown as { live: Map<string, { stale?: boolean }> }).live.get(a)!.stale = true;
    const result = await engineOf(d).run(request(d, [a]));
    expect([result.replaced, result.blocked]).toEqual([0, { unsupported: 1 }]);
    expect(live.getXmlFragment(CONTENT_FRAGMENT).toString()).toContain('cámara');
    d.docs.close(a);
  });

  it('un reemplazo que no cambió nada no ocupa lugar, y los sueltos no sacan el Undo de un Replace all', async () => {
    const d = await device();
    const { a } = await threePages(d);
    const engine = engineOf(d);
    await engine.run(request(d, [a], 'camara', 'Camera'));
    const [big] = await engine.list(d.tree.workspaceId);
    for (let i = 0; i < KEEP_PER_PROJECT + 1; i++) {
      await engine.run(request(d, [a], i % 2 === 0 ? 'camera' : 'cámara', i % 2 === 0 ? 'cámara' : 'Camera', { scope: 'some' }));
    }
    // Uno que no coincide con nada: no se guarda.
    expect((await engine.run(request(d, [a], 'nada-que-coincida', 'X'))).opId).toBeNull();
    const list = await engine.list(d.tree.workspaceId);
    expect(list.filter((h) => h.scope === 'some')).toHaveLength(KEEP_PER_PROJECT);
    expect(list.some((h) => h.id === big.id)).toBe(true);
  });

  it('el que está corriendo no aparece entre los últimos (sus cuentas están a medias)', async () => {
    const d = await device();
    const { a, b } = await threePages(d);
    const engine = engineOf(d);
    const seen: number[] = [];
    const unsub = engine.subscribe(() => {
      if (engine.getProgress()?.done === 1) void engine.list(d.tree.workspaceId).then((l) => seen.push(l.length));
    });
    await engine.run(request(d, [a, b]));
    unsub();
    await new Promise((r) => setTimeout(r, 20));
    expect(seen[0]).toBe(0);
    expect(await engine.list(d.tree.workspaceId)).toHaveLength(1);
  });
});

describe('las protecciones', () => {
  it('si no quedó guardado en el dispositivo, se corta todo (no sigue con las demás)', async () => {
    const d = await device();
    const { a, b, c } = await threePages(d);
    let calls = 0;
    const docs = Object.create(d.docs) as typeof d.docs;
    docs.isSaved = () => ++calls < 2;
    const result = await engineOf(d, { docs }).run(request(d, [a, b, c]));
    expect(result.unsaved).toBe(true);
    expect(result.pages).toBe(2);
    expect(await textOf(d, c)).toContain('cámara');
  });

  it('el registro va antes: si no se puede guardar, la página no se escribe', async () => {
    const d = await device();
    const { a } = await threePages(d);
    const real = metaOf(d.db);
    const meta = { ...real, put: async (key: string, value: unknown) => (key.split(':').length > 2 ? Promise.reject(new Error('disk')) : real.put(key, value)) };
    const result = await engineOf(d, { meta }).run(request(d, [a]));
    expect(result.blocked).toEqual({ error: 1 });
    expect(await textOf(d, a)).toBe('|la cámara uno|otra cámara|');
  });

  it('lo que cambia mientras se guarda el registro (el editor abierto escribe) se vuelve a planear: no se escribe en el lugar viejo', async () => {
    const d = await device();
    const a = await d.tree.create(null, 'A');
    await write(d, a, ['abcdef cámara fin']);
    const real = metaOf(d.db);
    let typed = false;
    const meta = {
      ...real,
      put: async (key: string, value: unknown) => {
        await real.put(key, value);
        if (!typed && key.split(':').length > 2) {
          typed = true;
          // Como el editor de la página abierta: escribe sin el candado, justo mientras se guarda el registro.
          const live = d.docs.peek(a)!;
          const t = (((live.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlText;
          t.delete(0, 4);
        }
      },
    };
    const engine = engineOf(d, { meta });
    const result = await engine.run(request(d, [a]));
    expect(result.replaced).toBe(1);
    expect(await textOf(d, a)).toBe('|ef Camera fin|');
    const [op] = await engine.list(d.tree.workspaceId);
    expect((await engine.undo(op.id)).undone).toBe(1);
    expect(await textOf(d, a)).toBe('|ef cámara fin|');
  });

  it('con la página abierta, si el editor falla al dibujar: cuenta como escrito, no se reintenta y se avisa para volver a dibujarlo', async () => {
    const d = await device();
    const a = await d.tree.create(null, 'A');
    await write(d, a, ['la cámara roja']);
    // La página abierta, con un "editor" que tira un error al dibujar el primer cambio (como y-prosemirror).
    const live = await d.docs.open(a);
    let broken = true;
    live.getXmlFragment(CONTENT_FRAGMENT).observeDeep(() => {
      if (broken) {
        broken = false;
        throw new Error('render failed');
      }
    });
    const redraws: string[] = [];
    const unsub = d.docs.subscribeRenderFailed((id) => redraws.push(id));
    // El reemplazo contiene lo buscado: reintentarlo lo pondría dos veces.
    const result = await engineOf(d).run(request(d, [a], 'cámara', 'cámara roja'));
    unsub();
    expect([result.replaced, result.blocked]).toEqual([1, {}]);
    expect(redraws).toEqual([a]);
    d.docs.close(a);
    await d.docs.flush();
    expect(await textOf(d, a)).toBe('|la cámara roja roja|');
  });

  it('el reemplazo no entra en la pila de deshacer de la página abierta', async () => {
    const d = await device();
    const a = await d.tree.create(null, 'A');
    await write(d, a, ['la cámara']);
    const live = await d.docs.open(a);
    const um = new Y.UndoManager(live.getXmlFragment(CONTENT_FRAGMENT));
    await engineOf(d).run(request(d, [a]));
    expect(um.undoStack.length).toBe(0);
    expect(ORIGIN_REPLACE.toString()).toBe('Symbol(replace)');
    d.docs.close(a);
  });
});

describe('lo escondido', () => {
  it('la confirmación cuenta las escondidas; borrar las deja afuera salvo con la casilla', async () => {
    const d = await device();
    const a = await d.tree.create(null, 'A');
    await write(d, a, ['# Título', 'cámara escondida', 'otra cámara escondida', '# Otro', 'cámara a la vista'], ['h1', 'p1', 'p2', 'h2', 'p3']);
    await saveCollapse(d.db, a, new Map([['h1', { c: true, g: null }]]));
    const engine = engineOf(d);
    const swap = await engine.prepare(request(d, [a]), { sync: false });
    expect([swap.count, swap.hidden]).toEqual([3, 2]);
    const del = await engine.prepare(request(d, [a], 'camara', ''), { sync: false });
    expect([del.count, del.hidden, del.skipped.hidden]).toEqual([1, 2, 2]);
    await engine.run(request(d, [a], 'camara', ''));
    expect(await textOf(d, a)).toBe('|Título|cámara escondida|otra cámara escondida|Otro| a la vista|');
    await engine.run(request(d, [a], 'camara', '', { deleteHidden: true }));
    expect(await textOf(d, a)).toBe('|Título| escondida|otra  escondida|Otro| a la vista|');
  });
});

describe('sin red', () => {
  it('se reemplaza igual en las páginas completas, queda pendiente y sube al volver', async () => {
    const server = new FakeServer();
    const d = await device(server);
    const { a } = await threePages(d);
    await d.engine.syncNow();
    let synced = 0;
    const engine = engineOf(d, { online: () => false, sync: async () => void synced++ });
    const summary = await engine.prepare(request(d, [a]));
    expect([summary.offline, summary.count, synced]).toEqual([true, 2, 0]);
    await engine.run(request(d, [a]));
    expect(await d.docs.unsyncedPages()).toEqual([a]);
    await d.engine.syncNow();
    const other = await device(server);
    await other.engine.syncNow();
    expect(await textOf(other, a)).toBe('|la Camera uno|otra Camera|');
  });
});

describe('rendimiento', () => {
  it('300 páginas de 50 párrafos: reemplazar y deshacer, con tope de tiempo', async () => {
    const d = await device();
    const PAGES = Number(process.env.REPLACE_PAGES ?? 300);
    const filler = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore ';
    const ids: string[] = [];
    for (let i = 0; i < PAGES; i++) {
      const id = await d.tree.create(null, `P${i}`);
      await write(d, id, Array.from({ length: 50 }, (_, j) => (j % 17 === 0 ? `${filler}la cámara ${j}` : filler + filler)));
      ids.push(id);
    }
    const engine = engineOf(d);
    const t0 = performance.now();
    const result = await engine.run(request(d, ids));
    const replaceMs = performance.now() - t0;
    expect(result.replaced).toBe(PAGES * 3);
    const [op] = await engine.list(d.tree.workspaceId);
    const t1 = performance.now();
    expect((await engine.undo(op.id)).undone).toBe(PAGES * 3);
    const undoMs = performance.now() - t1;
    console.log(`reemplazar ${PAGES} páginas: ${replaceMs.toFixed(0)} ms; deshacer: ${undoMs.toFixed(0)} ms`);
    // Con la máquina cargada (varias pruebas a la vez) tarda más: el tope estricto solo con SHOTDOCS_STRICT_PERF.
    const cap = process.env.SHOTDOCS_STRICT_PERF ? 5000 : 25000;
    expect(replaceMs).toBeLessThan(cap);
    expect(undoMs).toBeLessThan(cap);
  }, 120_000);
});

describe('al azar con dos dispositivos', () => {
  it('lo que escribe el otro nunca se pierde, todos terminan iguales, y sin cambios del otro deshacer deja todo igual', async () => {
    const RUNS = Number(process.env.REPLACE_RANDOM ?? 8);
    for (let seed = 1; seed <= RUNS; seed++) {
      let x = seed * 7919 + 13;
      const rnd = (m: number) => {
        x = (x * 9301 + 49297) % 233280;
        return Math.floor((x / 233280) * m);
      };
      const server = new FakeServer();
      const a = await device(server);
      const b = await device(server);
      const pages: string[] = [];
      for (let i = 0; i < 3; i++) {
        const id = await a.tree.create(null, `P${i}`);
        await write(a, id, ['uno cámara dos', 'cámaracámara y luz', 'fin cámara']);
        pages.push(id);
      }
      await a.engine.syncNow();
      await b.engine.syncNow();
      const quiet = rnd(4) === 0;
      const marks: string[] = [];
      const typeB = async () => {
        if (quiet) return;
        const id = pages[rnd(pages.length)];
        const doc = await b.docs.open(id);
        const g = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
        const t = ((g.get(rnd(g.length)) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlText;
        const m = `{${seed}.${marks.length}}`;
        marks.push(m);
        // Nunca adentro de una marca suya (eso la rompería él mismo).
        let at = rnd(t.length + 1);
        const text = t.toString();
        for (const found of text.matchAll(/{[^{}]*}/g)) if (at > found.index && at < found.index + found[0].length) at = found.index;
        t.insert(at, m);
        b.docs.close(id);
      };
      const original = await Promise.all(pages.map((p) => textOf(a, p)));
      for (let i = rnd(3); i > 0; i--) await typeB();
      if (rnd(2)) await b.engine.syncNow();
      const engine = engineOf(a);
      const replacement = rnd(3) === 0 ? '' : 'Camera';
      const running = engine.run(request(a, pages, 'camara', replacement));
      for (let i = rnd(3); i > 0; i--) await typeB();
      await running;
      for (let i = rnd(3); i > 0; i--) {
        await (rnd(2) ? a : b).engine.syncNow();
        await typeB();
      }
      await a.engine.syncNow();
      const [op] = await engine.list(a.tree.workspaceId);
      if (op) await engine.undo(op.id);
      for (let i = 0; i < 2; i++) {
        await b.docs.flush();
        await b.engine.syncNow();
        await a.engine.syncNow();
      }
      const fresh = await device(server);
      await fresh.engine.syncNow();
      for (const p of pages) {
        const [ta, tb, tf] = await Promise.all([textOf(a, p), textOf(b, p), textOf(fresh, p)]);
        expect(tb).toBe(ta);
        expect(tf).toBe(ta);
      }
      const all = (await Promise.all(pages.map((p) => textOf(a, p)))).join('');
      for (const m of marks) expect(all).toContain(m);
      if (quiet) expect(await Promise.all(pages.map((p) => textOf(a, p)))).toEqual(original);
      for (const dev of devices.splice(0)) {
        dev.engine.stop();
        dev.docs.dispose();
        dev.db.close();
      }
    }
  }, 120_000);
});
