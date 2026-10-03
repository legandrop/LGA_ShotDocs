import { useSyncExternalStore } from 'react';
import type { Permissions } from '../sync/access';
import { HISTORY_SCHEMA_VERSION, type RestoreTrace } from '../sync/history';
import { IS_MAC, isLetter, modPressed } from './findUi';

// El historial de versiones (P.18, Docs/Doc_Historial.md): si está abierto y para qué página, quién lo puede ver y
// el pedido de restaurar que toma el editor de la página. Va en la primera carga (es chico); la pantalla del
// historial se baja aparte (HistoryPanel.tsx).

interface HistoryUiState {
  pageId: string | null;
}

let state: HistoryUiState = { pageId: null };
const listeners = new Set<() => void>();

function set(next: HistoryUiState): void {
  state = next;
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useHistoryUi(): HistoryUiState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Si el historial está abierto (fuera de un componente). */
export function historyOpen(): boolean {
  return state.pageId !== null;
}

export function openHistory(pageId: string): void {
  set({ pageId });
}

export function closeHistory(): void {
  if (state.pageId !== null) set({ pageId: null });
}

/**
 * Quién ve el historial (decisión de Lega del 2026-10-01): quien puede editar la página, el dueño y los admins; los
 * invitados no, aunque tengan Editar. Solo con la base migrada. La base lo vuelve a comprobar (`page_history`).
 */
export function canSeeHistory(perms: Pick<Permissions, 'canEditPage' | 'role'>, pageId: string, schemaVersion: number | null | undefined): boolean {
  return (schemaVersion ?? 0) >= HISTORY_SCHEMA_VERSION && perms.canEditPage(pageId) && perms.role !== 'guest';
}

/** Ctrl+Alt+Shift+H (⌘⌥⇧H en la Mac: nunca Ctrl en la Mac), el mismo de Google Docs. `mac` para probar las dos. */
export function isHistoryShortcut(
  e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; key: string; code?: string },
  mac = IS_MAC,
): boolean {
  return modPressed(e, mac) && e.altKey && e.shiftKey && isLetter(e, 'h');
}

// --- Restaurar por el editor de la página ---------------------------------------------------------------------------

/** Lo que devuelve el editor al pedirle restaurar. */
export type RestoreOutcome =
  /**
   * `undo`: deshace la restauración si sigue siendo lo último; `onEdit`: avisa la próxima edición de la página;
   * `onUndone`: avisa cuando se deshace la restauración, por el **Undo** del aviso o con Ctrl/⌘+Z (una vez).
   */
  | {
      ok: true;
      undo: () => boolean;
      onEdit: (fn: () => void) => () => void;
      onUndone?: (fn: () => void) => () => void;
      trace?: RestoreTrace;
      /** `false`: no se deshace desde el aviso (se restauró sin el editor, desde la barrera de la página). */
      undoable?: false;
    }
  /** `shape`: la versión no pasó la ida y vuelta (algo que el editor no puede armar); `notEditable`: sin editor. */
  | { ok: false; reason: 'shape' | 'notEditable' | 'failed' };

/**
 * `schema`: el de ProseMirror del editor que muestra la versión en el historial. El editor de la página usa el suyo; la
 * barrera de la página (ErrorBarrier.tsx), que restaura sin editor, necesita este para la ida y vuelta.
 */
type RestoreTarget = (version: import('yjs').Doc, schema?: import('@tiptap/pm/model').Schema | null) => RestoreOutcome;

const targets = new Map<string, RestoreTarget>();

/** El editor editable de una página se anota acá; devuelve cómo darse de baja. */
export function registerRestoreTarget(pageId: string, target: RestoreTarget): () => void {
  targets.set(pageId, target);
  return () => {
    if (targets.get(pageId) === target) targets.delete(pageId);
  };
}

/**
 * Restaura la versión en el editor abierto de la página, o desde la barrera si el editor tiró un error (si no hay
 * ninguno de los dos, no hace nada).
 */
export function requestRestore(
  pageId: string,
  version: import('yjs').Doc,
  schema?: import('@tiptap/pm/model').Schema | null,
): RestoreOutcome {
  const target = targets.get(pageId);
  if (!target) return { ok: false, reason: 'notEditable' };
  return target(version, schema);
}
