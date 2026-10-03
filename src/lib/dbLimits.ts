import { cutText } from './graphemes';

/**
 * Los topes de largo de la base (los `check` de `supabase/migrations`) que la app escribe en el árbol. La base cuenta
 * con `length()`, en caracteres de Postgres: puntos de código, no unidades UTF-16 de JS (un emoji son dos unidades y
 * un punto de código). Un cambio que pasa un tope lo rechaza la base para siempre: el *Retry* vuelve a fallar
 * (Docs/Doc_Sincronizacion.md, "Topes de largo").
 */
export const DB_LIMITS = {
  /** `pages.title` (`pages_title_check`). */
  pageTitle: 500,
  /** `pages.icon` (`pages_icon_check`). */
  pageIcon: 32,
  /** `pages.sort_key` (`pages_sort_key_length`). */
  pageSortKey: 128,
  /** `pages.settings::text` (`pages_settings_shape`). */
  pageSettings: 2000,
  /** `workspaces.name`, el nombre de un proyecto (`workspaces_name_length`). */
  projectName: 200,
} as const;

/** Cuántos puntos de código tiene el texto (lo que mide `length()` en la base). */
export function codePointLength(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

/**
 * Parte el texto en lo que entra en `max` puntos de código (`head`, sin partir un grafema: ni un emoji ni una bandera)
 * y lo que sobra (`rest`, vacío si entra entero). `head + rest` es siempre el texto original.
 */
export function splitAtLimit(text: string, max: number): { head: string; rest: string } {
  const head = cutText(text, max);
  return { head, rest: text.slice(head.length) };
}

/** Cuánto puede retroceder el corte de un título para no partir una palabra. */
const WORD_BACKOFF = 60;

/**
 * Parte un título en lo que entra en la base (`DB_LIMITS.pageTitle`) y lo que sobra. Si el corte cae en el medio de
 * una palabra, retrocede hasta el espacio anterior (si está cerca): la palabra entera pasa a lo que sobra.
 */
export function splitTitle(text: string): { head: string; rest: string } {
  const cut = splitAtLimit(text, DB_LIMITS.pageTitle);
  if (!cut.rest || /^\s/.test(cut.rest) || /\s$/.test(cut.head)) return cut;
  const space = /\s\S*$/.exec(cut.head);
  if (!space || space.index === 0 || cut.head.length - space.index > WORD_BACKOFF) return cut;
  const head = cut.head.slice(0, space.index).trimEnd();
  if (!head) return cut;
  return { head, rest: text.slice(head.length) };
}
