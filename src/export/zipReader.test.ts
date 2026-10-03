import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { crc32 } from '../media/crc32';
import { BlobSink } from '../media/folderZip';
import { ZipWriter } from '../media/zipWriter';
import { folderSource, INFLATE_PIECE, openZip, safePath, subSource, ZipReadError } from './zipReader';

// El lector de zip de volver a Shot Docs (P.22, entrega 3; Docs/Doc_Exportar.md, sección 3): lee lo que escribe la app
// (sin comprimir, con descriptores, Zip64) y lo que deja el Explorador o el Finder al volver a comprimir (*deflate*),
// sin cargarlo entero, con el CRC de cada archivo; y deja afuera, con su motivo, todo nombre peligroso.

beforeAll(() => {
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('File', NodeFile);
});

const enc = new TextEncoder();

async function* one(data: Uint8Array) {
  yield data;
}

/** Un zip de la app (`ZipWriter`): sin comprimir, con descriptores; Zip64 si se pide. */
async function appZip(files: [string, string | Uint8Array][], forceZip64 = false): Promise<Blob> {
  const sink = new BlobSink();
  const zip = new ZipWriter(sink, { forceZip64 });
  for (const [name, data] of files) {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    await zip.addFile(name, bytes.length, new Date(2026, 9, 2), one(bytes));
  }
  await zip.finish();
  return sink.blob();
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = (new NodeBlob([data as never]).stream() as unknown as ReadableStream<Uint8Array>).pipeThrough(new CompressionStream('deflate-raw') as never);
  return new Uint8Array(await new Response(stream as never).arrayBuffer());
}

/**
 * Un zip armado a mano, como lo deja otra herramienta: cada archivo con su método (0 o 8), sus nombres tal cual (también
 * los peligrosos) y, si se pide, un tamaño o un CRC que mienten.
 */
async function handZip(files: { name: string; data: Uint8Array; method?: 0 | 8; size?: number; crc?: number; flags?: number }[]): Promise<Blob> {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const method = f.method ?? 0;
    const body = method === 8 ? await deflate(f.data) : f.data;
    const crc = f.crc ?? crc32(f.data);
    const size = f.size ?? f.data.length;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, (f.flags ?? 0) | 0x0800, true);
    local.setUint16(8, method, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, body);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, (f.flags ?? 0) | 0x0800, true);
    c.setUint16(10, method, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, body.length, true);
    c.setUint32(24, size, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new NodeBlob([...parts, ...central, new Uint8Array(end.buffer)] as never) as unknown as Blob;
}

