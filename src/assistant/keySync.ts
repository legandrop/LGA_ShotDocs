import { PROVIDERS, type ProviderId } from './providers';
import { EFF_SHORT_WORDS } from './wordlist';

// La clave del asistente sincronizada (Docs/Doc_Clave_Sincronizada.md, secciones 4 y 6; D72 → B): el sobre. Todo pasa
// en el dispositivo, con WebCrypto. De la frase sale una llave con PBKDF2-SHA256 de 1 000 000 de vueltas y una sal al
// azar; con ella, AES-256-GCM cifra proveedor, dirección, modelo y clave, rellenos a 1 024 bytes. La cabecera (versión,
// derivación, vueltas, sal, id de la persona) va como datos adicionales (AAD): si alguien toca la fila, no abre.
//
// Reglas que este archivo sostiene:
// - Los parámetros los fija la app por versión (`FORMAT`), nunca la fila: una fila con `iter` o `kdf` agregados no
//   cambia nada, y una versión desconocida no se abre (regla 3).
// - La frase y la clave nunca salen de acá en claro, ni a un log ni a un error (regla 1). La llave derivada es no
//   exportable, se usa y se suelta.
// - La frase se normaliza con UNA sola función, la misma al cifrar y al abrir (R1).

/** La única versión del formato que conoce esta app: PBKDF2-SHA256, 1 000 000 de vueltas, AES-256-GCM. */
export const FORMAT = 1;
export const KDF = 'pbkdf2-sha256';
export const ITERATIONS = 1_000_000;
/** Lo cifrado se rellena a este largo, en bytes UTF-8 (el largo no delata el proveedor). */
export const PADDED_BYTES = 1024;
/** Largos fijos en base64: 16 bytes de sal, 12 de iv, 1 024 + 16 (la etiqueta de GCM) de cifrado. */
export const SALT_B64 = 24;
export const IV_B64 = 16;
export const CIPHER_B64 = 1388;

/** Lo que viaja cifrado. La lista de modelos no: se vuelve a pedir al proveedor. */
export interface KeyPayload {
  provider: ProviderId;
  baseUrl?: string;
  model: string;
  apiKey: string;
  /** Cuándo se armó este sobre (autenticado: está adentro). Un dispositivo que ya abrió uno rechaza uno más viejo (S2). */
  savedAt: number;
  /**
   * La segunda clave, solo para transcribir (ventana *Voice*, Doc_Dictado.md 7), si la persona tiene una. Opcional: una
   * versión de la app que no la conoce la ignora al abrir (y al actualizar la copia la deja afuera, sin perder nada en
   * los dispositivos).
   */
  voice?: VoicePayload;
}

/** La clave de *Voice* adentro del sobre: a dónde va y la clave. Anthropic no transcribe. */
export interface VoicePayload {
  provider: Exclude<ProviderId, 'anthropic'>;
  baseUrl?: string;
  model: string;
  apiKey: string;
}

/** Lo que se guarda en la fila (las columnas que escribe la app). */
export interface SealedKey {
  format: number;
  salt: string;
  iv: string;
  ciphertext: string;
}

export type KeySyncProblem =
  /** La frase no abre la copia, o la fila fue tocada (no se pueden distinguir, y está bien: no da pistas). */
  | 'wrong'
  /** La copia la guardó una versión más nueva de la app (otro formato). */
  | 'newer'
  /** La clave o la dirección no entran en 1 024 bytes. */
  | 'tooLong'
  /** La copia es más vieja que la que este dispositivo ya abrió o subió (`savedAt` de adentro del sobre). */
  | 'older';

/** Un error del sobre. El mensaje nunca lleva la frase ni la clave. */
export class KeySyncError extends Error {
  constructor(readonly problem: KeySyncProblem) {
    super(`keySync:${problem}`);
    this.name = 'KeySyncError';
  }
}

// --- La frase ------------------------------------------------------------------------------------------------------

/** Seis palabras de letras separadas por guiones o espacios: la forma de la frase generada. */
const GENERATED_SHAPE = /^[\p{L}]+(?:[\s-]+[\p{L}]+){5}$/u;

