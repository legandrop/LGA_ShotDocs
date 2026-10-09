// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { prefs } from '../prefs';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { accountMaxHeight, AccountMenu } from './menus';

// El panel de la cuenta (Docs/Doc_Contraste.md): Appearance, Font y Contrast son solo íconos, con el nombre de cada
// opción en el tooltip (`data-tip`, nunca `title=`) y en `aria-label`; Contrast arranca en *Contrast* y se guarda como
// las demás preferencias; el panel nunca pasa del alto que queda en la ventana.

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
  act(() => prefs.set({ language: 'en', contrast: 'contrast', theme: 'system', font: 'default', expandSubpages: 'onClick' }));
});

async function menu(position: { top?: number; bottom?: number; left: number } = { top: 0, left: 0 }): Promise<HTMLElement> {
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
    offline: d.offline,
    shutdown: async () => undefined,
  };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      <ServicesContext.Provider value={services}>
        <AccountMenu position={position} anchor={null} onClose={() => undefined} />
      </ServicesContext.Provider>,
    ),
  );
  return host;
}

/** Los botones del selector con ese rótulo. */
function group(host: HTMLElement, label: string): HTMLButtonElement[] {
  const title = [...host.querySelectorAll<HTMLElement>('.pref-label')].find((el) => el.textContent === label);
  expect(title, label).toBeTruthy();
  const g = host.querySelector<HTMLElement>(`[role="group"][aria-labelledby="${title!.id}"]`)!;
  return [...g.querySelectorAll<HTMLButtonElement>('button')];
}

const names = (buttons: HTMLButtonElement[]) => buttons.map((b) => b.getAttribute('aria-label'));

describe('panel de la cuenta: Appearance, Font y Contrast', () => {
  it('Expand subpages arranca al hacer clic, permite Manual y guarda la elección local', async () => {
    prefs.set({ expandSubpages: 'onClick' });
    const host = await menu();
    const buttons = group(host, 'Expand subpages');
    expect(buttons.map((b) => b.textContent)).toEqual(['Manual', 'On click']);
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    act(() => buttons[0].click());
    expect(prefs.get().expandSubpages).toBe('manual');
    expect(JSON.parse(localStorage.getItem('shotdocs-prefs')!).prefs.expandSubpages).toBe('manual');
    act(() => buttons[1].click());
  });
  it('son solo íconos: el nombre va en el tooltip y en aria-label, sin texto ni title', async () => {
    act(() => prefs.set({ language: 'en' }));
    const host = await menu();
    const appearance = group(host, 'Appearance');
    const font = group(host, 'Font');
    const contrast = group(host, 'Contrast');
    expect(names(appearance)).toEqual(['System', 'Light', 'Dark']);
    expect(names(font)).toEqual(['Default', 'Editorial']);
    expect(names(contrast)).toEqual(['No contrast', 'Normal contrast', 'More contrast']);
    for (const b of [...appearance, ...font, ...contrast]) {
      expect(b.dataset.tip).toBe(b.getAttribute('aria-label'));
      expect(b.hasAttribute('title')).toBe(false);
      // Solo el ícono (Font muestra su muestra «Aa», que es su ícono).
      expect(b.textContent).toBe(font.includes(b) ? 'Aa' : '');
      expect(b.querySelector('svg, .sample')).toBeTruthy();
    }
    // Los demás selectores siguen con su texto.
    expect(group(host, 'Text size').map((b) => b.textContent)).toEqual(['Small', 'Normal', 'Large']);
  });

  it('Contrast arranca en Contrast, se guarda y marca el documento; los rótulos en castellano', async () => {
    const host = await menu();
    const contrast = group(host, 'Contrast');
    expect(contrast.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    await act(async () => contrast[2].click());
    expect(prefs.get().contrast).toBe('more');
    expect(prefs.hasUnsynced()).toBe(true);
    expect(document.documentElement.dataset.contrast).toBe('more');
    expect(JSON.parse(localStorage.getItem('shotdocs-prefs')!).prefs.contrast).toBe('more');
    expect(contrast.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
    await act(async () => contrast[0].click());
    expect(document.documentElement.dataset.contrast).toBe('none');

    act(() => prefs.set({ language: 'es' }));
    expect(names(group(host, 'Contraste'))).toEqual(['Sin contraste', 'Contraste normal', 'Más contraste']);
    expect(group(host, 'Contraste')[1].dataset.tip).toBe('Contraste normal');
    expect(group(host, 'Fuente')).toHaveLength(2);
    expect(group(host, 'Tamaño del texto')).toHaveLength(3);
    expect(host.textContent).not.toContain('Letra');
  });

  it('el panel no pasa del alto que queda en la ventana desde el botón de la cuenta', async () => {
    expect(accountMaxHeight({ bottom: 60, left: 8 })).toBe('calc(100dvh - 68px)');
    expect(accountMaxHeight({ top: 40, left: 8 })).toBe('calc(100dvh - 48px)');
    expect(accountMaxHeight({ left: 8 })).toBeUndefined();
    const host = await menu({ bottom: 72, left: 8 });
    expect(host.querySelector<HTMLElement>('.account-menu')!.style.maxHeight).toBe('calc(100dvh - 80px)');
  });

  it('el CSS del panel: se recorre adentro y los renglones largos van a la izquierda (jsdom no calcula el layout)', () => {
    const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = (selector: string) => {
      const at = css.indexOf(`\n${selector} {`);
      expect(at, selector).toBeGreaterThan(-1);
      return css.slice(at, css.indexOf('}', at));
    };
    const menu = rule('.account-menu');
    expect(menu).toContain('overflow-y: auto;');
    expect(menu).toContain('overscroll-behavior: contain;');
    expect(menu).toContain('max-height: calc(100dvh - 16px);');
    const row = rule('.account-menu .menu-row');
    expect(row).toContain('text-align: left;');
    expect(row).toContain('height: auto;');
  });
});
