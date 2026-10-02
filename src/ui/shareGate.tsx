import { useCallback, useState } from 'react';
import { useT } from '../i18n';
import '../i18n/lazy/teamDialogs';
import { useServices, useSyncStatus, useTree } from '../services';

// Lo de la privacidad de lo borrado en las ventanas de compartir e invitar (Docs/Doc_Privacidad_Borrado.md, 4.2 y 6):
// la línea que dice qué le llega a quien no ve lo borrado (Ver, Comentar, invitados), subir antes lo pendiente de las
// páginas alcanzadas (con su aviso Retry / Share anyway) y, después, armar enseguida sus bases con progreso.

/** Lo que tira el paso previo cuando no se pudo subir lo pendiente (la ventana muestra el aviso, no un error). */
export const UNSYNCED_BEFORE_SHARE = new Error('unsynced_before_share');

export type ShareScope = { projectId: string } | { pageId: string };

export function useShareGate() {
  const { engine } = useServices();
  const status = useSyncStatus();
  const tree = useTree();
  const [blocked, setBlocked] = useState<null | { retry: () => void; anyway: () => void }>(null);
  const [progress, setProgress] = useState<null | { done: number; total: number; email: string }>(null);

  /** Las páginas que alcanza compartir: la página y su rama, o todo el proyecto. */
  const pagesOf = useCallback(
    (scope: ShareScope): string[] =>
      'pageId' in scope ? engine.branchOf(scope.pageId) : tree.roots(scope.projectId).flatMap((r) => engine.branchOf(r.id)),
    [engine, tree],
  );

  /**
   * Antes de compartir con alguien que no ve lo borrado: sube lo pendiente de esas páginas. Devuelve si se puede
   * compartir; si no, deja el aviso con Retry y Share anyway. Con el interruptor apagado, o para quien ve lo borrado,
   * no hace falta.
   */
  const ready = useCallback(
    async (scope: ShareScope, reader: boolean, retry: () => void, anyway: () => void): Promise<boolean> => {
      setBlocked(null);
      if (!reader || !status.cleanOn) return true;
      if (await engine.uploadPagesFirst(pagesOf(scope))) return true;
      setBlocked({ retry, anyway });
      return false;
    },
    [engine, pagesOf, status.cleanOn],
  );

  /** Después de compartir: arma enseguida las bases de esas páginas (lo que no, lo arma el próximo editor). */
  const after = useCallback(
    (scope: ShareScope, reader: boolean, email: string) => {
      if (!reader || !status.cleanOn) return;
      void engine
        .prepareBases(pagesOf(scope), (done, total) => setProgress(total > 0 && done < total ? { done, total, email } : null))
        .finally(() => setProgress(null));
    },
    [engine, pagesOf, status.cleanOn],
  );

  return { cleanOn: status.cleanOn, blocked, progress, ready, after, clearBlocked: () => setBlocked(null) };
}

/** La línea, el aviso de lo pendiente y el progreso, debajo del formulario. */
export function ShareGateNotes({ gate, reader }: { gate: ReturnType<typeof useShareGate>; reader: boolean }) {
  const tr = useT();
  return (
    <>
      {reader && <p className="muted small team-lead">{tr(gate.cleanOn ? 'share.deletedClean' : 'share.deletedNow')}</p>}
      {gate.blocked && (
        <div className="warn small team-lead" role="alert">
          <span>{tr('share.unsynced')}</span>{' '}
          <button type="button" className="link" onClick={gate.blocked.retry}>
            {tr('share.retry')}
          </button>{' '}
          <button type="button" className="link" onClick={gate.blocked.anyway}>
            {tr('share.anyway')}
          </button>
        </div>
      )}
      {gate.progress && (
        <p className="muted small team-lead">
          {tr('share.preparing', { done: gate.progress.done, count: gate.progress.total, email: gate.progress.email })}
        </p>
      )}
    </>
  );
}
