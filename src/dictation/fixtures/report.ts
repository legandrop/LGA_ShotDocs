import type { PartialBlock } from '@blocknote/core';
import { TextSelection } from '@tiptap/pm/state';
import * as Y from 'yjs';
import { builtinBlocks, type TemplateBlock } from '../../templates/builtin';
import { mountEditor, undoManager, view, type Editor } from '../../ui/collabHarness';
import type { ValidateContext } from '../answer';
import { buildPageMap, type PageMap, type Target } from '../pageMap';

// Un *On-Set Report* para las pruebas del dictado (solo lo usan las pruebas): la plantilla de fábrica con un día a medio
// llenar. *Setups & takes* con dos filas del 12_010 y una vacía; la ficha con el lugar; *Weather & light* vacío.

type Rows = { cells: unknown[] }[];

/** Las filas de *Setups & takes* que se escriben (las demás quedan como las trae la plantilla). */
export const SETUPS: unknown[][] = [
  ['12 · 010 · 1', 'A · A001C003', '35 mm · ND .6', 'T2.8 · 2,5 m', '', '24 · 180°', '3'],
  ['12 · 010 · 3', '', '', '', '', '', ''],
  ['', '', '', '', '', '', ''],
];

/** Los bloques de la plantilla, con *Setups & takes* llenada con `setups` y la ficha con `facts`. */
export function reportBlocks(lang: 'en' | 'es' = 'en', opts: { setups?: unknown[][]; location?: string } = {}): TemplateBlock[] {
  const blocks = builtinBlocks('onset', lang);
  const tables = blocks.filter((b) => b.type === 'table') as { content: { rows: Rows } }[];
  const [facts, , setups] = tables;
  facts.content.rows[2].cells[1] = opts.location ?? 'Nave 2';
  const header = setups.content.rows[0];
  setups.content.rows = [header, ...(opts.setups ?? SETUPS).map((cells) => ({ cells }))];
  return blocks;
}

export function reportEditor(blocks: unknown[] = reportBlocks(), doc = new Y.Doc(), name = 'u'): Editor {
  const ed = mountEditor(doc, name);
  ed.replaceBlocks(ed.document, blocks as PartialBlock[]);
  undoManager(ed).stopCapturing();
  return ed;
}

export function mapOf(ed: Editor, title = '2026-10-02 | Day 06'): PageMap {
  const map = buildPageMap(view(ed).state, title);
  if (typeof map === 'string') throw new Error(map);
  return map;
}

/** El lugar del mapa con ese texto (y ese código), para escribir pruebas sin depender de los números de bloque. */
export function targetBy(map: PageMap, test: (t: Target) => boolean): Target {
  const t = [...map.targets.values()].find(test);
  if (!t) throw new Error('no está');
  return t;
}

/** Pone el cursor en el principio de un lugar del mapa. */
export function cursorAt(ed: Editor, t: Target): void {
  const v = view(ed);
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, t.start)));
}

/** El texto de una celda de una tabla (por el número de tabla, fila y columna) en el editor de ahora. */
export function cellText(ed: Editor, table: number, row: number, col: number): string {
  let n = 0;
  let out: string | null = null;
  view(ed).state.doc.descendants((node) => {
    if (out !== null) return false;
    if (node.type.name === 'table') {
      n++;
      if (n === table) out = node.child(row - 1).child(col - 1).textContent;
      return false;
    }
    return true;
  });
  return out ?? '';
}

/** Cuántas filas tiene una tabla (por su número). */
export function rowCount(ed: Editor, table: number): number {
  let n = 0;
  let out = 0;
  view(ed).state.doc.descendants((node) => {
    if (node.type.name !== 'table') return true;
    if (++n === table) out = node.childCount;
    return false;
  });
  return out;
}

/** Una respuesta del modelo como JSON. */
export const answer = (changes: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ heard: 'nota', changes, ask: null, unplaced: '', ...extra });

/** Los textos del destino (los de la interfaz en inglés). */
export const WORDS: ValidateContext['words'] = {
  row: (n) => `row ${n}`,
  newRow: (s) => `new: ${s}`,
  addRow: (a) => `New row after ${a}`,
  newSection: (t) => `New section: ${t}`,
};
