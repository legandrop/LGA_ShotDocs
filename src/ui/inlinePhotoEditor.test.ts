// @vitest-environment jsdom
import { BlockNoteEditor, selectedFragmentToHTML, type PartialBlock } from '@blocknote/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { collectCarrete, photoKeyOf, type BlockLike } from './carreteModel';
import { collapseExtension, setCollapsed } from './collapseEditor';
import { editorSchemaOptions, SCRIPT_PROP } from './editorSchema';
import { computeMatches } from './findEditor';
import { PHOTO } from './inlinePhoto';
import {
  decorateRows,
  handlePhotoShiftClick,
  inlinePhotoExtensions,
  IN_RANGE_CLASS,
  photoDragHead,
  photoKeyAtPos,
  rowsOfTextblock,
  selectedPhotoKey,
} from './inlinePhotoEditor';

// La foto en línea en el editor (Docs/Doc_Fotos_En_Linea.md, entrega 1b): las filas, la marca de las fotos de una
// selección de texto, el teclado y el mouse con una foto elegida, qué foto es (bloque más lugar), y que buscar,
// colapsar y copiar dentro de la app sigan andando. Lo que jsdom no ve (el cursor dibujado, la composición real,
// los anchos) se midió en un navegador real (fuera del repo).

const editors: BlockNoteEditor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
  document.body.replaceChildren();
});

type Resolve = (url: string) => Promise<string>;

function mount(blocks: PartialBlock[], options: { resolveFileUrl?: Resolve; collapse?: boolean } = {}): BlockNoteEditor {
  const editor = BlockNoteEditor.create({
    ...editorSchemaOptions,
    resolveFileUrl: options.resolveFileUrl,
    extensions: [...inlinePhotoExtensions, ...(options.collapse ? [collapseExtension({})] : [])],
  }) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.append(el);
  editor.mount(el);
  editors.push(editor);
  editor.replaceBlocks(editor.document, blocks as never);
  return editor;
}

const view = (e: BlockNoteEditor) => e.prosemirrorView!;
const ph = (name: string, w = 0, url = `https://example.invalid/${name}.jpg`) => ({ type: 'photo', props: { url, name, w } });
const p = (id: string, ...content: unknown[]): PartialBlock =>
  ({ id, type: 'paragraph', content: content.map((c) => (typeof c === 'string' ? { type: 'text', text: c, styles: {} } : c)) }) as never;

/** La posición de la foto con ese nombre. */
function at(e: BlockNoteEditor, name: string): number {
  let found = -1;
  view(e).state.doc.descendants((n, pos) => {
    if (n.type.name === PHOTO && n.attrs.name === name) found = pos;
    return found < 0;
  });
  if (found < 0) throw new Error(`No photo ${name}`);
  return found;
}

const el = (e: BlockNoteEditor, name: string) => view(e).dom.querySelector<HTMLElement>(`.sd-photo[data-name="${name}"]`)!;

function choose(e: BlockNoteEditor, name: string): void {
  const v = view(e);
  v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, at(e, name))));
}

function key(e: BlockNoteEditor, k: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  view(e).dom.dispatchEvent(event);
  return event;
}

/** El texto de un bloque con cada foto como `[nombre]`. */
function line(e: BlockNoteEditor, id: string): string {
  const block = e.getBlock(id);
  return ((block?.content ?? []) as { type: string; text?: string; props?: { name: string } }[])
    .map((c) => (c.type === PHOTO ? `[${c.props!.name}]` : (c.text ?? '')))
    .join('');
}

const sel = (e: BlockNoteEditor) => {
  const s = view(e).state.selection;
  return { kind: s instanceof NodeSelection ? 'node' : 'text', anchor: s.anchor, head: s.head };
};

