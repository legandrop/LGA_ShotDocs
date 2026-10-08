import type { Node as PMNode } from '@tiptap/pm/model';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';

// Qué texto tiene cada bloque, para buscar (Docs/Doc_Buscar.md, sección 4 y corrección 5). Una sola regla con
// dos entradas: el documento de ProseMirror del editor abierto (la barra de la página) y el Y.Doc guardado
// (la búsqueda del proyecto, entrega 2). Las dos dan las mismas unidades, en el mismo orden, así "la tercera
// coincidencia de este bloque" es la misma en los dos lados.
//
// - Cada bloque (`blockContainer`, con su id) da una unidad por cada bloque de texto que tiene adentro: un
//   párrafo, un título o un ítem da una; una tabla, una por celda con texto.
// - Lo que no es texto adentro de un bloque de texto (un salto de línea, cualquier nodo en línea) cuenta como
//   un separador (`SEPARATOR`): una búsqueda nunca lo cruza. Lo mismo un "\n" adentro del texto (los
//   renglones de un bloque de código).
// - Un bloque con `caption` o `name` (fotos, videos y adjuntos: el bloque `image`) da una unidad por cada uno
//   que no esté vacío: primero el pie y después el nombre.
// - Los hijos anidados (`blockGroup`) son bloques propios, después del de arriba.
// - Las unidades vacías o solo con espacios no se cuentan.

export type UnitField = 'text' | 'caption' | 'name';

export interface SearchUnit {
  blockId: string;
  field: UnitField;
  text: string;
}

/** Una unidad del documento de ProseMirror: para `text`, la posición de cada parte del texto. */
export interface PMUnit extends SearchUnit {
  /** Posición del `blockContainer`. */
  blockPos: number;
  /** El nodo del contenido del bloque (para `caption` y `name`, lo que se resalta entero). */
  nodePos: number;
  nodeSize: number;
  /** Tramos de texto: dónde empieza cada uno en `text` y en el documento. Vacío para `caption` y `name`. */
  pieces: { at: number; pos: number; length: number }[];
  /** El bloque de texto de ProseMirror (para `text`): mientras no cambie, su texto es el mismo. */
  node?: PMNode;
}

// No es un espacio (`\s`): los espacios seguidos cuentan como uno, y un salto de línea no tiene que unir dos
// palabras de renglones distintos.
export const SEPARATOR = '\uFFFC';
const NESTED = 'blockGroup';
const CONTAINER = 'blockContainer';

/** Un salto de línea adentro del texto (un bloque de código) también separa: nunca se une ni se cruza. */
function lines(text: string): string {
  return text.includes('\n') ? text.replaceAll('\n', SEPARATOR) : text;
}

function keep(text: string): boolean {
  return text.split(SEPARATOR).join('').trim().length > 0;
}

// --- ProseMirror -------------------------------------------------------------------------------------------

/** Las unidades del documento de ProseMirror del editor. */
export function unitsFromPM(doc: PMNode): PMUnit[] {
  const out: PMUnit[] = [];
  const visitGroup = (group: PMNode, pos: number) => {
    group.forEach((child, offset) => {
      const at = pos + 1 + offset;
      if (child.type.name === CONTAINER) visitContainer(child, at);
    });
  };
  const visitContainer = (container: PMNode, pos: number) => {
    const blockId = String(container.attrs.id ?? '');
    let nested: { node: PMNode; pos: number } | null = null;
    container.forEach((child, offset) => {
      const at = pos + 1 + offset;
      if (child.type.name === NESTED) {
        nested = { node: child, pos: at };
        return;
      }
      // El contenido del bloque.
      collectText(child, at, blockId, pos, out);
      for (const field of ['caption', 'name'] as const) {
        const value = child.attrs[field];
        if (typeof value === 'string' && keep(value)) {
          out.push({ blockId, field, text: value, blockPos: pos, nodePos: at, nodeSize: child.nodeSize, pieces: [] });
        }
      }
    });
    if (nested) visitGroup((nested as { node: PMNode }).node, (nested as { pos: number }).pos);
  };
  doc.forEach((child, offset) => {
    if (child.type.name === NESTED) visitGroup(child, offset);
    else if (child.type.name === CONTAINER) visitContainer(child, offset);
  });
  return out;
}

