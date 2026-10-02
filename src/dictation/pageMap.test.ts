// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { builtinBlocks } from '../templates/builtin';
import { unmountAll, view } from '../ui/collabHarness';
import { cursorAt, mapOf, reportBlocks, reportEditor, targetBy } from './fixtures/report';
import { buildPageMap, labelKey, noteMentions, shotOfHeading } from './pageMap';

// El mapa de la página (Docs/Doc_Dictado.md, 5.2; prueba 10.1.1): las tres plantillas en los dos idiomas, una página
// llena, fotos y links como marcas, lo borrado y los comentarios afuera, el tope con secciones recortadas, el cursor y
// que cada dirección apunta al lugar correcto.

afterEach(unmountAll);

const photo = (name: string) => ({ type: 'photo', props: { url: `sdmedia://${name}`, name: `${name}.jpg`, w: 0.3 } });

describe('el mapa de la página', () => {
  it('On-Set Report en inglés: la ficha, Setups & takes con su encabezado, los renglones con rótulo, las casillas y la sección vacía del plano', () => {
    const ed = reportEditor();
    const map = mapOf(ed);
    expect(map.lang).toBe('en');
    expect(map.text).toMatch(/^PAGE "2026-10-02 \| Day 06" LANG en\nCURSOR /);
    expect(map.text).toContain('T1 (column c1 holds the labels of each row; write in c2)');
    expect(map.text).toContain('  r3 c1 "Location" | c2 "Nave 2"');
    expect(map.text).toContain('T3 header: c1 "Slate (Sc · Shot · Setup)" | c2 "Cam · Clip · TC" | c3 "Lens · Filters (ND, diffusion, pola)"');
    expect(map.text).toContain('  r2 c1 "12 · 010 · 1" | c2 "A · A001C003" | c3 "35 mm · ND .6" | c4 "T2.8 · 2,5 m" | c5 "" | c6 "24 · 180°" | c7 "3"');
    expect(map.text).toMatch(/\n {2}r4 c1 "" \| c2 "" \| c3 ""/);
    expect(map.text).toMatch(/\nH3 b\d+ "Shot "\n/);
    expect(map.text).toMatch(/\nK b\d+ \[ \] "Clean plate"\n/);
    expect(map.text).toMatch(/\nL b\d+ "Afternoon:" ""\n/);
    expect(map.text).toMatch(/\nL b\d+ "Director:" ""/);
    // Cada dirección apunta a su lugar.
    const lens = map.targets.get('T3 r2 c3')!;
    expect([lens.rowLabel, lens.colLabel, lens.text, lens.labelCell]).toEqual(['12 · 010 · 1', 'Lens · Filters (ND, diffusion, pola)', '35 mm · ND .6', false]);
    expect(view(ed).state.doc.textBetween(lens.start, lens.start + 13)).toBe('35 mm · ND .6');
    expect(map.targets.get('T3 r1 c3')!.labelCell).toBe(true);
    expect(map.targets.get('T1 r7 c1')!.labelCell).toBe(true);
    expect(map.targets.get('T1 r7 c2')!).toMatchObject({ rowLabel: 'Weather', labelCell: false, colLabel: '' });
    const afternoon = targetBy(map, (t) => t.label === 'Afternoon:');
    expect([afternoon.code, afternoon.text, afternoon.section]).toEqual(['L', '', 'Weather & light']);
    expect(map.shots).toHaveLength(1);
    expect(map.shots[0]).toMatchObject({ name: '', word: 'Shot' });
    expect(map.shots[0].checks.map((c) => c.plain)).toContain('HDRI');
    expect(map.vfx?.text).toBe('VFX shots');
    expect(map.summary).not.toBeNull();
    expect(map.trimmed).toBe(false);
  });

  it('en castellano: LANG es, los rótulos de la plantilla castellana y la sección "Plano "', () => {
    const ed = reportEditor(reportBlocks('es'));
    const map = mapOf(ed, 'Día 06');
    expect(map.lang).toBe('es');
    expect(map.text).toContain('T3 header: c1 "Claqueta (Esc · Plano · Setup)"');
    expect(map.text).toMatch(/\nL b\d+ "Tarde:" ""\n/);
    expect(map.shots[0]).toMatchObject({ name: '', word: 'Plano' });
    expect(map.vfx?.text).toBe('Planos de VFX');
  });

  it('las otras dos plantillas, en los dos idiomas, arman su mapa sin errores', () => {
    for (const kind of ['prepro', 'shot'] as const) {
      for (const lang of ['en', 'es'] as const) {
        const ed = reportEditor(builtinBlocks(kind, lang));
        const map = mapOf(ed);
        expect(map.lang, `${kind} ${lang}`).toBe(lang);
        expect(map.tables.length).toBeGreaterThan(0);
        unmountAll();
      }
    }
  });

  it('fotos y links van como marcas, sin direcciones; el cursor dice su celda', () => {
    const blocks = reportBlocks('en', {
      setups: [
        ['12 · 010 · 1', '', '', '', '', '', ''],
      ],
    });
    blocks.splice(2, 0, {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Ver ', styles: {} }, photo('set'), { type: 'text', text: ' y ', styles: {} }, { type: 'link', href: 'https://secreto.example/x', content: 'la referencia' }],
    });
    const ed = reportEditor(blocks);
    const map = mapOf(ed);
    expect(map.text).toMatch(/P b\d+ "Ver ⟦photo:1⟧ y ⟦link:1⟧la referencia⟦\/link⟧"/);
    expect(map.text).not.toContain('secreto.example');
    expect(map.text).not.toContain('sdmedia://');
    cursorAt(ed, mapOf(ed).targets.get('T3 r2 c3')!);
    const again = mapOf(ed);
    expect(again.text).toContain('CURSOR T3 r2 c3');
    expect(again.cursor).toMatchObject({ table: 3, row: 2 });
  });

  it('lo borrado no aparece (es el estado de ahora, no el Y.Doc con su historia)', () => {
    const ed = reportEditor();
    const summary = targetBy(mapOf(ed), (t) => t.code === 'P' && t.section === 'Summary');
    const v = view(ed);
    v.dispatch(v.state.tr.insertText('PRESUPUESTO SECRETO', summary.start));
    v.dispatch(v.state.tr.delete(summary.start, summary.start + 'PRESUPUESTO SECRETO'.length));
    expect(mapOf(ed).text).not.toContain('PRESUPUESTO');
  });

  it('una página larga manda las tablas, las casillas, los títulos y la sección del cursor, y lo dice; más larga, tooLong', () => {
    const long = Array.from({ length: 60 }, (_, i) => ({ type: 'paragraph', content: `Renglón largo número ${i} `.repeat(20) }));
    const blocks = reportBlocks();
    blocks.splice(2, 0, ...long);
    const ed = reportEditor(blocks);
    const map = mapOf(ed);
    expect(map.trimmed).toBe(true);
    expect(map.text.length).toBeLessThanOrEqual(20_000);
    expect(map.text).toContain('T3 header:');
    expect(map.text).toMatch(/K b\d+ \[ \] "HDRI"/);
    expect(map.text).not.toContain('Renglón largo número 5 ');
    expect(map.text).toContain('(The page is long: the text of some sections was left out.)');
    expect(buildPageMap(view(ed).state, 'x', { maxChars: 500 })).toBe('tooLong');
  });

  it('rótulos y planos: labelKey, shotOfHeading y noteMentions', () => {
    expect(labelKey('Lens · Filters')).toBe(labelKey('lens filters'));
    expect(shotOfHeading('Shot 12_010')).toEqual({ word: 'Shot', name: '12_010' });
    expect(shotOfHeading('Plano ')).toEqual({ word: 'Plano', name: '' });
    expect(shotOfHeading('Lighting')).toBeNull();
    expect(noteMentions('el 12_010 setup 3, la buena es la 4', '12 · 010 · 3')).toBe(true);
    expect(noteMentions('este plano con un 50', '12 · 010 · 3')).toBe(false);
    expect(noteMentions('el 12 011', '12 · 010 · 1')).toBe(false);
  });
});
