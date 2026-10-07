import type { SupabaseClient } from '@supabase/supabase-js';
import { stored } from '../i18n';
import type { LinkMemory } from '../linkMode';
import { fromBase64, toBase64 } from '../lib/base64';
import type { AccessSnapshot } from './access';
import type { CommentAuthor, CommentRemote, CommentRow, ListedComment, NewComment } from './comments';
import { SupabaseRemote, rpcByKey, timed, toRemoteError, MAX_REQUEST_TIMEOUT_MS, MAX_ROWS_PER_REQUEST, REQUEST_TIMEOUT_MS, type CleanWorkRow, type CleanPushResult, type LinkResult } from './remote';
import { LINK_FILES_SCHEMA_VERSION, type AdmitPageRow, type AdmitResult, type AdmitWorkRow, type LinkAsideRow, type LinkUpdateRow } from './linkAdmitApi';
import { afterPair, COUNTED, KeyedList, placeOf } from './listPages';
import {
  AUTHOR_MISSING,
  RemoteError,
  type MediaFileRow,
  type NewMediaFile,
  type PageRow,
  type PageUseRow,
  type ProjectRow,
  type RemoteUpdate,
  type WorkspaceSettings,
} from './types';

// El servidor visto desde un link público (Docs/Doc_Link_Publico.md, 3.5 a 3.7): las mismas operaciones que usa el motor,
// sobre las funciones `plink_*` de la base, con el cliente sin sesión del modo link (`createLinkClient`). El visitante es,
// para la app, un invitado con Comentar sobre la página del link (`fetchMyAccess`): ve la rama, recibe solo bases limpias
// (D14) y comenta; todo lo demás (escribir, compartir, la papelera, el historial) no existe para él y, si algo lo pidiera
// igual, la base lo rechaza.
//
// Con *Can edit* (entrega 2a, Docs/Doc_Link_Publico.md, E2.2): es un invitado con Editar sobre la página del link y
// escribe con `plink_push_page_update`, que deja lo escrito en la sala de espera (devuelve 0: todavía no está en la
// página). Lo ve entrar cuando un editor lo admite y arma la base siguiente. Desde la entrega 2b (con la base en la 21)
// sube fotos, videos y archivos al Drive del dueño: los registra con `plink_register_file` (con los topes de E2.5), sube
// la miniatura y el original va por el portero con el header del link; carpetas, no (LE7). Crear, mover, renombrar,
// compartir, compactar, el historial y las versiones con nombre siguen cerrados.

/** Lo que devuelve `plink_open`. */
export interface LinkOpenInfo {
  link_id: string;
  page_id: string;
  title: string;
  /** El nivel que esta versión de la app puede usar (una más vieja que el interruptor de Can edit ve Can view). */
  level: 'comment' | 'edit';
  /** El nivel del link (con el interruptor apagado, un link Can edit se usa como Can view). */
  link_level: 'comment' | 'edit';
  expires_at: string | null;
  min_app_version: number | null;
  schema_version: number;
  clean_on: boolean;
  media_url: string | null;
  outdated: boolean;
}

/** El link dejó de andar (revocado, vencido, *Reset link*, la raíz en la papelera) o llegó a un tope del día. */
export type LinkProblem = 'link_not_found' | 'link_rate_limited';

export function linkProblemOf(err: unknown): LinkProblem | null {
  const message = err instanceof Error ? err.message : String(err);
  if (/\blink_not_found\b/.test(message)) return 'link_not_found';
  if (/\blink_rate_limited\b/.test(message)) return 'link_rate_limited';
  return null;
}

/** Lo que un link no hace nunca (Can view): escribir el árbol o el contenido, archivos, compartir. */
export const LINK_READ_ONLY = 'link_read_only';

function readOnly(): never {
  throw new RemoteError(LINK_READ_ONLY, true, '42501');
}

/** Una base anterior a la entrega 2b (versión 21) no sabe de archivos por un link: un aviso que se entiende. */
function noUploads(): never {
  throw new RemoteError(stored('link.edit.noUploads'), true, '42501');
}

/** Lo más que pesa un archivo que sube un link (`file_max_bytes`, E2.5): la app no guarda uno más grande. */
export const LINK_FILE_MAX_BYTES = 500 * 1024 * 1024;

/** Carpetas por un link, no (LE7): cientos de archivos y subcarpetas en el Drive del dueño. */
export const LINK_FOLDER_MIME = 'inode/directory';

/** El tope de una subida por un link (`push_max_bytes`, 1 MB): una más grande no se manda (R1 de la re-verificación). */
export const LINK_PUSH_MAX_BYTES = 1024 * 1024;

