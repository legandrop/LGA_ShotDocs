import * as Y from 'yjs';
import type { DocState } from '../sync/localDb';
import { treeContentGap } from '../sync/clean';
import { CONTENT_FRAGMENT } from '../sync/structure';
import type { PageRow } from '../sync/types';
import { findUnknownContent } from '../ui/unknownContent';
import { sameShot, shotKeyOf } from './activeShot';
import type { Change } from './answer';
import { labelKey, noteMentions, type PageMap } from './pageMap';

// La página *Shot Breakdown* del plano (Docs/Doc_Dictado.md, DI8 → A; entrega V4): cuando la nota cambia el lente de un
// plano en el reporte del día, la vista previa ofrece además escribirlo en la ficha de la página de ese plano, destildado.
// Es OTRA página: se busca en el proyecto, se mira su permiso, y se escribe sin editor (como el reemplazo en todo el
// proyecto) con su guarda. Riesgo alto, por eso:
//
// - **Nunca pisa texto de otro.** Solo se propone si la celda de la ficha está vacía o dice exactamente lo que decía la
//   del reporte antes de este cambio (era su copia). Si dice otra cosa, no se propone y la vista previa lo dice.
// - **La guarda:** al aplicar, adentro del candado de la página, la celda tiene que ser el mismo elemento de Yjs con el
//   mismo texto que en la foto; si no, no se escribe ahí (lo del reporte ya está aplicado y queda).
// - **Se deshace** con *Undo* de la hoja: vuelve lo de antes solo si la celda sigue diciendo lo que se escribió.
// - **Una sola página por plano:** si hay más de una que podría ser la del plano, no se propone nada.
// - Solo texto en una celda que existe: ningún tipo de bloque ni propiedad nueva (una versión vieja lo abre igual).

/** Lo que el dictado escribe en otra página: una edición local como cualquier otra, sin editor (no entra en su ⌘Z). */
export const ORIGIN_DICTATION = Symbol('dictation');

/** Las columnas del reporte que tienen su fila en la ficha del plano, y los rótulos de esa fila (los dos idiomas). */
const FIELDS: { column: (key: string) => boolean; rows: string[] }[] = [{ column: (k) => k.startsWith('lens') || k.startsWith('lente'), rows: ['lens', 'lente'] }];

const SHOT_ROWS = new Set(['shot', 'plano']);

export interface ShotPageDeps {
  tree: {
    get(id: string): PageRow | undefined;
    isTrashed(id: string): boolean;
    roots(projectId: string): PageRow[];
    children(parentId: string | null): PageRow[];
    hasUnsentCreate(pageId: string): boolean;
    contentGap?(row: PageRow, cursor: number): 'missing' | 'preparing' | null;
  };
  docs: {
    peek(pageId: string): Y.Doc | null;
    indexSnapshot(pageId: string): Promise<{ doc: Y.Doc; state: DocState | undefined }>;
    stateOf(pageId: string): Promise<DocState | undefined>;
    edit<T>(pageId: string, fn: (doc: Y.Doc) => Promise<T> | T): Promise<T>;
    applyLocal(pageId: string, doc: Y.Doc, origin: symbol, apply: () => void): boolean;
    flush(pageId?: string): Promise<void>;
  };
  /** Los permisos de ahora (se piden cada vez). */
  perms: () => { known: boolean; canEditPage(pageId: string): boolean };
}

/** Un cambio propuesto en la ficha de la página de un plano. */
export interface ShotPageChange {
  id: number;
  /** El cambio del reporte del que sale. */
  from: number;
  pageId: string;
  pageTitle: string;
  shot: string;
  /** El rótulo de la fila de la ficha, como está en la página (`Lens`). */
  label: string;
  /** La celda (el párrafo de la celda de valor), como posición relativa de Yjs en JSON: sigue al elemento. */
  cell: unknown;
  before: string;
  after: string;
}

/** Algo que la vista previa dice en lugar de proponer (la celda dice otra cosa, más de una página…). */
export interface ShotPageNote {
  shot: string;
  kind: 'differs' | 'ambiguous' | 'readOnly';
  pageTitle?: string;
  label?: string;
  text?: string;
}

