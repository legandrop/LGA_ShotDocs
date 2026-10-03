import * as Y from 'yjs';
import { startedOverKey, type LocalDb } from './localDb';
import { applyRowsInOrder } from './removedWriting';

// Lo tecleado tarde después de volver a la versión del equipo (Docs/Doc_Link_Publico.md, "Cómo quedó la 2c",
// correcciones, O1). `PageDocs.replaceWithServer` cambia lo guardado de la página por la base del equipo y guarda lo de
// antes en `meta` (`startedOverKey`). Un documento abierto con lo de antes (esta pestaña en los milisegundos hasta que la
// página se vuelve a armar, u otra pestaña antes de enterarse) puede guardar todavía una edición: cuelga de lo que ya
// no está en las filas, así que queda pendiente en Yjs, sin verse. Acá se busca y se pasa a lo de antes, donde sí se
// arma (sale en la copia, `beforeStartingOver`), y se anota para avisarle al visitante (`startedOverLateKey`). Nada se
// tira: lo pendiente pasa a lo de antes en la misma transacción en que sale de las filas.

/** Bytes guardados en IndexedDB (un `Uint8Array` de cualquier contexto: `instanceof` falla entre ventanas). */
export function isBytes(value: unknown): value is Uint8Array {
  return ArrayBuffer.isView(value) && (value as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT === 1;
}

/** Clave en `meta`: cuántas veces se pasó a lo de antes algo tecleado tarde en la página (el aviso, hasta que se cierra). */
export function startedOverLateKey(pageId: string): string {
  return `startedOverLate:${pageId}`;
}

/**
 * Si la página tiene lo de antes guardado y en sus filas hay algo que no se arma (pendiente) pero que sí se arma sobre lo
 * de antes, lo pasa a lo de antes, deja en las filas solo lo que se arma y suma la marca del aviso. Devuelve cuántos
 * elementos pasó (0 si nada). Si las filas cambiaron entre la lectura y la escritura, no toca nada (la próxima vez).
 */
export async function keepLateWriting(db: LocalDb, pageId: string): Promise<number> {
  // Lo común (una página sin vuelta a la versión del equipo): una lectura de una clave y nada más.
  if (!isBytes(await db.get('meta', startedOverKey(pageId)))) return 0;
  const read = db.transaction(['docUpdates', 'meta'], 'readonly');
  const index = read.objectStore('docUpdates').index('pageId');
  const [keys, rows, kept] = await Promise.all([index.getAllKeys(pageId), index.getAll(pageId), read.objectStore('meta').get(startedOverKey(pageId))]);
  await read.done;
  if (!isBytes(kept) || rows.length === 0) return 0;
  const page = new Y.Doc({ gc: false });
  const all = new Y.Doc({ gc: false });
  try {
    applyRowsInOrder(page, rows.map((r) => r.data));
    const pending = page.store.pendingStructs;
    if (!pending && !page.store.pendingDs) return 0;
    Y.applyUpdate(all, kept);
    applyRowsInOrder(all, rows.map((r) => r.data));
    // Solo lo que se arma sobre lo de antes es de antes; si sigue pendiente, no es esto (no se toca).
    if (all.store.pendingStructs || all.store.pendingDs) return 0;
    const moved = pending ? Math.max(1, Y.decodeUpdate(pending.update).structs.length) : 1;
    page.store.pendingStructs = null;
    page.store.pendingDs = null;
    const integrated = Y.encodeStateAsUpdate(page);
    const nextKept = Y.encodeStateAsUpdate(all);
    const tx = db.transaction(['docUpdates', 'meta'], 'readwrite');
    const [now, late] = await Promise.all([tx.objectStore('docUpdates').index('pageId').getAllKeys(pageId), tx.objectStore('meta').get(startedOverLateKey(pageId))]);
    if (now.length !== keys.length || now.some((k, i) => k !== keys[i])) {
      tx.abort();
      await tx.done.catch(() => undefined);
      return 0;
    }
    await tx.objectStore('meta').put(nextKept, startedOverKey(pageId));
    await Promise.all(keys.map((k) => tx.objectStore('docUpdates').delete(k)));
    await tx.objectStore('docUpdates').add({ pageId, data: integrated });
    await tx.objectStore('meta').put((typeof late === 'number' ? late : 0) + 1, startedOverLateKey(pageId));
    await tx.done;
    console.warn(`Página ${pageId}: algo tecleado mientras volvía a la versión del equipo pasó a lo de antes (sale en la copia).`);
    return moved;
  } finally {
    page.destroy();
    all.destroy();
  }
}
