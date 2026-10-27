import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useLinkMode } from '../linkMode';
import { readPlanTitle } from '../relations/planDay';
import { scan, type Registry } from '../relations/reader';
import { useServices } from '../services';
import { useCurrentProject } from './project';
import { existingRelationsSession } from './relationsUi';

// La fila de la barra lateral de un día de rodaje, un scouting, una prueba o un plan (D789): las tres familias con fecha
// se ven igual, como en el *Overview*. A la izquierda, la jornada (`D05`, primero: D792) y la fecha corta (DD/MM, en el color de los días); después el
// lugar (azul si la app lo reconoce como locación) y lo que quede del título, apagado. Solo lee el título: un título sin
// una fecha clara (dos fechas, ninguna, una que se lee de dos formas) se ve como siempre.

export interface DatedTitle {
  /** `05/11`. */
  date: string;
  /** El año, si la fecha lo tiene; `null` en una fecha sin año. */
  year: number | null;
  /** `D05`, o `null` sin jornada. */
  jornada: string | null;
  /**
   * El lugar: la última parte que la app reconoce como locación o, si ninguna, la última que no es un día de la semana ni
   * una unidad (D792); `null` si no queda ninguna.
   */
  place: string | null;
  /** Lo demás del título (`Scouting técnico VFX`, `Sin reporte`), o `null`. */
  note: string | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

// La jornada sola (`Día 05`, `D37`, `Day 6`).
const JORNADA = /(?:^|[\s_])(?:d[ií]a|day|d)\s*0*(\d{1,3})(?![\d.])/gi;
const ONLY_JORNADA = /^(?:d[ií]a|day|d)\s*0*(\d{1,3})$/i;
// Las fechas como las escribe Lega: `2025-11-05`, `26.01.18`, `260106`, `05.11`.
const DATES = /\d{4}-\d{2}-\d{2}|\d{2}[._ ]\d{2}[._ ]\d{2}|\d{6}|\d{1,2}\.\d{1,2}/g;
// Una parte que es solo el día de la semana (`Lun`, `Mier`, `Sábado`) o la unidad (`U2`): va a la nota, nunca es el lugar
// (`D02 | 26.03.24 | Autos Juan de Garay | Mar` → el lugar es «Autos Juan de Garay», D792).
const WEEKDAY =
  /^(?:lu(?:n(?:es)?)?|ma(?:r(?:t(?:es)?)?)?|mi(?:e(?:r(?:c(?:oles)?)?)?)?|ju(?:e(?:v(?:es)?)?)?|vi(?:e(?:r(?:nes)?)?)?|s[aá](?:b(?:ado)?)?|do(?:m(?:ingo)?)?|mon|tue|wed|thu|fri|sat|sun|u\d{1,2})\.?$/i;
const isWeekday = (part: string) => WEEKDAY.test(part.normalize('NFD').replace(/\p{M}/gu, ''));
/** Una parte que solo tiene la fecha y, a lo sumo, la jornada (`2025-11-05`, `D37 26.01.18`, `D03_26.03.25`). */
const onlyDate = (part: string) => /^[\s_]*$/.test(part.replace(JORNADA, ' ').replace(DATES, ' '));

/**
 * El título dividido para la fila con fecha, o `null` si no tiene una sola fecha clara en una parte propia. `isLoc` elige
 * el lugar entre lo que queda (`… | Casa | Interior | Noche` → «Casa» si es la locación).
 */
export function datedTitle(title: string, isLoc: (text: string) => boolean = () => false): DatedTitle | null {
  const read = readPlanTitle(title);
  if (read.dates.length !== 1 || read.dates[0].length !== 1) return null;
  const { y, m, d } = read.dates[0][0];
  const parts = title.split('|').map((p) => p.trim()).filter(Boolean);
  const first = parts.findIndex((p) => readPlanTitle(p).dates.length > 0);
  // La fecha tiene que estar en una parte propia (con su jornada, a lo sumo): `Notas del 05.11 | …` no es una fila de día.
  if (first < 0 || !onlyDate(parts[first])) return null;
  // La jornada, de la parte de la fecha o de una parte que es solo la jornada; nunca del lugar (`Galpón D3`).
  const own = (p: string) => readPlanTitle(p).jornada ?? (ONLY_JORNADA.exec(p) ? Number(ONLY_JORNADA.exec(p)![1]) : null);
  let jornada = own(parts[first]);
  const rest: string[] = [];
  parts.forEach((p, i) => {
    if (i === first) return;
    if (ONLY_JORNADA.test(p)) {
      jornada ??= own(p);
      return;
    }
    rest.push(p);
  });
  let at = -1;
  // Un día de la semana nunca es el lugar, aunque una locación se llame así.
  for (let i = rest.length - 1; i >= 0 && at < 0; i--) if (!isWeekday(rest[i]) && isLoc(rest[i])) at = i;
  for (let i = rest.length - 1; i >= 0 && at < 0; i--) if (!isWeekday(rest[i])) at = i;
  return {
    date: `${pad(d)}/${pad(m)}`,
    year: y,
    jornada: jornada !== null ? `D${pad(jornada)}` : null,
    place: at >= 0 ? rest[at] : null,
    note: rest.some((_, i) => i !== at) ? rest.filter((_, i) => i !== at).join(' · ') : null,
  };
}

const noSubscribe = () => () => {};
const none = () => '';

/**
 * Si un texto nombra una locación del proyecto (con las reglas del título de un día: alias y genéricos, D398 y D417).
 * Antes de que las relaciones tengan su primera foto, nada es locación: la fila va sin color, nunca con uno equivocado.
 * Se entera solo cuando cambian las locaciones (la firma del registro), no en cada pasada de las relaciones: así la
 * barra lateral no se vuelve a dibujar entera mientras alguien escribe.
 */
export function useLocMatcher(): (text: string) => boolean {
  const services = useServices();
  const link = useLinkMode();
  const projectId = useCurrentProject();
  const relations = link ? null : (existingRelationsSession(services)?.relations ?? null);
  const registry = useCallback((): Registry | null => relations?.snapshot(projectId)?.registry ?? null, [relations, projectId]);
  const signature = useSyncExternalStore(
    relations ? relations.subscribe : noSubscribe,
    relations ? () => registry()?.signature ?? '' : none,
  );
  return useMemo(() => {
    const R = registry();
    if (!R) return () => false;
    const seen = new Map<string, boolean>();
    return (text: string) => {
      let hit = seen.get(text);
      if (hit === undefined) {
        hit = scan(R, text, { heading: true, dayTitle: true }).some((h) => h.kind === 'loc' && !h.hidden);
        seen.set(text, hit);
      }
      return hit;
    };
  }, [signature, registry]); // eslint-disable-line react-hooks/exhaustive-deps
}
