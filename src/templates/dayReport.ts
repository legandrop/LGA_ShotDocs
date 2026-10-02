import type { PageTree } from '../sync/tree';
import type { PageRow } from '../sync/types';
import { modPressed } from '../ui/findUi';
import { IS_MAC } from '../ui/shortcuts';
import { BUILTIN_ONSET } from './builtinIds';

// El reporte del día (Docs/Doc_Plantillas.md, sección 6): lo que va en la primera carga (el botón está arriba del título
// y el menú de la página lo ofrece): la fecha local, el nombre de la página, cuál es la carpeta de reportes y el atajo.
// Leer y llenar la ficha por sus rótulos está en `dayReportFacts.ts`, y leer el reporte anterior y escribir el nuevo en
// `dayReportCreate.ts`: se bajan con el globito.

// --- Fechas y nombres ----------------------------------------------------------------------------------------------

const pad = (n: number, size = 2) => String(n).padStart(size, '0');

/**
 * La fecha de hoy con la hora local del dispositivo (PL6): a las 23:30 en Buenos Aires sigue siendo hoy aunque en UTC ya
 * sea mañana. `AAAA-MM-DD`.
 */
export function localDate(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** `AAAA-MM-DD` que existe en el calendario (nada de 2026-02-30). */
export function isValidDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d, 12);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
}

/** La fecha `AAAA-MM-DD` con que empieza un texto (el título `2026-10-02 | Day 06`, o la fila *Date*), o `null`. */
export function dateAtStart(text: string | null | undefined): string | null {
  const m = /^\s*(\d{4}-\d{2}-\d{2})(?!\d)/.exec(text ?? '');
  return m && isValidDate(m[1]) ? m[1] : null;
}

/** El número de día de un título (`… | Day 06`, `… | Día 6`), o `null`. */
export function dayInTitle(title: string | null | undefined): number | null {
  const m = /(?:^|[\s|·])(?:day|d[ií]a)\s*0*(\d{1,4})(?!\d)/i.exec(title ?? '');
  const day = m ? Number(m[1]) : NaN;
  return Number.isInteger(day) && day > 0 ? day : null;
}

/** El primer número entero positivo de un texto (la fila *Shoot day*: `6`, `Day 6`), o `null`. */
export function firstNumber(text: string | null | undefined): number | null {
  const m = /\d{1,4}/.exec(text ?? '');
  const n = m ? Number(m[0]) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** `Day 06` / `Día 06`. */
export function dayName(day: number, lang: string): string {
  return `${lang === 'es' ? 'Día' : 'Day'} ${pad(day)}`;
}

/** El título del reporte (PL7): `2026-10-02 | Day 06`. La fecha es el código del "|" (D-10): ordena y se busca igual. */
export function reportTitle(date: string, day: number, lang: string): string {
  return `${date} | ${dayName(day, lang)}`;
}

/** Lo que va en la fila *Date*: `2026-10-02 · Thu` (`2026-10-02 · jue`), el día de la semana en el idioma del contenido. */
export function dateWithWeekday(date: string, lang: string): string {
  if (!isValidDate(date)) return date;
  const [y, m, d] = date.split('-').map(Number);
  let weekday = '';
  try {
    weekday = new Intl.DateTimeFormat(lang === 'es' ? 'es' : 'en', { weekday: 'short' }).format(new Date(y, m - 1, d, 12));
  } catch {
    // Sin Intl: solo la fecha.
  }
  return weekday ? `${date} · ${weekday.replace(/\.$/, '')}` : date;
}

// --- La carpeta de reportes (6.2) ------------------------------------------------------------------------------------

/** La marca de la página: `on` (marcada), `off` (se dejó de usar a mano) o `null` (sin marca). */
export function dayReportsMark(row: PageRow | undefined): 'on' | 'off' | null {
  const value: unknown = row?.settings?.dayReports;
  if (value === false) return 'off';
  if (value && typeof value === 'object' && !Array.isArray(value)) return 'on';
  return null;
}

/**
 * Una página que es un reporte del día: salió de *On-Set Report* y su título empieza con una fecha (lo que pone
 * *New day report*, o la tira al crear el primero). Una página a la que se le deshizo la plantilla conserva el
 * `template_id` (entrega 1), pero no tiene la fecha en el título: no cuenta.
 */
export function isReportPage(row: PageRow): boolean {
  return row.template_id === BUILTIN_ONSET && dateAtStart(row.title) !== null;
}

/** Un título con la forma exacta de `reportTitle`: `2026-10-02 | Day 06` o `2026-10-02 | Día 06`, nada más. */
export function hasReportTitle(title: string): boolean {
  const m = /^(\d{4}-\d{2}-\d{2}) \| (?:Day|Día) \d{2,4}$/.exec(title);
  return !!m && isValidDate(m[1]);
}

/**
 * Una página que el reporte del día puede reusar si está vacía (auditoría, O2 y O4; re-verificación, B1): un reporte
 * que salió de *On-Set Report*, con el título exacto que pone la app y sin subpáginas (ni en la papelera). Una página de
 * la persona con fecha en el título ("2026-10-04 Fotos de set", una carpeta) nunca: se le pisaría el nombre.
 */
export function isReusableReport(tree: PageTree, id: string): boolean {
  const row = tree.get(id);
  if (!row || tree.isTrashed(id) || !isReportPage(row) || !hasReportTitle(row.title)) return false;
  if (tree.children(id).length > 0) return false;
  return !tree.trashed(row.workspace_id).some((p) => p.parent_id === id);
}

/**
 * La página es una carpeta de reportes: marcada, o (si la marca se perdió por dos cambios de ajustes a la vez, sección 8)
 * con algún reporte adentro. *Stop using for day reports* (`false`) gana sobre lo deducido.
 */
export function isDayReportFolder(tree: PageTree, id: string): boolean {
  const row = tree.get(id);
  if (!row || tree.isTrashed(id)) return false;
  const mark = dayReportsMark(row);
  if (mark) return mark === 'on';
  return tree.children(id).some(isReportPage);
}

/** La carpeta de reportes de la página: ella misma, o la de arriba si es una (cada reporte tiene el botón), o `null`. */
export function dayReportFolderOf(tree: PageTree, pageId: string): string | null {
  if (isDayReportFolder(tree, pageId)) return pageId;
  const parent = tree.get(pageId)?.parent_id;
  return parent && isDayReportFolder(tree, parent) ? parent : null;
}

// --- El atajo (sección 9) --------------------------------------------------------------------------------------------

/**
 * Ctrl+Alt+Shift+N (⌘⌥⇧N en la Mac: nunca Ctrl en la Mac). Con AltGr (en Windows llega como Ctrl+Alt) no: en algunos
 * teclados escribe un carácter (en el polaco, AltGr+N es ń). Con ⌥ la tecla escribe otra cosa en la Mac: se mira
 * también la posición (`code`). Descartados ⌘⌥D (esconde el Dock) y ⌘⌥N (*Open split view* de Chrome en la Mac).
 */
export function isDayReportShortcut(
  e: {
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    code: string;
    key: string;
    getModifierState?: (key: string) => boolean;
  },
  mac = IS_MAC,
): boolean {
  if (e.getModifierState?.('AltGraph')) return false;
  return modPressed(e, mac) && e.altKey && e.shiftKey && (e.code === 'KeyN' || e.key.toLowerCase() === 'n');
}
