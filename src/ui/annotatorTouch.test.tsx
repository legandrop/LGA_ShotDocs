// @vitest-environment jsdom
// El anotador con el dedo y con el lápiz (P.20, entrega 3; Docs/Doc_Anotar_Fotos.md, sección 2 y AN8). Sin teléfono: los
// eventos de puntero llevan `pointerType: 'touch'` o `'pen'`, y la caja de la foto se mide con su zoom (la de jsdom no
// tiene tamaño), así lo dibujado después de ampliar se puede comprobar en píxeles del marco.
//   - Un dedo dibuja y se escribe al soltar; dos dedos amplían y NUNCA dibujan (lo del primero se deja).
//   - El lápiz: apenas se usa, el lápiz dibuja y el dedo mueve (recordado en el dispositivo); la palma no hace nada.
//   - El teléfono: la tira de abajo, la hoja de propiedades y el texto en una caja común con el foco puesto en el toque.
//   - El lápiz a 240 por segundo: se usan los puntos que el navegador junta, y al soltar se simplifica (bytes acotados).
//   - Sin red y con las versiones publicadas, lo dibujado con el dedo no se pierde.
import { type PartialBlock } from '@blocknote/core';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { PHOTO_MARKUP_MAP, readPhotoMarkup, writeFrame } from '../media/markup';
import { Annotator } from './Annotator';
import { inputOf, movePoints, routeDown } from './annotatorTouch';
import { loadPrefs, savePrefs } from './annotatorStyles';
import { shortcutLabel } from './shortcuts';
import type { CarreteItem } from './carreteModel';
import { connect, mountEditor, tick, unmountAll, yText } from './collabHarness';
import { schema } from './editorSchema';
import { schema as previousPublished } from './fixtures/editorSchemaAnterior';
import { schema as publishedSchema } from './fixtures/editorSchemaMain';
import { findUnknownContent } from './unknownContent';

const ID = '0f8fad5b-d9cb-469f-a165-708677289501';
const FRAME = { w: 4000, h: 3000 };
const ITEM: CarreteItem = { key: '', blockId: '', at: null, url: `sdmedia://${ID}`, source: 'media', mediaId: ID, name: 'IMG_0423.jpg', caption: '' };
const loader = {
  preview: async () => ({ kind: 'image' as const, name: 'IMG_0423.jpg', preview: 'blob:thumb' }),
  full: async () => ({ url: 'blob:full', local: true }),
};

const rect = (x: number, y: number, w: number, h: number) => ({ x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON: () => ({}) }) as DOMRect;

/**
 * El escenario mide 1000 × 750 y la foto (4000 × 3000) entra justa: sin zoom, cada píxel de pantalla son 4 del marco.
 * La caja de la foto se mide con su `transform` (centrada en el escenario, como el CSS), así un pellizco cambia de verdad
 * dónde cae cada dedo en la foto.
 */
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const host = this.closest('[data-test-left]') as HTMLElement | null;
    const left = host ? Number(host.dataset.testLeft) : 0;
    if (this.classList.contains('annotator-stage')) return rect(left, 0, 1000, 750);
    if (this.classList.contains('annotator-box')) {
      const m = /translate3d\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px, 0\) scale\(([\d.e+-]+)\)/.exec((this as HTMLElement).style.transform);
      const [tx, ty, s] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 1];
      const cx = left + 500 + tx;
      const cy = 375 + ty;
      return rect(cx - 500 * s, cy - 375 * s, 1000 * s, 750 * s);
    }
    return rect(0, 0, 0, 0);
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('annotator-stage') ? 1000 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('annotator-stage') ? 750 : 0;
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
  vi.unstubAllGlobals();
  unmountAll();
});

/** La pantalla del teléfono (`pointer: coarse`): la tira de abajo y la hoja. */
function phone() {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
}

const map = (doc: Y.Doc) => doc.getMap<unknown>(PHOTO_MARKUP_MAP);
const shapes = (doc: Y.Doc) => readPhotoMarkup(map(doc), ID)?.shapes ?? [];

async function open(doc: Y.Doc, left = 0) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(<Annotator doc={doc} fileId={ID} name="IMG_0423.jpg" item={ITEM} loader={loader} onClose={() => undefined} />);
  });
  await act(async () => new Promise((r) => setTimeout(r, 10)));
  const all = document.querySelectorAll<HTMLElement>('.annotator');
  const el = all[all.length - 1];
  el.dataset.testLeft = String(left);
  // Que el anotador se vuelva a medir con su lugar (la caja depende de `data-test-left`).
  act(() => window.dispatchEvent(new Event('resize')));
  const stage = el.querySelector<HTMLElement>('.annotator-stage')!;
  return { el, stage };
}

type Kind = 'touch' | 'pen' | 'mouse';

/** Un evento de puntero (jsdom no tiene `PointerEvent`). `coalesced`: los puntos que el navegador juntó en este. */
function ptr(target: Element, type: string, x: number, y: number, o: { id?: number; kind?: Kind; coalesced?: [number, number][]; time?: number } = {}) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(e, 'pointerId', { value: o.id ?? 1 });
  Object.defineProperty(e, 'pointerType', { value: o.kind ?? 'touch' });
  if (o.coalesced) {
    const list = o.coalesced;
    Object.defineProperty(e, 'getCoalescedEvents', { value: () => list.map(([cx, cy]) => ({ clientX: cx, clientY: cy })) });
  }
  if (o.time !== undefined) Object.defineProperty(e, 'timeStamp', { value: o.time });
  act(() => {
    target.dispatchEvent(e);
  });
}