describe('las filas', () => {
  const classes = (e: BlockNoteEditor, name: string) => {
    const dom = el(e, name);
    return {
      sized: dom.classList.contains('sd-photo-sized'),
      first: dom.classList.contains('sd-photo-row-first'),
      brk: dom.classList.contains('sd-photo-row-break'),
      n: dom.style.getPropertyValue('--row-n').trim(),
      rest: dom.style.getPropertyValue('--row-rest').trim(),
      w: dom.style.getPropertyValue('--ph-w').trim(),
    };
  };

  it('fotos seguidas: cuántas hay en su fila, la primera de cada fila, y el ancho', () => {
    const E = mount([
      p('r3', ph('A', 1 / 3), ph('B', 1 / 3), ph('C', 1 / 3)),
      p('r8', ...[1, 2, 3, 4, 5, 6].map((n) => ph(`Q${n}`, 0.25))),
      p('rt', 'Texto ', ph('T', 1 / 3), ' más texto'),
    ]);
    expect(['A', 'B', 'C'].map((n) => classes(E, n))).toEqual([
      { sized: true, first: true, brk: false, n: '3', rest: '', w: String(1 / 3) },
      { sized: true, first: false, brk: false, n: '3', rest: '', w: String(1 / 3) },
      { sized: true, first: false, brk: false, n: '3', rest: '', w: String(1 / 3) },
    ]);
    // Seis de 1/4: una fila de cuatro y una de dos (que no llena y es la última: sin margen).
    expect(['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'].map((n) => [classes(E, n).n, classes(E, n).first, classes(E, n).brk])).toEqual([
      ['4', true, false],
      ['4', false, false],
      ['4', false, false],
      ['4', false, false],
      ['2', true, false],
      ['2', false, false],
    ]);
    expect(classes(E, 'T')).toMatchObject({ sized: true, first: true, n: '1' });
  });

  it('una fila que no llena seguida de otra: el margen que completa el renglón', () => {
    const E = mount([p('re', ph('A', 0.5), ph('B', 0.251), ph('C', 0.25), ph('D', 0.25), ph('E', 0.25), ph('F', 0.25))]);
    expect(classes(E, 'B')).toMatchObject({ n: '2', brk: true, rest: '0.249' });
    expect(classes(E, 'A').brk).toBe(false);
    expect(classes(E, 'C')).toMatchObject({ n: '4', first: true, brk: false });
  });

  it('un texto (también un espacio) corta la tanda; w = 0 queda con su ancho natural, fuera de las filas', () => {
    const E = mount([p('rs', ph('A', 0.5), ' ', ph('B', 0.5)), p('r0', ph('N', 0), ph('M', 0.5))]);
    expect(classes(E, 'A')).toMatchObject({ n: '1', first: true });
    expect(classes(E, 'B')).toMatchObject({ n: '1', first: true });
    expect(classes(E, 'N')).toMatchObject({ sized: false, n: '', w: '0' });
    expect(el(E, 'N').dataset.w).toBe('0');
    expect(classes(E, 'M')).toMatchObject({ sized: true, first: true, n: '1' });
  });

  it('en un título, un ítem de lista y una celda de tabla; y se recalcula al cambiar un ancho', () => {
    const E = mount([
      { id: 'h', type: 'heading', props: { level: 2 }, content: [ph('H1', 0.5), ph('H2', 0.5)] } as never,
      { id: 'l', type: 'bulletListItem', content: ['ítem ', ph('L1', 0.5), ph('L2', 0.5)] } as never,
      { id: 't', type: 'table', content: { type: 'tableContent', rows: [{ cells: [[ph('C1', 0.5), ph('C2', 0.5)], ['x']] }] } } as never,
    ]);
    for (const n of ['H2', 'L2', 'C2']) expect(classes(E, n)).toMatchObject({ n: '2', first: false });
    const v = view(E);
    v.dispatch(v.state.tr.setNodeAttribute(at(E, 'H2'), 'w', 0.6));
    expect(classes(E, 'H1')).toMatchObject({ n: '1', first: true, brk: true, rest: '0.5' });
    expect(classes(E, 'H2')).toMatchObject({ n: '1', first: true, w: '0.6' });
  });

  it('el cálculo, sin editor: las mismas filas que groupRows', () => {
    const E = mount([p('x', 'a', ph('A', 0.5), ph('B', 0.5), ph('C', 0.5), 'b', ph('D', 0.3))]);
    const doc = view(E).state.doc;
    let rows: { positions: number[]; fracs: number[] }[] = [];
    doc.descendants((n, pos) => {
      if (n.isTextblock && n.childCount > 1) rows = rowsOfTextblock(n, pos);
      return !n.isTextblock;
    });
    expect(rows.map((r) => r.fracs)).toEqual([[0.5, 0.5], [0.5], [0.3]]);
    expect(rows[0].positions).toEqual([at(E, 'A'), at(E, 'B')]);
    // Las cuatro fotos con ancho, más la marca que hace empezar en un renglón nuevo la fila llena (A, B) que viene
    // justo después de un texto. La fila de C (no llena) y la de D (después de texto, no llena) siguen al lado.
    const decos = decorateRows(doc).find();
    expect(decos.length).toBe(5);
    expect(decos.filter((d) => d.from === d.to).map((d) => d.from)).toEqual([at(E, 'A')]);
  });
});

