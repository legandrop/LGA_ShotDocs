// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectSizes, SIZES_SCHEMA_VERSION } from '../media/projectSizes';
import { prefs } from '../prefs';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { RemoteError, type ProjectSizeRow } from '../sync/types';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { FilesBySizePanel } from './FilesBySize';
import { ProjectSwitcher } from './ProjectSwitcher';

// "Files by size" (P.8) en la interfaz, contra el servidor en memoria (que lee `files` y `page_files` con sus
// políticas): la entrada en el selector de proyectos, la lista ordenada con el link a cada página, elegir el proyecto,
// quién la ve y qué ve cada uno, y los estados sin red, con error, vacío y "Show more".

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
  history.replaceState(null, '', '/');
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

function size(projectId: string, driveBytes: number, driveFiles: number): ProjectSizeRow {
  return {
    project_id: projectId,
    drive_bytes: driveBytes,
    drive_files: driveFiles,
    trash_bytes: 0,
    trash_files: 0,
    drive_trash_bytes: 0,
    drive_trash_files: 0,
    pending_bytes: 0,
    pending_files: 0,
  };
}

/** Un archivo ya subido al Drive, usado por estas páginas (como lo dejan `register_file` y el portero). */
function addFile(
  server: FakeServer,
  name: string,
  mime: string,
  bytes: number,
  pages: string[],
  extra: { trashed_at?: string; drive_id?: string | null; drive_trashed_at?: string; project_id?: string; thumb_at?: string } = {},
): string {
  const id = crypto.randomUUID();
  server.mediaFiles.set(id, {
    id,
    project_id: server.workspaceId,
    name,
    mime,
    size: bytes,
    width: null,
    height: null,
    duration: null,
    thumb_at: null,
    drive_id: `drive-${id}`,
    trashed_at: null,
    purged_at: null,
    drive_trashed_at: null,
    created_by: server.ownerId,
    ...extra,
  });
  for (const pageId of pages) server.pageFiles.add(`${pageId}:${id}`);
  return id;
}

/** Un proyecto del dueño con dos páginas y otro proyecto vacío. */
async function workspace(): Promise<{ server: FakeServer; owner: Device; day1: string; day2: string; second: string }> {
  const server = new FakeServer();
  server.enableSizes();
  const owner = await makeDevice(server);
  devices.push(owner);
  await owner.engine.syncNow();
  const day1 = await owner.tree.create(null, 'Día 1');
  const day2 = await owner.tree.create(null, 'Día 2');
  const second = await owner.tree.createProject('Vacío');
  await owner.engine.syncNow();
  return { server, owner, day1, day2, second };
}

const openSwitcher = async (host: HTMLElement) => {
  await act(async () => host.querySelector<HTMLButtonElement>('.project-button')!.click());
  await settle();
};
const rowOf = (id: string) => document.getElementById(`project-option-${id}`)?.closest('.project-row') ?? null;
/** "Files by size", al pie de la lista de proyectos. */
const filesEntry = () => [...document.querySelectorAll<HTMLButtonElement>('.project-menu > button')].find((b) => b.textContent === 'Files by size');
const picker = () => document.querySelector<HTMLSelectElement>('.files-by-size select');
const items = () => [...document.querySelectorAll<HTMLElement>('.files-by-size .trash-item')];
const names = () => items().map((li) => li.querySelector('.title')!.textContent);
const panelText = () => document.querySelector('.files-by-size')?.textContent ?? '';
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('.files-by-size button')].find((b) => b.textContent === text);
const listCalls = (server: FakeServer) => server.mediaCalls.filter((c) => c.startsWith('files_by_size'));
const MISSING = "more is in files you can't see from here";

/**
 * Un peso que el dispositivo ya tenía guardado (`saved`) y cuyos pedidos siguientes quedan esperando hasta que la
 * prueba los contesta: para ver qué muestra la lista mientras el peso se vuelve a calcular.
 */
