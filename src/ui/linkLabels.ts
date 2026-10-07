import { useEffect, useSyncExternalStore } from 'react';
import { useLinkMode } from '../linkMode';
import { usePermissions, useServices } from '../services';
import { Permissions } from '../sync/access';
import type { SyncStatus } from '../sync/engine';
import { getPublicLinkLabels, LINK_SCHEMA_VERSION, type LinkLabel } from '../sync/publicLinks';

// De qué link vino un comentario hecho por un link público (Docs/Doc_Link_Publico.md, 3.7 y "De qué link vino cada
// comentario"): el nivel del link, quién lo creó y si está cerrado, vencido o no anda. Lo ve solo quien puede compartir
// la página raíz del link, y eso lo decide la base (`public_link_labels`): de un link que la sesión no comparte no hay
// fila. Lo que la app calcula por su cuenta (`canSharePage` de la página del comentario, que está en la rama del link:
// quien comparte la raíz comparte lo de abajo) solo ahorra pedidos y nunca muestra un rótulo que la base no dio.
//
// Se pide una vez por conjunto de links (los de los comentarios de la página abierta), no por comentario, y se
// recuerda por id de link. Lo recordado es de una sesión: hay un store por cada armado de los servicios (por motor), no
// por cliente de Supabase, que es el mismo para todas las cuentas que entran al workspace en la pestaña. Otra cuenta
// arranca con uno vacío. Nada se guarda en el dispositivo: sin red, el comentario se ve sin el rótulo.

/** Cada cuánto, como mucho, se vuelve a pedir el rótulo de un link que se está mostrando (pudo apagarse o vencer). */
export const LINK_LABELS_EVERY_MS = 2 * 60_000;
/** Cuánto se espera para volver a probar con una base que no tiene la función (`PGRST202`). */
export const LINK_LABELS_MISSING_MS = 10 * 60_000;

export type LinkLabelsSnapshot = ReadonlyMap<string, LinkLabel>;

const EMPTY: LinkLabelsSnapshot = new Map();

/** Lo que el store le pide a la base: los rótulos de estos links, o `null` si la base no tiene la función. */
export interface LinkLabelsApi {
  labels(ids: string[]): Promise<Map<string, LinkLabel> | null>;
}

export interface LinkLabelsEngine {
  subscribe(fn: () => void): () => void;
  getStatus(): Pick<SyncStatus, 'online' | 'schemaVersion'>;
}

/** Lo que la app sabe de los permisos de la persona, leído en cada vuelta. */
export type LinkLabelsPerms = Pick<Permissions, 'known' | 'role' | 'canSharePage'>;

export class LinkLabelsStore {
  private snapshot: LinkLabelsSnapshot = EMPTY;
  /** Cuándo se pidió cada link por última vez (también los que la base no contestó: no se repiten en cada render). */
  private readonly askedAt = new Map<string, number>();
  /** Los links de los comentarios que se están mostrando, por página. */
  private readonly wanted = new Map<string, readonly string[]>();
  private readonly listeners = new Set<() => void>();
  private stopWatching: (() => void)[] = [];
  private inFlight: Promise<void> | null = null;
  /** Se pidió algo mientras un pedido viajaba: al volver se mira de nuevo. */
  private again = false;
  /** Desde cuándo la base no tiene la función, y cuándo falló el último pedido. */
  private missingAt: number | null = null;
  private failedAt: number | null = null;
  /** Cambia cuando se vacía todo: un pedido que estaba en viaje no escribe nada al volver. */
  private epoch = 0;

  constructor(
    private readonly api: LinkLabelsApi,
    private readonly engine: LinkLabelsEngine,
    /** Lo que la app cree que la persona puede compartir (ahorra pedidos; la base decide igual). */
    private readonly perms: () => LinkLabelsPerms,
    private readonly now: () => number = Date.now,
    /** Avisa cuando cambian los permisos de la persona (su rol puede bajar con la app abierta). */
    private readonly onPermsChange?: (fn: () => void) => () => void,
  ) {}

