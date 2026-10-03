// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import type { PartialBlock } from '@blocknote/core';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as Y from 'yjs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { ORIGIN_REPLACE } from '../sync/docs';
import { builtinBlocks } from '../templates/builtin';
import { mountEditor, pmFromY, undoManager, unmountAll, view, yText, type Editor } from '../ui/collabHarness';
import { schema as mainSchema } from '../ui/fixtures/editorSchemaMain';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { closeAssistant, closeAssistantSettings, openAssistantSettings, registerAssistantTarget, useAssistantUi, type AssistantEditor } from '../assistant/assistantUi';
import { AssistantSettings } from '../assistant/AssistantSettings';
import { closeAssistantDb, saveSettings } from '../assistant/keyStore';
import { DictationPanel, DOUBLE_TAP_MS, forgetRecent } from './DictationPanel';
import { closeDictation, dictationOpen, openDictation } from './dictationUi';
import { closeDictationDb } from './drafts';
import { captureDictateLink, resetDictateLink } from './dictateLink';
import { answer, cellText, cursorAt, mapOf, reportBlocks, WORDS } from './fixtures/report';
import { applyShotPages, factValue, proposeShotPages } from './shotPage';
import { validateAnswer } from './answer';

// La entrega V4 de *Dictate to report* con el editor real y un proveedor simulado (Docs/Doc_Dictado.md, fila V4 de la
// tabla de entregas): 1) el plano activo fijo entre tres notas sin decir el plano, 2) «no, era un 35» y otra corrección
// encima, 3) también en la página *Shot Breakdown* del plano (otra página, destildado, con su guarda y *Undo*), 4) la
// entrada `/dictate` del Atajo de iOS (el texto al campo, nada se manda solo); *Add as comment* para quien comenta; el
// resguardo del doble toque solo con un clic en *Apply*; Esc en las ventanas de ajustes cierra solo esas.

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

const KEY = 'sk-ant-api03-DICTADO-V4-secreta-88888';
const EMAIL = 'lega@wanka.tv';
const roots: Root[] = [];
const devices: Device[] = [];
const offTargets: (() => void)[] = [];

afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const off of offTargets.splice(0)) off();
  closeAssistant();
  closeAssistantSettings();
  closeDictation();
  forgetRecent();
  resetDictateLink();
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
  sessionStorage.clear();
  document.body.innerHTML = '';
});

const wait = (ms = 20) => act(async () => new Promise((r) => setTimeout(r, ms)));

function services(d: Device): Services {
  const client = { auth: {} };
  const config = { url: 'https://znlvpuddswymxpffgvbz.supabase.co', publishableKey: 'sb_publishable_test', name: 'Wanka', localKey: WANKA_LOCAL_KEY, storage: legacyStorageNames(WANKA_LOCAL_KEY) };
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

type Body = { system: string; messages: { content: string }[] };

/** Un `fetch` de proveedor simulado (Anthropic) que contesta por partes y anota los pedidos. */
function provider(...answers: (string | ((body: Body) => string))[]) {
  const calls: { url: string; body: string }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const body = String(init.body ?? '');
    calls.push({ url: String(input), body });
    const next = answers[Math.min(calls.length - 1, answers.length - 1)];
    const text = typeof next === 'string' ? next : next(JSON.parse(body));
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 2100 } } },
      ...text.match(/[\s\S]{1,9}/g)!.map((t) => ({ type: 'content_block_delta', delta: { type: 'text_delta', text: t } })),
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 140 } },
      { type: 'message_stop' },
    ];
    return new Response(events.map((e) => `data: ${JSON.stringify(e)}`).join('\n\n') + '\n\n', { status: 200 });
  });
  vi.stubGlobal('fetch', fetcher);
  return { calls, fetcher, user: (i: number) => (JSON.parse(calls[i].body) as Body).messages[0].content };
}

/** Los bloques de una página *Shot Breakdown* con el plano y el lente. */
function breakdownBlocks(shot: string, lens = ''): unknown[] {
  const blocks = builtinBlocks('shot', 'en') as { type: string; content?: { rows: { cells: unknown[] }[] } }[];
  const rows = blocks[0].content!.rows;
  rows[0].cells[1] = shot;
  rows[6].cells[1] = lens;
  return blocks;
}

