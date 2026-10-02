// @vitest-environment jsdom
// Anotar sobre las fotos, entrega 0 (Docs/Doc_Anotar_Fotos.md, sección 3): con la librería de VERDAD de las versiones
// publicadas de la v0.052 a la v0.075 (y-prosemirror antes de los huecos estables; la pone el alias del proyecto
// `published`, también adentro de BlockNote), el editor de entonces abre una página con el mapa `photoMarkup`, la
// edita (también saca la foto anotada) y lo que sube deja el mapa entero.
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addShape, PHOTO_MARKUP_MAP } from '../media/markup';
import { mountEditor, tick, unmountAll } from './collabHarness';
import { previousSchema } from './photoHarness';

afterEach(unmountAll);

const F1 = '0f8fad5b-d9cb-469f-a165-708677289501';

describe('la librería publicada y el mapa de anotaciones', () => {
  it('abre, edita y saca la foto anotada: el mapa vuelve sin perder una clave', async () => {
    const doc = new Y.Doc();
    const E = mountEditor(doc, 'm', previousSchema);
    E.replaceBlocks(E.document, [
      { id: 'blk', type: 'image', props: { url: `sdmedia://${F1}`, name: 'F1.jpg' } },
      { id: 'p1', type: 'paragraph', content: 'Plano 12' },
    ] as never);
    await tick(10);
    unmountAll();
    addShape(doc, F1, 'a', { type: 'arrow', posX: 1, posY: 2, startX: 0, startY: 0, endX: 10, endY: 10 }, { w: 4000, h: 3000 });
    addShape(doc, F1, 't', { type: 'text', text: '<t1>', futureField: [1, 2] });
    addShape(doc, F1, 'x', { type: 'unknown_v9' });
    const before = doc.getMap(PHOTO_MARKUP_MAP).toJSON();
    const S = Y.encodeStateAsUpdate(doc);

    const copy = new Y.Doc();
    Y.applyUpdate(copy, S, 'remote');
    const written: Uint8Array[] = [];
    copy.on('update', (u: Uint8Array, origin: unknown) => origin !== 'remote' && written.push(u));
    const old = mountEditor(copy, 'vieja', previousSchema);
    await tick(20);
    old.insertBlocks([{ type: 'paragraph', content: 'nota' }] as never, 'p1', 'after');
    old.removeBlocks(['blk']);
    await tick(20);
    unmountAll();
    expect(written.length).toBeGreaterThan(0);

    const server = new Y.Doc();
    Y.applyUpdate(server, S);
    for (const u of written) Y.applyUpdate(server, u);
    expect(server.getMap(PHOTO_MARKUP_MAP).toJSON()).toEqual(before);
    expect(Object.keys(before).length).toBe(4);
  });
});
