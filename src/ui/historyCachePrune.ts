import { useEffect, useRef, useSyncExternalStore } from 'react';
import { usePermissions, useServices, useSyncStatus } from '../services';
import { HISTORY_SCHEMA_VERSION } from '../sync/history';
import { pruneHistoryCache } from '../sync/historyCache';
import { canSeeHistory } from './historyUi';

// La caché del historial (historyCache.ts) tiene las filas de cada página con lo borrado adentro (D13). Cuando esta
// persona deja de poder ver el historial de una página (le sacan el permiso, pasa a invitada, la página sale del
// árbol), lo guardado de esa página se tira aunque no se abra el historial. Solo con los permisos conocidos y la base
// en la versión del historial: sin datos de permisos, todo da permitido y no se tira nada.

/** Cuánto se espera después de un cambio de permisos o del árbol (llegan varios juntos al sincronizar). */
export const PRUNE_DELAY_MS = 2000;

export function useHistoryCachePruning(delayMs = PRUNE_DELAY_MS): void {
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
