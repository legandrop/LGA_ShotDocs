import type { PageTree } from '../sync/tree';
import type { PageRow } from '../sync/types';
import { LEVEL_VIEW } from '../sync/access';
import { BUILTIN_LOCATION, BUILTIN_SCENE } from '../templates/builtinIds';
import { entityMark, episodeOf, isEpisodeTitle, kindReader, type KindTree } from './kind';
import { fold, recognizedAlone, sceneCode as canonicalCode, type Registry } from './reader';
import { bareLocationName, locationFromTitle } from './register';

// Crear una escena o una locación que el texto nombra y no existe (Docs/Doc_Relaciones.md, sección 15; E7, D512–D517,
// D525). Una sola función de guardas (`createGuard`, pura) y una sola de crear (`createEntity`), usadas desde el `/`, el
// adelanto de un pendiente, la cabecera del día y *Map › Pending*.
//
// Las guardas existen para no duplicar una escena (C8 B3): con dos páginas de la misma escena las relaciones se parten.
// Se crea solo si:
// - G1: la persona ve el proyecto entero (creador o permiso sobre el proyecto; con los permisos todavía desconocidos, no).
//   Un invitado a una carpeta no puede saber si la escena existe en una página que no ve.
// - G2: el índice terminó de leer el proyecto.
// - G3: hay red y una sincronización buena en esta sesión. Antes de crear, además, se sincroniza en el momento y se
//   vuelve a mirar todo con el árbol recién bajado (otro dispositivo pudo crearla hace segundos).
// - G4: no existe en ningún lado del proyecto: ni en la papelera, ni fuera de las relaciones (`graph: false`), ni con
//   otra letra, ni la base (crear `105_120` con `105_120A` creada cambia cómo se leen los dos, D516).
// - G5: hay una sola carpeta destino y la persona puede crear ahí.
// Lo escrito nunca se pierde: si no se puede crear, el número queda escrito y pendiente.

export type CreateWant = { kind: 'scene'; code: string } | { kind: 'location'; name: string };

export type CreateReason =
  | 'partial'
  | 'reading'
  | 'offline'
  | 'exists'
  | 'trash'
  | 'archived'
  | 'letter'
  | 'base'
  | 'noFolder'
  | 'twoFolders'
  | 'cantCreate'
  | 'invalid';

export type GuardResult =
  | {
      ok: true;
      /** La carpeta donde se crea. */
      parentId: string;
      /** La hermana antes de la cual va (orden por número), o `undefined` (al final). */
      before?: string;
      /** El título de la página nueva. */
      title: string;
      /** Una locación con un nombre que no se reconoce solo en el texto (D525). */
      generic?: boolean;
    }
  | {
      ok: false;
      reason: CreateReason;
      /** La página que lo explica: la que ya existe, la de la papelera, la carpeta. */
      pageId?: string;
      /** El código que ya existe con otra letra (`letter`, `base`). */
      other?: string;
    };

/** Lo que las guardas leen del árbol. */
export type GuardTree = KindTree & Pick<PageTree, 'allRowsOf' | 'roots' | 'trashedAncestor'>;

export interface GuardPerms {
  readonly known: boolean;
  projectLevel(projectId: string): number;
  canCreateIn(parentId: string | null, projectId: string): boolean;
}

export interface GuardContext {
  tree: GuardTree;
  perms: GuardPerms;
  /** La foto del índice del proyecto (lo que la persona ve). */
  snap: { complete: boolean; registry: Registry } | null;
  sync: { online: boolean; lastSyncAt: number | null };
  projectId: string;
}

/** `105_120A` → `105_120`. */
const baseOf = (code: string) => code.replace(/[A-Z]+$/, '');

/** Una página o alguna de arriba está fuera de las relaciones (`graph: false`, D387). */
function graphOff(tree: GuardTree, row: PageRow): boolean {
  const seen = new Set<string>();
  for (let p: PageRow | undefined = row; p && !seen.has(p.id); p = p.parent_id ? tree.get(p.parent_id) : undefined) {
    if (p.settings?.graph === false) return true;
    seen.add(p.id);
  }
  return false;
}

