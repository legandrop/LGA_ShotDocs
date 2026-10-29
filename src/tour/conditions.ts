import { DOC_KINDS, pageKind, type DocKind, type EntityKind } from '../relations/kind';
import type { Stage } from '../relations/projectStructure';
import { MAP_TABS, tableReturnPath, type MapTab, type Route } from '../router';
import type { PageTree } from '../sync/tree';

// Las condiciones de los pasos de acción y de los requisitos de un capítulo (Docs/Plan_Proyecto_Desde_Cero.md,
// sección 6). Un vocabulario chico y en **lista blanca**: cada condición solo LEE el estado de la app (la dirección
// abierta y el árbol de páginas en memoria del proyecto de práctica); ninguna dispara trabajo. Una condición que no
// está acá, o con un dato que no se entiende, invalida el catálogo entero (`conditionErrors`): es a propósito, así un
// error de tipeo no deja un paso que no se cumple nunca.
//
// Se escriben por **qué existe**, nunca por número o posición: «hay una escena con número», no «la escena 3».

export const STAGES: readonly Stage[] = ['prepro', 'scenes', 'locations', 'scouting', 'tests', 'shoot', 'references', 'archive'];
const KINDS: readonly EntityKind[] = ['scene', 'location', 'day', 'set'];

export type Condition =
  /** Se usó el menú "/" de la página de práctica (*Getting around*). */
  | { what: 'slashUsed' }
  /** Las carpetas de las etapas del proyecto de práctica existen y no están en la papelera. */
  | { what: 'stageFolders' }
  /** La página abierta es la carpeta de esa etapa (por ejemplo, la de Escenas). */
  | { what: 'open'; stage: Stage }
  /**
   * La página abierta es una página de ese tipo (una escena, una locación); con `fromTable`, abierta desde una fila de una
   * tabla (Esc vuelve a ella, D822).
   */
  | { what: 'openKind'; kind: EntityKind; fromTable?: true }
  /** La página abierta es un documento de ese tipo (un plan, un scouting). */
  | { what: 'openDoc'; doc: DocKind }
  /** El *Overview* está abierto (en esa parte, si se dice). */
  | { what: 'overview'; part?: MapTab }
  /** Hay al menos `min` (1 si no se dice) páginas de ese tipo en el proyecto; una escena cuenta solo con número. */
  | { what: 'pages'; kind: EntityKind; min?: number }
  /** La carpeta de esa etapa tiene al menos `min` (1) páginas adentro. */
  | { what: 'childIn'; stage: Stage; min?: number }
  /**
   * Hay una página de ese tipo con nombre (una escena: algo después del número) y el título ya no se está escribiendo
   * (salir del campo o Enter lo confirman): así el paso no avanza a mitad de una palabra.
   */
  | { what: 'named'; kind: EntityKind }
  /** Algo con ese `data-tour` está en la pantalla (por ejemplo, *Create page* al lado de la locación que nombra la escena). */
  | { what: 'shown'; anchor: string }
  /** Alguna página del proyecto tiene la miniatura elegida con *Use as thumbnail* (D824). */
  | { what: 'thumbChosen' }
  /** Hay al menos `min` (1) documentos de ese tipo en el proyecto: un scouting, una prueba, un plan. */
  | { what: 'docs'; doc: DocKind; min?: number }
  /** Hay un documento de ese tipo con su marca (se le aplicó su plantilla: *Creative scout*, *Day plan*). */
  | { what: 'marked'; doc: DocKind }
  /**
   * Lo que las relaciones ya juntan solas: `scouted`, un scouting que nombra una locación (la cabecera de la locación lo
   * muestra); `reported`, un reporte del día con una sección por escena (la escena muestra lo que se filmó).
   */
  | { what: 'related'; link: RelatedLink };

/** Lo que mira la condición `related`. */
export type RelatedLink = 'scouted' | 'reported';
const LINKS: readonly RelatedLink[] = ['scouted', 'reported'];

/** Lo que pueden mirar las condiciones. `world` es el proyecto de práctica (`null` en la app de verdad). */
export interface ConditionContext {
  route: Route;
  world: { tree: Pick<PageTree, 'get' | 'children' | 'isTrashed' | 'allRowsOf'>; projectId: string; stages: Record<Stage, string> } | null;
  slashUsed: boolean;
  /** El título de la página tiene el foco (se está escribiendo). */
  titleFocused?: boolean;
  /** Si algo con ese `data-tour` se ve. */
  shown?: (anchor: string) => boolean;
  /** Lo que juntan las relaciones del proyecto de práctica (`related`); sin índice todavía, `false`. */
  related?: (link: RelatedLink) => boolean;
}

