import type { PageTree } from '../sync/tree';
import { dateAtStart, dayInTitle, isValidDate, reportTitle } from '../templates/dayReport';
import type { DayReportDeps } from '../templates/dayReportCreate';
import { planOf, type DayPlan } from './dayLive';
import { emptyValue, fieldDate, fieldValues } from './fields';
import { locationOf, type DayRef, type LiveSource } from './liveView';
import type { PrepareDeps, PrepareOptions, PrepareResult } from './prepareDay';
import { BUILTIN_ONSET } from '../templates/builtinIds';
import { cardFields, findFields } from './relationIndex';

// La tarjeta *Tomorrow* de un día sin día siguiente (Docs/Doc_Relaciones.md, sección 11; roadmap v0.241 (1); D573–D577):
// ofrece crear el reporte de mañana como *New day report* (misma carpeta que el día, el título con la forma de los días
// del proyecto, la plantilla de la carpeta o *On-Set Report*) y prepararlo en el mismo paso, con las garantías de
// *Prepare*: solo agrega, no duplica (si mañana ya existe en la carpeta, prepara ese), *Undo* seguro (la página nueva va a
// la papelera solo si nadie la tocó, después de sincronizar) y sin red no crea (otro dispositivo pudo crearlo ya).

/** Cuántos días adelante se busca la próxima fecha con escenas en el desglose (un fin de semana, un franco). */
const LOOKAHEAD_DAYS = 7;

const pad = (n: number) => String(n).padStart(2, '0');

/** `AAAA-MM-DD` + `n` días, en el calendario (sin horas ni husos). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Las fechas de rodaje del desglose (las fichas y la página de cada escena), como `planOf`. */
function breakdownDates(src: LiveSource): Set<string> {
  const { snap } = src;
  const out = new Set<string>();
  for (const x of cardFields(snap, 'shootDate')) {
    const d = fieldDate(x.field.text);
    if (d) out.add(d);
  }
  for (const { pageId, field } of findFields(snap, 'shootDate')) {
    const role = snap.registration.roles.get(pageId);
    if (role?.entity?.kind !== 'scene' || role.excluded) continue;
    const d = fieldDate(field.text);
    if (d) out.add(d);
  }
  return out;
}

export interface TomorrowProposal {
  /** La fecha de mañana: la próxima con escenas en el desglose dentro de una semana, o el día siguiente. */
  date: string;
  /** El plan de esa fecha (del desglose: el reporte todavía no existe). */
  plan: DayPlan;
  /** La locación que dicen todas las fichas de esa fecha (D709), si dicen una sola y el registro la reconoce. */
  place: string | null;
}

/**
 * La locación del reporte de mañana, si el desglose la dice sin dudas (D709, la opción B de D631): todas las páginas con esa
 * *Fecha Rodaje* (las fichas y la página de la escena) tienen un campo de locación, cada uno nombra una locación del registro
 * y es la misma en todas. Una ficha sin lugar, un lugar que el registro no reconoce o dos lugares distintos: nada (mañana
 * puede ser otro lugar, y es mejor un título sin lugar que uno equivocado).
 */
export function plannedPlace(src: LiveSource, date: string): string | null {
  const { snap } = src;
  const pages = new Set<string>();
  for (const x of cardFields(snap, 'shootDate')) if (fieldDate(x.field.text) === date) pages.add(x.pageId);
  for (const { pageId, field } of findFields(snap, 'shootDate')) {
    const role = snap.registration.roles.get(pageId);
    if (role?.entity?.kind === 'scene' && !role.excluded && fieldDate(field.text) === date) pages.add(pageId);
  }
  let place: string | null = null;
  for (const id of pages) {
    const values = fieldValues(snap.fields.get(id), 'location').filter((f) => !emptyValue(f.text));
    if (!values.length) return null;
    for (const f of values) {
      const loc = locationOf(snap.registry, f.text);
      if (!loc || (place && loc !== place)) return null;
      place = loc;
    }
  }
  return place;
}

