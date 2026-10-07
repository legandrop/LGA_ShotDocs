import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createContext, useContext, useSyncExternalStore } from 'react';
import { fromBase64, toBase64 } from './lib/base64';
import { appVersionHeaders, type StorageNames, type WorkspaceConfig } from './workspace';
import { browserStore, hostOf, validLocalKey, validPublishableKey, workspaceOrigin, type KeyValueStore } from './workspaces';

// El link público, "Anyone with the link" (Docs/Doc_Link_Publico.md, secciones 3.1 y 3.2). Después del `#` (que no llega
// a ningún servidor ni al `Referer`): la dirección y la clave publicable del Supabase del workspace, su clave local y el
// token del link:  https://<app>/#link=<base64url de {"u","k","l","t"}>. Sin el nombre del workspace (P10).
//
// Quien lo abre entra sin cuenta: la app guarda el link en el dispositivo (su propia lista, con su base local y su id de
// dispositivo) y habla con la base con un cliente sin sesión que manda el token en `x-shotdocs-link` en cada pedido. La
// base decide todo (`plink_*`). Nunca se usa ni se manda la sesión de una cuenta.

export interface LinkPayload {
  /** Dirección del Supabase del workspace. */
  u: string;
  /** Clave publicable. */
  k: string;
  /** Clave local (`workspace_settings.local_key`). */
  l: string;
  /** El token: `sdl_` + 43 caracteres base64url. */
  t: string;
}

const PREFIX = '#link=';
export const LINK_TOKEN = /^sdl_[A-Za-z0-9_-]{43}$/;
export const LINK_HEADER = 'x-shotdocs-link';
export const DEVICE_HEADER = 'x-shotdocs-device';

