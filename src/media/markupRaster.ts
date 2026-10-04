import * as Y from 'yjs';
import { jpegInfo } from '../export/exportImages';
import { MAX_POINTS, MAX_SHAPES, MAX_TEXT, MARKUP_FORMAT_VERSION, parseMarkupKey, readFrame, readShape, REFERENCE_SIDE, type MarkupShape, type PhotoMarkup, type Rect } from './markup';
import { contrastInk, headHalfWidth, headLength, MARKUP_FONT, MAX_DRAWN_CHARS, numberInk, wrapLines } from '../ui/markupSvg';

import { checkRasterAbort, RasterError } from './rasterError';
import { webpInfo } from './webpInfo';
import { checkRasterPng } from './rasterPng';
export { checkRasterAbort, RasterError, type RasterFailure } from './rasterError';
export const rasterLimits = (mobile: boolean) => ({ bytes: (mobile ? 64 : 128) * 1024 ** 2, pixels: mobile ? 16_000_000 : 64_000_000, side: mobile ? 8192 : 16384 });
export function checkRasterSize(width: number, height: number, mobile: boolean): void {
  const cap = rasterLimits(mobile);
  if (![width, height].every((n) => Number.isSafeInteger(n) && n > 0 && n <= cap.side) || width * height > cap.pixels) throw new RasterError('size');
}

/** Copia íntegra de las formas conocidas, sin limpiar ni truncar el documento. */
export function rasterSnapshot(map: Y.Map<unknown>, fileId: string): PhotoMarkup {
  const frame = readFrame(map.get(fileId));
  const rawFrame = map.get(fileId) as { v?: unknown } | undefined;
  if (!frame || rawFrame?.v !== MARKUP_FORMAT_VERSION) throw new RasterError('annotations');
  const shapes: MarkupShape[] = [];
  let chars = 0;
  map.forEach((value, key) => {
    if (!key.startsWith(`${fileId}/`)) return;
    const id = parseMarkupKey(key)?.shapeId;
    if (!id || (!(value instanceof Y.Map) && (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Y.AbstractType))) throw new RasterError('annotations');
    const field = (name: string) => value instanceof Y.Map ? value.get(name) : Object.prototype.hasOwnProperty.call(value, name) ? (value as Record<string, unknown>)[name] : undefined;
    const text = field('text');
    if (field('type') === 'text') {
      if (typeof text !== 'string' || text.length > MAX_TEXT) throw new RasterError('annotations');
      chars += text.length;
    }
    if (field('type') === 'freehand_pencil' || field('type') === 'freehand_marker') {
      const pts = field('points');
      if (!Array.isArray(pts) || pts.length > MAX_POINTS * 2 || pts.length % 2 !== 0 || !pts.every((p) => typeof p === 'number' && Number.isFinite(p))) throw new RasterError('annotations');
    }
    const shape = readShape(id, value, frame);
    if (!shape || shapes.length >= MAX_SHAPES || chars > MAX_DRAWN_CHARS) throw new RasterError('annotations');
    shapes.push(shape);
  });
  if (!shapes.length) throw new RasterError('annotations');
  shapes.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { fileId, frame: { ...frame }, shapes, newer: false };
}

