// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SharpView } from '../media/queue';
import { downloadsAllowed, photoUrlOf, porteroDownload, SHARP_CONCURRENCY, sharpenImages, sharpSide, wantsSharper, type SharpMedia } from './sharpImages';

// Fotos nítidas en la página (Docs/Doc_Imagenes.md, "Calidad en la página"): cuándo se pide la imagen
// nítida, cómo reemplaza a la miniatura sin cambiar el tamaño de la foto, y que no se pierde cuando BlockNote
// vuelve a poner la miniatura.

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Los ids de los archivos son uuid: `a` → `0000000a-…`. */
const uid = (id: string) => `${id.padStart(8, '0')}-0000-4000-8000-000000000000`;

/** Un bloque `image` como lo dibuja BlockNote, con la miniatura (`blob:thumb-<id>`) ya cargada. */
function block(id: string, wrapperWidth = 'fit-content', natural = 480): HTMLImageElement {
  const outer = document.createElement('div');
  outer.className = 'bn-block-outer';
  outer.innerHTML = `<div class="bn-block"><div class="bn-block-content" data-content-type="image" data-url="sdmedia://${uid(id)}">
    <div class="bn-file-block-content-wrapper" style="width: ${wrapperWidth};"><div class="bn-visual-media-wrapper">
    <img class="bn-visual-media" src="blob:thumb-${id}"></div></div></div></div>`;
  const img = outer.querySelector('img')!;
  Object.defineProperty(img, 'complete', { value: true, configurable: true });
  Object.defineProperty(img, 'naturalWidth', { value: natural, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: Math.round((natural * 2) / 3), configurable: true });
  return img;
}

/**
 * Un párrafo con una foto en línea como la dibuja inlinePhoto.ts (con la miniatura ya cargada), y al lado el
 * `<img>` de ancho 0 que pone ProseMirror junto a un nodo en línea (no es una foto: no se toca).
 */
function inlinePhoto(id: string, natural = 480): HTMLImageElement {
  const outer = document.createElement('div');
  outer.className = 'bn-block-outer';
  outer.innerHTML = `<div class="bn-block"><div class="bn-block-content" data-content-type="paragraph"><p class="bn-inline-content">texto
    <span class="sd-photo" contenteditable="false" data-inline-content-type="photo" data-url="sdmedia://${uid(id)}" data-name="${id}.jpg" data-w="0"><img class="bn-visual-media" src="blob:thumb-${id}"></span><img class="ProseMirror-separator"><br class="ProseMirror-trailingBreak"></p></div></div>`;
  const img = outer.querySelector<HTMLImageElement>('.sd-photo > img')!;
  Object.defineProperty(img, 'complete', { value: true, configurable: true });
  Object.defineProperty(img, 'naturalWidth', { value: natural, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: Math.round((natural * 2) / 3), configurable: true });
  return img;
}

function page(...imgs: HTMLImageElement[]): HTMLElement {
  const root = document.createElement('div');
  root.className = 'bn-editor';
  for (const img of imgs) root.append(img.closest('.bn-block-outer')!);
  document.body.append(root);
  return root;
}

const short = (id: string) => id.slice(0, 8).replace(/^0+/, '');

/** La cola de mentira: `blob:view-<id>` (2048) o `blob:view-<id>-1024`; `null` en `views` = sin nítida. */
function fakeMedia(views: Record<string, string | null> = {}) {
  const ready = new Map<string, SharpView>();
  const media = {
    views,
    isThumbUrl: (id: string, src: string) => src === `blob:thumb-${short(id)}`,
    viewOf: (id: string) => ready.get(short(id)) ?? null,
    view: vi.fn(async (full: string, options?: { side?: number; download?: unknown; maxBytes?: number }): Promise<SharpView | null> => {
      const id = short(full);
      const side = options?.side ?? 2048;
      const base = id in views ? views[id] : `blob:view-${id}`;
      if (!base) return null;
      const view = { url: side === 2048 ? base : `${base}-${side}`, side };
      ready.set(id, view);
      return view;
    }),
  };
  return media as typeof media & SharpMedia;
}

function start(root: HTMLElement, media: SharpMedia, width: number | ((img: HTMLImageElement) => number), dpr = 1, extra = {}) {
  const stop = sharpenImages(root, media, {
    measure: typeof width === 'number' ? () => width : width,
    dpr: () => dpr,
    decode: async () => undefined,
    canDownload: () => true,
    ...extra,
  });
  cleanups.push(stop);
  return stop;
}

