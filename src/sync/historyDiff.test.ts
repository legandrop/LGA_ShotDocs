import { readdirSync, readFileSync } from 'node:fs';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { PageHistory, type HistoryRow } from './history';
import { encodeRanges } from './deleteSets';
import { diffText, versionChanges } from './historyDiff';
import { authorOfRow, block, everyLetter, blocksOf, group, readMarks, rowsOf, seeded, serverAt, textOf, unionDoc, visible, withoutMarks } from './historyTesting';
import { PageDocs as OldPageDocs } from './fixtures/mainDocs';
import { openLocalDb } from './localDb';
import { normalizeStructure, seedIfEmpty } from './structure';
import { FakeRemote, FakeServer, makeDevice, type Device } from './testing';

// Los cambios de cada versión (P.18, Docs/Doc_Historial.md, entrega 2): la unión de dos versiones con lo agregado y lo
// borrado marcado por persona, los bloques rehechos apareados por id, la diferencia solo de lo que cambió (igual a la
// completa) y el texto huérfano. Las filas salen de la subida de verdad (`PageDocs` y el servidor en memoria).

const devices: Device[] = [];
async function device(server: FakeServer, user?: { id: string; email: string }): Promise<Device> {
  const d = await makeDevice(server, undefined, '0.021', {}, undefined, user ?? {});
  devices.push(d);
  return d;
}

const swallow = (e: unknown) => {
  if (String(e).includes('closed') || String(e).includes('InvalidStateError')) return;
  throw e;
};
process.on('unhandledRejection', swallow);
afterAll(() => {
  process.off('unhandledRejection', swallow);
});
afterEach(async () => {
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    try {
      d.db.close();
      d.mediaDb.close();
      d.commentsDb.close();
    } catch {
      // ya cerrada
    }
  }
});

const B = { id: 'user-b', email: 'b@test' };

async function edit(d: Device, pageId: string, fn: (doc: Y.Doc, g: Y.XmlElement) => void): Promise<void> {
  const doc = await d.docs.open(pageId);
  doc.transact(() => fn(doc, group(doc)), 'test');
  await d.docs.flush(pageId);
  d.docs.close(pageId);
}

async function setup() {
  const server = new FakeServer();
  let clock = Date.parse('2026-10-01T10:00:00Z');
  server.now = () => clock;
  const a = await device(server);
  const pageId = await a.tree.create(null, 'P');
  await a.engine.syncNow();
  const b = await device(server, B);
  await b.engine.syncNow();
  return { server, a, b, pageId, tick: (ms: number) => (clock += ms) };
}

const HOUR = 60 * 60_000;

/** Las marcas de la versión `i`, leídas, con el autor de cada una. */
function marksOf(h: PageHistory, i: number, scope: 'changed' | 'all' = 'changed') {
  const c = versionChanges(h, i, scope);
  const u = unionDoc(c.update);
  return { union: u, marks: c.marks, read: readMarks(u, c.marks).map((m) => ({ ...m, by: authorOfRow(h, m.row) })) };
}

/** Comprueba la unión de cada versión contra las dos versiones que junta. */
function checkUnions(h: PageHistory, rows: HistoryRow[], label: string) {
  for (let i = 0; i < h.sessions.length; i++) {
    const v = h.version(i);
    expect(visible(v), `${label}, versión ${i}`).toBe(serverAt(rows, h.sessions[i].last + 1));
    const { union, marks } = marksOf(h, i);
    // Sin lo borrado, la unión es la versión (en orden); sin lo agregado, la anterior (los mismos bloques y textos).
    expect(withoutMarks(union, marks, 'del'), `${label}, versión ${i}: sin lo borrado`).toEqual(blocksOf(v));
    const before = i > 0 ? blocksOf(h.version(i - 1)) : [];
    expect(withoutMarks(union, marks, 'add').sort(), `${label}, versión ${i}: sin lo agregado`).toEqual(before.sort());
    // Ninguna marca vacía ni sin fila.
    for (const m of readMarks(union, marks)) {
      expect(m.text, `${label}, versión ${i}: marca ${JSON.stringify(m)}`).not.toBe('');
      expect(m.text).not.toBe('?');
      expect(m.row, `${label}, versión ${i}: fila de ${JSON.stringify(m)}`).toBeGreaterThanOrEqual(0);
    }
    // La diferencia solo de lo que cambió es igual a la completa.
    const all = versionChanges(h, i, 'all');
    const allUnion = unionDoc(all.update);
    expect(visible(union), `${label}, versión ${i}: unión`).toBe(visible(allUnion));
    expect(readMarks(union, marks), `${label}, versión ${i}: marcas`).toEqual(readMarks(allUnion, all.marks));
    v.destroy();
    union.destroy();
    allUnion.destroy();
  }
}

