import type { TemplateBlock } from './builtin';
import { dateAtStart, dateWithWeekday, firstNumber } from './dayReport';

// La ficha de datos del reporte del día (Docs/Doc_Plantillas.md, 6.4): leer un reporte por el rótulo de cada fila, en
// los dos idiomas, y llenar el nuevo antes de copiarlo a la página. No va en la primera carga: lo usan el globito y la
// tira (con el editor).

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
    .replace(/\p{Mn}/gu, '')
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
