import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerHandoffs, askForHandoff } from './services';

// Las pestañas del navegador (services.ts, D812): la que se usa le pide el control a la que lo tiene. La otra lo da, o
// dice que no mientras hace algo que no se corta; si no contesta (congelada), se le saca.

const TIMES = { silent: 40, slow: 120 };
const open: BroadcastChannel[] = [];

function channel(): BroadcastChannel {
  const c = new BroadcastChannel('shotdocs-handoff:test');
  open.push(c);
  return c;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  for (const c of open.splice(0)) c.close();
});

describe('el traspaso entre pestañas', () => {
  it('la que tiene el control contesta y suelta: la otra no se lo saca', async () => {
    const release = vi.fn();
    answerHandoffs(channel(), { blocked: () => false, release });
    const on = { takeOver: vi.fn(), refused: vi.fn(), slow: vi.fn() };
    const stop = askForHandoff(channel(), 'b', on, TIMES);
    await wait(TIMES.silent + 20);
    expect(release).toHaveBeenCalledTimes(1);
    expect(on.takeOver).not.toHaveBeenCalled();
    expect(on.refused).not.toHaveBeenCalled();
    stop();
  });

  it('mientras hace algo que no se corta dice que no, y no suelta', async () => {
    const release = vi.fn();
    answerHandoffs(channel(), { blocked: () => true, release });
    const on = { takeOver: vi.fn(), refused: vi.fn(), slow: vi.fn() };
    askForHandoff(channel(), 'b', on, TIMES);
    await wait(TIMES.slow + 20);
    expect(on.refused).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    expect(on.takeOver).not.toHaveBeenCalled();
    expect(on.slow).not.toHaveBeenCalled();
  });

  it('sin respuesta: primero se ofrece tomar el control (puede estar ocupada) y, mucho después, se le saca', async () => {
    const on = { takeOver: vi.fn(), refused: vi.fn(), slow: vi.fn() };
    askForHandoff(channel(), 'b', on, TIMES);
    await wait(TIMES.silent + 20);
    expect(on.slow).toHaveBeenCalledTimes(1);
    expect(on.takeOver).not.toHaveBeenCalled();
    await wait(TIMES.slow - TIMES.silent);
    expect(on.takeOver).toHaveBeenCalledTimes(1);
  });

  it('contestó pero no soltó: se ofrece tomar el control, sin sacárselo', async () => {
    answerHandoffs(channel(), { blocked: () => false, release: () => undefined });
    const on = { takeOver: vi.fn(), refused: vi.fn(), slow: vi.fn() };
    askForHandoff(channel(), 'b', on, TIMES);
    await wait(TIMES.slow + 30);
    expect(on.slow).toHaveBeenCalledTimes(1);
    expect(on.takeOver).not.toHaveBeenCalled();
  });

  it('una respuesta para otra pestaña no cuenta; al recibir el lock se deja de esperar', async () => {
    const holder = channel();
    holder.addEventListener('message', () => holder.postMessage({ type: 'ack', to: 'otra' }));
    const on = { takeOver: vi.fn(), refused: vi.fn(), slow: vi.fn() };
    const stop = askForHandoff(channel(), 'b', on, TIMES);
    await wait(TIMES.slow + 20);
    expect(on.takeOver).toHaveBeenCalledTimes(1);
    const later = { takeOver: vi.fn(), refused: vi.fn(), slow: vi.fn() };
    askForHandoff(channel(), 'c', later, TIMES)();
    stop();
    await wait(TIMES.slow + 20);
    expect(later.takeOver).not.toHaveBeenCalled();
  });
});
