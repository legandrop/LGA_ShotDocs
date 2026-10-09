// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { ProjectIndex } from '../search/projectIndex';
import { unitsFromYDoc } from '../search/extract';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { RemoteError, REQUEST_TIMEOUT } from '../sync/types';
import { writeBlocks } from './fixtures/proyectoSintetico';
import { mergeRows, mergedTarget, readPointer } from './merge';
import { copyKey, mergeDepsFrom, pendingMerges, resumeMerges, runMerge, undoMerge, type MergeDeps, type MergeStep } from './mergeJob';
import { blockIds, separatorId } from './mergeWrite';
import { entityRelations, RelationIndex } from './relationIndex';

// *Merge* con dos dispositivos sobre el servidor en memoria (E16, C3, C7, C9; P1–P14 del plan que aplican al alcance
// reducido): el orden fijo (B a la papelera recién con A entera en el servidor y los usos de las fotos confirmados), cortes
// en cada paso y sin red a mitad (sigue al volver, sin duplicar), otro escribiendo en B durante y después (queda en B y
// *Pending* lo lista), otro escribiendo en A, un comentario que aparece en el medio, dos uniones a la vez (en el mismo
// sentido y cruzadas), *Undo*, una versión vieja que restaura B y los links a B que siguen contando.

const devices: Device[] = [];
afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.docs.dispose();
    d.db.close();
  }
});

const PHOTO = '0000e16a-aaaa-4bbb-8ccc-dddddddddddd';

async function device(server: FakeServer, dbName?: string): Promise<Device> {
  const d = await makeDevice(server, dbName);
  devices.push(d);
  return d;
}

interface World {
  server: FakeServer;
  a: Device;
  b: Device;
  /** La escena (la primera, la que queda), la repetida (la que se va), su ficha y un día que linkea a la repetida. */
  keep: string;
  gone: string;
  card: string;
  day: string;
}

async function world(): Promise<World> {
  const server = new FakeServer();
  server.enableTrash();
  server.mediaFiles.set(PHOTO, {
    id: PHOTO, name: 'curva.jpg', mime: 'image/jpeg', width: 1920, height: 1080, duration: null, thumb_at: null,
    drive_id: 'd-curva', size: 2048, trashed_at: null, purged_at: null, drive_trashed_at: null, project_id: server.workspaceId,
  });
  const a = await device(server);
  await a.engine.syncNow();
  const bd = await a.tree.create(null, 'Breakdown');
  await a.tree.setSetting(bd, 'holds', 'scene');
  const ep = await a.tree.create(bd, '105');
  const keep = await a.tree.create(ep, '123 | La camioneta');
  await writeBlocks(a, keep, [{ h: 1, text: 'Notas' }, { p: 'Lo de la primera página.' }]);
  const gone = await a.tree.create(ep, '123 | La camioneta (otra)');
  await writeBlocks(a, gone, [{ h: 2, text: 'Plano general' }, { p: 'Texto de la segunda.' }, { photo: PHOTO, caption: 'La curva' }]);
  const card = await a.tree.create(gone, 'PRUEBA_105_123_010');
  await writeBlocks(a, card, [{ p: 'La ficha de la segunda.' }]);
  const days = await a.tree.create(null, 'Shoot days');
  await a.tree.setSetting(days, 'holds', 'day');
  const day = await a.tree.create(days, '2026-03-16 | Día 77');
  await writeBlocks(a, day, [{ hl: 1, runs: ['Escena ', { link: gone, text: '105_123' }] }, { p: 'Se filmó.' }]);
  await a.engine.syncNow();
  server.pageFiles.add(`${gone}:${PHOTO}`);
  const b = await device(server);
  await b.engine.syncNow();
  return { server, a, b, keep, gone, card, day };
}

function deps(d: Device, extra: Partial<MergeDeps> = {}): MergeDeps {
  return { ...mergeDepsFrom(d, { comments: d.remote, check: () => null }), waitMs: 1500, ...extra };
}