interface FactRow {
  label: string;
  /** El párrafo de la celda de valor. */
  para: Y.XmlElement;
  /** Su texto, o `null` si tiene algo que no es texto (una foto, un salto): no se escribe. */
  text: string | null;
}

const ELEMENT = (n: unknown): n is Y.XmlElement => n instanceof Y.XmlElement;

/** El texto de un párrafo de Yjs, o `null` si tiene algo más que texto. */
function paraText(para: Y.XmlElement): string | null {
  let out = '';
  for (const child of para.toArray()) {
    if (!(child instanceof Y.XmlText)) return null;
    for (const op of child.toDelta() as { insert: unknown }[]) {
      if (typeof op.insert !== 'string') return null;
      out += op.insert;
    }
  }
  return out;
}

/** El párrafo de una celda (`tableCell` / `tableHeader` → `tableParagraph`), si tiene uno solo. */
function cellPara(cell: Y.XmlElement): Y.XmlElement | null {
  const items = cell.toArray().filter(ELEMENT);
  return items.length === 1 ? items[0] : null;
}

/** La ficha de una página (la primera tabla de 2 columnas de arriba), leída del Y.Doc sin editor. */
function factRows(doc: Y.Doc): FactRow[] | null {
  const stack: Y.XmlElement[] = doc.getXmlFragment(CONTENT_FRAGMENT).toArray().filter(ELEMENT).reverse();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.nodeName === 'table') {
      const rows = node.toArray().filter(ELEMENT);
      if (rows.length === 0 || !rows.every((r) => r.toArray().filter(ELEMENT).length === 2)) continue;
      const out: FactRow[] = [];
      for (const r of rows) {
        const [a, b] = r.toArray().filter(ELEMENT);
        const pa = cellPara(a);
        const pb = cellPara(b);
        if (!pa || !pb) continue;
        out.push({ label: paraText(pa) ?? '', para: pb, text: paraText(pb) });
      }
      return out;
    }
    if (node.nodeName === 'blockGroup' || node.nodeName === 'blockContainer') stack.push(...node.toArray().filter(ELEMENT).reverse());
  }
  return null;
}

/** Las páginas del proyecto (sin la papelera), en orden del árbol. */
function projectPages(tree: ShotPageDeps['tree'], projectId: string): PageRow[] {
  const out: PageRow[] = [];
  const visit = (rows: PageRow[]) => {
    for (const r of rows) {
      if (tree.isTrashed(r.id)) continue;
      out.push(r);
      visit(tree.children(r.id));
    }
  };
  visit(tree.roots(projectId));
  return out;
}

/** Lee el documento de una página: el vivo si está abierta, si no lo guardado (sin abrirla para editar). */
async function readDoc<T>(docs: ShotPageDeps['docs'], pageId: string, fn: (doc: Y.Doc) => T): Promise<T> {
  const live = docs.peek(pageId);
  if (live) return fn(live);
  const { doc } = await docs.indexSnapshot(pageId);
  try {
    return fn(doc);
  } finally {
    doc.destroy();
  }
}

/** Lo que tiene que estar bien para escribir en la página (lo mismo que mira el reemplazo en el proyecto). */
async function writable(deps: ShotPageDeps, pageId: string, projectId: string): Promise<boolean> {
  const row = deps.tree.get(pageId);
  if (!row || row.workspace_id !== projectId || deps.tree.isTrashed(pageId)) return false;
  const perms = deps.perms();
  if (!perms.known || !perms.canEditPage(pageId)) return false;
  const state = await deps.docs.stateOf(pageId);
  if (treeContentGap(deps.tree, row, state?.cursor ?? 0) !== null && !deps.tree.hasUnsentCreate(pageId)) return false;
  return !state?.unreadable && !state?.rejected;
}

const same = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

