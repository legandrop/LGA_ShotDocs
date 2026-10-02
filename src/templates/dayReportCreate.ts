import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration, yXmlFragmentToBlocks } from '@blocknote/core/yjs';
import type * as Y from 'yjs';
import type { PageDocs } from '../sync/docs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import type { PageTree } from '../sync/tree';
import type { PageRow } from '../sync/types';
import { editorSchemaOptions, schema } from '../ui/editorSchema';
import { findUnknownContent } from '../ui/unknownContent';
import { builtinBlocks, type TemplateBlock } from './builtin';
import { BUILTIN_ONSET } from './builtinIds';
import { dateAtStart, dayInTitle, dayReportsMark, fillReport, localDate, readFacts, reportTitle, type ReportFacts } from './dayReport';

// Crear el reporte del día (Docs/Doc_Plantillas.md, 6.3 a 6.6): leer los reportes de la carpeta (todo está en el
// dispositivo: anda sin red), proponer la fecha, el día y la locación, y crear la página con la plantilla llena. La
// página se crea con la cola del árbol y el contenido se escribe en el documento con la semilla, como la importación
// (`writePage`): primero en IndexedDB, después sube. Nada se borra: los bloques se agregan antes del párrafo vacío.

export interface DayReportDeps {
  tree: PageTree;
  docs: Pick<PageDocs, 'open' | 'close' | 'flush' | 'snapshot'>;
  engine: { isMissingContent(pageId: string): Promise<boolean> };
}

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
  /** Los reportes, en el orden de la carpeta. */
  reports: ReportEntry[];
  /** El de fecha más alta (el "de ayer"), o `null` si no hay. */
  last: ReportEntry | null;
  /** Lo que se leyó de `last` (null si no hay, o si no se pudo leer). */
  facts: ReportFacts | null;
  /** `last` todavía no terminó de bajar: lo leído puede estar incompleto (O2). */
  lastIncomplete: boolean;
  /** Lo que el globito propone, editable. */
  suggestion: { date: string; day: number; location: string };
}

/** Cuántos documentos se leen como mucho buscando la fila *Date* de páginas sin fecha en el título. */
const MAX_DATE_READS = 40;

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
  const read = new Map<string, ReportFacts | null>();
  const factsOf = async (id: string): Promise<ReportFacts | null> => {
    if (read.has(id)) return read.get(id)!;
    let facts: ReportFacts | null = null;
    try {
      const saved = await docs.snapshot(id);
      try {
        // Algo que esta versión no conoce: no se lee (el título sigue valiendo).
        if (saved.supported && !findUnknownContent(saved.doc)) facts = readFacts(blocksOf((reader ??= newReader()), saved.doc));
      } finally {
        saved.doc.destroy();
      }
    } catch (err) {
      console.warn('Reporte del día: no se pudo leer la página', id, err);
    }
    read.set(id, facts);
    return facts;
  };

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
  // El de fecha más alta; con dos del mismo día, el que está más abajo en la carpeta.
  let last: ReportEntry | null = null;
  for (const r of reports) if (!last || r.date >= last.date) last = r;
  const facts = last ? await factsOf(last.id) : null;
  const lastIncomplete = last ? await deps.engine.isMissingContent(last.id).catch(() => false) : false;
  const previousDay = facts?.day ?? last?.day ?? null;
  return {
    parentId: target.parentId,
    projectId: target.projectId,
    reports,
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

/** Los bloques del reporte nuevo: la plantilla *On-Set Report* con la fecha, el día, la locación y lo de ayer. */
export function reportBlocks(plan: DayReportPlan, input: DayReportInput, lang: string): TemplateBlock[] {
  return fillReport(builtinBlocks('onset', lang), { ...input, previous: plan.facts }, lang);
}

/**
 * Marca la carpeta de reportes si no tiene marca (6.2: "cada New day report vuelve a escribir `dayReports` si falta").
 * Si se dejó de usar a mano (`false`), no la toca.
 */
export async function markReportFolder(tree: PageTree, folderId: string): Promise<void> {
  if (dayReportsMark(tree.get(folderId)) !== null) return;
  await tree.setSetting(folderId, 'dayReports', {});
}

/**
 * Crea el reporte: la página (con `template_id` de *On-Set Report*, en su lugar de la carpeta), su contenido y la marca de
 * la carpeta (si la persona puede editarla). Devuelve el id de la página nueva. Todo local: sin red, igual.
 */
export async function createDayReport(
  deps: DayReportDeps,
  plan: DayReportPlan,
  input: DayReportInput,
  lang: string,
  options: { canMark: boolean },
): Promise<string> {
  const blocks = reportBlocks(plan, input, lang);
  if (plan.parentId && options.canMark) await markReportFolder(deps.tree, plan.parentId);
  const id = await deps.tree.create(plan.parentId, reportTitle(input.date, input.day, lang), plan.projectId, {
    templateId: BUILTIN_ONSET,
    before: placeBefore(plan, input.date),
  });
  await writeNewPage(deps.docs, id, blocks);
  return id;
}

/**
 * Escribe los bloques en una página nueva sin abrirla, como lo haría el editor (y como `writePage` de la importación):
 * el documento con la semilla, un editor sin pantalla, y los bloques agregados ANTES del primero (el párrafo vacío de
 * la semilla queda al final). Nunca reemplaza: si algo ya estaba, queda debajo.
 */
export async function writeNewPage(docs: DayReportDeps['docs'], pageId: string, blocks: TemplateBlock[]): Promise<void> {
  const doc = await docs.open(pageId, { seed: true });
  try {
    // Una página recién creada no puede tener nada desconocido; si lo tuviera, el editor lo borraría: no se toca.
    if (findUnknownContent(doc)) throw new Error('The page has content this version does not know.');
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
      await docs.flush(pageId);
    } finally {
      editor.unmount();
      host.remove();
    }
  } finally {
    docs.close(pageId);
  }
}
