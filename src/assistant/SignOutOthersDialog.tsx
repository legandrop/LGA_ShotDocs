import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { closeSignOutOthers } from './assistantUi';

/**
 * *Sign out other devices* (menú de la cuenta; Docs/Doc_Clave_Sincronizada.md, sección 3 y entrega S1): revoca las
 * otras sesiones de la persona en este workspace (`signOut({ scope: 'others' })`), para un dispositivo perdido. Esta
 * sesión sigue. Un dispositivo que ya está abierto puede seguir hasta que venza su token (una hora de fábrica): la
 * ventana lo dice. No depende del asistente.
 */
export function SignOutOthersDialog({ workspace, run }: { workspace: string; run: () => Promise<{ error: unknown }> }) {
  const tr = useT();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<'done' | 'failed' | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeSignOutOthers();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const confirm = async () => {
    setBusy(true);
    try {
      const { error } = await run();
      setResult(error ? 'failed' : 'done');
    } catch {
      setResult('failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={closeSignOutOthers}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={tr('account.signOutOthers')} onClick={(e) => e.stopPropagation()}>
        <h2>{tr('account.signOutOthers')}</h2>
        {result === 'done' ? (
          <p role="status">{tr('account.signOutOthersDone')}</p>
        ) : (
          <>
            <p>{tr('account.signOutOthersText', { workspace })}</p>
            {result === 'failed' && (
              <p className="error" role="status">
                {tr('account.signOutOthersFailed')}
              </p>
            )}
          </>
        )}
        <div className="modal-actions">
          {result === 'done' ? (
            <button className="primary" autoFocus onClick={closeSignOutOthers}>
              {tr('common.close')}
            </button>
          ) : (
            <>
              <button className="link" onClick={closeSignOutOthers}>
                {tr('common.cancel')}
              </button>
              <button className="primary" autoFocus disabled={busy} onClick={() => void confirm()}>
                {tr('account.signOutOthersButton')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
