import { useEffect } from 'react';
import { useT } from '../i18n';
import { useRoute } from '../router';
import { usePermissions, useServices, useSyncStatus } from '../services';
import { lazyPart, Part } from '../ui/lazyPart';
import { MicIcon } from '../ui/icons';
import { useAssistantTarget, useAssistantUi } from '../assistant/assistantUi';
import { cachedPolicyValue } from '../assistant/policyCache';
import { closeDictation, dictationOpen, isDictateShortcut, openDictation, useDictationPage, useQueuedRequest } from './dictationUi';
import { useQueuedNotes } from './queue';

// *Dictate to report* en la app (Docs/Doc_Dictado.md, entrega V1, sección 6): Ctrl/⌘+Alt+Shift+D la abre y la cierra,
// el botón redondo del teléfono (abajo a la derecha, solo con Editar y la política que lo permite) y la hoja, que se
// baja aparte la primera vez que se abre. Va en la primera carga y es chico.

const DictationPanel = lazyPart(() => import('./DictationPanel').then((m) => m.DictationPanel));

export function DictationHost() {
  const pageId = useDictationPage();
  const route = useRoute();
  const routePage = route.name === 'page' ? route.id : null;
  const { pageId: assistantPage } = useAssistantUi();
  // Una nota de la cola que se pidió ubicar (V2): la hoja se abre cuando el editor de su página se anota.
  const queued = useQueuedRequest();
  const queuedTarget = useAssistantTarget(queued?.pageId ?? '');
  useEffect(() => {
    if (queued && queuedTarget && routePage === queued.pageId && pageId !== queued.pageId) openDictation();
  }, [queued, queuedTarget, routePage, pageId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escribiendo con un IME, la tecla es de la composición.
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229 || !isDictateShortcut(e)) return;
      e.preventDefault();
      if (dictationOpen()) closeDictation();
      else openDictation();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Las grabaciones guardadas sin red se transcriben solas al volver la red (V3; transcribir es barato y no cambia la
  // página: ubicarlas sigue siendo de a una, con su vista previa). Lo que hace falta se baja recién si hay alguna.
  const { user, workspace, client } = useServices();
  const workspaceKey = workspace.config.localKey || workspace.config.url;
  const online = useSyncStatus().online;
  const waiting = useQueuedNotes(user.email, workspaceKey).filter((n) => n.state === 'saved' && n.audio).length;
  useEffect(() => {
    if (!online || waiting === 0) return;
    let live = true;
    const id = setTimeout(() => {
      void import('./voiceQueue')
        .then((m) => (live ? m.transcribePending(workspaceKey, { email: user.email, client, workspaceKey, online: true }) : 0))
        .catch((err) => console.error('Dictado: no se pudieron transcribir las notas guardadas', err));
    }, 1500);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [online, waiting, user.email, client, workspaceKey]);

  // Al cambiar de página, la hoja se cierra (la nota queda guardada con su página).
  useEffect(() => {
    if (pageId && pageId !== routePage) closeDictation();
  }, [pageId, routePage]);
  // El asistente ocupa el mismo lugar: si se abre, la hoja se cierra.
  useEffect(() => {
    if (assistantPage) closeDictation();
  }, [assistantPage]);
  useEffect(() => () => closeDictation(), []);

  return (
    <>
      {routePage && !pageId && !assistantPage && <DictateFab pageId={routePage} />}
      {pageId && (
        <Part onClose={closeDictation}>
          <DictationPanel key={pageId} pageId={pageId} />
        </Part>
      )}
    </>
  );
}

/** El botón del teléfono: con Editar y si la política del workspace no apagó el asistente. En la compu no se ve. */
function DictateFab({ pageId }: { pageId: string }) {
  const perms = usePermissions();
  const { workspace, user } = useServices();
  const tr = useT();
  const workspaceKey = workspace.config.localKey || workspace.config.url;
  // Las notas guardadas para esta página (V2): el número va sobre el botón.
  const saved = useQueuedNotes(user.email, workspaceKey).filter((n) => n.pageId === pageId).length;
  if (!perms.canEditPage(pageId)) return null;
  if (cachedPolicyValue(workspaceKey) === 'off') return null;
  return (
    <button className="dictate-fab" aria-label={saved > 0 ? tr('shell.dictateSaved', { count: saved }) : tr('shell.dictate')} onClick={() => openDictation()}>
      <MicIcon size={26} />
      {saved > 0 && (
        <span className="dictate-fab-count" aria-hidden="true">
          {saved}
        </span>
      )}
    </button>
  );
}
