// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import '../i18n/lazy/tutorial';
import { prefs } from '../prefs';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { TOUR_STEPS } from '../tutorial/steps';
import { dismissTour, getTourUi, readDeviceTour, tourSignal } from '../tutorial/tourState';
import { closeFindBar } from '../ui/findUi';
import { setNavOpen } from '../ui/navStore';
import { SHORTCUTS } from '../ui/shortcuts';
import { Shell } from '../ui/Workspace';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { entryShortcuts, HELP_ENTRIES } from './entries';
import { closeHelp } from './helpUi';
import { checkHelpNews, hasHelpNews, helpNewsFrom, isNewer, isUnpublished, isValidSince, latestOf, markHelpNewsSeen, readHelpNews, versionValue } from './news';

// La entrega 3 de la ayuda (Docs/Doc_Tutorial.md): las novedades (el punto del "?" con lo nuevo desde la última vez
// que la persona abrió la ayuda, y la lista arriba de todo, que se apaga al verla) y "Mostrame" (la práctica con un
// solo paso de la recorrida, y vuelta a donde estaba la persona).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.setConfig({ testTimeout: 180_000 });

const KEY = 'shotdocs-help-news';
const LATEST = latestOf(HELP_ENTRIES.map((e) => e.since));

describe('las versiones y los since', () => {
  it('se comparan como números; lo sin publicar es lo más nuevo; lo que no se entiende, nunca', () => {
    expect(isNewer('0.100', '0.099')).toBe(true);
    expect(isNewer('0.099', '0.100')).toBe(false);
    expect(isNewer('1.001', '0.999')).toBe(true);
    // Con X en lugar del número: todavía no se publicó (quien publica pone la versión).
    expect(isUnpublished('0.0' + 'XX')).toBe(true);
    expect(isNewer('0.0' + 'XX', '0.154')).toBe(true);
    expect(isNewer('0.0' + 'XX', '0.0' + 'XX')).toBe(false);
    expect(isNewer('basura', '0.001')).toBe(false);
    expect(isNewer('0.200', 'basura')).toBe(false);
    expect(Number.isNaN(versionValue(''))).toBe(true);
    expect(latestOf(['0.081', '0.150', '0.104'])).toBe('0.150');
    expect(latestOf([])).toBe('');
  });

  it('cada entrada de la ayuda tiene un since válido, y ninguno es anterior a lo que había antes de la ayuda', () => {
    for (const e of HELP_ENTRIES) {
      expect(isValidSince(e.since), `${e.id}: ${e.since}`).toBe(true);
      expect(versionValue(e.since) >= versionValue('0.081'), e.id).toBe(true);
    }
    // Lo de esta entrega: novedades y "Mostrame" en Primeros pasos, y Google Drive en Archivos adjuntos (solo el dueño).
    const ids = HELP_ENTRIES.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(['news', 'showMe', 'driveConnect']));
    expect(HELP_ENTRIES.find((e) => e.id === 'driveConnect')?.when).toBe('owner');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('el registro de atajos sigue completo: cada atajo que nombra una entrada existe', () => {
    const known = new Set(SHORTCUTS.map((s) => s.id));
    for (const e of HELP_ENTRIES) for (const id of entryShortcuts(e)) expect(known.has(id), `${e.id} → ${id}`).toBe(true);
  });

  it('cada "Mostrame" apunta a un paso de la recorrida, y cada paso con algo para mostrar tiene su entrada', () => {
    const steps = new Set(TOUR_STEPS.map((s) => s.id));
    const shown = new Set<string>();
    for (const e of HELP_ENTRIES) {
      if (!e.showMe) continue;
      expect(steps.has(e.showMe), `${e.id} → ${e.showMe}`).toBe(true);
      shown.add(e.showMe);
    }
    // El saludo no muestra nada y el "?" es la ayuda misma.
    for (const s of TOUR_STEPS) if (s.id !== 'hello' && s.id !== 'help') expect(shown.has(s.id), s.id).toBe(true);
  });
});

describe('las novedades en el dispositivo', () => {
  afterEach(() => localStorage.clear());
  const load = (sinces: string[]) => async () => sinces;

  it('la primera vez no hay nada nuevo: lo de hoy cuenta como visto', async () => {
    await checkHelpNews('0.154', load(['0.081', '0.150']));
    expect(readHelpNews()).toEqual({ seen: '0.150', latest: '0.150', app: '0.154' });
    expect(hasHelpNews()).toBe(false);
    expect(helpNewsFrom()).toBeNull();
  });

  it('una versión nueva de la app con entradas nuevas prende el punto; abrir la ayuda lo apaga', async () => {
    await checkHelpNews('0.154', load(['0.081', '0.150']));
    // Misma versión: no se vuelve a bajar nada.
    const again = vi.fn(async () => ['0.200']);
    await checkHelpNews('0.154', again);
    expect(again).not.toHaveBeenCalled();
    // La app se actualizó y trae una entrada nueva.
    await checkHelpNews('0.160', load(['0.081', '0.150', '0.158']));
    expect(hasHelpNews()).toBe(true);
    expect(helpNewsFrom()).toBe('0.150');
    markHelpNewsSeen('0.158', '0.160');
    expect(hasHelpNews()).toBe(false);
    expect(readHelpNews()).toEqual({ seen: '0.158', latest: '0.158', app: '0.160' });
    // Una versión que no trae entradas nuevas no prende nada.
    await checkHelpNews('0.161', load(['0.081', '0.150', '0.158']));
    expect(hasHelpNews()).toBe(false);
  });

  it('una ayuda vieja en otra pestaña nunca hace retroceder lo visto', async () => {
    await checkHelpNews('0.160', load(['0.158']));
    markHelpNewsSeen('0.150', '0.155');
    expect(readHelpNews()?.seen).toBe('0.158');
    expect(hasHelpNews()).toBe(false);
  });

  it('un "visto" de una versión sin publicar no frena las novedades de las publicadas', async () => {
    const unpublished = '0.0' + 'XX';
    await checkHelpNews('0.0', load(['0.150', unpublished]));
    expect(readHelpNews()?.seen).toBe(unpublished);
    await checkHelpNews('0.160', load(['0.150', '0.160']));
    expect(readHelpNews()).toEqual({ seen: '0.160', latest: '0.160', app: '0.160' });
    // Sin la parte de la ayuda (sin red): nada cambia y se prueba en la próxima carga.
    await checkHelpNews('0.170', async () => Promise.reject(new Error('sin red')));
    expect(readHelpNews()?.app).toBe('0.160');
  });

  it('sin almacenamiento legible, sin novedades (nunca se rompe)', () => {
    localStorage.setItem(KEY, '{roto');
    expect(readHelpNews()).toBeNull();
    expect(hasHelpNews()).toBe(false);
  });
});

// --- Con la app de verdad (Shell, ayuda, práctica, recorrida) sobre el servidor en memoria -----------------------

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
  const empty = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) });
  Range.prototype.getClientRects ??= (() => []) as never;
  Range.prototype.getBoundingClientRect ??= empty as never;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.scrollTo ??= function () {} as never;
  Element.prototype.scrollIntoView ??= function () {} as never;
});

