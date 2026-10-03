import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { AuthUser } from './auth';
import { stored, t } from './i18n';
import { pendingInviteTarget } from './invite';
import { mediaDbName, openMediaDb, type MediaDb } from './media/mediaDb';
import { Portero, sessionToken } from './media/portero';
import { OfflineManager, type OfflineSnapshot } from './media/offline';
import { ProjectSizes, type SizesView } from './media/projectSizes';
import { foreignFileNotice, MediaQueue } from './media/queue';
import { FolderUploads, foldersDbName, openFoldersDb, type FolderPortero, type FoldersDb } from './media/folderUpload';
import type { ProjectDrive } from './media/projectDrive';
import { notify } from './ui/notice';
import { acceptInvitationsQuietly, AccessStore, Permissions } from './sync/access';
import { CommentQueue, commentsDbName, openCommentsDb, type CommentRemote, type CommentsDb } from './sync/comments';
import { SupabaseCommentRemote } from './sync/commentsRemote';
import { MentionsInbox } from './sync/mentions';
import { PageDocs } from './sync/docs';
import { SyncEngine, type SyncStatus } from './sync/engine';
import { PageFiles } from './sync/files';
import { openLocalDb, type LocalDb } from './sync/localDb';
import { supportsContent } from './ui/unknownContent';
import { SupabaseRemote } from './sync/remote';
import { normalizeStructure, seedIfEmpty } from './sync/structure';
import { PageTree } from './sync/tree';
import { watchTitleRests } from './sync/titleRest';
import { cutText } from './lib/graphemes';
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
  /** Las carpetas que se suben desde este dispositivo (P.9). Opcional: las pruebas que no las usan no la arman. */
  folders?: FolderUploads;
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
  /**
   * La campana de las menciones (P.21, Docs/Doc_Menciones.md). No está con un link público ni en las pruebas que
   * arman los servicios a mano; con la base del workspace sin migrar, está apagada (`ready` en falso).
   */
  mentions?: MentionsInbox;
  /** Cuánto ocupa cada proyecto en el Drive (P.7), con la última respuesta guardada en el dispositivo. */
  sizes: ProjectSizes;
  /** "Available offline" y el espacio de la app en este dispositivo (P.10, Docs/Doc_Copias_Locales.md). */
  offline: OfflineManager;
  /**
   * El portero para la carpeta de un proyecto borrado (P.14, entrega 2). Sin él, se arma con la dirección del portero
   * del workspace (`useProjectDrive`); las pruebas ponen uno propio.
   */
  projectDrive?: ProjectDrive;
  /** Para la sincronización y cierra las bases del dispositivo (antes de borrarlas). */
  shutdown: () => Promise<void>;
  /**
   * La primera carga de este workspace en este dispositivo (la base local todavía no tenía proyecto): la
   * recorrida arranca sola solo ahí (Docs/Doc_Tutorial.md, corrección 5).
   */
  firstLoad?: boolean;
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

/** El peso de los proyectos en el Drive (P.7); re-renderiza cuando llega una respuesta nueva. */
export function useProjectSizes(): SizesView {
  const { sizes } = useServices();
  return useSyncExternalStore(sizes.subscribe, sizes.getSnapshot);
}

/** "Available offline" y el espacio en el dispositivo; re-renderiza con cada cambio. */
export function useOffline(): OfflineSnapshot {
  // Sin el administrador (algunas pruebas arman los servicios a mano), nada marcado.
  const { offline } = useServices() as Partial<Services>;
  return useSyncExternalStore(offline?.subscribe ?? noSubscribe, offline?.getSnapshot ?? emptyOffline);
}

const EMPTY_OFFLINE: OfflineSnapshot = { loaded: false, marks: [], limit: null, usage: null, prompt: null, active: null, unsaved: [], report: null };
const emptyOffline = () => EMPTY_OFFLINE;
const noSubscribe = () => () => undefined;

/** El navegador del dispositivo, para lo que depende de él en "Available offline" (sección 9 del diseño). */
export function deviceTraits(): { ios: boolean; safari: boolean; phone: boolean } {
  if (typeof navigator === 'undefined') return { ios: false, safari: false, phone: false };
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const safari = /^((?!chrome|chromium|crios|fxios|android|edg).)*safari/i.test(ua);
  const phone = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return { ios, safari, phone };
}

