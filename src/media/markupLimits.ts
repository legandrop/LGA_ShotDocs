import * as Y from 'yjs';
import { buildCleanBase } from '../sync/clean';
import { parseMarkupKey, PHOTO_MARKUP_MAP } from './markup';

// Los topes de las anotaciones (P.20, Docs/Doc_Anotar_Fotos.md, sección 10), en BYTES CODIFICADOS y no en cantidad
// de formas: lo que pesa es lo que sube y lo que baja quien recibe la base limpia (D14). Tres medidas:
//   - por foto: el contenido vivo de sus claves, codificado (96 KB);
//   - por página: el de todas las anotaciones vivas (512 KB);
//   - la base de la página: `encodeStateAsUpdate` de una copia con GC, como la base limpia (2,5 MB). Cubre también los
//     huecos que deja lo pisado, que las dos primeras no ven.
// Se miden al abrir el anotador y después de cada escritura. Al 80 % se avisa; al tope, las herramientas de crear se
// apagan (editar, mover y borrar siguen: borrar es lo que baja el peso).

export const PHOTO_MARKUP_CAP = 96 * 1024;
export const PAGE_MARKUP_CAP = 512 * 1024;
export const PAGE_BASE_CAP = 2.5 * 1024 * 1024;
/** Desde qué parte del tope se avisa. */
export const WARN_AT = 0.8;

/** Un valor del mapa copiado a otro documento (una forma es un `Y.Map` con valores planos). */
function copyInto(target: Y.Map<unknown>, key: string, value: unknown): void {
  if (value instanceof Y.Map) {
    const shape = new Y.Map<unknown>();
    target.set(key, shape);
    value.forEach((v, k) => {
      // Lo que no sea un valor plano (un tipo anidado, que la app nunca escribe) se cuenta por su JSON.
      shape.set(k, v instanceof Y.AbstractType ? v.toJSON() : v);
    });
  } else if (value instanceof Y.AbstractType) {
    target.set(key, value.toJSON());
  } else {
    target.set(key, value);
  }
}

/** Lo que pesan, codificadas, las claves vivas del mapa que cumplen `keep`. */
function liveBytes(map: Y.Map<unknown>, keep: (key: string) => boolean): number {
  const doc = new Y.Doc();
  const target = doc.getMap<unknown>(PHOTO_MARKUP_MAP);
  let any = false;
  doc.transact(() => {
    map.forEach((value, key) => {
      if (!keep(key)) return;
      any = true;
      copyInto(target, key, value);
    });
  });
  const bytes = any ? Y.encodeStateAsUpdate(doc).byteLength : 0;
  doc.destroy();
  return bytes;
}

/** Lo que pesan las anotaciones vivas de una foto (su marco y sus formas). */
export function photoMarkupBytes(map: Y.Map<unknown>, fileId: string): number {
  return liveBytes(map, (key) => parseMarkupKey(key)?.fileId === fileId);
}

/** Lo que pesan todas las anotaciones vivas de la página. */
export function pageMarkupBytes(map: Y.Map<unknown>): number {
  return liveBytes(map, () => true);
}

/** Lo que pesa la base de la página (con GC, como la base limpia: lo borrado queda como hueco). */
export function pageBaseBytes(doc: Y.Doc): number {
  const built = buildCleanBase([Y.encodeStateAsUpdate(doc)]);
  built.doc.destroy();
  return built.base.byteLength;
}

export interface MarkupLimits {
  photo: number;
  page: number;
  base: number;
}

export type LimitState = 'ok' | 'warn' | 'full';

/** Cómo está cada tope y cuál manda: el primero lleno, o el primero que avisa. */
export function limitState(m: MarkupLimits): { state: LimitState; which: 'photo' | 'page' | 'base' | null } {
  const parts: ['photo' | 'page' | 'base', number][] = [
    ['photo', m.photo / PHOTO_MARKUP_CAP],
    ['page', m.page / PAGE_MARKUP_CAP],
    ['base', m.base / PAGE_BASE_CAP],
  ];
  const full = parts.find(([, r]) => r >= 1);
  if (full) return { state: 'full', which: full[0] };
  const warn = parts.find(([, r]) => r >= WARN_AT);
  if (warn) return { state: 'warn', which: warn[0] };
  return { state: 'ok', which: null };
}

/** Las tres medidas de una foto de la página. */
export function measureLimits(doc: Y.Doc, fileId: string): MarkupLimits {
  const map = doc.getMap<unknown>(PHOTO_MARKUP_MAP);
  return { photo: photoMarkupBytes(map, fileId), page: pageMarkupBytes(map), base: pageBaseBytes(doc) };
}
