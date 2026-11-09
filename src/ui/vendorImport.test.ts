import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  analyze,
  clipLetter,
  columnIndex,
  columnLetters,
  defaultMappings,
  detectLayout,
  diff,
  parseCsv,
  pickSheet,
  postKey,
  proposeCode,
  readSpreadsheet,
  resolveShot,
  sameVendor,
  sceneIndex,
  SheetError,
  shotRows,
  shotScene,
  shotShare,
  similarNames,
  sourcesOf,
  splitVendors,
  targetOf,
  type Mapping,
} from './vendorImport';

/** Un zip mínimo (comprimido o guardado tal cual), como el de un .xlsx. */
function zip(files: Record<string, string | Uint8Array>, store = false): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = typeof content === 'string' ? enc.encode(content) : content;
    const data = store ? raw : new Uint8Array(deflateRawSync(raw));
    const n = enc.encode(name);
    const lh = new Uint8Array(30 + n.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, store ? 0 : 8, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, n.length, true);
    lh.set(n, 30);
    const ch = new Uint8Array(46 + n.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, store ? 0 : 8, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, n.length, true);
    cv.setUint32(42, offset, true);
    ch.set(n, 46);
    locals.push(lh, data);
    central.push(ch);
    offset += lh.length + data.length;
  }
  const dirSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, dirSize, true);
  ev.setUint32(16, offset, true);
  const parts = [...locals, ...central, end];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Un .xlsx con una hoja de resumen oculta, una visible con el breakdown (encabezado en la fila 3) y una imagen grande. */