describe('la imagen', () => {
  it('pasa por resolveFileUrl, como la del bloque image; cambiar el ancho no la vuelve a pedir; una respuesta vieja no se pone', async () => {
    const asked: string[] = [];
    const pending = new Map<string, (src: string) => void>();
    const resolveFileUrl = (url: string) => {
      asked.push(url);
      return new Promise<string>((done) => pending.set(url, done));
    };
    const media = 'sdmedia://0f8fad5b-d9cb-469f-a165-70867728950e';
    const E = mount([p('a', 'x ', ph('A', 0.5, media))], { resolveFileUrl });
    const img = el(E, 'A').querySelector(':scope > img.bn-visual-media') as HTMLImageElement;
    // Mientras se busca, sin imagen (una sdmedia:// el navegador no la sabe abrir).
    expect(img.getAttribute('src')).toBeNull();
    expect(asked).toEqual([media]);
    pending.get(media)!('blob:thumb-A');
    await Promise.resolve();
    expect(img.getAttribute('src')).toBe('blob:thumb-A');
    expect(el(E, 'A').dataset.url).toBe(media);

    const v = view(E);
    v.dispatch(v.state.tr.setNodeAttribute(at(E, 'A'), 'w', 1));
    expect(asked).toHaveLength(1);
    expect(el(E, 'A').querySelector('img')).toBe(img);
    expect(el(E, 'A').style.getPropertyValue('--ph-w')).toBe('1');

    // Se reemplaza la dirección dos veces seguidas: la primera respuesta llega tarde y no pisa la segunda.
    v.dispatch(v.state.tr.setNodeAttribute(at(E, 'A'), 'url', 'https://x.test/1.jpg'));
    v.dispatch(v.state.tr.setNodeAttribute(at(E, 'A'), 'url', 'https://x.test/2.jpg'));
    pending.get('https://x.test/2.jpg')!('https://x.test/2.jpg');
    await Promise.resolve();
    pending.get('https://x.test/1.jpg')!('https://x.test/1.jpg');
    await Promise.resolve();
    expect(img.getAttribute('src')).toBe('https://x.test/2.jpg');
  });
});

describe('la selección de texto marca las fotos que abarca', () => {
  it('Shift+flechas, Shift+clic o arrastrar: las fotos del medio llevan la marca; una foto elegida no', () => {
    const E = mount([p('a', 'Antes ', ph('F1', 0.25), ' entre ', ph('F2', 0.2), ' después'), p('b', ph('F3', 0.5))]);
    const v = view(E);
    const marked = () => [...v.dom.querySelectorAll(`.sd-photo.${IN_RANGE_CLASS}`)].map((d) => (d as HTMLElement).dataset.name);
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, at(E, 'F1') - 2, at(E, 'F2') + 1)));
    expect(marked()).toEqual(['F1', 'F2']);
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, at(E, 'F1') + 1, at(E, 'F3') + 1)));
    expect(marked()).toEqual(['F2', 'F3']);
    choose(E, 'F1');
    expect(marked()).toEqual([]);
    expect(el(E, 'F1').classList.contains('ProseMirror-selectednode')).toBe(true);
  });
});