/** El plano y el valor que un cambio del reporte deja en una columna con fila en la ficha. */
function mirrored(c: Change, map: PageMap): { shot: string; rows: string[]; before: string; after: string } | null {
  if (c.op === 'setCell' && c.target?.kind === 'cell') {
    const table = map.tables.find((x) => x.n === c.target!.table);
    if (!table?.headerRow) return null;
    const field = FIELDS.find((f) => f.column(labelKey(c.target!.colLabel ?? '')));
    const slate = c.slate ?? c.target.rowLabel ?? '';
    if (!field || (slate.match(/\d+/g)?.length ?? 0) < 2) return null;
    return { shot: slate, rows: field.rows, before: c.before, after: c.after };
  }
  if (c.op === 'addRow' && c.table && c.cells) {
    const k = c.table.rows[0].findIndex((h) => FIELDS.some((f) => f.column(labelKey(h.plain))));
    const field = k >= 0 ? FIELDS.find((f) => f.column(labelKey(c.table!.rows[0][k].plain))) : undefined;
    const slate = c.cells[0] ?? '';
    if (!field || !c.cells[k]?.trim() || (slate.match(/\d+/g)?.length ?? 0) < 2) return null;
    return { shot: slate, rows: field.rows, before: '', after: c.cells[k] };
  }
  return null;
}

/**
 * Los cambios que se proponen en las páginas de los planos, para los cambios del reporte que los tienen. `pageId` es la
 * página abierta (nunca se propone escribir en ella). Lee solo las páginas cuyo título nombra el plano.
 */
export async function proposeShotPages(
  deps: ShotPageDeps,
  pageId: string,
  map: PageMap,
  changes: Change[],
  firstId: number,
): Promise<{ changes: ShotPageChange[]; notes: ShotPageNote[] }> {
  const out: ShotPageChange[] = [];
  const notes: ShotPageNote[] = [];
  const projectId = deps.tree.get(pageId)?.workspace_id;
  if (!projectId) return { changes: out, notes };
  let pages: PageRow[] | null = null;
  const used = new Set<string>();
  for (const c of changes) {
    const m = mirrored(c, map);
    if (!m) continue;
    const shot = shotKeyOf(m.shot)!;
    pages ??= projectPages(deps.tree, projectId).filter((p) => p.id !== pageId);
    // Las páginas cuyo título nombra el plano (`012_010`, `Shot 12_010`) y que tienen la ficha de un plano.
    const candidates: { page: PageRow; row: FactRow; cell: unknown }[] = [];
    for (const page of pages.filter((p) => noteMentions(p.title, m.shot))) {
      let found: { row: FactRow; cell: unknown } | null = null;
      try {
        found = await readDoc(deps.docs, page.id, (doc) => {
          if (findUnknownContent(doc)) return null;
          const rows = factRows(doc);
          if (!rows) return null;
          const shotRow = rows.find((r) => SHOT_ROWS.has(labelKey(r.label)));
          // La ficha de un plano: tiene la fila *Shot*, vacía o con este plano.
          if (!shotRow || (shotRow.text?.trim() && !sameShot(shotKeyOf(shotRow.text) ?? '', shot))) return null;
          const row = rows.find((r) => m.rows.includes(labelKey(r.label)));
          if (!row) return null;
          return { row, cell: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(row.para, 0)) };
        });
      } catch (err) {
        console.warn('Dictado: no se pudo leer la página del plano', err);
      }
      if (found) candidates.push({ page, ...found });
    }
    if (candidates.length === 0) continue;
    if (candidates.length > 1) {
      notes.push({ shot, kind: 'ambiguous' });
      continue;
    }
    const [{ page, row, cell }] = candidates;
    const key = `${page.id}|${labelKey(row.label)}`;
    if (used.has(key)) continue;
    if (!(await writable(deps, page.id, projectId))) {
      notes.push({ shot, kind: 'readOnly', pageTitle: page.title });
      continue;
    }
    const now = row.text;
    // Ya dice eso: nada que hacer.
    if (now !== null && same(now, m.after)) continue;
    // Nunca pisa lo de otro: solo vacía, o la copia de lo que decía el reporte.
    if (now === null || (now.trim() && !(m.before.trim() && same(now, m.before)))) {
      notes.push({ shot, kind: 'differs', pageTitle: page.title, label: row.label.trim(), text: (now ?? '').trim() });
      continue;
    }
    used.add(key);
    out.push({ id: firstId + out.length, from: c.id, pageId: page.id, pageTitle: page.title, shot, label: row.label.trim(), cell, before: now, after: m.after });
  }
  return { changes: out, notes };
}

