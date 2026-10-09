// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { schema } from '../ui/editorSchema';
import {
  assignHeadingInDoc,
  assignMentionEverywhere,
  assignMentionInDoc,
  captureNewLinks,
  pageHref,
  undoAssignEverywhere,
  undoAssignInDoc,
  type AssignSpan,
} from './assign';
import { buildRegistry } from './reader';

// *Undo* de *Assign* (D566, D567): deshace solo lo que agregó y solo si sigue igual, por anclas relativas de Yjs en una
// transacción; si algo cambió (otro escribió en el medio, sacó el link, borró el bloque), no toca nada. Con dos Y.Doc:
// lo que otro dispositivo escribe al lado nunca se pierde.

const editors: { e: BlockNoteEditor; el: HTMLElement }[] = [];
afterEach(() => {
  for (const { e, el } of editors.splice(0)) {
    e.unmount();
    el.remove();
  }
});

function editorOn(doc: Y.Doc): BlockNoteEditor {
  const e = BlockNoteEditor.create(
    withCollaboration({ schema, collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } } }) as never,
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  e.mount(el);
  editors.push({ e, el });
  return e;
}

const SCENE = '0aaaaaaa-1111-4222-8333-444444444444';
const OTHER = '0bbbbbbb-1111-4222-8333-444444444444';
const registry = buildRegistry({ scenes: [{ code: '105_025', pageId: SCENE }, { code: '105_027', pageId: OTHER }], locations: [] });

function makeDoc(): { doc: Y.Doc; ids: string[] } {
  const doc = new Y.Doc();
  const e = editorOn(doc);
  e.replaceBlocks(e.document, [
    { type: 'heading', props: { level: 1 }, content: 'Plates ambulancia' },
    { type: 'paragraph', content: 'Plates de ruta, la 105_120 con grúa y otra vez 105_120.' },
    { type: 'paragraph', content: [{ type: 'text', text: 'Ya era link: ', styles: {} }, { type: 'link', href: `/p/${SCENE}`, content: '105_025' }] },
  ] as never);
  return { doc, ids: e.document.map((b) => b.id) };
}

function read(doc: Y.Doc): string[] {
  const e = editorOn(doc);
  return e.document.map((b) =>
    (b.content as { type: string; text?: string; href?: string; content?: { text: string }[] }[])
      .map((c) => (c.type === 'link' ? `[${(c.content ?? []).map((x) => x.text).join('')}](${c.href})` : (c.text ?? '')))
      .join(''),
  );
}

const sync = (a: Y.Doc, b: Y.Doc) => {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
};

function spansOf(res: ReturnType<typeof assignHeadingInDoc>): AssignSpan[] {
  if (res.status !== 'ok') throw new Error(res.status);
  return res.undo;
}

