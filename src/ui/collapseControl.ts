// Colapsar (P.11, Docs/Doc_Colapsar.md) desde afuera del editor: el menú de la página ("Colapsar todo / Abrir
// todo") y "Ir al bloque" de los comentarios. El editor abierto registra acá lo que se puede hacer con su
// página; así esas partes no cargan el editor. Vale solo para la página abierta (corrección 13).

export interface CollapseControl {
  pageId: string;
  /** Cuántos títulos tiene la página y cuántos están colapsados para vos. */
  counts: () => { headings: number; collapsed: number };
  setAll: (collapsed: boolean) => void;
  /** Abre lo que esconde un bloque. Devuelve si estaba escondido. */
  reveal: (blockId: string) => boolean;
  /** Abre lo que esconde un título y, si está colapsado, el título mismo (ir a una sección desde la cabecera viva). */
  openSection?: (headingId: string) => void;
}

let current: CollapseControl | null = null;

export function setCollapseControl(control: CollapseControl): () => void {
  current = control;
  return () => {
    if (current === control) current = null;
  };
}

/** Lo del editor abierto con esa página, o `null`. */
export function collapseControlFor(pageId: string): CollapseControl | null {
  return current?.pageId === pageId ? current : null;
}

/** Abre lo que esconde un bloque de la página abierta (no hace nada si no hay editor). */
export function revealCollapsed(blockId: string): boolean {
  return current?.reveal(blockId) ?? false;
}
