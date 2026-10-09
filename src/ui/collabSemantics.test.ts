// @vitest-environment jsdom
import type { BlockNoteEditor, PartialBlock } from '@blocknote/core';
import { afterEach, expect, it } from 'vitest';
import * as Y from 'yjs';
import { caretAt, connect, mountEditor, press, sameDocs, showsDoc, tick, typeAt, unmountAll, view, yText } from './collabHarness';

// Qué pasa cuando dos personas cambian el mismo bloque a la vez, sin red entre medio (Docs/Doc_Colaboracion.md).
// Son las escenas S1–S13 y C1–C9 de la investigación, con la reparación de la app. Casi todo lo que se pierde
// acá es como funciona y-prosemirror 1.x: cambiar el tipo, sangrar, mover o juntar un bloque lo BORRA y lo
// vuelve a crear, así que lo que el otro escribía en ese bloque a la vez se pierde con el original. No es un
// error de la app ni se puede arreglar sin cambiar de librería (ver el documento).
//
// Esta prueba documenta eso: si al actualizar BlockNote o y-prosemirror algo cambia (para bien o para mal),
// falla, y hay que revisar el documento. Lo que sí se exige siempre: los dos terminan iguales y cada editor
// muestra lo que dice el documento.

afterEach(unmountAll);

const initial: PartialBlock[] = [
  { id: 'h1', type: 'heading', props: { level: 1 }, content: 'Title' },
  { id: 'p1', type: 'paragraph', content: 'alpha beta' },
  { id: 'p2', type: 'paragraph', content: 'gamma delta' },
  { id: 'p3', type: 'paragraph', content: 'epsilon' },
] as never;

type Op = (E: BlockNoteEditor) => void;
const tab = (id: string): Op => (E) => {
  caretAt(E, id, 'start');
  press(E, 'Tab');
};
const join = (id: string): Op => (E) => {
  caretAt(E, id, 'start');
  press(E, 'Backspace');
};
const retype = (id: string, level = 2): Op => (E) => void E.updateBlock(id, { type: 'heading', props: { level } } as never);
const type = (id: string, where: 'start' | 'end', text: string): Op => (E) =>
  typeAt(E, id, where, where === 'end' ? ` ${text}` : `${text} `);
const split = (id: string, at: number): Op => (E) => {
  caretAt(E, id, at);
  press(E, 'Enter');
};
const move = (id: string, dir: 'up' | 'down'): Op => (E) => {
  caretAt(E, id, 'start');
  const e = E as unknown as { moveBlocksUp: () => void; moveBlocksDown: () => void };
  if (dir === 'up') e.moveBlocksUp();
  else e.moveBlocksDown();
};
/** Borra con una selección que va del medio de p1 al medio de p2. */
const deleteAcross: Op = (E) => {
  const v = view(E);
  let from = 0;
  let to = 0;
  v.state.doc.descendants((n, p) => {
    if (n.type.name === 'blockContainer' && n.attrs.id === 'p1') from = p + 5;
    if (n.type.name === 'blockContainer' && n.attrs.id === 'p2') to = p + 5;
    return true;
  });
  v.dispatch(v.state.tr.setSelection((v.state.selection.constructor as never as { create: (...a: unknown[]) => never }).create(v.state.doc, from, to)));
  press(E, 'Backspace');
};

interface Scene {
  name: string;
  a: Op;
  b: Op;
  /** Texto que tiene que estar al final. */
  kept: string[];
  /** Texto que se pierde (lo inherente de y-prosemirror, ver arriba). */
  lost?: string[];
  /** Texto que tiene que quedar exactamente una vez. */
  once?: string[];
}

