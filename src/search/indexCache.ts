import { dirtyRange, DIRTY_PREFIX, type LocalDb } from '../sync/localDb';
import type { CacheChange, IndexCache } from './projectIndex';

// Lo que leyó el índice del proyecto (la búsqueda y las relaciones en vivo, Docs/Doc_Relaciones.md, sección 5), guardado
// en el dispositivo: en `meta`, una clave por página con el prefijo `INDEX_PREFIX` y el proyecto
// (`searchIndex:<proyecto>:<página>`; nunca `docDirty:`, que es la marca de lo que falta subir). Abrir un proyecto carga
// solo lo suyo. Es un atajo y nada más: si falta, se lee el documento; si algo falla, se ignora. No sale del dispositivo
// y no se sube.

export const INDEX_PREFIX = 'searchIndex:';

export const indexKey = (projectId: string, pageId: string): string => `${INDEX_PREFIX}${projectId}:${pageId}`;

function range(projectId: string): IDBKeyRange {
  const from = `${INDEX_PREFIX}${projectId}:`;
  return IDBKeyRange.bound(from, `${from}￿`);
}

export function localIndexCache(db: LocalDb): IndexCache {
  return {
    async load(projectId) {
      const tx = db.transaction('meta', 'readonly');
      const store = tx.objectStore('meta');
      const [keys, values, dirtyKeys] = await Promise.all([store.getAllKeys(range(projectId)), store.getAll(range(projectId)), store.getAllKeys(dirtyRange())]);
      await tx.done;
      const at = `${INDEX_PREFIX}${projectId}:`.length;
      const entries = new Map<string, unknown>();
      keys.forEach((key, i) => entries.set(String(key).slice(at), values[i]));
      const dirty = new Set(dirtyKeys.map((k) => String(k).slice(DIRTY_PREFIX.length)));
      return { entries, dirty };
    },
    async save(changes: CacheChange[]) {
      if (changes.length === 0) return;
      const tx = db.transaction('meta', 'readwrite');
      const store = tx.objectStore('meta');
      for (const { pageId, projectId, entry } of changes) {
        const key = indexKey(projectId, pageId);
        void (entry ? store.put(entry, key) : store.delete(key)).catch(() => undefined);
      }
      await tx.done;
    },
  };
}
