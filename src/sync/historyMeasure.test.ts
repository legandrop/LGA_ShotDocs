import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { PageHistory, type HistoryRow } from './history';
import { versionChanges } from './historyDiff';
import { block, group, seeded } from './historyTesting';

// Medición del historial con páginas grandes (Docs/Doc_Historial.md, sección 8 y "Cómo quedó (entrega 2)"). Corre
// solo con `HIST_MEASURE=<archivo de salida>` (y `HIST_N=10000`): no es una prueba de la suite.
//
// La simulación, como la del diseño: dos personas con el patrón de subida de la app después de B.15 (una subida por
// pausa con solo lo nuevo, también sus borrados), un autor de Yjs nuevo cada 60 subidas, a veces las dos a la vez,
// cambios de tipo como los hace y-prosemirror, y una pausa de una hora cada tanto (sesiones de 30 minutos).

const OUT = process.env.HIST_MEASURE;
const N = Number(process.env.HIST_N ?? 10_000);

/** Las filas de la simulación. */
export function simulate(n: number, seed = 7): HistoryRow[] {
  const rnd = seeded(seed);
  const people = ['ana', 'bea'];
  const docs = people.map(() => new Y.Doc());
  const pending: Uint8Array[][] = [[], []];
  const uploads = [0, 0];
  docs.forEach((d, i) =>
    d.on('update', (u: Uint8Array, origin: unknown) => {
      if (origin !== 'remote') pending[i].push(u);
    }),
  );
  const rows: HistoryRow[] = [];
  let clock = Date.parse('2026-01-01T10:00:00Z');
  let ids = 0;
  const words = ['plano', 'general', 'Ramón', 'suelta', 'los', 'cubiertos', 'mesa', 'luz', 'cámara', 'toma'];
  const word = () => words[Math.floor(rnd() * words.length)];
  // La primera fila: el grupo con un bloque.
  docs[0].transact(() => group(docs[0]).insert(0, [block(`b${++ids}`, 'Escena 1')]));
  const upload = (i: number) => {
    if (pending[i].length === 0) return;
    const data = Y.mergeUpdates(pending[i]);
    pending[i] = [];
    rows.push({ id: rows.length + 1, seq: rows.length + 1, createdBy: people[i], createdAt: new Date(clock).toISOString(), data });
    // El otro lo baja (a veces más tarde: las dos a la vez).
    uploads[i]++;
    if (uploads[i] % 60 === 0) docs[i].clientID = Math.floor(rnd() * 2 ** 31) + 1;
  };
  const sync = () => {
    for (const row of rows.slice(-4)) for (const d of docs) Y.applyUpdate(d, row.data, 'remote');
  };
  upload(0);
  sync();
  while (rows.length < n) {
    const i = rnd() < 0.5 ? 0 : 1;
    const d = docs[i];
    d.transact(() => {
      const g = group(d);
      const containers = g.toArray().filter((x): x is Y.XmlElement => x instanceof Y.XmlElement && x.get(0) instanceof Y.XmlElement && (x.get(0) as Y.XmlElement).get(0) instanceof Y.XmlText);
      const pick = () => containers[Math.floor(rnd() * containers.length)];
      const r = rnd();
      if (containers.length === 0 || r < 0.12) g.insert(Math.floor(rnd() * (g.length + 1)), [block(`b${++ids}`, `${word()} ${word()}`)]);
      else if (r < 0.16 && containers.length > 5) g.delete(g.toArray().indexOf(pick()), 1);
      else if (r < 0.2) {
        const c = pick();
        const at = g.toArray().indexOf(c);
        const t = ((c.get(0) as Y.XmlElement).get(0) as Y.XmlText).toString();
        g.delete(at, 1);
        g.insert(at, [block(String(c.getAttribute('id')), t, rnd() < 0.5 ? 'heading' : 'paragraph')]);
      } else if (r < 0.35) {
        const t = (pick().get(0) as Y.XmlElement).get(0) as Y.XmlText;
        if (t.length > 4) t.delete(Math.floor(rnd() * (t.length - 4)), 1 + Math.floor(rnd() * 4));
      } else {
        const t = (pick().get(0) as Y.XmlElement).get(0) as Y.XmlText;
        t.insert(Math.floor(rnd() * (t.length + 1)), ` ${word()}`);
      }
    });
    upload(i);
    clock += rnd() < 0.01 ? 60 * 60_000 : 1200 + Math.floor(rnd() * 20_000);
    if (rnd() < 0.8) sync();
  }
  return rows;
}

