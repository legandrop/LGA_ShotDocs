// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ColorPicker } from './ColorPicker';

// El picker de color (ColorPicker.tsx): como el de las apps de escritorio de LGA, avisa cada cambio (vista previa) y
// solo OK confirma; Cancel y Escape descartan; el hex se escribe y se confirma; el reset vuelve al de fábrica.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];

afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});

function setup(initial = '#2e5a8e') {
  const props = {
    initial,
    defaultColor: '#8e2e5a',
    presets: ['#2e5a8e', '#443a91', '#774dcb'],
    recents: ['#123456'],
    onChange: vi.fn(),
    onAccept: vi.fn(),
    onCancel: vi.fn(),
  };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<ColorPicker {...props} />));
  return props;
}

const byLabel = (label: string) => document.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === text)!;
const click = (el: HTMLElement) => act(() => el.click());
const key = (el: HTMLElement, k: string, init: KeyboardEventInit = {}) =>
  act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })));

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('ColorPicker', () => {
  it('abrir no avisa nada; un color de la paleta avisa y OK lo confirma', () => {
    const p = setup();
    expect(p.onChange).not.toHaveBeenCalled();
    click(byLabel('#774dcb'));
    expect(p.onChange).toHaveBeenLastCalledWith('#774dcb');
    click(button('OK'));
    expect(p.onAccept).toHaveBeenCalledWith('#774dcb');
    expect(p.onCancel).not.toHaveBeenCalled();
  });

  it('los recientes también se eligen; los lugares vacíos no son botones', () => {
    const p = setup();
    click(byLabel('#123456'));
    expect(p.onChange).toHaveBeenLastCalledWith('#123456');
    // 8 + 8 lugares: 3 de fábrica y 1 reciente con color.
    expect(document.querySelectorAll('span.cp-swatch.empty')).toHaveLength(12);
  });

  it('Cancel y Escape descartan sin confirmar', () => {
    const p = setup();
    click(button('Cancel'));
    expect(p.onCancel).toHaveBeenCalledTimes(1);
    key(byLabel('Hue'), 'Escape');
    expect(p.onCancel).toHaveBeenCalledTimes(2);
    expect(p.onAccept).not.toHaveBeenCalled();
  });

  it('el hex escrito se confirma con Enter o al salir; uno roto vuelve al de antes', () => {
    const p = setup();
    const hex = byLabel('Hex color') as HTMLInputElement;
    expect(hex.value).toBe('#2e5a8e');
    act(() => hex.focus());
    type(hex, 'ABC');
    act(() => hex.blur());
    expect(p.onChange).toHaveBeenLastCalledWith('#aabbcc');
    expect(hex.value).toBe('#aabbcc');
    act(() => hex.focus());
    type(hex, 'nada');
    act(() => hex.blur());
    expect(hex.value).toBe('#aabbcc');
    type(hex, '#00ff00');
    key(hex, 'Enter');
    expect(p.onAccept).toHaveBeenLastCalledWith('#00ff00');
  });

  it('el reset vuelve al color de fábrica y las flechas mueven las barras', () => {
    const p = setup('#ff0000');
    click(byLabel('Back to the default color'));
    expect(p.onChange).toHaveBeenLastCalledWith('#8e2e5a');
    const value = byLabel('Brightness');
    const before = Number(value.getAttribute('aria-valuenow'));
    key(value, 'ArrowLeft', { shiftKey: true });
    expect(Number(byLabel('Brightness').getAttribute('aria-valuenow'))).toBe(before - 10);
  });

  it('Custom se pliega y se despliega', () => {
    setup();
    const toggle = document.querySelector<HTMLButtonElement>('.cp-custom-toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    click(toggle);
    expect(document.querySelector('[aria-label="Hue"]')).toBeNull();
    click(toggle);
    expect(document.querySelector('[aria-label="Hue"]')).not.toBeNull();
  });
});
