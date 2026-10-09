import { describe, expect, it, vi } from 'vitest';
import {
  AppUpdates,
  ControllerWatch,
  FORCE_FREE_BYTES,
  forceUpdate,
  isOfflineNotReady,
  mainScriptOf,
  refreshNotReady,
  type ForceDeps,
  type WorkerContainer,
} from './appUpdate';
import { acceptDraftLoss, draftLossAccepted, withdrawDraftLoss } from './commentsUi';
import { reloadTimings } from './lazyPart';

/**
 * Un `navigator.serviceWorker` de mentira: el navegador encuentra (o no) una versión nueva al buscar. Cada instalación
 * avisa `updatefound` en el registro. `failsAtOnce`: falla antes de que `update()` termine (ya no está en
 * `reg.installing` cuando se mira).
 */
function fakeWorker(
  opts: {
    controlled?: boolean;
    newVersion?: boolean;
    activateMs?: number;
    fail?: boolean;
    installFails?: boolean;
    failsAtOnce?: boolean;
  } = {},
) {
  const events = new EventTarget();
  let controller: object | null = opts.controlled === false ? null : {};
  /** Empieza una instalación (como el navegador): avisa `updatefound` y devuelve el service worker nuevo. */
  const startInstall = () => {
    const installing = Object.assign(new EventTarget(), { state: 'installing' as ServiceWorkerState });
    reg.installing = installing;
    reg.dispatchEvent(new Event('updatefound'));
    return installing;
  };
  /** La instalación falla: el service worker nuevo se descarta. */
  const failInstall = (installing: EventTarget & { state: ServiceWorkerState }) => {
    reg.installing = null;
    installing.state = 'redundant';
    installing.dispatchEvent(new Event('statechange'));
  };
  const reg = Object.assign(new EventTarget(), {
    installing: null as object | null,
    waiting: null as object | null,
    updates: 0,
    unregister: vi.fn(async () => true),
    update: vi.fn(async () => {
      reg.updates++;
      if (opts.fail) throw new TypeError('Failed to fetch');
      if (!opts.newVersion) return;
      // Con `autoUpdate` (skipWaiting y clientsClaim): se instala y toma la pestaña enseguida.
      const installing = startInstall();
      if (opts.failsAtOnce) {
        failInstall(installing);
        return;
      }
      setTimeout(() => {
        reg.installing = null;
        // Un archivo del precache no baja (sin espacio, la red se corta): el service worker nuevo se descarta.
        if (opts.installFails) failInstall(installing);
        else takeOver();
      }, opts.activateMs ?? 5);
    }),
  });
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
  return { container, reg, takeOver, startInstall, failInstall };
}

