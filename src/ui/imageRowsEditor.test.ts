// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/y';
import { NodeSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from '@y/y';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { schema } from './editorSchema';
import { schema as mainSchema } from './fixtures/editorSchemaMain';
import { ROW_WIDTH_PROP } from './imageRowsEditor';
import { findUnknownContent } from './unknownContent';

// Fotos en fila (Docs/Doc_Imagenes.md): `rowWidth` es una propiedad del bloque `image`, nunca un tipo de
// bloque nuevo. La versión publicada (el esquema de `main`, copiado en fixtures/) no la conoce: tiene que
// abrir la página con las fotos y su `previewWidth`; si edita una foto pierde solo `rowWidth`. Y en esta
// versión, las filas se dibujan con decoraciones (sin tocar el documento) y el teclado se mueve por la fila.

const editors: BlockNoteEditor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
});

function mount(doc: Y.Doc, withSchema: unknown = schema): BlockNoteEditor {
  const editor = BlockNoteEditor.create(
    withCollaboration({
      schema: withSchema as typeof schema,
      collaboration: { fragment: doc.get(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
    }),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  editor.mount(el);
  editors.push(editor);
  return editor;
}

const tick = () => new Promise((r) => setTimeout(r, 30));
const photo = (n: number, rowWidth: number, previewWidth = 300) => ({
  type: 'image' as const,
  props: { url: `https://example.com/${n}.jpg`, previewWidth, [ROW_WIDTH_PROP]: rowWidth } as never,
});

function newPage(): { doc: Y.Doc; editor: BlockNoteEditor } {
  const doc = new Y.Doc();
  const editor = mount(doc);
  editor.replaceBlocks(editor.document, [
    { type: 'paragraph', content: 'Antes.' },
    photo(1, 0.5),
    photo(2, 0.5),
    photo(3, 0),
    { type: 'paragraph', content: 'Después.' },
  ]);
  return { doc, editor };
}

const rowWidths = (e: BlockNoteEditor) =>
  e.document.filter((b) => b.type === 'image').map((b) => Number((b.props as Record<string, unknown>)[ROW_WIDTH_PROP] ?? -1));

function selectImage(editor: BlockNoteEditor, index: number) {
  const view = editor.prosemirrorView!;
  let seen = 0;
  let at = -1;
  view.state.doc.descendants((node, pos) => {
    if (at >= 0) return false;
    if (node.type.name === 'image') {
      if (seen === index) at = pos;
      seen++;
    }
    return true;
  });
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, at)));
}

