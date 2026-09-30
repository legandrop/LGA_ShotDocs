// @vitest-environment jsdom
import type { BlockNoteEditor } from '@blocknote/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { afterEach, expect, it } from 'vitest';
import * as Y from 'yjs';
import { connect, mountEditor, press, sameDocs, seeded, showsDoc, unmountAll, view } from './collabHarness';

// De la auditoría de v0.054: dos editores con cambios al azar de todo tipo (escribir, Enter, sangrar, quitar la
// sangría, cambiar el tipo, juntar, mover, borrar, elegir un bloque entero, color), entregados con la
// reparación de la app. Al final: nada tiró un error, no queda nada yendo y viniendo (la reparación de uno no
// hace reparar al otro sin fin), los dos documentos son iguales y cada editor muestra el suyo. Se puede
// perder texto (es lo inherente de y-prosemirror, Docs/Doc_Colaboracion.md): eso lo documenta
// collabSemantics.test.ts. En CI, 40 corridas; COLLAB_FUZZ=300 para la grande.

afterEach(unmountAll);

function blocks(E: BlockNoteEditor) {
  const out: { id: string; pos: number; size: number }[] = [];
  view(E).state.doc.descendants((n, p) => {
    if (n.type.name === 'blockContainer') out.push({ id: n.attrs.id as string, pos: p, size: n.firstChild?.content.size ?? 0 });
    return true;
  });
  return out;
}

function randomOp(E: BlockNoteEditor, rand: () => number, token: string): void {
  const bs = blocks(E);
  if (!bs.length) return;
  const b = bs[Math.floor(rand() * bs.length)];
  const v = view(E);
  const caret = (off: number) => v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, b.pos + 2 + off)));
  const r = rand();
  const e = E as unknown as { moveBlocksUp: () => void; moveBlocksDown: () => void };
  // Un cambio que BlockNote no puede hacer ahí (por ejemplo, sangrar el primero) no toca el documento.
  try {
    if (r < 0.4) {
      caret(rand() < 0.5 ? 0 : b.size);
      E.insertInlineContent(token);
    } else if (r < 0.5) {
      caret(rand() < 0.5 ? 0 : b.size);
      press(E, 'Enter');
    } else if (r < 0.6) {
      caret(0);
      press(E, 'Tab');
    } else if (r < 0.65) {
      caret(0);
      press(E, 'Tab', { shiftKey: true });
    } else if (r < 0.72) {
      E.updateBlock(b.id, { type: rand() < 0.5 ? 'heading' : 'bulletListItem', props: rand() < 0.5 ? { level: 2 } : {} } as never);
    } else if (r < 0.78) {
      caret(0);
      press(E, 'Backspace');
    } else if (r < 0.84) {
      caret(0);
      if (rand() < 0.5) e.moveBlocksUp();
      else e.moveBlocksDown();
    } else if (r < 0.88) {
      if (bs.length > 2) E.removeBlocks([b.id]);
    } else if (r < 0.94) {
      v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, b.pos + (rand() < 0.5 ? 1 : 0))));
    } else {
      E.updateBlock(b.id, { props: { textColor: 'red' } } as never);
    }
  } catch {
    // Nada.
  }
}

it('cambios de todo tipo al azar: sin errores, sin ida y vuelta, iguales y cada editor al día', () => {
  const problems: string[] = [];
  for (let run = 1; run <= Number(process.env.COLLAB_FUZZ ?? 40); run++) {
    const rand = seeded(run * 7919);
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const net = connect(docA, docB, 'async');
    const A = mountEditor(docA, 'a');
    const B = mountEditor(docB, 'b');
    A.replaceBlocks(A.document, [
      { id: 'p1', type: 'paragraph', content: 'alpha' },
      { id: 'p2', type: 'paragraph', content: 'beta', children: [{ id: 'c1', type: 'paragraph', content: 'kid' }] },
      { id: 'p3', type: 'paragraph', content: 'gamma' },
      { id: 'p4', type: 'paragraph', content: '' },
    ] as never);
    net.flush();
    for (let step = 0; step < 40; step++) {
      randomOp(rand() < 0.5 ? A : B, rand, `{${run}.${step}}`);
      if (rand() < 0.35) {
        try {
          net.flush();
        } catch (err) {
          problems.push(`run ${run}: delivering threw ${String(err).slice(0, 100)}`);
        }
      }
    }
    net.flush();
    // Los ids repetidos que dejó una fusión los guarda cada editor con su próxima transacción.
    for (const E of [A, B]) view(E).dispatch(view(E).state.tr.setSelection(TextSelection.atStart(view(E).state.doc)));
    for (let i = 0; i < 4; i++) net.flush();
    if (net.pending() !== 0) problems.push(`run ${run}: still going back and forth`);
    if (!sameDocs(docA, docB)) problems.push(`run ${run}: diverged`);
    if (!showsDoc(A, docA)) problems.push(`run ${run}: editor A shows an old document`);
    if (!showsDoc(B, docB)) problems.push(`run ${run}: editor B shows an old document`);
    unmountAll();
  }
  expect(problems).toEqual([]);
}, 600_000);
