import * as Y from 'yjs';
import type { PageDocs } from '../sync/docs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { findUnknownContent } from '../ui/unknownContent';
import { scan, type Registry } from './reader';

// *Assign* (Docs/Doc_Relaciones.md, sección 15; D521, D522): decir de qué escena es algo escrito, sin cambiar lo escrito.
//
// - **Una sección sin número** (D431): al final de su título se agrega « · 105_025» con el número como link a la escena.
//   Otra escena suma « · 105_026». La relación sale sola: el lector cuenta el link del título.
// - **Un número que no existe** (`105_120` mal escrito): la marca `link` a la escena elegida va sobre el texto escrito,
//   sin cambiarlo. Un link tapa su texto para el lector, así que la mención pasa a esa escena.
//
// Las dos son solo inserciones (texto o una marca) en un único bloque, directo en el Y.Doc, por su id, en una
// transacción y verificando antes el bloque (que siga, su tipo y su texto): no tocan contenedores, así nada de lo que
// otro dispositivo escribe a la vez se pierde (la lección de E5 con `removeBlocks`). Si el bloque cambió, no se escribe.
// La marca `link` es la misma que deja el editor (`{ link: { href } }`): una versión vieja ve un link común.

const CONTAINER = 'blockContainer';
const GROUP = 'blockGroup';

/** El atributo de Yjs de un link a una página de la app, como lo guarda el editor (y-prosemirror). */
export const linkAttr = (href: string) => ({ link: { href } });

/** El link a una página de la app (`/p/<id>`), como los demás links internos. */
export const pageHref = (pageId: string) => `/p/${pageId}`;

