import { fromBase64, toBase64 } from './lib/base64';
import type { WorkspaceConfig } from './workspace';

// El link de invitación (paso 9 de Docs/Plan_Workspaces.md): la dirección de la app y, después del `#`
// (esa parte no llega a ningún servidor), la dirección y la clave publicable del workspace, su clave local
// y la página o el proyecto al que va:  https://<app>/#invite=<base64url de {"u","k","l","p","n"}>.
// `n` (el nombre del workspace) es opcional y solo sirve para preguntar "Join <nombre> at <host>?": las
// versiones anteriores lo ignoran.

export interface InvitePayload {
  /** Dirección del Supabase del workspace. */
  u: string;
  /** Clave publicable. */
  k: string;
  /** Clave local (`workspace_settings.local_key`). */
  l: string;
  /** La página o el proyecto que se comparte; puede faltar (invitación sin permisos). */
  p?: string;
  /** Nombre del workspace (`workspace_settings.name`), para mostrarlo antes de unirse; puede faltar. */
  n?: string;
}

const PREFIX = '#invite=';
const TARGET_KEY = 'shotdocs-invite-target';

function base64url(text: string): string {
  return toBase64(new TextEncoder().encode(text)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(text: string): string {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  return new TextDecoder().decode(fromBase64(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
}

export function inviteLink(appOrigin: string, payload: InvitePayload): string {
  const clean: InvitePayload = { u: payload.u, k: payload.k, l: payload.l };
  if (payload.p) clean.p = payload.p;
  if (payload.n?.trim()) clean.n = payload.n.trim().slice(0, 80);
  return `${appOrigin.replace(/\/+$/, '')}/${PREFIX}${base64url(JSON.stringify(clean))}`;
}

/** Lee un link de invitación (la parte del `#`). `null` si no es uno o está roto. */
export function parseInviteHash(hash: string): InvitePayload | null {
  if (!hash.startsWith(PREFIX)) return null;
  try {
    const data = JSON.parse(fromBase64url(hash.slice(PREFIX.length))) as Partial<InvitePayload>;
    if (typeof data.u !== 'string' || typeof data.k !== 'string' || typeof data.l !== 'string') return null;
    if (!/^https:\/\//i.test(data.u) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(data.u)) return null;
    const p = typeof data.p === 'string' && /^[0-9a-f-]{36}$/i.test(data.p) ? data.p : undefined;
    const n = typeof data.n === 'string' && data.n.trim() ? data.n.trim().slice(0, 80) : undefined;
    return { u: data.u, k: data.k, l: data.l, ...(p ? { p } : {}), ...(n ? { n } : {}) };
  } catch {
    return null;
  }
}

function sameUrl(a: string, b: string): boolean {
  const norm = (x: string) => x.trim().replace(/\/+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

/** El link es del workspace con el que se compiló la app (misma dirección y misma clave local). */
export function isThisWorkspace(payload: InvitePayload, ws: WorkspaceConfig): boolean {
  return sameUrl(payload.u, ws.url) && payload.l === ws.localKey;
}

export type InviteArrival = { kind: 'this'; target: string | null };

let hashRead = false;

/**
 * Lee una sola vez, al abrir la app, el link de invitación de la dirección, y lo saca de ahí. `broken` si
 * la dirección traía `#invite=` pero no se pudo leer. Qué hacer con él lo decide la lista de workspaces
 * (`resolveInvite` en `src/workspaces.ts`).
 */
export function takeInviteHash(): { payload: InvitePayload | null; broken: boolean } {
  if (hashRead || typeof location === 'undefined') return { payload: null, broken: false };
  hashRead = true;
  if (!location.hash.startsWith(PREFIX)) return { payload: null, broken: false };
  const payload = parseInviteHash(location.hash);
  history.replaceState(history.state, '', location.pathname + location.search);
  return { payload, broken: !payload };
}

let arrival: InviteArrival | null = null;

/** Se entró con un link de invitación del workspace que se abre: la página se abre después de entrar. */
export function markInviteArrival(target: string | null): void {
  arrival = { kind: 'this', target };
  if (target) rememberInviteTarget(target);
}

/** Si esta apertura de la app vino por un link de invitación del workspace abierto. */
export function inviteArrival(): InviteArrival | null {
  return arrival;
}

let notice: string | null = null;

/** Un aviso sobre el link con que se abrió la app (roto, o de un workspace que no se pudo agregar). */
export function setArrivalNotice(text: string): void {
  notice = text;
}

/** El aviso del link, una sola vez (lo muestra el login o, con la sesión ya iniciada, la app). */
export function takeArrivalNotice(): string | null {
  const text = notice;
  notice = null;
  return text;
}

/** La página o el proyecto del link, para abrirlo después de entrar (sobrevive al link del correo). */
export function rememberInviteTarget(id: string): void {
  try {
    localStorage.setItem(TARGET_KEY, id);
  } catch {
    // Sin almacenamiento solo se pierde abrir la página sola.
  }
}

export function pendingInviteTarget(): string | null {
  try {
    return localStorage.getItem(TARGET_KEY);
  } catch {
    return null;
  }
}

export function clearInviteTarget(): void {
  try {
    localStorage.removeItem(TARGET_KEY);
  } catch {
    // Nada que limpiar.
  }
}

/** Copia un texto al portapapeles. `false` si el navegador no dejó (se muestra para copiarlo a mano). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copia un texto que todavía se está armando (el link sale recién cuando la base creó la invitación).
 * Safari solo deja escribir el portapapeles dentro del gesto de la persona: esto se llama en el mismo
 * toque, SIN esperar nada antes, y le pasa al portapapeles la promesa del texto
 * (`ClipboardItem` con una promesa). Donde no hay `ClipboardItem`, espera el texto y usa `writeText`.
 * `false` si no se pudo (o si el texto no llegó): se muestra el link para copiarlo a mano. Nunca rechaza.
 */
export function copyWhenReady(text: Promise<string>): Promise<boolean> {
  const fallback = () => text.then(copyText, () => false);
  try {
    if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function') {
      const blob = text.then((t) => new Blob([t], { type: 'text/plain' }));
      blob.catch(() => undefined);
      const item = new ClipboardItem({ 'text/plain': blob });
      return navigator.clipboard.write([item]).then(
        () => true,
        // Si el texto no llegó, no hay nada que copiar; si el navegador no dejó, se prueba `writeText`.
        () => text.then(() => fallback(), () => false),
      );
    }
  } catch {
    // Sigue con `writeText`.
  }
  return fallback();
}
