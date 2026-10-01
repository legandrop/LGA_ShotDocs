// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefs } from '../prefs';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import type { ProjectSizeRow } from '../sync/types';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { DriveDialog } from './DriveDialog';
import { ProjectSwitcher } from './ProjectSwitcher';

// El peso de los proyectos (P.7) en la interfaz, contra el servidor en memoria: el subtítulo del selector de
// proyectos y la sección "Espacio en Drive" del diálogo de Google Drive.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  vi.unstubAllGlobals();
  act(() => prefs.set({ language: 'en' }));
});

const GB = 1024 ** 3;
const MB = 1024 ** 2;

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
    offline: d.offline,
    shutdown: async () => undefined,
  };
}

async function mount(value: Services, node: React.ReactNode): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<ServicesContext.Provider value={value}>{node}</ServicesContext.Provider>));
  await settle();
  return host;
}

const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));

function size(projectId: string | null, driveBytes: number, extra: Partial<ProjectSizeRow> = {}): ProjectSizeRow {
  return {
    project_id: projectId,
    drive_bytes: driveBytes,
    drive_files: driveBytes > 0 ? 1 : 0,
    trash_bytes: 0,
    trash_files: 0,
    drive_trash_bytes: 0,
    drive_trash_files: 0,
    pending_bytes: 0,
    pending_files: 0,
    ...extra,
  };
}

/** Un workspace con dos proyectos del dueño: el primero con peso, el segundo vacío. */
async function workspace(): Promise<{ server: FakeServer; owner: Device; second: string }> {
  const server = new FakeServer();
  server.enableTrash();
  const owner = await makeDevice(server);
  devices.push(owner);
  await owner.engine.syncNow();
  const second = await owner.tree.createProject('Vacío');
  await owner.engine.syncNow();
  server.enableSizes([size(server.workspaceId, 3.4 * GB, { drive_files: 3 }), size(second, 0)]);
  await owner.engine.syncNow();
  return { server, owner, second };
}

const openSwitcher = async (host: HTMLElement) => {
  await act(async () => host.querySelector<HTMLButtonElement>('.project-button')!.click());
  await settle();
};
const rowText = (id: string) => document.getElementById(`project-option-${id}`)?.textContent ?? '';

describe('selector de proyectos', () => {
  it('muestra el peso entre las páginas y la fecha, sin peso en cero, y no vuelve a pedir antes de 5 minutos', async () => {
    const { server, owner, second } = await workspace();
    expect(server.sizesCalls).toBe(0);
    const host = await mount(services(owner, server.ownerId), <ProjectSwitcher />);
    await openSwitcher(host);
    await vi.waitFor(() => expect(rowText(server.workspaceId)).toMatch(/My project0 pages · 3\.4 GB · /));
    expect(rowText(second)).not.toMatch(/KB|MB|GB/);
    expect(server.sizesCalls).toBe(1);

    // Cerrar y volver a abrir enseguida no pide de nuevo; muestra lo guardado.
    await openSwitcher(host);
    await openSwitcher(host);
    expect(rowText(server.workspaceId)).toContain('3.4 GB');
    expect(server.sizesCalls).toBe(1);

    act(() => prefs.set({ language: 'es' }));
    expect(rowText(server.workspaceId)).toMatch(/0 páginas · 3,4 GB · /);
  });

  it('quien no ve la papelera de archivos del proyecto no ve el peso, aunque haya uno guardado', async () => {
    const { server } = await workspace();
    server.addMember('editor-1', 'member');
    server.grant('editor-1', { projectId: server.workspaceId }, 'edit');
    const editor = await makeDevice(server, undefined, undefined, undefined, undefined, { id: 'editor-1' });
    devices.push(editor);
    await editor.engine.syncNow();
    // El servidor en memoria le responde lo mismo que al dueño: el dispositivo igual lo filtra.
    await editor.sizes.refresh();
    expect(editor.sizes.of(server.workspaceId)?.drive_bytes).toBe(3.4 * GB);
    const host = await mount(services(editor, 'editor-1'), <ProjectSwitcher />);
    await openSwitcher(host);
    expect(rowText(server.workspaceId)).toContain('0 pages');
    expect(rowText(server.workspaceId)).not.toContain('GB');
  });
});

describe('diálogo de Google Drive', () => {
  it('el total, lo de la papelera de Drive aparte, el desglose, la nota y "Volver a calcular"; sin red, el último cálculo', async () => {
    const { server, owner } = await workspace();
    server.sizes = [
      size(server.workspaceId, 3 * GB, { drive_files: 1200, trash_bytes: 200 * MB, trash_files: 4, drive_trash_bytes: 2 * GB, drive_trash_files: 2, pending_bytes: 61.9 * MB, pending_files: 3 }),
      size(null, 1 * GB, { drive_files: 3 }),
    ];
    // El portero no contesta: la sección del peso no depende de él.
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const host = await mount(services(owner, server.ownerId), <DriveDialog result={null} onClose={() => undefined} />);
    await vi.waitFor(() => expect(host.textContent).toContain('4 GB in 1,203 files'));
    const text = host.textContent ?? '';
    expect(text).toContain('Space in Drive');
    expect(text).toContain('+ 2 GB in the Google Drive trash');
    expect(text).toContain("200 MB of it in the app's trash · 61.9 MB (3 files) still uploading from devices · 1 GB in projects you don't see");
    expect(text).toContain('It counts what the app uploaded to Drive');
    expect(text).toMatch(/Updated \d{1,2}:\d\d/);
    // Se pide siempre al abrir el diálogo.
    expect(server.sizesCalls).toBe(1);

    const recalc = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Recalculate')!;
    server.sizes = [size(server.workspaceId, 5 * GB, { drive_files: 7 })];
    await act(async () => recalc.click());
    await vi.waitFor(() => expect(host.textContent).toContain('5 GB in 7 files'));
    expect(host.textContent).not.toContain('Google Drive trash');
    expect(host.textContent).not.toContain("projects you don't see");
    expect(server.sizesCalls).toBe(2);

    server.online = false;
    await act(async () => recalc.click());
    await vi.waitFor(() => expect(host.textContent).toContain('No connection: last calculated on'));
    expect(host.textContent).toContain('5 GB in 7 files');
  });

  it('con todo en la papelera de Drive no dice "todavía no se subió nada"', async () => {
    const { server, owner } = await workspace();
    server.sizes = [size(server.workspaceId, 0, { drive_trash_bytes: 2 * GB, drive_trash_files: 2 }), size(null, 0, { drive_files: 0 })];
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const host = await mount(services(owner, server.ownerId), <DriveDialog result={null} onClose={() => undefined} />);
    await vi.waitFor(() => expect(host.textContent).toContain('+ 2 GB in the Google Drive trash'));
    expect(host.textContent).toContain('Nothing in Drive outside its trash');
    expect(host.textContent).not.toContain('Nothing uploaded yet');
  });

  it('con una base sin project_sizes no muestra la sección', async () => {
    const server = new FakeServer();
    server.enableTrash();
    const owner = await makeDevice(server);
    devices.push(owner);
    await owner.engine.syncNow();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const host = await mount(services(owner, server.ownerId), <DriveDialog result={null} onClose={() => undefined} />);
    expect(host.textContent).toContain('Google Drive');
    expect(host.textContent).not.toContain('Space in Drive');
    expect(server.sizesCalls).toBe(0);
  });
});
