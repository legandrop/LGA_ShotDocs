import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { errorMessage, isNetworkError, isPermanent, RemoteError } from './types';
import { APP_OUTDATED } from './remote';
import { localize, stored, t } from '../i18n';

// Comentarios y preguntas (paso 10 de Docs/Plan_Workspaces.md; Docs/Doc_Sincronizacion.md, "Comentarios y
// preguntas"). Viven en una tabla propia de la base, anclados al id de un bloque de la página (o a la página
// entera), nunca dentro del documento: así quien solo comenta no escribe la página, y una versión de la app
// que no los conoce no puede borrar nada.
//
// Primero en el dispositivo: cada alta, edición, borrado y resolución entra a una cola en una base IndexedDB
// aparte (`<base local>:comments`; la de siempre no cambia de versión, porque una versión vieja de la app no
// podría abrirla). La cola sube en orden cuando hay red, y cada paso es idempotente por id: reintentar lo que
// ya llegó no duplica nada. Lo que se ve es lo último que bajó del servidor con la cola encima. Un error
// permanente queda a la vista con su motivo y no se descarta solo.

/** La versión de la base con `comments`, `comments_view` y sus funciones (20260930170000_comentarios.sql). */
export const COMMENTS_SCHEMA_VERSION = 5;
/** La escala de la base: comentar es 2 (ver `access.ts`). */
export const LEVEL_COMMENT = 2;
/** Borrar un comentario ajeno pide editar y crear páginas (4). */
export const LEVEL_DELETE_ANY = 4;
/** El largo máximo del texto (la restricción de `comments.body`). */
export const MAX_COMMENT_LENGTH = 10_000;

// Cada comentario importado se guarda además en `meta` (`import:<id>`) hasta que el servidor lo confirma. Una
// versión de la app anterior a los comentarios importados (misma base del dispositivo) no conoce la operación
// `import`: si toma el control de la sincronización, la da por subida sin mandarla y la saca de la cola. Esa
// versión solo borra en `meta` las claves `since:`, así que al abrir, lo que está en `meta` y ya no está ni en
// la cola ni en lo bajado vuelve a la cola (el mismo id: nada se duplica).
const IMPORT_KEY = 'import:';

// Las menciones de un comentario (Docs/Doc_Menciones.md, 3.3) viajan en una operación aparte, `mentions`, detrás del
// alta o la edición. Una versión vieja de la app no la conoce y la daría por subida sin mandarla: como con `import`,
// cada una queda también en `meta` (`mentions:<id del comentario>`) hasta que el servidor la confirma o la descarta.
const MENTIONS_KEY = 'mentions:';
// A quién la base no avisó (lo descartó por permisos): solo lo ve el autor, en este dispositivo.
const UNNOTIFIED_KEY = 'unnotified:';

/** La versión de la base con `comment_mentions` y sus funciones (20261015120000_menciones.sql). */
export const MENTIONS_SCHEMA_VERSION = 15;
/**
 * La versión de la base cuyo `import_comment` acepta el origen `'shotdocs'` (20261021120000_comentarios_archivo.sql):
 * los comentarios que vuelven de un archivo exportado (Docs/Doc_Exportar.md, sección 3).
 */
export const ARCHIVE_COMMENTS_SCHEMA_VERSION = 18;
/** Lo más que acepta la base por comentario. */
export const MAX_MENTIONS = 20;

/** Una persona mencionada en un comentario: su id y el rótulo que se escribió (`@lega` → `lega`). */
export interface MentionRef {
  userId: string;
  label: string;
}

