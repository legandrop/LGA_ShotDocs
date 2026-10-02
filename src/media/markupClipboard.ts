import * as Y from 'yjs';
import { parseMarkupKey, PHOTO_MARKUP_MAP, readFrame, shapeKey } from './markup';
import { entriesBytes, PAGE_BASE_CAP, PAGE_MARKUP_CAP, pageBaseBytes, pageMarkupBytes, PHOTO_MARKUP_CAP, photoMarkupBytes } from './markupLimits';
import { MEDIA_SCHEME } from './queue';

// Copiar y pegar una foto con sus anotaciones (P.20, D46; Docs/Doc_Anotar_Fotos.md, "Copiar y pegar con las
// anotaciones"). Las anotaciones siguen siendo de la foto EN ESA PÁGINA (AN2): viven en el mapa `photoMarkup` del
// documento de la página. Copiar una foto anotada y pegarla en otra página del mismo proyecto le lleva una copia de sus
// formas al mapa de la página de destino.
//
// Cómo viaja, sin exponer nada nuevo afuera de la app: al portapapeles va EXACTAMENTE lo mismo que antes (lo que pone
// el editor). Lo de las anotaciones queda en la memoria de la app (y de sus otras pestañas abiertas): una copia de las
// formas de cada foto copiada, tomada en el momento de copiar (así cortar también anda: la foto ya no está cuando se
// pega), junto con lo que se puso en el portapapeles. Al pegar, solo si el portapapeles trae justo eso (nadie copió otra
// cosa después) y la página es del mismo workspace y del mismo proyecto, se escriben las formas en la página de destino.
//
// Lo que se escribe, para no perder ni duplicar nada:
//   - Con las MISMAS claves (`<fileId>/<shapeId>`): pegar dos veces, o pegar en la misma página (la foto duplicada
//     comparte el dibujo, AN2), no duplica nada; una clave que ya está no se toca (lo que alguien movió ahí queda).
//   - El marco solo si falta; si la página ya tiene otro marco para esa foto (otro tamaño), esa foto no se lleva nada
//     (las coordenadas no coincidirían).
//   - Dentro de los topes (`markupLimits.ts`): si no entra, esa foto llega limpia y se avisa.
//   - Solo para las fotos que quedaron de verdad en el contenido después de pegar (una que no entró no deja huérfanas).

/** El origen de la escritura de lo pegado: el deshacer de la página lo sigue (deshacer el pegado lo saca entero). */
export const MARKUP_PASTE_ORIGIN = 'sd-markup-paste';

/** Una forma copiada: su id y sus campos, como valores planos (lo que haya, también lo que esta versión no conoce). */
export type CopiedShape = [shapeId: string, fields: Record<string, unknown>];

/** Lo copiado de una foto: su marco y sus formas, en el momento de copiar. */
export interface CopiedPhoto {
  fileId: string;
  frame: { v: number; w: number; h: number };
  shapes: CopiedShape[];
}

/** Lo que guarda la app de una copia con fotos anotadas. */
export interface MarkupClip {
  /** Lo que se puso en el portapapeles (`clipKey`): al pegar tiene que ser lo mismo. */
  key: string;
  /** El workspace y el proyecto de la página copiada (`clipScope`). */
  scope: string;
  photos: CopiedPhoto[];
}

/** Lo que identifica una copia: lo que puso el editor en el portapapeles (el HTML propio, o si no el común, o el texto). */
export function clipKey(data: Pick<DataTransfer, 'getData'> | null | undefined): string {
  if (!data) return '';
  for (const type of ['blocknote/html', 'text/html', 'text/plain']) {
    let value = '';
    try {
      value = data.getData(type);
    } catch {
      value = '';
    }
    if (value) return `${type}\n${value}`;
  }
  return '';
}

/** El alcance de una copia: el workspace (una isla) y el proyecto. Sin alguno de los dos, nada viaja. */
export function clipScope(workspace: string | null | undefined, project: string | null | undefined): string {
  return workspace && project ? `${workspace}\n${project}` : '';
}

const MEDIA_IN_TEXT = new RegExp(`${MEDIA_SCHEME.replace(/[/]/g, '\\/')}([0-9a-fA-F-]{36})`, 'g');

/** Los archivos (`sdmedia://<id>`) que nombra lo copiado, sin repetir. */
export function mediaIdsInText(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(MEDIA_IN_TEXT)) {
    const id = m[1].toLowerCase();
    if (parseMarkupKey(id)?.shapeId === null) out.add(id);
  }
  return [...out];
}

/** Un valor del mapa como valor plano (los tipos anidados, que la app nunca escribe, por su JSON), copiado. */
function plain(value: unknown): unknown {
  const v = value instanceof Y.AbstractType ? value.toJSON() : value;
  return v !== null && typeof v === 'object' ? structuredClone(v) : v;
}

/**
 * Un valor que Yjs guarda tal cual (como JSON): texto, número finito, sí/no, `null`, y listas u objetos planos de eso.
 * Lo copiado sale del mapa, que ya es así; esto cuida lo que llega de otra pestaña, para que escribir nunca falle a mitad
 * de camino (un campo raro se deja afuera, como hace la lectura con lo que no entiende).
 */
