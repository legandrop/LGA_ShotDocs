import {
  DEFAULT_MARKUP_COLOR,
  MAX_POINTS,
  MAX_TEXT,
  REFERENCE_SIDE,
  safeColor,
  type MarkupFrame,
  type MarkupShape,
  type Rect,
  type ShapeFields,
} from './markup';

// Lo que hace el anotador (P.20, entrega 2; Docs/Doc_Anotar_Fotos.md, secciones 2 y 3) sin pantalla: las nueve
// herramientas con las letras de FrameRev, el estilo de cada una (con los valores de fábrica de FrameRev), cómo una forma
// sale de un arrastre (Shift y Alt como en FrameRev y Photoshop), los campos que se guardan (los del `.frproj` v2, en
// píxeles del marco: AN7), el lápiz simplificado al soltar, y qué forma hay bajo el cursor. La pantalla (Annotator.tsx)
// solo traduce el mouse a esto y escribe con `addShape` / `updateShape` (media/markup.ts) al soltar.

/** Las herramientas, en el orden de la barra de FrameRev (AN5). */
export const TOOLS = ['select', 'rectangle', 'ellipse', 'arrow', 'line', 'pencil', 'marker', 'text', 'number'] as const;
export type Tool = (typeof TOOLS)[number];
/** Las que dibujan (todas menos Select). */
export type DrawTool = Exclude<Tool, 'select'>;

/** La letra de cada herramienta (las de FrameRev, `ShortcutManager.cpp`). */
export const TOOL_LETTERS: Record<Tool, string> = {
  select: 'v',
  rectangle: 'r',
  ellipse: 'e',
  arrow: 'a',
  line: 'l',
  pencil: 'p',
  marker: 'm',
  text: 't',
  number: 'n',
};

/** El `type` del `.frproj` que guarda cada herramienta. */
export const TOOL_TYPES: Record<DrawTool, MarkupShape['type']> = {
  rectangle: 'rectangle',
  ellipse: 'ellipse',
  arrow: 'arrow',
  line: 'line',
  pencil: 'freehand_pencil',
  marker: 'freehand_marker',
  text: 'text',
  number: 'numbered_marker',
};

/** La herramienta de una forma guardada (para mostrar su estilo al elegirla). */
export function toolOf(type: MarkupShape['type']): DrawTool {
  const found = (Object.keys(TOOL_TYPES) as DrawTool[]).find((t) => TOOL_TYPES[t] === type);
  return found ?? 'rectangle';
}

/** Los 8 colores a un toque (AN6): los que se leen sobre cualquier foto, con el verde de FrameRev. */
export const PALETTE = ['#FF3B30', '#FFD60A', '#85DC53', '#32D7F0', '#0A84FF', '#FF2DAA', '#FFFFFF', '#000000'] as const;

/** Cuántos colores recientes se recuerdan. */
export const RECENT_COLORS = 8;

/** El grosor más grande que se puede escribir (FrameRev: barra de 0 a 40, número hasta 999). */
export const MAX_WIDTH = 999;
export const SLIDER_MAX_WIDTH = 40;
/** El tamaño de letra (y de número): de 4 a 400, a la referencia de 1920 px. */
export const MIN_FONT = 4;
export const MAX_FONT = 400;

/**
 * El estilo de una herramienta, en las unidades de la interfaz: el grosor y la letra en píxeles con el lado largo de
 * la foto llevado a 1920 (AN7); las opacidades de 0 a 100.
 */
export interface ToolStyle {
  color: string;
  width: number;
  opacity: number;
  /** El relleno: rectángulo y elipse (con trazo y relleno) y texto (una caja de fondo). */
  fill: boolean;
  fillOpacity: number;
  /** 0 Normal, 1 Open (Banner, después). */
  headStyle: 0 | 1;
  /** 2 End, 1 Both. */
  headPosition: 1 | 2;
  fontSize: number;
}

const BASE: ToolStyle = {
  color: DEFAULT_MARKUP_COLOR,
  width: 3,
  opacity: 100,
  fill: false,
  fillOpacity: 40,
  headStyle: 0,
  headPosition: 2,
  fontSize: 24,
};

