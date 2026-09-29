import { useState, type FormEvent } from 'react';
import { supabase } from '../supabase';

type Step = { name: 'email' } | { name: 'sent'; email: string };

function explain(error: { message: string; code?: string; status?: number }): string {
  if (error.code === 'over_email_send_rate_limit' || error.status === 429) {
    return 'Too many emails were sent in a short time. Wait a while and try again.';
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
    const { error } = await supabase!.auth.signInWithOtp({
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
    const { error } = await supabase!.auth.verifyOtp({ email: step.email, token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) setError(explain(error));
  }

  return (
    <main className="center-screen">
      <div className="card login">
        <img src="/icons/icon.svg" alt="" width={48} height={48} />
        <h1>LGA Shot Docs</h1>
        {step.name === 'email' ? (
          <form onSubmit={sendEmail}>
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
            <button className="primary" disabled={busy}>
              {busy ? 'Sending…' : 'Continue with email'}
            </button>
            <button
              type="button"
              className="link"
              onClick={() => email.trim() && setStep({ name: 'sent', email: email.trim().toLowerCase() })}
            >
              I already have a code
            </button>
          </form>
        ) : (
          <form onSubmit={verify}>
            <p>
              We sent an email to <strong>{step.email}</strong>. Open the link on this device, or type the code if
              the email has one.
            </p>
            <label htmlFor="code">Code</label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6,10}"
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="12345678"
            />
            <button className="primary" disabled={busy || code.length < 6}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            <div className="row">
              <button type="button" className="link" onClick={() => sendEmail()} disabled={busy}>
                Send the email again
              </button>
              <button type="button" className="link" onClick={() => setStep({ name: 'email' })}>
                Use another email
              </button>
            </div>
          </form>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </main>
  );
}
