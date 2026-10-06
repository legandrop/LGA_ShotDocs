// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import type { PartialBlock } from '@blocknote/core';
import { TextSelection } from '@tiptap/pm/state';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ServicesContext, type Services } from '../services';
import { prefs } from '../prefs';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { mountEditor, posOf, unmountAll, view, type Editor } from '../ui/collabHarness';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { AssistantPanel } from './AssistantPanel';
import { AssistantSettings } from './AssistantSettings';
import { closeAssistant, registerAssistantTarget, type AssistantEditor } from './assistantUi';
import { closeAssistantDb, saveSettings } from './keyStore';
import { TITLE_TOKEN } from './pageActions';

// El panel de la entrega A2 con el editor real y un proveedor simulado (Docs/Doc_Asistente.md, sección 14, prueba de
// aceptación de A2, y pruebas 5, 7, 8 y 9 de la sección 13): *Summarize page* → *Insert at top*; *Translate page* →
// *Replace page content* y *Create translated subpage*; *Format as… Checklist*; sin Editar; la política del dueño; y la
// ventana de la política (dueño y admins).

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

const KEY = 'sk-ant-api03-PANEL-A2-secreta-66666';
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
  prefs.set({ language: 'en' });
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

/** Un `fetch` de proveedor simulado (Anthropic) que contesta por partes y anota los pedidos. */
function provider(answer: string | ((body: { system: string; messages: { content: string }[] }) => string)) {
  const calls: { url: string; body: string }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const body = String(init.body ?? '');
    calls.push({ url: String(input), body });
    const text = typeof answer === 'string' ? answer : answer(JSON.parse(body));
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 900 } } },
      ...text.match(/[\s\S]{1,7}/g)!.map((t) => ({ type: 'content_block_delta', delta: { type: 'text_delta', text: t } })),
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 120 } },
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

const BLOCKS = [
  { id: 'p', type: 'paragraph', content: 'Pedir el LiDAR' },
  { id: 'q', type: 'paragraph', content: 'Fotos de set' },
  { id: 'r', type: 'paragraph', content: 'Medir el set' },
];

async function setup(opts: { editable?: boolean; client?: unknown; blocks?: unknown[] } = {}): Promise<Setup> {
  const server = new FakeServer();
  const device = await makeDevice(server);
  devices.push(device);
  const pageId = await device.tree.create(null, 'Reporte del rodaje');
  await device.engine.syncNow();
  await saveSettings('lega@wanka.tv', { provider: 'anthropic', model: 'claude-haiku-4-5', models: [] }, KEY);
  const doc = await device.docs.open(pageId, { seed: true });
  const ed = mountEditor(doc);
  ed.replaceBlocks(ed.document, (opts.blocks ?? BLOCKS) as PartialBlock[]);
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

async function until(host: HTMLElement, text: string) {
  for (let i = 0; i < 40 && !button(host, text) && !host.querySelector('.assistant-error'); i++) await wait(30);
}

function selectBlocks(ed: Editor, a: string, b: string, end: number) {
  const v = view(ed);
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, posOf(ed, a) + 2, posOf(ed, b) + 2 + end)));
}

const textOf = (ed: Editor, id: string) => ((ed.getBlock(id)?.content ?? []) as { text?: string }[]).map((c) => c.text ?? '').join('');
const shape = (ed: Editor) => ed.document.map((b) => [b.type, ((b.content ?? []) as { text?: string }[]).map((c) => c.text ?? '').join('')]);

