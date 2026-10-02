import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CIPHER_B64,
  generatePassphrase,
  headerFor,
  ITERATIONS,
  KeySyncError,
  keyEnding,
  normalizePassphrase,
  openKey,
  ownPassphraseOk,
  PADDED_BYTES,
  sealKey,
  uniformIndex,
  type KeyPayload,
} from './keySync';
import { EFF_SHORT_WORDS } from './wordlist';

// El sobre de la clave sincronizada (Docs/Doc_Clave_Sincronizada.md, sección 4 y pruebas 1 a 4 de la sección 11):
// ida y vuelta, la derivación atada a sus constantes, lo que no tiene que abrir, el relleno en bytes, la frase
// normalizada con una sola función (R1), y la frase generada sin sesgo.

const UID = '7d3f0a52-1111-4c2a-9b1e-000000000001';
const PHRASE = 'acorn-bulb-cider-dove-ember-frost';
const ANT: KeyPayload = { provider: 'anthropic', model: 'claude-haiku-4-5', apiKey: 'sk-ant-api03-SECRETA-de-prueba-0987654321', savedAt: 1_790_000_000_000 };
const COMPAT: KeyPayload = { provider: 'compatible', baseUrl: 'https://openrouter.ai/api/v1', model: 'm', apiKey: 'sk-or-v1-SECRETA', savedAt: 1_790_000_000_001 };

const b64 = (s: string) => Buffer.from(s, 'base64');

async function fails(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return err instanceof KeySyncError ? err.problem : `otro: ${String(err)}`;
  }
  return 'abrió';
}

/** Abre la fila sin el código de la app, con Node: PBKDF2-SHA256 de 1 000 000 de vueltas, AES-256-GCM y la cabecera. */
function openWithNode(row: { salt: string; iv: string; ciphertext: string }, passphrase: string, uid: string, iterations = 1_000_000): KeyPayload {
  const key = pbkdf2Sync(Buffer.from(passphrase, 'utf8'), b64(row.salt), iterations, 32, 'sha256');
  const all = b64(row.ciphertext);
  const d = createDecipheriv('aes-256-gcm', key, b64(row.iv));
  d.setAAD(Buffer.from(JSON.stringify({ v: 1, kdf: 'pbkdf2-sha256', iter: 1000000, salt: row.salt, uid })));
  d.setAuthTag(all.subarray(all.length - 16));
  const plain = Buffer.concat([d.update(all.subarray(0, all.length - 16)), d.final()]);
  expect(plain.length).toBe(PADDED_BYTES);
  return JSON.parse(plain.toString('utf8').trimEnd()) as KeyPayload;
}

