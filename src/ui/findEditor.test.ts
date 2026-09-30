// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { TextSelection } from '@tiptap/pm/state';
import { yUndoPluginKey } from 'y-prosemirror';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { unitsFromPM, unitsFromYDoc } from '../search/extract';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { driveLinkInNode } from './driveCard';
import { DRIVE_CARD_PROP, schema } from './editorSchema';
import {
  FIND_REPLACE_META,
  canUndoReplace,
  closeFind,
  findExtension,
  getFindState,
  isFindReplaceUndo,
  replaceAll,
  replaceCurrent,
  setFind,
  setFindCollapseHooks,
  stepFind,
  undoReplace,
} from './findEditor';

// Buscar y reemplazar en la página (Docs/Doc_Buscar.md), con el editor real y su Y.Doc.

const editors: BlockNoteEditor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
  setFindCollapseHooks(null);
});

function mount(doc = new Y.Doc()): BlockNoteEditor {
  const editor = BlockNoteEditor.create(
    withCollaboration({
      schema,
      extensions: [findExtension],
      collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
    }),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  editor.mount(el);
  editors.push(editor);
  return editor;
}

type Blocks = Parameters<BlockNoteEditor['replaceBlocks']>[1];

function page(blocks: unknown[]): { doc: Y.Doc; editor: BlockNoteEditor } {
  const doc = new Y.Doc();
  const editor = mount(doc);
  editor.replaceBlocks(editor.document, blocks as Blocks);
  return { doc, editor };
}

const view = (e: BlockNoteEditor) => e.prosemirrorView!;
const texts = (e: BlockNoteEditor) =>
  e.document.map((b) => (Array.isArray(b.content) ? (b.content as { text?: string; content?: { text: string }[] }[]).map((c) => c.text ?? c.content?.map((x) => x.text).join('') ?? '').join('') : ''));
const undoManager = (e: BlockNoteEditor) => (yUndoPluginKey.getState(view(e).state) as { undoManager: Y.UndoManager }).undoManager;
const highlighted = (e: BlockNoteEditor) => [...view(e).dom.querySelectorAll('.sd-find-hit')].map((el) => el.textContent);
const link = (href: string, text: string) => ({ type: 'link', href, content: text });

const RICH = [
  { type: 'heading', props: { level: 1 }, content: 'Cámara y luces' },
  {
    type: 'paragraph',
    content: [{ type: 'text', text: 'La ', styles: {} }, { type: 'text', text: 'cámara', styles: { bold: true } }, ' está en ', link('https://example.com', 'la cámara B')],
    children: [{ type: 'bulletListItem', content: 'hijo con cámara' }],
  },
  { type: 'paragraph', props: { script: true }, content: 'INT. CASA - DÍA' },
  { type: 'paragraph', props: { question: true }, content: '¿Qué cámara?' },
  { type: 'paragraph', content: 'línea uno\nlínea dos' },
  {
    type: 'table',
    content: { type: 'tableContent', rows: [{ cells: ['celda cámara', ''] }, { cells: ['', 'otra'] }] },
  },
  { type: 'image', props: { url: 'https://example.com/a.jpg', caption: 'Toma de cámara', name: 'camara.jpg' } },
  { type: 'paragraph', content: '' },
];

describe('extraer el texto de cada bloque', () => {
  it('el Y.Doc y el documento del editor dan las mismas unidades, en el mismo orden', () => {
    const { doc, editor } = page(RICH);
    const fromPM = unitsFromPM(view(editor).state.doc).map(({ blockId, field, text }) => ({ blockId, field, text }));
    const fromY = unitsFromYDoc(doc);
    expect(fromY).toEqual(fromPM);
    expect(fromY.map((u) => [u.field, u.text])).toEqual([
      ['text', 'Cámara y luces'],
      ['text', 'La cámara está en la cámara B'],
      ['text', 'hijo con cámara'],
      ['text', 'INT. CASA - DÍA'],
      ['text', '¿Qué cámara?'],
      ['text', 'línea uno￼línea dos'],
      ['text', 'celda cámara'],
      ['text', 'otra'],
      ['caption', 'Toma de cámara'],
      ['name', 'camara.jpg'],
    ]);
    // El hijo es un bloque propio, no parte del de arriba.
    expect(new Set(fromY.slice(1, 3).map((u) => u.blockId)).size).toBe(2);
  });

  it('un Y.Doc con un tipo que el esquema no conoce igual se lee', () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment(CONTENT_FRAGMENT);
    const group = new Y.XmlElement('blockGroup');
    const container = new Y.XmlElement('blockContainer');
    container.setAttribute('id', 'b1');
    const unknown = new Y.XmlElement('futureBlock');
    const text = new Y.XmlText();
    text.insert(0, 'texto del futuro');
    unknown.insert(0, [text]);
    container.insert(0, [unknown]);
    group.insert(0, [container]);
    fragment.insert(0, [group]);
    expect(unitsFromYDoc(doc)).toEqual([{ blockId: 'b1', field: 'text', text: 'texto del futuro' }]);
  });
});

