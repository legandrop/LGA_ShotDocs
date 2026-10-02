import { useEffect, useState } from 'react';
import { dictationDb, type QueuedNote, type StoredChunk } from './dictationDb';

// La cola de notas sin red (Docs/Doc_Dictado.md, 8; entrega V2). Una nota que no se pudo ubicar (sin red, o porque la
// persona eligió *Save for later*) queda en el dispositivo hasta que la persona decide qué hacer con ella: la ubica (con
// su vista previa, de a una, contra la página como está en ese momento), la pega como texto, o la descarta con una
// confirmación. **Nunca se borra sola**: ninguna función de este archivo borra una nota salvo `removeNote`, que se llama
// solo desde esas acciones.
//
// Va en la primera carga (el aviso del indicador de sincronización cuenta las notas) y es chico. No se sincroniza: son
// notas personales sin procesar, de este dispositivo.

export type { NoteState, QueuedNote } from './dictationDb';

const NOTE = 'n:';
const CHUNK = 'c:';
/** Todas las claves que empiezan con `prefix` (las de la cola son texto). */
const range = (prefix: string) => IDBKeyRange.bound(prefix, `${prefix}￿`);
const chunkPrefix = (noteId: string) => `${CHUNK}${noteId.slice(NOTE.length)}:`;

const norm = (email: string) => email.trim().toLowerCase();
const uuid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

// --- Avisos de cambio (en esta pestaña y en las otras) ---------------------------------------------------------------

const listeners = new Set<() => void>();
let channel: BroadcastChannel | null | undefined;

function bus(): BroadcastChannel | null {
  if (channel === undefined) {
    try {
      channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('shotdocs-dictation') : null;
      channel?.addEventListener('message', () => emit(false));
    } catch {
      channel = null;
    }
  }
  return channel;
}

function emit(broadcast = true): void {
  for (const fn of [...listeners]) fn();
  if (broadcast) {
    try {
      bus()?.postMessage('changed');
    } catch {
      // Sin canal: las otras pestañas se enteran al volver al frente.
    }
  }
}

