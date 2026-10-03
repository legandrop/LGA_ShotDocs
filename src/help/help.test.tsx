// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prefs } from '../prefs';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { Shell } from '../ui/Workspace';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { HELP_ENTRIES } from './entries';
import { closeHelp } from './helpUi';
import { searchHelp } from './search';

// La ayuda (Docs/Doc_Tutorial.md, sección 5): la búsqueda en el dispositivo, y el diálogo de verdad en el Shell:
// lo abren el botón "?" y la entrada del menú de la cuenta, ninguna tecla, y Esc lo cierra y devuelve el foco.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.setConfig({ testTimeout: 60_000 });

describe('buscar en la ayuda', () => {
  const ids = (q: string, lang: 'en' | 'es' = 'en') => searchHelp(HELP_ENTRIES, q, lang).map((h) => h.entry.id);
  const first = (q: string, lang: 'en' | 'es' = 'en') => ids(q, lang)[0];

  it('un atajo escrito como sea lleva a su entrada', () => {
    expect(first('ctrl f')).toBe('findPage');
    expect(first('Ctrl+F')).toBe('findPage');
    expect(first('⌘F')).toBe('findPage');
    expect(first('ctrl alt m')).toBe('comments');
    // Ctrl/⌘+K busca en el proyecto y, con texto elegido en el editor, hace un link: las tres arriba.
    expect(ids('ctrl k').slice(0, 3).sort()).toEqual(['findProject', 'format', 'projects']);
  });

  it('sin mayúsculas ni tildes, y en los dos idiomas', () => {
    expect(ids('carrete', 'es')).toContain('carrete');
    expect(ids('carrete', 'en')).toContain('carrete');
    expect(ids('titulos cortos', 'es')).toContain('pagesTitles');
    expect(ids('PDF')).toContain('pdf');
    expect(ids('filas', 'es')).toContain('photosRows');
    expect(ids('papelera', 'en')).toContain('trash');
    // Lo que llegó con main antes que la ayuda: instalar, carpetas, fotos en el renglón, sus archivos en Drive.
    expect(first('instalar', 'es')).toBe('install');
    expect(ids('carpeta', 'es')).toEqual(expect.arrayContaining(['folderDrop', 'folderUpload', 'folderOpen', 'folderWho']));
    expect(ids('shift clic', 'es')).toContain('photosInline');
    expect(ids('ctrl v')[0]).toBe('photosAdd');
    expect(ids('look for its files again')).toContain('projectsDrive');
    // Borrar un proyecto para siempre (P.14, entrega 3).
    expect(first('delete forever')).toBe('projectsPurge');
    expect(ids('borrar para siempre', 'es')).toContain('projectsPurge');
    // Colapsar para todos y mover la sección entera (Doc_Colapsar.md, 1b y 2).
    expect(ids('shift')).toContain('collapseEveryone');
    expect(ids('para todos', 'es')).toContain('collapseEveryone');
    expect(ids('ctrl alt shift enter')[0]).toBe('collapseEveryone');
    expect(ids('mover sección', 'es')).toContain('collapseMove');
  });

  it('nada escrito, nada; algo que no está, ninguna', () => {
    expect(searchHelp(HELP_ENTRIES, '  ', 'en')).toEqual([]);
    expect(searchHelp(HELP_ENTRIES, 'zzzqqq', 'es')).toEqual([]);
  });
});

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
  Element.prototype.scrollTo ??= function () {} as never;
});

const roots: Root[] = [];
const devices: Device[] = [];
afterEach(() => {
  act(() => closeHelp());
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
async function until(check: () => unknown, what: string, tries = 200): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (check()) return;
    await wait(40);
  }
  throw new Error(`no llegó: ${what}`);
}

function services(device: Device): Services {
  return {
    workspace: { config: { url: 'https://x.supabase.co', publishableKey: 'k', name: 'W', localKey: WANKA_LOCAL_KEY, storage: legacyStorageNames(WANKA_LOCAL_KEY) }, client: {} },
    client: { auth: { signOut: vi.fn() } },
    user: { id: device.remote.userId, email: 'a@test' },
    db: device.db,
    tree: device.tree,
    docs: device.docs,
    files: device.files,
    media: device.media,
    engine: device.engine,
    access: device.access,
    remote: device.remote as unknown as SupabaseRemote,
    dbName: 'test',
    mediaDb: device.mediaDb,
    comments: device.comments,
    commentsDb: device.commentsDb,
    sizes: device.sizes,
    shutdown: async () => undefined,
  } as unknown as Services;
}

