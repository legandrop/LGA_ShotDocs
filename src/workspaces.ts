import { useSyncExternalStore } from 'react';
import { parseInviteHash, type InvitePayload } from './invite';
import { legacyStorageNames, storageNamesFor, WANKA_LOCAL_KEY, type WorkspaceConfig } from './workspace';

// La lista de workspaces del dispositivo (paso 12 de Docs/Plan_Workspaces.md). Vive en `localStorage`
// porque hace falta antes de entrar y sin red: dice a qué Supabase se conecta la app y cómo se llama lo
// guardado de cada workspace. El de la compilación (Wanka, en la dirección de Lega) entra siempre con los
// nombres de siempre (`legacyStorageNames`); los demás usan los que llevan su clave local
// (`storageNamesFor`). Nada de lo guardado se renombra nunca.
//
// Cambiar de workspace guarda el elegido como el último abierto y recarga la app: así nunca hay dos
// clientes de Supabase ni dos sincronizaciones andando a la vez en la misma pestaña.

export const WORKSPACES_KEY = 'shotdocs-workspaces';

export interface DeviceWorkspace {
  /**
   * Id en la lista: la clave local (la del de la compilación es `WANKA_LOCAL_KEY`). Mientras un workspace
   * agregado con "Create" espera a que su dueño entre para leer la clave local, `pending.<azar>` (el punto
   * no entra en una clave local de verdad, así que nunca choca con una).
   */
  id: string;
  /** Dirección del Supabase, sin barra al final. */
  url: string;
  publishableKey: string;
  /** Vacía en uno pendiente. */
  localKey: string;
  /** `workspace_settings.name`, guardado al sincronizar; vacío si todavía no se sabe. */
  name: string;
  /** El de la compilación: usa los nombres de siempre, sigue la dirección y la clave de la compilación y no se quita. */
  legacy?: boolean;
  /** Agregado con "Create" sin poder leer su clave local antes de entrar. */
  pending?: boolean;
}

export interface WorkspaceList {
  /** El último abierto en este dispositivo. */
  active: string | null;
  workspaces: DeviceWorkspace[];
}

/** Lo mínimo de `localStorage` que usa la lista (las pruebas pasan uno en memoria). */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const memory = new Map<string, string>();
const memoryStore: KeyValueStore = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => void memory.set(k, v),
  removeItem: (k) => void memory.delete(k),
};

/** `localStorage`, o uno en memoria si el navegador no deja usarlo (la lista dura lo que la pestaña). */
export function browserStore(): KeyValueStore {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.getItem(WORKSPACES_KEY);
      return localStorage;
    }
  } catch {
    // Sin almacenamiento: en memoria.
  }
  return memoryStore;
}

// --- Validación ---------------------------------------------------------------------------------------

const LOCAL_KEY = /^[a-z0-9_-]{4,64}$/;
const PUBLISHABLE_KEY = /^sb_publishable_[A-Za-z0-9_-]{8,200}$/;

/** La misma forma que acepta la base (`workspace_settings.local_key`). */
export function validLocalKey(key: string): boolean {
  return LOCAL_KEY.test(key);
}

export function validPublishableKey(key: string): boolean {
  return PUBLISHABLE_KEY.test(key);
}

function appOnLocalhost(): boolean {
  return typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
}

/**
 * La dirección de un Supabase, limpia (`https://<ref>.supabase.co`). `null` si no es `https://` o trae algo
 * más que la dirección (usuario, camino, parámetros). `http://localhost` solo se acepta con la app corriendo
 * en la computadora (para probar con un Supabase local).
 */
export function workspaceOrigin(raw: string, allowLocalHttp = appOnLocalhost()): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const localHttp = url.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
  if (url.protocol !== 'https:' && !(localHttp && allowLocalHttp)) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  return url.origin;
}

function sameOrigin(a: string, b: string): boolean {
  const norm = (x: string) => x.trim().replace(/\/+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

/** El host que se le muestra a la persona para que sepa a qué servidor se conecta. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** El nombre para mostrar: el de la base o, si todavía no se sabe, el host. */
export function displayName(ws: DeviceWorkspace): string {
  return ws.name || hostOf(ws.url);
}

// --- Leer y guardar -----------------------------------------------------------------------------------

function cleanEntry(raw: unknown): DeviceWorkspace | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.url !== 'string' || typeof r.publishableKey !== 'string') return null;
  const entry: DeviceWorkspace = {
    id: r.id,
    url: r.url,
    publishableKey: r.publishableKey,
    localKey: typeof r.localKey === 'string' ? r.localKey : '',
    name: typeof r.name === 'string' ? r.name.slice(0, 200) : '',
  };
  if (r.legacy === true) entry.legacy = true;
  else if (r.pending === true) {
    if (!r.id.startsWith('pending.')) return null;
    entry.pending = true;
    entry.localKey = '';
  } else if (!validLocalKey(entry.localKey) || entry.id !== entry.localKey) {
    return null;
  }
  return entry;
}

