import { Component, createElement, lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { notify } from './notice';

// Partes de la app que se cargan aparte (roadmap B.4): el editor, el carrete y los diálogos. La primera
// pantalla (login, barra lateral, árbol) sale sin esperarlas. El service worker precachea también estos
// pedazos, así que sin red se abren igual desde la caché (ver Docs/Doc_Sincronizacion.md).
//
// Si un pedazo no se puede bajar es casi siempre porque se publicó una versión nueva: el service worker
// nuevo toma la pestaña abierta y borra los archivos de la versión vieja, que ya tampoco están en el
// servidor. Entonces se recarga una vez con un aviso, después de esperar a que lo escrito esté guardado en
// el dispositivo. Si no se puede recargar (sin red y sin service worker, o ya se recargó hace un momento),
// la parte muestra un aviso en su lugar y el resto de la app sigue andando.

/** Una parte que no se pudo bajar. Solo este error lo atrapa `PartBoundary`: los demás siguen de largo. */
export class PartLoadError extends Error {
  constructor(cause: unknown) {
    super(`A part of the app could not be loaded: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'PartLoadError';
  }
}

export const NEW_VERSION_NOTICE = 'A new version is available — reloading';

const RELOAD_KEY = 'shotdocs-part-reload';
/** Otra falla dentro de este tiempo después de recargar no vuelve a recargar (evita un bucle). */
const RELOAD_GUARD_MS = 60_000;
/** Lo que se muestra el aviso antes de recargar; también cubre un título a medio escribir (espera 300 ms). */
const NOTICE_MS = 1500;
/** Lo máximo que se espera a que lo escrito termine de guardarse; si no, pregunta el `beforeunload`. */
const SAVE_WAIT_MS = 8000;

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

function canReloadNow(): boolean {
  // Sin red y sin service worker, recargar dejaría la pantalla del navegador sin conexión en lugar de la app.
  const controlled = typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller;
  if (typeof navigator !== 'undefined' && navigator.onLine === false && !controlled) return false;
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < RELOAD_GUARD_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    return true;
  } catch {
    // Sin sessionStorage no hay cómo evitar un bucle de recargas: se deja el botón para hacerlo a mano.
    return false;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForSaved(): Promise<void> {
  const writes = pendingWrites;
  if (!writes) return;
  const deadline = Date.now() + SAVE_WAIT_MS;
  while (Date.now() < deadline) {
    await Promise.race([writes.flush().catch(() => undefined), sleep(500)]);
    if (!writes.unsaved()) return;
    await sleep(100);
  }
}

/**
 * Recarga la app una sola vez con un aviso. La promesa no termina nunca (la parte sigue mostrando su
 * esqueleto hasta que la página se recarga); si no se puede recargar, rechaza con `PartLoadError`.
 */
function reloadForNewVersion(cause: unknown): Promise<never> {
  if (reloading) return reloading;
  if (!canReloadNow()) return Promise.reject(new PartLoadError(cause));
  reloading = (async () => {
    notify(NEW_VERSION_NOTICE);
    await sleep(NOTICE_MS);
    await waitForSaved();
    pageReload.now();
    return new Promise<never>(() => undefined);
  })();
  return reloading;
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
  const Lazy = lazy(() =>
    start().then(
      (component) => ({ default: component }),
      (err: unknown) => reloadForNewVersion(err),
    ),
  );
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

/** El lugar de una parte que se carga aparte: el esqueleto mientras baja y un aviso si no se pudo. */
export function Part({ fallback = null, children }: { fallback?: ReactNode; children: ReactNode }) {
  return (
    <PartBoundary>
      <Suspense fallback={fallback}>{children}</Suspense>
    </PartBoundary>
  );
}

class PartBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    // Cualquier otro error sigue como antes de cargar aparte (esta caja solo explica lo que no bajó).
    if (!(error instanceof PartLoadError)) throw error;
    return (
      <div className="banner part-error" role="alert">
        <p>
          {navigator.onLine === false
            ? 'This part of the app is not on this device yet. Connect to the internet and reload.'
            : 'This part of the app could not be loaded. Reload to try again; nothing you wrote is lost.'}
        </p>
        <button className="link" onClick={() => pageReload.now()}>
          Reload
        </button>
      </div>
    );
  }
}