/** Cómo va lo que escribió este dispositivo con el link (`plink_push_status`), por página. */
export interface LinkEdits {
  /** Hay algo escrito que no sube porque falta el nombre del visitante. */
  needName: boolean;
  /** Páginas con algo mandado que espera a que un editor lo admita. */
  waiting: string[];
  /** Páginas con algo apartado (no pudo entrar): se baja con *Download them*. */
  aside: string[];
}

const NO_EDITS: LinkEdits = { needName: false, waiting: [], aside: [] };

/** Sin memoria guardada (las pruebas que no la necesitan): solo en esta carga. */
function memoryInThisLoad(): LinkMemory {
  let sent: string[] = [];
  let seen: Record<string, number> = {};
  return {
    sent: () => sent,
    addSent: (p) => void (sent = [...sent.filter((x) => x !== p), p]),
    dropSent: (ps) => void (sent = sent.filter((x) => !ps.includes(x))),
    seen: () => seen,
    setSeen: (p, n) => void (seen = { ...seen, [p]: n }),
  };
}

/** Cada cuánto se pregunta el estado de lo mandado mientras algo espera (cuenta como un pase, P11). */
const STATUS_EVERY_MS = 30_000;

/** `plink_open` se vuelve a pedir cada tanto (cuenta como una apertura, P11): no en cada ciclo. */
const OPEN_EVERY_MS = 2 * 60 * 60_000;

/** Cuántas veces se empieza de nuevo la bajada del árbol si cambia entre dos de sus pedidos. */
export const TREE_TRIES = 3;
/**
 * Mientras el árbol no deja de cambiar, un solo intento por vez y cada vez más espaciado (el doble cada vez, hasta
 * `TREE_WAIT_MAX_MS`): cada pedido cuenta el árbol entero en el tope del día del link, para todos sus visitantes.
 */
export const TREE_WAIT_MS = 20_000;
export const TREE_WAIT_MAX_MS = 10 * 60_000;

/** `wholeTree` no pudo juntar un árbol de un solo estado. */
const MOVING = 'moving';

// Las listas del visitante (Docs/Doc_Sincronizacion.md, "Las listas largas"): el árbol, los comentarios, los archivos y
// el estado de lo mandado se piden **por clave**, con el orden escrito y hasta el total que dice la API, como las de una
// cuenta. La API entrega como mucho su tope de filas por pedido y no avisa cuando recorta: una lista cortada del árbol
// se tomaba por "estas páginas ya no están" (y sin la raíz, el link se veía roto). Ninguna llega parcial: o entera, o el
// pedido falla y el dispositivo se queda con lo que tenía. En el caso de siempre es un pedido por lista, como antes.
// Cada pedido de más vuelve a correr la función y cuenta en los topes del día del link (`pull`, `pass`).

export class LinkRemote extends SupabaseRemote {
  private info: LinkOpenInfo | null = null;
  private openedAt = 0;
  private opening: Promise<LinkOpenInfo> | null = null;
  /** La firma del último árbol y sus filas: si no cambió, `plink_tree` no devuelve nada (ni cuenta). */
  private treeSig: string | null = null;
  private treeRows: PageRow[] = [];
  /** Cuántas bajadas seguidas del árbol no terminaron porque cambiaba, y desde cuándo se vuelve a probar. */
  private treeFailures = 0;
  private treeRetryAt = 0;
  /** La última bajada que terminó con menos filas que las anunciadas: su firma y cuántas trajo. */
  private treeShort: { sig: string; rows: number } | null = null;

  private readonly linkVersion: string;
  /** Lo que escribió este dispositivo: falta el nombre, espera, se apartó (la insignia y los avisos lo muestran). */
  private edits: LinkEdits = NO_EDITS;
  private readonly editListeners = new Set<() => void>();
  /** Hay que volver a preguntar el estado (se mandó algo, o algo seguía esperando). */
  private statusDue = true;
  private statusAt = 0;
  /** `plink_push_status` llegó a su tope del día (los pases): no se pregunta más hasta esta hora. */
  private statusOffUntil = 0;
  /** Lo último que dijo `plink_push_status`, por página: cuántas esperan y cuántas se apartaron. */
  private counts = new Map<string, { waiting: number; aside: number }>();

  /** No admite: lo hace el dispositivo de un editor (E2.3). */
  readonly admitsLinks = false;

  constructor(
    private readonly linkClient: SupabaseClient,
    appVersion: string,
    /** Avisa cuando el link deja de andar o llega a un tope (la pantalla lo dice), y cuando vuelve a andar (`null`). */
    private readonly onProblem: (problem: LinkProblem | null) => void = () => undefined,
    /** El nombre que escribió el visitante (P8), en el momento de subir: sin nombre no se sube lo escrito. */
    private readonly author: () => string = () => '',
    /** Lo mandado y lo apartado ya visto, guardado con el link (entrega 2c). */
    private readonly memory: LinkMemory = memoryInThisLoad(),
  ) {
    super(linkClient, appVersion);
    this.linkVersion = appVersion;
  }

