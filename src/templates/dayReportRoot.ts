import type { Permissions } from '../sync/access';
import type { PageTree } from '../sync/tree';
import { isDayReportFolder } from './dayReport';

// *On-Set Report* en una página de la raíz del proyecto (Docs/Doc_Plantillas.md, 6.2, decisión D82, Lega 2026-10-02): el
// reporte del día no se crea sin carpeta. La app ofrece una carpeta de reportes (una que el proyecto ya tenga, o una nueva
// marcada con *Use for day reports*) y mueve ahí la página, que sigue siendo la misma: no queda ninguna vacía en la raíz.
// Esto va sin el editor: solo lee el árbol y crea la carpeta.

/** Una carpeta de reportes del proyecto a la que esta página se puede mover. */
export interface ReportFolderOption {
  id: string;
  title: string;
  /** Las de arriba (`Escenas / `), para distinguir dos con el mismo nombre; vacío si está en la raíz. */
  parents: string;
}

/** Cuántas páginas se recorren como mucho buscando carpetas de reportes (un proyecto enorme no tiene que trabar el diálogo). */
const MAX_SCAN = 5000;

type FoldersTree = Pick<PageTree, 'get' | 'roots' | 'children' | 'isTrashed' | 'ancestors' | 'isDescendant'>;
type FoldersPerms = Pick<Permissions, 'canMove'>;

/**
 * Las carpetas de reportes del proyecto (marcadas, o deducidas por un reporte adentro) donde la persona puede poner la
 * página `pageId`: crear ahí y mover la página (nivel 4 en las dos). Sin la página ni lo que cuelga de ella (no se puede
 * mover adentro de sí misma) ni lo que esté en la papelera. En el orden del árbol.
 */
export function reportFolderOptions(tree: FoldersTree, perms: FoldersPerms, projectId: string, pageId: string): ReportFolderOption[] {
  const out: ReportFolderOption[] = [];
  const stack = [...tree.roots(projectId)].reverse();
  let scanned = 0;
  while (stack.length && scanned++ < MAX_SCAN) {
    const row = stack.pop()!;
    if (row.id === pageId) continue;
    if (tree.isDescendant(row.id, pageId)) continue;
    if (isDayReportFolder(tree as PageTree, row.id) && perms.canMove(pageId, row.id)) {
      out.push({ id: row.id, title: row.title, parents: tree.ancestors(row.id).map((p) => p.title).join(' / ') });
    }
    stack.push(...[...tree.children(row.id)].reverse());
  }
  return out;
}

/**
 * Crea la carpeta de reportes en la raíz de `projectId`, justo donde está la página `before` (así la página y su carpeta no
 * se separan en la barra lateral), con su marca. Devuelve el id. Todo local: la cola del árbol la sube cuando hay red.
 * Una carpeta vacía y marcada no es un dato de nadie: si lo que sigue falla, queda lista para reusarse y no se duplica.
 */
export async function createReportFolder(
  tree: Pick<PageTree, 'create' | 'setSetting'>,
  name: string,
  projectId: string,
  before: string,
  fallbackName: string,
): Promise<string> {
  const title = name.replace(/\s+/g, ' ').trim() || fallbackName;
  const id = await tree.create(null, title, projectId, { before });
  await tree.setSetting(id, 'dayReports', {});
  return id;
}
