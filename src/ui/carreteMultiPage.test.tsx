// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { addShape, PHOTO_MARKUP_MAP } from '../media/markup';
import { settled } from '../test/settle';
import { Carrete } from './Carrete';
import { carreteItemsOfEntries, collectCarrete, itemsOfEntries, type CarreteEntry, type CarreteItem } from './carreteModel';
import type { CarreteLoader } from './carreteLoader';

// El carrete de varias páginas (E8; Docs/Doc_Carrete.md, «Varias páginas»): las fotos por fuente de la cabecera viva,
// cada una con el rótulo de su fuente y *Go to place*; las anotaciones de cada una, de su página. El de una página sigue
// igual (Carrete.test.tsx).

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const A = '6f1c2a4e-0b7d-4c8e-9f10-112233445566';
const B = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f00112233';
const C = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f00112233';
const origin = (pageId: string, label: string, blockId: string) => ({ pageId, pageTitle: `Página ${pageId}`, label, blockId });
const ENTRIES: CarreteEntry[] = [
  { mediaId: A, origin: origin('scout', 'Tech scout 06/01', 'b1') },
  { mediaId: B, origin: origin('d59', 'Día 59 · Escena 105_027b', 'b7') },
  { mediaId: C, origin: origin('d70', 'Día 70 · Escena 105_027A + 029B', 'b3') },
];

const loader: CarreteLoader = {
  preview: async (item) => ({ kind: 'image', name: `${item.mediaId}.jpg`, preview: `blob:thumb-${item.mediaId}` }),
  full: async (item) => ({ url: `blob:full-${item.mediaId}`, local: true }),
  retry: vi.fn(),
  dispose: vi.fn(),
};

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const settle = () => act(() => settled(20));
const counter = () => document.querySelector('.carrete-count')!.textContent;
const current = () => document.querySelector<HTMLElement>('.carrete-slot:not([aria-hidden])')!;
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const from = () => document.querySelector('.carrete-origin-from');

async function open(props: Partial<Parameters<typeof Carrete>[0]> = {}) {
  const onClose = vi.fn();
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const all = { items: itemsOfEntries(ENTRIES), start: 0, loader, online: true, onClose, ...props };
  await act(async () => root!.render(<Carrete {...all} />));
  await settle();
  return { onClose };
}

describe('las fotos de varias páginas para el carrete', () => {
  it('una por archivo y página, en el orden dado, con su origen; sin carpetas', () => {
    const items = itemsOfEntries([...ENTRIES, { mediaId: A, origin: origin('scout', 'Tech scout 06/01', 'b1') }, { mediaId: A, origin: origin('d59', 'Día 59', 'b9') }], (id) => id === C);
    expect(items.map((i) => i.key)).toEqual([`scout/${A}`, `d59/${B}`, `d59/${A}`]);
    expect(items[0]).toMatchObject({ url: `sdmedia://${A}`, source: 'media', mediaId: A, blockId: 'b1', at: null, origin: { label: 'Tech scout 06/01' } });
  });

  it('lo que no se sabe qué es se averigua; si era una carpeta, sale aunque llegue tarde', async () => {
    const known = new Set([A, B]);
    let folder = false;
    let release!: () => void;
    const media = {
      fileInfo: (id: string) => (known.has(id) ? {} : null),
      isFolder: (id: string) => folder && id === C,
      learnInfo: vi.fn(() => new Promise<void>((r) => (release = r))),
    };
    const onLate = vi.fn();
    const items = await carreteItemsOfEntries(ENTRIES, media, { waitMs: 5, onLate, online: true });
    expect(media.learnInfo).toHaveBeenCalledWith([C]);
    expect(items.length).toBe(3);
    folder = true;
    release();
    await settled(5);
    expect(onLate.mock.calls[0][0].map((i: CarreteItem) => i.mediaId)).toEqual([A, B]);
  });
});