/** Un dedo (o el lápiz) que se arrastra de `from` a `to`. */
function stroke(stage: Element, from: [number, number], to: [number, number], o: { id?: number; kind?: Kind } = {}) {
  ptr(stage, 'pointerdown', ...from, o);
  for (let i = 1; i <= 6; i++) ptr(stage, 'pointermove', from[0] + ((to[0] - from[0]) * i) / 6, from[1] + ((to[1] - from[1]) * i) / 6, o);
  ptr(stage, 'pointerup', ...to, o);
}

/** Dos dedos que se separan desde el centro: amplían al doble. */
function pinchOpen(stage: Element, ids: [number, number] = [11, 12]) {
  ptr(stage, 'pointerdown', 400, 375, { id: ids[0] });
  // El primer dedo llega a dibujar un poco antes de que apoye el segundo.
  ptr(stage, 'pointermove', 420, 390, { id: ids[0] });
  ptr(stage, 'pointermove', 400, 375, { id: ids[0] });
  ptr(stage, 'pointerdown', 600, 375, { id: ids[1] });
  for (let i = 1; i <= 5; i++) {
    ptr(stage, 'pointermove', 400 - i * 20, 375, { id: ids[0] });
    ptr(stage, 'pointermove', 600 + i * 20, 375, { id: ids[1] });
  }
}

const boxTransform = (el: Element) => el.querySelector<HTMLElement>('.annotator-box')!.style.transform;
const tool = (el: Element, t: string) => act(() => el.querySelector<HTMLButtonElement>(`[data-tool="${t}"]`)!.click());

describe('la regla del dedo y el lápiz (sin pantalla)', () => {
  it('un dedo usa la herramienta; dos amplían; con el lápiz en uso el dedo mueve; la palma no hace nada', () => {
    expect(routeDown({ input: 'touch', penOnly: false, touches: 1, drawing: null })).toBe('tool');
    expect(routeDown({ input: 'touch', penOnly: false, touches: 2, drawing: 'touch' })).toBe('pinch');
    expect(routeDown({ input: 'touch', penOnly: true, touches: 1, drawing: null })).toBe('pan');
    expect(routeDown({ input: 'touch', penOnly: true, touches: 2, drawing: null })).toBe('pinch');
    expect(routeDown({ input: 'touch', penOnly: true, touches: 1, drawing: 'pen' })).toBe('ignore');
    expect(routeDown({ input: 'touch', penOnly: false, touches: 2, drawing: 'pen' })).toBe('ignore');
    expect(routeDown({ input: 'pen', penOnly: true, touches: 2, drawing: 'touch' })).toBe('tool');
    expect(routeDown({ input: 'mouse', penOnly: true, touches: 0, drawing: null })).toBe('tool');
    expect([inputOf('touch'), inputOf('pen'), inputOf('mouse'), inputOf(''), inputOf(undefined)]).toEqual(['touch', 'pen', 'mouse', 'mouse', 'mouse']);
  });

  it('los puntos de un movimiento: los juntados por el navegador, o el del evento', () => {
    expect(movePoints({ clientX: 5, clientY: 6 })).toEqual([{ x: 5, y: 6 }]);
    expect(movePoints({ clientX: 5, clientY: 6, getCoalescedEvents: () => [] })).toEqual([{ x: 5, y: 6 }]);
    const list = [
      { clientX: 1, clientY: 2 },
      { clientX: 3, clientY: 4 },
    ];
    expect(movePoints({ clientX: 3, clientY: 4, getCoalescedEvents: () => list })).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
    const broken = () => {
      throw new Error('no');
    };
    expect(movePoints({ clientX: 7, clientY: 8, getCoalescedEvents: broken })).toEqual([{ x: 7, y: 8 }]);
  });
});

