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
  linkMemory,
  updateLink,
  visitorName,
  type LinkEntry,
  type LinkInfo,
} from '../linkMode';
import type { LinkBoot } from '../services';
import { LinkCommentRemote, LinkRemote, linkProblemOf, type LinkProblem } from '../sync/linkRemote';
import { errorMessage, isNetworkError } from '../sync/types';
import { WorkspaceContext, type ActiveWorkspace } from '../workspace';
import { formatSize } from '../media/fileTrash';
import type { MediaRecord } from '../media/mediaDb';
import { copyText } from '../invite';
import { downloadLinkPages, LinkEditBar, linkMediaBlob, linkUnsentComments, linkUnsentMedia, linkUnsentPages } from './LinkEditBar';
import { saveBlob } from './unsyncedDownload';
import { setLightImages } from './sharpImages';
import { Workspace } from './Workspace';
import { useRoute } from '../router';
import { filePath, workspaceHash } from '../fileLink';

// La app abierta con un link público (Docs/Doc_Link_Publico.md, 3.2 y 3.5): sin cuenta, con un cliente sin sesión y su
// propia base local. Es la app de siempre con un "usuario" que es el link: la base lo trata como un invitado con
// Comentar sobre la página compartida y lo de abajo.

type Opening =
  | { state: 'loading' }
  | { state: 'ready'; info: LinkInfo }
  | { state: 'dead' }
  | { state: 'limited' }
  /** La primera vez que se abre el link en este dispositivo, sin red: no hay nada guardado todavía. */
  | { state: 'noConnection' }
  | { state: 'error'; message: string };

/** Cuánto se espera a `plink_open` antes de mostrar lo guardado (una red que no contesta no deja al visitante mirando "Opening…"). */
export const SLOW_OPEN_MS = 2000;

/** Lo que `plink_open` dijo la última vez: con eso se muestra lo guardado sin preguntarle nada a la base. */
export function savedLinkInfo(entry: LinkEntry): LinkInfo | null {
  return entry.linkId && entry.pageId ? { entry, domain: linkDomain(entry), linkId: entry.linkId, pageId: entry.pageId } : null;
}

