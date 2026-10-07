// @vitest-environment jsdom
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { AllSelection, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { DecorationSet } from '@tiptap/pm/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { yUndoPluginKey } from 'y-prosemirror';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import type { HeadingRecord } from './collapse';
import { collapseExtension, collapseKey, collapseState, headingBackspaceExtension, isSelectAllKey, revealBlock, setAllCollapsed, setCollapsed } from './collapseEditor';
import { hiderInDom } from './collapseDom';
import { selectWholeBlock } from './blockHandle';
import { paragraphProps, schema } from './editorSchema';
import { FIND_REPLACE_META } from './editorMeta';

// jsdom: ProseMirror mide la selección al llevarla a la vista (los puntos dejan el foco en el editor).
Range.prototype.getClientRects ??= (() => []) as never;
Range.prototype.getBoundingClientRect ??= (() => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 })) as never;

// Colapsar secciones (Docs/Doc_Colapsar.md) con el editor real: qué se esconde, que colapsar no toca el
// documento, y cada caso de edición al lado de lo escondido.

const editors: BlockNoteEditor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

type Saved = ReadonlyMap<string, HeadingRecord>;

function mount(doc = new Y.Doc(), initial?: Saved): { editor: BlockNoteEditor; doc: Y.Doc; saves: Saved[] } {
  const saves: Saved[] = [];
  const editor = BlockNoteEditor.create(
    withCollaboration({
      schema,
      collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
      extensions: [collapseExtension({ initial, save: (r: Saved) => saves.push(r) }), headingBackspaceExtension],
    }),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  editor.mount(el);
  editors.push(editor);
  return { editor, doc, saves };
}

const tick = () => new Promise((r) => setTimeout(r, 30));
/** Lo que la pasada de colapsar deja para después (abrir la sección cuando una edición no se hizo). */
const settle = () => new Promise((r) => setTimeout(r, 0));
// jsdom no tiene `ClipboardEvent` (pegar de ProseMirror lo usa).
(globalThis as { ClipboardEvent?: unknown }).ClipboardEvent ??= class extends Event {
  clipboardData: unknown = null;
};
const h = (level: number, text: string, children: PartialBlock[] = []) =>
  ({ type: 'heading', props: { level }, content: text, children }) as PartialBlock;
const p = (text: string, children: PartialBlock[] = []) => ({ type: 'paragraph', content: text, children }) as PartialBlock;

function page(blocks: PartialBlock[], initial?: Saved) {
  const m = mount(new Y.Doc(), initial);
  m.editor.replaceBlocks(m.editor.document, blocks as never);
  return m;
}

/** El id del bloque con ese texto (en cualquier nivel). */
function idOf(editor: BlockNoteEditor, text: string): string {
  let found = '';
  const walk = (blocks: typeof editor.document) => {
    for (const b of blocks) {
      const content = Array.isArray(b.content) ? b.content.map((c) => ('text' in c ? c.text : '')).join('') : '';
      if (content === text) found ||= b.id;
      walk(b.children);
    }
  };
  walk(editor.document);
  if (!found) throw new Error(`sin bloque "${text}"`);
  return found;
}

/** Los textos de los bloques que se ven (sin los escondidos), en orden. */
function visible(editor: BlockNoteEditor): string[] {
  const state = collapseState(editor.prosemirrorState)!;
  const out: string[] = [];
  const walk = (blocks: typeof editor.document) => {
    for (const b of blocks) {
      if (!state.analysis.hidden.has(b.id)) {
        out.push(Array.isArray(b.content) ? b.content.map((c) => ('text' in c ? c.text : '')).join('') : b.type);
      }
      walk(b.children);
    }
  };
  walk(editor.document);
  return out;
}

function texts(editor: BlockNoteEditor): string[] {
  const out: string[] = [];
  const walk = (blocks: typeof editor.document) => {
    for (const b of blocks) {
      out.push(Array.isArray(b.content) ? b.content.map((c) => ('text' in c ? c.text : '')).join('') : b.type);
      walk(b.children);
    }
  };
  walk(editor.document);
  return out;
}

const view = (editor: BlockNoteEditor) => editor.prosemirrorView!;

/** Lo que sigue es otro paso para Ctrl+Z (si no, Yjs junta lo hecho en el último medio segundo). */
function undoPoint(editor: BlockNoteEditor) {
  const state = yUndoPluginKey.getState(view(editor).state as never) as { undoManager: Y.UndoManager };
  state.undoManager.stopCapturing();
}
const collapse = (editor: BlockNoteEditor, ...names: string[]) =>
  setCollapsed(view(editor), names.map((n) => idOf(editor, n)), true);

function press(editor: BlockNoteEditor, key: string, init: KeyboardEventInit = {}) {
  view(editor).dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

/** La posición del final (o del principio) del texto del bloque con ese texto. */
function textPos(editor: BlockNoteEditor, text: string, where: 'start' | 'end' = 'end'): number {
  const id = idOf(editor, text);
  let at = -1;
  editor.prosemirrorState.doc.descendants((node, pos) => {
    if (at >= 0) return false;
    if (node.type.name === 'blockContainer' && node.attrs.id === id) {
      at = pos + 2 + (where === 'end' ? node.firstChild!.content.size : 0);
      return false;
    }
    return true;
  });
  return at;
}

function putCaret(editor: BlockNoteEditor, text: string, where: 'start' | 'end' = 'end') {
  const v = view(editor);
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, textPos(editor, text, where))));
}

function selectBlock(editor: BlockNoteEditor, text: string) {
  const v = view(editor);
  const pos = textPos(editor, text, 'start') - 2;
  v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, pos)));
}

const caretBlock = (editor: BlockNoteEditor) => {
  const b = editor.getTextCursorPosition().block;
  return Array.isArray(b.content) ? b.content.map((c) => ('text' in c ? c.text : '')).join('') : b.type;
};

const SCENES = () => [
  h(1, 'Acto 1'),
  p('Intro'),
  h(2, 'Escena 1'),
  p('Uno'),
  h(3, 'Detalle'),
  p('Detalle texto'),
  h(2, 'Escena 2'),
  p('Dos'),
  h(1, 'Acto 2'),
  p('Final'),
];

describe('qué esconde un título', () => {
  it('un H1 esconde sus H2 y H3 hasta el próximo H1; un H2, hasta el próximo H2 o H1', async () => {
    const { editor } = page(SCENES());
    collapse(editor, 'Acto 1');
    expect(visible(editor)).toEqual(['Acto 1', 'Acto 2', 'Final']);
    setCollapsed(view(editor), [idOf(editor, 'Acto 1')], false);
    collapse(editor, 'Escena 1');
    expect(visible(editor)).toEqual(['Acto 1', 'Intro', 'Escena 1', 'Escena 2', 'Dos', 'Acto 2', 'Final']);
  });

  it('los títulos de adentro guardan su estado al abrir el de afuera', () => {
    const { editor } = page(SCENES());
    collapse(editor, 'Escena 1', 'Acto 1');
    expect(visible(editor)).toEqual(['Acto 1', 'Acto 2', 'Final']);
    setCollapsed(view(editor), [idOf(editor, 'Acto 1')], false);
    expect(visible(editor)).toEqual(['Acto 1', 'Intro', 'Escena 1', 'Escena 2', 'Dos', 'Acto 2', 'Final']);
  });

  it('los hijos anidados del título se esconden; un título anidado en otro grupo no corta la sección', () => {
    const { editor } = page([h(2, 'T', [p('hijo')]), p('a', [h(1, 'anidado')]), p('b'), h(2, 'U')]);
    collapse(editor, 'T');
    expect(visible(editor)).toEqual(['T', 'U']);
  });

  it('la última sección llega hasta el final, salvo el último párrafo vacío de la página', () => {
    const { editor } = page([p('antes'), h(2, 'T'), p('a'), p('')]);
    collapse(editor, 'T');
    expect(visible(editor)).toEqual(['antes', 'T', '']);
  });

  it('colapsar no cambia el documento y lo marca con decoraciones', async () => {
    const { editor, doc, saves } = page(SCENES());
    await tick();
    const before = Y.encodeStateAsUpdate(doc);
    collapse(editor, 'Escena 1');
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    const dom = editor.domElement!;
    expect(dom.querySelectorAll('.bn-block-content.sd-collapsed')).toHaveLength(1);
    const hidden = [...dom.querySelectorAll<HTMLElement>('.bn-block-content.sd-collapsed-hidden')];
    expect(hidden).toHaveLength(3);
    expect(hidden.every((el) => el.dataset.sdHider === idOf(editor, 'Escena 1'))).toBe(true);
    expect(saves.at(-1)?.get(idOf(editor, 'Escena 1'))).toEqual({ c: true, g: null });
    // Desde el DOM se sabe quién esconde qué (el margen y las marcas de hoja lo usan).
    const detalle = dom.querySelector(`[data-id="${idOf(editor, 'Detalle texto')}"] .bn-block-content`)!;
    expect(hiderInDom(detalle)).toBe(idOf(editor, 'Escena 1'));
    const dos = dom.querySelector(`[data-id="${idOf(editor, 'Dos')}"] .bn-block-content`)!;
    expect(hiderInDom(dos)).toBeNull();
  });

  it('un título que deja de serlo muestra lo que escondía', () => {
    const { editor } = page(SCENES());
    collapse(editor, 'Escena 1');
    editor.updateBlock(idOf(editor, 'Escena 1'), { type: 'paragraph' });
    expect(visible(editor)).toContain('Uno');
  });

  it('lo guardado se lee al abrir: la página arranca colapsada', async () => {
    const first = page(SCENES());
    await tick();
    const id = idOf(first.editor, 'Escena 1');
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(first.doc));
    const again = mount(doc, new Map([[id, { c: true, g: null }]]));
    await tick();
    expect(visible(again.editor)).not.toContain('Uno');
  });
});

