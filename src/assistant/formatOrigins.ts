import type { EditorState } from '@tiptap/pm/state';
import type { AssistantEditor } from './assistantUi';
import type { Snapshot } from './apply';
import type { Atom, ProtectedTrace } from './markup';
import { inlineContent, type MdBlock, type Restore } from './mdBlocks';

type Inline = { type: string; text?: string; content?: Inline[]; styles?: Record<string, unknown>; [key: string]: unknown };
type Run = { id: string; text: string; from: number; to: number; styles: Record<string, string>; valid: boolean };
type Origin = { id: string; pm: string; bn: string; start: number; size: number; textblocks: number; runs: Run[]; core?: { from: number; to: number } };
type Content = ReturnType<typeof inlineContent>;
export interface FormatOrigins {
  from: number; to: number; nonce: string; blocks: Map<string, Origin>; runs: Map<string, Run>; protected: Map<string, ProtectedTrace>;
}
export type PreparedFormat = { blocks: MdBlock[]; prepare: () => Map<Atom[], Content> | null };
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const arrays = (blocks: MdBlock[]) => blocks.flatMap((b) => b.kind === 'text' ? [b.atoms] : b.kind === 'table' ? b.rows.flat() : []);

/** Captura contenedores completos y sus marcas antes de que el collector recorte los bordes. */
export function captureFormatOrigins(state: EditorState, editor: AssistantEditor, from: number, to: number): FormatOrigins {
  const out: FormatOrigins = { from, to, nonce: crypto.randomUUID().replaceAll('-', ''), blocks: new Map(), runs: new Map(), protected: new Map() };
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === 'blockContainer') {
      const id = String(node.attrs.id ?? '');
      if (id) out.blocks.set(id, { id, pm: JSON.stringify(node.toJSON()), bn: JSON.stringify(editor.getBlock(id)), start: 0, size: 0, textblocks: 0, runs: [] });
    }
    if (!node.isTextblock) return true;
    const at = state.doc.resolve(pos);
    let id = '';
    for (let d = at.depth; d >= 0; d--) if (at.node(d).type.name === 'blockContainer') { id = String(at.node(d).attrs.id ?? ''); break; }
    const origin = out.blocks.get(id);
    if (!origin) return false;
    origin.start = pos + 1;
    origin.size = node.content.size;
    origin.textblocks++;
    node.forEach((child, offset) => {
      if (!child.isText || child.marks.some((m) => m.type.name === 'link')) return;
      const styles: Record<string, string> = {};
      let valid = true;
      for (const mark of child.marks) {
        if (mark.type.name === 'textColor' || mark.type.name === 'backgroundColor') {
          if (typeof mark.attrs.stringValue !== 'string' || Object.keys(mark.attrs).some((k) => k !== 'stringValue')) valid = false;
          else styles[mark.type.name] = mark.attrs.stringValue;
        } else if (!['bold', 'italic', 'underline', 'strike', 'code'].includes(mark.type.name)) valid = false;
      }
      origin.runs.push({ id: '', text: child.text!, from: offset, to: offset + child.nodeSize, styles, valid });
    });
    return false;
  });
  while ([...out.blocks.values()].some((b) => b.bn.includes(out.nonce))) out.nonce = crypto.randomUUID().replaceAll('-', '');
  return out;
}

export function traceFormatProtected(origins: FormatOrigins, entry: ProtectedTrace): void {
  const key = `${entry.kind}:${entry.n}`, previous = origins.protected.get(key);
  origins.protected.set(key, previous ? { ...entry, from: Math.min(previous.from, entry.from), to: Math.max(previous.to, entry.to) } : { ...entry });
}

export function bindFormatOrigins(origins: FormatOrigins, snapshot: Snapshot): boolean {
  const ids = new Set(snapshot.selected.pieces.map((p) => p.blockId));
  for (const id of origins.blocks.keys()) if (!ids.has(id)) origins.blocks.delete(id);
  for (const p of snapshot.selected.pieces) {
    const b = origins.blocks.get(p.blockId);
    if (!b) return false;
    if (p.kind !== 'text') continue;
    if (b.core || b.textblocks !== 1) return false;
    b.core = { from: p.from - b.start, to: p.to - b.start };
    if (b.core.from < 0 || b.core.to > b.size) return false;
    b.runs = b.runs.flatMap((r) => {
      const from = Math.max(r.from, b.core!.from), to = Math.min(r.to, b.core!.to);
      if (to <= from) return [];
      const run = { ...r, id: `r${origins.runs.size}`, from, to, text: r.text.slice(from - r.from, to - r.from) };
      origins.runs.set(run.id, run);
      return [run];
    });
  }
  return true;
}

