import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { cleanFileName as appClean, FOLDER_MIME, folderCardUrl } from './attachments';
import { folderPathOk, foldersFromList, readFolder, summarize, takeDrop, withHidden, type EntryLike, type FolderSource } from './folderRead';
import { cleanFileName as porteroClean, validFolderPath } from '../../portero/src/core';
import { FOLDER_BATCH, FOLDER_CONCURRENCY, FOLDER_TRIES, FolderUploads, openFoldersDb, type FolderPortero } from './folderUpload';
import { Portero, PorteroError, UploadError, type FolderSessionItem } from './portero';
import { MEDIA_SCHEME } from './queue';
import { mediaIdsInDoc } from './usage';

// Carpetas (P.9, Docs/Doc_Carpetas.md): leer lo soltado, la cola propia (sin copia en el dispositivo, retomar
// volviendo a soltar la carpeta, 3 a la vez, un error que no frena a los demás) y la fila de la carpeta.

// --- entradas de mentira, como las del navegador ---------------------------------------------------------

type Tree = { [name: string]: Tree | number | 'unreadable' };

/** Una carpeta como la entrega `webkitGetAsEntry`, que lee de a `perRead` (Chrome: 100). */
function entry(name: string, node: Tree | number | 'unreadable', perRead = 100): EntryLike {
  if (typeof node === 'number' || node === 'unreadable') {
    return {
      name,
      isFile: true,
      isDirectory: false,
      file: (ok, fail) => (node === 'unreadable' ? fail?.(new Error('NotReadableError')) : ok(new File([new Uint8Array(node)], name))),
    };
  }
  const children = Object.entries(node).map(([n, child]) => entry(n, child, perRead));
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => {
      let at = 0;
      return {
        readEntries: (ok) => {
          const batch = children.slice(at, at + perRead);
          at += batch.length;
          setTimeout(() => ok(batch));
        },
      };
    },
  };
}

