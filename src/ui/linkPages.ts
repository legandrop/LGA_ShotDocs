import { useSyncExternalStore } from 'react';
import { useLinkMode } from '../linkMode';
import { useServices } from '../services';
import { Permissions } from '../sync/access';
import type { SyncStatus } from '../sync/engine';
import { getPublicLink, getPublicLinkPages, LINK_SCHEMA_VERSION, type LinkPageMark, type ListedLinkPage, type PublicLinkInfo } from '../sync/publicLinks';

// Las páginas con un link público propio, para el ícono del árbol (Docs/Doc_Link_Publico.md, 3.11). Lo ve solo quien
// puede abrir *Share* de esa página, y eso lo decide la base. Desde 20261107120000_link_paginas_quien_comparte.sql,
// `public_link_pages` lista solo lo que la sesión puede compartir y trae lo que dice el ícono: un pedido alcanza. Con
// una base anterior, la lista solo dice dónde mirar (lista lo que la sesión ve) y cada página se confirma con
// `get_public_link`, la misma función de *Share*, que no contesta nada a quien no puede compartirla. Lo que la app
// calcula por su cuenta (`canShare`) solo ahorra pedidos: nunca muestra un ícono que la base no confirmó. Del link se
// guarda lo que dice el ícono (el nivel, quién lo creó, si anda), nunca el token.
//
// Lo guardado es de una sesión: hay un store por cada armado de los servicios (por motor), no por cliente de Supabase,
// que es el mismo para todas las cuentas que entran al workspace en la pestaña. Otra cuenta, o la misma después de
// rearmar los servicios, arranca con uno vacío.

/** Cada cuánto, como mucho, se vuelve a pedir la lista con las sincronizaciones (también después de un pedido que falló). */
export const LINK_PAGES_EVERY_MS = 2 * 60_000;
/** Cada cuánto se vuelve a confirmar una página que ya se confirmó (el nivel o el permiso pueden cambiar en otro lado). */
export const LINK_PAGE_CONFIRM_MS = 10 * 60_000;
/** Cuántas páginas se confirman como mucho por vuelta (el resto, en las siguientes). */
export const LINK_PAGES_PER_ROUND = 20;

export type { LinkPageMark };

export type LinkPagesSnapshot = ReadonlyMap<string, LinkPageMark>;

const EMPTY: LinkPagesSnapshot = new Map();

/** Lo que el store le pide a la base. */
export interface LinkPagesApi {
  /** Cada página con su marca si la base ya decidió, o solo su id si hay que confirmarla (una base anterior). */
  pages(): Promise<ListedLinkPage[]>;
  link(pageId: string): Promise<PublicLinkInfo | null>;
}

export interface LinkPagesEngine {
  subscribe(fn: () => void): () => void;
  getStatus(): Pick<SyncStatus, 'online' | 'schemaVersion'>;
}

/** Lo que la app sabe de los permisos de la persona, leído en cada vuelta. */
export type LinkPagesPerms = Pick<Permissions, 'known' | 'role' | 'canSharePage'>;

export class LinkPagesStore {
  private snapshot: LinkPagesSnapshot = EMPTY;
  private readonly confirmedAt = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private stopWatching: (() => void)[] = [];
  private inFlight: Promise<void> | null = null;
  /** Cuándo se pidió la lista por última vez (`null`: todavía no, o quedó algo por confirmar). */
  private askedAt: number | null = null;
  /** Cambia cuando se vacía todo: una vuelta que estaba en viaje no escribe nada al volver. */
  private epoch = 0;

  constructor(
    private readonly api: LinkPagesApi,
    private readonly engine: LinkPagesEngine,
    /** Lo que la app cree que la persona puede compartir (ahorra pedidos; la base decide igual). */
    private readonly perms: () => LinkPagesPerms,
    private readonly now: () => number = Date.now,
    /** Avisa cuando cambian los permisos de la persona (su rol puede bajar con la app abierta). */
    private readonly onPermsChange?: (fn: () => void) => () => void,
  ) {}

