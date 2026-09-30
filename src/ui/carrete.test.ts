import { describe, expect, it } from 'vitest';
import {
  carreteSourceOf,
  clampZoom,
  classifyDrag,
  collectCarrete,
  counterText,
  dismissResult,
  fallbackName,
  fitSize,
  isDoubleTap,
  isZoomed,
  MAX_SCALE,
  neighbors,
  NO_ZOOM,
  panBy,
  pinchZoom,
  resistEdges,
  startIndex,
  stepIndex,
  swipeResult,
  toggleZoom,
  wheelScale,
  zoomAt,
  type BlockLike,
  type Zoom,
} from './carrete';
import { noticeFor } from './Carrete';

// La lógica del carrete (paso 7): qué fotos y videos tiene la página y en qué orden, la navegación, el
// zoom y qué hace cada gesto.

const MEDIA_A = 'sdmedia://6f1c2a4e-0b7d-4c8e-9f10-112233445566';
const MEDIA_B = 'sdmedia://0a1b2c3d-4e5f-4a6b-8c7d-8e9f00112233';

const image = (id: string, url: string, extra: Record<string, unknown> = {}, children: BlockLike[] = []): BlockLike => ({
  id,
  type: 'image',
  props: { url, name: '', caption: '', ...extra },
  children,
});
const paragraph = (id: string, children: BlockLike[] = []): BlockLike => ({ id, type: 'paragraph', props: {}, children });

describe('carrete: los elementos de la página', () => {
  it('junta las fotos y videos en el orden de la página, también los que están adentro de otro bloque', () => {
    const page = [
      paragraph('p1'),
      image('i1', MEDIA_A, { name: 'IMG_0666.MOV', caption: 'Toma 3' }),
      paragraph('p2', [image('i2', 'sdfile://page/abc.jpg'), paragraph('p3', [image('i3', 'https://example.com/a.jpg')])]),
      image('i4', 'data:image/png;base64,AAAA'),
      image('i5', MEDIA_B),
    ];
    const items = collectCarrete(page);
    expect(items.map((i) => i.blockId)).toEqual(['i1', 'i2', 'i3', 'i4', 'i5']);
    expect(items[0]).toEqual({
      blockId: 'i1',
      url: MEDIA_A,
      source: 'media',
      mediaId: '6f1c2a4e-0b7d-4c8e-9f10-112233445566',
      name: 'IMG_0666.MOV',
      caption: 'Toma 3',
    });
    expect(items.map((i) => i.source)).toEqual(['media', 'file', 'web', 'web', 'media']);
  });

  it('deja afuera lo que no se puede mostrar: a medio subir, direcciones raras, otros bloques', () => {
    const page = [
      image('vacia', ''),
      image('rota', 'sdmedia://no-es-un-id'),
      image('js', 'javascript:alert(1)'),
      image('html', 'data:text/html,<b>x</b>'),
      image('sdfile-vacio', 'sdfile://'),
      { id: 'video', type: 'video', props: { url: 'https://example.com/v.mp4' } },
      image('ok', 'http://example.com/b.png'),
    ];
    expect(collectCarrete(page).map((i) => i.blockId)).toEqual(['ok']);
    expect(carreteSourceOf(undefined)).toBeNull();
    expect(carreteSourceOf('blob:https://x/1')).toBeNull();
  });

  it('empieza por la que se tocó; -1 si no está', () => {
    const items = collectCarrete([image('a', MEDIA_A), image('b', MEDIA_B), image('c', 'https://x.test/c.jpg')]);
    expect(startIndex(items, 'b')).toBe(1);
    expect(startIndex(items, 'zzz')).toBe(-1);
    expect(startIndex(items, null)).toBe(-1);
  });

  it('un nombre para bajar el archivo aunque el bloque no traiga uno', () => {
    const [named, file, web, data, bare] = collectCarrete([
      image('a', MEDIA_A, { name: ' IMG_1.HEIC ' }),
      image('b', 'sdfile://page/7c9e.jpg'),
      image('c', 'https://example.com/fotos/Plano%2012.jpg?size=big#x'),
      image('d', 'data:image/jpeg;base64,AAAA'),
      image('e', MEDIA_B),
    ]);
    expect(fallbackName(named)).toBe('IMG_1.HEIC');
    expect(fallbackName(file)).toBe('7c9e.jpg');
    expect(fallbackName(web)).toBe('Plano 12.jpg');
    expect(fallbackName(data)).toBe('image.jpg');
    expect(fallbackName(bare)).toBe('image.jpg');
  });
});

