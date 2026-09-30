// Fotos en fila (Docs/Doc_Imagenes.md, "Correcciones de la auditoría previa").
//
// Una fila no es un bloque: son bloques `image` hermanos y seguidos con `rowWidth`, la parte del ancho del
// área de texto que ocupa cada foto. El plugin del editor arma las filas con `groupRows` y el CSS le da a
// cada foto `flex-basis: f · (W − (n − 1) · g)`, con W el ancho del área de texto, g el espacio entre fotos
// y n las fotos de su fila. Por eso, con `f_k = a_k / Σa` (a = ancho / alto), todas las fotos de una fila
// quedan a la misma altura, `(W − (n − 1) · g) / Σa`, con cualquier ancho: teléfono, computadora o PDF.
//
// Todo acá es cálculo, sin DOM: lo usan el plugin, los tiradores y el botón "Arrange in rows".

/** Tamaños rápidos de la barra: ancho entero, 1/2, 1/3 y 1/4. */
export const ROW_PRESETS: readonly number[] = [1, 1 / 2, 1 / 3, 1 / 4];

/** Margen para comparar sumas: tres de 0,3333 más una de redondeo no pueden pasar a otra fila. */
const EPS = 1e-6;
/** Lo más chico que se guarda (un `rowWidth` se guarda con 4 decimales y 0 es "sin ancho propio"). */
const MIN_ROW_WIDTH = 1e-4;
/** La proporción de una foto que todavía no cargó o que llega rota (3:2). */
const DEFAULT_ASPECT = 1.5;
/** 8 px de espacio en un área de texto de 700 px, en unidades del ancho. */
const DEFAULT_GAP_RATIO = 8 / 700;
const MAX_PER_ROW = 4;
/** Lo más bajo y lo más alto que puede quedar una fila de "Arrange in rows", en veces el alto ideal. */
const MIN_ROW_HEIGHT = 0.5;
const MAX_ROW_HEIGHT = 2.2;

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;
const validAspect = (a: number) => (Number.isFinite(a) && a > 0 ? a : DEFAULT_ASPECT);

/**
 * Las filas de una tanda de bloques hermanos, como índices. `fracs` tiene el `rowWidth` de cada bloque; un
 * bloque que no es foto va con 0. Las fotos seguidas con ancho propio se juntan en orden mientras la suma no
 * pase de 1; una foto sin ancho (0) o un bloque que no es foto corta la fila y no forma parte de ninguna.
 */
export function groupRows(fracs: readonly number[]): number[][] {
  const rows: number[][] = [];
  let row: number[] = [];
  let sum = 0;
  const close = () => {
    if (row.length) rows.push(row);
    row = [];
    sum = 0;
  };
  for (let i = 0; i < fracs.length; i++) {
    const f = fracs[i];
    if (!(f > 0)) {
      close();
      continue;
    }
    if (row.length && sum + f > 1 + EPS) close();
    row.push(i);
    sum += f;
  }
  close();
  return rows;
}

/**
 * El alto en pantalla de cada foto según el CSS, con las filas de `groupRows`. `W`: el ancho del área de
 * texto; `g`: el espacio entre fotos (los dos en px). Las fotos sin ancho propio dan 0.
 */
export function rowHeights(fracs: readonly number[], aspects: readonly number[], W: number, g: number): number[] {
  const out = fracs.map(() => 0);
  for (const row of groupRows(fracs)) {
    const inner = W - (row.length - 1) * g;
    for (const k of row) out[k] = (fracs[k] * inner) / validAspect(aspects[k]);
  }
  return out;
}

/**
 * La inversa del CSS, para los tiradores: el ancho en px que dejó el arrastre, en una fila de `n` fotos,
 * pasado a `rowWidth`. Queda entre lo más chico que se guarda y 1.
 */
export function pxToRowWidth(px: number, W: number, g: number, n: number): number {
  const inner = W - (Math.max(1, Math.floor(n) || 1) - 1) * g;
  if (!(inner > 0)) return 1;
  if (!(px > 0)) return MIN_ROW_WIDTH;
  return Math.min(1, Math.max(MIN_ROW_WIDTH, px / inner));
}

/**
 * Imanta un ancho a 1, 1/2, 1/3 o 1/4 si queda a menos de `tolerance` de uno de ellos; si no, lo redondea a
 * 4 decimales. Lo que no es un número positivo da 0 (sin ancho propio).
 */
export function snapRowWidth(f: number, tolerance = 0.02): number {
  if (!(f > 0)) return 0;
  const x = Math.min(f, 1);
  for (const p of ROW_PRESETS) if (Math.abs(x - p) < tolerance) return p;
  return Math.max(MIN_ROW_WIDTH, round4(x));
}

// --- Acomodar en filas ------------------------------------------------------------------------------

export interface ArrangeOptions {
  /** Como mucho cuántas fotos por fila (4). */
  maxPerRow?: number;
  /** El espacio entre fotos sobre el ancho del área de texto (8 / 700). */
  gapRatio?: number;
}

