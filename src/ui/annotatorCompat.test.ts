// @vitest-environment jsdom
// Lo que escribe el anotador (P.20, entrega 2) contra las versiones de la app que siguen abiertas en algún lado: la
// publicada (v0.117: el esquema del editor de hoy, que esta entrega no toca), las de las fixtures y una sin la foto en
// línea. Abren una página anotada CON EL ANOTADOR (las nueve herramientas, movida, restilada y con un texto editado),
// la editan, sacan una foto anotada, y el mapa vuelve intacto. Y una versión vieja que escribe a la vez que alguien
// anota: las dos cosas quedan.
import { type PartialBlock } from '@blocknote/core';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addShape, PHOTO_MARKUP_MAP, readShape, updateShape, type MarkupFrame } from '../media/markup';
import {
  boxShape,
  DEFAULT_STYLES,
  lineShape,
  moveFields,
  numberShape,
  restyleFields,
  roughMeasure,
  strokeShape,
  textEdit,
  textShape,
} from '../media/markupEdit';
import { mediaIdsInDoc } from '../media/usage';
import { connect, mountEditor, tick, unmountAll, yText } from './collabHarness';
import { schema } from './editorSchema';
import { schema as previousPublished } from './fixtures/editorSchemaAnterior';
import { schema as publishedSchema } from './fixtures/editorSchemaMain';
import { previousSchema } from './photoHarness';
import { findUnknownContent } from './unknownContent';

afterEach(() => unmountAll());

const ID = (n: number) => `0f8fad5b-d9cb-469f-a165-7086772895${String(n).padStart(2, '0')}`;
const URL_OF = (n: number) => `sdmedia://${ID(n)}`;
const text = (t: string) => ({ type: 'text', text: t, styles: {} });
const FRAME: MarkupFrame = { v: 1, w: 6000, h: 4000 };
const PAGE: PartialBlock[] = [
  { id: 'blk', type: 'image', props: { url: URL_OF(1), name: 'F1.jpg' } },
  { id: 'par', type: 'paragraph', content: [text('Plano 12 '), { type: 'photo', props: { url: URL_OF(2), name: 'F2.jpg', w: 0.5 } }] },
] as never;
const mapOf = (doc: Y.Doc) => doc.getMap<unknown>(PHOTO_MARKUP_MAP);

/** Anota la foto `n` como lo hace el anotador: las nueve herramientas y después mover, restilar y editar el texto. */
function annotate(doc: Y.Doc, n: number) {
  const id = ID(n);
  const red = { ...DEFAULT_STYLES.arrow, color: '#FF3B30' };
  const all = [
    boxShape('rectangle', { x: 100, y: 100, w: 800, h: 500 }, DEFAULT_STYLES.rectangle, FRAME, 1),
    boxShape('ellipse', { x: 1200, y: 300, w: 600, h: 600 }, { ...DEFAULT_STYLES.ellipse, fill: true }, FRAME, 2),
    lineShape('arrow', { x: 2000, y: 2000 }, { x: 2900, y: 1400 }, red, FRAME, 3),
    lineShape('arrow', { x: 200, y: 2600 }, { x: 1400, y: 2600 }, { ...red, headStyle: 1, headPosition: 1 }, FRAME, 4),
    lineShape('line', { x: 300, y: 1500 }, { x: 1300, y: 1700 }, DEFAULT_STYLES.line, FRAME, 5),
    strokeShape('pencil', [2500, 500, 2540, 530, 2620, 560, 2700, 700], DEFAULT_STYLES.pencil, FRAME, 6),
    strokeShape('marker', [2500, 1200, 3100, 1200], DEFAULT_STYLES.marker, FRAME, 7),
    textShape({ x: 150, y: 700 }, 'Borrar el poste', { ...DEFAULT_STYLES.text, fill: true }, FRAME, 8, roughMeasure, '75px x'),
    numberShape({ x: 3500, y: 2500 }, 1, DEFAULT_STYLES.number, FRAME, 9),
  ];
  all.forEach((fields, i) => addShape(doc, id, `s${i}`, fields, FRAME));
  const read = (k: string) => readShape(k, mapOf(doc).get(`${id}/${k}`), FRAME)!;
  updateShape(doc, id, 's0', moveFields(read('s0'), 40, -20));
  updateShape(doc, id, 's1', restyleFields(read('s1'), { color: '#0A84FF', width: 6 }, FRAME));
  updateShape(doc, id, 's7', textEdit('Borrar el poste y el cable', 75, roughMeasure, '75px x'));
}