describe('el sobre', () => {
  it('ida y vuelta; la fila no lleva ni la clave ni la dirección, y mide siempre lo mismo', async () => {
    const row = await sealKey(COMPAT, PHRASE, UID);
    expect(row.format).toBe(1);
    expect(row.salt).toHaveLength(24);
    expect(row.iv).toHaveLength(16);
    expect(row.ciphertext).toHaveLength(CIPHER_B64);
    const text = JSON.stringify(row);
    for (const secret of ['SECRETA', 'openrouter', 'compatible', PHRASE]) expect(text).not.toContain(secret);
    expect(await openKey(row, PHRASE, UID)).toEqual(COMPAT);
    // Sal y iv nuevos cada vez.
    const again = await sealKey(COMPAT, PHRASE, UID);
    expect(again.salt).not.toBe(row.salt);
    expect(again.iv).not.toBe(row.iv);
  });

  it('la derivación es PBKDF2-SHA256 de 1 000 000 de vueltas con la cabecera atada (abre Node, sin el código de la app)', async () => {
    expect(ITERATIONS).toBe(1_000_000);
    const row = await sealKey(ANT, PHRASE, UID);
    expect(openWithNode(row, PHRASE, UID)).toEqual(ANT);
    // Con otras vueltas no abre: la prueba ata el número.
    expect(() => openWithNode(row, PHRASE, UID, 600_000)).toThrow();
  });

  it('el PBKDF2-SHA256 del entorno da los vectores de RFC 7914, sección 11', async () => {
    const bits = async (p: string, s: string, c: number) => {
      const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(p), 'PBKDF2', false, ['deriveBits']);
      return Buffer.from(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(s), iterations: c }, base, 512)).toString('hex');
    };
    expect(await bits('passwd', 'salt', 1)).toBe(
      '55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783',
    );
    expect(await bits('Password', 'NaCl', 80000)).toBe(
      '4ddcd8f60b98be21830cee5ef22701f9641a4418d04c0414aeff08876b34ab56a1d425a1225833549adb841b51c9b3176a272bdebba1d078478f62b397f33c8d',
    );
  });

  it('no abre: frase equivocada, otra sal, otro iv, otro id, un byte del cifrado; una versión desconocida pide actualizar', async () => {
    const row = await sealKey(ANT, PHRASE, UID);
    const flip = (s: string, i: number) => {
      const b = b64(s);
      b[i] ^= 1;
      return b.toString('base64');
    };
    expect(await fails(openKey(row, 'acorn-bulb-cider-dove-ember-frosts', UID))).toBe('wrong');
    expect(await fails(openKey({ ...row, salt: flip(row.salt, 3) }, PHRASE, UID))).toBe('wrong');
    expect(await fails(openKey({ ...row, iv: flip(row.iv, 0) }, PHRASE, UID))).toBe('wrong');
    expect(await fails(openKey(row, PHRASE, '7d3f0a52-1111-4c2a-9b1e-000000000002'))).toBe('wrong');
    expect(await fails(openKey({ ...row, ciphertext: flip(row.ciphertext, 500) }, PHRASE, UID))).toBe('wrong');
    expect(await fails(openKey({ ...row, ciphertext: row.ciphertext.slice(4) }, PHRASE, UID))).toBe('wrong');
    expect(await fails(openKey({ ...row, format: 2 }, PHRASE, UID))).toBe('newer');
    expect(await fails(openKey({ ...row, format: 0 }, PHRASE, UID))).toBe('wrong');
    expect(await fails(openKey({ ...row, format: '1' }, PHRASE, UID))).toBe('wrong');
  });

  it('los parámetros los pone la app: una fila con `iter`, `kdf` o una dirección en claro agregados no cambia nada (pruebas 2 y 3)', async () => {
    const row = await sealKey(COMPAT, PHRASE, UID);
    const tampered = { ...row, iter: 1, kdf: 'pbkdf2-sha1', v: 2, baseUrl: 'https://servidor-del-duenio.example/v1', provider: 'compatible' };
    const opened = await openKey(tampered, PHRASE, UID);
    expect(opened).toEqual(COMPAT);
    expect(opened.baseUrl).toBe('https://openrouter.ai/api/v1');
    // La cabecera la arma la app con sus constantes.
    expect(new TextDecoder().decode(headerFor(row.salt, UID))).toBe(`{"v":1,"kdf":"pbkdf2-sha256","iter":1000000,"salt":"${row.salt}","uid":"${UID}"}`);
  });

  it('el relleno es en bytes: una clave de Gemini y una de OpenAI miden lo mismo; más de 1 024 bytes no entra', async () => {
    const gemini = await sealKey({ provider: 'gemini', model: 'g', apiKey: 'AIzaSy' + 'x'.repeat(33), savedAt: 1 }, PHRASE, UID);
    const openai = await sealKey({ provider: 'openai', model: 'o', apiKey: 'sk-proj-' + 'y'.repeat(156), savedAt: 1 }, PHRASE, UID);
    expect(gemini.ciphertext).toHaveLength(CIPHER_B64);
    expect(openai.ciphertext).toHaveLength(CIPHER_B64);
    // El peor caso de la auditoría (dirección de 300 caracteres con tildes, modelo de 120, clave de 200) entra.
    const worst = { provider: 'compatible' as const, baseUrl: 'https://ejemplo.example/' + 'á'.repeat(276), model: 'm'.repeat(120), apiKey: 'k'.repeat(200), savedAt: 1 };
    expect(await openKey(await sealKey(worst, PHRASE, UID), PHRASE, UID)).toEqual(worst);
    // 600 caracteres con tilde: entra en caracteres (menos de 1 024) y no en bytes (1 200 solo la dirección).
    const accents = { provider: 'compatible' as const, baseUrl: 'https://x.example/' + 'é'.repeat(600), model: 'm', apiKey: 'k', savedAt: 1 };
    expect(JSON.stringify(accents).length).toBeLessThan(PADDED_BYTES);
    expect(await fails(sealKey(accents, PHRASE, UID))).toBe('tooLong');
  });
});

