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
import { countsForSheets, isContentMutation } from './SheetBreaks';
import {
  FIND_REPLACE_META,
  canUndoReplace,
  closeFind,
  findExtension,
  hiddenCount,
  getFindState,
  isFindReplaceUndo,
  replaceAll,
  replaceCurrent,
  setFind,
  setFindCollapseHooks,
  stepFind,
  takeFindOnlyChanges,
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
  { type: 'codeBlock', content: 'const camara = 1;\nlog(camara)' },
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
      ['text', 'const camara = 1;\uFFFClog(camara)'],
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
    // Título, párrafo (2), hijo, pregunta, celda, pie, nombre y el código (2).
    expect(state.matches.map((m) => m.field)).toEqual(['text', 'text', 'text', 'text', 'text', 'text', 'caption', 'name', 'text', 'text']);
    expect(highlighted(editor)).toEqual(['Cámara', 'cámara', 'cámara', 'cámara', 'cámara', 'cámara', 'camara', 'camara']);
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
    // Mientras se deshace y se rehace, el colapso ve que es un reemplazo; después, ya no.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((x) => x === true)).toBe(true);
    expect(isFindReplaceUndo(v.state)).toBe(false);
    // Una edición común no está marcada.
    v.dispatch(v.state.tr.insertText('z', 2));
    expect(um.undoStack[um.undoStack.length - 1].meta.get(FIND_REPLACE_META)).toBeUndefined();
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

  it('"Reemplazar todo" escribe en el Y.Doc en una sola transacción, conserva el formato y se deshace entero', () => {
    const { doc, editor } = page([
      { type: 'paragraph', content: [{ type: 'text', text: 'uno ', styles: {} }, { type: 'text', text: 'uno', styles: { bold: true } }, ' dos'] },
      { type: 'paragraph', content: 'a\nuno' },
    ]);
    const v = view(editor);
    undoManager(editor).stopCapturing();
    const before = JSON.stringify(v.state.doc.toJSON());
    let transactions = 0;
    doc.on('update', () => transactions++);
    setFind(v, 'uno', {});
    const result = replaceAll(editor, 'tres');
    expect(result.replaced).toBe(3);
    expect(transactions).toBe(1);
    expect(texts(editor)).toEqual(['tres tres dos', 'a\ntres']);
    const content = editor.document[0].content as { text: string; styles: { bold?: boolean } }[];
    expect(content.find((c) => c.styles.bold)?.text).toBe('tres');
    expect(undoReplace(v, result.undoItem)).toBe(true);
    expect(JSON.stringify(v.state.doc.toJSON())).toBe(before);
  });

  it('"Reemplazar todo" en una página grande es rápido', () => {
    const blocks = Array.from({ length: 300 }, (_, i) => ({ type: 'paragraph', content: i % 3 === 0 ? `plano ${i} y plano, otro plano` : `bloque ${i} sin nada` }));
    const { editor } = page(blocks);
    setFind(view(editor), 'plano', {});
    const start = performance.now();
    const result = replaceAll(editor, 'toma');
    const ms = performance.now() - start;
    expect(result.replaced).toBe(300);
    // Una transacción por coincidencia tardaba más de un segundo en jsdom; en una sola, decenas de ms.
    expect(ms).toBeLessThan(600);
  });

  it('coreano: "하" no encuentra la mitad de "한" y no se escribe nada', () => {
    const { doc, editor } = page([{ type: 'paragraph', content: '한국' }]);
    const before = Y.encodeStateVector(doc);
    setFind(view(editor), '하', {});
    expect(getFindState(view(editor).state).matches.length).toBe(0);
    expect(replaceAll(editor, 'X').replaced).toBe(0);
    expect(Y.encodeStateVector(doc)).toEqual(before);
    expect(texts(editor)[0]).toBe('한국');
  });

  it('un emoji con tono de piel se reemplaza entero', () => {
    const { editor } = page([{ type: 'paragraph', content: 'ok 👍🏽 listo' }]);
    setFind(view(editor), '👍', {});
    replaceAll(editor, '✅');
    expect(texts(editor)[0]).toBe('ok ✅ listo');
  });

  it('en un bloque de código, un renglón no se une con el siguiente', () => {
    const { editor } = page([{ type: 'codeBlock', content: 'uno\ndos' }]);
    setFind(view(editor), 'uno dos', {});
    expect(getFindState(view(editor).state).matches.length).toBe(0);
    setFind(view(editor), 'dos', { wholeWord: true });
    expect(getFindState(view(editor).state).matches.length).toBe(1);
  });
});

describe('lo que no se ve', () => {
  it('los resaltados siguen en su lugar cuando llega un cambio de otro en otra parte', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    docA.on('update', (u: Uint8Array, origin: unknown) => origin !== 'remote' && Y.applyUpdate(docB, u, 'remote'));
    docB.on('update', (u: Uint8Array, origin: unknown) => origin !== 'remote' && Y.applyUpdate(docA, u, 'remote'));
    const a = mount(docA);
    a.replaceBlocks(a.document, [{ type: 'paragraph', content: 'uno dos' }, { type: 'paragraph', content: 'tres uno' }] as Blocks);
    const b = mount(docB);
    setFind(view(a), 'uno', {});
    expect(highlighted(a)).toEqual(['uno', 'uno']);
    // Otro dispositivo escribe en el segundo párrafo, antes de "uno".
    const vb = view(b);
    let pos = 0;
    vb.state.doc.descendants((n, p) => {
      if (n.isText && n.text === 'tres uno') pos = p + 5;
    });
    vb.dispatch(vb.state.tr.insertText('X', pos));
    expect(texts(a)[1]).toBe('tres Xuno');
    // Antes de volver a buscar, las marcas ya están en su lugar (no se juntaron en un punto).
    expect(getFindState(view(a).state).stale).toBe(true);
    expect(highlighted(a)).toEqual(['uno', 'uno']);
  });

  it('una coincidencia adentro de una lista plegable cerrada se cuenta como escondida, y al ir se abre la lista', () => {
    localStorage.clear();
    const { editor } = page([
      { type: 'paragraph', content: 'uno' },
      { type: 'toggleListItem', content: 'lista', children: [{ type: 'paragraph', content: 'adentro uno' }] },
    ]);
    const v = view(editor);
    const wrapper = () => v.dom.querySelector('.bn-toggle-wrapper')!;
    expect(wrapper().getAttribute('data-show-children')).toBe('false');
    setFind(v, 'uno', {});
    expect(hiddenCount(getFindState(v.state).matches, v)).toBe(1);
    stepFind(v, 1);
    expect(wrapper().getAttribute('data-show-children')).toBe('true');
    expect(hiddenCount(getFindState(v.state).matches, v)).toBe(0);
  });

  it('resaltar no cuenta como un cambio del documento para las marcas de hoja; escribir sí', async () => {
    const { editor } = page([{ type: 'paragraph', content: 'uno dos uno' }]);
    const v = view(editor);
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((r) => records.push(...r));
    observer.observe(v.dom, { subtree: true, childList: true, characterData: true, attributes: true });
    takeFindOnlyChanges();
    setFind(v, 'uno', {});
    stepFind(v, 1);
    closeFind(v, { select: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(records.some(isContentMutation)).toBe(true);
    expect(countsForSheets(records.splice(0), takeFindOnlyChanges())).toBe(false);
    v.dispatch(v.state.tr.insertText('X', 2));
    await new Promise((r) => setTimeout(r, 0));
    observer.disconnect();
    expect(countsForSheets(records, takeFindOnlyChanges())).toBe(true);
  });
});