  get = (): LinkLabelsSnapshot => this.snapshot;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    if (this.listeners.size === 1) {
      const again = () => void this.refresh();
      // Cambiaron los permisos de la persona: lo recordado se pidió con los de antes. Se vuelve a pedir en el acto lo
      // que se muestra, y lo que la base ya no contesta (dejó de compartir la página de ese link) se va.
      const permsChanged = () => this.stale();
      this.stopWatching = [this.engine.subscribe(again), ...(this.onPermsChange ? [this.onPermsChange(permsChanged)] : [])];
    }
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0) {
        for (const stop of this.stopWatching.splice(0)) stop();
      }
    };
  };

  /**
   * Los links de los comentarios que la página está mostrando: se piden juntos los que todavía no se pidieron (o se
   * pidieron hace mucho). Devuelve la función para dejar de mirarlos.
   */
  want(pageId: string, ids: readonly string[]): () => void {
    const mine = [...new Set(ids)];
    this.wanted.set(pageId, mine);
    void this.refresh();
    return () => {
      if (this.wanted.get(pageId) === mine) this.wanted.delete(pageId);
    };
  }

  /**
   * *Share* acaba de leer o cambiar un link, o cambiaron los permisos de la persona: lo recordado puede estar viejo, se
   * vuelve a pedir lo que se muestra.
   */
  stale(): void {
    this.askedAt.clear();
    this.failedAt = null;
    void this.refresh();
  }

  private publish(): void {
    for (const fn of this.listeners) fn();
  }

  /** Suelta todo lo recordado: la persona ya no comparte nada (un invitado, o alguien que sacaron del workspace). */
  private clear(): void {
    this.epoch += 1;
    this.askedAt.clear();
    if (this.snapshot.size === 0) return;
    this.snapshot = EMPTY;
    this.publish();
  }

  /**
   * Pide los rótulos que faltan de lo que se está mostrando, en un pedido. Sin saber todavía los permisos, sin red, sin
   * la versión de los links, con una base sin la función (se vuelve a probar a los diez minutos) o justo después de un
   * pedido que falló, nada. Solo de las páginas que la persona puede compartir: de las demás ni se pregunta. Si es una
   * invitada o ya no está en el workspace, además se vacía lo recordado.
   */
  refresh(): Promise<void> {
    const perms = this.perms();
    if (!perms.known) return Promise.resolve();
    if (perms.role === null || perms.role === 'guest') {
      this.clear();
      return Promise.resolve();
    }
    const st = this.engine.getStatus();
    if (!st.online || (st.schemaVersion ?? 0) < LINK_SCHEMA_VERSION) return Promise.resolve();
    const now = this.now();
    if (this.missingAt !== null && now - this.missingAt < LINK_LABELS_MISSING_MS) return Promise.resolve();
    if (this.failedAt !== null && now - this.failedAt < LINK_LABELS_EVERY_MS) return Promise.resolve();
    if (this.inFlight) {
      this.again = true;
      return this.inFlight;
    }
    const due = new Set<string>();
    for (const [pageId, ids] of this.wanted) {
      if (!perms.canSharePage(pageId)) continue;
      for (const id of ids) {
        const at = this.askedAt.get(id);
        if (at === undefined || now - at >= LINK_LABELS_EVERY_MS) due.add(id);
      }
    }
    if (due.size === 0) return Promise.resolve();
    const ids = [...due];
    const before = new Map(ids.map((id) => [id, this.askedAt.get(id)] as const));
    for (const id of ids) this.askedAt.set(id, now);
    const epoch = this.epoch;
    const undo = () => {
      if (epoch !== this.epoch) return;
      for (const [id, at] of before) {
        if (at === undefined) this.askedAt.delete(id);
        else this.askedAt.set(id, at);
      }
    };
    this.inFlight = this.api
      .labels(ids)
      .then(
        (labels) => {
          if (epoch !== this.epoch) return;
          this.failedAt = null;
          if (labels === null) {
            // Una base sin la función: lo ya mostrado no cambia, y no se insiste por un rato.
            this.missingAt = this.now();
            undo();
            return;
          }
          this.missingAt = null;
          const next = new Map(this.snapshot);
          let changed = false;
          for (const id of ids) {
            const label = labels.get(id);
            const had = next.get(id);
            if (!label) {
              // La base ya no lo contesta (la persona dejó de compartir esa página): el rótulo se va.
              if (next.delete(id)) changed = true;
            } else if (!had || !sameLabel(had, label)) {
              next.set(id, label);
              changed = true;
            }
          }
          if (changed) {
            this.snapshot = next;
            this.publish();
          }
        },
        () => {
          // Sin respuesta queda lo de antes, y se vuelve a pedir recién pasado el plazo: un servidor caído no recibe
          // un pedido por cada cambio de estado de la sincronización.
          if (epoch !== this.epoch) return;
          this.failedAt = this.now();
          undo();
        },
      )
      .finally(() => {
        this.inFlight = null;
        if (this.again) {
          this.again = false;
          void this.refresh();
        }
      });
    return this.inFlight;
  }
}

function sameLabel(a: LinkLabel, b: LinkLabel): boolean {
  return a.level === b.level && a.createdBy === b.createdBy && a.revoked === b.revoked && a.expired === b.expired && a.alive === b.alive;
}

// Un store por motor de sincronización: el motor nace y muere con los servicios de una sesión (una cuenta en una
// pestaña), así que el store también. Lo comparten el panel de comentarios y *Share*, que reciben los mismos servicios.
const stores = new WeakMap<object, LinkLabelsStore>();

type StoreServices = Pick<ReturnType<typeof useServices>, 'client' | 'engine' | 'access' | 'tree' | 'user'>;

/** El store de estos servicios, o `null` si no hay a quién preguntarle. */
export function linkLabelsStore(services: StoreServices): LinkLabelsStore | null {
  const { client, engine, access, tree, user } = services;
  if (!client || typeof (client as { rpc?: unknown }).rpc !== 'function') return null;
  let store = stores.get(engine);
  if (!store) {
    store = new LinkLabelsStore(
      { labels: (ids) => getPublicLinkLabels(client, ids) },
      engine,
      () => new Permissions(tree, access.get(), user.id),
      Date.now,
      access.subscribe,
    );
    stores.set(engine, store);
  }
  return store;
}

const none = () => EMPTY;
const noSubscribe = () => () => undefined;

/**
 * Los rótulos de los links de los comentarios de la página, por id de link. Vacío para quien no puede compartir la
 * página (ni se pregunta), con la app abierta por un link, sin red o con una base sin la función.
 */
export function useLinkLabels(pageId: string, ids: readonly string[]): LinkLabelsSnapshot {
  const services = useServices();
  const viaLink = useLinkMode() !== null;
  const can = usePermissions().canSharePage(pageId);
  const store = viaLink || !can ? null : linkLabelsStore(services);
  const key = [...new Set(ids)].sort().join(',');
  useEffect(() => (store && key ? store.want(pageId, key.split(',')) : undefined), [store, pageId, key]);
  return useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.get ?? none);
}
