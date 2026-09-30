// Cortes entre hojas (roadmap B.7, Docs/Doc_Hojas_PDF.md).
//
// Un corte es un cálculo, no contenido: nada de esto toca el documento. Se mide la vista de impresión
// (printView.ts: una copia del editor con el ancho real del área de texto de la hoja y los estilos del
// PDF) y se decide dónde empieza cada hoja. Con eso se dibujan las marcas en pantalla (SheetBreaks.tsx) y
// se ponen los saltos del PDF (`break-before: page`), así los dos coinciden.
//
// Las unidades son el encabezado, el título y la fila de contenido de cada bloque (`.bn-block-content`,
// sin sus hijos: cada hijo es otra unidad). Reglas:
// - Una unidad que entra en una hoja no se parte: si no entra en lo que queda, pasa entera a la siguiente
//   (una imagen, un párrafo corto, una tabla chica).
// - Una unidad más alta que una hoja se parte: un texto entre renglones, una tabla entre filas. Lo que no se
//   puede partir (una imagen enorme) empieza en una hoja nueva y se corta en el borde.
// - Un título de sección (heading) no queda solo al pie de una hoja: pasa con el bloque que sigue.

export interface Unit {
  /** `header`, `title` o `b:<id del bloque>`. */
  key: string;
  /** Desde el comienzo del área de texto de la primera hoja, en píxeles de CSS (con su margen de arriba). */
  top: number;
  height: number;
  /** Dónde se puede partir, medido desde `top` (entre renglones o filas), de menor a mayor. */
  splits?: number[];
  /** Va a la hoja siguiente junto con la unidad que sigue (títulos de sección). */
  keepWithNext?: boolean;
}

export interface SheetBreak {
  /** La unidad donde empieza la hoja. */
  index: number;
  key: string;
  /** 0: la hoja empieza con la unidad; más: la unidad se parte y la hoja empieza a esa altura de ella. */
  offset: number;
  /** El número de la hoja que empieza acá (2, 3…). */
  sheet: number;
}

export interface Pagination {
  breaks: SheetBreak[];
  sheets: number;
}

/**
 * Lo que se le descuenta al alto de la hoja al calcular: el navegador imprime con el mismo motor, pero un
 * redondeo distinto no puede empujar un bloque a otra hoja (quedaría una hoja casi vacía).
 */
export const SHEET_TOLERANCE_PX = 4;

const EPS = 0.5;

/**
 * Dónde empieza cada hoja. `sheetHeight`: el alto del área de texto (la hoja menos sus márgenes).
 * `tolerance`: lo que se descuenta para decidir si un bloque entero entra (ver `SHEET_TOLERANCE_PX`). Donde
 * se parte un bloque alto no se descuenta: ahí corta el navegador, en el último renglón que entra en la hoja.
 */
export function paginate(units: readonly Unit[], sheetHeight: number, tolerance = 0): Pagination {
  const breaks: SheetBreak[] = [];
  if (!(sheetHeight > 0)) return { breaks, sheets: 1 };
  const keepHeight = sheetHeight - tolerance;
  let start = 0;
  const startAt = (index: number, offset: number) => {
    const u = units[index];
    start = u.top + offset;
    breaks.push({ index, key: u.key, offset, sheet: breaks.length + 2 });
  };

  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (!(u.height > 0)) continue;
    const splits = (u.splits ?? []).filter((s) => s > EPS && s < u.height - EPS);
    // Más alta que una hoja y con dónde partirla (renglones, filas): se parte.
    const tall = u.height > keepHeight + EPS && splits.length > 0;
    const room = tall ? sheetHeight : keepHeight;
    // Cada vuelta empieza una hoja nueva, así que termina (el tope es por si llega algo raro).
    for (let guard = 0; u.top + u.height > start + room + EPS && guard < 10_000; guard++) {
      const atStart = u.top <= start + EPS;
      if (!tall && !atStart) {
        // Pasa entera a la hoja siguiente, con los títulos de sección que tenga justo arriba en esta hoja.
        let j = i;
        while (j > 0 && units[j - 1].keepWithNext && units[j - 1].top > start + EPS) j--;
        startAt(j, 0);
        continue;
      }
      if (!tall) {
        // Ya empieza la hoja: si entra en la hoja entera, queda; si no (una imagen enorme), se corta en el borde.
        if (u.top + u.height <= start + sheetHeight + EPS) break;
        startAt(i, start + sheetHeight - u.top);
        continue;
      }
      // Se parte en el último renglón (o fila) que entra; si no entra ninguno, empieza en la hoja siguiente.
      let fit: number | undefined;
      for (const s of splits) {
        if (u.top + s > start + sheetHeight + EPS) break;
        if (u.top + s > start + EPS) fit = s;
      }
      if (fit !== undefined) startAt(i, fit);
      else if (!atStart) startAt(i, 0);
      else startAt(i, start + sheetHeight - u.top);
    }
  }
  return { breaks, sheets: breaks.length + 1 };
}

