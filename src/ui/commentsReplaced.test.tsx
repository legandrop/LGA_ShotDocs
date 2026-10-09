// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prefs } from '../prefs';
import { settled } from '../test/settle';
import { navigate, pagePath } from '../router';
import type { Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY, WorkspaceContext } from '../workspace';
import { closeComments, draftLossAccepted, dropLeftDrafts, hasDrafts, leftDraftsNow, showComments, withdrawDraftLoss } from './commentsUi';
import { AppBarrier } from './ErrorBarrier';
import { pageReload, reloadByHand, reloadTimings } from './lazyPart';
import { setNavOpen } from './navStore';
import { notify } from './notice';
import { Workspace } from './Workspace';

// Un comentario a medio escribir cuando la app se reemplaza sola (Docs/Doc_Sincronizacion.md, "Un cuadro abierto y lo
// que llega de afuera"), con la app montada entera desde `Workspace` y la barrera de la raíz: otra pestaña toma el
// control, sacan a la persona del workspace, se queda sin proyectos, o un error frena la app. La pantalla que dibuja el
// aviso se va con el cuadro: lo tipeado queda en un cartel fijo (LeftDrafts.tsx) hasta que la persona lo copia o lo
// descarta. Y la pregunta del navegador al recargar no repite la de la app.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// Monta el editor: con la máquina cargada, en jsdom tarda.
vi.setConfig({ testTimeout: 120_000 });

// El arranque (la base del dispositivo, el lock de la pestaña) lo maneja la prueba: así puede pasar a «otra pestaña
// tomó el control» como lo hace `useBootServices` cuando pierde el lock.
const bootState = vi.hoisted(() => ({ current: { state: 'loading' } as unknown, listeners: new Set<() => void>() }));
vi.mock('../services', async (original) => {
  const real = await original<typeof import('../services')>();
  const { useSyncExternalStore } = await import('react');
  return {
    ...real,
    useBootServices: () =>
      useSyncExternalStore(
        (fn: () => void) => {
          bootState.listeners.add(fn);
          return () => bootState.listeners.delete(fn);
        },
        () => bootState.current,
      ),
  };
});
// Una clave del asistente guardada en el dispositivo: salir de la cuenta abre la ventana de salir (SignOutDialog).
const keyState = vi.hoisted(() => ({ has: false }));
vi.mock('../assistant/keyStore', async (original) => {
  const real = await original<typeof import('../assistant/keyStore')>();
  return { ...real, hasAssistantKey: async () => keyState.has };
});
const setBoot = (next: unknown) =>
  act(() => {
    bootState.current = next;
    for (const fn of bootState.listeners) fn();
  });

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
const TYPED = 'Respuesta a medio escribir';

const roots: Root[] = [];
const devices: Device[] = [];
const pagehideMs = reloadTimings.pagehideMs;

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
  act(() => setNavOpen(false));
  act(() => prefs.set({ language: 'en' }));
  act(() => dropLeftDrafts());
  withdrawDraftLoss();
  reloadTimings.pagehideMs = pagehideMs;
  keyState.has = false;
  bootState.current = { state: 'loading' };
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
const boxes = () => [...(panel()?.querySelectorAll<HTMLTextAreaElement>('textarea') ?? [])];
const inPanel = (label: string) => [...(panel()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) => b.textContent === label);
const card = () => document.querySelector<HTMLElement>('.left-drafts');
const inCard = (label: string) => [...(card()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) => b.textContent === label);
const typeIn = (el: HTMLTextAreaElement, text: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
/** Si cerrar o recargar el navegador preguntaría. */
const browserAsks = () => {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
};
function clipboard(): string[] {
  const copied: string[] = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => void copied.push(text) } });
  return copied;
}

