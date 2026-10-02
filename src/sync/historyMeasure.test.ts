import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { PageHistory } from './history';
import { versionChanges } from './historyDiff';
import { simulate } from './historyTesting';

// Medición del historial con páginas grandes (Docs/Doc_Historial.md, sección 8 y "Cómo quedó (entrega 2)"). Corre
// solo con `HIST_MEASURE=<archivo de salida>` (y `HIST_N=10000`): no es una prueba de la suite.
//
// La simulación, como la del diseño: dos personas con el patrón de subida de la app después de B.15 (una subida por
// pausa con solo lo nuevo, también sus borrados), un autor de Yjs nuevo cada 60 subidas, a veces las dos a la vez,
// cambios de tipo como los hace y-prosemirror, y una pausa de una hora cada tanto (sesiones de 30 minutos).

const OUT = process.env.HIST_MEASURE;
const N = Number(process.env.HIST_N ?? 10_000);

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
