import { afterEach, describe, expect, it, vi } from 'vitest';
import { stored } from '../i18n';
import type { LinkMemory } from '../linkMode';
import { fakePostgrest, type FakePostgrestOptions, type FakeRow } from './fakePostgrest';
import { LinkCommentRemote, LinkRemote, TREE_TRIES, TREE_WAIT_MAX_MS, TREE_WAIT_MS } from './linkRemote';
import { addPublicLink, makeLinkDevice, type LinkDevice } from './linkTesting';
import { FakeServer, makeDevice, type Device } from './testing';

// Las listas del visitante de un link público (Docs/Doc_Sincronizacion.md, "Las listas largas"; Docs/Doc_Link_Publico.md,
// "Las listas del link, enteras"): el árbol, los comentarios, los archivos y el estado de lo mandado. Contra una API de
// mentira que recorta como PostgREST (`fakePostgrest`, con el cliente de verdad): con el tope de fábrica y con topes
// menores cada lista llega entera, una vez cada fila; en el caso de siempre cuesta los mismos pedidos que antes; todas
// las páginas de una bajada del árbol traen la misma firma; y si un pedido falla, el resultado es el error y lo guardado
// no se toca. Al final, el dispositivo de un visitante entero (el motor de verdad) contra el servidor en memoria.

