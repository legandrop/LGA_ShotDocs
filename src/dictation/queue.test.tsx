// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import type { PartialBlock } from '@blocknote/core';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { settled } from '../test/settle';
import { navigate, pagePath } from '../router';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { mountEditor, undoManager, unmountAll, view, type Editor } from '../ui/collabHarness';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { closeAssistant, registerAssistantTarget, type AssistantEditor } from '../assistant/assistantUi';
import { closeAssistantDb, saveSettings } from '../assistant/keyStore';
import { DictationHost } from './DictationHost';
import { DictationPanel, DOUBLE_TAP_MS, forgetRecent } from './DictationPanel';
import { closeDictation, dictationOpen, requestQueuedNote } from './dictationUi';
import { closeDictationDb, loadDraft } from './drafts';
import { answer, cellText, cursorAt, mapOf, reportBlocks } from './fixtures/report';
import { addNote, getNote, listNotes, putChunk, readChunks, removeNote, restoreNote, updateNote } from './queue';
import { VoiceNotesNotice } from './VoiceNotes';

// La cola de notas sin red (Docs/Doc_Dictado.md, 8; entrega V2; prueba 10.1.7): guardar sin red, recargar, volver la
// red, ubicar de a una con su vista previa, *Insert as text*, *Discard* con confirmación, una nota de una página que ya
// no se ve, la política al volver la red, y que nada se borra sin una de esas acciones.

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

// El rato pedido y, después, a que termine lo que quedó en marcha (src/test/settle.ts).
const wait = (ms = 20) => act(() => settled(ms));

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

/** Un proveedor simulado (Anthropic) que contesta siempre lo mismo y anota los pedidos. */
function provider(text: string) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push(String(init.body ?? input));
      const events = [
        { type: 'message_start', message: { usage: { input_tokens: 2100 } } },
        ...text.match(/[\s\S]{1,9}/g)!.map((t) => ({ type: 'content_block_delta', delta: { type: 'text_delta', text: t } })),
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 140 } },
        { type: 'message_stop' },
      ];
      return new Response(events.map((e) => `data: ${JSON.stringify(e)}`).join('\n\n') + '\n\n', { status: 200 });
    }),
  );
  return calls;
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