function services(d: Device, signOut: () => unknown): Services {
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

/**
 * La app entera como la monta main.tsx (la barrera de la raíz y adentro `Workspace`) con una página abierta, el panel
 * abierto y una respuesta a medio escribir. `root`: para cambiar lo que se dibuja adentro de la barrera (salir de la cuenta).
 */
async function openApp(d: Device, page: string, signOut: () => unknown = () => undefined): Promise<Root> {
  vi.spyOn(prefs, 'attach').mockResolvedValue(undefined);
  vi.spyOn(prefs, 'detach').mockImplementation(() => undefined);
  history.replaceState(null, '', pagePath(page));
  const value = services(d, signOut);
  bootState.current = { state: 'ready', services: value };
  const host = document.createElement('div');
  host.id = 'root';
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <AppBarrier>
        <WorkspaceContext.Provider value={value.workspace}>
          <Workspace user={value.user} />
        </WorkspaceContext.Provider>
      </AppBarrier>,
    ),
  );
  await until(() => document.querySelector('textarea.page-title'), 'el título de la página abierta');
  act(() => showComments(null));
  await until(() => inPanel('Reply'), 'el panel con el hilo');
  await act(async () => inPanel('Reply')!.click());
  await typeIn(boxes()[0], TYPED);
  expect(hasDrafts()).toBe(true);
  return root;
}

async function owner(signOut?: () => unknown) {
  const server = new FakeServer();
  server.enableComments();
  const d = await makeDevice(server);
  devices.push(d);
  const page = await d.tree.create(null, 'Brief');
  const other = await d.tree.create(null, 'Otra');
  await d.comments.add(page, null, 'Original');
  await d.engine.syncNow();
  const root = await openApp(d, page, signOut);
  return { server, d, page, other, root };
}

/** Una invitada que puede comentar Brief, con la app abierta ahí y una respuesta a medio escribir. */
async function guest() {
  const server = new FakeServer();
  server.enableComments();
  server.addMember(CLIENTA, 'guest', 'clienta@cliente.com');
  const boss = await makeDevice(server);
  devices.push(boss);
  const page = await boss.tree.create(null, 'Brief');
  await boss.comments.add(page, null, 'Original');
  await boss.engine.syncNow();
  server.grant(CLIENTA, { pageId: page }, 'comment');
  const d = await makeDevice(server, undefined, undefined, undefined, undefined, { id: CLIENTA });
  devices.push(d);
  await d.engine.syncNow();
  await openApp(d, page);
  /** Baja en el dispositivo de la invitada lo que cambió en la base. */
  const sync = async () => {
    server.clockOffset += 11_000;
    await act(async () => d.engine.syncNow());
    await wait(60);
  };
  return { server, d, page, sync };
}

/** Cada camino lleva la app a su pantalla de reemplazo; devuelve un texto de esa pantalla. */
const PATHS = {
  'otra pestaña toma el control': async () => {
    await owner();
    await setBoot({ state: 'lost' });
    return 'Another window took over';
  },
  'sacaron a la persona del workspace': async () => {
    const { server, sync } = await guest();
    server.removeMember(CLIENTA);
    await sync();
    return 'You no longer have access to this workspace';
  },
  'se quedó sin ningún proyecto': async () => {
    const { server, sync } = await guest();
    server.grants.splice(server.grants.findIndex((g) => g.user_id === CLIENTA), 1);
    await sync();
    // La dirección es la de una página: la pantalla sin acceso (NoProjectsAccess), en lugar de «No projects yet».
    return 'This page does not exist or you do not have access to it.';
  },
  'un error frena la app': async () => {
    const { d } = await owner();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(d.tree, 'ancestors').mockImplementation(() => {
      throw new Error('boom');
    });
    await act(async () => setNavOpen(true));
    return 'Something went wrong';
  },
} as const;

