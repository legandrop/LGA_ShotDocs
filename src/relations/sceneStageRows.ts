import type { DayRef, PageChip, Place, SceneLive } from './liveView';

// Los renglones «Etapa | Tipo: links» de una escena (Docs/Doc_Relaciones.md, sección 23; D783, D784): dónde está cada cosa
// de la escena, por etapa del árbol (Plan_Estructura_Etapas.md). Los usan la vista de una escena del Overview y la cabecera
// viva de la página de la escena. Puro: sale de `sceneLive` (y, en el Overview, de la lista de páginas que la nombran).
// Lo que dice cada renglón lo traduce el componente; acá solo hay datos.

export type StageId = 'pre' | 'scouting' | 'tests' | 'plan' | 'shoot' | 'other';
export type RowId = 'breakdown' | 'set' | 'location' | 'question' | 'scouting' | 'tests' | 'plan' | 'shoot' | 'other';

/**
 * A dónde lleva un link, y en qué color va (D774): una escena, una locación o un día en su color; cualquier otra página o
 * lugar, en el acento. `null`: texto sin link (un decorado escrito sin página).
 */
export type StageTarget =
  | { kind: 'scene'; pageId: string }
  | { kind: 'loc'; pageId: string }
  | { kind: 'day'; pageId: string }
  | { kind: 'page'; pageId: string }
  | { kind: 'place'; place: Place };

export interface StageLink {
  label: string;
  target: StageTarget | null;
  /** Un día: su fecha (`AAAA-MM-DD`), para mostrarla al lado. */
  date?: string | null;
}

export type StageLine =
  /** Links en fila, separados por coma; `shots`: cuántos planos; `photos`: cuántas fotos; `via`: «de {locación}». */
  | { kind: 'links'; links: StageLink[]; shots?: number; photos?: number; via?: string }
  /** Un día y lo suyo: «Día 73 · 11 mar › Escena 101_032a, Escena 101_032b · 26 fotos». `named`: solo lo nombra el texto. */
  | { kind: 'path'; lead: StageLink; links: StageLink[]; photos?: number; named?: boolean }
  /** La primera pregunta abierta, de qué plano es y cuántas más hay. */
  | { kind: 'question'; text: string; place: Place; shot: string | null; cards: number; more: number }
  /** Las páginas índice, plegadas. */
  | { kind: 'index'; links: StageLink[] };

export interface StageRow {
  id: RowId;
  stage: StageId;
  lines: StageLine[];
  /** Sin nada: `reading` mientras el índice lee (no se afirma un cero, D402); `none` cuando ya leyó todo. */
  empty: 'reading' | 'none' | null;
}

export interface StageOptions {
  /** La cabecera de la página de la escena: sin el renglón *Desglose* (es esta página). */
  self: boolean;
  /** El título de una página que la persona ve. */
  title(pageId: string): string;
  /** La página de una locación, por su nombre (el registro), o `null`. */
  locPage(name: string): string | null;
  /** Lo que la nombra además de las etapas (otras páginas) y las páginas índice. */
  others: PageChip[];
  index: PageChip[];
}

const pageTarget = (c: PageChip): StageTarget => (c.blockId ? { kind: 'place', place: { pageId: c.pageId, blockId: c.blockId } } : { kind: 'page', pageId: c.pageId });