/** Los valores de fábrica de FrameRev (`defaultToolProperties`): trazo 3; Marker 18 al 50 %; texto 24; número 16. */
export const DEFAULT_STYLES: Record<DrawTool, ToolStyle> = {
  rectangle: { ...BASE },
  ellipse: { ...BASE },
  arrow: { ...BASE },
  line: { ...BASE },
  pencil: { ...BASE },
  marker: { ...BASE, width: 18, opacity: 50 },
  text: { ...BASE, fillOpacity: 100 },
  number: { ...BASE, fontSize: 16, fillOpacity: 100 },
};

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Un estilo guardado (en el dispositivo) limpio, con lo que falte de los de fábrica de esa herramienta. */
export function cleanStyle(raw: unknown, tool: DrawTool): ToolStyle {
  const base = DEFAULT_STYLES[tool];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...base };
  const o = raw as Record<string, unknown>;
  const num = (k: keyof ToolStyle, lo: number, hi: number) => (finite(o[k]) ? clamp(o[k] as number, lo, hi) : (base[k] as number));
  return {
    color: safeColor(o.color, base.color),
    width: num('width', 0, MAX_WIDTH),
    opacity: num('opacity', 0, 100),
    fill: typeof o.fill === 'boolean' ? o.fill : base.fill,
    fillOpacity: num('fillOpacity', 0, 100),
    headStyle: o.headStyle === 1 ? 1 : o.headStyle === 0 ? 0 : base.headStyle,
    headPosition: o.headPosition === 1 ? 1 : o.headPosition === 2 ? 2 : base.headPosition,
    fontSize: num('fontSize', MIN_FONT, MAX_FONT),
  };
}

/** Los estilos de todas las herramientas desde lo guardado (uno roto vuelve al de fábrica). */
export function cleanStyles(raw: unknown): Record<DrawTool, ToolStyle> {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = {} as Record<DrawTool, ToolStyle>;
  for (const tool of Object.keys(DEFAULT_STYLES) as DrawTool[]) {
    out[tool] = cleanStyle(Object.prototype.hasOwnProperty.call(o, tool) ? o[tool] : undefined, tool);
  }
  return out;
}

/** Los recientes con el color nuevo adelante (sin repetir, como mucho `RECENT_COLORS`). */
export function pushRecent(recent: readonly string[], color: string): string[] {
  const c = safeColor(color, '');
  if (!c) return [...recent];
  return [c, ...recent.filter((r) => r !== c)].slice(0, RECENT_COLORS);
}

// --- AN7: el número de la interfaz contra la referencia de 1920 px ---------------------------------------------

/** Cuántos píxeles de la foto es un píxel de la interfaz (el lado largo llevado a 1920). */
export const unitOf = (frame: { w: number; h: number }): number => Math.max(frame.w, frame.h) / REFERENCE_SIDE;

/** Un número de la interfaz en píxeles del marco (lo que se guarda). */
export const toFrame = (value: number, frame: { w: number; h: number }): number => round2(value * unitOf(frame));

/** Lo guardado (píxeles del marco) en el número de la interfaz (redondeado a medio píxel). */
export const fromFrame = (value: number, frame: { w: number; h: number }): number => Math.round((value / unitOf(frame)) * 2) / 2;

const round2 = (v: number) => Math.round(v * 100) / 100;

// --- de un arrastre a una forma -------------------------------------------------------------------------------

export interface Point {
  x: number;
  y: number;
}

export interface Modifiers {
  /** Shift: cuadrado, círculo, ángulo de a 45°. */
  shift: boolean;
  /** Alt (⌥ en la Mac): desde el centro. */
  alt: boolean;
}

/**
 * El rectángulo de un arrastre de `a` a `b` (rectángulo, elipse): con Shift, cuadrado (el lado más largo); con Alt,
 * `a` es el centro. Siempre normalizado (ancho y alto positivos).
 */
export function dragRect(a: Point, b: Point, mods: Modifiers): Rect {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (mods.shift) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * side;
    dy = Math.sign(dy || 1) * side;
  }
  const x0 = mods.alt ? a.x - dx : a.x;
  const y0 = mods.alt ? a.y - dy : a.y;
  const x1 = a.x + dx;
  const y1 = a.y + dy;
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

