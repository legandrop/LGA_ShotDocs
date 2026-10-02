// @vitest-environment jsdom
// Anotar sobre las fotos, entregas 0 y 1 (P.20, Docs/Doc_Anotar_Fotos.md): las anotaciones viven en el mapa raíz
// `photoMarkup` del documento de la página, afuera del contenido. Acá, con el editor de verdad:
// - Entrega 0: las versiones publicadas abren, editan y devuelven la página sin perder una clave del mapa (aunque
//   saquen la foto anotada); el deshacer de la página no deshace anotaciones.
// - Entrega 1: el dibujo encima de la foto en línea, la de una celda y la foto-bloque, montado siempre; se redibuja
//   con cada cambio (también de otro); la vista de impresión lo copia; un mapa malicioso se dibuja acotado y sin HTML.
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addShape, deleteShape, PHOTO_MARKUP_MAP, removePhotoMarkup, shapeKey, updateShape, type ShapeFields } from '../media/markup';
import { mediaIdsInDoc } from '../media/usage';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { connect, mountEditor, tick, undoManager, unmountAll, view } from './collabHarness';
import { schema } from './editorSchema';
import { schema as previousPublished } from './fixtures/editorSchemaAnterior';
import { schema as publishedSchema } from './fixtures/editorSchemaMain';
import { attachMarkupOverlay, minStrokeFor, type MarkupOverlay } from './markupOverlay';
import { previousSchema } from './photoHarness';
import { buildPrintView } from './printView';
import { findUnknownContent } from './unknownContent';

const overlays: MarkupOverlay[] = [];
afterEach(() => {
  for (const o of overlays.splice(0)) o.stop();
  unmountAll();
});

const ID = (n: number) => `0f8fad5b-d9cb-469f-a165-7086772895${String(n).padStart(2, '0')}`;
const URL_OF = (n: number) => `sdmedia://${ID(n)}`;
const text = (t: string) => ({ type: 'text', text: t, styles: {} });
const inline = (n: number, w = 0) => ({ type: 'photo', props: { url: URL_OF(n), name: `F${n}.jpg`, w } });
const FRAME = { w: 4000, h: 3000 };

/** Una página con una foto-bloque (1), una foto en línea (2), una tabla con una foto en una celda (3) y otra foto sin anotar (4). */
const PAGE: PartialBlock[] = [
  { id: 'blk', type: 'image', props: { url: URL_OF(1), name: 'F1.jpg' } },
  { id: 'par', type: 'paragraph', content: [text('Plano 12 '), inline(2, 0.5)] },
  { id: 'tb', type: 'table', content: { type: 'tableContent', rows: [{ cells: [[text('1A')], [inline(3)]] }] } },
  { id: 'otra', type: 'paragraph', content: [inline(4, 0.25), text(' sin anotar')] },
] as never;

/** Las nueve formas de la entrega 2 (las ocho de FrameRev que lleva la web y la flecha abierta en las dos puntas). */
const NINE: [string, ShapeFields][] = [
  ['r', { type: 'rectangle', zValue: 1, posX: 100, posY: 100, rectX: 0, rectY: 0, rectW: 800, rectH: 500, strokeWidth: 6 }],
  ['e', { type: 'ellipse', zValue: 2, posX: 1200, posY: 300, rectX: 0, rectY: 0, rectW: 600, rectH: 600, strokeColor: '#ff3b30' }],
  ['a', { type: 'arrow', zValue: 3, posX: 2000, posY: 2000, startX: 0, startY: 0, endX: 900, endY: -600, strokeWidth: 9 }],
  ['ao', { type: 'arrow', zValue: 4, posX: 200, posY: 2600, startX: 0, startY: 0, endX: 1200, endY: 0, headStyle: 1, headPosition: 1 }],
  ['l', { type: 'line', zValue: 5, posX: 300, posY: 1500, startX: 0, startY: 0, endX: 1000, endY: 200 }],
  ['p', { type: 'freehand_pencil', zValue: 6, posX: 2500, posY: 500, points: [0, 0, 40, 30, 120, 60, 200, 200] }],
  ['m', { type: 'freehand_marker', zValue: 7, posX: 2500, posY: 1200, points: [0, 0, 600, 0], strokeColor: '#ffd60a' }],
  ['t', { type: 'text', zValue: 8, posX: 150, posY: 700, rectX: 0, rectY: 0, rectW: 1400, rectH: 200, text: 'Borrar el poste', fontSize: 90, fillMode: 3, fillColor: '#000000' }],
  ['n', { type: 'numbered_marker', zValue: 9, posX: 3500, posY: 2500, rectX: -60, rectY: -60, rectW: 120, rectH: 120, number: 1, fontSize: 60 }],
];

