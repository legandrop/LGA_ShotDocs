// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDraft, setDraft } from './commentsUi';
import { arrive, dismissNotice, followHeight, NO_NOTICE, notify, RESUME_MS, useNotice, WAITING_MAX, type NoticeAction } from './notice';

// El orden de los avisos (notice.ts, D356 a D358): la pantalla muestra uno a la vez, y uno con botón ya no pierde el
// botón porque llega otro. Se monta el mismo `useNotice` que usa la app, con el reloj de mentira.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let seen: { text: string | null; action?: NoticeAction; dismiss: () => void; hold: (source: 'mouse' | 'focus', on: boolean) => void } = { text: null, dismiss: () => undefined, hold: () => undefined };

function Host() {
  const [text, dismiss, action, , hold] = useNotice();
  seen = { text, action, dismiss, hold };
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  root = createRoot(document.createElement('div'));
  act(() => root!.render(<Host />));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
});

const say = (message: string, action?: NoticeAction) => act(() => notify(message, action));
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const button = (label: string, extra: Partial<NoticeAction> = {}): NoticeAction => ({ label, run: () => undefined, ...extra });

/** El aviso de un comentario que se cerró solo, tal como lo manda la app (commentsUi.ts). */
async function closedComment(text: string) {
  const key = Symbol('cuadro');
  setDraft(key, true, { text });
  await act(async () => closeDraft(key, false));
}

describe('el aviso de un comentario cerrado', () => {
  it('no lo saca ningún otro aviso antes de sus 15 segundos; el que llega después se muestra al terminar', async () => {
    await closedComment('A medio escribir');
    expect(seen.text).toBe('A comment you were writing was closed before you sent it.');
    expect(seen.action?.label).toBe('Copy text');
    await wait(2000);
    say('Undid the replacement', button('Redo'));
    await wait(8000);
    say('Link copied');
    await wait(4999);
    expect(seen.text).toBe('A comment you were writing was closed before you sent it.');
    expect(seen.action?.label).toBe('Copy text');
    await wait(1);
    // El de *Redo* esperó 13 segundos (menos que sus 15): sale entero; el común que llegó después, encima, y *Redo* vuelve.
    expect(seen.text).toBe('Link copied');
    await wait(6000);
    expect(seen.text).toBe('Undid the replacement');
    expect(seen.action?.label).toBe('Redo');
  });

  it('dos tandas de comentarios cerrados: la segunda espera y sale entera, aunque haya esperado más de su tiempo', async () => {
    await closedComment('Primero');
    await wait(1000);
    await closedComment('Segundo');
    await wait(13_000);
    act(() => seen.dismiss());
    // Cerrar el primero con OK deja ver el segundo, con su botón.
    expect(seen.action?.label).toBe('Copy text');
    await wait(14_999);
    expect(seen.action?.label).toBe('Copy text');
    await wait(1);
    expect(seen.text).toBeNull();
  });

  it('lo que esperó detrás más de lo que iba a estar a la vista ya no sale', async () => {
    await closedComment('A medio escribir');
    await wait(1000);
    say('Page title too long');
    await wait(14_000);
    expect(seen.text).toBeNull();
  });
});

describe('un aviso con botón y lo que llega después', () => {
  it('uno sin botón sale enseguida y el del botón vuelve después, con lo que le quedaba', async () => {
    say('Replaced in 12 pages', button('Undo'));
    await wait(3000);
    say('Nothing to undo');
    expect(seen.text).toBe('Nothing to undo');
    await wait(6000);
    expect(seen.text).toBe('Replaced in 12 pages');
    expect(seen.action?.label).toBe('Undo');
    await wait(11_999);
    expect(seen.text).toBe('Replaced in 12 pages');
    await wait(1);
    expect(seen.text).toBeNull();
  });

  it('uno con botón reemplaza a otro con botón, que no vuelve (Undo y después Redo)', async () => {
    say('Replaced in 12 pages', button('Undo'));
    say('Nothing to undo');
    say('Undid the replacement', button('Redo'));
    await wait(15_000);
    expect(seen.text).toBeNull();
  });

  it('uno que dejó de valer (dismissNotice) no vuelve', async () => {
    say('Restored the version', button('Undo', { key: 'restaurar' }));
    say('Saved');
    act(() => dismissNotice('restaurar'));
    await wait(6000);
    expect(seen.text).toBeNull();
  });
});

