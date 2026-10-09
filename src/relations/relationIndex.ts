import type { IndexedContent, IndexInfo } from '../search/projectIndex';
import type { PageRow } from '../sync/types';
import { INDEX_PAGE_MIN, readPageRelations, type LinkTarget, type Mention, type PageRelations, type Section } from './pageRelations';
import { aliasesFromFields, resolveLocationNames, type NameSource } from './aliases';
import { fieldValues, placeOf, readPageFields, type FieldName, type FieldValue, type PageFields } from './fields';
import { buildRegistry, type Hit, type Registry } from './reader';
import { registerProject, type PageRole, type Registration, type RegisterTree, type Stage } from './register';

// El índice de relaciones del proyecto abierto (Docs/Doc_Relaciones.md, sección 3). No lee documentos: usa lo que ya
// leyó el índice de la búsqueda (`ProjectIndex.content`) y le pasa el lector a cada página. Cada página se vuelve a
// reconocer solo si cambió lo leído, su episodio o lo que existe en el proyecto (el registro); todo cediendo el hilo.
// Nada de esto se guarda ni se sube: se arma en el dispositivo con lo que la persona ve.
//
// La consulta (`entityRelations`, `pendingRelations`, `pageRelations`) es pura sobre una foto (`RelationSnapshot`), para
// la cabecera de escena, locación y día (E3) y lo que venga después.

/** Cuánto se espera, después del último cambio de «Otros nombres» en una locación, para aplicarlo (D537). */
export const WRITTEN_WAIT_MS = 2000;

export interface RelationSource {
  /** Las páginas del proyecto que la persona ve ahora (sin la papelera), en el orden de la barra lateral. */
  pagesOf(projectId: string): PageRow[];
  content(pageId: string): IndexedContent | undefined;
  info(projectId: string): IndexInfo;
}

export interface RelationSnapshot {
  projectId: string;
  registry: Registry;
  registration: Registration;
  /** Las relaciones de cada página leída, visible y no excluida, en el orden de la barra lateral. */
  pages: Map<string, PageRelations>;
  /**
   * Los campos («rótulo: valor») y las coordenadas de esas mismas páginas, solo las que tienen alguno (`fields.ts`;
   * consultas: `pageFields`, `findFields`).
   */
  fields: Map<string, PageFields>;
  /** Páginas visibles que el índice todavía no leyó. */
  unread: number;
  /** Todo leído y nada por bajar: lo que dice la foto es todo lo que la persona puede ver. */
  complete: boolean;
}

interface Memo {
  content: IndexedContent;
  key: string;
  rel: PageRelations;
  /** Lo reconocido por texto de unidad (para releer solo lo que cambió). */
  scans: Map<string, Hit[]>;
  /** Los campos: dependen solo de lo leído (no de lo que existe en el proyecto). */
  fields: PageFields | null;
}

export class RelationIndex {
  private readonly memo = new Map<string, Memo>();
  private snap: RelationSnapshot | null = null;
  private readonly listeners = new Set<() => void>();
  private revision = 0;
  private running: Promise<void> | null = null;
  private again: string | null = null;
  private disposed = false;
  private world = '';
  private worldVersion = 0;

  constructor(
    private readonly tree: RegisterTree,
    private readonly source: RelationSource,
    private readonly options: { yieldMs?: number; writtenWaitMs?: number } = {},
  ) {}

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getRevision = (): number => this.revision;

  /** La última foto (o `null` antes de la primera, o si es de otro proyecto). */
  snapshot(projectId: string): RelationSnapshot | null {
    return this.snap && this.snap.projectId === projectId ? this.snap : null;
  }

  dispose(): void {
    this.disposed = true;
    if (this.writtenTimer) clearTimeout(this.writtenTimer);
    this.writtenTimer = null;
    this.memo.clear();
    this.snap = null;
    this.listeners.clear();
  }

