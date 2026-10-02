import * as Y from 'yjs';
import { normalizeRanges, rangesOf, subtractRanges, type DeleteRanges } from './deleteSets';

/**
 * Lo que este dispositivo escribió y que quedó adentro de algo que otro borró a la vez (roadmap B.16,
 * Docs/Doc_Sincronizacion.md, "La subida sin GC"). Ejemplo: escribo en un bloque mientras otro borra el bloque
 * entero. El borrado gana en todos lados (es lo de siempre en Yjs), pero quien escribió se tiene que enterar, y su
 * texto tiene que llegar al servidor: desde B.16 la subida se arma sin GC y lo lleva, borrado.
 *
 * Se guarda en `meta` (una clave por página, ver `removedWritingKey`): las versiones anteriores de la app leen
 * `meta` solo por clave, así que no les cambia nada.
 */
export interface RemovedWriting {
  /** Cuándo llegó el borrado (ms desde 1970). */
  at: number;
  /** El texto, un renglón por bloque, en el orden de la página. */
  text: string;
  /**
   * Los tramos de relojes de Yjs que quedaron borrados, `[autor, desde, hasta)`: para revisar un aviso, no se
   * muestran.
   */
  ranges?: [number, number, number][];
}

export const REMOVED_WRITING_PREFIX = 'removedWriting:';
export function removedWritingKey(pageId: string): string {
  return `${REMOVED_WRITING_PREFIX}${pageId}`;
}
/** Cuántos avisos se guardan por página como mucho (los más nuevos). */
export const REMOVED_WRITING_KEEP = 20;

/**
 * Los autores de Yjs (`clientID`) que escribieron en la página desde este dispositivo: una clave en `meta` por
 * autor, `ownClient:<página>:<autor>`, que se pone en la misma transacción que su primera edición guardada (sin
 * leer nada antes). Así "lo propio" se sabe también después de cerrar la app o de restaurar una copia, sin
 * suponer nada por lo que el servidor tiene. Las versiones anteriores no las ponen: lo escrito con ellas no avisa.
 */
export const OWN_CLIENT_PREFIX = 'ownClient:';
export function ownClientKey(pageId: string, client: number): string {
  return `${OWN_CLIENT_PREFIX}${pageId}:${client}`;
}
export function ownClientRange(pageId: string): IDBKeyRange {
  return IDBKeyRange.bound(`${OWN_CLIENT_PREFIX}${pageId}:`, `${OWN_CLIENT_PREFIX}${pageId}:￿`);
}
export function clientOfKey(key: IDBValidKey): number {
  return Number(String(key).slice(String(key).lastIndexOf(':') + 1));
}

/** Aplica lo guardado en un documento sin GC, fila por fila y en orden (gana la primera copia de cada elemento). */
export function applyRowsInOrder(doc: Y.Doc, rows: Uint8Array[], origin?: unknown): void {
  if (rows.length === 0) return;
  Y.transact(
    doc,
    () => {
      for (const row of rows) Y.applyUpdate(doc, row);
    },
    origin,
  );
}

/**
 * Las filas juntadas en una sola, armada en orden y sin GC (para compactar lo guardado en el dispositivo): conserva
 * el texto de lo borrado y, si dos filas traen el mismo elemento (una con su texto y otra como hueco), queda la
 * primera, la que se guardó al escribirlo. `Y.mergeUpdates` puede quedarse con el hueco.
 */
export function mergeRowsInOrder(rows: Uint8Array[]): Uint8Array {
  const doc = new Y.Doc({ gc: false });
  try {
    applyRowsInOrder(doc, rows);
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}

/** Lo de `a` que también está en `b` (tramos normalizados). */
function intersect(a: [number, number][], b: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [x, y] of a) {
    for (const [p, q] of b) {
      const from = Math.max(x, p);
      const to = Math.min(y, q);
      if (from < to) out.push([from, to]);
    }
  }
  return out;
}

