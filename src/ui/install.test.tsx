// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prefs } from '../prefs';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import {
  BANNER_SNOOZE_DAYS,
  bannerDue,
  detectPlatform,
  installState,
  isMobilePlatform,
  isStandalone,
  listenForInstallPrompt,
  promptInstall,
  readBannerStamp,
  resetInstallForTests,
  tabFor,
  useInstallDialogOpen,
  type InstallPlatform,
} from './install';
import { InstallBanner, InstallHost } from './InstallBanner';
import { AccountMenu } from './menus';

// Instalar la app (Docs/Doc_Instalar.md): qué plataforma se reconoce, cuándo cuenta como instalada, el pedido de
// instalar de Chrome, el aviso del teléfono (que con "Not now" no vuelve por un mes), la entrada del menú de la
// cuenta y la ventana con los pasos de cada plataforma.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1',
  iphoneFirefox:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/141.0 Mobile/15E148 Safari/605.1.15',
  iphoneInstagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 390.0.0.28.85 (iPhone15,3; iOS 18_5; en_US)',
  iphoneGoogleApp:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/380.0.775 Mobile/15E148 Safari/604.1',
  iphoneWebView: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  ipadSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
  androidSamsung:
    'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  windowsChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  windowsEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  macChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  windowsFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0',
};

/** Cambia lo que dice el navegador de sí mismo (jsdom deja redefinirlo). */
function setDevice(userAgent: string, maxTouchPoints = 0) {
  Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true });
}

/** `matchMedia` de jsdom no existe: uno que responde `true` solo a lo que se pide. */
function stubDisplayMode(mode: string | null) {
  const listeners: (() => void)[] = [];
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: mode !== null && query === `(display-mode: ${mode})`,
    media: query,
    addEventListener: (_: string, fn: () => void) => listeners.push(fn),
    removeEventListener: () => undefined,
  }));
  return listeners;
}

/** Un `beforeinstallprompt` como el de Chrome, con lo que contesta la persona. */
function promptEvent(outcome: 'accepted' | 'dismissed') {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string }>;
  };
  event.prompt = vi.fn(async () => undefined);
  event.userChoice = Promise.resolve({ outcome });
  return event;
}

const roots: Root[] = [];
const devices: Device[] = [];
let stopListening: (() => void) | null = null;

async function mount(node: React.ReactNode): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return host;
}

/** Espera a que baje la ventana de pasos (se carga aparte). */
async function dialog(): Promise<HTMLElement> {
  for (let i = 0; i < 50; i++) {
    const el = document.querySelector<HTMLElement>('.install-dialog');
    if (el) return el;
    await act(async () => new Promise((r) => setTimeout(r, 20)));
  }
  throw new Error('no apareció la ventana de pasos');
}

const buttonByText = (root: ParentNode, text: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);

beforeEach(() => {
  resetInstallForTests();
  localStorage.clear();
  stubDisplayMode(null);
  setDevice(UA.windowsChrome);
  act(() => prefs.set({ language: 'en' }));
});

afterEach(async () => {
  stopListening?.();
  stopListening = null;
  for (const root of roots.splice(0)) act(() => root.unmount());
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
  }
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  delete (navigator as Navigator & { standalone?: boolean }).standalone;
  act(() => prefs.set({ language: 'en' }));
});

describe('plataforma', () => {
  const cases: [string, number, InstallPlatform][] = [
    [UA.iphoneSafari, 5, 'ios-safari'],
    [UA.ipadSafari, 5, 'ios-safari'],
    [UA.iphoneChrome, 5, 'ios-browser'],
    [UA.iphoneFirefox, 5, 'ios-browser'],
    [UA.iphoneInstagram, 5, 'ios-inapp'],
    [UA.iphoneGoogleApp, 5, 'ios-inapp'],
    [UA.iphoneWebView, 5, 'ios-inapp'],
    [UA.androidChrome, 5, 'android'],
    [UA.androidSamsung, 5, 'android'],
    [UA.windowsChrome, 0, 'desktop-chromium'],
    [UA.windowsEdge, 0, 'desktop-chromium'],
    [UA.macChrome, 0, 'desktop-chromium'],
    [UA.macSafari, 0, 'mac-safari'],
    [UA.windowsFirefox, 0, 'desktop-other'],
  ];

  it.each(cases)('%s → %s', (userAgent, maxTouchPoints, expected) => {
    expect(detectPlatform({ userAgent, maxTouchPoints })).toBe(expected);
  });

  it('cada plataforma abre su pestaña, y el aviso es solo de teléfonos y tabletas', () => {
    expect(tabFor('ios-inapp')).toBe('iphone');
    expect(tabFor('android')).toBe('android');
    expect(tabFor('mac-safari')).toBe('computer');
    expect(tabFor('desktop-other')).toBe('computer');
    expect(isMobilePlatform('ios-browser')).toBe(true);
    expect(isMobilePlatform('android')).toBe(true);
    expect(isMobilePlatform('desktop-chromium')).toBe(false);
    expect(isMobilePlatform('mac-safari')).toBe(false);
  });
});

