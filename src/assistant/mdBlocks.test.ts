import { describe, expect, it } from 'vitest';
import { inlineContent, parseShape, parseSummary, plainBlocks, toPartialBlocks, type Known, type MdBlock } from './mdBlocks';

// El Markdown con forma de la entrega A2 (Docs/Doc_Asistente.md, 6.3 y 6.4): un renglón por bloque, solo los tipos que
// ya existen, lo desconocido como texto, sin links nuevos ni imágenes, y las marcas de lo elegido exactamente una vez.

const none: Known = { photos: new Set(), links: new Set(), blocks: new Set() };
const textOf = (b: MdBlock) => (b.kind === 'text' ? b.atoms.map((a) => (a.t === 'char' ? a.ch : a.t === 'photo' ? `[foto${a.n}]` : '\n')).join('') : '');

describe('los bloques de la respuesta', () => {
  it('cada renglón es un bloque del tipo que dice su prefijo; lo desconocido queda como texto', () => {
    const r = parseShape(
      [
        '## Cámara',
        '- lente **35 mm**',
        '* T2.8',
        '1. toma uno',
        '[ ] pedir el LiDAR',
        '- [x] fotos de set',
        '> nota del director',
        '#### muy chico',
        '<b>html</b> y ![x](https://otro.example/a.png)',
        '---',
        '',
        'texto suelto',
      ].join('\n'),
      none,
    );
    if (typeof r === 'string') throw new Error(r);
    expect(r.blocks.map((b) => (b.kind === 'text' ? [b.type, b.level ?? b.checked ?? null, textOf(b)] : b.kind))).toEqual([
      ['heading', 2, 'Cámara'],
      ['bulletListItem', null, 'lente 35 mm'],
      ['bulletListItem', null, 'T2.8'],
      ['numberedListItem', null, 'toma uno'],
      ['checkListItem', false, 'pedir el LiDAR'],
      ['checkListItem', true, 'fotos de set'],
      ['quote', null, 'nota del director'],
      ['heading', 3, 'muy chico'],
      ['paragraph', null, '<b>html</b> y ![x](https://otro.example/a.png)'],
      ['paragraph', null, 'texto suelto'],
    ]);
    const bold = (r.blocks[1] as Extract<MdBlock, { kind: 'text' }>).atoms.filter((a) => a.t === 'char' && a.marks.includes('bold'));
    expect(bold.map((a) => (a.t === 'char' ? a.ch : '')).join('')).toBe('35 mm');
  });

  it('una tabla de Markdown es un bloque de tabla, con el encabezado y las filas del mismo ancho', () => {
    const r = parseShape('Antes de la tabla\n| Toma | Lente |\n|---|:--:|\n| 1 | 35 mm |\n| 2 \\| B |\nDespués', none);
    if (typeof r === 'string') throw new Error(r);
    expect(r.blocks.map((b) => b.kind)).toEqual(['text', 'table', 'text']);
    const t = r.blocks[1] as Extract<MdBlock, { kind: 'table' }>;
    expect(t.header).toBe(true);
    const cell = (atoms: unknown[]) => (atoms as { ch?: string }[]).map((a) => a.ch ?? '').join('');
    expect(t.rows.map((row) => row.map(cell))).toEqual([
      ['Toma', 'Lente'],
      ['1', '35 mm'],
      ['2 | B', ''],
    ]);
  });

  it('valida las marcas: cada foto y cada link una vez, cada bloque una vez y solo en su renglón', () => {
    const known: Known = { photos: new Set([1]), links: new Set([1]), blocks: new Set([1]) };
    const ok = parseShape('- la calle ⟦photo:1⟧\n- ⟦link:1⟧ref⟦/link⟧\n⟦block:1⟧', known);
    expect(typeof ok).toBe('object');
    expect(parseShape('- la calle\n- ⟦link:1⟧ref⟦/link⟧\n⟦block:1⟧', known)).toBe('marker'); // falta la foto
    expect(parseShape('- ⟦photo:1⟧ ⟦photo:1⟧\n- ⟦link:1⟧ref⟦/link⟧\n⟦block:1⟧', known)).toBe('marker'); // repetida
    expect(parseShape('- ⟦photo:1⟧ ⟦photo:2⟧\n- ⟦link:1⟧ref⟦/link⟧\n⟦block:1⟧', known)).toBe('marker'); // inventada
    expect(parseShape('- ⟦photo:1⟧\n- ⟦link:1⟧ref⟦/link⟧', known)).toBe('marker'); // falta el bloque
    expect(parseShape('- ⟦photo:1⟧ ⟦block:1⟧\n- ⟦link:1⟧ref⟦/link⟧', known)).toBe('marker'); // el bloque adentro de un texto
    expect(parseShape('- ⟦photo:1⟧\n- ⟦link:1⟧ref\n⟦block:1⟧', known)).toBe('marker'); // link sin cerrar
    expect(parseShape('', known)).toBe('empty');
  });

  it('un link nuevo queda como texto y se avisa; una dirección suelta no es un link', () => {
    const r = parseShape('- ver [el sitio](https://evil.example) y https://otro.example', none);
    if (typeof r === 'string') throw new Error(r);
    expect(r.linksRemoved).toBe(true);
    expect(textOf(r.blocks[0])).toBe('ver el sitio y https://otro.example');
    const content = inlineContent((r.blocks[0] as Extract<MdBlock, { kind: 'text' }>).atoms, { photos: new Map(), links: new Map(), blocks: new Map() });
    expect(content.every((c) => c.type === 'text')).toBe(true);
  });

  it('un resumen saca las marcas (fotos, bloques) y deja el texto de un link', () => {
    const r = parseSummary('- La calle ⟦photo:1⟧ mojada\n⟦block:2⟧\n- ver ⟦link:1⟧la referencia⟦/link⟧\n\n');
    expect(r?.blocks.map(textOf)).toEqual(['La calle  mojada', 'ver la referencia']);
    expect(parseSummary('   \n\n')).toBeNull();
  });
});