/** Los datos que acepta cada condición: su tipo, y si son obligatorios. */
type Param = 'stage' | 'kind' | 'part' | 'count' | 'anchor' | 'doc' | 'link' | 'flag';
const VOCABULARY: Record<Condition['what'], { required: Partial<Record<string, Param>>; optional: Partial<Record<string, Param>> }> = {
  slashUsed: { required: {}, optional: {} },
  stageFolders: { required: {}, optional: {} },
  open: { required: { stage: 'stage' }, optional: {} },
  openKind: { required: { kind: 'kind' }, optional: { fromTable: 'flag' } },
  openDoc: { required: { doc: 'doc' }, optional: {} },
  overview: { required: {}, optional: { part: 'part' } },
  pages: { required: { kind: 'kind' }, optional: { min: 'count' } },
  childIn: { required: { stage: 'stage' }, optional: { min: 'count' } },
  named: { required: { kind: 'kind' }, optional: {} },
  shown: { required: { anchor: 'anchor' }, optional: {} },
  thumbChosen: { required: {}, optional: {} },
  docs: { required: { doc: 'doc' }, optional: { min: 'count' } },
  marked: { required: { doc: 'doc' }, optional: {} },
  related: { required: { link: 'link' }, optional: {} },
};

function validParam(type: Param, value: unknown): boolean {
  if (type === 'stage') return STAGES.includes(value as Stage);
  if (type === 'kind') return KINDS.includes(value as EntityKind);
  if (type === 'part') return MAP_TABS.includes(value as MapTab);
  if (type === 'anchor') return typeof value === 'string' && /^[a-z0-9-]+$/.test(value);
  if (type === 'doc') return DOC_KINDS.includes(value as DocKind);
  if (type === 'link') return LINKS.includes(value as RelatedLink);
  if (type === 'flag') return value === true;
  return Number.isInteger(value) && (value as number) >= 1;
}

/** Lo que está mal en una condición (vacío si está bien). `where` nombra el paso o el requisito en el mensaje. */
export function conditionErrors(c: unknown, where: string): string[] {
  if (!c || typeof c !== 'object') return [`${where}: falta la condición`];
  const { what, ...rest } = c as { what?: unknown };
  const spec = typeof what === 'string' ? VOCABULARY[what as Condition['what']] : undefined;
  if (!spec) return [`${where}: condición desconocida «${String(what)}»`];
  const errors: string[] = [];
  for (const [name, type] of Object.entries(spec.required)) {
    if (!validParam(type!, (rest as Record<string, unknown>)[name])) errors.push(`${where}: «${String(what)}» necesita un ${name} válido`);
  }
  for (const [name, value] of Object.entries(rest)) {
    const type = spec.required[name] ?? spec.optional[name];
    if (!type) errors.push(`${where}: «${String(what)}» no lleva «${name}»`);
    else if (!(name in spec.required) && !validParam(type, value)) errors.push(`${where}: «${name}» inválido en «${String(what)}»`);
  }
  return errors;
}

/** Si la condición se cumple ahora. Solo lee. */
export function evaluate(c: Condition, ctx: ConditionContext): boolean {
  const { route, world } = ctx;
  switch (c.what) {
    case 'slashUsed':
      return ctx.slashUsed;
    case 'overview':
      return route.name === 'map' && (!c.part || route.tab === c.part);
    case 'shown':
      return !!ctx.shown?.(c.anchor);
    case 'related':
      return !!ctx.related?.(c.link);
  }
  if (!world) return false;
  const { tree, stages, projectId } = world;
  const live = (id: string) => !!tree.get(id) && !tree.isTrashed(id);
  switch (c.what) {
    case 'stageFolders':
      return STAGES.every((s) => live(stages[s]));
    case 'open':
      return route.name === 'page' && route.id === stages[c.stage];
    case 'openKind':
      return route.name === 'page' && live(route.id) && pageKind(tree, route.id).kind === c.kind && (!c.fromTable || tableReturnPath() !== null);
    case 'openDoc': {
      if (route.name !== 'page' || !live(route.id)) return false;
      const k = pageKind(tree, route.id);
      return k.kind === 'doc' && k.doc === c.doc;
    }
    case 'thumbChosen':
      return tree.allRowsOf(projectId).some((row) => live(row.id) && !!row.settings?.thumb);
    case 'pages': {
      let n = 0;
      for (const row of tree.allRowsOf(projectId)) {
        if (!live(row.id)) continue;
        const k = pageKind(tree, row.id);
        if (k.kind === c.kind && (c.kind !== 'scene' || ('code' in k && !!k.code))) n++;
      }
      return n >= (c.min ?? 1);
    }
    case 'childIn':
      return live(stages[c.stage]) && tree.children(stages[c.stage]).filter((r) => !tree.isTrashed(r.id)).length >= (c.min ?? 1);
    case 'named': {
      if (ctx.titleFocused) return false;
      for (const row of tree.allRowsOf(projectId)) {
        if (!live(row.id)) continue;
        const k = pageKind(tree, row.id);
        if (k.kind !== c.kind) continue;
        const code = 'code' in k ? k.code : null;
        // Una escena: algo después del número (`001 | Andén`); lo demás, cualquier título.
        const rest = code ? row.title.trim().slice(code.length).replace(/^\s*[|·:\-–]\s*/, '') : row.title.trim();
        if (rest.trim()) return true;
      }
      return false;
    }
    case 'docs': {
      let n = 0;
      for (const row of tree.allRowsOf(projectId)) {
        if (!live(row.id)) continue;
        const k = pageKind(tree, row.id);
        if (k.kind === 'doc' && k.doc === c.doc) n++;
      }
      return n >= (c.min ?? 1);
    }
    case 'marked':
      return tree.allRowsOf(projectId).some((row) => live(row.id) && (row.settings?.entity as { kind?: string } | undefined)?.kind === c.doc);
  }
}
