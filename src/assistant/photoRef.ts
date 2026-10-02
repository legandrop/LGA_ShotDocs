import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, type EditorState } from '@tiptap/pm/state';

// Qué foto se eligió para *Suggest caption* (Docs/Doc_Asistente.md, entrega A3), dicho sin posiciones (las posiciones
// cambian si alguien escribe antes mientras el modelo mira la foto): el bloque, cuál de sus fotos y su dirección. Va en
// la primera carga (lo usa la barra de la foto) y es chico; lo demás del pie de foto se baja con el panel.

export interface PhotoRef {
  /** `inline`: la foto en línea (un nodo `photo`, también en una celda); `block`: la foto-bloque (`image`). */
  kind: 'inline' | 'block';
  /** El id del bloque que la tiene (en una celda, la tabla). */
  blockId: string;
  /** Cuál de las fotos en línea del bloque es (0 la primera), como la clave del carrete. En una foto-bloque, 0. */
  index: number;
  url: string;
  name: string;
}

/** Dónde está hoy la foto de `ref`, o `null` si ya no está (la borraron, la reemplazaron o se borró su bloque). */
export interface FoundPhoto {
  ref: PhotoRef;
  /** El bloque (`blockContainer`): dónde empieza y dónde termina. */
  blockPos: number;
  blockEnd: number;
  /** La foto en línea: su posición, y el fin del texto que la tiene (en una celda, el de la celda). */
  photoPos?: number;
  textEnd?: number;
  /** La foto en línea está en una celda de tabla. */
  inCell: boolean;
}

const PHOTO = 'photo';

/** Las fotos en línea del contenido de un bloque, en orden: su posición y el nodo. */
function photosIn(container: PMNode, containerPos: number): { pos: number; node: PMNode }[] {
  const content = container.firstChild;
  if (!content) return [];
  const start = containerPos + 2;
  const out: { pos: number; node: PMNode }[] = [];
  content.descendants((child, offset) => {
    if (child.type.name === PHOTO) out.push({ pos: start + offset, node: child });
    return true;
  });
  return out;
}

/** El `blockContainer` que tiene a `pos`, con su posición. */
function containerAt(doc: PMNode, pos: number): { node: PMNode; pos: number } | null {
  const $pos = doc.resolve(pos);
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === 'blockContainer') return { node, pos: $pos.before(d) };
  }
  return null;
}

/** La foto en línea en `pos` (un nodo `photo`), dicha sin posiciones. */
export function inlinePhotoRef(doc: PMNode, pos: number): PhotoRef | null {
  const node = doc.nodeAt(pos);
  if (!node || node.type.name !== PHOTO) return null;
  const owner = containerAt(doc, pos);
  if (!owner) return null;
  const index = photosIn(owner.node, owner.pos).findIndex((p) => p.pos === pos);
  if (index < 0) return null;
  return { kind: 'inline', blockId: String(owner.node.attrs.id ?? ''), index, url: String(node.attrs.url ?? ''), name: String(node.attrs.name ?? '') };
}

/**
 * La foto elegida en la página: una foto en línea sola (elegida con un clic), o la foto-bloque donde está la selección.
 * `null` con otra cosa (texto, varias fotos, nada).
 */
export function selectedPhotoRef(state: EditorState): PhotoRef | null {
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.node.type.name === PHOTO) return inlinePhotoRef(state.doc, sel.from);
  const from = containerAt(state.doc, sel.from);
  const to = containerAt(state.doc, sel.to);
  if (!from || !to || from.pos !== to.pos) return null;
  const content = from.node.firstChild;
  if (content?.type.name !== 'image') return null;
  return { kind: 'block', blockId: String(from.node.attrs.id ?? ''), index: 0, url: String(content.attrs.url ?? ''), name: String(content.attrs.name ?? '') };
}

/**
 * La foto de `ref` en el documento de hoy (la guarda de "cambió mientras pensaba"): el mismo bloque y la misma
 * dirección. Si alguien agregó o sacó otra foto del mismo bloque, se la busca por su dirección (si es la única con esa).
 */
export function findPhoto(doc: PMNode, ref: PhotoRef): FoundPhoto | null {
  let found: FoundPhoto | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name !== 'blockContainer') return true;
    if (String(node.attrs.id ?? '') !== ref.blockId) return true;
    const blockEnd = pos + node.nodeSize;
    if (ref.kind === 'block') {
      const content = node.firstChild;
      if (content?.type.name === 'image' && String(content.attrs.url ?? '') === ref.url) found = { ref, blockPos: pos, blockEnd, inCell: false };
      return false;
    }
    const photos = photosIn(node, pos);
    const same = photos.filter((p) => String(p.node.attrs.url ?? '') === ref.url);
    const at = photos[ref.index] && String(photos[ref.index].node.attrs.url ?? '') === ref.url ? photos[ref.index] : same.length === 1 ? same[0] : null;
    if (at) {
      const $pos = doc.resolve(at.pos);
      let inCell = false;
      for (let d = $pos.depth; d > 0; d--) {
        const name = $pos.node(d).type.name;
        if (name === 'tableCell' || name === 'tableHeader') inCell = true;
      }
      found = { ref, blockPos: pos, blockEnd, photoPos: at.pos, textEnd: $pos.end(), inCell };
    }
    return false;
  });
  return found;
}
