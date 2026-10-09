// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { unitsFromYDoc, type BlockMeta } from '../search/extract';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { schema } from '../ui/editorSchema';
import { aliasesFromFields, resolveLocationNames, withBareNames, writtenLevel } from './aliases';
import { addAliasesInDoc } from './aliasWrite';
import { readPageFields, type PageFields } from './fields';
import { buildRegistry, scan } from './reader';
import { locationFromTitle } from './register';

// Los otros nombres de una locación (Docs/Doc_Relaciones.md, «Otros nombres de una locación»; D526–D537): cómo se leen
// del campo, en qué nivel vale cada uno, qué pasa con los conflictos y cómo se escriben sin borrar nada.

const editors: BlockNoteEditor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
  document.body.innerHTML = '';
});

function mount(doc: Y.Doc): BlockNoteEditor {
  const editor = BlockNoteEditor.create(
    withCollaboration({ schema, collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } } }),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  editor.mount(el);
  editors.push(editor);
  return editor;
}

function docWith(blocks: unknown[]): Y.Doc {
  const doc = new Y.Doc();
  const e = mount(doc);
  e.replaceBlocks(e.document, blocks as never);
  return doc;
}

function fieldsOf(doc: Y.Doc): PageFields | null {
  const meta: BlockMeta[] = [];
  const units = unitsFromYDoc(doc, meta);
  return readPageFields(units, meta);
}

/** Lo que dice cada bloque del primer nivel (texto plano), en orden. */
function texts(doc: Y.Doc): string[] {
  const out: string[] = [];
  const meta: BlockMeta[] = [];
  const units = unitsFromYDoc(doc, meta);
  let last = '';
  for (const u of units) {
    if (u.blockId === last) out[out.length - 1] += ` | ${u.text}`;
    else out.push(u.text);
    last = u.blockId;
  }
  return out;
}

const line = (text: string) => ({ type: 'paragraph', content: text });
const table = (rows: string[][]) => ({ type: 'table', content: { type: 'tableContent', rows: rows.map((cells) => ({ cells })) } });

describe('leer los nombres escritos (D527)', () => {
  it('renglón, fila de tabla en inglés y título con una lista abajo', () => {
    expect(aliasesFromFields(fieldsOf(docWith([line('Otros nombres: Arenera, Estudio; Estudio Autos')])))).toEqual(['Arenera', 'Estudio', 'Estudio Autos']);
    expect(aliasesFromFields(fieldsOf(docWith([table([['Also known as', 'Studio · Back lot'], ['Address', 'Ruta 8']])])))).toEqual(['Studio', 'Back lot']);
    const heading = docWith([
      { type: 'heading', props: { level: 2 }, content: 'Otros nombres' },
      { type: 'bulletListItem', content: 'Arenera' },
      { type: 'bulletListItem', content: 'Estudio | Autos' },
      { type: 'heading', props: { level: 2 }, content: 'Notas' },
      line('No es un nombre'),
    ]);
    expect(aliasesFromFields(fieldsOf(heading))).toEqual(['Arenera', 'Estudio | Autos']);
    expect(aliasesFromFields(fieldsOf(docWith([line('AKA: Pasaje Bar'), line('a.k.a.: El Pasaje')])))).toEqual(['Pasaje Bar', 'El Pasaje']);
  });

  it('comillas, «?» del final, vacíos, «—», números, largo, repetidos, el nombre propio y el tope de 40', () => {
    const doc = docWith([line(`Otros nombres: «Arenera», "Europa ?", —, , 12, x, ${'L'.repeat(61)}, ARENERA, La Arenera (estudio), 'Estudio'`)]);
    expect(aliasesFromFields(fieldsOf(doc), 'La Arenera (estudio)')).toEqual(['Arenera', 'Europa', 'Estudio']);
    const many = Array.from({ length: 50 }, (_, i) => `Nombre ${i}`).join(', ');
    expect(aliasesFromFields(fieldsOf(docWith([line(`Aliases: ${many}`)])))).toHaveLength(40);
    expect(aliasesFromFields(fieldsOf(docWith([table([['Otros nombres', '—']])])))).toEqual([]);
  });

  it('un renglón que no empieza con el rótulo no es el campo', () => {
    expect(aliasesFromFields(fieldsOf(docWith([line('Le dicen también otros nombres: Arenera')])))).toEqual([]);
  });
});