describe('leer una carpeta', () => {
  it('recorre todo (también más de 100 por carpeta), con las subcarpetas vacías, y saltea lo oculto y lo del sistema', async () => {
    const many: Tree = {};
    for (let i = 0; i < 250; i++) many[`IMG_${i}.jpg`] = 10;
    const source = await readFolder(
      entry('Referencias', {
        Fotos: many,
        Vacia: {},
        '.DS_Store': 5,
        'Thumbs.db': 5,
        '~$guion.docx': 5,
        __MACOSX: { '._a.jpg': 3 },
        '.git': { config: 1 },
        Notas: { 'guion.pdf': 100, 'roto.mov': 'unreadable' },
      }),
    );
    expect(source.name).toBe('Referencias');
    expect(source.files).toHaveLength(251);
    expect(source.dirs).toEqual(['Fotos', 'Vacia', 'Notas']);
    const reasons = Object.fromEntries(source.skipped.map((s) => [s.path, s.reason]));
    expect(reasons).toMatchObject({
      '.DS_Store': 'hidden',
      'Thumbs.db': 'system',
      '~$guion.docx': 'system',
      __MACOSX: 'system',
      '__MACOSX/._a.jpg': 'system',
      '.git': 'hidden',
      '.git/config': 'hidden',
      'Notas/roto.mov': 'unreadable',
    });
    const all = withHidden(source);
    expect(all.files.map((f) => f.path)).toContain('.git/config');
    expect(all.dirs).toContain('.git');
    expect(all.skipped.map((s) => s.path)).toEqual(['Notas/roto.mov']);
    const sum = summarize(source);
    expect(sum).toMatchObject({ files: 251, dirs: 3, bytes: 2600, byKind: { image: 250, pdf: 1 } });
  });

  it('una subcarpeta con barra invertida sube; una de más de 30 niveles se saltea con lo de adentro y el resto sube', async () => {
    let deep: Tree = { 'hondo.txt': 1 };
    for (let i = 0; i < 31; i++) deep = { [`n${i}`]: deep };
    const source = await readFolder(entry('Raras', { 'a\\b': { 'x.txt': 1 }, 'normal.txt': 1, ...deep }));
    expect(source.files.map((f) => f.path).sort()).toEqual(['a\\b/x.txt', 'normal.txt']);
    expect(source.skipped.filter((k) => k.reason === 'invalid' && !k.dir).map((k) => k.path.split('/').pop())).toEqual(['hondo.txt']);
    expect(source.dirs).toContain('a\\b');
    expect(source.dirs.every((d) => d.split('/').length <= 30)).toBe(true);
  });

  it('el nombre de la carpeta queda tal cual (espacios, tildes, emojis); uno sin nada visible es "Folder"', async () => {
    expect((await readFolder(entry('Día 2 - Puerto 🎬', { 'a.jpg': 1 }))).name).toBe('Día 2 - Puerto 🎬');
    expect((await readFolder(entry('   ', { 'a.jpg': 1 }))).name).toBe('Folder');
    expect((await readFolder(entry('\u202E\u200B', { 'a.jpg': 1 }))).name).toBe('Folder');
    const file = (path: string) => Object.assign(new File(['x'], path.split('/').pop()!), { webkitRelativePath: path });
    expect(foldersFromList([file('Día 2 - Puerto/a.jpg')])[0]!.name).toBe('Día 2 - Puerto');
    expect(foldersFromList([file('  /a.jpg')])[0]!.name).toBe('Folder');
  });

  it('la app y el portero aceptan las mismas rutas', () => {
    const long = Array.from({ length: 30 }, () => 'x').join('/');
    for (const path of ['Fotos', 'Fotos/Dia 2', 'a\\b', '..', 'a/./b', 'a//b', '', long, `${long}/y`, 'a\u0001b', 'z'.repeat(2001)]) {
      expect(folderPathOk(path), path).toBe(validFolderPath(path));
    }
  });

  it('al soltar, separa los archivos sueltos de las carpetas, en el acto', () => {
    const a = new File(['a'], 'a.pdf');
    const dir = entry('Carpeta', {});
    const dt = {
      types: ['Files'],
      files: [a],
      items: [
        { kind: 'file', getAsFile: () => a, webkitGetAsEntry: () => entry('a.pdf', 1) },
        { kind: 'file', getAsFile: () => null, webkitGetAsEntry: () => dir },
      ],
    } as unknown as DataTransfer;
    const taken = takeDrop(dt);
    expect(taken.files).toEqual([a]);
    expect(taken.folders).toEqual([dir]);
    expect(taken.supported).toBe(true);
  });

  it('la lista de un "elegir carpeta" (webkitdirectory) arma la carpeta con sus rutas', () => {
    const file = (path: string) => Object.assign(new File(['x'], path.split('/').pop()!), { webkitRelativePath: path });
    const [source] = foldersFromList([file('Ref/Fotos/Dia 2/a.jpg'), file('Ref/b.pdf'), file('Ref/.DS_Store'), file('Ref/.git/x')]);
    expect(source!.name).toBe('Ref');
    expect(source!.files.map((f) => f.path)).toEqual(['Fotos/Dia 2/a.jpg', 'b.pdf']);
    expect(source!.dirs).toEqual(['Fotos', 'Fotos/Dia 2']);
    expect(source!.skipped.map((s) => s.path)).toEqual(['.DS_Store', '.git', '.git/x']);
  });
});

// --- la cola de las carpetas, con un portero en memoria ------------------------------------------------

