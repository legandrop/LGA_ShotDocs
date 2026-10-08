// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { linkedPageId, unitsFromYDoc, type BlockMeta } from '../search/extract';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { schema } from '../ui/editorSchema';
import { readPageRelations } from './pageRelations';
import { buildRegistry } from './reader';

// Lo que se lee de cada bloque para las relaciones (nivel de título, links a páginas, fotos), con el editor real y su
// Y.Doc, y las secciones y menciones de una página (Docs/Doc_Relaciones.md, sección 3).

const editors: BlockNoteEditor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
});

function page(blocks: unknown[]): Y.Doc {
  const doc = new Y.Doc();
  const editor = BlockNoteEditor.create(
    withCollaboration({ schema, collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } } }),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  editor.mount(el);
  editors.push(editor);
  editor.replaceBlocks(editor.document, blocks as Parameters<BlockNoteEditor['replaceBlocks']>[1]);
  return doc;
}

const SCENE_PAGE = '11111111-2222-4333-8444-555555555555';
const DAY_PAGE = '99999999-2222-4333-8444-555555555555';
const PHOTO = (n: number) => `sdmedia://0000000${n}-aaaa-4bbb-8ccc-dddddddddddd`;
const MEDIA = (n: number) => `0000000${n}-aaaa-4bbb-8ccc-dddddddddddd`;

const DAY = [
  { type: 'heading', props: { level: 1 }, content: 'Info general' },
  { type: 'paragraph', content: 'Call 7:00 en CENADE' },
  { type: 'image', props: { url: PHOTO(1), caption: 'Llegada' } },
  { type: 'heading', props: { level: 1 }, content: 'Escena 105_027' },
  { type: 'paragraph', content: [{ type: 'link', href: `/p/${SCENE_PAGE}`, content: [{ type: 'text', text: '→ Escena ', styles: {} }, { type: 'text', text: '105_027', styles: { bold: true } }] }] },
  { type: 'heading', props: { level: 2 }, content: '1074 plano 3' },
  { type: 'image', props: { url: PHOTO(2) } },
  { type: 'paragraph', content: 'queda 105_029 para mañana' },
  { type: 'heading', props: { level: 1 }, content: 'Plates ambulancia' },
  { type: 'image', props: { url: PHOTO(3) } },
];

const R = buildRegistry({
  scenes: [{ code: '105_027', pageId: SCENE_PAGE }, { code: '105_029' }, { code: '101_074' }],
  locations: [{ name: 'CENADE' }],
});
const target = (id: string) => (id === SCENE_PAGE ? { kind: 'scene' as const, ref: '105_027' } : null);

describe('lo de cada bloque, en la misma pasada que la búsqueda', () => {
  it('las unidades no cambian; se suman el nivel de título, los links a páginas (aunque estén partidos) y las fotos', () => {
    const doc = page(DAY);
    const meta: BlockMeta[] = [];
    const units = unitsFromYDoc(doc, meta);
    expect(units).toEqual(unitsFromYDoc(doc));
    expect(meta.map((m) => [m.level, m.media?.length ?? 0, m.links?.length ?? 0])).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [1, 0, 0],
      [0, 0, 1],
      [2, 0, 0],
      [0, 1, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]);
    const link = meta.find((m) => m.links)!.links![0];
    expect(link.pageId).toBe(SCENE_PAGE);
    expect(units[link.unit].text.slice(link.start, link.end)).toBe('→ Escena 105_027');
  });

  it('links de la app: relativos o con la dirección entera; los de afuera no', () => {
    expect(linkedPageId(`/p/${SCENE_PAGE}`)).toBe(SCENE_PAGE);
    expect(linkedPageId(`https://shotdocs.lega.com.ar/p/${SCENE_PAGE.toUpperCase()}#x`)).toBe(SCENE_PAGE);
    expect(linkedPageId('https://example.com/a')).toBeNull();
    expect(linkedPageId('/p/no-es-un-id')).toBeNull();
  });
});

describe('secciones y menciones de una página', () => {
  it('un número en un título abre la sección de su escena hasta el próximo título de su nivel; las fotos de adentro son suyas', () => {
    const doc = page(DAY);
    const meta: BlockMeta[] = [];
    const units = unitsFromYDoc(doc, meta);
    const rel = readPageRelations(R, units, meta, {}, target);
    expect(rel.sections.map((s) => [s.title, s.level, s.scenes.map((x) => x.ref).join(' '), s.media.length])).toEqual([
      ['Info general', 1, '', 1],
      ['Escena 105_027', 1, '105_027', 1],
      ['1074 plano 3', 2, '101_074', 1],
      ['Plates ambulancia', 1, '', 1],
    ]);
    const [, s105, s1074, plates] = rel.sections;
    expect(s105.media).toEqual([MEDIA(2)]);
    expect(s105.endBlockId).toBe(plates.blockId);
    expect(s1074.endBlockId).toBe(plates.blockId);
    expect(plates.endBlockId).toBeNull();
    // El link vale como mención (y tapa su texto); el texto suelto también; la locación por nombre.
    expect(rel.mentions.map((m) => `${m.via}:${m.ref}`)).toEqual(['text:CENADE', 'heading:105_027', 'link:105_027', 'heading:101_074', 'text:105_029']);
    // 105_029 se nombra adentro de la sección de 101_074, que está adentro de la de 105_027.
    const m029 = rel.mentions.find((m) => m.ref === '105_029')!;
    expect(m029.sections.map((i) => rel.sections[i].title)).toEqual(['Escena 105_027', '1074 plano 3']);
    expect(rel.entities).toBe(4);
  });

  it('el episodio de la página resuelve «Esc 27»', () => {
    const doc = page([{ type: 'paragraph', content: 'Ver Esc 29 antes' }]);
    const meta: BlockMeta[] = [];
    const units = unitsFromYDoc(doc, meta);
    expect(readPageRelations(R, units, meta, {}).mentions).toEqual([]);
    expect(readPageRelations(R, units, meta, { ep: '105' }).mentions.map((m) => m.ref)).toEqual(['105_029']);
  });

  it('los nombres de archivo no cuentan; los pies de foto sí', () => {
    const doc = page([{ type: 'image', props: { url: PHOTO(4), caption: 'Fondo de 105_029', name: 'ERSO_101_074_010.jpg' } }]);
    const meta: BlockMeta[] = [];
    const rel = readPageRelations(R, unitsFromYDoc(doc, meta), meta, {});
    expect(rel.mentions.map((m) => m.ref)).toEqual(['105_029']);
    expect(rel.media).toEqual([{ blockId: meta[0].blockId, block: 0, ids: [MEDIA(4)] }]);
  });

  it('un link a una página que no es una escena tapa su texto y no nombra nada', () => {
    const doc = page([{ type: 'paragraph', content: [{ type: 'link', href: `/p/${DAY_PAGE}`, content: 'Día 59 · 105_029' }] }]);
    const meta: BlockMeta[] = [];
    expect(readPageRelations(R, unitsFromYDoc(doc, meta), meta, {}, target).mentions).toEqual([]);
  });
});
