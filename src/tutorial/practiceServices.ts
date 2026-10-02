import * as Y from 'yjs';
import { t } from '../i18n';
import '../i18n/lazy/tutorial';
import type { Services } from '../services';
import { buildThreads, cleanBody, fromRow, type CommentRow, type CommentStatus, type CommentThread, type ViewWithResolution } from '../sync/comments';
import { FileRejected } from '../sync/files';
import type { PageFormat } from '../ui/pageFormat';
import { PRACTICE_BLOCKS, PRACTICE_ID } from './practiceTemplate';

// Los servicios de la página de práctica (Docs/Doc_Tutorial.md, sección 3, "Cómo se aísla", y corrección 1): la
// práctica monta el editor de verdad adentro de un `ServicesContext` con los servicios del workspace pisados.
// Nada de lo que se haga ahí llega a la base local, al servidor ni al Drive:
//
// - `comments`: una cola en memoria con el hilo de ejemplo de la pregunta (`MemoryComments`).
// - `media` y `files`: las fotos de ejemplo son direcciones web; agregar un archivo avisa y no hace nada.
// - `access`: sin datos de permisos (`Permissions` da "editar y crear" a todo): la práctica se edita y se comenta.
// - `tree`, `engine`, `docs`, `remote`, `client` y `sizes`: los de verdad, envueltos para que solo pasen las
//   lecturas que usa la pantalla; cualquier otra llamada tira un error (`PracticeWriteError`) en vez de escribir.
// - `db`, `mediaDb` y `commentsDb`: `null` (lo colapsado de la práctica queda en memoria).

export class PracticeWriteError extends Error {
  constructor(what: string) {
    super(`La página de práctica no escribe: ${what}`);
    this.name = 'PracticeWriteError';
  }
}

/** Lo que se lee tal cual (no es un objeto con métodos que escriban). */
const plain = (value: unknown) =>
  value === null || typeof value !== 'object' || Array.isArray(value) || value instanceof Date || value instanceof Map || value instanceof Set;

/**
 * Lo de `target` que se puede leer; cualquier otra función tira `PracticeWriteError` al llamarla. Los objetos que
 * cuelgan de él (la base de un árbol, el cliente de una cola) también quedan envueltos, sin ninguna lectura.
 */
export function readOnly<T extends object>(target: T, name: string, reads: readonly string[], overrides: Record<string, unknown> = {}): T {
  const allowed = new Set(reads);
  // La misma función cada vez (`useSyncExternalStore` no se vuelve a suscribir en cada dibujo).
  const cache = new Map<PropertyKey, unknown>();
  const deny = (what: string) => {
    throw new PracticeWriteError(`${name}.${what}`);
  };
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop === 'string' && prop in overrides) return overrides[prop];
      if (cache.has(prop)) return cache.get(prop);
      const value = Reflect.get(obj, prop, receiver);
      let out: unknown;
      if (typeof value === 'function') {
        out = typeof prop === 'string' && allowed.has(prop) ? value.bind(obj) : () => deny(String(prop));
      } else if (typeof prop === 'symbol' || plain(value)) {
        return value;
      } else {
        out = readOnly(value as object, `${name}.${prop}`, []);
      }
      cache.set(prop, out);
      return out;
    },
    set: (_obj, prop) => deny(`${String(prop)} =`),
    deleteProperty: (_obj, prop) => deny(`delete ${String(prop)}`),
    defineProperty: (_obj, prop) => deny(`define ${String(prop)}`),
  });
}

/** Lo que la pantalla le lee al árbol (la barra de arriba, las hojas, los permisos y el panel de comentarios). */
export const TREE_READS = [
  'subscribe',
  'getRevision',
  'get',
  'ancestors',
  'children',
  'roots',
  'project',
  'projects',
  'activeProjects',
  'projectStats',
  'isLocalProject',
  'isTrashed',
  'trashedAncestor',
  'isDescendant',
  'resolveSetting',
  'hasUnsavedWrites',
];
export const ENGINE_READS = ['subscribe', 'getStatus'];
export const DOCS_READS = ['subscribeRenderFailed', 'subscribeUnsupported', 'hasUnsavedEdits'];
export const SIZES_READS = ['subscribe', 'getSnapshot'];
/**
 * "Available offline" (P.10): la práctica solo lo lee (el ícono de lo marcado); sin `mediaDb` no ofrece marcar ni
 * *Storage on this device*, y nada de la práctica se baja ni se libera.
 */
export const OFFLINE_READS = ['subscribe', 'getSnapshot', 'markFor'];

// --- Comentarios en memoria ---------------------------------------------------------------------------------

type Listener = () => void;