describe('la app se reemplaza sola con un comentario a medio escribir', () => {
  it.each(Object.keys(PATHS) as (keyof typeof PATHS)[])('%s: lo tipeado queda a la vista en un cartel fijo, con su Copy text', async (path) => {
    const screen = await PATHS[path]();
    await until(() => shown().includes(screen), 'la pantalla de reemplazo');
    await wait(60);
    // La app ya no está (ni el panel ni la pantalla que dibuja el aviso), y el cartel sí, con el texto entero.
    expect(panel()).toBeNull();
    expect(document.querySelector('.notice')).toBeNull();
    expect(card()).not.toBeNull();
    expect(card()!.textContent).toContain('A comment you were writing was not sent.');
    expect([...card()!.querySelectorAll('.left-draft')].map((p) => p.textContent)).toEqual([TYPED]);
    expect(inCard('Copy text')).toBeDefined();
    // No vence: sigue ahí un rato después.
    await wait(300);
    expect(card()!.textContent).toContain(TYPED);
  });

  it('copiarlo lo deja a la vista (dice que se copió) y deja de frenar la recarga; descartarlo sin copiar pregunta antes', async () => {
    await PATHS['otra pestaña toma el control']();
    await until(() => card(), 'el cartel');
    // Sin copiarlo, recargar o cerrar el navegador pregunta: el texto está solo en esta ventana.
    expect(browserAsks()).toBe(true);
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => inCard('Discard')!.click());
    expect(ask).toHaveBeenCalledWith('Discard what you wrote?');
    expect(card()).not.toBeNull();
    const copied = clipboard();
    await act(async () => inCard('Copy text')!.click());
    await wait();
    expect(copied).toEqual([TYPED]);
    expect(inCard('Copied')).toBeDefined();
    expect(card()!.textContent).toContain(TYPED);
    expect(browserAsks()).toBe(false);
    // Copiado, descartarlo ya no pregunta.
    ask.mockClear();
    await act(async () => inCard('Discard')!.click());
    expect(ask).not.toHaveBeenCalled();
    expect(card()).toBeNull();
  });

  it('con varios cuadros, el cartel los muestra todos en el orden del panel y su botón los copia juntos', async () => {
    const { root } = await owner();
    void root;
    await act(async () => inPanel('Edit')!.click());
    await typeIn(boxes()[0], 'Edición a medio escribir');
    await setBoot({ state: 'lost' });
    await until(() => card(), 'el cartel');
    expect(card()!.textContent).toContain('2 comments you were writing were not sent.');
    expect([...card()!.querySelectorAll('.left-draft')].map((p) => p.textContent)).toEqual(['Edición a medio escribir', TYPED]);
    const copied = clipboard();
    await act(async () => inCard('Copy all 2')!.click());
    await wait();
    expect(copied).toEqual([`Edición a medio escribir\n\n${TYPED}`]);
  });

  it('en castellano', async () => {
    await owner();
    act(() => prefs.set({ language: 'es' }));
    await setBoot({ state: 'lost' });
    await until(() => card(), 'el cartel');
    expect(card()!.textContent).toContain('Un comentario que estabas escribiendo no se mandó.');
    expect(inCard('Copiar el texto')).toBeDefined();
    expect(inCard('Descartar')).toBeDefined();
  });
});

