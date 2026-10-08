// El teclado del árbol de páginas de la barra lateral (patrón de árbol de WAI-ARIA): qué filas se ven y en qué
// orden, y qué hace cada tecla según dónde está el foco. Funciones puras; `Sidebar.tsx` las aplica.

/** Una fila visible del árbol, en el orden en que se ve. */
export interface VisibleRow {
  id: string;
  /** La madre en el árbol que se ve (`null` en el primer nivel, también si la madre real no es visible). */
  parentId: string | null;
  depth: number;
  hasChildren: boolean;
  /** Abierta: tiene subpáginas y se ven. */
  open: boolean;
}

/**
 * Las filas que se ven, de arriba abajo: cada página y, si está abierta, sus subpáginas (las de una cerrada no).
 * `children` devuelve las subpáginas ya ordenadas y sin las de la papelera, como `PageTree.children`.
 */
export function visibleRows(
  roots: readonly { id: string }[],
  children: (id: string) => readonly { id: string }[],
  expanded: ReadonlySet<string>,
): VisibleRow[] {
  const out: VisibleRow[] = [];
  // Un ciclo en datos rotos no cuelga el recorrido.
  const seen = new Set<string>();
  const walk = (pages: readonly { id: string }[], parentId: string | null, depth: number) => {
    for (const page of pages) {
      if (seen.has(page.id)) continue;
      seen.add(page.id);
      const kids = children(page.id);
      const open = kids.length > 0 && expanded.has(page.id);
      out.push({ id: page.id, parentId, depth, hasChildren: kids.length > 0, open });
      if (open) walk(kids, page.id, depth + 1);
    }
  };
  walk(roots, null, 0);
  return out;
}

/** Lo que hace una tecla en el árbol. */
export type TreeAction =
  | { type: 'none' }
  /** Pasar el foco a esa fila y abrir su página (navegar, como un clic; ver `createOpenScheduler`). */
  | { type: 'go'; id: string }
  /** Abrir ya la página de la fila (Enter, Espacio). */
  | { type: 'open'; id: string }
  /** Desplegar sus subpáginas (sin cambiar de página). */
  | { type: 'expand'; id: string }
  /** Plegar sus subpáginas. */
  | { type: 'collapse'; id: string };

const NONE: TreeAction = { type: 'none' };

/** Las teclas del árbol. Cualquier otra no es del árbol. */
export function isTreeKey(key: string): boolean {
  return ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(key);
}

/**
 * La tecla sola: con Ctrl, ⌘, Alt o Shift no es del árbol (son de otros atajos, del sistema o del navegador), y
 * escribiendo con un IME tampoco.
 */
export function isPlainKey(e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing?: boolean }): boolean {
  return !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !e.isComposing;
}

/** Qué hace `key` con el foco en la fila `focusId`. */
export function treeKeyAction(rows: readonly VisibleRow[], focusId: string, key: string): TreeAction {
  const at = rows.findIndex((r) => r.id === focusId);
  if (at < 0) return NONE;
  const row = rows[at];
  const go = (i: number): TreeAction => (i >= 0 && i < rows.length && i !== at ? { type: 'go', id: rows[i].id } : NONE);
  switch (key) {
    case 'ArrowDown':
      return go(at + 1);
    case 'ArrowUp':
      return go(at - 1);
    case 'Home':
      return go(0);
    case 'End':
      return go(rows.length - 1);
    case 'ArrowRight':
      // Cerrada con subpáginas: la abre. Abierta: a su primera subpágina (la fila que sigue). Sin subpáginas: nada.
      if (!row.hasChildren) return NONE;
      return row.open ? go(at + 1) : { type: 'expand', id: row.id };
    case 'ArrowLeft':
      // Abierta: la cierra. Cerrada o sin subpáginas: a su madre. En el primer nivel sin nada que cerrar: nada.
      if (row.open) return { type: 'collapse', id: row.id };
      return row.parentId ? { type: 'go', id: row.parentId } : NONE;
    case 'Enter':
    case ' ':
      return { type: 'open', id: row.id };
    default:
      return NONE;
  }
}

/** La espera para abrir la página cuando las flechas vienen seguidas (tecla apretada o pulsaciones rápidas). */
export const OPEN_DELAY_MS = 150;

