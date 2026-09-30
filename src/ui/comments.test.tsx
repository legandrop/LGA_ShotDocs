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
import { CommentsPanel, when } from './CommentsPanel';
import { closeComments, showComments } from './commentsUi';
import { paragraphProps, schema } from './editorSchema';
import { PageEditor } from './PageEditor';

// El editor y el panel de comentarios montados de verdad contra el servidor en memoria: un invitado con
// Comentar ve la página en solo lectura, contesta una pregunta con el botón "Answer" y la respuesta sube
// anclada al bloque; con Ver solo lee.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  // jsdom no trae estas dos; Mantine las pide.
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
afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const d of devices.splice(0)) {
    await d.engine.stop();
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

async function mount(value: Services, node: React.ReactNode): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<ServicesContext.Provider value={value}>{node}</ServicesContext.Provider>));
  await wait();
  return host;
}

/** El dueño arma una página con un párrafo y una pregunta, y la comparte con un invitado. */
async function sharedPage(level: 'view' | 'comment') {
  const server = new FakeServer();
  server.enableComments();
  const owner = await makeDevice(server);
  devices.push(owner);
  const page = await owner.tree.create(null, 'Brief');
  await owner.engine.syncNow();
  const doc = await owner.docs.open(page, { seed: true });
  const editor = BlockNoteEditor.create(
    withCollaboration({ schema, collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'o', color: '#000' } } }),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  editor.mount(el);
  editor.replaceBlocks(editor.document, [
    { type: 'paragraph', content: 'Spot de 30 segundos.' },
    { type: 'paragraph', props: paragraphProps('question') as never, content: '¿Se filma de noche?' },
  ]);
  const questionId = editor.document[1].id;
  await new Promise((r) => setTimeout(r, 30));
  editor.unmount();
  await owner.docs.flush(page);
  owner.docs.close(page);
  await owner.engine.syncNow();

  server.addMember('cli', 'guest', 'cliente@test');
  server.grant('cli', { pageId: page }, level);
  const guest = await makeDevice(server, undefined, undefined, undefined, undefined, { id: 'cli', email: 'cliente@test' });
  devices.push(guest);
  await guest.engine.syncNow();
  return { server, owner, guest, page, questionId };
}

