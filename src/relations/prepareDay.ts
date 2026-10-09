import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import * as Y from 'yjs';
import { linkedPageId, unitsFromYDoc, type BlockMeta } from '../search/extract';
import type { PageDocs } from '../sync/docs';
import type { PageRow } from '../sync/types';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { editorSchemaOptions } from '../ui/editorSchema';
import { findUnknownContent } from '../ui/unknownContent';
import { readPageRelations, type LinkTarget } from './pageRelations';
import type { Registry } from './reader';

// *Prepare tomorrow's report* (Docs/Doc_Relaciones.md, sección 11; S4 «D», §5). Escribe en el reporte del día
// siguiente, SOLO AGREGANDO al final, por cada escena del plan que todavía no tiene una sección ahí: un título
// «Escena 105_029» (la palabra y el nivel que ya usa el proyecto) con el número como link a la escena, y un renglón
// vacío para escribir en el set. No copia el título de la escena (lo muestra el editor en vivo, `dayDecorations.ts`).
//
// Reglas (nunca perder datos):
// - Nunca reemplaza ni borra lo escrito. Preparar de nuevo agrega solo lo que falta (lee el documento en el momento,
//   no la foto del índice).
// - *Undo* saca solo lo que agregó y sigue vacío: un título con algo escrito debajo, o cambiado, queda.
// - Dos dispositivos que preparan a la vez sin red dejan, al juntarse, dos títulos de la misma escena (Yjs no los
//   puede fundir). Preparar de nuevo los resuelve (D436): entre los títulos con la forma de Prepare de una escena, saca
//   los vacíos (o todos menos el primero si están todos vacíos). Saca solo el título (el renglón vacío queda), así nada
//   de lo que otro escriba a la vez se pierde. Nunca toca un título escrito a mano, uno cambiado ni una sección con algo
//   adentro.
// - Lo que esta versión no conoce, o un reporte que no terminó de bajar, no se toca (`unknown`, `missing`).
//
// Agrega con un editor sin pantalla sobre el mismo documento (como `writeNewPage` del reporte del día) y saca borrando
// exactamente los bloques en el Y.Doc (ver «Leer y borrar directo»): primero en el dispositivo, después sube. Usa los
// bloques de siempre (título, párrafo, marca `link`): nada nuevo para una versión vieja.

export interface PrepareScene {
  code: string;
  /** La página de la escena (el link). */
  pageId: string;
}

export interface PrepareOptions {
  scenes: PrepareScene[];
  /** Lo que existe en el proyecto, para saber qué escenas ya tienen sección (con cualquier forma de escribirlas). */
  registry: Registry;
  /** A qué escena lleva un link a una página. */
  linkTarget: LinkTarget;
  /** «Escena», «Scene»… */
  word: string;
  level: 1 | 2 | 3;
}

export interface PreparedSection {
  code: string;
  headingId: string;
  paragraphId: string;
  /** El texto del título como se agregó («Escena 104_008»): *Undo* verifica que siga igual. */
  text?: string;
}

export interface PrepareOutcome {
  added: PreparedSection[];
  /**
   * Quién escribió y desde dónde (el autor de Yjs de este dispositivo y su reloj antes de preparar): *Undo* mira con eso
   * si lo agregado ya salió del dispositivo (O1 de la auditoría).
   */
  origin: { client: number; clock: number };
  /** Las escenas que ya tenían una sección. */
  skipped: string[];
  /** Cuántos títulos preparados repetidos y vacíos se sacaron (preparado en dos dispositivos a la vez). */
  merged: number;
}

/**
 * `busy`: el reporte se acaba de crear en otro dispositivo y su contenido todavía no llegó (ni al servidor ni acá):
 * prepararlo ahora escribiría sobre un documento vacío y, al llegar lo del otro, quedarían las secciones dos veces
 * (B2 de la auditoría de E11, D579). Se espera un rato; si no llega, no se toca y se avisa.
 */
export type PrepareResult = ({ status: 'ok' } & PrepareOutcome) | { status: 'missing' | 'unknown' | 'busy' };