/** Dónde está una página que ya existe: en la papelera, fuera de las relaciones o a la vista. */
function placeOf(tree: GuardTree, row: PageRow): { reason: 'trash' | 'archived' | 'exists'; pageId: string } {
  const trashed = tree.trashedAncestor(row.id);
  if (trashed) return { reason: 'trash', pageId: trashed.id };
  if (graphOff(tree, row)) {
    // La carpeta más alta fuera de las relaciones («90 | Archivo»), para nombrarla.
    let top = row;
    for (let p = row.parent_id ? tree.get(row.parent_id) : undefined; p; p = p.parent_id ? tree.get(p.parent_id) : undefined) if (p.settings?.graph === false) top = p;
    return { reason: 'archived', pageId: top.id };
  }
  return { reason: 'exists', pageId: row.id };
}

/**
 * Los códigos de escena que dice cada página del proyecto, en todo el árbol (también la papelera y lo de fuera de las
 * relaciones): su marca y el número de su título. Los días, las locaciones y las plantillas no cuentan. Una página
 * suelta que empieza con un número («105_120 | notas») también cuenta: se prefiere no ofrecer crear a duplicar.
 */
function sceneCodesInTree(tree: GuardTree, projectId: string): { code: string; row: PageRow }[] {
  const reader = kindReader(tree);
  const out: { code: string; row: PageRow }[] = [];
  for (const row of tree.allRowsOf(projectId)) {
    if (reader.excluded(row.id)) continue;
    const kind = reader.kindOf(row.id);
    // Lo de adentro de algo («parte de») cuenta igual: una escena metida adentro de otra página sigue siendo esa escena.
    if (kind.kind === 'day' || kind.kind === 'location') continue;
    const codes = new Set<string>();
    const mark = entityMark(row);
    if (mark && mark !== 'other' && mark.kind === 'scene' && mark.code) codes.add(mark.code);
    if (kind.kind === 'scene' && kind.code) codes.add(kind.code);
    const fromTitle = reader.titleCode(row.id);
    if (fromTitle) codes.add(fromTitle);
    for (const c of codes) {
      const code = canonicalCode(c) ?? c;
      out.push({ code, row });
    }
  }
  return out;
}

/** Las formas de un nombre de locación para comparar: el nombre, sus alias y el nombre sin el paréntesis (D416). */
function locationForms(title: string): string[] {
  const { name, aliases } = locationFromTitle(title);
  const bare = bareLocationName(name) ?? name.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  return [...new Set([name, ...aliases, bare].map((a) => fold(a).replace(/\s+/g, ' ').trim()).filter(Boolean))];
}

/** La carpeta que contiene más de estas páginas (si empatan dos, `null`: no se elige por la persona). */
function mostCommonParent(tree: GuardTree, pageIds: string[]): { id: string | null; tie: boolean } {
  const count = new Map<string, number>();
  for (const id of pageIds) {
    const row = tree.get(id);
    if (!row?.parent_id || tree.isTrashed(row.parent_id)) continue;
    count.set(row.parent_id, (count.get(row.parent_id) ?? 0) + 1);
  }
  const sorted = [...count].sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return { id: null, tie: false };
  if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) return { id: null, tie: true };
  return { id: sorted[0][0], tie: false };
}

/** Las carpetas marcadas con ese tipo, a la vista y dentro de las relaciones. */
function typedFolders(tree: GuardTree, projectId: string, holds: 'scene' | 'location'): PageRow[] {
  const reader = kindReader(tree);
  return tree
    .allRowsOf(projectId)
    .filter((row) => !tree.isTrashed(row.id) && !reader.excluded(row.id) && !graphOff(tree, row) && reader.holdsOf(row.id) === holds);
}

