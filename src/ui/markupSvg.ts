import { REFERENCE_SIDE, type LineShape, type MarkupShape, type NumberShape, type PhotoMarkup, type Rect, type TextShape } from '../media/markup';

// El dibujo de las anotaciones de una foto (P.20, Docs/Doc_Anotar_Fotos.md, sección 4): un `<svg>` con
// `viewBox="0 0 w h"` (el marco: los píxeles de la foto) en la misma caja que el `<img>`. Sin `preserveAspectRatio`
// (el de fábrica, `xMidYMid meet`, es exactamente `object-fit: contain`), así lo mismo sirve para la miniatura de una
// celda, la foto de la página, el carrete y el PDF.
//
// Todo lo que viene del mapa ya pasó por `readShape` (media/markup.ts): colores `#RRGGBB`, números acotados. Acá el
// texto va SOLO como `textContent` (nunca `innerHTML`), ningún atributo se arma con texto del mapa, no hay `href` ni
// `style` ni ids (la vista de impresión saca los ids de la copia: nada acá depende de uno). El dibujo sigue a FrameRev
// (las mismas cuentas de la cabeza de la flecha y de la tinta automática del texto), en SVG.

const NS = 'http://www.w3.org/2000/svg';

/** La letra de la app (la de `--font` en styles.css): la misma en la página, el carrete y el PDF. */
export const MARKUP_FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

/** El alto de un renglón de texto, en tamaños de letra. */
const LINE_HEIGHT = 1.25;

/**
 * Las letras que se dibujan, como mucho, en una foto (sumando todos sus textos). El mapa es entrada no confiable: con
 * 2000 formas de 2000 letras, sin este tope, cada cambio armaba millones de letras (auditoría B1). Una foto anotada a
 * mano no se acerca: lo que pasa del tope no se dibuja (queda guardado).
 */
export const MAX_DRAWN_CHARS = 20_000;

export interface MarkupDrawOptions {
  /**
   * El grosor mínimo de un trazo, en unidades del marco (lo que mide 1 px de pantalla): una foto chica (la miniatura
   * de una celda) no pierde un trazo fino. Sin esto, el grosor guardado.
   */
  minStroke?: number;
  /** Mide el ancho de un renglón (para cortar el texto en su caja); sin esto, el texto no se corta en renglones. */
  measure?: (text: string, font: string) => number;
}

const el = <K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

/** Un número corto para un atributo (4 decimales alcanzan para cualquier foto). */
const n = (v: number) => String(Math.round(v * 1e4) / 1e4);

/** Un `<svg>` nuevo para las anotaciones (sin dibujo: lo pone `drawMarkup`). */
export function createMarkupSvg(): SVGSVGElement {
  const svg = el('svg', { class: 'sd-markup', 'aria-hidden': 'true', focusable: 'false' });
  return svg;
}

/** Dibuja las anotaciones de la foto en `svg` (reemplaza lo que tenía). */
export function drawMarkup(svg: SVGSVGElement, photo: PhotoMarkup, options: MarkupDrawOptions = {}): void {
  const { w, h } = photo.frame;
  svg.setAttribute('viewBox', `0 0 ${n(w)} ${n(h)}`);
  svg.setAttribute('data-file-id', photo.fileId);
  const unit = Math.max(w, h) / REFERENCE_SIDE;
  const ctx: Ctx = { unit, minStroke: options.minStroke ?? 0, measure: options.measure ?? defaultMeasure(), chars: MAX_DRAWN_CHARS };
  const out: SVGElement[] = [];
  for (const shape of photo.shapes) {
    const g = drawShape(shape, ctx);
    if (g) out.push(g);
  }
  svg.replaceChildren(...out);
}

interface Ctx {
  unit: number;
  minStroke: number;
  measure: ((text: string, font: string) => number) | null;
  /** Las letras que todavía se pueden dibujar en esta foto (`MAX_DRAWN_CHARS`). */
  chars: number;
}

