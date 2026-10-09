// @vitest-environment jsdom
import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { unitsFromYDoc, type BlockMeta } from '../search/extract';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { schema } from '../ui/editorSchema';
import { assignHeading, assignHeadingInDoc, assignMentionInDoc, linkAttr, unlinkPageInDoc } from './assign';
import { readPageRelations } from './pageRelations';
import { buildRegistry } from './reader';

// *Assign* directo en el Y.Doc (D521, D522): solo agrega (texto o una marca) en un bloque, por su id, verificando antes;
// la marca es la misma que deja el editor; dos dispositivos que escriben a la vez en el mismo título conservan todo; una
// versión vieja (sin los bloques de video, audio y archivo) abre lo escrito sin borrar nada.

const editors: { e: BlockNoteEditor; el: HTMLElement }[] = [];
afterEach(() => {
  for (const { e, el } of editors.splice(0)) {
    e.unmount();
    el.remove();
  }
});

const { audio: _a, file: _f, video: _v, ...oldSpecs } = defaultBlockSpecs;
const oldSchema = BlockNoteSchema.create({ blockSpecs: oldSpecs });

function editorOn(doc: Y.Doc, withSchema: unknown = schema): BlockNoteEditor {
  const e = BlockNoteEditor.create(
    withCollaboration({ schema: withSchema as typeof schema, collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } } }) as never,
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  e.mount(el);
  editors.push({ e, el });
  return e;
}

const SCENE = '0aaaaaaa-1111-4222-8333-444444444444';
const OTHER = '0bbbbbbb-1111-4222-8333-444444444444';

/** Un documento con un título, un párrafo y otro título, escrito con el editor (como en la app). */
function makeDoc(): { doc: Y.Doc; ids: string[] } {
  const doc = new Y.Doc();
  const e = editorOn(doc);
  e.replaceBlocks(e.document, [
    { type: 'heading', props: { level: 1 }, content: 'Plates ambulancia' },
    { type: 'paragraph', content: 'Plates de ruta, la 105_120 con grúa y otra vez 105_120.' },
    { type: 'heading', props: { level: 1 }, content: [{ type: 'text', text: 'Escena ', styles: { bold: true } }, { type: 'text', text: '105_120', styles: { bold: true } }] },
  ] as never);
  return { doc, ids: e.document.map((b) => b.id) };
}

/** Lo que lee el editor de cada bloque: texto, y los links como [texto](href). */
function read(doc: Y.Doc, withSchema?: unknown): string[] {
  const e = editorOn(doc, withSchema);
  return e.document.map((b) =>
    (b.content as { type: string; text?: string; href?: string; content?: { text: string }[] }[])
      .map((c) => (c.type === 'link' ? `[${(c.content ?? []).map((x) => x.text).join('')}](${c.href})` : (c.text ?? '')))
      .join(''),
  );
}

const registry = buildRegistry({ scenes: [{ code: '105_025', pageId: SCENE }, { code: '105_027', pageId: OTHER }], locations: [] });