describe('Undo de Assign en el Y.Doc', () => {
  it('una sección: saca « · 105_025» y el título queda como estaba', () => {
    const { doc, ids } = makeDoc();
    const spans = spansOf(assignHeadingInDoc(doc, ids[0], 'Plates ambulancia', { code: '105_025', pageId: SCENE }));
    expect(read(doc)[0]).toBe(`Plates ambulancia · [105_025](/p/${SCENE})`);
    expect(undoAssignInDoc(doc, spans)).toBe('undone');
    expect(read(doc)).toEqual(['Plates ambulancia', 'Plates de ruta, la 105_120 con grúa y otra vez 105_120.', `Ya era link: [105_025](/p/${SCENE})`]);
    // Una segunda vez ya no hay nada que deshacer: no toca nada.
    const before = Y.encodeStateVector(doc);
    expect(undoAssignInDoc(doc, spans)).toBe('changed');
    expect(Y.encodeStateVector(doc)).toEqual(before);
  });

  it('dos dispositivos: B escribe después del título asignado; Undo en A saca solo lo de Assign y lo de B queda', () => {
    const { doc: A, ids } = makeDoc();
    const spans = spansOf(assignHeadingInDoc(A, ids[0], 'Plates ambulancia', { code: '105_025', pageId: SCENE }));
    const B = new Y.Doc();
    sync(A, B);
    // B agrega texto al final del título (después de lo de Assign), con su editor.
    const eb = editorOn(B);
    const view = eb.prosemirrorView!;
    let end = 0;
    view.state.doc.descendants((n, pos) => {
      if (n.type.name === 'heading') end = pos + n.nodeSize - 1;
      return true;
    });
    view.dispatch(view.state.tr.insertText(' (ruta)', end));
    sync(A, B);
    expect(read(A)[0]).toBe(`Plates ambulancia · [105_025](/p/${SCENE}) (ruta)`);
    expect(undoAssignInDoc(A, spans)).toBe('undone');
    sync(A, B);
    expect(read(A)[0]).toBe('Plates ambulancia (ruta)');
    expect(read(B)[0]).toBe('Plates ambulancia (ruta)');
  });

  it('dos dispositivos: B escribe en el MEDIO de lo agregado → Undo no toca nada y lo dice', () => {
    const { doc: A, ids } = makeDoc();
    const spans = spansOf(assignHeadingInDoc(A, ids[0], 'Plates ambulancia', { code: '105_025', pageId: SCENE }));
    const B = new Y.Doc();
    sync(A, B);
    // B escribe entre « · » y el número.
    const container = (B.getXmlFragment(CONTENT_FRAGMENT).toArray()[0] as Y.XmlElement).toArray()[0] as Y.XmlElement;
    const heading = container.toArray()[0] as Y.XmlElement;
    const text = heading.toArray()[0] as Y.XmlText;
    text.insert('Plates ambulancia · '.length, 'X ', {});
    sync(A, B);
    const before = Y.encodeStateVector(A);
    expect(undoAssignInDoc(A, spans)).toBe('changed');
    expect(Y.encodeStateVector(A)).toEqual(before);
    expect(read(A)[0]).toContain('X ');
  });

  it('si alguien sacó el link del número, o borró el bloque, Undo no toca nada', () => {
    const { doc, ids } = makeDoc();
    const spans = spansOf(assignHeadingInDoc(doc, ids[0], 'Plates ambulancia', { code: '105_025', pageId: SCENE }));
    const e = editorOn(doc);
    // Sacar el link a mano (el texto queda).
    const view = e.prosemirrorView!;
    view.dispatch(view.state.tr.removeMark(0, view.state.doc.content.size, view.state.schema.marks.link));
    expect(undoAssignInDoc(doc, spans)).toBe('changed');
    expect(read(doc)[0]).toBe('Plates ambulancia · 105_025');

    const { doc: d2, ids: i2 } = makeDoc();
    const s2 = spansOf(assignHeadingInDoc(d2, i2[0], 'Plates ambulancia', { code: '105_025', pageId: SCENE }));
    const e2 = editorOn(d2);
    e2.removeBlocks([i2[0]]);
    const before = Y.encodeStateVector(d2);
    expect(undoAssignInDoc(d2, s2)).toBe('changed');
    expect(Y.encodeStateVector(d2)).toEqual(before);
  });

  it('un número que no existe: saca solo las marcas agregadas (el link que ya estaba queda)', () => {
    const { doc, ids } = makeDoc();
    const res = assignMentionInDoc(doc, ids[1], '105_120', { pageId: SCENE }, { registry, ep: '105' });
    const spans = spansOf(res);
    expect(spans).toHaveLength(2);
    expect(undoAssignInDoc(doc, spans)).toBe('undone');
    expect(read(doc)).toEqual(['Plates ambulancia', 'Plates de ruta, la 105_120 con grúa y otra vez 105_120.', `Ya era link: [105_025](/p/${SCENE})`]);
  });

  it('un número: si una de las apariciones cambió, no saca ninguna (todo o nada)', () => {
    const { doc, ids } = makeDoc();
    const spans = spansOf(assignMentionInDoc(doc, ids[1], '105_120', { pageId: SCENE }, { registry, ep: '105' }));
    // Otro dispositivo cambia el link de la segunda aparición a otra escena.
    const B = new Y.Doc();
    sync(doc, B);
    const eb = editorOn(B);
    const view = eb.prosemirrorView!;
    let at = -1;
    const tr = view.state.tr;
    // La última aparición (ya es un pedazo de texto aparte, con su link).
    view.state.doc.descendants((n, pos) => {
      if (n.isText && n.text === '105_120') at = pos;
      return true;
    });
    view.dispatch(tr.addMark(at, at + 7, view.state.schema.marks.link.create({ href: `/p/${OTHER}` })));
    sync(doc, B);
    const before = Y.encodeStateVector(doc);
    expect(undoAssignInDoc(doc, spans)).toBe('changed');
    expect(Y.encodeStateVector(doc)).toEqual(before);
    expect(read(doc)[1]).toBe(`Plates de ruta, la [105_120](/p/${SCENE}) con grúa y otra vez [105_120](/p/${OTHER}).`);
  });

  it('dos dispositivos sin red: A deshace mientras B escribe en otro renglón; al juntarse queda lo de B', () => {
    const { doc: A, ids } = makeDoc();
    const spans = spansOf(assignMentionInDoc(A, ids[1], '105_120', { pageId: SCENE }, { registry, ep: '105' }));
    const B = new Y.Doc();
    sync(A, B);
    const eb = editorOn(B);
    eb.updateBlock(ids[0], { content: 'Plates ambulancia y ruta' } as never);
    expect(undoAssignInDoc(A, spans)).toBe('undone');
    sync(A, B);
    expect(read(A)).toEqual(read(B));
    expect(read(A)[0]).toBe('Plates ambulancia y ruta');
    expect(read(A)[1]).toBe('Plates de ruta, la 105_120 con grúa y otra vez 105_120.');
  });
});

