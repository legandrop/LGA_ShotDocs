import { adoptVoicePayload, readVoiceKey, resolveVoice, voicePayloadOf } from '../dictation/voiceSettings';
import { dropSyncInfo, loadSettings, readKey, sameDestination, saveSettings, setSyncInfo, syncFor, type AssistantSettings, type KeySyncInfo } from './keyStore';
import { KeySyncError, keyEnding, nextSavedAt, openKey, sealKey, type KeyPayload } from './keySync';
import { deleteSyncRow, fetchSyncRow, insertSyncRow, SyncRemoteError, updateSyncRow, type KeySyncClient, type SyncMeta } from './keySyncRemote';

// Los pasos de la clave sincronizada (Docs/Doc_Clave_Sincronizada.md, entregas S1 y S2), sin interfaz: prender, abrir
// en otro dispositivo, actualizar, reemplazar con una frase nueva, cambiar la frase, subir otra copia a otro workspace
// y dejar de sincronizar. La ventana (KeySyncSection.tsx) solo los llama y muestra el resultado.
//
// - Regla 5: nada de esto borra la clave del dispositivo (solo *Forget key*).
// - Regla 6: abrir una copia que manda la clave (o la de *Voice*) a otro proveedor u otra dirección no la adopta sola.
// - Regla 7: *Update synced key*, *Replace synced key…* y *Change passphrase…* abren primero la copia actual con la
//   frase escrita; si no abre, no escriben nada.
// - Una copia más vieja que la que este dispositivo ya abrió o subió (el `savedAt` de adentro del sobre) no se adopta.

/** El workspace donde vive (o va a vivir) la copia, y la persona en su Supabase. */
export interface SyncContext {
  client: KeySyncClient;
  email: string;
  userId: string;
  /** La clave local del workspace (o su dirección), como la política del asistente. */
  ref: string;
  name: string;
}

/**
 * Lo que este dispositivo subiría: los ajustes guardados, la clave y la de *Voice* (si tiene una propia), o `null` si
 * no hay clave guardada. `savedAt` va siempre después de los que se conocen (`nextSavedAt`).
 */
async function localPayload(email: string, ...known: (number | undefined)[]): Promise<{ settings: AssistantSettings; payload: KeyPayload } | null> {
  const settings = await loadSettings(email);
  if (!settings || !settings.model || (!settings.hasKey && settings.provider !== 'compatible')) return null;
  const apiKey = settings.hasKey ? await readKey(email, settings) : '';
  if (settings.provider !== 'compatible' && !apiKey) return null;
  const voice = await voicePayloadOf(email).catch(() => undefined);
  return {
    settings,
    payload: {
      provider: settings.provider,
      baseUrl: settings.baseUrl,
      model: settings.model,
      apiKey,
      savedAt: nextSavedAt(Date.now(), ...known),
      ...(voice ? { voice } : {}),
    },
  };
}

/** La anotación de este dispositivo sobre la copia de este workspace, si tiene. */
async function entryOf(ctx: SyncContext): Promise<KeySyncInfo | undefined> {
  return syncFor(await loadSettings(ctx.email).catch(() => null), ctx.ref, ctx.userId);
}

/** La anotación de la copia. `voiceFromCopy`: la *Voice* propia del dispositivo es la que quedó en la copia. */
function infoFor(ctx: SyncContext, meta: SyncMeta, savedAt: number, voiceFromCopy: boolean): KeySyncInfo {
  return { ref: ctx.ref, name: ctx.name, userId: ctx.userId, generation: meta.generation, savedAt, unlockedAt: Date.now(), ...(voiceFromCopy ? { voiceFromCopy } : {}) };
}

export class NoLocalKeyError extends Error {
  constructor() {
    super('keySync:noLocalKey');
    this.name = 'NoLocalKeyError';
  }
}

/**
 * *Turn on sync*: cifra la clave de este dispositivo con la frase y la sube. Sin copia, la crea; con `overwrite` (la
 * generación de una copia que la persona no puede abrir: *Forgot it?*), la pisa solo si sigue en esa generación.
 */
export async function turnOnSync(ctx: SyncContext, passphrase: string, overwrite?: { generation: number; updatedAt?: string }): Promise<KeySyncInfo> {
  // Pisando una copia que no se puede abrir, el `savedAt` nuevo va después de la hora de esa copia (la de la base) y de
  // lo que este dispositivo anotó: así los otros dispositivos no la rechazan como "más vieja".
  const local = await localPayload(ctx.email, (await entryOf(ctx))?.savedAt, overwrite?.updatedAt ? Date.parse(overwrite.updatedAt) : undefined);
  if (!local) throw new NoLocalKeyError();
  const sealed = await sealKey(local.payload, passphrase, ctx.userId);
  const meta = overwrite ? await updateSyncRow(ctx.client, ctx.userId, overwrite.generation, sealed) : await insertSyncRow(ctx.client, sealed);
  const info = infoFor(ctx, meta, local.payload.savedAt, !!local.payload.voice);
  await setSyncInfo(ctx.email, info);
  return info;
}

