import { dateAtStart, dayInTitle } from '../templates/dayReport';
import { fieldDate, fieldValues } from './fields';
import type { LiveSource } from './liveView';
import type { RelationSnapshot } from './relationIndex';

// Plan → día (Docs/Plan_Estructura_Etapas.md, sección 5, decisión 4). Un plan de jornada es un documento (`entity` o
// `holds` = 'plan') que vive donde lo ponga cada uno (`4 | Planeamiento › Semana 03`); su día sale, en orden:
//
// 1. El puntero de la página (`settings.entity.day`, lo escribe el reacomodo de un plan que estaba adentro de su día).
// 2. El campo *Día* con un link a la página del día.
// 3. La fecha y la jornada del título o de sus campos *Fecha* y *Día* (`D03_26.03.25_Palomar`, `D03 25.11.03 | …`):
//    se conecta si las dos apuntan al mismo día, o si hay una sola y apunta a un día único; dos días con la misma
//    fecha (U1/U2) los desempata la unidad del título. Si se contradicen o empatan, no se conecta: *Pending*.
//
// Un plan adentro de su día sigue siendo de ese día («parte de», como siempre) y no pasa por acá. Una subpágina de un
// plan es del día de su plan. Un plan con varias fechas («Plaza de Mayo | 21 Mar | 2,3,4,11 Abr») es de su locación:
// no se pega a ningún día ni va a *Pending*. Una página sin fecha, vacía y con planes adentro (`Semana 03`) es un grupo.

export type PlanWhy = 'pointer' | 'field' | 'match' | 'conflict' | 'tie' | 'several' | 'noDay' | 'none' | 'group';

export interface PlanLink {
  /** El día del plan, o `null`. */
  dayId: string | null;
  /** La fecha del plan (`2026-03-25`) si la sabe entera, aunque no haya día todavía. */
  date: string | null;
  why: PlanWhy;
  /** Los días que podrían ser (con `conflict` o `tie`). */
  candidates: string[];
}

/** Lo que dice el título de un plan: fechas posibles, jornada y unidad. */
export interface PlanTitle {
  /** Cada fecha escrita, con sus lecturas posibles (`03.11` es 3 de noviembre o 11 de marzo); `y` nulo si no la dice. */
  dates: { y: number | null; m: number; d: number }[][];
  jornada: number | null;
  unit: string | null;
}

// Solo la palabra entera (abreviatura o nombre), y seguida de un corte (`21 Mar |`, `27 Abr`): «sets», «decorados» o
// «Ruta 2 Mar del Plata» no son meses.
const MONTHS: Record<string, number> = {
  ene: 1, enero: 1, jan: 1, january: 1, feb: 2, febrero: 2, february: 2, mar: 3, marzo: 3, march: 3, abr: 4, abril: 4, apr: 4, april: 4,
  may: 5, mayo: 5, jun: 6, junio: 6, june: 6, jul: 7, julio: 7, july: 7, ago: 8, agosto: 8, aug: 8, august: 8, sep: 9, sept: 9,
  septiembre: 9, setiembre: 9, september: 9, oct: 10, octubre: 10, october: 10, nov: 11, noviembre: 11, november: 11, dic: 12,
  diciembre: 12, dec: 12, december: 12,
};
// Un año de dos cifras se lee solo si es razonable (2020 a 2039): `03.11.25` no es 2003.
const plausible = (yy: number) => yy >= 20 && yy <= 39;

