import { t } from '../i18n';
import '../i18n/lazy/templates';
import type { PageDocs } from '../sync/docs';
import { FILE_SCHEME } from '../sync/files';
import type { PageTree } from '../sync/tree';
import type { PageRow } from '../sync/types';
import { copyTemplateDoc } from './apply';
import { BUILTIN_IDS, BUILTIN_KINDS, builtinBlocks, builtinTexts, type BuiltinKind, type TemplateBlock } from './builtin';
import { dateAtStart, dayReportFolderOf } from './dayReport';
import { cellContent, inlineText, normalizeLabel } from './dayReportFacts';
import { writeNewPage } from './dayReportCreate';
import { settingsFit, templatesFolderOf, templateSetting } from './own';

// Las plantillas propias, la parte que lee y escribe contenido (Docs/Doc_Plantillas.md, 4.2, 5.1 y 5.3; entrega 3): leer
// una plantilla que es una página (una COPIA en memoria: nunca se le escribe nada), sacar las fotos y archivos de otro
// proyecto (PL10), vaciar lo llenado (*Clear filled-in values*), y crear una plantilla nueva en la carpeta *Templates*
// (*Save as template…* y *Customize*). Todo es local: la página se crea con la cola del árbol y el contenido se guarda
// primero en el dispositivo. Se baja con el editor.

/** La dirección de una foto, un video, un adjunto o una carpeta de la app (`sdmedia://`, media/queue.ts) o una imagen vieja. */
const MEDIA_PREFIXES = ['sdmedia://', FILE_SCHEME];

const isAppMedia = (url: unknown) => typeof url === 'string' && MEDIA_PREFIXES.some((p) => url.toLowerCase().startsWith(p));

interface LooseBlock {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: LooseBlock[];
}

/** El contenido en línea sin las fotos de la app (también adentro de un link). Suma cuántas sacó. */
function stripInline(content: unknown, count: { n: number }): unknown {
  if (!Array.isArray(content)) return content;
  const out: unknown[] = [];
  for (const item of content) {
    const loose = item as { type?: string; props?: Record<string, unknown>; content?: unknown };
    if (loose && typeof loose === 'object' && isAppMedia(loose.props?.url)) {
      count.n++;
      continue;
    }
    if (loose && typeof loose === 'object' && Array.isArray(loose.content)) out.push({ ...loose, content: stripInline(loose.content, count) });
    else out.push(item);
  }
  return out;
}

/** Las celdas de una tabla, con su contenido pasado por `fn`. */
function mapCells(content: unknown, fn: (cell: unknown, row: number, col: number, table: Record<string, unknown>) => unknown): unknown {
  const table = content as { type?: string; rows?: { cells?: unknown[] }[] } | undefined;
  if (!table || table.type !== 'tableContent' || !Array.isArray(table.rows)) return content;
  return {
    ...table,
    rows: table.rows.map((row, r) => ({
      ...row,
      cells: Array.isArray(row.cells) ? row.cells.map((cell, c) => fn(cell, r, c, table as Record<string, unknown>)) : row.cells,
    })),
  };
}

/** Una celda con otro contenido, en la misma forma que tenía (texto, lista o `tableCell` con sus ajustes). */
function withCellContent(cell: unknown, next: unknown): unknown {
  if (cell && typeof cell === 'object' && !Array.isArray(cell) && (cell as { type?: string }).type === 'tableCell') {
    return { ...(cell as object), content: next };
  }
  return next;
}

/**
 * Saca de los bloques todas las fotos, videos, adjuntos y carpetas de la app (`sdmedia://` y `sdfile://`): los bloques
 * de foto, las fotos en línea y las de las celdas (PL10). Lo demás queda como está, también las tarjetas de Drive (un
 * link escrito). Si un bloque de foto tuviera bloques adentro, esos quedan en su lugar. Devuelve cuántas sacó.
 */
