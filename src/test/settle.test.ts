import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { expect, it } from 'vitest';
import { drained, settled } from './settle';

// Esperar a que la app termine lo que tiene en marcha (src/test/settle.ts).

/** Un trabajo de `steps` pasos encadenados, cada uno en una tarea aparte del proceso (como los pedidos a la base). */
function chain(steps: number, done: () => void): void {
  if (steps === 0) return done();
  setImmediate(() => void Promise.resolve().then(() => chain(steps - 1, done)));
}

it('espera a que termine una cadena larga de pasos, sin que nadie le diga cuánto tarda', async () => {
  let finished = false;
  chain(5000, () => (finished = true));
  await drained();
  expect(finished).toBe(true);
});

it('una cadena de lecturas y escrituras en la base en memoria termina antes de seguir', async () => {
  const db = await openDB(`settle-${crypto.randomUUID()}`, 1, { upgrade: (d) => void d.createObjectStore('n') });
  let written = 0;
  void (async () => {
    for (let i = 0; i < 300; i++) {
      await db.put('n', ((await db.get('n', 'k')) ?? 0) + 1, 'k');
      written++;
    }
  })();
  await settled();
  expect(written).toBe(300);
  expect(await db.get('n', 'k')).toBe(300);
  db.close();
});

it('con un rato pedido, espera ese rato y después lo que ese rato disparó', async () => {
  let finished = false;
  setTimeout(() => chain(2000, () => (finished = true)), 40);
  const started = Date.now();
  await settled(60);
  expect(Date.now() - started).toBeGreaterThanOrEqual(55);
  expect(finished).toBe(true);
});

it('un paso que salta por un temporizador corto y sigue trabajando también se espera', async () => {
  let finished = false;
  chain(200, () => setTimeout(() => chain(200, () => setTimeout(() => chain(200, () => (finished = true)), 0)), 0));
  await drained();
  expect(finished).toBe(true);
});

it('una vuelta que nunca se calma no cuelga la prueba: corta a su tope', async () => {
  let spinning = true;
  const spin = () => void (spinning && setImmediate(spin));
  spin();
  const started = Date.now();
  await drained(150);
  spinning = false;
  expect(Date.now() - started).toBeGreaterThanOrEqual(140);
  expect(Date.now() - started).toBeLessThan(5000);
});
