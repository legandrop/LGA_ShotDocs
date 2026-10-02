import { locale, t } from '../i18n';
import '../i18n/lazy/exportPdf';
import type { PageFormat } from '../ui/pageFormat';
import { printGeometry } from '../ui/pageFormat';
import { measureUnits, paginate, SHEET_TOLERANCE_PX, type Unit } from '../ui/pagination';
import { applyBreaks, type Paginated, type PrintView } from '../ui/printView';
import { internalPageId } from '../ui/internalLinks';
import { commentsSection, type CommentSource } from './exportComments';
import { imagesLoaded, PixelBudget, shrinkImages, type ImageSource, type Resizer } from './exportImages';
import type { ExportEditor } from './exportEditor';
import { renderPages, type ContentGap, type ExportedPage, type ExportPlanPage, type ExportProgress, type ExportSource } from './exportPages';
import type { PageContent } from './pageContent';

// El PDF de una rama o de un proyecto (P.22, Docs/Doc_Exportar.md, sección 2.2; entrega 1).
//
// Un solo PDF por la impresión del navegador (sin librerías de PDF, como la fase 4): una vista con el índice y todas
// las páginas una detrás de otra, cada una con su hoja ("páginas con nombre" de CSS) y los mismos cortes que marca la
// pantalla, y un solo `window.print()`. Cada página sale del editor de exportación (exportEditor.tsx: bloques puestos
// en un editor sin colaboración, copiados con la vista de impresión y paginados); acá se le suman los avisos, los
// comentarios, los links entre páginas y las fotos achicadas, se vuelve a paginar y se junta. El índice se pagina al
// final, cuando ya se sabe cuántas hojas ocupa cada página: así el número de hoja de cada renglón es el del PDF.
// Nada de esto escribe en un documento, en el árbol, en los comentarios ni en el Drive.

type Format = Pick<PageFormat, 'size' | 'landscape'>;

/** Los topes de un PDF (Docs/Doc_Exportar.md, sección 5): a ajustar con lo medido. */
export interface PdfLimits {
  /** Páginas por PDF. */
  pages: number;
  /** Píxeles decodificados de las fotos (ya achicadas) de todo el PDF. */
  pixels: number;
  /** Nítidas pedidas al Drive con *Sharp photos*. */
  sharp: number;
}

export const PDF_LIMITS: { desktop: PdfLimits; touch: PdfLimits } = {
  // Medido en Chrome con la impresión real (entrega 1): 300 páginas con 2219 fotos son 882 millones de píxeles y los
  // procesos del navegador llegan a 3,3 GB mientras arma el PDF. El tope deja pasar ese proyecto y corta antes de
  // los 4 GB.
  desktop: { pages: 500, pixels: 1_000_000_000, sharp: 1000 },
  touch: { pages: 60, pixels: 50_000_000, sharp: 100 },
};

/** El prefijo del id de cada página en la vista (destino de los links internos del PDF). */
export const ANCHOR_PREFIX = 'sd-x-';
export const anchorId = (pageId: string) => `${ANCHOR_PREFIX}${pageId}`;

/** El nombre de la página de CSS de una hoja (`@page sd-A4-l { … }`). */
export function sheetName(format: Format): string {
  const size = format.size === 'free' ? 'A4' : format.size;
  return `sd-${size}${format.size !== 'free' && format.landscape ? '-l' : ''}`;
}

/** Las reglas `@page` de las hojas usadas (con nombre, o una sola sin nombre). */
export function pageRules(formats: readonly Format[], named: boolean): string {
  const seen = new Map<string, Format>();
  for (const f of formats) seen.set(sheetName(f), f);
  const rule = (f: Format) => {
    const g = printGeometry(f);
    return `size: ${g.widthMm}mm ${g.heightMm}mm; margin: ${g.marginMm}mm;`;
  };
  if (!named) return `@page { ${rule(formats[0] ?? { size: 'A4', landscape: false })} }`;
  return [...seen].map(([name, f]) => `@page ${name} { ${rule(f)} }`).join('\n');
}

/** Una página del PDF. */
export interface BookPage {
  id: string;
  title: string;
  depth: number;
  format: Format;
  /** La hoja del PDF donde empieza (1 es la primera del índice). */
  start: number;
  sheets: number;
  /** Los avisos de la página (también impresos arriba de su título). */
  outdated: boolean;
  unknown: boolean;
  failed: boolean;
  /** Fotos que no llegaron a tiempo (pueden salir en blanco). */
  imagesTimedOut: boolean;
  /** Milisegundos: leer y dibujar en el editor (por paso) y achicar las fotos (para medir). */
  ms?: ExportedPage['ms'] & { photos: number; load: number };
}

