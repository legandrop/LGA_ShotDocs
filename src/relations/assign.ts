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

/**
 * Lo que agregó *Assign*, para su *Undo* (D566): un tramo del texto de un bloque, con anclas relativas de Yjs (siguen a
 * esos caracteres aunque otro escriba antes o después) y lo que tiene que decir para que se pueda deshacer.
 * - `delete`: el texto insertado (« · 105_025»): se borra, si sigue entero e igual, con el link solo sobre `linked`.
 * - `unlink`: la marca puesta sobre lo escrito (`105_120`): se saca, si el texto sigue igual y con ese link entero.
 */
export interface AssignSpan {
  op: 'delete' | 'unlink';
  start: Y.RelativePosition;
  end: Y.RelativePosition;
  text: string;
  href: string;
  /** Con `delete`: dónde empieza, dentro de `text`, lo que lleva el link (el número; antes va « · » sin link). */
  linkedFrom?: number;
}

export type AssignResult = { status: 'ok'; added: number; undo: AssignSpan[] } | { status: 'changed' | 'missing' | 'unknown' };

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
  const sep = /\s$/.test(full) || !full ? '· ' : ' · ';
  const href = pageHref(scene.pageId);
  let undo: AssignSpan[] = [];
  doc.transact(() => {
    let target = last?.text ?? null;
    if (!target) {
      // Termina en algo que no es texto (o está vacío): un pedazo de texto nuevo al final (solo agrega).
      target = new Y.XmlText();
      content.insert(content.length, [target]);
    }
    const at = target.length;
    // Los atributos explícitos: sin ellos, Yjs le pone al texto nuevo el formato del final (un link, una negrita).
    target.insert(at, sep, {});
    target.insert(at + sep.length, scene.code, linkAttr(href));
    undo = [spanOf(target, at, at + sep.length + scene.code.length, 'delete', sep + scene.code, href, sep.length)];
  });
  return { status: 'ok', added: 1, undo };
}

/** Un tramo `[from, to)` de un texto, anclado a sus propios caracteres (el primero y el último). */
function spanOf(text: Y.XmlText, from: number, to: number, op: AssignSpan['op'], str: string, href: string, linkedFrom?: number): AssignSpan {
  return {
    op,
    // `assoc` 0: pegado al primer carácter del tramo; -1: pegado al último (lo escrito justo después no entra).
    start: Y.createRelativePositionFromTypeIndex(text, from, 0),
    end: Y.createRelativePositionFromTypeIndex(text, to, -1),
    text: str,
    href,
    ...(linkedFrom !== undefined ? { linkedFrom } : {}),
  };
}

/** El link de cada carácter de un tramo de un texto (o `null`), y lo que dice. */
function readRange(text: Y.XmlText, from: number, to: number): { str: string; links: (string | null)[] } {
  let at = 0;
  let str = '';
  const links: (string | null)[] = [];
  for (const op of text.toDelta() as { insert: unknown; attributes?: { link?: { href?: unknown } } }[]) {
    const t = typeof op.insert === 'string' ? op.insert : '￼';
    const a = Math.max(from, at);
    const b = Math.min(to, at + t.length);
    if (a < b) {
      str += t.slice(a - at, b - at);
      const href = typeof op.attributes?.link?.href === 'string' ? op.attributes.link.href : null;
      for (let i = a; i < b; i++) links.push(href);
    }
    at += t.length;
    if (at >= to) break;
  }
  return { str, links };
}

/** Dónde está hoy un tramo de *Assign*: el mismo texto vivo y sus posiciones, o `null` si ya no se puede ubicar. */
function locate(doc: Y.Doc, span: AssignSpan): { text: Y.XmlText; from: number; to: number } | null {
  const a = Y.createAbsolutePositionFromRelativePosition(span.start, doc);
  const b = Y.createAbsolutePositionFromRelativePosition(span.end, doc);
  if (!a || !b || a.type !== b.type || !(a.type instanceof Y.XmlText)) return null;
  // El texto, o algo de lo que lo contiene, se borró (el bloque se sacó o se movió): no se toca.
  for (let item = a.type._item; item; item = (item.parent as Y.AbstractType<unknown>)._item) if (item.deleted) return null;
  return a.index <= b.index ? { text: a.type, from: a.index, to: b.index } : null;
}

