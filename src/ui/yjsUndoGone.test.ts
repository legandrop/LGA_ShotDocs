// @vitest-environment jsdom
// La excepción del ⌘Z de Yjs con dos personas (B.22, Docs/Doc_Deshacer.md, "B.22: cómo quedó"). Deshacer un borrado
// vuelve a poner cada cosa adentro de la copia de su padre (`redone`). Si esa copia ya no está porque otra persona la
// borró y Yjs la recolectó (nadie la guardaba para deshacer: un paso de rehacer que se vació le sacó la marca `keep`),
// Yjs seguía la cadena hasta un `GC` y tiraba `TypeError` ("reading 'client'") en el medio del deshacer: el paso salía de
// la pila sin hacerse, y lo demás de ese paso (texto en otros renglones) no volvía. El arreglo es el parche de Yjs
// (patches/yjs+13.6.33.patch): lo que no tiene dónde volver se salta, como cuando el padre no se puede volver a poner, y
// el resto del paso se hace. Sin el arreglo, las pruebas de este archivo fallan (comprobado con la librería anterior).
import { TextSelection } from '@tiptap/pm/state';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { connect, mountEditor, posOf, press, undoManager, unmountAll, view, yText } from './collabHarness';
import { para } from './photoHarness';
import { CONTENT_FRAGMENT } from '../sync/structure';

afterEach(unmountAll);

const TYPING = Symbol('typing');

/** Un renglón (párrafo con su texto), como los bloques de la página. */
function row(Yjs: typeof Y, text: string): Y.XmlElement {
  const p = new Yjs.XmlElement('paragraph');
  const x = new Yjs.XmlText();
  x.insert(0, text);
  p.insert(0, [x]);
  return p;
}

/**
 * El caso mínimo con Yjs solo. A escribe "abc" y "xyz"; B borra la "b" y la "y" en un paso, borra el renglón "ac" entero,
 * lo vuelve con ⌘Z (una copia), escribe una "Z" en la copia y la deshace, y escribe en el otro renglón (eso vacía rehacer y
 * le saca a la copia la marca que la guardaba). A borra la copia; en B, Yjs la recolecta. B deshace dos veces: la segunda
 * tiene que volver a poner la "y" (su renglón está) y saltar la "b" (su renglón ya no existe).
 *
 * Con `image`, el primer renglón tiene además una imagen (un hijo directo del renglón, como una foto en línea) y lo que B
 * borra es la imagen: la copia del renglón queda recolectada como un item sin su tipo (no un `GC`) y Yjs tiraba
 * "reading '_item'" en vez de "reading 'client'".
 */
function goneParent(Yjs: typeof Y, image = false) {
  const A = new Yjs.Doc();
  A.clientID = 1;
  const B = new Yjs.Doc();
  B.clientID = 2;
  const fa = A.getXmlFragment('f');
  const fb = B.getXmlFragment('f');
  const sync = () => {
    Yjs.applyUpdate(B, Yjs.encodeStateAsUpdate(A, Yjs.encodeStateVector(B)));
    Yjs.applyUpdate(A, Yjs.encodeStateAsUpdate(B, Yjs.encodeStateVector(A)));
  };
  A.transact(() => {
    const first = row(Yjs, 'abc');
    if (image) first.insert(1, [new Yjs.XmlElement('img')]);
    fa.insert(0, [first, row(Yjs, 'xyz')]);
  });
  sync();
  const um = new Yjs.UndoManager(fb, { trackedOrigins: new Set([TYPING]), captureTimeout: 0 });
  const text = (i: number) => (fb.get(i) as Y.XmlElement).get(0) as Y.XmlText;
  const edit = (fn: () => void) => {
    B.transact(fn, TYPING);
    um.stopCapturing();
  };
  edit(() => {
    if (image) (fb.get(0) as Y.XmlElement).delete(1, 1); // la imagen
    else text(0).delete(1, 1); // "ac"
    text(1).delete(1, 1); // "xz"
  });
  edit(() => fb.delete(0, 1)); // borra el renglón "ac"
  um.undo(); // vuelve (una copia)
  edit(() => text(0).insert(0, 'Z'));
  um.undo(); // se va la "Z": el paso de rehacer guarda la copia
  edit(() => text(1).insert(0, 'q')); // vacía rehacer: la copia ya no está guardada
  sync();
  A.transact(() => fa.delete(0, 1)); // A borra la copia
  sync();
  const collected = [...(B.store.clients.get(2) ?? [])].some((s) => s instanceof Yjs.GC);
  um.undo(); // se va la "q"
  let error: unknown = null;
  try {
    um.undo(); // la "b" y la "y"
  } catch (err) {
    error = err;
  }
  sync();
  return { collected, error, a: fa.toString(), b: fb.toString(), canUndo: um.canUndo(), canRedo: um.canRedo() };
}

