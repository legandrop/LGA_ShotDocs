// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { connect, mountEditor, sameDocs, showsDoc, tick, unmountAll } from './collabHarness';
import { insertPhotoAt, limits, losses, midTextIn, para, storedInline, tally, textEnds, typeAtPos } from './photoHarness';

// Lo que todavía puede salir mal al editar a la vez un renglón con fotos en línea. Con los huecos estables
// (Docs/Doc_Colaboracion.md, "Huecos estables") borrar, mover o agregar una foto ya no pierde lo que el otro
// escribe al lado; queda lo que viene de cambiar la estructura (unir renglones, cambiar el tipo, Enter), que
// y-prosemirror 1.x resuelve volviendo a crear el bloque. Estas pruebas DOCUMENTAN el número de hoy (300 agendas
// al azar por caso, semillas fijas; los casos y sus números están en photoHarness.ts, `limits`): no tienen que
// dar 0, pero si un número cambia (para bien o para mal) la prueba falla y hay que revisar la tabla del
// documento. Siempre se exige que los dos terminen iguales, que cada editor muestre su documento y que no quede
// nada yendo y viniendo. Los mismos casos sin el texto de los huecos (para comparar):
// collabPhotosNoGaps.test.ts.

afterEach(unmountAll);

describe('límites conocidos de editar a la vez un renglón con fotos (300 agendas por caso)', () => {
  for (const [i, limit] of limits.entries()) {
    it(limit.name, async () => {
      const t = await tally(9000 + i, 300, limit.alphabet, limit.initial);
      expect({ different: t.different, unsettled: t.unsettled }).toEqual({ different: 0, unsettled: 0 });
      expect(losses(t), t.examples.join('\n')).toEqual(limit.gaps);
    }, 300_000);
  }
});

describe('dónde queda lo que se escribe mientras el otro pone una foto en el medio del texto', () => {
  it('lo que A escribió después del punto donde B puso la foto queda antes de la foto (no se pierde)', async () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const net = connect(docA, docB, 'async');
    const A = mountEditor(docA, 'a');
    const B = mountEditor(docB, 'b');
    A.replaceBlocks(A.document, [para('p1', ['abcdef'])] as never);
    net.flush();
    await tick();
    net.offline();
    typeAtPos(A, textEnds(A)[1], 'XYZ');
    insertPhotoAt(B, midTextIn(B)[2], 'F1');
    net.online();
    net.flush();
    await tick();
    expect(sameDocs(docA, docB) && showsDoc(A, docA) && showsDoc(B, docB)).toBe(true);
    // A escribió al final ("abcdefXYZ"); B partió el texto en "abc" y "def": "def" se volvió a crear al otro
    // lado de la foto, y lo de A quedó en el texto original, a la izquierda.
    expect(storedInline(docA)).toEqual(['"abcXYZ" <photo> "def"']);
  });
});
