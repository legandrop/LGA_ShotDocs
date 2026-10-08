// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { translate } from '../i18n';
import { prefs } from '../prefs';
import { settled } from '../test/settle';
import { navigate, pagePath } from '../router';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY, WorkspaceContext } from '../workspace';
import { closeComments, dropLeftDrafts, hasDrafts, setDraft, showComments } from './commentsUi';
import { signOutQuestion } from './menus';
import { NoProjectsOpen, Shell } from './Workspace';

// Un comentario a medio escribir y lo que le pasa a la página que lo tiene, con la app montada entera contra el
// servidor en memoria (Docs/Doc_Sincronizacion.md, "Un cuadro abierto y lo que llega de afuera"): cerrar o recargar
// el navegador pregunta; cambiar de página, o que la página deje de verse, ya no se lo lleva en silencio (un aviso lo
// deja copiar, uno solo por todos los cuadros que se cerraron juntos); salir de la cuenta pregunta antes; y perder el
// permiso de comentar o que la página vaya a la papelera no cierran el cuadro.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// Monta el editor: con la máquina cargada, en jsdom tarda.
vi.setConfig({ testTimeout: 120_000 });

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined,
    addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
  })) as never;
  const empty = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) });
  Range.prototype.getClientRects ??= (() => []) as never;
  Range.prototype.getBoundingClientRect ??= empty as never;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.scrollTo ??= function () {} as never;
});

const CLIENTA = '00000000-0000-4000-8000-0000000000a3';
const CONFIG = { url: 'https://x.supabase.co', publishableKey: 'k', name: 'Wanka', localKey: WANKA_LOCAL_KEY, storage: legacyStorageNames(WANKA_LOCAL_KEY) };

const roots: Root[] = [];
const devices: Device[] = [];
const notices: { message: string; label?: string; run?: () => void }[] = [];
const onNotice = (e: Event) => {
  const detail = (e as CustomEvent<string | { message: string; action?: { label: string; run: () => void } }>).detail;
  notices.push(typeof detail === 'string' ? { message: detail } : { message: detail.message, label: detail.action?.label, run: detail.action?.run });
};
window.addEventListener('shotdocs:notice', onNotice);

afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const d of devices.splice(0)) {
    await d.docs.flush();
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  act(() => closeComments());
  // Desmontar la app con un cuadro con texto lo deja en el cartel (LeftDrafts.tsx): no pasa a la prueba siguiente.
  act(() => dropLeftDrafts());
  act(() => prefs.set({ language: 'en' }));
  notices.length = 0;
  document.body.innerHTML = '';
  localStorage.clear();
  history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const wait = (ms = 30) => act(() => settled(ms));
async function until(check: () => unknown, what: string, tries = 400): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (check()) return;
    await wait(40);
  }
  throw new Error(`no llegó: ${what}`);
}
const shown = () => document.body.textContent ?? '';
const panel = () => document.querySelector<HTMLElement>('.comments-panel');
const box = () => panel()?.querySelector<HTMLTextAreaElement>('textarea') ?? null;
const inPanel = (label: string) => [...(panel()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) => b.textContent === label);
const type = (text: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box()!, text);
    box()!.dispatchEvent(new Event('input', { bubbles: true }));
  });

function services(d: Device, signOut: () => unknown = () => undefined): Services {
  const one = async () => ({ data: null, error: null, status: 200 });
  const client = {
    auth: { signOut, getSession: async () => ({ data: { session: null } }) },
    rpc: async () => ({ data: [], error: null, status: 200 }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: one }), maybeSingle: one }) }),
  };
  return {
    workspace: { config: CONFIG, client },
    client,
    user: { id: d.remote.userId, email: 'a@test' },
    db: d.db, tree: d.tree, docs: d.docs, files: d.files, media: d.media, engine: d.engine, access: d.access,
    remote: d.remote as unknown as SupabaseRemote, dbName: 'test', mediaDb: d.mediaDb, comments: d.comments, commentsDb: d.commentsDb,
    sizes: d.sizes, offline: d.offline, shutdown: async () => undefined,
  } as unknown as Services;
}