describe('a bloques de BlockNote', () => {
  it('arma los tipos con sus propiedades, las fotos tal cual, los links con su dirección y la tabla', () => {
    const photo = { attrs: { url: 'sdmedia://calle', name: 'calle.jpg', w: 0.3 } };
    const link = { attrs: { href: 'https://ref.example/a' } };
    const block = { id: 'img', type: 'image', props: { url: 'sdmedia://x' }, children: [] };
    const known: Known = { photos: new Set([1]), links: new Set([1]), blocks: new Set([1]) };
    const r = parseShape('## Lluvia\n[x] **la calle** ⟦photo:1⟧\n- ⟦link:1⟧ref⟦/link⟧\n⟦block:1⟧\n| a | b |\n|---|---|\n| 1 | 2 |', known);
    if (typeof r === 'string') throw new Error(r);
    const out = toPartialBlocks(r.blocks, { photos: new Map([[1, photo as never]]), links: new Map([[1, link as never]]), blocks: new Map([[1, block]]) });
    expect(out).toEqual([
      { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Lluvia', styles: {} }] },
      {
        type: 'checkListItem',
        props: { checked: true },
        content: [
          { type: 'text', text: 'la calle', styles: { bold: true } },
          { type: 'text', text: ' ', styles: {} },
          { type: 'photo', props: { url: 'sdmedia://calle', name: 'calle.jpg', w: 0.3 } },
        ],
      },
      { type: 'bulletListItem', props: {}, content: [{ type: 'link', href: 'https://ref.example/a', content: [{ type: 'text', text: 'ref', styles: {} }] }] },
      block,
      {
        type: 'table',
        content: {
          type: 'tableContent',
          headerRows: 1,
          rows: [{ cells: [[{ type: 'text', text: 'a', styles: {} }], [{ type: 'text', text: 'b', styles: {} }]] }, { cells: [[{ type: 'text', text: '1', styles: {} }], [{ type: 'text', text: '2', styles: {} }]] }],
        },
      },
    ]);
    expect(plainBlocks(r.blocks)).toBe('## Lluvia\n[x] la calle \n- ref\n| a | b |\n| 1 | 2 |');
  });
});