/** Los renglones de una escena, en el orden de las etapas. Los de siempre van aunque estén vacíos; los otros, solo si tienen algo. */
export function sceneStageRows(v: SceneLive, o: StageOptions): StageRow[] {
  const rows: StageRow[] = [];
  const empty = (has: boolean): StageRow['empty'] => (has ? null : v.complete ? 'none' : 'reading');
  const add = (id: RowId, stage: StageId, lines: StageLine[], always: boolean) => {
    if (!lines.length && !always) return;
    rows.push({ id, stage, lines, empty: empty(lines.length > 0) });
  };

  // Preproducción | Desglose: la página de la escena y cuántos planos tiene.
  if (!o.self) {
    add('breakdown', 'pre', v.pageId ? [{ kind: 'links', links: [{ label: o.title(v.pageId), target: { kind: 'scene', pageId: v.pageId } }], shots: v.shots.length }] : [], true);
  }

  // Preproducción | Decorado: los del campo *Locacion Guion* / *Sets* de la escena y sus planos.
  add('set', 'pre', v.sets.length ? [{ kind: 'links', links: v.sets.map((s) => ({ label: s.title, target: s.pageId ? { kind: 'page', pageId: s.pageId } : null })) }] : [], false);

  // Preproducción | Locación: las que nombra su desglose y las de los días en que se filmó (por el título del día).
  const locs: StageLink[] = [];
  const seenLoc = new Set<string>();
  const addLoc = (name: string, pageId: string | null) => {
    if (seenLoc.has(name)) return;
    seenLoc.add(name);
    locs.push({ label: name, target: pageId ? { kind: 'loc', pageId } : null });
  };
  for (const l of v.plannedAt) addLoc(l.title, l.pageId || o.locPage(l.title));
  for (const d of v.days) if (d.sections.length) for (const name of d.day.locs) addLoc(name, o.locPage(name));
  add('location', 'pre', locs.length ? [{ kind: 'links', links: locs }] : [], true);

  // Preproducción | Preguntas abiertas: la primera, de qué plano, y cuántas más.
  const q = v.questions[0];
  if (q) {
    add('question', 'pre', [{ kind: 'question', text: q.text.split('\n')[0], place: q.place, shot: q.cards.length === 1 ? q.cards[0].shot : null, cards: q.cards.length, more: v.questions.length - 1 }], false);
  }

  // Scouting | Reportes: los que la nombran; si ninguno, los de las locaciones donde se filmó («de …»).
  const scouts: StageLine[] = v.scoutPages.length
    ? [{ kind: 'links', links: v.scoutPages.map((s) => ({ label: s.title, target: pageTarget(s) })) }]
    : v.scoutsVia.length
      ? [...new Set(v.scoutsVia.map((s) => s.loc))].map((loc) => ({
          kind: 'links' as const,
          links: v.scoutsVia.filter((s) => s.loc === loc).map((s) => ({ label: s.title, target: { kind: 'page' as const, pageId: s.pageId } })),
          via: loc,
        }))
      : [];
  add('scouting', 'scouting', scouts, true);

  // Pruebas | Reportes: solo si alguna la nombra.
  add('tests', 'tests', v.testPages.length ? [{ kind: 'links', links: v.testPages.map((s) => ({ label: s.title, target: pageTarget(s) })) }] : [], false);

  // Planeamiento | Plan de jornada: cada día con los planes que la nombran (también un día en que se filmó).
  const plans: StageLine[] = v.plans.map((p) => {
    const pages = new Map<string, StageLink>();
    for (const ex of p.items) if (!pages.has(ex.pageId)) pages.set(ex.pageId, { label: ex.pageTitle, target: { kind: 'place', place: ex.place } });
    return { kind: 'path', lead: dayLink(p.day), links: [...pages.values()] };
  });
  add('plan', 'plan', plans, true);

  // Rodaje | Reportes: cada día con sus secciones de la escena (y sus fotos); un día que solo la nombra en el texto, aparte.
  const shoot: StageLine[] = [];
  for (const d of v.days) {
    if (d.sections.length) {
      shoot.push({ kind: 'path', lead: dayLink(d.day), links: d.sections.map((s) => ({ label: s.heading, target: { kind: 'place', place: s.place } })), photos: d.photos.length });
    } else if (d.mentions.length) {
      shoot.push({ kind: 'path', lead: dayLink(d.day), links: [{ label: '', target: { kind: 'place', place: d.mentions[0].place } }], named: true });
    }
  }
  add('shoot', 'shoot', shoot, true);

  // Otras | También la nombran: lo que no es de ninguna etapa, y las páginas índice plegadas.
  const other: StageLine[] = [];
  if (o.others.length) other.push({ kind: 'links', links: o.others.map((c) => ({ label: c.title, target: pageTarget(c) })) });
  if (o.index.length) other.push({ kind: 'index', links: o.index.map((c) => ({ label: c.title, target: pageTarget(c) })) });
  add('other', 'other', other, false);
  return rows;
}

function dayLink(day: DayRef): StageLink {
  return { label: day.label, target: { kind: 'day', pageId: day.pageId }, date: day.date };
}

/** Las páginas que ya están en algún renglón (para no repetirlas en *También la nombran*). */
export function stagePageIds(v: SceneLive): Set<string> {
  const ids = new Set<string>();
  if (v.pageId) ids.add(v.pageId);
  for (const s of v.shots) ids.add(s.pageId);
  for (const c of v.cards) ids.add(c.pageId);
  for (const s of v.sets) if (s.pageId) ids.add(s.pageId);
  for (const l of v.plannedAt) if (l.pageId) ids.add(l.pageId);
  for (const s of [...v.scoutPages, ...v.scoutsVia, ...v.testPages]) ids.add(s.pageId);
  for (const p of v.plans) {
    ids.add(p.day.pageId);
    for (const ex of p.items) ids.add(ex.pageId);
  }
  for (const d of v.days) {
    ids.add(d.day.pageId);
    for (const ex of [...d.sections, ...d.mentions]) ids.add(ex.pageId);
  }
  return ids;
}