describe('niveles y conflictos (D529, D533)', () => {
  const loc = (title: string, written: string[] = [], pageId = title) => ({ ...locationFromTitle(title), pageId, written });

  it('dos palabras o más en el texto; una palabra por palabra donde se espera un lugar; un genérico, como parte entera', () => {
    expect(['Pasaje Bar', 'Arenera', 'Estudio', 'Europa', 'bar', 'BA'].map(writtenLevel)).toEqual(['text', 'place', 'whole', 'whole', 'whole', 'place']);
    const { inputs, notes } = resolveLocationNames([loc('La Arenera (estudio)', ['Arenera', 'Estudio', 'Estudio Autos'])]);
    expect(notes).toEqual([]);
    expect(inputs).toEqual([
      { name: 'La Arenera (estudio)', aliases: ['La Arenera (estudio)', 'La Arenera', 'Estudio Autos'], dayTitleAliases: ['Arenera'], wholeAliases: ['Estudio'], pageId: 'La Arenera (estudio)' },
    ]);
  });

  it('sin nada escrito, lo mismo que antes (D416, D417)', () => {
    const locs = [loc('CENADE (Centro Nacional)'), loc('La Arenera (estudio)'), loc('Lübben (Europa)')];
    expect(resolveLocationNames(locs).inputs).toEqual(withBareNames(locs.map(({ written: _w, ...l }) => l)));
  });

  it('dos escritos iguales: ninguno, con una nota en cada una; sin tildes ni mayúsculas', () => {
    const { inputs, notes } = resolveLocationNames([loc('Europa (plates)', ['Europa']), loc('Brandemburgo (Europa)', ['EUROPA'])]);
    expect(inputs.map((l) => [l.wholeAliases, l.dayTitleAliases])).toEqual([
      [undefined, undefined],
      [undefined, ['Brandemburgo']],
    ]);
    expect(notes).toEqual([
      { loc: 'Europa (plates)', alias: 'Europa', kind: 'shared', others: ['Brandemburgo (Europa)'] },
      { loc: 'Brandemburgo (Europa)', alias: 'EUROPA', kind: 'shared', others: ['Europa (plates)'] },
    ]);
  });

  it('un escrito igual al nombre de otra locación no cuenta (nota); un escrito tapa al derivado igual de otra', () => {
    const { inputs, notes } = resolveLocationNames([loc('La candelaria + Cofa', ['Cofa', 'Bar Berlin']), loc('Cofa'), loc('Bar Berlin (Claridge)')]);
    expect(notes).toEqual([{ loc: 'La candelaria + Cofa', alias: 'Cofa', kind: 'name', others: ['Cofa'] }]);
    expect(inputs[0].aliases).toEqual(['La candelaria + Cofa', 'Bar Berlin']);
    // «Bar Berlin» (sin paréntesis) lo derivaba Bar Berlin (Claridge); alguien lo escribió en otra: el derivado se cae.
    expect(inputs[2].aliases).toEqual(['Bar Berlin (Claridge)']);
  });

  it('el registro: todas las formas a la vista (D536); el lector usa cada una en su nivel', () => {
    const { inputs, notes } = resolveLocationNames([loc('La Arenera (estudio)', ['Arenera', 'Estudio', 'Estudio Autos']), loc('Estudio UnFilm')]);
    const R = buildRegistry({ scenes: [{ code: '105_027' }], locations: inputs, notes });
    expect(R.locations.get('La Arenera (estudio)')!.forms).toEqual(['La Arenera (estudio)', 'La Arenera', 'Estudio Autos', 'Arenera', 'Estudio']);
    expect(R.locations.get('La Arenera (estudio)')!.aliases).toEqual(R.locations.get('La Arenera (estudio)')!.forms);
    const refs = (text: string, place = false) => scan(R, text, { dayTitle: place }).filter((h) => h.kind === 'loc').map((h) => h.ref);
    expect(refs('Filmamos en el Estudio Autos')).toEqual(['La Arenera (estudio)']);
    expect(refs('la arenera va bien, el estudio de sonido')).toEqual(['La Arenera (estudio)']);
    expect(refs('2026-03-01 | Día 34 | Arenera VA', true)).toEqual(['La Arenera (estudio)']);
    expect(refs('Arenera VA', false)).toEqual([]);
    expect(refs('Estudio | Autos', true)).toEqual(['La Arenera (estudio)']);
    expect(refs('Estudio UnFilm', true)).toEqual(['Estudio UnFilm']);
  });
});

