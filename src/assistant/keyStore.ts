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
 * Guarda los ajustes. Con `apiKey` (una clave nueva) la cifra y la guarda; sin ella (`undefined`) conserva la que había.
 * Una cadena vacía la saca (un modelo local sin clave).
 */
export async function saveSettings(
  email: string,
  settings: { provider: ProviderId; baseUrl?: string; model: string; models: ModelInfo[] },
  apiKey?: string,
): Promise<AssistantSettings> {
  const d = await db();
  const prev = await d.get('keys', norm(email));
  let iv = prev?.iv ?? null;
  let cipher = prev?.cipher ?? null;
  if (apiKey !== undefined) {
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
  };
  await d.put('keys', record);
  return settingsOf(record);
}

/** Recuerda el último idioma de *Translate to…*. */
export async function rememberLanguage(email: string, language: string): Promise<void> {
  const d = await db();
  const prev = await d.get('keys', norm(email));
  if (prev) await d.put('keys', { ...prev, translateTo: language });
}

/**
 * La clave en claro, justo antes de un pedido. `''` si no hay (un modelo local sin clave). No se guarda en ningún
 * lado: quien la pide la usa y la suelta.
 */
export async function readKey(email: string): Promise<string> {
  const d = await db();
  const r = await d.get('keys', norm(email));
  if (!r?.cipher || !r.iv) return '';
  const key = await deviceKey();
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: r.iv as BufferSource }, key, r.cipher);
  return new TextDecoder().decode(plain);
}

/** *Forget key*: saca la clave y los ajustes de la persona de este dispositivo. */
export async function forgetKey(email: string): Promise<void> {
  const d = await db();
  await d.delete('keys', norm(email));
}
