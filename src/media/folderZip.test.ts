import { describe, expect, it, vi } from 'vitest';
import { BlobSink, canRetry, MemoryCapExceeded, MISSING_NAME, planFolder, planRetry, refreshPass, runDownload, type DownloadPlan, type DownloadTarget, type FileOut, type FolderLister, type MissingItem } from './folderZip';
import { PorteroError, type FolderEntry, type FolderListing, type FolderListingMany } from './portero';
import { concat, hasPython, pythonReadZip, text } from '../test/zipCheck';

// "Download all" (P.9, entrega 2, Docs/Doc_Carpetas.md, sección 9): recorrer la carpeta con `/folder/list` y bajar
// cada archivo por su pase a un zip o a una carpeta, con un portero y un Drive de mentira.

type Tree = { [name: string]: Tree | string | { shortcut: true } | { google: true } };

/**
 * Un Drive de mentira detrás de un portero de mentira: `folderList` como el de verdad (de a `page` por pedido,
 * primero las carpetas) y los pases `https://portero.test/m/<id>` que sirve `fetch`.
 */
function world(tree: Tree, opts: { page?: number } = {}) {
  const dirs = new Map<string | null, FolderEntry[]>();
  const files = new Map<string, Uint8Array>();
  let n = 0;
  const build = (id: string | null, node: Tree) => {
    const folders: FolderEntry[] = [];
    const rest: FolderEntry[] = [];
    for (const [name, child] of Object.entries(node)) {
      const key = `d${++n}`;
      if (typeof child === 'string') {
        const data = new TextEncoder().encode(child);
        files.set(key, data);
        rest.push({ type: 'file', id: key, name, mime: 'text/plain', size: data.length, modified: '2026-10-01T10:00:00Z', url: `https://portero.test/m/${key}`, thumb: null });
      } else if ('shortcut' in child) rest.push({ type: 'shortcut', name, modified: null });
      else if ('google' in child) rest.push({ type: 'google', name, mime: 'application/vnd.google-apps.document', modified: null });
      else {
        folders.push({ type: 'folder', id: key, name, modified: '2026-10-01T09:00:00Z' });
        build(key, child as Tree);
      }
    }
    dirs.set(id, [...folders, ...rest]);
  };
  build(null, tree);
  const listed: (string | null)[] = [];
  const page = opts.page ?? 100;
  const failList = new Set<string>();
  let rateOnce = new Set<string | null>();
  const lister: FolderLister = {
    async folderList(file, dir = null, token = null): Promise<FolderListing> {
      expect(file).toBe('carpeta-1');
      if (dir && failList.has(dir)) throw new PorteroError('This folder does not exist or you cannot see it.', 404, false, 'not_found');
      if (rateOnce.has(dir)) {
        rateOnce.delete(dir);
        throw new PorteroError('Google Drive asked to slow down', 503, true, 'rate');
      }
      listed.push(dir);
      const all = dirs.get(dir);
      if (!all) throw new PorteroError('This folder does not exist or you cannot see it.', 404, false, 'not_found');
      const from = Number(token ?? 0);
      return { entries: all.slice(from, from + page), nextPageToken: from + page < all.length ? String(from + page) : null };
    },
  };
  /**
   * El mismo Drive detrás de un portero que lista varias subcarpetas por pedido (`folderListDirs`, como
   * portero/src/core.ts): `page` cosas en total por pedido, agrupadas por padre; `cap` subcarpetas por pedido (el
   * resto vuelve en `later`); `old`: un portero anterior (no devuelve `lists`); `err`: el código del error de
   * ese pedido (el número de pedido, desde 1), o `null`; `partial`: en una página siguiente, las que el portero deja
   * para después o da por perdidas (sin nada de ellas en `lists`; la consulta sigue con todas, como Drive).
   */
  const cfg: {
    page: number;
    cap: number;
    old: boolean;
    err: (n: number, ids: string[], token: string | null) => string | null;
    partial: (n: number, ids: string[], token: string) => { later?: string[]; failed?: Record<string, string> } | null;
  } = {
    page: 100,
    cap: Infinity,
    old: false,
    err: () => null,
    partial: () => null,
  };
  const manyLog: { ids: string[]; token: string | null; skip: string[] }[] = [];
  const listerDirs: FolderLister = {
    folderList: lister.folderList,
    async folderListDirs(file, ids, token = null, skip = []): Promise<FolderListingMany | null> {
      expect(file).toBe('carpeta-1');
      manyLog.push({ ids, token, skip });
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.length).toBeLessThanOrEqual(40);
      const code = cfg.err(manyLog.length, ids, token);
      if (code) throw new PorteroError('boom', code === 'rate' ? 503 : 502, code === 'rate', code);
      if (cfg.old) return null;
      const failed: Record<string, string> = {};
      const later: string[] = [];
      let accepted: string[] = [];
      if (!token) {
        for (const id of ids) {
          if (failList.has(id) || !dirs.has(id)) failed[id] = 'not_found';
          else if (accepted.length >= cfg.cap) later.push(id);
          else accepted.push(id);
        }
      } else accepted = ids;
      const flat = accepted.flatMap((id) => dirs.get(id)!.map((e) => [id, e] as const));
      const from = Number(token ?? 0);
      const lists: Record<string, FolderEntry[]> = Object.fromEntries(accepted.filter((id) => !skip.includes(id)).map((id) => [id, []]));
      for (const [id, e] of flat.slice(from, from + cfg.page)) lists[id]?.push(e);
      const out = token ? cfg.partial(manyLog.length, ids, token) : null;
      for (const id of out?.later ?? []) {
        delete lists[id];
        later.push(id);
      }
      for (const [id, code] of Object.entries(out?.failed ?? {})) {
        delete lists[id];
        failed[id] = code;
      }
      return { lists, failed, later, nextPageToken: from + cfg.page < flat.length ? String(from + cfg.page) : null };
    },
  };
  const requests: { id: string; range: string | null; offline: boolean }[] = [];
  /** Sin internet (el wifi conectado, el navegador dice que hay red): todo pedido falla como `fetch`. */
  let down: (() => boolean) | null = null;
  let health = 0;
  /** Lo que hace cada pedido de un archivo: cortarse en el medio, fallar, un pase vencido… */
  const behave = new Map<string, (range: string | null, count: number) => Response | 'normal'>();
  const counts = new Map<string, number>();
  const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const signal = init.signal;
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    if (down?.()) throw new TypeError('Failed to fetch');
    if (url.endsWith('/health')) {
      health++;
      return new Response('{"ok":true}', { status: 200 });
    }
    const id = /\/m\/([^?]+)/.exec(url)?.[1] ?? '';
    const range = new Headers(init.headers).get('Range');
    requests.push({ id, range, offline: new URL(url).searchParams.get('offline') === '1' });
    const count = (counts.get(id) ?? 0) + 1;
    counts.set(id, count);
    const special = behave.get(id)?.(range, count);
    if (special && special !== 'normal') return special;
    const data = files.get(id.replace(/-new$/, ''));
    if (!data) return new Response(JSON.stringify({ error: 'This file is not in Google Drive anymore.', code: 'drive_missing' }), { status: 404 });
    const from = Number(/^bytes=(\d+)-$/.exec(range ?? '')?.[1] ?? 0);
    const body = data.subarray(from);
    return new Response(body as Uint8Array<ArrayBuffer>, {
      status: from ? 206 : 200,
      headers: { 'Content-Length': String(body.length), ...(from ? { 'Content-Range': `bytes ${from}-${data.length - 1}/${data.length}` } : {}) },
    });
  }) as typeof fetch;
  return {
    lister,
    listerDirs,
    cfg,
    manyLog,
    fetcher,
    files,
    listed,
    requests,
    behave,
    failList,
    setRate: (ids: (string | null)[]) => (rateOnce = new Set(ids)),
    setDown: (fn: (() => boolean) | null) => (down = fn),
    health: () => health,
    idOf: (name: string) => ([...dirs.values()].flat().find((e) => e.name === name && 'id' in e) as { id: string }).id,
  };
}

const noWait = async () => undefined;
const missingText = (items: MissingItem[]) => items.map((i) => `${i.path}\t${i.reason}${i.detail ? `\t${i.detail}` : ''}`).join('\n');

/** Un cuerpo que entrega `first` bytes y se corta (como una red que se cae). */
function cutResponse(data: Uint8Array, first: number, status = 200, from = 0): Response {
  let sent = false;
  const body = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (!sent) {
        sent = true;
        ctrl.enqueue(data.slice(from, from + first));
      } else ctrl.error(new TypeError('network error'));
    },
  });
  return new Response(body, {
    status,
    headers: { 'Content-Length': String(data.length - from), ...(from ? { 'Content-Range': `bytes ${from}-${data.length - 1}/${data.length}` } : {}) },
  });
}

