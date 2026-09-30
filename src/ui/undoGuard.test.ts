// @vitest-environment jsdom
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { blockPos, selectWholeBlock } from './blockHandle';
import { collapseExtension, headingBackspaceExtension, setCollapsed } from './collapseEditor';
import { schema } from './editorSchema';
import { findExtension } from './findEditor';
import { undoGuardExtension } from './undoGuard';

// Deshacer un borrado (pedido de Lega sobre v0.054): después de "Borrar" en el menú del bloque hacía falta apretar
// Ctrl+Z varias veces, y esos Ctrl+Z deshacían otras cosas antes de traer el bloque. Con el editor real y las
// extensiones de la página: escribir, esperar, borrar un bloque (los puntos y Retroceso, Supr o Cortar; común o un
// título colapsado); un Ctrl+Z trae justo el bloque borrado y nada más, y el segundo deshace lo escrito. Ctrl+Z
// llega por el atajo del editor o, con el foco afuera, como el deshacer del navegador (`historyUndo`), que antes
// editaba la página (undoGuard.ts).

Range.prototype.getClientRects ??= (() => []) as never;
Range.prototype.getBoundingClientRect ??= (() => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 })) as never;

const editors: BlockNoteEditor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
  document.body.replaceChildren();
});

function mount(): BlockNoteEditor {
  const doc = new Y.Doc();
  const editor = BlockNoteEditor.create(
    withCollaboration({
      schema,
      collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
      extensions: [findExtension, undoGuardExtension(), headingBackspaceExtension, collapseExtension({})],
    }),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  editor.mount(el);
  editors.push(editor);
  return editor;
}

const h = (level: number, text: string) => ({ type: 'heading', props: { level }, content: text }) as PartialBlock;
const p = (text: string) => ({ type: 'paragraph', content: text }) as PartialBlock;
/** Más que el medio segundo en que la pila de Yjs junta lo hecho. */
const pause = () => new Promise((r) => setTimeout(r, 650));
const tick = () => new Promise((r) => setTimeout(r, 20));
const view = (e: BlockNoteEditor) => e.prosemirrorView!;

function texts(e: BlockNoteEditor): string[] {
  return e.document.map((b) => (Array.isArray(b.content) ? b.content.map((c) => ('text' in c ? c.text : '')).join('') : b.type));
}
const idOf = (e: BlockNoteEditor, text: string) => e.document[texts(e).indexOf(text)].id;

/** Escribe al final de un bloque, letra por letra, como el teclado. */
function typeAtEnd(e: BlockNoteEditor, text: string, word: string) {
  e.setTextCursorPosition(idOf(e, text), 'end');
  const v = view(e);
  for (const ch of word) {
    const { from, to } = v.state.selection;
    if (!v.someProp('handleTextInput', (f) => f(v, from, to, ch, () => v.state.tr.insertText(ch)))) v.dispatch(v.state.tr.insertText(ch));
  }
}

function press(e: BlockNoteEditor, key: string, init: KeyboardEventInit = {}) {
  view(e).dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

function cut(e: BlockNoteEditor) {
  const data = new Map<string, string>();
  const event = new Event('cut', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { clearData: () => data.clear(), setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? '' },
  });
  view(e).dom.dispatchEvent(event);
}

/** El deshacer del navegador sobre el editor (Ctrl+Z con el foco afuera, el menú Edición). */
function nativeHistory(e: BlockNoteEditor, inputType: 'historyUndo' | 'historyRedo'): InputEvent {
  const event = new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true });
  view(e).dom.dispatchEvent(event);
  return event;
}

const undoWays = {
  atajo: (e: BlockNoteEditor) => press(e, 'z', { ctrlKey: true }),
  navegador: (e: BlockNoteEditor) => nativeHistory(e, 'historyUndo'),
};
const deleteWays = ['Backspace', 'Delete', 'cut'] as const;

