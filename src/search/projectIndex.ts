import * as Y from 'yjs';
import type { DocState } from '../sync/localDb';
import type { PageRow } from '../sync/types';
import { SEPARATOR, unitsFromYDoc, type UnitField } from './extract';
import { findIn, normalize, normalizeQuery, searchNormalized, type Normalized } from './normalize';

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
// - **Cómo compara:** cada palabra por separado, sin mayúsculas ni tildes (la ñ vale como n), con partes de
//   palabras; una página entra si tiene todas, en el título o en cualquier bloque.

export interface IndexTree {
  get(id: string): PageRow | undefined;
  isTrashed(id: string): boolean;
  roots(projectId: string): PageRow[];
  children(parentId: string | null): PageRow[];
  ancestors(id: string): PageRow[];
  hasUnsentCreate(pageId: string): boolean;
}

export interface IndexDocs {
  peek(pageId: string): Y.Doc | null;
  indexSnapshot(pageId: string): Promise<{ doc: Y.Doc; state: DocState | undefined }>;
  states(): Promise<Map<string, DocState>>;
  subscribeLocalChange(fn: (pageId: string) => void): () => void;
}

interface IndexedUnit {
  blockId: string;
  field: UnitField;
  text: string;
  /** El texto normalizado (sin el mapa: se arma solo para los bloques que coinciden). */
  folded: string;
  norm?: Normalized;
}

interface Entry {
  mark: string;
  units: IndexedUnit[];
  /** El documento vivo del que salió (la página abierta), si salió de uno. */
  live?: Y.Doc;
}

export interface SearchWord {
  /** Como se escribió (va a la barra de la página al ir al resultado). */
  raw: string;
  norm: string;
}

export interface Snippet {
  blockId: string;
  field: UnitField;
  /** Un pedazo del texto del bloque alrededor de la primera coincidencia. */
  text: string;
  /** Lo encontrado, en posiciones de `text`. */
  ranges: [number, number][];
  /** Se cortó el principio o el final ("…"). */
  cutStart: boolean;
  cutEnd: boolean;
  /** La palabra que coincidió primero en este bloque, como se escribió (corrección 5). */
  term: string;
  /** Cuál de las coincidencias de `term` en el bloque es (contando desde 0, en el orden del documento). */
  occurrence: number;
}

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

