import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { t, useT, type Key } from '../i18n';
import '../i18n/lazy/install';
import { AppIcon, InstallIcon } from './icons';
import { detectPlatform, promptInstall, tabFor, useInstallState, type InstallPlatform, type InstallTab } from './install';
import { notify } from './notice';
import './installDialog.css';

// La ventana con los pasos para instalar la app (Docs/Doc_Instalar.md). Abre en la pestaña del dispositivo y
// muestra también las otras. Cada paso lleva un dibujo propio del botón o la opción que hay que tocar (no son
// capturas: no dependen del idioma ni del tema del teléfono). Se baja aparte (lazyPart).

const TABS: InstallTab[] = ['iphone', 'android', 'computer'];
const TAB_LABEL: Record<InstallTab, Key> = {
  iphone: 'installDialog.tab.iphone',
  android: 'installDialog.tab.android',
  computer: 'installDialog.tab.computer',
};

/** El texto con lo que va entre `**` en negrita (los nombres de botones y opciones). */
function Marked({ text }: { text: string }) {
  const parts = text.split('**');
  return <>{parts.map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part))}</>;
}

export function InstallDialog({ onClose }: { onClose: () => void }) {
  const tr = useT();
  const platform = useMemo(() => detectPlatform(), []);
  const here = tabFor(platform);
  const [tab, setTab] = useState<InstallTab>(here);
  const { installed, canPrompt } = useInstallState();
  const tabRefs = useRef(new Map<InstallTab, HTMLButtonElement>());

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function install() {
    const outcome = await promptInstall();
    if (outcome === 'accepted') {
      notify(t('install.installed'));
      onClose();
    }
  }

  // Las flechas pasan de pestaña (como en cualquier lista de pestañas).
  function onTabKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const at = TABS.indexOf(tab);
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (at + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    setTab(TABS[next]);
    tabRefs.current.get(TABS[next])?.focus();
  }

  return (
    <div className="modal-backdrop install-backdrop" onClick={onClose}>
      <div
        className="modal install-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="install-head">
          <AppIcon size={36} />
          <h2 id="install-title">{tr('installDialog.title')}</h2>
        </div>
        <div className="install-body">
          <p className="install-why">{tr('installDialog.why')}</p>
          <p className="muted install-optional">{tr('installDialog.optional')}</p>
          {installed ? (
            <p className="install-box">{tr('install.installed')}</p>
          ) : (
            canPrompt && (
              <div className="install-box install-direct">
                <span>{tr('installDialog.direct')}</span>
                <button className="primary" autoFocus onClick={() => void install()}>
                  <InstallIcon size={16} />
                  {tr('installDialog.install')}
                </button>
              </div>
            )
          )}
          <div className="segmented install-tabs" role="tablist" aria-label={tr('installDialog.tabs')} onKeyDown={onTabKey}>
            {TABS.map((name) => (
              <button
                key={name}
                ref={(el) => {
                  if (el) tabRefs.current.set(name, el);
                  else tabRefs.current.delete(name);
                }}
                id={`install-tab-${name}`}
                role="tab"
                type="button"
                aria-selected={tab === name}
                aria-controls="install-panel"
                tabIndex={tab === name ? 0 : -1}
                autoFocus={!canPrompt && tab === name}
                onClick={() => setTab(name)}
              >
                {tr(TAB_LABEL[name])}
                {name === here && <span className="install-here-dot" aria-hidden="true" />}
              </button>
            ))}
          </div>
          <div id="install-panel" role="tabpanel" aria-labelledby={`install-tab-${tab}`} className="install-panel">
            {tab === here && <p className="mono-label install-here">{tr('installDialog.thisDevice')}</p>}
            {tab === 'iphone' && <IphoneSteps platform={platform} />}
            {tab === 'android' && <AndroidSteps platform={platform} />}
            {tab === 'computer' && <ComputerSteps platform={platform} />}
            <p className="muted install-words">{tr('installDialog.words')}</p>
          </div>
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>{tr('common.close')}</button>
        </div>
      </div>
    </div>
  );
}

/** Un paso: el dibujo, lo que hay que hacer y, si hace falta, una aclaración. */
interface StepDef {
  fig: ReactNode;
  text: Key;
  note?: Key;
}

