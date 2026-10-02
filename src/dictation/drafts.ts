import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

// La nota de *Dictate to report* guardada en el dispositivo (Docs/Doc_Dictado.md, 5.7 y 8): el borrador del campo de
// texto mientras se escribe y lo que quedó en *Couldn't place*. Cerrar la hoja o la app no la pierde: se vacía solo con
// una acción de la persona (*Done*, *Discard*, *Add to Summary* de cada pedazo) o cuando *Apply* ubicó todo.
//
// Una base IndexedDB propia, `shotdocs-dictation` (no la del asistente: una pestaña vieja que abriera esa base con otra
// versión fallaría). Trae ya el almacén `notes` de la cola sin red (entrega V2), vacío, para que V2 no tenga que subir
// la versión de la base. Un borrador por correo, workspace y página. No se sincroniza: son notas personales.

export const DICTATION_DB = 'shotdocs-dictation';

/** Un pedazo de una nota que no se ubicó (o que la persona destildó). */
export interface PendingItem {
  id: string;
  text: string;
}

export interface Draft {
  /** `correo|workspace|página`. */
  id: string;
  email: string;
  workspace: string;
  pageId: string;
  /** Lo escrito en el campo (la nota que todavía no se ubicó). */
  text: string;
  /** Lo que quedó sin ubicar. */
  pending: PendingItem[];
  updatedAt: number;
}

interface Schema extends DBSchema {
  drafts: { key: string; value: Draft };
  /** La cola de notas sin red (V2). */
  notes: { key: string; value: { id: string } };
}

let opening: Promise<IDBPDatabase<Schema>> | null = null;

function db(): Promise<IDBPDatabase<Schema>> {
  opening ??= openDB<Schema>(DICTATION_DB, 1, {
    upgrade(d) {
      d.createObjectStore('drafts', { keyPath: 'id' });
      d.createObjectStore('notes', { keyPath: 'id' });
    },
  }).catch((err: unknown) => {
    opening = null;
    throw err;
  });
  return opening;
}

/** Para las pruebas: cierra la base (la próxima vez se vuelve a abrir). */
export async function closeDictationDb(): Promise<void> {
  const d = await opening?.catch(() => null);
  d?.close();
  opening = null;
}

export const draftId = (email: string, workspace: string, pageId: string) => `${email.trim().toLowerCase()}|${workspace}|${pageId}`;

export async function loadDraft(email: string, workspace: string, pageId: string): Promise<Draft | null> {
  return (await (await db()).get('drafts', draftId(email, workspace, pageId))) ?? null;
}

/** Guarda el borrador; si no queda nada (ni texto ni pendientes), lo borra. */
export async function saveDraft(email: string, workspace: string, pageId: string, text: string, pending: PendingItem[]): Promise<void> {
  const d = await db();
  const id = draftId(email, workspace, pageId);
  if (!text.trim() && pending.length === 0) {
    await d.delete('drafts', id);
    return;
  }
  await d.put('drafts', { id, email: email.trim().toLowerCase(), workspace, pageId, text, pending, updatedAt: Date.now() });
}