/** Un evento de copiar o cortar con un portapapeles de mentira (jsdom no tiene). */
function clipboardEvent(type: 'copy' | 'cut'): Event {
  const data = new Map<string, string>();
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { clearData: () => data.clear(), setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? '' },
  });
  return event;
}

function notices(): string[] {
  const seen: string[] = [];
  const on = (e: Event) => seen.push((e as CustomEvent<string>).detail);
  window.addEventListener('shotdocs:notice', on);
  editorsCleanup.push(() => window.removeEventListener('shotdocs:notice', on));
  return seen;
}
const editorsCleanup: (() => void)[] = [];
afterEach(() => {
  for (const c of editorsCleanup.splice(0)) c();
});

/** Otro dispositivo con la misma página: lo que escribe llega por Yjs, como de otra persona. */
function linked(doc: Y.Doc) {
  const other = new Y.Doc();
  Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
  const m = mount(other);
  const sync = () => {
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other, Y.encodeStateVector(doc)));
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc, Y.encodeStateVector(other)));
  };
  return { ...m, sync };
}

describe('editar al lado de lo escondido', () => {
  it('colapsar con la selección adentro la lleva al final del título', () => {
    const { editor } = page(SCENES());
    putCaret(editor, 'Uno');
    collapse(editor, 'Escena 1');
    expect(caretBlock(editor)).toBe('Escena 1');
    expect(view(editor).state.selection.head).toBe(textPos(editor, 'Escena 1'));
  });

  it('una selección que cae en algo escondido sin cambiar el documento pasa al final del título', () => {
    const { editor } = page(SCENES());
    collapse(editor, 'Escena 1');
    putCaret(editor, 'Detalle texto', 'start');
    expect(caretBlock(editor)).toBe('Escena 1');
    expect(visible(editor)).not.toContain('Uno');
  });

  it('Supr al final de un título colapsado no une lo escondido', () => {
    const { editor } = page(SCENES());
    collapse(editor, 'Escena 1');
    putCaret(editor, 'Escena 1');
    press(editor, 'Delete');
    expect(texts(editor)).toEqual(texts(page(SCENES()).editor));
  });

  it('→ y ↓ al final de un título colapsado saltan lo escondido; con Shift extienden desde el mismo lugar', () => {
    const { editor } = page(SCENES());
    collapse(editor, 'Escena 1');
    putCaret(editor, 'Escena 1');
    press(editor, 'ArrowRight');
    expect(caretBlock(editor)).toBe('Escena 2');
    expect(view(editor).state.selection.head).toBe(textPos(editor, 'Escena 2', 'start'));
    putCaret(editor, 'Escena 1');
    const anchor = view(editor).state.selection.anchor;
    press(editor, 'ArrowRight', { shiftKey: true });
    expect(view(editor).state.selection.anchor).toBe(anchor);
    expect(view(editor).state.selection.head).toBe(textPos(editor, 'Escena 2', 'start'));
  });

  it('Enter al final de un título colapsado crea un renglón después de toda la sección, sin abrirla', async () => {
    const { editor, saves } = page(SCENES());
    collapse(editor, 'Acto 1');
    putCaret(editor, 'Acto 1');
    press(editor, 'Enter');
    editor.insertInlineContent('nuevo');
    expect(visible(editor)).toEqual(['Acto 1', 'nuevo', 'Acto 2', 'Final']);
    expect(texts(editor).indexOf('nuevo')).toBe(texts(editor).indexOf('Acto 2') - 1);
    // Lo guardado recuerda el fin: al volver a abrir la página, el renglón se sigue viendo.
    const record = saves.at(-1)!.get(idOf(editor, 'Acto 1'))!;
    expect(record.e).toBe(idOf(editor, 'nuevo'));
    // Un segundo Enter sigue abajo del renglón nuevo, a la vista.
    press(editor, 'Enter');
    editor.insertInlineContent('otro');
    expect(visible(editor)).toEqual(['Acto 1', 'nuevo', 'otro', 'Acto 2', 'Final']);
  });

  it('Enter al final del último título colapsado: el renglón va al final y se ve; si ya hay un párrafo vacío, va ahí', () => {
    const { editor } = page([h(1, 'Solo'), p('a'), p('b')]);
    collapse(editor, 'Solo');
    putCaret(editor, 'Solo');
    press(editor, 'Enter');
    expect(texts(editor)).toEqual(['Solo', 'a', 'b', '']);
    expect(visible(editor)).toEqual(['Solo', '']);
    putCaret(editor, 'Solo');
    press(editor, 'Enter');
    expect(texts(editor)).toEqual(['Solo', 'a', 'b', '']);
    expect(caretBlock(editor)).toBe('');
  });

  it('borrar el renglón del fin no esconde lo que sigue', () => {
    const { editor } = page([h(1, 'T'), p('a'), p('b')]);
    collapse(editor, 'T');
    putCaret(editor, 'T');
    press(editor, 'Enter');
    editor.insertInlineContent('x');
    press(editor, 'Enter');
    editor.insertInlineContent('y');
    editor.removeBlocks([idOf(editor, 'x')]);
    expect(visible(editor)).toEqual(['T', 'y']);
  });

  it('un cambio propio en algo escondido lo abre; uno de la app en segundo plano, no', async () => {
    const { editor } = page(SCENES());
    collapse(editor, 'Escena 1');
    editor.transact((tr) => {
      tr.setMeta('sd-background', true);
      editor.updateBlock(idOf(editor, 'Uno'), { content: 'Uno!' });
    });
    expect(visible(editor)).not.toContain('Uno!');
    editor.updateBlock(idOf(editor, 'Uno!'), { content: 'Uno!!' });
    expect(visible(editor)).toContain('Uno!!');
  });

  it('un cambio de otro adentro de lo escondido no lo abre', async () => {
    const { editor, doc } = page(SCENES());
    await tick();
    const other = linked(doc);
    await tick();
    collapse(editor, 'Escena 1');
    other.editor.updateBlock(idOf(other.editor, 'Uno'), { content: 'Uno (de otro)' });
    other.sync();
    await tick();
    expect(texts(editor)).toContain('Uno (de otro)');
    expect(visible(editor)).not.toContain('Uno (de otro)');
  });

  it('lo que se veía y queda escondido por un cambio de otro se abre para vos', async () => {
    const { editor, doc } = page(SCENES());
    await tick();
    const other = linked(doc);
    await tick();
    collapse(editor, 'Escena 1');
    // Otro pasa "Escena 2" a párrafo: "Escena 2" y "Dos" quedarían dentro de la sección colapsada.
    other.editor.updateBlock(idOf(other.editor, 'Escena 2'), { type: 'paragraph' });
    other.sync();
    await tick();
    expect(visible(editor)).toContain('Dos');
    expect(visible(editor)).toContain('Uno');
  });

  it('Retroceso en el título que sigue a una sección colapsada: se une al título colapsado y la sección se abre', () => {
    const { editor } = page(SCENES());
    collapse(editor, 'Escena 1');
    putCaret(editor, 'Escena 2', 'start');
    press(editor, 'Backspace');
    expect(texts(editor)).toContain('Escena 1Escena 2');
    expect(visible(editor)).toContain('Dos');
    expect(visible(editor)).toContain('Uno');
  });

  it('pasar un título colapsado a un nivel mayor no esconde de golpe las secciones de al lado', () => {
    const { editor } = page(SCENES());
    collapse(editor, 'Escena 1');
    editor.updateBlock(idOf(editor, 'Escena 1'), { props: { level: 1 } as never });
    expect(visible(editor)).toContain('Escena 2');
    expect(visible(editor)).toContain('Dos');
  });

  it('Retroceso al principio de un título colapsado vacío lo borra y lo escondido se ve; no se borra nada más', () => {
    const { editor } = page([p('antes'), h(2, ''), p('a'), p('b'), h(2, 'Otra')]);
    const empty = editor.document[1].id;
    setCollapsed(view(editor), [empty], true);
    editor.setTextCursorPosition(empty, 'start');
    press(editor, 'Backspace');
    expect(texts(editor)).toEqual(['antes', 'a', 'b', 'Otra']);
    expect(visible(editor)).toEqual(['antes', 'a', 'b', 'Otra']);
  });

  it('deshacer un cambio en algo escondido lo abre; deshacer un reemplazo de la búsqueda, no', async () => {
    const { editor } = page(SCENES());
    await tick();
    collapse(editor, 'Escena 1');
    const um = (yUndoPluginKey.getState(view(editor).state as never) as { undoManager: Y.UndoManager }).undoManager;
    um.stopCapturing();
    // Un reemplazo de la búsqueda: su transacción y su entrada de deshacer llevan la marca.
    let tag = true;
    um.on('stack-item-added', (e: { stackItem: { meta: Map<unknown, unknown> } }) => {
      if (tag) e.stackItem.meta.set(FIND_REPLACE_META, true);
    });
    editor.transact((tr) => {
      tr.setMeta(FIND_REPLACE_META, true);
      editor.updateBlock(idOf(editor, 'Uno'), { content: 'Un' });
    });
    await tick();
    expect(visible(editor)).not.toContain('Un');
    um.stopCapturing();
    tag = false;
    editor.undo();
    await tick();
    expect(texts(editor)).toContain('Uno');
    expect(visible(editor)).not.toContain('Uno');
    // Un cambio común (que abre), se vuelve a colapsar, y deshacerlo abre de nuevo.
    editor.updateBlock(idOf(editor, 'Dos'), { content: 'Dos.' });
    um.stopCapturing();
    editor.updateBlock(idOf(editor, 'Uno'), { content: 'Uno.' });
    await tick();
    collapse(editor, 'Escena 1');
    expect(visible(editor)).not.toContain('Uno.');
    editor.undo();
    await tick();
    expect(visible(editor)).toContain('Uno');
  });
});