describe('con el mouse encima el aviso no vence (D712)', () => {
  const hold = (on: boolean) => act(() => seen.hold('mouse', on));

  it('el Undo se queda mientras el mouse está encima, y al soltarlo sigue con lo que le quedaba', async () => {
    say('Assigned 105_120', button('Undo'));
    await wait(10_000);
    hold(true);
    await wait(120_000);
    expect(seen.text).toBe('Assigned 105_120');
    expect(seen.action?.label).toBe('Undo');
    hold(false);
    // Le quedaban 5 segundos (más que el mínimo): vence a los 5.
    await wait(4999);
    expect(seen.text).toBe('Assigned 105_120');
    await wait(1);
    expect(seen.text).toBeNull();
  });

  it('si casi no le quedaba, al soltarlo hay un mínimo para llegar al botón', async () => {
    say('Assigned 105_120', button('Undo'));
    await wait(14_500);
    hold(true);
    await wait(30_000);
    hold(false);
    await wait(RESUME_MS - 1);
    expect(seen.text).toBe('Assigned 105_120');
    await wait(1);
    expect(seen.text).toBeNull();
  });

  it('un aviso que llega con el mouse encima empieza con su tiempo entero, y un mouseleave perdido no traba el siguiente', async () => {
    say('Uno', button('Undo'));
    hold(true);
    await wait(40_000);
    // El aviso se cierra con OK sin que llegue el mouseleave: el siguiente vence solo.
    act(() => seen.dismiss());
    expect(seen.text).toBeNull();
    say('Dos');
    await wait(6000);
    expect(seen.text).toBeNull();
  });
});

describe('la espera tiene tope', () => {
  it('detrás de un comentario esperan todos los comentarios y, de los demás, los últimos', () => {
    let s = arrive(NO_NOTICE, { message: 'comentario', action: button('Copy text', { keep: true }) }, 0);
    for (let i = 0; i < 10; i++) s = arrive(s, { message: `aviso ${i}`, action: i % 2 ? button('Undo') : undefined }, i);
    s = arrive(s, { message: 'otro comentario', action: button('Copy text', { keep: true }) }, 11);
    expect(s.shown?.detail.message).toBe('comentario');
    expect(s.waiting.map((w) => w.detail.message)).toEqual(['aviso 7', 'aviso 8', 'aviso 9', 'otro comentario']);
    expect(s.waiting.filter((w) => !w.detail.action?.keep)).toHaveLength(WAITING_MAX);
  });
});

describe('el alto de un aviso de abajo, para los que van apilados encima', () => {
  const sized = (height: number) => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'offsetHeight', { configurable: true, value: height });
    return el;
  };

  it('el común y el avance anotan su lugar en la app; sin el aviso, la variable no está', () => {
    const shell = document.createElement('div');
    const el = sized(62);
    shell.append(el);
    const done = followHeight('--progress-step', 13, 'parent')(el);
    expect(shell.style.getPropertyValue('--progress-step')).toBe('75px');
    done?.();
    expect(shell.style.getPropertyValue('--progress-step')).toBe('');
  });

  it('los de un link, que van afuera de la app, en la raíz del documento', () => {
    const done = followHeight('--link-offline-step', 13, 'root')(sized(43));
    expect(document.documentElement.style.getPropertyValue('--link-offline-step')).toBe('56px');
    done?.();
    expect(document.documentElement.style.getPropertyValue('--link-offline-step')).toBe('');
  });
});
