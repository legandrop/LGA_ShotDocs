import * as Y from 'yjs';
import {
  emptyDocState,
  hasUnsyncedContent,
  updateDocState,
  type DocState,
  type LocalDb,
} from './localDb';
import type { Remote } from './remote';
import { errorMessage, type RemoteUpdate } from './types';

export const ORIGIN_LOAD = Symbol('load');
export const ORIGIN_REMOTE = Symbol('remote');

/** Con más updates guardados que esto, al abrir la página se fusionan en uno solo. */
const COMPACT_AT = 64;
const PULL_BATCH = 500;

interface LiveDoc {
  doc: Y.Doc;
  refs: number;
  ready: Promise<void>;
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

  /** Se llama después de cada edición local guardada. */
  onLocalChange?: (pageId: string) => void;
  onError?: (err: unknown) => void;

  constructor(private readonly db: LocalDb) {}

  /** Abre la página para editarla. Cada `open` necesita su `close`. */
  async open(pageId: string): Promise<Y.Doc> {
    let entry = this.live.get(pageId);
    if (!entry) {
      const doc = new Y.Doc();
      const created: LiveDoc = { doc, refs: 0, ready: Promise.resolve() };
      created.ready = this.loadInto(pageId, doc).then(() => {
        doc.on('update', (update: Uint8Array, origin: unknown) => {
          if (origin === ORIGIN_LOAD || origin === ORIGIN_REMOTE) return;
          this.persistLocal(pageId, update);
        });
      });
      this.live.set(pageId, created);
      entry = created;
    }
    entry.refs++;
    await entry.ready;
    return entry.doc;
  }

  close(pageId: string): void {
    const entry = this.live.get(pageId);
    if (!entry) return;
    entry.refs--;
    if (entry.refs > 0) return;
    void this.withLock(pageId, async () => {
      await this.flush(pageId);
      if (this.live.get(pageId) === entry && entry.refs === 0) {
        this.live.delete(pageId);
        entry.doc.destroy();
      }
    });
  }

  /** Espera a que las ediciones locales ya hechas estén guardadas en el dispositivo. */
  async flush(pageId?: string): Promise<void> {
    for (;;) {
      const pending = pageId ? [this.writes.get(pageId)].filter(Boolean) : [...this.writes.values()];
      if (pending.length === 0) return;
      await Promise.all(pending);
    }
  }

  async unsyncedPages(): Promise<string[]> {
    await this.flush();
    const states = await this.db.getAll('docState');
    return states.filter(hasUnsyncedContent).map((s) => s.pageId);
  }

  async states(): Promise<Map<string, DocState>> {
    return new Map((await this.db.getAll('docState')).map((s) => [s.pageId, s]));
  }

  /** Sube lo que falte de una página. Tira error si el servidor no lo confirma. */
  pushPage(pageId: string, remote: Remote): Promise<'clean' | 'pushed'> {
    return this.withLock(pageId, async () => {
      await this.flush(pageId);
      let state = (await this.db.get('docState', pageId)) ?? emptyDocState(pageId);
      let pushed = false;
      for (let round = 0; round < 5; round++) {
        let pending = state.pending;
        if (!pending) {
          if (state.version <= state.ackedVersion) break;
          // La versión se lee antes que el contenido: todo lo que cuenta ya está en el doc que se lee
          // después. En el peor caso se sube algo dos veces, y Yjs lo aplica una sola.
          const version = state.version;
          const syncedSV = state.syncedSV;
          const { update, sv } = await this.withDoc(pageId, (doc) => ({
            update: Y.encodeStateAsUpdate(doc, syncedSV),
            sv: Y.encodeStateVector(doc),
          }));
          const next = { id: crypto.randomUUID(), update, sv, version };
          state = await updateDocState(this.db, pageId, (s) => {
            s.pending = next;
          });
          pending = next;
        }
        try {
          await remote.pushUpdate(pageId, pending.id, pending.update);
        } catch (err) {
          await updateDocState(this.db, pageId, (s) => {
            s.lastError = errorMessage(err);
          });
          throw err;
        }
        const confirmed = pending;
        state = await updateDocState(this.db, pageId, (s) => {
          if (s.pending?.id !== confirmed.id) return;
          s.syncedSV = confirmed.sv;
          s.ackedVersion = Math.max(s.ackedVersion, confirmed.version);
          s.pending = undefined;
          s.lastError = undefined;
        });
        pushed = true;
      }
      return pushed ? 'pushed' : 'clean';
    });
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
      } catch (err) {
        this.onError?.(new Error(`Update ${u.seq} de ${pageId} ilegible: ${errorMessage(err)}`));
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
      Y.applyUpdate(live.doc, merged, ORIGIN_REMOTE);
    }
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
    if (this.writes.has(pageId)) return;

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
          // Vuelven a la cola: siguen en el documento en memoria y se reintentan con la próxima edición.
          this.unsaved.set(pageId, [...batch, ...(this.unsaved.get(pageId) ?? [])]);
          this.onError?.(err);
          break;
        }
        this.onLocalChange?.(pageId);
      }
    })().finally(() => this.writes.delete(pageId));
    this.writes.set(pageId, run);
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

  private async withDoc<T>(pageId: string, fn: (doc: Y.Doc) => T): Promise<T> {
    const live = this.live.get(pageId);
    if (live) {
      await live.ready;
      return fn(live.doc);
    }
    const doc = new Y.Doc();
    try {
      await this.loadInto(pageId, doc);
      return fn(doc);
    } finally {
      doc.destroy();
    }
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
