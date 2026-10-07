import { describe, expect, it } from 'vitest';
import { SupabaseCommentRemote } from './commentsRemote';
import { fakePostgrest, type FakePostgrestOptions, type FakeRow } from './fakePostgrest';
import { KeyedList, LIST_CUT, wholeList } from './listPages';
import { SupabaseRemote } from './remote';

// Las listas largas que la app le pide a la base (Docs/Doc_Sincronizacion.md, "Las listas largas"): ninguna supone
// cuántas filas entrega la API por pedido. Contra una API de mentira que recorta como PostgREST (`fakePostgrest`):
// con el tope de fábrica (1000) y con topes menores, cada lista llega entera, sin filas repetidas ni salteadas, también
// si algo cambia entre dos pedidos; en el caso de siempre cuesta los mismos pedidos que antes; y si un pedido falla,
// el resultado es el error, nunca una lista parcial.

const CAPS = [1000, 500, 137, 1];
/** Cuántas filas se prueban con cada tope: más que el tope (varios pedidos), sin que el de a una tarde una eternidad. */
const rowsFor = (cap: number) => (cap === 1 ? 7 : cap >= 500 ? 1203 : 320);
const uuid = (n: number, group = 0) => `${group.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
/** Una fecha como las manda la API (con microsegundos y `+00:00`), que crece con `n`. */
const at = (n: number) => `${new Date(Date.UTC(2026, 9, 1, 10) + n * 1000).toISOString().replace('Z', '')}000+00:00`;
const PAGE_ID = uuid(1, 0xaa);
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

function comment(n: number, over: FakeRow = {}): FakeRow {
  return {
    id: uuid(n), page_id: PAGE_ID, block_id: null, thread_id: null, body: `Comentario ${n}`, author_id: uuid(1, 0xbb), created_at: at(n), updated_at: at(n),
    edited_at: null, resolved_at: null, resolved_by: null, deleted_at: null, deleted_by: null, ...over,
  };
}

/** `list_comments` como la de la base: los de la página, desde `p_since` inclusive, por fecha de cambio y por id. */
function listComments(rows: FakeRow[]) {
  return (args: Record<string, unknown>) =>
    rows
      .filter((r) => r.page_id === args.p_page_id && (args.p_since == null || String(r.updated_at) >= String(args.p_since)))
      .sort((a, b) => (String(a.updated_at) < String(b.updated_at) ? -1 : String(a.updated_at) > String(b.updated_at) ? 1 : String(a.id) < String(b.id) ? -1 : 1));
}

function commentsApi(rows: FakeRow[], options: FakePostgrestOptions = {}) {
  const api = fakePostgrest({ functions: { list_comments: listComments(rows) }, tables: { comments_view: rows }, ...options });
  return { ...api, remote: new SupabaseCommentRemote(api.client) };
}

describe('los comentarios de una página (list_comments)', () => {
  it.each(CAPS)('con un tope de %i filas por pedido llegan todos, una vez cada uno y en orden, sin un pedido de más', async (cap) => {
    const rows = Array.from({ length: rowsFor(cap) }, (_, i) => comment(i + 1));
    const { remote, requests } = commentsApi(rows, { maxRows: cap });
    const listed = await remote.listComments(PAGE_ID, null);
    expect(ids(listed!)).toEqual(ids(rows as { id: string }[]));
    expect(requests).toHaveLength(Math.ceil(rows.length / cap));
  });

  it('en el caso de siempre es un pedido, con el orden escrito y el total pedido', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => comment(i + 1));
    const { remote, requests } = commentsApi(rows);
    expect(await remote.listComments(PAGE_ID, at(20))).toHaveLength(11);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ target: 'rpc/list_comments', args: { p_page_id: PAGE_ID, p_since: at(20) }, counted: true });
    expect(requests[0].query).toEqual({ order: 'updated_at.asc,id.asc', limit: '1000' });
  });

  it.each([137, 2, 1])('muchos comentarios con la misma fecha de cambio y un tope de %i: el id desempata y no se saltea ninguno', async (cap) => {
    // Como después de una carga que los tocó a todos en la misma transacción.
    const rows = Array.from({ length: cap === 137 ? 300 : 9 }, (_, i) => comment(i + 1, { updated_at: at(i < 3 ? i : 5) }));
    const { remote } = commentsApi(rows, { maxRows: cap });
    expect(ids((await remote.listComments(PAGE_ID, null))!).sort()).toEqual(ids(rows as { id: string }[]).sort());
  });

  it('lo que cambia entre dos pedidos no saltea ni repite: lo editado llega con su última versión y lo nuevo también', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => comment(i + 1));
    const { remote } = commentsApi(rows, {
      maxRows: 4,
      before: (request) => {
        if (request !== 2) return;
        // Entre el primer pedido y el segundo: alguien edita el segundo (ya recibido), borra el sexto y agrega uno.
        Object.assign(rows[1], { body: 'Editado', edited_at: at(50), updated_at: at(50) });
        Object.assign(rows[5], { body: null, deleted_at: at(51), updated_at: at(51) });
        rows.push(comment(11, { updated_at: at(52), created_at: at(52) }));
      },
    });
    const listed = (await remote.listComments(PAGE_ID, null))!;
    expect(ids(listed).sort()).toEqual(ids(rows as { id: string }[]).sort());
    expect(listed.find((r) => r.id === uuid(2))).toMatchObject({ body: 'Editado' });
    expect(listed.find((r) => r.id === uuid(6))).toMatchObject({ deleted_at: at(51) });
  });

  it('si la API no manda el total, sigue hasta una página vacía: nunca corta por haber recibido pocas filas', async () => {
    const rows = Array.from({ length: 300 }, (_, i) => comment(i + 1));
    const { remote, requests } = commentsApi(rows, { maxRows: 137, noCount: true });
    expect(await remote.listComments(PAGE_ID, null)).toHaveLength(300);
    expect(requests.map((r) => r.rows)).toEqual([137, 137, 26, 0]);
  });

  it('si un pedido falla, el resultado es el error: nunca una lista parcial', async () => {
    const rows = Array.from({ length: 300 }, (_, i) => comment(i + 1));
    const { remote, requests } = commentsApi(rows, { maxRows: 137, fail: { 2: { status: 503, code: '57P01', message: 'la base se reinició' } } });
    await expect(remote.listComments(PAGE_ID, null)).rejects.toMatchObject({ message: 'la base se reinició', permanent: false });
    expect(requests).toHaveLength(2);
  });

  it('una base sin la función: null, y no se vuelve a probar enseguida', async () => {
    const api = fakePostgrest({ tables: { comments_view: [] } });
    const remote = new SupabaseCommentRemote(api.client);
    expect(await remote.listComments(PAGE_ID, null)).toBeNull();
    expect(await remote.listComments(PAGE_ID, null)).toBeNull();
    expect(api.requests).toHaveLength(1);
  });
});

describe('la vista de compatibilidad de los comentarios (comments_view)', () => {
  it.each(CAPS)('con un tope de %i filas por pedido llegan todos, una vez cada uno, sin un pedido de más', async (cap) => {
    // Varios creados en el mismo instante: el id desempata.
    const rows = Array.from({ length: rowsFor(cap) }, (_, i) => comment(i + 1, { created_at: at(Math.floor(i / 3)) }));
    const { remote, requests } = commentsApi([...rows].reverse(), { maxRows: cap });
    expect(ids(await remote.fetchComments(PAGE_ID))).toEqual(ids(rows as { id: string }[]));
    expect(requests).toHaveLength(Math.ceil(rows.length / cap));
    expect(requests[0].query).toMatchObject({ page_id: `eq.${PAGE_ID}`, order: 'created_at.asc,id.asc', limit: '1000' });
  });

  it('pide de dónde se importó cada comentario y a quién nombra, y lo entrega', async () => {
    const imported = comment(1, { author_id: null, imported_from: 'coda', imported_author: 'Ana', imported_author_email: 'ana@x.test', imported_by: uuid(2, 0xbb), mentions: [{ user_id: uuid(3, 0xbb), label: 'Beto' }] });
    const { remote, requests } = commentsApi([imported]);
    // Lo que la vista entrega de lo pedido: todo menos `updated_at`, que no se le pide; lo del link, nulo.
    const { updated_at: _updated, ...asked } = imported;
    expect(await remote.fetchComments(PAGE_ID)).toEqual([{ ...asked, plink_id: null, plink_author: null }]);
    expect(requests).toHaveLength(1);
    expect(requests[0].query.select.replace(/\s/g, '')).toMatch(/,deleted_by,imported_from,imported_author,imported_author_email,imported_by,plink_id,plink_author,mentions$/);
  });

  it.each([
    ['las menciones', ['mentions'], [true, false], 'imported_from'],
    ['las menciones ni las del link', ['mentions', 'plink_id', 'plink_author'], [true, true, false], 'imported_from'],
    ['ninguna de las nuevas', ['mentions', 'plink_id', 'plink_author', 'imported_from', 'imported_author', 'imported_author_email', 'imported_by'], [true, true, true, false], 'deleted_by'],
  ] as const)('con una base cuya vista no tiene %s, baja de a un escalón, lee sin ellas y no las vuelve a pedir', async (_what, missing, asked, kept) => {
    const { remote, requests } = commentsApi([comment(1)], { missingColumns: { comments_view: [...missing] } });
    expect(await remote.fetchComments(PAGE_ID)).toHaveLength(1);
    expect(requests.map((r) => missing.some((c) => r.query.select.includes(c)))).toEqual(asked);
    expect(requests[requests.length - 1].query.select).toContain(kept);
    expect(await remote.fetchComments(PAGE_ID)).toHaveLength(1);
    expect(requests).toHaveLength(asked.length + 1);
  });
});

/** Un árbol de mentira: `count` páginas repartidas en dos proyectos. */
function treeApi(count: number, options: FakePostgrestOptions = {}) {
  const projects = [1, 2, 3].map((n) => ({ id: uuid(n, 0xcc), name: `Proyecto ${n}`, created_at: at(n === 3 ? 2 : n), owner_id: uuid(1, 0xbb) }));
  const pages: FakeRow[] = Array.from({ length: count }, (_, i) => ({ id: uuid(i + 1), workspace_id: projects[i % 2].id, parent_id: null, title: `Página ${i + 1}`, update_seq: 0 }));
  // Una página de un proyecto que no se pide: nunca llega.
  pages.push({ id: uuid(999_999), workspace_id: projects[2].id, parent_id: null, title: 'De otro proyecto', update_seq: 0 });
  const api = fakePostgrest({ tables: { pages: [...pages].reverse(), workspaces: projects }, ...options });
  return { ...api, pages, projects, remote: new SupabaseRemote(api.client, '0.224') };
}

describe('el árbol de páginas y los proyectos', () => {
  it.each(CAPS)('con un tope de %i filas por pedido el árbol llega entero, sin páginas repetidas ni salteadas ni un pedido de más', async (cap) => {
    const { remote, requests, pages, projects } = treeApi(rowsFor(cap), { maxRows: cap });
    const rows = await remote.fetchTree([projects[0].id, projects[1].id]);
    expect(ids(rows)).toEqual(ids(pages as { id: string }[]).slice(0, -1));
    expect(requests).toHaveLength(Math.ceil((pages.length - 1) / cap));
    expect(requests.every((r) => r.counted && r.query.order === 'id.asc')).toBe(true);
  });

  it('en el caso de siempre el árbol es un pedido', async () => {
    const { remote, requests, projects } = treeApi(423);
    expect(await remote.fetchTree([projects[0].id, projects[1].id])).toHaveLength(423);
    expect(requests).toHaveLength(1);
  });

  it('una página creada mientras se baja no saltea ninguna de las que estaban', async () => {
    const before = (request: number) => {
      if (request === 2) api.tables.pages.push({ id: uuid(0), workspace_id: api.projects[0].id, parent_id: null, title: 'Nueva, antes en el orden', update_seq: 0 }, { id: uuid(500_000), workspace_id: api.projects[0].id, parent_id: null, title: 'Nueva, después', update_seq: 0 });
    };
    const api = treeApi(300, { maxRows: 137, before });
    const rows = await api.remote.fetchTree([api.projects[0].id, api.projects[1].id]);
    // Todas las que estaban, una vez; la nueva que cae más adelante en el orden llega, la otra en la próxima bajada.
    expect(ids(rows)).toEqual([...ids(api.pages as { id: string }[]).slice(0, -1), uuid(500_000)]);
  });

  it('si la API no manda el total, sigue hasta una página vacía; y si un pedido falla, tira (nunca un árbol cortado)', async () => {
    const blind = treeApi(300, { maxRows: 137, noCount: true });
    expect(await blind.remote.fetchTree([blind.projects[0].id, blind.projects[1].id])).toHaveLength(300);
    expect(blind.requests.map((r) => r.rows)).toEqual([137, 137, 26, 0]);
    const broken = treeApi(300, { maxRows: 137, fail: { 3: { status: 500, code: 'XX000', message: 'falló la tercera' } } });
    await expect(broken.remote.fetchTree([broken.projects[0].id, broken.projects[1].id])).rejects.toMatchObject({ message: 'falló la tercera' });
  });

  it.each(CAPS)('con un tope de %i los proyectos llegan todos, por fecha de creación y por id', async (cap) => {
    const projects = Array.from({ length: cap === 1 ? 7 : cap + 40 }, (_, i) => ({ id: uuid(i + 1, 0xcc), name: `P${i}`, created_at: at(Math.floor(i / 4)), owner_id: null }));
    const api = fakePostgrest({ tables: { workspaces: [...projects].reverse() }, maxRows: cap });
    const listed = await new SupabaseRemote(api.client, '0.224').fetchProjects();
    expect(ids(listed)).toEqual(ids(projects));
    expect(api.requests).toHaveLength(Math.ceil(projects.length / cap));
    expect(api.requests[0].query).toMatchObject({ order: 'created_at.asc,id.asc' });
  });

  it('en el caso de siempre los proyectos son un pedido', async () => {
    const { remote, requests } = treeApi(5);
    expect(await remote.fetchProjects()).toHaveLength(3);
    expect(requests).toHaveLength(1);
  });
});

describe('los permisos propios, los usos de archivos y los archivos', () => {
  const ME = uuid(1, 0xbb);

  it.each(CAPS)('con un tope de %i llegan todos los permisos propios (antes, hasta el tope y sin avisar)', async (cap) => {
    const grants = Array.from({ length: rowsFor(cap) }, (_, i) => ({ id: uuid(i + 1), user_id: ME, project_id: null, page_id: uuid(i + 1, 0xdd), level: 'edit', revoked_at: null }));
    const others = [{ id: uuid(1, 0xee), user_id: uuid(2, 0xbb), project_id: null, page_id: uuid(1, 0xdd), level: 'edit', revoked_at: null }];
    const api = fakePostgrest({ tables: { members: [{ user_id: ME, role: 'member', removed_at: null }], grants: [...others, ...grants].reverse() }, maxRows: cap });
    const access = await new SupabaseRemote(api.client, '0.224').fetchMyAccess(ME);
    expect(access!.grants.map((g) => g.id)).toEqual(ids(grants));
    // La fila de `members` y los permisos: en el caso de siempre, dos pedidos.
    expect(api.requests).toHaveLength(1 + Math.ceil(grants.length / cap));
  });

  it.each(CAPS)('con un tope de %i llegan todos los usos de archivos de las páginas, y los de los archivos', async (cap) => {
    const pages = [uuid(1, 0xdd), uuid(2, 0xdd), uuid(3, 0xdd)];
    const uses = Array.from({ length: rowsFor(cap) }, (_, i) => ({ page_id: pages[i % 3], file_id: uuid(Math.floor(i / 3) + 1, 0xff), removed_at: i % 5 === 0 ? at(1) : null, is_foreign: false }));
    const api = fakePostgrest({ tables: { page_files: [...uses].reverse() }, maxRows: cap });
    const remote = new SupabaseRemote(api.client, '0.224');
    const key = (r: { page_id: string; file_id: string }) => `${r.page_id}|${r.file_id}`;
    expect((await remote.fetchPageUses(pages)).map(key).sort()).toEqual(uses.map(key).sort());
    expect(api.requests).toHaveLength(Math.ceil(uses.length / cap));
    api.requests.length = 0;
    const active = uses.filter((u) => u.removed_at === null);
    expect((await remote.fileUses([...new Set(uses.map((u) => u.file_id))].slice(0, 100))).map(key).sort()).toEqual(active.filter((u) => Number.parseInt(u.file_id.slice(-12), 16) <= 100).map(key).sort());
  });

  it.each(CAPS)('con un tope de %i llegan todos los archivos pedidos; los que no existen cuestan un pedido más, vacío', async (cap) => {
    const count = cap === 1 ? 7 : 250;
    const files = Array.from({ length: count }, (_, i) => ({ id: uuid(i + 1, 0xff), name: `f${i}`, mime: 'image/png', width: 1, height: 1, duration: null, thumb_at: null, drive_id: 'd', size: 10 }));
    const api = fakePostgrest({ tables: { files }, maxRows: cap });
    const remote = new SupabaseRemote(api.client, '0.224');
    expect(ids(await remote.fetchMediaFiles(ids(files))).sort()).toEqual(ids(files).sort());
    // De a 100 ids por pedido: con todo en una respuesta, los mismos pedidos que antes.
    const chunks = Array.from({ length: Math.ceil(count / 100) }, (_, i) => Math.min(100, count - i * 100));
    expect(api.requests).toHaveLength(chunks.reduce((sum, n) => sum + Math.ceil(n / cap), 0));
    api.requests.length = 0;
    expect(ids(await remote.fetchMediaFiles([files[0].id.toUpperCase(), uuid(1, 0x99)]))).toEqual([files[0].id]);
    expect(api.requests.map((r) => r.rows)).toEqual([1, 0]);
    api.requests.length = 0;
    expect(await remote.fetchMediaFiles([uuid(1, 0x99)])).toEqual([]);
    expect(api.requests).toHaveLength(1);
  });

  it.each([137, 1])('los archivos por peso, con un tope de %i: cada tramo llega entero y la lista no se da por terminada antes', async (cap) => {
    const project = uuid(1, 0xcc);
    const count = cap === 1 ? 5 : 300;
    const files = Array.from({ length: count }, (_, i) => ({ id: uuid(i + 1, 0xff), project_id: project, name: `f${i}`, mime: 'image/png', size: 1000 - Math.floor(i / 2), thumb_at: null, trashed_at: null, drive_id: 'd', drive_trashed_at: null }));
    const api = fakePostgrest({ tables: { files: [...files].reverse() }, maxRows: cap });
    const remote = new SupabaseRemote(api.client, '0.224');
    const tramo = cap === 1 ? 3 : 200;
    const first = await remote.filesBySize(project, null, tramo);
    expect(ids(first)).toEqual(ids(files).slice(0, tramo));
    const last = first[first.length - 1];
    const rest = await remote.filesBySize(project, { size: last.size, id: last.id }, tramo);
    expect(ids(rest)).toEqual(ids(files).slice(tramo));
  });

  it('un pedido que falla a mitad de los proyectos, de los permisos o de los usos es el error, no el final de la lista', async () => {
    // Un 500 (el cliente reintenta por su cuenta un 503 en las lecturas).
    const fail: Record<number, { status: number; code: string; message: string }> = { 2: { status: 500, code: 'XX000', message: 'la base se reinició' } };
    const projects = Array.from({ length: 300 }, (_, i) => ({ id: uuid(i + 1, 0xcc), name: `P${i}`, created_at: at(i), owner_id: null }));
    const grants = Array.from({ length: 300 }, (_, i) => ({ id: uuid(i + 1), user_id: ME, project_id: null, page_id: uuid(i + 1, 0xdd), level: 'edit', revoked_at: null }));
    const uses = Array.from({ length: 300 }, (_, i) => ({ page_id: uuid(1, 0xdd), file_id: uuid(i + 1, 0xff), removed_at: null, is_foreign: false }));
    const remoteWith = (tables: Record<string, FakeRow[]>, failAt = fail) => new SupabaseRemote(fakePostgrest({ tables, maxRows: 137, fail: failAt }).client, '0.224');
    await expect(remoteWith({ workspaces: projects }).fetchProjects()).rejects.toMatchObject({ message: 'la base se reinició', permanent: false });
    // El primero es la fila de `members`: falla la segunda página de los permisos.
    await expect(remoteWith({ members: [{ user_id: ME, role: 'member', removed_at: null }], grants }, { 3: fail[2] }).fetchMyAccess(ME)).rejects.toMatchObject({ message: 'la base se reinició' });
    await expect(remoteWith({ page_files: uses }).fetchPageUses([uuid(1, 0xdd)])).rejects.toMatchObject({ message: 'la base se reinició' });
    await expect(remoteWith({ page_files: uses }).fileUses(uses.map((u) => u.file_id).slice(0, 100))).resolves.toHaveLength(100);
    await expect(remoteWith({ page_files: uses }).fileUses(uses.map((u) => u.file_id))).rejects.toMatchObject({ message: 'la base se reinició' });
  });
});

describe('las listas que se piden de una sola vez y los lotes de contenido', () => {
  it('una lista que la API recortó es un error, no una lista más corta; entera, es un pedido', async () => {
    const members = Array.from({ length: 12 }, (_, i) => ({ user_id: uuid(i + 1, 0xbb), email: `p${i}@x.test`, role: 'member', created_at: at(i), removed_at: null }));
    const cut = fakePostgrest({ functions: { list_members: () => members }, maxRows: 5 });
    await expect(new SupabaseRemote(cut.client, '0.224').listMembers()).rejects.toMatchObject({ message: expect.stringContaining('Max rows'), code: LIST_CUT, permanent: false });
    const whole = fakePostgrest({ functions: { list_members: () => members } });
    expect(await new SupabaseRemote(whole.client, '0.224').listMembers()).toHaveLength(12);
    expect(whole.requests).toHaveLength(1);
    // Sin el total (la API no lo manda), no se inventa un error.
    expect(wholeList([1, 2], null)).toEqual([1, 2]);
    expect(wholeList([1, 2], 2)).toEqual([1, 2]);
    expect(() => wholeList([1, 2], 3)).toThrow('Max rows');
  });

  it('quién tiene acceso: lo mismo (un error si la API la recortó, un pedido si entra)', async () => {
    const access = Array.from({ length: 9 }, (_, i) => ({ user_id: uuid(i + 1, 0xbb), email: `p${i}@x.test`, role: 'member', level: 'edit', source: 'project', grant_id: uuid(i + 1) }));
    const target = { pageId: PAGE_ID };
    const cut = fakePostgrest({ functions: { list_access: () => access }, maxRows: 8 });
    await expect(new SupabaseRemote(cut.client, '0.224').listAccess(target)).rejects.toMatchObject({ code: LIST_CUT });
    const whole = fakePostgrest({ functions: { list_access: () => access }, maxRows: 9 });
    expect(await new SupabaseRemote(whole.client, '0.224').listAccess(target)).toHaveLength(9);
    expect(whole.requests).toMatchObject([{ target: 'rpc/list_access', args: { p_project: null, p_page: PAGE_ID }, counted: true }]);
  });

  it.each(CAPS)('los correos de quienes comentaron y de quienes escribieron la página llegan todos con un tope de %i (uno que falta no es un error)', async (cap) => {
    const people = Array.from({ length: cap === 1 ? 5 : 40 }, (_, i) => ({ user_id: uuid(i + 1, 0xbb), email: `p${String(i).padStart(3, '0')}@x.test` }));
    // Como la base: por correo, no por id.
    const byEmail = () => [...people].reverse();
    const api = fakePostgrest({ functions: { comment_authors: byEmail, page_history_authors: byEmail }, maxRows: Math.min(cap, 17) });
    const got = await new SupabaseCommentRemote(api.client).fetchCommentAuthors(PAGE_ID);
    expect(got.map((a) => a.user_id)).toEqual(people.map((p) => p.user_id));
    expect(api.requests[0]).toMatchObject({ target: 'rpc/comment_authors', args: { p_page_id: PAGE_ID }, counted: true, query: { order: 'user_id.asc' } });
    expect((await new SupabaseRemote(api.client, '0.224').pageHistoryAuthors(PAGE_ID)).map((a) => a.email).sort()).toEqual(people.map((p) => p.email));
    // Con todo en una respuesta, un pedido.
    const one = fakePostgrest({ functions: { comment_authors: byEmail } });
    await new SupabaseCommentRemote(one.client).fetchCommentAuthors(PAGE_ID);
    expect(one.requests).toHaveLength(1);
  });

  it('las listas que quien las pide no sabe mostrar en error llegan con lo que entra, como antes: los candidatos del @, lo que no entró de un link y la papelera de una base sin la función nueva', async () => {
    const people = Array.from({ length: 12 }, (_, i) => ({ user_id: uuid(i + 1, 0xbb), email: `p${i}@x.test`, label: `p${i}`, has_access: true }));
    const api = fakePostgrest({
      functions: {
        mention_candidates: () => people,
        public_link_updates_of: () => people.map((p, i) => ({ id: p.user_id, link_id: 'l', author: 'Ana', created_at: at(i), bytes: 1, state: 'waiting', reason: null })),
        trashed_files: () => people.map((p, i) => ({ id: p.user_id, name: `f${i}`, mime: 'image/png', size: 1, thumb_at: null, trashed_at: at(i), days_left: 30 })),
      },
      maxRows: 5,
    });
    expect(await new SupabaseCommentRemote(api.client).mentionCandidates(PAGE_ID)).toHaveLength(5);
    const remote = new SupabaseRemote(api.client, '0.224');
    expect(await remote.linkUpdatesOf(PAGE_ID)).toHaveLength(5);
    // `trashed_files_page` no está en esta base: la de un proyecto, como en v0.218.
    expect(await remote.trashedFiles(uuid(1, 0xcc))).toHaveLength(5);
  });

  /** `pull_page_updates` y `page_history` como las de la base: lo que sigue a `p_after_seq`, por `seq`, hasta `p_limit`. */
  const bySeq = (rows: FakeRow[]) => (args: Record<string, unknown>) =>
    rows.filter((r) => Number(r.seq) > Number(args.p_after_seq)).sort((a, b) => Number(a.seq) - Number(b.seq)).slice(0, Number(args.p_limit));
  const updates = (count: number): FakeRow[] => Array.from({ length: count }, (_, i) => ({ id: 1000 + i, seq: i + 1, update: 'AQID', created_by: null, created_at: at(i), plink_author: null }));

  it.each(CAPS)('con un tope de %i un lote de contenido o de historial llega entero: menos que lo pedido quiere decir que no hay más', async (cap) => {
    const rows = updates(cap === 1 ? 6 : 420);
    const api = fakePostgrest({ functions: { pull_page_updates: bySeq(rows), page_history: bySeq(rows) }, maxRows: cap });
    const remote = new SupabaseRemote(api.client, '0.224');
    const limit = cap === 1 ? 4 : 500;
    const expected = rows.slice(0, limit).map((r) => r.seq);
    expect((await remote.pullUpdates(PAGE_ID, 0, limit)).map((u) => u.seq)).toEqual(expected);
    expect(api.requests).toHaveLength(Math.ceil(expected.length / cap));
    api.requests.length = 0;
    expect((await remote.pageHistory(PAGE_ID, 0, limit)).map((u) => u.seq)).toEqual(expected);
    expect(api.requests).toHaveLength(Math.ceil(expected.length / cap));
    expect(api.requests[0]).toMatchObject({ counted: true, query: { order: 'seq.asc' }, args: { p_after_seq: 0, p_limit: limit } });
  });

  it.each([137, 1])('un lote que empieza con un snapshot, con un tope de %i: el snapshot llega primero y lo que sigue, entero y una vez', async (cap) => {
    const rows = updates(cap === 1 ? 8 : 400);
    const UP_TO = cap === 1 ? 3 : 100;
    const snapshot = { seq: UP_TO, update: 'AQID', snapshot_id: uuid(7, 0xab), content_epoch: 2, sha256: 'AB12' };
    // `pull_page_content` como la de la base: si el snapshot cubre más que lo pedido, va él y después lo que sigue.
    const content = (args: Record<string, unknown>) => {
      const after = Number(args.p_after_seq);
      const limit = Number(args.p_limit);
      const plain = (from: number, max: number) => bySeq(rows)({ p_after_seq: from, p_limit: max }).map((r) => ({ seq: r.seq, update: r.update, snapshot_id: null, content_epoch: 2, sha256: null }));
      return after < UP_TO ? [snapshot, ...plain(UP_TO, limit - 1)] : plain(after, limit);
    };
    const api = fakePostgrest({
      tables: { workspace_settings: [{ generation: 1, min_app_version: null, schema_version: 25, snapshot_min_version: 0.1 }] },
      functions: { pull_page_content: content },
      maxRows: cap,
    });
    const remote = new SupabaseRemote(api.client, '0.224');
    // Con los snapshots prendidos en los ajustes, el contenido se pide con `pull_page_content`.
    await remote.fetchWorkspaceSettings();
    api.requests.length = 0;
    const limit = cap === 1 ? 5 : 500;
    const got = await remote.pullContent(PAGE_ID, 0, limit);
    const expected = [UP_TO, ...rows.filter((r) => Number(r.seq) > UP_TO).map((r) => Number(r.seq))].slice(0, limit);
    expect(got.map((u) => u.seq)).toEqual(expected);
    expect(got[0]).toMatchObject({ snapshotId: uuid(7, 0xab), contentEpoch: 2, snapshotSha256: 'ab12' });
    expect(got.slice(1).every((u) => u.snapshotId === undefined)).toBe(true);
    expect(api.requests.every((r) => r.target === 'rpc/pull_page_content' && r.query.order === 'seq.asc')).toBe(true);
    expect(api.requests).toHaveLength(Math.ceil(expected.length / cap));
  });

  it('si la API no dice el total, un lote no pide de más: queda como antes y lo que falte lo trae la bajada siguiente', async () => {
    const rows = updates(300);
    const api = fakePostgrest({ functions: { pull_page_updates: bySeq(rows) }, maxRows: 137, noCount: true });
    expect((await new SupabaseRemote(api.client, '0.224').pullUpdates(PAGE_ID, 0, 500)).map((u) => u.seq)).toEqual(rows.slice(0, 137).map((r) => r.seq));
    expect(api.requests).toHaveLength(1);
  });
});

describe('KeyedList', () => {
  it('termina con el total o con una página vacía, nunca por una página corta; y tira si la base no avanza', () => {
    const list = new KeyedList<{ id: string }>('prueba', (r) => r.id);
    expect(list.last).toBeNull();
    expect(list.add([{ id: 'a' }, { id: 'b' }], 5)).toBe(false);
    expect(list.add([{ id: 'c' }], null)).toBe(false);
    expect(list.last).toEqual({ id: 'c' });
    expect(list.add([{ id: 'd' }], 1)).toBe(true);
    expect(new KeyedList<{ id: string }>('prueba', (r) => r.id).add([], undefined)).toBe(true);
    expect(() => list.add([{ id: 'b' }], 9)).toThrow('prueba: the same row arrived twice');
  });

  it('un total menor que lo que la API mandó no se cree: la lista sigue hasta la página vacía', async () => {
    const list = new KeyedList<{ id: string }>('prueba', (r) => r.id);
    expect(list.add([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 2)).toBe(false);
    expect(list.add([{ id: 'd' }], Number.NaN)).toBe(false);
    expect(list.add([], 0)).toBe(true);
    // En el pedido: una API que dice "hay 1" y manda 137 de las 300 no deja el árbol cortado.
    const pages = Array.from({ length: 300 }, (_, i) => ({ id: uuid(i + 1), workspace_id: uuid(1, 0xcc), parent_id: null, title: `P${i}`, update_seq: 0 }));
    const api = fakePostgrest({ tables: { pages }, maxRows: 137, lowCount: true });
    expect(await new SupabaseRemote(api.client, '0.224').fetchTree([uuid(1, 0xcc)])).toHaveLength(300);
    expect(api.requests.map((r) => r.rows)).toEqual([137, 137, 26, 0]);
  });
});