function fakeFolderPortero() {
  const dirs = new Map<string, string>();
  const prepares: { dirs: string[]; parents: Record<string, string> }[] = [];
  const sessionsAsked: FolderSessionItem[][] = [];
  const uploaded = new Map<string, number>();
  const failures = new Map<string, number>();
  let rateOnce = false;
  let lostOnce: string | null = null;
  let active = 0;
  let maxActive = 0;
  let n = 0;
  const sessions = new Map<string, { name: string; dir: string | null }>();
  const portero: FolderPortero = {
    folderPrepare: async (_file, _name, batch = [], parents = {}) => {
      expect(batch.length).toBeLessThanOrEqual(FOLDER_BATCH);
      prepares.push({ dirs: batch, parents });
      const out: Record<string, string> = {};
      for (const d of batch) {
        const up = d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : '';
        // La de arriba ya existe (de este pedido o de uno anterior que vino en `parents`).
        if (up) expect(out[up] ?? parents[up]).toBeTruthy();
        const id = dirs.get(d) ?? `dir${++n}`;
        dirs.set(d, id);
        out[d] = id;
      }
      return { root: { id: 'rootid', name: 'Ref' }, dirs: out };
    },
    folderSessions: async (_file, items) => {
      sessionsAsked.push(items);
      if (rateOnce) {
        rateOnce = false;
        return items.map(() => ({ error: 'rate' }));
      }
      return items.map((item) => {
        const id = `up${++n}`;
        sessions.set(id, { name: item.name, dir: item.dir });
        return item.size === 0 ? { done: { id: `d${n}`, name: item.name, mimeType: item.mime, size: 0 } } : { uploadId: id };
      });
    },
    upload: async (file, options = {}) => {
      expect(options.noOpen).toBe(true);
      active++;
      maxActive = Math.max(maxActive, active);
      try {
        await new Promise((r) => setTimeout(r, 1));
        const s = sessions.get(options.resume ?? '');
        if (!s) throw new UploadError('gone', 410, null, 0);
        if (lostOnce === s.name) {
          lostOnce = null;
          sessions.delete(options.resume!);
          throw new UploadError('gone', 410, null, 0);
        }
        const left = failures.get(s.name) ?? 0;
        if (left > 0) {
          failures.set(s.name, left - 1);
          throw new UploadError('Google Drive answered 400', 400, options.resume!, 0);
        }
        uploaded.set(`${s.dir}/${s.name}`, file.size);
        options.onProgress?.({ uploadId: options.resume!, sent: file.size, total: file.size, bytesPerSecond: 0, retries: 0 });
        return { id: `f${++n}`, name: s.name, mimeType: '', size: file.size };
      } finally {
        active--;
      }
    },
  };
  return {
    portero,
    dirs,
    prepares,
    sessionsAsked,
    uploaded,
    maxActive: () => maxActive,
    failAlways: (name: string) => failures.set(name, 1000),
    failTimes: (name: string, times: number) => failures.set(name, times),
    rateOnce: () => (rateOnce = true),
    loseOnce: (name: string) => (lostOnce = name),
  };
}

function sourceOf(name: string, files: Record<string, number>, extraDirs: string[] = []): FolderSource {
  const dirs = new Set(extraDirs);
  for (const path of Object.keys(files)) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  return {
    name,
    files: Object.entries(files).map(([path, size]) => ({ path, file: new File([new Uint8Array(size)], path.split('/').pop()!) })),
    dirs: [...dirs],
    skipped: [],
  };
}