export function formatWire(origins: FormatOrigins, snapshot: Snapshot): unknown {
  return { version: 1, nonce: origins.nonce, markdown: snapshot.selected.markdown, blocks: [...origins.blocks.values()].map((b) => ({ sourceBlock: b.id, runs: b.runs.map((r) => ({ sourceId: r.id, text: r.text })) })) };
}

export function formatOriginsUnchanged(state: EditorState, editor: AssistantEditor, origins: FormatOrigins, shift: number): boolean {
  const current = captureFormatOrigins(state, editor, origins.from + shift, origins.to + shift);
  for (const [id, b] of origins.blocks) {
    const now = current.blocks.get(id);
    if (!now || now.pm !== b.pm || now.bn !== b.bn || now.start !== b.start + shift) return false;
  }
  return true;
}

/** Recorta el contenido lógico de origen, conservando todos sus campos y objetos. */
function sliceInline(items: Inline[], from: number, to: number): Inline[] | null {
  const result: Inline[] = [];
  let cursor = 0;
  for (const item of items) {
    const length = item.type === 'link' ? item.content?.reduce((n, c) => n + (c.text?.length ?? 0), 0) ?? 0 : item.text?.length ?? 1;
    const lo = Math.max(from, cursor), hi = Math.min(to, cursor + length);
    if (hi > lo) {
      if (item.type === 'text') result.push({ ...clone(item), text: item.text!.slice(lo - cursor, hi - cursor) });
      else if (item.type === 'link') {
        const content = sliceInline(item.content ?? [], lo - cursor, hi - cursor);
        if (!content) return null;
        result.push({ ...clone(item), content });
      } else if (lo === cursor && hi === cursor + length) result.push(clone(item));
      else return null;
    }
    cursor += length;
  }
  return cursor >= to ? result : null;
}

function protectedInline(origins: FormatOrigins, kind: 'link' | 'photo', n: number): Inline[] | null {
  const range = origins.protected.get(`${kind}:${n}`);
  if (!range) return null;
  const b = [...origins.blocks.values()].find((x) => x.core && range.from >= x.start && range.to <= x.start + x.size);
  if (!b || !b.core || range.from < b.start + b.core.from || range.to > b.start + b.core.to) return null;
  const items = JSON.parse(b.bn).content;
  return Array.isArray(items) ? sliceInline(items, range.from - b.start, range.to - b.start) : null;
}

