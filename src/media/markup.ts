import * as Y from 'yjs';

// Las anotaciones sobre las fotos (P.20, Docs/Doc_Anotar_Fotos.md). Viven en el documento de la página, AFUERA del
// contenido: un solo mapa raíz (`photoMarkup`) al lado del fragmento del editor y del mapa de colapsar para todos. Con
// claves planas (sección 3 del doc, corrección B1):
//
//   '<fileId>'           → { v: 1, w, h }   el marco: versión del formato y tamaño de la foto (sus píxeles); un valor
//                                           plano, así dos que lo escriben a la vez dejan uno con los mismos números
//   '<fileId>/<shapeId>' → Y.Map {...}      una forma, con los nombres de campo y de tipo del `.frproj` v2 de FrameRev
//
// Por qué así: una versión vieja de la app no conoce el mapa, no lo toca y lo deja pasar (y-prosemirror se ata solo al
// fragmento); nada de tipos de bloque ni propiedades nuevas. Una clave por forma: dos personas que anotan la misma foto
// por primera vez sin red no pierden nada (con un `Y.Map` por foto creado a demanda, gana uno y el otro se borra).
//
// El mapa es ENTRADA NO CONFIABLE (lo escribe cualquiera que edita, también un link *Can edit*): esta lectura acepta
// solo lo que conoce, con colores `#RRGGBB`, números finitos y acotados al marco, texto como texto y un tope de puntos.
// Lo que no entiende (un tipo, un campo, una clave rara) no se dibuja, y tampoco se borra: lo conserva el documento.

/** El nombre del mapa raíz (al lado de `CONTENT_FRAGMENT` y de `collapsedHeadings`). */
export const PHOTO_MARKUP_MAP = 'photoMarkup';

/** La versión del formato que esta app conoce. Con una mayor se dibuja lo que se conoce (sección 11 del doc). */
export const MARKUP_FORMAT_VERSION = 1;

/** El color de fábrica de FrameRev (`AnnotationDefaults.h`). */
export const DEFAULT_MARKUP_COLOR = '#85DC53';

/** El lado largo de referencia del grosor y de la letra (AN7): un número de la interfaz son píxeles a 1920. */
export const REFERENCE_SIDE = 1920;

/** El lado más grande aceptado para un marco (más grande, la foto no se dibuja). */
export const MAX_FRAME_SIDE = 100_000;

/** Cuántos puntos se dibujan como mucho de un trazo (un mapa malicioso no cuelga la página). */
export const MAX_POINTS = 5000;

/** Cuántas formas se dibujan como mucho de una foto. */
export const MAX_SHAPES = 2000;

/** El tope del texto de una forma `text`. */
export const MAX_TEXT = 2000;

/** Los tipos que se dibujan (los de FrameRev que lleva la web, AN5; Select no es una forma). */
export const SHAPE_TYPES = [
  'rectangle',
  'ellipse',
  'arrow',
  'line',
  'text',
  'freehand_pencil',
  'freehand_marker',
  'numbered_marker',
] as const;
export type ShapeType = (typeof SHAPE_TYPES)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHAPE_ID = /^[^/\s]{1,64}$/;
const HEX = /^#[0-9a-f]{6}$/i;

/** El marco de una foto anotada: su tamaño en píxeles (el sistema de coordenadas de las formas). */
export interface MarkupFrame {
  v: number;
  w: number;
  h: number;
}

interface ShapeBase {
  id: string;
  type: ShapeType;
  /** El orden de apilado (empate: por `id`, igual en todos los dispositivos). */
  z: number;
  posX: number;
  posY: number;
  rotation: number;
  strokeColor: string;
  strokeWidth: number;
  /** 0 a 1. */
  strokeOpacity: number;
  fillColor: string;
  /** 0 a 1. */
  fillOpacity: number;
  /** 0 None, 1 Stroke, 2 StrokeAndFill, 3 Fill (los ordinales de FrameRev). */
  fillMode: number;
  /** El remate del trazo. */
  cap: 'butt' | 'square' | 'round';
}

export interface RectShape extends ShapeBase {
  type: 'rectangle' | 'ellipse';
  rect: Rect;
  cornerRadius: number;
}

export interface LineShape extends ShapeBase {
  type: 'line' | 'arrow';
  start: [number, number];
  end: [number, number];
  /** 0 Normal, 1 Open, 2 Banner (se dibuja como Normal). */
  headStyle: number;
  /** 0 Start, 1 Both, 2 End. */
  headPosition: number;
  /** 25 a 300 (%). */
  headSize: number;
}