function jsonSafe(v: unknown, depth = 0): boolean {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (depth > 8 || typeof v !== 'object') return false;
  if (Array.isArray(v)) return v.every((x) => jsonSafe(x, depth + 1));
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(v as Record<string, unknown>).every((x) => jsonSafe(x, depth + 1));
}

/**
 * Lo que se lleva cada foto de `fileIds` que tiene anotaciones en la página: su marco y TODAS sus formas, campo por campo
 * (también los que esta versión no conoce: una versión más nueva no los pierde al pasar por esta). Las fotos sin marco
 * válido o sin formas no se llevan nada.
 */
export function snapshotMarkup(map: Y.Map<unknown>, fileIds: Iterable<string>): CopiedPhoto[] {
  const wanted = new Set(fileIds);
  if (wanted.size === 0 || map.size === 0) return [];
  const shapes = new Map<string, CopiedShape[]>();
  map.forEach((value, key) => {
    const parsed = parseMarkupKey(key);
    if (!parsed?.shapeId || !wanted.has(parsed.fileId) || !(value instanceof Y.Map)) return;
    const fields: Record<string, unknown> = {};
    value.forEach((v, k) => {
      fields[k] = plain(v);
    });
    let list = shapes.get(parsed.fileId);
    if (!list) shapes.set(parsed.fileId, (list = []));
    list.push([parsed.shapeId, fields]);
  });
  const out: CopiedPhoto[] = [];
  for (const fileId of wanted) {
    const list = shapes.get(fileId);
    const frame = readFrame(map.get(fileId));
    if (!list?.length || !frame) continue;
    out.push({ fileId, frame: { v: frame.v, w: frame.w, h: frame.h }, shapes: list.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) });
  }
  return out;
}

/** Por qué una foto pegada no se llevó sus anotaciones. */
export type CarrySkip = 'notInContent' | 'frame' | 'limit';

export interface CarryResult {
  /** Las fotos que recibieron formas nuevas. */
  written: string[];
  /** Cuántas formas se escribieron en total. */
  shapes: number;
  /** Las que no se llevaron nada, con el motivo (las que ya tenían todo no figuran). */
  skipped: { fileId: string; reason: CarrySkip }[];
}

/**
 * Escribe en la página (`doc`) lo copiado de cada foto que quedó en su contenido (`inContent`), en UNA transacción con
 * `origin`. Solo lo que falta: el marco si no está y las formas cuya clave no está. Respeta los topes de la sección 10.
 */
export function carryMarkup(doc: Y.Doc, photos: readonly CopiedPhoto[], inContent: ReadonlySet<string>, origin: unknown = MARKUP_PASTE_ORIGIN): CarryResult {
  const map = doc.getMap<unknown>(PHOTO_MARKUP_MAP);
  const result: CarryResult = { written: [], shapes: 0, skipped: [] };
  const plan: { fileId: string; frame: CopiedPhoto['frame'] | null; shapes: CopiedShape[] }[] = [];
  let pageAdded = 0;
  for (const photo of photos) {
    if (!inContent.has(photo.fileId)) {
      result.skipped.push({ fileId: photo.fileId, reason: 'notInContent' });
      continue;
    }
    const src = readFrame(photo.frame);
    if (!src) continue;
    const here = readFrame(map.get(photo.fileId));
    if (here && (here.w !== src.w || here.h !== src.h)) {
      result.skipped.push({ fileId: photo.fileId, reason: 'frame' });
      continue;
    }
    const missing = photo.shapes.filter(([id, fields]) =>
      !!fields && typeof fields === 'object' && parseMarkupKey(shapeKey(photo.fileId, id))?.shapeId && !map.has(shapeKey(photo.fileId, id)));
    if (missing.length === 0) continue;
    const frame = here ? null : { v: src.v, w: src.w, h: src.h };
    // Lo que agrega, codificado como lo mide el tope (el marco y las formas nuevas).
    const added = entriesBytes([...(frame ? [[photo.fileId, frame] as [string, unknown]] : []), ...missing.map(([id, f]) => [shapeKey(photo.fileId, id), f] as [string, unknown])]);
    if (photoMarkupBytes(map, photo.fileId) + added > PHOTO_MARKUP_CAP || pageMarkupBytes(map) + pageAdded + added > PAGE_MARKUP_CAP) {
      result.skipped.push({ fileId: photo.fileId, reason: 'limit' });
      continue;
    }
    pageAdded += added;
    plan.push({ fileId: photo.fileId, frame, shapes: missing });
  }
  if (plan.length === 0) return result;
  // La base de la página (con los huecos de lo pisado) tampoco puede pasar su tope.
  if (pageBaseBytes(doc) + pageAdded > PAGE_BASE_CAP) {
    for (const p of plan) result.skipped.push({ fileId: p.fileId, reason: 'limit' });
    return result;
  }
  doc.transact(() => {
    for (const p of plan) {
      if (p.frame) map.set(p.fileId, { v: p.frame.v, w: p.frame.w, h: p.frame.h });
      for (const [id, fields] of p.shapes) {
        const shape = new Y.Map<unknown>();
        for (const [k, v] of Object.entries(fields)) if (jsonSafe(v)) shape.set(k, plain(v));
        map.set(shapeKey(p.fileId, id), shape);
      }
      result.written.push(p.fileId);
      result.shapes += p.shapes.length;
    }
  }, origin);
  return result;
}