describe('captureNewLinks (el adelanto pone la marca por el editor)', () => {
  it('ubica solo lo que la edición linkeó, y su Undo lo saca', () => {
    const { doc, ids } = makeDoc();
    const e = editorOn(doc);
    const view = e.prosemirrorView!;
    let at = -1;
    view.state.doc.descendants((n, pos) => {
      if (n.isText && n.text?.includes('105_120') && at < 0) at = pos + n.text.indexOf('105_120');
      return true;
    });
    const spans = captureNewLinks(doc, ids[1], pageHref(SCENE), () => {
      view.dispatch(view.state.tr.addMark(at, at + 7, view.state.schema.marks.link.create({ href: `/p/${SCENE}` })));
      return true;
    });
    expect(spans).toHaveLength(1);
    expect(spans![0].text).toBe('105_120');
    expect(read(doc)[1]).toBe(`Plates de ruta, la [105_120](/p/${SCENE}) con grúa y otra vez 105_120.`);
    expect(undoAssignInDoc(doc, spans!)).toBe('undone');
    expect(read(doc)[1]).toBe('Plates de ruta, la 105_120 con grúa y otra vez 105_120.');
  });

  it('si la edición no hizo nada, null; el link que ya estaba no cuenta como nuevo', () => {
    const { doc, ids } = makeDoc();
    expect(captureNewLinks(doc, ids[2], pageHref(SCENE), () => false)).toBeNull();
    expect(captureNewLinks(doc, ids[2], pageHref(SCENE), () => true)).toEqual([]);
  });
});

describe('Assign en todos los lugares (Map › Pending)', () => {
  function docsOf(pages: Record<string, Y.Doc>) {
    return {
      open: async (id: string) => pages[id],
      close: () => undefined,
      flush: async () => undefined,
    };
  }

  it('marca cada página que lo nombra; la que ya no lo tiene se dice; Undo saca todo', async () => {
    const p1 = makeDoc();
    const p2 = makeDoc();
    const p3 = makeDoc();
    const docs = docsOf({ a: p1.doc, b: p2.doc, c: p3.doc });
    const out = await assignMentionEverywhere(
      { docs: docs as never },
      [
        { pageId: 'a', blockIds: [p1.ids[1]], ep: '105' },
        { pageId: 'b', blockIds: [p2.ids[1]], ep: '105' },
        { pageId: 'c', blockIds: [p3.ids[0]], ep: '105' },
      ],
      '105_120',
      { pageId: SCENE },
      registry,
    );
    expect(out.added).toBe(4);
    expect(out.done.map((d) => d.pageId)).toEqual(['a', 'b']);
    expect(out.failed).toEqual([{ pageId: 'c', status: 'changed' }]);
    expect(read(p1.doc)[1]).toContain(`[105_120](/p/${SCENE})`);
    expect(await undoAssignEverywhere({ docs: docs as never }, out.done)).toBe('undone');
    expect(read(p1.doc)[1]).toBe('Plates de ruta, la 105_120 con grúa y otra vez 105_120.');
    expect(read(p2.doc)[1]).toBe('Plates de ruta, la 105_120 con grúa y otra vez 105_120.');
  });

  it('Undo: si una página cambia entre revisarla y escribir (llega de otro dispositivo), el aviso no dice «se deshizo todo»', async () => {
    const p1 = makeDoc();
    const p2 = makeDoc();
    const pages: Record<string, Y.Doc> = { a: p1.doc, b: p2.doc };
    const out = await assignMentionEverywhere(
      { docs: docsOf(pages) as never },
      [
        { pageId: 'a', blockIds: [p1.ids[1]], ep: '105' },
        { pageId: 'b', blockIds: [p2.ids[1]], ep: '105' },
      ],
      '105_120',
      { pageId: SCENE },
      registry,
    );
    // Mientras se abre la página b (ya revisada la a), llega a la a un cambio que borra su párrafo.
    const docs = { ...docsOf(pages), open: async (id: string) => {
      if (id === 'b') editorOn(p1.doc).removeBlocks([p1.ids[1]]);
      return pages[id];
    } };
    expect(await undoAssignEverywhere({ docs: docs as never }, out.done)).toBe('partial');
    expect(read(p2.doc)[1]).toBe('Plates de ruta, la 105_120 con grúa y otra vez 105_120.');
  });

  it('Undo: si en una página cambió, no toca ninguna', async () => {
    const p1 = makeDoc();
    const p2 = makeDoc();
    const docs = docsOf({ a: p1.doc, b: p2.doc });
    const out = await assignMentionEverywhere(
      { docs: docs as never },
      [
        { pageId: 'a', blockIds: [p1.ids[1]], ep: '105' },
        { pageId: 'b', blockIds: [p2.ids[1]], ep: '105' },
      ],
      '105_120',
      { pageId: SCENE },
      registry,
    );
    // En la página b alguien borró el párrafo.
    editorOn(p2.doc).removeBlocks([p2.ids[1]]);
    const before = Y.encodeStateVector(p1.doc);
    expect(await undoAssignEverywhere({ docs: docs as never }, out.done)).toBe('changed');
    expect(Y.encodeStateVector(p1.doc)).toEqual(before);
    expect(read(p1.doc)[1]).toContain(`[105_120](/p/${SCENE})`);
  });
});
