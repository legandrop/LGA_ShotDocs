// @vitest-environment jsdom
// Dos personas que terminaban viendo textos distintos (B.26, Docs/Doc_Deshacer.md, "B.26: cómo quedó"). Al deshacer el
// borrado de un renglón, Yjs vuelve a poner cada letra adentro de la copia del renglón y busca sus vecinos siguiendo
// las copias (`redone`). Si en ese texto quedaron un original y su copia (un ⌘Z anterior), los dos vecinos podían
// terminar en la misma letra, o el derecho antes que el izquierdo. Con esos vecinos cruzados, este dispositivo ubicaba
// la letra en un lugar y los demás (y él mismo al recargar), que la ubican por `origin` y `rightOrigin`, en otro: "tres"
// en uno y "ters" en el otro, para siempre. Y buscar el vecino derecho podía partir el izquierdo y dejar la letra en el
// medio de su vecino ("dso"; eso lo traía la parte de B.21 del parche, igual para todos). El arreglo es el parche de
// Yjs (patches/yjs+13.6.33.patch). Sin él, las pruebas de este archivo fallan (comprobado con la librería anterior).
import { TextSelection } from '@tiptap/pm/state';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { caretAt, connect, mountEditor, press, seeded, showsDoc, undoManager, unmountAll, view, yText, type Editor } from './collabHarness';
import { para, photo } from './photoHarness';
import { PHOTO } from './inlinePhoto';
import { CONTENT_FRAGMENT } from '../sync/structure';

afterEach(unmountAll);

const TYPING = Symbol('typing');

type Step = ['del', number, number] | ['delRow'] | ['undo'];

/**
 * Una persona (A) edita un renglón y deshace; B recibe cada cambio. Devuelve lo que tiene cada uno y lo que sale de
 * rearmar el documento de A desde sus ediciones (lo que ve A al recargar).
 */
function oneRow(Yjs: typeof Y, text: string, steps: Step[]) {
  const A = new Yjs.Doc();
  A.clientID = 1;
  const B = new Yjs.Doc();
  B.clientID = 2;
  const f = A.getXmlFragment('f');
  A.transact(() => {
    const p = new Yjs.XmlElement('paragraph');
    const x = new Yjs.XmlText();
    x.insert(0, text);
    p.insert(0, [x]);
    f.insert(0, [p]);
  });
  Yjs.applyUpdate(B, Yjs.encodeStateAsUpdate(A));
  A.on('update', (u: Uint8Array) => Yjs.applyUpdate(B, u));
  const um = new Yjs.UndoManager(f, { trackedOrigins: new Set([TYPING]), captureTimeout: 0 });
  for (const st of steps) {
    if (st[0] === 'del') {
      const [, at, n] = st;
      A.transact(() => ((f.get(0) as Y.XmlElement).get(0) as Y.XmlText).delete(at, n), TYPING);
    } else if (st[0] === 'delRow') A.transact(() => f.delete(0, 1), TYPING);
    else um.undo();
    um.stopCapturing();
  }
  const plain = (d: Y.Doc) => d.getXmlFragment('f').toString().replace(/<[^>]+>/g, '');
  const R = new Yjs.Doc();
  Yjs.applyUpdate(R, Yjs.encodeStateAsUpdate(A));
  return { a: plain(A), b: plain(B), reloaded: plain(R) };
}

/** "tres": borrar "re" y ⌘Z; borrar "es" y ⌘Z; borrar el renglón y ⌘Z. Los vecinos de la "e" quedaban cruzados. */
const CROSSED: Step[] = [['del', 1, 2], ['undo'], ['del', 2, 2], ['undo'], ['delRow'], ['undo']];
/** "dos": borrar "os" y ⌘Z; borrar la "s"; borrar el renglón, ⌘Z y ⌘Z. Buscar el vecino derecho partía el izquierdo. */
const SPLIT_LEFT: Step[] = [['del', 1, 2], ['undo'], ['del', 2, 1], ['delRow'], ['undo'], ['undo']];

