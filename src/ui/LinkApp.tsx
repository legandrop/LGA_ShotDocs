import { useEffect, useMemo, useState } from 'react';
import type { AuthUser } from '../auth';
import { useT } from '../i18n';
import {
  createLinkClient,
  leaveLinks,
  linkConfig,
  LinkContext,
  linkDomain,
  linkHeaders,
  updateLink,
  visitorName,
  type LinkEntry,
  type LinkInfo,
} from '../linkMode';
import type { LinkBoot } from '../services';
import { LinkCommentRemote, LinkRemote, linkProblemOf, type LinkProblem } from '../sync/linkRemote';
import { errorMessage } from '../sync/types';
import { WorkspaceContext, type ActiveWorkspace } from '../workspace';
import { setLightImages } from './sharpImages';
import { Workspace } from './Workspace';

// La app abierta con un link público (Docs/Doc_Link_Publico.md, 3.2 y 3.5): sin cuenta, con un cliente sin sesión y su
// propia base local. Es la app de siempre con un "usuario" que es el link: la base lo trata como un invitado con
// Comentar sobre la página compartida y lo de abajo.

type Opening =
  | { state: 'loading' }
  | { state: 'ready'; info: LinkInfo }
  | { state: 'dead' }
  | { state: 'limited' }
  | { state: 'error'; message: string };


export function LinkApp({ entry }: { entry: LinkEntry }) {
  const tr = useT();
  const [opening, setOpening] = useState<Opening>({ state: 'loading' });
  const [problem, setProblem] = useState<LinkProblem | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Un cliente y un servidor por link y por carga de la app.
  const setup = useMemo(() => {
    const client = createLinkClient(entry);
    const remote = new LinkRemote(client, __APP_VERSION__, (p) => setProblem(p));
    const user: AuthUser = { id: `link:${entry.id}`, email: '' };
    const workspace: ActiveWorkspace = { config: linkConfig(entry), client };
    const boot: LinkBoot = {
      remote,
      // El nombre se lee al subir: puede cambiar mientras la página está abierta.
      comments: new LinkCommentRemote(client, user.id, () => visitorName(entry.id)),
      porteroHeaders: linkHeaders(entry, __APP_VERSION__),
    };
    return { remote, user, workspace, boot };
  }, [entry]);

  // Modo liviano mientras el link esté abierto (P12).
  useEffect(() => {
    setLightImages(true);
    return () => setLightImages(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setup.remote.open(true).then(
      (info) => {
        if (cancelled) return;
        updateLink(entry.id, { title: info.title });
        setOpening({ state: 'ready', info: { entry, domain: linkDomain(entry), linkId: info.link_id, pageId: info.page_id } });
      },
      (err: unknown) => {
        if (cancelled) return;
        const p = linkProblemOf(err);
        setOpening(p === 'link_not_found' ? { state: 'dead' } : p === 'link_rate_limited' ? { state: 'limited' } : { state: 'error', message: errorMessage(err) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [setup, entry, attempt]);

  // Volver a la app de siempre (los workspaces del dispositivo, o el inicio): lo del link queda guardado.
  const leave = () => {
    leaveLinks();
    location.assign('/');
  };

  if (opening.state === 'loading') return <main className="center-screen muted">{tr('link.opening')}</main>;
  if (opening.state === 'dead' || (opening.state === 'ready' && problem === 'link_not_found')) {
    return (
      <main className="center-screen">
        <div className="card">
          <h1>{tr('link.dead.title')}</h1>
          <p className="muted">{tr('link.dead.text')}</p>
          <button className="link" onClick={leave}>
            {tr('link.leave')}
          </button>
        </div>
      </main>
    );
  }
  if (opening.state === 'limited') {
    return (
      <main className="center-screen">
        <div className="card">
          <h1>{tr('link.limited.title')}</h1>
          <p className="muted">{tr('link.limited.text')}</p>
          <button className="primary" onClick={() => setAttempt((n) => n + 1)}>
            {tr('common.tryAgain')}
          </button>
        </div>
      </main>
    );
  }
  if (opening.state === 'error') {
    return (
      <main className="center-screen">
        <div className="card">
          <h1>{tr('shell.error.title')}</h1>
          <p className="muted">{opening.message}</p>
          <button className="primary" onClick={() => setAttempt((n) => n + 1)}>
            {tr('common.tryAgain')}
          </button>
        </div>
      </main>
    );
  }
  return (
    <WorkspaceContext.Provider value={setup.workspace}>
      <LinkContext.Provider value={opening.info}>
        {problem === 'link_rate_limited' && (
          <div className="notice link-limited" role="status">
            <span>{tr('link.limited.text')}</span>
          </div>
        )}
        <Workspace user={setup.user} link={setup.boot} />
      </LinkContext.Provider>
    </WorkspaceContext.Provider>
  );
}

/**
 * Antes de abrir un link de un servidor que el dispositivo no conoce (contenido de afuera, como un `#invite=` de otro
 * workspace): el dominio, y abrir o no.
 */
export function LinkConfirm({ domain, onOpen, onCancel }: { domain: string; onOpen: () => void; onCancel: () => void }) {
  const tr = useT();
  return (
    <main className="center-screen">
      <div className="card">
        <h1>{tr('link.confirm.title', { domain })}</h1>
        <p className="muted">{tr('link.confirm.text')}</p>
        <button className="primary" onClick={onOpen}>
          {tr('link.confirm.open')}
        </button>
        <button className="link" onClick={onCancel}>
          {tr('common.cancel')}
        </button>
      </div>
    </main>
  );
}