describe('borrar un título colapsado borra su sección entera', () => {
  it('clic en los puntos (el bloque elegido) y Retroceso: el título, lo escondido, los hijos y las secciones colapsadas de adentro; un aviso; deshacer trae todo', async () => {
    const seen = notices();
    const { editor } = page([p('antes'), h(1, 'Acto', [p('hijo')]), p('a'), h(2, 'Sub'), p('b'), h(1, 'Otro'), p('c')]);
    await tick();
    const ids = texts(editor).map((t) => (t ? idOf(editor, t) : ''));
    collapse(editor, 'Sub', 'Acto');
    undoPoint(editor);
    selectWholeBlock(view(editor), idOf(editor, 'Acto'));
    press(editor, 'Backspace');
    expect(texts(editor)).toEqual(['antes', 'Otro', 'c']);
    expect(seen.at(-1)).toMatch(/colapsado|collapsed/);
    await tick();
    editor.undo();
    await tick();
    expect(texts(editor)).toEqual(['antes', 'Acto', 'hijo', 'a', 'Sub', 'b', 'Otro', 'c']);
    expect(texts(editor).map((t) => (t ? idOf(editor, t) : ''))).toEqual(ids);
    // Vuelve colapsado, con lo de adentro como estaba.
    expect(visible(editor)).toEqual(['antes', 'Acto', 'Otro', 'c']);
    setCollapsed(view(editor), [idOf(editor, 'Acto')], false);
    expect(visible(editor)).toEqual(['antes', 'Acto', 'hijo', 'a', 'Sub', 'Otro', 'c']);
  });

  it('el bloque elegido entero con Retroceso o Supr', () => {
    for (const key of ['Backspace', 'Delete']) {
      const { editor } = page(SCENES());
      collapse(editor, 'Escena 1');
      selectBlock(editor, 'Escena 1');
      press(editor, key);
      expect(texts(editor)).toEqual(['Acto 1', 'Intro', 'Escena 2', 'Dos', 'Acto 2', 'Final']);
    }
  });

  it('el último título colapsado de la página', () => {
    const { editor } = page([p('antes'), h(2, 'Último'), p('a'), p('b', [p('b1')])]);
    collapse(editor, 'Último');
    selectWholeBlock(view(editor), idOf(editor, 'Último'));
    press(editor, 'Delete');
    expect(texts(editor)).toEqual(['antes']);
  });

  it('una página que queda vacía queda con un párrafo vacío', async () => {
    const { editor } = page([h(1, 'Todo'), p('a'), p('b')]);
    collapse(editor, 'Todo');
    await tick();
    undoPoint(editor);
    selectBlock(editor, 'Todo');
    press(editor, 'Backspace');
    expect(editor.document).toHaveLength(1);
    expect(editor.document[0].type).toBe('paragraph');
    expect(texts(editor)).toEqual(['']);
    await tick();
    editor.undo();
    await tick();
    expect(texts(editor)).toEqual(['Todo', 'a', 'b']);
  });

  it('una selección que cruza lo escondido lo borra también, con el aviso', () => {
    const seen = notices();
    const { editor } = page(SCENES());
    collapse(editor, 'Escena 1');
    const v = view(editor);
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, textPos(editor, 'Intro'), textPos(editor, 'Escena 2', 'start'))));
    press(editor, 'Backspace');
    expect(texts(editor)).toEqual(['Acto 1', 'IntroEscena 2', 'Dos', 'Acto 2', 'Final']);
    expect(seen).toHaveLength(1);
  });

  it('juntar el título con el bloque de arriba (con parte de su texto) no es borrarlo: lo escondido queda y se abre', () => {
    const { editor } = page([p('antes'), h(2, 'Titulo'), p('a'), h(2, 'U')]);
    collapse(editor, 'Titulo');
    const v = view(editor);
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, textPos(editor, 'antes'), textPos(editor, 'Titulo', 'start') + 2)));
    press(editor, 'Backspace');
    expect(texts(editor)).toEqual(['antestulo', 'a', 'U']);
    expect(visible(editor)).toEqual(['antestulo', 'a', 'U']);
  });

  it('si otro edita adentro mientras tanto, no se rompe nada y su bloque nuevo queda a la vista', async () => {
    const { editor, doc } = page(SCENES());
    await tick();
    const other = linked(doc);
    await tick();
    collapse(editor, 'Escena 1');
    selectWholeBlock(view(editor), idOf(editor, 'Escena 1'));
    press(editor, 'Backspace');
    other.editor.insertBlocks([{ type: 'paragraph', content: 'de otro' }], idOf(other.editor, 'Uno'), 'after');
    other.editor.updateBlock(idOf(other.editor, 'Detalle texto'), { content: 'cambiado' });
    other.sync();
    await tick();
    expect(texts(editor)).toEqual(['Acto 1', 'Intro', 'de otro', 'Escena 2', 'Dos', 'Acto 2', 'Final']);
    expect(visible(editor)).toContain('de otro');
    expect(texts(other.editor)).toEqual(texts(editor));
  });

  it('copiar o cortar el título elegido entero lleva la sección entera', () => {
    const { editor } = page(SCENES());
    collapse(editor, 'Escena 1');
    selectBlock(editor, 'Escena 1');
    view(editor).dom.dispatchEvent(clipboardEvent('copy'));
    const sel = view(editor).state.selection;
    expect((sel.toJSON() as { type: string }).type).toBe('sd-section');
    expect(sel.content().content.childCount).toBe(4);
  });

  it('cortar el título elegido entero de una página que es solo esa sección deja un párrafo vacío', () => {
    const { editor } = page([h(1, 'Todo'), p('a'), p('b')]);
    collapse(editor, 'Todo');
    selectBlock(editor, 'Todo');
    const event = clipboardEvent('cut');
    view(editor).dom.dispatchEvent(event);
    const html = (event as unknown as { clipboardData: { getData: (k: string) => string } }).clipboardData.getData('text/html');
    expect(html).toContain('Todo');
    expect(html).toContain('b');
    expect(html).toMatch(/<p[^>]*>a<\/p>/);
    expect(editor.document).toHaveLength(1);
    expect(texts(editor)).toEqual(['']);
  });
});

describe('el atajo', () => {
  it('Ctrl/⌘+Alt+Enter colapsa el título de la sección donde está la selección, y lo vuelve a abrir', () => {
    const { editor } = page(SCENES());
    putCaret(editor, 'Uno');
    press(editor, 'Enter', { ctrlKey: true, altKey: true });
    expect(visible(editor)).not.toContain('Uno');
    expect(caretBlock(editor)).toBe('Escena 1');
    press(editor, 'Enter', { ctrlKey: true, altKey: true });
    expect(visible(editor)).toContain('Uno');
  });

  it('Enter al principio de un título colapsado deja un renglón arriba y el título sigue colapsado', () => {
    const { editor } = page(SCENES());
    collapse(editor, 'Escena 1');
    putCaret(editor, 'Escena 1', 'start');
    press(editor, 'Enter');
    expect(texts(editor).slice(0, 4)).toEqual(['Acto 1', 'Intro', '', 'Escena 1']);
    expect(visible(editor)).not.toContain('Uno');
    expect(caretBlock(editor)).toBe('Escena 1');
  });
});

describe('abrir desde afuera y colapsar todo', () => {
  it('"Ir al bloque" abre todos los títulos que lo esconden', () => {
    const { editor } = page(SCENES());
    collapse(editor, 'Detalle', 'Escena 1', 'Acto 1');
    expect(revealBlock(view(editor), idOf(editor, 'Detalle texto'))).toBe(true);
    expect(visible(editor)).toContain('Detalle texto');
    expect(revealBlock(view(editor), idOf(editor, 'Detalle texto'))).toBe(false);
  });

  it('colapsar todo y abrir todo', () => {
    const { editor } = page(SCENES());
    setAllCollapsed(view(editor), true);
    expect(visible(editor)).toEqual(['Acto 1', 'Acto 2']);
    setAllCollapsed(view(editor), false);
    expect(visible(editor)).toEqual(texts(editor));
  });

  it('pegar un título plegable de BlockNote lo deja como título común', () => {
    if (typeof ClipboardEvent === 'undefined') {
      vi.stubGlobal('ClipboardEvent', class extends Event {
        clipboardData = null;
      });
    }
    const { editor } = page([p('antes')]);
    putCaret(editor, 'antes');
    view(editor).pasteHTML('<details open><summary><h2>Plegable</h2></summary><p>adentro</p></details>');
    const pasted = editor.document.find((b) => b.type === 'heading');
    expect(pasted).toBeDefined();
    expect((pasted!.props as { isToggleable?: boolean }).isToggleable).toBe(false);
  });
});

// --- Auditoría de la entrega 1a: cada caso verificado, primero como prueba -------------------------------

/** Aplica una transacción como la despacha la vista y devuelve la raíz y lo que agregaron los plugins. */
function applyWithAppended(editor: BlockNoteEditor, tr: import('@tiptap/pm/state').Transaction) {
  const v = view(editor);
  const result = v.state.applyTransaction(tr);
  v.updateState(result.state);
  return result;
}

function idsIn(doc: import('@tiptap/pm/model').Node): Set<string> {
  const out = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name === 'blockContainer' && node.attrs.id) out.add(String(node.attrs.id));
    return true;
  });
  return out;
}