export function readWorkspaces(store: KeyValueStore = browserStore()): WorkspaceList {
  let raw: unknown = null;
  try {
    raw = JSON.parse(store.getItem(WORKSPACES_KEY) ?? 'null');
  } catch {
    raw = null;
  }
  const r = (raw && typeof raw === 'object' ? raw : {}) as { active?: unknown; workspaces?: unknown };
  const workspaces: DeviceWorkspace[] = [];
  for (const item of Array.isArray(r.workspaces) ? r.workspaces : []) {
    const entry = cleanEntry(item);
    // Uno solo de la compilación y ningún id repetido.
    if (!entry || workspaces.some((w) => w.id === entry.id || (entry.legacy && w.legacy))) continue;
    workspaces.push(entry);
  }
  const active = typeof r.active === 'string' && workspaces.some((w) => w.id === r.active) ? r.active : null;
  return { active, workspaces };
}

const EVENT = 'shotdocs:workspaces';

export function writeWorkspaces(list: WorkspaceList, store: KeyValueStore = browserStore()): void {
  try {
    store.setItem(WORKSPACES_KEY, JSON.stringify(list));
  } catch {
    // Sin almacenamiento, la lista dura lo que dure la pestaña.
  }
  cachedRaw = undefined;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
}

/** Lee la lista, le aplica un cambio y la guarda. */
export function updateWorkspaces(
  change: (list: WorkspaceList) => WorkspaceList,
  store: KeyValueStore = browserStore(),
): WorkspaceList {
  const next = change(readWorkspaces(store));
  writeWorkspaces(next, store);
  return next;
}

/**
 * Al abrir la app: la lista del dispositivo con el workspace de la compilación adentro. Ese entra (o se
 * actualiza) con la dirección y la clave de la compilación, la clave local de siempre y los nombres de
 * siempre; si el dispositivo no tenía ninguno abierto, queda abierto ese. Sin compilación configurada, la
 * lista queda como está (puede estar vacía: pantalla de bienvenida).
 */
export function loadWorkspaces(
  build: { url: string; publishableKey: string } | null,
  store: KeyValueStore = browserStore(),
): WorkspaceList {
  const list = readWorkspaces(store);
  if (build) {
    const url = build.url.trim().replace(/\/+$/, '');
    let entry = list.workspaces.find((w) => w.legacy);
    if (!entry && !list.workspaces.some((w) => sameOrigin(w.url, url))) {
      entry = { id: WANKA_LOCAL_KEY, url, publishableKey: build.publishableKey, localKey: WANKA_LOCAL_KEY, name: '', legacy: true };
      list.workspaces.unshift(entry);
    }
    if (entry) {
      // Si Wanka se restaura en otro proyecto de Supabase, la compilación nueva trae la dirección nueva y
      // el dispositivo sigue con su base de siempre (la generación hace el resto).
      Object.assign(entry, { id: WANKA_LOCAL_KEY, url, publishableKey: build.publishableKey, localKey: WANKA_LOCAL_KEY });
      if (!list.active) list.active = entry.id;
    }
  }
  if (!list.active && list.workspaces.length) list.active = list.workspaces[0].id;
  writeWorkspaces(list, store);
  return list;
}

export function activeWorkspace(list: WorkspaceList): DeviceWorkspace | null {
  return list.workspaces.find((w) => w.id === list.active) ?? null;
}

/** El workspace con esa dirección (sin contar los pendientes). */
export function findByUrl(list: WorkspaceList, url: string): DeviceWorkspace | null {
  return list.workspaces.find((w) => !w.pending && sameOrigin(w.url, url)) ?? null;
}

/** El objeto del código (`WorkspaceConfig`) de un workspace de la lista, con los nombres que le tocan. */
export function configOf(ws: DeviceWorkspace): WorkspaceConfig {
  if (ws.legacy) {
    return {
      url: ws.url,
      publishableKey: ws.publishableKey,
      name: ws.name,
      localKey: WANKA_LOCAL_KEY,
      storage: legacyStorageNames(WANKA_LOCAL_KEY),
    };
  }
  const key = ws.pending ? ws.id : ws.localKey;
  return { url: ws.url, publishableKey: ws.publishableKey, name: ws.name, localKey: key, storage: storageNamesFor(key) };
}