export interface RasterInfo { width: number; height: number; mime: 'image/jpeg' | 'image/png' | 'image/webp' }
/** Solo cabeceras y chunks: se rechaza antes de entrar a un decodificador. */
export async function rasterInfo(blob: Blob, mobile: boolean, signal: AbortSignal): Promise<RasterInfo> {
  checkRasterAbort(signal);
  if (!blob.size || blob.size > rasterLimits(mobile).bytes) throw new RasterError('size');
  const probe = new Uint8Array(await blob.slice(0, 30).arrayBuffer());
  checkRasterAbort(signal);
  if (String.fromCharCode(...probe.slice(0, 4)) === 'RIFF') {
    const info = await webpInfo(blob, probe, signal);
    checkRasterSize(info.width, info.height, mobile);
    return { ...info, mime: 'image/webp' };
  }
  const head = new Uint8Array(await blob.slice(0, 256 * 1024).arrayBuffer());
  checkRasterAbort(signal);
  const jpg = jpegInfo(head);
  if (jpg) {
    if (jpg.orientation < 1 || jpg.orientation > 8) throw new RasterError('unsupported');
    const swapped = jpg.orientation >= 5;
    const width = swapped ? jpg.height : jpg.width;
    const height = swapped ? jpg.width : jpg.height;
    checkRasterSize(width, height, mobile);
    return { width, height, mime: 'image/jpeg' };
  }
  if (head.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => head[i] === b)) throw new RasterError('unsupported');
  const header = new DataView(head.buffer);
  if (header.getUint32(8) !== 13 || String.fromCharCode(...head.slice(12, 16)) !== 'IHDR') throw new RasterError('unsupported');
  const width = header.getUint32(16), height = header.getUint32(20);
  checkRasterSize(width, height, mobile);
  // EXIF PNG y animación quedan fuera: no inferir giro ni elegir un frame implícito.
  let offset = 8;
  for (let n = 0; n < 1024 && offset + 12 <= blob.size; n++) {
    checkRasterAbort(signal);
    const h = new Uint8Array(await blob.slice(offset, offset + 8).arrayBuffer());
    const length = new DataView(h.buffer).getUint32(0);
    const type = String.fromCharCode(...h.slice(4));
    if (offset + length + 12 > blob.size || type === 'eXIf' || type === 'acTL') throw new RasterError('unsupported');
    if (type === 'IEND' && length === 0) return { width, height, mime: 'image/png' };
    offset += length + 12;
  }
  throw new RasterError('unsupported');
}

export function markupMeet(width: number, height: number, w: number, h: number) {
  const scale = Math.min(width / w, height / h);
  return { scale, x: (width - scale * w) / 2, y: (height - scale * h) / 2 };
}
const withStroke = (s: MarkupShape) => s.fillMode === 1 || s.fillMode === 2;
const withFill = (s: MarkupShape) => s.fillMode === 2 || s.fillMode === 3;
const font = (size: number, bold = false, italic = false) => `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${MARKUP_FONT}`;

function stroke(c: CanvasRenderingContext2D, s: MarkupShape, join: CanvasLineJoin = 'round', cap: CanvasLineCap = s.cap): void {
  if (s.strokeWidth <= 0 || s.strokeOpacity <= 0) return;
  c.strokeStyle = s.strokeColor; c.lineWidth = s.strokeWidth; c.lineJoin = join; c.lineCap = cap; c.miterLimit = 4; c.globalAlpha = s.strokeOpacity; c.stroke(); c.globalAlpha = 1;
}
function fill(c: CanvasRenderingContext2D, s: MarkupShape): void {
  if (s.fillOpacity <= 0) return;
  c.fillStyle = s.fillColor; c.globalAlpha = s.fillOpacity; c.fill(); c.globalAlpha = 1;
}
function boxPath(c: CanvasRenderingContext2D, r: Rect, radius = 0): void {
  c.beginPath();
  const rad = Math.min(radius, r.w / 2, r.h / 2);
  if (rad > 0) c.roundRect(r.x, r.y, r.w, r.h, rad); else c.rect(r.x, r.y, r.w, r.h);
}
function paintBox(c: CanvasRenderingContext2D, s: MarkupShape, r: Rect, radius = 0): void {
  boxPath(c, r, radius); if (withFill(s)) fill(c, s); if (withStroke(s)) stroke(c, s, 'miter');
}
function rotate(c: CanvasRenderingContext2D, s: MarkupShape, r: Rect | null): void {
  c.translate(s.posX, s.posY);
  if (!s.rotation || !r) return;
  const x = r.x + r.w / 2, y = r.y + r.h / 2;
  c.translate(x, y); c.rotate(s.rotation * Math.PI / 180); c.translate(-x, -y);
}

