// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { buildCleanBase } from '../sync/clean';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { connect, mountEditor, tick, unmountAll } from '../ui/collabHarness';
import { addShape, markupOrigin, PHOTO_MARKUP_MAP } from './markup';
import { createMarkupPruner, PRUNE_AFTER_MS, startMarkupPrune } from './markupPrune';
import { mediaIdsInDoc } from './usage';

// La poda de las anotaciones de una foto sacada (AN11; Docs/Doc_Anotar_Fotos.md, sección 3): a los 10 minutos medidos
// por el dispositivo con la página abierta, como una edición normal, sin perder lo que otro anotó sin red.

afterEach(() => {
  unmountAll();
  vi.useRealTimers();
});

const ID = (n: number) => `0f8fad5b-d9cb-469f-a165-7086772895${String(n).padStart(2, '0')}`;
const FRAME = { w: 4000, h: 3000 };
const map = (doc: Y.Doc) => doc.getMap<unknown>(PHOTO_MARKUP_MAP);

/** Una página con dos fotos-bloque (1 y 2), las dos anotadas. */
async function page(): Promise<Y.Doc> {
  const doc = new Y.Doc();
  const E = mountEditor(doc);
  E.replaceBlocks(E.document, [
    { id: 'f1', type: 'image', props: { url: `sdmedia://${ID(1)}`, name: 'F1.jpg' } },
    { id: 'f2', type: 'image', props: { url: `sdmedia://${ID(2)}`, name: 'F2.jpg' } },
  ] as never);
  await tick(10);
  unmountAll();
  addShape(doc, ID(1), 'a', { type: 'text', zValue: 1, posX: 1, posY: 1, text: 'este plano no se cobra' }, FRAME);
  addShape(doc, ID(2), 'b', { type: 'line', zValue: 1, posX: 1, posY: 1, startX: 0, startY: 0, endX: 9, endY: 9 }, FRAME);
  return doc;
}

/** Saca la foto-bloque `id` del contenido (como borrarla en el editor). */
async function removeBlock(doc: Y.Doc, id: string) {
  const E = mountEditor(doc);
  await tick(5);
  E.removeBlocks([id]);
  await tick(5);
  unmountAll();
}

describe('la poda (AN11)', () => {
  it('nada antes de 10 minutos; a los 10, se van el marco y las formas de la foto sacada, y solo de esa', async () => {
    const doc = await page();
    let now = 1_000_000;
    const pruner = createMarkupPruner(doc, () => now);
    expect(pruner.check()).toEqual([]);
    expect(pruner.missing().size).toBe(0);
    await removeBlock(doc, 'f1');
    expect(pruner.check()).toEqual([]);
    expect([...pruner.missing().keys()]).toEqual([ID(1)]);
    now += PRUNE_AFTER_MS - 1;
    expect(pruner.check()).toEqual([]);
    now += 1;
    expect(pruner.check()).toEqual([ID(1)]);
    expect([...map(doc).keys()].sort()).toEqual([ID(2), `${ID(2)}/b`]);
    // Y quien solo ve (la base limpia) ya no recibe el texto.
    const built = buildCleanBase([Y.encodeStateAsUpdate(doc)]);
    expect(new TextDecoder().decode(built.base)).not.toContain('no se cobra');
    built.doc.destroy();
  });

  it('un cortar y pegar (la foto vuelve antes de 10 minutos) no la poda, y empieza a contar de nuevo si se va otra vez', async () => {
    const doc = await page();
    let now = 0;
    const pruner = createMarkupPruner(doc, () => now);
    const update = Y.encodeStateAsUpdate(doc);
    await removeBlock(doc, 'f1');
    pruner.check();
    now += 5 * 60_000;
    // Vuelve (pegar): la misma dirección en el contenido.
    const E = mountEditor(doc);
    await tick(5);
    E.insertBlocks([{ type: 'image', props: { url: `sdmedia://${ID(1)}`, name: 'F1.jpg' } }] as never, E.document[0], 'before');
    await tick(5);
    unmountAll();
    expect(pruner.check()).toEqual([]);
    expect(pruner.missing().size).toBe(0);
    now += 20 * 60_000;
    expect(pruner.check()).toEqual([]);
    expect(map(doc).has(`${ID(1)}/a`)).toBe(true);
    void update;
  });

  it('lo que otro anotó sin red sobre la foto podada no se pierde: llega como clave nueva y lo saca la vuelta siguiente', async () => {
    const doc = await page();
    const offline = new Y.Doc();
    Y.applyUpdate(offline, Y.encodeStateAsUpdate(doc));
    let now = 0;
    const pruner = createMarkupPruner(doc, () => now);
    await removeBlock(doc, 'f1');
    pruner.check();
    now += PRUNE_AFTER_MS;
    expect(pruner.check()).toEqual([ID(1)]);
    // El otro dispositivo, sin red, anotó la misma foto.
    addShape(offline, ID(1), 'sin-red', { type: 'ellipse', zValue: 2, posX: 5, posY: 5, rectX: 0, rectY: 0, rectW: 50, rectH: 50 }, FRAME);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(offline));
    expect(map(doc).has(`${ID(1)}/sin-red`)).toBe(true);
    // Sigue en las filas (lo que subió ese dispositivo) aunque se pode: la próxima vuelta lo saca de la página.
    pruner.check();
    now += PRUNE_AFTER_MS;
    expect(pruner.check()).toEqual([ID(1)]);
    expect([...map(doc).keys()].filter((k) => k.startsWith(ID(1)))).toEqual([]);
  });

  it('la poda tiene su propio origen: el deshacer de un anotador de esa foto no la sigue', async () => {
    const doc = await page();
    const um = new Y.UndoManager(map(doc), { trackedOrigins: new Set([markupOrigin(ID(1))]), captureTimeout: 0 });
    let now = 0;
    const pruner = createMarkupPruner(doc, () => now);
    await removeBlock(doc, 'f1');
    pruner.check();
    now += PRUNE_AFTER_MS;
    pruner.check();
    expect(um.undoStack.length).toBe(0);
    um.destroy();
  });

  it('una página a medio bajar vería todas las fotos como sacadas: por eso la poda solo corre con la página entera', () => {
    // El documento recibió las anotaciones pero todavía no el contenido (filas por llegar). Si alguien corriera la poda
    // ahí, las podaría a los 10 minutos: PageEditor.tsx solo la arranca con el editor editable, que exige la página
    // completa (`opening.complete`). Esta prueba deja escrito por qué.
    const doc = new Y.Doc();
    addShape(doc, ID(1), 'a', { type: 'line', zValue: 1, posX: 1, posY: 1, startX: 0, startY: 0, endX: 9, endY: 9 }, FRAME);
    expect(doc.getXmlFragment(CONTENT_FRAGMENT).length).toBe(0);
    let now = 0;
    const pruner = createMarkupPruner(doc, () => now);
    pruner.check();
    expect([...pruner.missing().keys()]).toEqual([ID(1)]);
  });

  it('sin anotaciones no hace nada (ni recorre el contenido)', () => {
    const doc = new Y.Doc();
    const writes: unknown[] = [];
    doc.on('update', () => writes.push(1));
    const pruner = createMarkupPruner(doc, () => 0);
    expect(pruner.check()).toEqual([]);
    expect(writes).toEqual([]);
  });
});