describe('el ⌘Z con la copia del padre recolectada (B.22)', () => {
  it('no tira la excepción: vuelve lo que tiene dónde volver y salta lo demás', () => {
    const r = goneParent(Y);
    expect(r.collected).toBe(true); // el caso es el de la excepción: la copia es un `GC`
    expect(r.error).toBe(null); // sin el arreglo: TypeError (reading 'client')
    expect(r.b).toBe('<paragraph>xyz</paragraph>'); // sin el arreglo: "xz" (la "y" no volvía)
    expect(r.a).toBe(r.b);
    expect(r.canUndo).toBe(false);
    expect(r.canRedo).toBe(true); // el paso se hizo y se puede rehacer
  });

  it('lo mismo si lo borrado es un hijo directo del renglón (una imagen): la copia queda sin su tipo', () => {
    const r = goneParent(Y, true);
    expect(r.error).toBe(null); // sin el arreglo: TypeError (reading '_item')
    expect(r.b).toBe('<paragraph>xyz</paragraph>'); // sin el arreglo: "xz"
    expect(r.a).toBe(r.b);
  });

  it('el archivo de `require` (dist/yjs.cjs) lleva el mismo arreglo', () => {
    const Ycjs = createRequire(import.meta.url)('yjs') as typeof Y;
    expect(Ycjs).not.toBe(Y);
    const r = goneParent(Ycjs);
    expect(r.collected).toBe(true);
    expect(r.error).toBe(null);
    expect(r.b).toBe('<paragraph>xyz</paragraph>');
    expect(r.a).toBe(r.b);
    expect(goneParent(Ycjs, true).error).toBe(null);
  });

  it('con dos editores de la app: el mismo caso borrando el bloque entero', () => {
    const A = new Y.Doc();
    A.clientID = 11;
    const B = new Y.Doc();
    B.clientID = 22;
    const net = connect(A, B, 'async');
    const a = mountEditor(A, 'a');
    a.replaceBlocks(a.document, [para('p0', ['abc']), para('p1', ['xyz'])] as never);
    net.flush();
    const b = mountEditor(B, 'b');
    const um = undoManager(b);
    um.clear();
    const v = view(b);
    const step = (fn: () => void) => {
      fn();
      um.stopCapturing();
    };
    step(() => {
      // La "b" y la "y" en una sola edición (como un reemplazo en los dos renglones).
      const s0 = posOf(b, 'p0') + 2;
      const s1 = posOf(b, 'p1') + 2;
      v.dispatch(v.state.tr.delete(s1 + 1, s1 + 2).delete(s0 + 1, s0 + 2));
    });
    expect(yText(B)).toBe('ac | xz');
    step(() => b.removeBlocks(['p0']));
    step(() => b.undo()); // vuelve el bloque (una copia)
    step(() => v.dispatch(v.state.tr.insertText('Z', posOf(b, 'p0') + 2)));
    step(() => b.undo());
    step(() => v.dispatch(v.state.tr.insertText('q', posOf(b, 'p1') + 2)));
    net.flush();
    a.removeBlocks(['p0']); // A borra el bloque que volvió
    net.flush();
    expect(yText(B)).toBe('qxz');
    step(() => b.undo()); // se va la "q"
    let error: unknown = null;
    try {
      b.undo(); // la "b" y la "y"
    } catch (err) {
      error = err;
    }
    net.flush();
    expect(error).toBe(null); // sin el arreglo: TypeError (reading 'client')
    expect(yText(B)).toBe('xyz'); // sin el arreglo: "xz"
    expect(A.getXmlFragment(CONTENT_FRAGMENT).toJSON()).toBe(B.getXmlFragment(CONTENT_FRAGMENT).toJSON());
  });

  it('si algo del paso no tiene dónde volver, lo que el paso insertó se queda (un Enter: el texto movido no desaparece)', () => {
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
    };
    step(() => {
      // Enter después de "la cámara ": " y la toma" pasa a un bloque nuevo (se borra de uno y se escribe en el otro).
      v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, posOf(b, 'p0') + 2 + 10)));
      press(b, 'Enter');
    });
    expect(yText(B)).toBe('la cámara  | y la toma | otro');
    step(() => b.removeBlocks(['p0']));
    step(() => b.undo()); // vuelve "la cámara " (una copia)
    step(() => v.dispatch(v.state.tr.insertText('Z', posOf(b, 'p0') + 2)));
    step(() => b.undo());
    step(() => v.dispatch(v.state.tr.insertText('q', posOf(b, 'p1') + 2)));
    net.flush();
    a.removeBlocks(['p0']); // A borra "la cámara "
    net.flush();
    step(() => b.undo()); // se va la "q"
    let error: unknown = null;
    try {
      b.undo(); // el Enter: " y la toma" tendría que volver a "la cámara ", que ya no existe
    } catch (err) {
      error = err;
    }
    net.flush();
    expect(error).toBe(null); // sin el arreglo: TypeError (reading 'client')
    // " y la toma" no tiene dónde volver; si el deshacer sacara el bloque nuevo, desaparecería.
    expect(yText(B)).toBe('y la toma | otro');
    expect(A.getXmlFragment(CONTENT_FRAGMENT).toJSON()).toBe(B.getXmlFragment(CONTENT_FRAGMENT).toJSON());
  });
});