describe('escribirlos en la página (D543): solo agrega', () => {
  it('sin el campo: un renglón primero, sin tocar lo demás; de nuevo, nada', () => {
    const doc = docWith([line('Galpón grande, portón al sur.'), table([['Address', 'Ruta 8 km 40']])]);
    const before = texts(doc);
    const out = addAliasesInDoc(doc, ['Arenera', 'Estudio'], 'Otros nombres');
    expect(out.added).toEqual(['Arenera', 'Estudio']);
    expect(texts(doc)).toEqual(['Otros nombres: Arenera, Estudio', ...before]);
    expect(addAliasesInDoc(doc, ['arenera', 'ESTUDIO'], 'Otros nombres')).toEqual({ added: [], blockId: out.blockId });
    expect(texts(doc)).toEqual(['Otros nombres: Arenera, Estudio', ...before]);
  });

  it('con el renglón: agrega al final lo que falta, sin estirar la negrita ni un link', () => {
    const doc = docWith([{ type: 'paragraph', content: [{ type: 'text', text: 'Otros nombres: ', styles: {} }, { type: 'text', text: 'Arenera', styles: { bold: true } }] }, line('Notas')]);
    addAliasesInDoc(doc, ['Arenera', 'Estudio Autos'], 'Otros nombres');
    expect(texts(doc)).toEqual(['Otros nombres: Arenera, Estudio Autos', 'Notas']);
    const e = mount(doc);
    const content = e.document[0].content as { text: string; styles: Record<string, unknown> }[];
    expect(content.map((c) => [c.text, !!c.styles.bold])).toEqual([['Otros nombres: ', false], ['Arenera', true], [', Estudio Autos', false]]);
  });

  it('con la fila de la plantilla (vacía o con algo): escribe en la celda del valor', () => {
    const empty = docWith([table([['Also known as', ''], ['Address', 'Ruta 8']])]);
    addAliasesInDoc(empty, ['Back lot'], 'Other names');
    expect(aliasesFromFields(fieldsOf(empty))).toEqual(['Back lot']);
    expect(texts(empty)).toEqual(['Also known as | Back lot | Address | Ruta 8']);
    const some = docWith([table([['Otros nombres', 'Arenera'], ['Dirección', 'Ruta 8']])]);
    addAliasesInDoc(some, ['Estudio'], 'Otros nombres');
    expect(aliasesFromFields(fieldsOf(some))).toEqual(['Arenera', 'Estudio']);
  });

  it('dos dispositivos agregan a la vez sin red: al juntarse, quedan los dos nombres', () => {
    const a = docWith([line('Notas de la locación')]);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    addAliasesInDoc(a, ['Arenera'], 'Otros nombres');
    addAliasesInDoc(b, ['Estudio'], 'Otros nombres');
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(aliasesFromFields(fieldsOf(a)).sort()).toEqual(['Arenera', 'Estudio']);
    expect(texts(a)).toEqual(texts(b));
    expect(texts(a)).toContain('Notas de la locación');
  });

  it('con el renglón ya escrito en los dos: los dos agregados quedan en el mismo renglón', () => {
    const a = docWith([line('Otros nombres: Arenera')]);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    addAliasesInDoc(a, ['Estudio'], 'Otros nombres');
    addAliasesInDoc(b, ['Estudio Autos'], 'Otros nombres');
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    expect(aliasesFromFields(fieldsOf(a)).sort()).toEqual(['Arenera', 'Estudio', 'Estudio Autos']);
  });
});

describe('deshacer lo agregado (D539): solo eso y solo si sigue igual', () => {
  it('el renglón nuevo se saca; si alguien escribió adentro, queda', async () => {
    const { removeAddedAliasesInDoc } = await import('./aliasWrite');
    const doc = docWith([line('Galpón grande.')]);
    const out = addAliasesInDoc(doc, ['Edif Ministe Hall'], 'Other names');
    expect(out.undo).toMatchObject({ kind: 'block', text: 'Other names: Edif Ministe Hall' });
    expect(removeAddedAliasesInDoc(doc, out.undo!)).toBe('removed');
    expect(texts(doc)).toEqual(['Galpón grande.']);
    const again = addAliasesInDoc(doc, ['Pasaje Bar'], 'Other names');
    const e = mount(doc);
    e.updateBlock(e.document[0], { content: 'Other names: Pasaje Bar, El Pasaje' } as never);
    expect(removeAddedAliasesInDoc(doc, again.undo!)).toBe('changed');
    expect(texts(doc)).toEqual(['Other names: Pasaje Bar, El Pasaje', 'Galpón grande.']);
  });

  it('lo agregado al final del renglón se saca aunque otro dispositivo haya escrito antes; si lo tocaron, no', async () => {
    const { removeAddedAliasesInDoc } = await import('./aliasWrite');
    const a = docWith([line('Otros nombres: Arenera')]);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const out = addAliasesInDoc(a, ['Estudio Autos'], 'Otros nombres');
    expect(out.undo).toMatchObject({ kind: 'text', text: ', Estudio Autos' });
    // Otro dispositivo, a la vez y sin red, agrega al principio del mismo renglón.
    const t = ((b.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlElement;
    (t.get(0) as Y.XmlText).insert(0, 'Nota. ');
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    expect(texts(a)[0]).toBe('Nota. Otros nombres: Arenera, Estudio Autos');
    expect(removeAddedAliasesInDoc(a, out.undo!)).toBe('removed');
    expect(texts(a)[0]).toBe('Nota. Otros nombres: Arenera');
    // Escrito y después cambiado adentro: no se saca nada.
    const c = docWith([line('Otros nombres: Arenera')]);
    const two = addAliasesInDoc(c, ['Estudio'], 'Otros nombres');
    const xt = ((c.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlElement;
    const text = xt.toArray().find((x) => x instanceof Y.XmlText) as Y.XmlText;
    text.insert(text.length - 2, 'X');
    expect(removeAddedAliasesInDoc(c, two.undo!)).toBe('changed');
    expect(texts(c)[0]).toBe('Otros nombres: Arenera, EstudXio');
  });
});