interface InlineText {
  type: 'text';
  text: string;
}
interface InlineLink {
  type: 'link';
  href: string;
  content: InlineText[];
}
interface DocBlock {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: DocBlock[];
}

type Editor = BlockNoteEditor;

/** Un editor sin pantalla sobre el documento: y-prosemirror escribe desde la vista, así que se monta escondido. */
export function withEditor<T>(doc: Y.Doc, run: (editor: Editor) => T): T {
  const editor = BlockNoteEditor.create(
    withCollaboration({ ...editorSchemaOptions, collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'Prepare', color: '#888888' } } }),
  ) as unknown as Editor;
  const host = document.createElement('div');
  host.style.display = 'none';
  document.body.appendChild(host);
  try {
    editor.mount(host);
    return run(editor);
  } finally {
    editor.unmount();
    host.remove();
  }
}

const blocksOf = (editor: Editor) => editor.document as unknown as DocBlock[];
const inline = (b: DocBlock) => (Array.isArray(b.content) ? (b.content as (InlineText | InlineLink | { type: string })[]) : []);

/** Un renglón vacío del editor (para saber dónde agregar): un párrafo sin texto ni nada adentro. */
function emptyParagraph(b: DocBlock): boolean {
  if (b.type !== 'paragraph' || b.children?.length) return false;
  return inline(b).every((c) => c.type === 'text' && !(c as InlineText).text);
}

// --- Leer y borrar directo en el Y.Doc (D436, D437) -------------------------------------------------------------------
//
// Borrar con el editor (`removeBlocks`) pasa por y-prosemirror, que compara el documento de punta a punta y, al sacar un
// título que no es el último, reutiliza su contenedor para el párrafo de abajo y borra el contenedor de ese párrafo:
// lo que otro dispositivo escribió adentro a la vez se pierde (R1 y R2 de la re-verificación). Por eso lo que *Prepare*
// saca se borra acá, en el Y.Doc: exactamente el contenedor de cada bloque, por su id, verificado en el momento, en una
// sola transacción. Agregar sí va por el editor (solo inserta: no toca contenedores existentes).

const GROUP = 'blockGroup';
const CONTAINER = 'blockContainer';

/** Un bloque del primer nivel del documento, leído del Y.Doc. */
interface YBlock {
  el: Y.XmlElement;
  id: string;
  type: string;
  level: number;
  /** El texto entero (los links incluidos); lo que no es texto (una foto en línea, un salto) cuenta como un carácter. */
  text: string;
  /** El texto fuera de los links. */
  words: string;
  /** Los links (con su texto). */
  links: { href: string; text: string }[];
  /** Tiene bloques adentro (sangría). */
  nested: boolean;
}

function readYBlock(el: Y.XmlElement): YBlock | null {
  const id = String(el.getAttribute('id') ?? '');
  let content: Y.XmlElement | null = null;
  let nested = false;
  for (const child of el.toArray()) {
    if (!(child instanceof Y.XmlElement)) continue;
    if (child.nodeName === GROUP) nested ||= child.length > 0;
    else content ??= child;
  }
  if (!id || !content) return null;
  let text = '';
  let words = '';
  const links: YBlock['links'] = [];
  for (const piece of content.toArray()) {
    if (piece instanceof Y.XmlText) {
      for (const op of piece.toDelta() as { insert: unknown; attributes?: { link?: { href?: unknown } } }[]) {
        const t = typeof op.insert === 'string' ? op.insert : '\uFFFC';
        text += t;
        const href = op.attributes?.link?.href;
        if (typeof href === 'string') {
          const last = links[links.length - 1];
          if (last && last.href === href) last.text += t;
          else links.push({ href, text: t });
        } else words += t;
      }
    } else {
      // Un nodo en línea que no es texto (un salto de línea, una foto): es contenido.
      text += '\uFFFC';
      words += '\uFFFC';
    }
  }
  return { el, id, type: content.nodeName, level: Number(content.getAttribute('level')) || 1, text, words, links, nested };
}

