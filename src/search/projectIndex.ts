import * as Y from 'yjs';
import type { DocState } from '../sync/localDb';
import type { PageRow } from '../sync/types';
import { SEPARATOR, unitsFromYDoc, type BlockMeta, type SearchUnit, type UnitField } from './extract';
import { findIn, normalize, normalizeQuery, searchNormalized, type Normalized, type SearchOptions } from './normalize';
import { treeContentGap } from '../sync/clean';
import { annotationUnitsFromYDoc, type AnnotationUnit } from './annotationExtract';

// La búsqueda en todo el proyecto (Docs/Doc_Buscar.md, secciones 7 y 8, con las correcciones 5, 7, 8 y 15 a
// 17). Sin React, como `projectSizes.ts`: una instancia por instancia de servicios, en memoria.
//
// - **Qué páginas:** las del proyecto que muestra la barra lateral (el árbol ya pasó por los permisos del
//   servidor), sin la papelera. Se mira el árbol **al buscar** (`tree.get`, `isTrashed`, el proyecto), nunca
//   solo lo guardado: una página que salió del árbol (le sacaron el permiso, se fue a la papelera) no da
//   resultados aunque siga en el índice o en IndexedDB.
// - **El índice:** por página, el texto de cada bloque (la misma regla que la barra de la página,
//   `unitsFromYDoc`) ya normalizado, y una marca para saber si cambió: `version:cursor` de su `docState` (sin
//   los filtros de la papelera de archivos, corrección 16), más las ediciones locales que avisa
//   `docs.subscribeLocalChange`. La página abierta se lee de su documento vivo (`docs.peek`), con lo recién
//   escrito; su marca es cuántos cambios tuvo ese documento. Se arma la primera vez que se abre el panel y
//   después se relee solo lo que cambió, cediendo el hilo entre páginas.
// - **Relaciones en vivo (Docs/Doc_Relaciones.md):** en la misma pasada se guarda, por bloque, su nivel de título, sus
//   links a páginas y sus fotos (`BlockMeta`): abrir los documentos es lo caro, y se hace una sola vez para las dos
//   cosas. Las relaciones arrancan el índice al abrir el proyecto (`retain`: cerrar el panel de buscar ya no corta la
//   lectura) y releen la página abierta al dejar de escribir (`readOpen`).
// - **Caché (`IndexCache`):** lo leído de cada página se guarda en el dispositivo con su marca `version:cursor`; al
//   abrir la app se recupera y solo se lee lo que cambió. Una página con ediciones sin subir (`docDirty:`) se vuelve a
//   leer igual. Lo que ya no está en el árbol se borra del caché; lo que no se ve se filtra al consultar, como siempre.
// - **Cómo compara:** cada palabra por separado, sin mayúsculas ni tildes (la ñ vale como n), con partes de
//   palabras; una página entra si tiene todas, en el título o en cualquier bloque.

export interface IndexTree {
  get(id: string): PageRow | undefined;
  isTrashed(id: string): boolean;
  roots(projectId: string): PageRow[];
  children(parentId: string | null): PageRow[];
  ancestors(id: string): PageRow[];
  hasUnsentCreate(pageId: string): boolean;
  /** "Al día" para este dispositivo (privacidad de lo borrado); sin él, con `update_seq`. */
  contentGap?(row: PageRow, cursor: number): 'missing' | 'preparing' | null;
}

export interface IndexDocs {
  peek(pageId: string): Y.Doc | null;
  indexSnapshot(pageId: string): Promise<{ doc: Y.Doc; state: DocState | undefined }>;
  states(): Promise<Map<string, DocState>>;
  subscribeLocalChange(fn: (pageId: string) => void): () => void;
  /** Hay ediciones sin guardar todavía: la lectura espera un momento (no les demora el guardado). */
  hasUnsavedEdits?(): boolean;
  /** El error de escritura local (sin espacio, por ejemplo): esperar no sirve, se lee sin esperar. */
  getWriteError?(): string | null;
}

interface IndexedUnit {
  blockId: string;
  field: UnitField;
  text: string;
  /** El texto normalizado (sin el mapa: se arma solo para los fragmentos que se muestran). */
  folded: string;
}

interface Entry {
  /**
   * `version:cursor` si salió de lo guardado; `live:<documento>:<cambios>` si salió del documento vivo (la
   * página abierta). No se guarda el documento: uno cerrado y destruido no queda retenido por el índice.
   */
  mark: string;
  units: IndexedUnit[];
  annotationUnits: (AnnotationUnit & { folded: string })[];
  /** Lo de cada bloque para las relaciones (títulos, links y fotos). */
  meta: BlockMeta[];
}

