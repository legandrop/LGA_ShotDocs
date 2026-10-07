import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { t, useT } from '../i18n';
import { usePermissions, useServices, useSyncStatus, type Services } from '../services';
import { importJobFor } from '../import/importJob';
import { canSeeHistory, markRestorePending, openHistory, registerRestoreTarget } from './historyUi';
import { useLeftDrafts } from './commentsUi';
import { LeftDrafts } from './LeftDrafts';
import { reloadByHand, watchPendingWrites } from './lazyPart';
import { replaceRunning } from './replaceUi';
import { usePendingCount } from './usePendingCount';

// Las barreras de error (Docs/Doc_Sincronizacion.md, «Barreras de error»). Un error al dibujar (una página con una
// forma que nadie previó, un bug) ya no deja la app en blanco:
//
// - `PageBarrier`, alrededor del editor de la página: falla solo la página; el árbol, la barra y el resto siguen.
//   Quien puede ver el historial tiene *Version history* a mano y restaura sin abrir la página en el editor.
// - `WorkspaceBarrier`, alrededor de la app de un workspace: los servicios (la base del dispositivo y la
//   sincronización) quedan vivos arriba, así lo pendiente sigue subiendo y la pantalla dice cuánto falta.
// - `AppBarrier`, en la raíz (main.tsx), para lo que pase fuera de un workspace.
//
// Ninguna vuelve a montar sola lo que acaba de tirar (nada de bucles): solo con *Try again*, al restaurar una versión
// o al cambiar de página. Ninguna borra ni vacía nada: lo guardado en el dispositivo y las colas quedan como están.

interface BarrierProps {
  /** Al cambiar, la barrera se reinicia (otra página, otra versión del historial). */
  resetKey?: string;
  /** Qué se rompió, para la consola (con el id de la página si hay). */
  what: string;
  /** Lo que va en lugar de lo que tiró. `retry` lo vuelve a montar (solo con una acción de la persona). */
  fallback: (retry: () => void) => ReactNode;
  children: ReactNode;
}

interface BarrierState {
  failed: boolean;
  key: string | undefined;
}

/** Atrapa lo que tira su contenido al dibujarse y muestra `fallback` en su lugar, sin reintentar solo. */
export class ErrorBarrier extends Component<BarrierProps, BarrierState> {
  state: BarrierState = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError(): Partial<BarrierState> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: BarrierProps, state: BarrierState): Partial<BarrierState> | null {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`[barrera] ${this.props.what}. Se muestra el aviso y no se vuelve a intentar solo.`, error, info.componentStack ?? '');
  }

  retry = () => this.setState({ failed: false });

  render() {
    return this.state.failed ? this.props.fallback(this.retry) : this.props.children;
  }
}

// --- La página -------------------------------------------------------------------------------------------------------

/** La barrera del editor de una página. Se reinicia al cambiar de página. */
export function PageBarrier({ pageId, children }: { pageId: string; children: ReactNode }) {
  return (
    <ErrorBarrier
      resetKey={pageId}
      what={`La página ${pageId} no se pudo mostrar`}
      fallback={(retry) => <PageCrash pageId={pageId} retry={retry} />}
    >
      {children}
    </ErrorBarrier>
  );
}

function PageCrash({ pageId, retry }: { pageId: string; retry: () => void }) {
  const tr = useT();
  const { docs } = useServices();
  const perms = usePermissions();
  const status = useSyncStatus();
  // El historial, para quien lo puede ver (canSeeHistory): un visitante con link, un invitado o quien solo ve, no.
  const history = canSeeHistory(perms, pageId, status.schemaVersion);

  // Restaurar sin el editor (que es justo lo que no anda): mientras se ve el aviso, el historial restaura sobre el
  // documento de la página (historyRestore.ts, `restoreInDoc`). Restaurada, se vuelve a montar el editor.
  useEffect(() => {
    if (!history) return;
    let cancelled = false;
    let opened = false;
    let off = () => undefined as void;
    // Mientras se prepara (bajar la parte y abrir el documento), *Restore* del historial espera (historyUi.ts).
    const ready = import('./historyRestore')
      .then(async ({ restoreInDoc }) => {
        if (cancelled) return;
        const doc = await docs.open(pageId);
        // Se cambió de página mientras se abría: se cierra acá (la limpieza ya pasó sin nada que cerrar).
        if (cancelled) return docs.close(pageId);
        opened = true;
        off = registerRestoreTarget(pageId, (version, schema) => {
          const outcome = restoreInDoc(doc, version, schema ?? null);
          if (outcome.ok) retry();
          return outcome;
        });
      })
      .catch((err: unknown) => console.warn(`[barrera] No se pudo preparar la restauración de la página ${pageId}.`, err));
    const offPending = markRestorePending(pageId, ready);
    return () => {
      cancelled = true;
      offPending();
      off();
      if (opened) docs.close(pageId);
    };
  }, [history, docs, pageId, retry]);

  return (
    <div className="banner page-crash" role="alert">
      <p>
        <strong>{tr('page.crash.title')}</strong> {tr(history ? 'page.crash.textHistory' : 'page.crash.text')}
      </p>
      <div className="page-crash-actions">
        {history && (
          <button className="link" onClick={() => openHistory(pageId)}>
            {tr('pageMenu.history')}
          </button>
        )}
        <button className="link" onClick={retry}>
          {tr('common.tryAgain')}
        </button>
      </div>
    </div>
  );
}