/** Si el tramo sigue exactamente como lo dejó *Assign*. */
function intact(doc: Y.Doc, span: AssignSpan): { text: Y.XmlText; from: number; to: number } | null {
  const at = locate(doc, span);
  if (!at || at.to - at.from !== span.text.length) return null;
  const { str, links } = readRange(at.text, at.from, at.to);
  if (str !== span.text) return null;
  const ok = links.every((l, i) => (span.op === 'unlink' || i >= (span.linkedFrom ?? 0) ? l === span.href : l === null));
  return ok ? at : null;
}

/**
 * *Undo* de *Assign* en el Y.Doc (D566): solo si TODO lo que agregó sigue igual (mismo texto, mismo link, en su lugar);
 * si algo cambió (otro escribió en el medio, sacó el link, borró el bloque), no toca nada (`changed`). Borra por las
 * anclas, en una transacción: nunca saca bloques ni contenedores, así lo que otro dispositivo escribe al lado queda.
 */
export function undoAssignInDoc(doc: Y.Doc, spans: readonly AssignSpan[]): 'undone' | 'changed' {
  const found = spans.map((s) => intact(doc, s));
  if (!spans.length || found.some((f) => !f)) return 'changed';
  doc.transact(() => {
    // De atrás para adelante dentro de cada texto: borrar uno no corre las posiciones de los que faltan. Agrupados por
    // texto (en el orden en que aparecen) para que el orden sea total (observación de la auditoría de E11).
    const texts: Y.XmlText[] = [];
    const group = (t: Y.XmlText) => (texts.includes(t) ? texts.indexOf(t) : texts.push(t) - 1);
    const order = spans
      .map((s, i) => ({ s, at: found[i]! }))
      .sort((x, y) => group(x.at.text) - group(y.at.text) || y.at.from - x.at.from);
    for (const { s, at } of order) {
      if (s.op === 'delete') at.text.delete(at.from, at.to - at.from);
      else at.text.format(at.from, at.to - at.from, { link: null });
    }
  });
  return 'undone';
}

/**
 * Lo que una edición hecha por el editor (el adelanto: `makeLinkAt`, D522) agregó como link a `href` en ese bloque: los
 * tramos que antes no tenían ese link y después sí. Para el *Undo* del aviso del adelanto.
 */
