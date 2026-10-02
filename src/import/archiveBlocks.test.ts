// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { archivePageLink, cleanArchiveBlocks, NOT_IN_ARCHIVE, type BlockContext, type NoteKey } from './archiveBlocks';

// Los bloques de un archivo exportado antes de escribirlos (Docs/Doc_Exportar.md, sección 3, "Validación"): contra el
// esquema de la app, con los archivos y las páginas nuevas, y nada descartado en silencio.

const OLD_PHOTO = '11111111-1111-4111-8111-111111111111';
const OLD_GONE = '22222222-2222-4222-8222-222222222222';
const NEW_PHOTO = '33333333-3333-4333-8333-333333333333';
const OLD_PAGE = '44444444-4444-4444-8444-444444444444';
const NEW_PAGE = '55555555-5555-4555-8555-555555555555';
const OUT_PAGE = '66666666-6666-4666-8666-666666666666';

function ctx() {
  const notes: [NoteKey, string | undefined][] = [];
  const c: BlockContext = {
    media: (id) => (id === OLD_PHOTO ? { url: `sdmedia://${NEW_PHOTO}`, name: 'IMG_1.JPG' } : null),
    page: (id) => (id === OLD_PAGE ? NEW_PAGE : null),
    note: (key, detail) => notes.push([key, detail]),
  };
  return { c, notes, keys: () => notes.map((n) => n[0]) };
}

const text = (t: string, styles = {}) => ({ type: 'text', text: t, styles });

