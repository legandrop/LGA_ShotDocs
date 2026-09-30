import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CODA_OWNER_HASH, emailHash, isCodaOwner, setCodaOwnerForTests } from './codaOwner';

// "Importar de Coda" es solo de la cuenta de Lega: se compara el SHA-256 del correo con una constante, así
// el correo no aparece en el repositorio (público). Estas pruebas usan correos de ejemplo.

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

afterEach(() => setCodaOwnerForTests());

describe('cuenta de Lega (codaOwner)', () => {
  it('la constante es un SHA-256 en hex', () => {
    expect(CODA_OWNER_HASH).toMatch(/^[0-9a-f]{64}$/);
  });

  it('el hash es el SHA-256 del correo sin espacios alrededor y en minúsculas', async () => {
    expect(await emailHash('  Alguien@Ejemplo.COM \n')).toBe(sha256('alguien@ejemplo.com'));
  });

  it('solo el correo cuyo hash es el permitido; sin correo o sin Web Crypto, nadie', async () => {
    setCodaOwnerForTests({ hash: sha256('alguien@ejemplo.com') });
    expect(await isCodaOwner({ id: 'a', email: 'Alguien@Ejemplo.com' })).toBe(true);
    expect(await isCodaOwner({ id: 'b', email: 'otra@ejemplo.com' })).toBe(false);
    expect(await isCodaOwner({ id: 'c', email: '' })).toBe(false);
    setCodaOwnerForTests({ hash: sha256('alguien@ejemplo.com'), hashOf: async () => Promise.reject(new Error('sin crypto.subtle')) });
    expect(await isCodaOwner({ id: 'a', email: 'alguien@ejemplo.com' })).toBe(false);
  });

  it('calcula una sola vez por usuario', async () => {
    const hashOf = vi.fn(async () => 'x');
    setCodaOwnerForTests({ hash: 'x', hashOf });
    await Promise.all([isCodaOwner({ id: 'a', email: 'a@ejemplo.com' }), isCodaOwner({ id: 'a', email: 'a@ejemplo.com' })]);
    expect(await isCodaOwner({ id: 'a', email: 'a@ejemplo.com' })).toBe(true);
    expect(hashOf).toHaveBeenCalledTimes(1);
  });
});
