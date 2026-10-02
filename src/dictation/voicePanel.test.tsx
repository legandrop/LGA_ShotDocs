// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import type { PartialBlock } from '@blocknote/core';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { navigate, pagePath } from '../router';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { mountEditor, undoManager, unmountAll, view, type Editor } from '../ui/collabHarness';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { closeAssistant, registerAssistantTarget, type AssistantEditor } from '../assistant/assistantUi';
import { closeAssistantDb, saveSettings } from '../assistant/keyStore';
import { DictationHost } from './DictationHost';
import { DictationPanel, forgetRecent } from './DictationPanel';
import { closeDictation } from './dictationUi';
import { closeDictationDb } from './drafts';
import { answer, cellText, cursorAt, mapOf, reportBlocks } from './fixtures/report';
import { addNote, getNote, listNotes, readChunks } from './queue';
import { VoiceNotesNotice } from './VoiceNotes';
import { saveVoiceSettings } from './voiceSettings';

// El micrófono propio en la hoja (Docs/Doc_Dictado.md, entrega V3; pruebas 10.1.8 y 10.2 con un MediaRecorder
// simulado): R1 sin el teclado (grabar, cortar, transcribir, ubicar), sin red (se guarda sin preguntar y se transcribe al
// volver), *Insert at cursor* en un comentario y en la página, y el micrófono sin clave de voz.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as never;
});

const KEY = 'sk-ant-api03-COLA-secreta-55555';
const EMAIL = 'lega@wanka.tv';
const WS = WANKA_LOCAL_KEY;
const roots: Root[] = [];
const devices: Device[] = [];
const offs: (() => void)[] = [];

afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const off of offs.splice(0)) off();
  closeAssistant();
  closeDictation();
  forgetRecent();
  unmountAll();
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  await closeAssistantDb();
  await closeDictationDb();
  indexedDB.deleteDatabase('shotdocs-assistant');
  indexedDB.deleteDatabase('shotdocs-dictation');
  vi.unstubAllGlobals();
  localStorage.clear();
  document.body.innerHTML = '';
  navigate('/', true);
});

const wait = (ms = 20) => act(async () => new Promise((r) => setTimeout(r, ms)));

function services(d: Device, client: unknown = { auth: {} }): Services {
  const config = { url: 'https://znlvpuddswymxpffgvbz.supabase.co', publishableKey: 'sb_publishable_test', name: 'Wanka', localKey: WS, storage: legacyStorageNames(WS) };
  return {
    workspace: { config, client },
    client,
    user: { id: d.remote.userId, email: EMAIL },
    db: d.db,
    tree: d.tree,
    docs: d.docs,
    files: d.files,
    media: d.media,
    engine: d.engine,
    access: d.access,
    remote: d.remote as unknown as SupabaseRemote,
    dbName: 'test',
    mediaDb: d.mediaDb,
    comments: d.comments,
    commentsDb: d.commentsDb,
    sizes: d.sizes,
    offline: d.offline,
    shutdown: async () => undefined,
  } as Services;
}

interface Setup {
  host: HTMLElement;
  ed: Editor;
  device: Device;
  server: FakeServer;
  pageId: string;
  setOnline: (on: boolean) => Promise<void>;
  remount: () => Promise<void>;
}

async function setup(opts: { offline?: boolean; editable?: boolean; client?: unknown; host?: boolean } = {}): Promise<Setup> {
  const server = new FakeServer();
  const device = await makeDevice(server);
  devices.push(device);
  const pageId = await device.tree.create(null, '2026-10-02 | Day 06');
  await device.engine.syncNow();
  const setOnline = async (on: boolean) => {
    server.online = on;
    await act(async () => {
      await device.engine.syncNow().catch(() => undefined);
    });
    await wait(40);
  };
  if (opts.offline) await setOnline(false);
  await saveSettings(EMAIL, { provider: 'anthropic', model: 'claude-haiku-4-5', models: [] }, KEY);
  const ed = mountEditor(await device.docs.open(pageId, { seed: true }));
  ed.replaceBlocks(ed.document, reportBlocks() as PartialBlock[]);
  undoManager(ed).stopCapturing();
  offs.push(registerAssistantTarget({ pageId, view: () => view(ed), editable: () => opts.editable ?? true, editor: () => ed as unknown as AssistantEditor }));
  navigate(pagePath(pageId), true);
  const host = document.createElement('div');
  document.body.append(host);
  const mount = async () => {
    const root = createRoot(host);
    roots.push(root);
    act(() =>
      root.render(
        <ServicesContext.Provider value={services(device, opts.client)}>
          {opts.host ? <DictationHost /> : <DictationPanel pageId={pageId} />}
          <VoiceNotesNotice />
        </ServicesContext.Provider>,
      ),
    );
    await wait(100);
  };
  await mount();
  return {
    host,
    ed,
    device,
    server,
    pageId,
    setOnline,
    remount: async () => {
      for (const r of roots.splice(0)) act(() => r.unmount());
      await mount();
    },
  };
}

