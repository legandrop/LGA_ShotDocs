// La celda con el cursor a la vista en una tabla que se desplaza de costado (P.28, Docs/Doc_Tabla_Telefono.md).
//
// En una pantalla angosta una tabla ancha se desplaza dentro de su bloque (`.tableWrapper`, styles.css). Al escribir,
// el editor ya lleva el cursor a la vista, pero al pasar de celda con Tab o con las flechas lo deja pegado al borde
// con la celda cortada. Acá se la acomoda entera cuando entra, solo de costado y solo dentro de la tabla: la página
// no se mueve ni arriba ni abajo (con el teclado del teléfono abierto, el alto lo maneja el navegador).

/**
 * Donde la tabla tiene piso de ancho y se desplaza: la misma regla de `styles.css`. Llega a 1024 px (teléfono y tablet,
 * también la vertical con el cajón de páginas a la vista) y no a los 760 px del resto de las reglas de teléfono.
 */
export const TABLE_SCROLL_QUERY = '(max-width: 1024px)';

/**
 * Corre `wrapper` de costado lo justo para que `cell` entre entera en lo que se ve del contenedor. Si la celda es más
 * ancha que lo visible no hace nada (el cursor lo lleva el editor). Devuelve si lo corrió.
 */
export function revealCell(wrapper: HTMLElement, cell: HTMLElement): boolean {
  if (wrapper.scrollWidth <= wrapper.clientWidth) return false;
  const box = wrapper.getBoundingClientRect();
  const at = cell.getBoundingClientRect();
  // Lo visible: el contenedor, sin su relleno (a la derecha queda el lugar del botón de agregar columna).
  const style = getComputedStyle(wrapper);
  const left = box.left + (parseFloat(style.paddingLeft) || 0);
  const right = box.right - (parseFloat(style.paddingRight) || 0);
  if (at.width > right - left) return false;
  let by = 0;
  if (at.left < left) by = at.left - left;
  else if (at.right > right) by = at.right - right;
  if (by === 0) return false;
  wrapper.scrollLeft += by;
  return true;
}

/** La celda donde está el cursor (o el borde de la selección), si es de una tabla del editor. */
export function selectionCell(root: Document = document): { cell: HTMLElement; wrapper: HTMLElement } | null {
  const node = root.getSelection?.()?.anchorNode;
  const element = node && node.nodeType === 1 ? (node as Element) : (node?.parentElement ?? null);
  const cell = element?.closest<HTMLElement>('.bn-editor td, .bn-editor th') ?? null;
  const wrapper = cell?.closest<HTMLElement>('.tableWrapper') ?? null;
  return cell && wrapper ? { cell, wrapper } : null;
}

/** Al cambiar la selección: en pantalla angosta, la celda con el cursor entra entera en la tabla. */
export function revealSelectionCell(root: Document = document): boolean {
  if (typeof matchMedia === 'function' && !matchMedia(TABLE_SCROLL_QUERY).matches) return false;
  const found = selectionCell(root);
  return found ? revealCell(found.wrapper, found.cell) : false;
}