async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('el panel, entrega A2', () => {
  it.each(['en', 'es'] as const)('Headings sobre Script (%s): avisa antes de Apply, descartar conserva todo y deshacer restaura el guion exacto', async (language) => {
    prefs.set({ language });
    const formatLabel = language === 'en' ? 'Format as…' : 'Dar forma de…';
    const applyLabel = language === 'en' ? 'Apply' : 'Aplicar';
    const warning = language === 'en'
      ? 'Applying this shape will remove Script formatting. You can undo it after applying.'
      : 'Aplicar esta forma va a quitar el formato Guion. Podés deshacerlo después de aplicar.';
    const { host, ed } = await setup({ blocks: [
      { id: 'p', type: 'paragraph', props: { script: true, textColor: 'blue' }, content: [{ type: 'text', text: 'INT. SET - DÍA', styles: { bold: true } }] },
      { id: 'q', type: 'paragraph', content: 'Medir el set' },
    ] });
    const before = JSON.stringify(ed.document);
    provider('## **INT. SET - DÍA**');
    selectBlocks(ed, 'p', 'p', 13);
    await choose(host.querySelector<HTMLSelectElement>(`select[aria-label="${language === 'en' ? 'Shape' : 'Forma'}"]`)!, 'headings');
    await click(button(host, formatLabel));
    await until(host, applyLabel);
    expect(host.querySelector('.assistant-diff')?.textContent).toContain('INT. SET - DÍA');
    expect(host.querySelector('.assistant-warning')?.textContent).toBe(warning);
    expect(JSON.stringify(ed.document)).toBe(before);
    await click(button(host, language === 'en' ? 'Discard' : 'Descartar'));
    expect(JSON.stringify(ed.document)).toBe(before);
    selectBlocks(ed, 'p', 'p', 13);
    await click(button(host, formatLabel));
    await until(host, applyLabel);
    expect(host.textContent).toContain(warning);
    await click(button(host, applyLabel));
    expect(ed.getBlock('p')?.type).toBe('heading');
    expect((ed.getBlock('p')?.props as Record<string, unknown>).script).not.toBe(true);
    expect(textOf(ed, 'p')).toBe('INT. SET - DÍA');
    expect(textOf(ed, 'q')).toBe('Medir el set');
    ed.undo();
    expect(JSON.stringify(ed.document)).toBe(before);
  });

  it('Summarize page manda el título y la página, muestra el resumen sin pedir nada afuera e Insert at top lo agrega (un deshacer)', async () => {
    const { host, ed } = await setup();
    const { calls, fetcher } = provider('- Hay que pedir el LiDAR\n- Faltan [fotos](https://evil.example) ![x](https://evil.example/a.png)');
    await click(button(host, 'Summarize page'));
    await until(host, 'Insert at top');
    expect(calls).toHaveLength(1);
    const sent = JSON.parse(calls[0].body);
    expect(sent.messages[0].content).toContain(`<user_content>\n${TITLE_TOKEN}Reporte del rodaje\n\nPedir el LiDAR\n\nFotos de set\n\nMedir el set\n</user_content>`);
    for (const secret of ['Wanka', 'lega@wanka.tv', KEY]) expect(calls[0].body).not.toContain(secret);
    // La vista previa: con su forma, sin links ni imágenes de verdad.
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll('.assistant-diff img, .assistant-diff [src], .assistant-diff [href]')).toHaveLength(0);
    expect(host.textContent).toContain('Links added by the assistant were removed.');
    expect(host.querySelector('.assistant-diff')?.textContent).toContain('Hay que pedir el LiDAR');
    await click(button(host, 'Insert at top'));
    expect(shape(ed).slice(0, 3)).toEqual([
      ['bulletListItem', 'Hay que pedir el LiDAR'],
      ['bulletListItem', 'Faltan fotos ![x](https://evil.example/a.png)'],
      ['paragraph', 'Pedir el LiDAR'],
    ]);
    expect(host.textContent).toContain('Added. Undo it with Ctrl+Z.');
    ed.undo();
    expect(ed.document.map((b) => b.id).slice(0, 3)).toEqual(['p', 'q', 'r']);
  });

  it('Translate page → Replace page content: cada bloque traducido en su lugar, con su id', async () => {
    const { host, ed } = await setup();
    const { calls } = provider([`${TITLE_TOKEN}Shoot report`, 'Order the LiDAR', 'Set photos', 'Measure the set'].join('\n\n'));
    await click(button(host, 'Translate page'));
    await until(host, 'Replace page content');
    expect(JSON.parse(calls[0].body).system).toContain('Translate the whole page to English');
    // La vista previa muestra el título y lo traducido.
    expect(host.querySelector('.assistant-diff')?.textContent).toContain('Shoot report');
    await click(button(host, 'Replace page content'));
    expect(ed.document.slice(0, 3).map((b) => [b.id, textOf(ed, b.id)])).toEqual([
      ['p', 'Order the LiDAR'],
      ['q', 'Set photos'],
      ['r', 'Measure the set'],
    ]);
    ed.undo();
    expect(textOf(ed, 'p')).toBe('Pedir el LiDAR');
  });

  it('Translate page → Create translated subpage: una página nueva adentro, con el título traducido y el contenido; esta no cambia', async () => {
    const { host, ed, device, pageId } = await setup();
    provider([`${TITLE_TOKEN}Shoot report`, 'Order the LiDAR', 'Set photos', 'Measure the set'].join('\n\n'));
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Language of the translated page"]')!;
    await choose(select, 'en');
    await click(button(host, 'Translate page'));
    await until(host, 'Create translated subpage');
    await click(button(host, 'Create translated subpage'));
    for (let i = 0; i < 40 && device.tree.children(pageId).length === 0; i++) await wait(30);
    await wait(100);
    const [child] = device.tree.children(pageId);
    expect(child.title).toBe('Shoot report');
    expect(location.pathname).toContain(child.id);
    expect(textOf(ed, 'p')).toBe('Pedir el LiDAR');
    const doc = await device.docs.open(child.id);
    try {
      const sub = mountEditor(doc, 'sub');
      expect(sub.document.slice(0, 3).map((b) => [b.type, textOf(sub, b.id)])).toEqual([
        ['paragraph', 'Order the LiDAR'],
        ['paragraph', 'Set photos'],
        ['paragraph', 'Measure the set'],
      ]);
      expect(sub.document.map((b) => b.id)).not.toContain('p');
    } finally {
      device.docs.close(child.id);
    }
  });

  it('Format as… Checklist sobre tres renglones → vista previa → Ctrl+Enter aplica; avisa lo del historial', async () => {
    const { host, ed } = await setup();
    const { calls } = provider('[ ] Pedir el LiDAR\n[ ] Fotos de set\n[ ] Medir el set');
    selectBlocks(ed, 'p', 'r', 12);
    await choose(host.querySelector<HTMLSelectElement>('select[aria-label="Shape"]')!, 'checklist');
    await click(button(host, 'Format as…'));
    await until(host, 'Apply');
    expect(JSON.parse(calls[0].body).system).toContain('checklist');
    expect(JSON.parse(calls[0].body).messages[0].content).not.toContain('Reporte del rodaje');
    expect(host.textContent).toContain('Edits others make to this text at the same time may only remain in the history.');
    expect(host.querySelector('.assistant-diff')?.textContent).toContain('☐Pedir el LiDAR');
    const panel = host.querySelector<HTMLElement>('.assistant-panel')!;
    await act(async () => {
      panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    });
    expect(ed.document.slice(0, 3).map((b) => [b.id, b.type])).toEqual([
      ['p', 'checkListItem'],
      ['q', 'checkListItem'],
      ['r', 'checkListItem'],
    ]);
    ed.undo();
    expect(ed.document.slice(0, 3).map((b) => b.type)).toEqual(['paragraph', 'paragraph', 'paragraph']);
  });

  it('B1: Format as… que deja afuera un renglón no ofrece Apply y dice qué falta; si agrega palabras, las marca y avisa', async () => {
    const { host, ed } = await setup();
    provider('[ ] Pedir el LiDAR\n[ ] Medir el set');
    selectBlocks(ed, 'p', 'r', 12);
    await choose(host.querySelector<HTMLSelectElement>('select[aria-label="Shape"]')!, 'checklist');
    await click(button(host, 'Format as…'));
    for (let i = 0; i < 40 && !host.querySelector('.assistant-error'); i++) await wait(30);
    expect(host.textContent).toContain('The suggestion leaves out text that was selected (“Fotos”, “de”, “set”).');
    expect(button(host, 'Apply')).toBeUndefined();
    expect(button(host, 'Copy')).toBeDefined();
    expect(ed.document.slice(0, 3).map((b) => b.type)).toEqual(['paragraph', 'paragraph', 'paragraph']);
    await click(button(host, 'Back'));
    provider('[ ] Pedir el LiDAR\n[ ] Fotos de set\n[ ] Medir el set\n[ ] Pagar 5000 USD');
    selectBlocks(ed, 'p', 'r', 12);
    await click(button(host, 'Format as…'));
    await until(host, 'Apply');
    expect(host.textContent).toContain("The suggestion adds words that weren't in the selection (underlined).");
    expect([...host.querySelectorAll('.assistant-diff ins')].map((x) => x.textContent)).toEqual(['Pagar', '5000', 'USD']);
  });

  it('sin Editar: Format as… apagado; Summarize page y Translate page se piden pero solo se copian', async () => {
    const { host } = await setup({ editable: false });
    expect(button(host, 'Format as…')?.disabled).toBe(true);
    expect(button(host, 'Summarize page')?.disabled).toBe(false);
    provider('- uno');
    await click(button(host, 'Summarize page'));
    await until(host, 'Insert at top');
    expect(button(host, 'Insert at top')?.disabled).toBe(true);
    expect(button(host, 'Insert below')?.disabled).toBe(true);
    expect(button(host, 'Copy')?.disabled).toBe(false);
    await click(button(host, 'Discard'));
    provider([`${TITLE_TOKEN}Shoot report`, 'Order the LiDAR', 'Set photos', 'Measure the set'].join('\n\n'));
    await click(button(host, 'Translate page'));
    await until(host, 'Replace page content');
    expect(button(host, 'Replace page content')?.disabled).toBe(true);
    expect(button(host, 'Create translated subpage')?.disabled).toBe(true);
  });

  it('con la política en Off, las acciones de la página también se apagan', async () => {
    const client = { auth: {}, from: () => ({ select: () => ({ maybeSingle: async () => ({ data: { assistant_policy: 'off' }, error: null }) }) }) };
    const { host } = await setup({ client });
    expect(host.textContent).toContain('The owner of this workspace turned the assistant off.');
    for (const name of ['Summarize page', 'Translate page', 'Format as…']) expect(button(host, name)?.disabled, name).toBe(true);
  });

  it('una respuesta de Translate page sin el título o con otros bloques no se aplica (se puede copiar)', async () => {
    const { host } = await setup();
    provider('Order the LiDAR\n\nSet photos');
    await click(button(host, 'Translate page'));
    for (let i = 0; i < 40 && !host.querySelector('.assistant-error'); i++) await wait(30);
    expect(host.textContent).toContain('The suggestion changed how the text is split into paragraphs.');
    expect(button(host, 'Replace page content')).toBeUndefined();
    expect(button(host, 'Copy')).toBeDefined();
  });
});