describe('el teclado con una foto elegida', () => {
  const doc = () => [p('a', 'Antes ', ph('F1', 0.25), ' después'), p('b', ph('F3', 1 / 3), ph('F4', 1 / 3), ph('F5', 1 / 3)), p('c', 'Fin')];

  it('una letra: el cursor pasa a la derecha de la foto y la tecla sigue (BlockNote no la traga)', () => {
    const E = mount(doc());
    choose(E, 'F4');
    const e = key(E, 'a');
    expect(e.defaultPrevented).toBe(false);
    expect(sel(E)).toEqual({ kind: 'text', anchor: at(E, 'F4') + 1, head: at(E, 'F4') + 1 });
    // Lo que escribe el navegador va ahí: después de la foto, que sigue en su lugar.
    E.insertInlineContent('a');
    expect(line(E, 'b')).toBe('[F3][F4]a[F5]');
  });

  it('la barra espaciadora (sin la página, que abre el carrete), AltGr y Option escriben después; Ctrl o ⌘ + letra no', () => {
    const E = mount(doc());
    for (const init of [{ key: ' ' }, { key: '@', code: 'KeyQ', ctrlKey: true, altKey: true }, { key: '™', altKey: true }]) {
      choose(E, 'F1');
      const e = key(E, init.key, init);
      expect(e.defaultPrevented).toBe(false);
      expect(sel(E).kind).toBe('text');
      expect(sel(E).head).toBe(at(E, 'F1') + 1);
    }
    for (const init of [{ ctrlKey: true }, { metaKey: true }]) {
      choose(E, 'F1');
      key(E, 'b', init);
      expect(sel(E).kind).toBe('node');
    }
    // Ctrl+Alt con la letra o el número de la tecla misma es un atajo de la página (comentar, título), no AltGr:
    // la foto sigue elegida.
    for (const [k, code] of [['m', 'KeyM'], ['M', 'KeyM'], ['1', 'Digit1']]) {
      choose(E, 'F1');
      key(E, k, { code, ctrlKey: true, altKey: true });
      expect(sel(E).kind).toBe('node');
    }
    expect(line(E, 'a')).toBe('Antes [F1] después');
  });

  it('Enter parte el renglón a la derecha de la foto (no mete un bloque hijo)', () => {
    const E = mount(doc());
    choose(E, 'F4');
    key(E, 'Enter');
    const blocks = E.document;
    expect(blocks.map((b) => line(E, b.id))).toEqual(['Antes [F1] después', '[F3][F4]', '[F5]', 'Fin']);
    expect(blocks.every((b) => b.children.length === 0)).toBe(true);
    // El cursor, al principio del renglón nuevo (antes de F5).
    expect(sel(E)).toEqual({ kind: 'text', anchor: at(E, 'F5'), head: at(E, 'F5') });
  });

  it('Enter en una línea de guion (Script) también: la foto no se borra', () => {
    const E = mount([{ id: 's', type: 'paragraph', props: { [SCRIPT_PROP]: true }, content: ['INT. CASA ', ph('S1', 0.3), ' DÍA'] } as never]);
    choose(E, 'S1');
    key(E, 'Enter');
    expect(E.document.map((b) => [line(E, b.id), (b.props as Record<string, unknown>)[SCRIPT_PROP]])).toEqual([
      ['INT. CASA [S1]', true],
      [' DÍA', true],
    ]);
  });

  it('la tecla que abre una composición (tilde muerta, IME) pasa el cursor antes de que empiece; también compositionstart solo', () => {
    const E = mount(doc());
    for (const init of [{ key: 'Dead' }, { key: 'Process' }, { key: 'Unidentified', keyCode: 229 }]) {
      choose(E, 'F4');
      const e = key(E, init.key, init);
      expect(e.defaultPrevented).toBe(false);
      expect(sel(E)).toEqual({ kind: 'text', anchor: at(E, 'F4') + 1, head: at(E, 'F4') + 1 });
    }
    choose(E, 'F4');
    view(E).dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    expect(sel(E)).toEqual({ kind: 'text', anchor: at(E, 'F4') + 1, head: at(E, 'F4') + 1 });
  });

  it('Shift+flechas: la foto elegida pasa a ser una selección de texto que la abarca', () => {
    const E = mount(doc());
    choose(E, 'F4');
    const right = key(E, 'ArrowRight', { shiftKey: true });
    expect(right.defaultPrevented).toBe(true);
    expect(sel(E)).toEqual({ kind: 'text', anchor: at(E, 'F4'), head: at(E, 'F4') + 1 });
    choose(E, 'F4');
    key(E, 'ArrowLeft', { shiftKey: true });
    expect(sel(E)).toEqual({ kind: 'text', anchor: at(E, 'F4') + 1, head: at(E, 'F4') });
    // ↑ y ↓: queda abarcada y la tecla sigue (el navegador extiende por renglones).
    choose(E, 'F4');
    const down = key(E, 'ArrowDown', { shiftKey: true });
    expect(down.defaultPrevented).toBe(false);
    expect(sel(E)).toEqual({ kind: 'text', anchor: at(E, 'F4'), head: at(E, 'F4') + 1 });
  });

  it('Backspace, Supr y las flechas sin Shift: los de ProseMirror (no los toca)', () => {
    const E = mount(doc());
    for (const k of ['Backspace', 'Delete', 'ArrowRight', 'ArrowLeft', 'Home', 'End', 'Tab', 'Escape']) {
      choose(E, 'F4');
      const before = view(E).state;
      // El manejo propio no la toma ni cambia nada: lo que pase es de ProseMirror o de BlockNote.
      const plugin = view(E).state.plugins.find((pl) => (pl as unknown as { key: string }).key.startsWith('shotdocs-photo-keys'))!;
      const done = plugin.props.handleKeyDown!.call(plugin, view(E), new KeyboardEvent('keydown', { key: k }));
      expect(done).toBe(false);
      expect(view(E).state).toBe(before);
    }
  });

  it('en solo lectura no hace nada', () => {
    const E = mount(doc());
    choose(E, 'F4');
    E.isEditable = false;
    key(E, 'a');
    expect(sel(E).kind).toBe('node');
  });

  // Lo que encontró la auditoría de v0.076: el selector de emojis o el dictado reemplazaban la foto.
  it('texto que entra sin tecla (emojis, dictado): va después de la foto, que sigue', () => {
    const E = mount(doc());
    const input = (from: number, to: number, text: string) =>
      view(E).someProp('handleTextInput', (f) => f(view(E), from, to, text, () => view(E).state.tr.insertText(text, from, to)));
    // Sobre la foto elegida (lo que lee ProseMirror cuando el navegador la reemplaza).
    choose(E, 'F4');
    expect(input(at(E, 'F4'), at(E, 'F4') + 1, '😀')).toBe(true);
    expect(line(E, 'b')).toBe('[F3][F4]😀[F5]');
    expect(sel(E)).toEqual({ kind: 'text', anchor: at(E, 'F4') + 3, head: at(E, 'F4') + 3 });
    // En un borde de la foto elegida (el navegador la dejó y escribió al lado): también después.
    choose(E, 'F1');
    expect(input(at(E, 'F1'), at(E, 'F1'), 'ok')).toBe(true);
    expect(line(E, 'a')).toBe('Antes [F1]ok después');
    // Sin foto elegida, o en otro lugar: lo de siempre (no lo toma).
    view(E).dispatch(view(E).state.tr.setSelection(TextSelection.create(view(E).state.doc, at(E, 'F3'))));
    expect(input(at(E, 'F3'), at(E, 'F3'), 'x')).toBeFalsy();
    choose(E, 'F5');
    expect(input(at(E, 'F3'), at(E, 'F3'), 'x')).toBeFalsy();
    E.isEditable = false;
    expect(input(at(E, 'F5'), at(E, 'F5') + 1, 'x')).toBeFalsy();
    expect(line(E, 'b')).toBe('[F3][F4]😀[F5]');
  });
});