/** Lo que se abrió, y si hace falta preguntar antes de usarlo (regla 6). */
export interface Unlocked {
  payload: KeyPayload;
  meta: SyncMeta;
  /**
   * `ask`: el dispositivo ya tenía una clave para otro proveedor u otra dirección (regla 6). `replace`: el mismo destino,
   * pero el dispositivo tiene otra clave que no vino de esta copia (regla 5: no se pierde sin que la persona lo vea).
   */
  decision: 'adopt' | 'ask' | 'replace';
  /** Con `replace`: los últimos cuatro caracteres de la clave del dispositivo (nunca la clave). */
  localEnding?: string;
  /**
   * La clave de *Voice* de la copia, si cambia algo del dispositivo: `destination` (va a otro lado, regla 6) o `key` (el
   * mismo destino con otra clave, regla 5). Sin esto, se adopta con lo demás.
   */
  voiceAsk?: 'destination' | 'key';
  voiceLocalEnding?: string;
}

/** Si al abrir hay que preguntar algo antes de usar la copia. */
export const needsAnswer = (u: Unlocked) => u.decision !== 'adopt' || !!u.voiceAsk;

/** *Unlock*: baja la copia y la abre con la frase. No guarda nada (eso es `adoptUnlocked`). `null` si no hay copia. */
export async function unlockSync(ctx: SyncContext, passphrase: string): Promise<Unlocked | null> {
  const row = await fetchSyncRow(ctx.client, ctx.userId);
  if (!row) return null;
  const payload = await openKey(row, passphrase, ctx.userId);
  const saved = await loadSettings(ctx.email);
  const entry = syncFor(saved, ctx.ref, ctx.userId);
  // Una copia más vieja que la que este dispositivo ya abrió o subió (un dueño que repone una fila vieja): no se adopta.
  if (entry && payload.savedAt < entry.savedAt) throw new KeySyncError('older');
  const hadKey = !!saved && (saved.hasKey || saved.provider === 'compatible');
  const meta = { format: row.format, generation: row.generation, updatedAt: row.updatedAt };
  // Si la clave del dispositivo vino de esta copia y no se cambió (la copia se actualizó en otro dispositivo), lo nuevo
  // se toma sin preguntar; si no, se pregunta, mostrando el final de las dos.
  const fromThisCopy = !!entry && !entry.localChanged;
  const out: Unlocked = { payload, meta, decision: 'adopt' };
  if (hadKey && !sameDestination(saved, payload)) out.decision = 'ask';
  else if (saved?.hasKey && !fromThisCopy) {
    const local = await readKey(ctx.email, saved);
    if (local && local !== payload.apiKey) Object.assign(out, { decision: 'replace', localEnding: keyEnding(local) });
  }
  if (payload.voice) {
    // Lo que *Voice* usa hoy en este dispositivo (su clave propia, o la del asistente si transcribe).
    const device = await resolveVoice(ctx.email).catch(() => null);
    if (device && !sameDestination(device, payload.voice)) out.voiceAsk = 'destination';
    // El mismo destino con otra clave: se toma sin preguntar solo si la *Voice* del dispositivo vino de esta copia (no
    // alcanza con que la del asistente haya venido de ella: la de *Voice* puede ser propia, B1 de la auditoría).
    else if (device && !entry?.voiceFromCopy) {
      const local = await readVoiceKey(ctx.email, device).catch(() => '');
      if (local && local !== payload.voice.apiKey) Object.assign(out, { voiceAsk: 'key', voiceLocalEnding: keyEnding(local) });
    }
  }
  return out;
}

/**
 * Guarda en el dispositivo la clave abierta (cifrada con la llave del dispositivo, como siempre) y anota de qué copia
 * vino. El modelo de la copia es solo el valor inicial: si el dispositivo ya usaba ese mismo destino, sigue con el suyo.
 */
export async function adoptUnlocked(ctx: SyncContext, unlocked: Unlocked, options: { tabOnly?: boolean } = {}): Promise<AssistantSettings> {
  const { payload, meta } = unlocked;
  const saved = await loadSettings(ctx.email);
  const same = !!saved && sameDestination(saved, payload);
  // Si la clave del dispositivo era otra, las copias de los otros workspaces ya no son la clave de acá.
  const sameKey = same && (saved.hasKey ? (await readKey(ctx.email, saved)) === payload.apiKey : !payload.apiKey);
  const next = await saveSettings(
    ctx.email,
    {
      provider: payload.provider,
      baseUrl: payload.baseUrl,
      model: same && saved.model ? saved.model : payload.model,
      models: same ? saved.models : [],
    },
    payload.apiKey,
    { sync: infoFor(ctx, meta, payload.savedAt, !!payload.voice), othersStale: !sameKey, tabOnly: options.tabOnly },
  );
  // La de *Voice*, si vino en la copia. Si el dispositivo tiene una propia y la copia no trae ninguna, queda (regla 5).
  if (payload.voice) await adoptVoicePayload(ctx.email, payload.voice, !!options.tabOnly);
  return next;
}

