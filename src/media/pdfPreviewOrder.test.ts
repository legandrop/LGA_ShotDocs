import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// La vista previa de los PDF (Docs/Doc_Adjuntos.md, entrega 2) sin pdf.js de verdad: de a una por vez, el Worker que
// vuelve como la página de la app, sin red, y una que se pasa del tiempo sin frenar a las siguientes.

let active = 0;
let maxActive = 0;
let hang = false;

vi.mock('./pdfLib', () => ({
  PDF_WORKER_URL: '/assets/pdf.worker.min-x.mjs',
  renderFirstPage: async (_d: Uint8Array, _s: number, make: (w: number, h: number) => unknown, timeoutMs: number) => {
    active++;
    maxActive = Math.max(maxActive, active);
    try {
      if (hang) {
        await new Promise((_, reject) => setTimeout(() => reject(new Error('The PDF took too long to draw.')), timeoutMs));
      }
      await new Promise((r) => setTimeout(r, 20));
      return make(10, 10);
    } finally {
      active--;
    }
  },
}));
vi.mock('./probe', async (orig) => ({
  ...(await orig<typeof import('./probe')>()),
  thumbFromCanvas: async () => new Blob([new Uint8Array([0xff, 0xd8])], { type: 'image/jpeg' }),
}));

const pdf = () => new Blob([new Uint8Array(100)], { type: 'application/pdf' });
const script = () => new Response('x', { headers: { 'Content-Type': 'text/javascript' } });

describe('attachmentPreview', () => {
  beforeEach(() => {
    vi.resetModules();
    active = 0;
    maxActive = 0;
    hang = false;
    // Solo hace falta que exista `document` (en Node no hay); el canvas lo crea la imitación de pdfLib.
    (globalThis as unknown as { document: unknown }).document = { createElement: () => ({ width: 0, height: 0 }) };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete (globalThis as unknown as { document?: unknown }).document;
  });

  it('cinco a la vez se hacen de a una', async () => {
    vi.stubGlobal('fetch', async () => script());
    const { attachmentPreview } = await import('./pdfPreview');
    const out = await Promise.all([1, 2, 3, 4, 5].map((i) => attachmentPreview(pdf(), 'application/pdf', `${i}.pdf`)));
    expect(out.every((b) => b instanceof Blob)).toBe(true);
    expect(maxActive).toBe(1);
  });

  it('el Worker que vuelve como la página de la app (200 text/html, una pestaña vieja después de publicar): PreviewUnavailable', async () => {
    vi.stubGlobal('fetch', async () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
    const { attachmentPreview, PreviewUnavailable } = await import('./pdfPreview');
    await expect(attachmentPreview(pdf(), 'application/pdf', 'a.pdf')).rejects.toBeInstanceOf(PreviewUnavailable);
  });

  it('sin red: PreviewUnavailable, y la siguiente vuelve a probar', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      throw new TypeError('Failed to fetch');
    });
    const { attachmentPreview, PreviewUnavailable } = await import('./pdfPreview');
    await expect(attachmentPreview(pdf(), 'application/pdf', 'a.pdf')).rejects.toBeInstanceOf(PreviewUnavailable);
    await expect(attachmentPreview(pdf(), 'application/pdf', 'b.pdf')).rejects.toBeInstanceOf(PreviewUnavailable);
    expect(calls).toBe(2);
  });

  it('una que se pasa del tiempo da null y no frena a las siguientes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal('fetch', async () => script());
    const { attachmentPreview, PDF_PREVIEW_TIMEOUT_MS } = await import('./pdfPreview');
    hang = true;
    const first = attachmentPreview(pdf(), 'application/pdf', 'lento.pdf');
    const second = attachmentPreview(pdf(), 'application/pdf', 'b.pdf');
    await vi.advanceTimersByTimeAsync(PDF_PREVIEW_TIMEOUT_MS + 10);
    hang = false;
    expect(await first).toBeNull();
    await vi.advanceTimersByTimeAsync(PDF_PREVIEW_TIMEOUT_MS + 100);
    // La segunda también arrancó trabada y se pasa del tiempo: lo que importa es que termina.
    expect(await second).toBeNull();
    const third = attachmentPreview(pdf(), 'application/pdf', 'c.pdf');
    await vi.advanceTimersByTimeAsync(100);
    expect(await third).toBeInstanceOf(Blob);
  });
});