describe('auditoría 1a', () => {
  it('1. borrar un título colapsado con un colapsado adentro y un fin no borra lo que se ve después', async () => {
    const { editor } = page([p('P0'), h(1, 'A'), h(2, 'B'), p('P1'), h(1, 'C')]);
    collapse(editor, 'B');
    collapse(editor, 'A');
    putCaret(editor, 'A');
    press(editor, 'Enter');
    editor.insertInlineContent('X');
    press(editor, 'Enter');
    editor.insertInlineContent('P2');
    expect(visible(editor)).toEqual(['P0', 'A', 'X', 'P2', 'C']);
    const v = view(editor);
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, textPos(editor, 'A', 'start'), textPos(editor, 'X'))));
    press(editor, 'Backspace');
    // La selección empieza en el título (no arriba): no cruza la sección entera, así que no se borra nada y la
    // sección se abre (verificación de cbed5dc). Nunca se borró lo que se ve después.
    await settle();
    expect(texts(editor)).toEqual(['P0', 'A', 'B', 'P1', 'X', 'P2', 'C']);
    expect(visible(editor)).toEqual(['P0', 'A', 'B', 'P1', 'X', 'P2', 'C']);
  });

  it('1. lo mismo con Cortar: lo que se ve después queda', () => {
    const { editor } = page([p('P0'), h(1, 'A'), h(2, 'B'), p('P1'), h(1, 'C')]);
    collapse(editor, 'B');
    collapse(editor, 'A');
    putCaret(editor, 'A');
    press(editor, 'Enter');
    editor.insertInlineContent('X');
    press(editor, 'Enter');
    editor.insertInlineContent('P2');
    const v = view(editor);
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, textPos(editor, 'A', 'start'), textPos(editor, 'X'))));
    v.dom.dispatchEvent(clipboardEvent('cut'));
    expect(texts(editor)).toContain('P2');
  });

  it('1. invariante (al azar): lo que borra la pasada de colapsar estaba escondido por un título que la edición sacó', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
    for (let round = 0; round < 120; round++) {
      const blocks: PartialBlock[] = [];
      const n = 6 + Math.floor(rand() * 10);
      for (let i = 0; i < n; i++) {
        const kind = rand();
        const kids = rand() < 0.2 ? [p(`k${round}-${i}`)] : [];
        blocks.push(kind < 0.45 ? h(1 + Math.floor(rand() * 3), `h${round}-${i}`, kids) : p(`p${round}-${i}`, kids));
      }
      for (const e of editors.splice(0)) e.unmount();
      const { editor } = page(blocks);
      const heads = editor.document.filter((b) => b.type === 'heading').map((b) => b.id);
      setCollapsed(view(editor), heads.filter(() => rand() < 0.6), true);
      // A veces, un renglón después de un título colapsado (el fin).
      const collapsedNow = [...collapseState(editor.prosemirrorState)!.analysis.collapsed];
      let withEnd: string | null = null;
      if (collapsedNow.length && rand() < 0.6) {
        const id = pick(collapsedNow);
        if (!collapseState(editor.prosemirrorState)!.analysis.hidden.has(id)) {
          editor.setTextCursorPosition(id, 'end');
          press(editor, 'Enter');
          editor.insertInlineContent(`fin${round}`);
          press(editor, 'Enter');
          editor.insertInlineContent(`sigue${round}`);
          withEnd = id;
        }
      }
      const state = view(editor).state;
      const before = collapseState(state)!.analysis;
      const visibleIds = [...idsIn(state.doc)].filter((id) => !before.hidden.has(id));
      const tr = state.tr;
      const op = rand();
      if (withEnd && op < 0.35) {
        // Del principio del título colapsado al final de su renglón nuevo (el caso de la auditoría).
        const a = textPos(editor, textOfId(editor, withEnd), 'start');
        const b = textPos(editor, `fin${round}`);
        tr.setSelection(TextSelection.create(state.doc, a, b)).deleteSelection();
      } else if (op < 0.65) {
        // Una selección de texto entre dos bloques que se ven.
        const a = textPos(editor, textOfId(editor, pick(visibleIds)), rand() < 0.5 ? 'start' : 'end');
        const b = textPos(editor, textOfId(editor, pick(visibleIds)), rand() < 0.5 ? 'start' : 'end');
        if (a < 0 || b < 0 || a === b) continue;
        tr.setSelection(TextSelection.create(state.doc, Math.min(a, b), Math.max(a, b))).deleteSelection();
      } else {
        // Un bloque que se ve, entero.
        const id = pick(visibleIds);
        const at = findBlock(state.doc, id);
        if (!at) continue;
        tr.delete(at.pos, at.pos + at.node.nodeSize);
      }
      let result;
      try {
        result = applyWithAppended(editor, tr);
      } catch {
        continue; // Un borrado que ProseMirror no acepta (la página sin bloques): no es de colapsar.
      }
      const [root, ...appended] = result.transactions;
      if (appended.length === 0) continue;
      const afterRoot = idsIn(root.doc);
      const final = idsIn(result.state.doc);
      for (const id of afterRoot) {
        if (final.has(id)) continue;
        // Lo que sacó la pasada de colapsar: escondido antes, por un título que la edición sacó.
        expect(before.hidden.has(id), `ronda ${round}: ${textOfId(editor, id)} no estaba escondido`).toBe(true);
        expect(afterRoot.has(before.hidden.get(id)!), `ronda ${round}: su título sigue`).toBe(false);
      }
    }
  }, 60_000);

  it('2. cambiarle el id al título (UniqueID) no borra su sección y sigue colapsado', () => {
    const { editor } = page([p('antes'), h(2, 'T'), p('a'), p('b'), h(2, 'U')]);
    collapse(editor, 'T');
    const v = view(editor);
    const at = findBlock(v.state.doc, idOf(editor, 'T'))!;
    v.dispatch(v.state.tr.setNodeMarkup(at.pos, undefined, { ...at.node.attrs, id: 'renombrado' }));
    expect(texts(editor)).toEqual(['antes', 'T', 'a', 'b', 'U']);
    expect(visible(editor)).toEqual(['antes', 'T', 'U']);
  });

  it('3. abrir un título con fin no esconde el renglón nuevo debajo de uno colapsado de adentro', () => {
    const { editor } = page([h(1, 'A'), h(2, 'B'), p('P1'), h(1, 'C')]);
    collapse(editor, 'B');
    collapse(editor, 'A');
    putCaret(editor, 'A');
    press(editor, 'Enter');
    editor.insertInlineContent('X');
    setCollapsed(view(editor), [idOf(editor, 'A')], false);
    expect(visible(editor)).toEqual(['A', 'B', 'X', 'C']);
  });

  it('3. Ctrl/⌘+Alt+Enter en el renglón nuevo colapsa o abre el título que se ve, no uno escondido', () => {
    const { editor } = page([h(1, 'A'), h(2, 'B'), p('P1'), h(1, 'C')]);
    collapse(editor, 'B');
    collapse(editor, 'A');
    putCaret(editor, 'A');
    press(editor, 'Enter');
    editor.insertInlineContent('X');
    putCaret(editor, 'X');
    press(editor, 'Enter', { ctrlKey: true, altKey: true });
    expect(visible(editor)).toEqual(['A', 'B', 'X', 'C']);
  });

  it('4. deshacer y rehacer Enter después de un título colapsado deja el renglón a la vista', async () => {
    const { editor } = page([h(1, 'T'), p('a'), h(1, 'U')]);
    collapse(editor, 'T');
    await tick();
    undoPoint(editor);
    putCaret(editor, 'T');
    press(editor, 'Enter');
    await tick();
    undoPoint(editor);
    expect(visible(editor)).toEqual(['T', '', 'U']);
    editor.undo();
    await tick();
    expect(texts(editor)).toEqual(['T', 'a', 'U']);
    editor.redo();
    await tick();
    expect(texts(editor)).toEqual(['T', 'a', '', 'U']);
    expect(visible(editor)).toEqual(['T', '', 'U']);
  });

  it('5. escribir en el último renglón vacío después de una sección colapsada no la abre', () => {
    const { editor } = page([p('antes'), h(2, 'T'), p('a'), p('')]);
    collapse(editor, 'T');
    expect(visible(editor)).toEqual(['antes', 'T', '']);
    editor.setTextCursorPosition(editor.document[3].id, 'start');
    editor.insertInlineContent('hola');
    expect(visible(editor)).toEqual(['antes', 'T', 'hola']);
  });

  it('6. Retroceso en el renglón vacío después de un título colapsado lo borra y vuelve al título, sin abrir', () => {
    const { editor } = page([h(1, 'T'), p('a'), h(1, 'U')]);
    collapse(editor, 'T');
    putCaret(editor, 'T');
    press(editor, 'Enter');
    press(editor, 'Backspace');
    expect(texts(editor)).toEqual(['T', 'a', 'U']);
    expect(visible(editor)).toEqual(['T', 'U']);
    expect(caretBlock(editor)).toBe('T');
    expect(view(editor).state.selection.head).toBe(textPos(editor, 'T'));
  });

  it('6. Retroceso al principio de un renglón con texto después de lo escondido no lo une: va al título', () => {
    const { editor } = page([h(1, 'T', [p('hijo')]), h(1, 'U')]);
    collapse(editor, 'T');
    putCaret(editor, 'T');
    press(editor, 'Enter');
    editor.insertInlineContent('x');
    putCaret(editor, 'x', 'start');
    press(editor, 'Backspace');
    expect(texts(editor)).toEqual(['T', 'hijo', 'x', 'U']);
    expect(visible(editor)).toEqual(['T', 'x', 'U']);
    expect(caretBlock(editor)).toBe('T');
  });

  it('7. escribir en una página grande (2.000 bloques) con todo colapsado reusa lo calculado y es rápido', () => {
    const blocks: PartialBlock[] = [];
    for (let i = 0; i < 1000; i++) blocks.push(h(2, `T${i}`), p(`p${i}`));
    const { editor } = page(blocks);
    setAllCollapsed(view(editor), true);
    putCaret(editor, 'T0');
    // La vara se toma en la misma corrida: la misma página, sin nada colapsado.
    const { editor: open } = page(blocks);
    putCaret(open, 'T0');
    const before = collapseState(view(editor).state)!;
    const folded: number[] = [];
    const plain: number[] = [];
    const key = (target: BlockNoteEditor, times: number[]) => {
      const started = performance.now();
      target.insertInlineContent('x');
      times.push(performance.now() - started);
    };
    // Una tecla en cada página, alternando: lo que la máquina esté haciendo además les pega a las dos por igual.
    for (let i = 0; i < 40; i++) {
      key(open, plain);
      key(editor, folded);
    }
    const after = collapseState(view(editor).state)!;
    expect(after.analysis.hidden).toBe(before.analysis.hidden);
    expect(after.analysis.hidden.size).toBe(1000);
    // Lo que cuesta una tecla con todo colapsado contra lo que cuesta sin colapsar, por la mediana (una pausa suelta de
    // la máquina no la mueve; al promedio sí). Hoy es cerca del doble. Antes, con las decoraciones en los bloques
    // costaba 4 veces lo de hoy y rearmando todo más de 6: más de 7 y de 12 veces la página sin colapsar. Un tope en
    // milisegundos medía también a la máquina: con la suite entera corriendo, la misma tecla tardaba varias veces más.
    const median = (times: number[]) => [...times].sort((a, b) => a - b)[times.length >> 1];
    expect(median(folded)).toBeLessThan(4 * median(plain));
  });

  it('8. pegar algo no toca los títulos plegables que ya estaban', () => {
    const { editor } = page([{ type: 'heading', props: { level: 2, isToggleable: true }, content: 'Viejo' } as PartialBlock, p('antes')]);
    if (typeof ClipboardEvent === 'undefined') {
      vi.stubGlobal('ClipboardEvent', class extends Event {
        clipboardData = null;
      });
    }
    putCaret(editor, 'antes');
    view(editor).pasteHTML('<p>pegado</p>');
    expect((editor.document[0].props as { isToggleable?: boolean }).isToggleable).toBe(true);
  });

  it('9. una subida que termina en una foto escondida no abre la sección', () => {
    const { editor } = page([h(2, 'T'), { type: 'image', props: { url: '' } } as PartialBlock, h(2, 'U')]);
    collapse(editor, 'T');
    const image = editor.document[1].id;
    editor.updateBlock(image, { props: { url: 'sdmedia://1234' } as never });
    expect(collapseState(view(editor).state)!.analysis.hidden.has(image)).toBe(true);
  });

  it('10. copiar la sección entera deja la selección como estaba; el portapapeles lleva lo escondido', async () => {
    const { editor } = page(SCENES());
    collapse(editor, 'Escena 1');
    selectBlock(editor, 'Escena 1');
    const event = clipboardEvent('copy');
    view(editor).dom.dispatchEvent(event);
    const data = (event as unknown as { clipboardData: { getData: (k: string) => string } }).clipboardData;
    expect(data.getData('text/html')).toContain('Detalle texto');
    await tick();
    expect(view(editor).state.selection instanceof NodeSelection).toBe(true);
  });
});

