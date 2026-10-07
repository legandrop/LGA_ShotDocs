// @vitest-environment jsdom
import type { SupabaseClient } from '@supabase/supabase-js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefs } from '../prefs';
import { ServicesContext, type Services } from '../services';
import { SupabaseRemote, TRASH_ALL_PAGE } from '../sync/remote';
import type { TrashedFileRow } from '../sync/types';
import { FakeRemote, FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { ProjectSwitcher } from './ProjectSwitcher';

// La papelera de archivos con *All projects* en un solo pedido (supabase/migrations/
// 20261108120000_papelera_archivos_todos.sql): `trashed_files_all` trae lo de todos los proyectos cuya papelera ve la
// sesión. Con una base sin esa función, la app pide proyecto por proyecto como antes y muestra lo mismo. Y, al final,
// lo que se ve al mandar un archivo a la papelera de Drive con una app más vieja que la mínima del workspace
// (20261109120000_version_minima_papelera_archivos.sql).

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
  localStorage.clear();
  history.replaceState(null, '', '/');
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
    offline: d.offline,
    shutdown: async () => undefined,
  };
}

const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));

const byText = (text: string, scope: ParentNode = document) =>
  [...scope.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text);
const panel = () => document.querySelector<HTMLElement>('.trash-panel');
/** Los archivos que muestra la lista, ordenados por nombre. */
const files = () =>
  [...document.querySelectorAll<HTMLElement>('.trash-panel .trash-item[data-kind="file"]')]
    .map((li) => li.querySelector('.title, strong')?.textContent?.trim())
    .sort();

function fileInTrash(server: FakeServer, id: string, projectId: string): void {
  server.mediaFiles.set(id, {
    id, name: `${id}.jpg`, mime: 'image/jpeg', width: null, height: null, duration: null, thumb_at: null,
    drive_id: `d-${id}`, size: 2048, trashed_at: new Date().toISOString(), purged_at: null, drive_trashed_at: null, project_id: projectId,
  });
}

/**
 * El workspace del dueño con cuatro proyectos: "My project" (el abierto, P, con un archivo en la papelera), "Arena"
 * (A, con uno), "Bruma" (B, sin ninguno) y "Costa" (C, con uno). `withAll`: la base tiene `trashed_files_all`.
 */
async function workspace(withAll: boolean) {
  const server = new FakeServer();
  server.enableTrash();
  server.enableProjectStates();
  server.trashAllEnabled = withAll;
  const owner = await makeDevice(server);
  devices.push(owner);
  await owner.engine.syncNow();
  const p = server.workspaceId;
  const a = await owner.tree.createProject('Arena');
  const b = await owner.tree.createProject('Bruma');
  const c = await owner.tree.createProject('Costa');
  await owner.engine.syncNow();
  fileInTrash(server, 'de-p', p);
  fileInTrash(server, 'de-a', a);
  fileInTrash(server, 'de-c', c);
  return { server, owner, p, a, b, c };
}

async function openTrash(d: Device, userId: string): Promise<void> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<ServicesContext.Provider value={services(d, userId)}><ProjectSwitcher /></ServicesContext.Provider>));
  await settle();
  await act(async () => host.querySelector<HTMLButtonElement>('.project-button')!.click());
  await settle();
  await act(async () => byText('Trash')!.click());
  await vi.waitFor(() => expect(panel()).not.toBeNull(), { timeout: 5000 });
  await settle();
}

async function allProjects(): Promise<void> {
  await act(async () => byText('All projects')!.click());
  await settle();
  await vi.waitFor(() => expect(panel()!.textContent).not.toContain('Loading'));
}

const trashCalls = (server: FakeServer) => server.mediaCalls.filter((c) => c.startsWith('trashed_files'));

/** Una fila de `trashed_files_all` como la manda la API. `id` nulo: la fila con solo el proyecto (papelera vacía). */
type ApiRow = { project_id: string; id: string | null; trashed_at: string | null } & Record<string, unknown>;

const apiRow = (project_id: string, id: string | null, over: Record<string, unknown> = {}): ApiRow => ({
  project_id, id, name: id && `${id}.jpg`, mime: id && 'image/jpeg', size: id && '5000000000', thumb_at: null,
  trashed_at: id && '2026-10-01T10:00:00Z', days_left: id && 25, purged_at: null, in_trashed_page: id && false,
  trashed_page_title: null, in_deleted_project: id && false, ...over,
});

