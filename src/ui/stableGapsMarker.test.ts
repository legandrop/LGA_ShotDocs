// @vitest-environment jsdom
// La marca del renglón (`lgaStableGaps`, Docs/Doc_Colaboracion.md, "Versiones viejas"): cuándo se pone, que no
// se dibuja, que no se va, y que deshacer la saca junto con la primera foto.
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { mountEditor, pmText, showsDoc, tick, undoManager, unmountAll, view } from './collabHarness';
import { schema } from './editorSchema';
import { GAP_TEXT_SPEC } from './inlinePhoto';
import { brokenGaps, deletePhotoAt, insertPhotoAt, para, photo, photosIn, storedInline, textEnds } from './photoHarness';
import { findUnknownContent, STABLE_GAPS_MARKER } from './unknownContent';

afterEach(unmountAll);

/** Los hijos guardados de cada renglón (`<nombre>` por elemento, `"texto"` por texto, `*` sin la marca). */
function rows(doc: Y.Doc): string[] {
  const out: string[] = [];
  const walk = (el: Y.XmlElement | Y.XmlFragment) => {
    for (const c of el.toArray()) {
      if (!(c instanceof Y.XmlElement)) continue;
      if (c.nodeName === 'paragraph')
        out.push(
          c
            .toArray()
            .map((k) => (k instanceof Y.XmlText ? `${k.getAttribute(GAP_TEXT_SPEC) === true ? '' : '*'}"${k.toString()}"` : `<${(k as Y.XmlElement).nodeName}>`))
            .join(' '),
        );
      else walk(c);
    }
  };
  walk(doc.getXmlFragment(CONTENT_FRAGMENT));
  return out;
}

function docWith(blocks: unknown[]): Y.Doc {
  const doc = new Y.Doc();
  const E = mountEditor(doc);
  E.replaceBlocks(E.document, blocks as never);
  unmountAll();
  return doc;
}

describe('la marca del renglón', () => {
  it('va en un renglón creado con fotos, y no en uno sin fotos', () => {
    const doc = docWith([para('p0', ['solo texto']), para('p1', ['abc', photo('F1')])]);
    expect(rows(doc)).toEqual(['*"solo texto"', `<${STABLE_GAPS_MARKER}> "abc" <photo> ""`]);
    expect(brokenGaps(doc)).toEqual([]);
  });

  it('se pone al agregarle la primera foto a un renglón; deshacer la saca y el renglón vuelve a ser común', async () => {
    const doc = docWith([para('p0', ['top']), para('p1', ['abcdef'])]);
    const E = mountEditor(doc);
    await tick(20);
    const start = textEnds(E)[2];
    insertPhotoAt(E, start + 3, 'F1');
    expect(rows(doc)[1]).toBe(`<${STABLE_GAPS_MARKER}> "abc" <photo> "def"`);
    undoManager(E).stopCapturing();
    undoManager(E).undo();
    await tick(5);
    expect(storedInline(doc)).toEqual([]);
    expect(rows(doc)[1]).toBe('*"abcdef"');
    expect(showsDoc(E, doc)).toBe(true);
  });

  it('se queda al borrar la última foto, no se dibuja y el editor no escribe nada al abrir', async () => {
    const doc = docWith([para('p0', ['top']), para('p1', ['abc', photo('F1'), 'def'])]);
    const E = mountEditor(doc);
    await tick(20);
    deletePhotoAt(E, photosIn(E)[0].pos);
    expect(rows(doc)[1]).toBe(`<${STABLE_GAPS_MARKER}> "abc" "def"`);
    expect(pmText(E)).toBe('top | abcdef');
    expect(findUnknownContent(doc)).toBeNull();
    unmountAll();
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    let wrote = 0;
    copy.on('update', () => wrote++);
    const B = mountEditor(copy, 'b', schema);
    await tick(20);
    expect(wrote).toBe(0);
    expect(pmText(B)).toBe('top | abcdef');
    // Escribir al principio del renglón (pegado a la marca) y al final: cada letra en su lugar.
    const [s, e] = [textEnds(B)[2], textEnds(B)[3]];
    const v = view(B);
    v.dispatch(v.state.tr.insertText('Z', e));
    v.dispatch(v.state.tr.insertText('A', s));
    expect(rows(copy)[1]).toBe(`<${STABLE_GAPS_MARKER}> "Aabc" "defZ"`);
    expect(pmText(B)).toBe('top | AabcdefZ');
  });

  it('un renglón de una versión de prueba sin la marca (v0.076) la recibe al editarlo', async () => {
    const doc = docWith([para('p0', ['top']), para('p1', ['abc', photo('F1'), 'def'])]);
    const row = ((doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).get(1) as Y.XmlElement).get(0) as Y.XmlElement;
    doc.transact(() => row.delete(0, 1));
    expect(rows(doc)[1]).toBe('"abc" <photo> "def"');
    const E = mountEditor(doc);
    await tick(20);
    expect(rows(doc)[1]).toBe('"abc" <photo> "def"');
    const v = view(E);
    v.dispatch(v.state.tr.insertText('!', textEnds(E)[3]));
    expect(rows(doc)[1]).toBe(`<${STABLE_GAPS_MARKER}> "abc" <photo> "def!"`);
  });
});
