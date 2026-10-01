import * as Y from 'yjs';
import type { ImportedComment } from '../sync/comments';

// Los comentarios de Coda (Docs/Doc_Importar_Coda.md, "3. Comentarios"). La API REST de Coda y su exportación
// HTML no los dan; el servidor MCP de Coda sí (`content_read` con `contentTypesToInclude: ["comments"]`). Su
// respuesta, página por página y tal cual, se guarda en `comments.json` de la carpeta exportada:
//
//   { "docId": "…", "pages": { "<id de la página de Coda>": [ <hilo>, … ] } }
//
// Cada hilo trae `state` ("Active", "Resolved", "New"), `reference` (a qué texto estaba pegado: `text`, en
// Markdown, y los ids `cl-…` de sus bloques, que el HTML exportado no tiene; `null` si no estaba pegado a nada)
// y `comments` (el primero abre el hilo; cada uno con `authorName`, `authorEmail`, `createdAt` en segundos
// Unix, `text` y `commentUri`). Acá se lee eso, se busca en la página importada el bloque que tiene ese texto
// y se arman los comentarios para la cola (`CommentQueue.importComments`).

export interface CodaComment {
  commentUri?: string;
  authorName?: string;
  authorEmail?: string;
  /** Segundos Unix (con decimales). */
  createdAt?: number;
  text?: string;
}

export interface CodaThread {
  threadUri?: string;
  state?: string;
  reference?: { type?: string; text?: string; referenceBlockIds?: string[] } | null;
  comments: CodaComment[];
}