  /** Lo que escribió este dispositivo con el link. */
  linkEdits = (): LinkEdits => this.edits;

  subscribeLinkEdits = (fn: () => void): (() => void) => {
    this.editListeners.add(fn);
    return () => this.editListeners.delete(fn);
  };

  private setEdits(patch: Partial<LinkEdits>): void {
    const next = { ...this.edits, ...patch };
    if (JSON.stringify(next) === JSON.stringify(this.edits)) return;
    this.edits = next;
    for (const fn of this.editListeners) fn();
  }

  /** El visitante escribió su nombre: lo que esperaba sube en el próximo ciclo. */
  nameChanged(): void {
    if (this.author().trim()) this.setEdits({ needName: false });
  }

  /** Lo último que dijo `plink_open` (o `null` si todavía no abrió). */
  get opened(): LinkOpenInfo | null {
    return this.info;
  }

  private async call<T>(fn: string, args: Record<string, unknown>, ms = REQUEST_TIMEOUT_MS): Promise<T> {
    const { data, error, status } = await timed(this.linkClient.rpc(fn, args), ms);
    if (error) {
      const problem = linkProblemOf(error.message);
      if (problem) this.onProblem(problem);
      throw toRemoteError(error, status);
    }
    return data as T;
  }

  /** Una función que devuelve una fila por `key`, entera (`rpcByKey`), con los problemas del link avisados como en `call`. */
  private async listed<T>(fn: string, args: Record<string, unknown>, key: string): Promise<T[]> {
    try {
      return await rpcByKey<T>(this.linkClient, fn, args, key);
    } catch (err) {
      const problem = linkProblemOf(err);
      if (problem) this.onProblem(problem);
      throw err;
    }
  }

  /** Abre el link (`plink_open`), como mucho cada `OPEN_EVERY_MS`. */
  async open(force = false): Promise<LinkOpenInfo> {
    if (this.info && !force && Date.now() - this.openedAt < OPEN_EVERY_MS) return this.info;
    this.opening ??= (async () => {
      try {
        const raw = await this.call<Record<string, unknown>>('plink_open', { p_app_version: this.version() });
        const info: LinkOpenInfo = {
          link_id: String(raw.link_id),
          page_id: String(raw.page_id),
          title: typeof raw.title === 'string' ? raw.title : '',
          level: raw.level === 'edit' ? 'edit' : 'comment',
          // Una base anterior a la versión 19 no lo dice: el link es Can view.
          link_level: raw.link_level === 'edit' ? 'edit' : 'comment',
          expires_at: typeof raw.expires_at === 'string' ? raw.expires_at : null,
          min_app_version: raw.min_app_version == null ? null : Number(raw.min_app_version),
          schema_version: Number(raw.schema_version) || 0,
          clean_on: raw.clean_on === true,
          media_url: typeof raw.media_url === 'string' && raw.media_url ? raw.media_url : null,
          outdated: raw.outdated === true,
        };
        this.info = info;
        this.openedAt = Date.now();
        this.onProblem(null);
        return info;
      } finally {
        this.opening = null;
      }
    })();
    return this.opening;
  }

  private version(): string | null {
    return this.linkVersion || null;
  }

  // --- lo que usa el motor ---------------------------------------------------------------------------------------

  override async fetchWorkspaceSettings(): Promise<WorkspaceSettings | null> {
    const info = await this.open();
    return {
      // Un link no recupera nada tras restaurar una copia: no sube nada.
      generation: 1,
      minAppVersion: info.min_app_version,
      schemaVersion: info.schema_version,
      mediaUrl: info.media_url,
      ownerId: null,
      name: null,
      localKey: null,
      autoPurgeFiles: false,
      // Prendido para el motor: el visitante recibe solo bases (la base nunca le manda filas).
      cleanMinVersion: info.clean_on ? 0 : null,
    };
  }

  override async ensureWorkspace(): Promise<string | null> {
    return (await this.open()).link_id;
  }

  override async fetchProjects(): Promise<ProjectRow[]> {
    const info = await this.open();
    // El "proyecto" del visitante es el link: nunca el nombre ni el id del proyecto de verdad (P10).
    return [{ id: info.link_id, name: info.title, created_at: '1970-01-01T00:00:00Z', owner_id: null }];
  }

