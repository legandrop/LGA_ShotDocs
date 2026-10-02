// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../assistant/providers';
import { closeAssistantDb, saveSettings } from '../assistant/keyStore';
import { closeDictationDb } from './dictationDb';
import { TextSelection } from '@tiptap/pm/state';
import { unmountAll, view } from '../ui/collabHarness';
import { cellText, mapOf, reportEditor, targetBy } from './fixtures/report';
import { addNote, claimNote, getNote, listNotes, markRecording, putChunk, readChunks, recoverRecordings, TAB_ID, updateNote } from './queue';
import { insertAtCursor } from './caretInsert';
import { NoteRecorder, pickMime, type RecorderEnv, type RecordingStore } from './recorder';
import { baseMime, encodeWav, extensionOf, geminiMime, isFormatError, transcribe, voiceHints } from './transcribe';
import { queueRecordingStore, transcribeNote, transcribePending } from './voiceQueue';
import { forgetVoiceKey, readVoiceKey, resolveVoice, saveVoiceSettings } from './voiceSettings';

// El micrófono propio (Docs/Doc_Dictado.md, entrega V3; pruebas 10.1.8, 10.1.9 y parte de 10.1.7): grabar por pedazos
// con el primer pedazo confirmado antes de *Recording* (C5), los cortes, el tope; los adaptadores de transcripción con
// sus formatos y el plan B a WAV (C4); la segunda clave de *Voice*; y la transcripción de la cola, que nunca borra.

const EMAIL = 'lega@wanka.tv';
const WS = 'wanka';
const OPENAI_KEY = 'sk-proj-VOZ-secreta-123456789';

afterEach(async () => {
  unmountAll();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await closeDictationDb();
  await closeAssistantDb();
  indexedDB.deleteDatabase('shotdocs-dictation');
  indexedDB.deleteDatabase('shotdocs-assistant');
});

// --- Un MediaRecorder y un micrófono simulados -------------------------------------------------------------------------

class FakeTrack extends EventTarget {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}

function fakeStream() {
  const track = new FakeTrack();
  return { track, stream: { getTracks: () => [track] } as unknown as MediaStream };
}

class FakeRecorder extends EventTarget {
  static last: FakeRecorder | null = null;
  static supported = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  static isTypeSupported = (t: string) => FakeRecorder.supported.includes(t);
  state: 'inactive' | 'recording' = 'inactive';
  timeslice = 0;
  mimeType: string;
  constructor(_s: MediaStream, opts?: { mimeType?: string }) {
    super();
    this.mimeType = opts?.mimeType ?? '';
    FakeRecorder.last = this;
  }
  start(timeslice: number) {
    this.timeslice = timeslice;
    this.state = 'recording';
  }
  /** Llega un pedazo. */
  emit(text: string) {
    const e = new Event('dataavailable') as Event & { data: Blob };
    e.data = new Blob([text], { type: this.mimeType });
    this.dispatchEvent(e);
  }
  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.emit('fin');
    this.dispatchEvent(new Event('stop'));
  }
}

function env(over: Partial<RecorderEnv> = {}) {
  const { track, stream } = fakeStream();
  let now = 1_000_000;
  const e: Partial<RecorderEnv> = {
    getUserMedia: async () => stream,
    MediaRecorder: FakeRecorder as unknown as typeof MediaRecorder,
    now: () => now,
    wakeLock: null,
    vibrate: null,
    AudioContext: null,
    ...over,
  };
  return { env: e, track, advance: (ms: number) => (now += ms) };
}