// Al azar, el modelo de párrafos de la auditoría con dos personas: crear renglones, borrar uno o dos enteros, escribir y
// borrar adentro, deshacer y rehacer, con las ediciones llegando al otro con demora; al final los dos deshacen todo,
// intercalado. Antes del arreglo, 24 de 3.000 semillas (30001-33000) tiraban la excepción (30009, 30012, 30014…).
function pairRun(seed: number) {
  let s = seed;
  const rnd = () => {
    s = (s * 69069 + 7) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const A = new Y.Doc();
  A.clientID = 101;
  const B = new Y.Doc();
  B.clientID = 202;
  const fa = A.getXmlFragment('f');
  const fb = B.getXmlFragment('f');
  A.transact(() => fa.insert(0, ['uno', 'dos', 'tres', 'cuatro'].map((t) => row(Y, t))), 'seed');
  Y.applyUpdate(B, Y.encodeStateAsUpdate(A));
  const qAB: Uint8Array[] = [];
  const qBA: Uint8Array[] = [];
  A.on('update', (u: Uint8Array, o: unknown) => o !== 'remote' && qAB.push(u));
  B.on('update', (u: Uint8Array, o: unknown) => o !== 'remote' && qBA.push(u));
  const umA = new Y.UndoManager(fa, { trackedOrigins: new Set([TYPING]), captureTimeout: 0 });
  const umB = new Y.UndoManager(fb, { trackedOrigins: new Set([TYPING]), captureTimeout: 0 });
  const flush = (q: Uint8Array[], doc: Y.Doc, n = q.length) => q.splice(0, n).forEach((u) => Y.applyUpdate(doc, u, 'remote'));
  let k = 0;
  let errors = 0;
  const safe = (um: Y.UndoManager, kind: 'undo' | 'redo') => {
    try {
      um[kind]();
    } catch {
      errors++;
    }
  };
  const text = (f: Y.XmlFragment) => (f.get(Math.floor(rnd() * f.length)) as Y.XmlElement).get(0) as Y.XmlText;
  const act = (doc: Y.Doc, f: Y.XmlFragment, um: Y.UndoManager) => {
    const r = rnd();
    if (r < 0.12) {
      const at = Math.floor(rnd() * (f.length + 1));
      doc.transact(() => f.insert(at, [row(Y, 'N' + k++)]), TYPING);
    } else if (r < 0.25 && f.length > 1) {
      const at = Math.floor(rnd() * f.length);
      const n = Math.min(1 + Math.floor(rnd() * 2), f.length - at);
      doc.transact(() => f.delete(at, n), TYPING);
    } else if (r < 0.48 && f.length > 0) {
      const x = text(f);
      let at = Math.floor(rnd() * (x.length + 1));
      const n = 1 + Math.floor(rnd() * 3);
      doc.transact(() => {
        for (let j = 0; j < n; j++) x.insert(at++, String.fromCharCode(65 + (k++ % 26)));
      }, TYPING);
    } else if (r < 0.6 && f.length > 0) {
      const x = text(f);
      if (x.length > 1) {
        const at = Math.floor(rnd() * x.length);
        const n = Math.min(1 + Math.floor(rnd() * 4), x.length - at);
        doc.transact(() => x.delete(at, n), TYPING);
      }
    } else if (r < 0.85) safe(um, 'undo');
    else safe(um, 'redo');
    um.stopCapturing();
  };
  for (let i = 0; i < 60; i++) {
    if (rnd() < 0.5) act(A, fa, umA);
    else act(B, fb, umB);
    if (rnd() < 0.3) flush(qAB, B, Math.ceil(rnd() * qAB.length));
    if (rnd() < 0.3) flush(qBA, A, Math.ceil(rnd() * qBA.length));
  }
  for (let g = 0; g < 200 && (umA.canUndo() || umB.canUndo()); g++) {
    if (umA.canUndo()) safe(umA, 'undo');
    flush(qAB, B);
    if (umB.canUndo()) safe(umB, 'undo');
    flush(qBA, A);
  }
  flush(qAB, B);
  flush(qBA, A);
  return { errors, same: fa.toString() === fb.toString() };
}

const PAIRS = Number(process.env.B22_SEEDS ?? 3000);

describe(`al azar, dos personas con renglones (${PAIRS} semillas)`, () => {
  it('ningún ⌘Z tira la excepción de Yjs', () => {
    const errors: number[] = [];
    let same = 0;
    for (let seed = 30001; seed <= 30000 + PAIRS; seed++) {
      const r = pairRun(seed);
      if (r.errors) errors.push(seed);
      if (r.same) same++;
    }
    expect(errors).toEqual([]); // sin el arreglo: 24 de 3.000 (30009, 30012, 30014, 30018…)
    // Los dos terminan iguales salvo los casos de Yjs que ya estaban (otro orden, B.21: 22 de 3.000 con o sin arreglo).
    expect(same).toBeGreaterThanOrEqual(PAIRS - Math.ceil(PAIRS * 0.01));
  }, 120_000);
});