/**
 * Qué propone la tarjeta para un día sin día siguiente (D573): la próxima fecha con escenas en el desglose dentro de
 * `LOOKAHEAD_DAYS` (en ERSO, del jueves 2 al sábado 4), o si no, el día siguiente; y su plan. Sin fecha en el título del
 * día, nada (no se sabe qué es mañana).
 */
export function proposeTomorrow(src: LiveSource, day: DayRef): TomorrowProposal | null {
  if (!day.date || !isValidDate(day.date)) return null;
  const last = addDays(day.date, LOOKAHEAD_DAYS);
  const next = [...breakdownDates(src)].filter((d) => d > day.date! && d <= last).sort()[0];
  const date = next ?? addDays(day.date, 1);
  const plan = planOf(src, { pageId: '', label: '', date, loc: null, locs: [] });
  return { date, plan, place: plan.source === 'breakdown' ? plannedPlace(src, date) : null };
}

/**
 * El título del reporte de mañana con la forma del de hoy (D574): `2026-02-20 | Día 60` → `2026-02-21 | Día 61`, con la
 * misma palabra, el mismo separador y los mismos ceros. La locación de hoy no se copia: mañana puede ser otro lugar, y el
 * título es de donde la cabecera saca el lugar del día (D398). Solo si el título de hoy lleva un lugar (la forma del
 * proyecto: `2026-04-06 | Día 81 | Farmacia Fanfarria`) y el desglose dice uno solo para mañana (`place`, D709), va el de
 * mañana. Sin esa forma, el de *New day report*.
 */
export function nextDayTitle(today: string, date: string, day: number, lang: string, place?: string | null): string {
  const m = /^\s*\d{4}-\d{2}-\d{2}(\s*\|\s*)((?:day|d[ií]a)\s*)(\d+)/iu.exec(today);
  if (!m) return reportTitle(date, day, lang);
  const base = `${date}${m[1]}${m[2]}${String(day).padStart(m[3].length, '0')}`;
  const hasPlace = /^\s*\|\s*\S/u.test(today.slice(m[0].length));
  return place?.trim() && hasPlace ? `${base}${m[1]}${place.trim()}` : base;
}

/** El número de día de mañana: el de hoy + 1, o el que propondría *New day report*. */
export function nextDayNumber(todayTitle: string, fallback: number): number {
  const n = dayInTitle(todayTitle);
  return n ? n + 1 : fallback;
}

export interface TomorrowDeps extends DayReportDeps {
  docs: DayReportDeps['docs'] & PrepareDeps['docs'];
  engine: DayReportDeps['engine'] & { syncNow(): Promise<void>; getStatus(): { online: boolean; lastSyncAt: number | null } };
}

export interface TomorrowInput {
  projectId: string;
  /** La carpeta del día de hoy (`null`: la raíz del proyecto). */
  parentId: string | null;
  /** El título del día de hoy (para la forma del de mañana). */
  todayTitle: string;
  /** La locación que dice el desglose para mañana (`plannedPlace`, D709), si hay una. */
  place?: string | null;
  date: string;
  lang: string;
  prepare: PrepareOptions;
}

export type TomorrowResult =
  | {
      status: 'ok';
      /** `false`: ya había un reporte con esa fecha en la carpeta (otro toque, otro dispositivo antes): se preparó ese. */
      created: boolean;
      pageId: string;
      title: string;
      prepared: PrepareResult;
      /** El contenido recién escrito, para que *Undo* sepa si alguien lo tocó. */
      signature: string | null;
      /**
       * Se creó acá pero alguien ya había escrito en la página antes de la plantilla (un tercero que la abrió en sus primeros
       * segundos): se le agregaron solo las secciones, y *Undo* saca solo esas, como el de *Prepare* (D635).
       */
      joined?: true;
      /**
       * Otros reportes con la misma fecha en la carpeta que aparecieron al subir el nuevo: otro dispositivo creó el mismo
       * día a la vez (D580). Quedan los dos (nada se borra solo) y *Map › Pending* los lista.
       */
      twins: string[];
    }
  /**
   * `elsewhere`: la carpeta ya tiene el reporte de esa fecha, recién creado en otro dispositivo y sin su contenido todavía
   * (`isArriving`): ese dispositivo lo prepara; prepararlo acá repetiría las secciones (B2 de la auditoría de E11, D579).
   */
  | { status: 'elsewhere'; pageId: string; title: string }
  /**
   * `yielded`: este dispositivo y otro crearon el mismo día a la vez; este, el de id mayor, abandonó su página todavía
   * vacía (a la papelera) y queda la del otro, que la prepara (D580).
   */
  | { status: 'yielded'; pageId: string; title: string; trashed: string }
  | { status: 'offline' | 'cantCreate' };

