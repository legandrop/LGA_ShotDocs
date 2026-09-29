import { useEffect, useState } from 'react';
import type { AuthUser } from '../auth';
import { navigate, pagePath, useRoute } from '../router';
import { ServicesContext, useBootServices, useTree } from '../services';
import { supabase } from '../supabase';
import { MenuIcon, PlusIcon } from './icons';
import { PageView } from './PageView';
import { Sidebar } from './Sidebar';
import { TrashView } from './TrashView';

const LAST_PAGE_KEY = 'shotdocs-last-page';

export function Workspace({ user }: { user: AuthUser }) {
  const boot = useBootServices(user);
  if (boot.state === 'loading') return <main className="center-screen muted">Opening your workspace…</main>;
  if (boot.state === 'error') {
    return (
      <main className="center-screen">
        <div className="card">
          <h1>Could not open your workspace</h1>
          <p className="muted">{boot.message}</p>
          <button className="link" onClick={() => void supabase!.auth.signOut({ scope: 'local' })}>
            Sign out
          </button>
        </div>
      </main>
    );
  }
  return (
    <ServicesContext.Provider value={boot.services}>
      <Shell />
    </ServicesContext.Provider>
  );
}

function Shell() {
  const route = useRoute();
  const tree = useTree();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => setNavOpen(false), [route.name, route.name === 'page' ? route.id : null]);

  useEffect(() => {
    try {
      if (route.name === 'page') localStorage.setItem(LAST_PAGE_KEY, route.id);
      if (route.name === 'home') {
        const last = localStorage.getItem(LAST_PAGE_KEY);
        if (last && tree.get(last) && !tree.isTrashed(last)) navigate(pagePath(last), true);
      }
    } catch {
      // Volver a la última página es solo una comodidad.
    }
  }, [route, tree]);

  const crumbs = route.name === 'page' ? [...tree.ancestors(route.id), tree.get(route.id)] : [];

  return (
    <div className={`shell${navOpen ? ' nav-open' : ''}`}>
      <Sidebar />
      <div className="scrim" onClick={() => setNavOpen(false)} />
      <main className="main">
        <header className="topbar">
          <button className="icon-button only-mobile" aria-label="Open pages" onClick={() => setNavOpen(true)}>
            <MenuIcon />
          </button>
          <nav className="breadcrumbs" aria-label="Location">
            {crumbs.map(
              (p, i) =>
                p && (
                  <span key={p.id}>
                    {i > 0 && <span className="sep">/</span>}
                    <button className="crumb" onClick={() => navigate(pagePath(p.id))}>
                      {p.title || 'Untitled'}
                    </button>
                  </span>
                ),
            )}
          </nav>
        </header>
        {route.name === 'page' ? (
          <PageView key={route.id} id={route.id} />
        ) : route.name === 'trash' ? (
          <TrashView />
        ) : (
          <Home />
        )}
      </main>
    </div>
  );
}

function Home() {
  const tree = useTree();
  const empty = tree.children(null).length === 0;
  return (
    <article className="page narrow home">
      <h1 className="page-heading">{empty ? 'Your workspace is empty' : 'Pick a page'}</h1>
      <p className="muted">
        {empty
          ? 'Create your first page: a show, a scene or a shoot day. Every page can hold other pages.'
          : 'Open a page from the sidebar or create a new one.'}
      </p>
      <button
        className="primary"
        onClick={async () => {
          const id = await tree.create(null);
          navigate(pagePath(id));
        }}
      >
        <PlusIcon /> New page
      </button>
    </article>
  );
}
