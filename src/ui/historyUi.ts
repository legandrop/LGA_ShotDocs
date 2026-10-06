import { useSyncExternalStore } from 'react';
import type { Permissions } from '../sync/access';
import { HISTORY_SCHEMA_VERSION, type RestoreTrace } from '../sync/history';
import { IS_MAC, isLetter, modPressed } from './findUi';
import type * as Y from 'yjs';
import type { EditorView } from '@tiptap/pm/view';
import type { LineRecovery } from '../sync/historyMapWitness';
import type { UndoTimeline } from './undoTimeline';

export interface RestoreBinding { doc: Y.Doc; view: EditorView; schema: EditorView['state']['schema']; manager: Y.UndoManager }
export interface RestoreLease extends RestoreBinding { current(): boolean }
export interface RestoreContext {
  kind: 'restore' | 'recover-line';
  lease: RestoreLease;
  guard(): boolean;
  recovery?: LineRecovery;
  timeline?: UndoTimeline;
  pageId?: string;
}

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
      receipt?: { step: unknown; manager: Y.UndoManager; origin: unknown; update: Uint8Array; doc: Y.Doc };
    }
  /** `shape`: la versión no pasó la ida y vuelta (algo que el editor no puede armar); `notEditable`: sin editor. */
  | { ok: false; reason: 'shape' | 'notEditable' | 'failed' | 'changed' };

/**
 * `schema`: el de ProseMirror del editor que muestra la versión en el historial. El editor de la página usa el suyo; la
 * barrera de la página (ErrorBarrier.tsx), que restaura sin editor, necesita este para la ida y vuelta.
 */
type RestoreTarget = (version: import('yjs').Doc, schema?: import('@tiptap/pm/model').Schema | null, context?: RestoreContext) => RestoreOutcome;

const targets = new Map<string, { run: RestoreTarget; binding?: () => RestoreBinding | null }>();

/** El editor editable de una página se anota acá; devuelve cómo darse de baja. */
export function registerRestoreTarget(pageId: string, target: RestoreTarget, binding?: () => RestoreBinding | null): () => void {
  const entry = { run: target, binding };
  targets.set(pageId, entry);
  return () => {
    if (targets.get(pageId) === entry) targets.delete(pageId);
  };
}

export function captureRestoreTarget(pageId: string): RestoreLease | null {
  const entry = targets.get(pageId), binding = entry?.binding?.();
  if (!entry || !binding) return null;
  return { ...binding, current: () => {
    const now = entry.binding?.();
    return targets.get(pageId) === entry && !!now && now.doc === binding.doc && now.view === binding.view && now.schema === binding.schema && now.manager === binding.manager;
  } };
}

const pendingTargets = new Map<string, Promise<unknown>>();

/**
 * Un destino que se está preparando (la barrera de la página baja la parte y abre el documento): `restoreTargetSettled`
 * lo espera. Devuelve cómo sacarlo.
 */
export function markRestorePending(pageId: string, ready: Promise<unknown>): () => void {
  pendingTargets.set(pageId, ready);
  return () => {
    if (pendingTargets.get(pageId) === ready) pendingTargets.delete(pageId);
  };
}

/** Espera (hasta `maxMs`) a que termine de prepararse el destino de la página, si se está preparando. */
export async function restoreTargetSettled(pageId: string, maxMs = 10_000): Promise<void> {
  const ready = pendingTargets.get(pageId);
  if (!ready) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([ready.catch(() => undefined), new Promise((r) => (timer = setTimeout(r, maxMs)))]);
  clearTimeout(timer);
}

/**
 * Restaura la versión en el editor abierto de la página, o desde la barrera si el editor tiró un error (si no hay
 * ninguno de los dos, no hace nada).
 */
export function requestRestore(
  pageId: string,
  version: import('yjs').Doc,
  schema?: import('@tiptap/pm/model').Schema | null,
  context?: RestoreContext,
): RestoreOutcome {
  const target = targets.get(pageId);
  if (!target) return { ok: false, reason: 'notEditable' };
  if (context && (!target.binding || !context.lease.current() || !context.guard())) return { ok: false, reason: 'notEditable' };
  return target.run(version, schema, context);
}
