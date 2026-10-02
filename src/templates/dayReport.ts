import type { PageTree } from '../sync/tree';
import type { PageRow } from '../sync/types';
import { modPressed } from '../ui/findUi';
import { IS_MAC } from '../ui/shortcuts';
import type { TemplateBlock } from './builtin';
import { BUILTIN_ONSET } from './builtinIds';

// El reporte del día (Docs/Doc_Plantillas.md, sección 6): lo que no necesita el editor y puede ir en la primera carga
// (el botón está arriba del título y el menú de la página lo ofrece): la fecha local, el nombre de la página, los
// rótulos de la ficha en los dos idiomas, cuál es la carpeta de reportes y el atajo. Leer el reporte anterior y escribir
// el nuevo está en `dayReportCreate.ts`, que se baja con el globito.

// --- Fechas y nombres ----------------------------------------------------------------------------------------------

const pad = (n: number, size = 2) => String(n).padStart(size, '0');

/**
 * La fecha de hoy con la hora local del dispositivo (PL6): a las 23:30 en Buenos Aires sigue siendo hoy aunque en UTC ya
 * sea mañana. `AAAA-MM-DD`.
 */
export function localDate(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** `AAAA-MM-DD` que existe en el calendario (nada de 2026-02-30). */
export function isValidDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d, 12);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
}

/** La fecha `AAAA-MM-DD` con que empieza un texto (el título `2026-10-02 | Day 06`, o la fila *Date*), o `null`. */
export function dateAtStart(text: string | null | undefined): string | null {
  const m = /^\s*(\d{4}-\d{2}-\d{2})(?!\d)/.exec(text ?? '');
  return m && isValidDate(m[1]) ? m[1] : null;
}

/** El número de día de un título (`… | Day 06`, `… | Día 6`), o `null`. */
export function dayInTitle(title: string | null | undefined): number | null {
  const m = /(?:^|[\s|·])(?:day|d[ií]a)\s*0*(\d{1,4})(?!\d)/i.exec(title ?? '');
  const day = m ? Number(m[1]) : NaN;
  return Number.isInteger(day) && day > 0 ? day : null;
}

/** El primer número entero positivo de un texto (la fila *Shoot day*: `6`, `Day 6`), o `null`. */
export function firstNumber(text: string | null | undefined): number | null {
  const m = /\d{1,4}/.exec(text ?? '');
  const n = m ? Number(m[0]) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** `Day 06` / `Día 06`. */
export function dayName(day: number, lang: string): string {
  return `${lang === 'es' ? 'Día' : 'Day'} ${pad(day)}`;
}

/** El título del reporte (PL7): `2026-10-02 | Day 06`. La fecha es el código del "|" (D-10): ordena y se busca igual. */
export function reportTitle(date: string, day: number, lang: string): string {
  return `${date} | ${dayName(day, lang)}`;
}

/** Lo que va en la fila *Date*: `2026-10-02 · Thu` (`2026-10-02 · jue`), el día de la semana en el idioma del contenido. */
export function dateWithWeekday(date: string, lang: string): string {
  if (!isValidDate(date)) return date;
  const [y, m, d] = date.split('-').map(Number);
  let weekday = '';
  try {
    weekday = new Intl.DateTimeFormat(lang === 'es' ? 'es' : 'en', { weekday: 'short' }).format(new Date(y, m - 1, d, 12));
  } catch {
    // Sin Intl: solo la fecha.
  }
  return weekday ? `${date} · ${weekday.replace(/\.$/, '')}` : date;
}

// --- Los rótulos de la ficha (6.4) -----------------------------------------------------------------------------------

/** Los datos de la ficha que lee y escribe el reporte del día. */
export type FactKey = 'date' | 'day' | 'location' | 'unit' | 'vfx' | 'crew';

/**
 * Los rótulos de cada dato, en los dos idiomas, ya normalizados (`normalizeLabel`). Si alguien renombró la fila, el dato
 * queda vacío: nunca se adivina ni se escribe en otra fila. Si se cambia un rótulo en `builtin.*.ts`, se suma acá.
 */
const LABELS: Record<FactKey, string[]> = {
  date: ['date', 'fecha'],
  day: ['shoot day', 'day', 'dia de rodaje', 'dia'],
  location: ['location', 'place', 'locacion', 'lugar'],
  unit: ['unit', 'unidad'],
  vfx: ['vfx on set', 'vfx en set'],
  crew: ['director · dp', 'director · df'],
};

/** El título de la tabla que se copia entera del reporte anterior (*Camera package*). */
const CAMERA_HEADINGS = ['camera package', 'equipo de camara'];

/** Sin mayúsculas, sin acentos, sin espacios de más ni dos puntos al final. */
export function normalizeLabel(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*:\s*$/, '')
    .trim();
}