  /** Vuelve a reconocer lo que haya cambiado. Si hay una pasada en curso, otra apenas termine. */
  update(projectId: string): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.running) {
      this.again = projectId;
      return this.running;
    }
    this.running = (async () => {
      let next: string | null = projectId;
      while (next && !this.disposed) {
        this.again = null;
        await this.run(next);
        next = this.again;
      }
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /**
   * Lo escrito en «Otros nombres» de una locación que se está usando: lo aplicado y lo último visto con su hora (D537:
   * mientras se escribe, lo nuevo se aplica 2 s después del último cambio).
   */
  private readonly written = new Map<string, { applied: string[]; akey: string; seen: string; since: number }>();
  private writtenTimer: ReturnType<typeof setTimeout> | null = null;

  /** Los nombres escritos que se usan ahora en una página de locación (y si hay que esperar, cuánto). */
  private writtenNow(pageId: string, names: string[], now: number, immediate: boolean): { use: string[]; wait: number } {
    const key = names.join('\u0001');
    const w = this.written.get(pageId);
    // La primera vez que se lee (al abrir el proyecto, una locación recién bajada): enseguida.
    if (!w || immediate) {
      this.written.set(pageId, { applied: names, akey: key, seen: key, since: now });
      return { use: names, wait: Infinity };
    }
    if (key === w.akey) {
      w.seen = key;
      return { use: w.applied, wait: Infinity };
    }
    if (key !== w.seen) {
      w.seen = key;
      w.since = now;
    }
    const left = w.since + (this.options.writtenWaitMs ?? WRITTEN_WAIT_MS) - now;
    if (left <= 0) {
      w.applied = names;
      w.akey = key;
      return { use: names, wait: Infinity };
    }
    return { use: w.applied, wait: left };
  }

  private async run(projectId: string): Promise<void> {
    const yieldMs = this.options.yieldMs ?? 12;
    const opening = !this.snap || this.snap.projectId !== projectId;
    if (this.snap && this.snap.projectId !== projectId) {
      this.memo.clear();
      this.written.clear();
    }
    const base = registerProject(this.tree, projectId);
    const visible = this.source.pagesOf(projectId);
    const visibleIds = new Set(visible.map((p) => p.id));
    // Los otros nombres de cada locación (D526–D528): solo de la página de la locación misma, si la persona la ve y ya
    // está leída (una todavía sin leer aporta lo suyo en la pasada siguiente). Sus campos se leen una sola vez.
    const preFields = new Map<string, PageFields | null>();
    const now = Date.now();
    let wait = Infinity;
    const sources: NameSource[] = base.titleLocations.map((l) => {
      const content = l.pageId && visibleIds.has(l.pageId) ? this.source.content(l.pageId) : undefined;
      if (!l.pageId || !content) return l;
      const memo = this.memo.get(l.pageId);
      const pf = memo && memo.content === content ? memo.fields : readPageFields(content.units, content.meta);
      preFields.set(l.pageId, pf);
      const got = this.writtenNow(l.pageId, aliasesFromFields(pf, l.name), now, opening);
      wait = Math.min(wait, got.wait);
      return got.use.length ? { ...l, written: got.use } : l;
    });
    for (const id of this.written.keys()) if (!visibleIds.has(id)) this.written.delete(id);
    if (this.writtenTimer) clearTimeout(this.writtenTimer);
    this.writtenTimer = null;
    if (wait !== Infinity) {
      this.writtenTimer = setTimeout(() => {
        this.writtenTimer = null;
        void this.update(projectId);
      }, wait);
    }
    const names = resolveLocationNames(sources);
    const registration: Registration = { ...base, locations: names.inputs };
    const registry = buildRegistry({ scenes: registration.scenes, locations: names.inputs, notes: names.notes });
    const targets = new Map<string, { kind: 'scene' | 'loc'; ref: string }>();
    for (const s of registration.scenes) if (s.pageId) targets.set(s.pageId, { kind: 'scene', ref: registry.scenes.get(s.code)?.code ?? s.code });
    for (const l of registration.locations) if (l.pageId) targets.set(l.pageId, { kind: 'loc', ref: l.name });
    const linkTarget: LinkTarget = (pageId) => targets.get(pageId) ?? null;
    // Lo que, si cambia, obliga a reconocer de nuevo todas las páginas: lo que existe y a qué página lleva cada link.
    const world = `${registry.signature}#${[...targets].map(([id, t]) => `${id}=${t.ref}`).join(',')}`;
    // Un número por cada «mundo» distinto: comparar el texto entero en cada página costaba más que reconocerla.
    if (world !== this.world) {
      this.world = world;
      this.worldVersion++;
    }
    const pages = new Map<string, PageRelations>();
    const fields = new Map<string, PageFields>();
    let unread = 0;
    let since = Date.now();
    for (const page of visible) {
      if (this.disposed) return;
      const role = registration.roles.get(page.id);
      if (role?.excluded) continue;
      const content = this.source.content(page.id);
      if (!content) {
        unread++;
        continue;
      }
      const key = `${this.worldVersion}|${role?.ep ?? ''}`;
      let memo = this.memo.get(page.id);
      if (!memo || memo.content !== content || memo.key !== key) {
        const scans = new Map<string, Hit[]>();
        // Con lo mismo que existe, lo ya reconocido de esta página sirve (la clave incluye el episodio).
        const prev = memo && memo.key === key ? memo.scans : undefined;
        const pageFields = memo && memo.content === content ? memo.fields : preFields.has(page.id) ? preFields.get(page.id)! : readPageFields(content.units, content.meta);
        // El valor de un campo de locación se lee como un lugar (D530).
        const place = placeOf(pageFields);
        memo = {
          content,
          key,
          scans,
          fields: pageFields,
          rel: readPageRelations(registry, content.units, content.meta, { ep: role?.ep ?? null, scans: { prev, next: scans }, place: place.size ? place : undefined }, linkTarget),
        };
        this.memo.set(page.id, memo);
      }
      pages.set(page.id, memo.rel);
      if (memo.fields) fields.set(page.id, memo.fields);
      if (Date.now() - since >= yieldMs) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        since = Date.now();
      }
    }
    for (const id of this.memo.keys()) if (!visibleIds.has(id)) this.memo.delete(id);
    const info = this.source.info(projectId);
    this.snap = { projectId, registry, registration, pages, fields, unread, complete: unread === 0 && !info.building && info.missing === 0 };
    this.revision++;
    for (const fn of this.listeners) fn();
  }
}

