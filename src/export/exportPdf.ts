import { locale, t } from '../i18n';
import '../i18n/lazy/exportPdf';
import type { PageFormat } from '../ui/pageFormat';
import { printGeometry } from '../ui/pageFormat';
import { measureUnits, paginate, SHEET_TOLERANCE_PX, type Unit } from '../ui/pagination';
import { applyBreaks, type Paginated, type PrintView } from '../ui/printView';
import { internalPageId } from '../ui/internalLinks';
import { commentsSection, type CommentSource } from './exportComments';
import { imagesLoaded, PhotoLimitError, PixelBudget, shrinkImages, workerResizer, type ImageSource, type Resizer } from './exportImages';
import { ExportCancelled, type ExportEditor } from './exportEditor';
import { renderPages, type ContentGap, type ExportedPage, type ExportPlanPage, type ExportProgress, type ExportSource } from './exportPages';
import type { PageContent } from './pageContent';

// El PDF de una rama o de un proyecto (P.22, Docs/Doc_Exportar.md, sección 2.2; entrega 1).
//
// Un solo PDF por la impresión del navegador (sin librerías de PDF, como la fase 4): una vista con el índice y todas
// las páginas una detrás de otra, cada una con su hoja ("páginas con nombre" de CSS) y los mismos cortes que marca la
// pantalla, y un solo `window.print()`. Si lo elegido pasa los topes de este dispositivo (páginas, píxeles o peso de
// las fotos), el PDF sale en partes (D84, Lega 2026-10-02): páginas enteras, en orden, *Part 1*, *Part 2*…; cada parte
// es un libro con su índice, que se arma cuando la anterior ya se guardó (así nunca hay dos en la memoria). Cada página sale del editor de exportación (exportEditor.tsx: bloques puestos
// en un editor sin colaboración, copiados con la vista de impresión y paginados); acá se le suman los avisos, los
// comentarios, los links entre páginas y las fotos achicadas, se vuelve a paginar y se junta. El índice se pagina al
// final, cuando ya se sabe cuántas hojas ocupa cada página: así el número de hoja de cada renglón es el del PDF.
// Nada de esto escribe en un documento, en el árbol, en los comentarios ni en el Drive.

type Format = Pick<PageFormat, 'size' | 'landscape'>;

/** Los topes de un PDF (o de cada parte; Docs/Doc_Exportar.md, sección 5): a ajustar con lo medido. */
export interface PdfLimits {
  /** Páginas por PDF. */
  pages: number;
  /** Píxeles decodificados de las fotos achicadas (*Smaller file*) de un PDF. */
  pixels: number;
  /** Nítidas pedidas al Drive con *Smaller file*. */
  sharp: number;
  /** Con las fotos en resolución completa (D85): sus píxeles por PDF… */
  fullPixels: number;
  /** …y su peso (bytes): un JPEG entra tal cual al PDF, así que el PDF pesa más o menos esto. */
  bytes: number;
}

/**
 * Los topes de este dispositivo: el del teléfono, o el de la computadora con el tope de píxeles según la memoria que
 * dice el navegador (`navigator.deviceMemory`, Chrome y Edge, hasta 8): con menos de 8 GB, 400 millones (el diálogo de
 * imprimir decodifica todas las fotos a la vez: 1000 millones son unos 4 GB).
 */
export function deviceLimits(touch: boolean, memoryGb: number | undefined = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { deviceMemory?: number }).deviceMemory): PdfLimits {
  if (touch) return PDF_LIMITS.touch;
  if (typeof memoryGb === 'number' && memoryGb > 0 && memoryGb < 8) return { ...PDF_LIMITS.desktop, ...SMALL_DESKTOP };
  return PDF_LIMITS.desktop;
}

/** Los topes de una computadora con menos de 8 GB. */
export const SMALL_DESKTOP = { pixels: 400_000_000, fullPixels: 800_000_000, bytes: 200_000_000 };
/** El tope de píxeles (fotos achicadas) de una computadora con menos de 8 GB. */
export const SMALL_DESKTOP_PIXELS = SMALL_DESKTOP.pixels;

