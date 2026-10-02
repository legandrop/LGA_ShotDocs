import * as Y from 'yjs';
import type { HistoryRemote } from './remote';
import { CONTENT_FRAGMENT, normalizeStructure } from './structure';
import { RemoteError, REQUEST_TIMEOUT } from './types';

// El historial de versiones de una página (P.18, Docs/Doc_Historial.md). Todo se arma en el dispositivo con las
// filas de `page_updates` (autor y hora puestos por la base), sin guardar nada nuevo:
//
// - **El documento del historial**: las filas aplicadas EN ORDEN en un `Y.Doc` sin GC. Así cada elemento queda con el
//   contenido de la primera fila que lo trae (la que tenía el texto). `Y.mergeUpdates` no sirve: algunas filas
//   vuelven a subir el documento entero desde un dispositivo con GC, con lo borrado como hueco, y la mezcla se queda
//   con el hueco (sección 3.2: con las filas reales, 37 de 63 versiones salían mal).
// - **Una versión**: un `Y.snapshot` (vector y borrados acumulados hasta su última fila), armado con lo que dice cada
//   fila (`parseUpdateMeta` y su delete set) sin integrar nada; su contenido sale con `Y.createDocFromSnapshot`.
// - **Quién**: cada tramo de relojes de Yjs es de quien subió la primera fila que lo trae; cada borrado, igual.
// - **Sesiones**: filas seguidas con menos de 30 minutos entre una y otra. Una fila que no cambia nada de la página
//   (una subida entera repetida, o solo el mapa de colapsar) no suma autores; una sesión sin cambios se junta con la
//   de antes.

/** La versión de la base con `page_history` y `page_history_authors` (20261007120000_historial.sql). */
export const HISTORY_SCHEMA_VERSION = 11;

/** Corte entre sesiones de edición. */
export const SESSION_GAP_MS = 30 * 60_000;

/** Lo más grande que se ofrece restaurar (la mitad del tope de 8 MB de una subida; Doc_Historial.md, 1.4). */
export const MAX_RESTORE_BYTES = 4 * 1024 * 1024;

/** El mapa de colapsar para todos (Doc_Colapsar.md, sección 4): una vista, no contenido. */
const SHARED_COLLAPSE_MAP = 'collapsedHeadings';

/** Una fila de `page_history`. */
export interface HistoryRow {
  /** `page_updates.id`: el contador que nunca vuelve atrás. */
  id: number;
  seq: number;
  /** Quién la subió (lo pone la base); `null` si se borró la cuenta. */
  createdBy: string | null;
  /** Cuándo llegó al servidor (ISO). */
  createdAt: string;
  data: Uint8Array;
}

export interface HistorySession {
  /** Fila primera y última (índices en `rows`). */
  first: number;
  last: number;
  /** El `seq` de la última fila: la versión es el estado después de ella. */
  seq: number;
  start: string;
  end: string;
  /** Quiénes cambiaron algo en esta sesión, en orden de aparición (`null`: una cuenta borrada). */
  authors: (string | null)[];
}

/** Hasta qué reloj llega cada autor de Yjs en la fila y qué borra, sin integrarla. */
interface RowMeta {
  from: Map<number, number>;
  to: Map<number, number>;
  ds: ReturnType<typeof Y.createDeleteSet>;
}

/** Tramos de relojes por autor de Yjs, cada uno con la fila que lo trajo primero. */
export class RangeIndex {
  private readonly by = new Map<number, [number, number, number][]>();

  /** Suma lo no cubierto de `[from, to)` a nombre de `row`. Devuelve si sumó algo. */
  add(client: number, from: number, to: number, row: number): [number, number][] {
    if (to <= from) return [];
    let list = this.by.get(client);
    if (!list) this.by.set(client, (list = []));
    const added: [number, number][] = [];
    let cur = from;
    for (const [a, b] of list.filter(([a, b]) => a < to && b > from).sort((x, y) => x[0] - y[0])) {
      if (a > cur) added.push([cur, a]);
      cur = Math.max(cur, b);
    }
    if (cur < to) added.push([cur, to]);
    for (const [a, b] of added) list.push([a, b, row]);
    list.sort((x, y) => x[0] - y[0]);
    return added;
  }

  /** La fila dueña de ese reloj, o -1. */
  find(client: number, clock: number): number {
    const list = this.by.get(client);
    if (!list) return -1;
    let lo = 0;
    let hi = list.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const [a, b, r] = list[mid];
      if (clock < a) hi = mid - 1;
      else if (clock >= b) lo = mid + 1;
      else return r;
    }
    return -1;
  }
}

/** La clave del tipo raíz de un elemento (`document-store`, `collapsedHeadings`…), o `null` si no se sabe. */
function rootKey(item: Y.Item): string | null {
  let type = item.parent as Y.AbstractType<unknown> | null;
  while (type && type._item) type = type._item.parent as Y.AbstractType<unknown> | null;
  if (!type || !type.doc) return null;
  try {
    return Y.findRootTypeKey(type);
  } catch {
    return null;
  }
}

