import * as Y from 'yjs';
import { unitsFromYDoc, type BlockMeta } from '../search/extract';
import { findUnknownContent } from '../ui/unknownContent';
import { aliasesFromFields, nameKey } from './aliases';
import { FIELD_LABELS, fieldValues, normLabel, readPageFields, type FieldValue } from './fields';
import { findContainer, withEditor, type PrepareDeps } from './prepareDay';

// Escribir otros nombres en la página de una locación (Docs/Doc_Relaciones.md, «Otros nombres de una locación»; D526,
// D543). Para cargar los de un proyecto existente (ERSO) y para *Link to a location…* (D539). Nunca borra ni reescribe:
// - Si la página ya tiene el campo como renglón («Otros nombres: Arenera») o como fila de tabla («Also known as | …»),
//   agrega al final de ese texto lo que falta («, Estudio»): una inserción de Yjs, sin formato (no estira un link ni una
//   negrita del final).
// - Si no lo tiene (o lo tiene como título con una lista abajo), inserta un párrafo «Otros nombres: a, b» como primer
//   bloque, con un editor sin pantalla (como *Prepare*): solo inserta.
// Lo que ya está escrito (sin tildes ni mayúsculas) no se repite: escribir dos veces lo mismo no cambia nada. Dos
// dispositivos que agregan a la vez sin red dejan los dos renglones o los dos textos: al leer, cuentan todos.

const CONTAINER = 'blockContainer';
const GROUP = 'blockGroup';
const ALIAS_KEYS = new Set(FIELD_LABELS.aliases.map(normLabel));

/** El texto de un elemento de texto del Y.Doc (los nodos en línea, como un carácter). */
function plain(el: Y.XmlElement): string {
  let out = '';
  for (const child of el.toArray()) {
    if (child instanceof Y.XmlText) for (const op of child.toDelta() as { insert: unknown }[]) out += typeof op.insert === 'string' ? op.insert : '\uFFFC';
    else out += '\uFFFC';
  }
  return out;
}

/** El primer elemento de texto adentro de una celda (su párrafo). */
function firstTextblock(el: Y.XmlElement): Y.XmlElement | null {
  for (const child of el.toArray()) {
    if (!(child instanceof Y.XmlElement)) continue;
    if (child.toArray().some((c) => c instanceof Y.XmlText) || child.toArray().every((c) => !(c instanceof Y.XmlElement))) return child;
    const inner = firstTextblock(child);
    if (inner) return inner;
  }
  return null;
}

/**
 * Agrega `text` al final de un elemento de texto, sin formato (crea el texto si el elemento está vacío). Devuelve dónde
 * quedó, en posiciones relativas de Yjs (siguen valiendo aunque otros escriban antes o después).
 */
function appendPlain(el: Y.XmlElement, text: string): { start: Y.RelativePosition; end: Y.RelativePosition } {
  const kids = el.toArray();
  const last = kids[kids.length - 1];
  let t: Y.XmlText;
  if (last instanceof Y.XmlText) t = last;
  else {
    t = new Y.XmlText();
    el.insert(el.length, [t]);
  }
  const at = t.length;
  t.insert(at, text, {});
  return { start: Y.createRelativePositionFromTypeIndex(t, at, 0), end: Y.createRelativePositionFromTypeIndex(t, at + text.length, -1) };
}

/** Lo que hace falta para deshacer lo agregado, y solo eso (D539). */
export type AliasUndo =
  | { kind: 'block'; blockId: string; text: string }
  | { kind: 'text'; start: Y.RelativePosition; end: Y.RelativePosition; text: string };

/** El texto plano de un texto de Yjs (sin formato). */
const textOf = (t: Y.XmlText) => (t.toDelta() as { insert: unknown }[]).map((op) => (typeof op.insert === 'string' ? op.insert : '\uFFFC')).join('');

/**
 * Saca lo que agregó `addAliasesInDoc`, solo si sigue exactamente igual: el renglón nuevo (por su id, con el mismo texto y
 * nada adentro) o el tramo agregado al final de un renglón o una celda (por sus posiciones relativas). Si alguien lo
 * cambió, no toca nada (`changed`). Directo en el Y.Doc, en una transacción.
 */
export function removeAddedAliasesInDoc(doc: Y.Doc, undo: AliasUndo): 'removed' | 'changed' {
  if (undo.kind === 'text') {
    const a = Y.createAbsolutePositionFromRelativePosition(undo.start, doc);
    const b = Y.createAbsolutePositionFromRelativePosition(undo.end, doc);
    if (!a || !b || a.type !== b.type || !(a.type instanceof Y.XmlText)) return 'changed';
    const t = a.type;
    if (b.index - a.index !== undo.text.length || textOf(t).slice(a.index, b.index) !== undo.text) return 'changed';
    doc.transact(() => t.delete(a.index, undo.text.length));
    return 'removed';
  }
  const container = findContainer(doc, undo.blockId);
  const parent = container?.parent;
  if (!container || !(parent instanceof Y.XmlElement)) return 'changed';
  const kids = container.toArray().filter((c): c is Y.XmlElement => c instanceof Y.XmlElement);
  const content = kids.find((c) => c.nodeName !== GROUP);
  const nested = kids.some((c) => c.nodeName === GROUP && c.length > 0);
  if (!content || content.nodeName !== 'paragraph' || nested || plain(content) !== undo.text) return 'changed';
  // Que no quede el documento sin bloques (el editor necesita uno).
  if (parent.length <= 1) return 'changed';
  doc.transact(() => {
    const i = parent.toArray().indexOf(container);
    if (i >= 0) parent.delete(i, 1);
  });
  return 'removed';
}

