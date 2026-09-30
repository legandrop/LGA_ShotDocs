import { mediaIdOf } from '../media/queue';
import { FILE_SCHEME } from '../sync/files';

// La lógica del carrete (paso 7 de Docs/Plan_Workspaces.md; Docs/Doc_Carrete.md), separada de la
// pantalla para poder probarla: qué fotos y videos tiene la página y en qué orden, la navegación, el zoom
// (rueda, pellizco, doble toque, arrastrar) y qué hace un gesto con el dedo.

// --- los elementos de la página -------------------------------------------------------------------------

/** De dónde sale un elemento: el Drive del dueño (`sdmedia://`), Supabase (`sdfile://`) o una dirección. */
export type CarreteSource = 'media' | 'file' | 'web';

export interface CarreteItem {
  /** El bloque `image` de la página (para empezar por el que se tocó). */
  blockId: string;
  /** La dirección guardada en el bloque, tal cual. */
  url: string;
  source: CarreteSource;
  /** El id del archivo si es `sdmedia://`. */
  mediaId: string | null;
  /** `name` del bloque (puede estar vacío). */
  name: string;
  /** La leyenda del bloque (puede estar vacía). */
  caption: string;
}

/** Lo mínimo de un bloque de BlockNote que hace falta leer. */
export interface BlockLike {
  id: string;
  type: string;
  props?: unknown;
  children?: BlockLike[];
}

