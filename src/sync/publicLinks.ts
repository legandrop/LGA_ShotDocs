import type { SupabaseClient } from '@supabase/supabase-js';
import { timed, toRemoteError } from './remote';

// Lo que llama quien comparte para el link público ("Anyone with the link", supabase/migrations/20261012120000_link_publico.sql):
// crear, cambiar el vencimiento, resetear, apagar y ver el uso. Todo pide `can_share` en la base.

/** La versión de la base con los links públicos. */
export const LINK_SCHEMA_VERSION = 14;

export interface LinkUsage {
  n: number;
  bytes: number;
}

export interface PublicLink {
  id: string;
  page_id: string;
  level: 'comment' | 'edit';
  created_at: string;
  expires_at: string | null;
  created_by_name: string | null;
  token: string | null;
  /** Anda hoy (no venció y quien lo creó todavía puede compartir). */
  alive: boolean;
  usage_today: Partial<Record<'open' | 'pull' | 'pass' | 'comment' | 'push', LinkUsage>>;
  /** Llegó a un tope del día. */
  limited: boolean;
  /** Comentarios vivos escritos con el link. */
  comments: number;
  /**
   * Lo que escribió el link (Can edit, versión 19 de la base): cuánto espera en la sala, cuánto está retenido (el link
   * dejó de editar esa página por algo que puede volver), cuánto se apartó y cuánto entró hoy. Sin la versión 19, no está.
   */
  edits?: { waiting: number; held: number; aside: number; admitted_today: number; push_bytes_total: number };
}

export interface PublicLinkInfo {
  /** El interruptor de D14 (sin él no se crean links, D33). */
  clean_on: boolean;
  /** El interruptor de Can edit (`link_edit_min_version`, versión 19): sin él, Can edit se ve apagado (`edit_off`). */
  edit_on?: boolean;
  link: PublicLink | null;
  /** El link de la página de arriba más cercana que tenga uno (sin token); su título solo si la sesión la ve. */
  above: { page_id: string; level: string; title: string | null } | null;
}

async function call<T>(client: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error, status } = await timed(client.rpc(fn, args));
  if (error) throw toRemoteError(error, status);
  return data as T;
}

/** `null` si la sesión no puede compartir la página. */
export function getPublicLink(client: SupabaseClient, pageId: string): Promise<PublicLinkInfo | null> {
  return call(client, 'get_public_link', { p_page: pageId });
}

/** El nivel de un link: *Can view* (que comenta) o *Can edit* (entrega 2a, con su interruptor). */
export type LinkLevel = 'comment' | 'edit';

export function createPublicLink(client: SupabaseClient, pageId: string, expires: string | null, level: LinkLevel = 'comment'): Promise<PublicLink> {
  return call(client, 'create_public_link', { p_id: crypto.randomUUID(), p_page: pageId, p_level: level, p_expires: expires });
}

/** Cambia el nivel y el vencimiento del link vivo (conserva el token). */
export function setPublicLink(client: SupabaseClient, pageId: string, level: LinkLevel, expires: string | null): Promise<PublicLink> {
  return call(client, 'set_public_link', { p_page: pageId, p_level: level, p_expires: expires });
}

/** Cambia solo el vencimiento (con el nivel que ya tiene: cambiarlo de a uno nunca baja un Can edit a Can view). */
export function setPublicLinkExpiry(client: SupabaseClient, pageId: string, expires: string | null, level: LinkLevel = 'comment'): Promise<PublicLink> {
  return setPublicLink(client, pageId, level, expires);
}

export function resetPublicLink(client: SupabaseClient, pageId: string): Promise<PublicLink> {
  return call(client, 'reset_public_link', { p_page: pageId, p_new_id: crypto.randomUUID() });
}

export async function revokePublicLink(client: SupabaseClient, pageId: string): Promise<void> {
  await call(client, 'revoke_public_link', { p_page: pageId });
}

export function deletePublicLinkComments(client: SupabaseClient, linkId: string): Promise<number> {
  return call(client, 'delete_public_link_comments', { p_link: linkId });
}

/** El vencimiento elegido en *Share* (D30: *Never* por defecto). */
export type ExpiryChoice = 'never' | '1' | '7' | '30';

export function expiryFor(choice: ExpiryChoice, now = Date.now()): string | null {
  return choice === 'never' ? null : new Date(now + Number(choice) * 86_400_000).toISOString();
}