describe('volver a Shot Docs: leer el zip', () => {
  it('lee el zip que arma la app (sin comprimir, con descriptores), con el CRC de cada archivo y sin copiar el original', async () => {
    const photo = new Uint8Array(300_000).map((_, i) => (i * 7) % 251);
    const zip = await appZip([
      ['_shotdocs/manifest.json', '{"format":1}'],
      ['01_Dia_1/Files/IMG 0412 (2).JPG', photo],
      ['01_Dia_1/01_Día 1.html', '<p>Día</p>'],
    ]);
    const src = await openZip(zip);
    expect(src.paths().sort()).toEqual(['01_Dia_1/01_Día 1.html', '01_Dia_1/Files/IMG 0412 (2).JPG', '_shotdocs/manifest.json']);
    expect(await src.text('_shotdocs/manifest.json', 1000)).toBe('{"format":1}');
    expect(src.size('01_Dia_1/Files/IMG 0412 (2).JPG')).toBe(photo.length);
    const blob = await src.blob('01_Dia_1/Files/IMG 0412 (2).JPG', 'image/jpeg');
    expect(blob.type).toBe('image/jpeg');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(photo);
    expect(src.skipped).toEqual([]);
    // Un texto más grande que el tope, error (no se lee entero).
    await expect(src.text('01_Dia_1/Files/IMG 0412 (2).JPG', 1000)).rejects.toMatchObject({ code: 'tooBig' });
    await expect(src.text('no/esta.json', 1000)).rejects.toMatchObject({ code: 'missing' });
  });

  it('lee un zip con Zip64 (el de más de 4 GiB o 65 534 cosas)', async () => {
    const src = await openZip(await appZip([['a/b.txt', 'hola'], ['c.txt', 'chau']], true));
    expect(await src.text('a/b.txt', 100)).toBe('hola');
    expect(await src.text('c.txt', 100)).toBe('chau');
  });

  it('lee uno vuelto a comprimir con deflate (el Explorador, el Finder) y comprueba el CRC', async () => {
    const text = 'Escena 12 '.repeat(5000);
    const src = await openZip(await handZip([{ name: 'x/_shotdocs/manifest.json', data: enc.encode(text), method: 8 }]));
    expect(await src.text('x/_shotdocs/manifest.json', 1_000_000)).toBe(text);
    const sub = subSource(src, 'x');
    expect(sub.paths()).toEqual(['_shotdocs/manifest.json']);
    expect(sub.has('_shotdocs/manifest.json')).toBe(true);
  });

  it('un archivo que no es zip, o un zip cortado (sin su final), es un error claro', async () => {
    await expect(openZip(new NodeBlob([enc.encode('esto no es un zip, es un texto cualquiera de más de 22 letras')]) as never)).rejects.toMatchObject({ code: 'notZip' });
    await expect(openZip(new NodeBlob([new Uint8Array(5)]) as never)).rejects.toMatchObject({ code: 'notZip' });
    const zip = await appZip([['_shotdocs/manifest.json', '{"format":1}'], ['a.bin', new Uint8Array(5000)]]);
    const cut = zip.slice(0, zip.size - 40);
    await expect(openZip(cut)).rejects.toBeInstanceOf(ZipReadError);
    await expect(openZip(cut)).rejects.toMatchObject({ code: 'damaged' });
  });

  it('un archivo con el CRC cambiado (dañado en el disco) no se entrega', async () => {
    const data = enc.encode('contenido de la foto');
    const src = await openZip(await handZip([{ name: 'foto.jpg', data, crc: crc32(data) ^ 1 }, { name: 'd.txt', data, method: 8, crc: 1 }]));
    await expect(src.blob('foto.jpg')).rejects.toMatchObject({ code: 'crc' });
    await expect(src.text('d.txt', 1000)).rejects.toMatchObject({ code: 'crc' });
  });

  it('un deflate que dice pesar poco y descomprime mucho (una bomba) se corta', async () => {
    const big = new Uint8Array(2_000_000);
    const src = await openZip(await handZip([{ name: 'bomba.json', data: big, method: 8, size: 100 }]));
    await expect(src.text('bomba.json', 10_000_000)).rejects.toBeInstanceOf(ZipReadError);
    await expect(src.blob('bomba.json')).rejects.toBeInstanceOf(ZipReadError);
  });

  it('una bomba se corta en el pedazo que pasa lo declarado, no al final (dice 100 bytes y trae 50 MB)', async () => {
    const big = new Uint8Array(50_000_000);
    const src = await openZip(await handZip([{ name: 'Files/video.mov', data: big, method: 8, size: 100 }]));
    // `damaged` es el corte a mitad; si se descomprimiera todo, el error sería el del final (`crc`).
    await expect(src.blob('Files/video.mov')).rejects.toMatchObject({ code: 'damaged' });
  });

  it('una bomba: lo que se descomprime de más queda acotado a unos pedazos, no al tamaño real (ronda 2 de la auditoría)', async () => {
    // Cuenta lo que sale del descompresor de verdad (envuelto): eso es lo que ocupa memoria antes del corte.
    // Y el pedazo más grande de comprimido que se le pasa: en Chromium, el descompresor saca entero lo de cada pedazo
    // antes de que el control lo vea (con `blob.stream()`, pedazos grandes: +2 GB medidos por la auditoría).
    const Real = globalThis.DecompressionStream;
    let produced = 0;
    let biggestInput = 0;
    class Counting {
      readonly writable: WritableStream;
      readonly readable: ReadableStream;
      constructor(format: CompressionFormat) {
        const real = new Real(format);
        const input = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, ctl) {
            biggestInput = Math.max(biggestInput, chunk.length);
            ctl.enqueue(chunk);
          },
        });
        void input.readable.pipeTo(real.writable as WritableStream).catch(() => undefined);
        this.writable = input.writable as WritableStream;
        this.readable = (real.readable as ReadableStream<Uint8Array>).pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>(
            {
              transform(chunk, ctl) {
                produced += chunk.length;
                ctl.enqueue(chunk);
              },
            },
            undefined,
            { highWaterMark: 0 },
          ),
        );
      }
    }
    // 200 MB de ceros (unos 200 KB comprimidos) que dicen pesar 1 MB.
    const zip = await handZip([{ name: 'Files/bomba.mov', data: new Uint8Array(200_000_000), method: 8, size: 1_000_000 }]);
    vi.stubGlobal('DecompressionStream', Counting);
    try {
      const src = await openZip(zip);
      await expect(src.blob('Files/bomba.mov')).rejects.toMatchObject({ code: 'damaged' });
      expect(biggestInput).toBeLessThanOrEqual(INFLATE_PIECE);
      // Con el comprimido de a 16 KB, cada pedazo da como mucho ~16 MB: lo de más queda en unos pocos pedazos.
      expect(produced).toBeLessThan(40_000_000);
      produced = 0;
      await expect(src.text('Files/bomba.mov', 2_000_000)).rejects.toMatchObject({ code: 'damaged' });
      expect(produced).toBeLessThan(40_000_000);
    } finally {
      vi.stubGlobal('DecompressionStream', Real);
    }
  });

  it('topes del deflate (O2): uno que dice pesar más que el tope no se lee y se sabe antes; el total por zip también', async () => {
    const d = new Uint8Array(3000).fill(7);
    // Lo que dice el índice: 4 GB (un zip de 1 MB armado para colgar la pestaña).
    const lying = await openZip(await handZip([{ name: 'grande.mov', data: d, method: 8, size: 4_000_000_000 }, { name: 'chico.txt', data: d, method: 8 }]));
    expect(lying.tooBig('grande.mov')).toBe(true);
    expect(lying.tooBig('chico.txt')).toBe(false);
    await expect(lying.blob('grande.mov')).rejects.toMatchObject({ code: 'tooBig' });
    expect((await lying.blob('chico.txt')).size).toBe(3000);
    // Con topes chicos: por archivo, y en total (dos de 3000 con un total de 5000: el segundo no entra).
    const capped = await openZip(await handZip([{ name: 'a.bin', data: d, method: 8 }, { name: 'b.bin', data: d, method: 8 }, { name: 'c.bin', data: d }]), { maxDeflateEntry: 4000, maxDeflateTotal: 5000 });
    expect((await capped.blob('a.bin')).size).toBe(3000);
    await expect(capped.blob('b.bin')).rejects.toMatchObject({ code: 'tooBig' });
    // Lo que va sin comprimir no cuenta (es un pedazo del mismo archivo, sin memoria).
    expect((await capped.blob('c.bin')).size).toBe(3000);
    const small = await openZip(await handZip([{ name: 'x.bin', data: d, method: 8 }]), { maxDeflateEntry: 1000 });
    expect(small.tooBig('x.bin')).toBe(true);
    await expect(small.text('x.bin', 10_000)).rejects.toMatchObject({ code: 'tooBig' });
  });

  it('los nombres peligrosos, cifrados, con otro método o repetidos no se ofrecen y quedan anotados', async () => {
    const d = enc.encode('x');
    const src = await openZip(
      await handZip([
        { name: '../afuera.txt', data: d },
        { name: '/etc/passwd', data: d },
        { name: 'C:/Windows/win.ini', data: d },
        { name: 'a/../../b.txt', data: d },
        { name: 'a\\..\\..\\c.txt', data: d },
        { name: '\\\\servidor\\share.txt', data: d },
        { name: 'con\u0001control.txt', data: d },
        { name: 'a//b.txt', data: d },
        { name: './punto.txt', data: d },
        { name: 'cifrado.txt', data: d, flags: 1 },
        { name: 'bien/ok.txt', data: d },
        { name: 'bien/ok.txt', data: enc.encode('otro') },
        { name: 'windows\\barras.txt', data: d },
      ]),
    );
    expect(src.paths().sort()).toEqual(['bien/ok.txt', 'windows/barras.txt']);
    expect(await src.text('bien/ok.txt', 10)).toBe('x');
    expect(src.skipped.map((s) => s.why)).toEqual(['unsafe', 'unsafe', 'unsafe', 'unsafe', 'unsafe', 'unsafe', 'unsafe', 'unsafe', 'unsafe', 'encrypted', 'duplicate']);
    for (const bad of ['../x', '/x', 'C:x', 'a/./b', '', ' /x', 'a/ /b', 'a/..']) expect(safePath(bad), bad).toBeNull();
    expect(safePath('01_Rodaje/Files/IMG (2).JPG')).toBe('01_Rodaje/Files/IMG (2).JPG');
  });

  it('la carpeta descomprimida: las rutas sin la carpeta elegida, con las mismas reglas', async () => {
    const f = (path: string, text: string) => Object.assign(new NodeFile([text], path.split('/').pop()!), { webkitRelativePath: path }) as unknown as File;
    const src = folderSource([f('Reporte/_shotdocs/manifest.json', '{}'), f('Reporte/01_A/a.md', '# A'), f('Reporte/../x.txt', 'no')]);
    expect(src.paths().sort()).toEqual(['01_A/a.md', '_shotdocs/manifest.json']);
    expect(await src.text('01_A/a.md', 100)).toBe('# A');
    await expect(src.text('01_A/a.md', 1)).rejects.toMatchObject({ code: 'tooBig' });
    expect(src.skipped).toEqual([{ name: '../x.txt', why: 'unsafe' }]);
  });
});
