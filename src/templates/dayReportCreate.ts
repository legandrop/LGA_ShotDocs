import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration, yXmlFragmentToBlocks } from '@blocknote/core/yjs';
import type * as Y from 'yjs';
import { carryMarkup, type CopiedPhoto } from '../media/markupClipboard';
import { mediaIdsInDoc } from '../media/usage';
import type { PageDocs } from '../sync/docs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import type { PageTree } from '../sync/tree';
import type { PageRow } from '../sync/types';
import { editorSchemaOptions, schema } from '../ui/editorSchema';
import { SHARED_COLLAPSE_MAP } from '../ui/collapseEditor';
import { findUnknownContent } from '../ui/unknownContent';
import { isEmptyPage } from './apply';
import { builtinBlocks, builtinTexts, type TemplateBlock } from './builtin';
import { BUILTIN_ONSET, BUILTIN_PLAN } from './builtinIds';
import { dateAtStart, dayInTitle, dayReportsMark, isReusableReport, localDate, newDayTitle, planTitleFor, weekOf } from './dayReport';
import { fillReport, readFacts, type ReportFacts } from './dayReportFacts';
import { isTemplatePage } from './own';
import { readOwnTemplate } from './ownCopy';
import { onlyTitleRests, TITLE_REST_PREFIX } from '../sync/titleRest';
import { isDayPlanRow } from '../relations/kind';

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
  /** Las anotaciones de las fotos de la plantilla (P.20, D46); vacío si es de otro proyecto o no tiene. */
  markup?: CopiedPhoto[];
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
   * Los planes de jornada de la carpeta con fecha en el título, en su orden (D813: el plan va al lado de su reporte). No
   * son reportes: no se copian, no cuentan para el número de día ni para «ya existe» del reporte.
   */
  plans: ReportEntry[];
  /** Las páginas de la carpeta, en su orden (para ubicar el reporte o el plan nuevo entre los dos). */
  order: string[];
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
  return { template: { id: templateId, blocks: read.blocks, collapsed: read.collapsed, markup: read.markup, removed: read.removed }, notice: null };
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
 * página que se está llenando (la tira de una página vacía). Lee lo guardado en el dispositivo, sin red. `skipTemplate`:
 * no lee la plantilla de la carpeta (para quien solo quiere saber qué reportes hay).
 */
