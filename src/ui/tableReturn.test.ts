// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNavHistory } from '../navHistory';
import { navigate, nextFromTable, pagePath, tableReturnPath } from '../router';
import { isBackToTableShortcut, listenBackToTable } from './tableReturn';

// Esc vuelve a la tabla (D822): la página abierta desde una fila recuerda su tabla en su entrada del historial, y Esc
// (sin nada abierto encima, fuera de un campo de texto) vuelve ahí.

const TABLE = pagePath('00000000-0000-4000-8000-00000000000a');
const SCENE = pagePath('00000000-0000-4000-8000-00000000000b');
const OTHER = pagePath('00000000-0000-4000-8000-00000000000c');
const rawReplace = History.prototype.replaceState;

let uninstall: () => void = () => undefined;
let stop: () => void = () => undefined;

function popped(): Promise<void> {
  return new Promise((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }));
}

function esc(target: EventTarget = document.body, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  sessionStorage.clear();
  rawReplace.call(history, null, '', '/');
  uninstall = installNavHistory();
  stop = listenBackToTable();
  navigate(TABLE);
  // Pasa el tiempo en que otro atrás no se acepta.
  vi.setSystemTime(Date.now() + 600);
});

afterEach(() => {
  stop();
  uninstall();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('Esc vuelve a la tabla', () => {
  it('la página abierta desde la tabla la recuerda y Esc vuelve atrás, a la tabla', async () => {
    nextFromTable();
    navigate(SCENE);
    expect(tableReturnPath()).toBe(TABLE);
    const done = popped();
    expect(esc().defaultPrevented).toBe(true);
    await done;
    expect(location.pathname).toBe(TABLE);
    // En la tabla, Esc no hace nada.
    expect(tableReturnPath()).toBeNull();
    expect(esc().defaultPrevented).toBe(false);
  });

  it('una página abierta de otra forma no tiene a dónde volver', () => {
    navigate(SCENE);
    expect(tableReturnPath()).toBeNull();
    expect(esc().defaultPrevented).toBe(false);
    expect(location.pathname).toBe(SCENE);
  });

  it('la marca vale para la página que se abre enseguida, no para una que se abre mucho después', () => {
    nextFromTable();
    vi.setSystemTime(Date.now() + 5000);
    navigate(SCENE);
    expect(tableReturnPath()).toBeNull();
  });

  it('una página abierta después, desde la escena, no vuelve a la tabla; atrás a la escena, sí', async () => {
    nextFromTable();
    navigate(SCENE);
    navigate(OTHER);
    expect(tableReturnPath()).toBeNull();
    vi.setSystemTime(Date.now() + 600);
    const done = popped();
    history.back();
    await done;
    expect(location.pathname).toBe(SCENE);
    expect(tableReturnPath()).toBe(TABLE);
  });

  it('la marca sobrevive a un replaceState que limpia la dirección', () => {
    nextFromTable();
    navigate(SCENE);
    history.replaceState(null, '', `${SCENE}?w=x`);
    expect(tableReturnPath()).toBe(TABLE);
  });

  it('con algo abierto encima, en un campo de texto o con otras teclas, Esc no vuelve', () => {
    nextFromTable();
    navigate(SCENE);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    // JSDOM no mide: el diálogo «se ve» si tiene una caja.
    vi.spyOn(dialog, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    expect(esc().defaultPrevented).toBe(false);
    dialog.remove();
    const input = document.createElement('input');
    document.body.append(input);
    expect(esc(input).defaultPrevented).toBe(false);
    expect(esc(document.body, { shiftKey: true }).defaultPrevented).toBe(false);
    expect(location.pathname).toBe(SCENE);
  });

  it('un menú que se cierra con Esc desde `document` (y sale de la página antes de `window`) no vuelve además a la tabla', () => {
    nextFromTable();
    navigate(SCENE);
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    document.body.append(menu);
    vi.spyOn(menu, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    // Como `useFloating`: cierra en `document`, sin frenar el evento; React lo saca antes de la burbuja de `window`.
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') menu.remove();
    };
    document.addEventListener('keydown', close);
    try {
      expect(esc().defaultPrevented).toBe(false);
      expect(menu.isConnected).toBe(false);
      expect(location.pathname).toBe(SCENE);
    } finally {
      document.removeEventListener('keydown', close);
    }
  });

  it('el Esc de un IME (keyCode 229) no vuelve', () => {
    nextFromTable();
    navigate(SCENE);
    expect(esc(document.body, { keyCode: 229 } as KeyboardEventInit).defaultPrevented).toBe(false);
    expect(location.pathname).toBe(SCENE);
  });

  it('desde el título de la página, sí (el título se guarda igual al salir)', async () => {
    nextFromTable();
    navigate(SCENE);
    const title = document.createElement('textarea');
    title.className = 'page-title';
    document.body.append(title);
    const done = popped();
    expect(esc(title).defaultPrevented).toBe(true);
    await done;
    expect(location.pathname).toBe(TABLE);
  });

  it('con una sola entrada (el documento de práctica), la marca no queda pegada a la tabla ni a otra página', () => {
    // El documento de práctica convierte cada pushState en replaceState: la marca de la entrada es siempre la misma.
    const replace = history.replaceState.bind(history);
    const push = history.pushState;
    history.pushState = (state, unused, url) => replace(state, unused, url);
    try {
      nextFromTable();
      navigate(SCENE);
      expect(tableReturnPath()).toBe(TABLE);
      expect(esc().defaultPrevented).toBe(true);
      expect(location.pathname).toBe(TABLE);
      // En la tabla misma, Esc no es de la tabla (el recorrido lo usa para preguntar si salir).
      expect(tableReturnPath()).toBeNull();
      navigate(OTHER);
      expect(tableReturnPath()).toBeNull();
    } finally {
      history.pushState = push;
    }
  });

  it('el globito del recorrido no frena el Esc; su pregunta de salir, sí', () => {
    nextFromTable();
    navigate(SCENE);
    const bubble = document.createElement('div');
    bubble.className = 'tour-bubble';
    bubble.setAttribute('role', 'dialog');
    bubble.setAttribute('data-asking', '');
    document.body.append(bubble);
    vi.spyOn(bubble, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    expect(esc().defaultPrevented).toBe(false);
    bubble.removeAttribute('data-asking');
    expect(esc().defaultPrevented).toBe(true);
  });

  it('la tarjeta del recorrido en la esquina («¿Seguimos?») tampoco frena el Esc', () => {
    nextFromTable();
    navigate(SCENE);
    const card = document.createElement('div');
    card.className = 'tour-card';
    card.setAttribute('role', 'dialog');
    document.body.append(card);
    vi.spyOn(card, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    expect(esc().defaultPrevented).toBe(true);
  });

  it('Esc solo, sin otras teclas', () => {
    expect(isBackToTableShortcut({ key: 'Escape', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false })).toBe(true);
    expect(isBackToTableShortcut({ key: 'Escape', ctrlKey: false, metaKey: true, altKey: false, shiftKey: false })).toBe(false);
    expect(isBackToTableShortcut({ key: 'Enter', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false })).toBe(false);
  });
});