function setup(
  worker: ReturnType<typeof fakeWorker>,
  waitMs = 1000,
  opts: { watch?: ControllerWatch; published?: string | null; unsaved?: () => boolean } = {},
) {
  const reload = vi.fn(async () => undefined);
  const reloadByHand = vi.fn();
  const onStuck = vi.fn();
  const win = new EventTarget();
  let clock = 0;
  const updates = new AppUpdates({
    container: worker.container,
    watch: opts.watch,
    reload,
    reloadByHand,
    unsaved: opts.unsaved ?? (() => false),
    published: async () => (opts.published === undefined ? null : opts.published),
    running: () => 'index-viejo.js',
    onStuck,
    events: win as unknown as Window,
    now: () => clock,
    waitMs,
  });
  return { updates, reload, reloadByHand, onStuck, win, advance: (ms: number) => (clock += ms) };
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

  it('el intento sigue pendiente mientras la recarga manual guarda lo escrito en el dispositivo', async () => {
    let saved!: () => void;
    const saving = new Promise<void>((resolve) => { saved = resolve; });
    const reloadByHand = vi.fn(() => saving);
    const updates = new AppUpdates({ container: null, reloadByHand, events: null });
    let finished = false;
    const done = updates.updateNow().then(() => { finished = true; });
    await tick();
    expect(reloadByHand).toHaveBeenCalledTimes(1);
    expect(finished).toBe(false);
    saved();
    await done;
    expect(finished).toBe(true);
    updates.stop();
  });

  it('una versión nueva que tomó el control antes de entrar al workspace también cuenta (se anota desde el arranque)', async () => {
    const worker = fakeWorker();
    const watch = new ControllerWatch(worker.container);
    worker.takeOver();
    const { updates, reload } = setup(worker, 1000, { watch });
    updates.setOutdated(true);
    await tick();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(worker.reg.update).not.toHaveBeenCalled();
    updates.stop();
  });

  it('con algo sin guardar no intenta recargar ni avisa; vuelve a probar con los cambios de estado, no más de una vez cada 5 s', async () => {
    const worker = fakeWorker();
    let unsaved = true;
    const { updates, reload, advance } = setup(worker, 1000, { unsaved: () => unsaved });
    updates.setOutdated(true);
    worker.takeOver();
    await tick();
    expect(reload).not.toHaveBeenCalled();
    unsaved = false;
    updates.setOutdated(true);
    await tick();
    expect(reload).toHaveBeenCalledTimes(1);
    // La recarga no pasó (por ejemplo, la guarda de un minuto): los cambios de estado seguidos no la repiten enseguida.
    updates.setOutdated(true);
    updates.setOutdated(true);
    await tick();
    expect(reload).toHaveBeenCalledTimes(1);
    advance(5_000);
    updates.setOutdated(true);
    await tick();
    expect(reload).toHaveBeenCalledTimes(2);
    updates.stop();
  });

  it('"Update now" sin versión nueva en el navegador pero con otra en el servidor ofrece forzarla en vez de recargar', async () => {
    const worker = fakeWorker();
    const { updates, reloadByHand, onStuck } = setup(worker, 1000, { published: 'index-nuevo.js' });
    updates.setOutdated(true);
    await updates.updateNow();
    expect(reloadByHand).not.toHaveBeenCalled();
    expect(onStuck).toHaveBeenLastCalledWith('force');
    // Si deja de ser vieja (bajaron la mínima), ya no se ofrece.
    updates.setOutdated(false);
    expect(onStuck).toHaveBeenLastCalledWith('none');
    updates.stop();

    // Con la misma versión en el servidor (o sin poder leerla), recarga como siempre.
    const same = setup(fakeWorker(), 1000, { published: 'index-viejo.js' });
    same.updates.setOutdated(true);
    await same.updates.updateNow();
    expect(same.reloadByHand).toHaveBeenCalledTimes(1);
    same.updates.stop();
  });

  it('si la instalación de la versión nueva falla, no ofrece forzar: explica qué hacer (forzar dejaría la app sin abrir sin red)', async () => {
    const worker = fakeWorker({ newVersion: true, installFails: true, activateMs: 20 });
    const { updates, reloadByHand, onStuck } = setup(worker, 1000, { published: 'index-nuevo.js' });
    updates.setOutdated(true);
    await tick(60);
    await updates.updateNow();
    expect(onStuck).toHaveBeenLastCalledWith('failed');
    expect(onStuck).not.toHaveBeenCalledWith('force');
    expect(reloadByHand).not.toHaveBeenCalled();
    updates.stop();
  });

  it('si la instalación falla antes de que se la mire, tampoco ofrece forzar (se sigue desde `updatefound`)', async () => {
    const worker = fakeWorker({ newVersion: true, failsAtOnce: true });
    const { updates, reloadByHand, onStuck } = setup(worker, 1000, { published: 'index-nuevo.js' });
    updates.setOutdated(true);
    await tick();
    await updates.updateNow();
    // `update()` terminó con `reg.installing` vacío: sin seguir la instalación, parecía que el navegador nunca empezó.
    expect(worker.reg.installing).toBeNull();
    expect(onStuck).toHaveBeenLastCalledWith('failed');
    expect(onStuck).not.toHaveBeenCalledWith('force');
    expect(reloadByHand).not.toHaveBeenCalled();
    updates.stop();
  });

  it('también si el service worker se registró después de entrar (la primera vez que se abre la app)', async () => {
    const worker = fakeWorker({ newVersion: true, failsAtOnce: true });
    const real = worker.container.getRegistration;
    let calls = 0;
    (worker.container as { getRegistration: () => Promise<unknown> }).getRegistration = async () => (calls++ === 0 ? undefined : real());
    const { updates, onStuck } = setup(worker, 1000, { published: 'index-nuevo.js' });
    updates.setOutdated(true);
    await tick();
    await updates.updateNow();
    expect(onStuck).toHaveBeenLastCalledWith('failed');
    updates.stop();
  });

  it('una instalación que empezó el navegador solo y falló también cuenta; una que después anda, borra la falla', async () => {
    const worker = fakeWorker();
    const { updates, reloadByHand, onStuck } = setup(worker, 1000, { published: 'index-nuevo.js' });
    await tick();
    // El navegador busca por su cuenta (al abrir o al volver la red), empieza a instalar y no puede.
    worker.failInstall(worker.startInstall());
    updates.setOutdated(true);
    await tick();
    await updates.updateNow();
    expect(onStuck).toHaveBeenLastCalledWith('failed');
    expect(reloadByHand).not.toHaveBeenCalled();

    // Más tarde empieza otra instalación y llega a instalarse (pero no toma el control): ya no hay falla anotada.
    const next = worker.startInstall();
    next.state = 'installed';
    next.dispatchEvent(new Event('statechange'));
    worker.reg.installing = null;
    await updates.updateNow();
    expect(onStuck).toHaveBeenLastCalledWith('force');
    updates.stop();
  });

  it('una instalación que falló y después el servidor publica otra vez la versión que corre: "Update now" recarga, sin decir que falló', async () => {
    const worker = fakeWorker();
    const { updates, reloadByHand, onStuck } = setup(worker, 1000, { published: 'index-viejo.js' });
    await tick();
    worker.failInstall(worker.startInstall());
    updates.setOutdated(true);
    await tick();
    await updates.updateNow();
    expect(reloadByHand).toHaveBeenCalledTimes(1);
    expect(onStuck).not.toHaveBeenCalledWith('failed');
    expect(onStuck).not.toHaveBeenCalledWith('force');
    updates.stop();

    // Sin poder leer qué versión tiene el servidor, la falla anotada sigue valiendo.
    const blind = fakeWorker();
    const unknown = setup(blind, 1000, { published: null });
    await tick();
    blind.failInstall(blind.startInstall());
    unknown.updates.setOutdated(true);
    await tick();
    await unknown.updates.updateNow();
    expect(unknown.onStuck).toHaveBeenLastCalledWith('failed');
    expect(unknown.reloadByHand).not.toHaveBeenCalled();
    unknown.updates.stop();
  });

  it('una versión que llegó a instalarse y después quedó reemplazada no es una falla', async () => {
    const worker = fakeWorker();
    const { updates, onStuck } = setup(worker, 1000, { published: 'index-nuevo.js' });
    await tick();
    const done = worker.startInstall();
    done.state = 'installed';
    done.dispatchEvent(new Event('statechange'));
    worker.failInstall(done);
    updates.setOutdated(true);
    await tick();
    await updates.updateNow();
    expect(onStuck).toHaveBeenLastCalledWith('force');
    updates.stop();
  });

  it('el archivo principal de un index.html', () => {
    expect(mainScriptOf('<script type="module" crossorigin src="/assets/index-Cn9KvtxV.js"></script>')).toBe('index-Cn9KvtxV.js');
    expect(mainScriptOf('http://localhost:4221/assets/index-BEb5lLGl.js')).toBe('index-BEb5lLGl.js');
    expect(mainScriptOf('<html></html>')).toBeNull();
  });
});

