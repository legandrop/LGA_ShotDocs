import { ImportPending, validUuid, matchesProjectIdentity, projectReceiptKey, projectOwnerKey } from './importIdentity';
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import { t } from '../i18n';
import { cutText } from '../lib/graphemes';
import { DB_LIMITS, splitTitle } from '../lib/dbLimits';
import { contentGap, serverSeqFor } from './clean';
import { GENERATION_KEY, type LocalDb } from './localDb';
import type { FailedOp, PagePatch, PageRow, PageSettings, ProjectRow, QueuedOp, TreeOp } from './types';

export function compareSiblings(a: PageRow, b: PageRow): number {
  if (a.sort_key !== b.sort_key) return a.sort_key < b.sort_key ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const PROJECTS_KEY = 'projects';
/** El primer proyecto del dispositivo (`services.ts`): se reemplaza si el servidor deja de mandarlo (P.14). */
const PRIMARY_KEY = 'workspaceId';
/**
 * Las páginas vacías creadas en este dispositivo (Docs/Doc_Plantillas.md, 4.1): solo en ellas aparece la tira
 * *Start from a template*. En otro dispositivo la página llega vacía, pero su creador puede estar llenándola sin red.
 */
const FRESH_KEY = 'templateOffer';
/** Cuántas se recuerdan (las más viejas se olvidan: una página vacía de hace cien páginas ya no ofrece nada). */
const FRESH_MAX = 50;
/** Lo que sobró de títulos largos y todavía no se escribió en su página (`TitleRest`). */
const TITLE_REST_KEY = 'titleRests';

/**
 * Lo que sobró de un título más largo que el tope de la base (500 caracteres, `DB_LIMITS.pageTitle`): espera en el
 * dispositivo hasta que `titleRest.ts` lo escribe al principio de su página. Se anota en la misma transacción que el
 * cambio de título: el título cortado nunca sale sin que lo que sobra quede guardado.
 */
export interface TitleRest {
  id: string;
  pageId: string;
  /** Lo que sobró, tal cual (con sus renglones si los tenía). */
  text: string;
  /** El título que quedó (para el aviso). */
  title: string;
  at: number;
}

/** Título aceptado que todavía no quedó guardado; pertenece sólo a esta instancia del árbol. */
export interface PendingTitleDraft {
  fullText: string;
  head: string;
  rest: string;
  busy: boolean;
}

type TitleDraft = Omit<PendingTitleDraft, 'busy'> & {
  restId: string;
  attempt: Promise<void> | null;
  durable: boolean;
};
type RestStore = { get(key: string): Promise<unknown>; put(value: unknown, key: string): Promise<unknown> };

async function readTitleRests(store: Pick<RestStore, 'get'>): Promise<TitleRest[]> {
  const value = await store.get(TITLE_REST_KEY);
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Lista de sobrantes de título ilegible');
  return value as TitleRest[];
}

function mergeTitleRests(current: TitleRest[], additions: TitleRest[]): TitleRest[] {
  const next = [...current];
  for (const rest of additions) {
    const previous = next.find((r) => r.id === rest.id);
    if (previous && (previous.pageId !== rest.pageId || previous.text !== rest.text || previous.title !== rest.title)) {
      throw new Error('Identidad de sobrante de título con otro contenido');
    }
    if (!previous) next.push(rest);
  }
  return next;
}

/**
 * El cambio con sus textos dentro de los topes de la base: el título de una página en 500 caracteres (lo que sobra
 * vuelve en `rest`) y el nombre de un proyecto en 200 (la app ya no deja escribir más). Sin nada que cortar, `null`.
 */
export function fitOp(op: TreeOp): { op: TreeOp; rest: string } | null {
  if (op.kind === 'create') {
    const { head, rest } = splitTitle(op.page.title);
    return rest ? { op: { ...op, page: { ...op.page, title: head } }, rest } : null;
  }
  if (op.kind === 'update') {
    if (typeof op.patch.title !== 'string') return null;
    const { head, rest } = splitTitle(op.patch.title);
    return rest ? { op: { ...op, patch: { ...op.patch, title: head } }, rest } : null;
  }
  const name = op.kind === 'createProject' ? op.project.name : op.name;
  const cut = cutText(name, DB_LIMITS.projectName);
  if (cut === name) return null;
  return op.kind === 'createProject'
    ? { op: { ...op, project: { ...op.project, name: cut } }, rest: '' }
    : { op: { ...op, name: cut }, rest: '' };
}

/**
 * El servidor rechazó el cambio por un tope de largo de la base (`pages_title_check`, `workspaces_name_length`) y el
 * cambio pasa el tope: lo arregla `PageTree.repairRejected`. Un rechazo por otra causa (permisos, ciclo) no se toca.
 */
export function isLengthRejection(f: FailedOp): boolean {
  return /\b(pages_title_check|workspaces_name_length)\b/.test(f.error) && fitOp(f.op) !== null;
}

/**
 * Dos `updated_at` del servidor son el mismo momento. Sin el primero (`null` o sin guardar) no hay con qué comparar:
 * no lo son. Igualdad, no "antes o después": los dos salen del mismo reloj, y cualquier diferencia es un cambio.
 */
export function sameInstant(was: string | null | undefined, now: string): boolean {
  if (typeof was !== 'string') return false;
  if (was === now) return true;
  const a = Date.parse(was);
  return Number.isFinite(a) && a === Date.parse(now);
}

/** La página a la que va lo que sobró del título de un cambio. */
function restPage(op: TreeOp): string | null {
  return op.kind === 'create' ? op.page.id : op.kind === 'update' ? op.id : null;
}

/** Clave entre dos vecinos. Si dos dispositivos generaron la misma clave, igual devuelve una válida. */
export function keyBetween(before: string | null, after: string | null): string {
  try {
    return generateKeyBetween(before, after);
  } catch {
    return generateKeyBetween(before, null);
  }
}

/**
 * Claves nuevas para el hueco `at` y las hermanas de alrededor, cuando la clave del hueco ya no entra en la base. La
 * ventana crece desde el hueco hacia el lado de la vecina con la clave más larga (de ahí viene el problema: muchas
 * páginas puestas en el mismo hueco) hasta que las claves nuevas, entre las dos vecinas que quedan afuera y no se
 * tocan, ocupan como mucho la mitad del tope. Así se rehacen solo las que se amontonaron, no toda la lista. Devuelve
 * desde qué hermana empieza la ventana y sus claves, una más que hermanas: la de `at - from` es la del hueco.
 */
export function rekeyWindow(siblings: Pick<PageRow, 'sort_key'>[], at: number): { from: number; keys: string[] } {
  const roomy = DB_LIMITS.pageSortKey / 2;
  let from = at;
  let to = at;
  for (;;) {
    const lower = siblings[from - 1]?.sort_key ?? null;
    const upper = siblings[to]?.sort_key ?? null;
    const whole = lower === null && upper === null;
    try {
      const keys = generateNKeysBetween(lower, upper, to - from + 1);
      if (whole || keys.every((k) => k.length <= roomy)) return { from, keys };
    } catch {
      // Dos vecinas con la misma clave (las generaron dos dispositivos a la vez): se agranda la ventana.
    }
    const step = Math.max(1, Math.ceil((to - from) / 4));
    if (lower !== null && (upper === null || lower.length >= upper.length)) from = Math.max(0, from - step);
    else to = Math.min(siblings.length, to + step);
  }
}

/** Páginas que son su propio ancestro. El servidor no lo permite, pero la vista no puede colgarse si pasa. */
function pagesInCycles(pages: Map<string, PageRow>): Set<string> {
  const result = new Set<string>();
  const done = new Set<string>();
  for (const start of pages.keys()) {
    const path: string[] = [];
    const onPath = new Set<string>();
    let cur: string | null | undefined = start;
    while (cur && pages.has(cur) && !done.has(cur)) {
      if (onPath.has(cur)) {
        for (const id of path.slice(path.indexOf(cur))) result.add(id);
        break;
      }
      onPath.add(cur);
      path.push(cur);
      cur = pages.get(cur)!.parent_id;
    }
    for (const id of path) done.add(id);
  }
  return result;
}

function applyOp(pages: Map<string, PageRow>, projects: Map<string, ProjectRow>, op: TreeOp, now: string): void {
  if (op.kind === 'createProject') {
    if (!projects.has(op.project.id)) projects.set(op.project.id, { ...op.project, created_at: now });
  } else if (op.kind === 'renameProject') {
    // Un dispositivo que todavía no bajó la lista de proyectos igual muestra el nombre nuevo.
    const current = projects.get(op.id) ?? { id: op.id, name: op.name, created_at: '' };
    projects.set(op.id, { ...current, name: op.name });
  } else if (op.kind === 'create') {
    if (pages.has(op.page.id)) return;
    pages.set(op.page.id, {
      ...op.page,
      icon: null,
      settings: {},
      update_seq: 0,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    });
  } else {
    const current = pages.get(op.id);
    if (!current) return;
    const next = { ...current, ...op.patch, updated_at: now };
    // Un cambio de ajustes por clave se aplica sobre los que tenga la fila: los de otra clave que llegaron mientras
    // esperaba en la cola siguen a la vista, como van a quedar en el servidor.
    if (op.settingsKeys && op.patch.settings) next.settings = mergeSettings(current.settings, op.patch.settings, op.settingsKeys);
    pages.set(op.id, next);
  }
}

/** `current` con las claves `keys` como están en `changed`: la que no está ahí se saca. Lo mismo que hace la base. */
export function mergeSettings(current: PageSettings | undefined, changed: PageSettings, keys: string[]): PageSettings {
  const merged: Record<string, unknown> = { ...current };
  const source = changed as Record<string, unknown>;
  for (const key of keys) {
    if (source[key] === undefined) delete merged[key];
    else merged[key] = source[key];
  }
  return merged as PageSettings;
}

/**
 * El nombre de un proyecto como se guarda. Normalizar lo ya normalizado da lo mismo (se corta y recién después se
 * sacan los espacios de las puntas): la importación reserva el proyecto con este nombre y lo compara tal cual.
 */
export function normalizeProjectName(name: string): string {
  return cutText(name.trim(), DB_LIMITS.projectName).trim() || t('project.untitled');
}

/**
 * El árbol que se ve es la última copia que mandó el servidor más los cambios locales que todavía están
 * en la cola de salida. Cuando el servidor confirma un cambio, sale de la cola y pasa a la copia.
 */
export class PageTree {
  private snapshot = new Map<string, PageRow>();
  private projectSnapshot = new Map<string, ProjectRow>();
  private projectView = new Map<string, ProjectRow>();
  private writing = 0;
  private statsCache: Map<string, { pages: number; updatedAt: string | null }> | null = null;
  private ops: QueuedOp[] = [];
  private failed: FailedOp[] = [];
  private view = new Map<string, PageRow>();
  private childrenIndex = new Map<string | null, PageRow[]>();
  private listeners = new Set<() => void>();
  private revision = 0;
  /** El dispositivo ya bajó alguna vez la lista de proyectos (guardada en `meta`). */
  private projectsKnown = false;
  private primary: string;
  private fresh: string[] = [];
  private rests: TitleRest[] = [];
  private titleDrafts = new Map<string, TitleDraft>();

  /** Se llama cuando entra un cambio local a la cola. */
  onQueued?: () => void;

  /** Se llama cuando queda anotado algo que sobró de un título (`titleRest.ts` lo escribe en la página). */
  onTitleRest?: () => void;

  /**
   * Si a este dispositivo la página le llega como base limpia y no como filas (Docs/Doc_Privacidad_Borrado.md): lo
   * pone la sincronización según el interruptor del workspace y los permisos. Sin él, todas llegan como filas.
   */
  baseReader: ((pageId: string) => boolean) | null = null;

  constructor(
    private readonly db: LocalDb,
    /** El primer proyecto del usuario: ahí va una página nueva sin padre si no se indica otro. */
    workspaceId: string,
  ) {
    this.primary = workspaceId;
  }

  /**
   * El primer proyecto del dispositivo: ahí va una página nueva sin padre si no se indica otro, y es al que
   * cae la app sin otro elegido. Si la lista del servidor deja de traerlo (lo borraron o dejaron de
   * compartirlo, P.14), pasa a ser el primero activo de la lista (`adoptPrimary`).
   */
  get workspaceId(): string {
    return this.primary;
  }

  async load(): Promise<void> {
    const [rows, ops, failed, projects, fresh, rests] = await Promise.all([
      this.db.getAll('pages'),
      this.db.getAll('ops'),
      this.db.getAll('failedOps'),
      this.db.get('meta', PROJECTS_KEY) as Promise<ProjectRow[] | undefined>,
      this.db.get('meta', FRESH_KEY).catch(() => undefined),
      this.db.get('meta', TITLE_REST_KEY) as Promise<TitleRest[] | undefined>,
    ]);
    this.fresh = Array.isArray(fresh) ? fresh.filter((id): id is string => typeof id === 'string') : [];
    this.snapshot = new Map(rows.map((r) => [r.id, r]));
    this.projectSnapshot = new Map((projects ?? []).map((p) => [p.id, p]));
    this.projectsKnown = projects !== undefined;
    this.ops = ops;
    this.failed = failed;
    this.rests = Array.isArray(rests) ? rests : [];
    await this.repairQueued();
    this.recompute();
    await this.adoptPrimary();
  }

  // --- lectura -------------------------------------------------------------------------------------

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getRevision = (): number => this.revision;

  get(id: string): PageRow | undefined {
    return this.view.get(id);
  }

  /**
   * La página vino en la última bajada del árbol: la sesión la ve en el servidor. Una creada acá que todavía no subió,
   * o una que el servidor dejó de mandar (sin permiso, en la papelera para quien no edita, de un proyecto borrado), no.
   */
  onServer(id: string): boolean {
    return this.snapshot.has(id);
  }

  /** Hasta qué `seq` del contenido de la página puede llegar este dispositivo (`serverSeqFor`, clean.ts). */
  serverSeq(row: PageRow): number {
    return serverSeqFor(row, this.baseReader?.(row.id) ?? false);
  }

  /** Lo que le falta a la página con este cursor: `missing`, `preparing` o `null` (`contentGap`, clean.ts). */
  contentGap(row: PageRow, cursor: number): 'missing' | 'preparing' | null {
    return contentGap(row, this.baseReader?.(row.id) ?? false, cursor);
  }

  /** Los proyectos, del más viejo al más nuevo. */
  projects(): ProjectRow[] {
    return [...this.projectView.values()].sort((a, b) =>
      a.created_at === b.created_at ? (a.id < b.id ? -1 : 1) : a.created_at < b.created_at ? -1 : 1,
    );
  }

  project(id: string): ProjectRow | undefined {
    return this.projectView.get(id);
  }

  /** Los proyectos de todos los días: sin los archivados (P.14). */
  activeProjects(): ProjectRow[] {
    return this.projects().filter((p) => !p.archived_at);
  }

  /** Los archivados, el último archivado primero. */
  archivedProjects(): ProjectRow[] {
    return this.projects()
      .filter((p) => !!p.archived_at)
      .sort((a, b) => (a.archived_at! < b.archived_at! ? 1 : a.archived_at! > b.archived_at! ? -1 : 0));
  }

  /**
   * El servidor ya mandó la lista y no hay ningún proyecto (ni uno creado en el dispositivo sin subir): la
   * app muestra la pantalla "sin proyectos" (P.14: a alguien le pueden borrar todos).
   */
  hasNoProjects(): boolean {
    return this.projectsKnown && this.projectView.size === 0;
  }

  /** Las páginas de primer nivel de un proyecto, ordenadas. Sin las que están en la papelera. */
  roots(projectId: string): PageRow[] {
    return this.children(null).filter((p) => p.workspace_id === projectId);
  }

  /** Cuántas páginas tiene un proyecto (sin la papelera) y cuándo se tocó por última vez. */
  projectStats(projectId: string): { pages: number; updatedAt: string | null } {
    if (!this.statsCache) {
      // Una sola pasada por árbol: se recalcula solo cuando el árbol cambia.
      const stats = new Map<string, { pages: number; updatedAt: string | null }>();
      for (const p of this.view.values()) {
        if (this.isTrashed(p.id)) continue;
        const s = stats.get(p.workspace_id) ?? { pages: 0, updatedAt: null };
        s.pages++;
        if (!s.updatedAt || p.updated_at > s.updatedAt) s.updatedAt = p.updated_at;
        stats.set(p.workspace_id, s);
      }
      this.statsCache = stats;
    }
    return this.statsCache.get(projectId) ?? { pages: 0, updatedAt: null };
  }

  /** Hijas de una página (o raíces con `null`), ordenadas. Sin las que están en la papelera. */
  children(parentId: string | null): PageRow[] {
    return (this.childrenIndex.get(parentId) ?? []).filter((p) => !p.deleted_at);
  }

  /** Está en la papelera ella o alguno de sus ancestros. */
  isTrashed(id: string): boolean {
    return this.trashedAncestor(id) !== undefined;
  }

  /** La página más cercana (ella misma o un ancestro) que está en la papelera. */
  trashedAncestor(id: string): PageRow | undefined {
    const seen = new Set<string>();
    for (let p = this.view.get(id); p && !seen.has(p.id); p = p.parent_id ? this.view.get(p.parent_id) : undefined) {
      if (p.deleted_at) return p;
      seen.add(p.id);
    }
    return undefined;
  }

  /** Páginas enviadas a la papelera directamente (no las que están adentro de otra borrada). */
  trashed(projectId?: string): PageRow[] {
    return [...this.view.values()]
      .filter((p) => !projectId || p.workspace_id === projectId)
      .filter((p) => p.deleted_at && !(p.parent_id && this.isTrashed(p.parent_id)))
      .sort((a, b) => (a.deleted_at! < b.deleted_at! ? 1 : -1));
  }

  /** De la raíz hasta la página, sin incluirla. */
  ancestors(id: string): PageRow[] {
    const out: PageRow[] = [];
    const seen = new Set<string>();
    for (let p = this.view.get(id); p?.parent_id && !seen.has(p.parent_id); ) {
      seen.add(p.parent_id);
      p = this.view.get(p.parent_id);
      if (p) out.unshift(p);
    }
    return out;
  }

  /**
   * El ajuste que vale para `id`: el suyo o el del ancestro más cercano que lo defina. `from` es la
   * página que lo define. Un valor que `valid` rechaza (de otra versión de la app, por ejemplo) cuenta
   * como no puesto y se sigue buscando más arriba. Sin ninguno, `undefined`.
   */
  resolveSetting<K extends keyof PageSettings>(
    id: string,
    key: K,
    valid: (value: unknown) => value is NonNullable<PageSettings[K]>,
  ): { value: NonNullable<PageSettings[K]>; from: PageRow } | undefined {
    const chain = [this.view.get(id), ...this.ancestors(id).reverse()];
    for (const page of chain) {
      const value: unknown = page?.settings?.[key];
      if (page && valid(value)) return { value, from: page };
    }
    return undefined;
  }

  isDescendant(id: string, ofId: string): boolean {
    return this.ancestors(id).some((p) => p.id === ofId);
  }

  pendingOps(): QueuedOp[] {
    return [...this.ops];
  }

  failedOps(): FailedOp[] {
    return [...this.failed];
  }

  /** El proyecto se creó en este dispositivo y todavía no volvió del servidor (en la cola o rechazado). */
  isLocalProject(projectId: string): boolean {
    const isCreate = (op: TreeOp) => op.kind === 'createProject' && op.project.id === projectId;
    return this.ops.some((o) => isCreate(o.op)) || this.failed.some((f) => isCreate(f.op));
  }

  /** La página todavía no existe en el servidor: su creación está en la cola o fue rechazada. */
  hasUnsentCreate(pageId: string): boolean {
    const isCreate = (op: TreeOp) => op.kind === 'create' && op.page.id === pageId;
    return this.ops.some((o) => isCreate(o.op)) || this.failed.some((f) => isCreate(f.op));
  }

  // --- cambios locales -----------------------------------------------------------------------------

  /**
   * Crea una página adentro de `parentId`, o en la raíz de `projectId` (o del primer proyecto). Una página sin título
   * ni plantilla (la del "+") queda anotada como recién creada acá (`isFresh`): ofrece las plantillas. Va al final, o
   * justo antes de la hermana `before` (el reporte del día con una fecha anterior, Doc_Plantillas.md 6.5).
   *
   * Con `id` (el que una importación reservó antes de crearla), crear dos veces es crear una: si la página ya está
   * (en el árbol o con su alta en la cola), no se encola nada y vuelve el mismo id.
   */
  async create(
    parentId: string | null,
    title = '',
    projectId?: string,
    options: { templateId?: string; before?: string; id?: string } = {},
  ): Promise<string> {
    const parent = parentId ? this.view.get(parentId) : undefined;
    const workspaceId = parent?.workspace_id ?? projectId ?? this.workspaceId;
    if (options.id !== undefined) {
      if (!validUuid(options.id)) throw new ImportPending('invalid');
      const existing = this.view.get(options.id);
      // Un id reservado nunca toma una página de otro proyecto.
      if (existing && existing.workspace_id !== workspaceId) throw new ImportPending('changed');
      if (existing || this.hasUnsentCreate(options.id)) return options.id;
    }
    const siblings = this.siblingsIn(parentId, workspaceId);
    const at = options.before ? siblings.findIndex((p) => p.id === options.before) : -1;
    const sortKey = await this.keyAt(siblings, at >= 0 ? at : siblings.length);
    const id = options.id ?? crypto.randomUUID();
    const page = { id, workspace_id: workspaceId, parent_id: parentId, title, sort_key: sortKey };
    // Antes de encolar: la página se dibuja apenas entra a la cola y ya tiene que saberse nueva.
    if (!title && !options.templateId) this.fresh = [...this.fresh.filter((f) => f !== id), id].slice(-FRESH_MAX);
    await this.enqueue({ kind: 'create', page: options.templateId ? { ...page, template_id: options.templateId } : page });
    if (!title && !options.templateId) await this.saveFresh();
    return id;
  }

  /** La página se creó vacía en este dispositivo y todavía no se llenó (Docs/Doc_Plantillas.md, 4.1). */
  isFresh(id: string): boolean {
    return this.fresh.includes(id);
  }

  /** La página ya no es "recién creada" (se escribió en ella o se le aplicó una plantilla). */
  async dropFresh(id: string): Promise<void> {
    if (!this.fresh.includes(id)) return;
    this.fresh = this.fresh.filter((f) => f !== id);
    this.notify();
    await this.saveFresh();
  }

  /** Solo una comodidad: si no se puede guardar, la tira se ofrece hasta cerrar la app y nada más. */
  private async saveFresh(): Promise<void> {
    try {
      await this.db.put('meta', this.fresh, FRESH_KEY);
    } catch {
      // Sin espacio o la base cerrada: no es un dato de la persona.
    }
  }

  /** Crea un proyecto. Funciona sin red: sube antes que las páginas que se le creen. */
  async createProject(name: string, reserved?: { projectId: string; operationId: string }): Promise<string> {
    const id = reserved?.projectId ?? crypto.randomUUID();
    const projectName = normalizeProjectName(name);
    if (!reserved) {
      await this.enqueue({ kind: 'createProject', project: { id, name: projectName } });
      return id;
    }
    if (!validUuid(id) || !validUuid(reserved.operationId)) throw new ImportPending('invalid');
    const opId = reserved.operationId;
    const op: TreeOp = { kind: 'createProject', project: { id, name: projectName } };
    const tx = this.db.transaction(['ops', 'meta'], 'readwrite');
    let replay = false;
    void tx.done.catch(() => undefined);
    this.writing++;
    try {
      const meta = tx.objectStore('meta'), ops = tx.objectStore('ops');
      const [receipt, owner] = await Promise.all([meta.get(projectReceiptKey(opId)), meta.get(projectOwnerKey(id))]);
      if (receipt !== undefined || owner !== undefined) {
        if (!matchesProjectIdentity(receipt, owner, { projectId: id, operationId: opId, projectName })) throw new ImportPending('changed');
        replay = true;
      } else {
        const queued = await ops.getAll();
        const projects = await meta.get(PROJECTS_KEY) as ProjectRow[] | undefined;
        if (queued.some(q => q.opId === opId || q.op.kind === 'createProject' && q.op.project.id === id)
          || projects?.some(p => p.id === id)) throw new ImportPending('changed');
        const seq = await ops.add({ opId, op, createdAt: Date.now() });
        await meta.put({ receiptVersion: 1, opId, op, seq }, projectReceiptKey(opId));
        await meta.put({ ownerVersion: 1, projectId: id, operationId: opId }, projectOwnerKey(id));
      }
      await tx.done;
    } catch (error) {
      try {
      tx.abort();
    } catch { /* La TX puede haber terminado. */
    }
      await tx.done.catch(() => undefined);
      throw error;
    } finally {
    this.writing--;
  }
    await this.load();
    if (!replay && !this.project(id)) throw new ImportPending('changed');
    this.onQueued?.();
    return id;
  }

  async renameProject(id: string, name: string): Promise<void> {
    const next = cutText(name.trim(), DB_LIMITS.projectName);
    if (!next || this.projectView.get(id)?.name === next) return;
    await this.enqueue({ kind: 'renameProject', id, name: next });
  }

  /**
   * La clave para quedar en la posición `at` entre `siblings`. La clave entre dos vecinas se alarga cada vez que se pone
   * algo en el mismo hueco: después de unas 600 veces pasaría los 128 caracteres que acepta la base y el cambio quedaría
   * rechazado para siempre. Antes de eso, las hermanas de alrededor del hueco reciben claves nuevas y parejas, en el
   * mismo orden (`rekeyWindow`): solo las que hace falta, para no pisar el lugar de otras que movió otro dispositivo.
   */
  private async keyAt(siblings: PageRow[], at: number): Promise<string> {
    const key = keyBetween(siblings[at - 1]?.sort_key ?? null, siblings[at]?.sort_key ?? null);
    if (key.length <= DB_LIMITS.pageSortKey) return key;
    const { from, keys } = rekeyWindow(siblings, at);
    const others = keys.filter((_, i) => i !== at - from);
    for (const [i, key] of others.entries()) {
      const sibling = siblings[from + i];
      if (sibling.sort_key !== key) await this.enqueue({ kind: 'update', id: sibling.id, patch: { sort_key: key } });
    }
    return keys[at - from];
  }

  /** Hermanas en un lugar del árbol; en la raíz, solo las del mismo proyecto. */
  private siblingsIn(parentId: string | null, workspaceId: string): PageRow[] {
    const list = this.childrenIndex.get(parentId) ?? [];
    return parentId ? list : list.filter((p) => p.workspace_id === workspaceId);
  }

  /**
   * Cambia el título. Lo que pasa de 500 caracteres no se pierde: va al principio de la página (`TitleRest`). `rest` es
   * lo que ya cortó quien llama (el título de la página al pegar, con sus renglones) y va después de lo que sobre acá.
   */
  async rename(id: string, title: string, { rest = '' }: { rest?: string } = {}): Promise<void> {
    const fitted = splitTitle(title);
    if (this.view.get(id)?.title === fitted.head && !fitted.rest && !rest.trim()) return;
    await this.enqueue({ kind: 'update', id, patch: { title: fitted.head } }, fitted.rest + rest);
  }

  pendingTitleDraft(id: string): PendingTitleDraft | undefined {
    const draft = this.titleDrafts.get(id);
    return draft && (!draft.durable || draft.attempt) ? { fullText: draft.fullText, head: draft.head, rest: draft.rest, busy: !!draft.attempt } : undefined;
  }

  /** Todos los gestos del mismo intento esperan una sola TX; el resto conserva su id al reintentar. */
  saveTitleDraft(id: string, fullText: string): Promise<void> {
    let draft = this.titleDrafts.get(id);
    if (draft?.attempt) return draft.fullText === fullText ? draft.attempt : Promise.reject(new Error('El título todavía está guardando otro texto'));
    if (!draft || draft.fullText !== fullText) {
      const { head, rest } = splitTitle(fullText);
      draft = { fullText, head: head.replace(/\s+/g, ' ').trim(), rest, restId: crypto.randomUUID(), attempt: null, durable: false };
      this.titleDrafts.set(id, draft);
    }
    const saving = draft;
    const clear = () => { if (this.titleDrafts.get(id) === saving) this.titleDrafts.delete(id); };
    const write = saving.head === this.get(id)?.title && !saving.rest.trim()
      ? Promise.resolve().then(() => { saving.durable = true; })
      : this.enqueue({ kind: 'update', id, patch: { title: saving.head } }, saving.rest, saving.restId, () => { saving.durable = true; });
    saving.attempt = write.catch((err: unknown) => {
      if (!saving.durable) throw err;
      // Falló un aviso posterior: la TX ya confirmó; no se fabrica otro rest al reintentar.
      console.warn('[title] fallo posterior al guardado local', err);
    }).finally(() => {
      saving.attempt = null;
      if (saving.durable) clear();
    });
    return saving.attempt;
  }

  /** Mueve `id` adentro de `parentId`: antes o después de una hermana, o al final si no se indica. */
  async move(id: string, parentId: string | null, position: { before?: string; after?: string } = {}): Promise<void> {
    if (parentId === id || (parentId && this.isDescendant(parentId, id))) {
      throw new Error('A page cannot go inside itself.');
    }
    const page = this.view.get(id);
    if (!page) return;
    if (parentId && this.view.get(parentId)?.workspace_id !== page.workspace_id) {
      throw new Error('A page cannot move to another project.');
    }
    const siblings = this.siblingsIn(parentId, page.workspace_id).filter((p) => p.id !== id);
    let at = siblings.length;
    const anchor = position.before ?? position.after;
    const found = anchor ? siblings.findIndex((p) => p.id === anchor) : -1;
    if (found >= 0) at = position.before ? found : found + 1;
    const sortKey = await this.keyAt(siblings, at);
    if (page.parent_id === parentId && page.sort_key === sortKey) return;
    await this.enqueue({ kind: 'update', id, patch: { parent_id: parentId, sort_key: sortKey } });
  }

  async trash(id: string): Promise<void> {
    await this.enqueue({ kind: 'update', id, patch: { deleted_at: new Date().toISOString() } });
  }

  async restore(id: string): Promise<void> {
    await this.enqueue({ kind: 'update', id, patch: { deleted_at: null } });
  }

  /** Cambia un ajuste de la rama que empieza en `id`; `undefined` lo borra y vuelve a heredarse. */
  async setSetting<K extends keyof PageSettings>(id: string, key: K, value: PageSettings[K] | undefined): Promise<void> {
    const current = this.view.get(id);
    if (!current) return;
    const settings: PageSettings = { ...current.settings };
    if (value === undefined) delete settings[key];
    else settings[key] = value;
    if (JSON.stringify(settings) === JSON.stringify(current.settings ?? {})) return;
    await this.enqueue({ kind: 'update', id, patch: { settings }, settingsKeys: [key] });
  }

  async setPatch(id: string, patch: PagePatch): Promise<void> {
    await this.enqueue({ kind: 'update', id, patch });
  }

  /** Hay cambios del árbol que todavía se están guardando en el dispositivo. */
  hasUnsavedWrites(): boolean {
    return this.writing > 0 || [...this.titleDrafts.values()].some((draft) => !draft.durable);
  }

  /**
   * Pone el cambio en la cola, con sus textos dentro de los topes de la base (`fitOp`). Lo que sobra del título (y el
   * `extraRest` que cortó quien llama) se anota en la misma transacción, para ir al principio de la página.
   */
  private async enqueue(op: TreeOp, extraRest = '', restId?: string, onDurable?: () => void): Promise<void> {
    const fitted = fitOp(op);
    const final = fitted?.op ?? op;
    const queued: QueuedOp = { opId: crypto.randomUUID(), op: final, createdAt: Date.now() };
    const restText = (fitted?.rest ?? '') + extraRest;
    const pageId = restPage(final);
    const rest = pageId && restText.trim() ? { ...this.newRest(pageId, restText, final), ...(restId ? { id: restId } : {}) } : null;
    let confirmed: TitleRest[] | null = null;
    let alreadyWritten = false;
    this.writing++;
    try {
      if (rest) {
        const tx = this.db.transaction(['ops', 'meta'], 'readwrite');
        // Si rechaza una petición antes de llegar a `done`, se observa también el rechazo de la TX.
        void tx.done.catch(() => undefined);
        const current = await readTitleRests(tx.objectStore('meta'));
        confirmed = mergeTitleRests(current, [rest]);
        alreadyWritten = !!restId && current.some((r) => r.id === restId);
        if (!alreadyWritten) {
          queued.seq = await tx.objectStore('ops').add(queued);
          await tx.objectStore('meta').put(confirmed, TITLE_REST_KEY);
        }
        await tx.done;
      } else {
        queued.seq = await this.db.add('ops', queued);
      }
      onDurable?.();
    } finally {
      this.writing--;
    }
    if (!alreadyWritten) this.ops.push(queued);
    if (confirmed) await this.refreshTitleRests(confirmed);
    this.recompute();
    this.onQueued?.();
    if (rest) this.onTitleRest?.();
  }

  private newRest(pageId: string, text: string, op: TreeOp): TitleRest {
    const title = op.kind === 'create' ? op.page.title : op.kind === 'update' ? (op.patch.title ?? '') : '';
    return { id: crypto.randomUUID(), pageId, text, title, at: Date.now() };
  }

  private async refreshTitleRests(confirmed: TitleRest[]): Promise<void> {
    try {
      this.rests = await readTitleRests({ get: (key) => this.db.get('meta', key) });
    } catch (err) {
      // El recibo durable sigue siendo válido si no se pudo refrescar la vista local.
      this.rests = mergeTitleRests(this.rests, confirmed);
      console.warn('[titleRest] no se pudo refrescar la lista local', err);
    }
  }

  // --- lo que sobró de los títulos largos ------------------------------------------------------------

  /** Lo que sobró de títulos largos y todavía no se escribió en su página, del más viejo al más nuevo. */
  titleRests(): TitleRest[] {
    return [...this.rests];
  }

  /** Lo que sobró ya está escrito (y guardado) en su página: se olvida. */
  async doneTitleRest(id: string): Promise<void> {
    const tx = this.db.transaction('meta', 'readwrite');
    void tx.done.catch(() => undefined);
    const current = await readTitleRests(tx.store);
    const next = current.filter((r) => r.id !== id);
    if (next.length !== current.length) await tx.store.put(next, TITLE_REST_KEY);
    await tx.done;
    await this.refreshTitleRests(next);
  }

  /**
   * Al abrir: los cambios sin subir que guardó una versión anterior de la app con un título de más de 500 caracteres (o
   * un proyecto de más de 200) se cortan, y lo que sobra del título se anota para ir al principio de la página. Son lo
   * último que hizo la persona, así que se suben como cualquier otro cambio. Los ya rechazados los arregla
   * `repairRejected`, con el árbol del servidor a la vista (Docs/Doc_Sincronizacion.md, "Topes de largo").
   */
  private async repairQueued(): Promise<void> {
    const ops: QueuedOp[] = [];
    const rests: TitleRest[] = [];
    for (const o of this.ops) {
      const fitted = fitOp(o.op);
      if (!fitted) continue;
      ops.push({ ...o, op: fitted.op });
      const pageId = restPage(fitted.op);
      if (pageId && fitted.rest.trim()) rests.push(this.newRest(pageId, fitted.rest, fitted.op));
    }
    if (ops.length === 0) return;
    const tx = this.db.transaction(['ops', 'meta'], 'readwrite');
    void tx.done.catch(() => undefined);
    const merged = rests.length ? mergeTitleRests(await readTitleRests(tx.objectStore('meta')), rests) : null;
    for (const o of ops) await tx.objectStore('ops').put(o);
    if (merged) await tx.objectStore('meta').put(merged, TITLE_REST_KEY);
    await tx.done;
    const fixed = new Map(ops.map((o) => [o.seq, o]));
    this.ops = this.ops.map((o) => fixed.get(o.seq) ?? o);
    if (merged) await this.refreshTitleRests(merged);
  }

  /**
   * El título de la página pudo cambiar después de que el servidor rechazó `f`: lo cambió el servidor (otro
   * dispositivo, o esta persona al ver el rechazo) o hay un cambio de título posterior en este dispositivo. Del
   * servidor se mira si su `updated_at` sigue siendo el que tenía la fila al fallar (`rowUpdatedAt`): reloj del
   * servidor contra reloj del servidor, sin la hora del dispositivo, que puede ir adelantada horas y esconder un
   * renombre. `updated_at` cambia con el título, el lugar, la papelera o los ajustes, no con el contenido. En la duda
   * (otro valor, la fila no estaba, o un rechazo de una versión anterior que no guardó el dato) se toma como cambiado:
   * el texto largo va entero a la página y el título de ahora queda. Nada se pisa ni se pierde.
   */
  private titleChangedAfter(f: FailedOp): boolean {
    if (f.op.kind !== 'update') return false;
    const id = f.op.id;
    const row = this.snapshot.get(id);
    if (row && !sameInstant(f.rowUpdatedAt, row.updated_at)) return true;
    const later = (op: TreeOp, seq: number | undefined) =>
      op.kind === 'update' && op.id === id && op.patch.title !== undefined && (seq ?? Infinity) > (f.opSeq ?? -1);
    return this.ops.some((o) => later(o.op, o.seq)) || this.failed.some((g) => g !== f && later(g.op, g.opSeq));
  }

  /**
   * Con el árbol del servidor recién bajado (`setSnapshot`): los cambios rechazados por un tope de largo
   * (`isLengthRejection`; los dejó una versión anterior, o una pestaña vieja) se arreglan. Si el título no cambió
   * después del rechazo, el cambio vuelve a la cola en su lugar, cortado, y lo que sobra se anota para la página. Si
   * cambió (`titleChangedAfter`), el título más nuevo queda: el texto largo entero va al principio de la página y el
   * rechazo se descarta (lo demás que traía el cambio, si traía algo, vuelve a la cola). Nada se pierde y nada pisa un
   * título más nuevo. Todo en una transacción. Devuelve qué hubo, para avisar después de `recompute`.
   */
  private async repairRejected(): Promise<{ queued: boolean; rests: boolean }> {
    const targets = this.failed.filter(isLengthRejection);
    if (targets.length === 0) return { queued: false, rests: false };
    const requeued: { failed: FailedOp; op: QueuedOp }[] = [];
    const dropped: FailedOp[] = [];
    const rests: TitleRest[] = [];
    const queue = (f: FailedOp, op: TreeOp) => {
      const queued: QueuedOp = { opId: crypto.randomUUID(), op, createdAt: Date.now() };
      if (f.opSeq !== undefined) queued.seq = f.opSeq;
      requeued.push({ failed: f, op: queued });
    };
    for (const f of targets) {
      if (f.op.kind === 'update' && typeof f.op.patch.title === 'string' && this.titleChangedAfter(f)) {
        const { title: long, ...others } = f.op.patch;
        rests.push({ id: crypto.randomUUID(), pageId: f.op.id, text: long ?? '', title: this.snapshot.get(f.op.id)?.title ?? '', at: Date.now() });
        if (Object.keys(others).length > 0) queue(f, { ...f.op, patch: others });
        else dropped.push(f);
        continue;
      }
      const fitted = fitOp(f.op)!;
      queue(f, fitted.op);
      const pageId = restPage(fitted.op);
      if (pageId && fitted.rest.trim()) rests.push(this.newRest(pageId, fitted.rest, fitted.op));
    }
    const tx = this.db.transaction(['ops', 'failedOps', 'meta'], 'readwrite');
    void tx.done.catch(() => undefined);
    const merged = rests.length ? mergeTitleRests(await readTitleRests(tx.objectStore('meta')), rests) : null;
    for (const r of requeued) {
      r.op.seq = await tx.objectStore('ops').put(r.op);
      await tx.objectStore('failedOps').delete(r.failed.seq!);
    }
    for (const f of dropped) await tx.objectStore('failedOps').delete(f.seq!);
    if (merged) await tx.objectStore('meta').put(merged, TITLE_REST_KEY);
    await tx.done;
    const gone = new Set([...requeued.map((r) => r.failed), ...dropped]);
    this.ops = [...this.ops, ...requeued.map((r) => r.op)].sort((a, b) => a.seq! - b.seq!);
    this.failed = this.failed.filter((f) => !gone.has(f));
    if (merged) await this.refreshTitleRests(merged);
    return { queued: requeued.length > 0, rests: rests.length > 0 };
  }

  // --- sincronización ------------------------------------------------------------------------------

  /** El servidor confirmó el cambio: sale de la cola y queda en la copia local. */
  async ackOp(op: QueuedOp): Promise<void> {
    applyOp(this.snapshot, this.projectSnapshot, op.op, new Date().toISOString());
    const tx = this.db.transaction(['ops', 'pages', 'meta'], 'readwrite');
    await tx.objectStore('ops').delete(op.seq!);
    if (op.op.kind === 'createProject' || op.op.kind === 'renameProject') {
      await tx.objectStore('meta').put([...this.projectSnapshot.values()], PROJECTS_KEY);
    } else {
      const row = this.snapshot.get(op.op.kind === 'create' ? op.op.page.id : op.op.id);
      if (row) await tx.objectStore('pages').put(row);
    }
    await tx.done;
    this.ops = this.ops.filter((o) => o.seq !== op.seq);
    this.recompute();
  }

  /**
   * El servidor rechazó el cambio para siempre (por ejemplo, un movimiento que armaba un ciclo). Uno rechazado por un
   * tope de largo (lo dejó una pestaña con una versión anterior) lo arregla `repairRejected` con el próximo árbol que
   * baje, mirando si el título cambió después.
   */
  async failOp(op: QueuedOp, error: string): Promise<void> {
    const failed: FailedOp = { op: op.op, opSeq: op.seq, error, failedAt: Date.now() };
    // Cómo estaba la fila al fallar (reloj del servidor): `titleChangedAfter` compara contra esto y no contra la hora
    // del dispositivo, que puede ir adelantada (Docs/Doc_Sincronizacion.md, "Topes de largo").
    if (op.op.kind === 'update') failed.rowUpdatedAt = this.snapshot.get(op.op.id)?.updated_at ?? null;
    const tx = this.db.transaction(['ops', 'failedOps'], 'readwrite');
    await tx.objectStore('ops').delete(op.seq!);
    failed.seq = await tx.objectStore('failedOps').add(failed);
    await tx.done;
    this.ops = this.ops.filter((o) => o.seq !== op.seq);
    this.failed.push(failed);
    this.recompute();
  }

  /**
   * Vuelve a poner en la cola, en el orden original, todo lo que el servidor rechazó (o solo lo que cumple `only`). Sin
   * nada que reintentar no escribe nada ni avisa.
   */
  async retryFailed(only: (f: FailedOp) => boolean = () => true): Promise<void> {
    // Los rechazados por un tope de largo no: volverían a fallar, y cómo estaba la fila al rechazarse es lo que dice si
    // el título cambió después (`repairRejected` los arregla con el próximo árbol que baje, que *Retry* pide enseguida).
    const retry = this.failed.filter((f) => only(f) && !isLengthRejection(f));
    if (retry.length === 0) return;
    const tx = this.db.transaction(['ops', 'failedOps'], 'readwrite');
    const queued: QueuedOp[] = [];
    for (const f of retry) {
      const op: QueuedOp = { opId: crypto.randomUUID(), op: f.op, createdAt: Date.now() };
      if (f.opSeq !== undefined) op.seq = f.opSeq;
      op.seq = await tx.objectStore('ops').put(op);
      await tx.objectStore('failedOps').delete(f.seq!);
      queued.push(op);
    }
    await tx.done;
    this.failed = this.failed.filter((f) => !retry.includes(f));
    this.ops = [...this.ops, ...queued].sort((a, b) => a.seq! - b.seq!);
    this.recompute();
    this.onQueued?.();
  }

  /**
   * Olvida los cambios rechazados que se pueden descartar sin perder nada (renombrar, mover, papelera, o
   * un proyecto rechazado que no tiene páginas creadas adentro). Una página rechazada nunca se descarta:
   * su contenido solo está en el dispositivo.
   */
  async dismissFailed(): Promise<void> {
    const keep = this.failedKeepers();
    const tx = this.db.transaction('failedOps', 'readwrite');
    await Promise.all(this.failed.filter((f) => !keep.has(f)).map((f) => tx.store.delete(f.seq!)));
    await tx.done;
    this.failed = this.failed.filter((f) => keep.has(f));
    this.recompute();
  }

  /**
   * Lo rechazado que no se puede descartar sin perder algo: creaciones de páginas, proyectos rechazados
   * que tienen páginas creadas adentro (en la cola o rechazadas), los cambios posteriores sobre ellos, y los rechazados
   * por un tope de largo (su texto todavía no está en la página: lo pone `repairRejected`).
   */
  private failedKeepers(): Set<FailedOp> {
    const pageOps = [...this.ops.map((o) => o.op), ...this.failed.map((f) => f.op)];
    const usedProjects = new Set(pageOps.flatMap((op) => (op.kind === 'create' ? [op.page.workspace_id] : [])));
    const keptCreates = this.failed.filter(
      (f) => f.op.kind === 'create' || (f.op.kind === 'createProject' && usedProjects.has(f.op.project.id)),
    );
    const created = new Set(
      keptCreates.flatMap((f) =>
        f.op.kind === 'create' ? [f.op.page.id] : f.op.kind === 'createProject' ? [f.op.project.id] : [],
      ),
    );
    return new Set(
      this.failed.filter((f) =>
        keptCreates.includes(f) ||
        isLengthRejection(f) ||
        ((f.op.kind === 'update' || f.op.kind === 'renameProject') && created.has(f.op.id)),
      ),
    );
  }

  // --- restauración de una copia de seguridad -------------------------------------------------------

  async knownGeneration(): Promise<number | undefined> {
    return (await this.db.get('meta', GENERATION_KEY)) as number | undefined;
  }

  async setKnownGeneration(generation: number): Promise<void> {
    await this.db.put('meta', generation, GENERATION_KEY);
  }

  /**
   * La base se restauró desde una copia: lo que se hizo después de esa copia ya no está en el servidor,
   * pero sí en la última copia del árbol que este dispositivo bajó. Vuelve a poner en la cola los
   * proyectos y las páginas que el servidor ya no tiene (primero los padres) y los cambios a páginas que
   * este dispositivo vio más nuevos que lo restaurado. Los renombres de proyectos no vuelven: el
   * servidor no dice cuándo se hicieron. Devuelve cuántos cambios puso en la cola.
   *
   * Con `allow` (los permisos del paso 9), no vuelve a crear lo que la persona ya no puede crear: el
   * servidor lo rechazaría. Esas creaciones se cuentan en `report.skipped` para avisarlo; su contenido
   * sigue en el dispositivo (se puede bajar como archivo).
   */
  async recoverAfterRestore(
    serverRows: PageRow[],
    serverProjects: ProjectRow[],
    allow?: { createProject: boolean; createPage: (parentId: string | null, projectId: string) => boolean },
    report?: { skipped: number },
  ): Promise<number> {
    const onServer = new Map(serverRows.map((r) => [r.id, r]));
    const projectsOnServer = new Set(serverProjects.map((p) => p.id));
    const ops: TreeOp[] = [];
    let skipped = 0;

    for (const p of this.projectSnapshot.values()) {
      if (projectsOnServer.has(p.id)) continue;
      if (allow && !allow.createProject) {
        skipped++;
        continue;
      }
      ops.push({ kind: 'createProject', project: { id: p.id, name: p.name } });
    }

    const depth = (row: PageRow): number => {
      let d = 0;
      const seen = new Set<string>();
      for (let cur = row.parent_id; cur && this.snapshot.has(cur) && !seen.has(cur); cur = this.snapshot.get(cur)!.parent_id) {
        seen.add(cur);
        d++;
      }
      return d;
    };
    const missing = [...this.snapshot.values()].filter((r) => !onServer.has(r.id)).sort((a, b) => depth(a) - depth(b));
    for (const r of missing) {
      if (allow && !allow.createPage(r.parent_id, r.workspace_id)) {
        skipped++;
        continue;
      }
      ops.push({
        kind: 'create',
        page: { id: r.id, workspace_id: r.workspace_id, parent_id: r.parent_id, title: r.title, sort_key: r.sort_key },
      });
      const patch: PagePatch = {};
      if (r.icon) patch.icon = r.icon;
      if (r.deleted_at) patch.deleted_at = r.deleted_at;
      if (r.settings && Object.keys(r.settings).length > 0) patch.settings = r.settings;
      // La plantilla con que se hizo (Doc_Plantillas.md): solo si hay una, nunca para borrarla.
      if (r.template_id) patch.template_id = r.template_id;
      if (Object.keys(patch).length > 0) ops.push({ kind: 'update', id: r.id, patch });
    }

    for (const r of this.snapshot.values()) {
      const server = onServer.get(r.id);
      if (!server || !(Date.parse(r.updated_at) > Date.parse(server.updated_at))) continue;
      const patch: PagePatch = {};
      if (r.title !== server.title) patch.title = r.title;
      if (r.icon !== server.icon) patch.icon = r.icon;
      if (r.parent_id !== server.parent_id) patch.parent_id = r.parent_id;
      if (r.sort_key !== server.sort_key) patch.sort_key = r.sort_key;
      if (r.deleted_at !== server.deleted_at) patch.deleted_at = r.deleted_at;
      if (r.settings && JSON.stringify(r.settings) !== JSON.stringify(server.settings ?? {})) patch.settings = r.settings;
      if (r.template_id && r.template_id !== server.template_id) patch.template_id = r.template_id;
      if (Object.keys(patch).length > 0) ops.push({ kind: 'update', id: r.id, patch });
    }

    if (report) report.skipped = skipped;
    await this.enqueueFirst(ops);
    return ops.length;
  }

  /**
   * Pone cambios en la cola ANTES de los que ya estaban. Lo recuperado es más viejo que lo que quedó en la
   * cola sin subir: si fuera después, un renombre en la cola lo pisaría el título de la copia, y una
   * página nueva en la cola adentro de una recuperada llegaría antes que su padre.
   */
  private async enqueueFirst(ops: TreeOp[]): Promise<void> {
    if (ops.length === 0) return;
    const moved = [...this.ops];
    const now = Date.now();
    const first: QueuedOp[] = ops.map((op) => ({ opId: crypto.randomUUID(), op, createdAt: now }));
    const again: QueuedOp[] = moved.map(({ seq: _seq, ...rest }) => rest);
    this.writing++;
    try {
      const tx = this.db.transaction('ops', 'readwrite');
      for (const o of moved) await tx.store.delete(o.seq!);
      for (const o of [...first, ...again]) o.seq = await tx.store.add(o);
      await tx.done;
    } finally {
      this.writing--;
    }
    const movedSeqs = new Set(moved.map((o) => o.seq));
    this.ops = [...first, ...again, ...this.ops.filter((o) => !movedSeqs.has(o.seq))];
    this.recompute();
    this.onQueued?.();
  }

  /** Reemplaza la copia local por el árbol completo (y los proyectos) que mandó el servidor. */
  async setSnapshot(rows: PageRow[], projects?: ProjectRow[]): Promise<void> {
    const tx = this.db.transaction(['pages', 'meta'], 'readwrite');
    const store = tx.objectStore('pages');
    await store.clear();
    await Promise.all(rows.map((r) => store.put(r)));
    if (projects) await tx.objectStore('meta').put(projects, PROJECTS_KEY);
    await tx.done;
    this.snapshot = new Map(rows.map((r) => [r.id, r]));
    if (projects) {
      this.projectSnapshot = new Map(projects.map((p) => [p.id, p]));
      this.projectsKnown = true;
    }
    // Con el árbol del servidor a la vista: los rechazados por un tope de largo (si los hay).
    const repaired = await this.repairRejected();
    this.recompute();
    if (projects) await this.adoptPrimary();
    if (repaired.queued) this.onQueued?.();
    if (repaired.rests) this.onTitleRest?.();
  }

  /**
   * Lo que acaba de confirmar la base al archivar o desarchivar (P.14), sin esperar a la próxima
   * sincronización: la lista cambia enseguida. La sincronización lo confirma igual.
   */
  async markArchived(projectId: string, archivedAt: string | null): Promise<void> {
    const current = this.projectSnapshot.get(projectId);
    if (!current) return;
    this.projectSnapshot.set(projectId, { ...current, archived_at: archivedAt });
    await this.db.put('meta', [...this.projectSnapshot.values()], PROJECTS_KEY);
    this.recompute();
  }

  /**
   * El proyecto se mandó a la papelera de proyectos (P.14): sale de la lista enseguida. Sus páginas siguen en
   * la copia del dispositivo hasta la próxima sincronización (que ya no las trae) y su contenido, en la base
   * local: nada se borra del dispositivo.
   */
  async forgetProject(projectId: string): Promise<void> {
    if (!this.projectSnapshot.delete(projectId)) return;
    await this.db.put('meta', [...this.projectSnapshot.values()], PROJECTS_KEY);
    this.recompute();
    await this.adoptPrimary();
  }

  /**
   * Si la lista conocida no trae el primer proyecto (y no es uno creado en el dispositivo sin subir), lo
   * reemplaza por el primero activo (o, si todos están archivados, el primero) y lo guarda. Sin ninguno,
   * queda como estaba: la app muestra "sin proyectos" (`hasNoProjects`).
   */
  private async adoptPrimary(): Promise<void> {
    if (!this.projectsKnown || this.projectView.has(this.primary)) return;
    const next = this.activeProjects()[0] ?? this.projects()[0];
    if (!next) return;
    this.primary = next.id;
    await this.db.put('meta', next.id, PRIMARY_KEY);
    this.recompute();
  }

  private recompute(): void {
    const view = new Map(this.snapshot);
    const projects = new Map(this.projectSnapshot);
    const now = new Date().toISOString();
    // Una página cuya creación fue rechazada sigue a la vista, con sus cambios: su contenido solo está en
    // el dispositivo. Un proyecto rechazado también sigue a la vista hasta que se lo descarta. Todo se
    // aplica en el orden en que se hizo.
    const keep = this.failedKeepers();
    const failedProjects = new Set(this.failed.flatMap((f) => (f.op.kind === 'createProject' ? [f.op.project.id] : [])));
    const visible = (f: FailedOp) =>
      keep.has(f) ||
      f.op.kind === 'createProject' ||
      (f.op.kind === 'renameProject' && failedProjects.has(f.op.id));
    const changes = [
      ...this.ops.map((o) => ({ seq: o.seq ?? 0, op: o.op })),
      ...this.failed.filter(visible).map((f) => ({ seq: f.opSeq ?? 0, op: f.op })),
    ].sort((a, b) => a.seq - b.seq);
    for (const change of changes) applyOp(view, projects, change.op, now);
    // El primer proyecto está aunque el dispositivo todavía no haya bajado nunca la lista (la primera vez sin
    // red). Con la lista conocida, no: si el servidor no lo trae (lo borraron, P.14), se reemplaza.
    if (!this.projectsKnown && !projects.has(this.workspaceId)) {
      projects.set(this.workspaceId, { id: this.workspaceId, name: t('project.defaultName'), created_at: '' });
    }
    this.projectView = projects;
    this.statsCache = null;

    const children = new Map<string | null, PageRow[]>();
    const inCycle = pagesInCycles(view);
    for (const page of view.values()) {
      // Una página cuyo padre no existe (todavía) o que quedó en un ciclo se muestra en la raíz, para no
      // perderla de vista.
      const parent = page.parent_id && view.has(page.parent_id) && !inCycle.has(page.id) ? page.parent_id : null;
      const list = children.get(parent);
      if (list) list.push(page);
      else children.set(parent, [page]);
    }
    for (const list of children.values()) list.sort(compareSiblings);

    this.view = view;
    this.childrenIndex = children;
    this.notify();
  }

  private notify(): void {
    this.revision++;
    for (const fn of this.listeners) fn();
  }
}
