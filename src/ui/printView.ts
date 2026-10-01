import { t } from '../i18n';
import { thumbSize } from './sharpMarks';
import type { PageFormat, PrintGeometry } from './pageFormat';
import { printGeometry } from './pageFormat';
import { measureUnits, paginate, SHEET_TOLERANCE_PX, type Measured, type Pagination } from './pagination';

// La vista de impresión (roadmap B.7, Docs/Doc_Hojas_PDF.md).
//
// Una copia de lo que se ve de la página (encabezado, título y el contenido del editor), armada afuera
// del editor con el ancho real del área de texto de la hoja y los estilos del PDF (`.print-view` en
// styles.css, que valen igual en pantalla y al imprimir). Sirve para dos cosas:
// - Medir: las marcas de hoja en pantalla salen de medir esta vista (SheetBreaks.tsx), también en el
//   teléfono, donde la página se ve más angosta.
// - Imprimir: la misma vista, con los saltos calculados, es lo único que se imprime (`window.print()`).
//
// Es una copia del DOM: nunca toca el editor ni el documento (el Y.Doc no cambia al paginar ni al
// imprimir; lo prueba pagination.test.ts). Se copia solo el documento en pantalla (`.bn-editor`), no el
// contenedor del editor, que también tiene las barras y menús flotantes; y de la copia se saca lo que en
// papel no sirve: los tiradores, el reproductor de las tarjetas de Drive (queda el link), los cursores y
// las selecciones.

/** Lo que se saca de la copia. */
const REMOVE = [
  'iframe',
  'audio',
  '.drive-card-frame',
  '.drive-card-hint',
  '.drive-card-actions',
  '.drive-card-shield',
  '.bn-side-menu',
  '.bn-drag-handle-menu',
  '.bn-resize-handle',
  // Los tiradores de la foto en línea (inlinePhoto.ts).
  '.sd-photo-handle',
  '.bn-add-file-button',
  '.bn-file-loading-preview',
  '.bn-collaboration-cursor__base',
  '.ProseMirror-yjs-cursor',
  '.ProseMirror-gapcursor',
  '.comment-margin',
  // La barra de buscar y reemplazar (Docs/Doc_Buscar.md).
  '.find-anchor',
  // El espacio para tocar y agregar un bloque al final: en la última hoja podría sumar una hoja vacía.
  '.bn-trailing-block',
].join(',');

/**
 * Clases de estado del editor que no van en papel. También las de colapsar (P.11, Docs/Doc_Colapsar.md): la
 * vista se mide y se imprime con todo abierto, así las marcas de hoja cuentan todo y coinciden con el PDF.
 */
const STATE_CLASSES = [
  'ProseMirror-selectednode',
  'ProseMirror-focused',
  'comment-flash',
  'ProseMirror-yjs-selection',
  'sd-collapsed',
  'sd-collapsed-hidden',
  // Lo resaltado por la búsqueda en la página (findEditor.ts).
  'sd-find-hit',
  'sd-find-current',
  'sd-find-block',
  'sd-find-block-current',
  // Una foto en línea dentro de una selección de texto (inlinePhotoEditor.ts).
  'sd-photo-in-range',
];
/** Atributos de colapsar que tampoco van en la copia. */
const STATE_ATTRIBUTES = ['data-sd-collapsed', 'data-sd-hider'];

export interface PrintView {
  root: HTMLElement;
  geometry: PrintGeometry;
  /** Lo que se dibuja: encabezado, título y editor, desde el comienzo del área de texto. */
  page: HTMLElement;
}

/** La página abierta en pantalla (`<article class="page" data-page-id>`), o `null`. */
export function findPageArticle(pageId: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>('article.page[data-page-id]')) {
    if (el.dataset.pageId === pageId) return el;
  }
  return null;
}

/**
 * Arma la vista de `article` (la página en pantalla) y la agrega al documento, afuera de la pantalla
 * (`kind`: `measure` para las marcas, `output` para imprimir). Quien la pide la saca con `root.remove()`.
 */
