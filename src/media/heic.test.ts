import { afterEach, describe, expect, it, vi } from 'vitest';
import { HEIC_SAMPLE } from './fixtures/heicSample';
import {
  HeicError,
  heicColorProfile,
  heicFailure,
  heicSignature,
  isHeicFile,
  isHeicSignature,
  isHeicType,
  isJpegStart,
  jpegName,
  jpegWithProfile,
} from './heic';
import { checkJpeg, decodeHeic, encodeJpegOffscreen, heicToJpeg, MAX_PIXELS, pixelsToJpeg, type JpegEncoder, type Libheif } from './heicDecode';
import { loadLibheif } from './heicLib';
import { FakeOffscreenCanvas, fakeCreateImageBitmap, stubBrowser } from './fixtures/fakeCanvas';

const bytesOf = (text: string) => new Uint8Array([...text].map((c) => c.charCodeAt(0)));
const u32 = (n: number) => new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const box = (type: string, body: Uint8Array) => join(u32(8 + body.length), bytesOf(type), body);
/** Una caja `ftyp`: marca principal, versión 0 y las compatibles. */
const ftyp = (major: string, ...compatible: string[]) => box('ftyp', join(bytesOf(major), u32(0), ...compatible.map(bytesOf)));
const sample = () => Uint8Array.from(atob(HEIC_SAMPLE), (c) => c.charCodeAt(0));

/** Un perfil ICC de mentira, con lo mínimo que se revisa: `RGB ` en el byte 16 y `acsp` en el 36. */
function profile(size: number, space = 'RGB '): Uint8Array {
  const icc = new Uint8Array(size).fill(7);
  icc.set(bytesOf(space), 16);
  icc.set(bytesOf('acsp'), 36);
  return icc;
}

describe('fotos HEIC: reconocerlas', () => {
  it('por el tipo que informa el navegador', () => {
    for (const type of ['image/heic', 'image/HEIF', 'image/heif; x=1']) expect(isHeicType(type)).toBe(true);
    // Las secuencias no se convierten (un JPEG de la primera imagen perdería el resto).
    for (const type of ['image/heic-sequence', 'image/heif-sequence', 'image/jpeg', 'image/avif', '', undefined, null, 'application/octet-stream']) {
      expect(isHeicType(type)).toBe(false);
    }
  });

  it('por la firma: ftyp con marca de HEIC, o la genérica de HEIF si no es un AVIF', () => {
    for (const major of ['heic', 'heix', 'heim', 'heis']) expect(heicSignature(ftyp(major, 'mif1'))).toBe('image');
    // La genérica (`mif1`): HEIC salvo que diga AVIF (que Chrome sí muestra).
    expect(isHeicSignature(ftyp('mif1', 'heic'))).toBe(true);
    expect(isHeicSignature(ftyp('mif1', 'miaf'))).toBe(true);
    // Secuencias (`hevc`, `hevx`, `hevm`, `hevs`, `msf1`): no se convierten.
    for (const major of ['hevc', 'hevx', 'hevm', 'hevs', 'msf1']) {
      expect(heicSignature(ftyp(major, 'mif1', 'heic'))).toBe('sequence');
      expect(isHeicSignature(ftyp(major, 'heic'))).toBe(false);
    }
    expect(heicSignature(ftyp('avif', 'mif1'))).toBe('other');
    expect(heicSignature(bytesOf('sin caja ftyp, ni de cerca'))).toBeNull();
    expect(isHeicSignature(ftyp('mif1', 'avif', 'miaf'))).toBe(false);
    expect(isHeicSignature(ftyp('avif', 'mif1', 'miaf'))).toBe(false);
    // Videos (también son ISO BMFF) y otros formatos.
    expect(isHeicSignature(ftyp('qt  ', 'qt  '))).toBe(false);
    expect(isHeicSignature(ftyp('isom', 'mp42'))).toBe(false);
    expect(isHeicSignature(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]))).toBe(false);
    expect(isHeicSignature(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13]))).toBe(false);
    expect(isHeicSignature(new Uint8Array(3))).toBe(false);
    // El de prueba, de verdad.
    expect(isHeicSignature(sample().subarray(0, 64))).toBe(true);
  });

  it('un archivo: por la firma aunque el navegador no diga el tipo; por el tipo si la firma no dice nada', async () => {
    expect(await isHeicFile(new File([sample()], 'IMG_0001.HEIC', { type: '' }))).toBe(true);
    expect(await isHeicFile(new File([sample()], 'IMG_0001', { type: 'application/octet-stream' }))).toBe(true);
    expect(await isHeicFile(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/heic' }))).toBe(true);
    expect(await isHeicFile(new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2])], 'foto.jpg', { type: 'image/jpeg' }))).toBe(false);
    // El nombre solo no alcanza: bytes que no son un HEIC no se mandan al decodificador.
    expect(await isHeicFile(new File([new Uint8Array(100)], 'IMG_1234.HEIC', { type: '' }))).toBe(false);
    // Una secuencia, aunque el tipo diga HEIC: la firma manda.
    const sequence = sample();
    sequence.set(bytesOf('msf1'), 8);
    expect(await isHeicFile(new File([sequence], 'rafaga.heic', { type: 'image/heic' }))).toBe(false);
    // Un AVIF que el navegador informa como HEIF: tampoco.
    expect(await isHeicFile(new File([ftyp('avif', 'mif1')], 'x.heif', { type: 'image/heif' }))).toBe(false);
  });

  it('el nombre del JPEG', () => {
    expect(jpegName('IMG_1234.HEIC')).toBe('IMG_1234.jpg');
    expect(jpegName('foto.heif')).toBe('foto.jpg');
    expect(jpegName('foto.hif')).toBe('foto.jpg');
    expect(jpegName('sin extension')).toBe('sin extension.jpg');
    expect(jpegName('ya.jpg')).toBe('ya.jpg');
    expect(jpegName('')).toBe('image.jpg');
    expect(jpegName(undefined)).toBe('image.jpg');
  });

  it('el motivo de un error', () => {
    expect(heicFailure(new HeicError('unavailable', 'x'))).toBe('unavailable');
    expect(heicFailure(new HeicError('failed', 'x'))).toBe('failed');
    expect(heicFailure(new Error('otra cosa'))).toBe('failed');
  });
});