/**
 * Comentarios y preguntas de la práctica, solo en memoria (la forma de `CommentQueue` que usan el panel, el margen
 * y el botón de la barra). Arma los hilos con la misma función que la cola de verdad (`buildThreads`).
 */
export class MemoryComments {
  readonly writable = true;
  readonly unavailable = undefined;
  readonly ready = true;
  private readonly rows = new Map<string, CommentRow>();
  private readonly names = new Map<string, string>();
  private readonly listeners = new Set<Listener>();
  private revision = 0;
  private cache: { revision: number; threads: CommentThread[] } | null = null;

  constructor(readonly userId: string) {}

  /** El hilo de ejemplo: una respuesta a la pregunta de la plantilla y una respuesta a esa respuesta. */
  seed(answer: string, reply: string): void {
    const at = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    const base = { page_id: PRACTICE_ID, block_id: PRACTICE_BLOCKS.question, edited_at: null, resolved_at: null, resolved_by: null, deleted_at: null, deleted_by: null };
    const root = crypto.randomUUID();
    this.names.set('practice-leo', 'leo@example.com');
    this.names.set('practice-ana', 'ana@example.com');
    this.rows.set(root, { ...base, id: root, thread_id: null, body: answer, author_id: 'practice-leo', created_at: at(95) });
    const second = crypto.randomUUID();
    this.rows.set(second, { ...base, id: second, thread_id: root, body: reply, author_id: 'practice-ana', created_at: at(40) });
    this.changed();
  }

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getRevision = (): number => this.revision;

  watch(_pageId: string): () => void {
    return () => undefined;
  }

  emailOf(userId: string | null): string | undefined {
    return userId ? this.names.get(userId) : undefined;
  }

  isFresh(): boolean {
    return true;
  }

  pullError(): string | null {
    return null;
  }

  threads(pageId: string): CommentThread[] {
    if (this.cache?.revision === this.revision) return this.cache.threads.filter((th) => th.pageId === pageId);
    const view = new Map<string, ViewWithResolution>();
    for (const r of this.rows.values()) view.set(r.id, fromRow(r));
    const threads = buildThreads(PRACTICE_ID, view);
    this.cache = { revision: this.revision, threads };
    return threads.filter((th) => th.pageId === pageId);
  }

  openCounts(pageId: string): Map<string, number> {
    const counts = new Map<string, number>();
    for (const th of this.threads(pageId)) {
      if (th.resolved || !th.blockId || th.count === 0) continue;
      counts.set(th.blockId, (counts.get(th.blockId) ?? 0) + th.count);
    }
    return counts;
  }

  async add(pageId: string, blockId: string | null, body: string, threadId: string | null = null): Promise<string> {
    const text = cleanBody(body);
    const root = threadId ? this.rows.get(threadId) : null;
    const id = crypto.randomUUID();
    this.rows.set(id, {
      id,
      page_id: pageId,
      block_id: root ? root.block_id : blockId,
      thread_id: threadId,
      body: text,
      author_id: this.userId,
      created_at: new Date().toISOString(),
      edited_at: null,
      resolved_at: null,
      resolved_by: null,
      deleted_at: null,
      deleted_by: null,
    });
    this.changed();
    return id;
  }

  async edit(_pageId: string, id: string, body: string): Promise<void> {
    const row = this.rows.get(id);
    if (!row) return;
    this.rows.set(id, { ...row, body: cleanBody(body), edited_at: new Date().toISOString() });
    this.changed();
  }

  async remove(_pageId: string, id: string): Promise<void> {
    const row = this.rows.get(id);
    if (!row) return;
    this.rows.set(id, { ...row, body: null, deleted_at: new Date().toISOString(), deleted_by: this.userId });
    this.changed();
  }

  async resolve(_pageId: string, threadId: string, resolved: boolean): Promise<void> {
    const row = this.rows.get(threadId);
    if (!row) return;
    this.rows.set(threadId, { ...row, resolved_at: resolved ? new Date().toISOString() : null, resolved_by: resolved ? this.userId : null });
    this.changed();
  }

  /** En memoria nada queda sin subir ni se rechaza. */
  status(): CommentStatus {
    return { pending: 0, failed: 0, error: null };
  }

  failures(): [] {
    return [];
  }

  hasUnsavedWrites(): boolean {
    return false;
  }

  async discard(): Promise<void> {
    throw new PracticeWriteError('comments.discard');
  }

  describeDiscard(): { message: string; text: string | null } {
    return { message: '', text: null };
  }

  private changed(): void {
    this.revision++;
    for (const fn of this.listeners) fn();
  }
}

// --- Fotos y archivos --------------------------------------------------------------------------------------

/** Agregar un archivo en la práctica avisa y no hace nada (Docs/Doc_Tutorial.md, sección 3, y corrección 13). */
export const practiceFilesRejected = () => new FileRejected(t('practice.noFiles'));