/** Dónde va una escena nueva (G5): la carpeta de sus hermanas del episodio, su grupo de episodio o la única *Scenes*. */
function sceneFolder(tree: GuardTree, projectId: string, registry: Registry, code: string): { id: string } | { reason: 'noFolder' | 'twoFolders' } {
  const ep = code.includes('_') ? code.slice(0, 3) : '';
  const siblings = [...registry.scenes.values()].filter((s) => s.ep === ep && s.pageId).map((s) => s.pageId!);
  const common = mostCommonParent(tree, siblings);
  if (common.id) return { id: common.id };
  if (common.tie) return { reason: 'twoFolders' };
  const folders = typedFolders(tree, projectId, 'scene');
  if (!folders.length) return { reason: 'noFolder' };
  if (ep) {
    const groups = folders.flatMap((f) => tree.children(f.id).filter((c) => isEpisodeTitle(c.title) && episodeOf(c.title) === ep));
    if (groups.length === 1) return { id: groups[0].id };
    if (groups.length > 1) return { reason: 'twoFolders' };
  }
  return folders.length === 1 ? { id: folders[0].id } : { reason: 'twoFolders' };
}

/** Dónde va una locación nueva: la carpeta de las otras locaciones, o la única *Locations*. */
function locationFolder(tree: GuardTree, projectId: string, registry: Registry): { id: string } | { reason: 'noFolder' | 'twoFolders' } {
  const common = mostCommonParent(tree, [...registry.locations.values()].flatMap((l) => (l.pageId ? [l.pageId] : [])));
  if (common.id) return { id: common.id };
  if (common.tie) return { reason: 'twoFolders' };
  const folders = typedFolders(tree, projectId, 'location');
  if (!folders.length) return { reason: 'noFolder' };
  return folders.length === 1 ? { id: folders[0].id } : { reason: 'twoFolders' };
}

/** La hermana antes de la cual va el código, si las escenas de la carpeta ya están en orden por número. */
function beforeSibling(tree: GuardTree, parentId: string, code: string): string | undefined {
  const reader = kindReader(tree);
  const coded = tree
    .children(parentId)
    .map((row) => ({ id: row.id, code: reader.kindOf(row.id).kind === 'scene' ? (reader.titleCode(row.id) ?? null) : null }))
    .filter((x): x is { id: string; code: string } => !!x.code);
  for (let i = 1; i < coded.length; i++) if (coded[i - 1].code > coded[i].code) return undefined;
  return coded.find((x) => x.code > code)?.id;
}

/** Las guardas G1–G5 (ver arriba), en orden. Pura: se vuelve a llamar en el momento de crear. */
export function createGuard(ctx: GuardContext, want: CreateWant): GuardResult {
  const { tree, perms, snap, sync, projectId } = ctx;
  // G1
  if (!perms.known || perms.projectLevel(projectId) < LEVEL_VIEW) return { ok: false, reason: 'partial' };
  // G2
  if (!snap || !snap.complete) return { ok: false, reason: 'reading' };
  // G3
  if (!sync.online || sync.lastSyncAt === null) return { ok: false, reason: 'offline' };
  // G4
  if (want.kind === 'scene') {
    const code = canonicalCode(want.code);
    if (!code || code !== want.code) return { ok: false, reason: 'invalid' };
    const ep = code.includes('_') ? code.slice(0, 3) : '';
    // Un episodio que no existe no se ofrece (el lector tampoco lo da por pendiente).
    if (ep ? !snap.registry.eps.has(ep) : !snap.registry.flat && snap.registry.eps.size > 0) return { ok: false, reason: 'invalid' };
    const base = baseOf(code);
    const found = sceneCodesInTree(tree, projectId).filter((x) => baseOf(x.code) === base);
    const same = found.find((x) => x.code === code);
    if (same) return { ok: false, ...placeOf(tree, same.row) };
    if (found.length) {
      const other = found[0];
      return { ok: false, reason: code === base ? 'letter' : 'base', other: other.code, pageId: other.row.id };
    }
    // G5
    const folder = sceneFolder(tree, projectId, snap.registry, code);
    if ('reason' in folder) return { ok: false, reason: folder.reason };
    if (!perms.canCreateIn(folder.id, projectId)) return { ok: false, reason: 'cantCreate', pageId: folder.id };
    return { ok: true, parentId: folder.id, before: beforeSibling(tree, folder.id, code), title: code };
  }
  const name = want.name.replace(/\s+/g, ' ').trim();
  if (fold(name).replace(/[^\p{L}\p{N}]/gu, '').length < 2) return { ok: false, reason: 'invalid' };
  const wanted = fold(name);
  const reader = kindReader(tree);
  for (const row of tree.allRowsOf(projectId)) {
    if (reader.excluded(row.id)) continue;
    const mark = entityMark(row);
    const isLoc = (mark && mark !== 'other' && mark.kind === 'location') || reader.kindOf(row.id).kind === 'location';
    if (!isLoc || !row.title.trim()) continue;
    if (locationForms(row.title).includes(wanted)) return { ok: false, ...placeOf(tree, row) };
  }
  const folder = locationFolder(tree, projectId, snap.registry);
  if ('reason' in folder) return { ok: false, reason: folder.reason };
  if (!perms.canCreateIn(folder.id, projectId)) return { ok: false, reason: 'cantCreate', pageId: folder.id };
  const title = name.charAt(0).toUpperCase() + name.slice(1);
  return { ok: true, parentId: folder.id, title, generic: !recognizedAlone(title) };
}