function mount(d: Device, node: React.ReactNode, signOut?: () => unknown): void {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const value = services(d, signOut);
  act(() => root.render(<WorkspaceContext.Provider value={value.workspace}><ServicesContext.Provider value={value}>{node}</ServicesContext.Provider></WorkspaceContext.Provider>));
}

/** La app con una página abierta, su hilo «Original» y el panel de comentarios abierto, para quien usa `d`. */
async function openApp(d: Device, page: string, signOut?: () => unknown): Promise<void> {
  history.replaceState(null, '', pagePath(page));
  mount(d, <Shell />, signOut);
  await until(() => document.querySelector('textarea.page-title'), 'el título de la página abierta');
  act(() => showComments(null));
  await until(() => inPanel('Reply'), 'el panel con el hilo');
}

/** La dueña con Brief (y otra página), un hilo suyo, y la app abierta en Brief. */
async function owner(signOut?: () => unknown) {
  const server = new FakeServer();
  server.enableComments();
  const d = await makeDevice(server);
  devices.push(d);
  const page = await d.tree.create(null, 'Brief');
  const other = await d.tree.create(null, 'Otra');
  await d.comments.add(page, null, 'Original');
  await d.engine.syncNow();
  await openApp(d, page, signOut);
  return { server, d, page, other };
}

/** Una invitada que puede comentar Brief (de la dueña), con la app abierta ahí y una respuesta a medio escribir. */
async function guestReplying() {
  const server = new FakeServer();
  server.enableComments();
  server.addMember(CLIENTA, 'guest', 'clienta@cliente.com');
  const boss = await makeDevice(server);
  devices.push(boss);
  const page = await boss.tree.create(null, 'Brief');
  await boss.comments.add(page, null, 'Original');
  await boss.engine.syncNow();
  server.grant(CLIENTA, { pageId: page }, 'comment');
  const guest = await makeDevice(server, undefined, undefined, undefined, undefined, { id: CLIENTA });
  devices.push(guest);
  await guest.engine.syncNow();
  await openApp(guest, page);
  await act(async () => inPanel('Reply')!.click());
  await type('Respuesta de la invitada, a medias');
  /** Baja en el dispositivo de la invitada lo que cambió en la base. */
  const sync = async () => {
    server.clockOffset += 11_000;
    await act(async () => guest.engine.syncNow());
    await wait(60);
  };
  return { server, boss, guest, page, sync };
}