const roots: Root[] = [];
const devices: Device[] = [];
afterEach(async () => {
  act(() => {
    dismissTour();
    closeHelp();
    closeFindBar();
    setNavOpen(false);
  });
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  document.body.innerHTML = '';
  localStorage.clear();
  history.replaceState(null, '', '/');
  act(() => prefs.set({ language: 'en' }));
});

const wait = (ms = 30) => act(async () => new Promise((r) => setTimeout(r, ms)));
async function until(check: () => unknown, what: string, tries = 300): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (check()) return;
    await wait(40);
  }
  // Con lo que había a la vista, para saber dónde se trabó.
  throw new Error(`no llegó: ${what} ${JSON.stringify({ ui: getTourUi(), path: location.pathname })}`);
}

/** El Shell con una página abierta (la dirección a la que "Mostrame" tiene que volver). */
async function app(): Promise<{ host: HTMLElement; page: string }> {
  const server = new FakeServer();
  server.enableComments();
  const d = await makeDevice(server);
  devices.push(d);
  const page = await d.tree.create(null, 'Brief');
  await d.engine.syncNow();
  const client = {
    auth: {
      signOut: vi.fn(),
      getSession: async () => ({ data: { session: { user: { id: d.remote.userId, user_metadata: { shotdocs_tour: 1 } } } }, error: null }),
      updateUser: async () => ({ data: {}, error: null }),
    },
  };
  const services = {
    workspace: { config: { url: 'https://x.supabase.co', publishableKey: 'k', name: 'W', localKey: WANKA_LOCAL_KEY, storage: legacyStorageNames(WANKA_LOCAL_KEY) }, client },
    client,
    user: { id: d.remote.userId, email: 'a@test' },
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
    firstLoad: false,
  } as unknown as Services;
  history.replaceState(null, '', `/p/${page}`);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <ServicesContext.Provider value={services}>
        <Shell />
      </ServicesContext.Provider>,
    ),
  );
  await until(() => host.querySelector('.help-button'), 'el botón de la ayuda');
  return { host, page };
}