// --- Crear -----------------------------------------------------------------------------------------------------------

export interface CreateDeps {
  tree: Pick<PageTree, 'create' | 'setSetting' | 'get' | 'children' | 'trash' | 'isTrashed'> & GuardTree;
  /** Escribe la plantilla en la página nueva (sin pantalla, solo agregando: `writeNewPage`). */
  write(pageId: string, kind: 'scene' | 'location'): Promise<void>;
  /** Una sincronización ahora (para mirar de nuevo con el árbol recién bajado); `null` si no hay. */
  syncNow: (() => Promise<void>) | null;
  /** El contexto de las guardas, leído en el momento (después de sincronizar cambia). */
  context(): GuardContext;
  /** Cuánto se espera la sincronización de antes de crear. */
  syncTimeoutMs?: number;
}

export type CreateResult = { ok: true; pageId: string; parentId: string; title: string } | Extract<GuardResult, { ok: false }>;

/** Lo que se está creando ahora, por árbol (un dispositivo), proyecto y código: dos pedidos a la vez crean una sola página. */
const inFlightByTree = new WeakMap<object, Map<string, Promise<CreateResult>>>();

const keyOf = (projectId: string, want: CreateWant) => `${projectId}|${want.kind}|${want.kind === 'scene' ? want.code : fold(want.name).trim()}`;

/**
 * Crea la escena o la locación (D517): con las guardas, una sincronización en el momento y las guardas otra vez; la
 * página va a su carpeta (en orden por número), con su marca de tipo explícita, la plantilla de su tipo y su contenido.
 * Todo primero en el dispositivo; sube con la cola de siempre. Dos llamadas a la vez para lo mismo dan una sola página.
 */
export function createEntity(deps: CreateDeps, want: CreateWant): Promise<CreateResult> {
  const first = deps.context();
  const key = keyOf(first.projectId, want);
  let inFlight = inFlightByTree.get(deps.tree);
  if (!inFlight) inFlightByTree.set(deps.tree, (inFlight = new Map()));
  const running = inFlight.get(key);
  if (running) return running;
  const job = (async (): Promise<CreateResult> => {
    const before = createGuard(first, want);
    if (!before.ok) return before;
    if (deps.syncNow) {
      const started = Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), deps.syncTimeoutMs ?? 6000)));
      const done = await Promise.race([deps.syncNow().then(() => 'done' as const, () => 'failed' as const), timeout]);
      clearTimeout(timer);
      const after = deps.context().sync;
      // Sin una sincronización buena recién hecha no se sabe si otro la creó hace un momento.
      if (done !== 'done' || !after.online || (after.lastSyncAt ?? 0) < started) return { ok: false, reason: 'offline' };
    }
    const ctx = deps.context();
    const guard = createGuard(ctx, want);
    if (!guard.ok) return guard;
    const kind = want.kind;
    const pageId = await deps.tree.create(guard.parentId, guard.title, ctx.projectId, {
      templateId: kind === 'scene' ? BUILTIN_SCENE : BUILTIN_LOCATION,
      ...(guard.before ? { before: guard.before } : {}),
    });
    // La marca explícita (D517): no depende de que la carpeta se la dé al leer (`onPlaced` puede no estar).
    await deps.tree.setSetting(pageId, 'entity', kind === 'scene' ? { kind: 'scene', code: want.code } : { kind: 'location' });
    // Que la fila suba ya y no en el próximo ciclo (D546, O1 de la auditoría): la ventana en que otro dispositivo todavía
    // no la ve y la puede crear también se achica a un viaje de ida y vuelta. No se espera: lo de abajo es local.
    if (deps.syncNow) void deps.syncNow().catch(() => undefined);
    try {
      await deps.write(pageId, kind);
    } catch (err) {
      // La página ya existe y queda (vacía es mejor que perderla): ofrece las plantillas al abrirla.
      console.warn('[crear] no se pudo escribir la plantilla en la página nueva', pageId, err);
    }
    return { ok: true, pageId, parentId: guard.parentId, title: guard.title };
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}

