import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakePostgrest, type FakePostgrestOptions, type FakeRow } from './fakePostgrest';
import { COUNT_UP_TO_ROWS, CountChoice, COUNTED } from './listPages';
import { SupabaseRemote } from './remote';
import { FakeServer, makeDevice, type Device } from './testing';

// El total, solo mientras la lista es chica (Docs/Doc_Sincronizacion.md, "Las listas largas", "El costo de contar a
// escala"). Pedirle el total a la API en una tabla hace que la base revise dos veces los permisos de cada fila: con un
// árbol grande duplica el costo de cada pedido. El árbol lo pide mientras el dispositivo tiene pocas páginas (un
// pedido, como siempre) y, con muchas, termina con una página vacía pedida por clave; y un pedido que contaba y la
// base cortó por tiempo se repite sin contar (también en los usos de archivos). La garantía es la misma en las dos
// formas: la lista llega entera, sin filas repetidas ni salteadas, y nunca se da por terminada por una página corta.

const CAPS = [1000, 500, 137, 1];
const uuid = (n: number, group = 0) => `${group.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
const PROJECT = uuid(1, 0xcc);

function treeApi(count: number, options: FakePostgrestOptions = {}, projects = 1) {
  const pages: FakeRow[] = Array.from({ length: count }, (_, i) => ({ id: uuid(i + 1), workspace_id: uuid((i % projects) + 1, 0xcc), parent_id: null, title: `Página ${i + 1}`, update_seq: i }));
  const api = fakePostgrest({ tables: { pages: [...pages].reverse() }, ...options });
  return { ...api, pages, remote: new SupabaseRemote(api.client, '0.231') };
}

describe('el árbol de páginas: el total solo mientras es chico', () => {
  it('con el árbol que el dispositivo ya tiene chico, un pedido con el total, como siempre', async () => {
    const { remote, requests } = treeApi(41);
    expect(await remote.fetchTree([PROJECT], null, 41)).toHaveLength(41);
    expect(requests.map((r) => [r.rows, r.counted])).toEqual([[41, true]]);
    // Justo debajo del corte todavía cuenta.
    const edge = treeApi(COUNT_UP_TO_ROWS - 1);
    expect(await edge.remote.fetchTree([PROJECT], null, COUNT_UP_TO_ROWS - 1)).toHaveLength(COUNT_UP_TO_ROWS - 1);
    expect(edge.requests.map((r) => [r.rows, r.counted])).toEqual([[COUNT_UP_TO_ROWS - 1, true]]);
  });

  it.each(CAPS)('con uno grande y un tope de %i no pide el total: llega entero, una vez cada página, y termina con una página vacía', async (cap) => {
    const count = cap === 1 ? 7 : 1203;
    const { remote, requests, pages } = treeApi(count, { maxRows: cap });
    const rows = await remote.fetchTree([PROJECT], null, 3500);
    expect(ids(rows)).toEqual(ids(pages as { id: string }[]));
    expect(requests.some((r) => r.counted)).toBe(false);
    // Los pedidos de siempre y uno más, por clave, que no trae nada.
    expect(requests).toHaveLength(Math.ceil(count / cap) + 1);
    expect(requests[requests.length - 1]).toMatchObject({ rows: 0, query: { id: `gt.${uuid(count)}` } });
    expect(requests.every((r) => r.query.order === 'id.asc')).toBe(true);
  });

  it('sin el total, lo que cambia entre dos pedidos tampoco saltea ni repite páginas', async () => {
    const before = (request: number) => {
      if (request !== 2) return;
      api.tables.pages.push({ id: uuid(0), workspace_id: PROJECT, parent_id: null, title: 'Nueva, antes en el orden', update_seq: 0 }, { id: uuid(500_000), workspace_id: PROJECT, parent_id: null, title: 'Nueva, después', update_seq: 0 });
      // Y una de las que faltaban deja de estar entre lo que se ve.
      api.tables.pages.splice(api.tables.pages.findIndex((p) => p.id === uuid(200)), 1);
    };
    const api = treeApi(300, { maxRows: 137, before });
    const rows = await api.remote.fetchTree([PROJECT], null, 5000);
    expect(ids(rows)).toEqual([...ids(api.pages as { id: string }[]).filter((id) => id !== uuid(200)), uuid(500_000)]);
    expect(api.requests.some((r) => r.counted)).toBe(false);
  });

  it('sin el total, un pedido que falla es el error: nunca un árbol cortado', async () => {
    const api = treeApi(300, { maxRows: 137, fail: { 3: { status: 500, code: 'XX000', message: 'falló la tercera' } } });
    await expect(api.remote.fetchTree([PROJECT], null, 5000)).rejects.toMatchObject({ message: 'falló la tercera' });
  });

  it('un árbol que creció de golpe: el pedido que contaba y la base cortó por tiempo se repite sin contar, y llega entero', async () => {
    // El dispositivo tenía 41 páginas y la base ahora tiene 1.300: contar más de 1.000 filas pasa el tope de la base.
    const { remote, requests, pages } = treeApi(1300, { countTimeoutOver: 1000 });
    const rows = await remote.fetchTree([PROJECT], null, 41);
    expect(ids(rows)).toEqual(ids(pages as { id: string }[]));
    expect(requests.map((r) => [r.rows, r.counted])).toEqual([[0, true], [1000, false], [300, false], [0, false]]);
    // El pedido repetido es el mismo, sin el total.
    expect(requests[1].query).toEqual(requests[0].query);
  });

  it('un corte en el SEGUNDO pedido (que contaba): repite ese pedido sin contar, desde la misma fila; no empieza de nuevo ni saltea', async () => {
    const timeout = { status: 500, code: '57014', message: 'canceling statement due to statement timeout' };
    const { remote, requests, pages } = treeApi(600, { maxRows: 137, fail: { 2: timeout } });
    const rows = await remote.fetchTree([PROJECT], null, 0);
    expect(ids(rows)).toEqual(ids(pages as { id: string }[]));
    expect(requests.map((r) => [r.rows, r.counted])).toEqual([[137, true], [0, true], [137, false], [137, false], [137, false], [52, false], [0, false]]);
    // El tercero es el segundo repetido: misma clave de partida.
    expect(requests[2].query).toEqual(requests[1].query);
    expect(requests[1].query.id).toBe(`gt.${uuid(137)}`);
  });

  it('un corte por tiempo de un pedido que no contaba es un error como cualquiera (no se repite para siempre)', async () => {
    const api = treeApi(300, { maxRows: 137, fail: { 2: { status: 500, code: '57014', message: 'canceling statement due to statement timeout' } } });
    await expect(api.remote.fetchTree([PROJECT], null, 5000)).rejects.toMatchObject({ code: '57014', permanent: false });
    expect(api.requests).toHaveLength(2);
  });

  it('con más de 100 proyectos vale para todas las tandas: sin el total con un árbol grande, con él con uno chico', async () => {
    // 150 proyectos (dos tandas) y 1.650 páginas: 1.100 en la primera tanda de 100 proyectos y 550 en la otra.
    const projectIds = Array.from({ length: 150 }, (_, i) => uuid(i + 1, 0xcc));
    const big = treeApi(1650, {}, 150);
    expect(ids(await big.remote.fetchTree(projectIds, null, 1650)).sort()).toEqual(ids(big.pages as { id: string }[]).sort());
    expect(big.requests.map((r) => [r.rows, r.counted])).toEqual([[1000, false], [100, false], [0, false], [550, false], [0, false]]);
    // Un dispositivo nuevo todavía no sabe: cuenta, como antes.
    const fresh = treeApi(1650, {}, 150);
    expect(await fresh.remote.fetchTree(projectIds, null, 0)).toHaveLength(1650);
    expect(fresh.requests.map((r) => [r.rows, r.counted])).toEqual([[1000, true], [100, true], [550, true]]);
  });
});

describe('los usos de archivos: con el total, y sin él si la base cortó por tiempo un pedido que lo pedía', () => {
  const pageIds = Array.from({ length: 150 }, (_, i) => uuid(i + 1, 0xdd));
  /** `perPage` usos en cada una de las primeras 100 páginas y uno en cada una de las otras 50. */
  const usesOf = (perPage: number) => [
    ...pageIds.slice(0, 100).flatMap((page_id) => Array.from({ length: perPage }, (_, f) => ({ page_id, file_id: uuid(f + 1, 0xff), removed_at: null, is_foreign: false }))),
    ...pageIds.slice(100).map((page_id) => ({ page_id, file_id: uuid(1, 0xff), removed_at: null, is_foreign: false })),
  ];

  it('sin un corte, como siempre: con el total, sin un pedido de más aunque una tanda traiga muchas filas', async () => {
    const few = fakePostgrest({ tables: { page_files: usesOf(2) } });
    expect(await new SupabaseRemote(few.client, '0.231').fetchPageUses(pageIds)).toHaveLength(250);
    expect(few.requests.map((r) => [r.rows, r.counted])).toEqual([[200, true], [50, true]]);
    const many = fakePostgrest({ tables: { page_files: [...usesOf(12)].reverse() } });
    expect(await new SupabaseRemote(many.client, '0.231').fetchPageUses(pageIds)).toHaveLength(1250);
    expect(many.requests.map((r) => [r.rows, r.counted])).toEqual([[1000, true], [200, true], [50, true]]);
  });

  it('un pedido que contaba y la base cortó por tiempo se repite sin contar: los usos llegan enteros, por página y por archivo', async () => {
    const uses = usesOf(12);
    const api = fakePostgrest({ tables: { page_files: uses }, countTimeoutOver: 1000 });
    expect(await new SupabaseRemote(api.client, '0.231').fetchPageUses(pageIds)).toHaveLength(1250);
    expect(api.requests.map((r) => [r.rows, r.counted])).toEqual([[0, true], [1000, false], [200, false], [0, false], [50, false], [0, false]]);
    const fileIds = [...new Set(uses.map((u) => u.file_id))];
    const other = fakePostgrest({ tables: { page_files: uses }, countTimeoutOver: 1000 });
    expect(await new SupabaseRemote(other.client, '0.231').fileUses(fileIds)).toHaveLength(1250);
    expect(other.requests[0]).toMatchObject({ rows: 0, counted: true });
    expect(other.requests.slice(1).some((r) => r.counted)).toBe(false);
  });
});

describe('las invitaciones y los nombres de versión, enteros con un tope de filas bajo', () => {
  const at = (n: number) => `${new Date(Date.UTC(2026, 9, 1, 10) + n * 1000).toISOString().replace('Z', '')}000+00:00`;

  it.each(CAPS)('con un tope de %i llegan todas las invitaciones, en el orden de la función (lo más nuevo primero); antes, ninguna', async (cap) => {
    const count = cap === 1 ? 5 : cap + 40;
    // Los ids no siguen el orden de las fechas, y dos comparten fecha: desempata el id.
    const invitations = Array.from({ length: count }, (_, i) => ({ id: uuid((i * 7) % count + 1), email: `p${i}@x.test`, role: 'member', grants: [], invited_by: null, invited_by_email: null, created_at: at(Math.floor(i / 2)), expires_at: at(9999) }));
    const api = fakePostgrest({ functions: { list_invitations: () => [...invitations].reverse() }, maxRows: cap });
    const listed = (await new SupabaseRemote(api.client, '0.231').listInvitations())!;
    const expected = [...invitations].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? -1 : 1));
    expect(listed.map((i) => i.email)).toEqual(expected.map((i) => i.email));
    expect(api.requests).toHaveLength(Math.ceil(count / cap));
    expect(api.requests[0]).toMatchObject({ target: 'rpc/list_invitations', counted: true, query: { order: 'id.asc' } });
  });

  it('una base sin las invitaciones sigue siendo null, y un pedido que falla a mitad tira', async () => {
    expect(await new SupabaseRemote(fakePostgrest().client, '0.231').listInvitations()).toBeNull();
    const rows = Array.from({ length: 9 }, (_, i) => ({ id: uuid(i + 1), email: `p${i}@x.test`, created_at: at(i) }));
    const broken = fakePostgrest({ functions: { list_invitations: () => rows }, maxRows: 4, fail: { 2: { status: 500, code: 'XX000', message: 'la base se reinició' } } });
    await expect(new SupabaseRemote(broken.client, '0.231').listInvitations()).rejects.toMatchObject({ message: 'la base se reinició' });
  });

  it.each(CAPS)('con un tope de %i llegan todos los nombres de versión de una página, en el orden de la función (fila, fecha, id)', async (cap) => {
    const count = cap === 1 ? 5 : cap + 40;
    const PAGE = uuid(1, 0xaa);
    const versions = Array.from({ length: count }, (_, i) => ({ id: uuid(count - i), seq: Math.floor(i / 3) + 1, kind: i % 5 === 0 ? 'restore' : 'named', label: `v${i}`, restored_from_seq: null, created_by: null, created_at: at(i % 3 === 2 ? 0 : i) }));
    const api = fakePostgrest({ functions: { list_page_versions: (args) => (args.p_page_id === PAGE ? [...versions].reverse() : []) }, maxRows: cap });
    const listed = await new SupabaseRemote(api.client, '0.231').listPageVersions(PAGE);
    const expected = [...versions].sort((a, b) => a.seq - b.seq || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
    expect(listed.map((v) => v.label)).toEqual(expected.map((v) => v.label));
    expect(listed[0]).toMatchObject({ id: expected[0].id, seq: expected[0].seq, kind: expected[0].kind, createdAt: expected[0].created_at });
    expect(api.requests).toHaveLength(Math.ceil(count / cap));
    expect(api.requests[0]).toMatchObject({ target: 'rpc/list_page_versions', args: { p_page_id: PAGE }, query: { order: 'id.asc' } });
  });
});

describe('CountChoice', () => {
  it('cuenta mientras lo conocido es poco, deja de contar con un corte por tiempo, y no vuelve', () => {
    expect(new CountChoice().option).toBe(COUNTED);
    expect(new CountChoice(COUNT_UP_TO_ROWS - 1).option).toBe(COUNTED);
    expect(new CountChoice(COUNT_UP_TO_ROWS).option).toBeUndefined();
    const choice = new CountChoice(10);
    // Otro error no cambia nada ni pide repetir.
    expect(choice.timedOut({ code: 'XX000' })).toBe(false);
    expect(choice.timedOut(null)).toBe(false);
    expect(choice.option).toBe(COUNTED);
    expect(choice.timedOut({ code: '57014' })).toBe(true);
    expect(choice.option).toBeUndefined();
    // Ya no contaba: el mismo corte no pide repetir.
    expect(choice.timedOut({ code: '57014' })).toBe(false);
  });
});

describe('la sincronización le dice al pedido cuántas páginas tiene el dispositivo', () => {
  const devices: Device[] = [];
  afterEach(() => {
    for (const d of devices.splice(0)) {
      d.engine.stop();
      d.db.close();
      d.mediaDb.close();
      d.commentsDb.close();
    }
    vi.restoreAllMocks();
  });

  it('en cada bajada del árbol va la cantidad de la bajada anterior', async () => {
    const server = new FakeServer();
    const d = await makeDevice(server);
    devices.push(d);
    const asked = vi.spyOn(d.remote, 'fetchTree');
    await d.engine.syncNow();
    expect(asked.mock.calls[asked.mock.calls.length - 1][2]).toBe(0);
    for (const title of ['Uno', 'Dos', 'Tres']) await d.tree.create(null, title);
    await d.engine.syncNow();
    await d.engine.syncNow();
    expect(d.tree.serverPages).toBe(3);
    expect(asked.mock.calls[asked.mock.calls.length - 1][2]).toBe(3);
  });

  it('cuenta lo que trajo la última bajada guardada, no lo que se ve: lo creado sin subir no suma', async () => {
    const server = new FakeServer();
    const d = await makeDevice(server);
    devices.push(d);
    for (const title of ['Uno', 'Dos', 'Tres']) await d.tree.create(null, title);
    await d.engine.syncNow();
    await d.engine.syncNow();
    server.online = false;
    for (const title of ['Cuatro', 'Cinco']) await d.tree.create(null, title);
    expect(d.tree.children(null)).toHaveLength(5);
    expect(d.tree.serverPages).toBe(3);
    // Al volver la red suben antes de la bajada, en el mismo ciclo: confirmadas por la base, ya cuentan.
    server.online = true;
    const asked = vi.spyOn(d.remote, 'fetchTree');
    await d.engine.syncNow();
    expect(asked.mock.calls[0][2]).toBe(5);
    expect(d.tree.serverPages).toBe(5);
  });

  it('después de restaurar una copia de la base, las dos bajadas del árbol del ciclo llevan la cantidad', async () => {
    const server = new FakeServer();
    const d = await makeDevice(server);
    devices.push(d);
    for (const title of ['Uno', 'Dos', 'Tres']) await d.tree.create(null, title);
    await d.engine.syncNow();
    await d.engine.syncNow();
    const restore = server.backup();
    restore();
    const asked = vi.spyOn(d.remote, 'fetchTree');
    await d.engine.syncNow();
    // La de la recuperación (antes de reemplazar nada) y la de siempre.
    expect(asked.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(asked.mock.calls.map((c) => c[2])).toEqual(asked.mock.calls.map(() => 3));
  });
});
