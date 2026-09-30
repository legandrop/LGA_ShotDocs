import { describe, expect, it } from 'vitest';
import { MAX_RETRIES, PART_BYTES, Portero, retryDelay, UploadError } from './portero';

const MB = 1024 * 1024;
const BASE = 'https://media.example.com';

/** Un archivo con bytes que cambian, para ver que cada parte llega en su lugar. */
function makeFile(size: number, name = 'IMG_0001.MOV', type = 'video/quicktime'): File {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = i % 251;
  return new File([bytes], name, { type });
}

interface Call {
  method: string;
  path: string;
  range?: string;
  bytes?: number;
}

/**
 * Un portero en memoria con las mismas respuestas que portero/src/core.ts. `fail` decide, antes de cada
 * pedido, si se corta: devuelve `'network'` (se corta la red), un status HTTP, o `undefined` (anda).
 * `keep` (en un corte de red) deja guardada la primera parte de lo que se mandó, como si se hubiera
 * cortado a mitad de camino.
 */
class FakePortero {
  readonly calls: Call[] = [];
  readonly waits: number[] = [];
  private upload: { size: number; data: Uint8Array; received: number } | null = null;
  fail?: (call: Call, index: number) => 'network' | number | undefined;
  keep = 0;

  readonly fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer token-1');
    const call: Call = { method: init.method ?? 'GET', path: url.pathname, range: headers.get('Content-Range') ?? undefined };
    const body = init.body instanceof Blob ? new Uint8Array(await init.body.arrayBuffer()) : null;
    if (body) call.bytes = body.byteLength;
    this.calls.push(call);
    if (init.signal?.aborted) throw init.signal.reason;

    const failure = this.fail?.(call, this.calls.length - 1);
    if (failure === 'network') {
      const part = /^bytes (\d+)-/.exec(call.range ?? '');
      if (part && body && this.keep && this.upload) {
        const start = Number(part[1]);
        this.upload.data.set(body.subarray(0, this.keep), start);
        this.upload.received = start + this.keep;
      }
      throw new TypeError('Load failed');
    }
    if (typeof failure === 'number') return json({ error: `Failed with ${failure}` }, failure);

