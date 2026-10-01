import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { vi } from 'vitest';

// Lo que necesita la conversión de HEIC del navegador, en node, para las pruebas: un `OffscreenCanvas` que
// guarda los píxeles tal cual y "codifica" un JPEG de mentira (la cabecera de un JPEG y los píxeles crudos),
// `createImageBitmap` que lo vuelve a abrir, y `fetch` del `.wasm` de libheif desde el disco (la misma entrada
// que usa la app, `heicLib.ts`).

const MARK = 'RAW!';

interface FakeBitmap {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  close(): void;
}

class FakeContext {
  globalCompositeOperation = 'source-over';
  fillStyle = '#000';
  constructor(private readonly canvas: FakeOffscreenCanvas) {}
  putImageData(image: { data: Uint8ClampedArray; width: number; height: number }, x: number, y: number) {
    for (let row = 0; row < image.height; row++) {
      const from = row * image.width * 4;
      this.canvas.data.set(image.data.subarray(from, from + image.width * 4), ((y + row) * this.canvas.width + x) * 4);
    }
  }
  fillRect() {
    // Fondo blanco atrás de lo opaco: no cambia nada.
  }
  drawImage(bitmap: FakeBitmap, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number) {
    for (let row = 0; row < sh; row++) {
      for (let col = 0; col < sw; col++) {
        const from = ((sy + row) * bitmap.width + sx + col) * 4;
        this.canvas.data.set(bitmap.data.subarray(from, from + 4), ((dy + row) * this.canvas.width + dx + col) * 4);
      }
    }
  }
  getImageData(x: number, y: number, width: number, height: number) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row++) {
      const from = ((y + row) * this.canvas.width + x) * 4;
      data.set(this.canvas.data.subarray(from, from + width * 4), row * width * 4);
    }
    return { data, width, height };
  }
}

export class FakeOffscreenCanvas {
  data: Uint8ClampedArray;
  /**
   * Lo que hace el codificador: `ok`, un JPEG de mentira de los píxeles; `blank`, uno vacío (como pasado el tope de
   * área de iOS); `white`, uno todo blanco (un canvas vacío con el fondo blanco que se pinta atrás).
   */
  static mode: 'ok' | 'blank' | 'white' = 'ok';
  constructor(
    public width: number,
    public height: number,
  ) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }
  getContext() {
    return new FakeContext(this);
  }
  async convertToBlob({ type }: { type: string }) {
    const mode = FakeOffscreenCanvas.mode;
    const pixels = mode === 'ok' ? this.data : new Uint8ClampedArray(this.data.length).fill(mode === 'white' ? 255 : 0);
    const head = new TextEncoder().encode(`${MARK}${this.width}x${this.height};`);
    return new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46]), head, pixels as Uint8ClampedArray<ArrayBuffer>], { type });
  }
}

/** Abre un JPEG de mentira de `FakeOffscreenCanvas` (tira si no es uno). */
export async function fakeCreateImageBitmap(blob: Blob): Promise<FakeBitmap> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const text = new TextDecoder('latin1').decode(bytes);
  const at = text.indexOf(MARK);
  if (at < 0) throw new Error('The source image could not be decoded.');
  const end = text.indexOf(';', at);
  const [width, height] = text.slice(at + MARK.length, end).split('x').map(Number);
  return { width, height, data: new Uint8ClampedArray(bytes.subarray(end + 1, end + 1 + width * height * 4)), close() {} };
}

/** El `.wasm` de libheif, del disco. */
export function wasmBytes(): Uint8Array {
  const require = createRequire(import.meta.url);
  return readFileSync(require.resolve('libheif-js/libheif-wasm/libheif.wasm'));
}

/** Pone el canvas, `createImageBitmap`, `ImageData` y el `fetch` del `.wasm` de mentira. `wasm: false`: no baja. */
export function stubBrowser({ wasm = true }: { wasm?: boolean } = {}): { wasmFetches: () => number } {
  let fetches = 0;
  FakeOffscreenCanvas.mode = 'ok';
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  vi.stubGlobal('createImageBitmap', fakeCreateImageBitmap);
  if (typeof ImageData === 'undefined') {
    vi.stubGlobal(
      'ImageData',
      class {
        constructor(
          public data: Uint8ClampedArray,
          public width: number,
          public height: number,
        ) {}
      },
    );
  }
  vi.stubGlobal('fetch', async (url: string) => {
    if (!String(url).includes('libheif')) throw new TypeError(`unexpected fetch ${url}`);
    fetches++;
    if (!wasm) throw new TypeError('Failed to fetch');
    return new Response(wasmBytes() as Uint8Array<ArrayBuffer>, { status: 200, headers: { 'content-type': 'application/wasm' } });
  });
  return { wasmFetches: () => fetches };
}
