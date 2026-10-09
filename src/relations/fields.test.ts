// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { finishBlocks, prepareCodaHtml, type LooseBlock } from '../import/codaHtml';
import { unitsFromYDoc, type BlockMeta } from '../search/extract';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { schema } from '../ui/editorSchema';
import { coordsIn, emptyValue, fieldDate, fieldName, fieldValues, normLabel, placeUnits, readPageFields, type PageFields } from './fields';

// Los campos de una página («rótulo: valor», Docs/Doc_Relaciones.md, sección 3): con una ficha con la forma real de las
// de BD Main de Coda (la tabla de campos y los títulos con texto, pasada por la importación de la app y escrita en el
// Y.Doc con el editor real) y con lo que no tiene que ser un campo.

const editors: BlockNoteEditor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
});

const SET_PAGE = '11111111-2222-4333-8444-555555555555';
const SET_CODA = 'row-grid-AAAAAAAAAA-i-BBBBBBBBBB';

/** Una ficha como las de BD Main: la estructura exacta del HTML que exporta Coda, con textos inventados. */
const CARD_HTML =
  `<div><img src="https://codahosted.io/docs/DOC/blobs/bl-aaaa/abc" alt="PRUEBA_105_027_ Ambulancia.png"></div>` +
  `<table><tbody>` +
  `<tr><td><b>EP</b></td><td>105</td></tr>` +
  `<tr><td><b>Shot Name</b></td><td><span style="background-color: #f69988">PRUEBA_105_027_010</span></td></tr>` +
  `<tr><td><b>SCN</b></td><td>027</td></tr>` +
  `<tr><td><b>INT/EXT DIA/NOCHE</b></td><td>INT-EXT/NOCHE</td></tr>` +
  `<tr><td><b>Locacion Guion</b></td><td><span style="background-color: #fff9c4"><a href="coda-page:${SET_CODA}">Ambulancia | Ruta INT</a></span></td></tr>` +
  `<tr><td><b>Locacion Real</b></td><td><span style="background-color: #fff9c4; color: #33691e">Estudio | Autos</span></td></tr>` +
  `<tr><td><b>Notas</b></td><td></td></tr>` +
  `<tr><td><b>Consultas Cat</b></td><td><span style="background-color: #F8E7F3; color: #A12B86">Story,Previs</span></td></tr>` +
  `<tr><td><b>VFX Task</b></td><td><span style="background-color: #9fa8da"><div style="text-align: center; margin-top: 0.5em; margin-bottom: 0.5em;"><span>Window comp con elementos de set</span></div></span></td></tr>` +
  `<tr><td><b>Fecha Rodaje</b></td><td>06/03/2026</td></tr>` +
  `</tbody></table>` +
  `<h3>Descripción</h3><div style="text-align: left; margin-top: 0.5em; margin-bottom: 0.5em;"><span>El fugitivo va acostado atrás.</span><br><br><span>Adelante, el chofer y el oficial forcejean.</span></div>` +
  `<h3>Consultas</h3><div style="text-align: left; margin-top: 0.5em; margin-bottom: 0.5em;"><span>¿Todo el interior se filma en estudio o solo el vuelco?</span><br><span>Referencias del estilo del vuelco.</span></div>` +
  `<h3>Sup Notes</h3><div style="text-align: left; margin-top: 0.5em; margin-bottom: 0.5em;"><span>Guion técnico: 7 puestas.</span></div>`;

/** El HTML de Coda como lo importa la app (prepara, convierte con BlockNote y termina) y escrito en un Y.Doc. */
async function imported(html: string): Promise<Y.Doc> {
  const parser = BlockNoteEditor.create({ schema }) as unknown as BlockNoteEditor;
  editors.push(parser);
  const { html: prepared, media } = prepareCodaHtml(html, (id) => (id === SET_CODA ? `/p/${SET_PAGE}` : null));
  const parsed = (await parser.tryParseHTMLToBlocks(prepared)) as unknown as LooseBlock[];
  const blocks = finishBlocks(parsed, (i) => ({ type: 'image', props: { url: `sdmedia://0000000${i}-aaaa-4bbb-8ccc-dddddddddddd`, name: media[i].name }, children: [] }));
  return written(blocks);
}