/**
 * Lo propio que el cambio que llega (`incoming`) deja borrado sin nombrarlo: vivo antes, borrado después, y fuera
 * de los borrados de `incoming`. Quien borra nombra todo lo que tenía adentro de lo que borró (Yjs anota cada
 * elemento); lo que no nombra es lo que no había visto, y se borró solo porque se borró algo de lo que cuelga. Eso
 * es escribir y borrar a la vez, nunca un borrado de algo que el otro tenía a la vista. Se mira letra por letra
 * (por relojes): Yjs junta en un solo elemento lo escrito seguido, y una parte puede estar nombrada (el otro la
 * vio) y otra no.
 *
 * "Lo propio" es solo lo de los autores de Yjs de `own` (ver `ownClientKey`): si no se sabe que algo es de este
 * dispositivo, no se avisa (mejor no avisar que avisar con texto ajeno).
 *
 * Devuelve el texto (un renglón por bloque, en el orden de la página; una foto o un archivo, con su nombre entre
 * corchetes) y los tramos de relojes, o `null` si no hay nada que leer. `rows` es lo guardado en el dispositivo, en
 * orden. Arma un documento sin GC, descartable.
 */
export function findRemovedWriting(
  rows: Uint8Array[],
  incoming: Uint8Array,
  own: ReadonlySet<number>,
): { text: string; ranges: [number, number, number][] } | null {
  if (own.size === 0) return null;
  const doc = new Y.Doc({ gc: false });
  try {
    applyRowsInOrder(doc, rows);
    // Lo propio que está vivo: tramos de relojes por autor.
    const alive: DeleteRanges = new Map();
    for (const client of own) {
      for (const struct of doc.store.clients.get(client) ?? []) {
        if (!(struct instanceof Y.Item) || struct.deleted) continue;
        const list = alive.get(client) ?? [];
        list.push([struct.id.clock, struct.id.clock + struct.length]);
        alive.set(client, list);
      }
    }
    if (alive.size === 0) return null;
    // Lo vivo menos lo que nombra el borrado que llega (eso el otro lo tenía a la vista).
    const candidates = subtractRanges(normalizeRanges(alive), rangesOf(incoming));
    if (candidates.size === 0) return null;
    Y.applyUpdate(doc, incoming);

    // Por elemento, los tramos (absolutos) que quedaron borrados.
    const removed = new Map<Y.Item, [number, number][]>();
    const ranges: [number, number, number][] = [];
    for (const [client, list] of candidates) {
      for (const struct of doc.store.clients.get(client) ?? []) {
        if (!(struct instanceof Y.Item) || !struct.deleted) continue;
        const parts = intersect([[struct.id.clock, struct.id.clock + struct.length]], list);
        if (parts.length === 0) continue;
        removed.set(struct, parts);
        for (const [from, to] of parts) ranges.push([client, from, to]);
      }
    }
    if (removed.size === 0) return null;

    const lines: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const attr = (type: Y.AbstractType<any>, key: string): string | undefined => {
      const value = type._map.get(key)?.content.getContent()[0];
      return typeof value === 'string' && value ? value : undefined;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walk = (type: Y.AbstractType<any>) => {
      let line = '';
      for (let item = type._start; item; item = item.right) {
        const parts = removed.get(item);
        if (item.content instanceof Y.ContentString) {
          const str = item.content.str;
          for (const [from, to] of parts ?? []) line += str.slice(from - item.id.clock, to - item.id.clock);
        } else if (item.content instanceof Y.ContentType) {
          if (line) lines.push(line);
          line = '';
          const child = item.content.type;
          if (parts) {
            const name = attr(child, 'name') ?? attr(child, 'url');
            if (name) lines.push(`[${name}]`);
          }
          walk(child);
        }
      }
      if (line) lines.push(line);
    };
    for (const type of doc.share.values()) walk(type);
    const text = lines.filter((l) => l.trim()).join('\n');
    return text ? { text, ranges } : null;
  } finally {
    doc.destroy();
  }
}
