// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { CommentsPanel } from './CommentsPanel';
import { closeComments, showComments, useCommentsUi } from './commentsUi';
import { mentionMarks, MentionTreeDot } from './mentionDots';
import { MentionsBell } from './MentionsBell';
import { resetTitleBadge, setAppBadge, setDocumentTitle, setTitleCount, titleWith } from './titleBadge';

// Menciones, entrega 2 en la interfaz (P.21, ME2; Docs/Doc_Menciones.md, sección 9): la parte "No ven esta página"
// de la lista del `@` con la pregunta de compartir, el punto del árbol de páginas y el número en el título de la
// pestaña y en el ícono de la app. Contra el servidor en memoria.

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

const ADMIN = '00000000-0000-4000-8000-0000000000c1';
const ANA = '00000000-0000-4000-8000-0000000000c2';
const PEDRO = '00000000-0000-4000-8000-0000000000c3';

const roots: Root[] = [];
const devices: Device[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.mentions.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  act(() => closeComments());
  document.body.innerHTML = '';
  resetTitleBadge();
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
    mentions: d.mentions,
    sizes: d.sizes,
    offline: d.offline,
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

/** Un admin que edita y crea en Plan (puede compartirla), Ana que comenta y Pedro, que no la ve. */
async function workspace() {
  const server = new FakeServer();
  server.enableMentionSharing();
  server.addMember(ADMIN, 'admin', 'admin@wanka.tv');
  server.addMember(ANA, 'member', 'ana@wanka.tv');
  server.addMember(PEDRO, 'member', 'pedro@wanka.tv');
  const owner = await makeDevice(server);
  devices.push(owner);
  const plan = await owner.tree.create(null, 'Plan');
  const toma = await owner.tree.create(plan, 'Toma');
  await owner.engine.syncNow();
  server.grant(ADMIN, { pageId: plan }, 'edit_pages');
  server.grant(ANA, { pageId: plan }, 'comment');
  const device = async (id: string) => {
    const d = await makeDevice(server, undefined, undefined, undefined, undefined, { id });
    devices.push(d);
    await d.engine.syncNow();
    return d;
  };
  return { server, owner, plan, toma, device };
}

async function typeIn(textarea: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value);
    textarea.setSelectionRange(value.length, value.length);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await wait(20);
}

async function key(el: HTMLElement, k: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
  });
  await wait(20);
}

function Panel({ pageId }: { pageId: string }) {
  useCommentsUi();
  return <CommentsPanel pageId={pageId} />;
}

async function openComposer(host: HTMLElement): Promise<HTMLTextAreaElement> {
  await act(async () => showComments({ kind: 'new', blockId: null }));
  await wait();
  return host.querySelector<HTMLTextAreaElement>('textarea')!;
}

const options = (host: HTMLElement) =>
  [...host.querySelectorAll('.mention-list li')].map((li) => `${li.getAttribute('role') ?? ''}:${li.className}:${li.textContent}`);

