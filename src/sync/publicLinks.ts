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
  usage_today: Partial<Record<'open' | 'pull' | 'pass' | 'comment' | 'push' | 'file' | 'upload', LinkUsage>>;
  /** Llegó a un tope del día. */
  limited: boolean;
  /** Comentarios vivos escritos con el link. */
  comments: number;
  /**
   * Lo que escribió el link (Can edit, versión 19 de la base): cuánto espera en la sala, cuánto está retenido (el link
   * dejó de editar esa página por algo que puede volver), cuánto se apartó y cuánto entró hoy. Sin la versión 19, no está.
   */
  edits?: { waiting: number; held: number; aside: number; admitted_today: number; push_bytes_total: number };
  /** Los archivos que registró el link y cuánto pesan, de por vida (entrega 2b, versión 21). Sin la 21, no está. */
  files?: { total: number; bytes: number; drive_bytes?: number };
}

/** Desde cuánto subido al Drive por un link *Share* avisa (E2.10: 1 GB). */
export const LINK_DRIVE_WARN_BYTES = 1024 * 1024 * 1024;

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

/** Un archivo que subió un link de la página (`public_link_files`, versión 21; decisión de Lega del 2026-10-03). */
export interface PublicLinkFile {
  id: string;
  link_id: string;
  /** Su link sigue vivo (si no, es de uno anterior, reseteado o revocado). */
  link_live: boolean;
  /** La página donde se registró. */
  page_id: string | null;
  name: string;
  mime: string;
  size: number;
  created_at: string;
  /** Llegó al Drive del dueño (si no, quedó en el navegador del visitante). */
  uploaded: boolean;
  /** Está en la papelera de archivos (alguien del equipo lo sacó de su página). */
  trashed: boolean;
}

/**
 * Cuántos archivos devuelve `public_link_files` como mucho (el `limit 500` de la migración 20261030120000). Si llegan tantos
 * y la base no dice el total (anterior a la 25), el total de verdad puede ser mayor: quien muestra la cantidad dice «o
 * más» (O-R3 de la re-verificación de la entrega 2b).
 */
export const PUBLIC_LINK_FILES_MAX = 500;

/** La lista (hasta `PUBLIC_LINK_FILES_MAX`) y cuántos son en total; `total` es `null` con una base anterior a la 25. */
export interface PublicLinkFiles {
  rows: PublicLinkFile[];
  total: number | null;
}

/**
 * Los archivos que subieron los links de la página, también los anteriores. `page_not_found` si no ve lo borrado. Desde
 * la versión 25 de la base (20261103120000_purgados_peso_link_total.sql) cada fila trae `total`, la cantidad de todos
 * aunque la lista se corte (D279 B); sin esa columna, `total` queda en `null`.
 */
export async function getPublicLinkFiles(client: SupabaseClient, pageId: string): Promise<PublicLinkFiles> {
  const list = (await call<Record<string, unknown>[] | null>(client, 'public_link_files', { p_page: pageId })) ?? [];
  const first = list[0]?.total;
  const total = first == null || !Number.isFinite(Number(first)) ? null : Math.max(Number(first), list.length);
  const rows = list.map((r) => ({
    id: String(r.id),
    link_id: String(r.link_id),
    link_live: r.link_live === true,
    page_id: r.page_id == null ? null : String(r.page_id),
    name: typeof r.name === 'string' ? r.name : '',
    mime: typeof r.mime === 'string' ? r.mime : '',
    size: Number(r.size) || 0,
    created_at: String(r.created_at),
    uploaded: r.uploaded === true,
    trashed: r.trashed === true,
  }));
  return { rows, total: rows.length === 0 ? 0 : total };
}

/** `null` si la sesión no puede compartir la página. */
export function getPublicLink(client: SupabaseClient, pageId: string): Promise<PublicLinkInfo | null> {
  return call(client, 'get_public_link', { p_page: pageId });
}

/** El nivel de un link: *Can view* (que comenta) o *Can edit* (entrega 2a, con su interruptor). */
export type LinkLevel = 'comment' | 'edit';

/** Lo que el ícono del árbol dice de un link: nunca el token. */
export interface LinkPageMark {
  level: LinkLevel;
  /** Quién creó el link (la parte del correo antes de la @), o `null` si su cuenta ya no está. */
  createdBy: string | null;
  /** Anda hoy. Uno que no anda sin haber vencido: quien lo creó ya no puede compartir la página. */
  alive: boolean;
}

/**
 * Una página de `public_link_pages`. Con `mark`, la base ya decidió (20261107120000_link_paginas_quien_comparte.sql):
 * lista solo lo que la sesión puede compartir y dice lo que muestra el ícono. Solo el id (un texto): una base anterior,
 * que lista lo que la sesión **ve**; ahí el id solo dice dónde mirar y cada página se confirma con `get_public_link`,
 * que contesta solo a quien puede compartirla.
 */
export type ListedLinkPage = string | { pageId: string; mark: LinkPageMark };

/** Las páginas con un link vivo propio (`public_link_pages`), como las da la base de este workspace. */
export async function getPublicLinkPages(client: SupabaseClient): Promise<ListedLinkPage[]> {
  const rows = (await call<Record<string, unknown>[] | null>(client, 'public_link_pages', {})) ?? [];
  return rows.map((r) => {
    const pageId = String(r.page_id);
    // Sin la columna del nivel, la base es anterior a la migración: solo el id.
    if (typeof r.level !== 'string') return pageId;
    const createdBy = typeof r.created_by_name === 'string' && r.created_by_name ? r.created_by_name : null;
    return { pageId, mark: { level: r.level === 'edit' ? 'edit' : 'comment', createdBy, alive: r.alive !== false } };
  });
}

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