describe('el anotador con el dedo', () => {
  it('un dedo dibuja: la flecha se escribe al soltar, en píxeles del marco', async () => {
    const doc = new Y.Doc();
    writeFrame(doc, ID, FRAME.w, FRAME.h);
    const { el, stage } = await open(doc);
    tool(el, 'arrow');
    let during = -1;
    ptr(stage, 'pointerdown', 100, 600);
    for (let i = 1; i <= 5; i++) ptr(stage, 'pointermove', 100 + i * 120, 600 - i * 80);
    during = shapes(doc).length;
    ptr(stage, 'pointerup', 700, 200);
    expect(during).toBe(0);
    const [arrow] = shapes(doc);
    expect(arrow).toMatchObject({ type: 'arrow', posX: 400, posY: 2400 });
    if (arrow.type === 'arrow') expect(arrow.end).toEqual([2400, -1600]);
  });

  it('dos dedos amplían y nunca dibujan: lo que empezó el primero se deja, y el dedo que queda mueve la foto', async () => {
    const doc = new Y.Doc();
    writeFrame(doc, ID, FRAME.w, FRAME.h);
    const { el, stage } = await open(doc);
    tool(el, 'pencil');
    const updates: unknown[] = [];
    doc.on('update', (_u: Uint8Array, origin: unknown) => updates.push(origin));
    pinchOpen(stage);
    // El primer dedo llegó a dibujar un poco: no se escribió ni se escribe nada, y el borrador ya no se ve.
    expect(boxTransform(el)).toBe('translate3d(0px, 0px, 0) scale(2)');
    expect(el.querySelectorAll('svg.annotator-shapes [data-shape]').length).toBe(0);
    // Se levanta un dedo: el otro mueve la foto ampliada (y tampoco dibuja).
    ptr(stage, 'pointerup', 300, 375, { id: 11 });
    ptr(stage, 'pointermove', 750, 425, { id: 12 });
    expect(boxTransform(el)).toBe('translate3d(50px, 50px, 0) scale(2)');
    ptr(stage, 'pointerup', 750, 425, { id: 12 });
    expect(updates).toEqual([]);
    expect(shapes(doc)).toEqual([]);
    // Un dedo solo vuelve a dibujar, y lo dibujado cae donde está en la foto ampliada.
    tool(el, 'arrow');
    stroke(stage, [550, 425], [750, 425], { id: 13 });
    const [arrow] = shapes(doc);
    // Con zoom 2 y la foto corrida 50 px: el punto (550, 425) de la pantalla es el centro de la foto (2000, 1500).
    expect(arrow).toMatchObject({ type: 'arrow', posX: 2000, posY: 1500 });
    if (arrow.type === 'arrow') expect(arrow.end).toEqual([400, 0]);
    // Encuadrar vuelve a la foto entera.
    act(() => el.querySelector<HTMLButtonElement>('button[aria-label="Fit"]')!.click());
    expect(boxTransform(el)).toBe('translate3d(0px, 0px, 0) scale(1)');
  });

  it('un tercer dedo no rompe el pellizco; un dedo que se cancela (el sistema se quedó el gesto) no escribe', async () => {
    const doc = new Y.Doc();
    writeFrame(doc, ID, FRAME.w, FRAME.h);
    const { el, stage } = await open(doc);
    tool(el, 'rectangle');
    pinchOpen(stage);
    ptr(stage, 'pointerdown', 500, 600, { id: 14 });
    ptr(stage, 'pointermove', 520, 640, { id: 14 });
    for (const id of [14, 11, 12]) ptr(stage, 'pointerup', 500, 600, { id });
    expect(shapes(doc)).toEqual([]);
    ptr(stage, 'pointerdown', 100, 100, { id: 15 });
    ptr(stage, 'pointermove', 300, 300, { id: 15 });
    ptr(stage, 'pointercancel', 300, 300, { id: 15 });
    expect(shapes(doc)).toEqual([]);
  });

  it('tocar o hacer clic en un tirador sin moverlo no cambia la forma', async () => {
    const doc = new Y.Doc();
    writeFrame(doc, ID, FRAME.w, FRAME.h);
    const { el, stage } = await open(doc);
    tool(el, 'rectangle');
    stroke(stage, [100, 100], [300, 200], { kind: 'mouse' });
    tool(el, 'select');
    stroke(stage, [200, 100], [200, 100], { kind: 'mouse' });
    const updates: unknown[] = [];
    doc.on('update', (_u: Uint8Array, origin: unknown) => updates.push(origin));
    // La esquina de abajo a la derecha está en (300, 200): se toca 3 px al costado, con el mouse y con el dedo.
    stroke(stage, [303, 203], [303, 203], { kind: 'mouse' });
    stroke(stage, [292, 195], [292, 195], { id: 2 });
    expect(updates).toEqual([]);
    // Arrastrarlo sí lo cambia.
    stroke(stage, [300, 200], [400, 250], { id: 3 });
    expect(updates.length).toBe(1);
  });

  it('con el dedo, una forma chica ya elegida se mueve desde el medio de un lado; en una grande, cerca de la esquina se estira (O2)', async () => {
    const doc = new Y.Doc();
    writeFrame(doc, ID, FRAME.w, FRAME.h);
    const { el, stage } = await open(doc);
    tool(el, 'rectangle');
    // 60 × 36 px en pantalla: con 22 px de tirador en cada esquina no quedaría dónde agarrarla.
    stroke(stage, [100, 100], [160, 136], { kind: 'mouse' });
    tool(el, 'select');
    stroke(stage, [130, 118], [130, 118], { id: 2 });
    // Desde el medio del lado izquierdo (a 18 px de las esquinas), 30 px a la derecha y abajo.
    stroke(stage, [100, 118], [130, 148], { id: 3 });
    const [small] = shapes(doc);
    expect(small).toMatchObject({ type: 'rectangle', posX: 520, posY: 520 });
    if (small.type === 'rectangle') expect([small.rect.w, small.rect.h]).toEqual([240, 144]);
    // Una grande: tocar a 15 px de la esquina sigue tomando el tirador.
    tool(el, 'rectangle');
    stroke(stage, [400, 300], [700, 600], { kind: 'mouse' });
    tool(el, 'select');
    stroke(stage, [550, 450], [550, 450], { id: 4 });
    stroke(stage, [688, 590], [738, 640], { id: 5 });
    const big = shapes(doc).find((s) => s.id !== small.id)!;
    expect(big).toMatchObject({ posX: 1600, posY: 1200 });
    if (big.type === 'rectangle') expect(big.rect.w).toBeGreaterThan(1300);
  });

  it('con Select, un dedo elige y mueve (con más tolerancia que el mouse)', async () => {
    const doc = new Y.Doc();
    writeFrame(doc, ID, FRAME.w, FRAME.h);
    const { el, stage } = await open(doc);
    tool(el, 'line');
    stroke(stage, [100, 100], [400, 100]);
    tool(el, 'select');
    // 12 px de pantalla de la línea: con el mouse (6 px) no la elige, con el dedo sí.
    stroke(stage, [250, 112], [250, 212]);
    const [line] = shapes(doc);
    expect(line).toMatchObject({ type: 'line', posY: 800 });
  });
});

