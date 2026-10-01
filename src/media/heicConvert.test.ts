import { afterEach, describe, expect, it, vi } from 'vitest';
import { HEIC_SAMPLE } from './fixtures/heicSample';
import { fakeCreateImageBitmap, stubBrowser } from './fixtures/fakeCanvas';
import { HEIC_TIMEOUT_MS } from './heic';

// La conversión del navegador (heicConvert.ts y heic.worker.ts, Docs/Doc_Imagenes.md, "Fotos HEIC"), en node:
// el Worker es de mentira, pero adentro corre el archivo del Worker de verdad con la librería de verdad (la misma
// entrada que la app); el canvas es de mentira (fixtures/fakeCanvas.ts). Lo que mira cada prueba: que siempre
// termina, y con qué motivo cuando no puede.

const heic = () => new Blob([Uint8Array.from(atob(HEIC_SAMPLE), (c) => c.charCodeAt(0))]);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.doUnmock('./heicLib');
  vi.resetModules();
});

type Listener = (event: { data?: unknown; reason?: unknown }) => void;

/** Un Worker que corre `heic.worker.ts` de verdad (con `self` de mentira). */
class ModuleWorker {
  static created = 0;
  static terminated = 0;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { preventDefault(): void; message?: string }) => void) | null = null;
  private readonly listeners: Record<string, Listener[]> = { message: [], unhandledrejection: [] };
  private readonly loaded: Promise<void>;
  constructor() {
    ModuleWorker.created++;
    vi.stubGlobal('self', {
      postMessage: (data: unknown) => setTimeout(() => this.onmessage?.({ data })),
      addEventListener: (type: string, fn: Listener) => this.listeners[type]?.push(fn),
    });
    vi.resetModules();
    this.loaded = import('./heic.worker').then(() => undefined);
  }
  postMessage(data: unknown) {
    void this.loaded.then(() => this.listeners.message.forEach((fn) => fn({ data })));
  }
  terminate() {
    ModuleWorker.terminated++;
  }
}

/** Un Worker que hace lo que se le dice. */
function scriptedWorker(script: (worker: { reply: (data: unknown) => void; fail: () => void }) => void) {
  return class {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((event: { preventDefault(): void; message?: string }) => void) | null = null;
    terminated = false;
    postMessage() {
      script({
        reply: (data) => setTimeout(() => this.onmessage?.({ data })),
        fail: () => setTimeout(() => this.onerror?.({ preventDefault: () => undefined, message: 'script error' })),
      });
    }
    terminate() {
      this.terminated = true;
    }
  };
}

async function size(jpeg: Blob) {
  const back = await fakeCreateImageBitmap(jpeg);
  return [back.width, back.height];
}

describe('conversión de HEIC en el navegador (heicConvert.ts)', () => {
  it('en el Worker: el archivo del Worker de verdad devuelve el JPEG derecho, y el Worker se cierra', async () => {
    stubBrowser();
    vi.stubGlobal('Worker', ModuleWorker);
    ModuleWorker.created = ModuleWorker.terminated = 0;
    const { convertHeic } = await import('./heicConvert');
    const jpeg = await convertHeic(heic());
    expect(jpeg.type).toBe('image/jpeg');
    expect(await size(jpeg)).toEqual([64, 96]);
    expect([ModuleWorker.created, ModuleWorker.terminated]).toEqual([1, 1]);
  });

  it('sin Worker (el navegador no deja crearlo): se convierte en la página', async () => {
    stubBrowser();
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('no module workers');
        }
      },
    );
    const { convertHeic } = await import('./heicConvert');
    expect(await size(await convertHeic(heic()))).toEqual([64, 96]);
  });

  it('si el script del Worker no arranca, se prueba en la página; si arrancó y se cae, falla (sin otro intento)', async () => {
    stubBrowser();
    vi.stubGlobal('Worker', scriptedWorker(({ fail }) => fail()));
    let { convertHeic } = await import('./heicConvert');
    expect(await size(await convertHeic(heic()))).toEqual([64, 96]);

    vi.resetModules();
    vi.stubGlobal(
      'Worker',
      scriptedWorker(({ reply, fail }) => {
        reply({ type: 'ready' });
        setTimeout(fail, 5);
      }),
    );
    ({ convertHeic } = await import('./heicConvert'));
    await expect(convertHeic(heic())).rejects.toMatchObject({ reason: 'failed' });
  });

  it('un Worker sin OffscreenCanvas manda los píxeles y el JPEG se hace en la página', async () => {
    stubBrowser();
    const data = new Uint8ClampedArray(4 * 3 * 4).fill(200);
    vi.stubGlobal(
      'Worker',
      scriptedWorker(({ reply }) => {
        reply({ type: 'ready' });
        reply({ type: 'pixels', width: 4, height: 3, data });
      }),
    );
    const { convertHeic } = await import('./heicConvert');
    expect(await size(await convertHeic(heic()))).toEqual([4, 3]);
  });

  it('siempre termina: un Worker que no arrancó es "no está" (unavailable); uno que arrancó y no contesta, "falló"', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('Worker', scriptedWorker(() => undefined));
    let { convertHeic } = await import('./heicConvert');
    let result = convertHeic(heic()).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(HEIC_TIMEOUT_MS + 1);
    expect(await result).toMatchObject({ reason: 'unavailable' });

    vi.resetModules();
    vi.stubGlobal('Worker', scriptedWorker(({ reply }) => reply({ type: 'ready' })));
    ({ convertHeic } = await import('./heicConvert'));
    result = convertHeic(heic()).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(HEIC_TIMEOUT_MS + 1);
    expect(await result).toMatchObject({ reason: 'failed' });
  });

  it('el respaldo en la página también tiene tope: si la librería no avisa nunca, falla', async () => {
    stubBrowser();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('Worker', undefined);
    // La librería se cae adentro de un `setTimeout` suyo y nunca llama al callback.
    const silent = { get_width: () => 64, get_height: () => 96, is_primary: () => true, display: () => undefined, free: () => undefined };
    vi.doMock('./heicLib', () => ({
      loadLibheif: async () => ({ HeifDecoder: class { decoder = null; decode = () => [silent]; } }),
    }));
    const { convertHeic } = await import('./heicConvert');
    const result = convertHeic(heic()).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(HEIC_TIMEOUT_MS + 1);
    expect(await result).toMatchObject({ reason: 'failed' });
  });

  it('sin el .wasm (sin red, nunca bajado): unavailable, en el Worker y en la página', async () => {
    stubBrowser({ wasm: false });
    vi.stubGlobal('Worker', ModuleWorker);
    let { convertHeic } = await import('./heicConvert');
    await expect(convertHeic(heic())).rejects.toMatchObject({ reason: 'unavailable' });
    vi.resetModules();
    vi.stubGlobal('Worker', undefined);
    ({ convertHeic } = await import('./heicConvert'));
    await expect(convertHeic(heic())).rejects.toMatchObject({ reason: 'unavailable' });
  });
});

describe('la cola carga el conversor sin import()', () => {
  // Un `import()` que falla sin red queda fallando en esa pestaña (el navegador guarda el fallo y no vuelve a
  // pedir el archivo): en la primera sesión de un dispositivo, un HEIC agregado sin red se subía sin convertir.
  // En node no se puede reproducir ese caché del navegador, así que se mira el código de la cola.
  it('queue.ts importa heicConvert en forma estática', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('./queue.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/^import \{[^}]*\bconvertHeic\b[^}]*\} from '\.\/heicConvert';$/m);
    expect(source).not.toMatch(/import\(\s*['"]\.\/heicConvert['"]\s*\)/);
  });
});
