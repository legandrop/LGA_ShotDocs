// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanPrefs, DEFAULT_PREFS, detectLanguage, prefs } from '../prefs';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { editorDictionary } from '../ui/editorLocale';
import { AccountMenu } from '../ui/menus';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { localize, stored, t, translate, useT, type Entry, type Key } from './index';
import { carrete } from './lazy/carrete';
import { commentsPanel } from './lazy/commentsPanel';
import { drive } from './lazy/drive';
import { editor } from './lazy/editor';
import { importCoda } from './lazy/importCoda';
import { search } from './lazy/search';
import { teamDialogs } from './lazy/teamDialogs';
import { parts, strings } from './strings';

/** Las partes que viajan con lo que se baja aparte (ver `register` en index.ts). */
const LAZY = { carrete, commentsPanel, drive, editor, importCoda, search, teamDialogs };
const ALL_PARTS: Record<string, Record<string, { en: Entry; es: Entry }>> = { ...parts, ...LAZY };
const ALL = Object.assign({}, ...Object.values(ALL_PARTS)) as Record<Key, { en: Entry; es: Entry }>;

// El diccionario de la interfaz (D-16): que cada clave tenga los dos idiomas con los mismos `{valores}`, que
// no se repita ni sobre ninguna, y que cambiar el idioma en la cuenta vuelva a dibujar la interfaz.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SRC = resolve(__dirname, '..');

/** Cada archivo de la app (sin las pruebas ni el propio diccionario), con su código. */
function appFiles(dir = SRC, out = new Map<string, string>()): Map<string, string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (path !== join(SRC, 'i18n')) appFiles(path, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) {
      out.set(path, readFileSync(path, 'utf8'));
    }
  }
  return out;
}
const appSource = () => [...appFiles().values()].join('\n');

const forms = (e: Entry): string[] => (typeof e === 'string' ? [e] : [e.one, e.other]);
const names = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

/** Claves que no aparecen escritas en el código (se arman o se usan de otra forma). Por ahora ninguna. */
const UNUSED_ALLOWED = new Set<string>();