function collectText(node: PMNode, pos: number, blockId: string, blockPos: number, out: PMUnit[]): void {
  if (node.isTextblock) {
    let text = '';
    const pieces: PMUnit['pieces'] = [];
    node.forEach((child, offset) => {
      if (child.isText) {
        pieces.push({ at: text.length, pos: pos + 1 + offset, length: child.text!.length });
        text += lines(child.text!);
      } else {
        text += SEPARATOR;
      }
    });
    if (keep(text)) out.push({ blockId, field: 'text', text, blockPos, nodePos: pos, nodeSize: node.nodeSize, pieces, node });
    return;
  }
  node.forEach((child, offset) => {
    if (child.type.name === NESTED || child.type.name === CONTAINER) return;
    collectText(child, pos + 1 + offset, blockId, blockPos, out);
  });
}

/** La posición en el documento de un lugar del texto de una unidad (`text`). */
export function unitPos(unit: PMUnit, at: number): number {
  let last = unit.pieces[0];
  for (const piece of unit.pieces) {
    if (piece.at > at) break;
    last = piece;
  }
  if (!last) return unit.blockPos;
  return last.pos + Math.min(at - last.at, last.length);
}

// --- Yjs ---------------------------------------------------------------------------------------------------

/**
 * Lo que las relaciones en vivo (Docs/Doc_Relaciones.md, sección 3) necesitan de un bloque además de su texto, leído en
 * la misma pasada que la búsqueda. Solo para los bloques que tienen algo de esto (un título, fotos o links a páginas):
 * los demás se reconocen por sus unidades.
 */
export interface BlockMeta {
  blockId: string;
  /** Dónde va: cuántas unidades hay antes de este bloque (sus unidades, si tiene, empiezan ahí). */
  at: number;
  /** El nivel de título (1, 2, 3…); 0 si no es un título. */
  level: number;
  /** Los ids de `sdmedia://` del bloque (de bloque o en línea), sin los de sus hijos anidados. */
  media?: string[];
  /** Los links a páginas de la app en sus unidades: la unidad (índice entre todas), dónde y a qué página. */
  links?: { unit: number; start: number; end: number; pageId: string }[];
  /**
   * Una tabla: dónde cae cada unidad (índice entre todas) en sus filas y columnas, y cuántas columnas tiene. Con esto se
   * leen los campos «rótulo | valor» de una ficha (`src/relations/fields.ts`): las unidades solas no dicen dónde
   * termina una fila, y una celda vacía no da unidad.
   */
  cells?: { unit: number; row: number; col: number }[];
  cols?: number;
}

const MEDIA_SCHEME = 'sdmedia://';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** La foto o archivo de una dirección `sdmedia://<id>` (como `mediaIdOf`, sin cargar la cola de archivos). */
function mediaOf(url: unknown): string | null {
  if (typeof url !== 'string' || !url.startsWith(MEDIA_SCHEME)) return null;
  const id = url.slice(MEDIA_SCHEME.length).toLowerCase();
  return UUID.test(id) ? id : null;
}

