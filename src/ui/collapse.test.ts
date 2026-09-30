// @vitest-environment jsdom
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { describe, expect, it } from 'vitest';
import { analyze, hidesSomething, runEnd, sectionAt, type HeadingRecord } from './collapse';
import { schema } from './editorSchema';

// Qué esconde cada título (Docs/Doc_Colapsar.md, sección 1), como cálculo puro sobre el documento.

const h = (id: string, level: number, children: PartialBlock[] = []) =>
  ({ id, type: 'heading', props: { level }, content: id, children }) as PartialBlock;
const p = (id: string, text = id, children: PartialBlock[] = []) => ({ id, type: 'paragraph', content: text, children }) as PartialBlock;

function docOf(blocks: PartialBlock[]) {
  const editor = BlockNoteEditor.create({ schema, initialContent: blocks as never });
  return editor.prosemirrorState.doc;
}

const collapsed = (...ids: string[]) => new Map<string, HeadingRecord>(ids.map((id) => [id, { c: true, g: null }]));
const hiddenBy = (blocks: PartialBlock[], records: Map<string, HeadingRecord>) =>
  Object.fromEntries(analyze(docOf(blocks), records).hidden);

describe('qué esconde un título colapsado', () => {
  const page = [h('A', 1), p('a1'), h('B', 2), p('b1'), h('C', 3), p('c1'), h('D', 2), p('d1'), h('E', 1), p('e1')];

  it('hasta el próximo título de su nivel o mayor', () => {
    expect(hiddenBy(page, collapsed('B'))).toEqual({ b1: 'B', C: 'B', c1: 'B' });
    expect(hiddenBy(page, collapsed('C'))).toEqual({ c1: 'C' });
    expect(hiddenBy(page, collapsed('A'))).toEqual({ a1: 'A', B: 'A', b1: 'A', C: 'A', c1: 'A', D: 'A', d1: 'A' });
  });

  it('lo escondido se atribuye al título de más afuera; los de adentro siguen colapsados', () => {
    const a = analyze(docOf(page), collapsed('A', 'B'));
    expect(a.hidden.get('b1')).toBe('A');
    expect([...a.collapsed].sort()).toEqual(['A', 'B']);
    // Solo se decoran los hermanos del título que se ve.
    expect(a.top.map((t) => t.id)).toEqual(['a1', 'B', 'b1', 'C', 'c1', 'D', 'd1']);
  });

  it('los hijos anidados del título, y un título anidado en otro grupo no corta', () => {
    const blocks = [h('T', 2, [p('hijo')]), p('x', 'x', [h('N', 1)]), p('y'), h('U', 2)];
    expect(hiddenBy(blocks, collapsed('T'))).toEqual({ hijo: 'T', x: 'T', N: 'T', y: 'T' });
  });

  it('el último párrafo vacío de la página no se esconde; el fin corta lo escondido', () => {
    expect(hiddenBy([h('T', 1), p('a'), p('vacio', '')], collapsed('T'))).toEqual({ a: 'T' });
    const records = new Map<string, HeadingRecord>([['T', { c: true, g: null, e: 'b' }]]);
    expect(hiddenBy([h('T', 1), p('a'), p('b'), p('c')], records)).toEqual({ a: 'T' });
  });

  it('un id guardado que no es un título no esconde nada', () => {
    expect(hiddenBy([p('T'), p('a')], collapsed('T'))).toEqual({});
  });

  it('la sección de un título: sus hermanos escondidos y dónde termina', () => {
    const doc = docOf(page);
    const a = analyze(doc, collapsed('B'));
    const section = sectionAt(doc, a.blocks.get('B')!.pos, { c: true, g: null })!;
    expect(section.siblings.map((s) => s.node.attrs.id)).toEqual(['b1', 'C', 'c1']);
    expect(section.after).toBe(a.blocks.get('D')!.pos);
    expect(hidesSomething(section)).toBe(true);
    const e = sectionAt(doc, a.blocks.get('E')!.pos, undefined)!;
    expect(e.siblings.map((s) => s.node.attrs.id)).toEqual(['e1']);
    expect(runEnd([], 0, 1, undefined, true)).toBe(0);
  });
});