  override async fetchTree(projectIds: string[]): Promise<PageRow[]> {
    const info = await this.open();
    if (!projectIds.includes(info.link_id)) return [];
    // Una vez por ciclo, cómo va lo que se mandó (mientras algo espera): sus errores no cortan nada.
    if (info.level === 'edit') await this.refreshEdits().catch(() => undefined);
    // Después de una bajada que no terminó porque el árbol cambiaba: un intento por vez, y recién cuando toca.
    const waiting = this.treeFailures > 0 && Date.now() < this.treeRetryAt;
    const fresh = waiting ? MOVING : await this.wholeTree(this.treeFailures > 0 ? 1 : TREE_TRIES);
    if (fresh === MOVING) {
      if (!waiting) {
        this.treeFailures++;
        this.treeRetryAt = Date.now() + Math.min(TREE_WAIT_MS * 2 ** (this.treeFailures - 1), TREE_WAIT_MAX_MS);
      }
      // Con un árbol de esta carga de la app, el ciclo sigue con él: lo que el visitante escribió sube igual. Sin
      // ninguno no hay qué devolver (un árbol vacío se tomaría por "no queda ninguna página"): el error, que se reintenta.
      if (this.treeSig === null) throw new RemoteError(stored('link.treeMoving'), false);
      return this.treeRows.map((r) => ({ ...r }));
    }
    this.treeFailures = 0;
    if (fresh) {
      this.treeSig = fresh.sig;
      this.treeRows = fresh.rows.map((r) => ({
        id: String(r.id),
        workspace_id: String(r.workspace_id),
        parent_id: r.parent_id ? String(r.parent_id) : null,
        title: typeof r.title === 'string' ? r.title : '',
        icon: typeof r.icon === 'string' ? r.icon : null,
        sort_key: typeof r.sort_key === 'string' ? r.sort_key : '',
        settings: (r.settings && typeof r.settings === 'object' ? r.settings : {}) as PageRow['settings'],
        update_seq: Number(r.update_seq) || 0,
        clean_seq: Number(r.clean_seq) || 0,
        deleted_at: null,
        created_at: String(r.created_at),
        updated_at: String(r.updated_at),
      }));
    }
    return this.treeRows.map((r) => ({ ...r }));
  }

  /**
   * El árbol del link **entero**, o `null` si no cambió desde la última bajada. Por `id`, con el orden escrito y hasta
   * el total que dice la API. El primer pedido lleva la firma guardada (sin cambios, la base no devuelve nada ni
   * cuenta); los que siguen, ninguna, y piden lo que sigue a la última página recibida.
   *
   * Cada fila trae la firma del árbol del que salió (`sig`): todas las de una bajada tienen que traer **la misma**, y
   * tienen que ser tantas como dijo el primer pedido. Si el árbol cambia entre dos pedidos (otra firma, o menos
   * páginas que las anunciadas), lo juntado es de dos árboles distintos: se descarta y se empieza de nuevo, hasta
   * `tries` veces; después, `MOVING`. Nunca devuelve un árbol a medias: si un pedido falla, tira, y el árbol guardado
   * (acá y en el dispositivo) queda como estaba.
   *
   * Dos bajadas seguidas que terminan con **la misma firma y la misma cantidad** de filas, aunque sean menos que las
   * anunciadas, son el árbol (una rama que se achicó de verdad cambia de firma): una API que anunciara de más no deja
   * al link sin árbol para siempre.
   */
  private async wholeTree(tries: number): Promise<{ sig: string; rows: Record<string, unknown>[] } | typeof MOVING | null> {
    for (let attempt = 0; attempt < tries; attempt++) {
      const list = new KeyedList<Record<string, unknown>>('plink_tree', (r) => String(r.id));
      let sig: string | null = null;
      let announced: number | null = null;
      for (;;) {
        let query = this.linkClient.rpc('plink_tree', { p_sig: list.last ? null : this.treeSig }, COUNTED);
        if (list.last) query = query.gt('id', String(list.last.id));
        const { data, error, status, count } = await timed(query.order('id').limit(MAX_ROWS_PER_REQUEST));
        if (error) {
          const problem = linkProblemOf(error.message);
          if (problem) this.onProblem(problem);
          throw toRemoteError(error, status);
        }
        const page = (data ?? []) as Record<string, unknown>[];
        if (!list.last) {
          // Sin filas en el primer pedido: el árbol es el de la firma guardada.
          if (page.length === 0) return null;
          sig = String(page[0].sig);
          // Un total menor que lo que mandó no se cree (como en `KeyedList`).
          if (typeof count === 'number' && count >= page.length) announced = count;
        }
        if (page.some((r) => String(r.sig) !== sig)) break;
        if (!list.add(page, count)) continue;
        if (announced !== null && list.rows.length !== announced && !(this.treeShort?.sig === sig && this.treeShort.rows === list.rows.length)) {
          this.treeShort = { sig: sig!, rows: list.rows.length };
          break;
        }
        this.treeShort = null;
        return { sig: sig!, rows: list.rows };
      }
    }
    return MOVING;
  }