const dialog = () => document.querySelector<HTMLElement>('.help-dialog');
const bubble = () => document.querySelector<HTMLElement>('.tour-bubble');
const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const press = (key: string) => act(() => void bubble()!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));

async function openHelp(host: HTMLElement) {
  click(host.querySelector('.help-button'));
  await until(() => dialog()?.querySelector('[data-help-id="tour"]'), 'la ayuda');
}

describe('las novedades en la ayuda', () => {
  it('el punto del "?" con lo nuevo, la lista arriba de todo con "New", y al verla se apaga', async () => {
    // Una persona que vio la ayuda en la versión 0.120: lo de después es nuevo.
    localStorage.setItem(KEY, JSON.stringify({ seen: '0.120', latest: LATEST, app: __APP_VERSION__ }));
    // Que ya terminó la recorrida (el punto no es el de la recorrida).
    localStorage.setItem('shotdocs-tour', JSON.stringify({ v: 1, done: true, step: null, account: true }));
    const { host } = await app();
    const button = host.querySelector<HTMLButtonElement>('.help-button')!;
    expect(button.classList.contains('has-dot')).toBe(true);
    expect(button.getAttribute('aria-label')).toBe("Help and shortcuts: what's new");

    await openHelp(host);
    const expected = HELP_ENTRIES.filter((e) => isNewer(e.since, '0.120')).map((e) => e.id);
    expect(expected.length).toBeGreaterThan(5);
    const news = dialog()!.querySelector('[data-help-section="news"]')!;
    expect(news.querySelector('h3')?.textContent).toBe("What's new");
    const listed = [...news.querySelectorAll('.help-entry')].map((e) => e.getAttribute('data-help-id'));
    expect([...listed].sort()).toEqual([...expected].sort());
    // Lo más nuevo primero.
    const versions = listed.map((id) => versionValue(HELP_ENTRIES.find((e) => e.id === id)!.since));
    expect(versions).toEqual([...versions].sort((a, b) => b - a));
    // También marcadas en su sección, y nada viejo marcado.
    expect(dialog()!.querySelector('[data-help-section="writing"] [data-help-id="dictationShot"] .help-new')?.textContent).toBe('New');
    expect(dialog()!.querySelector('[data-help-id="findProject"] .help-new')).toBeNull();
    expect(dialog()!.querySelector('.help-index .help-index-news')?.textContent).toBe("What's new");
    // Al abrirla quedaron vistas: el punto se fue.
    expect(button.classList.contains('has-dot')).toBe(false);
    expect(button.getAttribute('aria-label')).toBe('Help and shortcuts');
    expect(readHelpNews()?.seen).toBe(LATEST);

    act(() => closeHelp());
    await until(() => !dialog(), 'que se cierre');
    await openHelp(host);
    expect(dialog()!.querySelector('[data-help-section="news"]')).toBeNull();
    expect(dialog()!.querySelector('.help-new')).toBeNull();
    expect(dialog()!.querySelectorAll('[data-help-section]').length).toBe(15);
  });

  it('en castellano', async () => {
    act(() => prefs.set({ language: 'es' }));
    localStorage.setItem(KEY, JSON.stringify({ seen: '0.140', latest: LATEST, app: __APP_VERSION__ }));
    const { host } = await app();
    expect(host.querySelector('.help-button')?.getAttribute('aria-label')).toBe('Ayuda y atajos: novedades');
    click(host.querySelector('.help-button'));
    await until(() => dialog()?.querySelector('[data-help-section="news"]'), 'las novedades');
    expect(dialog()!.querySelector('[data-help-section="news"] h3')?.textContent).toBe('Novedades');
    expect(dialog()!.querySelector('.help-new')?.textContent).toBe('Nuevo');
  });
});

