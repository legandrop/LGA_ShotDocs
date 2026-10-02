import { t } from '../i18n';
import { hasDrafts } from './commentsUi';
import { hasUnsavedWork, pageReload, reloadByHand, reloadForNewVersion, waitForSaved } from './lazyPart';

// La versión nueva de la app cuando el workspace pide una más nueva (`min_app_version`; Docs/Doc_Sincronizacion.md,
// "Volver después de mucho tiempo sin red").
//
// El service worker (vite-plugin-pwa con `autoUpdate`: se activa apenas se instala y toma las pestañas abiertas) lo
// busca el navegador por su cuenta: al abrir o recargar la app y, a veces, un rato después de volver la red. La pestaña
// abierta sigue con el código viejo hasta recargar, y con la app vieja para el workspace no se sube nada. Por eso:
//
// - Desde que arranca la app (`watchNewVersionFromStart`, en main.tsx) se anota si una versión nueva tomó el control
//   de la pestaña, también antes de entrar a un workspace.
// - Cuando el workspace dice que esta versión es vieja, y al volver la red mientras lo sea, se le pide al navegador
//   que la busque ya (`registration.update()`).
// - Con la versión nueva al mando y esta vieja, se recarga sola, con las protecciones de siempre (`reloadForNewVersion`
//   en lazyPart.tsx: espera a que lo escrito esté guardado, nunca encima de un comentario sin mandar, nunca en bucle).
//   Si en ese momento hay algo sin guardar, se vuelve a intentar con cada cambio del estado de sincronización.
// - "Update now" busca la versión nueva y, si la encuentra, espera a que tome el control antes de recargar: recargar
//   antes vuelve a abrir la vieja desde la caché. Si la instalación empezó y falló (pasa a `redundant`: un teléfono sin
//   espacio, una red que corta la descarga; se sigue desde `updatefound`, también la que empieza el navegador solo),
//   explica qué hacer. Solo si el navegador nunca empezó a instalar nada y el servidor tiene otra versión, ofrece
//   forzarla.
//
// Con una versión que no es vieja no se recarga nada solo: eso sigue como siempre (lazyPart.tsx).

/** Lo que se usa de `navigator.serviceWorker`. */
export type WorkerContainer = Pick<ServiceWorkerContainer, 'controller' | 'getRegistration' | 'addEventListener' | 'removeEventListener'>;

/** Si una versión nueva tomó el control de esta pestaña desde que arrancó (la pestaña sigue con el código viejo). */
export class ControllerWatch {
  /** La pestaña ya tenía un service worker: un cambio de control es una versión nueva (no la primera instalación). */
  private controlled: boolean;
  replaced = false;
  private readonly listeners = new Set<() => void>();

  constructor(container: WorkerContainer | null) {
    this.controlled = !!container?.controller;
    container?.addEventListener('controllerchange', () => {
      // La primera instalación también toma la pestaña: es la misma versión que está corriendo.
      if (!this.controlled) {
        this.controlled = true;
        return;
      }
      this.replaced = true;
      for (const fn of [...this.listeners]) fn();
    });
  }