export function buildPrintView(
  article: HTMLElement,
  format: Pick<PageFormat, 'size' | 'landscape'>,
  kind: 'measure' | 'output',
  options: { asSeen?: boolean } = {},
): PrintView {
  const geometry = printGeometry(format);
  const root = document.createElement('div');
  root.className = `print-view print-${kind}`;
  root.setAttribute('aria-hidden', 'true');
  root.dataset.format = format.size;
  root.style.setProperty('--print-content-width', `${geometry.contentWidth}px`);
  root.style.setProperty('--print-content-height', `${geometry.contentHeight}px`);
  const page = document.createElement('div');
  page.className = 'print-page';
  root.append(page);

  // El encabezado con los contenedores, si se ve alguno (sin el botón de opciones).
  const header = article.querySelector<HTMLElement>('.page-header');
  if (header?.querySelector('.ancestor')) {
    const copy = document.createElement('div');
    copy.className = 'page-header';
    for (const node of header.querySelectorAll('.ancestor, .dot')) {
      const span = document.createElement('span');
      span.className = node.className;
      span.textContent = node.textContent;
      copy.append(span);
    }
    page.append(copy);
  }

  // El título (en pantalla es un campo de texto: su valor no se copia con el DOM).
  const titleField = article.querySelector<HTMLTextAreaElement | HTMLElement>('.page-title');
  const title = document.createElement('h1');
  title.className = 'page-title';
  title.textContent =
    (titleField && 'value' in titleField ? titleField.value : titleField?.textContent)?.trim() || t('common.untitled');
  page.append(title);

  // El contenido del editor: el documento en un contenedor vacío con las clases del de pantalla (sus
  // estilos) y en claro.
  const container = article.querySelector<HTMLElement>('.editor-host .bn-container');
  const live =
    container?.querySelector<HTMLElement>('.bn-editor') ?? article.querySelector<HTMLElement>('.editor-host .bn-editor');
  if (live) {
    const host = document.createElement('div');
    host.className = 'editor-host';
    const shell = document.createElement('div');
    shell.className = container?.className ?? 'bn-container';
    shell.setAttribute('data-color-scheme', 'light');
    shell.setAttribute('data-mantine-color-scheme', 'light');
    const copy = live.cloneNode(true) as HTMLElement;
    cleanCopy(copy, live, kind === 'output' && !!options.asSeen);
    shell.append(copy);
    host.append(shell);
    page.append(host);
  }

  document.body.append(root);
  try {
    fitWideTables(root, geometry.contentWidth);
  } catch (err) {
    root.remove();
    throw err;
  }
  return { root, geometry, page };
}

/**
 * Saca de la copia lo que no va en papel, antes de agregarla al documento (así un iframe no carga).
 */
function cleanCopy(copy: HTMLElement, live: HTMLElement, asSeen = false): void {
  // Las imágenes con la proporción que ya tienen en pantalla (emparejadas antes de sacar nada): la copia
  // mide bien aunque no haya terminado de cargar.
  const liveImages = live.querySelectorAll('img');
  copy.querySelectorAll('img').forEach((img, i) => {
    const source = liveImages[i];
    img.loading = 'eager';
    img.removeAttribute('srcset');
    // Con la imagen nítida puesta (sharpImages.ts), las medidas de su miniatura: el mismo alto en todos lados.
    const natural = source ? thumbSize(source) : null;
    if (natural && natural.width > 0 && natural.height > 0) {
      img.style.aspectRatio = `${natural.width} / ${natural.height}`;
    }
    // Una foto en fila (con `rowWidth`) ya tiene su ancho: la parte de la fila, igual en cualquier pantalla.
    if (source && img.classList.contains('bn-visual-media') && !img.closest('.img-sized')) fixMediaWidth(img, source);
    // Una foto en línea sin ancho propio (`w = 0`, Docs/Doc_Fotos_En_Linea.md): el ancho natural de lo que se ve
    // en pantalla (la miniatura), con tope en el renglón (styles.css). Con ancho propio, su parte del renglón.
    const inline = img.parentElement?.classList.contains('sd-photo') ? img.parentElement : null;
    if (inline && !inline.classList.contains('sd-photo-sized') && natural && natural.width > 0) img.style.width = `${natural.width}px`;
  });
  for (const el of copy.querySelectorAll(REMOVE)) el.remove();
  // "Imprimir como se ve": sin lo que esconde un título colapsado (los bloques de afuera y sus hijos). Las
  // clases solas no alcanzan: más abajo se sacan para que el resto salga abierto.
  if (asSeen) {
    for (const el of copy.querySelectorAll('.bn-block-content.sd-collapsed-hidden')) el.closest('.bn-block-outer')?.remove();
    for (const el of copy.querySelectorAll('.bn-block-content.sd-collapsed')) el.parentElement?.querySelector(':scope > .bn-block-group')?.remove();
  }
  for (const el of [copy, ...copy.querySelectorAll<HTMLElement>('[contenteditable]')]) el.removeAttribute('contenteditable');
  // Sin ids repetidos en la página.
  for (const el of [copy, ...copy.querySelectorAll<HTMLElement>('[id]')]) el.removeAttribute('id');
  // La selección de otra persona (un fondo de color en el texto).
  for (const el of copy.querySelectorAll<HTMLElement>('.ProseMirror-yjs-selection')) el.style.removeProperty('background-color');
  for (const cls of STATE_CLASSES) {
    for (const el of copy.querySelectorAll(`.${cls}`)) el.classList.remove(cls);
  }
  for (const attr of STATE_ATTRIBUTES) {
    for (const el of copy.querySelectorAll(`[${attr}]`)) el.removeAttribute(attr);
  }
  // Siempre en claro: el papel es blanco.
  for (const el of copy.querySelectorAll<HTMLElement>('[data-color-scheme], [data-mantine-color-scheme]')) {
    if (el.hasAttribute('data-color-scheme')) el.setAttribute('data-color-scheme', 'light');
    if (el.hasAttribute('data-mantine-color-scheme')) el.setAttribute('data-mantine-color-scheme', 'light');
  }
  // Un video queda con su cuadro (la miniatura con la marca de "play" que muestra el editor).
  for (const video of copy.querySelectorAll('video')) {
    const img = document.createElement('img');
    img.className = video.className;
    if (video.poster) img.src = video.poster;
    img.alt = '';
    video.replaceWith(img);
  }
}