describe('compartir desde la mención', () => {
  it('el admin ve a Pedro abajo, en gris; Enter pregunta, Share and mention comparte con Comentar y lo menciona', async () => {
    const { server, plan, device } = await workspace();
    const admin = await device(ADMIN);
    const host = await mount(services(admin, ADMIN), <Panel pageId={plan} />);
    const textarea = await openComposer(host);
    await typeIn(textarea, 'Mirá @');
    await wait(80);
    expect(options(host)).toEqual([
      'option:selected:anaana@wanka.tv',
      'option::ownerowner@test',
      "presentation:mention-list-head:Can't see this page",
      'option:outside:pedropedro@wanka.tv',
    ]);
    await typeIn(textarea, 'Mirá @pe');
    // Nadie con acceso coincide: lo dice, y abajo el que no ve la página.
    expect(options(host)).toEqual([
      ':mention-list-note:No one with access matches',
      "presentation:mention-list-head:Can't see this page",
      'option:selected outside:pedropedro@wanka.tv',
    ]);
    await key(textarea, 'Enter');
    // La pregunta, sin la lista y sin poner nada en el texto todavía.
    expect(host.querySelector('.mention-list')).toBeNull();
    const ask = host.querySelector<HTMLElement>('.mention-share')!;
    expect(ask.textContent).toContain("pedro can't see this page. Share it with them (Comment) and mention them?");
    expect(textarea.value).toBe('Mirá @pe');
    expect(server.grants.some((g) => g.user_id === PEDRO)).toBe(false);
    const share = [...ask.querySelectorAll('button')].find((b) => b.textContent === 'Share and mention')!;
    expect(document.activeElement).toBe(share);
    await act(async () => share.click());
    await wait(120);
    expect(server.grants.filter((g) => g.user_id === PEDRO)).toMatchObject([{ page_id: plan, level: 'comment', project_id: null }]);
    expect(server.mentionShares).toEqual([`${plan} ${PEDRO}`]);
    expect(host.querySelector('.mention-share')).toBeNull();
    expect(textarea.value).toBe('Mirá @pedro ');
    expect(host.querySelector('.mention-backdrop mark')?.textContent).toBe('@pedro');
    await typeIn(textarea, 'Mirá @pedro la toma');
    await key(textarea, 'Enter', { ctrlKey: true });
    await act(async () => {
      await admin.engine.syncNow();
    });
    await wait();
    expect(server.mentions).toMatchObject([{ user_id: PEDRO, label: 'pedro', mentioned_by: ADMIN }]);
  });

  it('Esc y Cancel cierran la pregunta sin compartir ni cancelar el comentario', async () => {
    const { server, plan, device } = await workspace();
    const admin = await device(ADMIN);
    const host = await mount(services(admin, ADMIN), <Panel pageId={plan} />);
    const textarea = await openComposer(host);
    await typeIn(textarea, 'hola @ped');
    await key(textarea, 'Enter');
    const ask = host.querySelector<HTMLElement>('.mention-share')!;
    await key(ask.querySelector('button')!, 'Escape');
    expect(host.querySelector('.mention-share')).toBeNull();
    expect(host.querySelector('textarea')?.value).toBe('hola @ped');
    // Otra vez, ahora con Cancel.
    await typeIn(textarea, 'hola @pedr');
    await key(textarea, 'Enter');
    const cancel = [...host.querySelectorAll<HTMLButtonElement>('.mention-share button')].find((b) => b.textContent === 'Cancel')!;
    await act(async () => cancel.click());
    await wait();
    expect(host.querySelector('.mention-share')).toBeNull();
    expect(host.querySelector('textarea')?.value).toBe('hola @pedr');
    expect(server.grants.some((g) => g.user_id === PEDRO)).toBe(false);
    expect(server.mentionShares).toEqual([]);
  });

  it('si mientras tanto se borró el @, la mención va al final', async () => {
    const { plan, device } = await workspace();
    const admin = await device(ADMIN);
    const host = await mount(services(admin, ADMIN), <Panel pageId={plan} />);
    const textarea = await openComposer(host);
    await typeIn(textarea, 'hola @ped');
    await key(textarea, 'Enter');
    await typeIn(textarea, 'hola');
    const share = [...host.querySelectorAll<HTMLButtonElement>('.mention-share button')].find((b) => b.textContent === 'Share and mention')!;
    await act(async () => share.click());
    await wait(120);
    expect(textarea.value).toBe('hola @pedro ');
  });

  it('un miembro no ve a nadie sin acceso, y sin red el admin tampoco', async () => {
    const { server, plan, device } = await workspace();
    const ana = await device(ANA);
    const host = await mount(services(ana, ANA), <Panel pageId={plan} />);
    const textarea = await openComposer(host);
    await typeIn(textarea, '@');
    await wait(80);
    expect(options(host).some((o) => o.includes('pedro') || o.includes("Can't see"))).toBe(false);

    const admin = await device(ADMIN);
    const host2 = await mount(services(admin, ADMIN), <Panel pageId={plan} />);
    await admin.mentions.refreshCandidates(plan);
    server.online = false;
    await act(async () => {
      await admin.engine.syncNow();
    });
    const textarea2 = host2.querySelector<HTMLTextAreaElement>('textarea') ?? (await openComposer(host2));
    await typeIn(textarea2, '@');
    await wait(80);
    expect(options(host2).some((o) => o.includes('pedro'))).toBe(false);
  });

  it('un error de la base se muestra en la pregunta y no pone la mención', async () => {
    const { server, owner, plan, device } = await workspace();
    const admin = await device(ADMIN);
    const host = await mount(services(admin, ADMIN), <Panel pageId={plan} />);
    const textarea = await openComposer(host);
    await typeIn(textarea, '@ped');
    await key(textarea, 'Enter');
    // Mientras tanto la dueña mandó la página a la papelera.
    await owner.tree.trash(plan);
    await owner.engine.syncNow();
    const share = [...host.querySelectorAll<HTMLButtonElement>('.mention-share button')].find((b) => b.textContent === 'Share and mention')!;
    await act(async () => share.click());
    await wait(120);
    expect(host.querySelector('.mention-share .comment-error')?.textContent).toBe('The page is in the trash: restore it before sharing it.');
    expect(textarea.value).toBe('@ped');
    expect(server.grants.some((g) => g.user_id === PEDRO)).toBe(false);
  });
});