function Steps({ steps }: { steps: StepDef[] }) {
  const tr = useT();
  return (
    <ol className="install-steps">
      {steps.map((step, i) => (
        <li key={step.text} className="install-step">
          <div className="install-fig" aria-hidden="true">
            {step.fig}
          </div>
          <div className="install-step-text">
            <p className="install-step-main">
              <span className="install-num" aria-hidden="true">
                {i + 1}
              </span>
              <span>
                <Marked text={tr(step.text)} />
              </span>
            </p>
            {step.note && (
              <p className="install-note">
                <Marked text={tr(step.note)} />
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function IphoneSteps({ platform }: { platform: InstallPlatform }) {
  const tr = useT();
  return (
    <>
      {platform === 'ios-inapp' && <InAppNotice text={'installDialog.ios.inApp'} />}
      {platform === 'ios-browser' && (
        <p className="install-box">
          <Marked text={tr('installDialog.ios.otherBrowser')} />
        </p>
      )}
      <Steps
        steps={[
          { fig: <FigIosShare />, text: 'installDialog.ios.share', note: 'installDialog.ios.shareNote' },
          { fig: <FigIosAdd />, text: 'installDialog.ios.add', note: 'installDialog.ios.addNote' },
          { fig: <FigIosConfirm />, text: 'installDialog.ios.confirm', note: 'installDialog.ios.confirmNote' },
          { fig: <FigHome />, text: 'installDialog.ios.open', note: 'installDialog.ios.openNote' },
        ]}
      />
    </>
  );
}

/** Un navegador adentro de otra app: no instala. Se explica cómo pasar a Safari o a Chrome, con el link para copiar. */
function InAppNotice({ text }: { text: Key }) {
  const tr = useT();
  const [copied, setCopied] = useState(false);
  const url = typeof location === 'undefined' ? '' : `${location.origin}/`;
  return (
    <div className="install-box install-warn">
      <p>
        <Marked text={tr(text)} />
      </p>
      <div className="install-link">
        <code>{url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</code>
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard
              ?.writeText(url)
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
          }
        >
          {copied ? tr('installDialog.linkCopied') : tr('installDialog.copyLink')}
        </button>
      </div>
    </div>
  );
}

function AndroidSteps({ platform }: { platform: InstallPlatform }) {
  const tr = useT();
  return (
    <>
      {platform === 'android-inapp' && <InAppNotice text={'installDialog.android.inApp'} />}
      <Steps
        steps={[
          { fig: <FigAndroidMenu />, text: 'installDialog.android.menu', note: 'installDialog.android.menuNote' },
          { fig: <FigAndroidInstall />, text: 'installDialog.android.install', note: 'installDialog.android.installNote' },
          { fig: <FigConfirm label={'installDialog.ui.installApp'} button={'installDialog.install'} />, text: 'installDialog.android.confirm' },
          { fig: <FigHome />, text: 'installDialog.android.open', note: 'installDialog.android.openNote' },
        ]}
      />
      <p className="install-note install-other">
        <Marked text={tr('installDialog.android.other')} />
      </p>
    </>
  );
}

function ComputerSteps({ platform }: { platform: InstallPlatform }) {
  const tr = useT();
  const chrome = (
    <section key="chrome" className="install-group">
      <h3>{tr('installDialog.pc.chrome')}</h3>
      <Steps
        steps={[
          { fig: <FigPcAddressBar />, text: 'installDialog.pc.icon', note: 'installDialog.pc.iconNote' },
          {
            fig: <FigConfirm label={'installDialog.ui.installApp'} button={'installDialog.install'} />,
            text: 'installDialog.pc.confirm',
            note: 'installDialog.pc.confirmNote',
          },
        ]}
      />
    </section>
  );
  const safari = (
    <section key="safari" className="install-group">
      <h3>{tr('installDialog.pc.safari')}</h3>
      <Steps
        steps={[
          { fig: <FigMacFile />, text: 'installDialog.mac.dock', note: 'installDialog.mac.dockNote' },
          {
            fig: <FigConfirm label={'installDialog.ui.addDock'} button={'installDialog.ui.add'} />,
            text: 'installDialog.mac.confirm',
            note: 'installDialog.mac.confirmNote',
          },
        ]}
      />
    </section>
  );
  const firefox = (
    <p key="firefox" className={platform === 'desktop-other' ? 'install-box' : 'install-note install-other'}>
      {tr('installDialog.pc.firefox')}
    </p>
  );
  // Primero lo del navegador que se está usando.
  if (platform === 'mac-safari') return <>{[safari, chrome, firefox]}</>;
  if (platform === 'desktop-other') return <>{[firefox, chrome, safari]}</>;
  return <>{[chrome, safari, firefox]}</>;
}

// --- Los dibujos ----------------------------------------------------------------------------------------
// Imitan el botón o la opción del sistema, con lo que hay que tocar marcado (`hl`). Grilla de 20 px como los
// íconos de la app.

function Glyph({ d, size = 16, fill = false }: { d: string; size?: number; fill?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill={fill ? 'currentColor' : 'none'}
      stroke={fill ? 'none' : 'currentColor'}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

const SHARE = 'M7.25 8H5.75a1 1 0 0 0-1 1v7.25a1 1 0 0 0 1 1h8.5a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1h-1.5M10 2.75v9.5M7 5.5l3-2.75 3 2.75';
const BACK = 'M12 4.5L6.5 10l5.5 5.5';
const FORWARD = 'M8 4.5l5.5 5.5L8 15.5';
const BOOK = 'M3 4.75c2.5-.8 5-.5 7 1 2-1.5 4.5-1.8 7-1v10.5c-2.5-.8-5-.5-7 1-2-1.5-4.5-1.8-7-1zM10 5.75v10.5';
const TABS_GLYPH = 'M6.75 3.5h8.75a1 1 0 0 1 1 1v8.75M4 6.25h8.75a1 1 0 0 1 1 1V16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7.25a1 1 0 0 1 1-1z';
const ADD_SQUARE =
  'M4.75 3.25h10.5a1.5 1.5 0 0 1 1.5 1.5v10.5a1.5 1.5 0 0 1-1.5 1.5H4.75a1.5 1.5 0 0 1-1.5-1.5V4.75a1.5 1.5 0 0 1 1.5-1.5zM10 6.75v6.5M6.75 10h6.5';
const COPY = 'M7 7h8.5v9.5H7zM4.5 13V3.5H13';
const MORE = 'M4.5 8.6a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8zm5.5 0a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8zm5.5 0a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z';
const KEBAB = 'M10 3a1.6 1.6 0 1 1 0 3.2A1.6 1.6 0 0 1 10 3zm0 5.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2zm0 5.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z';
const INSTALL_PC = 'M3 4h14v9.75H3zM7.25 16.75h5.5M10 6.25v4.75M8 9l2 2 2-2';
const STAR = 'M10 3.25l2 4.3 4.6.5-3.45 3.1 1 4.6L10 13.4l-4.15 2.35 1-4.6L3.4 8.05 8 7.55z';
const LOCK = 'M6 9h8v7H6zM7.5 9V7a2.5 2.5 0 0 1 5 0v2';

function Url() {
  return (
    <span className="fig-url">
      <Glyph d={LOCK} size={9} />
      <span className="fig-url-text">shotdocs.lega.com.ar</span>
    </span>
  );
}

/**
 * Safari del iPhone, las dos barras: la compacta de iOS 26 (Compartir está adentro de "⋯", marcado) y la de antes
 * (Compartir abajo, marcado).
 */
function FigIosShare() {
  return (
    <div className="fig fig-ios fig-ios-two">
      <span className="fig-version">iOS 26</span>
      <div className="fig-pill compact">
        <Glyph d={BACK} size={13} />
        <Url />
        <span className="hl round small">
          <Glyph d={MORE} fill size={13} />
        </span>
      </div>
      <span className="fig-version">iOS 18</span>
      <div className="fig-toolbar">
        <Glyph d={BACK} />
        <Glyph d={FORWARD} />
        <span className="hl round">
          <Glyph d={SHARE} />
        </span>
        <Glyph d={BOOK} />
        <Glyph d={TABS_GLYPH} />
      </div>
    </div>
  );
}

/** La lista de Compartir, con "Agregar a pantalla de inicio" marcado. */
function FigIosAdd() {
  const tr = useT();
  return (
    <div className="fig fig-list">
      <div className="fig-row faint">
        <span className="fig-bar" />
        <Glyph d={COPY} size={13} />
      </div>
      <div className="fig-row hl">
        <span className="fig-text">{tr('installDialog.ui.addHome')}</span>
        <Glyph d={ADD_SQUARE} size={13} />
      </div>
      <div className="fig-row faint">
        <span className="fig-bar short" />
        <Glyph d={STAR} size={13} />
      </div>
    </div>
  );
}

/** La ventana de agregar del iPhone: Cancelar, Agregar (marcado) y el interruptor de app web. */
function FigIosConfirm() {
  const tr = useT();
  return (
    <div className="fig fig-list">
      <div className="fig-head">
        <span className="fig-ios-link">{tr('installDialog.ui.cancel')}</span>
        <span className="fig-ios-link strong hl">{tr('installDialog.ui.add')}</span>
      </div>
      <div className="fig-app">
        <AppIcon size={18} />
        <span className="fig-text">Shot Docs</span>
      </div>
      <div className="fig-row">
        <span className="fig-text">{tr('installDialog.ui.webApp')}</span>
        <span className="fig-switch" />
      </div>
    </div>
  );
}

/** La pantalla de inicio, con el ícono de Shot Docs marcado. */
function FigHome() {
  return (
    <div className="fig fig-home">
      <span className="fig-tile" />
      <span className="fig-tile" />
      <span className="fig-tile" />
      <span className="fig-tile" />
      <span className="fig-tile-app hl">
        <AppIcon size={26} />
        <span>Shot Docs</span>
      </span>
      <span className="fig-tile" />
    </div>
  );
}

/** La barra de arriba de Chrome en Android, con el menú ⋮ marcado. */
function FigAndroidMenu() {
  return (
    <div className="fig fig-chrome">
      <div className="fig-addr">
        <Url />
        <span className="hl round">
          <Glyph d={KEBAB} fill />
        </span>
      </div>
      <div className="fig-page">
        <span className="fig-bar" />
        <span className="fig-bar short" />
      </div>
    </div>
  );
}

/** El menú de Chrome en Android, con "Instalar app" marcado. */
function FigAndroidInstall() {
  const tr = useT();
  return (
    <div className="fig fig-list">
      <div className="fig-row faint">
        <span className="fig-bar" />
      </div>
      <div className="fig-row hl left">
        <InstallIcon size={13} />
        <span className="fig-text">{tr('installDialog.ui.installApp')}</span>
      </div>
      <div className="fig-row faint">
        <span className="fig-bar short" />
      </div>
    </div>
  );
}

/** La ventana de confirmar del navegador, con el botón marcado. */
function FigConfirm({ label, button }: { label: Key; button: Key }) {
  const tr = useT();
  return (
    <div className="fig fig-dialog">
      <span className="fig-title">{tr(label)}</span>
      <div className="fig-app">
        <AppIcon size={18} />
        <span className="fig-text">Shot Docs</span>
      </div>
      <div className="fig-buttons">
        <span className="fig-button">{tr('installDialog.ui.cancel')}</span>
        <span className="fig-button primary hl">{tr(button)}</span>
      </div>
    </div>
  );
}

/** La barra de la dirección de Chrome o Edge en la computadora, con el ícono de instalar marcado. */
function FigPcAddressBar() {
  return (
    <div className="fig fig-chrome">
      <div className="fig-addr">
        <Url />
        <span className="hl round">
          <Glyph d={INSTALL_PC} size={14} />
        </span>
        <Glyph d={STAR} size={13} />
      </div>
      <div className="fig-page">
        <span className="fig-bar" />
        <span className="fig-bar short" />
      </div>
    </div>
  );
}

/** El menú Archivo de Safari en la Mac, con "Agregar al Dock" marcado. */
function FigMacFile() {
  const tr = useT();
  return (
    <div className="fig fig-list fig-mac">
      <div className="fig-menubar">
        <span className="fig-text strong">Safari</span>
        <span className="fig-text strong open">{tr('installDialog.ui.file')}</span>
      </div>
      <div className="fig-row faint">
        <span className="fig-bar" />
      </div>
      <div className="fig-row hl">
        <span className="fig-text">{tr('installDialog.ui.addDock')}</span>
      </div>
    </div>
  );
}