/** Escribe `words` al final del texto de un bloque (por id, por su lugar en el primer nivel o el último), como quien tipea ahí. */
async function typeIn(d: Device, pageId: string, words: string, blockId?: string | number): Promise<void> {
  const doc = await d.docs.open(pageId);
  const group = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
  const find = (n: Y.XmlElement): Y.XmlElement | null => {
    for (const c of n.toArray()) {
      if (!(c instanceof Y.XmlElement)) continue;
      if (c.nodeName === 'blockContainer' && c.getAttribute('id') === blockId) return c;
      const f = find(c);
      if (f) return f;
    }
    return null;
  };
  const block = typeof blockId === 'string' ? find(group)! : (group.get(blockId ?? group.length - 1) as Y.XmlElement);
  const t = (block.toArray()[0] as Y.XmlElement).toArray()[0] as Y.XmlText;
  t.insert(t.length, words);
  d.docs.close(pageId);
  await d.docs.flush();
}

const text = async (d: Device, pageId: string) => {
  const doc = await d.docs.open(pageId);
  const out = unitsFromYDoc(doc).map((u) => u.text);
  d.docs.close(pageId);
  return out;
};

const merge = (d: Device, w: World, extra: Partial<MergeDeps> = {}) =>
  runMerge(deps(d, extra), { keep: w.keep, gone: w.gone, projectId: d.tree.workspaceId, text: 'Merged from the other page' });

/** Lo que tiene que quedar después de unir, visto desde `d` recién sincronizado. */
async function merged(d: Device, w: World): Promise<void> {
  await d.engine.syncNow();
  expect(d.tree.isTrashed(w.gone)).toBe(true);
  expect(readPointer(d.tree.get(w.gone))?.into).toBe(w.keep);
  expect(mergedTarget(d.tree, w.gone)).toBe(w.keep);
  expect(d.tree.get(w.card)?.parent_id).toBe(w.keep);
  const t = await text(d, w.keep);
  expect(t.slice(0, 2)).toEqual(['Notas', 'Lo de la primera página.']);
  expect(t.filter((x) => x === 'Texto de la segunda.')).toHaveLength(1);
  expect(t).toContain('Merged from the other page');
}

