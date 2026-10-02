import type { Mark, Node as PMNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import { absolutePositionToRelativePosition, ySyncPluginKey } from 'y-prosemirror';
import type * as Y from 'yjs';
import { oldUnits, type OldUnit } from '../assistant/markup';
import { builtinTexts } from '../templates/builtin';
import { normalizeLabel } from '../templates/dayReportFacts';

// El mapa de la página para *Dictate to report* (Docs/Doc_Dictado.md, 5.2): el estado actual de la página abierta como
// texto plano con una dirección corta por lugar (cada tabla con sus columnas, cada fila con su rótulo, cada casilla,
// cada renglón con rótulo), y la foto de cada lugar: qué elemento de Yjs es (un ancla que sigue al texto) y qué tenía.
// Las direcciones valen solo para ese pedido. Al modelo le llega solo lo que la página muestra hoy: ni comentarios, ni
// lo borrado, ni nombres del workspace o del proyecto, ni direcciones de fotos o links (van como marcas).

/** El tope de lo que se manda (el mismo de A2). Una página más larga manda una parte (`trimmed`). */
export const MAP_MAX_CHARS = 20_000;

/** El tipo de un renglón del mapa: títulos, párrafo, renglón con rótulo, casilla, viñeta, numerado y celda. */
export type TargetCode = 'H1' | 'H2' | 'H3' | 'P' | 'L' | 'K' | 'B' | 'N' | 'C';

/** Un lugar donde se puede escribir (o que se nombra): un bloque de texto o una celda. */
export interface Target {
  addr: string;
  kind: 'cell' | 'block';
  code: TargetCode;
  /** El bloque (para una celda, el de su tabla). */
  blockId: string;
  /** El tipo del nodo de texto (`paragraph`, `heading`, `checkListItem`, `tableParagraph`…). */
  nodeType: string;
  /** El rótulo de un renglón (`Afternoon:`); vacío en lo demás. */
  label: string;
  /** El texto que se puede escribir (después del rótulo), con las marcas `⟦photo:N⟧` y `⟦link:N⟧…⟦/link⟧`. */
  text: string;
  /** Lo mismo, legible (las fotos como ▣, los links sin marcas). */
  plain: string;
  checked?: boolean;
  /** El título de la sección (H1 o H2) de arriba. */
  section: string;
  /** El título H3 de arriba, adentro de esa sección. */
  sub: string;
  // --- Celdas ---
  table?: number;
  row?: number;
  col?: number;
  /** El texto de la primera celda de su fila (la *Slate*, el rótulo de la ficha). */
  rowLabel?: string;
  /** El encabezado de su columna (vacío si la tabla no tiene fila de encabezado). */
  colLabel?: string;
  /** Una celda de rótulo (encabezado o primera columna de una ficha): no se escribe. */
  labelCell?: boolean;
  // --- La foto ---
  /** Dónde empieza el contenido del bloque de texto (al tomar la foto). */
  start: number;
  /** Las unidades del contenido entero (palabras, signos, fotos, saltos), con sus posiciones. */
  units: OldUnit[];
  /** Cuántas unidades son del rótulo (las que no se escriben). */
  labelUnits: number;
  photos: Map<number, PMNode>;
  links: Map<number, Mark>;
  /** El contenido tal cual (JSON), para la guarda al aplicar. */
  content: string;
  /** El ancla al principio del contenido (sigue al elemento de Yjs aunque se agregue algo antes). */
  anchor: Y.RelativePosition | null;
}

export interface MapTable {
  n: number;
  blockId: string;
  section: string;
  sub: string;
  headerRow: boolean;
  labelCol: boolean;
  cols: number;
  /** Las celdas por fila (desde la fila 1). */
  rows: Target[][];
}

/** La sección de un plano en *VFX shots*: un H3 `Shot …` y sus casillas. */
export interface ShotSection {
  heading: Target;
  /** El nombre del plano (vacío en la sección que trae la plantilla). */
  name: string;
  /** La palabra del título (`Shot`, `Plano`). */
  word: string;
  checks: Target[];
  /** El último bloque de la sección (donde se agrega la siguiente). */
  lastBlockId: string;
}

export interface PageMap {
  text: string;
  lang: 'en' | 'es';
  targets: Map<string, Target>;
  tables: MapTable[];
  shots: ShotSection[];
  /** El título de la sección de los planos (*VFX shots*), si la página la tiene. */
  vfx: { blockId: string; text: string } | null;
  /** El título *Summary* (para *Add to Summary*). */
  summary: { blockId: string; addr: string } | null;
  /** Dónde está el cursor: la dirección, la fila de una tabla y la sección de un plano. */
  cursor: { addr: string; table?: number; row?: number; shot?: string } | null;
  /** La página era larga: se mandó una parte. */
  trimmed: boolean;
}

interface Binding {
  type: Y.XmlFragment;
  mapping: unknown;
}

function bindingOf(state: EditorState): Binding | null {
  return ((ySyncPluginKey.getState(state as never) as { binding?: Binding } | undefined)?.binding ?? null) as Binding | null;
}

/** Sin mayúsculas, acentos, signos de separación ni espacios de más: para comparar rótulos. */
export function labelKey(text: string): string {
  return normalizeLabel(text)
    .replace(/[\s·•.\-_/|:,;]+/g, ' ')
    .trim();
}

/** El nombre de un plano en un título `Shot 12_010` / `Plano 12_010` (o `null` si no es la sección de un plano). */
export function shotOfHeading(text: string): { word: string; name: string } | null {
  const m = /^\s*(shot|plano)\b[\s:#-]*(.*)$/i.exec(text);
  return m ? { word: m[1], name: m[2].trim() } : null;
}

const VFX_HEADINGS = new Set(['vfx shots', 'planos de vfx']);
const SUMMARY_HEADINGS = new Set(['summary', 'resumen']);

/** Los títulos de las plantillas de fábrica en cada idioma (para saber en qué idioma está la página). */
let headingWords: { en: Set<string>; es: Set<string> } | null = null;
function langWords() {
  if (headingWords) return headingWords;
  const collect = (lang: string) => {
    const t = builtinTexts(lang);
    const out = new Set<string>();
    for (const group of [t.onset, t.prepro, t.shot] as unknown as Record<string, unknown>[]) {
      for (const v of Object.values(group)) {
        if (typeof v === 'string') out.add(labelKey(v));
        else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string') out.add(labelKey(x));
      }
    }
    return out;
  };
  const en = collect('en');
  const es = collect('es');
  // Lo que se escribe igual en los dos idiomas no decide nada.
  for (const w of [...en]) if (es.has(w)) {
    en.delete(w);
    es.delete(w);
  }
  headingWords = { en, es };
  return headingWords;
}

/** El texto de unas unidades para el mapa: tal cual, con las fotos y los links como marcas. */
export function unitsText(units: OldUnit[]): string {
  let out = '';
  let link: number | null = null;
  for (const u of units) {
    const next = u.atom ? null : u.link;
    if (next !== link) {
      if (link !== null) out += '⟦/link⟧';
      if (next !== null) out += `⟦link:${next}⟧`;
      link = next;
    }
    if (u.atom === 'photo') out += `⟦photo:${u.key.slice('\u0001photo:'.length)}⟧`;
    else out += u.text;
  }
  if (link !== null) out += '⟦/link⟧';
  return out;
}

/** El texto legible de unas unidades (las fotos como ▣). */
export function unitsPlain(units: OldUnit[]): string {
  return units.map((u) => (u.atom === 'photo' ? '▣' : u.text)).join('');
}

/** Cuántas unidades del principio son el rótulo de un renglón (`Afternoon: `), o 0. */
function labelLength(units: OldUnit[]): number {
  let text = '';
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u.atom || u.link !== null) return 0;
    text += u.text;
    if (u.text === ':') {
      const label = text.slice(0, -1);
      if (label.length === 0 || label.length > 40 || !/\p{L}/u.test(label) || /[.!?]/.test(label)) return 0;
      // Los espacios que siguen son parte del rótulo.
      let j = i + 1;
      while (j < units.length && !units[j].atom && /^[ \t]+$/.test(units[j].text)) j++;
      return j;
    }
    if (text.length > 41) return 0;
  }
  return 0;
}