function base64url(text: string): string {
  return toBase64(new TextEncoder().encode(text)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(text: string): string {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  return new TextDecoder().decode(fromBase64(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
}

/** El link que se copia en *Share*. */
export function publicLinkUrl(appOrigin: string, payload: LinkPayload): string {
  const clean: LinkPayload = { u: payload.u, k: payload.k, l: payload.l, t: payload.t };
  return `${appOrigin.replace(/\/+$/, '')}/${PREFIX}${base64url(JSON.stringify(clean))}`;
}

/** Lee un link público (la parte del `#`). `null` si no es uno o está roto. */
export function parseLinkHash(hash: string, allowLocalHttp?: boolean): LinkPayload | null {
  if (!hash.startsWith(PREFIX)) return null;
  try {
    const data = JSON.parse(fromBase64url(hash.slice(PREFIX.length))) as Partial<LinkPayload>;
    if (typeof data.u !== 'string' || typeof data.k !== 'string' || typeof data.l !== 'string' || typeof data.t !== 'string') {
      return null;
    }
    const url = workspaceOrigin(data.u, allowLocalHttp);
    if (!url || !validPublishableKey(data.k) || !validLocalKey(data.l) || !LINK_TOKEN.test(data.t)) return null;
    return { u: url, k: data.k, l: data.l, t: data.t };
  } catch {
    return null;
  }
}

let hashRead = false;

/**
 * Lee una sola vez, al abrir la app, el link público de la dirección y lo saca de la barra (`history.replaceState`): no
 * queda en la pantalla, en una captura ni en el historial del navegador. `broken`: traía `#link=` y no se pudo leer.
 */
export function takeLinkHash(): { payload: LinkPayload | null; broken: boolean } {
  if (hashRead || typeof location === 'undefined') return { payload: null, broken: false };
  hashRead = true;
  if (!location.hash.startsWith(PREFIX)) return { payload: null, broken: false };
  const payload = parseLinkHash(location.hash);
  const url = new URL(location.href);
  if (payload) url.searchParams.delete('w');
  history.replaceState(history.state, '', url.pathname + url.search);
  return { payload, broken: !payload };
}

/** Las pruebas vuelven a leer la dirección. */
export function resetLinkHashForTests(): void {
  hashRead = false;
}

// --- Los links guardados en el dispositivo -----------------------------------------------------------------------

export const LINKS_KEY = 'shotdocs-links';

/** Un link abierto en este dispositivo. */
export interface LinkEntry {
  /** Id en la lista (al azar): nombra la base local del link. */
  id: string;
  url: string;
  publishableKey: string;
  localKey: string;
  token: string;
  /** El id de dispositivo de este link (32 bytes al azar): uno por link, así un link no se entera del de otro. */
  device: string;
  /** El nombre con el que comenta el visitante (P8); vacío hasta que lo escribe. */
  name: string;
  /** El título de la página compartida, guardado al abrir (para la lista y el cartel). */
  title: string;
  /** El id del link en la base y la página compartida, guardados al abrir: con eso se vuelve a abrir sin red. */
  linkId: string;
  pageId: string;
  openedAt: number;
  /**
   * Las páginas donde este dispositivo mandó algo con el link (entrega 2c, O9 de la auditoría de la 2a): la pantalla de
   * "este link ya no anda" las ofrece para bajar aunque se haya recargado la app después de mandar.
   */
  sent?: string[];
  /**
   * Por página, cuántas filas apartadas tenía este dispositivo cuando el visitante volvió a la versión del
   * equipo (entrega 2c): el aviso de lo apartado se muestra solo si después se aparta algo más.
   */
  asideSeen?: Record<string, number>;
}

export interface LinkList {
  /** El último abierto (se vuelve a abrir si el dispositivo no tiene ningún workspace). */
  active: string | null;
  links: LinkEntry[];
}

function randomId(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return toBase64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function validEntry(e: unknown): e is LinkEntry {
  const x = e as Partial<LinkEntry> | null;
  return (
    !!x &&
    typeof x.id === 'string' &&
    /^[A-Za-z0-9_-]{8,64}$/.test(x.id) &&
    typeof x.url === 'string' &&
    typeof x.publishableKey === 'string' &&
    typeof x.localKey === 'string' &&
    typeof x.token === 'string' &&
    LINK_TOKEN.test(x.token) &&
    typeof x.device === 'string' &&
    /^[A-Za-z0-9_-]{16,128}$/.test(x.device)
  );
}

export function readLinks(store: KeyValueStore = browserStore()): LinkList {
  try {
    const raw = store.getItem(LINKS_KEY);
    const data = raw ? (JSON.parse(raw) as Partial<LinkList>) : null;
    const links = Array.isArray(data?.links) ? data.links.filter(validEntry).map((l) => ({ ...l, name: l.name ?? '', title: l.title ?? '', linkId: l.linkId ?? '', pageId: l.pageId ?? '' })) : [];
    const active = typeof data?.active === 'string' && links.some((l) => l.id === data.active) ? data.active : null;
    return { active, links };
  } catch {
    return { active: null, links: [] };
  }
}

export function writeLinks(list: LinkList, store: KeyValueStore = browserStore()): void {
  try {
    store.setItem(LINKS_KEY, JSON.stringify(list));
  } catch {
    // Sin almacenamiento: el link dura lo que la pestaña.
  }
}

/** Guarda (o encuentra) el link y lo deja como el último abierto. Devuelve la entrada. */
export function rememberLink(payload: LinkPayload, store: KeyValueStore = browserStore()): LinkEntry {
  const list = readLinks(store);
  let entry = list.links.find((l) => l.token === payload.t && l.url === payload.u);
  if (!entry) {
    entry = {
      id: randomId(12),
      url: payload.u,
      publishableKey: payload.k,
      localKey: payload.l,
      token: payload.t,
      device: randomId(32),
      name: '',
      title: '',
      linkId: '',
      pageId: '',
      openedAt: Date.now(),
    };
    list.links.push(entry);
  } else {
    entry.openedAt = Date.now();
  }
  writeLinks({ active: entry.id, links: list.links }, store);
  return entry;
}

export function activeLink(store: KeyValueStore = browserStore()): LinkEntry | null {
  const list = readLinks(store);
  return list.links.find((l) => l.id === list.active) ?? null;
}

/** Cambia algo de un link guardado (el nombre del visitante, el título, el id del link y de la página). */
export function updateLink(id: string, patch: Partial<Pick<LinkEntry, 'name' | 'title' | 'linkId' | 'pageId'>>, store: KeyValueStore = browserStore()): LinkEntry | null {
  const list = readLinks(store);
  const entry = list.links.find((l) => l.id === id);
  if (!entry) return null;
  Object.assign(entry, patch);
  writeLinks(list, store);
  return entry;
}

/**
 * Lo que el modo link recuerda de lo mandado, guardado con el link en este dispositivo (`LinkEntry.sent` y
 * `asideSeen`). Lo usa `LinkRemote`; se lee cada vez (otra pestaña del mismo link también lo cambia).
 */
export interface LinkMemory {
  sent(): string[];
  addSent(pageId: string): void;
  /** Deja de recordar estas páginas (lo mandado ya entró, o ya se bajó y se dejó atrás). */
  dropSent(pageIds: string[]): void;
  seen(): Record<string, number>;
  setSeen(pageId: string, count: number): void;
}

/** Hasta cuántas páginas recuerda `sent` (las más recientes). */
const SENT_KEEP = 500;

export function linkMemory(id: string, store: KeyValueStore = browserStore()): LinkMemory {
  const entry = () => readLinks(store).links.find((l) => l.id === id);
  const change = (fn: (e: LinkEntry) => void) => {
    const list = readLinks(store);
    const e = list.links.find((l) => l.id === id);
    if (!e) return;
    fn(e);
    writeLinks(list, store);
  };
  return {
    sent: () => (Array.isArray(entry()?.sent) ? entry()!.sent!.filter((p) => typeof p === 'string') : []),
    addSent: (pageId) => {
      if (entry()?.sent?.includes(pageId)) return;
      change((e) => {
        e.sent = [...(Array.isArray(e.sent) ? e.sent : []).filter((p) => p !== pageId), pageId].slice(-SENT_KEEP);
      });
    },
    dropSent: (pageIds) => {
      const drop = new Set(pageIds);
      if (!entry()?.sent?.some((p) => drop.has(p))) return;
      change((e) => {
        e.sent = (Array.isArray(e.sent) ? e.sent : []).filter((p) => !drop.has(p));
      });
    },
    seen: () => {
      const v = entry()?.asideSeen;
      return v && typeof v === 'object' ? v : {};
    },
    setSeen: (pageId, count) =>
      change((e) => {
        e.asideSeen = { ...(e.asideSeen && typeof e.asideSeen === 'object' ? e.asideSeen : {}), [pageId]: count };
      }),
  };
}

/** Deja de abrir links al arrancar (volver a un workspace del dispositivo). No borra nada guardado. */
export function leaveLinks(store: KeyValueStore = browserStore()): void {
  const list = readLinks(store);
  writeLinks({ ...list, active: null }, store);
  setTabLink(null);
}

// --- El link de esta pestaña ---------------------------------------------------------------------------------------

const TAB_LINK_KEY = 'shotdocs-tab-link';

function tabStore(): KeyValueStore | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Recuerda qué link tiene abierta esta pestaña (`sessionStorage`: no pasa a otras pestañas ni sobrevive a cerrarla). El
 * `#link=` se borra de la barra al abrir, así que sin esto recargar la página (o que el teléfono recargue una pestaña de
 * fondo) en un dispositivo con un workspace abriría ese workspace y sacaría al visitante del link.
 */
export function setTabLink(id: string | null, store: KeyValueStore | null = tabStore()): void {
  try {
    if (!store) return;
    if (id) store.setItem(TAB_LINK_KEY, id);
    else store.removeItem(TAB_LINK_KEY);
  } catch {
    // Sin almacenamiento de pestaña: recargar vuelve al comienzo de siempre.
  }
}

/**
 * El link que esta pestaña tenía abierto, si se la recarga (o se la restaura). Tipear la dirección de la app (`navigate`)
 * abre la cuenta como siempre: solo vale con `reload` o `back_forward` (o si el navegador no lo dice).
 */
export function tabLink(
  list: LinkList = readLinks(),
  store: KeyValueStore | null = tabStore(),
  navigation: string | null = navigationType(),
): LinkEntry | null {
  try {
    if (!store || navigation === 'navigate' || navigation === 'prerender') return null;
    const id = store.getItem(TAB_LINK_KEY);
    return (id && list.links.find((l) => l.id === id)) || null;
  } catch {
    return null;
  }
}

function navigationType(): string | null {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return nav?.type ?? null;
  } catch {
    return null;
  }
}

/** «(via link)» y «(vía link)», con los espacios y las mayúsculas que sean: la app lo suma al mostrar el nombre. */
const VIA_LINK = /[(（]\s*v[ií]a\s+link\s*[)）]/gi;

/**
 * El nombre que escribe el visitante: 1 a 60 caracteres, sin controles ni marcas de dirección (como la base) y sin
 * «(via link)»: ese rótulo lo pone la app al lado del nombre, así que escrito en el nombre saldría dos veces. La base
 * lo saca igual de lo que le llega (`private.plink_author_name`, 20261112120000_link_nombre_sin_rotulo.sql).
 */
export function cleanVisitorName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  let name = raw.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2069\ufeff]/g, '');
  // Las veces que haga falta: sacar uno puede dejar armado otro («(via (via link) link)»).
  for (let before = ''; before !== name; ) {
    before = name;
    name = name.replace(VIA_LINK, ' ').replace(/\s+/g, ' ');
  }
  return name.trim().slice(0, 60).trim();
}

// --- El workspace del link: nombres propios en el dispositivo y un cliente sin sesión -------------------------------

/** Los nombres de lo que guarda un link en el dispositivo: nunca los de una cuenta del mismo workspace. */
export function linkStorageNames(entry: LinkEntry): StorageNames {
  const key = `link:${entry.localKey}:${entry.id}`;
  return {
    auth: `shotdocs-auth:${key}`,
    lastUser: `shotdocs-last-user:${key}`,
    project: `shotdocs-project:${key}`,
    lastPages: `shotdocs-last-pages:${key}`,
    inviteTarget: `shotdocs-invite-target:${key}`,
    db: () => `shotdocs-link:${entry.localKey}:${entry.id}`,
  };
}

export function linkConfig(entry: LinkEntry): WorkspaceConfig {
  return { url: entry.url, publishableKey: entry.publishableKey, name: '', localKey: `link:${entry.localKey}:${entry.id}`, storage: linkStorageNames(entry) };
}

/** Los headers de cada pedido del modo link (a la base y a Storage). */
export function linkHeaders(entry: Pick<LinkEntry, 'token' | 'device'>, version: string): Record<string, string> {
  return { ...appVersionHeaders(version), [LINK_HEADER]: entry.token, [DEVICE_HEADER]: entry.device };
}

const clients = new Map<string, SupabaseClient>();

/**
 * El cliente del modo link: sin sesión, sin guardarla ni renovarla y sin leer la dirección; nunca lleva el
 * `Authorization` de una cuenta (supabase-js manda la clave publicable). Uno por link y por carga de la app.
 */
export function createLinkClient(entry: LinkEntry, version: string = __APP_VERSION__, fetchImpl?: typeof fetch): SupabaseClient {
  // (Con un `fetch` de prueba no se usa ni se deja el cliente compartido.)
  const known = fetchImpl ? undefined : clients.get(entry.id);
  if (known) return known;
  const client = createClient(entry.url, entry.publishableKey, {
    global: { headers: linkHeaders(entry, version), ...(fetchImpl ? { fetch: fetchImpl } : {}) },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: linkStorageNames(entry).auth,
    },
  });
  if (!fetchImpl) clients.set(entry.id, client);
  return client;
}

