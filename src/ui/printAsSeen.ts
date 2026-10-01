// "Imprimir como se ve" (P.11, Doc_Colapsar.md, sección 7): por defecto el PDF sale con todo abierto; con la
// casilla, sale como se ve (sin lo que está colapsado para vos). Se guarda en el dispositivo y la usan el menú,
// Ctrl/⌘+P y la impresión desde el menú del navegador.

const KEY = 'shotdocs-print-as-seen';

export function printAsSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setPrintAsSeen(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    // Sin almacenamiento (ventana privada): vale para esta vez.
  }
}
