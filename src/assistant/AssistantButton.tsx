import { useBlockNoteEditor, useComponentsContext } from '@blocknote/react';
import { useT } from '../i18n';
import '../i18n/lazy/editor';
import { useSyncStatus } from '../services';
import { AssistantIcon } from '../ui/icons';
import { shortcutLabel } from '../ui/shortcuts';
import { currentTarget, openAssistant } from './assistantUi';

/**
 * El botón *Assistant* de la barra que aparece al elegir texto (Docs/Doc_Asistente.md, sección 11). Su tooltip dice
 * solo el atajo; sin red, que el asistente necesita internet (un modelo local se intenta igual, desde el panel).
 */
export function AssistantToolbarButton() {
  const editor = useBlockNoteEditor();
  // Solo en el editor de la página abierta (no en la página de práctica ni en una versión del historial). Se mira antes
  // de pedir los servicios: donde no se muestra (la práctica, el historial, las pruebas de la barra) no depende de ellos.
  const view = currentTarget()?.view();
  if (!view || view !== editor.prosemirrorView) return null;
  return <AssistantToolbarButtonShown />;
}

function AssistantToolbarButtonShown() {
  const Components = useComponentsContext()!;
  const { online } = useSyncStatus();
  const tr = useT();
  return (
    <Components.FormattingToolbar.Button
      className="bn-button sd-assistant-button"
      label={tr('editor.assistant')}
      mainTooltip={tr('editor.assistant')}
      secondaryTooltip={online ? shortcutLabel('assistant') : tr('editor.assistantOffline')}
      icon={<AssistantIcon size={18} />}
      onClick={() => openAssistant()}
    />
  );
}
