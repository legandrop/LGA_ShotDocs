import { createOpenScheduler, revealRow } from './treeNav';

// La barra lateral como un solo recorrido (pedido de Lega, D806): las partes, los episodios y las filas del *Overview* y
// las filas del árbol de *Pages*, en el orden en que se ven. ↑/↓ pasan de uno al otro sin cortes, y lo que se abre en
// uno pliega el otro (el colapso automático de `treeNav.ts` vale para los dos).

/** Lo que se recorre del *Overview*: el nombre de cada parte, cada episodio y cada fila de sus listas. */
export const OVERVIEW_ROW = 'a.ov-part-name, button.scene-nav-ep, a.scene-nav-row';
const ROWS = '.ov-nav a.ov-part-name, .ov-nav button.scene-nav-ep, .ov-nav a.scene-nav-row, [role="tree"] .tree-row';

/** Una fila del árbol de *Pages* a la que llegan las flechas desde el *Overview*: la abre `Sidebar` (su `browse`). */
export const TREE_GO_EVENT = 'shotdocs:tree-go';
export interface TreeGo {
  id: string;
  repeat: boolean;
}

/** La fila que sigue (`dir` 1) o la anterior (-1) a `from` en toda la barra, o `null` en los extremos. */
export function sidebarStep(from: Element, dir: 1 | -1): HTMLElement | null {
  const scroll = from.closest('.sidebar-scroll');
  if (!scroll) return null;
  const rows = [...scroll.querySelectorAll<HTMLElement>(ROWS)];
  const at = rows.indexOf(from as HTMLElement);
  return at < 0 ? null : (rows[at + dir] ?? null);
}

// Qué se abrió desde el *Overview* (una página o `'map'`, una vista del mapa): eso pliega *Pages* y no centra su árbol;
// lo demás (el árbol, un link, la búsqueda, atrás) pliega el *Overview*. Se anota el destino, no el momento: lo que se
// abre después por otro camino no cuenta. Vence igual (atrás a esa misma página, mucho después, ya no es del Overview).
const FROM_TTL_MS = 5000;
let from: { target: string; at: number } | null = null;
/** El destino de un link del *Overview*: el id de la página (`/p/<id>`) o `'map'`. */
export function overviewTarget(href: string): string {
  const page = /^\/p\/([^/?#]+)/.exec(href);
  return page ? page[1] : 'map';
}
export function markOpenedFromOverview(target: string): void {
  from = { target, at: Date.now() };
}
export function clearOpenedFromOverview(): void {
  from = null;
}
export function openedFromOverview(target: string | null): boolean {
  return !!target && !!from && from.target === target && Date.now() - from.at < FROM_TTL_MS;
}

// Con la tecla apretada, la fila del foco se marca como la elegida enseguida (no al soltar). En el *Overview* la marca
// se pone a mano en el DOM: al abrirse la fila, React vuelve a escribir la clase de las dos filas que cambian.
let marks: { el: Element; had: boolean }[] = [];
function unmark(): void {
  for (const m of marks.reverse()) m.el.classList.toggle('active', m.had);
  marks = [];
}
/** Una fila cuya marca de elegida sigue a la página abierta (o a la escena): la de una locación sin página no. */
function markable(row: HTMLElement): boolean {
  const href = row.getAttribute('href') ?? '';
  return row.classList.contains('scene-nav-row') && (href.startsWith('/p/') || href.includes('scene='));
}
function mark(row: HTMLElement): void {
  unmark();
  const box = row.closest('.ov-nav');
  if (!box || !markable(row)) return;
  for (const cur of box.querySelectorAll('.scene-nav-row.active')) {
    if (cur === row) continue;
    marks.push({ el: cur, had: true });
    cur.classList.remove('active');
  }
  if (!row.classList.contains('active')) {
    marks.push({ el: row, had: false });
    row.classList.add('active');
  }
}

let target: HTMLAnchorElement | null = null;
const opener = createOpenScheduler(() => {
  const row = target;
  target = null;
  // Si el foco se fue a otro lado (un clic en *Pages*, Tab al editor), lo pendiente ya no va.
  if (!row?.isConnected || document.activeElement !== row) {
    unmark();
    return;
  }
  // Se abre: las marcas quedan (React las corrige al dibujar la fila abierta).
  marks = [];
  row.click();
});

/**
 * Lleva el foco a `row` y la abre como si se la tocara: al instante o, con la tecla apretada, al frenar. Una fila del
 * árbol la abre `Sidebar`; un episodio solo recibe el foco (Enter lo despliega).
 */
export function goToRow(row: HTMLElement, repeat: boolean): void {
  if (row.classList.contains('tree-row')) {
    opener.cancel();
    unmark();
    clearOpenedFromOverview();
    const id = row.dataset.page;
    if (id) window.dispatchEvent(new CustomEvent<TreeGo>(TREE_GO_EVENT, { detail: { id, repeat } }));
    return;
  }
  row.focus({ preventScroll: true });
  const nav = row.closest<HTMLElement>('.sidebar-scroll');
  if (nav) revealRow(row, nav);
  if (!(row instanceof HTMLAnchorElement)) {
    opener.cancel();
    unmark();
    return;
  }
  mark(row);
  target = row;
  opener.request(row.getAttribute('href') ?? '', repeat);
}
