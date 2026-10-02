// El límite del deshacer de Yjs (B.21, Docs/Doc_Deshacer.md, "El límite de Yjs"): lo que un deshacer vuelve a poner
// es una copia (`redone`), y el deshacer de lo insertado seguía esa copia solo hasta el primer corte. Si la copia se
// partía escribiendo en el medio quedaban restos ("la ía" en vez de "la "); si se había juntado con la copia vecina se
// llevaba texto de antes. El arreglo es el parche de Yjs (patches/yjs+13.6.33.patch), que sigue la copia en todo su
// largo. Sin el parche, las pruebas de este archivo fallan (comprobado con la librería original).
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

const TYPING = Symbol('typing');

/** `a` está entero en `b`, en orden (lo de `b` puede tener cosas de más en el medio). */
function subseq(a: string, b: string): boolean {
  let i = 0;
  for (const ch of b) if (ch === a[i]) i++;
  return i === a.length;
}

/** Cuántas veces está cada letra. */
function letters(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const ch of s) m.set(ch, (m.get(ch) ?? 0) + 1);
  return m;
}

function page(Yjs: typeof Y, initial: string) {
  const doc = new Yjs.Doc();
  const t = doc.get('t', Yjs.XmlText) as Y.XmlText;
  doc.transact(() => t.insert(0, initial), 'seed');
  const um = new Yjs.UndoManager(t, { trackedOrigins: new Set([TYPING]) });
  /** Una edición de la persona, como un paso propio de la pila. */
  const edit = (fn: () => void) => {
    doc.transact(fn, TYPING);
    um.stopCapturing();
  };
  const undo = () => {
    const done = um.undo() !== null;
    um.stopCapturing();
    return done;
  };
  return { doc, t, um, edit, undo };
}

/** Escribir, borrarlo, deshacer el borrado (vuelve como copia), escribir adentro de la copia y deshacer todo. */
function leftover(Yjs: typeof Y): string {
  const p = page(Yjs, 'abcdefgh');
  p.edit(() => p.t.insert(6, 'Xx'));
  p.edit(() => p.t.delete(6, 2));
  p.undo(); // vuelve "Xx" (una copia)
  p.edit(() => p.t.insert(7, 'Yy')); // "XYyx": la copia queda partida
  while (p.undo());
  return p.t.toString();
}

/** Escribir, borrar la letra de al lado, deshacer, borrar un tramo con las dos copias, deshacer todo. */
function takesMore(Yjs: typeof Y): string {
  const p = page(Yjs, 'abcdefgh');
  p.edit(() => p.t.insert(5, 'Xx')); // "abcdeXxfgh"
  p.edit(() => p.t.delete(7, 1)); // borra la "f" (texto de antes)
  p.undo(); // vuelve la "f" (una copia)
  p.edit(() => p.t.delete(6, 3)); // borra "xfg"
  // Deshacer el último borrado vuelve a poner "x", "f" y "g" en la misma transacción: las tres copias quedan
  // seguidas y Yjs las junta en un solo item. Deshacer después "Xx" seguía la copia de la "x" y se llevaba las tres.
  while (p.undo());
  return p.t.toString();
}

/**
 * Deshacer lo borrado de un texto que se volvió a crear (el padre): el vecino izquierdo es la copia de su última letra.
 * Sin el segundo cambio del parche, "cd" volvía en el medio de "XY" (porque la copia de "XY" se partió).
 */