/** El grosor con que se dibuja (nunca por debajo del mínimo de pantalla, salvo 0: sin trazo). */
const strokeWidthOf = (s: MarkupShape, ctx: Ctx) => (s.strokeWidth > 0 ? Math.max(s.strokeWidth, ctx.minStroke) : 0);

/** El trazo de la forma (color, grosor, opacidad, remate). */
function stroke(node: SVGElement, s: MarkupShape, ctx: Ctx, join = 'round'): void {
  const sw = strokeWidthOf(s, ctx);
  if (sw <= 0 || s.strokeOpacity <= 0) {
    node.setAttribute('stroke', 'none');
    return;
  }
  node.setAttribute('stroke', s.strokeColor);
  node.setAttribute('stroke-width', n(sw));
  if (s.strokeOpacity < 1) node.setAttribute('stroke-opacity', n(s.strokeOpacity));
  node.setAttribute('stroke-linecap', s.cap);
  node.setAttribute('stroke-linejoin', join);
}

/** El relleno de la forma (solo si el modo lo pide y la opacidad no es 0). */
function fill(node: SVGElement, s: MarkupShape, on: boolean): void {
  if (!on || s.fillOpacity <= 0) {
    node.setAttribute('fill', 'none');
    return;
  }
  node.setAttribute('fill', s.fillColor);
  if (s.fillOpacity < 1) node.setAttribute('fill-opacity', n(s.fillOpacity));
}

const withStroke = (s: MarkupShape) => s.fillMode === 1 || s.fillMode === 2;
const withFill = (s: MarkupShape) => s.fillMode === 2 || s.fillMode === 3;

/** El grupo de la forma: en `posX/posY`, girado alrededor del centro de su caja (como FrameRev). */
function group(s: MarkupShape, box: Rect | null): SVGGElement {
  const g = el('g', { 'data-shape': s.type });
  let transform = `translate(${n(s.posX)} ${n(s.posY)})`;
  if (s.rotation && box) transform += ` rotate(${n(s.rotation)} ${n(box.x + box.w / 2)} ${n(box.y + box.h / 2)})`;
  g.setAttribute('transform', transform);
  return g;
}

function drawShape(s: MarkupShape, ctx: Ctx): SVGGElement | null {
  switch (s.type) {
    case 'rectangle': {
      const g = group(s, s.rect);
      const r = el('rect', { x: n(s.rect.x), y: n(s.rect.y), width: n(s.rect.w), height: n(s.rect.h) });
      if (s.cornerRadius > 0) r.setAttribute('rx', n(Math.min(s.cornerRadius, s.rect.w / 2, s.rect.h / 2)));
      paint(r, s, ctx, 'miter');
      g.append(r);
      return g;
    }
    case 'ellipse': {
      const g = group(s, s.rect);
      const e = el('ellipse', {
        cx: n(s.rect.x + s.rect.w / 2),
        cy: n(s.rect.y + s.rect.h / 2),
        rx: n(s.rect.w / 2),
        ry: n(s.rect.h / 2),
      });
      paint(e, s, ctx);
      g.append(e);
      return g;
    }
    case 'line':
    case 'arrow':
      return drawLine(s, ctx);
    case 'freehand_pencil':
    case 'freehand_marker': {
      const xs = s.points.filter((_, i) => i % 2 === 0);
      const ys = s.points.filter((_, i) => i % 2 === 1);
      const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      const g = group(s, box);
      if (s.points.length === 2) {
        // Un toque sin mover: un punto del grosor del trazo.
        const sw = strokeWidthOf(s, ctx);
        const dot = el('circle', { cx: n(s.points[0]), cy: n(s.points[1]), r: n(sw / 2) });
        dot.setAttribute('fill', s.strokeColor);
        if (s.strokeOpacity < 1) dot.setAttribute('fill-opacity', n(s.strokeOpacity));
        g.append(dot);
        return g;
      }
      const pts: string[] = [];
      for (let i = 0; i + 1 < s.points.length; i += 2) pts.push(`${n(s.points[i])},${n(s.points[i + 1])}`);
      const line = el('polyline', { points: pts.join(' '), fill: 'none' });
      stroke(line, { ...s, cap: 'round' }, ctx);
      g.append(line);
      return g;
    }
    case 'text':
      return drawText(s, ctx);
    case 'numbered_marker':
      return drawNumber(s, ctx);
  }
}

