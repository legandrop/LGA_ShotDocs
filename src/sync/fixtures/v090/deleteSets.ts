// Copia de la versión publicada v0.090 (commit ca593e7) de src/sync/deleteSets.ts, para probar que lo que esa versión
// deja en el dispositivo (por ejemplo, después de semanas sin red) lo lee y lo sube la versión actual sin perder
// nada (src/sync/offlineLargo.test.ts). No se toca, salvo los caminos de los imports.
import * as Y from 'yjs';

/**
 * Borrados de Yjs (el "delete set"), roadmap B.15. Ver Docs/Doc_Sincronizacion.md, "Subir solo los borrados
 * nuevos".
 *
 * Un update de Yjs (formato v1) son dos partes seguidas: los elementos (structs) y el delete set, la lista de
 * tramos borrados `[reloj, reloj + largo)` de cada autor. `Y.encodeStateAsUpdate(doc, sv)` corta los elementos
 * con el vector de estado pero manda **todos** los borrados del documento: cada subida repetía la historia
 * entera de borrados de la página. Acá están las cuentas para mandar solo los que el servidor no tiene.
 *
 * Los borrados se guardan como un update de Yjs sin elementos (solo el delete set): lo puede leer cualquier
 * versión de Yjs con `Y.decodeUpdate`.
 */

/** Tramos borrados por autor: `[desde, hasta)`, ordenados y sin solaparse. */
export type DeleteRanges = Map<number, [number, number][]>;

/** Ordena y junta los tramos de cada autor (los pegados o solapados quedan en uno). Saca los autores vacíos. */
export function normalizeRanges(ranges: DeleteRanges): DeleteRanges {
  const out: DeleteRanges = new Map();
  for (const [client, list] of ranges) {
    const sorted = list.filter(([from, to]) => to > from).sort((x, y) => x[0] - y[0]);
    const merged: [number, number][] = [];
    for (const [from, to] of sorted) {
      const last = merged[merged.length - 1];
      if (last && from <= last[1]) last[1] = Math.max(last[1], to);
      else merged.push([from, to]);
    }
    if (merged.length > 0) out.set(client, merged);
  }
  return out;
}

type DeleteSet = ReturnType<typeof Y.decodeUpdate>['ds'];

/** Los borrados de un delete set ya leído (`Y.decodeUpdate(...).ds`), normalizados. */
export function rangesOfDeleteSet(ds: DeleteSet): DeleteRanges {
  const ranges: DeleteRanges = new Map();
  for (const [client, items] of ds.clients) {
    ranges.set(client, items.map((item) => [item.clock, item.clock + item.len] as [number, number]));
  }
  return normalizeRanges(ranges);
}

/** Los borrados de un update (cualquiera: con elementos o sin ellos), ya normalizados. */
export function rangesOf(update: Uint8Array): DeleteRanges {
  return rangesOfDeleteSet(Y.decodeUpdate(update).ds);
}

/** Todo lo de `a` y todo lo de `b`. */
export function unionRanges(a: DeleteRanges, b: DeleteRanges): DeleteRanges {
  const out: DeleteRanges = new Map();
  for (const source of [a, b]) {
    for (const [client, list] of source) out.set(client, [...(out.get(client) ?? []), ...list.map((r) => [...r] as [number, number])]);
  }
  return normalizeRanges(out);
}

/** Lo de `a` que no está en `b`. Lineal en la cantidad de tramos (los dos se recorren una sola vez, en orden). */
export function subtractRanges(a: DeleteRanges, b: DeleteRanges): DeleteRanges {
  const out: DeleteRanges = new Map();
  const left = normalizeRanges(a);
  const right = normalizeRanges(b);
  for (const [client, list] of left) {
    const minus = right.get(client) ?? [];
    const rest: [number, number][] = [];
    let j = 0;
    for (const [from, to] of list) {
      // Los de `minus` que terminan antes de este tramo ya no tocan a ninguno de los siguientes.
      while (j < minus.length && minus[j][1] <= from) j++;
      let start = from;
      for (let k = j; k < minus.length && minus[k][0] < to; k++) {
        if (minus[k][0] > start) rest.push([start, minus[k][0]]);
        start = Math.max(start, minus[k][1]);
        if (start >= to) break;
      }
      if (start < to) rest.push([start, to]);
    }
    if (rest.length > 0) out.set(client, rest);
  }
  return out;
}