  onReplaced(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

function serviceWorkers(): WorkerContainer | null {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker : null;
}

let boot: ControllerWatch | null = null;

/** Se forzó la actualización (`forceUpdate`) y todavía no hay un service worker al mando de la app. */
const FORCED_KEY = 'shotdocs-forced-update';
let notReady = false;
const notReadyListeners = new Set<() => void>();

/** Después de forzar: mientras ningún service worker tome la app, sin red no abre (se avisa fijo). */
export function refreshNotReady(container: WorkerContainer | null): void {
  let forced = false;
  try {
    forced = !!localStorage.getItem(FORCED_KEY);
    if (forced && container?.controller) {
      localStorage.removeItem(FORCED_KEY);
      forced = false;
    }
  } catch {
    // Sin localStorage no se puede saber: no se avisa.
  }
  const value = forced && !container?.controller;
  if (value === notReady) return;
  notReady = value;
  for (const fn of [...notReadyListeners]) fn();
}

export function isOfflineNotReady(): boolean {
  return notReady;
}

export function subscribeOfflineNotReady(fn: () => void): () => void {
  notReadyListeners.add(fn);
  return () => notReadyListeners.delete(fn);
}

/** Desde el arranque de la app (main.tsx): así no se pierde un cambio de control antes de entrar a un workspace. */
export function watchNewVersionFromStart(): ControllerWatch {
  if (!boot) {
    const container = serviceWorkers();
    boot = new ControllerWatch(container);
    refreshNotReady(container);
    container?.addEventListener('controllerchange', () => refreshNotReady(container));
  }
  return boot;
}

/**
 * Lo que "Update now" no pudo arreglar: `force`, el navegador nunca empezó a instalar la versión nueva pero el servidor
 * tiene otra (se ofrece forzarla); `failed`, empezó y no pudo (poco espacio, una red que corta la descarga): forzar
 * dejaría el dispositivo sin ninguna versión para abrir sin red, así que solo se explica qué hacer.
 */
export type Stuck = 'none' | 'force' | 'failed';

export interface AppUpdateDeps {
  /** `navigator.serviceWorker`, o `null` sin service worker (sin HTTPS, un navegador sin soporte, las pruebas). */
  container: WorkerContainer | null;
  /** Quién anota los cambios de control (por defecto, el del arranque). */
  watch?: ControllerWatch;
  /** Recarga sola, con las protecciones (por defecto `reloadForNewVersion`). */
  reload?: (cause: unknown) => Promise<unknown>;
  /** La recarga del botón (por defecto `reloadByHand`: pregunta si hay un comentario sin mandar). */
  reloadByHand?: () => void;
  /** Hay algo sin guardar o un comentario sin mandar: no se intenta recargar sola (por defecto `hasUnsavedWork`). */
  unsaved?: () => boolean;
  /** El archivo principal de la versión publicada en el servidor (`null` si no se pudo leer). */
  published?: () => Promise<string | null>;
  /** El de la versión que está corriendo. */
  running?: () => string | null;
  /** Avisa si "Update now" no pudo traer la versión nueva: ofrecer forzarla, o explicar que no se pudo instalar. */
  onStuck?: (stuck: Stuck) => void;
  /** Para el aviso de volver la red (por defecto `window`). */
  events?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
  now?: () => number;
  /** Lo más que "Update now" espera a que la versión nueva tome el control. */
  waitMs?: number;
}

/** Dos búsquedas seguidas no se piden más seguido que esto (salvo la del botón). */
const CHECK_GAP_MS = 30_000;
/** Dos intentos de recargar sola, como mucho uno cada tanto (el estado de sincronización cambia seguido). */
const RETRY_GAP_MS = 5_000;
const WAIT_MS = 20_000;

/** El archivo principal (`/assets/index-<hash>.js`) de un `index.html`. */
export function mainScriptOf(html: string): string | null {
  return /\/assets\/(index-[\w-]+\.js)/.exec(html)?.[1] ?? null;
}

/**
 * Lee el `index.html` publicado, sin pasar por la caché del service worker (una dirección que no está precacheada). Si
 * el servidor redirige `/index.html` a `/` (los estáticos de Cloudflare pueden hacerlo), `fetch` sigue la redirección
 * y lee el mismo HTML.
 */
async function publishedScript(): Promise<string | null> {
  try {
    const res = await fetch(`/index.html?version-check=${Date.now()}`, { cache: 'no-store' });
    return res.ok ? mainScriptOf(await res.text()) : null;
  } catch {
    return null;
  }
}

function runningScript(): string | null {
  if (typeof document === 'undefined') return null;
  for (const s of Array.from(document.scripts)) {
    const name = mainScriptOf(s.src);
    if (name) return name;
  }
  return null;
}

/** El service worker que se está instalando. */
type InstallingWorker = Pick<ServiceWorker, 'state' | 'addEventListener' | 'removeEventListener'>;

/** Lo que se usa del registro del service worker para seguir sus instalaciones. */
type InstallsSource = Pick<ServiceWorkerRegistration, 'installing' | 'addEventListener' | 'removeEventListener'>;

/**
 * Las instalaciones de una versión nueva que empieza el registro (`updatefound`), sea por "Update now", por una búsqueda
 * de la app o del navegador por su cuenta: anota si la última pasó a `redundant` sin haber llegado a instalarse (poco
 * espacio, una red que corta el precache). Así "Update now" no confunde una instalación que falló antes de mirarla (ya
 * no está en `reg.installing`) con un navegador que nunca empezó a instalar nada, que es cuando se ofrece forzar.
 */
class InstallWatch {
  failed = false;
  private readonly sources = new Map<InstallsSource, () => void>();

  watch(reg: InstallsSource): void {
    if (this.sources.has(reg)) return;
    const onFound = () => {
      const worker = reg.installing;
      if (!worker) return;
      // Una instalación nueva: lo que pasó con la anterior ya no cuenta.
      this.failed = false;
      let installed = false;
      const onState = () => {
        if (worker.state === 'installed' || worker.state === 'activating' || worker.state === 'activated') installed = true;
        if (worker.state !== 'redundant') return;
        worker.removeEventListener('statechange', onState);
        // Una versión que llegó a instalarse y después reemplazó otra más nueva no es una falla.
        if (!installed) this.failed = true;
      };
      worker.addEventListener('statechange', onState);
      onState();
    };
    reg.addEventListener('updatefound', onFound);
    this.sources.set(reg, onFound);
  }

  stop(): void {
    for (const [reg, onFound] of this.sources) reg.removeEventListener('updatefound', onFound);
    this.sources.clear();
  }
}

export class AppUpdates {
  private outdated = false;
  private lastCheck = -Infinity;
  private lastTry = -Infinity;
  private trying = false;
  private readonly waiters = new Set<() => void>();
  private readonly now: () => number;
  private readonly watch: ControllerWatch;
  private readonly stopWatch: () => void;
  private readonly installs = new InstallWatch();
  private stopped = false;

  constructor(private readonly deps: AppUpdateDeps) {
    this.now = deps.now ?? Date.now;
    this.watch = deps.watch ?? new ControllerWatch(deps.container);
    this.stopWatch = this.watch.onReplaced(this.onReplaced);
    deps.events?.addEventListener('online', this.onOnline);
    // Desde ya: el navegador también busca e instala versiones nuevas por su cuenta.
    void deps.container
      ?.getRegistration()
      .then((reg) => {
        if (reg && !this.stopped) this.installs.watch(reg);
      })
      .catch(() => undefined);
  }

  stop(): void {
    this.stopped = true;
    this.installs.stop();
    this.stopWatch();
    this.deps.events?.removeEventListener('online', this.onOnline);
    for (const wake of this.waiters) wake();
  }

  /** Lo que dice el motor en cada cambio de estado (`status.outdated`). */
  setOutdated(outdated: boolean): void {
    const was = this.outdated;
    this.outdated = outdated;
    if (!outdated) {
      this.deps.onStuck?.('none');
      return;
    }
    if (this.watch.replaced) this.tryReload();
    else if (!was) void this.check();
  }

  /** El botón "Update now". */
  async updateNow(): Promise<void> {
    const byHand = this.deps.reloadByHand ?? reloadByHand;
    if (!this.watch.replaced && this.deps.container) {
      const reg = await this.check(true);
      const worker = reg?.installing ?? reg?.waiting ?? null;
      if (!this.watch.replaced && worker) {
        // Hay una versión nueva instalándose: se espera a que tome el control (con `autoUpdate`, enseguida) o a que la
        // instalación falle (pasa a `redundant`). Si falla, forzar no sirve: la causa sigue estando.
        const failed = await this.waitForChange(this.deps.waitMs ?? WAIT_MS, worker);
        if (failed && !this.watch.replaced) {
          this.deps.onStuck?.('failed');
          return;
        }
      } else if (!this.watch.replaced && this.installs.failed) {
        // La instalación empezó y falló antes de que se la mirara (o la había empezado el navegador): tampoco se ofrece
        // forzar.
        this.deps.onStuck?.('failed');
        return;
      } else if (!this.watch.replaced && this.outdated) {
        // El navegador no empezó a instalar nada. Si el servidor tiene otra versión, recargar abriría otra vez esta
        // desde la caché: se ofrece forzarla.
        const [published, running] = [await (this.deps.published ?? publishedScript)(), (this.deps.running ?? runningScript)()];
        if (published && running && published !== running) {
          this.deps.onStuck?.('force');
          return;
        }
      }
    }
    byHand();
  }

  private onReplaced = (): void => {
    for (const wake of this.waiters) wake();
    this.waiters.clear();
    if (this.outdated) {
      this.lastTry = -Infinity;
      this.tryReload();
    }
  };

  private onOnline = (): void => {
    if (this.outdated && !this.watch.replaced) void this.check(true);
  };

  /** Recarga sola si se puede; si hay algo sin guardar, no avisa nada y se vuelve a probar más tarde. */
  private tryReload(): void {
    if (this.trying || this.now() - this.lastTry < RETRY_GAP_MS) return;
    if ((this.deps.unsaved ?? hasUnsavedWork)()) return;
    this.lastTry = this.now();
    this.trying = true;
    void (this.deps.reload ?? reloadForNewVersion)(new Error('app_outdated'))
      .catch(() => undefined)
      .finally(() => {
        this.trying = false;
      });
  }

  /** Le pide al navegador que busque la versión nueva. Nunca tira. */
  private async check(force = false): Promise<ServiceWorkerRegistration | undefined> {
    const container = this.deps.container;
    if (!container) return undefined;
    if (!force && this.now() - this.lastCheck < CHECK_GAP_MS) return undefined;
    this.lastCheck = this.now();
    try {
      const reg = await container.getRegistration();
      // Antes de buscar: si la instalación que empieza falla enseguida, igual queda anotada.
      if (reg && !this.stopped) this.installs.watch(reg);
      await reg?.update();
      return reg;
    } catch {
      // Sin red o el servidor no contestó: se vuelve a probar al volver la red o con el botón.
      return undefined;
    }
  }

  /** Espera a que la versión nueva tome el control. Devuelve `true` si su instalación falló (`redundant`). */
  private waitForChange(ms: number, worker: InstallingWorker | null = null): Promise<boolean> {
    return new Promise((resolve) => {
      const finish = (failed: boolean) => {
        clearTimeout(timer);
        this.waiters.delete(wake);
        worker?.removeEventListener('statechange', onState);
        resolve(failed);
      };
      const wake = () => finish(false);
      const onState = () => {
        if (worker?.state === 'redundant') finish(true);
      };
      const timer = setTimeout(wake, ms);
      this.waiters.add(wake);
      worker?.addEventListener('statechange', onState);
      onState();
    });
  }
}

// --- Forzar la actualización ----------------------------------------------------------------------------------------

export interface ForceDeps {
  container: WorkerContainer | null;
  online: () => boolean;
  published: () => Promise<string | null>;
  saved: () => Promise<boolean>;
  confirmDrafts: () => boolean;
  /** Lo libre en el almacenamiento del navegador (`quota - usage`), o `null` si no lo dice. */
  freeBytes: () => Promise<number | null>;
  /** Anota que se forzó (para el aviso de "todavía no abre sin red"). */
  markForced: () => void;
  reload: () => void;
}

export type ForceResult = 'reloaded' | 'noWorker' | 'offline' | 'unsaved' | 'drafts' | 'noSpace' | 'noServer';

/**
 * Lo que tiene que haber libre para forzar: el doble de lo que el service worker guarda al instalarse (el precache, hoy
 * unos 3,6 MB según el build: "precache 65 entries (3564 KiB)"; se cuenta con 5 MB). Con menos, la versión nueva no se
 * instalaría y el dispositivo quedaría sin ninguna para abrir sin red.
 */
export const FORCE_FREE_BYTES = 2 * 5 * 1024 * 1024;

/**
 * Saca el service worker y recarga desde el servidor: la versión nueva se instala de nuevo al abrir. Lo guardado en el
 * dispositivo (IndexedDB) no se toca. Solo con red: justo antes se lee la versión publicada, y si no contesta no se
 * hace nada (sin service worker y sin red, la app no abriría). Devuelve si recargó.
 */
export async function forceUpdate(deps: ForceDeps = defaultForceDeps()): Promise<ForceResult> {
  if (!deps.container) return 'noWorker';
  if (!deps.online()) return 'offline';
  if (!(await deps.saved())) return 'unsaved';
  if (!deps.confirmDrafts()) return 'drafts';
  // Sin lugar para instalar la versión nueva (o sin saberlo), no se saca la que hay.
  const free = await deps.freeBytes().catch(() => null);
  if (free === null || free < FORCE_FREE_BYTES) return 'noSpace';
  if (!(await deps.published())) return 'noServer';
  const reg = await deps.container.getRegistration().catch(() => undefined);
  deps.markForced();
  if (reg) await reg.unregister().catch(() => false);
  deps.reload();
  return 'reloaded';
}

function defaultForceDeps(): ForceDeps {
  return {
    container: serviceWorkers(),
    online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    published: publishedScript,
    saved: waitForSaved,
    confirmDrafts: () => !hasDrafts() || window.confirm(t('lazy.draftQuestion')),
    freeBytes: async () => {
      const estimate = await navigator.storage?.estimate?.();
      return estimate?.quota != null && estimate.usage != null ? estimate.quota - estimate.usage : null;
    },
    markForced: () => {
      try {
        localStorage.setItem(FORCED_KEY, String(Date.now()));
      } catch {
        // Sin localStorage no habrá aviso; forzar sigue igual.
      }
    },
    reload: () => pageReload.now(),
  };
}

// --- La app abierta en un workspace ---------------------------------------------------------------------------------

let current: AppUpdates | null = null;
let stuck: Stuck = 'none';
const stuckListeners = new Set<() => void>();

export function setStuck(value: Stuck): void {
  if (stuck === value) return;
  stuck = value;
  for (const fn of [...stuckListeners]) fn();
}

/** Lo que "Update now" no pudo arreglar (ver `Stuck`): el estado ofrece forzar o explica qué hacer. */
export function isUpdateStuck(): Stuck {
  return stuck;
}

export function subscribeUpdateStuck(fn: () => void): () => void {
  stuckListeners.add(fn);
  return () => stuckListeners.delete(fn);
}

/** Arranca con la app abierta en un workspace (Workspace.tsx). */
export function startAppUpdates(): AppUpdates {
  current?.stop();
  current = new AppUpdates({
    container: serviceWorkers(),
    watch: watchNewVersionFromStart(),
    onStuck: setStuck,
    events: typeof window !== 'undefined' ? window : null,
  });
  return current;
}

export function stopAppUpdates(updates: AppUpdates): void {
  updates.stop();
  if (current === updates) {
    current = null;
    setStuck('none');
  }
}

/** "Update now" del estado de sincronización. Sin la app abierta en un workspace, recarga directo. */
export function updateNow(): Promise<void> {
  if (current) return current.updateNow();
  pageReload.now();
  return Promise.resolve();
}
