// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { schema } from './editorSchema';
import { printGeometry } from './pageFormat';
import { mergeRowUnits, paginate, UNIT_SELECTOR, type Unit } from './pagination';
import { downscale, finishPrint, ORIGINAL_MAX_SIDE, printPage } from './printPage';
import { buildPrintView, paginateView } from './printView';
import { isContentMutation, placeMarks } from './SheetBreaks';

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

  it('el título de sección se queda si no entra en una hoja junto con el bloque que sigue', () => {
    const heading: Unit = { key: 'b:h', top: 600, height: 100, keepWithNext: true };
    const r = paginate([block('b:1', 0, 600), heading, block('b:img', 700, 950)], H);
    expect(r.breaks).toEqual([{ index: 2, key: 'b:img', offset: 0, sheet: 2 }]);
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

describe('una fila de fotos es una sola unidad', () => {
  const el = (row: string | null) => {
    const d = document.createElement('div');
    if (row) d.dataset.row = row;
    return d;
  };
  it('junta las fotos de la misma fila (de la que empieza más arriba a la que termina más abajo) y deja el resto igual', () => {
    const elements = [el(null), el('r1'), el('r1'), el('r1'), el(null), el('r2')];
    const units: Unit[] = [
      { key: 'b:p', top: 0, height: 40 },
      { key: 'b:a', top: 40, height: 300 },
      { key: 'b:b', top: 40, height: 180 },
      { key: 'b:c', top: 38, height: 250 },
      { key: 'b:q', top: 340, height: 30 },
      { key: 'b:d', top: 370, height: 200 },
    ];
    const merged = mergeRowUnits({ units, elements }, (e) => e.dataset.row ?? null);
    expect(merged.units.map((u) => [u.key, u.top, u.height])).toEqual([
      ['b:p', 0, 40],
      ['b:a', 38, 302],
      ['b:q', 340, 30],
      ['b:d', 370, 200],
    ]);
    expect(merged.members!.map((m) => m.length)).toEqual([1, 3, 1, 1]);
    expect(merged.elements[1]).toBe(elements[1]);
  });

  it('dos filas seguidas distintas no se juntan', () => {
    const elements = [el('r1'), el('r2')];
    const units: Unit[] = [
      { key: 'b:a', top: 0, height: 100 },
      { key: 'b:b', top: 108, height: 100 },
    ];
    expect(mergeRowUnits({ units, elements }, (e) => e.dataset.row ?? null).units).toHaveLength(2);
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

function mountPage(extra: unknown[] = []): { doc: Y.Doc; editor: BlockNoteEditor; article: HTMLElement; host: HTMLElement } {
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
  // Como BlockNoteView: el documento va adentro del contenedor, junto a las barras flotantes.
  const mountPoint = document.createElement('div');
  container.append(mountPoint);
  host.append(container);
  article.append(title, host);
  document.body.append(article);
  editor.mount(mountPoint);
  cleanups.push(() => editor.unmount());
  editor.replaceBlocks(
    editor.document,
    Array.from({ length: 8 }, (_, i) =>
      i === 2
        ? { type: 'paragraph' as const, props: { script: true } as never, content: 'INT. ROOFTOP - NIGHT' }
        : { type: 'paragraph' as const, content: `Paragraph ${i + 1}` },
    ).concat(extra as never[]),
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

describe('la vista de impresión y el diálogo', () => {
  const notices: string[] = [];
  const onNotice = (e: Event) => notices.push((e as CustomEvent<string>).detail);
  const printing = () => document.documentElement.classList.contains('sd-printing');
  afterEach(() => {
    window.removeEventListener('shotdocs:notice', onNotice);
    notices.length = 0;
    delete document.documentElement.dataset.theme;
  });

  it('la barra de formato y los menús flotantes del editor no entran en la copia, ni los ids', () => {
    const { article } = mountPage();
    const container = article.querySelector('.bn-container')!;
    const toolbar = document.createElement('div');
    toolbar.className = 'bn-formatting-toolbar';
    toolbar.id = 'floating-1';
    toolbar.textContent = 'Bold Italic';
    container.append(toolbar);
    article.querySelector('.bn-editor')!.setAttribute('id', 'editor-1');
    const view = buildPrintView(article, { size: 'A4', landscape: false }, 'output');
    expect(view.root.querySelector('.bn-formatting-toolbar')).toBeNull();
    expect(view.root.textContent).not.toContain('Bold Italic');
    expect(view.root.querySelector('[id]')).toBeNull();
    expect(view.root.querySelector('.bn-container .bn-editor')).not.toBeNull();
    expect(view.root.querySelector('.bn-container')!.getAttribute('data-color-scheme')).toBe('light');
    view.root.remove();
  });

  it('no toca el tema de la app (la vista trae sus colores claros)', async () => {
    mountPage();
    fakeLayout();
    document.documentElement.dataset.theme = 'dark';
    let during = '';
    vi.spyOn(window, 'print').mockImplementation(() => {
      during = document.documentElement.dataset.theme ?? '';
    });
    await printPage('p1', { format: { size: 'A4', landscape: false } });
    window.dispatchEvent(new Event('afterprint'));
    expect(during).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('sin afterprint, el primer toque después del diálogo deja todo como estaba', async () => {
    mountPage();
    fakeLayout();
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    await printPage('p1', { format: { size: 'A4', landscape: false } });
    expect(printing()).toBe(true);
    expect(document.querySelector('.print-output')).not.toBeNull();
    window.dispatchEvent(new Event('pointerdown'));
    expect(printing()).toBe(false);
    expect(document.querySelector('.print-view')).toBeNull();
  });

  it('en un táctil, un afterprint que llega enseguida (el iPhone) no limpia; limpia el primer toque', async () => {
    mountPage();
    fakeLayout();
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });
    cleanups.push(() => delete (navigator as { maxTouchPoints?: number }).maxTouchPoints);
    vi.spyOn(window, 'print').mockImplementation(() => window.dispatchEvent(new Event('afterprint')));
    await printPage('p1', { format: { size: 'A4', landscape: false } });
    expect(printing()).toBe(true);
    window.dispatchEvent(new Event('pointerdown'));
    expect(printing()).toBe(false);
  });

  it('si print() falla, se saca todo y avisa', async () => {
    mountPage();
    fakeLayout();
    window.addEventListener('shotdocs:notice', onNotice);
    vi.spyOn(window, 'print').mockImplementation(() => {
      throw new Error('blocked');
    });
    await printPage('p1', { format: { size: 'A4', landscape: false } });
    expect(printing()).toBe(false);
    expect(document.querySelector('.print-view')).toBeNull();
    expect(document.head.textContent ?? '').not.toContain('@page');
    expect(notices).toHaveLength(1);
  });

  it('si se cancela mientras busca los originales, no crea nada más ni abre el diálogo', async () => {
    mountPage([{ type: 'image', props: { url: 'sdmedia://0b7c2f5e-3d1a-4c8e-9f60-2a4b6c8d0e1f' } }]);
    fakeLayout();
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    const created = vi.fn(() => 'blob:x');
    const url = URL as unknown as { createObjectURL?: unknown; revokeObjectURL?: unknown };
    const before = { create: url.createObjectURL, revoke: url.revokeObjectURL };
    url.createObjectURL = created;
    url.revokeObjectURL = () => undefined;
    cleanups.push(() => {
      url.createObjectURL = before.create;
      url.revokeObjectURL = before.revoke;
    });
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const media = {
      localImage: vi.fn(async () => {
        finishPrint(); // se cerró o empezó otra impresión mientras tanto
        return new Blob(['x'], { type: 'image/jpeg' });
      }),
    };
    await printPage('p1', { format: { size: 'A4', landscape: false }, media: media as never });
    expect(media.localImage).toHaveBeenCalledWith('0b7c2f5e-3d1a-4c8e-9f60-2a4b6c8d0e1f');
    expect(created).not.toHaveBeenCalled();
    expect(print).not.toHaveBeenCalled();
    expect(document.querySelector('.print-view')).toBeNull();
  });

  it('espera a que las imágenes de la página terminen de ponerse antes de armar la vista', async () => {
    mountPage([{ type: 'image', props: { url: 'https://example.com/plate.jpg' } }]);
    fakeLayout();
    let loaded = false;
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockImplementation(() => loaded);
    setTimeout(() => (loaded = true), 250);
    let printedAt = 0;
    const start = Date.now();
    vi.spyOn(window, 'print').mockImplementation(() => {
      printedAt = Date.now();
    });
    await printPage('p1', { format: { size: 'A4', landscape: false } });
    expect(printedAt - start).toBeGreaterThanOrEqual(200);
    expect(document.querySelector('.print-output img')).not.toBeNull();
  });

  it('achica una foto grande a 2400 px de lado mayor', async () => {
    const drawn = vi.fn();
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(async () => ({ width: 6000, height: 4000, close: vi.fn() }));
    cleanups.push(() => delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: drawn } as never);
    let size = '';
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback) {
      size = `${this.width}x${this.height}`;
      cb(new Blob(['y'], { type: 'image/jpeg' }));
    });
    const out = await downscale(new Blob(['x'], { type: 'image/heic' }), ORIGINAL_MAX_SIDE);
    expect(size).toBe('2400x1600');
    expect(out?.type).toBe('image/jpeg');
    expect(drawn).toHaveBeenCalled();
  });
});

describe('las fotos en la vista de impresión', () => {
  // Una página con una foto (del Drive: en pantalla, su miniatura de 480 × 320), antes un ícono que no es
  // una foto del editor. `editorWidth`: el ancho del editor en pantalla (teléfono o computadora).
  function photoPage(editorWidth: number, wrapperWidth: string, natural = 480) {
    const article = document.createElement('article');
    article.className = 'page sheet';
    article.innerHTML = `<div class="editor-host"><div class="bn-container"><div class="bn-editor" style="padding: 0 20px">
      <p><img class="icon" src="data:,"></p>
      <div class="bn-block-outer"><div data-content-type="image" data-url="sdmedia://x">
        <div class="bn-file-block-content-wrapper" style="width: ${wrapperWidth}">
          <div class="bn-visual-media-wrapper"><img class="bn-visual-media" src="blob:thumb"></div>
        </div></div></div></div></div></div>`;
    document.body.append(article);
    cleanups.push(() => article.remove());
    Object.defineProperty(article.querySelector('.bn-editor')!, 'clientWidth', { value: editorWidth });
    const img = article.querySelector<HTMLImageElement>('img.bn-visual-media')!;
    Object.defineProperty(img, 'naturalWidth', { value: natural });
    Object.defineProperty(img, 'naturalHeight', { value: natural ? 320 : 0 });
    img.getBoundingClientRect = () => ({ width: Math.min(natural, editorWidth - 40) }) as DOMRect;
    return article;
  }
  const wrapperOf = (view: { root: HTMLElement }) =>
    view.root.querySelector<HTMLImageElement>('img.bn-visual-media')!.closest<HTMLElement>('.bn-file-block-content-wrapper')!;

  it('una miniatura sin ancho propio va con su ancho natural, el mismo desde el teléfono o la computadora', () => {
    for (const editorWidth of [390, 1122]) {
      const view = buildPrintView(photoPage(editorWidth, 'fit-content'), { size: 'A3', landscape: false }, 'measure');
      expect(wrapperOf(view).style.width).toBe('480px');
      expect(wrapperOf(view).style.maxWidth).toBe('100%');
      expect(view.root.querySelector<HTMLImageElement>('img.bn-visual-media')!.style.aspectRatio).toBe('480 / 320');
      view.root.remove();
    }
  });

  it('cambiar la miniatura por el original no cambia el ancho (ni, con la proporción fija, el alto)', () => {
    const view = buildPrintView(photoPage(1122, 'fit-content'), { size: 'A3', landscape: false }, 'output');
    const img = view.root.querySelector<HTMLImageElement>('img.bn-visual-media')!;
    img.src = 'blob:original-2400';
    expect(wrapperOf(view).style.width).toBe('480px');
    expect(img.style.aspectRatio).toBe('480 / 320');
    view.root.remove();
  });

  it('una foto que en pantalla ya muestra la imagen nítida mide lo que su miniatura (no los 2048 px de la nítida)', () => {
    const article = photoPage(1122, 'fit-content', 2048);
    const live = article.querySelector<HTMLImageElement>('img.bn-visual-media')!;
    live.dataset.sdSharp = '480';
    live.style.setProperty('--sd-thumb-w', '480px');
    const view = buildPrintView(article, { size: 'A3', landscape: false }, 'measure');
    expect(wrapperOf(view).style.width).toBe('480px');
    expect(wrapperOf(view).style.maxWidth).toBe('100%');
    view.root.remove();
  });

  it('el ancho que le puso la persona (previewWidth, en px) se respeta, y nunca pasa del área de texto', () => {
    const view = buildPrintView(photoPage(390, '600px'), { size: 'A4', landscape: false }, 'output');
    expect(wrapperOf(view).style.width).toBe('600px');
    expect(wrapperOf(view).style.maxWidth).toBe('100%');
    view.root.remove();
  });

  it('lo que no es una foto del editor no se toca, y si no se sabe el tamaño no se fija ninguno', () => {
    const view = buildPrintView(photoPage(1122, 'fit-content', 0), { size: 'A4', landscape: false }, 'output');
    expect(wrapperOf(view).style.width).toBe('fit-content');
    const icon = view.root.querySelector<HTMLImageElement>('img.icon')!;
    expect(icon.style.width).toBe('');
    expect(icon.style.aspectRatio).toBe('');
    view.root.remove();
  });
});

describe('qué cambios recalculan las marcas', () => {
  const record = (target: Node, type: MutationRecordType, extra: Partial<MutationRecord> = {}) =>
    ({ target, type, addedNodes: [], removedNodes: [], attributeName: null, ...extra }) as unknown as MutationRecord;

  it('solo el documento en pantalla y el encabezado; no los menús, la barra, los cursores ni la selección', () => {
    document.body.innerHTML = `
      <div class="page-header"><span class="ancestor">A</span></div>
      <div class="editor-host"><div class="bn-container">
        <div class="bn-editor"><p id="p">Text</p><span class="bn-collaboration-cursor__base"><span id="c"></span></span></div>
        <div class="bn-side-menu" id="side"></div><div class="bn-formatting-toolbar" id="bar"></div>
      </div><div class="carrete" id="carrete"></div></div>`;
    const $ = (sel: string) => document.querySelector(sel)!;
    expect(isContentMutation(record($('#p').firstChild!, 'characterData'))).toBe(true);
    expect(isContentMutation(record($('#p'), 'childList'))).toBe(true);
    expect(isContentMutation(record($('#p'), 'attributes', { attributeName: 'data-level' }))).toBe(true);
    expect(isContentMutation(record($('.ancestor'), 'childList'))).toBe(true);
    for (const name of ['class', 'style', 'draggable', 'id', 'aria-selected']) {
      expect(isContentMutation(record($('#p'), 'attributes', { attributeName: name }))).toBe(false);
    }
    expect(isContentMutation(record($('#side'), 'childList'))).toBe(false);
    expect(isContentMutation(record($('#bar'), 'attributes', { attributeName: 'data-show' }))).toBe(false);
    expect(isContentMutation(record($('#carrete'), 'childList'))).toBe(false);
    expect(isContentMutation(record($('#c'), 'childList'))).toBe(false);
    // Que aparezca el documento entero sí cuenta.
    const editor = document.createElement('div');
    editor.className = 'bn-editor';
    expect(isContentMutation(record($('.bn-container'), 'childList', { addedNodes: [editor] as never }))).toBe(true);
  });
});
