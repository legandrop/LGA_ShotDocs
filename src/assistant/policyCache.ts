// La última política del asistente que se supo de cada workspace, en este dispositivo (policy.ts la escribe al leerla
// de la base). Va aparte y en la primera carga porque el botón *Dictate* del teléfono (dictado, DictationHost.tsx) la
// mira para no mostrarse con el asistente apagado, sin bajar los proveedores.

const CACHE_PREFIX = 'shotdocs-assistant-policy:';

/** La política recordada para ese workspace (`on`, `local_only`, `off`), o `null` si nunca se supo. */
export function cachedPolicyValue(workspaceKey: string): string | null {
  try {
    return localStorage.getItem(CACHE_PREFIX + workspaceKey);
  } catch {
    return null;
  }
}

export function rememberPolicyValue(workspaceKey: string, policy: string): void {
  try {
    localStorage.setItem(CACHE_PREFIX + workspaceKey, policy);
  } catch {
    // Sin almacenamiento: se vuelve a preguntar la próxima vez.
  }
}