describe('lo que no cambia', () => {
  it('cambiar de página con la app a la vista sigue siendo el aviso de siempre, sin cartel', async () => {
    const { other } = await owner();
    await act(async () => navigate(pagePath(other)));
    await until(() => document.querySelector<HTMLTextAreaElement>('textarea.page-title')?.value === 'Otra', 'la otra página');
    await wait(60);
    expect(document.querySelector('.notice')!.textContent).toContain('A comment you were writing was closed before you sent it.');
    expect(card()).toBeNull();
  });

  it('salir de la cuenta diciendo que sí a perderlo no lo deja en el cartel; sin preguntar (la sesión venció), sí', async () => {
    const signOut = vi.fn(async () => ({ error: null }));
    const { root } = await owner(signOut);
    // Dos cuadros: el «sí» vale para los dos, que se cierran con la misma salida.
    await act(async () => inPanel('Edit')!.click());
    await typeIn(boxes()[0], 'Edición a medio escribir');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => document.querySelector<HTMLButtonElement>('.account-button')!.click());
    const button = [...document.querySelectorAll<HTMLButtonElement>('.account-menu button')].find((b) => b.textContent?.trim() === 'Sign out');
    await act(async () => button!.click());
    await until(() => signOut.mock.calls.length > 0, 'la salida de la cuenta');
    // Sin sesión, la app de adentro de la barrera cambia por la entrada (como hace App).
    act(() => root.render(<AppBarrier><main>login</main></AppBarrier>));
    await wait(60);
    expect(shown()).toContain('login');
    expect(card()).toBeNull();
  });

  it('la sesión que se corta sin que nadie pregunte deja el texto en el cartel', async () => {
    const { root } = await owner();
    act(() => root.render(<AppBarrier><main>login</main></AppBarrier>));
    await until(() => card(), 'el cartel');
    expect([...card()!.querySelectorAll('.left-draft')].map((p) => p.textContent)).toEqual([TYPED]);
  });

  it('el aviso común anota su alto en la app mientras está a la vista (los apilados del teléfono se corren con él)', async () => {
    await owner();
    const shell = document.querySelector<HTMLElement>('.shell')!;
    expect(shell.style.getPropertyValue('--notice-height')).toBe('');
    act(() => notify('Link copied'));
    await wait();
    // jsdom no mide: el alto es 0, pero la variable está.
    expect(shell.style.getPropertyValue('--notice-height')).toBe('0px');
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.notice button')].find((b) => b.textContent === 'OK')!.click());
    expect(shell.style.getPropertyValue('--notice-height')).toBe('');
  });
});

describe('una sola pregunta al recargar', () => {
  it('con el «sí» a la pregunta de la app, el navegador no pregunta de nuevo; si la recarga no ocurre, vuelve a preguntar', async () => {
    await owner();
    expect(browserAsks()).toBe(true);
    reloadTimings.pagehideMs = 200;
    const reload = vi.spyOn(pageReload, 'now').mockImplementation(() => undefined);
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(true);
    act(() => { void reloadByHand(); });
    expect(ask).toHaveBeenCalledWith('A comment you wrote has not been sent. Reload anyway and lose it?');
    await until(() => reload.mock.calls.length > 0, 'la recarga');
    // La recarga se pidió con el cuadro todavía montado: la pregunta del navegador no repite la de la app.
    expect(hasDrafts()).toBe(true);
    expect(draftLossAccepted()).toBe(true);
    expect(browserAsks()).toBe(false);
    // La página no se fue (acá, `pageReload` no recarga): el «sí» deja de valer y el navegador vuelve a preguntar.
    await until(() => !draftLossAccepted(), 'que el «sí» deje de valer');
    expect(browserAsks()).toBe(true);
  });

  it('escribir algo más después del «sí» vuelve a preguntar; decir que no deja todo como estaba', async () => {
    await owner();
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    act(() => { void reloadByHand(); });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(draftLossAccepted()).toBe(false);
    expect(browserAsks()).toBe(true);
    // Un «sí» y, mientras la página todavía no se fue (el «sí» sigue valiendo), se sigue escribiendo: eso lo anula.
    reloadTimings.pagehideMs = 60_000;
    const reload = vi.spyOn(pageReload, 'now').mockImplementation(() => undefined);
    ask.mockReturnValue(true);
    act(() => { void reloadByHand(); });
    await until(() => reload.mock.calls.length > 0, 'la recarga');
    expect(draftLossAccepted()).toBe(true);
    expect(browserAsks()).toBe(false);
    await typeIn(boxes()[0], `${TYPED}, y algo más`);
    expect(draftLossAccepted()).toBe(false);
    expect(browserAsks()).toBe(true);
  });
});

// --- La ronda de corrección de la auditoría ---------------------------------------------------------------------------

/** La app de otra cuenta (la invitada) en la misma raíz. */
async function renderOther(root: Root, d2: Device): Promise<void> {
  const v2 = services(d2, () => undefined);
  bootState.current = { state: 'ready', services: v2 };
  act(() =>
    root.render(
      <AppBarrier>
        <WorkspaceContext.Provider value={v2.workspace}>
          <Workspace user={v2.user} />
        </WorkspaceContext.Provider>
      </AppBarrier>,
    ),
  );
  await until(() => document.querySelector('.shell'), 'la app de la otra cuenta');
  await wait(100);
}