/** Lo que leyó el índice de una página, para las relaciones. Cambia de objeto cada vez que se relee la página. */
export interface IndexedContent {
  readonly mark: string;
  readonly units: readonly SearchUnit[];
  readonly meta: readonly BlockMeta[];
}

/** Lo que se guarda de cada página en el dispositivo (sin el texto normalizado: se rearma al recuperarlo). */
export interface CachedEntry {
  v: typeof CACHE_FORMAT;
  mark: string;
  units: SearchUnit[];
  annotations: AnnotationUnit[];
  meta: BlockMeta[];
}

/** Cambia si cambia lo que se extrae de un documento: lo guardado con otro formato no se usa. */
// 2: `BlockMeta.cells` y `cols` (las filas y columnas de una tabla, para los campos de una ficha).
export const CACHE_FORMAT = 2;

/** Dónde se guarda lo leído (la base local, `indexCache.ts`). Cualquier error se ignora: es solo un atajo. */
export interface IndexCache {
  /**
   * Lo guardado de un proyecto (solo ese: abrir uno no carga los demás del workspace; auditoría de E1, O1) y las páginas
   * con ediciones sin subir (esas se vuelven a leer).
   */
  load(projectId: string): Promise<{ entries: Map<string, unknown>; dirty: Set<string> }>;
  /** Guarda o borra (`entry: null`) lo de varias páginas, cada una en su proyecto, en una sola transacción. */
  save(changes: CacheChange[]): Promise<void>;
}

/** Guardar (o borrar, `entry: null`) lo de una página bajo un proyecto. */
export interface CacheChange {
  pageId: string;
  projectId: string;
  entry: CachedEntry | null;
}

/** Progreso de una lectura grande (la primera vez, o después de muchos cambios). */
export interface IndexProgress {
  /** Páginas al día. */
  ready: number;
  /** Páginas del proyecto. */
  total: number;
}

/** Una lectura con menos páginas que esto no muestra progreso (sería un parpadeo). */
export const PROGRESS_MIN_PAGES = 20;

export interface SearchWord {
  /** Como se escribió (va a la barra de la página al ir al resultado). */
  raw: string;
  norm: string;
}

interface SnippetText {
  blockId: string;
  /** Un pedazo del texto del bloque alrededor de la primera coincidencia. */
  text: string;
  /** Lo encontrado, en posiciones de `text`. */
  ranges: [number, number][];
  /** Se cortó el principio o el final ("…"). */
  cutStart: boolean;
  cutEnd: boolean;
  /** La palabra que coincidió primero en este bloque, como se escribió (corrección 5). */
  term: string;
}

export type Snippet = SnippetText & (
  // occurrence pertenece sólo a las unidades de ProseMirror, contando desde 0 dentro del bloque.
  | { field: UnitField; occurrence: number }
  | { field: 'annotation'; fileId: string; shapeId: string }
);

export interface PageHit {
  page: PageRow;
  /** Las páginas de arriba que la persona ve, de la raíz a la madre. */
  path: PageRow[];
  titleRanges: [number, number][];
  snippets: Snippet[];
  /** Bloques con coincidencias que no se muestran ("y 5 más en esta página"). */
  more: number;
}

export interface SearchResults {
  hits: PageHit[];
  /** Cuántas páginas coinciden en total (se muestran hasta `limit`). */
  total: number;
}

/** Una coincidencia de la frase (reemplazar en el proyecto): la cuenta de su bloque es la de la barra de la página. */
export interface PhraseMatch {
  blockId: string;
  field: UnitField;
  /** Cuál de las coincidencias de su bloque es (pies y nombres incluidos, en el orden del documento). */
  occurrence: number;
  /** El texto del bloque (de esa unidad) y dónde está lo encontrado. */
  text: string;
  start: number;
  end: number;
}

export interface PhraseHit {
  page: PageRow;
  path: PageRow[];
  matches: PhraseMatch[];
}

export interface IndexInfo {
  /** Páginas del proyecto que se buscan. */
  pages: number;
  /** Se está leyendo alguna página (la primera vez o por un cambio). */
  building: boolean;
  /** Páginas con contenido en el servidor que el dispositivo todavía no bajó. */
  missing: number;
  /** Páginas con algo del servidor que esta versión no pudo leer. */
  unreadable: number;
  /** Mientras lee muchas páginas (`PROGRESS_MIN_PAGES` o más), cuántas están al día; si no, `null`. */
  progress: IndexProgress | null;
}

/** Fragmentos por página. */
export const SNIPPETS_PER_PAGE = 3;
/** Lo que se muestra antes de la primera coincidencia en un fragmento. */
const SNIPPET_BEFORE = 30;
/** El largo de un fragmento. */
const SNIPPET_LENGTH = 110;
/** Cuánto se corre un corte para no partir una palabra. */
const WORD_SLACK = 12;