describe('la poda solo con la página sincronizada (auditoría B2)', () => {
  const MIN = 60_000;

  /** La foto anotada en A y B conectados; con el reloj de los intervalos falso (el editor sigue con el de verdad). */
  async function twoDevices() {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const link = connect(a, b, 'sync');
    const EA = mountEditor(a, 'a');
    EA.replaceBlocks(EA.document, [
      { id: 'p1', type: 'paragraph', content: 'Plano 12' },
      { id: 'f1', type: 'image', props: { url: `sdmedia://${ID(1)}`, name: 'F1.jpg' } },
      { id: 'p2', type: 'paragraph', content: 'Plano 13' },
    ] as never);
    await tick(10);
    addShape(a, ID(1), 's1', { type: 'text', zValue: 1, posX: 10, posY: 10, text: 'Borrar cable' }, FRAME);
    addShape(a, ID(1), 's2', { type: 'line', zValue: 2, posX: 1, posY: 1, startX: 0, startY: 0, endX: 9, endY: 9 }, FRAME);
    await tick(10);
    return { a, b, link, EA };
  }

  /** Pasan `minutes` minutos con la página abierta (la poda mira cada minuto). */
  async function pass(clock: { now: number }, minutes: number) {
    for (let i = 0; i < minutes; i++) {
      clock.now += MIN;
      await vi.advanceTimersByTimeAsync(MIN);
    }
  }

  it('A sin red saca la foto y B (con red) la vuelve a poner: A no poda nada, y al volver la red están la foto y sus anotaciones', async () => {
    const { a, b, link, EA } = await twoDevices();
    link.offline();
    EA.removeBlocks(['f1']);
    await tick(10);
    // B mueve la foto (en BlockNote, sacar y volver a poner el mismo archivo).
    const EB = mountEditor(b, 'b');
    await tick(10);
    EB.removeBlocks(['f1']);
    EB.insertBlocks([{ type: 'image', props: { url: `sdmedia://${ID(1)}`, name: 'F1.jpg' } }] as never, 'p2', 'after');
    await tick(10);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const clock = { now: 0 };
    let online = false;
    const stop = startMarkupPrune({ doc: a, editable: true, permsKnown: true, preview: false, synced: async () => online, now: () => clock.now });
    await pass(clock, 11);
    expect(map(a).size).toBe(3);
    link.online();
    online = true;
    await tick(20);
    await pass(clock, 12);
    stop();
    unmountAll();
    for (const doc of [a, b]) {
      expect(mediaIdsInDoc(doc).has(ID(1))).toBe(true);
      expect(map(doc).size).toBe(3);
    }
  });

  it('con red poda a los 10 minutos; si la red se corta en el medio, los 10 minutos vuelven a contar desde que vuelve', async () => {
    const { a, EA } = await twoDevices();
    EA.removeBlocks(['f1']);
    await tick(10);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const clock = { now: 0 };
    let online = true;
    const stop = startMarkupPrune({ doc: a, editable: true, permsKnown: true, preview: false, synced: async () => online, now: () => clock.now });
    await vi.advanceTimersByTimeAsync(0);
    await pass(clock, 5);
    online = false;
    await pass(clock, 1);
    online = true;
    await pass(clock, 9);
    expect(map(a).size).toBe(3);
    await pass(clock, 2);
    expect(map(a).size).toBe(0);
    stop();
  });

  it('nunca sin permiso de editar, sin los permisos conocidos ni en la vista de una versión', async () => {
    for (const gate of [{ editable: false }, { permsKnown: false }, { preview: true }]) {
      const { a, EA } = await twoDevices();
      EA.removeBlocks(['f1']);
      await tick(10);
      unmountAll();
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const clock = { now: 0 };
      let asked = 0;
      const stop = startMarkupPrune({
        doc: a,
        editable: true,
        permsKnown: true,
        preview: false,
        ...gate,
        synced: async () => {
          asked++;
          return true;
        },
        now: () => clock.now,
      });
      await pass(clock, 25);
      stop();
      vi.useRealTimers();
      expect(map(a).size, JSON.stringify(gate)).toBe(3);
      expect(asked).toBe(0);
    }
  });
});
