import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AlreadySentError,
  answerLimit,
  CONTROL_TIMEOUT_MS,
  localDay,
  MAX_RETRIES,
  PART_BYTES,
  Portero,
  PorteroError,
  retryDelay,
  STALL_CHECK_MS,
  STALL_MS,
  UploadError,
  xhrSend,
  type PartSender,
} from './portero';

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
      if (file === 'in-use') return json({ error: 'A page still uses this file: it is not in the trash.', code: 'in_use' }, 409);
      if (file === 'no-drive') return json({ error: 'Google Drive is not connected.', code: 'drive_not_connected' }, 503);
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
    expect(inUse).toMatchObject({
      status: 409,
      code: 'in_use',
      retryable: false,
      message: 'A page still uses this file: it is not in the trash.',
    });
    expect(await portero.trash('no-drive').catch((e: unknown) => e)).toMatchObject({ status: 503, code: 'drive_not_connected' });
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

// Ningún pedido de una subida puede quedar esperando para siempre (Docs/Doc_Portero.md, "Subidas que se
// traban"). El tiempo no pasa de verdad: el reloj es de la prueba y el vigilante mira cuando se lo adelanta.
describe('portero: pedidos que dejan de moverse', () => {
  let clock = 0;

  beforeEach(() => {
    clock = 1_000_000;
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Pasa el tiempo, de a una mirada del vigilante por vez, como cuando pasa de verdad. */
  function elapse(ms: number): void {
    for (let left = ms; left > 0; left -= STALL_CHECK_MS) {
      const step = Math.min(left, STALL_CHECK_MS);
      clock += step;
      vi.advanceTimersByTime(step);
    }
  }
  /** El reloj salta `ms` entre dos miradas seguidas del vigilante (no pudo mirar en el medio). */
  function jump(ms: number): void {
    clock += ms;
    vi.advanceTimersByTime(STALL_CHECK_MS);
  }
  /** Deja correr lo que esté listo (unos milisegundos de verdad). */
  const settle = () => new Promise((r) => setTimeout(r, 15));
  /** Un pedido que no contesta nunca: solo termina si lo abortan. */
  const hang = (signal?: AbortSignal | null) =>
    new Promise<never>((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }));

  /** La subida, y si ya terminó (bien o mal). */
  function track<T>(work: Promise<T>): { result: Promise<T | UploadError>; settled: () => boolean } {
    let settled = false;
    const result = work.catch((e: unknown) => e as UploadError).finally(() => (settled = true));
    return { result, settled: () => settled };
  }

  function portero(server: FakePortero, deps: { fetch?: typeof fetch; send?: PartSender } = {}): Portero {
    return new Portero(BASE, {
      fetch: deps.fetch ?? server.fetch,
      send: deps.send,
      token: async () => 'token-1',
      wait: async (ms) => void server.waits.push(ms),
      now: () => clock,
    });
  }

  interface SlowPart {
    size: number;
    /** Salieron estos bytes (el total de la parte hasta ahí). */
    sent: (bytes: number) => void;
    /** La parte le llega al portero. */
    arrive: () => void;
  }

  /** Las partes como las manda la app, con lo que sale y cuándo llega en manos de la prueba. */
  function slowSend(server: FakePortero): { send: PartSender; part: () => SlowPart } {
    const parts: SlowPart[] = [];
    const send: PartSender = async (url, init) => {
      await Promise.race([
        new Promise<void>((arrive) => parts.push({ size: init.body.size, sent: init.onSent, arrive })),
        hang(init.signal),
      ]);
      return server.fetch(url, { method: init.method, headers: init.headers, body: init.body, signal: init.signal });
    };
    return {
      send,
      part: () => {
        expect(parts.length).toBeGreaterThan(0);
        return parts[parts.length - 1];
      },
    };
  }

  it('si abrir la subida no contesta, se corta al minuto, sin reintentar', async () => {
    const server = new FakePortero();
    const calls: string[] = [];
    const { result, settled } = track(
      portero(server, {
        fetch: (input, init) => {
          calls.push(`${init?.method} ${new URL(String(input)).pathname}`);
          return hang(init?.signal);
        },
      }).upload(makeFile(MB)),
    );
    await settle();
    elapse(CONTROL_TIMEOUT_MS - 2 * STALL_CHECK_MS);
    await settle();
    expect(settled()).toBe(false);
    elapse(3 * STALL_CHECK_MS);

    const error = await result;
    expect(error).toBeInstanceOf(UploadError);
    expect(error).toMatchObject({ stalled: true, cancelled: false, status: 408, uploadId: null, sent: 0 });
    expect((error as UploadError).message).toMatch(/stopped moving/);
    expect(calls).toEqual(['POST /upload']);
    expect(server.waits).toEqual([]);
  });

  it('si la pregunta de cuánto llegó no contesta, se corta y la subida queda para retomar', async () => {
    const server = new FakePortero();
    const { result } = track(portero(server, { fetch: (_input, init) => hang(init?.signal) }).upload(makeFile(MB), { resume: 'up-7' }));
    await settle();
    elapse(CONTROL_TIMEOUT_MS + STALL_CHECK_MS);
    expect(await result).toMatchObject({ stalled: true, status: 408, uploadId: 'up-7' });
  });

  it('si lo que no contesta es el token de la sesión, también se corta', async () => {
    const server = new FakePortero();
    const stuck = new Portero(BASE, { fetch: server.fetch, token: () => new Promise<string | null>(() => undefined), now: () => clock });
    const { result, settled } = track(stuck.upload(makeFile(MB)));
    await settle();
    elapse(CONTROL_TIMEOUT_MS - 2 * STALL_CHECK_MS);
    await settle();
    expect(settled()).toBe(false);
    elapse(3 * STALL_CHECK_MS);
    expect(await result).toMatchObject({ stalled: true, status: 408, uploadId: null });
    // No llegó a pedirle nada al portero.
    expect(server.calls).toEqual([]);
  });

  it('el tiempo que el equipo estuvo suspendido no cuenta: al despertar, una parte sana no se corta', async () => {
    const server = new FakePortero();
    const slow = slowSend(server);
    const file = makeFile(MB);
    const { result, settled } = track(portero(server, { send: slow.send }).upload(file));
    await settle();
    slow.part().sent(1000);
    elapse(30_000);
    // Diez minutos con la tapa cerrada: el vigilante no pudo mirar y el pedido tampoco pudo moverse.
    jump(600_000);
    await settle();
    expect(settled()).toBe(false);
    // Despierta y sigue subiendo: termina bien.
    elapse(STALL_MS - 30_000 - 2 * STALL_CHECK_MS);
    await settle();
    expect(settled()).toBe(false);
    slow.part().sent(MB);
    slow.part().arrive();
    expect(await result).toMatchObject({ id: 'drive-file-1' });
    expect(await same(file, server.stored())).toBe(true);

    // Si después de despertar el pedido quedó muerto, se corta: el plazo siguió desde donde estaba.
    const dead = new FakePortero();
    const frozen = slowSend(dead);
    const second = track(portero(dead, { send: frozen.send }).upload(makeFile(MB)));
    await settle();
    frozen.part().sent(1000);
    elapse(30_000);
    jump(600_000);
    elapse(STALL_MS - 30_000 - 2 * STALL_CHECK_MS);
    await settle();
    expect(second.settled()).toBe(false);
    elapse(3 * STALL_CHECK_MS);
    expect(await second.result).toMatchObject({ stalled: true, uploadId: 'up-1' });
  });

  it('con la pestaña en segundo plano (el navegador deja mirar una vez por minuto) sigue cortando', async () => {
    const server = new FakePortero();
    const slow = slowSend(server);
    const { result, settled } = track(portero(server, { send: slow.send }).upload(makeFile(MB)));
    await settle();
    slow.part().sent(1000);
    jump(60_000);
    await settle();
    expect(settled()).toBe(false);
    jump(60_000);
    expect(await result).toMatchObject({ stalled: true, uploadId: 'up-1' });
  });

  it('una pestaña tan frenada que mira menos de una vez por minuto y medio igual corta: se descuentan a lo sumo dos huecos seguidos', async () => {
    const server = new FakePortero();
    const slow = slowSend(server);
    const { result, settled } = track(portero(server, { send: slow.send }).upload(makeFile(MB)));
    await settle();
    slow.part().sent(1000);
    // Cada mirada llega 100 s después de la anterior: cada hueco parece una suspensión (`FROZEN_GAP_MS`).
    for (let i = 1; i <= 3; i++) {
      jump(100_000);
      await settle();
      expect(settled()).toBe(false);
    }
    // Los dos primeros huecos no contaron; el tercero sí (100 s), y con el cuarto pasa el plazo.
    jump(100_000);
    await settle();
    expect(settled()).toBe(true);
    expect(await result).toMatchObject({ stalled: true, uploadId: 'up-1' });

    // Un movimiento vuelve a dar los dos huecos: una suspensión de verdad, después de que salieron bytes, no corta.
    const other = new FakePortero();
    const again = slowSend(other);
    const second = track(portero(other, { send: again.send }).upload(makeFile(MB)));
    await settle();
    again.part().sent(1000);
    jump(100_000);
    jump(100_000);
    again.part().sent(2000);
    jump(600_000);
    await settle();
    expect(second.settled()).toBe(false);
    again.part().sent(MB);
    again.part().arrive();
    expect(await second.result).toMatchObject({ id: 'drive-file-1' });
  });

  it('si el equipo se suspende mientras sale el cuerpo, la espera de la respuesta no se alarga por eso', async () => {
    const server = new FakePortero();
    const slow = slowSend(server);
    const { result, settled } = track(portero(server, { send: slow.send }).upload(makeFile(MB)));
    await settle();
    slow.part().sent(1000);
    elapse(30_000);
    // Diez minutos suspendido en medio del cuerpo; al despertar termina de salir.
    jump(600_000);
    slow.part().sent(MB);
    // El cuerpo tardó unos 35 s de verdad: a la respuesta se le dan los 2 minutos más eso, no 2 minutos más otros 2.
    elapse(STALL_MS + 35_000 + 3 * STALL_CHECK_MS);
    await settle();
    expect(settled()).toBe(true);
    expect(await result).toMatchObject({ stalled: true, uploadId: 'up-1' });

    // Lo mismo si al despertar el cuerpo termina de salir antes de que el vigilante vuelva a mirar.
    const other = new FakePortero();
    const late = slowSend(other);
    const second = track(portero(other, { send: late.send }).upload(makeFile(MB)));
    await settle();
    late.part().sent(1000);
    elapse(30_000);
    clock += 600_000;
    late.part().sent(MB);
    elapse(STALL_MS + 35_000 + 3 * STALL_CHECK_MS);
    await settle();
    expect(second.settled()).toBe(true);
  });

  it('recuerda el plazo que funcionó: detrás de un proxy que recibe el cuerpo de golpe, el archivo siguiente no se traba antes de pasar', async () => {
    const size = 4 * MB;
    const server = new FakePortero();
    const slow = slowSend(server);
    const client = portero(server, { send: slow.send });
    // El cuerpo sale de golpe y la respuesta llega a los dos minutos y medio: el proxy lo sube despacio.
    const WAIT = STALL_MS + 30_000;

    // Primer archivo: ya se había trabado una vez, así que tiene más plazo y pasa.
    const first = track(client.upload(makeFile(size), { stalledBefore: 1 }));
    await settle();
    slow.part().sent(size);
    elapse(WAIT);
    slow.part().arrive();
    expect(await first.result).toMatchObject({ id: 'drive-file-1' });

    // Segundo archivo, desde cero: con el plazo de siempre se cortaría a los dos minutos; con lo aprendido, espera.
    const second = track(client.upload(makeFile(size)));
    await settle();
    slow.part().sent(size);
    elapse(WAIT);
    await settle();
    expect(second.settled()).toBe(false);
    slow.part().arrive();
    expect(await second.result).toMatchObject({ id: 'drive-file-1' });

    // Lo aprendido tiene techo: una parte colgada se sigue cortando, a lo sumo en lo que tardaría con una red lenta.
    const third = track(client.upload(makeFile(size)));
    await settle();
    slow.part().sent(size);
    elapse(answerLimit(size, 50) + 3 * STALL_CHECK_MS);
    await settle();
    expect(third.settled()).toBe(true);
    expect(await third.result).toMatchObject({ stalled: true });

    // Detrás de un proxy todavía más lento (5 minutos), lo aprendido daría 7 minutos: el techo, 6 y monedas, manda.
    const slower = new FakePortero();
    const slowerSend = slowSend(slower);
    const other = portero(slower, { send: slowerSend.send });
    const learned = track(other.upload(makeFile(size), { stalledBefore: 2 }));
    await settle();
    slowerSend.part().sent(size);
    elapse(300_000);
    slowerSend.part().arrive();
    await learned.result;
    expect(STALL_MS + 300_000).toBeGreaterThan(answerLimit(size, 50));
    const capped = track(other.upload(makeFile(size)));
    await settle();
    slowerSend.part().sent(size);
    elapse(answerLimit(size, 50) - 2 * STALL_CHECK_MS);
    await settle();
    expect(capped.settled()).toBe(false);
    elapse(3 * STALL_CHECK_MS);
    await settle();
    expect(capped.settled()).toBe(true);

    // Otro cliente (otra sesión, otro portero) arranca con el plazo de siempre.
    const fresh = new FakePortero();
    const freshSend = slowSend(fresh);
    const fourth = track(portero(fresh, { send: freshSend.send }).upload(makeFile(size)));
    await settle();
    freshSend.part().sent(size);
    elapse(STALL_MS + 3 * STALL_CHECK_MS);
    await settle();
    expect(fourth.settled()).toBe(true);
  });

  it('una parte chica que tarda en contestar no cambia el plazo de las grandes', async () => {
    const server = new FakePortero();
    const slow = slowSend(server);
    const client = portero(server, { send: slow.send });
    // Una foto de 100 KB cuya respuesta tarda un minuto y medio (Drive lento un rato, no un proxy).
    const small = track(client.upload(makeFile(100 * 1024), { stalledBefore: 1 }));
    await settle();
    slow.part().sent(100 * 1024);
    elapse(90_000);
    slow.part().arrive();
    expect(await small.result).toMatchObject({ id: 'drive-file-1' });
    // Una parte grande colgada se sigue cortando con el plazo de siempre.
    const big = track(client.upload(makeFile(4 * MB)));
    await settle();
    slow.part().sent(4 * MB);
    elapse(STALL_MS + 3 * STALL_CHECK_MS);
    await settle();
    expect(big.settled()).toBe(true);
  });

  it('una respuesta rápida olvida lo aprendido: sin el proxy, una parte colgada vuelve a cortarse a los dos minutos', async () => {
    const size = 4 * MB;
    const server = new FakePortero();
    const slow = slowSend(server);
    const client = portero(server, { send: slow.send });
    const first = track(client.upload(makeFile(size), { stalledBefore: 1 }));
    await settle();
    slow.part().sent(size);
    elapse(STALL_MS + 30_000);
    slow.part().arrive();
    await first.result;
    // Ahora contesta enseguida.
    const second = track(client.upload(makeFile(size)));
    await settle();
    slow.part().sent(size);
    elapse(1000);
    slow.part().arrive();
    expect(await second.result).toMatchObject({ id: 'drive-file-1' });
    // Y la siguiente, colgada, se corta con el plazo de siempre.
    const third = track(client.upload(makeFile(size)));
    await settle();
    slow.part().sent(size);
    elapse(STALL_MS + 3 * STALL_CHECK_MS);
    await settle();
    expect(third.settled()).toBe(true);
  });

  it('una parte por la que no sale ni un byte se corta a los dos minutos, con la subida para retomar', async () => {
    const server = new FakePortero();
    const slow = slowSend(server);
    const { result, settled } = track(portero(server, { send: slow.send }).upload(makeFile(MB)));
    await settle();
    // Sale algo y después nada más. Que vuelva a avisar la misma cantidad no cuenta como movimiento.
    slow.part().sent(1000);
    elapse(STALL_MS - 2 * STALL_CHECK_MS);
    slow.part().sent(1000);
    await settle();
    expect(settled()).toBe(false);
    elapse(3 * STALL_CHECK_MS);

    expect(await result).toMatchObject({ stalled: true, status: 408, uploadId: 'up-1', sent: 0 });
    // La parte no llegó al portero, y no se reintentó.
    expect(server.parts()).toEqual([]);
    expect(server.waits).toEqual([]);
  });

  it('una parte lenta no se corta mientras sigan saliendo bytes, tarde lo que tarde', async () => {
    const server = new FakePortero();
    const slow = slowSend(server);
    const file = makeFile(MB);
    const { result, settled } = track(portero(server, { send: slow.send }).upload(file));
    await settle();
    // 30 tramos de casi dos minutos: la parte tarda 55 minutos, 27 veces el tiempo del vigilante.
    const steps = 30;
    for (let i = 1; i < steps; i++) {
      elapse(STALL_MS - 2 * STALL_CHECK_MS);
      slow.part().sent(Math.floor((MB * i) / steps));
    }
    await settle();
    expect(settled()).toBe(false);
    slow.part().sent(MB);
    slow.part().arrive();

    expect(await result).toMatchObject({ id: 'drive-file-1' });
    expect(server.parts()).toEqual([`bytes 0-${MB - 1}/${MB}`]);
    expect(await same(file, server.stored())).toBe(true);
  });

  it('con el cuerpo entero afuera, a la respuesta se le da el plazo más lo que tardó el cuerpo (hasta el doble)', async () => {
    // El cuerpo tardó un minuto: la respuesta puede tardar tres.
    const server = new FakePortero();
    const slow = slowSend(server);
    const { result, settled } = track(portero(server, { send: slow.send }).upload(makeFile(MB)));
    await settle();
    elapse(60_000);
    slow.part().sent(MB);
    elapse(STALL_MS + 60_000 - 2 * STALL_CHECK_MS);
    await settle();
    expect(settled()).toBe(false);
    elapse(3 * STALL_CHECK_MS);
    expect(await result).toMatchObject({ stalled: true, uploadId: 'up-1' });

    // El cuerpo tardó diez minutos (yendo de a poco): la respuesta puede tardar cuatro, no doce.
    const other = new FakePortero();
    const slower = slowSend(other);
    const second = track(portero(other, { send: slower.send }).upload(makeFile(MB)));
    await settle();
    for (let i = 1; i <= 10; i++) {
      elapse(60_000);
      slower.part().sent((MB * i) / 10);
    }
    elapse(2 * STALL_MS - 2 * STALL_CHECK_MS);
    await settle();
    expect(second.settled()).toBe(false);
    elapse(3 * STALL_CHECK_MS);
    expect(await second.result).toMatchObject({ stalled: true });
  });

  it('cada trabada seguida le da más plazo a la respuesta de la parte, hasta lo que tardaría con una red lenta', async () => {
    expect(answerLimit(PART_BYTES)).toBe(STALL_MS);
    expect(answerLimit(PART_BYTES, 1)).toBe(2 * STALL_MS);
    expect(answerLimit(PART_BYTES, 2)).toBe(3 * STALL_MS);
    // El techo: el plazo más la parte entera a 16 KiB/s. 8 MiB son 512 s más; 1 MiB, 64 s más.
    expect(answerLimit(PART_BYTES, 50)).toBe(STALL_MS + 512_000);
    expect(answerLimit(MB, 50)).toBe(STALL_MS + 64_000);

    // El cuerpo sale de golpe y la respuesta tarda dos minutos y medio: la primera vez se corta...
    const server = new FakePortero();
    const slow = slowSend(server);
    const first = track(portero(server, { send: slow.send }).upload(makeFile(MB)));
    await settle();
    slow.part().sent(MB);
    elapse(STALL_MS + 3 * STALL_CHECK_MS);
    expect(await first.result).toMatchObject({ stalled: true, uploadId: 'up-1' });

    // ...y al retomarla sabiendo que ya se trabó una vez, la misma espera no la corta.
    const second = track(portero(server, { send: slow.send }).upload(makeFile(MB), { resume: 'up-1', stalledBefore: 1 }));
    await settle();
    slow.part().sent(MB);
    elapse(STALL_MS + 30_000);
    await settle();
    expect(second.settled()).toBe(false);
    slow.part().arrive();
    expect(await second.result).toMatchObject({ id: 'drive-file-1' });
  });

  it('sin saber cuántos bytes salen (solo fetch), una parte no se corta por tiempo', async () => {
    const server = new FakePortero();
    let arrive!: () => void;
    const gate = new Promise<void>((resolve) => (arrive = resolve));
    const { result, settled } = track(
      portero(server, {
        fetch: async (input, init) => {
          if (init?.body instanceof Blob) await gate;
          return server.fetch(input, init);
        },
      }).upload(makeFile(MB)),
    );
    await settle();
    elapse(10 * STALL_MS);
    await settle();
    expect(settled()).toBe(false);
    arrive();
    expect(await result).toMatchObject({ id: 'drive-file-1' });
  });

  it('cancelar un pedido vigilado sigue siendo cancelar, no una trabada', async () => {
    const server = new FakePortero();
    const slow = slowSend(server);
    const controller = new AbortController();
    const { result } = track(portero(server, { send: slow.send }).upload(makeFile(MB), { signal: controller.signal }));
    await settle();
    controller.abort();
    expect(await result).toMatchObject({ cancelled: true, stalled: false, uploadId: 'up-1' });
  });

  it('con renewIfEmpty abre otra subida solo si la que hay contesta que no recibió nada', async () => {
    // No recibió nada: pregunta, abre otra y manda.
    const empty = new FakePortero();
    empty.fail = (call) => (call.bytes ? 403 : undefined);
    const first = (await portero(empty).upload(makeFile(MB)).catch((e: unknown) => e)) as UploadError;
    expect(first).toMatchObject({ uploadId: 'up-1', sent: 0 });
    empty.fail = undefined;
    empty.calls.length = 0;
    await portero(empty).upload(makeFile(MB), { resume: 'up-1', renewIfEmpty: true });
    expect(empty.calls.map((c) => `${c.method} ${c.path} ${c.range ?? ''}`.trim())).toEqual([
      `PUT /upload/up-1 bytes */${MB}`,
      'POST /upload',
      `PUT /upload/up-1 bytes 0-${MB - 1}/${MB}`,
    ]);

    // Ya recibió la primera parte: se sigue con ella.
    const half = new FakePortero();
    const size = PART_BYTES + MB;
    const file = makeFile(size);
    half.fail = (call) => (call.range?.startsWith(`bytes ${PART_BYTES}-`) ? 403 : undefined);
    await portero(half).upload(file).catch(() => undefined);
    half.fail = undefined;
    half.calls.length = 0;
    await portero(half).upload(file, { resume: 'up-1', renewIfEmpty: true });
    expect(half.calls.map((c) => `${c.method} ${c.range}`)).toEqual([`PUT bytes */${size}`, `PUT bytes ${PART_BYTES}-${size - 1}/${size}`]);
    expect(await same(file, half.stored())).toBe(true);

    // Ya terminó (la respuesta de la última parte se había perdido): no abre otra ni manda nada.
    const done = new FakePortero();
    await portero(done).upload(makeFile(MB));
    done.calls.length = 0;
    const result = await portero(done).upload(makeFile(MB), { resume: 'up-1', renewIfEmpty: true });
    expect(result.id).toBe('drive-file-1');
    expect(done.calls.map((c) => `${c.method} ${c.range}`)).toEqual([`PUT bytes */${MB}`]);
  });
});

/** Un `XMLHttpRequest` de mentira: guarda lo que le piden y la prueba decide qué pasa. */
class FakeXhr {
  static made: FakeXhr[] = [];
  /** Si está, cada pedido se pasa a este `fetch` y se contesta con lo que devuelva. */
  static forward: typeof fetch | null = null;
  upload: { onprogress: ((event: { loaded: number }) => void) | null; onload: (() => void) | null } = { onprogress: null, onload: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  responseType = '';
  status = 0;
  responseText = '';
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: Blob | null = null;
  aborted = false;

  constructor() {
    FakeXhr.made.push(this);
  }
  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }
  getResponseHeader(): string | null {
    return 'application/json';
  }
  send(body: Blob): void {
    this.body = body;
    const forward = FakeXhr.forward;
    if (!forward) return;
    void forward(this.url, { method: this.method, headers: this.headers, body }).then(async (res) => {
      this.upload.onprogress?.({ loaded: body.size });
      this.upload.onload?.();
      this.answer(res.status, await res.text());
    });
  }
  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }
  answer(status: number, text: string): void {
    this.status = status;
    this.responseText = text;
    this.onload?.();
  }
}

