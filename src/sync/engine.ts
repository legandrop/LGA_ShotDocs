// Los avisos del estado van en inglés y se traducen al mostrarlos (`localize` en SyncBadge.tsx).
import { stored as t } from '../i18n';
import type { MediaQueue, MediaStatus } from '../media/queue';
import { mediaIdsInDoc } from '../media/usage';
import * as Y from 'yjs';
import { LEVEL_EDIT, Permissions, TEAM_SCHEMA_VERSION, type AccessStore } from './access';
import { CLEAN_PER_ROUND, CLEAN_SCHEMA_VERSION, sha256Hex } from './clean';
import type { CommentQueue } from './comments';
import { canCompact, compactPage, SNAPSHOT_MIN_ROWS, type CompactOptions, type CompactOutcome } from './compact';
import { epochBehind, type PageDocs } from './docs';
import type { PageFiles } from './files';
import { canAdmit, LINK_EDIT_SCHEMA_VERSION, LinkAdmission } from './linkAdmit';
import { hasUnsyncedContent, type DocState } from './localDb';
import { APP_OUTDATED, SNAPSHOT_SCHEMA_VERSION, type Remote } from './remote';
import { AUTHOR_MISSING } from './types';
import type { PageTree } from './tree';
import { errorMessage, isNetworkError, isPermanent, isTimeout, REQUEST_TIMEOUT, type QueuedOp, type WorkspaceSettings } from './types';

export interface SyncStatus {
  /** El último intento de hablar con el servidor tuvo respuesta (aunque fuera un error). */
  online: boolean;
  syncing: boolean;
  pendingOps: number;
  /** Páginas con contenido sin subir, incluidas las que todavía no se pudieron guardar en el dispositivo. */
  pendingPages: number;
  pendingFiles: number;
  /** Fotos y videos (y sus usos en otras páginas) que faltan subir: la cola de archivos grandes. */
  pendingMedia: number;
  /** Fotos y videos detenidos por un error que no se arregla solo. Siguen en el dispositivo. */
  failedMedia: number;
  /** El último error de la cola de archivos grandes, que se va a reintentar. */
  mediaError: string | null;
  /** La foto o el video que se está subiendo. */
  uploading: MediaStatus['uploading'];
  /** Comentarios (altas, ediciones, borrados y resoluciones) que faltan subir. */
  pendingComments: number;
  /** Comentarios que el servidor rechazó para siempre. Siguen en el dispositivo, a la vista. */
  failedComments: number;
  /** El último error de la cola de comentarios, que se va a reintentar. */
  commentError: string | null;
  /** Dirección del portero de archivos del workspace (`workspace_settings.media_url`), si se sabe. */
  mediaUrl: string | null;
  /** El dueño del workspace, si se sabe. */
  ownerId: string | null;
  /** Nombre y clave local del workspace (`workspace_settings`), si se saben: van en los links de invitación. */
  workspaceName: string | null;
  workspaceLocalKey: string | null;
  /**
   * El borrado automático de la papelera de archivos a los 30 días (`workspace_settings.auto_purge_files`).
   * Apagado hasta que Lega lo confirme (paso 11).
   */
  autoPurgeFiles: boolean;
  /** Cambios del árbol que el servidor rechazó para siempre. */
  failedOps: number;
  /** Páginas cuyo contenido el servidor rechazó para siempre (por ejemplo, por tamaño). */
  rejectedPages: number;
  /** No se pudo guardar en el dispositivo. Se reintenta solo y no se limpia hasta que funcione. */
  localError: string | null;
  /** Algo que no se pudo leer del servidor. Queda a la vista hasta reabrir la app. */
  warning: string | null;
  /** La cola de fotos y videos está apagada en este dispositivo (su base no se pudo abrir), y por qué. */
  mediaWarning: string | null;
  /** Algo que pasó y conviene saber, sin que sea un problema (por ejemplo, que se restauró una copia). */
  notice: string | null;
  /**
   * El workspace pide una versión más nueva de la app. El contenido no se sube (queda en el dispositivo)
   * hasta actualizar.
   */
  outdated: boolean;
  /**
   * La base del workspace es más vieja que la que necesita esta versión de la app: `[la que tiene, la que
   * hace falta]`. Lo arregla el dueño aplicando las migraciones; mientras tanto, lo nuevo puede no andar.
   */
  schemaBehind: [number, number] | null;
  /** La versión de la base del workspace (`workspace_settings.schema_version`); `null` hasta saberla. */
  schemaVersion: number | null;
  /**
   * El interruptor de la privacidad de lo borrado está prendido y la base lo tiene (Docs/Doc_Privacidad_Borrado.md):
   * quien no ve lo borrado baja solo bases limpias, que arman los dispositivos de quien edita.
   */
  cleanOn: boolean;
  lastError: string | null;
  lastSyncAt: number | null;
}

const INTERVAL_MS = 10_000;
/** Sin actividad (subir o bajar contenido) en este rato, `clean_work` se pregunta cada `CLEAN_IDLE_MS`, no en cada ciclo. */
const CLEAN_ACTIVE_MS = 5 * 60_000;
const CLEAN_IDLE_MS = 2 * 60_000;
const DEBOUNCE_MS = 1_200;
/** Compactar: cuántas reservas se piden por ciclo como mucho, y cuándo se vuelve a pedir una que la base no dio. */
const COMPACT_CLAIMS_PER_ROUND = 3;
const COMPACT_RETRY_ROWS = 50;
const COMPACT_RETRY_MS = 30 * 60_000;
const PULL_CONCURRENCY = 4;
/**
 * Lo que contestan `push_page_update` y `pull_page_content` cuando la página no existe o la sesión no puede editarla
 * (o verla): así queda guardado el rechazo del contenido (`DocState.rejected`).
 */
const PAGE_NOT_FOUND = 'page_not_found';

/**
 * Un ciclo de sincronización, siempre en este orden:
 * 1. Cambios del árbol, en el orden en que se hicieron (así una página existe antes que su contenido).
 * 2. Los proyectos y, después, todas sus páginas.
 * 3. Contenido pendiente de cada página.
 * 4. Contenido nuevo de las páginas que cambiaron en el servidor.
 * 5. Imágenes pendientes (al final: una foto grande en una red mala no frena el texto).
 * Después arranca, sin esperarla, la cola de fotos y videos (`media/queue.ts`), que tiene su propio ciclo:
 * una subida de minutos no frena al texto.
 * Nunca hay dos ciclos a la vez.
 */
