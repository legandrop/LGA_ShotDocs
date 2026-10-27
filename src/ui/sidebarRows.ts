import { createOpenScheduler, revealRow } from './treeNav';

// La barra lateral como un solo recorrido (pedido de Lega, D806): las partes, los episodios y las filas del *Overview* y
// las filas del árbol de *Pages*, en el orden en que se ven. ↑/↓ pasan de uno al otro sin cortes, y lo que se abre en
// uno pliega el otro (el colapso automático de `treeNav.ts` vale para los dos).

/** Lo que se recorre del *Overview*: el nombre de cada parte, cada episodio y cada fila de sus listas. */
export const OVERVIEW_ROW = 'a.ov-part-name, button.scene-nav-ep, a.scene-nav-row, button.scene-nav-more';
const ROWS =
  '.ov-nav a.ov-part-name, .ov-nav button.scene-nav-ep, .ov-nav a.scene-nav-row, .ov-nav button.scene-nav-more, [role="tree"] .tree-row';

/**
 * La madre de una parte del *Overview* (como `parentId` en el árbol): de una escena, su episodio; de un episodio o de
 * una fila de otra lista, el nombre de su parte. Una parte no tiene.
 */
export function overviewParent(row: Element): HTMLElement | null {
  const li = row.closest('li')?.parentElement?.closest('li');
  if (!li) return null;
  for (const child of li.children) {
    if (child.matches('button.scene-nav-ep')) return child as HTMLElement;
    if (child.classList.contains('ov-part')) return child.querySelector<HTMLElement>('a.ov-part-name');
  }
  return null;
}

/** Una fila del árbol de *Pages* a la que llegan las flechas desde el *Overview*: la abre `Sidebar` (su `browse`). */
export const TREE_GO_EVENT = 'shotdocs:tree-go';
/** Las flechas se fueron del árbol al *Overview*: el árbol saca su marca de elegida (una sola fila marcada, D808). */
export const TREE_AWAY_EVENT = 'shotdocs:tree-away';
export interface TreeGo {
  id: string;
  repeat: boolean;
}

/** La primera o la última fila de toda la barra (Inicio y Fin). */
export function sidebarEdge(from: Element, last: boolean): HTMLElement | null {
  const rows = [...(from.closest('.sidebar-scroll')?.querySelectorAll<HTMLElement>(ROWS) ?? [])];
  return (last ? rows[rows.length - 1] : rows[0]) ?? null;
}

/** La fila que sigue (`dir` 1) o la anterior (-1) a `from` en toda la barra, o `null` en los extremos. */
export function sidebarStep(from: Element, dir: 1 | -1): HTMLElement | null {
  const scroll = from.closest('.sidebar-scroll');
  if (!scroll) return null;
  const rows = [...scroll.querySelectorAll<HTMLElement>(ROWS)];
  const at = rows.indexOf(from as HTMLElement);
  return at < 0 ? null : (rows[at + dir] ?? null);
}

/**
 * Desde algo que no es una fila (el título *Overview*, su botón de plegar, el título *Pages*): la primera fila que viene
 * después (`dir` 1) o la última que viene antes (-1). Así las flechas recorren la barra desde ahí, en vez de desplazarla
 * (lo encontró la auditoría con clics reales, D808).
 */
export function sidebarStepAround(from: Element, dir: 1 | -1): HTMLElement | null {
  const rows = [...(from.closest('.sidebar-scroll')?.querySelectorAll<HTMLElement>(ROWS) ?? [])];
  const after = (r: Element) => !!(from.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING) && !from.contains(r);
  return dir === 1 ? (rows.find(after) ?? null) : (rows.filter((r) => !after(r) && !from.contains(r)).pop() ?? null);
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
let marks: { el: Element; cls: string; had: boolean }[] = [];
function unmark(): void {
  for (const m of marks.reverse()) m.el.classList.toggle(m.cls, m.had);
  marks = [];
}
/**
 * Lo que lleva la marca de elegida de `row` y su clase: una fila (`active`) o la parte entera (`on`). Solo si esa marca
 * sigue a lo abierto (una locación sin página, no).
 */
function holder(row: HTMLElement): [Element, string] | null {
  const href = row.getAttribute('href') ?? '';
  if (row.classList.contains('scene-nav-row')) return href.startsWith('/p/') || href.includes('scene=') ? [row, 'active'] : null;
  if (row.classList.contains('ov-part-name')) {
    const part = row.closest('.ov-part');
    return part ? [part, 'on'] : null;
  }
  return null;
}
function mark(row: HTMLElement): void {
  unmark();
  const box = row.closest('.ov-nav');
  const own = holder(row);
  if (!box || !own) return;
  for (const cur of box.querySelectorAll('.scene-nav-row.active, .ov-part.on')) {
    if (cur === own[0]) continue;
    const cls = cur.classList.contains('ov-part') ? 'on' : 'active';
    marks.push({ el: cur, cls, had: true });
    cur.classList.remove(cls);
  }
  if (!own[0].classList.contains(own[1])) {
    marks.push({ el: own[0], cls: own[1], had: false });
    own[0].classList.add(own[1]);
  }
}

// El clic que da `goToRow` (no la persona): una parte se abre sin desplegarse, como una carpeta a la que se llega con
// las flechas en *Pages*.
let keyClick = false;
export function clickedByKeys(): boolean {
  return keyClick;
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
  keyClick = true;
  try {
    row.click();
  } finally {
    keyClick = false;
  }
});

/**
 * Lleva el foco a `row` y la abre como si se la tocara: al instante o, con la tecla apretada, al frenar. Una fila del
 * árbol la abre `Sidebar`; un episodio solo recibe el foco (Enter lo despliega).
 */
export function goToRow(row: HTMLElement, repeat: boolean): void {
  if (row.classList.contains('tree-row')) {
    opener.cancel();
    unmark();
    // Lo elegido del *Overview* deja de verse elegido: la marca pasa al árbol. Al abrirse la página, React vuelve a
    // escribir la clase de lo que cambió.
    for (const cur of document.querySelectorAll('.ov-nav .scene-nav-row.active, .ov-nav .ov-part.on')) {
      cur.classList.remove(cur.classList.contains('ov-part') ? 'on' : 'active');
    }
    clearOpenedFromOverview();
    const id = row.dataset.page;
    if (id) window.dispatchEvent(new CustomEvent<TreeGo>(TREE_GO_EVENT, { detail: { id, repeat } }));
    return;
  }
  row.focus({ preventScroll: true });
  window.dispatchEvent(new Event(TREE_AWAY_EVENT));
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