describe('salir con un comentario a medio escribir', () => {
  it('cerrar o recargar el navegador pregunta mientras haya algo escrito en un cuadro, y deja de preguntar cuando se cierra', async () => {
    await owner();
    const leaving = () => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(leaving()).toBe(false);
    await act(async () => inPanel('Reply')!.click());
    // Abierto y vacío no cuenta: no hay nada que perder.
    expect(leaving()).toBe(false);
    await type('Respuesta a medio escribir');
    expect(hasDrafts()).toBe(true);
    expect(leaving()).toBe(true);
    await act(async () => inPanel('Cancel')!.click());
    expect(leaving()).toBe(false);
  });

  it('cambiar de página con algo escrito ya no se lo lleva en silencio: un aviso lo dice y deja copiarlo', async () => {
    const { other } = await owner();
    await act(async () => inPanel('Reply')!.click());
    await type('Respuesta a medio escribir');
    const copied: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => void copied.push(text) } });
    await act(async () => navigate(pagePath(other)));
    await until(() => document.querySelector<HTMLTextAreaElement>('textarea.page-title')?.value === 'Otra', 'la otra página');
    expect(notices).toEqual([expect.objectContaining({ message: 'A comment you were writing was closed before you sent it.', label: 'Copy text' })]);
    // El aviso está a la vista en la app, con su botón, y copia lo tipeado entero.
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Copy text');
    expect(button).toBeDefined();
    await act(async () => button!.click());
    await wait();
    expect(copied).toEqual(['Respuesta a medio escribir']);
    expect(hasDrafts()).toBe(false);
  });

  it('cambiar de página con dos cuadros con algo escrito deja un solo aviso en la app, que dice cuántos son y los copia a los dos', async () => {
    const { other } = await owner();
    const boxes = () => [...panel()!.querySelectorAll<HTMLTextAreaElement>('textarea')];
    const typeIn = (el: HTMLTextAreaElement, text: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
    await act(async () => inPanel('Edit')!.click());
    await typeIn(boxes()[0], 'Edición a medio escribir');
    await act(async () => inPanel('Reply')!.click());
    await typeIn(boxes()[1], 'Respuesta a medio escribir');
    const copied: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => void copied.push(text) } });
    await act(async () => navigate(pagePath(other)));
    await until(() => document.querySelector<HTMLTextAreaElement>('textarea.page-title')?.value === 'Otra', 'la otra página');
    expect(notices).toEqual([expect.objectContaining({ message: '2 comments you were writing were closed before you sent them.', label: 'Copy all 2' })]);
    // En la pantalla hay un aviso solo, con el botón que copia los dos textos.
    expect(document.querySelectorAll('.notice')).toHaveLength(1);
    expect(document.querySelector('.notice')!.textContent).toContain('2 comments you were writing were closed before you sent them.');
    const button = [...document.querySelectorAll<HTMLButtonElement>('.notice button')].find((b) => b.textContent === 'Copy all 2');
    await act(async () => button!.click());
    await wait();
    expect(copied).toEqual(['Edición a medio escribir\n\nRespuesta a medio escribir']);
    expect(hasDrafts()).toBe(false);
  });
});

