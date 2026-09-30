import { useEffect, useRef, useState, type RefObject } from 'react';
import { useT } from '../i18n';
import { usePrefs } from '../prefs';
import { useServices, useTree } from '../services';
import { pageFormat } from './pageFormat';
import { SHEET_TOLERANCE_PX, splitPoints, unitKey, type SheetBreak } from './pagination';
import { installPrintShortcuts } from './printPage';
import { buildPrintView, paginateView, type Paginated } from './printView';

// Las marcas de hoja en el editor (roadmap B.7, Docs/Doc_Hojas_PDF.md): en una página con tamaño de hoja,
// una línea con el número de hoja donde empieza cada una, en el mismo lugar donde corta el PDF. Es solo
// una capa encima del editor: no agrega nodos al documento ni guarda nada (el Y.Doc no cambia).
//
// Los cortes salen de medir la vista de impresión (printView.ts), no el editor en pantalla: así valen
// igual en el teléfono, donde la hoja se ve más angosta (cada marca va antes del mismo bloque que en el
// PDF). Se recalculan cuando cambia el documento en pantalla (`.bn-editor`: no los menús, los tiradores,
// la barra de formato, los cursores ni el carrete), agrupados (una pausa corta y `requestAnimationFrame`),
// y cuando cambia el ancho, la fuente, el tamaño del texto o termina de cargar una imagen del documento.

/** Cambios de atributos que no mueven nada: estado del editor, selección, arrastre, foco. */
const IGNORED_ATTRIBUTES = new Set(['class', 'style', 'draggable', 'id', 'contenteditable', 'spellcheck', 'data-is-empty-and-focused']);

/** Si un cambio del DOM del editor puede mover los cortes. */
export function isContentMutation(r: MutationRecord): boolean {
  const target = r.target instanceof Element ? r.target : r.target.parentElement;
  if (!target) return false;
  if (r.type === 'attributes' && (IGNORED_ATTRIBUTES.has(r.attributeName ?? '') || r.attributeName?.startsWith('aria-'))) {
    return false;
  }
  // El encabezado de la página (los contenedores).
  if (target.closest('.page-header')) return !target.closest('.header-popover');
  // Afuera del documento (menús, barra de formato, margen de comentarios, carrete, estas marcas): solo
  // cuenta que aparezca o se vaya el documento entero.
  if (!target.closest('.bn-editor')) {
    const nodes = r.type === 'childList' ? [...r.addedNodes, ...r.removedNodes] : [];
    return nodes.some((n) => n instanceof Element && (n.matches('.bn-editor') || !!n.querySelector('.bn-editor')));
  }
  // Los cursores de otras personas.
  return !target.closest('.bn-collaboration-cursor__base, .ProseMirror-yjs-cursor');
}

/** La pausa al escribir antes de recalcular, y lo máximo que se espera escribiendo sin parar. */
const PAUSE_MS = 120;
const MAX_WAIT_MS = 600;

export interface SheetMark {
  sheet: number;
  /** Desde arriba del contenedor del editor, en píxeles. */
  y: number;
}

export function SheetBreaks({ pageId, host }: { pageId: string; host: RefObject<HTMLDivElement | null> }) {
  const tree = useTree();
  const { media } = useServices();
  const format = pageFormat(tree, pageId);
  const { font, textSize } = usePrefs();
  const tr = useT();
  const [marks, setMarks] = useState<SheetMark[]>([]);
  const sheet = format.size !== 'free';

  // Ctrl/⌘+P y el menú del navegador imprimen la página con la vista de impresión (también si es libre).
  const latest = useRef({ format, media });
  latest.current = { format, media };
  useEffect(
    () =>
      installPrintShortcuts(() => ({
        pageId,
        format: latest.current.format,
        media: latest.current.media.enabled ? latest.current.media : null,
      })),
    [pageId],
  );

  useEffect(() => {
    const editorHost = host.current;
    const article = editorHost?.closest<HTMLElement>('article.page');
    if (!editorHost || !article || !sheet) {
      setMarks([]);
      return;
    }
    const current = { size: format.size, landscape: format.landscape };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    let firstChange = 0;

    const compute = () => {
      frame = 0;
      firstChange = 0;
      let view: ReturnType<typeof buildPrintView> | null = null;
      try {
        view = buildPrintView(article, current, 'measure');
        const result = paginateView(view);
        const next = placeMarks(article, editorHost, result);
        setMarks((old) => (sameMarks(old, next.marks) ? old : next.marks));
        if (next.sheetEnd === null) article.style.removeProperty('--sheet-end');
        else article.style.setProperty('--sheet-end', `${Math.ceil(next.sheetEnd)}px`);
      } catch {
        // Si algo falla al medir, quedan las marcas de antes; el próximo cambio vuelve a probar.
      } finally {
        view?.root.remove();
      }
    };
    const schedule = () => {
      if (frame) return;
      const now = performance.now();
      if (!firstChange) firstChange = now;
      clearTimeout(timer);
      timer = setTimeout(
        () => {
          timer = undefined;
          frame = requestAnimationFrame(compute);
        },
        Math.max(0, Math.min(PAUSE_MS, firstChange + MAX_WAIT_MS - now)),
      );
    };

    // Lo que cambia el documento en pantalla (ver `isContentMutation`).
    const mutations = new MutationObserver((records) => {
      if (records.some(isContentMutation)) schedule();
    });
    mutations.observe(editorHost, { subtree: true, childList: true, characterData: true, attributes: true });
    const header = article.querySelector('.page-header');
    if (header) mutations.observe(header, { subtree: true, childList: true, characterData: true });

    // El alto del editor y del título, y el ancho de la página (su alto cambia con estas marcas).
    let width = article.clientWidth;
    const sizes = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === article) {
          if (article.clientWidth === width) continue;
          width = article.clientWidth;
        }
        schedule();
        return;
      }
    });
    sizes.observe(article);
    sizes.observe(editorHost);
    const title = article.querySelector('.page-title');
    if (title) sizes.observe(title);

    // Una imagen del documento que termina de cargar (no las del carrete ni las de los menús).
    const onLoad = (e: Event) => {
      if (e.target instanceof Element && e.target.closest('.bn-editor')) schedule();
    };
    document.fonts?.addEventListener('loadingdone', schedule);
    editorHost.addEventListener('load', onLoad, true);
    schedule();
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      mutations.disconnect();
      sizes.disconnect();
      document.fonts?.removeEventListener('loadingdone', schedule);
      editorHost.removeEventListener('load', onLoad, true);
      article.style.removeProperty('--sheet-end');
    };
  }, [host, sheet, format.size, format.landscape, font, textSize]);

  if (!sheet || marks.length === 0) return null;
  return (
    <div className="sheet-breaks" aria-hidden="true">
      {marks.map((m) => (
        <div key={m.sheet} className="sheet-break" style={{ top: `${m.y}px` }}>
          <span className="sheet-break-label">{tr('print.sheet', { n: m.sheet })}</span>
        </div>
      ))}
    </div>
  );
}