/** Las palabras de lo buscado (sin repetir, sin las que quedan vacías al normalizar). */
export function parseWords(query: string): SearchWord[] {
  const out: SearchWord[] = [];
  for (const raw of query.trim().split(/\s+/)) {
    const norm = normalizeQuery(raw);
    if (norm && !out.some((w) => w.norm === norm)) out.push({ raw, norm });
  }
  return out;
}

/** Si un nombre (un proyecto) tiene todas las palabras. */
export function nameMatches(name: string, words: SearchWord[]): boolean {
  if (words.length === 0) return true;
  const norm = normalize(name);
  return words.every((w) => findIn(norm.text, w.norm, {}, norm.map).length > 0);
}

/** Los tramos encontrados de todas las palabras, ordenados y sin encimarse. */
export function rangesOf(text: string, norm: Normalized, words: SearchWord[]): [number, number][] {
  const all: [number, number][] = [];
  for (const w of words) all.push(...searchNormalized(text, norm, w.norm));
  return mergeRanges(all);
}

function mergeRanges(ranges: [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const out: [number, number][] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

const markOf = (state: DocState | undefined): string => (state ? `${state.version}:${state.cursor}` : 'none');

/** Cada documento vivo que vio el índice: un número propio y cuántos cambios tuvo desde entonces. */
const liveCounters = new WeakMap<Y.Doc, { id: number; n: number }>();
let liveIds = 0;

function liveMark(doc: Y.Doc): string {
  let counter = liveCounters.get(doc);
  if (!counter) {
    const c = { id: ++liveIds, n: 0 };
    liveCounters.set(doc, (counter = c));
    // Cualquier cambio (también un borrado, que no mueve el vector de estado).
    doc.on('update', () => c.n++);
  }
  return `live:${counter.id}:${counter.n}`;
}

/** Cuántas veces está `needle` en `hay` (sin encimarse), sin armar el mapa al original. */
function countIn(hay: string, needle: string): number {
  let n = 0;
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + needle.length)) n++;
  return n;
}

// Escrituras donde un carácter es una palabra (chino, japonés): ahí una sola letra sí se busca en el texto.
const IDEOGRAPHIC = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}\p{Script=Yi}]/u;

/**
 * Una letra sola (un punto de código, salvo en las escrituras de arriba) busca solo en los títulos: en el texto
 * coincide con casi todo.
 */
export function titlesOnly(words: SearchWord[]): boolean {
  return words.length > 0 && words.every((w) => [...w.norm].length < 2 && !IDEOGRAPHIC.test(w.norm));
}

/**
 * El texto normalizado de cada unidad. Con lo leído antes de la misma página (`prev`), lo que no cambió se reusa:
 * releer la página abierta al dejar de escribir normaliza solo lo que se tocó.
 */
function folded<T extends { text: string }>(units: T[], prev?: readonly { text: string; folded: string }[]): (T & { folded: string })[] {
  const known = new Map<string, string>();
  if (prev) for (const u of prev) known.set(u.text, u.folded);
  return units.map((u) => ({ ...u, folded: known.get(u.text) ?? normalize(u.text).text }));
}

/** Lee una página: el texto de cada bloque (la búsqueda) y lo de cada bloque que usan las relaciones, en una pasada. */
function readEntry(doc: Y.Doc, mark: string, prev?: Entry): Entry {
  const meta: BlockMeta[] = [];
  const units = folded(unitsFromYDoc(doc, meta), prev?.units);
  return { mark, units, annotationUnits: folded(annotationUnitsFromYDoc(doc), prev?.annotationUnits), meta };
}

/** Lo que se guarda de una página (sin el texto normalizado). */
function toCached(entry: Entry): CachedEntry {
  return {
    v: CACHE_FORMAT,
    mark: entry.mark,
    units: entry.units.map(({ blockId, field, text }) => ({ blockId, field, text })),
    annotations: entry.annotationUnits.map(({ folded: _f, ...u }) => u),
    meta: entry.meta,
  };
}

/** Lo guardado tiene la forma de ahora (otro formato, o algo roto, no se usa). */
function validCached(value: unknown): value is CachedEntry {
  const c = value as CachedEntry | null;
  return !!c && c.v === CACHE_FORMAT && typeof c.mark === 'string' && Array.isArray(c.units) && Array.isArray(c.annotations) && Array.isArray(c.meta);
}

type QueryUnit = IndexedUnit | Entry['annotationUnits'][number];

