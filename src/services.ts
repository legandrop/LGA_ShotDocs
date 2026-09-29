import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { AuthUser } from './auth';
import { projectRef, supabase } from './supabase';
import { PageDocs } from './sync/docs';
import { SyncEngine, type SyncStatus } from './sync/engine';
import { PageFiles } from './sync/files';
import { localDbName, openLocalDb, type LocalDb } from './sync/localDb';
import { SupabaseRemote } from './sync/remote';
import { mergeRootGroups, seedIfEmpty } from './sync/structure';
import { PageTree } from './sync/tree';
import { errorMessage } from './sync/types';

export interface Services {
  user: AuthUser;
  db: LocalDb;
  tree: PageTree;
  docs: PageDocs;
  files: PageFiles;
  engine: SyncEngine;
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

type Boot =
  | { state: 'loading' }
  | { state: 'busy'; takeOver: () => void }
  | { state: 'lost' }
  | { state: 'ready'; services: Services }
  | { state: 'error'; message: string };

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
export function useBootServices(user: AuthUser): Boot {
  const [boot, setBoot] = useState<Boot>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    const abort = new AbortController();
    let releaseLock: (() => void) | null = null;

    (async () => {
      const dbName = localDbName(projectRef, user.id);
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
      const remote = new SupabaseRemote(supabase!);
      let workspaceId = (await db.get('meta', 'workspaceId')) as string | undefined;
      if (!workspaceId) {
        try {
          workspaceId = await remote.ensureWorkspace();
          await db.put('meta', workspaceId, 'workspaceId');
        } catch (err) {
          db.close();
          if (!cancelled) {
            setBoot({
              state: 'error',
              message: `Setting up your workspace the first time needs an internet connection (${errorMessage(err)}).`,
            });
          }
          return;
        }
      }
      if (cancelled) return db.close();

      const tree = new PageTree(db, workspaceId);
      await tree.load();
      const docs = new PageDocs(db, { normalize: mergeRootGroups, seed: seedIfEmpty });
      const files = new PageFiles(db, remote);
      const engine = new SyncEngine(remote, tree, docs, files);
      if (cancelled) return db.close();
      engine.start();
      void navigator.storage?.persist?.();
      cleanup = () => {
        engine.stop();
        docs.dispose();
        void docs.flush().finally(() => {
          db.close();
          releaseLock?.();
        });
      };
      setBoot({ state: 'ready', services: { user, db, tree, docs, files, engine } });
    })().catch((err) => {
      if (!cancelled) setBoot({ state: 'error', message: errorMessage(err) });
    });

    return () => {
      cancelled = true;
      abort.abort();
      if (cleanup) cleanup();
      else releaseLock?.();
    };
  }, [user, attempt]);

  useEffect(() => {
    if (boot.state !== 'error') return;
    const retry = () => setAttempt((n) => n + 1);
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [boot.state]);

  return boot;
}