describe('lo agregado y lo borrado, por persona', () => {
  it('cada tramo con quien lo escribió o lo borró; un bloque agregado y uno borrado enteros', async () => {
    const { server, a, b, pageId, tick } = await setup();
    await edit(a, pageId, (_d, g) => g.insert(0, [block('x', 'Hola mundo'), block('y', 'Se va')]));
    await a.engine.syncNow();
    tick(HOUR);
    await b.engine.syncNow();
    await edit(b, pageId, (_d, g) => {
      const t = textOf(g.get(0) as Y.XmlElement);
      t.insert(10, ' de Bea');
      t.delete(0, 5); // "Hola " lo escribió A, lo borra B
      g.delete(1, 1); // el bloque "Se va", entero
      g.insert(1, [block('z', 'Nuevo')]);
    });
    await b.engine.syncNow();
    const rows = rowsOf(server, pageId);
    const h = new PageHistory(rows);
    expect(h.sessions.length).toBe(2);
    const { read } = marksOf(h, 1);
    const simple = read.map((m) => `${m.type}:${m.kind}:${m.block}:${m.text}:${m.by}`).sort();
    expect(simple).toEqual(
      [
        `text:add:x: de Bea:${B.id}`,
        `text:del:x:Hola :${B.id}`,
        `node:del:y:paragraph:${B.id}`,
        `text:del:y:Se va:${B.id}`,
        `node:add:z:paragraph:${B.id}`,
        `text:add:z:Nuevo:${B.id}`,
      ].sort(),
    );
    // La primera versión: todo agregado por A.
    const first = marksOf(h, 0).read;
    expect(first.filter((m) => m.type === 'text').map((m) => `${m.text}:${m.by}`)).toEqual([`Hola mundo:${server.ownerId}`, `Se va:${server.ownerId}`]);
    checkUnions(h, rows, 'guion');
  });

  it('un bloque que y-prosemirror rehace con el mismo id (cambiar el tipo) es UN bloque que cambió, con su texto comparado por palabras', async () => {
    const { server, a, b, pageId, tick } = await setup();
    await edit(a, pageId, (_d, g) => g.insert(0, [block('x', 'Escena 64'), block('y', 'Otro')]));
    await a.engine.syncNow();
    tick(HOUR);
    await b.engine.syncNow();
    await edit(b, pageId, (_d, g) => {
      // Como y-prosemirror: borra el bloque y lo crea de nuevo con el mismo id, ya como título, con una letra más.
      g.delete(0, 1);
      g.insert(0, [block('x', 'Escena 64!', 'heading', { level: '2' })]);
    });
    await b.engine.syncNow();
    const rows = rowsOf(server, pageId);
    const h = new PageHistory(rows);
    const { read } = marksOf(h, 1);
    expect(read.map((m) => `${m.type}:${m.kind}:${m.block}:${m.text}:${m.label ?? ''}:${m.by}`)).toEqual([
      `text:add:x:!::${B.id}`,
      `node:change:x:heading:{"kind":"type","to":{"type":"heading","level":2}}:${B.id}`,
    ]);
    checkUnions(h, rows, 'rehecho');
  });

  it('el formato cambiado en el lugar (título 1 a 2, el color) lleva su rótulo; mover un bloque rehecho, "moved"', async () => {
    const { server, a, pageId, tick } = await setup();
    await edit(a, pageId, (_d, g) => g.insert(0, [block('x', 'Título', 'heading', { level: '1' }), block('y', 'Uno'), block('w', 'Dos')]));
    await a.engine.syncNow();
    tick(HOUR);
    await edit(a, pageId, (_d, g) => {
      ((g.get(0) as Y.XmlElement).get(0) as Y.XmlElement).setAttribute('level', '2');
      ((g.get(1) as Y.XmlElement).get(0) as Y.XmlElement).setAttribute('textColor', 'red');
      // Mover "Dos" arriba de "Uno" como y-prosemirror: borrarlo y crearlo de nuevo con el mismo id en otro lugar.
      g.delete(2, 1);
      g.insert(1, [block('w', 'Dos')]);
    });
    await a.engine.syncNow();
    const rows = rowsOf(server, pageId);
    const h = new PageHistory(rows);
    const labels = marksOf(h, 1)
      .read.filter((m) => m.label)
      .map((m) => `${m.block}:${m.label}`)
      .sort();
    expect(labels).toEqual(
      [`w:{"kind":"moved"}`, `x:{"kind":"type","to":{"type":"heading","level":2}}`, `y:{"kind":"format"}`].sort(),
    );
    checkUnions(h, rows, 'formato');
  });
});

