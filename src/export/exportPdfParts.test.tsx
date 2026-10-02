// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { ExportDialog } from '../ui/ExportDialog';
import { appComments } from './exportComments';
import { ExportEditor } from './exportEditor';
import { deviceImages, jpegInfo, PhotoLimitError, PixelBudget, shrinkImages, type ImageSource, type Resizer } from './exportImages';
import { exportPlan } from './exportPages';
import { anchorId, buildPdf, deviceLimits, PDF_LIMITS, SMALL_DESKTOP, type BuildOptions, type PdfLimits } from './exportPdf';
import { writeBlocks } from './testProject';

// Exportar, entrega 1b (Docs/Doc_Exportar.md, "Cómo quedó la entrega 1b"; D84, D85 y D88 cambiadas por Lega el
// 2026-10-02): las fotos en resolución completa (el original tal cual o pasado a JPEG del mismo tamaño), el PDF en
// partes por páginas enteras cuando no entra en uno, y la lista de las páginas que fallaron con *Export again*. Sin el
// navegador (jsdom no mide ni carga imágenes): el tamaño de cada foto en la hoja se fija a mano y el achicador es falso.
// La memoria y el tiempo con originales de verdad, en Chromium (informe de la entrega).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as never;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

const devices: Device[] = [];
const editors: ExportEditor[] = [];
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const e of editors.splice(0)) e.destroy();
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  document.body.replaceChildren();
  document.head.querySelectorAll('style[data-sd-export]').forEach((s) => s.remove());
  document.documentElement.classList.remove('sd-printing', 'sd-export-printing');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// --- Un JPEG de mentira: solo la cabecera (lo que lee `jpegInfo`) y relleno hasta el peso pedido. -----------------

function jpeg(width: number, height: number, options: { orientation?: number; little?: boolean; components?: number; size?: number } = {}): Uint8Array {
  const out: number[] = [0xff, 0xd8];
  if (options.orientation) {
    const le = !!options.little;
    const u16 = (n: number) => (le ? [n & 255, n >> 8] : [n >> 8, n & 255]);
    const u32 = (n: number) => (le ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24] : [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
    // Dos entradas: una cualquiera (la marca) y la orientación, para que no sea la primera.
    const tiff = [...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8), ...u16(2), ...u16(0x010f), ...u16(2), ...u32(4), 0x41, 0x42, 0x43, 0, ...u16(0x0112), ...u16(3), ...u32(1), ...u16(options.orientation), 0, 0, ...u32(0)];
    const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    out.push(0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255, ...body);
  }
  const comps = options.components ?? 3;
  const sof = [8, height >> 8, height & 255, width >> 8, width & 255, comps, ...Array.from({ length: comps }, (_, i) => [i + 1, 0x11, 0]).flat()];
  out.push(0xff, 0xc0, (sof.length + 2) >> 8, (sof.length + 2) & 255, ...sof);
  out.push(0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0);
  const bytes = new Uint8Array(Math.max(out.length + 2, options.size ?? 0));
  bytes.set(out);
  bytes[bytes.length - 2] = 0xff;
  bytes[bytes.length - 1] = 0xd9;
  return bytes;
}

