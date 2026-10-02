import type { SealedKey } from './keySync';

// La copia cifrada en el Supabase del workspace (Docs/Doc_Clave_Sincronizada.md, secciones 5 y 7; migración
// 20261023120000_clave_sincronizada.sql): la tabla `assistant_key_sync`, una fila por persona, que con Row Level
// Security lee y cambia solo ella. Al servidor llega solo el bloque cifrado (keySync.ts). Fuera del portero y de
// Realtime.
//
// Cada cambio sube `generation` (un trigger en la base). Se escribe con `update … where generation = <la que se leyó>`:
// si no cambia ninguna fila, otro dispositivo cambió la copia en el medio y no se pisa nada (`conflict`). La primera
// vez, `insert`; si ya había una (23505), lo mismo.

export const KEY_SYNC_TABLE = 'assistant_key_sync';

/** Lo que se sabe de la copia sin bajar el cifrado. */
export interface SyncMeta {
  format: number;
  generation: number;
  updatedAt: string;
}

/** La fila entera, para abrirla. */
export interface SyncRow extends SyncMeta, SealedKey {}

export type SyncFailure =
  /** Sin red (o no contestó). */
  | 'offline'
  /** La base del workspace todavía no tiene la tabla. */
  | 'missing'
  /** Otro dispositivo cambió (o creó) la copia en el medio: no se escribió nada. */
  | 'conflict'
  /** La base dijo que no (otra sesión, un token sin permiso). */
  | 'denied'
  | 'error';

export class SyncRemoteError extends Error {
  constructor(readonly failure: SyncFailure) {
    super(`keySyncRemote:${failure}`);
    this.name = 'SyncRemoteError';
  }
}

type Result<T> = PromiseLike<{ data: T; error: { code?: string; message?: string; status?: number } | null; status?: number }>;

/** Lo que se usa del cliente de Supabase (el de verdad o el falso de las pruebas). */
interface Filter<T> extends Result<T> {
  eq(column: string, value: unknown): Filter<T>;
  select(columns: string): Filter<T>;
  maybeSingle(): Result<T>;
  single(): Result<T>;
}
interface Table {
  select(columns: string): Filter<unknown>;
  insert(values: Record<string, unknown>): Filter<unknown>;
  update(values: Record<string, unknown>): Filter<unknown>;
  delete(): Filter<unknown>;
}
export interface KeySyncClient {
  from(table: string): unknown;
}

function table(client: KeySyncClient): Table {
  return client.from(KEY_SYNC_TABLE) as Table;
}

function failureOf(error: { code?: string; message?: string; status?: number } | null | undefined): SyncFailure {
  const code = error?.code ?? '';
  // PostgREST 12+ da PGRST205 para una tabla que no está; antes, 42P01.
  if (code === 'PGRST205' || code === '42P01') return 'missing';
  if (code === '23505') return 'conflict';
  if (code === '42501') return 'denied';
  const message = error?.message ?? '';
  if (/failed to fetch|network|load failed|fetch failed|timed? ?out/i.test(message) || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return 'offline';
  }
  return 'error';
}

async function run<T>(query: PromiseLike<{ data: T; error: { code?: string; message?: string } | null }>): Promise<T> {
  let res: { data: T; error: { code?: string; message?: string } | null };
  try {
    res = await query;
  } catch (err) {
    throw new SyncRemoteError(failureOf({ message: err instanceof Error ? err.message : String(err) }));
  }
  if (res.error) throw new SyncRemoteError(failureOf(res.error));
  return res.data;
}

function meta(row: Record<string, unknown>): SyncMeta {
  return { format: Number(row.format), generation: Number(row.generation), updatedAt: String(row.updated_at ?? '') };
}

/** Si la persona tiene copia en este workspace (sin bajar el cifrado), o `null`. */
export async function fetchSyncMeta(client: KeySyncClient, userId: string): Promise<SyncMeta | null> {
  const row = await run(table(client).select('format, generation, updated_at').eq('user_id', userId).maybeSingle());
  return row ? meta(row as Record<string, unknown>) : null;
}

/** La copia entera, para abrirla con la frase, o `null`. */
export async function fetchSyncRow(client: KeySyncClient, userId: string): Promise<SyncRow | null> {
  const row = (await run(table(client).select('format, salt, iv, ciphertext, generation, updated_at').eq('user_id', userId).maybeSingle())) as Record<
    string,
    unknown
  > | null;
  if (!row) return null;
  return { ...meta(row), format: row.format as number, salt: row.salt as string, iv: row.iv as string, ciphertext: row.ciphertext as string };
}

function columns(sealed: SealedKey): Record<string, unknown> {
  // Solo las cuatro columnas que la base deja escribir; el id lo pone la base (auth.uid()) y la generación, el trigger.
  return { format: sealed.format, salt: sealed.salt, iv: sealed.iv, ciphertext: sealed.ciphertext };
}

/** La primera copia. Devuelve la generación nueva; si ya había una, `conflict`. */
export async function insertSyncRow(client: KeySyncClient, sealed: SealedKey): Promise<SyncMeta> {
  const row = await run(table(client).insert(columns(sealed)).select('format, generation, updated_at').single());
  return meta(row as Record<string, unknown>);
}

/** Cambia la copia solo si sigue en la generación que se leyó; si no, `conflict` y nada cambia. */
export async function updateSyncRow(client: KeySyncClient, userId: string, generation: number, sealed: SealedKey): Promise<SyncMeta> {
  const rows = (await run(table(client).update(columns(sealed)).eq('user_id', userId).eq('generation', generation).select('format, generation, updated_at'))) as
    | Record<string, unknown>[]
    | null;
  if (!rows || rows.length !== 1) throw new SyncRemoteError('conflict');
  return meta(rows[0]);
}

/** *Stop syncing*: borra la copia de verdad (CS8). La clave del dispositivo no se toca. */
export async function deleteSyncRow(client: KeySyncClient, userId: string): Promise<void> {
  await run(table(client).delete().eq('user_id', userId));
}
