import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakePostgrest, type FakePostgrestOptions, type FakeRow } from './fakePostgrest';
import {
  CHANGED_AT_SCHEMA_VERSION,
  SupabaseRemote,
  TREE_CHANGES_OVERLAP_MS,
  TREE_COUNT_FAILS,
  TREE_COUNT_EVERY_MS,
  TREE_WHOLE_EVERY_MS,
} from './remote';

// El árbol en cada vuelta (Docs/Doc_Sincronizacion.md): con `pages.changed_at` (versión 26) cada vuelta baja solo las
// páginas que cambiaron y las suma a la copia de la vuelta anterior; la lista entera, al empezar, cada 30 minutos, con
// otros proyectos, otra generación u otros permisos propios, o si el total que la sesión ve deja de coincidir con la
// copia. Lo que devuelve es siempre la lista entera, como antes: el árbol del dispositivo no se entera de nada de esto.

const V = CHANGED_AT_SCHEMA_VERSION;
const uuid = (n: number, group = 0) => `${group.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const P1 = uuid(1, 0xcc);
const P2 = uuid(2, 0xcc);
const ME = uuid(9, 0xee);
const T0 = Date.parse('2026-10-28T10:00:00.000Z');
const at = (ms: number) => new Date(ms).toISOString().replace('Z', '123+00:00');

function api(count: number, options: FakePostgrestOptions = {}) {
  const pages: FakeRow[] = Array.from({ length: count }, (_, i) => ({
    id: uuid(i + 1),
    workspace_id: P1,
    parent_id: null,
    title: `Página ${i + 1}`,
    update_seq: 0,
    changed_at: at(T0 - 3_600_000),
  }));
  const fake = fakePostgrest({
    tables: {
      pages,
      workspace_settings: [{ id: true, generation: 1, min_app_version: null, schema_version: V }],
      members: [{ user_id: ME, role: 'member', removed_at: null }],
      grants: [],
    },
    ...options,
  });
  return { ...fake, pages, remote: new SupabaseRemote(fake.client, '0.301') };
}

/** Lo que pidió cada pedido al árbol: entero o por cambios (y desde cuándo), o solo el total. */
const treeAsks = (requests: { target: string; query: Record<string, string>; rows: number }[]) =>
  requests
    .filter((r) => r.target === 'pages')
    .map((r) => (r.query.select === 'id' ? 'total' : r.query.changed_at ? `cambios ${r.query.changed_at}` : r.query.select.includes('changed_at') ? 'entero con marcas' : 'entero'));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe('el árbol en cada vuelta: solo lo que cambió', () => {
  it('la primera vuelta baja el árbol entero con las marcas; con una marca vieja, la siguiente pide solo lo posterior a ella', async () => {
    const { remote, requests, pages } = api(40);
    const first = await remote.fetchTree([P1], V, 0);
    expect(first).toHaveLength(40);
    // Al árbol del dispositivo no le llega la marca.
    expect(first.every((r) => !('changed_at' in r))).toBe(true);

    // Sin cambios: una lista vacía, pedida desde la marca exacta (con los microsegundos).
    requests.length = 0;
    vi.setSystemTime(T0 + 10_000);
    expect(await remote.fetchTree([P1], V, 40)).toEqual(first);
    expect(treeAsks(requests)).toEqual([`cambios gt.${at(T0 - 3_600_000)}`]);
    expect(requests[0].rows).toBe(0);

    // Otro dispositivo cambia el título de una y sube contenido a otra.
    pages[3].title = 'Cambiada';
    pages[3].changed_at = at(T0 + 11_000);
    pages[7].update_seq = 5;
    pages[7].changed_at = at(T0 + 12_000);
    requests.length = 0;
    vi.setSystemTime(T0 + 20_000);
    const second = await remote.fetchTree([P1], V, 40);
    expect(treeAsks(requests)).toEqual([`cambios gt.${at(T0 - 3_600_000)}`]);
    expect(requests[0].rows).toBe(2);
    expect(second).toHaveLength(40);
    expect(second.find((r) => r.id === uuid(4))?.title).toBe('Cambiada');
    expect(second.find((r) => r.id === uuid(8))?.update_seq).toBe(5);
  });

  it('con una marca reciente pide con el solape hasta que pasa el solape; después, una lista vacía en cada vuelta', async () => {
    const { remote, requests, pages } = api(10);
    await remote.fetchTree([P1], V, 0);
    pages[2].changed_at = at(T0 + 1000);
    vi.setSystemTime(T0 + 10_000);
    await remote.fetchTree([P1], V, 10);

    // Mientras la marca es reciente, cada vuelta vuelve a pedir desde un rato antes (lo que se confirme tarde).
    const overlap = `cambios gte.${new Date(T0 + 1000 - TREE_CHANGES_OVERLAP_MS).toISOString()}`;
    requests.length = 0;
    vi.setSystemTime(T0 + 20_000);
    await remote.fetchTree([P1], V, 10);
    expect(treeAsks(requests)).toEqual([overlap]);
    expect(requests[0].rows).toBe(1);

    // Una transacción que confirmó tarde, con una marca anterior a la última: llega por el solape.
    pages[5].title = 'Tarde';
    pages[5].changed_at = at(T0 + 500);
    requests.length = 0;
    vi.setSystemTime(T0 + 30_000);
    expect((await remote.fetchTree([P1], V, 10)).find((r) => r.id === uuid(6))?.title).toBe('Tarde');
    expect(treeAsks(requests)).toEqual([overlap]);

    // Pasado el solape desde que llegó la marca, una vuelta más con el solape, y desde ahí solo lo posterior. (El total
    // de cada minuto no cuenta acá.)
    const changes = () => treeAsks(requests).filter((a) => a !== 'total');
    vi.setSystemTime(T0 + 10_000 + TREE_CHANGES_OVERLAP_MS);
    requests.length = 0;
    await remote.fetchTree([P1], V, 10);
    expect(changes()).toEqual([overlap]);
    for (const t of [10_000, 20_000]) {
      requests.length = 0;
      vi.setSystemTime(T0 + t + 10_000 + TREE_CHANGES_OVERLAP_MS);
      await remote.fetchTree([P1], V, 10);
      expect(changes()).toEqual([`cambios gt.${at(T0 + 1000)}`]);
      expect(requests[0].rows).toBe(0);
    }
  });

  it('muchas filas cambiadas a la vez (una importación) llegan todas, de a 1000', async () => {
    const { remote, requests, pages } = api(2500);
    await remote.fetchTree([P1], V, 0);
    for (const [i, page] of pages.entries()) {
      if (i % 2 === 0) continue;
      page.title = `Importada ${i}`;
      page.changed_at = at(T0 + 1000 + i);
    }
    requests.length = 0;
    vi.setSystemTime(T0 + 10_000);
    const rows = await remote.fetchTree([P1], V, 2500);
    expect(rows).toHaveLength(2500);
    expect(rows.filter((r) => r.title.startsWith('Importada'))).toHaveLength(1250);
    expect(treeAsks(requests).every((a) => a.startsWith('cambios gt.'))).toBe(true);
    expect(requests.length).toBeGreaterThan(1);
  });

  it('si el reloj del dispositivo va para atrás, los plazos se toman por vencidos: la lista entera', async () => {
    const { remote, requests } = api(10);
    await remote.fetchTree([P1], V, 0);
    requests.length = 0;
    vi.setSystemTime(T0 - 3_600_000);
    await remote.fetchTree([P1], V, 10);
    expect(treeAsks(requests)).toEqual(['entero con marcas']);
  });

  it('una base anterior a la 26 baja el árbol entero en cada vuelta, sin pedir la marca', async () => {
    const { remote, requests } = api(10);
    await remote.fetchTree([P1], V - 1, 0);
    await remote.fetchTree([P1], V - 1, 10);
    expect(treeAsks(requests)).toEqual(['entero', 'entero']);
  });

  it('una base que dice 26 sin la columna sigue andando: entero, sin marcas y sin error', async () => {
    const { remote, requests } = api(10, { missingColumns: { pages: ['changed_at'] } });
    expect(await remote.fetchTree([P1], V, 0)).toHaveLength(10);
    expect(await remote.fetchTree([P1], V, 10)).toHaveLength(10);
    // El primer pedido falla por la columna y se repite sin ella; después ni se prueba (por un rato).
    expect(treeAsks(requests)).toEqual(['entero con marcas', 'entero', 'entero']);
  });

  it('cada minuto compara el total que ve la sesión: si no coincide (entró una rama compartida), baja el árbol entero', async () => {
    const { remote, requests, pages } = api(10);
    await remote.fetchTree([P1], V, 0);
    // Una página que la sesión empieza a ver sin que haya cambiado: su marca es vieja.
    pages.push({ id: uuid(500), workspace_id: P1, parent_id: null, title: 'Recién compartida', update_seq: 0, changed_at: at(T0 - 7_200_000) });
    requests.length = 0;
    vi.setSystemTime(T0 + 10_000);
    expect(await remote.fetchTree([P1], V, 10)).toHaveLength(10);
    expect(treeAsks(requests)).toEqual([expect.stringMatching(/^cambios/)]);

    requests.length = 0;
    vi.setSystemTime(T0 + TREE_COUNT_EVERY_MS + 1);
    const rows = await remote.fetchTree([P1], V, 10);
    expect(rows.map((r) => r.title)).toContain('Recién compartida');
    expect(treeAsks(requests)).toEqual([expect.stringMatching(/^cambios/), 'total', 'entero con marcas']);
  });

  it('una página que se deja de ver sale con la lista entera de la vuelta en que el total no coincide', async () => {
    const { remote, pages } = api(10);
    await remote.fetchTree([P1], V, 0);
    pages.splice(2, 1);
    vi.setSystemTime(T0 + TREE_COUNT_EVERY_MS + 1);
    const rows = await remote.fetchTree([P1], V, 10);
    expect(rows).toHaveLength(9);
    expect(rows.some((r) => r.id === uuid(3))).toBe(false);
  });

  it('si el total no se puede saber, la vuelta sigue con la copia y no falla', async () => {
    const timeout = { status: 500, code: '57014', message: 'canceling statement due to statement timeout' };
    // Pedido 1: el árbol entero; 2: por cambios; 3: el total, que la base corta por tiempo.
    const { remote, requests } = api(10, { fail: { 3: timeout } });
    await remote.fetchTree([P1], V, 0);
    vi.setSystemTime(T0 + TREE_COUNT_EVERY_MS + 1);
    expect(await remote.fetchTree([P1], V, 10)).toHaveLength(10);
    expect(treeAsks(requests)).toEqual(['entero con marcas', expect.stringMatching(/^cambios/), 'total']);
  });

  it(`si el total no se puede saber ${TREE_COUNT_FAILS} veces seguidas, la lista entera`, async () => {
    const timeout = { status: 500, code: '57014', message: 'canceling statement due to statement timeout' };
    // Pedido 1: el árbol entero; después, de a dos por vuelta: por cambios y el total, que la base siempre corta.
    const { remote, requests } = api(10, { fail: { 3: timeout, 5: timeout, 7: timeout } });
    await remote.fetchTree([P1], V, 0);
    for (let n = 1; n <= TREE_COUNT_FAILS; n++) {
      vi.setSystemTime(T0 + n * (TREE_COUNT_EVERY_MS + 1));
      expect(await remote.fetchTree([P1], V, 10)).toHaveLength(10);
    }
    expect(treeAsks(requests).slice(-3)).toEqual([expect.stringMatching(/^cambios/), 'total', 'entero con marcas']);
  });

  it('si el total no coincide y la lista entera falla, la vuelta siguiente no vuelve a la copia', async () => {
    // Pedido 1: el árbol entero; 2: por cambios; 3: el total, que no coincide; 4: la lista entera, que se corta.
    const { remote, requests, pages } = api(10, { fail: { 4: { status: 500, code: 'XX000', message: 'se cortó' } } });
    await remote.fetchTree([P1], V, 0);
    pages.splice(2, 1);
    vi.setSystemTime(T0 + TREE_COUNT_EVERY_MS + 1);
    await expect(remote.fetchTree([P1], V, 10)).rejects.toMatchObject({ message: 'se cortó' });
    requests.length = 0;
    expect(await remote.fetchTree([P1], V, 10)).toHaveLength(9);
    expect(treeAsks(requests)).toEqual(['entero con marcas']);
  });

  it('cada 30 minutos baja el árbol entero aunque no haya señales', async () => {
    const { remote, requests } = api(10);
    await remote.fetchTree([P1], V, 0);
    requests.length = 0;
    vi.setSystemTime(T0 + TREE_WHOLE_EVERY_MS + 1);
    await remote.fetchTree([P1], V, 10);
    expect(treeAsks(requests)).toEqual(['entero con marcas']);
  });

  it('con otros proyectos, la lista entera', async () => {
    const { remote, requests } = api(10);
    await remote.fetchTree([P1], V, 0);
    requests.length = 0;
    await remote.fetchTree([P1, P2], V, 10);
    expect(treeAsks(requests)).toEqual(['entero con marcas']);
    // El mismo grupo en otro orden es el mismo: por cambios.
    requests.length = 0;
    await remote.fetchTree([P2, P1], V, 10);
    expect(treeAsks(requests)).toEqual([expect.stringMatching(/^cambios/)]);
  });

  it('con otra generación de la base (una restauración), la lista entera', async () => {
    const { remote, requests, tables } = api(10);
    await remote.fetchWorkspaceSettings();
    await remote.fetchTree([P1], V, 0);
    await remote.fetchWorkspaceSettings();
    requests.length = 0;
    await remote.fetchTree([P1], V, 10);
    expect(treeAsks(requests)).toEqual([expect.stringMatching(/^cambios/)]);

    tables.workspace_settings[0].generation = 2;
    await remote.fetchWorkspaceSettings();
    requests.length = 0;
    await remote.fetchTree([P1], V, 10);
    expect(treeAsks(requests)).toEqual(['entero con marcas']);
  });

  it('con otros permisos propios, la lista entera', async () => {
    const { remote, requests, tables } = api(10);
    await remote.fetchMyAccess(ME);
    await remote.fetchTree([P1], V, 0);
    await remote.fetchMyAccess(ME);
    requests.length = 0;
    await remote.fetchTree([P1], V, 10);
    expect(treeAsks(requests)).toEqual([expect.stringMatching(/^cambios/)]);

    tables.members[0].role = 'guest';
    await remote.fetchMyAccess(ME);
    requests.length = 0;
    await remote.fetchTree([P1], V, 10);
    expect(treeAsks(requests)).toEqual(['entero con marcas']);
  });

  it('un pedido por cambios que falla es el error de la vuelta, y la copia no cambia a medias', async () => {
    const { remote, pages } = api(10, { fail: { 2: { status: 500, code: 'XX000', message: 'se cortó' } } });
    await remote.fetchTree([P1], V, 0);
    pages[0].title = 'Nueva';
    pages[0].changed_at = at(T0 + 1000);
    await expect(remote.fetchTree([P1], V, 10)).rejects.toMatchObject({ message: 'se cortó' });
    const rows = await remote.fetchTree([P1], V, 10);
    expect(rows.find((r) => r.id === uuid(1))?.title).toBe('Nueva');
  });

  it('las filas que devuelve son copias: tocarlas no cambia la próxima vuelta', async () => {
    const { remote } = api(3);
    const first = await remote.fetchTree([P1], V, 0);
    first[0].title = 'Tocada por el árbol del dispositivo';
    const second = await remote.fetchTree([P1], V, 3);
    expect(second[0].title).toBe('Página 1');
  });
});