function sameMarks(a: SheetMark[], b: SheetMark[]): boolean {
  return a.length === b.length && a.every((m, i) => m.sheet === b[i].sheet && Math.abs(m.y - b[i].y) < 0.5);
}

/**
 * Dónde va cada marca en la página en pantalla: antes del mismo bloque que en la vista de impresión (con
 * la vista todavía en el documento). Si un bloque se parte, a la misma altura adentro de él (o en
 * proporción, si en pantalla tiene otro ancho). `sheetEnd`: el alto de la página para que la última hoja
 * se vea entera, solo si la página se ve con el ancho de la hoja.
 */
export function placeMarks(
  article: HTMLElement,
  editorHost: HTMLElement,
  result: Paginated,
): { marks: SheetMark[]; sheetEnd: number | null } {
  const live = new Map<string, HTMLElement>();
  const add = (el: Element | null) => {
    const key = el && unitKey(el);
    if (key && !live.has(key)) live.set(key, el as HTMLElement);
  };
  add(article.querySelector('.page-header'));
  add(article.querySelector('.page-title'));
  for (const el of editorHost.querySelectorAll('.bn-editor .bn-block-content')) add(el);

  const hostTop = editorHost.getBoundingClientRect().top;
  let sameWidth = true;
  const place = (b: SheetBreak): number | null => {
    const el = live.get(b.key);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const marginTop = parseFloat(getComputedStyle(el).marginTop) || 0;
    const copy = result.elements[b.index].getBoundingClientRect();
    const same = Math.abs(r.width - copy.width) < 1;
    if (!same) sameWidth = false;
    const height = r.height + marginTop;
    let offset = b.offset === 0 ? 0 : same ? b.offset : (b.offset * height) / result.units[b.index].height;
    if (b.offset > 0) {
      // Al hueco entre renglones (o filas) más cercano en pantalla, no a mitad de uno: con otro ancho (el
      // teléfono) cambian los renglones, y una tabla en pantalla tiene arriba el lugar de sus tiradores.
      const gaps = splitPoints(el, r.top - marginTop);
      if (gaps.length) offset = gaps.reduce((best, g) => (Math.abs(g - offset) < Math.abs(best - offset) ? g : best));
    }
    return r.top - marginTop - hostTop + offset;
  };

  const marks: SheetMark[] = [];
  for (const b of result.pagination.breaks) {
    const y = place(b);
    if (y !== null) marks.push({ sheet: b.sheet, y });
  }

  // Con el ancho de la hoja, la página llega hasta el final de la última hoja.
  const editor = editorHost.querySelector('.bn-editor');
  const copyEditor = result.elements.find((el) => el.closest('.bn-editor'))?.closest('.bn-editor');
  if (editor && copyEditor) {
    const style = getComputedStyle(editor);
    const inner = editor.getBoundingClientRect().width - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0');
    if (Math.abs(inner - copyEditor.getBoundingClientRect().width) >= 1) sameWidth = false;
  }
  const first = live.get(result.units[0]?.key ?? '');
  if (!sameWidth || !first) return { marks, sheetEnd: null };
  const articleTop = article.getBoundingClientRect().top;
  const lastStart = marks.length ? marks[marks.length - 1].y + hostTop - articleTop : first.getBoundingClientRect().top - articleTop;
  const bottom = parseFloat(getComputedStyle(article).paddingBottom) || 0;
  return { marks, sheetEnd: lastStart + result.sheetHeight + SHEET_TOLERANCE_PX + bottom };
}