/** `n` archivos de un proyecto, cada uno con su hora (el primero, el más nuevo). */
const apiFiles = (project_id: string, prefix: string, n: number): ApiRow[] =>
  Array.from({ length: n }, (_, k) =>
    apiRow(project_id, `${prefix}-${String(k).padStart(4, '0')}`, { trashed_at: new Date(Date.UTC(2026, 9, 1) - k * 60_000).toISOString() }),
  );

/**
 * La API de la base, de mentira, para `trashed_files_all`, con lo que hace PostgREST: como mucho `MAX_ROWS` filas por
 * pedido (el tope del proyecto, 1000), el tramo que pide `range` y el orden que pide `order`. Sin orden pedido, una
 * función no promete ninguno: cada pedido las da empezando por otro lado. `fail`: el pedido número tal contesta ese
 * error. `before`: lo que pasa en la base justo antes de contestar cada pedido.
 */
const MAX_ROWS = 1000;
function fakeTrashApi(rows: ApiRow[], opts: { fail?: Record<number, { message: string; code: string; status: number }>; before?: (request: number, rows: ApiRow[]) => void } = {}) {
  const requests: { fn: string; order: string[]; range: [number, number] | null }[] = [];
  const compare = (order: string[]) => (x: ApiRow, y: ApiRow) => {
    for (const key of order) {
      const [column, direction, nulls] = key.split('.');
      const [a, b] = [x[column] as string | null, y[column] as string | null];
      if (a === b) continue;
      // Como Postgres: los nulos al final al subir y al principio al bajar, salvo que el pedido diga otra cosa.
      const nullsLast = nulls ? nulls === 'nullslast' : direction === 'asc';
      if (a === null) return nullsLast ? 1 : -1;
      if (b === null) return nullsLast ? -1 : 1;
      return (a < b ? -1 : 1) * (direction === 'asc' ? 1 : -1);
    }
    return 0;
  };
  const rpc = (fn: string) => {
    const request = { fn, order: [] as string[], range: null as [number, number] | null };
    const answer = async () => {
      requests.push(request);
      opts.before?.(requests.length, rows);
      const failure = opts.fail?.[requests.length];
      if (failure) return { data: null, error: { message: failure.message, code: failure.code }, status: failure.status };
      const turn = requests.length % rows.length;
      const listed = request.order.length ? [...rows].sort(compare(request.order)) : [...rows.slice(turn), ...rows.slice(0, turn)].reverse();
      const from = request.range?.[0] ?? 0;
      const to = Math.min(request.range?.[1] ?? Infinity, from + MAX_ROWS - 1);
      return { data: listed.slice(from, to + 1), error: null, status: 200 };
    };
    const builder = {
      order(column: string, o: { ascending?: boolean; nullsFirst?: boolean } = {}) {
        request.order.push(`${column}.${o.ascending === false ? 'desc' : 'asc'}${o.nullsFirst === undefined ? '' : o.nullsFirst ? '.nullsfirst' : '.nullslast'}`);
        return builder;
      },
      range(from: number, to: number) {
        request.range = [from, to];
        return builder;
      },
      then: <A, B>(ok: (v: Awaited<ReturnType<typeof answer>>) => A, no?: (e: unknown) => B) => answer().then(ok, no),
    };
    return builder;
  };
  return { remote: new SupabaseRemote({ rpc } as unknown as SupabaseClient, '0.218'), requests };
}

