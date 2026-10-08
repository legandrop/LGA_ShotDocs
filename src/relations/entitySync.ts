import type { PageTree } from '../sync/tree';
import { BUILTIN_LOCATION, BUILTIN_SCENE } from '../templates/builtinIds';
import { dayReportsMark, isDayReportFolder } from '../templates/dayReport';
import { entityMark, holdsMark, holdsOf, kindReader, type EntityKind, type KindTree } from './kind';

// Las marcas de tipo (Docs/Doc_Estructura_Proyecto.md, «Tipo de página»): lo que escribe `settings.entity` en las páginas
// y `settings.holds` / `settings.dayReports` en las carpetas. Lo que se lee está en `kind.ts`.
//
// Cuándo se escribe la marca de una página (D-E2-2 a D-E2-4):
// - Al ponerle título en una carpeta con tipo (crearla con título, o renombrarla la primera vez: el «+» la crea vacía y
//   recién al nombrarla se sabe si es una escena o un grupo, como un episodio). Mientras no tiene título, la carpeta ya
//   le da el tipo al leer. El título escrito en la página cuenta recién al CONFIRMARLO (Enter, salir del campo, cambiar
//   de página o cerrar la app: `PageTree.titleConfirmed`), no en cada pausa de 300 ms en que se guarda: «Episodio »
//   con una pausa antes del «6» no queda marcado escena, y `074` no sube `105_000` ni `105_007` mientras se tipea (D382).
// - Al marcar la carpeta: todo su primer nivel (y lo de adentro de sus grupos) que no tenga marca.
// - Al moverla adentro de una carpeta con tipo, si no tiene marca. Al sacarla, la marca se queda: sigue siendo una
//   escena; para cambiarla está *Type* en el menú.
// - El código de una escena sigue al título: si el título (con el episodio de su carpeta) trae un número canónico
//   distinto del guardado, se actualiza. Si el título deja de traer uno, el guardado se queda.
// - Nunca se pisa una marca de otro tipo, ni `false` («no es nada de eso»), ni una de una versión más nueva.
// Cada escritura es una clave de ajustes (`setSetting`): la base la fusiona por clave (`patch_page_settings`), así que no
// pisa otros ajustes, y una versión vieja que cambia otro ajuste no la borra.

type SyncTree = KindTree & Pick<PageTree, 'setSetting'>;

/** La marca que la página tendría que tener ahora, o `undefined` si queda como está. */
export function wantedMark(tree: KindTree, id: string): { kind: EntityKind; code?: string } | undefined {
  const row = tree.get(id);
  if (!row || !row.title.trim() || tree.isTrashed(id)) return undefined;
  const reader = kindReader(tree);
  if (reader.excluded(id)) return undefined;
  const mark = entityMark(row);
  if (mark === null) {
    const kind = reader.kindOf(id);
    if (kind.kind !== 'scene' && kind.kind !== 'location' && kind.kind !== 'day') return undefined;
    if (kind.source !== 'folder') return undefined;
    return kind.code ? { kind: kind.kind, code: kind.code } : { kind: kind.kind };
  }
  if (!mark || mark === 'other' || mark.kind !== 'scene') return undefined;
  const code = reader.titleCode(id);
  return code && code !== mark.code ? { kind: 'scene', code } : undefined;
}

/** Pone o pone al día la marca de la página (ver arriba). */
export async function syncEntityMark(tree: SyncTree, id: string): Promise<void> {
  const wanted = wantedMark(tree, id);
  if (wanted) await tree.setSetting(id, 'entity', wanted);
}

/** Las páginas que toman su tipo de esta carpeta: el primer nivel y lo de adentro de sus grupos (episodios, bloques). */
export function typedInside(tree: KindTree, folderId: string): string[] {
  const reader = kindReader(tree);
  if (!reader.holdsOf(folderId)) return [];
  const out: string[] = [];
  for (const child of tree.children(folderId)) {
    if (reader.contextOf(child.id)?.folder === folderId) out.push(child.id);
    else if (!reader.holdsOf(child.id)) {
      for (const inner of tree.children(child.id)) if (reader.contextOf(inner.id)?.folder === folderId) out.push(inner.id);
    }
  }
  return out;
}