const jpegBlob = (width: number, height: number, options: Parameters<typeof jpeg>[2] = {}) =>
  new Blob([jpeg(width, height, options) as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' });

/** Un achicador falso: abre los JPEG de mentira (ya derechos, como `createImageBitmap`) y las `image/x-<a>x<b>`. */
function fakeResizer(): Resizer & { draws: [number, number][]; opened: string[] } {
  const r = {
    draws: [] as [number, number][],
    opened: [] as string[],
    async open(blob: Blob) {
      r.opened.push(blob.type);
      let width = 0;
      let height = 0;
      const m = /x-(\d+)x(\d+)/.exec(blob.type);
      if (m) [width, height] = [Number(m[1]), Number(m[2])];
      else if (blob.type === 'image/jpeg') {
        const info = jpegInfo(new Uint8Array(await blob.slice(0, 4096).arrayBuffer()));
        if (!info) return null;
        [width, height] = info.orientation >= 5 ? [info.height, info.width] : [info.width, info.height];
      } else return null;
      return {
        width,
        height,
        draw: async (w: number, h: number) => {
          r.draws.push([w, h]);
          return new Blob([jpeg(w, h, { size: 5000 }) as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' });
        },
        close: () => undefined,
      };
    },
  };
  return r;
}

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function viewWithPhotos(count: number, width = 300): HTMLElement {
  const root = document.createElement('div');
  for (let i = 0; i < count; i++) {
    const holder = document.createElement('div');
    holder.dataset.url = `sdmedia://${ID(i)}`;
    const img = document.createElement('img');
    img.className = 'bn-visual-media';
    img.src = `https://thumbs.test/${i}.jpg`;
    img.getBoundingClientRect = () => ({ width, height: width * 0.75 }) as DOMRect;
    holder.append(img);
    root.append(holder);
  }
  document.body.append(root);
  return root;
}

let urlSeq = 0;
function stubUrls() {
  const revoked: string[] = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test/${++urlSeq}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u: string) => void revoked.push(u));
  return revoked;
}

describe('exportar 1b: la cabecera de un JPEG', () => {
  it('lee las medidas, el giro de EXIF (los dos órdenes de bytes) y los canales, sin decodificar', () => {
    expect(jpegInfo(jpeg(4032, 3024))).toEqual({ width: 4032, height: 3024, orientation: 1, components: 3 });
    expect(jpegInfo(jpeg(4032, 3024, { orientation: 6 }))).toEqual({ width: 4032, height: 3024, orientation: 6, components: 3 });
    expect(jpegInfo(jpeg(4032, 3024, { orientation: 8, little: true }))?.orientation).toBe(8);
    expect(jpegInfo(jpeg(800, 600, { components: 4 }))?.components).toBe(4);
    // No es un JPEG, o le falta el tamaño.
    expect(jpegInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(jpegInfo(jpeg(10, 10).slice(0, 6))).toBeNull();
  });
});

describe('exportar 1b: las fotos en resolución completa (D85)', () => {
  it('un JPEG derecho entra tal cual (sin dibujarlo), y cuenta sus píxeles y su peso', async () => {
    stubUrls();
    const root = viewWithPhotos(2);
    const original = jpegBlob(4032, 3024, { size: 3_000_000 });
    const resizer = fakeResizer();
    const budget = new PixelBudget(PDF_LIMITS.desktop.fullPixels, PDF_LIMITS.desktop.bytes);
    const best = vi.fn(async () => null);
    const out = await shrinkImages(root, { source: { best, original: async () => original }, budget, resizer, full: true });
    expect(out.full).toBe(2);
    expect(out.lowRes).toBe(0);
    expect(resizer.draws).toEqual([]);
    expect(best).not.toHaveBeenCalled();
    expect(budget.used).toBe(2 * 4032 * 3024);
    expect(budget.bytes).toBe(2 * 3_000_000);
    for (const img of root.querySelectorAll('img')) expect(img.getAttribute('src')).toMatch(/^blob:test\//);
  });

  it('uno girado por EXIF (una foto vertical de teléfono) se pasa a JPEG del mismo tamaño, ya derecho', async () => {
    stubUrls();
    const root = viewWithPhotos(1);
    const resizer = fakeResizer();
    const budget = new PixelBudget(1e10, 1e10);
    const out = await shrinkImages(root, { source: { best: async () => null, original: async () => jpegBlob(4032, 3024, { orientation: 6, size: 2_000_000 }) }, budget, resizer, full: true });
    expect(out.full).toBe(1);
    // A su tamaño entero, girado (sin achicar).
    expect(resizer.draws).toEqual([[3024, 4032]]);
    expect(budget.used).toBe(4032 * 3024);
    // El peso que cuenta es el del JPEG nuevo.
    expect(budget.bytes).toBe(5000);
  });

  it('un HEIC que el navegador no abre pasa por el convertidor de la app; sin él, sale achicado y contado', async () => {
    stubUrls();
    const heic = new Blob(['heic'], { type: 'image/heic' });
    const resizer = fakeResizer();
    const convert = vi.fn(async () => jpegBlob(4032, 3024, { size: 4_000_000 }));
    const root = viewWithPhotos(1);
    const out = await shrinkImages(root, { source: { best: async () => null, original: async () => heic }, budget: new PixelBudget(1e10, 1e10), resizer, full: true, convertHeic: convert });
    expect(convert).toHaveBeenCalledTimes(1);
    expect(out.full).toBe(1);
    expect(resizer.draws).toEqual([]);

    const root2 = viewWithPhotos(1);
    const view = new Blob(['v'], { type: 'image/x-2048x1536' });
    const out2 = await shrinkImages(root2, { source: { best: async () => view, original: async () => heic }, budget: new PixelBudget(1e10, 1e10), resizer, full: true });
    expect(out2.full).toBe(0);
    expect(out2.lowRes).toBe(1);
    expect(out2.shrunk).toBe(1);
  });

  it('sin el original (sin red) sale la del dispositivo achicada y se cuenta; un video no cuenta', async () => {
    stubUrls();
    const root = viewWithPhotos(3);
    const resizer = fakeResizer();
    const out = await shrinkImages(root, {
      source: {
        best: async () => new Blob(['v'], { type: 'image/x-2048x1536' }),
        original: async () => null,
        isPhoto: async (id) => id !== ID(2),
      },
      budget: new PixelBudget(1e10, 1e10),
      resizer,
      full: true,
    });
    expect(out.full).toBe(0);
    expect(out.lowRes).toBe(2);
    expect(out.shrunk).toBe(3);
  });

  it('pasado el tope de peso corta, y deja cada foto como estaba y suelta lo suyo', async () => {
    const revoked = stubUrls();
    const root = viewWithPhotos(4);
    const before = [...root.querySelectorAll('img')].map((i) => i.getAttribute('src'));
    const budget = new PixelBudget(1e10, 7_000_000);
    await expect(
      shrinkImages(root, { source: { best: async () => null, original: async () => jpegBlob(4032, 3024, { size: 3_000_000 }) }, budget, resizer: fakeResizer(), full: true, parallel: 1 }),
    ).rejects.toBeInstanceOf(PhotoLimitError);
    expect([...root.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual(before);
    expect(root.querySelector('[data-sd-export-src]')).toBeNull();
    expect(revoked).toHaveLength(2);
  });

  it('el original de la cola: el del dispositivo, o bajado por el portero; nunca el de un video', async () => {
    const local = jpegBlob(100, 100);
    const remote = jpegBlob(200, 200);
    const media = {
      localImage: async () => null,
      view: async () => null,
      source: async (id: string) =>
        id === 'local'
          ? { kind: 'image' as const, name: 'a.jpg', original: local }
          : id === 'video'
            ? { kind: 'video' as const, name: 'b.mov', original: null }
            : { kind: 'image' as const, name: 'c.jpg', original: null },
    };
    const download = vi.fn(async () => remote);
    const images = deviceImages(media as never, { originals: download });
    expect(await images.original!('local')).toBe(local);
    expect(await images.original!('drive')).toBe(remote);
    expect(await images.original!('video')).toBeNull();
    expect(download).toHaveBeenCalledTimes(1);
    expect(images.originalsFetched()).toBe(1);
    expect(await images.isPhoto!('video')).toBe(false);
    // Sin red: no se baja nada.
    expect(await deviceImages(media as never, { originals: null }).original!('drive')).toBeNull();
  });

  it('los topes: por parte, con el peso; una computadora chica y el teléfono, más bajos', () => {
    expect(deviceLimits(false, 16)).toBe(PDF_LIMITS.desktop);
    expect(deviceLimits(false, 4)).toEqual({ ...PDF_LIMITS.desktop, ...SMALL_DESKTOP });
    expect(SMALL_DESKTOP.bytes).toBeLessThan(PDF_LIMITS.desktop.bytes);
    expect(PDF_LIMITS.touch.bytes).toBeLessThan(SMALL_DESKTOP.bytes);
    // Con originales manda el peso: el tope de píxeles es más alto que el de las fotos achicadas.
    expect(PDF_LIMITS.desktop.fullPixels).toBeGreaterThan(PDF_LIMITS.desktop.pixels);
  });
});

// --- El PDF en partes (D84) -------------------------------------------------------------------------------------

/** Un proyecto chico: `pages` páginas en una rama, cada una con `photos` fotos del Drive (direcciones `sdmedia://`). */
async function photoProject(pages: number, photos: number, server = new FakeServer()) {
  const device = await makeDevice(server);
  devices.push(device);
  const projectId = await device.tree.createProject('Película secreta');
  const root = await device.tree.create(null, 'Rodaje', projectId);
  const ids: string[] = [root];
  let n = 0;
  await writeBlocks(device.docs, root, [{ type: 'paragraph', content: 'Raíz' }]);
  for (let i = 1; i <= pages - 1; i++) {
    const id = await device.tree.create(root, `Día ${i}`, projectId);
    ids.push(id);
    const blocks = [
      { type: 'paragraph', content: [`Día ${i} · `, { type: 'link', href: `/p/${root}`, content: 'Volver a la raíz' }] },
      ...Array.from({ length: photos }, () => ({ type: 'image', props: { url: `sdmedia://${ID(++n)}`, name: `IMG_${n}.jpg` } })),
    ];
    await writeBlocks(device.docs, id, blocks as never);
  }
  return { device, projectId, root, ids };
}

/** Cada foto ocupa 300 px en la hoja (jsdom no mide). */
function photosHaveWidth() {
  const real = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLImageElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLImageElement) {
    return this.classList.contains('bn-visual-media') ? ({ width: 300, height: 225, top: 0, left: 0, right: 300, bottom: 225 } as DOMRect) : real.call(this);
  });
}

const original = (size = 3_000_000): ImageSource => ({ best: async () => null, original: async () => jpegBlob(4032, 3024, { size }), isPhoto: async () => true });

async function editor() {
  const e = await ExportEditor.create({ imageTimeoutMs: 0, copyTimeoutMs: 0 });
  editors.push(e);
  return e;
}

const limits = (over: Partial<PdfLimits>): PdfLimits => ({ ...PDF_LIMITS.desktop, ...over });

async function build(device: Device, plan: BuildOptions['plan'], extra: Partial<BuildOptions> = {}) {
  return buildPdf({ title: 'Rodaje', plan, source: device.docs, editor: await editor(), named: true, limits: PDF_LIMITS.desktop, resizer: fakeResizer(), photoLoadMs: 0, ...extra });
}

/** Arma todas las partes, una detrás de otra (como la ventana), y devuelve lo de cada una. */
async function allParts(device: Device, plan: BuildOptions['plan'], extra: Partial<BuildOptions>) {
  const parts: { from: number; to: number; part: number | null; ids: string[]; fileTitle: string; text: string; links: string[]; partLine: string | null }[] = [];
  let from = 0;
  for (let part = 1; from < plan.length && part < 50; part++) {
    const book = await build(device, plan, { ...extra, from, part });
    parts.push({
      from: book.from,
      to: book.to,
      part: book.part,
      ids: book.pages.map((p) => p.id),
      fileTitle: book.fileTitle,
      text: book.root.textContent ?? '',
      links: [...book.root.querySelectorAll('a[href^="#sd-x-"]')].map((a) => a.getAttribute('href')!),
      partLine: book.root.querySelector('.sd-export-index-part')?.textContent ?? null,
    });
    expect(book.to).toBeGreaterThan(from);
    from = book.to;
    book.destroy();
  }
  return parts;
}

describe('exportar 1b: el PDF en partes (D84)', () => {
  it('si entra todo, un solo PDF sin partes', async () => {
    stubUrls();
    photosHaveWidth();
    const { device, root } = await photoProject(4, 2);
    const plan = exportPlan(device.tree, 'page', root);
    const book = await build(device, plan, { images: original(), full: true });
    expect(book.part).toBeNull();
    expect([book.from, book.to, book.total]).toEqual([0, 4, 4]);
    expect(book.fileTitle).toMatch(/^Rodaje \d{4}-\d{2}-\d{2}$/);
    expect(book.root.querySelector('.sd-export-index-part')).toBeNull();
    expect(book.bytes).toBe(6 * 3_000_000);
    book.destroy();
  });

  it('pasado el peso, varias partes por páginas enteras, en orden, cada página una sola vez y con nombres claros', async () => {
    stubUrls();
    photosHaveWidth();
    const { device, root } = await photoProject(9, 2);
    const plan = exportPlan(device.tree, 'page', root);
    // Tres páginas de fotos (6 fotos de 3 MB) por parte: 20 MB de tope.
    const parts = await allParts(device, plan, { images: original(), full: true, limits: limits({ bytes: 20_000_000 }) });
    expect(parts.length).toBe(3);
    expect(parts.flatMap((p) => p.ids)).toEqual(plan.map((p) => p.id));
    expect(parts.map((p) => [p.from, p.to])).toEqual([
      [0, 4],
      [4, 7],
      [7, 9],
    ]);
    expect(parts.map((p) => p.part)).toEqual([1, 2, 3]);
    expect(parts.map((p) => p.fileTitle.replace(/ \d{4}-\d{2}-\d{2}/, ''))).toEqual(['Rodaje Part 1', 'Rodaje Part 2', 'Rodaje Part 3']);
    expect(parts[1].partLine).toBe('Part 2 · pages 5 to 7 of 9');
    // Cada parte lleva el título de la raíz; el link "Volver a la raíz" solo es link en la parte que la tiene.
    for (const p of parts) expect(p.text).toContain('Rodaje');
    expect(parts[0].links.filter((l) => l === `#${anchorId(root)}`).length).toBeGreaterThan(1);
    expect(parts[1].links).not.toContain(`#${anchorId(root)}`);
    expect(parts[1].text).toContain('Volver a la raíz');
    // Ningún link a una página de otra parte.
    for (const p of parts) for (const l of p.links) expect(['#sd-x-index', ...p.ids.map((id) => `#${anchorId(id)}`)]).toContain(l);
  });

  it('también por cantidad de páginas (el teléfono) y por píxeles con *Smaller file*', async () => {
    stubUrls();
    photosHaveWidth();
    const { device, root } = await photoProject(7, 2);
    const plan = exportPlan(device.tree, 'page', root);
    const byPages = await allParts(device, plan, { limits: limits({ pages: 3 }) });
    expect(byPages.map((p) => p.ids.length)).toEqual([3, 3, 1]);
    // Achicadas: 300 px a 200 ppp son 625 × 469; tres fotos por parte.
    const small = { best: async () => new Blob(['x'], { type: 'image/x-4032x3024' }) };
    const byPixels = await allParts(device, plan, { images: small, full: false, limits: limits({ pixels: 625 * 469 * 3 }) });
    expect(byPixels.flatMap((p) => p.ids)).toEqual(plan.map((p) => p.id));
    expect(byPixels.length).toBeGreaterThan(2);
  });

  it('una página que sola no entra en resolución completa sale con las fotos achicadas y avisada; si ni así, marcada', async () => {
    stubUrls();
    photosHaveWidth();
    const { device, root, ids } = await photoProject(3, 4);
    const plan = exportPlan(device.tree, 'page', root);
    const source: ImageSource = { ...original(), best: async () => new Blob(['x'], { type: 'image/x-4032x3024' }) };
    // La raíz (sin fotos) entra en la primera parte; la página de cuatro fotos de 3 MB no entra en 5 MB ni sola: empieza
    // la segunda parte, con las fotos achicadas.
    const first = await build(device, plan, { images: source, full: true, limits: limits({ bytes: 5_000_000 }) });
    expect([first.from, first.to]).toEqual([0, 1]);
    first.destroy();
    const book = await build(device, plan, { images: source, full: true, limits: limits({ bytes: 5_000_000 }), from: 1, part: 2 });
    const big = book.pages.find((p) => p.id === ids[1])!;
    expect(big.shrunkToFit).toBe(true);
    expect(big.failed).toBe(false);
    expect(book.root.querySelector(`#${anchorId(ids[1])} .sd-export-note`)?.textContent).toContain('too many photos for one PDF at full resolution');
    book.destroy();

    const tiny = await build(device, plan, { images: source, full: false, limits: limits({ pixels: 1000 }), from: 1, part: 2 });
    const marked = tiny.pages.find((p) => p.id === ids[1])!;
    expect(marked.failed).toBe(true);
    expect(marked.failReason).toBe('photos');
    expect(tiny.root.querySelector(`#${anchorId(ids[1])}`)?.textContent).toContain('too many photos for one PDF on this device');
    tiny.destroy();
  });

  it('los comentarios se bajan una sola vez para todas las partes', async () => {
    const server = new FakeServer();
    server.enableComments();
    const { device, root } = await photoProject(6, 0, server);
    const plan = exportPlan(device.tree, 'page', root);
    const refresh = vi.spyOn(device.comments, 'refresh');
    const source = appComments(device.comments, device.commentsDb, { id: device.remote.userId, email: 'x@test' });
    const parts = await allParts(device, plan, { comments: source, limits: limits({ pages: 2 }) });
    expect(parts).toHaveLength(3);
    expect(refresh).toHaveBeenCalledTimes(plan.length);
  });
});

// --- La ventana: partes y la lista de las que fallaron (D88) --------------------------------------------------------

function services(d: Device): Services {
  const config = { url: 'https://x.supabase.co', publishableKey: 'sb_publishable_test', name: 'Test', localKey: 'test', storage: {} };
  const client = { auth: { getSession: async () => ({ data: { session: null } }) } } as never;
  return {
    workspace: { config, client },
    client,
    user: { id: d.remote.userId, email: 'owner@test' },
    db: d.db,
    tree: d.tree,
    docs: d.docs,
    files: d.files,
    media: d.media,
    engine: d.engine,
    access: d.access,
    remote: d.remote as unknown as SupabaseRemote,
    dbName: 'test',
    mediaDb: d.mediaDb,
    comments: d.comments,
    commentsDb: d.commentsDb,
    sizes: d.sizes,
    shutdown: async () => undefined,
  } as unknown as Services;
}

const settle = (ms = 30) => act(async () => new Promise((r) => setTimeout(r, ms)));
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === text);

async function mount(device: Device, target: { kind: 'page' | 'project'; id: string }, onClose: () => void = () => undefined) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      <ServicesContext.Provider value={services(device)}>
        <ExportDialog target={target} onClose={onClose} />
      </ServicesContext.Provider>,
    ),
  );
  return host;
}

