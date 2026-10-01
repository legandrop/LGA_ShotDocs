import { t } from '../i18n';
import { printAsSeen } from './printAsSeen';
import { MEDIA_SCHEME, mediaIdOf, type MediaQueue } from '../media/queue';
import { navigate, pagePath } from '../router';
import { IS_MAC, isLetter, modPressed } from './findUi';
import { notify } from './notice';
import type { PageFormat } from './pageFormat';
import { applyBreaks, buildPrintView, findPageArticle, paginateView, type Paginated, type PrintView } from './printView';

// Imprimir o guardar como PDF (roadmap B.7, Docs/Doc_Hojas_PDF.md). Se usa la impresión del navegador:
// se arma la vista de impresión con los cortes calculados, se pone la hoja (`@page`) y se llama a
// `window.print()`. En el diálogo, "Guardar como PDF" da el PDF. Mientras está abierto el diálogo solo se
// imprime la vista (styles.css, `.sd-printing`); al cerrarlo se saca todo. El tema de la app no se toca:
// la vista trae sus propios colores claros.

type Format = Pick<PageFormat, 'size' | 'landscape'>;
/** Lo que la impresión le pide a la cola de fotos: solo lo guardado en el dispositivo, nunca la red. */
export type PrintMedia = Pick<MediaQueue, 'localImage'>;

/** Las fotos grandes que se usan como mucho en un PDF (las demás van con su miniatura). */
const ORIGINALS = { count: 40, bytes: 200 * 1024 * 1024 };
/** En un teléfono o una tableta, menos (la memoria es poca). */
const ORIGINALS_TOUCH = { count: 12, bytes: 60 * 1024 * 1024 };
/** El lado mayor de una foto grande en el PDF (más no se ve en papel y pesa). */
export const ORIGINAL_MAX_SIDE = 2400;
/** En un táctil, un `afterprint` que llega antes de esto no es el cierre del diálogo (Safari del iPhone). */
const EARLY_AFTERPRINT_MS = 1000;

interface Job {
  view: PrintView;
  result: Paginated;
  title: string;
  urls: string[];
  restore: (() => void) | null;
  /** Cuándo se llamó a `print()` (0: todavía no). */
  printedAt: number;
}

let active: Job | null = null;

