import { describe, expect, it } from 'vitest';
import { MAX_ROWS_PER_REQUEST, SupabaseRemote, type FilesBySizeRemote } from '../sync/remote';
import { isNetworkError, RemoteError, type PageUseRow, type SizedFileRow } from '../sync/types';
import { bySize, FILES_BATCH, FilesBySize, isUnused, pagesOf, sizedKind } from './filesBySize';

// Los archivos de un proyecto por peso (P.8): lo que se le pide a la base (con un cliente en memoria que imita a
// PostgREST, su tope de 1000 filas por pedido y sus políticas) y la lista que arma el dispositivo de a tramos.

type Row = Record<string, unknown>;

/**
 * Un cliente de Supabase en memoria para `from(tabla)`: filtra, ordena y corta por rango como PostgREST, y nunca
 * devuelve más de `maxRows` filas en un pedido, pida lo que pida el rango. `policy` hace de Row Level Security: las
 * filas que no deja ver no existen para la consulta (ni cuentan para el rango).
 */
class FakePostgrest {
  /** Cada pedido: la tabla, cuántas filas pidió como mucho (`null`: sin tope propio) y cuántas volvieron. */
  readonly requests: { table: string; asked: number | null; returned: number }[] = [];
  rpcCalls = 0;
  /** Lo que contestan los próximos pedidos a esta tabla, en vez de filas. */
  fail: { table: string; message: string; code?: string; status: number } | null = null;

  constructor(
    readonly tables: Record<string, Row[]>,
    readonly policy: (table: string, row: Row) => boolean = () => true,
    readonly maxRows = 1000,
  ) {}

  rpc() {
    this.rpcCalls++;
    return Promise.resolve({ data: null, error: { message: 'la lista no llama funciones' }, status: 500 });
  }

  from(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    const orders: [string, boolean][] = [];
    let range: [number, number] | null = null;
    // El pedido pide el total (`count: 'exact'`): va con la respuesta, contado antes de recortar.
    let counted = false;
    const query = {
      select: (_columns: string, options?: { count?: string }) => ((counted = options?.count === 'exact'), query),
      eq: (column: string, value: unknown) => (filters.push((r) => r[column] === value), query),
      is: (column: string, value: null) => (filters.push((r) => (r[column] ?? null) === value), query),
      not: (column: string, operator: string, value: null) => {
        if (operator !== 'is') throw new Error(`operador sin simular: ${operator}`);
        filters.push((r) => (r[column] ?? null) !== value);
        return query;
      },
      in: (column: string, list: unknown[]) => (filters.push((r) => list.includes(r[column])), query),
      // Solo la forma que usa la lista: lo que sigue a un archivo en el orden (peso descendente, id).
      or: (text: string) => {
        // Y lo que sigue a una fila en un orden ascendente de dos columnas (los usos, por clave).
        const pair = /^(\w+)\.gt\."([^"]*)",and\((\w+)\.eq\."([^"]*)",(\w+)\.gt\."([^"]*)"\)$/.exec(text);
        if (pair && pair[1] === pair[3] && pair[2] === pair[4]) {
          const [, a, x, , , b, y] = pair;
          filters.push((r) => (r[a] as string) > x || (r[a] === x && (r[b] as string) > y));
          return query;
        }
        const m = /^size\.lt\.(\d+),and\(size\.eq\.(\d+),id\.gt\.([0-9a-f-]{36})\)$/.exec(text);
        if (!m || m[1] !== m[2]) throw new Error(`filtro sin simular: ${text}`);
        const size = Number(m[1]);
        filters.push((r) => Number(r.size) < size || (Number(r.size) === size && (r.id as string) > m[3]));
        return query;
      },
      limit: (count: number) => ((range = [0, count - 1]), query),
      order: (column: string, options?: { ascending?: boolean }) => (orders.push([column, options?.ascending !== false]), query),
      range: (from: number, to: number) => ((range = [from, to]), query),
      then: <T>(resolve: (value: { data: Row[] | null; error: unknown; status: number; count?: number | null }) => T) =>
        Promise.resolve(this.run(table, filters, orders, range, counted)).then(resolve),
    };
    return query;
  }

  private run(table: string, filters: ((r: Row) => boolean)[], orders: [string, boolean][], range: [number, number] | null, counted: boolean) {
    if (this.fail?.table === table) {
      const { message, code, status } = this.fail;
      return { data: null, error: { message, code }, status };
    }
    const rows = (this.tables[table] ?? [])
      .filter((r) => this.policy(table, r) && filters.every((f) => f(r)))
      .sort((a, b) => {
        for (const [column, ascending] of orders) {
          const x = a[column] as string | number;
          const y = b[column] as string | number;
          if (x !== y) return (x < y ? -1 : 1) * (ascending ? 1 : -1);
        }
        return 0;
      });
    const [from, to] = range ?? [0, Number.POSITIVE_INFINITY];
    const page = rows.slice(from, Math.min(to + 1, from + this.maxRows));
    this.requests.push({ table, asked: range ? range[1] - range[0] + 1 : null, returned: page.length });
    return { data: page, error: null, status: 200, count: counted ? rows.length : null };
  }
}

