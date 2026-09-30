import type { BlockTypeSelectItem } from '@blocknote/react';

// Sin los "encabezados plegables" de BlockNote (P.11, Docs/Doc_Colapsar.md): todos los títulos se colapsan con
// el triángulo. Los que ya existen se ven como títulos comunes.

/** Las claves de los encabezados plegables del menú "/". */
const TOGGLE_HEADING_KEYS = new Set(['toggle_heading', 'toggle_heading_2', 'toggle_heading_3']);

/** Para filtrar el menú "/": deja todo menos los encabezados plegables. */
export function notToggleHeading(item: { key?: string } | object): boolean {
  return !TOGGLE_HEADING_KEYS.has(String((item as { key?: string }).key));
}

/**
 * El selector de tipo sin los encabezados plegables, y los títulos sin `isToggleable`: así un plegable viejo
 * aparece como su título en el selector (se compara solo el nivel) y pasar a otro nivel no lo cambia.
 */
export function headingItems(items: BlockTypeSelectItem[]): BlockTypeSelectItem[] {
  return items
    .filter((item) => !(item.type === 'heading' && item.props?.isToggleable === true))
    .map((item) => {
      if (item.type !== 'heading' || !item.props || !('isToggleable' in item.props)) return item;
      const { isToggleable: _t, ...props } = item.props;
      return { ...item, props };
    });
}
