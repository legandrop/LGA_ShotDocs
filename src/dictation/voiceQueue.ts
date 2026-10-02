import { t } from '../i18n';
import '../i18n/lazy/dictation';
import { errorText } from '../assistant/errorText';
import { fetchPolicy, policyAllows } from '../assistant/policy';
import { PROVIDER_NAMES, ProviderError } from '../assistant/providers';
import type { RecordingStore } from './recorder';
import { addNote, getNote, listNotes, markRecording, putChunk, readChunks, removeNote, updateNote, type QueuedNote } from './queue';
import { transcribe, type TranscribeOptions } from './transcribe';
import { isLocalVoice, readVoiceKey, resolveVoice } from './voiceSettings';

// El audio en la cola sin red (Docs/Doc_Dictado.md, 8; entrega V3): la grabación se guarda en pedazos como una nota de la
// cola y se transcribe sola cuando hay red (es barato y no cambia la página); ubicarla sigue siendo de a una y con su
// vista previa. Transcribir nunca borra una nota: si falla, queda `failed` con su error, para reintentar, copiar o
// descartar. La política del workspace se mira al mandar.

/** Guarda la grabación como una nota de la cola de esa página (estado `recording`, después `saved`). */
export function queueRecordingStore(base: { email: string; workspace: string; pageId: string; pageTitle: string }): RecordingStore {
  let mime = 'audio/webm';
  return {
    async create(m) {
      mime = m;
      const note = await addNote({ ...base, text: '', state: 'recording', audio: { mime, chunks: 0, durationMs: 0 } });
      markRecording(note.id, true);
      return note.id;
    },
    chunk: (id, seq, data) => putChunk(id, seq, data),
    async progress(id, chunks, durationMs) {
      await updateNote(id, { audio: { mime, chunks, durationMs } });
    },
    async finish(id, chunks, durationMs) {
      markRecording(id, false);
      await updateNote(id, { state: 'saved', audio: { mime, chunks, durationMs } });
    },
    async abandon(id) {
      // Sin el primer pedazo no hay nada grabado (C5): la nota está vacía.
      markRecording(id, false);
      await removeNote(id);
    },
  };
}

/** Por qué no se transcribió (sin error del proveedor). */
export type SkipReason = 'noVoice' | 'policy' | 'offline' | 'busy' | 'gone' | 'notAudio';

export interface TranscribeContext {
  email: string;
  client: unknown;
  workspaceKey: string;
  /** Las pistas de la página abierta (si la hay). */
  hints?: string[];
  online?: boolean;
  transcribeOptions?: TranscribeOptions;
}

const inFlight = new Set<string>();

/**
 * Transcribe una nota con audio de la cola y guarda el texto (`ready`). Si la voz no está configurada, la política no
 * deja, o no hay red, no manda nada y la nota queda como estaba. Un error del proveedor la deja en `failed` con el
 * texto del error (sin la clave); un corte de red, en `saved` (se reintenta sola). Nunca la borra.
 */
export async function transcribeNote(id: string, ctx: TranscribeContext): Promise<QueuedNote | SkipReason> {
  if (inFlight.has(id)) return 'busy';
  inFlight.add(id);
  try {
    const note = await getNote(id);
    if (!note) return 'gone';
    if (!note.audio || (note.state !== 'saved' && note.state !== 'failed')) return 'notAudio';
    const config = await resolveVoice(ctx.email);
    if (!config) return 'noVoice';
    const local = isLocalVoice(config);
    if (ctx.online === false && !local) return 'offline';
    const policy = await fetchPolicy(ctx.client, ctx.workspaceKey);
    if (!policyAllows(policy, config)) return 'policy';
    const chunks = await readChunks(id);
    const data = new Blob(chunks, { type: note.audio.mime });
    if (data.size === 0) return (await updateNote(id, { state: 'failed', error: 'empty' })) ?? 'gone';
    try {
      // La clave se descifra recién acá y queda solo en esta llamada.
      const key = await readVoiceKey(ctx.email, config);
      const out = await transcribe(config, key, { data, mime: note.audio.mime }, ctx.hints ?? [], ctx.transcribeOptions);
      if (!out.text) return (await updateNote(id, { state: 'failed', error: 'nothing' })) ?? 'gone';
      return (await updateNote(id, { state: 'ready', text: out.text, error: undefined })) ?? 'gone';
    } catch (err) {
      if (err instanceof ProviderError && (err.kind === 'network' || err.kind === 'aborted')) return (await updateNote(id, { state: 'saved' })) ?? 'gone';
      return (await updateNote(id, { state: 'failed', error: errorText(err, PROVIDER_NAMES[config.provider], t) })) ?? 'gone';
    }
  } finally {
    inFlight.delete(id);
  }
}

/** Transcribe, de a una, las notas con audio sin transcribir de esa persona en ese workspace (al volver la red). */
export async function transcribePending(workspace: string, ctx: TranscribeContext): Promise<number> {
  let done = 0;
  for (const n of await listNotes(ctx.email, workspace)) {
    if (n.state !== 'saved' || !n.audio) continue;
    const r = await transcribeNote(n.id, ctx);
    if (typeof r === 'string') {
      // Sin voz, sin red o sin permiso de la política: tampoco las siguientes.
      if (r === 'noVoice' || r === 'policy' || r === 'offline') break;
      continue;
    }
    if (r.state === 'ready') done++;
  }
  return done;
}

/** El texto de una nota que no se pudo transcribir. */
export function failureText(error: string | undefined): string {
  if (error === 'nothing') return t('dictation.nothingHeard');
  if (error === 'empty') return t('dictation.emptyRecording');
  return error || t('dictation.transcribeFailed');
}
