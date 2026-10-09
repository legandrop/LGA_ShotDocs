import { SEPARATOR, type BlockMeta, type SearchUnit } from '../search/extract';
import { blocksOf } from './pageRelations';

// Los campos de una página: «rótulo: valor» (Docs/Doc_Relaciones.md, sección 3, «Campos»). Una ficha de desglose
// importada de una tabla de Coda es una tabla de dos columnas («Shot Name | ERSO_105_027_010», «Locacion Guion |
// Ambulancia | Ruta INT» con su link, «Fecha Rodaje | 06/03/2026») y unos títulos con su texto debajo («Descripción»,
// «Consultas»). La cabecera viva lee de acá la pregunta abierta, los decorados, INT/EXT y las coordenadas; el día (E5),
// la fecha de rodaje de cada ficha y la pregunta abierta para el reporte de mañana.
//
// Puro: sale de lo que la búsqueda ya leyó de cada página (las unidades y lo de cada bloque, con las filas y columnas de
// cada tabla). No escribe nada. Tres formas:
// - **Tabla** de dos columnas: cada fila con texto en la primera celda es un campo (cualquier rótulo).
// - **Título** que dice entero un rótulo conocido («Consultas», «Open questions»): el valor es lo de abajo hasta el
//   próximo título.
// - **Renglón** que empieza con un rótulo conocido y dos puntos («Consultas: ¿…?», «INT/EXT: INT»). Solo al principio:
//   un párrafo que dice «open question» en el medio de un texto no es un campo.

export type FieldVia = 'table' | 'heading' | 'line';

export interface FieldValue {
  /** El rótulo como está escrito («Consultas», «INT/EXT DIA/NOCHE»). */
  label: string;
  /** El rótulo normalizado (`normLabel`): sin tildes ni mayúsculas, solo letras, números y un espacio. */
  key: string;
  /** El valor como texto, con un renglón por línea (`\n`); vacío si la celda está vacía. */
  text: string;
  /** Los links del valor a páginas de la app, con su texto. */
  links: { pageId: string; text: string }[];
  /** Dónde está: la tabla, el título o el renglón. */
  blockId: string;
  /** Un título: el bloque que cierra lo de abajo (`null`, hasta el final). Las otras formas no lo tienen. */
  endBlockId?: string | null;
  via: FieldVia;
  /**
   * Las unidades del valor (índices entre todas las de la página): las celdas de la columna del valor, lo de abajo del
   * título o, en un renglón, la unidad del renglón entero (la del rótulo). Para leer el valor de un campo de lugar con su
   * contexto (`placeUnits`, D530).
   */
  units: number[];
}

export interface PageFields {
  fields: FieldValue[];
  /** Las primeras coordenadas escritas en la página (`34° 46' 39.6" S 58° 31' 18.3" W` o `-34.7777, -58.5217`). */
  coords: { text: string; blockId: string } | null;
}