describe('deshacer el borrado de un renglón deja el mismo texto en todos (B.26)', () => {
  it('con los vecinos cruzados, la otra persona y la recarga ven lo mismo que quien deshizo', () => {
    const r = oneRow(Y, 'tres', CROSSED);
    expect(r.a).toBe('tres');
    expect(r.b).toBe('tres'); // sin el arreglo: "ters" (A seguía viendo "tres")
    expect(r.reloaded).toBe('tres'); // sin el arreglo: "ters"
  });

  it('buscar el vecino derecho ya no deja la letra en el medio del izquierdo', () => {
    const r = oneRow(Y, 'dos', SPLIT_LEFT);
    expect(r.a).toBe('dos'); // sin el arreglo: "dso" (y sin B.21, "dos" en A y "dso" en B)
    expect(r.b).toBe('dos');
    expect(r.reloaded).toBe('dos');
  });

  it('el archivo de `require` (dist/yjs.cjs) lleva el mismo arreglo', () => {
    const Ycjs = createRequire(import.meta.url)('yjs') as typeof Y;
    expect(Ycjs).not.toBe(Y);
    const r = oneRow(Ycjs, 'tres', CROSSED);
    expect([r.a, r.b, r.reloaded]).toEqual(['tres', 'tres', 'tres']);
    const s = oneRow(Ycjs, 'dos', SPLIT_LEFT);
    expect([s.a, s.b, s.reloaded]).toEqual(['dos', 'dos', 'dos']);
  });

  it('con dos editores de la app: partir un renglón, deshacer, partirlo otra vez, borrar los dos y deshacer todo', () => {
    const A = new Y.Doc();
    A.clientID = 11;
    const B = new Y.Doc();
    B.clientID = 22;
    const net = connect(A, B, 'async');
    const a = mountEditor(A, 'a');
    a.replaceBlocks(a.document, [para('p0', ['la cámara y la toma']), para('p1', ['otro'])] as never);
    net.flush();
    const b = mountEditor(B, 'b');
    const um = undoManager(b);
    um.clear();
    const v = view(b);
    const step = (fn: () => void) => {
      fn();
      um.stopCapturing();
      net.flush();
    };
    step(() => {
      caretAt(b, 'p0', 15); // "la cámara y la |toma"
      press(b, 'Enter');
    });
    step(() => b.undo());
    step(() => {
      caretAt(b, 'p0', 16);
      v.dispatch(v.state.tr.insertText('AB', v.state.selection.from)); // "la cámara y la tABoma"
    });
    step(() => {
      caretAt(b, 'p0', 11);
      press(b, 'Enter'); // "la cámara y" y " la tABoma"
    });
    step(() => b.removeBlocks(b.document.slice(0, 2).map((x) => x.id)));
    for (let i = 0; i < 3; i++) step(() => b.undo());
    expect(yText(B)).toBe('la cámara y la toma | otro');
    expect(yText(A)).toBe('la cámara y la toma | otro'); // sin el arreglo: "la cámara y la omat | otro"
    expect(A.getXmlFragment(CONTENT_FRAGMENT).toJSON()).toBe(B.getXmlFragment(CONTENT_FRAGMENT).toJSON());
    expect(showsDoc(a, A)).toBe(true);
    expect(showsDoc(b, B)).toBe(true);
  });
});

/**
 * El modelo de párrafos de la auditoría de B.21 (una persona: crear, borrar uno o dos renglones enteros, escribir
 * adentro, deshacer y rehacer, y al final deshacer todo y rehacer todo): lo que queda en memoria es lo mismo que sale
 * al rearmar el documento (lo que ven los demás y la misma persona al recargar).
 */
