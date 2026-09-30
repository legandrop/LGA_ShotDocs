// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setCodaOwnerForTests } from '../import/codaOwner';
import { importJobFor } from '../import/importJob';
import { prefs } from '../prefs';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { canPickFolders, ImportCodaDialog } from './ImportCodaDialog';
import { AccountMenu } from './menus';
import { ProjectSwitcher } from './ProjectSwitcher';

// El diálogo de "Importar de Coda": avisa de entrada lo que impide importar (sin Drive, sin poder elegir
// una carpeta en el iPad) y su estado vive afuera, así desmontarlo no pierde la importación ni el resultado.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const devices: Device[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
    d.mediaDb.close();
  }
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setCodaOwnerForTests();
  act(() => prefs.set({ language: 'en' }));
});

function services(d: Device, userId: string): Services {
  const config = {
    url: 'https://znlvpuddswymxpffgvbz.supabase.co',
    publishableKey: 'sb_publishable_test',
    name: 'Wanka',
    localKey: WANKA_LOCAL_KEY,
    storage: legacyStorageNames(WANKA_LOCAL_KEY),
  };
  const client = { auth: { getSession: async () => ({ data: { session: null } }) } } as never;
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
    sizes: d.sizes,
    shutdown: async () => undefined,
  };
}

async function device(media: boolean): Promise<{ server: FakeServer; d: Device }> {
  const server = new FakeServer();
  if (media) server.enableMedia();
  const d = await makeDevice(server);
  devices.push(d);
  await d.engine.syncNow();
  return { server, d };
}

async function mount(value: Services): Promise<{ host: HTMLElement; root: Root }> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<ServicesContext.Provider value={value}>{<ImportCodaDialog />}</ServicesContext.Provider>));
  return { host, root };
}

const button = (host: HTMLElement, label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label)!;

describe('diálogo de importar de Coda', () => {
  it('sin Drive conectado lo dice de entrada y no deja elegir la carpeta', async () => {
    const { server, d } = await device(false);
    const { host } = await mount(services(d, server.ownerId));
    expect(host.textContent).toContain('Connect Google Drive first');
    expect(button(host, 'Choose folder').disabled).toBe(true);
  });

  it('en el iPad (sin elegir carpetas) lo explica y no deja elegir', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15');
    expect(canPickFolders()).toBe(false);
    const { server, d } = await device(true);
    const { host } = await mount(services(d, server.ownerId));
    expect(host.textContent).toContain("can't choose a whole folder");
    expect(button(host, 'Choose folder').disabled).toBe(true);
  });

  it('el progreso dice la página que va (1 de N, no 0) y el resultado sigue ahí aunque el diálogo se desmonte', async () => {
    const { server, d } = await device(true);
    const value = services(d, server.ownerId);
    const job = importJobFor(d.tree);
    let finish!: () => void;
    act(() => {
      job.show();
      void job.run(
        (onProgress) =>
          new Promise((resolve) => {
            onProgress({ done: 0, total: 3, page: 'Primera' });
            finish = () => resolve({ projectId: 'p', pages: 3, files: 2, comments: 0, problems: ['A: algo'], exportProblems: ['B: otra cosa'], resumable: true });
          }),
      );
    });
    const first = await mount(value);
    expect(first.host.textContent).toContain('Page 1 of 3: Primera');
    expect(first.host.textContent).toContain('Keep the app open');
    expect(button(first.host, 'Importing…').disabled).toBe(true);
    // El selector de proyectos se desmonta (se cerró la barra lateral): la importación sigue.
    act(() => first.root.unmount());
    roots.splice(roots.indexOf(first.root), 1);
    await act(async () => finish());
    const second = await mount(value);
    expect(second.host.textContent).toContain('Imported 3 pages and 2 files.');
    expect(second.host.textContent).toContain('A: algo');
    expect(second.host.textContent).toContain('coda-export noted 1 thing:');
    expect(second.host.textContent).toContain('B: otra cosa');
    expect(second.host.textContent).toContain('choose the same folder again');
    act(() => job.close());
  });

  it('cerrar la sesión espera a que termine una importación en curso', async () => {
    const { server, d } = await device(true);
    const value = services(d, server.ownerId);
    const signOut = vi.fn(async () => ({ error: null }));
    value.client = { auth: { signOut } } as never;
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const job = importJobFor(d.tree);
    let finish!: () => void;
    const running = job.run(
      () => new Promise((resolve) => (finish = () => resolve({ projectId: 'p', pages: 0, files: 0, comments: 0, problems: [], exportProblems: [], resumable: false }))),
    );
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () =>
      root.render(
        <ServicesContext.Provider value={value}>
          <AccountMenu position={{ top: 0, left: 0 }} anchor={null} onClose={() => undefined} />
        </ServicesContext.Provider>,
      ),
    );
    await act(async () => button(host, 'Sign out').click());
    expect(signOut).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('An import from Coda is running. Wait until it finishes.');
    finish();
    await running;
    job.close();
  });
});

// Solo la cuenta de Lega ve "Importar de Coda" (codaOwner.ts). Acá el hash permitido es el de un correo de
// prueba: el real no aparece en las pruebas.
describe('importar de Coda, solo para la cuenta de Lega', () => {
  const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

  async function openSwitcher(value: Services): Promise<void> {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<ServicesContext.Provider value={value}><ProjectSwitcher /></ServicesContext.Provider>));
    // El hash se resuelve aparte (Web Crypto): se espera un instante antes de abrir el selector.
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    await act(async () => host.querySelector<HTMLButtonElement>('.project-button')!.click());
  }

  const importEntry = () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Import from Coda…');

  it('con otro correo no aparece la entrada', async () => {
    setCodaOwnerForTests({ hash: sha256('otra-persona@ejemplo.com') });
    const { server, d } = await device(true);
    await openSwitcher(services(d, server.ownerId));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(importEntry()).toBeUndefined();
  });

  it('con el correo permitido (sin importar mayúsculas ni espacios) aparece y abre el diálogo', async () => {
    const { server, d } = await device(true);
    const value = services(d, server.ownerId);
    value.user = { ...value.user, email: `  ${value.user.email.toUpperCase()} ` };
    setCodaOwnerForTests({ hash: sha256(`${server.ownerId}@test`.toLowerCase()) });
    await openSwitcher(value);
    const entry = importEntry();
    expect(entry).toBeDefined();
    act(() => entry!.click());
    expect(importJobFor(d.tree).get().open).toBe(true);
    act(() => importJobFor(d.tree).close());
  });

  it('una función de hash inyectada decide igual (el resultado se guarda por usuario)', async () => {
    const hashOf = vi.fn(async (email: string) => (email.endsWith('@test') ? 'permitido' : 'otro'));
    setCodaOwnerForTests({ hash: 'permitido', hashOf });
    const { server, d } = await device(true);
    await openSwitcher(services(d, server.ownerId));
    expect(importEntry()).toBeDefined();
    await openSwitcher(services(d, server.ownerId));
    expect(hashOf).toHaveBeenCalledTimes(1);
  });
});