/**
 * La frase como se usa para derivar la llave (R1: una sola función, la misma al cifrar y al abrir). NFKC (una tilde
 * escrita de dos maneras da lo mismo) y sin espacios en las puntas. Si tiene la forma de la generada (seis palabras),
 * en minúsculas y con un guion entre palabras: el teclado del iPhone pone mayúscula a la primera letra, y quien la
 * copia a mano puede separar con espacios. Una frase propia con otra forma se usa tal cual.
 */
export function normalizePassphrase(passphrase: string): string {
  const p = passphrase.normalize('NFKC').trim();
  if (!GENERATED_SHAPE.test(p)) return p;
  return p
    .split(/[\s-]+/u)
    .map((w) => w.toLowerCase())
    .join('-');
}

/** Un número parejo en [0, n) con `getRandomValues`, sin sesgo: se descarta lo que no entra parejo. */
export function uniformIndex(n: number, random: (a: Uint32Array<ArrayBuffer>) => unknown = (a) => crypto.getRandomValues(a)): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    random(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

/** La frase que propone la app: seis palabras al azar de la lista corta de la EFF, en minúsculas y con guiones. */
export function generatePassphrase(random?: (a: Uint32Array<ArrayBuffer>) => unknown): string {
  const words: string[] = [];
  for (let i = 0; i < 6; i++) words.push(EFF_SHORT_WORDS[uniformIndex(EFF_SHORT_WORDS.length, random)]);
  return words.join('-');
}

/** Una frase propia: 20 caracteres o más y al menos cuatro palabras (Doc_Clave_Sincronizada.md, 4.4). */
export function ownPassphraseOk(passphrase: string): boolean {
  const p = normalizePassphrase(passphrase);
  return [...p].length >= 20 && p.split(/[\s-]+/u).filter(Boolean).length >= 4;
}

// --- El cifrado ----------------------------------------------------------------------------------------------------

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** La cabecera atada al cifrado: la arma la app con SUS constantes y los datos de la fila (nunca parámetros de la fila). */
export function headerFor(salt: string, userId: string): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ v: FORMAT, kdf: KDF, iter: ITERATIONS, salt, uid: userId }));
}

/** La llave que sale de la frase: PBKDF2-SHA256, `ITERATIONS` vueltas, AES-GCM de 256 bits, no exportable. */
async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(normalizePassphrase(passphrase)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ITERATIONS },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** El JSON de lo cifrado, relleno con espacios hasta 1 024 bytes; `null` si no entra. */
export function padPayload(payload: KeyPayload): Uint8Array | null {
  const json = JSON.stringify({
    provider: payload.provider,
    ...(payload.provider === 'compatible' && payload.baseUrl ? { baseUrl: payload.baseUrl } : {}),
    model: payload.model,
    apiKey: payload.apiKey,
    savedAt: payload.savedAt,
    ...(payload.voice
      ? {
          voice: {
            provider: payload.voice.provider,
            ...(payload.voice.provider === 'compatible' && payload.voice.baseUrl ? { baseUrl: payload.voice.baseUrl } : {}),
            model: payload.voice.model,
            apiKey: payload.voice.apiKey,
          },
        }
      : {}),
  });
  const bytes = new TextEncoder().encode(json);
  if (bytes.length > PADDED_BYTES) return null;
  const out = new Uint8Array(PADDED_BYTES).fill(0x20);
  out.set(bytes);
  return out;
}

/** Si los ajustes caben en el sobre (para avisar antes de pedir la frase). */
export function fitsInEnvelope(payload: KeyPayload): boolean {
  return padPayload(payload) !== null;
}

/** Cifra la clave con la frase, para la persona `userId` del Supabase del workspace. Sal y iv nuevos cada vez. */
export async function sealKey(payload: KeyPayload, passphrase: string, userId: string): Promise<SealedKey> {
  const plain = padPayload(payload);
  if (!plain) throw new KeySyncError('tooLong');
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const ivBytes = crypto.getRandomValues(new Uint8Array(12));
  const salt = toB64(saltBytes);
  const key = await deriveKey(passphrase, saltBytes);
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ivBytes as BufferSource, additionalData: headerFor(salt, userId) as BufferSource },
    key,
    plain as BufferSource,
  );
  plain.fill(0);
  return { format: FORMAT, salt, iv: toB64(ivBytes), ciphertext: toB64(new Uint8Array(cipher)) };
}