async function shell() {
  const d = await makeDevice(new FakeServer());
  devices.push(d);
  await d.tree.create(null, 'Uno');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <ServicesContext.Provider value={services(d)}>
        <Shell />
      </ServicesContext.Provider>,
    ),
  );
  await until(() => host.querySelector('.help-button'), 'el botón de la ayuda');
  return host;
}

const dialog = () => document.querySelector<HTMLElement>('.help-dialog');
const press = (init: KeyboardEventInit, target: EventTarget = document.body) =>
  act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })));

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('el diálogo de la ayuda', () => {
  it('lo abre el botón "?", tiene las secciones y los atajos, y Esc lo cierra con el foco de vuelta en el botón', async () => {
    const host = await shell();
    const button = host.querySelector<HTMLButtonElement>('.help-button')!;
    expect(button.getAttribute('aria-label')).toBe('Help and shortcuts');
    // Sin tooltip: el ícono ya lo dice (D-15).
    expect(button.hasAttribute('data-tip')).toBe(false);
    button.focus();
    act(() => button.click());
    await until(() => dialog(), 'el diálogo');
    const d = dialog()!;
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(d.querySelectorAll('[data-help-section]').length).toBe(15);
    // "Primeros pasos": ver la recorrida y practicar, con sus botones.
    expect(d.querySelector('[data-help-id="tour"] .help-action')?.textContent).toBe('Take the tour');
    expect(d.querySelector('[data-help-id="practice"] .help-action')?.textContent).toBe('Practice');
    expect(d.querySelector('[data-shortcut="find"] kbd')?.textContent).toBe('Ctrl+F');
    // Colapsar para todos (Doc_Colapsar.md, entrega 2): en la tabla, con su atajo.
    expect(d.querySelector('[data-shortcut="collapseEveryone"] kbd')?.textContent).toBe('Ctrl+Alt+Shift+Enter');
    expect(d.querySelector('[data-help-id="collapseEveryone"]')).not.toBeNull();
    // El foco entró al campo de buscar.
    expect(document.activeElement).toBe(d.querySelector('input[type="search"]'));
    press({ key: 'Escape' }, document.activeElement!);
    await until(() => !dialog(), 'que se cierre');
    expect(document.activeElement).toBe(button);
  });

  it('lo abre "Help and shortcuts" del menú de la cuenta, y busca', async () => {
    const host = await shell();
    act(() => host.querySelector<HTMLButtonElement>('.account-button')!.click());
    const item = [...document.querySelectorAll<HTMLButtonElement>('.account-menu .menu-row')].find(
      (b) => b.textContent === 'Help and shortcuts',
    )!;
    expect(item).toBeTruthy();
    act(() => item.click());
    await until(() => dialog(), 'el diálogo');
    const input = dialog()!.querySelector<HTMLInputElement>('input[type="search"]')!;
    type(input, 'ctrl f');
    expect(dialog()!.querySelector('.help-results .help-entry')?.getAttribute('data-help-id')).toBe('findPage');
    type(input, 'zzzqqq');
    expect(dialog()!.textContent).toContain('No results. Try another word.');
  });

  it('ninguna tecla la abre: ni "?" ni Ctrl/⌘+/', async () => {
    await shell();
    press({ key: '?', shiftKey: true });
    press({ key: '/', ctrlKey: true });
    press({ key: '/', metaKey: true });
    press({ key: 'F1' });
    await wait(200);
    expect(dialog()).toBeNull();
  });

  it('en castellano, con los textos de la ayuda', async () => {
    act(() => prefs.set({ language: 'es' }));
    const host = await shell();
    act(() => host.querySelector<HTMLButtonElement>('.help-button')!.click());
    await until(() => dialog(), 'el diálogo');
    expect(dialog()!.querySelector('h2')!.textContent).toBe('Ayuda y atajos');
    expect(dialog()!.textContent).toContain('Atajos de teclado');
    expect(dialog()!.textContent).toContain('Inicio / Fin');
  });
});