describe('con varias fotos elegidas (solo fotos)', () => {
  // Lo que encontró la auditoría de la entrega 2: después de "Arrange in rows" o de un tamaño quedan elegidas, y una
  // letra, Enter o la barra espaciadora las borraban. Ahora, como con una: la tecla sigue después de la última.
  const doc = () => [p('b', 'x', ph('F3', 1 / 3), ph('F4', 1 / 3), ph('F5', 1 / 3), 'y')];
  const chooseRange = (E: BlockNoteEditor) =>
    view(E).dispatch(view(E).state.tr.setSelection(TextSelection.create(view(E).state.doc, at(E, 'F3'), at(E, 'F5') + 1)));

  it('una letra, Shift+letra, AltGr, la barra espaciadora (sin la página) y Enter: el cursor pasa después de la última', () => {
    const E = mount(doc());
    for (const init of [{ key: 'a' }, { key: 'A', shiftKey: true }, { key: '@', code: 'KeyQ', ctrlKey: true, altKey: true }, { key: ' ' }]) {
      chooseRange(E);
      const e = key(E, init.key, init);
      expect(e.defaultPrevented).toBe(false);
      expect(sel(E)).toEqual({ kind: 'text', anchor: at(E, 'F5') + 1, head: at(E, 'F5') + 1 });
    }
    expect(line(E, 'b')).toBe('x[F3][F4][F5]y');
    // Enter parte el renglón después de la última (las fotos quedan).
    chooseRange(E);
    key(E, 'Enter');
    expect(E.document.map((b) => line(E, b.id))).toEqual(['x[F3][F4][F5]', 'y']);
  });

  it('una composición, y el texto que entra sin tecla (emojis, dictado): después de la última', () => {
    const E = mount(doc());
    chooseRange(E);
    key(E, 'Dead');
    expect(sel(E).head).toBe(at(E, 'F5') + 1);
    chooseRange(E);
    view(E).dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    expect(sel(E).head).toBe(at(E, 'F5') + 1);
    chooseRange(E);
    const from = at(E, 'F3');
    const to = at(E, 'F5') + 1;
    expect(view(E).someProp('handleTextInput', (f) => f(view(E), from, to, '😀', () => view(E).state.tr))).toBe(true);
    expect(line(E, 'b')).toBe('x[F3][F4][F5]😀y');
  });

  it('Backspace, Supr, Ctrl o ⌘ + letra y Shift+flechas: los de siempre (no los toma)', () => {
    const E = mount(doc());
    const plugin = view(E).state.plugins.find((pl) => (pl as unknown as { key: string }).key.startsWith('shotdocs-photo-keys'))!;
    for (const init of [{ key: 'Backspace' }, { key: 'Delete' }, { key: 'c', ctrlKey: true }, { key: 'c', metaKey: true }, { key: 'ArrowRight', shiftKey: true }]) {
      chooseRange(E);
      const before = view(E).state;
      expect(plugin.props.handleKeyDown!.call(plugin, view(E), new KeyboardEvent('keydown', init))).toBe(false);
      expect(view(E).state).toBe(before);
    }
  });

  it('con texto en la selección no hace nada distinto (es una selección de texto)', () => {
    const E = mount(doc());
    view(E).dispatch(view(E).state.tr.setSelection(TextSelection.create(view(E).state.doc, at(E, 'F3') - 1, at(E, 'F5') + 1)));
    const before = view(E).state.selection;
    key(E, 'a');
    expect(view(E).state.selection.eq(before)).toBe(true);
  });
});