  /** `plink_pull_page` da **una** fila (la base limpia vigente) o ninguna: no hay lista que la API pueda recortar. */
  override async pullUpdates(pageId: string, afterSeq: number): Promise<RemoteUpdate[]> {
    const rows = await this.call<{ seq: number; update: string }[]>(
      'plink_pull_page',
      { p_page_id: pageId, p_after_seq: afterSeq },
      MAX_REQUEST_TIMEOUT_MS,
    );
    return (rows ?? []).map((r) => ({ seq: Number(r.seq), data: fromBase64(r.update) }));
  }

  /** El visitante baja siempre por `plink_pull_page` (la base limpia), nunca snapshots (Docs/Doc_Compactar.md, sección 5). */
  override async pullContent(pageId: string, afterSeq: number): Promise<RemoteUpdate[]> {
    return this.pullUpdates(pageId, afterSeq);
  }

  override async fetchMyAccess(): Promise<AccessSnapshot | null> {
    const info = await this.open();
    // Como un invitado con Comentar sobre la página del link (P4): la app oculta todo lo que no es para él.
    return {
      member: { role: 'guest', removed_at: null },
      grants: [{ id: info.link_id, project_id: null, page_id: info.page_id, level: info.level === 'edit' ? 'edit' : 'comment' }],
      fetchedAt: Date.now(),
      // Con Can edit escribe solo el contenido: el título, los ajustes y la hoja son de la fila (E2.4).
      contentOnly: true,
    };
  }

  override async acceptInvitations(): Promise<number | null> {
    return null;
  }

  override async cleanWork(): Promise<CleanWorkRow[]> {
    return [];
  }

  override async pushCleanBase(): Promise<CleanPushResult> {
    return readOnly();
  }

  /**
   * Escribir con *Can edit*: a la sala de espera (`plink_push_page_update`), con la versión y el nombre del visitante.
   * Devuelve 0: la fila todavía no está en la página (la confirmación sube `syncedSV` y no mueve el cursor; lo admitido
   * llega con la base siguiente). Sin nombre no se manda (queda en el dispositivo); una subida de más de 1 MB tampoco
   * (`update_size_invalid` sin pedido: la página queda rechazada hasta deshacer o volver a intentar).
   */
  override async pushUpdate(pageId: string, clientUpdateId: string, update: Uint8Array): Promise<number> {
    const info = await this.open();
    if (info.level !== 'edit') return readOnly();
    const name = this.author().trim();
    if (!name) {
      this.setEdits({ needName: true });
      throw new RemoteError(AUTHOR_MISSING, false, '22023');
    }
    if (update.length === 0 || update.length > LINK_PUSH_MAX_BYTES) throw new RemoteError('update_size_invalid', true, '22023');
    const b64 = toBase64(update);
    await this.call<number>(
      'plink_push_page_update',
      { p_page_id: pageId, p_client_update_id: clientUpdateId, p_update: b64, p_app_version: this.version(), p_author: name },
      MAX_REQUEST_TIMEOUT_MS,
    );
    this.statusDue = true;
    this.memory.addSent(pageId);
    this.setEdits({ needName: false, waiting: [...new Set([...this.edits.waiting, pageId])] });
    return 0;
  }

  /**
   * Cómo va lo mandado desde este dispositivo (`plink_push_status`): qué espera y qué se apartó. Solo mientras algo
   * espera (o al abrir), una vez cada `STATUS_EVERY_MS`. Cuenta como un pase: con el tope del día lleno, deja de
   * preguntar hasta mañana sin avisar que el link no puede escribir (R2 de la re-verificación).
   */
  async refreshEdits(force = false): Promise<void> {
    const now = Date.now();
    if (!force && (!this.statusDue || now < this.statusOffUntil || now - this.statusAt < STATUS_EVERY_MS)) return;
    this.statusAt = now;
    let rows: { page_id: string; waiting: number; aside: number }[];
    try {
      // Una fila por página, entera (por `page_id`): con una lista cortada, las páginas que faltan se tomaban por
      // "lo mandado ya entró" y se dejaban de recordar (`dropSent`).
      rows = await rpcByKey(this.linkClient, 'plink_push_status', {}, 'page_id');
    } catch (err) {
      const problem = linkProblemOf(err);
      if (problem === 'link_rate_limited') {
        const tomorrow = new Date();
        tomorrow.setHours(24, 0, 0, 0);
        this.statusOffUntil = tomorrow.getTime();
        return;
      }
      if (problem) this.onProblem(problem);
      throw err;
    }
    this.counts = new Map(rows.map((r) => [String(r.page_id), { waiting: Number(r.waiting) || 0, aside: Number(r.aside) || 0 }]));
    const waiting = rows.filter((r) => Number(r.waiting) > 0).map((r) => String(r.page_id));
    this.statusDue = waiting.length > 0;
    const aside = this.unseenAside();
    // Lo mandado que ya no espera ni tiene nada apartado sin ver entró a la página: no hace falta recordarlo (O9).
    const open = new Set([...waiting, ...aside]);
    this.memory.dropSent(this.memory.sent().filter((p) => !open.has(p)));
    this.setEdits({ waiting, aside });
  }