/**
 * *Undo* (D518): la página creada va a la papelera solo si sigue como se creó: mismo título y lugar, sin páginas adentro
 * y con el mismo contenido (`same`, que mira quien llama), después de sincronizar (`refresh`). Si alguien ya escribió, queda.
 */
export async function undoCreate(
  tree: Pick<PageTree, 'get' | 'children' | 'trash' | 'isTrashed'>,
  created: { pageId: string; parentId: string; title: string },
  same: () => Promise<boolean>,
  /**
   * Antes de mirar, una sincronización (D547, O2 de la auditoría): lo que otro dispositivo ya escribió en la página nueva
   * tiene que llegar antes de comparar. Si no se puede sincronizar, no se deshace (`offline`): no se sabe si alguien escribe.
   */
  refresh?: () => Promise<boolean>,
): Promise<'trashed' | 'changed' | 'gone' | 'offline'> {
  if (refresh && !(await refresh().catch(() => false))) return 'offline';
  const row = tree.get(created.pageId);
  if (!row || tree.isTrashed(created.pageId)) return 'gone';
  if (row.title !== created.title || row.parent_id !== created.parentId || tree.children(created.pageId).length > 0) return 'changed';
  if (!(await same())) return 'changed';
  await tree.trash(created.pageId);
  return 'trashed';
}

/**
 * Una sincronización con tope que dice si salió bien: terminó a tiempo, con red y con `lastSyncAt` de después de pedirla.
 */
export async function freshSync(
  engine: { syncNow(): Promise<void>; getStatus(): { online: boolean; lastSyncAt: number | null } },
  timeoutMs = 6000,
): Promise<boolean> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), timeoutMs)));
  const done = await Promise.race([engine.syncNow().then(() => 'done' as const, () => 'failed' as const), timeout]);
  clearTimeout(timer);
  const st = engine.getStatus();
  return done === 'done' && st.online && (st.lastSyncAt ?? 0) >= started;
}

// --- Armar las dependencias desde los servicios de la app ------------------------------------------------------------

export interface CreateServices {
  tree: PageTree;
  docs: import('../templates/ownCopy').OwnTemplateDeps['docs'];
  engine: import('../templates/ownCopy').OwnTemplateDeps['engine'] & {
    syncNow(): Promise<void>;
    getStatus(): { online: boolean; lastSyncAt: number | null };
  };
}

/**
 * Las dependencias de `createEntity` con los servicios de la app: los permisos y la foto del índice se leen en el
 * momento (`perms`, `snap`), y la plantilla se escribe con `createWrite.ts`, que se baja recién al crear.
 */
export function createDepsFrom(
  services: CreateServices,
  read: { projectId: string; lang: string; perms: () => GuardPerms; snap: () => GuardContext['snap'] },
): CreateDeps {
  const { tree, docs, engine } = services;
  return {
    tree,
    syncNow: () => engine.syncNow(),
    context: () => ({ tree, perms: read.perms(), snap: read.snap(), sync: engine.getStatus(), projectId: read.projectId }),
    write: async (pageId, kind) => {
      const { writeEntityTemplate } = await import('./createWrite');
      await writeEntityTemplate({ tree, docs, engine }, pageId, kind, read.lang);
    },
  };
}