function leftNeighbour(Yjs: typeof Y): string[] {
  const doc = new Yjs.Doc();
  const arr = doc.getArray<Y.Text>('a');
  doc.transact(() => {
    const t = new Yjs.Text();
    t.insert(0, 'abcdef');
    arr.insert(0, [t]);
  }, 'seed');
  const um = new Yjs.UndoManager(arr, { trackedOrigins: new Set([TYPING]) });
  const edit = (fn: () => void) => {
    doc.transact(fn, TYPING);
    um.stopCapturing();
  };
  const undo = () => {
    um.undo();
    um.stopCapturing();
  };
  edit(() => arr.get(0).insert(2, 'XY')); // "abXYcdef"
  edit(() => arr.get(0).delete(4, 2)); // borra "cd"
  edit(() => arr.delete(0, 1)); // borra el texto entero
  undo(); // vuelve el texto: un Y.Text nuevo con copias
  edit(() => arr.get(0).insert(3, 'Z')); // adentro de la copia de "XY"
  undo(); // saca la "Z"
  undo(); // vuelve "cd"
  const back = arr.get(0).toString();
  undo(); // saca "XY"
  return [back, arr.get(0).toString()];
}

describe('el deshacer de Yjs sigue en todo su largo lo que otro deshacer volvió a poner (B.21)', () => {
  it('no deja restos cuando lo vuelto a poner se partió escribiendo en el medio', () => {
    expect(leftover(Y)).toBe('abcdefgh'); // sin el parche: "abcdefxgh"
  });

  it('no se lleva texto de antes cuando las copias vueltas a poner se juntaron', () => {
    expect(takesMore(Y)).toBe('abcdefgh'); // sin el parche: "abcdegh" (se fue la "f")
  });

  it('lo que vuelve a un texto vuelto a crear va después de la copia entera del vecino', () => {
    expect(leftNeighbour(Y)).toEqual(['abXYcdef', 'abcdef']); // sin el parche: "abXcdYef" y "abcdYef"
  });

  it('el archivo de `require` (dist/yjs.cjs) lleva el mismo arreglo', () => {
    const Ycjs = createRequire(import.meta.url)('yjs') as typeof Y;
    expect(Ycjs).not.toBe(Y);
    expect(leftover(Ycjs)).toBe('abcdefgh');
    expect(takesMore(Ycjs)).toBe('abcdefgh');
    expect(leftNeighbour(Ycjs)).toEqual(['abXYcdef', 'abcdef']);
  });
});

// La prueba al azar de la auditoría del diseño (Doc_Deshacer.md, sección 9): una página, 60 acciones (escribir "día ",
// borrar de 1 a 5 letras, deshacer, rehacer), deshacer todo y rehacer todo. Antes del parche: 1.844 de 3.000 exactas y
// 14 con algo de menos (semillas 113, 164, 307…); con el parche, 3.000 de 3.000.
function randomRun(seed: number, finish: 'redo' | 'undoRedo') {
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const doc = new Y.Doc();
  const t = doc.get('t', Y.XmlText) as Y.XmlText;
  doc.transact(() => t.insert(0, 'la cámara y la toma '), 'seed');
  const um = new Y.UndoManager(t, { trackedOrigins: new Set([TYPING]) });
  for (let i = 0; i < 60; i++) {
    const r = rnd();
    if (r < 0.45) doc.transact(() => t.insert(Math.floor(rnd() * (t.length + 1)), 'día '), TYPING);
    else if (r < 0.65 && t.length > 2) {
      const at = Math.floor(rnd() * (t.length - 1));
      doc.transact(() => t.delete(at, Math.min(1 + Math.floor(rnd() * 5), t.length - at)), TYPING);
    } else if (r < 0.85) um.undo();
    else um.redo();
    um.stopCapturing();
  }
  // Lo esperado al rehacer todo es lo de ahora más lo que quedó para rehacer (otra corrida de la misma secuencia).
  if (finish === 'redo') {
    while (um.redo());
    return { undone: '', redone: t.toString() };
  }
  while (um.undo());
  const undone = t.toString();
  while (um.redo());
  return { undone, redone: t.toString() };
}

const SEEDS = Number(process.env.B21_SEEDS ?? 3000);

