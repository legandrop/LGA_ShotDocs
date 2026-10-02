import type * as Y from 'yjs';
import { orphanMarkup, PHOTO_MARKUP_MAP, removePhotoMarkup } from './markup';
import { mediaIdsInDoc } from './usage';

// La poda de las anotaciones de una foto sacada de la página (P.20, AN11; Docs/Doc_Anotar_Fotos.md, sección 3). Un
// dispositivo que EDITA la página borra, como una edición normal (sube a `page_updates`, entra en el historial), las
// claves de un archivo que ya no está en el contenido desde hace más de 10 minutos: así no le llegan a quien solo ve
// (la base limpia, D14), y un cortar y pegar no las dispara.
//
// Las tres condiciones del diseño:
//   1. Los 10 minutos los mide este dispositivo con la página abierta, con su reloj (nunca una hora del documento).
//   2. Nunca con la página a medio bajar: quien la usa la arranca solo con el editor editable, que ya exige la página
//      completa (PageEditor.tsx, `opening.complete`); un documento vacío vería todas las fotos como sacadas.
//   3. Solo mientras alguien que edita tiene la página abierta: si nadie la abre, las notas siguen en la última base.
// No se arma junto con la base limpia: la base se arma desde las filas guardadas, con el candado de la página, y se
// salta si hay algo sin subir (sync/docs.ts, `buildCleanBase`); la poda es una edición más que sube después.
// Con las claves planas es segura: lo que otro anotó sin red sobre esa foto son claves nuevas que no se pierden; quedan
// huérfanas y las saca la próxima vuelta. Lo podado sigue en `page_updates` (el historial lo devuelve, entrega 5).

/** Cuánto tiene que estar fuera de la página una foto antes de podar sus anotaciones. */
export const PRUNE_AFTER_MS = 10 * 60_000;
/** Cada cuánto se mira (con la página abierta para editar). */
export const PRUNE_EVERY_MS = 60_000;
/** El origen de la transacción de la poda. */
export const PRUNE_ORIGIN = 'sd-markup-prune';

export interface MarkupPruner {
  /** Mira las fotos anotadas que no están en la página; poda las que llevan más de 10 minutos afuera. */
  check(): string[];
  /** Desde cuándo falta cada foto anotada (lo usan las pruebas). */
  missing(): ReadonlyMap<string, number>;
}

export function createMarkupPruner(doc: Y.Doc, now: () => number = () => Date.now()): MarkupPruner {
  const since = new Map<string, number>();
  return {
    check() {
      const map = doc.getMap<unknown>(PHOTO_MARKUP_MAP);
      if (map.size === 0) {
        since.clear();
        return [];
      }
      const orphans = new Set(orphanMarkup(map, mediaIdsInDoc(doc)));
      // Una que volvió (deshacer, pegar) deja de contar.
      for (const id of [...since.keys()]) if (!orphans.has(id)) since.delete(id);
      const t = now();
      const pruned: string[] = [];
      for (const id of orphans) {
        const from = since.get(id);
        if (from === undefined) since.set(id, t);
        else if (t - from >= PRUNE_AFTER_MS) {
          // Con un origen propio (la transacción de afuera manda): el deshacer de un anotador abierto no la sigue.
          doc.transact(() => removePhotoMarkup(doc, id), PRUNE_ORIGIN);
          since.delete(id);
          pruned.push(id);
        }
      }
      return pruned;
    },
    missing: () => since,
  };
}
