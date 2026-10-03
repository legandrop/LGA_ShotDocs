import { fromBase64, toBase64 } from './lib/base64';
import { publicLinkUrl, type LinkPayload } from './linkMode';
import { validLocalKey, validPublishableKey, workspaceOrigin } from './workspaces';

// La dirección fija de un archivo (P.30, Docs/Doc_Links_PDF.md, sección 2): la que lleva cada tarjeta y cada video del
// PDF. `https://<app>/f/<clave local>/<id>#ws=<base64url de {"u","k","l"}>`: el camino dice qué workspace (su clave
// local) y qué archivo; después del `#` (que no llega a ningún servidor ni al `Referer`) van la dirección y la clave
// publicable del Supabase de ese workspace, como en una invitación pero sin nombre ni página. Con un link público, el
// `#` es el del link (`#link=…`, Doc_Link_Publico.md 3.1) y la dirección abre en el modo link.

export interface WorkspacePayload {
  /** Dirección del Supabase del workspace. */
  u: string;
  /** Clave publicable (pública por diseño: ya va en cada invitación). */
  k: string;
  /** Clave local (`workspace_settings.local_key`). */
  l: string;
}

const PREFIX = '#ws=';

function base64url(text: string): string {
  return toBase64(new TextEncoder().encode(text)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(text: string): string {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  return new TextDecoder().decode(fromBase64(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
}

/** El camino de la dirección de un archivo. */
export function filePath(localKey: string, fileId: string): string {
  return `/f/${localKey}/${fileId.toLowerCase()}`;
}

/** La parte del `#` de un workspace. */
export function workspaceHash(payload: WorkspacePayload): string {
  const clean: WorkspacePayload = { u: payload.u, k: payload.k, l: payload.l };
  return `${PREFIX}${base64url(JSON.stringify(clean))}`;
}

/** La parte del `#` de un link público (la misma que copia *Share*). */
export function linkHash(payload: LinkPayload): string {
  const url = publicLinkUrl('', payload);
  return url.slice(url.indexOf('#'));
}

/** La dirección entera de un archivo, con el `#` de su workspace o de su link. */
export function fileHref(appOrigin: string, localKey: string, fileId: string, hash: string): string {
  return `${appOrigin.replace(/\/+$/, '')}${filePath(localKey, fileId)}${hash}`;
}

/** Lee la parte `#ws=`. `null` si no es una o está rota (dirección, clave publicable y clave local con su forma). */
export function parseWorkspaceHash(hash: string, allowLocalHttp?: boolean): WorkspacePayload | null {
  if (!hash.startsWith(PREFIX)) return null;
  try {
    const data = JSON.parse(fromBase64url(hash.slice(PREFIX.length))) as Partial<WorkspacePayload>;
    if (typeof data.u !== 'string' || typeof data.k !== 'string' || typeof data.l !== 'string') return null;
    const url = workspaceOrigin(data.u, allowLocalHttp);
    if (!url || !validPublishableKey(data.k.trim()) || !validLocalKey(data.l)) return null;
    return { u: url, k: data.k.trim(), l: data.l };
  } catch {
    return null;
  }
}

let hashRead = false;

/**
 * Lee una sola vez, al abrir la app, el `#ws=` de la dirección y lo saca de la barra (`history.replaceState`).
 * `broken`: traía `#ws=` y no se pudo leer.
 */
export function takeWorkspaceHash(): { payload: WorkspacePayload | null; broken: boolean } {
  if (hashRead || typeof location === 'undefined') return { payload: null, broken: false };
  hashRead = true;
  if (!location.hash.startsWith(PREFIX)) return { payload: null, broken: false };
  const payload = parseWorkspaceHash(location.hash);
  history.replaceState(history.state, '', location.pathname + location.search);
  return { payload, broken: !payload };
}

/** Las pruebas vuelven a leer la dirección. */
export function resetWorkspaceHashForTests(): void {
  hashRead = false;
}
