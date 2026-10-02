import { errorMessage, isNetworkError } from './types';
import { labelForEmail, type CommentQueue, type CommentsDb } from './comments';

// La campana de las menciones (Docs/Doc_Menciones.md, sección 5): cuántas sin leer, la lista, leer y "Mark all as
// read". Pregunta al workspace abierto al abrir, cada 60 segundos con la ventana a la vista, al volver a la ventana o
// a la red y después de subir un comentario propio; con la ventana oculta, no. Sin Realtime.
//
// Lo bajado se guarda en la base de comentarios del dispositivo (`meta`, sin cambiar su versión): `inbox` (hasta 200
// menciones, la fecha hasta la que bajó y la hora de la última pregunta), `inbox:read` (las marcas de leídas que
// todavía no subieron: no cuentan como cambios sin sincronizar, perderlas solo deja una mención sin leer) y
// `mentionCandidates:<página>` (la lista del `@` de cada página, para mencionar sin red).
//
// Entrega 2 (ME2): al dueño y a los admins que pueden compartir la página, la base les suma a quienes NO la ven
// (`has_access = false`). Esas filas quedan solo en memoria: compartir pide red, y una versión anterior de la app que
// leyera la lista guardada las ofrecería como si vieran la página.

/** Cada cuánto pregunta con la ventana a la vista (ME5). */
export const INBOX_EVERY_MS = 60_000;
/** Cuántas guarda el dispositivo (como el índice liviano de la base). */
export const INBOX_KEEP = 200;
/** Filas por pregunta (la base da como mucho 50). */
export const INBOX_PAGE = 30;
/** La base cuenta las sin leer hasta acá (la campana muestra 9+). */
export const UNREAD_CAP = 10;
/** Margen sobre la última fecha bajada: una mención escrita justo antes de la pregunta anterior no se pierde. */
const SINCE_MARGIN_MS = 10_000;
/** La lista del `@` de una página se vuelve a pedir como mucho cada 5 minutos. */
export const CANDIDATES_EVERY_MS = 5 * 60_000;

const INBOX_KEY = 'inbox';
const READ_KEY = 'inbox:read';
const CANDIDATES_KEY = 'mentionCandidates:';

/** Una mención para la campana. */
export interface MentionItem {
  id: string;
  commentId: string;
  pageId: string;
  /** El hilo del comentario (`null`: el comentario abre el hilo). */
  threadId: string | null;
  blockId: string | null;
  label: string;
  mentionedBy: string | null;
  mentionedByEmail: string | null;
  /** El comienzo del comentario (hasta 280 caracteres). */
  snippet: string;
  resolved: boolean;
  pageTitle: string;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
  read: boolean;
}

/** Alguien de la lista del `@`. */
export interface MentionCandidate {
  userId: string;
  email: string;
  label: string;
  /** `false`: no ve la página (solo le llega al dueño y a los admins que pueden compartirla, ME2). */
  hasAccess?: boolean;
}

/** Lo que devuelve `mentions_inbox`. */
export interface InboxResponse {
  now: string;
  unread: number;
  rows: Record<string, unknown>[];
}

/** Lo que la campana le pide a la base (20261015120000_menciones.sql). Las pruebas usan el servidor en memoria. */
export interface MentionsRemote {
  mentionsInbox(since: string | null, limit: number): Promise<InboxResponse>;
  /** Las últimas 200 como `[id, gone, leída]`. */
  mentionsIndex(): Promise<[string, boolean, boolean][]>;
  markMentionsRead(ids: string[] | null, upTo: string | null): Promise<number>;
  mentionCandidates(pageId: string): Promise<MentionCandidate[]>;
  /** `share_for_mention` (20261016120000_menciones_e2.sql): *Can comment* sobre esa página. `true` si compartió. */
  shareForMention(pageId: string, userId: string): Promise<boolean>;
}

interface SavedInbox {
  items: MentionItem[];
  /** Hasta qué fecha (`updated_at`) se bajó. */
  since: string | null;
  /** La hora del servidor de la última respuesta (para "Mark all as read"). */
  serverNow: string | null;
  /** Cuándo se preguntó por última vez con éxito (hora del dispositivo). */
  checkedAt: number | null;
}

interface PendingReads {
  ids: string[];
  upTo: string | null;
}