describe('la papelera de archivos con All projects', () => {
  it('con la base que las junta, los demás proyectos llegan en un solo pedido', async () => {
    const { server, owner, p } = await workspace(true);
    await openTrash(owner, server.ownerId);
    // El abierto, solo: su consulta de siempre.
    expect(trashCalls(server)).toEqual([`trashed_files ${p}`]);
    expect(files()).toEqual(['de-p.jpg']);
    await allProjects();
    expect(trashCalls(server)).toEqual([`trashed_files ${p}`, 'trashed_files_all']);
    expect(files()).toEqual(['de-a.jpg', 'de-c.jpg', 'de-p.jpg']);
    // Volver al abierto y otra vez a todos no pide nada más: cada proyecto, una vez.
    await act(async () => byText('This project')!.click());
    await settle();
    await allProjects();
    expect(trashCalls(server)).toEqual([`trashed_files ${p}`, 'trashed_files_all']);
  });

  it('con una base sin la función, la prueba una vez y pide proyecto por proyecto: se ve lo mismo', async () => {
    const { server, owner, p, a, b, c } = await workspace(false);
    await openTrash(owner, server.ownerId);
    await allProjects();
    expect(files()).toEqual(['de-a.jpg', 'de-c.jpg', 'de-p.jpg']);
    const calls = trashCalls(server);
    expect(calls.slice(0, 2)).toEqual([`trashed_files ${p}`, 'trashed_files_all']);
    expect(calls.slice(2).sort()).toEqual([`trashed_files ${a}`, `trashed_files ${b}`, `trashed_files ${c}`].sort());
  });

  it('un proyecto cuya papelera la base ya no deja ver no se muestra ni da error, por los dos caminos', async () => {
    for (const withAll of [true, false]) {
      const { server, p, a, c } = await workspace(withAll);
      server.addMember('ana', 'member');
      for (const projectId of [p, a, c]) server.grant('ana', { projectId }, 'edit_pages');
      const ana = await makeDevice(server, undefined, undefined, undefined, undefined, { id: 'ana' });
      devices.push(ana);
      await ana.engine.syncNow();
      // En la base, Ana baja a Editar en "Arena"; su dispositivo todavía no se enteró.
      server.grants.find((g) => g.user_id === 'ana' && g.project_id === a)!.level = 'edit';
      await expect(new FakeRemote(server, '0.021', 'ana').trashedFiles(a)).rejects.toThrow('not_allowed');
      server.mediaCalls.length = 0;
      await openTrash(ana, 'ana');
      await allProjects();
      expect(files()).toEqual(['de-c.jpg', 'de-p.jpg']);
      expect(panel()!.textContent).not.toContain("Couldn't");
      expect(panel()!.querySelector('button.link')).toBeNull();
      for (const r of roots.splice(0)) act(() => r.unmount());
      document.body.innerHTML = '';
    }
  });

  it('si el pedido falla, cada proyecto queda con su error y Retry lo pide por separado', async () => {
    const { server, owner, a, c } = await workspace(true);
    await openTrash(owner, server.ownerId);
    const remote = owner.remote as unknown as { trashedFilesAll: () => Promise<unknown> };
    const original = remote.trashedFilesAll.bind(owner.remote);
    remote.trashedFilesAll = async () => {
      server.mediaCalls.push('trashed_files_all');
      throw new Error('se cortó');
    };
    await allProjects();
    expect(files()).toEqual(['de-p.jpg']);
    const retries = [...panel()!.querySelectorAll<HTMLButtonElement>('button.link')].filter((b) => b.textContent === 'Retry');
    expect(retries).toHaveLength(3);
    expect(panel()!.textContent).toContain('se cortó');
    remote.trashedFilesAll = original;
    server.mediaCalls.length = 0;
    for (const retry of retries) await act(async () => retry.click());
    await settle();
    expect(files()).toEqual(['de-a.jpg', 'de-c.jpg', 'de-p.jpg']);
    expect(trashCalls(server).filter((call) => call === 'trashed_files_all')).toEqual([]);
    expect(trashCalls(server)).toContain(`trashed_files ${a}`);
    expect(trashCalls(server)).toContain(`trashed_files ${c}`);
  });
});

describe('la papelera de archivos con All projects y más archivos que el tope de un pedido', () => {
  /** Los archivos que la lista muestra de un proyecto (por el renglón que dice de qué proyecto es). */
  const shownOf = (project: string) =>
    [...document.querySelectorAll<HTMLElement>('.trash-panel .trash-item[data-kind="file"]')].filter((li) => li.querySelector('.trash-kind')?.textContent?.includes(project)).length;

  /** El dispositivo del dueño pidiendo `trashed_files_all` a la API de mentira (con su tope de filas). */
  async function withApi(opts: Parameters<typeof fakeTrashApi>[1] = {}) {
    const w = await workspace(true);
    // 1.051 filas: "Arena" con 600, "Bruma" vacía y "Costa" con 450. El corte cae en medio de "Costa" o la deja afuera.
    const rows = [...apiFiles(w.a, 'arena', 600), apiRow(w.b, null), ...apiFiles(w.c, 'costa', 450)];
    const api = fakeTrashApi(rows, opts);
    (w.owner.remote as unknown as { trashedFilesAll: () => Promise<unknown> }).trashedFilesAll = () => api.remote.trashedFilesAll();
    return { ...w, api, rows };
  }

  it('ningún proyecto queda oculto ni incompleto', async () => {
    const { server, owner, api, rows } = await withApi();
    expect(rows.length).toBeGreaterThan(MAX_ROWS);
    await openTrash(owner, server.ownerId);
    await act(async () => byText('Files')!.click());
    await allProjects();
    await vi.waitFor(() => expect(shownOf('Costa')).toBe(450));
    expect(shownOf('Arena')).toBe(600);
    expect(shownOf('My project')).toBe(1);
    expect(api.requests).toHaveLength(2);
    expect(panel()!.querySelector('button.link')).toBeNull();
  });

  it('si la segunda página falla, no muestra lo que llegó en la primera: cada proyecto con su error y su Retry', async () => {
    const { server, owner } = await withApi({ fail: { 2: { message: 'se cortó', code: '08006', status: 500 } } });
    await openTrash(owner, server.ownerId);
    await act(async () => byText('Files')!.click());
    await allProjects();
    expect(shownOf('Arena')).toBe(0);
    expect(shownOf('Costa')).toBe(0);
    expect(shownOf('My project')).toBe(1);
    expect([...panel()!.querySelectorAll('button.link')].filter((b) => b.textContent === 'Retry')).toHaveLength(3);
    expect(panel()!.textContent).toContain('se cortó');
  });
});

