import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration, yXmlFragmentToBlocks } from '@blocknote/core/yjs';
import type * as Y from 'yjs';
import type { PageDocs } from '../sync/docs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import type { PageTree } from '../sync/tree';
import type { PageRow } from '../sync/types';
import { editorSchemaOptions, schema } from '../ui/editorSchema';
import { SHARED_COLLAPSE_MAP } from '../ui/collapseEditor';
import { findUnknownContent } from '../ui/unknownContent';
import { isEmptyPage } from './apply';
import { builtinBlocks, type TemplateBlock } from './builtin';
import { BUILTIN_ONSET } from './builtinIds';
import { dateAtStart, dayInTitle, dayReportsMark, isReusableReport, localDate, reportTitle } from './dayReport';
import { fillReport, readFacts, type ReportFacts } from './dayReportFacts';
import { isTemplatePage } from './own';
import { readOwnTemplate } from './ownCopy';

// Crear el reporte del día (Docs/Doc_Plantillas.md, 6.3 a 6.6): leer los reportes de la carpeta (todo está en el
// dispositivo: anda sin red), proponer la fecha, el día y la locación, y crear la página con la plantilla llena. La
// página se crea con la cola del árbol y el contenido se escribe en el documento con la semilla, como la importación
// (`writePage`): primero en IndexedDB, después sube. Nada se borra: los bloques se agregan antes del párrafo vacío.

export interface DayReportDeps {
  tree: PageTree;
  docs: Pick<PageDocs, 'open' | 'close' | 'flush' | 'snapshot'> & Partial<Pick<PageDocs, 'peek'>>;
  engine: { isMissingContent(pageId: string): Promise<boolean>; prefetchPage?(pageId: string, timeoutMs?: number): Promise<boolean> };
}

/** Una plantilla propia de reporte del día, ya leída (entrega 3): sus bloques (ids nuevos) y su colapsado. */
export interface ReportTemplate {
  id: string;
  blocks: TemplateBlock[];
  collapsed: string[];
  /** Fotos y archivos que no se copiaron por ser de otro proyecto (PL10). */
  removed: number;
}

/**
 * Por qué la carpeta usa *On-Set Report* de fábrica en vez de su plantilla (6.2, O4): no la ve (`notShared`), está en la
 * papelera (`gone`), no terminó de bajar (`missing`) o es de una versión más nueva (`newer`). Nunca corta el reporte.
 */
export type ReportTemplateNotice = 'notShared' | 'gone' | 'missing' | 'newer';

/** Un reporte de la carpeta: una página con fecha (en el título o en la fila *Date*). */
export interface ReportEntry {
  id: string;
  title: string;
  date: string;
  day: number | null;
}

export interface DayReportPlan {
  /** Dónde va el reporte: la carpeta (o `null`, la raíz del proyecto). */
  parentId: string | null;
  projectId: string;
  /** Los reportes, en el orden de la carpeta (sin los vacíos de `emptyReports`). */
  reports: ReportEntry[];
  /**
   * Páginas con título de reporte pero sin contenido, completas en el dispositivo: una a la que se le deshizo la
   * plantilla, o una que se creó y no se pudo llenar (auditoría, O2 y O4). No cuentan como reportes y, si la fecha
   * coincide, el reporte nuevo se escribe en ella en vez de crear otra.
   */
  emptyReports: ReportEntry[];
  /** El de fecha más alta (el "de ayer"), o `null` si no hay. */
  last: ReportEntry | null;
  /** Lo que se leyó de `last` (null si no hay, o si no se pudo leer). */
  facts: ReportFacts | null;
  /** `last` todavía no terminó de bajar: lo leído puede estar incompleto (O2). */
  lastIncomplete: boolean;
  /** Lo que el globito propone, editable. */
  suggestion: { date: string; day: number; location: string };
  /** La plantilla de la carpeta (`dayReports.template`), leída; `null`: *On-Set Report* de fábrica. */
  template: ReportTemplate | null;
  /** La carpeta tiene una plantilla que no se pudo usar (se usa la de fábrica, con este aviso). */
  templateNotice: ReportTemplateNotice | null;
}

/** La plantilla que la carpeta de reportes tiene anotada (`dayReports.template`), o `null`. */
export function folderTemplateId(tree: Pick<PageTree, 'get'>, folderId: string | null): string | null {
  const value: unknown = folderId ? tree.get(folderId)?.settings?.dayReports : undefined;
  const id = value && typeof value === 'object' ? (value as { template?: unknown }).template : undefined;
  return typeof id === 'string' && id ? id : null;
}

