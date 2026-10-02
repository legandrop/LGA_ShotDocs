import { useEffect, useState } from 'react';
import { useT, type Key } from '../i18n';
import '../i18n/lazy/assistant';
import { usePermissions, useServices, useSyncStatus, type Services } from '../services';
import { fetchPolicy, savePolicy, type AssistantPolicy } from './policy';

// La política del workspace sobre el asistente (Docs/Doc_Asistente.md, 7.3; IA7; entrega A2): en los ajustes del
// asistente, solo para el dueño y los admins. *On*, *Local models only* u *Off*. Se guarda al elegir, en la base
// (`set_assistant_policy`, que vuelve a mirar el rol); sin red no se puede cambiar. Es una regla de la app, no una
// barrera: la ventana lo dice.

const OPTIONS: { value: AssistantPolicy; label: Key; hint: Key }[] = [
  { value: 'on', label: 'assistant.policy.on', hint: 'assistant.policy.onHint' },
  { value: 'local_only', label: 'assistant.policy.local', hint: 'assistant.policy.localHint' },
  { value: 'off', label: 'assistant.policy.off', hint: 'assistant.policy.offHint' },
];

/** Sin el árbol, los permisos o el motor (algunas pruebas arman los servicios a mano), no se muestra. */
export function WorkspacePolicy() {
  const s = useServices() as Partial<Services>;
  return s.tree && s.access && s.engine && s.workspace ? <PolicySection /> : null;
}

function PolicySection() {
  const { client, workspace } = useServices();
  const perms = usePermissions();
  const status = useSyncStatus();
  const tr = useT();
  const key = workspace.config.localKey || workspace.config.url;
  const [policy, setPolicy] = useState<AssistantPolicy | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const allowed = perms.canManageMembers;

  useEffect(() => {
    if (!allowed) return;
    let live = true;
    void fetchPolicy(client, key).then((p) => live && setPolicy(p));
    return () => {
      live = false;
    };
  }, [allowed, client, key]);

  if (!allowed) return null;

  const choose = async (next: AssistantPolicy) => {
    if (next === policy || busy) return;
    setBusy(true);
    setMessage(null);
    const result = await savePolicy(client, key, next);
    setBusy(false);
    if (result === 'ok') {
      setPolicy(next);
      setMessage({ ok: true, text: tr('assistant.policy.saved') });
    } else {
      setMessage({ ok: false, text: tr(result === 'denied' ? 'assistant.policy.denied' : result === 'missing' ? 'assistant.policy.missing' : 'assistant.policy.failed') });
    }
  };

  const disabled = busy || policy === null || !status.online;
  return (
    <section className="assistant-policy" aria-labelledby="assistant-policy-title">
      <h3 id="assistant-policy-title" className="pref-label">
        {tr('assistant.policy.title', { name: workspace.config.name || '' })}
      </h3>
      <p className="muted assistant-small">{tr('assistant.policy.text')}</p>
      <div role="radiogroup" aria-labelledby="assistant-policy-title" className="assistant-policy-options">
        {OPTIONS.map((o) => (
          <label key={o.value} className={`assistant-policy-option${policy === o.value ? ' on' : ''}`}>
            <input type="radio" name="assistant-policy" value={o.value} checked={policy === o.value} disabled={disabled} onChange={() => void choose(o.value)} />
            <span>
              <strong>{tr(o.label)}</strong>
              <span className="muted assistant-small">{tr(o.hint)}</span>
            </span>
          </label>
        ))}
      </div>
      {!status.online && <p className="muted assistant-small">{tr('assistant.policy.offline')}</p>}
      {message && (
        <p className={message.ok ? 'assistant-ok' : 'assistant-error'} role="status">
          {message.text}
        </p>
      )}
    </section>
  );
}