describe('Assign en el Y.Doc', () => {
  it('la marca es la misma que deja el editor', () => {
    const doc = new Y.Doc();
    const e = editorOn(doc);
    e.replaceBlocks(e.document, [{ type: 'paragraph', content: [{ type: 'link', href: `/p/${SCENE}`, content: '105_025' }] }] as never);
    const container = doc.getXmlFragment(CONTENT_FRAGMENT).toArray()[0] as Y.XmlElement;
    const block = (container.toArray()[0] as Y.XmlElement).toArray()[0] as Y.XmlElement;
    const text = block.toArray()[0] as Y.XmlText;
    expect(text.toDelta()).toEqual([{ insert: '105_025', attributes: linkAttr(`/p/${SCENE}`) }]);
  });

  it('una sección sin número: agrega « · 105_025» con link al final del título; otra escena suma la suya', () => {
    const { doc, ids } = makeDoc();
    expect(assignHeadingInDoc(doc, ids[0], 'Plates ambulancia', { code: '105_025', pageId: SCENE })).toMatchObject({ status: 'ok', added: 1 });
    expect(read(doc)[0]).toBe(`Plates ambulancia · [105_025](/p/${SCENE})`);
    expect(assignHeadingInDoc(doc, ids[0], `Plates ambulancia · 105_025`, { code: '105_027', pageId: OTHER }).status).toBe('ok');
    expect(read(doc)[0]).toBe(`Plates ambulancia · [105_025](/p/${SCENE}) · [105_027](/p/${OTHER})`);
    // El lector cuenta el link del título: la sección es de las dos escenas.
    const meta: BlockMeta[] = [];
    const units = unitsFromYDoc(doc, meta);
    const target = (id: string) => (id === SCENE ? { kind: 'scene' as const, ref: '105_025' } : id === OTHER ? { kind: 'scene' as const, ref: '105_027' } : null);
    const rel = readPageRelations(registry, units, meta, {}, target);
    expect(rel.sections[0].scenes.map((s) => s.ref)).toEqual(['105_025', '105_027']);
    // Los otros bloques, intactos.
    expect(read(doc).slice(1)).toEqual(['Plates de ruta, la 105_120 con grúa y otra vez 105_120.', 'Escena 105_120']);
  });

  it('lo agregado no hereda el formato del final del título (negrita) y nunca un link', () => {
    const { doc, ids } = makeDoc();
    assignHeadingInDoc(doc, ids[2], 'Escena 105_120', { code: '105_025', pageId: SCENE });
    const e = editorOn(doc);
    const content = e.document[2].content as { type: string; text?: string; styles?: Record<string, unknown>; href?: string }[];
    expect(content.at(-2)).toMatchObject({ type: 'text', text: ' · ', styles: {} });
    expect(content.at(-1)).toMatchObject({ type: 'link', href: `/p/${SCENE}` });
  });

  it('si el título cambió, ya no está o no es un título, no escribe nada', () => {
    const { doc, ids } = makeDoc();
    const before = Y.encodeStateVector(doc);
    expect(assignHeadingInDoc(doc, ids[0], 'Plates', { code: '105_025', pageId: SCENE }).status).toBe('changed');
    expect(assignHeadingInDoc(doc, 'no-existe', 'Plates ambulancia', { code: '105_025', pageId: SCENE }).status).toBe('changed');
    expect(assignHeadingInDoc(doc, ids[1], 'Plates de ruta, la 105_120 con grúa y otra vez 105_120.', { code: '105_025', pageId: SCENE }).status).toBe('changed');
    expect(Y.encodeStateVector(doc)).toEqual(before);
  });

  it('dos dispositivos: A asigna mientras B escribe al final del mismo título; al juntarse queda todo', () => {
    const { doc: A, ids } = makeDoc();
    const B = new Y.Doc();
    Y.applyUpdate(B, Y.encodeStateAsUpdate(A));
    // B escribe en el título (con su editor) sin que A lo vea todavía.
    const eb = editorOn(B);
    eb.updateBlock(ids[0], { content: 'Plates ambulancia ruta' } as never);
    expect(assignHeadingInDoc(A, ids[0], 'Plates ambulancia', { code: '105_025', pageId: SCENE }).status).toBe('ok');
    Y.applyUpdate(B, Y.encodeStateAsUpdate(A));
    Y.applyUpdate(A, Y.encodeStateAsUpdate(B));
    const a = read(A)[0];
    expect(read(B)[0]).toBe(a);
    expect(a).toContain('ruta');
    expect(a).toContain(`[105_025](/p/${SCENE})`);
    expect(a).toContain('Plates ambulancia');
  });

  it('un número que no existe: la marca va sobre lo escrito (cada aparición del bloque) y la mención deja de estar pendiente', () => {
    const { doc, ids } = makeDoc();
    const res = assignMentionInDoc(doc, ids[1], '105_120', { pageId: SCENE }, { registry, ep: '105' });
    expect(res).toMatchObject({ status: 'ok', added: 2 });
    expect(read(doc)[1]).toBe(`Plates de ruta, la [105_120](/p/${SCENE}) con grúa y otra vez [105_120](/p/${SCENE}).`);
    const meta: BlockMeta[] = [];
    const units = unitsFromYDoc(doc, meta);
    const rel = readPageRelations(registry, units, meta, {}, (id) => (id === SCENE ? { kind: 'scene', ref: '105_025' } : null));
    const inBlock = rel.mentions.filter((m) => m.blockId === ids[1]);
    expect(inBlock.some((m) => m.kind === 'pending')).toBe(false);
    expect(inBlock.some((m) => m.kind === 'scene' && m.ref === '105_025' && m.via === 'link')).toBe(true);
    // Otra vez: ya tienen link, no hay nada que marcar.
    expect(assignMentionInDoc(doc, ids[1], '105_120', { pageId: SCENE }, { registry, ep: '105' }).status).toBe('changed');
  });

  it('en un título con formato también; si el número ya no está, no escribe', () => {
    const { doc, ids } = makeDoc();
    expect(assignMentionInDoc(doc, ids[2], '105_120', { pageId: SCENE }, { registry, ep: '105' }).status).toBe('ok');
    expect(read(doc)[2]).toBe(`Escena [105_120](/p/${SCENE})`);
    const before = Y.encodeStateVector(doc);
    expect(assignMentionInDoc(doc, ids[0], '105_120', { pageId: SCENE }, { registry, ep: '105' }).status).toBe('changed');
    expect(Y.encodeStateVector(doc)).toEqual(before);
  });

  it('Undo de crear: saca solo los links a esa página; el texto queda', () => {
    const { doc, ids } = makeDoc();
    assignMentionInDoc(doc, ids[1], '105_120', { pageId: SCENE }, { registry, ep: '105' });
    assignHeadingInDoc(doc, ids[0], 'Plates ambulancia', { code: '105_027', pageId: OTHER });
    expect(unlinkPageInDoc(doc, SCENE)).toBe(2);
    expect(read(doc)).toEqual([`Plates ambulancia · [105_027](/p/${OTHER})`, 'Plates de ruta, la 105_120 con grúa y otra vez 105_120.', 'Escena 105_120']);
  });

  it('una página que no terminó de bajar (y no baja): no se abre ni se escribe', async () => {
    let opened = 0;
    const docs = { open: async () => { opened++; return new Y.Doc(); }, close: () => undefined, flush: async () => undefined };
    const engine = { isMissingContent: async () => true, prefetchPage: async () => false };
    expect(await assignHeading({ docs: docs as never, engine }, 'p', 'b', 'x', { code: '105_025', pageId: SCENE })).toEqual({ status: 'missing' });
    expect(opened).toBe(0);
  });

  it('esquema anterior: lo que deja Assign se abre sin borrar nada', () => {
    const { doc, ids } = makeDoc();
    assignHeadingInDoc(doc, ids[0], 'Plates ambulancia', { code: '105_025', pageId: SCENE });
    assignMentionInDoc(doc, ids[1], '105_120', { pageId: SCENE }, { registry, ep: '105' });
    const now = read(doc);
    expect(read(doc, oldSchema)).toEqual(now);
    expect(read(doc)).toEqual(now);
  });
});