/**
 * "Arrange in rows": el `rowWidth` de cada foto de una tanda, en el mismo orden (nunca se reordena, el orden
 * lo decide quien arma la página). `aspects`: ancho / alto de cada una; una que no sirve cuenta como 3:2.
 *
 * Se calcula con el ancho del área de texto como unidad. El alto de una fila de n fotos que llena el ancho es
 * `h = (1 − (n − 1) · g) / Σa` y el ideal `H`, el de una foto 3:2 a un tercio del ancho (descontando los
 * espacios). La partición en filas sale de una programación dinámica que minimiza `Σ ln(h / H)²`, con filas
 * entre 0,5·H y MAX = 2,2·H (si ninguna partición entra en esos límites, se calcula sin ellos). MAX deja
 * que dos apaisadas, o una vertical y una apaisada, llenen el ancho. La última fila entra en la cuenta llena
 * y sin el límite de arriba; después, si queda más alta que MAX, se achica sin llenar hasta la altura de la
 * fila anterior (o MAX, si es la única). Como la tanda termina en un bloque que no es foto, nada sube a esa
 * fila; y como toda fila que no es la última suma 1, ninguna absorbe la siguiente.
 */
export function arrangeRows(aspects: readonly number[], opts: ArrangeOptions = {}): number[] {
  const n = aspects.length;
  if (n === 0) return [];
  const a = aspects.map(validAspect);
  const maxPerRow = Math.max(1, Math.floor(opts.maxPerRow ?? MAX_PER_ROW) || MAX_PER_ROW);
  const gap = opts.gapRatio ?? DEFAULT_GAP_RATIO;
  const g = Number.isFinite(gap) ? Math.min(Math.max(gap, 0), 0.2) : DEFAULT_GAP_RATIO;
  const H = (1 - 2 * g) / 3 / DEFAULT_ASPECT;
  const max = MAX_ROW_HEIGHT * H;

  const starts = partition(a, maxPerRow, g, H, max, true) ?? partition(a, maxPerRow, g, H, max, false)!;
  const rows = starts.map((i, r) => [i, r + 1 < starts.length ? starts[r + 1] : n] as const);

  const out = new Array<number>(n);
  let prevHeight = max;
  rows.forEach(([i, j], r) => {
    const inner = 1 - (j - i - 1) * g;
    let sum = 0;
    for (let k = i; k < j; k++) sum += a[k];
    const full = inner / sum;
    if (r === rows.length - 1 && full > max) {
      // La última fila, si llena queda muy alta, se achica a la altura de la anterior (a MAX, si es la
      // única). Como el CSS le da a cada foto `f · inner` de ancho, `f_k = a_k · h / inner` la deja con
      // altura h. Si la anterior es más alta que esta llena, queda llena.
      const target = Math.min(prevHeight, full);
      const parts: number[] = [];
      for (let k = i; k < j; k++) parts.push(Math.max(MIN_ROW_WIDTH, round4((a[k] * target) / inner)));
      if (target < full && parts.reduce((s, f) => s + f, 0) < 1) {
        parts.forEach((f, d) => (out[i + d] = f));
        return;
      }
    }
    fillRow(out, a, i, j, sum);
    prevHeight = full;
  });
  return out;
}

/**
 * Dónde empieza cada fila, o null si con `strict` ninguna partición entra en los límites. Costo de una fila:
 * `ln(h / H)²`; la última no tiene el límite de arriba (se achica después). `max`: el alto máximo.
 */
function partition(
  a: readonly number[],
  maxPerRow: number,
  g: number,
  H: number,
  max: number,
  strict: boolean,
): number[] | null {
  const n = a.length;
  const best = new Array<number>(n + 1).fill(Infinity);
  const from = new Array<number>(n + 1).fill(-1);
  best[0] = 0;
  for (let j = 1; j <= n; j++) {
    let sum = 0;
    for (let i = j - 1; i >= 0 && j - i <= maxPerRow; i--) {
      sum += a[i];
      if (best[i] === Infinity) continue;
      const h = (1 - (j - i - 1) * g) / sum;
      if (!(h > 0)) continue;
      if (strict && (h < MIN_ROW_HEIGHT * H - 1e-12 || (j < n && h > max + 1e-12))) continue;
      const cost = best[i] + Math.log(h / H) ** 2;
      if (cost < best[j]) {
        best[j] = cost;
        from[j] = i;
      }
    }
  }
  if (best[n] === Infinity) return null;
  const starts: number[] = [];
  for (let j = n; j > 0; j = from[j]) starts.unshift(from[j]);
  return starts;
}

/**
 * Una fila llena: cada foto `a_k / Σa` con 4 decimales y la última lo que falta para 1, así la suma da 1 justo
 * (y la siguiente foto ya no entra en la fila).
 */
function fillRow(out: number[], a: readonly number[], i: number, j: number, sum: number) {
  let others = 0;
  for (let k = i; k < j - 1; k++) {
    out[k] = Math.max(MIN_ROW_WIDTH, round4(a[k] / sum));
    others += out[k];
  }
  let last = round4(1 - others);
  if (last < MIN_ROW_WIDTH) {
    // Solo con proporciones absurdas: se le saca lo que falta a la más ancha de la fila.
    let widest = i;
    for (let k = i; k < j - 1; k++) if (out[k] > out[widest]) widest = k;
    out[widest] = round4(out[widest] - (MIN_ROW_WIDTH - last));
    last = MIN_ROW_WIDTH;
  }
  out[j - 1] = last;
}