describe('texto huérfano (5.4)', () => {
  it('lo que B escribió en un bloque que A ya había borrado se ve en la versión de la fila de B, con su texto', async () => {
    const { server, a, b, pageId, tick } = await setup();
    await edit(a, pageId, (_d, g) => g.insert(0, [block('x', 'Queda'), block('y', 'Se borra')]));
    await a.engine.syncNow();
    await b.engine.syncNow();
    tick(HOUR);
    // B escribe sin subir; A borra el bloque y sube; B baja el borrado ANTES de subir (sin GC, su texto viaja igual).
    await edit(b, pageId, (_d, g) => textOf(g.get(1) as Y.XmlElement).insert(8, ' TEXTO-DE-B'));
    await edit(a, pageId, (_d, g) => g.delete(1, 1));
    await a.engine.syncNow();
    tick(HOUR);
    await b.docs.pullPage(pageId, b.remote);
    await b.engine.syncNow();
    const rows = rowsOf(server, pageId);
    const h = new PageHistory(rows);
    expect(h.orphans.map((o) => `${o.text}:${o.blockId}:${h.rows[o.row].createdBy}`)).toEqual([` TEXTO-DE-B:y:${B.id}`]);
    const where = h.sessionOfRow(h.orphans[0].row);
    expect(h.orphansOf(where).map((o) => o.text)).toEqual([' TEXTO-DE-B']);
    // No se ve en ninguna versión: por eso va aparte.
    for (let i = 0; i < h.sessions.length; i++) expect(JSON.stringify(blocksOf(h.version(i)))).not.toContain('TEXTO-DE-B');
    // Si B sube ANTES de bajar el borrado, no es huérfano: se ve en una versión.
    checkUnions(h, rows, 'huérfano');
  });
});

describe('la diferencia de dos textos', () => {
  it('lo igual, lo agregado y lo borrado', () => {
    expect(diffText('Hola mundo', 'Hola lindo mundo').join('')).toBe('=====++++++=====');
    // Por palabras: "fija" se borra entera y "en mano" se agrega entera (no letras sueltas).
    expect(diffText('cámara fija.', 'cámara en mano.').join('')).toBe('=======----+++++++=');
    // Un emoji (dos unidades de UTF-16) no se parte.
    expect(diffText('a 😀', 'a 😃').join('')).toBe('==--++');
    expect(diffText('abc', '').join('')).toBe('---');
    expect(diffText('', 'ab').join('')).toBe('++');
  });
});