export interface PdfBook {
  /** La vista entera (en el documento, afuera de la pantalla). */
  root: HTMLElement;
  /** El nombre del PDF: el título de la raíz y la fecha. */
  fileTitle: string;
  pages: BookPage[];
  indexSheets: number;
  sheets: number;
  /** Las reglas `@page` para imprimir. */
  css: string;
  /** Cada página con su hoja (`false`: todas con la de la raíz, en este navegador). */
  named: boolean;
  /** Píxeles de fotos decodificados (ya achicados). */
  pixels: number;
  /** Lo saca todo y suelta las imágenes. */
  destroy(): void;
}

/** Se superó el tope de páginas: la ventana lo dice antes de empezar. */
export class PageLimitError extends Error {
  constructor(readonly pages: number, readonly limit: number) {
    super('Too many pages for one PDF');
    this.name = 'PageLimitError';
  }
}

export interface BuildOptions {
  /** El título de la raíz de lo exportado (el proyecto, o la página raíz de la rama: nunca nada de arriba). */
  title: string;
  plan: ExportPlanPage[];
  source: ExportSource;
  editor: ExportEditor;
  /** Lo que le falta a cada página en este dispositivo (sale con un aviso). */
  gap?: (pageId: string) => ContentGap;
  /** De dónde sale la mejor imagen de cada foto (sin esto, la que se ve, achicada igual). */
  images?: ImageSource | null;
  resizer?: Resizer;
  /** Con la casilla *Comments*. */
  comments?: CommentSource | null;
  /** Cada página con su hoja (`keepsPageSizes`); si no, todas con la de la raíz. */
  named: boolean;
  limits: PdfLimits;
  /** La fecha de la exportación y la de la última sincronización del dispositivo (o `null`). */
  now?: Date;
  lastSync?: number | null;
  signal?: AbortSignal;
  onProgress?: (p: ExportProgress) => void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Mide y pagina una vista con lo que se le sumó: las unidades de siempre (encabezado, título, bloques) y las de la
 * exportación (`.sd-export-unit`: avisos, comentarios, renglones del índice), en el orden en que aparecen.
 */
export function paginateExport(view: Pick<PrintView, 'page' | 'geometry'>): Paginated {
  const { contentHeight } = view.geometry;
  const sheetHeight = contentHeight - SHEET_TOLERANCE_PX;
  const measured = measureUnits(view.page, sheetHeight);
  const origin = view.page.getBoundingClientRect().top;
  const extra: { unit: Unit; el: HTMLElement }[] = [];
  view.page.querySelectorAll<HTMLElement>('.sd-export-unit').forEach((node, i) => {
    const r = node.getBoundingClientRect();
    const marginTop = parseFloat(getComputedStyle(node).marginTop) || 0;
    extra.push({ unit: { key: `x:${i}`, top: r.top - origin - marginTop, height: r.height + marginTop }, el: node });
  });
  const all = measured.units.map((unit, i) => ({ unit, el: measured.elements[i], members: measured.members?.[i] ?? [measured.elements[i]] }));
  for (const x of extra) if (x.unit.height > 0) all.push({ ...x, members: [x.el] });
  // En el orden del documento (un aviso va arriba del título; los comentarios, al final). Nunca por la altura: un
  // salto de hoja vacío no se dibuja (mide 0 y queda arriba de todo) y ordenado por altura cortaría la primera hoja.
  all.sort((a, b) => (a.el === b.el ? 0 : a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const units = all.map((a) => a.unit);
  return {
    units,
    elements: all.map((a) => a.el),
    members: all.map((a) => a.members),
    pagination: paginate(units, contentHeight, SHEET_TOLERANCE_PX),
    sheetHeight,
  };
}

/** Una vista mínima (el índice, o una página que no se pudo dibujar), con las clases de la vista de impresión. */
function plainView(format: Format, className: string): PrintView {
  const geometry = printGeometry(format);
  const root = el('div', `print-view print-output ${className}`);
  root.setAttribute('aria-hidden', 'true');
  root.dataset.format = format.size;
  root.style.setProperty('--print-content-width', `${geometry.contentWidth}px`);
  root.style.setProperty('--print-content-height', `${geometry.contentHeight}px`);
  const page = el('div', 'print-page');
  root.append(page);
  document.body.append(root);
  return { root, geometry, page };
}

/** Los links de la vista: a una página del PDF, link interno; a otra (afuera o sin acceso), solo su texto. */
export function rewriteLinks(root: HTMLElement, inside: ReadonlySet<string>): void {
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = a.getAttribute('href') ?? '';
    // Nunca un link que ejecute algo.
    if (/^\s*javascript:/i.test(href)) {
      a.replaceWith(...a.childNodes);
      continue;
    }
    const id = internalPageId(href);
    if (!id) continue;
    if (inside.has(id)) a.setAttribute('href', `#${anchorId(id)}`);
    else a.replaceWith(...a.childNodes);
  }
}

/** La línea de aviso arriba del título de una página. */
function noteLine(view: PrintView, text: string): void {
  const note = el('p', 'sd-export-note sd-export-unit', text);
  const title = view.page.querySelector('.page-title');
  view.page.insertBefore(note, title);
}

function formatDate(at: Date | number, withTime: boolean): string {
  return new Intl.DateTimeFormat(locale(), withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(at);
}

/** `2026-10-02` (el nombre del PDF). */
function isoDay(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/**
 * Arma la vista del PDF: el índice y cada página con su hoja, paginadas. Tira `PageLimitError` antes de empezar si
 * son demasiadas páginas, `PhotoLimitError` si las fotos pasan el tope de píxeles, y `ExportCancelled` al cancelar;
 * en los tres casos no deja nada en el documento.
 */
export async function buildPdf(options: BuildOptions): Promise<PdfBook> {
  const now = options.now ?? new Date();
  if (options.plan.length > options.limits.pages) throw new PageLimitError(options.plan.length, options.limits.pages);
  // Donde el diálogo no respeta cada hoja, todas con la de la raíz, y se pagina con esa (así el índice es cierto).
  const rootFormat: Format = options.plan[0]?.format ?? { size: 'A4', landscape: false };
  const plan = options.named ? options.plan : options.plan.map((p) => ({ ...p, format: rootFormat }));
  const inside = new Set(plan.map((p) => p.id));
  const book = el('div', 'print-output sd-export-book');
  book.setAttribute('aria-hidden', 'true');
  document.body.append(book);
  const urls: string[] = [];
  const budget = new PixelBudget(options.limits.pixels);
  const pages: BookPage[] = [];
  /** Las vistas armadas (en la del PDF o todavía sueltas): se sacan todas si algo falla o al cerrar. */
  const views = new Set<PrintView>();
  const destroy = () => {
    book.remove();
    for (const v of views) v.root.remove();
    for (const url of urls) URL.revokeObjectURL(url);
  };

  /** Deja una página paginada en la vista del PDF. */
  const place = (view: PrintView, page: ExportPlanPage, info: Omit<BookPage, 'id' | 'title' | 'depth' | 'format' | 'start' | 'sheets'>) => {
    const result = paginateExport(view);
    applyBreaks(result);
    view.root.id = anchorId(page.id);
    if (options.named) view.root.style.setProperty('page', sheetName(page.format));
    book.append(view.root);
    views.add(view);
    pages.push({ id: page.id, title: page.title, depth: page.depth, format: page.format, start: 0, sheets: result.pagination.sheets, ...info });
  };

  try {
    await renderPages(plan, options.source, options.editor, {
      signal: options.signal,
      onProgress: options.onProgress,
      onPage: async (rendered, content: PageContent, page, out: ExportedPage) => {
        const view = rendered.view;
        views.add(view);
        const gap = options.gap?.(page.id) ?? null;
        const outdated = gap !== null || out.unreadable;
        const unknown = content.unknown !== null;
        if (outdated) noteLine(view, t('exportPdf.outdated'));
        if (unknown) noteLine(view, t('exportPdf.unknown'));
        rewriteLinks(view.root, inside);
        if (options.comments) {
          const section = commentsSection(await options.comments.threads(page.id), content.blocks, options.comments);
          if (section) view.page.append(section);
        }
        const t0 = performance.now();
        const shrunk = await shrinkImages(view.root, { source: options.images, budget, resizer: options.resizer, signal: options.signal });
        urls.push(...shrunk.urls);
        const t1 = performance.now();
        if (shrunk.shrunk > 0) await imagesLoaded(view.root, 6000);
        const ms = { ...out.ms, photos: t1 - t0, load: performance.now() - t1, ...Object.fromEntries(Object.entries(shrunk.ms).map(([k, v]) => [`photo_${k}`, v])) };
        place(view, page, { outdated, unknown, failed: false, imagesTimedOut: out.imagesTimedOut, ms });
      },
      onFailed: (page) => {
        const view = plainView(page.format, 'sd-export-failed');
        views.add(view);
        view.page.append(el('h1', 'page-title', page.title.trim() || t('common.untitled')));
        noteLine(view, t('exportPdf.failedPage'));
        place(view, page, { outdated: false, unknown: false, failed: true, imagesTimedOut: false });
      },
    });

    // El índice: se pagina con la hoja de la raíz y recién ahí se escriben los números.
    const index = plainView(rootFormat, 'sd-export-index');
    views.add(index);
    const head = el('div', 'sd-export-index-head sd-export-unit');
    // Sin la clase `page-title`: el encabezado entero es una sola unidad de la paginación.
    head.append(el('h1', 'sd-export-index-title', options.title.trim() || t('common.untitled')));
    const asOf = options.lastSync ? t('exportPdf.asOf', { date: formatDate(options.lastSync, true) }) : null;
    head.append(el('p', 'sd-export-index-meta', [t('exportPdf.exported', { date: formatDate(now, false) }), asOf].filter(Boolean).join(' · ')));
    head.append(el('h2', 'sd-export-index-label', t('exportPdf.contents')));
    index.page.append(head);
    const numbers: HTMLElement[] = [];
    for (const p of pages) {
      const row = el('a', 'sd-export-row sd-export-unit');
      row.setAttribute('href', `#${anchorId(p.id)}`);
      row.style.setProperty('--depth', String(p.depth));
      row.append(el('span', 'sd-export-row-title', p.title.trim() || t('common.untitled')));
      const n = el('span', 'sd-export-row-sheet');
      numbers.push(n);
      row.append(n);
      index.page.append(row);
    }
    const indexResult = paginateExport(index);
    applyBreaks(indexResult);
    const indexSheets = indexResult.pagination.sheets;
    let next = indexSheets + 1;
    pages.forEach((p, i) => {
      p.start = next;
      next += p.sheets;
      numbers[i].textContent = String(p.start);
    });
    index.root.id = 'sd-x-index';
    if (options.named) index.root.style.setProperty('page', sheetName(rootFormat));
    book.prepend(index.root);

    return {
      root: book,
      fileTitle: `${options.title.trim() || t('common.untitled')} ${isoDay(now)}`,
      pages,
      indexSheets,
      sheets: next - 1,
      css: pageRules([rootFormat, ...pages.map((p) => p.format)], options.named),
      named: options.named,
      pixels: budget.used,
      destroy,
    };
  } catch (err) {
    destroy();
    throw err;
  }
}

// --- Imprimir -------------------------------------------------------------------------------------------------

/** En un táctil, un `afterprint` que llega antes de esto no es el cierre del diálogo (Safari del iPhone). */
const EARLY_AFTERPRINT_MS = 1000;

/**
 * Abre el diálogo de imprimir con la vista del PDF: pone las hojas (`@page`), deja visible solo la vista (la clase
 * `sd-printing` de styles.css, la misma de la impresión de una página) y el nombre del PDF. Al cerrar el diálogo deja
 * todo como estaba (la vista sigue armada: se puede volver a abrir). Devuelve cómo deshacerlo a mano.
 */
export function printBook(book: PdfBook, options: { touch?: boolean; print?: () => void; onDone?: () => void } = {}): () => void {
  const style = document.createElement('style');
  style.dataset.sdExport = '';
  style.textContent = book.css;
  document.head.append(style);
  const html = document.documentElement;
  html.classList.add('sd-printing');
  book.root.removeAttribute('aria-hidden');
  const titleBefore = document.title;
  document.title = book.fileTitle;
  let printedAt = 0;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    style.remove();
    html.classList.remove('sd-printing');
    book.root.setAttribute('aria-hidden', 'true');
    if (document.title === book.fileTitle) document.title = titleBefore;
    window.removeEventListener('afterprint', onAfter);
    window.removeEventListener('pointerdown', later, true);
    window.removeEventListener('keydown', later, true);
    options.onDone?.();
  };
  const onAfter = () => {
    // Safari del iPhone avisa `afterprint` apenas abre el diálogo: ahí limpia el primer toque (`later`).
    if (options.touch && printedAt && performance.now() - printedAt < EARLY_AFTERPRINT_MS) return;
    finish();
  };
  const later = () => {
    if (printedAt) finish();
  };
  window.addEventListener('afterprint', onAfter);
  window.addEventListener('pointerdown', later, true);
  window.addEventListener('keydown', later, true);
  printedAt = performance.now();
  try {
    (options.print ?? (() => window.print()))();
  } catch {
    finish();
    throw new Error('print dialog failed');
  }
  return finish;
}