// --- La ventana de la política del workspace ----------------------------------------------------------------------

async function settingsFor(role: 'owner' | 'admin' | 'member' | 'guest', rpc: (fn: string, args: unknown) => Promise<{ data: unknown; error: unknown }>) {
  const server = new FakeServer();
  server.enableTeam();
  const uid = role === 'owner' ? undefined : `u-${role}`;
  if (uid) server.addMember(uid, role, `${role}@test`);
  const device = await makeDevice(server, crypto.randomUUID(), '0.021', {}, undefined, uid ? { id: uid, email: `${role}@test` } : {});
  devices.push(device);
  await device.engine.syncNow();
  const client = {
    auth: {},
    rpc: vi.fn(rpc),
    from: () => ({ select: () => ({ maybeSingle: async () => ({ data: { assistant_policy: 'on' }, error: null }) }) }),
  };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <ServicesContext.Provider value={services(device, client, `${role}@test`)}>
        <AssistantSettings />
      </ServicesContext.Provider>,
    ),
  );
  await wait(120);
  return { host, client };
}

const radio = (host: HTMLElement, value: string) => host.querySelector<HTMLInputElement>(`input[type=radio][value="${value}"]`);

describe('la política del workspace en los ajustes (A2)', () => {
  it('el dueño la ve y elegir Off la guarda en la base (set_assistant_policy) para todos', async () => {
    const { host, client } = await settingsFor('owner', async () => ({ data: 'off', error: null }));
    expect(host.textContent).toContain('This workspace');
    expect(host.textContent).toContain("It's a rule of the app, not a barrier");
    expect(radio(host, 'on')?.checked).toBe(true);
    await act(async () => {
      radio(host, 'off')!.click();
    });
    await wait(60);
    expect(client.rpc).toHaveBeenCalledWith('set_assistant_policy', { p_policy: 'off' });
    expect(radio(host, 'off')?.checked).toBe(true);
    expect(host.textContent).toContain('Saved for everyone in this workspace.');
    // Queda recordada en este dispositivo (para el panel sin red).
    expect(Object.values({ ...localStorage })).toContain('off');
  });

  it('un admin también; si la base dice que no, lo dice y no cambia', async () => {
    const { host, client } = await settingsFor('admin', async () => ({ data: null, error: { code: '42501', message: 'not_allowed' } }));
    expect(host.textContent).toContain('This workspace');
    await act(async () => {
      radio(host, 'local_only')!.click();
    });
    await wait(60);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Only the owner and the admins can change this.');
    expect(radio(host, 'on')?.checked).toBe(true);
  });

  it('una base sin la función lo explica', async () => {
    const { host } = await settingsFor('owner', async () => ({ data: null, error: { code: 'PGRST202', message: 'not found' } }));
    await act(async () => {
      radio(host, 'off')!.click();
    });
    await wait(60);
    expect(host.textContent).toContain("This workspace's database needs an update");
  });

  it('un miembro o un invitado no la ven', async () => {
    for (const role of ['member', 'guest'] as const) {
      const { host, client } = await settingsFor(role, async () => ({ data: null, error: null }));
      expect(host.textContent, role).not.toContain('This workspace');
      expect(radio(host, 'off'), role).toBeNull();
      expect(client.rpc).not.toHaveBeenCalled();
      for (const r of roots.splice(0)) act(() => r.unmount());
    }
  });
});
