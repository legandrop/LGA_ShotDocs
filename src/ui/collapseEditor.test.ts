// @vitest-environment jsdom
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { yUndoPluginKey } from 'y-prosemirror';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import type { HeadingRecord } from './collapse';
import { collapseExtension, collapseState, revealBlock, setAllCollapsed, setCollapsed } from './collapseEditor';
import { hiderInDom } from './collapseDom';
import { schema } from './editorSchema';
import { FIND_REPLACE_META } from './editorMeta';

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
      extensions: [collapseExtension({ initial, save: (r: Saved) => saves.push(r) })],
    }),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  editor.mount(el);
  editors.push(editor);
  return { editor, doc, saves };
}

const tick = () => new Promise((r) => setTimeout(r, 30));
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
    expect(dom.querySelectorAll('.bn-block-outer.sd-collapsed')).toHaveLength(1);
    const hidden = [...dom.querySelectorAll<HTMLElement>('.bn-block-outer.sd-collapsed-hidden')];
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

  it('Retroceso en el título que sigue a una sección colapsada: pasa a párrafo y la sección se abre', () => {
    const { editor } = page(SCENES());
    collapse(editor, 'Escena 1');
    putCaret(editor, 'Escena 2', 'start');
    press(editor, 'Backspace');
    expect(visible(editor)).toContain('Escena 2');
    expect(visible(editor)).toContain('Uno');
    expect(caretBlock(editor)).toBe('Escena 2');
  });

  it('pasar un título colapsado a un nivel mayor no esconde de golpe las secciones de al lado', () => {
    const { editor } = page(SCENES());
    collapse(editor, 'Escena 1');
    editor.updateBlock(idOf(editor, 'Escena 1'), { props: { level: 1 } as never });
    expect(visible(editor)).toContain('Escena 2');
    expect(visible(editor)).toContain('Dos');
  });

  it('Retroceso al principio de un título colapsado vacío lo pasa a párrafo y lo escondido se ve; no se borra nada', () => {
    const { editor } = page([p('antes'), h(2, ''), p('a'), p('b'), h(2, 'Otra')]);
    const empty = editor.document[1].id;
    setCollapsed(view(editor), [empty], true);
    editor.setTextCursorPosition(empty, 'start');
    press(editor, 'Backspace');
    expect(texts(editor)).toEqual(['antes', '', 'a', 'b', 'Otra']);
    expect(visible(editor)).toEqual(['antes', '', 'a', 'b', 'Otra']);
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
  it('"Borrar" (removeBlocks): el título, lo escondido, los hijos y las secciones colapsadas de adentro; un aviso; deshacer trae todo', async () => {
    const seen = notices();
    const { editor } = page([p('antes'), h(1, 'Acto', [p('hijo')]), p('a'), h(2, 'Sub'), p('b'), h(1, 'Otro'), p('c')]);
    await tick();
    const ids = texts(editor).map((t) => (t ? idOf(editor, t) : ''));
    collapse(editor, 'Sub', 'Acto');
    undoPoint(editor);
    editor.removeBlocks([idOf(editor, 'Acto')]);
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
    editor.removeBlocks([idOf(editor, 'Último')]);
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

  it('juntar el título con el bloque de arriba no es borrarlo: lo escondido queda', () => {
    const { editor } = page([p('antes'), h(2, 'T'), p('a'), h(2, 'U')]);
    collapse(editor, 'T');
    const v = view(editor);
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, textPos(editor, 'antes'), textPos(editor, 'T'))));
    press(editor, 'Backspace');
    expect(texts(editor)).toEqual(['antes', 'a', 'U']);
    expect(visible(editor)).toEqual(['antes', 'a', 'U']);
  });

  it('si otro edita adentro mientras tanto, no se rompe nada y su bloque nuevo queda a la vista', async () => {
    const { editor, doc } = page(SCENES());
    await tick();
    const other = linked(doc);
    await tick();
    collapse(editor, 'Escena 1');
    editor.removeBlocks([idOf(editor, 'Escena 1')]);
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
    view(editor).dom.dispatchEvent(clipboardEvent('cut'));
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