const TREE: Tree = {
  Fotos: { 'Dia 2': { 'a.jpg': 'AAAA', 'B.jpg': 'BB' }, 'b.jpg': 'bbb', 'portada.png': 'png' },
  Notas: { 'guion.txt': 'INT. PUERTO - DÍA', 'lista.txt': 'lista' },
  Vacia: {},
  'Acceso a otra cosa': { shortcut: true },
  'Plan de rodaje': { google: true },
  'leeme.txt': 'hola',
};

async function zipOf(plan: DownloadPlan, w: ReturnType<typeof world>, extra: Partial<Parameters<typeof runDownload>[2]> = {}, signal?: AbortSignal, retry = false) {
  const sink = new BlobSink();
  const result = await runDownload(plan, { kind: 'zip', sink }, { fetch: w.fetcher, wait: noWait, online: () => true, missingText, ...extra }, { signal, retry });
  return { result, bytes: new Uint8Array(await sink.blob().arrayBuffer()) };
}

describe('Download all: recorrer la carpeta', () => {
  it('lista el árbol entero (páginas de a pocos, subcarpetas, vacías) y separa lo que no se baja', async () => {
    const w = world(TREE, { page: 2 });
    const seen: number[] = [];
    const plan = await planFolder(w.lister, 'carpeta-1', 'Referencias', { onProgress: (p) => seen.push(p.files) });
    expect(plan.root).toBe('Referencias');
    expect(plan.dirs.map((d) => d.path)).toEqual(['Fotos', 'Fotos/Dia 2', 'Notas', 'Vacia']);
    expect(plan.files.map((f) => f.path)).toEqual(['Fotos/Dia 2/a.jpg', 'Fotos/Dia 2/B.jpg', 'Fotos/b.jpg', 'Fotos/portada.png', 'Notas/guion.txt', 'Notas/lista.txt', 'leeme.txt']);
    expect(plan.skipped).toEqual([
      { path: 'Acceso a otra cosa', reason: 'shortcut' },
      { path: 'Plan de rodaje', reason: 'google' },
    ]);
    expect(plan.bytes).toBe(4 + 2 + 3 + 3 + 'INT. PUERTO - DÍA'.length + 1 + 5 + 4);
    expect(seen.at(-1)).toBe(7);
    // Cada subcarpeta se pidió por su id (nunca otra cosa que lo que dio el portero).
    expect(new Set(w.listed).size).toBe(5);
  });

  it('nombres repetidos por mayúsculas y nombres que no van en el disco; la lista de lo que falta tiene su lugar', async () => {
    const w = world({ 'Foto.JPG': '1', 'foto.jpg': '2', 'CON': { 'a.txt': 'x' }, 'con': {}, '..': 'p', 'MISSING_FILES.txt': 'mío', 'fin.': 'f' });
    const plan = await planFolder(w.lister, 'carpeta-1', 'Día 2: Puerto?');
    expect(plan.root).toBe('Día 2_ Puerto_');
    expect(plan.dirs.map((d) => d.path)).toEqual(['_CON', '_con (2)']);
    expect(plan.files.map((f) => f.path)).toEqual(['_CON/a.txt', 'Foto.JPG', 'foto (2).jpg', '_', 'MISSING_FILES (2).txt', 'fin']);
  });

  it('Drive pide ir más despacio: espera y sigue; una subcarpeta que no se puede listar queda anotada y el resto se baja', async () => {
    const w = world(TREE);
    w.setRate([null, w.idOf('Fotos')]);
    w.failList.add(w.idOf('Notas'));
    const waits: number[] = [];
    const plan = await planFolder(w.lister, 'carpeta-1', 'Referencias', { wait: async (ms) => void waits.push(ms) });
    expect(waits).toEqual([5000, 5000]);
    expect(plan.files.map((f) => f.path)).toEqual(['Fotos/Dia 2/a.jpg', 'Fotos/Dia 2/B.jpg', 'Fotos/b.jpg', 'Fotos/portada.png', 'leeme.txt']);
    expect(plan.skipped[0]).toEqual({ path: 'Notas/', reason: 'folder', detail: 'not_found', dirId: w.idOf('Notas') });
  });

  it('sin poder listar la carpeta misma, falla con el error del portero', async () => {
    const lister: FolderLister = {
      folderList: async () => {
        throw new PorteroError('This folder does not exist or you cannot see it.', 404, false, 'not_found');
      },
    };
    await expect(planFolder(lister, 'carpeta-1', 'X')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('Download all: el zip', () => {
  it('baja todo en orden adentro de la carpeta, con las vacías, y lo que no se baja va en MISSING_FILES.txt', async () => {
    const w = world(TREE);
    const plan = await planFolder(w.lister, 'carpeta-1', 'Referencias');
    const progress: number[] = [];
    const sink = new BlobSink();
    const result = await runDownload(plan, { kind: 'zip', sink }, { fetch: w.fetcher, wait: noWait, online: () => true, missingText }, { onProgress: (p) => progress.push(p.filesDone) });
    expect(result.done).toBe(7);
    expect(result.missing.map((m) => m.reason)).toEqual(['shortcut', 'google']);
    expect(progress.at(-1)).toBe(7);
    const bytes = new Uint8Array(await sink.blob().arrayBuffer());
    if (!hasPython) return;
    const py = pythonReadZip(bytes);
    expect(py.bad).toBeNull();
    expect(py.entries.map((e) => e.name)).toEqual([
      'Referencias/',
      'Referencias/Fotos/',
      'Referencias/Fotos/Dia 2/',
      'Referencias/Notas/',
      'Referencias/Vacia/',
      'Referencias/Fotos/Dia 2/a.jpg',
      'Referencias/Fotos/Dia 2/B.jpg',
      'Referencias/Fotos/b.jpg',
      'Referencias/Fotos/portada.png',
      'Referencias/Notas/guion.txt',
      'Referencias/Notas/lista.txt',
      'Referencias/leeme.txt',
      `Referencias/${MISSING_NAME}`,
    ]);
    expect(text(py.entries.find((e) => e.name.endsWith('guion.txt')))).toBe('INT. PUERTO - DÍA');
    expect(text(py.entries.at(-1))).toBe('Acceso a otra cosa\tshortcut\nPlan de rodaje\tgoogle');
  });

  it('un archivo que falla se saltea y se anota; los demás se bajan', async () => {
    const w = world({ 'a.txt': 'aaa', 'b.txt': 'bbb', 'c.txt': 'ccc' });
    const plan = await planFolder(w.lister, 'carpeta-1', 'X');
    w.files.delete(w.idOf('b.txt'));
    w.behave.set(w.idOf('c.txt'), () => new Response(JSON.stringify({ code: 'abusive' }), { status: 403 }));
    const { result, bytes } = await zipOf(plan, w);
    expect(result.done).toBe(1);
    expect(result.missing).toEqual([
      { path: 'b.txt', reason: 'failed', detail: 'drive_missing' },
      { path: 'c.txt', reason: 'failed', detail: 'abusive' },
    ]);
    if (!hasPython) return;
    const py = pythonReadZip(bytes);
    expect(py.bad).toBeNull();
    expect(py.entries.map((e) => e.name)).toEqual(['X/', 'X/a.txt', `X/${MISSING_NAME}`]);
    expect(text(py.entries[2])).toBe('b.txt\tfailed\tdrive_missing\nc.txt\tfailed\tabusive');
  });

  it('un servidor que contesta 502 se reintenta; si sigue, se saltea', async () => {
    const w = world({ 'a.txt': 'aaa', 'b.txt': 'bbb' });
    const plan = await planFolder(w.lister, 'carpeta-1', 'X');
    w.behave.set(w.idOf('a.txt'), (_r, count) => (count < 3 ? new Response('{}', { status: 502 }) : 'normal'));
    w.behave.set(w.idOf('b.txt'), () => new Response('{}', { status: 503 }));
    const { result } = await zipOf(plan, w);
    expect(result.done).toBe(1);
    expect(result.missing).toEqual([{ path: 'b.txt', reason: 'failed', detail: 'The media server answered 503.' }]);
    expect(w.requests.filter((r) => r.id === w.idOf('b.txt')).length).toBe(4);
  });

  it('un archivo grande que se corta en el medio sigue desde donde quedó (Range) y queda entero', async () => {
    const big = 'x'.repeat(3000) + 'y'.repeat(3000);
    const w = world({ 'grande.mov': big, 'chico.txt': 'ok' });
    const plan = await planFolder(w.lister, 'carpeta-1', 'X');
    const data = w.files.get(w.idOf('grande.mov'))!;
    w.behave.set(w.idOf('grande.mov'), (_range, count) => (count === 1 ? cutResponse(data, 1000) : count === 2 ? cutResponse(data, 2000, 206, 1000) : 'normal'));
    // Un peso de más de 4 MiB en el plan: va de a pedazos (no se pide entero por delante), como un video.
    const { result, bytes } = await zipOf({ ...plan, files: plan.files.map((f, i) => (i === 0 ? { ...f, size: 5 * 1024 * 1024 } : f)) }, w);
    expect(result.done).toBe(2);
    expect(result.missing).toEqual([]);
    expect(w.requests.filter((r) => r.id === w.idOf('grande.mov')).map((r) => r.range)).toEqual([null, 'bytes=1000-', 'bytes=3000-']);
    if (!hasPython) return;
    const py = pythonReadZip(bytes);
    expect(py.bad).toBeNull();
    expect(text(py.entries[1])).toBe(big);
  });

  it('un 206 más corto que lo pedido (el arranque de los videos guardado en el portero) se sigue pidiendo', async () => {
    const big = 'z'.repeat(5000);
    const w = world({ 'video.mov': big });
    const plan = await planFolder(w.lister, 'carpeta-1', 'X');
    const data = w.files.get(w.idOf('video.mov'))!;
    // Se corta a los 1000; al retomar, el portero da solo lo que tiene guardado (hasta 1200) y después, el resto.
    w.behave.set(w.idOf('video.mov'), (range) =>
      range === null
        ? cutResponse(data, 1000)
        : range === 'bytes=1000-'
          ? new Response(data.slice(1000, 1200), { status: 206, headers: { 'Content-Length': '200', 'Content-Range': 'bytes 1000-1199/5000' } })
          : 'normal',
    );
    const { result, bytes } = await zipOf({ ...plan, files: plan.files.map((f) => ({ ...f, size: 5000 })) }, w);
    expect(result.missing).toEqual([]);
    expect(w.requests.map((r) => r.range)).toEqual([null, 'bytes=1000-', 'bytes=1200-']);
    // Una bajada entera no pasa por la caché del arranque de los videos del portero (O8).
    expect(w.requests.every((r) => r.offline)).toBe(true);
    if (hasPython) expect(text(pythonReadZip(bytes).entries[1])).toBe(big);
  });

  it('un archivo que se corta y no vuelve queda en el zip con lo que llegó, anotado como incompleto', async () => {
    const w = world({ 'roto.mov': 'r'.repeat(4000) });
    const plan = await planFolder(w.lister, 'carpeta-1', 'X');
    const data = w.files.get(w.idOf('roto.mov'))!;
    w.behave.set(w.idOf('roto.mov'), (_range, count) => (count === 1 ? cutResponse(data, 1500) : new Response('{}', { status: 502 })));
    const { result, bytes } = await zipOf({ ...plan, files: plan.files.map((f) => ({ ...f, size: 5 * 1024 * 1024 })) }, w);
    expect(result.done).toBe(0);
    expect(result.missing).toEqual([{ path: 'roto.mov', reason: 'incomplete', detail: '1500 of 4000 bytes' }]);
    if (!hasPython) return;
    const py = pythonReadZip(bytes);
    expect(py.bad).toBeNull();
    expect(py.entries.map((e) => [e.name, e.size])).toEqual([
      ['X/', 0],
      ['X/roto.mov', 1500],
      [`X/${MISSING_NAME}`, 'roto.mov\tincomplete\t1500 of 4000 bytes'.length],
    ]);
  });

  it('un pase vencido (bajada de más de 8 horas): vuelve a listar la subcarpeta y sigue con el nuevo', async () => {
    const w = world({ Fotos: { 'a.jpg': 'AAA' } });
    const plan = await planFolder(w.lister, 'carpeta-1', 'X');
    const id = w.idOf('a.jpg');
    w.behave.set(id, (_r, count) => (count === 1 ? new Response(JSON.stringify({ code: 'pass_expired' }), { status: 403 }) : 'normal'));
    const lister = w.lister;
    const { result } = await zipOf(plan, w, { refresh: (f) => refreshPass(lister, 'carpeta-1', f) });
    expect(result.done).toBe(1);
    expect(w.listed.filter((d) => d === w.idOf('Fotos')).length).toBe(2);
  });

  it('sin conexión espera a que vuelva, sin gastar reintentos', async () => {
    const w = world({ 'a.txt': 'aaa' });
    const plan = await planFolder(w.lister, 'carpeta-1', 'X');
    let online = false;
    const states: boolean[] = [];
    const sink = new BlobSink();
    const result = await runDownload(
      plan,
      { kind: 'zip', sink },
      {
        fetch: w.fetcher,
        wait: noWait,
        online: () => online,
        whenOnline: async () => {
          online = true;
        },
        missingText,
      },
      { onProgress: (p) => states.push(p.offline) },
    );
    expect(result.done).toBe(1);
    expect(states).toContain(true);
    expect(states.at(-1)).toBe(false);
  });

  it('cancelar corta en el acto (AbortError) y no pide nada más', async () => {
    const w = world({ 'a.txt': 'a'.repeat(100), 'b.txt': 'b', 'c.txt': 'c' });
    const plan = await planFolder(w.lister, 'carpeta-1', 'X');
    const ctrl = new AbortController();
    const sink = new BlobSink();
    const run = runDownload(plan, { kind: 'zip', sink }, { fetch: w.fetcher, wait: noWait, online: () => true, missingText }, {
      signal: ctrl.signal,
      onProgress: (p) => {
        if (p.filesDone === 1) ctrl.abort();
      },
    });
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    const before = w.requests.length;
    await new Promise((r) => setTimeout(r, 20));
    expect(w.requests.length).toBe(before);
  });

  it('los archivos chicos se piden por delante (de a varios) y se escriben en orden', async () => {
    const tree: Tree = {};
    for (let i = 1; i <= 12; i++) tree[`f${String(i).padStart(2, '0')}.txt`] = `contenido ${i}`;
    const w = world(tree);
    const plan = await planFolder(w.lister, 'carpeta-1', 'X');
    const { result, bytes } = await zipOf(plan, w);
    expect(result.done).toBe(12);
    if (!hasPython) return;
    const py = pythonReadZip(bytes);
    expect(py.entries.slice(1).map((e) => text(e))).toEqual(Array.from({ length: 12 }, (_, i) => `contenido ${i + 1}`));
  });
});

describe('Download all: correcciones de la auditoría', () => {
  it('O1: el wifi conectado sin internet (el navegador dice que hay red): espera diciendo "No connection" y no saltea nada', async () => {
    const tree: Tree = {};
    for (let i = 1; i <= 6; i++) tree[`f${i}.txt`] = `archivo ${i}`;
    const w = world(tree);
    const plan = await planFolder(w.lister, 'carpeta-1', 'X');
    // Los primeros 40 pedidos fallan como `fetch` sin internet: más que los 4 intentos de cada uno de los 6 archivos.
    let calls = 0;
    w.setDown(() => calls++ < 40);
    const states: boolean[] = [];
    const sink = new BlobSink();
    const result = await runDownload(
      plan,
      { kind: 'zip', sink },
      {
        fetch: w.fetcher,
        wait: noWait,
        online: () => true,
        whenOnline: () => new Promise(() => undefined),
        probeMs: 1,
        missingText,
      },
      { onProgress: (p) => states.push(p.offline) },
    );
    expect(result.missing).toEqual([]);
    expect(result.done).toBe(6);
    expect(states).toContain(true);
    expect(states.at(-1)).toBe(false);
  });

  it('O1: un archivo que se corta a mitad sin internet espera y sigue desde donde quedó', async () => {
    const big = 'q'.repeat(4000);
    const w = world({ 'video.mov': big });
    const plan = await planFolder(w.lister, 'carpeta-1', 'X');
    const data = w.files.get(w.idOf('video.mov'))!;
    let cut = false;
    let downFor = 0;
    w.behave.set(w.idOf('video.mov'), (_r, count) => {
      if (count === 1) {
        cut = true;
        return cutResponse(data, 1500);
      }
      return 'normal';
    });
    // Después del corte, 10 pedidos fallan como sin internet (más que los 4 intentos de un archivo).
    w.setDown(() => cut && downFor++ < 10);
    const { result, bytes } = await zipOf({ ...plan, files: plan.files.map((f) => ({ ...f, size: 5 * 1024 * 1024 })) }, w, {
      whenOnline: () => new Promise(() => undefined),
      probeMs: 1,
    });
    expect(result.missing).toEqual([]);
    if (hasPython) expect(text(pythonReadZip(bytes).entries[1])).toBe(big);
  });

  it('O1: si el portero contesta, un fetch que falla es de ese archivo: gasta intentos y se saltea (no espera para siempre)', async () => {
    const w = world({ 'a.txt': 'aaa', 'b.txt': 'bbb' });
    const plan = await planFolder(w.lister, 'carpeta-1', 'X');
    const id = w.idOf('a.txt');
    w.behave.set(id, () => {
      throw new TypeError('Failed to fetch');
    });
    const { result } = await zipOf(plan, w, { whenOnline: () => new Promise(() => undefined), probeMs: 1 });
    expect(result.done).toBe(1);
    expect(result.missing).toEqual([{ path: 'a.txt', reason: 'failed', detail: 'Failed to fetch' }]);
    expect(w.health()).toBeGreaterThanOrEqual(4);
  });

  it('O10: un pase que vence entre un corte y el pedido que sigue se renueva y el archivo queda entero', async () => {
    const big = 'p'.repeat(3000);
    const w = world({ Fotos: { 'largo.mov': big } });
    const plan = await planFolder(w.lister, 'carpeta-1', 'X');
    const id = w.idOf('largo.mov');
    const data = w.files.get(id)!;
    w.behave.set(id, (_range, count) =>
      count === 1 ? cutResponse(data, 1000) : count === 2 ? new Response(JSON.stringify({ code: 'pass_expired' }), { status: 403 }) : 'normal',
    );
    const lister = w.lister;
    const { result, bytes } = await zipOf({ ...plan, files: plan.files.map((f) => ({ ...f, size: 5 * 1024 * 1024 })) }, w, {
      refresh: (f) => refreshPass(lister, 'carpeta-1', f),
    });
    expect(result.missing).toEqual([]);
    expect(w.requests.filter((r) => r.id === id).map((r) => r.range)).toEqual([null, 'bytes=1000-', 'bytes=1000-']);
    if (hasPython) expect(text(pythonReadZip(bytes).entries[2])).toBe(big);
  });

  it('O6: el zip en memoria tiene su propio tope (los bytes que llegan, no el peso que dijo Drive)', async () => {
    const sink = new BlobSink(100);
    await sink.write(new Uint8Array(60));
    await expect(sink.write(new Uint8Array(60))).rejects.toBeInstanceOf(MemoryCapExceeded);
    // Drive dice 10 bytes y manda 5000: la bajada en memoria falla con el aviso del tope.
    const w = world({ 'mentira.bin': 'm'.repeat(5000) });
    const plan = await planFolder(w.lister, 'carpeta-1', 'X');
    const lied = { ...plan, bytes: 10, files: plan.files.map((f) => ({ ...f, size: 10 })) };
    const run = runDownload(lied, { kind: 'zip', sink: new BlobSink(2000) }, { fetch: w.fetcher, wait: noWait, online: () => true, missingText });
    await expect(run).rejects.toMatchObject({ name: 'MemoryCapExceeded', cap: 2000 });
  });
});

describe('Download all: a una carpeta del disco (Chrome y Edge)', () => {
  /** Un disco de mentira: lo escrito por ruta, y si un archivo quedó a medias. */
  function disk(opts: { failWrite?: string } = {}) {
    const written = new Map<string, Uint8Array>();
    const dirs: string[] = [];
    const aborted: string[] = [];
    return {
      written,
      dirs,
      aborted,
      target: {
        kind: 'dir' as const,
        makeDir: async (path: string) => void dirs.push(path),
        makeFile: async (path: string): Promise<FileOut> => {
          const parts: Uint8Array[] = [];
          return {
            write: async (c) => {
              if (opts.failWrite === path) throw new DOMException('The disk is full.', 'QuotaExceededError');
              parts.push(c.slice());
            },
            close: async () => void written.set(path, concat(parts)),
            abort: async () => void aborted.push(path),
          };
        },
      },
    };
  }

  it('escribe el árbol tal cual, con las vacías y la lista de lo que falta', async () => {
    const w = world(TREE);
    const plan = await planFolder(w.lister, 'carpeta-1', 'Referencias');
    const d = disk();
    const result = await runDownload(plan, d.target, { fetch: w.fetcher, wait: noWait, online: () => true, missingText });
    expect(result.done).toBe(7);
    expect(d.dirs).toEqual(['Fotos', 'Fotos/Dia 2', 'Notas', 'Vacia']);
    expect([...d.written.keys()]).toEqual([
      'Fotos/Dia 2/a.jpg',
      'Fotos/Dia 2/B.jpg',
      'Fotos/b.jpg',
      'Fotos/portada.png',
      'Notas/guion.txt',
      'Notas/lista.txt',
      'leeme.txt',
      MISSING_NAME,
    ]);
    expect(new TextDecoder().decode(d.written.get('Notas/guion.txt'))).toBe('INT. PUERTO - DÍA');
  });

  it('un archivo que se corta y no vuelve no queda a medias; el disco que no deja escribir frena todo', async () => {
    const w = world({ 'roto.bin': 'r'.repeat(3000), 'ok.txt': 'ok' });
    const plan = await planFolder(w.lister, 'carpeta-1', 'X');
    const data = w.files.get(w.idOf('roto.bin'))!;
    w.behave.set(w.idOf('roto.bin'), (_r, count) => (count === 1 ? cutResponse(data, 100) : new Response('{}', { status: 500 })));
    const d = disk();
    const big = { ...plan, files: plan.files.map((f, i) => (i === 0 ? { ...f, size: 5 * 1024 * 1024 } : f)) };
    const result = await runDownload(big, d.target, { fetch: w.fetcher, wait: noWait, online: () => true, missingText });
    expect(d.aborted).toEqual(['roto.bin']);
    expect(d.written.has('roto.bin')).toBe(false);
    expect(result.missing[0]).toMatchObject({ path: 'roto.bin', reason: 'failed' });
    expect(d.written.has('ok.txt')).toBe(true);

    // O2: un nombre que el navegador no deja crear (Chrome rechaza `.lnk` con un TypeError) se saltea y se anota.
    const named = world({ 'acceso.lnk': 'lnk', 'ok.txt': 'ok' });
    const namedPlan = await planFolder(named.lister, 'carpeta-1', 'X');
    const picky = disk();
    const makeFile = picky.target.makeFile;
    picky.target.makeFile = async (path: string) => {
      if (path.endsWith('.lnk')) throw new TypeError('Name is not allowed.');
      return makeFile(path);
    };
    const skipped = await runDownload(namedPlan, picky.target, { fetch: named.fetcher, wait: noWait, online: () => true, missingText });
    expect(skipped.done).toBe(1);
    expect(skipped.missing).toEqual([{ path: 'acceso.lnk', reason: 'failed', detail: 'Name is not allowed.' }]);
    expect([...picky.written.keys()]).toEqual(['ok.txt', MISSING_NAME]);
    // Otro error al crear el archivo (sin permiso sobre la carpeta) sí frena todo.
    const denied = disk();
    denied.target.makeFile = async () => {
      throw new DOMException('Permission revoked.', 'NotAllowedError');
    };
    await expect(runDownload(namedPlan, denied.target, { fetch: named.fetcher, wait: noWait, online: () => true, missingText })).rejects.toMatchObject({
      name: 'NotAllowedError',
    });

    const full = disk({ failWrite: 'ok.txt' });
    await expect(runDownload(plan, full.target, { fetch: w.fetcher, wait: noWait, online: () => true, missingText })).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
  });
});

describe('Download all: un portero que deja de contestar sin cortar (R1)', () => {
  /** Un pedido que no contesta nunca (ni la respuesta ni un error); solo la señal lo corta. */
  const hang = (init?: RequestInit) =>
    new Promise<Response>((_, fail) => {
      if (init?.signal?.aborted) return fail(new DOMException('aborted', 'AbortError'));
      init?.signal?.addEventListener('abort', () => fail(new DOMException('aborted', 'AbortError')), { once: true });
    });

  /** Una respuesta que entrega `first` bytes y después se queda quieta (sin cortarse). */
  function stuckResponse(data: Uint8Array, first: number): Response {
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        if (sent) return new Promise<void>(() => undefined);
        sent = true;
        ctrl.enqueue(data.slice(0, first));
      },
    });
    return new Response(body, { status: 200, headers: { 'Content-Length': String(data.length) } });
  }

  it('sin respuesta (tampoco de /health): dice "No connection", espera y sigue solo cuando vuelve, sin saltear nada', async () => {
    const w = world({ 'a.txt': 'aaa', 'b.txt': 'bbbb', 'c.txt': 'cc' });
    const plan = await planFolder(w.lister, 'carpeta-1', 'X');
    // Colgado hasta que se probó el portero tres veces sin respuesta.
    let healthHung = 0;
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (healthHung < 3) {
        if (String(input).endsWith('/health')) healthHung++;
        return hang(init);
      }
      return w.fetcher(input, init);
    }) as typeof fetch;
    const states: boolean[] = [];
    const sink = new BlobSink();
    const result = await runDownload(
      plan,
      { kind: 'zip', sink },
      { fetch: fetcher, wait: noWait, online: () => true, whenOnline: () => new Promise(() => undefined), probeMs: 1, stallMs: 20, missingText },
      { onProgress: (p) => states.push(p.offline) },
    );
    expect(result.missing).toEqual([]);
    expect(result.done).toBe(3);
    expect(states).toContain(true);
    expect(states.at(-1)).toBe(false);
    expect(healthHung).toBe(3);
  });

  it('una respuesta que se queda quieta a mitad cuenta como un corte: sigue desde donde quedó (Range) y queda entera', async () => {
    const big = 'z'.repeat(3000);
    const w = world({ 'toma.mov': big });
    const plan = await planFolder(w.lister, 'carpeta-1', 'X');
    const id = w.idOf('toma.mov');
    const data = w.files.get(id)!;
    w.behave.set(id, (_r, count) => (count === 1 ? stuckResponse(data, 1200) : 'normal'));
    // El portero tampoco contesta /health una vez: se espera diciendo "No connection".
    let healthHung = 0;
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/health') && healthHung++ < 1) return hang(init);
      return w.fetcher(input, init);
    }) as typeof fetch;
    const states: boolean[] = [];
    const sink = new BlobSink();
    const result = await runDownload(
      { ...plan, files: plan.files.map((f) => ({ ...f, size: 5 * 1024 * 1024 })) },
      { kind: 'zip', sink },
      { fetch: fetcher, wait: noWait, online: () => true, whenOnline: () => new Promise(() => undefined), probeMs: 1, stallMs: 20, missingText },
      { onProgress: (p) => states.push(p.offline) },
    );
    expect(result.missing).toEqual([]);
    expect(states).toContain(true);
    expect(w.requests.filter((r) => r.id === id).map((r) => r.range)).toEqual([null, 'bytes=1200-']);
    if (hasPython) expect(text(pythonReadZip(new Uint8Array(await sink.blob().arrayBuffer())).entries[1])).toBe(big);
  });

  it('si el portero contesta /health, el archivo que no contesta gasta sus intentos y se saltea; lo demás se baja', async () => {
    const w = world({ 'a.txt': 'aaa', 'b.txt': 'bbb' });
    const plan = await planFolder(w.lister, 'carpeta-1', 'X');
    const stuckUrl = plan.files.find((f) => f.path === 'a.txt')!.url;
    let tries = 0;
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith(stuckUrl)) {
        tries++;
        return hang(init);
      }
      return w.fetcher(input, init);
    }) as typeof fetch;
    const result = await runDownload(plan, { kind: 'zip', sink: new BlobSink() }, { fetch: fetcher, wait: noWait, online: () => true, probeMs: 1, stallMs: 20, missingText });
    expect(result.done).toBe(1);
    expect(result.missing).toEqual([{ path: 'a.txt', reason: 'failed', detail: 'The media server stopped answering.' }]);
    expect(tries).toBe(4);
  });

  it('cancelar mientras el portero no contesta corta en el acto (no espera el tope)', async () => {
    const w = world({ 'a.txt': 'aaa' });
    const plan = await planFolder(w.lister, 'carpeta-1', 'X');
    const ctrl = new AbortController();
    const fetcher = ((_input: RequestInfo | URL, init?: RequestInit) => hang(init)) as typeof fetch;
    const started = Date.now();
    const run = runDownload(plan, { kind: 'zip', sink: new BlobSink() }, { fetch: fetcher, wait: noWait, online: () => true, stallMs: 60_000, missingText }, { signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 30);
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('cancelar mientras una respuesta está quieta a mitad también corta en el acto', async () => {
    const w = world({ 'toma.mov': 'z'.repeat(3000) });
    const plan = await planFolder(w.lister, 'carpeta-1', 'X');
    const id = w.idOf('toma.mov');
    w.behave.set(id, () => stuckResponse(w.files.get(id)!, 100));
    const ctrl = new AbortController();
    const started = Date.now();
    const run = runDownload(
      { ...plan, files: plan.files.map((f) => ({ ...f, size: 5 * 1024 * 1024 })) },
      { kind: 'zip', sink: new BlobSink() },
      { fetch: w.fetcher, wait: noWait, online: () => true, stallMs: 60_000, missingText },
      { signal: ctrl.signal, onProgress: (p) => p.bytesDone >= 100 && ctrl.abort() },
    );
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe('Download all: cancelar el cuerpo de un error HTTP', () => {
  function partialError(status = 403) {
    let controller: ReadableStreamDefaultController<Uint8Array>;
    let pulling: () => void;
    const consumed = new Promise<void>((ok) => { pulling = ok; });
    const cancel = vi.fn();
    let reads = 0;
    const body = new ReadableStream<Uint8Array>({
      start(c) { controller = c; c.enqueue(new TextEncoder().encode('{"code":"pass_')); },
      pull() { if (++reads > 1) pulling(); },
      cancel,
    });
    return { response: new Response(body, { status }), body, cancel, consumed, finish: () => controller.close() };
  }

  it('Cancel corta la fuente de un 403 parcial y termina AbortError sin esperar el plazo', async () => {
    vi.useFakeTimers();
    const w = world({ 'a.txt': 'aaa' });
    const plan = await planFolder(w.lister, 'carpeta-1', 'X');
    const error = partialError();
    w.behave.set(w.idOf('a.txt'), () => error.response);
    const ctrl = new AbortController();
    const added = vi.spyOn(ctrl.signal, 'addEventListener');
    const removed = vi.spyOn(ctrl.signal, 'removeEventListener');
    const settled = runDownload(plan, { kind: 'zip', sink: new BlobSink() }, { fetch: w.fetcher, wait: noWait, stallMs: 60_000, missingText }, { signal: ctrl.signal }).catch((e) => e);
    try {
      await error.consumed;
      ctrl.abort();
      await vi.advanceTimersByTimeAsync(0);
      expect(error.cancel).toHaveBeenCalledOnce();
      expect(error.body.locked).toBe(false);
      expect(await settled).toMatchObject({ name: 'AbortError' });
      expect(vi.getTimerCount()).toBe(0);
      expect(w.requests).toHaveLength(1);
      for (const [event, listener] of added.mock.calls) expect(removed).toHaveBeenCalledWith(event, listener);
    } finally {
      if (!error.cancel.mock.calls.length) error.finish();
      await settled;
      vi.useRealTimers();
    }
  });

  it.each([429, 503])('el plazo cancela cada cuerpo %i atascado, suelta locks y conserva cuatro intentos y Retry missing', async (status) => {
    vi.useFakeTimers();
    const w = world({ 'a.txt': 'aaa', 'b.txt': 'bbb' });
    const plan = await planFolder(w.lister, 'carpeta-1', 'X');
    const errors: ReturnType<typeof partialError>[] = [];
    w.behave.set(w.idOf('a.txt'), () => {
      const error = partialError(status); errors.push(error); return error.response;
    });
    const ctrl = new AbortController();
    const added = vi.spyOn(ctrl.signal, 'addEventListener');
    const removed = vi.spyOn(ctrl.signal, 'removeEventListener');
    try {
      const run = runDownload(plan, { kind: 'zip', sink: new BlobSink() }, { fetch: w.fetcher, wait: noWait, stallMs: 25, missingText }, { signal: ctrl.signal });
      await vi.runAllTimersAsync();
      const result = await run;
      expect(errors).toHaveLength(4);
      for (const error of errors) {
        expect(error.cancel).toHaveBeenCalledOnce();
        expect(error.body.locked).toBe(false);
      }
      expect(vi.getTimerCount()).toBe(0);
      expect(result.done).toBe(1);
      expect(result.missing).toEqual([{ path: 'a.txt', reason: 'failed', detail: `The media server answered ${status}.` }]);
      for (const [event, listener] of added.mock.calls) expect(removed).toHaveBeenCalledWith(event, listener);
      w.behave.clear();
      const before = w.requests.length;
      const retry = await planRetry(w.lister, 'carpeta-1', plan, result.missing);
      expect((await runDownload(retry, { kind: 'zip', sink: new BlobSink() }, { fetch: w.fetcher, wait: noWait, missingText })).done).toBe(1);
      expect(w.requests.slice(before).map((r) => r.id)).toEqual([w.idOf('a.txt')]);
    } finally {
      for (const error of errors) if (!error.cancel.mock.calls.length) error.finish();
      vi.useRealTimers();
    }
  });

  it('Cancel durante un 403 parcial conserva el archivo ya terminado en la carpeta', async () => {
    vi.useFakeTimers();
    const w = world({ 'a.txt': 'listo', 'b.txt': 'pendiente' });
    const plan = await planFolder(w.lister, 'carpeta-1', 'X');
    const error = partialError();
    w.behave.set(w.idOf('b.txt'), () => error.response);
    const saved = new Map<string, string>();
    const remove = vi.fn();
    let savedOne!: () => void;
    const firstClosed = new Promise<void>((ok) => { savedOne = ok; });
    const target: DownloadTarget = {
      kind: 'dir', makeDir: async () => undefined, remove,
      makeFile: async (path) => {
        const parts: Uint8Array[] = [];
        return {
          write: async (chunk) => { parts.push(chunk); },
          close: async () => { saved.set(path, new TextDecoder().decode(concat(parts))); savedOne(); },
          abort: async () => { saved.delete(path); },
        };
      },
    };
    const ctrl = new AbortController();
    const settled = runDownload(plan, target, { fetch: w.fetcher, wait: noWait, stallMs: 60_000, missingText }, { signal: ctrl.signal }).catch((e) => e);
    try {
      await Promise.all([firstClosed, error.consumed]);
      ctrl.abort();
      await vi.advanceTimersByTimeAsync(0);
      expect(await settled).toMatchObject({ name: 'AbortError' });
      expect(error.cancel).toHaveBeenCalledOnce();
      expect(error.body.locked).toBe(false);
      expect([...saved]).toEqual([['a.txt', 'listo']]);
      expect(remove).not.toHaveBeenCalled();
      expect(w.requests.map((r) => r.id)).toEqual([w.idOf('a.txt'), w.idOf('b.txt')]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      if (!error.cancel.mock.calls.length) error.finish();
      await settled;
      vi.useRealTimers();
    }
  });
});

describe('Download all: Retry missing', () => {
  /** Un disco de mentira con borrar (la carpeta de *Download to a folder…*, que se reusa al reintentar). */
  function disk() {
    const written = new Map<string, string>();
    const removed: string[] = [];
    return {
      written,
      removed,
      target: {
        kind: 'dir' as const,
        makeDir: async () => undefined,
        makeFile: async (path: string): Promise<FileOut> => {
          const parts: Uint8Array[] = [];
          return {
            write: async (c) => void parts.push(c.slice()),
            close: async () => void written.set(path, new TextDecoder().decode(concat(parts))),
            abort: async () => void written.delete(path),
          };
        },
        remove: async (path: string) => {
          removed.push(path);
          written.delete(path);
        },
      },
    };
  }

  it('qué se puede reintentar: lo que falló o quedó a medias y una subcarpeta con error del portero; no un ciclo ni lo de Google', () => {
    expect(canRetry({ path: 'a', reason: 'failed' })).toBe(true);
    expect(canRetry({ path: 'a', reason: 'incomplete' })).toBe(true);
    expect(canRetry({ path: 'a/', reason: 'folder', detail: 'not_found', dirId: 'd1' })).toBe(true);
    expect(canRetry({ path: 'a/', reason: 'folder', detail: 'loop' })).toBe(false);
    expect(canRetry({ path: 'a', reason: 'shortcut' })).toBe(false);
    expect(canRetry({ path: 'a', reason: 'google' })).toBe(false);
  });

  it('a un zip: baja solo lo que falló y la subcarpeta que no se listó, con lo de Google en la lista nueva', async () => {
    const w = world(TREE);
    w.failList.add(w.idOf('Notas'));
    const plan = await planFolder(w.lister, 'carpeta-1', 'Referencias');
    const broken = w.idOf('b.jpg');
    w.behave.set(broken, () => new Response(JSON.stringify({ code: 'drive_missing' }), { status: 404 }));
    const first = await zipOf(plan, w);
    expect(first.result.missing.map((m) => `${m.path} ${m.reason}`)).toEqual([
      'Notas/ folder',
      'Acceso a otra cosa shortcut',
      'Plan de rodaje google',
      'Fotos/b.jpg failed',
    ]);

    // Vuelve el portero: la subcarpeta se lista y el archivo baja.
    w.failList.clear();
    w.behave.delete(broken);
    const before = w.requests.length;
    const retry = await planRetry(w.lister, 'carpeta-1', plan, first.result.missing);
    expect(retry.files.map((f) => f.path)).toEqual(['Fotos/b.jpg', 'Notas/guion.txt', 'Notas/lista.txt']);
    expect(retry.dirs.map((d) => d.path)).toEqual(['Notas']);
    expect(retry.skipped.map((m) => m.reason)).toEqual(['shortcut', 'google']);
    expect(retry.bytes).toBe(3 + new TextEncoder().encode('INT. PUERTO - DÍA').length + 5);
    const second = await zipOf(retry, w, {}, undefined, true);
    expect(second.result.done).toBe(3);
    expect(second.result.missing.map((m) => m.reason)).toEqual(['shortcut', 'google']);
    // Solo se pidieron los tres archivos (nada de lo que ya estaba).
    expect(w.requests.slice(before).map((r) => r.id).sort()).toEqual([broken, w.idOf('guion.txt'), w.idOf('lista.txt')].sort());
    if (hasPython) {
      const zip = pythonReadZip(second.bytes);
      expect(zip.bad).toBeNull();
      expect(zip.entries.filter((e) => !e.dir).map((e) => e.name)).toEqual([
        'Referencias/Fotos/b.jpg',
        'Referencias/Notas/guion.txt',
        'Referencias/Notas/lista.txt',
        `Referencias/${MISSING_NAME}`,
      ]);
      expect(text(zip.entries.find((e) => e.name === 'Referencias/Notas/guion.txt'))).toBe('INT. PUERTO - DÍA');
    }
  });

  it('a un zip, si ya no falta nada: igual lleva una lista nueva (vacía) que reemplaza a la vieja al descomprimir', async () => {
    const w = world({ 'a.txt': 'aaa', 'b.txt': 'bb' });
    const plan = await planFolder(w.lister, 'carpeta-1', 'X');
    const id = w.idOf('a.txt');
    w.behave.set(id, (_r, count) => (count <= 4 ? new Response('{}', { status: 502 }) : 'normal'));
    const first = await zipOf(plan, w);
    expect(first.result.missing).toMatchObject([{ path: 'a.txt', reason: 'failed' }]);
    const retry = await planRetry(w.lister, 'carpeta-1', plan, first.result.missing);
    const seen: MissingItem[][] = [];
    const second = await zipOf(retry, w, { missingText: (items) => (seen.push(items), items.length ? 'falta' : 'nada') }, undefined, true);
    expect(second.result.missing).toEqual([]);
    expect(seen).toEqual([[]]);
    if (hasPython) {
      const zip = pythonReadZip(second.bytes);
      expect(zip.entries.filter((e) => !e.dir).map((e) => e.name)).toEqual(['X/a.txt', `X/${MISSING_NAME}`]);
      expect(text(zip.entries.find((e) => e.name === `X/${MISSING_NAME}`))).toBe('nada');
    }
  });

  it('a una carpeta: escribe lo que faltaba en la misma y, si ya no falta nada, borra la lista vieja', async () => {
    const w = world({ Fotos: { 'a.jpg': 'AAAA' }, 'b.txt': 'bb', atajo: { shortcut: true } });
    const plan = await planFolder(w.lister, 'carpeta-1', 'X');
    const id = w.idOf('a.jpg');
    w.behave.set(id, () => new Response('{}', { status: 404 }));
    const d = disk();
    const first = await runDownload(plan, d.target, { fetch: w.fetcher, wait: noWait, online: () => true, missingText });
    expect(d.written.has('Fotos/a.jpg')).toBe(false);
    expect(d.written.get(MISSING_NAME)).toContain('Fotos/a.jpg');

    // Vuelve: la lista nueva tiene solo el acceso directo (no se borra: todavía falta algo).
    w.behave.delete(id);
    const retry = await planRetry(w.lister, 'carpeta-1', plan, first.missing);
    const second = await runDownload(retry, d.target, { fetch: w.fetcher, wait: noWait, online: () => true, missingText }, { retry: true });
    expect(second.done).toBe(1);
    expect(d.written.get('Fotos/a.jpg')).toBe('AAAA');
    expect(d.written.get(MISSING_NAME)).toBe('atajo shortcut'.replace(' ', String.fromCharCode(9)));
    expect(d.removed).toEqual([]);
    // Lo que sigue sin poder reintentarse no ofrece nada más.
    expect(second.missing.some(canRetry)).toBe(false);

    // Sin nada que no se pueda bajar: la lista vieja se borra.
    const w2 = world({ 'a.txt': 'aaa' });
    const plan2 = await planFolder(w2.lister, 'carpeta-1', 'Y');
    w2.behave.set(w2.idOf('a.txt'), (_r, count) => (count === 1 ? new Response('{}', { status: 404 }) : 'normal'));
    const d2 = disk();
    const r1 = await runDownload(plan2, d2.target, { fetch: w2.fetcher, wait: noWait, online: () => true, missingText });
    expect(d2.written.has(MISSING_NAME)).toBe(true);
    const plan2b = await planRetry(w2.lister, 'carpeta-1', plan2, r1.missing);
    const r2 = await runDownload(plan2b, d2.target, { fetch: w2.fetcher, wait: noWait, online: () => true, missingText }, { retry: true });
    expect(r2.missing).toEqual([]);
    expect(d2.removed).toEqual([MISSING_NAME]);
    expect([...d2.written.keys()]).toEqual(['a.txt']);
  });

  it('una subcarpeta que vuelve a fallar sigue anotada (y se puede volver a reintentar); cancelar el listado corta', async () => {
    const w = world({ Notas: { 'x.txt': 'x' }, 'a.txt': 'a' });
    w.failList.add(w.idOf('Notas'));
    const plan = await planFolder(w.lister, 'carpeta-1', 'X');
    const retry = await planRetry(w.lister, 'carpeta-1', plan, plan.skipped);
    expect(retry.files).toEqual([]);
    expect(retry.skipped).toEqual([{ path: 'Notas/', reason: 'folder', detail: 'not_found', dirId: w.idOf('Notas') }]);
    expect(retry.skipped.some(canRetry)).toBe(true);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(planRetry(w.lister, 'carpeta-1', plan, plan.skipped, { signal: ctrl.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('Download all: Retry missing no reintenta lo que no cambia', () => {
  it('una subcarpeta en ciclo queda anotada sin su id: no se ofrece reintentarla', async () => {
    // `A` tiene adentro una carpeta con su mismo id (un ciclo, como puede armarlo un acceso raro de Drive).
    const lister: FolderLister = {
      async folderList(_file, dir = null) {
        if (dir === null) return { entries: [{ type: 'folder', id: 'A', name: 'A', modified: null }], nextPageToken: null };
        return { entries: [{ type: 'folder', id: 'A', name: 'Otra vez A', modified: null }], nextPageToken: null };
      },
    };
    const plan = await planFolder(lister, 'carpeta-1', 'X');
    expect(plan.skipped).toEqual([{ path: 'A/Otra vez A/', reason: 'folder', detail: 'loop' }]);
    expect(plan.skipped.some(canRetry)).toBe(false);
  });
});

describe('Download all: varias subcarpetas por pedido (dirs)', () => {
  const summary = (plan: DownloadPlan) => ({
    dirs: plan.dirs.map((d) => d.path),
    files: plan.files.map((f) => `${f.path}|${f.id}|${f.dirId}|${f.size}`),
    skipped: plan.skipped,
    bytes: plan.bytes,
  });
  /** Lo mismo con un portero de a una por pedido: lo que tiene que salir igual. */
  const legacy = (tree: Tree, setup: (w: ReturnType<typeof world>) => void = () => undefined) => {
    const w = world(tree);
    setup(w);
    return planFolder(w.lister, 'carpeta-1', 'Referencias', { wait: noWait }).then(summary);
  };
  const BIG: Tree = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`d${String(i).padStart(3, '0')}`, { 'a.txt': 'x', 'b.txt': 'yy' }]));

  it('arma el mismo plan que de a una por pedido (subcarpetas, vacías, lo que no se baja, nombres)', async () => {
    const w = world(TREE, { page: 2 });
    const seen: { files: number; bytes: number; folders: number }[] = [];
    const plan = await planFolder(w.listerDirs, 'carpeta-1', 'Referencias', { wait: noWait, onProgress: (p) => seen.push(p) });
    expect(summary(plan).dirs).toEqual(['Fotos', 'Fotos/Dia 2', 'Notas', 'Vacia']);
    expect(plan.files).toHaveLength(7);
    // Los ids de archivo no coinciden entre mundos (se numeran al armarlos): se compara la forma.
    const flat = (p: ReturnType<typeof summary>) => ({ ...p, files: p.files.map((f) => f.split('|')[0]) });
    expect(flat(summary(plan))).toEqual(flat(await legacy(TREE)));
    expect(seen.at(-1)).toEqual({ folders: 4, files: 7, bytes: plan.bytes });
    // La raíz, de a una (no conoce su id); las subcarpetas por dirs.
    expect(w.listed.filter((d) => d === null).length).toBeGreaterThan(0);
    expect(w.manyLog.length).toBeGreaterThan(0);
    expect(w.manyLog.every((c) => c.ids.length <= 40)).toBe(true);
  });

  it('una carpeta con 500 subcarpetas pasa de 505 pedidos a 18 (la raíz en 5 páginas y las subcarpetas en 13 de 40), con todos sus archivos', async () => {
    const one = world(BIG);
    const planOne = await planFolder(one.lister, 'carpeta-1', 'R', { wait: noWait });
    // De a una: las 5 páginas de la raíz (100 por página) y un pedido por subcarpeta.
    expect(one.listed).toHaveLength(5 + 500);

    const w = world(BIG);
    const plan = await planFolder(w.listerDirs, 'carpeta-1', 'R', { wait: noWait });
    expect(w.listed).toHaveLength(5); // solo las páginas de la raíz (no se conoce su id)
    expect(w.manyLog).toHaveLength(13);
    expect(w.manyLog.map((c) => c.ids.length).sort((x, y) => y - x)).toEqual([...Array(12).fill(40), 20]);
    expect(plan.files).toHaveLength(1000);
    expect(plan.dirs).toHaveLength(500);
    expect(plan.bytes).toBe(planOne.bytes);
    expect(plan.files.map((f) => f.path)).toEqual(planOne.files.map((f) => f.path));
  });

  it('un pedido trae a lo sumo "page" cosas en total: se sigue con el nextPageToken y nada se repite ni se pierde', async () => {
    const w = world(BIG);
    w.cfg.page = 30; // 40 subcarpetas x 2 archivos = 80: tres páginas por pedido
    const plan = await planFolder(w.listerDirs, 'carpeta-1', 'R', { wait: noWait });
    expect(plan.files).toHaveLength(1000);
    expect(new Set(plan.files.map((f) => f.id)).size).toBe(1000);
    // Los pedidos con token repiten las mismas subcarpetas de su primer pedido (la consulta no cambia).
    const starts = w.manyLog.filter((c) => c.token === null).map((c) => c.ids.join());
    for (const c of w.manyLog.filter((c) => c.token !== null)) expect(starts).toContain(c.ids.join());
    // 12 pedidos de 80 cosas (3 páginas de 30) y uno de 40 (2 páginas).
    expect(w.manyLog).toHaveLength(12 * 3 + 2);
  });

  it('las que no se pueden listar quedan anotadas (con su id para Retry missing) y las demás siguen', async () => {
    const w = world(TREE);
    w.failList.add(w.idOf('Notas'));
    const plan = await planFolder(w.listerDirs, 'carpeta-1', 'R', { wait: noWait });
    expect(plan.files.map((f) => f.path)).toEqual(['Fotos/Dia 2/a.jpg', 'Fotos/Dia 2/B.jpg', 'Fotos/b.jpg', 'Fotos/portada.png', 'leeme.txt']);
    expect(plan.skipped[0]).toEqual({ path: 'Notas/', reason: 'folder', detail: 'not_found', dirId: w.idOf('Notas') });
    expect(plan.dirs.map((d) => d.path)).toContain('Notas');
  });

  it('las que el portero deja para después (el tope de llamados a Drive) se piden de nuevo, hasta que no queda ninguna', async () => {
    const w = world(BIG);
    w.cfg.cap = 25;
    const plan = await planFolder(w.listerDirs, 'carpeta-1', 'R', { wait: noWait });
    expect(plan.files).toHaveLength(1000);
    expect(plan.skipped).toEqual([]);
    expect(new Set(plan.dirs.map((d) => d.path)).size).toBe(500);
    // Cada pedido avanzó (25 de 40; después las 15 que quedaron junto a otras).
    expect(w.manyLog.length).toBeGreaterThan(13);
    expect(w.manyLog.length).toBeLessThan(40);
  });

  it('un portero que nunca avanza (todo para después): anota cada una con "later" y termina', async () => {
    const w = world(TREE);
    w.cfg.cap = 0;
    const plan = await planFolder(w.listerDirs, 'carpeta-1', 'R', { wait: noWait });
    expect(plan.skipped.filter((m) => m.reason === 'folder').map((m) => [m.path, m.detail])).toEqual([
      ['Fotos/', 'later'],
      ['Notas/', 'later'],
      ['Vacia/', 'later'],
    ]);
    expect(plan.skipped.filter((m) => m.reason === 'folder').every((m) => m.dirId)).toBe(true);
    expect(w.manyLog.length).toBeLessThan(20);
  });

  it('un error a mitad (de un pedido o de una página siguiente): se descarta lo recibido y se listan de a una; el plan sale igual y sin repetidos', async () => {
    for (const failAt of [1, 2, 3]) {
      const w = world(TREE, { page: 3 });
      w.cfg.page = 3;
      w.cfg.err = (n) => (n === failAt ? 'drive_failed' : null);
      const seen: { files: number; bytes: number }[] = [];
      const plan = await planFolder(w.listerDirs, 'carpeta-1', 'R', { wait: noWait, onProgress: (p) => seen.push(p) });
      const ok = world(TREE);
      const expected = await planFolder(ok.lister, 'carpeta-1', 'R', { wait: noWait });
      expect(plan.files.map((f) => f.path)).toEqual(expected.files.map((f) => f.path));
      expect(plan.dirs.map((d) => d.path)).toEqual(expected.dirs.map((d) => d.path));
      expect(plan.skipped).toEqual(expected.skipped);
      // El avance nunca cuenta lo descartado: termina en lo que hay.
      expect(seen.at(-1)).toMatchObject({ files: plan.files.length, bytes: plan.bytes });
      // Después del error, de a una (las subcarpetas que quedaban en ese pedido).
      expect(w.listed.length).toBeGreaterThan(1);
    }
  });

  it('una página siguiente que deja subcarpetas para después o las da por perdidas (O7): se descarta lo suyo, se listan de nuevo y las demás siguen, sin listar de a una', async () => {
    const tree: Tree = Object.fromEntries(
      ['A', 'B', 'C', 'D'].map((d) => [d, Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`${d.toLowerCase()}${i}.txt`, 'x'.repeat(i + 1)]))]),
    );
    const w = world(tree);
    w.cfg.page = 5; // 24 cosas: 5 páginas en el primer pedido
    const [b, c] = [w.idOf('B'), w.idOf('C')];
    // En la tercera página del primer pedido el portero deja B para después (no entró en su tope de llamados) y da a C
    // por perdida (se movió afuera del árbol). Lo de C de las páginas anteriores no puede quedar en el plan.
    w.cfg.partial = (n) => (n === 3 ? { later: [b], failed: { [c]: 'not_found' } } : null);
    const seen: { files: number; bytes: number }[] = [];
    const plan = await planFolder(w.listerDirs, 'carpeta-1', 'R', { wait: noWait, onProgress: (p) => seen.push(p) });
    const paths = plan.files.map((f) => f.path);
    expect(paths.filter((p) => p.startsWith('A/'))).toHaveLength(6);
    expect(paths.filter((p) => p.startsWith('B/'))).toHaveLength(6);
    expect(paths.filter((p) => p.startsWith('D/'))).toHaveLength(6);
    expect(paths.filter((p) => p.startsWith('C/'))).toEqual([]);
    expect(new Set(plan.files.map((f) => f.id)).size).toBe(plan.files.length);
    expect(plan.skipped).toEqual([{ path: 'C/', reason: 'folder', detail: 'not_found', dirId: c }]);
    expect(seen.at(-1)).toMatchObject({ files: 18, bytes: plan.bytes });
    // Sin caer a listar de a una (solo la raíz, que no tiene id); B se pidió de nuevo en otra vuelta, sola.
    expect(w.listed).toEqual([null]);
    expect(w.manyLog.filter((x) => x.token === null).map((x) => x.ids.length)).toEqual([4, 1]);
    expect(w.manyLog.filter((x) => x.token === null).every((x) => x.skip.length === 0)).toBe(true);
    expect(w.manyLog[3]!.skip).toEqual([b, c]);
    // Las páginas siguientes repitieron los mismos dirs de su primer pedido (Drive ata el token a la consulta).
    const first = w.manyLog[0]!.ids.join();
    for (const x of w.manyLog.slice(1).filter((x) => x.token !== null && x.ids.length === 4)) expect(x.ids.join()).toBe(first);
  });

  it('si en una página siguiente ya no queda ninguna de esa vuelta, no se piden más páginas', async () => {
    const tree: Tree = { A: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`a${i}.txt`, 'x'])) };
    const w = world(tree);
    w.cfg.page = 4;
    const a = w.idOf('A');
    let once = true;
    w.cfg.partial = () => (once ? ((once = false), { later: [a] }) : null);
    const plan = await planFolder(w.listerDirs, 'carpeta-1', 'R', { wait: noWait });
    expect(plan.files).toHaveLength(12);
    // Primer pedido: la página 1 y la 2 (que la deja para después); después, las 3 páginas de la vuelta nueva.
    expect(w.manyLog.map((x) => x.token === null)).toEqual([true, false, true, false, false]);
  });

  it('Drive que pide ir más despacio: espera y repite el mismo pedido; si no cede, las anota con "rate"', async () => {
    const w = world(TREE);
    w.cfg.err = (n) => (n === 1 ? 'rate' : null);
    const waits: number[] = [];
    const plan = await planFolder(w.listerDirs, 'carpeta-1', 'R', { wait: async (ms) => void waits.push(ms) });
    expect(waits).toEqual([5000]);
    expect(plan.files).toHaveLength(7);

    const stuck = world(TREE);
    stuck.cfg.err = () => 'rate';
    const waits2: number[] = [];
    const plan2 = await planFolder(stuck.listerDirs, 'carpeta-1', 'R', { wait: async (ms) => void waits2.push(ms) });
    expect(plan2.skipped.filter((m) => m.reason === 'folder').map((m) => m.detail)).toEqual(['rate', 'rate', 'rate']);
    expect(waits2).toEqual([5000, 10000, 20000, 40000]);
  });

  it('un portero anterior (sin dirs): una sola prueba, se acuerda y lista de a una sin romper nada', async () => {
    const w = world(TREE);
    w.cfg.old = true;
    const plan = await planFolder(w.listerDirs, 'carpeta-1', 'R', { wait: noWait });
    expect(w.manyLog).toHaveLength(1);
    expect(plan.files).toHaveLength(7);
    expect(plan.skipped.map((m) => m.reason)).toEqual(['shortcut', 'google']);
    expect(plan.dirs.map((d) => d.path)).toEqual(['Fotos', 'Fotos/Dia 2', 'Notas', 'Vacia']);
    // Sin el método (una app que no sabe de dirs, o un cliente de mentira): lo de siempre.
    const plain = world(TREE);
    expect(summary(await planFolder(plain.lister, 'carpeta-1', 'R', { wait: noWait })).files).toHaveLength(7);
    expect(plain.manyLog).toHaveLength(0);
  });

  it('cancelar corta el listado (AbortError) y no se confunde con un error para probar de a una', async () => {
    const w = world(BIG);
    const ctrl = new AbortController();
    w.cfg.err = (n) => {
      if (n === 2) ctrl.abort();
      return null;
    };
    await expect(planFolder(w.listerDirs, 'carpeta-1', 'R', { wait: noWait, signal: ctrl.signal })).rejects.toMatchObject({ name: 'AbortError' });
    // Nada de probar de a una después de cancelar: solo las páginas de la raíz.
    expect(w.listed).toHaveLength(5);
  });

  it('un ciclo (la misma subcarpeta dos veces) y la profundidad se siguen cortando', async () => {
    const w = world({ A: { 'x.txt': '1' } });
    // La subcarpeta A aparece de nuevo adentro de sí misma.
    const a = w.idOf('A');
    const entries = [{ type: 'folder', id: a, name: 'otra', modified: null }, { type: 'file', id: 'x1', name: 'x.txt', mime: 'text/plain', size: 1, modified: null, url: 'https://portero.test/m/x1', thumb: null }] as FolderEntry[];
    const inner = w.listerDirs.folderListDirs!;
    w.listerDirs.folderListDirs = async (file, ids, token) => {
      const res = await inner(file, ids, token);
      return res && res.lists[a] ? { ...res, lists: { ...res.lists, [a]: entries } } : res;
    };
    const plan = await planFolder(w.listerDirs, 'carpeta-1', 'R', { wait: noWait });
    expect(plan.skipped).toEqual([{ path: 'A/otra/', reason: 'folder', detail: 'loop' }]);
  });

  it('Retry missing: la subcarpeta que no se listó se vuelve a listar y sus subcarpetas, con dirs', async () => {
    const w = world({ Notas: { Sub: { 'a.txt': 'x' }, 'guion.txt': 'g' }, 'leeme.txt': 'h' });
    w.failList.add(w.idOf('Notas'));
    const plan = await planFolder(w.listerDirs, 'carpeta-1', 'Referencias', { wait: noWait });
    const first = await zipOf(plan, w);
    w.failList.clear();
    const before = w.manyLog.length;
    const retry = await planRetry(w.listerDirs, 'carpeta-1', plan, first.result.missing, { wait: noWait });
    expect(retry.files.map((f) => f.path)).toEqual(['Notas/Sub/a.txt', 'Notas/guion.txt']);
    expect(retry.dirs.map((d) => d.path)).toEqual(['Notas', 'Notas/Sub']);
    // La subcarpeta de Notas, por dirs (Notas misma, de a una, como la raíz).
    expect(w.manyLog.length - before).toBe(1);
  });
});
