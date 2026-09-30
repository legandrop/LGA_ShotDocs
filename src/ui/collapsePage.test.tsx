// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { collapseControlFor } from './collapseControl';
import { loadCollapse } from './collapseStore';
import { closeComments, revealBlock } from './commentsUi';
import { paragraphProps, schema } from './editorSchema';
import { PageEditor } from './PageEditor';

// Colapsar (Docs/Doc_Colapsar.md) con la página montada de verdad: el triángulo de cada título, lo colapsado
// guardado en el dispositivo (la página vuelve a abrir colapsada), el menú de la página, "Ir al bloque" y el
// margen de comentarios sin marcas escondidas. También en solo lectura.

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
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

const roots: Root[] = [];
const devices: Device[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  act(() => closeComments());
  document.body.innerHTML = '';
});

function services(d: Device, userId: string): Services {
  const config = {
    url: 'https://znlvpuddswymxpffgvbz.supabase.co',
    publishableKey: 'sb_publishable_test',
    name: 'Wanka',
    localKey: WANKA_LOCAL_KEY,
    storage: legacyStorageNames(WANKA_LOCAL_KEY),
  };
  const client = { auth: { signOut: vi.fn() } } as never;
  return {
    workspace: { config, client },
    client,
    user: { id: userId, email: `${userId}@test` },
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
    shutdown: async () => undefined,
  };
}

const wait = (ms = 60) => act(async () => new Promise((r) => setTimeout(r, ms)));

/** Espera (hasta 3 s) a que la página esté como se espera: el editor se vuelve a abrir al completar la bajada. */
async function until(ok: () => boolean) {
  for (let i = 0; i < 60 && !ok(); i++) await wait(50);
}

async function mount(value: Services, pageId: string): Promise<{ host: HTMLElement; root: Root }> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<ServicesContext.Provider value={value}>{<PageEditor pageId={pageId} />}</ServicesContext.Provider>));
  await wait(150);
  return { host, root };
}

/** Una página con dos escenas; la primera tiene una pregunta adentro. */
async function scenesPage() {
  const server = new FakeServer();
  server.enableComments();
  const owner = await makeDevice(server);
  devices.push(owner);
  const page = await owner.tree.create(null, 'Plan');
  await owner.engine.syncNow();
  const doc = await owner.docs.open(page, { seed: true });
  const editor = BlockNoteEditor.create(
    withCollaboration({ schema, collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'o', color: '#000' } } }),
  ) as unknown as BlockNoteEditor;
  editor.mount(document.createElement('div'));
  editor.replaceBlocks(editor.document, [
    { type: 'heading', props: { level: 2 }, content: 'Escena 1' },
    { type: 'paragraph', content: 'Plano general.' },
    { type: 'paragraph', props: paragraphProps('question') as never, content: '¿De noche?' },
    { type: 'heading', props: { level: 2 }, content: 'Escena 2' },
    { type: 'paragraph', content: 'Interior.' },
  ]);
  const ids = editor.document.map((b) => b.id);
  await new Promise((r) => setTimeout(r, 30));
  editor.unmount();
  await owner.docs.flush(page);
  owner.docs.close(page);
  await owner.engine.syncNow();
  return { server, owner, page, ids };
}

const toggles = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>('.sd-collapse-toggle')];
const hiddenCount = (host: HTMLElement) => host.querySelectorAll('.bn-block-outer.sd-collapsed-hidden').length;

describe('colapsar en la página', () => {
  it('el triángulo colapsa para vos, se guarda en el dispositivo y la página vuelve a abrir colapsada', async () => {
    const { owner, page, ids } = await scenesPage();
    const first = await mount(services(owner, 'owner'), page);
    await until(() => toggles(first.host).length === 2);
    const buttons = toggles(first.host);
    expect(buttons).toHaveLength(2);
    expect(buttons.map((b) => b.getAttribute('aria-expanded'))).toEqual(['true', 'true']);
    // Con el editor editable, Tab anida bloques: el triángulo no entra en el orden de Tab (en solo lectura, sí).
    const editable = first.host.querySelector('.ProseMirror')?.getAttribute('contenteditable') === 'true';
    expect(buttons[0].tabIndex).toBe(editable ? -1 : 0);

    await act(async () => buttons[0].click());
    await wait();
    expect(hiddenCount(first.host)).toBe(2);
    expect(toggles(first.host)[0].getAttribute('aria-expanded')).toBe('false');
    expect(toggles(first.host)[0].dataset.tip).toMatch(/just for you/);

    // El menú de la página sabe cuántos títulos hay y cuántos están colapsados.
    expect(collapseControlFor(page)?.counts()).toEqual({ headings: 2, collapsed: 1 });
    expect(collapseControlFor('otra')).toBeNull();

    // Se guarda (con una pausa) y la página se vuelve a abrir colapsada.
    await wait(400);
    expect((await loadCollapse(owner.db, page)).get(ids[0])).toEqual({ c: true, g: null });
    await act(async () => first.root.unmount());
    roots.splice(roots.indexOf(first.root), 1);
    const again = await mount(services(owner, 'owner'), page);
    await until(() => hiddenCount(again.host) === 2);
    expect(hiddenCount(again.host)).toBe(2);

    // "Ir al bloque" (los comentarios) abre lo que lo esconde.
    await act(async () => void revealBlock(ids[2]));
    await wait();
    expect(hiddenCount(again.host)).toBe(0);

    // Colapsar todo y abrir todo, desde el menú de la página.
    await act(async () => collapseControlFor(page)!.setAll(true));
    await wait();
    expect(hiddenCount(again.host)).toBe(3);
    await act(async () => collapseControlFor(page)!.setAll(false));
    await wait();
    expect(hiddenCount(again.host)).toBe(0);
  });

  it('en solo lectura también se colapsa (para vos), sin subir nada; la pregunta escondida no tiene botón en el margen', async () => {
    const { server, page } = await scenesPage();
    server.addMember('cli', 'guest', 'cliente@test');
    server.grant('cli', { pageId: page }, 'comment');
    const guest = await makeDevice(server, undefined, undefined, undefined, undefined, { id: 'cli', email: 'cliente@test' });
    devices.push(guest);
    await guest.engine.syncNow();
    const { host } = await mount(services(guest, 'cli'), page);
    await until(() => toggles(host).length === 2);
    expect(host.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('false');
    const buttons = toggles(host);
    expect(buttons).toHaveLength(2);
    expect(buttons[0].tabIndex).toBe(0);
    await until(() => host.querySelector('.question-answer') !== null);
    expect(host.querySelector('.question-answer')).not.toBeNull();
    await act(async () => buttons[0].click());
    await wait();
    expect(hiddenCount(host)).toBe(2);
    // La pregunta quedó escondida: su botón "Answer" no se dibuja (el panel la sigue mostrando).
    expect(host.querySelector('.question-answer')).toBeNull();
    // Nada se sube: colapsar no escribe la página.
    await act(async () => guest.engine.syncNow());
    expect(await guest.docs.unsyncedPages()).toEqual([]);
  });
});
