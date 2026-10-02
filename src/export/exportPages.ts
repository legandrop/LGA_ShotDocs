import type * as Y from 'yjs';
import { PHOTO_MARKUP_MAP } from '../media/markup';
import { branchPages } from '../media/offlinePlan';
import type { PageTree } from '../sync/tree';
import { pageFormat, type PageFormat } from '../ui/pageFormat';
import { headerPages } from '../ui/titles';
import { ExportCancelled, type ExportEditor, type RenderedPage } from './exportEditor';
import { readPageContent, type PageContent } from './pageContent';

// Exportar una rama o un proyecto, página por página (P.22, Docs/Doc_Exportar.md; entrega 0).
//
// Qué páginas: la rama que la persona ve, del árbol local (que ya pasó por Row Level Security), sin la papelera
// (`branchPages`). De cada una se lee una COPIA de lo guardado (`docs.snapshot`), se sacan sus bloques y se
// descarta la copia; los bloques se dibujan en el editor de exportación, que copia y pagina. Nada de esto escribe en
// el documento, el árbol ni la base local: lo prueba export.test.tsx (y la medición de la entrega 0, byte por byte).

type Format = Pick<PageFormat, 'size' | 'landscape'>;

/** Una página de lo exportado, en el orden del árbol. */
export interface ExportPlanPage {
  id: string;
  title: string;
  /** El nivel adentro de lo exportado (0: la raíz). */
  depth: number;
  /** La página de arriba, si también se exporta (`null` en la raíz: nunca el id de algo de afuera, regla 2). */
  parent: string | null;
  /** El encabezado: el de la página (sus ajustes de títulos), sin nada de arriba de la raíz exportada (regla 2). */
  header: string[];
  /** La hoja que hereda (una página libre sale en A4, como el PDF de siempre). */
  format: Format;
}

type PlanTree = Pick<PageTree, 'get' | 'children' | 'roots' | 'isTrashed' | 'ancestors' | 'resolveSetting'>;

/** Las páginas de una rama (`page`) o de un proyecto (`project`), en el orden del árbol, sin la papelera. */
export function exportPlan(tree: PlanTree, kind: 'page' | 'project', target: string): ExportPlanPage[] {
  const ids = branchPages(tree, kind, target);
  const inside = new Set(ids);
  const depthOf = new Map<string, number>();
  const out: ExportPlanPage[] = [];
  for (const id of ids) {
    const row = tree.get(id);
    if (!row) continue;
    const parentDepth = row.parent_id && inside.has(row.parent_id) ? depthOf.get(row.parent_id) : undefined;
    const depth = parentDepth === undefined ? 0 : parentDepth + 1;
    depthOf.set(id, depth);
    const format = pageFormat(tree as PageTree, id);
    out.push({
      id,
      title: row.title,
      depth,
      parent: parentDepth === undefined ? null : row.parent_id,
      // Solo los contenedores que también se exportan: nunca el título de algo de arriba de la rama.
      header: headerPages(tree as PageTree, id)
        .filter((p) => inside.has(p.id))
        .map((p) => p.title),
      format: { size: format.size, landscape: format.landscape },
    });
  }
  return out;
}

/** De dónde se lee cada página: una copia de lo guardado (la forma de `PageDocs.snapshot`). */
export interface ExportSource {
  snapshot(pageId: string): Promise<{ doc: Y.Doc; supported: boolean; state: { unreadable?: boolean } }>;
}

/** Lo que le falta a una página en el dispositivo (`contentGap`, clean.ts): sale con lo que hay y un aviso. */
export type ContentGap = 'missing' | 'preparing' | null;

/** Cómo salió una página. */
export interface ExportedPage {
  id: string;
  sheets: number;
  /** Las claves de las unidades donde empieza cada hoja (`b:<bloque>`, `title`, `header`) y a qué altura. */
  breaks: { key: string; offset: number }[];
  content: Pick<PageContent, 'collapsedForAll' | 'unknown'> & { blocks: number };
  /** El dispositivo no puede leer todo lo que tiene la página (sale lo que hay). */
  unreadable: boolean;
  imagesTimedOut: boolean;
  ms: { read: number } & RenderedPage['ms'];
  /** La página no se pudo dibujar: se salteó (el motivo, para el informe). Las demás salen igual. */
  failed?: string;
}

