// @vitest-environment jsdom
// Importar de Coda con los renglones como estaban (entrega 4 de Docs/Doc_Fotos_En_Linea.md): las fotos de un renglón
// de Coda (cada una en su `<span style="display: inline-block">`) quedan en un renglón de la app, como fotos en
// línea, con la parte del renglón que ocupaban. Las formas de HTML son las de la exportación real de ERSO.
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { isMediaFile } from '../media/queue';
import { schema } from '../ui/editorSchema';
import { brokenGaps, storedPhotos } from '../ui/photoHarness';
import { findUnknownContent } from '../ui/unknownContent';
import { codaLineWidth, codaPhotoWidth, CODA_TEXT_WIDTH, finishBlocks, prepareCodaHtml, type LooseBlock } from './codaHtml';

const editors: BlockNoteEditor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) {
    try {
      e.unmount();
    } catch {
      // No estaba montado.
    }
  }
  document.body.replaceChildren();
});

const img = (blob: string, w: number, alt = 'image.png', mime = 'image/png') =>
  `<span style="display: inline-block;"><img data-coda-blob-id="${blob}" data-coda-mime-type="${mime}" alt="${alt}" ` +
  `src="https://codahosted.io/docs/DOC/blobs/${blob}/abc" height="10" width="${w}"></span>`;

/** Convierte como la importación: fotos y videos en línea; lo demás (un adjunto), bloque `image`. */
async function convert(html: string): Promise<LooseBlock[]> {
  const editor = BlockNoteEditor.create({ schema }) as unknown as BlockNoteEditor;
  editors.push(editor);
  const { html: prepared, media } = prepareCodaHtml(html);
  const parsed = (await editor.tryParseHTMLToBlocks(prepared)) as unknown as LooseBlock[];
  const url = (i: number) => `sdmedia://${media[i].blobId}`;
  return finishBlocks(
    parsed,
    (i) => ({ type: 'image', props: { url: url(i), name: media[i].name }, children: [] }),
    (i, line) =>
      isMediaFile({ type: media[i].mime, name: media[i].name })
        ? { type: 'photo', props: { url: url(i), name: media[i].blobId, w: codaPhotoWidth(media[i].width, line) } }
        : null,
  );
}

/** La marca que deja `prepareCodaHtml` en el lugar de la foto `i` (codaHtml.ts). */
const TOKEN_OF = (i: number) => `${i}`;

/** El renglón de cada celda de una tabla, fila por fila, con cada foto como `[blob@w]`. */
function cellShapes(table: LooseBlock): string[][] {
  const rows = (table.content as { rows: { cells: ({ content?: unknown } | unknown[])[] }[] }).rows;
  return rows.map((r) =>
    r.cells.map((c) =>
      ((Array.isArray(c) ? c : ((c as { content?: unknown }).content as unknown[])) as { type: string; text?: string; props?: { name: string; w: number } }[])
        .map((x) => (x.type === 'photo' ? `[${x.props!.name}@${x.props!.w}]` : (x.text ?? '')))
        .join(''),
    ),
  );
}

/** Cada bloque: `tipo` y su renglón, con cada foto como `[blob@w]`. */
function shape(blocks: LooseBlock[], depth = 0): string[] {
  return blocks.flatMap((b) => {
    const content = Array.isArray(b.content)
      ? (b.content as { type: string; text?: string; props?: { name: string; w: number } }[])
          .map((c) => (c.type === 'photo' ? `[${c.props!.name}@${c.props!.w}]` : (c.text ?? '')))
          .join('')
      : b.type === 'image'
        ? String(b.props?.url)
        : '';
    return [`${'  '.repeat(depth)}${b.type}${content ? ` ${JSON.stringify(content)}` : ''}`, ...shape(b.children ?? [], depth + 1)];
  });
}

