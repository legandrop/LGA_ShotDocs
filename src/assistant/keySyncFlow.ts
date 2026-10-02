import { loadSettings, readKey, sameDestination, saveSettings, setSyncInfo, type AssistantSettings, type KeySyncInfo } from './keyStore';
import { KeySyncError, openKey, sealKey, type KeyPayload } from './keySync';
import { deleteSyncRow, fetchSyncRow, insertSyncRow, SyncRemoteError, updateSyncRow, type KeySyncClient, type SyncMeta } from './keySyncRemote';

// Los pasos de la clave sincronizada (Docs/Doc_Clave_Sincronizada.md, entrega S1), sin interfaz: prender, abrir en
// otro dispositivo, actualizar, reemplazar con una frase nueva y dejar de sincronizar. La ventana (KeySyncSection.tsx)
// solo los llama y muestra el resultado.
//
// - Regla 5: nada de esto borra la clave del dispositivo (solo *Forget key*).
// - Regla 6: abrir una copia que manda la clave a otro proveedor u otra dirección no la adopta sola (`ask`).
// - Regla 7: *Update synced key* y *Replace synced key…* abren primero la copia actual con la frase escrita; si no
//   abre, no escriben nada.

/** El workspace donde vive (o va a vivir) la copia, y la persona en su Supabase. */
export interface SyncContext {
  client: KeySyncClient;
  email: string;
  userId: string;
  /** La clave local del workspace (o su dirección), como la política del asistente. */
  ref: string;
  name: string;
}

/** Lo que este dispositivo subiría: los ajustes guardados y la clave, o `null` si no hay clave guardada. */
async function localPayload(email: string): Promise<{ settings: AssistantSettings; payload: KeyPayload } | null> {
  const settings = await loadSettings(email);
  if (!settings || !settings.model || (!settings.hasKey && settings.provider !== 'compatible')) return null;
  const apiKey = settings.hasKey ? await readKey(email, settings) : '';
  if (settings.provider !== 'compatible' && !apiKey) return null;
  return {
    settings,
    payload: { provider: settings.provider, baseUrl: settings.baseUrl, model: settings.model, apiKey, savedAt: Date.now() },
  };
}