// --- Agregar ------------------------------------------------------------------------------------------

export type WorkspaceCheck =
  | { kind: 'ok'; url: string }
  /** Ya está en el dispositivo: se abre ese, sin tocar nada de lo guardado. */
  | { kind: 'existing'; entry: DeviceWorkspace }
  | { kind: 'invalid'; reason: string };

/**
 * Revisa un workspace antes de agregarlo: dirección `https://`, clave publicable (`sb_publishable_…`) y, si
 * viene, la clave local con su forma. Una clave local que ya usa otro workspace del dispositivo (también la
 * de siempre, la del de la compilación) con otra dirección se rechaza: compartirían la base local, y un link armado a propósito
 * mandaría lo sin subir de uno al servidor de otro.
 */
export function checkWorkspace(
  list: WorkspaceList,
  input: { url: string; publishableKey: string; localKey?: string },
  allowLocalHttp?: boolean,
): WorkspaceCheck {
  const url = workspaceOrigin(input.url, allowLocalHttp);
  if (!url) return { kind: 'invalid', reason: 'The workspace address must be an https:// address, like https://abcd.supabase.co.' };
  const existing = findByUrl(list, url);
  if (existing) return { kind: 'existing', entry: existing };
  const key = input.publishableKey.trim();
  if (key.startsWith('sb_secret_')) {
    return { kind: 'invalid', reason: 'That is a secret key: never paste it anywhere. Use the publishable key (sb_publishable_…).' };
  }
  if (!validPublishableKey(key)) return { kind: 'invalid', reason: 'The publishable key must start with sb_publishable_.' };
  if (input.localKey !== undefined) {
    if (!validLocalKey(input.localKey)) {
      return { kind: 'invalid', reason: 'This invitation link is damaged (its local key is not valid). Ask for a new one.' };
    }
    const clash = list.workspaces.find((w) => !w.pending && configOf(w).localKey === input.localKey);
    if (clash) {
      return {
        kind: 'invalid',
        reason: `This link is for a workspace that uses the same local key as “${displayName(clash)}” on this device, but at a different address. Ask the person who invited you for a new link.`,
      };
    }
  }
  return { kind: 'ok', url };
}

export function addWorkspace(list: WorkspaceList, entry: DeviceWorkspace, open = true): WorkspaceList {
  const workspaces = [...list.workspaces.filter((w) => w.id !== entry.id), entry];
  return { active: open ? entry.id : list.active, workspaces };
}

export function setActive(list: WorkspaceList, id: string): WorkspaceList {
  return list.workspaces.some((w) => w.id === id) ? { ...list, active: id } : list;
}

/** Guarda el nombre que dio la base. No toca nada más (la clave local nunca cambia). */
export function renameWorkspace(list: WorkspaceList, id: string, name: string): WorkspaceList {
  const clean = name.trim().slice(0, 200);
  if (!clean || !list.workspaces.some((w) => w.id === id && w.name !== clean)) return list;
  return { ...list, workspaces: list.workspaces.map((w) => (w.id === id ? { ...w, name: clean } : w)) };
}

/**
 * Saca un workspace de la lista (lo guardado lo borra quien llama). El de la compilación nunca: vuelve a
 * entrar solo al abrir la app, con los nombres de siempre. Si era el abierto, queda abierto el de la
 * compilación o el primero; sin ninguno, la bienvenida.
 */
export function removeWorkspace(list: WorkspaceList, id: string): WorkspaceList {
  const target = list.workspaces.find((w) => w.id === id);
  if (!target || target.legacy) return list;
  const workspaces = list.workspaces.filter((w) => w.id !== id);
  const active =
    list.active !== id ? list.active : (workspaces.find((w) => w.legacy) ?? workspaces[0])?.id ?? null;
  return { active, workspaces };
}

/** Uno nuevo desde un link de invitación ya revisado. */
export function entryFromInvite(payload: InvitePayload, url: string): DeviceWorkspace {
  return { id: payload.l, url, publishableKey: payload.k.trim(), localKey: payload.l, name: payload.n?.trim().slice(0, 200) ?? '' };
}

