import type { PageTree } from '../sync/tree';
import type { PageRow, PageSettings } from '../sync/types';

/** Largo máximo del código (la primera parte) para que una lista se muestre dividida. */
export const MAX_CODE_LENGTH = 7;

/** Cuántos contenedores muestra el encabezado si nadie en la rama lo configuró. */
export const DEFAULT_HEADER_LEVELS = 2;

export interface SplitTitle {
  code: string;
  name: string;
}

/**
 * "064 | Cubiertos pegados | Bar Caballero" → código "064" y nombre "Cubiertos pegados"; lo que sigue no
 * se muestra en la barra lateral. Sin "|", o con alguna de las dos primeras partes vacía, no se divide.
 */
export function splitTitle(title: string): SplitTitle | null {
  const parts = title.split('|').map((p) => p.trim());
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;
  return { code: parts[0], name: parts[1] };
}

/**
 * Los títulos de una lista de hermanas se dividen solo si ninguna tiene un código de más de
 * MAX_CODE_LENGTH caracteres: así la columna del código queda alineada. Si alguna se pasa, la lista
 * entera se ve con los títulos completos. Devuelve el ancho de la columna (en caracteres) y cada título
 * dividido, o `null`.
 */
export function splitSiblings(pages: PageRow[]): { width: number; titles: Map<string, SplitTitle> } | null {
  const titles = new Map<string, SplitTitle>();
  let width = 0;
  for (const page of pages) {
    const split = splitTitle(page.title);
    if (!split) continue;
    if ([...split.code].length > MAX_CODE_LENGTH) return null;
    width = Math.max(width, [...split.code].length);
    titles.set(page.id, split);
  }
  return titles.size ? { width, titles } : null;
}

type HeaderSetting = NonNullable<PageSettings['header']>;

const isSplit = (v: unknown): v is boolean => typeof v === 'boolean';

const isLevels = (v: unknown): v is number | null =>
  v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100);

const isHeader = (v: unknown): v is HeaderSetting =>
  !!v && typeof v === 'object' && isLevels((v as HeaderSetting).levels);

/** Si los títulos de adentro de `parentId` se dividen (se hereda por rama; de fábrica, sí). */
export function splitEnabled(tree: PageTree, parentId: string | null): boolean {
  if (!parentId) return true;
  return tree.resolveSetting(parentId, 'split', isSplit)?.value ?? true;
}

/** Si `id` define su propio ajuste de división (y no lo hereda). */
export function ownSplit(tree: PageTree, id: string): boolean {
  return isSplit(tree.get(id)?.settings?.split);
}

/** Si `id` define su propio encabezado (y no lo hereda). */
export function ownHeader(tree: PageTree, id: string): boolean {
  return isHeader(tree.get(id)?.settings?.header);
}

/**
 * Cuántos contenedores muestra el encabezado de `id`: 0 = oculto, `null` = todos. `last` es el último
 * valor visible, para volver a él al mostrarlo de nuevo.
 */
export function headerLevels(
  tree: PageTree,
  id: string,
): { levels: number | null; last: number | null; from: PageRow | null } {
  const found = tree.resolveSetting(id, 'header', isHeader);
  if (!found) return { levels: DEFAULT_HEADER_LEVELS, last: DEFAULT_HEADER_LEVELS, from: null };
  const { levels, last } = found.value;
  const fallback = isLevels(last) && last !== 0 ? last : DEFAULT_HEADER_LEVELS;
  return { levels, last: levels === 0 ? fallback : levels, from: found.from };
}

/** Los contenedores que se ven en el encabezado, del más lejano al más cercano. */
export function headerPages(tree: PageTree, id: string): PageRow[] {
  const { levels } = headerLevels(tree, id);
  const ancestors = tree.ancestors(id);
  if (levels === null) return ancestors;
  return levels <= 0 ? [] : ancestors.slice(-levels);
}