export class SyncEngine {
  private status: SyncStatus = {
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    syncing: false,
    pendingOps: 0,
    pendingPages: 0,
    pendingFiles: 0,
    pendingMedia: 0,
    failedMedia: 0,
    mediaError: null,
    uploading: null,
    pendingComments: 0,
    failedComments: 0,
    commentError: null,
    mediaUrl: null,
    ownerId: null,
    workspaceName: null,
    workspaceLocalKey: null,
    autoPurgeFiles: false,
    failedOps: 0,
    rejectedPages: 0,
    localError: null,
    warning: null,
    mediaWarning: null,
    notice: null,
    outdated: false,
    schemaBehind: null,
    schemaVersion: null,
    cleanOn: false,
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
  /** El borrado automático de la papelera de archivos ya se miró en esta apertura de la app. */
  private autoPurgeChecked = false;
  /**
   * Páginas cuya comprobación de historial (ver `verifyHistory`) falló por un error: no se vuelve a bajar
   * el historial hasta `until`, esperando cada vez más (1 minuto, 2, 4… hasta 1 hora).
   */
  private readonly verifyWait = new Map<string, { failures: number; until: number }>();
  /** Páginas cuyos usos en el servidor ya se leyeron en esta apertura (ver `reconcileMedia`). */
  private readonly usesAsked = new Set<string>();
  /** Ya se sabe, en esta apertura, si esta versión es más vieja que la mínima del workspace (`status.outdated`). */
  private versionKnown = false;
  /** La versión desde la que se arman bases limpias (`clean_min_version`), o `null`: el interruptor está apagado. */
  private cleanMin: number | null = null;
  /** La última vez que este dispositivo subió o bajó contenido, y la última que preguntó qué bases armar. */
  private lastActivityAt = 0;
  private lastCleanAt = 0;
  /** La app pasó a segundo plano: el próximo ciclo arma las bases sin esperar la cadencia. */
  private urgentClean = false;
  /**
   * La versión desde la que se arman snapshots de compactar (`snapshot_min_version`, versión 17 de la base), o `null`:
   * apagados (Docs/Doc_Compactar.md, sección 4.1).
   */
  private snapshotMin: number | null = null;
  /**
   * Páginas cuya reserva la base no dio (poca cola, otra persona compactando, salteada): no se vuelve a pedir hasta que
   * tengan `COMPACT_RETRY_ROWS` filas más o pase `COMPACT_RETRY_MS`. Solo en memoria (por apertura de la app).
   */
  private readonly compactAsked = new Map<string, { seq: number; at: number }>();
  /** Hay una compactación en curso (una a la vez). */
  private compacting = false;
  /**
   * El interruptor de *Can edit* por un link (`link_edit_min_version`, versión 19 de la base), o `null`: apagado. Con él,
   * este dispositivo (si arma bases) admite lo que escribió un link antes de armarlas (Docs/Doc_Link_Publico.md, E2.3).
   */
  private linkEditMin: number | null = null;
  /** La admisión de lo que escribe un link (solo si el servidor la tiene). */
  private admission: LinkAdmission | null = null;
  /** La última edición local guardada de cada página en esta apertura (la admisión espera la pausa). */
  private readonly lastEdit = new Map<string, number>();
  /**
   * Páginas con algo rechazado por "no existe" que una bajada del árbol mostró como no editables (`sawLocked`: el
   * contenido y los archivos) o como no visibles (`sawHidden`: los comentarios). Cuando el árbol vuelve a mostrarlas,
   * eso se reintenta una vez y la página sale de acá (ver `retryReturned`). Solo en memoria: al abrir la app se
   * reintenta todo.
   */
  private readonly sawLocked = new Set<string>();
  private readonly sawHidden = new Set<string>();

  constructor(
    private readonly remote: Remote,
    private readonly tree: PageTree,
    private readonly docs: PageDocs,
    private readonly files: PageFiles,
    private readonly options: {
      appVersion?: string;
      schemaVersion?: number;
      media?: MediaQueue;
      /** Las carpetas que suben (P.9): como la cola de archivos, dejan de esperar cuando vuelve la red. */
      folders?: { networkBack(): void };
      /** Los permisos de la persona: se actualizan en cada sincronización (ver `checkAccess`). */
      access?: AccessStore;
      /** La cola de comentarios (paso 10): sube y baja al final de cada ciclo. */
      comments?: CommentQueue;
      /** El peso de los proyectos (P.7): se entera de la versión de la base en cada sincronización. */
      sizes?: { configure(schemaVersion: number): void };
      /** Cada cuánto se sincroniza solo (10 s; el modo link, 30 s: Docs/Doc_Link_Publico.md, P12). */
      intervalMs?: number;
      /** Compactar (Docs/Doc_Compactar.md): opciones del compactador, para las pruebas. */
      compact?: CompactOptions;
      /** Cada compactación terminada (para las pruebas y el diagnóstico). */
      onCompacted?: (pageId: string, outcome: CompactOutcome) => void;
      /**
       * Modo liviano (link público, P12): qué páginas se bajan en cada ciclo. Sin esto, todas las que cambiaron; con el
       * link, solo las que el dispositivo ya bajó alguna vez (las demás se bajan al abrirlas, `prefetchPage`).
       */
      pullOnly?: (pageId: string, cursor: number) => boolean;
      /**
       * Un link público con *Can edit* (Docs/Doc_Link_Publico.md, E2.9): sin el nombre del visitante no se sube (queda en
       * el dispositivo, sin cortar el ciclo), y la primera edición guardada de una página rechazada la vuelve a intentar
       * (deshacer un pegado de más de 1 MB la destraba sin reabrir la app).
       */
      linkVisitor?: boolean;
      /** El reloj de la pausa de la admisión (la última edición local de cada página); las pruebas pasan el del servidor. */
      now?: () => number;
    } = {},
  ) {
    const poke = () => this.poke();
    tree.onQueued = poke;
    // Qué páginas le llegan a este dispositivo como base limpia (con el interruptor prendido y sin ver lo borrado).
    tree.baseReader = (pageId) => this.isBaseReader(pageId);
    docs.isBaseReader = (pageId) => this.isBaseReader(pageId);
    // Un link con archivos (entrega 2b, Docs/Doc_Link_Publico.md): lo escrito de una página no sale mientras muestre un
    // archivo agregado acá que la base todavía no registró. En la sala, esa fila se apartaría (`foreign_media`) y, en
    // cadena, todo lo que siga de esta sesión en la página; esperando, sale apenas el archivo queda registrado.
    if (options.linkVisitor && options.media) {
      const media = options.media;
      docs.holdUpload = async (_pageId, doc) => {
        const unregistered = await media.unregistered().catch(() => new Set<string>());
        if (unregistered.size === 0) return false;
        const shown = mediaIdsInDoc(doc);
        return [...unregistered].some((id) => shown.has(id));
      };
    }
    files.onQueued = poke;
    if (options.media) {
      options.media.onQueued = poke;
      // La base rechazó un pedido de archivos por la versión mínima: se ve el aviso de actualizar.
      options.media.onOutdated = () => {
        if (!this.stopped) this.patch({ outdated: true });
      };
      // La base de archivos del dispositivo no se pudo abrir: el texto sigue, las fotos y videos no.
      if (options.media.unavailable) {
        this.status = { ...this.status, mediaWarning: t('engine.mediaOff', { reason: options.media.unavailable }) };
      }
      // Después de `stop()` la base puede estar cerrándose: no se cuenta nada más.
      options.media.onChange = () => {
        if (!this.stopped) void this.refreshCounts().catch(() => undefined);
      };
    }
    if (options.comments) {
      options.comments.onQueued = poke;
      // La base rechazó un comentario por la versión mínima: se ve el aviso de actualizar.
      options.comments.onOutdated = () => {
        if (this.stopped) return;
        this.patch({ outdated: true });
        this.options.media?.setOutdated(true);
      };
      options.comments.onChange = () => {
        if (!this.stopped) void this.refreshCounts().catch(() => undefined);
      };
      if (options.comments.unavailable && !this.status.warning) {
        this.status = { ...this.status, warning: t('comments.readOnlyDevice', { reason: options.comments.unavailable }) };
      }
    }
    this.cleanups.push(docs.subscribeLocalChange(poke));
    this.cleanups.push(
      docs.subscribeLocalChange((pageId) => {
        this.lastEdit.set(pageId, (this.options.now ?? Date.now)());
        if (options.linkVisitor && !this.stopped) {
          void docs.clearRejectedPage(pageId).then(
            (cleared) => cleared && !this.stopped && this.poke(),
            () => undefined,
          );
        }
      }),
    );
    docs.onWriteError = (message) => {
      this.patch({ localError: message });
      // Después de `stop()` la base puede estar cerrada: no se cuenta nada más.
      if (!this.stopped) void this.refreshCounts().catch(() => undefined);
    };
    docs.onWarning = (message) => this.patch({ warning: message });
    // Lo que se escribía en algo que otro borró (B.16): la página lo muestra con el texto; acá, el aviso para
    // cuando la página no está abierta (la sincronización la bajó de fondo).
    this.cleanups.push(
      docs.subscribeRemovedWriting((pageId) => {
        // Con la página abierta, el aviso ya está en la página (con el texto).
        if (this.stopped || docs.peek(pageId)) return;
        const title = this.tree.get(pageId)?.title || t('common.untitled');
        this.patch({ notice: t('engine.removedWriting', { page: title }) });
      }),
    );
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
    // Al pasar a segundo plano (cerrar la pestaña, bloquear el iPhone, cambiar de app) se sube lo pendiente y se arman
    // las bases de las páginas con lectores, sin esperar (Docs/Doc_Privacidad_Borrado.md, 4.1). Si el navegador corta
    // la app antes, la arma el próximo editor que sincronice.
    const onHide = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;
      void this.appHidden();
    };
    // Volvió la red: la cola de archivos (y la de las carpetas) deja de esperar al portero o a Storage y prueba enseguida.
    const onOnline = () => {
      this.options.media?.networkBack();
      this.options.folders?.networkBack();
      this.files.networkBack();
      onWake();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('offline', onOffline);
      window.addEventListener('online', onOnline);
      window.addEventListener('focus', onWake);
      document.addEventListener('visibilitychange', onWake);
      document.addEventListener('visibilitychange', onHide);
      window.addEventListener('pagehide', onHide);
      this.cleanups.push(() => {
        window.removeEventListener('offline', onOffline);
        window.removeEventListener('online', onOnline);
        window.removeEventListener('focus', onWake);
        document.removeEventListener('visibilitychange', onWake);
        document.removeEventListener('visibilitychange', onHide);
        window.removeEventListener('pagehide', onHide);
      });
    }
    this.interval = setInterval(onWake, this.options.intervalMs ?? INTERVAL_MS);
    // Lo que el servidor rechazó se vuelve a intentar una vez por apertura: puede que ya se haya arreglado.
    // Un error de la base de archivos nunca saltea la sincronización del texto. Del árbol, solo lo rechazado por la
    // versión mínima (lo dejó una versión anterior de la app, que lo tomaba como un rechazo): lo demás sigue a la vista
    // con su botón de reintentar.
    void Promise.all([
      this.tree.retryFailed((f) => f.error === APP_OUTDATED),
      this.docs.clearRejected(),
      this.clearMediaBlocked(),
      this.options.comments?.retryFailed().catch(() => undefined),
    ]).then(
      () => this.syncNow(),
      () => this.syncNow(),
    );
  }