function textOfId(editor: BlockNoteEditor, id: string): string {
  const b = editor.getBlock(id);
  return b && Array.isArray(b.content) ? b.content.map((c) => ('text' in c ? c.text : '')).join('') : '';
}

function findBlock(doc: import('@tiptap/pm/model').Node, id: string) {
  let found: { node: import('@tiptap/pm/model').Node; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === 'blockContainer' && node.attrs.id === id) {
      found = { node, pos };
      return false;
    }
    return true;
  });
  return found as { node: import('@tiptap/pm/model').Node; pos: number } | null;
}

describe('auditoría 1a: lo demás', () => {
  it('13. un reproductor de Drive que queda escondido se para (se vuelve a cargar); abierto, no', async () => {
    const link = 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view';
    const { editor } = page([
      h(2, 'T'),
      { type: 'paragraph', props: paragraphProps('driveCard') as never, content: [{ type: 'link', href: link, content: 'video' }] } as PartialBlock,
      h(2, 'U'),
    ]);
    await tick();
    const frame = editor.domElement!.querySelector<HTMLIFrameElement>('iframe.drive-card-player');
    expect(frame).not.toBeNull();
    const reloads = vi.fn();
    const observer = new MutationObserver((records) => {
      if (records.some((r) => r.attributeName === 'src')) reloads();
    });
    observer.observe(frame!, { attributes: true });
    collapse(editor, 'T');
    await tick();
    expect(reloads).toHaveBeenCalledTimes(1);
    // Seguir escondido (escribir en otro lado) no lo vuelve a cargar.
    putCaret(editor, 'U');
    editor.insertInlineContent('!');
    await tick();
    expect(reloads).toHaveBeenCalledTimes(1);
    observer.disconnect();
  });
});

// --- Verificación de 1258807: borrar la sección solo cuando la persona borró el título ---------------------

describe('verificación: borrar la sección solo a propósito', () => {
  it('a. Supr en un renglón vacío justo arriba de un título colapsado borra el renglón y deja el título colapsado', () => {
    const { editor } = page([p('P0'), p(''), h(1, 'T'), p('a'), p('b'), h(1, 'U')]);
    collapse(editor, 'T');
    editor.setTextCursorPosition(editor.document[1].id, 'start');
    press(editor, 'Delete');
    expect(texts(editor)).toEqual(['P0', 'T', 'a', 'b', 'U']);
    expect(visible(editor)).toEqual(['P0', 'T', 'U']);
    expect(view(editor).state.selection.head).toBe(textPos(editor, 'T', 'start'));
  });

  it('a. Supr al final de un renglón con texto justo arriba de un título colapsado no hace nada', () => {
    const { editor } = page([p('x'), h(1, 'T'), p('a'), h(1, 'U')]);
    collapse(editor, 'T');
    putCaret(editor, 'x');
    press(editor, 'Delete');
    expect(texts(editor)).toEqual(['x', 'T', 'a', 'U']);
    expect(visible(editor)).toEqual(['x', 'T', 'U']);
  });

  for (const parent of ['paragraph', 'bulletListItem']) {
    it(`b. Supr al final de un bloque (${parent}) cuyo primer hijo es un título colapsado no borra lo escondido`, () => {
      const { editor } = page([
        { type: parent, content: 'Q', children: [h(1, 'H', [p('kid')]), p('x')] } as PartialBlock,
        p('R'),
      ]);
      collapse(editor, 'H');
      putCaret(editor, 'Q');
      press(editor, 'Delete');
      expect(texts(editor)).toEqual(['Q', 'H', 'kid', 'x', 'R']);
    });
  }

  for (const op of ['Backspace', 'cut']) {
    it(`c. una selección que toma parte del texto del título (${op}) no borra lo escondido: se abre`, () => {
      const { editor } = page([p('Q', [p('P0')]), h(2, 'Head'), p('secret'), h(2, 'U')]);
      collapse(editor, 'Head');
      const v = view(editor);
      v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, textPos(editor, 'P0', 'start') + 1, textPos(editor, 'Head', 'start') + 2)));
      if (op === 'cut') v.dom.dispatchEvent(clipboardEvent('cut'));
      else press(editor, op);
      expect(texts(editor)).toContain('secret');
      expect(visible(editor)).toContain('secret');
    });
  }

  it('un removeBlocks sin intención (no desde el bloque elegido) no borra lo escondido: se abre', () => {
    const { editor } = page([p('antes'), h(1, 'T'), p('a'), h(1, 'U')]);
    collapse(editor, 'T');
    editor.removeBlocks([idOf(editor, 'T')]);
    expect(texts(editor)).toEqual(['antes', 'a', 'U']);
    expect(visible(editor)).toEqual(['antes', 'a', 'U']);
  });

  it('elegir todo el texto del título (y más, desde arriba) y borrarlo no borra su sección: se ve (verificación de cbed5dc, punto 3)', () => {
    const { editor } = page([p('antes'), h(1, 'T'), p('a'), h(1, 'U')]);
    collapse(editor, 'T');
    const v = view(editor);
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, textPos(editor, 'antes'), textPos(editor, 'T'))));
    press(editor, 'Backspace');
    expect(texts(editor)).toEqual(['antes', 'a', 'U']);
    expect(visible(editor)).toEqual(['antes', 'a', 'U']);
  });

  it('2. Retroceso después de un bloque cuyo último descendiente está escondido va al título, sin unir', () => {
    const { editor } = page([p('Q', [h(1, 'H'), p('x')]), p('R')]);
    collapse(editor, 'H');
    putCaret(editor, 'R', 'start');
    press(editor, 'Backspace');
    expect(texts(editor)).toEqual(['Q', 'H', 'x', 'R']);
    expect(visible(editor)).toEqual(['Q', 'H', 'R']);
    expect(caretBlock(editor)).toBe('H');
  });
});

// --- Retroceso al principio de un título: "sube la línea" (Lega, 2026-09-30) ---------------------------------

const types = (editor: BlockNoteEditor): string[] => {
  const out: string[] = [];
  const walk = (blocks: typeof editor.document) => {
    for (const b of blocks) {
      out.push(b.type);
      walk(b.children);
    }
  };
  walk(editor.document);
  return out;
};

