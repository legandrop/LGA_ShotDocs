import { useCallback, useSyncExternalStore } from 'react';
import { navigate, pagePath, useRoute } from '../router';
import { useServices, useTree } from '../services';
import type { PageTree } from '../sync/tree';

// El proyecto abierto sale de la página abierta; en el inicio o en la papelera, del último elegido en
// este dispositivo. Cambiar de proyecto vuelve a la última página que se abrió en él.

const CURRENT_KEY = 'shotdocs-project';
const LAST_PAGES_KEY = 'shotdocs-last-pages';
const EVENT = 'shotdocs:project';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Recordar el proyecto y la última página es solo una comodidad.
  }
}

/** Proyecto elegido por usuario, en este dispositivo. */
function storedProject(userId: string): string | null {
  return read<Record<string, string>>(CURRENT_KEY, {})[userId] ?? null;
}

function storeProject(userId: string, projectId: string): void {
  if (storedProject(userId) === projectId) return;
  write(CURRENT_KEY, { ...read<Record<string, string>>(CURRENT_KEY, {}), [userId]: projectId });
  window.dispatchEvent(new Event(EVENT));
}

export function lastPageOf(projectId: string): string | null {
  return read<Record<string, string>>(LAST_PAGES_KEY, {})[projectId] ?? null;
}

export function rememberPage(tree: PageTree, userId: string, pageId: string): void {
  const page = tree.get(pageId);
  if (!page) return;
  write(LAST_PAGES_KEY, { ...read<Record<string, string>>(LAST_PAGES_KEY, {}), [page.workspace_id]: pageId });
  storeProject(userId, page.workspace_id);
}

function subscribe(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

/** El id del proyecto abierto. */
export function useCurrentProject(): string {
  const tree = useTree();
  const { user } = useServices();
  const route = useRoute();
  const stored = useSyncExternalStore(subscribe, () => storedProject(user.id));
  const page = route.name === 'page' ? tree.get(route.id) : undefined;
  if (page) return page.workspace_id;
  if (stored && tree.project(stored)) return stored;
  return tree.workspaceId;
}

/** Abre un proyecto: su última página abierta, o su inicio. */
export function useSwitchProject(): (projectId: string) => void {
  const tree = useTree();
  const { user } = useServices();
  return useCallback(
    (projectId: string) => {
      storeProject(user.id, projectId);
      const last = lastPageOf(projectId);
      const page = last ? tree.get(last) : undefined;
      if (page && page.workspace_id === projectId && !tree.isTrashed(page.id)) navigate(pagePath(page.id));
      else navigate('/');
    },
    [tree, user.id],
  );
}

/** "MGTZD" → "MG", "Bosque Negro" → "BN". */
export function monogram(name: string): string {
  const words = name.split(/[\s|·_\-/]+/).filter(Boolean);
  const letters = words.length >= 2 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

/** "edited today", "edited yesterday", "edited Sep 12". */
export function editedLabel(iso: string | null): string {
  if (!iso) return 'empty';
  const date = new Date(iso);
  const today = new Date();
  const days = Math.round(
    (new Date(today.toDateString()).getTime() - new Date(date.toDateString()).getTime()) / 86_400_000,
  );
  if (days <= 0) return 'edited today';
  if (days === 1) return 'edited yesterday';
  const sameYear = date.getFullYear() === today.getFullYear();
  return `edited ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })}`;
}
