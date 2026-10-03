import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ModelInfo, ProviderId } from './providers';

// La clave del asistente, solo en este dispositivo (Docs/Doc_Asistente.md, sección 4; IA1, D-06). Una base IndexedDB
// propia (`shotdocs-assistant`), no la de cada workspace: la clave es de la persona. Un registro por correo: quien entra
// con otro correo en el mismo navegador no la ve en la app (una regla de la app, no una barrera: es la misma base).
//
// Se guarda cifrada con AES-GCM y una llave creada "no exportable" que vive en la misma base. Eso solo evita que la
// clave aparezca en claro por accidente (una captura de la pestaña de almacenamiento, un export): cualquier código que
// corra en la app, o quien abra las herramientas del navegador en esta computadora, la puede usar. Lo que de verdad la
// protege es que nunca sale del dispositivo salvo hacia el proveedor, y el tope de gasto que se fija en el proveedor.
//
// La clave se descifra justo antes de cada pedido y no queda en ninguna variable global ni en el estado de React. Nunca
// se escribe en un log, un error, la consola, la cola de sincronización ni un reporte.

export const ASSISTANT_DB = 'shotdocs-assistant';

/** Lo que se guarda de cada persona (la clave, cifrada). */
export interface AssistantRecord {
  /** El correo, en minúsculas. */
  email: string;
  provider: ProviderId;
  baseUrl?: string;
  model: string;
  /** La lista que dio el proveedor la última vez (se guarda con la clave). */
  models: ModelInfo[];
  /** La clave cifrada (vacía para un modelo local sin clave). */
  iv: Uint8Array | null;
  cipher: ArrayBuffer | null;
  savedAt: number;
  /** El último idioma de *Translate to…*. */
  translateTo?: string;
  /**
   * De qué copia sincronizada vino la clave o a cuál se subió (Docs/Doc_Clave_Sincronizada.md, sección 6). Campo
   * opcional adentro del registro de siempre: la base sigue en la versión 1 (una versión vieja de la app la abre con
   * `openDB(…, 1)`), y una versión vieja que guarda ajustes rehace el registro sin este campo, sin perder la clave.
   */
  sync?: KeySyncInfo;
  /**
   * Las copias en OTROS workspaces (*Also sync in this workspace*, S2): cada una es independiente y lleva su propia
   * generación. `sync` es la primera; estas, las demás. Una versión que no conoce el campo lo saca al guardar (solo se
   * pierde el aviso de "cambió en otro dispositivo" de esas copias, nunca la clave).
   */
  moreSync?: KeySyncInfo[];
}

/** La copia sincronizada de la que vino la clave de este dispositivo (o a la que se subió). */
export interface KeySyncInfo {
  /** El workspace de la copia (su clave local o su dirección, como la política). */
  ref: string;
  /** Su nombre, para mostrar. */
  name?: string;
  /** El id de la persona en el Supabase de ese workspace. */
  userId: string;
  /** La generación de la copia que se abrió o se escribió. */
  generation: number;
  /** El `savedAt` de adentro del sobre (autenticado). */
  savedAt: number;
  unlockedAt: number;
  /** La clave o el destino de este dispositivo cambiaron después: *Update synced key* sube la de ahora. */
  localChanged?: boolean;
  /**
   * La clave propia de *Voice* de este dispositivo es la de esta copia (se abrió con ella o se subió desde acá). Aparte
   * de `localChanged`, que habla de la del asistente: una *Voice* propia que no vino de la copia nunca se reemplaza sin
   * preguntar (regla 5), aunque la del asistente sí haya venido de ella.
   */
  voiceFromCopy?: boolean;
}

/** Lo que ve la app de los ajustes: todo menos la clave. */
export type AssistantSettings = Omit<AssistantRecord, 'iv' | 'cipher'> & {
  hasKey: boolean;
  /** *Keep the key on this device* destildada: la clave vive solo en esta pestaña (al recargar no está). */
  tabOnly?: boolean;
};

type SyncFields = Pick<AssistantRecord, 'sync' | 'moreSync'>;

/** Todas las copias de las que este dispositivo sabe algo (la primera, `sync`, y las de otros workspaces). */
export function syncEntries(r: SyncFields | null | undefined): KeySyncInfo[] {
  if (!r) return [];
  return [...(r.sync ? [r.sync] : []), ...(r.moreSync ?? [])];
}

/** La anotación de la copia de ESE workspace (y esa persona en su Supabase), o `undefined`. */
export function syncFor(r: SyncFields | null | undefined, ref: string, userId: string): KeySyncInfo | undefined {
  return syncEntries(r).find((e) => e.ref === ref && e.userId === userId);
}

