// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { addShape, PHOTO_MARKUP_MAP, readPhotoMarkup, writeFrame } from '../media/markup';
import { PHOTO_MARKUP_CAP } from '../media/markupLimits';
import { Annotator } from './Annotator';
import { connect } from './collabHarness';
import { markupManager, popMarkupStep } from './undoTimeline';
import type { CarreteItem } from './carreteModel';

// El anotador en jsdom (P.20, entrega 2): se escribe AL SOLTAR (nada durante el arrastre), el deshacer es de esta foto,
// lo de otro llega en vivo, dos anotando a la vez no pierden nada, una versión más nueva del formato lo deja en solo
// lectura, al tope de bytes las herramientas de crear se apagan, y un mapa malicioso no hace escribir más que lo que
// cambia.

const ID = '0f8fad5b-d9cb-469f-a165-708677289501';
const FRAME = { w: 4000, h: 3000 };
const ITEM: CarreteItem = { key: '', blockId: '', at: null, url: `sdmedia://${ID}`, source: 'media', mediaId: ID, name: 'IMG_0423.jpg', caption: '' };
const loader = {
  preview: async () => ({ kind: 'image' as const, name: 'IMG_0423.jpg', preview: 'blob:thumb' }),
  full: async () => ({ url: 'blob:full', local: true }),
};

/** La caja de la foto mide 1000 × 750 en pantalla: cada píxel de pantalla son 4 del marco. */
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const host = this.closest('[data-test-left]') as HTMLElement | null;
    const left = host ? Number(host.dataset.testLeft) : 0;
    if (this.classList.contains('annotator-box')) return { x: left, y: 0, left, top: 0, width: 1000, height: 750, right: left + 1000, bottom: 750, toJSON: () => ({}) } as DOMRect;
    return { x: 0, y: 0, left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, toJSON: () => ({}) } as DOMRect;
  });
});

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // Sin almacenamiento.
  }
});

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});

const map = (doc: Y.Doc) => doc.getMap<unknown>(PHOTO_MARKUP_MAP);
const shapes = (doc: Y.Doc) => readPhotoMarkup(map(doc), ID)?.shapes ?? [];

type Loader = { preview: () => Promise<{ kind: 'image'; name: string; preview: string | null }>; full: () => Promise<{ url: string; local: boolean }> };

type Steps = NonNullable<Parameters<typeof Annotator>[0]['onUndoSteps']>;

async function open(doc: Y.Doc, left = 0, extra: { loader?: Loader; size?: () => Promise<{ width: number; height: number } | null>; onUndoSteps?: Steps } = {}) {
  const onClose = vi.fn();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(<Annotator doc={doc} fileId={ID} name="IMG_0423.jpg" item={ITEM} loader={extra.loader ?? loader} size={extra.size} onClose={onClose} onUndoSteps={extra.onUndoSteps} />);
  });
  await act(async () => new Promise((r) => setTimeout(r, 10)));
  // El anotador va al `body` (como el carrete): el último es el que se acaba de abrir.
  const all = document.querySelectorAll<HTMLElement>('.annotator');
  const el = all[all.length - 1];
  el.dataset.testLeft = String(left);
  const stage = el.querySelector<HTMLElement>('.annotator-stage')!;
  return { el, stage, onClose };
}

/** Un evento de puntero (jsdom no tiene `PointerEvent`): `x`, `y` en píxeles de pantalla. */
function pointer(target: Element, type: string, x: number, y: number, opts: { id?: number; shift?: boolean; button?: number } = {}) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: opts.button ?? 0, shiftKey: !!opts.shift });
  Object.defineProperty(e, 'pointerId', { value: opts.id ?? 1 });
  Object.defineProperty(e, 'pointerType', { value: 'mouse' });
  act(() => {
    target.dispatchEvent(e);
  });
}

function drag(stage: Element, from: [number, number], to: [number, number], opts: { id?: number; shift?: boolean } = {}, during?: () => void) {
  pointer(stage, 'pointerdown', ...from, opts);
  for (let i = 1; i <= 5; i++) pointer(stage, 'pointermove', from[0] + ((to[0] - from[0]) * i) / 5, from[1] + ((to[1] - from[1]) * i) / 5, opts);
  during?.();
  pointer(stage, 'pointerup', ...to, opts);
}