async function settle(f: FolderUploads, id: string): Promise<void> {
  for (let i = 0; i < 500; i++) {
    const p = f.progress(id);
    if (!p || p.state === 'done' || p.state === 'failed' || p.state === 'missing') {
      // Que termine de cerrar la vuelta.
      await new Promise((r) => setTimeout(r, 5));
      return;
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('no terminó');
}

let dbCount = 0;
const noWait = () => Promise.resolve();

describe('la cola de las carpetas', () => {
  it('crea las subcarpetas en orden y de a tandas, sube de a 3 y al terminar no deja nada en el dispositivo', async () => {
    const fake = fakeFolderPortero();
    const db = await openFoldersDb(`folders-${++dbCount}`);
    const notes: (string | null)[] = [];
    const f = new FolderUploads(db, { portero: () => fake.portero, note: (_, text) => notes.push(text), wait: noWait });
    const files: Record<string, number> = {};
    for (let d = 0; d < 40; d++) files[`Dia ${d}/sub/a${d}.jpg`] = 5;
    files['raiz.txt'] = 3;
    files['vacio.txt'] = 0;
    const source = sourceOf('Ref', files, ['Vacia']);
    await f.start('11111111-1111-4111-8111-111111111111', 'page', source);
    await settle(f, '11111111-1111-4111-8111-111111111111');
    const p = f.progress('11111111-1111-4111-8111-111111111111')!;
    expect(p.state).toBe('done');
    expect(p.doneFiles).toBe(42);
    expect(fake.uploaded.size).toBe(41);
    expect(fake.uploaded.get(`${fake.dirs.get('Dia 7/sub')}/a7.jpg`)).toBe(5);
    expect(fake.uploaded.get('null/raiz.txt')).toBe(3);
    expect(fake.dirs.has('Vacia')).toBe(true);
    // 81 subcarpetas en tandas de a 30 (más el pedido que crea la carpeta), primero las de arriba.
    expect(fake.prepares.length).toBeGreaterThanOrEqual(3);
    expect(fake.maxActive()).toBeLessThanOrEqual(FOLDER_CONCURRENCY);
    expect(fake.maxActive()).toBeGreaterThan(1);
    expect(fake.sessionsAsked.every((s) => s.length <= FOLDER_BATCH)).toBe(true);
    expect(await db.getAll('jobs')).toEqual([]);
    expect(await db.getAll('items')).toEqual([]);
    expect(notes.at(-1)).toBeNull();
    db.close();
  });

  it('un archivo que falla no frena a los demás; queda a la vista y "Retry" lo vuelve a probar', async () => {
    const fake = fakeFolderPortero();
    const f = new FolderUploads(null, { portero: () => fake.portero, wait: noWait });
    fake.failAlways('malo.bin');
    await f.start('id-1', 'page', sourceOf('Ref', { 'malo.bin': 4, 'a.jpg': 1, 'b.jpg': 2 }));
    await settle(f, 'id-1');
    let p = f.progress('id-1')!;
    expect(p.state).toBe('failed');
    expect(p.doneFiles).toBe(2);
    expect(p.errors).toEqual([{ path: 'malo.bin', error: 'Google Drive answered 400' }]);
    fake.failTimes('malo.bin', 0);
    f.retry('id-1');
    await settle(f, 'id-1');
    p = f.progress('id-1')!;
    expect(p.state).toBe('done');
    expect(FOLDER_TRIES).toBeGreaterThan(1);
  });

  it('si Drive pide ir más despacio, espera y sigue; una subida perdida se vuelve a pedir', async () => {
    const fake = fakeFolderPortero();
    const waits: number[] = [];
    const f = new FolderUploads(null, { portero: () => fake.portero, wait: async (ms) => void waits.push(ms) });
    fake.rateOnce();
    fake.loseOnce('a.jpg');
    await f.start('id-2', 'page', sourceOf('Ref', { 'a.jpg': 1, 'b.jpg': 1 }));
    await settle(f, 'id-2');
    expect(f.progress('id-2')!.state).toBe('done');
    expect(waits.length).toBeGreaterThan(0);
    // La de "a.jpg" se pidió dos veces (la primera se perdió).
    expect(fake.sessionsAsked.flat().filter((i) => i.name === 'a.jpg').length).toBeGreaterThanOrEqual(2);
  });

  it('después de cerrar la pestaña, se retoma volviendo a soltar la carpeta: solo lo que falta, por ruta y peso', async () => {
    const fake = fakeFolderPortero();
    const name = `folders-${++dbCount}`;
    const db = await openFoldersDb(name);
    const first = new FolderUploads(db, { portero: () => fake.portero, wait: noWait });
    fake.failAlways('c.mov');
    await first.start('id-3', 'page', sourceOf('Ref', { 'a.jpg': 1, 'Sub/b.jpg': 2, 'c.mov': 3, 'd.mov': 4 }));
    await settle(first, 'id-3');
    first.stop();

    // "Se cerró la pestaña": otra instancia lee la lista, sin los archivos.
    const again = new FolderUploads(db, { portero: () => fake.portero, wait: noWait });
    await again.load();
    expect(again.progress('id-3')!.doneFiles).toBe(3);
    fake.failTimes('c.mov', 0);
    // c.mov con otro peso no se toma.
    expect(again.resumeWith('id-3', sourceOf('Ref', { 'a.jpg': 1, 'c.mov': 30 }))).toBe(0);
    expect(again.progress('id-3')!.state).toBe('failed');
    again.retry('id-3');
    await settle(again, 'id-3');
    expect(again.progress('id-3')!.state).toBe('missing');
    expect(again.progress('id-3')!.missing).toBe(1);
    expect(again.resumeWith('id-3', sourceOf('Ref', { 'a.jpg': 1, 'c.mov': 3 }))).toBe(1);
    await settle(again, 'id-3');
    expect(again.progress('id-3')!.state).toBe('done');
    db.close();
  });

  it('lo que no entró en un pedido del portero (later) va en el siguiente; si una subcarpeta no es de esta carpeta, se rearma el árbol', async () => {
    const fake = fakeFolderPortero();
    let laterOnce = true;
    let outsideOnce = true;
    const base = fake.portero;
    const portero: FolderPortero = {
      ...base,
      folderSessions: async (file, items) => {
        if (outsideOnce && items.some((i) => i.dir)) {
          outsideOnce = false;
          throw new PorteroError('That folder is not inside this folder.', 403, false, 'outside');
        }
        const out = await base.folderSessions(file, items);
        if (laterOnce) {
          laterOnce = false;
          return out.map((o, i) => (i === 0 ? o : { error: 'later' }));
        }
        return out;
      },
    };
    const f = new FolderUploads(null, { portero: () => portero, wait: noWait });
    await f.start('id-5', 'page', sourceOf('Ref', { 'a.bin': 1, 'Sub/b.bin': 1, 'Sub/c.bin': 1 }));
    await settle(f, 'id-5');
    expect(f.progress('id-5')!.state).toBe('done');
    expect(fake.uploaded.size).toBe(3);
    // El árbol se pidió de nuevo después del "outside".
    expect(fake.prepares.filter((x) => x.dirs.includes('Sub')).length).toBe(2);
  });

  it('un error que no se arregla solo (no es quien la creó) la deja detenida, con el motivo, y la tarjeta lo dice', async () => {
    const notes: (string | null)[] = [];
    const portero: FolderPortero = {
      ...fakeFolderPortero().portero,
      folderPrepare: async () => {
        throw new PorteroError('Only the person who added this folder can upload into it.', 403, false, 'not_creator');
      },
    };
    const f = new FolderUploads(null, { portero: () => portero, wait: noWait, note: (_, text) => notes.push(text) });
    await f.start('id-6', 'page', sourceOf('Ref', { 'a.bin': 1 }));
    await settle(f, 'id-6');
    const p = f.progress('id-6')!;
    expect(p.state).toBe('failed');
    expect(p.problem).toBe('Only the person who added this folder can upload into it.');
    expect(notes.at(-1)).toBe('Stopped: 0 of 1 (open it to retry)');
  });

  it('una subcarpeta que el portero no acepta se saltea con lo de adentro; el resto sube y "Retry" no la repite', async () => {
    const fake = fakeFolderPortero();
    const base = fake.portero;
    let rejected = 0;
    const portero: FolderPortero = {
      ...base,
      folderPrepare: async (file, name, dirs = [], parents = {}) => {
        if (dirs.includes('Mala')) {
          rejected++;
          throw new PorteroError('Send up to 30 folder paths at a time.', 400, false, 'bad_request');
        }
        return base.folderPrepare(file, name, dirs, parents);
      },
    };
    const f = new FolderUploads(null, { portero: () => portero, wait: noWait });
    await f.start('id-7', 'page', sourceOf('Ref', { 'Mala/x.bin': 1, 'Mala/sub/y.bin': 1, 'Buena/z.bin': 1, 'r.bin': 1 }));
    await settle(f, 'id-7');
    const p = f.progress('id-7')!;
    expect(p.state).toBe('done');
    expect(p.invalid).toBe(2);
    expect(p.files).toBe(2);
    expect([...fake.uploaded.keys()].some((k) => k.endsWith('/x.bin') || k.endsWith('/y.bin'))).toBe(false);
    const before = rejected;
    f.retry('id-7');
    await settle(f, 'id-7');
    expect(rejected).toBe(before);
  });

  it('dejar de subir olvida la carpeta en este dispositivo; la misma carpeta soltada otra vez se reconoce', async () => {
    const fake = fakeFolderPortero();
    const db = await openFoldersDb(`folders-${++dbCount}`);
    const notes: (string | null)[] = [];
    const uploaded: number[] = [];
    const f = new FolderUploads(db, { portero: () => fake.portero, wait: noWait, note: (_, text) => notes.push(text), uploaded: (_, bytes) => void uploaded.push(bytes) });
    fake.failAlways('b.bin');
    await f.start('id-8', 'page', sourceOf('Ref', { 'a.bin': 1, 'b.bin': 1 }));
    await settle(f, 'id-8');
    expect(f.hasAnyPath('id-8', new Set(['b.bin']))).toBe(true);
    expect(f.hasAnyPath('id-8', new Set(['otra.bin']))).toBe(false);
    await f.forget('id-8');
    expect(f.progress('id-8')).toBeNull();
    // Lo que llegó de verdad: a.bin (1 byte), no b.bin.
    expect(uploaded).toEqual([1]);
    expect(await db.getAll('jobs')).toEqual([]);
    expect(await db.getAll('items')).toEqual([]);
    expect(notes.at(-1)).toBeNull();
    db.close();
  });

  it('pausar corta lo que sube y no pierde lo hecho; seguir continúa', async () => {
    const fake = fakeFolderPortero();
    const f = new FolderUploads(null, { portero: () => fake.portero, wait: noWait });
    const files: Record<string, number> = {};
    for (let i = 0; i < 20; i++) files[`f${i}.bin`] = 1;
    await f.start('id-4', 'page', sourceOf('Ref', files));
    f.pause('id-4');
    await new Promise((r) => setTimeout(r, 30));
    expect(f.progress('id-4')!.state).toBe('paused');
    const done = f.progress('id-4')!.doneFiles;
    expect(done).toBeLessThan(20);
    f.resume('id-4');
    await settle(f, 'id-4');
    expect(f.progress('id-4')!.doneFiles).toBe(20);
  });
});

// --- la fila de la carpeta ------------------------------------------------------------------------------

const devices: Device[] = [];
afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
    d.mediaDb.close();
  }
});

