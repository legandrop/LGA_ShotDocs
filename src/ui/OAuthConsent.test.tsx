// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { translate } from '../i18n';
import '../i18n/lazy/oauthConsent';
import { storageNamesFor, type ActiveWorkspace } from '../workspace';
import { ConsentScreen } from './OAuthConsent';

// La pantalla de permiso de un asistente (MCP) con un cliente de Supabase falso: carga y muestra quién pide, adónde
// vuelve y qué pide; Allow y Deny contestan una sola vez y vuelven al cliente; sin sesión pide entrar con el código y
// sigue al entrar; con la sesión vencida, lo mismo; y cada error con su mensaje y el detalle en la consola.

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

const tx = (key: Parameters<typeof translate>[1], params?: Record<string, string>) => translate('en', key, params);

const USER = { id: '00000000-0000-4000-8000-00000000000a', email: 'lega@ejemplo.invalid' };
const SESSION = { access_token: 'tok', user: USER };
const DETAILS = {
  authorization_id: 'auth_123',
  redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
  client: { id: 'c1', name: 'Claude', uri: '', logo_uri: '' },
  user: { id: USER.id, email: USER.email },
  scope: 'email offline_access custom:thing',
};

type Res = { data: unknown; error: unknown };
type AuthEvent = 'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT';

/** El cliente falso: la sesión inicial, los avisos de sesión y las tres llamadas del servidor OAuth. */
function fakeClient(opts: { session: typeof SESSION | null; details?: () => Promise<Res>; approve?: Res; deny?: Res }) {
  const listeners = new Set<(event: AuthEvent, session: typeof SESSION | null) => void>();
  const oauth = {
    getAuthorizationDetails: vi.fn(opts.details ?? (async () => ({ data: DETAILS, error: null }))),
    approveAuthorization: vi.fn(async () => opts.approve ?? { data: { redirect_url: 'https://claude.ai/api/mcp/auth_callback?code=c&state=s' }, error: null }),
    denyAuthorization: vi.fn(async () => opts.deny ?? { data: { redirect_url: 'https://claude.ai/api/mcp/auth_callback?error=access_denied' }, error: null }),
  };
  const auth = {
    oauth,
    onAuthStateChange(fn: (event: AuthEvent, session: typeof SESSION | null) => void) {
      listeners.add(fn);
      queueMicrotask(() => fn('INITIAL_SESSION', opts.session));
      return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } };
    },
    signInWithOtp: vi.fn(async () => ({ data: {}, error: null })),
    verifyOtp: vi.fn(async () => ({ data: {}, error: null })),
  };
  return {
    client: { auth } as unknown as SupabaseClient,
    oauth,
    emit: (event: AuthEvent, session: typeof SESSION | null) => listeners.forEach((fn) => fn(event, session)),
  };
}

function active(client: SupabaseClient): ActiveWorkspace {
  return {
    config: { url: 'https://znlvpuddswymxpffgvbz.supabase.co', publishableKey: 'k', name: 'Wanka', localKey: 'pruebaconsent', storage: storageNamesFor('pruebaconsent') },
    client,
  };
}

const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)));

async function render(client: SupabaseClient, search = '?authorization_id=auth_123') {
  const go = vi.fn();
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () =>
    root!.render(
      <ConsentScreen active={active(client)} workspaceName="Wanka" search={search} returnTo="https://app.invalid/oauth/consent/x" go={go} />,
    ),
  );
  await flush();
  await flush();
  return { el, go };
}

const button = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;