describe('comentarios en la página', () => {
  it('con Comentar, el invitado contesta una pregunta desde "Answer" aunque la página sea de solo lectura', async () => {
    const { server, guest, page, questionId } = await sharedPage('comment');
    const host = await mount(
      services(guest, 'cli'),
      <>
        <PageEditor pageId={page} />
        <CommentsPanel pageId={page} />
      </>,
    );
    await wait(150);

    expect(host.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('false');
    expect(host.textContent).toContain('You can comment on this page and answer its questions.');
    expect(host.querySelectorAll('p.question-line')).toHaveLength(1);
    const answer = [...host.querySelectorAll<HTMLButtonElement>('.question-answer')];
    expect(answer.map((b) => b.textContent)).toEqual(['Answer']);

    await act(async () => answer[0].click());
    await wait();
    const panel = host.querySelector('.comments-panel')!;
    expect(panel).not.toBeNull();
    expect(panel.querySelector('.thread-anchor')?.textContent).toContain('¿Se filma de noche?');
    const textarea = panel.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(textarea.placeholder).toBe('Write your answer…');
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      set.call(textarea, 'Sí, de noche, con lluvia.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const submit = [...panel.querySelectorAll<HTMLButtonElement>('button[type="submit"]')].find((b) => b.textContent === 'Answer')!;
    await act(async () => submit.click());
    await wait();

    // Guardado en el dispositivo y a la vista antes de subir.
    expect(guest.comments.status().pending).toBe(1);
    expect(panel.textContent).toContain('Sí, de noche, con lluvia.');
    expect(panel.textContent).toContain('You');
    expect(panel.textContent).toContain('Not uploaded yet');

    await act(async () => guest.engine.syncNow());
    await wait();
    expect([...server.comments.values()]).toEqual([
      expect.objectContaining({ block_id: questionId, author_id: 'cli', body: 'Sí, de noche, con lluvia.' }),
    ]);
    expect(panel.textContent).not.toContain('Not uploaded yet');
    expect(host.querySelector('.question-answer')?.textContent).toBe('1 answer');
  });

  it('con Ver, se leen los comentarios pero no se ofrece escribir', async () => {
    const { owner, guest, page, questionId } = await sharedPage('view');
    await owner.comments.add(page, questionId, 'Nota del equipo');
    await owner.engine.syncNow();
    await guest.engine.syncNow();

    const host = await mount(
      services(guest, 'cli'),
      <>
        <PageEditor pageId={page} />
        <CommentsPanel pageId={page} />
      </>,
    );
    await act(async () => guest.engine.syncNow());
    await wait(150);
    const answer = host.querySelector<HTMLButtonElement>('.question-answer')!;
    expect(answer.textContent).toBe('1 answer');
    await act(async () => answer.click());
    await wait();
    const panel = host.querySelector('.comments-panel')!;
    expect(panel.textContent).toContain('You can read the comments here.');
    // El nombre es el correo de quien escribió.
    expect(panel.textContent).toContain('owner@test');
    expect(panel.textContent).toContain('Nota del equipo');
    expect(panel.querySelector('textarea')).toBeNull();
    expect([...panel.querySelectorAll('button')].map((b) => b.textContent)).not.toContain('Reply');
    expect(host.querySelector('.comment-add')).toBeNull();
  });
});

describe('rechazos y borradores en el panel', () => {
  it('un borrado rechazado deja ver el comentario con Retry y Discard; lo escrito a medias pide confirmación', async () => {
    const { owner, guest, page, questionId } = await sharedPage('comment');
    const id = await owner.comments.add(page, questionId, 'Nota del equipo');
    await owner.engine.syncNow();
    const host = await mount(
      services(guest, 'cli'),
      <>
        <PageEditor pageId={page} />
        <CommentsPanel pageId={page} />
      </>,
    );
    await act(async () => showComments());
    await act(async () => guest.engine.syncNow());
    await wait();
    // El invitado intenta borrar lo del dueño (una versión con permisos viejos): la base lo rechaza.
    await act(async () => guest.comments.remove(page, id));
    await act(async () => guest.engine.syncNow());
    await wait();
    const panel = host.querySelector('.comments-panel')!;
    expect(panel.textContent).toContain('Nota del equipo');
    expect(panel.textContent).toContain('Not accepted by the server');
    const button = (label: string) => [...panel.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!;
    expect(button('Retry')).toBeDefined();
    await act(async () => button('Discard…').click());
    expect(panel.textContent).toContain('Discarding the delete: the comment comes back.');
    await act(async () => button('Discard').click());
    await wait();
    expect(panel.textContent).not.toContain('Not accepted by the server');
    expect(guest.comments.status().failed).toBe(0);

    // Lo escrito a medias: tocar afuera pregunta, y si no se confirma el panel queda abierto.
    await act(async () => button('Answer').click());
    const textarea = panel.querySelector<HTMLTextAreaElement>('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'A medio escribir');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => host.querySelector<HTMLElement>('.comments-scrim')!.click());
    expect(ask).toHaveBeenCalledWith('Discard what you wrote?');
    expect(host.querySelector('.comments-panel')).not.toBeNull();
    ask.mockReturnValue(true);
    await act(async () => host.querySelector<HTMLElement>('.comments-scrim')!.click());
    expect(host.querySelector('.comments-panel')).toBeNull();
    ask.mockRestore();
  });
});

describe('el panel en la página', () => {
  it('en la computadora ancha la página se corre: el selector de styles.css aplica con el panel adentro de la página', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(`${process.cwd()}/src/styles.css`, 'utf8');
    const selectors = [...css.matchAll(/^\s*(\.main:has\([^)]*comments-panel[^)]*\)[^{]*)\{/gm)].map((m) => m[1].trim());
    expect(selectors.length).toBeGreaterThanOrEqual(2);

    const { guest, page } = await sharedPage('comment');
    const { PageView } = await import('./PageView');
    const host = await mount(
      services(guest, 'cli'),
      <main className="main">
        <header className="topbar" />
        <PageView id={page} />
      </main>,
    );
    await act(async () => showComments());
    await wait();
    const main = host.querySelector('main')!;
    expect(main.querySelector('.comments-panel')).not.toBeNull();
    for (const sel of selectors) expect(document.querySelector(sel), sel).not.toBeNull();
    await act(async () => closeComments());
    for (const sel of selectors) expect(document.querySelector(sel), sel).toBeNull();
  });
});

describe('fechas', () => {
  it('dice hace cuánto, la hora o el día', () => {
    const now = Date.parse('2026-09-30T15:00:00');
    expect(when('2026-09-30T14:59:40', now)).toBe('just now');
    expect(when('2026-09-30T14:40:00', now)).toBe('20 min');
    expect(when('2026-09-30T09:05:00', now)).toMatch(/9:05/);
    expect(when('2026-09-12T09:05:00', now)).toBe('Sep 12');
    expect(when('2025-09-12T09:05:00', now)).toBe('Sep 12, 2025');
  });
});