function key(k: string, extra: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));
  });
}

describe('el anotador', () => {
  it('una flecha se escribe al soltar, en píxeles del marco, y nada durante el arrastre', async () => {
    const doc = new Y.Doc();
    writeFrame(doc, ID, FRAME.w, FRAME.h);
    const { stage } = await open(doc);
    key('a');
    let during = -1;
    const updates: unknown[] = [];
    doc.on('update', (_u: Uint8Array, origin: unknown) => updates.push(origin));
    drag(stage, [100, 600], [700, 200], {}, () => (during = updates.length));
    expect(during).toBe(0);
    expect(updates).toEqual([`sd-markup:${ID}`]);
    const [arrow] = shapes(doc);
    expect(arrow).toMatchObject({ type: 'arrow', posX: 400, posY: 2400, strokeColor: '#85DC53' });
    if (arrow.type !== 'arrow') return;
    expect(arrow.end).toEqual([2400, -1600]);
    // AN7: 3 a la referencia de 1920 en una foto de 4000 de lado largo.
    expect(arrow.strokeWidth).toBeCloseTo(3 * (4000 / 1920), 1);
  });

  it('la primera forma de una foto escribe el marco con ella; un clic sin arrastrar no crea nada', async () => {
    const doc = new Y.Doc();
    // Sin marco guardado: el anotador espera la medida de la foto. Se le da el marco como lo haría la imagen.
    writeFrame(doc, ID, 1600, 1000);
    const { stage } = await open(doc);
    key('r');
    pointer(stage, 'pointerdown', 300, 300);
    pointer(stage, 'pointerup', 300, 300);
    expect(shapes(doc)).toEqual([]);
    drag(stage, [100, 100], [300, 200], { shift: true });
    const [rect] = shapes(doc);
    expect(rect.type).toBe('rectangle');
    if (rect.type === 'rectangle') expect(rect.rect.w).toBe(rect.rect.h);
  });

  it('deshacer y rehacer son de esta foto: lo de otro (y lo de otra foto) no se deshace', async () => {
    const doc = new Y.Doc();
    writeFrame(doc, ID, FRAME.w, FRAME.h);
    const { el, stage } = await open(doc);
    key('e');
    drag(stage, [100, 100], [200, 200]);
    // Otro editor agrega una forma a la misma foto (llega por la red), y alguien anota otra foto.
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    addShape(remote, ID, 'de-otro', { type: 'line', zValue: 9, posX: 1, posY: 1, startX: 0, startY: 0, endX: 50, endY: 50 });
    act(() => Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(doc)), 'remote'));
    const other = '0f8fad5b-d9cb-469f-a165-708677289502';
    act(() => addShape(doc, other, 'x', { type: 'line', zValue: 1, posX: 1, posY: 1, startX: 0, startY: 0, endX: 50, endY: 50 }, FRAME));
    expect(shapes(doc).length).toBe(2);
    key('z', { ctrlKey: true });
    expect(shapes(doc).map((s) => s.id)).toEqual(['de-otro']);
    expect(map(doc).has(`${other}/x`)).toBe(true);
    key('y', { ctrlKey: true });
    expect(shapes(doc).length).toBe(2);
    // El botón de deshacer, también.
    const undo = el.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')!;
    expect(undo.disabled).toBe(false);
    act(() => undo.click());
    expect(shapes(doc).map((s) => s.id)).toEqual(['de-otro']);
  });

  it('lo que dibuja otro aparece en vivo en el anotador abierto', async () => {
    const doc = new Y.Doc();
    writeFrame(doc, ID, FRAME.w, FRAME.h);
    const { el } = await open(doc);
    const svg = el.querySelector('svg.annotator-shapes')!;
    expect(svg.children.length).toBe(0);
    act(() => addShape(doc, ID, 'remota', { type: 'ellipse', zValue: 1, posX: 10, posY: 10, rectX: 0, rectY: 0, rectW: 100, rectH: 100 }));
    expect(svg.querySelectorAll('[data-shape="ellipse"]').length).toBe(1);
  });

  it('dos anotando a la vez la misma foto, con trazos que se cruzan en el tiempo: no se pierde nada', async () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const link = connect(docA, docB, 'sync');
    writeFrame(docA, ID, FRAME.w, FRAME.h);
    const a = await open(docA, 0);
    const b = await open(docB, 2000);
    act(() => a.el.querySelector<HTMLButtonElement>('[data-tool="pencil"]')!.click());
    act(() => b.el.querySelector<HTMLButtonElement>('[data-tool="arrow"]')!.click());
    for (let round = 0; round < 3; round++) {
      pointer(a.stage, 'pointerdown', 100, 100 + round * 100, { id: 1 });
      pointer(b.stage, 'pointerdown', 2100, 100 + round * 100, { id: 2 });
      for (let i = 1; i <= 6; i++) {
        pointer(a.stage, 'pointermove', 100 + i * 50, 100 + round * 100 + (i % 2) * 20, { id: 1 });
        pointer(b.stage, 'pointermove', 2100 + i * 50, 100 + round * 100, { id: 2 });
      }
      pointer(b.stage, 'pointerup', 2400, 100 + round * 100, { id: 2 });
      pointer(a.stage, 'pointerup', 400, 100 + round * 100, { id: 1 });
    }
    expect(shapes(docA).length).toBe(6);
    expect(shapes(docB).map((s) => s.id)).toEqual(shapes(docA).map((s) => s.id));
    // Sin red, los dos siguen dibujando; al volver, se juntan.
    link.offline();
    drag(a.stage, [100, 500], [300, 600], { id: 1 });
    drag(b.stage, [2100, 500], [2300, 600], { id: 2 });
    expect(shapes(docA).length).toBe(7);
    link.online();
    expect(shapes(docA).length).toBe(8);
    expect(shapes(docB).length).toBe(8);
    // Deshacer en B saca su última flecha, nunca un trazo de A.
    act(() => b.el.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')!.click());
    expect(shapes(docA).filter((s) => s.type === 'freehand_pencil').length).toBe(4);
    expect(shapes(docA).filter((s) => s.type === 'arrow').length).toBe(3);
  });

  it('Esc deja de elegir; sin nada elegido, cierra. Borrar saca lo elegido', async () => {
    const doc = new Y.Doc();
    writeFrame(doc, ID, FRAME.w, FRAME.h);
    addShape(doc, ID, 'r', { type: 'rectangle', zValue: 1, posX: 400, posY: 400, rectX: 0, rectY: 0, rectW: 800, rectH: 400, fillMode: 2, fillOpacity: 50 });
    const { stage, onClose } = await open(doc);
    key('v');
    pointer(stage, 'pointerdown', 200, 150);
    pointer(stage, 'pointerup', 200, 150);
    key('Escape');
    expect(onClose).not.toHaveBeenCalled();
    pointer(stage, 'pointerdown', 200, 150);
    pointer(stage, 'pointerup', 200, 150);
    key('Delete');
    expect(shapes(doc)).toEqual([]);
    key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('el texto: clic, escribir, Esc; el número: cada clic el siguiente', async () => {
    const doc = new Y.Doc();
    writeFrame(doc, ID, FRAME.w, FRAME.h);
    const { el, stage } = await open(doc);
    key('t');
    pointer(stage, 'pointerdown', 50, 50);
    const area = el.querySelector<HTMLTextAreaElement>('.annotator-text')!;
    expect(area).toBeTruthy();
    area.value = 'Borrar el poste';
    act(() => area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(shapes(doc).map((s) => (s.type === 'text' ? s.text : s.type))).toEqual(['Borrar el poste']);
    key('n');
    for (const x of [500, 600]) {
      pointer(stage, 'pointerdown', x, 500);
      pointer(stage, 'pointerup', x, 500);
    }
    expect(shapes(doc).filter((s) => s.type === 'numbered_marker').map((s) => (s.type === 'numbered_marker' ? s.number : 0))).toEqual([1, 2]);
  });

  it('cambiar el color de lo elegido escribe solo el color, y tocar el mismo color otra vez no escribe nada', async () => {
    const doc = new Y.Doc();
    writeFrame(doc, ID, FRAME.w, FRAME.h);
    addShape(doc, ID, 'l', { type: 'line', zValue: 1, posX: 400, posY: 400, startX: 0, startY: 0, endX: 2000, endY: 0, strokeColor: '#85DC53' });
    const { el, stage } = await open(doc);
    key('v');
    pointer(stage, 'pointerdown', 300, 100);
    pointer(stage, 'pointerup', 300, 100);
    const updates: Uint8Array[] = [];
    doc.on('update', (u: Uint8Array) => updates.push(u));
    const red = () => el.querySelector<HTMLButtonElement>('.annotator-swatch[aria-label="Color #FF3B30"]')!;
    act(() => red().click());
    act(() => red().click());
    expect(updates.length).toBe(1);
    const raw = map(doc).get(`${ID}/l`) as Y.Map<unknown>;
    expect(raw.get('strokeColor')).toBe('#FF3B30');
    expect(raw.get('posX')).toBe(400);
  });

  it('un texto a medio escribir se guarda si el anotador se cierra solo (cambió el permiso, se fue de la página)', async () => {
    const doc = new Y.Doc();
    writeFrame(doc, ID, FRAME.w, FRAME.h);
    const { el, stage } = await open(doc);
    key('t');
    pointer(stage, 'pointerdown', 50, 50);
    const area = el.querySelector<HTMLTextAreaElement>('.annotator-text')!;
    area.value = 'Plano 12';
    act(() => area.dispatchEvent(new Event('input', { bubbles: true })));
    for (const r of roots.splice(0)) act(() => r.unmount());
    expect(shapes(doc).map((s) => (s.type === 'text' ? s.text : s.type))).toEqual(['Plano 12']);
  });

  it('Done con un texto a medio escribir lo guarda una sola vez', async () => {
    const doc = new Y.Doc();
    writeFrame(doc, ID, FRAME.w, FRAME.h);
    const { el, stage, onClose } = await open(doc);
    key('t');
    pointer(stage, 'pointerdown', 50, 50);
    const area = el.querySelector<HTMLTextAreaElement>('.annotator-text')!;
    area.value = 'Una vez';
    act(() => area.dispatchEvent(new Event('input', { bubbles: true })));
    // Como la página: cerrar desmonta el anotador en la misma tanda (sin volver a dibujarlo antes).
    act(() => {
      el.querySelector<HTMLButtonElement>('.annotator-done')!.click();
      for (const r of roots.splice(0)) r.unmount();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(shapes(doc).length).toBe(1);
  });

  describe('al cerrarse, lo de esta vez pasa a la línea de tiempo de la página (Doc_Deshacer.md, entrega 3)', () => {
    it('una sola vez, con todos los pasos (también un texto a medio escribir); deshacerlos todos lo saca entero', async () => {
      const doc = new Y.Doc();
      const got: { steps: number; map: Y.Map<unknown> }[] = [];
      let steps: Y.UndoManager['undoStack'] = [];
      const { el, stage } = await open(doc, 0, {
        size: async () => ({ width: FRAME.w, height: FRAME.h }),
        onUndoSteps: (s, m) => {
          steps = s;
          got.push({ steps: s.length, map: m });
        },
      });
      key('e');
      drag(stage, [100, 100], [200, 200]);
      key('r');
      drag(stage, [300, 300], [400, 400]);
      key('t');
      pointer(stage, 'pointerdown', 50, 50);
      const area = el.querySelector<HTMLTextAreaElement>('.annotator-text')!;
      area.value = 'Plano 12';
      act(() => area.dispatchEvent(new Event('input', { bubbles: true })));
      expect(got).toEqual([]);
      for (const r of roots.splice(0)) act(() => r.unmount());
      expect(got).toHaveLength(1);
      expect(got[0].steps).toBe(3);
      expect(got[0].map).toBe(map(doc));
      expect(shapes(doc)).toHaveLength(3);
      const um = markupManager(map(doc));
      um.undoStack = [...steps];
      while (um.undoStack.length) popMarkupStep(um, 'undo');
      expect(shapes(doc)).toEqual([]);
      // El marco de la foto queda (deshacer nunca lo borra; un marco solo no se dibuja).
      expect([...map(doc).keys()]).toEqual([ID]);
    });

    it('⌘Z en el anotador no se lleva una forma tuya que otra persona movió (queda entera, con su cambio)', async () => {
      const doc = new Y.Doc();
      writeFrame(doc, ID, FRAME.w, FRAME.h);
      const remote = new Y.Doc();
      Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
      connect(doc, remote, 'sync', { repair: false });
      const { stage } = await open(doc);
      key('e');
      drag(stage, [100, 100], [200, 200]);
      const [mine] = shapes(doc);
      expect(mine.type).toBe('ellipse');
      act(() => (remote.getMap<unknown>(PHOTO_MARKUP_MAP).get(`${ID}/${mine.id}`) as Y.Map<unknown>).set('posX', 1234));
      key('z', { ctrlKey: true });
      const [still] = shapes(doc);
      expect(still).toMatchObject({ id: mine.id, type: 'ellipse', posX: 1234 });
      expect(shapes(remote)).toEqual(shapes(doc));
    });

    it('sin escribir nada no avisa; si se deshizo todo adentro, avisa sin pasos (es algo nuevo igual)', async () => {
      const doc = new Y.Doc();
      writeFrame(doc, ID, FRAME.w, FRAME.h);
      const calls: number[] = [];
      await open(doc, 0, { onUndoSteps: (s) => void calls.push(s.length) });
      for (const r of roots.splice(0)) act(() => r.unmount());
      expect(calls).toEqual([]);
      const second = await open(doc, 0, { onUndoSteps: (s) => void calls.push(s.length) });
      key('e');
      drag(second.stage, [100, 100], [200, 200]);
      key('z', { ctrlKey: true });
      expect(shapes(doc)).toEqual([]);
      for (const r of roots.splice(0)) act(() => r.unmount());
      expect(calls).toEqual([0]);
    });
  });

  describe('el marco de la primera anotación (auditoría B1)', () => {
    /** jsdom no carga imágenes: una de mentira que "carga" con la medida de cada dirección. */
    const SIZES: Record<string, [number, number]> = { 'blob:thumb': [480, 360], 'blob:full': [1200, 900] };
    class FakeImage {
      naturalWidth = 0;
      naturalHeight = 0;
      onload: (() => void) | null = null;
      set src(url: string) {
        setTimeout(() => {
          [this.naturalWidth, this.naturalHeight] = SIZES[url] ?? [0, 0];
          this.onload?.();
        }, 0);
      }
    }
    const withOriginal: Loader = { preview: async () => ({ kind: 'image', name: 'x.jpg', preview: 'blob:thumb' }), full: async () => ({ url: 'blob:full', local: true }) };
    const thumbOnly: Loader = {
      preview: async () => ({ kind: 'image', name: 'x.jpg', preview: 'blob:thumb' }),
      full: async () => {
        throw new TypeError('Failed to fetch');
      },
    };
    const wait = () => act(async () => new Promise((r) => setTimeout(r, 20)));

    it('dos anotan por primera vez la misma foto sin red, uno con el original y otro con la miniatura: cada forma queda donde se dibujó', async () => {
      vi.stubGlobal('Image', FakeImage);
      try {
        const docA = new Y.Doc();
        const docB = new Y.Doc();
        const link = connect(docA, docB, 'async');
        link.offline();
        const a = await open(docA, 0, { loader: withOriginal });
        // B, sin red, ve la miniatura; la medida del archivo la sabe el registro del dispositivo.
        const b = await open(docB, 2000, { loader: thumbOnly, size: async () => ({ width: 1200, height: 900 }) });
        await wait();
        act(() => a.el.querySelector<HTMLButtonElement>('[data-tool="rectangle"]')!.click());
        act(() => b.el.querySelector<HTMLButtonElement>('[data-tool="rectangle"]')!.click());
        // A, alrededor de la mira azul (70 %, 60 %); B, de la roja (25 %, 30 %). La caja mide 1000 × 750 en pantalla.
        drag(a.stage, [650, 400], [750, 500], { id: 1 });
        drag(b.stage, [2200, 175], [2300, 275], { id: 2 });
        link.online();
        for (const doc of [docA, docB]) {
          const frame = readPhotoMarkup(map(doc), ID)!.frame;
          expect([frame.w, frame.h]).toEqual([1200, 900]);
          const xs = shapes(doc)
            .map((s) => (s.type === 'rectangle' ? [Math.round((s.posX / frame.w) * 100), Math.round((s.rect.w / frame.w) * 100)] : []))
            .sort((p, q) => p[0] - q[0]);
          expect(xs).toEqual([
            [20, 10],
            [65, 10],
          ]);
        }
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('sin la medida del archivo y sin el original, se ve la miniatura pero no se crea nada (con el aviso)', async () => {
      vi.stubGlobal('Image', FakeImage);
      try {
        const doc = new Y.Doc();
        const { el, stage } = await open(doc, 0, { loader: thumbOnly, size: async () => null });
        await wait();
        expect(el.querySelector('.annotator-box')).not.toBeNull();
        expect(el.querySelector<HTMLButtonElement>('[data-tool="arrow"]')!.disabled).toBe(true);
        expect(el.querySelector('.annotator-status')?.textContent).toBe('Showing a preview: connect to the internet to annotate this photo for the first time');
        key('a');
        drag(stage, [100, 600], [700, 200]);
        expect([...map(doc).keys()]).toEqual([]);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('con el original cargado (sin registro), el marco es su medida', async () => {
      vi.stubGlobal('Image', FakeImage);
      try {
        const doc = new Y.Doc();
        const { stage } = await open(doc, 0, { loader: withOriginal });
        await wait();
        key('r');
        drag(stage, [100, 100], [200, 200]);
        expect(readPhotoMarkup(map(doc), ID)!.frame).toMatchObject({ w: 1200, h: 900 });
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  it('un texto que otro borra mientras se edita no se pierde: al terminar se crea de nuevo, con lo escrito', async () => {
    const doc = new Y.Doc();
    writeFrame(doc, ID, FRAME.w, FRAME.h);
    addShape(doc, ID, 't', { type: 'text', zValue: 1, posX: 400, posY: 400, rectX: 0, rectY: 0, rectW: 1200, rectH: 200, padding: 10, text: 'Borrar', fontSize: 90 });
    const { el, stage } = await open(doc);
    key('v');
    act(() => stage.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 150, clientY: 125 })));
    const area = el.querySelector<HTMLTextAreaElement>('.annotator-text')!;
    expect(area.value).toBe('Borrar');
    area.value = 'Borrar el cable';
    act(() => area.dispatchEvent(new Event('input', { bubbles: true })));
    // Otro lo borra (llega por la red).
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    remote.getMap(PHOTO_MARKUP_MAP).delete(`${ID}/t`);
    act(() => Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(doc)), 'remote'));
    key('Escape');
    const texts = shapes(doc).filter((x) => x.type === 'text');
    expect(texts.map((x) => (x.type === 'text' ? [x.text, x.fontSize, x.posX + x.padding] : []))).toEqual([['Borrar el cable', 90, 410]]);
  });

  it('Ctrl+[ y Ctrl+] se frenan (en la Mac, ⌘[ es "atrás"); una letra del grosor escrita no cambia la herramienta', async () => {
    const doc = new Y.Doc();
    writeFrame(doc, ID, FRAME.w, FRAME.h);
    const { el } = await open(doc);
    const e = new KeyboardEvent('keydown', { key: '[', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(e);
    });
    expect(e.defaultPrevented).toBe(true);
    const field = el.querySelector<HTMLInputElement>('.annotator-number-field')!;
    field.focus();
    const r = new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true });
    act(() => {
      field.dispatchEvent(r);
    });
    expect(r.defaultPrevented).toBe(false);
    expect(el.querySelector('[data-tool="rectangle"]')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('un marco de una versión más nueva del formato: solo lectura (no se dibuja ni se borra nada)', async () => {
    const doc = new Y.Doc();
    map(doc).set(ID, { v: 2, w: FRAME.w, h: FRAME.h });
    addShape(doc, ID, 'r', { type: 'rectangle', zValue: 1, posX: 400, posY: 400, rectX: 0, rectY: 0, rectW: 800, rectH: 400 });
    const { el, stage } = await open(doc);
    expect(el.querySelector('.annotator-status')?.textContent).toBe('Update the app to edit these annotations');
    expect(el.querySelector<HTMLButtonElement>('[data-tool="arrow"]')!.disabled).toBe(true);
    const before = Y.encodeStateVector(doc).join();
    key('a');
    drag(stage, [100, 100], [500, 500]);
    key('v');
    pointer(stage, 'pointerdown', 100, 100);
    pointer(stage, 'pointerup', 100, 100);
    key('Delete');
    expect(Y.encodeStateVector(doc).join()).toBe(before);
  });

  it('al tope de bytes de la foto, las herramientas de crear se apagan (borrar sigue)', async () => {
    const doc = new Y.Doc();
    writeFrame(doc, ID, FRAME.w, FRAME.h);
    // Textos largos hasta pasar el tope.
    for (let i = 0; i < 60; i++) addShape(doc, ID, `t${i}`, { type: 'text', zValue: i, posX: 10, posY: 10 + i, text: 'x'.repeat(2000), fontSize: 10 });
    const { el, stage } = await open(doc);
    expect(el.querySelector('.annotator-status')?.textContent).toBe('This photo has too many annotations');
    expect(el.querySelector<HTMLButtonElement>('[data-tool="arrow"]')!.disabled).toBe(true);
    expect(el.querySelector<HTMLButtonElement>('[data-tool="select"]')!.disabled).toBe(false);
    const count = shapes(doc).length;
    key('a');
    drag(stage, [100, 600], [700, 200]);
    expect(shapes(doc).length).toBe(count);
    expect(PHOTO_MARKUP_CAP).toBe(96 * 1024);
  });

  it('un mapa malicioso se abre sin romper, y mover una forma escribe solo su lugar, finito', async () => {
    const doc = new Y.Doc();
    writeFrame(doc, ID, FRAME.w, FRAME.h);
    addShape(doc, ID, 'mala', {
      type: 'rectangle',
      zValue: 1,
      posX: 400,
      posY: 400,
      rectX: 0,
      rectY: 0,
      rectW: 800,
      rectH: 400,
      fillMode: 2,
      fillOpacity: 50,
      strokeColor: 'red" onload="alert(1)',
      strokeWidth: 1e308,
      extra: '<img src=x onerror=alert(1)>',
    });
    addShape(doc, ID, 'nan', { type: 'ellipse', zValue: 2, posX: 1e300, posY: -1e300, rectX: 0, rectY: 0, rectW: 1e300, rectH: 5 });
    const { el, stage } = await open(doc);
    expect(el.innerHTML).not.toContain('onload');
    expect(el.innerHTML).not.toContain('onerror');
    key('v');
    const updates: Uint8Array[] = [];
    doc.on('update', (u: Uint8Array) => updates.push(u));
    drag(stage, [200, 150], [300, 200]);
    const raw = map(doc).get(`${ID}/mala`) as Y.Map<unknown>;
    expect(raw.get('posX')).toBe(800);
    expect(raw.get('posY')).toBe(600);
    // Lo demás (también lo raro) queda como estaba: una propiedad por clave.
    expect(raw.get('strokeColor')).toBe('red" onload="alert(1)');
    expect(raw.get('extra')).toBe('<img src=x onerror=alert(1)>');
    expect(updates.length).toBe(1);
  });
});