describe('forzar la actualización', () => {
  function forceSetup(over: Partial<ForceDeps> = {}) {
    const worker = fakeWorker();
    const reload = vi.fn();
    const deps: ForceDeps = {
      container: worker.container,
      online: () => true,
      published: async () => 'index-nuevo.js',
      saved: async () => true,
      confirmDrafts: () => true,
      freeBytes: async () => 500 * 1024 * 1024,
      markForced: vi.fn(),
      reload,
      ...over,
    };
    return { worker, reload, deps };
  }

  it('con red y todo guardado: saca el service worker y recarga', async () => {
    const { worker, reload, deps } = forceSetup();
    expect(await forceUpdate(deps)).toBe('reloaded');
    expect(deps.markForced).toHaveBeenCalledTimes(1);
    expect(worker.reg.unregister).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('nunca deja la app sin service worker y sin red: sin conexión o sin respuesta del servidor no toca nada', async () => {
    for (const over of [{ online: () => false }, { published: async () => null }] as Partial<ForceDeps>[]) {
      const { worker, reload, deps } = forceSetup(over);
      expect(await forceUpdate(deps)).not.toBe('reloaded');
      expect(worker.reg.unregister).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
    }
  });

  it('con algo sin guardar, o un comentario sin mandar que la persona quiere conservar, no hace nada', async () => {
    for (const over of [{ saved: async () => false }, { confirmDrafts: () => false }] as Partial<ForceDeps>[]) {
      const { worker, reload, deps } = forceSetup(over);
      expect(await forceUpdate(deps)).not.toBe('reloaded');
      expect(worker.reg.unregister).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
    }
  });

  it('el «sí» a perder un comentario a medio escribir vale para esta recarga: si no recargó, deja de valer', async () => {
    // Quien pregunta lo anota (`confirmDraftLoss`): mientras vale, la pregunta del navegador al recargar no repite la de la app.
    const yes = () => (acceptDraftLoss(), true);
    // La página que se va avisa con `pagehide` (acá no llega nunca).
    vi.stubGlobal('window', new EventTarget());
    const pagehideMs = reloadTimings.pagehideMs;
    reloadTimings.pagehideMs = 30;
    try {
      expect(await forceUpdate(forceSetup({ confirmDrafts: yes, freeBytes: async () => 1 }).deps)).toBe('noSpace');
      expect(draftLossAccepted()).toBe(false);
      expect(await forceUpdate(forceSetup({ confirmDrafts: yes }).deps)).toBe('reloaded');
      expect(draftLossAccepted()).toBe(true);
      // Recargó, pero la página sigue acá un rato después: deja de valer.
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(draftLossAccepted()).toBe(false);
    } finally {
      reloadTimings.pagehideMs = pagehideMs;
      vi.unstubAllGlobals();
      withdrawDraftLoss();
    }
  });

  it('sin service worker no hace nada', async () => {
    const { reload, deps } = forceSetup({ container: null });
    expect(await forceUpdate(deps)).not.toBe('reloaded');
    expect(reload).not.toHaveBeenCalled();
  });

  it('sin lugar holgado para instalar la versión nueva (o sin saber cuánto hay), no saca el service worker', async () => {
    for (const free of [FORCE_FREE_BYTES - 1, null]) {
      const { worker, reload, deps } = forceSetup({ freeBytes: async () => free });
      expect(await forceUpdate(deps)).toBe('noSpace');
      expect(worker.reg.unregister).not.toHaveBeenCalled();
      expect(deps.markForced).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
    }
  });
});

describe('después de forzar la actualización', () => {
  it('avisa fijo que todavía no abre sin conexión mientras ningún service worker tome la app', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    try {
      const worker = fakeWorker({ controlled: false });
      refreshNotReady(worker.container);
      expect(isOfflineNotReady()).toBe(false);
      // Se forzó (la marca que deja `forceUpdate`) y la página abrió sin service worker.
      store.set('shotdocs-forced-update', '1');
      refreshNotReady(worker.container);
      expect(isOfflineNotReady()).toBe(true);
      // La versión nueva terminó de instalarse y tomó la app: el aviso se va y la marca también.
      worker.takeOver();
      refreshNotReady(worker.container);
      expect(isOfflineNotReady()).toBe(false);
      expect(store.has('shotdocs-forced-update')).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