function time<T>(fn: () => T): [T, number] {
  const t0 = performance.now();
  const out = fn();
  return [out, Math.round((performance.now() - t0) * 10) / 10];
}

it.skipIf(!OUT)('medir el historial con páginas grandes', () => {
  const results: Record<string, unknown>[] = [];
  for (const n of [2000, N]) {
    const rows = simulate(n);
    const bytes = rows.reduce((s, r) => s + r.data.byteLength, 0);
    const [h, build] = time(() => new PageHistory(rows));
    // Lo que cuesta mandarle las filas al Worker (una copia) y el resumen de vuelta.
    const [, cloneRows] = time(() => structuredClone(rows.map((r) => r.data)));
    const sessions = h.sessions.length;
    // La sesión más larga (la de más filas) y la última.
    let longest = 0;
    h.sessions.forEach((s, i) => {
      if (s.last - s.first > h.sessions[longest].last - h.sessions[longest].first) longest = i;
    });
    const picks = [...new Set([longest, sessions - 1, Math.floor(sessions / 2)])];
    for (const i of picks) {
      const [v, version] = time(() => Y.encodeStateAsUpdate(h.version(i)));
      const [all, diffAll] = time(() => versionChanges(h, i, 'all'));
      const [changed, diffChanged] = time(() => versionChanges(h, i, 'changed'));
      // Antes (el prototipo del diseño): `toDelta` con los dos snapshots en cada texto del documento, cada uno en su
      // propia transacción (Yjs parte y vuelve a juntar los elementos en cada llamada).
      const [, diffPerText] = time(() => {
        const cur = h.snapshot(i);
        const prev = i > 0 ? h.snapshot(i - 1) : Y.createSnapshot(Y.createDeleteSet(), new Map());
        const walk = (t: Y.AbstractType<any>) => {
          for (let n = t._start; n; n = n.right) {
            if (!(n.content instanceof Y.ContentType)) continue;
            const c = n.content.type;
            if (c instanceof Y.XmlText) c.toDelta(cur, prev, (type: string, id: Y.ID) => ({ type, user: id.client }));
            else if (c instanceof Y.XmlElement) walk(c);
          }
        };
        walk(h.doc.getXmlFragment('document-store'));
      });
      // En la pantalla (hilo principal): armar los documentos que manda el Worker.
      const [, applyMain] = time(() => {
        const a = new Y.Doc();
        Y.applyUpdate(a, v);
        const b = new Y.Doc();
        Y.applyUpdate(b, changed.update);
      });
      expect(changed.marks.length).toBe(all.marks.length);
      results.push({
        n,
        kb: Math.round(bytes / 1024),
        sessions,
        session: i,
        rowsInSession: h.sessions[i].last - h.sessions[i].first + 1,
        build,
        cloneRows,
        version,
        diffAll,
        diffChanged,
        diffPerText,
        touched: changed.touched,
        marks: changed.marks.length,
        applyMain,
      });
    }
    // Sumar 1 fila con el historial abierto (O3): lo que cuesta `append` contra armar todo de nuevo.
    const fresh = new PageHistory(rows.slice(0, -1));
    const [, append] = time(() => fresh.append(rows.slice(-1)));
    results.push({ n, append });
    h.destroy();
    fresh.destroy();
  }
  writeFileSync(OUT!, JSON.stringify(results, null, 2));
}, 900_000);
