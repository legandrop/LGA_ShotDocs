import type * as Y from 'yjs';
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
}

export interface ExportProgress {
  done: number;
  total: number;
  /** La página que se está preparando. */
  title: string;
}

export interface RunOptions {
  signal?: AbortSignal;
  onProgress?: (p: ExportProgress) => void;
  /**
   * Lo que se hace con cada página dibujada (el PDF las junta, el zip las serializa). Si no está, la vista se saca
   * enseguida. Si está, quien la recibe se hace cargo de sacarla.
   */
  onPage?: (page: RenderedPage, content: PageContent, plan: ExportPlanPage) => void | Promise<void>;
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
    const snap = await source.snapshot(page.id);
    let content: PageContent;
    try {
      content = readPageContent(snap.doc);
    } finally {
      snap.doc.destroy();
    }
    const read = performance.now() - t0;
    const rendered = await editor.render(
      { id: page.id, title: page.title, header: page.header, format: page.format, blocks: content.blocks },
      { signal: options.signal },
    );
    try {
      out.push({
        id: page.id,
        sheets: rendered.sheets,
        breaks: rendered.breaks.map((b) => ({ key: b.key, offset: b.offset })),
        content: { blocks: content.blocks.length, collapsedForAll: content.collapsedForAll, unknown: content.unknown },
        unreadable: !snap.supported || !!snap.state.unreadable,
        imagesTimedOut: rendered.imagesTimedOut,
        ms: { read, ...rendered.ms },
      });
      if (options.onPage) await options.onPage(rendered, content, page);
      else rendered.view.root.remove();
    } catch (err) {
      rendered.view.root.remove();
      throw err;
    }
  }
  options.onProgress?.({ done: plan.length, total: plan.length, title: '' });
  return out;
}