export interface OpenScheduler {
  /** Pide abrir `id`. `repeat`: la tecla viene apretada (`KeyboardEvent.repeat`). */
  request(id: string, repeat?: boolean): void;
  /** Olvida lo que estaba por abrirse. */
  cancel(): void;
  /** Lo que está por abrirse, si hay algo. */
  pending(): string | null;
}

/**
 * Abrir páginas al moverse con las flechas sin encolar cargas: una pulsación suelta abre la página al instante;
 * con la tecla apretada o pulsaciones más seguidas que `delay`, el foco corre fila por fila y solo se abre la
 * última, `delay` ms después de la última tecla. Así nunca se arma una fila de páginas abriéndose una tras otra.
 */
export function createOpenScheduler(
  open: (id: string) => void,
  { delay = OPEN_DELAY_MS, now = () => performance.now() }: { delay?: number; now?: () => number } = {},
): OpenScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let target: string | null = null;
  let last = -Infinity;
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    target = null;
  };
  return {
    request(id, repeat = false) {
      const t = now();
      const burst = repeat || timer !== null || t - last < delay;
      last = t;
      cancel();
      if (!burst) {
        open(id);
        return;
      }
      target = id;
      timer = setTimeout(() => {
        timer = null;
        target = null;
        open(id);
      }, delay);
    },
    cancel,
    pending: () => target,
  };
}

/** El aire que queda entre la fila llevada a la vista y el borde del árbol. */
export const REVEAL_MARGIN = 8;
/** Cuánto tiene que estar quieto el árbol, sin que la persona lo desplace, para llevarle la fila abierta a la vista. */
export const REVEAL_QUIET_MS = 200;
/** Cuánto espera, como mucho, una fila a aparecer y a que el árbol quede quieto antes de dejar de buscarla. */
export const REVEAL_TTL_MS = 5000;

/**
 * Cuánto hay que desplazar el área del árbol (`view`, en las mismas coordenadas que `row`) para que la fila se
 * vea entera: 0 si ya se ve; si no, lo justo para dejarla pegada al borde más cercano con `margin` de aire (como
 * `scrollIntoView({ block: 'nearest' })`). Positivo, hacia abajo.
 */
export function revealDelta(
  row: { top: number; bottom: number },
  view: { top: number; bottom: number },
  margin = REVEAL_MARGIN,
): number {
  if (row.top >= view.top && row.bottom <= view.bottom) return 0;
  if (row.top < view.top) return row.top - view.top - margin;
  // Más alta que lo que se ve: manda su borde de arriba.
  if (row.bottom - row.top > view.bottom - view.top) return row.top - view.top - margin;
  return row.bottom - view.bottom + margin;
}

/**
 * Lleva `row` a la vista dentro de `container` (el elemento que se desplaza), sin tocar ningún otro desplazamiento
 * de la página: `scrollIntoView` también movería la ventana y, en el teléfono con el cajón cerrado, intentaría
 * mostrar la barra fuera de la pantalla. Con el cajón cerrado (corrido de costado con `transform`) las medidas de
 * arriba abajo valen igual: queda desplazado para cuando se abra. Devuelve cuánto desplazó.
 */
function bottomCover(container: HTMLElement): number {
  try {
    return parseFloat(getComputedStyle(container).scrollPaddingBottom) || 0;
  } catch {
    // Sin estilos (una prueba sin DOM): nada tapa el borde.
    return 0;
  }
}

export function revealRow(row: HTMLElement, container: HTMLElement): number {
  const r = row.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  // Sin caja (el árbol no se dibuja, `display: none`): no hay nada que medir.
  if (!r.height || !c.height) return 0;
  const top = c.top + container.clientTop;
  // Lo que tapa el borde de abajo (el renglón «Reading…» de las relaciones lo anuncia con `scroll-padding-bottom`).
  const covered = bottomCover(container);
  let delta = revealDelta(r, { top, bottom: top + container.clientHeight - covered });
  // Hacia arriba, si la fila cabe en la primera pantalla del contenido, se vuelve al principio: así reaparece también
  // el encabezado (el selector de proyectos) en vez de quedar la fila pegada al borde con el encabezado escondido.
  if (delta < 0) {
    const offset = container.scrollTop + (r.top - top);
    if (offset + r.height + REVEAL_MARGIN <= container.clientHeight) delta = -container.scrollTop;
  }
  if (delta) container.scrollTop += delta;
  return delta;
}