describe('la papelera que se ve vacía y la que no se ve', () => {
  /** Ana edita "My project" (no ve su papelera) y, para su dispositivo, edita y crea en "Arena" y "Bruma", las dos vacías. */
  async function ana(withAll: boolean) {
    const { server, a, b } = await workspace(withAll);
    server.mediaFiles.clear();
    server.addMember('ana', 'member');
    server.grant('ana', { projectId: server.workspaceId }, 'edit');
    for (const projectId of [a, b]) server.grant('ana', { projectId }, 'edit_pages');
    const device = await makeDevice(server, undefined, undefined, undefined, undefined, { id: 'ana' });
    devices.push(device);
    await device.engine.syncNow();
    return { server, device, a, b };
  }
  const filters = () => [...document.querySelectorAll('.trash-filter button')].map((x) => x.textContent);

  it('las que ve y están vacías ofrecen Files, que dice que no hay archivos; por los dos caminos', async () => {
    for (const withAll of [true, false]) {
      const { device } = await ana(withAll);
      await openTrash(device, 'ana');
      expect(filters()).not.toContain('Files');
      await allProjects();
      await vi.waitFor(() => expect(filters()).toContain('Files'));
      await act(async () => byText('Files')!.click());
      expect(panel()!.textContent).toContain('No files in the trash.');
      for (const r of roots.splice(0)) act(() => r.unmount());
      document.body.innerHTML = '';
    }
  });

  it('las que la base ya no le deja ver no ofrecen Files; por los dos caminos', async () => {
    for (const withAll of [true, false]) {
      const { server, device, a, b } = await ana(withAll);
      // En la base, Ana baja a Editar en las dos; su dispositivo todavía no se enteró.
      for (const g of server.grants) if (g.user_id === 'ana' && (g.project_id === a || g.project_id === b)) g.level = 'edit';
      server.mediaCalls.length = 0;
      await openTrash(device, 'ana');
      await allProjects();
      await vi.waitFor(() => expect(trashCalls(server).length).toBeGreaterThan(0));
      await settle();
      expect(filters()).not.toContain('Files');
      expect(panel()!.textContent).not.toContain("Couldn't");
      for (const r of roots.splice(0)) act(() => r.unmount());
      document.body.innerHTML = '';
    }
  });
});

describe('mandar a la papelera de Drive con la app más vieja que la mínima del workspace', () => {
  it('avisa que hay que actualizar la app, el archivo queda en la lista sin un error propio y nada se manda', async () => {
    const { server, owner } = await workspace(true);
    await openTrash(owner, server.ownerId);
    await act(async () => byText('Files')!.click());
    // Suben la mínima con la papelera abierta: esta app (0.021) quedó vieja y todavía no lo sabe.
    server.settings = { ...server.settings!, minAppVersion: 0.5 };
    const notices: string[] = [];
    const listen = (e: Event) => notices.push(String((e as CustomEvent<unknown>).detail));
    window.addEventListener('shotdocs:notice', listen);
    vi.stubGlobal('confirm', () => true);
    const row = () => [...document.querySelectorAll<HTMLElement>('.trash-item')].find((li) => li.textContent?.includes('de-p.jpg'))!;
    await act(async () => byText('Send to Drive trash', row())!.click());
    await vi.waitFor(() => expect(notices).toHaveLength(1));
    window.removeEventListener('shotdocs:notice', listen);
    expect(notices[0]).toBe('This workspace needs a newer version of the app. Reload the app to update it and try again.');
    await settle();
    expect(files()).toEqual(['de-p.jpg']);
    expect(row().querySelector('.trash-error')).toBeNull();
    expect(server.mediaFiles.get('de-p')).toMatchObject({ purged_at: null, drive_trashed_at: null });
    expect(server.portero.driveTrash.size).toBe(0);
  });
});