function infoFor(ctx: SyncContext, meta: SyncMeta, savedAt: number): KeySyncInfo {
  return { ref: ctx.ref, name: ctx.name, userId: ctx.userId, generation: meta.generation, savedAt, unlockedAt: Date.now() };
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
export async function turnOnSync(ctx: SyncContext, passphrase: string, overwrite?: { generation: number }): Promise<KeySyncInfo> {
  const local = await localPayload(ctx.email);
  if (!local) throw new NoLocalKeyError();
  const sealed = await sealKey(local.payload, passphrase, ctx.userId);
  const meta = overwrite ? await updateSyncRow(ctx.client, ctx.userId, overwrite.generation, sealed) : await insertSyncRow(ctx.client, sealed);
  const info = infoFor(ctx, meta, local.payload.savedAt);
  await setSyncInfo(ctx.email, info);
  return info;
}

/** Lo que se abrió, y si hace falta preguntar antes de usarlo (regla 6). */
export interface Unlocked {
  payload: KeyPayload;
  meta: SyncMeta;
  /** `ask`: el dispositivo ya tenía una clave para otro proveedor u otra dirección. */
  decision: 'adopt' | 'ask';
}

/** *Unlock*: baja la copia y la abre con la frase. No guarda nada (eso es `adoptUnlocked`). `null` si no hay copia. */
export async function unlockSync(ctx: SyncContext, passphrase: string): Promise<Unlocked | null> {
  const row = await fetchSyncRow(ctx.client, ctx.userId);
  if (!row) return null;
  const payload = await openKey(row, passphrase, ctx.userId);
  const saved = await loadSettings(ctx.email);
  const hadKey = !!saved && (saved.hasKey || saved.provider === 'compatible');
  const decision = hadKey && !sameDestination(saved, payload) ? 'ask' : 'adopt';
  return { payload, meta: { format: row.format, generation: row.generation, updatedAt: row.updatedAt }, decision };
}

/**
 * Guarda en el dispositivo la clave abierta (cifrada con la llave del dispositivo, como siempre) y anota de qué copia
 * vino. El modelo de la copia es solo el valor inicial: si el dispositivo ya usaba ese mismo destino, sigue con el suyo.
 */
export async function adoptUnlocked(ctx: SyncContext, unlocked: Unlocked): Promise<AssistantSettings> {
  const { payload, meta } = unlocked;
  const saved = await loadSettings(ctx.email);
  const same = !!saved && sameDestination(saved, payload);
  return saveSettings(
    ctx.email,
    {
      provider: payload.provider,
      baseUrl: payload.baseUrl,
      model: same && saved.model ? saved.model : payload.model,
      models: same ? saved.models : [],
    },
    payload.apiKey,
    { sync: infoFor(ctx, meta, payload.savedAt) },
  );
}

/** Abre la copia actual con la frase (regla 7) y devuelve su generación; si no abre, tira y no se escribe nada. */
async function checkCurrent(ctx: SyncContext, passphrase: string): Promise<number> {
  const row = await fetchSyncRow(ctx.client, ctx.userId);
  if (!row) throw new SyncRemoteError('conflict');
  await openKey(row, passphrase, ctx.userId);
  return row.generation;
}

/** *Update synced key*: sube la clave de este dispositivo con la misma frase (que primero tiene que abrir la copia). */
export async function updateSync(ctx: SyncContext, passphrase: string): Promise<KeySyncInfo> {
  const local = await localPayload(ctx.email);
  if (!local) throw new NoLocalKeyError();
  const generation = await checkCurrent(ctx, passphrase);
  const meta = await updateSyncRow(ctx.client, ctx.userId, generation, await sealKey(local.payload, passphrase, ctx.userId));
  const info = infoFor(ctx, meta, local.payload.savedAt);
  await setSyncInfo(ctx.email, info);
  return info;
}

/**
 * *Replace synced key…* (un dispositivo perdido, Doc_Clave_Sincronizada.md sección 3): la frase actual abre la copia
 * (regla 7) y la clave de este dispositivo se sube con una frase nueva.
 */
export async function replaceSync(ctx: SyncContext, currentPassphrase: string, newPassphrase: string): Promise<KeySyncInfo> {
  const local = await localPayload(ctx.email);
  if (!local) throw new NoLocalKeyError();
  const generation = await checkCurrent(ctx, currentPassphrase);
  const meta = await updateSyncRow(ctx.client, ctx.userId, generation, await sealKey(local.payload, newPassphrase, ctx.userId));
  const info = infoFor(ctx, meta, local.payload.savedAt);
  await setSyncInfo(ctx.email, info);
  return info;
}

/** *Stop syncing*: borra la copia de este workspace. La clave del dispositivo queda (regla 5). */
export async function stopSync(ctx: SyncContext): Promise<void> {
  await deleteSyncRow(ctx.client, ctx.userId);
  const saved = await loadSettings(ctx.email);
  if (saved?.sync && saved.sync.ref === ctx.ref && saved.sync.userId === ctx.userId) await setSyncInfo(ctx.email, null);
}

/** Cómo terminó un paso, para la ventana. */
export type SyncOutcome = 'wrong' | 'newer' | 'tooLong' | 'noLocalKey' | 'offline' | 'missing' | 'conflict' | 'denied' | 'error';

export function outcomeOf(err: unknown): SyncOutcome {
  if (err instanceof KeySyncError) return err.problem;
  if (err instanceof SyncRemoteError) return err.failure;
  if (err instanceof NoLocalKeyError) return 'noLocalKey';
  return 'error';
}
