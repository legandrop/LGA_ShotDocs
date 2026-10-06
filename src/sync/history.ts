import * as Y from 'yjs';
import type { HistoryRemote } from './remote';
import { CONTENT_FRAGMENT, normalizeStructure, seedClientId, seedTextClientId } from './structure';
import { RemoteError, REQUEST_TIMEOUT } from './types';
import { PHOTO_MARKUP_MAP, parseMarkupKey } from '../media/markup';

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

/**
 * La versión de la base con `page_versions` (20261011120000_versiones_con_nombre.sql): nombrar versiones y las marcas
 * de restauración. Con una base anterior, el historial anda igual, sin nombres.
 */
export const NAMED_VERSIONS_SCHEMA_VERSION = 13;

/** Corte entre sesiones de edición. */
export const SESSION_GAP_MS = 30 * 60_000;

/** Lo más grande que se ofrece restaurar (la mitad del tope de 8 MB de una subida; Doc_Historial.md, 1.4). */
export const MAX_RESTORE_BYTES = 4 * 1024 * 1024;

/** El mapa de colapsar para todos (Doc_Colapsar.md, sección 4): una vista, no contenido. */
const SHARED_COLLAPSE_MAP = 'collapsedHeadings';

/**
 * Quién escribió una fila que entró por un link público (Docs/Doc_Link_Publico.md, E2.8): en `createdBy` va el nombre
 * que escribió el visitante con este prefijo (una cuenta nunca tiene un id así), y la app lo muestra con "(via link)".
 */
export const LINK_AUTHOR_PREFIX = 'via-link:';

export function linkAuthorKey(name: string): string {
  return LINK_AUTHOR_PREFIX + name;
}

/** El nombre del visitante si `createdBy` es de un link, o `null`. */
export function linkAuthorName(createdBy: string | null | undefined): string | null {
  return createdBy?.startsWith(LINK_AUTHOR_PREFIX) ? createdBy.slice(LINK_AUTHOR_PREFIX.length) : null;
}

/** Una fila de `page_history`. */
export interface HistoryRow {
  /** `page_updates.id`: el contador que nunca vuelve atrás. */
  id: number;
  seq: number;
  /**
   * Quién la subió (lo pone la base); `null` si se borró la cuenta. Una fila que entró por un link: `linkAuthorKey` del
   * nombre del visitante.
   */
  createdBy: string | null;
  /** Cuándo llegó al servidor (ISO). */
  createdAt: string;
  data: Uint8Array;
}

/**
 * Un nombre de versión (`named`) o una marca de restauración (`restore`: la fila `seq` subió una restauración de la
 * versión que terminaba en `restoredFromSeq`). Sale de `list_page_versions`; apunta a una fila, sin contenido.
 */
export interface PageVersionRow {
  id: string;
  seq: number;
  kind: 'named' | 'restore';
  label: string | null;
  restoredFromSeq: number | null;
  createdBy: string | null;
  createdAt: string;
}

/**
 * Dónde se cortan las sesiones además del corte de 30 minutos: después de cada versión con nombre (lo que se escriba
 * después ya no entra en ella) y antes de cada restauración (la versión de antes de restaurar queda en la lista).
 */
export function versionBreaks(versions: readonly PageVersionRow[]): { after: number[]; before: number[] } {
  return {
    after: versions.filter((v) => v.kind === 'named').map((v) => v.seq),
    before: versions.filter((v) => v.kind === 'restore').map((v) => v.seq),
  };
}

/**
 * La huella de una restauración: los tramos `[autor de Yjs, desde, largo]` que agregó y los que borró (el paso de
 * deshacer que dejó en el editor). Sirve para reconocer la fila que la subió (`rowHasTrace`) y no marcar *Restored
 * from…* sobre otra edición (una restauración deshecha antes de subir, otro dispositivo de la misma persona).
 */
export interface RestoreTrace {
  ins: [number, number, number][];
  del: [number, number, number][];
}

/** Tope de tramos que se guardan de cada lado (alcanza con uno para reconocer la fila). */
const TRACE_MAX = 200;

type DeleteSetLike = { clients: Map<number, { clock: number; len: number }[]> };

