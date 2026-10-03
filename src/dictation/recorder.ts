// Grabar una nota con el micrófono propio (Docs/Doc_Dictado.md, 6 y 11 bis C5; entrega V3). Tocar para empezar y
// tocar para cortar; los pedazos de 1 segundo (`MediaRecorder.start(1000)`) se guardan en el dispositivo a medida que
// llegan, así una grabación cortada (una llamada, otra app, la página que se cierra) no se pierde: queda lo grabado
// hasta ahí.
//
// C5: sin el primer pedazo no se decodifica nada (lleva la cabecera). Por eso *Recording* se muestra recién cuando el
// primer pedazo quedó confirmado en el dispositivo; si esa escritura falla, se avisa y no se graba. Se escucha `ended`
// de la pista (iOS corta la captura al navegar o al pasar a otra app) y `pagehide`: los dos cortan y guardan.
//
// Además: el nivel del micrófono (un `AnalyserNode`), el tope de 2 minutos con aviso a 1:45, la pantalla despierta
// mientras graba (`navigator.wakeLock`) y una vibración corta al empezar y al cortar donde existe (Android).

export const MAX_MS = 2 * 60 * 1000;
export const WARN_MS = 105 * 1000;
const SLICE_MS = 1000;

export type RecorderState = 'idle' | 'starting' | 'recording' | 'stopping' | 'done' | 'error';

/** Por qué no se pudo grabar. */
export type RecorderError = 'unsupported' | 'denied' | 'noMic' | 'storage' | 'failed';

/** Dónde se guardan los pedazos (la cola del dispositivo); sin él, la grabación queda en memoria (*Ask…*). */
export interface RecordingStore {
  /** Crea la nota (estado `recording`) y devuelve su id. */
  create(mime: string): Promise<string>;
  chunk(noteId: string, seq: number, data: Blob): Promise<void>;
  /** Cuántos pedazos y cuánto dura hasta ahora (para una grabación cortada). */
  progress(noteId: string, chunks: number, durationMs: number): Promise<void>;
  /** Terminó (también cortada): la nota pasa a `saved`. */
  finish(noteId: string, chunks: number, durationMs: number): Promise<void>;
  /** No llegó a guardarse ni el primer pedazo: la nota no tiene nada y se saca. */
  abandon(noteId: string): Promise<void>;
}

export interface RecordingResult {
  noteId: string | null;
  data: Blob;
  mime: string;
  durationMs: number;
  chunks: number;
  /** Por qué terminó: la persona, el tope, o un corte (pista terminada, página que se cierra). */
  reason: 'user' | 'cap' | 'cut';
}

export interface RecorderOptions {
  store: RecordingStore | null;
  onState?: (state: RecorderState, error?: RecorderError) => void;
  /** El nivel del micrófono, de 0 a 1. */
  onLevel?: (level: number) => void;
  /** Lo que lleva grabado, en milisegundos (cada ~250 ms). */
  onTick?: (ms: number) => void;
  /** Terminó solo (tope o corte): la hoja recibe el resultado. */
  onAutoStop?: (result: RecordingResult) => void;
  maxMs?: number;
  /** Para las pruebas. */
  env?: Partial<RecorderEnv>;
}

export interface RecorderEnv {
  getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>;
  MediaRecorder: typeof MediaRecorder;
  now: () => number;
  wakeLock: (() => Promise<{ release: () => Promise<void> }>) | null;
  vibrate: ((ms: number) => void) | null;
  AudioContext: typeof AudioContext | null;
}

function defaultEnv(): Partial<RecorderEnv> {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const g = globalThis as { MediaRecorder?: typeof MediaRecorder; AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const wake = (nav as { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } } | undefined)?.wakeLock;
  return {
    getUserMedia: nav?.mediaDevices?.getUserMedia ? (c) => nav.mediaDevices.getUserMedia(c) : undefined,
    MediaRecorder: g.MediaRecorder,
    now: () => Date.now(),
    wakeLock: wake ? () => wake.request('screen') : null,
    vibrate: typeof nav?.vibrate === 'function' ? (ms) => void nav.vibrate(ms) : null,
    AudioContext: g.AudioContext ?? g.webkitAudioContext ?? null,
  };
}

