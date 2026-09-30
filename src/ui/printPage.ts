import { mediaIdOf, type MediaQueue } from '../media/queue';
import { navigate, pagePath } from '../router';
import { notify } from './notice';
import type { PageFormat } from './pageFormat';
import { applyBreaks, buildPrintView, findPageArticle, paginateView, type Paginated, type PrintView } from './printView';

// Imprimir o guardar como PDF (roadmap B.7, Docs/Doc_Hojas_PDF.md). Se usa la impresión del navegador:
// se arma la vista de impresión con los cortes calculados, se pone la hoja (`@page`) y se llama a
// `window.print()`. En el diálogo, "Guardar como PDF" da el PDF. Mientras está abierto el diálogo solo se
// imprime la vista (styles.css, `.sd-printing`); al cerrarlo se saca todo.

type Format = Pick<PageFormat, 'size' | 'landscape'>;
type MediaSource = Pick<MediaQueue, 'source'>;

/** Las fotos grandes que se usan como mucho en un PDF (las demás van con su miniatura). */
const MAX_ORIGINALS = 40;
const MAX_ORIGINAL_BYTES = 200 * 1024 * 1024;

interface Job {
  view: PrintView;
  result: Paginated;
  title: string;
  urls: string[];
  restore: (() => void) | null;
}

let active: Job | null = null;

/** Saca la vista de impresión y deja todo como estaba (se llama al cerrar el diálogo). */
export function finishPrint(): void {
  const job = active;
  active = null;
  if (!job) return;
  job.restore?.();
  job.view.root.remove();
  for (const url of job.urls) URL.revokeObjectURL(url);
}

if (typeof window !== 'undefined') window.addEventListener('afterprint', finishPrint);

/** Arma la vista de impresión de la página abierta y calcula sus cortes (sin mostrar nada todavía). */
function prepare(article: HTMLElement, format: Format): Job {
  finishPrint();
  const view = buildPrintView(article, format, 'output');
  const result = paginateView(view);
  applyBreaks(result);
  const title = view.page.querySelector('.page-title')?.textContent || 'Untitled';
  active = { view, result, title, urls: [], restore: null };
  return active;
}

/** Deja la vista lista para el diálogo: la hoja, solo la vista, en claro y el título como nombre del PDF. */
function activate(job: Job): void {
  if (job.restore) return;
  const { widthMm, heightMm, marginMm } = job.view.geometry;
  const style = document.createElement('style');
  style.textContent = `@page { size: ${widthMm}mm ${heightMm}mm; margin: ${marginMm}mm; }`;
  document.head.append(style);
  const root = document.documentElement;
  root.classList.add('sd-printing');
  job.view.root.removeAttribute('aria-hidden');
  // El papel es blanco: con el tema oscuro, mientras está el diálogo, la app se ve en claro.
  const darkBefore = root.dataset.theme === 'dark';
  if (darkBefore) root.dataset.theme = 'light';
  const titleBefore = document.title;
  document.title = job.title;
  job.restore = () => {
    style.remove();
    root.classList.remove('sd-printing');
    if (darkBefore && root.dataset.theme === 'light') root.dataset.theme = 'dark';
    if (document.title === job.title) document.title = titleBefore;
  };
}

/**
 * Imprime la página (el diálogo del navegador, donde también se guarda como PDF). Si no está abierta, la
 * abre y espera al editor. Las fotos del Drive van grandes si el original está en este dispositivo; si no,
 * con su miniatura (no se baja nada).
 */
export async function printPage(pageId: string, options: { format: Format; media?: MediaSource | null }): Promise<void> {
  const article = await openPage(pageId);
  if (!article) {
    notify('The page could not be prepared for printing. Open it and try again.');
    return;
  }
  await document.fonts?.ready.catch(() => undefined);
  const job = prepare(article, options.format);
  if (options.media) await useOriginals(job, options.media).catch(() => undefined);
  await imagesLoaded(job.view.root, 6000);
  if (active !== job) return;
  activate(job);
  window.print();
  // Donde `print()` no espera al diálogo (Safari en el iPhone) y no llega `afterprint`, el primer toque
  // en la app después de cerrarlo deja todo como estaba.
  const later = () => {
    if (active === job) finishPrint();
  };
  setTimeout(() => {
    window.addEventListener('pointerdown', later, { once: true, capture: true });
    window.addEventListener('keydown', later, { once: true, capture: true });
  }, 500);
}

/**
 * Para imprimir desde el menú del navegador (o Ctrl+P si no se atajó): arma la vista en el momento, con
 * las imágenes que ya se ven. Y Ctrl/⌘+P con la página abierta pasa por `printPage`.
 */
export function installPrintShortcuts(current: () => { pageId: string; format: Format; media?: MediaSource | null } | null): () => void {
  const onBefore = () => {
    if (active?.restore) return;
    const page = current();
    const article = page && findPageArticle(page.pageId);
    if (!page || !article?.querySelector('.bn-editor')) return;
    activate(prepare(article, page.format));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key.toLowerCase() !== 'p' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
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

/** La página abierta con su editor; si no está abierta, la abre y la espera (hasta 20 segundos). */
function openPage(pageId: string): Promise<HTMLElement | null> {
  const ready = () => {
    const article = findPageArticle(pageId);
    return article?.querySelector('.bn-editor') ? article : null;
  };
  const now = ready();
  if (now) return Promise.resolve(now);
  if (!findPageArticle(pageId)) navigate(pagePath(pageId));
  return new Promise((resolve) => {
    const done = (article: HTMLElement | null) => {
      observer.disconnect();
      clearTimeout(timer);
      // Un momento más para que el editor muestre las imágenes que ya tiene el dispositivo.
      if (article) setTimeout(() => resolve(ready()), 400);
      else resolve(null);
    };
    const observer = new MutationObserver(() => {
      const article = ready();
      if (article) done(article);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(() => done(null), 20_000);
  });
}

/** Cambia la miniatura por la foto entera cuando el original está en el dispositivo y el navegador la abre. */
async function useOriginals(job: Job, media: MediaSource): Promise<void> {
  let count = 0;
  let bytes = 0;
  for (const block of job.view.root.querySelectorAll<HTMLElement>('[data-content-type="image"][data-url]')) {
    const id = mediaIdOf(block.getAttribute('data-url'));
    const img = block.querySelector<HTMLImageElement>('img.bn-visual-media');
    if (!id || !img) continue;
    const source = await media.source(id).catch(() => null);
    const original = source?.kind === 'image' ? source.original : null;
    if (!original || count >= MAX_ORIGINALS || bytes + original.size > MAX_ORIGINAL_BYTES) continue;
    const url = URL.createObjectURL(original);
    job.urls.push(url);
    // Una foto que el navegador no sabe abrir (HEIC en Chrome) sigue con su miniatura.
    const probe = new Image();
    probe.src = url;
    const ok = await Promise.race([
      probe.decode().then(
        () => true,
        () => false,
      ),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 8000)),
    ]);
    if (!ok || active !== job) continue;
    img.src = url;
    count++;
    bytes += original.size;
  }
}

/** Espera a que carguen las imágenes de la vista (lo que no llega a tiempo sale como esté). */
function imagesLoaded(root: HTMLElement, timeoutMs: number): Promise<void> {
  const pending = [...root.querySelectorAll('img')].filter((img) => !img.complete);
  if (pending.length === 0) return Promise.resolve();
  return Promise.race([
    Promise.all(
      pending.map((img) => new Promise<void>((resolve) => {
        img.addEventListener('load', () => resolve(), { once: true });
        img.addEventListener('error', () => resolve(), { once: true });
      })),
    ).then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