describe('carrete de varias páginas', () => {
  it('cada foto dice de dónde viene (el título de la página en el tooltip); pasa de una página a otra', async () => {
    await open({ onGoTo: vi.fn() });
    expect(counter()).toBe('1 / 3');
    expect(from()!.textContent).toBe('From Tech scout 06/01');
    expect(from()!.getAttribute('data-tip')).toBe('Página scout');
    await act(async () => button('Next').click());
    await settle();
    expect(counter()).toBe('2 / 3');
    expect(from()!.textContent).toBe('From Día 59 · Escena 105_027b');
    // Tooltips de la app, nunca `title=`.
    expect(document.querySelectorAll('.carrete [title]').length).toBe(0);
  });

  it('Go to place: cierra (saca su entrada del historial) y recién después va al bloque de la foto', async () => {
    const order: string[] = [];
    let token: string | undefined;
    const onGoTo = vi.fn((item: CarreteItem) => {
      // Ya sin la entrada del carrete: navegar desde acá no la deja abajo.
      order.push(`go:${item.origin!.blockId}:${(history.state as { carrete?: string } | null)?.carrete === token ? 'con' : 'sin'} entrada`);
    });
    const { onClose } = await open({ start: 1, onGoTo, onClose: vi.fn(() => order.push('close')) });
    token = (history.state as { carrete?: string }).carrete;
    expect(token).toMatch(/^carrete-/);
    expect(counter()).toBe('2 / 3');
    const go = document.querySelector<HTMLButtonElement>('.carrete-origin-go')!;
    expect(go.textContent).toBe('Go to place');
    await act(async () => go.click());
    await act(() => settled(500));
    expect(order).toEqual(['close', 'go:b7:sin entrada']);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('sin onGoTo no hay botón; sin origen (el carrete de una página) no hay renglón de fuente', async () => {
    await open();
    expect(from()).not.toBeNull();
    expect(document.querySelector('.carrete-origin-go')).toBeNull();
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = '';
    const single = collectCarrete([{ id: 'a', type: 'image', props: { url: `sdmedia://${A}`, name: 'IMG_0001.JPG' } }]);
    await open({ items: single });
    expect(document.querySelector('.carrete-origin')).toBeNull();
  });

  it('las anotaciones de cada foto salen de su página (markupOf), y avisa qué foto se ve (onShow)', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800);
    // La misma foto anotada en dos páginas sería la de su página: acá la de «scout» tiene dibujo y la de «d59» no.
    const scoutDoc = new Y.Doc();
    addShape(scoutDoc, A, 's', { type: 'arrow', posX: 10, posY: 10, startX: 0, startY: 0, endX: 100, endY: 50 }, { w: 4000, h: 3000 });
    const d59Doc = new Y.Doc();
    addShape(d59Doc, A, 'd', { type: 'ellipse', rectX: 0, rectY: 0, rectW: 100, rectH: 100 }, { w: 4000, h: 3000 });
    const maps: Record<string, Y.Map<unknown>> = { scout: scoutDoc.getMap(PHOTO_MARKUP_MAP), d59: d59Doc.getMap(PHOTO_MARKUP_MAP) };
    const onShow = vi.fn();
    const items = itemsOfEntries([{ mediaId: A, origin: origin('scout', 'Tech scout 06/01', 'b1') }, { mediaId: B, origin: origin('d59', 'Día 59', 'b7') }]);
    await open({ items, markupOf: (it) => maps[it.origin!.pageId] ?? null, onShow, markup: new Y.Doc().getMap(PHOTO_MARKUP_MAP) });
    expect(onShow).toHaveBeenLastCalledWith(expect.objectContaining({ key: `scout/${A}` }));
    const preview = current().querySelector<HTMLImageElement>('.carrete-preview')!;
    Object.defineProperty(preview, 'naturalWidth', { value: 480 });
    Object.defineProperty(preview, 'naturalHeight', { value: 360 });
    await act(async () => preview.dispatchEvent(new Event('load')));
    await settle();
    // El dibujo de la página «scout» (una flecha), no el de «d59» ni el del `markup` de una página.
    expect(current().querySelector('svg.sd-markup [data-shape="arrow"]')).not.toBeNull();
    expect(current().querySelector('svg.sd-markup ellipse')).toBeNull();
    expect(button('Hide annotations')).not.toBeNull();
    await act(async () => button('Next').click());
    await settle();
    expect(onShow).toHaveBeenLastCalledWith(expect.objectContaining({ key: `d59/${B}` }));
    // La foto B no tiene anotaciones en d59.
    expect(document.querySelector('.carrete-markup-toggle')).toBeNull();
  });
});
