import { ProviderError, redact } from '../assistant/providers';
import type { PageMap } from './pageMap';
import type { VoiceConfig } from './voiceSettings';

// Pasar la grabación a texto con el proveedor de la persona (Docs/Doc_Dictado.md, 4.3, 5.8 y 11 bis C4; entrega V3).
// Un adaptador propio con `fetch`, sin SDK: OpenAI y los compatibles (`/audio/transcriptions`, multipart) y Gemini (el
// audio adentro del pedido, en base64). El pedido va directo del navegador al proveedor; nada pasa por el portero ni por
// Supabase. La clave nunca se escribe en un error, un log ni la consola (`redact`).
//
// C4, formatos: el archivo va siempre con su extensión (`note.webm`, `note.mp4`); a Gemini, el mp4 como `audio/m4a`
// (Gemini no lista `audio/mp4`). Si el proveedor rechaza el formato, el plan B lo decodifica en el dispositivo y lo
// reenvía como WAV PCM mono de 16 kHz (~1,9 MB por minuto: con el tope de 2 minutos entra en los 20 MB de Gemini y los
// 25 MB de OpenAI).

type Fetch = typeof fetch;

const OPENAI = 'https://api.openai.com/v1';
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

/** Lo que se manda: el audio y su tipo (`audio/webm;codecs=opus`, `audio/mp4`…). */
export interface AudioInput {
  data: Blob;
  mime: string;
}

export interface Transcript {
  text: string;
  /** Pasó por el plan B (WAV). */
  wav: boolean;
}

/** El tipo sin parámetros: `audio/webm;codecs=opus` → `audio/webm`. */
export const baseMime = (mime: string) => mime.split(';')[0].trim().toLowerCase() || 'audio/webm';

/** La extensión del archivo para el proveedor (OpenAI decide el formato por ella). */
export function extensionOf(mime: string): string {
  const m = baseMime(mime);
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'mp4';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('wav')) return 'wav';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  return 'webm';
}

/** El tipo para Gemini: el mp4 de Safari como `audio/m4a` (C4). */
export function geminiMime(mime: string): string {
  const ext = extensionOf(mime);
  if (ext === 'mp4') return 'audio/m4a';
  if (ext === 'mp3') return 'audio/mp3';
  return `audio/${ext}`;
}

// --- Pistas ----------------------------------------------------------------------------------------------------------

/** La jerga de set que se dice mezclada (no se traduce). */
const JARGON = [
  'T-stop', 'ND', 'HDRI', 'clean plate', 'chrome ball', 'grey ball', 'color chart', 'witness cam', 'LiDAR', 'tracking markers',
  'slate', 'setup', 'take', 'lens grid', 'dolly', 'grúa', 'steadicam', 'gimbal', 'fps', 'shutter', 'T2.8', 'mm',
];

/**
 * Las pistas de vocabulario (5.8): la jerga fija y las palabras de la página abierta (los rótulos de las filas y las
 * columnas, las *Slate*, los planos, los títulos), cortas y sin repetir, con un tope de largo. Sin el texto de las
 * celdas: solo los rótulos.
 */
export function voiceHints(map: Pick<PageMap, 'targets' | 'shots'> | null, max = 700): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let size = 0;
  const add = (raw: string | undefined) => {
    const t = (raw ?? '').replace(/⟦[^⟧]*⟧/g, '').replace(/[:\s]+$/, '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 40) return;
    const k = t.toLowerCase();
    if (seen.has(k) || size + t.length + 2 > max) return;
    seen.add(k);
    size += t.length + 2;
    out.push(t);
  };
  JARGON.forEach(add);
  if (map) {
    for (const s of map.shots) add(s.name);
    for (const t of map.targets.values()) {
      add(t.rowLabel);
      add(t.colLabel);
      add(t.label);
      add(t.sub);
      add(t.section);
    }
  }
  return out;
}

/** Las instrucciones para transcribir (Gemini) o el `prompt` (OpenAI): idiomas y vocabulario. */
export function hintPrompt(hints: string[]): string {
  return `Spanish and English, often mixed in one sentence. Vocabulary: ${hints.join(', ')}.`;
}

// --- Errores ---------------------------------------------------------------------------------------------------------

/** El proveedor rechazó el audio por su formato (C4): el plan B lo reenvía como WAV. */
export function isFormatError(err: unknown): boolean {
  return err instanceof ProviderError && err.kind === 'badRequest' && /format|unsupported|invalid file|could not (be )?decode|corrupt|mime|audio file/i.test(err.message);
}

