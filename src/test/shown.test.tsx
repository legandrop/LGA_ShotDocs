// @vitest-environment jsdom
import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { WAIT_FOR_MS } from './patience';
import { shown } from './shown';

// Esperar algo que tiene que aparecer en la pantalla (src/test/shown.ts).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Cambia lo que muestra un rato después de montarse (como una ventana que primero lee la base). */
function Late({ ms }: { ms: number }) {
  const [text, setText] = useState('leyendo');
  useEffect(() => {
    const timer = setTimeout(() => setText('listo'), ms);
    return () => clearTimeout(timer);
  }, [ms]);
  return <p>{text}</p>;
}

const roots: Root[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = '';
});

function mount(ms: number): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<Late ms={ms} />));
  expect(host.textContent).toBe('leyendo');
  return host;
}

it('ve un cambio que llega mientras espera', async () => {
  const host = mount(150);
  await shown(() => expect(host.textContent).toBe('listo'));
});

it('el motivo: una espera por condición adentro de un act no ve lo que llega mientras espera', async () => {
  const host = mount(150);
  await expect(act(() => vi.waitFor(() => expect(host.textContent).toBe('listo'), { timeout: 600 }))).rejects.toThrow(/listo/);
});

it('devuelve lo que devuelve la condición, también si la condición espera', async () => {
  const host = mount(60);
  const text = await shown(async () => {
    await Promise.resolve();
    expect(host.textContent).toBe('listo');
    return host.textContent;
  });
  expect(text).toBe('listo');
});

it('si no llega, falla al cumplirse su plazo con el error de la condición', async () => {
  const host = mount(60_000);
  const started = Date.now();
  await expect(shown(() => expect(host.textContent).toBe('listo'), 150)).rejects.toThrow(/listo/);
  expect(Date.now() - started).toBeGreaterThanOrEqual(150);
  expect(Date.now() - started).toBeLessThan(WAIT_FOR_MS);
});
