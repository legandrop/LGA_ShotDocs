// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { addShape, PHOTO_MARKUP_MAP } from '../media/markup';
import { PorteroError } from '../media/portero';
import type { MediaKind } from '../media/probe';
import { Carrete } from './Carrete';
import { blockIdOf, collectCarrete, startIndex, type BlockLike, type CarreteItem } from './carreteModel';
import { originalFor, startDownload, type CarreteLoader, type Full } from './carreteLoader';
import { schema } from './editorSchema';

// La pantalla del carrete (paso 7), en jsdom: contador, teclado, botones, límites, foco, fotos que
// cargan en dos pasos, videos que el navegador no puede reproducir, sin red, precarga de los vecinos.

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom no reproduce videos.
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
});

const PHOTO_A = 'sdmedia://6f1c2a4e-0b7d-4c8e-9f10-112233445566';
const VIDEO_B = 'sdmedia://0a1b2c3d-4e5f-4a6b-8c7d-8e9f00112233';
const PHOTO_C = 'https://example.com/c.jpg';

const items: CarreteItem[] = collectCarrete([
  { id: 'a', type: 'image', props: { url: PHOTO_A, name: 'IMG_0001.JPG', caption: 'Plano 12, toma 3' } },
  { id: 'b', type: 'image', props: { url: VIDEO_B, name: 'IMG_0666.MOV' } },
  { id: 'c', type: 'image', props: { url: PHOTO_C } },
]);

interface Entry {
  kind: MediaKind | null;
  name: string;
  preview: string | null;
  full: Full | Error;
}

const ENTRIES: Record<string, Entry> = {
  [PHOTO_A]: { kind: 'image', name: 'IMG_0001.JPG', preview: 'blob:thumb-a', full: { url: 'blob:full-a', local: true } },
  [VIDEO_B]: { kind: 'video', name: 'IMG_0666.MOV', preview: 'blob:thumb-b', full: { url: 'https://portero.test/m/pass-b', local: false, portero: true } },
  [PHOTO_C]: { kind: 'image', name: 'c.jpg', preview: PHOTO_C, full: { url: PHOTO_C, local: false } },
};

function fakeLoader(entries: Record<string, Entry> = ENTRIES) {
  const full = vi.fn(async (item: CarreteItem) => {
    const f = entries[item.url].full;
    if (f instanceof Error) throw f;
    return f;
  });
  const loader: CarreteLoader = {
    preview: async (item) => ({ kind: entries[item.url].kind, name: entries[item.url].name, preview: entries[item.url].preview }),
    full,
    retry: vi.fn(),
    dispose: vi.fn(),
  };
  return { loader, full };
}

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  document.body.innerHTML = '';
});

async function open(props: Partial<Parameters<typeof Carrete>[0]> = {}) {
  const onClose = vi.fn();
  const { loader, full } = fakeLoader();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const all = { items, start: 0, loader, online: true, onClose, ...props };
  await act(async () => root!.render(<Carrete {...all} />));
  await settle();
  return { onClose, full: props.loader ? (props.loader.full as typeof full) : full, rerender: (next: Partial<typeof all>) => act(async () => root!.render(<Carrete {...all} {...next} />)) };
}

const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const counter = () => document.querySelector('.carrete-count')!.textContent;
const current = () => document.querySelector<HTMLElement>('.carrete-slot:not([aria-hidden])')!;
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

async function key(k: string, opts: KeyboardEventInit = {}) {
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
  });
  await settle();
}

async function fire(el: Element, type: string) {
  await act(async () => {
    el.dispatchEvent(new Event(type));
  });
  await settle();
}

