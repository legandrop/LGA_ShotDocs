import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import '../i18n/lazy/dictation';
import { useServices, useSyncStatus } from '../services';
import { MicIcon } from '../ui/icons';
import { errorText } from '../assistant/errorText';
import { loadSettings, type AssistantSettings } from '../assistant/keyStore';
import { fetchPolicy, policyAllows } from '../assistant/policy';
import { PROVIDER_NAMES } from '../assistant/providers';
import { canRecord, NoteRecorder } from './recorder';
import { transcribe } from './transcribe';
import { isLocalVoice, readVoiceKey, resolveVoice } from './voiceSettings';
import { VoiceSettingsDialog } from './VoiceSettingsDialog';
import './dictation.css';

// El micrófono chico en *Ask…* del asistente (Docs/Doc_Dictado.md, 6; entrega V3): dictar el pedido en vez de
// escribirlo. Graba en memoria (un pedido no es una nota del reporte: sin red no hay asistente, así que no va a la cola),
// lo transcribe con el proveedor de *Voice* y lo suma al campo, para revisarlo antes de mandarlo.

export function AskMic({ disabled, onText }: { disabled: boolean; onText: (text: string) => void }) {
  const { user, client, workspace } = useServices();
  const online = useSyncStatus().online;
  const tr = useT();
  const workspaceKey = workspace.config.localKey || workspace.config.url;
  const [state, setState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [message, setMessage] = useState('');
  const [settingsFor, setSettingsFor] = useState<AssistantSettings | null | undefined>(undefined);
  const rec = useRef<NoteRecorder | null>(null);

  useEffect(() => () => void rec.current?.stop('cut'), []);
  if (!canRecord()) return null;

  const finish = async (r: NoteRecorder) => {
    rec.current = null;
    setState('transcribing');
    const result = await r.stop('user');
    try {
      const config = await resolveVoice(user.email);
      if (!config || result.data.size === 0) return setMessage(tr('dictation.nothingRecorded'));
      if (!policyAllows(await fetchPolicy(client, workspaceKey), config)) return setMessage(tr('dictation.voicePolicy'));
      // La clave se descifra recién acá y queda solo en esta llamada.
      const out = await transcribe(config, await readVoiceKey(user.email, config), { data: result.data, mime: result.mime }, []);
      if (!out.text) return setMessage(tr('dictation.nothingHeard'));
      onText(out.text);
      setMessage('');
    } catch (err) {
      const config = await resolveVoice(user.email).catch(() => null);
      setMessage(errorText(err, config ? PROVIDER_NAMES[config.provider] : '', tr));
    } finally {
      setState('idle');
    }
  };

  const toggle = async () => {
    if (rec.current) return void finish(rec.current);
    setMessage('');
    const config = await resolveVoice(user.email);
    // Sin cómo transcribir, abre *Voice*.
    if (!config) return setSettingsFor((await loadSettings(user.email).catch(() => null)) ?? null);
    if (!online && !isLocalVoice(config)) return setMessage(tr('dictation.recordedOffline'));
    const r = new NoteRecorder({
      store: null,
      onState: (s, error) => {
        if (s === 'error') {
          rec.current = null;
          setState('idle');
          setMessage(tr(error === 'denied' ? 'dictation.micDenied' : error === 'noMic' ? 'dictation.micNone' : 'dictation.micFailed'));
        }
      },
      onAutoStop: () => {
        if (rec.current === r) void finish(r);
      },
    });
    rec.current = r;
    setState('recording');
    await r.start();
  };

  return (
    <>
      <button
        type="button"
        className={`icon-button ask-mic${state === 'recording' ? ' on' : ''}`}
        aria-pressed={state === 'recording'}
        aria-label={tr(state === 'recording' ? 'dictation.askMicStop' : 'dictation.askMic')}
        disabled={(disabled && state === 'idle') || state === 'transcribing'}
        onClick={() => void toggle()}
      >
        <MicIcon size={18} />
      </button>
      {(message || state !== 'idle') && (
        <span className="ask-mic-status muted" role="status">
          {state === 'recording' ? tr('dictation.askMicStop') : state === 'transcribing' ? tr('dictation.transcribing') : message}
        </span>
      )}
      {settingsFor !== undefined && <VoiceSettingsDialog email={user.email} assistant={settingsFor} onClose={() => setSettingsFor(undefined)} />}
    </>
  );
}