/** La página no tiene nada en este dispositivo (ni lo propio ni lo que bajó de otro). */
async function emptyHere(deps: Pick<TomorrowDeps, 'docs'>, pageId: string): Promise<boolean> {
  const { CONTENT_FRAGMENT } = await import('../sync/structure');
  const doc = await deps.docs.open(pageId);
  try {
    return doc.getXmlFragment(CONTENT_FRAGMENT).length === 0;
  } finally {
    deps.docs.close(pageId);
  }
}

/**
 * Después de crear con `twins` (D627): espera un poco a que los de id mayor cedan (lo hacen solos apenas ven este) y
 * devuelve los que siguen vivos. Así el aviso de «quedaron dos» sale solo si de verdad quedaron dos.
 */
export async function twinsLeft(
  deps: Pick<TomorrowDeps, 'tree' | 'engine'>,
  pageId: string,
  twins: string[],
  { tries = 4, gapMs = 2500 }: { tries?: number; gapMs?: number } = {},
): Promise<string[]> {
  const { freshSync } = await import('./createEntity');
  const alive = () => twins.filter((id) => deps.tree.get(id) && !deps.tree.isTrashed(id));
  // Uno de id menor no cede: queda seguro (este no cedió porque alguien ya escribió en el suyo).
  if (alive().some((id) => id < pageId)) return alive();
  for (let i = 0; i < tries && alive().length; i++) {
    await new Promise((r) => setTimeout(r, gapMs));
    await freshSync(deps.engine, 4000).catch(() => false);
  }
  return alive();
}

/** Lo que está corriendo, por carpeta y fecha: dos toques seguidos dan un solo reporte (D575). */
const inFlight = new Map<string, Promise<TomorrowResult>>();
const creatingListeners = new Set<() => void>();
let creatingVersion = 0;
const creatingChanged = () => {
  creatingVersion++;
  for (const fn of creatingListeners) fn();
};

/** La clave de lo que se está creando: proyecto, carpeta y fecha. */
export const creatingKey = (projectId: string, parentId: string | null, date: string) => `${projectId}|${parentId ?? ''}|${date}`;

/**
 * Si este dispositivo está creando ese reporte ahora (D629): apenas sube la fila, la tarjeta del día pasa a ser la de
 * siempre y tiene que seguir diciendo que se está creando (y no ofrecer *Prepare* a mitad de camino).
 */
export function isCreating(key: string): boolean {
  return inFlight.has(key);
}

/** Para `useSyncExternalStore`: avisa cuando empieza o termina una creación. */
export function subscribeCreating(fn: () => void): () => void {
  creatingListeners.add(fn);
  return () => creatingListeners.delete(fn);
}
export const creatingSnapshot = () => creatingVersion;

/** Los reportes de esa fecha que están en la carpeta (no en la papelera), en el orden de la carpeta. */
export function reportsOnDate(tree: Pick<PageTree, 'children' | 'roots' | 'isTrashed'>, parentId: string | null, projectId: string, date: string): string[] {
  const rows = parentId ? tree.children(parentId) : tree.roots(projectId);
  return rows.filter((p) => !tree.isTrashed(p.id) && dateAtStart(p.title) === date).map((p) => p.id);
}

/** El primer reporte de esa fecha en la carpeta, si hay. */
export function reportOnDate(tree: Pick<PageTree, 'children' | 'roots' | 'isTrashed'>, parentId: string | null, projectId: string, date: string): string | null {
  return reportsOnDate(tree, parentId, projectId, date)[0] ?? null;
}

