// El CRC32 de los archivos del zip de "Download all" (Docs/Doc_Carpetas.md, sección 9): el mismo de zlib
// (polinomio 0xEDB88320). Se calcula de a 8 bytes por vuelta con 8 tablas (slice-by-8): unas cinco veces más rápido
// que de a uno, y alcanza para seguir a la red. Corre en un Web Worker (`crc32.worker.ts`) para no trabar la
// pantalla con archivos de varios GB; si el navegador no deja crearlo, en la página.

const TABLES: Uint32Array[] = (() => {
  const tables = Array.from({ length: 8 }, () => new Uint32Array(256));
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tables[0]![n] = c >>> 0;
  }
  for (let n = 0; n < 256; n++) {
    let c = tables[0]![n]!;
    for (let t = 1; t < 8; t++) {
      c = tables[0]![c & 0xff]! ^ (c >>> 8);
      tables[t]![n] = c >>> 0;
    }
  }
  return tables;
})();

/**
 * Suma `data` al CRC que se lleva (`crc`, el resultado de la vuelta anterior; 0 al empezar), como `crc32(crc, buf)`
 * de zlib. Devuelve un entero sin signo.
 */
export function crc32Update(crc: number, data: Uint8Array): number {
  const [t0, t1, t2, t3, t4, t5, t6, t7] = TABLES as [Uint32Array, Uint32Array, Uint32Array, Uint32Array, Uint32Array, Uint32Array, Uint32Array, Uint32Array];
  let c = ~crc;
  let i = 0;
  const n = data.length;
  const end8 = n - (n % 8);
  while (i < end8) {
    const a = (data[i]! | (data[i + 1]! << 8) | (data[i + 2]! << 16) | (data[i + 3]! << 24)) ^ c;
    c =
      t7[a & 0xff]! ^
      t6[(a >>> 8) & 0xff]! ^
      t5[(a >>> 16) & 0xff]! ^
      t4[a >>> 24]! ^
      t3[data[i + 4]!]! ^
      t2[data[i + 5]!]! ^
      t1[data[i + 6]!]! ^
      t0[data[i + 7]!]!;
    i += 8;
  }
  while (i < n) c = t0[(c ^ data[i++]!) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}

/** El CRC32 de un bloque entero. */
export function crc32(data: Uint8Array): number {
  return crc32Update(0, data);
}

/** El CRC de un archivo que llega de a pedazos. `update` no espera; `digest` da el resultado cuando terminó todo. */
export interface CrcStream {
  /** Suma un pedazo. Puede quedarse con él (lo pasa al Worker): quien llama no lo vuelve a usar. */
  update(chunk: Uint8Array): void;
  digest(): Promise<number>;
}

/** El cálculo en la página (las pruebas y los navegadores sin Worker). */
export function localCrc(): CrcStream {
  let crc = 0;
  return {
    update: (chunk) => {
      crc = crc32Update(crc, chunk);
    },
    digest: async () => crc,
  };
}

type Reply = { id: number; crc: number } | { id: number; error: string };

/**
 * Un Worker para todos los archivos de una bajada (se crea con la bajada y se cierra al terminar). Los pedazos se
 * le pasan sin copiar (`transfer`): el que llama ya los escribió. Si no se puede crear, todo va en la página. Si se
 * cae en el medio, el CRC del archivo en curso no se puede terminar (sus pedazos ya se pasaron): `digest` falla, la
 * bajada lo anota en la lista de lo que falta, y los archivos siguientes se calculan en la página.
 */
export class CrcWorkerPool {
  private worker: Worker | null = null;
  private next = 1;
  private waiting = new Map<number, { ok: (crc: number) => void; fail: (err: Error) => void }>();
  private broken: Error | null = null;

  constructor(create: () => Worker = () => new Worker(new URL('./crc32.worker.ts', import.meta.url), { type: 'module', name: 'crc32' })) {
    try {
      this.worker = create();
      this.worker.onmessage = (event: MessageEvent<Reply>) => {
        const reply = event.data;
        const wait = this.waiting.get(reply.id);
        if (!wait) return;
        this.waiting.delete(reply.id);
        if ('crc' in reply) wait.ok(reply.crc);
        else wait.fail(new Error(reply.error));
      };
      this.worker.onerror = (event) => {
        event.preventDefault?.();
        this.fail(new Error('The checksum worker stopped.'));
      };
    } catch {
      this.worker = null;
    }
  }

  /** Un CRC nuevo: en el Worker si hay, si no en la página. */
  stream(): CrcStream {
    const worker = this.worker;
    if (!worker || this.broken) return localCrc();
    const id = this.next++;
    return {
      update: (chunk) => {
        if (this.broken) return;
        // Solo se pasa sin copiar un pedazo que ocupa su memoria entera; si no, se copia.
        const own = chunk.byteOffset === 0 && chunk.byteLength === chunk.buffer.byteLength && chunk.buffer instanceof ArrayBuffer ? chunk : chunk.slice();
        worker.postMessage({ id, data: own }, [own.buffer as ArrayBuffer]);
      },
      digest: () =>
        new Promise<number>((ok, fail) => {
          if (this.broken) return fail(this.broken);
          this.waiting.set(id, { ok, fail });
          worker.postMessage({ id, end: true });
        }),
    };
  }

  private fail(err: Error) {
    this.broken = err;
    for (const wait of this.waiting.values()) wait.fail(err);
    this.waiting.clear();
  }

  close(): void {
    this.worker?.terminate();
    this.worker = null;
    this.fail(new Error('closed'));
  }
}