describe('el lápiz (AN8)', () => {
  it('apenas se usa, el lápiz dibuja y el dedo mueve; queda recordado en el dispositivo', async () => {
    const doc = new Y.Doc();
    writeFrame(doc, ID, FRAME.w, FRAME.h);
    const first = await open(doc);
    tool(first.el, 'pencil');
    stroke(first.stage, [100, 100], [300, 200], { id: 5, kind: 'pen' });
    expect(shapes(doc).length).toBe(1);
    expect(loadPrefs().penOnly).toBe(true);
    // Un dedo ya no dibuja: mueve la foto (ampliada, para que se note).
    pinchOpen(first.stage);
    for (const id of [11, 12]) ptr(first.stage, 'pointerup', 500, 375, { id });
    const zoomed = boxTransform(first.el);
    stroke(first.stage, [500, 400], [560, 440], { id: 21 });
    expect(shapes(doc).length).toBe(1);
    expect(boxTransform(first.el)).not.toBe(zoomed);
    // La próxima vez que se abre, sigue igual.
    for (const r of roots.splice(0)) act(() => r.unmount());
    document.body.innerHTML = '';
    const again = await open(doc);
    tool(again.el, 'arrow');
    stroke(again.stage, [100, 500], [400, 500], { id: 22 });
    expect(shapes(doc).length).toBe(1);
    stroke(again.stage, [100, 500], [400, 500], { id: 6, kind: 'pen' });
    expect(shapes(doc).length).toBe(2);
  });

  it('la palma apoyada mientras el lápiz dibuja no hace nada; el lápiz deja lo que un dedo dibujaba', async () => {
    const doc = new Y.Doc();
    writeFrame(doc, ID, FRAME.w, FRAME.h);
    const { el, stage } = await open(doc);
    tool(el, 'pencil');
    // Un dedo empieza a dibujar (todavía sin lápiz) y llega el lápiz: el trazo del dedo se deja.
    ptr(stage, 'pointerdown', 600, 600, { id: 30 });
    ptr(stage, 'pointermove', 650, 650, { id: 30 });
    ptr(stage, 'pointerdown', 100, 100, { id: 7, kind: 'pen' });
    // La palma se apoya y se mueve mientras el lápiz dibuja.
    ptr(stage, 'pointerdown', 700, 500, { id: 31 });
    for (let i = 1; i <= 6; i++) {
      ptr(stage, 'pointermove', 100 + i * 40, 100 + i * 10, { id: 7, kind: 'pen' });
      ptr(stage, 'pointermove', 700 + i * 5, 500 + i * 5, { id: 31 });
    }
    ptr(stage, 'pointerup', 730, 530, { id: 31 });
    ptr(stage, 'pointerup', 680, 680, { id: 30 });
    ptr(stage, 'pointerup', 340, 160, { id: 7, kind: 'pen' });
    const all = shapes(doc);
    expect(all.length).toBe(1);
    expect(all[0]).toMatchObject({ type: 'freehand_pencil', posX: 400, posY: 400 });
    expect(boxTransform(el)).toBe('translate3d(0px, 0px, 0) scale(1)');
  });

  it('el lápiz a 240 por segundo: se usan los puntos juntados por el navegador y al soltar se simplifica', async () => {
    const doc = new Y.Doc();
    writeFrame(doc, ID, FRAME.w, FRAME.h);
    const { el, stage } = await open(doc);
    tool(el, 'pencil');
    const before = Y.encodeStateAsUpdate(doc).length;
    // 2 s: 120 eventos (60 por segundo) con 4 puntos cada uno. Una curva suave con un temblor de medio píxel, y en el
    // medio un pico de 40 px que solo está en los puntos juntados (el del evento queda sobre la curva).
    ptr(stage, 'pointerdown', 100, 400, { id: 8, kind: 'pen' });
    let raw = 0;
    for (let ev = 0; ev < 120; ev++) {
      const pts: [number, number][] = [];
      for (let k = 1; k <= 4; k++) {
        const i = ev * 4 + k;
        const x = 100 + i * 1.5;
        const jitter = (i % 2) * 0.5;
        const spike = i === 241 ? -40 : 0;
        pts.push([x, 400 + 120 * Math.sin(i / 80) + jitter + spike]);
      }
      raw += pts.length;
      const last = pts[pts.length - 1];
      ptr(stage, 'pointermove', last[0], last[1], { id: 8, kind: 'pen', coalesced: pts });
    }
    ptr(stage, 'pointerup', 820, 400, { id: 8, kind: 'pen' });
    expect(raw).toBe(480);
    const [s] = shapes(doc);
    expect(s.type).toBe('freehand_pencil');
    if (s.type !== 'freehand_pencil') return;
    const n = s.points.length / 2;
    // Simplificado: muchos menos que los 481 que llegaron, pero el pico (solo en los puntos juntados) sigue.
    expect(n).toBeLessThan(160);
    const ys = s.points.filter((_, i) => i % 2 === 1).map((y) => y + s.posY);
    const peak = (400 + 120 * Math.sin(241 / 80) - 40) * 4;
    expect(Math.min(...ys)).toBeLessThanOrEqual(Math.round(peak) + 1);
    // Los bytes de este trazo (sección 10: 1,7 KB medidos a 240 Hz en el diseño).
    const bytes = Y.encodeStateAsUpdate(doc).length - before;
    expect(bytes).toBeLessThan(2500);
  });
});