function memoryStore(opts: { failFirst?: boolean; holdFirst?: Promise<void> } = {}) {
  const log: string[] = [];
  const chunks: string[] = [];
  const store: RecordingStore = {
    create: async (mime) => {
      log.push(`create ${mime}`);
      return 'n:1';
    },
    chunk: async (_id, seq, data) => {
      if (seq === 0 && opts.holdFirst) await opts.holdFirst;
      if (seq === 0 && opts.failFirst) throw new DOMException('lleno', 'QuotaExceededError');
      chunks[seq] = await data.text();
      log.push(`chunk ${seq}`);
    },
    progress: async () => undefined,
    finish: async (_id, n) => void log.push(`finish ${n}`),
    abandon: async () => void log.push('abandon'),
  };
  return { store, log, chunks };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('grabar (C5)', () => {
  it('Recording recién con el primer pedazo confirmado en el dispositivo; los pedazos de 1 s se guardan y Stop cierra la nota', async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    const m = memoryStore({ holdFirst: hold });
    const { env: e, track } = env();
    const states: string[] = [];
    const r = new NoteRecorder({ store: m.store, env: e, onState: (s) => states.push(s) });
    await r.start();
    expect(FakeRecorder.last!.timeslice).toBe(1000);
    expect(m.log[0]).toBe('create audio/webm;codecs=opus');
    expect(r.state).toBe('starting');
    FakeRecorder.last!.emit('uno');
    await flush();
    // El primer pedazo todavía no se confirmó: no dice Recording.
    expect(r.state).toBe('starting');
    release();
    await flush();
    await flush();
    expect(r.state).toBe('recording');
    FakeRecorder.last!.emit('dos');
    const result = await r.stop();
    expect(m.chunks).toEqual(['uno', 'dos', 'fin']);
    expect(m.log.at(-1)).toBe('finish 3');
    expect(await result.data.text()).toBe('unodosfin');
    expect(result.reason).toBe('user');
    expect(track.stopped).toBe(true);
    expect(states).toEqual(['starting', 'recording', 'stopping', 'done']);
  });

  it('si el primer pedazo no se puede guardar, avisa y no graba (la nota vacía se saca)', async () => {
    const m = memoryStore({ failFirst: true });
    const { env: e, track } = env();
    const errors: (string | undefined)[] = [];
    const r = new NoteRecorder({ store: m.store, env: e, onState: (s, err) => s === 'error' && errors.push(err) });
    await r.start();
    FakeRecorder.last!.emit('uno');
    await flush();
    await flush();
    expect(errors).toEqual(['storage']);
    expect(m.log).toContain('abandon');
    expect(m.log).not.toContain('finish 1');
    expect(track.stopped).toBe(true);
  });

  it('un corte (la pista terminó, la página se cierra) guarda lo grabado hasta ahí', async () => {
    for (const cut of ['ended', 'pagehide'] as const) {
      const m = memoryStore();
      const { env: e, track } = env();
      const auto: string[] = [];
      const r = new NoteRecorder({ store: m.store, env: e, onAutoStop: (res) => auto.push(res.reason) });
      await r.start();
      FakeRecorder.last!.emit('uno');
      FakeRecorder.last!.emit('dos');
      if (cut === 'ended') track.dispatchEvent(new Event('ended'));
      else window.dispatchEvent(new Event('pagehide'));
      const res = await r.stop();
      expect(res.reason).toBe('cut');
      expect(auto).toEqual(['cut']);
      expect(m.log.at(-1)).toBe('finish 3');
    }
  });

  it('el tope de 2 minutos corta solo', async () => {
    vi.useFakeTimers();
    const m = memoryStore();
    const { env: e, advance } = env();
    const auto: string[] = [];
    const r = new NoteRecorder({ store: m.store, env: e, maxMs: 120_000, onAutoStop: (res) => auto.push(res.reason) });
    await r.start();
    FakeRecorder.last!.emit('uno');
    advance(119_000);
    await vi.advanceTimersByTimeAsync(300);
    expect(auto).toEqual([]);
    advance(1_500);
    await vi.advanceTimersByTimeAsync(300);
    await vi.runAllTimersAsync();
    expect(auto).toEqual(['cap']);
  });

  it('sin permiso del micrófono: denied; sin micrófono: noMic; sin MediaRecorder: unsupported', async () => {
    const errs: (string | undefined)[] = [];
    const deny = env({ getUserMedia: async () => Promise.reject(new DOMException('no', 'NotAllowedError')) });
    await new NoteRecorder({ store: null, env: deny.env, onState: (s, e) => s === 'error' && errs.push(e) }).start();
    const none = env({ getUserMedia: async () => Promise.reject(new DOMException('no', 'NotFoundError')) });
    await new NoteRecorder({ store: null, env: none.env, onState: (s, e) => s === 'error' && errs.push(e) }).start();
    const old = env({ MediaRecorder: undefined });
    await new NoteRecorder({ store: null, env: old.env, onState: (s, e) => s === 'error' && errs.push(e) }).start();
    expect(errs).toEqual(['denied', 'noMic', 'unsupported']);
  });

  it('el formato: WebM/Opus si se puede, si no mp4 (C4)', () => {
    expect(pickMime({ isTypeSupported: (t) => t.startsWith('audio/webm') })).toBe('audio/webm;codecs=opus');
    expect(pickMime({ isTypeSupported: (t) => t === 'audio/mp4' })).toBe('audio/mp4');
    expect(pickMime({ isTypeSupported: () => false })).toBe('');
  });
});

