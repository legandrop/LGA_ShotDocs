import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { useRoute } from '../router';
import { usePermissions, useServices, useSyncStatus } from '../services';
import { lazyPart, Part } from '../ui/lazyPart';
import { MicIcon } from '../ui/icons';
import { useAssistantTarget, useAssistantUi } from '../assistant/assistantUi';
import { cachedPolicyValue } from '../assistant/policyCache';
import { closeDictation, dictationOpen, isDictateShortcut, openDictation, useDictationPage, useQueuedRequest } from './dictationUi';
import { useQueuedNotes } from './queue';
import { useDictateLink } from './dictateLink';
import { useCommentAccess } from '../ui/CommentsToggle';
import { useLinkMode } from '../linkMode';

// *Dictate to report* en la app (Docs/Doc_Dictado.md, entrega V1, sección 6): Ctrl/⌘+Alt+Shift+D la abre y la cierra,
// el botón redondo del teléfono (abajo a la derecha, solo con Editar y la política que lo permite) y la hoja, que se
// baja aparte la primera vez que se abre. Va en la primera carga y es chico.

/** Los reintentos de transcribir las notas que quedaron `saved` con la red encendida (O3). */
const RETRIES = 10;
const RETRY_MS = 60_000;

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
  // El texto de un Atajo de iOS (`/dictate#…`, V4): la hoja se abre en la página que quedó abierta, cuando su editor se
  // anota, con el texto en el campo (la hoja lo toma; no manda nada).
  const link = useDictateLink();
  const routeTarget = useAssistantTarget(routePage ?? '');
  useEffect(() => {
    if (link !== null && routeTarget && routePage === routeTarget.pageId && !pageId) openDictation();
  }, [link, routeTarget, routePage, pageId]);

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
  // Con red "encendida" pero un proveedor que no responde (el portal de un hotel), la nota queda `saved`: se reintenta al
  // volver la app al frente y cada minuto, hasta 10 veces por sesión (O3 de la auditoría de V2/V3).
  const [nudge, setNudge] = useState(0);
  useEffect(() => {
    if (!online || waiting === 0 || nudge >= RETRIES) return;
    const again = () => setNudge((n) => Math.min(n + 1, RETRIES));
    const onVisible = () => document.visibilityState === 'visible' && again();
    const id = setInterval(again, RETRY_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [online, waiting, nudge]);
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
  }, [online, waiting, nudge, user.email, client, workspaceKey]);

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

/**
 * Si se muestra el botón del teléfono: con Editar, o con Comentar fuera de un link público (el visitante de un link no
 * dicta, sección 7), y si la política del workspace no apagó el asistente.
 */
export function fabVisible(o: { canEdit: boolean; canComment: boolean; link: boolean; policyOff: boolean }): boolean {
  return !o.policyOff && (o.canEdit || (o.canComment && !o.link));
}

/**
 * El botón del teléfono: con Editar (o Comentar, para *Add as comment*, V4) y si la política del workspace no apagó el
 * asistente. En la compu no se ve.
 */
function DictateFab({ pageId }: { pageId: string }) {
  const perms = usePermissions();
  // Con un link público no: el visitante no dicta (Doc_Dictado.md, sección 7).
  const link = useLinkMode();
  const { canComment } = useCommentAccess(pageId);
  const { workspace, user } = useServices();
  const tr = useT();
  const workspaceKey = workspace.config.localKey || workspace.config.url;
  // Las notas guardadas para esta página (V2): el número va sobre el botón.
  const saved = useQueuedNotes(user.email, workspaceKey).filter((n) => n.pageId === pageId).length;
  // Sin cuenta (un link público) no hay *Dictate to report* (Docs/Doc_Link_Publico.md, E2.4).
  if (!fabVisible({ canEdit: perms.canEditPage(pageId), canComment, link: !!link || perms.viaLink, policyOff: cachedPolicyValue(workspaceKey) === 'off' })) return null;
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