/**
 * Una ventana angosta con mouse (`max-width: 760px` sí, `pointer: coarse` no): el anotador se arma como en el teléfono
 * (la tira de abajo y la hoja) pero los tooltips conservan los atajos y los gestos del mouse, porque lo decide el tipo de
 * puntero y no el ancho (D226; roadmap B.25c).
 */
function narrowMouse() {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
}

describe('una ventana angosta con mouse: la tira del teléfono, con los atajos en los tooltips (B.25c)', () => {
  const tipOf = (el: Element, selector: string) => el.querySelector<HTMLElement>(selector)?.getAttribute('data-tip') ?? null;

  it('las herramientas, deshacer, encuadrar y el grosor dicen su atajo; en el teléfono, no', async () => {
    narrowMouse();
    const doc = new Y.Doc();
    writeFrame(doc, ID, FRAME.w, FRAME.h);
    const { el } = await open(doc);
    // Angosta: la tira de abajo, como en el teléfono.
    expect(el.hasAttribute('data-compact')).toBe(true);
    expect(tipOf(el, '.annotator-dock [data-tool="arrow"]')).toContain(`**${shortcutLabel('annotateArrow', false)}**: `);
    // Con mouse sí hay Shift+arrastrar.
    expect(tipOf(el, '[data-tool="arrow"]')).toContain('**Shift+drag**: ');
    expect(tipOf(el, 'button[aria-label="Undo"]')!.startsWith(`**${shortcutLabel('annotateUndo', false)}**: undo`)).toBe(true);
    // Encuadrar: la tecla, la rueda y Espacio+arrastrar (no el toque).
    const fit = tipOf(el, 'button[aria-label="Fit"]')!;
    expect(fit).toContain(`**${shortcutLabel('annotateFit', false)}**: `);
    expect(fit).toContain('**Scroll**: ');
    expect(fit).not.toContain('**Pinch**');
    // El grosor, en la hoja.
    tool(el, 'line');
    act(() => el.querySelector<HTMLButtonElement>('.annotator-dot')!.click());
    const width = [...el.querySelectorAll<HTMLElement>('.annotator-sheet .annotator-field')].find((f) => f.textContent?.includes('Thickness'));
    expect(width?.getAttribute('data-tip')).toContain(`**${shortcutLabel('annotateWidth', false)}**: `);
  });

  it('en el teléfono (el dedo), las mismas sin atajos', async () => {
    phone();
    const doc = new Y.Doc();
    writeFrame(doc, ID, FRAME.w, FRAME.h);
    const { el } = await open(doc);
    expect(el.hasAttribute('data-compact')).toBe(true);
    expect(tipOf(el, '[data-tool="arrow"]')).toBeNull();
    expect(tipOf(el, 'button[aria-label="Undo"]')).toBeNull();
    expect(tipOf(el, 'button[aria-label="Fit"]')).not.toContain(shortcutLabel('annotateFit', false) + '**');
    tool(el, 'line');
    act(() => el.querySelector<HTMLButtonElement>('.annotator-dot')!.click());
    const width = [...el.querySelectorAll<HTMLElement>('.annotator-sheet .annotator-field')].find((f) => f.textContent?.includes('Thickness'));
    expect(width).toBeTruthy();
    expect(width!.getAttribute('data-tip')).toBeNull();
  });
});

