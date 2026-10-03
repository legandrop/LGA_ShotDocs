// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { prefs } from '../prefs';
import { ServicesContext, type Services } from '../services';
import { block, group } from '../sync/historyTesting';
import { PUBLIC_LINK_FILES_MAX } from '../sync/publicLinks';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { HistoryPanel } from './HistoryPanel';
import { LinkAsideNotice } from './LinkAsideNotice';
import { LinkShare } from './LinkShare';

// Lo que ve el equipo de *Can edit* por un link (Docs/Doc_Link_Publico.md, E2.8), montado de verdad: *Share* con *Can
// edit* (apagado sin el interruptor) y sus números, el aviso de lo apartado en la página con *Download it*, y el
// historial con "Ana (via link)".

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Lo que el historial necesita de un navegador (como historyPanel.test.tsx).
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
});

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
});

function services(d: Device, client: unknown = { rpc: async () => ({ data: null, error: null, status: 200 }), auth: {} }): Services {
  const config = {
    url: 'https://znlvpuddswymxpffgvbz.supabase.co',
    publishableKey: 'sb_publishable_testtesttest',
    name: 'Wanka',
    localKey: WANKA_LOCAL_KEY,
    storage: legacyStorageNames(WANKA_LOCAL_KEY),
  };
  return {
    workspace: { config, client: client as never },
    client: client as never,
    user: { id: d.remote.userId, email: `${d.remote.userId}@test` },
    db: d.db, tree: d.tree, docs: d.docs, files: d.files, media: d.media, engine: d.engine, access: d.access,
    remote: d.remote as unknown as SupabaseRemote, dbName: 'test', mediaDb: d.mediaDb, comments: d.comments,
    commentsDb: d.commentsDb, sizes: d.sizes, offline: d.offline, shutdown: async () => undefined,
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
const settle = (ms = 40) => act(async () => new Promise((r) => setTimeout(r, ms)));

function pick(host: HTMLElement, label: string, value: string) {
  const select = host.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** Las funciones de quien comparte, en memoria, con Can edit (20261027120000_link_editar.sql, simplificadas). */
function fakeShareClient(editOn: boolean) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  let link: Record<string, unknown> | null = null;
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    const ok = (data: unknown) => ({ data, error: null, status: 200 });
    if (fn === 'get_public_link') return ok({ clean_on: true, edit_on: editOn, link, above: null });
    if (fn === 'create_public_link' || fn === 'set_public_link') {
      if (args.p_level === 'edit' && !editOn) return { data: null, error: { message: 'edit_off', code: 'P0001' }, status: 400 };
      link = {
        id: 'l1', page_id: args.p_page, level: args.p_level, created_at: '2026-10-03T10:00:00Z', expires_at: args.p_expires ?? null,
        created_by_name: 'owner', token: 'sdl_' + 'x'.repeat(43), alive: true, usage_today: {}, limited: false, comments: 0,
        edits: { waiting: 2, held: 1, aside: 3, admitted_today: 5, push_bytes_total: 900 },
      };
      return ok(link);
    }
    return { data: null, error: { message: 'unexpected ' + fn, code: '42501' }, status: 401 };
  };
  return { client: { rpc, auth: { signOut: vi.fn() } }, calls };
}

async function teamDevice() {
  const server = new FakeServer();
  let clock = Date.parse('2026-10-03T10:00:00Z');
  server.now = () => clock;
  server.enableTeam();
  server.enableClean(0.001);
  server.enableLinkEdit(0.001);
  const d = await makeDevice(server);
  devices.push(d);
  const page = await d.tree.create(null, 'Brief');
  await d.engine.syncNow();
  return { server, d, page, tick: (ms: number) => (clock += ms) };
}

describe('Can edit en Share', () => {
  it('sin el interruptor: Can edit apagado con su línea; prendido: se elige, se crea con edit, la línea de cómo llega y los números', async () => {
    prefs.set({ language: 'en' });
    const off = await teamDevice();
    const a = fakeShareClient(false);
    const hostOff = await mount(services(off.d, a.client), <LinkShare pageId={off.page} onClose={() => undefined} />);
    const editOption = hostOff.querySelector('select[aria-label="Can edit"] option[value="edit"]') as HTMLOptionElement;
    expect(editOption.disabled).toBe(true);
    expect(hostOff.textContent).toContain("Editing through a link isn't turned on for this workspace yet.");
    act(() => roots.pop()!.unmount());

    const on = await teamDevice();
    const b = fakeShareClient(true);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async () => undefined } });
    const host = await mount(services(on.d, b.client), <LinkShare pageId={on.page} onClose={() => undefined} />);
    pick(host, 'Can edit', 'edit');
    expect(host.textContent).toContain('Changes made through the link reach other people when someone from your team opens the app.');
    pick(host, 'General access', 'anyone');
    await settle();
    expect(b.calls.find((c) => c.fn === 'create_public_link')!.args).toMatchObject({ p_level: 'edit' });
    expect(host.textContent).toContain('5 changes added today · 2 waiting · 3 set aside · 1 on hold');
    // Cambiar el vencimiento no lo baja a Can view.
    pick(host, 'Expires', '7');
    await settle();
    expect(b.calls.find((c) => c.fn === 'set_public_link')!.args).toMatchObject({ p_level: 'edit' });
  });
});