/** Escribe bloques en una página del dispositivo sin dejarla abierta (como si se hubiera escrito antes). */
async function writePage(device: Device, pageId: string, blocks: unknown[]): Promise<void> {
  const temp = new Y.Doc();
  const ed = mountEditor(temp, 'otro');
  ed.replaceBlocks(ed.document, blocks as PartialBlock[]);
  const update = Y.encodeStateAsUpdate(temp);
  await device.docs.edit(pageId, (doc) => device.docs.applyLocal(pageId, doc, ORIGIN_REPLACE, () => Y.applyUpdate(doc, update)));
  await device.docs.flush(pageId);
}

/** El lente de la ficha de una página (lo guardado en el dispositivo). */
async function lensOf(device: Device, pageId: string): Promise<string | null> {
  const { doc } = await device.docs.indexSnapshot(pageId);
  try {
    return factValue(doc, ['lens']);
  } finally {
    doc.destroy();
  }
}

interface Setup {
  host: HTMLElement;
  ed: Editor;
  device: Device;
  pageId: string;
  remount: () => Promise<void>;
}

async function setup(opts: { editable?: boolean; breakdown?: { title: string; shot?: string; lens?: string }[] } = {}): Promise<Setup> {
  const server = new FakeServer();
  server.enableTeam();
  const device = await makeDevice(server);
  devices.push(device);
  const pageId = await device.tree.create(null, '2026-10-02 | Day 06');
  const others: string[] = [];
  for (const b of opts.breakdown ?? []) others.push(await device.tree.create(null, b.title));
  await device.engine.syncNow();
  for (const [i, b] of (opts.breakdown ?? []).entries()) await writePage(device, others[i], breakdownBlocks(b.shot ?? b.title, b.lens));
  await saveSettings(EMAIL, { provider: 'anthropic', model: 'claude-haiku-4-5', models: [] }, KEY);
  const doc = await device.docs.open(pageId, { seed: true });
  const ed = mountEditor(doc);
  ed.replaceBlocks(ed.document, reportBlocks() as PartialBlock[]);
  undoManager(ed).stopCapturing();
  const editable = opts.editable ?? true;
  offTargets.push(registerAssistantTarget({ pageId, view: () => view(ed), editable: () => editable, editor: () => ed as unknown as AssistantEditor }));
  const host = document.createElement('div');
  document.body.append(host);
  const mount = async () => {
    const root = createRoot(host);
    roots.push(root);
    act(() =>
      root.render(
        <ServicesContext.Provider value={services(device)}>
          <DictationPanel pageId={pageId} />
        </ServicesContext.Provider>,
      ),
    );
    await wait(80);
  };
  await mount();
  return {
    host,
    ed,
    device,
    pageId,
    remount: async () => {
      for (const r of roots.splice(0)) act(() => r.unmount());
      await mount();
    },
  };
}

