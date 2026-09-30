// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadsAllowed, porteroDownload, SHARP_CONCURRENCY, sharpenImages, wantsSharper, type SharpMedia } from './sharpImages';

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

function fakeMedia(views: Record<string, string | null> = {}) {
  const ready = new Map<string, string>();
  const media = {
    isThumbUrl: (id: string, src: string) => src === `blob:thumb-${short(id)}`,
    viewUrl: (id: string) => ready.get(short(id)) ?? null,
    view: vi.fn(async (full: string, _options?: unknown) => {
      const id = short(full);
      const url = id in views ? views[id] : `blob:view-${id}`;
      if (url) ready.set(id, url);
      return url;
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

  it('una foto que llega después (pegada, o de otro dispositivo) también', async () => {
    const root = page();
    const media = fakeMedia();
    start(root, media, 900, 1);
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
      return `blob:view-${id}`;
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
    expect(media.view.mock.calls[0]).toEqual([uid('a'), { download: undefined }]);
  });

  it('después de dejar de mirar la página, no cambia nada más', async () => {
    const img = block('a', '1040px');
    let release: () => void = () => undefined;
    const media = fakeMedia();
    media.view.mockImplementation(async () => {
      await new Promise<void>((r) => (release = r));
      return 'blob:view-a';
    });
    const stop = start(page(img), media, 1040, 1);
    await flush();
    stop();
    release();
    await flush();
    expect(img.getAttribute('src')).toBe('blob:thumb-a');
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

  it('otro error del portero no se reintenta', async () => {
    const media = { pass: vi.fn(async () => 'https://portero.test/m/x') };
    const download = porteroDownload(media, async () => new Response('', { status: 500 }));
    await expect(download('a')).rejects.toThrow(/500/);
    expect(media.pass).toHaveBeenCalledTimes(1);
  });
});
