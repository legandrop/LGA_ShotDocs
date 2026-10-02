import * as Y from 'yjs';
import { normalizeRanges, rangesContain, rangesOf, type DeleteRanges } from './deleteSets';

/**
 * Lo que este dispositivo escribió y todavía no había subido, y que quedó adentro de algo que otro borró
 * (roadmap B.16, Docs/Doc_Sincronizacion.md, "La subida sin GC"). Ejemplo: escribo en un bloque mientras otro
 * borra el bloque entero. El borrado gana en todos lados (es lo de siempre en Yjs), pero quien escribió se tiene
 * que enterar, y su texto tiene que llegar al servidor: desde B.16 la subida se arma sin GC y lo lleva, borrado.
 *
 * Se guarda en `meta` (una clave por página, ver `removedWritingKey`): las versiones anteriores de la app leen
 * `meta` solo por clave, así que no les cambia nada.
 */
export interface RemovedWriting {
  /** Cuándo llegó el borrado (ms desde 1970). */
  at: number;
  /** El texto, un renglón por bloque, en el orden de la página. */
  text: string;
  /** Los autores de Yjs (`clientID`) de lo que quedó borrado: para revisar un aviso, no se muestran. */
  clients?: number[];
}

export const REMOVED_WRITING_PREFIX = 'removedWriting:';
export function removedWritingKey(pageId: string): string {
  return `${REMOVED_WRITING_PREFIX}${pageId}`;
}
/** Cuántos avisos se guardan por página como mucho (los más nuevos). */
export const REMOVED_WRITING_KEEP = 20;

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
 * Lo propio que el cambio que llega (`incoming`) deja borrado sin nombrarlo: vivo antes, borrado después, y fuera
 * de los borrados de `incoming`. Quien borra nombra todo lo que tenía adentro de lo que borró (Yjs anota cada
 * elemento); lo que no nombra es lo que no había visto, y se borró solo porque se borró algo de lo que cuelga. Eso
 * es escribir y borrar a la vez, nunca un borrado de algo que el otro tenía a la vista.
 *
 * "Lo propio" es lo que el servidor no tiene (fuera de `syncedSV`: lo de este dispositivo que todavía no subió) y
 * lo de los autores de Yjs de `own` (cada apertura de la página en esta sesión de la app tiene el suyo): así el
 * aviso no depende de si la subida llegó antes o después que el borrado.
 *
 * Devuelve el texto (un renglón por bloque, en el orden de la página; una foto o un archivo, con su nombre entre
 * corchetes) y sus autores de Yjs, o `null` si no hay nada que leer. `rows` es lo guardado en el dispositivo, en
 * orden. Arma un documento sin GC, descartable.
 */
export function findRemovedWriting(
  rows: Uint8Array[],
  syncedSV: Uint8Array | undefined,
  incoming: Uint8Array,
  own: ReadonlySet<number> = new Set(),
): { text: string; clients: number[] } | null {
  const doc = new Y.Doc({ gc: false });
  try {
    applyRowsInOrder(doc, rows);
    const synced = syncedSV ? Y.decodeStateVector(syncedSV) : new Map<number, number>();
    // Lo propio que está vivo: tramos de relojes por autor.
    const alive: DeleteRanges = new Map();
    for (const [client, structs] of doc.store.clients) {
      const from = own.has(client) ? 0 : (synced.get(client) ?? 0);
      for (const struct of structs) {
        const end = struct.id.clock + struct.length;
        if (end <= from || !(struct instanceof Y.Item) || struct.deleted) continue;
        const list = alive.get(client) ?? [];
        list.push([Math.max(from, struct.id.clock), end]);
        alive.set(client, list);
      }
    }
    if (alive.size === 0) return null;
    const live = normalizeRanges(alive);
    const named = rangesOf(incoming);
    Y.applyUpdate(doc, incoming);

    const removed = new Set<Y.Item>();
    for (const [client, list] of live) {
      const structs = doc.store.clients.get(client) ?? [];
      for (const struct of structs) {
        if (!(struct instanceof Y.Item) || !struct.deleted) continue;
        const from = struct.id.clock;
        const to = from + struct.length;
        if (!list.some(([a, b]) => from < b && to > a)) continue;
        // Lo nombra el borrado que llega: el servidor ya lo tenía (por ejemplo, una subida que venció pero llegó).
        if (rangesContain(named, new Map([[client, [[from, to]]]]))) continue;
        removed.add(struct);
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
        if (item.content instanceof Y.ContentString) {
          if (removed.has(item)) line += item.content.str;
        } else if (item.content instanceof Y.ContentType) {
          if (line) lines.push(line);
          line = '';
          const child = item.content.type;
          if (removed.has(item)) {
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
    return text ? { text, clients: [...new Set([...removed].map((i) => i.id.client))] } : null;
  } finally {
    doc.destroy();
  }
}