describe('arrastrar para elegir y soltar sobre una foto', () => {
  // jsdom no ubica nada: cada foto mide 100 px y está una al lado de la otra.
  const place = (E: BlockNoteEditor, names: string[]) =>
    names.forEach((n, i) => {
      el(E, n).getBoundingClientRect = () => new DOMRect(100 * i, 0, 100, 80);
    });
  const pointer = (type: string, target: EventTarget, init: PointerEventInit) =>
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, ...init }));

  it('el final de la selección va al borde de la foto más cercano al puntero', () => {
    expect(photoDragHead(10, { left: 100, width: 100 }, 120)).toBe(10);
    expect(photoDragHead(10, { left: 100, width: 100 }, 149)).toBe(10);
    expect(photoDragHead(10, { left: 100, width: 100 }, 150)).toBe(11);
    expect(photoDragHead(10, { left: 100, width: 100 }, 199)).toBe(11);
  });

  it('mientras se arrastra (la selección que lee del navegador) y al soltar', () => {
    const E = mount([p('a', 'entre medio'), p('b', ph('F2', 0.25), ph('F3', 0.25), ph('F4', 0.25), ph('F5', 0.25)), p('c', 'Fin')]);
    place(E, ['F2', 'F3', 'F4', 'F5']);
    const v = view(E);
    const anchor = 3;
    const between = (head: number) =>
      v.someProp('createSelectionBetween', (f) => f(v, v.state.doc.resolve(anchor), v.state.doc.resolve(head)));
    // Sin arrastre: no lo toca.
    expect(between(at(E, 'F3'))).toBeFalsy();
    pointer('pointerdown', v.dom.querySelector('p, [data-content-type="paragraph"]')!, { clientX: 5 });
    // Sobre el centro-derecha de F5: después de F5 (el navegador decía otra cosa).
    pointer('pointermove', el(E, 'F5').querySelector('img')!, { clientX: 360 });
    expect(between(at(E, 'F3'))!.head).toBe(at(E, 'F5') + 1);
    // Sobre la mitad izquierda de F4: antes de F4.
    pointer('pointermove', el(E, 'F4').querySelector('img')!, { clientX: 210 });
    expect(between(at(E, 'F2') + 1)!.head).toBe(at(E, 'F4'));
    // Ya donde corresponde: no la cambia.
    expect(between(at(E, 'F4'))).toBeFalsy();
    // Al soltar sobre la mitad derecha de F4 con la selección corrida: queda después de F4.
    pointer('pointermove', el(E, 'F4').querySelector('img')!, { clientX: 280 });
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, anchor, anchor + 1)));
    pointer('pointerup', el(E, 'F4').querySelector('img')!, { clientX: 280, buttons: 0 });
    expect(sel(E)).toEqual({ kind: 'text', anchor, head: at(E, 'F4') + 1 });
    // Terminado el arrastre, no lo toca.
    expect(between(at(E, 'F3'))).toBeFalsy();
  });

  it('un arrastre que empieza en una foto (moverla) o con Shift no lo toca', () => {
    const E = mount([p('b', 'x', ph('F2', 0.5), ph('F3', 0.5))]);
    place(E, ['F2', 'F3']);
    const v = view(E);
    const between = (head: number) => v.someProp('createSelectionBetween', (f) => f(v, v.state.doc.resolve(1), v.state.doc.resolve(head)));
    pointer('pointerdown', el(E, 'F2').querySelector('img')!, { clientX: 10 });
    pointer('pointermove', el(E, 'F3').querySelector('img')!, { clientX: 190 });
    expect(between(at(E, 'F2'))).toBeFalsy();
    pointer('pointerup', document, {});
    pointer('pointerdown', v.dom.firstElementChild!, { clientX: 5, shiftKey: true });
    pointer('pointermove', el(E, 'F3').querySelector('img')!, { clientX: 190 });
    expect(between(at(E, 'F2'))).toBeFalsy();
  });
});

