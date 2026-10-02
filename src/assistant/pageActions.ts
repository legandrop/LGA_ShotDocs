import { docToBlocks } from '@blocknote/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { asOneUndoStep } from '../ui/undoGuard';
import { snapshotOf, type ApplyOutcome, type Snapshot } from './apply';
import type { AssistantEditor } from './assistantUi';
import { cleanAnswer, collectBetween, escapeMd, parseAnswer, parseInline, type ParseError, type Parsed, type Selected } from './markup';
import { emptySeen } from './mdBlocks';

// La página entera (Docs/Doc_Asistente.md, entrega A2): *Summarize page* y *Translate page*. Se manda el título y el
// contenido actual de la página con las mismas marcas de A1 (6.2): las fotos, los links y los bloques que no son texto
// no viajan, la dirección de un link tampoco. Cada celda de una tabla es su propio pedazo (así se traducen).
//
// - *Translate page* → *Replace page content*: es el mismo reemplazo que A1 sobre la página entera (apply.ts): cada
//   bloque conserva su id, su tipo, sus propiedades y sus fotos (el mismo elemento de Yjs); solo cambia el texto, por
//   palabras, en un paso de deshacer, y nada se aplica si la página cambió mientras el modelo pensaba.
// - *Translate page* → *Create translated subpage*: lo mismo sobre una copia (sin editor ni Yjs), que se escribe en una
//   página nueva adentro de esta por el camino de siempre (`tree.create` y `writeNewPage`, como el reporte del día).
// - *Summarize page*: texto nuevo (mdBlocks.ts), que se agrega arriba o debajo del cursor sin tocar lo que hay.

/** La marca del título en el pedido de la página: el primer bloque, que vuelve traducido con la marca adelante. */
export const TITLE_TOKEN = '⟦title⟧';

/** La página entera, como pedazos (con las celdas de las tablas). */
export function collectPage(state: EditorState): Selected | 'empty' | 'tooLong' {
  return collectBetween(state.doc, 0, state.doc.content.size, { cells: true });
}

export function takePageSnapshot(state: EditorState): Snapshot | 'empty' | 'tooLong' {
  return snapshotOf(state, collectPage(state));
}

/** Lo que se manda de la página: el título (con su marca) y el contenido, separados como dos bloques. */
export function pageMarkdown(title: string, selected: Selected): string {
  const t = escapeMd(title.replace(/\s+/g, ' ').trim()).replace(/<(?=\/?user_content)/gi, '\\<');
  return `${TITLE_TOKEN}${t}\n\n${selected.markdown}`;
}

/** El texto legible de un pedazo de Markdown acotado (sin marcas ni formato). */
function plainInline(src: string): string {
  return parseInline(src, { photos: new Set(), links: new Set() }, emptySeen())
    .map((a) => (a.t === 'char' ? a.ch : ' '))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * La respuesta de *Translate page*: el título traducido (el primer bloque, con su marca) y el contenido, validado
 * como en A1 (los mismos bloques, cada marca una vez). Sin la marca del título adelante: `structure`.
 */
export function parsePageTranslation(answer: string, selected: Selected): { title: string; parsed: Parsed } | ParseError {
  const clean = cleanAnswer(answer);
  if (!clean) return 'empty';
  const split = /\n[ \t]*\n/.exec(clean);
  const first = (split ? clean.slice(0, split.index) : clean).trim().replace(/^#{1,6}[ \t]+/, '');
  if (!first.startsWith(TITLE_TOKEN)) return 'structure';
  const title = plainInline(first.slice(TITLE_TOKEN.length));
  if (!split) return 'structure';
  const parsed = parseAnswer(clean.slice(split.index + split[0].length), selected);
  if (typeof parsed === 'string') return parsed;
  return { title, parsed };
}

interface CopiedBlock {
  id?: string;
  type: string;
  content?: unknown;
  children?: CopiedBlock[];
}

/** Ids nuevos para todos los bloques (una página nueva no repite los de la de origen). */
function renew(blocks: CopiedBlock[]): CopiedBlock[] {
  return blocks.map((b) => ({ ...b, id: crypto.randomUUID(), children: renew(b.children ?? []) }));
}

const isEmptyParagraph = (b: CopiedBlock | undefined) => !!b && b.type === 'paragraph' && Array.isArray(b.content) && b.content.length === 0 && !b.children?.length;

/**
 * Los bloques de la subpágina traducida: el documento con la traducción aplicada (apply.ts, `appliedDoc`), como bloques
 * de BlockNote con ids nuevos. El párrafo vacío del final no va: la página nueva ya tiene el suyo.
 */
export function subpageBlocks(doc: PMNode): unknown[] {
  let blocks = docToBlocks(doc) as unknown as CopiedBlock[];
  if (isEmptyParagraph(blocks.at(-1))) blocks = blocks.slice(0, -1);
  return renew(blocks);
}

/**
 * Agrega un resumen arriba de todo o debajo del bloque del cursor, como UNA edición del editor (un Ctrl/⌘+Z la saca).
 * No toca nada de lo que hay: no hace falta la guarda de "cambió mientras pensaba".
 */
export function insertSummary(editor: AssistantEditor | null, view: EditorView | null, blocks: unknown[], where: 'top' | 'below', canEdit: boolean): ApplyOutcome {
  if (!canEdit || !editor || !view?.editable) return { ok: false, reason: 'readOnly' };
  if (blocks.length === 0) return { ok: true, changed: 0 };
  let reference: string | undefined;
  try {
    reference = where === 'top' ? editor.document[0]?.id : editor.getTextCursorPosition().block.id;
  } catch {
    reference = editor.document[0]?.id;
  }
  if (!reference) return { ok: false, reason: 'failed' };
  const before = view.state.doc;
  try {
    asOneUndoStep(view.state, () => editor.insertBlocks(blocks, reference, where === 'top' ? 'before' : 'after'));
  } catch (err) {
    console.error('Asistente: no se pudo agregar el resumen', err);
    return { ok: false, reason: 'failed' };
  }
  return view.state.doc.eq(before) ? { ok: false, reason: 'failed' } : { ok: true, changed: blocks.length };
}
