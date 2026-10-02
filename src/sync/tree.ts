import { generateKeyBetween } from 'fractional-indexing';
import { t } from '../i18n';
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

/** Clave entre dos vecinos. Si dos dispositivos generaron la misma clave, igual devuelve una válida. */
export function keyBetween(before: string | null, after: string | null): string {
  try {
    return generateKeyBetween(before, after);
  } catch {
    return generateKeyBetween(before, null);
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
    if (current) pages.set(op.id, { ...current, ...op.patch, updated_at: now });
  }
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

  /** Se llama cuando entra un cambio local a la cola. */
  onQueued?: () => void;

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
    const [rows, ops, failed, projects] = await Promise.all([
      this.db.getAll('pages'),
      this.db.getAll('ops'),
      this.db.getAll('failedOps'),
      this.db.get('meta', PROJECTS_KEY) as Promise<ProjectRow[] | undefined>,
    ]);
    this.snapshot = new Map(rows.map((r) => [r.id, r]));
    this.projectSnapshot = new Map((projects ?? []).map((p) => [p.id, p]));
    this.projectsKnown = projects !== undefined;
    this.ops = ops;
    this.failed = failed;
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

  /** Crea una página adentro de `parentId`, o en la raíz de `projectId` (o del primer proyecto). */
  async create(parentId: string | null, title = '', projectId?: string): Promise<string> {
    const parent = parentId ? this.view.get(parentId) : undefined;
    const workspaceId = parent?.workspace_id ?? projectId ?? this.workspaceId;
    const siblings = this.siblingsIn(parentId, workspaceId);
    const last = siblings.at(-1)?.sort_key ?? null;
    const id = crypto.randomUUID();
    await this.enqueue({
      kind: 'create',
      page: { id, workspace_id: workspaceId, parent_id: parentId, title, sort_key: keyBetween(last, null) },
    });
    return id;
  }

  /** Crea un proyecto. Funciona sin red: sube antes que las páginas que se le creen. */
  async createProject(name: string): Promise<string> {
    const id = crypto.randomUUID();
    await this.enqueue({ kind: 'createProject', project: { id, name: name.trim() || t('project.untitled') } });
    return id;
  }

  async renameProject(id: string, name: string): Promise<void> {
    const next = name.trim();
    if (!next || this.projectView.get(id)?.name === next) return;
    await this.enqueue({ kind: 'renameProject', id, name: next });
  }

  /** Hermanas en un lugar del árbol; en la raíz, solo las del mismo proyecto. */
  private siblingsIn(parentId: string | null, workspaceId: string): PageRow[] {
    const list = this.childrenIndex.get(parentId) ?? [];
    return parentId ? list : list.filter((p) => p.workspace_id === workspaceId);
  }

  async rename(id: string, title: string): Promise<void> {
    if (this.view.get(id)?.title === title) return;
    await this.enqueue({ kind: 'update', id, patch: { title } });
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
    const sortKey = keyBetween(siblings[at - 1]?.sort_key ?? null, siblings[at]?.sort_key ?? null);
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
    await this.enqueue({ kind: 'update', id, patch: { settings } });
  }

  async setPatch(id: string, patch: PagePatch): Promise<void> {
    await this.enqueue({ kind: 'update', id, patch });
  }

  /** Hay cambios del árbol que todavía se están guardando en el dispositivo. */
  hasUnsavedWrites(): boolean {
    return this.writing > 0;
  }

  private async enqueue(op: TreeOp): Promise<void> {
    const queued: QueuedOp = { opId: crypto.randomUUID(), op, createdAt: Date.now() };
    this.writing++;
    try {
      queued.seq = await this.db.add('ops', queued);
    } finally {
      this.writing--;
    }
    this.ops.push(queued);
    this.recompute();
    this.onQueued?.();
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

  /** El servidor rechazó el cambio para siempre (por ejemplo, un movimiento que armaba un ciclo). */
  async failOp(op: QueuedOp, error: string): Promise<void> {
    const failed: FailedOp = { op: op.op, opSeq: op.seq, error, failedAt: Date.now() };
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
    const retry = this.failed.filter(only);
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
   * que tienen páginas creadas adentro (en la cola o rechazadas), y los cambios posteriores sobre ellos.
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
        keptCreates.includes(f) || ((f.op.kind === 'update' || f.op.kind === 'renameProject') && created.has(f.op.id)),
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
    this.recompute();
    if (projects) await this.adoptPrimary();
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
    this.revision++;
    for (const fn of this.listeners) fn();
  }
}
