// @vitest-environment jsdom
// Filas con la misma altura (Docs/Doc_Fotos_En_Linea.md, "Filas con la misma altura"): una fila de fotos en línea con
// el mismo ancho guardado se muestra repartida según la proporción de cada foto, sin cambiar lo guardado; los tiradores
// en una fila así cambian solo la foto que se arrastra. Los anchos en px no se ven en jsdom: el reparto se prueba con
// números en imageRows.test.ts; acá, la decoración (`--ph-v`), la proporción al cargar, imprimir y exportar
// (`flushPhotoRows`), los tiradores y los tamaños rápidos.
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editorSchemaOptions } from './editorSchema';
import { evenRowWidths } from './imageRows';
import { PHOTO, photoRowAt, resizedWidths } from './inlinePhoto';
import { flushPhotoRows, inlinePhotoExtensions } from './inlinePhotoEditor';
import { setPhotoWidths } from './inlinePhotoSize';
import { forgetPhotoAspects, notePhotoAspect, photoAspect } from './photoAspects';

const editors: BlockNoteEditor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
  document.body.replaceChildren();
  forgetPhotoAspects();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'hidden');
});

function mount(blocks: PartialBlock[]): BlockNoteEditor {
  const editor = BlockNoteEditor.create({ ...editorSchemaOptions, extensions: [...inlinePhotoExtensions] }) as unknown as BlockNoteEditor;
  const host = document.createElement('div');
  document.body.append(host);
  editor.mount(host);
  editors.push(editor);
  editor.replaceBlocks(editor.document, blocks as never);
  return editor;
}

const V = 2 / 3;
const url = (name: string) => `https://example.invalid/${name}.jpg`;
const view = (e: BlockNoteEditor) => e.prosemirrorView!;
const ph = (name: string, w = 0) => ({ type: 'photo', props: { url: url(name), name, w } });
const p = (id: string, ...content: unknown[]): PartialBlock =>
  ({ id, type: 'paragraph', content: content.map((c) => (typeof c === 'string' ? { type: 'text', text: c, styles: {} } : c)) }) as never;
const el = (e: BlockNoteEditor, name: string) => view(e).dom.querySelector<HTMLElement>(`.sd-photo[data-name="${name}"]`)!;
/** El ancho que se muestra (`--ph-v`), o '' si se muestra el guardado. */
const shown = (e: BlockNoteEditor, name: string) => el(e, name).style.getPropertyValue('--ph-v').trim();
const stored = (e: BlockNoteEditor, name: string) => Number(view(e).state.doc.nodeAt(at(e, name))!.attrs.w);
/** Un cuadro: las proporciones nuevas vuelven a armar las filas en el cuadro siguiente. */
const frame = () => new Promise((r) => setTimeout(r, 60));

function at(e: BlockNoteEditor, name: string): number {
  let found = -1;
  view(e).state.doc.descendants((n, pos) => {
    if (n.type.name === PHOTO && n.attrs.name === name) found = pos;
    return found < 0;
  });
  if (found < 0) throw new Error(`No photo ${name}`);
  return found;
}

const aspects: Record<string, number> = { A: 1.5, B: 1.5, C: V, D: 1.5, E: V, F: 1.5, G: V, H: 1.5, I: 1.5, J: V, K: 1.5, L: V, M: V };
const noteAll = () => Object.entries(aspects).forEach(([n, a]) => notePhotoAspect(url(n), a));