const q = (s: string) => JSON.stringify(s);

interface Line {
  text: string;
  /** El índice de la sección (H1/H2) donde está. */
  section: number;
  /** Se manda siempre, aunque la página sea larga (títulos, tablas, casillas, renglones con rótulo). */
  keep: boolean;
}

/**
 * Arma el mapa y la foto de la página. `title` es el título de la página (va arriba, como dato). `'empty'` si la página
 * no tiene nada donde escribir; `'tooLong'` si ni recortada entra en el tope.
 */
export function buildPageMap(state: EditorState, title: string, opts: { maxChars?: number; fallbackLang?: 'en' | 'es' } = {}): PageMap | 'empty' | 'tooLong' {
  const { doc } = state;
  const binding = bindingOf(state);
  const targets = new Map<string, Target>();
  const tables: MapTable[] = [];
  const shots: ShotSection[] = [];
  const lines: Line[] = [];
  let vfx: PageMap['vfx'] = null;
  let summary: PageMap['summary'] = null;
  let section = '';
  let sectionIndex = 0;
  let sub = '';
  let blockN = 0;
  let tableN = 0;
  let currentShot: ShotSection | null = null;
  const words = langWords();
  let en = 0;
  let es = 0;

  const anchorAt = (pos: number): Y.RelativePosition | null => {
    if (!binding) return null;
    try {
      return absolutePositionToRelativePosition(pos, binding.type, binding.mapping as never);
    } catch {
      return null;
    }
  };

  /** La foto de un bloque de texto que empieza (su nodo) en `pos`. */
  const snapshotOf = (node: PMNode, pos: number) => {
    const start = pos + 1;
    const photos = new Map<number, PMNode>();
    const links = new Map<number, Mark>();
    const units = oldUnits(doc, start, start + node.content.size, photos, links, { photo: 0, link: 0 });
    return { start, units, photos, links, content: JSON.stringify(node.content.toJSON() ?? []), anchor: anchorAt(start) };
  };

  const visitTable = (table: PMNode, tablePos: number, blockId: string) => {
    const n = ++tableN;
    const rows: Target[][] = [];
    let cols = 0;
    table.forEach((row, rowOffset, r) => {
      const rowPos = tablePos + 1 + rowOffset;
      const cells: Target[] = [];
      row.forEach((cell, cellOffset, c) => {
        const cellPos = rowPos + 1 + cellOffset;
        const para = cell.firstChild;
        const single = cell.childCount === 1 && !!para && para.isTextblock;
        const paraPos = cellPos + 1;
        const snap = single ? snapshotOf(para, paraPos) : { start: paraPos + 1, units: [] as OldUnit[], photos: new Map(), links: new Map(), content: '', anchor: null };
        const text = single ? unitsText(snap.units) : cell.textContent;
        cells.push({
          addr: `T${n} r${r + 1} c${c + 1}`,
          kind: 'cell',
          code: 'C',
          blockId,
          nodeType: para?.type.name ?? 'tableParagraph',
          label: '',
          text,
          plain: single ? unitsPlain(snap.units) : cell.textContent,
          section,
          sub,
          table: n,
          row: r + 1,
          col: c + 1,
          // Una celda con varios renglones no se escribe (no se sabe en cuál): se trata como un rótulo.
          labelCell: cell.type.name === 'tableHeader' || !single,
          labelUnits: 0,
          ...snap,
        });
      });
      cols = Math.max(cols, cells.length);
      rows.push(cells);
    });
    const headerRow = rows.length > 0 && rows[0].every((c) => isHeader(table, 0, c.col! - 1));
    const labelCol = !headerRow && rows.length > 0 && rows.every((_, i) => isHeader(table, i, 0));
    for (const [i, row] of rows.entries()) {
      for (const cell of row) {
        cell.rowLabel = row[0]?.plain ?? '';
        cell.colLabel = headerRow ? (rows[0][cell.col! - 1]?.plain ?? '') : '';
        if (headerRow && i === 0) cell.labelCell = true;
        if (labelCol && cell.col === 1) cell.labelCell = true;
        targets.set(cell.addr, cell);
      }
    }
    tables.push({ n, blockId, section, sub, headerRow, labelCol, cols, rows });
    // Las líneas de la tabla.
    const head = headerRow
      ? `T${n} header: ${rows[0].map((c) => `c${c.col} ${q(c.plain)}`).join(' | ')}`
      : labelCol
        ? `T${n} (column c1 holds the labels of each row; write in c2)`
        : `T${n} (no header row)`;
    lines.push({ text: head, section: sectionIndex, keep: true });
    for (const [i, row] of rows.entries()) {
      if (headerRow && i === 0) continue;
      lines.push({ text: `  r${i + 1} ${row.map((c) => `c${c.col} ${q(c.text)}`).join(' | ')}`, section: sectionIndex, keep: true });
    }
  };

  const visitBlock = (container: PMNode, pos: number) => {
    const blockId = String(container.attrs.id ?? '');
    const content = container.firstChild;
    const b = ++blockN;
    if (content) {
      const contentPos = pos + 1;
      if (content.type.name === 'table') visitTable(content, contentPos, blockId);
      else if (content.isTextblock && content.type.name !== 'codeBlock') {
        const snap = snapshotOf(content, contentPos);
        const type = content.type.name;
        let code: TargetCode = 'P';
        let label = '';
        let labelUnits = 0;
        if (type === 'heading') {
          const level = Number(content.attrs.level) || 1;
          code = level <= 1 ? 'H1' : level === 2 ? 'H2' : 'H3';
        } else if (type === 'checkListItem') code = 'K';
        else if (type === 'bulletListItem' || type === 'toggleListItem') code = 'B';
        else if (type === 'numberedListItem') code = 'N';
        if (code === 'P' || code === 'B' || code === 'N') {
          labelUnits = labelLength(snap.units);
          if (labelUnits > 0) {
            label = unitsPlain(snap.units.slice(0, labelUnits)).trimEnd();
            code = 'L';
          }
        }
        const writable = snap.units.slice(labelUnits);
        const plainAll = unitsPlain(snap.units);
        if (code === 'H1' || code === 'H2') {
          section = plainAll.trim();
          sectionIndex++;
          sub = '';
          currentShot = null;
          const key = labelKey(section);
          if (words.en.has(key)) en++;
          if (words.es.has(key)) es++;
          if (VFX_HEADINGS.has(key) && !vfx) vfx = { blockId, text: section };
          if (SUMMARY_HEADINGS.has(key) && !summary) summary = { blockId, addr: `b${b}` };
        } else if (code === 'H3') {
          sub = plainAll.trim();
          currentShot = null;
        }
        const target: Target = {
          addr: `b${b}`,
          kind: 'block',
          code,
          blockId,
          nodeType: type,
          label,
          text: unitsText(writable),
          plain: unitsPlain(writable),
          checked: type === 'checkListItem' ? !!content.attrs.checked : undefined,
          section,
          sub: code === 'H3' ? '' : sub,
          labelUnits,
          ...snap,
        };
        targets.set(target.addr, target);
        if (code === 'H3') {
          const shot = shotOfHeading(target.plain);
          if (shot) {
            currentShot = { heading: target, name: shot.name, word: shot.word, checks: [], lastBlockId: blockId };
            shots.push(currentShot);
            if (!vfx && section) vfx = { blockId: '', text: section };
          }
        } else if (currentShot) {
          if (code === 'K') currentShot.checks.push(target);
          // Un párrafo vacío al final no es parte de la sección (la plantilla deja uno antes del título siguiente).
          if (!(code === 'P' && target.plain.trim() === '')) currentShot.lastBlockId = blockId;
        }
        const line =
          code === 'L'
            ? `L b${b} ${q(label)} ${q(target.text)}`
            : code === 'K'
              ? `K b${b} [${target.checked ? 'x' : ' '}] ${q(target.text)}`
              : `${code} b${b} ${q(target.text)}`;
        lines.push({ text: line, section: sectionIndex, keep: code !== 'P' && code !== 'B' && code !== 'N' });
      }
    }
    // Los bloques de adentro (los que cuelgan de este).
    const group = container.childCount > 1 ? container.child(1) : null;
    if (group && group.type.name === 'blockGroup') {
      let offset = pos + 1 + container.child(0).nodeSize + 1;
      group.forEach((child) => {
        if (child.type.name === 'blockContainer') visitBlock(child, offset);
        offset += child.nodeSize;
      });
    }
  };

  doc.forEach((group, groupOffset) => {
    if (group.type.name !== 'blockGroup') return;
    group.forEach((child, childOffset) => {
      if (child.type.name === 'blockContainer') visitBlock(child, groupOffset + 1 + childOffset);
    });
  });

  // El título de *VFX shots* sin secciones de planos todavía, o el de la sección donde están.
  const vfxSection = vfx as PageMap['vfx'];
  if (vfxSection && !vfxSection.blockId) {
    for (const t of targets.values()) if (t.kind === 'block' && (t.code === 'H1' || t.code === 'H2') && t.plain.trim() === vfxSection.text) vfxSection.blockId = t.blockId;
  }

  if (targets.size === 0) return 'empty';

  // El cursor: la celda o el bloque donde está.
  let cursor: PageMap['cursor'] = null;
  const $from = state.selection.$from;
  if ($from.parent.isTextblock) {
    for (const t of targets.values()) {
      if ($from.start() !== t.start) continue;
      cursor = { addr: t.addr, table: t.table, row: t.row };
      break;
    }
  }
  if (cursor) {
    const at = targets.get(cursor.addr)!;
    const shot = shots.find((s) => s.heading.addr === at.addr || s.checks.some((c) => c.addr === at.addr));
    if (shot) cursor.shot = shot.name;
  }

  const lang: 'en' | 'es' = es > en ? 'es' : en > es ? 'en' : (opts.fallbackLang ?? 'en');
  const header = [`PAGE ${q(title.replace(/\s+/g, ' ').trim())} LANG ${lang}`, `CURSOR ${cursor?.addr ?? 'none'}`];
  const max = opts.maxChars ?? MAP_MAX_CHARS;
  let body = lines.map((l) => l.text);
  let trimmed = false;
  const size = (ls: string[]) => header.join('\n').length + ls.reduce((n, l) => n + l.length + 1, 0);
  if (size(body) > max) {
    // Larga: van las tablas, las casillas, los títulos, los renglones con rótulo y la sección del cursor entera.
    const cursorLine = cursor ? lines.findIndex((l) => new RegExp(`(^|\\s)${cursor!.addr.split(' ')[0]}(\\s|$)`).test(l.text)) : -1;
    const cursorSection = cursorLine >= 0 ? lines[cursorLine].section : -1;
    body = lines.filter((l) => l.keep || l.section === cursorSection).map((l) => l.text);
    body.push('(The page is long: the text of some sections was left out.)');
    trimmed = true;
    if (size(body) > max) return 'tooLong';
  }
  const text = [...header, ...body].join('\n');
  return { text, lang, targets, tables, shots, vfx: vfxSection, summary, cursor, trimmed };
}

/** Si la celda de esa fila y columna de la tabla es de encabezado. */
function isHeader(table: PMNode, row: number, col: number): boolean {
  const r = row < table.childCount ? table.child(row) : null;
  const c = r && col < r.childCount ? r.child(col) : null;
  return c?.type.name === 'tableHeader';
}

/** Las palabras de un rótulo de fila que identifican un plano (`12 · 010 · 3` → `12`, `10`, `3`). */
function digitGroups(text: string): number[] {
  return [...text.matchAll(/\d+/g)].map((m) => Number(m[0]));
}

/**
 * Si la nota nombra ese plano: los dos primeros números del rótulo seguidos en la nota (`12_010`, `12 010`, `12-10`),
 * o el rótulo entero si no tiene números. Es la única señal de *Row chosen by the assistant* que no depende del modelo.
 */
export function noteMentions(note: string, label: string): boolean {
  const want = digitGroups(label);
  if (want.length === 0) {
    const key = labelKey(label);
    return key.length > 0 && labelKey(note).includes(key);
  }
  const have = digitGroups(note);
  const need = want.slice(0, Math.min(2, want.length));
  for (let i = 0; i + need.length <= have.length; i++) if (need.every((n, j) => have[i + j] === n)) return true;
  return false;
}