const button = (host: HTMLElement, text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;

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
  const field = host.querySelector<HTMLTextAreaElement>('textarea')!;
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    set.call(field, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await wait(30);
}

async function place(host: HTMLElement, note: string) {
  await type(host, note);
  await click(button(host, 'Place'));
  await until(() => !!button(host, 'Apply') || !!host.querySelector('.assistant-error'));
}

async function chooseShot(host: HTMLElement, value: string) {
  const select = host.querySelector<HTMLSelectElement>('.dictation-shot select')!;
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    set.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await wait(30);
}

const chip = (host: HTMLElement) => host.querySelector<HTMLSelectElement>('.dictation-shot select');
const LENS = { op: 'setCell', at: 'T3 r3 c3', row: '12 · 010 · 3', col: 'Lens · Filters (ND, diffusion, pola)', old: '', new: '50 mm', why: 'note' };
const TSTOP = { op: 'setCell', at: 'T3 r3 c4', row: '12 · 010 · 3', col: 'T-stop · Focus', old: '', new: 'T2.8 · 3 m' };
const CIRCLED = { op: 'setCell', at: 'T3 r3 c7', row: '12 · 010 · 3', col: 'Circled takes · Notes', old: '', new: '4' };

async function next(host: HTMLElement) {
  await wait(DOUBLE_TAP_MS);
  await click(button(host, 'New note'));
}

describe('V4 · el plano activo', () => {
  it('aceptación 1: lo aplicado fija Shot: 12_010; tres notas sin decir el plano van con ACTIVE_SHOT y sin "elegida por el asistente"', async () => {
    const s = await setup();
    const p = provider(answer([LENS]), answer([TSTOP]), answer([CIRCLED]));
    expect(chip(s.host)?.value).toBe('');
    expect([...chip(s.host)!.options].map((o) => o.value)).toEqual(['', '12_010']);
    await place(s.host, 'el 12_010 setup 3 con un 50');
    expect(p.user(0)).not.toContain('ACTIVE_SHOT');
    await click(button(s.host, 'Apply'));
    await next(s.host);
    // Se puso sola con el plano de lo aplicado y queda entre notas.
    expect(chip(s.host)?.value).toBe('12_010');
    await place(s.host, 'a T2.8, foco a tres metros');
    expect(p.user(1)).toContain('ACTIVE_SHOT "12_010"');
    expect(s.host.querySelector('.dictation-changes')!.textContent).not.toContain('Row chosen by the assistant');
    await click(button(s.host, 'Apply'));
    await next(s.host);
    // Sigue fija al cerrar y abrir la hoja.
    await s.remount();
    expect(chip(s.host)?.value).toBe('12_010');
    await place(s.host, 'la buena es la 4');
    expect(p.user(2)).toContain('ACTIVE_SHOT "12_010"');
    expect(s.host.querySelector('.dictation-changes')!.textContent).not.toContain('Row chosen by the assistant');
    await click(button(s.host, 'Apply'));
    expect([cellText(s.ed, 3, 3, 3), cellText(s.ed, 3, 3, 4), cellText(s.ed, 3, 3, 7)]).toEqual(['50 mm', 'T2.8 · 3 m', '4']);
  });

  it('cambiarla a mano (o a None) cambia lo que va en el pedido y la señal de la fila', async () => {
    const s = await setup();
    const p = provider(answer([LENS]));
    await chooseShot(s.host, '12_010');
    await place(s.host, 'con un 50');
    expect(p.user(0)).toContain('ACTIVE_SHOT "12_010"');
    expect(s.host.querySelector('.dictation-changes')!.textContent).not.toContain('Row chosen by the assistant');
    await click(button(s.host, 'Discard'));
    await chooseShot(s.host, '');
    await place(s.host, 'con un 50');
    expect(p.user(1)).not.toContain('ACTIVE_SHOT');
    expect(s.host.querySelector('.dictation-changes')!.textContent).toContain('Row chosen by the assistant');
  });
});

describe('V4 · correcciones encadenadas', () => {
  it('aceptación 2: «no, era un 35» corrige el último cambio y otra corrección encima va al mismo lugar', async () => {
    const s = await setup();
    const p = provider(answer([LENS]), answer([{ ...LENS, old: '50 mm', new: '35 mm' }]), answer([{ ...LENS, old: '35 mm', new: '40 mm' }]));
    cursorAt(s.ed, mapOf(s.ed).targets.get('T1 r7 c2')!);
    await place(s.host, 'el 12_010 setup 3 con un 50');
    await click(button(s.host, 'Apply'));
    await next(s.host);
    await place(s.host, 'no, era un 35');
    expect(p.user(1)).toContain('RECENT\n- T3 r3 c3 (Setups & takes › 12 · 010 · 3 › Lens · Filters (ND, diffusion, pola)): "" → "50 mm" (last)');
    const preview = s.host.querySelector('.dictation-changes')!.textContent!;
    expect(preview).toContain('Corrects a change you just applied');
    expect(preview).toContain('Replaces “50 mm”');
    expect(preview).not.toContain('Row chosen by the assistant');
    await click(button(s.host, 'Apply'));
    expect(cellText(s.ed, 3, 3, 3)).toBe('35 mm');
    await next(s.host);
    await place(s.host, 'no, mejor 40');
    // Un renglón por lugar: lo primero de antes y lo último de después.
    expect(p.user(2)).toContain('RECENT\n- T3 r3 c3 (Setups & takes › 12 · 010 · 3 › Lens · Filters (ND, diffusion, pola)): "" → "35 mm" (last)');
    await click(button(s.host, 'Apply'));
    expect(cellText(s.ed, 3, 3, 3)).toBe('40 mm');
  });
});

describe('V4 · la página Shot Breakdown del plano', () => {
  it('aceptación 3: la vista previa ofrece también Shot Breakdown › 012_010 › Lens, destildado; tildado se escribe y Undo lo saca', async () => {
    const s = await setup({ breakdown: [{ title: '012_010' }, { title: '012_011' }] });
    const other = s.device.tree.roots(s.device.tree.get(s.pageId)!.workspace_id).find((r) => r.title === '012_010')!.id;
    provider(answer([LENS]));
    await place(s.host, 'el 12_010 setup 3 con un 50');
    const extra = s.host.querySelector('.dictation-extra')!;
    expect(extra.textContent).toContain('Also in the shot\'s page');
    expect(extra.textContent).toContain('Shot Breakdown › 012_010 › Lens');
    const box = extra.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    expect(box.checked).toBe(false);
    await click(box);
    await click(button(s.host, 'Apply'));
    await until(() => s.host.textContent!.includes('Applied 2 changes.'));
    expect(cellText(s.ed, 3, 3, 3)).toBe('50 mm');
    expect(await lensOf(s.device, other)).toBe('50 mm');
    // Undo de la hoja saca los dos.
    await wait(DOUBLE_TAP_MS);
    await click(button(s.host, 'Undo'));
    await until(() => s.host.querySelector('textarea') !== null);
    expect(cellText(s.ed, 3, 3, 3)).toBe('');
    expect(await lensOf(s.device, other)).toBe('');
  });

  it('destildado (de fábrica) no escribe en la otra página', async () => {
    const s = await setup({ breakdown: [{ title: '012_010' }] });
    const other = s.device.tree.roots(s.device.tree.get(s.pageId)!.workspace_id).find((r) => r.title === '012_010')!.id;
    provider(answer([LENS]));
    await place(s.host, 'el 12_010 setup 3 con un 50');
    expect(s.host.querySelector('.dictation-extra')).toBeTruthy();
    await click(button(s.host, 'Apply'));
    await wait(200);
    expect(cellText(s.ed, 3, 3, 3)).toBe('50 mm');
    expect(await lensOf(s.device, other)).toBe('');
  });

  it('nunca pisa lo de otro: si la ficha dice otra cosa, no lo propone y lo dice; la guarda frena lo que cambió después', async () => {
    const s = await setup({ breakdown: [{ title: '012_010', lens: '35 mm anamórfico' }] });
    provider(answer([LENS]));
    await place(s.host, 'el 12_010 setup 3 con un 50');
    expect(s.host.querySelector('.dictation-extra input')).toBeNull();
    expect(s.host.querySelector('.dictation-extra')!.textContent).toContain('Shot Breakdown › 012_010 › Lens already says “35 mm anamórfico”: it\'s left as it is.');
  });

  it('la guarda: si la celda de la ficha cambió entre la vista previa y Apply, no se escribe ahí (lo del reporte sí) y lo dice', async () => {
    const s = await setup({ breakdown: [{ title: '012_010' }] });
    const other = s.device.tree.roots(s.device.tree.get(s.pageId)!.workspace_id).find((r) => r.title === '012_010')!.id;
    provider(answer([LENS]));
    await place(s.host, 'el 12_010 setup 3 con un 50');
    await click(s.host.querySelector<HTMLInputElement>('.dictation-extra input')!);
    // Otro escribe el lente en la ficha mientras tanto.
    await writeLens(s.device, other, '24 mm');
    await click(button(s.host, 'Apply'));
    await until(() => s.host.textContent!.includes('Not written in'));
    expect(s.host.textContent).toContain('Not written in Shot Breakdown › 012_010 › Lens');
    expect(cellText(s.ed, 3, 3, 3)).toBe('50 mm');
    expect(await lensOf(s.device, other)).toBe('24 mm');
  });

  it('Undo no deshace en la ficha si alguien la cambió después de aplicar', async () => {
    const s = await setup({ breakdown: [{ title: '012_010' }] });
    const other = s.device.tree.roots(s.device.tree.get(s.pageId)!.workspace_id).find((r) => r.title === '012_010')!.id;
    provider(answer([LENS]));
    await place(s.host, 'el 12_010 setup 3 con un 50');
    await click(s.host.querySelector<HTMLInputElement>('.dictation-extra input')!);
    await click(button(s.host, 'Apply'));
    await until(() => s.host.textContent!.includes('Applied 2 changes.'));
    await writeLens(s.device, other, '50 mm Cooke');
    await wait(DOUBLE_TAP_MS);
    await click(button(s.host, 'Undo'));
    await until(() => s.host.textContent!.includes('changed after'));
    expect(cellText(s.ed, 3, 3, 3)).toBe('');
    expect(await lensOf(s.device, other)).toBe('50 mm Cooke');
  });

  it('dos páginas que podrían ser la del plano: no propone nada', async () => {
    const s = await setup({ breakdown: [{ title: '012_010' }, { title: 'Shot 12_010 (v2)', shot: '12_010' }] });
    provider(answer([LENS]));
    await place(s.host, 'el 12_010 setup 3 con un 50');
    expect(s.host.querySelector('.dictation-extra input')).toBeNull();
    expect(s.host.querySelector('.dictation-extra')!.textContent).toContain('More than one page could be the one of shot 12_010');
  });

  it('sin permiso de editar la página del plano (o sin saber los permisos), no se propone ni se escribe', async () => {
    const s = await setup({ breakdown: [{ title: '012_010' }] });
    const other = s.device.tree.roots(s.device.tree.get(s.pageId)!.workspace_id).find((r) => r.title === '012_010')!.id;
    const map = mapOf(s.ed);
    const plan = validateAnswer(answer([LENS]), map, { note: 'el 12_010 setup 3 con un 50', words: WORDS }, { word: 'Shot', checks: [] });
    if (plan === 'unreadable') throw new Error('no');
    const deps = (perms: { known: boolean; canEditPage(id: string): boolean }) => ({ tree: s.device.tree, docs: s.device.docs, perms: () => perms });
    const ok = await proposeShotPages(deps({ known: true, canEditPage: () => true }), s.pageId, map, plan.changes, 1000);
    expect(ok.changes.map((c) => [c.pageTitle, c.label, c.before, c.after])).toEqual([['012_010', 'Lens', '', '50 mm']]);
    const readOnly = await proposeShotPages(deps({ known: true, canEditPage: (id) => id !== other }), s.pageId, map, plan.changes, 1000);
    expect(readOnly.changes).toEqual([]);
    expect(readOnly.notes).toEqual([{ shot: '12_010', kind: 'readOnly', pageTitle: '012_010' }]);
    expect((await proposeShotPages(deps({ known: false, canEditPage: () => true }), s.pageId, map, plan.changes, 1000)).changes).toEqual([]);
    // Y si el permiso se pierde entre la vista previa y Apply, no escribe.
    const res = await applyShotPages(deps({ known: true, canEditPage: (id) => id !== other }), s.pageId, ok.changes);
    expect(res).toMatchObject({ written: [], failed: [{ pageId: other }] });
    expect(await lensOf(s.device, other)).toBe('');
    // Una página en la papelera tampoco.
    await s.device.tree.trash(other);
    // (Ni siquiera se nombra: no es "la página del plano" que no se puede editar.)
    expect(await proposeShotPages(deps({ known: true, canEditPage: () => true }), s.pageId, map, plan.changes, 1000)).toEqual({ changes: [], notes: [] });
  });

  it('lo escrito en la ficha lo abre igual la versión publicada (esquema anterior), sin cambiar nada', async () => {
    const s = await setup({ breakdown: [{ title: '012_010' }] });
    const other = s.device.tree.roots(s.device.tree.get(s.pageId)!.workspace_id).find((r) => r.title === '012_010')!.id;
    provider(answer([LENS]));
    await place(s.host, 'el 12_010 setup 3 con un 50');
    await click(s.host.querySelector<HTMLInputElement>('.dictation-extra input')!);
    await click(button(s.host, 'Apply'));
    await until(() => s.host.textContent!.includes('Applied 2 changes.'));
    const { doc } = await s.device.docs.indexSnapshot(other);
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    doc.destroy();
    const before = yText(copy);
    const old = mountEditor(copy, 'old', mainSchema);
    await wait(30);
    expect(yText(copy)).toBe(before);
    expect(view(old).state.doc.eq(pmFromY(old, copy))).toBe(true);
    expect(before).toContain('50 mm');
  });
});

/** Escribe el lente de la ficha como otra persona (sin editor). */
async function writeLens(device: Device, pageId: string, value: string): Promise<void> {
  await device.docs.edit(pageId, (doc) =>
    device.docs.applyLocal(pageId, doc, ORIGIN_REPLACE, () => {
      const temp = new Y.Doc();
      void temp;
      // El párrafo de la celda de valor de la fila *Lens*: el texto entero nuevo.
      const stack: unknown[] = doc.getXmlFragment('document-store').toArray();
      while (stack.length) {
        const n = stack.pop();
        if (!(n instanceof Y.XmlElement)) continue;
        if (n.nodeName === 'tableRow') {
          const [a, b] = n.toArray().filter((x): x is Y.XmlElement => x instanceof Y.XmlElement);
          const label = (a.toArray()[0] as Y.XmlElement).toArray().map((t) => (t as Y.XmlText).toString()).join('');
          if (label === 'Lens') {
            const para = b.toArray()[0] as Y.XmlElement;
            const texts = para.toArray().filter((t): t is Y.XmlText => t instanceof Y.XmlText);
            for (const t of texts) t.delete(0, t.length);
            if (texts[0]) texts[0].insert(0, value);
            else {
              const t = new Y.XmlText();
              para.insert(0, [t]);
              t.insert(0, value);
            }
            return;
          }
        }
        stack.push(...n.toArray());
      }
    }),
  );
  await device.docs.flush(pageId);
}

describe('V4 · Add as comment', () => {
  it('quien comenta y no edita: la nota y la ubicación propuesta van como comentario en el bloque; sin Undo; lo destildado queda', async () => {
    const s = await setup({ editable: false });
    provider(answer([LENS, TSTOP], { unplaced: 'el DP pidió otra toma' }));
    await place(s.host, 'el 12_010 setup 3 con un 50 a T2.8');
    expect(button(s.host, 'Apply')?.disabled).toBe(true);
    await click(s.host.querySelectorAll<HTMLInputElement>('.dictation-change input[type=checkbox]')[1]);
    await click(button(s.host, 'Add as comment'));
    expect(s.host.textContent).toContain('Added as a comment on this page.');
    expect(button(s.host, 'Undo')).toBeUndefined();
    const threads = s.device.comments.threads(s.pageId);
    expect(threads).toHaveLength(1);
    const body = threads[0].root.body;
    expect(body).toContain('Dictated note: “el 12_010 setup 3 con un 50 a T2.8”. Where it would go:');
    expect(body).toContain('• Setups & takes › 12 · 010 · 3 › Lens · Filters (ND, diffusion, pola): — → 50 mm');
    expect(body).not.toContain('T2.8 · 3 m');
    expect(body).toContain("Couldn't place:\n• el DP pidió otra toma");
    // En el bloque de la tabla.
    expect(threads[0].blockId).toBe(mapOf(s.ed).targets.get('T3 r3 c3')!.blockId);
    // La página no cambió y lo destildado está en Couldn't place.
    expect(cellText(s.ed, 3, 3, 3)).toBe('');
    expect([...s.host.querySelectorAll('.dictation-pending-text')].map((e) => e.textContent)).toEqual(['“T2.8 · 3 m”']);
  });
});

describe('V4 · /dictate (Atajo de iOS)', () => {
  it('aceptación 4: el texto del Atajo llega al campo de la hoja; no se manda nada hasta Place', async () => {
    const replaceState = vi.fn();
    captureDictateLink({ pathname: '/dictate', hash: '#este%20plano%20se%20film%C3%B3%20con%20un%2050' }, { replaceState });
    const p = provider(answer([LENS]));
    const s = await setup();
    await wait(60);
    expect(s.host.querySelector('textarea')!.value).toBe('este plano se filmó con un 50');
    expect(s.host.textContent).toContain('From your Shortcut. Check the note and tap Place: nothing is sent until you do.');
    expect(p.fetcher).not.toHaveBeenCalled();
    await click(button(s.host, 'Place'));
    await until(() => !!button(s.host, 'Apply'));
    expect(p.calls).toHaveLength(1);
    // Se toma una vez: al volver a abrir la hoja no se repite.
    await s.remount();
    expect(s.host.querySelector('textarea')!.value).toBe('este plano se filmó con un 50');
  });
});

describe('V4 · restos del asistente', () => {
  it('(c) aplicado con Ctrl/⌘+Enter, un Undo enseguida anda (el resguardo es solo para un clic en Apply)', async () => {
    const s = await setup();
    provider(answer([LENS]));
    await type(s.host, 'el 12_010 setup 3 con un 50');
    const panel = s.host.querySelector<HTMLElement>('.dictation-panel')!;
    const ctrlEnter = async () => {
      await act(async () => {
        panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
      });
      await wait(60);
    };
    await ctrlEnter();
    await until(() => !!button(s.host, 'Apply'));
    await ctrlEnter();
    expect(cellText(s.ed, 3, 3, 3)).toBe('50 mm');
    await click(button(s.host, 'Undo'));
    expect(cellText(s.ed, 3, 3, 3)).toBe('');
  });

  it('(a) Esc en Assistant… cierra solo esa ventana, no la hoja de abajo (con el foco todavía en la hoja)', async () => {
    const s = await setup();
    expect(openDictation()).toBe(true);
    const settingsHost = document.createElement('div');
    document.body.append(settingsHost);
    const r = createRoot(settingsHost);
    roots.push(r);
    let ui = { settings: false };
    function Settings() {
      ui = useAssistantUi();
      return ui.settings ? <AssistantSettings /> : null;
    }
    act(() =>
      r.render(
        <ServicesContext.Provider value={services(s.device)}>
          <Settings />
        </ServicesContext.Provider>,
      ),
    );
    // Se abre desde el engranaje de la hoja: el foco queda ahí hasta que los ajustes se leen.
    const gear = s.host.querySelector<HTMLButtonElement>('button[aria-label="Assistant settings"]')!;
    gear.focus();
    await act(async () => openAssistantSettings());
    await act(async () => {
      gear.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await wait(30);
    expect(ui.settings).toBe(false);
    expect(dictationOpen()).toBe(true);
    // Sin ventana arriba, Esc sí cierra la hoja.
    const panel = s.host.querySelector<HTMLElement>('.dictation-panel')!;
    await act(async () => {
      panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(dictationOpen()).toBe(false);
  });

  it('(a) Esc en Voice (adentro de la hoja) cierra solo esa ventana', async () => {
    vi.stubGlobal('MediaRecorder', class {});
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [] }) } });
    const s = await setup();
    expect(openDictation()).toBe(true);
    await click(button(s.host, 'Voice'));
    const dialog = s.host.querySelector<HTMLElement>('.voice-settings');
    expect(dialog).toBeTruthy();
    await act(async () => {
      dialog!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await wait(30);
    expect(s.host.querySelector('.voice-settings')).toBeNull();
    expect(dictationOpen()).toBe(true);
    delete (navigator as { mediaDevices?: unknown }).mediaDevices;
  });
});