function annotate(doc: Y.Doc, n: number, shapes: [string, ShapeFields][] = NINE): void {
  for (const [id, fields] of shapes) addShape(doc, ID(n), id, fields, FRAME);
}

const mapOf = (doc: Y.Doc) => doc.getMap<unknown>(PHOTO_MARKUP_MAP);

/** Monta el editor de hoy con la página, como la página de la app (adentro de un `article` para la vista de impresión). */
function mountPage(doc = new Y.Doc(), blocks: PartialBlock[] | null = PAGE) {
  const editor = BlockNoteEditor.create(
    withCollaboration({ schema, collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } } }),
  ) as unknown as BlockNoteEditor;
  const article = document.createElement('article');
  article.className = 'page';
  article.dataset.pageId = 'p1';
  const title = document.createElement('textarea');
  title.className = 'page-title';
  title.value = 'Reporte';
  const host = document.createElement('div');
  host.className = 'editor-host';
  const container = document.createElement('div');
  container.className = 'bn-container editor';
  const mountPoint = document.createElement('div');
  container.append(mountPoint);
  host.append(container);
  article.append(title, host);
  document.body.append(article);
  editor.mount(mountPoint);
  if (blocks) editor.replaceBlocks(editor.document, blocks as never);
  const root = editor.domElement!;
  const overlay = attachMarkupOverlay(root, mapOf(doc));
  overlays.push(overlay);
  return { doc, editor, article, root, overlay };
}

/** Las fotos con dibujo: de qué archivo es cada `<svg>` y dónde está (foto-bloque, en línea o en una celda). */
function drawn(root: ParentNode): string[] {
  return [...root.querySelectorAll('svg.sd-markup')].map((svg) => {
    const host = svg.parentElement!;
    const where = host.classList.contains('sd-photo') ? (host.closest('td, th') ? 'celda' : 'en línea') : 'bloque';
    return `${where}:${svg.getAttribute('data-file-id')?.slice(-2)}`;
  });
}

const settle = () => new Promise((r) => setTimeout(r, 10));

describe('entrega 0: las versiones publicadas y el mapa', () => {
  /** La página con las tres fotos anotadas (y una forma de un tipo que nadie conoce, con un campo futuro). */
  async function annotatedPage(blocks: PartialBlock[] = PAGE): Promise<Y.Doc> {
    const doc = new Y.Doc();
    const E = mountEditor(doc, 'hoy');
    E.replaceBlocks(E.document, blocks as never);
    await tick(10);
    unmountAll();
    for (const n of [1, 2, 3]) annotate(doc, n);
    addShape(doc, ID(1), 'futura', { type: 'banner_v9', future: 'x' });
    updateShape(doc, ID(1), 'a', { futureField: 7 });
    return doc;
  }

  const versions = [
    ['la versión publicada (v0.107 a v0.111)', publishedSchema, PAGE],
    ['la versión publicada de v0.083 a v0.092', previousPublished, PAGE],
    // Las de antes de la foto en línea no abren una página con fotos en línea (unknownContent.ts): con solo la foto-bloque.
    ['una versión sin la foto en línea (v0.052 a v0.075)', previousSchema, [PAGE[0], { id: 'par', type: 'paragraph', content: 'texto' }]],
  ] as const;

  for (const [name, old, blocks] of versions) {
    it(`${name} abre la página, la edita, saca la foto anotada y vuelve sin perder una clave del mapa`, async () => {
      const shared = await annotatedPage(blocks as PartialBlock[]);
      const before = mapOf(shared).toJSON();
      expect(Object.keys(before).length).toBe(blocks === PAGE ? 3 * 10 + 1 : 10 + 1 + 20);
      const S = Y.encodeStateAsUpdate(shared);
      const copy = new Y.Doc();
      Y.applyUpdate(copy, S, 'remote');
      const written: Uint8Array[] = [];
      copy.on('update', (u: Uint8Array, origin: unknown) => origin !== 'remote' && written.push(u));
      const E = mountEditor(copy, 'vieja', old);
      await tick(20);
      // Escribe, agrega un bloque y saca la foto-bloque anotada (una versión vieja no poda nada).
      E.insertBlocks([{ type: 'paragraph', content: 'nota de la vieja' }] as never, 'par', 'after');
      E.removeBlocks(['blk']);
      await tick(20);
      unmountAll();
      expect(written.length).toBeGreaterThan(0);
      // Lo que sube la versión vieja, sobre lo que había: el mapa entero, igual.
      const server = new Y.Doc();
      Y.applyUpdate(server, S);
      for (const u of written) Y.applyUpdate(server, u);
      expect(mapOf(server).toJSON()).toEqual(before);
      expect(mediaIdsInDoc(server).has(ID(1))).toBe(false);
      // Y la de hoy la vuelve a abrir y la ve como estaba.
      expect(findUnknownContent(server)).toBeNull();
    });
  }

  it('el resguardo de las versiones viejas no mira el mapa: un mapa raro no frena la página', async () => {
    const doc = await annotatedPage();
    mapOf(doc).set('cualquier-cosa', { a: [1, 2, { b: 3 }] });
    expect(findUnknownContent(doc)).toBeNull();
  });

  it('Ctrl/⌘+Z de la página deshace el texto, nunca las anotaciones (ni las de otra foto)', async () => {
    const doc = new Y.Doc();
    const E = mountEditor(doc);
    E.replaceBlocks(E.document, PAGE as never);
    await tick(10);
    undoManager(E).clear();
    E.insertBlocks([{ type: 'paragraph', content: 'tipeado' }] as never, 'par', 'after');
    undoManager(E).stopCapturing();
    annotate(doc, 2, NINE.slice(0, 2));
    undoManager(E).undo();
    await tick(10);
    expect(JSON.stringify(E.document)).not.toContain('tipeado');
    expect(Object.keys(mapOf(doc).toJSON()).sort()).toEqual([ID(2), shapeKey(ID(2), 'r'), shapeKey(ID(2), 'e')].sort());
  });

  it('abrir la página con la app de hoy no escribe nada en el mapa (ni lo crea)', async () => {
    const doc = await annotatedPage();
    const writes: unknown[] = [];
    doc.on('update', (_u: Uint8Array, origin: unknown) => writes.push(origin));
    mountPage(doc, null);
    await settle();
    expect(writes).toEqual([]);
  });
});