describe('carrete: navegación', () => {
  it('anterior y siguiente se quedan en los extremos', () => {
    expect(stepIndex(0, -1, 5)).toBe(0);
    expect(stepIndex(0, 1, 5)).toBe(1);
    expect(stepIndex(4, 1, 5)).toBe(4);
    expect(stepIndex(2, -10, 5)).toBe(0);
    expect(stepIndex(2, 10, 5)).toBe(4);
    expect(stepIndex(0, 1, 1)).toBe(0);
    expect(stepIndex(3, 0, 0)).toBe(0);
    // Un comienzo fuera de rango (la página cambió) se acomoda.
    expect(stepIndex(9, 0, 3)).toBe(2);
  });

  it('el contador empieza en 1', () => {
    expect(counterText(0, 12)).toBe('1 / 12');
    expect(counterText(2, 12)).toBe('3 / 12');
    expect(counterText(11, 12)).toBe('12 / 12');
  });

  it('precarga solo los dos vecinos, el siguiente primero', () => {
    expect(neighbors(0, 1)).toEqual([]);
    expect(neighbors(0, 5)).toEqual([1]);
    expect(neighbors(2, 5)).toEqual([3, 1]);
    expect(neighbors(4, 5)).toEqual([3]);
  });
});

describe('carrete: zoom', () => {
  const stage = { width: 400, height: 800 };
  const fit = fitSize({ width: 4032, height: 3024 }, stage); // foto horizontal en un teléfono vertical

  it('la foto entra entera en el escenario', () => {
    expect(fit).toEqual({ width: 400, height: 300 });
    expect(fitSize({ width: 1080, height: 1920 }, stage)).toEqual({ width: 450 * (400 / 450), height: 800 });
    expect(fitSize({ width: 0, height: 0 }, stage)).toEqual({ width: 0, height: 0 });
  });

  it('ampliar deja quieto el punto bajo el cursor o los dedos', () => {
    const at = { x: 100, y: 50 };
    const z = zoomAt(NO_ZOOM, 2, at, fit, stage);
    expect(z.scale).toBe(2);
    // El punto de la foto que estaba en `at` (100, 50 desde el centro) sigue ahí: x + s·c = at.
    expect(z.x + 2 * 100).toBeCloseTo(100);
    expect(z.y + 2 * 50).toBeCloseTo(50);
    expect(isZoomed(z)).toBe(true);
  });

  it('no se achica más que la foto entera ni se amplía más del tope', () => {
    expect(zoomAt({ scale: 2, x: 50, y: 10 }, 0.5, { x: 0, y: 0 }, fit, stage)).toEqual(NO_ZOOM);
    expect(zoomAt(NO_ZOOM, 50, { x: 0, y: 0 }, fit, stage).scale).toBe(MAX_SCALE);
  });

  it('arrastrar la foto ampliada no deja pasar sus bordes', () => {
    const z: Zoom = { scale: 2, x: 0, y: 0 };
    // Ampliada, mide 800 × 600: se puede mover 200 de costado y nada para arriba o abajo (entra en 800).
    expect(panBy(z, 1000, 1000, fit, stage)).toEqual({ scale: 2, x: 200, y: 0 });
    expect(panBy(z, -1000, -50, fit, stage)).toEqual({ scale: 2, x: -200, y: 0 });
    expect(clampZoom({ scale: 4, x: 0, y: 999 }, fit, stage)).toEqual({ scale: 4, x: 0, y: 200 });
  });

  it('doble toque: amplía donde se tocó; otro doble toque vuelve a la foto entera', () => {
    const z = toggleZoom(NO_ZOOM, { x: -80, y: 0 }, fit, stage);
    expect(z.scale).toBe(2.5);
    expect(z.x).toBeCloseTo(-80 - 2.5 * -80);
    expect(toggleZoom(z, { x: 0, y: 0 }, fit, stage)).toEqual(NO_ZOOM);
  });

  it('la rueda amplía hacia arriba y achica hacia abajo; el pellizco del trackpad (Ctrl) es más fino', () => {
    const up = wheelScale(NO_ZOOM, -100, 0, false);
    expect(up).toBeGreaterThan(1);
    expect(wheelScale({ scale: 2, x: 0, y: 0 }, 100, 0, false)).toBeLessThan(2);
    expect(wheelScale(NO_ZOOM, 100, 0, false)).toBe(1);
    // Una línea (Firefox) cuenta como unos 16 px.
    expect(wheelScale(NO_ZOOM, -3, 1, false)).toBeCloseTo(wheelScale(NO_ZOOM, -48, 0, false));
    expect(wheelScale(NO_ZOOM, -10, 0, true)).toBeGreaterThan(wheelScale(NO_ZOOM, -10, 0, false));
    // Un salto enorme no pasa del tope.
    expect(wheelScale(NO_ZOOM, -100000, 0, true)).toBe(MAX_SCALE);
  });

  it('pellizco: la escala sigue a los dedos y el punto entre ellos los acompaña', () => {
    const mid = { x: 40, y: 20 };
    const z = pinchZoom(NO_ZOOM, 100, mid, 200, mid, fit, stage);
    expect(z.scale).toBe(2);
    expect(z.x + 2 * 40).toBeCloseTo(40);
    // Mover los dos dedos mueve la foto.
    const moved = pinchZoom(NO_ZOOM, 100, mid, 200, { x: 60, y: 20 }, fit, stage);
    expect(moved.x - z.x).toBeCloseTo(20);
    // Juntarlos más que al empezar no achica de más.
    expect(pinchZoom(NO_ZOOM, 100, mid, 30, mid, fit, stage)).toEqual(NO_ZOOM);
    expect(pinchZoom(NO_ZOOM, 0, mid, 30, mid, fit, stage)).toEqual(NO_ZOOM);
  });
});