const MB = 1024 ** 2;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function file(n: number, size: number, extra: Row = {}): Row {
  return { id: id(n), project_id: 'p1', name: `${id(n)}.jpg`, mime: 'image/jpeg', size, thumb_at: null, drive_id: `drive-${id(n)}`, drive_trashed_at: null, trashed_at: null, ...extra };
}
const use = (pageId: string, n: number, extra: Row = {}): Row => ({ page_id: pageId, file_id: id(n), removed_at: null, is_foreign: false, ...extra });

/** `count` archivos de pesos distintos (el n-ésimo pesa menos que el anterior), cargados desordenados. */
function manyFiles(count: number): Row[] {
  const rows = Array.from({ length: count }, (_, n) => file(n, (count - n) * MB));
  return rows.sort((a, b) => ((a.id as string).slice(-1) < (b.id as string).slice(-1) ? -1 : 1));
}

const remoteOver = (db: FakePostgrest) => new SupabaseRemote(db as never);
const strictlyBySize = (rows: SizedFileRow[]) => rows.every((r, i) => i === 0 || bySize(rows[i - 1], r) < 0);

describe('lo que se le pide a la base', () => {
  it('solo lo del proyecto que ocupa lugar en el Drive, del más pesado al más liviano y por id a igual peso', async () => {
    const db = new FakePostgrest({
      files: [
        file(1, 5 * MB),
        file(2, 900 * MB, { mime: 'video/quicktime', name: 'toma.mov' }),
        // A igual peso gana el id menor; uno en la papelera de la app sigue ocupando lugar.
        file(4, 40 * MB),
        file(3, 40 * MB, { trashed_at: '2026-10-01T10:00:00Z' }),
        file(5, 999 * MB, { project_id: 'otro' }),
        file(6, 998 * MB, { drive_id: null }),
        file(7, 997 * MB, { drive_trashed_at: '2026-10-02T10:00:00Z', trashed_at: '2026-10-01T10:00:00Z' }),
      ],
    });
    const rows = await remoteOver(db).filesBySize('p1', null, 100);
    expect(rows.map((r) => r.id)).toEqual([id(2), id(3), id(4), id(1)]);
    expect(rows[0]).toEqual({ id: id(2), name: 'toma.mov', mime: 'video/quicktime', size: 900 * MB, thumb_at: null, trashed_at: null });
    expect(rows[1].trashed_at).toBe('2026-10-01T10:00:00Z');
    // El tramo corto no cierra la lista (la API podría haberlo recortado): la cierra un pedido más, que llega vacío.
    expect(db.requests).toEqual([{ table: 'files', asked: 100, returned: 4 }, { table: 'files', asked: 96, returned: 0 }]);
  });

  it('el peso llega como número aunque la base lo mande como texto', async () => {
    const db = new FakePostgrest({ files: [file(1, '5000000000' as never)] });
    expect((await remoteOver(db).filesBySize('p1', null, 10))[0].size).toBe(5_000_000_000);
  });

  it('pasado el tope de 1000 filas por pedido sigue pidiendo: 2500 archivos llegan los 2500, en orden', async () => {
    const db = new FakePostgrest({ files: manyFiles(2500) });
    const rows = await remoteOver(db).filesBySize('p1', null, 5000);
    expect(rows).toHaveLength(2500);
    expect(strictlyBySize(rows)).toBe(true);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2500);
    // Ningún pedido pidió más que el tope, y la lista la cierra una página vacía, no la corta.
    expect(db.requests.map((r) => r.asked)).toEqual([1000, 1000, 1000, 1000]);
    expect(db.requests.map((r) => r.returned)).toEqual([1000, 1000, 500, 0]);
    expect(MAX_ROWS_PER_REQUEST).toBe(1000);
  });

  it('un tramo de más adentro: después del archivo 999, los 100 que siguen', async () => {
    const db = new FakePostgrest({ files: manyFiles(2500) });
    const rows = await remoteOver(db).filesBySize('p1', { size: (2500 - 999) * MB, id: id(999) }, 100);
    expect(rows.map((r) => r.id)).toEqual(Array.from({ length: 100 }, (_, n) => id(1000 + n)));
  });

  it('a igual peso sigue por id: no repite ni saltea los que pesan lo mismo que el último', async () => {
    const db = new FakePostgrest({ files: [file(1, 9 * MB), file(2, 5 * MB), file(3, 5 * MB), file(4, 5 * MB), file(5, MB)] });
    const remote = remoteOver(db);
    const first = await remote.filesBySize('p1', null, 2);
    expect(first.map((r) => r.id)).toEqual([id(1), id(2)]);
    const next = await remote.filesBySize('p1', { size: first[1].size, id: first[1].id }, 10);
    expect(next.map((r) => r.id)).toEqual([id(3), id(4), id(5)]);
  });

  it('lo que va escrito en el filtro se revisa: un id o un peso con otra forma no llega a la base', async () => {
    const db = new FakePostgrest({ files: manyFiles(3) });
    await expect(remoteOver(db).filesBySize('p1', { size: MB, id: 'x),id.neq.(y' }, 10)).rejects.toThrow('bad_cursor');
    await expect(remoteOver(db).filesBySize('p1', { size: 1.5, id: id(1) }, 10)).rejects.toThrow('bad_cursor');
    expect(db.requests).toEqual([]);
  });

  it('los usos: de a 100 archivos y pasado el tope, sin los sacados; un archivo en 1500 páginas trae las 1500', async () => {
    const uses: Row[] = [];
    for (let p = 0; p < 1500; p++) uses.push(use(`page-${String(p).padStart(4, '0')}`, 0));
    for (let n = 1; n < 250; n++) uses.push(use('page-0000', n));
    uses.push(use('page-0001', 1, { removed_at: '2026-10-01T10:00:00Z' }));
    uses.push(use('page-9999', 9999));
    const db = new FakePostgrest({ page_files: uses });
    const rows = await remoteOver(db).fileUses(Array.from({ length: 250 }, (_, n) => id(n)));
    expect(rows.filter((r) => r.file_id === id(0))).toHaveLength(1500);
    expect(rows).toHaveLength(1500 + 249);
    expect(rows.every((r) => r.removed_at === null)).toBe(true);
    // Tres tandas de archivos; la primera necesita dos pedidos (1599 filas).
    expect(db.requests.map((r) => r.returned)).toEqual([1000, 599, 100, 50]);
    expect(await remoteOver(db).fileUses([])).toEqual([]);
  });

  it('lee las tablas con la sesión (sus políticas deciden): lo que no deja ver no llega ni deja huecos, y no llama funciones', async () => {
    const hidden = new Set([id(0), id(2)]);
    const db = new FakePostgrest(
      { files: manyFiles(6), page_files: [use('a', 0), use('a', 1), use('oculta', 1), use('a', 3)] },
      (table, row) => (table === 'files' ? !hidden.has(row.id as string) : row.page_id !== 'oculta'),
    );
    const remote = remoteOver(db);
    expect((await remote.filesBySize('p1', null, 3)).map((r) => r.id)).toEqual([id(1), id(3), id(4)]);
    expect((await remote.filesBySize('p1', { size: 2 * MB, id: id(4) }, 3)).map((r) => r.id)).toEqual([id(5)]);
    expect(await remote.fileUses([id(1), id(3)])).toEqual([
      { page_id: 'a', file_id: id(1), removed_at: null, is_foreign: false },
      { page_id: 'a', file_id: id(3), removed_at: null, is_foreign: false },
    ]);
    expect(db.rpcCalls).toBe(0);
    expect(new Set(db.requests.map((r) => r.table))).toEqual(new Set(['files', 'page_files']));
  });

  it('un error de la base tira; sin respuesta, es un error de red', async () => {
    const db = new FakePostgrest({ files: manyFiles(3) });
    db.fail = { table: 'files', message: 'permission denied for table files', code: '42501', status: 403 };
    await expect(remoteOver(db).filesBySize('p1', null, 10)).rejects.toThrow('permission denied');
    db.fail = { table: 'files', message: 'TypeError: Failed to fetch', status: 0 };
    const err = await remoteOver(db).filesBySize('p1', null, 10).catch((e: unknown) => e);
    expect(isNetworkError(err)).toBe(true);
  });
});

