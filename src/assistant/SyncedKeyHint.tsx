import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import '../i18n/lazy/assistant';
import { useServices, type Services } from '../services';
import { openAssistantSettings } from './assistantUi';
import { loadSettings, syncFor } from './keyStore';
import { fetchSyncMeta, type KeySyncClient } from './keySyncRemote';
import { ProviderError } from './providers';

// El botón que suma el error *Key doesn't work* (401) cuando la persona tiene en este workspace una copia sincronizada
// más nueva que la de este dispositivo (Docs/Doc_Clave_Sincronizada.md, sección 7; S2): *Enter your passphrase to
// update it here* abre los ajustes del asistente, donde la sección de sincronizar pide la frase. Si el dispositivo nunca
// abrió la copia, ofrece abrirla. Solo con red; con cualquier error (sin la tabla, sin red), no muestra nada.

/** Si un error del proveedor es el de la clave que no sirve (para pasarle al botón sin guardar el error entero). */
export const isKeyRejected = (err: unknown) => err instanceof ProviderError && err.kind === 'auth';

export function SyncedKeyHint({ show }: { show: boolean }) {
  const s = useServices() as Partial<Services>;
  const tr = useT();
  const [offer, setOffer] = useState<'update' | 'unlock' | null>(null);
  const client = s.client;
  const user = s.user;
  const ref = s.workspace ? s.workspace.config.localKey || s.workspace.config.url : '';

  useEffect(() => {
    setOffer(null);
    if (!show || !client || !user?.id || !ref || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    let live = true;
    void Promise.all([fetchSyncMeta(client as unknown as KeySyncClient, user.id), loadSettings(user.email)])
      .then(([meta, saved]) => {
        if (!live || !meta) return;
        const entry = syncFor(saved, ref, user.id);
        if (!entry) setOffer('unlock');
        else if (meta.generation > entry.generation) setOffer('update');
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [show, client, user?.id, user?.email, ref]);

  if (!show || !offer) return null;
  return (
    <button type="button" onClick={openAssistantSettings}>
      {tr(offer === 'update' ? 'assistant.sync.updateHere' : 'assistant.unlockSynced')}
    </button>
  );
}
