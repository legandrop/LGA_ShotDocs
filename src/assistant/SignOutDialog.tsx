import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { discardVoiceNotes, voiceLeftovers } from '../dictation/leftovers';
import { forgetVoiceKey } from '../dictation/voiceSettings';
import './assistant.css';
import { closeSignOut } from './assistantUi';
import { forgetKey, loadSettings } from './keyStore';

/**
 * Salir de la cuenta con algo del asistente o del dictado guardado en este dispositivo (Docs/Doc_Asistente.md, sección
 * 4; Doc_Dictado.md, 8):
 * - La casilla *Also forget my assistant key on this device* va destildada (pensada para la computadora propia). En una
 *   computadora compartida hay que tildarla: si no, quien se siente después con las herramientas del navegador abiertas
 *   puede usar la clave. Tildada, olvida también la segunda clave de *Voice*.
 * - Si quedan notas de voz sin ubicar, lo dice con el número y ofrece borrarlas con otra casilla destildada. Si no se
 *   tilda, quedan para cuando vuelva a entrar ese correo.
 */
export function SignOutDialog({ email, workspace, run }: { email: string; workspace?: string; run: () => Promise<unknown> }) {
  const tr = useT();
  const [forget, setForget] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Si la clave vino de una copia sincronizada (o se subió a una): la ayuda de la casilla lo suma. */
  const [synced, setSynced] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [left, setLeft] = useState({ notes: 0, voiceKey: false });

  useEffect(() => {
    let live = true;
    void loadSettings(email)
      .then((s) => {
        if (!live) return;
        setSynced(!!s?.sync);
        setHasKey(!!s);
      })
      .catch(() => undefined);
    void voiceLeftovers(email, workspace ?? '')
      .then((l) => live && setLeft(l))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [email, workspace]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeSignOut();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const confirm = async () => {
    setBusy(true);
    try {
      if (forget) {
        await forgetKey(email).catch(() => undefined);
        await forgetVoiceKey(email).catch(() => undefined);
      }
      if (discard && workspace) await discardVoiceNotes(email, workspace).catch(() => undefined);
      await run();
    } finally {
      setBusy(false);
      closeSignOut();
    }
  };

  const keys = hasKey || left.voiceKey;
  return (
    <div className="modal-backdrop" onClick={closeSignOut}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={tr('common.signOut')} onClick={(e) => e.stopPropagation()}>
        <h2>{tr('common.signOut')}</h2>
        {keys && (
          <>
            <label className="folder-check">
              <input type="checkbox" checked={forget} onChange={(e) => setForget(e.target.checked)} /> {tr('account.forgetAssistantKey')}
            </label>
            <p className="muted small">
              {tr('account.forgetAssistantKeyHint')}
              {left.voiceKey && <> {tr('account.forgetVoiceKeyToo')}</>}
              {synced && <> {tr('account.forgetAssistantKeySynced')}</>}
            </p>
          </>
        )}
        {left.notes > 0 && workspace && (
          <>
            <p className="signout-notes">{tr('account.voiceNotesLeft', { count: left.notes })}</p>
            <label className="folder-check">
              <input type="checkbox" checked={discard} onChange={(e) => setDiscard(e.target.checked)} /> {tr('account.discardVoiceNotes')}
            </label>
          </>
        )}
        <div className="modal-actions">
          <button className="link" onClick={closeSignOut}>
            {tr('common.cancel')}
          </button>
          <button className="primary" autoFocus disabled={busy} onClick={() => void confirm()}>
            {tr('common.signOut')}
          </button>
        </div>
      </div>
    </div>
  );
}
