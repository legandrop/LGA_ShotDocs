// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ServicesContext, type Services } from '../services';
import type { MentionRef } from '../sync/comments';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { CommentsPanel } from './CommentsPanel';
import { CommentsToggle } from './CommentsToggle';
import { closeComments, showComments, useCommentsUi } from './commentsUi';
import { MentionsBell } from './MentionsBell';
import { activeMentions, insertMention, mentionQuery, mentionSegments, plainCoda } from './mentionText';

// Las menciones en la interfaz (P.21, entrega 1; Docs/Doc_Menciones.md, sección 2): el `@` en el campo con la lista,
// el pintado de las menciones (también las de Coda), la campana con el número, la lista y leer, y el punto en el botón
// de comentarios. Contra el servidor en memoria.

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

const ANA = '00000000-0000-4000-8000-0000000000a1';
const BETO = '00000000-0000-4000-8000-0000000000a2';
const CLIENTA = '00000000-0000-4000-8000-0000000000a3';
const beto: MentionRef = { userId: BETO, label: 'beto' };

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
});

function services(d: Device, userId: string, withInbox = true): Services {
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
    mentions: withInbox ? d.mentions : undefined,
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

/** Ana, Beto y una clienta; Brief compartida con los tres (Comentar). */
async function workspace(options: { mentions?: boolean } = {}) {
  const server = new FakeServer();
  if (options.mentions === false) server.enableImportedComments();
  else server.enableMentions();
  server.addMember(ANA, 'member', 'ana@wanka.tv');
  server.addMember(BETO, 'member', 'beto@wanka.tv');
  server.addMember(CLIENTA, 'guest', 'clienta@cliente.com');
  const owner = await makeDevice(server);
  devices.push(owner);
  const brief = await owner.tree.create(null, 'Brief');
  await owner.engine.syncNow();
  for (const id of [ANA, BETO, CLIENTA]) server.grant(id, { pageId: brief }, 'comment');
  const device = async (id: string) => {
    const d = await makeDevice(server, undefined, undefined, undefined, undefined, { id });
    devices.push(d);
    await d.engine.syncNow();
    return d;
  };
  return { server, owner, brief, device };
}

/** Escribe en el cuadro como lo haría el teclado: el texto y el cursor al final. */
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

describe('el texto de las menciones', () => {
  it('el @ abre la lista al comienzo o después de un espacio, no en medio de un correo', () => {
    expect(mentionQuery('@be', 3)).toEqual({ start: 0, query: 'be' });
    expect(mentionQuery('hola @', 6)).toEqual({ start: 5, query: '' });
    expect(mentionQuery('ana@wanka.tv', 12)).toBeNull();
    expect(mentionQuery('@be to', 6)).toBeNull();
    expect(mentionQuery('sin arroba', 10)).toBeNull();
  });

  it('elegir pone @rótulo y un espacio; solo cuentan las elegidas que siguen escritas', () => {
    expect(insertMention('hola @be', 5, 8, 'beto')).toEqual({ text: 'hola @beto ', caret: 11 });
    expect(insertMention('@be y más', 0, 3, 'beto')).toEqual({ text: '@beto y más', caret: 6 });
    expect(activeMentions('@beto, mirá', [beto])).toEqual([beto]);
    expect(activeMentions('@betoso', [beto])).toEqual([]);
    expect(activeMentions('x@beto', [beto])).toEqual([]);
    expect(activeMentions('borré la mención', [beto])).toEqual([]);
  });

  it('pinta cada mención activa (gana el rótulo más largo) y las de Coda como @Nombre', () => {
    const anaPerez = { userId: ANA, label: 'ana.perez' };
    const ana = { userId: CLIENTA, label: 'ana' };
    expect(mentionSegments('@ana.perez y @ana', [ana, anaPerez])).toEqual([
      { text: '@ana.perez', mention: anaPerez },
      { text: ' y ' },
      { text: '@ana', mention: ana },
    ]);
    expect(mentionSegments('@[Juan Pérez](superhuman://users/123) listo', [], true)).toEqual([
      { text: '@Juan Pérez', coda: true },
      { text: ' listo' },
    ]);
    // Sin `coda`, la forma de Coda queda tal cual.
    expect(mentionSegments('@[Juan](superhuman://users/1)', [])).toEqual([{ text: '@[Juan](superhuman://users/1)' }]);
    expect(plainCoda('ok @[Juan](superhuman://users/1)')).toBe('ok @Juan');
  });
});

describe('el campo de un comentario', () => {
  it('@ abre la lista, ↓ y Enter eligen, y al mandar la mención sale con el comentario y queda pintada', async () => {
    const { server, brief, device } = await workspace();
    const ana = await device(ANA);
    const host = await mount(services(ana, ANA), <Panel pageId={brief} />);
    await act(async () => showComments({ kind: 'new', blockId: null }));
    await wait();
    const textarea = host.querySelector<HTMLTextAreaElement>('textarea')!;
    await typeIn(textarea, 'Mirá @');
    await wait(80);
    const options = () => [...host.querySelectorAll('.mention-list [role=option]')].map((o) => o.textContent);
    // Ana (miembro) ve a la dueña y a Beto; la clienta no comentó todavía.
    expect(options()).toEqual(['betobeto@wanka.tv', 'ownerowner@test']);
    await typeIn(textarea, 'Mirá @b');
    expect(options()).toEqual(['betobeto@wanka.tv']);
    await key(textarea, 'ArrowDown');
    await key(textarea, 'Enter');
    expect(textarea.value).toBe('Mirá @beto ');
    expect(host.querySelector('.mention-list')).toBeNull();
    // Detrás del cuadro, la mención elegida pintada.
    expect(host.querySelector('.mention-backdrop mark')?.textContent).toBe('@beto');
    await typeIn(textarea, 'Mirá @beto la toma 12');
    await key(textarea, 'Enter', { ctrlKey: true });
    await act(async () => {
      await ana.engine.syncNow();
    });
    await wait();
    expect(server.mentions).toMatchObject([{ user_id: BETO, label: 'beto' }]);
    const body = host.querySelector('.comment-body')!;
    expect(body.querySelector('.mention')?.textContent).toBe('@beto');
    expect(body.querySelector('.mention')?.getAttribute('data-tip')).toBe('beto@wanka.tv');
  });

  it('Esc cierra la lista sin borrar lo escrito ni cancelar; escribir el rótulo a mano no menciona', async () => {
    const { server, brief, device } = await workspace();
    const ana = await device(ANA);
    const host = await mount(services(ana, ANA), <Panel pageId={brief} />);
    await act(async () => showComments({ kind: 'new', blockId: null }));
    await wait();
    const textarea = host.querySelector<HTMLTextAreaElement>('textarea')!;
    await typeIn(textarea, '@beto');
    expect(host.querySelector('.mention-list')).not.toBeNull();
    await key(textarea, 'Escape');
    expect(host.querySelector('.mention-list')).toBeNull();
    expect(host.querySelector('textarea')?.value).toBe('@beto');
    await typeIn(textarea, '@beto a mano');
    await key(textarea, 'Enter', { ctrlKey: true });
    await act(async () => {
      await ana.engine.syncNow();
    });
    await wait();
    expect([...server.comments.values()].map((c) => c.body)).toEqual(['@beto a mano']);
    expect(server.mentions).toHaveLength(0);
    expect(host.querySelector('.comment-body .mention')).toBeNull();
  });

  it('sin menciones en la base (versión 14) el @ no abre nada', async () => {
    const { brief, device } = await workspace({ mentions: false });
    const ana = await device(ANA);
    const host = await mount(services(ana, ANA), <Panel pageId={brief} />);
    await act(async () => showComments({ kind: 'new', blockId: null }));
    await wait();
    const textarea = host.querySelector<HTMLTextAreaElement>('textarea')!;
    await typeIn(textarea, '@b');
    expect(host.querySelector('.mention-list')).toBeNull();
    expect(host.querySelector('.mention-backdrop')).toBeNull();
  });

  it('a quien no se avisó lo ve quien escribió, debajo del comentario', async () => {
    const { server, brief, device } = await workspace();
    server.addMember('00000000-0000-4000-8000-0000000000a9', 'member', 'lucia@wanka.tv');
    const ana = await device(ANA);
    await ana.comments.add(brief, null, '@lucia mirá', null, [{ userId: '00000000-0000-4000-8000-0000000000a9', label: 'lucia' }]);
    await ana.engine.syncNow();
    const host = await mount(services(ana, ANA), <Panel pageId={brief} />);
    await act(async () => showComments(null));
    await wait();
    expect(host.querySelector('.comment-unnotified')?.textContent).toBe("@lucia wasn't notified.");
  });
});

describe('el pintado', () => {
  it('Coda como @Nombre; lo de un visitante del link y una mención sin su rótulo en el texto no se pintan', async () => {
    const { server, owner, brief, device } = await workspace();
    const at = new Date().toISOString();
    const base = { page_id: brief, block_id: null, thread_id: null, created_at: at, updated_at: at, edited_at: null, resolved_at: null, resolved_by: null, deleted_at: null, deleted_by: null };
    server.comments.set('c1', { ...base, id: 'c1', body: '@[Juan](superhuman://users/7) listo', author_id: null, imported_from: 'coda', imported_author: 'Pepe', imported_by: owner.remote.userId });
    server.comments.set('c2', { ...base, id: 'c2', body: '@beto desde el link', author_id: null, plink_author: 'Visitante' });
    server.comments.set('c3', { ...base, id: 'c3', body: 'editado por una versión vieja', author_id: ANA });
    server.mentions.push({ id: 'm3', comment_id: 'c3', page_id: brief, user_id: BETO, mentioned_by: ANA, label: 'beto', created_at: at, updated_at: at, removed_at: null, read_at: null });
    const b = await device(BETO);
    const host = await mount(services(b, BETO), <Panel pageId={brief} />);
    await act(async () => showComments(null));
    await act(async () => {
      await b.engine.syncNow();
    });
    await wait();
    const bodies = [...host.querySelectorAll('.comment-body')];
    const byText = (t: string) => bodies.find((x) => x.textContent?.includes(t))!;
    expect(byText('listo').querySelector('.mention')?.textContent).toBe('@Juan');
    expect(byText('desde el link').querySelector('.mention')).toBeNull();
    expect(byText('versión vieja').querySelector('.mention')).toBeNull();
  });
});

describe('la campana', () => {
  it('muestra el número, la lista y abrir una lleva al hilo y la marca leída; el botón de comentarios lleva el punto', async () => {
    const { server, brief, device } = await workspace();
    const ana = await device(ANA);
    const thread = await ana.comments.add(brief, null, '@beto fijate la toma 12', null, [beto]);
    await ana.engine.syncNow();
    const b = await device(BETO);
    await act(async () => {
      await b.mentions.poll();
    });
    const host = await mount(
      services(b, BETO),
      <>
        <MentionsBell />
        <CommentsToggle pageId={brief} />
      </>,
    );
    const bell = host.querySelector<HTMLButtonElement>('.mentions-bell')!;
    expect(bell.querySelector('.mentions-count')?.textContent).toBe('1');
    expect(bell.getAttribute('data-tip')).toBe('Mentions · 1 unread');
    expect(host.querySelector('.comments-toggle .mention-dot')).not.toBeNull();

    await act(async () => bell.click());
    await wait();
    const item = document.querySelector<HTMLButtonElement>('.mention-item')!;
    expect(item.textContent).toContain('ana');
    expect(item.textContent).toContain('Brief');
    expect(item.querySelector('.mention.me')?.textContent).toBe('@beto');
    await act(async () => item.click());
    await wait();
    expect(location.pathname).toBe(`/p/${brief}`);
    expect(bell.querySelector('.mentions-count')).toBeNull();
    expect(host.querySelector('.comments-toggle .mention-dot')).toBeNull();
    expect(server.mentions[0].read_at).not.toBeNull();
    void thread;
  });

  it('cuenta 9+ desde 10, Mark all as read las marca todas, y vacía dice que no hay', async () => {
    const { server, brief, device } = await workspace();
    const ana = await device(ANA);
    for (let i = 0; i < 11; i++) await ana.comments.add(brief, null, `@beto ${i}`, null, [beto]);
    await ana.engine.syncNow();
    const b = await device(BETO);
    await act(async () => {
      await b.mentions.poll();
    });
    const host = await mount(services(b, BETO), <MentionsBell />);
    const bell = host.querySelector<HTMLButtonElement>('.mentions-bell')!;
    expect(bell.querySelector('.mentions-count')?.textContent).toBe('9+');
    await act(async () => bell.click());
    await wait();
    const markAll = [...document.querySelectorAll<HTMLButtonElement>('.mentions-head .link')].find((x) => x.textContent === 'Mark all as read')!;
    await act(async () => markAll.click());
    await wait();
    expect(bell.querySelector('.mentions-count')).toBeNull();
    expect(server.mentions.every((m) => m.read_at)).toBe(true);
    expect(document.querySelector('.mentions-head .link')).toBeNull();

    // Otra persona sin menciones: la lista vacía lo explica.
    const c = await device(CLIENTA);
    await act(async () => {
      await c.mentions.poll();
    });
    const other = await mount(services(c, CLIENTA), <MentionsBell />);
    await act(async () => other.querySelector<HTMLButtonElement>('.mentions-bell')!.click());
    await wait();
    expect(document.querySelector('.mentions-empty')?.textContent).toContain('No mentions yet');
  });

  it('no está con la base sin migrar ni sin campana (link público)', async () => {
    const { brief, device } = await workspace({ mentions: false });
    const b = await device(BETO);
    const host = await mount(services(b, BETO), <MentionsBell />);
    expect(host.querySelector('.mentions-bell')).toBeNull();
    const host2 = await mount(services(b, BETO, false), <MentionsBell />);
    expect(host2.querySelector('.mentions-bell')).toBeNull();
    void brief;
  });
});
