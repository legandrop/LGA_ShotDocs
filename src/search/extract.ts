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

/** Las unidades de un Y.Doc guardado (sin editor y sin depender del esquema). */
export function unitsFromYDoc(doc: Y.Doc): SearchUnit[] {
  const out: SearchUnit[] = [];
  const fragment = doc.getXmlFragment(CONTENT_FRAGMENT);
  for (const child of fragment.toArray()) visitYNode(child, out);
  return out;
}

function visitYNode(node: Y.XmlElement | Y.XmlText | Y.XmlHook, out: SearchUnit[]): void {
  if (!(node instanceof Y.XmlElement)) return;
  if (node.nodeName === NESTED) {
    for (const child of node.toArray()) visitYNode(child, out);
    return;
  }
  if (node.nodeName !== CONTAINER) return;
  const blockId = String(node.getAttribute('id') ?? '');
  let nested: Y.XmlElement | null = null;
  for (const child of node.toArray()) {
    if (!(child instanceof Y.XmlElement)) continue;
    if (child.nodeName === NESTED) {
      nested = child;
      continue;
    }
    collectYText(child, blockId, out);
    for (const field of ['caption', 'name'] as const) {
      const value = child.getAttribute(field) as unknown;
      if (typeof value === 'string' && keep(value)) out.push({ blockId, field, text: value });
    }
  }
  if (nested) visitYNode(nested, out);
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

function collectYText(el: Y.XmlElement, blockId: string, out: SearchUnit[]): void {
  if (isYTextblock(el)) {
    let text = '';
    for (const child of el.toArray()) {
      if (child instanceof Y.XmlText) {
        for (const op of child.toDelta() as { insert: unknown }[]) text += typeof op.insert === 'string' ? lines(op.insert) : SEPARATOR;
      } else {
        text += SEPARATOR;
      }
    }
    if (keep(text)) out.push({ blockId, field: 'text', text });
    return;
  }
  for (const child of el.toArray()) {
    if (child instanceof Y.XmlElement && child.nodeName !== NESTED && child.nodeName !== CONTAINER) collectYText(child, blockId, out);
  }
}