/** La misma cuenta vuelve a entrar (la app de vuelta, con el cartel arriba). */
async function renderAgain(root: Root, d: Device, signOut: () => unknown = () => undefined): Promise<void> {
  const v1 = services(d, signOut);
  bootState.current = { state: 'ready', services: v1 };
  act(() => root.render(<AppBarrier><WorkspaceContext.Provider value={v1.workspace}><Workspace user={v1.user} /></WorkspaceContext.Provider></AppBarrier>));
  await until(() => document.querySelector('textarea.page-title'), 'la app de vuelta');
}

/** La dueña (que comparte Brief con la invitada) con la app abierta y una respuesta a medio escribir. */
async function ownerWithGuest(signOut?: () => unknown) {
  const server = new FakeServer();
  server.enableComments();
  server.addMember(CLIENTA, 'guest', 'clienta@cliente.com');
  const d = await makeDevice(server);
  devices.push(d);
  const page = await d.tree.create(null, 'Brief');
  await d.comments.add(page, null, 'Original');
  await d.engine.syncNow();
  server.grant(CLIENTA, { pageId: page }, 'comment');
  const root = await openApp(d, page, signOut);
  const guestDevice = async () => {
    const d2 = await makeDevice(server, undefined, undefined, undefined, undefined, { id: CLIENTA });
    devices.push(d2);
    await d2.engine.syncNow();
    return d2;
  };
  return { d, page, root, guestDevice };
}

/** La invitada con la app abierta en Brief, una respuesta a medio escribir y la forma de bajar lo que cambió. */
async function guestWithBox(signOut: () => unknown) {
  const server = new FakeServer();
  server.enableComments();
  server.addMember(CLIENTA, 'guest', 'clienta@cliente.com');
  const boss = await makeDevice(server);
  devices.push(boss);
  const page = await boss.tree.create(null, 'Brief');
  await boss.comments.add(page, null, 'Original');
  await boss.engine.syncNow();
  server.grant(CLIENTA, { pageId: page }, 'comment');
  const d = await makeDevice(server, undefined, undefined, undefined, undefined, { id: CLIENTA });
  devices.push(d);
  await d.engine.syncNow();
  await openApp(d, page, signOut);
  const sync = async () => {
    server.clockOffset += 11_000;
    await act(async () => d.engine.syncNow());
    await wait(60);
  };
  return { server, sync };
}

const signOutFromMenu = async () => {
  if (!document.querySelector('.account-menu')) await act(async () => document.querySelector<HTMLButtonElement>('.account-button')!.click());
  const button = [...document.querySelectorAll<HTMLButtonElement>('.account-menu button')].find((b) => b.textContent?.trim() === 'Sign out');
  await act(async () => button!.click());
};
const buttonNamed = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label);
const SIGN_OUT_LOSES = 'A comment you wrote has not been sent and will be lost. Sign out anyway?';