// --- Consultas (puras) --------------------------------------------------------------------------------------------

export interface EntityPage {
  pageId: string;
  stage: Stage;
  /** Una página índice (nombra más de 20 escenas y locaciones): la cabecera la pliega. */
  indexPage: boolean;
  /** La página es la entidad misma o parte de ella (sus fichas, sus scoutings). */
  own: boolean;
  /** Dónde la nombra: título de sección, texto o link, bloque por bloque. */
  mentions: Mention[];
  /** Las secciones que son de esta escena (la más externa de cada tramo). */
  sections: Section[];
}

export interface EntityRelations {
  kind: 'scene' | 'loc';
  ref: string;
  /** La página de la entidad, si existe. */
  pageId: string | null;
  pages: EntityPage[];
  byStage: Record<Stage, EntityPage[]>;
  /** Las fotos de sus secciones, por sección (solo escenas). */
  photos: { pageId: string; sectionBlockId: string; media: string[] }[];
  complete: boolean;
}

const isOwn = (role: PageRole | undefined, kind: 'scene' | 'loc', ref: string): boolean => {
  const k = kind === 'loc' ? 'location' : 'scene';
  return (role?.entity?.kind === k && role.entity.ref === ref) || (role?.partOf?.kind === k && role.partOf.ref === ref);
};

