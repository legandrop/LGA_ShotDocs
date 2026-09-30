import { t } from '../i18n';
import type { MediaQueue, MediaStatus } from '../media/queue';
import { mediaIdsInDoc } from '../media/usage';
import * as Y from 'yjs';
import { Permissions, TEAM_SCHEMA_VERSION, type AccessStore } from './access';
import type { CommentQueue } from './comments';
import type { PageDocs } from './docs';
import type { PageFiles } from './files';
import { hasUnsyncedContent, type DocState } from './localDb';
import { APP_OUTDATED, type Remote } from './remote';
import type { PageTree } from './tree';
import { errorMessage, isNetworkError, isPermanent, type QueuedOp, type WorkspaceSettings } from './types';

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
  lastError: string | null;
  lastSyncAt: number | null;
}

const INTERVAL_MS = 10_000;
const DEBOUNCE_MS = 1_200;
const PULL_CONCURRENCY = 4;

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

  constructor(
    private readonly remote: Remote,
    private readonly tree: PageTree,
    private readonly docs: PageDocs,
    private readonly files: PageFiles,
    private readonly options: {
      appVersion?: string;
      schemaVersion?: number;
      media?: MediaQueue;
      /** Los permisos de la persona: se actualizan en cada sincronización (ver `checkAccess`). */
      access?: AccessStore;
      /** La cola de comentarios (paso 10): sube y baja al final de cada ciclo. */
      comments?: CommentQueue;
    } = {},
  ) {
    const poke = () => this.poke();
    tree.onQueued = poke;
    files.onQueued = poke;
    if (options.media) {
      options.media.onQueued = poke;
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
      options.comments.onChange = () => {
        if (!this.stopped) void this.refreshCounts().catch(() => undefined);
      };
      if (options.comments.unavailable && !this.status.warning) {
        this.status = { ...this.status, warning: t('comments.readOnlyDevice', { reason: options.comments.unavailable }) };
      }
    }
    docs.onLocalChange = poke;
    docs.onWriteError = (message) => {
      this.patch({ localError: message });
      void this.refreshCounts();
    };
    docs.onWarning = (message) => this.patch({ warning: message });
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
    // Un error de la base de archivos nunca saltea la sincronización del texto.
    void Promise.all([
      this.docs.clearRejected(),
      this.clearMediaBlocked(),
      this.options.comments?.retryFailed().catch(() => undefined),
    ]).then(
      () => this.syncNow(),
      () => this.syncNow(),
    );
  }

  stop(): void {
    this.stopped = true;
    this.options.media?.stop();
    this.options.comments?.stop();
    if (this.interval) clearInterval(this.interval);
    if (this.timer) clearTimeout(this.timer);
    for (const fn of this.cleanups) fn();
  }

  /** Vuelve a intentar todo lo que el servidor rechazó: cambios del árbol y contenido. */
  async retryRejected(): Promise<void> {
    await this.tree.retryFailed();
    await this.docs.clearRejected();
    await this.clearMediaBlocked();
    await this.options.comments?.retryFailed().catch(() => undefined);
    await this.syncNow();
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
    if (this.removed) return Promise.resolve();
    return this.options.media?.run((pageId) => this.tree.hasUnsentCreate(pageId)) ?? Promise.resolve();
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

  /** La base dijo que sacaron a la persona del workspace (lo guardado en el dispositivo). */
  get removed(): boolean {
    return this.options.access?.removed ?? false;
  }

  /** Hubo un cambio local: sincroniza en un rato, agrupando los cambios seguidos. */
  poke(): void {
    // Después de `stop()` la base puede estar cerrándose (se cierra la app o se cambia de workspace).
    if (this.stopped) return;
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
    // Después de `stop()` (por ejemplo, porque otra ventana tomó el control) no se escribe nada más,
    // aunque el ciclo ya estuviera en curso.
    const halt = () => {
      if (this.stopped) throw new Error('stopped');
    };
    try {
      const { outdated, removed } = await this.checkWorkspace();
      halt();
      // Si la base dice que sacaron a la persona, no se sube ni se baja nada más: lo del dispositivo queda
      // como está hasta que ella elija qué hacer (pantalla "You no longer have access").
      if (removed) {
        this.patch({ online: true, lastError: null, lastSyncAt: Date.now() });
        return;
      }
      halt();
      await this.pushOps();
      halt();
      // Primero los proyectos y después sus páginas: nunca llega una página de un proyecto desconocido.
      const projects = await this.remote.fetchProjects();
      halt();
      const rows = await this.remote.fetchTree(projects.map((p) => p.id));
      halt();
      await this.tree.setSnapshot(rows, projects);

      let contentError: string | null = null;
      const states = await this.docs.states();
      // Con la app vieja para este workspace, el contenido se queda en el dispositivo hasta actualizar.
      for (const pageId of outdated ? [] : await this.docs.unsyncedPages()) {
        halt();
        if (this.tree.hasUnsentCreate(pageId) || states.get(pageId)?.rejected) continue;
        try {
          await this.docs.pushPage(pageId, this.remote);
        } catch (err) {
          if (!isPermanent(err)) throw err;
          if (errorMessage(err) === APP_OUTDATED) {
            // El workspace subió la versión mínima entre la consulta y la subida.
            this.patch({ outdated: true });
            break;
          }
          contentError = errorMessage(err);
        }
      }

      halt();
      const cursors = await this.docs.states();
      const stale = rows.filter((r) => r.update_seq > (cursors.get(r.id)?.cursor ?? 0)).map((r) => r.id);
      await runPool(stale, PULL_CONCURRENCY, (id) =>
        this.docs.pullPage(id, this.remote).catch((err) => {
          if (!isPermanent(err)) throw err;
          contentError = errorMessage(err);
        }),
      );

      halt();
      // Qué fotos y videos usa cada página (papelera de archivos): después de subir y bajar el contenido,
      // así se compara con documentos al día. Un error acá no corta la sincronización del texto.
      await this.reconcileMedia().catch(() => undefined);

      halt();
      const fileError = await this.files.pushPending((pageId) => this.tree.hasUnsentCreate(pageId));

      halt();
      // Los comentarios de páginas que todavía no están en el servidor esperan. Sus errores no cortan el
      // ciclo: quedan en su propia cola (`commentError`, `failedComments`).
      await this.options.comments?.run((pageId) => this.tree.hasUnsentCreate(pageId));

      this.patch({ online: true, lastError: contentError ?? fileError, lastSyncAt: Date.now() });
      // Sin esperarla: tiene su propio ciclo y sus propios errores.
      void this.syncMedia();
      this.startAutoPurge();
    } catch (err) {
      if (this.stopped) return;
      this.patch({ online: !isNetworkError(err), lastError: errorMessage(err) });
    } finally {
      await this.refreshCounts();
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
    if (!settings) {
      this.patch({ outdated: false });
      return { outdated: false, removed: await this.checkAccess(null) };
    }
    const version = Number(this.options.appVersion);
    const outdated =
      settings.minAppVersion !== null && !(Number.isFinite(version) && version >= settings.minAppVersion);
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
      const projects = await this.remote.fetchProjects();
      const rows = await this.remote.fetchTree(projects.map((p) => p.id));
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
    // Hay ediciones que no se pudieron guardar en el dispositivo: lo guardado no es lo que se ve.
    if (this.docs.getWriteError()) return;
    const access = this.options.access;
    const snapshot = access?.get() ?? null;
    const perms = access && snapshot ? new Permissions(this.tree, snapshot, access.userId) : null;
    const trash = media.trashEnabled ? 1 : 0;
    const mark = (state: DocState) => `${state.version}:${state.cursor}:${trash}`;
    const marks: Record<string, string> = {};
    for (const [pageId, state] of await this.docs.states()) {
      if (this.stopped) break;
      const row = this.tree.get(pageId);
      // Una página que el servidor todavía no tiene, o que la persona no puede editar (el servidor
      // rechazaría los dos pedidos), no se mira.
      if (!row || this.tree.hasUnsentCreate(pageId) || (perms && !perms.canEditPage(pageId))) continue;
      // A medio bajar: no se mira, ni siquiera para sumar (se hace cuando llegue lo que falta).
      if (row.update_seq > state.cursor) continue;
      if (media.usageMark(pageId) === mark(state)) continue;
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
        await media.reconcilePage(pageId, ids, { unlink, seenSeq: snap.state.cursor });
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
      after = updates[updates.length - 1].seq;
      if (updates.length < 500) break;
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
        await this.applyOp(op);
        await this.tree.ackOp(op);
      } catch (err) {
        if (!isPermanent(err)) throw err;
        await this.tree.failOp(op, errorMessage(err));
      }
    }
  }

  private applyOp({ op }: QueuedOp): Promise<void> {
    switch (op.kind) {
      case 'create':
        return this.remote.createPage(op.page);
      case 'update':
        return this.remote.updatePage(op.id, op.patch);
      case 'createProject':
        return this.remote.createProject(op.project);
      case 'renameProject':
        return this.remote.renameProject(op.id, op.name);
    }
  }

  private async refreshCounts(): Promise<void> {
    const comments = this.options.comments?.status();
    const [states, unsynced, pendingFiles, media] = await Promise.all([
      this.docs.states(),
      this.docs.unsyncedPages(),
      this.files.pendingCount(),
      // La base de archivos puede estar cerrándose (se cierra la app): el conteo se deja como estaba.
      this.options.media?.status().catch(() => undefined),
    ]);
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
