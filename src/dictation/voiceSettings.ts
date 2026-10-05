import { clearVoiceFromCopy, loadSettings, markSyncStale, normalizeBaseUrl, readKey, type AssistantSettings } from '../assistant/keyStore';
import type { VoicePayload } from '../assistant/keySync';
import { isLocalUrl, type ProviderId } from '../assistant/providers';
import { dictationDb } from './dictationDb';

// Los ajustes de *Voice* (Docs/Doc_Dictado.md, 7; entrega V3): con qué proveedor se transcribe el micrófono propio.
//
// - Si el asistente usa un proveedor que transcribe (OpenAI, Gemini o uno compatible con `/audio/transcriptions`), la voz
//   usa ESE proveedor y ESA clave, sin pedir nada: se lee con la misma API del asistente (`loadSettings` y `readKey` de
//   keyStore.ts, que este archivo no toca).
// - Si el asistente usa Anthropic (que no recibe audio), o la persona prefiere otro, *Voice* guarda una segunda clave,
//   solo para transcribir. Se guarda igual que la del asistente: cifrada con AES-GCM y una llave del dispositivo creada
//   "no exportable", en la base del dictado (`shotdocs-dictation`, almacén `notes`, con los prefijos `v:` para los
//   ajustes de cada correo y `k:` para la llave; la versión de la base no sube).
// - La segunda clave viaja en la misma copia sincronizada que la del asistente (Doc_Clave_Sincronizada.md, S2): adentro
//   del sobre cifrado, como `voice`. Cambiarla acá marca las copias para *Update synced key*; abrir una copia que la
//   trae la guarda acá. Con *Keep the key on this device* destildada vive solo en esta pestaña, como la del asistente.
//
// La clave se descifra justo antes de cada pedido y no queda en ninguna variable global ni en el estado de React.

/** Los proveedores que transcriben (Anthropic no recibe audio). */
export type VoiceProviderId = Exclude<ProviderId, 'anthropic' | 'nvidia'>;
export const VOICE_PROVIDERS: VoiceProviderId[] = ['openai', 'gemini', 'compatible'];

/** El modelo de transcripción que se preelige por proveedor (barato y con pistas de vocabulario). */
export const DEFAULT_VOICE_MODEL: Record<VoiceProviderId, string> = {
  openai: 'gpt-4o-mini-transcribe',
  gemini: 'gemini-2.5-flash-lite',
  compatible: 'whisper-1',
};

/** Lo que se guarda de *Voice* para un correo (la clave propia, cifrada). */
interface VoiceRecord {
  /** `v:<correo>`. */
  id: string;
  kind: 'voice';
  /** `assistant`: la del asistente (si transcribe); `own`: la segunda clave. */
  source: 'assistant' | 'own';
  provider: VoiceProviderId;
  baseUrl?: string;
  model: string;
  iv: Uint8Array | null;
  cipher: ArrayBuffer | null;
  savedAt: number;
}

/** Lo que la app ve de *Voice* (sin la clave). */
export interface VoiceSettings {
  source: 'assistant' | 'own';
  provider: VoiceProviderId;
  baseUrl?: string;
  model: string;
  /** Con `own`: si hay una clave guardada. */
  hasKey: boolean;
}

/** Con qué se transcribe, ya resuelto: el destino y de dónde sale la clave. */
export interface VoiceConfig {
  provider: VoiceProviderId;
  baseUrl?: string;
  model: string;
  source: 'assistant' | 'own';
}

const norm = (email: string) => email.trim().toLowerCase();

/** Lo que se ve de *Voice* sin la clave, venga de la base o de esta pestaña. */
type VoiceInfo = Omit<VoiceRecord, 'iv' | 'cipher'> & { hasKey: boolean };

// *Keep the key on this device* destildada (como en keyStore.ts): la segunda clave, solo en esta pestaña, en una variable
// de este módulo. Mientras está, manda sobre lo guardado y la base no se toca.
const tabVoice = new Map<string, { record: Omit<VoiceRecord, 'iv' | 'cipher'>; apiKey: string }>();

/** Para las pruebas: como recargar la pestaña. */
export function resetTabOnlyVoice(): void {
  tabVoice.clear();
}

const sameVoiceDestination = (a: Pick<VoiceRecord, 'provider' | 'baseUrl'>, b: Pick<VoiceRecord, 'provider' | 'baseUrl'>) =>
  a.provider === b.provider && (a.provider !== 'compatible' || normalizeBaseUrl(a.baseUrl) === normalizeBaseUrl(b.baseUrl));
const recordId = (email: string) => `v:${norm(email)}`;
const KEY_ID = 'k:aes';