async function waitFor(host: HTMLElement, text: string | RegExp) {
  for (let i = 0; i < 300 && !(typeof text === 'string' ? host.textContent?.includes(text) : text.test(host.textContent ?? '')); i++) await settle(20);
  expect(host.textContent).toMatch(text);
}

describe('exportar 1b: la ventana', () => {
  it('*Smaller file* reemplaza a *Sharp photos* y arranca destildada', async () => {
    const server = new FakeServer();
    server.enableMedia();
    const { device, root } = await photoProject(2, 0, server);
    await device.engine.syncNow();
    expect(device.media.enabled).toBe(true);
    const host = await mount(device, { kind: 'page', id: root });
    const label = [...host.querySelectorAll('.export-options label')].find((l) => l.textContent?.includes('Smaller file'));
    expect(label?.textContent).toBe('Smaller file (lower-resolution photos)');
    expect(label?.querySelector('input')?.checked).toBe(false);
    expect(label?.getAttribute('data-tip')).toContain('printed size');
    expect(host.textContent).not.toContain('Sharp photos');
    // Con red no avisa nada de los originales.
    expect(host.textContent).not.toContain('No connection');
    expect(host.textContent).toContain('it comes out in parts');
  });

  it('en partes: arma la primera, abre el diálogo, y *Prepare part 2* arma la siguiente soltando la anterior', async () => {
    const { device, root, ids } = await photoProject(5, 0);
    // Una página de la parte 1 falla: la lista va recién al terminar (en la última parte), no antes.
    const snapshot = device.docs.snapshot.bind(device.docs);
    vi.spyOn(device.docs, 'snapshot').mockImplementation((id: string) => (id === ids[1] ? Promise.reject(new Error('rota')) : snapshot(id)));
    const original = PDF_LIMITS.desktop.pages;
    PDF_LIMITS.desktop.pages = 2;
    const print = vi.fn();
    vi.stubGlobal('print', print);
    try {
      const host = await mount(device, { kind: 'page', id: root });
      await act(async () => button(host, 'Export PDF')!.click());
      await waitFor(host, 'Part 1 ready: pages 1 to 2 of 5');
      expect(host.textContent).toContain('1 page could not be exported (marked in the PDF).');
      expect(host.querySelector('.export-failed')).toBeNull();
      expect(print).toHaveBeenCalledTimes(1);
      expect(document.title).toMatch(/Part 1$/);
      window.dispatchEvent(new Event('afterprint'));
      expect(host.textContent).toContain('Save this part first');
      await act(async () => button(host, 'Prepare part 2')!.click());
      await waitFor(host, 'Part 2 ready: pages 3 to 4 of 5');
      expect(host.querySelector('.export-failed')).toBeNull();
      // Nunca dos partes en la memoria.
      expect(document.querySelectorAll('.sd-export-book')).toHaveLength(1);
      expect(print).toHaveBeenCalledTimes(2);
      window.dispatchEvent(new Event('afterprint'));
      await act(async () => button(host, 'Prepare part 3')!.click());
      await waitFor(host, 'Part 3 ready: pages 5 to 5 of 5');
      expect(host.textContent).toContain('This is the last part.');
      expect(button(host, 'Prepare part 4')).toBeUndefined();
      expect(host.querySelector('.export-failed a')?.textContent).toBe('Día 1');
      window.dispatchEvent(new Event('afterprint'));
    } finally {
      PDF_LIMITS.desktop.pages = original;
    }
  });

  it('al terminar, la lista de las que fallaron con su link y *Export again* (que la saca de la lista si sale bien)', async () => {
    const { device, root, ids } = await photoProject(4, 0);
    const bad = ids[2];
    let broken = true;
    const snapshot = device.docs.snapshot.bind(device.docs);
    vi.spyOn(device.docs, 'snapshot').mockImplementation((id: string) => (id === bad && broken ? Promise.reject(new Error('rota')) : snapshot(id)));
    vi.stubGlobal('print', vi.fn());
    let closed = 0;
    const host = await mount(device, { kind: 'page', id: root }, () => closed++);
    await act(async () => button(host, 'Export PDF')!.click());
    await waitFor(host, /Ready: \d+ PDF pages?\./);
    window.dispatchEvent(new Event('afterprint'));
    const list = host.querySelector('.export-failed')!;
    expect(list.textContent).toContain('These pages could not be exported in full:');
    const link = list.querySelector('a')!;
    expect(link.textContent).toBe('Día 2');
    expect(link.getAttribute('href')).toBe(`/p/${bad}`);
    const again = list.querySelector<HTMLButtonElement>('button')!;
    expect(again.textContent).toBe('Export again');
    expect(again.getAttribute('aria-label')).toBe('Export “Día 2” again, on its own');
    // Sigue fallando: queda en la lista.
    await act(async () => again.click());
    await waitFor(host, /Ready: \d+ PDF pages?\./);
    window.dispatchEvent(new Event('afterprint'));
    expect(host.querySelector('.export-failed a')?.textContent).toBe('Día 2');
    // Arreglada: sale sola en su PDF y la lista se vacía.
    broken = false;
    await act(async () => host.querySelector<HTMLButtonElement>('.export-failed button')!.click());
    await waitFor(host, /Ready: \d+ PDF pages?\./);
    expect(document.title).toMatch(/^Día 2 \d{4}-\d{2}-\d{2}$/);
    window.dispatchEvent(new Event('afterprint'));
    expect(host.querySelector('.export-failed')).toBeNull();
    expect(closed).toBe(0);
  });

  it('el link de una que falló cierra la ventana y abre la página', async () => {
    const { device, root, ids } = await photoProject(3, 0);
    const snapshot = device.docs.snapshot.bind(device.docs);
    vi.spyOn(device.docs, 'snapshot').mockImplementation((id: string) => (id === ids[1] ? Promise.reject(new Error('rota')) : snapshot(id)));
    vi.stubGlobal('print', vi.fn());
    let closed = 0;
    const host = await mount(device, { kind: 'page', id: root }, () => closed++);
    await act(async () => button(host, 'Export PDF')!.click());
    await waitFor(host, /Ready/);
    window.dispatchEvent(new Event('afterprint'));
    await act(async () => host.querySelector<HTMLAnchorElement>('.export-failed a')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })));
    expect(closed).toBe(1);
    expect(location.pathname).toBe(`/p/${ids[1]}`);
  });
});