function breakdownXlsx(store = false): Uint8Array {
  const strings = ['EP', 'SHOTNAME', 'SUBCLIP', 'VENDOR', 'ERSO_1001_0100', 'Wanka', 'ERSO_1016_0300', '101_16A2-01-06', 'Boat, Net-Fx', 'ERSO_3001_0100'];
  const si = strings.map((s) => `<si><t>${s.replace(/&/g, '&amp;')}</t></si>`).join('');
  const rich = '<si><r><t>Net </t></r><r><rPr><b/></rPr><t xml:space="preserve">VFX</t></r></si>';
  const s = (i: number) => `t="s"><v>${i}</v></c>`;
  const sheet = `<worksheet><sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>Resumen &amp; notas</t></is></c></row>
    <row r="3"><c r="A3" ${s(0)}<c r="C3" ${s(1)}<c r="F3" ${s(2)}<c r="W3" ${s(3)}</row>
    <row r="4"><c r="A4"><v>101.0</v></c><c r="C4" ${s(4)}<c r="W4" ${s(5)}</row>
    <row r="5"><c r="C5" ${s(6)}<c r="F5" ${s(7)}<c r="W5" ${s(8)}</row>
    <row r="6"><c r="C6" ${s(9)}<c r="W6" t="s"><v>${strings.length}</v></c></row>
    <row r="7"><c r="C7" ${s(4)}</row>
  </sheetData></worksheet>`;
  return zip(
    {
      'xl/workbook.xml': `<workbook><sheets><sheet name="OLD" sheetId="1" state="hidden" r:id="rId1"/><sheet name="BREAKDOWN_SHOTS" sheetId="2" r:id="rId2"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': `<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/><Relationship Target="/xl/worksheets/sheet2.xml" Id="rId2" Type="x"/></Relationships>`,
      'xl/sharedStrings.xml': `<sst>${si}${rich}</sst>`,
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>viejo</t></is></c></row></sheetData></worksheet>',
      'xl/worksheets/sheet2.xml': sheet,
      'xl/media/image1.png': new Uint8Array(4096),
    },
    store,
  );
}

const ERSO_SCENES = [
  { pageId: 'p1001', code: '101_001' },
  { pageId: 'p1016A', code: '101_016A' },
  { pageId: 'p1016B', code: '101_016B' },
  { pageId: 'p1038B', code: '101_038B' },
  { pageId: 'p3012', code: '103_012' },
];

describe('leer la planilla', () => {
  it('un .xlsx: solo las hojas visibles, con el texto compartido, el en línea y el de formato', async () => {
    for (const store of [false, true]) {
      const sheets = await readSpreadsheet(new Blob([breakdownXlsx(store) as BlobPart]), 'breakdown.xlsx');
      expect(sheets.map((s) => s.name)).toEqual(['BREAKDOWN_SHOTS']);
      const rows = sheets[0].rows;
      expect(rows[0][0]).toBe('Resumen & notas');
      expect(rows[1]).toEqual([]);
      expect(rows[2][columnIndex('W')]).toBe('VENDOR');
      expect(rows[3][0]).toBe('101');
      expect(rows[5][columnIndex('W')]).toBe('Net VFX');
    }
  });

  it('el encabezado aunque haya filas de resumen arriba, y la hoja que lo tiene', async () => {
    const sheets = await readSpreadsheet(new Blob([breakdownXlsx() as BlobPart]), 'x.xlsx');
    expect(detectLayout(sheets[0].rows)).toEqual({ header: 2, shot: 2, vendor: 22, letter: 5 });
    expect(pickSheet([{ name: 'Notas', rows: [['algo']] }, ...sheets])).toBe(1);
    expect(pickSheet([{ name: 'Notas', rows: [['algo']] }])).toBe(0);
    expect(detectLayout([['Shot Name', 'x', 'Vendor']])).toEqual({ header: 0, shot: 0, vendor: 2, letter: -1 });
  });

  it('un CSV con comillas, punto y coma y renglones de Windows', async () => {
    const csv = '﻿Shot;Vendor;Notas\r\nERSO_1001_0100;"Wanka, Boat";"dice ""hola""\nen dos"\r\nERSO_1004_0100;Boat;\r\n';
    const sheets = await readSpreadsheet(new Blob([csv]), 'planos.csv');
    expect(sheets[0].name).toBe('planos');
    expect(sheets[0].rows).toEqual([
      ['Shot', 'Vendor', 'Notas'],
      ['ERSO_1001_0100', 'Wanka, Boat', 'dice "hola"\nen dos'],
      ['ERSO_1004_0100', 'Boat', ''],
    ]);
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('un archivo que no es una planilla, o un .xls viejo, da un error que se puede explicar', async () => {
    await expect(readSpreadsheet(new Blob([new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])]), 'roto.xlsx')).rejects.toBeInstanceOf(SheetError);
    await expect(readSpreadsheet(new Blob([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])]), 'viejo.xls')).rejects.toThrow('format');
  });

  it('las columnas en letras y al revés', () => {
    expect(columnIndex('A')).toBe(0);
    expect(columnIndex('W')).toBe(22);
    expect(columnIndex('AA')).toBe(26);
    expect(columnLetters(0)).toBe('A');
    expect(columnLetters(22)).toBe('W');
    expect(columnLetters(27)).toBe('AB');
  });
});

describe('escenas y vendors', () => {
  it('la escena sale del shot name, con o sin letra, y la clave del proyecto en la misma forma', () => {
    expect(shotScene('ERSO_1016_0300')).toBe('1016');
    expect(shotScene('ERSO_1033a_0100')).toBe('1033A');
    expect(shotScene('PROY_074_010')).toBe('074');
    expect(shotScene('Comida con Rosenberg')).toBeNull();
    expect(shotScene('1016')).toBeNull();
    expect(postKey('101_016A')).toBe('1016A');
    expect(postKey('103_012')).toBe('3012');
    expect(postKey('074')).toBe('074');
    expect(postKey('nada')).toBeNull();
  });

  it('la letra del clip, solo si el clip es de esa escena', () => {
    expect(clipLetter('101_16A2-01-06', '1016')).toBe('A');
    expect(clipLetter('101_16B-03-02', '1016')).toBe('B');
    expect(clipLetter('101_38B-03-03', '1038')).toBe('B');
    expect(clipLetter('101_17A-01-01', '1016')).toBeNull();
    expect(clipLetter('', '1016')).toBeNull();
  });

  it('los vendors de una celda, y los nombres parecidos', () => {
    expect(splitVendors('Wanka, Net-Fx')).toEqual(['Wanka', 'Net-Fx']);
    expect(splitVendors(' Boat ;  Many  Worlds/ ')).toEqual(['Boat', 'Many Worlds']);
    expect(similarNames('Net-Fx', 'Net VFX')).toBe(true);
    expect(similarNames('Net-Fx', 'NETFX')).toBe(true);
    expect(similarNames('Boat', 'Wanka')).toBe(false);
    expect(similarNames('MW', 'MX')).toBe(false);
    expect(proposeCode('Wanka')).toBe('WAN');
    expect(proposeCode('Boat')).toBe('BOAT');
    expect(proposeCode('Many-Worlds')).toBe('MW');
    expect(proposeCode('Net-Fx')).toBe('NFX');
  });

  it('lo propuesto: unir al vendor del proyecto, unir dos nombres de la planilla, o crear con el color libre', () => {
    const rows = shotRows(
      [['Shot', 'Vendor'], ['ERSO_1001_0100', 'Wanka, Net-Fx'], ['ERSO_1001_0200', 'Net-Fx'], ['ERSO_1004_0100', 'Net VFX'], ['ERSO_1005_0100', 'boat']],
      { header: 0, shot: 0, vendor: 1, letter: -1 },
    );
    const sources = sourcesOf(rows);
    expect(sources.map((s) => [s.key, s.shots, s.scenes])).toEqual([
      ['net-fx', 2, 1],
      ['boat', 1, 1],
      ['net vfx', 1, 1],
      ['wanka', 1, 1],
    ]);
    const maps = defaultMappings(sources, [{ key: 'v-boat', name: 'Boat', code: 'BT' }], { presets: ['#a', '#b', '#c'], used: ['#a'] });
    expect(maps).toEqual({
      'net-fx': { mode: 'new', name: 'Net-Fx', code: 'NFX', color: '#b' },
      boat: { mode: 'existing', vendor: 'v-boat' },
      'net vfx': { mode: 'merge', into: 'net-fx' },
      wanka: { mode: 'new', name: 'Wanka', code: 'WAN', color: '#c' },
    });
    expect(targetOf(maps, 'net vfx')).toBe('n:net-fx');
    // Empatados: el segundo se une al primero, nunca los dos se crean (ni se unen entre sí).
    const tie = defaultMappings(
      [
        { key: 'net vfx', name: 'Net VFX', shots: 1, scenes: 1 },
        { key: 'net-fx', name: 'Net-Fx', shots: 1, scenes: 1 },
      ],
      [],
      { presets: ['#a'], used: [] },
    );
    expect(tie['net vfx'].mode).toBe('new');
    expect(tie['net-fx']).toEqual({ mode: 'merge', into: 'net vfx' });
    expect(targetOf(maps, 'boat')).toBe('v:v-boat');
    expect(targetOf({ a: { mode: 'merge', into: 'b' }, b: { mode: 'merge', into: 'a' } }, 'a')).toBeNull();
    expect(targetOf({ a: { mode: 'skip' } }, 'a')).toBeNull();
  });
});

describe('lo que encontró la auditoría', () => {
  it('dos episodios que terminan igual (101 y 201): no se adivina cuál', () => {
    const index = sceneIndex([
      { pageId: 'p101', code: '101_016' },
      { pageId: 'p201', code: '201_016' },
      { pageId: 'p017', code: '101_017' },
    ]);
    expect(resolveShot({ shot: 'ERSO_1016_0300', clip: '' }, index).kind).toBe('ambiguous');
    expect(resolveShot({ shot: 'ERSO_1017_0100', clip: '' }, index)).toMatchObject({ kind: 'exact', scene: { pageId: 'p017' } });
    // La misma página dos veces no es una repetición.
    const same = sceneIndex([{ pageId: 'p', code: '101_016' }, { pageId: 'p', code: '101_016' }]);
    expect(resolveShot({ shot: 'ERSO_1016_0300', clip: '' }, same).kind).toBe('exact');
    // Con letra: dos episodios con 016A tampoco se adivinan.
    const lettered = sceneIndex([{ pageId: 'a', code: '101_016A' }, { pageId: 'b', code: '201_016A' }]);
    expect(resolveShot({ shot: 'ERSO_1016_0300', clip: '101_16A2-01-06' }, lettered).kind).toBe('ambiguous');
  });

  it('el episodio 110 no tiene forma de post, y el clip tiene que ser del mismo episodio', () => {
    expect(postKey('110_016')).toBeNull();
    expect(postKey('201_016')).toBe('1016');
    expect(clipLetter('102_16A-01-01', '1016')).toBeNull();
    expect(clipLetter('101_16A-01-01', '1016')).toBe('A');
    expect(clipLetter('16A-01-01', '1016')).toBe('A');
  });

  it('CSV con punto y coma y un renglón de resumen con coma arriba; comillas con espacio adelante', () => {
    expect(parseCsv('Total: 1,234 planos\nSHOT;VENDOR\nERSO_1001_0100;Boat\nERSO_1002_0100;Wanka')).toEqual([
      ['Total: 1,234 planos'],
      ['SHOT', 'VENDOR'],
      ['ERSO_1001_0100', 'Boat'],
      ['ERSO_1002_0100', 'Wanka'],
    ]);
    expect(parseCsv('a, "Boat, Net-Fx"\n')).toEqual([['a', 'Boat, Net-Fx']]);
  });

  it('un vendor del proyecto que se escribe parecido no es el mismo: se marca como sugerido', () => {
    expect(sameVendor({ name: 'Net-Fx' }, 'NET FX')).toBe(true);
    expect(sameVendor({ name: 'Framestore', code: 'FS' }, 'fs')).toBe(true);
    expect(sameVendor({ name: 'Wanka' }, 'Wanko')).toBe(false);
  });

  it('nunca una cadena de uniones, y un código que ya tiene otro vendor no se repite', () => {
    const maps = defaultMappings(
      [
        { key: 'netfx', name: 'NetFx', shots: 3, scenes: 1 },
        { key: 'netfxs', name: 'NetFxs', shots: 2, scenes: 1 },
        { key: 'netfxss', name: 'NetFxss', shots: 1, scenes: 1 },
        { key: 'wanka', name: 'Wanka', shots: 1, scenes: 1 },
      ],
      [{ key: 'v1', name: 'Otro estudio', code: 'WAN' }],
      { presets: ['#a', '#b'], used: [] },
    );
    expect(maps.netfxs).toEqual({ mode: 'merge', into: 'netfx' });
    expect(maps.netfxss).toEqual({ mode: 'merge', into: 'netfx' });
    expect(maps.wanka).toMatchObject({ mode: 'new', code: 'WAN2' });
  });

  it('una entidad que no existe queda como venía, el <t/> vacío no se traga el texto y las etiquetas con prefijo se leen', async () => {
    const sheet = '<x:worksheet><x:sheetData><x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t xml:space="preserve"/></x:is></x:c><x:c r="B1" t="inlineStr"><x:is><x:r><x:t>Bo</x:t></x:r><x:r><x:t>at &amp;#99999999;</x:t></x:r></x:is></x:c></x:row></x:sheetData></x:worksheet>';
    const book = '<x:workbook xmlns:r="r"><x:sheets><x:sheet name="S" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>';
    const rels = '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>';
    const file = new Blob([zip({ 'xl/workbook.xml': book, 'xl/_rels/workbook.xml.rels': rels, 'xl/worksheets/sheet1.xml': sheet }) as BlobPart]);
    const [s1] = await readSpreadsheet(file, 'p.xlsx');
    expect(s1.rows[0]).toEqual(['', 'Boat &#99999999;']);
  });
});

describe('el análisis', () => {
  const header = ['SHOTNAME', 'SUBCLIP', 'VENDOR'];
  const layout = { header: 0, shot: 0, vendor: 2, letter: 1 };
  const maps: Record<string, Mapping> = {
    wanka: { mode: 'new', name: 'Wanka', code: 'WAN', color: '#a' },
    boat: { mode: 'existing', vendor: 'v1' },
    'net vfx': { mode: 'merge', into: 'wanka' },
    nadie: { mode: 'skip' },
  };
  const rows = shotRows(
    [
      header,
      ['ERSO_1001_0100', '', 'Wanka'],
      ['ERSO_1001_0200', '', 'Boat, Net VFX'],
      ['ERSO_1016_0200', '101_16A1-01-01_B', 'Wanka'],
      ['ERSO_1016_0400', '101_16B-03-02', 'Boat'],
      ['ERSO_1016_1000', '', 'Boat'],
      ['ERSO_1038_0100', '101_38B-03-03', 'Nadie'],
      ['ERSO_3001_0100', '103_01-02-04_A', 'Wanka'],
      ['ERSO_3012_0100', '', ''],
      ['ERSO_3012_0200', '', 'Boat'],
      ['ERSO_3099_0100', '', ''],
      ['Comida', '', 'Wanka'],
    ],
    layout,
  );

  it('cada plano a su escena: exacta, por la letra del clip, sin poder saber cuál, o sin página', () => {
    const a = analyze(rows, ERSO_SCENES, maps, () => true);
    expect(Object.fromEntries([...a.assign].map(([k, v]) => [k, [...v].sort()]))).toEqual({
      p1001: ['n:wanka', 'v:v1'],
      p1016A: ['n:wanka'],
      p1016B: ['v:v1'],
      p3012: ['v:v1'],
    });
    expect([...a.viaLetter.get('1016')!.keys()]).toEqual(['p1016A', 'p1016B']);
    expect([...a.ambiguous.get('1016')!]).toEqual(['v:v1']);
    expect([...a.noPage.keys()]).toEqual(['3001']);
    // 1038 tiene un solo plano y su vendor no se importa: queda como «sin vendor».
    expect(a.shotsNoVendor).toBe(3);
    expect(a.scenesNoVendor).toBe(2);
    expect(a.badShots).toBe(1);
    expect(a.shots).toBe(11);
  });

  it('lo que no se puede asignar va aparte, y lo demás de la escena sigue', () => {
    const a = analyze(rows, ERSO_SCENES, maps, (pageId, t) => !(pageId === 'p1001' && t === 'v:v1') && pageId !== 'p3012');
    expect([...a.assign.get('p1001')!]).toEqual(['n:wanka']);
    expect(a.assign.has('p3012')).toBe(false);
    expect(Object.fromEntries([...a.blocked].map(([k, v]) => [k, [...v]]))).toEqual({ p1001: ['v:v1'], p3012: ['v:v1'] });
  });

  it('la columna equivocada se nota: casi ningún shot name', () => {
    expect(shotShare(rows)).toBeCloseTo(10 / 11);
    expect(shotShare(shotRows([header, ['Comida', '', 'X']], layout))).toBe(0);
  });

  it('contra lo asignado: suma lo nuevo, propone reemplazar lo que la planilla ya no da, y no toca lo demás', () => {
    const assign = new Map([
      ['p1', new Set(['v:a'])],
      ['p2', new Set(['v:b', 'n:x'])],
      ['p3', new Set(['v:a'])],
    ]);
    const current = new Map([
      ['p2', new Set(['v:b', 'v:c'])],
      ['p3', new Set(['v:a'])],
      ['p9', new Set(['v:c'])],
      ['p8', new Set<string>()],
    ]);
    const d = diff(assign, current);
    expect(d.adds).toEqual([
      ['p1', 'v:a'],
      ['p2', 'n:x'],
    ]);
    expect(d.changes).toEqual([{ pageId: 'p2', gone: ['v:c'], add: ['n:x'], keep: ['v:b'] }]);
    expect(d.untouched).toBe(1);
  });
});