  /**
   * Las páginas con algo apartado que el visitante todavía no dejó atrás: más apartadas que las que había (apartadas y
   * esperando) cuando volvió a la versión del equipo en esa página (`acknowledgeAside`).
   */
  private unseenAside(): string[] {
    const seen = this.memory.seen();
    return [...this.counts].filter(([page, c]) => c.aside > (seen[page] ?? 0)).map(([page]) => page);
  }

  /** Vuelve a mirar lo apartado ya visto (otra pestaña volvió a la versión del equipo). */
  recheckAside(): void {
    this.setEdits({ aside: this.unseenAside() });
  }

  /**
   * El visitante bajó lo suyo y volvió a la versión del equipo en esta página (entrega 2c): lo apartado hasta ahora ya no
   * se avisa. **Solo lo apartado** (O2 de la auditoría de la 2c): lo apartado nunca baja, así que cualquier fila que se
   * aparte después (también una que esperaba al volver) vuelve a mostrar el aviso. Lo que esperaba de la sesión de antes y
   * se aparta en cadena lo avisa otra vez: es de más, nunca de menos.
   */
  acknowledgeAside(pageId: string): void {
    const c = this.counts.get(pageId) ?? { waiting: 0, aside: 0 };
    this.memory.setSeen(pageId, c.aside);
    this.recheckAside();
  }

  /** Las páginas donde este dispositivo mandó algo con el link (también antes de recargar la app; O9). */
  sentPages(): string[] {
    return this.memory.sent();
  }

  override async createPage(): Promise<void> {
    return readOnly();
  }

  override async updatePage(): Promise<void> {
    return readOnly();
  }

  override async createProject(): Promise<void> {
    return readOnly();
  }

  override async renameProject(): Promise<void> {
    return readOnly();
  }

  /** Ni archivar, borrar, restaurar o borrar para siempre un proyecto: el pedido no sale. */
  override async setProjectArchived(): Promise<never> {
    return readOnly();
  }

  override async deleteProject(): Promise<never> {
    return readOnly();
  }

  override async restoreProject(): Promise<never> {
    return readOnly();
  }

  override async purgeProject(): Promise<never> {
    return readOnly();
  }

  override async uploadFile(): Promise<void> {
    // Las imágenes viejas sin portero (`sdfile://`, bucket `page-files`): nunca por un link.
    return readOnly();
  }