/** Un ángulo llevado al múltiplo de 45° más cercano (Shift en la flecha y la línea), con el mismo largo. */
export function snap45(a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { ...b };
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: a.x + Math.cos(angle) * len, y: a.y + Math.sin(angle) * len };
}

/** La línea de un arrastre (flecha, línea): con Shift, de a 45°; con Alt, `a` es el centro. */
export function dragLine(a: Point, b: Point, mods: Modifiers): { start: Point; end: Point } {
  const end = mods.shift ? snap45(a, b) : { ...b };
  const start = mods.alt ? { x: 2 * a.x - end.x, y: 2 * a.y - end.y } : { ...a };
  return { start, end };
}

/**
 * Simplifica un trazo (lista plana `[x0, y0, x1, y1…]`) con Douglas-Peucker: saca los puntos que se apartan menos de
 * `tolerance` de la recta entre sus vecinos (medio píxel de pantalla, en unidades del marco). Iterativo: un trazo de
 * miles de puntos no llena la pila.
 */
export function simplify(points: readonly number[], tolerance: number): number[] {
  const n = Math.floor(points.length / 2);
  if (n <= 2 || !(tolerance > 0)) return points.slice(0, n * 2);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const tol2 = tolerance * tolerance;
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    const ax = points[first * 2];
    const ay = points[first * 2 + 1];
    const bx = points[last * 2];
    const by = points[last * 2 + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let worstD = tol2;
    for (let i = first + 1; i < last; i++) {
      const px = points[i * 2];
      const py = points[i * 2 + 1];
      let d: number;
      if (len2 === 0) d = (px - ax) ** 2 + (py - ay) ** 2;
      else {
        const t = clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
        d = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
      }
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst > 0) {
      keep[worst] = 1;
      stack.push([first, worst], [worst, last]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i * 2], points[i * 2 + 1]);
  return out;
}

/** Los puntos de un trazo relativos a su primer punto, redondeados al píxel del marco (y con el tope de puntos). */
export function relativePoints(points: readonly number[]): { posX: number; posY: number; points: number[] } {
  const n = Math.min(Math.floor(points.length / 2), MAX_POINTS);
  const posX = Math.round(points[0] ?? 0);
  const posY = Math.round(points[1] ?? 0);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.round(points[i * 2]) - posX, Math.round(points[i * 2 + 1]) - posY);
  // Un trazo de un toque que el redondeo dejó en dos puntos iguales: queda uno (se dibuja como un punto).
  if (out.length === 4 && out[2] === out[0] && out[3] === out[1]) out.length = 2;
  return { posX, posY, points: out };
}

/** Lo que mide un texto en una letra (en el navegador, un `canvas`; en las pruebas, una cuenta). */
export type Measure = (text: string, font: string) => number;

/** La medida de un renglón sin `canvas`: 0,6 del tamaño de letra por letra (alcanza para una caja). */
export const roughMeasure: Measure = (text, font) => {
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
  return Array.from(text).length * size * 0.6;
};

/** El alto de un renglón en tamaños de letra (el mismo de markupSvg.ts). */
export const TEXT_LINE_HEIGHT = 1.25;

/**
 * La caja de un texto (en el marco): el renglón más ancho con un 10 % de holgura (otra letra en otro dispositivo no lo
 * corta en dos renglones) y el relleno a los costados.
 */
export function textBox(text: string, fontSize: number, measure: Measure, font: string): { w: number; h: number; padding: number } {
  const lines = text.split(/\r\n|\r|\n/);
  const padding = round2(fontSize * 0.3);
  const widest = Math.max(fontSize * 0.5, ...lines.map((l) => measure(l, font)));
  return { w: round2(widest * 1.1 + 2 * padding), h: round2(lines.length * fontSize * TEXT_LINE_HEIGHT + 2 * padding), padding };
}

/** El texto cortado al tope (sin partir un emoji en dos). */
export function capText(text: string): string {
  return text.length <= MAX_TEXT ? text : Array.from(text).slice(0, MAX_TEXT).join('');
}

