import { useEffect, useSyncExternalStore } from 'react';
import { t } from '../i18n';
import { useLinkMode } from '../linkMode';
import { useServices } from '../services';
import { Permissions } from '../sync/access';
import type { SyncStatus } from '../sync/engine';
import { SCENE_SHARES_SCHEMA_VERSION, type SceneSharesRemote } from '../sync/remote';
import type { PageTree } from '../sync/tree';
import type { PageRow } from '../sync/types';
import { notify } from './notice';

// Lo que ven personas de afuera (condición 8 de Docs/Doc_Compartir_Escenas.md): las páginas del proyecto con un permiso o
// una invitación de un invitado, o de Ver o Comentar, que da `pages_with_outside_readers` (base 28). Lo ve solo quien
// puede compartir el proyecto (lo decide la base; la app solo ahorra el pedido). Sirve para la marca del árbol (la página
// y lo de adentro) y para el aviso al mover o crear una página adentro de una de ellas: lo que entra ahí lo ven ellos.
// Solo en memoria, por proyecto, y como mucho un pedido cada 2 minutos (o al guardar en *Share scenes*).
//
// Quien edita pero no puede compartir el proyecto no recibe la lista: pregunta por una página
// (`page_has_outside_readers`, solo sí o no) y la base le contesta de la página o de una de arriba. Se pregunta por la
// página abierta (el ojo en su fila) y por el destino al crear o mover; la respuesta se guarda 2 minutos.

/** Lo que la base reconoce como entidad (`private.entity_marked`). */
const ENTITY_KINDS = new Set(['scene', 'location', 'day', 'set']);

/** Cada cuánto, como mucho, se vuelve a pedir la lista de un proyecto con las sincronizaciones. */
export const OUTSIDE_READERS_EVERY_MS = 2 * 60_000;

/** Las páginas de un proyecto que ven personas de afuera, con cuántas personas o invitaciones. */
export type OutsideReaders = ReadonlyMap<string, number>;

const EMPTY: OutsideReaders = new Map();

export interface OutsideReadersEngine {
  subscribe(fn: () => void): () => void;
  getStatus(): Pick<SyncStatus, 'online' | 'schemaVersion'>;
}

export type OutsideReadersPerms = Pick<Permissions, 'known' | 'canShareProject'>;

export class OutsideReadersStore {
  private readonly byProject = new Map<string, OutsideReaders>();
  private readonly askedAt = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<void>>();
  /** Los proyectos que alguien mira (la barra lateral del abierto): se repreguntan con las sincronizaciones. */
  private readonly watched = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private stopWatching: (() => void)[] = [];
  /** Sí o no por página, para quien no comparte el proyecto, con cuándo se preguntó. */
  private readonly byPage = new Map<string, { seen: boolean; at: number }>();
  private readonly pageInFlight = new Map<string, Promise<boolean>>();

  constructor(
    private readonly api: Pick<SceneSharesRemote, 'pagesWithOutsideReaders' | 'pageHasOutsideReaders'>,
    private readonly engine: OutsideReadersEngine,
    private readonly perms: () => OutsideReadersPerms,
    private readonly now: () => number = Date.now,
    private readonly onPermsChange?: (fn: () => void) => () => void,
  ) {}