  /**
   * Deja de sincronizar. Lo que devuelve se cumple cuando termina el ciclo en curso (si lo hay), que
   * corta en su próximo paso: antes de cerrar la base hay que esperarlo. Nunca se rechaza. Desde adentro
   * del ciclo (por ejemplo, en una llamada al servidor) no se espera: se quedaría esperándose a sí mismo.
   */
  stop(): Promise<void> {
    this.stopped = true;
    this.options.media?.stop();
    this.options.comments?.stop();
    if (this.interval) clearInterval(this.interval);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const fn of this.cleanups) fn();
    return this.running?.catch(() => undefined) ?? Promise.resolve();
  }

  /** Vuelve a intentar todo lo que el servidor rechazó: cambios del árbol y contenido. */
  async retryRejected(): Promise<void> {
    await this.tree.retryFailed();
    await this.docs.clearRejected();
    await this.clearMediaBlocked();
    await this.options.comments?.retryFailed().catch(() => undefined);
    await this.syncNow();
  }

  /**
   * Lo rechazado porque la base dijo "no existe" vuelve a intentarse solo cuando la página vuelve. Ese "no existe"
   * (`page_not_found`, `comment_not_found`…) es también lo que la base contesta cuando la sesión dejó de ver o de poder
   * editar la página, y eso se revierte: le devuelven el permiso, la página sale de la papelera, restauran el
   * proyecto. El dato llega con el árbol y los permisos que se bajan en cada ciclo.
   *
   * Una página se reintenta cuando el árbol pasa de "no" a "sí": con algo suyo rechazado, una bajada del árbol tiene
   * que haberla mostrado como no editable (o no visible, para los comentarios) y una posterior, como editable. Ahí se
   * limpia el rechazo y la página sale de la lista de las que se esperan. Si el servidor vuelve a rechazarla, lo
   * escrito sigue en el dispositivo y queda rechazada como antes: no se reintenta de nuevo hasta que el árbol vuelva
   * a decir "no" y otra vez "sí". Nunca hay un reintento por ciclo, y quién puede escribir lo sigue decidiendo la base.
   *
   * Se mira con el árbol recién bajado, antes de subir nada (acá). Lo que se rechaza después se anota en el momento,
   * con ese mismo árbol: el contenido, apenas la base lo rechaza (`noteLocked`); los comentarios, al terminar su cola
   * (`noteHidden`); los archivos, al terminar la suya (`noteFilesLocked`). Así el "no" queda anotado aunque el ciclo
   * se corte enseguida o la app quede sin red hasta que la página vuelve, cuando el árbol siguiente ya dice "sí".
   *
   * Solo esa clase de rechazo: uno por tamaño, por conflicto o por falta del permiso de comentar queda a la vista
   * hasta "Retry" o hasta reabrir la app. Devuelve si limpió el rechazo del contenido de alguna página.
   */
  private async retryReturned(states: Map<string, DocState>): Promise<boolean> {
    const comments = this.options.comments;
    const media = this.options.media;
    const content = [...states.values()].filter((s) => s.rejected === PAGE_NOT_FOUND).map((s) => s.pageId);
    // La base de archivos del dispositivo puede fallar: el texto y los comentarios siguen igual.
    const files = (await media?.notFoundPages().catch(() => [])) ?? [];
    const commented = comments?.notFoundPages() ?? [];
    const editable = this.backAgain(this.sawLocked, [...content, ...files], (id) => this.editableOnServer(id));
    const visible = this.backAgain(this.sawHidden, commented, (id) => this.tree.onServer(id));
    let cleared = false;
    for (const pageId of content) {
      if (editable.has(pageId) && (await this.docs.clearRejectedPage(pageId, PAGE_NOT_FOUND))) cleared = true;
    }
    if (files.some((id) => editable.has(id))) await media?.retryNotFound(editable).catch(() => undefined);
    if (visible.size > 0) await comments?.retryNotFound(visible).catch(() => undefined);
    return cleared;
  }

  /**
   * De las páginas con algo rechazado por "no existe", las que el árbol ya había mostrado en "no" (`seen`) y ahora
   * muestra en "sí" (`ok`): salen de `seen` y se devuelven. Las que están en "no" entran a `seen`, y las que ya no
   * tienen nada rechazado salen.
   */
  private backAgain(seen: Set<string>, pages: string[], ok: (pageId: string) => boolean): Set<string> {
    const waiting = new Set(pages);
    for (const id of seen) if (!waiting.has(id)) seen.delete(id);
    const back = new Set<string>();
    for (const id of waiting) {
      if (!ok(id)) seen.add(id);
      else if (seen.delete(id)) back.add(id);
    }
    return back;
  }

  /**
   * La base acaba de rechazar por "no existe" el contenido de la página: si el árbol bajado la muestra en "no", queda
   * anotada. Solo anota (como `noteHidden` y `noteFilesLocked`): nunca reintenta.
   */
  private noteLocked(pageId: string): void {
    if (!this.editableOnServer(pageId)) this.sawLocked.add(pageId);
  }

  /** Lo mismo con los comentarios rechazados por "no existe", al terminar una vuelta de su cola. */
  private noteHidden(): void {
    for (const id of this.options.comments?.notFoundPages() ?? []) if (!this.tree.onServer(id)) this.sawHidden.add(id);
  }

  /**
   * Lo mismo con los archivos detenidos (y los usos que esperan) por "no existe", al terminar una vuelta de su cola,
   * que corre después del ciclo. Nunca tira: la base de archivos puede fallar o estar cerrándose.
   */
  private async noteFilesLocked(): Promise<void> {
    if (this.stopped) return;
    const pages = (await this.options.media?.notFoundPages().catch(() => [])) ?? [];
    for (const id of pages) this.noteLocked(id);
  }

  /**
   * El árbol y los permisos bajados muestran la página como editable para esta sesión. Sin datos de permisos (una base
   * sin la versión del equipo) alcanza con que el servidor la mande.
   */
  private editableOnServer(pageId: string): boolean {
    if (!this.tree.onServer(pageId)) return false;
    const access = this.options.access;
    const snapshot = access?.get() ?? null;
    return !access || !snapshot || new Permissions(this.tree, snapshot, access.userId).canEditPage(pageId);
  }

  /** Lo detenido de la cola de fotos y videos se vuelve a intentar; un error de su base no corta nada. */
  private async clearMediaBlocked(): Promise<void> {
    try {
      await this.options.media?.clearBlocked();
    } catch {
      // La base de archivos del dispositivo falló: el texto sigue igual.
    }
  }

  /**
   * Una vuelta por la cola de fotos y videos, si no hay una en curso (si la hay, otra apenas termine).
   * La sincronización la arranca sola al final de cada ciclo; no hace falta esperarla.
   */
  syncMedia(): Promise<void> {
    const media = this.options.media;
    if (this.removed || !media) return Promise.resolve();
    // Termine como termine la vuelta, lo que quedó detenido por "no existe" se anota (ver `retryReturned`).
    const note = () => this.noteFilesLocked().catch(() => undefined);
    return media.run((pageId) => this.tree.hasUnsentCreate(pageId)).then(note, async (err) => {
      await note();
      throw err;
    });
  }

  /**
   * La app pasó a segundo plano: con el interruptor prendido, un ciclo ya, que sube lo pendiente y arma las bases de
   * las páginas con lectores sin esperar la cadencia. Devuelve ese ciclo.
   */
  appHidden(): Promise<void> {
    if (!this.status.cleanOn || this.stopped) return Promise.resolve();
    this.urgentClean = true;
    return this.syncNow();
  }

  /**
   * El servidor tiene contenido de la página que este dispositivo todavía no bajó, o la página está "en preparación"
   * (tiene contenido y ningún editor armó todavía la base que le toca a este dispositivo): en los dos casos se abre en
   * solo lectura y sin semilla.
   */
  async isMissingContent(pageId: string): Promise<boolean> {
    return (await this.contentGap(pageId)) !== null;
  }

  /** Lo que le falta a la página en este dispositivo: `missing`, `preparing` o `null` (ver `contentGap` en clean.ts). */
  async contentGap(pageId: string): Promise<'missing' | 'preparing' | null> {
    const row = this.tree.get(pageId);
    if (!row || this.tree.hasUnsentCreate(pageId)) return null;
    const cursor = (await this.docs.states()).get(pageId)?.cursor ?? 0;
    return this.tree.contentGap(row, cursor);
  }

  /**
   * Si a este dispositivo la página le llega como base limpia: el interruptor está prendido (y la base lo tiene) y la
   * persona no ve lo borrado (menos que Editar, o invitada: el criterio del historial, D13). Sin datos de permisos,
   * como quien edita (el servidor decide igual: si manda bases, el cursor queda en la base y se vuelve a pedir).
   */
  isBaseReader(pageId: string): boolean {
    if (!this.status.cleanOn) return false;
    const access = this.options.access;
    const snapshot = access?.get() ?? null;
    if (!access || !snapshot) return false;
    const perms = new Permissions(this.tree, snapshot, access.userId);
    return !(perms.pageLevel(pageId) >= LEVEL_EDIT && perms.role !== 'guest');
  }

  /**
   * Antes de abrir una página cuyo contenido el dispositivo todavía no tiene, lo baja, esperando hasta
   * `timeoutMs`. Devuelve si quedó todo bajado.
   */
  async prefetchPage(pageId: string, timeoutMs = 4000): Promise<boolean> {
    if (!(await this.isMissingContent(pageId))) return true;
    const pull = (async () => {
      // Con la app vieja para el workspace no se baja contenido (ver `cycle`). Al abrir la app, una página se puede
      // abrir antes de que el primer ciclo sepa si esta versión es vieja: entonces se pregunta antes de bajar.
      // Si esa lectura falla (sin red, muy lenta), se baja como antes: la bajada fallará igual sin red, y una versión
      // que no es vieja no tiene por qué esperar al ciclo.
      if (!this.versionKnown) await this.learnOutdated().catch(() => undefined);
      if (this.status.outdated) return;
      await this.docs.pullPage(pageId, this.remote, { contentEpoch: this.tree.get(pageId)?.content_epoch });
    })().catch(() => undefined);
    await Promise.race([pull, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
    return !(await this.isMissingContent(pageId));
  }

  /** Si esta versión es más vieja que la mínima del workspace, según sus ajustes (`null`: una base sin ajustes). */
  private isOutdated(settings: WorkspaceSettings | null): boolean {
    if (!settings) return false;
    const version = Number(this.options.appVersion);
    return settings.minAppVersion !== null && !(Number.isFinite(version) && version >= settings.minAppVersion);
  }

  /** Lee los ajustes del workspace solo para saber si esta versión es vieja (antes del primer ciclo). */
  private async learnOutdated(): Promise<void> {
    const outdated = this.isOutdated(await this.remote.fetchWorkspaceSettings());
    if (this.stopped || this.versionKnown) return;
    this.versionKnown = true;
    if (outdated !== this.status.outdated) this.patch({ outdated });
    this.options.media?.setOutdated(outdated);
  }

  /** La base dijo que sacaron a la persona del workspace (lo guardado en el dispositivo). */
  get removed(): boolean {
    return this.options.access?.removed ?? false;
  }

  /** Hubo un cambio local: sincroniza en un rato, agrupando los cambios seguidos. */
  poke(): void {
    // Después de `stop()` la base puede estar cerrándose (se cierra la app o se cambia de workspace).
    if (this.stopped) return;
    // La cuenta es solo lo que se muestra: si la base se cierra en el medio (la app se cierra, otra ventana toma el
    // control), queda como estaba, sin un rechazo suelto (O9 de la auditoría de la 2b).
    void this.refreshCounts().catch(() => undefined);
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
    // Después de `stop()` (por ejemplo, porque otra ventana tomó el control) no se escribe nada más,
    // aunque el ciclo ya estuviera en curso.
    const halt = () => {
      if (this.stopped) throw new Error('stopped');
    };
    try {
      const { outdated, removed } = await this.checkWorkspace();
      halt();
      // La base contestó después de un ciclo sin conexión: la cola de archivos y la de las carpetas dejan de esperar (si estaba
      // esperando porque el portero o Storage no contestaban, puede que fuera la red) y prueba enseguida.
      if (!this.status.online) {
        this.options.media?.networkBack();
        this.options.folders?.networkBack();
        this.files.networkBack();
      }
      // Si la base dice que sacaron a la persona, no se sube ni se baja nada más: lo del dispositivo queda
      // como está hasta que ella elija qué hacer (pantalla "You no longer have access").
      if (removed) {
        this.patch({ online: true, lastError: null, lastSyncAt: Date.now() });
        return;
      }
      halt();
      // Con la app vieja para este workspace (`min_app_version`) no sale nada del dispositivo: ni el árbol, ni el
      // contenido, ni las imágenes, ni los comentarios. Todo queda en la cola y sale al actualizar, en el orden de
      // siempre (Docs/Doc_Sincronizacion.md, "Volver después de mucho tiempo sin red").
      if (!outdated) await this.pushOps();
      halt();
      // Primero los proyectos y después sus páginas: nunca llega una página de un proyecto desconocido.
      const projects = await this.remote.fetchProjects(this.status.schemaVersion);
      halt();
      const rows = await this.remote.fetchTree(projects.map((p) => p.id), this.status.schemaVersion);
      halt();
      await this.tree.setSnapshot(rows, projects);

      let contentError: string | null = null;
      let states = await this.docs.states();
      // Con el árbol y los permisos recién bajados: lo rechazado por "no existe" de una página que volvió sale en este
      // mismo ciclo. Un error acá no corta nada: queda "Retry".
      if (!outdated && (await this.retryReturned(states).catch(() => false))) states = await this.docs.states();
      halt();
      // Con la app vieja para este workspace, el contenido se queda en el dispositivo hasta actualizar.
      for (const pageId of outdated ? [] : await this.docs.unsyncedPages()) {
        halt();
        if (this.tree.hasUnsentCreate(pageId) || states.get(pageId)?.rejected) continue;
        try {
          if ((await this.docs.pushPage(pageId, this.remote)) === 'pushed') this.lastActivityAt = Date.now();
        } catch (err) {
          // Muy lenta para esta página (venció el tope): se sigue con las demás y se reintenta en la
          // próxima vuelta. No es un rechazo.
          if (isTimeout(err)) {
            contentError = REQUEST_TIMEOUT;
            continue;
          }
          // Un link sin el nombre del visitante: lo escrito espera en el dispositivo (la app pide el nombre).
          if (this.options.linkVisitor && errorMessage(err) === AUTHOR_MISSING) continue;
          if (!isPermanent(err)) throw err;
          if (errorMessage(err) === APP_OUTDATED) {
            // El workspace subió la versión mínima entre la consulta y la subida.
            this.patch({ outdated: true });
            this.options.media?.setOutdated(true);
            break;
          }
          // En el momento, y no al final del ciclo: si la red se cae más abajo, el "no" ya quedó anotado.
          if (errorMessage(err) === PAGE_NOT_FOUND) this.noteLocked(pageId);
          contentError = errorMessage(err) === PAGE_NOT_FOUND ? t('queue.pageNotFound') : errorMessage(err);
        }
      }

      halt();
      const cursors = await this.docs.states();
      // Tampoco se baja contenido: lo que escribió una versión más nueva puede tener algo que el editor de esta no
      // conoce y que borraría al editar ese bloque (una propiedad nueva), y ese borrado saldría al actualizar. Lo
      // propio sigue editable; lo nuevo de los demás llega con la versión nueva. El árbol sí se baja (títulos y
      // lugares: no los toca ningún editor). `status.outdated` y no `outdated`: la base puede haber rechazado una
      // subida en este mismo ciclo (subieron la mínima entre la consulta y la subida).
      // Hasta `serverSeq`: las filas, o la base limpia para quien no ve lo borrado (Docs/Doc_Privacidad_Borrado.md).
      // También las que tienen otra época de contenido después de aplicar un snapshot (Docs/Doc_Compactar.md, 12).
      const epochs = new Map(rows.map((r) => [r.id, r.content_epoch]));
      const stale = this.status.outdated
        ? []
        : rows
            // Y las rearmadas que no terminaron (la app se cerró a mitad de la bajada, R-1): `pullPage` las cierra.
            .filter(
              (r) =>
                this.tree.serverSeq(r) > (cursors.get(r.id)?.cursor ?? 0) ||
                epochBehind(cursors.get(r.id), r.content_epoch) ||
                cursors.get(r.id)?.rebuilt === true,
            )
            .filter((r) => this.options.pullOnly?.(r.id, cursors.get(r.id)?.cursor ?? 0) ?? true)
            .map((r) => r.id);
      await runPool(stale, PULL_CONCURRENCY, (id) =>
        this.docs.pullPage(id, this.remote, { contentEpoch: epochs.get(id) }).then((n) => {
          if (n > 0) this.lastActivityAt = Date.now();
        }, (err) => {
          // Lo mismo al bajar: esta página se reintenta en la próxima vuelta y las demás siguen.
          if (isTimeout(err)) {
            contentError = REQUEST_TIMEOUT;
            return;
          }
          if (!isPermanent(err)) throw err;
          // Una página que el árbol muestra y la base no deja bajar: se dice en palabras, no con el código.
          contentError = errorMessage(err) === PAGE_NOT_FOUND ? t('commentError.pageNotFound') : errorMessage(err);
        }),
      );

      halt();
      // Qué fotos y videos usa cada página (papelera de archivos): después de subir y bajar el contenido,
      // así se compara con documentos al día. Un error acá no corta la sincronización del texto.
      await this.reconcileMedia().catch(() => undefined);

      halt();
      // Las bases limpias de las páginas con lectores (sus errores no cortan el ciclo: las arma el próximo).
      if (!this.status.outdated) await this.buildCleanBases().catch(() => undefined);

      halt();
      // Compactar: como mucho una página por ciclo, con los snapshots prendidos (sus errores no cortan el ciclo).
      if (!this.status.outdated) await this.compactOne().catch(() => undefined);

      halt();
      // Las imágenes sin portero (`sdfile://`) tampoco salen con la app vieja para este workspace.
      const fileError = this.status.outdated ? null : await this.files.pushPending((pageId) => this.tree.hasUnsentCreate(pageId));

      halt();
      // Los comentarios de páginas que todavía no están en el servidor esperan. Sus errores no cortan el
      // ciclo: quedan en su propia cola (`commentError`, `failedComments`).
      // Con la app vieja, los comentarios esperan como los de una página que todavía no está en el servidor.
      try {
        await this.options.comments?.run(this.status.outdated ? () => true : (pageId) => this.tree.hasUnsentCreate(pageId));
      } finally {
        // Lo que se rechazó por "no existe" en esta vuelta, con el árbol de este ciclo en "no": queda anotado.
        this.noteHidden();
      }

      this.patch({ online: true, lastError: contentError ?? fileError, lastSyncAt: Date.now() });
      // Sin esperarla: tiene su propio ciclo y sus propios errores.
      void this.syncMedia();
      this.startAutoPurge();
    } catch (err) {
      if (this.stopped) return;
      this.patch({ online: !isNetworkError(err), lastError: errorMessage(err) });
    } finally {
      // Con la sincronización andando, un error al contar se ve. Después de `stop()` la base puede estar
      // cerrándose (quien la cierra no esperó a `stop()`): ahí el conteo ya no le importa a nadie.
      await this.refreshCounts().catch((err) => {
        if (!this.stopped) throw err;
      });
      this.patch({ syncing: false });
    }
  }

  /**
   * Lee los ajustes del workspace. Si la base se restauró desde una copia de seguridad (cambió la
   * generación), pone en la cola todo lo que el servidor ya no tiene antes de seguir. Devuelve si esta
   * versión de la app es más vieja que la mínima del workspace.
   */
  private async checkWorkspace(): Promise<{ outdated: boolean; removed: boolean }> {
    const settings = await this.remote.fetchWorkspaceSettings();
    this.options.comments?.configure(settings?.schemaVersion ?? null, settings?.generation ?? null);
    // Sin ajustes, la base es anterior a todo esto: 0.
    this.options.sizes?.configure(settings?.schemaVersion ?? 0);
    // La usan `fetchProjects` (las columnas que pide) y la interfaz (archivar y borrar, P.14).
    if ((settings?.schemaVersion ?? 0) !== this.status.schemaVersion) this.patch({ schemaVersion: settings?.schemaVersion ?? 0 });
    // El interruptor de la privacidad de lo borrado: solo con la base en la versión 12 o más.
    this.cleanMin = settings && settings.schemaVersion >= CLEAN_SCHEMA_VERSION ? (settings.cleanMinVersion ?? null) : null;
    // El de los snapshots de compactar: solo con la base en la versión 17 o más.
    this.snapshotMin =
      settings && settings.schemaVersion >= SNAPSHOT_SCHEMA_VERSION ? (settings.snapshotMinVersion ?? null) : null;
    if ((this.cleanMin !== null) !== this.status.cleanOn) this.patch({ cleanOn: this.cleanMin !== null });
    // El de Can edit por un link: solo con la base en la versión 19 o más.
    this.linkEditMin =
      settings && settings.schemaVersion >= LINK_EDIT_SCHEMA_VERSION ? (settings.linkEditMinVersion ?? null) : null;
    this.versionKnown = true;
    if (!settings) {
      this.patch({ outdated: false });
      this.options.media?.setOutdated(false);
      return { outdated: false, removed: await this.checkAccess(null) };
    }
    const outdated = this.isOutdated(settings);
    // La cola de archivos se frena sola con la misma cuenta: no registra, no sube y no manda usos (todo queda en
    // el dispositivo y sale al actualizar). Las versiones anteriores a esta no lo hacían: a esas las frena la base
    // (Docs/Doc_Sincronizacion.md, "La versión mínima y los archivos").
    this.options.media?.setOutdated(outdated);
    const needed = this.options.schemaVersion ?? 0;
    const schemaBehind: [number, number] | null = settings.schemaVersion < needed ? [settings.schemaVersion, needed] : null;
    if (schemaBehind?.join() !== this.status.schemaBehind?.join()) this.patch({ schemaBehind });
    this.patch({
      outdated,
      mediaUrl: settings.mediaUrl,
      ownerId: settings.ownerId ?? null,
      workspaceName: settings.name ?? null,
      workspaceLocalKey: settings.localKey ?? null,
      autoPurgeFiles: settings.autoPurgeFiles === true,
    });
    // Un error de la base de archivos del dispositivo no corta la subida del texto.
    await this.options.media?.configure(settings.mediaUrl, settings.schemaVersion).catch(() => undefined);
    // Antes de recuperar nada tras una restauración: a alguien que sacaron no se le arma ninguna cola.
    if (await this.checkAccess(settings)) return { outdated, removed: true };
    // La cola de fotos y videos lleva su propia generación (en su base): si falla, lo hace en la próxima
    // sincronización, sin frenar el texto.
    const mediaRecovered = (await this.options.media?.syncGeneration(settings.generation).catch(() => 0)) ?? 0;
    // Los comentarios también (en su base): lo propio que el servidor ya no tiene vuelve a la cola antes de
    // la primera bajada. Un error se reintenta en la próxima vuelta (la cola no baja nada hasta lograrlo).
    const commentsRecovered = (await this.options.comments?.syncGeneration(settings.generation).catch(() => 0)) ?? 0;

    // Sin generación guardada vale 1, la que crea la migración: un dispositivo que todavía tenía una versión
    // anterior cuando se restauró la base igual se recupera al actualizar (uno vacío no tiene nada que hacer).
    const known = (await this.tree.knownGeneration()) ?? 1;
    if (known === settings.generation) {
      if ((mediaRecovered > 0 || commentsRecovered > 0) && !this.status.notice) {
        const key =
          mediaRecovered > 0 && commentsRecovered > 0
            ? 'engine.restoredBoth'
            : mediaRecovered > 0
              ? 'engine.restoredMedia'
              : 'engine.restoredComments';
        this.patch({ notice: t(key) });
      }
      return { outdated, removed: false };
    }
    {
      const projects = await this.remote.fetchProjects(settings.schemaVersion);
      const rows = await this.remote.fetchTree(projects.map((p) => p.id), settings.schemaVersion);
      // Con permisos conocidos, lo que la persona ya no puede crear no vuelve a la cola (se avisa abajo).
      const access = this.options.access;
      const perms = access?.get() ? new Permissions(this.tree, access.get(), access.userId) : null;
      const report = { skipped: 0 };
      const allow = perms
        ? { createProject: perms.canCreateProject, createPage: (parentId: string | null, projectId: string) => perms.canCreateIn(parentId, projectId) }
        : undefined;
      const recovered =
        (await this.tree.recoverAfterRestore(rows, projects, allow, report)) +
        (await this.docs.resetForRestore()) +
        (await this.files.resetForRestore()) +
        mediaRecovered +
        commentsRecovered;
      // Un dispositivo que no tenía nada (recién entra a un workspace ya restaurado) no avisa nada.
      const notices: string[] = [];
      if (recovered > 0) {
        notices.push(t('engine.restoredAll'));
      }
      if (report.skipped > 0) {
        const skipped = t('engine.skipped', { count: report.skipped, download: t('sync.downloadUnsynced') });
        notices.push(recovered > 0 ? skipped : `${t('engine.restored')} ${skipped}`);
      }
      if (notices.length > 0) this.patch({ notice: notices.join(' ') });
    }
    // Recién ahora: si la app se cierra a mitad de camino, la próxima vez se vuelve a hacer todo.
    await this.tree.setKnownGeneration(settings.generation);
    return { outdated, removed: false };
  }

  /**
   * Lee los permisos propios (fila de `members` y de `grants`) y los guarda en el dispositivo. Devuelve si
   * la base dice que sacaron a la persona: SOLO con su fila de `members` con `removed_at`. Un error tira
   * (y no cambia nada de lo guardado); una base sin la versión del equipo deja los permisos sin datos, y
   * sin datos no se bloquea nada.
   */
  private async checkAccess(settings: WorkspaceSettings | null): Promise<boolean> {
    const access = this.options.access;
    if (!access) return false;
    if (!settings || !(settings.schemaVersion >= TEAM_SCHEMA_VERSION)) {
      await access.set(null);
      return false;
    }
    const snapshot = await this.remote.fetchMyAccess(access.userId);
    if (this.stopped) return false;
    await access.set(snapshot);
    return access.removed;
  }

  /**
   * Papelera de archivos (paso 11): cada página cuyo documento cambió desde la última vez (acá o en otro
   * dispositivo) se compara con sus fotos y videos, y la diferencia va a la cola de archivos (lo nuevo,
   * `link_page_file`; lo que ya no está, `unlink_page_file`; ver `MediaQueue.reconcilePage`).
   *
   * Dar un archivo por quitado pide mucho, porque es lo que lo manda a la papelera: el documento tiene que
   * tener todo lo que el servidor tenía al bajar el árbol en este ciclo, esta versión tiene que poder leerlo
   * entero y lo de este dispositivo tiene que estar subido (si no, el servidor todavía muestra el bloque).
   * Si falta algo, solo se suman usos, y la página se vuelve a mirar en el próximo ciclo.
   */
  private async reconcileMedia(): Promise<void> {
    const media = this.options.media;
    if (!media?.tracksUsage) return;
    // Un link con Can edit no registra usos de archivos: los vincula y desvincula el dispositivo de un editor al
    // reconciliar lo admitido (Docs/Doc_Link_Publico.md, E2.4). Si los anotara, quedarían como cambios sin subir (O7).
    if (this.options.linkVisitor) return;
    // Hay ediciones que no se pudieron guardar en el dispositivo: lo guardado no es lo que se ve.
    if (this.docs.getWriteError()) return;
    const access = this.options.access;
    const snapshot = access?.get() ?? null;
    const perms = access && snapshot ? new Permissions(this.tree, snapshot, access.userId) : null;
    const trash = media.trashEnabled ? 1 : 0;
    const mark = (state: DocState) => `${state.version}:${state.cursor}:${trash}`;
    const marks: Record<string, string> = {};
    const pages: string[] = [];
    for (const [pageId, state] of await this.docs.states()) {
      const row = this.tree.get(pageId);
      // Una página que el servidor todavía no tiene, o que la persona no puede editar (el servidor
      // rechazaría los dos pedidos), no se mira.
      if (!row || this.tree.hasUnsentCreate(pageId) || (perms && !perms.canEditPage(pageId))) continue;
      // A medio bajar: no se mira, ni siquiera para sumar (se hace cuando llegue lo que falta).
      if (row.update_seq > state.cursor) continue;
      if (media.usageMark(pageId) === mark(state)) continue;
      pages.push(pageId);
    }
    // Las páginas que este dispositivo nunca comparó (un dispositivo nuevo, una página que recién llegó):
    // sus fotos y videos llegaron con el documento y casi siempre el servidor ya los tiene registrados. Se
    // pregunta una vez cuáles (una lectura por cada 100 páginas) para no mandarlos de a uno ni contarlos como
    // cambios sin subir (B.14). Sin respuesta, se sigue como siempre: se mandan todos.
    const unseen = pages.filter((id) => media.usageMark(id) === undefined && !this.usesAsked.has(id));
    const onServer = unseen.length > 0 ? await media.serverUses(unseen).catch(() => null) : null;
    if (onServer) for (const id of unseen) this.usesAsked.add(id);
    for (const pageId of pages) {
      if (this.stopped) break;
      const snap = await this.docs.snapshot(pageId);
      try {
        // Completo ya se miró arriba (el cursor solo avanza); acá, que todo se haya podido leer.
        const current = !snap.state.unreadable && snap.supported;
        const uploaded = !hasUnsyncedContent(snap.state, snap.dirty) && !snap.state.rejected;
        const ids = mediaIdsInDoc(snap.doc);
        let unlink = current && uploaded;
        // La primera vez que esta página quitaría un archivo, se comprueba que todo su historial en el
        // servidor se pueda leer: una versión anterior de la app pudo descartar un update ilegible sin
        // anotarlo (`unreadable` es de esta versión). Sin red o con algo ilegible, no se quita nada.
        if (unlink && !media.isVerified(pageId) && (await media.wouldUnlink(pageId, ids))) {
          const wait = this.verifyWait.get(pageId);
          if (wait && Date.now() < wait.until) {
            unlink = false;
          } else {
            try {
              unlink = await this.verifyHistory(pageId, snap.state.cursor);
              this.verifyWait.delete(pageId);
            } catch {
              // Sin red o con un error: no se quita, y no se vuelve a bajar el historial en cada ciclo.
              const failures = (wait?.failures ?? 0) + 1;
              this.verifyWait.set(pageId, { failures, until: Date.now() + Math.min(60_000 * 2 ** (failures - 1), 3_600_000) });
              unlink = false;
            }
          }
        }
        // Lo que el servidor ya tiene solo se cree si la página no tiene nada propio por subir: con algo propio en
        // camino (una copia que entró sin pasar por el editor), la lectura puede ser vieja y se manda todo.
        await media.reconcilePage(pageId, ids, { unlink, seenSeq: snap.state.cursor, onServer: uploaded ? onServer?.get(pageId) : undefined });
        // Solo queda "mirada" si se pudo quitar lo que hiciera falta; si no (a medio subir, algo ilegible o
        // desconocido, sin comprobar), se vuelve a mirar en el próximo ciclo.
        if (unlink) marks[pageId] = mark(snap.state);
      } finally {
        snap.doc.destroy();
      }
    }
    await media.setUsageMarks(marks);
  }

  /**
   * Baja todo el historial de la página en el servidor (hasta `upTo`) y comprueba que esta versión lo pueda
   * leer entero. Si algo no se puede leer, lo anota en la página (`unreadable`: nunca quita) y devuelve
   * `false`; si se lee todo, lo anota en la cola de archivos para no volver a hacerlo. Solo lee: no guarda
   * nada del documento.
   *
   * Recorre hasta pasar `upTo` o hasta un lote vacío, **nunca hasta un lote corto**: dar la página por comprobada
   * habilita mandar archivos a la papelera, y un lote que la API recortó (menos filas que las pedidas, sin que el
   * historial haya terminado) dejaba sin mirar lo que seguía. Si el último update del servidor queda antes de
   * `upTo`, cuesta un pedido más, vacío.
   */
  private async verifyHistory(pageId: string, upTo: number): Promise<boolean> {
    const media = this.options.media!;
    let after = 0;
    while (after < upTo) {
      const updates = await this.remote.pullUpdates(pageId, after, 500);
      if (updates.length === 0) break;
      for (const u of updates) {
        if (u.seq > upTo) break;
        try {
          Y.decodeUpdate(u.data);
        } catch {
          await this.docs.markUnreadable(pageId);
          return false;
        }
      }
      const last = updates[updates.length - 1].seq;
      // Un lote que no avanza (no debería pasar): pedir de nuevo no terminaría. Como cualquier error, no se quita
      // nada y se espera antes de volver a probar (`verifyWait`).
      if (!(last > after)) throw new Error('page history does not advance');
      after = last;
    }
    await media.setVerified(pageId);
    return true;
  }

  /**
   * El borrado automático de la papelera de archivos (paso 11), una vez por apertura de la app y solo para
   * el dueño y los admins. Queda armado y apagado: con `auto_purge_files` en `false` (hoy siempre) no se
   * pregunta ni se manda nada (`MediaQueue.autoPurge`).
   */
  private startAutoPurge(): void {
    const media = this.options.media;
    const access = this.options.access;
    if (this.autoPurgeChecked || !media || !access?.get() || !media.trashEnabled) return;
    this.autoPurgeChecked = true;
    if (!this.status.autoPurgeFiles) return;
    const perms = new Permissions(this.tree, access.get(), access.userId);
    if (perms.role !== 'owner' && perms.role !== 'admin') return;
    const projects = this.tree.projects().map((p) => p.id).filter((id) => perms.projectLevel(id) >= 1);
    // Primero una vuelta por la cola de usos: lo que este dispositivo tiene por mandar sale antes, y los
    // archivos con usos que todavía no salieron se saltean (`MediaQueue.trash`).
    void this.syncMedia()
      .then(() => media.autoPurge(true, projects))
      .catch(() => undefined);
  }

  private async pushOps(): Promise<void> {
    for (const op of this.tree.pendingOps()) {
      if (this.stopped) return;
      try {
        // Mover una página puede dejarla adentro de una rama con lectores (la base la reinicia en ese momento): antes,
        // lo pendiente de la página y de su rama tiene que estar en el servidor (Docs/Doc_Privacidad_Borrado.md, 4.2).
        // Si no se puede subir (sin red), el cambio espera en la cola con los que vienen después, en orden.
        if (this.status.cleanOn && op.op.kind === 'update' && op.op.patch.parent_id !== undefined) {
          await this.uploadPagesFirst(this.branchOf(op.op.id), { throwOnNetwork: true });
        }
        await this.applyOp(op);
        await this.tree.ackOp(op);
      } catch (err) {
        if (errorMessage(err) === APP_OUTDATED) {
          // La base frena el árbol por versión (B.17) y subieron la mínima entre la consulta y el pedido: el cambio
          // queda en la cola (no pasa a rechazados) y sale al actualizar, con los que vienen después, en orden.
          this.patch({ outdated: true });
          this.options.media?.setOutdated(true);
          return;
        }
        if (!isPermanent(err)) throw err;
        await this.tree.failOp(op, errorMessage(err));
      }
    }
  }

  /** La página y todas las de adentro (en el árbol que ve el dispositivo). */
  branchOf(pageId: string): string[] {
    const out: string[] = [];
    const walk = (id: string) => {
      out.push(id);
      for (const child of this.tree.children(id)) walk(child.id);
    };
    walk(pageId);
    return out;
  }

  /**
   * Antes de compartir, invitar o mover (Docs/Doc_Privacidad_Borrado.md, 4.2, R1): sube lo pendiente de estas páginas y
   * devuelve si el servidor lo confirmó todo. Con el interruptor apagado no hace falta (devuelve `true`). Una página que
   * el servidor todavía no tiene no cuenta (no tiene nada que una base pueda llevar).
   */
  async uploadPagesFirst(pageIds: string[], { throwOnNetwork = false }: { throwOnNetwork?: boolean } = {}): Promise<boolean> {
    if (!this.status.cleanOn || this.stopped) return true;
    const wanted = new Set(pageIds);
    const pending = async () =>
      (await this.docs.unsyncedPages()).filter((id) => wanted.has(id) && !this.tree.hasUnsentCreate(id));
    for (const pageId of await pending()) {
      try {
        if ((await this.docs.pushPage(pageId, this.remote)) === 'pushed') this.lastActivityAt = Date.now();
      } catch (err) {
        // Un rechazo para siempre (por ejemplo, por tamaño) no se arregla esperando: se sigue con lo demás.
        if (throwOnNetwork && !isPermanent(err)) throw err;
      }
    }
    return (await pending()).length === 0;
  }

  /**
   * Arma enseguida las bases de estas páginas (después de compartir, invitar o mover), con progreso: primero una vuelta
   * de sincronización para tener las páginas al día. `clean_work` da como mucho 50 páginas por pedido: se vuelve a
   * pedir con las que faltan, sin las ya pedidas (armadas o no), hasta que no dé ninguna. Lo que no se pueda armar acá
   * lo arma el próximo editor que sincronice. Nunca tira.
   */
  async prepareBases(pageIds: string[], onProgress?: (done: number, total: number) => void): Promise<void> {
    if (!this.status.cleanOn || this.stopped) return;
    try {
      await this.syncNow();
      const left = new Set(pageIds);
      let done = 0;
      while (left.size > 0 && !this.stopped) {
        const asked = await this.buildCleanBases({
          pages: [...left],
          urgent: true,
          all: true,
          onProgress: onProgress && ((d, total) => onProgress(done + d, done + total)),
        });
        if (asked.length === 0) break;
        for (const id of asked) left.delete(id);
        done += asked.length;
      }
    } catch {
      // Lo arma el próximo editor.
    }
  }

  /**
   * Arma y sube las bases limpias que pide la base (`clean_work`): solo con el interruptor prendido, una versión que
   * alcanza y, salvo que sea urgente, si este dispositivo subió o bajó algo hace poco (o cada 2 minutos). Solo las
   * páginas que este dispositivo tiene al día; como mucho `CLEAN_PER_ROUND` por vuelta (`all`: todas las pedidas).
   * Devuelve las páginas que dio `clean_work` (armadas o no).
   */
  private async buildCleanBases(
    { pages, urgent = false, all = false, onProgress }: { pages?: string[]; urgent?: boolean; all?: boolean; onProgress?: (done: number, total: number) => void } = {},
  ): Promise<string[]> {
    if (this.cleanMin === null || this.stopped || this.removed) return [];
    const version = Number(this.options.appVersion);
    if (!(Number.isFinite(version) && version >= this.cleanMin)) return [];
    const now = Date.now();
    const wasUrgent = this.urgentClean;
    const due = urgent || wasUrgent || now - this.lastActivityAt < CLEAN_ACTIVE_MS || now - this.lastCleanAt >= CLEAN_IDLE_MS;
    if (!due) return [];
    this.urgentClean = false;
    this.lastCleanAt = now;
    // Antes de armar las bases, lo que escribió un link (E2.3): si entra algo, la base de esa página sale con la cadencia
    // de siempre (la fila admitida lleva la hora de la admisión). Sus errores no cortan las bases; sin red, sí.
    if (!pages) {
      try {
        if ((await this.admitLinks()) > 0) this.lastActivityAt = Date.now();
      } catch (err) {
        if (isNetworkError(err)) throw err;
        console.warn('La admisión de lo que escribió un link falló; se vuelve a intentar en el próximo ciclo.', err);
      }
    }
    let work;
    try {
      work = await this.remote.cleanWork({ pages, urgent: urgent || wasUrgent });
    } catch (err) {
      if (wasUrgent) this.urgentClean = true;
      throw err;
    }
    const states = await this.docs.states();
    const unsynced = new Set(await this.docs.unsyncedPages());
    // Solo las que el dispositivo tiene exactamente como el servidor (sin nada propio sin subir).
    const ready = work.filter((w) => states.get(w.page_id)?.cursor === w.update_seq && !unsynced.has(w.page_id));
    const list = all ? ready : ready.slice(0, CLEAN_PER_ROUND);
    let done = 0;
    onProgress?.(0, list.length);
    for (const w of list) {
      if (this.stopped) return [];
      try {
        const built = await this.docs.buildCleanBase(w.page_id, w.update_seq);
        if ('base' in built) {
          await this.remote.pushCleanBase({
            id: crypto.randomUUID(),
            pageId: w.page_id,
            toSeq: w.update_seq,
            lastUpdateId: w.last_update_id,
            state: built.base,
            sha256: await sha256Hex(built.base),
          });
        } else if (built.skip.startsWith('check')) {
          console.warn(`Page ${w.page_id}: the clean copy did not pass its check (${built.skip}); not uploaded.`);
        }
      } catch (err) {
        // Sin red se corta la vuelta; otro error es de esta página: se sigue con las demás.
        if (isNetworkError(err)) throw err;
      }
      onProgress?.(++done, list.length);
    }
    return work.map((w) => w.page_id);
  }

  /**
   * Admite lo que escribió un link público (Docs/Doc_Link_Publico.md, E2.3): con el interruptor de Can edit prendido, esta
   * versión en su mínima y en la de las bases, quien ve lo borrado. Devuelve cuántas filas entraron.
   */
  private async admitLinks(): Promise<number> {
    if (this.linkEditMin === null || this.cleanMin === null || this.stopped || this.removed || !canAdmit(this.remote)) return 0;
    const version = Number(this.options.appVersion);
    if (!(Number.isFinite(version) && version >= this.linkEditMin && version >= this.cleanMin)) return 0;
    const docs = this.docs;
    const tree = this.tree;
    this.admission ??= new LinkAdmission(
      this.remote,
      {
      serverSeq: (pageId) => {
        const row = tree.get(pageId);
        return row && !tree.isTrashed(pageId) ? row.update_seq : null;
      },
      ready: async (pageId) => {
        const row = tree.get(pageId);
        const state = await docs.stateOf(pageId);
        // Al día y sin nada propio por subir (lo mismo vuelve a mirar `savedRows`, con la marca de lo no guardado).
        return (
          !!row && !!state && state.cursor === row.update_seq && !state.rejected && !state.unreadable && !state.pending &&
          !hasUnsyncedContent(state, false)
        );
      },
      savedRows: (pageId, seq) => docs.savedRows(pageId, seq),
      lastLocalEdit: (pageId) => this.lastEdit.get(pageId),
      },
      this.options.now ?? Date.now,
    );
    const result = await this.admission.round();
    return result.admitted;
  }

  /**
   * Compacta como mucho una página (Docs/Doc_Compactar.md, sección 4.1): con los snapshots prendidos y esta versión de la
   * app en la mínima o más, entre las páginas que la persona puede editar sin ser invitada (las que ven lo borrado),
   * fuera de la papelera, que el dispositivo tiene enteras (`cursor == update_seq`) y sin nada rechazado, y que según el
   * árbol tienen al menos `SNAPSHOT_MIN_ROWS` filas después del snapshot vigente. La base decide con la reserva. El
   * snapshot sale de las filas del servidor: nunca toca lo guardado en el dispositivo. Devuelve cómo terminó, o `null`.
   */
  private async compactOne(): Promise<CompactOutcome | null> {
    if (this.snapshotMin === null || this.stopped || this.removed || this.compacting || !canCompact(this.remote)) return null;
    const version = Number(this.options.appVersion);
    if (!(Number.isFinite(version) && version >= this.snapshotMin)) return null;
    const remote = this.remote;
    const access = this.options.access;
    const known = access?.get() ?? null;
    const perms = access && known ? new Permissions(this.tree, known, access.userId) : null;
    const now = Date.now();
    const minRows = this.options.compact?.minRows ?? SNAPSHOT_MIN_ROWS;
    const candidates: { id: string; rows: number }[] = [];
    for (const [pageId, state] of await this.docs.states()) {
      const row = this.tree.get(pageId);
      if (!row || row.deleted_at || this.tree.isTrashed(pageId) || this.tree.hasUnsentCreate(pageId)) continue;
      if (state.rejected || state.cursor !== row.update_seq) continue;
      const rows = row.update_seq - (row.snapshot_seq ?? 0);
      if (rows < minRows) continue;
      // Ve lo borrado: Editar o más y no invitada (como la base, `sees_deleted`). Sin datos de permisos, decide la base.
      if (perms && !(perms.pageLevel(pageId) >= LEVEL_EDIT && perms.role !== 'guest')) continue;
      const asked = this.compactAsked.get(pageId);
      if (asked && row.update_seq - asked.seq < COMPACT_RETRY_ROWS && now - asked.at < COMPACT_RETRY_MS) continue;
      candidates.push({ id: pageId, rows });
    }
    // Primero la que más filas junta.
    candidates.sort((a, b) => b.rows - a.rows);
    this.compacting = true;
    try {
      for (const { id } of candidates.slice(0, COMPACT_CLAIMS_PER_ROUND)) {
        if (this.stopped) return null;
        const seq = this.tree.get(id)?.update_seq ?? 0;
        const claim = await remote.claimCompaction(id);
        if (!claim) {
          this.compactAsked.set(id, { seq, at: Date.now() });
          continue;
        }
        let outcome: CompactOutcome;
        try {
          outcome = await compactPage(remote, id, claim, this.options.compact);
        } catch (err) {
          // Sin red (o un error de la base): se vuelve a intentar en el próximo ciclo. La reserva es de esta persona,
          // así que la vuelve a tomar; el mismo tramo sobre la misma base da la misma huella y la base devuelve el que ya
          // estaba (reintentar no duplica).
          if (!isNetworkError(err) && !isTimeout(err)) this.compactAsked.set(id, { seq, at: Date.now() });
          throw err;
        }
        // Después de confirmar, de una carrera (`stale`: cambió la base) o de invalidar una cadena mala, se puede volver a
        // pedir enseguida (la base decide); lo demás espera (salteada, otra versión ya la armó, huellas distintas).
        if (outcome.kind === 'confirmed' || outcome.kind === 'stale' || outcome.kind === 'invalidated') this.compactAsked.delete(id);
        else this.compactAsked.set(id, { seq, at: Date.now() });
        this.options.onCompacted?.(id, outcome);
        return outcome;
      }
      return null;
    } finally {
      this.compacting = false;
    }
  }

  private applyOp({ op }: QueuedOp): Promise<void> {
    switch (op.kind) {
      case 'create':
        return this.remote.createPage(op.page);
      case 'update':
        return this.remote.updatePage(op.id, op.patch, op.settingsKeys);
      case 'createProject':
        return this.remote.createProject(op.project);
      case 'renameProject':
        return this.remote.renameProject(op.id, op.name);
    }
  }

  private async refreshCounts(): Promise<void> {
    if (this.stopped) return;
    const comments = this.options.comments?.status();
    let counted;
    try {
      counted = await Promise.all([
        this.docs.states(),
        this.docs.unsyncedPages(),
        this.files.pendingCount(),
        // La base de archivos puede estar cerrándose (se cierra la app): el conteo se deja como estaba.
        this.options.media?.status().catch(() => undefined),
      ]);
    } catch (err) {
      // Un conteo que quedó en vuelo (esperando las escrituras locales) cuando se hizo `stop()` y se cerró la base
      // choca con la base cerrada: ya no le importa a nadie. Detenido o no, un error de verdad se sigue viendo.
      if (this.stopped) return;
      throw err;
    }
    if (this.stopped) return;
    const [states, unsynced, pendingFiles, media] = counted;
    let rejectedPages = 0;
    // Rechazada y con algo sin subir (la lista ya cuenta la marca de ediciones sin subir).
    const unsyncedSet = new Set(unsynced);
    for (const s of states.values()) if (s.rejected && unsyncedSet.has(s.pageId)) rejectedPages++;
    this.patch({
      pendingOps: this.tree.pendingOps().length,
      failedOps: this.tree.failedOps().length,
      pendingPages: unsynced.length,
      rejectedPages,
      pendingFiles,
      pendingMedia: media?.pending ?? 0,
      failedMedia: media?.failed ?? 0,
      mediaError: media?.error ?? null,
      uploading: media?.uploading ?? null,
      pendingComments: comments?.pending ?? 0,
      failedComments: comments?.failed ?? 0,
      commentError: comments?.error ?? null,
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
