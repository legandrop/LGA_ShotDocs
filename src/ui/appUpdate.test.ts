import { describe, expect, it, vi } from 'vitest';
import { AppUpdates, type WorkerContainer } from './appUpdate';

/** Un `navigator.serviceWorker` de mentira: el navegador encuentra (o no) una versión nueva al buscar. */
function fakeWorker(opts: { controlled?: boolean; newVersion?: boolean; activateMs?: number; fail?: boolean } = {}) {
  const events = new EventTarget();
  let controller: object | null = opts.controlled === false ? null : {};
  const reg = {
    installing: null as object | null,
    waiting: null as object | null,
    updates: 0,
    update: vi.fn(async () => {
      reg.updates++;
      if (opts.fail) throw new TypeError('Failed to fetch');
      if (!opts.newVersion) return;
      // Con `autoUpdate` (skipWaiting y clientsClaim): se instala y toma la pestaña enseguida.
      reg.installing = {};
      setTimeout(() => {
        reg.installing = null;
        takeOver();
      }, opts.activateMs ?? 5);
    }),
  };
  const takeOver = () => {
    controller = {};
    events.dispatchEvent(new Event('controllerchange'));
  };
  const container = {
    get controller() {
      return controller;
    },
    getRegistration: async () => reg,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  } as unknown as WorkerContainer;
  return { container, reg, takeOver };
}

function setup(worker: ReturnType<typeof fakeWorker>, waitMs = 1000) {
  const reload = vi.fn(async () => undefined);
  const reloadByHand = vi.fn();
  const win = new EventTarget();
  let clock = 0;
  const updates = new AppUpdates({
    container: worker.container,
    reload,
    reloadByHand,
    events: win as unknown as Window,
    now: () => clock,
    waitMs,
  });
  return { updates, reload, reloadByHand, win, advance: (ms: number) => (clock += ms) };
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

describe('la versión nueva de la app cuando el workspace pide una más nueva', () => {
  it('al enterarse de que es vieja busca la versión nueva y recarga sola cuando toma el control', async () => {
    const worker = fakeWorker({ newVersion: true });
    const { updates, reload } = setup(worker);
    updates.setOutdated(true);
    await tick();
    expect(worker.reg.update).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    updates.stop();
  });

  it('una versión nueva que toma el control sin que esta sea vieja no recarga; si después resulta vieja, recarga', async () => {
    const worker = fakeWorker();
    const { updates, reload } = setup(worker);
    worker.takeOver();
    await tick();
    expect(reload).not.toHaveBeenCalled();
    updates.setOutdated(true);
    await tick();
    expect(reload).toHaveBeenCalledTimes(1);
    // El navegador ya la tenía: no hace falta buscarla.
    expect(worker.reg.update).not.toHaveBeenCalled();
    updates.stop();
  });

  it('la primera instalación (sin service worker antes) no es una versión nueva', async () => {
    const worker = fakeWorker({ controlled: false });
    const { updates, reload } = setup(worker);
    updates.setOutdated(true);
    worker.takeOver();
    await tick();
    expect(reload).not.toHaveBeenCalled();
    worker.takeOver();
    await tick();
    expect(reload).toHaveBeenCalledTimes(1);
    updates.stop();
  });

  it('sin la versión nueva publicada todavía, vuelve a buscar al volver la red, nunca más de una vez cada 30 s sola', async () => {
    const worker = fakeWorker();
    const { updates, reload, win, advance } = setup(worker);
    updates.setOutdated(true);
    await tick();
    expect(worker.reg.updates).toBe(1);
    win.dispatchEvent(new Event('online'));
    await tick();
    expect(worker.reg.updates).toBe(2);
    // Mientras sigue vieja, otro aviso de vieja no busca de nuevo.
    updates.setOutdated(true);
    await tick();
    expect(worker.reg.updates).toBe(2);
    updates.setOutdated(false);
    win.dispatchEvent(new Event('online'));
    await tick();
    expect(worker.reg.updates).toBe(2);
    advance(10_000);
    updates.setOutdated(true);
    await tick();
    expect(worker.reg.updates).toBe(2);
    advance(30_000);
    updates.setOutdated(false);
    updates.setOutdated(true);
    await tick();
    expect(worker.reg.updates).toBe(3);
    expect(reload).not.toHaveBeenCalled();
    updates.stop();
  });

  it('sin red al buscar no tira ni recarga', async () => {
    const worker = fakeWorker({ fail: true });
    const { updates, reload } = setup(worker);
    updates.setOutdated(true);
    await tick();
    expect(reload).not.toHaveBeenCalled();
    updates.stop();
  });

  it('"Update now" espera a que la versión nueva tome el control antes de recargar', async () => {
    const worker = fakeWorker({ newVersion: true, activateMs: 50 });
    const { updates, reloadByHand } = setup(worker);
    const done = updates.updateNow();
    await tick(10);
    expect(reloadByHand).not.toHaveBeenCalled();
    await done;
    expect(reloadByHand).toHaveBeenCalledTimes(1);
    expect(worker.container.controller).toBeTruthy();
    updates.stop();
  });

  it('"Update now" sin versión nueva, o con la nueva ya al mando, recarga enseguida', async () => {
    const none = fakeWorker();
    const a = setup(none);
    await a.updates.updateNow();
    expect(none.reg.updates).toBe(1);
    expect(a.reloadByHand).toHaveBeenCalledTimes(1);
    a.updates.stop();

    const ready = fakeWorker();
    const b = setup(ready);
    ready.takeOver();
    await b.updates.updateNow();
    expect(ready.reg.updates).toBe(0);
    expect(b.reloadByHand).toHaveBeenCalledTimes(1);
    b.updates.stop();
  });

  it('"Update now" no espera para siempre a una versión que no termina de instalarse', async () => {
    const worker = fakeWorker({ newVersion: true, activateMs: 10_000 });
    const { updates, reloadByHand } = setup(worker, 60);
    await updates.updateNow();
    expect(reloadByHand).toHaveBeenCalledTimes(1);
    updates.stop();
  });

  it('sin service worker, "Update now" recarga directo', async () => {
    const reloadByHand = vi.fn();
    const updates = new AppUpdates({ container: null, reloadByHand, events: null });
    updates.setOutdated(true);
    await updates.updateNow();
    expect(reloadByHand).toHaveBeenCalledTimes(1);
  });
});
