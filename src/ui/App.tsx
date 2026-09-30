import { useMemo } from 'react';
import { useAuth } from '../auth';
import { buildWorkspace, createWorkspaceClient, WorkspaceContext, type ActiveWorkspace } from '../workspace';
import { Login } from './Login';
import { TooltipLayer } from './Tooltip';
import { Workspace } from './Workspace';

export function App() {
  return (
    <>
      <Screen />
      <TooltipLayer />
    </>
  );
}

function Screen() {
  // Hasta que exista la lista de workspaces del dispositivo (paso 12), el único es el de la compilación.
  const active = useMemo<ActiveWorkspace | null>(() => {
    const config = buildWorkspace();
    return config ? { config, client: createWorkspaceClient(config) } : null;
  }, []);

  if (!active) {
    return (
      <main className="center-screen">
        <div className="card">
          <h1>Supabase is not configured</h1>
          <p className="muted">
            Set <code>SUPABASE_URL</code> and <code>SUPABASE_PUBLISHABLE_KEY</code> as environment variables (or
            in <code>.env.local</code>) and build the app again.
          </p>
        </div>
      </main>
    );
  }
  return (
    <WorkspaceContext.Provider value={active}>
      <Signed active={active} />
    </WorkspaceContext.Provider>
  );
}

function Signed({ active }: { active: ActiveWorkspace }) {
  const auth = useAuth(active.config, active.client);
  if (auth.status === 'loading') return <main className="center-screen muted">Loading…</main>;
  if (auth.status === 'signedOut') return <Login />;
  return <Workspace key={auth.user.id} user={auth.user} />;
}
