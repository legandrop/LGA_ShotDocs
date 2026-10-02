import { describe, expect, it } from 'vitest';
import { BlobSink, MISSING_NAME, planFolder, refreshPass, runDownload, type DownloadPlan, type FileOut, type FolderLister, type MissingItem } from './folderZip';
import { PorteroError, type FolderEntry, type FolderListing } from './portero';
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
  const requests: { id: string; range: string | null }[] = [];
  /** Lo que hace cada pedido de un archivo: cortarse en el medio, fallar, un pase vencido… */
  const behave = new Map<string, (range: string | null, count: number) => Response | 'normal'>();
  const counts = new Map<string, number>();
  const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const signal = init.signal;
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const id = /\/m\/([^?]+)/.exec(url)?.[1] ?? '';
    const range = new Headers(init.headers).get('Range');
    requests.push({ id, range });
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
    fetcher,
    files,
    listed,
    requests,
    behave,
    failList,
    setRate: (ids: (string | null)[]) => (rateOnce = new Set(ids)),
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

async function zipOf(plan: DownloadPlan, w: ReturnType<typeof world>, extra: Partial<Parameters<typeof runDownload>[2]> = {}, signal?: AbortSignal) {
  const sink = new BlobSink();
  const result = await runDownload(plan, { kind: 'zip', sink }, { fetch: w.fetcher, wait: noWait, online: () => true, missingText, ...extra }, { signal });
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
    expect(plan.skipped[0]).toEqual({ path: 'Notas/', reason: 'folder', detail: 'not_found' });
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

    const full = disk({ failWrite: 'ok.txt' });
    await expect(runDownload(plan, full.target, { fetch: w.fetcher, wait: noWait, online: () => true, missingText })).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
  });
});
