import { Component, createElement, lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { hasDrafts } from './commentsUi';
import { notify } from './notice';

// Partes de la app que se cargan aparte (roadmap B.4): el editor, el carrete y los diálogos. La primera
// pantalla (login, barra lateral, árbol) sale sin esperarlas. El service worker precachea también estos
// pedazos, así que sin red se abren igual desde la caché (ver Docs/Doc_Sincronizacion.md).
//
// Si un pedazo no se puede bajar es casi siempre porque se publicó una versión nueva: el service worker
// nuevo toma la pestaña abierta y borra los archivos de la versión vieja, que ya tampoco están en el
// servidor. Entonces se recarga una vez con un aviso, después de esperar a que lo escrito esté guardado en
// el dispositivo. No se recarga sola si queda algo sin guardar (o un comentario escrito sin mandar), si no
// hay red ni service worker, o si ya se recargó hace un momento: la parte muestra un aviso con "Reload" en
// su lugar y el resto de la app sigue andando. Volver a abrirla (o que vuelva la red) lo intenta de nuevo.

type FailReason = 'failed' | 'unsaved';

/** Una parte que no se pudo bajar. Solo este error lo atrapa `PartBoundary`: los demás siguen de largo. */
export class PartLoadError extends Error {
  /** `unsaved`: había una versión nueva pero quedaba algo sin guardar, así que no se recargó sola. */
  readonly reason: FailReason;
  constructor(cause: unknown, reason: FailReason = 'failed') {
    super(`A part of the app could not be loaded: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'PartLoadError';
    this.reason = reason;
  }
}

export const NEW_VERSION_NOTICE = 'A new version is available — reloading';

const RELOAD_KEY = 'shotdocs-part-reload';
/** Otra falla dentro de este tiempo después de recargar no vuelve a recargar (evita un bucle). */
const RELOAD_GUARD_MS = 60_000;

/** Los tiempos de la recarga (aparte para que las pruebas no esperen de verdad). */
export const reloadTimings = {
  /** Lo que se muestra el aviso antes de recargar; también cubre un título a medio escribir (300 ms). */
  noticeMs: 1500,
  /** Lo máximo que se espera a que lo escrito termine de guardarse; si no, no se recarga sola. */
  saveWaitMs: 8000,
  /** Si la página no se va en este tiempo, la persona eligió quedarse en el aviso del navegador. */
  pagehideMs: 2000,
};

interface PendingWrites {
  /** Hay algo que todavía no llegó a IndexedDB. */
  unsaved: () => boolean;
  /** Espera las escrituras en curso. */
  flush: () => Promise<void>;
}

let pendingWrites: PendingWrites | null = null;

/** La app abierta avisa cómo saber si hay algo sin guardar (lo mismo que mira su `beforeunload`). */
export function watchPendingWrites(writes: PendingWrites): () => void {
  pendingWrites = writes;
  return () => {
    if (pendingWrites === writes) pendingWrites = null;
  };
}

let reloading: Promise<never> | null = null;

/** Recargar la página (aparte para las pruebas: jsdom no deja reemplazar `location.reload`). */
export const pageReload = { now: (): void => location.reload() };

const DRAFT_QUESTION = 'A comment you wrote has not been sent. Reload anyway and lose it?';

/** El botón "Reload" de los avisos: un comentario sin mandar se pierde, así que pregunta antes. */
function reloadByHand(): void {
  if (hasDrafts() && !window.confirm(DRAFT_QUESTION)) return;
  pageReload.now();
}

function canReloadNow(): boolean {
  // Sin red y sin service worker, recargar dejaría la pantalla del navegador sin conexión en lugar de la app.
  const controlled = typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller;
  if (typeof navigator !== 'undefined' && navigator.onLine === false && !controlled) return false;
  try {
    return Date.now() - Number(sessionStorage.getItem(RELOAD_KEY) ?? 0) >= RELOAD_GUARD_MS;
  } catch {
    // Sin sessionStorage no hay cómo evitar un bucle de recargas: se deja el botón para hacerlo a mano.
    return false;
  }
}

function markReload(): void {
  try {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // canReloadNow ya lo leyó; si ahora no se puede escribir, la próxima falla no recarga.
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Espera a que lo escrito llegue al dispositivo. Devuelve si quedó todo guardado. */
async function waitForSaved(): Promise<boolean> {
  const writes = pendingWrites;
  if (!writes) return true;
  const deadline = Date.now() + reloadTimings.saveWaitMs;
  for (;;) {
    await Promise.race([writes.flush().catch(() => undefined), sleep(500)]);
    if (!writes.unsaved()) return true;
    if (Date.now() >= deadline) return false;
    await sleep(100);
  }
}

/** Se resuelve con `true` si la página se va (`pagehide`) antes de `ms`. */
function leavesWithin(ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const onHide = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      window.removeEventListener('pagehide', onHide);
      resolve(false);
    }, ms);
    window.addEventListener('pagehide', onHide, { once: true });
  });
}

/**
 * Recarga la app una sola vez con un aviso. Mientras la página se va, la promesa no termina (la parte
 * sigue con su esqueleto). Si no se puede recargar, si queda algo sin guardar o si la persona se queda en
 * el aviso del navegador, rechaza con `PartLoadError` y la parte muestra el aviso con "Reload".
 */
export function reloadForNewVersion(cause: unknown): Promise<never> {
  if (reloading) return reloading;
  if (!canReloadNow()) return Promise.reject(new PartLoadError(cause));
  // Un comentario escrito sin mandar no está en ningún lado: nunca se recarga solo encima de él.
  if (hasDrafts()) return Promise.reject(new PartLoadError(cause, 'unsaved'));
  const run = (async (): Promise<never> => {
    try {
      notify(NEW_VERSION_NOTICE);
      await sleep(reloadTimings.noticeMs);
      if (!(await waitForSaved()) || hasDrafts()) throw new PartLoadError(cause, 'unsaved');
      markReload();
      const leaving = leavesWithin(reloadTimings.pagehideMs);
      pageReload.now();
      if (await leaving) return await new Promise<never>(() => undefined);
      throw new PartLoadError(cause);
    } catch (err) {
      reloading = null;
      throw err instanceof PartLoadError ? err : new PartLoadError(err);
    }
  })();
  reloading = run;
  return run;
}

/**
 * Vite avisa con `vite:preloadError` cuando no puede bajar un archivo que necesita un `import()` (también
 * los de adentro del editor). Se trata igual: recargar una vez, con las mismas protecciones. El error sigue
 * su camino (la parte que lo pidió muestra su aviso si no se recarga).
 */
export function listenForMissingFiles(): () => void {
  const onPreloadError = (e: Event) => {
    void reloadForNewVersion((e as Event & { payload?: unknown }).payload ?? e).catch(() => undefined);
  };
  window.addEventListener('vite:preloadError', onPreloadError);
  return () => window.removeEventListener('vite:preloadError', onPreloadError);
}

/** Las partes que fallaron, para volver a intentar (ver `PartBoundary`). */
const failedParts = new Set<() => void>();

/** Las partes que no bajaron se vuelven a intentar la próxima vez que se muestren. */
function retryFailedParts(): void {
  for (const reset of [...failedParts]) reset();
  failedParts.clear();
}

export type LazyPart<P> = ComponentType<P> & {
  /** Empieza a bajarla sin mostrarla (sin avisos si falla: se vuelve a intentar al mostrarla). */
  preload: () => void;
};

/**
 * Un componente que se baja la primera vez que se muestra (o antes, con `preload`). Una vez bajado se
 * dibuja directo, sin pasar por `Suspense`. Va adentro de `<Part>`, que pone el esqueleto y el aviso.
 */
export function lazyPart<P extends object>(load: () => Promise<ComponentType<P>>): LazyPart<P> {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  const start = () => {
    pending ??= load().then(
      (component) => (loaded = component),
      (err: unknown) => {
        pending = null;
        throw err;
      },
    );
    return pending;
  };
  // `lazy` guarda el error para siempre: para reintentar se arma uno nuevo. Se cambia solo desde
  // `retryFailedParts`, que corre al confirmar (nunca mientras React dibuja, que puede repetir un dibujo).
  const makeLazy = () =>
    lazy(async () => {
      try {
        return { default: await start() };
      } catch (err) {
        try {
          return await reloadForNewVersion(err);
        } catch (failure) {
          failedParts.add(() => (Lazy = makeLazy()));
          throw failure;
        }
      }
    });
  let Lazy = makeLazy();
  function Loaded(props: P) {
    return loaded ? createElement(loaded, props) : createElement(Lazy as unknown as ComponentType<P>, props);
  }
  Loaded.preload = () => void start().catch(() => undefined);
  return Loaded;
}

/** Cuando el navegador está libre, empieza a bajar estas partes (así ya están listas al abrir una página). */
export function preloadWhenIdle(...parts: { preload: () => void }[]): () => void {
  const run = () => parts.forEach((p) => p.preload());
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(run, { timeout: 3000 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(run, 1500);
  return () => clearTimeout(id);
}

interface PartProps {
  /** Lo que se ve mientras baja. */
  fallback?: ReactNode;
  /**
   * Para un diálogo o algo que se abre encima (el carrete): el aviso sale como diálogo, con "Close" y
   * "Reload". Sin esto, el aviso ocupa el lugar de la parte (el cuerpo de la página, por ejemplo).
   */
  onClose?: () => void;
  children: ReactNode;
}

/** El lugar de una parte que se carga aparte: el esqueleto mientras baja y un aviso si no se pudo. */
export function Part({ fallback = null, onClose, children }: PartProps) {
  return (
    <PartBoundary onClose={onClose}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </PartBoundary>
  );
}

function failureText(error: PartLoadError): string {
  if (error.reason === 'unsaved') {
    return 'A new version of the app is available. It did not reload by itself because something you wrote is not saved yet (or a comment is not sent). Finish it, then reload.';
  }
  if (navigator.onLine === false) {
    return 'This part of the app is not on this device yet. Connect to the internet: it tries again by itself.';
  }
  return 'This part of the app could not be loaded. Reload to try again.';
}

class PartBoundary extends Component<{ onClose?: () => void; children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidMount() {
    window.addEventListener('online', this.retry);
  }

  componentWillUnmount() {
    window.removeEventListener('online', this.retry);
    // Cerrar el aviso y volver a abrir la parte lo intenta de nuevo.
    if (this.state.error instanceof PartLoadError) retryFailedParts();
  }

  /** Volvió la red: la parte que no bajó se intenta de nuevo. */
  retry = () => {
    if (!(this.state.error instanceof PartLoadError)) return;
    retryFailedParts();
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    // Cualquier otro error sigue como antes de cargar aparte (esta caja solo explica lo que no bajó).
    if (!(error instanceof PartLoadError)) throw error;
    const { onClose } = this.props;
    if (onClose) {
      return (
        <div className="modal-backdrop" onClick={onClose}>
          <div
            className="modal part-error-dialog"
            role="alertdialog"
            aria-label="Could not open"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Could not open this</h2>
            <p>{failureText(error)}</p>
            <div className="modal-actions">
              <button onClick={onClose}>Close</button>
              <button className="primary" onClick={reloadByHand}>
                Reload
              </button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="banner part-error" role="alert">
        <p>{failureText(error)}</p>
        <button className="link" onClick={reloadByHand}>
          Reload
        </button>
      </div>
    );
  }
}