export function LinkApp({ entry }: { entry: LinkEntry }) {
  const tr = useT();
  const [opening, setOpening] = useState<Opening>({ state: 'loading' });
  const [problem, setProblem] = useState<LinkProblem | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Se muestra lo guardado en el dispositivo porque el servidor no contestó (hasta que conteste).
  const [offline, setOffline] = useState(false);

  // Un cliente y un servidor por link y por carga de la app.
  const setup = useMemo(() => {
    const client = createLinkClient(entry);
    const remote = new LinkRemote(
      client,
      __APP_VERSION__,
      (p) => {
        setProblem(p);
        // `plink_open` anduvo (acá o en un ciclo del motor): ya no se muestra el aviso de sin conexión.
        if (p === null) setOffline(false);
      },
      // Con Can edit, el nombre se lee al subir (sin nombre, lo escrito espera en este navegador).
      () => visitorName(entry.id),
      // Lo mandado y lo apartado ya visto, guardado con el link (entrega 2c).
      linkMemory(entry.id),
    );
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
    let settled = false;
    // Con lo guardado de una visita anterior (el id del link y de la página) se puede abrir sin red: si el servidor
    // tarda o no contesta, se muestra eso y el motor sigue intentando. Con red, `plink_open` contesta antes y manda:
    // un link revocado o vencido se corta sin mostrar nada.
    const saved = savedLinkInfo(entry);
    const showSaved = () => {
      if (!saved) return false;
      setOffline(true);
      setOpening({ state: 'ready', info: saved });
      return true;
    };
    const timer = saved
      ? setTimeout(() => {
          if (!cancelled && !settled) showSaved();
        }, SLOW_OPEN_MS)
      : undefined;
    setup.remote.open(true).then(
      (info) => {
        settled = true;
        clearTimeout(timer);
        if (cancelled) return;
        updateLink(entry.id, { title: info.title, linkId: info.link_id, pageId: info.page_id });
        setOffline(false);
        setOpening({ state: 'ready', info: { entry, domain: linkDomain(entry), linkId: info.link_id, pageId: info.page_id } });
      },
      (err: unknown) => {
        settled = true;
        clearTimeout(timer);
        if (cancelled) return;
        const p = linkProblemOf(err);
        if (p === 'link_not_found') setOpening({ state: 'dead' });
        else if (p === 'link_rate_limited') setOpening({ state: 'limited' });
        else if (showSaved()) return;
        else setOpening(isNetworkError(err) ? { state: 'noConnection' } : { state: 'error', message: errorMessage(err) });
      },
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [setup, entry, attempt]);

  // Volver a la app de siempre (los workspaces del dispositivo, o el inicio): lo del link queda guardado.
  const leave = () => {
    leaveLinks();
    location.assign('/');
  };

  if (opening.state === 'loading') return <main className="center-screen muted">{tr('link.opening')}</main>;
  if (opening.state === 'dead' || (opening.state === 'ready' && problem === 'link_not_found')) {
    return <DeadLink entry={entry} remote={setup.remote} onLeave={leave} />;
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
  if (opening.state === 'noConnection') {
    return (
      <main className="center-screen">
        <div className="card">
          <h1>{tr('link.noConnection.title')}</h1>
          <p className="muted">{tr('link.noConnection.text')}</p>
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
        {offline && problem === null && (
          <div className="notice link-offline" role="status">
            <span>{tr('link.offline')}</span>
          </div>
        )}
        {problem === 'link_rate_limited' && (
          <div className="notice link-limited" role="status">
            <span>{tr(setup.remote.opened?.level === 'edit' ? 'link.edit.limited' : 'link.limited.text')}</span>
          </div>
        )}
        <LinkEditBar entry={entry} remote={setup.remote} />
        <Workspace user={setup.user} link={setup.boot} />
      </LinkContext.Provider>
    </WorkspaceContext.Provider>
  );
}

/**
 * El link dejó de andar (revocado, *Reset link*, vencido, el creador ya no comparte). Con *Can edit*, lo escrito en este
 * navegador no se pierde (E2.9): se dice cuántas páginas tienen algo sin mandar y se baja como archivo, con lo que se mandó
 * y no llegó a entrar; y las fotos y archivos que agregó y no terminaron de subir se bajan de a uno, con su original (con
 * el link muerto no suben nunca; B1 de la auditoría de la 2b).
 * Los comentarios que escribió y no llegaron a mandarse (también con *Can view*) se muestran enteros, con *Copy the text*.
 */
function DeadLink({ entry, remote, onLeave }: { entry: LinkEntry; remote: LinkRemote; onLeave: () => void }) {
  const tr = useT();
  const [unsent, setUnsent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [media, setMedia] = useState<MediaRecord[]>([]);
  const [mediaDone, setMediaDone] = useState<ReadonlySet<string>>(new Set());
  const [comments, setComments] = useState<{ id: string; body: string }[]>([]);
  const [copied, setCopied] = useState(false);
  const sent = remote.linkEdits();
  // Lo que se mandó y puede no haber entrado: también lo de antes de recargar la app (guardado con el link, O9).
  const extra = [...new Set([...sent.waiting, ...sent.aside, ...remote.sentPages()])];
  useEffect(() => {
    let live = true;
    // La app del link se cerró (sin la sincronización): se lee lo guardado aparte.
    linkUnsentPages(entry).then(
      (n) => live && setUnsent(n),
      () => undefined,
    );
    linkUnsentMedia(entry).then(
      (list) => live && setMedia(list),
      () => undefined,
    );
    linkUnsentComments(entry).then(
      (list) => live && setComments(list),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [entry]);
  const pages = Math.max(unsent, extra.length);
  // La dirección de un archivo con un link que ya no anda (P.30, LF16): quien tiene cuenta entra con ella, con la misma
  // dirección del Supabase y sin el token. Se deja de abrir el link en esta pestaña (si no, recargar volvería acá).
  const route = useRoute();
  const signInInstead =
    route.name === 'file'
      ? () => {
          leaveLinks();
          // La misma dirección con otro `#`: hay que recargar para que el arranque la lea.
          history.replaceState(null, '', filePath(entry.localKey, route.id) + workspaceHash({ u: entry.url, k: entry.publishableKey, l: entry.localKey }));
          location.reload();
        }
      : null;
  return (
    <main className="center-screen">
      <div className="card">
        <h1>{tr('link.dead.title')}</h1>
        <p className="muted">{tr('link.dead.text')}</p>
        {pages > 0 && (
          <p>
            {tr('link.dead.unsent', { count: pages })}{' '}
            <button
              className="link"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setFailed(false);
                void downloadLinkPages(entry, extra)
                  .catch(() => setFailed(true))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? tr('common.preparing') : tr('link.edit.downloadThem')}
            </button>
          </p>
        )}
        {media.length > 0 && (
          <div className="removed-media">
            <span>{tr('link.dead.files', { count: media.length })}</span>
            <ul>
              {media.map((m) => (
                <li key={m.id}>
                  <button
                    className="link"
                    onClick={() => {
                      setFailed(false);
                      void linkMediaBlob(entry, m.id).then(
                        (blob) => {
                          if (!blob) return setFailed(true);
                          saveBlob(blob, m.name);
                          setMediaDone((prev) => new Set(prev).add(m.id));
                        },
                        () => setFailed(true),
                      );
                    }}
                  >
                    {m.name}
                  </button>{' '}
                  <span className="muted">
                    {formatSize(m.size, tr.lang)}
                    {mediaDone.has(m.id) ? ` · ${tr('removed.downloaded')}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {comments.length > 0 && (
          <div className="removed-media" data-link-unsent-comments>
            <span>{tr('link.dead.comments', { count: comments.length })}</span>{' '}
            <button className="link" onClick={() => void copyText(comments.map((c) => c.body).join('\n\n')).then(setCopied)}>
              {copied ? tr('common.copied') : tr('link.dead.copyComments')}
            </button>
            {/* El texto entero a la vista: si el navegador no deja copiar, se selecciona a mano. */}
            <ul>
              {comments.map((c) => (
                <li key={c.id} className="link-dead-comment">
                  {c.body}
                </li>
              ))}
            </ul>
          </div>
        )}
        {failed && <p className="error">{tr('sync.downloadFailed')}</p>}
        {signInInstead && (
          <button className="primary" onClick={signInInstead}>
            {tr('file.signInInstead')}
          </button>
        )}
        <button className="link" onClick={onLeave}>
          {tr('link.leave')}
        </button>
      </div>
    </main>
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