/** Todo lo que el proyecto dice de una escena (`101_074`) o de una locación (su nombre). */
export function entityRelations(snap: RelationSnapshot, kind: 'scene' | 'loc', ref: string): EntityRelations {
  const pages: EntityPage[] = [];
  const photos: EntityRelations['photos'] = [];
  for (const [pageId, rel] of snap.pages) {
    const mentions = rel.mentions.filter((m) => m.kind === kind && m.ref === ref);
    const sections =
      kind === 'scene'
        ? rel.sections.filter((s, i) => {
            if (!s.scenes.some((x) => x.kind === 'scene' && x.ref === ref)) return false;
            // La más externa: no está adentro de otra sección de la misma escena.
            return !rel.sections.some((o, j) => j < i && o.block < s.block && o.end >= s.end && o.scenes.some((x) => x.kind === 'scene' && x.ref === ref));
          })
        : [];
    if (mentions.length === 0 && sections.length === 0) continue;
    const role = snap.registration.roles.get(pageId);
    pages.push({ pageId, stage: role?.stage ?? 'other', indexPage: rel.entities > INDEX_PAGE_MIN, own: isOwn(role, kind, ref), mentions, sections });
    for (const s of sections) if (s.media.length) photos.push({ pageId, sectionBlockId: s.blockId, media: s.media });
  }
  const byStage: Record<Stage, EntityPage[]> = { breakdown: [], scouting: [], shoot: [], location: [], other: [] };
  for (const p of pages) byStage[p.stage].push(p);
  const entry = kind === 'scene' ? snap.registry.scenes.get(ref) : snap.registry.locations.get(ref);
  return { kind, ref, pageId: entry?.pageId ?? null, pages, byStage, photos, complete: snap.complete };
}

/** Las escenas nombradas que no existen (ni con letra): para *Map › Pending*. */
export function pendingRelations(snap: RelationSnapshot): { ref: string; pages: { pageId: string; blockIds: string[] }[] }[] {
  const by = new Map<string, Map<string, string[]>>();
  for (const [pageId, rel] of snap.pages) {
    for (const m of rel.mentions) {
      if (m.kind !== 'pending') continue;
      const pages = by.get(m.ref) ?? new Map<string, string[]>();
      by.set(m.ref, pages);
      const blocks = pages.get(pageId) ?? [];
      if (!blocks.includes(m.blockId)) blocks.push(m.blockId);
      pages.set(pageId, blocks);
    }
  }
  return [...by]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([ref, pages]) => ({ ref, pages: [...pages].map(([pageId, blockIds]) => ({ pageId, blockIds })) }));
}

/** Lo que nombra una página (para el subrayado de E6), si está leída y no excluida. */
export function pageRelations(snap: RelationSnapshot, pageId: string): PageRelations | undefined {
  return snap.pages.get(pageId);
}

/** Los campos y las coordenadas de una página (si está leída, visible, no excluida y tiene alguno). */
export function pageFields(snap: RelationSnapshot, pageId: string): PageFields | undefined {
  return snap.fields.get(pageId);
}

/**
 * Todas las páginas con un campo (por su nombre en `FIELD_LABELS` o una lista de rótulos), en el orden de la barra
 * lateral, cada valor con su página. Por ejemplo, las fichas con una *Fecha Rodaje* (`fieldDate(field.text)`).
 */
export function findFields(snap: RelationSnapshot, name: FieldName | readonly string[]): { pageId: string; field: FieldValue }[] {
  const out: { pageId: string; field: FieldValue }[] = [];
  for (const [pageId, page] of snap.fields) for (const field of fieldValues(page, name)) out.push({ pageId, field });
  return out;
}

/**
 * Los campos de las **fichas** (lo de adentro de una escena), con su escena: como `findFields`, sin las copias de fichas
 * que viven adentro de un día (un plan que pegó fichas) ni ninguna otra página. Para el día (E5): las fichas con una
 * *Fecha Rodaje* o la pregunta abierta de las escenas de mañana.
 */
export function cardFields(snap: RelationSnapshot, name: FieldName | readonly string[]): { pageId: string; scene: string; field: FieldValue }[] {
  const out: { pageId: string; scene: string; field: FieldValue }[] = [];
  for (const { pageId, field } of findFields(snap, name)) {
    const part = snap.registration.roles.get(pageId)?.partOf;
    if (part?.kind === 'scene' && part.ref) out.push({ pageId, scene: part.ref, field });
  }
  return out;
}

/** Las páginas índice del proyecto (más de 20 escenas y locaciones distintas). */
export function indexPages(snap: RelationSnapshot): string[] {
  return [...snap.pages].filter(([, rel]) => rel.entities > INDEX_PAGE_MIN).map(([id]) => id);
}
