import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { locale, t as current, type Translate } from '../i18n';
import { errorMessage } from '../sync/types';
import { navigate, pagePath, useRoute, useSearchParam } from '../router';
import { projectDriveAt, type ProjectDrive } from '../media/projectDrive';
import { useServices, useSyncStatus, useTree } from '../services';
import { APP_OUTDATED, PROJECT_DRIVE_SCHEMA_VERSION } from '../sync/remote';
import type { PageTree } from '../sync/tree';
import type { ProjectRow } from '../sync/types';
import type { StorageNames } from '../workspace';

// El proyecto abierto sale de la página abierta; en el inicio o en la papelera, del último elegido en
// este dispositivo. Cambiar de proyecto vuelve a la última página que se abrió en él.

// Los nombres salen del workspace (`StorageNames`); los de Wanka son los de siempre.
type Keys = Pick<StorageNames, 'project' | 'lastPages'>;
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
function storedProject(keys: Keys, userId: string): string | null {
  return read<Record<string, string>>(keys.project, {})[userId] ?? null;
}

/** Deja elegido un proyecto (el que muestran el inicio, el mapa y la papelera); también los tabs (tabs.ts). */
export function storeProject(keys: Keys, userId: string, projectId: string): void {
  if (storedProject(keys, userId) === projectId) return;
  write(keys.project, { ...read<Record<string, string>>(keys.project, {}), [userId]: projectId });
  window.dispatchEvent(new Event(EVENT));
}

export function lastPageOf(keys: Keys, projectId: string): string | null {
  return read<Record<string, string>>(keys.lastPages, {})[projectId] ?? null;
}

export function rememberPage(keys: Keys, tree: PageTree, userId: string, pageId: string): void {
  const page = tree.get(pageId);
  if (!page) return;
  write(keys.lastPages, { ...read<Record<string, string>>(keys.lastPages, {}), [page.workspace_id]: pageId });
  storeProject(keys, userId, page.workspace_id);
}