/**
 * Crea el reporte de mañana y lo prepara (D575, corregida por D579 y D580):
 * 1. lo que se lee del dispositivo (la carpeta, la plantilla, lo de ayer) va antes de sincronizar, para que entre mirar
 *    y crear pase lo menos posible;
 * 2. una sincronización buena en el momento (sin ella, `offline`: otro dispositivo pudo crearlo);
 * 3. si la carpeta ya tiene un reporte con esa fecha: si está llegando de otro dispositivo (la fila sí, el contenido no),
 *    no se toca (`elsewhere`: ese lo prepara); si no, se prepara ese;
 * 4. si no, la fila con la marca de día explícita (sin tocar la marca de la carpeta) y se sube enseguida, sola: desde
 *    ahí otro dispositivo ya la ve y no crea otra; lo que aparezca con la misma fecha al subirla se avisa (`twins`);
 * 5. la plantilla de *New day report* y las secciones de las escenas se escriben de una vez (un solo guardado, una sola
 *    subida): otro dispositivo nunca ve la plantilla sin las secciones y las agrega de nuevo.
 * `canCreate` se vuelve a mirar después de sincronizar.
 */
export function createTomorrow(deps: TomorrowDeps, input: TomorrowInput, canCreate: () => boolean): Promise<TomorrowResult> {
  const key = creatingKey(input.projectId, input.parentId, input.date);
  const running = inFlight.get(key);
  if (running) return running;
  const job = (async (): Promise<TomorrowResult> => {
    const { freshSync } = await import('./createEntity');
    const { isArriving, prepareReport, sectionBlocks } = await import('./prepareDay');
    const { pageSignature } = await import('./createWrite');
    const { planDayReport, placeBefore, reportBlocks, writeNewPage } = await import('../templates/dayReportCreate');
    // 1. Lo local, antes.
    const plan = await planDayReport(deps, { parentId: input.parentId, projectId: input.projectId });
    const day = nextDayNumber(input.todayTitle, plan.suggestion.day);
    const title = nextDayTitle(input.todayTitle, input.date, day, input.lang, input.place);
    const template = plan.template;
    // 2. Sincronizar. Si el motor ya sabe que no hay red, el tope es corto (1,5 s y no 6): se dice antes (observación de la
    //    auditoría de E11); si la red volvió, esa sincronización igual alcanza.
    const known = deps.engine.getStatus().online;
    if (!(await freshSync(deps.engine, known ? 6000 : 1500).catch(() => false))) return { status: 'offline' };
    // 3. Ya existe.
    const existing = reportOnDate(deps.tree, input.parentId, input.projectId, input.date);
    if (existing) {
      const existingTitle = deps.tree.get(existing)?.title ?? '';
      // Recién creado en otro dispositivo y su contenido todavía no llegó: ese lo prepara (D579).
      if (await isArriving(deps, existing)) return { status: 'elsewhere', pageId: existing, title: existingTitle };
      const prepared = await prepareReport(deps, existing, input.prepare);
      return { status: 'ok', created: false, pageId: existing, title: existingTitle, prepared, signature: null, twins: [] };
    }
    if (!canCreate()) return { status: 'cantCreate' };
    // 4. La fila, sola, y arriba ya.
    const pageId = await deps.tree.create(input.parentId, title, input.projectId, { templateId: template?.id ?? BUILTIN_ONSET, before: placeBefore(plan, input.date) });
    await deps.tree.setSetting(pageId, 'entity', { kind: 'day' });
    await freshSync(deps.engine, 4000).catch(() => false);
    // Una lectura más, empezada después de subir la fila: un reporte del mismo día que otro dispositivo subió antes que el
    // nuestro ya se ve (la base pone la hora de cada fila al insertarla).
    await freshSync(deps.engine, 4000).catch(() => false);
    const twins = reportsOnDate(deps.tree, input.parentId, input.projectId, input.date).filter((id) => id !== pageId);
    // Dos dispositivos crearon el mismo día a la vez (D580): cede el de id mayor, solo si su página sigue vacía: nada en
    // el servidor después de la última sincronización (`update_seq`) ni en este dispositivo (un tercero que la abrió y
    // escribió y ya bajó acá). El de id menor nunca cede, así que siempre queda uno; si ninguno vio al otro, quedan los
    // dos (avisados y en *Map › Pending*). Lo que un tercero escriba y llegue después de esta mirada no se pierde ni se
    // esconde: la copia va con su marca y vuelve de la papelera sola (`cededCopy.ts`, D626).
    const smaller = twins.filter((id) => id < pageId);
    if (smaller.length && (deps.tree.get(pageId)?.update_seq ?? 0) === 0 && (await emptyHere(deps, pageId))) {
      const { cedeCopy } = await import('./cededCopy');
      await cedeCopy(deps.tree, pageId, smaller[0]);
      void deps.engine.syncNow().catch(() => undefined);
      return { status: 'yielded', pageId: smaller[0], title: deps.tree.get(smaller[0])?.title ?? title, trashed: pageId };
    }
    // Alguien ya escribió en la página nueva (un tercero que la abrió en sus primeros segundos, y por eso no cedió):
    // `writeNewPage` no escribe en una página con algo. Se le agregan solo las secciones, como *Prepare* (D626).
    if (!(await emptyHere(deps, pageId))) {
      const prepared = await prepareReport(deps, pageId, input.prepare);
      void deps.engine.syncNow().catch(() => undefined);
      return { status: 'ok', created: true, pageId, title, prepared, signature: null, twins, joined: true };
    }
    // 5. La plantilla y las secciones, de una vez.
    const scenes = input.prepare.scenes.filter((x, i, all) => all.findIndex((y) => y.code === x.code) === i);
    const added = scenes.map((x) => ({ code: x.code, headingId: crypto.randomUUID(), paragraphId: crypto.randomUUID(), text: `${input.prepare.word} ${x.code}` }));
    const blocks = [
      ...reportBlocks(plan, { date: input.date, day, location: plan.facts?.location ?? '' }, input.lang, template),
      ...scenes.flatMap((x, i) => sectionBlocks(x, input.prepare.word, input.prepare.level, { heading: added[i].headingId, paragraph: added[i].paragraphId })),
    ];
    await writeNewPage(deps.docs, pageId, blocks, template?.collapsed ?? [], template?.markup ?? []);
    const prepared: PrepareResult = { status: 'ok', added, skipped: [], merged: 0, origin: { client: 0, clock: 0 } };
    const signature = await pageSignature(deps.docs, pageId).catch(() => null);
    void deps.engine.syncNow().catch(() => undefined);
    return { status: 'ok', created: true, pageId, title, prepared, signature, twins };
  })().finally(() => {
    inFlight.delete(key);
    creatingChanged();
  });
  inFlight.set(key, job);
  creatingChanged();
  return job;
}

