import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import '../i18n/lazy/assistant';
import { useServices } from '../services';
import { errorText } from './errorText';
import { closeAssistantSettings } from './assistantUi';
import { forgetKey, forgetTabKey, loadSettings, readKey, sameDestination, saveSettings, type AssistantSettings as Saved } from './keyStore';
import { KeySyncSection } from './KeySyncSection';
import { defaultModel, listModels, PROVIDER_NAMES, PROVIDERS, SPEND_LIMIT_URLS, type ModelInfo, type ProviderId } from './providers';
import { WorkspacePolicy } from './WorkspacePolicy';
import './assistant.css';

// Los ajustes del asistente (Docs/Doc_Asistente.md, sección 11; menú de la cuenta → *Assistant…*): el proveedor, la
// clave (que queda solo en este dispositivo, keyStore.ts), la dirección de un proveedor compatible, el modelo de la
// lista que da el proveedor, *Test* y *Forget key*. La clave escrita vive solo en el campo mientras la ventana está
// abierta; al guardar se cifra y el campo se vacía.

/** El host de una dirección (`openrouter.ai`, `127.0.0.1:11434`), o `''` si todavía no es una dirección. */
function hostOf(url: string): string {
  try {
    return new URL(url.trim()).host;
  } catch {
    return '';
  }
}