function fieldsOf(entries: KeySyncInfo[]): SyncFields {
  const [first, ...rest] = entries;
  return { ...(first ? { sync: first } : {}), ...(rest.length ? { moreSync: rest } : {}) };
}

/** Pone (o cambia) la anotación de un workspace sin tocar las de los otros. */
function withEntry(entries: KeySyncInfo[], info: KeySyncInfo): KeySyncInfo[] {
  const i = entries.findIndex((e) => e.ref === info.ref && e.userId === info.userId);
  if (i < 0) return [...entries, info];
  const next = [...entries];
  next[i] = info;
  return next;
}

const stale = (entries: KeySyncInfo[]) => entries.map((e) => ({ ...e, localChanged: true }));

interface SaveOptions {
  /** La copia de la que viene la clave (al abrirla); `null` saca todas las anotaciones. */
  sync?: KeySyncInfo | null;
  /** Con `sync`: la clave cambió respecto de las copias de los otros workspaces. */
  othersStale?: boolean;
  /** *Keep the key on this device* destildada: la clave queda solo en esta pestaña y nada se escribe en la base. */
  tabOnly?: boolean;
}

/**
 * Las anotaciones después de guardar. Sin `sync` en las opciones: si cambian la clave o el destino, todas quedan
 * marcadas (cada copia ofrece *Update synced key*). Con una anotación: se pone la de ese workspace y, con
 * `othersStale`, las de los otros quedan marcadas (la clave del dispositivo ya no es la de esas copias).
 */
function nextSync(prev: SyncFields | undefined, changed: boolean, options: SaveOptions): SyncFields {
  const entries = syncEntries(prev);
  if (options.sync === null) return {};
  if (options.sync === undefined) return fieldsOf(changed ? stale(entries) : entries);
  const info = options.sync;
  return fieldsOf(withEntry(options.othersStale ? stale(entries) : entries, info));
}

// --- Solo en esta pestaña (Keep the key on this device destildada; Doc_Clave_Sincronizada.md, sección 6, CS7) --------
//
// La única excepción a "la clave no queda en ninguna variable": una variable de este módulo (nunca `window` ni el estado
// de React), que un script dentro de la app podría leer igual que hoy puede usar la clave guardada. Mientras está, manda
// sobre lo guardado en la base: se lee, se cambia y se olvida acá, y la base no se toca. Al recargar, no está.

interface TabRecord {
  record: Omit<AssistantRecord, 'iv' | 'cipher'>;
  apiKey: string;
}
const tabOnly = new Map<string, TabRecord>();

const tabSettings = (t: TabRecord): AssistantSettings => ({ ...t.record, hasKey: !!t.apiKey, tabOnly: true });

/** Para las pruebas: como recargar la pestaña (lo que vivía solo en ella se va). */
export function resetTabOnlyKeys(): void {
  tabOnly.clear();
}

interface Schema extends DBSchema {
  keys: { key: string; value: AssistantRecord };
  crypto: { key: string; value: { id: string; key: CryptoKey } };
}

let opening: Promise<IDBPDatabase<Schema>> | null = null;

function db(): Promise<IDBPDatabase<Schema>> {
  opening ??= openDB<Schema>(ASSISTANT_DB, 1, {
    upgrade(d) {
      d.createObjectStore('keys', { keyPath: 'email' });
      d.createObjectStore('crypto', { keyPath: 'id' });
    },
  }).catch((err: unknown) => {
    opening = null;
    throw err;
  });
  return opening;
}

/** Para las pruebas: cierra la base (la próxima vez se vuelve a abrir). */
export async function closeAssistantDb(): Promise<void> {
  const d = await opening?.catch(() => null);
  d?.close();
  opening = null;
}

const norm = (email: string) => email.trim().toLowerCase();

/** La llave del dispositivo (no exportable); se crea la primera vez. */
async function deviceKey(): Promise<CryptoKey> {
  const d = await db();
  const found = await d.get('crypto', 'aes');
  if (found) return found.key;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  // Dos pestañas a la vez: queda la primera que se guardó.
  const tx = d.transaction('crypto', 'readwrite');
  const again = await tx.store.get('aes');
  if (again) {
    await tx.done;
    return again.key;
  }
  await tx.store.put({ id: 'aes', key });
  await tx.done;
  return key;
}

/** A dónde va la clave: el proveedor y, en uno compatible, su dirección (Base URL). */
export interface KeyDestination {
  provider: ProviderId;
  baseUrl?: string;
}