describe('Mostrame', () => {
  const path = () => location.pathname;

  it('cada entrada con "Mostrame" abre la práctica con solo su paso y "Done" vuelve a la página donde estaba', async () => {
    const { host, page } = await app();
    const tourBefore = localStorage.getItem('shotdocs-tour');
    const withShowMe = HELP_ENTRIES.filter((e) => e.showMe);
    expect(withShowMe.length).toBeGreaterThanOrEqual(12);
    for (const entry of withShowMe) {
      await openHelp(host);
      const show = dialog()!.querySelector(`[data-help-id="${entry.id}"] .help-show-me`);
      expect(show?.textContent, entry.id).toBe('Show me');
      click(show);
      const step = TOUR_STEPS.find((s) => s.id === entry.showMe)!;
      await until(() => path() === '/practice' && bubble()?.querySelector('h3')?.textContent === t(step.title), `el paso ${step.id} de ${entry.id}`);
      expect(dialog()).toBeNull();
      // Un solo paso: sin "1/10", sin Atrás ni Saltar recorrida.
      expect(bubble()!.querySelector('.mono-label')?.textContent).toBe('Show me');
      expect(bubble()!.querySelector('.tour-skip')).toBeNull();
      expect([...bubble()!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Done']);
      expect(document.querySelector('.tour-live')?.textContent).toBe(`Show me: ${t(step.title)}`);
      click(bubble()!.querySelector('button.primary'));
      await until(() => !bubble() && path() === `/p/${page}`, `volver de ${entry.id}`);
    }
    // No cuenta como recorrida vista ni a medias.
    expect(localStorage.getItem('shotdocs-tour')).toBe(tourBefore);
    expect(readDeviceTour().done).toBe(false);
    expect(getTourUi().mode).toBe('off');
  });

  it('Esc también vuelve; en el paso del menú "/", elegir algo no lo cierra (Done sí); irse de la práctica lo termina', async () => {
    const { host, page } = await app();
    await openHelp(host);
    click(dialog()!.querySelector('[data-help-id="findPage"] .help-show-me'));
    await until(() => bubble(), 'el paso de buscar');
    press('Escape');
    await until(() => !bubble() && path() === `/p/${page}`, 'volver con Esc');
    // No avisa "podés volver a ver la recorrida" (no era la recorrida).
    expect(host.querySelector('.notice')?.textContent ?? '').not.toContain('take the tour again');

    await openHelp(host);
    click(dialog()!.querySelector('[data-help-id="slash"] .help-show-me'));
    await until(() => bubble()?.querySelector('h3')?.textContent === 'The / menu', 'el paso del menú /');
    act(() => tourSignal('slash'));
    await wait(100);
    expect(bubble()).not.toBeNull();
    expect(path()).toBe('/practice');

    // Irse a otra página a mitad: se termina sin tarjeta de pausa.
    act(() => {
      history.pushState(null, '', '/trash');
      window.dispatchEvent(new Event('shotdocs:navigate'));
    });
    await until(() => getTourUi().mode === 'off', 'que se termine');
    expect(document.querySelector('.tour-card')).toBeNull();
    expect(path()).toBe('/trash');
  });

  it('desde la práctica misma, Done se queda en la práctica', async () => {
    const { host } = await app();
    act(() => {
      history.pushState(null, '', '/practice');
      window.dispatchEvent(new Event('shotdocs:navigate'));
    });
    await until(() => document.querySelector('.practice-banner'), 'la práctica');
    await openHelp(host);
    click(dialog()!.querySelector('[data-help-id="comments"] .help-show-me'));
    await until(() => bubble(), 'el paso de comentarios');
    click(bubble()!.querySelector('button.primary'));
    await until(() => !bubble(), 'que termine');
    expect(path()).toBe('/practice');
  });
});
