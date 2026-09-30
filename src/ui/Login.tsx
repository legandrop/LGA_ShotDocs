import { useState, type FormEvent } from 'react';
import { consumeInviteArrival, takeArrivalNotice } from '../invite';
import { useWorkspace } from '../workspace';
import { AppIcon, ArrowLeftIcon, ArrowRightIcon, MailIcon, SlateBand } from './icons';

type Step = { name: 'email' } | { name: 'sent'; email: string };

function explain(error: { message: string; code?: string; status?: number }): string {
  if (error.code === 'over_email_send_rate_limit' || error.status === 429) {
    return 'Too many emails were sent in a short time. Wait a while and try again.';
  }
  // El registro está cerrado: solo entran cuentas que ya existen (invitadas por el dueño).
  if (error.code === 'signup_disabled' || error.code === 'otp_disabled' || /signups? not allowed/i.test(error.message)) {
    return 'There is no account with this email. Ask the owner of this workspace for an invitation.';
  }
  if (error.code === 'email_address_not_authorized') {
    return 'The Supabase test mail server only sends to members of the project. Set up your own mail server (SMTP) to let other people in.';
  }
  if (error.code === 'otp_expired' || /expired|invalid/i.test(error.message)) {
    return 'That code is not valid or has expired. Ask for a new one.';
  }
  if (/fetch/i.test(error.message)) return 'You are offline. Signing in needs an internet connection.';
  return error.message;
}

export function Login() {
  const { client, config } = useWorkspace();
  // Si se llegó con un link de invitación: de este workspace, se explica qué hacer; de otro, que todavía no.
  const [invite] = useState(() => {
    const arrival = consumeInviteArrival(config);
    if (arrival?.kind === 'other') return takeArrivalNotice();
    if (arrival?.kind === 'this') return arrival.target ? 'this-page' : 'this';
    return null;
  });
  const [step, setStep] = useState<Step>({ name: 'email' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendEmail(e?: FormEvent) {
    e?.preventDefault();
    const address = (step.name === 'sent' ? step.email : email).trim().toLowerCase();
    if (!address) return;
    setBusy(true);
    setError(null);
    const { error } = await client.auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: location.origin },
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
              Notes for every shot.
              <span>On set, offline, in sync.</span>
            </h1>
            <p>
              Pre-production notes and on-set reports in one tree of pages. Every edit is saved on your device
              first, and nothing is lost when the signal drops.
            </p>
          </div>
          <div className="login-tags">
            <span>Scene notes</span>
            <span>On-set reports</span>
            <span>Shot breakdowns</span>
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
                <h2>Sign in</h2>
                <p className="lead">Enter your email and we will send you a sign-in link. No password to remember.</p>
              </div>
              {(invite === 'this' || invite === 'this-page') && (
                <p className="login-invite">
                  You were invited to {config.name || 'this workspace'}. Use the email the invitation was sent to.
                  {invite === 'this-page' && ' The shared page opens after you sign in.'}
                </p>
              )}
              {invite && invite !== 'this' && invite !== 'this-page' && <p className="login-invite">{invite}</p>}
              <div className="field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                />
              </div>
              <div className="login-actions">
                <button className="primary" disabled={busy}>
                  {busy ? 'Sending…' : 'Continue with email'}
                  {!busy && <ArrowRightIcon />}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    const address = email.trim().toLowerCase();
                    if (address) setStep({ name: 'sent', email: address });
                    else setError('Type your email first.');
                  }}
                >
                  I already have a code
                </button>
              </div>
              {error && <p className="login-error">{error}</p>}
              <div className="hint">
                <MailIcon />
                <span>
                  On iPhone, open the link on this device or type the code from the email, so you stay signed in
                  to the installed app.
                </span>
              </div>
            </form>
          ) : (
            <form className="login-form" onSubmit={verify}>
              <button type="button" className="icon-button" aria-label="Back" onClick={back}>
                <ArrowLeftIcon size={20} />
              </button>
              <div>
                <h2>Check your email</h2>
                <p className="lead">
                  We sent a sign-in link to <strong>{step.email}</strong>. Open it on this device, or type the
                  code if the email has one.
                </p>
              </div>
              <div className="field">
                <label htmlFor="code">Code</label>
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
                  {busy ? 'Checking…' : 'Sign in'}
                </button>
                <div className="row">
                  <button type="button" onClick={() => void sendEmail()} disabled={busy}>
                    Send the email again
                  </button>
                  <button type="button" onClick={back}>
                    Use another email
                  </button>
                </div>
              </div>
              {error && <p className="login-error">{error}</p>}
            </form>
          )}
        </div>

        <footer className="login-footer">
          <span>Self-hosted · your data, your database</span>
          {__APP_VERSION__ && <span>v{__APP_VERSION__}</span>}
        </footer>
      </section>
    </main>
  );
}