export interface FreehandShape extends ShapeBase {
  type: 'freehand_pencil' | 'freehand_marker';
  /** Lista plana `[x0, y0, x1, y1…]`, relativa a `posX/posY`. */
  points: number[];
}

export interface TextShape extends ShapeBase {
  type: 'text';
  rect: Rect | null;
  text: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  /** 0 izquierda, 1 centro, 2 derecha. */
  alignment: number;
  /** La tinta elegida, o `null`: automática (FrameRev, `TextContrast.h`). */
  textColor: string | null;
  cornerRadius: number;
  padding: number;
}

export interface NumberShape extends ShapeBase {
  type: 'numbered_marker';
  rect: Rect | null;
  number: number;
  fontSize: number;
  numberColor: string | null;
}

export type MarkupShape = RectShape | LineShape | FreehandShape | TextShape | NumberShape;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Lo que se dibuja de una foto: su marco y sus formas ya limpias, de abajo hacia arriba. */
export interface PhotoMarkup {
  fileId: string;
  frame: MarkupFrame;
  shapes: MarkupShape[];
  /** El marco dice una versión del formato más nueva que esta app (se dibuja lo que se conoce). */
  newer: boolean;
}

// --- claves ----------------------------------------------------------------------------------------------

/** La clave de una forma. */
export const shapeKey = (fileId: string, shapeId: string): string => `${fileId}/${shapeId}`;

/** Qué es una clave del mapa: el marco de una foto, una forma, o `null` (una clave que esta app no conoce). */
export function parseMarkupKey(key: string): { fileId: string; shapeId: string | null } | null {
  const slash = key.indexOf('/');
  const fileId = slash < 0 ? key : key.slice(0, slash);
  if (!UUID.test(fileId)) return null;
  if (slash < 0) return { fileId, shapeId: null };
  const shapeId = key.slice(slash + 1);
  return SHAPE_ID.test(shapeId) ? { fileId, shapeId } : null;
}

/**
 * El origen de las escrituras de una foto (`sd-markup:<fileId>`): el deshacer del anotador lo sigue (entrega 2) y el
 * deshacer de la página no (solo sigue al editor).
 */
export const markupOrigin = (fileId: string): string => `sd-markup:${fileId}`;

// --- lectura ---------------------------------------------------------------------------------------------

type Source = Y.Map<unknown> | Record<string, unknown>;

/** Un campo de una forma (de un `Y.Map` o de un objeto plano), solo si es propio. */
function field(src: Source, name: string): unknown {
  if (src instanceof Y.Map) return src.get(name);
  return Object.prototype.hasOwnProperty.call(src, name) ? src[name] : undefined;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Un número acotado, o `fallback` si no es un número finito. */
function num(src: Source, name: string, lo: number, hi: number, fallback: number): number {
  const v = field(src, name);
  return finite(v) ? clamp(v, lo, hi) : fallback;
}

/** Un entero de una lista cerrada (los ordinales de FrameRev), o `fallback`. */
function choice(src: Source, name: string, allowed: readonly number[], fallback: number): number {
  const v = field(src, name);
  return finite(v) && allowed.includes(v) ? v : fallback;
}

/** Un color `#RRGGBB` (nunca otra cosa: va a un atributo del SVG), o `fallback`. */
export function safeColor(v: unknown, fallback: string): string {
  return typeof v === 'string' && HEX.test(v) ? v.toUpperCase() : fallback;
}

/** El marco de una foto, o `null` si falta o no es válido (sin marco, la foto no se dibuja). */
export function readFrame(value: unknown): MarkupFrame | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Y.AbstractType) return null;
  const o = value as Record<string, unknown>;
  const w = Object.prototype.hasOwnProperty.call(o, 'w') ? o.w : undefined;
  const h = Object.prototype.hasOwnProperty.call(o, 'h') ? o.h : undefined;
  const v = Object.prototype.hasOwnProperty.call(o, 'v') ? o.v : undefined;
  if (!finite(w) || !finite(h) || w < 1 || h < 1 || w > MAX_FRAME_SIDE || h > MAX_FRAME_SIDE) return null;
  return { v: finite(v) && v >= 1 ? Math.floor(v) : 1, w, h };
}