describe('fotos HEIC: el perfil de color', () => {
  const jfif = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xdb, 0x00, 0x02, 0xff, 0xd9]);

  it('lo saca de la caja colr del HEIC; sin perfil, o con algo que no es un perfil, nada', () => {
    const icc = profile(200);
    const heic = join(ftyp('heic'), box('colr', join(bytesOf('prof'), icc)), box('mdat', bytesOf('datos')));
    expect(heicColorProfile(heic)).toEqual(icc);
    expect(heicColorProfile(join(ftyp('heic'), box('colr', join(bytesOf('nclx'), new Uint8Array([0, 1, 0, 13, 0, 6, 0x80])))))).toBeNull();
    expect(heicColorProfile(box('colr', join(bytesOf('prof'), new Uint8Array(200).fill(7))))).toBeNull();
    // Una caja que dice ser más larga que el archivo (cortado).
    expect(heicColorProfile(box('colr', join(bytesOf('prof'), icc)).subarray(0, 150))).toBeNull();
    expect(heicColorProfile(bytesOf('A'))).toBeNull();
    // El perfil en grises de una imagen auxiliar no es el de la foto: se saltea y vale el de color que sigue.
    const gray = box('colr', join(bytesOf('prof'), profile(200, 'GRAY')));
    expect(heicColorProfile(gray)).toBeNull();
    expect(heicColorProfile(join(gray, box('colr', join(bytesOf('prof'), icc))))).toEqual(icc);
    // Un `rICC` también vale.
    expect(heicColorProfile(box('colr', join(bytesOf('rICC'), icc)))).toEqual(icc);
    // El del HEIC de prueba: 588 bytes.
    expect(heicColorProfile(sample())?.length).toBe(588);
  });

  it('va en un segmento APP2 después de la cabecera JFIF; uno grande, en varios numerados', () => {
    const icc = profile(200);
    const out = jpegWithProfile(jfif, icc);
    const u16 = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
    expect(out.subarray(0, 8)).toEqual(jfif.subarray(0, 8));
    expect(u16(out, 8)).toBe(0xffe2);
    expect(u16(out, 10)).toBe(200 + 16);
    expect(String.fromCharCode(...out.subarray(12, 24))).toBe('ICC_PROFILE\0');
    expect([out[24], out[25]]).toEqual([1, 1]);
    expect(out.subarray(26, 226)).toEqual(icc);
    expect(out.subarray(226)).toEqual(jfif.subarray(8));
    // 70.000 bytes no entran en un segmento (64 KB): dos, "1 de 2" y "2 de 2", que juntos dan el perfil.
    const big = jpegWithProfile(jfif, profile(70000));
    const first = u16(big, 10);
    expect([big[24], big[25], first]).toEqual([1, 2, 65535]);
    const second = 8 + 2 + first;
    expect([u16(big, second), big[second + 16], big[second + 17], u16(big, second + 2)]).toEqual([0xffe2, 2, 2, 70000 - 65519 + 16]);
    expect(big.length).toBe(jfif.length + 70000 + 2 * 18);
    // Sin perfil, o si no es un JPEG, queda igual.
    expect(jpegWithProfile(jfif, null)).toBe(jfif);
    const other = bytesOf('no soy un jpeg');
    expect(jpegWithProfile(other, icc)).toBe(other);
  });

  it('si el JPEG ya traía un perfil (lo pone el navegador al codificar), queda solo el del HEIC', () => {
    const old = profile(150, 'RGB ');
    const withOld = jpegWithProfile(jfif, old);
    const icc = profile(200);
    const out = jpegWithProfile(withOld, icc);
    expect(out).toEqual(jpegWithProfile(jfif, icc));
    // Sin JFIF (empieza con otro segmento): el perfil va enseguida del comienzo.
    const bare = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x02, 0xff, 0xd9]);
    const put = jpegWithProfile(bare, icc);
    expect([put[2], put[3]]).toEqual([0xff, 0xe2]);
    expect(put.subarray(put.length - 6)).toEqual(bare.subarray(2));
  });

  it('isJpegStart', () => {
    expect(isJpegStart(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(true);
    expect(isJpegStart(new Uint8Array([0xff, 0xd8]))).toBe(false);
    expect(isJpegStart(bytesOf('GIF89a'))).toBe(false);
  });
});