export const PDF_LIMITS: { desktop: PdfLimits; touch: PdfLimits } = {
  // Medido en Chrome con la impresión real (entrega 1): 300 páginas con 2219 fotos son 882 millones de píxeles y los
  // procesos del navegador llegan a 3,3 GB mientras arma el PDF. El tope deja pasar ese proyecto y corta antes de
  // los 4 GB.
  // Con los originales (entrega 1b, medido con `page.pdf` de Chromium, Docs/Doc_Exportar.md): un JPEG entra tal cual al
  // PDF y la memoria sigue al peso, no a los píxeles. El proyecto de 300 páginas con fotos de teléfono (3,75 MB) en
  // partes de 800 MB llegó a 3 a 4,6 GB por encima de la app quieta; en partes de 400 MB, 0,9 a 2,7 GB (lo de la parte
  // anterior tarda en soltarse). 500 MB (unas 130 fotos de teléfono por parte) deja margen en una compu de 8 GB, que
  // el navegador no distingue de una de 32. El diálogo de imprimir de verdad suma la vista previa (sin medir).
  desktop: { pages: 500, pixels: 1_000_000_000, sharp: 1000, fullPixels: 2_000_000_000, bytes: 500_000_000 },
  // Teléfono o tableta: sin medir (WebKit). Unas 15 fotos de teléfono por parte.
  touch: { pages: 60, pixels: 50_000_000, sharp: 100, fullPixels: 150_000_000, bytes: 60_000_000 },
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
  /** Por qué falló: no se pudo leer o dibujar, o sus fotos solas pasan el tope de un PDF. */
  failReason?: 'error' | 'photos';
  /** Fotos que no llegaron a tiempo (pueden salir en blanco). */
  imagesTimedOut: boolean;
  /** Fotos achicadas por original no disponible, conversión limitada o página que sola pasaba el tope. */
  lowRes: number;
  /** De las anteriores, limitadas por conversión con su original disponible. */
  conversionLimited: number;
  /** Vistas de archivos representadas por marcadores en esta copia. */
  previewMarkers: number;
  /** Sus fotos solas pasaban el tope de un PDF: salieron todas achicadas (avisado arriba del título). */
  shrunkToFit: boolean;
  /** Fotos cuyo original no llegó a tiempo (la bajada pasó su tope): salieron achicadas y la página va a la lista. */
  timedOut: number;
  /** Milisegundos: leer y dibujar en el editor (por paso) y achicar las fotos (para medir). */
  ms?: ExportedPage['ms'] & { photos: number; load: number };
}