  /** Lo guardado del proyecto (vacío si no se sabe o la persona no lo comparte). Misma identidad mientras no cambie. */
  get = (projectId: string): OutsideReaders => this.byProject.get(projectId) ?? EMPTY;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    if (this.listeners.size === 1) {
      const again = () => {
        for (const id of this.watched.keys()) void this.refresh(id);
      };
      this.stopWatching = [this.engine.subscribe(again), ...(this.onPermsChange ? [this.onPermsChange(again)] : [])];
    }
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0) for (const stop of this.stopWatching.splice(0)) stop();
    };
  };

  /** Alguien empieza a mirar el proyecto (devuelve cómo dejar de mirarlo). Pregunta enseguida si hace falta. */
  watch(projectId: string): () => void {
    this.watched.set(projectId, (this.watched.get(projectId) ?? 0) + 1);
    void this.refresh(projectId);
    return () => {
      const n = (this.watched.get(projectId) ?? 1) - 1;
      if (n <= 0) this.watched.delete(projectId);
      else this.watched.set(projectId, n);
    };
  }

  /** Vuelve a preguntar ya (después de compartir o sacar escenas). */
  invalidate(projectId: string): Promise<void> {
    this.askedAt.delete(projectId);
    this.forgetPages();
    return this.refresh(projectId);
  }

  /**
   * Pregunta la lista del proyecto (como mucho cada `OUTSIDE_READERS_EVERY_MS`). Sin saber los permisos, sin red o con
   * una base anterior a la 28, nada; si la persona no puede compartir el proyecto, se suelta lo guardado.
   */
  refresh(projectId: string): Promise<void> {
    const perms = this.perms();
    if (!perms.known) return Promise.resolve();
    if (!perms.canShareProject(projectId)) {
      this.set(projectId, EMPTY);
      return Promise.resolve();
    }
    const st = this.engine.getStatus();
    if (!st.online || (st.schemaVersion ?? 0) < SCENE_SHARES_SCHEMA_VERSION) return Promise.resolve();
    const running = this.inFlight.get(projectId);
    if (running) return running;
    const at = this.askedAt.get(projectId);
    if (at !== undefined && this.now() - at < OUTSIDE_READERS_EVERY_MS) return Promise.resolve();
    this.askedAt.set(projectId, this.now());
    const job = this.api
      .pagesWithOutsideReaders(projectId)
      .then((pages) => {
        // Lo que se decidió mientras viajaba (los permisos bajaron) gana: no vuelve con la lista vieja.
        if (this.perms().canShareProject(projectId)) this.set(projectId, pages);
      })
      // Sin respuesta queda lo de antes, y se vuelve a pedir pasado el plazo.
      .catch(() => undefined)
      .finally(() => this.inFlight.delete(projectId));
    this.inFlight.set(projectId, job);
    return job;
  }

  /** La última respuesta de la base para la página (`undefined` si no se preguntó). */
  pageAnswer(pageId: string): boolean | undefined {
    return this.byPage.get(pageId)?.seen;
  }

  /**
   * Si a la página (o a una de arriba) la ven personas de afuera, para quien la edita sin poder compartir el proyecto.
   * Como mucho un pedido cada `OUTSIDE_READERS_EVERY_MS` por página; sin red o con una base vieja, lo último que se supo
   * (o que no).
   */
  askPage(pageId: string): Promise<boolean> {
    const had = this.byPage.get(pageId);
    if (had && this.now() - had.at < OUTSIDE_READERS_EVERY_MS) return Promise.resolve(had.seen);
    const st = this.engine.getStatus();
    if (!st.online || (st.schemaVersion ?? 0) < SCENE_SHARES_SCHEMA_VERSION) return Promise.resolve(had?.seen ?? false);
    const running = this.pageInFlight.get(pageId);
    if (running) return running;
    const job = this.api
      .pageHasOutsideReaders(pageId)
      .then((seen) => {
        this.byPage.set(pageId, { seen, at: this.now() });
        if (had?.seen !== seen) for (const fn of this.listeners) fn();
        return seen;
      })
      .catch(() => had?.seen ?? false)
      .finally(() => this.pageInFlight.delete(pageId));
    this.pageInFlight.set(pageId, job);
    return job;
  }

  /** Olvida las respuestas por página (después de compartir o sacar): la próxima vez se pregunta de nuevo. */
  forgetPages(): void {
    this.byPage.clear();
  }

  private set(projectId: string, pages: OutsideReaders): void {
    const before = this.byProject.get(projectId) ?? EMPTY;
    if (before.size === pages.size && [...pages].every(([id, n]) => before.get(id) === n)) return;
    if (pages.size === 0) this.byProject.delete(projectId);
    else this.byProject.set(projectId, new Map(pages));
    for (const fn of this.listeners) fn();
  }
}

// Un store por motor (una sesión en una pestaña), como el de los links públicos.
const stores = new WeakMap<object, OutsideReadersStore>();

type StoreServices = Pick<ReturnType<typeof useServices>, 'remote' | 'engine' | 'access' | 'tree' | 'user'>;

/** El store de estos servicios, o `null` si la base de esta sesión no tiene a quién preguntarle (un link público). */
export function outsideReadersStore(services: StoreServices): OutsideReadersStore | null {
  const { remote, engine, access, tree, user } = services;
  const api = remote as Partial<SceneSharesRemote> | undefined;
  if (!api || typeof api.pagesWithOutsideReaders !== 'function' || typeof api.pageHasOutsideReaders !== 'function') return null;
  let store = stores.get(engine);
  if (!store) {
    store = new OutsideReadersStore(
      {
        pagesWithOutsideReaders: (projectId) => remote.pagesWithOutsideReaders(projectId),
        pageHasOutsideReaders: (pageId) => remote.pageHasOutsideReaders(pageId),
      },
      engine,
      () => new Permissions(tree, access.get(), user.id),
      Date.now,
      access.subscribe,
    );
    stores.set(engine, store);
  }
  return store;
}