export function factKeyOf(label: string): FactKey | null {
  const norm = normalizeLabel(label);
  for (const key of Object.keys(LABELS) as FactKey[]) if (LABELS[key].includes(norm)) return key;
  return null;
}

export function isCameraHeading(text: string): boolean {
  return CAMERA_HEADINGS.includes(normalizeLabel(text));
}

// --- Leer y escribir los bloques -------------------------------------------------------------------------------------

/** Un bloque como lo da BlockNote al leer un documento (o como lo arma una plantilla). */
interface LooseBlock {
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: LooseBlock[];
}

interface LooseTable {
  type: 'tableContent';
  rows: { cells: unknown[] }[];
  [key: string]: unknown;
}

/** El contenido de una celda: un texto, una lista de contenido en línea o una celda (`tableCell`) con su contenido. */
export function cellContent(cell: unknown): unknown {
  if (cell && typeof cell === 'object' && !Array.isArray(cell) && (cell as { type?: string }).type === 'tableCell') {
    return (cell as { content?: unknown }).content ?? [];
  }
  return cell ?? '';
}

/** El texto de un contenido en línea (los links con su texto; las fotos y lo demás no suman texto). */
export function inlineText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((c) => {
      if (typeof c === 'string') return c;
      const item = c as { type?: string; text?: string; content?: unknown };
      if (item?.type === 'text') return item.text ?? '';
      if (item?.type === 'link') return inlineText(item.content);
      return '';
    })
    .join('');
}

const isTable = (b: LooseBlock | undefined): b is LooseBlock & { content: LooseTable } =>
  !!b && b.type === 'table' && !!b.content && Array.isArray((b.content as LooseTable).rows);

/** La ficha de datos: la primera tabla de la página en la que todas las filas tienen 2 celdas. */
function factsTable(blocks: LooseBlock[]): LooseTable | null {
  for (const b of walk(blocks)) {
    if (!isTable(b)) continue;
    const rows = b.content.rows;
    if (rows.length > 0 && rows.every((r) => Array.isArray(r.cells) && r.cells.length === 2)) return b.content;
  }
  return null;
}

/** Todos los bloques, en orden de lectura (los hijos después de su bloque). */
function* walk(blocks: LooseBlock[]): Generator<LooseBlock> {
  for (const b of blocks) {
    yield b;
    if (b.children?.length) yield* walk(b.children);
  }
}

/** La tabla que sigue al título *Camera package* (en la misma lista de hermanos), o `null`. */
function cameraTable(blocks: LooseBlock[]): (LooseBlock & { content: LooseTable }) | null {
  const lists: LooseBlock[][] = [blocks];
  for (const b of walk(blocks)) if (b.children?.length) lists.push(b.children);
  for (const list of lists) {
    for (let i = 0; i < list.length - 1; i++) {
      const b = list[i];
      if (b.type === 'heading' && isCameraHeading(inlineText(b.content)) && isTable(list[i + 1])) {
        return list[i + 1] as LooseBlock & { content: LooseTable };
      }
    }
  }
  return null;
}

/** Lo que el reporte del día lee de un reporte. */
export interface ReportFacts {
  /** El contenido de la celda de valor de cada dato (con su formato y sus links). */
  cells: Partial<Record<FactKey, unknown>>;
  date: string | null;
  day: number | null;
  location: string;
  /** La tabla *Camera package* entera, para copiarla. */
  camera: LooseTable | null;
}

/** Los datos de un reporte, leídos de sus bloques por el rótulo de cada fila (6.4). */
export function readFacts(blocks: LooseBlock[]): ReportFacts {
  const cells: Partial<Record<FactKey, unknown>> = {};
  for (const row of factsTable(blocks)?.rows ?? []) {
    const key = factKeyOf(inlineText(cellContent(row.cells[0])));
    if (key && !(key in cells)) cells[key] = cellContent(row.cells[1]);
  }
  return {
    cells,
    date: dateAtStart(inlineText(cells.date)),
    day: firstNumber(inlineText(cells.day)),
    location: inlineText(cells.location).trim(),
    camera: cameraTable(blocks)?.content ?? null,
  };
}

/** Lo que va en el reporte nuevo. */
export interface ReportFill {
  date: string;
  day: number | null;
  location: string;
  /** Del reporte anterior (↻ en 2.3): la unidad, la gente de VFX, director y DP, y el equipo de cámara. */
  previous: ReportFacts | null;
}