// --- Lo que la interfaz sabe del link abierto ----------------------------------------------------------------------

export interface LinkInfo {
  entry: LinkEntry;
  /** El dominio del Supabase del link (*Shared with a link · xyz.supabase.co*). */
  domain: string;
  /** El id del link en la base (lo da `plink_open`); vacío hasta abrirlo. */
  linkId: string;
  /** La página compartida. */
  pageId: string;
}

export const LinkContext = createContext<LinkInfo | null>(null);

/** El link abierto, o `null` con una cuenta. */
export function useLinkMode(): LinkInfo | null {
  return useContext(LinkContext);
}

export function linkDomain(entry: Pick<LinkEntry, 'url'>): string {
  return hostOf(entry.url);
}

/**
 * El link abierto es *Can edit* pero la base se lo deja usar a esta app solo como *Can view* (lo que dijo `plink_open`,
 * guardado en el servidor del link): editar con un link está apagado en el workspace, o esta versión de la app es más
 * vieja que la que lo prendió. La app no sabe cuál de las dos.
 */
export function linkEditUnavailable(remote: unknown): boolean {
  const opened = (remote as { opened?: { level?: unknown; link_level?: unknown } | null } | null)?.opened;
  return opened?.level === 'comment' && opened.link_level === 'edit';
}

// --- El nombre del visitante (P8): guardado en el dispositivo, por link ---------------------------------------------

const nameListeners = new Set<() => void>();

export function setVisitorName(id: string, name: string, store: KeyValueStore = browserStore()): void {
  updateLink(id, { name: cleanVisitorName(name) }, store);
  for (const fn of nameListeners) fn();
}

export function visitorName(id: string, store: KeyValueStore = browserStore()): string {
  // Limpio también al leer: un nombre guardado por una versión anterior puede traer «(via link)».
  return cleanVisitorName(readLinks(store).links.find((l) => l.id === id)?.name ?? '');
}

/** El nombre con el que comenta el visitante del link abierto ('' si todavía no lo escribió, o sin link). */
export function useVisitorName(): string {
  const link = useLinkMode();
  return useSyncExternalStore(
    (fn) => {
      nameListeners.add(fn);
      return () => nameListeners.delete(fn);
    },
    () => (link ? visitorName(link.entry.id) : ''),
  );
}