/** Si este navegador puede grabar con el micrófono propio. */
export function canRecord(env: Partial<RecorderEnv> = defaultEnv()): boolean {
  return !!env.getUserMedia && !!env.MediaRecorder;
}

/** El formato (C4): WebM/Opus si se puede (Chrome, Android, Safari 18.4 o más), si no mp4 (Safari viejo). */
export function pickMime(Rec: Pick<typeof MediaRecorder, 'isTypeSupported'> | undefined): string {
  const ok = (t: string) => {
    try {
      return !!Rec?.isTypeSupported?.(t);
    } catch {
      return false;
    }
  };
  if (ok('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  if (ok('audio/webm')) return 'audio/webm';
  if (ok('audio/mp4')) return 'audio/mp4';
  return '';
}

export class NoteRecorder {
  state: RecorderState = 'idle';
  private env: RecorderEnv;
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private noteId: string | null = null;
  private mime = '';
  private parts: Blob[] = [];
  private seq = 0;
  private startedAt = 0;
  private writes: Promise<void> = Promise.resolve();
  private failedWrite = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private audio: AudioContext | null = null;
  private wake: { release: () => Promise<void> } | null = null;
  private stopping: Promise<RecordingResult> | null = null;
  private reason: RecordingResult['reason'] = 'user';
  private cleanup: (() => void)[] = [];

  constructor(private opts: RecorderOptions) {
    this.env = { ...defaultEnv(), ...opts.env } as RecorderEnv;
  }

  private set(state: RecorderState, error?: RecorderError): void {
    this.state = state;
    this.opts.onState?.(state, error);
  }

  private fail(error: RecorderError): void {
    this.release();
    this.set('error', error);
  }

  async start(): Promise<void> {
    if (this.state !== 'idle') return;
    if (!canRecord(this.env)) return this.fail('unsupported');
    this.set('starting');
    try {
      this.stream = await this.env.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    } catch (err) {
      const name = (err as { name?: string })?.name ?? '';
      return this.fail(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'noMic' : 'failed');
    }
    if ((this.state as RecorderState) !== 'starting') return this.release();
    const Rec = this.env.MediaRecorder;
    const wanted = pickMime(Rec);
    try {
      this.rec = new Rec(this.stream, wanted ? { mimeType: wanted, audioBitsPerSecond: 24000 } : undefined);
    } catch {
      return this.fail('failed');
    }
    this.mime = this.rec.mimeType || wanted || 'audio/webm';
    if (this.opts.store) {
      try {
        this.noteId = await this.opts.store.create(this.mime);
      } catch {
        return this.fail('storage');
      }
    }
    if ((this.state as RecorderState) !== 'starting') return void this.finishStop();
    this.rec.addEventListener('dataavailable', (e) => this.onData((e as BlobEvent).data));
    // iOS corta la captura al navegar o al pasar a otra app: se corta y se guarda lo que hay.
    for (const track of this.stream.getTracks()) {
      const onEnded = () => void this.stop('cut');
      track.addEventListener('ended', onEnded);
      this.cleanup.push(() => track.removeEventListener('ended', onEnded));
    }
    if (typeof window !== 'undefined') {
      const onHide = () => void this.stop('cut');
      window.addEventListener('pagehide', onHide);
      this.cleanup.push(() => window.removeEventListener('pagehide', onHide));
    }
    this.startedAt = this.env.now();
    try {
      this.rec.start(SLICE_MS);
    } catch {
      if (this.noteId) await this.opts.store?.abandon(this.noteId).catch(() => undefined);
      return this.fail('failed');
    }
    this.env.vibrate?.(30);
    this.meter();
    void this.env.wakeLock?.().then(
      (w) => {
        if (this.state === 'starting' || this.state === 'recording') this.wake = w;
        else void w.release().catch(() => undefined);
      },
      () => undefined,
    );
    this.timer = setInterval(() => {
      const ms = this.elapsed();
      this.opts.onTick?.(ms);
      if (ms >= (this.opts.maxMs ?? MAX_MS)) void this.stop('cap');
    }, 250);
    // Sin dónde guardar (*Ask…*), graba ya.
    if (!this.opts.store) this.set('recording');
  }

  elapsed(): number {
    return this.startedAt ? this.env.now() - this.startedAt : 0;
  }

  private onData(data: Blob): void {
    if (!data || data.size === 0) return;
    const seq = this.seq++;
    this.parts.push(data);
    const store = this.opts.store;
    if (!store || !this.noteId) return;
    const id = this.noteId;
    this.writes = this.writes.then(async () => {
      if (this.failedWrite) return;
      try {
        await store.chunk(id, seq, data);
        if (seq === 0 && this.state === 'starting') this.set('recording');
        await store.progress(id, seq + 1, this.elapsed()).catch(() => undefined);
      } catch (err) {
        console.error('Dictado: no se pudo guardar un pedazo de la grabación', err);
        this.failedWrite = true;
        // Sin el primer pedazo no queda nada que leer: no se graba. Después del primero, se corta y queda lo guardado.
        if (seq === 0) {
          try {
            this.rec?.stop();
          } catch {
            // Ya estaba parado.
          }
          await store.abandon(id).catch(() => undefined);
          this.noteId = null;
          this.fail('storage');
        } else {
          void this.stop('cut');
        }
      }
    });
  }

  /** Corta y guarda. Devuelve el resultado (también si ya se estaba cortando). */
  stop(reason: RecordingResult['reason'] = 'user'): Promise<RecordingResult> {
    if (this.stopping) return this.stopping;
    this.reason = reason;
    this.stopping = this.finishStop();
    return this.stopping;
  }

  private async finishStop(): Promise<RecordingResult> {
    const wasRecording = this.state === 'starting' || this.state === 'recording';
    if (wasRecording) this.set('stopping');
    const rec = this.rec;
    if (rec && rec.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        rec.addEventListener('stop', done, { once: true });
        try {
          rec.stop();
        } catch {
          resolve();
        }
        // Si el navegador no avisa (la página se está cerrando), no se espera para siempre.
        setTimeout(done, 3000);
      });
    }
    const durationMs = this.elapsed();
    this.env.vibrate?.(30);
    await this.writes;
    if (this.noteId && this.opts.store) {
      if (this.seq > 0 && !(this.failedWrite && this.state === 'error')) await this.opts.store.finish(this.noteId, this.seq, durationMs).catch((err) => console.error('Dictado: no se pudo cerrar la grabación', err));
      else if (this.seq === 0) await this.opts.store.abandon(this.noteId).catch(() => undefined);
    }
    const result: RecordingResult = { noteId: this.seq > 0 ? this.noteId : null, data: new Blob(this.parts, { type: this.mime }), mime: this.mime, durationMs, chunks: this.seq, reason: this.reason };
    this.release();
    if (this.state !== 'error') this.set('done');
    if (this.reason !== 'user') this.opts.onAutoStop?.(result);
    return result;
  }

  private meter(): void {
    const Ctx = this.env.AudioContext;
    if (!Ctx || !this.stream || !this.opts.onLevel || typeof requestAnimationFrame !== 'function') return;
    try {
      this.audio = new Ctx();
      const analyser = this.audio.createAnalyser();
      analyser.fftSize = 512;
      this.audio.createMediaStreamSource(this.stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const loop = () => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        this.opts.onLevel?.(Math.min(1, Math.sqrt(sum / buf.length) * 5));
        this.frame = requestAnimationFrame(loop);
      };
      loop();
    } catch {
      // Sin nivel: la grabación sigue igual.
    }
  }

  private release(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    for (const off of this.cleanup.splice(0)) off();
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    void this.audio?.close().catch(() => undefined);
    this.audio = null;
    void this.wake?.release().catch(() => undefined);
    this.wake = null;
  }
}