function oneTree(seed: number) {
  let s = seed;
  const rnd = () => {
    s = (s * 69069 + 1) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const doc = new Y.Doc();
  doc.clientID = 9;
  const f = doc.getXmlFragment('f');
  const row = (t: string) => {
    const p = new Y.XmlElement('paragraph');
    const x = new Y.XmlText();
    x.insert(0, t);
    p.insert(0, [x]);
    return p;
  };
  doc.transact(() => f.insert(0, ['uno', 'dos', 'tres', 'cuatro'].map(row)), 'seed');
  const um = new Y.UndoManager(f, { trackedOrigins: new Set([TYPING]), captureTimeout: 0 });
  const reloaded = () => {
    const c = new Y.Doc();
    Y.applyUpdate(c, Y.encodeStateAsUpdate(doc));
    return c.getXmlFragment('f').toString();
  };
  let k = 0;
  for (let i = 0; i < 60; i++) {
    const r = rnd();
    if (r < 0.15) {
      const at = Math.floor(rnd() * (f.length + 1));
      doc.transact(() => f.insert(at, [row('N' + k++)]), TYPING);
    } else if (r < 0.3 && f.length > 1) {
      const at = Math.floor(rnd() * f.length);
      const n = Math.min(1 + Math.floor(rnd() * 2), f.length - at);
      doc.transact(() => f.delete(at, n), TYPING);
    } else if (r < 0.5 && f.length > 0) {
      const x = (f.get(Math.floor(rnd() * f.length)) as Y.XmlElement).get(0) as Y.XmlText;
      let at = Math.floor(rnd() * (x.length + 1));
      const n = 1 + Math.floor(rnd() * 3);
      doc.transact(() => {
        for (let j = 0; j < n; j++) x.insert(at++, String.fromCharCode(65 + (k++ % 26)));
      }, TYPING);
    } else if (r < 0.62 && f.length > 0) {
      const x = (f.get(Math.floor(rnd() * f.length)) as Y.XmlElement).get(0) as Y.XmlText;
      if (x.length > 1) {
        const at = Math.floor(rnd() * x.length);
        const n = Math.min(1 + Math.floor(rnd() * 4), x.length - at);
        doc.transact(() => x.delete(at, n), TYPING);
      }
    } else if (r < 0.85) um.undo();
    else um.redo();
    um.stopCapturing();
  }
  while (um.redo() !== null);
  while (um.undo() !== null);
  const undone = f.toString() === reloaded();
  while (um.redo() !== null);
  return undone && f.toString() === reloaded();
}

const SEEDS = Number(process.env.B26_SEEDS ?? 3000);

describe(`al azar, renglones borrados y deshechos (${SEEDS} semillas)`, () => {
  it('una persona: lo que queda en memoria es lo que ven los demás y la recarga', () => {
    const bad: number[] = [];
    for (let seed = 70001; seed <= 70000 + SEEDS; seed++) if (!oneTree(seed)) bad.push(seed);
    expect(bad).toEqual([]); // sin el arreglo: 33 de 3.000 (70160, 70360, 70874…)
  }, 120_000);
});

// Dos editores reales que borran y deshacen bloques enteros (el arnés que midió B.22). Las semillas son las seis en
// que terminaban con textos distintos.
const LET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function act(E: Editor, rnd: () => number, k: { n: number }) {
  const v = view(E);
  const ps: number[] = [];
  v.state.doc.descendants((n, p) => {
    if (n.isTextblock) for (let i = 0; i <= n.content.size; i++) ps.push(p + 1 + i);
    return true;
  });
  const at = ps[Math.floor(rnd() * ps.length)];
  const r = rnd();
  const um = undoManager(E);
  try {
    if (r < 0.24) v.dispatch(v.state.tr.insertText(LET[k.n++ % 26] + LET[k.n++ % 26], at));
    else if (r < 0.32) {
      const end = Math.min(v.state.doc.resolve(at).end(), at + 1 + Math.floor(rnd() * 5));
      if (end > at) v.dispatch(v.state.tr.delete(at, end));
    } else if (r < 0.42) {
      const blocks = E.document;
      if (blocks.length > 1) E.removeBlocks([blocks[Math.floor(rnd() * blocks.length)].id]);
    } else if (r < 0.48) {
      const blocks = E.document;
      const n = Math.min(2, blocks.length - 1);
      if (n >= 1) {
        const i = Math.floor(rnd() * (blocks.length - n));
        E.removeBlocks(blocks.slice(i, i + n).map((b) => b.id));
      }
    } else if (r < 0.53) {
      const blocks = E.document;
      E.insertBlocks([{ type: 'paragraph', content: 'N' + k.n++ }] as never, blocks[Math.floor(rnd() * blocks.length)].id, rnd() < 0.5 ? 'after' : 'before');
    } else if (r < 0.55) {
      const node = v.state.schema.nodes[PHOTO].create({ url: `https://example.invalid/g${k.n}.jpg`, name: `g${k.n++}`, w: 0 });
      v.dispatch(v.state.tr.insert(at, node));
    } else if (r < 0.6) {
      v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, at)));
      press(E, 'Enter');
    } else if (r < 0.64) {
      v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, v.state.doc.resolve(at).start())));
      press(E, 'Backspace');
    } else if (r < 0.86) {
      if (um.undoStack.length) um.undo();
    } else if (um.redoStack.length) um.redo();
  } catch {
    // Una acción imposible en ese lugar: se ignora.
  }
  um.stopCapturing();
}

