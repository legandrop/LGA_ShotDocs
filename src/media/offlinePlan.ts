import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import type { PageRow } from '../sync/types';
import type { FileKind } from './attachments';
import { THUMB_SIDE, VIEW_GAIN, VIEW_SIDE } from './probe';
import { ATTACHMENT_MAX_BYTES, type OfflineOptions } from './offlineStore';

// Lo que se calcula para "Available offline" sin tocar nada (Docs/Doc_Copias_Locales.md, secciones 3.1 a 3.3):
// qué páginas tiene la rama, qué baja cada casilla y cuánto pesa, también lo destildado.

/** El esquema de las imágenes viejas, guardadas en Supabase (src/sync/files.ts). */
const OLDER_SCHEME = 'sdfile://';
/** Lo que se estima por cada miniatura que falta. */
export const THUMB_ESTIMATE = 40 * 1024;
/** Lo que se estima por cada imagen vieja (`sdfile://`) que falta: no se sabe su peso antes de bajarla. */
export const OLDER_ESTIMATE = 1024 * 1024;
/** Una foto de hasta este lado se ve perfecta con la miniatura: no necesita la de 2048. */
export const SHARP_MIN_SIDE = THUMB_SIDE * VIEW_GAIN;
/** Fotos que el navegador abre para hacerles la nítida (como `VIEW_FETCH_TYPES` de la cola). */
const DECODABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/bmp']);

/** Las páginas de una rama, en orden: la marcada (o las raíces del proyecto) y todo lo de abajo, sin papelera. */
export function branchPages(
  tree: { get(id: string): PageRow | undefined; children(id: string | null): PageRow[]; roots(projectId: string): PageRow[]; isTrashed(id: string): boolean },
  kind: 'page' | 'project',
  target: string,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (row: PageRow) => {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    out.push(row.id);
    for (const child of tree.children(row.id)) walk(child);
  };
  if (kind === 'project') {
    for (const root of tree.roots(target)) walk(root);
  } else {
    const row = tree.get(target);
    if (row && !tree.isTrashed(target)) walk(row);
  }
  return out;
}

/** Las direcciones de imágenes viejas (`sdfile://<ruta>`) de una página, leídas del documento. */
export function olderUrlsInDoc(doc: Y.Doc): string[] {
  const out = new Set<string>();
  const stack: unknown[] = doc.getXmlFragment(CONTENT_FRAGMENT).toArray();
  while (stack.length > 0) {
    const item = stack.pop();
    if (!(item instanceof Y.XmlElement)) continue;
    const url = item.getAttribute('url') as unknown;
    if (typeof url === 'string' && url.startsWith(OLDER_SCHEME)) out.add(url);
    stack.push(...item.toArray());
  }
  return [...out];
}

/** Lo que se sabe de un archivo de la rama, para pesarlo y para saber qué falta bajar. */
export interface FileFacts {
  id: string;
  kind: FileKind;
  mime: string;
  /** `files.size`; `null` si todavía no se sabe. */
  size: number | null;
  width: number | null;
  height: number | null;
  /** Ya está en Drive (se puede bajar). */
  inDrive: boolean;
  /** En la papelera de Drive: se ve como borrado y no se baja. */
  deleted: boolean;
  /** El original agregado en este dispositivo sigue acá (`blobs[<id>]`). */
  ownBlob: boolean;
  /** La copia bajada está completa. */
  copy: boolean;
  /** La nítida de la marca (`offview:`) o una de 2048 de la página (`view:`), que se mueve. */
  offview: boolean;
  view2048: boolean;
  /** La miniatura está en el dispositivo, y si la base dice que hay una para bajar. */
  thumb: boolean;
  thumbAt: boolean;
}

/** El lado mayor de la foto; 0 si no se sabe. */
function longSide(f: Pick<FileFacts, 'width' | 'height'>): number {
  return Math.max(f.width ?? 0, f.height ?? 0);
}

/** La foto necesita la de 2048 (es más grande que lo que la miniatura muestra bien). */
export function needsSharp(f: Pick<FileFacts, 'kind' | 'width' | 'height'>): boolean {
  if (f.kind !== 'image') return false;
  const side = longSide(f);
  return side === 0 || side > SHARP_MIN_SIDE;
}

/** El navegador puede abrir la foto para hacerle la nítida. */
export function canMakeSharp(f: Pick<FileFacts, 'mime'>): boolean {
  return DECODABLE.has(f.mime);
}

/**
 * Lo que va a ocupar la nítida de 2048 (Doc_Copias_Locales.md, sección 3.3): de las mediciones de Doc_Imagenes.md,
 * 0,9 bits por píxel en WebP y 1,5 en el JPEG de Safari, nunca más que el original. Un JPEG de hasta 900 KB que ya
 * entra en 2048 se guarda tal cual. Sin medidas, 400 KB (600 KB en Safari).
 */
export function estimateSharp(f: Pick<FileFacts, 'mime' | 'size' | 'width' | 'height'>, safari: boolean): number {
  const size = f.size ?? Infinity;
  const side = longSide(f);
  if (f.mime === 'image/jpeg' && side > 0 && side <= VIEW_SIDE && size <= 900 * 1024) return size;
  let estimate: number;
  if (side > 0 && f.width && f.height) {
    const scale = Math.min(1, VIEW_SIDE / side);
    const pixels = Math.round(f.width * scale) * Math.round(f.height * scale);
    estimate = Math.round((pixels * (safari ? 1.5 : 0.9)) / 8);
  } else {
    estimate = (safari ? 600 : 400) * 1024;
  }
  return Math.min(estimate, size);
}

