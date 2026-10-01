// "Convert photos to inline" desde el menú de la página (Docs/Doc_Fotos_En_Linea.md, entrega 3). El editor abierto
// registra acá lo que se puede hacer con su página (como collapseControl.ts): así el menú no carga el editor. Vale
// solo para la página abierta y editable.

export interface ConvertControl {
  pageId: string;
  /** Cuántas fotos-bloque de la página pasarían a ser fotos en línea. */
  count: () => number;
  convert: () => void;
}

let current: ConvertControl | null = null;

export function setConvertControl(control: ConvertControl): () => void {
  current = control;
  return () => {
    if (current === control) current = null;
  };
}

/** Lo del editor abierto con esa página, o `null`. */
export function convertControlFor(pageId: string): ConvertControl | null {
  return current?.pageId === pageId ? current : null;
}