  /**
   * Las funciones de archivos del visitante (entrega 2b): `link_not_found` dice que el link murió (la pantalla lo
   * muestra); un tope de archivos (`link_rate_limited`) no: queda en el aviso del archivo, sin cortar el link entero.
   */
  private async fileCall<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const info = await this.open();
    if (info.level !== 'edit') return readOnly();
    if (info.schema_version < LINK_FILES_SCHEMA_VERSION) return noUploads();
    const { data, error, status } = await timed(this.linkClient.rpc(fn, args));
    if (error) {
      if (linkProblemOf(error.message) === 'link_not_found') this.onProblem('link_not_found');
      throw toRemoteError(error, status);
    }
    return data as T;
  }

  /** Las imágenes viejas `sdfile://` (bucket `page-files`) no se abren por un link (3.9). */
  override async downloadFile(): Promise<Blob> {
    throw new RemoteError('file_not_found', true, 'P0002');
  }

  // --- archivos: solo ver ------------------------------------------------------------------------------------------

  override async fetchMediaFiles(ids: string[]): Promise<MediaFileRow[]> {
    const info = await this.open();
    const out: MediaFileRow[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      // De a 200 ids (el tope de la función) y, de cada tanda, todas las filas: por `id` y hasta el total. Un archivo
      // que no vino porque la API recortó la respuesta se tomaría por "el link no lo ve".
      const rows = await this.listed<Record<string, unknown>>('plink_media_files', { p_ids: ids.slice(i, i + 200) }, 'id');
      for (const r of rows) {
        out.push({
          id: String(r.id),
          name: String(r.name),
          mime: String(r.mime),
          width: r.width == null ? null : Number(r.width),
          height: r.height == null ? null : Number(r.height),
          duration: r.duration == null ? null : Number(r.duration),
          thumb_at: typeof r.thumb_at === 'string' ? r.thumb_at : null,
          drive_id: typeof r.drive_id === 'string' ? r.drive_id : null,
          size: r.size == null ? null : Number(r.size),
          trashed_at: null,
          purged_at: null,
          drive_trashed_at: null,
          project_id: info.link_id,
        });
      }
    }
    return out;
  }

  override async fetchPageUses(): Promise<PageUseRow[]> {
    return [];
  }

  /**
   * Registra un archivo nuevo en una página de la rama (`plink_register_file`): cuenta en los topes del link y nunca
   * vincula un id que ya existe de otro. Una carpeta no (LE7).
   */
  override async registerFile(file: NewMediaFile): Promise<LinkResult> {
    if (file.mime === LINK_FOLDER_MIME) throw new RemoteError(stored('link.edit.noFolders'), true, '42501');
    await this.fileCall<string>('plink_register_file', {
      p_id: file.id,
      p_page_id: file.pageId,
      p_name: file.name,
      p_mime: file.mime,
      p_size: file.size,
      p_width: file.width,
      p_height: file.height,
      p_duration: file.duration,
      p_app_version: this.version(),
    });
    return 'ok';
  }

  /** El uso de un archivo en una página lo registra el dispositivo de un editor al reconciliar (E2.4): acá, nada. */
  override async linkPageFile(): Promise<LinkResult> {
    return 'ok';
  }

  /** La miniatura de un archivo que registró este link (la política `thumbs_insert_link` mira el header). */
  override async uploadThumb(fileId: string, data: Blob, stalledBefore = 0): Promise<void> {
    const info = await this.open();
    if (info.level !== 'edit') return readOnly();
    if (info.schema_version < LINK_FILES_SCHEMA_VERSION) return noUploads();
    return super.uploadThumb(fileId, data, stalledBefore);
  }

  override async setFileThumb(fileId: string): Promise<void> {
    await this.fileCall('plink_set_file_thumb', { p_file_id: fileId });
  }

  /** Lo mismo al sacar una foto: la desvincula el editor al reconciliar. */
  override async unlinkPageFile(): Promise<boolean> {
    return true;
  }

  override async trashedFiles(): Promise<never[]> {
    return [];
  }

  override async trashedFilesAll(): Promise<Map<string, never[]>> {
    return new Map();
  }

  override async filesDueForPurge(): Promise<never[]> {
    return [];
  }

  override async projectSizes(): Promise<null> {
    return null;
  }

  // --- cerrado explícito: lo que hereda de SupabaseRemote y un link no hace nunca (E2.1) ---------------------------

  /** Un link no compacta ni baja snapshots (sigue con `plink_pull_page`). */
  override async claimCompaction(): Promise<null> {
    return null;
  }

  override async pushSnapshot(): Promise<never> {
    return readOnly();
  }

  override async confirmSnapshot(): Promise<never> {
    return readOnly();
  }

  override async skipCompaction(): Promise<never> {
    return readOnly();
  }

  override async invalidateSnapshot(): Promise<boolean> {
    return false;
  }

  /** Un link no admite (lo hace un editor) ni ve lo apartado de una página. */
  override async admitPages(): Promise<AdmitPageRow[]> {
    return [];
  }

  override async admitWork(): Promise<AdmitWorkRow[]> {
    return [];
  }

  override async admit(): Promise<AdmitResult[]> {
    return readOnly();
  }

  override async linkUpdatesOf(): Promise<LinkUpdateRow[]> {
    return [];
  }

  override async linkAside(): Promise<LinkAsideRow[]> {
    return [];
  }

  override async linkUpdateBytes(): Promise<Uint8Array> {
    return readOnly();
  }

  /** Sin historial ni versiones con nombre (P4). */
  override async pageHistory(): Promise<never> {
    return readOnly();
  }

  override async namePageVersion(): Promise<never> {
    return readOnly();
  }

  override async renamePageVersion(): Promise<never> {
    return readOnly();
  }

  override async removePageVersion(): Promise<never> {
    return readOnly();
  }

  override async markPageRestored(): Promise<never> {
    return readOnly();
  }

  /** Ni compartir ni el equipo. */
  override async share(): Promise<never> {
    return readOnly();
  }

  override async unshare(): Promise<never> {
    return readOnly();
  }

  override async createInvitation(): Promise<never> {
    return readOnly();
  }

  override async revokeInvitation(): Promise<never> {
    return readOnly();
  }

  override async setMemberRole(): Promise<never> {
    return readOnly();
  }

  override async removeMember(): Promise<never> {
    return readOnly();
  }
}