export function AssistantSettings() {
  const { user } = useServices();
  const tr = useT();
  const [saved, setSaved] = useState<Saved | null | undefined>(undefined);
  const [provider, setProvider] = useState<ProviderId>('anthropic');
  const [baseUrl, setBaseUrl] = useState('');
  const [key, setKey] = useState('');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLSelectElement>(null);

  /** Lo guardado cambió (al abrir, o al abrir una copia sincronizada): el formulario muestra lo de ahora. */
  const showSaved = (s: Saved | null) => {
    setSaved(s);
    if (s) {
      setProvider(s.provider);
      setBaseUrl(s.baseUrl ?? '');
      setModel(s.model);
      setModels(s.models);
    }
  };

  useEffect(() => {
    let live = true;
    void loadSettings(user.email)
      .then((s) => live && showSaved(s))
      .catch(() => live && setSaved(null));
    return () => {
      live = false;
    };
  }, [user.email]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeAssistantSettings();
    document.addEventListener('keydown', onKey);
    first.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const name = PROVIDER_NAMES[provider];
  // La guardada vale solo para el mismo proveedor y, en uno compatible, la misma dirección: si cambia la Base URL, el
  // campo queda vacío, *Test* no la usa y *Save* no la conserva (keyStore.ts, sameDestination).
  const sameProvider = !!saved && sameDestination(saved, { provider, baseUrl });
  /** A quién va la clave, para el aviso: en uno compatible, el host de la dirección. */
  const destination = provider === 'compatible' ? hostOf(baseUrl) || name : name;
  /** La clave que se usa para *Test*: la escrita, o la guardada si es del mismo proveedor y la misma dirección. */
  const keyForTest = async () => (key.trim() ? key.trim() : sameProvider && saved?.hasKey ? await readKey(user.email, { provider, baseUrl }) : '');
  const needsKey = provider !== 'compatible';

  const changeProvider = (next: ProviderId) => {
    setProvider(next);
    setMessage(null);
    if (next === saved?.provider) {
      setModel(saved.model);
      setModels(saved.models);
    } else {
      setModel('');
      setModels([]);
    }
  };

  const test = async (): Promise<ModelInfo[] | null> => {
    setBusy(true);
    setMessage(null);
    try {
      const k = await keyForTest();
      if (needsKey && !k) {
        setMessage({ ok: false, text: tr('assistant.settings.needKey', { provider: name }) });
        return null;
      }
      if (provider === 'compatible' && !baseUrl.trim()) {
        setMessage({ ok: false, text: tr('assistant.settings.needUrl') });
        return null;
      }
      const list = await listModels({ provider, baseUrl, model }, k);
      setModels(list);
      if (!model || !list.some((m) => m.id === model)) setModel(defaultModel(provider, list));
      setMessage({ ok: true, text: tr('assistant.settings.works') });
      return list;
    } catch (err) {
      setMessage({ ok: false, text: errorText(err, name, tr) });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (needsKey && !key.trim() && !(sameProvider && saved?.hasKey)) {
      setMessage({ ok: false, text: tr('assistant.settings.needKey', { provider: name }) });
      return;
    }
    if (provider === 'compatible' && !baseUrl.trim()) {
      setMessage({ ok: false, text: tr('assistant.settings.needUrl') });
      return;
    }
    let chosen = model.trim();
    let list = models;
    if (!chosen) {
      // Sin modelo elegido, se pide la lista (que además prueba la clave) y se preelige uno.
      const got = await test();
      if (!got) return;
      list = got;
      chosen = defaultModel(provider, got);
    }
    if (!chosen) {
      setMessage({ ok: false, text: tr('assistant.settings.needModel') });
      return;
    }
    setBusy(true);
    try {
      const next = await saveSettings(user.email, { provider, baseUrl, model: chosen, models: list }, key.trim() ? key.trim() : sameProvider ? undefined : '');
      setSaved(next);
      setKey('');
      closeAssistantSettings();
    } catch {
      setMessage({ ok: false, text: tr('assistant.settings.notSaved') });
    } finally {
      setBusy(false);
    }
  };

  const forget = async () => {
    setBusy(true);
    try {
      // Abierta solo en esta pestaña (computadora prestada): se olvida la de la pestaña y nada más; si el dispositivo
      // tenía una guardada de antes, vuelve a verse (Doc_Clave_Sincronizada.md, "Cómo quedó S2").
      if (saved?.tabOnly && forgetTabKey(user.email)) {
        const stored = await loadSettings(user.email).catch(() => null);
        setKey('');
        if (stored) showSaved(stored);
        else {
          setSaved(null);
          setModel('');
          setModels([]);
        }
        setMessage({ ok: true, text: tr(stored ? 'assistant.sync.forgotTabKeepsSaved' : 'assistant.settings.forgotten') });
        return;
      }
      await forgetKey(user.email);
      setSaved(null);
      setKey('');
      setModel('');
      setModels([]);
      setMessage({ ok: true, text: tr('assistant.settings.forgotten') });
    } finally {
      setBusy(false);
    }
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setKey(text.trim());
    } catch {
      setMessage({ ok: false, text: tr('assistant.settings.pasteFailed') });
    }
  };

  const limitUrl = SPEND_LIMIT_URLS[provider];

  return (
    <div className="modal-backdrop" onClick={closeAssistantSettings}>
      <div className="modal assistant-settings" role="dialog" aria-modal="true" aria-label={tr('assistant.settings')} onClick={(e) => e.stopPropagation()}>
        <h2>{tr('assistant.settings')}</h2>
        {saved === undefined ? null : (
          <>
            <label className="assistant-field">
              <span className="pref-label">{tr('assistant.settings.provider')}</span>
              <select ref={first} value={provider} onChange={(e) => changeProvider(e.target.value as ProviderId)}>
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {PROVIDER_NAMES[p]}
                  </option>
                ))}
              </select>
            </label>
            {provider === 'compatible' && (
              <label className="assistant-field">
                <span className="pref-label">{tr('assistant.settings.baseUrl')}</span>
                <input type="url" value={baseUrl} placeholder="https://openrouter.ai/api/v1" spellCheck={false} onChange={(e) => setBaseUrl(e.target.value)} />
                <span className="muted assistant-small">{tr('assistant.settings.baseUrlHint')}</span>
              </label>
            )}
            <div className="assistant-field">
              <label className="pref-label" htmlFor="assistant-key">
                {tr('assistant.settings.key')}
              </label>
              <div className="assistant-row">
                <input
                  id="assistant-key"
                  type="password"
                  value={key}
                  autoComplete="new-password"
                  data-1p-ignore=""
                  data-lpignore="true"
                  spellCheck={false}
                  placeholder={sameProvider && saved?.hasKey ? tr('assistant.settings.keySaved') : provider === 'compatible' ? tr('assistant.settings.keyOptional') : ''}
                  onChange={(e) => setKey(e.target.value)}
                />
                <button type="button" onClick={() => void paste()}>
                  {tr('assistant.settings.paste')}
                </button>
              </div>
            </div>
            <label className="assistant-field">
              <span className="pref-label">{tr('assistant.settings.model')}</span>
              <input type="text" list="assistant-models" value={model} spellCheck={false} placeholder={tr('assistant.settings.modelHint')} onChange={(e) => setModel(e.target.value)} />
              <datalist id="assistant-models">
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </datalist>
            </label>
            <p className="muted assistant-small">
              {saved?.sync && sameProvider
                ? tr('assistant.settings.staysSynced', { provider: destination, workspace: saved.sync.name || saved.sync.ref })
                : tr('assistant.settings.stays', { provider: destination })}{' '}
              {limitUrl && (
                <a href={limitUrl} target="_blank" rel="noopener noreferrer">
                  {tr('assistant.settings.limit')}
                </a>
              )}
            </p>
            {provider === 'gemini' && <p className="assistant-warning">{tr('assistant.settings.geminiFree')}</p>}
            {message && (
              <p className={message.ok ? 'assistant-ok' : 'assistant-error'} role="status">
                {message.text}
              </p>
            )}
            <div className="modal-actions">
              {saved && (
                <button className="link danger" disabled={busy} onClick={() => void forget()}>
                  {tr('assistant.settings.forget')}
                </button>
              )}
              <button disabled={busy} onClick={() => void test()}>
                {tr('assistant.settings.test')}
              </button>
              <button className="primary" disabled={busy} onClick={() => void save()}>
                {tr('assistant.settings.save')}
              </button>
            </div>
            {/* La clave en todos los dispositivos, cifrada con una frase (Docs/Doc_Clave_Sincronizada.md, S1). */}
            <KeySyncSection saved={saved} onSaved={showSaved} />
          </>
        )}
        {/* La política del workspace (A2): solo el dueño y los admins la ven; se guarda al elegir. */}
        <WorkspacePolicy />
      </div>
    </div>
  );
}
