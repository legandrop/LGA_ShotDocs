// @vitest-environment jsdom
// Fotos en las celdas de una tabla (Docs/Doc_Fotos_En_Linea.md, entrega 5): la foto en línea que ya existe, sin tipos
// ni propiedades nuevas, ahora también entra en una celda al pegar, soltar o elegir archivos, como miniatura (`w = 0`).
// Acá: dónde entra, el carrete, los archivos de la página, la forma guardada y las versiones publicadas.
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { CellSelection } from 'prosemirror-tables';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { mediaIdsInDoc } from '../media/usage';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { collectCarrete, type BlockLike } from './carreteModel';
import { mountEditor, tick, undoManager, unmountAll, view as viewOf } from './collabHarness';
import { schema } from './editorSchema';
import { schema as previousPublished } from './fixtures/editorSchemaAnterior';
import { PHOTO } from './inlinePhoto';
import { addFiles, CELL_PHOTO_WIDTH, canHostPhoto, inlinePhotoSpotsExtension, inTableCell, pasteSpot, type AddFilesOptions, type PhotoEditor } from './inlinePhotoCreate';
import { decorateRows, photoKeyAtPos } from './inlinePhotoEditor';
import { brokenGaps, previousSchema, storedPhotos } from './photoHarness';
import { findUnknownContent, knownContent } from './unknownContent';

afterEach(unmountAll);

const ID = (n: number) => `0f8fad5b-d9cb-469f-a165-7086772895${String(n).padStart(2, '0')}`;
const text = (t: string) => ({ type: 'text', text: t, styles: {} });
const sdPhoto = (n: number, w = 0) => ({ type: 'photo', props: { url: `sdmedia://${ID(n)}`, name: `F${n}.jpg`, w } });
const file = (name: string, type = 'image/jpeg') => new File([new Uint8Array([1, 2, 3])], name, { type });

/** Una página con un párrafo con foto, una tabla de 2 × 2 y otro párrafo con foto. */
const page = (cells: unknown[][][] = [[[text('Plano')], [sdPhoto(2)]], [[text('1A')], []]]): PartialBlock[] =>
  [
    { id: 'a', type: 'paragraph', content: [text('Antes '), sdPhoto(1, 0.25)] },
    { id: 'tb', type: 'table', content: { type: 'tableContent', rows: cells.map((r) => ({ cells: r })) } },
    { id: 'z', type: 'paragraph', content: [text('Después '), sdPhoto(9, 0.25)] },
  ] as never;