export function captureNewLinks(doc: Y.Doc, blockId: string, href: string, run: () => boolean): AssignSpan[] | null {
  // El link de cada carácter del bloque, leído en el momento (los textos de Yjs son vivos: hay que copiarlo antes).
  const read = () => {
    const container = findContainer(doc, blockId);
    const content = container ? contentOf(container) : null;
    if (!content) return null;
    const { full, pieces } = readPieces(content);
    const links: (string | null)[] = [];
    for (const p of pieces) links.push(...(p.text ? readRange(p.text, 0, p.str.length).links : [null]));
    return { full, pieces, links };
  };
  const before = read();
  if (!run()) return null;
  const after = read();
  // El texto es el mismo antes y después (poner una marca no lo cambia): las posiciones se comparan directo.
  if (!before || !after || before.full !== after.full) return [];
  const added = (i: number) => after.links[i] === href && before.links[i] !== href;
  const spans: AssignSpan[] = [];
  for (const piece of after.pieces) {
    if (!piece.text) continue;
    const end = piece.at + piece.str.length;
    for (let i = piece.at; i < end; ) {
      if (!added(i)) {
        i++;
        continue;
      }
      let j = i;
      while (j < end && added(j)) j++;
      spans.push(spanOf(piece.text, i - piece.at, j - piece.at, 'unlink', after.full.slice(i, j), href));
      i = j;
    }
  }
  return spans;
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
  const href = pageHref(scene.pageId);
  const undo: AssignSpan[] = [];
  doc.transact(() => {
    for (const s of spots) {
      s.text.format(s.from, s.len, linkAttr(href));
      undo.push(spanOf(s.text, s.from, s.from + s.len, 'unlink', readRange(s.text, s.from, s.from + s.len).str, href));
    }
  });
  return { status: 'ok', added: spots.length, undo };
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

/** Lo que *Assign* agregó en varias páginas (*Map › Pending*), página por página. */
export interface AssignEverywhere {
  added: number;
  /** Páginas donde escribió, con lo agregado para su *Undo*. */
  done: { pageId: string; undo: AssignSpan[] }[];
  /** Páginas donde no pudo (no bajó entera, algo que no conoce, el número ya no está). */
  failed: { pageId: string; status: 'changed' | 'missing' | 'unknown' }[];
}

/**
 * *Assign* de un número que no existe en cada lugar donde se lo nombra (*Map › Pending*, D567): la marca a la escena en
 * cada bloque de cada página (solo las que `places` trae: quien llama deja afuera las que la persona no puede editar).
 * Cada página es lo de `assignMention`: por id, verificando, en una transacción; las que no se pudieron se dicen.
 */
export async function assignMentionEverywhere(
  deps: AssignDeps,
  places: readonly { pageId: string; blockIds: readonly string[]; ep: string | null }[],
  pending: string,
  scene: { pageId: string },
  registry: Registry,
): Promise<AssignEverywhere> {
  const out: AssignEverywhere = { added: 0, done: [], failed: [] };
  for (const p of places) {
    const res = await inPage(deps, p.pageId, (doc) => {
      const undo: AssignSpan[] = [];
      let added = 0;
      for (const blockId of p.blockIds) {
        const r = assignMentionInDoc(doc, blockId, pending, scene, { registry, ep: p.ep });
        if (r.status === 'ok') {
          added += r.added;
          undo.push(...r.undo);
        }
      }
      return added ? { status: 'ok', added, undo } : { status: 'changed' };
    });
    if (res.status === 'ok') {
      out.added += res.added;
      out.done.push({ pageId: p.pageId, undo: res.undo });
    } else out.failed.push({ pageId: p.pageId, status: res.status });
  }
  return out;
}

/**
 * *Undo* de *Assign* (D566): abre la página y deshace con `undoAssignInDoc`. Una página con algo que esta versión no
 * conoce no se toca (`changed`).
 */
export async function undoAssign(deps: Pick<AssignDeps, 'docs'>, pageId: string, spans: readonly AssignSpan[]): Promise<'undone' | 'changed'> {
  const doc = await deps.docs.open(pageId);
  try {
    if (findUnknownContent(doc)) return 'changed';
    const out = undoAssignInDoc(doc, spans);
    await deps.docs.flush(pageId);
    return out;
  } finally {
    deps.docs.close(pageId);
  }
}

/**
 * *Undo* de `assignMentionEverywhere`: primero mira todas las páginas y, solo si en todas sigue igual lo agregado, lo
 * saca en cada una. Si en una cambió, no toca ninguna (`changed`).
 */
export async function undoAssignEverywhere(deps: Pick<AssignDeps, 'docs'>, done: readonly { pageId: string; undo: readonly AssignSpan[] }[]): Promise<'undone' | 'changed' | 'partial'> {
  const opened: { pageId: string; doc: Y.Doc; undo: readonly AssignSpan[] }[] = [];
  try {
    for (const d of done) {
      const doc = await deps.docs.open(d.pageId);
      opened.push({ pageId: d.pageId, doc, undo: d.undo });
      if (findUnknownContent(doc) || !d.undo.length || d.undo.some((s) => !intact(doc, s))) return 'changed';
    }
    // Entre revisar una página y escribir en ella puede llegar un cambio de otro dispositivo: cada una se vuelve a mirar
    // al escribir, y si alguna ya no se pudo, el aviso lo dice (`partial`) en vez de decir que se deshizo todo.
    const results = opened.map((o) => undoAssignInDoc(o.doc, o.undo));
    for (const o of opened) await deps.docs.flush(o.pageId);
    if (!opened.length || results.every((r) => r === 'changed')) return 'changed';
    return results.some((r) => r === 'changed') ? 'partial' : 'undone';
  } finally {
    for (const o of opened) deps.docs.close(o.pageId);
  }
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