describe('salir de la cuenta con un comentario a medio escribir', () => {
  /** Abre el menú de la cuenta y toca *Sign out* (o su nombre en el idioma de la app). */
  const signOutFromMenu = async (label = 'Sign out') => {
    if (!document.querySelector('.account-menu')) await act(async () => document.querySelector<HTMLButtonElement>('.account-button')!.click());
    const button = [...document.querySelectorAll<HTMLButtonElement>('.account-menu button')].find((b) => b.textContent?.trim() === label);
    await act(async () => button!.click());
    await wait(60);
  };

  it('el menú de la cuenta pregunta antes y dice que se va a perder; con un «no», el cuadro sigue con lo tipeado y no se sale', async () => {
    const signOut = vi.fn(async () => ({ error: null }));
    await owner(signOut);
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => inPanel('Reply')!.click());
    await type('Respuesta a medio escribir');
    const before = box();
    await signOutFromMenu();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenLastCalledWith('A comment you wrote has not been sent and will be lost. Sign out anyway?');
    expect(ask.mock.calls[0][0]).toBe(signOutQuestion(0, 0, 1));
    expect(signOut).not.toHaveBeenCalled();
    expect(box()).toBe(before);
    expect(box()!.value).toBe('Respuesta a medio escribir');
    expect(notices).toEqual([]);
    // En castellano, y con dos cuadros: una sola pregunta, que dice cuántos son.
    act(() => prefs.set({ language: 'es' }));
    await wait();
    await act(async () => inPanel('Editar')!.click());
    await act(async () => {
      const edit = panel()!.querySelectorAll<HTMLTextAreaElement>('textarea')[0];
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(edit, 'Edición a medio escribir');
      edit.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await signOutFromMenu('Cerrar sesión');
    expect(ask).toHaveBeenCalledTimes(2);
    expect(ask).toHaveBeenLastCalledWith('2 comentarios que escribiste no se mandaron y se van a perder. ¿Cerrar la sesión igual?');
    expect(signOut).not.toHaveBeenCalled();
    act(() => prefs.set({ language: 'en' }));
    await wait();
    // Con un «sí», sale.
    ask.mockReturnValue(true);
    await signOutFromMenu();
    await until(() => signOut.mock.calls.length > 0, 'la salida de la cuenta');
    expect(ask).toHaveBeenCalledTimes(3);
  });

  it('sin nada escrito en ningún cuadro, el menú de la cuenta sale sin preguntar, como siempre', async () => {
    const signOut = vi.fn(async () => ({ error: null }));
    await owner(signOut);
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    // Un cuadro abierto y vacío no cuenta.
    await act(async () => inPanel('Reply')!.click());
    await signOutFromMenu();
    await until(() => signOut.mock.calls.length > 0, 'la salida de la cuenta');
    expect(ask).not.toHaveBeenCalled();
  });

  it('la pregunta de salir suma lo que se está escribiendo a lo pendiente y a lo rechazado, en una sola', () => {
    // Sin nada escrito, las de siempre.
    expect(signOutQuestion(2, 0, 0)).toBe(signOutQuestion(2, 0));
    expect(signOutQuestion(3, 1, 0)).toBe(signOutQuestion(3, 1));
    expect(signOutQuestion(0, 0, 1)).toBe('A comment you wrote has not been sent and will be lost. Sign out anyway?');
    expect(signOutQuestion(2, 0, 1)).toBe(
      '2 changes are not uploaded yet: they upload the next time you sign in with this account. A comment you wrote has not been sent and will be lost. Sign out anyway?',
    );
    expect(signOutQuestion(3, 1, 2)).toBe(
      '3 changes are not uploaded yet: they upload the next time you sign in with this account. 1 change was rejected by the server and is only on this device. It stays saved here: you can review it in the sync status the next time you sign in with this account. 2 comments you wrote have not been sent and will be lost. Sign out anyway?',
    );
    for (const count of [1, 2]) expect(translate('es', 'comments.draftUnsent', { count })).not.toBe(translate('en', 'comments.draftUnsent', { count }));
  });
});

describe('lo que le pasa a la página con un cuadro abierto', () => {
  it('perder el permiso de comentar no cierra el cuadro: lo escrito sigue, y si se manda queda rechazado con su texto', async () => {
    const { server, guest, page, sync } = await guestReplying();
    const before = box();
    server.grant(CLIENTA, { pageId: page }, 'view');
    await sync();
    expect(panel()!.textContent).toContain('You can read the comments here. Ask for comment access to add yours.');
    expect(box()).toBe(before);
    expect(box()!.value).toBe('Respuesta de la invitada, a medias');
    // Mandarlo no lo pierde: el servidor lo rechaza y queda a la vista, con el motivo y su texto para copiar.
    await act(async () => inPanel('Reply')!.click());
    await sync();
    expect(guest.comments.status().failed).toBe(1);
    expect(panel()!.textContent).toContain('Respuesta de la invitada, a medias');
    expect(panel()!.querySelector('.comment-error')!.textContent).toContain('Not accepted by the server');
    expect(notices).toEqual([]);
  });

  it('la página que va a la papelera desde otro lado (y se sigue viendo, con su cartel) no cierra el cuadro', async () => {
    const { server, d, page } = await owner();
    await act(async () => inPanel('Reply')!.click());
    await type('Respuesta a medio escribir');
    const before = box();
    const desk = await makeDevice(server);
    devices.push(desk);
    await desk.engine.syncNow();
    await desk.tree.trash(page);
    await desk.engine.syncNow();
    server.clockOffset += 11_000;
    await act(async () => d.engine.syncNow());
    await wait(60);
    expect(shown()).toContain('This page is in the trash.');
    expect(box()).toBe(before);
    expect(box()!.value).toBe('Respuesta a medio escribir');
    expect(notices).toEqual([]);
  });

  it.each(['le sacan el permiso', 'va a la papelera y ahí no la ve'] as const)('la página que deja de verse (%s) se lleva el panel, pero no en silencio: el aviso deja copiar lo tipeado', async (how) => {
    const { server, boss, page, sync } = await guestReplying();
    if (how === 'le sacan el permiso') {
      server.grants.splice(server.grants.findIndex((g) => g.user_id === CLIENTA), 1);
    } else {
      await boss.tree.trash(page);
      await boss.engine.syncNow();
    }
    await sync();
    await until(() => !document.querySelector('textarea.page-title'), 'la página fuera de la vista');
    expect(panel()).toBeNull();
    expect(notices).toEqual([expect.objectContaining({ message: 'A comment you were writing was closed before you sent it.', label: 'Copy text' })]);
    const copied: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => void copied.push(text) } });
    notices[0].run!();
    await wait();
    expect(copied).toEqual(['Respuesta de la invitada, a medias']);
  });
});

