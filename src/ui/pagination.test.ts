// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { schema } from './editorSchema';
import { printGeometry } from './pageFormat';
import { paginate, UNIT_SELECTOR, type Unit } from './pagination';
import { finishPrint, printPage } from './printPage';
import { buildPrintView, paginateView } from './printView';
import { placeMarks } from './SheetBreaks';

// Cortes entre hojas (roadmap B.7): el cálculo con alturas simuladas, y que paginar e imprimir no tocan el
// documento (un corte es un cálculo, no contenido).

const H = 1000;
const text = (key: string, top: number, height: number, lineHeight = 25): Unit => ({
  key,
  top,
  height,
  splits: height > H ? Array.from({ length: Math.floor(height / lineHeight) - 1 }, (_, i) => (i + 1) * lineHeight) : undefined,
});
const block = (key: string, top: number, height: number): Unit => ({ key, top, height });

describe('paginate', () => {
  it('todo en una hoja: sin cortes', () => {
    expect(paginate([block('title', 0, 60), block('b:1', 60, 400), block('b:2', 460, 540)], H)).toEqual({ breaks: [], sheets: 1 });
  });

  it('una imagen que no entra en lo que queda pasa entera a la hoja siguiente', () => {
    const r = paginate([block('title', 0, 60), block('b:p', 60, 700), block('b:img', 760, 400), block('b:q', 1160, 50)], H);
    expect(r.breaks).toEqual([{ index: 2, key: 'b:img', offset: 0, sheet: 2 }]);
    expect(r.sheets).toBe(2);
  });

  it('un párrafo corto que no entra también pasa entero (no se parte si entra en una hoja)', () => {
    const r = paginate([block('b:1', 0, 950), text('b:2', 950, 100)], H);
    expect(r.breaks).toEqual([{ index: 1, key: 'b:2', offset: 0, sheet: 2 }]);
  });

  it('un párrafo más largo que una hoja se parte en el último renglón que entra', () => {
    // Empieza a los 300: en la primera hoja entran 700 px, 28 renglones de 25.
    const r = paginate([block('b:1', 0, 300), text('b:long', 300, 2000)], H);
    expect(r.breaks[0]).toEqual({ index: 1, key: 'b:long', offset: 700, sheet: 2 });
    // La segunda hoja empieza en el renglón 29 y toma 40 renglones; lo que queda va a la tercera.
    expect(r.breaks[1]).toEqual({ index: 1, key: 'b:long', offset: 1700, sheet: 3 });
    expect(r.sheets).toBe(3);
  });

  it('los cortes de un bloque alto caen en un renglón, nunca a mitad', () => {
    const r = paginate([block('b:1', 0, 310), text('b:long', 310, 1500, 30)], H);
    for (const b of r.breaks) expect(b.offset % 30).toBe(0);
  });

  it('una tabla más alta que una hoja se parte entre filas', () => {
    const rows = [100, 400, 700, 1000, 1300];
    const r = paginate([block('b:1', 0, 500), { key: 'b:table', top: 500, height: 1500, splits: rows }], H);
    expect(r.breaks[0]).toMatchObject({ key: 'b:table', offset: 400 });
  });

  it('lo que no se puede partir y es más alto que una hoja empieza en una hoja nueva y se corta en el borde', () => {
    const r = paginate([block('b:1', 0, 200), block('b:huge', 200, 2500)], H);
    expect(r.breaks.map((b) => b.offset)).toEqual([0, 1000, 2000]);
    expect(r.sheets).toBe(4);
  });

  it('un título de sección no queda solo al pie: pasa con el bloque que sigue', () => {
    const heading: Unit = { key: 'b:h', top: 600, height: 50, keepWithNext: true };
    const r = paginate([block('b:1', 0, 600), heading, block('b:img', 650, 500)], H);
    expect(r.breaks).toEqual([{ index: 1, key: 'b:h', offset: 0, sheet: 2 }]);
  });

  it('la tolerancia manda a la hoja siguiente un bloque entero que entra justo, pero no cambia dónde se parte', () => {
    expect(paginate([block('b:1', 0, 998)], H, 4).breaks).toEqual([]);
    expect(paginate([block('b:1', 0, 500), block('b:2', 500, 498)], H, 4).breaks).toHaveLength(1);
    expect(paginate([block('b:1', 0, 500), block('b:2', 500, 498)], H, 0).breaks).toHaveLength(0);
    // Un párrafo largo se parte en el último renglón que entra en la hoja entera, como el navegador.
    expect(paginate([block('b:1', 0, 300), text('b:long', 300, 2000)], H, 4).breaks[0].offset).toBe(700);
  });

  it('muchas hojas numeradas en orden', () => {
    const units = Array.from({ length: 10 }, (_, i) => block(`b:${i}`, i * 300, 300));
    const r = paginate(units, H);
    expect(r.breaks.map((b) => [b.key, b.sheet])).toEqual([
      ['b:3', 2],
      ['b:6', 3],
      ['b:9', 4],
    ]);
  });
});

