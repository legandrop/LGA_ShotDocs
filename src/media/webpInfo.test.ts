import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareMarkupRaster, rasterInfo } from './markupRaster';
import type { PhotoMarkup } from './markup';
import { animated, vp8, vp8l } from './webpSamples.test-fixture';

const bytes = (sample: string) => Uint8Array.from(atob(sample), (c) => c.charCodeAt(0));
const blob = (b: Uint8Array) => new Blob([new Uint8Array(b)], { type: 'image/webp' });
const signal = () => new AbortController().signal;
const photo = { fileId: 'fixture', frame: { v: 1, w: 96, h: 64 }, shapes: [], newer: false } as PhotoMarkup;
afterEach(() => vi.unstubAllGlobals());
describe('WebP simple y salida PNG explícita', () => {
  it.each([vp8, vp8l])('lee dimensiones reales sin confiar en MIME', async (sample) => {
    expect(await rasterInfo(new Blob([bytes(sample)], { type: 'image/jpeg' }), false, signal())).toEqual({ width: 96, height: 64, mime: 'image/webp' });
  });
  const negatives: [string, string, (b: Uint8Array) => Uint8Array | void][] = [
    ['RIFF incompleto', vp8, (b) => b.slice(0, -1)],
    ['tamaño RIFF declarado distinto', vp8, (b) => { b[4]++; }],
    ['payload fuera de límites', vp8, (b) => { b[16]++; }],
    ['otro chunk aunque MIME sea WebP', vp8, (b) => { b.set([73, 67, 67, 80], 12); }],
    ['WebP animado real', animated, () => {}],
    ['frame intermedio', vp8, (b) => { b[20] |= 1; }],
    ['versión VP8 no admitida', vp8, (b) => { b[20] = (b[20] & ~14) | 8; }],
    ['frame invisible', vp8, (b) => { b[20] &= ~16; }],
    ['partición vacía', vp8, (b) => { b[20] &= 31; b[21] = b[22] = 0; }],
    ['partición fuera del payload', vp8, (b) => { b[21] = b[22] = 255; }],
    ['firma keyframe distinta', vp8, (b) => { b[23] = 0; }],
    ['escala VP8 implícita', vp8, (b) => { b[27] |= 64; }],
    ['dimensión nula', vp8, (b) => { b[26] = b[27] = 0; }],
    ['firma VP8L distinta', vp8l, (b) => { b[20] = 0; }],
    ['versión VP8L no admitida', vp8l, (b) => { b[24] |= 32; }],
    ['padding no nulo', vp8l, (b) => { b[b.length - 1] = 1; }],
    ['chunk posterior', vp8, (b) => { const out = new Uint8Array(b.length + 8); out.set(b); new DataView(out.buffer).setUint32(4, out.length - 8, true); out.set([65, 78, 73, 77], b.length); return out; }],
  ];
  it.each(negatives)('rechaza %s antes del decoder', async (_, sample, mutate) => {
    const b = bytes(sample), altered = mutate(b) ?? b, decoder = vi.fn(); vi.stubGlobal('createImageBitmap', decoder);
    await expect(prepareMarkupRaster(blob(altered), 'test.webp', photo, false, signal())).rejects.toMatchObject({ reason: 'unsupported' });
    expect(decoder).not.toHaveBeenCalled();
  });
  it('mantiene los límites físicos móviles antes de decodificar', async () => {
    const b = bytes(vp8l); new DataView(b.buffer).setUint32(21, 7999 + (5999 << 14), true);
    const decoder = vi.fn(); vi.stubGlobal('createImageBitmap', decoder);
    await expect(prepareMarkupRaster(blob(b), '48mp.webp', photo, true, signal())).rejects.toMatchObject({ reason: 'size' }); expect(decoder).not.toHaveBeenCalled();
  });
  it('cancelar durante la lectura del padding no llega al decoder', async () => {
    const c = new AbortController(), b = blob(bytes(vp8l)), slice = b.slice.bind(b);
    vi.spyOn(b, 'slice').mockImplementation((start, end) => { const part = slice(start, end); if (start === b.size - 1) { const read = part.arrayBuffer.bind(part); part.arrayBuffer = async () => { const result = await read(); c.abort(); return result; }; } return part; });
    const decoder = vi.fn(); vi.stubGlobal('createImageBitmap', decoder);
    await expect(prepareMarkupRaster(b, 'test.webp', photo, false, c.signal)).rejects.toBeDefined(); expect(decoder).not.toHaveBeenCalled();
  });
  it.each(['ok', 'bytes', 'dimensions', 'decode', 'oversize'] as const)('PNG obligatorio: encoder/decoder %s', async (failure) => {
    const head = new Uint8Array(33); head.set([137, 80, 78, 71, 13, 10, 26, 10]); const v = new DataView(head.buffer); v.setUint32(8, 13); head.set([73, 72, 68, 82], 12); v.setUint32(16, failure === 'dimensions' ? 95 : 96); v.setUint32(20, 64);
    const encoded = failure === 'oversize' ? { type: 'image/png', size: 64 * 1024 ** 2 + 1 } : new Blob([failure === 'bytes' ? 'WebP bajo etiqueta PNG' : head], { type: 'image/png' });
    const fillRect = vi.fn(), context = new Proxy({ fillRect }, { get: (o, key) => Reflect.get(o, key) ?? (() => undefined), set: (o, key, value) => Reflect.set(o, key, value) });
    const canvas = { width: 0, height: 0, getContext: () => context, toBlob: vi.fn((cb: (b: unknown) => void) => cb(encoded)) }, close = vi.fn();
    vi.stubGlobal('document', { fonts: { ready: Promise.resolve() }, createElement: () => canvas }); vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: failure === 'decode' ? 95 : 96, height: 64, close })));
    const pending = prepareMarkupRaster(blob(bytes(vp8l)), 'set.webp', photo, true, signal());
    if (failure === 'ok') { const result = await pending; expect(result).toMatchObject({ width: 96, height: 64, name: 'set_annotated.png' }); expect(result.blob.type).toBe('image/png'); expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png', .92); }
    else await expect(pending).rejects.toMatchObject({ reason: failure === 'decode' ? 'unsupported' : failure === 'oversize' ? 'size' : 'encode' });
    expect(close).toHaveBeenCalledOnce(); expect(fillRect).not.toHaveBeenCalled(); expect(canvas.width).toBe(0);
  });
});
