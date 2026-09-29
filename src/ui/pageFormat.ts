import type { PageTree } from '../sync/tree';
import type { PageRow, PageSettings } from '../sync/types';

// Tamaños de hoja. La página se muestra con el ancho real de la hoja (a 96 puntos por pulgada, como la
// imprime el navegador) y una línea donde termina cada hoja. La exportación a PDF llega en la fase 4.

export const PAGE_SIZES = {
  A5: { label: 'A5', width: 148, height: 210 },
  A4: { label: 'A4', width: 210, height: 297 },
  A3: { label: 'A3', width: 297, height: 420 },
  Letter: { label: 'Letter', width: 215.9, height: 279.4 },
} as const;

export type PageSize = keyof typeof PAGE_SIZES | 'free';

/** Margen de la hoja, en milímetros. */
export const SHEET_MARGIN_MM = 20;

const MM_TO_PX = 96 / 25.4;
export const mm = (value: number) => Math.round(value * MM_TO_PX * 10) / 10;

type FormatSetting = NonNullable<PageSettings['format']>;

const isFormat = (v: unknown): v is FormatSetting =>
  !!v &&
  typeof v === 'object' &&
  typeof (v as FormatSetting).size === 'string' &&
  ((v as FormatSetting).size === 'free' || Object.hasOwn(PAGE_SIZES, (v as FormatSetting).size)) &&
  ((v as FormatSetting).landscape === undefined || typeof (v as FormatSetting).landscape === 'boolean');

export interface PageFormat {
  size: PageSize;
  landscape: boolean;
  /** Página que define el formato (esta o un contenedor); `null` si nadie lo definió. */
  from: PageRow | null;
}

/** El formato de hoja que vale para `id`: el suyo o el del contenedor más cercano. De fábrica, libre. */
export function pageFormat(tree: PageTree, id: string): PageFormat {
  const found = tree.resolveSetting(id, 'format', isFormat);
  if (!found) return { size: 'free', landscape: false, from: null };
  return { size: found.value.size as PageSize, landscape: !!found.value.landscape, from: found.from };
}

export function ownFormat(tree: PageTree, id: string): boolean {
  return isFormat(tree.get(id)?.settings?.format);
}

/** Ancho y alto de la hoja en píxeles, o `null` si la página es libre. */
export function sheetSize(format: PageFormat): { width: number; height: number } | null {
  if (format.size === 'free') return null;
  const { width, height } = PAGE_SIZES[format.size];
  return format.landscape ? { width: mm(height), height: mm(width) } : { width: mm(width), height: mm(height) };
}