describe('buscar en la página', () => {
  it('marca todas las coincidencias sin cambiar el documento, y la actual es la primera desde el cursor', () => {
    const { doc, editor } = page(RICH);
    const before = Y.encodeStateVector(doc);
    setFind(view(editor), 'camara', {});
    const state = getFindState(view(editor).state);
    // Título, párrafo (2), hijo, pregunta, celda, pie y nombre.
    expect(state.matches.map((m) => m.field)).toEqual(['text', 'text', 'text', 'text', 'text', 'text', 'caption', 'name']);
    expect(highlighted(editor)).toEqual(['Cámara', 'cámara', 'cámara', 'cámara', 'cámara', 'cámara']);
    expect(view(editor).dom.querySelectorAll('.sd-find-block').length).toBe(1);
    expect(Y.encodeStateVector(doc)).toEqual(before);
    expect(state.current).toBe(0);
  });

  it('siguiente y anterior dan la vuelta; cerrar deja elegida la actual', () => {
    const { editor } = page([{ type: 'paragraph', content: 'uno dos uno tres uno' }]);
    setFind(view(editor), 'uno', {});
    expect(getFindState(view(editor).state).current).toBe(0);
    stepFind(view(editor), -1);
    expect(getFindState(view(editor).state).current).toBe(2);
    stepFind(view(editor), 1);
    stepFind(view(editor), 1);
    expect(getFindState(view(editor).state).current).toBe(1);
    const { from, to } = getFindState(view(editor).state).matches[1];
    closeFind(view(editor));
    expect(getFindState(view(editor).state).query).toBe('');
    const sel = view(editor).state.selection;
    expect([sel.from, sel.to]).toEqual([from, to]);
    expect(view(editor).dom.querySelectorAll('.sd-find-hit').length).toBe(0);
  });

  it('una tilde descompuesta se encuentra y se resalta entera', () => {
    const { editor } = page([{ type: 'paragraph', content: 'INT. CASA - DÍA' }]);
    setFind(view(editor), 'dia', {});
    expect(highlighted(editor)).toEqual(['DÍA']);
    replaceAll(editor, 'NOCHE');
    expect(texts(editor)[0]).toBe('INT. CASA - NOCHE');
  });

  it('con Aa y palabra entera', () => {
    const { editor } = page([{ type: 'paragraph', content: 'Plano plano planos' }]);
    setFind(view(editor), 'plano', { matchCase: true, wholeWord: true });
    expect(getFindState(view(editor).state).matches.length).toBe(1);
  });

  it('un cambio del documento corre las marcas y se vuelve a buscar', async () => {
    const { editor } = page([{ type: 'paragraph', content: 'uno' }]);
    setFind(view(editor), 'uno', {});
    editor.insertBlocks([{ type: 'paragraph', content: 'otro uno' }], editor.document[0], 'before');
    expect(getFindState(view(editor).state).stale).toBe(true);
    await new Promise((r) => setTimeout(r, 250));
    expect(getFindState(view(editor).state).stale).toBe(false);
    expect(getFindState(view(editor).state).matches.length).toBe(2);
  });

  it('una coincidencia escondida (P.11) se abre antes de ir', () => {
    const { editor } = page([{ type: 'paragraph', content: 'uno' }, { type: 'paragraph', content: 'dos uno' }]);
    const hidden = editor.document[1].id;
    const reveal = vi.fn();
    setFindCollapseHooks({ isHidden: (id) => id === hidden, reveal });
    setFind(view(editor), 'uno', {});
    expect(reveal).not.toHaveBeenCalled();
    stepFind(view(editor), 1);
    expect(reveal).toHaveBeenCalledWith(hidden);
  });
});

