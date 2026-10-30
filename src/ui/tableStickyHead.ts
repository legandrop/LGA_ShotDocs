// El encabezado de una tabla del editor queda pegado arriba al bajar (D827, como las tablas que arma la app, D821).
//
// Con CSS no alcanza: la caja que desplaza la tabla de costado (`.tableWrapper`, `overflow-x: auto`) también es la caja
// contra la que se pega un `position: sticky`, y esa caja no se desplaza para abajo: el encabezado se iba con la página.
// Acá se mide cuánto se metió la tabla debajo de la barra de arriba y se corre el renglón de encabezado esa distancia
// (`--sd-head-shift`, styles.css), hasta que se ve la última fila: ahí se va con ella. Se escribe en `.tableWrapper`,
// que está afuera de lo que el editor mira (`ignoreMutation` de la tabla de BlockNote): no cambia el documento.
// La vista de impresión saca la clase (printView.ts), así el PDF nunca sale con el encabezado corrido.

export const STUCK_CLASS = 'sd-head-stuck';

/** La caja que desplaza a `el` para abajo (la página, la vista previa del historial…), o `null` si es la ventana. */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let at = el.parentElement; at; at = at.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(at).overflowY)) return at;
  }
  return null;
}

/**
 * Dónde se pega: el borde de abajo de la barra de arriba de la página, si está en la caja que desplaza la tabla; si no
 * (el historial tiene su propia barra, afuera de la vista previa), el borde de arriba de esa caja.
 */
function stickyLine(host: HTMLElement, root: Document): number {
  const scroller = scrollerOf(host);
  const bar = (scroller ?? root).querySelector('.topbar');
  if (bar) return Math.max(0, bar.getBoundingClientRect().bottom);
  return scroller ? Math.max(0, scroller.getBoundingClientRect().top) : 0;
}

/**
 * El renglón de encabezado de una tabla: la primera fila, si tiene solo celdas de encabezado (BlockNote tiene 0 o 1).
 * Una fila de abajo que quedó solo con celdas de encabezado (unida con la columna de encabezado) no cuenta.
 */
export function headRow(table: HTMLTableElement): HTMLTableRowElement | null {
  const row = table.rows[0];
  return row && row.cells.length && [...row.cells].every((cell) => cell.tagName === 'TH') ? row : null;
}

/**
 * Cuánto bajar el encabezado: lo que la tabla se metió debajo de `line`, sin pasar del lugar de la última fila
 * (la tabla menos el encabezado). 0 si la tabla todavía no llegó a la línea o no tiene encabezado.
 */
export function headShift(tableTop: number, tableHeight: number, headHeight: number, line: number): number {
  if (headHeight <= 0) return 0;
  return Math.max(0, Math.min(line - tableTop, tableHeight - headHeight));
}

/** Acomoda el encabezado de cada tabla de `host`: primero mide todas y después escribe (una sola vuelta de estilos). */
export function placeHeads(host: HTMLElement, root: Document = document): void {
  const line = stickyLine(host, root);
  const shifts = [...host.querySelectorAll<HTMLElement>('.bn-editor .tableWrapper')].map((wrapper) => {
    const table = wrapper.querySelector<HTMLTableElement>('table');
    const row = table ? headRow(table) : null;
    if (!table || !row) return { wrapper, shift: 0 };
    // La fila no se corre (se corren sus celdas): su caja es siempre la de partida.
    const box = table.getBoundingClientRect();
    return { wrapper, shift: Math.round(headShift(box.top, box.height, row.getBoundingClientRect().height, line)) };
  });
  for (const { wrapper, shift } of shifts) {
    const stuck = shift > 0;
    if (wrapper.classList.contains(STUCK_CLASS) !== stuck) wrapper.classList.toggle(STUCK_CLASS, stuck);
    const value = stuck ? `${shift}px` : '';
    if (wrapper.style.getPropertyValue('--sd-head-shift') !== value) {
      if (stuck) wrapper.style.setProperty('--sd-head-shift', value);
      else wrapper.style.removeProperty('--sd-head-shift');
    }
  }
}

/** Mientras la página está abierta: al desplazar (cualquier caja), al cambiar el tamaño y al cambiar el contenido. */
export function watchHeads(host: HTMLElement): () => void {
  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      placeHeads(host);
    });
  };
  document.addEventListener('scroll', schedule, { capture: true, passive: true });
  window.addEventListener('resize', schedule);
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  resize?.observe(host);
  schedule();
  return () => {
    if (frame) cancelAnimationFrame(frame);
    document.removeEventListener('scroll', schedule, { capture: true });
    window.removeEventListener('resize', schedule);
    resize?.disconnect();
  };
}