describe('Retroceso al principio de un título', () => {
  it('une el título al renglón de arriba (no lo pasa a párrafo)', () => {
    const { editor } = page([p('Uno'), h(2, 'Dos'), p('Tres')]);
    putCaret(editor, 'Dos', 'start');
    press(editor, 'Backspace');
    expect(texts(editor)).toEqual(['UnoDos', 'Tres']);
    expect(types(editor)).toEqual(['paragraph', 'paragraph']);
    expect(view(editor).state.selection.head).toBe(textPos(editor, 'UnoDos', 'start') + 3);
  });

  it('se une al último descendiente del bloque de arriba', () => {
    const { editor } = page([p('Q', [p('kid')]), h(2, 'T')]);
    putCaret(editor, 'T', 'start');
    press(editor, 'Backspace');
    expect(texts(editor)).toEqual(['Q', 'kidT']);
  });

  it('con los hijos del título, como BlockNote con un párrafo', () => {
    const { editor } = page([p('Uno'), h(2, 'Dos', [p('hijo')])]);
    putCaret(editor, 'Dos', 'start');
    press(editor, 'Backspace');
    expect(texts(editor)).toEqual(['UnoDos', 'hijo']);
  });

  it('un título colapsado se une y lo que escondía se ve (nada se borra); un Ctrl+Z lo trae', async () => {
    const { editor } = page([p('Uno'), h(2, 'T'), p('a'), p('b'), h(2, 'U')]);
    await tick();
    collapse(editor, 'T');
    undoPoint(editor);
    putCaret(editor, 'T', 'start');
    press(editor, 'Backspace');
    expect(texts(editor)).toEqual(['UnoT', 'a', 'b', 'U']);
    expect(visible(editor)).toEqual(['UnoT', 'a', 'b', 'U']);
    await tick();
    editor.undo();
    await tick();
    expect(texts(editor)).toEqual(['Uno', 'T', 'a', 'b', 'U']);
    expect(types(editor)[1]).toBe('heading');
  });

  it('en el primer bloque de la página no hace nada', () => {
    const { editor } = page([h(1, 'Primero'), p('x')]);
    putCaret(editor, 'Primero', 'start');
    press(editor, 'Backspace');
    expect(texts(editor)).toEqual(['Primero', 'x']);
    expect(types(editor)).toEqual(['heading', 'paragraph']);
  });

  it('después de un renglón vacío, se borra el renglón y el título queda (como BlockNote con un párrafo)', () => {
    const { editor } = page([p('antes'), p(''), h(2, 'T')]);
    editor.setTextCursorPosition(editor.document[2].id, 'start');
    press(editor, 'Backspace');
    expect(texts(editor)).toEqual(['antes', 'T']);
    expect(types(editor)).toEqual(['paragraph', 'heading']);
  });

  it('después de una foto, se borra la foto y el título queda (como BlockNote con un párrafo)', () => {
    const { editor } = page([p('antes'), { type: 'image', props: { url: 'https://example.com/a.jpg' } } as PartialBlock, h(2, 'T')]);
    editor.setTextCursorPosition(editor.document[2].id, 'start');
    press(editor, 'Backspace');
    expect(types(editor)).toEqual(['paragraph', 'heading']);
    expect(texts(editor)).toEqual(['antes', 'T']);
  });

  it('un título vacío se borra y la selección va al final del renglón de arriba', () => {
    const { editor } = page([p('antes'), h(2, ''), p('x')]);
    editor.setTextCursorPosition(editor.document[1].id, 'start');
    press(editor, 'Backspace');
    expect(texts(editor)).toEqual(['antes', 'x']);
    expect(caretBlock(editor)).toBe('antes');
  });

  it('un título anidado sale un nivel, como un párrafo', () => {
    const { editor } = page([p('Q', [h(2, 'N')])]);
    putCaret(editor, 'N', 'start');
    press(editor, 'Backspace');
    expect(editor.document.map((b) => b.type)).toEqual(['paragraph', 'heading']);
    expect(texts(editor)).toEqual(['Q', 'N']);
  });

  it('justo después de una sección colapsada se une al título que se ve; lo escondido no se borra', () => {
    const { editor } = page([h(2, 'A'), p('escondido'), h(2, 'B'), p('b'), h(2, 'C')]);
    collapse(editor, 'A');
    putCaret(editor, 'B', 'start');
    press(editor, 'Backspace');
    expect(texts(editor)).toEqual(['AB', 'escondido', 'b', 'C']);
    // Lo que era de B pasa a la sección de A y se veía: A se abre.
    expect(visible(editor)).toEqual(['AB', 'escondido', 'b', 'C']);
  });
});

// --- Verificación de cbed5dc: lo escondido se borra solo a propósito ----------------------------------------
// (A) a propósito: el título elegido entero (clic en los puntos) (o la sección, o varios bloques) y borrar, cortar, pegar o
// escribir encima; Ctrl+A. (B) una selección de texto que cruza la sección entera: empieza antes del título (en
// un bloque de arriba) y termina en un bloque después de lo escondido. Cualquier otra cosa que borraría algo
// escondido no hace nada: se abre la sección.

const clipOf = (event: Event, type = 'text/html') =>
  (event as unknown as { clipboardData: { getData: (k: string) => string } }).clipboardData.getData(type);

function selectText(editor: BlockNoteEditor, anchor: number, head: number) {
  const v = view(editor);
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, anchor, head)));
}

/** Lo que hace la persona con la selección: teclas, cortar (devuelve el evento), escribir o pegar. */
function act(editor: BlockNoteEditor, op: string): Event | null {
  const v = view(editor);
  if (op === 'cut') {
    const event = clipboardEvent('cut');
    v.dom.dispatchEvent(event);
    return event;
  }
  if (op === 'type') {
    const text = 'Q';
    const deflt = () => v.state.tr.insertText(text);
    if (!v.someProp('handleTextInput', (f) => f(v, v.state.selection.from, v.state.selection.to, text, deflt))) v.dispatch(deflt());
  } else if (op === 'paste') v.pasteText('PEGADO');
  else press(editor, op);
  return null;
}

const SECTION = () => [p('Before'), h(1, 'Heading'), p('x1'), p('x2'), h(1, 'Zeta')];

