import { locale, t } from '../i18n';
import '../i18n/lazy/exportPdf';
import { cutText } from '../lib/graphemes';
import { buildThreads, fromRow, type CommentQueue, type CommentsDb, type CommentThread, type CommentView } from '../sync/comments';

// Los comentarios en el PDF (P.22, Docs/Doc_Exportar.md, sección 2.2 y EX8): con la casilla *Comments* (destildada:
// los comentarios suelen ser internos), al final de cada página van sus hilos, cada uno con el texto del bloque al que
// está anclado (las primeras 80 letras), quién (el NOMBRE, nunca el correo: el PDF viaja), cuándo, las respuestas y si
// está resuelto. Un hilo cuyo primer comentario se borró y tiene respuestas vivas sale con "(deleted comment)".
// Nunca lo borrado. Se leen los que tiene el dispositivo (lo bajado más lo que todavía no subió).

/** De dónde salen los hilos de una página. */
export interface CommentSource {
  /**
   * Antes de armar: baja del servidor los comentarios de esas páginas (lo mismo que hace abrir cada una), así salen
   * también los de los demás en las páginas que este dispositivo no abrió. Devuelve cuántas no se pudieron bajar (sin
   * red, o el servidor no contestó): esas salen con lo que tiene el dispositivo, avisado.
   */
  prepare?(pageIds: readonly string[], options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void }): Promise<number>;
  /**
   * Si los comentarios de esa página no se pudieron bajar en `prepare` (salen los del dispositivo). Con el PDF en partes
   * (D84), `prepare` baja todas las páginas una vez y cada parte pregunta por las suyas.
   */
  stale?(pageId: string): boolean;
  threads(pageId: string): Promise<CommentThread[]>;
  /** El nombre para mostrar de una cuenta del equipo (nunca el correo entero), o `null`. */
  nameOf(userId: string): string | null;
}

/** La parte de un correo antes de la `@` (el nombre que se ve en el PDF). */
export function nameFromEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  const name = (at > 0 ? email.slice(0, at) : email).trim();
  return name || null;
}

/**
 * Los hilos de la app: los guardados en el dispositivo (la base de comentarios) con lo que la cola tiene en memoria
 * encima (lo que todavía no subió y lo bajado en esta sesión). Solo lee.
 */
export function appComments(
  queue: Pick<CommentQueue, 'threads' | 'emailOf'> & Partial<Pick<CommentQueue, 'refresh'>>,
  db: CommentsDb | null,
  me: { id: string; email?: string | null },
): CommentSource {
  /** Las páginas ya preguntadas al servidor en esta exportación (`true`: al día; `false`: sin red). */
  const asked = new Map<string, boolean>();
  return {
    stale: (pageId) => asked.get(pageId) === false,
    async prepare(pageIds, { signal, onProgress } = {}) {
      if (!queue.refresh) return 0;
      let failed = 0;
      let offline = false;
      for (let i = 0; i < pageIds.length; i++) {
        if (signal?.aborted) break;
        onProgress?.(i, pageIds.length);
        // Ya bajada para una parte anterior del mismo PDF: no se vuelve a pedir.
        const before = asked.get(pageIds[i]);
        if (before !== undefined) {
          if (!before) failed++;
          continue;
        }
        // Sin red no se insiste página por página: todas las que faltan salen con lo del dispositivo.
        if (offline || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
          offline = true;
          failed++;
          asked.set(pageIds[i], false);
          continue;
        }
        try {
          await queue.refresh(pageIds[i]);
          asked.set(pageIds[i], true);
        } catch {
          // `refresh` solo tira sin red (los demás errores los guarda la cola y sigue).
          offline = true;
          failed++;
          asked.set(pageIds[i], false);
        }
      }
      onProgress?.(pageIds.length, pageIds.length);
      return failed;
    },
    async threads(pageId) {
      const rows = db ? await db.getAllFromIndex('comments', 'page', pageId).catch(() => []) : [];
      const stored = buildThreads(pageId, new Map(rows.map((r) => [r.id, fromRow(r)])));
      const live = queue.threads(pageId);
      const byId = new Map(stored.map((th) => [th.id, th]));
      for (const th of live) byId.set(th.id, th);
      return [...byId.values()].sort((a, b) => (a.resolved !== b.resolved ? (a.resolved ? 1 : -1) : a.root.createdAt < b.root.createdAt ? -1 : 1));
    },
    nameOf(userId) {
      if (userId === me.id) return nameFromEmail(me.email);
      return nameFromEmail(queue.emailOf(userId));
    },
  };
}