/** La huella a partir de lo agregado y lo borrado (dos delete sets, como los de un paso de deshacer de Yjs). */
export function traceFromSets(insertions: DeleteSetLike, deletions: DeleteSetLike): RestoreTrace {
  const flat = (ds: DeleteSetLike) => {
    const out: [number, number, number][] = [];
    for (const [client, items] of ds.clients) for (const it of items) if (out.length < TRACE_MAX) out.push([client, it.clock, it.len]);
    return out;
  };
  return { ins: flat(insertions), del: flat(deletions) };
}

/** Si la fila trae algo de esa restauración (lo agregado o lo borrado), sin integrarla. */
export function rowHasTrace(data: Uint8Array, trace: RestoreTrace): boolean {
  try {
    const { from, to } = Y.parseUpdateMeta(data);
    for (const [client, clock, len] of trace.ins) {
      const a = from.get(client);
      const b = to.get(client);
      if (a !== undefined && b !== undefined && clock < b && clock + len > a) return true;
    }
    if (trace.del.length === 0) return false;
    const { ds } = Y.decodeUpdate(data);
    for (const [client, clock, len] of trace.del) {
      for (const it of ds.clients.get(client) ?? []) if (it.clock < clock + len && it.clock + it.len > clock) return true;
    }
  } catch {
    return false;
  }
  return false;
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
  /** Sesión solo de anotaciones; nombre inequívoco en su snapshot, o rótulo genérico. */
  annotation?: { name: string | null };
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

interface RowChanges {
  content: boolean;
  markup: boolean;
  subjects: Set<string>;
  unknown: boolean;
}

/** Clasifica los tramos frescos con el documento ya integrado, sin volver a adjudicar sus relojes. */
function classifyRange(doc: Y.Doc, client: number, from: number, to: number, out: RowChanges): void {
  const list = doc.store.clients.get(client);
  if (!list || list.length === 0) return;
  const last = list[list.length - 1];
  if (from >= last.id.clock + last.length) return;
  let i = Y.findIndexSS(list, Math.max(from, list[0].id.clock));
  for (; i < list.length && list[i].id.clock < to; i++) {
    const s = list[i];
    if (!(s instanceof Y.Item)) continue;
    const root = rootKey(s);
    if (root === CONTENT_FRAGMENT) out.content = true;
    if (root === PHOTO_MARKUP_MAP) {
      out.markup = true;
      let key = s.parentSub;
      let type = s.parent as Y.AbstractType<unknown>;
      while (type._item) {
        key = type._item.parentSub;
        type = type._item.parent as Y.AbstractType<unknown>;
      }
      const subject = key === null ? null : parseMarkupKey(key);
      if (subject) out.subjects.add(subject.fileId.toLowerCase());
      else out.unknown = true;
    }
  }
}

/** Nombre de una única referencia lógica, leído en el final histórico de la sesión (no en el estado actual).
 * typeListToArraySnapshot es el export @private de Yjs 13.6.33 fijado por el lockfile. */
function annotationName(doc: Y.Doc, snapshot: Y.Snapshot, subject: string): string | null {
  const names = new Set<string>();
  const walk = (type: Y.XmlFragment | Y.XmlElement) => {
    for (const child of Y.typeListToArraySnapshot(type, snapshot)) {
      if (!(child instanceof Y.XmlElement)) continue;
      const attrs = child.getAttributes(snapshot);
      if (typeof attrs.url === 'string' && attrs.url.startsWith('sdmedia://') && attrs.url.slice(10).toLowerCase() === subject) {
        names.add(typeof attrs.name === 'string' ? attrs.name.trim() : '');
      }
      walk(child);
    }
  };
  walk(doc.getXmlFragment(CONTENT_FRAGMENT));
  return names.size === 1 ? [...names][0] || null : null;
}

/** Lo que una fila trajo por primera vez: tramos `[cliente, desde, hasta)` agregados y borrados. */
export interface RowFresh {
  ins: [number, number, number][];
  del: [number, number, number][];
}

/**
 * Texto huérfano (Docs/Doc_Historial.md, 5.4): lo que alguien escribió en algo que ya estaba borrado cuando su fila
 * llegó (otro lo había borrado, o restauró una versión sin eso). Yjs lo integra ya borrado: no se ve en ninguna versión.
 * Se muestra aparte, en la versión de la fila que lo trajo.
 */
export interface HistoryOrphan {
  /** La fila que lo trajo (índice en `rows`). */
  row: number;
  text: string;
  /** El bloque donde se escribió (su id), si se sabe. */
  blockId: string | null;
  /** Sus letras: tramos `[autor de Yjs, desde, hasta)`. */
  ranges: [number, number, number][];
}

interface Place {
  /** Si él o algo de arriba se borró en una fila anterior a la que se está mirando. */
  removed: boolean;
  /** Si es del contenido de la página (no el mapa de colapsar). */
  content: boolean;
  blockId: string | null;
}

/** El id de un bloque aunque esté borrado (sin GC, el valor sigue en el documento). */
function rawId(el: Y.XmlElement): string | null {
  const item = el._map.get('id');
  if (!item || item.content instanceof Y.ContentDeleted) return null;
  const values = item.content.getContent();
  const v = values[values.length - 1];
  return v === undefined || v === null || v === '' ? null : String(v);
}

export class PageHistory {
  /** Las filas, en orden de `seq`. */
  readonly rows: HistoryRow[] = [];
  /** El documento del historial: todas las filas aplicadas en orden, sin GC. */
  readonly doc: Y.Doc;
  readonly generation = crypto.randomUUID();
  revision = 0;
  sessions: HistorySession[] = [];
  private readonly metas: RowMeta[] = [];
  private readonly inserts = new RangeIndex();
  private readonly deletes = new RangeIndex();
  /** Si la fila cambió algo del contenido que ninguna anterior traía. */
  private contributes: boolean[] = [];
  private changes: RowChanges[] = [];
  /** Lo que trajo cada fila por primera vez (para la diferencia solo de lo tocado). */
  readonly fresh: RowFresh[] = [];
  private readonly snapshots = new Map<number, Y.Snapshot>();
  /** Filas que esta versión de Yjs no pudo leer (las saltea: lo dice la pantalla). */
  readonly unreadable: number[] = [];
  /** El texto huérfano, en orden de fila. */
  readonly orphans: HistoryOrphan[] = [];
  /** Los autores de Yjs de la semilla (estructura vacía, igual en todos los dispositivos: no se marca). */
  readonly seedClients: ReadonlySet<number>;
  private readonly gapMs: number;
  /** Cortes forzados (ver `versionBreaks`): después de estas filas y antes de estas (por `seq`). */
  private breakAfter = new Set<number>();
  private breakBefore = new Set<number>();

  constructor(rows: readonly HistoryRow[], gapMs = SESSION_GAP_MS, pageId?: string) {
    this.doc = new Y.Doc({ gc: false });
    this.doc.on('update', () => { this.revision++; });
    this.gapMs = gapMs;
    this.seedClients = new Set(pageId ? [seedClientId(pageId), seedTextClientId(pageId)] : []);
    this.append(rows);
  }

  /**
   * Suma filas nuevas (las de `seq` mayor al último que ya tiene; las demás se ignoran) y vuelve a armar las sesiones
   * y los snapshots. Lo de antes no cambia: el documento solo crece y cada tramo sigue con la fila que lo trajo primero.
   * Devuelve cuántas sumó.
   */
  append(rows: readonly HistoryRow[]): number {
    this.revision++;
    const lastSeq = this.rows.length ? this.rows[this.rows.length - 1].seq : -Infinity;
    const fresh = rows.filter((r) => r.seq > lastSeq).sort((a, b) => a.seq - b.seq);
    if (fresh.length === 0 && this.rows.length > 0) return 0;
    const start = this.rows.length;
    for (const row of fresh) {
      const i = this.rows.length;
      this.rows.push(row);
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
    // Quién trajo cada tramo por primera vez, si eso tocó el contenido, y el texto huérfano.
    for (let i = start; i < this.metas.length; i++) {
      const m = this.metas[i];
      const got: RowFresh = { ins: [], del: [] };
      for (const [client, to] of m.to) {
        for (const [a, b] of this.inserts.add(client, m.from.get(client) ?? 0, to, i)) {
          got.ins.push([client, a, b]);
        }
      }
      // Antes de sumar los borrados de esta fila: huérfano es lo que llegó a algo borrado por una fila ANTERIOR.
      this.findOrphans(i, got.ins);
      for (const [client, items] of m.ds.clients) {
        for (const it of items) {
          for (const [a, b] of this.deletes.add(client, it.clock, it.clock + it.len, i)) {
            got.del.push([client, a, b]);
          }
        }
      }
      this.fresh.push(got);
    }
    // Una dependencia tardía puede integrar tramos de filas anteriores: reemplazar todos los derivados, no unirlos.
    this.changes = this.fresh.map((got) => {
      const out: RowChanges = { content: false, markup: false, subjects: new Set(), unknown: false };
      for (const [client, from, to] of [...got.ins, ...got.del]) classifyRange(this.doc, client, from, to, out);
      return out;
    });
    this.contributes = this.changes.map((c) => c.content || c.markup);
    this.sessions = this.group(this.gapMs);
    this.snapshots.clear();
    this.buildSnapshots();
    return fresh.length;
  }

  /**
   * Los cortes de las versiones con nombre y de las restauraciones (`versionBreaks`). Vuelve a armar las sesiones y los
   * snapshots si cambiaron; devuelve si cambiaron.
   */
  setBreaks(after: Iterable<number>, before: Iterable<number>): boolean {
    this.revision++;
    const a = new Set(after);
    const b = new Set(before);
    const same = (x: Set<number>, y: Set<number>) => x.size === y.size && [...x].every((v) => y.has(v));
    if (same(a, this.breakAfter) && same(b, this.breakBefore)) return false;
    this.breakAfter = a;
    this.breakBefore = b;
    this.sessions = this.group(this.gapMs);
    this.snapshots.clear();
    this.buildSnapshots();
    return true;
  }

  /** La fila (índice) que trajo ese elemento, o -1. */
  insertRow(client: number, clock: number): number {
    return this.inserts.find(client, clock);
  }

  /** La fila (índice) que trajo el borrado de ese elemento, o -1. */
  deleteRow(client: number, clock: number): number {
    return this.deletes.find(client, clock);
  }

  /** La sesión (índice) de una fila, o -1. */
  sessionOfRow(row: number): number {
    let lo = 0;
    let hi = this.sessions.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const s = this.sessions[mid];
      if (row < s.first) hi = mid - 1;
      else if (row > s.last) lo = mid + 1;
      else return mid;
    }
    return -1;
  }

  /** El texto huérfano que llegó en la sesión `index`. */
  orphansOf(index: number): HistoryOrphan[] {
    const s = this.sessions[index];
    return s ? this.orphans.filter((o) => o.row >= s.first && o.row <= s.last) : [];
  }

  /**
   * El texto que trajo la fila `row` adentro de algo que una fila anterior ya había borrado (5.4). Se junta por texto
   * de Yjs: lo escrito en el mismo renglón es un solo pedazo. Solo cuenta lo que llegó con letras (una fila con GC lo
   * trae como hueco: ahí no hay nada que mostrar).
   */
  private findOrphans(row: number, ranges: [number, number, number][]): void {
    const found = new Map<Y.AbstractType<unknown>, { text: string; blockId: string | null; ranges: [number, number, number][] }>();
    const cache = new Map<Y.AbstractType<unknown>, Place>();
    const climb = (type: Y.AbstractType<unknown>): Place => {
      const known = cache.get(type);
      if (known) return known;
      let out: Place;
      const item = type._item;
      if (!item) {
        let content = false;
        try {
          content = !!type.doc && Y.findRootTypeKey(type) === CONTENT_FRAGMENT;
        } catch {
          content = false;
        }
        out = { removed: false, content, blockId: null };
      } else {
        const up = climb(item.parent as Y.AbstractType<unknown>);
        const dr = this.deletes.find(item.id.client, item.id.clock);
        // El bloque más cercano manda.
        const own = type instanceof Y.XmlElement && type.nodeName === 'blockContainer' ? rawId(type) : null;
        out = { removed: up.removed || (dr >= 0 && dr < row), content: up.content, blockId: own ?? up.blockId };
      }
      cache.set(type, out);
      return out;
    };
    for (const [client, from, to] of ranges) {
      const list = this.doc.store.clients.get(client);
      if (!list || list.length === 0) continue;
      const last = list[list.length - 1];
      if (from >= last.id.clock + last.length) continue;
      for (let i = Y.findIndexSS(list, Math.max(from, list[0].id.clock)); i < list.length && list[i].id.clock < to; i++) {
        const s = list[i];
        if (!(s instanceof Y.Item) || !(s.content instanceof Y.ContentString) || s.parentSub !== null) continue;
        const parent = s.parent as Y.AbstractType<unknown>;
        const where = climb(parent);
        if (!where.content || !where.removed) continue;
        // Solo la parte del elemento que está en el tramo (un elemento puede juntar letras de varias filas).
        const a = Math.max(from, s.id.clock);
        const b = Math.min(to, s.id.clock + s.length);
        const piece = s.content.str.slice(a - s.id.clock, b - s.id.clock);
        if (!piece) continue;
        const entry = found.get(parent) ?? { text: '', blockId: where.blockId, ranges: [] };
        entry.text += piece;
        entry.ranges.push([client, a, b]);
        found.set(parent, entry);
      }
    }
    for (const { text, blockId, ranges } of found.values()) this.orphans.push({ row, text, blockId, ranges });
  }

  private group(gapMs: number): HistorySession[] {
    const raw: { first: number; last: number }[] = [];
    this.rows.forEach((row, i) => {
      const prev = raw[raw.length - 1];
      const forced = i > 0 && (this.breakAfter.has(this.rows[i - 1].seq) || this.breakBefore.has(row.seq));
      if (prev && !forced && Date.parse(row.createdAt) - Date.parse(this.rows[i - 1].createdAt) <= gapMs) prev.last = i;
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
    for (const s of this.sessions) {
      const changes = this.changes.slice(s.first, s.last + 1);
      if (!changes.some((c) => c.markup) || changes.some((c) => c.content)) continue;
      const subjects = new Set(changes.flatMap((c) => [...c.subjects]));
      const subject = subjects.size === 1 && !changes.some((c) => c.unknown) ? [...subjects][0] : null;
      s.annotation = { name: subject ? annotationName(this.doc, this.snapshots.get(s.last)!, subject) : null };
    }
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

/** La marca del renglón de las fotos en línea (`STABLE_GAPS_MARKER` de ui/unknownContent.ts; una prueba lo compara). */
export const STABLE_GAPS_MARKER = 'lgaStableGaps';

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
        // La marca de los huecos estables de las fotos en línea no es un nodo del editor (la escribe el parche de
        // y-prosemirror; Doc_Fotos_En_Linea.md).
        if (child.nodeName === STABLE_GAPS_MARKER) continue;
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
 *
 * `start`: las filas que el dispositivo ya tiene guardadas (la caché, historyCache.ts). Se baja solo lo posterior,
 * pidiendo también la última guardada para comprobar que sigue siendo la misma (su `id`): si no (restauraron una copia
 * de seguridad y el servidor volvió a usar los `seq`), se tira lo guardado y se baja todo (`reset`).
 */
export async function loadPageHistory(
  remote: HistoryRemote,
  pageId: string,
  onProgress?: (rows: number) => void,
  isCancelled: () => boolean = () => false,
  start: readonly HistoryRow[] = [],
): Promise<LoadedHistory & { reset: boolean }> {
  const sizes = [500, 50, 5, 1];
  let size = 0;
  const fetchBatch = async (after: number): Promise<HistoryRow[]> => {
    for (;;) {
      if (isCancelled()) throw new Error('cancelled');
      try {
        return await remote.pageHistory(pageId, after, sizes[size]);
      } catch (err) {
        if (err instanceof RemoteError && err.message === REQUEST_TIMEOUT && size < sizes.length - 1) {
          size++;
          continue;
        }
        throw err;
      }
    }
  };
  let rows: HistoryRow[] = [];
  let reset = false;
  let done = false;
  const known = start[start.length - 1];
  if (known) {
    const batch = await fetchBatch(known.seq - 1);
    if (batch.length > 0 && batch[0].seq === known.seq && batch[0].id === known.id) {
      rows = [...start, ...batch.slice(1)];
      onProgress?.(rows.length);
      done = batch.length < sizes[size];
    } else {
      reset = true;
    }
  }
  while (!done) {
    const batch = await fetchBatch(rows.length ? rows[rows.length - 1].seq : 0);
    rows.push(...batch);
    onProgress?.(rows.length);
    done = batch.length < sizes[size];
  }
  const authors = await remote.pageHistoryAuthors(pageId);
  return { rows, emails: new Map(authors.map((a) => [a.user_id, a.email])), reset };
}