export interface IndexInfo {
  /** Páginas del proyecto que se buscan. */
  pages: number;
  /** Se está leyendo alguna página (la primera vez o por un cambio). */
  building: boolean;
  /** Páginas con contenido en el servidor que el dispositivo todavía no bajó. */
  missing: number;
  /** Páginas con algo del servidor que esta versión no pudo leer. */
  unreadable: number;
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

/** Cuántos cambios tuvo un documento vivo desde que el índice lo vio por primera vez. */
const liveCounters = new WeakMap<Y.Doc, { n: number }>();

function liveMark(doc: Y.Doc): string {
  let counter = liveCounters.get(doc);
  if (!counter) {
    const c = { n: 0 };
    liveCounters.set(doc, (counter = c));
    // Cualquier cambio (también un borrado, que no mueve el vector de estado).
    doc.on('update', () => c.n++);
  }
  return `live:${counter.n}`;
}

function indexUnits(doc: Y.Doc): IndexedUnit[] {
  return unitsFromYDoc(doc).map((u) => ({ ...u, folded: normalize(u.text).text }));
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
  private disposed = false;
  private readonly unsubscribe: () => void;
  private readonly titles = new Map<string, Normalized>();

  constructor(
    private readonly tree: IndexTree,
    private readonly docs: IndexDocs,
    private readonly options: { yieldMs?: number } = {},
  ) {
    this.unsubscribe = docs.subscribeLocalChange((pageId) => {
      this.stale.add(pageId);
    });
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** Cambia cada vez que el índice lee algo o termina de leer (para volver a buscar). */
  getRevision = (): number => this.revision;

  /** Deja de escuchar las ediciones (al cerrar los servicios). */
  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
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
    if (this.running) {
      this.again = projectId;
      return this.running;
    }
    this.running = (async () => {
      let next: string | null = projectId;
      while (next && !this.disposed) {
        this.again = null;
        // Un error de la base (se está cerrando, al cambiar de workspace) no rompe nada: se intenta la próxima vez.
        await this.run(next).catch(() => undefined);
        next = this.again;
      }
    })().finally(() => {
      this.running = null;
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
      if (page.update_seq > (state?.cursor ?? 0) && !this.tree.hasUnsentCreate(page.id)) missing++;
      if (state?.unreadable) unreadable++;
    }
    return { pages: pages.length, building: this.building, missing, unreadable };
  }

  private publish(): void {
    this.revision++;
    for (const fn of this.listeners) fn();
  }

  private async run(projectId: string): Promise<void> {
    this.building = true;
    this.publish();
    const yieldMs = this.options.yieldMs ?? 12;
    try {
      this.states = await this.docs.states();
      let since = Date.now();
      let changed = false;
      for (const page of this.pagesOf(projectId)) {
        if (this.disposed) return;
        // El árbol pudo cambiar mientras se leía: lo que ya no se ve no se lee.
        if (!this.visible(page.id, projectId)) continue;
        try {
          if (await this.readPage(page.id)) changed = true;
        } catch {
          // Esta página no se pudo leer ahora: queda como estaba (o sin leer) y se intenta la próxima vez.
          this.stale.add(page.id);
        }
        if (Date.now() - since >= yieldMs) {
          if (changed) this.publish();
          changed = false;
          await new Promise((resolve) => setTimeout(resolve, 0));
          since = Date.now();
        }
      }
      // Lo que ya no está en el árbol no se guarda más (igual se filtra al buscar).
      for (const id of this.entries.keys()) if (!this.tree.get(id)) this.entries.delete(id);
    } finally {
      this.building = false;
      this.publish();
    }
  }

  /** Lee una página si cambió. Devuelve si la leyó. */
  private async readPage(pageId: string): Promise<boolean> {
    const entry = this.entries.get(pageId);
    const live = this.docs.peek(pageId);
    if (live) {
      const mark = liveMark(live);
      if (entry && entry.live === live && entry.mark === mark) return false;
      this.stale.delete(pageId);
      this.entries.set(pageId, { mark, units: indexUnits(live), live });
      return true;
    }
    if (entry && !entry.live && entry.mark === markOf(this.states.get(pageId)) && !this.stale.has(pageId)) return false;
    // Antes de leer: una edición que se guarde mientras tanto la vuelve a marcar.
    this.stale.delete(pageId);
    const snap = await this.docs.indexSnapshot(pageId);
    try {
      this.entries.set(pageId, { mark: markOf(snap.state), units: indexUnits(snap.doc) });
      if (snap.state) this.states.set(pageId, snap.state);
    } finally {
      snap.doc.destroy();
    }
    return true;
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
   * lateral.
   */
  query(projectId: string, query: string, { limit = 50 }: { limit?: number } = {}): SearchResults {
    const words = parseWords(query);
    if (words.length === 0) return { hits: [], total: 0 };
    const scored: { hit: PageHit; group: number; count: number; order: number }[] = [];
    this.pagesOf(projectId).forEach((page, order) => {
      if (!this.visible(page.id, projectId)) return;
      const found = this.matchPage(page, words);
      if (found) scored.push({ ...found, order });
    });
    scored.sort((a, b) => a.group - b.group || b.count - a.count || a.order - b.order);
    return { hits: scored.slice(0, limit).map((s) => s.hit), total: scored.length };
  }

  private matchPage(page: PageRow, words: SearchWord[]): { hit: PageHit; group: number; count: number } | null {
    const title = page.title ?? '';
    const titleNorm = this.titleNorm(title);
    const inTitle = words.map((w) => findIn(titleNorm.text, w.norm, {}, titleNorm.map).length > 0);
    const units = this.entries.get(page.id)?.units ?? [];
    // Primero lo barato: qué bloques tienen el texto normalizado de cada palabra.
    const candidates = units.filter((u) => words.some((w) => u.folded.includes(w.norm)));
    const perUnit = new Map<IndexedUnit, [number, number][][]>();
    const inBody = words.map(() => false);
    for (const u of candidates) {
      u.norm ??= normalize(u.text);
      const lists = words.map((w) => (u.folded.includes(w.norm) ? searchNormalized(u.text, u.norm!, w.norm) : []));
      if (lists.every((l) => l.length === 0)) continue;
      lists.forEach((l, i) => {
        if (l.length > 0) inBody[i] = true;
      });
      perUnit.set(u, lists);
    }
    if (!words.every((_, i) => inTitle[i] || inBody[i])) return null;

    const matched = units.filter((u) => perUnit.has(u));
    let count = inTitle.filter(Boolean).length;
    for (const lists of perUnit.values()) for (const l of lists) count += l.length;
    // Los bloques con más palabras distintas primero (el mejor fragmento arriba: es adonde va la página); a
    // igualdad, en el orden del documento.
    const distinct = (u: IndexedUnit) => perUnit.get(u)!.filter((l) => l.length > 0).length;
    const shown = matched
      .map((u, i) => ({ u, i }))
      .sort((a, b) => distinct(b.u) - distinct(a.u) || a.i - b.i)
      .slice(0, SNIPPETS_PER_PAGE)
      .map(({ u }) => u);
    const snippets = shown.map((u) => this.snippet(u, perUnit.get(u)!, words, units));
    const group = inTitle.every(Boolean) ? 0 : inTitle.some(Boolean) ? 1 : 2;
    return {
      hit: {
        page,
        path: this.tree.ancestors(page.id),
        titleRanges: inTitle.some(Boolean) ? rangesOf(title, titleNorm, words) : [],
        snippets,
        more: matched.length - shown.length,
      },
      group,
      count,
    };
  }

  private snippet(unit: IndexedUnit, lists: [number, number][][], words: SearchWord[], units: IndexedUnit[]): Snippet {
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
    for (const u of units) {
      if (u === unit) break;
      if (u.blockId !== unit.blockId || !u.folded.includes(term.norm)) continue;
      u.norm ??= normalize(u.text);
      occurrence += searchNormalized(u.text, u.norm, term.norm).length;
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
      field: unit.field,
      // Un salto de línea adentro del bloque se ve como un espacio (mismo largo: los tramos no se corren).
      text: text.slice(start, end).replaceAll(SEPARATOR, ' '),
      ranges,
      cutStart: start > 0,
      cutEnd: end < text.length,
      term: term.raw,
      occurrence,
    };
  }
}