function isTouch(): boolean {
  if (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) return true;
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

/** Saca la vista de impresión y deja todo como estaba (se llama al cerrar el diálogo). */
export function finishPrint(): void {
  const job = active;
  active = null;
  if (!job) return;
  job.restore?.();
  job.view.root.remove();
  for (const url of job.urls) URL.revokeObjectURL(url);
}

function onAfterPrint(): void {
  const job = active;
  // Safari del iPhone avisa `afterprint` apenas abre el diálogo: ahí limpia el primer toque (`printNow`).
  if (job && isTouch() && job.printedAt && performance.now() - job.printedAt < EARLY_AFTERPRINT_MS) return;
  finishPrint();
}

if (typeof window !== 'undefined') window.addEventListener('afterprint', onAfterPrint);

/** Arma la vista de impresión de la página abierta y calcula sus cortes (sin mostrar nada todavía). */
function prepare(article: HTMLElement, format: Format): Job {
  finishPrint();
  // Como se ve solo si hay algo colapsado: si no, es lo mismo.
  const asSeen = printAsSeen() && !!article.querySelector('.sd-collapsed');
  const view = buildPrintView(article, format, 'output', { asSeen });
  try {
    const result = paginateView(view);
    applyBreaks(result);
    const title = view.page.querySelector('.page-title')?.textContent || t('common.untitled');
    active = { view, result, title, urls: [], restore: null, printedAt: 0 };
    return active;
  } catch (err) {
    view.root.remove();
    throw err;
  }
}

/** Vuelve a medir y cortar (las imágenes terminaron de cargar o cambiaron por las grandes). */
function repaginate(job: Job): void {
  job.result = paginateView(job.view);
  applyBreaks(job.result);
}

/** Deja la vista lista para el diálogo: la hoja, solo la vista y el título como nombre del PDF. */
function activate(job: Job): void {
  if (job.restore) return;
  const { widthMm, heightMm, marginMm } = job.view.geometry;
  const style = document.createElement('style');
  style.textContent = `@page { size: ${widthMm}mm ${heightMm}mm; margin: ${marginMm}mm; }`;
  document.head.append(style);
  const root = document.documentElement;
  root.classList.add('sd-printing');
  job.view.root.removeAttribute('aria-hidden');
  const titleBefore = document.title;
  document.title = job.title;
  const later = () => {
    if (active === job && job.printedAt) finishPrint();
  };
  job.restore = () => {
    style.remove();
    root.classList.remove('sd-printing');
    if (document.title === job.title) document.title = titleBefore;
    window.removeEventListener('pointerdown', later, true);
    window.removeEventListener('keydown', later, true);
  };
  // Donde `print()` no espera al diálogo (Safari del iPhone) y no llega `afterprint` al cerrarlo, el
  // primer toque en la app después deja todo como estaba.
  window.addEventListener('pointerdown', later, true);
  window.addEventListener('keydown', later, true);
}

/** Abre el diálogo. Si el navegador no puede, deja todo como estaba y avisa. */
function printNow(job: Job): void {
  activate(job);
  job.printedAt = performance.now();
  try {
    window.print();
  } catch {
    if (active === job) finishPrint();
    notify(t('print.dialogFailed'));
  }
}

/**
 * Imprime la página (el diálogo del navegador, donde también se guarda como PDF). Si no está abierta, la
 * abre y espera al editor y sus imágenes. Las fotos del Drive van grandes si el original está en este
 * dispositivo; si no, con su miniatura (no se baja nada).
 *
 * Si no hay nada que esperar (la página abierta, las imágenes cargadas, ninguna foto del Drive), todo pasa
 * antes del primer `await`: el diálogo se abre dentro del mismo toque, que es lo que pide el iPhone.
 */
export function printPage(pageId: string, options: { format: Format; media?: PrintMedia | null }): Promise<void> {
  const article = readyArticle(pageId);
  const media = options.media ?? null;
  if (article && fontsLoaded() && !imagesPending(article) && !(media && hasDriveImages(article))) {
    try {
      printNow(prepare(article, options.format));
    } catch {
      finishPrint();
      notify(t('print.failed'));
    }
    return Promise.resolve();
  }
  return printLater(pageId, options.format, media);
}

async function printLater(pageId: string, format: Format, media: PrintMedia | null): Promise<void> {
  const article = await openPage(pageId);
  if (!article) {
    notify(t('print.failed'));
    return;
  }
  const originals = !!media && hasDriveImages(article);
  if (originals) notify(t('print.preparing'));
  await document.fonts?.ready.catch(() => undefined);
  // Una página recién abierta todavía está poniendo sus imágenes: sin esperar, saldrían vacías y los cortes
  // serían otros.
  await liveImagesSettled(article, 8000);
  let job: Job;
  try {
    job = prepare(article, format);
  } catch {
    finishPrint();
    notify(t('print.failed'));
    return;
  }
  if (originals && media) await useOriginals(job, media).catch(() => undefined);
  await imagesLoaded(job.view.root, 6000);
  if (active !== job) return;
  try {
    repaginate(job);
  } catch {
    finishPrint();
    notify(t('print.failed'));
    return;
  }
  printNow(job);
}

/** Imprimir: Ctrl+P (⌘P en la Mac: nunca Ctrl en la Mac), sin Alt ni Shift. `mac` para probar las dos. */
export function isPrintShortcut(
  e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; key: string; code?: string },
  mac = IS_MAC,
): boolean {
  return modPressed(e, mac) && !e.altKey && !e.shiftKey && isLetter(e, 'p');
}

/**
 * Para imprimir desde el menú del navegador (o Ctrl+P si no se atajó): arma la vista en el momento, con
 * las imágenes que ya se ven. Y Ctrl/⌘+P con la página abierta pasa por `printPage`.
 */
