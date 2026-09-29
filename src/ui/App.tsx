import { useAuth } from '../auth';
import { supabase } from '../supabase';
import { Login } from './Login';
import { Workspace } from './Workspace';

export function App() {
  const auth = useAuth();

  if (!supabase) {
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
  if (auth.status === 'loading') return <main className="center-screen muted">Loading…</main>;
  if (auth.status === 'signedOut') return <Login />;
  return <Workspace key={auth.user.id} user={auth.user} />;
}