function editorPair(seed: number) {
  const rnd = seeded(seed + 4242);
  const A = new Y.Doc();
  A.clientID = 11;
  const B = new Y.Doc();
  B.clientID = 22;
  const net = connect(A, B, 'async');
  const a = mountEditor(A, 'a');
  a.replaceBlocks(a.document, [
    para('p0', ['la cámara ', photo('f1'), ' y la toma']),
    para('p1', ['segundo renglón']),
    { id: 't0', type: 'table', content: { type: 'tableContent', rows: [{ cells: ['uno', 'dos'] }, { cells: ['tres', 'cuatro'] }] } },
    para('p2', ['tercero']),
    para('p3', ['cuarto renglón']),
  ] as never);
  undoManager(a).clear();
  net.flush();
  const b = mountEditor(B, 'b');
  undoManager(b).clear();
  const k = { n: 0 };
  for (let i = 0; i < 40; i++) {
    act(rnd() < 0.5 ? a : b, rnd, k);
    if (rnd() < 0.35) net.flush();
  }
  net.flush();
  for (let g = 0; g < 400 && (undoManager(a).canUndo() || undoManager(b).canUndo()); g++) {
    for (const E of [a, b]) {
      const um = undoManager(E);
      if (um.undoStack.length) {
        try {
          um.undo();
        } catch {
          // Como la línea de tiempo.
        }
      }
      um.stopCapturing();
      net.flush();
    }
  }
  net.flush();
  const same = A.getXmlFragment(CONTENT_FRAGMENT).toJSON() === B.getXmlFragment(CONTENT_FRAGMENT).toJSON();
  const reload = (d: Y.Doc) => {
    const c = new Y.Doc();
    Y.applyUpdate(c, Y.encodeStateAsUpdate(d));
    return yText(c);
  };
  const result = { same, a: yText(A), b: yText(B), reloadedA: reload(A), reloadedB: reload(B) };
  unmountAll();
  return result;
}

describe('dos editores borrando y deshaciendo bloques enteros: las seis semillas de B.22', () => {
  it('terminan con el mismo documento, y recargar da lo mismo', () => {
    for (const seed of [1406, 1560, 1566, 2291, 2560, 2948]) {
      const r = editorPair(seed);
      // Sin el arreglo, las seis terminaban distintas (por ejemplo, "y la toma" en uno y "y la omat" en el otro).
      expect({ seed, same: r.same, b: r.b, reloadedA: r.reloadedA, reloadedB: r.reloadedB }).toEqual({ seed, same: true, b: r.a, reloadedA: r.a, reloadedB: r.a });
    }
  }, 60_000);
});