function written(blocks: unknown[]): Y.Doc {
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

function fieldsOf(doc: Y.Doc): PageFields | null {
  const meta: BlockMeta[] = [];
  const units = unitsFromYDoc(doc, meta);
  return readPageFields(units, meta);
}

const p = (text: string) => ({ type: 'paragraph', content: text });
const h = (level: number, text: string) => ({ type: 'heading', props: { level }, content: text });
const table = (rows: string[][]) => ({ type: 'table', content: { type: 'tableContent', rows: rows.map((cells) => ({ cells })) } });

describe('una ficha de BD Main importada de Coda', () => {
  it('la tabla da un campo por fila (con la celda vacía y el link al decorado) y los títulos conocidos, lo de abajo', async () => {
    const doc = await imported(CARD_HTML);
    const page = fieldsOf(doc)!;
    const byLabel = Object.fromEntries(page.fields.map((f) => [f.label, f]));
    expect(page.fields.filter((f) => f.via === 'table').map((f) => [f.label, f.text])).toEqual([
      ['EP', '105'],
      ['Shot Name', 'PRUEBA_105_027_010'],
      ['SCN', '027'],
      ['INT/EXT DIA/NOCHE', 'INT-EXT/NOCHE'],
      ['Locacion Guion', 'Ambulancia | Ruta INT'],
      ['Locacion Real', 'Estudio | Autos'],
      ['Notas', ''],
      ['Consultas Cat', 'Story,Previs'],
      ['VFX Task', 'Window comp con elementos de set'],
      ['Fecha Rodaje', '06/03/2026'],
    ]);
    // El decorado es un link a su página, con su texto.
    expect(byLabel['Locacion Guion'].links).toEqual([{ pageId: SET_PAGE, text: 'Ambulancia | Ruta INT' }]);
    // Los títulos conocidos (Descripción, Consultas) llevan lo de abajo hasta el próximo título, renglón por renglón;
    // «Sup Notes» no es un rótulo conocido.
    const headings = page.fields.filter((f) => f.via === 'heading');
    expect(headings.map((f) => [f.label, f.text])).toEqual([
      ['Descripción', 'El fugitivo va acostado atrás.\nAdelante, el chofer y el oficial forcejean.'],
      ['Consultas', '¿Todo el interior se filma en estudio o solo el vuelco?\nReferencias del estilo del vuelco.'],
    ]);
    expect(headings[1].endBlockId).toBeTruthy();
    // Por nombre: con sus rótulos en castellano e inglés.
    expect(fieldValues(page, 'openQuestion').map((f) => f.label)).toEqual(['Consultas']);
    expect(fieldValues(page, 'set')[0].links[0].pageId).toBe(SET_PAGE);
    expect(fieldValues(page, 'intExt')[0].text).toBe('INT-EXT/NOCHE');
    expect(fieldDate(fieldValues(page, 'shootDate')[0].text)).toBe('2026-03-06');
    expect(fieldValues(page, 'shot')[0].text).toBe('PRUEBA_105_027_010');
    // «Consultas Cat» es otro campo, no la pregunta.
    expect(fieldValues(page, 'openQuestion').some((f) => f.text === 'Story,Previs')).toBe(false);
    // Una lista de rótulos propia también sirve.
    expect(fieldValues(page, ['Consultas Cat']).map((f) => f.text)).toEqual(['Story,Previs']);
  });

  it('leer las filas y columnas de una tabla no cambia las unidades de la búsqueda', async () => {
    const doc = await imported(CARD_HTML);
    const meta: BlockMeta[] = [];
    expect(unitsFromYDoc(doc, meta)).toEqual(unitsFromYDoc(doc));
    const t = meta.find((m) => m.cells)!;
    expect(t.cols).toBe(2);
    // Diez filas; la de «Notas» tiene solo el rótulo (la celda vacía no da unidad).
    expect(new Set(t.cells!.map((c) => c.row)).size).toBe(10);
    expect(t.cells!.filter((c) => c.row === 6).map((c) => c.col)).toEqual([0]);
  });
});

describe('las otras formas', () => {
  it('un renglón que empieza con un rótulo conocido y dos puntos', () => {
    const page = fieldsOf(written([p('Consultas: ¿la sangre es práctica?'), p('INT/EXT: INT'), p('Open question: ¿de día o de noche?'), p('Fecha de rodaje: 2026-02-20')]))!;
    expect(page.fields.map((f) => [f.via, normLabel(f.label), f.text])).toEqual([
      ['line', 'consultas', '¿la sangre es práctica?'],
      ['line', 'int ext', 'INT'],
      ['line', 'open question', '¿de día o de noche?'],
      ['line', 'fecha de rodaje', '2026-02-20'],
    ]);
    expect(fieldValues(page, 'openQuestion').length).toBe(2);
    expect(fieldDate(fieldValues(page, 'shootDate')[0].text)).toBe('2026-02-20');
  });

  it('un título conocido toma lo de abajo hasta el próximo título o hasta un renglón que es otro campo', () => {
    const page = fieldsOf(written([h(3, 'Consultas'), p('¿Se filma de noche?'), p('INT/EXT: EXT'), p('Otra cosa'), h(3, 'Open questions:'), p('¿Lluvia en post?')]))!;
    expect(page.fields.map((f) => [f.via, f.label, f.text])).toEqual([
      ['heading', 'Consultas', '¿Se filma de noche?'],
      ['line', 'INT/EXT', 'EXT'],
      ['heading', 'Open questions', '¿Lluvia en post?'],
    ]);
    expect(page.fields[0].endBlockId).toBeTruthy();
    expect(page.fields[2].endBlockId).toBeNull();
  });

  it('lo que no es un campo', () => {
    const page = fieldsOf(
      written([
        // «Open question» en el medio de un texto, o sin dos puntos, no es un campo.
        p('Quedó una open question: no sabemos si se filma el vuelco.'),
        p('Open question about the car, to check tomorrow.'),
        p('Hay que revisar las consultas: mañana.'),
        // Un renglón con dos puntos que no es un rótulo conocido.
        p('Llamado 7:00 en la playa de maniobras.'),
        // Un título que no es entero un rótulo conocido.
        h(2, 'Consultas generales del día'),
        p('Todo bien.'),
        // Una tabla de tres columnas no es una ficha; tampoco una primera celda que es una oración.
        table([
          ['Plano', 'Toma', 'Nota'],
          ['010', '3', 'buena'],
        ]),
        table([['Este es un texto largo en la primera celda que no es un rótulo', 'algo']]),
      ]),
    );
    expect(page).toBeNull();
  });

  it('las coordenadas: grados con hemisferio o un par decimal; no un número con °, una dirección ni un año', () => {
    expect(coordsIn(`Predio 34° 40' 12.5" S 58° 27' 03.1" W`)).toBe(`34° 40' 12.5" S 58° 27' 03.1" W`);
    expect(coordsIn('34°40\'12.5"S, 58°27\'03.1"O')).toBe('34°40\'12.5"S, 58°27\'03.1"O');
    expect(coordsIn('Punto: -34.6701, -58.4508')).toBe('-34.6701, -58.4508');
    expect(coordsIn('Locomotora N°3925 tipo 4-6-2 de 1926')).toBeNull();
    expect(coordsIn('Av. Suárez 2027, 3500 nits')).toBeNull();
    expect(coordsIn('A 90° de la cámara')).toBeNull();
    // Un par decimal sin signo ni hemisferio (un formato, unos lentes, una hora) no es una coordenada (O1 de la auditoría),
    // salvo como valor de un campo de coordenadas.
    expect(coordsIn('Aspect 1.7778, 2.3900')).toBeNull();
    expect(coordsIn('Lentes 35.0000, 50.0000')).toBeNull();
    expect(coordsIn('18.3000, 19.4500 hs')).toBeNull();
    expect(coordsIn('34.6701, 58.4508', true)).toBe('34.6701, 58.4508');
    expect(coordsIn('34.6701 S, 58.4508 W')).toBe('34.6701 S, 58.4508 W');
    expect(coordsIn('Ruta 205 km 40, Ezeiza', true)).toBeNull();
    const page = fieldsOf(written([p('Acceso por el portón norte.'), p(`Predio 34° 40' 12.5" S 58° 27' 03.1" W`)]))!;
    expect(page.coords?.text).toBe(`34° 40' 12.5" S 58° 27' 03.1" W`);
    expect(page.fields).toEqual([]);
  });

  it('rótulos, valores vacíos y fechas', () => {
    expect(normLabel('INT/EXT  Día/Noche:')).toBe('int ext dia noche');
    expect(fieldName('Locación Guión')).toBe('set');
    expect(fieldName('OPEN QUESTIONS')).toBe('openQuestion');
    expect(fieldName('Sup Notes')).toBeNull();
    expect(['—', '-', ' ', 'N/A', 'none'].every(emptyValue)).toBe(true);
    expect(emptyValue('No VFX')).toBe(false);
    expect(fieldDate('06/03/2026')).toBe('2026-03-06');
    expect(fieldDate('6-3-2026')).toBe('2026-03-06');
    expect(fieldDate('2026-03-06')).toBe('2026-03-06');
    expect(fieldDate('31/13/2026')).toBeNull();
    expect(fieldDate('mañana')).toBeNull();
  });
});

describe('pregunta abierta sin texto (O11 de la auditoría de E7)', () => {
  it('los renglones que son solo un rótulo vacío no cuentan; lo escrito después de un rótulo, sí', async () => {
    const { openQuestionText } = await import('./fields');
    expect(openQuestionText('Director: \nProduction design: ')).toBe('');
    expect(openQuestionText('Director:')).toBe('');
    expect(openQuestionText('Director: ¿cámara en mano?\nArte: ')).toBe('Director: ¿cámara en mano?');
    expect(openQuestionText('¿La sangre es práctica o se agrega?')).toBe('¿La sangre es práctica o se agrega?');
    expect(openQuestionText('Hora: 10:30 en el set')).toBe('Hora: 10:30 en el set');
  });
});

describe('otros nombres y el contexto de lugar (D527, D530)', () => {
  it('los rótulos de otros nombres en castellano e inglés, en tabla, renglón y título', () => {
    expect(['Otros nombres', 'Also known as', 'AKA', 'a.k.a.', 'Other names', 'Alias', 'Aliases', 'También conocida como', 'Nombres alternativos'].map(fieldName)).toEqual(
      Array(9).fill('aliases'),
    );
    const page = fieldsOf(written([table([['Also known as', 'Back lot']]), p('Otros nombres: Arenera'), h(2, 'Aliases'), p('Galpón')]))!;
    expect(fieldValues(page, 'aliases').map((f) => [f.via, f.text])).toEqual([
      ['table', 'Back lot'],
      ['line', 'Arenera'],
      ['heading', 'Galpón'],
    ]);
  });

  it('cada campo sabe sus unidades: la celda del valor, el renglón entero, lo de abajo del título', () => {
    const doc = written([table([['Locación', 'CENADE'], ['Notas', '']]), p('Locacion Real: Estudio | Autos'), h(2, 'Location'), p('Back lot'), p('Gate 3')]);
    const meta: BlockMeta[] = [];
    const units = unitsFromYDoc(doc, meta);
    const page = readPageFields(units, meta)!;
    const text = (us: number[]) => us.map((i) => units[i].text);
    expect(page.fields.map((f) => [f.label, text(f.units)])).toEqual([
      ['Locación', ['CENADE']],
      ['Notas', []],
      ['Locacion Real', ['Locacion Real: Estudio | Autos']],
      ['Location', ['Back lot', 'Gate 3']],
    ]);
    expect(text([...placeUnits(units, meta)])).toEqual(['CENADE', 'Locacion Real: Estudio | Autos', 'Back lot', 'Gate 3']);
  });

  it('la ficha de BD Main: Locacion Real es un lugar; Locacion Guion (el decorado de la historia), no', async () => {
    const doc = await imported(CARD_HTML);
    const meta: BlockMeta[] = [];
    const units = unitsFromYDoc(doc, meta);
    expect([...placeUnits(units, meta)].map((i) => units[i].text)).toEqual(['Estudio | Autos']);
  });
});
