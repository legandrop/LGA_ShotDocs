import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import type * as Y from 'yjs';
import { BlockNoteView } from '@blocknote/mantine';
import { createRoot, type Root } from 'react-dom/client';
import { t } from '../i18n';
import '../i18n/lazy/editor';
import { mediaIdOf, type MediaQueue } from '../media/queue';
import type { Language } from '../prefs';
import { markAttachments } from '../ui/attachments';
import { attachMarkupOverlay } from '../ui/markupOverlay';
import { pageEditorExtensions } from '../ui/editorExtensions';
import { editorDictionary } from '../ui/editorLocale';
import { editorSchemaOptions } from '../ui/editorSchema';
import type { PageFormat } from '../ui/pageFormat';
import type { SheetBreak } from '../ui/pagination';
import { imagesPending } from '../ui/printPage';
import { applyBreaks, buildPrintView, paginateView, type Paginated, type PrintView } from '../ui/printView';

// El editor de exportación (P.22, Docs/Doc_Exportar.md, sección 2.4; entrega 0).
//
// Un BlockNote con el esquema y las extensiones de la página (las mismas de PageEditor.tsx, sin colapsar: lo
// exportado sale abierto), montado afuera de la pantalla, en solo lectura y SIN colaboración: no está atado a
// ningún Y.Doc, así que nada de lo que haga puede escribir ni subir un cambio. Por cada página se le ponen los
// bloques (`replaceBlocks`), se espera a que se pongan las imágenes (hasta 8 s, como printPage.ts), se copia el DOM
// con la vista de impresión de siempre (`buildPrintView`, printView.ts) y se pagina con el mismo cálculo que las
// marcas de hoja de la pantalla (SheetBreaks.tsx). Un solo editor sirve para todas las páginas.
//
// La página se arma como la de la app (`article.page` con su `.page-header`, el título y `.editor-host`), porque la
// vista de impresión copia de ahí; sin `data-page-id`, así nunca se confunde con la página abierta
// (`findPageArticle`).

type Format = Pick<PageFormat, 'size' | 'landscape'>;

/** Una página para dibujar. */
export interface ExportPageInput {
  id: string;
  title: string;
  /** El encabezado: los títulos de los contenedores, del más lejano al más cercano (vacío: sin encabezado). */
  header: string[];
  format: Format;
  blocks: PartialBlock<any, any, any>[];
  /**
   * Las anotaciones de las fotos (el mapa `photoMarkup` de una COPIA del documento, Docs/Doc_Anotar_Fotos.md): se
   * dibujan encima de cada foto antes de copiar la vista, como en la página (así salen en el PDF).
   */
  markup?: Y.Map<unknown> | null;
}

export interface ExportEditorOptions {
  /** El idioma del editor (los textos de BlockNote). */
  lang?: Language;
  /**
   * La dirección de una imagen (`sdmedia://`, `sdfile://` o `https`) para mostrar, como el `resolveFileUrl` de la
   * página. Sin esto, tal cual.
   */
  resolveFileUrl?: (url: string, pageId: string) => Promise<string>;
  /** Para marcar los adjuntos (su tarjeta tiene tamaño fijo, como en la página). */
  media?: Pick<MediaQueue, 'fileInfo'> | null;
  /**
   * La dirección de cada archivo en el PDF (con un link público, Docs/Doc_Links_PDF.md 3.3). Sin esto, la del workspace
   * abierto (`mediaLinks.ts`).
   */
  mediaHref?: (id: string, pageId: string) => string | null;
  /** Lo que se espera a que se pongan las imágenes del editor (como `printPage`: 8 s). */
  imageTimeoutMs?: number;
  /** Lo que se espera a que carguen las imágenes de la copia (como `printPage`: 6 s). */
  copyTimeoutMs?: number;
  /** La espera corta, después de varias páginas seguidas con imágenes que no llegaron (1 s). */
  shortTimeoutMs?: number;
}

/** Una página dibujada, copiada y paginada. */
export interface RenderedPage {
  pageId: string;
  /** La vista de impresión (en el documento, afuera de la pantalla). Quien la pide la saca con `view.root.remove()`. */
  view: PrintView;
  result: Paginated;
  sheets: number;
  breaks: SheetBreak[];
  /** Alguna imagen no terminó de ponerse a tiempo (sale como esté). */
  imagesTimedOut: boolean;
  /** Milisegundos de cada paso. */
  ms: { blocks: number; images: number; copy: number; paginate: number };
}