describe('la lista, de a tramos', () => {
  it('2500 archivos: primero los 100 más pesados, y tramo a tramo llegan todos, en orden y sin repetir', async () => {
    const db = new FakePostgrest({ files: manyFiles(2500), page_files: [use('a', 0), use('a', 2499)] });
    const list = new FilesBySize(remoteOver(db), 'p1');
    await list.loadMore();
    expect(list.getSnapshot().files.map((f) => f.id)).toEqual(Array.from({ length: FILES_BATCH }, (_, n) => id(n)));
    expect(list.getSnapshot().done).toBe(false);
    expect(list.getSnapshot().files[0].uses).toHaveLength(1);

    for (let i = 0; i < 40 && !list.getSnapshot().done; i++) await list.loadMore();
    const { files, done, failed } = list.getSnapshot();
    expect(done).toBe(true);
    expect(failed).toBeNull();
    expect(files).toHaveLength(2500);
    expect(strictlyBySize(files)).toBe(true);
    expect(files[2499].uses).toHaveLength(1);

    // Con todo adentro, pedir más no le pregunta nada a la base.
    const asked = db.requests.length;
    await list.loadMore();
    expect(db.requests.length).toBe(asked);
  });

  it('un tramo más grande que el tope no se corta en 1000 ni da la lista por terminada', async () => {
    const db = new FakePostgrest({ files: manyFiles(2500) });
    const list = new FilesBySize(remoteOver(db), 'p1', 1500);
    await list.loadMore();
    expect(list.getSnapshot().files).toHaveLength(1500);
    expect(list.getSnapshot().done).toBe(false);
    await list.loadMore();
    expect(list.getSnapshot().files).toHaveLength(2500);
    expect(list.getSnapshot().done).toBe(true);
  });

  it('un proyecto sin archivos: lista vacía y terminada, sin pedir usos', async () => {
    const db = new FakePostgrest({ files: [file(1, MB, { project_id: 'otro' })] });
    const list = new FilesBySize(remoteOver(db), 'p1');
    await list.loadMore();
    expect(list.getSnapshot()).toEqual({ files: [], loading: false, done: true, failed: null, error: null });
    expect(db.requests.map((r) => r.table)).toEqual(['files']);
  });

  it('sin red: queda lo que había y el aviso; al reintentar sigue donde estaba, sin saltear ni repetir', async () => {
    const db = new FakePostgrest({ files: manyFiles(250) });
    const list = new FilesBySize(remoteOver(db), 'p1');
    await list.loadMore();
    db.fail = { table: 'files', message: 'TypeError: Failed to fetch', status: 0 };
    await list.loadMore();
    expect(list.getSnapshot().failed).toBe('offline');
    expect(list.getSnapshot().files).toHaveLength(100);
    expect(list.getSnapshot().loading).toBe(false);

    db.fail = null;
    await list.loadMore();
    await list.loadMore();
    const { files, done, failed } = list.getSnapshot();
    expect(failed).toBeNull();
    expect(done).toBe(true);
    expect(files.map((f) => f.id)).toEqual(Array.from({ length: 250 }, (_, n) => id(n)));
  });

  it('si fallan los usos, el tramo no se muestra a medias: se vuelve a pedir entero', async () => {
    const db = new FakePostgrest({ files: manyFiles(3), page_files: [use('a', 1)] });
    const list = new FilesBySize(remoteOver(db), 'p1');
    db.fail = { table: 'page_files', message: 'boom', code: 'XX000', status: 500 };
    await list.loadMore();
    expect(list.getSnapshot()).toMatchObject({ files: [], done: false, failed: 'error', error: 'boom' });
    db.fail = null;
    await list.loadMore();
    expect(list.getSnapshot().files.map((f) => [f.id, f.uses.length])).toEqual([[id(0), 0], [id(1), 1], [id(2), 0]]);
    expect(list.getSnapshot().failed).toBeNull();
  });

  it('dos pedidos a la vez son uno, y avisa a quien escucha', async () => {
    const db = new FakePostgrest({ files: manyFiles(5) });
    const list = new FilesBySize(remoteOver(db), 'p1');
    let changes = 0;
    const stop = list.subscribe(() => changes++);
    await Promise.all([list.loadMore(), list.loadMore(), list.loadMore()]);
    // Un solo tramo: su pedido y el que confirma que no hay más (vacío).
    expect(db.requests.filter((r) => r.table === 'files').map((r) => r.returned)).toEqual([5, 0]);
    expect(changes).toBeGreaterThanOrEqual(2);
    stop();
  });

  it('si entre dos tramos un archivo sale del conjunto o entra uno más pesado, no se saltea ni se repite ninguno', async () => {
    const db = new FakePostgrest({ files: manyFiles(6) });
    const list = new FilesBySize(remoteOver(db), 'p1', 2);
    await list.loadMore();
    expect(list.getSnapshot().files.map((f) => f.id)).toEqual([id(0), id(1)]);
    // El primero se mandó a la papelera de Drive (por desplazamiento, el tercero quedaría salteado) y entró uno más
    // pesado que todos (por desplazamiento, el segundo llegaría de nuevo).
    db.tables.files.find((r) => r.id === id(0))!.drive_trashed_at = '2026-10-06T10:00:00Z';
    db.tables.files.push(file(77, 500 * MB));
    await list.loadMore();
    expect(list.getSnapshot().files.map((f) => f.id)).toEqual([id(0), id(1), id(2), id(3)]);
    await list.loadMore();
    await list.loadMore();
    expect(list.getSnapshot().files.map((f) => f.id)).toEqual([id(0), id(1), id(2), id(3), id(4), id(5)]);
    expect(list.getSnapshot().done).toBe(true);
  });

  it('cada tramo sigue desde el último archivo del anterior', async () => {
    const asked: (string | null)[] = [];
    const remote: FilesBySizeRemote = {
      filesBySize: async (_project, after) => {
        asked.push(after && `${after.size}:${after.id}`);
        return after ? [] : [sized(1, 50), sized(2, 40)];
      },
      fileUses: async () => [],
    };
    const list = new FilesBySize(remote, 'p1', 2);
    await list.loadMore();
    await list.loadMore();
    expect(asked).toEqual([null, `${40 * MB}:${id(2)}`]);
  });

  it('una fila que vuelve a llegar (su peso cambió entre dos tramos) no se repite y el orden se mantiene', async () => {
    const rows: SizedFileRow[][] = [
      [sized(1, 50), sized(2, 40)],
      // La carpeta 2 creció y volvió a llegar.
      [sized(2, 40), sized(3, 30)],
      [sized(9, 45)],
    ];
    let call = 0;
    const remote: FilesBySizeRemote = {
      filesBySize: async () => rows[call++] ?? [],
      fileUses: async () => [],
    };
    const list = new FilesBySize(remote, 'p1', 2);
    await list.loadMore();
    await list.loadMore();
    await list.loadMore();
    expect(list.getSnapshot().files.map((f) => f.id)).toEqual([id(1), id(9), id(2), id(3)]);
    expect(list.getSnapshot().done).toBe(true);
  });

  it('un error que no es de red dice cuál', async () => {
    const remote: FilesBySizeRemote = {
      filesBySize: async () => {
        throw new RemoteError('statement timeout', false, '57014');
      },
      fileUses: async () => [],
    };
    const list = new FilesBySize(remote, 'p1');
    await list.loadMore();
    expect(list.getSnapshot()).toMatchObject({ failed: 'error', error: 'statement timeout', loading: false, done: false });
  });
});