/** Los campos de estilo que se guardan, en píxeles del marco (los nombres del `.frproj` v2). */
export function styleFields(tool: DrawTool, style: ToolStyle, frame: MarkupFrame): ShapeFields {
  const f: ShapeFields = {
    strokeColor: style.color,
    strokeWidth: toFrame(style.width, frame),
    strokeOpacity: style.opacity,
  };
  if (tool === 'rectangle' || tool === 'ellipse') {
    f.fillMode = style.fill ? 2 : 1;
    f.fillColor = style.color;
    f.fillOpacity = style.fillOpacity;
  } else if (tool === 'arrow') {
    f.headStyle = style.headStyle;
    f.headPosition = style.headPosition;
    f.arrowHeadSize = 100;
  } else if (tool === 'text') {
    f.fillMode = style.fill ? 3 : 0;
    f.fillColor = style.color;
    f.fillOpacity = style.fillOpacity;
    f.fontSize = toFrame(style.fontSize, frame);
    f.cornerRadius = toFrame(style.fill ? 12 : 0, frame);
  } else if (tool === 'number') {
    f.fillColor = style.color;
    f.fillOpacity = style.fillOpacity;
    f.fontSize = toFrame(style.fontSize, frame);
  }
  return f;
}

/** Una forma de dos puntos o de caja, lista para guardar. */
export function boxShape(tool: 'rectangle' | 'ellipse', rect: Rect, style: ToolStyle, frame: MarkupFrame, z: number): ShapeFields {
  return {
    type: TOOL_TYPES[tool],
    zValue: z,
    posX: round2(rect.x),
    posY: round2(rect.y),
    rectX: 0,
    rectY: 0,
    rectW: round2(rect.w),
    rectH: round2(rect.h),
    ...styleFields(tool, style, frame),
  };
}

export function lineShape(tool: 'arrow' | 'line', start: Point, end: Point, style: ToolStyle, frame: MarkupFrame, z: number): ShapeFields {
  return {
    type: TOOL_TYPES[tool],
    zValue: z,
    posX: round2(start.x),
    posY: round2(start.y),
    startX: 0,
    startY: 0,
    endX: round2(end.x - start.x),
    endY: round2(end.y - start.y),
    ...styleFields(tool, style, frame),
  };
}

export function strokeShape(tool: 'pencil' | 'marker', points: readonly number[], style: ToolStyle, frame: MarkupFrame, z: number): ShapeFields {
  const rel = relativePoints(points);
  return { type: TOOL_TYPES[tool], zValue: z, posX: rel.posX, posY: rel.posY, points: rel.points, ...styleFields(tool, style, frame) };
}

/** Un texto con su caja (el punto es donde empieza la primera letra). */
export function textShape(at: Point, text: string, style: ToolStyle, frame: MarkupFrame, z: number, measure: Measure, font: string): ShapeFields {
  const fields = styleFields('text', style, frame);
  const fontSize = fields.fontSize as number;
  const value = capText(text);
  const box = textBox(value, fontSize, measure, font);
  return {
    type: 'text',
    zValue: z,
    posX: round2(at.x - box.padding),
    posY: round2(at.y - box.padding),
    rectX: 0,
    rectY: 0,
    rectW: box.w,
    rectH: box.h,
    padding: box.padding,
    text: value,
    ...fields,
  };
}

/** Lo que cambia en un texto al editarlo (el texto y su caja; el lugar de la primera letra no se mueve). */
export function textEdit(text: string, fontSize: number, measure: Measure, font: string): ShapeFields {
  const value = capText(text);
  const box = textBox(value, fontSize, measure, font);
  return { text: value, rectX: 0, rectY: 0, rectW: box.w, rectH: box.h, padding: box.padding };
}

/** Un número centrado en el punto. */
export function numberShape(at: Point, n: number, style: ToolStyle, frame: MarkupFrame, z: number): ShapeFields {
  return { type: 'numbered_marker', zValue: z, posX: round2(at.x), posY: round2(at.y), number: n, ...styleFields('number', style, frame) };
}