/**
 * *Undo* (D576). Si se creó: después de sincronizar, la página va a la papelera solo si sigue como quedó (mismo título,
 * lugar y contenido, sin páginas adentro); si alguien la tocó, queda. Si ya existía, se deshace solo lo que agregó
 * *Prepare* (`undoPrepared`, con sus garantías).
 */
export async function undoTomorrow(
  deps: TomorrowDeps,
  res: Extract<TomorrowResult, { status: 'ok' }>,
  parentId: string | null,
  linkTarget: PrepareOptions['linkTarget'],
): Promise<{ kind: 'trashed' | 'changed' | 'gone' | 'offline' } | { kind: 'prepared'; removed: number; kept: number }> {
  const { freshSync, undoCreate } = await import('./createEntity');
  if (!res.created || res.joined) {
    if (res.prepared.status !== 'ok' || !res.prepared.added.length) return { kind: 'changed' };
    const { undoPrepared } = await import('./prepareDay');
    const u = await undoPrepared(deps, res.pageId, res.prepared, linkTarget);
    if (!u || (u.unexpected && !u.removed)) return { kind: 'changed' };
    return { kind: 'prepared', removed: u.removed, kept: u.kept };
  }
  const { pageSignature } = await import('./createWrite');
  const kind = await undoCreate(
    deps.tree,
    { pageId: res.pageId, parentId: parentId as string, title: res.title },
    async () => res.signature !== null && (await pageSignature(deps.docs, res.pageId)) === res.signature,
    () => freshSync(deps.engine),
  );
  return { kind };
}