/**
 * Lee la plantilla de reporte `templateId` para una carpeta del proyecto `projectId` (6.2, O4): si la persona no la ve,
 * está en la papelera, no terminó de bajar o es de una versión más nueva, `null` con el aviso (se usa la de fábrica).
 */
export async function resolveReportTemplate(
  deps: DayReportDeps,
  templateId: string | null | undefined,
  projectId: string,
): Promise<{ template: ReportTemplate | null; notice: ReportTemplateNotice | null }> {
  if (!templateId) return { template: null, notice: null };
  const row = deps.tree.get(templateId);
  if (!row) return { template: null, notice: 'notShared' };
  if (!isTemplatePage(deps.tree, templateId)) return { template: null, notice: 'gone' };
  const read = await readOwnTemplate(deps, templateId, projectId, { wait: 2000 });
  if (read.status !== 'ok') return { template: null, notice: read.status };
  return { template: { id: templateId, blocks: read.blocks, collapsed: read.collapsed, removed: read.removed }, notice: null };
}

/** Cuántos documentos se leen como mucho buscando la fila *Date* de páginas sin fecha en el título. */
const MAX_DATE_READS = 40;
/** Cuántos reportes, de la fecha más alta para atrás, se miran por si están vacíos (los más viejos se dan por llenos). */
const EMPTY_CHECKS = 10;

type Reader = BlockNoteEditor;

function newReader(): Reader {
  // Un editor sin montar, solo para el esquema: no escribe nada en ningún documento.
  return BlockNoteEditor.create({ schema }) as unknown as Reader;
}

function blocksOf(reader: Reader, doc: Y.Doc): never[] {
  return yXmlFragmentToBlocks(reader as never, doc.getXmlFragment(CONTENT_FRAGMENT)) as never[];
}

/**
 * Lee los reportes de `parentId` (o de la raíz de `projectId`) y arma la propuesta del globito (6.3, 6.4). `exclude`: la
 * página que se está llenando (la tira de una página vacía). Lee lo guardado en el dispositivo, sin red.
 */
export async function planDayReport(
  deps: DayReportDeps,
  target: { parentId: string | null; projectId: string },
  options: { exclude?: string; now?: Date } = {},
): Promise<DayReportPlan> {
  const { tree, docs } = deps;
  const siblings: PageRow[] = (target.parentId ? tree.children(target.parentId) : tree.roots(target.projectId)).filter(
    (p) => p.id !== options.exclude,
  );
  let reader: Reader | null = null;
  const read = new Map<string, { facts: ReportFacts | null; empty: boolean }>();
  const readPage = async (id: string): Promise<{ facts: ReportFacts | null; empty: boolean }> => {
    const known = read.get(id);
    if (known) return known;
    let facts: ReportFacts | null = null;
    let empty = false;
    try {
      const saved = await docs.snapshot(id);
      try {
        empty = isEmptyPage(saved.doc);
        // Algo que esta versión no conoce: no se lee (el título sigue valiendo).
        if (saved.supported && !findUnknownContent(saved.doc)) facts = readFacts(blocksOf((reader ??= newReader()), saved.doc));
      } finally {
        saved.doc.destroy();
      }
    } catch (err) {
      console.warn('Reporte del día: no se pudo leer la página', id, err);
    }
    const result = { facts, empty };
    read.set(id, result);
    return result;
  };
  const factsOf = async (id: string) => (await readPage(id)).facts;
  /** Vacía de verdad: lo guardado no tiene nada y no le falta nada del servidor (una a medio bajar se ve vacía). */
  const isEmptyReport = async (id: string) =>
    (await readPage(id)).empty && !(await deps.engine.isMissingContent(id).catch(() => true));

  const reports: ReportEntry[] = [];
  let reads = 0;
  for (const p of siblings) {
    let date = dateAtStart(p.title);
    let day = dayInTitle(p.title);
    if (!date && reads < MAX_DATE_READS) {
      reads++;
      const facts = await factsOf(p.id);
      date = facts?.date ?? null;
      day ??= facts?.day ?? null;
    }
    if (date) reports.push({ id: p.id, title: p.title, date, day });
  }
  // Los reportes vacíos no cuentan (O2): se miran los más recientes, que es donde aparecen (el que se acaba de deshacer o
  // de crear sin poder llenarlo). Solo los que son reportes hechos por la app (`isReusableReport`): una página de la
  // persona con fecha en el título, aunque esté vacía (una carpeta), sigue contando y nunca se reusa (B1).
  const recent = reports
    .filter((r) => isReusableReport(tree, r.id))
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.date === b.r.date ? b.i - a.i : a.r.date < b.r.date ? 1 : -1))
    .slice(0, EMPTY_CHECKS);
  const emptyReports: ReportEntry[] = [];
  for (const { r } of recent) if (await isEmptyReport(r.id)) emptyReports.push(r);
  if (emptyReports.length) reports.splice(0, reports.length, ...reports.filter((r) => !emptyReports.includes(r)));
  // El de fecha más alta; con dos del mismo día, el que está más abajo en la carpeta.
  let last: ReportEntry | null = null;
  for (const r of reports) if (!last || r.date >= last.date) last = r;
  const facts = last ? await factsOf(last.id) : null;
  const lastIncomplete = last ? await deps.engine.isMissingContent(last.id).catch(() => false) : false;
  // Si el de fecha más alta no tiene número (una página de la persona con fecha, "2026-10-04 Fotos de set"), el número
  // más alto de los demás; si ninguno tiene, la cantidad (abajo).
  const days = reports.map((r) => r.day).filter((d): d is number => d !== null);
  const previousDay = facts?.day ?? last?.day ?? (days.length ? Math.max(...days) : null);
  const resolved = await resolveReportTemplate(deps, folderTemplateId(tree, target.parentId), target.projectId);
  return {
    template: resolved.template,
    templateNotice: resolved.notice,
    parentId: target.parentId,
    projectId: target.projectId,
    reports,
    emptyReports,
    last,
    facts,
    lastIncomplete,
    suggestion: {
      date: localDate(options.now),
      day: previousDay ? previousDay + 1 : reports.length + 1,
      location: facts?.location ?? '',
    },
  };
}