describe('cuándo hace falta algo más nítido que la miniatura', () => {
  it('con los números', () => {
    // A lo ancho de una hoja ancha: 1100 px de pantalla con una miniatura de 480.
    expect(wantsSharper(1100, 1, 480)).toBe(true);
    // Del tamaño de la miniatura en una pantalla común: se ve perfecta.
    expect(wantsSharper(480, 1, 480)).toBe(false);
    // La misma en una pantalla de alta densidad (Mac, iPhone): necesita el doble.
    expect(wantsSharper(480, 2, 480)).toBe(true);
    // Un teléfono de 3x con la foto a 300 px: como mucho 2x (600 > 576).
    expect(wantsSharper(300, 3, 480)).toBe(true);
    // Una foto chica en una fila de cuatro: alcanza la miniatura.
    expect(wantsSharper(240, 2, 480)).toBe(false);
    expect(wantsSharper(0, 2, 480)).toBe(false);
    expect(wantsSharper(1100, 2, 0)).toBe(false);
  });

  it('bajar del portero, solo con red y sin ahorro de datos ni conexión lenta', () => {
    const nav = (extra: object) => ({ onLine: true, ...extra }) as unknown as Navigator;
    expect(downloadsAllowed(nav({}))).toBe(true);
    expect(downloadsAllowed(nav({ connection: { effectiveType: '4g' } }))).toBe(true);
    expect(downloadsAllowed(nav({ onLine: false }))).toBe(false);
    expect(downloadsAllowed(nav({ connection: { saveData: true } }))).toBe(false);
    expect(downloadsAllowed(nav({ connection: { effectiveType: '3g' } }))).toBe(false);
    expect(downloadsAllowed(null)).toBe(false);
  });

  it('la chica (1024) para una foto que se dibuja a 900 px del dispositivo o menos', () => {
    expect(sharpSide(360, 2)).toBe(1024);
    expect(sharpSide(900, 1)).toBe(1024);
    expect(sharpSide(480, 2)).toBe(2048);
    expect(sharpSide(1100, 1)).toBe(2048);
  });
});

