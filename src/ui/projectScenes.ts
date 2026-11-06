import { setPageType } from '../relations/entitySync';
import { entityMark, kindReader, sceneCode } from '../relations/kind';
import { buildRegistry } from '../relations/reader';
import { registerProject } from '../relations/register';
import { resolveSceneParam } from '../relations/sceneSearch';
import type { SyncEngine } from '../sync/engine';
import type { PageTree } from '../sync/tree';
import type { PageRow } from '../sync/types';
import { isEntityMarked, wholeBranch } from './outsideReaders';

// Las escenas de un proyecto como las comparte *Share scenes* (Docs/Doc_Compartir_Escenas.md, B-1, D843): las usan la
// ventana de compartir y la de decidir el pedido de una escena desde su link (B-2). Salen del registro de este
// dispositivo (quien comparte ve el proyecto entero), con lo de adentro y si se pueden compartir. La base vuelve a
// controlar todo (`set_page_shares`): esto solo arma el pedido y lo explica.

/** La marca de escena no llegó al servidor (sin red, o la cola del árbol trabada): no se comparte nada. */
export const MARKS_PENDING = new Error('marks_pending');
const ENTITY_KINDS = new Set(['scene', 'location', 'day', 'set']);

export function isMarkedScene(row: PageRow | undefined): boolean {
  const mark = entityMark(row);
  return !!mark && mark !== 'other' && mark.kind === 'scene';
}

export interface SceneItem {
  pageId: string;
  code: string;
  title: string;
  /** Las páginas de adentro (sus fichas): van con la escena. */
  inside: number;
  /**
   * Adentro (también en la papelera) hay otra escena, una locación, un día o un decorado (por el registro o por la marca
   * de la base), una carpeta que guarda alguno, o una página con título de escena: no se puede compartir.
   */
  blocked: boolean;
}

/** Las escenas vivas del proyecto, en orden de número, con lo de adentro y si se pueden compartir. */
export function projectSceneItems(tree: PageTree, engine: Pick<SyncEngine, 'branchOf'>, projectId: string): SceneItem[] {
  const kinds = kindReader(tree);
  return registerProject(tree, projectId, kinds)
    .scenes.filter((s): s is typeof s & { pageId: string } => typeof s.pageId === 'string' && !tree.isTrashed(s.pageId))
    .map((s) => {
      const inside = engine.branchOf(s.pageId).slice(1);
      const everything = wholeBranch(tree, s.pageId).slice(1);
      return {
        pageId: s.pageId,
        code: s.code,
        title: tree.get(s.pageId)?.title ?? '',
        inside: inside.length,
        blocked: everything.some((r) => isEntityMarked(r) || ENTITY_KINDS.has(kinds.kindOf(r.id).kind) || sceneCode(r.title) !== null),
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));
}

/**
 * La escena del proyecto que nombra lo escrito en un link (`scene=` en cualquier forma: `101_066`, `1066`,
 * `ERSO_1066_010`), con el mismo lector que el Panorama (`resolveSceneParam`), o `null`.
 */
export function resolveProjectScene(tree: PageTree, projectId: string, text: string): string | null {
  const reg = registerProject(tree, projectId);
  const registry = buildRegistry({ scenes: reg.scenes, locations: reg.locations });
  const code = resolveSceneParam({ snap: { registry }, title: (id) => tree.get(id)?.title }, text.trim());
  if (!code) return null;
  const pageId = registry.scenes.get(code)?.pageId;
  return typeof pageId === 'string' && !tree.isTrashed(pageId) ? pageId : null;
}

/** La marca de escena en las elegidas que no la tienen, y esperar a que suba (si no, la base las rechaza). */
export async function markScenes(tree: PageTree, engine: Pick<SyncEngine, 'syncNow'>, ids: string[]): Promise<void> {
  const unmarked = ids.filter((id) => !isMarkedScene(tree.get(id)));
  if (unmarked.length === 0) return;
  for (const id of unmarked) await setPageType(tree, id, 'scene');
  await engine.syncNow();
  const waiting = new Set(unmarked);
  const left = tree.pendingOps().some((o) => o.op.kind === 'update' && waiting.has(o.op.id));
  const failed = tree.failedOps().some((o) => o.op.kind === 'update' && waiting.has(o.op.id));
  if (left || failed || unmarked.some((id) => !isMarkedScene(tree.get(id)))) throw MARKS_PENDING;
}