/** Un editor como el de la página para crear (con el seguimiento del lugar mientras se guardan los archivos). */
function mountCreating(blocks: PartialBlock[], doc = new Y.Doc()): BlockNoteEditor {
  const editor = BlockNoteEditor.create(
    withCollaboration({
      schema,
      collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
      extensions: [inlinePhotoSpotsExtension],
    }),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.append(el);
  editor.mount(el);
  editor.replaceBlocks(editor.document, blocks as never);
  return editor;
}

/** La posición del principio (o `offset`) del texto de la celda `r`, `c` de la primera tabla. */
function cellPos(E: BlockNoteEditor, r: number, c: number, offset = 0): number {
  const doc = viewOf(E).state.doc;
  let at = -1;
  let i = 0;
  let cols = 0;
  doc.descendants((n, pos) => {
    if (n.type.name === 'table' && cols === 0) cols = n.firstChild!.childCount;
    if (n.type.name === 'tableParagraph') {
      if (i === r * cols + c) at = pos + 1 + (offset < 0 ? n.content.size : offset);
      i++;
    }
    return at < 0;
  });
  return at;
}

const caret = (E: BlockNoteEditor, pos: number) => viewOf(E).dispatch(viewOf(E).state.tr.setSelection(TextSelection.create(viewOf(E).state.doc, pos)));

/** Cada celda de la primera tabla como texto, con `[nombre@w]` por foto. */
function cells(E: BlockNoteEditor): string[][] {
  const out: string[][] = [];
  viewOf(E).state.doc.descendants((n) => {
    if (n.type.name !== 'tableRow') return true;
    const row: string[] = [];
    n.forEach((cell) => {
      let s = '';
      cell.descendants((x) => {
        if (x.isText) s += x.text;
        else if (x.type.name === PHOTO) s += `[${x.attrs.name}@${+Number(x.attrs.w).toFixed(4)}]`;
        return true;
      });
      row.push(s);
    });
    out.push(row);
    return false;
  });
  return out;
}

/** Guardar en el acto: cada archivo pasa a `sdmedia://<nombre>`. */
const options = (attachments: string[] = []): AddFilesOptions => ({
  isInline: (f) => f.type.startsWith('image/') || f.type.startsWith('video/'),
  store: async (f) => `sdmedia://${f.name}`,
  insertAttachments: (files) => attachments.push(...files.map((f) => f.name)),
});

describe('dónde entra', () => {
  it('la celda acepta una foto en línea, también la de un encabezado; un bloque de código no', () => {
    const E = mountCreating([
      ...page(),
      { id: 'c', type: 'codeBlock', content: 'code' } as never,
      { id: 'h', type: 'table', content: { type: 'tableContent', headerRows: 1, rows: [{ cells: [[text('Enc')]] }, { cells: [[text('x')]] }] } } as never,
    ]);
    const doc = viewOf(E).state.doc;
    expect(canHostPhoto(doc.resolve(cellPos(E, 1, 1)))).toBe(true);
    expect(inTableCell(doc.resolve(cellPos(E, 1, 1)))).toBe(true);
    let code = -1;
    let header = -1;
    doc.descendants((n, pos) => {
      if (n.type.name === 'codeBlock') code = pos + 1;
      if (n.type.name === 'tableHeader' && header < 0) header = pos + 2;
      return true;
    });
    expect(canHostPhoto(doc.resolve(code))).toBe(false);
    expect(canHostPhoto(doc.resolve(header))).toBe(true);
    expect(inTableCell(doc.resolve(header))).toBe(true);
    expect(inTableCell(doc.resolve(cellPos(E, 0, 0) - 10))).toBe(false);
  });

  it('pegar con el cursor en una celda: una entra en la celda, como miniatura (w = 0), y el cursor queda después', async () => {
    const E = mountCreating(page());
    caret(E, cellPos(E, 1, 1));
    expect(pasteSpot(viewOf(E).state)).toBe(cellPos(E, 1, 1));
    await addFiles(E as unknown as PhotoEditor, [file('N.jpg')], null, options());
    expect(cells(E)).toEqual([
      ['Plano', `[F2.jpg@0]`],
      ['1A', `[N.jpg@${CELL_PHOTO_WIDTH}]`],
    ]);
    expect(viewOf(E).state.selection.from).toBe(cellPos(E, 1, 1, -1));
    // Nada salió de la tabla: siguen los tres bloques.
    expect(E.document.map((b) => b.id)).toEqual(['a', 'tb', 'z']);
  });

  it('varias a la vez: juntas, en orden, todas miniaturas (no a 1/3), en un solo deshacer', async () => {
    const E = mountCreating(page());
    undoManager(E).stopCapturing();
    caret(E, cellPos(E, 1, 0, -1));
    await addFiles(E as unknown as PhotoEditor, [file('A.jpg'), file('B.png'), file('C.mp4', 'video/mp4')], null, options());
    expect(cells(E)[1][0]).toBe('1A[A.jpg@0][B.png@0][C.mp4@0]');
    undoManager(E).undo();
    expect(cells(E)[1][0]).toBe('1A');
  });

  it('soltar sobre el texto de una celda: en la celda, entre las letras', async () => {
    const E = mountCreating(page());
    await addFiles(E as unknown as PhotoEditor, [file('D.jpg')], { pos: cellPos(E, 0, 0, 2), block: { blockId: 'tb', placement: 'after' } }, options());
    expect(cells(E)[0][0]).toBe('Pl[D.jpg@0]ano');
  });

  it('un adjunto sigue siendo una tarjeta debajo de la tabla (no entra en una celda); las fotos del mismo pegar, en la celda', async () => {
    const E = mountCreating(page());
    caret(E, cellPos(E, 1, 1));
    const attachments: string[] = [];
    await addFiles(E as unknown as PhotoEditor, [file('plano.pdf', 'application/pdf'), file('E.jpg')], null, options(attachments));
    expect(attachments).toEqual(['plano.pdf']);
    expect(cells(E)[1][1]).toBe('[E.jpg@0]');
  });

  it('con varias celdas elegidas (selección de celdas) no hay lugar: va en un renglón nuevo después de la tabla', () => {
    const E = mountCreating(page());
    const doc = viewOf(E).state.doc;
    const $a = doc.resolve(cellPos(E, 0, 0) - 2);
    const $b = doc.resolve(cellPos(E, 1, 1) - 2);
    viewOf(E).dispatch(viewOf(E).state.tr.setSelection(new CellSelection($a, $b)));
    expect(pasteSpot(viewOf(E).state)).toBeNull();
  });

  it('se guarda como en un renglón: los huecos estables y la marca del renglón, adentro de la celda', async () => {
    const doc = new Y.Doc();
    const E = mountCreating(page(), doc);
    caret(E, cellPos(E, 1, 0, -1));
    await addFiles(E as unknown as PhotoEditor, [file('A.jpg'), file('B.jpg')], null, options());
    await tick(20);
    expect(brokenGaps(doc)).toEqual([]);
    expect(storedPhotos(doc)).toEqual(['F1.jpg', 'F2.jpg', 'A.jpg', 'B.jpg', 'F9.jpg']);
  });
});

describe('lo que se ve y se usa', () => {
  it('el carrete las recorre en el orden de la página (celda por celda, fila por fila) y el clic encuentra cada una', () => {
    const E = mountCreating(page([[[sdPhoto(2), sdPhoto(3)], [text('x ')]], [[text('y')], [sdPhoto(4)]]]));
    const items = collectCarrete(E.document as unknown as BlockLike[]);
    expect(items.map((i) => i.name)).toEqual(['F1.jpg', 'F2.jpg', 'F3.jpg', 'F4.jpg', 'F9.jpg']);
    expect(items.map((i) => i.key)).toEqual(['a#0', 'tb#0', 'tb#1', 'tb#2', 'z#0']);
    // La clave que da el editor para cada foto de la tabla (el clic, la barra espaciadora) es la del carrete.
    const keys: string[] = [];
    viewOf(E).state.doc.descendants((n, pos) => {
      if (n.type.name === PHOTO) keys.push(photoKeyAtPos(viewOf(E).state.doc, pos)!);
      return true;
    });
    expect(keys).toEqual(['a#0', 'tb#0', 'tb#1', 'tb#2', 'z#0']);
  });

  it('las fotos de las celdas cuentan como archivos de la página (la papelera de archivos no las da por quitadas)', () => {
    const doc = new Y.Doc();
    const E = mountEditor(doc);
    E.replaceBlocks(E.document, page([[[sdPhoto(2)], [text('x '), sdPhoto(3)]], [[sdPhoto(4), sdPhoto(5)], []]]) as never);
    expect([...mediaIdsInDoc(doc)].sort()).toEqual([1, 2, 3, 4, 5, 9].map(ID).sort());
  });

  it('las filas de las fotos con ancho propio de una celda se arman como en un renglón; las miniaturas no llevan ancho', () => {
    const E = mountEditor(new Y.Doc());
    E.replaceBlocks(E.document, page([[[sdPhoto(2, 0.5), sdPhoto(3, 0.5)], [sdPhoto(4), sdPhoto(5)]]]) as never);
    const decorations = decorateRows(viewOf(E).state.doc).find();
    const sized = decorations.map((d) => (d as unknown as { type: { attrs: { class?: string; style?: string } } }).type.attrs).filter((a) => a.class);
    // Las dos de 1/2 de la celda (fila de dos) y las dos de los párrafos (una por renglón); las miniaturas, nada.
    expect(sized.filter((a) => a.style?.includes('--row-n: 2'))).toHaveLength(2);
    expect(sized).toHaveLength(4);
  });
});

describe('versiones publicadas', () => {
  /** Una página con fotos en celdas puestas como las pone esta versión (pegar en una celda). */
  async function cellPage(): Promise<Y.Doc> {
    const doc = new Y.Doc();
    const E = mountCreating(page(), doc);
    caret(E, cellPos(E, 1, 1));
    await addFiles(E as unknown as PhotoEditor, [file('A.jpg'), file('B.jpg')], null, options());
    caret(E, cellPos(E, 1, 0, -1));
    await addFiles(E as unknown as PhotoEditor, [file('C.jpg')], null, options());
    unmountAll();
    return doc;
  }

  const copyOf = (doc: Y.Doc) => {
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    const updates: Uint8Array[] = [];
    copy.on('update', (u: Uint8Array) => updates.push(u));
    return { doc: copy, updates };
  };

  // La publicada de v0.083 a v0.092 (fixtures/editorSchemaAnterior; conoce `photo` desde v0.076 y la marca del renglón
  // desde v0.078). fixtures/editorSchemaMain es de antes de `photo`: ese caso es el de abajo (no abre la página).
  for (const [name, published] of [['la versión publicada de v0.083 a v0.092', previousPublished]] as const) {
    it(`${name} abre la página sin escribir nada y, al editar la tabla, no borra ninguna foto`, async () => {
      const shared = await cellPage();
      const before = storedPhotos(shared);
      expect(before).toEqual(['F1.jpg', 'F2.jpg', 'C.jpg', 'A.jpg', 'B.jpg', 'F9.jpg']);
      // La conoce: no la frena el resguardo de contenido desconocido.
      expect(findUnknownContent(shared)).toBeNull();
      const { doc, updates } = copyOf(shared);
      const old = mountEditor(doc, 'old', published);
      await tick(20);
      expect(updates).toEqual([]);
      // Escribe en la celda de las fotos (al final) y en otra celda.
      const end = cellPos(old, 1, 1, -1);
      viewOf(old).dispatch(viewOf(old).state.tr.insertText(' nota', end));
      viewOf(old).dispatch(viewOf(old).state.tr.insertText('!', cellPos(old, 0, 0, -1)));
      await tick(20);
      expect(storedPhotos(doc)).toEqual(before);
      expect(cells(old)).toEqual([
        ['Plano!', '[F2.jpg@0]'],
        ['1A[C.jpg@0]', '[A.jpg@0][B.jpg@0] nota'],
      ]);
      expect(brokenGaps(doc)).toEqual([]);
    });
  }

  it('una versión sin `photo` (v0.052 a v0.076) no abre la página: el resguardo encuentra la foto de la celda', async () => {
    const shared = await cellPage();
    const previous = { nodes: new Set([...knownContent().nodes].filter((n) => n !== PHOTO && n !== 'lgaStableGaps')), marks: knownContent().marks };
    expect(findUnknownContent(shared, previous)).not.toBeNull();
    // Y su esquema de verdad no tiene `photo`.
    const E = mountEditor(new Y.Doc(), 'older', previousSchema);
    expect(viewOf(E).state.schema.nodes[PHOTO]).toBeUndefined();
  });
});