describe('Shift+clic en una foto', () => {
  const shiftDown = (E: BlockNoteEditor, name: string) => {
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, shiftKey: true, button: 0 });
    el(E, name).querySelector('img')!.dispatchEvent(event);
    return event;
  };

  it('desde el cursor: una selección de texto hasta el borde lejano de la foto, para adelante y para atrás', () => {
    const E = mount([p('b', 'x', ph('F3', 1 / 3), ph('F4', 1 / 3), ph('F5', 1 / 3), 'y')]);
    const v = view(E);
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, at(E, 'F3'))));
    expect(shiftDown(E, 'F5').defaultPrevented).toBe(true);
    expect(sel(E)).toEqual({ kind: 'text', anchor: at(E, 'F3'), head: at(E, 'F5') + 1 });
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, at(E, 'F5') + 1)));
    shiftDown(E, 'F3');
    expect(sel(E)).toEqual({ kind: 'text', anchor: at(E, 'F5') + 1, head: at(E, 'F3') });
  });

  it('con una foto elegida: abarca las dos y lo del medio (la elegida queda adentro)', () => {
    const E = mount([p('b', ph('F3', 1 / 3), ph('F4', 1 / 3), ph('F5', 1 / 3)), p('c', ph('F6', 0.5))]);
    choose(E, 'F3');
    shiftDown(E, 'F5');
    expect(sel(E)).toEqual({ kind: 'text', anchor: at(E, 'F3'), head: at(E, 'F5') + 1 });
    choose(E, 'F5');
    shiftDown(E, 'F3');
    expect(sel(E)).toEqual({ kind: 'text', anchor: at(E, 'F5') + 1, head: at(E, 'F3') });
    choose(E, 'F4');
    shiftDown(E, 'F6');
    expect(sel(E)).toEqual({ kind: 'text', anchor: at(E, 'F4'), head: at(E, 'F6') + 1 });
  });

  it('sin Shift, con otro botón o en solo lectura, no lo toca (sigue el clic de ProseMirror)', () => {
    const E = mount([p('b', ph('F3', 0.5), ph('F4', 0.5))]);
    choose(E, 'F3');
    const target = el(E, 'F4').querySelector('img')!;
    // Directo al manejo propio: jsdom no sabe ubicar un clic (el de ProseMirror).
    const down = (init: MouseEventInit) => {
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...init });
      Object.defineProperty(event, 'target', { value: target });
      return handlePhotoShiftClick(view(E), event);
    };
    expect(down({})).toBe(false);
    expect(down({ shiftKey: true, button: 2 })).toBe(false);
    E.isEditable = false;
    expect(down({ shiftKey: true })).toBe(false);
    expect(sel(E).kind).toBe('node');
  });
});

