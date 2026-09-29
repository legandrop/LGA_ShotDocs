import * as Y from 'yjs';
import {
  emptyDocState,
  hasUnsyncedContent,
  updateDocState,
  type DocState,
  type LocalDb,
} from './localDb';
import type { Remote } from './remote';
import { errorMessage, isPermanent, type RemoteUpdate } from './types';

export const ORIGIN_LOAD = Symbol('load');
export const ORIGIN_REMOTE = Symbol('remote');
/** Reparaciones de estructura: son ediciones locales, se guardan y se suben como cualquier otra. */
export const ORIGIN_REPAIR = Symbol('repair');

/** Con más updates guardados que esto, al abrir la página se fusionan en uno solo. */
const COMPACT_AT = 64;
const PULL_BATCH = 500;
const WRITE_RETRY_MS = 3000;

interface LiveDoc {
  doc: Y.Doc;
  refs: number;
  ready: Promise<void>;
}

export interface PageDocsOptions {
  /**
   * Repara la estructura del documento (ver structure.ts) y devuelve si tuvo que hacerlo. Se llama al
   * abrir y al recibir cambios.
   */
  normalize?: (doc: Y.Doc, origin: symbol) => boolean;
  /** Pone la estructura inicial en una página vacía (ver structure.ts). Devuelve si la puso. */
  seed?: (doc: Y.Doc, pageId: string, origin: symbol) => boolean;
}

/**
 * El contenido de cada página es un Y.Doc. Toda edición local se guarda en IndexedDB en cuanto ocurre;
 * subirla al servidor es un paso aparte que puede esperar a que haya red.
 *
 * Qué falta subir se calcula contra `syncedSV`, el vector de estado de lo que el servidor ya confirmó.
 * Así no importa si la app se cerró a mitad de camino: al volver, la diferencia se recalcula entera.
 */
export class PageDocs {
  private readonly live = new Map<string, LiveDoc>();
  private readonly locks = new Map<string, Promise<unknown>>();
  /** Ediciones locales que todavía no llegaron a IndexedDB, por página. */
  private readonly unsaved = new Map<string, Uint8Array[]>();
  /** Escritura en curso por página. Mientras corre, las ediciones nuevas se juntan en `unsaved`. */
  private readonly writes = new Map<string, Promise<void>>();
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private writeError: string | null = null;
  private disposed = false;

  /** Se llama después de cada edición local guardada. */
  onLocalChange?: (pageId: string) => void;
  /** Cambió el error de escritura local (null: se volvió a poder guardar). */
  onWriteError?: (message: string | null) => void;
  /** Problemas que no son de escritura local, por ejemplo un update ilegible del servidor. */
  onWarning?: (message: string) => void;

  constructor(
    private readonly db: LocalDb,
    private readonly options: PageDocsOptions = {},
  ) {}

  /**
   * Abre la página. Cada `open` necesita su `close`. Con `seed`, si la página está vacía le pone la
   * estructura inicial: se pide solo cuando el dispositivo tiene todo lo que hay en el servidor, porque
   * sobre un documento a medio bajar armaría una estructura paralela.
   */
  async open(pageId: string, { seed = false }: { seed?: boolean } = {}): Promise<Y.Doc> {
    let entry = this.live.get(pageId);
    if (!entry) {
      const doc = new Y.Doc();
      const created: LiveDoc = { doc, refs: 0, ready: Promise.resolve() };
      created.ready = this.loadInto(pageId, doc).then(() => {
        doc.on('update', (update: Uint8Array, origin: unknown) => {
          if (origin === ORIGIN_LOAD || origin === ORIGIN_REMOTE) return;
          this.persistLocal(pageId, update);
        });
        this.options.normalize?.(doc, ORIGIN_REPAIR);
      });
      this.live.set(pageId, created);
      entry = created;
    }
    entry.refs++;
    await entry.ready;
    if (seed) this.options.seed?.(entry.doc, pageId, ORIGIN_REPAIR);
    return entry.doc;
  }

