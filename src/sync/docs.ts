import * as Y from 'yjs';
import { t } from '../i18n';
import { buildUpload, encodeRanges, rangesOf, unionRanges, type DeleteRanges } from './deleteSets';
import {
  DIRTY_PREFIX,
  dirtyKey,
  dirtyRange,
  emptyDocState,
  GENERATION_KEY,
  hasUnsyncedContent,
  onlyGuard,
  storedGeneration,
  updateDocState,
  type DocState,
  type LocalDb,
} from './localDb';
import { APP_OUTDATED, type Remote } from './remote';
import { errorMessage, isPermanent, isTimeout, type RemoteUpdate } from './types';

export const ORIGIN_LOAD = Symbol('load');
export const ORIGIN_REMOTE = Symbol('remote');
/** Reparaciones de estructura: son ediciones locales, se guardan y se suben como cualquier otra. */
export const ORIGIN_REPAIR = Symbol('repair');
/**
 * La semilla de una página vacía (ver structure.ts). Queda solo en memoria hasta la primera edición local
 * y se guarda junto con ella, en la misma transacción: abrir una página vacía sin escribir no deja nada
 * pendiente ni sube nada.
 */
export const ORIGIN_SEED = Symbol('seed');

/** Con más updates guardados que esto, al abrir la página se fusionan en uno solo. */
const COMPACT_AT = 64;
const PULL_BATCH = 500;
const WRITE_RETRY_MS = 3000;

interface LiveDoc {
  doc: Y.Doc;
  refs: number;
  ready: Promise<void>;
  /**
   * Llegó del servidor algo que esta versión no puede mostrar y no se aplicó en memoria (sí quedó
   * guardado). La próxima vez que se abra la página se vuelve a cargar desde lo guardado.
   */
  stale?: boolean;
  /**
   * Se reparó solo en memoria (quien no puede escribir la página): la reparación no está guardada, así que
   * la próxima apertura sin nadie usándolo vuelve a cargar desde lo guardado.
   */
  repairedInMemory?: boolean;
  /**
   * La semilla que se le puso a esta página vacía y que todavía no se guardó (el update tal como lo aplicó
   * Yjs). Sale junto con la primera edición local: lo que se escriba después cuelga de la raíz de la
   * semilla, así que guardar una sin la otra dejaría la edición sin poder mostrarse al volver a abrir.
   */
  unsavedSeed?: Uint8Array;
  /** Se armó la versión guardia (ver `DocState.guardVersion`): la página se puede editar. */
  guarded?: boolean;
  /** Ya terminó de cargar lo guardado (`ready` se resolvió): `peek` lo puede devolver. */
  loaded?: boolean;
}

export interface PageDocsOptions {
  /**
   * Repara la estructura del documento (ver structure.ts) y devuelve si tuvo que hacerlo. Se llama al
   * abrir y al recibir cambios.
   */
  normalize?: (doc: Y.Doc, origin: symbol) => boolean;
  /** Pone la estructura inicial en una página vacía (ver structure.ts). Devuelve si la puso. */
  seed?: (doc: Y.Doc, pageId: string, origin: symbol) => boolean;
  /**
   * Si esta versión de la app puede mostrar el documento sin perder nada. Si no, lo que llega del servidor
   * se guarda pero no se aplica en el editor abierto: el editor borraría lo que no conoce, y ese borrado
   * llegaría a todos (ver ui/unknownContent.ts).
   */
  supports?: (doc: Y.Doc) => boolean;
  /**
   * Si la persona puede escribir el contenido de la página (paso 9: nivel 3 o más). Si no, la reparación se
   * hace solo en memoria, sin guardarla ni subirla: el servidor la rechazaría en cada apertura. Sin la
   * opción, se puede.
   */
  canWrite?: (pageId: string) => boolean;
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
  /** Escrituras en curso por página: la cadena de todas, para poder esperarlas (`flush`). */
  private readonly writes = new Map<string, Promise<void>>();
  /** Páginas con una escritura ya programada para el final de la tarea actual del navegador. */
  private readonly scheduled = new Set<string>();
  /**
   * Tandas escritas en transacciones que todavía no terminaron, por página. Cada transacción nueva las
   * vuelve a incluir (Yjs no duplica): si una anterior falla después de que la siguiente se confirmó, lo
   * guardado nunca queda colgando de una tanda que no está.
   */
  private readonly inFlight = new Map<string, Set<Uint8Array>>();
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private writeError: string | null = null;
  private disposed = false;

