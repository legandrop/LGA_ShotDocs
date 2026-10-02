import { useEffect } from 'react';
import { useT } from '../i18n';
import { useRoute } from '../router';
import { usePermissions, useServices } from '../services';
import { lazyPart, Part } from '../ui/lazyPart';
import { MicIcon } from '../ui/icons';
import { useAssistantUi } from '../assistant/assistantUi';
import { cachedPolicyValue } from '../assistant/policyCache';
import { closeDictation, dictationOpen, isDictateShortcut, openDictation, useDictationPage } from './dictationUi';

// *Dictate to report* en la app (Docs/Doc_Dictado.md, entrega V1, sección 6): Ctrl/⌘+Alt+Shift+D la abre y la cierra,
// el botón redondo del teléfono (abajo a la derecha, solo con Editar y la política que lo permite) y la hoja, que se
// baja aparte la primera vez que se abre. Va en la primera carga y es chico.

const DictationPanel = lazyPart(() => import('./DictationPanel').then((m) => m.DictationPanel));

export function DictationHost() {
  const pageId = useDictationPage();
  const route = useRoute();
  const routePage = route.name === 'page' ? route.id : null;
  const { pageId: assistantPage } = useAssistantUi();

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
  const { workspace } = useServices();
  const tr = useT();
  if (!perms.canEditPage(pageId)) return null;
  if (cachedPolicyValue(workspace.config.localKey || workspace.config.url) === 'off') return null;
  return (
    <button className="dictate-fab" aria-label={tr('shell.dictate')} onClick={() => openDictation()}>
      <MicIcon size={26} />
    </button>
  );
}