describe('fotos HEIC: el decodificador de verdad, por la misma entrada que la app (heicLib.ts)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('el HEIC de prueba sale derecho (64×96, no acostado) y con sus colores', async () => {
    const { wasmFetches } = stubBrowser();
    const lib = await loadLibheif();
    // La librería se baja una sola vez.
    expect(await loadLibheif()).toBe(lib);
    expect(wasmFetches()).toBeLessThanOrEqual(1);
    const pixels = await decodeHeic(lib, sample());
    // Guardado 96×64 (acostado); con la rotación aplicada, 64×96.
    expect([pixels.width, pixels.height]).toEqual([64, 96]);
    expect(pixels.data.length).toBe(64 * 96 * 4);
    const at = (x: number, y: number) => [...pixels.data.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4)];
    const near = (rgba: number[], want: number[]) => rgba.slice(0, 3).every((v, i) => Math.abs(v - want[i]) < 40) && rgba[3] === 255;
    // Girado 90° a la derecha: arriba azul y rojo, abajo blanco y verde.
    expect(near(at(5, 5), [30, 30, 220])).toBe(true);
    expect(near(at(58, 5), [220, 30, 30])).toBe(true);
    expect(near(at(5, 90), [240, 240, 240])).toBe(true);
    expect(near(at(58, 90), [30, 200, 30])).toBe(true);
  });

  it('el JPEG lleva el perfil de color del HEIC, entero, y se comprueba que sea la foto', async () => {
    stubBrowser();
    const heic = sample();
    // El codificador de canvas de la app, sobre un canvas de mentira (node no tiene canvas).
    const jpeg = await heicToJpeg(await loadLibheif(), heic, encodeJpegOffscreen);
    expect([...jpeg.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    const icc = heicColorProfile(heic)!;
    const mark = [...jpeg].findIndex((_, i) => String.fromCharCode(...jpeg.subarray(i, i + 12)) === 'ICC_PROFILE\0');
    expect(jpeg.subarray(mark + 14, mark + 14 + 588)).toEqual(icc);
    const back = await fakeCreateImageBitmap(new Blob([jpeg as Uint8Array<ArrayBuffer>]));
    expect([back.width, back.height]).toEqual([64, 96]);
  });

  it('lo que no es un HEIC, o un codificador que no devuelve un JPEG: error de conversión (failed)', async () => {
    stubBrowser();
    const lib = await loadLibheif();
    await expect(decodeHeic(lib, bytesOf('esto no es una foto'))).rejects.toMatchObject({ reason: 'failed' });
    // Un HEIC cortado a la mitad.
    await expect(decodeHeic(lib, sample().subarray(0, 600))).rejects.toBeInstanceOf(Error);
    const notJpeg: JpegEncoder = async () => bytesOf('PNG?');
    await expect(pixelsToJpeg({ width: 1, height: 1, data: new Uint8ClampedArray(4) }, sample(), notJpeg)).rejects.toMatchObject({
      reason: 'failed',
    });
  });

  it('sin el .wasm (sin red): el decodificador no está (unavailable), y se puede volver a probar', async () => {
    vi.resetModules();
    stubBrowser({ wasm: false });
    const fresh = await import('./heicLib');
    await expect(fresh.loadLibheif()).rejects.toMatchObject({ reason: 'unavailable' });
    stubBrowser();
    expect(typeof (await fresh.loadLibheif()).HeifDecoder).toBe('function');
  });
});