export function onNotesChanged(fn: () => void): () => void {
  bus();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// --- Las notas -------------------------------------------------------------------------------------------------------

export interface NewNote {
  email: string;
  workspace: string;
  pageId: string;
  pageTitle: string;
  text: string;
  state?: QueuedNote['state'];
  audio?: QueuedNote['audio'];
}

/** La hora de cada nota nueva, siempre mayor que la anterior (dos en el mismo milisegundo quedan en orden). */
let lastCreated = 0;

/** Guarda una nota nueva y la devuelve. Si la escritura falla, tira el error: quien llama no vacía nada. */
export async function addNote(input: NewNote): Promise<QueuedNote> {
  const now = Math.max(Date.now(), lastCreated + 1);
  lastCreated = now;
  const note: QueuedNote = {
    id: `${NOTE}${uuid()}`,
    kind: 'note',
    email: norm(input.email),
    workspace: input.workspace,
    pageId: input.pageId,
    pageTitle: input.pageTitle,
    createdAt: now,
    updatedAt: now,
    text: input.text,
    state: input.state ?? 'ready',
    ...(input.audio ? { audio: input.audio } : {}),
  };
  const d = await dictationDb();
  await d.put('notes', note);
  emit();
  return note;
}

const isNote = (v: unknown): v is QueuedNote => !!v && (v as QueuedNote).kind === 'note';

export async function getNote(id: string): Promise<QueuedNote | null> {
  const v = await (await dictationDb()).get('notes', id);
  return isNote(v) ? v : null;
}

/** Las notas de esa persona en ese workspace, de la más vieja a la más nueva. */
export async function listNotes(email: string, workspace: string): Promise<QueuedNote[]> {
  const d = await dictationDb();
  const all = (await d.getAll('notes', range(NOTE))).filter(isNote);
  const who = norm(email);
  return all.filter((n) => n.email === who && n.workspace === workspace).sort((a, b) => a.createdAt - b.createdAt);
}

/** Cambia una nota que existe (en una transacción: leer y escribir). Devuelve la nota nueva, o `null` si ya no está. */
export async function updateNote(id: string, patch: Partial<Omit<QueuedNote, 'id' | 'kind' | 'email' | 'workspace' | 'createdAt'>>): Promise<QueuedNote | null> {
  const d = await dictationDb();
  const tx = d.transaction('notes', 'readwrite');
  const now = await tx.store.get(id);
  if (!isNote(now)) {
    await tx.done;
    return null;
  }
  const next: QueuedNote = { ...now, ...patch, id: now.id, kind: 'note', updatedAt: Date.now() };
  await tx.store.put(next);
  await tx.done;
  emit();
  return next;
}

/**
 * Saca una nota de la cola con su grabación, en una sola transacción. Se llama SOLO desde una acción de la persona:
 * *Discard* confirmado, *Insert as text* ya escrito en la página, o *Apply* con la nota ya guardada en el borrador.
 */
export async function removeNote(id: string): Promise<void> {
  const d = await dictationDb();
  const tx = d.transaction('notes', 'readwrite');
  await tx.store.delete(id);
  await tx.store.delete(range(chunkPrefix(id)));
  await tx.done;
  emit();
}

// --- Transcribir de a una pestaña (O1) -------------------------------------------------------------------------------

/** Esta pestaña (para reclamar una nota antes de transcribirla). */
export const TAB_ID: string = uuid();
/** Cuánto dura un reclamo: lo que puede tardar una transcripción de 2 minutos con margen. */
export const CLAIM_MS = 90_000;

/**
 * Reclama una nota con audio para transcribirla, en una transacción (las de IndexedDB no se cruzan entre pestañas): solo
 * si sigue sin transcribir (`saved` o `failed`) y nadie la tiene reclamada. Devuelve la nota reclamada, o por qué no.
 */
export async function claimNote(id: string, by = TAB_ID, now = Date.now()): Promise<QueuedNote | 'gone' | 'notAudio' | 'busy'> {
  const d = await dictationDb();
  const tx = d.transaction('notes', 'readwrite');
  const n = await tx.store.get(id);
  if (!isNote(n)) {
    await tx.done;
    return 'gone';
  }
  if (!n.audio || (n.state !== 'saved' && n.state !== 'failed')) {
    await tx.done;
    return 'notAudio';
  }
  if (n.claim && n.claim.by !== by && n.claim.until > now) {
    await tx.done;
    return 'busy';
  }
  const next: QueuedNote = { ...n, claim: { by, until: now + CLAIM_MS } };
  await tx.store.put(next);
  await tx.done;
  return next;
}

/**
 * Escribe el resultado de una transcripción solo si la nota sigue reclamada por esta pestaña y sin transcribir: nunca
 * pisa una transcripción de otra pestaña ni una corrección de la persona. Devuelve la nota como quedó.
 */
export async function settleClaim(id: string, patch: Partial<Pick<QueuedNote, 'state' | 'text' | 'error'>>, by = TAB_ID): Promise<QueuedNote | null> {
  const d = await dictationDb();
  const tx = d.transaction('notes', 'readwrite');
  const n = await tx.store.get(id);
  if (!isNote(n)) {
    await tx.done;
    return null;
  }
  if (n.claim?.by !== by || (n.state !== 'saved' && n.state !== 'failed')) {
    await tx.done;
    return n;
  }
  const { claim: _claim, ...rest } = n;
  const next: QueuedNote = { ...rest, ...patch, id: n.id, kind: 'note', updatedAt: Date.now() };
  await tx.store.put(next);
  await tx.done;
  emit();
  return next;
}

/** Vuelve a poner una nota tal como estaba (el *Undo* de la hoja después de ubicarla). */
export async function restoreNote(note: QueuedNote): Promise<void> {
  const d = await dictationDb();
  await d.put('notes', { ...note, updatedAt: Date.now() });
  emit();
}

// --- La grabación, por pedazos (V3) ---------------------------------------------------------------------------------

/**
 * Guarda un pedazo de la grabación de una nota. Tira el error si no se pudo (quien graba lo tiene que saber). Se guarda
 * como `ArrayBuffer`, no como `Blob`: guardar un `Blob` en IndexedDB falló en versiones de Safari, y un `ArrayBuffer`
 * se guarda igual en todos los navegadores.
 */
export async function putChunk(noteId: string, seq: number, data: Blob | ArrayBuffer): Promise<void> {
  const bytes = data instanceof ArrayBuffer ? data : await data.arrayBuffer();
  const d = await dictationDb();
  const chunk: StoredChunk = { id: `${chunkPrefix(noteId)}${String(seq).padStart(5, '0')}`, kind: 'chunk', note: noteId, seq, data: bytes };
  await d.put('notes', chunk);
}

/** Los pedazos de la grabación de una nota, en orden. */
export async function readChunks(noteId: string): Promise<ArrayBuffer[]> {
  const d = await dictationDb();
  const rows = (await d.getAll('notes', range(chunkPrefix(noteId)))) as StoredChunk[];
  return rows.filter((r) => r.kind === 'chunk').sort((a, b) => a.seq - b.seq).map((r) => r.data);
}

// --- Grabaciones en curso y cortadas (V3) ----------------------------------------------------------------------------

/** Las notas que esta pestaña está grabando ahora. */
const recording = new Set<string>();
/** Cuánto sin noticias de una grabación (los pedazos llegan cada segundo) para darla por cortada. */
const STALE_MS = 5000;

export function markRecording(id: string, on: boolean): void {
  if (on) recording.add(id);
  else recording.delete(id);
}

/**
 * Una grabación que quedó en `recording` porque la página se cerró o se cortó (iOS mató la pestaña) pasa a `saved` con
 * lo que se guardó hasta ahí (C5). Si no llegó a guardar ni un pedazo, a `failed` (sin audio no hay qué transcribir):
 * queda en la lista para que la persona la descarte. Nunca se borra.
 */
export async function recoverRecordings(list: QueuedNote[], now = Date.now()): Promise<boolean> {
  let changed = false;
  for (const n of list) {
    if (n.state !== 'recording' || recording.has(n.id) || now - n.updatedAt < STALE_MS) continue;
    const chunks = (await readChunks(n.id)).length;
    const audio = { mime: n.audio?.mime ?? 'audio/webm', chunks, durationMs: Math.max(n.audio?.durationMs ?? 0, chunks * 1000) };
    await updateNote(n.id, chunks > 0 ? { state: 'saved', audio } : { state: 'failed', audio, error: 'empty' });
    changed = true;
  }
  return changed;
}

// --- Para la interfaz ------------------------------------------------------------------------------------------------

/**
 * Las notas de la cola de esa persona en ese workspace, al día: se vuelven a leer con cada cambio (de esta pestaña o
 * de otra), al volver la red y al volver la app al frente. Mientras lee la primera vez, una lista vacía. Sin las que se
 * están grabando (una grabación cortada pasa a `saved` y aparece).
 */
export function useQueuedNotes(email: string, workspace: string): QueuedNote[] {
  const [notes, setNotes] = useState<QueuedNote[]>([]);
  useEffect(() => {
    let live = true;
    let seq = 0;
    const read = () => {
      const mine = ++seq;
      void listNotes(email, workspace)
        .then(async (list) => {
          // Una grabación cortada (la página se cerró mientras grababa) se cierra con lo que llegó a guardar.
          if (await recoverRecordings(list).catch(() => false)) return;
          // La que se está grabando todavía no es una nota para ubicar.
          if (live && mine === seq) setNotes(list.filter((n) => n.state !== 'recording'));
        })
        .catch((err) => console.error('Dictado: no se pudo leer la cola de notas', err));
    };
    read();
    const off = onNotesChanged(read);
    const onVisible = () => document.visibilityState === 'visible' && read();
    window.addEventListener('online', read);
    window.addEventListener('focus', read);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      off();
      window.removeEventListener('online', read);
      window.removeEventListener('focus', read);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [email, workspace]);
  return notes;
}
