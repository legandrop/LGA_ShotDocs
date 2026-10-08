import type { PageTree } from '../sync/tree';
import type { PageRow, ProjectRow } from '../sync/types';
import type { BuiltinKind } from './builtin';
import {
  BUILTIN_CREATIVE_SCOUT,
  BUILTIN_LOCATION,
  BUILTIN_ONSET,
  BUILTIN_PREPRO,
  BUILTIN_SCENE,
  BUILTIN_SHOT,
  BUILTIN_TECH_SCOUT,
} from './builtinIds';

// Las plantillas propias (Docs/Doc_Plantillas.md, sección 3 y entrega 3): una plantilla es una PÁGINA, con
// `settings.template` y normalmente adentro de la carpeta *Templates* del proyecto (`settings.templatesFolder`). Se edita,
// se sincroniza, se comenta y se restaura como cualquier página, y la ve quien ve esa página: no hay nada nuevo en la base.
// Esto va en la primera carga (la franja de arriba del título y el menú de la página lo usan): solo lee el árbol, no
// arrastra el editor. Copiar el contenido está en `ownCopy.ts`.

/** Lo que guarda `settings.template`. */
export interface TemplateInfo {
  description: string;
  dayReport: boolean;
}

/** El tope de la descripción (5.1): `settings` entero no puede pasar de 2000 caracteres (`pages_settings_shape`). */
export const DESCRIPTION_MAX = 300;
/** El tope de `settings` en la base (`pages_settings_shape`). */
export const SETTINGS_MAX = 2000;

/** La marca de la página: `on` (marcada), `off` (se dejó de usar a mano) o `null` (sin marca). */
export function templateMark(row: PageRow | undefined): 'on' | 'off' | null {
  const value: unknown = row?.settings?.template;
  if (value === false) return 'off';
  if (value && typeof value === 'object' && !Array.isArray(value)) return 'on';
  return null;
}

/** La página es la carpeta *Templates* de su proyecto (una página raíz marcada). */
export function isTemplatesFolder(row: PageRow | undefined): boolean {
  return !!row && row.settings?.templatesFolder === true;
}

/**
 * La página es una plantilla: marcada, o (si la marca se perdió por dos cambios de ajustes a la vez, sección 8)
 * directamente adentro de una carpeta *Templates*. *Stop using as template* (`false`) gana sobre lo deducido. Una en la
 * papelera (o adentro de algo en la papelera) no cuenta: al restaurarla, vuelve.
 */
export function isTemplatePage(tree: Pick<PageTree, 'get' | 'isTrashed'>, id: string): boolean {
  const row = tree.get(id);
  if (!row || tree.isTrashed(id) || isTemplatesFolder(row)) return false;
  const mark = templateMark(row);
  if (mark) return mark === 'on';
  return !!row.parent_id && isTemplatesFolder(tree.get(row.parent_id));
}

/** La descripción y la marca de reporte del día (vacías si la marca se perdió). Formas raras cuentan como vacías. */
export function templateInfo(row: PageRow | undefined): TemplateInfo {
  const value = row?.settings?.template as { description?: unknown; dayReport?: unknown } | false | undefined;
  if (!value || typeof value !== 'object') return { description: '', dayReport: false };
  return {
    description: typeof value.description === 'string' ? value.description : '',
    dayReport: value.dayReport === true,
  };
}

/** Lo que se guarda en `settings.template` (sin claves vacías: cada carácter cuenta para el tope de 2000). */
export function templateSetting(info: { description?: string; dayReport?: boolean }): { description?: string; dayReport?: true } {
  const description = (info.description ?? '').replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_MAX);
  return { ...(description ? { description } : {}), ...(info.dayReport ? { dayReport: true as const } : {}) };
}

/** Los ajustes de la página quedan dentro del tope de la base con este cambio. */
export function settingsFit(row: PageRow | undefined, patch: Record<string, unknown>): boolean {
  return JSON.stringify({ ...(row?.settings ?? {}), ...patch }).length <= SETTINGS_MAX;
}

/** La carpeta *Templates* del proyecto (la primera, si hubiera dos), sin las de la papelera. */
export function templatesFolderOf(tree: Pick<PageTree, 'roots' | 'isTrashed'>, projectId: string): PageRow | null {
  return tree.roots(projectId).find((p) => isTemplatesFolder(p) && !tree.isTrashed(p.id)) ?? null;
}

/**
 * La plantilla de fábrica de la que salió una plantilla propia (*Customize*, o guardar como plantilla un reporte): para
 * *Use built-in* cuando la propia no terminó de bajar (4.2). `null` si no salió de una.
 */
export function builtinOrigin(row: PageRow | undefined): BuiltinKind | null {
  return BY_ID.get(row?.template_id ?? '') ?? null;
}