/** Un rectángulo local (`rectX…rectH`), o `null` si falta alguno. */
function readRect(src: Source, lim: number): Rect | null {
  const x = field(src, 'rectX');
  const y = field(src, 'rectY');
  const w = field(src, 'rectW');
  const h = field(src, 'rectH');
  if (!finite(x) || !finite(y) || !finite(w) || !finite(h)) return null;
  // Normalizado (FrameRev usa `localRect().normalized()`): ancho y alto nunca negativos.
  const nx = w < 0 ? x + w : x;
  const ny = h < 0 ? y + h : y;
  return { x: clamp(nx, -lim, lim), y: clamp(ny, -lim, lim), w: clamp(Math.abs(w), 0, 2 * lim), h: clamp(Math.abs(h), 0, 2 * lim) };
}

/** Los puntos de un trazo: lista plana de números finitos, acotada, cortada en `MAX_POINTS` puntos. */
function readPoints(src: Source, lim: number): number[] {
  const raw = field(src, 'points');
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (let i = 0; i + 1 < raw.length && out.length < MAX_POINTS * 2; i += 2) {
    const x = raw[i];
    const y = raw[i + 1];
    if (!finite(x) || !finite(y)) continue;
    out.push(clamp(x, -lim, lim), clamp(y, -lim, lim));
  }
  return out;
}

/** El texto de una forma: solo una cadena, cortada en `MAX_TEXT` caracteres (sin partir un emoji en dos). */
function readText(src: Source): string {
  const v = field(src, 'text');
  if (typeof v !== 'string') return '';
  if (v.length <= MAX_TEXT) return v;
  return Array.from(v).slice(0, MAX_TEXT).join('');
}

const CAPS: Record<number, ShapeBase['cap']> = { 0: 'butt', 16: 'square', 32: 'round' };

/**
 * Una forma limpia desde lo guardado, o `null` si no se dibuja (un tipo desconocido, o sin lo mínimo). Todos los
 * números quedan finitos y acotados al marco; los colores, `#RRGGBB`; lo demás que traiga la forma se ignora.
 */
export function readShape(id: string, raw: unknown, frame: MarkupFrame): MarkupShape | null {
  if (!(raw instanceof Y.Map) && (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw instanceof Y.AbstractType)) return null;
  const src = raw as Source;
  const type = field(src, 'type');
  if (typeof type !== 'string' || !(SHAPE_TYPES as readonly string[]).includes(type)) return null;
  const side = Math.max(frame.w, frame.h);
  // Las coordenadas pueden salir un poco de la foto (una flecha que apunta al borde), nunca a cualquier lado.
  const lim = 4 * side;
  const unit = side / REFERENCE_SIDE;
  const marker = type === 'freehand_marker';
  const strokeColor = safeColor(field(src, 'strokeColor'), DEFAULT_MARKUP_COLOR);
  const base: ShapeBase = {
    id,
    type: type as ShapeType,
    z: num(src, 'zValue', -1e9, 1e9, 0),
    posX: num(src, 'posX', -lim, lim, 0),
    posY: num(src, 'posY', -lim, lim, 0),
    rotation: num(src, 'rotation', -1e6, 1e6, 0) % 360,
    strokeColor,
    strokeWidth: num(src, 'strokeWidth', 0, 999 * unit, (marker ? 18 : 3) * unit),
    strokeOpacity: num(src, 'strokeOpacity', 0, 100, marker ? 50 : 100) / 100,
    fillColor: safeColor(field(src, 'fillColor'), strokeColor),
    fillOpacity: num(src, 'fillOpacity', 0, 100, type === 'text' || type === 'numbered_marker' ? 100 : 0) / 100,
    fillMode: choice(src, 'fillMode', [0, 1, 2, 3], type === 'text' ? 0 : 1),
    cap: CAPS[choice(src, 'strokeCap', [0, 16, 32], 32)],
  };
  const fontSize = (fallback: number) => num(src, 'fontSize', 4 * unit, 400 * unit, fallback * unit);
  switch (type) {
    case 'rectangle':
    case 'ellipse': {
      const rect = readRect(src, lim);
      if (!rect) return null;
      return { ...base, type, rect, cornerRadius: num(src, 'cornerRadius', 0, 100 * unit, 0) };
    }
    case 'line':
    case 'arrow': {
      const pt = (a: string, b: string): [number, number] => [num(src, a, -lim, lim, NaN), num(src, b, -lim, lim, NaN)];
      const start = pt('startX', 'startY');
      const end = pt('endX', 'endY');
      if (![...start, ...end].every(Number.isFinite)) return null;
      return {
        ...base,
        type,
        start,
        end,
        headStyle: choice(src, 'headStyle', [0, 1, 2], 0),
        headPosition: choice(src, 'headPosition', [0, 1, 2], 2),
        headSize: num(src, 'arrowHeadSize', 25, 300, 100),
      };
    }
    case 'freehand_pencil':
    case 'freehand_marker': {
      const points = readPoints(src, lim);
      if (points.length < 2) return null;
      return { ...base, type, points };
    }
    case 'text': {
      const text = readText(src);
      if (!text) return null;
      const color = field(src, 'textColor');
      return {
        ...base,
        type,
        rect: readRect(src, lim),
        text,
        fontSize: fontSize(24),
        bold: field(src, 'bold') === true,
        italic: field(src, 'italic') === true,
        alignment: choice(src, 'alignment', [0, 1, 2], 0),
        textColor: typeof color === 'string' && HEX.test(color) ? color.toUpperCase() : null,
        cornerRadius: num(src, 'cornerRadius', 0, 100 * unit, 0),
        padding: num(src, 'padding', 0, 100 * unit, 0),
      };
    }
    default: {
      const color = field(src, 'numberColor');
      const n = field(src, 'number');
      return {
        ...base,
        type: 'numbered_marker',
        rect: readRect(src, lim),
        number: finite(n) ? Math.trunc(clamp(n, -99999, 99999)) : 1,
        fontSize: fontSize(16),
        numberColor: typeof color === 'string' && HEX.test(color) ? color.toUpperCase() : null,
      };
    }
  }
}

