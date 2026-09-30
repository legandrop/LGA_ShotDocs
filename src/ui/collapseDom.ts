// Colapsar (P.11, Docs/Doc_Colapsar.md), en el DOM del editor: qué está escondido y qué título lo esconde. Lo
// usan las capas encima del editor (el margen de comentarios, las marcas de hoja, los triángulos), que leen la
// página en pantalla y no el documento. Las marcas las pone collapseEditor.ts:
// - `sd-collapsed-hidden` y `data-sd-hider` en cada hermano escondido de un título que se ve;
// - `sd-collapsed` en el título colapsado, que esconde (con CSS) su grupo de hijos.

const OUTER = '.bn-block-outer';

function idOf(outer: Element): string | null {
  return outer.getAttribute('data-id') ?? outer.querySelector(':scope > [data-id]')?.getAttribute('data-id') ?? null;
}

/**
 * El título colapsado de más afuera que esconde a `el` (el que se ve), o `null` si `el` se ve. `el` puede ser
 * cualquier elemento adentro de un bloque (su contenido, una imagen, un iframe).
 */
export function hiderInDom(el: Element): string | null {
  let hider: string | null = null;
  for (let outer = el.closest(OUTER); outer; outer = outer.parentElement?.closest(OUTER) ?? null) {
    if (outer.classList.contains('sd-collapsed-hidden')) {
      hider = outer.getAttribute('data-sd-hider') ?? hider;
    } else if (outer.classList.contains('sd-collapsed')) {
      const children = outer.querySelector(':scope > .bn-block > .bn-block-group');
      if (children?.contains(el)) hider = idOf(outer) ?? hider;
    }
  }
  return hider;
}

export function hiddenInDom(el: Element): boolean {
  return hiderInDom(el) !== null;
}