const BY_ID = new Map<string, BuiltinKind>([
  [BUILTIN_PREPRO, 'prepro'],
  [BUILTIN_ONSET, 'onset'],
  [BUILTIN_SHOT, 'shot'],
  [BUILTIN_SCENE, 'scene'],
  [BUILTIN_LOCATION, 'location'],
  [BUILTIN_TECH_SCOUT, 'techScout'],
  [BUILTIN_CREATIVE_SCOUT, 'creativeScout'],
]);

/** Una plantilla propia en la ventana *Templates*. */
export interface OwnTemplate {
  row: PageRow;
  info: TemplateInfo;
}

/** Las plantillas propias, agrupadas: las del proyecto abierto y las de otros proyectos que la persona ve (3). */
export interface TemplateLists {
  thisProject: OwnTemplate[];
  others: { project: ProjectRow | { id: string; name: string }; templates: OwnTemplate[] }[];
}

type ListTree = Pick<PageTree, 'get' | 'isTrashed' | 'roots' | 'children' | 'projects' | 'project'>;

/** Las plantillas de un proyecto: las de su carpeta *Templates* (en orden) y las marcadas en otros lugares. */
function templatesOfProject(tree: ListTree, projectId: string): OwnTemplate[] {
  const out: OwnTemplate[] = [];
  const seen = new Set<string>();
  const add = (row: PageRow) => {
    if (seen.has(row.id) || !isTemplatePage(tree, row.id)) return;
    seen.add(row.id);
    out.push({ row, info: templateInfo(row) });
  };
  const folder = templatesFolderOf(tree, projectId);
  if (folder) for (const row of tree.children(folder.id)) add(row);
  // Marcadas fuera de la carpeta (una página que se marcó donde estaba): recorrido del árbol del proyecto.
  const stack = [...tree.roots(projectId)];
  while (stack.length) {
    const row = stack.shift()!;
    if (templateMark(row) === 'on') add(row);
    stack.push(...tree.children(row.id));
  }
  return out;
}

/**
 * Lo que lista la ventana *Templates* (4.1): las del proyecto abierto y, aparte, las de los demás proyectos del
 * dispositivo (con su nombre). `exclude`: la página que va a recibir la plantilla (no se la ofrece a sí misma).
 */
export function listTemplates(tree: ListTree, projectId: string, exclude?: string): TemplateLists {
  const keep = (list: OwnTemplate[]) => list.filter((t) => t.row.id !== exclude);
  const others: TemplateLists['others'] = [];
  for (const project of tree.projects()) {
    if (project.id === projectId) continue;
    const templates = keep(templatesOfProject(tree, project.id));
    if (templates.length) others.push({ project, templates });
  }
  return { thisProject: keep(templatesOfProject(tree, projectId)), others };
}

/** Las plantillas de reporte del día que la persona ve (las propias con *Use for day reports*), primero las del proyecto. */
export function dayReportTemplates(tree: ListTree, projectId: string): OwnTemplate[] {
  const lists = listTemplates(tree, projectId);
  return [...lists.thisProject, ...lists.others.flatMap((o) => o.templates)].filter((t) => t.info.dayReport);
}

/**
 * La página `id` es una plantilla propia de reporte del día (para reconocer los reportes que salieron de ella y deducir la
 * carpeta de reportes, 6.2). Cuenta aunque después se haya mandado a la papelera: los reportes ya hechos siguen siéndolo.
 */
export function isDayReportTemplate(tree: Pick<PageTree, 'get'>, id: string | null | undefined): boolean {
  return !!id && templateInfo(tree.get(id)).dayReport;
}

/**
 * *Template settings…* (5.2): la descripción y *Use for day reports*. `false` si no entra en el tope de la base (no guarda
 * nada). Lo que la marca tenga y esta versión no conozca (otra versión pudo agregar claves) se conserva.
 */
export async function saveTemplateSettings(
  tree: Pick<PageTree, 'get' | 'setSetting'>,
  pageId: string,
  info: { description: string; dayReport: boolean },
): Promise<boolean> {
  const row = tree.get(pageId);
  if (!row) return false;
  const before = row.settings?.template;
  const kept: Record<string, unknown> = before && typeof before === 'object' ? { ...before } : {};
  delete kept.description;
  delete kept.dayReport;
  const next = { ...kept, ...templateSetting(info) } as { description?: string; dayReport?: true };
  if (!settingsFit(row, { template: next })) return false;
  await tree.setSetting(pageId, 'template', next);
  return true;
}

/**
 * *Stop using as template* (5.2): la página queda como una página común. Adentro de *Templates* queda `false` (si no, la
 * carpeta la volvería a contar como plantilla); en otro lugar se borra la marca.
 */
export async function stopUsingAsTemplate(tree: Pick<PageTree, 'get' | 'setSetting'>, pageId: string): Promise<void> {
  const row = tree.get(pageId);
  if (!row) return;
  const inFolder = !!row.parent_id && isTemplatesFolder(tree.get(row.parent_id));
  await tree.setSetting(pageId, 'template', inFolder ? false : undefined);
}