describe('Merge en un dispositivo, con el servidor', () => {
  it('copia, mueve la ficha, sube A y los usos de la foto, y recién ahí manda B a la papelera con el puntero', async () => {
    const w = await world();
    const calls: string[] = [];
    const order = w.server.mediaCalls;
    const out = await merge(w.a, w, {
      afterStep: async (step) => {
        // Hasta el puntero, B está viva en el servidor.
        calls.push(`${step}:${w.server.pages.get(w.gone)?.deleted_at ? 'trashed' : 'alive'}`);
        // Antes del puntero (y de la papelera), A subida entera (otro dispositivo ya la baja con la copia) y el uso de
        // la foto en A confirmado en la base.
        if (step === 'uploaded') {
          expect(w.server.pageFiles.has(`${w.keep}:${PHOTO}`)).toBe(true);
          await w.b.engine.syncNow();
          expect(await text(w.b, w.keep)).toContain('Texto de la segunda.');
        }
      },
    });
    expect(out.status).toBe('done');
    expect(calls).toEqual(['started:alive', 'moved:alive', 'copied:alive', 'uploaded:alive', 'pointer:alive']);
    // La foto: el uso en A confirmado en la base antes del puntero.
    expect(w.server.pageFiles.has(`${w.keep}:${PHOTO}`)).toBe(true);
    expect(order.some((c) => c === `link_page_file ${w.keep} ${PHOTO}`)).toBe(true);
    await merged(w.a, w);
    // El otro dispositivo ve lo mismo.
    await merged(w.b, w);
    expect(await pendingMerges(deps(w.a).store)).toEqual([]);
  });

  it('un link a la página unida sigue contando para la escena (D651, C2); restaurarla deja el puntero sin efecto', async () => {
    const w = await world();
    await merge(w.a, w);
    await w.a.engine.syncNow();
    const index = new ProjectIndex(w.a.tree, w.a.docs);
    const rel = new RelationIndex(w.a.tree, index);
    await index.refresh(w.a.tree.workspaceId);
    await rel.update(w.a.tree.workspaceId);
    const scene = entityRelations(rel.snapshot(w.a.tree.workspaceId)!, 'scene', '105_123');
    expect(scene.pageId).toBe(w.keep);
    expect(scene.pages.find((p) => p.pageId === w.day)?.mentions.map((m) => m.via)).toEqual(['link']);
    // Una versión vieja (no conoce el puntero) restaura B: vuelve a ser una página viva, repetida otra vez.
    await w.b.engine.syncNow();
    await w.b.tree.restore(w.gone);
    await w.b.engine.syncNow();
    await w.a.engine.syncNow();
    expect(mergedTarget(w.a.tree, w.gone)).toBeNull();
    await index.refresh(w.a.tree.workspaceId);
    await rel.update(w.a.tree.workspaceId);
    expect(rel.snapshot(w.a.tree.workspaceId)!.registration.duplicates.map((x) => x.pageIds.length)).toEqual([2]);
    expect(mergeRows(w.a.tree, w.a.tree.workspaceId)).toEqual([]);
    rel.dispose();
    index.dispose();
  });

  it('D684: restaurada y con algo nuevo, unirla otra vez copia lo nuevo (con otros ids); su Undo saca solo esa copia', async () => {
    const w = await world();
    const first = await merge(w.a, w);
    expect(first.status).toBe('done');
    await w.a.engine.syncNow();
    // Una versión vieja (o alguien) la restaura y le escribe; vuelve a estar repetida.
    await w.b.engine.syncNow();
    await w.b.tree.restore(w.gone);
    await typeIn(w.b, w.gone, ' Lo nuevo después de restaurar.', 1);
    await w.b.engine.syncNow();
    await w.a.engine.syncNow();
    const second = await merge(w.a, w);
    if (second.status !== 'done') throw new Error(second.status);
    const t = await text(w.a, w.keep);
    expect(t).toContain('Texto de la segunda.');
    expect(t).toContain('Texto de la segunda. Lo nuevo después de restaurar.');
    // Dentro de A, ningún id repetido.
    const doc = await w.a.docs.open(w.keep);
    const all: string[] = [];
    const walk = (n: Y.XmlElement) => n.toArray().forEach((c) => c instanceof Y.XmlElement && (c.nodeName === 'blockContainer' && all.push(String(c.getAttribute('id'))), walk(c)));
    walk(doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement);
    w.a.docs.close(w.keep);
    expect(new Set(all).size).toBe(all.length);
    expect(await undoMerge(deps(w.a), second.job)).toEqual({ status: 'undone', kept: 0 });
    const after = await text(w.a, w.keep);
    expect(after).toContain('Texto de la segunda.');
    expect(after).not.toContain('Texto de la segunda. Lo nuevo después de restaurar.');
  });

  it('M9: con un comentario en la que se va, no se une ni se toca nada', async () => {
    const w = await world();
    await w.a.remote.addComment({ id: crypto.randomUUID(), pageId: w.gone, blockId: null, threadId: null, body: 'ojo' });
    const before = await text(w.a, w.keep);
    expect(await merge(w.a, w)).toEqual({ status: 'blocked', reason: 'comments' });
    expect(await text(w.a, w.keep)).toEqual(before);
    expect(w.a.tree.get(w.card)?.parent_id).toBe(w.gone);
  });

  it('C7: un comentario que aparece en el medio frena antes de la papelera; A queda con la copia y B viva', async () => {
    const w = await world();
    const out = await merge(w.a, w, {
      afterStep: async (step) => {
        if (step === 'uploaded') await w.b.remote.addComment({ id: crypto.randomUUID(), pageId: w.gone, blockId: null, threadId: null, body: 'tarde' });
      },
    });
    expect(out.status).toBe('stopped');
    await w.a.engine.syncNow();
    expect(w.a.tree.isTrashed(w.gone)).toBe(false);
    expect(readPointer(w.a.tree.get(w.gone))).toBeNull();
    expect(await text(w.a, w.keep)).toContain('Texto de la segunda.');
    expect(await text(w.a, w.gone)).toContain('Texto de la segunda.');
  });
});

