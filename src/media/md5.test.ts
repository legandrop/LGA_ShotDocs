import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Md5, md5Blob } from './md5';

// El MD5 que se compara con el `md5Checksum` de Drive antes de liberar un original (Doc_Copias_Locales.md, 5.3):
// tiene que dar lo mismo que el de Node para cualquier largo y cualquier forma de cortar los tramos.

const node = (bytes: Uint8Array) => createHash('md5').update(bytes).digest('hex');

function data(size: number, seed: number): Uint8Array {
  const out = new Uint8Array(size);
  let x = seed * 2654435761;
  for (let i = 0; i < size; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

describe('MD5', () => {
  it('los valores de la RFC 1321', () => {
    const text = (s: string) => new Md5().update(new TextEncoder().encode(s)).digest();
    expect(text('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(text('a')).toBe('0cc175b9c0f1b6a831c399e269772661');
    expect(text('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(text('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(text('12345678901234567890123456789012345678901234567890123456789012345678901234567890')).toBe('57edf4a22be3c955ac49da2e2107b67a');
  });

  it('igual que Node en los largos del borde de un bloque', () => {
    for (const size of [1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 4096 + 7]) {
      const bytes = data(size, size);
      expect(new Md5().update(bytes).digest(), `largo ${size}`).toBe(node(bytes));
    }
  });

  it('cortado en tramos de cualquier largo da lo mismo', () => {
    const bytes = data(300_000, 3);
    for (const step of [1, 3, 63, 64, 65, 1000, 65_536]) {
      const md5 = new Md5();
      for (let at = 0; at < bytes.length; at += step) md5.update(bytes.subarray(at, at + step));
      expect(md5.digest(), `tramos de ${step}`).toBe(node(bytes));
    }
  });

  it('un archivo leído de a tramos (`md5Blob`), también con un tramo que no es múltiplo de 64', async () => {
    const bytes = data(1_000_003, 9);
    const blob = new Blob([bytes as BlobPart]);
    expect(await md5Blob(blob)).toBe(node(bytes));
    expect(await md5Blob(blob, 100_001)).toBe(node(bytes));
    expect(await md5Blob(new Blob([]))).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });

  it('un archivo de más de 512 MB (el largo en bits pasa 2^32) no se corta en el largo', () => {
    // Sin escribir 600 MB: dos Md5 con la misma cola y distinto largo tienen que dar distinto, y el de Node con un
    // largo chico tiene que coincidir (lo de arriba). Acá se fija que el alto del largo entra en la cuenta.
    const a = new Md5() as unknown as { length: number; digest(): string };
    const b = new Md5() as unknown as { length: number; digest(): string };
    a.length = 0;
    b.length = 2 ** 29; // 2^32 bits
    expect(a.digest()).not.toBe(b.digest());
  });
});