/** Abre la copia actual con la frase (regla 7); si no abre, tira y no se escribe nada. */
async function checkCurrent(ctx: SyncContext, passphrase: string): Promise<{ generation: number; payload: KeyPayload }> {
  const row = await fetchSyncRow(ctx.client, ctx.userId);
  if (!row) throw new SyncRemoteError('conflict');
  const payload = await openKey(row, passphrase, ctx.userId);
  return { generation: row.generation, payload };
}

/** *Update synced key*: sube la clave de este dispositivo con la misma frase (que primero tiene que abrir la copia). */
export async function updateSync(ctx: SyncContext, passphrase: string): Promise<KeySyncInfo> {
  if (!(await localPayload(ctx.email))) throw new NoLocalKeyError();
  const current = await checkCurrent(ctx, passphrase);
  const local = (await localPayload(ctx.email, current.payload.savedAt, (await entryOf(ctx))?.savedAt))!;
  const generation = current.generation;
  const meta = await updateSyncRow(ctx.client, ctx.userId, generation, await sealKey(local.payload, passphrase, ctx.userId));
  const info = infoFor(ctx, meta, local.payload.savedAt, !!local.payload.voice);
  await setSyncInfo(ctx.email, info);
  return info;
}

/**
 * *Replace synced key…* (un dispositivo perdido, Doc_Clave_Sincronizada.md sección 3): la frase actual abre la copia
 * (regla 7) y la clave de este dispositivo se sube con una frase nueva.
 */
export async function replaceSync(ctx: SyncContext, currentPassphrase: string, newPassphrase: string): Promise<KeySyncInfo> {
  if (!(await localPayload(ctx.email))) throw new NoLocalKeyError();
  const current = await checkCurrent(ctx, currentPassphrase);
  const local = (await localPayload(ctx.email, current.payload.savedAt, (await entryOf(ctx))?.savedAt))!;
  const generation = current.generation;
  const meta = await updateSyncRow(ctx.client, ctx.userId, generation, await sealKey(local.payload, newPassphrase, ctx.userId));
  const info = infoFor(ctx, meta, local.payload.savedAt, !!local.payload.voice);
  await setSyncInfo(ctx.email, info);
  return info;
}

/**
 * *Change passphrase…* (S2): la frase actual abre la copia (regla 7) y lo MISMO que tenía (la clave, el destino, la de
 * *Voice*) se vuelve a cifrar con la frase nueva, con sal e iv nuevos. No sube la clave del dispositivo: eso es *Update*
 * o *Replace*. Si este dispositivo estaba al día con la copia, sigue al día con la nueva (no se le pide la frase nueva).
 */
export async function changePassphrase(ctx: SyncContext, currentPassphrase: string, newPassphrase: string): Promise<KeySyncInfo> {
  const current = await checkCurrent(ctx, currentPassphrase);
  const entry = await entryOf(ctx);
  const payload: KeyPayload = { ...current.payload, savedAt: nextSavedAt(Date.now(), current.payload.savedAt, entry?.savedAt) };
  const meta = await updateSyncRow(ctx.client, ctx.userId, current.generation, await sealKey(payload, newPassphrase, ctx.userId));
  const info: KeySyncInfo = {
    ...infoFor(ctx, meta, payload.savedAt, !!entry?.voiceFromCopy),
    ...(entry?.localChanged ? { localChanged: true } : {}),
  };
  if (entry && entry.generation === current.generation) await setSyncInfo(ctx.email, info);
  return info;
}

/**
 * *Also sync in this workspace* (S2, CS2): la clave de este dispositivo, que ya está sincronizada en otro workspace, se
 * sube también a este, como una copia independiente. La frase se escribe dos veces (la copia de allá no se puede abrir
 * desde acá); la ventana lo comprueba antes. Las anotaciones de las otras copias no cambian.
 */
export async function alsoSync(ctx: SyncContext, passphrase: string): Promise<KeySyncInfo> {
  return turnOnSync(ctx, passphrase);
}

/** *Stop syncing*: borra la copia de este workspace. La clave del dispositivo queda (regla 5), y las otras copias. */
export async function stopSync(ctx: SyncContext): Promise<void> {
  await deleteSyncRow(ctx.client, ctx.userId);
  await dropSyncInfo(ctx.email, ctx.ref, ctx.userId);
}

/** Cómo terminó un paso, para la ventana. */
export type SyncOutcome = 'wrong' | 'newer' | 'tooLong' | 'older' | 'noLocalKey' | 'offline' | 'missing' | 'conflict' | 'denied' | 'error';

export function outcomeOf(err: unknown): SyncOutcome {
  if (err instanceof KeySyncError) return err.problem;
  if (err instanceof SyncRemoteError) return err.failure;
  if (err instanceof NoLocalKeyError) return 'noLocalKey';
  return 'error';
}