interface Ranked {
  page: PageRow;
  order: number;
  group: number;
  count: number;
  inTitle: boolean[];
  /** Los bloques con alguna palabra y cuántas veces está cada una (en el texto normalizado). */
  matched: { unit: QueryUnit; index: number; counts: number[] }[];
  units: IndexedUnit[];
}

export class ProjectIndex {
  private readonly entries = new Map<string, Entry>();
  /** Páginas con una edición local guardada después de leerlas. */
  private readonly stale = new Set<string>();
  private states = new Map<string, DocState>();
  private readonly listeners = new Set<() => void>();
  private revision = 0;
  private running: Promise<void> | null = null;
  private again: string | null = null;
  private building = false;
  private cancelled = false;
  private disposed = false;
  private readonly unsubscribe: () => void;
  private readonly titles = new Map<string, Normalized>();
  /** Quienes necesitan que el índice siga leyendo aunque se cierre el panel (las relaciones). */
  private retainers = 0;
  /** El progreso de la lectura en curso, si es grande. */
  private progress: (IndexProgress & { projectId: string }) | null = null;
  /** El proyecto de la pasada en curso, y si hay que cortarla porque se pidió otro. */
  private current: string | null = null;
  private preempt = false;
  /** Lo recuperado del caché (una sola vez por instancia). */
  private readonly restored = new Map<string, Promise<void>>();
  private readonly restoredDone = new Set<string>();
  /** Lo que falta guardar en el caché (`entry: null`: borrar), con el proyecto bajo el que se guarda. */
  private readonly unsaved = new Map<string, CacheChange>();
  /** Bajo qué proyecto está guardada cada página en el caché (para borrarla). */
  private readonly cachedIn = new Map<string, string>();
  private saving: Promise<void> = Promise.resolve();

  constructor(
    private readonly tree: IndexTree,
    private readonly docs: IndexDocs,
    private readonly options: { yieldMs?: number; publishMs?: number; writeWaitMs?: number; cache?: IndexCache; saveMs?: number } = {},
  ) {
    this.unsubscribe = docs.subscribeLocalChange((pageId) => {
      this.stale.add(pageId);
    });
  }

