// @vitest-environment jsdom
// "Arrange in rows" de fotos en renglones contiguos (D799) con otro dispositivo editando a la vez: lo que encontró la
// auditoría de la primera versión (que borraba el bloque de la última foto y recreaba todas).
import type { PartialBlock } from '@blocknote/core';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { connect, mountEditor, posOf, typeAt, undoManager, unmountAll, view, yText, type Editor } from './collabHarness';
import { PHOTO } from './inlinePhoto';
import { joinPhotos } from './inlinePhotoSize';

afterEach(unmountAll);

const ph = (name: string) => ({ type: 'photo', props: { url: `https://example.invalid/${name}.jpg`, name, w: 0 } });
const hb = { type: 'hardBreak' } as never;
const p = (id: string, content: unknown[] = [], props: Record<string, unknown> = {}): PartialBlock =>
  ({ id, type: 'paragraph', props, content: content.map((c) => (typeof c === 'string' ? { type: 'text', text: c, styles: {} } : c)) }) as never;

function pos(e: Editor, name: string): number {
  let found = -1;
  view(e).state.doc.descendants((n, at) => {
    if (n.type.name === PHOTO && n.attrs.name === name) found = at;
    return found < 0;
  });
  return found;
}
const join = (e: Editor, chosen: string[]) => joinPhotos(view(e), chosen.map((n) => pos(e, n)), chosen.map(() => 0.7), 8 / 700);
const photoNames = (e: Editor) => {
  const out: string[] = [];
  view(e).state.doc.descendants((n) => {
    if (n.type.name === PHOTO) out.push(String(n.attrs.name));
  });
  return out;
};
function two(blocks: PartialBlock[]) {
  const d1 = new Y.Doc();
  const d2 = new Y.Doc();
  const link = connect(d1, d2, 'sync');
  const e1 = mountEditor(d1, 'a');
  const e2 = mountEditor(d2, 'b');
  e1.replaceBlocks(e1.document, blocks as never);
  undoManager(e1).stopCapturing();
  return { d1, d2, e1, e2, link };
}

describe('juntar fotos de renglones contiguos con otro dispositivo a la vez', () => {
  it('lo que otro escribe sin red después de la última foto, o en un renglón vacío del medio, no se pierde', () => {
    const { d1, d2, e1, e2, link } = two([p('a', [ph('A')]), p('m'), p('b', [ph('B'), ' leyenda'])]);
    link.offline();
    typeAt(e2, 'b', 'end', ' NUEVO-OFFLINE');
    typeAt(e2, 'm', 'start', 'TEXTO-MEDIO');
    expect(join(e1, ['A', 'B'])).toBe(true);
    link.online();
    for (const d of [d1, d2]) {
      expect(yText(d)).toContain('NUEVO-OFFLINE');
      expect(yText(d)).toContain('TEXTO-MEDIO');
      expect(yText(d)).toContain('leyenda');
    }
    expect(photoNames(e1)).toEqual(['A', 'B']);
    expect(photoNames(e2)).toEqual(['A', 'B']);
  });

  it('en el mismo renglón (Shift+Enter): un cambio de otro a una foto se conserva', () => {
    const { e1, e2, link } = two([p('a', [ph('A'), hb, ph('B')])]);
    link.offline();
    const v2 = view(e2);
    v2.dispatch(v2.state.tr.setNodeAttribute(pos(e2, 'B'), 'name', 'B-renombrada'));
    expect(join(e1, ['A', 'B'])).toBe(true);
    link.online();
    expect(photoNames(e1)).toEqual(['A', 'B-renombrada']);
    expect(photoNames(e2)).toEqual(['A', 'B-renombrada']);
  });

  it('el bloque de la última foto queda (ancla de comentarios), con su formato y su texto', () => {
    const { e1 } = two([p('a', [ph('A')]), p('b', [ph('B'), hb, 'INT. CASA - DÍA'], { script: true, textAlignment: 'center' })]);
    expect(join(e1, ['A', 'B'])).toBe(true);
    expect(posOf(e1, 'b')).toBeGreaterThan(-1);
    const b = e1.document.find((x) => x.id === 'b')!;
    expect(b.props).toMatchObject({ script: true, textAlignment: 'center' });
    expect(JSON.stringify(b.content)).toContain('INT. CASA - DÍA');
    expect(JSON.stringify(b.content)).not.toContain(PHOTO);
  });

  it('deshacer lo vuelve atrás en un paso, con los ids', () => {
    const { e1 } = two([p('a', ['x ', ph('A')]), p('m'), p('b', [ph('B'), ' leyenda'])]);
    const before = JSON.stringify(view(e1).state.doc.toJSON());
    expect(join(e1, ['A', 'B'])).toBe(true);
    expect(JSON.stringify(view(e1).state.doc.toJSON())).not.toBe(before);
    undoManager(e1).stopCapturing();
    undoManager(e1).undo();
    expect(JSON.stringify(view(e1).state.doc.toJSON())).toBe(before);
  });

  it('deshacer no se lleva lo que se escribió justo antes de juntar', () => {
    const { e1 } = two([p('t', ['texto']), p('a', [ph('A')]), p('b', [ph('B')])]);
    typeAt(e1, 't', 'end', ' ESCRITO-ANTES');
    expect(join(e1, ['A', 'B'])).toBe(true);
    undoManager(e1).undo();
    expect(JSON.stringify(e1.document.find((x) => x.id === 't')!.content)).toContain('ESCRITO-ANTES');
    expect(photoNames(e1)).toEqual(['A', 'B']);
    expect(e1.document.find((x) => x.id === 'b')!.content).not.toEqual([]);
  });
});