/** Se canceló la exportación. */
export class ExportCancelled extends Error {
  constructor() {
    super('Export cancelled');
    this.name = 'ExportCancelled';
  }
}

const IMAGE_TIMEOUT_MS = 8000;
const COPY_TIMEOUT_MS = 6000;
/**
 * Después de tantas páginas seguidas con imágenes que no llegaron (un servidor que no contesta), la espera de las
 * siguientes baja a `SHORT_TIMEOUT_MS`: con 8 s por página, 300 páginas serían 40 minutos de espera inútil.
 */
const TIMEOUTS_BEFORE_SHORT = 3;
const SHORT_TIMEOUT_MS = 1000;

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function check(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new ExportCancelled();
}

/** Espera a que `ready()` dé `true` (cada 16 ms) o a `timeoutMs`. Devuelve si llegó a tiempo. */
async function until(ready: () => boolean, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
  const end = performance.now() + timeoutMs;
  while (!ready()) {
    check(signal);
    if (performance.now() >= end) return false;
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  return true;
}

/** Las imágenes de la copia que todavía cargan. */
function copyImagesPending(root: HTMLElement): boolean {
  for (const img of root.querySelectorAll('img')) {
    if (img.getAttribute('src') && !img.complete) return true;
  }
  return false;
}

export class ExportEditor {
  private readonly editor: BlockNoteEditor<any, any, any>;
  private readonly article: HTMLElement;
  private readonly header: HTMLElement;
  private readonly title: HTMLTextAreaElement;
  private readonly root: Root;
  private currentPage = '';
  private destroyed = false;
  /** Páginas seguidas cuyas imágenes no llegaron a tiempo. */
  private timeouts = 0;

  private constructor(private readonly options: ExportEditorOptions) {
    const resolve = options.resolveFileUrl;
    const media = options.media ?? null;
    this.editor = BlockNoteEditor.create({
      ...editorSchemaOptions,
      dictionary: editorDictionary(options.lang ?? 'en'),
      resolveFileUrl: (url: string) => {
        const pageId = this.currentPage;
        // Si la dirección no se puede resolver, la imagen queda rota (no se espera) y el error no sale suelto.
        const out = (resolve ? resolve(url, pageId) : Promise.resolve(url)).catch(() => url);
        const id = media ? mediaIdOf(url) : null;
        if (!id || !media) return out;
        return out.then((src) => {
          // Como la página: un adjunto se ve como tarjeta (tamaño fijo). La clase va en la imagen, después de ponerla.
          setTimeout(() => markAttachments(this.editor as never, id, media));
          return src;
        });
      },
      // Las de la página, sin colapsar (`null`): todo sale abierto, como el PDF de siempre.
      extensions: pageEditorExtensions(null),
    }) as unknown as BlockNoteEditor<any, any, any>;

    // La página, como la arma PageView.tsx (la vista de impresión busca estas clases).
    this.article = document.createElement('article');
    this.article.className = 'page sd-export-source';
    this.article.setAttribute('aria-hidden', 'true');
    this.article.inert = true;
    Object.assign(this.article.style, {
      position: 'fixed',
      top: '0',
      left: '-100000px',
      width: '820px',
      visibility: 'hidden',
      pointerEvents: 'none',
      contain: 'layout style',
    });
    this.header = document.createElement('div');
    this.header.className = 'page-header';
    this.title = document.createElement('textarea');
    this.title.className = 'page-title';
    this.title.readOnly = true;
    this.title.rows = 1;
    const host = document.createElement('div');
    host.className = 'editor-host';
    host.style.setProperty('--sd-page-break-label', JSON.stringify(t('editor.pageBreak')));
    this.article.append(this.header, this.title, host);
    document.body.append(this.article);
    this.root = createRoot(host);
    this.root.render(
      <BlockNoteView
        editor={this.editor}
        editable={false}
        theme="light"
        className="editor"
        slashMenu={false}
        formattingToolbar={false}
        sideMenu={false}
        linkToolbar={false}
        filePanel={false}
        tableHandles={false}
        emojiPicker={false}
      />,
    );
  }

  /** Arma el editor y espera a que esté montado. */
  static async create(options: ExportEditorOptions = {}): Promise<ExportEditor> {
    const out = new ExportEditor(options);
    const mounted = await until(() => !!out.editor.prosemirrorView && !!out.article.querySelector('.editor-host .bn-editor'), 10_000);
    if (!mounted) {
      out.destroy();
      throw new Error('El editor de exportación no se montó');
    }
    return out;
  }

  /**
   * Dibuja una página: le pone los bloques, espera sus imágenes, copia la vista de impresión y la pagina con los
   * saltos puestos (la vista queda lista para imprimir). Nada de esto toca un documento.
   */
  async render(page: ExportPageInput, { signal }: { signal?: AbortSignal } = {}): Promise<RenderedPage> {
    if (this.destroyed) throw new Error('El editor de exportación ya se cerró');
    check(signal);
    const t0 = performance.now();
    this.currentPage = page.id;
    this.setHeader(page.header);
    this.title.value = page.title.trim() || t('common.untitled');
    const blocks = page.blocks.length > 0 ? page.blocks : [{ type: 'paragraph' }];
    // Fuera del historial de deshacer: si no, el editor guardaría cada página anterior (crece sin tope).
    this.editor.transact((tr) => {
      tr.setMeta('addToHistory', false);
      this.editor.replaceBlocks(this.editor.document, blocks as never);
    });
    // BlockNote pone las imágenes después (pide la dirección a `resolveFileUrl`).
    await tick();
    const t1 = performance.now();
    const full = this.options.imageTimeoutMs ?? IMAGE_TIMEOUT_MS;
    const timeout = this.timeouts >= TIMEOUTS_BEFORE_SHORT ? Math.min(full, this.options.shortTimeoutMs ?? SHORT_TIMEOUT_MS) : full;
    const hadImages = imagesPending(this.article);
    const settled = await until(() => !imagesPending(this.article), timeout, signal);
    if (!settled) this.timeouts++;
    else if (hadImages) this.timeouts = 0;
    await document.fonts?.ready.catch(() => undefined);
    check(signal);
    const t2 = performance.now();
    // Las anotaciones, encima de las fotos ya puestas (el mismo dibujo que monta PageEditor.tsx); la copia las lleva.
    const overlay = page.markup && page.markup.size > 0 && this.editor.domElement ? attachMarkupOverlay(this.editor.domElement, page.markup) : null;
    overlay?.flush();
    overlay?.stop();
    const mediaHref = this.options.mediaHref;
    const view = buildPrintView(this.article, page.format, 'output', {
      pageId: page.id,
      mediaHref: mediaHref ? (id) => mediaHref(id, page.id) : undefined,
    });
    // Las de esta página no quedan en el editor para la siguiente.
    if (overlay) for (const svg of this.article.querySelectorAll('svg.sd-markup')) svg.remove();
    try {
      // Las imágenes de la copia ya están en la memoria del navegador; igual se esperan, como `printPage`. Si las del
      // editor no llegaron, las de la copia son las mismas y tampoco van a llegar: no se espera otra vez.
      if (settled && copyImagesPending(view.root)) await until(() => !copyImagesPending(view.root), this.options.copyTimeoutMs ?? COPY_TIMEOUT_MS, signal);
      const t3 = performance.now();
      const result = paginateView(view);
      applyBreaks(result);
      const t4 = performance.now();
      return {
        pageId: page.id,
        view,
        result,
        sheets: result.pagination.sheets,
        breaks: result.pagination.breaks,
        imagesTimedOut: !settled,
        ms: { blocks: t1 - t0, images: t2 - t1, copy: t3 - t2, paginate: t4 - t3 },
      };
    } catch (err) {
      view.root.remove();
      throw err;
    }
  }

  /** El DOM del editor (para las pruebas). */
  get dom(): HTMLElement {
    return this.article;
  }

  /** Los bloques que tiene el editor ahora (para las pruebas). */
  get blocks(): BlockNoteEditor<any, any, any>['document'] {
    return this.editor.document;
  }

  /** Lo cierra y lo saca del documento. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    try {
      this.root.unmount();
    } catch {
      // Ya desmontado.
    }
    this.article.remove();
  }

  private setHeader(titles: string[]): void {
    this.header.replaceChildren();
    titles.forEach((title, i) => {
      if (i > 0) {
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.textContent = '·';
        this.header.append(dot);
      }
      const span = document.createElement('span');
      span.className = `ancestor${i === titles.length - 1 ? ' nearest' : ''}`;
      span.textContent = title.trim() || t('common.untitled');
      this.header.append(span);
    });
  }
}
