// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { t } from '../i18n';
import { storageNamesFor, WorkspaceContext } from '../workspace';
import { Login } from './Login';

// El login desde la dirección de un archivo (P.30, Docs/Doc_Links_PDF.md, LF15): lo dice arriba, el link del correo
// vuelve a esa misma dirección (sin el `#`), y si el correo no tiene cuenta (registro cerrado), pide una invitación.

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  history.replaceState(null, '', '/');
});

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

async function render(path: string, error: unknown = null) {
  history.replaceState(null, '', path);
  const signInWithOtp = vi.fn(async () => ({ data: {}, error }));
  const client = { auth: { signInWithOtp, verifyOtp: vi.fn() } } as unknown as SupabaseClient;
  const el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  const config = { url: 'https://x.supabase.co', publishableKey: 'k', name: 'Wanka', localKey: 'wanka_1', storage: storageNamesFor('wanka_1') };
  await act(async () =>
    root!.render(
      <WorkspaceContext.Provider value={{ config, client }}>
        <Login />
      </WorkspaceContext.Provider>,
    ),
  );
  const before = el.textContent ?? '';
  const input = el.querySelector('#email') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'cliente@ejemplo.invalid');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => (el.querySelector('form') as HTMLFormElement).requestSubmit());
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  return { el, before, signInWithOtp };
}

describe('Login desde la dirección de un archivo', () => {
  it('lo dice y el correo vuelve a la misma dirección', async () => {
    const { before, signInWithOtp } = await render(`/f/wanka_1/${ID}`);
    expect(before).toContain(t('file.signIn'));
    expect(signInWithOtp).toHaveBeenCalledWith({ email: 'cliente@ejemplo.invalid', options: { emailRedirectTo: `${location.origin}/f/wanka_1/${ID}` } });
  });

  it('sin cuenta: el aviso de siempre y pedir una invitación', async () => {
    const { el } = await render(`/f/wanka_1/${ID}`, { code: 'signup_disabled', message: 'Signups not allowed for otp' });
    expect(el.textContent).toContain(t('login.error.noAccount'));
    expect(el.textContent).toContain(t('file.askInvite'));
  });

  it('desde otra dirección, como siempre', async () => {
    const { before, signInWithOtp } = await render('/');
    expect(before).not.toContain(t('file.signIn'));
    expect(signInWithOtp).toHaveBeenCalledWith({ email: 'cliente@ejemplo.invalid', options: { emailRedirectTo: location.origin } });
  });
});