/**
 * Después de crear (con título), renombrar o mover una página en este dispositivo (`PageTree.onPlaced`). Movida, también
 * lo de adentro que toma el tipo de ella o de su carpeta (un episodio entero que entra en el desglose).
 */
export async function placedEntity(tree: SyncTree, id: string, how: 'create' | 'title' | 'move'): Promise<void> {
  await syncEntityMark(tree, id);
  if (how !== 'move') return;
  const inside = new Set<string>(typedInside(tree, id));
  for (const child of tree.children(id)) inside.add(child.id);
  for (const child of inside) await syncEntityMark(tree, child);
}

/** Lo que contiene la carpeta, como lo ofrece el menú: escenas, locaciones, días o nada. */
export function folderHolds(tree: KindTree, id: string): EntityKind | null {
  return holdsOf(tree, id);
}

/**
 * Marca lo que contiene una carpeta (*Type* → *Pages inside*). Días = carpeta de reportes del día (D369): escribe
 * `dayReports` y saca `holds` si tenía otro; escenas o locaciones escriben `holds` y, si era carpeta de reportes, la dejan
 * de usar (`dayReports: false`); nada saca `holds` y deja de usarla para reportes. Después marca lo de adentro que no
 * tenga marca. Las marcas de las páginas no se sacan al desmarcar (D-E2-3).
 */
export async function markFolderHolds(tree: SyncTree, id: string, holds: EntityKind | null): Promise<void> {
  const row = tree.get(id);
  if (!row) return;
  const reports = dayReportsMark(row);
  if (holds === 'day') {
    if (reports !== 'on') await tree.setSetting(id, 'dayReports', {});
    if (holdsMark(row) !== null) await tree.setSetting(id, 'holds', undefined);
  } else {
    const isReports = reports === 'on' || (reports === null && isDayReportFolder(tree as PageTree, id));
    if (isReports) await tree.setSetting(id, 'dayReports', false);
    await tree.setSetting(id, 'holds', holds ?? undefined);
  }
  if (holds) for (const child of typedInside(tree, id)) await syncEntityMark(tree, child);
}

/**
 * *Type* → *This page is*: marca la página como escena (con el código de su título, o el que ya tenía guardado si el
 * título no da ninguno), locación, día, o nada (`false`).
 */
export async function setPageType(tree: SyncTree, id: string, kind: EntityKind | null): Promise<void> {
  const row = tree.get(id);
  if (!row) return;
  if (kind === null) return tree.setSetting(id, 'entity', false);
  const mark = entityMark(row);
  const kept = mark && mark !== 'other' && mark.kind === 'scene' ? (mark.code ?? null) : null;
  const code = kind === 'scene' ? (kindReader(tree).titleCode(id) ?? kept) : null;
  await tree.setSetting(id, 'entity', code ? { kind, code } : { kind });
}

/**
 * Lo que hace `services.ts` al arrancar: la marca de tipo al crear, renombrar o mover en este dispositivo. Con un link
 * público no: un link no cambia filas (su base lo rechazaría).
 */
export function installEntityMarks(tree: Pick<PageTree, 'onPlaced'> & SyncTree, viaLink: boolean): void {
  if (viaLink) return;
  tree.onPlaced = (id, how) => placedEntity(tree, id, how);
}

/**
 * El tipo que da una plantilla: *Scene* y *Location* de fábrica, o una propia que salió de una de ellas (*Customize*).
 * Las demás, ninguno.
 */
export function templateEntity(tree: Pick<PageTree, 'get'>, templateId: string | null | undefined): EntityKind | null {
  const of = (id: string | null | undefined): EntityKind | null =>
    id === BUILTIN_SCENE ? 'scene' : id === BUILTIN_LOCATION ? 'location' : null;
  return of(templateId) ?? (templateId ? of(tree.get(templateId)?.template_id) : null);
}

/** Una página creada con *Scene* o *Location* queda marcada, esté donde esté (gana sobre la marca que tuviera). */
export async function markFromTemplate(tree: SyncTree, id: string, templateId: string | null | undefined): Promise<void> {
  const kind = templateEntity(tree, templateId);
  if (!kind) return;
  const mark = entityMark(tree.get(id));
  if (mark && mark !== 'other' && mark.kind === kind) return syncEntityMark(tree, id);
  await setPageType(tree, id, kind);
}
