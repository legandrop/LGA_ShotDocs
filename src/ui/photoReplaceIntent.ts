import type { EditorView } from '@tiptap/pm/view';

export interface ReplaceIntent {
  isCurrent: () => boolean;
  release: () => void;
  onRetire: (close: () => void) => void;
}
export interface ReplacePick {
  isCurrent: () => boolean;
  receive: (file: File, intent: ReplaceIntent) => void;
}
/** El selector sin File no reclama; un contexto obsoleto tampoco desplaza otra aparición. */
export function replacementPicker(view: EditorView, slot: string, pick: ReplacePick | null | undefined, fallback: (file: File) => void): ((file: File) => void) | null {
  if (pick === null) return null;
  if (!pick) return fallback;
  return (file) => { if (pick.isCurrent()) pick.receive(file, claimReplacement(view, slot)); };
}
// La prioridad pertenece a la vista y aparición, aunque su barra se oculte.
const pending = new WeakMap<EditorView, Map<string, ReplaceIntent>>();
export function claimReplacement(view: EditorView, slot: string): ReplaceIntent {
  let slots = pending.get(view);
  if (!slots) pending.set(view, (slots = new Map()));
  const previous = slots.get(slot);
  let retired = false, close = () => {};
  const intent: ReplaceIntent = {
    isCurrent: () => !retired && pending.get(view)?.get(slot) === intent,
    release: () => {
      if (retired) return;
      retired = true;
      const current = pending.get(view);
      if (current?.get(slot) === intent) {
        current.delete(slot);
        if (!current.size) pending.delete(view);
      }
      close();
    },
    onRetire: (callback) => { close = callback; if (retired) close(); },
  };
  slots.set(slot, intent);
  // Instalar primero: el cierre antiguo no puede liberar la intención nueva.
  previous?.release();
  return intent;
}
