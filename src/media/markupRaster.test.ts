import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { addShape, MAX_POINTS, PHOTO_MARKUP_MAP } from './markup';
import { checkRasterSize, markupMeet, prepareMarkupRaster, rasterInfo, rasterSnapshot, rasterWait } from './markupRaster';

const id = '12345678-1234-1234-1234-123456789012';
function photo() {
  const doc = new Y.Doc();
  addShape(doc, id, 'a', { type: 'arrow', startX: 10, startY: 20, endX: 100, endY: 150 }, { w: 400, h: 300 });
  return { doc, map: doc.getMap<unknown>(PHOTO_MARKUP_MAP) };
}
function jpeg(w: number, h: number, orientation = 1): Blob {
  const exif = [0xff, 0xe1, 0, 34, 69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 18, 1, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0];
  return new Blob([new Uint8Array([255, 216, ...exif, 255, 192, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0, 0, 255, 217])], { type: 'image/jpeg' });
}
function png(w: number, h: number, extra = ''): Blob {
  const chunk = (type: string, body: number[]) => { const out = new Uint8Array(12 + body.length); new DataView(out.buffer).setUint32(0, body.length); out.set([...type].map((c) => c.charCodeAt(0)), 4); out.set(body, 8); return out; };
  const ihdr = new Uint8Array(13); const v = new DataView(ihdr.buffer); v.setUint32(0, w); v.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 6;
  return new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', [...ihdr]), ...(extra ? [chunk(extra, [])] : []), chunk('IEND', [])]);
}
afterEach(() => vi.unstubAllGlobals());
describe('foto completa antes de decodificar', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('EXIF %i fija dimensiones orientadas una sola vez', async (o) => {
    expect(await rasterInfo(jpeg(400, 300, o), false, new AbortController().signal)).toEqual({ width: o >= 5 ? 300 : 400, height: o >= 5 ? 400 : 300, mime: 'image/jpeg' });
  });
  it('PNG: admite alfa sin usar etiqueta MIME, rechaza animación y EXIF', async () => {
    expect(await rasterInfo(png(300, 400), false, new AbortController().signal)).toEqual({ width: 300, height: 400, mime: 'image/png' });
    for (const type of ['acTL', 'eXIf']) await expect(rasterInfo(png(300, 400, type), false, new AbortController().signal)).rejects.toMatchObject({ reason: 'unsupported' });
  });
  it('48 MP móvil, HEIC y eje excesivo fallan antes de decoder y Canvas', async () => {
    const decode = vi.fn(); vi.stubGlobal('createImageBitmap', decode);
    const { map } = photo();
    for (const [blob, mobile] of [[jpeg(8000, 6000), true], [new Blob(['heic']), false], [png(17000, 2), false]] as const) await expect(prepareMarkupRaster(blob, 'photo', rasterSnapshot(map, id), mobile, new AbortController().signal)).rejects.toBeDefined();
    expect(decode).not.toHaveBeenCalled();
    expect(() => checkRasterSize(8000, 6000, false)).not.toThrow();
    expect(() => checkRasterSize(4032, 3024, true)).not.toThrow();
  });
  it('cabecera incompleta, bytes de más y abortada no entran al decode', async () => {
    await expect(rasterInfo(new Blob([new Uint8Array([255, 216])]), false, new AbortController().signal)).rejects.toMatchObject({ reason: 'unsupported' });
    const oversized = { size: 65 * 1024 ** 2, slice: vi.fn() } as unknown as Blob;
    await expect(rasterInfo(oversized, true, new AbortController().signal)).rejects.toMatchObject({ reason: 'size' });
    expect(oversized.slice).not.toHaveBeenCalled();
    const c = new AbortController(); c.abort(); await expect(rasterInfo(jpeg(10, 10), false, c.signal)).rejects.toBeDefined();
  });
  it('meet usa una escala común y centra sin deformar', () => {
    expect(markupMeet(400, 300, 200, 200)).toEqual({ scale: 1.5, x: 50, y: 0 });
    expect(markupMeet(300, 400, 200, 100)).toEqual({ scale: 1.5, x: 0, y: 125 });
  });
  it('encoder nulo/MIME cambiado rechaza; JPEG se pide a .92 y blanco, libera recursos', async () => {
    for (const encoded of [null, new Blob(['png'], { type: 'image/png' })]) {
      const close = vi.fn(), fillRect = vi.fn(), context = new Proxy({ fillRect } as Record<string, unknown>, { get: (o, key: string) => o[key] ?? (() => undefined), set: (o, key: string, v) => { o[key] = v; return true; } });
      const canvas = { width: 0, height: 0, getContext: () => context, toBlob: vi.fn((callback: (b: Blob | null) => void) => callback(encoded)) };
      vi.stubGlobal('document', { fonts: { ready: Promise.resolve() }, createElement: () => canvas });
      vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 400, height: 300, close })));
      const { map } = photo(); const snap = { ...rasterSnapshot(map, id), shapes: [] };
      await expect(prepareMarkupRaster(jpeg(400, 300), 'original.jpg', snap, false, new AbortController().signal)).rejects.toMatchObject({ reason: 'encode' });
      expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', .92); expect(context.fillStyle).toBe('#FFFFFF'); expect(fillRect).toHaveBeenCalledWith(0, 0, 400, 300); expect(close).toHaveBeenCalledOnce(); expect(canvas.width).toBe(0);
    }
  });
});
describe('todas las anotaciones o rechazo sin escribir', () => {
  it('snapshot queda independiente del mapa y no emite updates', () => {
    const { doc, map } = photo(); const before = Y.encodeStateAsUpdate(doc), updates = vi.fn(); doc.on('update', updates);
    const snapshot = rasterSnapshot(map, id);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before); expect(updates).not.toHaveBeenCalled();
    (map.get(`${id}/a`) as Y.Map<unknown>).set('endX', 250);
    expect(snapshot.shapes[0]).toMatchObject({ end: [100, 150] });
  });
  it.each([1, 2])('desconocido solo o mezclado se rechaza también con frame v%i', (v) => {
    const { map } = photo(); map.set(id, { v, w: 400, h: 300 });
    map.set(`${id}/future`, { type: 'loupe' }); expect(() => rasterSnapshot(map, id)).toThrow();
    map.delete(`${id}/a`); expect(() => rasterSnapshot(map, id)).toThrow();
  });
  it('no trunca puntos/textos/formas ni saltea entradas inválidas', () => {
    for (const raw of [{ type: 'text', text: 'a'.repeat(2001) }, { type: 'freehand_pencil', points: new Array(MAX_POINTS * 2 + 2).fill(1) }, { type: 'rectangle' }, { type: 'freehand_pencil', points: [0, 0, NaN, 1] }]) {
      const { map } = photo(); map.set(`${id}/bad`, raw); expect(() => rasterSnapshot(map, id)).toThrow();
    }
    const { map } = photo(); for (let n = 0; n < 11; n++) map.set(`${id}/t${n}`, { type: 'text', text: 'a'.repeat(2000) }); expect(() => rasterSnapshot(map, id)).toThrow();
    const many = photo(); for (let n = 0; n < 2000; n++) many.map.set(`${id}/t${n}`, { type: 'text', text: 'a' }); expect(() => rasterSnapshot(many.map, id)).toThrow();
  });
  it('cancelar libera Bitmap que llega tarde', async () => {
    let resolve!: (v: { close(): void }) => void; const pending = new Promise<{ close(): void }>((r) => resolve = r);
    const c = new AbortController(), close = vi.fn(), waiting = rasterWait(pending, c.signal, 100, (v) => v.close());
    c.abort(); await expect(waiting).rejects.toBeDefined(); resolve({ close }); await Promise.resolve(); expect(close).toHaveBeenCalledOnce();
  });
});
