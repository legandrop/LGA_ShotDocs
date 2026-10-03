import * as Y from 'yjs';
import { t } from '../i18n';
import { buildCleanBase, checkCleanBase, coversLocal, sha256Hex } from './clean';
import { buildUpload, encodeRanges, rangesOf, unionRanges, type DeleteRanges } from './deleteSets';
import {
  DIRTY_PREFIX,
  dirtyKey,
  dirtyRange,
  emptyDocState,
  GENERATION_KEY,
  hasUnsyncedContent,
  onlyGuard,
  startedOverKey,
  storedGeneration,
  updateDocState,
  type DocState,
  type LocalDb,
} from './localDb';
import { APP_OUTDATED, type Remote, type SnapshotsRemote } from './remote';
import {
  applyRowsInOrder,
  clientOfKey,
  findRemovedWriting,
  mergeRowsInOrder,
  ownClientKey,
  ownClientRange,
  REMOVED_WRITING_KEEP,
  removedWritingKey,
  type RemovedWriting,
} from './removedWriting';
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
/**
 * Reemplazar en todo el proyecto y su deshacer (Docs/Doc_Buscar.md, "Reemplazar en el proyecto"): una edición local
 * como cualquier otra (se guarda y se sube), escrita sin editor. No es el origen del editor, así que no entra en la
 * pila de Ctrl/⌘+Z de la página abierta y el editor la dibuja como un cambio que llega.
 */
export const ORIGIN_REPLACE = Symbol('replace');

/** Con más updates guardados que esto, al abrir la página se fusionan en uno solo. */
const COMPACT_AT = 64;
const PULL_BATCH = 500;
const WRITE_RETRY_MS = 3000;
/**
 * Una subida armada sin GC (B.16) más grande que esto se vuelve a armar con GC, como antes: el servidor rechaza
 * las de más de 8 MB, y un rechazo dejaría todo lo de la página sin subir. Pasa solo con una página muy editada
 * que vuelve a subir entera (después de restaurar una copia de seguridad).
 */
export const NO_GC_MAX_BYTES = 6 * 1024 * 1024;

/** Lo guardado cambió entre la copia y volver a la versión del equipo (`replaceWithServer`): no se tocó nada. */
export const LOCAL_CHANGED = 'local_changed';

