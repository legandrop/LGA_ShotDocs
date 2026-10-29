import { pageKind } from '../relations/kind';
import { scoutLocations } from '../relations/liveView';
import { parseRoute } from '../router';
import { existingRelationsSession } from '../ui/relationsUi';
import type { TourStep } from '../tutorial/steps';
import { flags } from '../tutorial/tourState';
import { chaptersOf, stepsOf, STATES, type ChapterDef, type NeedState, type NeedWorld, type TourDef } from './catalog';
import { evaluate, type Condition, type ConditionContext, type RelatedLink } from './conditions';
import { practiceWorld } from './world';

// El recorrido por el catálogo, sin DOM (Docs/Plan_Proyecto_Desde_Cero.md, sección 6): dónde está cada id, qué viene
// después y antes, el capítulo siguiente (*Skip chapter*) y los requisitos de un capítulo. Todo por id, nunca por
// posición guardada: si un paso o un capítulo ya no existe, se cae al primero.

export interface Place {
  chapter: ChapterDef;
  /** Los pasos del capítulo en este diseño. */
  steps: TourStep[];
  index: number;
}

export type Target = { chapter: string; step: string };

/** Los capítulos del recorrido que tienen pasos en este diseño (los «Coming soon» se saltean). */
function playable(tour: TourDef, phone: boolean): ChapterDef[] {
  return chaptersOf(tour).filter((c) => stepsOf(c, phone).length > 0);
}

/** Dónde está `chapter` / `step` (vacíos o que ya no existen: el primero). `null` si el recorrido no tiene pasos. */
export function placeOf(tour: TourDef, chapter: string, step: string, phone: boolean): Place | null {
  const list = playable(tour, phone);
  const found = list.find((c) => c.id === chapter) ?? list[0];
  if (!found) return null;
  const steps = stepsOf(found, phone);
  const index = steps.findIndex((s) => s.id === step);
  return { chapter: found, steps, index: index < 0 ? 0 : index };
}

/** El primer paso del capítulo que sigue a `chapter` (*Skip chapter*), o `end`. */
export function chapterAfter(tour: TourDef, chapter: string, phone: boolean): Target | 'end' {
  const all = chaptersOf(tour);
  for (const c of all.slice(all.findIndex((x) => x.id === chapter) + 1)) {
    const steps = stepsOf(c, phone);
    if (steps.length) return { chapter: c.id, step: steps[0].id };
  }
  return 'end';
}

/** El paso que sigue (*Next*, o un paso de acción cumplido), o `end`. */
export function nextOf(tour: TourDef, at: Place, phone: boolean): Target | 'end' {
  if (at.index + 1 < at.steps.length) return { chapter: at.chapter.id, step: at.steps[at.index + 1].id };
  return chapterAfter(tour, at.chapter.id, phone);
}

/** El paso de antes (*Back*; puede ser el último del capítulo anterior), o `null` en el primero. */
export function prevOf(tour: TourDef, at: Place, phone: boolean): Target | null {
  if (at.index > 0) return { chapter: at.chapter.id, step: at.steps[at.index - 1].id };
  const list = playable(tour, phone);
  const before = list[list.findIndex((c) => c.id === at.chapter.id) - 1];
  if (!before) return null;
  const steps = stepsOf(before, phone);
  return { chapter: before.id, step: steps[steps.length - 1].id };
}

/** El número del capítulo en el recorrido (desde 1) y cuántos tiene, contando los que todavía no tienen pasos. */
export function chapterNumber(tour: TourDef, chapter: string): { n: number; total: number } {
  return { n: tour.chapters.indexOf(chapter) + 1, total: tour.chapters.length };
}

/** Lo que miran las condiciones ahora: la dirección, el proyecto de práctica (si hay) y lo que pasó en la práctica. */
export function conditionContext(): ConditionContext {
  return {
    route: parseRoute(location.pathname),
    world: practiceWorld(),
    slashUsed: flags.slashUsed,
    titleFocused: !!document.activeElement?.classList.contains('page-title'),
    shown: (anchor) =>
      [...document.querySelectorAll<HTMLElement>(`[data-tour="${anchor}"]`)].some((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }),
    related,
  };
}

/**
 * Lo que ya juntan solas las relaciones del proyecto de práctica (la condición `related`), leído del índice que arma la
 * app: un scouting que nombra una locación, o un reporte del día con una sección por escena. Solo lee; sin el índice
 * armado todavía, `false` (el paso espera).
 */
function related(link: RelatedLink): boolean {
  const w = practiceWorld();
  if (!w?.docs) return false;
  const session = existingRelationsSession({ docs: w.docs } as unknown as Parameters<typeof existingRelationsSession>[0]);
  const snap = session?.relations.snapshot(w.projectId);
  if (!session || !snap) return false;
  const src = { snap, title: (id: string) => w.tree.get(id)?.title, content: (id: string) => session.index.content(id) };
  for (const [pageId, rel] of snap.pages) {
    const k = pageKind(w.tree, pageId);
    if (link === 'reported' && k.kind === 'day' && rel.sections.some((x) => x.scenes.some((sc) => sc.kind === 'scene'))) return true;
    if (link === 'scouted' && k.kind === 'doc' && k.doc === 'scouting' && scoutLocations(src, pageId).length > 0) return true;
  }
  return false;
}

export function met(c: Condition): boolean {
  return evaluate(c, conditionContext());
}

/**
 * Deja listo lo que el capítulo necesita (`needs`): por cada estado (y lo que ese estado necesita antes), si no existe
 * (`check`) lo fabrica (`make`) y vuelve a comprobarlo. Tira un error con el nombre de lo que no se pudo preparar.
 */
export async function ensureNeeds(
  chapter: ChapterDef,
  world: NeedWorld | null = practiceWorld(),
  context: () => ConditionContext = conditionContext,
  states: Record<string, NeedState> = STATES,
): Promise<void> {
  const visited = new Set<string>();
  const visit = async (id: string): Promise<void> => {
    if (visited.has(id)) return;
    visited.add(id);
    const state = states[id];
    if (!state) throw new Error(`requisito desconocido: ${id}`);
    for (const inner of state.needs ?? []) await visit(inner);
    if (evaluate(state.check, context())) return;
    if (!world) throw new Error(`no hay proyecto de práctica para preparar: ${id}`);
    await state.make(world);
    if (!(await settled(state, context))) throw new Error(`no se pudo preparar: ${id}`);
  };
  for (const id of chapter.needs ?? []) await visit(id);
}

/**
 * Si el estado ya se cumple después de fabricarlo. Lo que lee el índice de las relaciones (`related`) llega un momento
 * después de escribir: ese se espera hasta 15 segundos; lo demás (el árbol) se ve enseguida.
 */
async function settled(state: NeedState, context: () => ConditionContext): Promise<boolean> {
  if (evaluate(state.check, context())) return true;
  if (state.check.what !== 'related') return false;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (evaluate(state.check, context())) return true;
  }
  return false;
}
