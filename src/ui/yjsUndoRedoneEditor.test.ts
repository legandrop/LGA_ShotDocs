// @vitest-environment jsdom
// El límite del deshacer de Yjs (B.21) con el editor de la app: el deshacer de la página (y-prosemirror sobre el
// `Y.UndoManager` de Yjs) ya no deja restos ni se lleva texto de antes. Ver yjsUndoRedone.test.ts (lo mismo con Yjs
// solo) y Docs/Doc_Deshacer.md, "El límite de Yjs".
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { mountEditor, posOf, press, seeded, undoManager, unmountAll, view, yText, type Editor } from './collabHarness';
import { para } from './photoHarness';

afterEach(unmountAll);

function setup(texts: string[]) {
  const doc = new Y.Doc();
  doc.clientID = 1;
  const E = mountEditor(doc, 'a');
  E.replaceBlocks(E.document, texts.map((t, i) => para(`p${i}`, [t])) as never);
  const um = undoManager(E);
  um.clear();
  um.stopCapturing();
  return { doc, E, um };
}

/** Una edición de la persona en el renglón `id`, como un paso propio de la pila. */
function edit(E: Editor, fn: (start: number) => void) {
  fn(posOf(E, 'p0') + 2);
  undoManager(E).stopCapturing();
}

function undoAll(E: Editor) {
  let guard = 0;
  while (undoManager(E).canUndo() && guard++ < 500) {
    E.undo();
    undoManager(E).stopCapturing();
  }
}

describe('con el editor de la app', () => {
  it('escribir, borrarlo, ⌘Z, escribir en el medio y deshacer todo: no queda nada de lo escrito', () => {
    const { doc, E } = setup(['la toma']);
    const v = view(E);
    edit(E, (s) => v.dispatch(v.state.tr.insertText('día ', s + 3))); // "la día toma"
    edit(E, (s) => v.dispatch(v.state.tr.delete(s + 3, s + 6))); // borra "día"
    E.undo(); // vuelve "día" (una copia)
    undoManager(E).stopCapturing();
    edit(E, (s) => v.dispatch(v.state.tr.insertText('X', s + 4))); // "la dXía toma"
    expect(yText(doc)).toBe('la dXía toma');
    undoAll(E);
    expect(yText(doc)).toBe('la toma'); // sin el parche: "la íatoma"
  });

  it('borrar, ⌘Z y borrar de nuevo con lo de al lado: deshacer todo no se lleva texto de antes', () => {
    const { doc, E } = setup(['la cámara']);
    const v = view(E);
    edit(E, (s) => v.dispatch(v.state.tr.insertText('Xx', s + 4))); // "la cXxámara"
    edit(E, (s) => v.dispatch(v.state.tr.delete(s + 6, s + 7))); // borra la "á" (texto de antes)
    E.undo();
    undoManager(E).stopCapturing();
    edit(E, (s) => v.dispatch(v.state.tr.delete(s + 5, s + 8))); // borra "xám"
    undoAll(E);
    expect(yText(doc)).toBe('la cámara'); // sin el parche: "la cmara" (se fue la "á")
  });
});

// Al azar con el editor: escribir, borrar, Enter (parte el renglón), Backspace al principio (junta con el de arriba),
// ⌘Z y ⌘⇧Z; después deshacer todo y rehacer todo. Antes del parche (300 semillas): 226 exactas, 68 con letras de más
// (restos) y 1 con letras de menos. Con el parche: ninguna con letras de más ni de menos.
async function randomRun(seed: number, finish: 'redo' | 'undoRedo') {
  const rnd = seeded(seed);
  const { doc, E, um } = setup(['la cámara y la toma', 'segundo renglón']);
  const initial = yText(doc);
  const v = view(E);
  const textPositions = () => {
    const ps: number[] = [];
    v.state.doc.descendants((n, p) => {
      if (n.isTextblock) for (let i = 0; i <= n.content.size; i++) ps.push(p + 1 + i);
      return true;
    });
    return ps;
  };
  for (let i = 0; i < 40; i++) {
    const r = rnd();
    const ps = textPositions();
    const at = ps[Math.floor(rnd() * ps.length)];
    if (r < 0.35) v.dispatch(v.state.tr.insertText('día ', at));
    else if (r < 0.5) {
      const end = Math.min(v.state.doc.resolve(at).end(), at + 1 + Math.floor(rnd() * 5));
      if (end > at) v.dispatch(v.state.tr.delete(at, end));
    } else if (r < 0.57) {
      v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, at)));
      press(E, 'Enter');
    } else if (r < 0.62) {
      v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, v.state.doc.resolve(at).start())));
      press(E, 'Backspace');
    } else if (r < 0.85) E.undo();
    else E.redo();
    um.stopCapturing();
  }
  let guard = 0;
  if (finish === 'redo') {
    while (um.canRedo() && guard++ < 500) E.redo();
    const out = yText(doc);
    unmountAll();
    return { initial, undone: '', redone: out };
  }
  while (um.canUndo() && guard++ < 500) E.undo();
  const undone = yText(doc);
  guard = 0;
  while (um.canRedo() && guard++ < 500) E.redo();
  const redone = yText(doc);
  unmountAll();
  return { initial, undone, redone };
}

const letters = (s: string) => {
  const m = new Map<string, number>();
  for (const ch of s.replace(/ \| /g, '')) m.set(ch, (m.get(ch) ?? 0) + 1);
  return m;
};

const SEEDS = Number(process.env.B21_EDITOR_SEEDS ?? 150);

describe(`al azar con el editor (${SEEDS} semillas, 40 acciones)`, () => {
  it('deshacer todo no deja restos ni se lleva nada, y rehacer todo vuelve a lo último', async () => {
    const extra: number[] = [];
    const missing: number[] = [];
    const reordered: number[] = [];
    const redoWrong: number[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const expected = (await randomRun(seed, 'redo')).redone;
      const { initial, undone, redone } = await randomRun(seed, 'undoRedo');
      const want = letters(initial);
      const got = letters(undone);
      if ([...got].some(([c, n]) => (want.get(c) ?? 0) < n)) extra.push(seed);
      if ([...want].some(([c, n]) => (got.get(c) ?? 0) < n)) missing.push(seed);
      else if (undone !== initial && !extra.includes(seed)) reordered.push(seed);
      if (redone !== expected) redoWrong.push(seed);
    }
    expect({ extra, missing, redoWrong }).toEqual({ extra: [], missing: [], redoWrong: [] });
    // Caso conocido, aparte del parche (Doc_Deshacer.md, "Lo que queda"): las mismas letras, en otro orden, cuando lo
    // vuelto a poner tiene como vecino algo que se borró y volvió en otro lado (semilla 123: "segundo rglónen").
    expect(reordered.filter((s) => s !== 123)).toEqual([]);
    // 150 semillas con el editor: sola, unos 16 s. Con 120 s vencía con la máquina cargada (el plazo solo detecta un cuelgue).
  }, 300_000);
});