/** Quién escribió un comentario, como se imprime (sin correos). */
export function authorLabel(c: Pick<CommentView, 'authorId' | 'importedAuthor' | 'linkAuthor'>, source: Pick<CommentSource, 'nameOf'>): string {
  // El nombre que escribió quien comentó por el link: si escribió un correo, solo lo de antes de la `@`.
  if (c.linkAuthor) return `${nameFromEmail(c.linkAuthor) ?? c.linkAuthor} ${t('link.viaLink')}`;
  if (c.importedAuthor) return nameFromEmail(c.importedAuthor) ?? c.importedAuthor;
  if (!c.authorId) return t('exportPdf.deletedAccount');
  return source.nameOf(c.authorId) ?? t('exportPdf.someone');
}

interface InlineLike {
  type?: string;
  text?: string;
  content?: unknown;
}

/** El texto de un bloque (sin formato), para anclar el hilo. */
export function blockText(block: { content?: unknown } | undefined): string {
  if (!block) return '';
  const walk = (content: unknown): string => {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map(walk).join('');
    if (content && typeof content === 'object') {
      const c = content as InlineLike & { rows?: { cells: unknown[] }[] };
      if (typeof c.text === 'string') return c.text;
      if (c.rows) return c.rows.map((r) => r.cells.map(walk).join(' ')).join(' ');
      if (c.content !== undefined) return walk(c.content);
    }
    return '';
  };
  return walk(block.content).replace(/\s+/g, ' ').trim();
}

/** Un bloque por su id (también los de adentro). */
function findBlock(blocks: readonly { id?: string; children?: unknown[]; content?: unknown }[], id: string): { content?: unknown } | undefined {
  for (const b of blocks) {
    if (b.id === id) return b;
    const inside = findBlock((b.children ?? []) as never, id);
    if (inside) return inside;
  }
  return undefined;
}

const ANCHOR_MAX = 80;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * La sección de comentarios de una página (o `null` si no tiene ninguno). Cada comentario es una unidad de la
 * paginación (`sd-export-unit`): no se parte entre hojas.
 */
export function commentsSection(
  threads: readonly CommentThread[],
  blocks: readonly { id?: string; children?: unknown[]; content?: unknown }[],
  source: Pick<CommentSource, 'nameOf'>,
): HTMLElement | null {
  const visible = threads.filter((th) => !th.root.deleted || th.replies.some((r) => !r.deleted));
  if (visible.length === 0) return null;
  const dates = new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' });
  const when = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : dates.format(d);
  };
  const section = el('section', 'sd-export-comments');
  section.append(el('h2', 'sd-export-comments-title sd-export-unit', t('exportPdf.comments')));
  for (const th of visible) {
    const thread = el('div', 'sd-export-thread');
    const anchorText = th.blockId ? blockText(findBlock(blocks, th.blockId)) : '';
    const anchor = anchorText ? `“${cutText(anchorText, ANCHOR_MAX)}${anchorText.length > ANCHOR_MAX ? '…' : ''}”` : t('exportPdf.onPage');
    const comment = (c: CommentView, first: boolean) => {
      const box = el('div', `sd-export-comment sd-export-unit${first ? ' first' : ' reply'}`);
      if (first) {
        const head = el('p', 'sd-export-anchor', anchor);
        if (th.resolved) head.append(' ', el('span', 'sd-export-resolved', t('exportPdf.resolved')));
        box.append(head);
      }
      if (c.deleted) {
        box.append(el('p', 'sd-export-comment-body deleted', t('exportPdf.deletedComment')));
      } else {
        const meta = el('p', 'sd-export-comment-meta');
        meta.append(el('strong', '', authorLabel(c, source)), ` · ${when(c.createdAt)}`);
        box.append(meta, el('p', 'sd-export-comment-body', c.body));
      }
      return box;
    };
    thread.append(comment(th.root, true));
    for (const r of th.replies) if (!r.deleted) thread.append(comment(r, false));
    section.append(thread);
  }
  return section;
}
