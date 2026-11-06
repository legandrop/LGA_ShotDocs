import { useCallback, useSyncExternalStore } from 'react';
import type { StorageNames } from '../workspace';

// Los proyectos favoritos de cada persona (la estrella del selector de proyectos, Docs/Doc_Navegacion.md): los
// favoritos se listan antes que los demás. Es una comodidad personal, como lo colapsado «solo para vos»: se guarda en
// este dispositivo, por workspace y por usuario, y no se sincroniza.

type Keys = Pick<StorageNames, 'project'>;
const EVENT = 'shotdocs:favorites';

/** La clave de `localStorage`: la del proyecto elegido del workspace, con su sufijo (no choca con la de nadie). */
export function favoritesKey(keys: Keys): string {
  return `${keys.project}-favorites`;
}

function readAll(keys: Keys): Record<string, string[]> {
  try {
    const raw = JSON.parse(localStorage.getItem(favoritesKey(keys)) ?? '{}') as unknown;
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

/** Los favoritos de un usuario (vacío si no hay o si lo guardado está dañado). */
export function favoritesOf(keys: Keys, userId: string): string[] {
  const list = readAll(keys)[userId];
  return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [];
}

/** Marca o desmarca un proyecto como favorito. */
export function setFavorite(keys: Keys, userId: string, projectId: string, favorite: boolean): void {
  const current = favoritesOf(keys, userId).filter((id) => id !== projectId);
  const next = favorite ? [...current, projectId] : current;
  try {
    localStorage.setItem(favoritesKey(keys), JSON.stringify({ ...readAll(keys), [userId]: next }));
  } catch {
    // Es una comodidad: si no se puede guardar, la lista queda como estaba.
    return;
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Los favoritos primero; dentro de cada grupo, el orden de siempre. */
export function favoritesFirst<T extends { id: string }>(projects: readonly T[], favorites: readonly string[]): T[] {
  const set = new Set(favorites);
  return [...projects.filter((p) => set.has(p.id)), ...projects.filter((p) => !set.has(p.id))];
}

function subscribe(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  // Otra pestaña del mismo navegador.
  window.addEventListener('storage', fn);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener('storage', fn);
  };
}

/** Los favoritos del usuario y cómo cambiarlos; se actualiza al marcar uno (también desde otra pestaña). */
export function useProjectFavorites(keys: Keys, userId: string): { favorites: string[]; toggle: (projectId: string) => void } {
  // El texto guardado como instantánea: estable entre renders mientras no cambie.
  const raw = useSyncExternalStore(subscribe, () => JSON.stringify(favoritesOf(keys, userId)));
  const favorites = JSON.parse(raw) as string[];
  const toggle = useCallback(
    (projectId: string) => setFavorite(keys, userId, projectId, !favoritesOf(keys, userId).includes(projectId)),
    [keys, userId],
  );
  return { favorites, toggle };
}