const button = (host: ParentNode, text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
const panel = (host: HTMLElement) => host.querySelector<HTMLElement>('.dictation-panel')!;

async function click(el: HTMLElement | undefined | null) {
  if (!el) throw new Error('no está');
  await act(async () => {
    el.click();
  });
  await wait(60);
}

async function until(test: () => boolean) {
  for (let i = 0; i < 80 && !test(); i++) await wait(30);
}

const LENS = { op: 'setCell', at: 'T3 r3 c3', row: '12 · 010 · 3', col: 'Lens · Filters (ND, diffusion, pola)', old: '', new: '50 mm' };
const notes = () => listNotes(EMAIL, WS);

// --- El micrófono propio en la hoja (V3) ------------------------------------------------------------------------------

class FakeRecorder extends EventTarget {
  static last: FakeRecorder | null = null;
  static isTypeSupported = (t: string) => t.startsWith('audio/webm');
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  constructor(_s: MediaStream, opts?: { mimeType?: string }) {
    super();
    this.mimeType = opts?.mimeType ?? 'audio/webm';
    FakeRecorder.last = this;
  }
  start() {
    this.state = 'recording';
  }
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

/** El micrófono simulado del navegador. */
function fakeMic() {
  FakeRecorder.last = null;
  const track = Object.assign(new EventTarget(), { stop: () => undefined });
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [track] }) } });
}

/** El proveedor simulado: la transcripción (OpenAI) y la ubicación (Anthropic). */
function voiceProvider(transcript: string, placeAnswer: string) {
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, body: init.body });
      if (url.endsWith('/audio/transcriptions')) return new Response(JSON.stringify({ text: transcript }), { status: 200 });
      const events = [
        { type: 'message_start', message: { usage: { input_tokens: 2100 } } },
        ...placeAnswer.match(/[\s\S]{1,9}/g)!.map((t) => ({ type: 'content_block_delta', delta: { type: 'text_delta', text: t } })),
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 140 } },
        { type: 'message_stop' },
      ];
      return new Response(events.map((e) => `data: ${JSON.stringify(e)}`).join('\n\n') + '\n\n', { status: 200 });
    }),
  );
  return calls;
}

const recordButton = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('.dictation-record');