async function type(host: HTMLElement, text: string) {
  const field = host.querySelector<HTMLTextAreaElement>('.dictation-panel textarea')!;
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    set.call(field, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await wait(30);
}

const LENS = { op: 'setCell', at: 'T3 r3 c3', row: '12 · 010 · 3', col: 'Lens · Filters (ND, diffusion, pola)', old: '', new: '50 mm' };
const notes = () => listNotes(EMAIL, WS);

describe('la cola en el dispositivo', () => {
  it('guarda, lista por persona y workspace, cambia, vuelve a poner y saca solo con removeNote (con su grabación)', async () => {
    const a = await addNote({ email: ' Lega@Wanka.tv ', workspace: WS, pageId: 'p1', pageTitle: 'Día 06', text: 'llovió a la tarde' });
    await new Promise((r) => setTimeout(r, 5));
    const b = await addNote({ email: EMAIL, workspace: WS, pageId: 'p2', pageTitle: 'Día 07', text: '', state: 'saved', audio: { mime: 'audio/webm', chunks: 2, durationMs: 2000 } });
    await addNote({ email: 'otra@test', workspace: WS, pageId: 'p1', pageTitle: 'x', text: 'de otra persona' });
    await addNote({ email: EMAIL, workspace: 'otro-ws', pageId: 'p1', pageTitle: 'x', text: 'de otro workspace' });
    await putChunk(b.id, 1, new Blob(['dos']));
    await putChunk(b.id, 0, new Blob(['uno']));
    expect((await notes()).map((n) => n.id)).toEqual([a.id, b.id]);
    expect(a.email).toBe(EMAIL);
    // Los pedazos de la grabación no aparecen como notas, y se leen en orden.
    expect((await readChunks(b.id)).map((x) => new TextDecoder().decode(x))).toEqual(['uno', 'dos']);
    expect((await updateNote(b.id, { state: 'ready', text: 'transcrita' }))?.text).toBe('transcrita');
    expect(await updateNote('n:no-existe', { text: 'x' })).toBeNull();
    await removeNote(b.id);
    expect(await readChunks(b.id)).toEqual([]);
    expect((await notes()).map((n) => n.id)).toEqual([a.id]);
    await restoreNote(a);
    expect(await getNote(a.id)).toMatchObject({ text: 'llovió a la tarde' });
  });
});

describe('Save for later y la lista (V2)', () => {
  it('sin red: dos notas con Save for later; recargar; volver la red; ubicar una con vista previa y pegar la otra como texto', async () => {
    const s = await setup({ offline: true });
    expect(panel(s.host).textContent).toContain('Placing a note needs internet.');
    await type(s.host, 'este plano se filmó con un 50 mm');
    await click(button(s.host, 'Save for later'));
    await until(() => !s.host.querySelector<HTMLTextAreaElement>('.dictation-panel textarea')?.value);
    expect(panel(s.host).textContent).toContain("Saved. It will be placed when you're back online");
    await type(s.host, 'llovió a la tarde');
    await click(button(s.host, 'Save for later'));
    await until(() => !s.host.querySelector<HTMLTextAreaElement>('.dictation-panel textarea')?.value);
    expect((await notes()).map((n) => n.text)).toEqual(['este plano se filmó con un 50 mm', 'llovió a la tarde']);
    // El campo quedó vacío y su borrador también (la nota vive en la cola, no en dos lugares).
    await wait(400);
    expect((await loadDraft(EMAIL, WS, s.pageId))?.text ?? '').toBe('');
    // El aviso del indicador de sincronización y la lista de la hoja.
    await until(() => !!button(s.host, '2 voice notes to place'));
    expect(button(s.host, '2 voice notes to place')).toBeTruthy();
    expect(s.host.querySelector('.dictation-saved')?.textContent).toContain('“llovió a la tarde”');

    // Cerrar la app y abrirla: siguen.
    await closeDictationDb();
    await s.remount();
    expect(s.host.querySelectorAll('.dictation-saved li')).toHaveLength(2);

    // Vuelve la red: se ubica la primera, de a una y con su vista previa.
    await s.setOnline(true);
    cursorAt(s.ed, mapOf(s.ed).targets.get('T3 r3 c1')!);
    const calls = provider(answer([LENS]));
    await click(button(s.host.querySelector('.dictation-saved')!, 'Open'));
    expect(s.host.querySelector('.dictation-queued')?.textContent).toContain('“este plano se filmó con un 50 mm”');
    // Nada se manda solo al abrirla.
    expect(calls).toHaveLength(0);
    await click(button(s.host, 'Place'));
    await until(() => !!button(s.host, 'Apply'));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('este plano se filmó con un 50 mm');
    expect(cellText(s.ed, 3, 3, 3)).toBe('');
    await click(button(s.host, 'Apply'));
    expect(cellText(s.ed, 3, 3, 3)).toBe('50 mm');
    await until(() => !!button(s.host, '1 voice note to place'));
    // Salió de la cola recién con la nota guardada en el borrador de la página (Your note).
    expect((await notes()).map((n) => n.text)).toEqual(['llovió a la tarde']);
    expect((await loadDraft(EMAIL, WS, s.pageId))?.applied).toBe('este plano se filmó con un 50 mm');

    // Undo: se saca de la página y la nota vuelve a la cola.
    await wait(DOUBLE_TAP_MS);
    await click(button(s.host, 'Undo'));
    expect(cellText(s.ed, 3, 3, 3)).toBe('');
    await until(() => !!button(s.host, '2 voice notes to place'));
    expect((await notes()).map((n) => n.text).sort()).toEqual(['este plano se filmó con un 50 mm', 'llovió a la tarde']);
    expect(s.host.querySelector('.dictation-queued')?.textContent).toContain('este plano se filmó con un 50 mm');
    await click(button(s.host, 'Back'));

    // La segunda, como texto al final de la página.
    const second = [...s.host.querySelectorAll('.dictation-saved li')].find((li) => li.textContent?.includes('llovió'))!;
    await click(button(second, 'Open'));
    await click(button(s.host, 'Insert as text'));
    expect(panel(s.host).textContent).toContain('Added at the end of the page.');
    const last = s.ed.document[s.ed.document.length - 1] as { content?: { text?: string }[] };
    expect(last.content?.map((c) => c.text).join('')).toBe('llovió a la tarde');
    await until(() => !!button(s.host, '1 voice note to place'));
    expect((await notes()).map((n) => n.text)).toEqual(['este plano se filmó con un 50 mm']);
  });

  it('Discard pide confirmación: Keep la deja y Discard la saca; sin una acción, nada se borra', async () => {
    const s = await setup();
    const n = await addNote({ email: EMAIL, workspace: WS, pageId: s.pageId, pageTitle: 'Día 06', text: 'clean plate del 010' });
    await wait(100);
    await click(button(s.host.querySelector('.dictation-saved')!, 'Open'));
    await click(button(s.host.querySelector('.dictation-queued')!, 'Discard'));
    expect(s.host.querySelector('[role=alertdialog]')?.textContent).toContain("Discard this saved note? It can't be undone.");
    await click(button(s.host.querySelector('[role=alertdialog]')!, 'Keep'));
    expect(await getNote(n.id)).toBeTruthy();
    // Cerrar la hoja, recargar, volver a abrir: sigue.
    await closeDictationDb();
    await s.remount();
    expect(await getNote(n.id)).toBeTruthy();
    await click(button(s.host.querySelector('.dictation-saved')!, 'Open'));
    await click(button(s.host.querySelector('.dictation-queued')!, 'Discard'));
    await click(button(s.host.querySelector('[role=alertdialog]')!, 'Discard'));
    await until(() => !s.host.querySelector('.sync-voice'));
    expect(await getNote(n.id)).toBeNull();
  });

  it('si la cola no la puede guardar, el campo queda como estaba', async () => {
    const s = await setup({ offline: true });
    await type(s.host, 'una nota que no se puede guardar');
    // La base del dispositivo falla al escribir.
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('lleno', 'QuotaExceededError');
    });
    await click(button(s.host, 'Save for later'));
    await wait(100);
    put.mockRestore();
    expect(s.host.querySelector<HTMLTextAreaElement>('.dictation-panel textarea')!.value).toBe('una nota que no se puede guardar');
    expect(panel(s.host).textContent).toContain("The note couldn't be saved on this device. It's still in the field.");
    expect(await notes()).toEqual([]);
  });

  it('la política en Off al volver la red: no manda nada, la nota queda; Insert as text sí (no sale del dispositivo)', async () => {
    const client = { auth: {}, from: () => ({ select: () => ({ maybeSingle: async () => ({ data: { assistant_policy: 'off' }, error: null }) }) }) };
    const calls = provider(answer([LENS]));
    const s = await setup({ client });
    const n = await addNote({ email: EMAIL, workspace: WS, pageId: s.pageId, pageTitle: 'Día 06', text: 'hicimos HDRI' });
    await wait(100);
    await click(button(s.host.querySelector('.dictation-saved')!, 'Open'));
    expect(button(s.host, 'Place')?.disabled).toBe(true);
    await act(async () => {
      s.host.querySelector('.dictation-panel')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, metaKey: true, bubbles: true }));
    });
    await wait(60);
    expect(calls).toHaveLength(0);
    expect(await getNote(n.id)).toBeTruthy();
    expect(button(s.host, 'Insert as text')?.disabled).toBe(false);
  });

  it('si Insert as text no pudo escribir en la página, la nota sigue en la cola', async () => {
    const s = await setup();
    const n = await addNote({ email: EMAIL, workspace: WS, pageId: s.pageId, pageTitle: 'Día 06', text: 'clean plate y HDRI' });
    await wait(100);
    await click(button(s.host.querySelector('.dictation-saved')!, 'Open'));
    // El editor dejó de aceptar cambios (por ejemplo, la página pasó a solo lectura) después de abrir la nota.
    act(() => {
      (s.ed as unknown as { isEditable: boolean }).isEditable = false;
    });
    await click(button(s.host, 'Insert as text'));
    expect(panel(s.host).textContent).toContain("It couldn't be added to the page. It's still here.");
    expect(await getNote(n.id)).toBeTruthy();
    expect(s.host.querySelector('.dictation-queued')).toBeTruthy();
  });

  it('sin Editar: Insert as text apagado; Copy y Discard sí', async () => {
    const s = await setup({ editable: false });
    await addNote({ email: EMAIL, workspace: WS, pageId: s.pageId, pageTitle: 'Día 06', text: 'T2.8 a tres metros' });
    await wait(100);
    await click(button(s.host.querySelector('.dictation-saved')!, 'Open'));
    expect(button(s.host, 'Insert as text')?.disabled).toBe(true);
    expect(button(s.host, 'Copy')?.disabled).toBe(false);
    expect(button(s.host.querySelector('.dictation-queued')!, 'Discard')?.disabled).toBe(false);
  });
});