describe('instalada o no', () => {
  it('en una pestaña del navegador no; abierta como app (cualquier display-mode de app, o el iPhone viejo), sí', () => {
    expect(isStandalone()).toBe(false);
    for (const mode of ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay']) {
      stubDisplayMode(mode);
      expect(isStandalone(), mode).toBe(true);
    }
    stubDisplayMode('browser');
    expect(isStandalone()).toBe(false);
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    expect(isStandalone()).toBe(true);
  });

  it('pasar a app (display-mode cambia) se nota sin recargar', () => {
    const listeners = stubDisplayMode(null);
    stopListening = listenForInstallPrompt();
    expect(installState().installed).toBe(false);
    stubDisplayMode('standalone');
    listeners.forEach((fn) => fn());
    expect(installState().installed).toBe(true);
  });
});

describe('el pedido de instalar de Chrome', () => {
  it('se guarda (sin la barrita propia de Chrome), se usa una sola vez y al instalar la app queda instalada', async () => {
    stopListening = listenForInstallPrompt();
    expect(installState().canPrompt).toBe(false);
    expect(await promptInstall()).toBe('unavailable');

    const event = promptEvent('accepted');
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(installState().canPrompt).toBe(true);

    expect(await promptInstall()).toBe('accepted');
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(installState().canPrompt).toBe(false);
    expect(await promptInstall()).toBe('unavailable');

    window.dispatchEvent(new Event('appinstalled'));
    expect(installState().installed).toBe(true);
    // El aviso del teléfono no vuelve en esta pestaña del navegador.
    expect(bannerDue(readBannerStamp())).toBe(false);
  });

  it('si la persona dice que no, se puede volver a ofrecer cuando el navegador lo mande de nuevo', async () => {
    stopListening = listenForInstallPrompt();
    window.dispatchEvent(promptEvent('dismissed'));
    expect(await promptInstall()).toBe('dismissed');
    expect(installState()).toEqual({ installed: false, canPrompt: false });
    window.dispatchEvent(promptEvent('accepted'));
    expect(installState().canPrompt).toBe(true);
  });
});