describe('cambiar la miniatura por la imagen nítida', () => {
  it('una foto sin ancho propio en una pantalla 2x: la nítida, con el ancho de la miniatura de tope', async () => {
    const img = block('a');
    const media = fakeMedia();
    start(page(img), media, 480, 2);
    await vi.waitFor(() => expect(img.getAttribute('src')).toBe('blob:view-a'));
    expect(img.dataset.sdSharp).toBe('480');
    expect(img.style.getPropertyValue('--sd-thumb-w')).toBe('480px');
  });

  it('del tamaño de la miniatura en una pantalla común no pide nada', async () => {
    const img = block('a');
    const media = fakeMedia();
    start(page(img), media, 480, 1);
    await flush();
    expect(media.view).not.toHaveBeenCalled();
    expect(img.getAttribute('src')).toBe('blob:thumb-a');
  });

  it('una foto de otro proyecto, un ícono o un borrado (no es la miniatura) no se toca', async () => {
    const img = block('a');
    img.src = 'data:image/svg+xml,placeholder';
    const media = fakeMedia();
    start(page(img), media, 1100, 1);
    await flush();
    expect(media.view).not.toHaveBeenCalled();
  });

  it('sin imagen nítida (video, HEIC, sin red) queda la miniatura', async () => {
    const img = block('a');
    const media = fakeMedia({ a: null });
    start(page(img), media, 1100, 1);
    await vi.waitFor(() => expect(media.view).toHaveBeenCalledTimes(1));
    await flush();
    expect(img.getAttribute('src')).toBe('blob:thumb-a');
    expect(img.dataset.sdSharp).toBeUndefined();
  });

  it('si BlockNote vuelve a poner la miniatura, se cambia en el acto (sin volver a pedirla)', async () => {
    const img = block('a', '1040px');
    const media = fakeMedia();
    start(page(img), media, 1040, 1);
    await vi.waitFor(() => expect(img.getAttribute('src')).toBe('blob:view-a'));
    img.src = 'blob:thumb-a';
    await vi.waitFor(() => expect(img.getAttribute('src')).toBe('blob:view-a'));
    expect(media.view).toHaveBeenCalledTimes(1);
  });

  it('si la foto pasa a mostrar otra cosa (se borró, se reemplazó), pierde el tope', async () => {
    const img = block('a');
    const media = fakeMedia();
    start(page(img), media, 480, 2);
    await vi.waitFor(() => expect(img.dataset.sdSharp).toBe('480'));
    img.src = 'data:image/svg+xml,deleted';
    await vi.waitFor(() => expect(img.dataset.sdSharp).toBeUndefined());
    expect(img.style.getPropertyValue('--sd-thumb-w')).toBe('');
  });

  it('una foto en línea (Docs/Doc_Fotos_En_Linea.md): la misma nítida, con el tope de su miniatura; el separador de ProseMirror no se toca', async () => {
    const img = inlinePhoto('a');
    const media = fakeMedia();
    const root = page(img);
    start(root, media, 480, 2);
    await vi.waitFor(() => expect(img.getAttribute('src')).toBe('blob:view-a'));
    expect(img.dataset.sdSharp).toBe('480');
    expect(img.style.getPropertyValue('--sd-thumb-w')).toBe('480px');
    const separator = root.querySelector<HTMLImageElement>('img.ProseMirror-separator')!;
    expect(separator.getAttribute('src')).toBeNull();
    expect(photoUrlOf(img)).toBe(`sdmedia://${uid('a')}`);
    expect(photoUrlOf(separator)).toBeNull();
    // La foto-bloque y la en línea del mismo archivo: una sola nítida para las dos.
    const other = block('a', '1040px');
    root.append(other.closest('.bn-block-outer')!);
    await vi.waitFor(() => expect(other.getAttribute('src')).toBe('blob:view-a'));
    expect(media.view).toHaveBeenCalledTimes(1);
  });

  it('una foto en línea a la que le cambian la dirección (se reemplazó el archivo): pierde las marcas de la otra', async () => {
    const img = inlinePhoto('a');
    const media = fakeMedia();
    start(page(img), media, 480, 2);
    await vi.waitFor(() => expect(img.dataset.sdSharpId).toBe(uid('a')));
    img.parentElement!.setAttribute('data-url', `sdmedia://${uid('b')}`);
    img.src = 'blob:thumb-b';
    await vi.waitFor(() => expect(img.getAttribute('src')).toBe('blob:view-b'));
    expect(img.dataset.sdSharpId).toBe(uid('b'));
  });

  it('una foto que llega después (pegada, o de otro dispositivo) también', async () => {
    const root = page();
    const media = fakeMedia();
    start(root, media, 1000, 1);
    const img = block('b');
    root.append(img.closest('.bn-block-outer')!);
    await vi.waitFor(() => expect(img.getAttribute('src')).toBe('blob:view-b'));
  });

  it('dos bloques con el mismo archivo: una sola imagen nítida para los dos', async () => {
    const one = block('a', '1040px');
    const two = block('a', '520px');
    const media = fakeMedia();
    start(page(one, two), media, 1040, 1);
    await vi.waitFor(() => expect(one.getAttribute('src')).toBe('blob:view-a'));
    expect(two.getAttribute('src')).toBe('blob:view-a');
    expect(media.view).toHaveBeenCalledTimes(1);
  });

  it('de a pocas a la vez: muchas fotos no piden todo junto', async () => {
    const imgs = ['a', 'b', 'c', 'd', 'e'].map((id) => block(id, '1040px'));
    const releases: (() => void)[] = [];
    let inFlight = 0;
    let most = 0;
    const media = fakeMedia();
    media.view.mockImplementation(async (full: string) => {
      const id = short(full);
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise<void>((r) => releases.push(r));
      inFlight--;
      return { url: `blob:view-${id}`, side: 2048 };
    });
    start(page(...imgs), media, 1040, 1);
    await flush();
    expect(media.view).toHaveBeenCalledTimes(SHARP_CONCURRENCY);
    while (releases.length > 0) {
      releases.shift()!();
      await flush();
      await flush();
    }
    await vi.waitFor(() => expect(media.view).toHaveBeenCalledTimes(5));
    expect(most).toBe(SHARP_CONCURRENCY);
  });

  it('bajar del portero solo si en ese momento se puede', async () => {
    const img = block('a', '1040px');
    const media = fakeMedia();
    const download = vi.fn();
    start(page(img), media, 1040, 1, { download, canDownload: () => false });
    await vi.waitFor(() => expect(media.view).toHaveBeenCalled());
    expect(media.view.mock.calls[0][0]).toBe(uid('a'));
    expect(media.view.mock.calls[0][1]).toMatchObject({ download: undefined, side: 2048 });
  });

  it('después de dejar de mirar la página, no cambia nada más', async () => {
    const img = block('a', '1040px');
    let release: () => void = () => undefined;
    const media = fakeMedia();
    media.view.mockImplementation(async () => {
      await new Promise<void>((r) => (release = r));
      return { url: 'blob:view-a', side: 2048 };
    });
    const stop = start(page(img), media, 1040, 1);
    await flush();
    stop();
    release();
    await flush();
    expect(img.getAttribute('src')).toBe('blob:thumb-a');
  });
});

