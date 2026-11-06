import type { PageTree } from '../sync/tree';
import type { StorageNames } from '../workspace';

// Los proyectos favoritos de cada persona (la estrella del selector de proyectos, Docs/Doc_Navegacion.md, «Proyectos
// favoritos»): los favoritos se listan antes que los demás. Desde la versión 30 de la base se guardan en
// `project_favorites` y se sincronizan entre dispositivos (`PageTree.favoriteProject`, `ProjectRow.favorite`). La
// v0.327 los guardaba solo en el dispositivo, en `localStorage`: lo que quedó ahí se pasa una vez a la base
// (`adoptDeviceFavorites`) y se borra.

type Keys = Pick<StorageNames, 'project'>;

/** La clave de `localStorage` de la v0.327 (la del proyecto elegido del workspace, con su sufijo). */
export function favoritesKey(keys: Keys): string {
  return `${keys.project}-favorites`;
}

function readAll(keys: Keys): Record<string, unknown> {
  try {
    const raw = JSON.parse(localStorage.getItem(favoritesKey(keys)) ?? '{}') as unknown;
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Pasa a la base los favoritos que la v0.327 guardó en este dispositivo para el usuario, y los borra de ahí. Todos
 * quedan pendientes, también los de un proyecto que el dispositivo todavía no conoce: si la persona ya no lo ve, la
 * base lo rechaza y se descarta. Sin nada guardado, no hace nada.
 */
export async function adoptDeviceFavorites(keys: Keys, userId: string, tree: PageTree): Promise<void> {
  const all = readAll(keys);
  const list = all[userId];
  if (list === undefined) return;
  const ids = Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [];
  for (const id of ids) await tree.favoriteProject(id, true);
  const rest = { ...all };
  delete rest[userId];
  try {
    if (Object.keys(rest).length) localStorage.setItem(favoritesKey(keys), JSON.stringify(rest));
    else localStorage.removeItem(favoritesKey(keys));
  } catch {
    // Si no se puede borrar, la próxima vez se vuelve a pasar: marcar un favorito que ya está no hace nada.
  }
}

/** Los favoritos primero; dentro de cada grupo, el orden de siempre. */
export function favoritesFirst<T extends { id: string; favorite?: boolean }>(projects: readonly T[]): T[] {
  return [...projects.filter((p) => p.favorite), ...projects.filter((p) => !p.favorite)];
}
