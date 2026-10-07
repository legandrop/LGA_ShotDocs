import { useEffect, useRef, useSyncExternalStore } from 'react';
import { usePermissions, useServices, useSyncStatus } from '../services';
import { HISTORY_SCHEMA_VERSION, NAMED_VERSIONS_SCHEMA_VERSION } from '../sync/history';
import { existingHistoryCache, pruneHistoryCache } from '../sync/historyCache';
import { settlePendingRestores } from '../sync/historyLoad';
import type { HistoryRemote, NamedVersionsRemote } from '../sync/remote';
import { canSeeHistory } from './historyUi';

// La caché del historial (historyCache.ts) tiene las filas de cada página con lo borrado adentro (D13). Cuando esta
// persona deja de poder ver el historial de una página (le sacan el permiso, pasa a invitada, la página sale del
// árbol), lo guardado de esa página se tira aunque no se abra el historial. Solo con los permisos conocidos y la base
// en la versión del historial: sin datos de permisos, todo da permitido y no se tira nada.

/** Cuánto se espera después de un cambio de permisos o del árbol (llegan varios juntos al sincronizar). */
export const PRUNE_DELAY_MS = 2000;

/**
 * *Restored from…* (Docs/Doc_Historial.md): la marca de una restauración se guarda cuando la restauración llega al
 * servidor. Si la app se cerró antes, quedó pendiente en la caché: se termina después de cada sincronización, sin
 * esperar a que alguien abra el historial de esa página (antes, pasada una semana sin abrirlo, se perdía).
 */
function usePendingRestoreMarks(): void {
  const { remote, docs, dbName } = useServices();
  const { schemaVersion, lastSyncAt, online, outdated } = useSyncStatus();
  useEffect(() => {
    // Con la app más vieja que la versión mínima del workspace no se intenta: la base rechazaría la marca, y pedir el
    // historial para eso es trabajo perdido. Queda pendiente y se termina cuando la app se actualiza.
    if (!dbName || (schemaVersion ?? 0) < NAMED_VERSIONS_SCHEMA_VERSION || !online || outdated || lastSyncAt === null) return;
    void (async () => {
      // Sin caché (nadie abrió nunca el historial en este dispositivo) no hay marcas pendientes: no se crea una.
      const cache = await existingHistoryCache(dbName);
      if (cache) await settlePendingRestores({ remote: remote as unknown as HistoryRemote & NamedVersionsRemote, cache, docs });
    })().catch(() => undefined);
  }, [dbName, schemaVersion, online, outdated, lastSyncAt, remote, docs]);
}

export function useHistoryCachePruning(delayMs = PRUNE_DELAY_MS): void {
  usePendingRestoreMarks();
  const { access, tree, dbName } = useServices();
  const perms = usePermissions();
  const { schemaVersion } = useSyncStatus();
  const accessRevision = useSyncExternalStore(access.subscribe, access.getRevision);
  const treeRevision = useSyncExternalStore(tree.subscribe, tree.getRevision);
  const permsRef = useRef(perms);
  permsRef.current = perms;
  useEffect(() => {
    if (!dbName || (schemaVersion ?? 0) < HISTORY_SCHEMA_VERSION || !access.get()) return;
    const timer = setTimeout(() => {
      void pruneHistoryCache(dbName, (pageId) => canSeeHistory(permsRef.current, pageId, schemaVersion)).catch(() => undefined);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [dbName, schemaVersion, access, accessRevision, treeRevision, delayMs]);
}