describe('la pantalla de permiso de un asistente', () => {
  it('carga: quién pide, con qué cuenta y en qué workspace, adónde vuelve (con la dirección entera en el tooltip) y qué pide', async () => {
    const f = fakeClient({ session: SESSION });
    const { el } = await render(f.client);
    expect(f.oauth.getAuthorizationDetails).toHaveBeenCalledWith('auth_123');
    expect(el.querySelector('h1')?.textContent).toBe(tx('oauth.title', { client: 'Claude' }));
    expect(el.textContent).toContain(tx('oauth.as', { email: USER.email, workspace: 'Wanka' }));
    const host = el.querySelector('.consent-host') as HTMLElement;
    expect(host.textContent).toBe('claude.ai');
    expect(host.getAttribute('data-tip')).toContain(DETAILS.redirect_uri);
    expect(host.hasAttribute('data-tip-plain')).toBe(true);
    expect(host.hasAttribute('title')).toBe(false);
    const scopes = [...el.querySelectorAll('.consent-scopes li')].map((li) => li.textContent);
    expect(scopes).toEqual([tx('oauth.scope.email'), tx('oauth.scope.offline'), 'custom:thing']);
    expect(el.textContent).toContain(tx('oauth.warning'));
    expect(button(el, tx('oauth.allow'))).toBeTruthy();
    expect(button(el, tx('oauth.deny'))).toBeTruthy();
  });

  it('un cliente sin nombre y una vuelta a esta computadora se dicen así', async () => {
    const f = fakeClient({
      session: SESSION,
      details: async () => ({ data: { ...DETAILS, client: { ...DETAILS.client, name: '  ' }, redirect_uri: 'http://127.0.0.1:33418/cb' }, error: null }),
    });
    const { el } = await render(f.client);
    expect(el.querySelector('h1')?.textContent).toBe(tx('oauth.title', { client: tx('oauth.unnamed') }));
    expect(el.querySelector('.consent-host')?.textContent).toBe('127.0.0.1:33418');
    expect(el.textContent).toContain(tx('oauth.local'));
  });

  it('Allow: contesta una sola vez (aunque se toque dos veces), sin que Supabase redirija solo, y vuelve al cliente', async () => {
    const f = fakeClient({ session: SESSION });
    const { el, go } = await render(f.client);
    const allow = button(el, tx('oauth.allow'))!;
    await act(async () => {
      allow.click();
      allow.click();
    });
    await flush();
    expect(f.oauth.approveAuthorization).toHaveBeenCalledTimes(1);
    expect(f.oauth.approveAuthorization).toHaveBeenCalledWith('auth_123', { skipBrowserRedirect: true });
    expect(f.oauth.denyAuthorization).not.toHaveBeenCalled();
    expect(go).toHaveBeenCalledWith('https://claude.ai/api/mcp/auth_callback?code=c&state=s');
    expect(el.textContent).toContain(tx('oauth.returning', { host: 'claude.ai' }));
  });

  it('Deny: contesta que no y vuelve al cliente con el error', async () => {
    const f = fakeClient({ session: SESSION });
    const { el, go } = await render(f.client);
    await act(async () => button(el, tx('oauth.deny'))!.click());
    await flush();
    expect(f.oauth.denyAuthorization).toHaveBeenCalledWith('auth_123', { skipBrowserRedirect: true });
    expect(f.oauth.approveAuthorization).not.toHaveBeenCalled();
    expect(go).toHaveBeenCalledWith('https://claude.ai/api/mcp/auth_callback?error=access_denied');
  });

  it('ya permitido antes: Supabase contesta con la vuelta y se va directo', async () => {
    const f = fakeClient({ session: SESSION, details: async () => ({ data: { redirect_url: 'https://chatgpt.com/cb?code=z' }, error: null }) });
    const { el, go } = await render(f.client);
    expect(go).toHaveBeenCalledWith('https://chatgpt.com/cb?code=z');
    expect(el.textContent).toContain(tx('oauth.returning', { host: 'chatgpt.com' }));
  });

  it('sin sesión: pide entrar con el código (con el aviso y sin cambiar de workspace) y al entrar muestra el pedido', async () => {
    const f = fakeClient({ session: null });
    const { el } = await render(f.client);
    expect(f.oauth.getAuthorizationDetails).not.toHaveBeenCalled();
    expect(el.querySelector('#email')).toBeTruthy();
    expect(el.textContent).toContain(tx('oauth.signIn'));
    await act(async () => f.emit('SIGNED_IN', SESSION));
    await flush();
    expect(f.oauth.getAuthorizationDetails).toHaveBeenCalledWith('auth_123');
    expect(el.querySelector('h1')?.textContent).toBe(tx('oauth.title', { client: 'Claude' }));
  });

  it('el link del correo vuelve a esta pantalla, no al inicio', async () => {
    const f = fakeClient({ session: null });
    const { el } = await render(f.client);
    const input = el.querySelector('#email') as HTMLInputElement;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(input, 'lega@ejemplo.invalid');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => (el.querySelector('form') as HTMLFormElement).requestSubmit());
    await flush();
    const auth = (f.client as unknown as { auth: { signInWithOtp: ReturnType<typeof vi.fn> } }).auth;
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'lega@ejemplo.invalid',
      options: { emailRedirectTo: 'https://app.invalid/oauth/consent/x' },
    });
  });

  it('con la sesión vencida (sin poder renovar): pide entrar y al entrar vuelve a pedir el detalle', async () => {
    let calls = 0;
    const f = fakeClient({
      session: SESSION,
      details: async () =>
        ++calls === 1
          ? { data: null, error: { name: 'AuthSessionMissingError', message: 'Auth session missing!', status: 400 } }
          : { data: DETAILS, error: null },
    });
    const { el } = await render(f.client);
    expect(el.querySelector('#email')).toBeTruthy();
    await act(async () => f.emit('SIGNED_IN', SESSION));
    await flush();
    expect(calls).toBe(2);
    expect(el.querySelector('h1')?.textContent).toBe(tx('oauth.title', { client: 'Claude' }));
  });

  it('autorización vencida o el 400 de #2820: el mensaje claro, el código chico y el detalle en la consola', async () => {
    const error = { name: 'AuthApiError', message: 'authorization request cannot be processed', status: 400, code: 'validation_failed' };
    const f = fakeClient({ session: SESSION, details: async () => ({ data: null, error }) });
    const { el } = await render(f.client);
    expect(el.querySelector('h1')?.textContent).toBe(tx('oauth.error.title'));
    expect(el.textContent).toContain(tx('oauth.error.expired'));
    expect(el.querySelector('.consent-detail')?.textContent).toBe(tx('oauth.error.detail', { detail: '400 · validation_failed' }));
    expect(el.textContent).not.toContain('cannot be processed');
    expect(console.error).toHaveBeenCalledWith('[oauth-consent]', error);
    expect(button(el, tx('oauth.allow'))).toBeUndefined();
    expect(button(el, tx('oauth.retry'))).toBeUndefined();
  });

  it('sin red: el aviso y Try again, que vuelve a pedir', async () => {
    let calls = 0;
    const f = fakeClient({
      session: SESSION,
      details: async () =>
        ++calls === 1 ? { data: null, error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 } } : { data: DETAILS, error: null },
    });
    const { el } = await render(f.client);
    expect(el.textContent).toContain(tx('oauth.error.offline'));
    await act(async () => button(el, tx('oauth.retry'))!.click());
    await flush();
    expect(el.querySelector('h1')?.textContent).toBe(tx('oauth.title', { client: 'Claude' }));
  });

  it('el servidor OAuth apagado, una excepción al permitir y una respuesta sin vuelta: cada uno con su mensaje', async () => {
    const off = fakeClient({ session: SESSION, details: async () => ({ data: null, error: { status: 404, code: 'feature_disabled', message: 'OAuth server is disabled' } }) });
    let r = await render(off.client);
    expect(r.el.textContent).toContain(tx('oauth.error.disabled'));
    act(() => root?.unmount());

    const boom = fakeClient({ session: SESSION });
    boom.oauth.approveAuthorization.mockImplementationOnce(async () => {
      throw new TypeError('Failed to fetch');
    });
    r = await render(boom.client);
    await act(async () => button(r.el, tx('oauth.allow'))!.click());
    await flush();
    expect(r.el.textContent).toContain(tx('oauth.error.offline'));
    expect(r.go).not.toHaveBeenCalled();
    act(() => root?.unmount());

    const empty = fakeClient({ session: SESSION, approve: { data: {}, error: null } });
    r = await render(empty.client);
    await act(async () => button(r.el, tx('oauth.allow'))!.click());
    await flush();
    expect(r.el.textContent).toContain(tx('oauth.error.other'));
    expect(r.go).not.toHaveBeenCalled();
  });

  it('sin authorization_id (o uno que cambiaría la dirección del pedido): no pregunta nada y avisa', async () => {
    for (const search of ['', '?authorization_id=../user']) {
      const f = fakeClient({ session: SESSION });
      const { el } = await render(f.client, search);
      expect(f.oauth.getAuthorizationDetails).not.toHaveBeenCalled();
      expect(el.textContent).toContain(tx('oauth.error.missing'));
      act(() => root?.unmount());
    }
  });
});