function sized(n: number, mb: number, extra: Partial<SizedFileRow> = {}): SizedFileRow {
  return { id: id(n), name: `${id(n)}.jpg`, mime: 'image/jpeg', size: mb * MB, thumb_at: null, trashed_at: null, ...extra };
}

describe('lo que se muestra de cada archivo', () => {
  it('el orden: por peso y, a igual peso, por id', () => {
    const rows = [sized(3, 10), sized(1, 10), sized(2, 99), sized(4, 1)];
    expect(rows.sort(bySize).map((r) => r.id)).toEqual([id(2), id(1), id(3), id(4)]);
  });

  it('el tipo: foto, video, carpeta o archivo', () => {
    expect(sizedKind({ mime: 'image/jpeg', name: 'a.jpg' })).toBe('photo');
    expect(sizedKind({ mime: 'video/quicktime', name: 'a.mov' })).toBe('video');
    expect(sizedKind({ mime: 'inode/directory', name: 'Rodaje' })).toBe('folder');
    expect(sizedKind({ mime: 'application/pdf', name: 'a.pdf' })).toBe('file');
    expect(sizedKind({ mime: 'application/octet-stream', name: 'plano.mp4' })).toBe('video');
  });

  it('sin uso: lo dice la base (`trashed_at`), no las páginas que se ven', () => {
    expect(isUnused(sized(1, 1, { trashed_at: '2026-10-01T10:00:00Z' }))).toBe(true);
    expect(isUnused(sized(1, 1))).toBe(false);
  });

  it('las páginas para el link: las que el dispositivo conoce, primero las vivas, sin los usos sacados ni repetidas', () => {
    const pages: Record<string, { id: string; title: string; workspace_id: string }> = {
      b: { id: 'b', title: 'Escena 2', workspace_id: 'p1' },
      a: { id: 'a', title: 'Escena 1', workspace_id: 'p1' },
      t: { id: 't', title: 'Borrador', workspace_id: 'p1' },
      x: { id: 'x', title: 'De otro proyecto', workspace_id: 'p2' },
      r: { id: 'r', title: 'Ya no lo usa', workspace_id: 'p1' },
    };
    const tree = { get: (pageId: string) => pages[pageId] as never, isTrashed: (pageId: string) => pageId === 't' };
    const uses: PageUseRow[] = [
      { page_id: 't', file_id: 'f' },
      { page_id: 'b', file_id: 'f' },
      { page_id: 'a', file_id: 'f' },
      { page_id: 'a', file_id: 'f' },
      { page_id: 'x', file_id: 'f', is_foreign: true },
      { page_id: 'r', file_id: 'f', removed_at: '2026-10-01T10:00:00Z' },
      { page_id: 'no-la-conoce', file_id: 'f' },
    ];
    expect(pagesOf(uses, tree)).toEqual([
      { id: 'x', title: 'De otro proyecto', projectId: 'p2', inTrash: false },
      { id: 'a', title: 'Escena 1', projectId: 'p1', inTrash: false },
      { id: 'b', title: 'Escena 2', projectId: 'p1', inTrash: false },
      { id: 't', title: 'Borrador', projectId: 'p1', inTrash: true },
    ]);
    expect(pagesOf([], tree)).toEqual([]);
  });
});