describe('un borrado es un solo Ctrl+Z', () => {
  for (const [undoName, undo] of Object.entries(undoWays)) {
    for (const how of deleteWays) {
      for (const collapsed of [false, true]) {
        it(`${collapsed ? 'título colapsado' : 'bloque'}: los puntos y ${how}, deshacer con ${undoName}`, async () => {
          const e = mount();
          e.replaceBlocks(e.document, [p('a'), p('b'), h(2, 'T'), p('t1'), p('t2'), h(2, 'U'), p('c')] as never);
          await pause();
          typeAtEnd(e, 'b', 'xyz');
          await pause();
          const target = collapsed ? 'T' : 'c';
          if (collapsed) setCollapsed(view(e), [idOf(e, 'T')], true);
          const before = texts(e);
          expect(selectWholeBlock(view(e), idOf(e, target))).toBe(true);
          if (how === 'cut') cut(e);
          else press(e, how);
          expect(texts(e)).toEqual(collapsed ? ['a', 'bxyz', 'U', 'c'] : ['a', 'bxyz', 'T', 't1', 't2', 'U']);
          await tick();
          undo(e);
          await tick();
          // Justo el bloque (con su sección), y lo escrito sigue.
          expect(texts(e)).toEqual(before);
          undo(e);
          await tick();
          expect(texts(e)).toEqual(['a', 'b', 'T', 't1', 't2', 'U', 'c']);
        });
      }
    }
  }

  it('borrar enseguida después de escribir (sin esperar, el bloque elegido sin cambiar el foco) sigue siendo su propio paso', async () => {
    const e = mount();
    e.replaceBlocks(e.document, [p('a'), p('b'), p('c')] as never);
    await pause();
    typeAtEnd(e, 'b', 'xyz');
    // Como con el teclado: la selección pasa al bloque entero sin que el editor pierda el foco.
    const v = view(e);
    v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, blockPos(v, idOf(e, 'c')))));
    press(e, 'Backspace');
    expect(texts(e)).toEqual(['a', 'bxyz']);
    press(e, 'z', { ctrlKey: true });
    await tick();
    expect(texts(e)).toEqual(['a', 'bxyz', 'c']);
    press(e, 'z', { ctrlKey: true });
    await tick();
    expect(texts(e)).toEqual(['a', 'b', 'c']);
  });

  it('lo escrito enseguida después de borrar es otro paso', async () => {
    const e = mount();
    e.replaceBlocks(e.document, [p('a'), p('b'), p('c')] as never);
    await pause();
    selectWholeBlock(view(e), idOf(e, 'c'));
    press(e, 'Delete');
    await tick();
    typeAtEnd(e, 'a', '!!');
    expect(texts(e)).toEqual(['a!!', 'b']);
    press(e, 'z', { ctrlKey: true });
    await tick();
    expect(texts(e)).toEqual(['a', 'b']);
    press(e, 'z', { ctrlKey: true });
    await tick();
    expect(texts(e)).toEqual(['a', 'b', 'c']);
  });

  it('el deshacer y el rehacer del navegador se cancelan y hacen los de la página', async () => {
    const e = mount();
    e.replaceBlocks(e.document, [p('a'), p('b')] as never);
    await pause();
    typeAtEnd(e, 'a', 'zz');
    await pause();
    const undoEvent = nativeHistory(e, 'historyUndo');
    expect(undoEvent.defaultPrevented).toBe(true);
    await tick();
    expect(texts(e)).toEqual(['a', 'b']);
    const redoEvent = nativeHistory(e, 'historyRedo');
    expect(redoEvent.defaultPrevented).toBe(true);
    await tick();
    expect(texts(e)).toEqual(['azz', 'b']);
    // Otra entrada (escribir) no se toca.
    const typing = new InputEvent('beforeinput', { inputType: 'insertText', data: 'q', bubbles: true, cancelable: true });
    view(e).dom.dispatchEvent(typing);
    expect(typing.defaultPrevented).toBe(false);
  });

  it('elegir el bloque con los puntos deja el foco en el editor (Ctrl+Z llega al editor)', () => {
    const e = mount();
    e.replaceBlocks(e.document, [p('a'), p('b')] as never);
    (document.activeElement as HTMLElement | null)?.blur();
    selectWholeBlock(view(e), idOf(e, 'b'));
    expect(view(e).state.selection.toJSON()).toMatchObject({ type: 'node' });
    expect(view(e).dom.contains(document.activeElement) || document.activeElement === view(e).dom).toBe(true);
    expect(view(e).state.selection).not.toBeInstanceOf(TextSelection);
  });
});