/** Un contenedor de bloque por id, en cualquier lugar del documento. */
function findContainer(doc: Y.Doc, id: string): Y.XmlElement | null {
  const walk = (node: Y.XmlElement | Y.XmlFragment): Y.XmlElement | null => {
    for (const child of node.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;
      if (child.nodeName === CONTAINER && child.getAttribute('id') === id) return child;
      if (child.nodeName === GROUP || child.nodeName === CONTAINER) {
        const found = walk(child);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(doc.getXmlFragment(CONTENT_FRAGMENT));
}

/** El contenido de un bloque (el título, el párrafo): el primer elemento que no es su grupo de hijos. */
function contentOf(container: Y.XmlElement): Y.XmlElement | null {
  for (const child of container.toArray()) if (child instanceof Y.XmlElement && child.nodeName !== GROUP) return child;
  return null;
}

interface Piece {
  text: Y.XmlText | null;
  /** Dónde empieza en el texto entero del bloque. */
  at: number;
  /** Lo que dice (un nodo que no es texto cuenta como un carácter). */
  str: string;
  /** Los tramos con link, en posiciones del texto entero. */
  links: [number, number][];
}

/** El texto entero del bloque, pedazo por pedazo. */
function readPieces(content: Y.XmlElement): { full: string; pieces: Piece[] } {
  let full = '';
  const pieces: Piece[] = [];
  for (const child of content.toArray()) {
    if (child instanceof Y.XmlText) {
      const piece: Piece = { text: child, at: full.length, str: '', links: [] };
      for (const op of child.toDelta() as { insert: unknown; attributes?: { link?: unknown } }[]) {
        const t = typeof op.insert === 'string' ? op.insert : '￼';
        if (op.attributes?.link) piece.links.push([full.length + piece.str.length, full.length + piece.str.length + t.length]);
        piece.str += t;
      }
      full += piece.str;
      pieces.push(piece);
    } else {
      pieces.push({ text: null, at: full.length, str: '￼', links: [] });
      full += '￼';
    }
  }
  return { full, pieces };
}

/** Para comparar lo que muestra la fila con lo que dice el título: sin lo que no es texto ni espacios de más. */
const norm = (s: string) => s.replace(/￼/g, ' ').replace(/\s+/g, ' ').trim();

export type AssignResult = { status: 'ok'; added: number } | { status: 'changed' | 'missing' | 'unknown' };

/**
 * Agrega « · 105_025» (con el número como link) al final de un título (D521). `expect` es el texto del título que
 * mostraba la fila: si el bloque ya no está, no es un título o dice otra cosa, no escribe (`changed`).
 */
export function assignHeadingInDoc(doc: Y.Doc, blockId: string, expect: string, scene: { code: string; pageId: string }): AssignResult {
  const container = findContainer(doc, blockId);
  const content = container ? contentOf(container) : null;
  if (!content || content.nodeName !== 'heading') return { status: 'changed' };
  const { full, pieces } = readPieces(content);
  if (norm(full) !== norm(expect)) return { status: 'changed' };
  const last = pieces[pieces.length - 1];
  doc.transact(() => {
    let target = last?.text ?? null;
    if (!target) {
      // Termina en algo que no es texto (o está vacío): un pedazo de texto nuevo al final (solo agrega).
      target = new Y.XmlText();
      content.insert(content.length, [target]);
    }
    const sep = /\s$/.test(full) || !full ? '· ' : ' · ';
    const at = target.length;
    // Los atributos explícitos: sin ellos, Yjs le pone al texto nuevo el formato del final (un link, una negrita).
    target.insert(at, sep, {});
    target.insert(at + sep.length, scene.code, linkAttr(pageHref(scene.pageId)));
  });
  return { status: 'ok', added: 1 };
}

/**
 * Pone la marca `link` a `scene` sobre el número pendiente `pending` (el código que leyó el lector, sin la letra de la
 * parte) en ese bloque (D522). Lee el bloque con el mismo lector que el índice (`registry`, `ep` de la página); marca
 * cada aparición del pendiente que no tenga ya un link. Sin ninguna, no escribe (`changed`).
 */
export function assignMentionInDoc(
  doc: Y.Doc,
  blockId: string,
  pending: string,
  scene: { pageId: string },
  read: { registry: Registry; ep: string | null },
): AssignResult {
  const container = findContainer(doc, blockId);
  const content = container ? contentOf(container) : null;
  if (!content) return { status: 'changed' };
  const { full, pieces } = readPieces(content);
  const hits = scan(read.registry, full, { heading: content.nodeName === 'heading', ep: read.ep }).filter((h) => h.kind === 'pending' && h.ref === pending);
  const spots: { text: Y.XmlText; from: number; len: number }[] = [];
  for (const h of hits) {
    const piece = pieces.find((p) => p.text && h.s >= p.at && h.e <= p.at + p.str.length);
    if (!piece?.text) continue;
    if (piece.links.some(([a, b]) => h.s < b && h.e > a)) continue;
    spots.push({ text: piece.text, from: h.s - piece.at, len: h.e - h.s });
  }
  if (!spots.length) return { status: 'changed' };
  doc.transact(() => {
    for (const s of spots) s.text.format(s.from, s.len, linkAttr(pageHref(scene.pageId)));
  });
  return { status: 'ok', added: spots.length };
}

/**
 * Saca los links que llevan a esa página en todo el documento (solo la marca: el texto queda). Lo usa *Undo* de crear
 * desde el `/`: la página nueva va a la papelera y el número que se escribió vuelve a leerse como pendiente (D518).
 */
export function unlinkPageInDoc(doc: Y.Doc, pageId: string): number {
  const href = pageHref(pageId);
  const spots: { text: Y.XmlText; from: number; len: number }[] = [];
  const walk = (node: Y.XmlElement | Y.XmlFragment) => {
    for (const child of node.toArray()) {
      if (child instanceof Y.XmlText) {
        let at = 0;
        for (const op of child.toDelta() as { insert: unknown; attributes?: { link?: { href?: unknown } } }[]) {
          const len = typeof op.insert === 'string' ? op.insert.length : 1;
          if (op.attributes?.link?.href === href) spots.push({ text: child, from: at, len });
          at += len;
        }
      } else if (child instanceof Y.XmlElement) walk(child);
    }
  };
  walk(doc.getXmlFragment(CONTENT_FRAGMENT));
  if (spots.length) doc.transact(() => spots.forEach((s) => s.text.format(s.from, s.len, { link: null })));
  return spots.length;
}

export interface AssignDeps {
  docs: Pick<PageDocs, 'open' | 'close' | 'flush'>;
  /** Para no escribir en una página que todavía no bajó entera (desde *Map › Pending*, en un teléfono): se intenta bajar. */
  engine?: { isMissingContent(pageId: string): Promise<boolean>; prefetchPage?(pageId: string, timeoutMs?: number): Promise<boolean> };
}

/**
 * Abre la página, escribe con `run` y la guarda en el dispositivo. Una página que no terminó de bajar (se intenta un
 * rato) o con algo que esta versión no conoce no se toca.
 */
async function inPage(deps: AssignDeps, pageId: string, run: (doc: Y.Doc) => AssignResult): Promise<AssignResult> {
  if (deps.engine) {
    let missing = await deps.engine.isMissingContent(pageId).catch(() => true);
    if (missing && deps.engine.prefetchPage) missing = !(await deps.engine.prefetchPage(pageId, 8000).catch(() => false));
    if (missing) return { status: 'missing' };
  }
  const doc = await deps.docs.open(pageId);
  try {
    if (findUnknownContent(doc)) return { status: 'unknown' };
    const out = run(doc);
    await deps.docs.flush(pageId);
    return out;
  } finally {
    deps.docs.close(pageId);
  }
}

/** *Assign* de una sección sin número (ver `assignHeadingInDoc`). */
export function assignHeading(deps: AssignDeps, pageId: string, blockId: string, expect: string, scene: { code: string; pageId: string }): Promise<AssignResult> {
  return inPage(deps, pageId, (doc) => assignHeadingInDoc(doc, blockId, expect, scene));
}

/** *Assign* de un número que no existe (ver `assignMentionInDoc`). */
export function assignMention(
  deps: AssignDeps,
  pageId: string,
  blockId: string,
  pending: string,
  scene: { pageId: string },
  read: { registry: Registry; ep: string | null },
): Promise<AssignResult> {
  return inPage(deps, pageId, (doc) => assignMentionInDoc(doc, blockId, pending, scene, read));
}

/** *Undo* de crear desde el `/`: saca los links a la página creada en la página donde se escribió. */
export async function unlinkPage(deps: AssignDeps, inPageId: string, pageId: string): Promise<number> {
  const doc = await deps.docs.open(inPageId);
  try {
    if (findUnknownContent(doc)) return 0;
    const n = unlinkPageInDoc(doc, pageId);
    await deps.docs.flush(inPageId);
    return n;
  } finally {
    deps.docs.close(inPageId);
  }
}
