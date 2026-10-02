import type * as Y from 'yjs';
import { orphanMarkup, PHOTO_MARKUP_MAP, removePhotoMarkup } from './markup';
import { mediaIdsInDoc } from './usage';

// La poda de las anotaciones de una foto sacada de la página (P.20, AN11; Docs/Doc_Anotar_Fotos.md, sección 3). Un
// dispositivo que EDITA la página borra, como una edición normal (sube a `page_updates`, entra en el historial), las
// claves de un archivo que ya no está en el contenido desde hace más de 10 minutos: así no le llegan a quien solo ve
// (la base limpia, D14), y un cortar y pegar no las dispara.
//
// Las tres condiciones del diseño:
//   1. Los 10 minutos los mide este dispositivo con la página abierta Y SINCRONIZADA (con red, nada sin subir ni sin
//      bajar; `startMarkupPrune`), con su reloj (nunca una hora del documento). Sin red, un dispositivo no ve que otro
//      volvió a poner la foto (auditoría B2 de la entrega 2): al perder la red se olvida lo contado.
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
  /** Olvida desde cuándo falta cada una (sin red o con algo sin subir: los 10 minutos vuelven a contar). */
  forget(): void;
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
    forget: () => since.clear(),
  };
}

export interface PruneOptions {
  doc: Y.Doc;
  /** La página se puede editar (en PageEditor ya exige la página entera bajada). */
  editable: boolean;
  /** Los permisos se conocen. */
  permsKnown: boolean;
  /** La vista de una versión del historial: nunca se poda. */
  preview: boolean;
  /**
   * La página está sincronizada: hay red, nada propio sin subir y nada del servidor sin bajar (auditoría B2). Sin red,
   * el dispositivo no ve que otro volvió a poner la foto (deshacer, mover, cortar y pegar): podaría lo que sigue en la
   * página. Mientras no lo está, se olvida desde cuándo falta cada foto: los 10 minutos cuentan desde que vuelve.
   */
  synced: () => Promise<boolean>;
  now?: () => number;
  everyMs?: number;
}

/**
 * Arranca la poda de una página abierta (condiciones 1 a 3 del diseño, sección 3): solo quien edita, con los permisos
 * conocidos, fuera del historial y con la página sincronizada. Mira al abrir y cada minuto. Devuelve cómo pararla.
 */
export function startMarkupPrune(options: PruneOptions): () => void {
  const { doc, editable, permsKnown, preview, synced, now, everyMs = PRUNE_EVERY_MS } = options;
  if (!editable || !permsKnown || preview) return () => undefined;
  const pruner = createMarkupPruner(doc, now);
  let stopped = false;
  let running = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const ok = await synced().catch(() => false);
      if (stopped) return;
      if (ok) pruner.check();
      else pruner.forget();
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), everyMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
