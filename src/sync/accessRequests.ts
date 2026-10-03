import type { SupabaseClient } from '@supabase/supabase-js';
import { isGrantLevel, isRole, type GrantLevel, type Role } from './access';
import { timed, toRemoteError } from './remote';
import { errorMessage, isNetworkError } from './types';

// *Request access* (P.30, entrega 2; Docs/Doc_Links_PDF.md, sección 5; supabase/migrations/20261031120000_access_requests.sql).
// Quien abre la dirección fija de un archivo sin poder verlo lo pide (`request_access`); quien puede compartir alguna
// página viva que usa el archivo ve los pendientes (`access_requests_pending`) en la campana y en *Share* de la página, y
// los decide (`decide_access_request`). Rechazar es explícito (LF20). Nada de esto se guarda en el dispositivo salvo,
// para quien pide, cuándo lo pidió: la base no le deja listar sus pedidos (sería la misma pregunta por otro camino).

/** La versión de la base con los pedidos de acceso. */
export const ACCESS_REQUESTS_SCHEMA_VERSION = 22;

/** Cada cuánto se pregunta con la ventana a la vista (el mismo ciclo de la campana, LF12). */
export const ACCESS_REQUESTS_EVERY_MS = 60_000;

/** Un pedido pendiente que quien llama puede decidir. */
export interface AccessRequest {
  id: string;
  userId: string;
  email: string;
  role: Role;
  fileId: string;
  fileName: string;
  mime: string;
  askedAt: string;
  times: number;
  /** Las páginas vivas que usan el archivo y quien llama puede compartir, en el orden en que se agregó (la primera, por defecto). */
  pages: { pageId: string; title: string }[];
}

/** Lo que se le pregunta a la base (las pruebas ponen uno en memoria). */
export interface AccessRequestsRemote {
  pending(): Promise<AccessRequest[]>;
  decide(id: string, accept: boolean, pageId: string | null, level: GrantLevel): Promise<'accepted' | 'declined'>;
}

async function call<T>(client: SupabaseClient, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error, status } = await timed(client.rpc(fn, args));
  if (error) throw toRemoteError(error, status);
  return data as T;
}

/** Pedir acceso a un archivo: `sent` exista o no (la base no lo dice), `has_access` si ya lo ve. Tira `rate_limited`. */
export async function requestAccess(client: SupabaseClient, fileId: string): Promise<'sent' | 'has_access'> {
  const res = await call<unknown>(client, 'request_access', { p_file: fileId });
  return res === 'has_access' ? 'has_access' : 'sent';
}

/** Una fila de `access_requests_pending`, o `null` si no tiene la forma. */
export function parseAccessRequest(r: Record<string, unknown>): AccessRequest | null {
  const s = (v: unknown) => (typeof v === 'string' ? v : null);
  const id = s(r.id);
  const userId = s(r.user_id);
  const fileId = s(r.file_id);
  if (!id || !userId || !fileId || !isRole(r.role)) return null;
  const pages = (Array.isArray(r.pages) ? r.pages : [])
    .map((p) => (p && typeof p === 'object' ? (p as Record<string, unknown>) : null))
    .filter((p): p is Record<string, unknown> => !!p && typeof p.page_id === 'string')
    .map((p) => ({ pageId: p.page_id as string, title: s(p.title) ?? '' }));
  if (pages.length === 0) return null;
  return {
    id,
    userId,
    email: s(r.email) ?? '',
    role: r.role,
    fileId,
    fileName: s(r.file_name) ?? '',
    mime: s(r.mime) ?? '',
    askedAt: s(r.asked_at) ?? '',
    times: typeof r.times === 'number' ? r.times : 1,
    pages,
  };
}

/** Lo de la base de un workspace con sesión. */
export function supabaseAccessRequests(client: SupabaseClient): AccessRequestsRemote {
  return {
    async pending() {
      const rows = await call<Record<string, unknown>[] | null>(client, 'access_requests_pending');
      return (rows ?? []).map(parseAccessRequest).filter((r): r is AccessRequest => r !== null);
    },
    async decide(id, accept, pageId, level) {
      if (accept && !isGrantLevel(level)) throw new Error('level_invalid');
      const res = await call<unknown>(client, 'decide_access_request', {
        p_id: id,
        p_accept: accept,
        p_page: accept ? pageId : null,
        p_level: level,
      });
      return res === 'declined' ? 'declined' : 'accepted';
    },
  };
}

/**
 * ¿Se pregunta la lista? Con la base del workspace en la versión 22 y un rol que puede compartir algo (no invitado, no
 * sacado). La base igual filtra (a quien no puede compartir nada le da una lista vacía): esto solo ahorra la pregunta.
 */
export function accessRequestsEnabled(schemaVersion: number | null | undefined, role: Role | null): boolean {
  return (schemaVersion ?? 0) >= ACCESS_REQUESTS_SCHEMA_VERSION && role !== null && role !== 'guest';
}

export interface AccessRequestsSnapshot {
  /** La base del workspace tiene pedidos y la persona puede decidir alguno (no es invitada). */
  ready: boolean;
  items: AccessRequest[];
}