/** Los reportes de la carpeta con esa fecha (PL8: *already exists*). */
export function reportsOn(plan: DayReportPlan, date: string): ReportEntry[] {
  return plan.reports.filter((r) => r.date === date);
}

/**
 * El día de rodaje que propone el globito para esa fecha (O1): si ya hay un reporte ese día, su número (*Create
 * another* es una segunda unidad o un día partido: el mismo día de rodaje); si no, el siguiente al último.
 */
export function suggestedDay(plan: DayReportPlan, date: string): number {
  const same = reportsOn(plan, date)
    .map((r) => r.day)
    .filter((d): d is number => d !== null);
  return same.at(-1) ?? plan.suggestion.day;
}

/**
 * Dónde va el reporte (6.5): al final; si la fecha es anterior a la del último, justo antes del primer reporte (en el
 * orden de la carpeta) con fecha mayor, así la carpeta queda en orden. Devuelve el id de esa hermana o `undefined`.
 */
export function placeBefore(plan: DayReportPlan, date: string): string | undefined {
  if (!plan.last || date >= plan.last.date) return undefined;
  return plan.reports.find((r) => r.date > date)?.id;
}

/** Lo que se elige en el globito. */
export interface DayReportInput {
  date: string;
  day: number;
  location: string;
}

/**
 * Los bloques del reporte nuevo: la plantilla (la propia de la carpeta, o *On-Set Report* de fábrica) con la fecha, el
 * día, la locación y lo de ayer, escritos por el rótulo de cada fila (6.4: vale para la de fábrica y para una propia).
 */
export function reportBlocks(
  plan: Pick<DayReportPlan, 'facts'>,
  input: DayReportInput,
  lang: string,
  template: ReportTemplate | null = null,
): TemplateBlock[] {
  return fillReport(template ? template.blocks : builtinBlocks('onset', lang), { ...input, previous: plan.facts }, lang);
}

/**
 * Marca la carpeta de reportes si no tiene marca (6.2: "cada New day report vuelve a escribir `dayReports` si falta").
 * Si se dejó de usar a mano (`false`), no la toca. `template`: la plantilla elegida (`null`, la de fábrica); si es otra
 * que la anotada, se anota (6.5). `undefined`: la anotada no se toca (no se pudo usar, O4).
 */
export async function markReportFolder(tree: PageTree, folderId: string, template?: string | null): Promise<void> {
  const row = tree.get(folderId);
  const mark = dayReportsMark(row);
  if (mark === 'off') return;
  if (mark === null) {
    await tree.setSetting(folderId, 'dayReports', template ? { template } : {});
    return;
  }
  if (template === undefined) return;
  const current = { ...(row!.settings!.dayReports as { template?: string }) };
  if ((current.template ?? null) === template) return;
  if (template) current.template = template;
  else delete current.template;
  await tree.setSetting(folderId, 'dayReports', current);
}

/** La página del reporte quedó creada pero no se pudo escribir su contenido (O4): el reintento la usa. */
export class DayReportWriteError extends Error {
  constructor(
    readonly pageId: string,
    readonly cause: unknown,
  ) {
    super('The day report page was created but its content could not be written.');
  }
}

