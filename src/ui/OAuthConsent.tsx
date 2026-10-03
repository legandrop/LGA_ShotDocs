import type { OAuthAuthorizationDetails, SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../auth';
import { useT, type Key } from '../i18n';
import '../i18n/lazy/oauthConsent';
import {
  authorizationIdFrom,
  consentErrorDetail,
  consentErrorKind,
  redirectTarget,
  scopeList,
  workspaceForRef,
  type ConsentError,
  type ConsentErrorKind,
} from '../oauthConsent';
import { buildWorkspace, createWorkspaceClient, useWorkspace, WorkspaceContext, type ActiveWorkspace } from '../workspace';
import { configOf, displayName, loadWorkspaces } from '../workspaces';
import { AppIcon } from './icons';
import { Login } from './Login';

// La pantalla de permiso de un asistente (MCP, Docs/Doc_Asistente.md, 9.2 y "Cómo quedó M0", paso 3). Supabase manda a
// la persona a `/oauth/consent/<ref>?authorization_id=…` cuando un cliente MCP (Claude, ChatGPT…) pide conectarse. Se
// abre sin el resto de la app: elige el workspace por el ref, pide entrar con el código si no hay sesión, muestra quién
// pide, adónde vuelve y qué pide, y contesta *Allow* o *Deny*. Si el servidor OAuth está apagado no se llega nunca acá.

/** Lo que la pantalla usa del cliente de Supabase (las pruebas pasan uno falso). */
export type ConsentClient = Pick<SupabaseClient, 'auth'>;

export function OAuthConsent({ projectRef }: { projectRef: string }) {
  const active = useMemo<{ active: ActiveWorkspace; name: string } | null>(() => {
    const build = buildWorkspace();
    const list = loadWorkspaces(build ? { url: build.url, publishableKey: build.publishableKey } : null);
    const entry = workspaceForRef(list, projectRef);
    if (!entry) return null;
    const config = configOf(entry);
    // El mismo cliente que usa la app para ese workspace (uno solo por workspace: comparten la sesión guardada).
    return { active: { config, client: createWorkspaceClient(config) }, name: displayName(entry) };
  }, [projectRef]);
  if (!active) return <NoWorkspace projectRef={projectRef} />;
  return (
    <ConsentScreen
      active={active.active}
      workspaceName={active.name}
      search={location.search}
      returnTo={location.href}
      go={(url) => location.assign(url)}
    />
  );
}

/** La pantalla con el workspace ya elegido. `go` lleva al navegador de vuelta al cliente. */
export function ConsentScreen(props: {
  active: ActiveWorkspace;
  workspaceName: string;
  search: string;
  returnTo: string;
  go: (url: string) => void;
}) {
  return (
    <WorkspaceContext.Provider value={props.active}>
      <ConsentSigned {...props} />
    </WorkspaceContext.Provider>
  );
}

function ConsentSigned({ workspaceName, search, returnTo, go }: { workspaceName: string; search: string; returnTo: string; go: (url: string) => void }) {
  const { config, client } = useWorkspace();
  const auth = useAuth(config, client);
  const tr = useT();
  if (auth.status === 'loading') return <Loading />;
  // Sin sesión: el login de siempre (con el código), con un aviso; al entrar, `useAuth` cambia y se sigue acá.
  if (auth.status === 'signedOut') return <Login consent={{ notice: tr('oauth.signIn'), returnTo }} />;
  return (
    <ConsentPanel
      client={client}
      authorizationId={authorizationIdFrom(search)}
      workspaceName={workspaceName}
      email={auth.user.email}
      returnTo={returnTo}
      go={go}
    />
  );
}

type State =
  | { kind: 'loading' }
  | { kind: 'details'; details: OAuthAuthorizationDetails; busy: 'approve' | 'deny' | null }
  | { kind: 'returning'; host: string }
  | { kind: 'error'; error: ConsentErrorKind; detail: string }
  /** La sesión guardada ya no sirve (venció y no se pudo renovar): entrar de nuevo. */
  | { kind: 'login' };

const ERROR_TEXT: Record<ConsentErrorKind, Key> = {
  missing: 'oauth.error.missing',
  expired: 'oauth.error.expired',
  disabled: 'oauth.error.disabled',
  offline: 'oauth.error.offline',
  session: 'oauth.error.other',
  other: 'oauth.error.other',
};

const SCOPE_TEXT: Record<string, Key> = {
  email: 'oauth.scope.email',
  openid: 'oauth.scope.openid',
  profile: 'oauth.scope.profile',
  phone: 'oauth.scope.phone',
  offline_access: 'oauth.scope.offline',
};

/** Una respuesta de Supabase Auth: `{ data, error }`, o una excepción que no es de Auth. */
async function call<T>(fn: () => Promise<{ data: T | null; error: unknown }>): Promise<{ data: T | null; error: ConsentError | null }> {
  try {
    const res = await fn();
    return { data: res.data, error: (res.error as ConsentError | null) ?? null };
  } catch (e) {
    return { data: null, error: (e as ConsentError) ?? { message: String(e) } };
  }
}

export function ConsentPanel({
  client,
  authorizationId,
  workspaceName,
  email,
  returnTo,
  go,
}: {
  client: ConsentClient;
  authorizationId: string | null;
  workspaceName: string;
  email: string;
  returnTo: string;
  go: (url: string) => void;
}) {
  const tr = useT();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const stateRef = useRef(state);
  stateRef.current = state;

  const fail = useCallback((error: ConsentError) => {
    // El detalle va a la consola: es lo que se mira si un cliente no pasa de acá (supabase/auth#2820).
    console.error('[oauth-consent]', error);
    const kind = consentErrorKind(error);
    if (kind === 'session') setState({ kind: 'login' });
    else setState({ kind: 'error', error: kind, detail: consentErrorDetail(error) });
  }, []);

  const leave = useCallback(
    (url: unknown) => {
      if (typeof url !== 'string' || !url) {
        fail({ message: 'The server did not send the address to return to.' });
        return;
      }
      setState({ kind: 'returning', host: redirectTarget(url).host });
      go(url);
    },
    [fail, go],
  );

  const load = useCallback(async () => {
    if (!authorizationId) {
      setState({ kind: 'error', error: 'missing', detail: '' });
      return;
    }
    setState({ kind: 'loading' });
    const { data, error } = await call(() => client.auth.oauth.getAuthorizationDetails(authorizationId));
    if (error || !data) {
      fail(error ?? { message: 'Empty answer.' });
      return;
    }
    // Ya lo había permitido antes: Supabase contesta directo con la vuelta.
    if (!('authorization_id' in data)) {
      leave(data.redirect_url);
      return;
    }
    setState({ kind: 'details', details: data, busy: null });
  }, [authorizationId, client, fail, leave]);

  useEffect(() => {
    void load();
  }, [load]);

  // Con la sesión vencida se pidió entrar de nuevo: al entrar, se vuelve a pedir el detalle.
  useEffect(() => {
    const { data } = client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' && stateRef.current.kind === 'login') void load();
    });
    return () => data.subscription.unsubscribe();
  }, [client, load]);

  async function answer(action: 'approve' | 'deny') {
    // Del ref y no del estado dibujado: dos toques antes de que React vuelva a dibujar contestarían dos veces.
    const now = stateRef.current;
    if (now.kind !== 'details' || now.busy) return;
    const id = now.details.authorization_id;
    const next: State = { ...now, busy: action };
    stateRef.current = next;
    setState(next);
    const options = { skipBrowserRedirect: true };
    const { data, error } = await call(() =>
      action === 'approve'
        ? client.auth.oauth.approveAuthorization(id, options)
        : client.auth.oauth.denyAuthorization(id, options),
    );
    if (error || !data) {
      fail(error ?? { message: 'Empty answer.' });
      return;
    }
    leave(data.redirect_url);
  }

  if (state.kind === 'loading') return <Loading />;
  if (state.kind === 'login') return <Login consent={{ notice: tr('oauth.signIn'), returnTo }} />;

  if (state.kind === 'returning') {
    return (
      <Card>
        <p className="muted" role="status">
          {tr('oauth.returning', { host: state.host })}
        </p>
      </Card>
    );
  }

  if (state.kind === 'error') {
    return (
      <Card>
        <h1>{tr('oauth.error.title')}</h1>
        <p className="muted" role="alert">
          {tr(ERROR_TEXT[state.error])}
        </p>
        {state.detail && <p className="consent-detail">{tr('oauth.error.detail', { detail: state.detail })}</p>}
        {state.error === 'offline' || state.error === 'other' ? (
          <button className="primary" onClick={() => void load()}>
            {tr('oauth.retry')}
          </button>
        ) : null}
        <OpenApp />
      </Card>
    );
  }

  const { details, busy } = state;
  const target = redirectTarget(details.redirect_uri);
  const scopes = scopeList(details.scope);
  const name = details.client?.name?.trim() || tr('oauth.unnamed');
  return (
    <Card>
      <h1>{tr('oauth.title', { client: name })}</h1>
      <p className="muted">{tr('oauth.as', { email: details.user?.email || email, workspace: workspaceName })}</p>
      <dl className="consent-facts">
        <dt>{tr('oauth.returnsTo')}</dt>
        <dd>
          <strong className="consent-host" data-tip={tr('oauth.returnsTo.tip', { uri: details.redirect_uri })} data-tip-plain>
            {target.host}
          </strong>
          {target.local && <span className="muted"> · {tr('oauth.local')}</span>}
        </dd>
        {scopes.length > 0 && (
          <>
            <dt>{tr('oauth.asks')}</dt>
            <dd>
              <ul className="consent-scopes">
                {scopes.map((s) => (
                  <li key={s}>{SCOPE_TEXT[s] ? tr(SCOPE_TEXT[s]) : s}</li>
                ))}
              </ul>
            </dd>
          </>
        )}
      </dl>
      <p className="consent-warning">{tr('oauth.warning')}</p>
      <div className="consent-actions">
        <button className="secondary" disabled={!!busy} onClick={() => void answer('deny')}>
          {tr('oauth.deny')}
        </button>
        <button className="primary" disabled={!!busy} onClick={() => void answer('approve')}>
          {tr('oauth.allow')}
        </button>
      </div>
    </Card>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <main className="center-screen">
      <div className="card consent-card">
        <div className="brand-row">
          <AppIcon size={32} />
          <span>LGA Shot Docs</span>
        </div>
        {children}
      </div>
    </main>
  );
}

/** Volver a la app de siempre (el inicio). */
function OpenApp() {
  const tr = useT();
  return (
    <button className="link" onClick={() => location.assign('/')}>
      {tr('oauth.openApp')}
    </button>
  );
}

function Loading() {
  const tr = useT();
  return <main className="center-screen muted">{tr('oauth.loading')}</main>;
}

function NoWorkspace({ projectRef }: { projectRef: string }) {
  const tr = useT();
  useEffect(() => {
    console.error('[oauth-consent] ningún workspace del dispositivo es', projectRef);
  }, [projectRef]);
  return (
    <Card>
      <h1>{tr('oauth.noWorkspace.title')}</h1>
      <p className="muted">{tr('oauth.noWorkspace.text', { ref: projectRef })}</p>
      <OpenApp />
    </Card>
  );
}