// --- Las correcciones de la auditoría (O1 a O8) ------------------------------------------------------------------

describe('exportar 1b: correcciones de la auditoría', () => {
  it('O1: *Cancel* vuelve enseguida aunque una bajada de un original quede colgada, y la bajada se corta', async () => {
    stubUrls();
    const root = viewWithPhotos(3);
    const controller = new AbortController();
    const signals: AbortSignal[] = [];
    const source: ImageSource = {
      best: async () => null,
      // Nunca contesta (la red del set floja, el portero trabado).
      original: (_id, signal) => {
        if (signal) signals.push(signal);
        return new Promise<Blob | null>(() => undefined);
      },
      isPhoto: async () => true,
    };
    const t0 = performance.now();
    const pending = shrinkImages(root, { source, budget: new PixelBudget(1e10, 1e10), resizer: fakeResizer(), full: true, signal: controller.signal });
    setTimeout(() => controller.abort(), 30);
    await pending;
    expect(performance.now() - t0).toBeLessThan(1000);
    // La señal llegó a la bajada y quedó cortada.
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((s) => s.aborted)).toBe(true);
    // Ninguna foto cambió.
    for (const img of root.querySelectorAll('img')) expect(img.getAttribute('src')).toMatch(/^https:\/\/thumbs\.test\//);
  });

  it('O1: una bajada que pasa su tope de tiempo sale achicada, contada, y la página va a la lista de D88', async () => {
    stubUrls();
    const root = viewWithPhotos(2);
    const view = new Blob(['v'], { type: 'image/x-2048x1536' });
    const source: ImageSource = {
      best: async () => view,
      original: (id) => (id === ID(0) ? new Promise<Blob | null>(() => undefined) : Promise.resolve(jpegBlob(4032, 3024, { size: 1000 }))),
      isPhoto: async () => true,
    };
    const out = await shrinkImages(root, { source, budget: new PixelBudget(1e10, 1e10), resizer: fakeResizer(), full: true, downloadMs: 40 });
    expect(out.full).toBe(1);
    expect(out.timedOut).toBe(1);
    expect(out.lowRes).toBe(1);
    expect(out.shrunk).toBe(1);

    // En el libro: la página queda marcada con lo que no llegó (la ventana la suma a la lista de las que fallaron).
    photosHaveWidth();
    const { device, root: branch, ids } = await photoProject(3, 2);
    const plan = exportPlan(device.tree, 'page', branch);
    let n = 0;
    const slow: ImageSource = { ...source, original: () => (n++ === 0 ? new Promise<Blob | null>(() => undefined) : Promise.resolve(jpegBlob(4032, 3024, { size: 1000 }))) };
    const book = await build(device, plan, { images: slow, full: true, downloadMs: 40 });
    expect(book.pages.find((p) => p.id === ids[1])?.timedOut).toBe(1);
    expect(book.pages.find((p) => p.id === ids[2])?.timedOut).toBe(0);
    book.destroy();
  });

  it('O2: las fotos que se pasan a JPEG entero van de a pocas (por píxeles), y una gigante sale achicada', async () => {
    stubUrls();
    const root = viewWithPhotos(6);
    let open = 0;
    let most = 0;
    const base = fakeResizer();
    const resizer: Resizer = {
      async open(blob) {
        const d = await base.open(blob);
        if (!d) return null;
        open++;
        most = Math.max(most, open);
        await new Promise((r) => setTimeout(r, 5));
        return { ...d, close: () => void open-- };
      },
    };
    // Fotos de 50 MP giradas: con 150 millones en curso, como mucho dos a la vez (antes, cuatro).
    const rotated = () => jpegBlob(8192, 6144, { orientation: 6, size: 20_000_000 });
    const out = await shrinkImages(root, { source: { best: async () => null, original: async () => rotated() }, budget: new PixelBudget(1e12, 1e12), resizer, full: true });
    expect(out.full).toBe(6);
    expect(most).toBe(2);

    // Una de 108 MP girada: no se pasa entera (sale achicada, contada, sin dibujarla a tamaño completo).
    const root2 = viewWithPhotos(1);
    const r2 = fakeResizer();
    const out2 = await shrinkImages(root2, {
      source: { best: async () => new Blob(['v'], { type: 'image/x-2048x1536' }), original: async () => jpegBlob(12000, 9000, { orientation: 6, size: 44_000_000 }) },
      budget: new PixelBudget(1e12, 1e12),
      resizer: r2,
      full: true,
    });
    expect(out2.full).toBe(0);
    expect(out2.lowRes).toBe(1);
    expect(r2.draws.every(([w, h]) => w * h < 100_000_000)).toBe(true);
    // Un JPEG derecho gigante sí pasa tal cual (no se decodifica).
    const root3 = viewWithPhotos(1);
    const out3 = await shrinkImages(root3, { source: { best: async () => null, original: async () => jpegBlob(12000, 9000, { size: 44_000_000 }) }, budget: new PixelBudget(1e12, 1e12), resizer: fakeResizer(), full: true });
    expect(out3.full).toBe(1);
  });

  it('O3: sin red y sin la ficha de la foto (no se sabe si es foto), la que sale como miniatura se cuenta igual', async () => {
    stubUrls();
    const root = viewWithPhotos(2);
    const out = await shrinkImages(root, {
      source: { best: async () => new Blob(['v'], { type: 'image/x-480x360' }), original: async () => null, isPhoto: async () => null },
      budget: new PixelBudget(1e10, 1e10),
      resizer: fakeResizer(),
      full: true,
    });
    expect(out.lowRes).toBe(2);
    // Con la cola de verdad: sin ficha (`kind: null`, sin tipo) no se sabe; un adjunto (con tipo) no cuenta.
    const media = {
      localImage: async () => null,
      view: async () => null,
      source: async (id: string) => (id === 'pdf' ? { kind: null, name: 'a.pdf', original: null, mime: 'application/pdf' } : { kind: null, name: '', original: null }),
    };
    const images = deviceImages(media as never, {});
    expect(await images.isPhoto!('sin-ficha')).toBeNull();
    expect(await images.isPhoto!('pdf')).toBe(false);
  });

  it('O6: la página que no entra en una parte no vuelve a bajar sus originales en la siguiente', async () => {
    stubUrls();
    photosHaveWidth();
    const { device, root } = await photoProject(7, 2);
    const plan = exportPlan(device.tree, 'page', root);
    const asked: string[] = [];
    const source: ImageSource = { best: async () => null, original: async (id) => (asked.push(id), jpegBlob(4032, 3024, { size: 3_000_000 })), isPhoto: async () => true };
    let from = 0;
    let carry: Map<string, Blob> | null = null;
    let parts = 0;
    for (let part = 1; from < plan.length; part++) {
      const book = await build(device, plan, { images: source, full: true, limits: limits({ bytes: 13_000_000 }), from, part, carry });
      carry = book.carry;
      from = book.to;
      parts++;
      book.destroy();
    }
    expect(parts).toBeGreaterThan(1);
    // 12 fotos, cada una pedida una sola vez.
    expect(asked).toHaveLength(12);
    expect(new Set(asked).size).toBe(12);
  });

  it('O7: en un táctil, *Prepare part 2* y *Export again* esperan a que se abra el diálogo de imprimir', async () => {
    const { device, root, ids } = await photoProject(3, 0);
    const snapshot = device.docs.snapshot.bind(device.docs);
    vi.spyOn(device.docs, 'snapshot').mockImplementation((id: string) => (id === ids[1] ? Promise.reject(new Error('rota')) : snapshot(id)));
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({ matches: query === '(pointer: coarse)', media: query, addEventListener: () => undefined, removeEventListener: () => undefined }) as never);
    const print = vi.fn();
    vi.stubGlobal('print', print);
    const original = PDF_LIMITS.touch.pages;
    PDF_LIMITS.touch.pages = 2;
    try {
      const host = await mount(device, { kind: 'page', id: root });
      await act(async () => button(host, 'Export PDF')!.click());
      await waitFor(host, 'Part 1 ready');
      // En el teléfono el diálogo no se abre solo, y la siguiente parte no puede soltar esta sin guardarla.
      expect(print).not.toHaveBeenCalled();
      const next = button(host, 'Prepare part 2')!;
      expect(next.disabled).toBe(true);
      expect(next.getAttribute('data-tip')).toContain('save this PDF first');
      await act(async () => button(host, 'Open the print dialog')!.click());
      expect(print).toHaveBeenCalledTimes(1);
      expect(button(host, 'Prepare part 2')!.disabled).toBe(false);
      await act(async () => button(host, 'Prepare part 2')!.click());
      await waitFor(host, 'Part 2 ready');
      const again = host.querySelector<HTMLButtonElement>('.export-failed button')!;
      expect(again.disabled).toBe(true);
      await act(async () => button(host, 'Open the print dialog')!.click());
      expect(host.querySelector<HTMLButtonElement>('.export-failed button')!.disabled).toBe(false);
    } finally {
      PDF_LIMITS.touch.pages = original;
    }
  });
});
