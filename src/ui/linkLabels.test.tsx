// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { LinkContext, type LinkInfo } from '../linkMode';
import { prefs } from '../prefs';
import { ServicesContext, type Services } from '../services';
import type { CommentRow } from '../sync/comments';
import type { LinkLabel } from '../sync/publicLinks';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { CommentsPanel, linkLabelText } from './CommentsPanel';
import { closeComments, showComments } from './commentsUi';
import { LINK_LABELS_EVERY_MS, LINK_LABELS_MISSING_MS, LinkLabelsStore, type LinkLabelsPerms } from './linkLabels';
import { LinkShare } from './LinkShare';

// De qué link vino cada comentario hecho por un link público (Docs/Doc_Link_Publico.md, "De qué link vino cada
// comentario"): lo ve solo quien puede compartir la página del link (lo decide la base, `public_link_labels`), se pide
// una vez por conjunto de links y lo recordado no pasa de una cuenta a otra.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined,
    addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
  })) as never;
});

const L1 = '00000000-0000-4000-8000-0000000000c1';
const L2 = '00000000-0000-4000-8000-0000000000c2';
const label = (over: Partial<LinkLabel> = {}): LinkLabel => ({ level: 'comment', createdBy: 'lega', revoked: false, expired: false, alive: true, ...over });

// ---------------------------------------------------------------------------------------------------------------
// El store: cuándo pide y qué recuerda.
// ---------------------------------------------------------------------------------------------------------------

/** La base, en memoria: los rótulos que contesta a esta sesión. `gate`: el pedido espera hasta soltarlo. */
function fakeApi(known: Record<string, LinkLabel>) {
  const api = {
    asked: [] as string[][],
    known,
    missing: false,
    fail: false,
    gate: null as Promise<void> | null,
    labels: async (ids: string[]) => {
      api.asked.push([...ids].sort());
      const now = { ...api.known };
      if (api.gate) await api.gate;
      if (api.fail) throw new Error('Failed to fetch');
      if (api.missing) return null;
      return new Map(ids.filter((id) => now[id]).map((id) => [id, now[id]] as const));
    },
  };
  return api;
}