/** El elemento de texto donde va lo nuevo de un campo que ya existe, y lo que ya dice; `null` si no se puede. */
function target(doc: Y.Doc, field: FieldValue): { el: Y.XmlElement; value: string; line: boolean } | null {
  const container = findContainer(doc, field.blockId);
  const content = container?.toArray().find((c): c is Y.XmlElement => c instanceof Y.XmlElement && c.nodeName !== GROUP && c.nodeName !== CONTAINER);
  if (!content) return null;
  if (field.via === 'line') return { el: content, value: field.text, line: true };
  if (field.via !== 'table' || content.nodeName !== 'table') return null;
  // La fila cuyo rótulo es de otros nombres: su segunda celda.
  for (const row of content.toArray()) {
    if (!(row instanceof Y.XmlElement) || row.nodeName !== 'tableRow') continue;
    const cells = row.toArray().filter((c): c is Y.XmlElement => c instanceof Y.XmlElement);
    const label = cells[0] ? firstTextblock(cells[0]) : null;
    if (!label || !ALIAS_KEYS.has(normLabel(plain(label).replace(/[:：]\s*$/, '')))) continue;
    const cell = cells[1] ? firstTextblock(cells[1]) : null;
    return cell ? { el: cell, value: plain(cell), line: false } : null;
  }
  return null;
}

/**
 * Agrega los nombres que falten al campo de otros nombres de la página (el renglón o la fila; si no hay, un renglón
 * `label: a, b` como primer bloque). Devuelve lo agregado y dónde.
 */
export function addAliasesInDoc(doc: Y.Doc, names: string[], label: string): { added: string[]; blockId: string | null; undo?: AliasUndo } {
  const meta: BlockMeta[] = [];
  const units = unitsFromYDoc(doc, meta);
  const fields = readPageFields(units, meta);
  const have = new Set(aliasesFromFields(fields).map(nameKey));
  const added: string[] = [];
  for (const n of names) {
    const t = n.replace(/\s+/g, ' ').trim();
    const k = nameKey(t);
    if (!k || have.has(k)) continue;
    have.add(k);
    added.push(t);
  }
  const existing = fieldValues(fields, 'aliases').find((f) => f.via === 'line' || f.via === 'table') ?? null;
  if (!added.length) return { added, blockId: existing?.blockId ?? null };
  const at = existing ? target(doc, existing) : null;
  if (existing && at) {
    const empty = !at.value.trim();
    const raw = plain(at.el);
    // Después del rótulo («Otros nombres:») va un espacio; después de algo escrito, una coma.
    const sep = empty ? (at.line && !/\s$/.test(raw) ? ' ' : '') : ', ';
    const text = `${sep}${added.join(', ')}`;
    let where: ReturnType<typeof appendPlain> | null = null;
    doc.transact(() => (where = appendPlain(at.el, text)));
    const w = where as ReturnType<typeof appendPlain> | null;
    return { added, blockId: existing.blockId, ...(w ? { undo: { kind: 'text' as const, start: w.start, end: w.end, text } } : {}) };
  }
  let blockId: string | null = null;
  const text = `${label}: ${added.join(', ')}`;
  withEditor(doc, (editor) => {
    const list = editor.document as unknown as { id: string }[];
    const block = { type: 'paragraph', content: [{ type: 'text', text, styles: {} }] };
    const inserted = (list.length ? editor.insertBlocks([block] as never[], list[0].id, 'before') : []) as unknown as { id: string }[];
    blockId = inserted[0]?.id ?? null;
  });
  return { added, blockId, ...(blockId ? { undo: { kind: 'block' as const, blockId, text } } : {}) };
}

export type AddAliasesResult = { status: 'ok'; added: string[]; blockId: string | null; undo?: AliasUndo } | { status: 'missing' | 'unknown' };

/**
 * Agrega nombres a la página `pageId` (la de una locación), con el documento del dispositivo: anda sin red si la página
 * ya está bajada. Si no terminó de bajar se intenta 8 s (`missing`); si tiene algo que esta versión no conoce, no se toca
 * (`unknown`).
 */
export async function addAliasesToPage(deps: PrepareDeps, pageId: string, names: string[], label: string): Promise<AddAliasesResult> {
  let missing = await deps.engine.isMissingContent(pageId).catch(() => true);
  if (missing && deps.engine.prefetchPage) missing = !(await deps.engine.prefetchPage(pageId, 8000).catch(() => false));
  if (missing) return { status: 'missing' };
  const doc = await deps.docs.open(pageId, { seed: true });
  try {
    if (findUnknownContent(doc)) return { status: 'unknown' };
    const out = addAliasesInDoc(doc, names, label);
    await deps.docs.flush(pageId);
    return { status: 'ok', ...out };
  } finally {
    deps.docs.close(pageId);
  }
}

/** *Undo* de `addAliasesToPage`: saca solo lo agregado, y solo si nadie lo cambió (con el documento del dispositivo). */
export async function undoAddedAliases(deps: Pick<PrepareDeps, 'docs'>, pageId: string, undo: AliasUndo): Promise<'removed' | 'changed'> {
  const doc = await deps.docs.open(pageId);
  try {
    if (findUnknownContent(doc)) return 'changed';
    const out = removeAddedAliasesInDoc(doc, undo);
    await deps.docs.flush(pageId);
    return out;
  } finally {
    deps.docs.close(pageId);
  }
}