/** Si el proveedor del asistente sirve para transcribir. */
export function assistantTranscribes(s: Pick<AssistantSettings, 'provider'> | null | undefined): s is Pick<AssistantSettings, 'provider'> & { provider: VoiceProviderId } {
  return !!s && (VOICE_PROVIDERS as readonly string[]).includes(s.provider);
}

async function deviceKey(): Promise<CryptoKey> {
  const d = await dictationDb();
  const found = (await d.get('notes', KEY_ID)) as unknown as { key?: CryptoKey } | undefined;
  if (found?.key) return found.key;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  // Dos pestañas a la vez: queda la primera que se guardó.
  const tx = d.transaction('notes', 'readwrite');
  const again = (await tx.store.get(KEY_ID)) as unknown as { key?: CryptoKey } | undefined;
  if (again?.key) {
    await tx.done;
    return again.key;
  }
  await tx.store.put({ id: KEY_ID, kind: 'key', key } as never);
  await tx.done;
  return key;
}

async function loadRecord(email: string): Promise<VoiceRecord | null> {
  const r = (await (await dictationDb()).get('notes', recordId(email))) as unknown as VoiceRecord | undefined;
  return r?.kind === 'voice' ? r : null;
}

/** Lo de *Voice* de esa persona (de esta pestaña si vive solo en ella), sin la clave. */
async function loadInfo(email: string): Promise<VoiceInfo | null> {
  const t = tabVoice.get(norm(email));
  if (t) return { ...t.record, hasKey: !!t.apiKey };
  const r = await loadRecord(email);
  if (!r) return null;
  const { iv: _iv, cipher, ...rest } = r;
  return { ...rest, hasKey: !!cipher };
}

export async function loadVoiceSettings(email: string): Promise<VoiceSettings | null> {
  const r = await loadInfo(email);
  if (!r) return null;
  return { source: r.source, provider: r.provider, baseUrl: r.baseUrl, model: r.model, hasKey: r.hasKey };
}

/**
 * Guarda *Voice*. Con `source: 'own'` y `apiKey` (una clave nueva), la cifra; sin `apiKey`, conserva la que había solo si
 * es del mismo proveedor y la misma dirección (nunca queda guardada para otro destino). `''` la saca.
 */
export async function saveVoiceSettings(
  email: string,
  settings: { source: 'assistant' | 'own'; provider: VoiceProviderId; baseUrl?: string; model: string },
  apiKey?: string,
  options: { fromSync?: boolean; tabOnly?: boolean } = {},
): Promise<VoiceSettings> {
  const before = await loadInfo(email);
  // La segunda clave viaja en la copia sincronizada: si cambian ella, su destino o si se usa, las copias quedan marcadas
  // para *Update synced key* (salvo cuando viene justamente de abrir una copia). Cambiar solo el modelo no marca nada.
  const ownBefore = before?.source === 'own';
  const ownAfter = settings.source === 'own';
  const voiceChanged = ownBefore !== ownAfter || (ownAfter && (apiKey !== undefined || !before || !sameVoiceDestination(before, settings)));
  const out = tabVoice.has(norm(email)) || options.tabOnly ? saveTabVoice(email, settings, apiKey) : await saveVoiceRecord(email, settings, apiKey);
  if (voiceChanged && !options.fromSync) await markSyncStale(email);
  return out;
}

function saveTabVoice(email: string, settings: { source: 'assistant' | 'own'; provider: VoiceProviderId; baseUrl?: string; model: string }, apiKey?: string): VoiceSettings {
  const prev = tabVoice.get(norm(email));
  const keep = !!prev && sameVoiceDestination(prev.record, settings);
  const record: Omit<VoiceRecord, 'iv' | 'cipher'> = {
    id: recordId(email),
    kind: 'voice',
    source: settings.source,
    provider: settings.provider,
    baseUrl: settings.provider === 'compatible' ? settings.baseUrl?.trim() : undefined,
    model: settings.model.trim() || DEFAULT_VOICE_MODEL[settings.provider],
    savedAt: Date.now(),
  };
  const key = apiKey !== undefined ? apiKey : keep ? prev!.apiKey : '';
  tabVoice.set(norm(email), { record, apiKey: key });
  return { source: record.source, provider: record.provider, baseUrl: record.baseUrl, model: record.model, hasKey: !!key };
}

