import { cachedPolicyValue, rememberPolicyValue } from './policyCache';
import { isLocalProvider, type ProviderConfig } from './providers';

// La política del workspace sobre el asistente (Docs/Doc_Asistente.md, 7.3; IA7): `workspace_settings.assistant_policy`
// (migración 20261014120000_asistente_politica.sql), `on` de fábrica, `local_only` o `off`. En la app es una regla, no
// una barrera (quien lee una página la puede copiar a mano a cualquier lado). Se lee al abrir el asistente y se
// recuerda por workspace para usarla sin red. El dueño y los admins la cambian en los ajustes del asistente (A2,
// WorkspacePolicy.tsx), con la función de la base `set_assistant_policy`.

export type AssistantPolicy = 'on' | 'local_only' | 'off';

export function parsePolicy(value: unknown): AssistantPolicy {
  return value === 'off' || value === 'local_only' ? value : 'on';
}

function cached(workspaceKey: string): AssistantPolicy | null {
  const v = cachedPolicyValue(workspaceKey);
  return v ? parsePolicy(v) : null;
}

function remember(workspaceKey: string, policy: AssistantPolicy): void {
  rememberPolicyValue(workspaceKey, policy);
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

interface RpcClient {
  rpc: (fn: 'set_assistant_policy', args: { p_policy: AssistantPolicy }) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
}

export type SaveResult = 'ok' | 'denied' | 'missing' | 'error';

/**
 * Cambia la política (entrega A2, dueño y admins): `set_assistant_policy` de la migración
 * 20261017120000_asistente_politica_ventana.sql. `denied` si la base dice que no (no es dueño ni admin), `missing` si
 * la base del workspace todavía no tiene la función. Si sale bien, queda recordada en este dispositivo.
 */
export async function savePolicy(client: unknown, workspaceKey: string, policy: AssistantPolicy): Promise<SaveResult> {
  const c = client as Partial<RpcClient> | null;
  if (!c?.rpc) return 'error';
  try {
    const { error } = await c.rpc('set_assistant_policy', { p_policy: policy });
    if (error) {
      if (error.code === '42501') return 'denied';
      if (error.code === 'PGRST202' || error.code === '42883') return 'missing';
      return 'error';
    }
    remember(workspaceKey, policy);
    return 'ok';
  } catch {
    return 'error';
  }
}

/** Si la política deja usar estos ajustes: `off` nada; `local_only` solo un modelo local. */
export function policyAllows(policy: AssistantPolicy, config: Pick<ProviderConfig, 'provider' | 'baseUrl'>): boolean {
  if (policy === 'off') return false;
  if (policy === 'local_only') return isLocalProvider(config);
  return true;
}