describe('la fila de una carpeta', () => {
  it('se registra con la página, en el acto, sin original; volver a la cola (copia restaurada) no la detiene', async () => {
    const server = new FakeServer();
    server.enableMedia();
    const a = await makeDevice(server);
    devices.push(a);
    const page = await a.tree.create(null, 'Día 3');
    await a.engine.syncNow();

    const { id, url } = await a.media.addFolder(page, 'Referencias', 0);
    expect(url).toBe(MEDIA_SCHEME + id);
    expect(server.mediaFiles.get(id)).toMatchObject({ mime: FOLDER_MIME, size: 1, name: 'Referencias' });
    expect(server.pageFiles.has(`${page}:${id}`)).toBe(true);
    // Sin nada visible en el nombre, "Folder" (nunca el "file.bin" de los archivos).
    const blank = await a.media.addFolder(page, '  \u202E ', 0);
    expect(server.mediaFiles.get(blank.id)).toMatchObject({ name: 'Folder' });
    expect(await a.mediaDb.get('files', id)).toMatchObject({ pending: 0, registered: true });
    expect(await a.mediaDb.get('blobs', id)).toBeUndefined();
    expect(a.media.isFolder(id)).toBe(true);
    expect((await a.media.status()).pending).toBe(0);

    await a.media.resetForRestore();
    await a.engine.syncMedia();
    const after = await a.mediaDb.get('files', id);
    expect(after).toMatchObject({ pending: 0, registered: true, blocked: false });

    // La tarjeta dice que es una carpeta de Drive, y lo que diga la subida en curso.
    expect(decodeURIComponent(await a.media.resolve(url))).toContain('Google Drive folder');
    a.media.setFolderNote(id, 'Uploading 3 of 10');
    expect(decodeURIComponent(await a.media.resolve(url))).toContain('Uploading 3 of 10');
    // Dejar de subir: la tarjeta de este dispositivo dice lo que llegó.
    a.media.setFolderNote(id, null);
    await a.media.setFolderSize(id, 3 * 1024 * 1024);
    expect(decodeURIComponent(await a.media.resolve(url))).toContain('3 MB');
  });

  it('sin conexión no se agrega (no hay nada que guardar para después)', async () => {
    const server = new FakeServer();
    server.enableMedia();
    const a = await makeDevice(server);
    devices.push(a);
    const page = await a.tree.create(null, 'Día 3');
    await a.engine.syncNow();
    server.online = false;
    await expect(a.media.addFolder(page, 'Ref', 10)).rejects.toBeTruthy();
    expect((await a.mediaDb.getAll('files')).length).toBe(0);
  });

  it('en el documento es un bloque image con sdmedia://: la cuenta de archivos de la página la ve', () => {
    const doc = new Y.Doc();
    const frag = doc.getXmlFragment(CONTENT_FRAGMENT);
    const group = new Y.XmlElement('blockGroup');
    const container = new Y.XmlElement('blockContainer');
    container.setAttribute('id', 'b1');
    const image = new Y.XmlElement('image');
    image.setAttribute('url', `${MEDIA_SCHEME}11111111-1111-4111-8111-111111111111`);
    image.setAttribute('name', 'Referencias');
    container.insert(0, [image]);
    group.insert(0, [container]);
    frag.insert(0, [group]);
    expect(mediaIdsInDoc(doc).has('11111111-1111-4111-8111-111111111111')).toBe(true);
  });

  it('la tarjeta de una carpeta no trae nada que corra', () => {
    const svg = decodeURIComponent(folderCardUrl({ name: '<script>x</script>', size: 5 * 1024 * 1024 }));
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&#60;script&#62;');
  });

  it('la tarjeta de una carpeta sin nada visible en el nombre dice "Folder", nunca "file.bin"', () => {
    for (const name of ['\u202E', ' \u200B\u2066 ']) {
      const svg = decodeURIComponent(folderCardUrl({ name, size: 5 }));
      expect(svg).not.toContain('file.bin');
      expect(svg).toContain('>Folder<');
    }
  });
});