/** Si algún elemento de `[from, to)` del autor `client` es del contenido de la página (no un hueco, no el colapsar). */
function touchesContent(doc: Y.Doc, client: number, from: number, to: number): boolean {
  const list = doc.store.clients.get(client);
  if (!list || list.length === 0) return false;
  const last = list[list.length - 1];
  if (from >= last.id.clock + last.length) return false;
  let i = Y.findIndexSS(list, Math.max(from, list[0].id.clock));
  for (; i < list.length && list[i].id.clock < to; i++) {
    const s = list[i];
    if (s instanceof Y.Item && rootKey(s) === CONTENT_FRAGMENT) return true;
  }
  return false;
}

export class PageHistory {
  /** Las filas, en orden de `seq`. */
  readonly rows: HistoryRow[];
  /** El documento del historial: todas las filas aplicadas en orden, sin GC. */
  readonly doc: Y.Doc;
  readonly sessions: HistorySession[];
  private readonly metas: RowMeta[];
  private readonly inserts = new RangeIndex();
  private readonly deletes = new RangeIndex();
  /** Si la fila cambió algo del contenido que ninguna anterior traía. */
  private readonly contributes: boolean[];
  private readonly snapshots = new Map<number, Y.Snapshot>();
  /** Filas que esta versión de Yjs no pudo leer (las saltea: lo dice la pantalla). */
  readonly unreadable: number[] = [];

  constructor(rows: HistoryRow[], gapMs = SESSION_GAP_MS) {
    this.rows = [...rows].sort((a, b) => a.seq - b.seq);
    this.doc = new Y.Doc({ gc: false });
    this.metas = [];
    for (const [i, row] of this.rows.entries()) {
      try {
        const { from, to } = Y.parseUpdateMeta(row.data);
        const { ds } = Y.decodeUpdate(row.data);
        Y.applyUpdate(this.doc, row.data);
        this.metas.push({ from, to, ds });
      } catch {
        this.unreadable.push(i);
        this.metas.push({ from: new Map(), to: new Map(), ds: Y.createDeleteSet() });
      }
    }
    // Quién trajo cada tramo por primera vez, y si eso tocó el contenido.
    this.contributes = this.metas.map((m, i) => {
      let touched = false;
      for (const [client, to] of m.to) {
        for (const [a, b] of this.inserts.add(client, m.from.get(client) ?? 0, to, i)) {
          if (!touched && touchesContent(this.doc, client, a, b)) touched = true;
        }
      }
      for (const [client, items] of m.ds.clients) {
        for (const it of items) {
          for (const [a, b] of this.deletes.add(client, it.clock, it.clock + it.len, i)) {
            if (!touched && touchesContent(this.doc, client, a, b)) touched = true;
          }
        }
      }
      return touched;
    });
    this.sessions = this.group(gapMs);
    this.buildSnapshots();
  }

  private group(gapMs: number): HistorySession[] {
    const raw: { first: number; last: number }[] = [];
    this.rows.forEach((row, i) => {
      const prev = raw[raw.length - 1];
      if (prev && Date.parse(row.createdAt) - Date.parse(this.rows[i - 1].createdAt) <= gapMs) prev.last = i;
      else raw.push({ first: i, last: i });
    });
    // Una sesión sin cambios en el contenido se junta con la anterior (o, si es la primera, con la siguiente).
    const merged: { first: number; last: number }[] = [];
    for (const s of raw) {
      const changed = this.contributes.slice(s.first, s.last + 1).some(Boolean);
      const prev = merged[merged.length - 1];
      if (!changed && prev) prev.last = s.last;
      else if (prev && !this.contributes.slice(prev.first, prev.last + 1).some(Boolean)) prev.last = s.last;
      else merged.push({ ...s });
    }
    return merged.map(({ first, last }) => {
      const authors: (string | null)[] = [];
      for (let i = first; i <= last; i++) {
        if (this.contributes[i] && !authors.includes(this.rows[i].createdBy)) authors.push(this.rows[i].createdBy);
      }
      return {
        first,
        last,
        seq: this.rows[last].seq,
        start: this.rows[first].createdAt,
        end: this.rows[last].createdAt,
        authors,
      };
    });
  }

  /** Los snapshots del final de cada sesión, acumulando los metadatos de las filas una sola vez. */
  private buildSnapshots(): void {
    const ends = new Set(this.sessions.map((s) => s.last));
    const sv = new Map<number, number>();
    let parts: ReturnType<typeof Y.createDeleteSet>[] = [];
    this.metas.forEach((m, i) => {
      for (const [client, to] of m.to) if ((sv.get(client) ?? 0) < to) sv.set(client, to);
      parts.push(m.ds);
      if (ends.has(i)) {
        const ds = Y.mergeDeleteSets(parts);
        parts = [ds];
        this.snapshots.set(i, Y.createSnapshot(ds, new Map(sv)));
      }
    });
  }