describe('las guardas del trabajo, cada una con su caso (O5 de la auditoría del resultado, D688)', () => {
  /** Lo de los dos documentos como estaba, para afirmar que nada cambió. */
  const snapshot = async (w: World) => [await text(w.a, w.keep), await text(w.a, w.gone), w.a.tree.get(w.card)?.parent_id, w.a.tree.isTrashed(w.gone)];

  it('M3: algo que esta versión no conoce en la que se va (o en la que queda): no se une ni se toca nada', async () => {
    for (const where of ['gone', 'keep'] as const) {
      const w = await world();
      const doc = await w.a.docs.open(w[where]);
      const group = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
      doc.transact(() => {
        const c = new Y.XmlElement('blockContainer');
        c.setAttribute('id', 'futuro');
        c.insert(0, [new Y.XmlElement('futureBlock')]);
        group.insert(group.length, [c]);
      });
      w.a.docs.close(w[where]);
      await w.a.docs.flush();
      await w.a.engine.syncNow();
      const before = await snapshot(w);
      expect(await merge(w.a, w), where).toEqual({ status: 'blocked', reason: 'unknown' });
      expect(await snapshot(w), where).toEqual(before);
    }
  });

  it('M6: la que se va recién creada en otro dispositivo y todavía sin su contenido: no se une', async () => {
    const w = await world();
    // El otro dispositivo crea la página (la fila sube, el contenido todavía no).
    const arriving = await w.b.tree.create(w.a.tree.get(w.gone)!.parent_id, '123 | La camioneta (tercera)');
    await w.b.engine.syncNow();
    await w.a.engine.syncNow();
    const out = await runMerge(deps(w.a), { keep: w.keep, gone: arriving, projectId: w.a.tree.workspaceId, text: 'x' });
    expect(out).toEqual({ status: 'blocked', reason: 'arriving' });
    expect(w.a.tree.isTrashed(arriving)).toBe(false);
  });

  it('M3: la que se va está atrás del servidor en este dispositivo (no bajó lo último): no se une', async () => {
    const w = await world();
    const d = deps(w.a);
    const behind: MergeDeps = {
      ...d,
      // El documento guardado de la que se va dice que llegó hasta antes de lo que la fila dice que tiene el servidor.
      docs: new Proxy(w.a.docs, {
        get: (target, key) => {
          if (key === 'indexSnapshot') {
            return async (id: string) => {
              const r = await target.indexSnapshot(id);
              return id === w.gone ? { ...r, state: r.state && { ...r.state, cursor: 0 } } : r;
            };
          }
          const v = (target as unknown as Record<string | symbol, unknown>)[key];
          return typeof v === 'function' ? v.bind(target) : v;
        },
      }),
    };
    const before = await snapshot(w);
    expect(await runMerge(behind, { keep: w.keep, gone: w.gone, projectId: w.a.tree.workspaceId, text: 'x' })).toEqual({ status: 'blocked', reason: 'missing' });
    expect(await snapshot(w)).toEqual(before);
  });

  it('antes del puntero, la que queda ya no está (otro la mandó a la papelera): se frena, B viva y sin puntero', async () => {
    const w = await world();
    const out = await merge(w.a, w, {
      afterStep: async (step) => {
        if (step === 'uploaded') {
          await w.b.engine.syncNow();
          await w.b.tree.trash(w.keep);
          await w.b.engine.syncNow();
        }
      },
    });
    expect(out.status === 'stopped' && out.reason).toBe('into');
    await w.a.engine.syncNow();
    expect(w.a.tree.isTrashed(w.gone)).toBe(false);
    expect(readPointer(w.a.tree.get(w.gone))).toBeNull();
  });
});