/**
 * Crea el reporte: la página (con `template_id` de *On-Set Report*, en su lugar de la carpeta), su contenido y la marca de
 * la carpeta (si la persona puede editarla). Devuelve el id de la página. Todo local: sin red, igual.
 *
 * No duplica (O4): con `reuse` (la página que dejó un intento que falló al escribir) o con una página vacía de la
 * carpeta con esa fecha (`plan.emptyReports`), escribe en ella, con el título y la plantilla al día, en vez de crear otra.
 * Solo se escribe en una página vacía y completa: si ya tiene algo (el intento anterior llegó a escribir), no se agrega
 * otra copia. Si escribir falla, tira `DayReportWriteError` con el id, para reintentar sobre la misma página.
 */
export async function createDayReport(
  deps: DayReportDeps,
  plan: DayReportPlan,
  input: DayReportInput,
  lang: string,
  options: {
    canMark: boolean;
    reuse?: string;
    /** La plantilla propia elegida (ya leída); sin ella, *On-Set Report* de fábrica. */
    template?: ReportTemplate | null;
    /** Lo que se anota en la carpeta como su plantilla: `undefined` no la toca (la suya no se pudo usar, O4). */
    markTemplate?: string | null;
  },
): Promise<string> {
  const { tree } = deps;
  const template = options.template ?? null;
  const blocks = reportBlocks(plan, input, lang, template);
  const templateId = template?.id ?? BUILTIN_ONSET;
  const title = reportTitle(input.date, input.day, lang);
  if (plan.parentId && options.canMark) await markReportFolder(tree, plan.parentId, options.markTemplate);
  // Solo un reporte hecho por la app, con su título de reporte y sin subpáginas, de esta carpeta (B1). La vacía se
  // vuelve a comprobar al escribir (`writeNewPage` no escribe en una página con contenido).
  const usable = (id: string | undefined): id is string => {
    const row = id ? tree.get(id) : undefined;
    return !!row && isReusableReport(tree, row.id) && row.parent_id === plan.parentId && row.workspace_id === plan.projectId;
  };
  const candidate = [options.reuse, plan.emptyReports.find((r) => r.date === input.date)?.id].find(usable);
  let id: string;
  if (candidate) {
    id = candidate;
    // Ya tiene la forma de un reporte (`isReusableReport`): solo puede cambiar la fecha o el día que eligió la persona.
    if (tree.get(id)!.title !== title) await tree.rename(id, title);
    if (tree.get(id)!.template_id !== templateId) await tree.setPatch(id, { template_id: templateId });
  } else {
    id = await tree.create(plan.parentId, title, plan.projectId, { templateId, before: placeBefore(plan, input.date) });
  }
  try {
    await writeNewPage(deps.docs, id, blocks, template?.collapsed ?? []);
  } catch (err) {
    throw new DayReportWriteError(id, err);
  }
  return id;
}

/**
 * Escribe los bloques en una página vacía sin abrirla, como lo haría el editor (y como `writePage` de la importación):
 * el documento con la semilla, un editor sin pantalla, y los bloques agregados ANTES del primero (el párrafo vacío de
 * la semilla queda al final). Nunca reemplaza ni borra. Si la página ya tiene contenido (un intento anterior llegó a
 * escribir), no agrega nada: solo espera a que lo de antes quede guardado.
 */
export async function writeNewPage(
  docs: DayReportDeps['docs'],
  pageId: string,
  blocks: TemplateBlock[],
  /** Los títulos colapsados para todos de una plantilla propia (con los ids que traen `blocks`). */
  collapsed: string[] = [],
): Promise<void> {
  const doc = await docs.open(pageId, { seed: true });
  try {
    // Algo que esta versión no conoce: el editor lo borraría. No se toca.
    if (findUnknownContent(doc)) throw new Error('The page has content this version does not know.');
    if (!isEmptyPage(doc)) {
      await docs.flush(pageId);
      return;
    }
    const editor = BlockNoteEditor.create(
      withCollaboration({
        ...editorSchemaOptions,
        collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'Day report', color: '#888888' } },
      }),
    ) as unknown as BlockNoteEditor;
    // y-prosemirror escribe en el documento compartido desde la vista: el editor necesita estar montado.
    const host = document.createElement('div');
    host.style.display = 'none';
    document.body.appendChild(host);
    try {
      editor.mount(host);
      const first = editor.document[0];
      if (!first) throw new Error('The page has no blocks to insert before.');
      editor.insertBlocks(blocks as never[], first.id, 'before');
      if (collapsed.length) {
        const shared = doc.getMap(SHARED_COLLAPSE_MAP);
        doc.transact(() => {
          for (const id of collapsed) shared.set(id, true);
        });
      }
      await docs.flush(pageId);
    } finally {
      editor.unmount();
      host.remove();
    }
  } finally {
    docs.close(pageId);
  }
}