/** La página de un link de la app (`/p/<id>` o la dirección entera, de cualquier origen), o `null`. */
export function linkedPageId(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  const m = /^(?:[a-z][a-z0-9+.-]*:\/\/[^/?#]*)?\/p\/([^/?#]+)\/?(?:[?#].*)?$/i.exec(href.trim());
  return m && UUID.test(m[1]) ? m[1].toLowerCase() : null;
}

/**
 * Las unidades de un Y.Doc guardado (sin editor y sin depender del esquema). Con `meta`, junta además lo de cada bloque
 * que usan las relaciones (`BlockMeta`), sin cambiar las unidades.
 */
export function unitsFromYDoc(doc: Y.Doc, meta?: BlockMeta[]): SearchUnit[] {
  const out: SearchUnit[] = [];
  const fragment = doc.getXmlFragment(CONTENT_FRAGMENT);
  for (const child of fragment.toArray()) visitYNode(child, out, meta);
  return out;
}

function visitYNode(node: Y.XmlElement | Y.XmlText | Y.XmlHook, out: SearchUnit[], meta?: BlockMeta[]): void {
  if (!(node instanceof Y.XmlElement)) return;
  if (node.nodeName === NESTED) {
    for (const child of node.toArray()) visitYNode(child, out, meta);
    return;
  }
  if (node.nodeName !== CONTAINER) return;
  const blockId = String(node.getAttribute('id') ?? '');
  const at = out.length;
  const extra: BlockMeta | null = meta ? { blockId, at, level: 0 } : null;
  let nested: Y.XmlElement | null = null;
  for (const child of node.toArray()) {
    if (!(child instanceof Y.XmlElement)) continue;
    if (child.nodeName === NESTED) {
      nested = child;
      continue;
    }
    if (extra) {
      if (child.nodeName === 'heading') extra.level = Math.max(1, Number(child.getAttribute('level')) || 1);
      collectMedia(child, extra);
    }
    if (extra && child.nodeName === TABLE) collectTable(child, blockId, out, extra);
    else collectYText(child, blockId, out, extra);
    for (const field of ['caption', 'name'] as const) {
      const value = child.getAttribute(field) as unknown;
      if (typeof value === 'string' && keep(value)) out.push({ blockId, field, text: value });
    }
  }
  if (extra && (extra.level > 0 || extra.media || extra.links || extra.cells)) meta!.push(extra);
  if (nested) visitYNode(nested, out, meta);
}

const TABLE = 'table';

/**
 * Una tabla, celda por celda: las mismas unidades que `collectYText` (en el mismo orden), y además la fila y la columna
 * de cada una. Lo que no es una fila (no debería haber) se lee como antes.
 */
function collectTable(table: Y.XmlElement, blockId: string, out: SearchUnit[], extra: BlockMeta): void {
  const cells: NonNullable<BlockMeta['cells']> = [];
  let row = 0;
  let cols = 0;
  for (const r of table.toArray()) {
    if (!(r instanceof Y.XmlElement)) continue;
    if (r.nodeName !== 'tableRow') {
      collectYText(r, blockId, out, extra);
      continue;
    }
    let col = 0;
    for (const c of r.toArray()) {
      if (!(c instanceof Y.XmlElement)) continue;
      const before = out.length;
      collectYText(c, blockId, out, extra);
      for (let i = before; i < out.length; i++) cells.push({ unit: i, row, col });
      col += Math.max(1, Number(c.getAttribute('colspan')) || 1);
    }
    cols = Math.max(cols, col);
    row++;
  }
  if (cells.length) {
    extra.cells = cells;
    extra.cols = cols;
  }
}

function collectMedia(el: Y.XmlElement, extra: BlockMeta): void {
  const id = mediaOf(el.getAttribute('url'));
  if (id) {
    extra.media ??= [];
    if (!extra.media.includes(id)) extra.media.push(id);
  }
  for (const child of el.toArray()) {
    if (child instanceof Y.XmlElement && child.nodeName !== NESTED && child.nodeName !== CONTAINER) collectMedia(child, extra);
  }
}

/** Un elemento es un bloque de texto si tiene texto adentro, o si no tiene ningún elemento hijo. */
function isYTextblock(el: Y.XmlElement): boolean {
  const kids = el.toArray();
  return kids.some((k) => k instanceof Y.XmlText) || kids.every((k) => !(k instanceof Y.XmlElement) || isInlineLeaf(k));
}

/** Un nodo en línea sin texto adentro (un salto de línea). */
function isInlineLeaf(el: Y.XmlElement): boolean {
  return el.length === 0 && el.nodeName !== NESTED && el.nodeName !== CONTAINER;
}

function collectYText(el: Y.XmlElement, blockId: string, out: SearchUnit[], extra: BlockMeta | null = null): void {
  if (isYTextblock(el)) {
    let text = '';
    const links: { start: number; end: number; pageId: string }[] = [];
    for (const child of el.toArray()) {
      if (child instanceof Y.XmlText) {
        for (const op of child.toDelta() as { insert: unknown; attributes?: { link?: { href?: unknown } } }[]) {
          const piece = typeof op.insert === 'string' ? lines(op.insert) : SEPARATOR;
          const pageId = extra ? linkedPageId(op.attributes?.link?.href) : null;
          if (pageId) {
            const last = links[links.length - 1];
            // Un mismo link partido en pedazos (negrita en el medio) es uno solo.
            if (last && last.end === text.length && last.pageId === pageId) last.end += piece.length;
            else links.push({ start: text.length, end: text.length + piece.length, pageId });
          }
          text += piece;
        }
      } else {
        text += SEPARATOR;
      }
    }
    if (keep(text)) {
      if (extra && links.length) (extra.links ??= []).push(...links.map((l) => ({ unit: out.length, ...l })));
      out.push({ blockId, field: 'text', text });
    }
    return;
  }
  for (const child of el.toArray()) {
    if (child instanceof Y.XmlElement && child.nodeName !== NESTED && child.nodeName !== CONTAINER) collectYText(child, blockId, out, extra);
  }
}