/** Uno agregado con "Create" sin clave local: queda pendiente hasta que su dueño entra. */
export function pendingEntry(url: string, publishableKey: string): DeviceWorkspace {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  const id = `pending.${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  return { id, url, publishableKey: publishableKey.trim(), localKey: '', name: '', pending: true };
}

export type InviteResolution =
  /** El workspace ya está en el dispositivo: se abre ese. */
  | { kind: 'open'; entry: DeviceWorkspace; target: string | null }
  /** Uno nuevo: se le pregunta a la persona antes de agregarlo. */
  | { kind: 'confirm'; entry: DeviceWorkspace; target: string | null }
  | { kind: 'invalid'; reason: string };

/** Qué hacer con un link de invitación (su payload ya leído). */
export function resolveInvite(list: WorkspaceList, payload: InvitePayload, allowLocalHttp?: boolean): InviteResolution {
  const target = payload.p ?? null;
  const check = checkWorkspace(list, { url: payload.u, publishableKey: payload.k, localKey: payload.l }, allowLocalHttp);
  if (check.kind === 'invalid') return check;
  if (check.kind === 'existing') return { kind: 'open', entry: check.entry, target };
  return { kind: 'confirm', entry: entryFromInvite(payload, check.url), target };
}

const BROKEN_LINK = 'This is not a valid invitation link. Copy the whole link again, or ask for a new one.';

/** Lo que se pega en "Join a workspace": el link entero o solo la parte desde `#invite=`. */
export function resolveInviteText(list: WorkspaceList, text: string, allowLocalHttp?: boolean): InviteResolution {
  const at = text.indexOf('#invite=');
  if (at < 0) return { kind: 'invalid', reason: BROKEN_LINK };
  const payload = parseInviteHash(text.slice(at).trim());
  if (!payload) return { kind: 'invalid', reason: BROKEN_LINK };
  return resolveInvite(list, payload, allowLocalHttp);
}

// --- Leer el workspace antes de entrar ----------------------------------------------------------------

export type WorkspaceProbe =
  | { kind: 'ready'; name: string; localKey: string; schemaVersion: number | null }
  /** Tiene `workspace_settings` pero sin clave local: falta correr el comando. */
  | { kind: 'noLocalKey' }
  /** No tiene las tablas de la app: falta correr el comando. */
  | { kind: 'notSetUp' }
  /** La base no deja leer los ajustes sin sesión: se lee después de entrar. */
  | { kind: 'signInFirst' }
  | { kind: 'badKey' }
  | { kind: 'unreachable'; message: string };

/**
 * Lee `workspace_settings` (`name`, `local_key`, `schema_version`) con la clave publicable, sin sesión. Hoy
 * la base solo deja leerla con sesión (`signInFirst`): entonces el workspace entra pendiente y se completa
 * después de que el dueño entra (`adoptPending`).
 */
export async function probeWorkspace(
  url: string,
  publishableKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<WorkspaceProbe> {
  let res: Response;
  try {
    // La clave publicable va solo en `apikey` (nunca como `Authorization: Bearer`).
    res = await fetchFn(`${url}/rest/v1/workspace_settings?select=name,local_key,schema_version&limit=1`, {
      headers: { apikey: publishableKey, Accept: 'application/json' },
    });
  } catch (err) {
    return { kind: 'unreachable', message: err instanceof Error ? err.message : String(err) };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.ok) {
    const row = (Array.isArray(body) ? body[0] : null) as
      | { name?: unknown; local_key?: unknown; schema_version?: unknown }
      | null
      | undefined;
    if (!row) return { kind: 'notSetUp' };
    const localKey = typeof row.local_key === 'string' ? row.local_key : '';
    if (!validLocalKey(localKey)) return { kind: 'noLocalKey' };
    return {
      kind: 'ready',
      name: typeof row.name === 'string' ? row.name : '',
      localKey,
      schemaVersion: typeof row.schema_version === 'number' ? row.schema_version : null,
    };
  }
  const code = String((body as { code?: unknown } | null)?.code ?? '');
  if (code === '42501') return { kind: 'signInFirst' };
  // Sin la tabla, o sin las columnas del paso 5 (una base vieja).
  if (code === 'PGRST205' || code === '42P01' || code === '42703' || res.status === 404) return { kind: 'notSetUp' };
  if (res.status === 401 || res.status === 403) return { kind: 'badKey' };
  return { kind: 'unreachable', message: `the server answered ${res.status}` };
}

// --- Uno pendiente, después de entrar -----------------------------------------------------------------

/** Lo que Supabase guarda con el nombre de la sesión (la sesión misma y, según la versión, dos más). */
const AUTH_SUFFIXES = ['', '-user', '-code-verifier'];

export type AdoptResult = { ok: true; entry: DeviceWorkspace } | { ok: false; reason: string };

export const NEEDS_SETUP_COMMAND =
  'This Supabase is not ready for LGA Shot Docs yet: run the setup command (step 4 of the guide), then try again.';

/**
 * Completa uno pendiente con lo que la base dio después de entrar: pasa la sesión recién abierta a los
 * nombres de su clave local (todavía no hay nada más guardado con el nombre provisorio: la app no abre la
 * base local de un pendiente) y lo deja abierto. Quien llama frena la renovación de la sesión antes y
 * recarga la app después.
 */
export function adoptPending(
  pendingId: string,
  settings: { name: string | null; localKey: string | null },
  store: KeyValueStore = browserStore(),
): AdoptResult {
  const list = readWorkspaces(store);
  const pending = list.workspaces.find((w) => w.id === pendingId && w.pending);
  if (!pending) return { ok: false, reason: 'This workspace is not on this device anymore.' };
  const localKey = settings.localKey ?? '';
  if (!validLocalKey(localKey)) return { ok: false, reason: NEEDS_SETUP_COMMAND };
  const others = { ...list, workspaces: list.workspaces.filter((w) => w.id !== pendingId) };
  const check = checkWorkspace(others, { url: pending.url, publishableKey: pending.publishableKey, localKey }, true);
  if (check.kind === 'existing') return { ok: false, reason: `“${displayName(check.entry)}” is already on this device.` };
  if (check.kind === 'invalid') return { ok: false, reason: check.reason };
  const from = storageNamesFor(pendingId);
  const to = storageNamesFor(localKey);
  try {
    for (const suffix of AUTH_SUFFIXES) {
      const value = store.getItem(from.auth + suffix);
      if (value !== null) store.setItem(to.auth + suffix, value);
      store.removeItem(from.auth + suffix);
    }
    const lastUser = store.getItem(from.lastUser);
    if (lastUser !== null) store.setItem(to.lastUser, lastUser);
    store.removeItem(from.lastUser);
  } catch {
    // Sin almacenamiento, la persona vuelve a entrar con un código: no se pierde nada.
  }
  const entry: DeviceWorkspace = {
    id: localKey,
    url: pending.url,
    publishableKey: pending.publishableKey,
    localKey,
    name: (settings.name ?? '').trim().slice(0, 200),
  };
  writeWorkspaces(addWorkspace(others, entry), store);
  return { ok: true, entry };
}

/**
 * Olvida lo que la app guardaba en `localStorage` de un workspace que se quita (sesión, último usuario,
 * proyecto elegido y últimas páginas). Los nombres llevan su clave local, así que no tocan los de nadie
 * más. El de la compilación nunca se quita.
 */
export function forgetWorkspaceStorage(ws: DeviceWorkspace, store: KeyValueStore = browserStore()): void {
  if (ws.legacy) return;
  const names = configOf(ws).storage;
  try {
    for (const suffix of AUTH_SUFFIXES) store.removeItem(names.auth + suffix);
    store.removeItem(names.lastUser);
    store.removeItem(names.project);
    store.removeItem(names.lastPages);
  } catch {
    // Son comodidades y una sesión: si no se pueden borrar, no importa.
  }
}

/**
 * Si el dispositivo tiene alguna base local de ese workspace (de cualquier cuenta). `null` si el navegador
 * no deja saberlo (entonces no se ofrece quitarlo sin entrar).
 */
export async function hasLocalData(ws: DeviceWorkspace): Promise<boolean | null> {
  if (ws.pending) return false;
  const prefix = `shotdocs:${configOf(ws).localKey}:`;
  try {
    if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return null;
    const dbs = await indexedDB.databases();
    return dbs.some((db) => db.name?.startsWith(prefix));
  } catch {
    return null;
  }
}

/** Abre otro workspace: lo guarda como el último abierto y recarga la app en el inicio. */
export function switchWorkspace(
  id: string,
  reload: () => void = () => location.replace('/'),
  store: KeyValueStore = browserStore(),
): void {
  updateWorkspaces((list) => setActive(list, id), store);
  reload();
}

// --- En React -----------------------------------------------------------------------------------------

let cachedRaw: string | null | undefined;
let cachedList: WorkspaceList = { active: null, workspaces: [] };

function snapshot(): WorkspaceList {
  let raw: string | null = null;
  try {
    raw = browserStore().getItem(WORKSPACES_KEY);
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedList = readWorkspaces();
  }
  return cachedList;
}

function subscribe(fn: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === WORKSPACES_KEY) fn();
  };
  window.addEventListener(EVENT, fn);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener('storage', onStorage);
  };
}

/** La lista del dispositivo; se actualiza cuando cambia (también desde otra pestaña). */
export function useWorkspaceList(): WorkspaceList {
  return useSyncExternalStore(subscribe, snapshot);
}