export interface PdfBook {
  /** La vista entera (en el documento, afuera de la pantalla). */
  root: HTMLElement;
  /** El nombre del PDF: el título de la raíz y la fecha (y *Part N* si sale en partes). */
  fileTitle: string;
  pages: BookPage[];
  /** Las páginas del plan que lleva este libro: de `from` a `to` (sin incluir). */
  from: number;
  to: number;
  /** Cuántas páginas tiene lo elegido entero (el plan). */
  total: number;
  /** El número de parte (1, 2…), o `null` si lo elegido entró entero en un solo PDF. */
  part: number | null;
  /** Peso de las fotos (bytes), con resolución completa. */
  bytes: number;
  /** Los originales ya traídos de la primera página de la parte siguiente (la que no entró): se pasan a esa parte. */
  carry: Map<string, Blob> | null;
  indexSheets: number;
  sheets: number;
  /** Las reglas `@page` para imprimir. */
  css: string;
  /** Cada página con su hoja (`false`: todas con la de la raíz, en este navegador). */
  named: boolean;
  /** Píxeles de fotos decodificados (ya achicados). */
  pixels: number;
  /** Páginas cuyos comentarios no se pudieron bajar (salen los del dispositivo; el índice lo dice). */
  commentsStale: number;
  /** Lo saca todo y suelta las imágenes. */
  destroy(): void;
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
  /** Las fotos en resolución completa (D85: lo de siempre); `false` con *Smaller file*. */
  full?: boolean;
  /** Pasa un HEIC a JPEG (el convertidor de la app), para su original donde el navegador no lo abre. */
  convertHeic?: ((blob: Blob) => Promise<Blob>) | null;
  /** Cuánto se espera a que carguen las fotos cambiadas de cada página (las pruebas, sin cargar imágenes: 0). */
  photoLoadMs?: number;
  /** Los originales que dejó la parte anterior (`PdfBook.carry`): no se vuelven a bajar. */
  carry?: Map<string, Blob> | null;
  /** Píxeles que se pueden estar convirtiendo a la vez (`DECODE_PIXELS`; las pruebas lo achican). */
  decodePixels?: number;
  /** El tope de tiempo de cada bajada de un original (`ORIGINAL_TIMEOUT_MS`; las pruebas lo achican). */
  downloadMs?: number;
  /** Desde qué página del plan arranca este libro (el PDF en partes: donde terminó la parte anterior). */
  from?: number;
  /** El número de esta parte (1 la primera). */
  part?: number;
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

/** Los links internos del libro a una página que quedó en otra parte del PDF: solo su texto. */
export function unlinkOutside(root: HTMLElement, included: ReadonlySet<string>): void {
  for (const a of root.querySelectorAll<HTMLAnchorElement>(`a[href^="#${ANCHOR_PREFIX}"]`)) {
    const id = (a.getAttribute('href') ?? '').slice(1 + ANCHOR_PREFIX.length);
    if (id !== 'index' && !included.has(id)) a.replaceWith(...a.childNodes);
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
 * Arma la vista del PDF: el índice y cada página con su hoja, paginadas, desde la página `from` del plan hasta llenar
 * un tope (páginas, píxeles o peso de las fotos). Si no entró todo, el libro es una parte (`part`) y `to` dice dónde
 * sigue la próxima; una página nunca se parte. Tira `ExportCancelled` al cancelar, sin dejar nada en el documento.
 */
export async function buildPdf(options: BuildOptions): Promise<PdfBook> {
  const now = options.now ?? new Date();
  const from = Math.max(0, Math.min(options.from ?? 0, options.plan.length));
  // Donde el diálogo no respeta cada hoja, todas con la de la raíz, y se pagina con esa (así el índice es cierto).
  const rootFormat: Format = options.plan[0]?.format ?? { size: 'A4', landscape: false };
  const whole = options.named ? options.plan : options.plan.map((p) => ({ ...p, format: rootFormat }));
  // Esta parte: como mucho el tope de páginas; las fotos pueden cortarla antes.
  const plan = whole.slice(from, from + Math.max(1, options.limits.pages));
  const inside = new Set(whole.map((p) => p.id));
  const book = el('div', 'print-output sd-export-book');
  book.setAttribute('aria-hidden', 'true');
  document.body.append(book);
  const urls: string[] = [];
  const full = options.full === true && !!options.images?.original;
  const budget = new PixelBudget(full ? options.limits.fullPixels : options.limits.pixels, full ? options.limits.bytes : Infinity);
  // Las fotos se achican en Workers (fuera del hilo de la pantalla), salvo que se pase otro achicador (las pruebas).
  const pool = options.resizer ? null : workerResizer();
  const resizer = options.resizer ?? pool!;
  const pages: BookPage[] = [];
  /** Las vistas armadas (en la del PDF o todavía sueltas): se sacan todas si algo falla o al cerrar. */
  const views = new Set<PrintView>();
  const destroy = () => {
    book.remove();
    for (const v of views) v.root.remove();
    for (const url of urls) URL.revokeObjectURL(url);
  };
  const drop = (view: PrintView) => {
    view.root.remove();
    views.delete(view);
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

  /** Una página que no se pudo armar: su título y el aviso, en su lugar. */
  const placeFailed = (page: ExportPlanPage, reason: 'error' | 'photos') => {
    const view = plainView(page.format, 'sd-export-failed');
    views.add(view);
    view.page.append(el('h1', 'page-title', page.title.trim() || t('common.untitled')));
    noteLine(view, t(reason === 'photos' ? 'exportPdf.failedPhotos' : 'exportPdf.failedPage'));
    place(view, page, { outdated: false, unknown: false, failed: true, failReason: reason, imagesTimedOut: false, lowRes: 0, conversionLimited: 0, previewMarkers: 0, shrunkToFit: false, timedOut: 0 });
  };

  /** Con el progreso de lo elegido entero (no el de esta parte). */
  const progress = (p: ExportProgress) => options.onProgress?.({ ...p, done: p.done + from, total: whole.length });

  try {
    // Los comentarios de los demás, al día (con red): antes de dibujar, con su propio avance. Con el PDF en partes, la
    // primera baja todo lo que falta y las siguientes no vuelven a pedir lo ya bajado.
    let commentsStale = 0;
    if (options.comments?.prepare) {
      const rest = whole.slice(from).map((p) => p.id);
      commentsStale = await options.comments.prepare(rest, {
        signal: options.signal,
        onProgress: (done, total) => options.onProgress?.({ done, total, title: '', step: 'comments' }),
      });
      if (options.signal?.aborted) throw new ExportCancelled();
    }
    let to = from + plan.length;
    let carry: Map<string, Blob> | null = null;
    await renderPages(plan, options.source, options.editor, {
      signal: options.signal,
      onProgress: progress,
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
        // Lo que le queda a esta parte (a la primera página de una parte, el tope entero).
        const first = pages.length === 0;
        const own = new PixelBudget(first ? budget.limit : budget.limit - budget.used, first ? budget.byteLimit : budget.byteLimit - budget.bytes);
        const shrinkWith = (b: PixelBudget, fullSize: boolean) =>
          shrinkImages(view.root, {
            source: options.images,
            budget: b,
            resizer,
            signal: options.signal,
            full: fullSize,
            convertHeic: options.convertHeic,
            carry: options.carry,
            decodePixels: options.decodePixels,
            downloadMs: options.downloadMs,
          });
        let shrunk: Awaited<ReturnType<typeof shrinkImages>>;
        let shrunkToFit = false;
        try {
          shrunk = await shrinkWith(own, full);
        } catch (err) {
          if (!(err instanceof PhotoLimitError)) throw err;
          if (!first) {
            // No entra en esta parte: va primera en la siguiente (se vuelve a dibujar ahí).
            to = from + plan.indexOf(page);
            carry = err.fetched && err.fetched.size > 0 ? err.fetched : null;
            drop(view);
            return 'stop';
          }
          // Sola no entra en un PDF: con las fotos achicadas, avisado; y si ni así, se saltea marcada.
          try {
            if (!full) throw err;
            const small = new PixelBudget(options.limits.pixels);
            shrunk = await shrinkWith(small, false);
            own.used = small.used;
            own.bytes = 0;
            shrunkToFit = true;
            noteLine(view, t('exportPdf.shrunkToFit'));
          } catch (again) {
            if (!(again instanceof PhotoLimitError)) throw again;
            drop(view);
            placeFailed(page, 'photos');
            return;
          }
        }
        budget.used += own.used;
        budget.bytes += own.bytes;
        urls.push(...shrunk.urls);
        const t1 = performance.now();
        if (shrunk.shrunk + shrunk.full > 0) await imagesLoaded(view.root, options.photoLoadMs ?? 6000);
        const ms = { ...out.ms, photos: t1 - t0, load: performance.now() - t1, ...Object.fromEntries(Object.entries(shrunk.ms).map(([k, v]) => [`photo_${k}`, v])) };
        const lowRes = shrunkToFit ? shrunk.shrunk + shrunk.kept : shrunk.lowRes;
        place(view, page, { outdated, unknown, failed: false, imagesTimedOut: out.imagesTimedOut, lowRes, conversionLimited: shrunk.conversionLimited, previewMarkers: shrunk.previewMarkers, shrunkToFit, timedOut: shrunk.timedOut, ms });
      },
      onFailed: (page) => placeFailed(page, 'error'),
    });
    if (options.signal?.aborted) throw new ExportCancelled();
    const done = to >= whole.length;
    const part = options.part && options.part > 1 ? options.part : done ? null : 1;
    const included = new Set(pages.map((p) => p.id));
    if (options.comments?.stale) commentsStale = [...included].filter((id) => options.comments!.stale!(id)).length;

    // El índice: se pagina con la hoja de la raíz y recién ahí se escriben los números.
    const index = plainView(rootFormat, 'sd-export-index');
    views.add(index);
    const head = el('div', 'sd-export-index-head sd-export-unit');
    // Sin la clase `page-title`: el encabezado entero es una sola unidad de la paginación.
    head.append(el('h1', 'sd-export-index-title', options.title.trim() || t('common.untitled')));
    if (part !== null) {
      head.append(el('p', 'sd-export-index-part', t('exportPdf.part', { part, first: from + 1, last: to, total: whole.length })));
    }
    const asOf = options.lastSync ? t('exportPdf.asOf', { date: formatDate(options.lastSync, true) }) : null;
    head.append(el('p', 'sd-export-index-meta', [t('exportPdf.exported', { date: formatDate(now, false) }), asOf].filter(Boolean).join(' · ')));
    if (commentsStale > 0) {
      const at = options.lastSync ?? now.getTime();
      head.append(el('p', 'sd-export-index-meta', t('exportPdf.commentsAsOf', { date: formatDate(at, true) })));
    }
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
    // Un link a una página de otra parte no tiene destino en este PDF: queda como texto.
    unlinkOutside(book, included);

    const name = `${options.title.trim() || t('common.untitled')} ${isoDay(now)}`;
    return {
      root: book,
      fileTitle: part === null ? name : `${name} ${t('exportPdf.partName', { part })}`,
      pages,
      from,
      to,
      total: whole.length,
      part,
      indexSheets,
      sheets: next - 1,
      css: pageRules([rootFormat, ...pages.map((p) => p.format)], options.named),
      named: options.named,
      pixels: budget.used,
      bytes: budget.bytes,
      carry,
      commentsStale,
      destroy,
    };
  } catch (err) {
    destroy();
    throw err;
  } finally {
    pool?.dispose();
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
  // `sd-export-printing`: solo así se imprime el libro (styles.css); el Imprimir del navegador mientras la ventana
  // arma o tiene el PDF listo imprime la página de siempre, sin el libro encima.
  html.classList.add('sd-printing', 'sd-export-printing');
  book.root.removeAttribute('aria-hidden');
  const titleBefore = document.title;
  document.title = book.fileTitle;
  let printedAt = 0;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    style.remove();
    html.classList.remove('sd-printing', 'sd-export-printing');
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