describe('qué es una fila pareja', () => {
  it('fotos seguidas con el mismo ancho: el reparto de la misma altura; anchos distintos, un texto o una foto sin ancho en el medio: lo guardado', () => {
    noteAll();
    const E = mount([
      // Cinco a 1/3: una fila llena (A B C) y la última, que no llena (D E).
      p('r', ph('A', 1 / 3), ph('B', 1 / 3), ph('C', 1 / 3), ph('D', 1 / 3), ph('E', 1 / 3)),
      // Anchos distintos (los eligió alguien): como están.
      p('d', ph('F', 0.5), ph('G', 0.25), ph('H', 0.25)),
      // Un espacio en el medio: dos filas de una.
      p('t', ph('I', 0.5), ' ', ph('J', 0.5)),
      // Una foto sin ancho propio en el medio: corta la tanda y queda con su ancho natural.
      p('z', ph('K', 1 / 3), ph('L', 0), ph('M', 1 / 3)),
    ]);
    const full = evenRowWidths([1 / 3, 1 / 3, 1 / 3], [1.5, 1.5, V])!;
    expect(['A', 'B', 'C'].map((n) => Number(shown(E, n)))).toEqual(full);
    const last = evenRowWidths([1 / 3, 1 / 3], [1.5, V])!;
    expect(['D', 'E'].map((n) => Number(shown(E, n)))).toEqual(last);
    expect(last[0] + last[1]).toBeCloseTo(2 / 3, 4);
    for (const n of ['F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']) expect(shown(E, n), n).toBe('');
    expect(el(E, 'L').classList.contains('sd-photo-sized')).toBe(false);
    // Lo guardado no cambió: `w` y `--ph-w` siguen en 1/3 (una versión vieja lo ve como antes).
    expect(stored(E, 'C')).toBeCloseTo(1 / 3, 9);
    expect(el(E, 'C').style.getPropertyValue('--ph-w').trim()).toBe(String(1 / 3));
  });

  it('mientras falta la proporción de alguna, lo guardado; al llegar la última, la fila se arma sola, sin cambiar el documento', async () => {
    const E = mount([p('r', ph('A', 1 / 3), ph('B', 1 / 3), ph('C', 1 / 3))]);
    const before = view(E).state.doc;
    notePhotoAspect(url('A'), 1.5);
    notePhotoAspect(url('B'), 1.5);
    await frame();
    expect(['A', 'B', 'C'].map((n) => shown(E, n))).toEqual(['', '', '']);
    notePhotoAspect(url('C'), V);
    await frame();
    expect(['A', 'B', 'C'].map((n) => Number(shown(E, n)))).toEqual(evenRowWidths([1 / 3, 1 / 3, 1 / 3], [1.5, 1.5, V]));
    expect(view(E).state.doc.eq(before)).toBe(true);
  });

  it('cambiar los anchos con la barra (todas a 1/2) la vuelve a armar con el ancho nuevo', () => {
    noteAll();
    const E = mount([p('r', ph('A', 1 / 3), ph('C', 1 / 3))]);
    const v = view(E);
    const tr = v.state.tr;
    for (const n of ['A', 'C']) tr.setNodeAttribute(at(E, n), 'w', 0.5);
    v.dispatch(tr);
    expect(['A', 'C'].map((n) => Number(shown(E, n)))).toEqual(evenRowWidths([0.5, 0.5], [1.5, V]));
  });
});

describe('la proporción, al cargar la imagen', () => {
  const load = (img: HTMLImageElement, w: number, h: number) => {
    Object.defineProperty(img, 'naturalWidth', { value: w, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: h, configurable: true });
    img.dispatchEvent(new Event('load'));
  };

  it('la de la miniatura que se ve; la del marcador (un SVG), no', () => {
    const E = mount([p('r', ph('A', 1 / 3), ph('B', 1 / 3))]);
    load(el(E, 'A').querySelector('img')!, 300, 200);
    expect(photoAspect(url('A'))).toBeCloseTo(1.5, 9);
    const img = el(E, 'B').querySelector('img')!;
    img.src = 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22/%3E';
    load(img, 120, 90);
    expect(photoAspect(url('B'))).toBeUndefined();
  });

  it('con la nítida puesta, la de la miniatura que reemplazó (sharpMarks.ts)', () => {
    const E = mount([p('r', ph('A', 1 / 3))]);
    const img = el(E, 'A').querySelector('img')!;
    img.dataset.sdSharp = '200';
    img.dataset.sdSharpH = '300';
    load(img, 2000, 3001);
    expect(photoAspect(url('A'))).toBeCloseTo(200 / 300, 9);
  });
});