describe('la frase', () => {
  it('R1: la misma normalización al cifrar y al abrir; la generada con mayúscula o con espacios abre igual', async () => {
    const row = await sealKey(ANT, 'Acorn-bulb-cider-dove-ember-frost', UID);
    expect(await openKey(row, PHRASE, UID)).toEqual(ANT);
    expect(await openKey(row, '  acorn bulb  cider dove ember FROST ', UID)).toEqual(ANT);
    // Lo que se deriva es la forma normalizada (Node abre con ella).
    expect(openWithNode(row, PHRASE, UID)).toEqual(ANT);
    // Una frase propia de seis palabras con mayúsculas: se cifra y se abre igual en otro dispositivo.
    const own = await sealKey(ANT, 'Mi Perro Come Fideos Los Martes', UID);
    expect(await openKey(own, 'Mi Perro Come Fideos Los Martes', UID)).toEqual(ANT);
  });

  it('una frase propia con otra forma no se toca: las mayúsculas cuentan', async () => {
    const own = 'Correct Horse, Battery Staple 2026!';
    expect(normalizePassphrase(own)).toBe(own);
    const row = await sealKey(ANT, own, UID);
    expect(await openKey(row, own, UID)).toEqual(ANT);
    expect(await fails(openKey(row, own.toLowerCase(), UID))).toBe('wrong');
  });

  it('NFKC y los espacios de las puntas', async () => {
    const composed = 'Árbol cañón 2026, mañana!';
    const decomposed = composed.normalize('NFD');
    expect(decomposed).not.toBe(composed);
    const row = await sealKey(ANT, ` ${composed}  `, UID);
    expect(await openKey(row, decomposed, UID)).toEqual(ANT);
  });

  it('la generada: seis palabras de la lista, en minúsculas y con guiones', () => {
    expect(EFF_SHORT_WORDS).toHaveLength(1295);
    expect(new Set(EFF_SHORT_WORDS).size).toBe(1295);
    expect(EFF_SHORT_WORDS.every((w) => /^[a-z]{3,5}$/.test(w))).toBe(true);
    const words = new Set(EFF_SHORT_WORDS);
    for (let i = 0; i < 50; i++) {
      const p = generatePassphrase();
      const parts = p.split('-');
      expect(parts).toHaveLength(6);
      expect(parts.every((w) => words.has(w))).toBe(true);
      expect(normalizePassphrase(p)).toBe(p);
    }
  });

  it('sin sesgo: descarta lo que no entra parejo, y un millón de sorteos quedan parejos', () => {
    const n = EFF_SHORT_WORDS.length;
    const limit = Math.floor(0x1_0000_0000 / n) * n;
    // El primer valor no entra parejo: se descarta y se usa el siguiente.
    const seq = [limit, 0xffffffff, 7];
    const fake = (a: Uint32Array) => {
      a[0] = seq.shift()!;
      return a;
    };
    expect(uniformIndex(n, fake)).toBe(7);
    // Un generador controlado (xorshift32): un millón de sorteos, cada palabra cerca de 1 000 000 / 1 295.
    let x = 2463534242;
    const prng = (a: Uint32Array) => {
      x ^= x << 13;
      x >>>= 0;
      x ^= x >>> 17;
      x ^= x << 5;
      x >>>= 0;
      a[0] = x;
      return a;
    };
    const counts = new Array<number>(n).fill(0);
    for (let i = 0; i < 1_000_000; i++) counts[uniformIndex(n, prng)]++;
    const expected = 1_000_000 / n;
    const chi = counts.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
    // Chi cuadrado con 1 294 grados de libertad: la media es 1 294; arriba de 1 500 sería sesgo.
    expect(chi).toBeLessThan(1500);
    expect(Math.min(...counts)).toBeGreaterThan(expected * 0.75);
  });

  it('la propia: 20 caracteres o más y al menos cuatro palabras', () => {
    expect(ownPassphraseOk('una frase corta')).toBe(false);
    expect(ownPassphraseOk('superlargasinespaciosninguno')).toBe(false);
    expect(ownPassphraseOk('tres palabras larguísimas')).toBe(false);
    expect(ownPassphraseOk('mi gato duerme en la terraza')).toBe(true);
    expect(ownPassphraseOk('  a b c d               ')).toBe(false);
  });

  it('el final de la clave para mostrar', () => {
    expect(keyEnding('sk-ant-api03-a1B2')).toBe('a1B2');
  });
});

describe('la llave que sale de la frase (O3 de la auditoría)', () => {
  it('es no exportable, solo para cifrar y abrir, al cifrar y al abrir', async () => {
    const { vi } = await import('vitest');
    const keys: CryptoKey[] = [];
    const real = crypto.subtle.deriveKey.bind(crypto.subtle);
    const spy = vi.spyOn(crypto.subtle, 'deriveKey').mockImplementation(async (...args: Parameters<SubtleCrypto['deriveKey']>) => {
      const k = await real(...args);
      keys.push(k);
      return k;
    });
    try {
      const row = await sealKey(ANT, PHRASE, UID);
      await openKey(row, PHRASE, UID);
      expect(spy).toHaveBeenCalledTimes(2);
      for (const call of spy.mock.calls) expect(call[3]).toBe(false);
      for (const k of keys) {
        expect(k.extractable).toBe(false);
        expect([...k.usages].sort()).toEqual(['decrypt', 'encrypt']);
        await expect(crypto.subtle.exportKey('raw', k)).rejects.toThrow();
      }
    } finally {
      spy.mockRestore();
    }
  });
});