/** La base de la página de medición del espacio (src/ui/StorageTest.tsx). */
export const STORAGE_TEST_DB = 'shotdocs-storage-test';
/** Lo que falta subir de cada workspace de este dispositivo, para la página de medición. */
export const PENDING_PREFIX = 'sd:pending:';

function savePendingForStorageTest(dbName: string, s: SyncStatus): void {
  const n = s.pendingOps + s.pendingPages + s.pendingFiles + s.pendingMedia + s.failedMedia + s.pendingComments + s.failedOps;
  try {
    localStorage.setItem(PENDING_PREFIX + dbName, String(n));
  } catch {
    // Sin `localStorage`: la página de medición lo dice.
  }
}

/** Borra los datos de prueba de la medición, si quedaron. */
export function dropStorageTest(): void {
  try {
    indexedDB.deleteDatabase(STORAGE_TEST_DB);
  } catch {
    // Sin IndexedDB no hay nada que borrar.
  }
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

/**
 * Un link público (Docs/Doc_Link_Publico.md): el servidor visto por `plink_*`, los comentarios con nombre y los headers
 * del link para el portero. Con esto la app arranca igual que con una cuenta, en modo liviano (P12).
 */
export interface LinkBoot {
  remote: SupabaseRemote;
  comments: CommentRemote;
  porteroHeaders: Record<string, string>;
}

/** Abre la base local del usuario y arranca la sincronización. `link`: abre un link público en vez de una cuenta. */
export function useBootServices(workspace: ActiveWorkspace, user: AuthUser, link?: LinkBoot): Boot {
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
      const remote = link?.remote ?? new SupabaseRemote(workspace.client, __APP_VERSION__);
      let workspaceId = (await db.get('meta', 'workspaceId')) as string | undefined;
      const firstLoad = !workspaceId;
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
        normalize: normalizeStructure,
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
        mediaProblem = stored('boot.mediaStorage', { reason: errorMessage(err) });
      }
      if (cancelled) {
        mediaDb?.close();
        return db.close();
      }
      // "Available offline" se arma después (necesita la cola): la cola le avisa por acá qué se usó y qué no entró.
      let offline: OfflineManager | null = null;
      const media = new MediaQueue(mediaDb, remote, {
        portero: (url) =>
          new Portero(url, link ? { link: link.porteroHeaders } : { token: sessionToken(workspace.client) }),
        projectOf: (pageId) => tree.get(pageId)?.workspace_id,
        unavailable: mediaProblem,
        // Se pegó una foto o un video de otro proyecto (papelera de archivos, paso 11).
        onForeignFile: (name) => notify(foreignFileNotice(name)),
        onUse: (id, how) => offline?.used(id, how),
        makeRoom: async (bytes) => (offline ? offline.makeRoom(bytes) : 0),
        onRejected: (file) => offline?.rejected(file),
      });
      await media.load().catch(() => undefined);
      // Las carpetas (P.9): solo la lista de trabajo, sin bytes, en otra base. Si no se abre, se suben igual
      // mientras la pestaña esté abierta (no se retoman después de cerrarla).
      let foldersDb: FoldersDb | null = null;
      try {
        foldersDb = await openFoldersDb(foldersDbName(dbName));
      } catch {
        foldersDb = null;
      }
      const folders = new FolderUploads(foldersDb, {
        portero: () => media.porteroClient() as unknown as FolderPortero | null,
        note: (id, text) => media.setFolderNote(id, text),
        uploaded: (id, bytes) => media.setFolderSize(id, bytes),
      });
      await folders.load().catch(() => undefined);
      // Los comentarios, también en una base aparte. Si no se abre, se leen con red pero no se escriben.
      let commentsDb: CommentsDb | null = null;
      let commentsProblem: string | undefined;
      try {
        commentsDb = await openCommentsDb(commentsDbName(dbName));
      } catch (err) {
        commentsProblem = stored('boot.commentsStorage', { reason: errorMessage(err) });
      }
      const commentsRemote = link?.comments ?? new SupabaseCommentRemote(workspace.client);
      const comments = new CommentQueue(commentsDb, commentsRemote, user.id, {
        unavailable: commentsProblem,
      });
      await comments.load().catch(() => undefined);
      // La campana: solo con una cuenta (un visitante de un link no menciona ni recibe menciones, ME7).
      let online = () => true;
      const mentions =
        commentsRemote instanceof SupabaseCommentRemote
          ? new MentionsInbox(commentsDb, commentsRemote, comments, { online: () => online() })
          : undefined;
      await mentions?.load();
      const sizes = new ProjectSizes(db, remote);
      await sizes.load().catch(() => undefined);
      const engine = new SyncEngine(remote, tree, docs, files, {
        appVersion: __APP_VERSION__,
        schemaVersion: DB_SCHEMA_VERSION,
        media,
        folders,
        access,
        comments,
        sizes,
        // El modo link (P12): un ciclo cada 30 s y solo las páginas que ya se bajaron o están abiertas.
        ...(link ? { intervalMs: 30_000, pullOnly: (id: string, cursor: number) => cursor > 0 || !!docs.peek(id) } : {}),
      });
      const traits = deviceTraits();
      offline = new OfflineManager({
        db: mediaDb,
        media,
        tree,
        docs,
        remote,
        comments,
        older: files,
        online: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false) && engine.getStatus().online,
        uploadsBusy: () => folders.busy(),
        storage: () => (typeof navigator === 'undefined' ? undefined : navigator.storage),
        ...traits,
        dbName,
        local: typeof localStorage === 'undefined' ? null : localStorage,
      });
      await offline.load().catch(() => undefined);
      if (cancelled) {
        mentions?.stop();
        mediaDb?.close();
        commentsDb?.close();
        foldersDb?.close();
        return db.close();
      }
      // Lo que sobró de un título de más de 500 caracteres va al principio de su página (titleRest.ts).
      const stopTitleRests = watchTitleRests(tree, docs, (rest) =>
        notify(t('page.titleRestMoved', { title: cutText(rest.title, 60) || t('common.untitled') })),
      );
      engine.start();
      online = () => engine.getStatus().online;
      mentions?.start();
      // Después de cada sincronización (y al volver la red), "Available offline" mira si algo cambió y baja lo que falte.
      const offlineManager = offline;
      let lastSync = engine.getStatus().lastSyncAt;
      let wasOnline = engine.getStatus().online;
      const unwatch = engine.subscribe(() => {
        const status = engine.getStatus();
        if (status.lastSyncAt !== lastSync || (status.online && !wasOnline)) offlineManager.maintainSoon();
        lastSync = status.lastSyncAt;
        wasOnline = status.online;
        // Lo que falta subir en este workspace, para la página de medición (no llena el disco con algo sin subir).
        savePendingForStorageTest(dbName, status);
      });
      // Una carpeta que terminó de subir (P.9) deja seguir a las bajadas que esperaban.
      let foldersBusy = folders.busy();
      const unwatchFolders = folders.subscribe(() => {
        const busy = folders.busy();
        // Empezó a subir una carpeta: la bajada en curso le deja la red. Terminó: las bajadas siguen.
        if (!foldersBusy && busy) offlineManager.yieldToUploads();
        if (foldersBusy && !busy) offlineManager.maintainSoon();
        foldersBusy = busy;
      });
      // Datos de una medición que quedaron (la app se cortó en el medio): se borran al abrir.
      dropStorageTest();
      offlineManager.start();
      // Si una invitación nueva sumó permisos, se sincroniza de nuevo para traer lo compartido.
      void accepted?.then((n) => {
        if (n > 0) void engine.syncNow();
      });
      void navigator.storage?.persist?.();
      let closing: Promise<void> | null = null;
      const shutdown = () => {
        closing ??= (async () => {
          const stopping = engine.stop();
          stopTitleRests();
          mentions?.stop();
          unwatch();
          unwatchFolders();
          offlineManager.stop();
          docs.dispose();
          media.dispose();
          folders.stop();
          try {
            await docs.flush();
            // El ciclo en curso corta en su próximo paso, pero puede estar esperando al servidor: se lo
            // espera un rato, no más (cerrar la base igual no rompe nada, ver `SyncEngine.cycle`).
            let timer: ReturnType<typeof setTimeout> | undefined;
            await Promise.race([stopping, new Promise((r) => (timer = setTimeout(r, 2000)))]);
            clearTimeout(timer);
          } finally {
            db.close();
            mediaDb?.close();
            commentsDb?.close();
            foldersDb?.close();
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
          folders,
          engine,
          access,
          remote,
          dbName,
          mediaDb,
          comments,
          commentsDb,
          mentions,
          sizes,
          offline: offlineManager,
          shutdown,
          // La recorrida no arranca sola con un link (muestra lo del equipo); la ayuda sí está.
          firstLoad: link ? false : firstLoad,
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
  }, [workspace, user, attempt, link]);

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