  /** El snapshot de la versión al final de la sesión `index`. */
  snapshot(index: number): Y.Snapshot {
    return this.snapshots.get(this.sessions[index].last)!;
  }

  /**
   * El documento de la versión `index`: uno nuevo, en memoria, con el contenido de entonces, la estructura reparada
   * solo en memoria (una página vieja con dos raíces) y sin el mapa de colapsar (en el historial todo se ve abierto).
   * Nunca se sube ni se guarda.
   */
  version(index: number): Y.Doc {
    const doc = Y.createDocFromSnapshot(this.doc, this.snapshot(index));
    const collapse = doc.getMap(SHARED_COLLAPSE_MAP);
    if (collapse.size > 0) doc.transact(() => collapse.clear());
    normalizeStructure(doc, 'history');
    return doc;
  }

  /** Quién trajo ese elemento (un id de Yjs), o `undefined` si ninguna fila lo trae. */
  authorOf(client: number, clock: number): string | null | undefined {
    const row = this.inserts.find(client, clock);
    return row < 0 ? undefined : this.rows[row].createdBy;
  }

  /** Quién lo borró, o `undefined` si ninguna fila lo borra. */
  deleterOf(client: number, clock: number): string | null | undefined {
    const row = this.deletes.find(client, clock);
    return row < 0 ? undefined : this.rows[row].createdBy;
  }

  /** Todas las personas del historial, en orden de aparición (para los colores). */
  people(): (string | null)[] {
    const out: (string | null)[] = [];
    for (const s of this.sessions) for (const a of s.authors) if (!out.includes(a)) out.push(a);
    return out;
  }

  destroy(): void {
    this.doc.destroy();
  }
}

// --- Lo que se compara al ver y al restaurar ----------------------------------------------------------------------

/**
 * Lo que tiene que sobrevivir a la ida y vuelta: los ids de los bloques en orden, cuánto texto hay y cuántos nodos
 * (cada elemento de Yjs es un nodo de ProseMirror: bloques, contenidos, fotos en línea).
 */
export interface ContentShape {
  ids: string[];
  text: number;
  nodes: number;
}

/** La forma del contenido de un documento de Yjs. */
export function yShape(doc: Y.Doc): ContentShape {
  const ids: string[] = [];
  let text = 0;
  let nodes = 0;
  const walk = (t: Y.XmlFragment | Y.XmlElement) => {
    for (const child of t.toArray()) {
      if (child instanceof Y.XmlText) {
        for (const op of child.toDelta() as { insert: unknown }[]) if (typeof op.insert === 'string') text += op.insert.length;
      } else if (child instanceof Y.XmlElement) {
        nodes++;
        if (child.nodeName === 'blockContainer') ids.push(String(child.getAttribute('id') ?? ''));
        walk(child);
      }
    }
  };
  walk(doc.getXmlFragment(CONTENT_FRAGMENT));
  return { ids, text, nodes };
}

/** Si dos formas coinciden. */
export function sameShape(a: ContentShape, b: ContentShape): boolean {
  return a.text === b.text && a.nodes === b.nodes && a.ids.length === b.ids.length && a.ids.every((id, i) => id === b.ids[i]);
}

/** Lo que pesaría el contenido de una versión (para no ofrecer restaurar algo más grande que una subida). */
export function versionBytes(doc: Y.Doc): number {
  return Y.encodeStateAsUpdate(doc).byteLength;
}

// --- Bajar el historial ---------------------------------------------------------------------------------------------

/** Lo que baja la pantalla del historial: las filas y los correos de sus autores. */
export interface LoadedHistory {
  rows: HistoryRow[];
  emails: Map<string, string>;
}

/**
 * Baja el historial entero de una página, de a lotes. Como la bajada de la sincronización: si un lote vence, pide uno
 * más chico (50, 5, 1); de a uno tiene el tope más largo. Solo lee: no toca nada del dispositivo ni del servidor.
 */
export async function loadPageHistory(
  remote: HistoryRemote,
  pageId: string,
  onProgress?: (rows: number) => void,
  isCancelled: () => boolean = () => false,
): Promise<LoadedHistory> {
  const rows: HistoryRow[] = [];
  const sizes = [500, 50, 5, 1];
  let size = 0;
  for (;;) {
    if (isCancelled()) throw new Error('cancelled');
    let batch: HistoryRow[];
    try {
      batch = await remote.pageHistory(pageId, rows.length ? rows[rows.length - 1].seq : 0, sizes[size]);
    } catch (err) {
      if (err instanceof RemoteError && err.message === REQUEST_TIMEOUT && size < sizes.length - 1) {
        size++;
        continue;
      }
      throw err;
    }
    rows.push(...batch);
    onProgress?.(rows.length);
    if (batch.length < sizes[size]) break;
  }
  const authors = await remote.pageHistoryAuthors(pageId);
  return { rows, emails: new Map(authors.map((a) => [a.user_id, a.email])) };
}
