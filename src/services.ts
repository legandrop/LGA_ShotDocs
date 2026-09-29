import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { AuthUser } from './auth';
import { projectRef, supabase } from './supabase';
import { PageDocs } from './sync/docs';
import { SyncEngine, type SyncStatus } from './sync/engine';
import { PageFiles } from './sync/files';
import { localDbName, openLocalDb, type LocalDb } from './sync/localDb';
import { SupabaseRemote } from './sync/remote';
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

type Boot = { state: 'loading' } | { state: 'ready'; services: Services } | { state: 'error'; message: string };

/** Abre la base local del usuario y arranca la sincronización. */
export function useBootServices(user: AuthUser): Boot {
  const [boot, setBoot] = useState<Boot>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      const db = await openLocalDb(localDbName(projectRef, user.id));
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
      const docs = new PageDocs(db);
      const files = new PageFiles(db, remote);
      const engine = new SyncEngine(remote, tree, docs, files);
      if (cancelled) return db.close();
      engine.start();
      void navigator.storage?.persist?.();
      cleanup = () => {
        engine.stop();
        void docs.flush().finally(() => db.close());
      };
      setBoot({ state: 'ready', services: { user, db, tree, docs, files, engine } });
    })().catch((err) => {
      if (!cancelled) setBoot({ state: 'error', message: errorMessage(err) });
    });

    return () => {
      cancelled = true;
      cleanup?.();
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