describe('cortes y sin red (C3: se sigue, nunca B en la papelera sin la copia en A)', () => {
  for (const cut of ['started', 'moved', 'copied', 'uploaded', 'pointer'] as MergeStep[]) {
    it(`la app se cierra después de «${cut}»: al volver termina igual, sin duplicar`, async () => {
      const w = await world();
      const name = crypto.randomUUID();
      // El dispositivo que une, con su base local con nombre (para «volver a abrir la app»).
      const u = await device(w.server, name);
      await u.engine.syncNow();
      await expect(
        merge(u, w, {
          afterStep: (step) => {
            if (step === cut) throw new Error('la app se cerró');
          },
        }),
      ).rejects.toThrow('la app se cerró');
      if (cut !== 'pointer') expect(w.server.pages.get(w.gone)?.deleted_at ?? null).toBeNull();
      u.engine.stop();
      u.docs.dispose();
      u.db.close();
      const again = await device(w.server, name);
      await again.engine.syncNow();
      const outs = await resumeMerges(deps(again));
      expect(outs.map((o) => o.status)).toEqual(['done']);
      await merged(again, w);
      await merged(w.b, w);
      const job = (outs[0] as { job: Parameters<typeof copyKey>[0] }).job;
      expect([...blockIds((await again.docs.open(w.keep)))].filter((id) => id === separatorId(copyKey(job)))).toHaveLength(1);
      again.docs.close(w.keep);
    });
  }

  it('A no termina de subir (la base tarda con esa página) o el uso de la foto no se confirma: B no va a la papelera', async () => {
    for (const what of ['content', 'uses'] as const) {
      const w = await world();
      const remote = w.a.remote as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
      const push = remote.pushUpdate.bind(w.a.remote);
      const link = remote.linkPageFile.bind(w.a.remote);
      let slow = true;
      // Solo lo de A: el árbol y las demás páginas sincronizan bien (la sincronización «buena» se cumple igual).
      remote.pushUpdate = async (...args: unknown[]) => {
        if (slow && what === 'content' && args[0] === w.keep) throw new RemoteError('timeout', false, REQUEST_TIMEOUT);
        return push(...args);
      };
      remote.linkPageFile = async (...args: unknown[]) => {
        if (slow && what === 'uses' && args[0] === w.keep) throw new RemoteError('timeout', false, REQUEST_TIMEOUT);
        return link(...args);
      };
      const out = await merge(w.a, w, { waitMs: 600 });
      expect(out.status, what).toBe('pending');
      expect(w.server.pages.get(w.gone)?.deleted_at ?? null, what).toBeNull();
      expect(w.a.tree.isTrashed(w.gone), what).toBe(false);
      slow = false;
      // La cola de archivos espera su plazo antes de reintentar un uso que falló: pasa el tiempo.
      w.server.clockOffset += 120_000;
      expect((await resumeMerges(deps(w.a))).map((o) => o.status), what).toEqual(['done']);
      await merged(w.a, w);
      expect(w.server.pageFiles.has(`${w.keep}:${PHOTO}`), what).toBe(true);
    }
  });

  it('sin red a mitad: queda pendiente con B viva y A con la copia en el dispositivo; al volver la red termina', async () => {
    const w = await world();
    const out = await merge(w.a, w, {
      waitMs: 300,
      afterStep: (step) => {
        if (step === 'moved') w.server.online = false;
      },
    });
    expect(out.status).toBe('pending');
    expect(w.server.pages.get(w.gone)?.deleted_at ?? null).toBeNull();
    expect(w.a.tree.isTrashed(w.gone)).toBe(false);
    expect(await text(w.a, w.keep)).toContain('Texto de la segunda.');
    w.server.online = true;
    await w.a.engine.syncNow();
    expect((await resumeMerges(deps(w.a))).map((o) => o.status)).toEqual(['done']);
    await merged(w.a, w);
  });

});

