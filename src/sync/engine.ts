import type { PageDocs } from './docs';
import type { PageFiles } from './files';
import { hasUnsyncedContent } from './localDb';
import type { Remote } from './remote';
import type { PageTree } from './tree';
import { errorMessage, isPermanent, type QueuedOp } from './types';

export interface SyncStatus {
  /** El último intento de hablar con el servidor funcionó. */
  online: boolean;
  syncing: boolean;
  pendingOps: number;
  pendingPages: number;
  pendingFiles: number;
  /** Cambios del árbol que el servidor rechazó para siempre. */
  failedOps: number;
  lastError: string | null;
  lastSyncAt: number | null;
}

const INTERVAL_MS = 10_000;
const DEBOUNCE_MS = 1_200;
const PULL_CONCURRENCY = 4;

/**
 * Un ciclo de sincronización, siempre en este orden:
 * 1. Cambios del árbol, en el orden en que se hicieron (así una página existe antes que su contenido).
 * 2. El árbol completo del servidor.
 * 3. Imágenes pendientes.
 * 4. Contenido pendiente de cada página.
 * 5. Contenido nuevo de las páginas que cambiaron en el servidor.
 * Nunca hay dos ciclos a la vez.
 */
export class SyncEngine {
  private status: SyncStatus = {
    online: true,
    syncing: false,
    pendingOps: 0,
    pendingPages: 0,
    pendingFiles: 0,
    failedOps: 0,
    lastError: null,
    lastSyncAt: null,
  };
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private readonly cleanups: (() => void)[] = [];

  constructor(
    private readonly remote: Remote,
    private readonly tree: PageTree,
    private readonly docs: PageDocs,
    private readonly files: PageFiles,
  ) {
    const poke = () => this.poke();
    tree.onQueued = poke;
    files.onQueued = poke;
    docs.onLocalChange = poke;
    docs.onError = (err) => this.patch({ lastError: `No se pudo guardar en el dispositivo: ${errorMessage(err)}` });
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getStatus = (): SyncStatus => this.status;

  start(): void {
    const onWake = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void this.syncNow();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onWake);
      window.addEventListener('focus', onWake);
      document.addEventListener('visibilitychange', onWake);
      this.cleanups.push(() => {
        window.removeEventListener('online', onWake);
        window.removeEventListener('focus', onWake);
        document.removeEventListener('visibilitychange', onWake);
      });
    }
    this.interval = setInterval(onWake, INTERVAL_MS);
    void this.refreshCounts();
    void this.syncNow();
  }

  stop(): void {
    this.stopped = true;
    if (this.interval) clearInterval(this.interval);
    if (this.timer) clearTimeout(this.timer);
    for (const fn of this.cleanups) fn();
  }

  /** Hubo un cambio local: sincroniza en un rato, agrupando los cambios seguidos. */
  poke(): void {
    void this.refreshCounts();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.syncNow(), DEBOUNCE_MS);
  }

  /** Corre un ciclo ya. Si hay uno en curso, corre otro apenas termine. */
  syncNow(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.cycle();
      } while (this.again && !this.stopped);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async cycle(): Promise<void> {
    this.patch({ syncing: true });
    try {
      await this.pushOps();
      const rows = await this.remote.fetchTree(this.tree.workspaceId);
      await this.tree.setSnapshot(rows);

      const fileError = await this.files.pushPending((pageId) => this.tree.hasPendingCreate(pageId));

      let contentError: string | null = null;
      for (const pageId of await this.docs.unsyncedPages()) {
        if (this.tree.hasPendingCreate(pageId)) continue;
        try {
          await this.docs.pushPage(pageId, this.remote);
        } catch (err) {
          if (!isPermanent(err)) throw err;
          contentError = errorMessage(err);
        }
      }

      const states = await this.docs.states();
      const stale = rows.filter((r) => r.update_seq > (states.get(r.id)?.cursor ?? 0)).map((r) => r.id);
      await runPool(stale, PULL_CONCURRENCY, (id) => this.docs.pullPage(id, this.remote));

      this.patch({ online: true, lastError: contentError ?? fileError, lastSyncAt: Date.now() });
    } catch (err) {
      this.patch({ online: isPermanent(err), lastError: errorMessage(err) });
    } finally {
      await this.refreshCounts();
      this.patch({ syncing: false });
    }
  }

  private async pushOps(): Promise<void> {
    for (const op of this.tree.pendingOps()) {
      try {
        await this.applyOp(op);
        await this.tree.ackOp(op);
      } catch (err) {
        if (!isPermanent(err)) throw err;
        await this.tree.failOp(op, errorMessage(err));
      }
    }
  }

  private applyOp({ op }: QueuedOp): Promise<void> {
    return op.kind === 'create' ? this.remote.createPage(op.page) : this.remote.updatePage(op.id, op.patch);
  }

  private async refreshCounts(): Promise<void> {
    const [states, pendingFiles] = await Promise.all([this.docs.states(), this.files.pendingCount()]);
    let pendingPages = 0;
    for (const s of states.values()) if (hasUnsyncedContent(s)) pendingPages++;
    this.patch({
      pendingOps: this.tree.pendingOps().length,
      failedOps: this.tree.failedOps().length,
      pendingPages,
      pendingFiles,
    });
  }

  private patch(changes: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...changes };
    for (const fn of this.listeners) fn();
  }
}

async function runPool<T>(items: T[], size: number, fn: (item: T) => Promise<unknown>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}