/** Cómo estaba guardada una página (ver `PageDocs.localMark`). */
export interface LocalMark {
  keys: number[];
  dirty: string | null;
  version: number;
  /** Nada en memoria sin guardar. */
  saved: boolean;
}

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
  /** El vector de estado al terminar de cargar lo guardado: lo que está hasta acá ya está en IndexedDB. */
  loadedSV?: Uint8Array;
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
  /**
   * Desde qué tamaño la subida sin GC se vuelve a armar con GC (`NO_GC_MAX_BYTES` si no se dice). Un link público
   * usa 1 MB, el tope de una subida por un link (Docs/Doc_Link_Publico.md, LE13): con GC, lo visible es lo mismo y solo
   * se pierde el texto que el visitante tecleó y borró antes de subir.
   */
  noGcMaxBytes?: number;
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
  /**
   * Si a este dispositivo la página le llega como base limpia (Docs/Doc_Privacidad_Borrado.md, 4.3): lo pone la
   * sincronización. Una base que cubre lo guardado lo reemplaza (ver `applyRemote`).
   */
  isBaseReader?: (pageId: string) => boolean;
  private readonly unsupportedListeners = new Set<(pageId: string) => void>();
  private readonly renderFailedListeners = new Set<(pageId: string) => void>();
  private readonly removedWritingListeners = new Set<(pageId: string) => void>();
  /** Páginas con alguna edición local en esta sesión (para no armar nada al bajar en las demás). */
  private readonly written = new Set<string>();
  /**
   * Los autores de Yjs que escribieron en cada página y todavía no se anotaron en `meta` (B.16, `ownClientKey`):
   * se anotan con la próxima escritura local. `recordedClients` son los ya anotados en esta sesión.
   */
  private readonly unrecordedClients = new Map<string, Set<number>>();
  private readonly recordedClients = new Set<string>();
  /**
   * Páginas que bajan con `pullUpdates` (filas sueltas) aunque el servidor tenga `pull_page_content`: llegó un snapshot
   * que esta versión no puede leer (Docs/Doc_Compactar.md, sección 5). Hasta que se vuelva a abrir la app.
   */
  private readonly rowsOnly = new Set<string>();
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
        created.loadedSV = Y.encodeStateVector(doc);
        const writable = this.options.canWrite?.(pageId) !== false;
        // Antes de que se pueda editar nada (también la reparación de abajo).
        if (writable) {
          created.guarded = true;
          await this.armGuard(pageId);
        }
        // Los autores de Yjs que tuvo este documento (B.16, `ownClientKey`). Yjs le cambia el autor a un documento
        // abierto cuando una transacción que aplica algo bajado también escribe (la reparación que va con lo que
        // llega, `applyToLive`): `applyUpdate` marca la transacción como remota y Yjs cree que otro usa su número.
        // Lo que esa transacción escribió es del autor de antes y el `update` sale cuando ya tiene el nuevo: se
        // anotan los dos, y los de cada transacción desde que se abrió.
        const authors = new Set<number>([doc.clientID]);
        doc.on('beforeTransaction', () => authors.add(doc.clientID));
        doc.on('update', (update: Uint8Array, origin: unknown) => {
          authors.add(doc.clientID);
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
            // Lo escrito puede colgar de la reparación hecha solo en memoria (y de la semilla): se guarda todo lo
            // que el documento tiene además de lo que se cargó de IndexedDB, así la reparación queda guardada con
            // lo que depende de ella. Solo lo que no estaba guardado: el documento abierto tiene GC, y lo borrado
            // en memoria va como hueco; lo cargado ya está en las filas con su texto (B.16).
            created.repairedInMemory = false;
            created.unsavedSeed = undefined;
            this.persistLocal(pageId, [Y.encodeStateAsUpdate(doc, created.loadedSV)], authors);
            return;
          }
          const seed = created.unsavedSeed;
          created.unsavedSeed = undefined;
          // La semilla va primero y en el mismo lote: se guardan en la misma transacción.
          this.persistLocal(pageId, seed ? [seed, update] : [update], authors);
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
   * Avisa cuando un cambio que llegó del servidor dejó borrado algo que este dispositivo había escrito y todavía
   * no había subido (otro borró el bloque donde se escribía; B.16). El texto queda en `removedWriting`.
   */
  subscribeRemovedWriting(fn: (pageId: string) => void): () => void {
    this.removedWritingListeners.add(fn);
    return () => this.removedWritingListeners.delete(fn);
  }

  /** Lo escrito en este dispositivo que otro borró antes de que se subiera (B.16), del más viejo al más nuevo. */
  async removedWriting(pageId: string): Promise<RemovedWriting[]> {
    const value = await this.db.get('meta', removedWritingKey(pageId));
    return Array.isArray(value) ? (value as RemovedWriting[]) : [];
  }

  /**
   * Quien escribió ya lo vio: se borran esos avisos (el texto sigue en el servidor). Solo los que se mostraron: uno
   * que llegó mientras tanto queda.
   */
  async dismissRemovedWriting(pageId: string, shown: RemovedWriting[]): Promise<void> {
    const seen = new Set(shown.map((n) => `${n.at}\u0000${n.text}`));
    const tx = this.db.transaction('meta', 'readwrite');
    const before = await tx.store.get(removedWritingKey(pageId));
    const rest = (Array.isArray(before) ? (before as RemovedWriting[]) : []).filter((n) => !seen.has(`${n.at}\u0000${n.text}`));
    if (rest.length > 0) await tx.store.put(rest, removedWritingKey(pageId));
    else await tx.store.delete(removedWritingKey(pageId));
    await tx.done;
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
      // Con un snapshot aplicado, lo guardado puede traer un borrado de un snapshot malo que nadie invalidó: se sube con
      // sus elementos y sin sus borrados (Docs/Doc_Compactar.md, sección 16; auditoría de la entrega 2, O-B). Puede
      // reaparecer un borrado legítimo que la copia perdió; no se pierde texto.
      if (state.snapshotId !== undefined) await this.withLock(state.pageId, () => this.keepElementsForRestore(state.pageId));
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
          // Los snapshots de antes de restaurar ya no cuentan (Docs/Doc_Compactar.md, sección 9).
          s.snapshotId = undefined;
          s.contentEpoch = undefined;
          s.forgotSyncedForEpoch = undefined;
          // `rebuilt` queda como lo dejó `keepElementsForRestore` (o como estaba): lo termina la próxima bajada.
        }),
      );
    }
    return states.length;
  }

  /**
   * `resetForRestore` de una página con un snapshot aplicado: lo guardado pasa a ser sus elementos, sin borrados, y la
   * marca `rebuilt` queda guardada en la misma transacción (R-1).
   */
  private async keepElementsForRestore(pageId: string): Promise<void> {
    const tx = this.db.transaction(['docUpdates', 'docState'], 'readwrite');
    const index = tx.objectStore('docUpdates').index('pageId');
    const [keys, rows, stored] = await Promise.all([index.getAllKeys(pageId), index.getAll(pageId), tx.objectStore('docState').get(pageId)]);
    // Sin ningún await en el medio: la transacción sigue abierta mientras se arma.
    const keep = elementsOnly(rows.map((r) => r.data));
    if (keep === 'failed' || keep === null) {
      await tx.done;
      return;
    }
    await Promise.all(keys.map((k) => tx.objectStore('docUpdates').delete(k)));
    await tx.objectStore('docUpdates').add({ pageId, data: keep });
    const state = stored ?? emptyDocState(pageId);
    state.rebuilt = true;
    await tx.objectStore('docState').put(state);
    await tx.done;
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

  /**
   * Abre la página, corre `fn` con su documento y con el candado de la página (el mismo de subir, bajar e indexar:
   * lo que llega del servidor para esta página espera) y la cierra. Adentro, `fn` nunca puede esperar algo que tome
   * el candado de la misma página (`pushPage`, `pullPage`, `indexSnapshot`, `markUnreadable`): se trabaría.
   */
  async edit<T>(pageId: string, fn: (doc: Y.Doc) => Promise<T> | T): Promise<T> {
    const doc = await this.open(pageId);
    try {
      return await this.withLock(pageId, async () => fn(doc));
    } finally {
      this.close(pageId);
    }
  }

  /**
   * Escribe una edición local en el documento abierto con la misma protección que los cambios del servidor
   * (`applyRendering`): si el editor abierto falla al dibujarla, la edición YA está en el documento y guardada, y la
   * página vuelve a dibujar el editor antes de la próxima tecla (`subscribeRenderFailed`). Devuelve `true` en ese
   * caso también: lo escrito cuenta como escrito y no se reintenta. Un error antes de aplicar sale para afuera.
   */
  applyLocal(pageId: string, doc: Y.Doc, origin: symbol, apply: () => void): boolean {
    this.applyRendering(pageId, doc, origin, true, apply);
    return true;
  }

  /**
   * Todo lo escrito en la página llegó a IndexedDB: no queda nada en memoria, ni programado, ni en curso, y guardar no
   * está fallando. Después de `flush`: `flush` vuelve también cuando la escritura falló (queda en memoria y se
   * reintenta cada 3 s).
   */
  isSaved(pageId: string): boolean {
    return (
      this.writeError === null &&
      (this.unsaved.get(pageId)?.length ?? 0) === 0 &&
      !this.scheduled.has(pageId) &&
      !this.writes.has(pageId)
    );
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

  /** El estado guardado de una página (sin armar nada). */
  stateOf(pageId: string): Promise<DocState | undefined> {
    return this.db.get('docState', pageId);
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
          // Sin GC (B.16): lo propio que quedó adentro de algo que otro borró viaja con su texto, borrado.
          const saved = await this.readSaved(pageId, { keepDeleted: true });
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
          let upload = buildUpload(saved.doc, saved.state.syncedSV, knownDeletes(saved.state, saved.generation));
          if (upload.update.length > (this.options.noGcMaxBytes ?? NO_GC_MAX_BYTES)) {
            // Demasiado grande con todo lo borrado: se arma con GC, como antes de B.16 (ver `NO_GC_MAX_BYTES`).
            // Los mismos elementos y los mismos borrados; solo pierde el texto de lo ya borrado.
            const collected = new Y.Doc();
            Y.applyUpdate(collected, Y.encodeStateAsUpdate(saved.doc), ORIGIN_LOAD);
            console.warn(`Page ${pageId}: the upload with deleted text is too large; uploading without it.`);
            upload = buildUpload(collected, saved.state.syncedSV, knownDeletes(saved.state, saved.generation));
            collected.destroy();
          }
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

  /**
   * Baja lo nuevo de una página y lo guarda. Si está abierta, lo aplica también en el editor. `contentEpoch`: la época de
   * contenido que trae el árbol (compactar); si este dispositivo aplicó un snapshot de la página y el árbol trae una época
   * más nueva, la página se rearma con lo del servidor (`epochBehind`, `resetContent`). Un árbol atrasado (leído antes de
   * lo último bajado) no reinicia nada: la época que manda es la de la misma respuesta (auditoría de la entrega 1, O2).
   */
  pullPage(pageId: string, remote: Remote, { contentEpoch }: { contentEpoch?: number } = {}): Promise<number> {
    return this.withLock(pageId, async () => {
      // Lo escrito tiene que estar guardado antes de bajar: el aviso de B.16 mira lo guardado.
      await this.flush(pageId);
      if (contentEpoch !== undefined && epochBehind(await this.db.get('docState', pageId), contentEpoch)) {
        await this.resetContent(pageId, contentEpoch);
      }
      let total = 0;
      // Si un lote vence el tope de tiempo (una red lenta con updates grandes), se pide uno más chico, hasta
      // de a uno (que tiene el tope más largo). Lo ya bajado queda guardado.
      let batch = PULL_BATCH;
      // Vueltas a empezar por una época nueva que llegó con lo bajado (una sola alcanza; el tope es por las dudas).
      let restarts = 0;
      for (;;) {
        const cursor = (await this.db.get('docState', pageId))?.cursor ?? 0;
        // Con `pull_page_content` (compactar) salvo que un snapshot de esta página no se haya podido leer.
        const content = remote.pullContent && !this.rowsOnly.has(pageId) ? remote.pullContent.bind(remote) : null;
        let updates: RemoteUpdate[];
        try {
          updates = content ? await content(pageId, cursor, batch) : await remote.pullUpdates(pageId, cursor, batch);
        } catch (err) {
          if (!isTimeout(err) || batch === 1) throw err;
          batch = Math.max(1, Math.floor(batch / 10));
          continue;
        }
        if (updates.length === 0) break;
        const result = await this.applyRemote(pageId, updates);
        if (result === 'snapshot_unreadable') {
          // No se guardó nada ni se movió el cursor: la página se vuelve a pedir en filas sueltas, como siempre. Con la
          // huella bien (o sin huella), lo armó una versión más nueva: no se toca.
          console.warn(`Página ${pageId}: no se pudo leer un snapshot del servidor; se bajan las filas.`);
          this.rowsOnly.add(pageId);
          continue;
        }
        if (result === 'snapshot_corrupt') {
          // La copia no coincide con la huella que guardó la base (O-D): no se aplicó nada. Se invalida su cadena (la base
          // deja que lo haga quien ve lo borrado; para los demás es un error que no corta nada) y se bajan las filas.
          const id = updates.find((u) => u.snapshotId)?.snapshotId;
          console.error(`Página ${pageId}: un snapshot del servidor no coincide con su huella; se invalida y se bajan las filas.`);
          this.rowsOnly.add(pageId);
          const invalidate = (remote as Partial<Pick<SnapshotsRemote, 'invalidateSnapshot'>>).invalidateSnapshot;
          if (id && invalidate) await invalidate.call(remote, id, 'corrupt: sha256').catch(() => false);
          continue;
        }
        if (result === 'reset') {
          if (++restarts > 3) break;
          continue;
        }
        total += updates.length;
        if (updates.length < batch) break;
      }
      // Rearmada (con lo que se conservó del snapshot malo): con todo bajado, se sube lo que el servidor no tiene. La marca
      // está guardada (R-1): si la app se cerró a mitad de la bajada, esto corre en la próxima (el ciclo baja las páginas
      // marcadas aunque estén al día).
      if ((await this.db.get('docState', pageId))?.rebuilt) await this.settleRebuild(pageId);
      return total;
    });
  }

  /**
   * Un snapshot que este dispositivo aplicó dejó de valer (se invalidó su cadena: cambió la época de contenido de la
   * página, Docs/Doc_Compactar.md, sección 12). Si la página no tiene nada sin subir (ni en memoria, ni marca, ni envío,
   * ni versión sin confirmar, ni rechazo), **se rearma con lo del servidor** (D110), en una sola transacción: lo guardado
   * se cambia por **sus elementos sin ningún borrado** (`elementsOnly`), y se olvidan el cursor, `syncedSV`, `syncedDS` y
   * el snapshot. Lo que trajo un snapshot malo se resuelve así:
   *
   * - un **borrado** que las filas no tienen no queda (lo guardado ya no trae borrados; los que valen llegan con las
   *   filas), así que no sube ni llega a nadie;
   * - un **elemento** que las filas no tienen se conserva, y con él lo propio que se escribió colgado de él: después de
   *   bajar, si lo guardado tiene algo que el servidor no, se marca para subir (`settleRebuild`; auditoría de la entrega
   *   2, O-A: si se tirara, lo escrito al lado quedaría invisible en todos). Ante la duda, sobra texto y no falta.
   *
   * La página abierta se vuelve a armar desde lo guardado (`stale` y el aviso).
   *
   * Con algo sin subir, no se rearma todavía (`deferred`): se olvida solo `syncedSV` (y el envío armado contra él), así
   * lo propio sube primero con todos sus elementos (también lo que colgaba de un elemento del snapshot), mientras
   * `syncedDS` sigue sin dejar subir los borrados que trajo el snapshot. El rearmado va en la bajada siguiente.
   * Antes (v0.127) se borraban las dos cuentas y la página volvía a subir entera: el borrado de un snapshot malo llegaba
   * a todos (auditoría de la entrega 1, O1).
   */
  private async resetContent(pageId: string, epoch: number): Promise<'rebuilt' | 'deferred'> {
    if (!this.isSaved(pageId)) return 'deferred';
    const tx = this.db.transaction(['docUpdates', 'docState', 'meta'], 'readwrite');
    const [stored, dirty, keys, rows] = await Promise.all([
      tx.objectStore('docState').get(pageId),
      tx.objectStore('meta').get(dirtyKey(pageId)),
      tx.objectStore('docUpdates').index('pageId').getAllKeys(pageId),
      tx.objectStore('docUpdates').index('pageId').getAll(pageId),
    ]);
    const state = stored ?? emptyDocState(pageId);
    if (dirty !== undefined || state.pending || state.rejected || hasUnsyncedContent(state, false)) {
      // Una sola vez por época (R-2): la subida que sigue lleva todos los elementos de la página; las siguientes, solo lo
      // nuevo. Si igual quedara algo, el rearmado lo sube al terminar de bajar (`settleRebuild`).
      if (!state.rejected && state.forgotSyncedForEpoch !== epoch && (state.syncedSV !== undefined || state.pending)) {
        state.syncedSV = undefined;
        state.pending = undefined;
        state.forgotSyncedForEpoch = epoch;
        await tx.objectStore('docState').put(state);
      }
      await tx.done;
      return 'deferred';
    }
    // Sin ningún await en el medio: la transacción sigue abierta mientras se arma.
    const keep = elementsOnly(rows.map((r) => r.data));
    if (keep === 'failed') {
      // No se pudieron separar los elementos de los borrados (no pasa nunca): no se tira nada. Se olvida `syncedSV`
      // (los elementos suben) y se conserva `syncedDS` (los borrados del snapshot no); esta página queda con lo suyo.
      state.syncedSV = undefined;
      state.snapshotId = undefined;
      state.contentEpoch = epoch;
      await tx.objectStore('docState').put(state);
      await tx.objectStore('meta').put(crypto.randomUUID(), dirtyKey(pageId));
      await tx.done;
      console.warn(`Página ${pageId}: se invalidó un snapshot que este dispositivo usó y no se pudo rearmar; se sube lo suyo.`);
      return 'deferred';
    }
    await Promise.all(keys.map((k) => tx.objectStore('docUpdates').delete(k)));
    if (keep) await tx.objectStore('docUpdates').add({ pageId, data: keep });
    state.cursor = 0;
    state.syncedSV = undefined;
    state.syncedDS = undefined;
    state.syncedDSGeneration = undefined;
    state.snapshotId = undefined;
    state.contentEpoch = epoch;
    // Lo ilegible se vuelve a anotar si sigue ahí al bajar de nuevo.
    state.unreadable = undefined;
    state.lastError = undefined;
    state.forgotSyncedForEpoch = undefined;
    // En la misma transacción que el rearmado (R-1): si la app se cierra antes de terminar de bajar, la marca sigue ahí.
    if (keep) state.rebuilt = true;
    else delete state.rebuilt;
    await tx.objectStore('docState').put(state);
    await tx.done;
    console.warn(`Página ${pageId}: se invalidó un snapshot que este dispositivo usó; se rearma con lo del servidor.`);
    const live = this.live.get(pageId);
    if (live) {
      // El documento abierto tiene lo del snapshot: se vuelve a armar desde lo guardado (la página lo reabre).
      live.stale = true;
      for (const fn of this.unsupportedListeners) fn(pageId);
    }
    return 'rebuilt';
  }

  /**
   * Después de bajar una página rearmada (`resetContent`, o restaurada con un snapshot aplicado): si lo guardado tiene
   * elementos que el servidor no (lo que trajo un snapshot malo y lo que se escribió colgado de eso), se marca para
   * subir. La subida lleva solo eso: los borrados guardados son los que bajaron. Si no tiene nada de más, no sale nada.
   */
  private async settleRebuild(pageId: string): Promise<void> {
    const saved = await this.readSaved(pageId, { keepDeleted: true });
    let extra: boolean;
    try {
      const synced = saved.state.syncedSV ? Y.decodeStateVector(saved.state.syncedSV) : new Map<number, number>();
      const local = Y.decodeStateVector(Y.encodeStateVector(saved.doc));
      extra = saved.doc.store.pendingStructs !== null || [...local].some(([client, clock]) => clock > (synced.get(client) ?? 0));
    } finally {
      saved.doc.destroy();
    }
    // La marca de subir y el fin del rearmado en la misma transacción (R-1): nunca queda una sin la otra.
    const tx = this.db.transaction(['meta', 'docState'], 'readwrite');
    const stored = await tx.objectStore('docState').get(pageId);
    if (extra) await tx.objectStore('meta').put(crypto.randomUUID(), dirtyKey(pageId));
    if (stored?.rebuilt) {
      delete stored.rebuilt;
      await tx.objectStore('docState').put(stored);
    }
    await tx.done;
    if (!extra) return;
    console.warn(`Página ${pageId}: lo rearmado tiene algo que el servidor no; se sube.`);
    this.track(pageId, this.bumpVersion(pageId));
    for (const fn of this.localChangeListeners) {
      try {
        fn(pageId);
      } catch (err) {
        console.error('local change listener failed', err);
      }
    }
  }

  /**
   * Guarda lo bajado del servidor y avanza el cursor y `syncedSV` en la misma transacción (si la app se
   * cierra en el medio, no cambia nada de los tres).
   *
   * `syncedSV` avanza solo con lo que el servidor mandó (ver `advanceSynced`): así la próxima subida no
   * reenvía lo bajado, y lo propio sin confirmar sigue quedando afuera del vector, o sea, adentro de lo que
   * falta subir.
   */
  private async applyRemote(
    pageId: string,
    updates: RemoteUpdate[],
  ): Promise<'ok' | 'reset' | 'snapshot_unreadable' | 'snapshot_corrupt'> {
    // Un snapshot con la huella que guardó la base (entrega 3, O-D) se comprueba antes de nada: si no coincide, la copia
    // se corrompió en la base (o en el camino) y no se guarda nada de este lote, aunque se pueda leer.
    for (const u of updates) {
      if (u.snapshotId && u.snapshotSha256 !== undefined && (await sha256Hex(u.data)) !== u.snapshotSha256) return 'snapshot_corrupt';
    }
    const decoded: ReturnType<typeof Y.decodeUpdate>[] = [];
    let snapshotUnreadable = false;
    const valid = updates.filter((u) => {
      try {
        decoded.push(Y.decodeUpdate(u.data));
        return true;
      } catch {
        // Un snapshot ilegible no se saltea como una fila: juntaría las filas `1..seq` enteras (Docs/Doc_Compactar.md,
        // sección 5). No se guarda nada de este lote.
        if (u.snapshotId) snapshotUnreadable = true;
        // Queda intacto en el servidor; este dispositivo no lo puede leer (por ejemplo, porque lo escribió
        // una versión más nueva de la app).
        else this.onWarning?.(t('docs.unreadable', { page: pageId, seq: u.seq }));
        return false;
      }
    });
    if (snapshotUnreadable) return 'snapshot_unreadable';
    // La época de contenido vino en la misma respuesta (compactar): si este dispositivo aplicó un snapshot de la página
    // y la época es otra, ese snapshot dejó de valer. No se guarda este lote: la página se vuelve a bajar entera.
    const epoch = updates.find((u) => u.contentEpoch !== undefined)?.contentEpoch;
    // Con algo sin subir, el reinicio espera (`resetContent`): el lote se guarda como siempre, pero sin anotar la época
    // ni el snapshot, así la próxima bajada lo vuelve a intentar.
    let keepEpoch = false;
    if (epoch !== undefined && epochChanged(await this.db.get('docState', pageId), epoch)) {
      if ((await this.resetContent(pageId, epoch)) === 'rebuilt') return 'reset';
      keepEpoch = true;
    }
    const snapshotId = [...valid].reverse().find((u) => u.snapshotId)?.snapshotId;
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
    // Lo propio sin subir que lo bajado deja borrado (B.16): también afuera, y solo si lo bajado trae borrados y
    // la página tiene algo sin subir (lo común es que no: no se arma nada).
    const removed = merged && deletes && deletes.pulled.size > 0 ? await this.inspectRemovedWriting(pageId, merged) : null;
    // Una base limpia que cubre lo guardado lo reemplaza (es la página entera): así no se juntan bases en el dispositivo
    // ni queda el texto borrado que traían las filas de antes. Solo sin nada sin subir; también afuera.
    const replace = merged && valid.length === 1 && updates.length === 1 && this.isBaseReader?.(pageId)
      ? await this.replaceableRows(pageId, merged)
      : null;

    const tx = this.db.transaction(['docUpdates', 'docState', 'meta'], 'readwrite');
    const [stored, generation] = await Promise.all([
      tx.objectStore('docState').get(pageId),
      tx.objectStore('meta').get(GENERATION_KEY),
    ]);
    const state = stored ?? emptyDocState(pageId);
    if (maxSeq <= state.cursor) {
      await tx.done;
      return 'ok';
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
      if (replace) {
        // Lo guardado no cambió desde que se miró (las mismas filas, sin marca de ediciones sin subir ni envío
        // pendiente): se reemplaza en esta misma transacción. Si cambió, la base queda sumada como una fila más.
        const [keys, dirtyNow] = await Promise.all([
          tx.objectStore('docUpdates').index('pageId').getAllKeys(pageId),
          tx.objectStore('meta').get(dirtyKey(pageId)),
        ]);
        const same = replace.keys.every((k) => keys.some((x) => x === k)) && keys.length === replace.keys.length + 1;
        if (same && dirtyNow === undefined && !state.pending && !hasUnsyncedContent(state, false)) {
          await Promise.all(replace.keys.map((k) => tx.objectStore('docUpdates').delete(k)));
        }
      }
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
    // El último snapshot aplicado y la época de la misma respuesta (Docs/Doc_Compactar.md, sección 5).
    if (!keepEpoch) {
      if (snapshotId) state.snapshotId = snapshotId;
      if (epoch !== undefined) state.contentEpoch = epoch;
    }
    await tx.objectStore('docState').put(state);
    if (removed) {
      // En la misma transacción que lo bajado: si queda guardado, queda el aviso.
      const meta = tx.objectStore('meta');
      const before = await meta.get(removedWritingKey(pageId));
      const list = [...(Array.isArray(before) ? (before as RemovedWriting[]) : []), { at: Date.now(), ...removed }];
      await meta.put(list.slice(-REMOVED_WRITING_KEEP), removedWritingKey(pageId));
    }
    await tx.done;
    if (removed) {
      for (const fn of this.removedWritingListeners) {
        try {
          fn(pageId);
        } catch (err) {
          console.error('removed writing listener failed', err);
        }
      }
    }

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
    return 'ok';
  }

  /**
   * Las filas guardadas de la página que una base limpia que llega puede reemplazar: todas, si no hay nada sin subir
   * (ni en memoria) y la base cubre lo guardado (`coversLocal`). Si no, `null`. Lee en una transacción de solo lectura.
   */
  private async replaceableRows(pageId: string, incoming: Uint8Array): Promise<{ keys: number[] } | null> {
    if (!this.isSaved(pageId)) return null;
    const tx = this.db.transaction(['docUpdates', 'docState', 'meta'], 'readonly');
    const [state, dirty, keys, rows] = await Promise.all([
      tx.objectStore('docState').get(pageId),
      tx.objectStore('meta').get(dirtyKey(pageId)),
      tx.objectStore('docUpdates').index('pageId').getAllKeys(pageId),
      tx.objectStore('docUpdates').index('pageId').getAll(pageId),
    ]);
    await tx.done;
    if (dirty !== undefined || state?.pending || (state && hasUnsyncedContent(state, false))) return null;
    if (keys.length === 0 || !coversLocal(rows.map((r) => r.data), incoming)) return null;
    return { keys };
  }

  /**
   * Arma la base limpia de la página desde lo guardado en el dispositivo (Docs/Doc_Privacidad_Borrado.md, 4.1), solo si
   * lo guardado es exactamente lo del servidor hasta `seq`: el cursor llegó ahí, no hay nada sin subir (ni en memoria,
   * ni un envío en vuelo), nada ilegible ni rechazado. Pasa las dos comprobaciones (`checkCleanBase`). Devuelve la base,
   * o por qué no se armó. Con el candado de la página: nada se baja ni se sube en el medio.
   */
  buildCleanBase(pageId: string, seq: number): Promise<{ base: Uint8Array } | { skip: string }> {
    return this.withLock(pageId, async () => {
      await this.flush(pageId);
      if (!this.isSaved(pageId)) return { skip: 'unsaved' };
      // Las filas, el estado y la marca en la misma transacción: lo que se arma es lo que se comprobó.
      const tx = this.db.transaction(['docUpdates', 'docState', 'meta'], 'readonly');
      const [rows, state, dirty] = await Promise.all([
        tx.objectStore('docUpdates').index('pageId').getAll(pageId),
        tx.objectStore('docState').get(pageId),
        tx.objectStore('meta').get(dirtyKey(pageId)),
      ]);
      await tx.done;
      if (!state || state.cursor !== seq) return { skip: 'not current' };
      if (dirty !== undefined || state.pending || hasUnsyncedContent(state, false)) return { skip: 'unsynced' };
      if (state.unreadable || state.rejected) return { skip: 'unreadable' };
      const built = buildCleanBase(rows.map((r) => r.data));
      try {
        const problem = checkCleanBase(built.base, built.doc);
        return problem ? { skip: `check: ${problem}` } : { base: built.base };
      } finally {
        built.doc.destroy();
      }
    });
  }

  /**
   * Las filas guardadas de la página, para probar lo que escribe un link público antes de admitirlo
   * (Docs/Doc_Link_Publico.md, E2.3): con las mismas condiciones que `buildCleanBase` (el cursor en `seq`, nada sin subir
   * ni en memoria ni en vuelo, nada ilegible ni rechazado), así son exactamente las filas del servidor hasta `seq`. Con el
   * candado de la página: nada se baja ni se sube en el medio.
   */
  savedRows(pageId: string, seq: number): Promise<{ rows: Uint8Array[] } | { skip: string }> {
    return this.withLock(pageId, async () => {
      await this.flush(pageId);
      if (!this.isSaved(pageId)) return { skip: 'unsaved' };
      const tx = this.db.transaction(['docUpdates', 'docState', 'meta'], 'readonly');
      const [rows, state, dirty] = await Promise.all([
        tx.objectStore('docUpdates').index('pageId').getAll(pageId),
        tx.objectStore('docState').get(pageId),
        tx.objectStore('meta').get(dirtyKey(pageId)),
      ]);
      await tx.done;
      if (!state || state.cursor !== seq) return { skip: 'not current' };
      if (dirty !== undefined || state.pending || hasUnsyncedContent(state, false)) return { skip: 'unsynced' };
      if (state.unreadable || state.rejected) return { skip: 'unreadable' };
      return { rows: rows.map((r) => r.data) };
    });
  }

  /**
   * Una página que el servidor rechazó vuelve a intentarse (lo de `clearRejected`, para una sola). En modo link, la
   * primera edición guardada después de un rechazo lo hace (Docs/Doc_Link_Publico.md, E2.9: deshacer un pegado de más de
   * 1 MB destraba la página sin reabrir la app).
   */
  async clearRejectedPage(pageId: string): Promise<boolean> {
    const state = await this.db.get('docState', pageId);
    if (!state?.rejected) return false;
    await this.withLock(pageId, () =>
      updateDocState(this.db, pageId, (s) => {
        s.rejected = undefined;
        s.pending = undefined;
      }),
    );
    return true;
  }

  /**
   * Cómo está guardada la página ahora (las filas, la marca de lo sin subir, la versión): para volver a la versión del
   * equipo (`replaceWithServer`) solo si nada cambió desde que se bajó la copia (Docs/Doc_Link_Publico.md, entrega 2c).
   */
  async localMark(pageId: string): Promise<LocalMark> {
    await this.flush(pageId);
    const tx = this.db.transaction(['docUpdates', 'docState', 'meta'], 'readonly');
    const [keys, state, dirty] = await Promise.all([
      tx.objectStore('docUpdates').index('pageId').getAllKeys(pageId),
      tx.objectStore('docState').get(pageId),
      tx.objectStore('meta').get(dirtyKey(pageId)),
    ]);
    await tx.done;
    return { keys: keys.map(Number), dirty: typeof dirty === 'string' ? dirty : null, version: state?.version ?? 0, saved: this.isSaved(pageId) };
  }

  /**
   * Volver a la página como la ve el equipo (un visitante con un link, entrega 2c): lo guardado de la página se cambia por
   * lo que manda el servidor (`updates`, la base limpia), como un dispositivo que la baja de cero. Solo si lo guardado es
   * exactamente lo de `mark` (lo que se bajó como copia antes): si se escribió algo en el medio, no se toca nada y tira
   * `LOCAL_CHANGED`. Lo de antes no se tira: queda junto, en `meta` (`startedOverKey`), y sale en "bajar lo pendiente".
   * El documento abierto se vuelve a armar desde lo guardado (la página lo reabre, con otro autor de Yjs: lo que se
   * escriba ahora ya no cuelga de lo apartado).
   */
  replaceWithServer(pageId: string, updates: RemoteUpdate[], mark: LocalMark): Promise<void> {
    return this.withLock(pageId, async () => {
      await this.flush(pageId);
      if (!mark.saved || !this.isSaved(pageId)) throw new Error(LOCAL_CHANGED);
      const tx = this.db.transaction(['docUpdates', 'docState', 'meta'], 'readwrite');
      const index = tx.objectStore('docUpdates').index('pageId');
      const [keys, rows, stored, dirty, kept] = await Promise.all([
        index.getAllKeys(pageId),
        index.getAll(pageId),
        tx.objectStore('docState').get(pageId),
        tx.objectStore('meta').get(dirtyKey(pageId)),
        tx.objectStore('meta').get(startedOverKey(pageId)),
      ]);
      const same =
        keys.length === mark.keys.length &&
        keys.every((k, i) => Number(k) === mark.keys[i]) &&
        (typeof dirty === 'string' ? dirty : null) === mark.dirty &&
        (stored?.version ?? 0) === mark.version;
      if (!same) {
        tx.abort();
        await tx.done.catch(() => undefined);
        throw new Error(LOCAL_CHANGED);
      }
      // Lo de antes, junto con lo de una vuelta anterior: nunca se pierde (sin ningún await en el medio).
      const before = [...(kept instanceof Uint8Array ? [kept] : []), ...rows.map((r) => r.data)];
      if (before.length > 0) await tx.objectStore('meta').put(Y.mergeUpdates(before), startedOverKey(pageId));
      await Promise.all(keys.map((k) => tx.objectStore('docUpdates').delete(k)));
      await tx.objectStore('meta').delete(dirtyKey(pageId));
      // Como una página que este dispositivo nunca tuvo, sin nada pendiente: la versión queda confirmada (una versión
      // anterior de la app que abra esta base tampoco la ve pendiente).
      const version = stored?.version ?? 0;
      await tx.objectStore('docState').put({ pageId, cursor: 0, version, ackedVersion: version });
      await tx.done;
      const live = this.live.get(pageId);
      // Lo que llega no se aplica al documento abierto (tiene lo de antes): se arma de nuevo desde lo guardado.
      if (live) live.stale = true;
      if (updates.length > 0) await this.applyRemote(pageId, updates);
      if (live) for (const fn of this.unsupportedListeners) fn(pageId);
    });
  }

  /**
   * La página cambió en otra pestaña (volvió a la versión del equipo, entrega 2c): el documento abierto acá se vuelve a
   * armar desde lo guardado.
   */
  reloadFromSaved(pageId: string): void {
    const live = this.live.get(pageId);
    if (!live) return;
    live.stale = true;
    for (const fn of this.unsupportedListeners) fn(pageId);
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

  /** Hubo ediciones locales de la página en esta sesión de la app. */
  private wroteHere(pageId: string): boolean {
    return this.written.has(pageId);
  }

  /**
   * Si lo bajado deja borrado algo que este dispositivo escribió (B.16), su texto (ver `findRemovedWriting`); si
   * no, `null`. Arma un documento sin GC con lo guardado solo si la página tiene algo sin subir o se editó en esta
   * sesión, y si hay autores propios anotados. Un error acá no frena la bajada: el texto igual sube (la subida va
   * sin GC), solo falta el aviso.
   */
  private async inspectRemovedWriting(
    pageId: string,
    merged: Uint8Array,
  ): Promise<{ text: string; ranges: [number, number, number][] } | null> {
    try {
      const tx = this.db.transaction(['docUpdates', 'docState', 'meta'], 'readonly');
      const meta = tx.objectStore('meta');
      const [state, dirty, ownKeys] = await Promise.all([
        tx.objectStore('docState').get(pageId),
        meta.get(dirtyKey(pageId)),
        meta.getAllKeys(ownClientRange(pageId)),
      ]);
      // Rearmada: lo que baja vuelve a borrar lo que ya estaba borrado (no es de otro que borró lo que se escribía).
      if (state?.rebuilt) {
        await tx.done;
        return null;
      }
      // Nada sin subir y nada escrito en esta sesión, o ningún autor propio: no hay qué mirar (lo común).
      const recent = hasUnsyncedContent(state ?? emptyDocState(pageId), dirty !== undefined) || this.wroteHere(pageId);
      if (!recent || ownKeys.length === 0) {
        await tx.done;
        return null;
      }
      const rows = await tx.objectStore('docUpdates').index('pageId').getAll(pageId);
      await tx.done;
      return findRemovedWriting(
        rows.map((r) => r.data),
        merged,
        new Set(ownKeys.map(clientOfKey)),
      );
    } catch (err) {
      console.warn(`Page ${pageId}: could not check for removed writing.`, err);
      return null;
    }
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
  private persistLocal(pageId: string, updates: Uint8Array[], clients: Iterable<number> = []): void {
    this.written.add(pageId);
    for (const client of clients) {
      if (this.recordedClients.has(`${pageId}:${client}`)) continue;
      const pending = this.unrecordedClients.get(pageId) ?? new Set<number>();
      pending.add(client);
      this.unrecordedClients.set(pageId, pending);
    }
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
    // Los autores de Yjs nuevos de esta página se anotan con la edición (B.16, `ownClientKey`).
    const clients = [...(this.unrecordedClients.get(pageId) ?? [])];
    this.unrecordedClients.delete(pageId);

    let done: Promise<void>;
    try {
      const tx = this.db.transaction(['docUpdates', 'meta'], 'readwrite');
      const data = batch.length === 1 ? batch[0] : Y.mergeUpdates(batch);
      // Los errores de cada pedido llegan también por `tx.done`.
      void tx.objectStore('docUpdates').add({ pageId, data }).catch(() => undefined);
      void tx.objectStore('meta').put(crypto.randomUUID(), dirtyKey(pageId)).catch(() => undefined);
      for (const client of clients) void tx.objectStore('meta').put(Date.now(), ownClientKey(pageId, client)).catch(() => undefined);
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
        for (const client of clients) this.recordedClients.add(`${pageId}:${client}`);
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
        // Los autores sin anotar vuelven a la lista: se anotan con el reintento.
        if (clients.length > 0) {
          const pending = this.unrecordedClients.get(pageId) ?? new Set<number>();
          for (const client of clients) pending.add(client);
          this.unrecordedClients.set(pageId, pending);
        }
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
    { keepDeleted = false }: { keepDeleted?: boolean } = {},
  ): Promise<{ doc: Y.Doc; state: DocState; dirty?: string; generation: number }> {
    const tx = this.db.transaction(['docUpdates', 'docState', 'meta'], 'readonly');
    const [rows, stored, dirty, generation] = await Promise.all([
      tx.objectStore('docUpdates').index('pageId').getAll(pageId),
      tx.objectStore('docState').get(pageId),
      tx.objectStore('meta').get(dirtyKey(pageId)),
      tx.objectStore('meta').get(GENERATION_KEY),
    ]);
    await tx.done;
    let doc: Y.Doc;
    if (keepDeleted) {
      // Para subir (B.16): sin GC, así lo borrado conserva su texto, y fila por fila en orden, así gana la primera
      // copia de cada elemento (la que se guardó al escribirlo), nunca una posterior que lo trae como hueco.
      doc = new Y.Doc({ gc: false });
      applyRowsInOrder(doc, rows.map((r) => r.data), ORIGIN_LOAD);
    } else {
      doc = new Y.Doc();
      if (rows.length > 0) Y.applyUpdate(doc, Y.mergeUpdates(rows.map((r) => r.data)), ORIGIN_LOAD);
    }
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
    // Para compactar, en orden y sin GC (B.16): `mergeUpdates` puede quedarse con una copia de un elemento como
    // hueco en vez de la que tiene el texto.
    const compact = rows.length > COMPACT_AT;
    const data = rows.map((r) => r.data);
    const merged = rows.length === 0 ? null : compact ? mergeRowsInOrder(data) : Y.mergeUpdates(data);
    if (merged && compact) {
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
/**
 * Si este dispositivo aplicó un snapshot de la página (`snapshotId`) y la época de contenido que manda el servidor es
 * otra (no "mayor": después de restaurar una copia puede haber cambiado de cualquier forma). Sin snapshot aplicado, la
 * época no importa: las filas no se invalidan nunca.
 */
export function epochChanged(state: DocState | undefined, epoch: number | undefined): boolean {
  return epoch !== undefined && state?.snapshotId !== undefined && state.contentEpoch !== epoch;
}

/**
 * Lo mismo con la época del árbol, que puede venir atrasada (leída antes de lo último bajado): solo si es **más nueva**
 * que la anotada. La de la base nunca vuelve atrás (tampoco al restaurar una copia: el script lo cuida, y
 * `resetForRestore` borra la anotada), así que una menor es un árbol viejo (auditoría de la entrega 1, O2).
 */
export function epochBehind(state: DocState | undefined, treeEpoch: number | undefined): boolean {
  if (treeEpoch === undefined || state?.snapshotId === undefined) return false;
  return state.contentEpoch === undefined || treeEpoch > state.contentEpoch;
}

export function knownDeletes(state: DocState, generation: number): Uint8Array | undefined {
  return state.syncedDS && state.syncedDSGeneration === generation ? state.syncedDS : undefined;
}

/** Suma a `syncedDS` borrados que el servidor tiene (confirmados o bajados), con la generación de ahora. */
function addKnownDeletes(state: DocState, generation: number, more: DeleteRanges): void {
  const known = knownDeletes(state, generation);
  state.syncedDS = encodeRanges(known ? unionRanges(rangesOf(known), more) : more);
  state.syncedDSGeneration = generation;
}

/**
 * Las filas guardadas de una página como un solo update con **todos sus elementos y ningún borrado** (en orden y sin
 * GC: con el texto de lo borrado). `null` si no hay elementos; `'failed'` si no se pudieron separar (no pasa nunca:
 * `buildUpload` y, si no, `Y.createDocFromSnapshot`).
 */
export function elementsOnly(rows: Uint8Array[]): Uint8Array | null | 'failed' {
  if (rows.length === 0) return null;
  const doc = new Y.Doc({ gc: false });
  try {
    applyRowsInOrder(doc, rows);
    if (Y.encodeStateVector(doc).length <= 1 && !doc.store.pendingStructs) return null;
    const all = rangesOf(Y.encodeStateAsUpdate(doc));
    const built = buildUpload(doc, undefined, encodeRanges(all));
    if (rangesOf(built.update).size === 0) return built.update;
    const copy = Y.createDocFromSnapshot(doc, Y.createSnapshot(Y.createDeleteSet(), Y.decodeStateVector(Y.encodeStateVector(doc))));
    try {
      const out = Y.encodeStateAsUpdate(copy);
      return rangesOf(out).size === 0 ? out : 'failed';
    } finally {
      copy.destroy();
    }
  } catch {
    return 'failed';
  } finally {
    doc.destroy();
  }
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