export function installPrintShortcuts(current: () => { pageId: string; format: Format; media?: PrintMedia | null } | null): () => void {
  const onBefore = () => {
    if (active?.restore) return;
    const page = current();
    const article = page && findPageArticle(page.pageId);
    if (!page || !article?.querySelector('.bn-editor')) return;
    try {
      activate(prepare(article, page.format));
    } catch {
      finishPrint();
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (!isPrintShortcut(e)) return;
    const page = current();
    if (!page) return;
    e.preventDefault();
    void printPage(page.pageId, page);
  };
  window.addEventListener('beforeprint', onBefore);
  window.addEventListener('keydown', onKey);
  return () => {
    window.removeEventListener('beforeprint', onBefore);
    window.removeEventListener('keydown', onKey);
  };
}

function readyArticle(pageId: string): HTMLElement | null {
  const article = findPageArticle(pageId);
  return article?.querySelector('.bn-editor') ? article : null;
}

function fontsLoaded(): boolean {
  return !document.fonts || document.fonts.status === 'loaded';
}

/** La página tiene fotos o videos del Drive (se buscan sus originales en el dispositivo). */
function hasDriveImages(article: HTMLElement): boolean {
  return !!article.querySelector(`.editor-host [data-content-type="image"][data-url^="${MEDIA_SCHEME}"]`);
}

/** Alguna imagen del editor en pantalla todavía está buscando su dirección o cargando. */
export function imagesPending(article: HTMLElement): boolean {
  for (const block of article.querySelectorAll<HTMLElement>('.editor-host .bn-editor [data-content-type="image"][data-url]')) {
    if (!block.getAttribute('data-url')) continue;
    if (block.querySelector('.bn-file-loading-preview')) return true;
    const img = block.querySelector<HTMLImageElement>('img.bn-visual-media');
    // Una imagen rota (cargó y no tiene tamaño) no se espera.
    if (img && (!img.getAttribute('src') || !img.complete)) return true;
  }
  return false;
}

function liveImagesSettled(article: HTMLElement, timeoutMs: number): Promise<void> {
  const until = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const check = () => {
      if (!imagesPending(article) || Date.now() >= until) resolve();
      else setTimeout(check, 100);
    };
    check();
  });
}

/** La página abierta con su editor; si no está abierta, la abre y la espera (hasta 20 segundos). */
function openPage(pageId: string): Promise<HTMLElement | null> {
  const now = readyArticle(pageId);
  if (now) return Promise.resolve(now);
  if (!findPageArticle(pageId)) navigate(pagePath(pageId));
  return new Promise((resolve) => {
    const done = (article: HTMLElement | null) => {
      observer.disconnect();
      clearTimeout(timer);
      // Un momento más para que el editor empiece a poner las imágenes que ya tiene el dispositivo.
      if (article) setTimeout(() => resolve(readyArticle(pageId)), 400);
      else resolve(null);
    };
    const observer = new MutationObserver(() => {
      const article = readyArticle(pageId);
      if (article) done(article);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(() => done(null), 20_000);
  });
}

/**
 * Cambia la miniatura por la foto entera cuando el original está en el dispositivo, achicada a
 * `ORIGINAL_MAX_SIDE`. Una foto que el navegador no sabe abrir (HEIC en Chrome) sigue con su miniatura.
 * Si mientras tanto se cancela la impresión (se cerró, o empezó otra), no crea nada más.
 */
async function useOriginals(job: Job, media: PrintMedia): Promise<void> {
  const limit = isTouch() ? ORIGINALS_TOUCH : ORIGINALS;
  let count = 0;
  let bytes = 0;
  for (const block of job.view.root.querySelectorAll<HTMLElement>('[data-content-type="image"][data-url]')) {
    if (active !== job || count >= limit.count) return;
    const id = mediaIdOf(block.getAttribute('data-url'));
    const img = block.querySelector<HTMLImageElement>('img.bn-visual-media');
    if (!id || !img) continue;
    const original = await media.localImage(id).catch(() => null);
    if (!original || bytes + original.size > limit.bytes) continue;
    if (active !== job) return;
    const scaled = await downscale(original, ORIGINAL_MAX_SIDE).catch(() => null);
    if (active !== job) return;
    if (!scaled) continue;
    const url = URL.createObjectURL(scaled);
    job.urls.push(url);
    img.src = url;
    count++;
    bytes += original.size;
  }
}

const PASS_THROUGH = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

/** La foto con su lado mayor en `maxSide` como mucho (JPEG), o tal cual si ya es chica. `null` si no abre. */
export async function downscale(blob: Blob, maxSide: number): Promise<Blob | null> {
  if (typeof createImageBitmap !== 'function') return null;
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && PASS_THROUGH.has(blob.type)) return blob;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  } finally {
    bitmap.close();
  }
}

/** Espera a que carguen las imágenes de la vista (lo que no llega a tiempo sale como esté). */
function imagesLoaded(root: HTMLElement, timeoutMs: number): Promise<void> {
  const pending = [...root.querySelectorAll('img')].filter((img) => !img.complete);
  if (pending.length === 0) return Promise.resolve();
  return Promise.race([
    Promise.all(
      pending.map(
        (img) =>
          new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
          }),
      ),
    ).then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