/** Trazo y relleno según el modo de la forma (los ordinales de FrameRev). */
function paint(node: SVGElement, s: MarkupShape, ctx: Ctx, join = 'round'): void {
  fill(node, s, withFill(s));
  if (withStroke(s)) stroke(node, s, ctx, join);
  else node.setAttribute('stroke', 'none');
}

// --- la flecha (las cuentas de FrameRev, ArrowAnnotation.cpp, a la escala del marco) ------------------------

const HEAD_HALF_ANGLE = (22 * Math.PI) / 180;

/** El largo de la cabeza: `headLengthFor` de FrameRev, con sus mínimos llevados a la referencia de 1920 px. */
export function headLength(strokeWidth: number, headSize: number, unit: number): number {
  return Math.max(6 * unit, Math.max(10 * unit, strokeWidth * 4) * (headSize / 100));
}

/** El medio ancho de la cabeza: `headHalfWidthFor` de FrameRev. */
export function headHalfWidth(length: number, strokeWidth: number, unit: number): number {
  return Math.max(length * Math.tan(HEAD_HALF_ANGLE), strokeWidth / 2 + Math.max(2 * unit, strokeWidth * 0.5));
}

function drawLine(s: LineShape, ctx: Ctx): SVGGElement {
  const [x1, y1] = s.start;
  const [x2, y2] = s.end;
  const g = group(s, { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) });
  const sw = strokeWidthOf(s, ctx);
  const len = Math.hypot(x2 - x1, y2 - y1);
  const heads = s.type === 'arrow' && len > 0 && sw > 0;
  const atEnd = heads && (s.headPosition === 2 || s.headPosition === 1);
  const atStart = heads && (s.headPosition === 0 || s.headPosition === 1);
  const hl = headLength(sw, s.headSize, ctx.unit);
  const open = s.headStyle === 1;
  // El cuerpo llega hasta la base de una cabeza llena (si no, su remate asoma por la punta); con la cabeza abierta, a
  // la punta (la V lo tapa).
  const ux = len > 0 ? (x2 - x1) / len : 0;
  const uy = len > 0 ? (y2 - y1) / len : 0;
  const back = (on: boolean) => (on && !open ? Math.min(hl * 0.9, len / 2) : 0);
  const shaft = el('line', {
    x1: n(x1 + ux * back(atStart)),
    y1: n(y1 + uy * back(atStart)),
    x2: n(x2 - ux * back(atEnd)),
    y2: n(y2 - uy * back(atEnd)),
  });
  stroke(shaft, heads ? { ...s, cap: 'butt' } : s, ctx);
  g.append(shaft);
  const head = (tipX: number, tipY: number, dx: number, dy: number) => {
    const half = headHalfWidth(hl, sw, ctx.unit);
    const bx = tipX - dx * hl;
    const by = tipY - dy * hl;
    const left = `${n(bx - dy * half)},${n(by + dx * half)}`;
    const right = `${n(bx + dy * half)},${n(by - dx * half)}`;
    const tip = `${n(tipX)},${n(tipY)}`;
    if (open) {
      const v = el('polyline', { points: `${left} ${tip} ${right}`, fill: 'none' });
      stroke(v, { ...s, cap: 'round' }, ctx, 'miter');
      v.setAttribute('stroke-miterlimit', '4');
      g.append(v);
    } else {
      const tri = el('polygon', { points: `${left} ${tip} ${right}` });
      tri.setAttribute('fill', s.strokeColor);
      if (s.strokeOpacity < 1) tri.setAttribute('fill-opacity', n(s.strokeOpacity));
      g.append(tri);
    }
  };
  if (atEnd) head(x2, y2, ux, uy);
  if (atStart) head(x1, y1, -ux, -uy);
  return g;
}

// --- texto y número --------------------------------------------------------------------------------------

