import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { mediaIdOf } from '../media/queue';
import { MAX_POINTS, MAX_SHAPES, MAX_TEXT, PHOTO_MARKUP_MAP, parseMarkupKey, readAllMarkup, readFrame, type MarkupFrame, type PhotoMarkup } from '../media/markup';
import { MAX_DRAWN_CHARS } from './markupSvg';

export interface AnnotationSide {
  referenced: boolean;
  name: string | null;
  frame: MarkupFrame | null;
  photo: PhotoMarkup | null;
  partial: boolean;
}
export interface AnnotationChange {
  fileId: string;
  before: AnnotationSide;
  selected: AnnotationSide;
  added: number;
  removed: number;
  changed: number;
  frameChanged: boolean;
  partial: boolean;
  counts: boolean;
}
export interface AnnotationComparison { cards: AnnotationChange[]; partial: boolean }

// Sólo campos que el lector actual representa. Lo futuro se conserva en el documento y se anuncia como parcial.
const FIELDS = new Set(('type zValue posX posY rotation strokeColor strokeWidth strokeOpacity fillColor fillOpacity fillMode strokeCap rectX rectY rectW rectH cornerRadius startX startY endX endY headStyle headPosition arrowHeadSize points text fontSize bold italic alignment textColor padding number numberColor').split(' '));

function references(doc: Y.Doc): Map<string, string | null> {
  const names = new Map<string, Set<string>>();
  const stack: unknown[] = doc.getXmlFragment(CONTENT_FRAGMENT).toArray();
  while (stack.length) {
    const node = stack.pop();
    if (!(node instanceof Y.XmlElement)) continue;
    const attrs = node.getAttributes();
    const id = typeof attrs.url === 'string' ? mediaIdOf(attrs.url) : null;
    if (id) {
      let set = names.get(id);
      if (!set) names.set(id, (set = new Set()));
      set.add(typeof attrs.name === 'string' ? attrs.name.trim() : '');
    }
    stack.push(...node.toArray());
  }
  return new Map([...names].map(([id, set]) => [id, set.size === 1 ? [...set][0] || null : null]));
}

function source(doc: Y.Doc) {
  const refs = references(doc);
  const map = doc.getMap<unknown>(PHOTO_MARKUP_MAP);
  const photos = readAllMarkup(map);
  const shapes = new Map<string, unknown[]>();
  let unknown = false;
  for (const [key, value] of map) {
    const parsed = parseMarkupKey(key);
    if (!parsed) { unknown = true; continue; }
    if (!parsed.shapeId) continue;
    let list = shapes.get(parsed.fileId);
    if (!list) shapes.set(parsed.fileId, (list = []));
    list.push(value);
  }
  const side = (id: string): AnnotationSide => {
    const referenced = refs.has(id);
    if (!referenced) return { referenced, name: null, frame: null, photo: null, partial: false };
    const frame = readFrame(map.get(id));
    const photo = photos.get(id) ?? null;
    const raw = shapes.get(id) ?? [];
    let partial = (map.has(id) && !frame) || (raw.length > 0 && !frame) || (frame?.v ?? 1) > 1 || raw.length > MAX_SHAPES;
    const represented = photo?.shapes.length ?? 0;
    if (represented !== raw.length) partial = true;
    for (const value of raw) {
      const fields = value instanceof Y.Map ? [...value] : value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : [];
      if (!fields.length) partial = true;
      for (const [key, field] of fields) {
        if (!FIELDS.has(key)) partial = true;
        if (key === 'points' && Array.isArray(field) && field.length > MAX_POINTS * 2) partial = true;
        if (key === 'text' && typeof field === 'string' && field.length > MAX_TEXT) partial = true;
      }
    }
    if ((photo?.shapes.reduce((n, shape) => n + (shape.type === 'text' ? shape.text.length : 0), 0) ?? 0) > MAX_DRAWN_CHARS) partial = true;
    return { referenced, name: refs.get(id) ?? null, frame, photo, partial };
  };
  return { refs, side, unknown, empty: map.size === 0 && refs.size === 0 };
}

/** Diferencias representables de dos copias históricas; nunca observa ni escribe el documento de la página. */
export function compareAnnotations(beforeDoc: Y.Doc, selectedDoc: Y.Doc): AnnotationComparison {
  const a = source(beforeDoc), b = source(selectedDoc);
  const cards: AnnotationChange[] = [];
  for (const fileId of new Set([...a.refs.keys(), ...b.refs.keys()])) {
    const before = a.side(fileId), selected = b.side(fileId);
    const oldShapes = new Map(before.photo?.shapes.map((s) => [s.id, s]) ?? []);
    const newShapes = new Map(selected.photo?.shapes.map((s) => [s.id, s]) ?? []);
    let added = 0, removed = 0, changed = 0;
    for (const [id, shape] of newShapes) {
      if (!oldShapes.has(id)) added++;
      else if (JSON.stringify(oldShapes.get(id)) !== JSON.stringify(shape)) changed++;
    }
    for (const id of oldShapes.keys()) if (!newShapes.has(id)) removed++;
    const frameChanged = JSON.stringify(before.frame) !== JSON.stringify(selected.frame);
    const partial = before.partial || selected.partial;
    const hasDrawingData = !!before.frame || !!selected.frame || partial;
    if (!hasDrawingData || (!added && !removed && !changed && !frameChanged && !partial)) continue;
    cards.push({ fileId, before, selected, added, removed, changed, frameChanged, partial, counts: !partial && ((before.referenced && selected.referenced) || a.empty) });
  }
  return { cards, partial: a.unknown || b.unknown };
}

/** Un contador local: también invalida antes de que React termine de mostrar una entrada apartada. */
export class AnnotationAttempt {
  private value = 0;
  invalidate(): void { this.value++; }
  start(): number { this.invalidate(); return this.value; }
  current(token: number): boolean { return token === this.value; }
}