describe('al azar con tres personas: filas con GC (la versión publicada) y sin GC mezcladas', () => {
  it('cada versión es lo del servidor, la unión da las dos versiones, solo lo tocado = completo, y ninguna letra se pierde', async () => {
    let orphansSeen = 0;
    let cases = 0;
    for (const seed of [21, 22, 23, 24, 25, 26, 27, 28, 29, 30]) {
      const { server, a, b, pageId, tick } = await setup();
      // C: la versión publicada (sube con GC), con su propia persona.
      const oldDb = await openLocalDb(crypto.randomUUID());
      const old = new OldPageDocs(oldDb, { normalize: normalizeStructure, seed: seedIfEmpty });
      const oldRemote = new FakeRemote(server, '0.082', 'user-c', 'c@test');
      const rnd = seeded(seed);
      let ids = 0;
      const pull = async (who: number) => {
        if (who === 2) await old.pullPage(pageId, oldRemote);
        else await (who === 0 ? a : b).docs.pullPage(pageId, (who === 0 ? a : b).remote);
      };
      const push = async (who: number) => {
        if (who === 2) for (const id of await old.unsyncedPages()) await old.pushPage(id, oldRemote);
        else await (who === 0 ? a : b).engine.syncNow();
      };
      for (let step = 0; step < 60; step++) {
        const who = Math.floor(rnd() * 3);
        // A veces sin bajar lo de los demás antes (sin red un rato): así aparecen cambios a la vez.
        if (rnd() < 0.6) await pull(who);
        const docs = (who === 2 ? old : who === 0 ? a.docs : b.docs) as unknown as {
          open(id: string): Promise<Y.Doc>;
          flush(id?: string): Promise<void>;
          close(id: string): void;
          resetForRestore(): Promise<number>;
        };
        const r = rnd();
        if (r < 0.05) {
          await docs.resetForRestore();
        } else {
          const doc = await docs.open(pageId);
          doc.transact(() => {
            const g = group(doc);
            const pick = () => g.get(Math.floor(rnd() * g.length)) as Y.XmlElement;
            const containers = () => g.toArray().filter((x): x is Y.XmlElement => x instanceof Y.XmlElement && x.nodeName === 'blockContainer' && x.get(0) instanceof Y.XmlElement && (x.get(0) as Y.XmlElement).get(0) instanceof Y.XmlText);
            const any = () => {
              const list = containers();
              return list.length ? list[Math.floor(rnd() * list.length)] : null;
            };
            if (g.length === 0 || r < 0.3) g.insert(Math.floor(rnd() * (g.length + 1)), [block(`s${seed}-${++ids}`, `texto ${ids} `)]);
            else if (r < 0.42 && g.length > 2) g.delete(Math.floor(rnd() * g.length), 1);
            else if (r < 0.52) {
              // Cambiar el tipo (o mover) como y-prosemirror: borra el bloque y lo crea de nuevo con el mismo id.
              const target = any();
              if (target) {
                const i = g.toArray().indexOf(target);
                const fresh = block(String(target.getAttribute('id')), textOf(target).toString(), rnd() < 0.5 ? 'heading' : 'paragraph');
                g.delete(i, 1);
                g.insert(rnd() < 0.3 ? Math.floor(rnd() * (g.length + 1)) : i, [fresh]);
              }
            } else if (r < 0.58) {
              const target = any();
              if (target) (target.get(0) as Y.XmlElement).setAttribute('textColor', rnd() < 0.5 ? 'red' : 'blue');
            } else if (r < 0.8) {
              const target = any() ?? pick();
              const t = target && target.get(0) instanceof Y.XmlElement ? ((target.get(0) as Y.XmlElement).get(0) as Y.XmlText | undefined) : undefined;
              if (t instanceof Y.XmlText) t.insert(Math.floor(rnd() * (t.length + 1)), ` p${step}`);
            } else {
              const target = any();
              const t = target ? textOf(target) : null;
              if (t && t.length > 3) t.delete(Math.floor(rnd() * (t.length - 3)), 1 + Math.floor(rnd() * 3));
            }
          }, 'test');
          await docs.flush(pageId);
          docs.close(pageId);
        }
        // A veces baja el borrado de otro ANTES de subir lo suyo (el orden del texto huérfano).
        if (rnd() < 0.3) await pull(who);
        if (rnd() < 0.75) await push(who);
        tick(rnd() < 0.25 ? 45 * 60_000 : 1000 + Math.floor(rnd() * 60_000));
      }
      for (const who of [0, 1, 2, 0]) {
        await pull(who);
        await push(who);
      }
      const rows = rowsOf(server, pageId);
      expect(new Set(rows.map((r) => r.createdBy)).size, `semilla ${seed}: tres personas`).toBe(3);
      const h = new PageHistory(rows);
      checkUnions(h, rows, `semilla ${seed}`);
      // Ninguna letra que llegó al servidor se pierde: se ve en la versión de su fila o en su texto huérfano.
      const perRow = new PageHistory(rows, -1);
      // Cada fila, su propia versión: también la diferencia de cada una (solo lo tocado = completo, las dos versiones).
      checkUnions(perRow, rows, `semilla ${seed}, por fila`);
      cases += perRow.sessions.length + h.sessions.length;
      const { checked, orphaned, lost } = everyLetter(perRow);
      expect(lost, `semilla ${seed}: letras que no se ven en ninguna versión ni en el texto huérfano`).toEqual([]);
      expect(checked).toBeGreaterThan(0);
      orphansSeen += orphaned;
      if (process.env.HIST_DEBUG) console.log(`semilla ${seed}: filas ${rows.length}, sesiones ${h.sessions.length}, letras ${checked}, huérfanas ${orphaned}, casos ${cases}, marcas ${h.sessions.map((_, i) => versionChanges(h, i).marks.length).join(",")}`);
      h.destroy();
      perRow.destroy();
      old.dispose();
      oldDb.close();
      for (const d of devices.splice(0)) {
        await d.engine.stop();
        d.db.close();
      }
    }
    // El texto huérfano aparece en alguna corrida (si no, la prueba no prueba lo que dice).
    expect(orphansSeen).toBeGreaterThan(0);
    expect(cases).toBeGreaterThan(500);
  });
});

