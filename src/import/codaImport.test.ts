// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { yXmlFragmentToBlocks } from '@blocknote/core/yjs';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefs } from '../prefs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { driveLinkInContent } from '../ui/driveCard';
import { findUnknownContent } from '../ui/unknownContent';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { schema } from '../ui/editorSchema';
import { checkForeignImages, finishBlocks, namedColor, prepareCodaHtml, type LooseBlock } from './codaHtml';
import {
  checkManifest,
  findResumable,
  folderFromFiles,
  importCoda,
  importSize,
  metaJournal,
  treeOrder,
  treePlan,
  type CodaFolder,
  type CodaManifestPage,
  type ImportDeps,
} from './codaImport';
import { importingElsewhere, importJobFor } from './importJob';
import * as Y from 'yjs';

// jsdom trae su propio File, que la base simulada (fake-indexeddb) no sabe copiar; en el navegador no pasa.
Object.assign(globalThis, { Blob: NodeBlob, File: NodeFile });

// La forma del HTML que exporta Coda: cada foto en `<span style="display: inline-block">` adentro de un
// párrafo o de un ítem de lista, colores en rgb() y todo con estilos en línea.
const img = (blob: string, alt: string, w = 0) =>
  `<span style="display: inline-block;"><img data-coda-blob-id="${blob}" data-coda-mime-type="image/png" alt="${alt}" ` +
  `src="https://codahosted.io/docs/DOC/blobs/${blob}/abc" height="0" width="${w}"></span>`;
const GRAY = 'style="color: rgb(102, 102, 102);"';

const SCENE =
  `<h2 style="margin-top: 0.5em;"><span>Guion:</span></h2>` +
  `<div><span ${GRAY}>3 </span><span style="color: rgb(102, 102, 102); background-color: rgb(248, 231, 243);">EXT</span>` +
  `<span ${GRAY}>. IGLESIA - </span><span style="background-color: rgb(253, 243, 216);">DÍA</span></div>` +
  `<div><span style="background-color: rgb(226, 248, 232);">Plano general.</span></div>` +
  `<h2><span>Brief Sup:</span></h2>` +
  `<ul><li style="list-style-type: disc;"><span ${GRAY}>Chroma 2m</span><br>${img('bl-aaa', 'image.png', 533)}<br>` +
  `<span ${GRAY}>Si no, roto.</span></li><li><span style="font-weight: bold;">Split</span></li></ul>` +
  `<div>${img('bl-bbb', 'bl-xyz')}<br>${img('bl-ccc', 'foto set.png', 1200)}</div><div><br></div><div><br></div>`;

const editors: BlockNoteEditor[] = [];
const devices: Device[] = [];
afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
    d.mediaDb.close();
  }
});

async function convert(html: string): Promise<LooseBlock[]> {
  const editor = BlockNoteEditor.create({ schema }) as unknown as BlockNoteEditor;
  editors.push(editor);
  const { html: prepared, media } = prepareCodaHtml(html);
  const parsed = (await editor.tryParseHTMLToBlocks(prepared)) as unknown as LooseBlock[];
  return finishBlocks(parsed, (i) => ({ type: 'image', props: { url: `sdmedia://${media[i].blobId}` }, children: [] }));
}

const text = (b: LooseBlock) => ((b.content as { text?: string }[]) ?? []).map((c) => c.text ?? '').join('');

/** Las fotos de los bloques, en orden: los bloques `image` y las fotos en línea (`photo`) de cada renglón. */
function mediaIn(list: LooseBlock[]): LooseBlock[] {
  const out: LooseBlock[] = [];
  for (const x of list) {
    if (x.type === 'image') out.push(x);
    if (Array.isArray(x.content)) for (const c of x.content as LooseBlock[]) if (c.type === 'photo') out.push(c);
    out.push(...mediaIn(x.children ?? []));
  }
  return out;
}

describe('HTML de Coda', () => {
  it('ninguna foto se pierde: las de un ítem quedan adentro, las de un párrafo quedan en su lugar', async () => {
    const blocks = await convert(SCENE);
    expect(blocks.map((b) => b.type)).toEqual([
      'heading',
      'paragraph',
      'paragraph',
      'heading',
      'bulletListItem',
      'bulletListItem',
      'image',
      'image',
    ]);
    const item = blocks[4];
    expect(text(item)).toBe('Chroma 2m');
    expect(item.children?.map((c) => [c.type, c.type === 'image' ? c.props?.url : text(c)])).toEqual([
      ['image', 'sdmedia://bl-aaa'],
      ['paragraph', 'Si no, roto.'],
    ]);
    expect(blocks.slice(6).map((b) => b.props?.url)).toEqual(['sdmedia://bl-bbb', 'sdmedia://bl-ccc']);
    expect(JSON.stringify(blocks)).not.toContain('\uE000');
  });

  it('el guion pasa a Script sin los fondos puestos a mano; el gris de cuerpo se saca y el resto de los colores queda', async () => {
    const blocks = await convert(SCENE);
    expect(blocks[1].props?.script).toBe(true);
    expect(blocks[2].props?.script).toBe(true);
    const styles = (blocks[1].content as { text: string; styles: Record<string, unknown> }[]).map((c) => [c.text, c.styles]);
    expect(styles).toEqual([['3 EXT. IGLESIA - DÍA', {}]]);
    expect((blocks[2].content as { styles: object }[])[0].styles).toEqual({ backgroundColor: 'green' });
    expect((blocks[5].content as { styles: object }[])[0].styles).toEqual({ bold: true });
  });

  it('colores de Coda al color más parecido del editor', () => {
    expect(namedColor('rgb(102, 102, 102)', 'text')).toBeNull();
    expect(namedColor('rgb(226, 248, 232)', 'background')).toBe('green');
    expect(namedColor('rgb(248, 231, 243)', 'background')).toBe('pink');
    expect(namedColor('rgb(253, 243, 216)', 'background')).toBe('yellow');
    expect(namedColor('rgb(221, 237, 253)', 'background')).toBe('blue');
    expect(namedColor('rgb(255, 255, 255)', 'background')).toBeNull();
    expect(namedColor('rgb(220, 30, 30)', 'text')).toBe('red');
    // El verde muy claro de Coda (~88°) es verde, no amarillo; también escrito en hexadecimal.
    expect(namedColor('rgb(241, 248, 233)', 'background')).toBe('green');
    expect(namedColor('#f1f8e9', 'background')).toBe('green');
    expect(namedColor('#fff', 'background')).toBeNull();
    expect(namedColor('rgb(255, 245, 200)', 'background')).toBe('yellow');
  });

  it('un párrafo con solo un link no es un párrafo vacío (al principio, seguidos y al final)', async () => {
    const link = (u: string) => `<div><span><a href="https://${u}">${u}</a></span></div>`;
    const blocks = await convert(link('a.com') + '<div><br></div>' + link('b.com') + link('c.com') + '<div><br></div>' + link('d.com'));
    const links = JSON.stringify(blocks).match(/https:\/\/[a-d]\.com/g);
    expect(links).toEqual(['https://a.com', 'https://b.com', 'https://c.com', 'https://d.com']);
  });

  it('una foto adentro de un link sale del link y queda como foto', async () => {
    const blocks = await convert(`<div><a href="https://x.com">ver ${img('bl-l', 'l.png')}</a></div><div><a href="https://y.com">${img('bl-m', 'm.png')}</a></div>`);
    expect(JSON.stringify(blocks)).not.toContain('\uE000');
    expect(blocks.filter((b) => b.type === 'image').map((b) => b.props?.url)).toEqual(['sdmedia://bl-l', 'sdmedia://bl-m']);
    expect(JSON.stringify(blocks)).toContain('https://x.com');
  });

  it('un título con solo una foto no deja un título vacío ni corta el guion', async () => {
    const blocks = await convert(`<h2>Guion:</h2><h3>${img('bl-h', 'h.png')}</h3><div><span>1 INT. CASA - NOCHE</span></div>`);
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'image', 'paragraph']);
    expect(blocks[2].props?.script).toBe(true);
  });

  it('un video de Coda (<video><source>) queda como bloque, no se pierde', async () => {
    const src = 'https://codahosted.io/docs/DOC/blobs/bl-v/abc';
    const blocks = await convert(`<div><video controls><source src="${src}" type="video/mp4"></video></div>`);
    expect(blocks.map((b) => [b.type, b.props?.url])).toEqual([['image', 'sdmedia://bl-v']]);
  });

  it('una foto en una tabla va debajo de la tabla', async () => {
    const blocks = await convert(`<table><tr><td>a ${img('bl-t', 'x.png')}</td><td>b</td></tr></table>`);
    expect(blocks.map((b) => b.type)).toEqual(['table', 'image']);
    expect(JSON.stringify(blocks[0])).not.toContain('\uE000');
  });
});

