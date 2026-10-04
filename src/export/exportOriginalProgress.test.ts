import { afterEach, describe, expect, it, vi } from 'vitest';
import { DownloadTimeout, ORIGINAL_TIMEOUT_MS, deviceImages, withDeadline } from './exportImages';
import { porteroDownload } from '../ui/sharpImages';

// Reloj y stream controlados: mismos bytes/cancelación que recibe el lector real, sin portero ni Drive externos.
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
function streamed() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; }, cancel });
  const response = new Response(body, { headers: { 'Content-Type': 'image/jpeg' } });
  const pass = vi.fn(async () => 'https://portero.test/m/foto');
  const fetchImpl = vi.fn(async () => response);
  const download = porteroDownload({ pass }, fetchImpl);
  const source = deviceImages({
    localImage: vi.fn(async () => null), view: vi.fn(async () => null),
    source: vi.fn(async () => ({ kind: 'image', original: null })) as never,
  }, { originals: download });
  const start = (outer?: AbortSignal) => withDeadline((signal, received) => source.original!('foto', signal, received), ORIGINAL_TIMEOUT_MS, outer);
  return { controller, cancel, body, response, pass, fetchImpl, download, source, start };
}

describe('original del PDF: tiempo sin bytes', () => {
  it.each(['pase', 'cabeceras'])('el plazo empieza antes de esperar %s: 30 s sin bytes abortan', async stage => {
    vi.useFakeTimers(); let signal: AbortSignal | undefined;
    const pass = vi.fn(() => stage === 'pase' ? new Promise<string>(() => undefined) : Promise.resolve('https://portero.test/m/espera'));
    const fetchImpl = vi.fn((_url: string, s?: AbortSignal) => { signal = s; return new Promise<Response>(() => undefined); });
    const download = porteroDownload({ pass }, fetchImpl);
    const work = withDeadline((s, received) => download('espera', s, received), ORIGINAL_TIMEOUT_MS).catch(e => e);
    await vi.advanceTimersByTimeAsync(29_999); expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1); expect(await work).toBeInstanceOf(DownloadTimeout);
    expect(pass).toHaveBeenCalledOnce(); expect(fetchImpl).toHaveBeenCalledTimes(stage === 'pase' ? 0 : 1);
    if (signal) expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('avanza cada 20 s y llega entero después de 120 s, con MIME y bytes exactos', async () => {
    vi.useFakeTimers(); const s = streamed(); let ended = false;
    const work = s.start().finally(() => { ended = true; });
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(20_000);
      expect(ended).toBe(false);
      s.controller.enqueue(new Uint8Array([i, 255]));
    }
    s.controller.close();
    const blob = await work;
    expect(blob?.type).toBe('image/jpeg');
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(new Uint8Array([0,255,1,255,2,255,3,255,4,255,5,255]));
    expect(s.source.originalsFetched()).toBe(1);
    expect(s.cancel).not.toHaveBeenCalled(); expect(s.body.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cabeceras sin cuerpo no renuevan: a 30 s vence, cancela el lector y no cuenta original completo', async () => {
    vi.useFakeTimers(); const s = streamed();
    const work = s.start().catch(e => e);
    await vi.advanceTimersByTimeAsync(29_999); expect(s.cancel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(await work).toBeInstanceOf(DownloadTimeout);
    expect(s.cancel).toHaveBeenCalledTimes(1); expect(s.body.locked).toBe(false);
    expect(s.source.originalsFetched()).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });

  it('un chunk positivo renueva; chunks vacíos no sostienen una descarga detenida', async () => {
    vi.useFakeTimers(); const s = streamed(); const work = s.start().catch(e => e);
    await vi.advanceTimersByTimeAsync(20_000); s.controller.enqueue(new Uint8Array([1]));
    await vi.advanceTimersByTimeAsync(20_000); s.controller.enqueue(new Uint8Array());
    await vi.advanceTimersByTimeAsync(9_999); expect(s.cancel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(await work).toBeInstanceOf(DownloadTimeout);
    expect(s.cancel).toHaveBeenCalledTimes(1); expect(s.body.locked).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, -1, NaN, Infinity])('el contrato no renueva por progreso inválido %s', async bytes => {
    vi.useFakeTimers(); let received!: (n: number) => void;
    const work = withDeadline((_signal, cb) => { received = cb; return new Promise(() => undefined); }, ORIGINAL_TIMEOUT_MS).catch(e => e);
    await vi.advanceTimersByTimeAsync(20_000); received(bytes);
    await vi.advanceTimersByTimeAsync(10_000); expect(await work).toBeInstanceOf(DownloadTimeout); expect(vi.getTimerCount()).toBe(0);
    received(10); expect(vi.getTimerCount()).toBe(0);
  });

  it('el original local queda intacto y no pasa por la red', async () => {
    const original = new Blob(['original'], { type: 'image/jpeg' }); const download = vi.fn();
    const source = deviceImages({ localImage: async () => original, view: async () => null,
      source: (async () => ({ kind: 'image', original })) as never }, { originals: download });
    const got = await withDeadline((signal, received) => source.original!('local', signal, received), ORIGINAL_TIMEOUT_MS);
    expect(got).toBe(original); expect(download).not.toHaveBeenCalled(); expect(source.originalsFetched()).toBe(0);
  });
});

describe('cancelación y compatibilidad de la descarga', () => {
  it('Cancel durante un read pendiente cancela/libera el lector y limpia el listener', async () => {
    vi.useFakeTimers(); const s = streamed(); const ctl = new AbortController();
    const add = vi.spyOn(ctl.signal, 'addEventListener'); const remove = vi.spyOn(ctl.signal, 'removeEventListener');
    const work = s.start(ctl.signal).catch(e => e);
    await vi.advanceTimersByTimeAsync(0); s.controller.enqueue(new Uint8Array([1]));
    await vi.advanceTimersByTimeAsync(5_000); ctl.abort();
    expect((await work).name).toBe('AbortError'); await vi.advanceTimersByTimeAsync(0);
    expect(s.cancel).toHaveBeenCalledTimes(1); expect(s.body.locked).toBe(false); expect(vi.getTimerCount()).toBe(0);
    expect(remove.mock.calls[0][1]).toBe(add.mock.calls[0][1]);
    expect(s.source.originalsFetched()).toBe(0);
  });

  it('Cancel esperando cabeceras aborta fetch y vuelve sin esperar su respuesta', async () => {
    vi.useFakeTimers(); const outer = new AbortController(); let signal!: AbortSignal;
    const download = porteroDownload({ pass: async () => 'https://portero.test/m/cabecera' }, (_url, s) => {
      signal = s!; return new Promise(() => undefined);
    });
    const work = withDeadline((s, received) => download('a', s, received), ORIGINAL_TIMEOUT_MS, outer.signal).catch(e => e);
    await vi.advanceTimersByTimeAsync(0); outer.abort();
    expect((await work).name).toBe('AbortError'); expect(signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });

  it('ya cancelado no empieza trabajo ni fetch, y un callback tardío no recrea timers', async () => {
    vi.useFakeTimers(); const ctl = new AbortController(); ctl.abort(); const run = vi.fn();
    await expect(withDeadline(run, ORIGINAL_TIMEOUT_MS, ctl.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(run).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    const fetchImpl = vi.fn(); const download = porteroDownload({ pass: async () => 'https://portero.test/m/x' }, fetchImpl);
    await expect(download('a', ctl.signal, () => undefined)).rejects.toMatchObject({ name: 'AbortError' }); expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fallo del stream libera su lector; no se entrega un Blob parcial', async () => {
    vi.useFakeTimers(); const s = streamed(); const work = s.start().catch(e => e);
    await vi.advanceTimersByTimeAsync(0); s.controller.enqueue(new Uint8Array([1]));
    s.controller.error(new Error('cuerpo roto'));
    // deviceImages conserva su respuesta de fallo sin aborto: null, para usar best y el aviso existente.
    expect(await work).toBeNull(); expect(s.body.locked).toBe(false); expect(s.source.originalsFetched()).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });

  it('sin callback conserva res.blob, sus bytes y MIME', async () => {
    const res = new Response('foto', { headers: { 'Content-Type': 'image/jpeg' } });
    const blob = vi.spyOn(res, 'blob');
    const download = porteroDownload({ pass: async () => 'https://portero.test/m/sin-progreso' }, async () => res);
    const got = await download('a');
    expect(await got.text()).toBe('foto'); expect(got.type).toBe('image/jpeg'); expect(blob).toHaveBeenCalledOnce();
  });

  it('renueva un pase vencido una vez, cancela cuerpo de error y conserva bytes positivos del pase nuevo', async () => {
    const cancel = vi.fn(); const error = new Response(new ReadableStream({ cancel }), { status: 410 });
    let n = 0; const pass = vi.fn(async () => `https://portero.test/m/pase-${++n}`);
    const fetchImpl = vi.fn(async url => url.endsWith('pase-1') ? error : new Response('foto', { headers: { 'Content-Type': 'image/jpeg' } }));
    const received = vi.fn(); const download = porteroDownload({ pass }, fetchImpl);
    expect(await (await download('a', undefined, received)).text()).toBe('foto');
    expect(pass).toHaveBeenCalledTimes(2); expect(cancel).toHaveBeenCalledOnce(); expect(received.mock.calls).toEqual([[4]]);
    await download('a', undefined, received); expect(pass).toHaveBeenCalledTimes(2);
  });

  it('una excepción síncrona del origen también limpia timer y listener', async () => {
    vi.useFakeTimers(); const ctl = new AbortController(); const remove = vi.spyOn(ctl.signal, 'removeEventListener');
    await expect(withDeadline(() => { throw new Error('origen'); }, ORIGINAL_TIMEOUT_MS, ctl.signal)).rejects.toThrow('origen');
    expect(vi.getTimerCount()).toBe(0); expect(remove).toHaveBeenCalledOnce();
  });
});