describe('el aviso de lo apartado y el historial', () => {
  it('quien edita ve lo apartado con el motivo y lo baja; el historial muestra al visitante como (via link)', async () => {
    prefs.set({ language: 'en' });
    const { server, d, page, tick } = await teamDevice();
    // Contenido del equipo y una fila del link admitida y otra apartada (directo en la sala).
    const doc = await d.docs.open(page);
    doc.transact(() => group(doc).push([block('b0', 'del equipo')]), 'test');
    await d.docs.flush(page);
    d.docs.close(page);
    await d.engine.syncNow();
    const link = { id: 'link-1', pageId: page, createdBy: server.ownerId, level: 'edit' as const };
    server.publicLinks.set('sdl_' + 'z'.repeat(43), link);
    const visitor = new Y.Doc();
    for (const u of server.updates.get(page)!) Y.applyUpdate(visitor, u.data);
    const sv = Y.encodeStateVector(visitor);
    group(visitor).push([block('v0', 'del link')]);
    const row = Y.encodeStateAsUpdate(visitor, sv);
    const base = { linkId: link.id, pageId: page, author: 'Ana', device: null, appVersion: 0.01, createdAt: server.now(), decidedAt: null, decidedBy: null, decision: null, reason: null, admittedSeq: null };
    server.linkRoom.push({ ...base, id: 'r1', n: 1, clientUpdateId: 'c1', data: row, bytes: row.length });
    server.linkRoom.push({ ...base, id: 'r2', n: 2, clientUpdateId: 'c2', data: new Uint8Array([9, 9, 9]), bytes: 3 });
    server.admit(server.ownerId, '0.021', page, [{ id: 'r1', ok: true }, { id: 'r2', ok: false, reason: 'undecodable' }]);
    tick(1000);
    await d.engine.syncNow();

    const saved: Blob[] = [];
    vi.stubGlobal('URL', { ...URL, createObjectURL: (b: Blob) => (saved.push(b), 'blob:x'), revokeObjectURL: () => undefined });
    const host = await mount(services(d), <LinkAsideNotice pageId={page} />);
    expect(host.textContent).toContain("A change sent through the link couldn't be added to this page.");
    expect(host.textContent).toContain("Reason: the app couldn't add it safely.");
    const download = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Download it')!;
    await act(async () => download.click());
    await settle();
    expect(saved).toHaveLength(1);
    const file = JSON.parse(await saved[0].text()) as { kind: string; changes: { id: string; reason: string; text: string; yjsUpdate: string }[] };
    expect(file.kind).toBe('lga-shotdocs-link-changes');
    expect(file.changes.map((c) => [c.id, c.reason, c.text, c.yjsUpdate])).toEqual([['r2', 'undecodable', '', 'CQkJ']]);
    act(() => roots.pop()!.unmount());

    // Quien no ve lo borrado (Comentar) no ve el aviso.
    const reader = await makeDevice(server, undefined, '0.021', {}, undefined, { id: 'lector' });
    devices.push(reader);
    server.addMember('lector', 'member');
    server.grant('lector', { pageId: page }, 'comment');
    await reader.engine.syncNow();
    const hostReader = await mount(services(reader), <LinkAsideNotice pageId={page} />);
    expect(hostReader.textContent).toBe('');
    act(() => roots.pop()!.unmount());

    // El historial: la fila admitida, como de "Ana (via link)".
    const hostHistory = await mount(services(d), <HistoryPanel pageId={page} />);
    await settle(300);
    expect(hostHistory.textContent).toContain('Ana (via link)');
  });
});