const noSubscribe = () => () => undefined;

/** Las páginas del proyecto que ven personas de afuera (vacío para quien no puede compartirlo, o con un link). */
export function useOutsideReaders(projectId: string | null | undefined): OutsideReaders {
  const services = useServices();
  const viaLink = useLinkMode() !== null;
  const store = viaLink ? null : outsideReadersStore(services);
  useEffect(() => (store && projectId ? store.watch(projectId) : undefined), [store, projectId]);
  return useSyncExternalStore(store?.subscribe ?? noSubscribe, () => (store && projectId ? store.get(projectId) : EMPTY));
}

/**
 * Para quien edita la página pero no puede compartir su proyecto: si a la página la ven personas de afuera (sí o no,
 * `page_has_outside_readers`). `false` mientras no se sabe, para quien comparte el proyecto (lo dice la lista) o con un
 * link.
 */
export function useOutsidePage(pageId: string | null | undefined): boolean {
  const services = useServices();
  const viaLink = useLinkMode() !== null;
  const store = viaLink ? null : outsideReadersStore(services);
  const projectId = pageId ? services.tree.get(pageId)?.workspace_id : undefined;
  const sharer = !!projectId && new Permissions(services.tree, services.access.get(), services.user.id).canShareProject(projectId);
  const asked = store && pageId && !sharer ? pageId : null;
  useEffect(() => {
    if (store && asked) void store.askPage(asked);
  }, [store, asked]);
  return useSyncExternalStore(store?.subscribe ?? noSubscribe, () => (store && asked ? store.pageAnswer(asked) === true : false));
}

/** La página más cercana (ella o una de arriba) que ven personas de afuera, o `null`. */
export function outsideRootOf(tree: Pick<PageTree, 'get'>, marks: OutsideReaders, pageId: string | null | undefined): string | null {
  if (marks.size === 0) return null;
  const seen = new Set<string>();
  for (let p = pageId ? tree.get(pageId) : undefined; p && !seen.has(p.id); p = p.parent_id ? tree.get(p.parent_id) : undefined) {
    if (marks.has(p.id)) return p.id;
    seen.add(p.id);
  }
  return null;
}

/** Los ajustes marcan escena, locación, día o decorado, o una carpeta que guarda alguna (lo que mira la base). */
export function isEntityMarked(row: PageRow | undefined): boolean {
  const s: Record<string, unknown> = row?.settings && typeof row.settings === 'object' ? (row.settings as Record<string, unknown>) : {};
  const entity = s.entity;
  const kind = entity && typeof entity === 'object' && !Array.isArray(entity) ? (entity as { kind?: unknown }).kind : undefined;
  const reports = s.dayReports;
  return (
    (typeof kind === 'string' && ENTITY_KINDS.has(kind)) ||
    (typeof s.holds === 'string' && s.holds !== '') ||
    (!!reports && typeof reports === 'object' && !Array.isArray(reports))
  );
}

/** La página y todo lo de adentro, también lo de la papelera (como lo recorre la base). */
export function wholeBranch(tree: Pick<PageTree, 'get' | 'allRowsOf'>, pageId: string): PageRow[] {
  const row = tree.get(pageId);
  if (!row) return [];
  const byParent = new Map<string, PageRow[]>();
  for (const r of tree.allRowsOf(row.workspace_id)) {
    if (!r.parent_id) continue;
    byParent.set(r.parent_id, [...(byParent.get(r.parent_id) ?? []), r]);
  }
  const out: PageRow[] = [];
  const seen = new Set<string>();
  const walk = (r: PageRow) => {
    if (seen.has(r.id)) return;
    seen.add(r.id);
    out.push(r);
    for (const child of byParent.get(r.id) ?? []) walk(child);
  };
  walk(row);
  return out;
}

/** Lo guardado para el proyecto de esa página (sin preguntar nada). */
function marksFor(services: StoreServices, pageId: string | null | undefined): OutsideReaders {
  const projectId = pageId ? services.tree.get(pageId)?.workspace_id : undefined;
  const store = outsideReadersStore(services);
  return store && projectId ? store.get(projectId) : EMPTY;
}

/** Quien puede compartir el proyecto de la página (tiene la lista entera) o no (pregunta sí o no por la página). */
function sharerOf(services: StoreServices, pageId: string): boolean {
  const projectId = services.tree.get(pageId)?.workspace_id;
  return !!projectId && new Permissions(services.tree, services.access.get(), services.user.id).canShareProject(projectId);
}

const hasDialogs = () => typeof window !== 'undefined' && typeof window.confirm === 'function';

