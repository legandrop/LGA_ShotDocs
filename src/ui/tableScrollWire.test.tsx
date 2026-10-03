// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { schema } from './editorSchema';
import { PageEditor } from './PageEditor';

// El enganche de la celda a la vista (P.28): el editor de la página avisa a `revealSelectionCell` cada vez que cambia la
// selección. La lógica de acomodar la celda está en tableScroll.test.ts; acá se cuida solo el cableado, que un recorte
// de PageEditor.tsx dejaría suelto sin que ninguna otra prueba lo note.

const reveal = vi.hoisted(() => vi.fn());
vi.mock('./tableScroll', async (original) => ({ ...(await original<typeof import('./tableScroll')>()), revealSelectionCell: reveal }));

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
  document.body.innerHTML = '';
  reveal.mockClear();
});

function services(d: Device): Services {
  const config = { url: 'https://znlvpuddswymxpffgvbz.supabase.co', publishableKey: 'sb_publishable_test', name: 'Wanka', localKey: WANKA_LOCAL_KEY, storage: legacyStorageNames(WANKA_LOCAL_KEY) };
  const client = { auth: { signOut: vi.fn() } } as never;
  return {
    workspace: { config, client },
    client,
    user: { id: 'owner', email: 'owner@test' },
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
  };
}

const wait = (ms = 60) => act(async () => new Promise((r) => setTimeout(r, ms)));
const viewOf = (): EditorView | null => (document.querySelector('.bn-editor') as (HTMLElement & { editor?: { view?: EditorView } }) | null)?.editor?.view ?? null;

describe('la celda a la vista: el enganche en el editor de la página', () => {
  it('cada cambio de selección, también entre celdas de una tabla, llama a revealSelectionCell', async () => {
    const server = new FakeServer();
    const owner = await makeDevice(server);
    devices.push(owner);
    const page = await owner.tree.create(null, 'Reporte');
    await owner.engine.syncNow();
    const doc = await owner.docs.open(page, { seed: true });
    const seed = BlockNoteEditor.create(
      withCollaboration({ schema, collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'o', color: '#000' } } }),
    ) as unknown as BlockNoteEditor;
    seed.mount(document.createElement('div'));
    seed.replaceBlocks(seed.document, [
      { type: 'paragraph', content: 'Antes' },
      { type: 'table', content: { type: 'tableContent', rows: [{ cells: ['uno', 'dos', 'tres'] }, { cells: ['a', 'b', 'c'] }] } },
    ] as never);
    await new Promise((r) => setTimeout(r, 30));
    seed.unmount();
    await owner.docs.flush(page);
    owner.docs.close(page);
    await owner.engine.syncNow();

    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<ServicesContext.Provider value={services(owner)}><PageEditor pageId={page} /></ServicesContext.Provider>));
    for (let i = 0; i < 60 && !viewOf(); i++) await wait(50);
    const view = viewOf()!;
    expect(view).toBeTruthy();
    await wait(100);

    // Los lugares de texto de las celdas de la tabla.
    const spots: number[] = [];
    view.state.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent && ['uno', 'dos', 'tres'].includes(node.textContent)) spots.push(pos + 1);
    });
    expect(spots).toHaveLength(3);

    reveal.mockClear();
    for (const pos of [spots[2], spots[0], spots[1]]) {
      const before = reveal.mock.calls.length;
      act(() => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos))));
      expect(reveal.mock.calls.length).toBeGreaterThan(before);
    }
  });
});
