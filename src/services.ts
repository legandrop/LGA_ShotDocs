import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { AuthUser } from './auth';
import { t } from './i18n';
import { pendingInviteTarget } from './invite';
import { mediaDbName, openMediaDb, type MediaDb } from './media/mediaDb';
import { Portero, sessionToken } from './media/portero';
import { foreignFileNotice, MediaQueue } from './media/queue';
import { notify } from './ui/notice';
import { acceptInvitationsQuietly, AccessStore, Permissions } from './sync/access';
import { CommentQueue, commentsDbName, openCommentsDb, type CommentsDb } from './sync/comments';
import { SupabaseCommentRemote } from './sync/commentsRemote';
import { PageDocs } from './sync/docs';
import { SyncEngine, type SyncStatus } from './sync/engine';
import { PageFiles } from './sync/files';
import { openLocalDb, type LocalDb } from './sync/localDb';
import { supportsContent } from './ui/unknownContent';
import { SupabaseRemote } from './sync/remote';
import { mergeRootGroups, seedIfEmpty } from './sync/structure';
import { PageTree } from './sync/tree';
import { errorMessage } from './sync/types';
import { DB_SCHEMA_VERSION, type ActiveWorkspace } from './workspace';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface Services {
  workspace: ActiveWorkspace;
  /** El cliente de Supabase del workspace abierto. */
  client: SupabaseClient;
  user: AuthUser;
  db: LocalDb;
  tree: PageTree;
  docs: PageDocs;
  files: PageFiles;
  /** Fotos y videos que van al Drive del dueño por el portero (`sdmedia://`). */
  media: MediaQueue;
  engine: SyncEngine;
  /** Los permisos de la persona, guardados en el dispositivo (paso 9). */
  access: AccessStore;
  /** Las funciones del equipo (miembros, compartir), con red. */
  remote: SupabaseRemote;
  /** El nombre de la base local y la de archivos. */
  dbName: string;
  /** `null` si la base de archivos no se pudo abrir (la cola de fotos y videos queda apagada). */
  mediaDb: MediaDb | null;
  /** Comentarios y respuestas de las preguntas (paso 10), primero en el dispositivo. */
  comments: CommentQueue;
  /** `null` si la base de comentarios no se pudo abrir (se leen con red, no se escriben). */
  commentsDb: CommentsDb | null;
  /** Para la sincronización y cierra las bases del dispositivo (antes de borrarlas). */
  shutdown: () => Promise<void>;
}

export const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices fuera de ServicesContext');
  return services;
}

/** Re-renderiza cuando cambia el árbol. */
export function useTree(): PageTree {
  const { tree } = useServices();
  useSyncExternalStore(tree.subscribe, tree.getRevision);
  return tree;
}

export function useSyncStatus(): SyncStatus {
  const { engine } = useServices();
  return useSyncExternalStore(engine.subscribe, engine.getStatus);
}

/** Qué puede hacer la persona (paso 9); re-renderiza cuando cambian el árbol o los permisos. */
export function usePermissions(): Permissions {
  const { access, user } = useServices();
  const tree = useTree();
  useSyncExternalStore(access.subscribe, access.getRevision);
  return new Permissions(tree, access.get(), user.id);
}

/** La base dijo que sacaron a la persona del workspace. */
export function useRemoved(): boolean {
  const { access } = useServices();
  useSyncExternalStore(access.subscribe, access.getRevision);
  return access.removed;
}


type Boot =
  | { state: 'loading' }
  | { state: 'busy'; takeOver: () => void }
  | { state: 'lost' }
  | { state: 'ready'; services: Services }
  /** El usuario no tiene ningún proyecto en este workspace (todavía no le compartieron nada). */
  | { state: 'empty'; retry: () => void }
  | { state: 'error'; message: string; retry: () => void };

