import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openLocalDb, type LocalDb } from '../sync/localDb';
import { SupabaseRemote } from '../sync/remote';
import { RemoteError, type ProjectSizeRow } from '../sync/types';
import { formatSize } from './fileTrash';
import { ProjectSizes, SIZES_MAX_AGE_MS, SIZES_MISSING_WAIT_MS, totalOf } from './projectSizes';

// El peso de los proyectos en el Drive (P.7): cuándo se pide, qué se muestra sin red, con una base vieja o sin
// la función, y cómo se escribe el número. Las reglas de la base están en
// supabase/tests/peso_proyectos_permisos.sql.

const dbs: LocalDb[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function row(projectId: string | null, driveBytes: number, extra: Partial<ProjectSizeRow> = {}): ProjectSizeRow {
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

/** Un store con su base local, un reloj que se mueve a mano y una base que responde lo que se le diga. */
async function setup(dbName: string = crypto.randomUUID()) {
  const db = await openLocalDb(dbName);
  dbs.push(db);
  const clock = { now: 1_000_000 };
  const server = {
    calls: 0,
    answer: [] as ProjectSizeRow[] | null,
    offline: false,
  };
  const store = new ProjectSizes(
    db,
    {
      projectSizes: async () => {
        server.calls++;
        if (server.offline) throw new RemoteError('Failed to fetch', false, undefined, true);
        return server.answer && server.answer.map((r) => ({ ...r }));
      },
    },
    () => clock.now,
  );
  await store.load();
  return { db, store, clock, server, dbName };
}

describe('el store del peso', () => {
  it('guarda la respuesta en el dispositivo y al abrir el selector no vuelve a pedir antes de 5 minutos', async () => {
    const { store, clock, server, dbName } = await setup();
    store.configure(7);
    server.answer = [row('p1', 3000)];
    await store.refreshIfStale();
    expect(server.calls).toBe(1);
    expect(store.of('p1')?.drive_bytes).toBe(3000);
    expect(store.getSnapshot().at).toBe(clock.now);

    clock.now += SIZES_MAX_AGE_MS - 1;
    await store.refreshIfStale();
    expect(server.calls).toBe(1);
    clock.now += 1;
    server.answer = [row('p1', 5000)];
    await store.refreshIfStale();
    expect(server.calls).toBe(2);
    expect(store.of('p1')?.drive_bytes).toBe(5000);

    // "Volver a calcular" y el diálogo de Drive piden siempre.
    await store.refresh();
    expect(server.calls).toBe(3);

    // Otra apertura de la app arranca con lo guardado, antes de saber nada de la base.
    const again = await setup(dbName);
    expect(again.store.of('p1')?.drive_bytes).toBe(5000);
  });

  it('sin red se sigue mostrando el último valor, y lo dice', async () => {
    const { store, server, dbName } = await setup();
    store.configure(7);
    server.answer = [row('p1', 3000)];
    await store.refresh();
    server.offline = true;
    await store.refresh();
    expect(store.getSnapshot()).toMatchObject({ failed: 'offline', loading: false });
    expect(store.of('p1')?.drive_bytes).toBe(3000);

    // Al abrir sin red (sin sincronizar, sin saber la versión): lo guardado; pedir espera a saber la versión.
    const offline = await setup(dbName);
    offline.server.answer = [row('p1', 9000)];
    expect(offline.store.of('p1')?.drive_bytes).toBe(3000);
    await offline.store.refresh();
    expect(offline.server.calls).toBe(0);
    offline.store.configure(7);
    await vi.waitFor(() => expect(offline.store.of('p1')?.drive_bytes).toBe(9000));
    expect(offline.server.calls).toBe(1);
  });

  it('con una base en la versión 6 no pide nada y no muestra lo guardado', async () => {
    const first = await setup();
    first.store.configure(7);
    first.server.answer = [row('p1', 3000)];
    await first.store.refresh();

    const { store, server } = await setup(first.dbName);
    store.configure(6);
    await store.refresh();
    await store.refreshIfStale();
    expect(server.calls).toBe(0);
    expect(store.getSnapshot().rows).toBeNull();
    expect(store.of('p1')).toBeUndefined();
  });

  it('si la base no tiene la función (PGRST202), no muestra nada y no vuelve a probar por 10 minutos', async () => {
    const { store, clock, server, dbName } = await setup();
    store.configure(7);
    server.answer = [row('p1', 3000)];
    await store.refresh();
    server.answer = null;
    await store.refresh();
    expect(store.getSnapshot().rows).toBeNull();
    expect(server.calls).toBe(2);

    clock.now += SIZES_MISSING_WAIT_MS - 1;
    await store.refresh();
    await store.refreshIfStale();
    expect(server.calls).toBe(2);
    clock.now += 1;
    server.answer = [row('p1', 4000)];
    await store.refresh();
    expect(server.calls).toBe(3);
    expect(store.of('p1')?.drive_bytes).toBe(4000);

    // Lo guardado antes del PGRST202 no vuelve al abrir de nuevo.
    server.answer = null;
    clock.now += SIZES_MISSING_WAIT_MS;
    await store.refresh();
    const again = await setup(dbName);
    expect(again.store.getSnapshot().rows).toBeNull();
  });

  it('un proyecto que no viene en la respuesta nueva deja de tener peso', async () => {
    const { store, server } = await setup();
    store.configure(7);
    server.answer = [row('p1', 3000), row('p2', 7000)];
    await store.refresh();
    expect(store.of('p2')?.drive_bytes).toBe(7000);
    server.answer = [row('p1', 3000)];
    await store.refresh();
    expect(store.of('p2')).toBeUndefined();
    expect(store.of('p1')?.drive_bytes).toBe(3000);
  });

  it('la fila sin proyecto (solo el dueño) suma al total y aparte, y no es de ningún proyecto', async () => {
    const { store, server } = await setup();
    store.configure(7);
    server.answer = [
      row('p1', 1000, { trash_bytes: 400, trash_files: 1, drive_files: 2, drive_trash_bytes: 50, pending_bytes: 8, pending_files: 1 }),
      row(null, 5000, { drive_files: 3 }),
    ];
    await store.refresh();
    const total = totalOf(store.getSnapshot().rows!);
    expect(total).toEqual({
      driveBytes: 6000,
      driveFiles: 5,
      trashBytes: 400,
      driveTrashBytes: 50,
      pendingBytes: 8,
      pendingFiles: 1,
      hiddenBytes: 5000,
    });
    expect(store.of('p1')?.drive_bytes).toBe(1000);
  });

  it('dos pedidos a la vez son uno solo', async () => {
    const { store, server } = await setup();
    store.configure(7);
    await Promise.all([store.refresh(), store.refresh(), store.refreshIfStale()]);
    expect(server.calls).toBe(1);
  });
});

describe('project_sizes en Supabase', () => {
  const remote = (answer: { data?: unknown; error?: { message: string; code?: string } | null; status?: number }) =>
    new SupabaseRemote({ rpc: async () => ({ data: null, error: null, status: 200, ...answer }) } as never);

  it('convierte cada campo a número (los bigint pueden llegar como texto)', async () => {
    const rows = await remote({
      data: [
        { project_id: 'p1', drive_bytes: '5000000000', drive_files: 2, trash_bytes: '7', trash_files: 1, drive_trash_bytes: 0, drive_trash_files: 0, pending_bytes: null, pending_files: 0 },
        { project_id: null, drive_bytes: 12, drive_files: 1, trash_bytes: 0, trash_files: 0, drive_trash_bytes: 0, drive_trash_files: 0, pending_bytes: 0, pending_files: 0 },
      ],
    }).projectSizes();
    expect(rows).toEqual([
      row('p1', 5000000000, { drive_files: 2, trash_bytes: 7, trash_files: 1 }),
      row(null, 12),
    ]);
  });

  it('sin la función en la base (PGRST202) da null; otro error tira', async () => {
    expect(await remote({ error: { message: 'Could not find the function', code: 'PGRST202' }, status: 404 }).projectSizes()).toBeNull();
    await expect(remote({ error: { message: 'boom', code: 'XX000' }, status: 500 }).projectSizes()).rejects.toThrow('boom');
  });
});

describe('formatSize', () => {
  it('una sola regla: un decimal por debajo de 100, sin ",0", en base 1024 y hasta TB', () => {
    const KB = 1024;
    const MB = 1024 ** 2;
    const GB = 1024 ** 3;
    const TB = 1024 ** 4;
    expect(formatSize(0.4 * KB, 'en')).toBe('0.4 KB');
    expect(formatSize(7, 'en')).toBe('0.1 KB');
    expect(formatSize(0, 'en')).toBe('0 KB');
    expect(formatSize(820 * KB, 'en')).toBe('820 KB');
    expect(formatSize(3 * MB, 'en')).toBe('3 MB');
    expect(formatSize(61.94 * MB, 'en')).toBe('61.9 MB');
    expect(formatSize(99.4 * MB, 'en')).toBe('99.4 MB');
    expect(formatSize(820 * MB, 'en')).toBe('820 MB');
    // Nunca "1000 MB" ni "1,024 MB": pasa a GB.
    expect(formatSize(999.7 * MB, 'en')).toBe('1 GB');
    expect(formatSize(3.4 * GB, 'en')).toBe('3.4 GB');
    expect(formatSize(30 * GB, 'en')).toBe('30 GB');
    expect(formatSize(1.2 * TB, 'en')).toBe('1.2 TB');
    expect(formatSize(1500 * TB, 'en')).toBe('1,500 TB');
    expect(formatSize(-1, 'en')).toBe('');
    expect(formatSize(Number.NaN, 'en')).toBe('');
  });

  it('en castellano, con coma decimal y punto de miles', () => {
    expect(formatSize(0.4 * 1024, 'es')).toBe('0,4 KB');
    expect(formatSize(61.94 * 1024 ** 2, 'es')).toBe('61,9 MB');
    expect(formatSize(3.4 * 1024 ** 3, 'es')).toBe('3,4 GB');
    expect(formatSize(30 * 1024 ** 3, 'es')).toBe('30 GB');
    expect(formatSize(1.2 * 1024 ** 4, 'es')).toBe('1,2 TB');
    expect(formatSize(1500 * 1024 ** 4, 'es')).toBe('1.500 TB');
  });
});
