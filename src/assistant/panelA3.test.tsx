// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import type { PartialBlock } from '@blocknote/core';
import { NodeSelection } from '@tiptap/pm/state';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { mountEditor, posOf, unmountAll, view, type Editor } from '../ui/collabHarness';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { AssistantPanel } from './AssistantPanel';
import { closeAssistant, closeAssistantSettings, openAssistantSettings, openCaption, registerAssistantTarget, type AssistantEditor } from './assistantUi';
import { captionImage } from './captionImage';
import { closeAssistantDb, saveSettings } from './keyStore';
import { inlinePhotoRef } from './photoRef';

// *Suggest caption* en el panel (Docs/Doc_Asistente.md, entrega A3; sección 14, prueba de aceptación de A3) con el editor
// real y un proveedor simulado: el aviso antes de mandar la foto (sin decir que sí no sale nada), lo que se manda (la
// foto y nada de la página), la vista previa que se puede retocar, *Apply* como un deshacer, *Try again* sin volver a
// preguntar, la foto borrada mientras pensaba, un modelo que no mira fotos, sin Editar y la política del dueño.
//
// La foto achicada (captionImage.ts) se reemplaza por una fija: jsdom no tiene canvas. Lo que hace de verdad se prueba
// en captionImage.test.ts y en el recorrido en Chromium.

vi.mock('./captionImage', async (original) => ({
  ...(await original<typeof import('./captionImage')>()),
  captionImage: vi.fn(async () => ({ mime: 'image/jpeg', data: 'RkFLRS1KUEVH', bytes: 9, width: 1024, height: 768 })),
}));

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

const KEY = 'sk-ant-api03-PANEL-A3-secreta-77777';
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

function services(d: Device, client: unknown = { auth: {} }, email = 'lega@wanka.tv'): Services {
  const config = { url: 'https://znlvpuddswymxpffgvbz.supabase.co', publishableKey: 'sb_publishable_test', name: 'Wanka', localKey: WANKA_LOCAL_KEY, storage: legacyStorageNames(WANKA_LOCAL_KEY) };
  return {
    workspace: { config, client },
    client,
    user: { id: d.remote.userId, email },
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

/**
 * Un `fetch` de proveedor simulado (Anthropic) que contesta por partes y anota los pedidos. `before` corre mientras
 * "piensa"; con `status`, contesta ese error con `answer` como mensaje.
 */
function provider(answer: string | (() => string), opts: { status?: number; before?: () => void } = {}) {
  const calls: { url: string; body: string }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const body = String(init.body ?? '');
    calls.push({ url: String(input), body });
    opts.before?.();
    const text = typeof answer === 'string' ? answer : answer();
    if (opts.status) return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: text } }), { status: opts.status });
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 1300 } } },
      ...text.match(/[\s\S]{1,7}/g)!.map((t) => ({ type: 'content_block_delta', delta: { type: 'text_delta', text: t } })),
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } },
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
  /** El permiso de editar que ve el panel (el editor sigue editable: lo cambia otro, como un permiso que se pierde). */
  editable: { current: boolean };
}

const text = (t: string) => ({ type: 'text', text: t, styles: {} });
const BLOCKS = [
  { id: 'p', type: 'paragraph', content: 'Presupuesto reservado del cliente' },
  { id: 'f', type: 'paragraph', content: [{ type: 'photo', props: { url: 'sdmedia://0f8fad5b-d9cb-469f-a165-708677289501', name: 'IMG_4521.HEIC', w: 0.5 } }] },
  {
    id: 't',
    type: 'table',
    content: { type: 'tableContent', rows: [{ cells: [[text('Plano')], [{ type: 'photo', props: { url: 'sdmedia://0f8fad5b-d9cb-469f-a165-708677289502', name: 'celda.jpg', w: 0 } }]] }] },
  },
  { id: 'r', type: 'paragraph', content: 'Medir el set' },
];