async function annotatedPage(blocks: PartialBlock[]): Promise<Y.Doc> {
  const doc = new Y.Doc();
  const E = mountEditor(doc, 'hoy');
  E.replaceBlocks(E.document, blocks as never);
  await tick(10);
  unmountAll();
  annotate(doc, 1);
  annotate(doc, 2);
  return doc;
}

const versions = [
  ['la versión publicada (v0.117, el editor de hoy)', schema, PAGE],
  ['la de las fixtures (v0.107 a v0.111)', publishedSchema, PAGE],
  ['la de v0.083 a v0.092', previousPublished, PAGE],
  ['una sin la foto en línea (v0.052 a v0.075)', previousSchema, [PAGE[0], { id: 'par', type: 'paragraph', content: 'texto' }]],
] as const;

describe('lo que escribe el anotador, con las versiones que siguen abiertas', () => {
  for (const [name, old, blocks] of versions) {
    it(`${name}: abre la página anotada, la edita y saca una foto anotada; el mapa vuelve intacto`, async () => {
      const shared = await annotatedPage(blocks as PartialBlock[]);
      const before = mapOf(shared).toJSON();
      expect(Object.keys(before).length).toBe(2 * 10);
      const S = Y.encodeStateAsUpdate(shared);
      const copy = new Y.Doc();
      Y.applyUpdate(copy, S, 'remote');
      const written: Uint8Array[] = [];
      copy.on('update', (u: Uint8Array, origin: unknown) => origin !== 'remote' && written.push(u));
      const E = mountEditor(copy, 'vieja', old);
      await tick(20);
      E.insertBlocks([{ type: 'paragraph', content: 'nota de la vieja' }] as never, 'par', 'after');
      E.removeBlocks(['blk']);
      await tick(20);
      unmountAll();
      const server = new Y.Doc();
      Y.applyUpdate(server, S);
      for (const u of written) Y.applyUpdate(server, u);
      expect(mapOf(server).toJSON()).toEqual(before);
      expect(mediaIdsInDoc(server).has(ID(1))).toBe(false);
      expect(yText(server)).toContain('nota de la vieja');
      expect(findUnknownContent(server)).toBeNull();
    });
  }

  it('una versión vieja escribe mientras alguien anota (sin red los dos): al juntarse, quedan el texto y todas las formas', async () => {
    const a = await annotatedPage(PAGE);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a), 'remote');
    const link = connect(a, b, 'async');
    link.offline();
    const E = mountEditor(b, 'vieja', publishedSchema);
    await tick(10);
    E.insertBlocks([{ type: 'paragraph', content: 'escrito en la vieja' }] as never, 'par', 'after');
    await tick(10);
    // Mientras tanto, en la de hoy, el anotador agrega y mueve.
    addShape(a, ID(1), 'nueva', lineShape('arrow', { x: 10, y: 10 }, { x: 500, y: 500 }, DEFAULT_STYLES.arrow, FRAME, 20), FRAME);
    updateShape(a, ID(2), 's2', { posX: 1234, posY: 567 });
    link.online();
    await tick(20);
    unmountAll();
    for (const doc of [a, b]) {
      expect(yText(doc)).toContain('escrito en la vieja');
      expect(mapOf(doc).has(`${ID(1)}/nueva`)).toBe(true);
      expect((mapOf(doc).get(`${ID(2)}/s2`) as Y.Map<unknown>).get('posX')).toBe(1234);
      expect(Object.keys(mapOf(doc).toJSON()).length).toBe(21);
    }
  });
});
