import { DurableObject } from 'cloudflare:workers';
import { Portero, type Env } from './core';
import { PREFIX, denied, session, hash, same, control, json, body, allowedNvidiaOrigin, nvidiaAnswer, handleNvidia, NvidiaDenied, type NvidiaCycle } from './assistantNvidia';

type State = 'prepared' | 'starting' | 'stopped' | 'terminal' | 'abandoned';
type RecordState = { v: 1; k: 'chat' | 'models'; w: string; s: string; c: string; t: number; p: number; e: number; x?: number; state: State };
type Operation = Parameters<NvidiaCycle['attach']>[0];
/** Una raíz por objeto; STORE conserva exclusivamente su función anterior. */
export class NvidiaRequestOwner extends DurableObject {
  private record?: RecordState;
  private controller?: AbortController;
  private operation?: Operation;
  private stopping?: Promise<{ state: 'stopped'; rootAborted: boolean; cleanupJoined: true }>;
  private timer?: ReturnType<typeof setTimeout>;
  private timerClosure?: Promise<void>;
  private closureFailed = false;
  private readonly ready: Promise<void>;
  private readonly env: Env;
  constructor(ctx: unknown, env: Env) {
    super(ctx, env); this.env = env;
    this.ready = this.ctx.blockConcurrencyWhile(async () => {
      this.record = await this.ctx.storage.get('control') as RecordState | undefined;
      const alarm = await this.ctx.storage.getAlarm();
      if (!this.record) return;
      if (this.record.state === 'starting' || this.record.state === 'prepared' && Date.now() >= this.record.p) {
        this.record.state = 'abandoned'; await this.persist();
      }
      if (alarm === null) { await this.ctx.storage.setAlarm(this.nextAlarm()); await this.ctx.storage.sync(); }
    });
  }
  private nextAlarm() { return this.record!.state === 'prepared' ? this.record!.p : this.record!.state === 'starting' ? this.record!.x! : this.record!.e; }
  private async persist() {
    if (new TextEncoder().encode(JSON.stringify(this.record)).byteLength > 512) denied(502, 'workspace_unavailable');
    await this.ctx.storage.put('control', this.record);
    await this.ctx.storage.setAlarm(this.nextAlarm());
    await this.ctx.storage.sync();
  }
  private check = () => {
    const r = this.record;
    if (!r || r.state === 'stopped' || r.state === 'abandoned' || Date.now() >= r.e || r.x !== undefined && Date.now() >= r.x) {
      const reason = new NvidiaDenied(r?.state === 'starting' && Date.now() >= r.x! ? 504 : 499, r?.state === 'starting' && Date.now() >= r.x! ? 'gateway_timeout' : 'workspace_stopped');
      this.controller?.abort(reason); this.operation?.stop(); throw reason;
    }
  };
  private async validate(req: Request) {
    const value = control({ v: 1, id: req.headers.get('x-shotdocs-nvidia-owner'), capability: req.headers.get('x-shotdocs-nvidia-capability') });
    const [w, s, c] = await Promise.all([hash(this.env.SUPABASE_URL.replace(/\/+$/, '')), hash(session(req)), hash(value.capability)]);
    const r = this.record;
    if (value.id !== this.ctx.id.toString() || !r || !same(w, r.w) || !same(s, r.s) || !same(c, r.c)) denied(403, 'control_rejected');
    if (Date.now() >= r!.e || (r!.state === 'prepared' || r!.state === 'abandoned' && r!.x === undefined) && Date.now() >= r!.p || (r!.state === 'starting' || r!.state === 'abandoned') && r!.x !== undefined && Date.now() >= r!.x!) {
      await this.expire(); denied(410, 'control_expired');
    }
    return r!;
  }
  private stopOwned(reason = new NvidiaDenied(499, 'workspace_stopped')) {
    if (this.stopping) return this.stopping;
    const active = !!this.controller, operation = this.operation;
    this.record!.state = 'stopped';
    this.controller?.abort(reason); operation?.stop();
    if (this.timer) clearTimeout(this.timer);
    this.stopping = (async () => {
      try { await this.persist(); }
      finally {
        try { await operation?.join(); operation?.seal(); }
        finally { this.operation = undefined; this.controller = undefined; }
      }
      return { state: 'stopped' as const, rootAborted: active, cleanupJoined: true as const };
    })();
    return this.stopping;
  }
  private async finished() {
    if (this.timer) clearTimeout(this.timer);
    if (this.record && this.record.state !== 'stopped' && this.record.state !== 'abandoned') this.record.state = 'terminal';
    await this.persist();
    this.operation = undefined; this.controller = undefined;
  }
  private async expire() {
    if (this.controller || this.operation) await this.stopOwned(new NvidiaDenied(504, 'gateway_timeout'));
    if (this.timerClosure) await this.timerClosure;
    if (Date.now() >= this.record!.e) {
      await this.ctx.storage.delete('control'); await this.ctx.storage.deleteAlarm(); await this.ctx.storage.sync(); this.record = undefined;
    } else if (this.record!.state === 'prepared' || this.record!.state === 'starting') {
      this.record!.state = 'abandoned'; await this.persist();
    }
  }
  async alarm() {
    await this.ready;
    if (!this.record) return;
    await this.expire();
    if (this.record) await this.persist();
  }
  async fetch(req: Request): Promise<Response> {
    const action = new URL(req.url).pathname;
    let acquired: AbortController | undefined;
    try {
      await this.ready;
      if (!allowedNvidiaOrigin(req, this.env)) denied(403, 'control_rejected');
      if (action === '/prepare') {
        if (this.record) denied(409, 'control_consumed');
        const value = await body(req, 256) as { v: 1; kind: 'chat' | 'models' };
        if (value?.v !== 1 || !['chat','models'].includes(value.kind)) denied(422, 'nvidia_bad_request');
        const capability = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const [w, s, c] = await Promise.all([hash(this.env.SUPABASE_URL.replace(/\/+$/, '')), hash(session(req)), hash(capability)]);
        if (this.record) denied(409, 'control_consumed');
        const t = Date.now();
        this.record = { v: 1, k: value.kind, w, s, c, t, p: t + 30000, e: t + 600000, state: 'prepared' };
        await this.persist();
        return json(req, { v: 1, id: this.ctx.id.toString(), capability, prepareExpiresAt: this.record.p, retentionExpiresAt: this.record.e }, 201);
      }
      const r = await this.validate(req);
      if (this.closureFailed) denied(502, 'workspace_unavailable');
      if (action === '/stop') {
        if (r.state === 'terminal' || r.state === 'abandoned') {
          await this.ctx.storage.sync();
          return json(req, { v: 1, id: this.ctx.id.toString(), state: r.state === 'terminal' ? 'already_terminal' : 'abandoned', rootAborted: false, cleanupJoined: r.state === 'terminal' });
        }
        return json(req, { v: 1, id: this.ctx.id.toString(), ...await this.stopOwned() });
      }
      if (action === '/status') { await this.ctx.storage.sync(); return json(req, { v: 1, id: this.ctx.id.toString(), state: r.state }); }
      if (r.state !== 'prepared') denied(409, 'control_consumed');
      if (Date.now() >= r.p) { await this.expire(); denied(410, 'control_expired'); }
      if (action !== PREFIX + (r.k === 'models' ? 'models' : 'chat/completions')) denied(403, 'control_rejected');
      this.controller = acquired = new AbortController(); r.state = 'starting'; r.x = Date.now() + 180000;
      const controller = this.controller;
      await this.persist(); this.check();
      this.timer = setTimeout(() => {
        this.timerClosure = this.stopOwned(new NvidiaDenied(504, 'gateway_timeout')).then(() => undefined, () => { this.closureFailed = true; });
      }, Math.max(0, r.x - Date.now()));
      const store = this.env.STORE;
      if (!store) denied(502, 'workspace_unavailable');
      const stub = store!.get(store!.idFromName('main'));
      const portero = new Portero(this.env, { get: async <T>(key: string) => await stub.read(key) as T | undefined, put: (key, value) => stub.write(key, value), delete: (key) => stub.remove(key) });
      const response = await handleNvidia(req, this.env, (input, init) => fetch(input, init), (signal) => portero.authenticateNvidia(req, signal), {
        controller, check: this.check, attach: (operation) => { this.operation = operation; if (controller.signal.aborted) operation.stop(); }, finished: () => this.finished(),
      });
      if (!response.ok) await this.finished();
      return response;
    } catch (err) {
      if (acquired && this.controller === acquired && !this.stopping) await this.stopOwned().catch(() => { this.closureFailed = true; });
      return nvidiaAnswer(req, err instanceof NvidiaDenied ? err.status : 502, err instanceof NvidiaDenied ? err.code : 'workspace_unavailable');
    }
  }
}