describe('verificación de cbed5dc: lo escondido se borra solo a propósito', () => {
  for (const op of ['Backspace', 'Delete', 'cut', 'type', 'paste']) {
    it(`3. del final del renglón de arriba al final del texto del título + ${op}: lo escondido queda y se ve`, async () => {
      const { editor } = page(SECTION());
      collapse(editor, 'Heading');
      selectText(editor, textPos(editor, 'Before'), textPos(editor, 'Heading'));
      act(editor, op);
      await settle();
      expect(texts(editor)).toEqual(expect.arrayContaining(['x1', 'x2', 'Zeta']));
      expect(visible(editor)).toEqual(expect.arrayContaining(['x1', 'x2']));
    });
  }

  const pastes: [string, (e: BlockNoteEditor) => void][] = [
    ['dos párrafos', (e) => view(e).pasteHTML('<p>a</p><p>b</p>')],
    ['una lista', (e) => view(e).pasteHTML('<ul><li>a</li><li>b</li></ul>')],
    ['un título', (e) => view(e).pasteHTML('<h2>Nuevo</h2>')],
    ['texto de dos renglones', (e) => view(e).pasteText('Uno\n\nDos')],
  ];
  for (const [name, paste] of pastes) {
    it(`2. el texto exacto del título (triple clic) y pegar ${name}: la sección no se borra`, async () => {
      const { editor } = page(SECTION());
      collapse(editor, 'Heading');
      selectText(editor, textPos(editor, 'Heading', 'start'), textPos(editor, 'Heading'));
      paste(editor);
      await settle();
      expect(texts(editor)).toEqual(expect.arrayContaining(['Before', 'x1', 'x2', 'Zeta']));
    });
  }

  for (const key of ['ArrowRight', 'ArrowDown']) {
    for (const op of ['Backspace', 'Delete', 'type', 'paste', 'cut']) {
      it(`4. Shift+${key} al final de un título colapsado y ${op}: no se borra nada y la sección se abre`, async () => {
        const { editor } = page(SECTION());
        collapse(editor, 'Heading');
        putCaret(editor, 'Heading');
        press(editor, key, { shiftKey: true });
        expect(view(editor).state.selection.to).toBeGreaterThan(textPos(editor, 'x2'));
        const before = texts(editor);
        const event = act(editor, op);
        await settle();
        expect(texts(editor)).toEqual(before);
        expect(visible(editor)).toEqual(['Before', 'Heading', 'x1', 'x2', 'Zeta']);
        // Cortar tampoco lleva nada: la tecla no hizo nada.
        if (event) expect(clipOf(event)).toBe('');
      });
    }
  }

  it('4. Shift+→ desde un título vacío arriba de todo hasta el renglón vacío del final no es Ctrl+A', async () => {
    const { editor } = page([h(1, ''), p('x1'), p('x2'), p('')]);
    setCollapsed(view(editor), [editor.document[0].id], true);
    editor.setTextCursorPosition(editor.document[0].id, 'end');
    press(editor, 'ArrowRight', { shiftKey: true });
    press(editor, 'Backspace');
    await settle();
    expect(texts(editor)).toEqual(['', 'x1', 'x2', '']);
    expect(visible(editor)).toEqual(['', 'x1', 'x2', '']);
  });

  it('4. de la mitad del título a la mitad del de abajo + Retroceso: no se borra nada y la sección se abre', async () => {
    const { editor } = page(SECTION());
    collapse(editor, 'Heading');
    selectText(editor, textPos(editor, 'Heading', 'start') + 3, textPos(editor, 'Zeta', 'start') + 2);
    press(editor, 'Backspace');
    await settle();
    expect(texts(editor)).toEqual(['Before', 'Heading', 'x1', 'x2', 'Zeta']);
    expect(visible(editor)).toEqual(['Before', 'Heading', 'x1', 'x2', 'Zeta']);
  });

  for (const op of ['Backspace', 'Delete', 'type', 'paste', 'cut']) {
    it(`B. una selección que empieza arriba del título y termina después de la sección + ${op}: se borra lo escondido, con el aviso`, async () => {
      const seen = notices();
      const { editor } = page(SECTION());
      collapse(editor, 'Heading');
      selectText(editor, textPos(editor, 'Before', 'start') + 3, textPos(editor, 'Zeta', 'start') + 2);
      const event = act(editor, op);
      await settle();
      const rest = { Backspace: 'Befta', Delete: 'Befta', type: 'BefQta', paste: 'BefPEGADOta', cut: 'Befta' }[op];
      expect(texts(editor)).toEqual([rest]);
      expect(seen).toHaveLength(1);
      // Lo que se corta es lo que se borra: el portapapeles lleva lo escondido.
      if (event) {
        const html = clipOf(event);
        expect(html).toContain('x1');
        expect(html).toContain('x2');
        expect(html).toContain('Heading');
      }
    });
  }

  it('1. todo elegido (AllSelection) y cortar, con la página terminando en una sección colapsada: el portapapeles lleva todo', async () => {
    const { editor } = page([p('Before'), h(1, 'Heading'), p('x1'), h(1, 'Z'), p('z1')]);
    collapse(editor, 'Heading', 'Z');
    const v = view(editor);
    v.dispatch(v.state.tr.setSelection(new AllSelection(v.state.doc)));
    expect(v.state.selection).toBeInstanceOf(AllSelection);
    const event = act(editor, 'cut')!;
    await settle();
    expect(clipOf(event)).toContain('x1');
    expect(clipOf(event)).toContain('z1');
    expect(texts(editor)).toEqual(['']);
  });

  // Ctrl+A en el navegador: BlockNote no tiene el atajo; el navegador elige todo y ProseMirror lo toma como texto.
  it('1. una selección de texto de toda la página (Ctrl+A) no se achica al final de lo escondido, y cortar lleva todo', async () => {
    const { editor } = page([p('Before'), h(1, 'Heading'), p('x1'), h(1, 'Z'), p('z1')]);
    collapse(editor, 'Heading', 'Z');
    // En jsdom no hay nada que elija todo: se aprieta la tecla y se pone la selección como la pondría el navegador.
    press(editor, 'a', { ctrlKey: true });
    selectText(editor, textPos(editor, 'Before', 'start'), textPos(editor, 'z1'));
    expect(view(editor).state.selection.head).toBe(textPos(editor, 'z1'));
    const event = act(editor, 'cut')!;
    await settle();
    expect(clipOf(event)).toContain('x1');
    expect(clipOf(event)).toContain('z1');
    expect(texts(editor)).toEqual(['']);
  });

  it('A. el título elegido entero y pegar o escribir encima se lleva la sección', async () => {
    for (const op of ['type', 'paste']) {
      const { editor } = page(SECTION());
      collapse(editor, 'Heading');
      selectBlock(editor, 'Heading');
      act(editor, op);
      await settle();
      expect(texts(editor)).not.toContain('x1');
      expect(texts(editor)).not.toContain('x2');
      expect(texts(editor)).toEqual(expect.arrayContaining(['Before', 'Zeta']));
    }
  });

  it('5. arrastrar un título colapsado lejos deja lo que escondía bajo otro título colapsado: se ve', async () => {
    const { editor } = page([h(1, 'W'), p('w1'), h(1, 'X'), p('x1'), p('x2'), h(1, 'T'), p('t1'), h(1, 'U'), p('u1')]);
    collapse(editor, 'X', 'W');
    const v = view(editor);
    v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, textPos(editor, 'X', 'start') - 2)));
    const node = (v.state.selection as NodeSelection).node;
    const tr = v.state.tr;
    const insertAt = textPos(editor, 'U', 'start') - 2;
    tr.deleteSelection();
    const pos = tr.mapping.map(insertAt);
    tr.replaceRangeWith(pos, pos, node);
    tr.setSelection(NodeSelection.create(tr.doc, pos));
    v.dispatch(tr.setMeta('uiEvent', 'drop'));
    await settle();
    expect(texts(editor)).toEqual(['W', 'w1', 'x1', 'x2', 'T', 't1', 'X', 'U', 'u1']);
    expect(visible(editor)).toEqual(expect.arrayContaining(['x1', 'x2']));
  });

  it('5. Shift+Ctrl+↑ en un título colapsado: (desde la 1b) sube con su sección y salta la de arriba entera', async () => {
    const { editor } = page([h(1, 'W'), p('w1'), h(1, 'X'), p('x1'), h(1, 'T'), p('t1')]);
    collapse(editor, 'X', 'W');
    putCaret(editor, 'X');
    press(editor, 'ArrowUp', { shiftKey: true, ctrlKey: true });
    await settle();
    expect(texts(editor)).toEqual(['X', 'x1', 'W', 'w1', 'T', 't1']);
    expect(visible(editor)).toEqual(['X', 'W', 'T', 't1']);
  });

  it('6. Enter en una página grande con todo colapsado no rearma todas las decoraciones', () => {
    const blocks: PartialBlock[] = [];
    for (let i = 0; i < 2000; i++) blocks.push(h(2, `T${i}`), p(`p${i}`));
    blocks.push(p('fin'));
    const { editor } = page(blocks);
    setAllCollapsed(view(editor), true);
    const create = vi.spyOn(DecorationSet, 'create');
    for (let i = 0; i < 6; i++) {
      putCaret(editor, `T${10 + i * 7}`);
      press(editor, 'Enter');
    }
    // Las de colapsar (miles); otros plugins arman las suyas, chicas.
    const calls = create.mock.calls.filter((c) => (c[1] as unknown[]).length > 100).length;
    create.mockRestore();
    expect(calls).toBe(0);
    expect(collapseState(view(editor).state)!.analysis.hidden.size).toBe(2001);
    // 4.000 bloques: unos 37 ms por Enter en jsdom (antes, 83 a 108). Lo que queda es de ProseMirror al dibujar
    // miles de decoraciones (sin colapsar, unos 15). No se mide acá: con otras pruebas a la vez, varía mucho.
  }, 30_000);
});

// --- Verificación de a2390e6 + fbaef68 -----------------------------------------------------------------------

/** El árbol de la página: tipo, texto e hijos (el tipo del bloque con el texto `normal`, como 'T'). */
function tree(editor: BlockNoteEditor, normal: string): unknown[] {
  const walk = (blocks: typeof editor.document): unknown[] =>
    blocks.map((b) => {
      const text = Array.isArray(b.content) ? b.content.map((c) => ('text' in c ? c.text : '')).join('') : '';
      const type = text === normal && (b.type === 'heading' || b.type === 'paragraph') ? 'T' : b.type;
      return b.children.length ? [type, text, walk(b.children)] : [type, text];
    });
  return walk(editor.document);
}

function plainEditor(blocks: PartialBlock[]): BlockNoteEditor {
  const editor = BlockNoteEditor.create({ schema }) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  editor.mount(el);
  editors.push(editor);
  editor.replaceBlocks(editor.document, blocks as never);
  return editor;
}

/** Escribe como el teclado (pasa por las reglas de "## " y compañía). */
function typeText(editor: BlockNoteEditor, text: string) {
  const v = view(editor);
  for (const ch of text) {
    const { from, to } = v.state.selection;
    if (!v.someProp('handleTextInput', (f) => f(v, from, to, ch, () => v.state.tr.insertText(ch, from, to)))) v.dispatch(v.state.tr.insertText(ch, from, to));
  }
}