describe('el punto del árbol', () => {
  it('lleno en la página con una mención sin leer; hueco en la madre plegada; nada al leerla', async () => {
    const { server, plan, toma, device } = await workspace();
    server.grant(PEDRO, { pageId: plan }, 'comment');
    const ana = await device(ANA);
    await ana.comments.add(toma, null, '@pedro mirá', null, [{ userId: PEDRO, label: 'pedro' }]);
    await ana.engine.syncNow();
    const pedro = await device(PEDRO);
    await act(async () => {
      await pedro.mentions.poll();
    });
    const host = await mount(
      services(pedro, PEDRO),
      <>
        <div id="plan-closed">
          <MentionTreeDot pageId={plan} collapsed />
        </div>
        <div id="plan-open">
          <MentionTreeDot pageId={plan} collapsed={false} />
        </div>
        <div id="toma">
          <MentionTreeDot pageId={toma} collapsed={false} />
        </div>
      </>,
    );
    expect(host.querySelector('#toma .tree-mention-dot:not(.inside)')?.getAttribute('data-tip')).toBe('You were mentioned here');
    expect(host.querySelector('#plan-closed .tree-mention-dot.inside')?.getAttribute('data-tip')).toBe('You were mentioned in a page inside');
    expect(host.querySelector('#plan-open .tree-mention-dot')).toBeNull();
    await act(async () => {
      await pedro.mentions.markAllRead();
    });
    await wait();
    expect(host.querySelector('.tree-mention-dot')).toBeNull();
  });

  it('las marcas se calculan una vez por lista y revisión del árbol, y no cuentan páginas que no están', () => {
    const tree = {
      revision: 1,
      get: (id: string) => (id === 'a' || id === 'b' ? { id } : undefined),
      ancestors: (id: string) => (id === 'b' ? [{ id: 'a' }] : []),
      getRevision() {
        return this.revision;
      },
    };
    const items = [
      { pageId: 'b', read: false },
      { pageId: 'z', read: false },
      { pageId: 'a', read: true },
    ] as never;
    const marks = mentionMarks(items, tree as never);
    expect([...marks.pages]).toEqual(['b']);
    expect([...marks.inside]).toEqual(['a']);
    expect(mentionMarks(items, tree as never)).toBe(marks);
    tree.revision = 2;
    expect(mentionMarks(items, tree as never)).not.toBe(marks);
  });
});

describe('el número afuera de la app', () => {
  it('el título de la pestaña lleva el número; si otro tomó el título no lo pisa', () => {
    resetTitleBadge();
    setDocumentTitle('Plan · Shot Docs');
    expect(document.title).toBe('Plan · Shot Docs');
    setTitleCount(3);
    expect(document.title).toBe('(3) Plan · Shot Docs');
    setTitleCount(12);
    expect(document.title).toBe('(9+) Plan · Shot Docs');
    // Imprimir pone el nombre del PDF: el número no lo cambia; al volver, sigue.
    document.title = 'Plan.pdf';
    setTitleCount(2);
    expect(document.title).toBe('Plan.pdf');
    setDocumentTitle('Toma · Shot Docs');
    expect(document.title).toBe('(2) Toma · Shot Docs');
    setTitleCount(0);
    expect(document.title).toBe('Toma · Shot Docs');
    expect(titleWith('x', 1)).toBe('(1) x');
  });

  it('el ícono de la app: el número de 1 a 9, la marca sola desde 10, y se borra en 0; sin la función, nada', () => {
    const set = vi.fn(async () => undefined);
    const clear = vi.fn(async () => undefined);
    Object.assign(navigator, { setAppBadge: set, clearAppBadge: clear });
    setAppBadge(4);
    setAppBadge(10);
    setAppBadge(0);
    expect(set.mock.calls).toEqual([[4], []]);
    expect(clear).toHaveBeenCalledTimes(1);
    // Rechazado (una pestaña sin instalar): no tira.
    Object.assign(navigator, { setAppBadge: vi.fn(async () => Promise.reject(new Error('NotAllowedError'))) });
    expect(() => setAppBadge(1)).not.toThrow();
    Object.assign(navigator, { setAppBadge: undefined, clearAppBadge: undefined });
    expect(() => setAppBadge(2)).not.toThrow();
  });

  it('la campana pone el número en el título y en el ícono, y lo saca al irse', async () => {
    const { server, plan, device } = await workspace();
    server.grant(PEDRO, { pageId: plan }, 'comment');
    const ana = await device(ANA);
    await ana.comments.add(plan, null, '@pedro mirá', null, [{ userId: PEDRO, label: 'pedro' }]);
    await ana.engine.syncNow();
    const pedro = await device(PEDRO);
    await act(async () => {
      await pedro.mentions.poll();
    });
    const set = vi.fn(async () => undefined);
    const clear = vi.fn(async () => undefined);
    Object.assign(navigator, { setAppBadge: set, clearAppBadge: clear });
    resetTitleBadge();
    setDocumentTitle('Plan · Shot Docs');
    const host = await mount(services(pedro, PEDRO), <MentionsBell />);
    expect(host.querySelector('.mentions-count')?.textContent).toBe('1');
    expect(document.title).toBe('(1) Plan · Shot Docs');
    expect(set).toHaveBeenLastCalledWith(1);
    act(() => roots.pop()!.unmount());
    expect(document.title).toBe('Plan · Shot Docs');
    expect(clear).toHaveBeenCalled();
    Object.assign(navigator, { setAppBadge: undefined, clearAppBadge: undefined });
  });
});
