import { dictationDb, type PendingItem } from './dictationDb';

// La nota de *Dictate to report* guardada en el dispositivo (Docs/Doc_Dictado.md, 5.7 y 8): el borrador del campo de
// texto mientras se escribe y lo que quedó en *Couldn't place*. Cerrar la hoja o la app no la pierde: se vacía solo con
// una acción de la persona (*Done*, *Discard*, *Add to Summary* de cada pedazo) o cuando *Apply* ubicó todo.
//
// Vive en la base `shotdocs-dictation` (dictationDb.ts), junto a la cola de notas sin red (queue.ts). Un borrador por
// correo, workspace y página. No se sincroniza: son notas personales.

export { DICTATION_DB, closeDictationDb, type Draft, type PendingItem } from './dictationDb';

export const draftId = (email: string, workspace: string, pageId: string) => `${email.trim().toLowerCase()}|${workspace}|${pageId}`;

export async function loadDraft(email: string, workspace: string, pageId: string) {
  return (await (await dictationDb()).get('drafts', draftId(email, workspace, pageId))) ?? null;
}

/** Guarda el borrador; si no queda nada (ni texto, ni pendientes, ni la nota aplicada), lo borra. */
export async function saveDraft(email: string, workspace: string, pageId: string, text: string, pending: PendingItem[], applied = ''): Promise<void> {
  const d = await dictationDb();
  const id = draftId(email, workspace, pageId);
  if (!text.trim() && pending.length === 0 && !applied.trim()) {
    await d.delete('drafts', id);
    return;
  }
  await d.put('drafts', { id, email: email.trim().toLowerCase(), workspace, pageId, text, pending, applied: applied || undefined, updatedAt: Date.now() });
}
