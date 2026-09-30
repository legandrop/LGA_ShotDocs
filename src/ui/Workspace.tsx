import { useEffect, useState } from 'react';
import type { AuthUser } from '../auth';
import { clearInviteTarget, pendingInviteTarget, takeArrivalNotice } from '../invite';
import { prefs } from '../prefs';
import { navigate, pagePath, useRoute } from '../router';
import {
  ServicesContext,
  useBootServices,
  usePermissions,
  useRemoved,
  useServices,
  useSyncStatus,
  useTree,
} from '../services';
import { useWorkspace } from '../workspace';
import { MenuIcon, MoreIcon, PlusIcon } from './icons';
import { menuBelow, PageMenu, type MenuPosition } from './menus';
import { MoveDialog } from './MoveDialog';
import { PageFormatDialog } from './PageFormatDialog';
import { notify, useNotice } from './notice';
import { lastPageOf, rememberPage, useCurrentProject, useSwitchProject } from './project';
import { RemovedScreen } from './RemovedScreen';
import { ShareDialog, type ShareTarget } from './ShareDialog';
import { MediaTest } from './MediaTest';
import { focusTitle, PageView } from './PageView';
import { Sidebar } from './Sidebar';
import { SidebarResizer } from './SidebarResizer';
import { SyncIcon } from './SyncBadge';
import { TrashView } from './TrashView';

// Versiones anteriores recordaban una sola última página; se sigue leyendo como respaldo.
const LEGACY_LAST_PAGE_KEY = 'shotdocs-last-page';

export function Workspace({ user }: { user: AuthUser }) {
  const workspace = useWorkspace();
  const { client } = workspace;
  const boot = useBootServices(workspace, user);

  // Las preferencias de la cuenta (tema, fuente…) se bajan al entrar y se suben cuando cambian.
  useEffect(() => {
    void prefs.attach(client, user.id);
    return () => prefs.detach();
  }, [client, user.id]);

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
          <button className="primary" onClick={boot.retry}>
            Try again
          </button>
          <button className="link" onClick={() => void client.auth.signOut({ scope: 'local' })}>
            Sign out
          </button>
        </div>
      </main>
    );
  }
  if (boot.state === 'empty') return <NoProjects user={user} onRetry={boot.retry} />;
  return (
    <ServicesContext.Provider value={boot.services}>
      <Gate />
    </ServicesContext.Provider>
  );
}

/** Si la base dijo que sacaron a la persona del workspace, en vez de la app va la pantalla que lo explica. */
function Gate() {
  return useRemoved() ? <RemovedScreen /> : <Shell />;
}

/**
 * Después de entrar con un link de invitación, abre la página o el proyecto del link apenas el árbol lo
 * tiene. Si después de sincronizar no está (la invitación no daba acceso a eso), avisa y lo olvida.
 */
function useInviteTarget(): void {
  const tree = useTree();
  const status = useSyncStatus();
  const switchTo = useSwitchProject();
  const revision = tree.getRevision();
  useEffect(() => {
    const target = pendingInviteTarget();
    if (!target) return;
    if (tree.get(target)) {
      clearInviteTarget();
      navigate(pagePath(target));
    } else if (tree.project(target) && status.lastSyncAt !== null) {
      clearInviteTarget();
      switchTo(target);
    } else if (status.lastSyncAt !== null) {
      clearInviteTarget();
      notify('The shared page is not available to this account yet. Ask the person who invited you.');
    }
  }, [tree, revision, status.lastSyncAt, switchTo]);
}