/** La dirección de un proveedor compatible, para comparar: sin espacios ni barras al final, el host en minúsculas. */
export function normalizeBaseUrl(url: string | undefined): string {
  const raw = (url ?? '').trim();
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return raw.replace(/\/+$/, '');
  }
}

/**
 * Si una clave guardada para `a` puede ir a `b`: el mismo proveedor y, en uno compatible, la misma dirección. La clave
 * de un servicio compatible es de ese servicio: si cambia la Base URL, la guardada no viaja a la nueva (hay que pegarla).
 */
export function sameDestination(a: KeyDestination, b: KeyDestination): boolean {
  if (a.provider !== b.provider) return false;
  return a.provider !== 'compatible' || normalizeBaseUrl(a.baseUrl) === normalizeBaseUrl(b.baseUrl);
}

function settingsOf(r: AssistantRecord): AssistantSettings {
  const { iv: _iv, cipher, ...rest } = r;
  return { ...rest, hasKey: !!cipher };
}

/** Los ajustes de la persona en este dispositivo (sin la clave), o `null`. */
export async function loadSettings(email: string): Promise<AssistantSettings | null> {
  const t = tabOnly.get(norm(email));
  if (t) return tabSettings(t);
  const r = await (await db()).get('keys', norm(email));
  return r ? settingsOf(r) : null;
}

/** Si la persona tiene una clave guardada en este dispositivo (para la casilla de salir). */
export async function hasAssistantKey(email: string): Promise<boolean> {
  if (tabOnly.has(norm(email))) return true;
  try {
    const r = await (await db()).get('keys', norm(email));
    return !!r;
  } catch {
    return false;
  }
}

/**
 * Guarda los ajustes. Con `apiKey` (una clave nueva) la cifra y la guarda; sin ella (`undefined`) conserva la que había,
 * pero solo si es del mismo proveedor y la misma dirección: si no, la saca (nunca queda guardada para otro destino).
 * Una cadena vacía la saca (un modelo local sin clave).
 */
export async function saveSettings(
  email: string,
  settings: { provider: ProviderId; baseUrl?: string; model: string; models: ModelInfo[] },
  apiKey?: string,
  options: SaveOptions = {},
): Promise<AssistantSettings> {
  const t = tabOnly.get(norm(email));
  if (t || options.tabOnly) return saveTabOnly(email, t, settings, apiKey, options);
  const d = await db();
  const prev = await d.get('keys', norm(email));
  // Las copias sincronizadas de las que vino la clave (o a las que se subió): se conservan, pero si cambian la clave o
  // el destino quedan marcadas como distintas de la de este dispositivo (la sección ofrece *Update synced key*).
  const sync = nextSync(prev, apiKey !== undefined || (!!prev && !sameDestination(prev, settings)), options);
  let iv = prev?.iv ?? null;
  let cipher = prev?.cipher ?? null;
  if (apiKey === undefined && prev && !sameDestination(prev, settings)) {
    iv = null;
    cipher = null;
  } else if (apiKey !== undefined) {
    if (apiKey === '') {
      iv = null;
      cipher = null;
    } else {
      const key = await deviceKey();
      iv = crypto.getRandomValues(new Uint8Array(12));
      cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, new TextEncoder().encode(apiKey));
    }
  }
  const record: AssistantRecord = {
    email: norm(email),
    provider: settings.provider,
    baseUrl: settings.provider === 'compatible' ? settings.baseUrl?.trim() : undefined,
    model: settings.model,
    models: settings.models,
    iv,
    cipher,
    savedAt: Date.now(),
    translateTo: prev?.translateTo,
    ...sync,
  };
  await d.put('keys', record);
  return settingsOf(record);
}

/** `saveSettings` con la clave solo en esta pestaña: las mismas reglas, sin tocar la base. */
function saveTabOnly(
  email: string,
  t: TabRecord | undefined,
  settings: { provider: ProviderId; baseUrl?: string; model: string; models: ModelInfo[] },
  apiKey: string | undefined,
  options: SaveOptions,
): AssistantSettings {
  const prev = t?.record;
  const keep = !!prev && sameDestination(prev, settings);
  const next: TabRecord = {
    record: {
      email: norm(email),
      provider: settings.provider,
      baseUrl: settings.provider === 'compatible' ? settings.baseUrl?.trim() : undefined,
      model: settings.model,
      models: settings.models,
      savedAt: Date.now(),
      translateTo: prev?.translateTo,
      ...nextSync(prev, apiKey !== undefined || (!!prev && !keep), options),
    },
    apiKey: apiKey !== undefined ? apiKey : keep ? t!.apiKey : '',
  };
  tabOnly.set(norm(email), next);
  return tabSettings(next);
}

