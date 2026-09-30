// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { yXmlFragmentToBlocks } from '@blocknote/core/yjs';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { findUnknownContent } from '../ui/unknownContent';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { schema } from '../ui/editorSchema';
import { finishBlocks, namedColor, prepareCodaHtml, type LooseBlock } from './codaHtml';
import { importCoda, treeOrder, type CodaFolder, type CodaManifestPage } from './codaImport';

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
    const urls: string[] = [];
    const walk = (list: LooseBlock[]) =>
      list.forEach((x) => {
        if (x.type === 'image') urls.push(String(x.props?.url));
        walk(x.children ?? []);
      });
    walk(blocks);
    expect(urls).toHaveLength(3);
    const ids = new Set([...server.mediaFiles.values()].filter((f) => f.drive_id).map((f) => `sdmedia://${f.id}`));
    for (const url of urls) expect(ids.has(url)).toBe(true);
    // El ancho de Coda queda si es menor que la página; si no, la foto va sin ancho propio.
    const [first] = blocks.filter((x) => x.type === 'bulletListItem');
    expect(first.children?.[0].props?.previewWidth).toBe(533);
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
});
