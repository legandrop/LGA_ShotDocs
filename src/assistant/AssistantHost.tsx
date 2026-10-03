import { useEffect } from 'react';
import { useRoute } from '../router';
import { lazyPart, Part } from '../ui/lazyPart';
import { assistantOpen, closeAssistant, closeAssistantSettings, isAssistantShortcut, openAssistant, useAssistantUi } from './assistantUi';
import { SignOutDialog } from './SignOutDialog';
import { SignOutOthersDialog } from './SignOutOthersDialog';

// El asistente en la app (Docs/Doc_Asistente.md, entrega A1): Ctrl/⌘+Alt+J lo abre y lo cierra, y el panel y los
// ajustes se bajan aparte la primera vez que se abren. Va en la primera carga y es chico.

const AssistantPanel = lazyPart(() => import('./AssistantPanel').then((m) => m.AssistantPanel));
const AssistantSettings = lazyPart(() => import('./AssistantSettings').then((m) => m.AssistantSettings));

export function AssistantHost() {
  const { pageId, settings, signOut, signOutOthers } = useAssistantUi();
  const route = useRoute();
  const routePage = route.name === 'page' ? route.id : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escribiendo con un IME, la tecla es de la composición.
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229 || !isAssistantShortcut(e)) return;
      e.preventDefault();
      if (assistantOpen()) closeAssistant();
      else openAssistant();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Al cambiar de página, el panel se cierra (la sugerencia era de la otra).
  useEffect(() => {
    if (pageId && pageId !== routePage) closeAssistant();
  }, [pageId, routePage]);
  useEffect(() => () => {
    closeAssistant();
    closeAssistantSettings();
  }, []);

  return (
    <>
      {pageId && (
        <Part onClose={closeAssistant}>
          <AssistantPanel key={pageId} pageId={pageId} />
        </Part>
      )}
      {settings && (
        <Part onClose={closeAssistantSettings}>
          <AssistantSettings />
        </Part>
      )}
      {signOut && <SignOutDialog email={signOut.email} workspace={signOut.workspace} run={signOut.run} />}
      {signOutOthers && <SignOutOthersDialog workspace={signOutOthers.workspace} run={signOutOthers.run} />}
    </>
  );
}
