import { useEffect, useState } from 'react';
import type { AuthUser } from '../auth';
import { prefs } from '../prefs';
import { navigate, pagePath, useRoute } from '../router';
import { ServicesContext, useBootServices, useServices, useTree } from '../services';
import { supabase } from '../supabase';
import { MenuIcon, MoreIcon, PlusIcon } from './icons';
import { menuBelow, PageMenu, type MenuPosition } from './menus';
import { MoveDialog } from './MoveDialog';
import { useNotice } from './notice';
import { focusTitle, PageView } from './PageView';
import { Sidebar } from './Sidebar';
import { SyncIcon } from './SyncBadge';
import { TrashView } from './TrashView';

const LAST_PAGE_KEY = 'shotdocs-last-page';

export function Workspace({ user }: { user: AuthUser }) {
  const boot = useBootServices(user);

  // Las preferencias de la cuenta (tema, fuente…) se bajan al entrar y se suben cuando cambian.
  useEffect(() => {
    if (supabase) void prefs.attach(supabase, user.id);
    return () => prefs.detach();
  }, [user.id]);

  if (boot.state === 'loading') return <main className="center-screen muted">Opening your workspace…</main>;
  if (boot.state === 'busy') {
    return (
      <main className="center-screen">
        <div className="card">
          <h1>Already open in another window</h1>
          <p className="muted">
            LGA Shot Docs is open in another tab or window. Keep working there, or close it and this one will
            open by itself.
          </p>
          <button className="link" onClick={boot.takeOver}>
            The other window is not responding: use this one
          </button>
        </div>
      </main>
    );
  }
  if (boot.state === 'lost') {
    return (
      <main className="center-screen">
        <div className="card">
          <h1>Opened in another window</h1>
          <p className="muted">
            Another window took over, so this one stopped saving. Your edits are kept on this device; reload to
            use this window again.
          </p>
          <button className="link" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </main>
    );
  }
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
  const { docs } = useServices();
  const [navOpen, setNavOpen] = useState(false);
  const [pageMenu, setPageMenu] = useState<{ position: MenuPosition; anchor: HTMLElement } | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [notice, dismissNotice] = useNotice();

  // Lo que todavía no llegó a IndexedDB se perdería al cerrar: el navegador pide confirmación.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (docs.hasUnsavedEdits()) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [docs]);

  useEffect(() => {
    setNavOpen(false);
    setPageMenu(null);
  }, [route.name, route.name === 'page' ? route.id : null]);

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

  const pageId = route.name === 'page' && tree.get(route.id) ? route.id : null;
  const crumbs = pageId ? tree.ancestors(pageId) : [];
  const current = pageId ? tree.get(pageId) : undefined;

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
            {crumbs.map((p) => (
              <span key={p.id}>
                <button className="crumb" onClick={() => navigate(pagePath(p.id))}>
                  {p.title || 'Untitled'}
                </button>
                <span className="sep" aria-hidden="true">
                  /
                </span>
              </span>
            ))}
            {current && (
              <span className="crumb current" aria-current="page">
                {current.title || 'Untitled'}
              </span>
            )}
            {route.name === 'trash' && <span className="crumb current">Trash</span>}
          </nav>
          <span className="only-mobile">
            <SyncIcon onClick={() => setNavOpen(true)} />
          </span>
          {pageId && (
            <button
              className="icon-button"
              aria-label="Page actions"
              title="Page actions"
              aria-expanded={!!pageMenu}
              onClick={(e) => {
                const anchor = e.currentTarget;
                setPageMenu(pageMenu ? null : { position: menuBelow(anchor), anchor });
              }}
            >
              <MoreIcon />
            </button>
          )}
        </header>
        {route.name === 'page' ? (
          <PageView key={route.id} id={route.id} />
        ) : route.name === 'trash' ? (
          <TrashView />
        ) : (
          <Home />
        )}
      </main>
      {pageMenu && pageId && (
        <PageMenu
          pageId={pageId}
          position={pageMenu.position}
          anchor={pageMenu.anchor}
          onClose={() => setPageMenu(null)}
          onNewChild={async () => navigate(pagePath(await tree.create(pageId)))}
          onRename={focusTitle}
          onMove={() => setMoving(pageId)}
          onTrash={async () => {
            // Primero se manda a la papelera y después se sale: si no, el inicio vuelve a la última página.
            await tree.trash(pageId);
            navigate('/');
          }}
        />
      )}
      {moving && <MoveDialog pageId={moving} onClose={() => setMoving(null)} />}
      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button className="link" onClick={dismissNotice}>
            OK
          </button>
        </div>
      )}
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
        <PlusIcon size={16} /> New page
      </button>
    </article>
  );
}