describe('salir de la cuenta desde la pantalla sin proyectos', () => {
  it('con algo rechazado pregunta como el menú de la cuenta: dice que quedó solo en este dispositivo', async () => {
    const server = new FakeServer();
    server.enableComments();
    server.addMember(CLIENTA, 'guest', 'clienta@cliente.com');
    const boss = await makeDevice(server);
    devices.push(boss);
    const page = await boss.tree.create(null, 'Brief');
    await boss.engine.syncNow();
    const guest = await makeDevice(server, undefined, undefined, undefined, undefined, { id: CLIENTA });
    devices.push(guest);
    await guest.engine.syncNow();
    expect(guest.tree.hasNoProjects()).toBe(true);
    // Un comentario que el servidor rechazó cuando todavía veía la página, y otro que no llegó a subir.
    await guest.commentsDb.add('outbox', {
      op: { kind: 'add', id: crypto.randomUUID(), pageId: page, blockId: null, threadId: null, body: 'Rechazado', at: new Date().toISOString() },
      attempted: true, failed: true, error: 'You can view this page but not comment on it.', queuedAt: Date.now(),
    });
    await guest.comments.load();
    server.online = false;
    await guest.comments.add(page, null, 'Sin subir');
    await guest.engine.syncNow();
    expect(guest.engine.getStatus()).toMatchObject({ pendingComments: 1, failedComments: 1 });
    const signOut = vi.fn();
    mount(guest, <NoProjectsOpen />, signOut);
    await wait(60);
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Sign out')!.click());
    expect(ask).toHaveBeenCalledWith(signOutQuestion(1, 1));
    expect(ask.mock.calls[0][0]).toContain('1 change was rejected by the server and is only on this device.');
    expect(signOut).not.toHaveBeenCalled();
    ask.mockReturnValue(true);
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Sign out')!.click());
    expect(signOut).toHaveBeenCalled();
  });

  it('con un cuadro con algo escrito registrado, también pregunta (hoy esa pantalla no tiene panel: es la misma pregunta por si lo tuviera)', async () => {
    const server = new FakeServer();
    server.enableComments();
    server.addMember(CLIENTA, 'guest', 'clienta@cliente.com');
    const guest = await makeDevice(server, undefined, undefined, undefined, undefined, { id: CLIENTA });
    devices.push(guest);
    await guest.engine.syncNow();
    expect(guest.tree.hasNoProjects()).toBe(true);
    const signOut = vi.fn();
    mount(guest, <NoProjectsOpen />, signOut);
    await wait(60);
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const press = () => act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Sign out')!.click());
    act(() => setDraft(Symbol('cuadro'), true, { text: 'A medio escribir' }));
    await press();
    expect(ask).toHaveBeenCalledWith(signOutQuestion(0, 0, 1));
    expect(signOut).not.toHaveBeenCalled();
    // Sin nada escrito ni pendiente, sale sin preguntar.
    act(() => closeComments());
    ask.mockClear();
    await press();
    expect(ask).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalled();
  });
});