/** La tinta automática de FrameRev (`TextContrast.h`): negro sobre un fondo claro, blanco sobre uno oscuro. */
export function contrastInk(background: string): string {
  const v = parseInt(background.slice(1), 16);
  const lum = 0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255);
  return lum >= 128 ? '#000000' : '#FFFFFF';
}

/** El color del número automático de FrameRev (`automaticNumberColor`): con su umbral propio (0,6). */
export function numberInk(fillColor: string): string {
  const v = parseInt(fillColor.slice(1), 16);
  const luma = (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
  return luma > 0.6 ? '#000000' : '#FFFFFF';
}

const fontOf = (size: number, bold: boolean, italic: boolean) => `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${MARKUP_FONT}`;

/**
 * Corta el texto en renglones: los saltos que tiene y, si hay con qué medir, el ancho de la caja. Lineal en el largo
 * del texto (auditoría B1: medir `renglón + palabra` en cada palabra era cuadrático y un mapa con textos largos colgaba
 * la página): cada palabra distinta se mide una sola vez y el ancho del renglón es la suma. Corta en `maxLines`
 * renglones (los que no entran en la caja no se ven: se recortan igual).
 */
export function wrapLines(text: string, width: number | null, font: string, measure: Ctx['measure'], maxLines = Infinity): string[] {
  const out: string[] = [];
  const widths = new Map<string, number>();
  const widthOf = (word: string, m: NonNullable<Ctx['measure']>) => {
    let w = widths.get(word);
    if (w === undefined) {
      w = m(word, font);
      widths.set(word, w);
    }
    return w;
  };
  for (const para of text.split(/\r\n|\r|\n/)) {
    if (out.length >= maxLines) break;
    if (!measure || !width || width <= 0) {
      out.push(para);
      continue;
    }
    let line = '';
    let lineWidth = 0;
    // `split` con el grupo alterna palabra y espacio: una palabra nunca empieza con espacio.
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue;
      const w = widthOf(word, measure);
      if (line && !/^\s/.test(word) && lineWidth + w > width) {
        out.push(line.trimEnd());
        if (out.length >= maxLines) return out;
        line = word;
        lineWidth = w;
      } else {
        line += word;
        lineWidth += w;
      }
    }
    out.push(line);
  }
  return out;
}

/** El texto que todavía entra en el tope de letras de la foto (sin partir un emoji en dos); lo descuenta del tope. */
function budget(text: string, ctx: Ctx): string {
  let out = text;
  if (out.length > ctx.chars) {
    out = out.slice(0, Math.max(0, ctx.chars));
    // Una mitad de un par sustituto suelta al final se saca.
    const last = out.charCodeAt(out.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1);
  }
  ctx.chars -= out.length;
  return out;
}

let measurer: ((text: string, font: string) => number) | null | undefined;

/** Mide con un `canvas` fuera de la pantalla, si el navegador lo tiene (las pruebas no: el texto no se corta). */
function defaultMeasure(): Ctx['measure'] {
  if (measurer !== undefined) return measurer;
  measurer = null;
  try {
    if (typeof OffscreenCanvas === 'function') {
      const c = new OffscreenCanvas(1, 1).getContext('2d');
      if (c) {
        // La letra se pone una vez por texto (todas las palabras de un texto llegan con la misma): parsearla en cada
        // medida costaba más que medir.
        let current = '';
        measurer = (text, font) => {
          if (font !== current) {
            c.font = font;
            current = font;
          }
          return c.measureText(text).width;
        };
      }
    }
  } catch {
    measurer = null;
  }
  return measurer;
}

/**
 * Lo que mide un renglón con la letra de las anotaciones (el anotador arma la caja de un texto con esto), o `null` si
 * el navegador no tiene con qué medir.
 */
export function markupMeasure(): ((text: string, font: string) => number) | null {
  return defaultMeasure();
}