describe('el servidor en memoria junta las papeleras como la base', () => {
  it('a cada persona le da lo mismo que proyecto por proyecto, vacía la que ve sin archivos y nada de la que no ve ni de un proyecto borrado', async () => {
    const { server, p, a, b, c } = await workspace(true);
    server.addMember('ana', 'member');
    server.addMember('admin', 'admin');
    server.addMember('invitada', 'guest');
    server.addMember('lee', 'member');
    server.grant('ana', { projectId: a }, 'edit_pages');
    server.grant('ana', { projectId: b }, 'edit_pages');
    server.grant('ana', { projectId: c }, 'edit');
    server.grant('admin', { projectId: c }, 'view');
    server.grant('invitada', { projectId: a }, 'edit_pages');
    server.grant('lee', { projectId: a }, 'view');
    server.deletedProjects.set(c, { at: new Date().toISOString(), by: server.ownerId });

    for (const who of [server.ownerId, 'ana', 'admin', 'invitada', 'lee']) {
      const remote = new FakeRemote(server, '0.021', who);
      const all = (await remote.trashedFilesAll())!;
      for (const id of [p, a, b, c]) {
        const one = await remote.trashedFiles(id).catch(() => null);
        expect(all.get(id) ?? null, `${who} en ${id}`).toEqual(one);
      }
    }
    const names = async (who: string) =>
      [...(await new FakeRemote(server, '0.021', who).trashedFilesAll())!].map(([id, list]) => `${server.projects.get(id)?.name}:${list.map((f) => f.name)}`).sort();
    expect(await names(server.ownerId)).toEqual(['Arena:de-a.jpg', 'Bruma:', 'My project:de-p.jpg']);
    expect(await names('ana')).toEqual(['Arena:de-a.jpg', 'Bruma:']);
    expect(await names('admin')).toEqual([]);
    expect(await names('invitada')).toEqual([]);
    expect(await names('lee')).toEqual([]);

    server.trashAllEnabled = false;
    expect(await new FakeRemote(server, '0.021').trashedFilesAll()).toBeNull();
  });
});