/** El mismo marco/meet y geometría que el overlay SVG, con trazo real (sin mínimo de miniatura). */
export function drawRasterMarkup(c: CanvasRenderingContext2D, photo: PhotoMarkup, width: number, height: number): void {
  const m = markupMeet(width, height, photo.frame.w, photo.frame.h);
  c.save(); c.beginPath(); c.rect(0, 0, width, height); c.clip(); c.translate(m.x, m.y); c.scale(m.scale, m.scale);
  for (const s of photo.shapes) {
    c.save();
    if (s.type === 'line' || s.type === 'arrow') {
      const [x1, y1] = s.start, [x2, y2] = s.end;
      rotate(c, s, { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) });
      const len = Math.hypot(x2 - x1, y2 - y1), ux = len ? (x2 - x1) / len : 0, uy = len ? (y2 - y1) / len : 0;
      const heads = s.type === 'arrow' && len > 0 && s.strokeWidth > 0;
      const end = heads && (s.headPosition === 1 || s.headPosition === 2), start = heads && (s.headPosition === 1 || s.headPosition === 0);
      const unit = Math.max(photo.frame.w, photo.frame.h) / REFERENCE_SIDE;
      const hl = headLength(s.strokeWidth, s.headSize, unit), half = headHalfWidth(hl, s.strokeWidth, unit), open = s.headStyle === 1;
      const back = (on: boolean) => on && !open ? Math.min(hl * .9, len / 2) : 0;
      c.beginPath(); c.moveTo(x1 + ux * back(start), y1 + uy * back(start)); c.lineTo(x2 - ux * back(end), y2 - uy * back(end)); stroke(c, s, 'round', heads ? 'butt' : s.cap);
      const head = (x: number, y: number, dx: number, dy: number) => {
        const bx = x - dx * hl, by = y - dy * hl;
        c.beginPath(); c.moveTo(bx - dy * half, by + dx * half); c.lineTo(x, y); c.lineTo(bx + dy * half, by - dx * half);
        if (open) stroke(c, s, 'miter', 'round'); else { c.closePath(); c.fillStyle = s.strokeColor; c.globalAlpha = s.strokeOpacity; c.fill(); c.globalAlpha = 1; }
      };
      if (end) head(x2, y2, ux, uy); if (start) head(x1, y1, -ux, -uy);
    } else if (s.type === 'freehand_pencil' || s.type === 'freehand_marker') {
      const xs = s.points.filter((_, i) => i % 2 === 0), ys = s.points.filter((_, i) => i % 2 === 1);
      rotate(c, s, { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
      c.beginPath();
      if (s.points.length === 2) { c.arc(s.points[0], s.points[1], s.strokeWidth / 2, 0, 2 * Math.PI); c.fillStyle = s.strokeColor; c.globalAlpha = s.strokeOpacity; c.fill(); }
      else { c.moveTo(s.points[0], s.points[1]); for (let i = 2; i < s.points.length; i += 2) c.lineTo(s.points[i], s.points[i + 1]); stroke(c, s, 'round', 'round'); }
    } else if (s.type === 'rectangle' || s.type === 'ellipse') {
      rotate(c, s, s.rect);
      if (s.type === 'rectangle') paintBox(c, s, s.rect, s.cornerRadius);
      else { c.beginPath(); c.ellipse(s.rect.x + s.rect.w / 2, s.rect.y + s.rect.h / 2, s.rect.w / 2, s.rect.h / 2, 0, 0, Math.PI * 2); if (withFill(s)) fill(c, s); if (withStroke(s)) stroke(c, s); }
    } else if (s.type === 'text') {
      rotate(c, s, s.rect);
      const r = s.rect && s.rect.w > 0 && s.rect.h > 0 ? s.rect : null, painted = withFill(s) && s.fillOpacity > 0;
      if (r && (painted || withStroke(s))) paintBox(c, s, r, s.cornerRadius);
      const pad = r ? s.padding : 0, inner = r ? r.w - 2 * pad : null, f = font(s.fontSize, s.bold, s.italic);
      const measure = (text: string) => { c.font = f; return c.measureText(text).width; };
      const max = r ? Math.max(1, Math.ceil((r.h - pad) / (s.fontSize * 1.25)) + 1) : Infinity;
      const lines = wrapLines(s.text, inner, f, measure, max);
      if (r) { c.beginPath(); c.rect(r.x, r.y, r.w, r.h); c.clip(); }
      c.font = f; c.textAlign = s.alignment === 1 ? 'center' : s.alignment === 2 ? 'right' : 'left'; c.textBaseline = 'alphabetic';
      c.fillStyle = s.textColor ?? (painted ? contrastInk(s.fillColor) : s.strokeColor);
      const x = r ? s.alignment === 1 ? r.x + r.w / 2 : s.alignment === 2 ? r.x + r.w - pad : r.x + pad : 0;
      const y = (r ? r.y + pad : 0) + s.fontSize;
      lines.forEach((line, i) => c.fillText(line, x, y + i * s.fontSize * 1.25));
    } else if (s.type === 'numbered_marker') {
      const r = s.rect && s.rect.w > 0 && s.rect.h > 0 ? s.rect : { x: -s.fontSize, y: -s.fontSize, w: 2 * s.fontSize, h: 2 * s.fontSize };
      rotate(c, s, r); c.beginPath(); c.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2); fill(c, s); stroke(c, s);
      c.font = font(s.fontSize, true); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = s.numberColor ?? numberInk(s.fillColor); c.fillText(String(s.number), r.x + r.w / 2, r.y + r.h / 2);
    }
    c.restore();
  }
  c.restore();
}