describe('diccionario', () => {
  const entries = Object.entries(ALL) as [Key, { en: Entry; es: Entry }][];

  it('cada clave tiene los dos idiomas, con la misma forma y los mismos {valores}', () => {
    expect(entries.length).toBeGreaterThan(100);
    for (const [key, pair] of entries) {
      expect(pair.en, key).toBeTruthy();
      expect(pair.es, key).toBeTruthy();
      // Las dos formas o ninguna: un plural en un idioma lo es en el otro.
      expect(typeof pair.en, key).toBe(typeof pair.es);
      for (const text of [...forms(pair.en), ...forms(pair.es)]) expect(text.trim(), key).not.toBe('');
      const en = forms(pair.en).map(names);
      const es = forms(pair.es).map(names);
      // Cada forma en castellano usa los mismos valores que en inglés (un plural puede omitir `count` en una).
      for (const list of es) for (const n of list) expect(en.flat(), `${key}: {${n}}`).toContain(n);
      for (const list of en) for (const n of list) if (n !== 'count') expect(es.flat(), `${key}: {${n}}`).toContain(n);
    }
  });

  it('ninguna clave se repite entre partes', () => {
    const seen = new Map<string, string>();
    for (const [part, dict] of Object.entries(ALL_PARTS)) {
      for (const key of Object.keys(dict)) {
        expect(seen.get(key), `${key} en ${part}`).toBeUndefined();
        seen.set(key, part);
      }
    }
    expect(seen.size).toBe(entries.length);
  });

  it('no sobra ninguna clave: todas se usan en el código', () => {
    const source = appSource();
    const unused = entries.map(([key]) => key).filter((key) => !source.includes(`'${key}'`) && !UNUSED_ALLOWED.has(key));
    expect(unused).toEqual([]);
  });

  it('las claves de una parte que se baja aparte solo se usan en archivos que importan esa parte', () => {
    // Si no, un archivo de la primera carga mostraría la clave en vez del texto hasta que baje la parte.
    const files = appFiles();
    expect(Object.keys(strings).length).toBeLessThan(entries.length);
    const wrong: string[] = [];
    for (const [name, dict] of Object.entries(LAZY)) {
      for (const key of Object.keys(dict)) {
        for (const [path, code] of files) {
          if (code.includes(`'${key}'`) && !code.includes(`i18n/lazy/${name}'`)) wrong.push(`${key} en ${path}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('lo guardado en inglés se muestra en el idioma de ahora, también con valores y avisos seguidos', () => {
    act(() => prefs.set({ language: 'es' }));
    try {
      expect(localize(stored('queue.waitingDb'))).toBe(translate('es', 'queue.waitingDb'));
      // Con un valor que a su vez es el texto de otra clave.
      const nested = stored('engine.mediaOff', { reason: stored('boot.mediaStorage', { reason: 'QuotaExceededError' }) });
      expect(localize(nested)).toBe(
        translate('es', 'engine.mediaOff', { reason: translate('es', 'boot.mediaStorage', { reason: 'QuotaExceededError' }) }),
      );
      const joined = `${stored('engine.restoredAll')} ${stored('engine.skipped', { count: 2, download: stored('sync.downloadUnsynced') })}`;
      expect(localize(joined)).toBe(
        `${translate('es', 'engine.restoredAll')} ${translate('es', 'engine.skipped', { count: 2, download: translate('es', 'sync.downloadUnsynced') })}`,
      );
      // Lo que no es de ninguna clave (un mensaje del servidor) queda tal cual.
      expect(localize('row-level security violation')).toBe('row-level security violation');
    } finally {
      act(() => prefs.set({ language: 'en' }));
    }
    expect(localize(stored('queue.waitingDb'))).toBe('Uploaded to Google Drive; waiting for the database to confirm it.');
  });

  it('interpola, elige el plural y deja un {valor} que falta a la vista', () => {
    expect(translate('en', 'sync.changes', { count: 1 })).toBe('1 change');
    expect(translate('en', 'sync.changes', { count: 3 })).toBe('3 changes');
    expect(translate('es', 'sync.changes', { count: 0 })).toBe('0 cambios');
    expect(translate('es', 'home.empty', { name: 'MGTZD' })).toBe('MGTZD está vacío');
    expect(translate('es', 'home.empty')).toBe('{name} está vacío');
  });

  it('el editor usa el castellano de BlockNote, pasado a vos; en inglés, el de fábrica', () => {
    expect(editorDictionary('en')).toBeUndefined();
    const es = editorDictionary('es')!;
    expect(es.placeholders.default).toMatch(/Escribí/);
    expect(es.slash_menu.paragraph.title).toBe('Párrafo');
    expect(es.file_blocks.add_button_text.video).toBe('Agregar video');
    // Lo que no se tocó sigue como viene.
    expect(es.slash_menu.table.title).toBe('Tabla');
  });

  it('los tipos de texto tienen nombre en cada idioma (solo etiquetas: lo guardado no cambia)', () => {
    expect(translate('en', 'editor.script')).toBe('Script');
    expect(translate('es', 'editor.script')).toBe('Guion');
    expect(translate('en', 'editor.question')).toBe('Question');
    expect(translate('es', 'editor.question')).toBe('Pregunta');
  });
});

describe('idioma en las preferencias de la cuenta', () => {
  it('de fábrica sigue al navegador: es* → castellano, lo demás → inglés', () => {
    const original = Object.getOwnPropertyDescriptor(Navigator.prototype, 'languages');
    const set = (langs: string[]) =>
      Object.defineProperty(navigator, 'languages', { value: langs, configurable: true });
    try {
      set(['es-AR', 'en']);
      expect(detectLanguage()).toBe('es');
      set(['es']);
      expect(detectLanguage()).toBe('es');
      set(['en-US', 'es']);
      expect(detectLanguage()).toBe('en');
      set(['pt-BR']);
      expect(detectLanguage()).toBe('en');
    } finally {
      delete (navigator as { languages?: unknown }).languages;
      if (original) Object.defineProperty(Navigator.prototype, 'languages', original);
    }
  });

  it('un valor desconocido no rompe nada, y lo que falta en la cuenta sigue como estaba en el dispositivo', () => {
    expect(cleanPrefs({ language: 'fr' }).language).toBe(DEFAULT_PREFS.language);
    // Una versión vieja de la app sube sus preferencias sin `language` (no la conoce): este dispositivo
    // sigue con el idioma que tenía en vez de volver al del navegador.
    const local = { ...DEFAULT_PREFS, language: 'es' as const };
    expect(cleanPrefs({ theme: 'dark', font: 'default', textSize: 'normal', pageWidth: 'normal' }, local)).toEqual({
      ...local,
      theme: 'dark',
    });
  });
});

// --- Cambiar el idioma vuelve a dibujar -----------------------------------------------------------------

const roots: Root[] = [];
const devices: Device[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
  }
  document.body.innerHTML = '';
  act(() => prefs.set({ language: 'en' }));
});

function Probe() {
  const tr = useT();
  return (
    <p>
      {tr('trash.title')} · {tr('sync.changes', { count: 2 })}
    </p>
  );
}

async function mount(node: React.ReactNode): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return host;
}

describe('cambio de idioma', () => {
  it('los componentes con useT se vuelven a dibujar, y t() lee el idioma del momento', async () => {
    act(() => prefs.set({ language: 'en' }));
    const host = await mount(<Probe />);
    expect(host.textContent).toBe('Trash · 2 changes');
    expect(document.documentElement.lang).toBe('en');
    act(() => prefs.set({ language: 'es' }));
    expect(host.textContent).toBe('Papelera · 2 cambios');
    expect(t('common.cancel')).toBe('Cancelar');
    expect(document.documentElement.lang).toBe('es');
    act(() => prefs.set({ language: 'en' }));
    expect(host.textContent).toBe('Trash · 2 changes');
  });

  it('el selector del menú de la cuenta cambia el idioma, queda para subir a la cuenta y traduce el menú', async () => {
    act(() => prefs.set({ language: 'en' }));
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
    const host = await mount(
      <ServicesContext.Provider value={services}>
        <AccountMenu position={{ top: 0, left: 0 }} anchor={null} onClose={() => undefined} />
      </ServicesContext.Provider>,
    );
    expect(host.textContent).toContain('Language');
    expect(host.textContent).toContain('Appearance');
    const spanish = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Español')!;
    expect(spanish.getAttribute('aria-pressed')).toBe('false');
    await act(async () => spanish.click());
    expect(prefs.get().language).toBe('es');
    expect(prefs.hasUnsynced()).toBe(true);
    expect(host.textContent).toContain('Idioma');
    expect(host.textContent).toContain('Apariencia');
    expect(host.textContent).toContain('Cerrar sesión');
    expect(spanish.getAttribute('aria-pressed')).toBe('true');
  });
});