describe('el aviso del teléfono', () => {
  it('vuelve recién al mes de cerrarlo (y con una fecha rota o del futuro, sale)', () => {
    const now = Date.UTC(2026, 9, 1);
    const day = 24 * 60 * 60 * 1000;
    expect(bannerDue(null, now)).toBe(true);
    expect(bannerDue('basura', now)).toBe(true);
    expect(bannerDue(String(now - day), now)).toBe(false);
    expect(bannerDue(String(now - (BANNER_SNOOZE_DAYS - 1) * day), now)).toBe(false);
    expect(bannerDue(String(now - BANNER_SNOOZE_DAYS * day), now)).toBe(true);
    expect(bannerDue(String(now + 5 * day), now)).toBe(true);
  });

  it('sale en el iPhone; "Not now" lo esconde y no vuelve al abrir de nuevo', async () => {
    setDevice(UA.iphoneSafari, 5);
    const host = await mount(<InstallBanner />);
    expect(host.querySelector('.install-banner')).not.toBeNull();
    expect(host.textContent).toContain('Install the app');
    await act(async () => buttonByText(host, 'Not now')!.click());
    expect(host.querySelector('.install-banner')).toBeNull();
    expect(readBannerStamp()).not.toBeNull();
    const again = await mount(<InstallBanner />);
    expect(again.querySelector('.install-banner')).toBeNull();
  });

  it('no sale en la computadora, ni en la app instalada', async () => {
    setDevice(UA.windowsChrome);
    expect((await mount(<InstallBanner />)).querySelector('.install-banner')).toBeNull();
    setDevice(UA.androidChrome, 5);
    stubDisplayMode('standalone');
    stopListening = listenForInstallPrompt();
    expect((await mount(<InstallBanner />)).querySelector('.install-banner')).toBeNull();
  });

  it('en Android con el pedido de Chrome, "Install" instala directo; en el iPhone, abre los pasos', async () => {
    setDevice(UA.androidChrome, 5);
    stopListening = listenForInstallPrompt();
    const event = promptEvent('accepted');
    act(() => {
      window.dispatchEvent(event);
    });
    const host = await mount(
      <>
        <InstallBanner />
        <InstallHost />
      </>,
    );
    await act(async () => buttonByText(host, 'Install')!.click());
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.install-dialog')).toBeNull();

    resetInstallForTests();
    setDevice(UA.iphoneSafari, 5);
    const ios = await mount(
      <>
        <InstallBanner />
        <InstallHost />
      </>,
    );
    await act(async () => buttonByText(ios.querySelector('.install-banner')!, 'Install')!.click());
    const d = await dialog();
    expect(d.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain('iPhone · iPad');
  });
});

describe('la ventana de pasos', () => {
  function Opener() {
    const open = useInstallDialogOpen();
    return <span data-open={open} />;
  }

  async function openDialog(): Promise<HTMLElement> {
    const { openInstallDialog } = await import('./install');
    await mount(
      <>
        <Opener />
        <InstallHost />
      </>,
    );
    act(() => openInstallDialog());
    return dialog();
  }

  it('en el iPhone: los cuatro pasos con su dibujo, y las otras plataformas en pestañas (también con las flechas)', async () => {
    setDevice(UA.iphoneSafari, 5);
    const d = await openDialog();
    const tabs = [...d.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(['iPhone · iPad', 'Android', 'Computer']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    const steps = d.querySelectorAll('.install-step');
    expect(steps).toHaveLength(4);
    expect([...steps].every((s) => s.querySelector('.install-fig .fig'))).toBe(true);
    expect(steps[0].textContent).toContain('Share');
    expect(steps[1].textContent).toContain('Add to Home Screen');
    expect(steps[2].textContent).toContain('Open as Web App');
    expect(steps[3].textContent).toContain('All synced');
    // Lo que se ve escrito en el teléfono va en negrita.
    expect(steps[1].querySelector('strong')?.textContent).toBe('Add to Home Screen');

    await act(async () => tabs[1].click());
    expect(d.querySelectorAll('.install-step')).toHaveLength(4);
    expect(d.textContent).toContain('Install app');
    expect(d.textContent).toContain('Samsung Internet');

    await act(async () => tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs[2]);
    expect(d.querySelectorAll('.install-group')).toHaveLength(2);
    expect(d.textContent).toContain('Firefox');
    // Sin el pedido de Chrome no hay botón para instalar directo.
    expect(buttonByText(d, 'Install')).toBeUndefined();
  });

  it('en un navegador adentro de otra app: abrí en Safari, con el link para copiar', async () => {
    setDevice(UA.iphoneInstagram, 5);
    const d = await openDialog();
    expect(d.querySelector('.install-warn')?.textContent).toContain('Safari');
    expect(buttonByText(d, 'Copy link')).toBeDefined();
  });

  it('en Chrome con el pedido: el botón "Install" instala y cierra; Esc cierra', async () => {
    setDevice(UA.windowsChrome);
    stopListening = listenForInstallPrompt();
    const event = promptEvent('accepted');
    act(() => {
      window.dispatchEvent(event);
    });
    const d = await openDialog();
    expect(d.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain('Computer');
    await act(async () => buttonByText(d, 'Install')!.click());
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.install-dialog')).toBeNull();

    const again = await openDialog();
    expect(again.textContent).not.toContain('Your browser can install it');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(document.querySelector('.install-dialog')).toBeNull();
  });

  it('en castellano', async () => {
    act(() => prefs.set({ language: 'es' }));
    setDevice(UA.androidChrome, 5);
    const d = await openDialog();
    expect(d.textContent).toContain('Instalar Shot Docs');
    expect(d.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain('Android');
    expect(d.textContent).toContain('Tocá el menú ⋮');
  });
});

describe('el menú de la cuenta', () => {
  async function menu(): Promise<HTMLElement> {
    const server = new FakeServer();
    const d = await makeDevice(server);
    devices.push(d);
    const config = {
      url: 'https://znlvpuddswymxpffgvbz.supabase.co',
      publishableKey: 'sb_publishable_test',
      name: 'Wanka',
      localKey: WANKA_LOCAL_KEY,
      storage: legacyStorageNames(WANKA_LOCAL_KEY),
    };
    const client = { auth: { signOut: async () => ({ error: null }) } } as never;
    const services: Services = {
      workspace: { config, client },
      client,
      user: { id: server.ownerId, email: 'owner@test' },
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
    return mount(
      <ServicesContext.Provider value={services}>
        <AccountMenu position={{ top: 0, left: 0 }} anchor={null} onClose={() => undefined} />
        <InstallHost />
      </ServicesContext.Provider>,
    );
  }

  it('ofrece "Install app" (con su tooltip, sin title) y abre los pasos', async () => {
    const host = await menu();
    const entry = buttonByText(host, 'Install app')!;
    expect(entry).toBeDefined();
    expect(entry.hasAttribute('title')).toBe(false);
    expect(entry.dataset.tip).toContain('Steps for iPhone, Android and computer');
    await act(async () => entry.click());
    await dialog();
  });

  it('abierta como app instalada, no la ofrece', async () => {
    stubDisplayMode('standalone');
    stopListening = listenForInstallPrompt();
    const host = await menu();
    expect(buttonByText(host, 'Install app')).toBeUndefined();
    expect(host.textContent).toContain('Sign out');
  });
});