/** Plazo/cancelación también para APIs nativas sin AbortSignal. El resultado tardío se libera. */
export function rasterWait<T>(pending: Promise<T>, signal: AbortSignal, timeout = 30_000, release?: (v: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (f: () => void) => { if (done) return; done = true; clearTimeout(timer); signal.removeEventListener('abort', abort); f(); };
    const abort = () => finish(() => reject(signal.reason ?? new DOMException('Cancelado', 'AbortError')));
    const timer = setTimeout(() => finish(() => reject(new RasterError('source'))), timeout);
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    pending.then((v) => { if (done) release?.(v); else finish(() => resolve(v)); }, (e) => finish(() => reject(e)));
  });
}
export interface RasterResult { blob: Blob; name: string; width: number; height: number }
export async function prepareMarkupRaster(original: Blob, name: string, photo: PhotoMarkup, mobile: boolean, signal: AbortSignal, output?: 'png'): Promise<RasterResult> {
  const info = await rasterInfo(original, mobile, signal);
  await rasterWait(document.fonts?.ready ?? Promise.resolve(), signal);
  checkRasterAbort(signal);
  let bitmap: ImageBitmap | undefined;
  const canvas = document.createElement('canvas');
  try {
    bitmap = await rasterWait(createImageBitmap(original, { imageOrientation: 'from-image' }), signal, 30_000, (b) => b.close());
    checkRasterAbort(signal);
    if (bitmap.width !== info.width || bitmap.height !== info.height) throw new RasterError('unsupported');
    checkRasterSize(bitmap.width, bitmap.height, mobile);
    canvas.width = info.width; canvas.height = info.height;
    const c = canvas.getContext('2d'); if (!c) throw new RasterError('encode');
    if (info.mime === 'image/jpeg') { c.fillStyle = '#FFFFFF'; c.fillRect(0, 0, canvas.width, canvas.height); }
    c.drawImage(bitmap, 0, 0); bitmap.close(); bitmap = undefined;
    drawRasterMarkup(c, photo, canvas.width, canvas.height);
    checkRasterAbort(signal);
    // Copiar codifica este mismo Canvas en PNG, sin una pérdida JPEG intermedia.
    const mime = output === 'png' || info.mime === 'image/webp' ? 'image/png' : info.mime;
    const blob = await rasterWait(new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, .92)), signal);
    if (!blob || blob.type !== mime || !blob.size) throw new RasterError('encode');
    if ((output === 'png' || info.mime === 'image/webp') && blob.size > rasterLimits(mobile).bytes) throw new RasterError('size');
    if (info.mime === 'image/webp') await checkRasterPng(blob, info.width, info.height, signal);
    checkRasterAbort(signal);
    const base = name.replace(/\.[^.]*$/, '').replace(/[\\/\x00-\x1f]/g, '_').trim() || 'photo';
    return { blob, name: `${base}_annotated.${mime === 'image/png' ? 'png' : 'jpg'}`, width: info.width, height: info.height };
  } finally { bitmap?.close(); canvas.width = 0; canvas.height = 0; }
}