/** Los bloques del primer nivel, en orden (o `null` si el documento no tiene la forma de siempre). */
function topBlocks(doc: Y.Doc): { group: Y.XmlElement; blocks: YBlock[] } | null {
  const group = doc.getXmlFragment(CONTENT_FRAGMENT).toArray().find((n): n is Y.XmlElement => n instanceof Y.XmlElement && n.nodeName === GROUP);
  if (!group) return null;
  const blocks: YBlock[] = [];
  for (const child of group.toArray()) {
    if (!(child instanceof Y.XmlElement) || child.nodeName !== CONTAINER) continue;
    const b = readYBlock(child);
    if (b) blocks.push(b);
  }
  return { group, blocks };
}

/** Un contenedor de bloque con ese id en cualquier lugar del documento (también adentro de otro). */
export function findContainer(doc: Y.Doc, id: string): Y.XmlElement | null {
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

/** Un renglón vacío: un párrafo sin nada (ni un espacio) y sin bloques adentro. */
const yEmpty = (b: YBlock) => b.type === 'paragraph' && b.text === '' && !b.nested;

/**
 * La escena de un título con la forma de *Prepare*: una palabra y el número como link a la escena («Escena 105_029»),
 * nada más. Uno escrito a mano sin link, o con más texto, no lo es: nunca se saca.
 */
function yPreparedScene(b: YBlock, linkTarget: LinkTarget): string | null {
  if (b.type !== 'heading' || b.nested || b.links.length !== 1 || !b.links[0].text.trim()) return null;
  const id = linkedPageId(b.links[0].href);
  const target = id ? linkTarget(id) : null;
  if (!target || target.kind !== 'scene') return null;
  return /^\s*[\p{L}.]+\s*$/u.test(b.words) ? target.ref : null;
}

/** Lo de abajo de un título del primer nivel, hasta el próximo de su nivel o mayor. */
function yBelow(blocks: YBlock[], i: number): YBlock[] {
  const out: YBlock[] = [];
  for (let k = i + 1; k < blocks.length; k++) {
    if (blocks[k].type === 'heading' && blocks[k].level <= blocks[i].level) break;
    out.push(blocks[k]);
  }
  return out;
}

/**
 * Borra exactamente esos contenedores del primer nivel, por id, en una sola transacción. Antes vuelve a leer cada uno y
 * lo pasa por `check`: si alguno no está o no pasa, no borra ninguno (devuelve `false`).
 */
function deleteExactly(doc: Y.Doc, ids: string[], check: (b: YBlock) => boolean): boolean {
  if (!ids.length) return true;
  const top = topBlocks(doc);
  if (!top) return false;
  const targets = ids.map((id) => top.blocks.find((b) => b.id === id));
  if (targets.some((b) => !b || !check(b))) return false;
  doc.transact(() => {
    for (const b of targets) {
      const at = top.group.toArray().indexOf(b!.el);
      if (at >= 0) top.group.delete(at, 1);
    }
  });
  return true;
}

/** Las escenas que ya tienen sección en el documento (cualquier forma: «Escena 105_029a», un link, «5029»). */
function scenesWithSection(doc: Y.Doc, opts: Pick<PrepareOptions, 'registry' | 'linkTarget'>): Map<string, string[]> {
  const meta: BlockMeta[] = [];
  const units = unitsFromYDoc(doc, meta);
  const rel = readPageRelations(opts.registry, units, meta, {}, opts.linkTarget);
  const out = new Map<string, string[]>();
  for (const s of rel.sections) {
    for (const x of s.scenes) {
      if (x.kind !== 'scene') continue;
      const list = out.get(x.ref) ?? [];
      if (!list.includes(s.blockId)) list.push(s.blockId);
      out.set(x.ref, list);
    }
  }
  return out;
}

/**
 * Los títulos preparados que sobran (D436): solo entre títulos con la forma de *Prepare* de la misma escena (el par que
 * dejan dos dispositivos). Si alguno tiene algo escrito debajo, se van los vacíos; si están todos vacíos, todos menos el
 * primero. Una sección escrita a mano («Escena 105_029a») no cuenta como par y nunca hace sacar nada (B4 de la
 * auditoría). Saca solo los títulos, borrados directo en el Y.Doc: el renglón vacío queda, y lo que otro escriba ahí a
 * la vez también (R2).
 */
function cleanRepeated(doc: Y.Doc, linkTarget: LinkTarget): number {
  const top = topBlocks(doc);
  if (!top) return 0;
  const byScene = new Map<string, { id: string; empty: boolean }[]>();
  top.blocks.forEach((b, i) => {
    const code = yPreparedScene(b, linkTarget);
    if (!code) return;
    byScene.set(code, [...(byScene.get(code) ?? []), { id: b.id, empty: yBelow(top.blocks, i).every(yEmpty) }]);
  });
  const ids: string[] = [];
  for (const list of byScene.values()) {
    if (list.length < 2) continue;
    const empties = list.filter((x) => x.empty);
    const drop = empties.length < list.length ? empties : empties.slice(1);
    ids.push(...drop.map((x) => x.id));
  }
  // Verificado en el momento: cada uno sigue siendo un título con la forma de Prepare y nada abajo.
  const ok = deleteExactly(doc, ids, (b) => {
    if (!yPreparedScene(b, linkTarget)) return false;
    const fresh = topBlocks(doc)!.blocks;
    return yBelow(fresh, fresh.indexOf(fresh.find((x) => x.id === b.id)!)).every(yEmpty);
  });
  return ok ? ids.length : 0;
}

/**
 * Prepara un documento ya abierto: limpia los preparados repetidos y agrega, al final, una sección por escena que no
 * tiene. Sin pantalla; puro sobre el Y.Doc (lo usan las pruebas de colaboración con dos documentos).
 */
/**
 * La sección que agrega *Prepare* para una escena: el título («Escena» + el número como link) y un renglón vacío. Con
 * `ids`, esos ids (el reporte de mañana creado de una vez, `tomorrowNew.ts`, los escribe junto con la plantilla).
 */
export function sectionBlocks(s: PrepareScene, word: string, level: 1 | 2 | 3, ids?: { heading: string; paragraph: string }): Record<string, unknown>[] {
  return [
    {
      ...(ids ? { id: ids.heading } : {}),
      type: 'heading',
      props: { level },
      content: [
        { type: 'text', text: `${word} `, styles: {} },
        { type: 'link', href: `/p/${s.pageId}`, content: [{ type: 'text', text: s.code, styles: {} }] },
      ],
    },
    { ...(ids ? { id: ids.paragraph } : {}), type: 'paragraph', content: [] },
  ];
}

export function prepareInDoc(doc: Y.Doc, opts: PrepareOptions): PrepareOutcome {
  const sections = scenesWithSection(doc, opts);
  const origin = { client: doc.clientID, clock: Y.decodeStateVector(Y.encodeStateVector(doc)).get(doc.clientID) ?? 0 };
  const merged = cleanRepeated(doc, opts.linkTarget);
  const added: PreparedSection[] = [];
  const skipped: string[] = [];
  const toAdd = opts.scenes.filter((s, i) => opts.scenes.findIndex((x) => x.code === s.code) === i);
  const blocks: unknown[] = [];
  const want: PrepareScene[] = [];
  for (const s of toAdd) {
    if (sections.has(s.code)) {
      skipped.push(s.code);
      continue;
    }
    want.push(s);
    blocks.push(...sectionBlocks(s, opts.word, opts.level));
  }
  if (blocks.length) {
    withEditor(doc, (editor) => {
      const list = blocksOf(editor);
      const last = list[list.length - 1];
      // Un renglón vacío al final (el de la semilla, o el que deja el editor) queda al final: lo nuevo va antes.
      const inserted = (last && emptyParagraph(last) ? editor.insertBlocks(blocks as never[], last.id, 'before') : editor.insertBlocks(blocks as never[], last.id, 'after')) as unknown as DocBlock[];
      want.forEach((s, k) => added.push({ code: s.code, headingId: inserted[2 * k].id, paragraphId: inserted[2 * k + 1].id, text: `${opts.word} ${s.code}` }));
    });
  }
  return { added, skipped, merged, origin };
}

/**
 * Deshace lo agregado, borrando directo en el Y.Doc (D437). Cada título se saca solo si sigue siendo lo que agregó
 * *Prepare* (mismo id, mismo texto, el link a la misma escena) y no tiene nada abajo; su renglón, solo si además sigue
 * vacío y justo abajo, y solo sin `titleOnly`. Con `titleOnly` (lo agregado ya salió del dispositivo: otro pudo
 * recibirlo y estar escribiendo en ese renglón sin que llegue todavía) saca solo los títulos: borrar el renglón se
 * llevaría lo que el otro escribe adentro (O1, R1). Un título con algo abajo, o cambiado, queda. Si al borrar la
 * estructura ya no es la esperada, no borra nada (`unexpected`).
 */
export function undoInDoc(
  doc: Y.Doc,
  added: PreparedSection[],
  linkTarget: LinkTarget,
  opts: { titleOnly?: boolean } = {},
): { removed: number; kept: number; unexpected?: boolean } {
  const top = topBlocks(doc);
  if (!top) return { removed: 0, kept: added.length, unexpected: true };
  const ids: string[] = [];
  const expect = new Map<string, (b: YBlock) => boolean>();
  let removed = 0;
  let kept = 0;
  let unexpected = false;
  for (const a of added) {
    const i = top.blocks.findIndex((b) => b.id === a.headingId);
    const heading = i >= 0 ? top.blocks[i] : null;
    const below = heading ? yBelow(top.blocks, i) : [];
    const same = (b: YBlock) => yPreparedScene(b, linkTarget) === a.code && (a.text === undefined || b.text === a.text);
    if (!heading) {
      // El título está, pero no en el primer nivel (alguien lo sangró o lo movió): no se toca nada y se avisa.
      if (findContainer(doc, a.headingId)) {
        unexpected = true;
        kept++;
        continue;
      }
      // Alguien sacó el título: su renglón vacío se va solo sin `titleOnly` y si sigue vacío.
      const para = top.blocks.find((b) => b.id === a.paragraphId);
      if (para && yEmpty(para) && !opts.titleOnly) {
        ids.push(para.id);
        expect.set(para.id, yEmpty);
      }
      continue;
    }
    if (!same(heading) || !below.every(yEmpty)) {
      kept++;
      continue;
    }
    ids.push(heading.id);
    expect.set(heading.id, same);
    const para = below[0];
    if (!opts.titleOnly && para && para.id === a.paragraphId) {
      ids.push(para.id);
      expect.set(para.id, yEmpty);
    }
    removed++;
  }
  const ok = deleteExactly(doc, ids, (b) => expect.get(b.id)?.(b) ?? false);
  if (!ok) return { removed: 0, kept: added.length, unexpected: true };
  return unexpected ? { removed, kept, unexpected } : { removed, kept };
}

export interface PrepareDeps {
  docs: Pick<PageDocs, 'open' | 'close' | 'flush'> & Partial<Pick<PageDocs, 'stateOf'>>;
  engine: { isMissingContent(pageId: string): Promise<boolean>; prefetchPage?(pageId: string, timeoutMs?: number): Promise<boolean>; syncNow?(): Promise<void> };
  /** Para saber si la página se acaba de crear en otro dispositivo (`arriving`). Sin el árbol no se mira. */
  tree?: { get(id: string): PageRow | undefined; hasUnsentCreate(id: string): boolean };
  /** Cuánto esperar a que llegue el contenido de una página que está llegando (`ARRIVING_WAIT_MS`; las pruebas, menos). */
  arrivingWaitMs?: number;
}

/** Hasta cuándo una página creada en otro dispositivo, sin contenido en el servidor, se espera en vez de darse por vacía. */
export const ARRIVING_MS = 120_000;
/** Cuánto se espera a que llegue su contenido antes de decir que no se puede. */
export const ARRIVING_WAIT_MS = 10_000;

/**
 * La página se acaba de crear en otro dispositivo (la fila llegó, su contenido no): sin nada en el servidor
 * (`update_seq` 0), nada en este documento, no creada acá y con menos de `ARRIVING_MS` (D579). Una página vacía de
 * verdad (alguien la creó y la dejó así) pasa a prepararse cuando deja de ser nueva.
 */
export async function isArriving(deps: Pick<PrepareDeps, 'docs' | 'tree'>, pageId: string): Promise<boolean> {
  const row = deps.tree?.get(pageId);
  if (!row || deps.tree!.hasUnsentCreate(pageId)) return false;
  if ((row.update_seq ?? 0) > 0 || (row.snapshot_seq ?? 0) > 0) return false;
  const age = Date.now() - Date.parse(row.created_at);
  if (!(age < ARRIVING_MS)) return false;
  const doc = await deps.docs.open(pageId);
  try {
    return doc.getXmlFragment(CONTENT_FRAGMENT).length === 0 || !unitsFromYDoc(doc).some((u) => u.text.trim());
  } finally {
    deps.docs.close(pageId);
  }
}

/**
 * Lo que pasó antes de escribir: el reporte se está creando en otro dispositivo (se espera a que llegue su contenido),
 * no terminó de bajar (se intenta bajar un rato) o tiene algo que esta versión no conoce.
 */
async function ready(deps: PrepareDeps, pageId: string): Promise<'ok' | 'missing' | 'busy'> {
  if (await isArriving(deps, pageId)) {
    const end = Date.now() + (deps.arrivingWaitMs ?? ARRIVING_WAIT_MS);
    while (Date.now() < end && (await isArriving(deps, pageId))) {
      if (!deps.engine.syncNow) return 'busy';
      await deps.engine.syncNow().catch(() => undefined);
      await new Promise((r) => setTimeout(r, 600));
    }
    if (await isArriving(deps, pageId)) return 'busy';
  }
  let missing = await deps.engine.isMissingContent(pageId).catch(() => true);
  if (missing && deps.engine.prefetchPage) missing = !(await deps.engine.prefetchPage(pageId, 8000).catch(() => false));
  return missing ? 'missing' : 'ok';
}

/** Prepara el reporte `pageId` (el de mañana). Todo local: anda sin red si el reporte ya está en el dispositivo. */
export async function prepareReport(deps: PrepareDeps, pageId: string, opts: PrepareOptions): Promise<PrepareResult> {
  const state = await ready(deps, pageId);
  if (state !== 'ok') return { status: state };
  const doc = await deps.docs.open(pageId, { seed: true });
  try {
    if (findUnknownContent(doc)) return { status: 'unknown' };
    const out = prepareInDoc(doc, opts);
    await deps.docs.flush(pageId);
    return { status: 'ok', ...out };
  } finally {
    deps.docs.close(pageId);
  }
}

/**
 * Si lo que agregó *Prepare* ya puede estar en otro dispositivo: el servidor tiene algo de este autor después del reloj
 * de antes de preparar, o hay una subida en camino. Sin cómo saberlo (sin `stateOf`), se supone que sí.
 */
async function maybeShared(deps: PrepareDeps, pageId: string, origin: PrepareOutcome['origin']): Promise<boolean> {
  if (!deps.docs.stateOf) return true;
  const state = await deps.docs.stateOf(pageId).catch(() => undefined);
  if (!state) return false;
  if (state.pending) return true;
  const synced = state.syncedSV ? (Y.decodeStateVector(state.syncedSV).get(origin.client) ?? 0) : 0;
  return synced > origin.clock;
}

/** *Undo* de `prepareReport`: saca solo lo agregado que sigue vacío (y si ya salió del dispositivo, solo los títulos). */
export async function undoPrepared(
  deps: PrepareDeps,
  pageId: string,
  prepared: Pick<PrepareOutcome, 'added' | 'origin'>,
  linkTarget: LinkTarget,
): Promise<{ removed: number; kept: number; titleOnly: boolean; unexpected?: boolean } | null> {
  const doc = await deps.docs.open(pageId);
  try {
    if (findUnknownContent(doc)) return null;
    await deps.docs.flush(pageId);
    const titleOnly = await maybeShared(deps, pageId, prepared.origin);
    const out = undoInDoc(doc, prepared.added, linkTarget, { titleOnly });
    await deps.docs.flush(pageId);
    return { ...out, titleOnly };
  } finally {
    deps.docs.close(pageId);
  }
}