  /**
   * Quienes escuchan cada edición local guardada: la sincronización (para subirla) y el índice de la
   * búsqueda del proyecto (para volver a leer la página). Ver `subscribeLocalChange`.
   */
  private readonly localChangeListeners = new Set<(pageId: string) => void>();
  /** Cambió el error de escritura local (null: se volvió a poder guardar). */
  onWriteError?: (message: string | null) => void;
  /** Problemas que no son de escritura local, por ejemplo un update ilegible del servidor. */
  onWarning?: (message: string) => void;
  private readonly unsupportedListeners = new Set<(pageId: string) => void>();
  private readonly renderFailedListeners = new Set<(pageId: string) => void>();

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
    if ((entry?.stale || entry?.repairedInMemory) && entry.refs === 0) {
      // Le falta algo que llegó del servidor: se arma de nuevo desde lo guardado. (Con alguien que todavía
      // lo tiene abierto se sigue usando el mismo; ese alguien ya recibió el aviso.)
      this.live.delete(pageId);
      entry.doc.destroy();
      entry = undefined;
    }
    if (!entry) {
      const doc = new Y.Doc();
      const created: LiveDoc = { doc, refs: 0, ready: Promise.resolve() };
      created.ready = this.loadInto(pageId, doc).then(async () => {
        const writable = this.options.canWrite?.(pageId) !== false;
        // Antes de que se pueda editar nada (también la reparación de abajo).
        if (writable) {
          created.guarded = true;
          await this.armGuard(pageId);
        }
        doc.on('update', (update: Uint8Array, origin: unknown) => {
          if (origin === ORIGIN_SEED) {
            created.unsavedSeed = update;
            return;
          }
          if (origin === ORIGIN_LOAD || origin === ORIGIN_REMOTE) return;
          if (!created.guarded) {
            // Se abrió sin permiso de escritura y ahora se escribe (le dieron "Edit" con la página abierta).
            created.guarded = true;
            this.track(pageId, this.armGuard(pageId));
          }
          if (created.repairedInMemory) {
            // Lo escrito puede colgar de la reparación hecha solo en memoria (y de la semilla): se guarda el
            // documento entero, así la reparación queda guardada con lo que depende de ella.
            created.repairedInMemory = false;
            created.unsavedSeed = undefined;
            this.persistLocal(pageId, [Y.encodeStateAsUpdate(doc)]);
            return;
          }
          const seed = created.unsavedSeed;
          created.unsavedSeed = undefined;
          // La semilla va primero y en el mismo lote: se guardan en la misma transacción.
          this.persistLocal(pageId, seed ? [seed, update] : [update]);
        });
        if (!writable) {
          // Solo en memoria (origen que no se guarda): la vista queda bien y no sale ningún cambio.
          if (this.options.normalize?.(doc, ORIGIN_LOAD)) created.repairedInMemory = true;
        } else {
          this.options.normalize?.(doc, ORIGIN_REPAIR);
        }
        created.loaded = true;
      });
      this.live.set(pageId, created);
      entry = created;
    }
    entry.refs++;
    await entry.ready;
    // Solo en memoria: se guarda (y se sube) recién con la primera edición local.
    if (seed) this.options.seed?.(entry.doc, pageId, ORIGIN_SEED);
    return entry.doc;
  }

  /** Avisa después de cada edición local guardada en el dispositivo. Devuelve la función que deja de escuchar. */
  subscribeLocalChange(fn: (pageId: string) => void): () => void {
    this.localChangeListeners.add(fn);
    return () => this.localChangeListeners.delete(fn);
  }

  /**
   * El documento vivo de una página abierta (con lo recién escrito, aunque todavía no esté guardado), o `null`
   * si no está abierta, todavía está cargando o le falta algo que llegó del servidor (`stale`: lo guardado
   * tiene más). Solo para leer: no cuenta como `open` y no hay que cerrarlo.
   */
  peek(pageId: string): Y.Doc | null {
    const entry = this.live.get(pageId);
    return entry?.loaded && !entry.stale ? entry.doc : null;
  }

  /**
   * Lo guardado de una página para la búsqueda del proyecto (Docs/Doc_Buscar.md, corrección 7), armado en un
   * documento aparte (hay que destruirlo después). El estado se lee **antes** que el contenido: si algo cambia
   * en el medio, el contenido es más nuevo que la marca y la próxima comparación lo vuelve a leer (nunca al
   * revés). Con el candado de la página (como bajar y subir), y si hay muchos updates sueltos se fusionan
   * (`loadInto`, lo mismo que al abrirla): la próxima lectura es rápida.
   */
  indexSnapshot(pageId: string): Promise<{ doc: Y.Doc; state: DocState | undefined }> {
    return this.withLock(pageId, async () => {
      await this.flush(pageId);
      const tx = this.db.transaction(['docState', 'docUpdates'], 'readonly');
      const [state, rows] = await Promise.all([
        tx.objectStore('docState').get(pageId),
        tx.objectStore('docUpdates').index('pageId').count(pageId),
      ]);
      await tx.done;
      const doc = new Y.Doc();
      if (rows > COMPACT_AT) {
        await this.loadInto(pageId, doc);
      } else if (rows > 0) {
        const data = await this.db.getAllFromIndex('docUpdates', 'pageId', pageId);
        if (data.length > 0) Y.applyUpdate(doc, Y.mergeUpdates(data.map((r) => r.data)), ORIGIN_LOAD);
      }
      // Sin mirar si esta versión lo puede mostrar: la búsqueda lee el texto sin depender del esquema.
      return { doc, state };
    });
  }

  /** Avisa cuando llega del servidor algo que esta versión no puede mostrar en una página abierta. */
  subscribeUnsupported(fn: (pageId: string) => void): () => void {
    this.unsupportedListeners.add(fn);
    return () => this.unsupportedListeners.delete(fn);
  }

  /**
   * Avisa cuando un cambio que llegó del servidor entró en el documento pero el editor abierto no lo pudo
   * mostrar (el editor tiró un error al dibujarlo). Quien escucha tiene que volver a dibujar el editor desde
   * el documento ANTES de la próxima tecla: un editor que se quedó con lo de antes, en la próxima edición,
   * escribe su versión vieja encima y deshace el cambio para todos (Docs/Doc_Colaboracion.md). Se llama en
   * el momento, dentro de la misma tarea del navegador.
   */
  subscribeRenderFailed(fn: (pageId: string) => void): () => void {
    this.renderFailedListeners.add(fn);
    return () => this.renderFailedListeners.delete(fn);
  }

  /**
   * La base se restauró desde una copia de seguridad: el servidor ya no tiene todo lo que este dispositivo
   * cree que tiene. Todas las páginas vuelven a subir su contenido entero (Yjs no duplica lo que el
   * servidor ya tenga) y se bajan de nuevo desde el principio.
   */
  async resetForRestore(): Promise<number> {
    await this.flush();
    const states = await this.db.getAll('docState');
    for (const state of states) {
      await this.withLock(state.pageId, () =>
        updateDocState(this.db, state.pageId, (s) => {
          s.cursor = 0;
          s.syncedSV = undefined;
          // Con todos los borrados (B.15): el servidor restaurado puede no tener los que ya había confirmado.
          s.syncedDS = undefined;
          s.syncedDSGeneration = undefined;
          s.ackedVersion = -1;
          // Todo vuelve a subir: la guardia no puede esconder nada.
          s.guardVersion = undefined;
          s.pending = undefined;
          s.rejected = undefined;
          s.lastError = undefined;
        }),
      );
    }
    return states.length;
  }

  /**
   * Corta los reintentos de escritura (al cerrar sesión o cambiar de usuario). Lo que ya estaba programado
   * para guardarse se guarda igual (`flush` lo espera).
   */
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
    return this.writes.size > 0 || this.scheduled.size > 0 || [...this.unsaved.values()].some((b) => b.length > 0);
  }

  getWriteError(): string | null {
    return this.writeError;
  }

  /** Páginas con algo sin subir: sin confirmar por el servidor o todavía sin guardar en el dispositivo. */
  async unsyncedPages(): Promise<string[]> {
    await this.flush();
    // Una sola transacción: el estado y las marcas se leen juntos.
    const tx = this.db.transaction(['docState', 'meta'], 'readonly');
    const [states, keys] = await Promise.all([
      tx.objectStore('docState').getAll(),
      tx.objectStore('meta').getAllKeys(dirtyRange()),
    ]);
    await tx.done;
    const dirty = new Set(keys.map((k) => String(k).slice(DIRTY_PREFIX.length)));
    const pages = new Set(states.filter((s) => hasUnsyncedContent(s, dirty.has(s.pageId))).map((s) => s.pageId));
    // Con marca pero sin la versión sumada (la app se cerró entre la edición guardada y la suma, que va
    // aparte): se suma ahora, para que una versión anterior que abra esta base también la vea pendiente.
    const behind = [...dirty].filter((pageId) => {
      const state = states.find((s) => s.pageId === pageId);
      return !state || state.version <= state.ackedVersion;
    });
    for (const pageId of behind) await this.bumpVersion(pageId);
    for (const pageId of dirty) pages.add(pageId);
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
          const saved = await this.readSaved(pageId);
          if (!hasUnsyncedContent(saved.state, saved.dirty !== undefined)) {
            saved.doc.destroy();
            break;
          }
          if (Y.encodeStateVector(saved.doc).length <= 1) {
            // Nada que subir (una página que este dispositivo nunca tuvo con contenido): queda al día.
            saved.doc.destroy();
            state = await this.confirm(pageId, saved.dirty, (s) => {
              s.ackedVersion = Math.max(s.ackedVersion, saved.state.version);
            });
            continue;
          }
          // Los elementos que el servidor no tiene y solo los borrados que no tiene (B.15).
          const upload = buildUpload(saved.doc, saved.state.syncedSV, knownDeletes(saved.state, saved.generation));
          const next = {
            id: crypto.randomUUID(),
            update: upload.update,
            sv: Y.encodeStateVector(saved.doc),
            ds: upload.ds,
            version: saved.state.version,
            dirty: saved.dirty,
          };
          saved.doc.destroy();
          state = await this.savePending(pageId, next);
          pending = next;
        }
        let seq: number;
        try {
          seq = await remote.pushUpdate(pageId, pending.id, pending.update);
        } catch (err) {
          await updateDocState(this.db, pageId, (s) => {
            s.lastError = errorMessage(err);
            // Una app vieja para el workspace no es un rechazo: el contenido sube al actualizar.
            s.rejected = isPermanent(err) && errorMessage(err) !== APP_OUTDATED ? errorMessage(err) : undefined;
          });
          throw err;
        }
        const confirmed = pending;
        state = await this.confirm(pageId, confirmed.dirty, (s, generation) => {
          if (s.pending?.id !== confirmed.id) return false;
          // Se suma a lo que ya se sabía (lo bajado mientras la subida estaba en vuelo también cuenta): los
          // dos vectores dicen solo lo que el servidor tiene, así que el mayor de cada autor también.
          s.syncedSV = mergeStateVectors(s.syncedSV, confirmed.sv);
          // Los borrados que viajaron ya están en el servidor (B.15). Un envío de una versión anterior no trae
          // `ds`: se leen del update (que lleva todos los borrados de su documento).
          addKnownDeletes(s, generation, rangesOf(confirmed.ds ?? confirmed.update));
          // La versión del envío guardado: puede haber sumado las ediciones que ya entraron en él (ver
          // `bumpVersion`).
          s.ackedVersion = Math.max(s.ackedVersion, confirmed.version, s.pending.version);
          // Lo que se acaba de subir ya está en el dispositivo: si nadie subió nada en el medio, el cursor
          // avanza y la página no figura como "a medio bajar" por culpa de lo propio.
          if (seq === s.cursor + 1) s.cursor = seq;
          s.pending = undefined;
          s.lastError = undefined;
          s.rejected = undefined;
          return true;
        });
        pushed = true;
      }
      return pushed ? 'pushed' : 'clean';
    });
  }

  /**
   * Guarda el envío armado. Si la marca sigue siendo la que se leyó con lo guardado, no se guardó ninguna
   * edición después: las sumas de versión que llegaron en el medio son de ediciones que ya van en el envío
   * (se suman aparte, después de guardar cada una), así que el envío las cubre. Sin esto, la página quedaría
   * pendiente una vuelta más y saldría una subida vacía.
   */
  private async savePending(pageId: string, next: NonNullable<DocState['pending']>): Promise<DocState> {
    const tx = this.db.transaction(['docState', 'meta'], 'readwrite');
    const [stored, dirty] = await Promise.all([
      tx.objectStore('docState').get(pageId),
      tx.objectStore('meta').get(dirtyKey(pageId)),
    ]);
    const state = stored ?? emptyDocState(pageId);
    if (next.dirty !== undefined && dirty === next.dirty) next.version = Math.max(next.version, state.version);
    state.pending = next;
    // Con la página abierta para editar, la guardia queda por encima del envío: si la app se cierra con una
    // edición guardada que no va en él (y sin su suma de versión), una versión anterior que confirme el
    // envío igual ve la página pendiente.
    const live = this.live.get(pageId);
    if (live?.guarded && live.refs > 0) raiseGuard(state);
    await tx.objectStore('docState').put(state);
    await tx.done;
    return state;
  }

  /**
   * Actualiza el estado de la página y, en la misma transacción, borra la marca de ediciones sin subir si
   * sigue siendo la que se leyó junto con lo que se subió: si hubo ediciones guardadas después, la marca es
   * otra y queda (se suben en la vuelta siguiente). Si `mutate` devuelve false, la marca no se toca.
   */
  private async confirm(
    pageId: string,
    dirty: string | undefined,
    mutate: (state: DocState, generation: number) => boolean | void,
  ): Promise<DocState> {
    const tx = this.db.transaction(['docState', 'meta'], 'readwrite');
    const [stored, generation] = await Promise.all([
      tx.objectStore('docState').get(pageId),
      tx.objectStore('meta').get(GENERATION_KEY),
    ]);
    const state = stored ?? emptyDocState(pageId);
    const applied = mutate(state, storedGeneration(generation)) !== false;
    // Con la página abierta para editar, la guardia se vuelve a armar en la misma transacción.
    if (this.live.get(pageId)?.guarded && (this.live.get(pageId)?.refs ?? 0) > 0) raiseGuard(state);
    await tx.objectStore('docState').put(state);
    if (applied && dirty !== undefined && (await tx.objectStore('meta').get(dirtyKey(pageId))) === dirty) {
      await tx.objectStore('meta').delete(dirtyKey(pageId));
    }
    await tx.done;
    return state;
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

  /**
   * Lo guardado de una página, armado en un documento aparte (hay que destruirlo después), con su estado
   * leído en la misma transacción y si esta versión puede leer todo lo que trae. Para mirar qué archivos
   * usa la página (papelera de archivos) sin tocar el documento abierto en el editor.
   */
  async snapshot(pageId: string): Promise<{ doc: Y.Doc; state: DocState; dirty: boolean; supported: boolean }> {
    await this.flush(pageId);
    const saved = await this.readSaved(pageId);
    return {
      doc: saved.doc,
      state: saved.state,
      dirty: saved.dirty !== undefined,
      supported: this.options.supports?.(saved.doc) ?? true,
    };
  }

  /**
   * Anota que la página tiene en el servidor un update que este dispositivo no puede leer (lo encontró la
   * comprobación de la papelera de archivos): nunca se usa para decir que la página dejó de usar un archivo.
   */
  async markUnreadable(pageId: string): Promise<void> {
    await this.withLock(pageId, () =>
      updateDocState(this.db, pageId, (s) => {
        s.unreadable = true;
      }),
    );
  }

  /** Baja lo nuevo de una página y lo guarda. Si está abierta, lo aplica también en el editor. */
  pullPage(pageId: string, remote: Remote): Promise<number> {
    return this.withLock(pageId, async () => {
      let total = 0;
      // Si un lote vence el tope de tiempo (una red lenta con updates grandes), se pide uno más chico, hasta
      // de a uno (que tiene el tope más largo). Lo ya bajado queda guardado.
      let batch = PULL_BATCH;
      for (;;) {
        const cursor = (await this.db.get('docState', pageId))?.cursor ?? 0;
        let updates: RemoteUpdate[];
        try {
          updates = await remote.pullUpdates(pageId, cursor, batch);
        } catch (err) {
          if (!isTimeout(err) || batch === 1) throw err;
          batch = Math.max(1, Math.floor(batch / 10));
          continue;
        }
        if (updates.length === 0) break;
        await this.applyRemote(pageId, updates);
        total += updates.length;
        if (updates.length < batch) break;
      }
      return total;
    });
  }

  /**
   * Guarda lo bajado del servidor y avanza el cursor y `syncedSV` en la misma transacción (si la app se
   * cierra en el medio, no cambia nada de los tres).
   *
   * `syncedSV` avanza solo con lo que el servidor mandó (ver `advanceSynced`): así la próxima subida no
   * reenvía lo bajado, y lo propio sin confirmar sigue quedando afuera del vector, o sea, adentro de lo que
   * falta subir.
   */
  private async applyRemote(pageId: string, updates: RemoteUpdate[]): Promise<void> {
    const decoded: ReturnType<typeof Y.decodeUpdate>[] = [];
    const valid = updates.filter((u) => {
      try {
        decoded.push(Y.decodeUpdate(u.data));
        return true;
      } catch {
        // Queda intacto en el servidor; este dispositivo no lo puede leer (por ejemplo, porque lo escribió
        // una versión más nueva de la app).
        this.onWarning?.(t('docs.unreadable', { page: pageId, seq: u.seq }));
        return false;
      }
    });
    const merged = valid.length > 0 ? Y.mergeUpdates(valid.map((u) => u.data)) : null;
    const maxSeq = Math.max(...updates.map((u) => u.seq));

    // Tope del vector: lo que el documento del dispositivo integró de verdad (lo guardado más lo que llega).
    // Lo que Yjs deja pendiente porque le falta algo de lo que depende no cuenta. Se calcula antes y fuera
    // de la transacción que escribe, para no frenar el guardado de ninguna página mientras se arma el
    // documento; adentro se comprueba que lo guardado no cambió en el medio.
    const cap = merged ? await this.integratedCap(pageId, maxSeq, decoded, merged) : null;
    // Los borrados bajados y la cuenta nueva de `syncedDS` (B.15), también afuera: con páginas grandes escritas
    // por versiones anteriores (cada fila con el delete set entero) la unión tarda, y adentro trabaría el
    // guardado de todas las páginas.
    const deletes = merged ? await this.preparePulledDeletes(pageId, merged) : null;

    const tx = this.db.transaction(['docUpdates', 'docState', 'meta'], 'readwrite');
    const [stored, generation] = await Promise.all([
      tx.objectStore('docState').get(pageId),
      tx.objectStore('meta').get(GENERATION_KEY),
    ]);
    const state = stored ?? emptyDocState(pageId);
    if (maxSeq <= state.cursor) {
      await tx.done;
      return;
    }
    if (merged) {
      if (cap) {
        const rows = await tx.objectStore('docUpdates').index('pageId').count(pageId);
        // Si lo guardado cambió (una edición local, una compactación), el vector no avanza en esta vuelta: se
        // subirá de más, nunca de menos. (Lo guardado solo crece, así que un tope viejo igual sería menor.)
        if (rows === cap.rows) {
          state.syncedSV = advanceSynced(state.syncedSV, serverReach(state.syncedSV, decoded), cap.local);
        }
      }
      await tx.objectStore('docUpdates').add({ pageId, data: merged });
      // Los borrados que mandó el servidor ya los tiene (B.15): la próxima subida no los repite. No depende de
      // lo que el dispositivo integró: un borrado de más en la cuenta no cambia lo que hay que subir. Si la cuenta
      // o la generación cambiaron desde que se preparó, se vuelve a hacer acá (no pasa casi nunca).
      if (deletes && deletes.pulled.size > 0) {
        const gen = storedGeneration(generation);
        if (gen === deletes.generation && sameBytes(state.syncedDS, deletes.base) && state.syncedDSGeneration === deletes.baseGeneration) {
          state.syncedDS = deletes.next;
          state.syncedDSGeneration = gen;
        } else {
          addKnownDeletes(state, gen, deletes.pulled);
        }
      }
    }
    state.cursor = maxSeq;
    if (valid.length < updates.length) state.unreadable = true;
    await tx.objectStore('docState').put(state);
    await tx.done;

    const live = this.live.get(pageId);
    if (merged && live && !live.stale) {
      await live.ready;
      let applied = false;
      try {
        applied = this.applyToLive(pageId, live, merged);
      } finally {
        // Si no se pudo aplicar (lo que llegó no se puede mostrar, o la reparación tiró un error), lo bajado
        // quedó guardado pero no en el documento abierto: se vuelve a armar desde lo guardado la próxima vez
        // que se abra, y la página se entera para volver a abrirlo. El error, si lo hubo, sigue para afuera.
        if (!applied) {
          live.stale = true;
          for (const fn of this.unsupportedListeners) fn(pageId);
        }
      }
    }
  }

  /**
   * El vector de estado del documento que queda al sumar `merged` a lo guardado, y cuántas filas había
   * guardadas al leerlo. `null` si lo bajado no puede hacer avanzar `syncedSV` (nada que calcular). Lee en
   * una transacción de solo lectura y arma el documento cuando ya terminó.
   */
  private async integratedCap(
    pageId: string,
    maxSeq: number,
    decoded: ReturnType<typeof Y.decodeUpdate>[],
    merged: Uint8Array,
  ): Promise<{ local: Map<number, number>; rows: number } | null> {
    const tx = this.db.transaction(['docUpdates', 'docState'], 'readonly');
    const state = await tx.objectStore('docState').get(pageId);
    if (maxSeq <= (state?.cursor ?? 0) || serverReach(state?.syncedSV, decoded).size === 0) {
      await tx.done;
      return null;
    }
    const rows = await tx.objectStore('docUpdates').index('pageId').getAll(pageId);
    await tx.done;
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Y.mergeUpdates([...rows.map((r) => r.data), merged]), ORIGIN_LOAD);
    const local = Y.decodeStateVector(Y.encodeStateVector(doc));
    doc.destroy();
    return { local, rows: rows.length };
  }

  /**
   * Los borrados de lo bajado y `syncedDS` con ellos sumados, calculado sobre el estado leído en una transacción
   * de solo lectura. `applyRemote` lo usa si el estado no cambió en el medio. Los borrados salen de `merged`
   * (las filas bajadas ya juntadas): `mergeUpdates` ya unió los de todas, que en las filas de una versión anterior
   * se repiten enteros en cada una.
   */
  private async preparePulledDeletes(
    pageId: string,
    merged: Uint8Array,
  ): Promise<{ pulled: DeleteRanges; base?: Uint8Array; baseGeneration?: number; generation: number; next: Uint8Array }> {
    const pulled = rangesOf(merged);
    const tx = this.db.transaction(['docState', 'meta'], 'readonly');
    const [state, stored] = await Promise.all([tx.objectStore('docState').get(pageId), tx.objectStore('meta').get(GENERATION_KEY)]);
    await tx.done;
    const generation = storedGeneration(stored);
    const known = state ? knownDeletes(state, generation) : undefined;
    return {
      pulled,
      base: state?.syncedDS,
      baseGeneration: state?.syncedDSGeneration,
      generation,
      next: encodeRanges(known ? unionRanges(rangesOf(known), pulled) : pulled),
    };
  }

  /**
   * Aplica lo que llegó del servidor a un documento abierto en el editor. Si lo que llega rompe la
   * estructura, la reparación va en la MISMA transacción: el editor reacciona al final de cada
   * transacción y, si llegara a ver la estructura rota, borraría la parte que no puede mostrar.
   */
  private applyToLive(pageId: string, live: LiveDoc, update: Uint8Array): boolean {
    const { doc } = live;
    const { normalize, supports } = this.options;
    let needsRepair = false;
    if (normalize || supports) {
      const probe = new Y.Doc();
      Y.applyUpdate(probe, Y.encodeStateAsUpdate(doc));
      Y.applyUpdate(probe, update);
      if (supports && !supports(probe)) {
        probe.destroy();
        return false;
      }
      needsRepair = normalize ? normalize(probe, ORIGIN_REPAIR) : false;
      probe.destroy();
    }
    if (!needsRepair) {
      this.applyRendering(pageId, doc, ORIGIN_REMOTE, false, () => Y.applyUpdate(doc, update));
      return true;
    }
    // Quien no puede escribir la página repara solo en memoria: lo remoto ya está guardado (applyRemote) y
    // la reparación no se guarda ni se sube.
    if (this.options.canWrite?.(pageId) === false) {
      live.repairedInMemory = true;
      this.applyRendering(pageId, doc, ORIGIN_LOAD, true, () => {
        Y.applyUpdate(doc, update);
        normalize!(doc, ORIGIN_LOAD);
      });
      return true;
    }
    // Con origen local: la reparación se guarda y se sube. Lo remoto que viaja con ella ya está en el
    // servidor, así que subirlo de nuevo no cambia nada.
    this.applyRendering(pageId, doc, ORIGIN_REPAIR, true, () => {
      Y.applyUpdate(doc, update);
      normalize!(doc, ORIGIN_REPAIR);
    });
    return true;
  }

  /**
   * Aplica un cambio (y su reparación) a un documento abierto, en una transacción. El editor lo dibuja al
   * final de la transacción, y si al dibujarlo tira un error, Yjs lo pasa para afuera: el cambio YA está en el
   * documento (y guardado), pero el editor quedó mostrando lo de antes. Eso no corta la bajada (lo bajado ya
   * está guardado y el cursor avanzó): se avisa a quien tiene el editor para que lo vuelva a dibujar desde el
   * documento (`subscribeRenderFailed`). Un error de antes (al aplicar el cambio o al repararlo) no es del
   * editor: sale para afuera, y `applyRemote` marca el documento para volver a armarlo desde lo guardado.
   */
  private applyRendering(pageId: string, doc: Y.Doc, origin: symbol, local: boolean, apply: () => void): void {
    let applied = false;
    try {
      Y.transact(
        doc,
        () => {
          apply();
          applied = true;
        },
        origin,
        local,
      );
    } catch (err) {
      if (!applied) throw err;
      console.warn(`The editor could not show a change of page ${pageId}; redrawing it.`, err);
      for (const fn of this.renderFailedListeners) {
        try {
          fn(pageId);
        } catch (listenerError) {
          console.warn('Redrawing the editor failed.', listenerError);
        }
      }
    }
  }

  /**
   * Guarda una edición local. Las ediciones de un mismo momento (la misma tarea del navegador) se juntan y
   * salen en una transacción que **no lee nada**: agrega el update y pone una marca nueva de "sin subir" en
   * `meta` (`dirtyKey`), y se confirma en el acto (`commit`). Cada tanda tiene su propia transacción, sin
   * esperar a la anterior.
   *
   * Antes la transacción leía el estado de la página para sumar la versión, así que no podía confirmarse
   * hasta tener la respuesta, y lo que se escribía mientras tanto esperaba en memoria: una recarga o un
   * cierre en ese rato perdía el final de lo escrito (el navegador aborta las transacciones sin confirmar
   * de una página que se va), aunque el estado ya dijera "saved on this device".
   */
  private persistLocal(pageId: string, updates: Uint8Array[]): void {
    const buffer = this.unsaved.get(pageId);
    if (buffer) buffer.push(...updates);
    else this.unsaved.set(pageId, [...updates]);
    if (this.scheduled.has(pageId)) return;
    this.scheduled.add(pageId);
    this.track(
      pageId,
      Promise.resolve().then(() => {
        this.scheduled.delete(pageId);
        return this.startWrite(pageId);
      }),
    );
  }

  /** Escribe lo que haya en memoria de la página, en una transacción sin lecturas que se confirma en el acto. */
  private startWrite(pageId: string): Promise<void> {
    const timer = this.retryTimers.get(pageId);
    if (timer) {
      clearTimeout(timer);
      this.retryTimers.delete(pageId);
    }
    const fresh = this.unsaved.get(pageId) ?? [];
    if (fresh.length === 0) return Promise.resolve();
    this.unsaved.set(pageId, []);
    const flying = this.inFlight.get(pageId) ?? new Set<Uint8Array>();
    this.inFlight.set(pageId, flying);
    // Lo de las transacciones anteriores que todavía no terminaron va de nuevo (ver `inFlight`).
    const batch = [...flying, ...fresh];
    for (const update of fresh) flying.add(update);

    let done: Promise<void>;
    try {
      const tx = this.db.transaction(['docUpdates', 'meta'], 'readwrite');
      const data = batch.length === 1 ? batch[0] : Y.mergeUpdates(batch);
      // Los errores de cada pedido llegan también por `tx.done`.
      void tx.objectStore('docUpdates').add({ pageId, data }).catch(() => undefined);
      void tx.objectStore('meta').put(crypto.randomUUID(), dirtyKey(pageId)).catch(() => undefined);
      // Sin esperar a nada: el navegador ya tiene todo lo que tiene que guardar.
      try {
        (tx as unknown as { commit?: () => void }).commit?.();
      } catch {
        // Sin `commit` (o ya confirmándose), se confirma sola al terminar la tarea: tampoco espera lecturas.
      }
      done = tx.done;
    } catch (err) {
      done = Promise.reject(err);
    }
    return done.then(
      () => {
        for (const update of batch) flying.delete(update);
        this.setWriteError(null);
        // Un escucha que falla no deja sin aviso a los demás ni frena la suma de la versión.
        for (const fn of this.localChangeListeners) {
          try {
            fn(pageId);
          } catch (err) {
            // Lo que hace cada escucha es suyo (la sincronización, el índice de la búsqueda): se avisa en la
            // consola y los demás siguen.
            console.error('local change listener failed', err);
          }
        }
        // Aparte y después: lo escrito ya está a salvo con su marca.
        this.track(pageId, this.bumpVersion(pageId));
      },
      (err: unknown) => {
        // Vuelven a la cola: siguen en el documento en memoria y se reintentan solas. (Las que otra
        // transacción ya guardó no están más en `flying`.)
        const lost = batch.filter((update) => flying.has(update));
        for (const update of lost) flying.delete(update);
        this.unsaved.set(pageId, [...lost, ...(this.unsaved.get(pageId) ?? [])]);
        this.setWriteError(errorMessage(err));
        if (!this.retryTimers.has(pageId) && !this.disposed) {
          this.retryTimers.set(
            pageId,
            setTimeout(() => {
              this.retryTimers.delete(pageId);
              this.track(pageId, this.startWrite(pageId));
            }, WRITE_RETRY_MS),
          );
        }
      },
    );
  }

  /**
   * Suma uno a la versión de la página, en una transacción aparte y después de que la edición quedó
   * guardada con su marca. No hace falta para no perder nada en esta versión (lo pendiente lo dice la
   * marca); es para una versión anterior de la app que abra esta misma base, que solo mira `version >
   * ackedVersion` (con la página abierta ya la cubre la guardia; esto cubre además la marca de "ya mirada"
   * de la papelera de archivos, que usa la versión). Si no hay marca ni envío pendiente y estaba al día, la
   * edición ya entró en una subida confirmada: suma también la confirmada, así no sale una subida vacía de
   * más. Si falla, se vuelve a intentar desde `unsyncedPages`.
   */
  private async bumpVersion(pageId: string): Promise<void> {
    try {
      const tx = this.db.transaction(['docState', 'meta'], 'readwrite');
      const [stored, dirty] = await Promise.all([
        tx.objectStore('docState').get(pageId),
        tx.objectStore('meta').get(dirtyKey(pageId)),
      ]);
      const state = stored ?? emptyDocState(pageId);
      const upToDate = dirty === undefined && state.pending === undefined && !hasUnsyncedContent(state);
      const guard = onlyGuard(state);
      state.version += 1;
      if (upToDate) {
        state.ackedVersion += 1;
        if (guard) state.guardVersion = state.version;
      } else if (state.pending && dirty !== undefined && state.pending.dirty === dirty) {
        // La marca sigue siendo la del envío en vuelo: esta edición entró en él (se guardó antes de armarlo),
        // así que la suma también le corresponde al envío (y a la guardia, si estaba armada). Una versión
        // anterior suma aparte, sin tocar esto.
        state.pending.version += 1;
        if (guard) state.guardVersion = state.version;
      }
      await tx.objectStore('docState').put(state);
      await tx.done;
    } catch {
      // La base pudo cerrarse (se cierra la app): la próxima vez se suma desde `unsyncedPages`.
    }
  }

  /**
   * Arma la versión guardia al abrir una página que se puede editar (ver `DocState.guardVersion`), antes
   * de que se pueda escribir nada. Si falla, la página se abre igual.
   */
  private async armGuard(pageId: string): Promise<void> {
    try {
      await updateDocState(this.db, pageId, raiseGuard);
    } catch {
      // Sin guardia, una versión anterior podría no ver pendiente la última edición si la app se cierra
      // justo después; esta versión la sube igual (la marca).
    }
  }

  /** `writes` guarda, por página, la cadena de todas las escrituras en curso (para `flush`). */
  private track(pageId: string, run: Promise<void>): void {
    const previous = this.writes.get(pageId);
    const chained = previous ? Promise.all([previous, run]).then(() => undefined) : run;
    this.writes.set(pageId, chained);
    void chained.finally(() => {
      if (this.writes.get(pageId) === chained) this.writes.delete(pageId);
    });
  }

  private setWriteError(message: string | null): void {
    // Mientras quede algo sin guardar, el error no se limpia.
    if (message === null && [...this.unsaved.values()].some((b) => b.length > 0)) return;
    if (message === this.writeError) return;
    this.writeError = message;
    this.onWriteError?.(message);
  }

  /**
   * Lee en una sola transacción lo guardado de una página, su estado y su marca de ediciones sin subir, y
   * arma el documento. La marca que se lee corresponde a la última escritura que entró en lo leído.
   */
  private async readSaved(
    pageId: string,
  ): Promise<{ doc: Y.Doc; state: DocState; dirty?: string; generation: number }> {
    const tx = this.db.transaction(['docUpdates', 'docState', 'meta'], 'readonly');
    const [rows, stored, dirty, generation] = await Promise.all([
      tx.objectStore('docUpdates').index('pageId').getAll(pageId),
      tx.objectStore('docState').get(pageId),
      tx.objectStore('meta').get(dirtyKey(pageId)),
      tx.objectStore('meta').get(GENERATION_KEY),
    ]);
    await tx.done;
    const doc = new Y.Doc();
    if (rows.length > 0) Y.applyUpdate(doc, Y.mergeUpdates(rows.map((r) => r.data)), ORIGIN_LOAD);
    return {
      doc,
      state: stored ?? emptyDocState(pageId),
      dirty: typeof dirty === 'string' ? dirty : undefined,
      generation: storedGeneration(generation),
    };
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

/**
 * Hasta dónde tiene el servidor, sin huecos, lo de cada autor de Yjs, según `syncedSV` más lo que acaba de
 * mandar. `syncedSV` dice que el servidor tiene los relojes `[0, n)` de cada autor; un update bajado que
 * trae los relojes `[a, b)` de un autor con `a <= n` lo lleva hasta `b`. Un hueco (un `Skip`, o un tramo que
 * empieza más adelante) corta: más allá no se sabe. Devuelve solo los autores que avanzan.
 *
 * No mira el documento local: es solo lo que el servidor probó tener, porque lo mandó.
 */
export function serverReach(
  syncedSV: Uint8Array | undefined,
  decoded: ReturnType<typeof Y.decodeUpdate>[],
): Map<number, number> {
  const known = syncedSV ? Y.decodeStateVector(syncedSV) : new Map<number, number>();
  const ranges = new Map<number, [number, number][]>();
  for (const { structs } of decoded) {
    for (const struct of structs) {
      // Solo contenido de verdad (o su lugar ya borrado); un Skip es un hueco.
      if (!(struct instanceof Y.Item || struct instanceof Y.GC)) continue;
      const list = ranges.get(struct.id.client) ?? [];
      list.push([struct.id.clock, struct.id.clock + struct.length]);
      ranges.set(struct.id.client, list);
    }
  }
  const reach = new Map<number, number>();
  for (const [client, list] of ranges) {
    const before = known.get(client) ?? 0;
    let end = before;
    list.sort((x, y) => x[0] - y[0]);
    for (const [from, to] of list) {
      if (from > end) break;
      end = Math.max(end, to);
    }
    if (end > before) reach.set(client, end);
  }
  return reach;
}

/**
 * Avanza `syncedSV` con lo que el servidor mandó (`serverReach`), sin pasar de lo que el documento del
 * dispositivo integró (`local`). Lo propio sin confirmar nunca entra: sus relojes no vinieron del servidor.
 */
export function advanceSynced(
  syncedSV: Uint8Array | undefined,
  reach: Map<number, number>,
  local: Map<number, number>,
): Uint8Array | undefined {
  const next = syncedSV ? Y.decodeStateVector(syncedSV) : new Map<number, number>();
  let changed = false;
  for (const [client, end] of reach) {
    const capped = Math.min(end, local.get(client) ?? 0);
    if (capped > (next.get(client) ?? 0)) {
      next.set(client, capped);
      changed = true;
    }
  }
  return changed ? Y.encodeStateVector(next) : syncedSV;
}

/**
 * Los borrados que el servidor ya tiene según `syncedDS` (B.15), o `undefined` si no se puede contar con ellos:
 * no hay, o se anotaron con otra generación del workspace (una versión anterior restauró una copia: borra
 * `syncedSV` pero no conoce este campo). Sin ellos se suben todos los borrados, como antes.
 */
export function knownDeletes(state: DocState, generation: number): Uint8Array | undefined {
  return state.syncedDS && state.syncedDSGeneration === generation ? state.syncedDS : undefined;
}

/** Suma a `syncedDS` borrados que el servidor tiene (confirmados o bajados), con la generación de ahora. */
function addKnownDeletes(state: DocState, generation: number, more: DeleteRanges): void {
  const known = knownDeletes(state, generation);
  state.syncedDS = encodeRanges(known ? unionRanges(rangesOf(known), more) : more);
  state.syncedDSGeneration = generation;
}

/** Los mismos bytes (o los dos sin nada). */
function sameBytes(a: Uint8Array | undefined, b: Uint8Array | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** El mayor de cada autor entre dos vectores de estado. */
export function mergeStateVectors(a: Uint8Array | undefined, b: Uint8Array): Uint8Array {
  if (!a) return b;
  const merged = Y.decodeStateVector(a);
  for (const [client, clock] of Y.decodeStateVector(b)) {
    if (clock > (merged.get(client) ?? 0)) merged.set(client, clock);
  }
  return Y.encodeStateVector(merged);
}

/**
 * Deja `version` por encima de la confirmada (y de la de un envío sin confirmar) y la anota como guardia
 * (ver `DocState.guardVersion`). Si ya estaba por encima (una edición sin confirmar, o la guardia ya
 * armada), no cambia nada.
 */
function raiseGuard(state: DocState): void {
  // También por encima de un envío sin confirmar: una versión anterior que lo confirme toma su versión.
  const floor = Math.max(state.ackedVersion, state.pending?.version ?? -Infinity);
  if (state.version > floor) return;
  state.version = floor + 1;
  state.guardVersion = state.version;
}