/** La forma que acepta `comments.block_id`. */
const BLOCK_ID = /^[A-Za-z0-9_-]{1,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Una fila de `comments_view` (la tabla no se puede leer con `*`: el texto sale solo por la vista). */
export interface CommentRow {
  id: string;
  page_id: string;
  /** El bloque de BlockNote; `null`: la página entera. Una respuesta lleva el del hilo. */
  block_id: string | null;
  /** `null`: abre un hilo. */
  thread_id: string | null;
  /** Vacío (`null`) si se borró. */
  body: string | null;
  /** `null` si la cuenta se borró. */
  author_id: string | null;
  created_at: string;
  edited_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  /** De dónde vino un comentario importado (`'coda'`); ausente o `null` en los demás. */
  imported_from?: string | null;
  /** El nombre del autor de afuera (sin cuenta en la app); `null` si es de una cuenta de la app. */
  imported_author?: string | null;
  imported_author_email?: string | null;
  /** Quien importó el comentario (una cuenta de la app). */
  imported_by?: string | null;
  /**
   * El nombre que escribió quien comentó con un link público (Docs/Doc_Link_Publico.md, 3.7); ausente o `null` en los
   * demás. Se muestra siempre con "(via link)".
   */
  plink_author?: string | null;
  /** Las menciones activas (`list_comments` desde la versión 15 de la base); `null` si se borró. */
  mentions?: { user_id: string; label: string }[] | null;
}

/** Un comentario que viene de otra herramienta (`import_comment`, 20260930200000_comentarios_importados.sql). */
export interface ImportedComment extends NewComment {
  /** La fecha original. */
  createdAt: string;
  /** Solo en el primer comentario del hilo: el hilo entra resuelto. */
  resolvedAt: string | null;
  /** De dónde viene (`'coda'`). */
  source: string;
  /** `null`: el comentario era de quien importa y queda a su nombre. */
  authorName: string | null;
  authorEmail: string | null;
}

export interface NewComment {
  id: string;
  pageId: string;
  blockId: string | null;
  threadId: string | null;
  body: string;
}

/** Quien aparece en los comentarios de una página (`comment_authors`). */
export interface CommentAuthor {
  user_id: string;
  email: string;
}

/** Lo que la cola le pide al servidor. Las pruebas usan uno en memoria (`testing.ts`). */
export interface CommentRemote {
  fetchComments(pageId: string): Promise<CommentRow[]>;
  fetchCommentAuthors(pageId: string): Promise<CommentAuthor[]>;
  /** Idempotente: el mismo id con el mismo contenido no hace nada; con otro, `comment_conflict`. */
  addComment(comment: NewComment): Promise<void>;
  /** El mismo texto no cambia nada. */
  editComment(id: string, body: string): Promise<void>;
  /** Borrar uno ya borrado no hace nada. */
  deleteComment(id: string): Promise<void>;
  /** Resolver uno resuelto (o abrir uno abierto) no cambia nada. */
  resolveThread(threadId: string, resolved: boolean): Promise<void>;
  /** `import_comment`: idempotente como `addComment` (pide editar la página). */
  importComment(comment: ImportedComment): Promise<void>;
  /**
   * `list_comments(p_page_id, p_since)`, si la base la tiene: lo mismo que `comments_view` más
   * `updated_at`, y con `since` solo lo que cambió desde entonces. `null` si la base no tiene la función
   * (se sigue con la vista entera).
   */
  listComments?(pageId: string, since: string | null): Promise<ListedComment[] | null>;
  /**
   * `set_comment_mentions`: el conjunto entero de las menciones de un comentario propio; devuelve los ids que la base
   * aceptó (los demás los descartó por permisos). Sin la función (una base vieja, un link público), no está.
   */
  setCommentMentions?(commentId: string, mentions: { user_id: string; label: string }[]): Promise<string[]>;
}

/** Una fila de `list_comments`: la de la vista más cuándo cambió por última vez. */
export type ListedComment = CommentRow & { updated_at?: string | null };

/** Cada cuánto, como mucho, se vuelve a bajar una página abierta (en el acto si se subió algo de ella). */
export const PULL_EVERY_MS = 10_000;

/** Un cambio hecho en el dispositivo, en la cola hasta que el servidor lo confirma. */
export type CommentOp =
  | { kind: 'add'; id: string; pageId: string; blockId: string | null; threadId: string | null; body: string; at: string }
  | { kind: 'edit'; id: string; pageId: string; body: string; at: string }
  | { kind: 'delete'; id: string; pageId: string; at: string }
  | { kind: 'resolve'; id: string; pageId: string; resolved: boolean; at: string }
  // Las menciones de un comentario propio: el conjunto entero (Doc_Menciones.md, 3.3).
  | { kind: 'mentions'; id: string; pageId: string; mentions: MentionRef[]; at: string }
  // Un comentario importado (Doc_Importar_Coda.md): `at` es la fecha original.
  | {
      kind: 'import';
      id: string;
      pageId: string;
      blockId: string | null;
      threadId: string | null;
      body: string;
      at: string;
      resolvedAt: string | null;
      source: string;
      authorName: string | null;
      authorEmail: string | null;
    };

export interface QueuedCommentOp {
  seq?: number;
  op: CommentOp;
  /**
   * Ya se intentó mandar (la respuesta pudo perderse y el servidor tenerlo). Desde ahí no se le funde nada:
   * reintentar un alta con otro texto daría `comment_conflict`.
   */
  attempted: boolean;
  /** El servidor lo rechazó para siempre: queda a la vista con el motivo hasta "Retry" o descartarlo a mano. */
  failed: boolean;
  error: string | null;
  queuedAt: number;
}

interface CommentsDBSchema extends DBSchema {
  meta: { key: string; value: unknown };
  /** Lo último que bajó del servidor (más lo confirmado desde este dispositivo). */
  comments: { key: string; value: CommentRow; indexes: { page: string } };
  outbox: { key: number; value: QueuedCommentOp };
  /** Correos de quienes aparecen en los comentarios, para mostrarlos sin red. */
  authors: { key: string; value: { userId: string; email: string } };
}

export type CommentsDb = IDBPDatabase<CommentsDBSchema>;

/** El nombre de la base de comentarios que acompaña a una base local. */
export function commentsDbName(localDbName: string): string {
  return `${localDbName}:comments`;
}

export function openCommentsDb(name: string): Promise<CommentsDb> {
  return openDB<CommentsDBSchema>(name, 1, {
    upgrade(db) {
      db.createObjectStore('meta');
      db.createObjectStore('comments', { keyPath: 'id' }).createIndex('page', 'page_id');
      db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
      db.createObjectStore('authors', { keyPath: 'userId' });
    },
  });
}

// --- Lo que ve la interfaz ------------------------------------------------------------------------------

export interface CommentView {
  id: string;
  pageId: string;
  blockId: string | null;
  threadId: string | null;
  body: string;
  authorId: string | null;
  /** Importado de otra herramienta (`'coda'`), o `null`. */
  importedFrom: string | null;
  /** El autor de afuera (sin cuenta en la app) de un comentario importado, o `null`. */
  importedAuthor: string | null;
  importedAuthorEmail: string | null;
  /** Quien lo importó (una cuenta de la app), o `null`. */
  importedBy: string | null;
  /** El nombre de quien lo escribió con un link público, o `null` (se muestra con "(via link)"). */
  linkAuthor?: string | null;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  /** Tiene cambios guardados en el dispositivo que todavía no subieron. */
  pending: boolean;
  /** Solo existe en el dispositivo: su alta todavía no llegó al servidor. */
  local: boolean;
  /** El servidor rechazó un cambio de este comentario: el motivo, en palabras. */
  error: string | null;
  /** Los cambios rechazados (para reintentar o descartar a mano). */
  failedSeqs: number[];
  /** Qué eran los cambios rechazados (para explicar qué pasa al descartarlos). */
  failedKinds: CommentOp['kind'][];
  /** El texto de un alta o una edición rechazadas (para copiarlo antes de descartar). */
  rejectedText: string | null;
  /** Las menciones activas (lo bajado, o lo que espera subir). */
  mentions: MentionRef[];
  /** Los rótulos de quienes la base no avisó (solo en el dispositivo de quien escribió). */
  unnotified: string[];
}

export interface CommentThread {
  /** El id del primer comentario del hilo. */
  id: string;
  pageId: string;
  blockId: string | null;
  root: CommentView;
  /** Las respuestas, en orden: las que no se borraron y las borradas con un cambio rechazado. */
  replies: CommentView[];
  resolved: boolean;
  resolvedAt: string | null;
  resolvedBy: string | null;
  /** Comentarios sin borrar (el primero cuenta si no se borró). */
  count: number;
  /** Algo del hilo espera subir, o fue rechazado. */
  pending: boolean;
  error: string | null;
}

/** Los errores de la base, en palabras (en inglés: se guardan; se traducen al mostrarlos con `localize`). */
export function commentErrorText(error: string, kind?: CommentOp['kind']): string {
  switch (error) {
    case 'page_not_found':
      return stored('commentError.pageNotFound');
    case 'comment_not_found':
      return stored('commentError.commentNotFound');
    case 'thread_not_found':
      return stored('commentError.threadNotFound');
    case 'comment_denied':
      return stored('commentError.denied');
    case 'not_allowed':
      return kind === 'delete' ? stored('commentError.deleteNotAllowed') : stored('commentError.editNotAllowed');
    case 'comment_conflict':
      return stored('commentError.conflict');
    case 'comment_deleted':
      return stored('commentError.deleted');
    case 'thread_other_page':
    case 'thread_invalid':
      return stored('commentError.threadInvalid');
    case 'import_denied':
      return stored('commentError.importDenied');
    case 'mentions_invalid':
      return stored('commentError.mentionsInvalid');
    case 'created_invalid':
    case 'resolved_invalid':
      return stored('commentError.importInvalid');
    case 'not_authenticated':
      return stored('commentError.signedOut');
    case APP_OUTDATED:
      return stored('commentError.outdated');
    default:
      return error;
  }
}

/** Valida un texto antes de guardarlo (lo mismo que pide la base). */
export function cleanBody(body: string): string {
  const text = body.replace(/\r\n?/g, '\n').replace(/\s+$/u, '').replace(/^\s*\n/u, '');
  if (!/\S/u.test(text)) throw new CommentInvalid(t('commentError.empty'));
  if (text.length > MAX_COMMENT_LENGTH) throw new CommentInvalid(t('commentError.tooLong', { max: MAX_COMMENT_LENGTH }));
  return text;
}

export class CommentInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommentInvalid';
  }
}

export interface CommentStatus {
  /** Cambios que faltan subir (sin contar los rechazados). */
  pending: number;
  /** Rechazados por el servidor; siguen en el dispositivo. */
  failed: number;
  /** El último error que se va a reintentar solo. */
  error: string | null;
}

/** Un rechazo, para el detalle del estado de la sincronización. */
export interface CommentFailure {
  seq: number;
  kind: CommentOp['kind'];
  pageId: string;
  body: string | null;
  error: string;
}

/** Qué pasa al descartar un cambio rechazado, en palabras, y el texto que se pierde (para copiarlo). */
export interface DiscardInfo {
  message: string;
  text: string | null;
}

function isRow(value: unknown): value is CommentRow {
  const r = value as Partial<CommentRow> | null;
  return (
    !!r &&
    typeof r === 'object' &&
    typeof r.id === 'string' &&
    typeof r.page_id === 'string' &&
    typeof r.created_at === 'string' &&
    (r.block_id === null || typeof r.block_id === 'string') &&
    (r.thread_id === null || typeof r.thread_id === 'string')
  );
}

/**
 * La cola de comentarios de un dispositivo, más lo bajado del servidor. La interfaz la lee con
 * `threads(pageId)` y se suscribe con `subscribe`; la sincronización la corre con `run` al final de cada
 * ciclo (ver `engine.ts`).
 */
export class CommentQueue {
  /** Se agregó algo a la cola: conviene sincronizar pronto. */
  onQueued?: () => void;
  /** Cambió lo que cuenta el estado (pendientes, rechazados, error). */
  onChange?: () => void;
  /** La base rechazó un cambio por la versión mínima del workspace (`app_outdated`): se ve el aviso de actualizar. */
  onOutdated?: () => void;
  /** Subió un comentario propio (la campana pregunta ya: Doc_Menciones.md, 5.1). */
  onUploaded?: () => void;

  private ops: QueuedCommentOp[] = [];
  private readonly rows = new Map<string, Map<string, CommentRow>>();
  private readonly loadingRows = new Map<string, Promise<void>>();
  private readonly authors = new Map<string, string>();
  /** A quién no avisó la base, por comentario propio (`unnotified:` en `meta`). */
  private readonly unnotified = new Map<string, string[]>();
  private readonly watched = new Map<string, number>();
  /** Páginas que ya se bajaron en esta sesión (las demás se muestran con lo guardado). */
  private readonly pulled = new Set<string>();
  private readonly cache = new Map<string, { revision: number; threads: CommentThread[] }>();
  private readonly listeners = new Set<() => void>();
  private revision = 0;
  private schemaVersion: number | null = null;
  /** La generación del workspace (sube al restaurar una copia) y la última que vio este dispositivo. */
  private generation: number | null = null;
  private knownGeneration: number | null = null;
  /** Cuándo se bajó cada página por última vez, y las que hay que bajar ya (se subió algo de ellas). */
  private readonly lastPull = new Map<string, number>();
  private readonly dirty = new Set<string>();
  /** Por qué no se pudo bajar una página (a la vista en el panel). */
  private readonly pullErrors = new Map<string, string>();
  private lastError: string | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private stopped = false;
  private readonly now: () => number;