export function stripAppMedia(blocks: TemplateBlock[]): { blocks: TemplateBlock[]; removed: number } {
  const count = { n: 0 };
  const walk = (list: LooseBlock[]): LooseBlock[] =>
    list.flatMap((b) => {
      const children = walk(b.children ?? []);
      if (isAppMedia(b.props?.url)) {
        count.n++;
        return children;
      }
      let content = b.content;
      if (b.type === 'table') content = mapCells(content, (cell) => withCellContent(cell, stripInline(cellContent(cell), count)));
      else content = stripInline(content, count);
      return [{ ...b, content, children }];
    });
  const out = walk(structuredClone(blocks) as LooseBlock[]);
  return { blocks: out as TemplateBlock[], removed: count.n };
}

// --- *Clear filled-in values* (5.1) --------------------------------------------------------------------------------

/**
 * Los rótulos de la primera columna de las tablas de las de fábrica (*Camera package*: A, B; *Measurements*; *Data*),
 * por la fila de encabezado de su tabla, en los dos idiomas. Son estructura, no datos: *Clear filled-in values* los deja.
 */
let builtinLabels: Map<string, Set<string>> | null = null;

const headerKey = (cells: unknown[]) => cells.map((c) => normalizeLabel(inlineText(cellContent(c)))).join('\u0001');

function labelsOfBuiltins(): Map<string, Set<string>> {
  if (builtinLabels) return builtinLabels;
  const map = new Map<string, Set<string>>();
  for (const lang of ['en', 'es']) {
    for (const kind of BUILTIN_KINDS) {
      for (const block of builtinBlocks(kind, lang) as LooseBlock[]) {
        const table = block.content as { headerRows?: number; rows?: { cells: unknown[] }[] } | undefined;
        if (block.type !== 'table' || !table?.rows?.length || !table.headerRows) continue;
        const key = headerKey(table.rows[0].cells);
        const set = map.get(key) ?? new Set<string>();
        for (const row of table.rows.slice(table.headerRows)) {
          const label = normalizeLabel(inlineText(cellContent(row.cells[0])));
          if (label) set.add(label);
        }
        if (set.size) map.set(key, set);
      }
    }
  }
  builtinLabels = map;
  return map;
}

/**
 * Vacía lo llenado de una página para guardarla como plantilla (5.1, *Clear filled-in values*): las celdas de las tablas
 * salvo las filas y columnas de encabezado, la primera columna de las tablas de datos (2 columnas: los rótulos de la
 * ficha) y los rótulos de las tablas de las de fábrica (*Camera package*, *Measurements*, *Data*); desmarca las casillas
 * y saca fotos y archivos. Los títulos, los párrafos y las viñetas quedan: son la estructura de la plantilla.
 */
export function clearFilledIn(blocks: TemplateBlock[]): TemplateBlock[] {
  const labels = labelsOfBuiltins();
  const walk = (list: LooseBlock[]): LooseBlock[] =>
    list.map((b) => {
      const children = walk(b.children ?? []);
      if (b.type === 'checkListItem') return { ...b, props: { ...b.props, checked: false }, children };
      if (b.type !== 'table') return { ...b, children };
      const table = b.content as { headerRows?: number; headerCols?: number; rows?: { cells: unknown[] }[] } | undefined;
      const rows = table?.rows ?? [];
      const known = rows.length ? labels.get(headerKey(rows[0].cells)) : undefined;
      const columns = Math.max(0, ...rows.map((r) => (Array.isArray(r.cells) ? r.cells.length : 0)));
      const content = mapCells(b.content, (cell, r, c) => {
        const keep =
          r < (table?.headerRows ?? 0) ||
          c < (table?.headerCols ?? 0) ||
          (c === 0 && columns === 2) ||
          (c === 0 && !!known?.has(normalizeLabel(inlineText(cellContent(cell)))));
        if (keep) return cell;
        return withCellContent(cell, typeof cellContent(cell) === 'string' ? '' : []);
      });
      return { ...b, content, children };
    });
  return stripAppMedia(walk(structuredClone(blocks) as LooseBlock[]) as TemplateBlock[]).blocks;
}

// --- Leer una plantilla que es una página (4.2, pasos 1 a 3) ----------------------------------------------------------