describe('reemplazar en la página', () => {
  it('"Reemplazar todo" es un solo deshacer, aunque se haya escrito justo antes', () => {
    const { editor } = page([{ type: 'paragraph', content: 'uno dos uno' }, { type: 'paragraph', content: 'tres uno' }]);
    // El contenido inicial, en su propio paso.
    undoManager(editor).stopCapturing();
    // Escribir y reemplazar enseguida (dentro de los 500 ms en que Yjs junta los cambios).
    const v = view(editor);
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 3)).insertText('X'));
    expect(texts(editor)[0]).toBe('Xuno dos uno');
    setFind(v, 'uno', {});
    const result = replaceAll(editor, '1');
    expect(result.replaced).toBe(3);
    expect(texts(editor)).toEqual(['X1 dos 1', 'tres 1']);
    const um = undoManager(editor);
    expect(canUndoReplace(v, result.undoItem)).toBe(true);
    expect(undoReplace(v, result.undoItem)).toBe(true);
    // Vuelve lo reemplazado, pero no se deshace lo escrito antes.
    expect(texts(editor)).toEqual(['Xuno dos uno', 'tres uno']);
    um.undo();
    expect(texts(editor)[0]).toBe('uno dos uno');
  });

  it('marca el paso de deshacer, y también el de rehacer', () => {
    const { editor } = page([{ type: 'paragraph', content: 'uno uno' }]);
    const v = view(editor);
    setFind(v, 'uno', {});
    replaceAll(editor, 'dos');
    const um = undoManager(editor) as Y.UndoManager;
    expect(um.undoStack[um.undoStack.length - 1].meta.get(FIND_REPLACE_META)).toBe(true);
    const seen: boolean[] = [];
    // Lo que ve el colapso (P.11) mientras se aplica el deshacer.
    const off = editor.onChange(() => seen.push(isFindReplaceUndo(v.state)));
    um.undo();
    expect(um.redoStack[um.redoStack.length - 1].meta.get(FIND_REPLACE_META)).toBe(true);
    um.redo();
    expect(um.undoStack[um.undoStack.length - 1].meta.get(FIND_REPLACE_META)).toBe(true);
    off();
    expect(seen.length).toBeGreaterThan(0);
    expect(isFindReplaceUndo(v.state)).toBe(false);
  });

  it('"Reemplazar" cambia la actual y pasa a la siguiente', () => {
    const { editor } = page([{ type: 'paragraph', content: 'uno dos uno tres uno' }]);
    const v = view(editor);
    setFind(v, 'uno', {});
    stepFind(v, 1);
    const result = replaceCurrent(editor, 'UNO');
    expect(result.replaced).toBe(1);
    expect(texts(editor)[0]).toBe('uno dos UNO tres uno');
    // Sin Aa, "UNO" también coincide: la siguiente es la que sigue a lo reemplazado.
    const state = getFindState(v.state);
    expect(state.matches[state.current].from).toBeGreaterThan(state.matches[1].from - 1);
    expect(v.state.doc.textBetween(state.matches[state.current].from, state.matches[state.current].to)).toBe('uno');
  });

  it('quien no puede editar no reemplaza: el documento no cambia', () => {
    const { doc, editor } = page([{ type: 'paragraph', content: 'uno dos uno' }]);
    editor.isEditable = false;
    const before = Y.encodeStateVector(doc);
    setFind(view(editor), 'uno', {});
    expect(replaceAll(editor, 'x').blocked).toBe('readonly');
    expect(replaceCurrent(editor, 'x').blocked).toBe('readonly');
    expect(Y.encodeStateVector(doc)).toEqual(before);
    expect(texts(editor)[0]).toBe('uno dos uno');
  });

  it('conserva el link, también si la coincidencia es el texto entero del link', () => {
    const { editor } = page([{ type: 'paragraph', content: ['ver ', link('https://example.com/a', 'carpeta'), ' ya'] }]);
    setFind(view(editor), 'carpeta', {});
    replaceAll(editor, 'material');
    const content = editor.document[0].content as { type: string; href?: string; content?: { text: string }[] }[];
    const l = content.find((c) => c.type === 'link');
    expect(l?.href).toBe('https://example.com/a');
    expect(l?.content?.map((c) => c.text).join('')).toBe('material');
  });

  it('no borra un link entero (ni la tarjeta de Drive): lo saltea', () => {
    const url = 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view';
    const { editor } = page([
      { type: 'paragraph', props: { [DRIVE_CARD_PROP]: true }, content: [link(url, 'Video final')] },
      { type: 'paragraph', content: ['antes ', link('https://example.com', 'Video final')] },
    ]);
    const v = view(editor);
    setFind(v, 'video final', {});
    const empty = replaceAll(editor, '');
    expect(empty.replaced).toBe(0);
    expect(empty.skippedLinks).toBe(2);
    // Con texto nuevo sí: el link (y la tarjeta) siguen.
    setFind(v, 'video final', {});
    expect(replaceAll(editor, 'Corte 2').replaced).toBe(2);
    expect(driveLinkInNode(v.state.doc.firstChild!.firstChild!.firstChild!)?.id ?? null).not.toBeNull();
    // Una coincidencia que empieza afuera del link y lo cubre entero lo perdería: se saltea.
    setFind(v, 'antes corte 2', {});
    expect(replaceAll(editor, 'nada').skippedLinks).toBe(1);
  });

  it('los pies y los nombres de archivo se encuentran pero no se reemplazan', () => {
    const { editor } = page([
      { type: 'paragraph', content: 'toma' },
      { type: 'image', props: { url: 'https://example.com/a.jpg', caption: 'toma 1', name: 'toma.jpg' } },
    ]);
    setFind(view(editor), 'toma', {});
    const result = replaceAll(editor, 'plano');
    expect(result).toMatchObject({ replaced: 1, skippedFields: 2 });
    expect((editor.document[1].props as { caption: string }).caption).toBe('toma 1');
  });

  it('si alguien cambió la coincidencia antes de reemplazar, no se reemplaza y se vuelve a buscar', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    docA.on('update', (u: Uint8Array, origin: unknown) => origin !== 'remote' && Y.applyUpdate(docB, u, 'remote'));
    docB.on('update', (u: Uint8Array, origin: unknown) => origin !== 'remote' && Y.applyUpdate(docA, u, 'remote'));
    const a = mount(docA);
    a.replaceBlocks(a.document, [{ type: 'paragraph', content: 'uno dos' }] as Blocks);
    const b = mount(docB);
    setFind(view(a), 'uno', {});
    // Otro dispositivo cambia la palabra.
    const vb = view(b);
    vb.dispatch(vb.state.tr.insertText('X', 4));
    expect(texts(a)[0]).toBe('uXno dos');
    const result = replaceCurrent(a, 'uno!');
    expect(result.blocked).toBe('changed');
    expect(texts(a)[0]).toBe('uXno dos');
    expect(getFindState(view(a).state).matches.length).toBe(0);
  });

  it('un cambio de otro en otra parte no frena el reemplazo', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    docA.on('update', (u: Uint8Array, origin: unknown) => origin !== 'remote' && Y.applyUpdate(docB, u, 'remote'));
    docB.on('update', (u: Uint8Array, origin: unknown) => origin !== 'remote' && Y.applyUpdate(docA, u, 'remote'));
    const a = mount(docA);
    a.replaceBlocks(a.document, [{ type: 'paragraph', content: 'uno dos' }] as Blocks);
    const b = mount(docB);
    setFind(view(a), 'dos', {});
    const vb = view(b);
    vb.dispatch(vb.state.tr.insertText('cero ', 3));
    expect(replaceCurrent(a, 'tres').replaced).toBe(1);
    expect(texts(a)[0]).toBe('cero uno tres');
  });
});