const CAPS = [1000, 500, 137, 1];
/** Cuántas filas se prueban con cada tope: más que el tope (varios pedidos), sin que el de a una tarde una eternidad. */
const rowsFor = (cap: number) => (cap === 1 ? 7 : cap >= 500 ? 1203 : 320);
const uuid = (n: number, group = 0) => `${group.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const at = (n: number) => `${new Date(Date.UTC(2026, 9, 1, 10) + n * 1000).toISOString().replace('Z', '')}000+00:00`;
const LINK = uuid(1, 0xaa);
/** La raíz del link tiene el id más alto: queda afuera de toda respuesta recortada. */
const ROOT = uuid(0xffff_ffff);
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

const page = (id: string, title: string): FakeRow => ({
  id, workspace_id: LINK, parent_id: id === ROOT ? null : ROOT, title, icon: null, sort_key: 'a0', settings: { header: { on: true } },
  update_seq: 3, clean_seq: 3, created_at: at(1), updated_at: at(2),
});

function memory(sent: string[]): LinkMemory & { dropped: string[] } {
  const dropped: string[] = [];
  return { dropped, sent: () => sent, addSent: () => undefined, dropSent: (ps) => void dropped.push(...ps), seen: () => ({}), setSeen: () => undefined };
}

/** La base de un link de mentira: una rama de `count` páginas (la raíz incluida) y lo demás que pide el visitante. */
function linkApi(count: number, options: FakePostgrestOptions & { level?: 'comment' | 'edit'; sent?: string[] } = {}) {
  const base = {
    sig: 'firma-1',
    /** El árbol cambia en cada pedido (otra firma cada vez). */
    moving: false,
    pages: [...Array.from({ length: count - 1 }, (_, i) => page(uuid(i + 1), `Página ${i + 1}`)), page(ROOT, 'Raíz')],
    comments: [] as FakeRow[],
    files: [] as FakeRow[],
    status: [] as FakeRow[],
  };
  let turn = 1;
  const api = fakePostgrest({
    functions: {
      plink_open: () => ({ link_id: LINK, page_id: ROOT, title: 'Raíz', level: options.level ?? 'comment', link_level: options.level ?? 'comment', schema_version: 25, clean_on: true }),
      // Como la base: sin cambios desde `p_sig`, nada; si no, todas las páginas, cada una con la firma de ahora.
      plink_tree: (args) => {
        if (base.moving) base.sig = `firma-${++turn}`;
        return args.p_sig === base.sig ? [] : base.pages.map((p) => ({ ...p, sig: base.sig }));
      },
      plink_list_comments: (args) => base.comments.filter((c) => c.page_id === args.p_page_id && (args.p_since == null || String(c.updated_at) >= String(args.p_since))),
      plink_media_files: (args) => base.files.filter((f) => (args.p_ids as string[]).includes(String(f.id))),
      plink_push_status: () => base.status,
      plink_pull_page: () => [{ seq: 5, update: 'AQID' }],
    },
    ...options,
  });
  const problems: unknown[] = [];
  const kept = memory(options.sent ?? []);
  const remote = new LinkRemote(api.client, '0.226', (p) => problems.push(p), () => 'Ana', kept);
  return { ...api, base, problems, kept, remote, asked: (fn: string) => api.requests.filter((r) => r.target === `rpc/${fn}`) };
}

describe('el árbol del link (plink_tree)', () => {
  it.each(CAPS)('con un tope de %i filas por pedido llega entero, con su raíz y sus columnas, sin un pedido de más', async (cap) => {
    const n = rowsFor(cap);
    const { remote, base, asked } = linkApi(n, { maxRows: cap });
    const rows = await remote.fetchTree([LINK]);
    expect(ids(rows)).toEqual(ids(base.pages as { id: string }[]));
    expect(rows[rows.length - 1]).toEqual({ ...base.pages[n - 1], deleted_at: null });
    expect(rows[0]).toEqual({ ...base.pages[0], deleted_at: null });
    expect(asked('plink_tree')).toHaveLength(Math.ceil(n / cap));
    // El primero con la firma guardada (ninguna todavía); todos con el orden escrito y el total pedido.
    expect(asked('plink_tree').every((r) => r.args?.p_sig === null && r.counted && r.query.order === 'id.asc')).toBe(true);
    // Sin cambios: un pedido con la firma, que no trae nada, y el mismo árbol.
    expect(await remote.fetchTree([LINK])).toEqual(rows);
    expect(asked('plink_tree')).toHaveLength(Math.ceil(n / cap) + 1);
    expect(asked('plink_tree').at(-1)).toMatchObject({ args: { p_sig: 'firma-1' }, rows: 0 });
  });

  it('en el caso de siempre es un pedido, como antes', async () => {
    const { remote, asked, requests } = linkApi(423);
    expect(await remote.fetchTree([LINK])).toHaveLength(423);
    expect(asked('plink_tree')).toHaveLength(1);
    // Abrir el link y el árbol: nada más.
    expect(requests).toHaveLength(2);
  });

  it('si el árbol cambia entre dos pedidos, lo juntado se descarta y se empieza de nuevo: nunca páginas de dos árboles', async () => {
    const api = linkApi(300, {
      maxRows: 137,
      before: (request) => {
        // Antes del segundo pedido del árbol (el primero de todos abre el link): se renombra una página ya recibida y se crea otra.
        if (request !== 3) return;
        api.base.sig = 'firma-2';
        api.base.pages[0] = { ...api.base.pages[0], title: 'Renombrada' };
        api.base.pages.push(page(uuid(500_000), 'Nueva'));
      },
    });
    const rows = await api.remote.fetchTree([LINK]);
    expect(rows).toHaveLength(301);
    expect(rows[0].title).toBe('Renombrada');
    // Uno del árbol viejo, el que trajo otra firma (descartado) y los tres del árbol nuevo.
    expect(api.asked('plink_tree').map((r) => r.rows)).toEqual([137, 137, 137, 137, 27]);
    // Quedó guardada la firma nueva: sin cambios, el pedido siguiente no trae nada.
    await api.remote.fetchTree([LINK]);
    expect(api.asked('plink_tree').at(-1)).toMatchObject({ args: { p_sig: 'firma-2' }, rows: 0 });
  });

  it('si la bajada termina con menos páginas que las que anunció el primer pedido (una respuesta vacía no trae firma), también se empieza de nuevo', async () => {
    const api = linkApi(300, {
      maxRows: 137,
      before: (request) => {
        // Entre el primero y el segundo, 50 páginas que todavía no llegaron salen de la rama.
        if (request === 3) api.base.pages.splice(200, 50);
      },
    });
    expect(await api.remote.fetchTree([LINK])).toHaveLength(250);
    expect(api.asked('plink_tree').map((r) => r.rows)).toEqual([137, 113, 137, 113]);
  });

  it('si el árbol no deja de cambiar, el ciclo sigue con el árbol que tenía y después prueba de a un intento, cada vez más espaciado', async () => {
    const api = linkApi(300, { maxRows: 137 });
    const first = await api.remote.fetchTree([LINK]);
    const tree = () => api.asked('plink_tree').length;
    let asked = tree();
    let now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      api.base.moving = true;
      // `TREE_TRIES` intentos (dos pedidos cada uno: el segundo trae otra firma) y, sin error, el árbol de antes: lo que
      // sigue del ciclo (subir lo que el visitante escribió) no se corta.
      expect(await api.remote.fetchTree([LINK])).toEqual(first);
      expect(tree()).toBe(asked + TREE_TRIES * 2);
      // La sincronización siguiente, antes de la espera: ni un pedido.
      asked = tree();
      now += TREE_WAIT_MS - 1;
      expect(await api.remote.fetchTree([LINK])).toEqual(first);
      expect(tree()).toBe(asked);
      // Cuando toca: un solo intento, y la espera que sigue es el doble.
      now += 1;
      expect(await api.remote.fetchTree([LINK])).toEqual(first);
      expect(tree()).toBe(asked + 2);
      now += TREE_WAIT_MS * 2 - 1;
      await api.remote.fetchTree([LINK]);
      expect(tree()).toBe(asked + 2);
      // Sigue cambiando por horas: nunca más de un intento cada `TREE_WAIT_MAX_MS`.
      for (let i = 0; i < 12; i++) {
        now += TREE_WAIT_MAX_MS;
        await api.remote.fetchTree([LINK]);
      }
      asked = tree();
      now += TREE_WAIT_MAX_MS - 1;
      await api.remote.fetchTree([LINK]);
      expect(tree()).toBe(asked);
      // El árbol se queda quieto: la bajada sale entera, y la próxima vez que cambie vuelve a tener todos sus intentos.
      api.base.moving = false;
      now += 1;
      expect(await api.remote.fetchTree([LINK])).toEqual(first);
      expect(api.asked('plink_tree').slice(asked).map((r) => r.rows)).toEqual([137, 137, 26]);
      asked = tree();
      api.base.moving = true;
      await api.remote.fetchTree([LINK]);
      expect(tree()).toBe(asked + TREE_TRIES * 2);
    } finally {
      clock.mockRestore();
    }
  });

  it('si no deja de cambiar y todavía no hay ningún árbol de esta carga, es un error que se reintenta (nunca un árbol vacío), también de a un intento', async () => {
    const api = linkApi(300, { maxRows: 137 });
    api.base.moving = true;
    let now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      await expect(api.remote.fetchTree([LINK])).rejects.toMatchObject({ message: stored('link.treeMoving'), permanent: false });
      expect(api.asked('plink_tree')).toHaveLength(TREE_TRIES * 2);
      await expect(api.remote.fetchTree([LINK])).rejects.toMatchObject({ message: stored('link.treeMoving') });
      expect(api.asked('plink_tree')).toHaveLength(TREE_TRIES * 2);
      now += TREE_WAIT_MS;
      await expect(api.remote.fetchTree([LINK])).rejects.toMatchObject({ message: stored('link.treeMoving') });
      expect(api.asked('plink_tree')).toHaveLength(TREE_TRIES * 2 + 2);
      api.base.moving = false;
      now += TREE_WAIT_MS * 2;
      expect(await api.remote.fetchTree([LINK])).toHaveLength(300);
    } finally {
      clock.mockRestore();
    }
  });

  it('una API que anuncia más filas de las que hay no deja al link sin árbol: dos bajadas seguidas con la misma firma y las mismas filas son el árbol', async () => {
    const { remote, asked } = linkApi(300, { maxRows: 137, overCount: true });
    expect(await remote.fetchTree([LINK])).toHaveLength(300);
    expect(asked('plink_tree').map((r) => r.rows)).toEqual([137, 137, 26, 0, 137, 137, 26, 0]);
    // Y sin cambios, un pedido que no trae nada.
    expect(await remote.fetchTree([LINK])).toHaveLength(300);
    expect(asked('plink_tree')).toHaveLength(9);
    // Las mismas filas con otra firma no alcanzan: el árbol cambió entre las dos bajadas, y hace falta una más.
    const api = linkApi(300, { overCount: true, before: (request) => void (request === 4 && (api.base.sig = 'firma-2')) });
    expect(await api.remote.fetchTree([LINK])).toHaveLength(300);
    expect(api.asked('plink_tree').map((r) => r.rows)).toEqual([300, 0, 300, 0, 300, 0]);
    // Ni la misma firma con otra cantidad de filas (no debería pasar: la firma es del árbol entero).
    const odd = linkApi(300, { overCount: true, before: (request) => void (request === 4 && odd.base.pages.splice(100, 10)) });
    expect(await odd.remote.fetchTree([LINK])).toHaveLength(290);
    expect(odd.asked('plink_tree').map((r) => r.rows)).toEqual([300, 0, 290, 0, 290, 0]);
  });

  it('una bajada corta repetida vale solo si terminó con una respuesta vacía: un total que dice «esta página es todo lo que queda» no arma un árbol sin la raíz', async () => {
    // El primer pedido dice bien el total (401) y los que siguen dicen que su página es lo último: la lista termina
    // en 274 filas, dos veces igual, y sin la raíz (que tiene el id más alto). Nunca es el árbol.
    const lying = linkApi(401, { maxRows: 137, lastPageCount: true });
    await expect(lying.remote.fetchTree([LINK])).rejects.toMatchObject({ message: stored('link.treeMoving'), permanent: false });
    expect(lying.asked('plink_tree').map((r) => r.rows)).toEqual([137, 137, 137, 137, 137, 137]);
    // Ni en el intento siguiente, cuando toca: la misma lista corta otra vez sigue sin ser el árbol.
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => 4_000_000_000_000);
    try {
      await expect(lying.remote.fetchTree([LINK])).rejects.toMatchObject({ message: stored('link.treeMoving') });
    } finally {
      clock.mockRestore();
    }
    expect(lying.asked('plink_tree')).toHaveLength(8);
    // El caso legítimo sigue cargando: una API que anuncia de más termina siempre con una respuesta vacía.
    const over = linkApi(401, { maxRows: 137, overCount: true });
    expect(ids(await over.remote.fetchTree([LINK]))).toContain(ROOT);
    expect(over.asked('plink_tree').map((r) => r.rows)).toEqual([137, 137, 127, 0, 137, 137, 127, 0]);
  });

  it('mientras la bajada del árbol nuevo está pendiente porque la rama cambia, avisa que la lista puede estar atrasada; se va sola con el árbol nuevo', async () => {
    const api = linkApi(300, { maxRows: 137 });
    const told: boolean[] = [];
    api.remote.subscribeLinkEdits(() => told.push(api.remote.treeBehind()));
    const first = await api.remote.fetchTree([LINK]);
    expect(api.remote.treeBehind()).toBe(false);
    let now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      api.base.moving = true;
      expect(await api.remote.fetchTree([LINK])).toEqual(first);
      expect(api.remote.treeBehind()).toBe(true);
      // Sigue atrasada durante la espera (sin pedidos) y después de otro intento que tampoco termina.
      await api.remote.fetchTree([LINK]);
      now += TREE_WAIT_MS;
      await api.remote.fetchTree([LINK]);
      expect(api.remote.treeBehind()).toBe(true);
      expect(told).toEqual([true]);
      // La rama se queda quieta: llega el árbol nuevo y el aviso se va.
      api.base.moving = false;
      api.base.pages[0] = { ...api.base.pages[0], title: 'Renombrada' };
      now += TREE_WAIT_MS * 2;
      expect((await api.remote.fetchTree([LINK]))[0].title).toBe('Renombrada');
      expect(api.remote.treeBehind()).toBe(false);
      expect(told).toEqual([true, false]);
    } finally {
      clock.mockRestore();
    }
    // Sin ningún árbol de esta carga no es «atrasada»: es el error de siempre.
    const none = linkApi(300, { maxRows: 137 });
    none.base.moving = true;
    await expect(none.remote.fetchTree([LINK])).rejects.toMatchObject({ message: stored('link.treeMoving') });
    expect(none.remote.treeBehind()).toBe(false);
  });

  it('si un pedido falla a mitad, el resultado es el error (nunca un árbol cortado) y el link avisa si dejó de andar', async () => {
    const broken = linkApi(300, { maxRows: 137, fail: { 4: { status: 500, code: 'XX000', message: 'la base se reinició' } } });
    await expect(broken.remote.fetchTree([LINK])).rejects.toMatchObject({ message: 'la base se reinició', permanent: false });
    expect(broken.asked('plink_tree')).toHaveLength(3);
    // El pedido siguiente arranca de cero: nada de lo juntado a medias quedó guardado.
    expect(await broken.remote.fetchTree([LINK])).toHaveLength(300);
    expect(broken.asked('plink_tree').slice(3).map((r) => r.rows)).toEqual([137, 137, 26]);
    const dead = linkApi(300, { maxRows: 137, fail: { 3: { status: 500, code: 'P0002', message: 'link_not_found' } } });
    await expect(dead.remote.fetchTree([LINK])).rejects.toMatchObject({ message: 'link_not_found', permanent: true });
    expect(dead.problems).toEqual([null, 'link_not_found']);
  });

  it('si la API no manda el total (o manda uno que no puede ser), sigue hasta una respuesta vacía', async () => {
    for (const how of [{ noCount: true }, { lowCount: true }]) {
      const { remote, asked } = linkApi(300, { maxRows: 137, ...how });
      expect(await remote.fetchTree([LINK])).toHaveLength(300);
      expect(asked('plink_tree').map((r) => r.rows)).toEqual([137, 137, 26, 0]);
    }
  });
});

describe('los archivos, el estado de lo mandado y el contenido de un link', () => {
  it.each(CAPS)('con un tope de %i llegan todos los archivos pedidos, de a 200 ids; los que el link no ve no cuestan un pedido más', async (cap) => {
    const count = cap === 1 ? 7 : 450;
    const files = Array.from({ length: count }, (_, i) => ({ id: uuid(i + 1, 0xff), name: `f${i}`, mime: 'image/png', size: 10 + i, width: 4, height: 3, duration: null, thumb_at: at(i), drive_id: `d${i}` }));
    const { remote, base, asked } = linkApi(2, { maxRows: cap });
    // Los dos últimos no los ve el link (no hay fila).
    base.files = files.slice(0, -2).reverse();
    const got = await remote.fetchMediaFiles(ids(files));
    expect(ids(got)).toEqual(ids(files).slice(0, -2));
    expect(got[0]).toEqual({ ...files[0], trashed_at: null, purged_at: null, drive_trashed_at: null, project_id: LINK });
    const found = [0, 200, 400].filter((from) => from < count).map((from) => Math.min(count - 2, from + 200) - from);
    expect(asked('plink_media_files')).toHaveLength(found.reduce((sum, n) => sum + Math.max(1, Math.ceil(n / cap)), 0));
    expect(asked('plink_media_files')[0]).toMatchObject({ counted: true, query: { order: 'id.asc' } });
  });

  it('si el link deja de andar justo al pedir los archivos, la pantalla se entera', async () => {
    const { remote, problems } = linkApi(2, { fail: { 2: { status: 500, code: 'P0002', message: 'link_not_found' } } });
    await expect(remote.fetchMediaFiles([uuid(1, 0xff)])).rejects.toMatchObject({ message: 'link_not_found', permanent: true });
    // Abrió bien (`null`) y después dejó de andar.
    expect(problems).toEqual([null, 'link_not_found']);
  });

  it.each(CAPS)('con un tope de %i el estado de lo mandado trae todas las páginas: ninguna se deja de recordar por no haber llegado', async (cap) => {
    const n = cap === 1 ? 7 : 320;
    const pages = Array.from({ length: n }, (_, i) => uuid(i + 1));
    const { remote, base, asked, kept } = linkApi(2, { maxRows: cap, level: 'edit', sent: pages });
    // En todas espera algo; en una de cada cuatro, además, algo se apartó.
    base.status = pages.map((p, i) => ({ page_id: p, waiting: 1, aside: i % 4 === 0 ? 2 : 0 })).reverse();
    await remote.refreshEdits(true);
    expect(remote.linkEdits().waiting).toEqual(pages);
    expect(remote.linkEdits().aside).toEqual(pages.filter((_, i) => i % 4 === 0));
    expect(kept.dropped).toEqual([]);
    expect(asked('plink_push_status')).toHaveLength(Math.ceil(n / cap));
  });

  it('el estado de lo mandado con el tope del día lleno a mitad de la lista: deja de preguntar, sin avisar que el link no anda', async () => {
    const { remote, base, asked, problems } = linkApi(2, { maxRows: 2, level: 'edit', fail: { 2: { status: 400, code: 'P0001', message: 'link_rate_limited' } } });
    base.status = [1, 2, 3, 4, 5].map((i) => ({ page_id: uuid(i), waiting: 1, aside: 0 }));
    await remote.refreshEdits(true);
    expect(remote.linkEdits().waiting).toEqual([]);
    expect(problems).toEqual([]);
    expect(asked('plink_push_status')).toHaveLength(2);
    await remote.refreshEdits(false);
    expect(asked('plink_push_status')).toHaveLength(2);
  });

  it('el contenido de una página es una sola fila (la base limpia): un tope de 1 no la recorta', async () => {
    const { remote, asked } = linkApi(2, { maxRows: 1 });
    expect((await remote.pullContent(uuid(1), 0)).map((u) => u.seq)).toEqual([5]);
    expect(asked('plink_pull_page')).toHaveLength(1);
  });
});

describe('los comentarios de una página por un link (plink_list_comments)', () => {
  const PAGE_ID = uuid(1);
  const comment = (n: number, over: FakeRow = {}): FakeRow => ({
    id: uuid(n, 0xc0), page_id: PAGE_ID, block_id: null, thread_id: null, body: `Comentario ${n}`, author_name: 'Beto', author_kind: 'team', mine: false,
    created_at: at(n), edited_at: null, resolved_at: null, deleted_at: null, updated_at: at(n), ...over,
  });
  const api = (rows: FakeRow[], options: FakePostgrestOptions = {}) => {
    const made = linkApi(2, options);
    made.base.comments = rows;
    return { ...made, comments: new LinkCommentRemote(made.client, 'link:yo', () => 'Ana') };
  };

  it.each(CAPS)('con un tope de %i llegan todos, una vez cada uno y en orden, sin un pedido de más', async (cap) => {
    const rows = Array.from({ length: rowsFor(cap) }, (_, i) => comment(i + 1));
    const { comments, requests } = api([...rows].reverse(), { maxRows: cap });
    const listed = await comments.listComments(PAGE_ID, null);
    expect(ids(listed)).toEqual(ids(rows as { id: string }[]));
    expect(requests).toHaveLength(Math.ceil(rows.length / cap));
    expect(requests[0]).toMatchObject({ target: 'rpc/plink_list_comments', args: { p_page_id: PAGE_ID, p_since: null }, counted: true });
    expect(requests[0].query).toEqual({ order: 'updated_at.asc,id.asc', limit: '1000' });
    // Las columnas: el del equipo con su nombre, sin ids de personas.
    expect(listed[0]).toMatchObject({ id: uuid(1, 0xc0), page_id: PAGE_ID, body: 'Comentario 1', author_id: null, imported_author: 'Beto', plink_author: null, created_at: at(1), updated_at: at(1) });
  });

  it('en el caso de siempre es un pedido, también con lo cambiado desde la última bajada', async () => {
    const { comments, requests } = api(Array.from({ length: 30 }, (_, i) => comment(i + 1)));
    expect(await comments.listComments(PAGE_ID, at(20))).toHaveLength(11);
    expect(requests).toHaveLength(1);
    expect(requests[0].args).toEqual({ p_page_id: PAGE_ID, p_since: at(20) });
  });

  it.each([137, 2, 1])('muchos con la misma fecha de cambio y un tope de %i: el id desempata y no se saltea ninguno', async (cap) => {
    const rows = Array.from({ length: cap === 137 ? 300 : 9 }, (_, i) => comment(i + 1, { updated_at: at(i < 3 ? i : 5) }));
    const { comments } = api(rows, { maxRows: cap });
    expect(ids(await comments.listComments(PAGE_ID, null)).sort()).toEqual(ids(rows as { id: string }[]).sort());
  });

  it('lo que cambia entre dos pedidos no saltea ni repite: lo editado llega con su última versión y lo nuevo también', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => comment(i + 1));
    const { comments } = api(rows, {
      maxRows: 4,
      before: (request) => {
        if (request !== 2) return;
        Object.assign(rows[1], { body: 'Editado', edited_at: at(50), updated_at: at(50) });
        rows.push(comment(11, { updated_at: at(52), created_at: at(52), author_kind: 'link', author_name: 'Caro', mine: true }));
      },
    });
    const listed = await comments.listComments(PAGE_ID, null);
    expect(ids(listed).sort()).toEqual(ids(rows as { id: string }[]).sort());
    expect(listed.find((r) => r.id === uuid(2, 0xc0))).toMatchObject({ body: 'Editado' });
    expect(listed.find((r) => r.id === uuid(11, 0xc0))).toMatchObject({ author_id: 'link:yo', plink_author: null });
  });

  it('si la base contesta que el link ya no anda, al bajar o al escribir, avisa; un tope del día o una página que salió de la rama, no', async () => {
    const dead = { status: 500, code: 'P0002', message: 'link_not_found' };
    const answers = [dead, { status: 400, code: 'P0001', message: 'link_rate_limited' }, { status: 500, code: 'P0002', message: 'page_not_found' }, dead];
    const made = linkApi(2, { fail: Object.fromEntries(answers.map((a, i) => [i + 1, a])) });
    let told = 0;
    const comments = new LinkCommentRemote(made.client, 'link:yo', () => 'Ana', () => void told++);
    await expect(comments.listComments(PAGE_ID, at(5))).rejects.toMatchObject({ message: 'link_not_found', permanent: true });
    expect(told).toBe(1);
    await expect(comments.listComments(PAGE_ID, at(5))).rejects.toMatchObject({ message: 'link_rate_limited' });
    await expect(comments.listComments(PAGE_ID, at(5))).rejects.toMatchObject({ message: 'page_not_found' });
    expect(told).toBe(1);
    await expect(comments.editComment(uuid(1, 0xc0), 'Otro texto')).rejects.toMatchObject({ message: 'link_not_found' });
    expect(told).toBe(2);
  });

  it('si un pedido falla, el resultado es el error: nunca una lista parcial; y sin el total sigue hasta una respuesta vacía', async () => {
    const rows = Array.from({ length: 300 }, (_, i) => comment(i + 1));
    const broken = api(rows, { maxRows: 137, fail: { 2: { status: 500, code: 'XX000', message: 'la base se reinició' } } });
    await expect(broken.comments.listComments(PAGE_ID, null)).rejects.toMatchObject({ message: 'la base se reinició', permanent: false });
    const blind = api(rows, { maxRows: 137, noCount: true });
    expect(await blind.comments.listComments(PAGE_ID, null)).toHaveLength(300);
    expect(blind.requests.map((r) => r.rows)).toEqual([137, 137, 26, 0]);
  });
});

describe('el dispositivo del visitante con una rama más grande que el tope de la API', () => {
  const devices: Device[] = [];
  const visitors: LinkDevice[] = [];
  afterEach(() => {
    for (const d of devices.splice(0)) d.engine.stop();
    for (const v of visitors.splice(0)) v.engine.stop();
  });

  /** Un workspace con una página compartida por un link y `kids` páginas adentro, todas con un id menor que el de la raíz. */
  async function branch(kids: number) {
    const server = new FakeServer();
    server.enableTeam();
    server.enableClean(0.1);
    const e1 = await makeDevice(server, undefined, '0.226');
    devices.push(e1);
    const root = await e1.tree.create(null, 'Raíz');
    const first = await e1.tree.create(root, 'Hija 0');
    await e1.engine.syncNow();
    const grow = (from: number, to: number) => {
      for (let i = from; i < to; i++) server.pages.set(uuid(i), { ...server.pages.get(first)!, id: uuid(i), title: `Hija ${i}` });
    };
    grow(1, kids);
    const token = addPublicLink(server, root);
    const all = () => [...server.pages.keys()].filter((id) => server.pages.get(id)!.parent_id === root).concat(root);
    return { server, root, token, grow, all };
  }

  it.each([137, 1])('con un tope de %i ve la rama entera, con su raíz, también cuando crece', async (cap) => {
    const { server, root, token, grow, all } = await branch(cap === 1 ? 6 : 300);
    server.linkMaxRows = cap;
    const v = await makeLinkDevice(server, token);
    visitors.push(v);
    await v.engine.syncNow();
    expect(v.engine.getStatus().lastError).toBeNull();
    expect(all().filter((id) => !v.tree.get(id))).toEqual([]);
    expect(v.tree.get(root)).toMatchObject({ parent_id: null, title: 'Raíz' });
    grow(1000, 1000 + (cap === 1 ? 3 : 150));
    await v.engine.syncNow();
    expect(all().filter((id) => !v.tree.get(id))).toEqual([]);
    expect(v.tree.children(root)).toHaveLength(all().length - 1);
  });

  it('un link revocado mientras el árbol espera su próximo intento se nota en el ciclo siguiente, por los comentarios de la página abierta y sin un pedido de más', async () => {
    const { server, root, token } = await branch(6);
    server.linkMaxRows = 1;
    const v = await makeLinkDevice(server, token);
    visitors.push(v);
    v.comments.watch(root);
    await v.engine.syncNow();
    expect(v.engine.getStatus().lastError).toBeNull();
    // La rama no deja de cambiar: cada pedido del árbol la encuentra distinta, y el visitante sigue con el que tenía.
    const whole = server.branch.bind(server);
    let turn = 0;
    server.branch = (id) => {
      server.pages.set(uuid(1), { ...server.pages.get(uuid(1))!, title: `Cambia ${++turn}` });
      return whole(id);
    };
    await v.engine.syncNow();
    expect(v.engine.getStatus().lastError).toBeNull();
    expect(v.remote.treeBehind()).toBe(true);
    expect(v.problems).not.toContain('link_not_found');
    // Revocan el link. Al árbol no le toca hasta dentro de 20 segundos (y después, hasta cada 10 minutos); a los
    // comentarios de la página abierta, sí (pasaron sus 10 segundos): es el único pedido del ciclo, y alcanza.
    server.revokePublicLink(token);
    const asked = v.calls.length;
    server.clockOffset += 11_000;
    await v.engine.syncNow();
    expect(v.calls.slice(asked).map((c) => c.fn)).toEqual(['plink_list_comments']);
    expect(v.problems.at(-1)).toBe('link_not_found');
  });

  it('si un pedido del árbol falla a mitad, el dispositivo se queda con el árbol que tenía, entero, y lo completa en la vuelta siguiente', async () => {
    const { server, root, token, grow, all } = await branch(300);
    server.linkMaxRows = 137;
    const v = await makeLinkDevice(server, token);
    visitors.push(v);
    await v.engine.syncNow();
    const had = all();
    grow(1000, 1150);
    // El segundo pedido del árbol de esta vuelta no llega.
    const whole = server.branch.bind(server);
    let asked = 0;
    server.branch = (id) => {
      if (++asked === 2) throw new TypeError('Failed to fetch');
      return whole(id);
    };
    await v.engine.syncNow();
    expect(asked).toBe(2);
    // Ni una página de menos (las que ya tenía) ni una de más (las nuevas que alcanzaron a llegar).
    expect(had.filter((id) => !v.tree.get(id))).toEqual([]);
    expect(v.tree.children(root)).toHaveLength(had.length - 1);
    await v.engine.syncNow();
    expect(all().filter((id) => !v.tree.get(id))).toEqual([]);
  });
});