describe('qué foto es: el bloque más su lugar', () => {
  it('la pantalla, el documento y el carrete dicen lo mismo, también con hijos, listas y tablas', () => {
    const E = mount([
      {
        id: 'p1',
        type: 'paragraph',
        content: ['a ', ph('A'), ph('B'), ' b'],
        children: [{ id: 'c1', type: 'paragraph', content: [ph('C')] }],
      } as never,
      { id: 'img', type: 'image', props: { url: 'https://example.invalid/blk.jpg' } } as never,
      { id: 'l1', type: 'numberedListItem', content: ['ítem ', ph('D')] } as never,
      { id: 't1', type: 'table', content: { type: 'tableContent', rows: [{ cells: [[ph('E')], ['x', ph('F')]] }, { cells: [[ph('G')], []] }] } } as never,
    ]);
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const fromDom = names.map((n) => photoKeyOf(el(E, n).querySelector('img')));
    const fromDoc = names.map((n) => photoKeyAtPos(view(E).state.doc, at(E, n)));
    expect(fromDom).toEqual(['p1#0', 'p1#1', 'c1#0', 'l1#0', 't1#0', 't1#1', 't1#2']);
    expect(fromDoc).toEqual(fromDom);
    const items = collectCarrete(E.document as unknown as BlockLike[]);
    expect(items.map((i) => i.key)).toEqual(['p1#0', 'p1#1', 'c1#0', 'img', 'l1#0', 't1#0', 't1#1', 't1#2']);
    // El bloque image sigue con su id.
    expect(photoKeyOf(view(E).dom.querySelector('[data-content-type="image"] img.bn-visual-media'))).toBe('img');
    // La foto elegida: su clave (la del bloque image, o la de la foto en línea).
    choose(E, 'B');
    expect(selectedPhotoKey(view(E).state)).toBe('p1#1');
    const v = view(E);
    let imagePos = -1;
    v.state.doc.descendants((n, pos) => {
      if (n.type.name === 'image') imagePos = pos;
      return imagePos < 0;
    });
    v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, imagePos)));
    expect(selectedPhotoKey(v.state)).toBe('img');
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, at(E, 'A'))));
    expect(selectedPhotoKey(v.state)).toBeNull();
  });
});

describe('lo demás sigue andando', () => {
  it('buscar: una foto corta el texto en dos tramos (una búsqueda no la cruza)', () => {
    const E = mount([p('a', 'abc', ph('F'), 'def'), p('b', 'abcdef')]);
    const doc = view(E).state.doc;
    expect(computeMatches(doc, 'cd', {}).matches.map((m) => m.blockId)).toEqual(['b']);
    expect(computeMatches(doc, 'abc', {}).matches.map((m) => m.blockId)).toEqual(['a', 'b']);
    expect(computeMatches(doc, 'def', {}).matches).toHaveLength(2);
  });

  it('colapsar: el párrafo con fotos se esconde con su título, y las fotos siguen en el carrete', () => {
    const E = mount([{ id: 'h', type: 'heading', props: { level: 2 }, content: 'Escena' } as never, p('a', 'x ', ph('F1', 0.5), ph('F2', 0.5))], {
      collapse: true,
    });
    setCollapsed(view(E), ['h'], true);
    const hidden = view(E).dom.querySelector('[data-id="a"] .bn-block-content');
    expect(hidden?.classList.contains('sd-collapsed-hidden')).toBe(true);
    expect(line(E, 'a')).toBe('x [F1][F2]');
    expect(collectCarrete(E.document as unknown as BlockLike[]).map((i) => i.key)).toEqual(['a#0', 'a#1']);
  });

  it('copiar y pegar dentro de la app conserva las fotos, con su ancho, entre el texto', () => {
    // jsdom no tiene ClipboardEvent (ProseMirror arma uno para pegar).
    const g = globalThis as { ClipboardEvent?: unknown };
    g.ClipboardEvent ??= class extends Event {
      clipboardData = null;
    };
    const E = mount([p('a', 'Antes ', ph('F1', 0.25), ' entre ', ph('F2', 0.2), ' después'), p('b', 'Fin')]);
    const v = view(E);
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, at(E, 'F1') - 3, at(E, 'F2') + 1)));
    const { clipboardHTML } = selectedFragmentToHTML(v, E as never);
    expect(clipboardHTML).toContain('data-inline-content-type="photo"');
    E.setTextCursorPosition('b', 'end');
    v.pasteHTML(clipboardHTML);
    expect(line(E, 'b')).toBe('Fines [F1] entre [F2]');
    const pasted = (E.getBlock('b')!.content as { type: string; props?: { w: number } }[]).filter((c) => c.type === PHOTO);
    expect(pasted.map((c) => c.props!.w)).toEqual([0.25, 0.2]);
    // Cortar: se van del renglón de arriba (y se deshace con un paso).
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, at(E, 'F1') - 3, at(E, 'F2') + 1)));
    v.dispatch(v.state.tr.deleteSelection());
    expect(line(E, 'a')).toBe('Ant después');
  });
});