  /** Corta los reintentos de escritura (al cerrar sesión o cambiar de usuario). */
  dispose(): void {
    this.disposed = true;
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
  }

  close(pageId: string): void {
    const entry = this.live.get(pageId);
    if (!entry) return;
    entry.refs--;
    if (entry.refs > 0) return;
    void this.withLock(pageId, async () => {
      await this.flush(pageId);
      // Con ediciones que no se pudieron guardar, el documento se queda en memoria y se sigue reintentando.
      if ((this.unsaved.get(pageId)?.length ?? 0) > 0) return;
      if (this.live.get(pageId) === entry && entry.refs === 0) {
        this.live.delete(pageId);
        entry.doc.destroy();
      }
    });
  }

  /** Espera a que terminen las escrituras locales en curso. */
  async flush(pageId?: string): Promise<void> {
    for (;;) {
      const pending = pageId ? [this.writes.get(pageId)].filter(Boolean) : [...this.writes.values()];
      if (pending.length === 0) return;
      await Promise.all(pending);
    }
  }

  /** Hay ediciones que todavía no están guardadas en el dispositivo. */
  hasUnsavedEdits(): boolean {
    return this.writes.size > 0 || [...this.unsaved.values()].some((b) => b.length > 0);
  }

  getWriteError(): string | null {
    return this.writeError;
  }

  /** Páginas con algo sin subir: sin confirmar por el servidor o todavía sin guardar en el dispositivo. */
  async unsyncedPages(): Promise<string[]> {
    await this.flush();
    const pages = new Set((await this.db.getAll('docState')).filter(hasUnsyncedContent).map((s) => s.pageId));
    for (const [pageId, batch] of this.unsaved) if (batch.length > 0) pages.add(pageId);
    return [...pages];
  }

  async states(): Promise<Map<string, DocState>> {
    return new Map((await this.db.getAll('docState')).map((s) => [s.pageId, s]));
  }

  /**
   * Sube lo que falte de una página. Tira error si el servidor no lo confirma.
   *
   * Lo que se sube sale de lo guardado en IndexedDB, leído en la misma transacción que la versión: un
   * ack nunca cubre ediciones que no viajaron (por ejemplo, las de otra pestaña o las todavía sin
   * guardar).
   */
  pushPage(pageId: string, remote: Remote): Promise<'clean' | 'pushed'> {
    return this.withLock(pageId, async () => {
      await this.flush(pageId);
      let state = (await this.db.get('docState', pageId)) ?? emptyDocState(pageId);
      let pushed = false;
      for (let round = 0; round < 5; round++) {
        let pending = state.pending;
        if (!pending) {
          if (state.version <= state.ackedVersion) break;
          const saved = await this.readSaved(pageId);
          const next = {
            id: crypto.randomUUID(),
            update: Y.encodeStateAsUpdate(saved.doc, saved.state.syncedSV),
            sv: Y.encodeStateVector(saved.doc),
            version: saved.state.version,
          };
          saved.doc.destroy();
          state = await updateDocState(this.db, pageId, (s) => {
            s.pending = next;
          });
          pending = next;
        }
        let seq: number;
        try {
          seq = await remote.pushUpdate(pageId, pending.id, pending.update);
        } catch (err) {
          await updateDocState(this.db, pageId, (s) => {
            s.lastError = errorMessage(err);
            s.rejected = isPermanent(err) ? errorMessage(err) : undefined;
          });
          throw err;
        }
        const confirmed = pending;
        state = await updateDocState(this.db, pageId, (s) => {
          if (s.pending?.id !== confirmed.id) return;
          s.syncedSV = confirmed.sv;
          s.ackedVersion = Math.max(s.ackedVersion, confirmed.version);
          // Lo que se acaba de subir ya está en el dispositivo: si nadie subió nada en el medio, el cursor
          // avanza y la página no figura como "a medio bajar" por culpa de lo propio.
          if (seq === s.cursor + 1) s.cursor = seq;
          s.pending = undefined;
          s.lastError = undefined;
          s.rejected = undefined;
        });
        pushed = true;
      }
      return pushed ? 'pushed' : 'clean';
    });
  }