export async function planDayReport(
  deps: DayReportDeps,
  target: { parentId: string | null; projectId: string },
  options: { exclude?: string; now?: Date; skipTemplate?: boolean } = {},
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
  const plans: ReportEntry[] = [];
  let reads = 0;
  for (const p of siblings) {
    // Un plan al lado de su reporte (D813) no es un reporte: ni lo de ayer, ni el número de día, ni «ya existe».
    if (isDayPlanRow(p)) {
      const date = dateAtStart(p.title);
      if (date) plans.push({ id: p.id, title: p.title, date, day: dayInTitle(p.title) });
      continue;
    }
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
  // El primer día de una semana nueva (`Semana 2`, todavía vacía): «ayer» es el último reporte de las semanas de antes
  // (y de la carpeta de días), para seguir su número y copiar su unidad, equipo y cámara; si no, proponía «Día 01» sin
  // nada de ayer (auditoría de v0.305). Solo para eso: lo demás (ya existe, el orden) sigue mirando la semana.
  const week = !reports.length ? weekOf(tree, target.parentId) : null;
  let lastFolder: string | null = last ? target.parentId : null;
  if (week) {
    const before: { row: PageRow; folder: string }[] = [];
    for (const s of tree.children(week.days)) {
      if (s.id === week.week) break;
      // Solo días con número (`2026-02-19 | Día 59`): un «2026-02-19 | Call sheet» no es el de ayer.
      const isDay = (r: PageRow) => dateAtStart(r.title) !== null && dayInTitle(r.title) !== null;
      if (isDay(s)) before.push({ row: s, folder: week.days });
      else for (const c of tree.children(s.id)) if (isDay(c)) before.push({ row: c, folder: s.id });
    }
    for (const { row, folder } of before) {
      if (isDayPlanRow(row)) continue;
      const date = dateAtStart(row.title)!;
      if (!last || date >= last.date) {
        last = { id: row.id, title: row.title, date, day: dayInTitle(row.title) };
        lastFolder = folder;
      }
    }
  }
  const facts = last ? await factsOf(last.id) : null;
  const lastIncomplete = last ? await deps.engine.isMissingContent(last.id).catch(() => false) : false;
  // Si el de fecha más alta no tiene número (una página de la persona con fecha, "2026-10-04 Fotos de set"), el número
  // más alto de los demás; si ninguno tiene, la cantidad (abajo).
  const days = reports.map((r) => r.day).filter((d): d is number => d !== null);
  const previousDay = facts?.day ?? last?.day ?? (days.length ? Math.max(...days) : null);
  // La plantilla de la carpeta; en una semana sin la suya, la de la carpeta de días o la de la semana de «ayer».
  const templateId = folderTemplateId(tree, target.parentId) ?? (week ? (folderTemplateId(tree, week.days) ?? folderTemplateId(tree, lastFolder)) : null);
  const resolved = options.skipTemplate ? { template: null, notice: null } : await resolveReportTemplate(deps, templateId, target.projectId);
  return {
    template: resolved.template,
    templateNotice: resolved.notice,
    parentId: target.parentId,
    projectId: target.projectId,
    reports,
    plans,
    order: siblings.map((p) => p.id),
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

/** Los planes de jornada de la carpeta con esa fecha (D813). */
export function plansOn(plan: Pick<DayReportPlan, 'plans'>, date: string): ReportEntry[] {
  return (plan.plans ?? []).filter((p) => p.date === date);
}

/** `AAAA-MM-DD` + `n` días, en el calendario. */
function nextDate(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/**
 * La fecha que propone *New day plan* (D813): el plan se escribe antes de filmar, así que hoy si todavía no tiene reporte
 * y si no mañana; y la primera de ahí en adelante que todavía no tiene plan (una semana como mucho).
 */
export function suggestedPlanDate(plan: Pick<DayReportPlan, 'reports' | 'plans'>, today: string): string {
  let date = plan.reports.some((r) => r.date === today) ? nextDate(today, 1) : today;
  for (let i = 0; i < 7 && plansOn(plan, date).length; i++) date = nextDate(date, 1);
  return date;
}

/**
 * El título de un plan nuevo (D813, idea de Lega: el mismo nombre que su reporte, con « | Plan»): el del reporte de esa
 * fecha si ya existe; si no, el que le va a poner *New day report* (fecha, día y la locación escrita, `newDayTitle`).
 * Si la carpeta ya tiene un plan con ese título (*Create another*), « | Plan · 2», « · 3»…
 */
export function dayPlanTitle(plan: Pick<DayReportPlan, 'reports'> & Partial<Pick<DayReportPlan, 'plans'>>, input: DayReportInput, lang: string): string {
  const report = plan.reports.filter((r) => r.date === input.date).at(-1);
  const like = plan.reports.at(-1)?.title ?? plan.plans?.at(-1)?.title;
  const base = planTitleFor(report ? report.title : newDayTitle(like, input.date, input.day, lang, input.location));
  const taken = new Set((plan.plans ?? []).map((p) => p.title.trim()));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} · ${n}`)) n++;
  return `${base} · ${n}`;
}

/**
 * *New day plan* (D813): el plan de jornada con la plantilla *Day plan* (la fecha, el día y la locación escritos), la
 * marca de plan y, si el reporte de esa fecha ya existe, el puntero a él; en la carpeta, justo arriba de su reporte o
 * antes del primer reporte o plan de una fecha mayor. Todo local: sin red, igual. Nada se copia de ayer (eso es del
 * reporte).
 */
export async function createDayPlan(
  deps: DayReportDeps,
  plan: DayReportPlan,
  input: DayReportInput,
  lang: string,
  /**
   * `title`: el de *Plan tomorrow*; `reuse`: la página de un intento que no pudo escribir el contenido (no se crea otra);
   * `scenes`: las escenas que el desglose planea para esa fecha (`PlanScene`: el número con link y el nombre), una por renglón de la tabla
   * *Scenes* (D820): así el plan nace unido a ellas.
   */
  options: { title?: string; reuse?: string; scenes?: (string | PlanScene)[] } = {},
): Promise<string> {
  const { tree } = deps;
  const blocks = withPlanScenes(fillReport(builtinBlocks('dayPlan', lang), { ...input, previous: null }, lang), options.scenes ?? [], lang);
  const reports = plan.reports.filter((r) => r.date === input.date && tree.get(r.id) && !tree.isTrashed(r.id));
  const title = options.title || dayPlanTitle(plan, input, lang);
  const old = options.reuse ? tree.get(options.reuse) : undefined;
  const reuse = old && !tree.isTrashed(old.id) && old.parent_id === plan.parentId ? old.id : null;
  // Un reintento con otra fecha o con otro día cambia el título, como el del reporte (O4): `writeNewPage` igual no
  // escribe en una página que ya tiene algo.
  if (reuse && old!.title !== title) await tree.rename(reuse, title);
  const id =
    reuse ??
    (await tree.create(plan.parentId, title, plan.projectId, {
      templateId: BUILTIN_PLAN,
      before: placeBefore(plan, input.date, true),
    }));
  // La marca explícita (y el puntero, con un solo reporte de esa fecha): no depende del título ni de la carpeta.
  await tree.setSetting(id, 'entity', reports.length === 1 ? { kind: 'plan', day: reports[0].id } : { kind: 'plan' });
  try {
    await writeNewPage(deps.docs, id, blocks, [], []);
  } catch (err) {
    throw new DayReportWriteError(id, err);
  }
  return id;
}

/** Una escena del plan nuevo: su número, su página (el link) y su nombre. */
export interface PlanScene {
  code: string;
  pageId: string | null;
  name: string;
}

/**
 * La tabla *Scenes* de la plantilla del plan con una escena por renglón (sin escenas, queda como está). Cada escena va
 * con su número como link a su página, como las secciones del reporte: así la cabecera del reporte de ese día lee las
 * escenas del plan (un número suelto en una tabla no se reconoce como escena).
 */
export function withPlanScenes(blocks: TemplateBlock[], scenes: (string | PlanScene)[], lang: string): TemplateBlock[] {
  if (!scenes.length) return blocks;
  const heading = builtinTexts(lang).dayPlan.scenes;
  const at = blocks.findIndex((b) => b.type === 'heading' && b.content === heading);
  const table = blocks[at + 1];
  if (at < 0 || table?.type !== 'table') return blocks;
  const content = table.content as { rows: { cells: unknown[] }[] };
  // Los renglones vacíos de la plantilla dejan su lugar a las escenas.
  const [header] = content.rows;
  const rows = scenes.map((s) => ({ cells: header.cells.map((_, i) => (i === 0 ? planSceneCell(s) : '')) }));
  const out = [...blocks];
  out[at + 1] = { ...table, content: { ...content, rows: [header, ...rows] } };
  return out;
}

function planSceneCell(s: string | PlanScene): unknown {
  if (typeof s === 'string') return s;
  if (!s.pageId) return s.name ? `${s.code} | ${s.name}` : s.code;
  return [
    { type: 'link', href: `/p/${s.pageId}`, content: [{ type: 'text', text: s.code, styles: {} }] },
    ...(s.name ? [{ type: 'text', text: ` | ${s.name}`, styles: {} }] : []),
  ];
}

/**
 * El día de rodaje que propone el globito para esa fecha (O1): si ya hay un reporte ese día, su número (*Create
 * another* es una segunda unidad o un día partido: el mismo día de rodaje); si no, el del plan de esa fecha (si no,
 * plan y reporte no se unirían: se conectan por fecha y número de día, verificación de v0.306); si no, el siguiente al
 * último. Un plan de otra fecha no cuenta.
 */
export function suggestedDay(plan: DayReportPlan, date: string): number {
  const same = reportsOn(plan, date)
    .map((r) => r.day)
    .filter((d): d is number => d !== null);
  const planned = plansOn(plan, date)
    .map((p) => p.day)
    .filter((d): d is number => d !== null);
  return same.at(-1) ?? planned[0] ?? plan.suggestion.day;
}

/** Un lugar escrito, para comparar: sin mayúsculas, acentos ni espacios de más. */
const samePlace = (a: string, b: string) => {
  const n = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return n(a) === n(b);
};

/**
 * El lugar que va al título de un reporte nuevo (D814): el que se escribió (`typed`: la persona tocó el campo, aunque
 * vuelva a poner el de ayer); si es el de ayer que el globito propone y nadie tocó, solo si el plan de esa fecha lo
 * nombra en su título (el día sigue en el mismo lugar, y está planeado). Si no, ninguno: el título es de donde el
 * Overview saca dónde se filmó (D398), y la locación de ayer copiada sola lo diría mal (D574). Con `typed === false` (el
 * globito sabe que nadie tocó el campo), una locación sin tocar va solo si la nombra el plan de esa fecha, sea cual sea
 * (verificación de v0.306); sin ese dato, la que no es la de ayer se toma por escrita.
 */
export function titlePlace(plan: Pick<DayReportPlan, 'suggestion'> & Partial<Pick<DayReportPlan, 'plans'>>, input: DayReportInput, typed?: boolean): string {
  const place = input.location.trim();
  if (!place || typed) return place;
  if (typed === undefined && !samePlace(place, plan.suggestion.location)) return place;
  const planned = (plan.plans ?? []).filter((p) => p.date === input.date).some((p) => p.title.split('|').some((part) => samePlace(part, place)));
  return planned ? place : '';
}

/**
 * Lo que propone *New day report* abierto desde un plan de jornada (simulación de D813): su fecha, su número de día y su
 * lugar (la parte del título que no es la fecha, el día ni «Plan»), si esa fecha todavía no tiene reporte en la carpeta.
 * Si no, `null`: la propuesta de siempre (el día siguiente al último reporte).
 */
export function planProposal(tree: Pick<PageTree, 'get'>, pageId: string, plan: Pick<DayReportPlan, 'reports'>): { date: string; day: number | null; location: string } | null {
  const row = tree.get(pageId);
  if (!row || !isDayPlanRow(row)) return null;
  const date = dateAtStart(row.title);
  if (!date || plan.reports.some((r) => r.date === date)) return null;
  return { date, day: dayInTitle(row.title), location: planTitlePlace(row.title) };
}

/**
 * El lugar del título de un plan (`2026-11-04 | Día 02 | Bar El Puerto | Plan`): la parte que no es fecha, día, unidad
 * (`U2`, `Unidad 2`) ni «Plan».
 */
function planTitlePlace(title: string): string {
  const parts = title.split('|').map((p) => p.trim());
  return parts.slice(1).find((p) => p && dayInTitle(p) === null && dateAtStart(p) === null && !/^plan(?:\s*·.*)?$/i.test(p) && !/^(?:u|unidad|unit)\s*\d+$/i.test(p)) ?? '';
}

/**
 * La locación del plan de esa fecha de la carpeta, si hay uno y su título la nombra: *New day report* la propone en vez
 * de la de ayer aunque no se abra desde el plan (auditoría final de D813).
 */
export function plannedLocation(plan: Pick<DayReportPlan, 'plans'>, date: string): string {
  for (const p of plansOn(plan, date)) {
    const place = planTitlePlace(p.title);
    if (place) return place;
  }
  return '';
}

/**
 * El día que propone *New day plan* para esa fecha: el del reporte o el plan que ya la tienen; si no, el siguiente al más
 * alto de los reportes y planes de fechas anteriores (dos planes por adelantado: Día 03 y Día 04); sin ninguno, el de la
 * propuesta del reporte.
 */
export function suggestedPlanDay(plan: DayReportPlan, date: string): number {
  const known = [...reportsOn(plan, date), ...plansOn(plan, date)].map((r) => r.day).filter((d): d is number => d !== null);
  if (known.length) return known[0];
  const before = [...plan.reports, ...plan.plans].filter((e) => e.date < date && e.day !== null).map((e) => e.day as number);
  return before.length ? Math.max(...before) + 1 : plan.suggestion.day;
}

/**
 * Dónde va el reporte (6.5): justo antes del primer reporte o plan (en el orden de la carpeta) con fecha mayor, así la
 * carpeta queda en orden y el plan de mañana, escrito la noche anterior, queda abajo del reporte de hoy (D813); si no hay,
 * al final. Con `forPlan`, el plan nuevo: antes del reporte de su fecha (arriba de él) o del primero de una fecha mayor.
 * Devuelve el id de esa hermana o `undefined`.
 */
export function placeBefore(plan: Pick<DayReportPlan, 'reports' | 'plans' | 'order'>, date: string, forPlan = false): string | undefined {
  const at = new Map((plan.order ?? []).map((id, i) => [id, i]));
  const after = (e: ReportEntry, isPlan: boolean) => (forPlan && !isPlan ? e.date >= date : e.date > date);
  const found = [...plan.reports.filter((r) => after(r, false)), ...(plan.plans ?? []).filter((p) => after(p, true))];
  // Sin el orden (un plan de antes de D813), el de los reportes, que ya está en el de la carpeta.
  found.sort((a, b) => (at.get(a.id) ?? Infinity) - (at.get(b.id) ?? Infinity));
  return found[0]?.id;
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
    /** La persona escribió la locación en el globito (aunque sea la de ayer): va al título (D814, `titlePlace`). */
    placeTyped?: boolean;
    /** La plantilla propia elegida (ya leída); sin ella, *On-Set Report* de fábrica. */
    template?: ReportTemplate | null;
    /** Lo que se anota en la carpeta como su plantilla: `undefined` no la toca (la suya no se pudo usar, O4). */
    markTemplate?: string | null;
    /** Avisa cuántas fotos de la plantilla quedaron sin sus anotaciones porque no entraban en los topes de la página. */
    onMarkupSkipped?: (photos: number) => void;
    /**
     * El título, si no es el de `newDayTitle`: el reporte de mañana desde la tarjeta *Tomorrow* toma la forma de los días
     * del proyecto (`2026-02-21 | Día 61`, relations/tomorrowNew.ts).
     */
    title?: string;
  },
): Promise<string> {
  const { tree } = deps;
  const template = options.template ?? null;
  const blocks = reportBlocks(plan, input, lang, template);
  const templateId = template?.id ?? BUILTIN_ONSET;
  // La forma de los días de la carpeta y el lugar (`newDayTitle`): sin el lugar en el título, el día quedaba sin locación
  // en el Overview (simulación de D813). Solo el que se escribió o el del plan de esa fecha, nunca la locación de ayer
  // que el globito propone y nadie tocó (D814, como D574: mañana puede ser otro lugar).
  const like = plan.last?.title ?? plan.reports.at(-1)?.title ?? plan.plans.at(-1)?.title;
  const title = options.title ?? newDayTitle(like, input.date, input.day, lang, titlePlace(plan, input, options.placeTyped));
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
    // Ya tiene la forma de un reporte vacío (`isReusableReport`): toma la fecha, el día y el lugar elegidos ahora.
    if (tree.get(id)!.title !== title) await tree.rename(id, title);
    if (tree.get(id)!.template_id !== templateId) await tree.setPatch(id, { template_id: templateId });
  } else {
    id = await tree.create(plan.parentId, title, plan.projectId, { templateId, before: placeBefore(plan, input.date) });
  }
  try {
    const written = await writeNewPage(deps.docs, id, blocks, template?.collapsed ?? [], template?.markup ?? []);
    if (written.markupSkipped) options.onMarkupSkipped?.(written.markupSkipped);
  } catch (err) {
    throw new DayReportWriteError(id, err);
  }
  return id;
}

/**
 * Escribe los bloques en una página vacía sin abrirla, como lo haría el editor (y como `writePage` de la importación):
 * el documento con la semilla, un editor sin pantalla, y los bloques agregados ANTES del primero (el párrafo vacío de
 * la semilla queda al final). Nunca reemplaza ni borra. Si la página ya tiene contenido (un intento anterior llegó a
 * escribir), no agrega nada: solo espera a que lo de antes quede guardado. Lo que sobró de un título largo
 * (sync/titleRest.ts) no cuenta: si llegó antes, los bloques van después de eso.
 */
export async function writeNewPage(
  docs: DayReportDeps['docs'],
  pageId: string,
  blocks: TemplateBlock[],
  /** Los títulos colapsados para todos de una plantilla propia (con los ids que traen `blocks`). */
  collapsed: string[] = [],
  /** Las anotaciones de las fotos de la plantilla (mismas claves): se escriben solo para las fotos que quedaron en `blocks`. */
  markup: CopiedPhoto[] = [],
): Promise<{ markupSkipped: number }> {
  const doc = await docs.open(pageId, { seed: true });
  // Las fotos que quedaron sin sus anotaciones por los topes: quien llama lo avisa en pantalla (la página igual se crea).
  let markupSkipped = 0;
  try {
    // Algo que esta versión no conoce: el editor lo borraría. No se toca.
    if (findUnknownContent(doc)) throw new Error('The page has content this version does not know.');
    const rests = onlyTitleRests(doc);
    if (!isEmptyPage(doc) && !rests) {
      await docs.flush(pageId);
      return { markupSkipped };
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
      const lastRest = rests ? [...editor.document].reverse().find((b) => b.id.startsWith(TITLE_REST_PREFIX)) : undefined;
      if (lastRest) editor.insertBlocks(blocks as never[], lastRest.id, 'after');
      else editor.insertBlocks(blocks as never[], first.id, 'before');
      if (collapsed.length) {
        const shared = doc.getMap(SHARED_COLLAPSE_MAP);
        doc.transact(() => {
          for (const id of collapsed) shared.set(id, true);
        });
      }
      if (markup.length) {
        // Solo las fotos que de verdad quedaron en la página. Si algo falla, la página ya tiene sus bloques: las fotos
        // quedan limpias, nunca se corta la creación.
        try {
          const result = carryMarkup(doc, markup, mediaIdsInDoc(doc));
          markupSkipped = result.skipped.length;
          if (markupSkipped) console.warn('[anotaciones] anotaciones de la plantilla que no entraron', result.skipped);
        } catch (err) {
          console.warn('[anotaciones] no se pudieron copiar las anotaciones de la plantilla', err);
        }
      }
      await docs.flush(pageId);
    } finally {
      editor.unmount();
      host.remove();
    }
  } finally {
    docs.close(pageId);
  }
  return { markupSkipped };
}