export type RowKey = 'sharp' | 'originals' | 'attachments' | 'videos';
export const ROWS: RowKey[] = ['sharp', 'originals', 'attachments', 'videos'];

export interface RowWeight {
  /** Cuántos archivos de la rama son de esta fila. */
  count: number;
  /** Lo que falta bajar: lo que va a ocupar lugar (estimado en `sharp`). */
  missing: number;
  /** Lo que ya está en el dispositivo. */
  present: number;
  /** Lo que se baja por la red para lo que falta (para la nítida, el original entero). */
  network: number;
  /** Archivos sin peso conocido todavía. */
  unknown: number;
  /** Adjuntos de más de 50 MB, que la fila no incluye. */
  over: { count: number; bytes: number };
  /** Originales propios en el dispositivo que la casilla protege solo si se tilda. */
  own: { count: number; bytes: number };
  /** Fotos que el navegador no puede achicar (solo con *Original photos*). */
  cantLarge: number;
  /** Todavía subiendo desde otro dispositivo: se bajan cuando lleguen. */
  waiting: number;
}

export interface Weights {
  rows: Record<RowKey, RowWeight>;
  /** Miniaturas e imágenes viejas que faltan (siempre, sin casilla). */
  extras: { thumbs: number; older: number; bytes: number };
}

function emptyRow(): RowWeight {
  return { count: 0, missing: 0, present: 0, network: 0, unknown: 0, over: { count: 0, bytes: 0 }, own: { count: 0, bytes: 0 }, cantLarge: 0, waiting: 0 };
}

/** De qué fila es un archivo (una foto está en dos: la de 2048 y la del original). */
export function rowsOf(f: Pick<FileFacts, 'kind' | 'width' | 'height'>): RowKey[] {
  if (f.kind === 'image') return needsSharp(f) ? ['sharp', 'originals'] : ['originals'];
  if (f.kind === 'video') return ['videos'];
  return ['attachments'];
}

/**
 * Los pesos de todas las filas (también las destildadas) y de lo que va siempre. `olderMissing`: cuántas
 * imágenes viejas faltan en el dispositivo.
 */
export function weigh(facts: readonly FileFacts[], olderMissing: number, safari: boolean): Weights {
  const rows: Record<RowKey, RowWeight> = { sharp: emptyRow(), originals: emptyRow(), attachments: emptyRow(), videos: emptyRow() };
  let thumbs = 0;
  for (const f of facts) {
    if (f.deleted) continue;
    if (f.thumbAt && !f.thumb) thumbs++;
    const known = f.size !== null;
    const size = f.size ?? 0;
    const original = f.ownBlob || f.copy;
    for (const key of rowsOf(f)) {
      const row = rows[key];
      if (key === 'attachments' && known && size > ATTACHMENT_MAX_BYTES) {
        row.over.count++;
        row.over.bytes += size;
        continue;
      }
      row.count++;
      if (!known) row.unknown++;
      if (!f.inDrive && !f.ownBlob) row.waiting++;
      if (f.ownBlob && key !== 'sharp') {
        row.own.count++;
        row.own.bytes += size;
      }
      if (key === 'sharp') {
        if (!canMakeSharp(f)) {
          row.cantLarge++;
          continue;
        }
        const estimate = estimateSharp(f, safari);
        if (f.offview || f.view2048) row.present += estimate;
        else {
          // Con el original en el dispositivo se hace acá, sin bajar nada; igual ocupa su lugar.
          row.missing += estimate;
          if (!original) row.network += size;
        }
        continue;
      }
      if (original) row.present += size;
      else {
        row.missing += size;
        row.network += size;
      }
    }
  }
  const bytes = thumbs * THUMB_ESTIMATE + olderMissing * OLDER_ESTIMATE;
  return { rows, extras: { thumbs, older: olderMissing, bytes } };
}

/** El total de lo elegido: lo que ocupa y lo que se baja por la red. */
export function selectedTotal(weights: Weights, options: OfflineOptions): { missing: number; network: number } {
  let missing = weights.extras.bytes;
  let network = weights.extras.bytes;
  const on: Record<RowKey, boolean> = { sharp: options.sharp, originals: options.originals, attachments: options.attachments, videos: options.videos };
  // Con *Original photos* tildada no hace falta la nítida: sale del original cuando se ve.
  if (on.originals) on.sharp = false;
  for (const key of ROWS) {
    if (!on[key]) continue;
    missing += weights.rows[key].missing;
    network += weights.rows[key].network;
  }
  return { missing, network };
}

/** Lo que pide una marca de un archivo, según sus casillas: el original entero, la nítida o nada. */
export function wanted(f: Pick<FileFacts, 'kind' | 'size' | 'mime' | 'width' | 'height'>, options: OfflineOptions): { orig: boolean; view: boolean } {
  if (f.kind === 'image') {
    if (options.originals) return { orig: true, view: false };
    return { orig: false, view: options.sharp && needsSharp(f) && canMakeSharp(f) };
  }
  if (f.kind === 'video') return { orig: options.videos, view: false };
  return { orig: options.attachments && f.size !== null && f.size <= ATTACHMENT_MAX_BYTES, view: false };
}
