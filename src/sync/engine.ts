import type { PageDocs } from './docs';
import type { PageFiles } from './files';
import { hasUnsyncedContent } from './localDb';
import type { Remote } from './remote';
import type { PageTree } from './tree';
import { errorMessage, isNetworkError, isPermanent, type QueuedOp } from './types';

export interface SyncStatus {
  /** El último intento de hablar con el servidor tuvo respuesta (aunque fuera un error). */
  online: boolean;
  syncing: boolean;
  pendingOps: number;
  /** Páginas con contenido sin subir, incluidas las que todavía no se pudieron guardar en el dispositivo. */
  pendingPages: number;
  pendingFiles: number;
  /** Cambios del árbol que el servidor rechazó para siempre. */
  failedOps: number;
  /** Páginas cuyo contenido el servidor rechazó para siempre (por ejemplo, por tamaño). */
  rejectedPages: number;
  /** No se pudo guardar en el dispositivo. Se reintenta solo y no se limpia hasta que funcione. */
  localError: string | null;
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
 * 3. Contenido pendiente de cada página.
 * 4. Contenido nuevo de las páginas que cambiaron en el servidor.
 * 5. Imágenes pendientes (al final: una foto grande en una red mala no frena el texto).
 * Nunca hay dos ciclos a la vez.
 */
export class SyncEngine {
  private status: SyncStatus = {
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    syncing: false,
    pendingOps: 0,
    pendingPages: 0,
    pendingFiles: 0,
    failedOps: 0,
    rejectedPages: 0,
    localError: null,
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
    docs.onWriteError = (message) => {
      this.patch({ localError: message });
      void this.refreshCounts();
    };
    docs.onWarning = (message) => this.patch({ lastError: message });
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
    const onOffline = () => this.patch({ online: false });
    if (typeof window !== 'undefined') {
      window.addEventListener('offline', onOffline);
      window.addEventListener('online', onWake);
      window.addEventListener('focus', onWake);
      document.addEventListener('visibilitychange', onWake);
      this.cleanups.push(() => {
        window.removeEventListener('offline', onOffline);
        window.removeEventListener('online', onWake);
        window.removeEventListener('focus', onWake);
        document.removeEventListener('visibilitychange', onWake);
      });
    }
    this.interval = setInterval(onWake, INTERVAL_MS);
    // Lo que el servidor rechazó se vuelve a intentar una vez por apertura: puede que ya se haya arreglado.
    void this.docs.clearRejected().then(() => this.syncNow());
  }

  stop(): void {
    this.stopped = true;
    if (this.interval) clearInterval(this.interval);
    if (this.timer) clearTimeout(this.timer);
    for (const fn of this.cleanups) fn();
  }

  /** Vuelve a intentar todo lo que el servidor rechazó: cambios del árbol y contenido. */
  async retryRejected(): Promise<void> {
    await this.tree.retryFailed();
    await this.docs.clearRejected();
    await this.syncNow();
  }

  /** El servidor tiene contenido de la página que este dispositivo todavía no bajó. */
  async isMissingContent(pageId: string): Promise<boolean> {
    const serverSeq = this.tree.get(pageId)?.update_seq ?? 0;
    const cursor = (await this.docs.states()).get(pageId)?.cursor ?? 0;
    return serverSeq > cursor && !this.tree.hasUnsentCreate(pageId);
  }

  /**
   * Antes de abrir una página cuyo contenido el dispositivo todavía no tiene, lo baja, esperando hasta
   * `timeoutMs`. Devuelve si quedó todo bajado.
   */
  async prefetchPage(pageId: string, timeoutMs = 4000): Promise<boolean> {
    if (!(await this.isMissingContent(pageId))) return true;
    const pull = this.docs.pullPage(pageId, this.remote).catch(() => undefined);
    await Promise.race([pull, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
    return !(await this.isMissingContent(pageId));
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

      let contentError: string | null = null;
      const states = await this.docs.states();
      for (const pageId of await this.docs.unsyncedPages()) {
        if (this.tree.hasUnsentCreate(pageId) || states.get(pageId)?.rejected) continue;
        try {
          await this.docs.pushPage(pageId, this.remote);
        } catch (err) {
          if (!isPermanent(err)) throw err;
          contentError = errorMessage(err);
        }
      }

      const cursors = await this.docs.states();
      const stale = rows.filter((r) => r.update_seq > (cursors.get(r.id)?.cursor ?? 0)).map((r) => r.id);
      await runPool(stale, PULL_CONCURRENCY, (id) =>
        this.docs.pullPage(id, this.remote).catch((err) => {
          if (!isPermanent(err)) throw err;
          contentError = errorMessage(err);
        }),
      );

      const fileError = await this.files.pushPending((pageId) => this.tree.hasUnsentCreate(pageId));

      this.patch({ online: true, lastError: contentError ?? fileError, lastSyncAt: Date.now() });
    } catch (err) {
      this.patch({ online: !isNetworkError(err), lastError: errorMessage(err) });
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
    const [states, unsynced, pendingFiles] = await Promise.all([
      this.docs.states(),
      this.docs.unsyncedPages(),
      this.files.pendingCount(),
    ]);
    let rejectedPages = 0;
    for (const s of states.values()) if (s.rejected && hasUnsyncedContent(s)) rejectedPages++;
    this.patch({
      pendingOps: this.tree.pendingOps().length,
      failedOps: this.tree.failedOps().length,
      pendingPages: unsynced.length,
      rejectedPages,
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