export interface ExportProgress {
  done: number;
  total: number;
  /** La página que se está preparando. */
  title: string;
  /** Qué se está haciendo: dibujar las páginas (lo de siempre) o bajar sus comentarios antes. */
  step?: 'pages' | 'comments';
}

export interface RunOptions {
  signal?: AbortSignal;
  onProgress?: (p: ExportProgress) => void;
  /**
   * Lo que se hace con cada página dibujada (el PDF las junta, el zip las serializa). Si no está, la vista se saca
   * enseguida. Si está, quien la recibe se hace cargo de sacarla. Si devuelve `'stop'`, no se dibuja ninguna más (el
   * PDF en partes: esa página no entró en esta parte y va a la siguiente).
   */
  onPage?: (page: RenderedPage, content: PageContent, plan: ExportPlanPage, out: ExportedPage) => void | 'stop' | Promise<void | 'stop'>;
  /** Una página que no se pudo leer ni dibujar (se saltea y sigue con las demás). */
  onFailed?: (plan: ExportPlanPage, out: ExportedPage) => void | Promise<void>;
}

/**
 * Dibuja, copia y pagina cada página del plan, en orden. Cancelar (`signal`) corta entre páginas o mientras espera
 * imágenes, y tira `ExportCancelled`.
 */
export async function renderPages(plan: ExportPlanPage[], source: ExportSource, editor: ExportEditor, options: RunOptions = {}): Promise<ExportedPage[]> {
  const out: ExportedPage[] = [];
  for (let i = 0; i < plan.length; i++) {
    const page = plan[i];
    if (options.signal?.aborted) throw new ExportCancelled();
    options.onProgress?.({ done: i, total: plan.length, title: page.title });
    const t0 = performance.now();
    let rendered: RenderedPage;
    let content: PageContent;
    let unreadable = false;
    let read = 0;
    try {
      const snap = await source.snapshot(page.id);
      unreadable = !snap.supported || !!snap.state.unreadable;
      // La copia vive hasta dibujar: de ella salen también las anotaciones de las fotos (su mapa aparte).
      try {
        content = readPageContent(snap.doc);
        read = performance.now() - t0;
        rendered = await editor.render(
          { id: page.id, title: page.title, header: page.header, format: page.format, blocks: content.blocks, markup: snap.doc.getMap<unknown>(PHOTO_MARKUP_MAP) },
          { signal: options.signal },
        );
      } finally {
        snap.doc.destroy();
      }
    } catch (err) {
      if (err instanceof ExportCancelled) throw err;
      // Una página mala no corta la exportación: se saltea con su motivo y siguen las demás.
      console.warn('[exportar] no se pudo dibujar la página', page.id, err);
      const failed: ExportedPage = {
        id: page.id,
        sheets: 0,
        breaks: [],
        content: { blocks: 0, collapsedForAll: [], unknown: null },
        unreadable,
        imagesTimedOut: false,
        ms: { read, blocks: 0, images: 0, copy: 0, paginate: 0 },
        failed: err instanceof Error ? err.message : String(err),
      };
      out.push(failed);
      await options.onFailed?.(page, failed);
      continue;
    }
    try {
      const entry: ExportedPage = {
        id: page.id,
        sheets: rendered.sheets,
        breaks: rendered.breaks.map((b) => ({ key: b.key, offset: b.offset })),
        content: { blocks: content.blocks.length, collapsedForAll: content.collapsedForAll, unknown: content.unknown },
        unreadable,
        imagesTimedOut: rendered.imagesTimedOut,
        ms: { read, ...rendered.ms },
      };
      out.push(entry);
      if (options.onPage) {
        if ((await options.onPage(rendered, content, page, entry)) === 'stop') return out;
      } else rendered.view.root.remove();
    } catch (err) {
      rendered.view.root.remove();
      throw err;
    }
  }
  options.onProgress?.({ done: plan.length, total: plan.length, title: '' });
  return out;
}