  /**
   * Vuelve a intentar las páginas que el servidor había rechazado. El envío rechazado se descarta (su
   * contenido sigue en el dispositivo): el próximo se calcula de nuevo e incluye las ediciones posteriores.
   */
  async clearRejected(): Promise<void> {
    for (const state of await this.db.getAll('docState')) {
      if (state.rejected) {
        await updateDocState(this.db, state.pageId, (s) => {
          s.rejected = undefined;
          s.pending = undefined;
        });
      }
    }
  }

  /** Baja lo nuevo de una página y lo guarda. Si está abierta, lo aplica también en el editor. */
  pullPage(pageId: string, remote: Remote): Promise<number> {
    return this.withLock(pageId, async () => {
      let total = 0;
      for (;;) {
        const cursor = (await this.db.get('docState', pageId))?.cursor ?? 0;
        const updates = await remote.pullUpdates(pageId, cursor, PULL_BATCH);
        if (updates.length === 0) break;
        await this.applyRemote(pageId, updates);
        total += updates.length;
        if (updates.length < PULL_BATCH) break;
      }
      return total;
    });
  }

  private async applyRemote(pageId: string, updates: RemoteUpdate[]): Promise<void> {
    const valid = updates.filter((u) => {
      try {
        Y.decodeUpdate(u.data);
        return true;
      } catch {
        // Queda intacto en el servidor; este dispositivo no lo puede leer (por ejemplo, porque lo escribió
        // una versión más nueva de la app).
        this.onWarning?.(`Could not read an update from the server (page ${pageId}, #${u.seq}).`);
        return false;
      }
    });
    const merged = valid.length > 0 ? Y.mergeUpdates(valid.map((u) => u.data)) : null;
    const maxSeq = Math.max(...updates.map((u) => u.seq));

    const tx = this.db.transaction(['docUpdates', 'docState'], 'readwrite');
    const state = (await tx.objectStore('docState').get(pageId)) ?? emptyDocState(pageId);
    if (maxSeq <= state.cursor) {
      await tx.done;
      return;
    }
    if (merged) await tx.objectStore('docUpdates').add({ pageId, data: merged });
    state.cursor = maxSeq;
    await tx.objectStore('docState').put(state);
    await tx.done;

    const live = this.live.get(pageId);
    if (merged && live) {
      await live.ready;
      this.applyToLive(live.doc, merged);
    }
  }

  /**
   * Aplica lo que llegó del servidor a un documento abierto en el editor. Si lo que llega rompe la
   * estructura, la reparación va en la MISMA transacción: el editor reacciona al final de cada
   * transacción y, si llegara a ver la estructura rota, borraría la parte que no puede mostrar.
   */
  private applyToLive(doc: Y.Doc, update: Uint8Array): void {
    const normalize = this.options.normalize;
    let needsRepair = false;
    if (normalize) {
      const probe = new Y.Doc();
      Y.applyUpdate(probe, Y.encodeStateAsUpdate(doc));
      Y.applyUpdate(probe, update);
      needsRepair = normalize(probe, ORIGIN_REPAIR);
      probe.destroy();
    }
    if (!needsRepair) {
      Y.applyUpdate(doc, update, ORIGIN_REMOTE);
      return;
    }
    // Con origen local: la reparación se guarda y se sube. Lo remoto que viaja con ella ya está en el
    // servidor, así que subirlo de nuevo no cambia nada.
    doc.transact(() => {
      Y.applyUpdate(doc, update);
      normalize!(doc, ORIGIN_REPAIR);
    }, ORIGIN_REPAIR);
  }