/**
 * Una sola pestaña o ventana escribe en la base local de un usuario. Con dos a la vez, cada una tendría
 * su propia cola y su propio documento en memoria, y una podría pisar o dar por subido lo de la otra.
 * Devuelve la función que libera el lock. Si otra pestaña lo tiene, llama a `onBusy` y espera a que se
 * libere (cuando la otra se cierra, esta sigue sola).
 */
function acquireTabLock(
  name: string,
  handlers: { onBusy: (takeOver: () => void) => void; onLost: () => void },
  signal: AbortSignal,
): Promise<() => void> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) return Promise.resolve(() => undefined);
  return new Promise((resolve, reject) => {
    let held = false;
    const hold = () =>
      new Promise<void>((release) => {
        held = true;
        resolve(release);
      });
    // Si otra ventana toma el control, la promesa del lock se rechaza: esta deja de escribir.
    const watch = (p: Promise<unknown>) =>
      p.catch((err) => {
        if (held) handlers.onLost();
        else reject(err);
      });
    void watch(
      locks.request(name, { ifAvailable: true }, (lock) => {
        if (lock) return hold();
        // Tomar el control le saca el lock a la otra ventana (por ejemplo, si quedó colgada).
        handlers.onBusy(() => void watch(locks.request(name, { steal: true }, hold)));
        return watch(locks.request(name, { signal }, hold));
      }),
    );
  });
}