describe('el cliente del portero con una subida de carpeta', () => {
  it('nunca abre una subida nueva: si el portero ya no la tiene, falla sin uploadId', async () => {
    const calls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push(`${init.method} ${new URL(String(input)).pathname}`);
      return new Response(JSON.stringify({ error: 'This upload expired: start it again.' }), { status: 410 });
    }) as typeof fetch;
    const p = new Portero('https://portero.example', { fetch: fetcher, token: async () => 'jwt', wait: async () => undefined });
    const err = await p.upload(new File(['abc'], 'a.txt'), { resume: 'f.x.y', noOpen: true }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UploadError);
    expect((err as UploadError).uploadId).toBeNull();
    expect(calls).toEqual(['PUT /upload/f.x.y']);
    expect(err).toBeInstanceOf(PorteroError);
  });
});

describe('el cliente del portero: listar varias subcarpetas (dirs)', () => {
  const client = (answer: (body: Record<string, unknown>) => Response) => {
    const sent: Record<string, unknown>[] = [];
    const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      expect(`${init.method} ${new URL(String(input)).pathname}`).toBe('POST /folder/list');
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      sent.push(body);
      return answer(body);
    }) as typeof fetch;
    return { sent, p: new Portero('https://portero.example', { fetch: fetcher, token: async () => 'jwt', wait: async () => undefined }) };
  };

  it('manda { file, dirs, pageToken } (sin dir) y devuelve lists, failed, later y el token', async () => {
    const { p, sent } = client(() =>
      new Response(JSON.stringify({ lists: { a: [{ type: 'shortcut', name: 'x', modified: null }], b: [] }, failed: { c: 'not_found' }, later: ['d'], nextPageToken: 't2' }), { status: 200 }),
    );
    const out = await p.folderListDirs('f1', ['a', 'b', 'c', 'd'], 't1');
    expect(sent).toEqual([{ file: 'f1', dirs: ['a', 'b', 'c', 'd'], pageToken: 't1' }]);
    expect(out).toEqual({ lists: { a: [{ type: 'shortcut', name: 'x', modified: null }], b: [] }, failed: { c: 'not_found' }, later: ['d'], nextPageToken: 't2' });
  });

  it('un portero anterior contesta como con dir (entries, sin lists): null, para listar de a una', async () => {
    const { p } = client(() => new Response(JSON.stringify({ entries: [], nextPageToken: null }), { status: 200 }));
    expect(await p.folderListDirs('f1', ['a'])).toBeNull();
  });

  it('un error del portero llega con su código (por ejemplo, 409 changed o 503 rate)', async () => {
    const { p } = client(() => new Response(JSON.stringify({ error: 'A folder changed while it was being listed: start again.', code: 'changed' }), { status: 409 }));
    await expect(p.folderListDirs('f1', ['a'], 't')).rejects.toMatchObject({ status: 409, code: 'changed' });
  });
});

describe('cleanFileName: la app y el portero aplican la misma regla (el ZWJ de los emojis compuestos)', () => {
  it('con un mismo nombre dan lo mismo: lo que sube la app es lo que lista el portero', () => {
    const family = '👨‍👩‍👧‍👦';
    const corpus = [
      `${family}.jpg`,
      '👩🏽‍💻.png',
      '❤️‍🔥 ok.txt',
      '🏳️‍🌈.pdf',
      'rep‍ort.pdf',
      '‍👨.pdf',
      '👨‍.pdf',
      '👨‍‍👩.pdf',
      '👨‌👩.pdf',
      '👨‌‍👩.pdf',
      '👨​‍👩.pdf',
      'a‍👩 👩‍a.pdf',
      '👨‍ 👩.pdf',
      'x‮y⁦z‎w.txt',
      `Familia ${family} 2026 🇦🇷.pdf`,
      'Día 2 - Puerto',
    ];
    for (const name of corpus) expect(porteroClean(name), JSON.stringify(name)).toBe(appClean(name));
    // Y las dos dejan la familia entera.
    expect(porteroClean(`${family}.jpg`)).toBe(`${family}.jpg`);
  });
});