  /**
   * `db` en `null`: la base de comentarios del dispositivo no se pudo abrir. Se pueden leer (con red) pero
   * no escribir; `unavailable` dice por qué.
   */
  constructor(
    private readonly db: CommentsDb | null,
    private readonly remote: CommentRemote,
    readonly userId: string,
    private readonly options: { unavailable?: string; now?: () => number } = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  get unavailable(): string | undefined {
    return this.db ? undefined : (this.options.unavailable ?? stored('commentError.storage'));
  }

  /** Se puede escribir: la base del dispositivo está abierta. */
  get writable(): boolean {
    return this.db !== null;
  }

  /** La base del workspace tiene los comentarios (versión 5 o más). Sin eso, la cola espera. */
  get ready(): boolean {
    return this.schemaVersion !== null && this.schemaVersion >= COMMENTS_SCHEMA_VERSION;
  }

  async load(): Promise<void> {
    if (!this.db) return;
    await this.restoreImports().catch(() => undefined);
    await this.restoreMentions().catch(() => undefined);
    const [ops, authors] = await Promise.all([this.db.getAll('outbox'), this.db.getAll('authors')]);
    this.ops = ops.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    for (const a of authors) this.authors.set(a.userId, a.email);
    const keys = (await this.db.getAllKeys('meta')).filter((k): k is string => typeof k === 'string' && k.startsWith(UNNOTIFIED_KEY));
    for (const key of keys) {
      const labels = await this.db.get('meta', key);
      if (Array.isArray(labels)) this.unnotified.set(key.slice(UNNOTIFIED_KEY.length), labels.filter((l) => typeof l === 'string'));
    }
    this.changed();
  }

  /**
   * Las menciones que están en `meta` y ya no están en la cola (una versión vieja de la app las sacó sin mandarlas, o
   * la app se cortó entre confirmar y olvidarlas): si lo bajado ya las tiene, o el comentario no llegó nunca o se
   * borró, se olvidan; si no, vuelven a la cola (el conjunto entero: repetirlo no cambia nada).
   */
  private async restoreMentions(): Promise<void> {
    const db = this.db!;
    const tx = db.transaction(['outbox', 'meta', 'comments'], 'readwrite');
    const outbox = tx.objectStore('outbox');
    const meta = tx.objectStore('meta');
    const rows = tx.objectStore('comments');
    const keys = (await meta.getAllKeys()).filter((k): k is string => typeof k === 'string' && k.startsWith(MENTIONS_KEY));
    if (keys.length > 0) {
      const queue = await outbox.getAll();
      const queued = new Set(queue.filter((e) => e.op.kind === 'mentions').map((e) => e.op.id));
      const unsent = new Set(queue.filter((e) => isNew(e.op)).map((e) => e.op.id));
      for (const key of keys) {
        const op = (await meta.get(key)) as CommentOp | undefined;
        if (!op || op.kind !== 'mentions' || queued.has(op.id)) continue;
        const row = await rows.get(op.id);
        const gone = row ? !!row.deleted_at : !unsent.has(op.id);
        if (gone || (row && sameMentions(row.mentions ?? [], op.mentions, this.userId))) await meta.delete(key);
        else await outbox.add({ op, attempted: false, failed: false, error: null, queuedAt: this.now() });
      }
    }
    await tx.done;
  }

  /**
   * Los comentarios importados que están en `meta` y ya no están ni en la cola ni en lo bajado (una versión
   * vieja de la app los sacó de la cola sin mandarlos) vuelven a la cola. Los que ya bajaron se olvidan.
   */
  private async restoreImports(): Promise<void> {
    const db = this.db!;
    const tx = db.transaction(['outbox', 'meta', 'comments'], 'readwrite');
    const outbox = tx.objectStore('outbox');
    const meta = tx.objectStore('meta');
    const rows = tx.objectStore('comments');
    const keys = (await meta.getAllKeys()).filter((k): k is string => typeof k === 'string' && k.startsWith(IMPORT_KEY));
    if (keys.length > 0) {
      const queued = new Set((await outbox.getAll()).filter((e) => e.op.kind === 'import').map((e) => e.op.id));
      for (const key of keys) {
        const op = (await meta.get(key)) as CommentOp | undefined;
        if (!op || op.kind !== 'import' || queued.has(op.id)) continue;
        if (await rows.get(op.id)) await meta.delete(key);
        else await outbox.add({ op, attempted: false, failed: false, error: null, queuedAt: this.now() });
      }
    }
    await tx.done;
  }

  /**
   * La versión de la base del workspace (`workspace_settings.schema_version`) y su generación; `null` si no
   * se sabe. Con una generación nueva, nada se baja antes de recuperar lo propio (ver `syncGeneration`).
   */
  configure(schemaVersion: number | null, generation: number | null = null): void {
    const before = this.ready;
    const mentionsBefore = this.mentionsReady;
    this.schemaVersion = schemaVersion;
    if (generation !== null) this.generation = generation;
    if (before !== this.ready || mentionsBefore !== this.mentionsReady) this.changed();
  }

  /**
   * La base del workspace tiene las menciones (versión 15 o más) y la cola las puede mandar. Sin eso (una base sin
   * migrar, un link público), el `@` es texto y no hay campana.
   */
  get mentionsReady(): boolean {
    return this.schemaVersion !== null && this.schemaVersion >= MENTIONS_SCHEMA_VERSION && !!this.remote.setCommentMentions;
  }

  /**
   * La base se restauró desde una copia de seguridad (cambió la generación): lo comentado después de la
   * copia ya no está en el servidor. Antes de la primera bajada (que pisaría lo guardado), vuelve a poner en
   * la cola, con el mismo id (el alta es idempotente), los comentarios propios que el servidor ya no tiene,
   * sus ediciones, y los borrados y resoluciones hechos por esta persona. Devuelve cuántos cambios volvieron.
   */
  syncGeneration(generation: number): Promise<number> {
    this.generation = generation;
    return this.serial(() => this.recoverIfNeeded());
  }

  stop(): void {
    this.stopped = true;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getRevision = (): number => this.revision;

  /**
   * La página está abierta: se cargan sus comentarios guardados, se bajan los del servidor y se vuelven a
   * bajar mientras siga abierta (como mucho cada `PULL_EVERY_MS`, o en el acto si se subió algo de ella).
   * Devuelve la función para dejar de mirarla.
   */
  watch(pageId: string): () => void {
    this.watched.set(pageId, (this.watched.get(pageId) ?? 0) + 1);
    void this.ensureRows(pageId);
    if (this.ready && !this.pulled.has(pageId)) void this.refresh(pageId).catch(() => undefined);
    return () => {
      const n = (this.watched.get(pageId) ?? 1) - 1;
      if (n <= 0) this.watched.delete(pageId);
      else this.watched.set(pageId, n);
    };
  }

  /** El correo de alguien que aparece en los comentarios, si se sabe. */
  emailOf(userId: string | null): string | undefined {
    return userId ? this.authors.get(userId) : undefined;
  }

  /** Los comentarios de la página ya se bajaron del servidor en esta sesión. */
  isFresh(pageId: string): boolean {
    return this.pulled.has(pageId);
  }

  /** Por qué no se pudieron bajar los comentarios de la página (o `null`). */
  pullError(pageId: string): string | null {
    return this.pullErrors.get(pageId) ?? null;
  }

  // --- Cambios (la interfaz) ------------------------------------------------------------------------------

  /**
   * Abre un hilo (o responde, con `threadId`). Devuelve el id nuevo. `mentions`: a quién se nombró (sale detrás del
   * alta, en la misma escritura del dispositivo).
   */
  async add(pageId: string, blockId: string | null, body: string, threadId: string | null = null, mentions: MentionRef[] = []): Promise<string> {
    const text = cleanBody(body);
    if (blockId !== null && !BLOCK_ID.test(blockId)) throw new CommentInvalid(t('commentError.badBlock'));
    let block = blockId;
    if (threadId) {
      const root = this.view(pageId).get(threadId);
      if (!root || root.threadId) throw new CommentInvalid(t('commentError.threadGone'));
      // La respuesta va en el bloque del hilo (lo pide la base).
      block = root.blockId;
    }
    const id = crypto.randomUUID();
    const at = this.stamp();
    const named = this.mentionsOp(id, pageId, mentions, at);
    await this.enqueue({ kind: 'add', id, pageId, blockId: block, threadId, body: text, at }, named && named.mentions.length > 0 ? named : null);
    return id;
  }

  /**
   * Edita un comentario propio. `mentions`: el conjunto nuevo de menciones (sin pasarlo, no cambian); si es el mismo
   * que ya tiene, no se manda nada.
   */
  async edit(pageId: string, id: string, body: string, mentions?: MentionRef[]): Promise<void> {
    const text = cleanBody(body);
    const at = this.stamp();
    let named = mentions ? this.mentionsOp(id, pageId, mentions, at) : null;
    if (named && sameMentions(toRows(this.view(pageId).get(id)?.mentions ?? []), named.mentions, this.userId)) named = null;
    await this.enqueue({ kind: 'edit', id, pageId, body: text, at }, named);
  }

  /** La operación `mentions` de un comentario (sin repetidos ni uno mismo, hasta 20); `null` si la base no las tiene. */
  private mentionsOp(id: string, pageId: string, mentions: MentionRef[], at: string): Extract<CommentOp, { kind: 'mentions' }> | null {
    if (!this.mentionsReady) return null;
    const seen = new Set<string>();
    const clean: MentionRef[] = [];
    for (const m of mentions) {
      const label = cleanLabel(m.label);
      if (!UUID.test(m.userId) || m.userId === this.userId || seen.has(m.userId) || !label) continue;
      seen.add(m.userId);
      clean.push({ userId: m.userId, label });
      if (clean.length === MAX_MENTIONS) break;
    }
    return { kind: 'mentions', id, pageId, mentions: clean, at };
  }

  async remove(pageId: string, id: string): Promise<void> {
    await this.enqueue({ kind: 'delete', id, pageId, at: this.stamp() });
  }

  async resolve(pageId: string, threadId: string, resolved: boolean): Promise<void> {
    await this.enqueue({ kind: 'resolve', id: threadId, pageId, resolved, at: this.stamp() });
  }

  /**
   * Pone en la cola comentarios importados de otra herramienta (Doc_Importar_Coda.md), en el orden dado: cada
   * hilo antes que sus respuestas. Suben cuando su página llegó al servidor, como los demás. Los que ya están
   * en la cola (una importación cortada que se sigue) no se repiten, y los que el servidor ya tiene los
   * reconoce la base por el id. Un texto vacío no entra; uno más largo que el máximo se corta. Devuelve
   * cuántos quedaron en la cola.
   */
  async importComments(comments: ImportedComment[]): Promise<number> {
    if (!this.db) throw new CommentInvalid(t('commentError.off', { reason: localize(this.unavailable ?? '') }));
    const ops: Extract<CommentOp, { kind: 'import' }>[] = [];
    // Un hilo que no entra se lleva sus respuestas (sin él, la base las rechazaría).
    const skipped = new Set<string>();
    for (const c of comments) {
      const body = c.body.replace(/\r\n?/g, '\n').replace(/\s+$/u, '').replace(/^\s*\n/u, '');
      const bad = !/\S/u.test(body) || !isCommentId(c.id) || (c.blockId !== null && !BLOCK_ID.test(c.blockId));
      if (bad || (c.threadId && skipped.has(c.threadId))) {
        skipped.add(c.id);
        continue;
      }
      ops.push({
        kind: 'import',
        id: c.id,
        pageId: c.pageId,
        blockId: c.threadId ? null : c.blockId,
        threadId: c.threadId,
        body: body.length > MAX_COMMENT_LENGTH ? `${body.slice(0, MAX_COMMENT_LENGTH - 1)}…` : body,
        at: c.createdAt,
        resolvedAt: c.threadId ? null : c.resolvedAt,
        source: c.source,
        authorName: c.authorName?.trim() || null,
        authorEmail: c.authorName?.trim() ? c.authorEmail?.trim().toLowerCase() || null : null,
      });
    }
    if (ops.length === 0) return 0;
    this.writing++;
    try {
      const tx = this.db.transaction(['outbox', 'meta'], 'readwrite');
      const outbox = tx.objectStore('outbox');
      const meta = tx.objectStore('meta');
      const queued = new Map((await outbox.getAll()).filter((e) => e.op.kind === 'import').map((e) => [e.op.id, e]));
      for (const op of ops) {
        const earlier = queued.get(op.id);
        // Ya en la cola: si todavía no salió, toma el bloque de ahora (al seguir una importación la página se
        // vuelve a escribir y sus bloques cambian de id), con el texto que tenga (una edición sin mandar se
        // funde en el alta). Si ya salió, queda como está: el panel lo muestra igual, como un hilo cuyo bloque
        // ya no está.
        if (earlier) {
          if (!earlier.attempted && !earlier.failed && earlier.op.kind === 'import') {
            const next = { ...op, body: earlier.op.body };
            await outbox.put({ ...earlier, op: next });
            await meta.put(next, IMPORT_KEY + op.id);
          }
          continue;
        }
        await outbox.add({ op, attempted: false, failed: false, error: null, queuedAt: this.now() });
        await meta.put(op, IMPORT_KEY + op.id);
      }
      await tx.done;
    } finally {
      this.writing--;
    }
    await this.reloadOps();
    this.onQueued?.();
    return ops.length;
  }

  /** Vuelve a intentar lo rechazado (el botón "Retry" y cada vez que se abre la app). */
  async retryFailed(): Promise<void> {
    if (!this.db || !this.ops.some((o) => o.failed)) return;
    const tx = this.db.transaction('outbox', 'readwrite');
    for (const entry of await tx.store.getAll()) {
      if (!entry.failed) continue;
      await tx.store.put({ ...entry, failed: false, error: null });
    }
    await tx.done;
    await this.reloadOps();
    this.onQueued?.();
  }

  /**
   * Descarta a mano un cambio rechazado (nunca se hace solo). Descartar un alta descarta también lo que
   * depende de ella: sus ediciones y, si abría un hilo, las respuestas todavía sin subir.
   */
  async discard(seq: number): Promise<void> {
    if (!this.db) return;
    const tx = this.db.transaction(['outbox', 'meta'], 'readwrite');
    const store = tx.objectStore('outbox');
    const all = await store.getAll();
    const entry = all.find((e) => e.seq === seq);
    if (!entry?.failed) {
      await tx.done;
      return;
    }
    const drop = new Set<number>([seq]);
    if (isNew(entry.op)) {
      const gone = new Set([entry.op.id]);
      for (const e of all) if (isNew(e.op) && e.op.threadId === entry.op.id) gone.add(e.op.id);
      for (const e of all) if (gone.has(e.op.id)) drop.add(e.seq!);
    }
    for (const e of all) {
      if (!drop.has(e.seq!)) continue;
      await store.delete(e.seq!);
      if (e.op.kind === 'import') await tx.objectStore('meta').delete(IMPORT_KEY + e.op.id);
      if (e.op.kind === 'mentions') await forgetCopy(tx.objectStore('meta'), e.op);
    }
    await tx.done;
    await this.reloadOps();
  }

  /** Qué pasa al descartar estos cambios rechazados (para la confirmación). */
  describeDiscard(seqs: number[]): DiscardInfo {
    const entries = this.ops.filter((o) => o.failed && seqs.includes(o.seq!));
    const parts: string[] = [];
    let text: string | null = null;
    for (const e of entries) {
      const op = e.op;
      if (isNew(op)) {
        text ??= op.body;
        const replies = this.ops.filter((o) => isNew(o.op) && o.op.threadId === op.id).length;
        parts.push(replies > 0 ? t('commentDiscard.addWithReplies', { count: replies }) : t('commentDiscard.add'));
      } else if (op.kind === 'edit') {
        text ??= op.body;
        parts.push(t('commentDiscard.edit'));
      } else if (op.kind === 'delete') {
        parts.push(t('commentDiscard.delete'));
      } else if (op.kind === 'mentions') {
        parts.push(t('commentDiscard.mentions'));
      } else {
        parts.push(op.resolved ? t('commentDiscard.resolve') : t('commentDiscard.reopen'));
      }
    }
    return { message: [...new Set(parts)].join(' ') || t('commentDiscard.generic'), text };
  }

  // --- Lectura (la interfaz) ------------------------------------------------------------------------------

  /** Los hilos de la página: primero los abiertos y después los resueltos, cada grupo por fecha. */
  threads(pageId: string): CommentThread[] {
    const cached = this.cache.get(pageId);
    if (cached && cached.revision === this.revision) return cached.threads;
    const threads = buildThreads(pageId, this.view(pageId));
    this.cache.set(pageId, { revision: this.revision, threads });
    return threads;
  }

  /** Cuántos comentarios abiertos tiene cada bloque (para el indicador del margen). */
  openCounts(pageId: string): Map<string, number> {
    const counts = new Map<string, number>();
    for (const t of this.threads(pageId)) {
      if (t.resolved || !t.blockId || t.count === 0) continue;
      counts.set(t.blockId, (counts.get(t.blockId) ?? 0) + t.count);
    }
    return counts;
  }

  /** Las páginas de los cambios de comentarios sin subir o rechazados, una por cambio (P.14). */
  pendingPageIds(): string[] {
    return this.ops.map((o) => o.op.pageId);
  }

  status(): CommentStatus {
    let pending = 0;
    let failed = 0;
    for (const o of this.ops) {
      if (o.failed) failed++;
      else pending++;
    }
    return { pending, failed, error: this.lastError };
  }

  failures(): CommentFailure[] {
    return this.ops
      .filter((o) => o.failed)
      .map((o) => ({
        seq: o.seq!,
        kind: o.op.kind,
        pageId: o.op.pageId,
        body: isNew(o.op) || o.op.kind === 'edit' ? o.op.body : null,
        error: o.error ?? '',
      }));
  }

  // --- Sincronización -------------------------------------------------------------------------------------

  /**
   * Una vuelta: sube la cola en orden y baja los comentarios de las páginas abiertas. Nunca tira: un error
   * que se arregla solo queda en `status().error` y se reintenta en la próxima sincronización.
   * `isPageUnsent`: la página todavía no llegó al servidor (sus comentarios esperan).
   */
  run(isPageUnsent: (pageId: string) => boolean = () => false): Promise<void> {
    return this.serial(async () => {
      if (!this.ready || this.stopped) return;
      let error: string | null = null;
      try {
        await this.recoverIfNeeded();
        await this.push(isPageUnsent);
        const now = this.now();
        for (const pageId of [...this.watched.keys()]) {
          if (this.stopped) return;
          if (isPageUnsent(pageId)) continue;
          const due = this.dirty.has(pageId) || !this.pulled.has(pageId) || now - (this.lastPull.get(pageId) ?? 0) >= PULL_EVERY_MS;
          if (!due) continue;
          // Una página que ya no se ve (o que falla) no corta la bajada de las demás.
          const pageError = await this.pullSafely(pageId);
          if (pageError) error ??= pageError;
        }
      } catch (err) {
        // Sin red no hay nada que mostrar acá: el estado ya dice "Offline".
        error = isNetworkError(err) ? null : commentErrorText(errorMessage(err));
      }
      this.setError(error);
    });
  }

  /** Baja los comentarios de una página ya (al abrirla). */
  refresh(pageId: string): Promise<void> {
    return this.serial(async () => {
      if (!this.ready || this.stopped) return;
      await this.recoverIfNeeded();
      const error = await this.pullSafely(pageId);
      if (error) this.setError(error);
    });
  }

  /**
   * Baja una página y devuelve el error en palabras si falló de un modo que se arregla solo. Sin red, tira
   * (no tiene sentido seguir con las demás). Si la página ya no se ve, no es un error del estado.
   */
  private async pullSafely(pageId: string): Promise<string | null> {
    try {
      await this.pull(pageId);
      if (this.pullErrors.delete(pageId)) this.changed();
      return null;
    } catch (err) {
      if (isNetworkError(err)) throw err;
      const message = errorMessage(err);
      this.pullErrors.set(pageId, commentErrorText(message));
      // Se vuelve a probar a la próxima vuelta que toque (no en cada ciclo).
      this.lastPull.set(pageId, this.now());
      this.changed();
      if (isPermanent(err) && message === 'page_not_found') return null;
      return commentErrorText(message);
    }
  }

  private async push(isPageUnsent: (pageId: string) => boolean): Promise<void> {
    const waiting = new Set<string>();
    for (;;) {
      if (this.stopped) return;
      const entry = await this.claimNext(waiting, isPageUnsent);
      if (!entry) return;
      let result: unknown;
      try {
        result = await this.send(entry.op);
      } catch (err) {
        if (entry.op.kind === 'mentions' && isMissingFunction(err) && this.mentionsReady) {
          // La base dice que tiene menciones (versión 15) pero la API todavía no ve la función (recarga su caché
          // después de migrar): es pasajero, se reintenta en la próxima vuelta.
          throw new RemoteError(errorMessage(err), false, 'PGRST202');
        }
        if (entry.op.kind === 'mentions' && isGoneForMentions(err)) {
          // El comentario ya no está o no se ve (o la base no tiene menciones): no hay nada que arreglar a mano.
          await this.forget(entry);
          continue;
        }
        if (errorMessage(err) === APP_OUTDATED) {
          // La base frena los comentarios por versión (B.17) y subieron la mínima entre la consulta y el pedido: este y
          // los que siguen quedan en la cola, sin error ni rechazo, y salen al actualizar. El motor muestra el aviso.
          this.onOutdated?.();
          return;
        }
        if (!isPermanent(err)) throw err;
        await this.fail(entry, commentErrorText(errorMessage(err), entry.op.kind));
        continue;
      }
      await this.ack(entry, result);
      // Se subió algo de esta página: se baja en esta misma vuelta (fechas y autor de verdad).
      this.dirty.add(entry.op.pageId);
      if (entry.op.kind === 'add') this.onUploaded?.();
    }
  }

  /** Saca de la cola, sin error a la vista, unas menciones que ya no tienen dónde ir (y su copia en `meta`). */
  private async forget(entry: QueuedCommentOp): Promise<void> {
    if (!this.db) return;
    const tx = this.db.transaction(['outbox', 'meta'], 'readwrite');
    await tx.objectStore('outbox').delete(entry.seq!);
    if (entry.op.kind === 'mentions') await forgetCopy(tx.objectStore('meta'), entry.op);
    await tx.done;
    this.ops = this.ops.filter((o) => o.seq !== entry.seq);
    this.changed();
  }

  /**
   * El próximo cambio para mandar, marcado como intentado en la misma transacción en que se lee: así una
   * edición hecha mientras tanto nunca se funde en un alta que ya salió.
   */
  private async claimNext(
    waiting: Set<string>,
    isPageUnsent: (pageId: string) => boolean,
  ): Promise<QueuedCommentOp | null> {
    if (!this.db) return null;
    const tx = this.db.transaction('outbox', 'readwrite');
    let cursor = await tx.store.openCursor();
    let found: QueuedCommentOp | null = null;
    // Las menciones de un comentario cuya alta fue rechazada esperan con ella (al reintentarla, salen detrás).
    const rejected = new Set<string>();
    while (cursor) {
      const entry = cursor.value;
      if (entry.failed && isNew(entry.op)) rejected.add(entry.op.id);
      const held = entry.op.kind === 'mentions' && rejected.has(entry.op.id);
      if (!entry.failed && !held && !waiting.has(entry.op.pageId)) {
        // Una página creada sin red todavía no está en el servidor: lo suyo espera (y en orden).
        if (isPageUnsent(entry.op.pageId)) waiting.add(entry.op.pageId);
        else {
          found = { ...entry, attempted: true };
          if (!entry.attempted) await cursor.update(found);
          break;
        }
      }
      cursor = await cursor.continue();
    }
    await tx.done;
    if (found) this.replaceOp(found);
    return found;
  }

  private async send(op: CommentOp): Promise<unknown> {
    switch (op.kind) {
      case 'mentions':
        if (!this.remote.setCommentMentions) return null;
        return this.remote.setCommentMentions(op.id, toRows(op.mentions));
      case 'add':
        return this.remote.addComment({ id: op.id, pageId: op.pageId, blockId: op.blockId, threadId: op.threadId, body: op.body });
      case 'edit':
        return this.remote.editComment(op.id, op.body);
      case 'delete':
        return this.remote.deleteComment(op.id);
      case 'resolve':
        return this.remote.resolveThread(op.id, op.resolved);
      case 'import':
        return this.remote.importComment({
          id: op.id,
          pageId: op.pageId,
          blockId: op.blockId,
          threadId: op.threadId,
          body: op.body,
          createdAt: op.at,
          resolvedAt: op.resolvedAt,
          source: op.source,
          authorName: op.authorName,
          authorEmail: op.authorEmail,
        });
    }
  }

  /** Confirmado: sale de la cola y queda en lo guardado, así se sigue viendo hasta la próxima bajada. */
  private async ack(entry: QueuedCommentOp, result: unknown = null): Promise<void> {
    if (!this.db) return;
    const tx = this.db.transaction(['outbox', 'comments', 'meta'], 'readwrite');
    const rows = tx.objectStore('comments');
    const meta = tx.objectStore('meta');
    const current = await rows.get(entry.op.id);
    const op = entry.op;
    let next: CommentRow | null;
    if (op.kind === 'mentions') {
      // Quedan las que la base aceptó; a las demás no las avisó (solo lo ve quien escribió).
      const accepted = new Set(Array.isArray(result) ? result.filter((x): x is string => typeof x === 'string') : op.mentions.map((m) => m.userId));
      const kept = op.mentions.filter((m) => accepted.has(m.userId));
      const dropped = op.mentions.filter((m) => !accepted.has(m.userId)).map((m) => m.label);
      next = current && !current.deleted_at ? { ...current, mentions: toRows(kept) } : null;
      await forgetCopy(meta, op);
      if (dropped.length > 0) await meta.put(dropped, UNNOTIFIED_KEY + op.id);
      else await meta.delete(UNNOTIFIED_KEY + op.id);
      if (dropped.length > 0) this.unnotified.set(op.id, dropped);
      else this.unnotified.delete(op.id);
    } else {
      next = applyOp(current, op, this.userId);
    }
    if (next) await rows.put(next);
    await tx.objectStore('outbox').delete(entry.seq!);
    if (op.kind === 'import') await meta.delete(IMPORT_KEY + op.id);
    await tx.done;
    if (next) this.pageRows(entry.op.pageId)?.set(next.id, next);
    this.ops = this.ops.filter((o) => o.seq !== entry.seq);
    this.changed();
  }

  private async fail(entry: QueuedCommentOp, error: string): Promise<void> {
    if (!this.db) return;
    const failed = { ...entry, failed: true, error };
    await this.db.put('outbox', failed);
    this.replaceOp(failed);
    this.changed();
  }

  /**
   * Baja los comentarios de una página. Con `list_comments` en la base, solo lo que cambió desde la última
   * vez (el cursor, `updated_at`, se guarda con lo bajado); sin la función, la vista entera. Los correos
   * (`comment_authors`) se piden solo si aparece alguien que el dispositivo no conoce.
   */
  private async pull(pageId: string): Promise<void> {
    this.dirty.delete(pageId);
    const sinceKey = `since:${pageId}`;
    const since = this.db ? (((await this.db.get('meta', sinceKey)) as string | undefined) ?? null) : null;
    const listed = this.remote.listComments ? await this.remote.listComments(pageId, since) : null;
    const incremental = listed !== null && since !== null;
    const rows = listed ?? (await this.remote.fetchComments(pageId));
    const valid = rows.filter(isRow).filter((r) => r.page_id === pageId);
    let cursor: string | null = listed ? since : null;
    for (const r of listed ?? []) {
      const at = (r as ListedComment).updated_at;
      if (typeof at === 'string' && (cursor === null || at > cursor)) cursor = at;
    }
    const clean = valid.map((r) => {
      const { updated_at: _u, ...row } = r as ListedComment;
      return row as CommentRow;
    });
    if (this.db) {
      const tx = this.db.transaction(['comments', 'meta'], 'readwrite');
      const store = tx.objectStore('comments');
      if (!incremental) for (const key of await store.index('page').getAllKeys(pageId)) await store.delete(key);
      for (const r of clean) await store.put(r);
      if (cursor) await tx.objectStore('meta').put(cursor, sinceKey);
      else await tx.objectStore('meta').delete(sinceKey);
      await tx.done;
    }
    const map = incremental ? new Map(this.rows.get(pageId) ?? []) : new Map<string, CommentRow>();
    for (const r of clean) map.set(r.id, r);
    this.rows.set(pageId, map);
    this.pulled.add(pageId);
    this.lastPull.set(pageId, this.now());
    this.changed();

    const unknown = new Set<string>();
    for (const r of map.values()) {
      // También las mencionadas: su correo va en el tooltip de cada `@rótulo`.
      const named = Array.isArray(r.mentions) ? r.mentions.map((m) => m?.user_id) : [];
      for (const id of [r.author_id, r.resolved_by, r.deleted_by, r.imported_by, ...named]) {
        if (typeof id === 'string' && id && id !== this.userId && !this.authors.has(id)) unknown.add(id);
      }
    }
    if (unknown.size > 0) await this.pullAuthors(pageId);
  }

  private async pullAuthors(pageId: string): Promise<void> {
    const authors = (await this.remote.fetchCommentAuthors(pageId)).filter(
      (a) => typeof a?.user_id === 'string' && typeof a.email === 'string',
    );
    if (authors.length === 0) return;
    if (this.db) {
      const tx = this.db.transaction('authors', 'readwrite');
      for (const a of authors) await tx.store.put({ userId: a.user_id, email: a.email });
      await tx.done;
    }
    for (const a of authors) this.authors.set(a.user_id, a.email);
    this.changed();
  }

  /** Si cambió la generación (se restauró una copia), recupera lo propio antes de bajar nada. */
  private async recoverIfNeeded(): Promise<number> {
    if (!this.db || !this.ready || this.generation === null) return 0;
    this.knownGeneration ??= ((await this.db.get('meta', 'generation')) as number | undefined) ?? 1;
    if (this.knownGeneration === this.generation) return 0;
    const count = await this.recoverAfterRestore();
    await this.db.put('meta', this.generation, 'generation');
    this.knownGeneration = this.generation;
    return count;
  }

  private async recoverAfterRestore(): Promise<number> {
    const db = this.db!;
    const me = this.userId;
    const saved = await db.getAll('comments');
    const pages = new Set(
      saved.filter((r) => r.author_id === me || r.resolved_by === me || r.deleted_by === me || r.imported_by === me).map((r) => r.page_id),
    );
    const recovered: CommentOp[] = [];
    for (const pageId of pages) {
      let server: Map<string, CommentRow>;
      try {
        server = new Map((await this.remote.fetchComments(pageId)).map((r) => [r.id, r]));
      } catch (err) {
        // Una página que ya no se ve: lo de ella no se puede recuperar (queda en lo guardado).
        if (isPermanent(err)) continue;
        throw err;
      }
      // Primero los hilos y después las respuestas, cada grupo por fecha.
      const local = saved
        .filter((r) => r.page_id === pageId)
        .sort((a, b) => (a.thread_id === null) !== (b.thread_id === null) ? (a.thread_id === null ? -1 : 1) : a.created_at < b.created_at ? -1 : 1);
      for (const r of local) {
        const s = server.get(r.id);
        if (!s && r.imported_from && r.imported_by === me && !r.deleted_at && r.body) {
          // Lo que importó esta persona vuelve importado: con su fecha original, su autor (de afuera o ella) y
          // resuelto si lo estaba por la importación (una resolución posterior, suya, vuelve aparte).
          recovered.push({
            kind: 'import', id: r.id, pageId, blockId: r.block_id, threadId: r.thread_id, body: r.body, at: r.created_at,
            resolvedAt: r.thread_id === null && r.resolved_at && !r.resolved_by ? r.resolved_at : null,
            source: r.imported_from, authorName: r.imported_author ?? null, authorEmail: r.imported_author_email ?? null,
          });
        } else if (r.author_id === me && !r.deleted_at && r.body) {
          if (!s) {
            recovered.push({ kind: 'add', id: r.id, pageId, blockId: r.block_id, threadId: r.thread_id, body: r.body, at: r.created_at });
            // Con sus menciones (las que bajaron antes de la copia): el alta vuelve, y detrás quién se nombró.
            const named = fromRows(r.mentions);
            if (named.length > 0 && this.mentionsReady) recovered.push({ kind: 'mentions', id: r.id, pageId, mentions: named, at: r.created_at });
          } else if (!s.deleted_at && s.body !== r.body && r.edited_at && (!s.edited_at || r.edited_at > s.edited_at)) {
            recovered.push({ kind: 'edit', id: r.id, pageId, body: r.body, at: r.edited_at });
          }
        }
        if (r.deleted_by === me && r.deleted_at && s && !s.deleted_at) {
          recovered.push({ kind: 'delete', id: r.id, pageId, at: r.deleted_at });
        }
        const reAdded = !s && (r.author_id === me || (r.imported_from && r.imported_by === me)) && !r.deleted_at && !!r.body;
        if (r.thread_id === null && r.resolved_at && r.resolved_by === me && (s ? !s.resolved_at : reAdded)) {
          recovered.push({ kind: 'resolve', id: r.id, pageId, resolved: true, at: r.resolved_at });
        }
      }
    }
    // Lo bajado antes de la copia ya no vale como punto de partida: la próxima bajada es entera.
    const tx = db.transaction(['outbox', 'meta'], 'readwrite');
    const meta = tx.objectStore('meta');
    for (const key of await meta.getAllKeys()) if (typeof key === 'string' && key.startsWith('since:')) await meta.delete(key);
    if (recovered.length > 0) {
      // Lo recuperado es más viejo que lo que ya estaba en la cola: va antes.
      const outbox = tx.objectStore('outbox');
      const existing = await outbox.getAll();
      const already = new Set(existing.map((e) => `${e.op.kind}:${e.op.id}`));
      await outbox.clear();
      for (const op of recovered) {
        if (already.has(`${op.kind}:${op.id}`)) continue;
        await outbox.add({ op, attempted: true, failed: false, error: null, queuedAt: this.now() });
      }
      for (const { seq: _s, ...e } of existing) await outbox.add(e);
    }
    await tx.done;
    await this.reloadOps();
    return recovered.length;
  }

  // --- La cola en el dispositivo --------------------------------------------------------------------------

  /**
   * Guarda un cambio en la cola. Antes de sumarlo, lo junta con lo que todavía no salió:
   * - una edición de un comentario cuya alta no se intentó mandar se funde en el alta (la base daría
   *   `comment_conflict` si el alta llegara con otro texto); si no, reemplaza una edición anterior sin mandar;
   * - borrar un comentario que nunca salió lo saca de la cola (salvo que tenga respuestas esperando);
   * - resolver y reabrir sin mandar se queda con lo último.
   */
  /** Cambios que se están guardando en el dispositivo (todavía solo en memoria). */
  private writing = 0;

  /** Hay un comentario que todavía no llegó a la base del dispositivo (se perdería al recargar). */
  hasUnsavedWrites(): boolean {
    return this.writing > 0;
  }

  private async enqueue(op: CommentOp, mentions: Extract<CommentOp, { kind: 'mentions' }> | null = null): Promise<void> {
    this.writing++;
    try {
      await this.enqueueNow(op, mentions);
    } finally {
      this.writing--;
    }
  }

  /** `mentions`: las menciones del alta o la edición, que entran detrás en la misma transacción. */
  private async enqueueNow(op: CommentOp, mentions: Extract<CommentOp, { kind: 'mentions' }> | null = null): Promise<void> {
    if (!this.db) throw new CommentInvalid(t('commentError.off', { reason: localize(this.unavailable ?? '') }));
    const tx = this.db.transaction(['outbox', 'meta'], 'readwrite');
    const store = tx.objectStore('outbox');
    const all = await store.getAll();
    // Sacar de la cola un importado que no salió (se borró antes de subir) lo olvida también en `meta`.
    const drop = async (e: QueuedCommentOp) => {
      await store.delete(e.seq!);
      if (e.op.kind === 'import') await tx.objectStore('meta').delete(IMPORT_KEY + e.op.id);
      if (e.op.kind === 'mentions') await tx.objectStore('meta').delete(MENTIONS_KEY + e.op.id);
    };
    const open = (e: QueuedCommentOp) => !e.attempted && !e.failed && e.op.id === op.id;
    let done = false;
    if (op.kind === 'edit') {
      const add = all.find((e) => open(e) && isNew(e.op));
      const edit = all.find((e) => open(e) && e.op.kind === 'edit');
      if (add && isNew(add.op)) {
        const merged = { ...add.op, body: op.body };
        await store.put({ ...add, op: merged });
        if (merged.kind === 'import') await tx.objectStore('meta').put(merged, IMPORT_KEY + merged.id);
        done = true;
      } else if (edit) {
        await store.put({ ...edit, op });
        done = true;
      }
    } else if (op.kind === 'delete') {
      const add = all.find((e) => open(e) && isNew(e.op));
      const replies = all.some((e) => isNew(e.op) && e.op.threadId === op.id);
      // Un alta rechazada nunca llegó al servidor: borrarla es sacarla de la cola, con lo que depende de ella.
      const rejected = all.find((e) => e.failed && isNew(e.op) && e.op.id === op.id);
      if (rejected) {
        const gone = new Set([op.id]);
        for (const e of all) if (isNew(e.op) && e.op.threadId === op.id) gone.add(e.op.id);
        for (const e of all) if (gone.has(e.op.id)) await drop(e);
        done = true;
      } else if (add && !replies) {
        for (const e of all) if (e.op.id === op.id && !e.attempted && !e.failed) await drop(e);
        done = true;
      } else {
        // Una edición (o unas menciones) sin mandar de algo que se borra ya no hace falta.
        for (const e of all) if (open(e) && (e.op.kind === 'edit' || e.op.kind === 'mentions')) await drop(e);
      }
    } else if (op.kind === 'resolve') {
      const same = all.find((e) => open(e) && e.op.kind === 'resolve');
      if (same) {
        await store.put({ ...same, op });
        done = true;
      }
    }
    if (!done) {
      await store.add({ op, attempted: false, failed: false, error: null, queuedAt: this.now() });
    }
    if (mentions) {
      // Unas menciones sin mandar del mismo comentario se reemplazan (queda la última); si no, van detrás.
      const same = all.find((e) => open(e) && e.op.kind === 'mentions');
      if (same) await store.put({ ...same, op: mentions });
      else await store.add({ op: mentions, attempted: false, failed: false, error: null, queuedAt: this.now() });
      await tx.objectStore('meta').put(mentions, MENTIONS_KEY + mentions.id);
    }
    await tx.done;
    await this.reloadOps();
    this.onQueued?.();
  }

  private async reloadOps(): Promise<void> {
    if (!this.db) return;
    this.ops = (await this.db.getAll('outbox')).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    this.changed();
  }

  private replaceOp(entry: QueuedCommentOp): void {
    this.ops = this.ops.map((o) => (o.seq === entry.seq ? entry : o));
  }

  private pageRows(pageId: string): Map<string, CommentRow> | undefined {
    return this.rows.get(pageId);
  }

  private ensureRows(pageId: string): Promise<void> {
    if (this.rows.has(pageId) || !this.db) {
      if (!this.rows.has(pageId)) this.rows.set(pageId, new Map());
      return Promise.resolve();
    }
    let loading = this.loadingRows.get(pageId);
    if (!loading) {
      loading = this.db
        .getAllFromIndex('comments', 'page', pageId)
        .then((rows) => {
          // Si mientras tanto llegó la bajada del servidor, gana esa.
          if (!this.rows.has(pageId)) this.rows.set(pageId, new Map(rows.map((r) => [r.id, r])));
          this.changed();
        })
        .catch(() => undefined)
        .finally(() => this.loadingRows.delete(pageId));
      this.loadingRows.set(pageId, loading);
    }
    return loading;
  }

  /** Lo guardado con la cola encima. */
  private view(pageId: string): Map<string, ViewWithResolution> {
    const out = new Map<string, ViewWithResolution>();
    for (const r of this.rows.get(pageId)?.values() ?? []) out.set(r.id, fromRow(r));
    const resolutions = new Map<string, { at: string | null; by: string | null }>();
    for (const entry of this.ops) {
      const op = entry.op;
      if (op.pageId !== pageId) continue;
      let c = out.get(op.id);
      if (isNew(op) && !c) {
        c = { ...fromRow(newRow(op, this.userId)), local: true };
        out.set(op.id, c);
      }
      if (!c) continue;
      c.pending = true;
      if (entry.failed) {
        // Un cambio rechazado no se aplica: se ve el comentario como está, con el motivo (el alta, que solo
        // existe acá, sí se ve).
        c.error = entry.error ?? t('commentError.rejected');
        c.failedSeqs.push(entry.seq!);
        c.failedKinds.push(op.kind);
        if (isNew(op) || op.kind === 'edit') c.rejectedText ??= op.body;
        if (!isNew(op)) continue;
      }
      if (op.kind === 'edit' && !c.deleted) {
        c.body = op.body;
        c.editedAt = op.at;
      } else if (op.kind === 'delete') {
        c.deleted = true;
        c.body = '';
      } else if (op.kind === 'resolve') {
        resolutions.set(op.id, op.resolved ? { at: op.at, by: this.userId } : { at: null, by: null });
      } else if (op.kind === 'mentions' && !c.deleted) {
        c.mentions = op.mentions;
      }
    }
    for (const [id, r] of resolutions) {
      const c = out.get(id);
      if (c) Object.assign(c, { resolvedAt: r.at, resolvedBy: r.by });
    }
    for (const [id, labels] of this.unnotified) {
      const c = out.get(id);
      if (c && c.authorId === this.userId && !c.deleted) c.unnotified = labels;
    }
    return out;
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private setError(error: string | null): void {
    if (this.lastError === error) return;
    this.lastError = error;
    this.changed();
  }

  private stamp(): string {
    return new Date(this.now()).toISOString();
  }

  private changed(): void {
    this.revision++;
    for (const fn of this.listeners) fn();
    this.onChange?.();
  }
}

export type ViewWithResolution = CommentView & { resolvedAt?: string | null; resolvedBy?: string | null };

export function fromRow(r: CommentRow): ViewWithResolution {
  return {
    id: r.id,
    pageId: r.page_id,
    blockId: r.block_id,
    threadId: r.thread_id,
    body: r.deleted_at ? '' : (r.body ?? ''),
    authorId: r.author_id,
    importedFrom: r.imported_from ?? null,
    importedAuthor: r.imported_author ?? null,
    importedAuthorEmail: r.imported_author_email ?? null,
    importedBy: r.imported_by ?? null,
    linkAuthor: r.plink_author ?? null,
    createdAt: r.created_at,
    editedAt: r.edited_at,
    deleted: !!r.deleted_at,
    pending: false,
    local: false,
    error: null,
    failedSeqs: [],
    failedKinds: [],
    rejectedText: null,
    mentions: r.deleted_at ? [] : fromRows(r.mentions),
    unnotified: [],
    resolvedAt: r.resolved_at,
    resolvedBy: r.resolved_by,
  };
}

type NewOp = Extract<CommentOp, { kind: 'add' | 'import' }>;

/** Un alta: un comentario nuevo de la persona o uno importado. */
function isNew(op: CommentOp): op is NewOp {
  return op.kind === 'add' || op.kind === 'import';
}

/** La fila que deja un alta (hasta que la bajada traiga la de verdad). */
function newRow(op: NewOp, userId: string): CommentRow {
  const imported = op.kind === 'import';
  const external = imported && op.authorName !== null;
  return {
    id: op.id,
    page_id: op.pageId,
    block_id: op.blockId,
    thread_id: op.threadId,
    body: op.body,
    author_id: external ? null : userId,
    created_at: op.at,
    edited_at: null,
    resolved_at: imported && !op.threadId ? op.resolvedAt : null,
    resolved_by: null,
    deleted_at: null,
    deleted_by: null,
    imported_from: imported ? op.source : null,
    imported_author: external ? op.authorName : null,
    imported_author_email: external ? op.authorEmail : null,
    imported_by: imported ? userId : null,
  };
}

/** Un cambio confirmado, aplicado a lo guardado (hasta que la próxima bajada traiga la fila de verdad). */
function applyOp(row: CommentRow | undefined, op: CommentOp, userId: string): CommentRow | null {
  if (isNew(op)) return row ?? newRow(op, userId);
  if (!row) return null;
  switch (op.kind) {
    case 'edit':
      return row.deleted_at || row.body === op.body ? row : { ...row, body: op.body, edited_at: op.at };
    case 'delete':
      return row.deleted_at ? row : { ...row, body: null, deleted_at: op.at, deleted_by: userId };
    case 'resolve':
      if (op.resolved === !!row.resolved_at) return row;
      return op.resolved ? { ...row, resolved_at: op.at, resolved_by: userId } : { ...row, resolved_at: null, resolved_by: null };
    case 'mentions':
      return row.deleted_at ? row : { ...row, mentions: toRows(op.mentions) };
  }
}

// --- Menciones ------------------------------------------------------------------------------------------------

/**
 * El rótulo de una mención como lo acepta la base: sin espacios, controles, comillas, @ ni los caracteres invisibles
 * que la base rechaza (los mismos que en el nombre de un visitante del link), hasta 64.
 */
export function cleanLabel(label: string): string {
  // eslint-disable-next-line no-control-regex, no-misleading-character-class
  return label.replace(/[\s\u0000-\u001f\u007f"@\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2069\ufeff]/gu, '').slice(0, 64);
}

/** El rótulo que propone la lista para un correo (como `private.mention_label` de la base). */
export function labelForEmail(email: string): string {
  return cleanLabel(email.split('@')[0] ?? '') || 'user';
}

function toRows(mentions: MentionRef[]): { user_id: string; label: string }[] {
  return mentions.map((m) => ({ user_id: m.userId, label: m.label }));
}

function fromRows(rows: unknown): MentionRef[] {
  if (!Array.isArray(rows)) return [];
  const out: MentionRef[] = [];
  for (const r of rows as { user_id?: unknown; label?: unknown }[]) {
    if (r && typeof r.user_id === 'string' && typeof r.label === 'string') out.push({ userId: r.user_id, label: r.label });
  }
  return out;
}

/** Las mismas personas (sin contar a uno mismo, que la base descarta siempre). */
function sameMentions(rows: { user_id: string }[], mentions: MentionRef[], me: string): boolean {
  const a = new Set(rows.map((r) => r.user_id).filter((id) => id !== me));
  const b = new Set(mentions.map((m) => m.userId).filter((id) => id !== me));
  return a.size === b.size && [...a].every((id) => b.has(id));
}

/** Un rechazo de unas menciones que no tiene arreglo a mano: el comentario no está, se borró, o la base no las tiene. */
function isGoneForMentions(err: unknown): boolean {
  const message = errorMessage(err);
  return (isPermanent(err) && (message === 'comment_not_found' || message === 'comment_deleted')) || isMissingFunction(err);
}

/** La API no tiene la función (base sin migrar, o caché de la API todavía sin recargar). */
function isMissingFunction(err: unknown): boolean {
  return err instanceof RemoteError && err.code === 'PGRST202';
}

/**
 * Olvida la copia en `meta` de unas menciones solo si es la de esta operación (mismo momento y mismo conjunto): si
 * mientras tanto se guardaron otras más nuevas del mismo comentario, esa copia queda (es la que recupera una versión
 * vieja que saque la cola).
 */
async function forgetCopy(
  meta: { get(key: string): Promise<unknown>; delete(key: string): Promise<void> },
  op: Extract<CommentOp, { kind: 'mentions' }>,
): Promise<void> {
  const saved = (await meta.get(MENTIONS_KEY + op.id)) as CommentOp | undefined;
  if (!saved || (saved.kind === 'mentions' && saved.at === op.at && sameMentionList(saved.mentions, op.mentions))) {
    await meta.delete(MENTIONS_KEY + op.id);
  }
}

function sameMentionList(a: MentionRef[], b: MentionRef[]): boolean {
  return a.length === b.length && a.every((m, i) => m.userId === b[i].userId && m.label === b[i].label);
}

function byDate(a: { createdAt: string; id: string }, b: { createdAt: string; id: string }): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1;
}

export function buildThreads(pageId: string, view: Map<string, ViewWithResolution>): CommentThread[] {
  const replies = new Map<string, CommentView[]>();
  for (const c of view.values()) {
    if (!c.threadId) continue;
    const list = replies.get(c.threadId) ?? [];
    list.push(c);
    replies.set(c.threadId, list);
  }
  const threads: CommentThread[] = [];
  for (const root of view.values()) {
    if (root.threadId) continue;
    const all = (replies.get(root.id) ?? []).sort(byDate);
    const live = all.filter((r) => !r.deleted || r.pending || r.error);
    const count = (root.deleted ? 0 : 1) + all.filter((r) => !r.deleted).length;
    // Un hilo con todo borrado (y nada por subir) no se muestra.
    if (count === 0 && !root.pending && !live.some((r) => r.pending)) continue;
    const members = [root, ...all];
    threads.push({
      id: root.id,
      pageId,
      blockId: root.blockId,
      root,
      replies: live.filter((r) => !r.deleted || r.error),
      resolved: !!root.resolvedAt,
      resolvedAt: root.resolvedAt ?? null,
      resolvedBy: root.resolvedBy ?? null,
      count,
      pending: members.some((m) => m.pending),
      error: members.find((m) => m.error)?.error ?? null,
    });
  }
  return threads.sort((a, b) => (a.resolved !== b.resolved ? (a.resolved ? 1 : -1) : byDate(a.root, b.root)));
}

/** Un id de comentario válido (uuid). */
export function isCommentId(value: string): boolean {
  return UUID.test(value);
}

// --- Lo sin subir (si sacan a alguien del workspace) ---------------------------------------------------

/** Cuántos cambios de comentarios hay sin subir (también los rechazados), leído directo de la base. */
export async function unsyncedComments(db: CommentsDb | null): Promise<number> {
  return db ? db.count('outbox') : 0;
}

/** La cola entera, para el archivo con lo que no se subió. */
export async function exportComments(db: CommentsDb | null): Promise<unknown[]> {
  if (!db) return [];
  return (await db.getAll('outbox')).map((e) => ({
    ...e.op,
    rejected: e.failed ? e.error : null,
  }));
}