const real = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return m >= 1 && m <= 12 && d >= 1 && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
const yearless = (m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= (m === 2 ? 29 : [4, 6, 9, 11].includes(m) ? 30 : 31);
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Lee las fechas, la jornada y la unidad de un título de plan, como los escribe Lega en Coda. */
export function readPlanTitle(title: string): PlanTitle {
  const text = ` ${title.replace(/_/g, ' ')} `;
  const dates: PlanTitle['dates'] = [];
  const taken: [number, number][] = [];
  const free = (s: number, e: number) => !taken.some(([a, b]) => s < b && e > a);
  const add = (s: number, e: number, readings: { y: number | null; m: number; d: number }[]) => {
    taken.push([s, e]);
    if (readings.length) dates.push(readings);
  };
  for (const m of text.matchAll(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g)) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    add(m.index, m.index + m[0].length, real(y, mo, d) ? [{ y, m: mo, d }] : []);
  }
  for (const m of text.matchAll(/(?<![\d.])(\d{2})\.(\d{2})\.(\d{2})(?![\d.])/g)) {
    if (!free(m.index, m.index + m[0].length)) continue;
    const [y, mo, d] = [2000 + +m[1], +m[2], +m[3]];
    // Año, mes y día (`26.03.25`), como escribe Lega; una fecha que no existe no se lee al revés.
    add(m.index, m.index + m[0].length, plausible(+m[1]) && real(y, mo, d) ? [{ y, m: mo, d }] : []);
  }
  for (const m of text.matchAll(/(?<![\d.])(\d{2})(\d{2})(\d{2})(?![\d.])/g)) {
    if (!free(m.index, m.index + m[0].length)) continue;
    const [y, mo, d] = [2000 + +m[1], +m[2], +m[3]];
    add(m.index, m.index + m[0].length, plausible(+m[1]) && real(y, mo, d) ? [{ y, m: mo, d }] : []);
  }
  // Después de una palabra (`Llamado 9.30`, `Cámara 1.2`, `v1.2`) es una hora o una versión, no una fecha.
  for (const m of text.matchAll(/(?<![\p{L}\d.])(?<!\p{L}{2,}\s)(\d{1,2})\.(\d{1,2})(?![\d.])/gu)) {
    if (!free(m.index, m.index + m[0].length)) continue;
    const [a, b] = [+m[1], +m[2]];
    // ERSO mezcla día y mes (`05.11`) con mes y día (`11.26`): las dos lecturas que existen, y desempata la jornada.
    const r: { y: null; m: number; d: number }[] = [];
    if (yearless(b, a)) r.push({ y: null, m: b, d: a });
    if (a !== b && yearless(a, b)) r.push({ y: null, m: a, d: b });
    add(m.index, m.index + m[0].length, r);
  }
  for (const m of text.matchAll(/(?<![\p{L}\d])((?:\d{1,2}\s*,\s*)*\d{1,2})\s+([a-záé]{3,10})\.?(?![\p{L}])(?=\s*(?:$|[|·,;/()\-]|\d))/giu)) {
    const month = MONTHS[m[2].toLowerCase()];
    if (!month || !free(m.index, m.index + m[0].length)) continue;
    taken.push([m.index, m.index + m[0].length]);
    for (const n of m[1].split(',')) if (yearless(month, +n)) dates.push([{ y: null, m: month, d: +n }]);
  }
  const j = /(?:^|[\s|·])(?:d|d[ií]a|day)\s*0*(\d{1,3})(?![\d.])/i.exec(text);
  const unit = /(?:^|[\s|·.])(?:u|unidad|unit)\s?(\d)(?!\d)/i.exec(text);
  // Con una fecha completa, lo que parece una fecha sin año es otra cosa (una hora, `Llamado 9.30`).
  const full = dates.filter((g) => g.some((r) => r.y !== null));
  return { dates: full.length ? full : dates, jornada: j ? Number(j[1]) : null, unit: unit ? unit[1] : null };
}

interface DayInfo {
  id: string;
  date: string | null;
  n: number | null;
  unit: string | null;
}

const memo = new WeakMap<RelationSnapshot, Map<string, PlanLink>>();