describe('el aviso en el indicador de sincronización (V2)', () => {
  it('cuenta las notas, las lista y abre cada una en su página; la de una página que ya no está, solo Copy y Discard', async () => {
    const s = await setup({ host: true });
    await addNote({ email: EMAIL, workspace: WS, pageId: s.pageId, pageTitle: '2026-10-02 | Day 06', text: 'llovió a la tarde' });
    await addNote({ email: EMAIL, workspace: WS, pageId: 'p-borrada', pageTitle: 'Día viejo', text: 'nota de una página que ya no está' });
    await until(() => !!button(s.host, '2 voice notes to place'));
    await click(button(s.host, '2 voice notes to place'));
    const items = [...s.host.querySelectorAll('.voice-notes li')];
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('2026-10-02 | Day 06');
    expect(button(items[0], 'Open')).toBeTruthy();
    expect(items[1].textContent).toContain('Día viejo (not available)');
    expect(button(items[1], 'Open')).toBeUndefined();
    expect(button(items[1], 'Copy text')).toBeTruthy();
    // Discard desde la lista también pregunta.
    await click(button(items[1], 'Discard'));
    expect(s.host.querySelector('.voice-notes [role=alertdialog]')?.textContent).toContain("Discard this note? It can't be undone.");
    await click(button(s.host.querySelector('.voice-notes [role=alertdialog]')!, 'Keep'));
    expect(await notes()).toHaveLength(2);
    // Open: la hoja se abre en su página con la nota cargada.
    await click(button(s.host.querySelectorAll('.voice-notes li')[0], 'Open'));
    await until(() => !!s.host.querySelector('.dictation-queued'));
    expect(dictationOpen()).toBe(true);
    expect(s.host.querySelector('.dictation-queued')?.textContent).toContain('llovió a la tarde');
  });

  it('el pedido de abrir una nota espera a que el editor de su página se anote', async () => {
    const s = await setup({ host: true });
    const n = await addNote({ email: EMAIL, workspace: WS, pageId: 'p-otra', pageTitle: 'Otra', text: 'x' });
    await act(async () => requestQueuedNote('p-otra', n.id));
    await wait(60);
    expect(dictationOpen()).toBe(false);
    expect(s.host.querySelector('.dictation-queued')).toBeNull();
  });
});