/** De dónde sale una dirección, o `null` si el carrete no la muestra (vacía, a medio subir, otro esquema). */
export function carreteSourceOf(url: string | undefined | null): CarreteSource | null {
  if (!url) return null;
  if (mediaIdOf(url)) return 'media';
  if (url.startsWith(FILE_SCHEME)) return url.length > FILE_SCHEME.length ? 'file' : null;
  if (/^https?:\/\/./i.test(url)) return 'web';
  if (/^data:image\//i.test(url)) return 'web';
  return null;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Todas las fotos y videos de la página, en el orden en que aparecen (de arriba abajo, también los que
 * están adentro de otro bloque). Solo bloques `image` con una dirección que se pueda mostrar.
 */
export function collectCarrete(blocks: readonly BlockLike[]): CarreteItem[] {
  const out: CarreteItem[] = [];
  const walk = (list: readonly BlockLike[]) => {
    for (const block of list) {
      if (block.type === 'image') {
        const props = (block.props ?? {}) as Record<string, unknown>;
        const url = text(props.url);
        const source = carreteSourceOf(url);
        if (source) {
          out.push({
            blockId: block.id,
            url,
            source,
            mediaId: source === 'media' ? mediaIdOf(url) : null,
            name: text(props.name),
            caption: text(props.caption),
          });
        }
      }
      if (block.children?.length) walk(block.children);
    }
  };
  walk(blocks);
  return out;
}

/** El id del bloque de un elemento del editor (la foto que se tocó), o `null`. */
export function blockIdOf(el: Element | null): string | null {
  const block = el?.closest('[data-node-type="blockContainer"][data-id]') ?? el?.closest('[data-id]');
  return block?.getAttribute('data-id') ?? null;
}

/** Por cuál empezar: el bloque que se tocó; `-1` si ese bloque no está en el carrete. */
export function startIndex(items: readonly CarreteItem[], blockId: string | null): number {
  return blockId ? items.findIndex((i) => i.blockId === blockId) : -1;
}

/** Un nombre para bajar el archivo cuando el bloque no trae uno. */
export function fallbackName(item: CarreteItem): string {
  if (item.name.trim()) return item.name.trim();
  if (item.source === 'file' || /^https?:/i.test(item.url)) {
    const last = item.url.split(/[?#]/)[0].split('/').pop() ?? '';
    try {
      const decoded = decodeURIComponent(last);
      if (decoded) return decoded;
    } catch {
      if (last) return last;
    }
  }
  const ext = /^data:image\/([a-z0-9+.-]+)/i.exec(item.url)?.[1]?.replace('jpeg', 'jpg').replace('+xml', '') ?? 'jpg';
  return `image.${ext}`;
}

// --- navegación -----------------------------------------------------------------------------------------

/** Ir `delta` lugares; en los extremos se queda (no da la vuelta). */
export function stepIndex(index: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, index + delta));
}

/** "3 / 12" (el primero es 1). */
export function counterText(index: number, count: number): string {
  return `${Math.min(index + 1, count)} / ${count}`;
}

/** Los vecinos para precargar: el siguiente primero (es a donde se suele ir), después el anterior. */
export function neighbors(index: number, count: number): number[] {
  return [index + 1, index - 1].filter((i) => i >= 0 && i < count);
}

// --- zoom -----------------------------------------------------------------------------------------------
//
// La foto se dibuja "contenida" en el escenario (tamaño `fit`) y encima va `translate(x, y) scale(s)`
// con el origen en el centro. Los puntos (`Point`) se miden desde el centro del escenario.

export interface Zoom {
  scale: number;
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export const NO_ZOOM: Zoom = { scale: 1, x: 0, y: 0 };
export const MAX_SCALE = 5;
/** A cuánto amplía el doble toque o doble clic. */
export const DOUBLE_TAP_SCALE = 2.5;

export const isZoomed = (z: Zoom): boolean => z.scale > 1.01;

/**
 * El tamaño de la foto contenida en el escenario (entera, lo más grande que entre). La miniatura se estira
 * a ese tamaño mientras llega la grande, así no salta.
 */
export function fitSize(natural: Size, stage: Size): Size {
  if (natural.width <= 0 || natural.height <= 0 || stage.width <= 0 || stage.height <= 0) return { width: 0, height: 0 };
  const ratio = Math.min(stage.width / natural.width, stage.height / natural.height);
  return { width: natural.width * ratio, height: natural.height * ratio };
}

/** Deja la foto ampliada sin bordes vacíos de más: no se puede arrastrar más allá de sus lados. */
export function clampZoom(z: Zoom, fit: Size, stage: Size): Zoom {
  const scale = Math.min(MAX_SCALE, Math.max(1, z.scale));
  if (scale <= 1.001) return NO_ZOOM;
  const maxX = Math.max(0, (fit.width * scale - stage.width) / 2);
  const maxY = Math.max(0, (fit.height * scale - stage.height) / 2);
  // `|| 0`: sin -0 (da lo mismo en pantalla, pero se compara más fácil).
  return { scale, x: Math.min(maxX, Math.max(-maxX, z.x)) || 0, y: Math.min(maxY, Math.max(-maxY, z.y)) || 0 };
}

/** Cambia la escala dejando quieto el punto `at` (bajo el cursor o entre los dedos). */
export function zoomAt(z: Zoom, scale: number, at: Point, fit: Size, stage: Size): Zoom {
  const next = Math.min(MAX_SCALE, Math.max(1, scale));
  const k = next / z.scale;
  return clampZoom({ scale: next, x: at.x - k * (at.x - z.x), y: at.y - k * (at.y - z.y) }, fit, stage);
}

/** Doble toque o doble clic: amplía en ese punto, o vuelve a la foto entera. */
export function toggleZoom(z: Zoom, at: Point, fit: Size, stage: Size): Zoom {
  return isZoomed(z) ? NO_ZOOM : zoomAt(z, DOUBLE_TAP_SCALE, at, fit, stage);
}

/**
 * La rueda (o el pellizco del trackpad, que el navegador manda como rueda con Ctrl). La rueda del mouse
 * da saltos grandes (100 px o una línea); el trackpad, muchos chicos.
 */
export function wheelScale(z: Zoom, deltaY: number, deltaMode: number, ctrlKey: boolean): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const k = ctrlKey ? 0.01 : 0.002;
  const factor = Math.exp(-Math.max(-300, Math.min(300, px)) * k);
  return Math.min(MAX_SCALE, Math.max(1, z.scale * factor));
}

/** Arrastrar la foto ampliada. */
export function panBy(z: Zoom, dx: number, dy: number, fit: Size, stage: Size): Zoom {
  return clampZoom({ scale: z.scale, x: z.x + dx, y: z.y + dy }, fit, stage);
}

/**
 * Pellizco: la escala sigue la distancia entre los dedos y el punto que estaba entre ellos al empezar
 * sigue al punto medio de ahora (se puede ampliar y mover a la vez).
 */
export function pinchZoom(start: Zoom, startDistance: number, startMid: Point, distance: number, mid: Point, fit: Size, stage: Size): Zoom {
  if (startDistance <= 0) return start;
  const scale = Math.min(MAX_SCALE, Math.max(1, (start.scale * distance) / startDistance));
  const k = scale / start.scale;
  return clampZoom({ scale, x: mid.x - k * (startMid.x - start.x), y: mid.y - k * (startMid.y - start.y) }, fit, stage);
}

// --- gestos con un dedo (o arrastrando con el mouse) ------------------------------------------------------

/** Cuánto hay que mover antes de decidir qué gesto es (y para que un toque siga siendo un toque). */
export const GESTURE_SLOP = 10;

export type Gesture = 'none' | 'swipe' | 'dismiss' | 'pan';

/**
 * Qué es el arrastre, una vez que pasó `GESTURE_SLOP`: con la foto ampliada se mueve la foto (nunca cambia
 * de elemento, así no chocan); si no, de costado cambia de elemento y hacia abajo cierra. Hacia arriba no
 * hace nada.
 */
export function classifyDrag(dx: number, dy: number, zoomed: boolean): Gesture {
  if (Math.hypot(dx, dy) < GESTURE_SLOP) return 'none';
  if (zoomed) return 'pan';
  if (Math.abs(dx) >= Math.abs(dy)) return 'swipe';
  return dy > 0 ? 'dismiss' : 'none';
}

/** Al soltar un deslizamiento de costado: -1 (anterior), 1 (siguiente) o 0 (vuelve a su lugar). */
export function swipeResult(dx: number, velocity: number, width: number, index: number, count: number): -1 | 0 | 1 {
  const far = Math.abs(dx) > width * 0.2;
  const fast = Math.abs(velocity) > 0.4 && Math.abs(dx) > GESTURE_SLOP * 2;
  if (!far && !fast) return 0;
  const dir = dx < 0 ? 1 : -1;
  const next = stepIndex(index, dir, count);
  return next === index ? 0 : dir;
}

/** Al soltar hacia abajo: cierra si bajó bastante o rápido. */
export function dismissResult(dy: number, velocity: number, height: number): boolean {
  return dy > Math.min(160, height * 0.2) || (velocity > 0.5 && dy > GESTURE_SLOP * 3);
}

/** En los extremos, el deslizamiento se resiste (se mueve menos que el dedo). */
export function resistEdges(dx: number, index: number, count: number): number {
  const atStart = index <= 0 && dx > 0;
  const atEnd = index >= count - 1 && dx < 0;
  return atStart || atEnd ? dx * 0.3 : dx;
}

/** Dos toques seguidos, cerca y rápidos, son un doble toque. */
export function isDoubleTap(prev: { at: number; x: number; y: number } | null, now: { at: number; x: number; y: number }): boolean {
  return !!prev && now.at - prev.at < 300 && Math.hypot(now.x - prev.x, now.y - prev.y) < 30;
}