/** El día de cada plan del proyecto (los planes que no están adentro de un día), una vez por foto. */
export function planLinks(src: LiveSource): Map<string, PlanLink> {
  const known = memo.get(src.snap);
  if (known) return known;
  const { snap } = src;
  const roles = snap.registration.roles;
  const days: DayInfo[] = [];
  for (const [id, r] of roles) {
    if (r.excluded || r.entity?.kind !== 'day') continue;
    const t = src.title(id);
    if (t === undefined) continue;
    days.push({ id, date: dateAtStart(t), n: dayInTitle(t), unit: readPlanTitle(t).unit });
  }
  const isDay = new Set(days.map((d) => d.id));
  const children = new Map<string, string[]>();
  for (const [id, r] of roles) {
    if (!r.parent) continue;
    const list = children.get(r.parent);
    if (list) list.push(id);
    else children.set(r.parent, [id]);
  }
  const isPlan = (id: string) => {
    const r = roles.get(id);
    return !!r && !r.excluded && r.doc === 'plan' && r.partOf?.kind !== 'day' && src.title(id) !== undefined;
  };

  const out = new Map<string, PlanLink>();
  const resolve = (id: string): PlanLink => {
    const done = out.get(id);
    if (done) return done;
    out.set(id, { dayId: null, date: null, why: 'none', candidates: [] }); // un ciclo (no debería haber) corta acá
    const r = roles.get(id)!;
    const value = read(id, r.parent && isPlan(r.parent) ? resolve(r.parent) : null);
    out.set(id, value);
    return value;
  };

  const read = (id: string, parent: PlanLink | null): PlanLink => {
    const r = roles.get(id)!;
    const linked = (dayId: string, why: PlanWhy): PlanLink => ({ dayId, date: days.find((d) => d.id === dayId)?.date ?? null, why, candidates: [] });
    if (r.planDay && isDay.has(r.planDay)) return linked(r.planDay, 'pointer');
    const fields = snap.fields.get(id);
    const dayField = fieldValues(fields, ['dia', 'día', 'day', 'jornada', 'shoot day']);
    for (const f of dayField) for (const l of f.links) if (isDay.has(l.pageId)) return linked(l.pageId, 'field');
    const title = src.title(id) ?? '';
    const said = readPlanTitle(title);
    // Sus campos *Fecha* y *Día* valen como el título (la plantilla *Day plan* los trae); el campo *Día* da la jornada
    // solo si es un número («3», «Día 03»), no una fecha («Lunes 03/11»).
    const fieldDay = dayField.map((f) => /^\s*(?:d|d[ií]a|day)?\s*0*(\d{1,3})\s*$/i.exec(f.text)?.[1]).find(Boolean);
    const jornada = said.jornada ?? (fieldDay ? Number(fieldDay) : null);
    let dates = said.dates;
    if (!dates.length) {
      for (const f of fieldValues(fields, ['fecha', 'date', 'fecha rodaje', 'shoot date'])) {
        const d = fieldDate(f.text);
        if (d) dates = [[{ y: +d.slice(0, 4), m: +d.slice(5, 7), d: +d.slice(8, 10) }]];
        if (d) break;
      }
    }
    const full = dates.flat().find((g) => g.y !== null);
    // Una subpágina de un plan conectado, sin fecha completa ni jornada propias, es del día de su plan («Fotos 9.30»).
    // La de un plan sin día claro no repite su aviso en *Pending*.
    if (parent && parent.why !== 'group' && !full && jornada === null) {
      return parent.dayId || parent.why === 'noDay' ? { ...parent, candidates: [...parent.candidates] } : { dayId: null, date: null, why: 'none', candidates: [] };
    }
    if (dates.length > 1) return { dayId: null, date: null, why: 'several', candidates: [] };
    const rel = snap.pages.get(id);
    const empty = !rel || (rel.blocks === 0 && rel.media.length === 0);
    if (!dates.length && jornada === null) {
      const group = empty && (children.get(id) ?? []).some(isPlan);
      return { dayId: null, date: null, why: group ? 'group' : 'none', candidates: [] };
    }
    const readings = dates[0] ?? [];
    // La unidad: un día sin unidad es la principal (U1); un plan sin unidad va con cualquiera, y si empatan, con la
    // principal.
    const fits = (d: DayInfo) => !said.unit || (d.unit ?? '1') === said.unit;
    const byDate = readings.length ? days.filter((d) => fits(d) && d.date && readings.some((g) => (g.y === null ? d.date!.slice(5) === iso(2000, g.m, g.d).slice(5) : d.date === iso(g.y, g.m, g.d)))) : [];
    const byJ = jornada !== null ? days.filter((d) => fits(d) && d.n === jornada) : [];
    const knownDate = full ? iso(full.y!, full.m, full.d) : byDate.length === 1 ? byDate[0].date : null;
    const pick = (list: DayInfo[], why: PlanWhy): PlanLink => {
      const ids = [...new Set(list.map((d) => d.id))];
      if (ids.length === 1) return linked(ids[0], 'match');
      // Con unidad, la suya; sin unidad, la principal (un día sin unidad es la U1).
      const same = list.filter((d) => (d.unit ?? '1') === (said.unit ?? '1'));
      if (same.length === 1) return linked(same[0].id, 'match');
      return { dayId: null, date: knownDate, why, candidates: ids };
    };
    if (readings.length && jornada !== null) {
      const both = byDate.filter((d) => byJ.includes(d));
      if (both.length) return pick(both, 'tie');
      // La fecha da el día y la jornada no existe como día (`D00`, un día sin «Día NN»): vale la fecha.
      if (byDate.length && !byJ.length) return pick(byDate, 'tie');
      // Ninguna de las dos tiene día todavía: se planea antes de filmar.
      if (!byDate.length && !byJ.length) return { dayId: null, date: knownDate, why: 'noDay', candidates: [] };
      // La jornada tiene día y una fecha sin año no: lo de sin año puede ser otra cosa (`7.30`), vale la jornada.
      if (!byDate.length && !full) return pick(byJ, 'tie');
      // Se contradicen: la fecha dice un día y la jornada otro, o la jornada tiene día y la fecha completa no.
      return { dayId: null, date: knownDate, why: 'conflict', candidates: [...new Set([...byDate, ...byJ].map((d) => d.id))] };
    }
    const list = readings.length ? byDate : byJ;
    if (!list.length) return { dayId: null, date: knownDate, why: 'noDay', candidates: [] };
    return pick(list, 'tie');
  };

  for (const id of roles.keys()) if (isPlan(id)) resolve(id);
  memo.set(snap, out);
  return out;
}

/** Los planes (fuera de los días) de un día, o los de una fecha sin día todavía (`dayId` vacío). */
export function plansOfDay(src: LiveSource, dayId: string, date: string | null): string[] {
  const out: string[] = [];
  for (const [id, l] of planLinks(src)) {
    if (l.why === 'group') continue;
    if (dayId ? l.dayId === dayId : !!date && !l.dayId && l.date === date) out.push(id);
  }
  return out;
}

/** El día de un plan que no está adentro de un día, o `null`. */
export function planDayOf(src: LiveSource, pageId: string): string | null {
  return planLinks(src).get(pageId)?.dayId ?? null;
}

/**
 * Los planes que no se pudieron conectar con un día (para *Pending*): fecha y jornada que se contradicen o empatan. Una
 * página sin fecha ni jornada (unas notas, una semana con texto, una página nueva) no es un aviso.
 */
export function unlinkedPlans(src: LiveSource): { pageId: string; link: PlanLink }[] {
  return [...planLinks(src)].filter(([, l]) => l.why === 'conflict' || l.why === 'tie').map(([pageId, link]) => ({ pageId, link }));
}