describe('los tiradores en una fila pareja', () => {
  it('cambia solo la que se arrastra: las demás guardan el ancho con que se veían', () => {
    noteAll();
    const E = mount([p('r', ph('A', 1 / 3), ph('B', 1 / 3), ph('C', 1 / 3))]);
    const seen = ['A', 'B', 'C'].map((n) => Number(shown(E, n)));
    const doc = view(E).state.doc;
    // La vertical, un poco más angosta de lo que se veía.
    const changes = resizedWidths(doc, at(E, 'C'), 0.15);
    expect([...changes].map(([pos, w]) => [String(doc.nodeAt(pos)!.attrs.name), w]).sort()).toEqual([
      ['A', seen[0]],
      ['B', seen[1]],
      ['C', 0.15],
    ]);
    const v = view(E);
    const tr = v.state.tr;
    for (const [pos, w] of changes) tr.setNodeAttribute(pos, 'w', w);
    v.dispatch(tr);
    // Ya no tiene anchos iguales: se muestra lo guardado, que para A y B es lo que se veía.
    expect(['A', 'B', 'C'].map((n) => shown(E, n))).toEqual(['', '', '']);
    expect(['A', 'B', 'C'].map((n) => stored(E, n))).toEqual([seen[0], seen[1], 0.15]);
    expect(photoRowAt(v.state.doc, at(E, 'C'))!.positions.length).toBe(3);
  });

  it('agrandarla hasta que no entra la baja de fila, como siempre (las otras dos quedan como se veían)', () => {
    noteAll();
    const E = mount([p('r', ph('A', 1 / 3), ph('B', 1 / 3), ph('C', 1 / 3))]);
    const seen = ['A', 'B'].map((n) => Number(shown(E, n)));
    const v = view(E);
    const tr = v.state.tr;
    for (const [pos, w] of resizedWidths(v.state.doc, at(E, 'C'), 0.25)) tr.setNodeAttribute(pos, 'w', w);
    v.dispatch(tr);
    expect(photoRowAt(v.state.doc, at(E, 'A'))!.positions.length).toBe(2);
    expect(photoRowAt(v.state.doc, at(E, 'C'))!.positions.length).toBe(1);
    expect(['A', 'B'].map((n) => stored(E, n))).toEqual(seen);
  });

  it('se compara con lo que se veía: soltarla en 1/3 cambia algo aunque guarde 1/3; en el mismo ancho, nada', () => {
    noteAll();
    const E = mount([p('r', ph('A', 1 / 3), ph('B', 1 / 3), ph('C', 1 / 3))]);
    const doc = view(E).state.doc;
    expect(resizedWidths(doc, at(E, 'C'), 1 / 3).get(at(E, 'C'))).toBeCloseTo(1 / 3, 9);
    expect(resizedWidths(doc, at(E, 'C'), Number(shown(E, 'C'))).size).toBe(0);
  });

  it('en una fila con anchos distintos, como siempre: solo la que se arrastra', () => {
    noteAll();
    const E = mount([p('d', ph('F', 0.5), ph('G', 0.25), ph('H', 0.25))]);
    const doc = view(E).state.doc;
    expect([...resizedWidths(doc, at(E, 'G'), 1 / 3)]).toEqual([[at(E, 'G'), 1 / 3]]);
    expect(resizedWidths(doc, at(E, 'G'), 0.25).size).toBe(0);
  });

  it('el ancho con que se veía es un imán: un temblor de unos px no cambia nada (no manda la vertical abajo)', () => {
    noteAll();
    const E = mount([p('r', ph('A', 1 / 3), ph('B', 1 / 3), ph('C', 1 / 3))]);
    const doc = view(E).state.doc;
    const a = Number(shown(E, 'A'));
    // 3 px en un renglón de 720 son 0,004; 14 px, 0,019: dentro del imán.
    for (const d of [0.004, -0.004, 0.019, -0.019]) expect(resizedWidths(doc, at(E, 'A'), a + d).size, String(d)).toBe(0);
    // Más allá del imán, cambia (y como ya no entra, la vertical baja de fila, como al agrandar cualquier foto de una fila llena).
    const changes = resizedWidths(doc, at(E, 'A'), a + 0.025);
    expect(changes.get(at(E, 'A'))).toBeCloseTo(a + 0.025, 9);
    expect(changes.get(at(E, 'B'))).toBe(Number(shown(E, 'B')));
  });
});

