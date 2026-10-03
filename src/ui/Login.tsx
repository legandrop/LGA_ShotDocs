import { useState, type FormEvent } from 'react';
import { t, useT } from '../i18n';
import { inviteArrival, takeArrivalNotice } from '../invite';
import { useWorkspace } from '../workspace';
import { useRoute } from '../router';
import { AppIcon, ArrowLeftIcon, ArrowRightIcon, MailIcon, SlateBand } from './icons';
import { LegalLinks } from './Legal';
import { openInstallDialog, useInstallState } from './install';
import { InstallHost } from './InstallBanner';
import { LoginWorkspaceBar } from './Welcome';

type Step = { name: 'email' } | { name: 'sent'; email: string };

function explain(error: { message: string; code?: string; status?: number }): string {
  if (error.code === 'over_email_send_rate_limit' || error.status === 429) {
    return t('login.error.rateLimit');
  }
  // El registro está cerrado: solo entran cuentas que ya existen (invitadas por el dueño).
  if (error.code === 'signup_disabled' || error.code === 'otp_disabled' || /signups? not allowed/i.test(error.message)) {
    return t('login.error.noAccount');
  }
  if (error.code === 'email_address_not_authorized') {
    return t('login.error.testSmtp');
  }
  if (error.code === 'otp_expired' || /expired|invalid/i.test(error.message)) {
    return t('login.error.code');
  }
  if (/fetch/i.test(error.message)) return t('login.error.offline');
  return error.message;
}

/**
 * `consent`: el login de la pantalla de permiso de un asistente (MCP): un aviso arriba del correo, el link del correo
 * vuelve a esa pantalla (de fábrica, al inicio de la app) y el workspace no se cambia (lo elige la dirección).
 */
export function Login({ consent }: { consent?: { notice: string; returnTo: string } } = {}) {
  const { client, config } = useWorkspace();
  // Si se llegó con un link de invitación del workspace que se abre, se explica qué hacer; si el link no
  // servía (roto, o de un workspace que no se pudo agregar), el aviso.
  const [invite] = useState(() => {
    const arrival = inviteArrival();
    if (arrival) return arrival.target ? 'this-page' : 'this';
    return takeArrivalNotice();
  });
  const [step, setStep] = useState<Step>({ name: 'email' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tr = useT();
  const { installed } = useInstallState();
  // Se llegó por la dirección de un archivo (P.30, Docs/Doc_Links_PDF.md, LF15): el link del correo vuelve a esa misma
  // dirección (sin el `#`); con el código, la pestaña ya está ahí.
  const route = useRoute();
  const fileRoute = !consent && route.name === 'file';

  async function sendEmail(e?: FormEvent) {
    e?.preventDefault();
    const address = (step.name === 'sent' ? step.email : email).trim().toLowerCase();
    if (!address) return;
    setBusy(true);
    setError(null);
    const { error } = await client.auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: consent?.returnTo ?? (fileRoute ? location.origin + location.pathname : location.origin) },
    });
    setBusy(false);
    if (error) setError(explain(error));
    else setStep({ name: 'sent', email: address });
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (step.name !== 'sent') return;
    setBusy(true);
    setError(null);
    const { error } = await client.auth.verifyOtp({ email: step.email, token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) setError(explain(error));
  }

  const back = () => {
    setStep({ name: 'email' });
    setCode('');
    setError(null);
  };

  return (
    <main className="login-screen">
      <aside className="login-hero">
        <SlateBand height={12} />
        <div className="login-hero-body">
          <div className="brand-row">
            <AppIcon size={36} />
            <span>LGA Shot Docs</span>
          </div>
          <div>
            <h1>
              {tr('login.hero.title')}
              <span>{tr('login.hero.subtitle')}</span>
            </h1>
            <p>{tr('login.hero.text')}</p>
          </div>
          <div className="login-tags">
            <span>{tr('login.tag.scenes')}</span>
            <span>{tr('login.tag.reports')}</span>
            <span>{tr('login.tag.breakdowns')}</span>
          </div>
        </div>
      </aside>

      <section className="login-panel">
        <div className="mobile-only band-wrap">
          <SlateBand height={9} />
        </div>
        <div className="brand-row mobile-only">
          <AppIcon size={32} />
          <span>LGA Shot Docs</span>
        </div>

        <div className="login-form-wrap">
          {step.name === 'email' ? (
            <form className="login-form" onSubmit={sendEmail}>
              <div>
                <h2>{tr('login.title')}</h2>
                <p className="lead">{tr('login.lead')}</p>
              </div>
              <LoginWorkspaceBar fixed={!!consent} />
              {(invite === 'this' || invite === 'this-page') && (
                <p className="login-invite">
                  {tr('login.invited', { workspace: config.name || tr('noProjects.thisWorkspace') })}
                  {invite === 'this-page' && ` ${tr('login.invitedPage')}`}
                </p>
              )}
              {invite && invite !== 'this' && invite !== 'this-page' && <p className="login-invite">{invite}</p>}
              {consent && <p className="login-invite">{consent.notice}</p>}
              {fileRoute && <p className="login-invite">{tr('file.signIn')}</p>}
              <div className="field">
                <label htmlFor="email">{tr('team.email')}</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={tr('team.emailPlaceholder')}
                />
              </div>
              <div className="login-actions">
                <button className="primary" disabled={busy}>
                  {busy ? tr('login.sending') : tr('login.continue')}
                  {!busy && <ArrowRightIcon />}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    const address = email.trim().toLowerCase();
                    if (address) setStep({ name: 'sent', email: address });
                    else setError(tr('login.emailFirst'));
                  }}
                >
                  {tr('login.haveCode')}
                </button>
              </div>
              {error && <p className="login-error">{error}</p>}
              {error && fileRoute && error === t('login.error.noAccount') && <p className="muted">{tr('file.askInvite')}</p>}
              <div className="hint">
                <MailIcon />
                <span>{tr('login.iphoneHint')}</span>
              </div>
            </form>
          ) : (
            <form className="login-form" onSubmit={verify}>
              <button type="button" className="icon-button" aria-label={tr('common.back')} onClick={back}>
                <ArrowLeftIcon size={20} />
              </button>
              <div>
                <h2>{tr('login.checkEmail')}</h2>
                <p className="lead">{tr.rich('login.sent', { email: <strong>{step.email}</strong> })}</p>
              </div>
              <div className="field">
                <label htmlFor="code">{tr('login.code')}</label>
                <input
                  id="code"
                  className="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6,10}"
                  required
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="12345678"
                />
              </div>
              <div className="login-actions">
                <button className="primary" disabled={busy || code.length < 6}>
                  {busy ? tr('login.checking') : tr('login.title')}
                </button>
                <div className="row">
                  <button type="button" onClick={() => void sendEmail()} disabled={busy}>
                    {tr('login.resend')}
                  </button>
                  <button type="button" onClick={back}>
                    {tr('login.otherEmail')}
                  </button>
                </div>
              </div>
              {error && <p className="login-error">{error}</p>}
            </form>
          )}
        </div>

        <footer className="login-footer">
          <span>{tr('login.footer')}</span>
          <LegalLinks />
          {/* Instalar antes de entrar: en el iPhone la app instalada guarda su sesión aparte de Safari. */}
          {!installed && (
            <button type="button" className="login-install" onClick={openInstallDialog}>
              {tr('install.menu')}
            </button>
          )}
          {__APP_VERSION__ && <span>v{__APP_VERSION__}</span>}
        </footer>
        <InstallHost />
      </section>
    </main>
  );
}
