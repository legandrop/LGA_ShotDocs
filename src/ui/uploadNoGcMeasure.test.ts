// @vitest-environment jsdom
import { TextSelection } from '@tiptap/pm/state';
import { appendFileSync, writeFileSync } from 'node:fs';
import { afterEach, it } from 'vitest';
import * as Y from 'yjs';
import { buildUpload } from '../sync/deleteSets';
import { applyRowsInOrder } from '../sync/removedWriting';
import { mountEditor, press, seeded, unmountAll, view, type Editor } from './collabHarness';

// Medición de B.16 (no corre en CI): cuánto más pesan las subidas armadas sin GC y cuánto tarda armarlas, con el
// editor real escribiendo letra por letra (cada letra, una transacción y una fila guardada, como en la app) y
// subiendo cada ~20 letras (1,2 s escribiendo rápido). Cada subida se arma de las dos formas con las mismas filas.
//
//   UPLOAD_MEASURE=<archivo> npx vitest run src/ui/uploadNoGcMeasure.test.ts
//   (UPLOAD_KEYS=<letras> cambia el largo de la sesión "muy editada"; con UPLOAD_ROWS=<archivo.json> guarda las
//   filas para medir memoria aparte.)

afterEach(unmountAll);

const OUT = process.env.UPLOAD_MEASURE;

interface Totals {
  uploads: number;
  gcBytes: number;
  noGcBytes: number;
  gcMs: number;
  noGcMs: number;
  maxRatio: number;
}

/** Arma la subida como `readSaved` antes (con GC, `mergeUpdates`) y ahora (sin GC, fila por fila). */
function both(rows: Uint8Array[], syncedSV: Uint8Array | undefined, totals: Totals): { sv: Uint8Array } {
  let t = performance.now();
  const gc = new Y.Doc();
  Y.applyUpdate(gc, Y.mergeUpdates(rows));
  const a = buildUpload(gc, syncedSV, undefined);
  totals.gcMs += performance.now() - t;
  t = performance.now();
  const noGc = new Y.Doc({ gc: false });
  applyRowsInOrder(noGc, rows);
  const b = buildUpload(noGc, syncedSV, undefined);
  totals.noGcMs += performance.now() - t;
  totals.uploads++;
  totals.gcBytes += a.update.length;
  totals.noGcBytes += b.update.length;
  totals.maxRatio = Math.max(totals.maxRatio, b.update.length / a.update.length);
  const sv = Y.encodeStateVector(noGc);
  gc.destroy();
  noGc.destroy();
  return { sv };
}

const WORDS = 'plano general de la calle de noche con lluvia cámara en mano luz cálida desde la ventana toma dos'.split(' ');

/** Una sesión de escritura: letras, borrar con Backspace, borrar palabras, Enter, cambiar el tipo, sangrar. */
async function session(keys: number, seed: number, churn: number): Promise<{ rows: Uint8Array[]; totals: Totals; text: number }> {
  const rand = seeded(seed);
  const doc = new Y.Doc();
  const rows: Uint8Array[] = [];
  doc.on('update', (u: Uint8Array) => rows.push(u));
  const E: Editor = mountEditor(doc, 'm');
  const totals: Totals = { uploads: 0, gcBytes: 0, noGcBytes: 0, gcMs: 0, noGcMs: 0, maxRatio: 0 };
  let syncedSV: Uint8Array | undefined;
  let sinceUpload = 0;
  let word = '';
  const caretToEnd = () => {
    const v = view(E);
    v.dispatch(v.state.tr.setSelection(TextSelection.atEnd(v.state.doc)));
  };
  caretToEnd();
  for (let k = 0; k < keys; k++) {
    const r = rand();
    if (r < churn * 0.5) {
      press(E, 'Backspace');
    } else if (r < churn * 0.6) {
      // Borra el bloque de arriba entero (reescribir un párrafo).
      const blocks = E.document;
      if (blocks.length > 3) E.removeBlocks([blocks[Math.floor(rand() * (blocks.length - 1))].id]);
      caretToEnd();
    } else if (r < churn * 0.7) {
      const blocks = E.document;
      const b = blocks[Math.floor(rand() * blocks.length)];
      E.updateBlock(b.id, { type: rand() < 0.5 ? 'heading' : rand() < 0.5 ? 'bulletListItem' : 'paragraph' } as never);
      caretToEnd();
    } else if (r < churn * 0.75) {
      press(E, 'Tab');
    } else if (r < 0.03 + churn) {
      press(E, 'Enter');
    } else {
      if (!word) word = `${WORDS[Math.floor(rand() * WORDS.length)]} `;
      E.insertInlineContent(word[0]);
      word = word.slice(1);
    }
    if (++sinceUpload >= 20) {
      sinceUpload = 0;
      syncedSV = both(rows, syncedSV, totals).sv;
    }
  }
  both(rows, syncedSV, totals);
  const text = view(E).state.doc.textContent.length;
  E.unmount();
  return { rows, totals, text };
}

function restoreSizes(rows: Uint8Array[]): { gc: number; noGc: number } {
  const gc = new Y.Doc();
  Y.applyUpdate(gc, Y.mergeUpdates(rows));
  const noGc = new Y.Doc({ gc: false });
  applyRowsInOrder(noGc, rows);
  const out = { gc: buildUpload(gc, undefined, undefined).update.length, noGc: buildUpload(noGc, undefined, undefined).update.length };
  gc.destroy();
  noGc.destroy();
  return out;
}

it.skipIf(!OUT)('medir', async () => {
  writeFileSync(OUT!, '# B.16: subidas con GC (antes) y sin GC (ahora), editor real, una subida cada 20 letras\n\n');
  const heavyKeys = Number(process.env.UPLOAD_KEYS ?? 20000);
  const cases = [
    { name: 'página típica: 2000 letras, pocas correcciones', keys: 2000, churn: 0.04 },
    { name: 'página corregida: 5000 letras, muchas correcciones', keys: 5000, churn: 0.15 },
    { name: `página muy editada: ${heavyKeys} letras, reescribe bloques`, keys: heavyKeys, churn: 0.25 },
  ];
  for (const [i, c] of cases.entries()) {
    const { rows, totals, text } = await session(c.keys, 100 + i, c.churn);
    const restore = restoreSizes(rows);
    const kb = (n: number) => (n / 1024).toFixed(1);
    appendFileSync(
      OUT!,
      [
        `## ${c.name}`,
        `texto final ${text} letras; ${rows.length} filas guardadas (${kb(rows.reduce((s, r) => s + r.length, 0))} KB en IndexedDB, igual antes y ahora)`,
        `subidas: ${totals.uploads}; total con GC ${kb(totals.gcBytes)} KB, sin GC ${kb(totals.noGcBytes)} KB (+${((totals.noGcBytes / totals.gcBytes - 1) * 100).toFixed(0)} %); la que más creció, x${totals.maxRatio.toFixed(2)}`,
        `armar cada subida: con GC ${(totals.gcMs / totals.uploads).toFixed(2)} ms, sin GC ${(totals.noGcMs / totals.uploads).toFixed(2)} ms de promedio`,
        `subida entera (después de restaurar una copia): con GC ${kb(restore.gc)} KB, sin GC ${kb(restore.noGc)} KB`,
        '',
      ].join('\n'),
    );
    if (process.env.UPLOAD_ROWS && i === cases.length - 1) {
      writeFileSync(process.env.UPLOAD_ROWS, JSON.stringify(rows.map((r) => Buffer.from(r).toString('base64'))));
    }
  }
}, 1_800_000);