  /**
   * Pide que la lectura siga aunque se cierre el panel de buscar (`cancel` no hace nada mientras alguien la retenga).
   * Devuelve la función que la suelta.
   */
  retain(): () => void {
    this.retainers++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.retainers--;
    };
  }

  /** Lo leído de una página (para las relaciones), si está leído. Lo de una página que no se ve, también: filtrar es de quien consulta. */
  content(pageId: string): IndexedContent | undefined {
    return this.entries.get(pageId);
  }

  /**
   * Relee ya la página abierta (su documento vivo) si cambió desde la última lectura: es lo que hacen las relaciones
   * medio segundo después de dejar de escribir. Sin el documento vivo, la deja para la próxima pasada. Devuelve si leyó.
   */
  readOpen(projectId: string, pageId: string): boolean {
    if (this.disposed || !this.visible(pageId, projectId)) return false;
    const live = this.docs.peek(pageId);
    if (!live) {
      this.stale.add(pageId);
      return false;
    }
    if (this.entries.get(pageId)?.mark === liveMark(live)) return false;
    this.stale.delete(pageId);
    this.entries.set(pageId, readEntry(live, liveMark(live), this.entries.get(pageId)));
    this.publish();
    return true;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** Cambia cuando el índice leyó algo (a lo sumo cada ~250 ms mientras lee) y al terminar cada lectura. */
  getRevision = (): number => this.revision;

  /** Deja de escuchar las ediciones y de leer (al cerrar los servicios: cerrar sesión, cambiar de workspace). */
  dispose(): void {
    // Lo leído que falta guardar se intenta guardar (la base puede estar cerrándose: entonces se lee la próxima vez).
    void this.flush();
    this.disposed = true;
    this.unsubscribe();
    this.entries.clear();
    this.listeners.clear();
  }

  /**
   * Corta la lectura en curso (se cerró el panel): lo ya leído queda, lo demás se lee la próxima vez. Mientras las
   * relaciones la retengan (`retain`), sigue.
   */
  cancel(): void {
    if (this.running && this.retainers === 0) this.cancelled = true;
  }

  /** Espera a que se guarde en el caché lo leído hasta ahora (para las pruebas y al cerrar). */
  flush(): Promise<void> {
    const cache = this.options.cache;
    if (!cache || this.unsaved.size === 0) return this.saving;
    const batch = [...this.unsaved.values()];
    this.unsaved.clear();
    this.saving = this.saving.then(() => cache.save(batch)).catch(() => undefined);
    return this.saving;
  }

  /** Deja para guardar (o borrar, con `null`) lo de una página, bajo su proyecto. */
  private toSave(pageId: string, projectId: string | undefined, entry: CachedEntry | null): void {
    if (!this.options.cache || !projectId) return;
    // Una página que pasó a otro proyecto: lo guardado bajo el anterior se borra.
    const before = this.cachedIn.get(pageId);
    if (entry && before && before !== projectId) this.unsaved.set(`${before}:${pageId}`, { pageId, projectId: before, entry: null });
    this.unsaved.set(`${projectId}:${pageId}`, { pageId, projectId, entry });
    if (entry) this.cachedIn.set(pageId, projectId);
    else this.cachedIn.delete(pageId);
  }

  /**
   * Recupera lo guardado del proyecto (una vez por proyecto): lo que no se leyó todavía en esta sesión entra con su marca.
   * Una fila rota se descarta sola (y se borra) sin cortar la pasada (auditoría de E1, O4).
   */
  private restore(projectId: string): Promise<void> {
    const cache = this.options.cache;
    if (!cache) return Promise.resolve();
    let pending = this.restored.get(projectId);
    if (pending) return pending;
    pending = (async () => {
      const yieldMs = this.options.yieldMs ?? 12;
      let loaded: Awaited<ReturnType<IndexCache['load']>>;
      try {
        loaded = await cache.load(projectId);
      } catch {
        return;
      }
      let since = Date.now();
      for (const [pageId, saved] of loaded.entries) {
        if (this.disposed) return;
        this.cachedIn.set(pageId, projectId);
        // Lo de otro formato o roto se borra. Lo de una página que ya no está en el árbol o es de otro proyecto, también
        // (lo que no se ve nunca se consulta: `pagesOf`).
        const row = this.tree.get(pageId);
        let entry: Entry | null = null;
        try {
          if (validCached(saved) && row?.workspace_id === projectId) {
            entry = { mark: saved.mark, units: folded(saved.units), annotationUnits: folded(saved.annotations), meta: saved.meta };
          }
        } catch {
          entry = null;
        }
        if (!entry) {
          if (!row || row.workspace_id !== projectId || !validCached(saved) || !this.entries.has(pageId)) this.toSave(pageId, projectId, null);
          continue;
        }
        if (!this.entries.has(pageId)) this.entries.set(pageId, entry);
        if (Date.now() - since >= yieldMs) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          since = Date.now();
        }
      }
      for (const pageId of loaded.dirty) this.stale.add(pageId);
    })().finally(() => {
      this.restoredDone.add(projectId);
    });
    this.restored.set(projectId, pending);
    return pending;
  }

  /** Si la página está leída en el índice (para las pruebas). */
  has(pageId: string): boolean {
    return this.entries.has(pageId);
  }

  /**
   * Lee lo que falte o haya cambiado de las páginas del proyecto. Si ya hay una lectura en curso, se hace
   * otra apenas termine (con lo que haya cambiado mientras tanto).
   */
  refresh(projectId: string): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.cancelled = false;
    if (this.running) {
      // Otro proyecto (se cambió de proyecto a mitad de la primera lectura): la pasada del anterior se corta aunque esté
      // retenida; lo leído queda y se guarda, el resto se lee al volver (auditoría de E1, B2).
      if (this.current !== projectId) this.preempt = true;
      this.again = projectId;
      return this.running;
    }
    this.running = (async () => {
      let next: string | null = projectId;
      while (next && !this.disposed && !this.cancelled) {
        this.again = null;
        this.preempt = false;
        this.current = next;
        // Un error de la base (se está cerrando, al cambiar de workspace) no rompe nada: se intenta la próxima vez.
        await this.run(next).catch(() => undefined);
        next = this.again;
      }
    })().finally(() => {
      this.running = null;
      this.cancelled = false;
      this.current = null;
    });
    return this.running;
  }

  /** Las páginas que se buscan: las de la barra lateral del proyecto, en su orden (sin la papelera). */
  pagesOf(projectId: string): PageRow[] {
    const out: PageRow[] = [];
    const seen = new Set<string>();
    const visit = (page: PageRow) => {
      if (seen.has(page.id)) return;
      seen.add(page.id);
      if (this.visible(page.id, projectId)) out.push(page);
      for (const child of this.tree.children(page.id)) visit(child);
    };
    for (const root of this.tree.roots(projectId)) visit(root);
    return out;
  }

  /** Lo que la persona ve de verdad, ahora (corrección 15): está en el árbol, en ese proyecto y no en la papelera. */
  private visible(pageId: string, projectId: string): boolean {
    const row = this.tree.get(pageId);
    return !!row && row.workspace_id === projectId && !this.tree.isTrashed(pageId);
  }

  info(projectId: string): IndexInfo {
    let missing = 0;
    let unreadable = 0;
    const pages = this.pagesOf(projectId);
    for (const page of pages) {
      const state = this.states.get(page.id);
      // Lo que falta bajar (o "en preparación": sin base limpia todavía, para quien no ve lo borrado).
      if (treeContentGap(this.tree, page, state?.cursor ?? 0) !== null && !this.tree.hasUnsentCreate(page.id)) missing++;
      if (state?.unreadable) unreadable++;
    }
    return { pages: pages.length, building: this.building, missing, unreadable, progress: this.building && this.progress?.projectId === projectId ? { ready: this.progress.ready, total: this.progress.total } : null };
  }

  private publish(): void {
    this.revision++;
    for (const fn of this.listeners) fn();
  }

  /**
   * Una pasada por las páginas del proyecto. `building` se prende recién cuando alguna página cambió de marca
   * (una búsqueda o una sincronización sin cambios no muestra "Buscando…"), y mientras lee se avisa a lo sumo
   * cada `publishMs` (cada aviso vuelve a buscar).
   */
  private async run(projectId: string): Promise<void> {
    const yieldMs = this.options.yieldMs ?? 12;
    const publishMs = this.options.publishMs ?? 250;
    // Lo que esta pasada puede esperar, en total, a que se guarden las ediciones (no por página).
    const budget = { ms: this.options.writeWaitMs ?? 2000 };
    const saveMs = this.options.saveMs ?? 3000;
    let changed = false;
    try {
      // Solo la primera pasada espera al caché (las demás no suman ni una vuelta de espera).
      if (!this.restoredDone.has(projectId) && this.options.cache) {
        await this.restore(projectId);
        if (this.disposed) return;
      }
      this.states = await this.docs.states();
      let since = Date.now();
      let published = Date.now();
      let saved = Date.now();
      const pages = this.pagesOf(projectId);
      const todo = pages.filter((page) => this.needsRead(page.id)).length;
      this.progress = todo >= PROGRESS_MIN_PAGES ? { projectId, ready: pages.length - todo, total: pages.length } : null;
      for (const page of pages) {
        if (this.disposed || this.cancelled || this.preempt) return;
        // El árbol pudo cambiar mientras se leía: lo que ya no se ve no se lee.
        if (!this.visible(page.id, projectId) || !this.needsRead(page.id)) continue;
        if (!this.building) {
          this.building = true;
          this.publish();
          published = Date.now();
        }
        try {
          await this.waitForWrites(budget);
          if (this.disposed || this.cancelled || this.preempt) return;
          await this.readPage(page.id);
          changed = true;
        } catch {
          // Esta página no se pudo leer ahora: queda como estaba (o sin leer) y se intenta la próxima vez.
          this.stale.add(page.id);
        }
        if (this.progress) this.progress = { ...this.progress, ready: Math.min(this.progress.total, this.progress.ready + 1) };
        if (Date.now() - since >= yieldMs) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          since = Date.now();
        }
        if (changed && Date.now() - published >= publishMs) {
          this.publish();
          published = Date.now();
          changed = false;
        }
        // Lo leído se guarda de a tandas: si la app se cierra a mitad de la primera lectura, no se empieza de cero.
        if (Date.now() - saved >= saveMs) {
          void this.flush();
          saved = Date.now();
        }
      }
      // Lo que ya no está en el árbol no se guarda más (igual se filtra al buscar), tampoco en el caché.
      for (const id of this.entries.keys()) {
        if (this.tree.get(id)) continue;
        this.entries.delete(id);
        this.toSave(id, this.cachedIn.get(id), null);
      }
    } finally {
      this.building = false;
      this.progress = null;
      void this.flush();
      // Uno al final siempre: también cambian los avisos (páginas por bajar, ilegibles).
      if (!this.disposed) this.publish();
    }
  }

  /**
   * Mientras haya ediciones sin guardar, espera un poco: leer (y fusionar) no les demora el guardado. Con un
   * tope para toda la pasada, y sin esperar si guardar está fallando (sin espacio: no se va a arreglar solo).
   */
  private async waitForWrites(budget: { ms: number }): Promise<void> {
    while (budget.ms > 0 && this.docs.hasUnsavedEdits?.() && !this.docs.getWriteError?.()) {
      const start = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 25));
      budget.ms -= Math.max(1, Date.now() - start);
    }
  }

  /** Si la página cambió desde que se leyó (o nunca se leyó). */
  private needsRead(pageId: string): boolean {
    const entry = this.entries.get(pageId);
    const live = this.docs.peek(pageId);
    if (live) return entry?.mark !== liveMark(live);
    return !entry || entry.mark !== markOf(this.states.get(pageId)) || this.stale.has(pageId);
  }

  private async readPage(pageId: string): Promise<void> {
    const live = this.docs.peek(pageId);
    // Antes de leer: una edición que se guarde mientras tanto la vuelve a marcar.
    this.stale.delete(pageId);
    if (live) {
      // Lo del documento vivo no se guarda en el caché (su marca no es la de lo guardado): al cerrarse la página se
      // relee de lo guardado y entonces sí.
      this.entries.set(pageId, readEntry(live, liveMark(live), this.entries.get(pageId)));
      return;
    }
    const snap = await this.docs.indexSnapshot(pageId);
    try {
      const entry = readEntry(snap.doc, markOf(snap.state));
      this.entries.set(pageId, entry);
      if (snap.state) this.states.set(pageId, snap.state);
      this.toSave(pageId, this.tree.get(pageId)?.workspace_id, toCached(entry));
    } finally {
      snap.doc.destroy();
    }
  }

  private titleNorm(title: string): Normalized {
    let norm = this.titles.get(title);
    if (!norm) {
      if (this.titles.size > 5000) this.titles.clear();
      this.titles.set(title, (norm = normalize(title)));
    }
    return norm;
  }

  /**
   * Busca en lo que ya está leído. Primero las páginas con todas las palabras en el título, después las que
   * tienen alguna en el título, y después por cantidad de coincidencias; a igualdad, el orden de la barra
   * lateral. Para ordenar se cuenta sobre el texto normalizado (sin mapas); los fragmentos, con sus mapas, se
   * arman solo para las `limit` páginas que se muestran. Una sola letra busca solo en los títulos.
   */
  query(projectId: string, query: string, { limit = 50 }: { limit?: number } = {}): SearchResults {
    const words = parseWords(query);
    if (words.length === 0) return { hits: [], total: 0 };
    const onlyTitles = titlesOnly(words);
    const ranked: Ranked[] = [];
    this.pagesOf(projectId).forEach((page, order) => {
      const r = this.rank(page, order, words, onlyTitles);
      if (r) ranked.push(r);
    });
    ranked.sort((a, b) => a.group - b.group || b.count - a.count || a.order - b.order);
    const hits: PageHit[] = [];
    let dropped = 0;
    for (const r of ranked) {
      if (hits.length >= limit) break;
      const hit = this.detail(r, words);
      if (hit) hits.push(hit);
      else dropped++;
    }
    return { hits, total: ranked.length - dropped };
  }

  /**
   * La frase tal cual (con *Aa* y palabra entera), en el texto de todas las páginas del proyecto que la persona ve,
   * en el orden de la barra lateral: lo que lista reemplazar en el proyecto. Los títulos no (pregunta 1).
   */
  phrase(projectId: string, query: string, options: SearchOptions = {}): PhraseHit[] {
    const q = normalizeQuery(query, options);
    if (!q) return [];
    const out: PhraseHit[] = [];
    for (const page of this.pagesOf(projectId)) {
      const units = this.entries.get(page.id)?.units ?? [];
      // Sin *Aa*, un descarte rápido con el texto ya normalizado.
      if (!options.matchCase && !units.some((u) => u.folded.includes(q))) continue;
      const matches: PhraseMatch[] = [];
      const perBlock = new Map<string, number>();
      for (const unit of units) {
        for (const [start, end] of searchNormalized(unit.text, normalize(unit.text, options), q, options)) {
          const occurrence = perBlock.get(unit.blockId) ?? 0;
          perBlock.set(unit.blockId, occurrence + 1);
          matches.push({ blockId: unit.blockId, field: unit.field, occurrence, text: unit.text, start, end });
        }
      }
      if (matches.length > 0) out.push({ page, path: this.tree.ancestors(page.id), matches });
    }
    return out;
  }

  private rank(page: PageRow, order: number, words: SearchWord[], onlyTitles: boolean): Ranked | null {
    const titleNorm = this.titleNorm(page.title ?? '');
    const inTitle = words.map((w) => findIn(titleNorm.text, w.norm, {}, titleNorm.map).length > 0);
    const entry = this.entries.get(page.id);
    const units = onlyTitles ? [] : (entry?.units ?? []);
    const queryUnits: QueryUnit[] = [...units, ...(onlyTitles ? [] : (entry?.annotationUnits ?? []))];
    const inBody = words.map(() => false);
    const matched: Ranked['matched'] = [];
    let count = inTitle.filter(Boolean).length;
    queryUnits.forEach((unit, index) => {
      let counts: number[] | null = null;
      for (let i = 0; i < words.length; i++) {
        const n = countIn(unit.folded, words[i].norm);
        if (n === 0) continue;
        counts ??= words.map(() => 0);
        counts[i] = n;
        inBody[i] = true;
        count += n;
      }
      if (counts) matched.push({ unit, index, counts });
    });
    if (!words.every((_, i) => inTitle[i] || inBody[i])) return null;
    const group = inTitle.every(Boolean) ? 0 : inTitle.some(Boolean) ? 1 : 2;
    return { page, order, group, count, inTitle, matched, units };
  }

  /**
   * El resultado de una página, con los fragmentos. Los tramos se confirman con el mapa (una coincidencia que
   * corta un carácter del original, como la mitad de una sílaba coreana, no cuenta): si al final no queda nada,
   * la página no se muestra.
   */
  private detail(r: Ranked, words: SearchWord[]): PageHit | null {
    const title = r.page.title ?? '';
    const titleRanges = r.inTitle.some(Boolean) ? rangesOf(title, this.titleNorm(title), words) : [];
    // Los bloques con más palabras distintas primero (el mejor fragmento arriba: es adonde va la página); a
    // igualdad, en el orden del documento.
    const distinct = (m: Ranked['matched'][number]) => m.counts.filter((n) => n > 0).length;
    const order = [...r.matched].sort((a, b) => distinct(b) - distinct(a) || a.index - b.index);
    const snippets: Snippet[] = [];
    // Los bloques que se miraron (los que se muestran y los que resultaron no coincidir de verdad).
    let examined = 0;
    for (const m of order) {
      if (snippets.length >= SNIPPETS_PER_PAGE) break;
      examined++;
      const norm = normalize(m.unit.text);
      const lists = words.map((w, i) => (m.counts[i] > 0 ? searchNormalized(m.unit.text, norm, w.norm) : []));
      if (lists.every((l) => l.length === 0)) continue;
      snippets.push(this.snippet(m.unit, lists, words, r.units));
    }
    if (snippets.length === 0 && titleRanges.length === 0) return null;
    return {
      page: r.page,
      path: this.tree.ancestors(r.page.id),
      titleRanges,
      snippets,
      // "y N más en esta página": los que no se miraron.
      more: r.matched.length - examined,
    };
  }

  private snippet(unit: QueryUnit, lists: [number, number][][], words: SearchWord[], units: IndexedUnit[]): Snippet {
    // La primera coincidencia del bloque y su palabra (a igualdad, la más larga).
    let first: [number, number] = [0, 0];
    let termIndex = -1;
    for (let i = 0; i < lists.length; i++) {
      const r = lists[i][0];
      if (r && (termIndex < 0 || r[0] < first[0] || (r[0] === first[0] && r[1] > first[1]))) {
        first = r;
        termIndex = i;
      }
    }
    const term = words[Math.max(0, termIndex)];
    // Cuál es en el bloque: las de esa palabra en las unidades de antes del mismo bloque (la barra de la página
    // las cuenta igual, corrección 5).
    let occurrence = 0;
    for (const u of unit.field === 'annotation' ? [] : units) {
      if (u === unit) break;
      if (u.blockId !== unit.blockId || !u.folded.includes(term.norm)) continue;
      occurrence += searchNormalized(u.text, normalize(u.text), term.norm).length;
    }
    const text = unit.text;
    const [from, to] = first;
    let start = Math.max(0, from - SNIPPET_BEFORE);
    if (start > 0) {
      const space = text.slice(start, Math.min(from, start + WORD_SLACK)).search(/[\s￼]/u);
      if (space >= 0) start += space + 1;
      if (/[\uDC00-\uDFFF]/.test(text[start] ?? '')) start--;
    }
    let end = Math.min(text.length, Math.max(to, start + SNIPPET_LENGTH));
    if (end < text.length) {
      const back = text.slice(Math.max(to, end - WORD_SLACK), end);
      const space = Math.max(back.lastIndexOf(' '), back.lastIndexOf(SEPARATOR));
      if (space >= 0) end = Math.max(to, end - back.length + space);
      if (/[\uD800-\uDBFF]/.test(text[end - 1] ?? '')) end++;
    }
    const ranges = mergeRanges(lists.flat())
      .filter(([s, e]) => e > start && s < end)
      .map(([s, e]): [number, number] => [Math.max(s, start) - start, Math.min(e, end) - start]);
    return {
      blockId: unit.blockId,
      // Un salto de línea adentro del bloque se ve como un espacio (mismo largo: los tramos no se corren).
      text: text.slice(start, end).replaceAll(SEPARATOR, ' '),
      ranges,
      cutStart: start > 0,
      cutEnd: end < text.length,
      term: term.raw,
      ...(unit.field === 'annotation'
        ? { field: 'annotation' as const, fileId: unit.fileId, shapeId: unit.shapeId }
        : { field: unit.field, occurrence }),
    };
  }
}