function subscribe(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

// El proyecto que nombra la dirección del Panorama (`/map/scenes?project=ERSO&scene=101_066`): lo usan los links que
// llegan de afuera (PipeSync, otra persona del equipo), que tienen que abrir ese proyecto y no el último elegido en
// este dispositivo (Docs/Doc_Link_Escena.md).
export const PROJECT_PARAM = 'project';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un nombre de proyecto comparable: sin mayúsculas, sin tildes y sin espacios de más. */
function projectKey(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** La primera palabra del nombre: «ERSO | Serie» → «erso». */
function projectCode(name: string): string {
  return projectKey(name).split(/[\s|·_\-/]+/).filter(Boolean)[0] ?? '';
}

type Named = Pick<ProjectRow, 'id' | 'name'>;

/**
 * Los proyectos que nombra `value`: el de ese id, los que se llaman así enteros o, si no hay ninguno, los que empiezan
 * con esa palabra (el código con que los conocen PipeSync y Flow). Solo entre los que este dispositivo conoce.
 */
export function projectMatches<P extends Named>(projects: readonly P[], value: string): P[] {
  const raw = value.trim();
  if (!raw || raw.length > 200) return [];
  if (UUID.test(raw)) return projects.filter((p) => p.id.toLowerCase() === raw.toLowerCase());
  const key = projectKey(raw);
  const exact = projects.filter((p) => projectKey(p.name) === key);
  return exact.length ? exact : projects.filter((p) => projectCode(p.name) === key);
}

/** El proyecto que nombra `value`, solo si hay UNO: con dos que coinciden, ninguno (no se adivina cuál). */
export function projectFromParam(projects: readonly Named[], value: string): string | null {
  const found = projectMatches(projects, value);
  return found.length === 1 ? found[0].id : null;
}

/**
 * Lo que dice la dirección del Panorama sobre el proyecto: nada (`none`), el proyecto que nombra (`found`), más de uno
 * (`ambiguous`, con sus nombres) o ninguno de este dispositivo (`missing`; puede estar bajando todavía, quien lo muestra
 * decide).
 */
export type ProjectParam =
  | { kind: 'none' }
  | { kind: 'found'; id: string }
  | { kind: 'ambiguous'; value: string; names: string[] }
  | { kind: 'missing'; value: string };

export function useProjectParam(): ProjectParam {
  const tree = useTree();
  const route = useRoute();
  const value = useSearchParam(PROJECT_PARAM);
  if (route.name !== 'map' || value === null) return { kind: 'none' };
  const found = projectMatches(tree.projects(), value);
  if (found.length === 1) return { kind: 'found', id: found[0].id };
  if (found.length > 1) return { kind: 'ambiguous', value, names: found.map((p) => p.name) };
  return { kind: 'missing', value };
}

/**
 * Lo que va en el pedido de una escena (B-2) desde el proyecto abierto `projectId`, del que se ve una parte: su id solo si
 * el link lo nombra sin dudas (trae su id, o su nombre entero, o no trae proyecto); si el link trae un nombre que acá
 * coincidió solo por la primera palabra («erso» con «ERSO | Serie» a la vista), el texto del link, que la base resuelve
 * entre los proyectos de quien decide: puede nombrar otro proyecto, uno que esta persona no ve.
 */
export function sceneRequestProject(projects: readonly Named[], projectId: string, value: string | null): string {
  const raw = (value ?? '').trim();
  if (!raw) return projectId;
  if (UUID.test(raw)) return raw.toLowerCase() === projectId.toLowerCase() ? projectId : raw;
  const project = projects.find((p) => p.id === projectId);
  return project && projectKey(project.name) === projectKey(raw) ? projectId : raw;
}

/** `sceneRequestProject` con el `project=` de la dirección. */
export function useSceneRequestProject(projectId: string): string {
  const tree = useTree();
  const value = useSearchParam(PROJECT_PARAM);
  return sceneRequestProject(tree.projects(), projectId, value);
}

/** El valor de la dirección tal como se muestra en un aviso: recortado, para que no se lea como un texto de la app. */
export function shownParam(value: string): string {
  const one = value.trim().replace(/\s+/g, ' ');
  return one.length > 40 ? `${one.slice(0, 39).trimEnd()}…` : one;
}

/** El id del proyecto abierto. */
export function useCurrentProject(): string {
  const tree = useTree();
  const { user, workspace } = useServices();
  const route = useRoute();
  const keys = workspace.config.storage;
  const stored = useSyncExternalStore(subscribe, () => storedProject(keys, user.id));
  const param = useProjectParam();
  const page = route.name === 'page' ? tree.get(route.id) : undefined;
  if (page) return page.workspace_id;
  if (param.kind === 'found') return param.id;
  if (stored && tree.project(stored)) return stored;
  // Sin uno elegido, el primero del dispositivo; si está archivado, el primero activo (P.14, sección 8).
  if (tree.project(tree.workspaceId)?.archived_at) return tree.activeProjects()[0]?.id ?? tree.workspaceId;
  return tree.workspaceId;
}

/**
 * El error de archivar, borrar o restaurar un proyecto, en palabras (P.14). Los que pasan de verdad (otra persona
 * lo borró o cambió los permisos mientras tanto) tienen su frase; los demás, el motivo tal cual.
 */
export function projectStateError(err: unknown, t: Translate = current): string {
  const code = errorMessage(err);
  if (code === 'not_allowed') return t('project.errorNotAllowed');
  if (code === 'drive_untrash_first') return t('project.errorDriveFirst');
  if (code === 'project_not_found') return t('project.errorNotFound');
  if (code === 'project_deleted') return t('project.errorDeleted');
  if (code === 'project_purged') return t('project.errorPurged');
  if (code === APP_OUTDATED) return t('common.appOutdated');
  return t('project.stateFailed', { reason: code });
}

/** Abre un proyecto: su última página abierta, o su inicio. */
export function useSwitchProject(): (projectId: string) => void {
  const tree = useTree();
  const { user, workspace } = useServices();
  const keys = workspace.config.storage;
  return useCallback(
    (projectId: string) => {
      storeProject(keys, user.id, projectId);
      const last = lastPageOf(keys, projectId);
      const page = last ? tree.get(last) : undefined;
      if (page && page.workspace_id === projectId && !tree.isTrashed(page.id)) navigate(pagePath(page.id));
      else navigate('/');
    },
    [tree, user.id, keys],
  );
}

/** "MGTZD" → "MG", "Bosque Negro" → "BN". */
export function monogram(name: string): string {
  const words = name.split(/[\s|·_\-/]+/).filter(Boolean);
  const letters = words.length >= 2 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

/** "edited today", "edited yesterday", "edited Sep 12" (o en castellano, con `t`). */
export function editedLabel(iso: string | null, t: Translate = current): string {
  if (!iso) return t('project.emptyStats');
  const date = new Date(iso);
  const today = new Date();
  const days = Math.round(
    (new Date(today.toDateString()).getTime() - new Date(date.toDateString()).getTime()) / 86_400_000,
  );
  if (days <= 0) return t('project.editedToday');
  if (days === 1) return t('project.editedYesterday');
  const sameYear = date.getFullYear() === today.getFullYear();
  const day = date.toLocaleDateString(locale(t.lang), { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
  return t('project.editedOn', { date: day });
}

/**
 * El cliente de la carpeta del proyecto en Drive (P.14, entrega 2), con la dirección del portero que ya conoce la
 * sincronización. `null` si el workspace no tiene portero o la base todavía no tiene la migración 10.
 */
export function useProjectDrive(): ProjectDrive | null {
  const { client, projectDrive } = useServices();
  const { mediaUrl, schemaVersion } = useSyncStatus();
  return useMemo(() => {
    if (!mediaUrl || (schemaVersion ?? 0) < PROJECT_DRIVE_SCHEMA_VERSION) return null;
    return projectDrive ?? projectDriveAt(mediaUrl, client);
  }, [mediaUrl, schemaVersion, client, projectDrive]);
}