describe('verificación de a2390e6 + fbaef68', () => {
  it('B1. una edición que no se hace deja la selección vacía (así la composición del teclado no sigue encima)', async () => {
    const { editor } = page(SECTION());
    collapse(editor, 'Heading');
    putCaret(editor, 'Heading');
    press(editor, 'ArrowRight', { shiftKey: true });
    press(editor, 'Backspace');
    await settle();
    expect(texts(editor)).toEqual(['Before', 'Heading', 'x1', 'x2', 'Zeta']);
    expect(visible(editor)).toEqual(['Before', 'Heading', 'x1', 'x2', 'Zeta']);
    expect(view(editor).state.selection.empty).toBe(true);
  });

  it('B1. empezar a componer (tecla muerta) sobre una selección que borraría lo escondido: se abre y la selección queda vacía antes', () => {
    const { editor } = page(SECTION());
    collapse(editor, 'Heading');
    putCaret(editor, 'Heading');
    press(editor, 'ArrowRight', { shiftKey: true });
    const v = view(editor);
    v.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
    expect(visible(editor)).toEqual(['Before', 'Heading', 'x1', 'x2', 'Zeta']);
    expect(v.state.selection.empty).toBe(true);
    v.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }));
  });

  it('B1. después de una edición que no se hizo, lo que llega de la composición y borraría lo recién abierto tampoco se hace', async () => {
    const { editor } = page(SECTION());
    collapse(editor, 'Heading');
    putCaret(editor, 'Heading');
    press(editor, 'ArrowRight', { shiftKey: true });
    const from = view(editor).state.selection.from;
    const to = view(editor).state.selection.to;
    press(editor, 'Backspace');
    await settle();
    const v = view(editor);
    // Lo que ProseMirror arma al leer la pantalla en medio de una composición: la selección vieja por el texto.
    v.dispatch(v.state.tr.replaceWith(from, to, v.state.schema.text('é')).setMeta('composition', 1));
    expect(texts(editor)).toEqual(['Before', 'Heading', 'x1', 'x2', 'Zeta']);
    // Una edición común (a la vista, sin componer) sí se hace.
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, from, to)));
    press(editor, 'Backspace');
    expect(texts(editor)).toEqual(['Before', 'HeadingZeta']);
  });

  it('I1. Retroceso en un título con hijos unido a un renglón más adentro: los hijos quedan como con un párrafo', () => {
    const { editor } = page([p('A', [p('a1')]), h(2, 'H', [p('k')]), p('Z')]);
    putCaret(editor, 'H', 'start');
    press(editor, 'Backspace');
    expect(tree(editor, '')).toEqual([['paragraph', 'A', [['paragraph', 'a1H']]], ['paragraph', 'k'], ['paragraph', 'Z']]);
  });

  it('I1/M1. al azar: Retroceso al principio de un título hace lo mismo que BlockNote con un párrafo', () => {
    let seed = 11;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const differ: string[] = [];
    for (let round = 0; round < 120; round++) {
      let n = 0;
      const texts: string[] = [];
      const gen = (depth: number, heading: number | null): PartialBlock[] => {
        const out: PartialBlock[] = [];
        const count = depth === 0 ? 3 + Math.floor(rand() * 4) : 1 + Math.floor(rand() * 2);
        for (let i = 0; i < count; i++) {
          const text = rand() < 0.12 ? '' : `t${n}`;
          const me = n++;
          texts.push(text);
          const kids = depth < 2 && rand() < 0.35 ? gen(depth + 1, heading) : [];
          const r = rand();
          const asHeading = me === heading || (r < 0.2 && text !== '');
          out.push((asHeading ? h(me === heading ? 2 : 3, text, kids) : p(text, kids)) as PartialBlock);
        }
        return out;
      };
      // Primero, cuántos bloques hay; después el mismo árbol (la misma semilla) con el elegido como título (acá) y
      // como párrafo (BlockNote solo).
      const saved = seed;
      gen(0, null);
      const target = 1 + Math.floor(rand() * (n - 1));
      const after = seed;
      seed = saved;
      n = 0;
      texts.length = 0;
      const withHeading = gen(0, target);
      const targetText = texts[target];
      seed = after;
      const setType = (blocks: PartialBlock[], idx: { n: number }) => {
        for (const b of blocks) {
          if (idx.n === target) Object.assign(b, { type: 'paragraph', props: {} });
          idx.n++;
          setType((b.children ?? []) as PartialBlock[], idx);
        }
      };
      const plainBlocks = JSON.parse(JSON.stringify(withHeading)) as PartialBlock[];
      setType(plainBlocks, { n: 0 });
      const ours = page(withHeading).editor;
      const theirs = plainEditor(plainBlocks);
      const caret = (e: BlockNoteEditor) => {
        let id = '';
        let k = 0;
        const walk = (bs: typeof e.document) => bs.forEach((b) => ((k++ === target ? (id = b.id) : null), walk(b.children)));
        walk(e.document);
        e.setTextCursorPosition(id, 'start');
      };
      caret(ours);
      caret(theirs);
      press(ours, 'Backspace');
      press(theirs, 'Backspace');
      const a = JSON.stringify(tree(ours, targetText));
      const b = JSON.stringify(tree(theirs, targetText));
      if (a !== b) differ.push(`round ${round} target ${target} "${targetText}"\n  ours:   ${a}\n  theirs: ${b}`);
      ours.unmount();
      theirs.unmount();
      editors.splice(editors.indexOf(ours), 1);
      editors.splice(editors.indexOf(theirs), 1);
    }
    expect(differ).toEqual([]);
  }, 120_000);

  // La regla se deshace como en BlockNote solo (en jsdom deja un espacio de más: pasa igual sin esta extensión).
  for (const [name, start, typed] of [
    ['justo después de "## " (vuelve "## ")', '', '## '],
    ['después de "# " al principio de "Hola"', 'Hola', '# '],
  ] as const) {
    it(`I2. Retroceso ${name} deshace la regla, como BlockNote`, () => {
      const run = (editor: BlockNoteEditor) => {
        editor.setTextCursorPosition(editor.document[0].id, 'start');
        typeText(editor, typed);
        expect(editor.document[0].type).toBe('heading');
        press(editor, 'Backspace');
        return JSON.stringify(editor.document.map((b) => [b.type, b.content]));
      };
      const ours = run(page([p(start)]).editor);
      const theirs = run(plainEditor([p(start)]));
      expect(ours).toContain('paragraph');
      expect(ours).toBe(theirs);
    });
  }

  it('M1. un título anidado que no es el primer hijo sale un nivel, como un párrafo', () => {
    const { editor } = page([p('Q', [p('a'), h(2, 'N')])]);
    putCaret(editor, 'N', 'start');
    press(editor, 'Backspace');
    expect(tree(editor, 'N')).toEqual([['paragraph', 'Q', [['paragraph', 'a']]], ['T', 'N']]);
  });

  it('M2. Shift+→ desde un título vacío arriba de todo, un cambio de otro y Retroceso: no borra la página', async () => {
    const { editor, doc } = page([h(1, ''), p('x1'), p('x2'), p('')]);
    await tick();
    const other = linked(doc);
    await tick();
    setCollapsed(view(editor), [editor.document[0].id], true);
    editor.setTextCursorPosition(editor.document[0].id, 'end');
    press(editor, 'ArrowRight', { shiftKey: true });
    other.editor.updateBlock(idOf(other.editor, 'x2'), { content: 'x2 de otro' });
    other.sync();
    await tick();
    press(editor, 'Backspace');
    await settle();
    expect(texts(editor)).toEqual(['', 'x1', 'x2 de otro', '']);
  });

  it('M3. elegir con el mouse del principio de la página al final (sin Ctrl+A) no cuenta como Ctrl+A', async () => {
    const { editor } = page([h(1, 'Heading'), p('x1'), h(1, 'Z'), p('z1')]);
    collapse(editor, 'Heading', 'Z');
    selectText(editor, textPos(editor, 'Heading', 'start'), textPos(editor, 'z1'));
    press(editor, 'Backspace');
    await settle();
    expect(texts(editor)).toEqual(['Heading', 'x1', 'Z', 'z1']);
    expect(visible(editor)).toContain('x1');
  });

  it('M5. Retroceso al principio de un título sube la línea también sin colapsar (un navegador sin :has())', () => {
    const editor = BlockNoteEditor.create(
      withCollaboration({
        schema,
        collaboration: { fragment: new Y.Doc().getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
        extensions: [headingBackspaceExtension],
      }),
    ) as unknown as BlockNoteEditor;
    const el = document.createElement('div');
    document.body.appendChild(el);
    editor.mount(el);
    editors.push(editor);
    editor.replaceBlocks(editor.document, [p('Uno'), h(2, 'Dos')] as never);
    putCaret(editor, 'Dos', 'start');
    press(editor, 'Backspace');
    expect(texts(editor)).toEqual(['UnoDos']);
  });
});

// --- Verificación de 6f47844 ----------------------------------------------------------------------------------

describe('verificación de 6f47844', () => {
  it('1. un beforeinput que no se puede cancelar (Android) y se rechaza queda manejado: ProseMirror no manda su Retroceso', () => {
    const { editor } = page(SECTION());
    collapse(editor, 'Heading');
    putCaret(editor, 'Heading');
    press(editor, 'ArrowRight', { shiftKey: true });
    const v = view(editor);
    const event = new InputEvent('beforeinput', { bubbles: true, cancelable: false, inputType: 'deleteContentBackward' });
    const handler = (collapseKey.get(v.state)!.props.handleDOMEvents as Record<string, (view: unknown, e: Event) => boolean>).beforeinput;
    expect(handler(v, event)).toBe(true);
    expect(texts(editor)).toEqual(['Before', 'Heading', 'x1', 'x2', 'Zeta']);
    expect(visible(editor)).toEqual(['Before', 'Heading', 'x1', 'x2', 'Zeta']);
    expect(v.state.selection.empty).toBe(true);
  });

  it('2. Ctrl+A según la plataforma: en la Mac solo ⌘ (Ctrl+A no), en las demás solo Ctrl; en otro alfabeto, la tecla A', () => {
    const k = (key: string, mods: Partial<KeyboardEventInit>, code = 'KeyA') => new KeyboardEvent('keydown', { key, code, ...mods });
    expect(isSelectAllKey(k('a', { metaKey: true }), true)).toBe(true);
    expect(isSelectAllKey(k('a', { ctrlKey: true }), true)).toBe(false);
    expect(isSelectAllKey(k('a', { ctrlKey: true }), false)).toBe(true);
    expect(isSelectAllKey(k('a', { metaKey: true }), false)).toBe(false);
    expect(isSelectAllKey(k('ф', { ctrlKey: true }), false)).toBe(true);
    expect(isSelectAllKey(k('a', { ctrlKey: true, shiftKey: true }), false)).toBe(false);
    expect(isSelectAllKey(k('q', { ctrlKey: true }, 'KeyA'), false)).toBe(false);
  });

  it('2. ⌘+A fuera de la Mac (o Ctrl+A en la Mac) no es elegir todo: cortar no se lleva lo escondido del final', async () => {
    const { editor } = page([p('Before'), h(1, 'Heading'), p('x1'), h(1, 'Z'), p('z1')]);
    collapse(editor, 'Heading', 'Z');
    press(editor, 'a', { metaKey: true });
    selectText(editor, textPos(editor, 'Before', 'start'), textPos(editor, 'z1'));
    // No es Ctrl+A: la selección se achica al final del título Z. Lo de Heading se borra (la selección cruza su
    // sección entera, B); lo escondido del final queda.
    press(editor, 'Backspace');
    await settle();
    expect(texts(editor)).toContain('z1');
  });

  it('3. Ctrl+A y un texto que no pasa por el teclado (dictado, emojis) reemplaza todo, también lo escondido del final', () => {
    const { editor } = page([p('Before'), h(1, 'Heading'), p('x1'), h(1, 'Z'), p('z1')]);
    collapse(editor, 'Heading', 'Z');
    press(editor, 'a', { ctrlKey: true });
    selectText(editor, textPos(editor, 'Before', 'start'), textPos(editor, 'z1'));
    const event = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: '😀' });
    view(editor).dom.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(texts(editor)).toEqual(['😀']);
  });
});
