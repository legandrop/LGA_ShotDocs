import { pageReload, reloadByHand, reloadForNewVersion } from './lazyPart';

// La versión nueva de la app cuando el workspace pide una más nueva (`min_app_version`; Docs/Doc_Sincronizacion.md,
// "Volver después de mucho tiempo sin red").
//
// El service worker (vite-plugin-pwa con `autoUpdate`: se activa apenas se instala y toma las pestañas abiertas) lo
// busca el navegador por su cuenta: al abrir o recargar la app y, a veces, un rato después de volver la red. La pestaña
// abierta sigue con el código viejo hasta recargar, y con la app vieja para el workspace no se sube nada. Por eso:
//
// - Cuando el workspace dice que esta versión es vieja, y al volver la red mientras lo sea, se le pide al navegador
//   que la busque ya (`registration.update()`).
// - Cuando la versión nueva toma el control y esta es vieja (o esta se entera de que es vieja y la nueva ya lo había
//   tomado), se recarga una vez, con las protecciones de siempre (`reloadForNewVersion` en lazyPart.tsx: espera a que
//   lo escrito esté guardado, no recarga encima de un comentario sin mandar ni en bucle). Si no puede, queda el aviso
//   con "Update now".
// - "Update now" busca la versión nueva y, si la encuentra, espera a que tome el control antes de recargar: recargar
//   antes vuelve a abrir la vieja desde la caché.
//
// Con una versión que no es vieja no se recarga nada solo: eso sigue como siempre (lazyPart.tsx).

/** Lo que se usa de `navigator.serviceWorker`. */
export type WorkerContainer = Pick<ServiceWorkerContainer, 'controller' | 'getRegistration' | 'addEventListener' | 'removeEventListener'>;

export interface AppUpdateDeps {
  /** `navigator.serviceWorker`, o `null` sin service worker (sin HTTPS, un navegador sin soporte, las pruebas). */
  container: WorkerContainer | null;
  /** Recarga sola, con las protecciones (por defecto `reloadForNewVersion`). */
  reload?: (cause: unknown) => Promise<unknown>;
  /** La recarga del botón (por defecto `reloadByHand`: pregunta si hay un comentario sin mandar). */
  reloadByHand?: () => void;
  /** Para el aviso de volver la red (por defecto `window`). */
  events?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
  now?: () => number;
  /** Lo más que "Update now" espera a que la versión nueva tome el control. */
  waitMs?: number;
}

/** Dos búsquedas seguidas no se piden más seguido que esto (salvo la del botón). */
const CHECK_GAP_MS = 30_000;
const WAIT_MS = 20_000;

export class AppUpdates {
  private outdated = false;
  /** La pestaña ya tenía un service worker: un cambio de control es una versión nueva (no la primera instalación). */
  private controlled: boolean;
  /** Una versión nueva tomó el control de esta pestaña, que sigue con el código viejo. */
  private replaced = false;
  private lastCheck = -Infinity;
  private readonly waiters = new Set<() => void>();
  private readonly now: () => number;

  constructor(private readonly deps: AppUpdateDeps) {
    this.now = deps.now ?? Date.now;
    this.controlled = !!deps.container?.controller;
    deps.container?.addEventListener('controllerchange', this.onControllerChange);
    deps.events?.addEventListener('online', this.onOnline);
  }

  stop(): void {
    this.deps.container?.removeEventListener('controllerchange', this.onControllerChange);
    this.deps.events?.removeEventListener('online', this.onOnline);
    for (const wake of this.waiters) wake();
  }

  /** Lo que dice el motor en cada cambio de estado (`status.outdated`). */
  setOutdated(outdated: boolean): void {
    const was = this.outdated;
    this.outdated = outdated;
    if (!outdated || was) return;
    if (this.replaced) void this.reloadSafely();
    else void this.check();
  }

  /** El botón "Update now". */
  async updateNow(): Promise<void> {
    const byHand = this.deps.reloadByHand ?? reloadByHand;
    if (!this.replaced && this.deps.container) {
      const reg = await this.check(true);
      // Hay una versión nueva instalándose: se espera a que tome el control (con `autoUpdate`, enseguida).
      if (!this.replaced && (reg?.installing || reg?.waiting)) await this.waitForChange(this.deps.waitMs ?? WAIT_MS);
    }
    byHand();
  }

  private onControllerChange = (): void => {
    // La primera instalación también toma la pestaña: es la misma versión que está corriendo.
    if (!this.controlled) {
      this.controlled = true;
      return;
    }
    this.replaced = true;
    for (const wake of this.waiters) wake();
    this.waiters.clear();
    if (this.outdated) void this.reloadSafely();
  };

  private onOnline = (): void => {
    if (this.outdated) void this.check(true);
  };

  /** Le pide al navegador que busque la versión nueva. Nunca tira. */
  private async check(force = false): Promise<ServiceWorkerRegistration | undefined> {
    const container = this.deps.container;
    if (!container) return undefined;
    if (!force && this.now() - this.lastCheck < CHECK_GAP_MS) return undefined;
    this.lastCheck = this.now();
    try {
      const reg = await container.getRegistration();
      await reg?.update();
      return reg;
    } catch {
      // Sin red o el servidor no contestó: se vuelve a probar al volver la red o con el botón.
      return undefined;
    }
  }

  private waitForChange(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        this.waiters.delete(wake);
        resolve();
      };
      const timer = setTimeout(wake, ms);
      this.waiters.add(wake);
    });
  }

  private async reloadSafely(): Promise<void> {
    await (this.deps.reload ?? reloadForNewVersion)(new Error('app_outdated')).catch(() => undefined);
  }
}

let current: AppUpdates | null = null;

/** Arranca con la app abierta en un workspace (Workspace.tsx). Devuelve cómo pararlo. */
export function startAppUpdates(): AppUpdates {
  current?.stop();
  current = new AppUpdates({
    container: typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker : null,
    events: typeof window !== 'undefined' ? window : null,
  });
  return current;
}

export function stopAppUpdates(updates: AppUpdates): void {
  updates.stop();
  if (current === updates) current = null;
}

/** "Update now" del estado de sincronización. Sin la app abierta en un workspace, recarga directo. */
export function updateNow(): Promise<void> {
  if (current) return current.updateNow();
  pageReload.now();
  return Promise.resolve();
}
