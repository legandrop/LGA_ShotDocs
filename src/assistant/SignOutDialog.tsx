import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { closeSignOut } from './assistantUi';
import { forgetKey, loadSettings } from './keyStore';

/**
 * Salir de la cuenta con una clave del asistente guardada en este dispositivo (Docs/Doc_Asistente.md, sección 4): la
 * casilla *Also forget my assistant key on this device* va destildada (pensada para la computadora propia). En una
 * computadora compartida hay que tildarla: si no, quien se siente después con las herramientas del navegador abiertas
 * puede usar la clave.
 */
export function SignOutDialog({ email, run }: { email: string; run: () => Promise<unknown> }) {
  const tr = useT();
  const [forget, setForget] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Si la clave vino de una copia sincronizada (o se subió a una): la ayuda de la casilla lo suma. */
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    let live = true;
    void loadSettings(email)
      .then((s) => live && setSynced(!!s?.sync))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [email]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeSignOut();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const confirm = async () => {
    setBusy(true);
    try {
      if (forget) await forgetKey(email).catch(() => undefined);
      await run();
    } finally {
      setBusy(false);
      closeSignOut();
    }
  };

  return (
    <div className="modal-backdrop" onClick={closeSignOut}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={tr('common.signOut')} onClick={(e) => e.stopPropagation()}>
        <h2>{tr('common.signOut')}</h2>
        <label className="folder-check">
          <input type="checkbox" checked={forget} onChange={(e) => setForget(e.target.checked)} /> {tr('account.forgetAssistantKey')}
        </label>
        <p className="muted small">
          {tr('account.forgetAssistantKeyHint')}
          {synced && <> {tr('account.forgetAssistantKeySynced')}</>}
        </p>
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
