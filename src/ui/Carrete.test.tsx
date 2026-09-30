// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PorteroError } from '../media/portero';
import type { MediaKind } from '../media/probe';
import { Carrete } from './Carrete';
import { blockIdOf, collectCarrete, startIndex, type BlockLike, type CarreteItem } from './carrete';
import type { CarreteLoader, Full } from './carreteLoader';
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
  [VIDEO_B]: { kind: 'video', name: 'IMG_0666.MOV', preview: 'blob:thumb-b', full: { url: 'https://portero.test/m/pass-b', local: false } },
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
    expect(dialog().getAttribute('aria-label')).toBe('Photos and videos');
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

  it('cierra con Escape y con el botón, y los atajos de la app no pasan por debajo', async () => {
    const outside = vi.fn();
    document.addEventListener('keydown', outside);
    const { onClose } = await open();
    await key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    await key('k', { ctrlKey: true });
    expect(outside).not.toHaveBeenCalled();
    await act(async () => button('Close').click());
    expect(onClose).toHaveBeenCalledTimes(2);
    document.removeEventListener('keydown', outside);
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
    // Un archivo del portero se abre en otra pestaña (no se puede bajar con su nombre desde otro sitio).
    const link = document.querySelector<HTMLAnchorElement>('a[aria-label="Download IMG_0666.MOV"]')!;
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('si el navegador no lo puede reproducir (HEVC): la miniatura, el aviso y el botón para bajarlo', async () => {
    await open({ start: 1 });
    const video = current().querySelector('video')!;
    Object.defineProperty(video, 'error', { value: { code: 4 } });
    await fire(video, 'error');
    expect(current().querySelector('video')).toBeNull();
    expect(current().querySelector('img')!.getAttribute('src')).toBe('blob:thumb-b');
    expect(document.querySelector('.carrete-notice')!.textContent).toMatch(/This video can't be played in this browser/);
    expect(document.querySelector('.carrete-notice a[aria-label="Download IMG_0666.MOV"]')).not.toBeNull();
  });

  it('un video que abre sin imagen (sin ancho ni alto) cuenta como no reproducible', async () => {
    await open({ start: 1 });
    await fire(current().querySelector('video')!, 'loadedmetadata');
    expect(document.querySelector('.carrete-notice')!.textContent).toMatch(/can't be played/);
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