/**
 * Las fotos y videos del editor con un ancho fijo, el mismo en cualquier pantalla: el que le puso la persona
 * (`previewWidth`, en px) o, si no tiene, el natural de lo que se ve (la miniatura de una foto del Drive, 480
 * px de lado; si ya se cambió por la imagen nítida, el de su miniatura, `data-sd-sharp`). Sin esto, al imprimir la miniatura se cambia por el original, que llenaba el ancho de la
 * hoja: la foto salía más alta que en pantalla y los cortes no coincidían con las marcas. El ancho no sale
 * del de la pantalla (así las marcas del teléfono y de la computadora son las mismas) y nunca pasa del ancho
 * del área de texto (`max-width`).
 */
function fixMediaWidth(img: HTMLImageElement, source: HTMLImageElement): void {
  const wrapper = img.closest<HTMLElement>('.bn-file-block-content-wrapper');
  if (!wrapper) return;
  const set = /^(\d+(?:\.\d+)?)px$/.exec(wrapper.style.width)?.[1];
  // Una foto que en pantalla ya se cambió por la imagen nítida (sharpImages.ts) mide lo que medía su miniatura.
  const sharp = Number(source.dataset.sdSharp);
  const width = set ? Number(set) : sharp > 0 ? sharp : source.naturalWidth;
  if (!(width > 0)) return;
  wrapper.style.width = `${width}px`;
  wrapper.style.maxWidth = '100%';
}

/** Una tabla más ancha que el área de texto se ajusta al ancho (si no, el navegador achica toda la hoja). */
function fitWideTables(root: HTMLElement, width: number): void {
  for (const table of root.querySelectorAll('table')) {
    if (table.scrollWidth > width + 1) table.closest('[data-content-type="table"]')?.classList.add('print-fit');
  }
}

export interface Paginated extends Measured {
  pagination: Pagination;
  /** Lo que entra de un bloque entero en una hoja (el área de texto menos la tolerancia). */
  sheetHeight: number;
}

/** Mide la vista y calcula los cortes. */
export function paginateView(view: PrintView): Paginated {
  const { contentHeight } = view.geometry;
  const sheetHeight = contentHeight - SHEET_TOLERANCE_PX;
  const measured = measureUnits(view.page, sheetHeight);
  return { ...measured, pagination: paginate(measured.units, contentHeight, SHEET_TOLERANCE_PX), sheetHeight };
}

/**
 * Pone en la vista los saltos calculados: `break-before: page` donde empieza una hoja con un bloque entero
 * y `break-inside: avoid` en lo que entra en una hoja (lo que es más alto se parte donde toca, igual que en
 * el cálculo).
 */
export function applyBreaks(result: Paginated): void {
  result.elements.forEach((el, i) => {
    for (const member of result.members?.[i] ?? [el]) {
      // Un párrafo con fotos en línea se deja partir entre renglones (`breakable`, pagination.ts).
      member.classList.toggle('sheet-keep', result.units[i].height <= result.sheetHeight && !result.units[i].breakable);
      member.classList.remove('sheet-break-before');
    }
  });
  for (const b of result.pagination.breaks) {
    if (b.offset !== 0) continue;
    // En una fila de fotos, el salto va en cada foto de la fila (cada una es un renglón de flex aparte
    // para el navegador), así la fila entera empieza la hoja.
    for (const member of result.members?.[b.index] ?? [result.elements[b.index]]) member.classList.add('sheet-break-before');
  }
}