export interface CodaComments {
  docId: string | null;
  /** Cuándo se capturó (`capturedAt`), si lo dice. */
  capturedAt: string | null;
  /** Por página de Coda (el `id` del manifest). */
  pages: Map<string, CodaThread[]>;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Revisa `comments.json`. Lo que no tiene la forma esperada se saltea (un hilo sin comentarios, por ejemplo). */
export function parseCodaComments(raw: unknown): CodaComments {
  if (!isObj(raw) || !isObj(raw.pages)) throw new Error('comments.json: no "pages"');
  const pages = new Map<string, CodaThread[]>();
  for (const [pageId, list] of Object.entries(raw.pages)) {
    if (!Array.isArray(list)) continue;
    const threads: CodaThread[] = [];
    for (const t of list) {
      if (!isObj(t) || !Array.isArray(t.comments)) continue;
      const comments = t.comments.filter(isObj).map((c) => ({
        commentUri: str(c.commentUri),
        authorName: str(c.authorName),
        authorEmail: str(c.authorEmail),
        createdAt: typeof c.createdAt === 'number' && Number.isFinite(c.createdAt) ? c.createdAt : undefined,
        text: str(c.text),
      }));
      if (comments.length === 0) continue;
      const ref = isObj(t.reference) ? t.reference : null;
      threads.push({
        threadUri: str(t.threadUri),
        state: str(t.state),
        reference: ref
          ? {
              type: str(ref.type),
              text: str(ref.text),
              referenceBlockIds: Array.isArray(ref.referenceBlockIds) ? ref.referenceBlockIds.filter((x): x is string => typeof x === 'string') : [],
            }
          : null,
        comments,
      });
    }
    pages.set(pageId, threads);
  }
  const captured = str(raw.capturedAt);
  return { docId: str(raw.docId) ?? null, capturedAt: captured && !Number.isNaN(Date.parse(captured)) ? captured : null, pages };
}

/** Un bloque de la página importada: su id y su texto (sin el de sus hijos). */
export interface PageBlock {
  id: string;
  text: string;
  /** En una tabla, el texto de cada celda (un hilo pegado a una celda se encuentra aunque el texto sea corto). */
  cells?: string[];
}

/** Los bloques del documento de una página, en orden (cada uno antes que sus hijos). */
export function pageBlocks(fragment: Y.XmlFragment): PageBlock[] {
  const out: PageBlock[] = [];
  const textOf = (node: Y.XmlElement | Y.XmlFragment): string =>
    node
      .toArray()
      .map((child) => {
        if (child instanceof Y.XmlText) {
          return (child.toDelta() as { insert?: unknown }[]).map((d) => (typeof d.insert === 'string' ? d.insert : '')).join('');
        }
        if (child instanceof Y.XmlElement && child.nodeName !== 'blockGroup') return textOf(child);
        return '';
      })
      .join(' ');
  const walk = (node: Y.XmlElement | Y.XmlFragment) => {
    for (const child of node.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;
      if (child.nodeName === 'blockContainer') {
        const id = child.getAttribute('id');
        if (typeof id === 'string' && id) {
          const cells: string[] = [];
          const collect = (n: Y.XmlElement) => {
            for (const c of n.toArray()) {
              if (!(c instanceof Y.XmlElement) || c.nodeName === 'blockGroup') continue;
              if (c.nodeName === 'tableCell' || c.nodeName === 'tableHeader') cells.push(textOf(c));
              else collect(c);
            }
          };
          collect(child);
          out.push(cells.length ? { id, text: textOf(child), cells } : { id, text: textOf(child) });
        }
      }
      walk(child);
    }
  };
  walk(fragment);
  return out;
}

/**
 * Texto para comparar: sin el Markdown que pone Coda (viñetas, números, casillas, títulos, negritas, cursivas,
 * links, etiquetas, escapes), sin mayúsculas ni tildes y con los espacios juntados.
 */
export function normalizeText(text: string): string {
  return text
    .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .split('\n')
    .map((line) => line.replace(/^\s*(?:#{1,6}\s+|>\s*)?(?:[-*+]\s+|\d+[.)]\s+)?(?:\[[ xX]\]\s+)?/, ''))
    .join(' ')
    .replace(/(\*\*|__|~~|`)/g, '')
    // Cursiva: `*x*` o `_x_` (no un asterisco suelto ni un guion bajo dentro de una palabra).
    .replace(/(^|[^\p{L}\p{N}])[*_](?=\S)(.+?)(?<=\S)[*_](?=$|[^\p{L}\p{N}])/gu, '$1$2')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Un texto alcanza para buscarlo adentro de un bloque más largo: 8 letras o más, o dos palabras. */
const distinctive = (text: string) => text.length >= 8 || text.includes(' ');

/**
 * El bloque donde va un hilo, a partir del texto al que estaba pegado en Coda. Primero un bloque cuyo texto es
 * exactamente ese (entero, o alguna de sus líneas si abarcaba varios bloques); si no, el primero que lo
 * contiene, probando de la línea más larga a la más corta y solo con textos que alcanzan para no confundirse
 * ("ok" no se busca adentro de "Plano 12: ok"). `null`: va como comentario de la página; `lost` dice si el hilo
 * estaba pegado a un texto que ya no se encontró (un texto que queda vacío después de limpiarlo no cuenta).
 */
export function anchorBlock(thread: CodaThread, blocks: PageBlock[]): { blockId: string | null; lost: boolean } {
  const ref = thread.reference?.text;
  const whole = ref ? normalizeText(ref) : '';
  if (!whole) return { blockId: null, lost: false };
  const normalized = blocks.map((b) => ({ id: b.id, text: normalizeText(b.text), cells: b.cells?.map(normalizeText) }));
  const lines = [...new Set([whole, ...ref!.split('\n').map(normalizeText).filter(Boolean)])];
  // Exacto: el texto entero de un bloque o de una celda de una tabla (el hilo queda en el bloque de la tabla).
  for (const line of lines) {
    const hit = normalized.find((b) => b.text === line || b.cells?.includes(line));
    if (hit) return { blockId: hit.id, lost: false };
  }
  for (const line of [...lines].sort((a, b) => b.length - a.length)) {
    if (!distinctive(line)) continue;
    const hit = normalized.find((b) => b.text.includes(line));
    if (hit) return { blockId: hit.id, lost: false };
  }
  return { blockId: null, lost: true };
}

/** Un id de comentario estable (uuid) para un comentario de Coda en un proyecto: reintentar no duplica. */
export async function codaCommentId(projectId: string, key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`coda-comment:${projectId}:${key}`));
  const b = new Uint8Array(digest).slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Lo que acepta la base (`import_comment`): ni antes de 2000 ni en el futuro.
const MIN_DATE = Date.parse('2000-01-01T00:00:00Z');
/** La fecha de Coda (segundos Unix) si la base la acepta; si no, `null`. */
const validDate = (seconds: number | undefined, now: string): string | null => {
  const ms = seconds !== undefined ? Math.round(seconds * 1000) : NaN;
  return ms >= MIN_DATE && ms <= Date.parse(now) ? new Date(ms).toISOString() : null;
};

/** Lo que la base acepta como nombre (1 a 200 caracteres) y como correo (3 a 320, con arroba). */
const cleanName = (name: string | undefined) => name?.replace(/\s+/g, ' ').trim().slice(0, 200) || null;
const cleanEmail = (email: string | undefined) => {
  const e = email?.trim().toLowerCase() || '';
  return e.length >= 3 && e.length <= 320 && e.includes('@') ? e : null;
};

/** El texto de un comentario que en Coda no tenía texto (solo una imagen o un adjunto): no se pierde el hilo. */
export const EMPTY_COMMENT = '(no text in Coda)';

/**
 * Los comentarios de una página, listos para la cola: cada hilo en su bloque (o en la página), sus
 * respuestas detrás, las fechas originales, los resueltos resueltos (con la fecha del último comentario: Coda
 * no dice cuándo se resolvió). Lo escrito con el correo de quien importa queda a su nombre (`authorName`
 * nulo). Devuelve también cuántos hilos estaban pegados a un texto que no se encontró.
 */
export async function buildComments(
  threads: CodaThread[],
  options: {
    projectId: string;
    pageId: string;
    codaPageId: string;
    blocks: PageBlock[];
    userEmail?: string;
    /** `capturedAt` de `comments.json`: la fecha de reemplazo cuando un hilo no tiene ninguna válida. */
    capturedAt?: string | null;
    now?: string;
  },
): Promise<{ comments: ImportedComment[]; lost: number }> {
  const me = options.userEmail?.trim().toLowerCase() || null;
  const now = options.now ?? new Date().toISOString();
  const out: ImportedComment[] = [];
  let lost = 0;
  for (const [ti, thread] of threads.entries()) {
    const anchor = anchorBlock(thread, options.blocks);
    if (anchor.lost) lost++;
    const threadKey = thread.threadUri || `${options.codaPageId}#${ti}`;
    // Una fecha que falta o que la base no acepta se reemplaza por una que sale siempre igual (así seguir una
    // importación no la cambia y la base no lo toma como otro comentario): la última válida del hilo, si no la
    // de la captura, y solo sin ninguna de las dos, la de ahora.
    const valid = thread.comments.map((c) => validDate(c.createdAt, now)).filter((x): x is string => x !== null).sort();
    const captured = options.capturedAt && validDate(Date.parse(options.capturedAt) / 1000, now);
    const fallback = valid[valid.length - 1] ?? captured ?? now;
    const resolvedAt = thread.state === 'Resolved' ? fallback : null;
    let rootId: string | null = null;
    for (const [ci, c] of thread.comments.entries()) {
      const email = cleanEmail(c.authorEmail);
      const own = !!me && email === me;
      const id = await codaCommentId(options.projectId, c.commentUri || `${threadKey}#${ci}`);
      out.push({
        id,
        pageId: options.pageId,
        blockId: rootId ? null : anchor.blockId,
        threadId: rootId,
        body: c.text?.trim() ? c.text : EMPTY_COMMENT,
        createdAt: validDate(c.createdAt, now) ?? fallback,
        resolvedAt: rootId ? null : resolvedAt,
        source: 'coda',
        authorName: own ? null : cleanName(c.authorName) || email || 'Unknown',
        authorEmail: own ? null : email,
      });
      rootId ??= id;
    }
  }
  return { comments: out, lost };
}
