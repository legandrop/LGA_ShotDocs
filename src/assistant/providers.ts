// Los cuatro proveedores del asistente (Docs/Doc_Asistente.md, secciones 3 y 5): Anthropic, OpenAI, Google (Gemini) y
// "compatible con OpenAI" (OpenRouter, Ollama, LM Studio). Un adaptador propio con `fetch` por proveedor, sin sus SDK:
// pedir, recibir por partes, cancelar, leer el uso de tokens y los errores. El pedido va directo del navegador al
// proveedor, con la clave de la persona; nada pasa por el portero ni por Supabase.
//
// La clave nunca se escribe en un error, un log ni la consola: los mensajes del proveedor se pasan por `redact`, que la
// saca (OpenAI, por ejemplo, repite parte de la clave en el 401).

export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'compatible';

export const PROVIDERS: ProviderId[] = ['anthropic', 'openai', 'gemini', 'compatible'];

export const PROVIDER_NAMES: Record<ProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  compatible: 'OpenAI-compatible',
};

/** Dónde se fija el tope de gasto de cada proveedor (la ventana de ajustes lo recomienda). */
export const SPEND_LIMIT_URLS: Partial<Record<ProviderId, string>> = {
  anthropic: 'https://console.anthropic.com/settings/limits',
  openai: 'https://platform.openai.com/settings/organization/limits',
  gemini: 'https://aistudio.google.com/',
};

const BASE: Record<Exclude<ProviderId, 'compatible'>, string> = {
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
};

export interface ProviderConfig {
  provider: ProviderId;
  /** Solo en *OpenAI-compatible*: la dirección de la API (`https://openrouter.ai/api/v1`, `http://localhost:11434/v1`). */
  baseUrl?: string;
  model: string;
}

export interface CompletionRequest {
  system: string;
  user: string;
  maxTokens: number;
}

export interface Usage {
  input: number | null;
  output: number | null;
}

export interface Completion {
  text: string;
  /** El proveedor la cortó por largo (o por un filtro): no se puede aplicar. */
  cut: boolean;
  usage: Usage;
}

export type ProviderErrorKind =
  | 'auth'
  | 'forbidden'
  | 'rateLimit'
  | 'spendTier'
  | 'spendOwn'
  | 'model'
  | 'network'
  | 'server'
  | 'badRequest'
  | 'aborted';

/** Un error del proveedor, ya sin la clave. `retryAfter`: segundos, solo si se pudieron leer. */
export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly status = 0,
    readonly retryAfter: number | null = null,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

type Fetch = typeof fetch;

/** Saca la clave (y cualquier cosa que parezca una) de un texto que viene del proveedor. */
export function redact(text: string, key: string): string {
  let out = text;
  if (key && key.length >= 4) out = out.split(key).join('[key]');
  return out
    .replace(/\b(sk|rk|pk)-[A-Za-z0-9_\-*.]{6,}/g, '[key]')
    .replace(/\bsk-ant-[A-Za-z0-9_\-*.]{6,}/g, '[key]')
    .replace(/\bAIza[0-9A-Za-z_\-*.]{10,}/g, '[key]')
    .slice(0, 500);
}

function baseOf(config: ProviderConfig): string {
  if (config.provider === 'compatible') return (config.baseUrl ?? '').trim().replace(/\/+$/, '');
  return BASE[config.provider];
}

function headers(config: ProviderConfig, key: string): Record<string, string> {
  switch (config.provider) {
    case 'anthropic':
      // En TODO pedido (también `/v1/models`): sin él, el 401 llega sin CORS y el navegador lo muestra como "error de
      // red" (Docs/Doc_Asistente.md, 3.1).
      return {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      };
    case 'gemini':
      return { 'x-goog-api-key': key, 'content-type': 'application/json' };
    default:
      // Un modelo local sin clave: sin `Authorization`.
      return key ? { authorization: `Bearer ${key}`, 'content-type': 'application/json' } : { 'content-type': 'application/json' };
  }
}

/** Los segundos de `retry-after` (si el navegador lo puede leer) o del cuerpo del error. */
function retryAfterOf(res: Response, body: string): number | null {
  const header = res.headers.get('retry-after');
  if (header && /^\d+(\.\d+)?$/.test(header.trim())) return Math.ceil(Number(header));
  // Gemini: `"retryDelay": "17s"`; OpenAI: "Please try again in 20s" / "in 1.5s".
  const delay = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body) ?? /try again in (\d+(?:\.\d+)?)\s*s/i.exec(body);
  return delay ? Math.ceil(Number(delay[1])) : null;
}