const scenes: Scene[] = [
  { name: 'S1 los dos escriben en el mismo párrafo', a: type('p1', 'end', 'AAA'), b: type('p1', 'start', 'BBB'), kept: ['AAA', 'BBB', 'alpha beta'] },
  { name: 'S2 A escribe en p1, B lo borra', a: type('p1', 'end', 'AAA'), b: (B) => void B.removeBlocks(['p1']), kept: ['gamma delta'], lost: ['AAA', 'alpha'] },
  { name: 'S3 A escribe en p1, B le cambia el tipo', a: type('p1', 'end', 'AAA'), b: retype('p1'), kept: ['alpha beta'], lost: ['AAA'] },
  { name: 'S4 A escribe en p2, B lo sangra', a: type('p2', 'end', 'AAA'), b: tab('p2'), kept: ['gamma delta'], lost: ['AAA'] },
  { name: 'S5 A escribe en p2, B lo junta con p1', a: type('p2', 'end', 'AAA'), b: join('p2'), kept: ['alpha betagamma delta'], lost: ['AAA'] },
  { name: 'S6 A escribe al final de p2, B lo divide', a: type('p2', 'end', 'AAA'), b: split('p2', 5), kept: ['AAA', 'gamma', 'delta'] },
  { name: 'S6b A escribe al principio de p2, B lo divide', a: type('p2', 'start', 'AAA'), b: split('p2', 5), kept: ['AAA', 'gamma', 'delta'] },
  { name: 'S7 A escribe en p1, B reemplaza su texto', a: type('p1', 'end', 'AAA'), b: (B) => void B.updateBlock('p1', { content: 'BBB' } as never), kept: ['AAA', 'BBB'], lost: ['alpha'] },
  { name: 'S8 los dos le cambian el tipo a p1', a: retype('p1', 2), b: retype('p1', 3), kept: [], once: ['alpha beta'] },
  { name: 'S9 A sangra p2, B sangra p3', a: tab('p2'), b: tab('p3'), kept: ['gamma delta'], lost: ['epsilon'] },
  { name: 'S9b los dos sangran p2', a: tab('p2'), b: tab('p2'), kept: ['epsilon'], once: ['gamma delta'] },
  { name: 'S10 A escribe en p3, B lo sube', a: type('p3', 'end', 'AAA'), b: move('p3', 'up'), kept: ['AAA', 'epsilon', 'gamma delta'] },
  { name: 'S11 A escribe en p2, B le cambia el color', a: type('p2', 'end', 'AAA'), b: (B) => void B.updateBlock('p2', { props: { textColor: 'red' } } as never), kept: ['gamma delta AAA'] },
  { name: 'S12 A divide p1, B escribe al final', a: split('p1', 5), b: type('p1', 'end', 'BBB'), kept: ['BBB', 'alpha', 'beta'] },
  { name: 'S13 A borra de p1 a p2, B escribe al final de p2', a: deleteAcross, b: type('p2', 'end', 'BBB'), kept: ['alpma delta'], lost: ['BBB'] },
  { name: 'C1 A sangra p2, B junta p3 con p2', a: tab('p2'), b: join('p3'), kept: ['gamma delta'], lost: ['epsilon'] },
  { name: 'C3 A le cambia el tipo a p2, B junta p3 con p2', a: retype('p2'), b: join('p3'), kept: ['gamma delta'], lost: ['epsilon'] },
  { name: 'C4 A sangra p3, B le cambia el tipo a p2', a: tab('p3'), b: retype('p2'), kept: ['gamma delta', 'epsilon'] },
  { name: 'C5 A baja p2, B sangra p3: ninguno pierde su texto', a: move('p2', 'down'), b: tab('p3'), kept: ['epsilon', 'gamma delta'] },
  { name: 'C6 A sangra p3, B sangra p2', a: tab('p3'), b: tab('p2'), kept: ['gamma delta'], lost: ['epsilon'] },
  { name: 'C7 A junta p2 con p1, B junta p3 con p2', a: join('p2'), b: join('p3'), kept: ['alpha betagamma delta'], lost: ['epsilon'] },
  { name: 'C8 los dos le ponen el mismo tipo a p1', a: retype('p1'), b: retype('p1'), kept: [], once: ['alpha beta'] },
  { name: 'C9 A cambia el nivel del título, B escribe en él', a: (A) => void A.updateBlock('h1', { props: { level: 2 } } as never), b: type('h1', 'end', 'BBB'), kept: ['Title BBB'] },
];

for (const mode of ['sync', 'async'] as const) {
  for (const scene of scenes) {
    it(`${scene.name} (${mode})`, async () => {
      const docA = new Y.Doc();
      const docB = new Y.Doc();
      const net = connect(docA, docB, mode);
      const A = mountEditor(docA, 'a');
      const B = mountEditor(docB, 'b');
      A.replaceBlocks(A.document, initial as never);
      net.flush();
      await tick();
      net.offline();
      scene.a(A);
      scene.b(B);
      net.online();
      net.flush();
      await tick();
      net.flush();
      await tick();
      const final = yText(docA);
      expect(sameDocs(docA, docB)).toBe(true);
      expect(showsDoc(A, docA)).toBe(true);
      expect(showsDoc(B, docB)).toBe(true);
      for (const text of scene.kept) expect(final).toContain(text);
      for (const text of scene.once ?? []) expect(final.split(text).length - 1).toBe(1);
      for (const text of scene.lost ?? []) expect(final).not.toContain(text);
      // El título de arriba nunca se toca.
      expect(final).toContain('Title');
    });
  }
}