/** Lo crudo de cada foto del mapa (las claves agrupadas por archivo), sin limpiar. */
interface RawPhoto {
  frame: unknown;
  shapes: [string, unknown][];
}

function groupKeys(map: Y.Map<unknown>): Map<string, RawPhoto> {
  const out = new Map<string, RawPhoto>();
  map.forEach((value, key) => {
    const parsed = parseMarkupKey(key);
    if (!parsed) return;
    let photo = out.get(parsed.fileId);
    if (!photo) out.set(parsed.fileId, (photo = { frame: undefined, shapes: [] }));
    if (parsed.shapeId === null) photo.frame = value;
    else photo.shapes.push([parsed.shapeId, value]);
  });
  return out;
}

function cleanPhoto(fileId: string, raw: RawPhoto): PhotoMarkup | null {
  const frame = readFrame(raw.frame);
  if (!frame) return null;
  const shapes: MarkupShape[] = [];
  for (const [id, value] of raw.shapes) {
    const shape = readShape(id, value, frame);
    if (shape) shapes.push(shape);
  }
  if (shapes.length === 0) return null;
  shapes.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { fileId, frame, shapes: shapes.slice(-MAX_SHAPES), newer: frame.v > MARKUP_FORMAT_VERSION };
}

/**
 * Las fotos que se dibujan, por archivo: las que tienen marco y al menos una forma que esta app sabe dibujar. Recorre
 * el mapa una vez (con muchas fotos anotadas, mejor que leer cada una por separado).
 */
export function readAllMarkup(map: Y.Map<unknown>): Map<string, PhotoMarkup> {
  const out = new Map<string, PhotoMarkup>();
  for (const [fileId, raw] of groupKeys(map)) {
    const photo = cleanPhoto(fileId, raw);
    if (photo) out.set(fileId, photo);
  }
  return out;
}

/** Lo que se dibuja de una foto, o `null` (sin anotaciones que esta app sepa dibujar). */
export function readPhotoMarkup(map: Y.Map<unknown>, fileId: string): PhotoMarkup | null {
  const raw: RawPhoto = { frame: map.get(fileId), shapes: [] };
  const prefix = `${fileId}/`;
  map.forEach((value, key) => {
    if (!key.startsWith(prefix)) return;
    const parsed = parseMarkupKey(key);
    if (parsed?.shapeId) raw.shapes.push([parsed.shapeId, value]);
  });
  return parseMarkupKey(fileId)?.shapeId === null ? cleanPhoto(fileId, raw) : null;
}

/**
 * Qué fotos tocó un cambio del mapa (lo que avisa `observeDeep`): las claves de arriba que cambiaron y las formas
 * adentro de las que cambió un campo.
 */