describe('solo lo tocado: un bloque que deja de verse porque se borró algo de arriba', () => {
  it('casos al azar guardados (dos raíces que se juntan, padres rehechos con sus hijos): igual que la completa', () => {
    // Filas de corridas al azar de la auditoría en que la diferencia solo de lo tocado salía distinta de la completa:
    // un bloque que deja de verse porque se borró uno de arriba (o la raíz vieja de una página con dos raíces) no se
    // contaba como tocado. `i`: la versión; `cut`: el corte de sesiones con que se armó.
    const dir = new URL('./fixtures/historyTouched/', import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(2);
    for (const file of files) {
      const saved = JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as { i: number; cut?: number; rows: (Omit<HistoryRow, 'data'> & { data: string })[] };
      const rows = saved.rows.map((r) => ({ ...r, data: new Uint8Array(Buffer.from(r.data, 'base64')) }));
      const h = new PageHistory(rows, saved.cut);
      const changed = versionChanges(h, saved.i, 'changed');
      const all = versionChanges(h, saved.i, 'all');
      const u1 = unionDoc(changed.update);
      const u2 = unionDoc(all.update);
      expect(visible(u1), file).toBe(visible(u2));
      expect(readMarks(u1, changed.marks), file).toEqual(readMarks(u2, all.marks));
    }
  });
});

describe('dos sangrías a la vez bajo el mismo bloque (O2 de la auditoría de la entrega 2)', () => {
  it('dejan dos grupos de hijos con el mismo hijo: la unión lo muestra una vez, como la versión (repairBlocks)', () => {
    // Filas de una corrida al azar de la auditoría: en la versión 25, el bloque «s250-1» tiene dos grupos de hijos con
    // el mismo «s250-7» (y su hijo); la versión (reparada) lo tiene una vez y la unión lo mostraba dos (uno, agregado).
    const saved = JSON.parse(readFileSync(new URL('./fixtures/historyDupGroups/semilla_250-v25.json', import.meta.url), 'utf8')) as {
      i: number;
      cut?: number;
      rows: (Omit<HistoryRow, 'data'> & { data: string })[];
    };
    const rows = saved.rows.map((r) => ({ ...r, data: new Uint8Array(Buffer.from(r.data, 'base64')) }));
    const h = new PageHistory(rows, saved.cut);
    const i = saved.i;
    for (const scope of ['changed', 'all'] as const) {
      const c = versionChanges(h, i, scope);
      const u = unionDoc(c.update);
      expect(withoutMarks(u, c.marks, 'del'), `${scope}: sin lo borrado`).toEqual(blocksOf(h.version(i)));
      expect(withoutMarks(u, c.marks, 'add').sort(), `${scope}: sin lo agregado`).toEqual(blocksOf(h.version(i - 1)).sort());
      expect(blocksOf(u).filter((b) => b.startsWith('s250-7:')).length, scope).toBe(1);
      u.destroy();
    }
  });
});

describe('quién borró lo de adentro de un bloque borrado', () => {
  it('si una fila borra solo el bloque de arriba, lo de adentro lleva la fila (y la persona) que lo borró', () => {
    // Un bloque con un hijo sangrado. La segunda fila borra SOLO el elemento del padre (sin los de adentro en su lista
    // de borrados): Yjs borra lo de adentro al integrarla, pero ninguna fila trae ese borrado.
    const doc = new Y.Doc();
    const g = group(doc);
    const parent = block('p', 'Padre');
    g.insert(0, [parent, block('q', 'Queda')]);
    const kids = new Y.XmlElement('blockGroup');
    parent.insert(1, [kids]);
    kids.insert(0, [block('c', 'Hijo borrado')]);
    const first = Y.encodeStateAsUpdate(doc);
    const item = parent._item!;
    const second = encodeRanges(new Map([[item.id.client, [[item.id.clock, item.id.clock + 1]]]]));
    const rows: HistoryRow[] = [first, second].map((data, i) => ({ id: i + 1, seq: i + 1, createdBy: i ? 'bea' : 'ana', createdAt: `2026-10-01T1${i}:00:00Z`, data }));
    const h = new PageHistory(rows);
    expect(h.sessions.length).toBe(2);
    const c = versionChanges(h, 1);
    const read = readMarks(unionDoc(c.update), c.marks);
    const child = read.filter((m) => m.block === 'c');
    expect(child.map((m) => `${m.type}:${m.kind}:${m.text}`).sort()).toEqual(['node:del:paragraph', 'text:del:Hijo borrado']);
    // Todas las marcas del borrado, con la fila de Bea (no "sin fila": el tooltip diría Former member y sin hora).
    for (const m of read) expect(authorOfRow(h, m.row), JSON.stringify(m)).toBe('bea');
  });
});