describe('dos dispositivos', () => {
  it('otro escribe en B durante la unión y después sin red: queda en B, y Pending lo lista hasta Dismiss', async () => {
    const w = await world();
    const write = async (d: Device, words: string) => {
      await typeIn(d, w.gone, ` ${words}`, 1);
    };
    const out = await merge(w.a, w, {
      afterStep: async (step) => {
        if (step === 'copied') {
          await write(w.b, 'Escrito durante la unión');
          await w.b.engine.syncNow();
        }
      },
    });
    expect(out.status).toBe('done');
    await w.a.engine.syncNow();
    expect(mergeRows(w.a.tree, w.a.tree.workspaceId).map((r) => [r.kind, r.from, r.into])).toEqual([['changed', w.gone, w.keep]]);
    // B en la papelera se baja al abrirla (como *Open* desde Pending).
    await w.a.engine.prefetchPage(w.gone, 4000);
    expect((await text(w.a, w.gone)).join(' ')).toContain('Escrito durante la unión');
    // Dismiss: el puntero sube al seq de ahora.
    const row = w.a.tree.get(w.gone)!;
    await w.a.tree.setSetting(w.gone, 'merged', { ...readPointer(row)!, seq: row.update_seq });
    expect(mergeRows(w.a.tree, w.a.tree.workspaceId)).toEqual([]);
    // Después, sin red: el otro (que no se enteró) escribe en B; vuelve la red.
    await write(w.b, 'Escrito sin red después');
    await w.b.engine.syncNow();
    await w.a.engine.syncNow();
    expect(mergeRows(w.a.tree, w.a.tree.workspaceId).map((r) => r.kind)).toEqual(['changed']);
    await w.a.engine.prefetchPage(w.gone, 4000);
    expect((await text(w.a, w.gone)).join(' ')).toContain('Escrito sin red después');
    // Una ficha nueva adentro de B también.
    await w.a.tree.setSetting(w.gone, 'merged', { ...readPointer(w.a.tree.get(w.gone))!, seq: w.a.tree.get(w.gone)!.update_seq });
    await w.b.tree.create(w.gone, 'PRUEBA_105_123_020');
    await w.b.engine.syncNow();
    await w.a.engine.syncNow();
    expect(mergeRows(w.a.tree, w.a.tree.workspaceId).map((r) => r.kind === 'changed' && r.kids.length)).toEqual([1]);
  });

  it('otro escribe en el último renglón de A mientras se une: queda arriba del separador, nada se pierde', async () => {
    const w = await world();
    const out = await merge(w.a, w, {
      afterStep: async (step) => {
        if (step === 'moved') {
          await typeIn(w.b, w.keep, ' Corregido por otro.');
          await w.b.engine.syncNow();
        }
      },
    });
    expect(out.status).toBe('done');
    await w.b.engine.syncNow();
    await w.a.engine.syncNow();
    const t = await text(w.a, w.keep);
    expect(t).toEqual(await text(w.b, w.keep));
    expect(t).toContain('Lo de la primera página. Corregido por otro.');
    expect(t.indexOf('Lo de la primera página. Corregido por otro.')).toBeLessThan(t.indexOf('Merged from the other page'));
    expect(t).toContain('Texto de la segunda.');
  });

  it('C9 a: dos dispositivos unen lo mismo a la vez: se prefiere duplicar a perder', async () => {
    const w = await world();
    const [x, y] = await Promise.all([merge(w.a, w), merge(w.b, w)]);
    expect([x.status, y.status]).toEqual(['done', 'done']);
    await w.a.engine.syncNow();
    await w.b.engine.syncNow();
    await w.a.engine.syncNow();
    expect(w.a.tree.isTrashed(w.gone)).toBe(true);
    const t = await text(w.a, w.keep);
    // Las dos copias quedan en A (los mismos ids dos veces): se prefiere duplicar a perder; se arregla a mano.
    expect(t.filter((s) => s === 'Texto de la segunda.')).toHaveLength(2);
    expect(await text(w.a, w.gone)).toContain('Texto de la segunda.');
  });

  it('C9 b: dos uniones cruzadas a la vez: si las dos quedan en la papelera, Pending lo lista con Restore y nada se perdió', async () => {
    const w = await world();
    const [x, y] = await Promise.all([
      merge(w.a, w),
      runMerge(deps(w.b), { keep: w.gone, gone: w.keep, projectId: w.b.tree.workspaceId, text: 'Merged from the other page' }),
    ]);
    await w.a.engine.syncNow();
    await w.b.engine.syncNow();
    await w.a.engine.syncNow();
    const both = w.a.tree.isTrashed(w.gone) && w.a.tree.isTrashed(w.keep);
    expect([x.status, y.status, both]).toEqual(['done', 'done', true]);
    const rows = mergeRows(w.a.tree, w.a.tree.workspaceId);
    expect(rows.map((r) => r.kind)).toEqual(['intoTrashed', 'intoTrashed']);
    await w.a.tree.restore(rows[0].from);
    expect(w.a.tree.isTrashed(rows[0].from)).toBe(false);
    // La otra queda unida a la restaurada; lo que recibió después (la copia de la primera) se lista como cambiado.
    expect(mergeRows(w.a.tree, w.a.tree.workspaceId).map((r) => r.kind)).toEqual(['changed']);
    // Lo escrito en las dos sigue en algún lado (en la que quedó o en la papelera).
    expect([...(await text(w.a, w.keep)), ...(await text(w.a, w.gone))]).toEqual(expect.arrayContaining(['Lo de la primera página.', 'Texto de la segunda.']));
  });
});