export interface OwnTemplateDeps {
  tree: PageTree;
  docs: Pick<PageDocs, 'open' | 'close' | 'flush' | 'snapshot'> & Partial<Pick<PageDocs, 'peek'>>;
  engine: { isMissingContent(pageId: string): Promise<boolean>; prefetchPage?(pageId: string, timeoutMs?: number): Promise<boolean> };
}

/** Una plantilla propia lista para copiar. */
export interface ReadTemplate {
  status: 'ok';
  row: PageRow;
  blocks: TemplateBlock[];
  /** Los ids (nuevos) de los títulos colapsados para todos en la plantilla. */
  collapsed: string[];
  /** Fotos y archivos que no se copiaron por ser de otro proyecto (PL10). */
  removed: number;
}

/**
 * Por qué no se puede copiar: `gone` (ya no está en el dispositivo o está en la papelera), `missing` (no terminó de bajar:
 * nunca se copia a medias), `newer` (tiene algo que esta versión no conoce: copiarla lo perdería).
 */
export type ReadTemplateResult = ReadTemplate | { status: 'gone' | 'missing' | 'newer' };

/**
 * Los bloques de una página (plantilla o página a guardar como plantilla), leídos de una copia en memoria: lo vivo si
 * está abierta (con lo recién escrito), si no lo guardado en el dispositivo. Primero se mira que esté entera (si le falta
 * algo del servidor, se intenta bajar un rato; si sigue faltando, `missing`).
 */
export async function readPageCopy(deps: OwnTemplateDeps, pageId: string, options: { wait?: number } = {}): Promise<ReadTemplateResult> {
  const row = deps.tree.get(pageId);
  if (!row || deps.tree.isTrashed(pageId)) return { status: 'gone' };
  let missing = await deps.engine.isMissingContent(pageId).catch(() => true);
  if (missing && deps.engine.prefetchPage) missing = !(await deps.engine.prefetchPage(pageId, options.wait ?? 4000).catch(() => false));
  if (missing) return { status: 'missing' };
  const live = deps.docs.peek?.(pageId);
  let copy: ReturnType<typeof copyTemplateDoc>;
  if (live) copy = copyTemplateDoc(live);
  else {
    const saved = await deps.docs.snapshot(pageId);
    try {
      if (!saved.supported) return { status: 'newer' };
      copy = copyTemplateDoc(saved.doc);
    } finally {
      saved.doc.destroy();
    }
  }
  if (!copy.ok) return { status: 'newer' };
  return { status: 'ok', row, blocks: copy.blocks, collapsed: copy.collapsed, removed: 0 };
}

/**
 * Una plantilla propia para usar en una página del proyecto `projectId` (4.2): la copia, y si la plantilla es de otro
 * proyecto, sin sus fotos y archivos (que ahí solo mostrarían la tarjeta de "otro proyecto"; PL10, se decide sin red).
 */
export async function readOwnTemplate(deps: OwnTemplateDeps, templateId: string, projectId: string, options: { wait?: number } = {}): Promise<ReadTemplateResult> {
  const read = await readPageCopy(deps, templateId, options);
  if (read.status !== 'ok' || read.row.workspace_id === projectId) return read;
  const stripped = stripAppMedia(read.blocks);
  return { ...read, blocks: stripped.blocks, removed: stripped.removed };
}

/** El aviso de por qué no se usó una plantilla. */
export function readFailureText(status: 'gone' | 'missing' | 'newer'): string {
  if (status === 'newer') return t('templates.newer');
  if (status === 'missing') return t('templates.notDownloaded');
  return t('templates.gone');
}

// --- Crear una plantilla (5.1 y 5.3) --------------------------------------------------------------------------------

/**
 * La carpeta *Templates* del proyecto; si no hay, la crea al final de la raíz (con `templatesFolder`). Sin red, igual.
 */
export async function ensureTemplatesFolder(tree: PageTree, projectId: string): Promise<string> {
  const found = templatesFolderOf(tree, projectId);
  if (found) return found.id;
  const id = await tree.create(null, t('templates.folderName'), projectId);
  await tree.setSetting(id, 'templatesFolder', true);
  return id;
}

