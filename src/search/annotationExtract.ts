import * as Y from 'yjs';
import { PHOTO_MARKUP_MAP, readAllMarkup } from '../media/markup';
import { mediaIdOf } from '../media/queue';
import { CONTENT_FRAGMENT } from '../sync/structure';

export interface AnnotationUnit {
  field: 'annotation';
  blockId: string;
  fileId: string;
  shapeId: string;
  text: string;
}

// Sólo contenido que admite fotos en el esquema actual; un bloque futuro no se interpreta por tener URL.
const INLINE_BLOCKS = new Set(['paragraph', 'heading', 'bulletListItem', 'numberedListItem', 'checkListItem', 'toggleListItem', 'quote']);
const TABLE_NODES = new Set(['table', 'tableRow', 'tableCell', 'tableHeader', 'tableParagraph']);

/** Texto válido de fotos presentes, una vez por UUID/forma. Sin editor, originales ni escrituras. */
export function annotationUnitsFromYDoc(doc: Y.Doc): AnnotationUnit[] {
  const references = new Map<string, string>();
  const photo = (node: Y.XmlElement, blockId: string) => {
    const url = node.getAttribute('url') as unknown;
    const id = typeof url === 'string' ? mediaIdOf(url) : null;
    if (id && !references.has(id)) references.set(id, blockId);
  };
  const inline = (node: Y.XmlElement, blockId: string, table: boolean) => {
    for (const child of node.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;
      if (child.nodeName === 'photo') photo(child, blockId);
      else if (table && TABLE_NODES.has(child.nodeName)) inline(child, blockId, true);
    }
  };
  const visit = (node: Y.XmlElement | Y.XmlText | Y.XmlHook) => {
    if (!(node instanceof Y.XmlElement)) return;
    if (node.nodeName === 'blockGroup') { node.toArray().forEach(visit); return; }
    if (node.nodeName !== 'blockContainer') return;
    const id = node.getAttribute('id');
    if (typeof id !== 'string' || !id) return;
    let nested: Y.XmlElement | null = null;
    for (const child of node.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;
      if (child.nodeName === 'blockGroup') nested = child;
      else if (child.nodeName === 'image') photo(child, id);
      else if (INLINE_BLOCKS.has(child.nodeName) || child.nodeName === 'table') inline(child, id, child.nodeName === 'table');
    }
    if (nested) visit(nested);
  };
  doc.getXmlFragment(CONTENT_FRAGMENT).toArray().forEach(visit);
  const markup = readAllMarkup(doc.getMap(PHOTO_MARKUP_MAP));
  const units: AnnotationUnit[] = [];
  for (const [fileId, blockId] of references) {
    for (const shape of markup.get(fileId)?.shapes ?? []) {
      if (shape.type === 'text' && shape.text.trim()) units.push({ field: 'annotation', blockId, fileId, shapeId: shape.id, text: shape.text });
    }
  }
  return units;
}