describe('el teléfono: la tira, la hoja y el texto', () => {
  it.each([true, false])('O5: revela la herramienta recordada y la selección sólo dentro de la tira (compact=%s)', async (compact) => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: compact, media: query, addEventListener() {}, removeEventListener() {} }));
    const resize = new Set<() => void>();
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: () => void) {}
      observe(target: Element) { if (target.classList.contains('annotator-tools')) resize.add(this.callback); }
      disconnect() { resize.delete(this.callback); }
    });
    let width = 200;
    const originalRect = Element.prototype.getBoundingClientRect;
    const originalWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')!;
    Element.prototype.getBoundingClientRect = function () {
      if (this.classList.contains('annotator-tools')) return rect(10, 760, width, 44);
      if (this.hasAttribute('data-tool')) {
        const strip = this.parentElement!;
        const index = [...strip.children].indexOf(this);
        return rect(10 + index * 46 - strip.scrollLeft, 760, 44, 44);
      }
      return originalRect.call(this);
    };
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return this.classList.contains('annotator-tools') ? width : originalWidth.get!.call(this); } });
    try {
      savePrefs({ ...loadPrefs(), tool: 'number' });
      const doc = new Y.Doc(); writeFrame(doc, ID, FRAME.w, FRAME.h);
      const before = Array.from(Y.encodeStateAsUpdate(doc));
      const { el } = await open(doc);
      const strip = el.querySelector<HTMLElement>('.annotator-tools')!;
      expect(strip.scrollLeft).toBe(compact ? 212 : 0);
      const focus = document.activeElement;
      tool(el, 'select');
      expect(strip.scrollLeft).toBe(0);
      tool(el, 'number');
      expect(strip.scrollLeft).toBe(compact ? 212 : 0);
      width = 160;
      act(() => resize.forEach(fn => fn()));
      expect(strip.scrollLeft).toBe(compact ? 252 : 0);
      // Leer el documento y el foco no modifica el recorrido ni sustituye la guarda de visibilidad Native.
      expect(Array.from(Y.encodeStateAsUpdate(doc))).toEqual(before);
      expect(document.activeElement).toBe(focus);
      expect(loadPrefs().tool).toBe('number');
    } finally {
      Element.prototype.getBoundingClientRect = originalRect;
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalWidth);
    }
  });

  it('las herramientas van en la tira de abajo; el punto de color abre la hoja; tocar la foto la cierra sin dibujar', async () => {
    phone();
    const doc = new Y.Doc();
    writeFrame(doc, ID, FRAME.w, FRAME.h);
    const { el, stage } = await open(doc);
    expect(el.hasAttribute('data-compact')).toBe(true);
    expect(el.querySelector('.annotator-dock [data-tool="arrow"]')).not.toBeNull();
    expect(el.querySelector('.annotator-bar [data-tool="arrow"]')).toBeNull();
    expect(el.querySelector('.annotator-props')).toBeNull();
    tool(el, 'ellipse');
    const dot = el.querySelector<HTMLButtonElement>('.annotator-dot')!;
    expect(dot.getAttribute('aria-expanded')).toBe('false');
    act(() => dot.click());
    const sheet = el.querySelector('.annotator-sheet')!;
    expect(sheet).not.toBeNull();
    act(() => sheet.querySelector<HTMLButtonElement>('.annotator-swatch[aria-label="Color #FF3B30"]')!.click());
    expect(el.querySelector<HTMLElement>('.annotator-dot-color')!.style.background).toBe('rgb(255, 59, 48)');
    // Tocar la foto cierra la hoja y no dibuja.
    stroke(stage, [100, 100], [300, 300]);
    expect(el.querySelector('.annotator-sheet')).toBeNull();
    expect(shapes(doc)).toEqual([]);
    // Ahora sí, con el color nuevo.
    stroke(stage, [100, 100], [300, 300]);
    expect(shapes(doc)[0]).toMatchObject({ type: 'ellipse', strokeColor: '#FF3B30' });
  });

  it('el texto con el dedo: un toque abre una caja común con el foco ya puesto; lo escrito se ve en la foto; un pellizco no lo cierra', async () => {
    phone();
    const doc = new Y.Doc();
    writeFrame(doc, ID, FRAME.w, FRAME.h);
    const { el, stage } = await open(doc);
    tool(el, 'text');
    ptr(stage, 'pointerdown', 200, 300, { id: 40 });
    // Al apoyar no pasa nada todavía (podría ser el primer dedo de un pellizco).
    expect(el.querySelector('.annotator-textfield')).toBeNull();
    ptr(stage, 'pointerup', 201, 301, { id: 40 });
    const field = el.querySelector<HTMLTextAreaElement>('.annotator-textfield')!;
    expect(field).not.toBeNull();
    expect(document.activeElement).toBe(field);
    act(() => {
      field.value = 'Borrar el cable';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // Se ve en la foto mientras se escribe, sin escribir nada en el documento.
    expect(el.querySelector('svg.annotator-shapes [data-shape="text"]')?.textContent).toContain('Borrar el cable');
    expect(shapes(doc)).toEqual([]);
    // Ampliar con dos dedos no termina el texto.
    pinchOpen(stage);
    for (const id of [11, 12]) ptr(stage, 'pointerup', 500, 375, { id });
    expect(el.querySelector('.annotator-textfield')).not.toBeNull();
    act(() => el.querySelector<HTMLButtonElement>('.annotator-textpanel .annotator-done')!.click());
    expect(el.querySelector('.annotator-textfield')).toBeNull();
    const [t] = shapes(doc);
    expect(t).toMatchObject({ type: 'text', text: 'Borrar el cable' });
    // Donde se tocó (menos el margen de la caja).
    if (t.type === 'text') expect(t.posX + t.padding).toBeCloseTo(800, 0);
  });

  it('dos toques en un texto lo editan (un toque afuera lo termina); en un número, lo renumeran', async () => {
    phone();
    const doc = new Y.Doc();
    writeFrame(doc, ID, FRAME.w, FRAME.h);
    const { el, stage } = await open(doc);
    tool(el, 'text');
    ptr(stage, 'pointerdown', 200, 300, { id: 41 });
    ptr(stage, 'pointerup', 200, 300, { id: 41 });
    let field = el.querySelector<HTMLTextAreaElement>('.annotator-textfield')!;
    act(() => {
      field.value = 'Poste';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // Un toque afuera lo termina (al soltar).
    ptr(stage, 'pointerdown', 700, 600, { id: 42 });
    expect(shapes(doc)).toEqual([]);
    ptr(stage, 'pointerup', 700, 600, { id: 42 });
    expect(shapes(doc).map((s) => s.type)).toEqual(['text']);
    tool(el, 'number');
    ptr(stage, 'pointerdown', 800, 100, { id: 43 });
    ptr(stage, 'pointerup', 800, 100, { id: 43 });
    tool(el, 'select');
    const placed = shapes(doc).find((s) => s.type === 'text')!;
    // Dos toques sobre el texto (el segundo cae en su tirador de la esquina: tocarlo sin mover no lo cambia).
    ptr(stage, 'pointerdown', 205, 305, { id: 44, time: 1000 });
    ptr(stage, 'pointerup', 205, 305, { id: 44, time: 1050 });
    ptr(stage, 'pointerdown', 206, 306, { id: 45, time: 1200 });
    ptr(stage, 'pointerup', 206, 306, { id: 45, time: 1250 });
    field = el.querySelector<HTMLTextAreaElement>('.annotator-textfield')!;
    expect(field?.value).toBe('Poste');
    expect(shapes(doc).find((s) => s.type === 'text')).toMatchObject({ posX: placed.posX, posY: placed.posY });
    expect(document.activeElement).toBe(field);
    act(() => {
      field.value = 'Poste y cable';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => el.querySelector<HTMLButtonElement>('.annotator-textpanel .annotator-done')!.click());
    expect(shapes(doc).find((s) => s.type === 'text')).toMatchObject({ text: 'Poste y cable' });
    // Dos toques lentos no son un doble toque.
    ptr(stage, 'pointerdown', 800, 100, { id: 46, time: 5000 });
    ptr(stage, 'pointerup', 800, 100, { id: 46, time: 5050 });
    ptr(stage, 'pointerdown', 800, 100, { id: 47, time: 5900 });
    ptr(stage, 'pointerup', 800, 100, { id: 47, time: 5950 });
    expect(el.querySelector('.annotator-number')).toBeNull();
    ptr(stage, 'pointerdown', 800, 100, { id: 48, time: 6100 });
    ptr(stage, 'pointerup', 800, 100, { id: 48, time: 6150 });
    expect(el.querySelector('.annotator-number input')).not.toBeNull();
  });

  it('si la pantalla cambia (de teléfono a compu o al revés) con el texto abierto, lo escrito sigue y se guarda (O1)', async () => {
    // Un `matchMedia` que cambia: la ventana que se agranda o se achica.
    const listeners = new Set<() => void>();
    const mq = { matches: true, media: '', addEventListener: (_: string, f: () => void) => listeners.add(f), removeEventListener: (_: string, f: () => void) => listeners.delete(f) };
    vi.stubGlobal('matchMedia', () => mq);
    const flip = (compact: boolean) =>
      act(() => {
        mq.matches = compact;
        listeners.forEach((f) => f());
      });
    const type = (field: HTMLTextAreaElement, value: string) =>
      act(() => {
        field.value = value;
        field.dispatchEvent(new Event('input', { bubbles: true }));
      });
    const doc = new Y.Doc();
    writeFrame(doc, ID, FRAME.w, FRAME.h);
    const { el, stage } = await open(doc);
    tool(el, 'text');
    // Del teléfono a la compu.
    ptr(stage, 'pointerdown', 200, 300, { id: 80 });
    ptr(stage, 'pointerup', 200, 300, { id: 80 });
    type(el.querySelector<HTMLTextAreaElement>('.annotator-textfield')!, 'Ventana');
    flip(false);
    expect(el.querySelector('.annotator-textfield')).toBeNull();
    expect(el.querySelector<HTMLTextAreaElement>('textarea.annotator-text')!.value).toBe('Ventana');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(shapes(doc).map((s) => (s.type === 'text' ? s.text : s.type))).toEqual(['Ventana']);
    // De la compu al teléfono.
    ptr(stage, 'pointerdown', 600, 500, { kind: 'mouse', id: 81 });
    ptr(stage, 'pointerup', 600, 500, { kind: 'mouse', id: 81 });
    type(el.querySelector<HTMLTextAreaElement>('textarea.annotator-text')!, 'Poste');
    flip(true);
    expect(el.querySelector<HTMLTextAreaElement>('.annotator-textfield')!.value).toBe('Poste');
    // Mientras tanto, se ve en la foto.
    expect([...el.querySelectorAll('svg.annotator-shapes [data-shape="text"]')].map((n) => n.textContent).join('|')).toContain('Poste');
    act(() => el.querySelector<HTMLButtonElement>('.annotator-textpanel .annotator-done')!.click());
    expect(shapes(doc).map((s) => (s.type === 'text' ? s.text : s.type)).sort()).toEqual(['Poste', 'Ventana']);
  });

  it('*Only the pencil draws* se apaga en la hoja y no se vuelve a prender sola', async () => {
    phone();
    const doc = new Y.Doc();
    writeFrame(doc, ID, FRAME.w, FRAME.h);
    const { el, stage } = await open(doc);
    tool(el, 'line');
    // Sin lápiz todavía, la hoja no ofrece la opción.
    act(() => el.querySelector<HTMLButtonElement>('.annotator-dot')!.click());
    expect(el.querySelector('.annotator-pen')).toBeNull();
    act(() => el.querySelector<HTMLButtonElement>('.annotator-sheet button[aria-label="Close"]')!.click());
    stroke(stage, [100, 100], [300, 100], { id: 9, kind: 'pen' });
    act(() => el.querySelector<HTMLButtonElement>('.annotator-dot')!.click());
    const box = el.querySelector<HTMLInputElement>('.annotator-pen input')!;
    expect(box.checked).toBe(true);
    act(() => box.click());
    expect(loadPrefs()).toMatchObject({ penOnly: false, penSet: true });
    act(() => el.querySelector<HTMLButtonElement>('.annotator-sheet button[aria-label="Close"]')!.click());
    // El dedo vuelve a dibujar, y usar el lápiz otra vez no la prende.
    stroke(stage, [100, 300], [300, 300], { id: 50 });
    stroke(stage, [100, 500], [300, 500], { id: 10, kind: 'pen' });
    expect(loadPrefs().penOnly).toBe(false);
    stroke(stage, [100, 600], [300, 600], { id: 51 });
    expect(shapes(doc).length).toBe(4);
  });
});

describe('sin red y con las versiones que siguen abiertas', () => {
  it('dos dispositivos sin red, uno con el dedo y ampliando y otro con el mouse: al volver, cada forma en su lugar', async () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    writeFrame(docA, ID, FRAME.w, FRAME.h);
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA), 'remote');
    const link = connect(docA, docB, 'async');
    link.offline();
    const a = await open(docA, 0);
    const b = await open(docB, 2000);
    tool(a.el, 'arrow');
    tool(b.el, 'rectangle');
    pinchOpen(a.stage);
    for (const id of [11, 12]) ptr(a.stage, 'pointerup', 500, 375, { id });
    stroke(a.stage, [500, 375], [700, 375], { id: 60 });
    stroke(b.stage, [2100, 100], [2200, 200], { id: 61, kind: 'mouse' });
    expect(shapes(docA).length).toBe(1);
    expect(shapes(docB).length).toBe(1);
    act(() => link.online());
    for (const doc of [docA, docB]) {
      const list = shapes(doc);
      expect(list.map((s) => s.type).sort()).toEqual(['arrow', 'rectangle']);
      expect(list.find((s) => s.type === 'arrow')).toMatchObject({ posX: 2000, posY: 1500 });
      expect(list.find((s) => s.type === 'rectangle')).toMatchObject({ posX: 400, posY: 400 });
    }
  });

  const PAGE: PartialBlock[] = [
    { id: 'blk', type: 'image', props: { url: `sdmedia://${ID}`, name: 'IMG_0423.jpg' } },
    { id: 'par', type: 'paragraph', content: 'Plano 12' },
  ] as never;
  const versions = [
    ['la publicada (el editor de hoy)', schema],
    ['la de las fixtures (v0.107 a v0.111)', publishedSchema],
    ['la de v0.083 a v0.092', previousPublished],
  ] as const;

  for (const [name, old] of versions) {
    it(`${name} abre una página anotada con el dedo y el lápiz, la edita, y el mapa vuelve intacto`, async () => {
      phone();
      const doc = new Y.Doc();
      const E = mountEditor(doc, 'hoy');
      E.replaceBlocks(E.document, PAGE as never);
      await tick(10);
      unmountAll();
      writeFrame(doc, ID, FRAME.w, FRAME.h);
      const { el, stage } = await open(doc);
      tool(el, 'pencil');
      stroke(stage, [100, 100], [300, 250], { id: 70 });
      stroke(stage, [100, 400], [300, 450], { id: 11, kind: 'pen' });
      tool(el, 'text');
      ptr(stage, 'pointerdown', 500, 500, { id: 12, kind: 'pen' });
      ptr(stage, 'pointerup', 500, 500, { id: 12, kind: 'pen' });
      const field = el.querySelector<HTMLTextAreaElement>('.annotator-textfield')!;
      act(() => {
        field.value = 'Rótulo';
        field.dispatchEvent(new Event('input', { bubbles: true }));
      });
      act(() => el.querySelector<HTMLButtonElement>('.annotator-textpanel .annotator-done')!.click());
      for (const r of roots.splice(0)) act(() => r.unmount());
      const before = map(doc).toJSON();
      expect(Object.keys(before).length).toBe(4);
      const S = Y.encodeStateAsUpdate(doc);
      const copy = new Y.Doc();
      Y.applyUpdate(copy, S, 'remote');
      const written: Uint8Array[] = [];
      copy.on('update', (u: Uint8Array, origin: unknown) => origin !== 'remote' && written.push(u));
      const V = mountEditor(copy, 'vieja', old);
      await tick(20);
      V.insertBlocks([{ type: 'paragraph', content: 'nota de la vieja' }] as never, 'par', 'after');
      await tick(20);
      unmountAll();
      const server = new Y.Doc();
      Y.applyUpdate(server, S);
      for (const u of written) Y.applyUpdate(server, u);
      expect(map(server).toJSON()).toEqual(before);
      expect(yText(server)).toContain('nota de la vieja');
      expect(findUnknownContent(server)).toBeNull();
    });
  }
});