/** Sin tildes ni mayúsculas; lo que no es letra ni número, un espacio («INT/EXT Día/Noche» → «int ext dia noche»). */
export function normLabel(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Los rótulos conocidos, por campo, en castellano e inglés (se comparan con `normLabel`). Una tabla da todos sus campos,
 * conocidos o no; un título o un renglón cuentan solo con uno de estos. Para un campo nuevo, se suma acá.
 */
export const FIELD_LABELS = {
  openQuestion: ['consultas', 'consulta', 'open question', 'open questions', 'questions', 'pregunta abierta', 'preguntas abiertas', 'preguntas', 'dudas'],
  set: ['locacion guion', 'locacion de guion', 'decorado', 'decorados', 'set', 'sets', 'script location'],
  intExt: ['int ext dia noche', 'int ext', 'int ext day night', 'int ext dia', 'interior exterior'],
  shootDate: ['fecha rodaje', 'fecha de rodaje', 'shoot date', 'shooting date'],
  location: ['locacion real', 'locacion', 'location', 'real location', 'location planned', 'locacion planeada'],
  coords: ['coordenadas', 'coordinates', 'coords', 'gps', 'ubicacion', 'where'],
  description: ['descripcion', 'description'],
  shot: ['shot name', 'shot', 'plano'],
  vfxCat: ['vfx cat', 'vfx category', 'categoria vfx'],
  /** Los otros nombres de una locación (D526, D527): solo cuentan en la página de la locación misma (`aliases.ts`). */
  aliases: ['also known as', 'aka', 'a k a', 'other names', 'alias', 'aliases', 'otros nombres', 'tambien conocida como', 'tambien conocido como', 'nombres alternativos'],
} as const;

export type FieldName = keyof typeof FIELD_LABELS;

const KNOWN = new Map<string, FieldName>();
for (const [name, labels] of Object.entries(FIELD_LABELS) as [FieldName, readonly string[]][]) for (const l of labels) KNOWN.set(normLabel(l), name);

/** El campo conocido de un rótulo, o `null`. */
export function fieldName(label: string): FieldName | null {
  return KNOWN.get(normLabel(label)) ?? null;
}

const aliasSet = new Map<FieldName, Set<string>>();
function aliasesOf(name: FieldName | readonly string[]): Set<string> {
  if (typeof name !== 'string') return new Set(name.map(normLabel));
  let set = aliasSet.get(name);
  if (!set) aliasSet.set(name, (set = new Set(FIELD_LABELS[name].map(normLabel))));
  return set;
}

/** Los valores de un campo (por su nombre o por una lista de rótulos), en el orden de la página. */
export function fieldValues(page: PageFields | null | undefined, name: FieldName | readonly string[]): FieldValue[] {
  if (!page) return [];
  const keys = aliasesOf(name);
  return page.fields.filter((f) => keys.has(f.key));
}

/** Un valor que no dice nada («—», «-», «n/a», «none»): como si estuviera vacío. */
export function emptyValue(text: string): boolean {
  const t = normLabel(text);
  return !t || t === 'n a' || t === 'na' || t === 'none' || t === 'ninguna' || t === 'ninguno';
}

/** Un renglón que es solo un rótulo, sin nada después («Director: », «Arte:»): lo que dejan las plantillas para llenar. */
const LABEL_ONLY = /^\s*[^:\n]{1,60}:\s*$/;

/**
 * Lo que dice una pregunta abierta, sin los renglones que son solo un rótulo vacío («Director: » de la plantilla *Scene*):
 * una pregunta sin nada escrito no está abierta (O11 de la auditoría de E7). Vacío si no queda nada. Se mira al mostrar, no
 * al leer: el índice guarda el valor como está.
 */
export function openQuestionText(text: string): string {
  return text
    .split('\n')
    .filter((line) => !LABEL_ONLY.test(line))
    .join('\n')
    .trim();
}

/** Una fecha de un valor (`06/03/2026`, `6-3-2026`, `2026-03-06`) como `AAAA-MM-DD`, o `null`. */
export function fieldDate(text: string): string | null {
  const iso = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  const dmy = iso ? null : /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(text);
  const [y, m, d] = iso ? [iso[1], iso[2], iso[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : [];
  if (!y) return null;
  const mm = Number(m);
  const dd = Number(d);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

// --- Coordenadas --------------------------------------------------------------------------------------------------

const AXIS = String.raw`\d{1,3}(?:[.,]\d+)?\s*°\s*(?:\d{1,2}(?:[.,]\d+)?\s*['′’]\s*)?(?:\d{1,2}(?:[.,]\d+)?\s*(?:["″”]|''|′′)\s*)?`;
const DMS = new RegExp(String.raw`${AXIS}[NSns]\b[\s,;/]*${AXIS}[EWOewo]\b`);
const DECIMAL = /(?<![\d.])(-?\d{1,2}\.\d{4,})\s*([NSns])?\s*,\s*(-?\d{1,3}\.\d{4,})\s*([EWOewo])?(?![\d.])/;

/**
 * Las coordenadas de un texto, o `null`: grados («°») con hemisferio, o un par decimal con signo o hemisferio
 * («-34.6701, -58.4508», «34.6701 S, 58.4508 W»). Un par decimal sin signo ni hemisferio («1.7778, 2.3900», un formato
 * o una hora) cuenta solo si el texto es el valor de un campo de coordenadas (`labeled`).
 */
export function coordsIn(text: string, labeled = false): string | null {
  if (text.includes('°')) {
    const m = DMS.exec(text);
    if (m) return m[0].replace(/\s+/g, ' ').trim();
  }
  const d = DECIMAL.exec(text);
  if (!d || Math.abs(Number(d[1])) > 90 || Math.abs(Number(d[3])) > 180) return null;
  const signed = d[1].startsWith('-') || d[3].startsWith('-') || !!d[2] || !!d[4];
  if (!signed && !labeled) return null;
  return d[0].replace(/\s+/g, ' ').trim();
}

// --- Lectura --------------------------------------------------------------------------------------------------------

const LABEL_MAX = 40;
const VALUE_MAX = 2000;
const flat = (text: string) => text.replaceAll(SEPARATOR, '\n');
/** Un renglón por línea, sin espacios de más ni renglones vacíos. */
const lines = (text: string) =>
  flat(text)
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');

/** Un rótulo de una tabla: corto, con alguna letra y sin ser una oración. */
function labelLike(text: string): boolean {
  const t = text.replace(/[:：]\s*$/, '').trim();
  return t.length > 0 && t.length <= LABEL_MAX && /\p{L}/u.test(t) && t.split(/\s+/).length <= 6;
}

const clip = (text: string) => (text.length > VALUE_MAX ? text.slice(0, VALUE_MAX) : text);
const LINE = /^\s*([^:：\n]{1,40}?)\s*[:：]\s*/;

type Block = ReturnType<typeof blocksOf>[number];

/** Un renglón (no un título ni una tabla) que empieza con un rótulo conocido y dos puntos: lo que encontró `LINE`. */
function lineField(b: Block): RegExpExecArray | null {
  if (b.level > 0 || b.meta?.cells) return null;
  const first = b.units.find((u) => u.unit.field !== 'name');
  if (!first || first.unit.field !== 'text') return null;
  const m = LINE.exec(first.unit.text);
  return m && fieldName(m[1]) ? m : null;
}

/** Los campos y las coordenadas de una página, o `null` si no tiene ninguno. */
export function readPageFields(units: readonly SearchUnit[], meta: readonly BlockMeta[]): PageFields | null {
  const blocks = blocksOf(units, meta);
  const fields: FieldValue[] = [];
  let coords: PageFields['coords'] = null;
  const linksIn = (m: BlockMeta | null, unit: number, from = 0): FieldValue['links'] =>
    (m?.links ?? [])
      .filter((l) => l.unit === unit && l.start >= from)
      .map((l) => ({ pageId: l.pageId, text: flat(units[unit].text.slice(l.start, l.end)).replace(/\s+/g, ' ').trim() }));

  blocks.forEach((b, bi) => {
    const textUnits = b.units.filter((u) => u.unit.field !== 'name');
    if (!coords) {
      for (const { unit } of textUnits) {
        const c = coordsIn(flat(unit.text));
        if (c) {
          coords = { text: c, blockId: b.blockId };
          break;
        }
      }
    }
    const cells = b.meta?.cells;
    if (cells && b.meta?.cols === 2) {
      // Una tabla de dos columnas: rótulo | valor, fila por fila.
      const rows = new Map<number, { label: number[]; value: number[] }>();
      for (const c of cells) {
        const r = rows.get(c.row) ?? { label: [], value: [] };
        rows.set(c.row, r);
        (c.col === 0 ? r.label : r.value).push(c.unit);
      }
      for (const r of rows.values()) {
        const label = lines(r.label.map((i) => units[i].text).join('\n')).replace(/\n/g, ' ');
        if (!labelLike(label)) continue;
        const clean = label.replace(/[:：]\s*$/, '').trim();
        fields.push({
          label: clean,
          key: normLabel(clean),
          text: clip(lines(r.value.map((i) => units[i].text).join('\n'))),
          links: r.value.flatMap((i) => linksIn(b.meta, i)),
          blockId: b.blockId,
          via: 'table',
          units: r.value.slice(),
        });
      }
      return;
    }
    if (cells) return;
    if (b.level > 0) {
      // Un título que es un rótulo conocido: el valor es lo de abajo hasta el próximo título.
      const title = textUnits.map((u) => flat(u.unit.text)).join(' ').replace(/\s+/g, ' ').trim();
      const clean = title.replace(/[:：]\s*$/, '').trim();
      if (!fieldName(clean)) return;
      const value: string[] = [];
      const links: FieldValue['links'] = [];
      const valueUnits: number[] = [];
      let end: string | null = null;
      for (let i = bi + 1; i < blocks.length; i++) {
        // Hasta el próximo título, o hasta un renglón que es otro campo («Open question: …»).
        if (blocks[i].level > 0 || lineField(blocks[i])) {
          end = blocks[i].blockId;
          break;
        }
        for (const { unit, index } of blocks[i].units) {
          if (unit.field === 'name') continue;
          value.push(unit.text);
          valueUnits.push(index);
          links.push(...linksIn(blocks[i].meta, index));
        }
      }
      fields.push({ label: clean, key: normLabel(clean), text: clip(lines(value.join('\n'))), links, blockId: b.blockId, endBlockId: end, via: 'heading', units: valueUnits });
      return;
    }
    // Un renglón que empieza con un rótulo conocido y dos puntos.
    const m = lineField(b);
    if (!m) return;
    const first = textUnits[0];
    const rest = [first.unit.text.slice(m[0].length), ...textUnits.slice(1).map((u) => u.unit.text)].join('\n');
    fields.push({
      label: m[1].trim(),
      key: normLabel(m[1]),
      text: clip(lines(rest)),
      links: [...linksIn(b.meta, first.index, m[0].length), ...textUnits.slice(1).flatMap((u) => linksIn(b.meta, u.index))],
      blockId: b.blockId,
      via: 'line',
      units: textUnits.map((u) => u.index),
    });
  });
  return fields.length || coords ? { fields, coords } : null;
}

// --- Contexto de lugar (D530) ------------------------------------------------------------------------------------------

const PLACE_KEYS = new Set(FIELD_LABELS.location.map(normLabel));

/**
 * Las unidades que son el valor de un campo de locación (*Locacion Real*, *Location*, *Locación*) en unos campos ya
 * leídos: la celda del valor en una fila de tabla, el renglón «Locación: …» entero, lo de abajo de un título «Locación».
 * Ahí «se espera un lugar», como en el título de un día: el lector las lee con ese contexto (los alias de una palabra y
 * los genéricos como parte entera, D529–D531). *Locacion Guion* no: es el decorado de la historia.
 */
export function placeOf(page: PageFields | null | undefined): Set<number> {
  const out = new Set<number>();
  for (const f of page?.fields ?? []) if (PLACE_KEYS.has(f.key)) for (const u of f.units) out.add(u);
  return out;
}

/** Lo mismo, desde lo leído de la página (las unidades y lo de cada bloque). Pura: la usan el índice y el subrayado. */
export function placeUnits(units: readonly SearchUnit[], meta: readonly BlockMeta[]): Set<number> {
  return placeOf(readPageFields(units, meta));
}
