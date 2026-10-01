// @vitest-environment jsdom
// Deshacer la primera foto de un renglón mientras otro escribe en él (dos editores conectados; Docs/Doc_Colaboracion.md,
// "Versiones viejas"). Deshacer nunca saca la marca del renglón (el filtro de borrado del deshacer, parche de
// y-prosemirror): si la sacara, el renglón quedaría con varios textos y sin marca, que una versión anterior abre y
// reescribe, y que dos versiones de hoy escribiendo a la vez duplican entero (lo encontró la auditoría de la entrega 2).
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { connect, mountEditor, posOf, showsDoc, tick, undoManager, unmountAll, view, yText } from './collabHarness';
import { PHOTO } from './inlinePhoto';
import { placePhotos } from './inlinePhotoCreate';
import { para } from './photoHarness';
import { findUnknownContent, knownContent, STABLE_GAPS_MARKER } from './unknownContent';

afterEach(unmountAll);

/** Lo que conoce el resguardo de las versiones de la v0.052 a la v0.075 (sin la foto ni la marca). */
const PUBLISHED_KNOWN = {
  nodes: new Set([...knownContent().nodes].filter((n) => n !== PHOTO && n !== STABLE_GAPS_MARKER)),
  marks: knownContent().marks,
};

function rowOf(d: Y.Doc, id: string): Y.XmlElement {
  let row: Y.XmlElement | null = null;
  const walk = (el: Y.XmlElement | Y.XmlFragment) => {
    for (const c of el.toArray()) {
      if (!(c instanceof Y.XmlElement) || row) continue;
      if (c.nodeName === 'blockContainer' && c.getAttribute('id') === id) row = c.get(0) as Y.XmlElement;
      else walk(c);
    }
  };
  walk(d.getXmlFragment(CONTENT_FRAGMENT));
  return row!;
}

describe('deshacer la primera foto mientras el otro escribe en el renglón', () => {
  // Dónde pone A la foto en "abcdefghi", y dónde escribe B: a la izquierda, a la derecha (en lo que pasó al texto
  // nuevo), pegado antes y después de la foto, y al final; B entregado antes del deshacer o a la vez.
  const OFFS = [0, 2, 3, 4, 5, 7, 9];
  const WHERE = ['left', 'right', 'gapBefore', 'gapAfter', 'end'] as const;
  it('la marca queda siempre: ningún renglón queda con varios textos y sin marca (70 casos)', async () => {
    const d0 = new Y.Doc();
    d0.clientID = 9;
    const E0 = mountEditor(d0, 'm');
    E0.replaceBlocks(E0.document, [para('p0', ['top']), para('p1', ['abcdefghi'])] as never);
    await tick(5);
    unmountAll();
    const S0 = Y.encodeStateAsUpdate(d0);
    let combos = 0;
    let lost = 0;
    let unmarked = 0;
    let openedByOld = 0;
    let stale = 0;
    for (const off of OFFS) {
      for (const where of WHERE) {
        for (const order of ['before', 'together'] as const) {
          const dA = new Y.Doc();
          const dB = new Y.Doc();
          dA.clientID = 1;
          dB.clientID = 2;
          Y.applyUpdate(dA, S0, 'remote');
          Y.applyUpdate(dB, S0, 'remote');
          const A = mountEditor(dA, 'a');
          const net = connect(dA, dB, 'async');
          const B = mountEditor(dB, 'b');
          await tick(5);
          const s = posOf(A, 'p1') + 2;
          const va = view(A);
          va.dispatch(va.state.tr.setSelection(TextSelection.create(va.state.doc, s + off)));
          placePhotos(A as never, [{ url: 'https://example.invalid/F.jpg', name: 'F' }], s + off, null);
          undoManager(A).stopCapturing();
          net.flush();
          await tick(2);
          const sb = posOf(B, 'p1') + 2;
          const ph = sb + off;
          const pos =
            where === 'left' ? sb + Math.max(0, off - 1) : where === 'right' ? Math.min(ph + 2, sb + 10) : where === 'gapBefore' ? ph : where === 'gapAfter' ? ph + 1 : sb + 10;
          const vb = view(B);
          vb.dispatch(vb.state.tr.insertText('{B}', pos));
          if (order === 'before') net.flush();
          undoManager(A).undo();
          await tick(2);
          net.flush();
          net.flush();
          await tick(5);
          combos++;
          const text = yText(dA);
          if (!(text.includes('{B}') && text.replace('{B}', '').includes('abcdefghi'))) lost++;
          const kids = rowOf(dA, 'p1').toArray();
          const texts = kids.filter((c) => c instanceof Y.XmlText).length;
          const marked = kids.some((c) => c instanceof Y.XmlElement && (c.nodeName === STABLE_GAPS_MARKER || c.nodeName === PHOTO));
          if (texts >= 2 && !marked) unmarked++;
          if (findUnknownContent(dA, PUBLISHED_KNOWN) === null) openedByOld++;
          if (!showsDoc(A, dA) || !showsDoc(B, dB)) stale++;
          unmountAll();
        }
      }
    }
    expect(combos).toBe(70);
    // Antes de la corrección: 20 de 70 renglones sin marca, que una versión anterior abría.
    expect({ unmarked, openedByOld, stale }).toEqual({ unmarked: 0, openedByOld: 0, stale: 0 });
    // Lo que se pierde es la regla del deshacer de Yjs (borra lo que uno creó: el texto nuevo de la derecha, con lo
    // que el otro escribió a la vez adentro). Pasa igual sin fotos, con Enter y deshacer (Doc_Colaboracion.md).
    expect(lost).toBe(20);
  }, 300_000);
});