async function setup(opts: { editable?: boolean; client?: unknown } = {}): Promise<Setup> {
  const server = new FakeServer();
  const device = await makeDevice(server);
  devices.push(device);
  const pageId = await device.tree.create(null, 'Reporte del rodaje');
  await device.engine.syncNow();
  await saveSettings('lega@wanka.tv', { provider: 'anthropic', model: 'claude-haiku-4-5', models: [] }, KEY);
  const doc = await device.docs.open(pageId, { seed: true });
  const ed = mountEditor(doc);
  ed.replaceBlocks(ed.document, BLOCKS as PartialBlock[]);
  const editable = { current: opts.editable ?? true };
  offTargets.push(registerAssistantTarget({ pageId, view: () => view(ed), editable: () => editable.current, editor: () => ed as unknown as AssistantEditor }));
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
  return { host, ed, device, pageId, editable };
}

const button = (host: HTMLElement, label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;

async function click(el: HTMLElement | undefined) {
  if (!el) throw new Error('no button');
  await act(async () => {
    el.click();
  });
  await wait(60);
}

async function until(host: HTMLElement, label: string) {
  for (let i = 0; i < 40 && !button(host, label) && !host.querySelector('.assistant-error'); i++) await wait(30);
}

async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function type(el: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** La posición de la primera foto en línea del bloque. */
function photoPos(ed: Editor, id: string): number {
  const start = posOf(ed, id);
  let at = -1;
  view(ed).state.doc.nodeAt(start)!.firstChild!.descendants((node, offset) => {
    if (at < 0 && node.type.name === 'photo') at = start + 2 + offset;
    return at < 0;
  });
  return at;
}

function selectPhoto(ed: Editor, id: string) {
  const v = view(ed);
  v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, photoPos(ed, id))));
}

/** Lo que hace el botón de la barra de la foto: abre el panel con el pedido de esa foto. */
async function fromPhotoBar(ed: Editor, id: string) {
  await act(async () => {
    openCaption(inlinePhotoRef(view(ed).state.doc, photoPos(ed, id))!);
  });
  await wait(60);
}

const textOf = (ed: Editor, id: string) => ((ed.getBlock(id)?.content ?? []) as { text?: string }[]).map((c) => c.text ?? '').join('');
const after = (ed: Editor, id: string) => ed.document[ed.document.findIndex((b) => b.id === id) + 1];
const field = (host: HTMLElement) => host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Caption"]');