const EMPTY: AccessRequestsSnapshot = { ready: false, items: [] };

/**
 * La lista de quien decide, solo en memoria (decidir pide red). Pregunta al estar lista, cada 60 s con la ventana a la
 * vista, al volver a la ventana o a la red, y después de decidir. Nunca tira: sin red o con un error, queda lo último.
 */
export class AccessRequestsInbox {
  private snapshot: AccessRequestsSnapshot = EMPTY;
  private readonly listeners = new Set<() => void>();
  private enabled = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly cleanups: (() => void)[] = [];
  private running: Promise<void> | null = null;
  private again = false;
  private stopped = false;

  constructor(
    private readonly remote: AccessRequestsRemote,
    private readonly options: { online?: () => boolean } = {},
  ) {}

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): AccessRequestsSnapshot => this.snapshot;

  /** Prende o apaga la lista (la versión de la base y el rol, ver services.ts). Al prenderse, pregunta ya. */
  setEnabled(on: boolean): void {
    if (this.stopped || on === this.enabled) return;
    this.enabled = on;
    if (!on) {
      this.publish({ ready: false, items: [] });
      return;
    }
    this.publish({ ready: true, items: this.snapshot.items });
    void this.poll();
  }

  start(): void {
    if (this.timer || this.stopped) return;
    const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
    this.timer = setInterval(() => {
      if (visible()) void this.poll();
    }, ACCESS_REQUESTS_EVERY_MS);
    if (typeof document !== 'undefined') {
      const onVisible = () => {
        if (visible()) void this.poll();
      };
      document.addEventListener('visibilitychange', onVisible);
      this.cleanups.push(() => document.removeEventListener('visibilitychange', onVisible));
    }
    if (typeof window !== 'undefined') {
      const onOnline = () => void this.poll();
      window.addEventListener('online', onOnline);
      this.cleanups.push(() => window.removeEventListener('online', onOnline));
    }
  }

  stop(): void {
    this.stopped = true;
    this.enabled = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const fn of this.cleanups.splice(0)) fn();
  }

  /** Pregunta la lista; si ya hay una pregunta en curso, se pregunta otra vez al terminar (lo decidido mientras tanto). */
  poll(): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        if (this.options.online && !this.options.online()) break;
        try {
          const items = await this.remote.pending();
          if (this.enabled) this.publish({ ready: true, items });
        } catch (err) {
          if (!isNetworkError(err)) console.warn('[pedidos] no se pudo preguntar:', errorMessage(err));
        }
      } while (this.again && this.enabled);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Decide un pedido (pide red; si falla, tira). Lo saca de la lista enseguida y vuelve a preguntar. */
  async decide(id: string, accept: boolean, pageId: string | null, level: GrantLevel): Promise<'accepted' | 'declined'> {
    try {
      const res = await this.remote.decide(id, accept, pageId, level);
      this.drop(id);
      return res;
    } catch (err) {
      // Ya decidido por otro, o ya no le toca: sale de la lista igual.
      if (errorMessage(err) === 'request_not_found') this.drop(id);
      throw err;
    } finally {
      void this.poll();
    }
  }

  private drop(id: string): void {
    if (this.snapshot.items.some((r) => r.id === id)) this.publish({ ...this.snapshot, items: this.snapshot.items.filter((r) => r.id !== id) });
  }

  private publish(next: AccessRequestsSnapshot): void {
    if (next.ready === this.snapshot.ready && sameItems(next.items, this.snapshot.items)) return;
    this.snapshot = next;
    for (const fn of this.listeners) fn();
  }
}

function sameItems(a: AccessRequest[], b: AccessRequest[]): boolean {
  return a.length === b.length && JSON.stringify(a) === JSON.stringify(b);
}

// --- Quien pide: cuándo lo pidió, en el dispositivo ---------------------------------------------------------------

const ASKED_KEY = 'shotdocs.accessAsked.';
const ASKED_KEEP = 200;

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readAsked(localKey: string, store: Store | null): Record<string, string> {
  try {
    const raw = store?.getItem(ASKED_KEY + localKey);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Cuándo pidió acceso a este archivo desde este dispositivo (ISO), o `null`. */
export function askedAt(localKey: string, fileId: string, store: Store | null = storage()): string | null {
  const at = readAsked(localKey, store)[fileId];
  return typeof at === 'string' && !Number.isNaN(Date.parse(at)) ? at : null;
}

/** Anota que lo pidió ahora (se guardan los últimos 200 por workspace; si no se puede guardar, no pasa nada). */
export function rememberAsked(localKey: string, fileId: string, now = new Date(), store: Store | null = storage()): void {
  const all = readAsked(localKey, store);
  delete all[fileId];
  all[fileId] = now.toISOString();
  const kept = Object.entries(all).slice(-ASKED_KEEP);
  try {
    store?.setItem(ASKED_KEY + localKey, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Sin almacenamiento (ventana privada, lleno): el pedido igual llegó a la base.
  }
}