const engine = (online = true, schemaVersion = 25) => ({ subscribe: () => () => undefined, getStatus: () => ({ online, schemaVersion }) });
const perms = (over: Partial<LinkLabelsPerms> = {}): (() => LinkLabelsPerms) => () => ({ known: true, role: 'owner', canSharePage: () => true, ...over });
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('los rótulos de los links de los comentarios (el store)', () => {
  it('un pedido por el conjunto de links, no uno por comentario; lo ya pedido no se repite', async () => {
    const api = fakeApi({ [L1]: label(), [L2]: label({ level: 'edit', revoked: true, alive: false }) });
    const store = new LinkLabelsStore(api, engine(), perms());
    store.want('p', [L1, L2, L1, 'otro']);
    await store.refresh();
    expect(api.asked).toEqual([[L1, L2, 'otro'].sort()]);
    expect(store.get().get(L1)).toEqual(label());
    expect(store.get().get(L2)).toEqual(label({ level: 'edit', revoked: true, alive: false }));
    // El que la base no contestó no tiene rótulo, y tampoco se vuelve a pedir en cada vuelta.
    expect(store.get().has('otro')).toBe(false);
    store.want('p', [L1, L2, 'otro']);
    await store.refresh();
    await store.refresh();
    expect(api.asked).toHaveLength(1);
    // Un link nuevo en la página: se pide solo ese.
    store.want('p', [L1, L2, 'otro', 'nuevo']);
    await store.refresh();
    expect(api.asked.slice(1)).toEqual([['nuevo']]);
  });

  it('sin poder compartir la página no se pide nada; con dos páginas, solo lo de la que comparte', async () => {
    const api = fakeApi({ [L1]: label(), [L2]: label() });
    const store = new LinkLabelsStore(api, engine(), perms({ canSharePage: (id) => id === 'mia' }));
    store.want('ajena', [L1]);
    await store.refresh();
    expect(api.asked).toEqual([]);
    expect(store.get().size).toBe(0);
    store.want('mia', [L2]);
    await store.refresh();
    expect(api.asked).toEqual([[L2]]);
    expect([...store.get().keys()]).toEqual([L2]);
  });

  it('sin saber los permisos, para un invitado, sin red o con una base anterior a los links no pregunta nada', async () => {
    for (const [e, p] of [
      [engine(), perms({ known: false })],
      [engine(), perms({ role: 'guest' })],
      [engine(), perms({ role: null })],
      [engine(false), perms()],
      [engine(true, 13), perms()],
    ] as const) {
      const api = fakeApi({ [L1]: label() });
      const store = new LinkLabelsStore(api, e, p);
      store.want('p', [L1]);
      await store.refresh();
      expect(api.asked).toEqual([]);
      expect(store.get().size).toBe(0);
    }
  });

  it('con una base sin la función no hay rótulo ni error, y no insiste hasta pasados diez minutos', async () => {
    let now = 1_000_000;
    const api = fakeApi({ [L1]: label() });
    api.missing = true;
    const store = new LinkLabelsStore(api, engine(), perms(), () => now);
    store.want('p', [L1]);
    await store.refresh();
    expect(store.get().size).toBe(0);
    now += LINK_LABELS_MISSING_MS - 1;
    await store.refresh();
    expect(api.asked).toHaveLength(1);
    // Se migró: pasado el plazo vuelve a probar y el rótulo aparece.
    api.missing = false;
    now += 1;
    await store.refresh();
    expect(api.asked).toHaveLength(2);
    expect(store.get().get(L1)).toEqual(label());
  });

  it('un pedido que falla (sin red a mitad de camino) no tira ni borra lo que había, y se reintenta recién pasado el plazo', async () => {
    let now = 1_000_000;
    const api = fakeApi({ [L1]: label() });
    const store = new LinkLabelsStore(api, engine(), perms(), () => now);
    store.want('p', [L1]);
    await store.refresh();
    api.fail = true;
    store.want('p', [L1, L2]);
    await expect(store.refresh()).resolves.toBeUndefined();
    expect(store.get().get(L1)).toEqual(label());
    await store.refresh();
    expect(api.asked).toHaveLength(2);
    api.fail = false;
    api.known[L2] = label({ level: 'edit' });
    now += LINK_LABELS_EVERY_MS;
    await store.refresh();
    expect(store.get().get(L2)).toEqual(label({ level: 'edit' }));
  });

  it('lo que se muestra se vuelve a pedir cada dos minutos: un link que se cerró cambia, y uno que la base ya no contesta pierde el rótulo', async () => {
    let now = 1_000_000;
    const api = fakeApi({ [L1]: label(), [L2]: label() });
    const store = new LinkLabelsStore(api, engine(), perms(), () => now);
    let published = 0;
    store.subscribe(() => published++);
    store.want('p', [L1, L2]);
    await store.refresh();
    expect(published).toBe(1);
    now += LINK_LABELS_EVERY_MS - 1;
    await store.refresh();
    expect(api.asked).toHaveLength(1);
    api.known[L1] = label({ revoked: true, alive: false });
    delete api.known[L2];
    now += 1;
    await store.refresh();
    expect(api.asked).toHaveLength(2);
    expect(store.get().get(L1)).toEqual(label({ revoked: true, alive: false }));
    expect(store.get().has(L2)).toBe(false);
    expect(published).toBe(2);
    // Sin cambios, no avisa de nuevo.
    now += LINK_LABELS_EVERY_MS;
    await store.refresh();
    expect(published).toBe(2);
  });

  it('lo que Share acaba de cambiar se vuelve a pedir en el acto, sin esperar el plazo', async () => {
    const api = fakeApi({ [L1]: label() });
    const store = new LinkLabelsStore(api, engine(), perms());
    store.want('p', [L1]);
    await store.refresh();
    api.known[L1] = label({ revoked: true, alive: false });
    store.stale();
    await settle();
    await store.refresh();
    expect(api.asked).toHaveLength(2);
    expect(store.get().get(L1)?.revoked).toBe(true);
  });

  it('cuando cambian los permisos de la persona se vuelve a pedir en el acto: lo que la base ya no contesta se va sin esperar el plazo', async () => {
    const api = fakeApi({ [L1]: label(), [L2]: label() });
    let permsChanged = () => undefined as void;
    const store = new LinkLabelsStore(api, engine(), perms(), Date.now, (fn) => {
      permsChanged = fn;
      return () => undefined;
    });
    store.subscribe(() => undefined);
    store.want('p', [L1, L2]);
    await store.refresh();
    expect([...store.get().keys()].sort()).toEqual([L1, L2]);
    // Sigue compartiendo la página del comentario, pero ya no la del link L1: la base deja de contestarlo.
    delete api.known[L1];
    permsChanged();
    await new Promise((r) => setTimeout(r, 20));
    expect(api.asked).toHaveLength(2);
    expect([...store.get().keys()]).toEqual([L2]);
  });

  it('lo pedido mientras un pedido viaja sale después, en otro pedido', async () => {
    const api = fakeApi({ [L1]: label(), [L2]: label() });
    let release = () => undefined as void;
    api.gate = new Promise<void>((r) => (release = r));
    const store = new LinkLabelsStore(api, engine(), perms());
    store.want('p', [L1]);
    store.want('p', [L1, L2]);
    expect(api.asked).toEqual([[L1]]);
    release();
    // Sin que nadie vuelva a pedir: al volver el primero sale solo el segundo.
    await new Promise((r) => setTimeout(r, 20));
    expect(api.asked).toEqual([[L1], [L2]]);
    expect([...store.get().keys()].sort()).toEqual([L1, L2]);
  });

  it('si el rol baja a invitado (o sacan a la persona) con la app abierta, se vacía todo y un pedido en viaje no escribe nada', async () => {
    const api = fakeApi({ [L1]: label(), [L2]: label() });
    let role: LinkLabelsPerms['role'] = 'admin';
    const store = new LinkLabelsStore(api, engine(), () => ({ known: true, role, canSharePage: () => true }));
    store.want('p', [L1]);
    await store.refresh();
    expect(store.get().size).toBe(1);
    // Un pedido en viaje cuando baja el rol.
    let release = () => undefined as void;
    api.gate = new Promise<void>((r) => (release = r));
    store.want('p', [L1, L2]);
    const flying = store.refresh();
    role = 'guest';
    await store.refresh();
    expect(store.get().size).toBe(0);
    // Lo que se publique de acá en más: nunca un rótulo, ni por un instante.
    const seen: number[] = [];
    store.subscribe(() => seen.push(store.get().size));
    release();
    await flying;
    await settle();
    expect(store.get().size).toBe(0);
    expect(seen.every((n) => n === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// El texto, en los dos idiomas.
// ---------------------------------------------------------------------------------------------------------------

describe('el rótulo en palabras', () => {
  afterEach(() => act(() => prefs.set({ language: 'en' })));

  it('en inglés: el nivel, quién lo creó y cómo está si ya no anda', () => {
    act(() => prefs.set({ language: 'en' }));
    expect(linkLabelText(t, label())).toBe('Can view link · created by lega');
    expect(linkLabelText(t, label({ level: 'edit' }))).toBe('Can edit link · created by lega');
    expect(linkLabelText(t, label({ createdBy: null, alive: false }))).toBe('Can view link · not working');
    expect(linkLabelText(t, label({ revoked: true, alive: false }))).toBe('Can view link · created by lega · closed');
    expect(linkLabelText(t, label({ expired: true, alive: false }))).toBe('Can view link · created by lega · expired');
    // Apagado y además vencido: lo que cuenta es que está cerrado.
    expect(linkLabelText(t, label({ revoked: true, expired: true, alive: false }))).toBe('Can view link · created by lega · closed');
    expect(linkLabelText(t, label({ alive: false }))).toBe('Can view link · created by lega · not working');
  });

  it('en castellano', () => {
    act(() => prefs.set({ language: 'es' }));
    expect(linkLabelText(t, label())).toBe('Link Puede ver · lo creó lega');
    expect(linkLabelText(t, label({ level: 'edit', createdBy: null }))).toBe('Link Puede editar');
    expect(linkLabelText(t, label({ revoked: true, alive: false }))).toBe('Link Puede ver · lo creó lega · cerrado');
    expect(linkLabelText(t, label({ expired: true, alive: false }))).toBe('Link Puede ver · lo creó lega · vencido');
    expect(linkLabelText(t, label({ alive: false }))).toBe('Link Puede ver · lo creó lega · no anda');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// El panel de comentarios, contra el servidor en memoria.
// ---------------------------------------------------------------------------------------------------------------

const roots: Root[] = [];
const devices: Device[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.mentions.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  act(() => closeComments());
  act(() => prefs.set({ language: 'en' }));
  document.body.innerHTML = '';
});

function services(d: Device, client: unknown): Services {
  const config = { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_testtesttest', name: 'Wanka', localKey: WANKA_LOCAL_KEY, storage: legacyStorageNames(WANKA_LOCAL_KEY) };
  const userId = (d.remote as unknown as { userId: string }).userId;
  return {
    workspace: { config, client: client as never },
    client: client as never,
    user: { id: userId, email: `${userId}@test` },
    db: d.db, tree: d.tree, docs: d.docs, files: d.files, media: d.media, engine: d.engine, access: d.access,
    remote: d.remote as unknown as SupabaseRemote, dbName: 'test', mediaDb: d.mediaDb, comments: d.comments,
    commentsDb: d.commentsDb, sizes: d.sizes, offline: d.offline, shutdown: async () => undefined,
  };
}

const wait = (ms = 60) => act(async () => new Promise((r) => setTimeout(r, ms)));

async function mount(value: Services, node: React.ReactNode): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<ServicesContext.Provider value={value}>{node}</ServicesContext.Provider>));
  await wait();
  return host;
}

/** El panel abierto y al día para este dispositivo. */
async function panel(d: Device, client: unknown, page: string, wrap: (node: React.ReactNode) => React.ReactNode = (n) => n): Promise<HTMLElement> {
  const host = await mount(services(d, client), wrap(<CommentsPanel pageId={page} />));
  await act(async () => showComments(null));
  await act(async () => {
    await d.engine.syncNow();
  });
  await wait(80);
  return host;
}

function linkComment(pageId: string, id: string, linkId: string, name: string): CommentRow & { body: string; updated_at: string } {
  const at = new Date().toISOString();
  return {
    id, page_id: pageId, block_id: null, thread_id: null, body: `Nota de ${name}`, author_id: null, created_at: at, updated_at: at,
    edited_at: null, resolved_at: null, resolved_by: null, deleted_at: null, deleted_by: null, plink_author: name, plink_id: linkId,
  };
}

/** Una página de la dueña con dos comentarios hechos por dos links y uno del equipo. */
async function workspace() {
  const server = new FakeServer();
  server.enableMentions();
  const owner = await makeDevice(server);
  devices.push(owner);
  const page = await owner.tree.create(null, 'Brief');
  await owner.engine.syncNow();
  await owner.comments.add(page, null, 'Nota del equipo');
  await owner.engine.syncNow();
  server.comments.set('c1', linkComment(page, 'c1', L1, 'Ana'));
  server.comments.set('c2', linkComment(page, 'c2', L2, 'Beto'));
  const device = async (id: string, email: string) => {
    const d = await makeDevice(server, undefined, undefined, undefined, undefined, { id, email });
    devices.push(d);
    await d.engine.syncNow();
    return d;
  };
  return { server, owner, page, device };
}

/** Un cliente que contesta `public_link_labels` como la base: solo los links que esta sesión comparte. */
function fakeClient(rows: Record<string, Partial<LinkLabel> & { created_by_name?: string | null }>) {
  const state = {
    calls: [] as { fn: string; ids: string[] }[],
    rows,
    error: null as { message: string; code: string } | null,
    throws: false,
  };
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const ids = Array.isArray(args.p_ids) ? (args.p_ids as string[]) : [];
    state.calls.push({ fn, ids: [...ids].sort() });
    if (state.throws) throw new TypeError('Failed to fetch');
    if (state.error) return { data: null, error: state.error, status: 404 };
    // *Share* de la página: sin link propio (lo que importa acá es que leyó).
    if (fn === 'get_public_link') return { data: { clean_on: true, link: null, above: null }, error: null, status: 200 };
    if (fn !== 'public_link_labels') return { data: null, error: { message: 'unexpected ' + fn, code: '42501' }, status: 401 };
    return {
      data: ids.filter((id) => state.rows[id]).map((id) => ({ id, level: 'comment', created_by_name: 'lega', revoked: false, expired: false, alive: true, ...state.rows[id] })),
      error: null,
      status: 200,
    };
  };
  return Object.assign(state, { client: { rpc } });
}

const labelsIn = (host: HTMLElement) => [...host.querySelectorAll('.comment-link-label')].map((e) => e.textContent);
const authorsIn = (host: HTMLElement) => [...host.querySelectorAll('.comment-via-link')].map((e) => e.textContent);

describe('el rótulo en el panel de comentarios', () => {
  it('quien comparte la página ve, en cada comentario hecho por un link, de qué link vino; en los del equipo, nada', async () => {
    const { owner, page } = await workspace();
    const f = fakeClient({ [L1]: {}, [L2]: { level: 'edit', created_by_name: 'cami', revoked: true, alive: false } });
    const host = await panel(owner, f.client, page);
    expect(authorsIn(host).sort()).toEqual(['Ana (via link)', 'Beto (via link)']);
    expect(labelsIn(host).sort()).toEqual(['Can edit link · created by cami · closed', 'Can view link · created by lega']);
    // El del equipo no lleva rótulo: hay tres comentarios y dos rótulos.
    expect(host.querySelectorAll('.comment')).toHaveLength(3);
    // Un pedido por los dos links, y las vueltas siguientes de la sincronización no lo repiten.
    await act(async () => {
      await owner.engine.syncNow();
      await owner.engine.syncNow();
    });
    await wait();
    expect(f.calls).toEqual([{ fn: 'public_link_labels', ids: [L1, L2] }]);
    // Nada de `title=` ni del token.
    expect(host.querySelector('[title]')).toBeNull();
    expect(host.innerHTML).not.toContain('sdl_');
  });

  it('en castellano, y con un link vencido o que no anda', async () => {
    const { owner, page } = await workspace();
    act(() => prefs.set({ language: 'es' }));
    const f = fakeClient({ [L1]: { expired: true, alive: false }, [L2]: { created_by_name: null, alive: false } });
    const host = await panel(owner, f.client, page);
    expect(labelsIn(host).sort()).toEqual(['Link Puede ver · lo creó lega · vencido', 'Link Puede ver · no anda']);
    expect(host.querySelectorAll('.comment-link-label.off')).toHaveLength(2);
  });

  it('quien comenta sin poder compartir la página no ve el rótulo y ni se pregunta', async () => {
    const { server, page, device } = await workspace();
    server.addMember('ana', 'member', 'ana@test');
    server.grant('ana', { pageId: page }, 'edit_pages');
    server.addMember('cli', 'guest', 'cli@test');
    server.grant('cli', { pageId: page }, 'comment');
    for (const d of [await device('ana', 'ana@test'), await device('cli', 'cli@test')]) {
      const f = fakeClient({ [L1]: {}, [L2]: {} });
      const host = await panel(d, f.client, page);
      // El comentario se ve como siempre.
      expect(authorsIn(host).sort()).toEqual(['Ana (via link)', 'Beto (via link)']);
      expect(labelsIn(host)).toEqual([]);
      expect(f.calls).toEqual([]);
      act(() => roots.pop()!.unmount());
    }
  });

  it('a quien deja de compartir la página con la app abierta (pasa a miembro, o su permiso baja a Comentar) se le van las líneas en la sincronización siguiente', async () => {
    for (const change of ['member', 'comment'] as const) {
      const { server, owner, page, device } = await workspace();
      server.addMember('adm', 'admin', 'adm@test');
      server.grant('adm', { projectId: owner.tree.get(page)!.workspace_id }, 'edit_pages');
      const admin = await device('adm', 'adm@test');
      const f = fakeClient({ [L1]: {}, [L2]: {} });
      const host = await panel(admin, f.client, page);
      expect(labelsIn(host)).toHaveLength(2);

      // En la base, sin recargar la app. (La base de verdad dejaría de contestar; acá sigue contestando: lo que saca las
      // líneas es que la app ya no las muestra a quien no comparte la página.)
      if (change === 'member') server.members.get('adm')!.role = 'member';
      else server.grants.find((g) => g.user_id === 'adm')!.level = 'comment';
      await act(async () => {
        await admin.engine.syncNow();
      });
      await wait(80);
      expect(authorsIn(host)).toHaveLength(2);
      expect(labelsIn(host)).toEqual([]);
      act(() => roots.pop()!.unmount());
      act(() => closeComments());
    }
  });

  it('si pierde la página del link pero conserva la del comentario, la línea se va en la sincronización siguiente (no queda lo recordado)', async () => {
    const server = new FakeServer();
    server.enableMentions();
    const owner = await makeDevice(server);
    devices.push(owner);
    const root = await owner.tree.create(null, 'Con el link');
    const child = await owner.tree.create(root, 'Con el comentario');
    await owner.engine.syncNow();
    server.comments.set('c1', linkComment(child, 'c1', L1, 'Ana'));
    // Admin con Editar y crear sobre el proyecto y, además, sobre la página del comentario.
    server.addMember('adm', 'admin', 'adm@test');
    server.grant('adm', { projectId: owner.tree.get(root)!.workspace_id }, 'edit_pages');
    server.grant('adm', { pageId: child }, 'edit_pages');
    const admin = await makeDevice(server, undefined, undefined, undefined, undefined, { id: 'adm', email: 'adm@test' });
    devices.push(admin);
    await admin.engine.syncNow();
    const f = fakeClient({ [L1]: {} });
    const host = await panel(admin, f.client, child);
    expect(labelsIn(host)).toEqual(['Can view link · created by lega']);
    expect(f.calls).toHaveLength(1);

    // El permiso sobre el proyecto baja a Comentar: ya no comparte la página del link, y la base deja de contestarlo.
    server.grants.find((g) => g.user_id === 'adm' && g.page_id !== child)!.level = 'comment';
    f.rows = {};
    await act(async () => {
      await admin.engine.syncNow();
    });
    await wait(80);
    // Se volvió a preguntar (sigue compartiendo la página del comentario) y la línea se fue.
    expect(f.calls).toHaveLength(2);
    expect(authorsIn(host)).toEqual(['Ana (via link)']);
    expect(labelsIn(host)).toEqual([]);
  });

  it('por el link de un comentario borrado no se pregunta', async () => {
    const { server, owner, page } = await workspace();
    const L3 = '00000000-0000-4000-8000-0000000000c3';
    const at = new Date().toISOString();
    // Un hilo que abrió un visitante y después se borró, con una respuesta del equipo (el hilo sigue a la vista).
    server.comments.set('c3', { ...linkComment(page, 'c3', L3, 'Caro'), deleted_at: at, deleted_by: owner.remote.userId });
    server.comments.set('c4', { ...linkComment(page, 'c4', L3, 'x'), thread_id: 'c3', body: 'Respuesta del equipo', author_id: owner.remote.userId, plink_author: null, plink_id: null });
    const f = fakeClient({ [L1]: {}, [L2]: {}, [L3]: {} });
    const host = await panel(owner, f.client, page);
    expect(host.textContent).toContain('Respuesta del equipo');
    expect(host.querySelectorAll('.comment.deleted')).toHaveLength(1);
    expect(f.calls).toEqual([{ fn: 'public_link_labels', ids: [L1, L2] }]);
    expect(labelsIn(host)).toHaveLength(2);
  });

  it('lo que la base no contesta no se muestra: un admin que comparte la página pero no la del link ve el comentario sin rótulo', async () => {
    const { server, page, device } = await workspace();
    server.addMember('adm', 'admin', 'adm@test');
    server.grant('adm', { pageId: page }, 'edit_pages');
    const admin = await device('adm', 'adm@test');
    const f = fakeClient({ [L1]: {} });
    const host = await panel(admin, f.client, page);
    expect(f.calls).toEqual([{ fn: 'public_link_labels', ids: [L1, L2] }]);
    expect(authorsIn(host).sort()).toEqual(['Ana (via link)', 'Beto (via link)']);
    expect(labelsIn(host)).toEqual(['Can view link · created by lega']);
  });

  it('abrir Share (donde el link se apaga o se renueva) pone el rótulo al día en el acto, sin esperar los dos minutos', async () => {
    const { owner, page } = await workspace();
    const f = fakeClient({ [L1]: {}, [L2]: {} });
    const value = services(owner, f.client);
    const host = await panel(owner, f.client, page);
    expect(labelsIn(host).sort()).toEqual(['Can view link · created by lega', 'Can view link · created by lega']);
    // El link de Ana se apagó; la persona abre Share.
    f.rows[L1] = { revoked: true, alive: false };
    f.calls.length = 0;
    const share = document.createElement('div');
    document.body.append(share);
    const root = createRoot(share);
    roots.push(root);
    // Los mismos servicios que el panel (el mismo motor): comparten lo recordado.
    await act(async () => root.render(<ServicesContext.Provider value={{ ...value }}><LinkShare pageId={page} onClose={() => undefined} /></ServicesContext.Provider>));
    await wait(80);
    expect(f.calls.map((c) => c.fn)).toEqual(['get_public_link', 'public_link_labels']);
    expect(labelsIn(host).sort()).toEqual(['Can view link · created by lega', 'Can view link · created by lega · closed']);
  });

  it('otra cuenta que entra en la misma pestaña (el mismo cliente) no recibe nada de lo que vio la anterior', async () => {
    const { server, owner, page, device } = await workspace();
    server.addMember('adm', 'admin', 'adm@test');
    server.grant('adm', { pageId: page }, 'edit_pages');
    server.addMember('cli', 'guest', 'cli@test');
    server.grant('cli', { pageId: page }, 'comment');
    const admin = await device('adm', 'adm@test');
    const guest = await device('cli', 'cli@test');
    // El cliente es uno por workspace durante toda la vida de la pestaña: salir y entrar con otra cuenta no lo cambia.
    const f = fakeClient({ [L1]: {}, [L2]: {} });
    const a = await panel(owner, f.client, page);
    expect(labelsIn(a)).toHaveLength(2);
    act(() => roots.pop()!.unmount());
    await owner.engine.stop();

    // Entra un admin al que la base no le contesta esos links: pregunta por su cuenta y no ve los de la dueña.
    f.calls.length = 0;
    f.rows = {};
    const b = await panel(admin, f.client, page);
    expect(f.calls).toEqual([{ fn: 'public_link_labels', ids: [L1, L2] }]);
    expect(authorsIn(b)).toHaveLength(2);
    expect(labelsIn(b)).toEqual([]);
    expect(b.innerHTML).not.toContain('created by');
    act(() => roots.pop()!.unmount());
    await admin.engine.stop();

    // Y una invitada: ni pregunta.
    f.calls.length = 0;
    f.rows = { [L1]: {}, [L2]: {} };
    const c = await panel(guest, f.client, page);
    expect(authorsIn(c)).toHaveLength(2);
    expect(labelsIn(c)).toEqual([]);
    expect(f.calls).toEqual([]);
  });

  it('con una base sin la función (PGRST202) o con un pedido que no llega, el comentario se ve como hoy, sin error', async () => {
    for (const broken of ['missing', 'network'] as const) {
      const { owner, page } = await workspace();
      const f = fakeClient({ [L1]: {}, [L2]: {} });
      if (broken === 'missing') f.error = { message: 'Could not find the function public.public_link_labels(p_ids) in the schema cache', code: 'PGRST202' };
      else f.throws = true;
      const host = await panel(owner, f.client, page);
      expect(authorsIn(host).sort()).toEqual(['Ana (via link)', 'Beto (via link)']);
      expect(host.textContent).toContain('Nota de Ana');
      expect(labelsIn(host)).toEqual([]);
      expect(host.querySelector('.comment-error, .comments-note.warn')).toBeNull();
      // No insiste en cada vuelta de la sincronización.
      await act(async () => {
        await owner.engine.syncNow();
        await owner.engine.syncNow();
      });
      await wait();
      expect(f.calls).toHaveLength(1);
      act(() => roots.pop()!.unmount());
      act(() => closeComments());
    }
  });

  it('sin red los comentarios guardados se ven sin el rótulo, y no se pide', async () => {
    const { server, owner, page } = await workspace();
    owner.comments.watch(page);
    await owner.engine.syncNow();
    server.online = false;
    await owner.engine.syncNow().catch(() => undefined);
    const f = fakeClient({ [L1]: {}, [L2]: {} });
    const host = await mount(services(owner, f.client), <CommentsPanel pageId={page} />);
    await act(async () => showComments(null));
    await wait(80);
    expect(owner.engine.getStatus().online).toBe(false);
    expect(authorsIn(host).sort()).toEqual(['Ana (via link)', 'Beto (via link)']);
    expect(labelsIn(host)).toEqual([]);
    expect(f.calls).toEqual([]);
  });

  it('con la app abierta por un link no se pregunta nada ni se muestra', async () => {
    const { owner, page } = await workspace();
    const f = fakeClient({ [L1]: {}, [L2]: {} });
    const link = { entry: {}, domain: 'example.supabase.co', linkId: L1, pageId: page } as unknown as LinkInfo;
    const host = await panel(owner, f.client, page, (node) => <LinkContext.Provider value={link}>{node}</LinkContext.Provider>);
    expect(authorsIn(host)).toHaveLength(2);
    expect(labelsIn(host)).toEqual([]);
    expect(f.calls).toEqual([]);
  });
});
