import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import '../i18n/lazy/dictation';
import { errorText } from '../assistant/errorText';
import type { AssistantSettings } from '../assistant/keyStore';
import { listModels, PROVIDER_NAMES } from '../assistant/providers';
import {
  assistantTranscribes,
  DEFAULT_VOICE_MODEL,
  forgetVoiceKey,
  loadVoiceSettings,
  readVoiceKey,
  saveVoiceSettings,
  VOICE_PROVIDERS,
  type VoiceConfig,
  type VoiceProviderId,
} from './voiceSettings';

// La ventana *Voice* (Docs/Doc_Dictado.md, 7; entrega V3): con qué se transcribe el micrófono de *Dictate to report*.
// La del asistente si su proveedor transcribe, u otra clave solo para la voz (la única opción si el asistente usa
// Anthropic, que no recibe audio). La clave se guarda cifrada en el dispositivo y nunca se muestra.

export function VoiceSettingsDialog({ email, assistant, onClose }: { email: string; assistant: AssistantSettings | null; onClose: () => void }) {
  const tr = useT();
  const canShare = assistantTranscribes(assistant) && (assistant.hasKey || assistant.provider === 'compatible');
  const [loaded, setLoaded] = useState(false);
  const [source, setSource] = useState<'assistant' | 'own'>(canShare ? 'assistant' : 'own');
  const [provider, setProvider] = useState<VoiceProviderId>('openai');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    let live = true;
    void loadVoiceSettings(email).then((v) => {
      if (!live) return;
      if (v) {
        setSource(v.source === 'assistant' && !canShare ? 'own' : v.source);
        if (v.source === 'own') {
          setProvider(v.provider);
          setBaseUrl(v.baseUrl ?? '');
          setHasKey(v.hasKey);
        }
        setModel(v.model);
      }
      setLoaded(true);
    });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    document.addEventListener('keydown', onKey);
    return () => {
      live = false;
      document.removeEventListener('keydown', onKey);
    };
  }, [email, canShare]);

  const shared = source === 'assistant' && canShare;
  const active: VoiceProviderId = shared ? (assistant!.provider as VoiceProviderId) : provider;
  const modelValue = model || DEFAULT_VOICE_MODEL[active];
  const config: VoiceConfig = shared
    ? { provider: active, baseUrl: assistant!.baseUrl, model: modelValue, source: 'assistant' }
    : { provider, baseUrl: provider === 'compatible' ? baseUrl.trim() : undefined, model: modelValue, source: 'own' };

  /** *Test*: la lista de modelos del proveedor con esa clave (no transcribe nada ni cuesta). */
  const test = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const k = !shared && key.trim() ? key.trim() : await readVoiceKey(email, config);
      await listModels({ provider: config.provider, baseUrl: config.baseUrl, model: config.model }, k);
      setStatus({ ok: true, text: tr('dictation.voice.works') });
    } catch (err) {
      setStatus({ ok: false, text: errorText(err, PROVIDER_NAMES[config.provider], tr) });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      await saveVoiceSettings(email, { source: shared ? 'assistant' : 'own', provider: active, baseUrl: config.baseUrl, model: modelValue }, !shared && key.trim() ? key.trim() : undefined);
      onClose();
    } catch (err) {
      console.error('Dictado: no se pudieron guardar los ajustes de voz', err);
      setStatus({ ok: false, text: tr('dictation.voice.saveFailed') });
    } finally {
      setBusy(false);
    }
  };

  const forget = async () => {
    await forgetVoiceKey(email).catch(() => undefined);
    setHasKey(false);
    setKey('');
    setStatus({ ok: true, text: tr('dictation.voice.forgotten') });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal voice-settings" role="dialog" aria-modal="true" aria-label={tr('dictation.voice.title')} onClick={(e) => e.stopPropagation()}>
        <h2>{tr('dictation.voice.title')}</h2>
        <p className="muted small">{tr('dictation.voice.intro')}</p>
        {loaded && (
          <>
            <label className="folder-check">
              <input type="radio" name="voice-source" checked={shared} disabled={!canShare} onChange={() => setSource('assistant')} />{' '}
              {canShare ? tr('dictation.voice.sameKey', { provider: PROVIDER_NAMES[assistant!.provider] }) : tr('dictation.voice.sameKeyNo')}
            </label>
            <label className="folder-check">
              <input type="radio" name="voice-source" checked={!shared} onChange={() => setSource('own')} /> {tr('dictation.voice.ownKey')}
            </label>
            {!shared && (
              <div className="voice-own">
                <label>
                  {tr('dictation.voice.provider')}
                  <select
                    value={provider}
                    onChange={(e) => {
                      setProvider(e.target.value as VoiceProviderId);
                      setModel('');
                      setStatus(null);
                    }}
                  >
                    {VOICE_PROVIDERS.map((p) => (
                      <option key={p} value={p}>
                        {PROVIDER_NAMES[p]}
                      </option>
                    ))}
                  </select>
                </label>
                {provider === 'compatible' && (
                  <label>
                    {tr('dictation.voice.baseUrl')}
                    <input type="url" value={baseUrl} placeholder="https://api.groq.com/openai/v1" onChange={(e) => setBaseUrl(e.target.value)} />
                  </label>
                )}
                <label>
                  {tr('dictation.voice.key')}
                  <input type="password" autoComplete="off" value={key} placeholder={hasKey ? tr('dictation.voice.keySaved') : ''} onChange={(e) => setKey(e.target.value)} />
                </label>
              </div>
            )}
            <label className="voice-model">
              {tr('dictation.voice.model')}
              <input type="text" value={model} placeholder={DEFAULT_VOICE_MODEL[active]} onChange={(e) => setModel(e.target.value)} />
            </label>
            {active === 'gemini' && <p className="assistant-warning small">{tr('dictation.voice.geminiFree')}</p>}
            {status && (
              <p className={status.ok ? 'assistant-ok small' : 'assistant-error small'} role="status">
                {status.text}
              </p>
            )}
          </>
        )}
        <div className="modal-actions">
          {!shared && hasKey && (
            <button className="link danger" onClick={() => void forget()}>
              {tr('dictation.voice.forget')}
            </button>
          )}
          <button disabled={busy || !loaded} onClick={() => void test()}>
            {tr('dictation.voice.test')}
          </button>
          <button className="link" onClick={onClose}>
            {tr('common.cancel')}
          </button>
          <button className="primary" disabled={busy || !loaded || (!shared && !key.trim() && !hasKey && provider !== 'compatible')} onClick={() => void save()}>
            {tr('dictation.voice.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
