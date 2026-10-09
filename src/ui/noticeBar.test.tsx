// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoticeBar } from './NoticeBar';
import { ACTION_NOTICE_MS, notify } from './notice';

// El aviso de abajo en pantalla (D712): con el mouse o el foco encima no vence (el *Undo* de *Assign* o del reporte de
// mañana es la única forma de volver atrás), y al soltarlo sigue con lo que le quedaba.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<NoticeBar />));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  vi.useRealTimers();
});

const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const bar = () => host.querySelector<HTMLElement>('.notice');
// React arma onPointerEnter / onPointerLeave con pointerover / pointerout (jsdom no trae PointerEvent: se le pone el tipo).
const pointer = (type: string, el: Element, pointerType: string) => {
  const ev = new MouseEvent(type, { bubbles: true, relatedTarget: document.body });
  Object.defineProperty(ev, 'pointerType', { value: pointerType });
  act(() => void el.dispatchEvent(ev));
};
const over = (el: Element, pointerType = 'mouse') => pointer('pointerover', el, pointerType);
const out = (el: Element, pointerType = 'mouse') => pointer('pointerout', el, pointerType);

describe('el aviso con el mouse encima', () => {
  it('no vence mientras el mouse está encima; al soltarlo sigue con lo que le quedaba', async () => {
    act(() => notify('Assigned 105_120', { label: 'Undo', run: () => undefined }));
    await wait(10_000);
    over(bar()!);
    await wait(ACTION_NOTICE_MS * 4);
    expect(bar()?.textContent).toContain('Assigned 105_120');
    out(bar()!);
    await wait(4999);
    expect(bar()).not.toBeNull();
    await wait(1);
    expect(bar()).toBeNull();
  });

  it('el foco en uno de sus botones también lo sostiene', async () => {
    act(() => notify('Merged', { label: 'Undo', run: () => undefined }));
    const undo = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Undo')!;
    act(() => undo.focus());
    await wait(ACTION_NOTICE_MS * 3);
    expect(bar()).not.toBeNull();
    act(() => undo.blur());
    await wait(ACTION_NOTICE_MS);
    expect(bar()).toBeNull();
  });

  it('un toque (el teléfono) no lo sostiene: sigue corriendo (D717)', async () => {
    act(() => notify('Assigned 105_120', { label: 'Undo', run: () => undefined }));
    over(bar()!, 'touch');
    await wait(ACTION_NOTICE_MS - 1);
    expect(bar()).not.toBeNull();
    await wait(1);
    expect(bar()).toBeNull();
  });

  it('el mouse y el foco sostienen por separado: soltar el mouse no lo libera si el foco sigue', async () => {
    act(() => notify('Merged', { label: 'Undo', run: () => undefined }));
    const undo = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Undo')!;
    act(() => undo.focus());
    over(bar()!);
    out(bar()!);
    await wait(ACTION_NOTICE_MS * 3);
    expect(bar()).not.toBeNull();
    act(() => undo.blur());
    await wait(ACTION_NOTICE_MS);
    expect(bar()).toBeNull();
  });

  it('y al revés: soltar el foco no lo libera si el mouse sigue encima', async () => {
    act(() => notify('Merged', { label: 'Undo', run: () => undefined }));
    const undo = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Undo')!;
    over(bar()!);
    act(() => undo.focus());
    act(() => undo.blur());
    await wait(ACTION_NOTICE_MS * 3);
    expect(bar()).not.toBeNull();
    out(bar()!);
    await wait(ACTION_NOTICE_MS);
    expect(bar()).toBeNull();
  });

  it('el foco que deja un clic o un toque no lo sostiene: solo el del teclado', async () => {
    act(() => notify('Merged', { label: 'Undo', run: () => undefined }));
    const undo = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Undo')!;
    act(() => void undo.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
    act(() => undo.focus());
    await wait(ACTION_NOTICE_MS - 1);
    expect(bar()).not.toBeNull();
    await wait(1);
    expect(bar()).toBeNull();
    // Y un foco de teclado después (sin clic antes) sí lo sostiene.
    act(() => notify('Merged again', { label: 'Undo', run: () => undefined }));
    const again = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Undo')!;
    act(() => again.focus());
    await wait(ACTION_NOTICE_MS * 2);
    expect(bar()).not.toBeNull();
    act(() => again.blur());
  });

  it('sin mouse encima vence a sus 15 segundos, como siempre', async () => {
    act(() => notify('Assigned 105_120', { label: 'Undo', run: () => undefined }));
    await wait(ACTION_NOTICE_MS - 1);
    expect(bar()).not.toBeNull();
    await wait(1);
    expect(bar()).toBeNull();
  });
});