describe('fotos HEIC: comprobar el JPEG', () => {
  afterEach(() => vi.unstubAllGlobals());
  const pixels = () => {
    const data = new Uint8ClampedArray(40 * 30 * 4);
    for (let i = 0; i < data.length; i += 4) data.set([(i / 4) % 40 * 6, 120, 200 - ((i / 4 / 40) | 0) * 5, 255], i);
    return { width: 40, height: 30, data };
  };

  it('el JPEG que da el canvas tiene que abrir, medir lo mismo y parecerse a la foto', async () => {
    stubBrowser();
    const source = pixels();
    const good = await encodeJpegOffscreen(source, 0.92);
    await expect(checkJpeg(good, source)).resolves.toBeUndefined();
    // Un canvas pasado de su tope de área (iOS) que devuelve una imagen vacía de las mismas medidas.
    FakeOffscreenCanvas.mode = 'blank';
    const blank = await encodeJpegOffscreen(source, 0.92);
    await expect(checkJpeg(blank, source)).rejects.toMatchObject({ reason: 'failed' });
    // Otras medidas, o algo que no abre.
    FakeOffscreenCanvas.mode = 'ok';
    await expect(checkJpeg(good, { ...source, width: 30, height: 40 })).rejects.toMatchObject({ reason: 'failed' });
    await expect(checkJpeg(new Uint8Array([0xff, 0xd8, 0xff, 1, 2]), source)).rejects.toMatchObject({ reason: 'failed' });
    // Sin `createImageBitmap` no se puede comprobar: tampoco se da por bueno.
    vi.stubGlobal('createImageBitmap', undefined);
    await expect(checkJpeg(good, source)).rejects.toMatchObject({ reason: 'failed' });
  });

  it('una foto más grande que el tope (50 MP) no se intenta', async () => {
    expect(MAX_PIXELS).toBe(50_000_000);
    const huge = { get_width: () => 10_000, get_height: () => 6_000, is_primary: () => true, display: vi.fn(), free: () => undefined };
    const lib = { HeifDecoder: class { decoder = null; decode = () => [huge]; } } as unknown as Libheif;
    await expect(decodeHeic(lib, sample())).rejects.toMatchObject({ reason: 'failed' });
    expect(huge.display).not.toHaveBeenCalled();
  });
});