/** La marca de escena de la base (`settings.entity.kind = 'scene'`). */
function isSceneMarked(row: PageRow | undefined): boolean {
  const entity = row?.settings && typeof row.settings === 'object' ? (row.settings as Record<string, unknown>).entity : undefined;
  return !!entity && typeof entity === 'object' && !Array.isArray(entity) && (entity as { kind?: unknown }).kind === 'scene';
}

/**
 * La primera página hacia arriba (`pageId` incluida) que cumple `pick`, o `null`. Con `pick` = escena marcada que ven de
 * afuera, es `private.nearest_shared_scene` de la base.
 */
function nearestUp(tree: Pick<PageTree, 'get'>, pageId: string | null | undefined, pick: (r: PageRow) => boolean): string | null {
  const seen = new Set<string>();
  for (let p = pageId ? tree.get(pageId) : undefined; p && !seen.has(p.id); p = p.parent_id ? tree.get(p.parent_id) : undefined) {
    if (pick(p)) return p.id;
    seen.add(p.id);
  }
  return null;
}

/**
 * Antes de mover `pageId` adentro de `parentId` (la regla de los movimientos, D843; la base la tiene en
 * `pages_scene_share_guard`):
 * - a una **escena compartida** con personas de afuera solo se mueve desde adentro de esa misma escena: si no, lo dice
 *   (para meterla, primero dejar de compartirla) y no mueve, sin opción de seguir;
 * - a otra rama que ven de afuera (una carpeta compartida con *Share*), si la página no estaba ya en ella, pregunta.
 * Quien no comparte el proyecto pregunta a la base por el destino (solo sí o no): si lo ven de afuera y hay una escena
 * hacia arriba que no es la del origen, la toma por compartida (ante la duda, no se mueve). Devuelve si se mueve.
 *
 * `merge`: unir dos fichas (`MergeAction`): `pageId` es la que se va, y a `parentId` pasan su texto y sus subpáginas (no
 * ella misma, que va a la papelera): el origen es `pageId`.
 */
export async function confirmOutsideMove(services: StoreServices, pageId: string, parentId: string | null, merge = false): Promise<boolean> {
  const { tree } = services;
  const from = merge ? pageId : (tree.get(pageId)?.parent_id ?? null);
  if (!parentId || (!merge && from === parentId)) return true;
  const text = merge ? 'outside.mergeConfirm' : 'outside.moveConfirm';
  const blockedText = merge ? 'outside.mergeIntoShared' : 'outside.moveIntoShared';
  const untitled = (id: string | null) => (id ? tree.get(id)?.title : '') || t('common.untitled');
  if (sharerOf(services, parentId)) {
    const marks = marksFor(services, parentId);
    const shared = (r: PageRow) => isSceneMarked(r) && marks.has(r.id);
    const sceneInto = nearestUp(tree, parentId, shared);
    if (sceneInto && sceneInto !== nearestUp(tree, from, shared)) {
      if (hasDialogs()) window.alert(t(blockedText, { title: untitled(sceneInto) }));
      return false;
    }
    const into = outsideRootOf(tree, marks, parentId);
    if (!into || into === outsideRootOf(tree, marks, pageId)) return true;
    if (!hasDialogs()) return true;
    return window.confirm(t(text, { title: untitled(into) }));
  }
  const store = outsideReadersStore(services);
  if (!store || !(await store.askPage(parentId))) return true;
  // Quien no comparte el proyecto sabe solo sí o no: con una escena hacia arriba del destino que no es la del origen, la
  // toma por la compartida y no mueve (la base lo rechazaría).
  const sceneInto = nearestUp(tree, parentId, isSceneMarked);
  if (sceneInto && sceneInto !== nearestUp(tree, from, isSceneMarked)) {
    if (hasDialogs()) window.alert(t(blockedText, { title: untitled(sceneInto) }));
    return false;
  }
  if (!hasDialogs()) return true;
  return window.confirm(t(text, { title: untitled(parentId) }));
}

/** Después de crear una página adentro de `parentId`: si lo ven personas de afuera, lo avisa. */
export function noticeOutsideCreate(services: StoreServices, parentId: string | null): void {
  if (!parentId) return;
  if (sharerOf(services, parentId)) {
    const root = outsideRootOf(services.tree, marksFor(services, parentId), parentId);
    if (root) notify(t('outside.created', { title: services.tree.get(root)?.title || t('common.untitled') }));
    return;
  }
  const store = outsideReadersStore(services);
  void store?.askPage(parentId).then((seen) => {
    if (seen) notify(t('outside.created', { title: services.tree.get(parentId)?.title || t('common.untitled') }));
  });
}