  get = (): LinkPagesSnapshot => this.snapshot;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    if (this.listeners.size === 1) {
      const again = () => void this.refresh();
      this.stopWatching = [this.engine.subscribe(again), ...(this.onPermsChange ? [this.onPermsChange(again)] : [])];
      void this.refresh();
    }
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0) {
        for (const stop of this.stopWatching.splice(0)) stop();
      }
    };
  };

  /** Lo que *Share* acaba de leer de una página (la misma respuesta de la base): el ícono cambia en el acto. */
  learn(pageId: string, info: PublicLinkInfo | null): void {
    this.apply(pageId, info);
    this.publish();
  }

  private apply(pageId: string, info: PublicLinkInfo | null): void {
    const next = new Map(this.snapshot);
    const link = info?.link ?? null;
    // Un link vencido no lleva ícono (la lista tampoco lo trae): que venció lo dice *Share*.
    const expired = !!link?.expires_at && Date.parse(link.expires_at) <= this.now();
    if (link && !expired) next.set(pageId, { level: link.level === 'edit' ? 'edit' : 'comment', createdBy: link.created_by_name ?? null, alive: link.alive !== false });
    else next.delete(pageId);
    this.confirmedAt.set(pageId, this.now());
    this.snapshot = next;
  }

  private publish(): void {
    for (const fn of this.listeners) fn();
  }

  /** Suelta todo lo guardado: la persona ya no comparte nada (un invitado, o alguien que sacaron del workspace). */
  private clear(): void {
    this.epoch += 1;
    this.confirmedAt.clear();
    this.askedAt = null;
    if (this.snapshot.size === 0) return;
    this.snapshot = EMPTY;
    this.publish();
  }

  /**
   * Pide la lista (como mucho cada `LINK_PAGES_EVERY_MS`, también después de un pedido que falló). Las páginas que
   * llegan con su marca (la base ya decidió) se marcan sin más pedidos; las que llegan solo con el id (una base
   * anterior) se confirman de a una, las nuevas o las confirmadas hace mucho. Sin saber todavía los permisos, sin red o
   * sin la versión de los links, nada. Si la persona es una invitada o ya no está en el workspace, además se vacía lo
   * guardado: nunca comparte.
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
    if (this.inFlight) return this.inFlight;
    if (this.askedAt !== null && this.now() - this.askedAt < LINK_PAGES_EVERY_MS) return Promise.resolve();
    this.askedAt = this.now();
    this.inFlight = this.round(perms)
      // Sin respuesta queda lo de antes, y se vuelve a pedir recién pasado el plazo: un servidor caído no recibe un
      // pedido por cada cambio de estado de la sincronización.
      .catch(() => undefined)
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  private async round(perms: LinkPagesPerms): Promise<void> {
    const started = this.now();
    const epoch = this.epoch;
    const pages = await this.api.pages();
    if (epoch !== this.epoch) return;
    // La marca que trae la base, o `null` si la página llegó solo con el id y hay que confirmarla.
    const fromBase = new Map<string, LinkPageMark | null>();
    for (const p of pages) {
      const id = typeof p === 'string' ? p : p.pageId;
      if (perms.canSharePage(id)) fromBase.set(id, typeof p === 'string' ? null : p.mark);
    }
    const listed = new Set(fromBase.keys());
    // Lo que *Share* leyó mientras la lista viajaba es más nuevo que ella: se queda aunque la lista no lo traiga.
    for (const [id, at] of this.confirmedAt) if (at >= started && this.snapshot.has(id)) listed.add(id);
    // Lo que ya no tiene link vivo (o dejó de verse) se va en el acto.
    const kept = new Map([...this.snapshot].filter(([id]) => listed.has(id)));
    for (const id of [...this.confirmedAt.keys()]) if (!listed.has(id)) this.confirmedAt.delete(id);
    const before = this.snapshot;
    let changed = kept.size !== before.size;
    for (const [id, mark] of fromBase) {
      // Lo que *Share* leyó mientras la lista viajaba gana: un link recién apagado no vuelve con la lista vieja.
      if (!mark || (this.confirmedAt.get(id) ?? -Infinity) >= started) continue;
      const had = kept.get(id);
      if (!had || had.level !== mark.level || had.createdBy !== mark.createdBy || had.alive !== mark.alive) {
        kept.set(id, mark);
        changed = true;
      }
      this.confirmedAt.set(id, this.now());
    }
    this.snapshot = changed ? kept : before;
    const due = [...listed].filter(
      (id) => !fromBase.get(id) && this.now() - (this.confirmedAt.get(id) ?? -Infinity) >= LINK_PAGE_CONFIRM_MS,
    );
    try {
      for (const id of due.slice(0, LINK_PAGES_PER_ROUND)) {
        const info = await this.api.link(id);
        if (epoch !== this.epoch) return;
        this.apply(id, info);
      }
    } finally {
      // Lo confirmado hasta acá se muestra aunque un pedido falle a mitad de la vuelta.
      if (epoch === this.epoch && this.snapshot !== before) this.publish();
    }
    // Quedaron páginas sin confirmar: la vuelta siguiente no espera el plazo entero.
    if (due.length > LINK_PAGES_PER_ROUND) this.askedAt = null;
  }
}

// Un store por motor de sincronización: el motor nace y muere con los servicios de una sesión (una cuenta en una
// pestaña), así que el store también. Lo comparten el árbol y *Share*, que reciben los mismos servicios.
const stores = new WeakMap<object, LinkPagesStore>();

type StoreServices = Pick<ReturnType<typeof useServices>, 'client' | 'engine' | 'access' | 'tree' | 'user'>;

/** El store de estos servicios, o `null` si no hay a quién preguntarle. */
export function linkPagesStore(services: StoreServices): LinkPagesStore | null {
  const { client, engine, access, tree, user } = services;
  if (!client || typeof (client as { rpc?: unknown }).rpc !== 'function') return null;
  let store = stores.get(engine);
  if (!store) {
    store = new LinkPagesStore(
      { pages: () => getPublicLinkPages(client), link: (pageId) => getPublicLink(client, pageId) },
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

/** Las páginas con link propio que la persona puede compartir. Con la app abierta por un link, ninguna. */
export function useLinkPages(): LinkPagesSnapshot {
  const services = useServices();
  const viaLink = useLinkMode() !== null;
  const store = viaLink ? null : linkPagesStore(services);
  return useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.get ?? none);
}