describe('entrega 1: el dibujo encima de las fotos', () => {
  it('cada foto anotada tiene su dibujo (foto-bloque, en línea y en una celda); una sin anotar, ninguno', async () => {
    const { doc, root, overlay } = mountPage();
    overlay.flush();
    expect(drawn(root)).toEqual([]);
    for (const n of [1, 2, 3]) annotate(doc, n);
    await settle();
    expect(drawn(root)).toEqual(['bloque:01', 'en línea:02', 'celda:03']);
    // En la misma caja que la imagen, justo después de ella; el marco es el de la foto.
    for (const svg of root.querySelectorAll('svg.sd-markup')) {
      expect(svg.previousElementSibling?.matches('img.bn-visual-media')).toBe(true);
      expect(svg.getAttribute('viewBox')).toBe('0 0 4000 3000');
      expect(svg.hasAttribute('preserveAspectRatio')).toBe(false);
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    }
    // Las nueve formas, con lo suyo.
    const svg = root.querySelector('svg.sd-markup')!;
    expect([...svg.children].map((g) => g.getAttribute('data-shape'))).toEqual([
      'rectangle',
      'ellipse',
      'arrow',
      'arrow',
      'line',
      'freehand_pencil',
      'freehand_marker',
      'text',
      'numbered_marker',
    ]);
    expect(svg.querySelectorAll('polygon').length).toBe(1);
    expect(svg.querySelectorAll('polyline').length).toBe(1 + 2 + 1); // el lápiz, las dos V abiertas y el marcador
    expect(svg.querySelector('[data-shape="text"] tspan')!.textContent).toBe('Borrar el poste');
    expect(svg.querySelector('[data-shape="numbered_marker"] text')!.textContent).toBe('1');
  });

  it('se redibuja con cada cambio, también de otro dispositivo; sin anotaciones, el dibujo se va', async () => {
    const { doc, root } = mountPage();
    const other = new Y.Doc();
    connect(doc, other, 'sync');
    annotate(other, 2, NINE.slice(0, 1));
    await settle();
    expect(drawn(root)).toEqual(['en línea:02']);
    const rect = () => root.querySelector('svg.sd-markup rect')!;
    expect(rect().getAttribute('stroke')).toBe('#85DC53');
    updateShape(other, ID(2), 'r', { strokeColor: '#0a84ff' });
    await settle();
    expect(rect().getAttribute('stroke')).toBe('#0A84FF');
    deleteShape(other, ID(2), 'r');
    await settle();
    expect(drawn(root)).toEqual([]);
    annotate(other, 3, NINE.slice(2, 3));
    removePhotoMarkup(other, ID(3));
    await settle();
    expect(drawn(root)).toEqual([]);
  });

  it('una foto agregada o vuelta a dibujar por el editor recibe su dibujo; la misma foto dos veces comparte el dibujo', async () => {
    const { doc, editor, root } = mountPage();
    annotate(doc, 1, NINE.slice(0, 2));
    await settle();
    expect(drawn(root)).toEqual(['bloque:01']);
    // Cambiar el ancho de la foto-bloque la vuelve a dibujar (BlockNote arma otra caja).
    editor.updateBlock('blk', { props: { previewWidth: 300 } } as never);
    await settle();
    expect(drawn(root)).toEqual(['bloque:01']);
    // La misma foto, otra vez, en línea en otro párrafo.
    editor.insertBlocks([{ type: 'paragraph', content: [inline(1)] }] as never, 'otra', 'after');
    await settle();
    expect(drawn(root)).toEqual(['bloque:01', 'en línea:01']);
  });

  it('montado siempre: la vista de impresión (una copia del editor) sale con el dibujo de cada foto anotada', async () => {
    const { doc, article } = mountPage();
    for (const n of [1, 2, 3]) annotate(doc, n);
    await settle();
    const print = buildPrintView(article, { size: 'A4', landscape: false }, 'output');
    try {
      expect(drawn(print.root)).toEqual(['bloque:01', 'en línea:02', 'celda:03']);
      // La copia se lleva el dibujo entero (las formas), no un `<svg>` vacío.
      for (const svg of print.root.querySelectorAll('svg.sd-markup')) expect(svg.children.length).toBe(9);
    } finally {
      print.root.remove();
    }
  });

  it('un mapa malicioso se dibuja acotado, sin HTML, sin href ni style, con colores #RRGGBB', async () => {
    const { doc, root } = mountPage();
    const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>';
    annotate(doc, 2, [
      ['x1', { type: 'text', posX: 10, posY: 10, rectX: 0, rectY: 0, rectW: 500, rectH: 100, text: evil, strokeColor: 'url(javascript:alert(1))', href: 'javascript:alert(1)', style: 'fill:red' }],
      ['x2', { type: 'arrow', posX: 1e300, posY: -1e300, startX: 0, startY: 0, endX: Number.MAX_VALUE, endY: 1, strokeWidth: 1e308, strokeColor: '#fff;x' }],
      ['x3', { type: 'freehand_pencil', posX: 0, posY: 0, points: Array.from({ length: 30_000 }, (_, i) => i) }],
      ['x4', { type: 'foreignObject', html: evil }],
    ]);
    await settle();
    const svg = root.querySelector('svg.sd-markup')!;
    expect(svg).not.toBeNull();
    expect(svg.querySelectorAll('script, img, foreignObject, a, image, use, style').length).toBe(0);
    expect(svg.querySelector('tspan')!.textContent).toBe(evil);
    expect(svg.innerHTML).toContain('&lt;script&gt;');
    expect((window as { __pwned?: number }).__pwned).toBeUndefined();
    for (const node of svg.querySelectorAll('*')) {
      expect(node.hasAttribute('href') || node.hasAttribute('style') || node.hasAttribute('onerror')).toBe(false);
      for (const attr of ['fill', 'stroke']) {
        const v = node.getAttribute(attr);
        if (v !== null) expect(v).toMatch(/^(none|#[0-9A-F]{6})$/);
      }
      for (const attr of node.getAttributeNames()) {
        expect(node.getAttribute(attr)).not.toMatch(/Infinity|NaN|e\+/);
      }
    }
    // El trazo de 15.000 puntos se dibuja con 5000.
    expect(svg.querySelector('[data-shape="freehand_pencil"] polyline')!.getAttribute('points')!.split(' ').length).toBe(5000);
  });

  it('el grosor mínimo: en una foto chica un trazo fino se dibuja a 1 px de pantalla', () => {
    // Una foto de 4000 px en una celda de 128 px de ancho: 1 px de pantalla son 31,25 px de la foto.
    expect(minStrokeFor(FRAME, { width: 128, height: 96 })).toBeCloseTo(31.25);
    // `meet`: manda el lado que más se achica.
    expect(minStrokeFor(FRAME, { width: 400, height: 100 })).toBeCloseTo(30);
    expect(minStrokeFor(FRAME, { width: 0, height: 0 })).toBe(0);
  });

  it('el editor de solo lectura (Ver, Comentar, una versión del historial) también dibuja', async () => {
    const { doc, editor, root } = mountPage();
    annotate(doc, 3, NINE.slice(0, 1));
    editor.isEditable = false;
    await settle();
    expect(view(editor).editable).toBe(false);
    expect(drawn(root)).toEqual(['celda:03']);
  });
});