describe('carrete: gestos', () => {
  it('un toque sigue siendo un toque hasta que se mueve un poco', () => {
    expect(classifyDrag(3, 4, false)).toBe('none');
    expect(classifyDrag(-40, 8, false)).toBe('swipe');
    expect(classifyDrag(5, 60, false)).toBe('dismiss');
    // Hacia arriba no hace nada.
    expect(classifyDrag(5, -60, false)).toBe('none');
  });

  it('con la foto ampliada, arrastrar mueve la foto y nunca cambia de elemento ni cierra', () => {
    expect(classifyDrag(-200, 0, true)).toBe('pan');
    expect(classifyDrag(0, 300, true)).toBe('pan');
  });

  it('al soltar: cambia si se deslizó lejos o rápido, y no pasa de los extremos', () => {
    expect(swipeResult(-150, 0, 400, 2, 5)).toBe(1);
    expect(swipeResult(150, 0, 400, 2, 5)).toBe(-1);
    expect(swipeResult(-40, 0, 400, 2, 5)).toBe(0);
    expect(swipeResult(-40, -0.8, 400, 2, 5)).toBe(1);
    expect(swipeResult(-15, -2, 400, 2, 5)).toBe(0);
    expect(swipeResult(150, 0, 400, 0, 5)).toBe(0);
    expect(swipeResult(-150, 0, 400, 4, 5)).toBe(0);
  });

  it('en los extremos el deslizamiento se resiste', () => {
    expect(resistEdges(100, 0, 3)).toBe(30);
    expect(resistEdges(-100, 0, 3)).toBe(-100);
    expect(resistEdges(-100, 2, 3)).toBe(-30);
    expect(resistEdges(100, 1, 3)).toBe(100);
  });

  it('deslizar hacia abajo cierra si bajó bastante o rápido', () => {
    expect(dismissResult(200, 0, 800)).toBe(true);
    expect(dismissResult(60, 0, 800)).toBe(false);
    expect(dismissResult(60, 0.9, 800)).toBe(true);
    expect(dismissResult(20, 2, 800)).toBe(false);
  });

  it('doble toque: dos toques cerca y seguidos', () => {
    const first = { at: 1000, x: 10, y: 10 };
    expect(isDoubleTap(null, first)).toBe(false);
    expect(isDoubleTap(first, { at: 1200, x: 20, y: 15 })).toBe(true);
    expect(isDoubleTap(first, { at: 1400, x: 10, y: 10 })).toBe(false);
    expect(isDoubleTap(first, { at: 1100, x: 90, y: 10 })).toBe(false);
  });
});

describe('carrete: avisos', () => {
  const base = { kind: 'image' as const, preview: 'blob:x', error: null };

  it('sin red: la miniatura y cuándo llega lo grande', () => {
    expect(noticeFor({ ...base, state: 'offline' }, 'a.jpg')).toMatch(/offline: this is the thumbnail/);
    expect(noticeFor({ ...base, kind: 'video', state: 'offline' }, 'a.mov')).toMatch(/video plays when you're back online/);
    expect(noticeFor({ kind: null, preview: null, error: null, state: 'offline' }, 'a')).toMatch(/isn't on this device/);
  });

  it('lo que el navegador no puede abrir', () => {
    expect(noticeFor({ ...base, kind: 'video', state: 'unsupported' }, 'IMG_0666.MOV')).toBe("This video can't be played in this browser.");
    expect(noticeFor({ ...base, state: 'unsupported' }, 'IMG_1234.HEIC')).toMatch(/format/);
    expect(noticeFor({ ...base, state: 'failed', error: 'This file has not finished uploading yet.' }, 'a.jpg')).toBe(
      "The full photo couldn't be loaded: This file has not finished uploading yet.",
    );
  });

  it('nada cuando todo anda', () => {
    expect(noticeFor({ ...base, state: 'ready' }, 'a.jpg')).toBeNull();
    expect(noticeFor({ ...base, state: 'loading' }, 'a.jpg')).toBeNull();
  });
});