/** El número que sigue: el más alto + 1 (como FrameRev; dos a la vez pueden repetir uno). */
export function nextNumber(shapes: readonly MarkupShape[]): number {
  let max = 0;
  for (const s of shapes) if (s.type === 'numbered_marker' && s.number > max) max = s.number;
  return max + 1;
}

/** El `zValue` para una forma nueva: arriba de todas. */
export function topZ(shapes: readonly MarkupShape[]): number {
  let max = 0;
  for (const s of shapes) if (s.z > max) max = s.z;
  return Math.floor(max) + 1;
}

/** Un id nuevo para una forma (único: dos anotando a la vez sin red nunca chocan). */
export function newShapeId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

// --- qué hay bajo el cursor ------------------------------------------------------------------------------------

/** La caja de una forma en el marco (sin girar; la rotación solo la trae un `.frproj`). */
export function shapeBounds(s: MarkupShape, measure: Measure = roughMeasure): Rect {
  const at = (r: Rect): Rect => ({ x: s.posX + r.x, y: s.posY + r.y, w: r.w, h: r.h });
  switch (s.type) {
    case 'rectangle':
    case 'ellipse':
      return at(s.rect);
    case 'line':
    case 'arrow': {
      const [x1, y1] = s.start;
      const [x2, y2] = s.end;
      return at({ x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) });
    }
    case 'freehand_pencil':
    case 'freehand_marker': {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i + 1 < s.points.length; i += 2) {
        minX = Math.min(minX, s.points[i]);
        maxX = Math.max(maxX, s.points[i]);
        minY = Math.min(minY, s.points[i + 1]);
        maxY = Math.max(maxY, s.points[i + 1]);
      }
      return at({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
    }
    case 'text': {
      if (s.rect && s.rect.w > 0 && s.rect.h > 0) return at(s.rect);
      const box = textBox(s.text, s.fontSize, measure, `${s.fontSize}px sans-serif`);
      return at({ x: 0, y: 0, w: box.w - 2 * box.padding, h: box.h - 2 * box.padding });
    }
    case 'numbered_marker':
      return at(s.rect && s.rect.w > 0 && s.rect.h > 0 ? s.rect : { x: -s.fontSize, y: -s.fontSize, w: 2 * s.fontSize, h: 2 * s.fontSize });
  }
}

/** La distancia de un punto a un segmento. */
function segmentDistance(p: Point, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((p.x - ax) * dx + (p.y - ay) * dy) / len2, 0, 1);
  return Math.hypot(p.x - (ax + t * dx), p.y - (ay + t * dy));
}

/**
 * Si el punto toca la forma: el trazo (con `tolerance` más medio grosor) o, si tiene relleno o es un texto o un número,
 * su interior.
 */
export function hitsShape(s: MarkupShape, p: Point, tolerance: number, measure: Measure = roughMeasure): boolean {
  const tol = tolerance + s.strokeWidth / 2;
  const filled = s.fillMode === 2 || s.fillMode === 3;
  switch (s.type) {
    case 'rectangle': {
      const r = shapeBounds(s);
      const inside = p.x >= r.x - tol && p.x <= r.x + r.w + tol && p.y >= r.y - tol && p.y <= r.y + r.h + tol;
      if (!inside) return false;
      if (filled) return true;
      const innerX = p.x > r.x + tol && p.x < r.x + r.w - tol;
      const innerY = p.y > r.y + tol && p.y < r.y + r.h - tol;
      return !(innerX && innerY);
    }
    case 'ellipse': {
      const r = shapeBounds(s);
      const rx = r.w / 2;
      const ry = r.h / 2;
      const cx = r.x + rx;
      const cy = r.y + ry;
      if (rx <= 0 || ry <= 0) return Math.hypot(p.x - cx, p.y - cy) <= tol + Math.max(rx, ry);
      const outer = ((p.x - cx) / (rx + tol)) ** 2 + ((p.y - cy) / (ry + tol)) ** 2 <= 1;
      if (!outer) return false;
      if (filled || rx <= tol || ry <= tol) return true;
      return ((p.x - cx) / (rx - tol)) ** 2 + ((p.y - cy) / (ry - tol)) ** 2 >= 1;
    }
    case 'line':
    case 'arrow':
      return segmentDistance(p, s.posX + s.start[0], s.posY + s.start[1], s.posX + s.end[0], s.posY + s.end[1]) <= tol;
    case 'freehand_pencil':
    case 'freehand_marker': {
      const pts = s.points;
      if (pts.length === 2) return Math.hypot(p.x - s.posX - pts[0], p.y - s.posY - pts[1]) <= tol;
      for (let i = 0; i + 3 < pts.length; i += 2) {
        if (segmentDistance(p, s.posX + pts[i], s.posY + pts[i + 1], s.posX + pts[i + 2], s.posY + pts[i + 3]) <= tol) return true;
      }
      return false;
    }
    case 'text':
    case 'numbered_marker': {
      const r = shapeBounds(s, measure);
      return p.x >= r.x - tolerance && p.x <= r.x + r.w + tolerance && p.y >= r.y - tolerance && p.y <= r.y + r.h + tolerance;
    }
  }
}