    if (call.method === 'POST' && call.path === '/upload') {
      const { size } = JSON.parse(String(init.body)) as { size: number };
      this.upload = { size, data: new Uint8Array(size), received: 0 };
      return json({ uploadId: 'up-1' });
    }
    if (call.method === 'PUT' && call.path === '/upload/up-1') {
      const up = this.upload;
      if (!up) return json({ error: 'This upload does not exist anymore: start it again.' }, 404);
      const part = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(call.range ?? '');
      if (part && body) {
        const [start, end] = [Number(part[1]), Number(part[2])];
        expect(start).toBe(up.received);
        expect(body.byteLength).toBe(end - start + 1);
        up.data.set(body, start);
        up.received = end + 1;
      }
      if (up.received === up.size) {
        return json({ status: 'done', file: { id: 'drive-file-1', name: 'IMG_0001.MOV', mimeType: 'video/quicktime', size: up.size } });
      }
      return json({ status: 'incomplete', received: up.received });
    }
    if (call.method === 'POST' && call.path === '/pass') {
      const { fileId, type } = JSON.parse(String(init.body)) as { fileId: string; type?: string };
      return json({ url: `${BASE}/m/${fileId}${type ? `-${type}` : ''}` });
    }
    return json({ error: 'Not found' }, 404);
  };

  portero(): Portero {
    return new Portero(`${BASE}/`, {
      fetch: this.fetch,
      token: async () => 'token-1',
      wait: async (ms, signal) => {
        this.waits.push(ms);
        if (signal?.aborted) throw signal.reason;
      },
    });
  }

  stored(): Uint8Array {
    return this.upload!.data;
  }

  parts(): (string | undefined)[] {
    return this.calls.filter((c) => c.method === 'PUT').map((c) => c.range);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function same(file: File, stored: Uint8Array): Promise<boolean> {
  const original = new Uint8Array(await file.arrayBuffer());
  return original.length === stored.length && original.every((b, i) => b === stored[i]);
}

describe('portero: subida por partes', () => {
  it('sube en partes de 8 MiB y la última con lo que queda', async () => {
    const server = new FakePortero();
    const size = 2 * PART_BYTES + 3 * MB + 17;
    const file = makeFile(size);
    const progress: number[] = [];

    const result = await server.portero().upload(file, { onProgress: (p) => progress.push(p.sent) });

    expect(PART_BYTES % (256 * 1024)).toBe(0);
    expect(result.id).toBe('drive-file-1');
    expect(server.calls[0]).toMatchObject({ method: 'POST', path: '/upload' });
    expect(server.parts()).toEqual([
      `bytes 0-${PART_BYTES - 1}/${size}`,
      `bytes ${PART_BYTES}-${2 * PART_BYTES - 1}/${size}`,
      `bytes ${2 * PART_BYTES}-${size - 1}/${size}`,
    ]);
    expect(server.calls.filter((c) => c.bytes).map((c) => c.bytes)).toEqual([PART_BYTES, PART_BYTES, 3 * MB + 17]);
    expect(progress.at(-1)).toBe(size);
    expect(await same(file, server.stored())).toBe(true);
  });

  it('si se corta a mitad de una parte, pregunta cuánto llegó y sigue desde ahí', async () => {
    const server = new FakePortero();
    const size = 3 * PART_BYTES;
    const file = makeFile(size);
    // La segunda parte se corta cuando llegaron 4 MiB.
    server.keep = 4 * MB;
    let cut = false;
    server.fail = (call) => {
      if (!cut && call.range?.startsWith(`bytes ${PART_BYTES}-`)) {
        cut = true;
        return 'network';
      }
    };
    let retries = 0;

    await server.portero().upload(file, { onProgress: (p) => (retries = p.retries) });

    expect(server.parts()).toEqual([
      `bytes 0-${PART_BYTES - 1}/${size}`,
      `bytes ${PART_BYTES}-${2 * PART_BYTES - 1}/${size}`,
      `bytes */${size}`,
      `bytes ${PART_BYTES + 4 * MB}-${PART_BYTES + 4 * MB + PART_BYTES - 1}/${size}`,
      `bytes ${2 * PART_BYTES + 4 * MB}-${size - 1}/${size}`,
    ]);
    expect(server.waits).toEqual([1000]);
    expect(retries).toBe(1);
    expect(await same(file, server.stored())).toBe(true);
  });

  it('reintenta los 5xx con esperas cada vez más largas', async () => {
    const server = new FakePortero();
    const file = makeFile(MB);
    let left = 3;
    server.fail = (call) => (call.method === 'PUT' && call.bytes && left-- > 0 ? 502 : undefined);

    await server.portero().upload(file);

    expect(server.waits).toEqual([1000, 2000, 4000]);
    expect(await same(file, server.stored())).toBe(true);
  });

  it(`se rinde después de ${MAX_RETRIES} reintentos seguidos`, async () => {
    const server = new FakePortero();
    server.fail = (call) => (call.method === 'PUT' ? 'network' : undefined);

    const error = await server.portero().upload(makeFile(MB)).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UploadError);
    expect((error as UploadError).message).toMatch(/after 8 failed retries/);
    expect((error as UploadError).uploadId).toBe('up-1');
    expect(server.waits).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    expect(server.calls.filter((c) => c.method === 'PUT')).toHaveLength(MAX_RETRIES + 1);
    expect(retryDelay(20)).toBe(30000);
  });

  it('no reintenta un 403', async () => {
    const server = new FakePortero();
    server.fail = (call) => (call.method === 'PUT' ? 403 : undefined);

    const error = await server.portero().upload(makeFile(MB)).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UploadError);
    expect((error as UploadError).status).toBe(403);
    expect(server.waits).toEqual([]);
    expect(server.calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  });

  it('se detiene al cancelar, también mientras espera para reintentar', async () => {
    const server = new FakePortero();
    const size = 3 * PART_BYTES;
    const controller = new AbortController();
    const error = await server
      .portero()
      .upload(makeFile(size), {
        signal: controller.signal,
        onProgress: (p) => {
          if (p.sent === PART_BYTES) controller.abort();
        },
      })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UploadError);
    expect((error as UploadError).cancelled).toBe(true);
    expect((error as UploadError).uploadId).toBe('up-1');
    expect(server.parts()).toHaveLength(1);

    const waiting = new FakePortero();
    const stop = new AbortController();
    waiting.fail = () => 'network';
    const portero = new Portero(BASE, {
      fetch: waiting.fetch,
      token: async () => 'token-1',
      wait: (_ms, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason));
          stop.abort();
        }),
    });
    const second = await portero.upload(makeFile(MB), { signal: stop.signal }).catch((e: unknown) => e);
    expect((second as UploadError).cancelled).toBe(true);
    expect(waiting.calls).toHaveLength(1);
  });

  it('retoma una subida a medias y, si el portero ya no la tiene, empieza de nuevo', async () => {
    const server = new FakePortero();
    const size = PART_BYTES + MB;
    const file = makeFile(size);
    server.fail = (call) => (call.range?.startsWith(`bytes ${PART_BYTES}-`) ? 403 : undefined);
    const first = (await server.portero().upload(file).catch((e: unknown) => e)) as UploadError;
    expect(first.uploadId).toBe('up-1');
    expect(first.sent).toBe(PART_BYTES);

    server.fail = undefined;
    server.calls.length = 0;
    await server.portero().upload(file, { resume: first.uploadId });
    expect(server.parts()).toEqual([`bytes */${size}`, `bytes ${PART_BYTES}-${size - 1}/${size}`]);
    expect(await same(file, server.stored())).toBe(true);

    const fresh = new FakePortero();
    await fresh.portero().upload(file, { resume: 'up-1' });
    expect(fresh.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'PUT /upload/up-1',
      'POST /upload',
      'PUT /upload/up-1',
      'PUT /upload/up-1',
    ]);
  });

  it('pide un pase, con el tipo forzado si se pide', async () => {
    const server = new FakePortero();
    expect(await server.portero().pass('drive-file-1')).toBe(`${BASE}/m/drive-file-1`);
    expect(await server.portero().pass('drive-file-1', 'video/mp4')).toBe(`${BASE}/m/drive-file-1-video/mp4`);
  });
});