/** Abre la base local del usuario y arranca la sincronización. */
export function useBootServices(workspace: ActiveWorkspace, user: AuthUser): Boot {
  const [boot, setBoot] = useState<Boot>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    const abort = new AbortController();
    let releaseLock: (() => void) | null = null;

    (async () => {
      const dbName = workspace.config.storage.db(user.id);
      releaseLock = await acquireTabLock(
        `lock:${dbName}`,
        {
          onBusy: (takeOver) => setBoot({ state: 'busy', takeOver }),
          onLost: () => {
            cleanup?.();
            cleanup = null;
            setBoot({ state: 'lost' });
          },
        },
        abort.signal,
      );
      if (cancelled) return releaseLock();
      const db = await openLocalDb(dbName);
      if (cancelled) return db.close();
      const remote = new SupabaseRemote(workspace.client, __APP_VERSION__);
      let workspaceId = (await db.get('meta', 'workspaceId')) as string | undefined;
      // Las invitaciones se aplican al entrar, antes de buscar el primer proyecto (lo compartido tiene que
      // estar para encontrarlo). Con proyectos ya guardados no se espera, salvo que se venga de un link.
      let accepted: Promise<number> | null = null;
      if (!workspaceId || pendingInviteTarget(workspace.config.storage.inviteTarget)) await acceptInvitationsQuietly(remote);
      else accepted = acceptInvitationsQuietly(remote);
      if (cancelled) return db.close();
      if (!workspaceId) {
        try {
          const first = await remote.ensureWorkspace();
          if (!first) {
            db.close();
            // Sin proyectos no se escribe nada: otra pestaña puede abrir mientras tanto.
            releaseLock?.();
            releaseLock = null;
            if (!cancelled) setBoot({ state: 'empty', retry: () => setAttempt((n) => n + 1) });
            return;
          }
          workspaceId = first;
          await db.put('meta', workspaceId, 'workspaceId');
        } catch (err) {
          db.close();
          if (!cancelled) {
            setBoot({
              state: 'error',
              message: t('boot.firstTime', { reason: errorMessage(err) }),
              retry: () => setAttempt((n) => n + 1),
            });
          }
          return;
        }
      }
      if (cancelled) return db.close();

      const tree = new PageTree(db, workspaceId);
      await tree.load();
      const access = new AccessStore(db, user.id);
      await access.load();
      const docs = new PageDocs(db, {
        normalize: mergeRootGroups,
        seed: seedIfEmpty,
        supports: supportsContent,
        // Sin "Edit", las reparaciones de estructura quedan en memoria: el servidor las rechazaría.
        canWrite: (pageId) => new Permissions(tree, access.get(), user.id).canEditPage(pageId),
      });
      const files = new PageFiles(db, remote);
      // Los archivos grandes, en una base aparte (la de siempre no cambia de versión).
      // Si no se puede abrir, la app arranca igual con la cola de fotos y videos apagada y un aviso en el
      // estado de la sincronización: el texto no depende de ella.
      let mediaDb: MediaDb | null = null;
      let mediaProblem: string | undefined;
      try {
        mediaDb = await openMediaDb(mediaDbName(dbName));
      } catch (err) {
        mediaProblem = t('boot.mediaStorage', { reason: errorMessage(err) });
      }
      if (cancelled) {
        mediaDb?.close();
        return db.close();
      }
      const media = new MediaQueue(mediaDb, remote, {
        portero: (url) => new Portero(url, { token: sessionToken(workspace.client) }),
        projectOf: (pageId) => tree.get(pageId)?.workspace_id,
        unavailable: mediaProblem,
        // Se pegó una foto o un video de otro proyecto (papelera de archivos, paso 11).
        onForeignFile: (name) => notify(foreignFileNotice(name)),
      });
      await media.load().catch(() => undefined);
      // Los comentarios, también en una base aparte. Si no se abre, se leen con red pero no se escriben.
      let commentsDb: CommentsDb | null = null;
      let commentsProblem: string | undefined;
      try {
        commentsDb = await openCommentsDb(commentsDbName(dbName));
      } catch (err) {
        commentsProblem = t('boot.commentsStorage', { reason: errorMessage(err) });
      }
      const comments = new CommentQueue(commentsDb, new SupabaseCommentRemote(workspace.client), user.id, {
        unavailable: commentsProblem,
      });
      await comments.load().catch(() => undefined);
      const engine = new SyncEngine(remote, tree, docs, files, {
        appVersion: __APP_VERSION__,
        schemaVersion: DB_SCHEMA_VERSION,
        media,
        access,
        comments,
      });
      if (cancelled) {
        mediaDb?.close();
        commentsDb?.close();
        return db.close();
      }
      engine.start();
      // Si una invitación nueva sumó permisos, se sincroniza de nuevo para traer lo compartido.
      void accepted?.then((n) => {
        if (n > 0) void engine.syncNow();
      });
      void navigator.storage?.persist?.();
      let closing: Promise<void> | null = null;
      const shutdown = () => {
        closing ??= (async () => {
          engine.stop();
          docs.dispose();
          media.dispose();
          try {
            await docs.flush();
          } finally {
            db.close();
            mediaDb?.close();
            commentsDb?.close();
            releaseLock?.();
          }
        })();
        return closing;
      };
      cleanup = () => void shutdown().catch(() => undefined);
      setBoot({
        state: 'ready',
        services: {
          workspace,
          client: workspace.client,
          user,
          db,
          tree,
          docs,
          files,
          media,
          engine,
          access,
          remote,
          dbName,
          mediaDb,
          comments,
          commentsDb,
          shutdown,
        },
      });
    })().catch((err) => {
      if (!cancelled) setBoot({ state: 'error', message: errorMessage(err), retry: () => setAttempt((n) => n + 1) });
    });

    return () => {
      cancelled = true;
      abort.abort();
      if (cleanup) cleanup();
      else releaseLock?.();
    };
  }, [workspace, user, attempt]);

  useEffect(() => {
    if (boot.state !== 'error' && boot.state !== 'empty') return;
    const retry = () => setAttempt((n) => n + 1);
    window.addEventListener('online', retry);
    // Sin proyectos se vuelve a preguntar cada tanto y al volver a la app: el dueño puede compartir uno.
    const timer = boot.state === 'empty' ? setInterval(retry, 60_000) : null;
    if (boot.state === 'empty') window.addEventListener('focus', retry);
    return () => {
      window.removeEventListener('online', retry);
      window.removeEventListener('focus', retry);
      if (timer) clearInterval(timer);
    };
  }, [boot.state]);

  return boot;
}