/**
 * Anota de qué copia sincronizada es la clave de este dispositivo (o a cuál se subió), sin tocar la clave: pone o cambia
 * la del workspace de `sync.ref` y deja las de los otros. `null` saca todas.
 */
export async function setSyncInfo(email: string, sync: KeySyncInfo | null): Promise<AssistantSettings | null> {
  return changeSync(email, (entries) => (sync ? withEntry(entries, sync) : []));
}

/** Saca la anotación de la copia de un workspace (*Stop syncing* allá), sin tocar las otras ni la clave. */
export async function dropSyncInfo(email: string, ref: string, userId: string): Promise<AssistantSettings | null> {
  return changeSync(email, (entries) => entries.filter((e) => !(e.ref === ref && e.userId === userId)));
}

/** La clave o el destino de *Voice* cambiaron: las copias quedan marcadas para *Update synced key*. */
export async function markSyncStale(email: string): Promise<void> {
  await changeSync(email, (entries) => stale(entries).map((e) => ({ ...e, voiceFromCopy: false }))).catch(() => undefined);
}

/** Se olvidó la clave de *Voice* del dispositivo: ya no es la de ninguna copia (no marca nada para *Update*). */
export async function clearVoiceFromCopy(email: string): Promise<void> {
  await changeSync(email, (entries) => entries.map((e) => ({ ...e, voiceFromCopy: false }))).catch(() => undefined);
}

async function changeSync(email: string, fn: (entries: KeySyncInfo[]) => KeySyncInfo[]): Promise<AssistantSettings | null> {
  const t = tabOnly.get(norm(email));
  if (t) {
    const { sync: _a, moreSync: _b, ...rest } = t.record;
    t.record = { ...rest, ...fieldsOf(fn(syncEntries(t.record))) };
    return tabSettings(t);
  }
  const d = await db();
  const tx = d.transaction('keys', 'readwrite');
  const prev = await tx.store.get(norm(email));
  if (!prev) {
    await tx.done;
    return null;
  }
  const { sync: _old, moreSync: _more, ...rest } = prev;
  const next: AssistantRecord = { ...rest, ...fieldsOf(fn(syncEntries(prev))) };
  await tx.store.put(next);
  await tx.done;
  return settingsOf(next);
}

/** Recuerda el último idioma de *Translate to…*. */
export async function rememberLanguage(email: string, language: string): Promise<void> {
  const t = tabOnly.get(norm(email));
  if (t) {
    t.record = { ...t.record, translateTo: language };
    return;
  }
  const d = await db();
  const prev = await d.get('keys', norm(email));
  if (prev) await d.put('keys', { ...prev, translateTo: language });
}

/**
 * La clave en claro, justo antes de un pedido. `''` si no hay (un modelo local sin clave). No se guarda en ningún
 * lado: quien la pide la usa y la suelta. Solo si se guardó para `to` (el mismo proveedor y la misma dirección): si los
 * ajustes cambiaron en otra pestaña mientras este pedido usaba los de antes, la clave nueva no va a la dirección vieja.
 */
export async function readKey(email: string, to: KeyDestination): Promise<string> {
  const t = tabOnly.get(norm(email));
  if (t) return sameDestination(t.record, to) ? t.apiKey : '';
  const d = await db();
  const r = await d.get('keys', norm(email));
  if (!r?.cipher || !r.iv || !sameDestination(r, to)) return '';
  const key = await deviceKey();
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: r.iv as BufferSource }, key, r.cipher);
  return new TextDecoder().decode(plain);
}

/**
 * Con *Keep the key on this device* destildada, *Forget key* olvida SOLO la clave de esta pestaña: la que el dispositivo
 * tenía guardada de antes no se toca y vuelve a valer (regla 5). Devuelve si había una en la pestaña.
 */
export function forgetTabKey(email: string): boolean {
  return tabOnly.delete(norm(email));
}

/**
 * Saca la clave y los ajustes de la persona de este dispositivo y de esta pestaña. Lo usa la casilla de salir (la persona
 * pide olvidarla en este dispositivo); *Forget key* en modo pestaña usa `forgetTabKey`.
 */
export async function forgetKey(email: string): Promise<void> {
  tabOnly.delete(norm(email));
  const d = await db();
  await d.delete('keys', norm(email));
}