// El `XMLHttpRequest` de estas pruebas es de mentira: comprueban que la app lo usa bien (qué le pide, qué
// hace con sus avisos), no lo que hace el del navegador.
describe('portero: las partes por XMLHttpRequest', () => {
  beforeEach(() => {
    FakeXhr.made = [];
    FakeXhr.forward = null;
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const init = (extra: { signal?: AbortSignal; onSent?: (bytes: number) => void } = {}) => ({
    method: 'PUT',
    headers: { Authorization: 'Bearer token-1', 'Content-Range': 'bytes 0-999/1000' },
    body: new Blob([new Uint8Array(1000)]),
    onSent: extra.onSent ?? (() => undefined),
    signal: extra.signal,
  });

  it('manda el pedido, avisa los bytes que salen y devuelve la respuesta', async () => {
    const sent: number[] = [];
    const answer = xhrSend(`${BASE}/upload/up-1`, init({ onSent: (bytes) => sent.push(bytes) }));
    const xhr = FakeXhr.made[0];
    expect(xhr).toMatchObject({ method: 'PUT', url: `${BASE}/upload/up-1` });
    expect(xhr.headers).toEqual({ Authorization: 'Bearer token-1', 'Content-Range': 'bytes 0-999/1000' });
    expect(xhr.body?.size).toBe(1000);

    xhr.upload.onprogress?.({ loaded: 400 });
    xhr.upload.onprogress?.({ loaded: 900 });
    xhr.upload.onload?.();
    expect(sent).toEqual([400, 900, 1000]);

    xhr.answer(200, JSON.stringify({ status: 'incomplete', received: 1000 }));
    const res = await answer;
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ status: 'incomplete', received: 1000 });
  });

  it('un error del portero llega con su estado y su texto', async () => {
    const answer = xhrSend(`${BASE}/upload/up-1`, init());
    FakeXhr.made[0].answer(507, JSON.stringify({ error: 'The Drive is full.' }));
    const res = await answer;
    expect(res.status).toBe(507);
    expect(await res.json()).toEqual({ error: 'The Drive is full.' });
  });

  it('una respuesta sin cuerpo (204) llega como tal', async () => {
    const answer = xhrSend(`${BASE}/upload/up-1`, init());
    FakeXhr.made[0].answer(204, '');
    const res = await answer;
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  it('si se corta la red, falla como fetch; si se aborta, corta el pedido', async () => {
    const cut = xhrSend(`${BASE}/upload/up-1`, init());
    FakeXhr.made[0].onerror?.();
    await expect(cut).rejects.toBeInstanceOf(TypeError);

    const controller = new AbortController();
    const aborted = xhrSend(`${BASE}/upload/up-1`, init({ signal: controller.signal }));
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeXhr.made[1].aborted).toBe(true);

    // Ya abortado antes de empezar: ni se manda.
    await expect(xhrSend(`${BASE}/upload/up-1`, init({ signal: controller.signal }))).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeXhr.made).toHaveLength(2);
  });

  it('en la app (sin fetch propio) las partes van por XMLHttpRequest y lo demás por fetch', async () => {
    const server = new FakePortero();
    vi.stubGlobal('fetch', server.fetch);
    FakeXhr.forward = server.fetch;
    const size = PART_BYTES + MB;
    const file = makeFile(size);

    const result = await new Portero(BASE, { token: async () => 'token-1' }).upload(file);

    expect(result.id).toBe('drive-file-1');
    expect(FakeXhr.made.map((x) => x.headers['Content-Range'])).toEqual([
      `bytes 0-${PART_BYTES - 1}/${size}`,
      `bytes ${PART_BYTES}-${size - 1}/${size}`,
    ]);
    expect(server.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /upload', 'PUT /upload/up-1', 'PUT /upload/up-1']);
    expect(await same(file, server.stored())).toBe(true);
  });

  it('una parte que no termina de salir se corta, se aborta el pedido y la subida queda para retomar', async () => {
    const server = new FakePortero();
    vi.stubGlobal('fetch', server.fetch);
    let clock = 0;
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const upload = new Portero(BASE, { token: async () => 'token-1', now: () => clock })
      .upload(makeFile(MB))
      .catch((e: unknown) => e as UploadError);
    for (let i = 0; i < 100 && FakeXhr.made.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
    for (let passed = 0; passed <= STALL_MS; passed += STALL_CHECK_MS) {
      clock += STALL_CHECK_MS;
      vi.advanceTimersByTime(STALL_CHECK_MS);
    }

    expect(await upload).toMatchObject({ stalled: true, uploadId: 'up-1', sent: 0 });
    expect(FakeXhr.made[0].aborted).toBe(true);
  });
});