describe('lo que el link sube al Drive, en Share (entrega 2b)', () => {
  /** `get_public_link` con un link Can edit que ya subió archivos. */
  function filesClient(files: { total: number; bytes: number } | undefined, level: 'edit' | 'comment' = 'edit', today = 2) {
    const link = {
      id: 'l1', page_id: 'p', level, created_at: '2026-10-03T10:00:00Z', expires_at: null, created_by_name: 'owner',
      token: 'sdl_' + 'x'.repeat(43), alive: true, usage_today: { file: { n: today, bytes: 0 } }, limited: false, comments: 0,
      edits: { waiting: 0, held: 0, aside: 0, admitted_today: 0, push_bytes_total: 0 }, ...(files ? { files } : {}),
    };
    return { rpc: async (fn: string) => (fn === 'get_public_link' ? { data: { clean_on: true, edit_on: true, link, above: null }, error: null, status: 200 } : { data: [], error: null, status: 200 }), auth: {} };
  }

  it('cuántos archivos subió (hoy y en total, con el peso) y, desde 1 GB, el aviso; sin la base 21 o en Can view sin archivos, nada', async () => {
    prefs.set({ language: 'en' });
    const big = await teamDevice();
    const host = await mount(services(big.d, filesClient({ total: 3, bytes: 1.25 * 1024 ** 3 })), <LinkShare pageId={big.page} onClose={() => undefined} />);
    expect(host.textContent).toContain('Files added through the link: 2 today · 3 in all (1.3 GB in your Drive)');
    expect(host.textContent).toContain('This link has uploaded 1.3 GB to your Drive.');
    act(() => roots.pop()!.unmount());

    const small = await teamDevice();
    const host2 = await mount(services(small.d, filesClient({ total: 1, bytes: 5 * 1024 ** 2 })), <LinkShare pageId={small.page} onClose={() => undefined} />);
    expect(host2.textContent).toContain('(5.0 MB in your Drive)');
    expect(host2.textContent).not.toContain('has uploaded');
    act(() => roots.pop()!.unmount());

    // Una base anterior a la 21 no lo dice; un link Can view sin archivos tampoco lo muestra.
    const old = await teamDevice();
    const host3 = await mount(services(old.d, filesClient(undefined)), <LinkShare pageId={old.page} onClose={() => undefined} />);
    expect(host3.textContent).not.toContain('Files added through the link');
    act(() => roots.pop()!.unmount());
    const view = await teamDevice();
    const host4 = await mount(services(view.d, filesClient({ total: 0, bytes: 0 }, 'comment', 0)), <LinkShare pageId={view.page} onClose={() => undefined} />);
    expect(host4.textContent).not.toContain('Files added through the link');
  });
});

