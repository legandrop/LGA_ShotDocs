import { expect, it, vi } from 'vitest';
import { WAIT_FOR_MS } from './patience';

// El plazo por defecto de las esperas por condición (src/test/patience.ts), que carga la configuración de las pruebas.

it('una condición que tarda más de un segundo en cumplirse se sigue esperando, sin pedir un plazo', async () => {
  const started = Date.now();
  let looks = 0;
  await vi.waitFor(() => {
    looks++;
    expect(Date.now() - started).toBeGreaterThanOrEqual(1300);
  });
  expect(looks).toBeGreaterThan(1);
});

it('el plazo por defecto queda por debajo del tope de cada prueba, así falla la condición y no el reloj', ({ task }) => {
  expect(WAIT_FOR_MS).toBeLessThan(task.timeout);
  expect(WAIT_FOR_MS).toBeGreaterThanOrEqual(5000);
});

it('una espera que pide su plazo lo conserva: una condición que nunca llega falla a ese tiempo, con su mensaje', async () => {
  const started = Date.now();
  await expect(vi.waitFor(() => expect('nunca').toBe('llega'), { timeout: 120 })).rejects.toThrow(/llega/);
  await expect(vi.waitFor(() => expect('nunca').toBe('llega'), 120)).rejects.toThrow(/llega/);
  expect(Date.now() - started).toBeLessThan(WAIT_FOR_MS / 2);
});
