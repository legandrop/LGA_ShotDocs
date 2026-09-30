import { describe, expect, it } from 'vitest';
import { AlreadySentError, localDay, MAX_RETRIES, PART_BYTES, Portero, PorteroError, retryDelay, UploadError } from './portero';

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
  json?: Record<string, unknown>;
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
  /** El archivo de la app ya está en Drive: `POST /upload` responde `done` en vez de abrir una subida. */
  alreadyInDrive = false;
  /** `POST /upload` responde 200 sin `uploadId` (una respuesta que no se entiende). */
  emptyStart = false;
  /** Lo que responde al terminar sobre si la base se enteró (`undefined`: la prueba de media, sin `linked`). */
  linked?: boolean;
  folder: { id: string; name: string } | null = null;

  readonly fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer token-1');
    const call: Call = { method: init.method ?? 'GET', path: url.pathname, range: headers.get('Content-Range') ?? undefined };
    const body = init.body instanceof Blob ? new Uint8Array(await init.body.arrayBuffer()) : null;
    if (body) call.bytes = body.byteLength;
    if (typeof init.body === 'string') call.json = JSON.parse(init.body) as Record<string, unknown>;
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
      if (this.emptyStart) return json({});
      if (this.alreadyInDrive) {
        return json({ status: 'done', file: { id: 'drive-file-9', name: 'IMG_0001.MOV', mimeType: 'video/quicktime', size }, linked: true });
      }
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
        const file = { id: 'drive-file-1', name: 'IMG_0001.MOV', mimeType: 'video/quicktime', size: up.size };
        return json(this.linked === undefined ? { status: 'done', file } : { status: 'done', file, linked: this.linked });
      }
      return json({ status: 'incomplete', received: up.received });
    }
    if (call.method === 'POST' && call.path === '/pass') {
      const { fileId, file, type } = JSON.parse(String(init.body)) as { fileId?: string; file?: string; type?: string };
      return json({ url: `${BASE}/m/${file ? `app-${file}` : fileId}${type ? `-${type}` : ''}` });
    }
    if (call.method === 'POST' && call.path === '/trash') {
      const { file } = call.json as { file: string };
      if (file === 'in-use') return json({ error: 'A page still uses this file: it is not in the trash.' }, 409);
      if (file === 'member') {
        return json({ error: 'Only the owner or an admin of the workspace can send files to the Google Drive trash.' }, 403);
      }
      return json({ status: 'done', file, drive: 'trashed' });
    }
    if (call.method === 'GET' && call.path === '/drive/status') {
      return json({ connected: true, broken: null, email: 'lega@example.com', isOwner: true, folder: this.folder, picker: true });
    }
    if (call.method === 'POST' && call.path === '/drive/picker') {
      return json({ apiKey: 'key-1', appId: '123456789', token: 'ya29.short' });
    }
    if (call.method === 'POST' && call.path === '/drive/folder') {
      const { parentId } = call.json as { parentId: string | null };
      this.folder = parentId ? { id: parentId, name: 'Trabajo' } : null;
      return json({ folder: this.folder });
    }
    if (call.method === 'POST' && call.path === '/drive/connect') {
      return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?return=${String(call.json?.return ?? '')}` });
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

describe('portero: archivos de la app (pasos 6 y 8)', () => {
  it('sube un archivo de la app con su id y el día, y dice si la base se enteró', async () => {
    const server = new FakePortero();
    server.linked = false;
    const file = makeFile(MB);
    const id = '6f1c2a4e-0b7d-4c8e-9f10-112233445566';

    const result = await server.portero().upload(file, { appFile: { id, day: '2026-09-30' } });

    expect(server.calls[0].json).toEqual({ file: id, name: 'IMG_0001.MOV', mime: 'video/quicktime', size: MB, day: '2026-09-30' });
    expect(result).toMatchObject({ id: 'drive-file-1', linked: false });
    expect(await same(file, server.stored())).toBe(true);
  });

  it('si el archivo ya está en Drive, no manda nada', async () => {
    const server = new FakePortero();
    server.alreadyInDrive = true;
    const result = await server.portero().upload(makeFile(MB), { appFile: { id: 'x', day: '2026-09-30' } });
    expect(result).toMatchObject({ id: 'drive-file-9', linked: true });
    expect(server.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /upload']);
  });

  it('la prueba de media sigue igual: sin file ni day, y sin linked', async () => {
    const server = new FakePortero();
    const result = await server.portero().upload(makeFile(MB));
    expect(server.calls[0].json).toEqual({ name: 'IMG_0001.MOV', mime: 'video/quicktime', size: MB });
    expect('linked' in result).toBe(false);
  });

  it('pide un pase para un archivo de la app', async () => {
    const server = new FakePortero();
    expect(await server.portero().pass({ file: 'abc' })).toBe(`${BASE}/m/app-abc`);
    expect(server.calls[0].json).toEqual({ file: 'abc' });
    expect(await server.portero().pass({ fileId: 'drive-file-1' })).toBe(`${BASE}/m/drive-file-1`);
  });

  it('estado con la carpeta y el selector, el selector de Google y elegir la carpeta', async () => {
    const server = new FakePortero();
    const portero = server.portero();
    expect(await portero.status()).toMatchObject({ folder: null, picker: true, isOwner: true });
    expect(await portero.picker()).toEqual({ apiKey: 'key-1', appId: '123456789', token: 'ya29.short' });
    expect(await portero.setFolder('1AbCdEfGhIjK')).toEqual({ id: '1AbCdEfGhIjK', name: 'Trabajo' });
    expect(server.calls.at(-1)?.json).toEqual({ parentId: '1AbCdEfGhIjK' });
    expect(await portero.status()).toMatchObject({ folder: { id: '1AbCdEfGhIjK', name: 'Trabajo' } });
    expect(await portero.setFolder(null)).toBeNull();
    expect(server.calls.at(-1)?.json).toEqual({ parentId: null });
  });

  it('conectar vuelve a la ruta pedida', async () => {
    const server = new FakePortero();
    expect(await server.portero().connect('/p/123')).toMatch(/return=\/p\/123$/);
    expect(server.calls[0].json).toEqual({ return: '/p/123' });
    await server.portero().connect();
    expect(server.calls[1].json).toEqual({});
  });

  it('el día es el local, AAAA-MM-DD', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('una respuesta que no se entiende al empezar no se toma como falta de red', async () => {
    const server = new FakePortero();
    server.emptyStart = true;
    const error = (await server.portero().upload(makeFile(MB)).catch((e: unknown) => e)) as UploadError;
    expect(error).toBeInstanceOf(UploadError);
    expect(error.status).toBe(502);
    expect(error.message).toMatch(/did not start the upload/);
  });

  it('manda un archivo a la papelera de Drive con la sesión, y los errores traen el estado y el texto', async () => {
    const server = new FakePortero();
    const portero = server.portero();
    expect(await portero.trash('f-1')).toEqual({ status: 'done', file: 'f-1', drive: 'trashed' });
    expect(server.calls[0]).toMatchObject({ method: 'POST', path: '/trash', json: { file: 'f-1' } });

    const inUse = (await portero.trash('in-use').catch((e: unknown) => e)) as PorteroError;
    expect(inUse).toBeInstanceOf(PorteroError);
    expect(inUse).toMatchObject({ status: 409, retryable: false, message: 'A page still uses this file: it is not in the trash.' });
    const member = (await portero.trash('member').catch((e: unknown) => e)) as PorteroError;
    expect(member).toMatchObject({ status: 403, retryable: false });
    expect(member.message).toMatch(/owner or an admin/);

    server.fail = (call) => (call.path === '/trash' ? 502 : undefined);
    const drive = (await portero.trash('f-2').catch((e: unknown) => e)) as PorteroError;
    expect(drive).toMatchObject({ status: 502, retryable: true });
    // Una sola vez: mandar a la papelera no se reintenta solo.
    expect(server.calls.filter((c) => c.json?.file === 'f-2')).toHaveLength(1);
  });

  it('con onlyIfSent nunca abre una subida nueva', async () => {
    const server = new FakePortero();
    const error = await server
      .portero()
      .upload(makeFile(MB), { appFile: { id: 'x', day: '2026-09-30' }, onlyIfSent: true })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AlreadySentError);
    expect(server.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /upload']);
    server.alreadyInDrive = true;
    const done = await server.portero().upload(makeFile(MB), { appFile: { id: 'x', day: '2026-09-30' }, onlyIfSent: true });
    expect(done).toMatchObject({ id: 'drive-file-9', linked: true });
  });
});