// --- Transcribir -----------------------------------------------------------------------------------------------------

type Call = { url: string; init: RequestInit };

function stubFetch(...answers: (Response | Error)[]) {
  const calls: Call[] = [];
  const fetcher = vi.fn(async (url: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const a = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (a instanceof Error) throw a;
    return a.clone();
  });
  return { calls, fetcher: fetcher as unknown as typeof fetch };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('transcribir (10.1.9, C4)', () => {
  const audio = (mime = 'audio/webm;codecs=opus') => ({ data: new Blob(['OggS-falso'], { type: mime }), mime });

  it('OpenAI: multipart con el archivo y su extensión, el modelo y las pistas', async () => {
    const f = stubFetch(json({ text: ' este plano con un 50 mm ' }));
    const out = await transcribe({ provider: 'openai', model: 'gpt-4o-mini-transcribe', source: 'own' }, OPENAI_KEY, audio(), ['T-stop', 'Lens · Filters'], { fetcher: f.fetcher });
    expect(out).toEqual({ text: 'este plano con un 50 mm', wav: false });
    expect(f.calls[0].url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect((f.calls[0].init.headers as Record<string, string>).authorization).toBe(`Bearer ${OPENAI_KEY}`);
    const form = f.calls[0].init.body as FormData;
    expect((form.get('file') as File).name).toBe('note.webm');
    expect((form.get('file') as File).type).toBe('audio/webm');
    expect(form.get('model')).toBe('gpt-4o-mini-transcribe');
    expect(String(form.get('prompt'))).toContain('Spanish and English');
    expect(String(form.get('prompt'))).toContain('Lens · Filters');
  });

  it('Gemini: el audio en base64 adentro del pedido y el mp4 como audio/m4a', async () => {
    const f = stubFetch(json({ candidates: [{ content: { parts: [{ text: 'hicimos clean plate' }] } }] }));
    const out = await transcribe({ provider: 'gemini', model: 'gemini-2.5-flash-lite', source: 'assistant' }, 'AIzaFALSA-clave-gemini-0000', audio('audio/mp4'), ['HDRI'], { fetcher: f.fetcher });
    expect(out.text).toBe('hicimos clean plate');
    expect(f.calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent');
    expect((f.calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe('AIzaFALSA-clave-gemini-0000');
    const body = JSON.parse(String(f.calls[0].init.body));
    const part = body.contents[0].parts[1].inline_data;
    expect(part.mime_type).toBe('audio/m4a');
    expect(atob(part.data)).toBe('OggS-falso');
    expect(body.contents[0].parts[0].text).toContain('HDRI');
  });

  it('compatible: su dirección y, sin clave (un servidor local), sin Authorization', async () => {
    const f = stubFetch(json({ text: 'ok' }));
    await transcribe({ provider: 'compatible', baseUrl: 'http://127.0.0.1:8000/v1/', model: 'whisper-1', source: 'own' }, '', audio(), [], { fetcher: f.fetcher });
    expect(f.calls[0].url).toBe('http://127.0.0.1:8000/v1/audio/transcriptions');
    expect(f.calls[0].init.headers).toEqual({});
  });

  it('plan B: si el proveedor rechaza el formato, una vez más como WAV', async () => {
    const f = stubFetch(json({ error: { message: 'Invalid file format. Supported formats: [flac, m4a, mp3, mp4, ...]' } }, 400), json({ text: 'ahora sí' }));
    const toWav = vi.fn(async () => new Blob(['RIFF'], { type: 'audio/wav' }));
    const out = await transcribe({ provider: 'openai', model: 'whisper-1', source: 'own' }, OPENAI_KEY, audio('audio/mp4'), [], { fetcher: f.fetcher, toWav });
    expect(out).toEqual({ text: 'ahora sí', wav: true });
    expect(toWav).toHaveBeenCalledTimes(1);
    expect(((f.calls[0].init.body as FormData).get('file') as File).name).toBe('note.mp4');
    expect(((f.calls[1].init.body as FormData).get('file') as File).name).toBe('note.wav');
    // Otro 400 (no de formato) no pasa por el plan B.
    const g = stubFetch(json({ error: { message: 'model not allowed' } }, 400));
    await expect(transcribe({ provider: 'openai', model: 'x', source: 'own' }, OPENAI_KEY, audio(), [], { fetcher: g.fetcher, toWav })).rejects.toBeInstanceOf(ProviderError);
    expect(toWav).toHaveBeenCalledTimes(1);
  });

  it('errores: 401, 413, 429 y sin red; la clave nunca en el mensaje', async () => {
    const cases: [Response | Error, string][] = [
      [json({ error: { message: `Incorrect API key provided: ${OPENAI_KEY}` } }, 401), 'auth'],
      [json({ error: { message: 'Maximum content size limit exceeded' } }, 413), 'badRequest'],
      [new Response('{}', { status: 429, headers: { 'retry-after': '7' } }), 'rateLimit'],
      [new TypeError('Failed to fetch'), 'network'],
    ];
    for (const [answer, kind] of cases) {
      const f = stubFetch(answer);
      const err = await transcribe({ provider: 'openai', model: 'x', source: 'own' }, OPENAI_KEY, audio(), [], { fetcher: f.fetcher }).catch((e: unknown) => e);
      expect((err as ProviderError).kind).toBe(kind);
      expect(String((err as Error).message)).not.toContain(OPENAI_KEY);
    }
  });

  it('formatos, WAV y pistas', () => {
    expect(extensionOf('audio/mp4;codecs=opus')).toBe('mp4');
    expect(extensionOf('audio/webm;codecs=opus')).toBe('webm');
    expect(baseMime('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(geminiMime('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(isFormatError(new ProviderError('badRequest', 'Invalid file format.'))).toBe(true);
    const wav = encodeWav(new Float32Array([0, 1, -1]), 16000);
    expect(wav.size).toBe(44 + 6);
    expect(wav.type).toBe('audio/wav');
    const hints = voiceHints(null);
    expect(hints).toContain('clean plate');
    expect(hints.join(', ').length).toBeLessThanOrEqual(700);
  });
});

// --- Voice: la segunda clave ---------------------------------------------------------------------------------------

describe('Voice (la segunda clave)', () => {
  it('con el asistente en OpenAI usa esa clave; con Anthropic, nada hasta guardar una clave propia, cifrada', async () => {
    await saveSettings(EMAIL, { provider: 'openai', model: 'gpt-5.4-mini', models: [] }, OPENAI_KEY);
    expect(await resolveVoice(EMAIL)).toEqual({ provider: 'openai', baseUrl: undefined, model: 'gpt-4o-mini-transcribe', source: 'assistant' });
    expect(await readVoiceKey(EMAIL, (await resolveVoice(EMAIL))!)).toBe(OPENAI_KEY);

    await saveSettings(EMAIL, { provider: 'anthropic', model: 'claude-haiku-4-5', models: [] }, 'sk-ant-api03-OTRA');
    expect(await resolveVoice(EMAIL)).toBeNull();
    await saveVoiceSettings(EMAIL, { source: 'own', provider: 'gemini', model: '' }, 'AIzaSEGUNDA-clave-de-voz-0000');
    const v = await resolveVoice(EMAIL);
    expect(v).toEqual({ provider: 'gemini', baseUrl: undefined, model: 'gemini-2.5-flash-lite', source: 'own' });
    expect(await readVoiceKey(EMAIL, v!)).toBe('AIzaSEGUNDA-clave-de-voz-0000');
    // Guardada cifrada: el texto de la clave no está en la base.
    const raw = JSON.stringify(await new Promise((res) => {
      const req = indexedDB.open('shotdocs-dictation');
      req.onsuccess = () => {
        const tx = req.result.transaction('notes').objectStore('notes').getAll();
        tx.onsuccess = () => {
          res(tx.result.map((r: Record<string, unknown>) => ({ ...r, cipher: r.cipher ? new TextDecoder().decode(r.cipher as ArrayBuffer) : null })));
          req.result.close();
        };
      };
    }));
    expect(raw).not.toContain('SEGUNDA');
    // Cambiar de proveedor sin pegar otra clave la saca (nunca va a otro destino).
    await saveVoiceSettings(EMAIL, { source: 'own', provider: 'openai', model: '' });
    expect(await resolveVoice(EMAIL)).toBeNull();
    await forgetVoiceKey(EMAIL);
    expect(await resolveVoice(EMAIL)).toBeNull();
  });
});

// --- La cola con audio -----------------------------------------------------------------------------------------------

describe('la cola con audio (V3)', () => {
  async function audioNote(text = '') {
    const n = await addNote({ email: EMAIL, workspace: WS, pageId: 'p1', pageTitle: 'Día 06', text, state: 'saved', audio: { mime: 'audio/webm', chunks: 2, durationMs: 2000 } });
    await putChunk(n.id, 0, new Blob(['uno']));
    await putChunk(n.id, 1, new Blob(['dos']));
    return n;
  }
  const policy = (p: string) => ({ from: () => ({ select: () => ({ maybeSingle: async () => ({ data: { assistant_policy: p }, error: null }) }) }) });

  it('se transcribe y queda lista con su texto; la grabación sigue hasta que la persona la resuelve', async () => {
    await saveSettings(EMAIL, { provider: 'openai', model: 'gpt-5.4-mini', models: [] }, OPENAI_KEY);
    const n = await audioNote();
    const f = stubFetch(json({ text: 'llovió a la tarde' }));
    const out = await transcribeNote(n.id, { email: EMAIL, client: policy('on'), workspaceKey: WS, transcribeOptions: { fetcher: f.fetcher } });
    expect(out).toMatchObject({ state: 'ready', text: 'llovió a la tarde' });
    expect(((f.calls[0].init.body as FormData).get('file') as File).size).toBe(6);
    expect(await readChunks(n.id)).toHaveLength(2);
  });

  it('la política en Off al volver la red: no manda nada y la nota queda', async () => {
    await saveSettings(EMAIL, { provider: 'openai', model: 'gpt-5.4-mini', models: [] }, OPENAI_KEY);
    const n = await audioNote();
    const f = stubFetch(json({ text: 'x' }));
    expect(await transcribeNote(n.id, { email: EMAIL, client: policy('off'), workspaceKey: WS, transcribeOptions: { fetcher: f.fetcher } })).toBe('policy');
    expect(await transcribePending(WS, { email: EMAIL, client: policy('local_only'), workspaceKey: WS, transcribeOptions: { fetcher: f.fetcher } })).toBe(0);
    expect(f.calls).toHaveLength(0);
    expect(await getNote(n.id)).toMatchObject({ state: 'saved' });
  });

  it('un error del proveedor la deja en failed con el error (sin la clave); sin red, saved; nunca se borra', async () => {
    await saveSettings(EMAIL, { provider: 'openai', model: 'gpt-5.4-mini', models: [] }, OPENAI_KEY);
    const n = await audioNote();
    const bad = stubFetch(json({ error: { message: `bad key ${OPENAI_KEY}` } }, 401));
    const out = await transcribeNote(n.id, { email: EMAIL, client: policy('on'), workspaceKey: WS, transcribeOptions: { fetcher: bad.fetcher } });
    expect(out).toMatchObject({ state: 'failed' });
    expect(JSON.stringify(out)).not.toContain(OPENAI_KEY);
    const down = stubFetch(new TypeError('Failed to fetch'));
    expect(await transcribeNote(n.id, { email: EMAIL, client: policy('on'), workspaceKey: WS, transcribeOptions: { fetcher: down.fetcher } })).toMatchObject({ state: 'saved' });
    const empty = stubFetch(json({ text: '  ' }));
    expect(await transcribeNote(n.id, { email: EMAIL, client: policy('on'), workspaceKey: WS, transcribeOptions: { fetcher: empty.fetcher } })).toMatchObject({ state: 'failed', error: 'nothing' });
    expect(await listNotes(EMAIL, WS)).toHaveLength(1);
    expect(await readChunks(n.id)).toHaveLength(2);
    // Sin red avisada: no se intenta.
    expect(await transcribeNote(n.id, { email: EMAIL, client: policy('on'), workspaceKey: WS, online: false })).toBe('offline');
  });

  it('una grabación cortada (la página murió grabando) queda saved con lo guardado; sin ningún pedazo, failed; nunca se borra', async () => {
    const store = queueRecordingStore({ email: EMAIL, workspace: WS, pageId: 'p1', pageTitle: 'Día 06' });
    const a = await store.create('audio/webm');
    await store.chunk(a, 0, new Blob(['uno']));
    const b = await store.create('audio/mp4');
    // La pestaña que grababa ya no existe.
    markRecording(a, false);
    markRecording(b, false);
    const list = await listNotes(EMAIL, WS);
    expect(await recoverRecordings(list, Date.now())).toBe(false);
    expect(await recoverRecordings(list, Date.now() + 10_000)).toBe(true);
    expect(await getNote(a)).toMatchObject({ state: 'saved', audio: { chunks: 1 } });
    expect(await getNote(b)).toMatchObject({ state: 'failed', error: 'empty' });
    expect(await listNotes(EMAIL, WS)).toHaveLength(2);
  });
});

// --- Correcciones de la auditoría de V2/V3 (O1, O2, O4) -------------------------------------------------------------

describe('correcciones de la auditoría', () => {
  const policyOn = { from: () => ({ select: () => ({ maybeSingle: async () => ({ data: { assistant_policy: 'on' }, error: null }) }) }) };
  async function audioNote() {
    const n = await addNote({ email: EMAIL, workspace: WS, pageId: 'p1', pageTitle: 'Día 06', text: '', state: 'saved', audio: { mime: 'audio/webm', chunks: 1, durationMs: 1000 } });
    await putChunk(n.id, 0, new Blob(['uno']));
    return n;
  }

  it('O1: con otra pestaña transcribiéndola, esta no la manda; un reclamo vencido sí se puede tomar', async () => {
    await saveSettings(EMAIL, { provider: 'openai', model: 'gpt-5.4-mini', models: [] }, OPENAI_KEY);
    const n = await audioNote();
    expect(await claimNote(n.id, 'otra-pestaña')).toMatchObject({ claim: { by: 'otra-pestaña' } });
    const f = stubFetch(json({ text: 'segunda' }));
    expect(await transcribeNote(n.id, { email: EMAIL, client: policyOn, workspaceKey: WS, transcribeOptions: { fetcher: f.fetcher } })).toBe('busy');
    expect(f.calls).toHaveLength(0);
    // La otra pestaña murió: el reclamo vence y esta la toma.
    expect(await claimNote(n.id, TAB_ID, Date.now() + 120_000)).toMatchObject({ claim: { by: TAB_ID } });
  });

  it('O1: lo que llega de una transcripción nunca pisa una corrección hecha mientras tanto', async () => {
    await saveSettings(EMAIL, { provider: 'openai', model: 'gpt-5.4-mini', models: [] }, OPENAI_KEY);
    const n = await audioNote();
    const fetcher = (async () => {
      // Mientras transcribe, otra pestaña ya la transcribió y la persona la corrigió.
      await updateNote(n.id, { state: 'ready', text: 'corregida a mano' });
      return json({ text: 'lo que llegó tarde' });
    }) as unknown as typeof fetch;
    const out = await transcribeNote(n.id, { email: EMAIL, client: policyOn, workspaceKey: WS, transcribeOptions: { fetcher } });
    expect(out).toMatchObject({ state: 'ready', text: 'corregida a mano' });
    expect((await getNote(n.id))?.text).toBe('corregida a mano');
  });

  it('A11: una nota ya transcrita (quizás corregida) no se vuelve a mandar', async () => {
    await saveSettings(EMAIL, { provider: 'openai', model: 'gpt-5.4-mini', models: [] }, OPENAI_KEY);
    const n = await audioNote();
    await updateNote(n.id, { state: 'ready', text: 'corregida' });
    const f = stubFetch(json({ text: 'otra' }));
    expect(await transcribeNote(n.id, { email: EMAIL, client: policyOn, workspaceKey: WS, transcribeOptions: { fetcher: f.fetcher } })).toBe('notAudio');
    expect(await transcribePending(WS, { email: EMAIL, client: policyOn, workspaceKey: WS, transcribeOptions: { fetcher: f.fetcher } })).toBe(0);
    expect(f.calls).toHaveLength(0);
    expect((await getNote(n.id))?.text).toBe('corregida');
  });

  it('A7: la segunda clave de un compatible no va a otra dirección', async () => {
    await saveVoiceSettings(EMAIL, { source: 'own', provider: 'compatible', baseUrl: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3' }, 'gsk_CLAVE-DE-GROQ-0000');
    const v = (await resolveVoice(EMAIL))!;
    expect(await readVoiceKey(EMAIL, v)).toBe('gsk_CLAVE-DE-GROQ-0000');
    expect(await readVoiceKey(EMAIL, { ...v, baseUrl: 'https://otro-servidor.example/v1' })).toBe('');
    expect(await readVoiceKey(EMAIL, { ...v, provider: 'openai', baseUrl: undefined })).toBe('');
  });

  it('A12: las pistas llevan los rótulos de la página, nunca el texto de las celdas', () => {
    const hints = voiceHints(mapOf(reportEditor()));
    expect(hints).toContain('Location');
    expect(hints).toContain('Lens · Filters (ND, diffusion, pola)');
    expect(hints.join(' | ')).not.toContain('Nave 2');
    expect(hints.join(' | ')).not.toContain('A001C003');
  });

  it('A2 y A3: los pedazos actualizan la nota y la pestaña que graba no da por cortada su propia grabación', async () => {
    const store = queueRecordingStore({ email: EMAIL, workspace: WS, pageId: 'p1', pageTitle: 'Día 06' });
    const id = await store.create('audio/webm');
    await store.chunk(id, 0, new Blob(['uno']));
    await store.progress(id, 1, 1000);
    expect(await getNote(id)).toMatchObject({ state: 'recording', audio: { chunks: 1, durationMs: 1000 } });
    expect(await recoverRecordings(await listNotes(EMAIL, WS), Date.now() + 60_000)).toBe(false);
    expect(await getNote(id)).toMatchObject({ state: 'recording' });
    await store.finish(id, 1, 1000);
    expect(await getNote(id)).toMatchObject({ state: 'saved' });
  });

  it('A10: si el primer pedazo no se puede guardar en la cola, no queda ninguna nota vacía', async () => {
    const realPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if ((value as { kind?: string })?.kind === 'chunk') throw new DOMException('lleno', 'QuotaExceededError');
      return realPut.call(this, value, key);
    });
    const { env: e } = env();
    const errors: (string | undefined)[] = [];
    const r = new NoteRecorder({ store: queueRecordingStore({ email: EMAIL, workspace: WS, pageId: 'p1', pageTitle: 'x' }), env: e, onState: (s, err) => s === 'error' && errors.push(err) });
    await r.start();
    FakeRecorder.last!.emit('uno');
    for (let i = 0; i < 20 && errors.length === 0; i++) await new Promise((res) => setTimeout(res, 10));
    await new Promise((res) => setTimeout(res, 30));
    expect(errors).toEqual(['storage']);
    expect(await listNotes(EMAIL, WS)).toEqual([]);
  });

  it('O2: Insert at cursor no borra lo elegido: lo dictado va después', () => {
    const field = document.createElement('textarea');
    field.value = 'Nave 2 norte';
    document.body.append(field);
    expect(insertAtCursor('galpón B', { el: field, start: 7, end: 12 }, null, false)).toBe(true);
    expect(field.value).toBe('Nave 2 norte galpón B');
    field.remove();
    // En la página: «2» elegido en la celda de Location.
    const ed = reportEditor();
    const loc = targetBy(mapOf(ed), (t) => t.rowLabel === 'Location' && t.col === 2);
    const v = view(ed);
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, loc.start + 5, loc.start + 6)));
    expect(insertAtCursor('norte', null, v, true)).toBe(true);
    expect(cellText(ed, 1, 3, 2)).toBe('Nave 2 norte');
  });
});