describe('el cartel es de la cuenta que lo escribió', () => {
  it('se corta la sesión y entra otra cuenta en la misma ventana: el texto no le llega, ni queda en memoria', async () => {
    const { root, guestDevice } = await ownerWithGuest();
    act(() => root.render(<AppBarrier><main>login</main></AppBarrier>));
    await until(() => card(), 'el cartel en la entrada');
    // En la entrada, el de la última cuenta (D348).
    expect(card()!.textContent).toContain(TYPED);
    await renderOther(root, await guestDevice());
    expect(card()).toBeNull();
    expect(leftDraftsNow().texts).toEqual([]);
  });

  it('otra cuenta que entra en el mismo paso (Workspace con otra clave) no recibe el texto ni en el cartel ni en un aviso', async () => {
    const notices: string[] = [];
    const onNotice = (e: Event) => notices.push(JSON.stringify((e as CustomEvent).detail));
    window.addEventListener('shotdocs:notice', onNotice);
    try {
      const { root, guestDevice } = await ownerWithGuest();
      const d2 = await guestDevice();
      const v2 = services(d2, () => undefined);
      bootState.current = { state: 'ready', services: v2 };
      // Como App.tsx: `<Workspace key={auth.user.id}>`; el árbol de la dueña se desmonta y el de la invitada se monta juntos.
      act(() =>
        root.render(
          <AppBarrier>
            <WorkspaceContext.Provider value={v2.workspace}>
              <Workspace key={v2.user.id} user={v2.user} />
            </WorkspaceContext.Provider>
          </AppBarrier>,
        ),
      );
      await until(() => document.querySelector('.shell'), 'la app de la invitada');
      await wait(100);
      expect(card()).toBeNull();
      expect(leftDraftsNow().texts).toEqual([]);
      expect(notices.join('|')).not.toContain('closed before you sent');
      expect(shown()).not.toContain(TYPED);
    } finally {
      window.removeEventListener('shotdocs:notice', onNotice);
    }
  });

  it('con el cartel sin copiar, salir de la cuenta desde el menú pregunta; con un «no» sigue, con un «sí» se va antes de que entre otra', async () => {
    const signOut = vi.fn(async () => ({ error: null }));
    const { d, root, guestDevice } = await ownerWithGuest(signOut);
    // Se corta la sesión, la misma persona vuelve a entrar: la app vuelve con el cartel arriba, sin cuadros abiertos.
    act(() => root.render(<AppBarrier><main>login</main></AppBarrier>));
    await until(() => card(), 'el cartel');
    await renderAgain(root, d, signOut);
    expect(card()!.textContent).toContain(TYPED);
    expect(hasDrafts()).toBe(false);
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await signOutFromMenu();
    expect(ask).toHaveBeenCalledWith(SIGN_OUT_LOSES);
    expect(signOut).not.toHaveBeenCalled();
    expect(card()!.textContent).toContain(TYPED);
    ask.mockReturnValue(true);
    await signOutFromMenu();
    await until(() => signOut.mock.calls.length > 0, 'la salida');
    expect(leftDraftsNow().texts).toEqual([]);
    act(() => root.render(<AppBarrier><main>login</main></AppBarrier>));
    await renderOther(root, await guestDevice());
    expect(shown()).not.toContain(TYPED);
  });

  it('copiado, salir no pregunta por él', async () => {
    const signOut = vi.fn(async () => ({ error: null }));
    const { d, root } = await ownerWithGuest(signOut);
    act(() => root.render(<AppBarrier><main>login</main></AppBarrier>));
    await until(() => card(), 'el cartel');
    clipboard();
    await act(async () => inCard('Copy text')!.click());
    await until(() => inCard('Copied'), 'copiado');
    await renderAgain(root, d, signOut);
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await signOutFromMenu();
    await until(() => signOut.mock.calls.length > 0, 'la salida');
    expect(ask).not.toHaveBeenCalled();
  });

  it('«Sign out and keep it on this device» (sacaron a la persona) también pregunta por el cartel y, con un «sí», lo descarta', async () => {
    const signOut = vi.fn(async () => ({ error: null }));
    const { server, sync } = await guestWithBox(signOut);
    server.removeMember(CLIENTA);
    await sync();
    await until(() => shown().includes('You no longer have access to this workspace') && card(), 'la pantalla y el cartel');
    const keep = () => buttonNamed('Sign out and keep it on this device')!;
    await until(() => !keep().disabled, 'el botón');
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => keep().click());
    expect(ask).toHaveBeenCalledWith(SIGN_OUT_LOSES);
    expect(signOut).not.toHaveBeenCalled();
    ask.mockReturnValue(true);
    await act(async () => keep().click());
    await until(() => signOut.mock.calls.length > 0, 'la salida');
    expect(leftDraftsNow().texts).toEqual([]);
  });

  it('el Sign out de la pantalla sin proyectos también lo cuenta', async () => {
    const signOut = vi.fn(async () => ({ error: null }));
    const { server, sync } = await guestWithBox(signOut);
    server.grants.splice(server.grants.findIndex((g) => g.user_id === CLIENTA), 1);
    await sync();
    await until(() => card(), 'el cartel');
    // Desde la pantalla sin acceso, *Go to Shot Docs* lleva al inicio: «No projects yet», con su Sign out.
    await act(async () => buttonNamed('Go to Shot Docs')!.click());
    await until(() => buttonNamed('Sign out'), 'la pantalla sin proyectos');
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => buttonNamed('Sign out')!.click());
    expect(ask).toHaveBeenCalledWith(SIGN_OUT_LOSES);
    expect(signOut).not.toHaveBeenCalled();
    ask.mockReturnValue(true);
    await act(async () => buttonNamed('Sign out')!.click());
    await until(() => signOut.mock.calls.length > 0, 'la salida');
    expect(leftDraftsNow().texts).toEqual([]);
  });
});