describe('el micrófono propio en la hoja (V3)', () => {
  afterEach(() => {
    delete (navigator as { mediaDevices?: unknown }).mediaDevices;
  });

  it('R1 sin el teclado: grabar, cortar, Transcribing…, la vista previa con lo que se entendió, Apply y la nota sale de la cola', async () => {
    fakeMic();
    const s = await setup();
    await saveVoiceSettings(EMAIL, { source: 'own', provider: 'openai', model: '' }, 'sk-proj-VOZ-0000000000');
    await s.remount();
    cursorAt(s.ed, mapOf(s.ed).targets.get('T3 r3 c1')!);
    const calls = voiceProvider('este plano se filmó con un 50 mm', answer([LENS]));
    await click(recordButton(s.host));
    expect(panel(s.host).textContent).toContain('Getting the microphone…');
    // El primer pedazo confirmado en el dispositivo: recién ahí dice Recording.
    await act(async () => FakeRecorder.last!.emit('uno'));
    await until(() => /Recording · 0:0\d/.test(panel(s.host).textContent ?? ''));
    expect(panel(s.host).textContent).toMatch(/Recording · 0:0\d · tap to stop/);
    const recording = (await notes())[0];
    expect(recording).toMatchObject({ state: 'recording', pageId: s.pageId });
    // A6: la que se está grabando no aparece en las listas ni en el número.
    expect(s.host.querySelector('.dictation-saved')).toBeNull();
    expect(s.host.querySelector('.sync-voice')).toBeNull();
    await click(recordButton(s.host));
    await until(() => !!button(s.host, 'Apply'));
    expect(calls.map((c) => c.url)).toEqual(['https://api.openai.com/v1/audio/transcriptions', 'https://api.anthropic.com/v1/messages']);
    expect(((calls[0].body as FormData).get('file') as File).name).toBe('note.webm');
    expect(String((calls[0].body as FormData).get('prompt'))).toContain('Lens · Filters (ND, diffusion, pola)');
    expect(String(calls[1].body)).toContain('este plano se filmó con un 50 mm');
    expect(panel(s.host).textContent).toContain('“este plano se filmó con un 50 mm”');
    await click(button(s.host, 'Apply'));
    expect(cellText(s.ed, 3, 3, 3)).toBe('50 mm');
    await until(() => !s.host.querySelector('.sync-voice'));
    expect(await notes()).toEqual([]);
  });

  it('sin red: cortar guarda la grabación sin preguntar y no manda nada; al volver la red se transcribe', async () => {
    fakeMic();
    const s = await setup({ offline: true });
    await saveVoiceSettings(EMAIL, { source: 'own', provider: 'openai', model: '' }, 'sk-proj-VOZ-0000000000');
    await s.remount();
    const calls = voiceProvider('llovió a la tarde', answer([]));
    await click(recordButton(s.host));
    await act(async () => FakeRecorder.last!.emit('uno'));
    await until(() => /Recording/.test(panel(s.host).textContent ?? ''));
    await click(recordButton(s.host));
    await until(() => (panel(s.host).textContent ?? '').includes("Saved. It will be transcribed and placed when you're back online."));
    expect(calls).toHaveLength(0);
    const saved = (await notes())[0];
    expect(saved).toMatchObject({ state: 'saved', text: '', audio: { chunks: 2 } });
    expect(await readChunks(saved.id)).toHaveLength(2);
    // Vuelve la red: se abre y se transcribe.
    await s.setOnline(true);
    await click(button(s.host.querySelector('.dictation-saved')!, 'Open'));
    expect(s.host.querySelector('.dictation-queued')?.textContent).toContain('Recording of 0:');
    await click(button(s.host, 'Transcribe'));
    await until(() => calls.length >= 2 || !!s.host.querySelector('.assistant-error'));
    expect(calls[0].url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect((await getNote(saved.id))?.text).toBe('llovió a la tarde');
  });

  it('Insert at cursor: en un comentario (un campo de texto) y en la página, sin abrir el teclado', async () => {
    const s = await setup();
    const comment = document.createElement('textarea');
    comment.value = 'Revisar';
    document.body.append(comment);
    const a = await addNote({ email: EMAIL, workspace: WS, pageId: s.pageId, pageTitle: 'Día 06', text: 'clean plate del 010', audio: { mime: 'audio/webm', chunks: 1, durationMs: 1000 } });
    await wait(100);
    await act(async () => {
      comment.focus();
      comment.setSelectionRange(7, 7);
    });
    await click(button(s.host.querySelector('.dictation-saved')!, 'Open'));
    await click(button(s.host, 'Insert at cursor'));
    expect(comment.value).toBe('Revisar clean plate del 010');
    expect(panel(s.host).textContent).toContain('Inserted at the cursor.');
    expect(await getNote(a.id)).toBeNull();
    // En la página: el cursor en una celda vacía (O2, en la página: con una palabra elegida, se escribe después).
    comment.remove();
    const b = await addNote({ email: EMAIL, workspace: WS, pageId: s.pageId, pageTitle: 'Día 06', text: '35 mm', audio: { mime: 'audio/webm', chunks: 1, durationMs: 1000 } });
    await s.remount();
    cursorAt(s.ed, mapOf(s.ed).targets.get('T3 r3 c3')!);
    await click(button(s.host.querySelector('.dictation-saved')!, 'Open'));
    await click(button(s.host, 'Insert at cursor'));
    expect(cellText(s.ed, 3, 3, 3)).toBe('35 mm');
    expect(await getNote(b.id)).toBeNull();
  });

  it('Insert at cursor sin dónde escribir (la página de solo lectura y ningún campo): lo dice y la nota sigue', async () => {
    const s = await setup({ editable: false });
    const n = await addNote({ email: EMAIL, workspace: WS, pageId: s.pageId, pageTitle: 'Día 06', text: 'HDRI', audio: { mime: 'audio/webm', chunks: 1, durationMs: 1000 } });
    await wait(100);
    await click(button(s.host.querySelector('.dictation-saved')!, 'Open'));
    await click(button(s.host, 'Insert at cursor'));
    expect(panel(s.host).textContent).toContain('Put the cursor where the text goes first');
    expect(await getNote(n.id)).toBeTruthy();
  });

  it('con el asistente en Anthropic y sin clave de voz, el micrófono abre Voice y no graba', async () => {
    fakeMic();
    const s = await setup();
    await until(() => !!recordButton(s.host) && !recordButton(s.host)!.disabled);
    expect(panel(s.host).textContent).toContain("Anthropic doesn't take audio");
    await click(recordButton(s.host));
    expect(document.querySelector('[role=dialog][aria-label=Voice]')).toBeTruthy();
    expect(FakeRecorder.last).toBeNull();
    expect(await notes()).toEqual([]);
  });
});
