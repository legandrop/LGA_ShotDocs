import { describe, expect, it } from 'vitest';
import { crc32, crc32Update, CrcWorkerPool, localCrc } from './crc32';
import { NameSpace, numbered, safeName } from './zipNames';
import { dosTime, ZipTooBig, ZipWriter, type ZipSink } from './zipWriter';
import { cutText, graphemesOf } from '../lib/graphemes';
import { cleanFileName } from './attachments';
import { concat, hasPython, pythonReadHoles, pythonReadZip, text } from '../test/zipCheck';

// El zip de "Download all" (P.9, entrega 2, Docs/Doc_Carpetas.md, sección 9): sin comprimir, CRC32, Zip64 y los
// nombres que vienen de Drive. Cada zip se abre con un lector que no es nuestro (Python, `zipfile.testzip()`).

class MemorySink implements ZipSink {
  chunks: Uint8Array[] = [];
  async write(chunk: Uint8Array) {
    this.chunks.push(chunk.slice());
  }
  bytes() {
    return concat(this.chunks);
  }
}

async function* chunked(data: Uint8Array, size = 1000): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < data.length; i += size) yield data.slice(i, i + size);
}

const enc = (s: string) => new TextEncoder().encode(s);
const random = (n: number, seed = 1) => {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
};

describe('crc32', () => {
  it('da los valores de referencia y lo mismo de a pedazos', () => {
    expect(crc32(enc('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
    expect(crc32(enc('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
    const data = random(100_003);
    let c = 0;
    for (let i = 0; i < data.length; i += 777) c = crc32Update(c, data.subarray(i, i + 777));
    expect(c).toBe(crc32(data));
  });

  it('el Worker recibe los pedazos sin copiar y da el mismo CRC; si no se puede crear, se calcula en la página', async () => {
    // Un Worker de mentira que corre el mismo código en este hilo, con mensajes asincrónicos como uno de verdad.
    const posted: Transferable[][] = [];
    const fakeWorker = () => {
      const running = new Map<number, number>();
      const w = {
        onmessage: null as ((e: MessageEvent) => void) | null,
        onerror: null,
        postMessage(msg: { id: number; data?: Uint8Array; end?: boolean }, transfer: Transferable[] = []) {
          posted.push(transfer);
          const copy = msg.data ? msg.data.slice() : undefined;
          queueMicrotask(() => {
            if (copy) running.set(msg.id, crc32Update(running.get(msg.id) ?? 0, copy));
            if (msg.end) w.onmessage?.({ data: { id: msg.id, crc: running.get(msg.id) ?? 0 } } as MessageEvent);
          });
        },
        terminate() {},
      };
      return w as unknown as Worker;
    };
    const pool = new CrcWorkerPool(fakeWorker);
    const a = pool.stream();
    const b = pool.stream();
    const data = random(5000, 7);
    a.update(data.slice(0, 2000));
    b.update(enc('123456789'));
    a.update(data.subarray(2000)); // una vista sobre otro buffer: se copia antes de pasarla
    expect(await a.digest()).toBe(crc32(data));
    expect(await b.digest()).toBe(0xcbf43926);
    expect(posted.filter((t) => t.length).length).toBe(3);
    pool.close();
    const broken = new CrcWorkerPool(() => {
      throw new Error('no workers here');
    });
    const local = broken.stream();
    local.update(enc('123456789'));
    expect(await local.digest()).toBe(0xcbf43926);
  });
});

describe('ZipWriter', () => {
  it('sin comprimir, con carpetas vacías, nombres en UTF-8 y el CRC de cada archivo (lo lee Python)', async () => {
    const sink = new MemorySink();
    const zip = new ZipWriter(sink);
    const photo = random(70_000, 3);
    await zip.addDirectory('Rodaje Día 2');
    await zip.addDirectory('Rodaje Día 2/Vacía');
    await zip.addFile('Rodaje Día 2/foto 🇦🇷.jpg', photo.length, new Date(2026, 9, 1, 10, 30, 12), chunked(photo, 4096));
    await zip.addFile('Rodaje Día 2/notas.txt', 5, null, chunked(enc('hola!')));
    await zip.addFile('Rodaje Día 2/vacío.bin', 0, null, chunked(new Uint8Array()));
    const total = await zip.finish();
    const bytes = sink.bytes();
    expect(bytes.length).toBe(total);
    // Store: los bytes de la foto están tal cual adentro.
    const at = bytes.findIndex((_, i) => bytes[i] === photo[0] && bytes[i + 1] === photo[1] && bytes[i + 2] === photo[2] && bytes[i + 3] === photo[3]);
    expect(at).toBeGreaterThan(0);
    expect(bytes.subarray(at, at + photo.length)).toEqual(photo);
    if (!hasPython) return;
    const py = pythonReadZip(bytes);
    expect(py.bad).toBeNull();
    expect(py.entries.map((e) => e.name)).toEqual([
      'Rodaje Día 2/',
      'Rodaje Día 2/Vacía/',
      'Rodaje Día 2/foto 🇦🇷.jpg',
      'Rodaje Día 2/notas.txt',
      'Rodaje Día 2/vacío.bin',
    ]);
    expect(py.entries[2]!.size).toBe(70_000);
    expect(py.entries[2]!.crc).toBe(crc32(photo));
    expect(text(py.entries[3])).toBe('hola!');
    expect(py.entries[4]!.size).toBe(0);
  });

  it('con Zip64 en todos los archivos (como uno de más de 4 GiB) también lo lee Python', async () => {
    const sink = new MemorySink();
    const zip = new ZipWriter(sink, { forceZip64: true });
    await zip.addDirectory('A');
    await zip.addFile('A/uno.bin', 3000, null, chunked(random(3000, 5)));
    await zip.addFile('A/dos.txt', null, null, chunked(enc('dos')));
    await zip.finish();
    const bytes = sink.bytes();
    // El registro y el localizador de Zip64 están antes del final.
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(bytes.length - 22 - 20, true)).toBe(0x07064b50);
    if (!hasPython) return;
    const py = pythonReadZip(bytes);
    expect(py.bad).toBeNull();
    expect(py.entries.map((e) => [e.name, e.size])).toEqual([
      ['A/', 0],
      ['A/uno.bin', 3000],
      ['A/dos.txt', 3],
    ]);
  });

  it(
    'un archivo de más de 4 GiB sin escribirlo entero: Zip64 en el archivo, en el índice y en el final (lo lee Python)',
    async () => {
      // Lo que se escribe se guarda salvo los datos del archivo grande (ceros): Python los lee como "huecos".
      const BIG = 4 * 1024 ** 3 + 123_457;
      const segments: [number, Uint8Array][] = [];
      let at = 0;
      let inBig = false;
      const sink: ZipSink = {
        async write(chunk) {
          if (!inBig) segments.push([at, chunk.slice()]);
          at += chunk.length;
        },
      };
      const zero = new Uint8Array(32 * 1024 * 1024);
      async function* big() {
        inBig = true;
        let left = BIG;
        while (left > 0) {
          const n = Math.min(left, zero.length);
          left -= n;
          yield n === zero.length ? zero : zero.subarray(0, n);
        }
        inBig = false;
      }
      // El CRC de verdad de 4 GiB de ceros (lo comprueba Python), armado sin recorrerlos: los bloques son iguales.
      const combined = zeroCrc(BIG, zero.length, crc32(zero));
      let calls = 0;
      const zip2 = new ZipWriter(sink, {
        // El segundo archivo es el grande; los otros, con el CRC de siempre.
        crc: () => (calls++ === 1 ? { update: () => undefined, digest: async () => combined } : localCrc()),
      });
      await zip2.addDirectory('Videos');
      await zip2.addFile('Videos/antes.txt', 5, null, chunked(enc('antes')));
      await zip2.addFile('Videos/A001_C002.mov', BIG, null, big());
      await zip2.addFile('Videos/después.txt', 7, null, chunked(enc('después')));
      const total = await zip2.finish();
      expect(total).toBe(at);
      expect(total).toBeGreaterThan(BIG);
      if (!hasPython) return;
      const py = pythonReadHoles(total, segments);
      expect(py.bad).toBeNull();
      expect(py.entries.map((e) => [e.name, e.size])).toEqual([
        ['Videos/', 0],
        ['Videos/antes.txt', 5],
        ['Videos/A001_C002.mov', BIG],
        ['Videos/después.txt', 8],
      ]);
      // El que va después del grande empieza pasados los 4 GiB: su lugar va en el Zip64 del índice.
      expect(text(py.entries[3])).toBe('después');
    },
    120_000,
  );

  it('un archivo que dijo pesar menos de 4 GiB y no para: falla todo (no hay cómo arreglar el encabezado)', async () => {
    const sink: ZipSink = { write: async () => undefined };
    const zip = new ZipWriter(sink, { crc: () => ({ update: () => undefined, digest: async () => 0 }) });
    const zero = new Uint8Array(256 * 1024 * 1024);
    async function* endless() {
      for (let i = 0; i < 17; i++) yield zero;
    }
    await expect(zip.addFile('mentira.bin', 1000, null, endless())).rejects.toBeInstanceOf(ZipTooBig);
  });

  it('un archivo que se corta en el medio queda con lo que llegó y el zip sigue sano; el destino que falla frena', async () => {
    const sink = new MemorySink();
    const zip = new ZipWriter(sink);
    async function* broken() {
      yield enc('mitad');
      throw new TypeError('network');
    }
    const r = await zip.addFile('cortado.bin', 100, null, broken());
    expect(r.size).toBe(5);
    expect(r.error).toBeInstanceOf(TypeError);
    await zip.addFile('entero.txt', 2, null, chunked(enc('ok')));
    await zip.finish();
    if (hasPython) {
      const py = pythonReadZip(sink.bytes());
      expect(py.bad).toBeNull();
      expect(py.entries.map((e) => [e.name, text(e)])).toEqual([
        ['cortado.bin', 'mitad'],
        ['entero.txt', 'ok'],
      ]);
    }
    const full = new ZipWriter({ write: async () => Promise.reject(new Error('disk full')) });
    await expect(full.addFile('x', 2, null, chunked(enc('ok')))).rejects.toThrow('disk full');
  });

  it('la fecha de MS-DOS: hora local de a 2 segundos, nunca antes de 1980', () => {
    const { time, date } = dosTime(new Date(2026, 9, 2, 13, 45, 31));
    expect(date >> 9).toBe(46);
    expect((date >> 5) & 15).toBe(10);
    expect(date & 31).toBe(2);
    expect(time >> 11).toBe(13);
    expect((time >> 5) & 63).toBe(45);
    expect((time & 31) * 2).toBe(30);
    expect(dosTime(new Date(1970, 0, 1)).date).toBe(33);
  });
});

/**
 * El CRC32 de `n` ceros sin recorrerlos: CRC(A‖B) se arma con CRC(A), CRC(B) y el largo de B (crc32_combine de
 * zlib), y los bloques son iguales.
 */
function zeroCrc(n: number, block: number, blockCrc: number): number {
  let crc = 0;
  let left = n;
  while (left >= block) {
    crc = combine(crc, blockCrc, block);
    left -= block;
  }
  return left ? combine(crc, crc32(new Uint8Array(left)), left) : crc;
}

function gf2Times(mat: Uint32Array, vec: number): number {
  let sum = 0;
  for (let i = 0; vec; vec >>>= 1, i++) if (vec & 1) sum ^= mat[i]!;
  return sum >>> 0;
}

function gf2Square(square: Uint32Array, mat: Uint32Array) {
  for (let n = 0; n < 32; n++) square[n] = gf2Times(mat, mat[n]!);
}

/** crc32_combine de zlib. */
function combine(crc1: number, crc2: number, len2: number): number {
  if (len2 <= 0) return crc1;
  const even = new Uint32Array(32);
  const odd = new Uint32Array(32);
  odd[0] = 0xedb88320;
  let row = 1;
  for (let n = 1; n < 32; n++) {
    odd[n] = row;
    row <<= 1;
  }
  gf2Square(even, odd);
  gf2Square(odd, even);
  let c = crc1 >>> 0;
  let len = len2;
  do {
    gf2Square(even, odd);
    if (len % 2) c = gf2Times(even, c);
    len = Math.floor(len / 2);
    if (!len) break;
    gf2Square(odd, even);
    if (len % 2) c = gf2Times(odd, c);
    len = Math.floor(len / 2);
  } while (len);
  return (c ^ crc2) >>> 0;
}

describe('nombres de lo que se baja', () => {
  it('cortar por grafema: nunca media bandera ni un emoji sin su tono, y nunca más del tope en caracteres', () => {
    expect(graphemesOf('a🇦🇷👍🏽é')).toEqual(['a', '🇦🇷', '👍🏽', 'é']);
    expect(cutText('ab🇦🇷', 3)).toBe('ab');
    expect(cutText('ab🇦🇷', 4)).toBe('ab🇦🇷');
    expect(cutText('x👍🏽', 2)).toBe('x');
    // `í` en dos partes (como lo da la Mac) no se separa de su tilde.
    expect(cutText('dí', 2)).toBe('d');
    expect(Array.from(cutText('🇦🇷'.repeat(150), 201)).length).toBe(200);
    // La app: el nombre para la base (250) tampoco parte una bandera.
    const long = `${'a'.repeat(245)}🇦🇷🇦🇷🇦🇷.mov`;
    const clean = cleanFileName(long);
    expect(clean.endsWith('.mov')).toBe(true);
    expect(Array.from(clean).length).toBeLessThanOrEqual(250);
    expect(clean).toBe(`${'a'.repeat(245)}.mov`);
  });

  it('cada parte vale en Windows, la Mac y el iPhone', () => {
    expect(safeName('.')).toBe('_');
    expect(safeName('..')).toBe('_');
    expect(safeName('...')).toBe('_');
    expect(safeName('final.')).toBe('final');
    expect(safeName('final. . ')).toBe('final');
    expect(safeName('a<b>c:d"e|f?g*h.txt')).toBe('a_b_c_d_e_f_g_h.txt');
    expect(safeName('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(safeName('a\\b')).toBe('a_b');
    expect(safeName('CON')).toBe('_CON');
    expect(safeName('con.txt')).toBe('_con.txt');
    expect(safeName('Nul.tar.gz')).toBe('_Nul.tar.gz');
    expect(safeName('COM1')).toBe('_COM1');
    expect(safeName('LPT9.log')).toBe('_LPT9.log');
    expect(safeName('COM¹')).toBe('_COM¹');
    expect(safeName('CONSOLA.txt')).toBe('CONSOLA.txt');
    expect(safeName('factura‮fdp.exe')).toBe('facturafdp.exe');
    expect(safeName('  ', 'file')).toBe('file');
    expect(safeName('Día 2 - Puerto')).toBe('Día 2 - Puerto');
    // NFD de la Mac pasa a NFC.
    expect(safeName('Día')).toBe('Día');
    const long = safeName(`${'x'.repeat(198)}🇦🇷🇦🇷.mov`);
    expect(long).toBe(`${'x'.repeat(196)}.mov`);
  });

  it('nombres repetidos sin distinguir mayúsculas: « (2)», « (3)», también entre carpeta y archivo', () => {
    const ns = new NameSpace();
    ns.reserve('', 'MISSING_FILES.txt');
    expect(ns.take('', 'Foto.JPG')).toBe('Foto.JPG');
    expect(ns.take('', 'foto.jpg')).toBe('foto (2).jpg');
    expect(ns.take('', 'FOTO.jpg')).toBe('FOTO (3).jpg');
    expect(ns.take('', 'Notas')).toBe('Notas');
    expect(ns.take('', 'notas')).toBe('notas (2)');
    expect(ns.take('', 'missing_files.TXT')).toBe('missing_files (2).TXT');
    // En otra carpeta, el mismo nombre está libre.
    expect(ns.take('Notas', 'foto.jpg')).toBe('foto.jpg');
    // Dos nombres que Drive deja distintos y en el disco serían el mismo.
    expect(ns.take('', 'a?')).toBe('a_');
    expect(ns.take('', 'a*')).toBe('a_ (2)');
    expect(numbered('.env', 2)).toBe('.env (2)');
    expect(Array.from(numbered('y'.repeat(200), 12)).length).toBe(200);
  });
});
