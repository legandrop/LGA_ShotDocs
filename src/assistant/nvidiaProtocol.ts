/** Canal propio de NVIDIA: HTTP200 abre el cuerpo; sólo terminal + EOF confirman el resultado. */
export const NVIDIA_PROTOCOL = 'X-Shotdocs-Nvidia-Protocol';
export const NVIDIA_STREAM_LIMIT = 8 * 1024 * 1024;
export const NVIDIA_EVENT_LIMIT = 256 * 1024;
export const NVIDIA_CATALOG_LIMIT = 1024 * 1024;
export type NvidiaKind = 'chat' | 'models';
export type NvidiaUsage = { input: number | null; output: number | null };
export type NvidiaFrame =
  | { event: 'sd.ready'; value: { v: 1; kind: NvidiaKind } }
  | { event: 'sd.delta'; value: { text: string } }
  | { event: 'sd.models'; value: { data: { id: string }[] } }
  | { event: 'sd.done'; value: { cut: boolean; usage: NvidiaUsage } }
  | { event: 'sd.error'; value: { status: number; code: string; retryAfter: number | null } };
export class NvidiaProtocolError extends Error {
  constructor(readonly reason: 'aborted' | 'invalid' | 'limit') { super(reason); }
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, names: string[]) => Object.keys(v).length === names.length && names.every((k) => Object.hasOwn(v, k));
const counter = (v: unknown) => v === null || typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const codes: Record<string, number> = {
  workspace_session: 401, workspace_policy: 403, workspace_page: 403, workspace_unavailable: 502, workspace_stopped: 499,
  gateway_timeout: 504, nvidia_auth: 401, nvidia_forbidden: 403, nvidia_model: 404,
  nvidia_rate_limit: 429, nvidia_pending: 502, nvidia_bad_request: 422, nvidia_key: 422,
  nvidia_no_vision: 422, nvidia_bad_image: 422, nvidia_too_large: 413, nvidia_catalog: 502, nvidia_stream: 502,
};
/** La validación del pedido también puede rechazar un modelo con422 antes de contactar al proveedor. */
export function validNvidiaError(status: unknown, code: unknown, retryAfter: unknown): boolean {
  if (typeof status !== 'number' || !Number.isInteger(status) || typeof code !== 'string') return false;
  const pair = code === 'workspace_session' ? status === 401 || status === 403
    : code === 'nvidia_model' ? status === 404 || status === 422
    : code === 'nvidia_unavailable' ? status >= 400 && status <= 599 && ![401,403,404,429].includes(status)
    : Object.hasOwn(codes, code) && status === codes[code];
  return pair && (retryAfter === null || code === 'nvidia_rate_limit' && typeof retryAfter === 'number' && Number.isInteger(retryAfter) && retryAfter >= 0 && retryAfter <= 86400);
}
export function nvidiaFrame(event: string, data: string): NvidiaFrame {
  let value: unknown;
  try { value = JSON.parse(data); } catch { throw new NvidiaProtocolError('invalid'); }
  if (!object(value)) throw new NvidiaProtocolError('invalid');
  const valid = event === 'sd.ready' ? keys(value, ['v','kind']) && value.v === 1 && ['chat','models'].includes(value.kind as string)
    : event === 'sd.delta' ? keys(value, ['text']) && typeof value.text === 'string'
    : event === 'sd.models' ? keys(value, ['data']) && Array.isArray(value.data) && value.data.every((m) => object(m) && keys(m, ['id']) && typeof m.id === 'string')
    : event === 'sd.done' ? keys(value, ['cut','usage']) && typeof value.cut === 'boolean' && object(value.usage) && keys(value.usage, ['input','output']) && counter(value.usage.input) && counter(value.usage.output)
    : event === 'sd.error' ? keys(value, ['status','code','retryAfter']) && validNvidiaError(value.status, value.code, value.retryAfter)
    : false;
  if (!valid) throw new NvidiaProtocolError('invalid');
  return { event, value } as NvidiaFrame;
}
export function encodeNvidiaFrame(frame: NvidiaFrame): Uint8Array {
  return new TextEncoder().encode(`event: ${frame.event}\ndata: ${JSON.stringify(frame.value)}\n\n`);
}

/** UTF8/framing completos, límites por bytes y cancel unido a finally, sin reconexión automática. */
export async function* nvidiaEvents(body: ReadableStream<Uint8Array> | null, options: {
  signal?: AbortSignal; check?: () => void; total?: number; eventLimit?: number;
  reader?: (reader: ReadableStreamDefaultReader<Uint8Array> | null) => void;
  lockedReader?: ReadableStreamDefaultReader<Uint8Array>;
} = {}): AsyncGenerator<{ event: string; data: string }> {
  if (!body) throw new NvidiaProtocolError('invalid');
  const reader = options.lockedReader ?? body.getReader();
  options.reader?.(reader);
  let cancel: Promise<void> | undefined;
  const stop = () => { cancel ??= reader.cancel().catch(() => undefined); };
  const check = () => { if (options.signal?.aborted) throw new NvidiaProtocolError('aborted'); options.check?.(); };
  options.signal?.addEventListener('abort', stop, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const encoder = new TextEncoder();
  let buffer = '', size = 0;
  try {
    for (;;) {
      check();
      const { done, value } = await reader.read();
      check();
      if (done) { buffer += decoder.decode(); if (buffer.trim()) throw new NvidiaProtocolError('invalid'); break; }
      size += value.byteLength;
      if (size > (options.total ?? NVIDIA_STREAM_LIMIT)) throw new NvidiaProtocolError('limit');
      buffer += decoder.decode(value, { stream: true });
      let at: number;
      while ((at = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const block = buffer.slice(0, at);
        if (encoder.encode(block).byteLength > (options.eventLimit ?? NVIDIA_EVENT_LIMIT)) throw new NvidiaProtocolError('limit');
        buffer = buffer.slice(at).replace(/^\r?\n\r?\n/, '');
        const data: string[] = []; let event = '';
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
          else if (line && !line.startsWith(':')) throw new NvidiaProtocolError('invalid');
        }
        if (data.length) { check(); yield { event, data: data.join('\n') }; }
      }
      if (encoder.encode(buffer).byteLength > (options.eventLimit ?? NVIDIA_EVENT_LIMIT)) throw new NvidiaProtocolError('limit');
    }
  } finally {
    options.signal?.removeEventListener('abort', stop);
    await (cancel ?? reader.cancel().catch(() => undefined));
    options.reader?.(null);
    reader.releaseLock();
  }
}