export interface InboxSnapshot {
  /** La base del workspace tiene menciones y hay campana. */
  ready: boolean;
  items: MentionItem[];
  /** Las sin leer que se ven, hasta 10 (la campana muestra 9+). */
  unread: number;
  checkedAt: number | null;
  /** Ya se leyó lo guardado en el dispositivo. */
  loaded: boolean;
}

const EMPTY: InboxSnapshot = { ready: false, items: [], unread: 0, checkedAt: null, loaded: false };

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** Una fila de `mentions_inbox` (sin `gone`), o `null` si no tiene la forma. */
export function parseMention(r: Record<string, unknown>): MentionItem | null {
  const id = str(r.id);
  const commentId = str(r.comment_id);
  const pageId = str(r.page_id);
  const createdAt = str(r.created_at);
  const updatedAt = str(r.updated_at);
  if (!id || !commentId || !pageId || !createdAt || !updatedAt) return null;
  return {
    id,
    commentId,
    pageId,
    threadId: str(r.thread_id),
    blockId: str(r.block_id),
    label: str(r.label) ?? '',
    mentionedBy: str(r.mentioned_by),
    mentionedByEmail: str(r.mentioned_by_email),
    snippet: str(r.snippet) ?? '',
    resolved: r.resolved === true,
    pageTitle: str(r.page_title) ?? '',
    projectId: str(r.project_id),
    createdAt,
    updatedAt,
    read: r.read_at != null,
  };
}

export class MentionsInbox {
  private saved: SavedInbox = { items: [], since: null, serverNow: null, checkedAt: null };
  private reads: PendingReads = { ids: [], upTo: null };
  private readonly candidates = new Map<string, { at: number; list: MentionCandidate[] }>();
  /** Quienes no ven cada página (ME2), solo en memoria. */
  private readonly outsiders = new Map<string, MentionCandidate[]>();
  private readonly fetching = new Map<string, Promise<void>>();
  private readonly listeners = new Set<() => void>();
  private snapshot: InboxSnapshot = EMPTY;
  private loaded = false;
  private chain: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | null = null;
  private wasReady = false;
  private stopped = false;
  private readonly unwatch: () => void;
  private readonly cleanups: (() => void)[] = [];

  constructor(
    private readonly db: CommentsDb | null,
    private readonly remote: MentionsRemote,
    private readonly comments: CommentQueue,
    private readonly options: { now?: () => number; online?: () => boolean } = {},
  ) {
    // Cuando la base del workspace llega a la versión 15 (o se sabe que la tiene), se pregunta ya.
    this.unwatch = comments.subscribe(() => {
      const ready = comments.mentionsReady;
      if (ready !== this.wasReady) {
        this.wasReady = ready;
        this.publish();
        if (ready) void this.poll();
      }
    });
    this.wasReady = comments.mentionsReady;
    comments.onUploaded = () => void this.poll();
  }

  private get now(): number {
    return (this.options.now ?? Date.now)();
  }

  get ready(): boolean {
    return this.comments.mentionsReady && !this.stopped;
  }

  async load(): Promise<void> {
    if (!this.db) {
      this.loaded = true;
      this.publish();
      return;
    }
    try {
      const [inbox, reads] = await Promise.all([this.db.get('meta', INBOX_KEY), this.db.get('meta', READ_KEY)]);
      const i = inbox as Partial<SavedInbox> | undefined;
      if (i && Array.isArray(i.items)) {
        this.saved = {
          items: i.items.filter((x) => x && typeof x.id === 'string'),
          since: typeof i.since === 'string' ? i.since : null,
          serverNow: typeof i.serverNow === 'string' ? i.serverNow : null,
          checkedAt: typeof i.checkedAt === 'number' ? i.checkedAt : null,
        };
      }
      const r = reads as Partial<PendingReads> | undefined;
      if (r && Array.isArray(r.ids)) this.reads = { ids: r.ids.filter((x) => typeof x === 'string'), upTo: typeof r.upTo === 'string' ? r.upTo : null };
      const keys = (await this.db.getAllKeys('meta')).filter((k): k is string => typeof k === 'string' && k.startsWith(CANDIDATES_KEY));
      for (const key of keys) {
        const c = (await this.db.get('meta', key)) as { at?: unknown; list?: unknown } | undefined;
        if (c && typeof c.at === 'number' && Array.isArray(c.list)) this.candidates.set(key.slice(CANDIDATES_KEY.length), { at: c.at, list: c.list as MentionCandidate[] });
      }
    } catch {
      // Lo guardado no se pudo leer: la campana arranca vacía y baja de nuevo.
    }
    this.loaded = true;
    this.publish();
  }

