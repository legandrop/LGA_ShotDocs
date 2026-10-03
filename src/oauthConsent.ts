import { hostOf, type DeviceWorkspace, type WorkspaceList } from './workspaces';

// La pantalla de permiso de un asistente (MCP, Docs/Doc_Asistente.md, 9.2 y "Cómo quedó M0", paso 3): lo que no es
// interfaz. El servidor OAuth de Supabase manda a la persona a `<Site URL>/oauth/consent/<ref>?authorization_id=…`;
// la app pide los datos de ese pedido con la sesión del workspace de ese ref y la persona elige *Allow* o *Deny*.

/**
 * El workspace del dispositivo que corresponde al ref de la dirección: el de `https://<ref>.supabase.co` o, si el
 * Supabase tiene un dominio propio, el que tiene ese ref como clave local (Wanka: la clave local es su ref). Los
 * pendientes (agregados con "Create" sin terminar) no cuentan.
 */
export function workspaceForRef(list: WorkspaceList, projectRef: string): DeviceWorkspace | null {
  const ref = projectRef.toLowerCase();
  const usable = list.workspaces.filter((w) => !w.pending);
  return (
    usable.find((w) => hostOf(w.url).toLowerCase() === `${ref}.supabase.co`) ??
    usable.find((w) => w.localKey === ref) ??
    null
  );
}

/**
 * Adónde vuelve la persona después de elegir, para mostrarlo (O4 de M0): con el registro dinámico abierto, cualquiera
 * puede registrar un cliente llamado "Claude" con su propia dirección de vuelta. `host` es lo que se muestra
 * (`claude.ai`, `127.0.0.1:33418`, `cursor://anysphere.cursor-retrieval`); `local`, si vuelve a esta computadora.
 */
export interface RedirectTarget {
  host: string;
  local: boolean;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function redirectTarget(uri: string): RedirectTarget {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    // Una dirección que no se entiende se muestra tal cual (cortada): no se adorna.
    return { host: uri.length > 80 ? `${uri.slice(0, 79)}…` : uri, local: false };
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    return { host: url.host, local: LOCAL_HOSTS.has(url.hostname) };
  }
  // Un esquema propio de una app de escritorio (`cursor://…`, `com.ejemplo:/vuelta`): el esquema va siempre.
  return { host: url.host ? `${url.protocol}//${url.host}` : url.protocol, local: false };
}

/** Los permisos pedidos (`scope`, separados por espacios), sin repetir. */
export function scopeList(scope: string | null | undefined): string[] {
  return [...new Set((scope ?? '').split(/\s+/).filter(Boolean))];
}

export type ConsentErrorKind = 'missing' | 'expired' | 'disabled' | 'offline' | 'session' | 'other';

/** Un error de Supabase Auth (o de la red) al pedir los datos o al contestar. */
export interface ConsentError {
  name?: string;
  message?: string;
  status?: number;
  code?: string;
}

/**
 * Qué pasó, para elegir el mensaje. El detalle completo va a la consola (`[oauth-consent]`).
 * - `session`: no hay sesión guardada (vencida sin poder renovar): se pide entrar con el código.
 * - `offline`: la red.
 * - `disabled`: el servidor OAuth de ese Supabase está apagado.
 * - `expired`: la autorización no existe, venció o ya se contestó (400/404). También es el 400 de
 *   `supabase/auth#2820` (clientes públicos, `offline_access`, `resource`): el detalle de la consola lo distingue.
 */
export function consentErrorKind(error: ConsentError): ConsentErrorKind {
  if (error.name === 'AuthSessionMissingError') return 'session';
  if (error.name === 'AuthRetryableFetchError' || /failed to fetch|networkerror|load failed/i.test(error.message ?? '')) {
    return 'offline';
  }
  if (error.code === 'feature_disabled' || /oauth server is disabled/i.test(error.message ?? '')) return 'disabled';
  if (error.status === 400 || error.status === 404 || error.status === 410) return 'expired';
  return 'other';
}

/** El detalle que se muestra chico debajo del mensaje: el estado y el código, sin el texto del servidor. */
export function consentErrorDetail(error: ConsentError): string {
  return [error.status, error.code].filter((x) => x !== undefined && x !== null && x !== '').join(' · ');
}

/** El `authorization_id` de la dirección: letras, números, `-` y `_` (Supabase usa un id opaco). */
export function authorizationIdFrom(search: string): string | null {
  const id = new URLSearchParams(search).get('authorization_id')?.trim() ?? '';
  return /^[A-Za-z0-9_-]{1,200}$/.test(id) ? id : null;
}

// Esquemas que nunca son la vuelta de un cliente: correrían algo en la app o abrirían algo local. Supabase no deja
// registrarlos, pero la app no navega a ellos aunque el servidor los mande (defensa de más).
const UNSAFE_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'blob:', 'file:', 'about:']);

/** Si se puede volver a esa dirección: se entiende y no es uno de los esquemas de arriba. */
export function safeRedirect(url: string): boolean {
  try {
    return !UNSAFE_SCHEMES.has(new URL(url.trim()).protocol.toLowerCase());
  } catch {
    return false;
  }
}