/** El mensaje del cuerpo de un error del proveedor (las cuatro formas). */
function messageOf(body: string): { message: string; type: string } {
  try {
    const json = JSON.parse(body) as { error?: { message?: string; type?: string; status?: string; code?: string } | string; message?: string };
    if (typeof json.error === 'string') return { message: json.error, type: '' };
    return { message: json.error?.message ?? json.message ?? '', type: json.error?.type ?? json.error?.status ?? json.error?.code ?? '' };
  } catch {
    return { message: body, type: '' };
  }
}

/** Un error del proveedor, con el tipo que la app sabe explicar. */
async function errorFrom(res: Response, key: string): Promise<ProviderError> {
  let body = '';
  try {
    body = await res.text();
  } catch {
    body = '';
  }
  const { message, type } = messageOf(body);
  const clean = redact(message || res.statusText || `HTTP ${res.status}`, key);
  const all = `${type} ${message}`;
  if (res.status === 401) return new ProviderError('auth', clean, 401);
  if (res.status === 403) return new ProviderError('forbidden', clean, 403);
  if (res.status === 429) {
    // El tope de gasto del nivel de Anthropic: un 429 sin `retry-after`.
    if (/spend.?limit|enforced_spend_limit_reached|monthly.*limit/i.test(all)) return new ProviderError('spendTier', clean, 429);
    return new ProviderError('rateLimit', clean, 429, retryAfterOf(res, body));
  }
  // El tope que fija la persona en la consola de Anthropic: un 400.
  if (res.status === 400 && /specified API usage limits/i.test(message)) return new ProviderError('spendOwn', clean, 400);
  if (res.status === 404 || /model.*(not found|does not exist)|not_found/i.test(all)) return new ProviderError('model', clean, res.status);
  if (res.status >= 500) return new ProviderError('server', clean, res.status);
  return new ProviderError('badRequest', clean, res.status);
}

async function send(fetcher: Fetch, url: string, init: RequestInit, key: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetcher(url, init);
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') throw new ProviderError('aborted', 'Stopped');
    // Sin red, CORS rechazado o un modelo local apagado: el navegador no dice cuál.
    throw new ProviderError('network', redact(String((err as Error)?.message ?? err), key));
  }
  if (!res.ok) throw await errorFrom(res, key);
  return res;
}

// --- Modelos --------------------------------------------------------------------------------------------------------

export interface ModelInfo {
  id: string;
  name: string;
}

/** Lo que no escribe texto (imágenes, voz, embeddings, moderación): fuera de la lista. */
const NOT_TEXT = /embed|tts|whisper|dall-e|image|audio|realtime|moderation|transcribe|speech|search-preview|computer-use|davinci|babbage|imagen|veo|aqa|lyria/i;