describe('printGeometry', () => {
  it('A4 vertical, carta horizontal y libre (A4)', () => {
    expect(printGeometry({ size: 'A4', landscape: false })).toMatchObject({ widthMm: 210, heightMm: 297, marginMm: 20 });
    expect(printGeometry({ size: 'Letter', landscape: true })).toMatchObject({ widthMm: 279.4, heightMm: 215.9 });
    const free = printGeometry({ size: 'free', landscape: true });
    expect(free).toMatchObject({ widthMm: 210, heightMm: 297 });
    expect(free.contentHeight).toBeCloseTo(((297 - 40) * 96) / 25.4, 5);
  });
});

// --- Paginar e imprimir no tocan el documento ------------------------------------------------------

const UNIT = 300;
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
  finishPrint();
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

function mountPage(): { doc: Y.Doc; editor: BlockNoteEditor; article: HTMLElement; host: HTMLElement } {
  const doc = new Y.Doc();
  const editor = BlockNoteEditor.create(
    withCollaboration({
      schema,
      collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
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
  host.append(container);
  article.append(title, host);
  document.body.append(article);
  editor.mount(container);
  cleanups.push(() => editor.unmount());
  editor.replaceBlocks(
    editor.document,
    Array.from({ length: 8 }, (_, i) =>
      i === 2
        ? { type: 'paragraph' as const, props: { script: true } as never, content: 'INT. ROOFTOP - NIGHT' }
        : { type: 'paragraph' as const, content: `Paragraph ${i + 1}` },
    ),
  );
  return { doc, editor, article, host };
}

describe('paginar e imprimir', () => {
  it('calcula los cortes de la vista sin cambiar el Y.Doc ni el editor', () => {
    const { doc, editor, article, host } = mountPage();
    fakeLayout();
    const state = Y.encodeStateAsUpdate(doc);
    const blocks = JSON.stringify(editor.document);
    let updates = 0;
    doc.on('update', () => updates++);

    const view = buildPrintView(article, { size: 'A4', landscape: false }, 'measure');
    const result = paginateView(view);
    // Título + 8 párrafos de 300 px: tres por hoja A4 vertical.
    expect(result.pagination.breaks.map((b) => b.sheet)).toEqual([2, 3]);
    expect(result.pagination.breaks[0].key).toMatch(/^b:/);
    const { marks } = placeMarks(article, host, result);
    expect(marks.map((m) => m.sheet)).toEqual([2, 3]);
    view.root.remove();

    expect(updates).toBe(0);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(state);
    expect(JSON.stringify(editor.document)).toBe(blocks);
    // La copia no se queda en la página ni en el editor.
    expect(document.querySelector('.print-view')).toBeNull();
    expect(host.querySelector('.sheet-break-before, .sheet-keep')).toBeNull();
  });

  it('imprimir arma la vista con los saltos, llama a print y no cambia el Y.Doc', async () => {
    const { doc, editor, article } = mountPage();
    fakeLayout();
    const state = Y.encodeStateAsUpdate(doc);
    const blocks = JSON.stringify(editor.document);
    let updates = 0;
    doc.on('update', () => updates++);
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      // Mientras está el diálogo: solo la vista, la hoja puesta y el título como nombre del PDF.
      const out = document.querySelector<HTMLElement>('.print-output')!;
      expect(document.documentElement.classList.contains('sd-printing')).toBe(true);
      expect(document.head.textContent).toContain('@page { size: 297mm 210mm; margin: 20mm; }');
      expect(document.title).toBe('Rooftop plates');
      expect(out.querySelector('h1.page-title')?.textContent).toBe('Rooftop plates');
      // A4 horizontal: dos unidades de 300 px por hoja, cinco hojas.
      expect(out.querySelectorAll('.sheet-break-before')).toHaveLength(4);
      expect(out.querySelector('[contenteditable]')).toBeNull();
      expect(out.querySelector('.script-line')).not.toBeNull();
    });

    await printPage('p1', { format: { size: 'A4', landscape: true } });
    expect(print).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('afterprint'));

    expect(document.querySelector('.print-view')).toBeNull();
    expect(document.documentElement.classList.contains('sd-printing')).toBe(false);
    expect(document.head.textContent ?? '').not.toContain('@page');
    expect(updates).toBe(0);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(state);
    expect(JSON.stringify(editor.document)).toBe(blocks);
    expect(article.querySelector('.sheet-break-before')).toBeNull();
  });
});