export function prepareFormatAnswer(answer: string, origins: FormatOrigins, parse: (markdown: string) => MdBlock[] | string, restore: Restore): PreparedFormat | null {
  let data: { version: number; nonce: string; markdown: string; spans: { id: number; origin: string; text: string }[] };
  try { data = JSON.parse(answer); } catch { return null; }
  if (!data || data.version !== 1 || data.nonce !== origins.nonce || typeof data.markdown !== 'string' || !Array.isArray(data.spans) || answer.length > 160_000) return null;
  const spans = new Map<number, { origin: Run; text: string }>(), covered = new Set<string>(), used = new Set<number>();
  for (const span of data.spans) {
    if (!span || !Number.isSafeInteger(span.id) || span.id < 0 || spans.has(span.id) || typeof span.text !== 'string' || !span.text || /[\r\n]/.test(span.text)) return null;
    const origin = origins.runs.get(span.origin);
    if (!origin) return null;
    spans.set(span.id, { origin, text: span.text });
    covered.add(origin.id);
  }
  if (covered.size !== origins.runs.size) return null;
  const parsed = parse(data.markdown);
  if (typeof parsed === 'string') return null;
  const atomOrigins = new Map<Atom, Run>();
  let valid = true;
  const expand = (atoms: Atom[]): Atom[] => {
    const result: Atom[] = [];
    for (let i = 0; i < atoms.length;) {
      const first = atoms[i];
      if (first.t !== 'char' || first.link !== null) { result.push(first); i++; continue; }
      let text = '', j = i;
      while (j < atoms.length && atoms[j].t === 'char' && (atoms[j] as Extract<Atom, { t: 'char' }>).link === null) text += (atoms[j++] as Extract<Atom, { t: 'char' }>).ch;
      const prefix = `SD${origins.nonce}R`, match = new RegExp(`^${prefix}(\\d+)END`).exec(text);
      if (!match) { valid = false; return []; }
      const id = Number(match[1]), span = spans.get(id);
      let chars = '', end = i;
      while (end < j && chars.length < match[0].length) {
        const a = atoms[end++] as Extract<Atom, { t: 'char' }>;
        if (JSON.stringify(a.marks) !== JSON.stringify(first.marks)) valid = false;
        chars += a.ch;
      }
      if (!span || used.has(id) || chars !== match[0]) { valid = false; return []; }
      used.add(id);
      for (const ch of span.text) {
        const atom: Atom = { t: 'char', ch, marks: [...first.marks], link: null };
        atomOrigins.set(atom, span.origin);
        result.push(atom);
      }
      i = end;
    }
    return result;
  };
  const blocks: MdBlock[] = parsed.map((b) => b.kind === 'text' ? { ...b, atoms: expand(b.atoms) } : b.kind === 'table' ? { ...b, rows: b.rows.map((row) => row.map(expand)) } : b);
  if (!valid || used.size !== spans.size) return null;
  const prepare = () => {
    const content = new Map<Atom[], Content>();
    for (const atoms of arrays(blocks)) {
      const result: Inline[] = [];
      for (let i = 0; i < atoms.length;) {
        const atom = atoms[i];
        if (atom.t === 'char' && atom.link !== null) {
          let text = '', j = i;
          while (j < atoms.length && atoms[j].t === 'char' && (atoms[j] as Extract<Atom, { t: 'char' }>).link === atom.link) text += (atoms[j++] as Extract<Atom, { t: 'char' }>).ch;
          const original = protectedInline(origins, 'link', atom.link);
          if (!original || original.length !== 1 || original[0].type !== 'link' || original[0].content?.map((x) => x.text ?? '').join('') !== text) return null;
          result.push(...original);
          i = j;
        } else if (atom.t === 'photo') {
          const original = protectedInline(origins, 'photo', atom.n);
          if (!original) return null;
          result.push(...original);
          i++;
        } else {
          const origin = atomOrigins.get(atom);
          if (!origin?.valid) return null;
          let j = i + 1;
          while (j < atoms.length && atomOrigins.get(atoms[j]) === origin) j++;
          const chunk = inlineContent(atoms.slice(i, j), restore);
          for (const item of chunk) {
            if (item.type !== 'text') return null;
            result.push({ ...item, styles: { ...item.styles, ...origin.styles } });
          }
          i = j;
        }
      }
      content.set(atoms, result as Content);
    }
    return content;
  };
  return { blocks, prepare };
}

export function addFormatBorders(origins: FormatOrigins, blockId: string, content: Content): Content | null {
  const b = origins.blocks.get(blockId);
  if (!b?.core) return null;
  const items = JSON.parse(b.bn).content;
  if (!Array.isArray(items)) return null;
  const prefix = sliceInline(items, 0, b.core.from), suffix = sliceInline(items, b.core.to, b.size);
  return prefix && suffix ? [...prefix, ...content, ...suffix] as Content : null;
}

export const preparedFormatComplete = (blocks: MdBlock[], prepared: Map<Atom[], Content> | undefined): boolean => !!prepared && arrays(blocks).every((a) => prepared.has(a));
export const formatHasBorders = (origins: FormatOrigins): boolean => [...origins.blocks.values()].some((b) => b.core && (b.core.from !== 0 || b.core.to !== b.size));
export const formatReplacePropsSafe = (origins: FormatOrigins): boolean => [...origins.blocks.values()].every((b) => {
  if (!b.core) return true;
  const block = JSON.parse(b.bn);
  return !block.children?.length && Object.entries(block.props).every(([key, value]) => ['level', 'checked', 'script'].includes(key) || value === 'default' || value === false || (key === 'textAlignment' && value === 'left'));
});