async function saveVoiceRecord(
  email: string,
  settings: { source: 'assistant' | 'own'; provider: VoiceProviderId; baseUrl?: string; model: string },
  apiKey?: string,
): Promise<VoiceSettings> {
  const d = await dictationDb();
  const prev = await loadRecord(email);
  let iv = prev?.iv ?? null;
  let cipher = prev?.cipher ?? null;
  const same = !!prev && sameVoiceDestination(prev, settings);
  if (apiKey === undefined && !same) {
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
  const record: VoiceRecord = {
    id: recordId(email),
    kind: 'voice',
    source: settings.source,
    provider: settings.provider,
    baseUrl: settings.provider === 'compatible' ? settings.baseUrl?.trim() : undefined,
    model: settings.model.trim() || DEFAULT_VOICE_MODEL[settings.provider],
    iv,
    cipher,
    savedAt: Date.now(),
  };
  await d.put('notes', record as never);
  return { source: record.source, provider: record.provider, baseUrl: record.baseUrl, model: record.model, hasKey: !!cipher };
}

/** *Forget voice key*: saca la segunda clave y los ajustes de *Voice* de este dispositivo. */
export async function forgetVoiceKey(email: string): Promise<void> {
  tabVoice.delete(norm(email));
  await (await dictationDb()).delete('notes', recordId(email));
  await clearVoiceFromCopy(email);
}

/** La segunda clave para meter en la copia sincronizada, o `undefined` si no hay (o *Voice* usa la del asistente). */
export async function voicePayloadOf(email: string): Promise<VoicePayload | undefined> {
  const v = await loadInfo(email);
  if (!v || v.source !== 'own') return undefined;
  if (!v.hasKey && !(v.provider === 'compatible' && v.baseUrl)) return undefined;
  const apiKey = v.hasKey ? await readVoiceKey(email, { provider: v.provider, baseUrl: v.baseUrl, model: v.model, source: 'own' }) : '';
  return { provider: v.provider, ...(v.provider === 'compatible' ? { baseUrl: v.baseUrl } : {}), model: v.model, apiKey };
}

/** Guarda la segunda clave que vino en una copia sincronizada (después de que la persona la aceptó). */
export async function adoptVoicePayload(email: string, voice: VoicePayload, tabOnly = false): Promise<void> {
  const prev = await loadInfo(email);
  const model = prev?.source === 'own' && sameVoiceDestination(prev, voice) && prev.model ? prev.model : voice.model;
  await saveVoiceSettings(email, { source: 'own', provider: voice.provider, baseUrl: voice.baseUrl, model }, voice.apiKey, { fromSync: true, tabOnly });
}

/**
 * Con qué se transcribe para esa persona, o `null` si no hay cómo (el asistente usa Anthropic y no hay segunda clave, o
 * no hay asistente configurado). Sin ajustes de *Voice*, la del asistente si transcribe.
 */
export async function resolveVoice(email: string): Promise<VoiceConfig | null> {
  const [voice, assistant] = await Promise.all([loadInfo(email), loadSettings(email)]);
  if (voice?.source === 'own') {
    // Un compatible local puede no tener clave.
    if (!voice.hasKey && !(voice.provider === 'compatible' && voice.baseUrl)) return null;
    return { provider: voice.provider, baseUrl: voice.baseUrl, model: voice.model, source: 'own' };
  }
  if (!assistantTranscribes(assistant)) return null;
  if (!assistant.hasKey && assistant.provider !== 'compatible') return null;
  const model = voice?.source === 'assistant' && voice.provider === assistant.provider ? voice.model : DEFAULT_VOICE_MODEL[assistant.provider];
  return { provider: assistant.provider, baseUrl: assistant.baseUrl, model, source: 'assistant' };
}

/**
 * La clave en claro para transcribir con `config`, justo antes del pedido. La del asistente se lee con su propia API
 * (`readKey`, que solo la da si es para el mismo proveedor y la misma dirección); la segunda, de acá, con la misma regla.
 */
export async function readVoiceKey(email: string, config: VoiceConfig): Promise<string> {
  if (config.source === 'assistant') return readKey(email, { provider: config.provider, baseUrl: config.baseUrl });
  const t = tabVoice.get(norm(email));
  if (t) return t.record.source === 'own' && sameVoiceDestination(t.record, config) ? t.apiKey : '';
  const r = await loadRecord(email);
  if (!r?.cipher || !r.iv || r.provider !== config.provider) return '';
  if (config.provider === 'compatible' && normalizeBaseUrl(r.baseUrl) !== normalizeBaseUrl(config.baseUrl)) return '';
  const key = await deviceKey();
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: r.iv as BufferSource }, key, r.cipher);
  return new TextDecoder().decode(plain);
}

/** Si transcribir con `config` no saca el audio de la máquina o la red local (para *Local models only*). */
export const isLocalVoice = (config: Pick<VoiceConfig, 'provider' | 'baseUrl'>) => config.provider === 'compatible' && isLocalUrl(config.baseUrl);