function validVoice(v: unknown): v is VoicePayload {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.provider === 'string' &&
    p.provider !== 'anthropic' &&
    (PROVIDERS as readonly string[]).includes(p.provider) &&
    (p.baseUrl === undefined || typeof p.baseUrl === 'string') &&
    typeof p.model === 'string' &&
    typeof p.apiKey === 'string'
  );
}

function validPayload(v: unknown): v is KeyPayload {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.provider === 'string' &&
    (PROVIDERS as readonly string[]).includes(p.provider) &&
    (p.baseUrl === undefined || typeof p.baseUrl === 'string') &&
    typeof p.model === 'string' &&
    typeof p.apiKey === 'string' &&
    typeof p.savedAt === 'number' &&
    Number.isFinite(p.savedAt) &&
    (p.voice === undefined || validVoice(p.voice))
  );
}

/**
 * Abre la copia con la frase. Solo mira de la fila la versión, la sal, el iv y el cifrado: cualquier otro campo (un
 * `iter`, un `kdf`, un `baseUrl` en claro) se ignora. Frase equivocada y fila tocada dan `wrong`; una versión que esta
 * app no conoce, `newer`.
 */
export async function openKey(row: { format: unknown; salt: unknown; iv: unknown; ciphertext: unknown }, passphrase: string, userId: string): Promise<KeyPayload> {
  if (row.format !== FORMAT) {
    throw new KeySyncError(typeof row.format === 'number' && row.format > FORMAT ? 'newer' : 'wrong');
  }
  const { salt, iv, ciphertext } = row;
  if (typeof salt !== 'string' || typeof iv !== 'string' || typeof ciphertext !== 'string') throw new KeySyncError('wrong');
  if (salt.length !== SALT_B64 || iv.length !== IV_B64 || ciphertext.length !== CIPHER_B64) throw new KeySyncError('wrong');
  let plain: Uint8Array;
  try {
    const key = await deriveKey(passphrase, fromB64(salt));
    plain = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromB64(iv) as BufferSource, additionalData: headerFor(salt, userId) as BufferSource },
        key,
        fromB64(ciphertext) as BufferSource,
      ),
    );
  } catch {
    throw new KeySyncError('wrong');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plain).trimEnd());
  } catch {
    parsed = null;
  } finally {
    plain.fill(0);
  }
  if (!validPayload(parsed)) throw new KeySyncError('wrong');
  return {
    provider: parsed.provider,
    baseUrl: parsed.provider === 'compatible' ? parsed.baseUrl : undefined,
    model: parsed.model,
    apiKey: parsed.apiKey,
    savedAt: parsed.savedAt,
    ...(parsed.voice
      ? {
          voice: {
            provider: parsed.voice.provider,
            baseUrl: parsed.voice.provider === 'compatible' ? parsed.voice.baseUrl : undefined,
            model: parsed.voice.model,
            apiKey: parsed.voice.apiKey,
          },
        }
      : {}),
  };
}

/**
 * El `savedAt` de un sobre nuevo: la hora del dispositivo, pero siempre después de los que ya se conocen (la copia que
 * se abrió, la que anotó este dispositivo). Así un reloj atrasado no hace que los otros dispositivos rechacen la copia
 * nueva como "más vieja".
 */
export function nextSavedAt(now: number, ...known: (number | undefined)[]): number {
  let at = now;
  for (const k of known) if (typeof k === 'number' && Number.isFinite(k) && k >= at) at = k + 1;
  return at;
}

/** Los últimos cuatro caracteres de la clave, para mostrar a dónde va sin mostrarla. */
export function keyEnding(apiKey: string): string {
  return [...apiKey].slice(-4).join('');
}
