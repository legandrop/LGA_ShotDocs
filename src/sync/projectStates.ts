import type { Language } from '../prefs';
import type { PageTree } from './tree';
import type { TreeOp } from './types';

// Archivar, borrar y restaurar proyectos (P.14, Docs/Doc_Proyectos_Borrar.md): lo que la interfaz calcula en el
// dispositivo. Lo que se puede o no se puede lo decide la base (`set_project_archived`, `delete_project`,
// `restore_project`); acá solo se cuenta lo que este dispositivo tiene sin subir y se elige a qué proyecto pasar.

/** Cuántos días se puede restaurar un proyecto borrado (lo mismo que cuenta la base en `days_left`). */
export const PROJECT_TRASH_DAYS = 30;

/** La palabra que confirma el borrado, según el idioma de la app (decisión de Lega: no se acepta la del otro). */
export function deleteWord(lang: Language): string {
  return lang === 'es' ? 'borrar' : 'delete';
}

/** Lo escrito confirma el borrado: la palabra del idioma de la app, sin distinguir mayúsculas ni espacios de más. */
export function deleteWordMatches(input: string, lang: Language): boolean {
  return input.trim().toLowerCase() === deleteWord(lang);
}

/** Las partes del dispositivo que pueden tener algo de un proyecto sin subir. */
export interface LocalQueues {
  tree: PageTree;
  docs: { unsyncedPages(): Promise<string[]> };
  files: { pendingPageIds(): Promise<string[]> };
  media?: { pendingPageIds(): Promise<string[]> } | null;
  comments?: { pendingPageIds(): string[] } | null;
}

/**
 * Cuántas cosas de este proyecto tiene el dispositivo sin subir (también las rechazadas, que siguen a la vista):
 * cambios del árbol, páginas con contenido sin subir, imágenes, fotos y videos, y comentarios. Con algo, no se
 * deja borrar el proyecto desde acá (sección 6.1): el servidor las rechazaría todas mientras esté borrado.
 */
export async function unsyncedInProject(queues: LocalQueues, projectId: string): Promise<number> {
  const { tree } = queues;
  const projectOfPage = (pageId: string) => tree.get(pageId)?.workspace_id;
  const opProject = (op: TreeOp): string | undefined => {
    if (op.kind === 'createProject') return op.project.id;
    if (op.kind === 'renameProject') return op.id;
    if (op.kind === 'create') return op.page.workspace_id;
    return projectOfPage(op.id);
  };
  let count = 0;
  for (const o of tree.pendingOps()) if (opProject(o.op) === projectId) count++;
  for (const f of tree.failedOps()) if (opProject(f.op) === projectId) count++;
  const [pages, files, media] = await Promise.all([
    queues.docs.unsyncedPages(),
    queues.files.pendingPageIds(),
    queues.media?.pendingPageIds() ?? Promise.resolve([] as string[]),
  ]);
  const comments = queues.comments?.pendingPageIds() ?? [];
  for (const pageId of [...pages, ...files, ...media, ...comments]) if (projectOfPage(pageId) === projectId) count++;
  return count;
}

/**
 * A qué proyecto pasa la app después de archivar o borrar el abierto (sección 7.3): el siguiente activo de la
 * lista (el de abajo; si era el último, el de arriba). `null` si no queda ninguno.
 */
export function nextProjectAfter(tree: PageTree, projectId: string): string | null {
  const list = tree.activeProjects();
  const at = list.findIndex((p) => p.id === projectId);
  const rest = list.filter((p) => p.id !== projectId);
  if (rest.length === 0) return null;
  if (at < 0) return rest[0].id;
  return (rest[at] ?? rest[at - 1] ?? rest[0]).id;
}

/** Es el único proyecto activo: no se archiva ni se borra (decisión de Lega, sección 7.1). */
export function isOnlyActiveProject(tree: PageTree, projectId: string): boolean {
  const active = tree.activeProjects();
  return active.length <= 1 && (active.length === 0 || active[0].id === projectId);
}