// --- La app ----------------------------------------------------------------------------------------------------------

/**
 * Lo que se perdería o quedaría a medias al cerrar: lo mismo que mira el `beforeunload` de la app (Workspace.tsx). La
 * importación y el reemplazo en el proyecto corren fuera de React: siguen aunque la app se haya caído.
 */
function unsavedLocal(s: Services): boolean {
  return (
    s.docs.hasUnsavedEdits() ||
    s.tree.hasUnsavedWrites() ||
    s.media.hasUnsavedWrites() ||
    s.comments.hasUnsavedWrites() ||
    !!s.folders?.busy() ||
    importJobFor(s.tree).get().running ||
    replaceRunning({ docs: s.docs })
  );
}

/** La barrera de la app de un workspace: los servicios quedan arriba, vivos (lo pendiente sigue subiendo). */
export function WorkspaceBarrier({ children }: { children: ReactNode }) {
  return (
    <ErrorBarrier what="La app del workspace no se pudo mostrar" fallback={() => <WorkspaceCrash />}>
      {children}
    </ErrorBarrier>
  );
}

function WorkspaceCrash() {
  const services = useServices();
  const pending = usePendingCount();
  // La app de adentro (con su `beforeunload`) ya no está: el aviso del navegador antes de cerrar o recargar con algo
  // sin guardar queda a cargo de esta pantalla, y la recarga por una versión nueva lo espera igual (lazyPart.tsx).
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!unsavedLocal(services)) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    const unwatch = watchPendingWrites({ unsaved: () => unsavedLocal(services), flush: () => services.docs.flush() });
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      unwatch();
    };
  }, [services]);
  return <CrashScreen pending={pending} />;
}

/**
 * La barrera de la raíz (main.tsx): para lo que pase fuera de un workspace (entrar, la bienvenida, un link). Arriba va
 * el cartel de lo que quedó de un comentario a medio escribir (LeftDrafts.tsx): está afuera de todo lo que se reemplaza
 * (la app de un workspace, sus pantallas de «sacaron a la persona» y «sin proyectos», la de un error, el login), y con
 * su propia barrera, para que un error suyo no se lleve la app ni uno de la app se lo lleve a él.
 */
export function AppBarrier({ children }: { children: ReactNode }) {
  return (
    <>
      <ErrorBarrier
        what="El cartel de un comentario sin mandar no se pudo mostrar"
        fallback={() => (
          // Si el respaldo también fallara, nada: la pregunta al cerrar la ventana sigue (commentsUi.ts).
          <ErrorBarrier what="El respaldo del cartel no se pudo mostrar" fallback={() => null}>
            <LeftDraftsPlain />
          </ErrorBarrier>
        )}
      >
        <LeftDrafts />
      </ErrorBarrier>
      <ErrorBarrier what="La app no se pudo mostrar" fallback={() => <CrashScreen pending={null} />}>
        {children}
      </ErrorBarrier>
    </>
  );
}

/**
 * El respaldo del cartel, si el cartel mismo falló: solo el título y los textos, sin botones ni nada más que pueda volver
 * a fallar, para seleccionarlos y copiarlos a mano.
 */
function LeftDraftsPlain() {
  const { texts } = useLeftDrafts();
  if (!texts.length) return null;
  return (
    <section className="left-drafts" role="alert">
      <p>
        <strong>{t('comments.left.title', { count: texts.length })}</strong>
      </p>
      <div className="left-drafts-texts">
        {texts.map((text, i) => (
          <p key={i} className="left-draft">
            {text}
          </p>
        ))}
      </div>
    </section>
  );
}

/** `pending`: lo que falta subir, si se sabe (con los servicios vivos); `null`, no se dice nada. */
function CrashScreen({ pending }: { pending: number | null }) {
  const tr = useT();
  return (
    <main className="center-screen app-crash" role="alert">
      <div className="card">
        <h1>{tr('shell.crash.title')}</h1>
        <p className="muted">{tr('shell.crash.text')}</p>
        {pending !== null && pending > 0 && (
          <p className="muted app-crash-pending">{tr('shell.crash.pending', { changes: tr('sync.changes', { count: pending }) })}</p>
        )}
        <button className="primary" onClick={reloadByHand}>
          {tr('shell.lost.reload')}
        </button>
      </div>
    </main>
  );
}