/** Una fila de `plink_list_comments`. */
interface LinkCommentRow {
  id: string;
  page_id: string;
  block_id: string | null;
  thread_id: string | null;
  body: string | null;
  author_name: string | null;
  author_kind: 'team' | 'imported' | 'link';
  mine: boolean;
  created_at: string;
  edited_at: string | null;
  resolved_at: string | null;
  deleted_at: string | null;
  updated_at: string;
}

/**
 * La fila de la app para un comentario visto por un link: los propios (de este link y este dispositivo) con el id del
 * visitante (así se editan y borran); los del equipo y los importados, con el nombre (nunca un correo ni un id); los de
 * un link, con su nombre en `plink_author` (la app suma "(via link)").
 */
export function linkCommentRow(r: LinkCommentRow, me: string): ListedComment {
  const linkName = r.author_kind === 'link' && !r.mine ? r.author_name : null;
  return {
    id: r.id,
    page_id: r.page_id,
    block_id: r.block_id,
    thread_id: r.thread_id,
    body: r.body,
    author_id: r.mine ? me : null,
    created_at: r.created_at,
    edited_at: r.edited_at,
    resolved_at: r.resolved_at,
    resolved_by: null,
    deleted_at: r.deleted_at,
    deleted_by: null,
    imported_from: null,
    imported_author: r.author_kind !== 'link' ? r.author_name : null,
    imported_author_email: null,
    imported_by: null,
    plink_author: linkName,
    updated_at: r.updated_at,
  };
}

/** Los comentarios desde un link (`plink_*`): comentar y responder, y editar y borrar los propios. Nunca resolver. */
export class LinkCommentRemote implements CommentRemote {
  constructor(
    private readonly client: SupabaseClient,
    /** El id del visitante en la app (`AuthUser.id` del modo link). */
    private readonly me: string,
    /** El nombre que escribió el visitante (P8), en el momento de subir. */
    private readonly author: () => string,
  ) {}

  private async call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error, status } = await timed(this.client.rpc(fn, args));
    if (error) throw toRemoteError(error, status);
    return data as T;
  }

  /**
   * Los comentarios de la página, **enteros**: por clave, en el orden de la función (`updated_at`, `id`) escrito en el
   * pedido y hasta el total que dice la API, como `SupabaseCommentRemote.listComments`. Cada pedido sigue a la última
   * fila recibida (`p_since` con su fecha y un filtro que deja afuera lo de esa fecha que ya llegó); un comentario que
   * cambia entre dos pedidos vuelve a llegar con su fecha nueva y queda su última versión. Si un pedido falla, tira:
   * la cola tomaría una lista parcial por todo lo que hay (en una bajada entera, reemplaza lo guardado de la página).
   */
  async listComments(pageId: string, since: string | null): Promise<ListedComment[]> {
    const list = new KeyedList<LinkCommentRow>('plink_list_comments', (r) => `${r.updated_at}|${r.id}`);
    for (;;) {
      const last = list.last ? placeOf('plink_list_comments', list.last.updated_at, list.last.id) : null;
      let query = this.client.rpc('plink_list_comments', { p_page_id: pageId, p_since: last ? last.at : since }, COUNTED);
      if (last) query = query.or(afterPair('updated_at', last.at, 'id', last.id));
      const { data, error, status, count } = await timed(query.order('updated_at').order('id').limit(MAX_ROWS_PER_REQUEST));
      if (error) throw toRemoteError(error, status);
      if (list.add((data ?? []) as LinkCommentRow[], count)) break;
    }
    const byId = new Map<string, LinkCommentRow>();
    for (const row of list.rows) {
      byId.delete(row.id);
      byId.set(row.id, row);
    }
    return [...byId.values()].map((r) => linkCommentRow(r, this.me));
  }

  async fetchComments(pageId: string): Promise<CommentRow[]> {
    return this.listComments(pageId, null);
  }

  async fetchCommentAuthors(): Promise<CommentAuthor[]> {
    return [];
  }

  async addComment(c: NewComment): Promise<void> {
    const name = this.author().trim();
    // Sin nombre no se sube: queda en la cola hasta que lo escriba (la app lo pide antes de comentar).
    if (!name) throw new RemoteError('author_missing', false, '22023');
    await this.call('plink_add_comment', {
      p_id: c.id,
      p_page_id: c.pageId,
      p_block_id: c.blockId,
      p_thread_id: c.threadId,
      p_body: c.body,
      p_author: name,
    });
  }

  async editComment(id: string, body: string): Promise<void> {
    await this.call('plink_edit_comment', { p_id: id, p_body: body });
  }

  async deleteComment(id: string): Promise<void> {
    await this.call('plink_delete_comment', { p_id: id });
  }

  async resolveThread(): Promise<void> {
    throw new RemoteError('not_allowed', true, '42501');
  }

  async importComment(): Promise<void> {
    throw new RemoteError('not_allowed', true, '42501');
  }
}