async function errorFrom(res: Response, key: string): Promise<ProviderError> {
  let body = '';
  try {
    body = await res.text();
  } catch {
    body = '';
  }
  let message = body;
  try {
    const json = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    message = typeof json.error === 'string' ? json.error : (json.error?.message ?? json.message ?? body);
  } catch {
    // No era JSON: queda el texto.
  }
  const clean = redact(message || res.statusText || `HTTP ${res.status}`, key);
  if (res.status === 401) return new ProviderError('auth', clean, 401);
  if (res.status === 403) return new ProviderError('forbidden', clean, 403);
  if (res.status === 413) return new ProviderError('badRequest', `Audio file too large. ${clean}`, 413);
  if (res.status === 429) {
    const after = Number(res.headers.get('retry-after'));
    return new ProviderError('rateLimit', clean, 429, Number.isFinite(after) && after > 0 ? Math.ceil(after) : null);
  }
  if (res.status === 404) return new ProviderError('model', clean, 404);
  if (res.status >= 500) return new ProviderError('server', clean, res.status);
  return new ProviderError('badRequest', clean, res.status);
}

async function send(fetcher: Fetch, url: string, init: RequestInit, key: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetcher(url, init);
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') throw new ProviderError('aborted', 'Stopped');
    throw new ProviderError('network', redact(String((err as Error)?.message ?? err), key));
  }
  if (!res.ok) throw await errorFrom(res, key);
  return res;
}

function base64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// --- Los adaptadores -------------------------------------------------------------------------------------------------

async function viaOpenAi(config: VoiceConfig, key: string, audio: AudioInput, hints: string[], fetcher: Fetch, signal?: AbortSignal): Promise<string> {
  const base = config.provider === 'compatible' ? (config.baseUrl ?? '').trim().replace(/\/+$/, '') : OPENAI;
  if (!base) throw new ProviderError('badRequest', 'Missing base URL');
  const form = new FormData();
  form.append('file', new File([audio.data], `note.${extensionOf(audio.mime)}`, { type: baseMime(audio.mime) }));
  form.append('model', config.model);
  form.append('response_format', 'json');
  if (hints.length) form.append('prompt', hintPrompt(hints));
  // Sin `content-type`: lo pone el navegador con el separador del multipart.
  const res = await send(fetcher, `${base}/audio/transcriptions`, { method: 'POST', headers: key ? { authorization: `Bearer ${key}` } : {}, body: form, signal }, key);
  const json = (await res.json().catch(() => ({}))) as { text?: string };
  return typeof json.text === 'string' ? json.text : '';
}

async function viaGemini(config: VoiceConfig, key: string, audio: AudioInput, hints: string[], fetcher: Fetch, signal?: AbortSignal): Promise<string> {
  const data = base64(await audio.data.arrayBuffer());
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `Transcribe this audio exactly as spoken, in the language spoken (${hintPrompt(hints)}). Write numbers as digits. Return only the transcription, nothing else. If there is no speech, return an empty answer.`,
          },
          { inline_data: { mime_type: geminiMime(audio.mime), data } },
        ],
      },
    ],
    generationConfig: { temperature: 0 },
  };
  const res = await send(
    fetcher,
    `${GEMINI}/models/${encodeURIComponent(config.model)}:generateContent`,
    { method: 'POST', headers: { 'x-goog-api-key': key, 'content-type': 'application/json' }, body: JSON.stringify(body), signal },
    key,
  );
  const json = (await res.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
}

export interface TranscribeOptions {
  signal?: AbortSignal;
  fetcher?: Fetch;
  /** El plan B (WAV); en las pruebas, uno simulado. */
  toWav?: (data: Blob) => Promise<Blob>;
}

/**
 * Transcribe una nota. Si el proveedor rechaza el formato, una vez más como WAV (C4). Los errores son `ProviderError`
 * (sin la clave). Una nota sin voz devuelve `''`.
 */
export async function transcribe(config: VoiceConfig, key: string, audio: AudioInput, hints: string[], opts: TranscribeOptions = {}): Promise<Transcript> {
  const fetcher = opts.fetcher ?? fetch;
  const run = (a: AudioInput) => (config.provider === 'gemini' ? viaGemini(config, key, a, hints, fetcher, opts.signal) : viaOpenAi(config, key, a, hints, fetcher, opts.signal));
  try {
    return { text: (await run(audio)).trim(), wav: false };
  } catch (err) {
    if (!isFormatError(err) || extensionOf(audio.mime) === 'wav') throw err;
    let wav: Blob;
    try {
      wav = await (opts.toWav ?? toWav)(audio.data);
    } catch {
      // No se pudo decodificar en el dispositivo: queda el error del proveedor.
      throw err;
    }
    return { text: (await run({ data: wav, mime: 'audio/wav' })).trim(), wav: true };
  }
}

// --- El plan B: WAV PCM mono de 16 kHz -------------------------------------------------------------------------------

/** Escribe muestras mono (−1 a 1) como WAV PCM de 16 bits. */
export function encodeWav(samples: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/** Decodifica la grabación en el dispositivo y la pasa a WAV mono de 16 kHz. */
export async function toWav(data: Blob): Promise<Blob> {
  const Ctx = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx || typeof OfflineAudioContext === 'undefined') throw new Error('Sin AudioContext');
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(await data.arrayBuffer());
    const rate = 16000;
    const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    const out = await off.startRendering();
    return encodeWav(out.getChannelData(0), rate);
  } finally {
    void ctx.close().catch(() => undefined);
  }
}