describe('la ventana de salir que se cancela', () => {
  it.each(['Cancel', 'Escape'] as const)('«sí» a perder el comentario y después %s: no queda nada anotado, y si la app se reemplaza el texto va al cartel', async (how) => {
    keyState.has = true;
    const signOut = vi.fn(async () => ({ error: null }));
    await owner(signOut);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await signOutFromMenu();
    await until(() => document.querySelector('.modal'), 'la ventana de salir');
    if (how === 'Cancel') await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.modal button')].find((b) => b.textContent === 'Cancel')!.click());
    else await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    await until(() => !document.querySelector('.modal'), 'la ventana cerrada');
    await wait(100);
    expect(signOut).not.toHaveBeenCalled();
    expect(boxes()[0].value).toBe(TYPED);
    expect(draftLossAccepted()).toBe(false);
    expect(browserAsks()).toBe(true);
    await setBoot({ state: 'lost' });
    await until(() => card(), 'el cartel');
    expect(card()!.textContent).toContain(TYPED);
  });

  it('una salida que falla deja de valer como «sí»', async () => {
    const signOut = vi.fn(async () => ({ error: new Error('sin red') }));
    await owner(signOut);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await signOutFromMenu();
    await until(() => signOut.mock.calls.length > 0, 'la salida');
    await wait();
    expect(draftLossAccepted()).toBe(false);
    expect(browserAsks()).toBe(true);
  });
});

describe('el cartel acumula y sobrevive', () => {
  it('un segundo reemplazo suma su texto al cartel, no lo pisa', async () => {
    const { d } = await owner();
    await setBoot({ state: 'lost' });
    await until(() => card(), 'el cartel');
    await setBoot({ state: 'ready', services: services(d, () => undefined) });
    await until(() => document.querySelector('textarea.page-title'), 'la app de vuelta');
    act(() => showComments(null));
    await until(() => inPanel('Reply'), 'el panel');
    await act(async () => inPanel('Reply')!.click());
    await typeIn(boxes()[0], 'Segundo texto');
    await setBoot({ state: 'lost' });
    await until(() => card()?.querySelectorAll('.left-draft').length === 2, 'los dos textos');
    expect([...card()!.querySelectorAll('.left-draft')].map((p) => p.textContent)).toEqual([TYPED, 'Segundo texto']);
    expect(inCard('Copy all 2')).toBeDefined();
  });

  it('un error en la raíz (la pantalla de «Something went wrong») no se lleva el cartel', async () => {
    const { root } = await owner();
    await setBoot({ state: 'lost' });
    await until(() => card(), 'el cartel');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Bomb = () => {
      throw new Error('boom en la raíz');
    };
    act(() => root.render(<AppBarrier><Bomb /></AppBarrier>));
    await wait();
    expect(shown()).toContain('Something went wrong');
    expect(card()!.textContent).toContain(TYPED);
  });
});