// --- Medir --------------------------------------------------------------------------------------------

/** Lo que se mide como unidad, en el orden del documento (el contenido de un bloque va antes que sus hijos). */
export const UNIT_SELECTOR = '.page-header, .page-title, .bn-block-content';

/** La clave de una unidad de la vista (o de la página en pantalla). */
export function unitKey(el: Element): string | null {
  if (el.classList.contains('page-header')) return 'header';
  if (el.classList.contains('page-title')) return 'title';
  const id = el.closest('[data-id]')?.getAttribute('data-id');
  return id ? `b:${id}` : null;
}

export interface Measured {
  units: Unit[];
  /** El elemento de cada unidad (mismo orden). */
  elements: HTMLElement[];
}

/**
 * Mide las unidades de `root` (la vista de impresión, que empieza donde empieza el área de texto de la
 * primera hoja). Los puntos para partir se buscan solo en lo que no entra en una hoja.
 */
export function measureUnits(root: HTMLElement, sheetHeight: number): Measured {
  const origin = root.getBoundingClientRect().top;
  const units: Unit[] = [];
  const elements: HTMLElement[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(UNIT_SELECTOR)) {
    const key = unitKey(el);
    if (!key) continue;
    const r = el.getBoundingClientRect();
    if (r.height <= 0) continue;
    const marginTop = parseFloat(getComputedStyle(el).marginTop) || 0;
    const unit: Unit = { key, top: r.top - origin - marginTop, height: r.height + marginTop };
    if (el.matches('[data-content-type="heading"]')) unit.keepWithNext = true;
    if (unit.height > sheetHeight) unit.splits = splitPoints(el, r.top - marginTop);
    units.push(unit);
    elements.push(el);
  }
  return { units, elements };
}

/** Dónde se puede partir una unidad alta: entre las filas de una tabla o entre los renglones del texto. */
export function splitPoints(el: HTMLElement, top: number): number[] {
  const rows = el.querySelectorAll('tr');
  if (rows.length > 1) {
    return [...rows].slice(0, -1).map((row) => row.getBoundingClientRect().bottom - top);
  }
  const lines: { top: number; bottom: number }[] = [];
  for (const text of el.querySelectorAll('.bn-inline-content, pre')) {
    const range = document.createRange();
    range.selectNodeContents(text);
    if (typeof range.getClientRects !== 'function') continue;
    const rects = [...range.getClientRects()].filter((r) => r.height > 0).sort((a, b) => a.top - b.top);
    for (const r of rects) {
      const last = lines[lines.length - 1];
      // Lo que se superpone en alto es el mismo renglón (una palabra en otra fuente, una marca de guion).
      if (last && r.top < last.bottom - 1) last.bottom = Math.max(last.bottom, r.bottom);
      else lines.push({ top: r.top, bottom: r.bottom });
    }
  }
  const out: number[] = [];
  // El corte va entre un renglón y el siguiente (a mitad del interlineado, donde termina la caja del renglón).
  for (let k = 0; k + 1 < lines.length; k++) out.push((lines[k].bottom + lines[k + 1].top) / 2 - top);
  return out;
}