async function heldSizes(saved: ProjectSizeRow[]) {
  let pending: { resolve: (rows: ProjectSizeRow[]) => void; reject: (err: unknown) => void } | null = null;
  let first = true;
  const store = new ProjectSizes(null, {
    projectSizes: () => {
      if (first) {
        first = false;
        return Promise.resolve(saved);
      }
      return new Promise<ProjectSizeRow[]>((resolve, reject) => (pending = { resolve, reject }));
    },
  });
  store.configure(SIZES_SCHEMA_VERSION);
  await store.refresh();
  const take = () => {
    const p = pending;
    pending = null;
    if (!p) throw new Error('nadie pidió el peso');
    return p;
  };
  return {
    store,
    asked: () => pending !== null,
    answer: (rows: ProjectSizeRow[]) => act(async () => take().resolve(rows)),
    fail: (err: unknown) => act(async () => take().reject(err)),
  };
}

describe('desde el selector de proyectos', () => {
  it('donde se ve el peso se abre la lista: del más pesado al más liviano, con tipo, peso y el link a la página', async () => {
    const { server, owner, day1, day2, second } = await workspace();
    addFile(server, 'plano.jpg', 'image/jpeg', 12 * MB, [day1]);
    addFile(server, 'toma_03.mov', 'video/quicktime', 2 * GB, [day1, day2]);
    addFile(server, 'guion.pdf', 'application/pdf', 300 * MB, [day2]);
    // No ocupan lugar en el Drive: sin subir, y ya en la papelera de Drive.
    addFile(server, 'sin_subir.mov', 'video/quicktime', 9 * GB, [day1], { drive_id: null });
    addFile(server, 'en_drive_trash.mov', 'video/quicktime', 8 * GB, [], { trashed_at: '2026-10-01T10:00:00Z', drive_trashed_at: '2026-10-02T10:00:00Z' });
    server.sizes = [size(server.workspaceId, 2 * GB + 312 * MB, 3), size(second, 0, 0)];

    const host = await mount(services(owner, server.ownerId), <ProjectSwitcher />);
    await openSwitcher(host);
    await vi.waitFor(() => expect(filesEntry()).toBeDefined());
    // La entrada no le saca lugar a los renglones: está al pie, no entre los íconos de cada proyecto.
    expect(rowOf(server.workspaceId)!.textContent).not.toContain('Files by size');
    expect(rowOf(server.workspaceId)!.querySelector('[aria-label="Files by size"]')).toBeNull();

    await act(async () => filesEntry()!.click());
    await vi.waitFor(() => expect(items()).toHaveLength(3));
    // Un solo proyecto con peso: no hay entre cuáles elegir (el que no pesa no se ofrece).
    expect(picker()).toBeNull();
    expect(panelText()).not.toContain('Vacío');
    expect(names()).toEqual(['toma_03.mov', 'guion.pdf', 'plano.jpg']);
    expect(items().map((li) => li.querySelector('.files-by-size-weight')!.textContent)).toEqual(['2 GB', '300 MB', '12 MB']);
    expect(items().map((li) => li.querySelector('.trash-kind')!.textContent)).toEqual(['Video', 'File', 'Photo']);
    expect(panelText()).toContain('My project2.3 GB in Google Drive, in 3 files');
    expect(panelText()).not.toContain("can't see from here");
    const links = (li: HTMLElement) => [...li.querySelectorAll<HTMLButtonElement>('.files-by-size-pages button')];
    expect(links(items()[0]).map((b) => b.textContent)).toEqual(['Día 1', 'Día 2']);
    expect(items().some((li) => li.dataset.unused)).toBe(false);

    // En castellano, lo mismo.
    act(() => prefs.set({ language: 'es' }));
    expect(items().map((li) => li.querySelector('.trash-kind')!.textContent)).toEqual(['Video', 'Archivo', 'Foto']);
    expect(panelText()).toContain('2,3 GB en Google Drive, en 3 archivos');
    act(() => prefs.set({ language: 'en' }));

    // El nombre entero queda en el tooltip, que sale solo si está cortado; nunca en `title`.
    const name = items()[0].querySelector<HTMLElement>('.title')!;
    expect(name.dataset.tip).toBe('toma_03.mov');
    expect(name.hasAttribute('data-tip-overflow')).toBe(true);
    expect(name.hasAttribute('data-tip-plain')).toBe(true);
    expect(links(items()[0])[0].hasAttribute('data-tip-overflow')).toBe(true);
    expect(document.querySelector('.project-menu [title]')).toBeNull();

    // El link abre la página y cierra el selector.
    await act(async () => links(items()[0])[1].click());
    expect(location.pathname).toBe(`/p/${day2}`);
    expect(document.querySelector('.project-menu')).toBeNull();
  });

  it('Escape en la lista vuelve a los proyectos sin cerrar el selector', async () => {
    const { server, owner, day1 } = await workspace();
    addFile(server, 'plano.jpg', 'image/jpeg', 12 * MB, [day1]);
    server.sizes = [size(server.workspaceId, 12 * MB, 1)];
    const host = await mount(services(owner, server.ownerId), <ProjectSwitcher />);
    await openSwitcher(host);
    await vi.waitFor(() => expect(filesEntry()).toBeDefined());
    await act(async () => filesEntry()!.click());
    await vi.waitFor(() => expect(items()).toHaveLength(1));
    expect(document.getElementById('project-listbox')).toBeNull();

    await act(async () => {
      document.querySelector('.project-back')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('.files-by-size')).toBeNull();
    expect(document.getElementById('project-listbox')).not.toBeNull();
    expect(filesEntry()).toBeDefined();
  });

  it('una página de otro proyecto lleva el nombre de ese proyecto', async () => {
    const { server, owner, day1, second } = await workspace();
    const board = await owner.tree.create(null, 'Tablero', second);
    await owner.engine.syncNow();
    const id = addFile(server, 'lut_show.cube', 'application/octet-stream', 2 * MB, [day1]);
    // Un uso ajeno: la foto es de este proyecto y está pegada en una página del otro.
    server.foreignPageFiles.add(`${board}:${id}`);
    await mount(services(owner, server.ownerId), <FilesBySizePanel projectId={server.workspaceId} onClose={() => undefined} />);
    await vi.waitFor(() => expect(items()).toHaveLength(1));
    const shown = [...items()[0].querySelectorAll('.files-by-size-pages button')].map((b) => b.textContent);
    expect(shown).toEqual(['Día 1', 'Tablero · Vacío']);
  });

  it('no pide la miniatura de un archivo que la base dice que no tiene', async () => {
    const { server, owner, day1 } = await workspace();
    const withThumb = addFile(server, 'plano.jpg', 'image/jpeg', 12 * MB, [day1], { thumb_at: '2026-10-01T10:00:00Z' });
    addFile(server, 'paquete.zip', 'application/zip', 300 * MB, [day1]);
    addFile(server, 'sin_miniatura.mov', 'video/quicktime', 900 * MB, [day1]);
    const asked: string[] = [];
    const real = owner.media.thumbnail.bind(owner.media);
    owner.media.thumbnail = (id: string) => {
      asked.push(id);
      return real(id);
    };
    await mount(services(owner, server.ownerId), <FilesBySizePanel projectId={server.workspaceId} onClose={() => undefined} />);
    await vi.waitFor(() => expect(items()).toHaveLength(3));
    await settle();
    expect(asked).toEqual([withThumb]);
    // Sin miniatura, un adjunto muestra su tipo.
    expect(items()[1].querySelector('.trash-thumb-file')?.textContent).toBe('ZIP');
  });

  it('con varios proyectos con peso se elige cuál, el más pesado primero; abre el abierto y, si no pesa, el más pesado', async () => {
    const { server, owner, day1, second } = await workspace();
    addFile(server, 'plano.jpg', 'image/jpeg', 12 * MB, [day1]);
    // De una página que este dispositivo no tiene: está en uso, pero no hay a dónde ir.
    addFile(server, 'master.mov', 'video/quicktime', 5 * GB, [], { project_id: second });
    server.sizes = [size(server.workspaceId, 12 * MB, 1), size(second, 5 * GB, 1)];

    const host = await mount(services(owner, server.ownerId), <ProjectSwitcher />);
    await openSwitcher(host);
    await vi.waitFor(() => expect(filesEntry()).toBeDefined());
    await act(async () => filesEntry()!.click());
    await vi.waitFor(() => expect(names()).toEqual(['plano.jpg']));
    expect(picker()!.value).toBe(server.workspaceId);
    expect([...picker()!.options].map((o) => o.textContent)).toEqual(['Vacío · 5 GB', 'My project · 12 MB']);

    await act(async () => {
      picker()!.value = second;
      picker()!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await vi.waitFor(() => expect(names()).toEqual(['master.mov']));
    expect(items()[0].textContent).toContain("On a page you can't open from this device");
    expect(panelText()).toContain('5 GB in Google Drive, in 1 file');
    act(() => roots.splice(0).forEach((r) => r.unmount()));
    document.body.innerHTML = '';

    // El abierto dejó de pesar: la lista se abre en el más pesado.
    server.sizes = [size(second, 5 * GB, 1)];
    await owner.sizes.refresh();
    const again = await mount(services(owner, server.ownerId), <ProjectSwitcher />);
    await openSwitcher(again);
    await act(async () => filesEntry()!.click());
    await vi.waitFor(() => expect(names()).toEqual(['master.mov']));
    expect(picker()).toBeNull();
    expect(panelText()).toContain('Vacío');
  });

  it('un archivo que ninguna página viva usa se distingue; el de una página de la papelera dice dónde está', async () => {
    const { server, owner, day1, day2 } = await workspace();
    addFile(server, 'en_uso.jpg', 'image/jpeg', 10 * MB, [day1]);
    addFile(server, 'suelto.mov', 'video/quicktime', 900 * MB, [], { trashed_at: '2026-10-01T10:00:00Z' });
    const inTrashedPage = addFile(server, 'de_pagina_borrada.mov', 'video/quicktime', 500 * MB, [day2]);
    await owner.tree.trash(day2);
    await owner.engine.syncNow();
    server.refreshAllFileTrash();
    expect(server.mediaFiles.get(inTrashedPage)!.trashed_at).toBeTruthy();

    await mount(services(owner, server.ownerId), <FilesBySizePanel projectId={server.workspaceId} onClose={() => undefined} />);
    await vi.waitFor(() => expect(items()).toHaveLength(3));
    expect(names()).toEqual(['suelto.mov', 'de_pagina_borrada.mov', 'en_uso.jpg']);
    expect(items().map((li) => li.dataset.unused ?? null)).toEqual(['true', 'true', null]);
    expect(items()[0].textContent).toContain("Not used on any page (it's in the trash)");
    expect(items()[0].textContent).not.toContain("can't open");
    expect(items()[0].querySelector('.files-by-size-pages')).toBeNull();
    expect(items()[1].textContent).toContain('Día 2 (in the trash)');
    expect(items()[2].textContent).not.toContain('Not used');
  });

  it('con más páginas de las que entran, "+N more pages" las muestra todas', async () => {
    const { server, owner } = await workspace();
    const pages: string[] = [];
    for (let i = 1; i <= 5; i++) pages.push(await owner.tree.create(null, `Escena ${i}`));
    await owner.engine.syncNow();
    addFile(server, 'logo.png', 'image/png', 4 * MB, pages);
    await mount(services(owner, server.ownerId), <FilesBySizePanel projectId={server.workspaceId} onClose={() => undefined} />);
    await vi.waitFor(() => expect(items()).toHaveLength(1));
    const shown = () => [...items()[0].querySelectorAll('.files-by-size-pages button')].map((b) => b.textContent);
    expect(shown()).toEqual(['Escena 1', 'Escena 2', 'Escena 3', '+2 more pages']);
    await act(async () => button('+2 more pages')!.click());
    expect(shown()).toEqual(['Escena 1', 'Escena 2', 'Escena 3', 'Escena 4', 'Escena 5']);
  });
});

describe('quién la ve y qué ve', () => {
  it('quien no ve el peso del proyecto no tiene la entrada, y la lista abierta a mano no le pide nada a la base', async () => {
    const { server, day1 } = await workspace();
    addFile(server, 'plano.jpg', 'image/jpeg', 12 * MB, [day1]);
    server.sizes = [size(server.workspaceId, 12 * MB, 1)];
    server.addMember('editor-1', 'member');
    server.grant('editor-1', { projectId: server.workspaceId }, 'edit');
    const editor = await makeDevice(server, undefined, undefined, undefined, undefined, { id: 'editor-1' });
    devices.push(editor);
    await editor.engine.syncNow();
    await editor.sizes.refresh();

    const host = await mount(services(editor, 'editor-1'), <ProjectSwitcher />);
    await openSwitcher(host);
    expect(rowOf(server.workspaceId)).not.toBeNull();
    expect(filesEntry()).toBeUndefined();

    await mount(services(editor, 'editor-1'), <FilesBySizePanel projectId={server.workspaceId} onClose={() => undefined} />);
    await vi.waitFor(() => expect(panelText()).toContain("Only people who see this project's file trash can see this list."));
    expect(items()).toHaveLength(0);
    expect(listCalls(server)).toHaveLength(0);
  });

  it('entre los proyectos para elegir no entra uno cuyo peso la persona no ve, aunque el dispositivo lo tenga guardado', async () => {
    const { server, day1, second } = await workspace();
    addFile(server, 'plano.jpg', 'image/jpeg', 12 * MB, [day1]);
    addFile(server, 'master.mov', 'video/quicktime', 5 * GB, [], { project_id: second });
    server.sizes = [size(server.workspaceId, 12 * MB, 1), size(second, 5 * GB, 1)];
    // Ve la papelera de archivos del primero ("Editar y crear páginas") y no la del segundo ("Editar").
    server.addMember('pm-1', 'member');
    server.grant('pm-1', { projectId: server.workspaceId }, 'edit_pages');
    server.grant('pm-1', { projectId: second }, 'edit');
    const pm = await makeDevice(server, undefined, undefined, undefined, undefined, { id: 'pm-1' });
    devices.push(pm);
    await pm.engine.syncNow();
    await pm.sizes.refresh();
    expect(pm.sizes.of(second)?.drive_bytes).toBe(5 * GB);
    expect(pm.tree.project(second)?.name).toBe('Vacío');

    const host = await mount(services(pm, 'pm-1'), <ProjectSwitcher />);
    await openSwitcher(host);
    await vi.waitFor(() => expect(filesEntry()).toBeDefined());
    await act(async () => filesEntry()!.click());
    await vi.waitFor(() => expect(names()).toEqual(['plano.jpg']));
    expect(picker()).toBeNull();
    expect(panelText()).not.toContain('Vacío');
  });

  it('cada uno ve los archivos que la base le deja leer: a un admin que solo ve el proyecto no le llega lo sacado, y se le dice cuánto falta', async () => {
    const { server, owner, day1 } = await workspace();
    addFile(server, 'en_uso.jpg', 'image/jpeg', 10 * MB, [day1]);
    // Sacado de su página: el uso queda marcado y solo lo ve quien ve lo borrado de esa página (quien la edita).
    const removed = addFile(server, 'sacado.mov', 'video/quicktime', 900 * MB, [], { trashed_at: '2026-10-01T10:00:00Z' });
    server.removedPageFiles.add(`${day1}:${removed}`);
    server.sizes = [size(server.workspaceId, 910 * MB, 2)];
    server.addMember('admin-1', 'admin');
    server.grant('admin-1', { projectId: server.workspaceId }, 'view');
    const admin = await makeDevice(server, undefined, undefined, undefined, undefined, { id: 'admin-1' });
    devices.push(admin);
    await admin.engine.syncNow();
    await admin.sizes.refresh();
    await owner.sizes.refresh();

    // El admin ve el peso (y la entrada), pero de la lista solo lo que puede leer.
    const host = await mount(services(admin, 'admin-1'), <ProjectSwitcher />);
    await openSwitcher(host);
    await vi.waitFor(() => expect(filesEntry()).toBeDefined());
    await act(async () => filesEntry()!.click());
    await vi.waitFor(() => expect(items()).toHaveLength(1));
    expect(names()).toEqual(['en_uso.jpg']);
    expect(panelText()).toContain(`900 MB ${MISSING}.`);
    act(() => roots.splice(0).forEach((r) => r.unmount()));
    document.body.innerHTML = '';

    // La dueña los ve todos, y nada le falta.
    await mount(services(owner, server.ownerId), <FilesBySizePanel projectId={server.workspaceId} onClose={() => undefined} />);
    await vi.waitFor(() => expect(items()).toHaveLength(2));
    expect(names()).toEqual(['sacado.mov', 'en_uso.jpg']);
    expect(panelText()).not.toContain(MISSING);
  });

  it('al dueño no le dice que le falta algo por un peso viejo: lo pide al abrir y, mientras llega, no dice nada', async () => {
    const { server, owner, day1 } = await workspace();
    addFile(server, 'en_uso.jpg', 'image/jpeg', 10 * MB, [day1]);
    // Recién mandado a la papelera de Drive: el peso guardado en el dispositivo todavía lo cuenta.
    addFile(server, 'ya_en_drive_trash.mov', 'video/quicktime', 900 * MB, [], { trashed_at: '2026-10-01T10:00:00Z', drive_trashed_at: '2026-10-06T10:00:00Z' });
    const sizes = await heldSizes([size(server.workspaceId, 910 * MB, 2)]);
    await mount({ ...services(owner, server.ownerId), sizes: sizes.store }, <FilesBySizePanel projectId={server.workspaceId} onClose={() => undefined} />);
    await vi.waitFor(() => expect(names()).toEqual(['en_uso.jpg']));
    // La lista está entera y el peso nuevo todavía no llegó: se ve el número guardado, sin el aviso.
    expect(sizes.asked()).toBe(true);
    expect(panelText()).toContain('910 MB in Google Drive, in 2 files');
    expect(panelText()).not.toContain(MISSING);

    await sizes.answer([size(server.workspaceId, 10 * MB, 1)]);
    expect(panelText()).toContain('10 MB in Google Drive, in 1 file');
    expect(panelText()).not.toContain(MISSING);
  });

  it('lo que falta se dice con el peso recién pedido; mientras se vuelve a calcular o si ese pedido falla, no', async () => {
    const { server, owner, day1 } = await workspace();
    addFile(server, 'en_uso.jpg', 'image/jpeg', 10 * MB, [day1]);
    const sizes = await heldSizes([size(server.workspaceId, 10 * MB, 1)]);
    await mount({ ...services(owner, server.ownerId), sizes: sizes.store }, <FilesBySizePanel projectId={server.workspaceId} onClose={() => undefined} />);
    await vi.waitFor(() => expect(names()).toEqual(['en_uso.jpg']));
    expect(panelText()).not.toContain(MISSING);
    await sizes.answer([size(server.workspaceId, 910 * MB, 2)]);
    expect(panelText()).toContain(`900 MB ${MISSING}.`);

    // Otro pedido en camino: el número puede estar por cambiar.
    await act(async () => void sizes.store.refresh());
    expect(sizes.asked()).toBe(true);
    expect(panelText()).not.toContain(MISSING);
    // Falló: el número que queda es el de antes y no se compara contra él.
    await sizes.fail(new RemoteError('boom', false, 'XX000'));
    expect(panelText()).toContain('910 MB in Google Drive');
    expect(panelText()).not.toContain(MISSING);

    await act(async () => void sizes.store.refresh());
    await sizes.answer([size(server.workspaceId, 910 * MB, 2)]);
    expect(panelText()).toContain(`900 MB ${MISSING}.`);
  });
});

describe('estados', () => {
  it('sin red no pide nada y lo dice; al volver la red, carga sola', async () => {
    const { server, owner, day1 } = await workspace();
    addFile(server, 'plano.jpg', 'image/jpeg', 12 * MB, [day1]);
    server.online = false;
    await owner.engine.syncNow();
    expect(owner.engine.getStatus().online).toBe(false);
    // El servidor en memoria no anota un pedido que no le llega: se cuentan acá.
    let asked = 0;
    const real = owner.remote.filesBySize.bind(owner.remote);
    owner.remote.filesBySize = (...args) => {
      asked++;
      return real(...args);
    };

    await mount(services(owner, server.ownerId), <FilesBySizePanel projectId={server.workspaceId} onClose={() => undefined} />);
    expect(panelText()).toContain('The list of files needs an internet connection.');
    expect(button('Retry')).toBeUndefined();
    expect(asked).toBe(0);

    server.online = true;
    await act(async () => owner.engine.syncNow());
    await vi.waitFor(() => expect(names()).toEqual(['plano.jpg']));
    expect(panelText()).not.toContain('needs an internet connection');
  });

  it('con la lista entera, quedarse sin red no avisa nada: no falta pedir nada', async () => {
    const { server, owner, day1 } = await workspace();
    addFile(server, 'plano.jpg', 'image/jpeg', 12 * MB, [day1]);
    await mount(services(owner, server.ownerId), <FilesBySizePanel projectId={server.workspaceId} onClose={() => undefined} />);
    await vi.waitFor(() => expect(names()).toEqual(['plano.jpg']));
    server.online = false;
    await act(async () => owner.engine.syncNow());
    expect(owner.engine.getStatus().online).toBe(false);
    expect(names()).toEqual(['plano.jpg']);
    expect(panelText()).not.toContain('needs an internet connection');
  });

  it('si el pedido se queda sin red, lo dice con Retry; si la base falla, dice por qué, y Retry trae la lista', async () => {
    const { server, owner, day1 } = await workspace();
    addFile(server, 'plano.jpg', 'image/jpeg', 12 * MB, [day1]);
    const real = owner.remote.filesBySize.bind(owner.remote);
    owner.remote.filesBySize = async () => {
      throw new RemoteError('Failed to fetch', false, undefined, true);
    };
    await mount(services(owner, server.ownerId), <FilesBySizePanel projectId={server.workspaceId} onClose={() => undefined} />);
    await vi.waitFor(() => expect(panelText()).toContain('The list of files needs an internet connection.'));
    expect(panelText()).not.toContain('Failed to fetch');

    owner.remote.filesBySize = async () => {
      throw new RemoteError('canceling statement due to statement timeout', false, '57014');
    };
    await act(async () => button('Retry')!.click());
    await vi.waitFor(() => expect(panelText()).toContain('The files could not be listed (canceling statement due to statement timeout).'));
    expect(items()).toHaveLength(0);

    owner.remote.filesBySize = real;
    await act(async () => button('Retry')!.click());
    await vi.waitFor(() => expect(names()).toEqual(['plano.jpg']));
    expect(button('Retry')).toBeUndefined();
    expect(panelText()).not.toContain('could not be listed');
  });

  it('un proyecto sin archivos en el Drive lo dice', async () => {
    const { server, owner, second } = await workspace();
    await mount(services(owner, server.ownerId), <FilesBySizePanel projectId={second} onClose={() => undefined} />);
    await vi.waitFor(() => expect(panelText()).toContain('This project has no files in Google Drive.'));
    expect(items()).toHaveLength(0);
    expect(button('Show more')).toBeUndefined();
    expect(panelText()).toContain('Vacío');
  });

  it('con más de un tramo muestra los 100 más pesados y "Show more" trae los que siguen', async () => {
    const { server, owner, day1 } = await workspace();
    const ids: string[] = [];
    for (let n = 1; n <= 130; n++) ids.push(addFile(server, `foto_${String(n).padStart(3, '0')}.jpg`, 'image/jpeg', n * MB, [day1]));
    // El número del proyecto tiene 50 MB más que lo que la lista va a mostrar.
    server.sizes = [size(server.workspaceId, ((130 * 131) / 2 + 50) * MB, 131)];
    await mount(services(owner, server.ownerId), <FilesBySizePanel projectId={server.workspaceId} onClose={() => undefined} />);
    await vi.waitFor(() => expect(items()).toHaveLength(100));
    await settle();
    expect(names()[0]).toBe('foto_130.jpg');
    expect(names()[99]).toBe('foto_031.jpg');
    // Con un tramo solo no se sabe todavía cuánto falta: el aviso va recién con la lista entera.
    expect(panelText()).toContain('in 131 files');
    expect(panelText()).not.toContain(MISSING);
    await act(async () => button('Show more')!.click());
    await vi.waitFor(() => expect(items()).toHaveLength(130));
    expect(names()[129]).toBe('foto_001.jpg');
    expect(button('Show more')).toBeUndefined();
    expect(panelText()).toContain(`50 MB ${MISSING}.`);
    // El segundo tramo sigue desde el último archivo del primero (foto_031), no desde un número de fila.
    expect(listCalls(server)).toEqual([`files_by_size ${server.workspaceId} start`, `files_by_size ${server.workspaceId} ${ids[30]}`]);
  });
});
