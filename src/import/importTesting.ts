import { envelope, pendingImport, type GenerationStore, type ImportSnapshot, type RecoveryJournal, type RecoveryStore } from './importCommit';

// Ayuda para las pruebas de la importación (como src/sync/testing.ts): no va en la app.

/**
 * El diario de la importación, para las pruebas que cortan o miran un guardado. La importación guarda cada paso con
 * `saveGeneration`; acá ese guardado pasa por `put`, que la prueba puede reemplazar (`{ ...diario, put }`) para
 * decidir si se hace y qué pasa antes o después. `get` devuelve lo que quedó para seguir de la generación activa
 * (nada si ya terminó).
 */
export function hookableJournal<T extends RecoveryJournal>(source: RecoveryStore<T>) {
  const store = source as GenerationStore<T>;
  let inflight: { expected: ImportSnapshot<T>; id: string; saved?: ImportSnapshot<T> } | undefined;
  return {
    ...store,
    get: async (key: string): Promise<T | undefined> => {
      const pending = await pendingImport(store, key);
      return pending.complete ? undefined : pending.journal;
    },
    // El guardado de verdad del paso que la importación está por anotar.
    put: async (journal: T): Promise<void> => {
      if (!inflight) throw new Error('No hay un guardado del diario en curso');
      inflight.saved = await store.saveGeneration(inflight.expected, inflight.id, journal);
    },
    async saveGeneration(this: { put(journal: T): Promise<void> }, expected: ImportSnapshot<T>, id: string, journal: T): Promise<ImportSnapshot<T>> {
      const call: NonNullable<typeof inflight> = { expected, id };
      inflight = call;
      try {
        await this.put(journal);
      } finally {
        inflight = undefined;
      }
      if (!call.saved) throw new Error('La prueba no guardó el diario');
      return call.saved;
    },
  };
}

/** El diario de la generación activa tal como quedó guardado, haya terminado o no. */
export async function activeJournal<T extends RecoveryJournal>(source: RecoveryStore<T>, key: string): Promise<T | undefined> {
  const state = await (source as GenerationStore<T>).loadState(key);
  return envelope<T>(state.raw) ? state.raw.generations[state.raw.activeGenerationId].journal : state.raw;
}