describe('los tamaños rápidos sobre parte de una fila pareja', () => {
  it('"1/4" a la vertical sola: las otras dos guardan el ancho con que se veían', () => {
    noteAll();
    const E = mount([p('r', ph('A', 1 / 3), ph('B', 1 / 3), ph('C', 1 / 3))]);
    const seen = ['A', 'B'].map((n) => Number(shown(E, n)));
    setPhotoWidths(view(E), [at(E, 'C')], 0.25);
    expect(['A', 'B', 'C'].map((n) => stored(E, n))).toEqual([...seen, 0.25]);
    // Las dos apaisadas siguen como se veían, a la misma altura entre ellas (ya no es una fila con anchos iguales).
    expect(['A', 'B'].map((n) => shown(E, n))).toEqual(['', '']);
  });

  it('a toda la fila: solo cambian las elegidas (y la fila sigue pareja con el ancho nuevo)', () => {
    noteAll();
    const E = mount([p('r', ph('A', 1 / 3), ph('C', 1 / 3)), p('s', ph('D', 1 / 3), ph('E', 1 / 3))]);
    setPhotoWidths(view(E), [at(E, 'A'), at(E, 'C')], 0.5);
    expect(['A', 'C', 'D', 'E'].map((n) => stored(E, n))).toEqual([0.5, 0.5, 1 / 3, 1 / 3]);
    expect(['A', 'C'].map((n) => Number(shown(E, n)))).toEqual(evenRowWidths([0.5, 0.5], [1.5, V]));
  });

  it('en una fila con anchos distintos, como siempre', () => {
    noteAll();
    const E = mount([p('d', ph('F', 0.5), ph('G', 0.25), ph('H', 0.25))]);
    setPhotoWidths(view(E), [at(E, 'G')], 1 / 3);
    expect(['F', 'G', 'H'].map((n) => stored(E, n))).toEqual([0.5, 1 / 3, 0.25]);
  });
});

describe('imprimir y exportar no esperan el cuadro siguiente', () => {
  /** Una imagen que ya cargó (`complete`) pero cuyo `load` todavía no llegó. */
  const loadedSilently = (img: HTMLImageElement, w: number, h: number) => {
    img.src = 'https://example.invalid/loaded.jpg';
    Object.defineProperty(img, 'complete', { value: true, configurable: true });
    Object.defineProperty(img, 'naturalWidth', { value: w, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: h, configurable: true });
  };
  const even = evenRowWidths([1 / 3, 1 / 3, 1 / 3], [1.5, 1.5, V])!;

  it('flushPhotoRows arma ya la fila con lo que falta: la proporción que llegó y la imagen cargada sin aviso', () => {
    // Sin cuadros (la pestaña oculta, o antes del cuadro siguiente).
    vi.stubGlobal('requestAnimationFrame', () => 0);
    const E = mount([p('r', ph('A', 1 / 3), ph('B', 1 / 3), ph('C', 1 / 3))]);
    notePhotoAspect(url('A'), 1.5);
    notePhotoAspect(url('B'), 1.5);
    loadedSilently(el(E, 'C').querySelector('img')!, 200, 300);
    expect(shown(E, 'C')).toBe('');
    flushPhotoRows(document.body);
    expect(['A', 'B', 'C'].map((n) => Number(shown(E, n)))).toEqual(even);
  });

  it('solo los editores de adentro de lo que se imprime', () => {
    vi.stubGlobal('requestAnimationFrame', () => 0);
    const E = mount([p('r', ph('A', 1 / 3), ph('B', 1 / 3), ph('C', 1 / 3))]);
    noteAll();
    flushPhotoRows(document.createElement('div'));
    expect(shown(E, 'A')).toBe('');
    flushPhotoRows(view(E).dom.parentElement);
    expect(Number(shown(E, 'A'))).toBe(even[0]);
  });

  it('con la pestaña oculta, en la vuelta siguiente (no en un cuadro, que no llega)', async () => {
    vi.stubGlobal('requestAnimationFrame', () => 0);
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    const E = mount([p('r', ph('A', 1 / 3), ph('B', 1 / 3), ph('C', 1 / 3))]);
    noteAll();
    await new Promise((r) => setTimeout(r, 5));
    expect(['A', 'B', 'C'].map((n) => Number(shown(E, n)))).toEqual(even);
  });

  it('a la vista, en el cuadro siguiente; una proporción de una foto de otra página no vuelve a armar nada', () => {
    const frames: (() => void)[] = [];
    vi.stubGlobal('requestAnimationFrame', (fn: () => void) => frames.push(fn));
    const E = mount([p('r', ph('A', 1 / 3), ph('B', 1 / 3), ph('C', 1 / 3))]);
    notePhotoAspect(url('Z'), 1.5);
    expect(frames).toHaveLength(0);
    noteAll();
    expect(frames).toHaveLength(1);
    expect(shown(E, 'A')).toBe('');
    frames[0]();
    expect(Number(shown(E, 'A'))).toBe(even[0]);
  });
});
