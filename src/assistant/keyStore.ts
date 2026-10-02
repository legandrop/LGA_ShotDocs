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
}

/** Lo que ve la app de los ajustes: todo menos la clave. */
export type AssistantSettings = Omit<AssistantRecord, 'iv' | 'cipher'> & { hasKey: boolean };

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
  const r = await (await db()).get('keys', norm(email));
  return r ? settingsOf(r) : null;
}

/** Si la persona tiene una clave guardada en este dispositivo (para la casilla de salir). */
export async function hasAssistantKey(email: string): Promise<boolean> {
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
  options: { sync?: KeySyncInfo | null } = {},
): Promise<AssistantSettings> {
  const d = await db();
  const prev = await d.get('keys', norm(email));
  // La copia sincronizada de la que vino la clave: se conserva, pero si cambian la clave o el destino queda marcada
  // como distinta de la de este dispositivo (la sección de sincronizar ofrece *Update synced key*).
  let sync = options.sync === undefined ? prev?.sync : (options.sync ?? undefined);
  if (options.sync === undefined && sync && (apiKey !== undefined || !sameDestination(prev!, settings))) sync = { ...sync, localChanged: true };
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
    ...(sync ? { sync } : {}),
  };
  await d.put('keys', record);
  return settingsOf(record);
}

/** Anota (o saca, con `null`) de qué copia sincronizada es la clave de este dispositivo, sin tocar la clave. */
export async function setSyncInfo(email: string, sync: KeySyncInfo | null): Promise<AssistantSettings | null> {
  const d = await db();
  const tx = d.transaction('keys', 'readwrite');
  const prev = await tx.store.get(norm(email));
  if (!prev) {
    await tx.done;
    return null;
  }
  const { sync: _old, ...rest } = prev;
  const next: AssistantRecord = sync ? { ...rest, sync } : rest;
  await tx.store.put(next);
  await tx.done;
  return settingsOf(next);
}

/** Recuerda el último idioma de *Translate to…*. */
export async function rememberLanguage(email: string, language: string): Promise<void> {
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
  const d = await db();
  const r = await d.get('keys', norm(email));
  if (!r?.cipher || !r.iv || !sameDestination(r, to)) return '';
  const key = await deviceKey();
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: r.iv as BufferSource }, key, r.cipher);
  return new TextDecoder().decode(plain);
}

/** *Forget key*: saca la clave y los ajustes de la persona de este dispositivo. */
export async function forgetKey(email: string): Promise<void> {
  const d = await db();
  await d.delete('keys', norm(email));
}