  /** Empieza a preguntar: ya, cada 60 s con la ventana a la vista, al volver a la ventana y al volver la red. */
  start(): void {
    if (this.timer || this.stopped) return;
    const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
    this.timer = setInterval(() => {
      if (visible()) void this.poll();
    }, INBOX_EVERY_MS);
    if (typeof document !== 'undefined') {
      const onVisible = () => {
        if (visible()) void this.poll();
      };
      document.addEventListener('visibilitychange', onVisible);
      this.cleanups.push(() => document.removeEventListener('visibilitychange', onVisible));
    }
    if (typeof window !== 'undefined') {
      const onOnline = () => void this.poll();
      window.addEventListener('online', onOnline);
      this.cleanups.push(() => window.removeEventListener('online', onOnline));
    }
    void this.poll();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const fn of this.cleanups.splice(0)) fn();
    this.unwatch();
    if (this.comments.onUploaded) this.comments.onUploaded = undefined;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): InboxSnapshot => this.snapshot;

  /** Hay una mención sin leer en esta página (el punto del botón de comentarios). */
  unreadOn(pageId: string): boolean {
    return this.snapshot.items.some((m) => !m.read && m.pageId === pageId);
  }

  // --- Preguntar ----------------------------------------------------------------------------------------------

  /**
   * Una pregunta: sube las leídas pendientes, baja lo cambiado desde la última vez y, si el número de la base no
   * coincide con el del dispositivo (los dos hasta 10), concilia con el índice liviano. Nunca tira: sin red o con un
   * error, queda lo guardado.
   */
  poll(): Promise<void> {
    return this.serial(async () => {
      if (!this.ready) return;
      try {
        await this.flushReads();
        const res = await this.remote.mentionsInbox(this.saved.since, INBOX_PAGE);
        this.merge(res.rows);
        this.saved.serverNow = typeof res.now === 'string' ? res.now : this.saved.serverNow;
        this.saved.checkedAt = this.now;
        // Si la página vino llena puede faltar algo del medio: la próxima vez, desde cero (las 30 más nuevas).
        if (res.rows.length >= INBOX_PAGE) this.saved.since = null;
        if (Math.min(Number(res.unread) || 0, UNREAD_CAP) !== this.localUnread()) await this.reconcile();
        await this.save();
      } catch (err) {
        if (!isNetworkError(err)) console.warn('[menciones] no se pudo preguntar:', errorMessage(err));
      }
      this.publish();
    });
  }

  /** Abrir la campana: lo cambiado y el índice liviano (sin volver a bajar los textos). */
  open(): Promise<void> {
    return this.poll().then(() =>
      this.serial(async () => {
        if (!this.ready) return;
        try {
          await this.reconcile();
          await this.save();
        } catch (err) {
          if (!isNetworkError(err)) console.warn('[menciones] no se pudo conciliar:', errorMessage(err));
        }
        this.publish();
      }),
    );
  }

  private merge(rows: Record<string, unknown>[]): void {
    const byId = new Map(this.saved.items.map((m) => [m.id, m]));
    let since = this.saved.since;
    for (const r of rows) {
      const id = str(r.id);
      const at = str(r.updated_at);
      if (!id) continue;
      if (at && (!since || at > since)) since = at;
      if (r.gone === true) {
        byId.delete(id);
        continue;
      }
      const item = parseMention(r);
      if (!item) continue;
      // Una marca de leída que todavía no subió gana sobre lo que bajó.
      if (this.pendingRead(item)) item.read = true;
      byId.set(id, item);
    }
    this.saved.items = [...byId.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)).slice(0, INBOX_KEEP);
    this.saved.since = since ? new Date(Date.parse(since) - SINCE_MARGIN_MS).toISOString() : null;
  }

  /** Saca lo que ya no se ve y corrige las leídas con el índice; si falta texto de algo que se ve, lo baja. */
  private async reconcile(): Promise<void> {
    const index = await this.remote.mentionsIndex();
    const state = new Map<string, { gone: boolean; read: boolean }>();
    for (const e of index) if (Array.isArray(e) && typeof e[0] === 'string') state.set(e[0], { gone: e[1] === true, read: e[2] === true });
    const kept: MentionItem[] = [];
    for (const m of this.saved.items) {
      const s = state.get(m.id);
      // Fuera del índice: con el índice lleno (200) puede ser más vieja, y queda como está; si no, ya no existe.
      if (!s) {
        if (index.length >= INBOX_KEEP) kept.push(m);
        continue;
      }
      if (s.gone) continue;
      kept.push({ ...m, read: s.read || this.pendingRead(m) });
    }
    this.saved.items = kept;
    const known = new Set(kept.map((m) => m.id));
    const missing = [...state].some(([id, s]) => !s.gone && !known.has(id));
    if (missing) {
      const res = await this.remote.mentionsInbox(null, 50);
      this.merge(res.rows);
    }
  }

  // --- Leídas -------------------------------------------------------------------------------------------------

  /** Marca leídas estas menciones (abrir una, ver su hilo). Se guarda primero en el dispositivo. */
  markRead(ids: string[]): Promise<void> {
    const fresh = ids.filter((id) => this.saved.items.some((m) => m.id === id && !m.read));
    if (fresh.length === 0) return Promise.resolve();
    return this.serial(async () => {
      this.saved.items = this.saved.items.map((m) => (fresh.includes(m.id) ? { ...m, read: true } : m));
      this.reads = { ...this.reads, ids: [...new Set([...this.reads.ids, ...fresh])].slice(-500) };
      await this.save();
      this.publish();
      await this.flushReads().catch(() => undefined);
    });
  }

  /** Las de los hilos que se ven en el panel de la página. */
  markThreadsRead(pageId: string, threadIds: Set<string>): Promise<void> {
    const ids = this.saved.items
      .filter((m) => !m.read && m.pageId === pageId && threadIds.has(m.threadId ?? m.commentId))
      .map((m) => m.id);
    return this.markRead(ids);
  }

  /** "Mark all as read": todas las creadas hasta la última respuesta del servidor. */
  markAllRead(): Promise<void> {
    return this.serial(async () => {
      const newest = this.saved.items.reduce<string | null>((max, m) => (!max || m.createdAt > max ? m.createdAt : max), null);
      const upTo = [this.saved.serverNow, newest, this.reads.upTo].filter((x): x is string => !!x).sort().pop() ?? null;
      this.saved.items = this.saved.items.map((m) => ({ ...m, read: true }));
      if (upTo) this.reads = { ...this.reads, upTo };
      await this.save();
      this.publish();
      await this.flushReads().catch(() => undefined);
    });
  }

  private pendingRead(m: MentionItem): boolean {
    return this.reads.ids.includes(m.id) || (!!this.reads.upTo && m.createdAt <= this.reads.upTo);
  }

  /** Sube las marcas pendientes; repetirlas no cambia nada. Sin red, quedan para la próxima. */
  private async flushReads(): Promise<void> {
    if (!this.ready || (this.reads.ids.length === 0 && !this.reads.upTo)) return;
    const sent = this.reads;
    await this.remote.markMentionsRead(sent.ids.length > 0 ? sent.ids : null, sent.upTo);
    // Lo que se marcó mientras tanto queda para la próxima.
    this.reads = {
      ids: this.reads.ids.filter((id) => !sent.ids.includes(id)),
      upTo: this.reads.upTo === sent.upTo ? null : this.reads.upTo,
    };
    await this.saveReads();
  }

  // --- La lista del `@` ---------------------------------------------------------------------------------------

  /**
   * La lista del `@` de una página: la guardada o, sin ninguna, los autores conocidos de la página (la base los vuelve
   * a revisar al subir). Para tenerla al día, `refreshIfStale` al abrir el campo.
   */
  candidatesFor(pageId: string, fallback: () => MentionCandidate[]): MentionCandidate[] {
    return this.candidates.get(pageId)?.list ?? fallback();
  }

  /** Quienes no ven la página y se le pueden compartir desde la mención (ME2); vacía para el resto. */
  outsidersFor(pageId: string): MentionCandidate[] {
    return this.outsiders.get(pageId) ?? [];
  }

  /**
   * Comparte la página con *Can comment* con quien no la ve, para mencionarlo (ME2). Pide red; si falla, tira. Al
   * volver, la persona pasa a la lista con acceso (y se pide la lista de nuevo).
   */
  async shareForMention(pageId: string, who: MentionCandidate): Promise<void> {
    await this.remote.shareForMention(pageId, who.userId);
    const person: MentionCandidate = { userId: who.userId, email: who.email, label: who.label };
    this.outsiders.set(pageId, this.outsidersFor(pageId).filter((c) => c.userId !== who.userId));
    const saved = this.candidates.get(pageId);
    if (saved && !saved.list.some((c) => c.userId === who.userId)) {
      this.candidates.set(pageId, { at: saved.at, list: [...saved.list, person] });
    }
    this.publish(true);
    await this.refreshCandidates(pageId, true);
  }

  /** La pide de nuevo si no hay o tiene más de 5 minutos (y hay red). Avisa a los suscriptos cuando llega. */
  refreshIfStale(pageId: string): Promise<void> {
    const saved = this.candidates.get(pageId);
    if (!this.ready || (saved && this.now - saved.at < CANDIDATES_EVERY_MS)) return Promise.resolve();
    return this.refreshCandidates(pageId);
  }

  /** La lista ya se pidió alguna vez (guardada en el dispositivo). */
  hasCandidates(pageId: string): boolean {
    return this.candidates.has(pageId);
  }

  /** Pide la lista del `@` de la página ya (si hay red); la que esté en curso se comparte. */
  refreshCandidates(pageId: string, again = false): Promise<void> {
    if (this.options.online && !this.options.online()) return Promise.resolve();
    let running = this.fetching.get(pageId);
    // `again`: lo que estaba en curso salió antes de un cambio (compartir): se pide otra vez después.
    if (running) return again ? running.then(() => this.refreshCandidates(pageId)) : running;
    running = (async () => {
      try {
        const rows = (await this.remote.mentionCandidates(pageId)).filter(
          (c) => typeof c?.userId === 'string' && typeof c.email === 'string',
        );
        const person = (c: MentionCandidate): MentionCandidate => ({ userId: c.userId, email: c.email, label: c.label || labelForEmail(c.email) });
        // Lo guardado en el dispositivo, solo quienes ven la página.
        const list = rows.filter((c) => c.hasAccess !== false).map(person);
        this.outsiders.set(pageId, rows.filter((c) => c.hasAccess === false).map((c) => ({ ...person(c), hasAccess: false })));
        const entry = { at: this.now, list };
        this.candidates.set(pageId, entry);
        if (this.db) await this.db.put('meta', entry, CANDIDATES_KEY + pageId).catch(() => undefined);
        this.publish(true);
      } catch (err) {
        // Sin red o sin permiso: queda lo guardado. Que no vuelva a pedir en cada tecla.
        const saved = this.candidates.get(pageId);
        if (!isNetworkError(err)) this.candidates.set(pageId, { at: this.now, list: saved?.list ?? [] });
      } finally {
        this.fetching.delete(pageId);
      }
    })();
    this.fetching.set(pageId, running);
    return running;
  }

  // --- Guardar y avisar ---------------------------------------------------------------------------------------

  private localUnread(): number {
    return Math.min(this.saved.items.filter((m) => !m.read).length, UNREAD_CAP);
  }

  private async save(): Promise<void> {
    if (!this.db) return;
    await this.db.put('meta', this.saved, INBOX_KEY).catch(() => undefined);
    await this.saveReads();
  }

  private async saveReads(): Promise<void> {
    if (!this.db) return;
    if (this.reads.ids.length === 0 && !this.reads.upTo) await this.db.delete('meta', READ_KEY).catch(() => undefined);
    else await this.db.put('meta', this.reads, READ_KEY).catch(() => undefined);
  }

  private publish(force = false): void {
    const next: InboxSnapshot = {
      ready: this.ready,
      items: this.saved.items,
      unread: this.localUnread(),
      checkedAt: this.saved.checkedAt,
      loaded: this.loaded,
    };
    const same =
      !force &&
      next.ready === this.snapshot.ready &&
      next.items === this.snapshot.items &&
      next.unread === this.snapshot.unread &&
      next.checkedAt === this.snapshot.checkedAt &&
      next.loaded === this.snapshot.loaded;
    if (same) return;
    this.snapshot = next;
    for (const fn of this.listeners) fn();
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }
}
