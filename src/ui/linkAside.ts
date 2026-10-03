import { useEffect, useSyncExternalStore } from 'react';
import type { Translate } from '../i18n';
import { toBase64 } from '../lib/base64';
import { useServices } from '../services';
import { insertedText } from '../sync/admit';
import { canListAside, LINK_ASIDE_SCHEMA_VERSION, type LinkAsideRemote, type LinkAsideRow } from '../sync/linkAdmitApi';
import type { SyncStatus } from '../sync/engine';
import { saveBlob } from './unsyncedDownload';

// Lo apartado de los links, a la vista del equipo (Docs/Doc_Link_Publico.md, entrega 2c): la lista de *Share*, el ícono
// del árbol y las entradas *Set aside (via link)* del historial salen de una sola consulta (`public_link_aside`, sin bytes),
// guardada en memoria por servidor. Se pide al usarla por primera vez y después, como mucho, cada `EVERY_MS` (con las
// sincronizaciones); *Share* y el historial la piden en el acto al abrirse. Lo apartado nunca se borra (solo crece), así
// que una lista de hace unos minutos nunca muestra algo que ya no está.

/** Cada cuánto, como mucho, se vuelve a pedir la lista con las sincronizaciones. */
export const ASIDE_EVERY_MS = 2 * 60_000;

export interface LinkAsideSnapshot {
  rows: LinkAsideRow[];
  /** Ya llegó una respuesta. */
  ready: boolean;
}

const EMPTY: LinkAsideSnapshot = { rows: [], ready: false };

/** Lo que el store necesita del motor: si hay red y la versión de la base. */
export interface AsideEngine {
  subscribe(fn: () => void): () => void;
  getStatus(): Pick<SyncStatus, 'online' | 'schemaVersion'>;
}

export class LinkAsideStore {
  private snapshot: LinkAsideSnapshot = EMPTY;
  private readonly listeners = new Set<() => void>();
  private stopEngine: (() => void) | null = null;
  private inFlight: Promise<void> | null = null;
  private askedAt = 0;

  constructor(
    private readonly remote: LinkAsideRemote,
    private readonly engine: AsideEngine,
    /** Si la persona puede ver lo apartado (no un invitado). */
    private readonly allowed: () => boolean,
    private readonly now: () => number = Date.now,
  ) {}

  get = (): LinkAsideSnapshot => this.snapshot;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    if (this.listeners.size === 1) {
      this.stopEngine = this.engine.subscribe(() => void this.refresh());
      void this.refresh();
    }
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0) {
        this.stopEngine?.();
        this.stopEngine = null;
      }
    };
  };

  /** Pide la lista (con `force`, ya; si no, como mucho cada `ASIDE_EVERY_MS`). Sin red, sin la versión 20 o sin permiso, nada. */
  refresh(force = false): Promise<void> {
    const st = this.engine.getStatus();
    if (!st.online || (st.schemaVersion ?? 0) < LINK_ASIDE_SCHEMA_VERSION || !this.allowed()) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    if (!force && this.askedAt > 0 && this.now() - this.askedAt < ASIDE_EVERY_MS) return Promise.resolve();
    this.askedAt = this.now();
    this.inFlight = this.remote
      .linkAside()
      .then(
        (rows) => {
          this.snapshot = { rows, ready: true };
          for (const fn of this.listeners) fn();
        },
        // Sin respuesta queda lo de antes; la próxima sincronización vuelve a probar.
        () => {
          this.askedAt = 0;
        },
      )
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }
}

const stores = new WeakMap<object, LinkAsideStore>();

/** El store de lo apartado de estos servicios (uno por servidor), o `null` si el servidor no lo tiene (un link). */
export function linkAsideStore(services: Pick<ReturnType<typeof useServices>, 'remote' | 'engine' | 'access'>): LinkAsideStore | null {
  const { remote, engine, access } = services;
  if (!canListAside(remote)) return null;
  let store = stores.get(remote);
  if (!store) {
    // Un invitado no ve lo borrado: la base no le da nada, así que ni se pregunta.
    store = new LinkAsideStore(remote, engine, () => access.get()?.member?.role !== 'guest');
    stores.set(remote, store);
  }
  return store;
}

const none = () => EMPTY;
const noSubscribe = () => () => undefined;

/** Lo apartado de los links que la persona ve; con `fresh`, se pide en el acto al montar (Share, el historial). */
export function useLinkAside(fresh = false): LinkAsideSnapshot {
  const services = useServices();
  const store = linkAsideStore(services);
  const snapshot = useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.get ?? none);
  useEffect(() => {
    if (fresh) void store?.refresh(true);
  }, [fresh, store]);
  return snapshot;
}

/** El motivo de un apartado, para leer (el código queda en el archivo que se baja). */
export function asideReasonText(tr: Translate, reason: string | null): string {
  if (reason === 'link_revoked') return tr('link.reason.link_revoked');
  if (reason === 'pending') return tr('link.reason.pending');
  if (reason === 'foreign_media' || reason === 'external_url') return tr('link.reason.media');
  if (reason === 'too_big' || reason === 'too_deep') return tr('link.reason.size');
  return tr('link.reason.other');
}

/** Lo que se baja de un cambio de un link que no entró (lo apartado o lo retenido). */
export interface LinkChangeRef {
  id: string;
  author: string;
  created_at: string;
  reason: string | null;
  state?: string;
  page_id?: string;
}

/**
 * Los cambios de un link que no entraron, en un JSON para leerlos sin la app: el texto que traen (O8 de la auditoría de
 * la 2a) y los bytes de Yjs tal cual. De a uno (`linkUpdateBytes`); nunca se aplican en ningún lado.
 */
export async function linkChangesBlob(
  remote: Pick<LinkAsideRemote, 'linkUpdateBytes'>,
  rows: readonly LinkChangeRef[],
  meta: { pageId: string | null; title: string | null; titleOf?: (pageId: string) => string | undefined },
): Promise<Blob> {
  const out: unknown[] = [];
  for (const r of rows) {
    const bytes = await remote.linkUpdateBytes(r.id);
    out.push({
      id: r.id,
      ...(r.page_id ? { pageId: r.page_id, pageTitle: meta.titleOf?.(r.page_id) ?? null } : {}),
      author: r.author,
      createdAt: r.created_at,
      state: r.state ?? 'aside',
      reason: r.reason,
      text: insertedText(bytes),
      yjsUpdate: toBase64(bytes),
    });
  }
  return new Blob(
    [
      JSON.stringify({
        kind: 'lga-shotdocs-link-changes',
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        appVersion: __APP_VERSION__,
        pageId: meta.pageId,
        title: meta.title,
        changes: out,
      }),
    ],
    { type: 'application/json' },
  );
}

export async function downloadLinkChanges(...args: Parameters<typeof linkChangesBlob>): Promise<void> {
  saveBlob(await linkChangesBlob(...args), `shotdocs-link-changes-${new Date().toISOString().slice(0, 10)}.json`);
}
