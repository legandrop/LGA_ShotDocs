import type { Translate } from '../i18n';

// Páginas con el mismo título (D706, O8 de E15 y de E16): dos páginas de la misma escena o del mismo día se llaman casi
// siempre igual, y en *Map › Pending*, en el cartel de la copia que cede y en los avisos de *Merge* la persona no sabía
// cuál era cuál. Dos maneras, según lo que se pueda decir de cada una:
//
// - **«· 1» / «· 2»** cuando las dos están vivas y se listan juntas (el adelanto de *Merge* y las filas de repetidas):
//   el orden del árbol, el mismo en todos lados (la primera es la que usan las relaciones).
// - **«· la que se va» / «· la que queda»** cuando se habla de una unión (en los avisos y las filas que vienen de ella): ahí
//   el árbol ya no sirve, porque la que se fue está en la papelera, pero cada una tiene su papel.

/** Dos títulos que la persona no distingue (sin mirar los espacios de los bordes). */
export const sameTitle = (a: string, b: string): boolean => a.trim() === b.trim();

/**
 * Los nombres de varias páginas listadas juntas, en el orden dado: si un título se repite, cada una lleva «· n» (su lugar
 * entre las que se llaman igual); si no, el título solo. `numbered` dice si alguna lleva número (para explicarlo).
 */
export function twinLabels(ids: readonly string[], title: (id: string) => string): { label: (id: string) => string; numbered: boolean } {
  const seen = new Map<string, number>();
  const total = new Map<string, number>();
  for (const id of ids) total.set(title(id).trim(), (total.get(title(id).trim()) ?? 0) + 1);
  const place = new Map<string, number>();
  for (const id of ids) {
    const key = title(id).trim();
    seen.set(key, (seen.get(key) ?? 0) + 1);
    place.set(id, seen.get(key)!);
  }
  const numbered = [...total.values()].some((n) => n > 1);
  return { label: (id) => ((total.get(title(id).trim()) ?? 0) > 1 ? `${title(id)} · ${place.get(id)}` : title(id)), numbered };
}

/**
 * Los nombres de las dos páginas de una unión para un aviso o una fila: si se llaman igual, cada una dice su papel; si no,
 * el título solo. `past`: la unión ya se hizo («la que se fue», D716).
 */
export function roleNames(tr: Translate, from: string, into: string, past = false): { from: string; into: string } {
  if (!sameTitle(from, into)) return { from, into };
  return { from: `${from} · ${tr(past ? 'merge.roleWent' : 'merge.roleGoes')}`, into: `${into} · ${tr('merge.roleStays')}` };
}