function press(editor: BlockNoteEditor, key: string) {
  editor.prosemirrorView!.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

describe('fotos en fila con el editor de la versión publicada (main)', () => {
  it('abre la página con todas las fotos y su previewWidth, sin cambiar nada ni frenar en la guarda', async () => {
    const { doc } = newPage();
    await tick();
    const docOld = new Y.Doc();
    Y.applyUpdate(docOld, Y.encodeStateAsUpdate(doc));
    const updates: Uint8Array[] = [];
    docOld.on('update', (u: Uint8Array) => updates.push(u));
    const old = mount(docOld, mainSchema);
    await tick();
    expect(findUnknownContent(docOld)).toBeNull();
    const images = old.document.filter((b) => b.type === 'image');
    expect(images).toHaveLength(3);
    expect(images.map((b) => (b.props as { previewWidth?: number }).previewWidth)).toEqual([300, 300, 300]);
    expect(updates).toHaveLength(0);
    // En el documento compartido la propiedad sigue: esta versión la sigue viendo.
    const again = mount(docOld);
    await tick();
    expect(rowWidths(again)).toEqual([0.5, 0.5, 0]);
  });

  it('si la versión publicada edita una foto, queda la foto con su previewWidth (se pierde solo rowWidth)', async () => {
    const { doc } = newPage();
    await tick();
    const docOld = new Y.Doc();
    Y.applyUpdate(docOld, Y.encodeStateAsUpdate(doc));
    const old = mount(docOld, mainSchema);
    await tick();
    const first = old.document.find((b) => b.type === 'image')!;
    old.updateBlock(first, { props: { caption: 'Set 1' } as never });
    await tick();
    const now = mount(docOld);
    await tick();
    const images = now.document.filter((b) => b.type === 'image');
    expect(images).toHaveLength(3);
    expect((images[0].props as { caption?: string }).caption).toBe('Set 1');
    expect((images[0].props as { previewWidth?: number }).previewWidth).toBe(300);
  });
});

describe('fotos en fila en esta versión', () => {
  it('dibuja la fila con decoraciones, sin tocar el documento', async () => {
    const { editor, doc } = newPage();
    await tick();
    const before = Y.encodeStateAsUpdate(doc);
    const dom = editor.domElement!;
    const group = dom.querySelector('.bn-block-group.img-rows');
    expect(group).not.toBeNull();
    const sized = [...dom.querySelectorAll<HTMLElement>('.bn-block-outer.img-sized')];
    expect(sized).toHaveLength(2);
    expect(sized.map((el) => el.style.getPropertyValue('--img-f').trim())).toEqual(['0.5', '0.5']);
    expect(sized.map((el) => el.style.getPropertyValue('--row-n').trim())).toEqual(['2', '2']);
    expect(sized[0].classList.contains('img-row-first')).toBe(true);
    expect(sized[1].classList.contains('img-row-last')).toBe(true);
    expect(sized[0].dataset.imgRow).toBe(sized[1].dataset.imgRow);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });

  it('una página sin fotos con ancho queda como antes (sin flex en ningún grupo)', async () => {
    const editor = mount(new Y.Doc());
    editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: 'Hola' }, photo(1, 0)]);
    await tick();
    expect(editor.domElement!.querySelector('.img-rows, .img-sized')).toBeNull();
  });

  it('una fila que no llena no marca la última (no se estira)', async () => {
    const editor = mount(new Y.Doc());
    editor.replaceBlocks(editor.document, [photo(1, 0.25), photo(2, 0.25)]);
    await tick();
    const sized = editor.domElement!.querySelectorAll('.img-sized');
    expect(sized).toHaveLength(2);
    expect(editor.domElement!.querySelector('.img-row-last')).toBeNull();
  });

  it('las flechas van de foto a foto en la fila, y abajo sale de la fila', async () => {
    const { editor } = newPage();
    await tick();
    selectImage(editor, 0);
    press(editor, 'ArrowRight');
    let sel = editor.prosemirrorView!.state.selection;
    expect(sel instanceof NodeSelection && (sel.node.attrs.url as string)).toBe('https://example.com/2.jpg');
    press(editor, 'ArrowLeft');
    sel = editor.prosemirrorView!.state.selection;
    expect(sel instanceof NodeSelection && (sel.node.attrs.url as string)).toBe('https://example.com/1.jpg');
    press(editor, 'ArrowDown');
    sel = editor.prosemirrorView!.state.selection;
    // Abajo de la fila está la tercera foto (sin ancho): queda elegida entera.
    expect(sel instanceof NodeSelection && (sel.node.attrs.url as string)).toBe('https://example.com/3.jpg');
  });

  it('abajo desde una fila hacia un separador lo elige (no lo saltea)', async () => {
    const editor = mount(new Y.Doc());
    editor.replaceBlocks(editor.document, [photo(1, 0.5), photo(2, 0.5), { type: 'divider' } as never, { type: 'paragraph', content: 'Fin' }]);
    await tick();
    selectImage(editor, 1);
    press(editor, 'ArrowDown');
    const sel = editor.prosemirrorView!.state.selection;
    expect(sel instanceof NodeSelection && sel.node.type.name).toBe('divider');
  });

  it('una foto sola que no llena el renglón respeta su alineación', async () => {
    const editor = mount(new Y.Doc());
    editor.replaceBlocks(editor.document, [
      { type: 'image', props: { url: 'https://example.com/c.jpg', [ROW_WIDTH_PROP]: 0.5, textAlignment: 'center' } as never },
    ]);
    await tick();
    expect(editor.domElement!.querySelector('.img-sized')!.classList.contains('img-align-center')).toBe(true);
  });

  it('Enter con la primera foto de la fila elegida escribe después de la fila', async () => {
    const { editor } = newPage();
    await tick();
    selectImage(editor, 0);
    press(editor, 'Enter');
    await tick();
    const types = editor.document.map((b) => b.type);
    expect(types).toEqual(['paragraph', 'image', 'image', 'paragraph', 'image', 'paragraph']);
    expect(editor.getTextCursorPosition().block.id).toBe(editor.document[3].id);
  });
});