function drawText(s: TextShape, ctx: Ctx): SVGGElement {
  const g = group(s, s.rect);
  const boxed = s.rect && s.rect.w > 0 && s.rect.h > 0 ? s.rect : null;
  const painted = withFill(s) && s.fillOpacity > 0;
  if (boxed && (painted || withStroke(s))) {
    const r = el('rect', { x: n(boxed.x), y: n(boxed.y), width: n(boxed.w), height: n(boxed.h) });
    if (s.cornerRadius > 0) r.setAttribute('rx', n(Math.min(s.cornerRadius, boxed.w / 2, boxed.h / 2)));
    paint(r, s, ctx, 'miter');
    g.append(r);
  }
  // La tinta: la elegida; si no, el color del trazo, o el contraste con el fondo si la caja tiene fondo (FrameRev).
  const ink = s.textColor ?? (painted ? contrastInk(s.fillColor) : s.strokeColor);
  const font = fontOf(s.fontSize, s.bold, s.italic);
  const pad = boxed ? s.padding : 0;
  const inner = boxed ? boxed.w - 2 * pad : null;
  // Solo los renglones que entran en la caja (uno más, por las letras que bajan del renglón): los demás se recortan.
  const maxLines = boxed ? Math.max(1, Math.ceil((boxed.h - pad) / (s.fontSize * LINE_HEIGHT)) + 1) : Infinity;
  const lines = wrapLines(budget(s.text, ctx), inner, font, ctx.measure, maxLines);
  const anchor = s.alignment === 1 ? 'middle' : s.alignment === 2 ? 'end' : 'start';
  const x0 = boxed ? (s.alignment === 1 ? boxed.x + boxed.w / 2 : s.alignment === 2 ? boxed.x + boxed.w - pad : boxed.x + pad) : 0;
  const y0 = (boxed ? boxed.y + pad : 0) + s.fontSize;
  const text = el('text', {
    x: n(x0),
    y: n(y0),
    fill: ink,
    'font-size': n(s.fontSize),
    'font-family': MARKUP_FONT,
    'text-anchor': anchor,
  });
  if (s.bold) text.setAttribute('font-weight', 'bold');
  if (s.italic) text.setAttribute('font-style', 'italic');
  lines.forEach((line, i) => {
    const span = el('tspan', { x: n(x0) });
    if (i > 0) span.setAttribute('dy', n(s.fontSize * LINE_HEIGHT));
    // Solo texto: lo que venga en el mapa nunca se lee como marcado.
    span.textContent = line;
    text.append(span);
  });
  if (boxed) {
    // Lo que no entra en la caja se corta (como FrameRev): un `<svg>` adentro recorta lo suyo, sin ids.
    const clip = el('svg', { x: n(boxed.x), y: n(boxed.y), width: n(boxed.w), height: n(boxed.h), overflow: 'hidden' });
    clip.setAttribute('viewBox', `${n(boxed.x)} ${n(boxed.y)} ${n(boxed.w)} ${n(boxed.h)}`);
    clip.append(text);
    g.append(clip);
  } else g.append(text);
  return g;
}

function drawNumber(s: NumberShape, ctx: Ctx): SVGGElement {
  // Sin caja guardada, un círculo del doble del tamaño de letra, centrado en `posX/posY`.
  const r = s.rect && s.rect.w > 0 && s.rect.h > 0 ? s.rect : { x: -s.fontSize, y: -s.fontSize, w: 2 * s.fontSize, h: 2 * s.fontSize };
  const g = group(s, r);
  const circle = el('ellipse', { cx: n(r.x + r.w / 2), cy: n(r.y + r.h / 2), rx: n(r.w / 2), ry: n(r.h / 2) });
  // Como FrameRev (NumberedMarkerAnnotation::paint): relleno y contorno siempre, cada uno con su opacidad.
  fill(circle, s, true);
  stroke(circle, s, ctx);
  g.append(circle);
  const label = el('text', {
    x: n(r.x + r.w / 2),
    y: n(r.y + r.h / 2),
    fill: s.numberColor ?? numberInk(s.fillColor),
    'font-size': n(s.fontSize),
    'font-family': MARKUP_FONT,
    'font-weight': 'bold',
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
  });
  label.textContent = String(s.number);
  g.append(label);
  return g;
}