/** La celda tiene algo: texto, o algo en línea que no es texto (una foto). */
function hasContent(value: unknown): boolean {
  if (typeof value === 'string') return value.trim() !== '';
  if (!Array.isArray(value)) return false;
  return inlineText(value).trim() !== '' || value.some((c) => (c as { type?: string })?.type !== 'text');
}

/**
 * Escribe los datos en los bloques de la plantilla (una copia: los de entrada no se tocan), por el rótulo de cada fila,
 * antes de copiarlos a la página (4.2). Vale para la de fábrica y para una propia. Lo que no tiene fila con ese rótulo
 * no se escribe en ningún lado.
 */
export function fillReport(blocks: TemplateBlock[], fill: ReportFill, lang: string): TemplateBlock[] {
  const out = structuredClone(blocks) as LooseBlock[];
  const facts = factsTable(out);
  const prev = fill.previous;
  for (const row of facts?.rows ?? []) {
    const key = factKeyOf(inlineText(cellContent(row.cells[0])));
    let value: unknown;
    if (key === 'date') value = dateWithWeekday(fill.date, lang);
    else if (key === 'day') value = fill.day ? String(fill.day) : undefined;
    else if (key === 'location') value = fill.location;
    else if (key && prev && hasContent(prev.cells[key])) value = structuredClone(prev.cells[key]);
    if (value !== undefined) row.cells[1] = { type: 'tableCell', content: value };
  }
  const camera = prev?.camera;
  const target = camera ? cameraTable(out) : null;
  if (camera && target) target.content = structuredClone(camera);
  return out as TemplateBlock[];
}

// --- La carpeta de reportes (6.2) ------------------------------------------------------------------------------------

/** La marca de la página: `on` (marcada), `off` (se dejó de usar a mano) o `null` (sin marca). */
export function dayReportsMark(row: PageRow | undefined): 'on' | 'off' | null {
  const value: unknown = row?.settings?.dayReports;
  if (value === false) return 'off';
  if (value && typeof value === 'object' && !Array.isArray(value)) return 'on';
  return null;
}

/**
 * Una página que es un reporte del día: salió de *On-Set Report* y su título empieza con una fecha (lo que pone
 * *New day report*, o la tira al crear el primero). Una página a la que se le deshizo la plantilla conserva el
 * `template_id` (entrega 1), pero no tiene la fecha en el título: no cuenta.
 */
export function isReportPage(row: PageRow): boolean {
  return row.template_id === BUILTIN_ONSET && dateAtStart(row.title) !== null;
}

/**
 * La página es una carpeta de reportes: marcada, o (si la marca se perdió por dos cambios de ajustes a la vez, sección 8)
 * con algún reporte adentro. *Stop using for day reports* (`false`) gana sobre lo deducido.
 */
export function isDayReportFolder(tree: PageTree, id: string): boolean {
  const row = tree.get(id);
  if (!row || tree.isTrashed(id)) return false;
  const mark = dayReportsMark(row);
  if (mark) return mark === 'on';
  return tree.children(id).some(isReportPage);
}

/** La carpeta de reportes de la página: ella misma, o la de arriba si es una (cada reporte tiene el botón), o `null`. */
export function dayReportFolderOf(tree: PageTree, pageId: string): string | null {
  if (isDayReportFolder(tree, pageId)) return pageId;
  const parent = tree.get(pageId)?.parent_id;
  return parent && isDayReportFolder(tree, parent) ? parent : null;
}

// --- El atajo (sección 9) --------------------------------------------------------------------------------------------

/**
 * Ctrl+Alt+Shift+N (⌘⌥⇧N en la Mac: nunca Ctrl en la Mac). Con AltGr (en Windows llega como Ctrl+Alt) no: en algunos
 * teclados escribe un carácter (en el polaco, AltGr+N es ń). Con ⌥ la tecla escribe otra cosa en la Mac: se mira
 * también la posición (`code`). Descartados ⌘⌥D (esconde el Dock) y ⌘⌥N (*Open split view* de Chrome en la Mac).
 */
export function isDayReportShortcut(
  e: {
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    code: string;
    key: string;
    getModifierState?: (key: string) => boolean;
  },
  mac = IS_MAC,
): boolean {
  if (e.getModifierState?.('AltGraph')) return false;
  return modPressed(e, mac) && e.altKey && e.shiftKey && (e.code === 'KeyN' || e.key.toLowerCase() === 'n');
}