const practiceMedia = {
  enabled: false,
  trashEnabled: false,
  mediaUrl: null,
  add: async () => {
    throw practiceFilesRejected();
  },
  hasUnsavedWrites: () => false,
  subscribeThumbs: () => () => undefined,
  ensureLinks: async () => undefined,
  resolve: async (url: string) => url,
  fileInfo: () => null,
  source: async () => ({ kind: null, name: '', original: null }),
  localImage: async () => null,
  thumbnail: async () => null,
  isThumbUrl: () => false,
  viewUrl: () => null,
  viewOf: () => null,
  view: async () => null,
  pass: async () => {
    throw new PracticeWriteError('media.pass');
  },
  passInfo: async () => {
    throw new PracticeWriteError('media.passInfo');
  },
  failures: () => [],
  trash: async () => {
    throw new PracticeWriteError('media.trash');
  },
};

const practiceFiles = {
  /** Las fotos de ejemplo son direcciones web: se muestran tal cual. */
  resolve: async (url: string) => url,
  add: async () => {
    throw practiceFilesRejected();
  },
};

/** Sin datos de permisos: `Permissions` deja editar y comentar (la práctica no le pregunta nada al árbol). */
const practiceAccess = {
  get: () => null,
  subscribe: () => () => undefined,
  getRevision: () => 0,
  removed: false,
};

// --- Lo de una sesión ---------------------------------------------------------------------------------------

export interface PracticeSession {
  services: Services;
  comments: MemoryComments;
  doc: Y.Doc;
  /** Sube con cada documento nuevo (empezar de nuevo, *Practicar*): el editor se vuelve a montar. */
  generation: number;
  title: string;
  format: Pick<PageFormat, 'size' | 'landscape'>;
  /** El pedido de la ayuda que ya se atendió (`openPractice`). */
  fresh: number;
  /** El idioma de la plantilla. */
  lang: string;
}

/**
 * La práctica de cada instancia de servicios (cada workspace y cada sesión): muere con ellos. Así lo escrito en la
 * práctica de un workspace no aparece en otro ni en la sesión de la persona siguiente (corrección 4).
 */
const sessions = new WeakMap<Services, PracticeSession>();

export function practiceSession(real: Services): PracticeSession | undefined {
  return sessions.get(real);
}

/** Arma (o vuelve a armar) la práctica de esta instancia de servicios. */
export function newPracticeSession(real: Services, init: { title: string; lang: string; fresh: number; answer: string; reply: string }): PracticeSession {
  const previous = sessions.get(real);
  previous?.doc.destroy();
  const comments = new MemoryComments(real.user.id);
  comments.seed(init.answer, init.reply);
  const session: PracticeSession = {
    services: real,
    comments,
    doc: new Y.Doc(),
    generation: (previous?.generation ?? 0) + 1,
    title: init.title,
    format: { size: 'free', landscape: false },
    fresh: init.fresh,
    lang: init.lang,
  };
  session.services = practiceServices(real, session);
  sessions.set(real, session);
  return session;
}

/** Los servicios del workspace con los de la práctica encima (ver arriba). */
function practiceServices(real: Services, session: PracticeSession): Services {
  const tree = readOnly(real.tree, 'tree', TREE_READS, {
    // El tamaño de hoja de la práctica vive en memoria.
    resolveSetting: (id: string, key: string, valid: (v: unknown) => boolean) => {
      if (id === PRACTICE_ID) {
        if (key !== 'format' || session.format.size === 'free' || !valid(session.format)) return undefined;
        return { value: { ...session.format }, from: { id: PRACTICE_ID } };
      }
      return real.tree.resolveSetting(id as string, key as never, valid as never);
    },
  });
  return {
    workspace: real.workspace,
    user: real.user,
    // El cliente de Supabase: nada (tampoco lo que cuelga de él: `auth`, `storage`, `functions`).
    client: readOnly(real.client, 'client', []),
    db: null as never,
    tree,
    docs: readOnly(real.docs, 'docs', DOCS_READS),
    files: practiceFiles as never,
    media: practiceMedia as never,
    engine: readOnly(real.engine, 'engine', ENGINE_READS),
    access: practiceAccess as never,
    remote: readOnly(real.remote, 'remote', []),
    dbName: '',
    mediaDb: null,
    comments: session.comments as never,
    commentsDb: null,
    sizes: readOnly(real.sizes, 'sizes', SIZES_READS),
    offline: real.offline ? readOnly(real.offline, 'offline', OFFLINE_READS) : (undefined as never),
    shutdown: async () => {
      throw new PracticeWriteError('shutdown');
    },
    firstLoad: false,
  };
}