describe('los archivos de los links de la página, en Share (decisión de Lega, entrega 2b)', () => {
  function filesClient(files: Record<string, unknown>[] | { error: string }) {
    const calls: string[] = [];
    const link = {
      id: 'l2', page_id: 'p', level: 'edit', created_at: '2026-10-03T10:00:00Z', expires_at: null, created_by_name: 'owner',
      token: 'sdl_' + 'x'.repeat(43), alive: true, usage_today: {}, limited: false, comments: 0,
      edits: { waiting: 0, held: 0, aside: 0, admitted_today: 0, push_bytes_total: 0 }, files: { total: 1, bytes: 5 * 1024 * 1024, drive_bytes: 0 },
    };
    const rpc = async (fn: string) => {
      calls.push(fn);
      if (fn === 'get_public_link') return { data: { clean_on: true, edit_on: true, link, above: null }, error: null, status: 200 };
      if (fn === 'public_link_files') {
        return 'error' in files
          ? { data: null, error: { message: files.error, code: 'P0002' }, status: 404 }
          : { data: files, error: null, status: 200 };
      }
      return { data: [], error: null, status: 200 };
    };
    return { client: { rpc, auth: {} }, calls };
  }
  const row = (id: string, over: Record<string, unknown>) => ({
    id, link_id: 'l2', link_live: true, page_id: 'p', name: `${id}.jpg`, mime: 'image/jpeg', size: 2048,
    created_at: '2026-10-03T10:00:00Z', uploaded: true, trashed: false, ...over,
  });

  it('lista los de cada link de la página (también uno anterior), con Download solo para lo que llegó al Drive', async () => {
    prefs.set({ language: 'en' });
    const { server, d, page } = await teamDevice();
    server.enableLinkFiles();
    await d.engine.syncNow();
    const c = filesClient([
      row('subido', {}),
      row('cortado', { link_id: 'l1', link_live: false, uploaded: false }),
      row('sacado', { trashed: true }),
    ]);
    const host = await mount(services(d, c.client), <LinkShare pageId={page} onClose={() => undefined} />);
    expect(c.calls).toContain('public_link_files');
    const list = host.querySelector('.link-files-list')!;
    expect(list.textContent).toContain("3 files were added through this page's link");
    expect(list.textContent).toContain('subido.jpg');
    expect(list.textContent).toContain('cortado.jpg');
    expect(list.textContent).toContain('earlier link');
    expect(list.textContent).toContain("didn't finish uploading");
    expect(list.textContent).toContain('in the trash');
    const rows = [...list.querySelectorAll('li')];
    expect(rows.map((li) => !!li.querySelector('button'))).toEqual([true, false, true]);
    // Share dice lo que llegó al Drive, no lo registrado (O3).
    expect(host.textContent).toContain('(0.0 MB in your Drive)');
  });

  it('el tope de la app es el `limit` de public_link_files en la migración (si uno cambia, el otro también)', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync('supabase/migrations/20261030120000_link_archivos.sql', 'utf8');
    const body = sql.slice(sql.indexOf('create function public.public_link_files'));
    expect(Number(/limit (\d+);/.exec(body)![1])).toBe(PUBLIC_LINK_FILES_MAX);
  });

  // O-R3 de la re-verificación: la base devuelve hasta 500; con 500 el total de verdad puede ser mayor y el título no puede
  // afirmar «500 files».
  it('con la lista cortada en el tope (500) el título dice «o más»; con 499 dice la cantidad exacta', async () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => row(`f${String(i).padStart(3, '0')}`, { uploaded: false }));
    for (const [n, title, capped] of [
      [499, "499 files were added through this page's link", false],
      [500, "500 or more files were added through this page's link", true],
    ] as const) {
      prefs.set({ language: 'en' });
      const { server, d, page } = await teamDevice();
      server.enableLinkFiles();
      await d.engine.syncNow();
      const host = await mount(services(d, filesClient(many(n)).client), <LinkShare pageId={page} onClose={() => undefined} />);
      const list = host.querySelector('.link-files-list')!;
      expect(list.querySelector('strong')!.textContent).toBe(title);
      // Se muestran 20 y el resto se cuenta; con el tope se aclara que hay más que no se listan.
      expect(list.querySelectorAll('li')).toHaveLength(20);
      expect(list.textContent).toContain(`and ${n - 20} more`);
      expect(list.textContent!.includes("plus older ones that aren't listed")).toBe(capped);
      act(() => roots.pop()!.unmount());
    }
    // En castellano.
    prefs.set({ language: 'es' });
    const { server, d, page } = await teamDevice();
    server.enableLinkFiles();
    await d.engine.syncNow();
    const host = await mount(services(d, filesClient(many(500)).client), <LinkShare pageId={page} onClose={() => undefined} />);
    expect(host.querySelector('.link-files-list strong')!.textContent).toBe('Se sumaron 500 archivos o más con el link de esta página');
    prefs.set({ language: 'en' });
  });

  it('sin permiso (no ve lo borrado) o con la base anterior a la 21: no hay lista', async () => {
    prefs.set({ language: 'en' });
    const a = await teamDevice();
    a.server.enableLinkFiles();
    await a.d.engine.syncNow();
    const denied = filesClient({ error: 'page_not_found' });
    const host = await mount(services(a.d, denied.client), <LinkShare pageId={a.page} onClose={() => undefined} />);
    expect(host.querySelector('.link-files-list')).toBeNull();
    act(() => roots.pop()!.unmount());
    const b = await teamDevice();
    const old = filesClient([row('x', {})]);
    const host2 = await mount(services(b.d, old.client), <LinkShare pageId={b.page} onClose={() => undefined} />);
    expect(old.calls).not.toContain('public_link_files');
    expect(host2.querySelector('.link-files-list')).toBeNull();
  });
});