/** Crea la página de la plantilla en *Templates*, con su marca, y le escribe los bloques. Devuelve su id. */
async function createTemplatePage(
  deps: OwnTemplateDeps,
  projectId: string,
  page: { title: string; templateId?: string | null; description: string; dayReport: boolean },
  blocks: TemplateBlock[],
  collapsed: string[],
): Promise<string> {
  const setting = templateSetting(page);
  if (!settingsFit(undefined, { template: setting })) throw new TemplateTooLarge();
  const folder = await ensureTemplatesFolder(deps.tree, projectId);
  const id = await deps.tree.create(folder, page.title.trim() || t('templates.untitled'), projectId, page.templateId ? { templateId: page.templateId } : {});
  await deps.tree.setSetting(id, 'template', setting);
  await writeNewPage(deps.docs, id, blocks, collapsed);
  return id;
}

/** Los ajustes no entran en el tope de la base (2000 caracteres): no se guarda nada a medias. */
export class TemplateTooLarge extends Error {
  constructor() {
    super('The template settings do not fit.');
  }
}

/** Una página que no se pudo leer para guardarla como plantilla (`missing` o `newer`): no se crea nada. */
export class TemplateReadError extends Error {
  constructor(readonly status: 'gone' | 'missing' | 'newer') {
    super(`The page could not be read (${status}).`);
  }
}

export interface SaveAsTemplateInput {
  name: string;
  description: string;
  dayReport: boolean;
  /** *Clear filled-in values*: vacía tablas y casillas, saca fotos y archivos. */
  clear: boolean;
}

/**
 * *Save as template…* (5.1): copia la página (una copia en memoria: la página no cambia) a *Templates* (la crea si falta),
 * con el nombre, la descripción y la marca. La plantilla guarda de qué plantilla salió la página (`template_id`), para
 * *Use built-in*. Con *Use for day reports* y la página en una carpeta de reportes, esa carpeta pasa a usarla
 * (`dayReports.template`) si la persona puede editarla: el próximo *New day report* sale de ella. Devuelve el id.
 */
export async function saveAsTemplate(
  deps: OwnTemplateDeps,
  sourceId: string,
  input: SaveAsTemplateInput,
  options: { canMarkFolder: (folderId: string) => boolean },
): Promise<string> {
  const read = await readPageCopy(deps, sourceId);
  if (read.status !== 'ok') throw new TemplateReadError(read.status);
  const blocks = input.clear ? clearFilledIn(read.blocks) : read.blocks;
  const id = await createTemplatePage(
    deps,
    read.row.workspace_id,
    { title: input.name, templateId: read.row.template_id, description: input.description, dayReport: input.dayReport },
    blocks,
    read.collapsed,
  );
  if (input.dayReport) {
    const folder = dayReportFolderOf(deps.tree, sourceId);
    if (folder && options.canMarkFolder(folder)) await deps.tree.setSetting(folder, 'dayReports', { template: id });
  }
  return id;
}

/** El nombre que propone *Save as template…*: el título; un reporte del día (`2026-10-02 | Day 06`), *On-Set Report*. */
export function suggestedTemplateName(row: PageRow | undefined, lang: string): string {
  if (!row) return '';
  if (dateAtStart(row.title)) return builtinTexts(lang).names.onset;
  return row.title;
}

/**
 * *Customize* (5.3): una copia de una de fábrica en *Templates* del proyecto, con su nombre y su descripción, para
 * editarla. *On-Set Report* queda marcada para el reporte del día. Devuelve el id (la ventana la abre).
 */
export async function customizeBuiltin(deps: OwnTemplateDeps, kind: BuiltinKind, projectId: string, lang: string): Promise<string> {
  const texts = builtinTexts(lang);
  return createTemplatePage(
    deps,
    projectId,
    { title: texts.names[kind], templateId: BUILTIN_IDS[kind], description: texts.descriptions[kind], dayReport: kind === 'onset' },
    builtinBlocks(kind, lang),
    [],
  );
}
