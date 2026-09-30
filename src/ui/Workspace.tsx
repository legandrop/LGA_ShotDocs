import { useEffect, useState } from 'react';
import type { AuthUser } from '../auth';
import { t, useT } from '../i18n';
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
import { FIND_SHORTCUT_LABEL, openFindBar } from './findUi';
import { isSearchShortcut, takesSearchShortcut, useSearchSession } from './projectSearchUi';
import { MenuIcon, MoreIcon, PlusIcon, SearchIcon } from './icons';
import { menuBelow, PageMenu, type MenuPosition } from './menus';
import { MoveDialog } from './MoveDialog';
import { PageFormatDialog } from './PageFormatDialog';
import { notify, useNotice } from './notice';
import { lastPageOf, rememberPage, useCurrentProject, useSwitchProject } from './project';
import { RemovedScreen } from './RemovedScreen';
import type { ShareTarget } from './ShareDialog';
import { ProjectSearch, ShareDialog } from './lazyDialogs';
import { Part, preloadWhenIdle, watchPendingWrites } from './lazyPart';
import { focusTitle, PageView, preloadPageParts } from './PageView';
import { CommentsToggle } from './CommentsToggle';
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
  const tr = useT();

  // Las preferencias de la cuenta (tema, fuente…) se bajan al entrar y se suben cuando cambian.
  useEffect(() => {
    void prefs.attach(client, user.id);
    return () => prefs.detach();
  }, [client, user.id]);

  if (boot.state === 'loading') return <main className="center-screen muted">{tr('shell.opening')}</main>;
  if (boot.state === 'busy') {
    return (
      <main className="center-screen">
        <div className="card">
          <h1>{tr('shell.busy.title')}</h1>
          <p className="muted">{tr('shell.busy.text')}</p>
          <button className="link" onClick={boot.takeOver}>
            {tr('shell.busy.takeOver')}
          </button>
        </div>
      </main>
    );
  }
  if (boot.state === 'lost') {
    return (
      <main className="center-screen">
        <div className="card">
          <h1>{tr('shell.lost.title')}</h1>
          <p className="muted">{tr('shell.lost.text')}</p>
          <button className="link" onClick={() => location.reload()}>
            {tr('shell.lost.reload')}
          </button>
        </div>
      </main>
    );
  }
  if (boot.state === 'error') {
    return (
      <main className="center-screen">
        <div className="card">
          <h1>{tr('shell.error.title')}</h1>
          <p className="muted">{boot.message}</p>
          <button className="primary" onClick={boot.retry}>
            {tr('common.tryAgain')}
          </button>
          <button className="link" onClick={() => void client.auth.signOut({ scope: 'local' })}>
            {tr('common.signOut')}
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
  const key = useServices().workspace.config.storage.inviteTarget;
  const revision = tree.getRevision();
  useEffect(() => {
    const target = pendingInviteTarget(key);
    if (!target) return;
    if (tree.get(target)) {
      clearInviteTarget(key);
      navigate(pagePath(target));
    } else if (tree.project(target) && status.lastSyncAt !== null) {
      clearInviteTarget(key);
      switchTo(target);
    } else if (status.lastSyncAt !== null) {
      clearInviteTarget(key);
      notify(t('invite.targetMissing'));
    }
  }, [tree, revision, status.lastSyncAt, switchTo, key]);
}

export function Shell() {
  const route = useRoute();
  const tree = useTree();
  const { comments, docs, media, user, workspace } = useServices();
  const keys = workspace.config.storage;
  const [navOpen, setNavOpen] = useState(false);
  const [pageMenu, setPageMenu] = useState<{ position: MenuPosition; anchor: HTMLElement } | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [formatting, setFormatting] = useState<string | null>(null);
  const [sharing, setSharing] = useState<ShareTarget | null>(null);
  const [notice, dismissNotice] = useNotice();
  const perms = usePermissions();
  const tr = useT();
  const search = useSearchSession();
  useInviteTarget();

  // Ctrl/⌘+K busca en el proyecto desde cualquier lugar (Docs/Doc_Buscar.md, sección 9); con el panel abierto,
  // lo cierra. En el editor con texto elegido sigue siendo "crear un link" de BlockNote.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !isSearchShortcut(e)) return;
      if (search.isOpen()) {
        e.preventDefault();
        search.setOpen(false);
        return;
      }
      if (!takesSearchShortcut(e.target)) return;
      e.preventDefault();
      search.setOpen(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [search]);
  // Un link de invitación que no sirvió (roto, o de un workspace que no se pudo agregar), abierto con la
  // sesión ya iniciada: el aviso va acá.
  useEffect(() => {
    const message = takeArrivalNotice();
    if (message) notify(message);
  }, []);

  // Lo que todavía no llegó a IndexedDB se perdería al cerrar: el navegador pide confirmación. Lo mismo
  // espera la recarga que sigue a publicar una versión nueva (lazyPart.tsx).
  useEffect(() => {
    const unsaved = () =>
      docs.hasUnsavedEdits() || tree.hasUnsavedWrites() || media.hasUnsavedWrites() || comments.hasUnsavedWrites();
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!unsaved()) return;
      e.preventDefault();
      // Safari y los Chrome viejos preguntan solo con `returnValue`.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    const unwatch = watchPendingWrites({ unsaved, flush: () => docs.flush() });
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      unwatch();
    };
  }, [comments, docs, tree, media]);

  // Con la barra lateral ya dibujada, el editor se baja cuando el navegador está libre: abrir una página
  // después no espera, y una versión nueva publicada mientras tanto no deja al editor sin sus archivos.
  useEffect(() => preloadWhenIdle({ preload: preloadPageParts }), []);

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
          <button className="icon-button only-mobile" aria-label={tr('shell.openPages')} onClick={() => setNavOpen(true)}>
            <MenuIcon />
          </button>
          <nav className="breadcrumbs" aria-label={tr('shell.location')}>
            {crumbs.map((p) => (
              <span key={p.id}>
                <button className="crumb" onClick={() => navigate(pagePath(p.id))}>
                  {p.title || tr('common.untitled')}
                </button>
                <span className="sep" aria-hidden="true">
                  /
                </span>
              </span>
            ))}
            {current && (
              <span className="crumb current" aria-current="page">
                {current.title || tr('common.untitled')}
              </span>
            )}
            {route.name === 'trash' && <span className="crumb current">{tr('trash.title')}</span>}
          </nav>
          <span className="only-mobile">
            <SyncIcon onClick={() => setNavOpen(true)} />
          </span>
          {pageId && current && (
            <button
              className="icon-button"
              aria-label={tr('shell.findInPage', { shortcut: FIND_SHORTCUT_LABEL })}
              data-tip={tr('shell.findInPage', { shortcut: FIND_SHORTCUT_LABEL })}
              onClick={() => openFindBar()}
            >
              <SearchIcon size={18} />
            </button>
          )}
          {pageId && current && <CommentsToggle pageId={pageId} />}
          {pageId && (
            <button
              className="icon-button"
              aria-label={tr('pageMenu.label')}
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
      {sharing && (
        <Part onClose={() => setSharing(null)}>
          <ShareDialog target={sharing} onClose={() => setSharing(null)} />
        </Part>
      )}
      {search.isOpen() && (
        <Part onClose={() => search.setOpen(false)}>
          {/* Ir a un resultado cierra también el cajón del teléfono (en la misma página no cambia la dirección). */}
          <ProjectSearch onClose={() => search.setOpen(false)} onGo={() => setNavOpen(false)} />
        </Part>
      )}
      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button className="link" onClick={dismissNotice}>
            {tr('common.ok')}
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
  const tr = useT();
  const name = tree.project(projectId)?.name ?? tr('home.thisProject');
  const empty = tree.roots(projectId).length === 0;
  const canCreate = perms.canCreateIn(null, projectId);
  return (
    <article className="page narrow home">
      <h1 className="page-heading">{empty ? tr('home.empty', { name }) : name}</h1>
      <p className="muted">
        {!canCreate
          ? empty
            ? tr('home.nothingShared')
            : tr('home.openPage')
          : empty
            ? tr('home.createFirst')
            : tr('home.openOrCreate')}
      </p>
      {canCreate && (
        <button
          className="primary"
          onClick={async () => {
            const id = await tree.create(null, '', projectId);
            navigate(pagePath(id));
          }}
        >
          <PlusIcon size={16} /> {tr('common.newPage')}
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
  const tr = useT();

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
      .upsert({ id: projectId, name: t('project.defaultName') }, { onConflict: 'id', ignoreDuplicates: true });
    setBusy(false);
    if (error) setError(error.message);
    else onRetry();
  }

  return (
    <main className="center-screen">
      <div className="card">
        <h1>{tr('noProjects.title')}</h1>
        <p className="muted">
          {tr(canCreate ? 'noProjects.canCreate' : 'noProjects.wait', {
            workspace: config.name || tr('noProjects.thisWorkspace'),
            email: user.email,
          })}
        </p>
        {canCreate && (
          <button className="primary" disabled={busy} onClick={() => void create()}>
            <PlusIcon size={16} /> {tr('project.new')}
          </button>
        )}
        {error && <p className="error">{error}</p>}
        <button className="link" onClick={() => void client.auth.signOut({ scope: 'local' })}>
          {tr('common.signOut')}
        </button>
      </div>
    </main>
  );
}
