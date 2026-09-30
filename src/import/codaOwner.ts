import { useEffect, useState } from 'react';
import type { AuthUser } from '../auth';
import { useServices } from '../services';

// "Importar de Coda" es solo para la cuenta de Lega: es una herramienta suya, no una función de la app.
// Nadie más ve la entrada del selector de proyectos ni puede abrir el diálogo (Docs/Doc_Importar_Coda.md).
//
// El repositorio es público, así que su correo no aparece en ningún lado: acá va el SHA-256 (en hex) del
// correo en minúsculas y sin espacios alrededor, y se compara con el del usuario que inició sesión. Para
// cambiar de cuenta, calcular el hash del correo nuevo con
//   node -e "console.log(require('crypto').createHash('sha256').update('<correo>').digest('hex'))"
// y reemplazar la constante.
export const CODA_OWNER_HASH = 'ada321779ab8bd586715dc3498230680824013d1fdb30684e21687ec6f49bd5f';

/** SHA-256 (hex) del correo normalizado (sin espacios alrededor, en minúsculas), con Web Crypto. */
export async function emailHash(email: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.trim().toLowerCase()));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

let allowedHash = CODA_OWNER_HASH;
let hashOf: (email: string) => Promise<string> = emailHash;
// Una vez por usuario (por su id): el hash es asíncrono y no cambia mientras dura la sesión.
const pending = new Map<string, Promise<boolean>>();
const known = new Map<string, boolean>();

/** Si ese usuario es la cuenta de Lega. Sin Web Crypto (una página sin HTTPS) nadie lo es. */
export function isCodaOwner(user: AuthUser): Promise<boolean> {
  let check = pending.get(user.id);
  if (!check) {
    check = (async () => (user.email ? (await hashOf(user.email)) === allowedHash : false))().catch(() => false);
    pending.set(user.id, check);
    void check.then((ok) => known.set(user.id, ok));
  }
  return check;
}

/**
 * Si el usuario que inició sesión es la cuenta de Lega. Hasta que el hash se resuelve (la primera vez, un
 * instante) da `false`: la entrada del menú aparece cuando se sabe.
 */
export function useCodaOwner(): boolean {
  const { user } = useServices();
  const [, redraw] = useState(0);
  const ok = known.get(user.id);
  useEffect(() => {
    if (ok !== undefined) return;
    let live = true;
    void isCodaOwner(user).then(() => live && redraw((n) => n + 1));
    return () => {
      live = false;
    };
  }, [user, ok]);
  return ok ?? false;
}

/**
 * Solo para las pruebas: otro hash permitido (y, si hace falta, otra función de hash), así el correo real
 * no aparece en ellas. Sin argumentos vuelve a lo de siempre. Olvida lo ya calculado.
 */
export function setCodaOwnerForTests(options: { hash?: string; hashOf?: (email: string) => Promise<string> } = {}): void {
  allowedHash = options.hash ?? CODA_OWNER_HASH;
  hashOf = options.hashOf ?? emailHash;
  pending.clear();
  known.clear();
}