export function touchedFileIds(events: readonly Y.YEvent<Y.AbstractType<unknown>>[], map: Y.Map<unknown>): Set<string> {
  const out = new Set<string>();
  const add = (key: unknown) => {
    if (typeof key !== 'string') return;
    const parsed = parseMarkupKey(key);
    if (parsed) out.add(parsed.fileId);
  };
  for (const event of events) {
    if (event.target === map) {
      for (const key of (event as Y.YMapEvent<unknown>).keysChanged) add(key);
    } else {
      add(event.path[0]);
    }
  }
  return out;
}

/** Los archivos con algo en el mapa (marco o formas), dibujable o no. */
export function markupFileIds(map: Y.Map<unknown>): Set<string> {
  return new Set(groupKeys(map).keys());
}

/**
 * Los archivos con anotaciones que ya no están en el contenido de la página (`inContent`: `mediaIdsInDoc`). La poda de
 * huérfanos (AN11, entrega 2) los saca a los 10 minutos; acá solo la cuenta.
 */
export function orphanMarkup(map: Y.Map<unknown>, inContent: ReadonlySet<string>): string[] {
  return [...markupFileIds(map)].filter((id) => !inContent.has(id)).sort();
}

// --- escritura -------------------------------------------------------------------------------------------
//
// El único camino para escribir (lo usan el anotador de la entrega 2, las pruebas y el arnés). Cada función es una
// transacción con el origen de la foto. Una propiedad por clave: cambiar un campo escribe solo ese campo.

/** Lo que se guarda de una forma (los nombres del `.frproj` v2). */
export type ShapeFields = Record<string, string | number | boolean | number[]>;

/** El marco de la foto (si ya está con los mismos números, no escribe nada). */
export function writeFrame(doc: Y.Doc, fileId: string, w: number, h: number): void {
  const map = doc.getMap<unknown>(PHOTO_MARKUP_MAP);
  const now = readFrame(map.get(fileId));
  if (now && now.w === w && now.h === h && now.v === MARKUP_FORMAT_VERSION) return;
  doc.transact(() => map.set(fileId, { v: MARKUP_FORMAT_VERSION, w, h }), markupOrigin(fileId));
}

/** Una forma nueva (con el marco, si falta), en una sola transacción. */
export function addShape(doc: Y.Doc, fileId: string, shapeId: string, fields: ShapeFields, frame?: { w: number; h: number }): void {
  if (!parseMarkupKey(shapeKey(fileId, shapeId))?.shapeId) throw new Error(`markup: clave inválida ${fileId}/${shapeId}`);
  const map = doc.getMap<unknown>(PHOTO_MARKUP_MAP);
  doc.transact(() => {
    if (frame && !readFrame(map.get(fileId))) map.set(fileId, { v: MARKUP_FORMAT_VERSION, w: frame.w, h: frame.h });
    const shape = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(fields)) shape.set(k, v);
    map.set(shapeKey(fileId, shapeId), shape);
  }, markupOrigin(fileId));
}

/** Cambia campos de una forma que ya está (cada uno en su clave: lo demás no se toca). */
export function updateShape(doc: Y.Doc, fileId: string, shapeId: string, fields: ShapeFields): boolean {
  const shape = doc.getMap<unknown>(PHOTO_MARKUP_MAP).get(shapeKey(fileId, shapeId));
  if (!(shape instanceof Y.Map)) return false;
  doc.transact(() => {
    for (const [k, v] of Object.entries(fields)) shape.set(k, v);
  }, markupOrigin(fileId));
  return true;
}

/** Borra una forma (queda en las filas y en el historial). */
export function deleteShape(doc: Y.Doc, fileId: string, shapeId: string): void {
  const map = doc.getMap<unknown>(PHOTO_MARKUP_MAP);
  const key = shapeKey(fileId, shapeId);
  if (map.has(key)) doc.transact(() => map.delete(key), markupOrigin(fileId));
}

/** Borra todo lo de una foto: el marco y sus formas (lo que hace la poda de una foto sacada, AN11). */
export function removePhotoMarkup(doc: Y.Doc, fileId: string): number {
  const map = doc.getMap<unknown>(PHOTO_MARKUP_MAP);
  const keys = [...map.keys()].filter((key) => parseMarkupKey(key)?.fileId === fileId);
  if (keys.length > 0) doc.transact(() => keys.forEach((key) => map.delete(key)), markupOrigin(fileId));
  return keys.length;
}
