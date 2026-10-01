import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { t, useT } from '../i18n';
import { AppIcon, InstallIcon } from './icons';
import {
  bannerDue,
  closeInstallDialog,
  detectPlatform,
  isMobilePlatform,
  openInstallDialog,
  promptInstall,
  readBannerStamp,
  snoozeBanner,
  useInstallDialogOpen,
  useInstallState,
} from './install';
import { InstallDialog } from './lazyDialogs';
import { Part } from './lazyPart';
import { notify } from './notice';

// Instalar la app (Docs/Doc_Instalar.md): la ventana con los pasos (una sola, la abra quien la abra) y el aviso
// del teléfono, que nunca es obligatorio y con "Not now" no vuelve por un mes.

/** Dibuja la ventana de pasos cuando alguien la pidió (`openInstallDialog`). */
export function InstallHost() {
  const open = useInstallDialogOpen();
  if (!open) return null;
  return createPortal(
    <Part onClose={closeInstallDialog}>
      <InstallDialog onClose={closeInstallDialog} />
    </Part>,
    document.body,
  );
}

/** "Install": si el navegador ofreció instalar, lo hace directo; si no (el iPhone), muestra los pasos. */
export async function installOrExplain(canPrompt: boolean): Promise<void> {
  if (!canPrompt) return openInstallDialog();
  const outcome = await promptInstall();
  if (outcome === 'accepted') notify(t('install.installed'));
  else if (outcome === 'unavailable') openInstallDialog();
}

/**
 * El aviso de arriba en el teléfono y la tableta (iPhone, iPad, Android) mientras la app no está instalada.
 * Va abajo de la barra de arriba y se va con el resto al desplazar: no tapa nada.
 */
export function InstallBanner() {
  const tr = useT();
  const { installed, canPrompt } = useInstallState();
  const platform = useMemo(() => detectPlatform(), []);
  const [due, setDue] = useState(() => bannerDue(readBannerStamp()));
  if (installed || !due || !isMobilePlatform(platform)) return null;
  return (
    <aside className="install-banner" aria-label={tr('install.banner.title')}>
      <AppIcon size={30} />
      <div className="install-banner-text">
        <strong>{tr('install.banner.title')}</strong>
        <span>{tr('install.banner.text')}</span>
      </div>
      <div className="install-banner-actions">
        <button className="primary" onClick={() => void installOrExplain(canPrompt)}>
          <InstallIcon size={15} />
          {tr('install.banner.install')}
        </button>
        <button
          className="link"
          onClick={() => {
            snoozeBanner();
            setDue(false);
          }}
        >
          {tr('install.banner.notNow')}
        </button>
      </div>
    </aside>
  );
}