/** Lo escrito en la página de un plano (para *Undo*). */
export interface ShotPageWritten {
  change: ShotPageChange;
}

/** El párrafo de la celda, en el documento de ahora, si sigue (por su posición relativa de Yjs). */
function paraOf(doc: Y.Doc, cell: unknown): Y.XmlElement | null {
  try {
    const abs = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(cell), doc);
    return abs && abs.type instanceof Y.XmlElement && abs.type.nodeName === 'tableParagraph' ? abs.type : null;
  } catch {
    return null;
  }
}

/** Escribe el texto entero de un párrafo (solo texto: lo que había en él era solo texto). */
function writePara(para: Y.XmlElement, value: string): void {
  const texts = para.toArray().filter((n): n is Y.XmlText => n instanceof Y.XmlText);
  for (const t of texts) if (t.length > 0) t.delete(0, t.length);
  if (!value) return;
  if (texts.length > 0) texts[0].insert(0, value);
  else {
    const t = new Y.XmlText();
    para.insert(0, [t]);
    t.insert(0, value);
  }
}

/**
 * Escribe un cambio en la página del plano, si se puede editar y la celda sigue como en la foto (`expect`). `'changed'`
 * si cambió o ya no está; `'readOnly'` sin permiso.
 */
async function writeOne(deps: ShotPageDeps, projectId: string, c: ShotPageChange, expect: string, value: string): Promise<'ok' | 'changed' | 'readOnly'> {
  if (!(await writable(deps, c.pageId, projectId))) return 'readOnly';
  const res = await deps.docs.edit(c.pageId, async (doc) => {
    // Otra vez adentro del candado: mientras se esperaba pudo llegar algo (la papelera, un permiso menos, lo bajado).
    if (!(await writable(deps, c.pageId, projectId))) return 'readOnly' as const;
    if (findUnknownContent(doc)) return 'changed' as const;
    const para = paraOf(doc, c.cell);
    const now = para ? paraText(para) : null;
    if (!para || now === null || now !== expect) return 'changed' as const;
    deps.docs.applyLocal(c.pageId, doc, ORIGIN_DICTATION, () => writePara(para, value));
    return 'ok' as const;
  });
  if (res === 'ok') await deps.docs.flush(c.pageId);
  return res;
}

/** Aplica los cambios tildados en las páginas de los planos, de a uno. Devuelve lo escrito y lo que no se pudo. */
export async function applyShotPages(deps: ShotPageDeps, pageId: string, changes: ShotPageChange[]): Promise<{ written: ShotPageChange[]; failed: ShotPageChange[] }> {
  const written: ShotPageChange[] = [];
  const failed: ShotPageChange[] = [];
  const projectId = deps.tree.get(pageId)?.workspace_id ?? '';
  for (const c of changes) {
    let res: 'ok' | 'changed' | 'readOnly' = 'changed';
    try {
      res = await writeOne(deps, projectId, c, c.before, c.after);
    } catch (err) {
      console.error('Dictado: no se pudo escribir en la página del plano', err);
    }
    (res === 'ok' ? written : failed).push(c);
  }
  return { written, failed };
}

/** *Undo*: vuelve lo de antes en las páginas de los planos donde la celda sigue diciendo lo que se escribió. */
export async function undoShotPages(deps: ShotPageDeps, pageId: string, written: ShotPageChange[]): Promise<{ undone: number; kept: ShotPageChange[] }> {
  const kept: ShotPageChange[] = [];
  let undone = 0;
  const projectId = deps.tree.get(pageId)?.workspace_id ?? '';
  for (const c of written) {
    let res: 'ok' | 'changed' | 'readOnly' = 'changed';
    try {
      res = await writeOne(deps, projectId, c, c.after, c.before);
    } catch (err) {
      console.error('Dictado: no se pudo deshacer en la página del plano', err);
    }
    if (res === 'ok') undone++;
    else kept.push(c);
  }
  return { undone, kept };
}