describe('el panel, entrega A3 (Suggest caption)', () => {
  it('desde la barra de la foto: pregunta antes de mandar, manda solo la foto, la vista previa se retoca y Apply la pone debajo (un deshacer)', async () => {
    const { host, ed } = await setup();
    const { calls } = provider('"Claqueta de la escena 12, toma 4, con lente 35 mm"');
    await fromPhotoBar(ed, 'f');
    // Sin decir que sí, no sale nada.
    expect(host.textContent).toContain('Send this photo to Anthropic?');
    expect(host.textContent).toContain('never the original');
    expect(calls).toHaveLength(0);
    await choose(host.querySelector<HTMLSelectElement>('select[aria-label="Caption language"]')!, 'es');
    await click(button(host, 'Send photo'));
    await until(host, 'Apply');
    expect(calls).toHaveLength(1);
    const sent = JSON.parse(calls[0].body);
    expect(sent.messages[0].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'RkFLRS1KUEVH' } });
    expect(sent.system).toContain('Write the caption in Spanish.');
    // Nada de la página, ni el nombre del archivo, ni su dirección, ni el workspace, ni el correo, ni la clave.
    for (const secret of ['Presupuesto', 'Medir el set', 'IMG_4521', 'sdmedia', '0f8fad5b', 'Wanka', 'lega@wanka.tv', 'Reporte del rodaje', KEY])
      expect(calls[0].body).not.toContain(secret);
    expect(host.textContent).toContain('Sent 1024 × 768 px');
    // La vista previa: el pie limpio, en un campo que se puede retocar.
    expect(field(host)?.value).toBe('Claqueta de la escena 12, toma 4, con lente 35 mm');
    expect(host.textContent).toContain('as a new line under the photo');
    await type(field(host)!, 'Claqueta: escena 12, toma 4 (35 mm)');
    await click(button(host, 'Apply'));
    const added = after(ed, 'f');
    expect(added.type).toBe('paragraph');
    expect(textOf(ed, added.id)).toBe('Claqueta: escena 12, toma 4 (35 mm)');
    expect(host.textContent).toContain('Caption added. Undo it with Ctrl+Z.');
    ed.undo();
    expect(after(ed, 'f').id).toBe('t');
  });

  it('desde la lista del panel: toma la foto elegida; sin una foto elegida lo dice; Cancel no manda nada', async () => {
    const { host, ed } = await setup();
    const { calls } = provider('Pie');
    await click(button(host, 'Suggest caption'));
    expect(host.textContent).toContain('Select a photo first');
    selectPhoto(ed, 't');
    await click(button(host, 'Suggest caption'));
    expect(host.textContent).toContain('Send this photo to Anthropic?');
    await click(button(host, 'Cancel'));
    expect(calls).toHaveLength(0);
    expect(button(host, 'Fix spelling & grammar')).toBeTruthy();
  });

  it('una foto en una celda: el pie va en la misma celda; Try again vuelve a pedir sin volver a preguntar', async () => {
    const { host, ed } = await setup();
    let n = 0;
    const { calls } = provider(() => (++n === 1 ? 'Primer pie' : 'Marcadores de tracking en el piso'));
    vi.mocked(captionImage).mockClear();
    selectPhoto(ed, 't');
    await click(button(host, 'Suggest caption'));
    await click(button(host, 'Send photo'));
    await until(host, 'Apply');
    expect(host.textContent).toContain('in the same cell');
    await click(button(host, 'Try again'));
    await until(host, 'Apply');
    for (let i = 0; i < 20 && field(host)?.value !== 'Marcadores de tracking en el piso'; i++) await wait(30);
    expect(calls).toHaveLength(2);
    expect(host.textContent).not.toContain('Send this photo to');
    // La foto se preparó una sola vez: Try again manda la misma.
    expect(captionImage).toHaveBeenCalledTimes(1);
    expect(field(host)?.value).toBe('Marcadores de tracking en el piso');
    await click(button(host, 'Apply'));
    const table = ed.getBlock('t') as unknown as { content: { rows: { cells: { content: { type: string; text?: string }[] }[] }[] } };
    const cell = table.content.rows[0].cells[1].content;
    expect(cell.map((c) => c.type)).toEqual(['photo', 'text']);
    expect(cell[1].text).toBe('\nMarcadores de tracking en el piso');
  });

  it('la foto se borró mientras el modelo pensaba: no aplica nada y lo dice', async () => {
    const { host, ed } = await setup();
    provider('Un pie', {
      before: () => {
        const v = view(ed);
        const at = photoPos(ed, 'f');
        v.dispatch(v.state.tr.delete(at, at + 1));
      },
    });
    await fromPhotoBar(ed, 'f');
    await click(button(host, 'Send photo'));
    await until(host, 'Apply');
    const before = ed.document.map((b) => b.id).join();
    await click(button(host, 'Apply'));
    expect(host.querySelector('.assistant-error')?.textContent).toContain('removed or replaced while the assistant was working');
    expect(ed.document.map((b) => b.id).join()).toBe(before);
  });

  it('un modelo que no mira fotos: lo dice con lo que hay que hacer', async () => {
    const { host, ed } = await setup();
    provider('This model does not support image input.', { status: 400 });
    await fromPhotoBar(ed, 'f');
    await click(button(host, 'Send photo'));
    await until(host, 'Back');
    expect(host.querySelector('.assistant-error')?.textContent).toBe("This model can't look at photos. Choose another one in the assistant settings.");
  });

  it('sin Editar, o con el asistente apagado por el dueño: no se puede mandar la foto', async () => {
    const ro = await setup({ editable: false });
    const { calls } = provider('Pie');
    expect(button(ro.host, 'Suggest caption')?.disabled).toBe(true);
    await fromPhotoBar(ro.ed, 'f');
    expect(button(ro.host, 'Send photo')?.disabled).toBe(true);
    for (const r of roots.splice(0)) act(() => r.unmount());
    for (const off of offTargets.splice(0)) off();
    closeAssistant();
    const client = { auth: {}, from: () => ({ select: () => ({ maybeSingle: async () => ({ data: { assistant_policy: 'off' }, error: null }) }) }) };
    const off = await setup({ client });
    await fromPhotoBar(off.ed, 'f');
    expect(off.host.textContent).toContain('turned the assistant off');
    expect(button(off.host, 'Send photo')?.disabled).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('cambiar de proveedor en los ajustes vuelve a preguntar: Try again no manda la foto al nuevo (auditoría B-1)', async () => {
    const { host, ed } = await setup();
    // Con el primero (Anthropic) el modelo no mira fotos.
    const { calls } = provider('This model does not support image input.', { status: 400 });
    await fromPhotoBar(ed, 'f');
    await click(button(host, 'Send photo'));
    await until(host, 'Back');
    expect(button(host, 'Try again')).toBeTruthy();
    // La persona elige OpenAI en los ajustes y los cierra.
    await saveSettings('lega@wanka.tv', { provider: 'openai', model: 'gpt-5.4-mini', models: [] }, 'sk-proj-OTRA-clave-1234567890');
    await act(async () => {
      openAssistantSettings();
    });
    await act(async () => {
      closeAssistantSettings();
    });
    await wait(150);
    // Vuelve a preguntar, ahora por OpenAI, y nada salió hacia OpenAI.
    expect(host.textContent).toContain('Send this photo to OpenAI?');
    if (button(host, 'Try again')) await click(button(host, 'Try again'));
    expect(calls.filter((c) => c.url.includes('openai.com'))).toHaveLength(0);
    expect(calls).toHaveLength(1);
  });

  it('lo mismo desde la vista previa: otra dirección del mismo servicio compatible vuelve a preguntar', async () => {
    const { host, ed } = await setup();
    const { calls } = provider('Un pie');
    // Un modelo local en la máquina.
    await saveSettings('lega@wanka.tv', { provider: 'compatible', baseUrl: 'http://localhost:11434/v1', model: 'llava', models: [] });
    await act(async () => {
      openAssistantSettings();
    });
    await act(async () => {
      closeAssistantSettings();
    });
    await wait(150);
    await fromPhotoBar(ed, 'f');
    expect(host.textContent).toContain('Send this photo to localhost:11434?');
    await click(button(host, 'Send photo'));
    await until(host, 'Apply');
    await saveSettings('lega@wanka.tv', { provider: 'compatible', baseUrl: 'https://openrouter.ai/api/v1', model: 'x/y', models: [] }, 'sk-or-OTRA-clave-1234567890');
    await act(async () => {
      openAssistantSettings();
    });
    await act(async () => {
      closeAssistantSettings();
    });
    await wait(150);
    expect(host.textContent).toContain('Send this photo to openrouter.ai?');
    expect(button(host, 'Try again')).toBeUndefined();
    expect(calls.filter((c) => c.url.includes('openrouter.ai'))).toHaveLength(0);
    expect(calls.every((c) => c.url.startsWith('http://localhost:11434/'))).toBe(true);
  });

  it('Apply vuelve a mirar el permiso: si se perdió mientras se veía la vista previa, no aplica', async () => {
    const { host, ed, editable } = await setup();
    provider('Un pie');
    await fromPhotoBar(ed, 'f');
    await click(button(host, 'Send photo'));
    await until(host, 'Apply');
    const before = ed.document.map((b) => b.id).join();
    // El permiso se pierde (el botón ya estaba dibujado y habilitado).
    editable.current = false;
    await click(button(host, 'Apply'));
    expect(host.querySelector('.assistant-error')?.textContent).toContain('You can view this page but not edit it');
    expect(ed.document.map((b) => b.id).join()).toBe(before);
  });
});