describe('dos reportes del mismo día (D658 sin tomorrowNew)', () => {
  it('cada sección de escena conserva sus fotos en la que queda; lo de arriba del otro queda en el general', async () => {
    const w = await world();
    const PHOTO2 = '0000e16b-aaaa-4bbb-8ccc-dddddddddddd';
    w.server.mediaFiles.set(PHOTO2, { ...w.server.mediaFiles.get(PHOTO)!, id: PHOTO2, name: 'arriba.jpg', drive_id: 'd-arriba' });
    const days = w.a.tree.get(w.day)!.parent_id!;
    const twin = await w.a.tree.create(days, '2026-03-16 | Día 77');
    await writeBlocks(w.a, twin, [
      { photo: PHOTO2, caption: 'Arriba' },
      { h: 1, text: 'Escena 105_123' },
      { p: 'Desde la segunda unidad.' },
      { photo: PHOTO, caption: 'La curva otra vez' },
    ]);
    await w.a.engine.syncNow();
    const out = await runMerge(deps(w.a), { keep: w.day, gone: twin, projectId: w.a.tree.workspaceId, text: 'General · merged from the other report' });
    expect(out.status).toBe('done');
    await w.a.engine.syncNow();
    const index = new ProjectIndex(w.a.tree, w.a.docs);
    const rel = new RelationIndex(w.a.tree, index);
    await index.refresh(w.a.tree.workspaceId);
    await rel.update(w.a.tree.workspaceId);
    const snap = rel.snapshot(w.a.tree.workspaceId)!;
    const scene = entityRelations(snap, 'scene', '105_123');
    // Las dos secciones de la escena, en el reporte que quedó; la foto de abajo de «Escena 105_123» es de la escena.
    const onDay = scene.pages.find((p) => p.pageId === w.day)!;
    expect(onDay.sections.map((s) => s.title)).toEqual(['Escena 105_123', 'Escena 105_123']);
    expect(scene.photos.filter((p) => p.pageId === w.day).flatMap((p) => p.media)).toEqual([PHOTO]);
    // La foto de arriba del que se fue quedó bajo «General · merged…»: del día, no de una escena.
    const general = snap.pages.get(w.day)!.sections.find((s) => s.title.startsWith('General'))!;
    expect(general.scenes).toEqual([]);
    expect(general.media).toContain(PHOTO2);
    rel.dispose();
    index.dispose();
  });
});

describe('Undo desde el aviso (C5)', () => {
  it('B vuelve sin el puntero, la ficha vuelve a B y A queda sin lo copiado; lo que tocó otro queda', async () => {
    const w = await world();
    const out = await merge(w.a, w);
    if (out.status !== 'done') throw new Error(out.status);
    const before = ['Notas', 'Lo de la primera página.'];
    const undo = await undoMerge(deps(w.a), out.job);
    expect(undo).toEqual({ status: 'undone', kept: 0 });
    await w.a.engine.syncNow();
    expect(w.a.tree.isTrashed(w.gone)).toBe(false);
    expect(readPointer(w.a.tree.get(w.gone))).toBeNull();
    expect(w.a.tree.get(w.card)?.parent_id).toBe(w.gone);
    expect(await text(w.a, w.keep)).toEqual(before);

    // Otra vez, y ahora otro dispositivo corrige un bloque copiado antes del Undo: ese bloque queda.
    const again = await merge(w.a, w);
    if (again.status !== 'done') throw new Error(again.status);
    await w.b.engine.syncNow();
    await typeIn(w.b, w.keep, ' ¡corregido!', again.job.copy!.ids[2]);
    await w.b.engine.syncNow();
    expect(await undoMerge(deps(w.a), again.job)).toEqual({ status: 'undone', kept: 1 });
    expect(await text(w.a, w.keep)).toContain('Texto de la segunda. ¡corregido!');
  });

  it('sin red: no deshace nada y lo dice', async () => {
    const w = await world();
    const out = await merge(w.a, w);
    if (out.status !== 'done') throw new Error(out.status);
    w.server.online = false;
    expect(await undoMerge(deps(w.a), out.job)).toEqual({ status: 'offline' });
    expect(w.a.tree.isTrashed(w.gone)).toBe(true);
    w.server.online = true;
  });
});
