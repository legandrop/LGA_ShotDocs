// @vitest-environment jsdom
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { collapseExtension, setCollapsed } from './collapseEditor';
import { schema } from './editorSchema';
import { UNIT_SELECTOR } from './pagination';
import { buildPrintView, paginateView } from './printView';
import { placeMarks, sheetLabel } from './SheetBreaks';
import { t } from '../i18n';

// Colapsar y las hojas (Docs/Doc_Colapsar.md, sección 7): los cortes se cuentan con todo abierto (la vista de
// impresión no copia lo colapsado), el PDF sale todo abierto, y un corte que cae en algo escondido se muestra
// junto en el título colapsado.

const UNIT = 300;
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** jsdom no dibuja: cada unidad mide 300 px, una debajo de la otra (tres por hoja A4). */
function fakeLayout() {
  const original = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const scope = this.closest('.print-page, article.page');
    if (!scope) return original.call(this);
    const units = [...scope.querySelectorAll(UNIT_SELECTOR)];
    const i = units.indexOf(this);
    const top = i < 0 ? 0 : i * UNIT;
    const height = i < 0 ? 0 : UNIT;
    return { top, bottom: top + height, height, left: 0, right: 600, width: 600, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
}

function mountPage(blocks: PartialBlock[]) {
  const doc = new Y.Doc();
  const editor = BlockNoteEditor.create(
    withCollaboration({
      schema,
      collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
      extensions: [collapseExtension({})],
    }),
  ) as unknown as BlockNoteEditor;
  const article = document.createElement('article');
  article.className = 'page sheet';
  article.dataset.pageId = 'p1';
  const title = document.createElement('textarea');
  title.className = 'page-title';
  title.value = 'Rooftop plates';
  const host = document.createElement('div');
  host.className = 'editor-host';
  const container = document.createElement('div');
  container.className = 'bn-container editor';
  const mountPoint = document.createElement('div');
  container.append(mountPoint);
  host.append(container);
  article.append(title, host);
  document.body.append(article);
  editor.mount(mountPoint);
  cleanups.push(() => editor.unmount());
  editor.replaceBlocks(editor.document, blocks as never);
  return { doc, editor, article, host };
}

const p = (text: string) => ({ type: 'paragraph', content: text }) as PartialBlock;
const h = (text: string) => ({ type: 'heading', props: { level: 2 }, content: text }) as PartialBlock;

function measure(article: HTMLElement, host: HTMLElement) {
  const view = buildPrintView(article, { size: 'A4', landscape: false }, 'measure');
  try {
    const result = paginateView(view);
    const copyHidden = view.root.querySelectorAll('.sd-collapsed, .sd-collapsed-hidden, [data-sd-hider], [data-sd-collapsed]').length;
    return { breaks: result.pagination.breaks.map((b) => ({ key: b.key, sheet: b.sheet })), marks: placeMarks(article, host, result).marks, copyHidden };
  } finally {
    view.root.remove();
  }
}

describe('las hojas con secciones colapsadas', () => {
  it('los cortes se cuentan con todo abierto; los escondidos van juntos en el título colapsado', () => {
    // Título + 12 bloques de 300 px: tres por hoja. La sección "Escena" ocupa varias hojas.
    const blocks = [p('Uno'), h('Escena'), ...Array.from({ length: 8 }, (_, i) => p(`E${i + 1}`)), h('Otra'), p('Fin')];
    const { editor, article, host, doc } = mountPage(blocks);
    fakeLayout();
    const open = measure(article, host);
    expect(open.marks.every((m) => !m.inside)).toBe(true);
    const sheets = open.marks.map((m) => m.sheet);
    expect(sheets.length).toBeGreaterThanOrEqual(3);

    const state = Y.encodeStateAsUpdate(doc);
    const escena = editor.document[1].id;
    setCollapsed(editor.prosemirrorView!, [escena], true);
    const collapsed = measure(article, host);
    // Los mismos cortes (la copia no trae lo colapsado) y la copia sin marcas de colapsar.
    expect(collapsed.breaks).toEqual(open.breaks);
    expect(collapsed.copyHidden).toBe(0);
    // Los cortes que caen adentro de la sección van juntos en el título; los demás, como siempre.
    const hiddenIds = new Set(editor.document.slice(2, 10).map((b) => b.id));
    const hiddenSheets = open.breaks.filter((b) => hiddenIds.has(b.key.slice(2))).map((b) => b.sheet);
    expect(hiddenSheets.length).toBeGreaterThanOrEqual(2);
    const inside = collapsed.marks.filter((m) => m.inside);
    expect(inside).toEqual([expect.objectContaining({ sheet: Math.min(...hiddenSheets), to: Math.max(...hiddenSheets) })]);
    const visibleSheets = collapsed.marks.filter((m) => !m.inside).map((m) => m.sheet);
    expect(visibleSheets).toEqual(sheets.filter((s) => !hiddenSheets.includes(s)));
    // El número de la próxima hoja visible cuenta las escondidas.
    expect(Math.max(...visibleSheets)).toBe(Math.max(...sheets));
    // Medir no toca el documento.
    expect(Y.encodeStateAsUpdate(doc)).toEqual(state);
  });

  it('la vista para imprimir sale con todo abierto', () => {
    const { editor, article } = mountPage([h('T'), p('a'), p('b')]);
    setCollapsed(editor.prosemirrorView!, [editor.document[0].id], true);
    expect(article.querySelectorAll('.sd-collapsed-hidden')).toHaveLength(2);
    const view = buildPrintView(article, { size: 'A4', landscape: false }, 'output');
    try {
      expect(view.root.querySelectorAll('.sd-collapsed-hidden, .sd-collapsed')).toHaveLength(0);
      expect([...view.root.querySelectorAll('.bn-block-content')].map((el) => el.textContent)).toEqual(['T', 'a', 'b']);
    } finally {
      view.root.remove();
    }
  });
});

describe('imprimir como se ve', () => {
  it('con la casilla, la vista para imprimir sale sin lo colapsado (también los hijos del título); para medir, todo abierto', () => {
    const { editor, article } = mountPage([h('T'), p('a'), p('b'), h('U'), p('c')]);
    setCollapsed(editor.prosemirrorView!, [editor.document[0].id], true);
    const view = buildPrintView(article, { size: 'A4', landscape: false }, 'output', { asSeen: true });
    const measure = buildPrintView(article, { size: 'A4', landscape: false }, 'measure', { asSeen: true });
    try {
      expect([...view.root.querySelectorAll('.bn-block-content')].map((el) => el.textContent)).toEqual(['T', 'U', 'c']);
      expect(view.root.querySelectorAll('.sd-collapsed-hidden, .sd-collapsed')).toHaveLength(0);
      // Las marcas de la pantalla siguen contando todo abierto.
      expect([...measure.root.querySelectorAll('.bn-block-content')].map((el) => el.textContent)).toEqual(['T', 'a', 'b', 'U', 'c']);
      // El documento no cambió.
      expect(editor.document.map((b) => (b.content as { text: string }[])[0]?.text)).toEqual(['T', 'a', 'b', 'U', 'c']);
    } finally {
      view.root.remove();
      measure.root.remove();
    }
  });

  it('la casilla se guarda en el dispositivo (y sin almacenamiento no rompe)', async () => {
    const { printAsSeen, setPrintAsSeen } = await import('./printAsSeen');
    expect(printAsSeen()).toBe(false);
    setPrintAsSeen(true);
    expect(printAsSeen()).toBe(true);
    setPrintAsSeen(false);
    expect(printAsSeen()).toBe(false);
    // Sin almacenamiento (ventana privada): apagada y sin errores.
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('sin almacenamiento');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('sin almacenamiento');
    });
    expect(printAsSeen()).toBe(false);
    expect(() => setPrintAsSeen(true)).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
});

describe('la etiqueta de las hojas escondidas', () => {
  it('"Hoja 5", "Hoja 3 adentro" y "Hojas 2–4 adentro"', () => {
    expect(sheetLabel({ sheet: 5, y: 0 }, t)).toBe('Page 5');
    expect(sheetLabel({ sheet: 3, to: 3, y: 0, inside: true }, t)).toBe('Page 3 inside');
    expect(sheetLabel({ sheet: 2, to: 4, y: 0, inside: true }, t)).toBe('Pages 2–4 inside');
  });
});