describe('importar la carpeta', () => {
  const page = (id: string, name: string, parentId: string | null, order: number, media: string[] = []): CodaManifestPage => ({
    id,
    name,
    parentId,
    order,
    contentType: 'canvas',
    file: `${id}.html`,
    media: media.map((b) => ({ url: `https://codahosted.io/docs/DOC/blobs/${b}/abc`, file: `${b}.png` })),
  });

  function makeFolder(): CodaFolder {
    const bytes = (n: number) => new Uint8Array(n).map((_, i) => i % 251);
    const files = new Map<string, string | Uint8Array<ArrayBuffer>>([
      ['pages/root.html', '<h2><span>Datos</span></h2><ul><li><span>Rodaje</span></li></ul>'],
      ['pages/uy.html', '<div><br></div>'],
      ['pages/s1.html', SCENE],
      ['pages/s2.html', `<div>${img('bl-ddd', 'otra.png')}</div>`],
      ['media/bl-aaa.png', bytes(3000)],
      ['media/bl-bbb.png', bytes(4000)],
      ['media/bl-ccc.png', bytes(5000)],
      ['media/bl-ddd.png', bytes(6000)],
    ]);
    return {
      manifest: {
        doc: { id: 'DOC', name: 'MGTZD' },
        // Desordenadas a propósito: el orden sale de `parentId` y `order`.
        pages: [
          page('s2', '002 | Segunda | Calle', 'uy', 1, ['bl-ddd']),
          page('root', 'MGTZD | Planning', null, 0),
          page('s1', '001 | Primera | Iglesia', 'uy', 0, ['bl-aaa', 'bl-bbb', 'bl-ccc']),
          page('uy', 'Uruguay', 'root', 0),
        ],
      },
      has: (p) => files.has(p),
      paths: () => [...files.keys()],
      text: async (p) => String(files.get(p)),
      file: async (p) => new Blob([files.get(p) as Uint8Array<ArrayBuffer>]),
      size: (p) => (files.get(p) as { length?: number } | undefined)?.length ?? 0,
    };
  }

  it('el árbol sale en orden: cada padre antes que sus hijas', () => {
    expect(treeOrder(makeFolder().manifest.pages).map((p) => p.id)).toEqual(['root', 'uy', 's1', 's2']);
  });

  it('crea el proyecto con sus páginas, sube cada archivo al Drive y otro dispositivo ve las fotos', async () => {
    const server = new FakeServer();
    server.enableMedia();
    const a = await makeDevice(server);
    devices.push(a);
    await a.engine.syncNow();

    const result = await importCoda(makeFolder(), a, { projectName: 'MGTZD (prueba)' });
    expect(result).toMatchObject({ pages: 4, files: 4, problems: [] });
    await a.media.idle();
    for (let i = 0; i < 4; i++) {
      await a.engine.syncNow();
      await a.engine.syncMedia();
    }

    expect(server.projects.get(result.projectId)?.name).toBe('MGTZD (prueba)');
    const pages = [...server.pages.values()].filter((p) => p.workspace_id === result.projectId);
    const byTitle = new Map(pages.map((p) => [p.title, p]));
    expect(byTitle.get('Uruguay')?.parent_id).toBe(byTitle.get('MGTZD | Planning')?.id);
    const scenes = pages.filter((p) => p.parent_id === byTitle.get('Uruguay')?.id).sort((x, y) => (x.sort_key < y.sort_key ? -1 : 1));
    expect(scenes.map((p) => p.title)).toEqual(['001 | Primera | Iglesia', '002 | Segunda | Calle']);

    // En Drive, en la carpeta del proyecto, con los mismos bytes.
    const drive = [...server.portero.drive.values()];
    expect(drive.map((d) => d.data.length).sort()).toEqual([3000, 4000, 5000, 6000]);
    expect(new Set(drive.map((d) => d.folder))).toEqual(new Set(['LGA_ShotDocs/MGTZD (prueba)']));
    // Un nombre que no es de archivo (`bl-xyz`) queda como `bl-….png`.
    expect(drive.map((d) => d.name).sort()).toEqual(['bl-bbb.png', 'foto set.png', 'image.png', 'otra.png']);

    // Otro dispositivo, de cero: la página trae los bloques con las fotos de la base.
    const b = await makeDevice(server);
    devices.push(b);
    await b.engine.syncNow();
    const doc = await b.docs.open(byTitle.get('001 | Primera | Iglesia')!.id);
    const editor = BlockNoteEditor.create({ schema }) as unknown as BlockNoteEditor;
    const blocks = yXmlFragmentToBlocks(editor, doc.getXmlFragment(CONTENT_FRAGMENT)) as unknown as LooseBlock[];
    const urls = mediaIn(blocks).map((x) => String(x.props?.url));
    expect(urls).toHaveLength(3);
    const ids = new Set([...server.mediaFiles.values()].filter((f) => f.drive_id).map((f) => `sdmedia://${f.id}`));
    for (const url of urls) expect(ids.has(url)).toBe(true);
    // Las fotos van en su renglón (entrega 4 de las fotos en línea), con la parte del renglón de Coda que ocupaban
    // (533 de 624 px); la de 1200 px, todo el renglón.
    const [first] = blocks.filter((x) => x.type === 'bulletListItem');
    expect(mediaIn([first]).map((x) => [x.type, x.props?.w])).toEqual([['photo', 0.8542]]);
    expect(mediaIn(blocks).map((x) => x.props?.w)).toEqual([0.8542, 0, 1]);
    // La app lo abre: nada que la guarda no conozca y una sola raíz (ninguna reparación escondida).
    expect(findUnknownContent(doc)).toBeNull();
    expect(doc.getXmlFragment(CONTENT_FRAGMENT).length).toBe(1);
    b.docs.close(byTitle.get('001 | Primera | Iglesia')!.id);
  });

  it('una página que falla queda anotada y las demás se importan igual', async () => {
    const server = new FakeServer();
    server.enableMedia();
    const a = await makeDevice(server);
    devices.push(a);
    await a.engine.syncNow();
    const folder = makeFolder();
    const text = folder.text;
    folder.text = async (p) => (p === 'pages/s1.html' ? Promise.reject(new Error('disco roto')) : text(p));
    const result = await importCoda(folder, a);
    expect(result.problems).toEqual(['001 | Primera | Iglesia: disco roto']);
    expect(result.files).toBe(1);
    await a.engine.syncNow();
    expect([...server.pages.values()].filter((p) => p.workspace_id === result.projectId)).toHaveLength(4);
  });

  it('sin Drive conectado no empieza: las fotos no tendrían adónde ir', async () => {
    const server = new FakeServer();
    const a = await makeDevice(server);
    devices.push(a);
    await expect(importCoda(makeFolder(), a)).rejects.toThrow(/Google Drive/);
    expect(server.projects.size).toBe(1);
  });

  // --- Correcciones de la auditoría ---------------------------------------------------------------------

  async function mediaDevice(): Promise<{ server: FakeServer; a: Device }> {
    const server = new FakeServer();
    server.enableMedia();
    const a = await makeDevice(server);
    devices.push(a);
    await a.engine.syncNow();
    return { server, a };
  }

  /** Una carpeta chica a mano: páginas (id → HTML) y archivos de media. */
  function smallFolder(pages: CodaManifestPage[], html: Record<string, string>, media: string[] = [], extra: { problems?: string[] } = {}): CodaFolder {
    const files = new Map<string, string | Uint8Array<ArrayBuffer>>();
    for (const [id, h] of Object.entries(html)) files.set(`pages/${id}.html`, h);
    for (const [i, b] of media.entries()) files.set(`media/${b}.png`, new Uint8Array(1000 + i).map((_, j) => j % 251));
    return {
      manifest: { doc: { id: 'DOC2', name: 'Chico' }, pages, ...extra },
      has: (p) => files.has(p),
      paths: () => [...files.keys()],
      text: async (p) => String(files.get(p)),
      file: async (p) => new Blob([files.get(p) as Uint8Array<ArrayBuffer>]),
      size: (p) => (files.get(p) as { length?: number } | undefined)?.length ?? 0,
    };
  }

  /** Todas las páginas de un proyecto en el dispositivo (el árbol entero). */
  function projectPages(d: Device, projectId: string) {
    const out = [];
    const queue = [...d.tree.roots(projectId)];
    while (queue.length) {
      const p = queue.shift()!;
      out.push(p);
      queue.push(...d.tree.children(p.id));
    }
    return out;
  }

  /** Las fotos de una página (bloques `image` y fotos en línea), como las ve la app. */
  async function imagesOf(d: Device, pageId: string): Promise<LooseBlock[]> {
    const doc = await d.docs.open(pageId);
    const editor = BlockNoteEditor.create({ schema }) as unknown as BlockNoteEditor;
    const blocks = yXmlFragmentToBlocks(editor, doc.getXmlFragment(CONTENT_FRAGMENT)) as unknown as LooseBlock[];
    d.docs.close(pageId);
    return mediaIn(blocks);
  }

  it('cortada a mitad, se sigue en el mismo proyecto sin repetir páginas ni archivos (nada duplicado en el Drive)', async () => {
    const { server, a } = await mediaDevice();
    const journal = metaJournal(a.db);
    const added: string[] = [];
    let opens = 0;
    let crashAt = 's2';
    const deps: ImportDeps = {
      tree: a.tree,
      docs: {
        // La tercera página (s1) no se puede escribir en la primera vuelta: sus fotos ya quedaron guardadas.
        open: (id, o) => (++opens === 3 && crashAt ? Promise.reject(new Error('sin espacio')) : a.docs.open(id, o)),
        close: (id) => a.docs.close(id),
        flush: (id) => a.docs.flush(id),
      },
      media: {
        add: async (pageId, file) => {
          added.push((file as File).name);
          return a.media.add(pageId, file);
        },
        get enabled() {
          return a.media.enabled;
        },
      },
      journal,
    };
    const folder = makeFolder();
    // Y la app se cierra al empezar la página siguiente (s2).
    const first = importCoda(folder, deps, {
      projectName: 'Cortado',
      onProgress: (p) => {
        if (p.page.startsWith('002') && crashAt) throw new Error('se cerró la app');
      },
    });
    await expect(first).rejects.toThrow('se cerró la app');
    expect(added.sort()).toEqual(['bl-bbb.png', 'foto set.png', 'image.png']);
    const resumable = await findResumable(folder, { tree: a.tree, journal });
    expect(resumable).toMatchObject({ projectName: 'Cortado', done: 2, total: 4 });
    const projects = a.tree.projects().length;

    crashAt = '';
    const result = await importCoda(folder, deps, { projectName: 'otro nombre', resume: true });
    expect(result.projectId).toBe(resumable!.projectId);
    expect(result).toMatchObject({ pages: 4, files: 4, problems: [] });
    // Solo el archivo de s2 se guardó en la segunda vuelta; los de s1 se reusaron.
    expect(added.sort()).toEqual(['bl-bbb.png', 'foto set.png', 'image.png', 'otra.png']);
    expect(await journal.get('DOC')).toBeUndefined();

    await a.media.idle();
    for (let i = 0; i < 4; i++) {
      await a.engine.syncNow();
      await a.engine.syncMedia();
    }
    expect(a.tree.projects().length).toBe(projects);
    expect(server.projects.size).toBe(projects);
    expect([...server.pages.values()].filter((p) => p.workspace_id === result.projectId)).toHaveLength(4);
    expect(server.portero.drive.size).toBe(4);
    const s1 = [...server.pages.values()].find((p) => p.title === '001 | Primera | Iglesia')!;
    expect(await imagesOf(a, s1.id)).toHaveLength(3);
  });

  it('una página que no se pudo escribir anota que sus archivos quedaron guardados sin ubicar', async () => {
    const { a } = await mediaDevice();
    let opens = 0;
    const deps: ImportDeps = {
      ...a,
      docs: { open: (id, o) => (++opens === 3 ? Promise.reject(new Error('sin espacio')) : a.docs.open(id, o)), close: a.docs.close.bind(a.docs), flush: a.docs.flush.bind(a.docs) },
    };
    const result = await importCoda(makeFolder(), deps);
    expect(result.problems).toEqual([
      '001 | Primera | Iglesia: 3 files were saved but the page could not be written; resume the import to place them',
      '001 | Primera | Iglesia: sin espacio',
    ]);
  });

  it('una importación en curso cuenta como algo sin guardar (beforeunload) y su estado no depende del diálogo', async () => {
    const key = {};
    const job = importJobFor(key);
    expect(importJobFor(key)).toBe(job);
    job.show();
    let finish!: () => void;
    const running = job.run(
      (onProgress) =>
        new Promise((resolve) => {
          onProgress({ done: 1, total: 3, page: 'B' });
          finish = () => resolve({ projectId: 'p', pages: 3, files: 0, comments: 0, problems: [], exportProblems: [], resumable: false });
        }),
    );
    expect(job.get()).toMatchObject({ running: true, open: true, progress: { done: 1, page: 'B' } });
    // Mientras corre no se cierra.
    job.close();
    expect(job.get().open).toBe(true);
    finish();
    await running;
    expect(job.get()).toMatchObject({ running: false, result: { projectId: 'p' } });
    job.close();
    expect(job.get()).toMatchObject({ open: false, result: null });
  });

  it('los textos salen en el idioma de la app (en castellano, los errores y la lista del final)', async () => {
    act(() => prefs.set({ language: 'es' }));
    try {
      const server = new FakeServer();
      const off = await makeDevice(server);
      devices.push(off);
      await expect(importCoda(makeFolder(), off)).rejects.toThrow('Primero conectá Google Drive');
      const { a } = await mediaDevice();
      const folder = makeFolder();
      const has = folder.has;
      folder.has = (p) => p !== 'media/bl-ddd.png' && has(p);
      folder.paths = () => ['pages/s2.html'];
      const result = await importCoda(folder, a);
      expect(result.problems).toEqual(['002 | Segunda | Calle: falta el archivo bl-ddd']);
      await expect(folderFromFiles([new File(['{}'], 'x.txt')])).rejects.toThrow('no tiene manifest.json');
    } finally {
      act(() => prefs.set({ language: 'en' }));
    }
  });

  it('una foto que no está en Coda: https queda enlazada y anotada; http o data: se saca y se anota', async () => {
    const { a } = await mediaDevice();
    const html =
      `<div>arriba <img src="https://example.com/a.png" width="300"> abajo</div>` +
      `<div><img src="http://example.com/b.png"></div>` +
      `<img src="data:image/png;base64,AAAA">` +
      `<div>${img('bl-k', 'k.png')}</div>`;
    const result = await importCoda(smallFolder([page('p', 'Fotos', null, 0, ['bl-k'])], { p: html }, ['bl-k']), a);
    expect(result.problems).toEqual([
      'Fotos: an image not stored in Coda stays linked to its site: https://example.com/a.png',
      'Fotos: an image not stored in Coda was left out: http://example.com/b.png',
      'Fotos: an image not stored in Coda was left out: data:image/png;base64,AAAA',
    ]);
    const pageId = [...a.tree.children(null)].find((p) => p.title === 'Fotos')!.id;
    const urls = (await imagesOf(a, pageId)).map((b) => String(b.props?.url));
    expect(urls).toHaveLength(2);
    expect(urls[0]).toBe('https://example.com/a.png');
    expect(urls[1]).toMatch(/^sdmedia:\/\//);
  });

  it('checkForeignImages: deja las sdmedia y las https, saca el resto (también adentro de un ítem)', () => {
    const notes: [string, boolean][] = [];
    const out = checkForeignImages(
      [
        { type: 'image', props: { url: 'sdmedia://1' } },
        { type: 'bulletListItem', children: [{ type: 'image', props: { url: 'ftp://x/y.png' } }, { type: 'image', props: { url: 'https://x/z.png' } }] },
      ],
      (url, kept) => notes.push([url, kept]),
    );
    expect(notes).toEqual([
      ['ftp://x/y.png', false],
      ['https://x/z.png', true],
    ]);
    expect(out[1].children?.map((c) => c.props?.url)).toEqual(['https://x/z.png']);
  });

  it('el manifest se revisa: sin páginas es un error claro; lo que falta toma valores por defecto', async () => {
    expect(() => checkManifest({ doc: { id: 'x' } })).toThrow(/manifest\.json/);
    expect(() => checkManifest(null)).toThrow(/manifest\.json/);
    await expect(folderFromFiles([new File(['{no'], 'manifest.json')])).rejects.toThrow(/manifest\.json/);
    const m = checkManifest({ pages: [{ id: 'a' }, { id: 'a', name: 3, media: 'no', order: 'x' }, 7] });
    expect(m.doc.name).toBe('Untitled project');
    expect(m.pages.map((p) => [p.name, p.order, p.media.length, p.contentType])).toEqual([
      ['', 0, 0, 'canvas'],
      ['', 1, 0, 'canvas'],
    ]);
    // El id repetido: cada una recibe uno propio, derivado de lo que tiene.
    expect(m.pages[0].id).toMatch(/^a#/);
    expect(m.pages[1].id).toMatch(/^a#/);
    expect(m.pages[0].id).not.toBe(m.pages[1].id);
  });

  it('una página sin nombre entra como "Untitled"; un padre que falta o un círculo van al primer nivel, anotados', async () => {
    const pages = [page('a', 'A', 'b', 0), page('b', 'B', 'a', 1), page('c', 'C', 'nadie', 2), page('d', '', 'c', 0)];
    const plan = treePlan(pages);
    expect(plan.pages.map((p) => [p.id, p.parentId])).toEqual([
      ['c', null],
      ['d', 'c'],
      ['a', null],
      ['b', 'a'],
    ]);
    expect(plan.reattached.map((p) => p.id)).toEqual(['c', 'a']);

    const { server, a } = await mediaDevice();
    const result = await importCoda(smallFolder(pages, { a: '<p>a</p>', b: '<p>b</p>', c: '<p>c</p>', d: '<p>d</p>' }), a);
    expect(result.problems).toEqual([
      'C: went to the top level: its parent page is missing or the pages loop',
      'A: went to the top level: its parent page is missing or the pages loop',
    ]);
    await a.engine.syncNow();
    const rows = [...server.pages.values()].filter((p) => p.workspace_id === result.projectId);
    const byTitle = new Map(rows.map((p) => [p.title, p]));
    expect(rows).toHaveLength(4);
    expect(byTitle.get('Untitled')?.parent_id).toBe(byTitle.get('C')?.id);
    expect(byTitle.get('B')?.parent_id).toBe(byTitle.get('A')?.id);
    expect(byTitle.get('A')?.parent_id).toBeNull();
  });

  it('una página que no es texto queda anotada, y lo que anotó coda-export se muestra al final', async () => {
    const { a } = await mediaDevice();
    const table = { ...page('t', 'Tabla', null, 1), contentType: 'embed', file: 't.html' };
    const result = await importCoda(
      smallFolder([page('p', 'Texto', null, 0), table], { p: '<p>hola</p>' }, [], { problems: ['Tabla: página de tipo "embed", no se exporta'] }),
      a,
    );
    expect(result.problems).toEqual(['Tabla: a “embed” page (not text): it comes in empty']);
    expect(result.exportProblems).toEqual(['Tabla: página de tipo "embed", no se exporta']);
  });

  it('el mismo archivo dos veces en una página se guarda una vez', async () => {
    const { a } = await mediaDevice();
    const add = vi.spyOn(a.media, 'add');
    const html = `<div>${img('bl-d', 'd.png')}</div><p>medio</p><div>${img('bl-d', 'd.png')}</div>`;
    const result = await importCoda(smallFolder([page('p', 'Dos', null, 0, ['bl-d'])], { p: html }, ['bl-d']), a);
    expect(result).toMatchObject({ files: 1, problems: [] });
    expect(add).toHaveBeenCalledTimes(1);
    const pageId = [...a.tree.children(null)].find((p) => p.title === 'Dos')!.id;
    const urls = (await imagesOf(a, pageId)).map((b) => b.props?.url);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toBe(urls[1]);
  });

  it('links entre páginas del doc: A ↔ B (un ciclo) quedan como links internos a las páginas creadas', async () => {
    const { a } = await mediaDevice();
    const folder = smallFolder(
      [page('canvas-A', 'Plano A', null, 0), page('canvas-B', 'Plano B', 'canvas-A', 0)],
      {
        'canvas-A': '<div><a href="coda-page:canvas-B">Plano 12</a> y <a href="coda-page:canvas-X">otra</a></div>',
        'canvas-B': '<table><tbody><tr><td><a href="coda-page:canvas-A">volver</a></td></tr></tbody></table>',
      },
    );
    const result = await importCoda(folder, a);
    const byTitle = new Map(projectPages(a, result.projectId).map((p) => [p.title, p.id]));
    const idA = byTitle.get('Plano A')!;
    const idB = byTitle.get('Plano B')!;
    const linksOf = async (pageId: string) => {
      const doc = await a.docs.open(pageId);
      const xml = doc.getXmlFragment(CONTENT_FRAGMENT).toString();
      a.docs.close(pageId);
      return [...xml.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    };
    expect(await linksOf(idA)).toEqual([`/p/${idB}`]);
    expect(await linksOf(idB)).toEqual([`/p/${idA}`]);
    // El que va a una página que no está en la exportación queda como texto y anotado (una vez).
    expect(result.problems).toEqual(['Plano A: a link to another page stays as text (that page is not in the import): “otra”']);
    const doc = await a.docs.open(idA);
    expect(doc.getXmlFragment(CONTENT_FRAGMENT).toString()).toContain('otra');
    expect(findUnknownContent(doc)).toBeNull();
    a.docs.close(idA);
  });

  it('cortada a mitad, al seguir los links salen a las mismas páginas (no se crean de nuevo)', async () => {
    const { a } = await mediaDevice();
    const journal = metaJournal(a.db);
    const folder = smallFolder(
      [page('p1', 'Uno', null, 0), page('p2', 'Dos', null, 1)],
      { p1: '<div><a href="coda-page:p2">a dos</a></div>', p2: '<div><a href="coda-page:p1">a uno</a></div>' },
    );
    let crash = true;
    const deps: ImportDeps = { tree: a.tree, docs: a.docs, media: a.media, journal };
    await expect(
      importCoda(folder, deps, {
        onProgress: (p) => {
          if (p.page === 'Dos' && crash) throw new Error('se cerró la app');
        },
      }),
    ).rejects.toThrow('se cerró la app');
    const before = a.tree.projects().flatMap((pr) => projectPages(a, pr.id)).filter((p) => p.title === 'Uno' || p.title === 'Dos').length;
    expect(before).toBe(2);
    crash = false;
    const result = await importCoda(folder, deps, { resume: true });
    expect(result.problems).toEqual([]);
    const pages = projectPages(a, result.projectId);
    expect(pages).toHaveLength(2);
    const id = (title: string) => pages.find((p) => p.title === title)!.id;
    // Los dos sentidos: Uno (escrita antes del corte) apunta a Dos, creada en la pre-pasada.
    for (const [from, to] of [['Uno', 'Dos'], ['Dos', 'Uno']]) {
      const doc = await a.docs.open(id(from));
      expect(doc.getXmlFragment(CONTENT_FRAGMENT).toString()).toContain(`href="/p/${id(to)}"`);
      a.docs.close(id(from));
    }
  });

  it('si la madre no se pudo crear en la pre-pasada, la hija espera y queda adentro de ella', async () => {
    const { a } = await mediaDevice();
    let failOnce = true;
    const create = a.tree.create.bind(a.tree);
    vi.spyOn(a.tree, 'create').mockImplementation((parent, title, project) => {
      if (title === 'Madre' && failOnce) {
        failOnce = false;
        return Promise.reject(new Error('un instante sin espacio'));
      }
      return create(parent, title, project);
    });
    const tree = a.tree;
    const folder = smallFolder([page('m', 'Madre', null, 0), page('h', 'Hija', 'm', 0)], { m: '<div>m</div>', h: '<div>h</div>' });
    const result = await importCoda(folder, { tree, docs: a.docs, media: a.media });
    expect(result.problems).toEqual([]);
    const roots = a.tree.roots(result.projectId).map((p) => p.title);
    expect(roots).toEqual(['Madre']);
    expect(a.tree.children(a.tree.roots(result.projectId)[0].id).map((p) => p.title)).toEqual(['Hija']);
  });

  it('al seguir, una página terminada no presta su archivo (pudo quedar sin uso): la que falta guarda su copia', async () => {
    const { a } = await mediaDevice();
    const journal = metaJournal(a.db);
    const html = `<div>${img('bl-r', 'r.png')}</div>`;
    const folder = smallFolder([page('p1', 'Uno', null, 0, ['bl-r']), page('p2', 'Dos', null, 1, ['bl-r'])], { p1: html, p2: html }, ['bl-r']);
    const add = vi.spyOn(a.media, 'add');
    let crash = true;
    const deps: ImportDeps = { tree: a.tree, docs: a.docs, media: a.media, journal };
    await expect(
      importCoda(folder, deps, {
        onProgress: (p) => {
          if (p.page === 'Dos' && crash) throw new Error('se cerró la app');
        },
      }),
    ).rejects.toThrow('se cerró la app');
    expect(add).toHaveBeenCalledTimes(1);
    crash = false;
    const result = await importCoda(folder, deps, { resume: true });
    expect(result).toMatchObject({ files: 2, problems: [] });
    expect(add).toHaveBeenCalledTimes(2);
  });

  it('una página que solo usa archivos de otra y no se pudo escribir no dice "0 archivos guardados"', async () => {
    const { a } = await mediaDevice();
    const html = `<div>${img('bl-r', 'r.png')}</div>`;
    const folder = smallFolder([page('p1', 'Uno', null, 0, ['bl-r']), page('p2', 'Dos', null, 1, ['bl-r'])], { p1: html, p2: html }, ['bl-r']);
    const journal = metaJournal(a.db);
    let opens = 0;
    const deps: ImportDeps = {
      tree: a.tree,
      docs: { open: (id, o) => (++opens === 2 ? Promise.reject(new Error('sin espacio')) : a.docs.open(id, o)), close: (id) => a.docs.close(id), flush: (id) => a.docs.flush(id) },
      media: a.media,
      journal,
    };
    const result = await importCoda(folder, deps);
    expect(result.problems).toEqual(['Dos: sin espacio']);
    // En el diario, la página que usa el archivo de otra queda marcada (no se cuenta dos veces al seguir).
    const saved = await journal.get('DOC2');
    expect(saved?.media['p2 bl-r']).toMatchObject({ shared: true });
    expect(saved?.media['p1 bl-r']).toMatchObject({ key: 'bl-r' });
  });

  it('una página embebida con archivo (lo que mostraba, traído por el comando) se importa como cualquier otra', async () => {
    const { a } = await mediaDevice();
    const embed = { ...page('e1', 'Reporte embebido', null, 0), contentType: 'embed' };
    const result = await importCoda(smallFolder([embed], { e1: '<div><a href="https://www.youtube.com/watch?v=1">video</a></div>' }), a);
    expect(result.problems).toEqual([]);
    const id = a.tree.roots(result.projectId)[0].id;
    const doc = await a.docs.open(id);
    expect(doc.getXmlFragment(CONTENT_FRAGMENT).toString()).toContain('https://www.youtube.com/watch?v=1');
    a.docs.close(id);
  });

  it('el mismo archivo en varias páginas se guarda y se sube una vez; cada página lo usa (page_files)', async () => {
    const { server, a } = await mediaDevice();
    const add = vi.spyOn(a.media, 'add');
    const html = `<div>${img('bl-r', 'r.png')}</div>`;
    const folder = smallFolder(
      [page('t', 'Tabla', null, 0, ['bl-r']), page('v1', 'Vista 1', 't', 0, ['bl-r']), page('v2', 'Vista 2', 't', 1, ['bl-r'])],
      { t: html, v1: html, v2: html },
      ['bl-r'],
    );
    const result = await importCoda(folder, a);
    expect(result).toMatchObject({ files: 1, problems: [] });
    expect(add).toHaveBeenCalledTimes(1);
    const pages = projectPages(a, result.projectId);
    const urls = new Set<string>();
    for (const p of pages) for (const b of await imagesOf(a, p.id)) urls.add(String(b.props?.url));
    expect(urls.size).toBe(1);
    await a.media.idle();
    for (let i = 0; i < 4; i++) {
      await a.engine.syncNow();
      await a.engine.syncMedia();
    }
    expect(server.portero.drive.size).toBe(1);
    const fileId = [...urls][0].slice('sdmedia://'.length);
    expect(new Set([...server.pageFiles].filter((k) => k.endsWith(`:${fileId}`)).map((k) => k.split(':')[0]))).toEqual(
      new Set(pages.map((p) => p.id)),
    );
  });

  it('entre página y página el navegador respira, y el progreso dice qué página va (de 0 a N terminadas)', async () => {
    const { a } = await mediaDevice();
    const seen: [number, string, boolean][] = [];
    let ticked = false;
    await importCoda(makeFolder(), a, {
      onProgress: (p) => {
        seen.push([p.done, p.page, ticked]);
        ticked = false;
        setTimeout(() => (ticked = true), 0);
      },
    });
    expect(seen.map(([d, p]) => [d, p])).toEqual([
      [0, 'MGTZD | Planning'],
      [1, 'Uruguay'],
      [2, '001 | Primera | Iglesia'],
      [3, '002 | Segunda | Calle'],
      [4, ''],
    ]);
    // Antes de cada página después de la primera corrió una tarea del navegador.
    expect(seen.slice(1, 4).every(([, , t]) => t)).toBe(true);
  });

  it('el peso de lo que se va a importar cuenta cada archivo una vez', () => {
    const folder = makeFolder();
    folder.manifest.pages[0].media.push({ url: 'x', file: 'bl-aaa.png' });
    expect(importSize(folder)).toBe(3000 + 4000 + 5000 + 6000);
  });

  // --- Segunda verificación -----------------------------------------------------------------------------

  /** Dependencias que cuentan qué archivos se guardan y dejan hacer fallar `docs.open` o `media.add`. */
  function spyDeps(a: Device, opts: { failOpen?: (n: number) => boolean; failAdd?: (name: string) => boolean } = {}) {
    const added: string[] = [];
    let opens = 0;
    const deps: ImportDeps = {
      tree: a.tree,
      docs: {
        open: (id, o) => (opts.failOpen?.(++opens) ? Promise.reject(new Error('sin espacio')) : a.docs.open(id, o)),
        close: (id) => a.docs.close(id),
        flush: (id) => a.docs.flush(id),
      },
      media: {
        add: async (pageId, file) => {
          const name = (file as File).name;
          if (opts.failAdd?.(name)) throw new Error('QuotaExceededError');
          added.push(name);
          return a.media.add(pageId, file);
        },
        get enabled() {
          return a.media.enabled;
        },
      },
      journal: metaJournal(a.db),
    };
    return { deps, added };
  }

  function findPage(d: Device, title: string): string {
    const seen: string[] = [];
    const walk = (parent: string | null) => {
      for (const p of d.tree.children(parent)) {
        if (p.title === title) seen.push(p.id);
        walk(p.id);
      }
    };
    walk(null);
    expect(seen, title).toHaveLength(1);
    return seen[0];
  }

  /** Lo que escribe la persona en la página (en el primer párrafo, como en el editor). */
  async function typeInto(d: Device, pageId: string, words: string): Promise<void> {
    const doc = await d.docs.open(pageId, { seed: true });
    const fragment = doc.getXmlFragment(CONTENT_FRAGMENT);
    const find = (node: Y.XmlFragment | Y.XmlElement): Y.XmlElement | null => {
      for (const child of node.toArray()) {
        if (child instanceof Y.XmlElement) {
          if (child.nodeName === 'paragraph') return child;
          const inner = find(child);
          if (inner) return inner;
        }
      }
      return null;
    };
    const paragraph = find(fragment)!;
    doc.transact(() => {
      const text = paragraph.toArray().find((c): c is Y.XmlText => c instanceof Y.XmlText);
      if (text) text.insert(0, words);
      else paragraph.insert(0, [new Y.XmlText(words)]);
    });
    await d.docs.flush(pageId);
    d.docs.close(pageId);
  }

  async function pageText(d: Device, pageId: string): Promise<string> {
    const doc = await d.docs.open(pageId);
    const text = doc.getXmlFragment(CONTENT_FRAGMENT).toString();
    d.docs.close(pageId);
    return text;
  }

  it('si una página falló, la importación se puede seguir: el diario queda y al seguir se ubican sus archivos sin volver a guardarlos', async () => {
    const { server, a } = await mediaDevice();
    const first = spyDeps(a, { failOpen: (n) => n === 3 });
    const folder = makeFolder();
    const result = await importCoda(folder, first.deps);
    expect(result.problems[0]).toMatch(/3 files were saved/);
    expect(result.resumable).toBe(true);
    const resumable = await findResumable(folder, { tree: a.tree, journal: first.deps.journal });
    expect(resumable).toMatchObject({ projectId: result.projectId, done: 3, total: 4 });

    const second = spyDeps(a);
    const again = await importCoda(folder, second.deps, { resume: true });
    expect(again).toMatchObject({ projectId: result.projectId, problems: [], resumable: false });
    // Nada se guardó de nuevo: los tres archivos de s1 ya estaban.
    expect(second.added).toEqual([]);
    expect(await first.deps.journal!.get('DOC')).toBeUndefined();
    expect(await imagesOf(a, findPage(a, '001 | Primera | Iglesia'))).toHaveLength(3);
    await a.media.idle();
    for (let i = 0; i < 4; i++) {
      await a.engine.syncNow();
      await a.engine.syncMedia();
    }
    expect(server.portero.drive.size).toBe(4);
  });

  it('sin espacio a mitad de una página: al seguir se reintenta solo el archivo que faltó y la página queda completa', async () => {
    const { a } = await mediaDevice();
    const folder = makeFolder();
    const first = spyDeps(a, { failAdd: (name) => name === 'foto set.png' });
    const result = await importCoda(folder, first.deps);
    expect(result.problems).toEqual(['001 | Primera | Iglesia: foto set.png: QuotaExceededError']);
    expect(result.resumable).toBe(true);
    const s1 = findPage(a, '001 | Primera | Iglesia');
    expect(await imagesOf(a, s1)).toHaveLength(2);

    const second = spyDeps(a);
    const again = await importCoda(folder, second.deps, { resume: true });
    expect(again).toMatchObject({ problems: [], resumable: false, files: 4 });
    expect(second.added).toEqual(['foto set.png']);
    expect(await imagesOf(a, s1)).toHaveLength(3);
  });

  it('al seguir, una página a medias que la persona editó no se pisa (escrita antes: queda como la dejó)', async () => {
    const { a } = await mediaDevice();
    const folder = makeFolder();
    await importCoda(folder, spyDeps(a, { failAdd: (name) => name === 'foto set.png' }).deps);
    const s1 = findPage(a, '001 | Primera | Iglesia');
    await typeInto(a, s1, 'NOTAS DEL USUARIO');

    const again = await importCoda(folder, spyDeps(a).deps, { resume: true });
    expect(await pageText(a, s1)).toContain('NOTAS DEL USUARIO');
    expect(again.problems).toEqual([
      '001 | Primera | Iglesia: was edited after the import stopped: it stays as you left it (what failed there was not retried)',
    ]);
    expect(again.resumable).toBe(false);
  });

  it('al seguir, una página creada pero sin escribir que la persona editó conserva su texto y lo importado va debajo', async () => {
    const { a } = await mediaDevice();
    const folder = makeFolder();
    await importCoda(folder, spyDeps(a, { failOpen: (n) => n === 3 }).deps);
    const s1 = findPage(a, '001 | Primera | Iglesia');
    await typeInto(a, s1, 'NOTAS DEL USUARIO');

    const again = await importCoda(folder, spyDeps(a).deps, { resume: true });
    const text = await pageText(a, s1);
    expect(text).toContain('NOTAS DEL USUARIO');
    expect(text).toContain('Brief Sup');
    expect(text.indexOf('NOTAS DEL USUARIO')).toBeLessThan(text.indexOf('Brief Sup'));
    expect(await imagesOf(a, s1)).toHaveLength(3);
    expect(again.problems).toEqual([
      '001 | Primera | Iglesia: was edited after the import stopped: your text stays and the import went below it',
    ]);
  });

  it('al seguir, una página con algo que esta versión no conoce no se toca: queda anotada y sin terminar', async () => {
    const { a } = await mediaDevice();
    const folder = makeFolder();
    await importCoda(folder, spyDeps(a, { failOpen: (n) => n === 3 }).deps);
    const s1 = findPage(a, '001 | Primera | Iglesia');
    // La persona la editó con una versión más nueva de la app: un párrafo y un bloque que esta no conoce.
    const doc = await a.docs.open(s1, { seed: true });
    doc.transact(() => {
      const group = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
      const block = new Y.XmlElement('blockContainer');
      block.setAttribute('id', 'future');
      const future = new Y.XmlElement('hologram');
      future.setAttribute('url', 'sdmedia://00000000-0000-4000-8000-000000000001');
      block.insert(0, [future]);
      group.insert(group.length, [block]);
      const paragraph = (group.get(0) as Y.XmlElement).get(0) as Y.XmlElement;
      (paragraph.get(0) as Y.XmlText).insert(0, 'NOTAS DEL USUARIO');
    });
    await a.docs.flush(s1);
    a.docs.close(s1);
    const before = await a.docs.open(s1);
    const vector = Y.encodeStateVector(before);
    a.docs.close(s1);

    const again = await importCoda(folder, spyDeps(a).deps, { resume: true });
    // Sin el resguardo, el editor de la importación borraba el bloque desconocido del documento compartido.
    const after = await a.docs.open(s1);
    expect(findUnknownContent(after)).toBe('"hologram"');
    expect(Y.encodeStateVector(after)).toEqual(vector);
    expect(after.getXmlFragment(CONTENT_FRAGMENT).toString()).toContain('NOTAS DEL USUARIO');
    expect(after.getXmlFragment(CONTENT_FRAGMENT).toString()).not.toContain('Brief Sup');
    a.docs.close(s1);
    expect(again.problems).toEqual([
      '001 | Primera | Iglesia: has content from a newer version of the app: it was not changed (update the app and resume the import)',
    ]);
    // Las demás páginas se importaron, y la importación se puede seguir (con la app al día).
    expect(await pageText(a, findPage(a, '002 | Segunda | Calle'))).toContain('sdmedia://');
    expect(again.resumable).toBe(true);
  });

  it('al seguir, una página terminada que la persona mandó a la papelera no vuelve', async () => {
    const { a } = await mediaDevice();
    const folder = makeFolder();
    await importCoda(folder, spyDeps(a, { failOpen: (n) => n === 4 }).deps);
    await a.tree.trash(findPage(a, '001 | Primera | Iglesia'));
    await importCoda(folder, spyDeps(a).deps, { resume: true });
    const titles: string[] = [];
    const walk = (parent: string | null) => {
      for (const p of a.tree.children(parent)) {
        titles.push(p.title);
        walk(p.id);
      }
    };
    walk(null);
    expect(titles).not.toContain('001 | Primera | Iglesia');
    expect(titles).toContain('002 | Segunda | Calle');
  });

  it('un diario cuyo proyecto ya no está se borra (no se ofrece seguir para siempre)', async () => {
    const { a } = await mediaDevice();
    const journal = metaJournal(a.db);
    await journal.put({ docId: 'DOC', projectId: 'no-existe', projectName: 'X', pages: {}, media: {} });
    expect(await findResumable(makeFolder(), { tree: a.tree, journal })).toBeNull();
    expect(await journal.get('DOC')).toBeUndefined();
  });

  it('un video o un embebido de otro sitio queda como link y se anota', async () => {
    const { a } = await mediaDevice();
    const html =
      `<p>antes</p><div><video controls><source src="https://cdn.example.com/v.mp4" type="video/mp4"></video></div>` +
      `<iframe src="https://www.youtube.com/embed/abc"></iframe><embed src="https://example.com/x.swf">`;
    const result = await importCoda(smallFolder([page('p', 'Videos', null, 0)], { p: html }), a);
    expect(result.problems).toEqual([
      'Videos: a video or embed from another site stays as a link: https://cdn.example.com/v.mp4',
      'Videos: a video or embed from another site stays as a link: https://www.youtube.com/embed/abc',
      'Videos: a video or embed from another site stays as a link: https://example.com/x.swf',
    ]);
    const text = await pageText(a, findPage(a, 'Videos'));
    expect(text).toContain('https://cdn.example.com/v.mp4');
    expect(text).toContain('https://example.com/x.swf');
  });

  it('una dirección de Drive suelta llega al documento: link en el ítem, tarjeta de Drive en el párrafo, y la app lo abre', async () => {
    const { a } = await mediaDevice();
    const url = 'https://drive.google.com/file/d/1AAAaaaBBBbbbCCCcccDDDdddEEEeeeFFF/view?usp=sharing';
    const html = `<ul><li><span>Referencia:</span><span>${url}</span></li></ul><div><span>Toma elegida:</span><span>${url}</span></div>`;
    const result = await importCoda(smallFolder([page('p', 'Links', null, 0)], { p: html }), a);
    expect(result.problems).toEqual([]);
    const pageId = findPage(a, 'Links');
    const doc = await a.docs.open(pageId);
    const editor = BlockNoteEditor.create({ schema }) as unknown as BlockNoteEditor;
    const blocks = yXmlFragmentToBlocks(editor, doc.getXmlFragment(CONTENT_FRAGMENT)) as unknown as LooseBlock[];
    expect(blocks.map((b) => [b.type, b.props?.driveCard])).toEqual([
      ['bulletListItem', undefined],
      ['paragraph', false],
      ['paragraph', true],
    ]);
    // El link está en los dos, y el de la tarjeta es el que la app usa para el reproductor.
    expect(driveLinkInContent(blocks[0].content)).toEqual({ kind: 'file', id: '1AAAaaaBBBbbbCCCcccDDDdddEEEeeeFFF' });
    expect(driveLinkInContent(blocks[2].content)).toEqual({ kind: 'file', id: '1AAAaaaBBBbbbCCCcccDDDdddEEEeeeFFF' });
    expect(findUnknownContent(doc)).toBeNull();
    a.docs.close(pageId);
  });

  it('los ids que faltan en el manifest no dependen del orden de las páginas', () => {
    const one = { name: 'Uno', parentId: null, order: 0, file: '1.html' };
    const two = { name: 'Dos', parentId: null, order: 1, file: '2.html' };
    const dupA = { id: 'x', name: 'A', file: 'a.html' };
    const dupB = { id: 'x', name: 'B', file: 'b.html' };
    const ids = (pages: object[]) => new Map(checkManifest({ pages }).pages.map((p) => [p.name, p.id]));
    const forward = ids([one, two, dupA, dupB]);
    const backward = ids([dupB, dupA, two, one]);
    expect(forward.get('Uno')).toBe(backward.get('Uno'));
    expect(forward.get('Dos')).toBe(backward.get('Dos'));
    expect(forward.get('Uno')).not.toBe(forward.get('Dos'));
    // Con el id repetido, cada una recibe uno propio, el mismo en cualquier orden.
    expect(new Set([forward.get('A'), forward.get('B')]).size).toBe(2);
    expect([backward.get('A'), backward.get('B')].sort()).toEqual([forward.get('A'), forward.get('B')].sort());
  });

  it('otra pestaña que quiere tomar el control sabe que acá hay una importación en curso', async () => {
    const job = importJobFor({});
    let finish!: () => void;
    const running = job.run(
      () => new Promise((resolve) => (finish = () => resolve({ projectId: 'p', pages: 0, files: 0, comments: 0, problems: [], exportProblems: [], resumable: false }))),
      { beacon: 'db-test' },
    );
    expect(importingElsewhere('db-test')).toBe(true);
    expect(importingElsewhere('otra-db')).toBe(false);
    finish();
    await running;
    expect(importingElsewhere('db-test')).toBe(false);
  });
});

describe('HTML de Coda: correcciones de la auditoría', () => {
  it('las marcas no chocan con texto que ya traía esos caracteres', async () => {
    // El texto de Coda trae la marca de la foto 0 escrita a mano (y sueltos los dos caracteres).
    const blocks = await convert(`<div>antes 0 medio   fin</div><div>${img('bl-z', 'z.png')}</div>`);
    expect(blocks.filter((b) => b.type === 'image').map((b) => b.props?.url)).toEqual(['sdmedia://bl-z']);
    expect(text(blocks[0])).toBe('antes 0 medio fin');
    expect(JSON.stringify(blocks)).not.toMatch(/[]/);
  });

  it('un link de Coda que envuelve la misma foto no la trae dos veces: queda el texto, sin link', () => {
    const src = 'https://codahosted.io/docs/DOC/blobs/bl-e/abc';
    const { html, media } = prepareCodaHtml(`<div><a href="${src}">ver ${img('bl-e', 'e.png')}</a></div>`);
    expect(media.map((m) => m.blobId)).toEqual(['bl-e']);
    expect(html).not.toContain('<a');
    expect(html).toContain('ver ');
    // Un link a otro archivo de Coda (un PDF) sigue siendo un adjunto aparte.
    const other = prepareCodaHtml(`<div><a href="https://codahosted.io/docs/DOC/blobs/bl-pdf/x">plano ${img('bl-e', 'e.png')}</a></div>`);
    expect(other.media.map((m) => m.blobId)).toEqual(['bl-e', 'bl-pdf']);
  });

  it('un link coda-page: pasa a la dirección de la página; uno sin dirección queda como texto', () => {
    const html = '<div><a href="coda-page:canvas-B">Plano 12</a> <a href="CODA-PAGE:canvas%2DZ">Z</a> <a href="https://x.com">x</a></div>';
    const got = prepareCodaHtml(html, (id) => (id === 'canvas-B' ? '/p/1' : null));
    expect(got.html).toContain('<a href="/p/1">Plano 12</a>');
    expect(got.html).toContain('<a href="https://x.com">x</a>');
    expect(got.html).not.toContain('coda-page');
    expect(got.html).toContain('Z');
    expect(got.brokenLinks).toEqual([{ id: 'canvas-Z', text: 'Z' }]);
    // Sin quien resuelva (y con un % suelto): texto, nunca un link a ninguna parte.
    const bare = prepareCodaHtml('<div><a href="coda-page:%E0">roto</a></div>');
    expect(bare.html).toBe('<div>roto</div>');
    expect(bare.brokenLinks).toEqual([{ id: '%E0', text: 'roto' }]);
  });

  it('una foto de otro sitio adentro de un párrafo no se pierde en silencio: queda marcada como externa', () => {
    const { media } = prepareCodaHtml(`<div>x <img src="https://example.com/a.png"></div>`);
    expect(media).toMatchObject([{ src: 'https://example.com/a.png', external: true, blobId: '' }]);
  });
});

// Lo que en Coda era un embebido (un video de Drive con su reproductor) sale en el HTML como la dirección en
// texto, sin <a>, cada una en su <span> y pegada a lo de al lado. Ids inventados.
describe('HTML de Coda: direcciones sueltas', () => {
  const DRIVE_A = 'https://drive.google.com/file/d/1AAAaaaBBBbbbCCCcccDDDdddEEEeeeFFF/view?usp=sharing';
  const DRIVE_B = 'https://drive.google.com/file/d/1GGGgggHHHhhhIIIiiiJJJjjjKKKkkkLLL/view?usp=drive_link';
  const SITE_A = 'https://example.com/ref/a?x=1&y=2';
  const SITE_B = 'http://example.org/ref/b';

  type Piece = { type: string; text?: string; href?: string; content?: { text: string }[] };
  /** El contenido de un bloque como se lee: el texto tal cual y cada link entre corchetes con su dirección. */
  const reading = (content: unknown) =>
    ((content as Piece[]) ?? []).map((c) => (c.type === 'link' ? `[${c.content!.map((x) => x.text).join('')}](${c.href})` : (c.text ?? ''))).join('');
  const isCard = (b: LooseBlock) => b.props?.driveCard === true;
  /** Cada bloque: su tipo (o `card`) y cómo se lee. */
  const shape = (blocks: LooseBlock[]) => blocks.map((b) => [isCard(b) ? 'card' : b.type, reading(b.content)]);

  it('una dirección sola en su <span> pasa a ser un link (con http también)', async () => {
    const blocks = await convert(`<div><span>${SITE_A.replace(/&/g, '&amp;')}</span></div><div><span> ${SITE_B} </span></div>`);
    expect(shape(blocks)).toEqual([
      ['paragraph', `[${SITE_A}](${SITE_A})`],
      ['paragraph', `[${SITE_B}](${SITE_B})`],
    ]);
  });

  it('en un ítem de lista, la dirección pegada al texto y a otra dirección queda cada una en su renglón, adentro del ítem', async () => {
    const blocks = await convert(
      `<ul><li><span>Se mencionó como referencia la escena del muelle:</span><span>${DRIVE_A}</span><span>${DRIVE_B}</span></li>` +
        `<li><span>Otro renglón.</span></li></ul>`,
    );
    expect(blocks.map((b) => b.type)).toEqual(['bulletListItem', 'bulletListItem']);
    // El salto de línea queda al final del tramo anterior (así lo escribe el editor): un renglón por dirección.
    expect(reading(blocks[0].content)).toBe(
      `Se mencionó como referencia la escena del muelle:\n[${DRIVE_A}\n](${DRIVE_A})[${DRIVE_B}](${DRIVE_B})`,
    );
    expect(text(blocks[1])).toBe('Otro renglón.');
    // Adentro de un ítem no hay tarjeta de Drive: queda el link.
    expect(blocks.some(isCard)).toBe(false);
    expect(blocks[0].children).toEqual([]);
  });

  it('en un párrafo, las direcciones de otro sitio pegadas al texto quedan en el mismo párrafo, una por renglón', async () => {
    const blocks = await convert(`<div><span>Ver:</span><span>${SITE_A}</span><span>${SITE_B}</span></div>`);
    expect(shape(blocks)).toEqual([['paragraph', `Ver:\n[${SITE_A}\n](${SITE_A})[${SITE_B}](${SITE_B})`]]);
  });

  it('una dirección separada del texto por un espacio no se mueve de su renglón', async () => {
    const blocks = await convert(`<div><span>Ver </span><span>${DRIVE_A}</span><span> y avisar.</span></div>`);
    expect(shape(blocks)).toEqual([['paragraph', `Ver [${DRIVE_A}](${DRIVE_A}) y avisar.`]]);
  });

  it('una dirección de Drive sola en un párrafo entra como tarjeta de Drive', async () => {
    const blocks = await convert(`<div><span>${DRIVE_A}</span></div>`);
    expect(shape(blocks)).toEqual([['card', `[${DRIVE_A}](${DRIVE_A})`]]);
    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[0].props).toMatchObject({ driveCard: true, script: false, question: false });
  });

  it('en un párrafo, cada dirección de Drive pegada sale a su propio párrafo como tarjeta y el texto queda donde estaba', async () => {
    const blocks = await convert(
      `<div><span>Referencia:</span><span>${DRIVE_A}</span><span>${DRIVE_B}</span></div><div><span>Sigue.</span></div>` +
        // Con saltos de línea ya puestos, y con texto después.
        `<div>Antes<br>${DRIVE_A}<br>Después</div>`,
    );
    expect(shape(blocks)).toEqual([
      ['paragraph', 'Referencia:'],
      ['card', `[${DRIVE_A}](${DRIVE_A})`],
      ['card', `[${DRIVE_B}](${DRIVE_B})`],
      ['paragraph', 'Sigue.'],
      ['paragraph', 'Antes'],
      ['card', `[${DRIVE_A}](${DRIVE_A})`],
      ['paragraph', 'Después'],
    ]);
  });

  it('la tarjeta no va con Script ni en un título, y una foto al lado no se pierde', async () => {
    const blocks = await convert(
      `<h2><span>Guion:</span></h2><div><span>1 INT. CASA - NOCHE</span></div><div><span>${DRIVE_A}</span>${img('bl-u', 'u.png')}</div>` +
        `<h2><span>Video:</span><span>${DRIVE_B}</span></h2>`,
    );
    expect(shape(blocks)).toEqual([
      ['heading', 'Guion:'],
      ['paragraph', '1 INT. CASA - NOCHE'],
      ['card', `[${DRIVE_A}](${DRIVE_A})`],
      ['image', ''],
      ['heading', `Video:\n[${DRIVE_B}](${DRIVE_B})`],
    ]);
    expect(blocks[1].props?.script).toBe(true);
    expect(blocks[2].props?.script).toBe(false);
    expect(blocks[3].props?.url).toBe('sdmedia://bl-u');
  });

  it('en una celda de tabla queda el link (dos pegadas, una por renglón) y nunca una tarjeta', async () => {
    const blocks = await convert(
      `<table><tr><td>Link</td><td><span>${DRIVE_A}</span></td></tr>` +
        `<tr><td><div><span>${DRIVE_A}</span><span>${DRIVE_B}</span></div></td><td>${SITE_B}</td></tr></table>`,
    );
    expect(blocks.map((b) => b.type)).toEqual(['table']);
    const rows = (blocks[0].content as { rows: { cells: { content: unknown }[] }[] }).rows;
    expect(rows.map((r) => r.cells.map((c) => reading(c.content)))).toEqual([
      ['Link', `[${DRIVE_A}](${DRIVE_A})`],
      [`[${DRIVE_A}\n](${DRIVE_A})[${DRIVE_B}](${DRIVE_B})`, `[${SITE_B}](${SITE_B})`],
    ]);
  });

  it('lo que ya es un link no cambia, tampoco uno de Drive solo en su párrafo (en Coda era un link, no un embebido)', async () => {
    const html = `<div><span><a href="${DRIVE_A}">${DRIVE_A}</a></span></div><ul><li><span>Ver:</span><a href="${SITE_B}">${SITE_B}</a></li></ul>`;
    expect(prepareCodaHtml(html).html).toBe(html);
    const blocks = await convert(html);
    expect(shape(blocks)).toEqual([
      ['paragraph', `[${DRIVE_A}](${DRIVE_A})`],
      ['bulletListItem', `Ver:[${SITE_B}](${SITE_B})`],
    ]);
  });

  it('no toca una dirección adentro de un texto más largo, dos en un mismo texto, código, ni un archivo de Coda', () => {
    const hosted = 'https://codahosted.io/docs/DOC/blobs/bl-q/abc';
    const html =
      `<div><span>Mirar ${SITE_B} antes del rodaje.</span></div>` +
      `<div><span>${DRIVE_A}${DRIVE_B}</span></div>` +
      `<div><span>https://example.com/go?to=${SITE_B}</span></div>` +
      `<div><code>${SITE_B}</code></div><pre>${SITE_B}</pre>` +
      `<div><span>${hosted}</span></div>` +
      `<div><span>coda-page:canvas-B</span></div><div><span>https://</span></div>`;
    const got = prepareCodaHtml(html);
    expect(got.html).toBe(html);
    expect(got.media).toEqual([]);
  });
});