/** Si `inner` está entero adentro de `outer`. */
export function rangesContain(outer: DeleteRanges, inner: DeleteRanges): boolean {
  return subtractRanges(normalizeRanges(inner), normalizeRanges(outer)).size === 0;
}

function writeVarUint(out: number[], value: number): void {
  let n = value;
  while (n > 0x7f) {
    out.push(0x80 | (n & 0x7f));
    n = Math.floor(n / 128);
  }
  out.push(n);
}

/**
 * El delete set en formato v1, igual que lo escribe Yjs (`writeDeleteSet`): la cantidad de autores y, de
 * mayor a menor autor, cada uno con sus tramos `(reloj, largo)` en el orden dado.
 */
function deleteSetBytes(clients: [number, [number, number][]][]): number[] {
  const out: number[] = [];
  const sorted = [...clients].sort((x, y) => y[0] - x[0]);
  writeVarUint(out, sorted.length);
  for (const [client, list] of sorted) {
    writeVarUint(out, client);
    writeVarUint(out, list.length);
    for (const [clock, len] of list) {
      writeVarUint(out, clock);
      writeVarUint(out, len);
    }
  }
  return out;
}

/** Un update de Yjs sin elementos, solo con estos borrados (lo que se guarda en `DocState.syncedDS`). */
export function encodeRanges(ranges: DeleteRanges): Uint8Array {
  const clients = [...normalizeRanges(ranges)].map(
    ([client, list]) => [client, list.map(([from, to]) => [from, to - from] as [number, number])] as [number, [number, number][]],
  );
  return Uint8Array.from([0, ...deleteSetBytes(clients)]);
}

/**
 * Lo que hay que subir de un documento: los elementos que el servidor no tiene (`syncedSV`, como siempre) y
 * solo los borrados que no están en `known` (los que el servidor ya tiene, `DocState.syncedDS`). `ds` son los
 * borrados que lleva el update (para sumarlos a `syncedDS` cuando el servidor lo confirme).
 *
 * Si algo no cierra (el delete set que escribió Yjs no es el que se esperaba, o el resultado no se lee igual),
 * se sube el update entero, con todos los borrados, como antes: nunca se deja un borrado afuera.
 */
export function buildUpload(
  doc: Y.Doc,
  syncedSV: Uint8Array | undefined,
  known: Uint8Array | undefined,
): { update: Uint8Array; ds: Uint8Array; trimmed: boolean } {
  const full = Y.encodeStateAsUpdate(doc, syncedSV);
  const decoded = Y.decodeUpdate(full);
  const all = rangesOfDeleteSet(decoded.ds);
  const whole = { update: full, ds: encodeRanges(all), trimmed: false };
  if (!known) return whole;
  const knownRanges = rangesOf(known);
  const missing = subtractRanges(all, knownRanges);
  // El delete set de Yjs, tal cual lo leyó (mismo orden de tramos): tiene que ser el final exacto del update.
  const written = deleteSetBytes(
    [...decoded.ds.clients].map(([client, items]) => [client, items.map((i) => [i.clock, i.len] as [number, number])]),
  );
  const cut = full.length - written.length;
  if (cut < 1 || written.some((byte, i) => full[cut + i] !== byte)) return whole;
  const missingClients = [...missing].map(
    ([client, list]) => [client, list.map(([from, to]) => [from, to - from] as [number, number])] as [number, [number, number][]],
  );
  const tail = deleteSetBytes(missingClients);
  const update = new Uint8Array(cut + tail.length);
  update.set(full.subarray(0, cut), 0);
  update.set(tail, cut);
  // Comprobación: los mismos elementos que el update entero, y con lo que ya tiene el servidor, todos los borrados.
  try {
    const check = Y.decodeUpdate(update);
    const sameStructs =
      check.structs.length === decoded.structs.length &&
      Y.encodeStateVectorFromUpdate(update).join() === Y.encodeStateVectorFromUpdate(full).join();
    const checkRanges = rangesOfDeleteSet(check.ds);
    if (!sameStructs || !rangesContain(unionRanges(checkRanges, knownRanges), all) || !rangesContain(missing, checkRanges)) {
      return whole;
    }
  } catch {
    return whole;
  }
  return { update, ds: encodeRanges(missing), trimmed: true };
}
