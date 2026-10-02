import { isLocalProvider, type ProviderConfig } from './providers';

// La política del workspace sobre el asistente (Docs/Doc_Asistente.md, 7.3; IA7): `workspace_settings.assistant_policy`
// (migración 20261014120000_asistente_politica.sql), `on` de fábrica, `local_only` o `off`. En la app es una regla, no
// una barrera (quien lee una página la puede copiar a mano a cualquier lado). La ventana para cambiarla es de A2; acá
// solo se lee. Se lee al abrir el asistente y se recuerda por workspace para usarla sin red.

export type AssistantPolicy = 'on' | 'local_only' | 'off';

const CACHE_PREFIX = 'shotdocs-assistant-policy:';

export function parsePolicy(value: unknown): AssistantPolicy {
  return value === 'off' || value === 'local_only' ? value : 'on';
}

function cached(workspaceKey: string): AssistantPolicy | null {
  try {
    const v = localStorage.getItem(CACHE_PREFIX + workspaceKey);
    return v ? parsePolicy(v) : null;
  } catch {
    return null;
  }
}

function remember(workspaceKey: string, policy: AssistantPolicy): void {
  try {
    localStorage.setItem(CACHE_PREFIX + workspaceKey, policy);
  } catch {
    // Sin almacenamiento: se vuelve a preguntar la próxima vez.
  }
}

interface SettingsClient {
  from: (table: 'workspace_settings') => { select: (cols: string) => { maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }> } };
}

/**
 * La política del workspace: la de la base si contesta (en 4 s), si no la última que se supo en este dispositivo, y si
 * nunca se supo, `on` (lo de fábrica; una base sin la columna también da `on`).
 */
export async function fetchPolicy(client: unknown, workspaceKey: string, timeoutMs = 4000): Promise<AssistantPolicy> {
  const c = client as Partial<SettingsClient> | null;
  if (!c?.from) return cached(workspaceKey) ?? 'on';
  try {
    const query = c.from('workspace_settings').select('*').maybeSingle();
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
    const res = await Promise.race([Promise.resolve(query), timeout]);
    if (!res || res.error) return cached(workspaceKey) ?? 'on';
    const policy = parsePolicy((res.data as { assistant_policy?: unknown } | null)?.assistant_policy);
    remember(workspaceKey, policy);
    return policy;
  } catch {
    return cached(workspaceKey) ?? 'on';
  }
}

/** Si la política deja usar estos ajustes: `off` nada; `local_only` solo un modelo local. */
export function policyAllows(policy: AssistantPolicy, config: Pick<ProviderConfig, 'provider' | 'baseUrl'>): boolean {
  if (policy === 'off') return false;
  if (policy === 'local_only') return isLocalProvider(config);
  return true;
}