function Shell() {
  const route = useRoute();
  const tree = useTree();
  const { docs, media, user, workspace } = useServices();
  const keys = workspace.config.storage;
  const [navOpen, setNavOpen] = useState(false);
  const [pageMenu, setPageMenu] = useState<{ position: MenuPosition; anchor: HTMLElement } | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [formatting, setFormatting] = useState<string | null>(null);
  const [sharing, setSharing] = useState<ShareTarget | null>(null);
  const [notice, dismissNotice] = useNotice();
  const perms = usePermissions();
  useInviteTarget();
  // Un link de otro workspace abierto con la sesión ya iniciada: el aviso va acá.
  useEffect(() => {
    const message = takeArrivalNotice();
    if (message) notify(message);
  }, []);

  // Lo que todavía no llegó a IndexedDB se perdería al cerrar: el navegador pide confirmación.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (docs.hasUnsavedEdits() || tree.hasUnsavedWrites() || media.hasUnsavedWrites()) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [docs, tree, media]);

  useEffect(() => {
    setNavOpen(false);
    setPageMenu(null);
  }, [route.name, route.name === 'page' ? route.id : null]);

  // Cada proyecto recuerda su última página abierta; el inicio vuelve a la del proyecto abierto.
  const projectId = useCurrentProject();
  const revision = tree.getRevision();
  useEffect(() => {
    if (route.name === 'page') rememberPage(keys, tree, user.id, route.id);
    if (route.name !== 'home') return;
    let last = lastPageOf(keys, projectId);
    if (!last) {
      try {
        last = localStorage.getItem(LEGACY_LAST_PAGE_KEY);
      } catch {
        last = null;
      }
    }
    const page = last ? tree.get(last) : undefined;
    if (page && page.workspace_id === projectId && !tree.isTrashed(page.id)) navigate(pagePath(page.id), true);
  }, [route, tree, revision, projectId, user.id, keys]);

  const pageId = route.name === 'page' && tree.get(route.id) ? route.id : null;
  const crumbs = pageId ? tree.ancestors(pageId) : [];
  const current = pageId ? tree.get(pageId) : undefined;

  return (
    <div className={`shell${navOpen ? ' nav-open' : ''}`}>
      <Sidebar />
      <SidebarResizer />
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
            {route.name === 'media-test' && <span className="crumb current">Media test</span>}
          </nav>
          <span className="only-mobile">
            <SyncIcon onClick={() => setNavOpen(true)} />
          </span>
          {pageId && (
            <button
              className="icon-button"
              aria-label="Page actions"
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
        ) : route.name === 'media-test' ? (
          <MediaTest />
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
          onFormat={() => setFormatting(pageId)}
          onShare={perms.canSharePage(pageId) ? () => setSharing({ pageId }) : undefined}
          onTrash={async () => {
            // Primero se manda a la papelera y después se sale: si no, el inicio vuelve a la última página.
            await tree.trash(pageId);
            navigate('/');
          }}
        />
      )}
      {moving && <MoveDialog pageId={moving} onClose={() => setMoving(null)} />}
      {formatting && <PageFormatDialog pageId={formatting} onClose={() => setFormatting(null)} />}
      {sharing && <ShareDialog target={sharing} onClose={() => setSharing(null)} />}
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
  const perms = usePermissions();
  const projectId = useCurrentProject();
  const name = tree.project(projectId)?.name ?? 'This project';
  const empty = tree.roots(projectId).length === 0;
  const canCreate = perms.canCreateIn(null, projectId);
  return (
    <article className="page narrow home">
      <h1 className="page-heading">{empty ? `${name} is empty` : name}</h1>
      <p className="muted">
        {!canCreate
          ? empty
            ? 'Nothing here is shared with you yet.'
            : 'Open a page from the sidebar.'
          : empty
            ? 'Create your first page: a show, a scene or a shoot day. Every page can hold other pages.'
            : 'Open a page from the sidebar or create a new one.'}
      </p>
      {canCreate && (
      <button
        className="primary"
        onClick={async () => {
          const id = await tree.create(null, '', projectId);
          navigate(pagePath(id));
        }}
      >
        <PlusIcon size={16} /> New page
      </button>
      )}
    </article>
  );
}

/**
 * El usuario todavía no tiene ningún proyecto en este workspace. El dueño y los admins pueden crear el
 * primero (con red: es la puesta en marcha); los demás esperan a que les compartan uno, y la app vuelve a
 * preguntar sola.
 */
function NoProjects({ user, onRetry }: { user: AuthUser; onRetry: () => void }) {
  const { client, config } = useWorkspace();
  const [canCreate, setCanCreate] = useState(false);
  // Un id por pantalla: si la respuesta se pierde y se reintenta, no se crea un segundo proyecto.
  const [projectId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void client
      .from('members')
      .select('role, removed_at')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        const row = data as { role: string; removed_at: string | null } | null;
        if (live) setCanCreate(!!row && !row.removed_at && (row.role === 'owner' || row.role === 'admin'));
      });
    return () => {
      live = false;
    };
  }, [client, user.id]);

  async function create() {
    setBusy(true);
    setError(null);
    const { error } = await client
      .from('workspaces')
      .upsert({ id: projectId, name: 'My project' }, { onConflict: 'id', ignoreDuplicates: true });
    setBusy(false);
    if (error) setError(error.message);
    else onRetry();
  }

  return (
    <main className="center-screen">
      <div className="card">
        <h1>No projects yet</h1>
        <p className="muted">
          {canCreate
            ? `You are signed in to ${config.name || 'this workspace'} as ${user.email}. Create the first project to start.`
            : `You are signed in to ${config.name || 'this workspace'} as ${user.email}, but nothing has been shared with you yet. Ask the workspace owner for access; this page opens your projects as soon as they share one.`}
        </p>
        {canCreate && (
          <button className="primary" disabled={busy} onClick={() => void create()}>
            <PlusIcon size={16} /> New project
          </button>
        )}
        {error && <p className="error">{error}</p>}
        <button className="link" onClick={() => void client.auth.signOut({ scope: 'local' })}>
          Sign out
        </button>
      </div>
    </main>
  );
}