describe('los renglones de Coda con fotos', () => {
  it('el ancho: la parte del renglón de Coda (624 px); más ancho, todo el renglón; sin ancho, el natural', () => {
    expect(CODA_TEXT_WIDTH).toBe(624);
    expect([312, 624, 1024, 76, 0].map((px) => codaPhotoWidth(px))).toEqual([0.5, 1, 1, 0.1218, 0]);
  });

  it('dos fotos de 312 px en un renglón quedan juntas en uno, cada una a la mitad', async () => {
    const blocks = await convert(`<div style="text-align: left;">${img('bl-a', 312)}${img('bl-b', 312)}</div>`);
    expect(shape(blocks)).toEqual(['paragraph "[bl-a@0.5][bl-b@0.5]"']);
  });

  it('el carácter de objeto (U+FFFC) y el espacio de ancho cero que Coda deja al lado de una foto no quedan', async () => {
    const blocks = await convert(
      `<div><span style="color: rgb(102, 102, 102);">￼</span>${img('bl-a', 624)}${img('bl-b', 624)}</div>` +
        `<div><span>​</span>${img('bl-c', 624)}</div>`,
    );
    expect(shape(blocks)).toEqual(['paragraph "[bl-a@1][bl-b@1]"', 'paragraph "[bl-c@1]"']);
  });

  it('un ítem con texto, salto y foto: la foto queda en el ítem, debajo del texto, sin espacios sueltos', async () => {
    const blocks = await convert(
      `<ul><li style="list-style-type: disc;"><span>Las filas pintadas</span><br><span> </span>${img('bl-a', 1004)}<br></li></ul>`,
    );
    expect(shape(blocks)).toEqual(['bulletListItem "Las filas pintadas\\n[bl-a@1]"']);
  });

  it('en una lista, el ancho es sobre el renglón del ítem (sin la sangría): no sale más chica que en Coda', async () => {
    expect(codaLineWidth(0)).toBe(624);
    const blocks = await convert(
      `<ul><li><span>Uno</span><br>${img('bl-a', 300)}<ul><li><span>Dos</span><br>${img('bl-b', 288)}</li></ul></li></ul>`,
    );
    expect(shape(blocks)).toEqual(['bulletListItem "Uno\\n[bl-a@0.5]"', '  bulletListItem "Dos\\n[bl-b@0.5]"']);
  });

  it('texto y fotos en el mismo renglón quedan en el mismo renglón, en orden', async () => {
    const blocks = await convert(`<div><span>Antes </span>${img('bl-a', 156)}<span> y después </span>${img('bl-b', 156)}</div>`);
    expect(shape(blocks)).toEqual(['paragraph "Antes [bl-a@0.25] y después [bl-b@0.25]"']);
  });

  it('un título con solo fotos es un renglón de fotos; un título con texto y una foto sigue siendo título', async () => {
    const blocks = await convert(
      `<h3 style="text-align: left;">${img('bl-a', 312)}${img('bl-b', 312)}</h3><h3><span>Plano </span>${img('bl-c', 64)}</h3>`,
    );
    expect(shape(blocks)).toEqual(['paragraph "[bl-a@0.5][bl-b@0.5]"', 'heading "Plano [bl-c@0.1026]"']);
  });

  it('las fotos de las celdas de una tabla quedan en su celda, como miniaturas (w = 0), con su texto (entrega 5)', async () => {
    const blocks = await convert(
      `<table><tbody><tr><td>${img('bl-a', 43)}</td><td>Auto</td></tr>` +
        `<tr><td><span>Plano </span>${img('bl-b', 43)}${img('bl-c', 120)}</td><td>Tranvía</td></tr></tbody></table>`,
    );
    expect(shape(blocks)).toEqual(['table']);
    expect(cellShapes(blocks[0])).toEqual([
      ['[bl-a@0]', 'Auto'],
      ['Plano [bl-b@0][bl-c@0]', 'Tranvía'],
    ]);
  });

  it('un adjunto en una celda va debajo de la tabla (la tarjeta no entra en una celda); sus fotos quedan', async () => {
    const pdf = `<a href="https://codahosted.io/docs/DOC/blobs/bl-p/x">plano.pdf</a>`;
    const blocks = await convert(`<table><tbody><tr><td>${img('bl-a', 43)}${pdf}</td><td>Auto</td></tr></tbody></table>`);
    expect(shape(blocks)).toEqual(['table', 'image "sdmedia://bl-p"']);
    expect(cellShapes(blocks[0])[0][0]).toMatch(/^\[bl-a@0\]/);
    expect(JSON.stringify(blocks[0].content)).not.toMatch(/|/);
  });

  it('sin fotos en línea (una importación vieja), las de las celdas siguen yendo debajo de la tabla', () => {
    const table: LooseBlock = {
      type: 'table',
      content: { type: 'tableContent', rows: [{ cells: [{ type: 'tableCell', content: [{ type: 'text', text: `${TOKEN_OF(0)}`, styles: {} }] }] }] },
    };
    const blocks = finishBlocks([table], (i) => ({ type: 'image', props: { url: `sdmedia://m${i}` }, children: [] }));
    expect(shape(blocks)).toEqual(['table', 'image "sdmedia://m0"']);
  });

  it('un adjunto (un PDF) sigue siendo un bloque, la tarjeta; un video va en línea', async () => {
    const blocks = await convert(
      `<div><span>Guion: </span><a href="https://codahosted.io/docs/DOC/blobs/bl-p/x">guion.pdf</a></div>` +
        `<div><video src="https://codahosted.io/docs/DOC/blobs/bl-v/x" data-coda-blob-id="bl-v" data-coda-mime-type="video/mp4" width="312"></video></div>`,
    );
    expect(shape(blocks)).toEqual(['paragraph "Guion: "', 'image "sdmedia://bl-p"', 'paragraph "[bl-v@0.5]"']);
  });

  it('debajo de un título "Guion", un renglón con texto y foto pasa a Script con su foto', async () => {
    const blocks = await convert(`<h2><span>Guion:</span></h2><div><span>3 EXT. IGLESIA - DÍA </span>${img('bl-a', 208)}</div>`);
    expect(shape(blocks)).toEqual(['heading "Guion:"', 'paragraph "3 EXT. IGLESIA - DÍA [bl-a@0.3333]"']);
    expect(blocks[1].props?.script).toBe(true);
  });

  it('se escribe como en la app: el renglón lleva su marca, ninguna versión anterior lo abre y nada se pierde', async () => {
    const blocks = await convert(
      `<div>${img('bl-a', 312)}${img('bl-b', 312)}</div><ul><li><span>Ítem</span><br>${img('bl-c', 208)}</li></ul>` +
        `<h3><span>Título </span>${img('bl-d', 64)}</h3>`,
    );
    const doc = new Y.Doc();
    const editor = BlockNoteEditor.create(
      withCollaboration({ schema, collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'Import', color: '#888' } } }),
    ) as unknown as BlockNoteEditor;
    editors.push(editor);
    const host = document.createElement('div');
    document.body.appendChild(host);
    editor.mount(host);
    editor.replaceBlocks(editor.document, blocks as never);
    await new Promise((r) => setTimeout(r, 10));
    expect(storedPhotos(doc)).toEqual(['bl-a', 'bl-b', 'bl-c', 'bl-d']);
    expect(brokenGaps(doc)).toEqual([]);
    expect(findUnknownContent(doc)).toBeNull();
  });
});