describe(`al azar, una página (${SEEDS} semillas)`, () => {
  it('deshacer todo vuelve exacto al principio y rehacer todo vuelve exacto a lo último', () => {
    const initial = 'la cámara y la toma ';
    const notExact: number[] = [];
    const lost: number[] = [];
    const redoWrong: number[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const expected = randomRun(seed, 'redo').redone;
      const { undone, redone } = randomRun(seed, 'undoRedo');
      if (undone !== initial) notExact.push(seed);
      if (!subseq(initial, undone)) lost.push(seed);
      if (redone !== expected) redoWrong.push(seed);
    }
    expect({ notExact: notExact.slice(0, 10), lost: lost.slice(0, 10), redoWrong: redoWrong.slice(0, 10) }).toEqual({
      notExact: [],
      lost: [],
      redoWrong: [],
    });
  }, 60_000);
});

// Con otra persona escribiendo y borrando a la vez (dos documentos conectados): deshacer nunca saca nada del otro, ni
// deja restos de lo propio, y los dos terminan iguales.
describe('al azar, con otra persona a la vez', () => {
  it('deshacer todo saca exactamente lo propio: nada del otro se va, nada propio queda', () => {
    const N = Math.max(1, Math.floor(SEEDS / 6));
    const bad: string[] = [];
    for (let seed = 1; seed <= N; seed++) {
      let s = seed;
      const rnd = () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
      };
      const a = new Y.Doc();
      const b = new Y.Doc();
      a.clientID = 1;
      b.clientID = 2;
      const ta = a.get('t', Y.XmlText) as Y.XmlText;
      const tb = b.get('t', Y.XmlText) as Y.XmlText;
      a.transact(() => ta.insert(0, 'la cámara y la toma '), 'seed');
      Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
      // Lo de B llega a A y lo de A a B, a veces enseguida y a veces más tarde (sin red un rato).
      const fromA: Uint8Array[] = [];
      const fromB: Uint8Array[] = [];
      a.on('update', (u: Uint8Array, origin: unknown) => origin !== 'remote' && fromA.push(u));
      b.on('update', (u: Uint8Array, origin: unknown) => origin !== 'remote' && fromB.push(u));
      const flush = () => {
        while (fromA.length) Y.applyUpdate(b, fromA.shift()!, 'remote');
        while (fromB.length) Y.applyUpdate(a, fromB.shift()!, 'remote');
      };
      const um = new Y.UndoManager(ta, { trackedOrigins: new Set([TYPING]) });
      // B solo escribe marcas propias ("{0}", "{1}"…), así se cuentan sus letras; A escribe "día " y borra.
      let bText = '';
      let n = 0;
      for (let i = 0; i < 60; i++) {
        const r = rnd();
        if (r < 0.3) a.transact(() => ta.insert(Math.floor(rnd() * (ta.length + 1)), 'día '), TYPING);
        else if (r < 0.45 && ta.length > 2) {
          const at = Math.floor(rnd() * (ta.length - 1));
          a.transact(() => ta.delete(at, Math.min(1 + Math.floor(rnd() * 5), ta.length - at)), TYPING);
        } else if (r < 0.6) um.undo();
        else if (r < 0.7) um.redo();
        else if (r < 0.85) {
          const mark = `{${n++}}`;
          bText += mark;
          b.transact(() => tb.insert(Math.floor(rnd() * (tb.length + 1)), mark));
        }
        um.stopCapturing();
        if (rnd() < 0.6) flush();
      }
      flush();
      while (um.undo());
      flush();
      const out = ta.toString();
      const have = letters(out);
      // Todo lo de B sigue (A pudo haber borrado letras de B, pero deshacer todo las vuelve a poner) y nada de A queda
      // (la "í" solo está en lo que escribe A).
      const missingFromB = [...letters(bText + 'la cámara y la toma ')].filter(([c, k]) => (have.get(c) ?? 0) < k);
      const leftoverFromA = have.get('í') ?? 0;
      const same = tb.toString() === out;
      if (missingFromB.length || leftoverFromA || !same) bad.push(`${seed}: ${JSON.stringify(out)}`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
  }, 60_000);
});