describe('carrete: pantalla', () => {
  it('abre a pantalla completa en la que se tocó, con el foco adentro', async () => {
    await open({ start: 1 });
    expect(dialog().getAttribute('aria-modal')).toBe('true');
    expect(dialog().getAttribute('aria-label')).toBe('Photos, videos and files');
    expect(dialog().parentElement).toBe(document.body);
    expect(document.activeElement).toBe(dialog());
    expect(counter()).toBe('2 / 3');
    expect(document.querySelector('.carrete-name')!.textContent).toBe('IMG_0666.MOV');
  });

  it('anterior y siguiente con el teclado y los botones, sin pasar de los extremos', async () => {
    await open();
    expect(counter()).toBe('1 / 3');
    expect(button('Previous').disabled).toBe(true);
    await key('ArrowLeft');
    expect(counter()).toBe('1 / 3');
    await key('ArrowRight');
    expect(counter()).toBe('2 / 3');
    await act(async () => button('Next').click());
    await settle();
    expect(counter()).toBe('3 / 3');
    expect(button('Next').disabled).toBe(true);
    await key('ArrowRight');
    expect(counter()).toBe('3 / 3');
    await key('Home');
    expect(counter()).toBe('1 / 3');
    await key('End');
    expect(counter()).toBe('3 / 3');
    await act(async () => button('Previous').click());
    await settle();
    expect(counter()).toBe('2 / 3');
  });

  it('con un solo elemento no hay anterior ni siguiente', async () => {
    await open({ items: [items[0]] });
    expect(counter()).toBe('1 / 1');
    expect(button('Previous')).toBeNull();
    expect(button('Next')).toBeNull();
  });

  it('cierra con Escape, y los atajos de la app no pasan por debajo', async () => {
    const outside = vi.fn();
    document.addEventListener('keydown', outside);
    const { onClose } = await open();
    await key('k', { ctrlKey: true });
    expect(outside).not.toHaveBeenCalled();
    await key('Escape');
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', outside);
  });

  it('"atrás" del navegador cierra; la X saca la entrada del historial sin salir de la página', async () => {
    const path = location.pathname;
    const first = await open();
    expect((history.state as { carrete?: string }).carrete).toMatch(/^carrete-/);
    // "Atrás" (Android, el navegador).
    await act(async () => history.back());
    await settle();
    expect(first.onClose).toHaveBeenCalledTimes(1);
    act(() => root!.unmount());
    root = null;

    const second = await open();
    const token = (history.state as { carrete?: string }).carrete;
    await act(async () => button('Close').click());
    await settle();
    expect(second.onClose).toHaveBeenCalledTimes(1);
    expect((history.state as { carrete?: string } | null)?.carrete).not.toBe(token);
    expect(location.pathname).toBe(path);
  });

  it('deja inerte lo de atrás mientras está abierto', async () => {
    const app = document.createElement('main');
    document.body.appendChild(app);
    await open();
    expect(app.hasAttribute('inert')).toBe(true);
    expect(dialog().hasAttribute('inert')).toBe(false);
    act(() => root!.unmount());
    root = null;
    expect(app.hasAttribute('inert')).toBe(false);
  });

  it('el foco da la vuelta adentro con Tab y vuelve a donde estaba al cerrar', async () => {
    const before = document.createElement('button');
    document.body.appendChild(before);
    before.focus();
    await open({ start: 1 });
    const focusables = [...dialog().querySelectorAll<HTMLElement>('button:not([disabled]), a[href], video[controls]')];
    const last = focusables[focusables.length - 1];
    await key('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(last);
    await key('Tab');
    expect(document.activeElement).toBe(focusables[0]);

    act(() => root!.unmount());
    root = null;
    expect(document.activeElement).toBe(before);
  });

  it('tooltips solo con data-tip (los atajos), nunca los del navegador', async () => {
    await open({ start: 1 });
    expect(dialog().querySelectorAll('[title]').length).toBe(0);
    expect(button('Close').dataset.tip).toMatch(/Esc/);
    expect(button('Next').dataset.tip).toMatch(/→/);
  });

  it('muestra la leyenda del bloque si tiene', async () => {
    await open();
    expect(document.querySelector('.carrete-caption')!.textContent).toBe('Plano 12, toma 3');
    await key('ArrowRight');
    expect(document.querySelector('.carrete-caption')).toBeNull();
  });
});

describe('carrete: fotos', () => {
  it('primero la miniatura, después la grande encima cuando termina de cargar', async () => {
    await open();
    const imgs = () => [...current().querySelectorAll('img')];
    expect(imgs().map((i) => i.getAttribute('src'))).toEqual(['blob:thumb-a', 'blob:full-a']);
    const full = current().querySelector('.carrete-full')!;
    expect(full.hasAttribute('data-shown')).toBe(false);
    expect(document.querySelector('.carrete-spinner')).not.toBeNull();
    await fire(full, 'load');
    expect(imgs().map((i) => i.getAttribute('src'))).toEqual(['blob:full-a']);
    expect(current().querySelector('.carrete-full')!.hasAttribute('data-shown')).toBe(true);
    expect(document.querySelector('.carrete-spinner')).toBeNull();
  });

  it('se baja el original con su nombre', async () => {
    await open();
    const link = document.querySelector<HTMLAnchorElement>('a[aria-label="Download IMG_0001.JPG"]')!;
    expect(link.getAttribute('href')).toBe('blob:full-a');
    expect(link.getAttribute('download')).toBe('IMG_0001.JPG');
    expect(link.hasAttribute('target')).toBe(false);
  });

  it('una foto que el navegador no abre (HEIC) deja la miniatura y ofrece bajarla', async () => {
    const entries = { ...ENTRIES, [PHOTO_A]: { ...ENTRIES[PHOTO_A], name: 'IMG_0001.HEIC' } };
    const { loader } = fakeLoader(entries);
    await open({ loader });
    await fire(current().querySelector('.carrete-full')!, 'error');
    expect(document.querySelector('.carrete-notice')!.textContent).toMatch(/can't show this photo's format/);
    expect(document.querySelector('.carrete-notice a[download="IMG_0001.HEIC"]')).not.toBeNull();
    expect([...current().querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual(['blob:thumb-a']);
  });

  it('no precarga fotos en formatos que muchos navegadores no abren (HEIC)', async () => {
    const entries: Record<string, Entry> = { ...ENTRIES, [PHOTO_A]: { ...ENTRIES[PHOTO_A], name: 'IMG_0001.HEIC' } };
    const { loader, full } = fakeLoader(entries);
    await open({ start: 1, loader });
    expect(full.mock.calls.map(([i]) => i.url).sort()).toEqual([VIDEO_B, PHOTO_C].sort());
  });

  it('precarga la foto de al lado, nunca el video', async () => {
    const { full } = await open({ start: 1 });
    // En el video (2): se pide el video y, ya listo, las fotos de los dos lados.
    expect(full.mock.calls.map(([i]) => i.url).sort()).toEqual([PHOTO_A, VIDEO_B, PHOTO_C].sort());
    full.mockClear();
    await key('ArrowRight');
    // En la foto 3, el vecino es el video: no se pide nada de él.
    expect(full.mock.calls.map(([i]) => i.url)).toEqual([PHOTO_C]);
  });
});

describe('carrete: videos', () => {
  it('se reproduce con controles y en línea, con la miniatura mientras carga', async () => {
    await open({ start: 1 });
    const video = current().querySelector('video')!;
    expect(video.getAttribute('src')).toBe('https://portero.test/m/pass-b');
    expect(video.getAttribute('poster')).toBe('blob:thumb-b');
    expect(video.hasAttribute('controls')).toBe(true);
    expect(video.hasAttribute('playsinline')).toBe(true);
    expect(video.getAttribute('preload')).toBe('metadata');
    // Un archivo del portero se baja con `?download=1` (el portero lo manda como descarga, con su nombre), en
    // otra pestaña (si respondiera un error, no reemplaza la app); el video sigue con el pase sin eso.
    const link = document.querySelector<HTMLAnchorElement>('a[aria-label="Download IMG_0666.MOV"]')!;
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('href')).toBe('https://portero.test/m/pass-b?download=1');
  });

  const localVideo: Record<string, Entry> = { ...ENTRIES, [VIDEO_B]: { ...ENTRIES[VIDEO_B], full: { url: 'blob:video-b', local: true } } };

  it('el original del dispositivo que el navegador no reproduce (HEVC): la miniatura, el aviso y bajarlo', async () => {
    const { loader } = fakeLoader(localVideo);
    await open({ start: 1, loader });
    const video = current().querySelector('video')!;
    Object.defineProperty(video, 'error', { value: { code: 4 } });
    await fire(video, 'error');
    expect(current().querySelector('video')).toBeNull();
    expect(current().querySelector('img')!.getAttribute('src')).toBe('blob:thumb-b');
    expect(document.querySelector('.carrete-notice')!.textContent).toMatch(/This video can't be played in this browser/);
    expect(document.querySelector('.carrete-notice a[aria-label="Download IMG_0666.MOV"]')).not.toBeNull();
    expect(button('Retry')).toBeNull();
  });

  it('un video que abre sin imagen (sin ancho ni alto) cuenta como no reproducible', async () => {
    const { loader } = fakeLoader(localVideo);
    await open({ start: 1, loader });
    await fire(current().querySelector('video')!, 'loadedmetadata');
    expect(document.querySelector('.carrete-notice')!.textContent).toMatch(/can't be played/);
  });

  it('lo que vino del portero y no anduvo: aviso neutro, bajarlo, y reintentar con un pase nuevo', async () => {
    const { loader, full } = fakeLoader();
    await open({ start: 1, loader });
    const video = current().querySelector('video')!;
    Object.defineProperty(video, 'error', { value: { code: 4 } });
    await fire(video, 'error');
    expect(document.querySelector('.carrete-notice')!.textContent).toMatch(/couldn't be loaded or played in this browser/);
    expect(document.querySelector('.carrete-notice a[aria-label="Download IMG_0666.MOV"]')).not.toBeNull();
    full.mockClear();
    await act(async () => document.querySelector<HTMLButtonElement>('.carrete-notice button')!.click());
    await settle();
    expect(loader.retry).toHaveBeenCalledWith(items[1]);
    expect(full.mock.calls.map(([i]) => i.url)).toContain(VIDEO_B);
    expect(current().querySelector('video')).not.toBeNull();
    expect(document.querySelector('.carrete-notice')).toBeNull();
  });

  it('al cambiar de elemento el video se suelta del todo', async () => {
    await open({ start: 1 });
    const video = current().querySelector('video')!;
    expect(video.hasAttribute('src')).toBe(true);
    await key('ArrowRight');
    expect(video.hasAttribute('src')).toBe(false);
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
  });

  it('se pausa al cambiar de elemento', async () => {
    await open({ start: 1 });
    const pause = vi.mocked(HTMLMediaElement.prototype.pause);
    pause.mockClear();
    await key('ArrowRight');
    expect(pause).toHaveBeenCalled();
    expect(document.querySelector('video')).toBeNull();
  });
});

describe('carrete: sin red', () => {
  it('muestra la miniatura con un aviso, y pide lo grande cuando vuelve la red', async () => {
    const entries: Record<string, Entry> = { ...ENTRIES, [VIDEO_B]: { ...ENTRIES[VIDEO_B], full: new PorteroError('Failed to fetch', 0) } };
    const { loader, full } = fakeLoader(entries);
    const { rerender } = await open({ start: 1, loader, online: false });
    expect(current().querySelector('video')).toBeNull();
    expect(current().querySelector('img')!.getAttribute('src')).toBe('blob:thumb-b');
    expect(document.querySelector('.carrete-notice')!.textContent).toMatch(/offline/);
    expect(button('Download IMG_0666.MOV (not available offline)').disabled).toBe(true);

    entries[VIDEO_B] = ENTRIES[VIDEO_B];
    full.mockClear();
    await rerender({ online: true });
    await settle();
    expect(full.mock.calls.map(([i]) => i.url)).toContain(VIDEO_B);
    expect(current().querySelector('video')).not.toBeNull();
    expect(document.querySelector('.carrete-notice')).toBeNull();
  });
});

describe('carrete: desde el editor', () => {
  it('la foto tocada en la página dice por cuál empezar', async () => {
    const editor = BlockNoteEditor.create({ schema, resolveFileUrl: async (url: string) => url });
    const el = document.createElement('div');
    document.body.appendChild(el);
    editor.mount(el);
    editor.replaceBlocks(editor.document, [
      { type: 'paragraph', content: 'Plano 12' },
      { type: 'image', props: { url: PHOTO_A } },
      { type: 'image', props: { url: VIDEO_B } },
      { type: 'image', props: { url: PHOTO_C } },
    ]);
    await settle();
    const list = collectCarrete(editor.document as unknown as BlockLike[]);
    expect(list.map((i) => i.url)).toEqual([PHOTO_A, VIDEO_B, PHOTO_C]);
    const imgs = [...el.querySelectorAll('img.bn-visual-media')];
    expect(imgs.length).toBe(3);
    expect(startIndex(list, blockIdOf(imgs[1]))).toBe(1);
    expect(startIndex(list, blockIdOf(imgs[2]))).toBe(2);
    editor.unmount();
  });
});

describe('carrete: bajar el original desde la barra de la imagen', () => {
  it('el del dispositivo con su nombre; si no, con un pase del portero en otra pestaña', async () => {
    const { createObjectURL, revokeObjectURL } = URL;
    URL.createObjectURL = vi.fn(() => 'blob:local-original');
    URL.revokeObjectURL = vi.fn();
    const original = new Blob([new Uint8Array(10)], { type: 'image/heic' });
    const local = { source: vi.fn(async () => ({ kind: 'image' as const, name: 'IMG_1.HEIC', original })), pass: vi.fn() };
    const got = await originalFor(local, 'id-1');
    expect(got.full.local).toBe(true);
    expect(got.full.url).toMatch(/^blob:/);
    expect(got.name).toBe('IMG_1.HEIC');
    expect(local.pass).not.toHaveBeenCalled();

    const remote = { source: vi.fn(async () => ({ kind: 'video' as const, name: 'IMG_2.MOV', original: null })), pass: vi.fn(async () => 'https://portero.test/m/p') };
    const far = await originalFor(remote, 'id-2');
    expect(far).toMatchObject({ full: { url: 'https://portero.test/m/p', local: false, portero: true }, name: 'IMG_2.MOV' });

    const clicked: HTMLAnchorElement[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });
    startDownload(got.full, got.name);
    startDownload(far.full, far.name);
    startDownload({ url: 'https://example.com/a.jpg', local: false }, 'a.jpg');
    expect(clicked[0].getAttribute('download')).toBe('IMG_1.HEIC');
    expect(clicked[0].target).toBe('');
    // Del portero: obliga a bajar (un PDF no se abre) en otra pestaña. Una dirección de otro sitio, tal cual.
    expect(clicked[1].target).toBe('_blank');
    expect(clicked[1].getAttribute('href')).toBe('https://portero.test/m/p?download=1');
    expect(clicked[2].getAttribute('href')).toBe('https://example.com/a.jpg');
    expect(document.querySelectorAll('a[download]').length).toBe(0);
    click.mockRestore();
    got.release();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-original');
    Object.assign(URL, { createObjectURL, revokeObjectURL });
  });
});

describe('carrete: un adjunto en grande (Docs/Doc_Adjuntos.md, entrega 2)', () => {
  const PDF = 'sdmedia://11111111-2222-4333-8444-555555555555';
  const ZIP = 'sdmedia://66666666-7777-4888-9999-000000000000';
  const withFiles = collectCarrete([
    { id: 'a', type: 'image', props: { url: PHOTO_A, name: 'IMG_0001.JPG' } },
    { id: 'p', type: 'image', props: { url: PDF, name: 'guion.pdf' } },
    { id: 'z', type: 'image', props: { url: ZIP, name: 'todo.zip' } },
  ]);

  function filesLoader(opts: { offline?: boolean } = {}) {
    const open = vi.fn(async () => (opts.offline ? null : 'blob:open-pdf'));
    const loader: CarreteLoader = {
      preview: async (item) => {
        if (item.url === PHOTO_A) return { kind: 'image', name: 'IMG_0001.JPG', preview: 'blob:thumb-a' };
        if (item.url === PDF)
          return { kind: null, name: 'guion.pdf', preview: 'blob:page-1', file: { mime: 'application/pdf', size: 2.4 * 1024 * 1024, canOpen: true, card: false } };
        return { kind: null, name: 'todo.zip', preview: 'data:image/svg+xml,card', file: { mime: 'application/zip', size: 1024, canOpen: false, card: true } };
      },
      full: async (item) => {
        if (opts.offline && item.url !== PHOTO_A) throw new PorteroError('Failed to fetch', 0);
        return item.url === PHOTO_A ? { url: 'blob:full-a', local: true } : { url: 'https://portero.test/m/pass', local: false, portero: true };
      },
      open,
      retry: vi.fn(),
      dispose: vi.fn(),
    };
    return { loader, open };
  }

  it('el PDF: su primera página, el tipo y el peso, Open (pestaña nueva) y Download con ?download=1; sin zoom', async () => {
    const { loader, open: prepare } = filesLoader();
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null);
    await open({ items: withFiles, start: 1, loader });
    expect(counter()).toBe('2 / 3');
    const slot = current();
    expect(slot.querySelector('.carrete-file-preview')?.getAttribute('src')).toBe('blob:page-1');
    expect(slot.querySelector('.carrete-file-meta')?.textContent).toMatch(/^PDF · 2[.,]4 MB$/);
    expect(document.querySelector('.carrete-stage')?.hasAttribute('data-zoomable')).toBe(false);
    expect(prepare).toHaveBeenCalledTimes(1);
    const openBtn = slot.querySelector<HTMLButtonElement>('.carrete-file-open')!;
    expect(openBtn.disabled).toBe(false);
    expect(openBtn.textContent).toBe('Open');
    await act(async () => openBtn.click());
    expect(opened).toHaveBeenCalledWith('blob:open-pdf', '_blank', 'noopener');
    const download = slot.querySelector<HTMLAnchorElement>('.carrete-file-actions a')!;
    expect(download.getAttribute('href')).toBe('https://portero.test/m/pass?download=1');
    expect(download.getAttribute('download')).toBe('guion.pdf');
    // Ningún aviso encima: el adjunto dice lo suyo en su tarjeta.
    expect(document.querySelector('.carrete-notice')).toBeNull();
    opened.mockRestore();
  });

  it('si la lista cambia con el carrete abierto (sale una carpeta), se sigue en el mismo elemento', async () => {
    const { loader } = filesLoader();
    const { rerender } = await open({ items: withFiles, start: 2, loader });
    expect(counter()).toBe('3 / 3');
    expect(document.querySelector('.carrete-name')?.textContent).toBe('todo.zip');
    // La foto del principio resultó ser otra cosa y sale de la lista: el zip sigue a la vista.
    await rerender({ items: withFiles.slice(1) });
    await settle();
    expect(counter()).toBe('2 / 2');
    expect(document.querySelector('.carrete-name')?.textContent).toBe('todo.zip');
  });

  it('un zip: la tarjeta y solo Download; se llega pasando desde una foto', async () => {
    const { loader } = filesLoader();
    await open({ items: withFiles, start: 0, loader });
    await key('ArrowRight');
    await key('ArrowRight');
    expect(counter()).toBe('3 / 3');
    const slot = current();
    expect(slot.querySelector('.carrete-file[data-card]')).toBeTruthy();
    expect(slot.querySelector('.carrete-file-open')).toBeNull();
    expect(slot.querySelector('.carrete-file-meta')).toBeNull();
    expect(slot.querySelector('.carrete-file-actions a')?.getAttribute('download')).toBe('todo.zip');
  });

  it('sin red y sin el archivo en el dispositivo: se ve la vista previa, con el aviso y los botones apagados', async () => {
    const { loader } = filesLoader({ offline: true });
    await open({ items: withFiles, start: 1, loader, online: false });
    const slot = current();
    expect(slot.querySelector('.carrete-file-preview')?.getAttribute('src')).toBe('blob:page-1');
    expect(slot.querySelector('.carrete-file-note')?.textContent).toMatch(/offline/i);
    expect(slot.querySelector<HTMLButtonElement>('.carrete-file-open')!.disabled).toBe(true);
    expect(slot.querySelector('.carrete-file-actions a')).toBeNull();
  });
});

describe('carrete: anotaciones (P.20, Docs/Doc_Anotar_Fotos.md, AN9)', () => {
  const FILE_A = PHOTO_A.slice('sdmedia://'.length);

  /** El carrete con el escenario medido y la foto ya dibujada (jsdom no mide ni carga imágenes). */
  async function openSized(map: Y.Map<unknown>) {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800);
    const opened = await open({ markup: map });
    const preview = current().querySelector<HTMLImageElement>('.carrete-preview')!;
    Object.defineProperty(preview, 'naturalWidth', { value: 480 });
    Object.defineProperty(preview, 'naturalHeight', { value: 360 });
    await fire(preview, 'load');
    return opened;
  }
  afterEach(() => vi.restoreAllMocks());

  it('la foto anotada se ve con su dibujo; Hide annotations lo saca (solo para quien mira) y deja una marca', async () => {
    const doc = new Y.Doc();
    addShape(doc, FILE_A, 'a', { type: 'arrow', posX: 10, posY: 10, startX: 0, startY: 0, endX: 100, endY: 50 }, { w: 4000, h: 3000 });
    const writes: unknown[] = [];
    doc.on('update', (_u: Uint8Array, o: unknown) => writes.push(o));
    await openSized(doc.getMap(PHOTO_MARKUP_MAP));
    const svg = () => current().querySelector('.carrete-media > svg.sd-markup');
    expect(svg()?.getAttribute('viewBox')).toBe('0 0 4000 3000');
    expect(svg()?.querySelector('[data-shape="arrow"]')).not.toBeNull();
    expect(document.querySelector('.carrete-markup-mark')).toBeNull();
    await act(async () => button('Hide annotations').click());
    expect(svg()).toBeNull();
    expect(document.querySelector('.carrete-markup-mark')?.getAttribute('aria-label')).toBe('This photo has hidden annotations');
    await act(async () => button('Show annotations').click());
    expect(svg()).not.toBeNull();
    // Ocultar o mostrar no escribe nada en la página.
    expect(writes).toEqual([]);
  });

  it('una anotación nueva (de otro) aparece con el carrete abierto; sin anotaciones no hay botón', async () => {
    const doc = new Y.Doc();
    await openSized(doc.getMap(PHOTO_MARKUP_MAP));
    expect(document.querySelector('.carrete-markup-toggle')).toBeNull();
    expect(current().querySelector('svg.sd-markup')).toBeNull();
    await act(async () => {
      addShape(doc, FILE_A, 'a', { type: 'ellipse', rectX: 0, rectY: 0, rectW: 100, rectH: 100 }, { w: 4000, h: 3000 });
    });
    await settle();
    expect(document.querySelector('.carrete-markup-toggle')).not.toBeNull();
    expect(current().querySelector('svg.sd-markup ellipse')).not.toBeNull();
  });

  it('sin el mapa (las fotos de una carpeta) no hay anotaciones ni botón', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
    await open();
    expect(document.querySelector('.carrete-markup-toggle')).toBeNull();
    expect(document.querySelector('svg.sd-markup')).toBeNull();
  });
});