/** La forma de más arriba bajo el punto (las formas van de abajo hacia arriba), o `null`. */
export function hitTest(shapes: readonly MarkupShape[], p: Point, tolerance: number, measure: Measure = roughMeasure): MarkupShape | null {
  for (let i = shapes.length - 1; i >= 0; i--) if (hitsShape(shapes[i], p, tolerance, measure)) return shapes[i];
  return null;
}

/** Las formas que toca un recuadro de selección. */
export function shapesInRect(shapes: readonly MarkupShape[], r: Rect, measure: Measure = roughMeasure): MarkupShape[] {
  return shapes.filter((s) => {
    const b = shapeBounds(s, measure);
    return b.x <= r.x + r.w && b.x + b.w >= r.x && b.y <= r.y + r.h && b.y + b.h >= r.y;
  });
}

/** La caja que abarca varias formas, o `null`. */
export function unionBounds(shapes: readonly MarkupShape[], measure: Measure = roughMeasure): Rect | null {
  if (shapes.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of shapes) {
    const b = shapeBounds(s, measure);
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// --- editar lo que ya está ---------------------------------------------------------------------------------------

/** Los tiradores de una forma: las cuatro esquinas de una caja, o los dos extremos de una línea. */
export type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'start' | 'end';

/** Los tiradores que tiene una forma (el lápiz y el número solo se mueven). */
export function handlesOf(s: MarkupShape): { handle: Handle; at: Point }[] {
  if (s.type === 'line' || s.type === 'arrow') {
    return [
      { handle: 'start', at: { x: s.posX + s.start[0], y: s.posY + s.start[1] } },
      { handle: 'end', at: { x: s.posX + s.end[0], y: s.posY + s.end[1] } },
    ];
  }
  if (s.type === 'rectangle' || s.type === 'ellipse' || (s.type === 'text' && s.rect)) {
    const r = shapeBounds(s);
    return [
      { handle: 'nw', at: { x: r.x, y: r.y } },
      { handle: 'ne', at: { x: r.x + r.w, y: r.y } },
      { handle: 'sw', at: { x: r.x, y: r.y + r.h } },
      { handle: 'se', at: { x: r.x + r.w, y: r.y + r.h } },
    ];
  }
  return [];
}

/** Lo que cambia mover formas: solo `posX`/`posY` (una propiedad por clave, sección 3). */
export function moveFields(s: MarkupShape, dx: number, dy: number): ShapeFields {
  return { posX: round2(s.posX + dx), posY: round2(s.posY + dy) };
}

/**
 * Lo que cambia arrastrar un tirador hasta `p`: en una caja, la esquina opuesta queda quieta (Shift: cuadrado); en una
 * línea, el otro extremo (Shift: de a 45°). Solo los campos que cambian.
 */
export function handleFields(s: MarkupShape, handle: Handle, p: Point, mods: Modifiers): ShapeFields {
  if (s.type === 'line' || s.type === 'arrow') {
    const start = { x: s.posX + s.start[0], y: s.posY + s.start[1] };
    const end = { x: s.posX + s.end[0], y: s.posY + s.end[1] };
    if (handle === 'start') {
      const next = mods.shift ? snap45(end, p) : p;
      return { posX: round2(next.x), posY: round2(next.y), startX: 0, startY: 0, endX: round2(end.x - next.x), endY: round2(end.y - next.y) };
    }
    const next = mods.shift ? snap45(start, p) : p;
    return { posX: round2(start.x), posY: round2(start.y), startX: 0, startY: 0, endX: round2(next.x - start.x), endY: round2(next.y - start.y) };
  }
  const r = shapeBounds(s);
  const anchor: Point = {
    x: handle === 'nw' || handle === 'sw' ? r.x + r.w : r.x,
    y: handle === 'nw' || handle === 'ne' ? r.y + r.h : r.y,
  };
  const box = dragRect(anchor, p, { shift: mods.shift, alt: false });
  return { posX: round2(box.x), posY: round2(box.y), rectX: 0, rectY: 0, rectW: round2(box.w), rectH: round2(box.h) };
}

/** Si un arrastre ya es un arrastre (y no un clic): más de `slop` en unidades del marco. */
export const moved = (a: Point, b: Point, slop: number): boolean => Math.hypot(b.x - a.x, b.y - a.y) > slop;

/** Lo que cambia en una forma elegida al cambiar el estilo (y que pasa a ser el de su herramienta, como FrameRev). */
export function restyleFields(s: MarkupShape, patch: Partial<ToolStyle>, frame: MarkupFrame): ShapeFields {
  const out: ShapeFields = {};
  if (patch.color !== undefined) {
    out.strokeColor = patch.color;
    if (s.type === 'rectangle' || s.type === 'ellipse' || s.type === 'text' || s.type === 'numbered_marker') out.fillColor = patch.color;
  }
  if (patch.width !== undefined) out.strokeWidth = toFrame(patch.width, frame);
  if (patch.opacity !== undefined) out.strokeOpacity = patch.opacity;
  if (patch.fillOpacity !== undefined) out.fillOpacity = patch.fillOpacity;
  if (patch.fill !== undefined) {
    if (s.type === 'rectangle' || s.type === 'ellipse') out.fillMode = patch.fill ? 2 : 1;
    if (s.type === 'text') out.fillMode = patch.fill ? 3 : 0;
  }
  if (patch.headStyle !== undefined && s.type === 'arrow') out.headStyle = patch.headStyle;
  if (patch.headPosition !== undefined && s.type === 'arrow') out.headPosition = patch.headPosition;
  if (patch.fontSize !== undefined && (s.type === 'text' || s.type === 'numbered_marker')) out.fontSize = toFrame(patch.fontSize, frame);
  return out;
}

/** El estilo de una forma guardada, en las unidades de la interfaz (para la franja de propiedades al elegirla). */
export function styleOfShape(s: MarkupShape, frame: MarkupFrame): ToolStyle {
  const tool = toolOf(s.type);
  const base = DEFAULT_STYLES[tool];
  return {
    color: s.strokeColor,
    width: fromFrame(s.strokeWidth, frame),
    opacity: Math.round(s.strokeOpacity * 100),
    fill: s.type === 'text' ? s.fillMode === 3 || s.fillMode === 2 : s.fillMode === 2 || s.fillMode === 3,
    fillOpacity: Math.round(s.fillOpacity * 100),
    headStyle: s.type === 'arrow' && s.headStyle === 1 ? 1 : 0,
    headPosition: s.type === 'arrow' && s.headPosition === 1 ? 1 : 2,
    fontSize: s.type === 'text' || s.type === 'numbered_marker' ? clamp(fromFrame(s.fontSize, frame), MIN_FONT, MAX_FONT) : base.fontSize,
  };
}

/** Qué controles muestra la franja para una herramienta. */
export function controlsOf(tool: DrawTool): { width: boolean; fill: 'shape' | 'box' | null; arrow: boolean; font: boolean } {
  return {
    width: tool !== 'text' && tool !== 'number',
    fill: tool === 'rectangle' || tool === 'ellipse' ? 'shape' : tool === 'text' ? 'box' : null,
    arrow: tool === 'arrow',
    font: tool === 'text' || tool === 'number',
  };
}