/** La lista de modelos del proveedor (`Test` la usa: si la clave anda, la lista llega). */
export async function listModels(config: ProviderConfig, key: string, fetcher: Fetch = fetch, signal?: AbortSignal): Promise<ModelInfo[]> {
  const base = baseOf(config);
  if (!base) throw new ProviderError('badRequest', 'Missing base URL');
  if (config.provider === 'gemini') {
    const res = await send(fetcher, `${base}/models?pageSize=1000`, { headers: headers(config, key), signal }, key);
    const json = (await res.json()) as { models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[] };
    return (json.models ?? [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent') && !NOT_TEXT.test(m.name))
      .map((m) => ({ id: m.name.replace(/^models\//, ''), name: m.displayName || m.name.replace(/^models\//, '') }));
  }
  const url = config.provider === 'anthropic' ? `${base}/models?limit=1000` : `${base}/models`;
  const res = await send(fetcher, url, { headers: headers(config, key), signal }, key);
  const json = (await res.json()) as { data?: { id: string; display_name?: string; name?: string; created?: number; created_at?: string }[] };
  const list = (json.data ?? []).filter((m) => typeof m.id === 'string' && (config.provider !== 'openai' || !NOT_TEXT.test(m.id)));
  // OpenAI no las ordena: las más nuevas primero (como Anthropic).
  if (config.provider === 'openai') list.sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
  return list.map((m) => ({ id: m.id, name: m.display_name || m.name || m.id }));
}

/**
 * El modelo que se preelige: uno barato y rápido, por el nombre (Haiku, `-mini`/`-nano`/`-luna`, `flash-lite`). La
 * persona lo cambia. Sin ninguno que coincida, el primero de la lista.
 */
export function defaultModel(provider: ProviderId, models: ModelInfo[]): string {
  const ids = models.map((m) => m.id);
  const dated = /-\d{4}-\d{2}-\d{2}$|-\d{8}$/;
  const pick = (re: RegExp) => ids.find((id) => re.test(id) && !dated.test(id) && !/preview|exp/i.test(id)) ?? ids.find((id) => re.test(id));
  const found =
    provider === 'anthropic'
      ? pick(/haiku/i)
      : provider === 'openai'
        ? pick(/^gpt-.*-(mini|nano|luna)$/i) ?? pick(/-(mini|nano|luna)\b/i)
        : provider === 'gemini'
          ? pick(/flash-lite/i) ?? pick(/flash/i)
          : undefined;
  return found ?? ids[0] ?? '';
}

// --- Pedir ----------------------------------------------------------------------------------------------------------

/** Lee un cuerpo con eventos (`text/event-stream`): cada `data:` con su JSON, en orden. */
async function* events(res: Response, signal?: AbortSignal): AsyncGenerator<{ event: string; data: string }> {
  const reader = res.body?.getReader();
  if (!reader) {
    // Sin cuerpo por partes (un servidor local, una prueba): todo junto.
    const text = await res.text();
    yield* parseEvents(text);
    return;
  }
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      if (signal?.aborted) throw new ProviderError('aborted', 'Stopped');
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let at: number;
      while ((at = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const chunk = buffer.slice(0, at);
        buffer = buffer.slice(at).replace(/^\r?\n\r?\n/, '');
        yield* parseEvents(chunk);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) yield* parseEvents(buffer);
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError' || signal?.aborted) throw new ProviderError('aborted', 'Stopped');
    if (err instanceof ProviderError) throw err;
    throw new ProviderError('network', 'The connection was interrupted');
  } finally {
    reader.releaseLock?.();
  }
}

function* parseEvents(text: string): Generator<{ event: string; data: string }> {
  for (const block of text.split(/\r?\n\r?\n/)) {
    let event = '';
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (data.length > 0) yield { event, data: data.join('\n') };
  }
}

function parse<T>(data: string): T | null {
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

/**
 * Manda el pedido y recibe la respuesta por partes (`onText` con lo recibido hasta ahora). `signal` lo corta (*Stop*).
 * Si la conexión se corta a mitad, devuelve lo recibido con `cut: true`.
 */
export async function complete(
  config: ProviderConfig,
  key: string,
  request: CompletionRequest,
  options: { fetcher?: Fetch; signal?: AbortSignal; onText?: (text: string) => void } = {},
): Promise<Completion> {
  const fetcher = options.fetcher ?? fetch;
  const base = baseOf(config);
  if (!base) throw new ProviderError('badRequest', 'Missing base URL');
  const { signal } = options;
  let text = '';
  let cut = false;
  let finished = false;
  const usage: Usage = { input: null, output: null };
  const add = (piece: string) => {
    if (!piece) return;
    text += piece;
    options.onText?.(text);
  };
  let url: string;
  let body: unknown;
  switch (config.provider) {
    case 'anthropic':
      url = `${base}/messages`;
      body = {
        model: config.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
        stream: true,
      };
      break;
    case 'openai':
      // `store: false`: de fábrica la API guarda la respuesta (Docs/Doc_Asistente.md, 3.1).
      url = `${base}/responses`;
      body = { model: config.model, instructions: request.system, input: request.user, max_output_tokens: request.maxTokens, store: false, stream: true };
      break;
    case 'gemini':
      url = `${base}/models/${encodeURIComponent(config.model)}:streamGenerateContent?alt=sse`;
      body = {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: 'user', parts: [{ text: request.user }] }],
        generationConfig: { maxOutputTokens: request.maxTokens },
      };
      break;
    default:
      url = `${base}/chat/completions`;
      body = {
        model: config.model,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
        max_tokens: request.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
      };
  }
  const res = await send(fetcher, url, { method: 'POST', headers: headers(config, key), body: JSON.stringify(body), signal }, key);
  try {
    for await (const { event, data } of events(res, signal)) {
      if (data === '[DONE]') {
        finished = true;
        continue;
      }
      if (config.provider === 'anthropic') {
        const ev = parse<{
          type?: string;
          delta?: { type?: string; text?: string; stop_reason?: string };
          message?: { usage?: { input_tokens?: number; output_tokens?: number } };
          usage?: { output_tokens?: number; input_tokens?: number };
          error?: { type?: string; message?: string };
        }>(data);
        const type = ev?.type ?? event;
        if (type === 'error') throw new ProviderError(ev?.error?.type === 'overloaded_error' ? 'server' : 'badRequest', redact(ev?.error?.message ?? 'Error', key));
        if (type === 'message_start') usage.input = ev?.message?.usage?.input_tokens ?? usage.input;
        if (type === 'content_block_delta' && ev?.delta?.type === 'text_delta') add(ev.delta.text ?? '');
        if (type === 'message_delta') {
          if (ev?.usage?.output_tokens !== undefined) usage.output = ev.usage.output_tokens;
          if (ev?.usage?.input_tokens !== undefined && ev.usage.input_tokens !== null) usage.input = ev.usage.input_tokens ?? usage.input;
          if (ev?.delta?.stop_reason === 'max_tokens' || ev?.delta?.stop_reason === 'refusal') cut = true;
        }
        if (type === 'message_stop') finished = true;
      } else if (config.provider === 'openai') {
        const ev = parse<{
          type?: string;
          delta?: string;
          response?: { status?: string; usage?: { input_tokens?: number; output_tokens?: number }; incomplete_details?: { reason?: string } | null; error?: { message?: string } | null };
          message?: string;
        }>(data);
        const type = ev?.type ?? event;
        if (type === 'response.output_text.delta') add(ev?.delta ?? '');
        if (type === 'response.completed' || type === 'response.incomplete' || type === 'response.failed') {
          usage.input = ev?.response?.usage?.input_tokens ?? usage.input;
          usage.output = ev?.response?.usage?.output_tokens ?? usage.output;
          if (type === 'response.incomplete') cut = true;
          if (type === 'response.failed') throw new ProviderError('server', redact(ev?.response?.error?.message ?? 'The request failed', key));
          finished = true;
        }
        if (type === 'error') throw new ProviderError('badRequest', redact(ev?.message ?? 'Error', key));
      } else if (config.provider === 'gemini') {
        const ev = parse<{
          candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
          error?: { message?: string };
        }>(data);
        if (ev?.error) throw new ProviderError('badRequest', redact(ev.error.message ?? 'Error', key));
        const candidate = ev?.candidates?.[0];
        // Lo que el modelo "pensó" no es la respuesta.
        for (const part of candidate?.content?.parts ?? []) if (!part.thought) add(part.text ?? '');
        if (ev?.usageMetadata) {
          usage.input = ev.usageMetadata.promptTokenCount ?? usage.input;
          usage.output = ev.usageMetadata.candidatesTokenCount ?? usage.output;
        }
        const reason = candidate?.finishReason;
        if (reason) {
          finished = true;
          if (reason !== 'STOP') cut = true;
        }
      } else {
        const ev = parse<{
          choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
          error?: { message?: string };
        }>(data);
        if (ev?.error) throw new ProviderError('badRequest', redact(ev.error.message ?? 'Error', key));
        const choice = ev?.choices?.[0];
        add(choice?.delta?.content ?? '');
        if (choice?.finish_reason) {
          finished = true;
          if (choice.finish_reason === 'length' || choice.finish_reason === 'content_filter') cut = true;
        }
        if (ev?.usage) {
          usage.input = ev.usage.prompt_tokens ?? usage.input;
          usage.output = ev.usage.completion_tokens ?? usage.output;
        }
      }
    }
  } catch (err) {
    if (err instanceof ProviderError && err.kind !== 'network') throw err;
    // La conexión se cortó a mitad: lo recibido, cortado.
    return { text, cut: true, usage };
  }
  // Sin el aviso de "terminó" la respuesta pudo quedar a medias.
  if (!finished) cut = true;
  return { text, cut, usage };
}

/** Si una dirección es local (la máquina o una red privada): lo que deja la política `local_only`. */
export function isLocalUrl(url: string | undefined): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '127.0.0.1') return true;
  if (/^127\.\d+\.\d+\.\d+$/.test(host) || /^10\.\d+\.\d+\.\d+$/.test(host) || /^192\.168\.\d+\.\d+$/.test(host)) return true;
  const m = /^172\.(\d+)\.\d+\.\d+$/.exec(host);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host)) return true;
  return host.endsWith('.local');
}

/** Si el proveedor de los ajustes es local (no necesita internet). */
export const isLocalProvider = (config: Pick<ProviderConfig, 'provider' | 'baseUrl'>) => config.provider === 'compatible' && isLocalUrl(config.baseUrl);
