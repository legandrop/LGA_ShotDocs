import { ProviderError } from './providers';
import type { NvidiaKind } from './nvidiaProtocol';

type Destination = { base: string; token: string };
export type NvidiaHandle = { v: 1; id: string; capability: string; prepareExpiresAt: number; retentionExpiresAt: number };
export type NvidiaStopState = 'stopping' | 'confirmed' | 'unconfirmed';
const invalid = () => new ProviderError('workspace', 'gateway_outdated');
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** El control conserva la isla capturada y se espera incluso cuando los datos ya fueron abortados. */
export class NvidiaControl {
  private preparing?: Promise<NvidiaHandle>;
  private destination?: Destination;
  private handle?: NvidiaHandle;
  private stopping?: Promise<NvidiaStopState>;
  private requested = false;
  private completed = false;
  private readonly abort = () => { this.stop(); };
  constructor(private readonly signal: AbortSignal, private readonly workspace: () => Promise<Destination>,
    private readonly check: () => void, private readonly kind: NvidiaKind, private readonly http: typeof fetch = fetch,
    private readonly notify?: (state: NvidiaStopState) => void) {
    signal.addEventListener('abort', this.abort, { once: true });
    if (signal.aborted) this.abort();
  }
  private async request(path: 'prepare' | 'stop', value: unknown): Promise<unknown> {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 3000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, cancellation: Promise<void> | undefined;
    const cancel = () => { if (reader) cancellation ??= reader.cancel().catch(() => undefined); };
    controller.signal.addEventListener('abort', cancel, { once: true });
    try {
      const { base, token } = this.destination!;
      const response = await this.http(`${base}/assistant/nvidia/${path}`, { method: 'POST', headers: {
        Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
      }, body: JSON.stringify(value), signal: controller.signal, redirect: 'error', cache: 'no-store' });
      if (controller.signal.aborted) { await response.body?.cancel().catch(() => undefined); throw invalid(); }
      reader = response.body?.getReader();
      if (!reader) throw invalid();
      const parts: Uint8Array[] = []; let size = 0;
      for (;;) {
        const item = await reader.read();
        if (controller.signal.aborted) throw invalid();
        if (item.done) break;
        size += item.value.length; if (size > 8192) throw invalid(); parts.push(item.value);
      }
      const bytes = new Uint8Array(size); let at = 0;
      for (const part of parts) { bytes.set(part, at); at += part.length; }
      const json: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!response.ok) {
        const code = object(json) && typeof json.code === 'string' ? json.code : 'gateway_outdated';
        throw new ProviderError('workspace', code, response.status);
      }
      if (response.status !== (path === 'prepare' ? 201 : 200)) throw invalid();
      return json;
    } catch (err) { if (err instanceof ProviderError) throw err; throw new ProviderError('network', 'The connection was interrupted'); }
    finally { clearTimeout(timer); controller.signal.removeEventListener('abort', cancel); if (reader) { await (cancellation ?? reader.cancel().catch(() => undefined)); reader.releaseLock(); } }
  }
  async prepare(): Promise<NvidiaHandle> {
    if (this.requested && !this.preparing) throw new ProviderError('aborted', 'Stopped');
    this.check();
    this.preparing ??= (async () => {
      this.destination = await this.workspace(); this.check();
      const value = await this.request('prepare', { v: 1, kind: this.kind });
      if (!object(value) || Object.keys(value).length !== 5 || value.v !== 1 || typeof value.id !== 'string' || !/^[a-f0-9]{64}$/.test(value.id) ||
        typeof value.capability !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.capability) || !Number.isSafeInteger(value.prepareExpiresAt) || !Number.isSafeInteger(value.retentionExpiresAt)) throw invalid();
      this.handle = value as NvidiaHandle; return this.handle;
    })();
    const handle = await this.preparing;
    if (this.requested) { await this.requestStop(); throw new ProviderError('aborted', 'Stopped'); }
    this.check(); return handle;
  }
  requestStop(): Promise<NvidiaStopState> {
    this.stopping ??= (async () => {
      try {
        await this.preparing?.catch(() => undefined);
        if (!this.handle || !this.destination) return 'unconfirmed';
        const { id, capability } = this.handle;
        const ack = await this.request('stop', { v: 1, id, capability });
        if (!object(ack) || Object.keys(ack).length !== 5 || ack.v !== 1 || ack.id !== id || typeof ack.rootAborted !== 'boolean' || typeof ack.cleanupJoined !== 'boolean') return 'unconfirmed';
        return ack.state === 'stopped' && ack.cleanupJoined === true || ack.state === 'already_terminal' && ack.rootAborted === false && ack.cleanupJoined === true ? 'confirmed' : 'unconfirmed';
      } catch { return 'unconfirmed'; }
    })().then((state) => { if (this.requested) this.notify?.(state); return state; });
    return this.stopping;
  }
  stop() { this.requested = true; this.notify?.('stopping'); return this.requestStop(); }
  checkStopped() { if (this.requested) throw new ProviderError('aborted', 'Stopped'); }
  terminal() { this.completed = true; }
  async close() {
    try {
      if (this.preparing) await this.preparing.catch(() => undefined);
      if (this.requested || this.handle && !this.completed) await this.requestStop();
    } finally { this.signal.removeEventListener('abort', this.abort); }
  }
}