describe('el pedido a la base', () => {
  const ORDER = ['project_id.asc', 'trashed_at.desc.nullslast', 'id.asc'];

  it('agrupa las filas por proyecto, sin el proyecto en cada archivo; la fila con solo el proyecto es una papelera vacía', async () => {
    const { remote, requests } = fakeTrashApi([
      apiRow('P1', 'a'),
      apiRow('P1', 'b', { in_trashed_page: true, trashed_page_title: 'Escena' }),
      apiRow('P2', null),
      apiRow('P3', 'c'),
    ]);
    const all = (await remote.trashedFilesAll())!;
    expect(requests).toEqual([{ fn: 'trashed_files_all', order: ORDER, range: [0, TRASH_ALL_PAGE - 1] }]);
    expect([...all.keys()]).toEqual(['P1', 'P2', 'P3']);
    expect(all.get('P2')).toEqual([]);
    expect(all.get('P1')!.map((f) => f.id)).toEqual(['a', 'b']);
    expect(all.get('P1')![0]).toEqual({
      id: 'a', name: 'a.jpg', mime: 'image/jpeg', size: 5_000_000_000, thumb_at: null, trashed_at: '2026-10-01T10:00:00Z', days_left: 25,
      purged_at: null, in_trashed_page: false, trashed_page_title: null, in_deleted_project: false,
    });
    expect(all.get('P1')![1]).toMatchObject({ in_trashed_page: true, trashed_page_title: 'Escena' });
  });

  it('sin la función en la base (PGRST202) da null; otro error tira', async () => {
    const missing = { message: 'Could not find the function', code: 'PGRST202', status: 404 };
    expect(await fakeTrashApi([], { fail: { 1: missing } }).remote.trashedFilesAll()).toBeNull();
    await expect(fakeTrashApi([], { fail: { 1: { message: 'permission denied', code: '42501', status: 403 } } }).remote.trashedFilesAll()).rejects.toThrow(
      'permission denied',
    );
  });

  it('con más filas que el tope de un pedido sigue pidiendo hasta agotar: ningún proyecto queda afuera ni incompleto', async () => {
    // 1.181 filas en cuatro proyectos: el corte de las 1.000 cae en medio de P3, y P4 queda entero del otro lado.
    const rows = [...apiFiles('P1', 'uno', 700), apiRow('P2', null), ...apiFiles('P3', 'tres', 450), ...apiFiles('P4', 'cuatro', 30)];
    expect(rows.length).toBeGreaterThan(MAX_ROWS);
    const { remote, requests } = fakeTrashApi(rows);
    const all = (await remote.trashedFilesAll())!;
    expect([...all].map(([id, files]) => `${id}:${files.length}`)).toEqual(['P1:700', 'P2:0', 'P3:450', 'P4:30']);
    // Cada proyecto, entero, sin repetidos y en el orden de `trashed_files` (lo último primero).
    for (const [id, prefix] of [['P1', 'uno'], ['P3', 'tres'], ['P4', 'cuatro']] as const) {
      expect(all.get(id)!.map((f: TrashedFileRow) => f.id)).toEqual(apiFiles(id, prefix, all.get(id)!.length).map((r) => r.id));
    }
    // Dos pedidos, uno a continuación del otro y con el mismo orden escrito en los dos.
    expect(requests).toEqual([
      { fn: 'trashed_files_all', order: ORDER, range: [0, TRASH_ALL_PAGE - 1] },
      { fn: 'trashed_files_all', order: ORDER, range: [TRASH_ALL_PAGE, 2 * TRASH_ALL_PAGE - 1] },
    ]);
  });

  it('con justo el tope pide una vez más, que llega vacía, y con muchas páginas las junta todas', async () => {
    const exact = fakeTrashApi([...apiFiles('P1', 'uno', MAX_ROWS - 1), apiRow('P2', null)]);
    const all = (await exact.remote.trashedFilesAll())!;
    expect([...all].map(([id, files]) => `${id}:${files.length}`)).toEqual([`P1:${MAX_ROWS - 1}`, 'P2:0']);
    expect(exact.requests.map((r) => r.range![0])).toEqual([0, TRASH_ALL_PAGE]);

    const many = fakeTrashApi([...apiFiles('P1', 'uno', 1200), ...apiFiles('P2', 'dos', 1300), ...apiFiles('P3', 'tres', 5)]);
    const big = (await many.remote.trashedFilesAll())!;
    expect([...big].map(([id, files]) => `${id}:${files.length}`)).toEqual(['P1:1200', 'P2:1300', 'P3:5']);
    expect(many.requests).toHaveLength(3);
  });

  it('si una página falla a mitad, falla todo: nunca una lista parcial dada por completa', async () => {
    const rows = [...apiFiles('P1', 'uno', 700), ...apiFiles('P3', 'tres', 450)];
    const cut = fakeTrashApi(rows, { fail: { 2: { message: 'se cortó', code: '08006', status: 500 } } });
    await expect(cut.remote.trashedFilesAll()).rejects.toThrow('se cortó');
    expect(cut.requests).toHaveLength(2);
    // Tampoco se toma por "la base no tiene la función" si eso llegara en una página que no es la primera.
    const odd = fakeTrashApi(rows, { fail: { 2: { message: 'Could not find the function', code: 'PGRST202', status: 404 } } });
    await expect(odd.remote.trashedFilesAll()).rejects.toThrow('Could not find the function');
  });

  it('un archivo que entra a la papelera entre dos páginas no repite ninguno', async () => {
    const rows = [...apiFiles('P1', 'uno', 700), ...apiFiles('P3', 'tres', 450)];
    const { remote } = fakeTrashApi(rows, {
      // Antes de la segunda página entra uno nuevo al principio de P1: todo lo demás se corre un lugar.
      before: (request, list) => {
        if (request === 2) list.push(apiRow('P1', 'recien', { trashed_at: '2026-10-02T00:00:00.000Z' }));
      },
    });
    const all = (await remote.trashedFilesAll())!;
    const ids = [...all.values()].flat().map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(all.get('P1')).toHaveLength(700);
    expect(all.get('P3')).toHaveLength(450);
  });
});