/** `IntersectionObserver` y `ResizeObserver` de mentira (jsdom no los tiene): se disparan a mano. */
function fakeObservers() {
  const io: { cb: IntersectionObserverCallback; seen: Set<Element> }[] = [];
  const ro: { cb: ResizeObserverCallback; seen: Set<Element> }[] = [];
  class IO {
    seen = new Set<Element>();
    constructor(cb: IntersectionObserverCallback) {
      io.push({ cb, seen: this.seen });
    }
    observe(el: Element) { this.seen.add(el); }
    unobserve(el: Element) { this.seen.delete(el); }
    disconnect() { this.seen.clear(); }
  }
  class RO {
    seen = new Set<Element>();
    constructor(cb: ResizeObserverCallback) {
      ro.push({ cb, seen: this.seen });
    }
    observe(el: Element) { this.seen.add(el); }
    unobserve(el: Element) { this.seen.delete(el); }
    disconnect() { this.seen.clear(); }
  }
  vi.stubGlobal('IntersectionObserver', IO);
  vi.stubGlobal('ResizeObserver', RO);
  cleanups.push(() => vi.unstubAllGlobals());
  return {
    show(img: Element, isIntersecting = true) {
      for (const o of io) if (o.seen.has(img)) o.cb([{ target: img, isIntersecting } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
    },
    resize(img: Element) {
      for (const o of ro) if (o.seen.has(img)) o.cb([{ target: img } as unknown as ResizeObserverEntry], {} as ResizeObserver);
    },
  };
}

describe('correcciones de la auditoría', () => {
  it('se reemplaza el archivo del bloque: la foto nueva no se queda con el tope de la anterior', async () => {
    const img = block('a');
    const media = fakeMedia();
    const root = page(img);
    // La nueva todavía no tiene nítida (queda pendiente).
    start(root, media, 480, 2);
    await vi.waitFor(() => expect(img.dataset.sdSharpId).toBe(uid('a')));
    media.view.mockImplementation(() => new Promise(() => undefined));
    img.closest('[data-content-type]')!.setAttribute('data-url', `sdmedia://${uid('b')}`);
    img.src = 'blob:thumb-b';
    await vi.waitFor(() => expect(img.dataset.sdSharp).toBeUndefined());
    expect(img.dataset.sdSharpId).toBeUndefined();
    expect(img.style.getPropertyValue('--sd-thumb-w')).toBe('');
  });

  it('solo lo que sigue a la vista, lo último que se vio primero; lo que se pasó de largo se descarta', async () => {
    const obs = fakeObservers();
    const imgs = ['a', 'b', 'c', 'd'].map((id) => block(id, '1040px'));
    const media = fakeMedia();
    const releases: (() => void)[] = [];
    media.view.mockImplementation(async (full: string) => {
      await new Promise<void>((r) => releases.push(r));
      return { url: `blob:view-${short(full)}`, side: 2048 };
    });
    start(page(...imgs), media, 1040, 1);
    await flush();
    expect(media.view).not.toHaveBeenCalled();
    for (const img of imgs) obs.show(img);
    await flush();
    expect(media.view.mock.calls.map((c) => short(c[0]))).toEqual(['a', 'b']);
    // `c` se pasó de largo mientras esperaba.
    obs.show(imgs[2], false);
    releases.shift()!();
    await vi.waitFor(() => expect(media.view).toHaveBeenCalledTimes(3));
    expect(short(media.view.mock.calls[2][0])).toBe('d');
    releases.splice(0).forEach((r) => r());
    await flush();
    await flush();
    expect(media.view.mock.calls.map((c) => short(c[0]))).not.toContain('c');
  });

  it('una foto que se agranda a la vista (tamaños, tirador, filas) pasa de la chica a la grande', async () => {
    const obs = fakeObservers();
    const img = block('a', '400px');
    let width = 400;
    const media = fakeMedia();
    start(page(img), media, () => width, 2);
    obs.show(img);
    await vi.waitFor(() => expect(img.getAttribute('src')).toBe('blob:view-a-1024'));
    expect(img.dataset.sdSide).toBe('1024');
    width = 1040;
    obs.resize(img);
    await vi.waitFor(() => expect(img.getAttribute('src')).toBe('blob:view-a'));
    expect(img.dataset.sdSide).toBe('2048');
    // Achicarla de nuevo no pide nada (la grande sirve).
    width = 300;
    obs.resize(img);
    await flush();
    expect(media.view).toHaveBeenCalledTimes(2);
  });

  it('al volver la red se vuelve a probar lo que está a la vista', async () => {
    const img = block('a', '1040px');
    const media = fakeMedia({ a: null });
    start(page(img), media, 1040, 1);
    await vi.waitFor(() => expect(media.view).toHaveBeenCalledTimes(1));
    await flush();
    media.views.a = 'blob:view-a';
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(img.getAttribute('src')).toBe('blob:view-a'));
  });

  it('las medidas de la miniatura quedan en la imagen (impresión y "Acomodar" iguales en todos lados)', async () => {
    const img = block('a', '1040px');
    const media = fakeMedia();
    start(page(img), media, 1040, 1);
    await vi.waitFor(() => expect(img.getAttribute('src')).toBe('blob:view-a'));
    expect(img.dataset.sdSharp).toBe('480');
    expect(img.dataset.sdSharpH).toBe('320');
    const { thumbSize } = await import('./sharpMarks');
    Object.defineProperty(img, 'naturalWidth', { value: 2048 });
    Object.defineProperty(img, 'naturalHeight', { value: 1370 });
    expect(thumbSize(img)).toEqual({ width: 480, height: 320 });
  });
});

describe('bajar el original con un pase del portero', () => {
  it('reusa el pase y, si venció, pide uno nuevo una sola vez', async () => {
    let n = 0;
    const media = { pass: vi.fn(async () => `https://portero.test/m/pase-${++n}`) };
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('pase-1') ? new Response('vencido', { status: 410 }) : new Response('foto', { headers: { 'Content-Type': 'image/jpeg' } }),
    );
    const download = porteroDownload(media, fetchImpl);
    const blob = await download('a');
    expect(await blob.text()).toBe('foto');
    expect(media.pass).toHaveBeenCalledTimes(2);
    // El pase bueno queda para la próxima.
    await download('a');
    expect(media.pass).toHaveBeenCalledTimes(2);
  });

  it('un portero que no deja leer (CORS, anterior a v0.059): tras tres fallas seguidas, media hora sin bajar', async () => {
    let t = 0;
    const media = { pass: vi.fn(async (id: string) => `https://portero.test/m/${id}`) };
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const download = porteroDownload(media, fetchImpl, () => t, () => true);
    for (const id of ['a', 'b', 'c']) await expect(download(id)).rejects.toThrow(/fetch/);
    await expect(download('d')).rejects.toThrow(/paused/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    t += 30 * 60_000 + 1;
    await expect(download('d')).rejects.toThrow(/fetch/);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('sin red, las fallas no cuentan para la pausa', async () => {
    const media = { pass: vi.fn(async (id: string) => `https://portero.test/m/${id}`) };
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const download = porteroDownload(media, fetchImpl, () => 0, () => false);
    for (const id of ['a', 'b', 'c', 'd']) await expect(download(id)).rejects.toThrow(/fetch/);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('otro error del portero no se reintenta', async () => {
    const media = { pass: vi.fn(async () => 'https://portero.test/m/x') };
    const download = porteroDownload(media, async () => new Response('', { status: 500 }));
    await expect(download('a')).rejects.toThrow(/500/);
    expect(media.pass).toHaveBeenCalledTimes(1);
  });
});