  /**
   * Guarda una edición local. La primera escritura arranca en el acto; las ediciones que llegan mientras
   * corre se juntan y salen todas en la siguiente transacción. Así nunca se acumula una fila de
   * escrituras: si la app se cierra de golpe, lo que puede faltar es lo de la última transacción.
   */
  private persistLocal(pageId: string, update: Uint8Array): void {
    const buffer = this.unsaved.get(pageId);
    if (buffer) buffer.push(update);
    else this.unsaved.set(pageId, [update]);
    this.startWrite(pageId);
  }

  private startWrite(pageId: string): void {
    if (this.writes.has(pageId) || this.disposed) return;
    const timer = this.retryTimers.get(pageId);
    if (timer) {
      clearTimeout(timer);
      this.retryTimers.delete(pageId);
    }

    const run = (async () => {
      for (;;) {
        const batch = this.unsaved.get(pageId) ?? [];
        if (batch.length === 0) break;
        this.unsaved.set(pageId, []);
        try {
          const tx = this.db.transaction(['docUpdates', 'docState'], 'readwrite');
          const data = batch.length === 1 ? batch[0] : Y.mergeUpdates(batch);
          await tx.objectStore('docUpdates').add({ pageId, data });
          const store = tx.objectStore('docState');
          const state = (await store.get(pageId)) ?? emptyDocState(pageId);
          state.version += 1;
          await store.put(state);
          await tx.done;
        } catch (err) {
          // Vuelven a la cola: siguen en el documento en memoria y se reintentan solas.
          this.unsaved.set(pageId, [...batch, ...(this.unsaved.get(pageId) ?? [])]);
          this.setWriteError(errorMessage(err));
          this.retryTimers.set(
            pageId,
            setTimeout(() => this.startWrite(pageId), WRITE_RETRY_MS),
          );
          break;
        }
        this.setWriteError(null);
        this.onLocalChange?.(pageId);
      }
    })().finally(() => this.writes.delete(pageId));
    this.writes.set(pageId, run);
  }

  private setWriteError(message: string | null): void {
    // Mientras quede algo sin guardar, el error no se limpia.
    if (message === null && [...this.unsaved.values()].some((b) => b.length > 0)) return;
    if (message === this.writeError) return;
    this.writeError = message;
    this.onWriteError?.(message);
  }

  /** Lee en una sola transacción lo guardado de una página y su estado, y arma el documento. */
  private async readSaved(pageId: string): Promise<{ doc: Y.Doc; state: DocState }> {
    const tx = this.db.transaction(['docUpdates', 'docState'], 'readonly');
    const [rows, stored] = await Promise.all([
      tx.objectStore('docUpdates').index('pageId').getAll(pageId),
      tx.objectStore('docState').get(pageId),
    ]);
    await tx.done;
    const doc = new Y.Doc();
    if (rows.length > 0) Y.applyUpdate(doc, Y.mergeUpdates(rows.map((r) => r.data)), ORIGIN_LOAD);
    return { doc, state: stored ?? emptyDocState(pageId) };
  }

  /** Carga en `doc` todo lo guardado de la página, y compacta si hay muchos updates sueltos. */
  private async loadInto(pageId: string, doc: Y.Doc): Promise<void> {
    const tx = this.db.transaction('docUpdates', 'readwrite');
    const index = tx.store.index('pageId');
    const keys = await index.getAllKeys(pageId);
    const rows = await index.getAll(pageId);
    const merged = rows.length > 0 ? Y.mergeUpdates(rows.map((r) => r.data)) : null;
    if (merged && rows.length > COMPACT_AT) {
      await tx.store.add({ pageId, data: merged });
      await Promise.all(keys.map((k) => tx.store.delete(k)));
    }
    await tx.done;
    if (merged) Y.applyUpdate(doc, merged, ORIGIN_LOAD);
  }

  private withLock<T>(pageId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(pageId) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    this.locks.set(
      pageId,
      run.catch(() => undefined),
    );
    return run;
  }
}
