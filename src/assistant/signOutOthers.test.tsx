// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { settled } from '../test/settle';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { Shell } from '../ui/Workspace';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';

// *Sign out other devices* en el menú de la cuenta (Docs/Doc_Clave_Sincronizada.md, sección 3 y entrega S1), con la app
// de verdad: la confirmación nombra el workspace y llama `signOut({ scope: 'others' })` del cliente del workspace; esta
// sesión sigue (nunca `local` ni `global`), y *Cancel* no llama nada.

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
});

// El rato pedido y, después, a que termine lo que quedó en marcha (src/test/settle.ts).
const wait = (ms = 30) => act(() => settled(ms));
async function until(check: () => unknown, what: string, tries = 200): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (check()) return;
    await wait(40);
  }
  throw new Error(`no llegó: ${what}`);
}

async function shell(signOut: (o?: unknown) => Promise<{ error: unknown }>, name = 'Wanka') {
  const d = await makeDevice(new FakeServer());
  devices.push(d);
  await d.tree.create(null, 'Uno');
  const client = { auth: { signOut } };
  const services = {
    workspace: { config: { url: 'https://x.supabase.co', publishableKey: 'k', name, localKey: WANKA_LOCAL_KEY, storage: legacyStorageNames(WANKA_LOCAL_KEY) }, client },
    client,
    user: { id: d.remote.userId, email: 'lega@wanka.tv' },
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
  } as unknown as Services;
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
  await until(() => host.querySelector('.account-button'), 'el botón de la cuenta');
  return host;
}

const dialog = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find((d) => d.getAttribute('aria-label') === 'Sign out other devices');
const buttonIn = (el: ParentNode, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;

async function openFromMenu(host: HTMLElement) {
  act(() => host.querySelector<HTMLButtonElement>('.account-button')!.click());
  const row = [...document.querySelectorAll<HTMLButtonElement>('.account-menu .menu-row')].find((b) => b.textContent === 'Sign out other devices');
  expect(row).toBeTruthy();
  act(() => row!.click());
  await until(() => dialog(), 'la confirmación');
}

describe('Sign out other devices', () => {
  it('desde el menú de la cuenta: confirma con el nombre del workspace y cierra solo las otras sesiones', async () => {
    const signOut = vi.fn(async (_o?: unknown) => ({ error: null }));
    const host = await shell(signOut);
    await openFromMenu(host);
    expect(dialog()!.textContent).toContain('Sign out of Wanka on all your other devices?');
    expect(dialog()!.textContent).toContain('A device that is already open can keep working for up to an hour.');
    await act(async () => buttonIn(dialog()!, 'Sign out others')!.click());
    await until(() => dialog()?.textContent?.includes('Your other devices were signed out.'), 'el aviso');
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith({ scope: 'others' });
    act(() => buttonIn(dialog()!, 'Close')!.click());
    await until(() => !dialog(), 'que se cierre');
  });

  it('Cancel no llama nada; si falla, lo dice y deja probar de nuevo', async () => {
    const signOut = vi.fn(async (_o?: unknown) => ({ error: { message: 'Failed to fetch' } as unknown }));
    const host = await shell(signOut);
    await openFromMenu(host);
    act(() => buttonIn(dialog()!, 'Cancel')!.click());
    await until(() => !dialog(), 'que se cierre');
    expect(signOut).not.toHaveBeenCalled();
    await openFromMenu(host);
    await act(async () => buttonIn(dialog()!, 'Sign out others')!.click());
    await until(() => dialog()?.textContent?.includes("Couldn't sign out the other devices."), 'el error');
    expect(buttonIn(dialog()!, 'Sign out others')).toBeTruthy();
  });

  it('un workspace sin nombre se nombra por el host de su dirección (O4 de la auditoría)', async () => {
    const host = await shell(vi.fn(async () => ({ error: null })), '');
    await openFromMenu(host);
    expect(dialog()!.textContent).toContain('Sign out of x.supabase.co on all your other devices?');
  });
});