describe('volver a Shot Docs: los bloques del archivo', () => {
  it('lo de la app pasa igual, con los archivos y las páginas nuevas (también en línea y en las celdas)', () => {
    const { c, notes } = ctx();
    const blocks = cleanArchiveBlocks(
      [
        { id: 'h1', type: 'heading', props: { level: 2, isToggleable: false }, content: [text('Escena 12', { bold: true })], children: [{ id: 'c1', type: 'paragraph', props: { script: true }, content: [text('INT. CASA - NOCHE')], children: [] }] },
        { id: 'p1', type: 'paragraph', props: { question: true }, content: [text('ver '), { type: 'link', href: `/p/${OLD_PAGE}`, content: [text('el día 2')] }, { type: 'photo', props: { url: `sdmedia://${OLD_PHOTO}`, name: 'viejo.jpg', w: 120 } }], children: [] },
        { id: 'i1', type: 'image', props: { url: `sdmedia://${OLD_PHOTO}`, name: 'viejo.jpg', previewWidth: 320, rowWidth: 0 }, children: [] },
        {
          id: 't1',
          type: 'table',
          props: { thumbHeight: 96 },
          content: { type: 'tableContent', columnWidths: [100, undefined], headerRows: 1, rows: [{ cells: [{ type: 'tableCell', props: { backgroundColor: 'yellow', colspan: 1 }, content: [{ type: 'photo', props: { url: `sdmedia://${OLD_PHOTO}`, name: 'x', w: 0 } }] }, [text('35mm')]] }] },
          children: [],
        },
        { id: 'b1', type: 'paragraph', props: { pageBreak: true }, content: [], children: [] },
      ],
      c,
    );
    expect(notes).toEqual([]);
    expect(blocks[0]).toMatchObject({ id: 'h1', type: 'heading', props: { level: 2, isToggleable: false }, content: [text('Escena 12', { bold: true })] });
    expect(blocks[0].children?.[0]).toMatchObject({ id: 'c1', props: { script: true } });
    expect(blocks[1].content).toEqual([
      text('ver '),
      { type: 'link', href: `/p/${NEW_PAGE}`, content: [text('el día 2')] },
      { type: 'photo', props: { url: `sdmedia://${NEW_PHOTO}`, name: 'IMG_1.JPG', w: 120 } },
    ]);
    expect(blocks[2].props).toEqual({ url: `sdmedia://${NEW_PHOTO}`, name: 'IMG_1.JPG', previewWidth: 320, rowWidth: 0 });
    const table = blocks[3].content as { rows: { cells: unknown[] }[]; headerRows: number };
    expect(table.headerRows).toBe(1);
    expect(table.rows[0].cells[0]).toEqual({ type: 'tableCell', props: { backgroundColor: 'yellow', colspan: 1 }, content: [{ type: 'photo', props: { url: `sdmedia://${NEW_PHOTO}`, name: 'IMG_1.JPG', w: 0 } }] });
    expect(blocks[4].props).toEqual({ pageBreak: true });
  });

  it('un archivo que no vino: su nombre en su lugar, nunca un bloque que apunte a otro workspace', () => {
    const { c, keys } = ctx();
    const blocks = cleanArchiveBlocks(
      [
        { id: 'a', type: 'image', props: { url: `sdmedia://${OLD_GONE}`, name: 'clip_001.mov', caption: 'toma 3' }, children: [] },
        { id: 'b', type: 'paragraph', content: ['con ', { type: 'photo', props: { url: `sdmedia://${OLD_GONE}`, name: 'IMG_9.HEIC', w: 0 } }], children: [] },
      ],
      c,
    );
    expect(blocks[0]).toMatchObject({ id: 'a', type: 'paragraph', content: [text(`clip_001.mov ${NOT_IN_ARCHIVE} — toma 3`)] });
    expect(blocks[1].content).toEqual([text('con '), text(`[IMG_9.HEIC ${NOT_IN_ARCHIVE}]`)]);
    expect(JSON.stringify(blocks)).not.toContain(OLD_GONE);
    expect(keys()).toEqual(['missingFile', 'missingFile']);
  });

  it('un tipo, una propiedad o un estilo que esta versión no conoce: párrafo con su texto o afuera, siempre anotado', () => {
    const { c, keys, notes } = ctx();
    const blocks = cleanArchiveBlocks(
      [
        { id: 'x', type: 'callout', props: { emoji: '💡' }, content: [text('Ojo con la lluvia')], children: [{ id: 'y', type: 'paragraph', content: [text('hijo')] }] },
        { id: 'z', type: 'paragraph', props: { script: 'sí', mood: 'feliz', textAlignment: 'diagonal' }, content: [text('a', { glow: true }), { type: 'mention', user: 'u1', text: '@ana' }] },
        { id: 'w', type: 'heading', props: { level: 9 }, content: 'Título' },
      ],
      c,
    );
    expect(blocks[0]).toMatchObject({ id: 'x', type: 'paragraph', content: [text('Ojo con la lluvia')] });
    expect(blocks[0].children?.[0]).toMatchObject({ id: 'y', content: [text('hijo')] });
    expect(blocks[1].props).toEqual({});
    expect(blocks[1].content).toEqual([text('a'), text('@ana')]);
    expect(blocks[2]).toMatchObject({ type: 'heading', props: {}, content: [text('Título')] });
    expect(keys().sort()).toEqual(['badProp', 'badProp', 'badProp', 'unknownBlock', 'unknownInline', 'unknownProp', 'unknownProp'].sort());
    expect(notes.find((n) => n[0] === 'unknownBlock')?.[1]).toBe('callout');
  });

  it('links y direcciones: solo https, http y mailto; una página de afuera o javascript: quedan como texto', () => {
    const { c, keys } = ctx();
    const link = (href: string) => ({ type: 'link', href, content: [text('ver')] });
    const blocks = cleanArchiveBlocks(
      [
        { id: 'l', type: 'paragraph', content: [link('https://drive.google.com/x'), link('mailto:a@b.c'), link('javascript:alert(1)'), link(`/p/${OUT_PAGE}`), link('data:text/html,hola'), link(`https://shotdocs.lega.com.ar/p/${OLD_PAGE}`)] },
        { id: 'i', type: 'image', props: { url: 'javascript:alert(1)', name: 'malo.png' } },
        { id: 'j', type: 'image', props: { url: 'https://photos.test/a.jpg', name: 'a.jpg' } },
        { id: 'k', type: 'image', props: { url: 'data:image/png;base64,AAAA' } },
      ],
      c,
    );
    const content = blocks[0].content as { type: string; href?: string }[];
    expect(content.filter((x) => x.type === 'link').map((x) => x.href)).toEqual(['https://drive.google.com/x', 'mailto:a@b.c', `/p/${NEW_PAGE}`]);
    expect(JSON.stringify(blocks)).not.toMatch(/javascript:|data:/);
    expect(JSON.stringify(blocks)).not.toContain(OUT_PAGE);
    expect(blocks[1]).toMatchObject({ type: 'paragraph', content: [text('[malo.png]')] });
    expect(blocks[2].props).toEqual({ url: 'https://photos.test/a.jpg', name: 'a.jpg' });
    expect(blocks[3]).toMatchObject({ type: 'paragraph', content: [] });
    expect(keys().sort()).toEqual(['badLink', 'badLink', 'badUrl', 'badUrl', 'outsideLink'].sort());
    expect(archivePageLink(`/p/${OLD_PAGE.toUpperCase()}#x`)).toBe(OLD_PAGE);
    expect(archivePageLink('/p/nada')).toBeNull();
  });

  it('los ids se conservan; uno repetido o raro recibe uno nuevo, anotado', () => {
    const { c, keys } = ctx();
    const blocks = cleanArchiveBlocks(
      [
        { id: 'igual', type: 'paragraph', content: [text('1')] },
        { id: 'igual', type: 'paragraph', content: [text('2')], children: [{ id: 'igual', type: 'paragraph', content: [text('3')] }] },
        { id: '<script>', type: 'paragraph', content: [text('4')] },
        { type: 'paragraph', content: [text('5')] },
      ],
      c,
    );
    const ids = [blocks[0].id, blocks[1].id, blocks[1].children![0].id, blocks[2].id, blocks[3].id];
    expect(ids[0]).toBe('igual');
    expect(new Set(ids).size).toBe(5);
    expect(keys()).toEqual(['duplicateId', 'duplicateId', 'duplicateId']);
    expect(blocks.map((b) => (b.content as { text: string }[])[0].text)).toEqual(['1', '2', '4', '5']);
  });

  it('lo que no es una lista no tiene bloques; lo demasiado hondo sube con su texto', () => {
    const { c, keys } = ctx();
    expect(cleanArchiveBlocks({ blocks: 'no' }, c)).toEqual([]);
    expect(cleanArchiveBlocks(null, c)).toEqual([]);
    let deep: unknown = { type: 'paragraph', content: [text('fondo')] };
    for (let i = 0; i < 60; i++) deep = { type: 'paragraph', content: [text(`n${i}`)], children: [deep] };
    const out = JSON.stringify(cleanArchiveBlocks([deep], c));
    expect(out).toContain('fondo');
    expect(out).toContain('n0');
    expect(keys()).toContain('tooDeep');
  });
});
