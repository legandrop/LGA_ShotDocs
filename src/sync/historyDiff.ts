import * as Y from 'yjs';
import type { PageHistory } from './history';
import { CONTENT_FRAGMENT, normalizeStructure } from './structure';

// Los cambios de una versión contra la anterior de la lista (P.18, Docs/Doc_Historial.md, secciones 5.1 a 5.3,
// entrega 2). Se arma un documento NUEVO, en memoria, con la UNIÓN de las dos versiones (lo que se ve en alguna de
// las dos, en orden de documento, con lo borrado como texto común) y, aparte, las marcas: qué tramo se agregó o se
// borró, qué bloque entero, qué bloque cambió de tipo o de formato, y la fila que lo trajo (de ahí salen quién y
// cuándo). La pantalla lo muestra con el editor de solo lectura y pinta las marcas con decoraciones: el esquema no
// cambia (nada de marcas ni tipos nuevos) y el documento del historial no se toca (solo se recorre).
//
// - Lo agregado y lo borrado salen de Yjs (`toDelta` con los dos snapshots): exacto, letra por letra, sin adivinar.
// - **Bloques apareados por id:** y-prosemirror rehace algunos bloques (los borra y los crea de nuevo con el mismo id:
//   cambiar el tipo, sangrar, mover, unir). Con Yjs puro se vería todo el texto borrado y vuelto a escribir. Un bloque
//   borrado y uno agregado con el mismo id entre las dos versiones se muestran como UN bloque que cambió (el rótulo
//   del tipo, o "se movió"), y su texto se compara letra por letra (diferencia de texto). Lo mismo con el contenido de
//   un bloque que se cambió en el lugar (el bloque queda y su párrafo pasa a título).
// - **Solo lo que cambió:** con `scope = 'changed'` (lo de la app) la diferencia con los dos snapshots se calcula
//   solo en los bloques que tocó alguna fila del medio (lo que agregaron o borraron por primera vez); el resto se copia
//   como está en la versión. Una prueba compara las dos formas en casos al azar.

/** Una posición en el documento de la unión (`Y.relativePositionToJSON`): viaja del Worker a la pantalla tal cual. */
export type RelPosJSON = Record<string, unknown>;

/** El tipo de un bloque, para el rótulo "Changed to …". */
export interface BlockKind {
  type: string;
  level?: number;
  /** La propiedad que lo vuelve otra cosa (Script, pregunta, salto de hoja, tarjeta de Drive). */
  prop?: string;
}

export type ChangeLabel = { kind: 'type'; to: BlockKind } | { kind: 'format' } | { kind: 'moved' };

/** Un tramo de texto agregado o borrado. */
export interface TextMark {
  type: 'text';
  kind: 'add' | 'del';
  from: RelPosJSON;
  to: RelPosJSON;
  /** La fila que lo trajo (índice en `rows`): quién y cuándo. */
  row: number;
}

/** Un nodo agregado, borrado o que cambió (un bloque entero, una foto en línea, una fila de una tabla). */
export interface NodeMark {
  type: 'node';
  kind: 'add' | 'del' | 'change';
  /** El nodo: la posición justo antes de él. */
  at: RelPosJSON;
  row: number;
  /** Si es el contenido de un bloque (la barra a la izquierda); si no, un nodo adentro de uno (una foto en línea). */
  block: boolean;
  label?: ChangeLabel;
}

export type HistoryMark = TextMark | NodeMark;

export interface VersionChanges {
  /** El documento de la unión (`encodeStateAsUpdate`). */
  update: Uint8Array;
  marks: HistoryMark[];
  /** Cuántos bloques se diferenciaron (para medir: "solo lo que cambió"). */
  touched: number;
}

/** Las propiedades de un párrafo que lo vuelven otra cosa (editorSchema.ts), en el orden en que se miran. */
const KIND_PROPS = ['pageBreak', 'question', 'script', 'driveCard'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyType = Y.AbstractType<any>;
type State = 'both' | 'add' | 'del';
type Attrs = Record<string, unknown>;
interface Run {
  text: string;
  attrs: Attrs;
  /** El id de Yjs del primer elemento del tramo. */
  client: number;
  clock: number;
}
interface PendingText {
  kind: 'add' | 'del';
  from: number;
  to: number;
  row: number;
}

const EMPTY = (): Y.Snapshot => Y.createSnapshot(Y.createDeleteSet(), new Map());
const BLOCK = 'blockContainer';
const GROUP = 'blockGroup';
/** El renglón de los huecos estables de las fotos en línea (no es un nodo del editor; history.ts lo compara). */
const STABLE_GAPS = 'lgaStableGaps';
/** Lo más largo que se compara letra por letra (la tabla es largo × largo). */
const MAX_DIFF_CELLS = 4_000_000;

const visible = (item: Y.Item, s: Y.Snapshot) => (s.sv.get(item.id.client) ?? 0) > item.id.clock && !Y.isDeleted(s.ds, item.id);

function childItems(type: AnyType): Y.Item[] {
  const out: Y.Item[] = [];
  for (let n = type._start; n !== null; n = n.right) if (n.content instanceof Y.ContentType) out.push(n);
  return out;
}

const typeOf = (item: Y.Item) => (item.content as Y.ContentType).type as AnyType;
const isElement = (t: unknown, name?: string): t is Y.XmlElement => t instanceof Y.XmlElement && (name === undefined || t.nodeName === name);

function cleanAttrs(attrs: Attrs | null | undefined): Attrs {
  const out: Attrs = {};
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (k !== 'ychange' && v !== null && v !== undefined) out[k] = v;
  return out;
}

const sameAttrs = (a: Attrs, b: Attrs) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
};

/** El tipo de un contenido de bloque con sus propiedades. */
export function blockKind(nodeName: string, attrs: Attrs): BlockKind {
  const prop = nodeName === 'paragraph' ? KIND_PROPS.find((p) => attrs[p] === true || attrs[p] === 'true') : undefined;
  const out: BlockKind = { type: nodeName };
  if (nodeName === 'heading' && attrs.level !== undefined) out.level = Number(attrs.level);
  if (prop) out.prop = prop;
  return out;
}

const sameKind = (a: BlockKind, b: BlockKind) => a.type === b.type && a.level === b.level && a.prop === b.prop;

/** Lo que dice cada letra: `=` igual, `+` agregada, `-` borrada (la diferencia de dos textos, LCS). */
export function diffText(a: string, b: string): ('=' | '+' | '-')[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const out: ('=' | '+' | '-')[] = [];
  for (let i = 0; i < start; i++) out.push('=');
  const n = endA - start;
  const m = endB - start;
  if (n > 0 && m > 0 && n * m <= MAX_DIFF_CELLS) {
    // La tabla de la subsecuencia común más larga, de atrás para adelante (una fila por letra de `a`).
    const len: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        len[i][j] = a[start + i] === b[start + j] ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) {
        out.push('=');
        i++;
        j++;
      } else if (len[i + 1][j] >= len[i][j + 1]) {
        out.push('-');
        i++;
      } else {
        out.push('+');
        j++;
      }
    }
    for (; i < n; i++) out.push('-');
    for (; j < m; j++) out.push('+');
  } else {
    for (let i = 0; i < n; i++) out.push('-');
    for (let j = 0; j < m; j++) out.push('+');
  }
  for (let i = endA; i < a.length; i++) out.push('=');
  return out;
}

class UnionBuilder {
  readonly doc = new Y.Doc();
  readonly marks: HistoryMark[] = [];
  private readonly empty = EMPTY();
  /** Los pares (agregado → borrado) de bloques con el mismo id entre las dos versiones, y los borrados apareados. */
  private readonly pairs = new Map<Y.XmlElement, Y.XmlElement>();
  private readonly pairedOld = new Set<Y.XmlElement>();
  touchedCount = 0;

  constructor(
    private readonly h: PageHistory,
    private readonly prev: Y.Snapshot,
    private readonly cur: Y.Snapshot,
    /** Los bloques que tocó alguna fila del medio; `null`: todos (la diferencia completa). */
    private readonly touched: Set<AnyType> | null,
  ) {}

  private isTouched(container: AnyType | null): boolean {
    // Algo suelto fuera de un bloque (una estructura rota): siempre con la diferencia completa.
    return this.touched === null || container === null || this.touched.has(container);
  }

  private stateOf(item: Y.Item, parent: State): State | null {
    const inCur = parent !== 'del' && visible(item, this.cur);
    const inPrev = parent !== 'add' && visible(item, this.prev);
    return inCur && inPrev ? 'both' : inCur ? 'add' : inPrev ? 'del' : null;
  }

  /** Visible con todo lo de arriba en ese snapshot (un bloque que llegó a algo ya borrado no cuenta). */
  private reachable(type: AnyType, s: Y.Snapshot): boolean {
    for (let t: AnyType | null = type; t && t._item; t = t._item.parent as AnyType) {
      if (!visible(t._item, s)) return false;
    }
    return true;
  }

  private idOf(el: Y.XmlElement, s: Y.Snapshot): string {
    const v = Y.typeMapGetSnapshot(el, 'id', s);
    return v === undefined || v === null ? '' : String(v);
  }

  private isSeed(item: Y.Item | null): boolean {
    return !!item && this.h.seedClients.has(item.id.client);
  }

  /** Antes de recorrer: los bloques que se agregaron o se borraron entre las dos versiones, por id. */
  pairCandidates(candidates: Iterable<AnyType>): void {
    const added = new Map<string, Y.XmlElement[]>();
    const removed = new Map<string, Y.XmlElement[]>();
    for (const t of candidates) {
      if (!isElement(t, BLOCK) || !t._item) continue;
      const inCur = this.reachable(t, this.cur);
      const inPrev = this.reachable(t, this.prev);
      const into = inCur && !inPrev ? added : inPrev && !inCur ? removed : null;
      const id = into ? this.idOf(t, into === added ? this.cur : this.prev) : '';
      if (into && id) into.set(id, [...(into.get(id) ?? []), t]);
    }
    // Uno con uno, en el orden de Yjs (el mismo en las dos formas de calcular): dos dispositivos que rehacen el mismo
    // bloque a la vez dejan dos con el mismo id; el de más se muestra agregado (o borrado).
    const order = (a: Y.XmlElement, b: Y.XmlElement) => a._item!.id.client - b._item!.id.client || a._item!.id.clock - b._item!.id.clock;
    for (const [id, news] of added) {
      const olds = removed.get(id);
      if (!olds) continue;
      news.sort(order);
      olds.sort(order);
      for (let i = 0; i < Math.min(news.length, olds.length); i++) {
        this.pairs.set(news[i], olds[i]);
        this.pairedOld.add(olds[i]);
      }
    }
  }

  build(): void {
    const fragment = this.h.doc.getXmlFragment(CONTENT_FRAGMENT);
    const out = this.doc.getXmlFragment(CONTENT_FRAGMENT);
    this.doc.transact(() => {
      // Las raíces que se ven en alguna de las dos, juntas en una (como `mergeRootGroups`: los bloques de las demás,
      // al final de la primera).
      const roots = childItems(fragment).filter((n) => this.stateOf(n, 'both') !== null && isElement(typeOf(n), GROUP));
      if (roots.length === 0) return;
      const root = new Y.XmlElement(GROUP);
      out.insert(0, [root]);
      for (const n of roots) this.groupChildren(typeOf(n) as Y.XmlElement, this.stateOf(n, 'both')!, root);
    });
  }

  /** Los hijos de un grupo de bloques (con el estado del grupo) al final de `dst`. */
  private groupChildren(src: Y.XmlElement, state: State, dst: Y.XmlElement): void {
    for (const n of childItems(src)) {
      const st = this.stateOf(n, state);
      if (!st) continue;
      const t = typeOf(n);
      if (isElement(t, BLOCK)) this.container(t, st, dst);
      else this.node(t, st, state, dst, null, false);
    }
  }

  private push(dst: Y.XmlElement | Y.XmlFragment, el: Y.XmlElement | Y.XmlText): void {
    dst.insert(dst.length, [el]);
  }

  private setAttrs(el: Y.XmlElement | Y.XmlText, attrs: Attrs): void {
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, v as never);
  }

  private snapOf(state: State): Y.Snapshot {
    return state === 'del' ? this.prev : this.cur;
  }

  /** Un bloque: el contenido y sus hijos, con su marca si se agregó o se borró entero. */
  private container(src: Y.XmlElement, st: State, dst: Y.XmlElement): void {
    const snap = this.snapOf(st);
    // Un bloque borrado que se rehízo con el mismo id se muestra en el nuevo; acá quedan solo sus hijos borrados de
    // verdad (los que no se rehicieron), en su lugar.
    if (st === 'del' && this.pairedOld.has(src)) {
      this.unpairedRemoved(src, dst);
      return;
    }
    const old = st === 'add' ? this.pairs.get(src) : undefined;
    const touched = this.isTouched(src) || !!old;
    if (touched) this.touchedCount++;
    const el = new Y.XmlElement(BLOCK);
    this.push(dst, el);
    this.setAttrs(el, Y.typeMapGetAllSnapshot(src, snap));
    const kids = childItems(src)
      .map((n) => ({ t: typeOf(n), st: this.stateOf(n, st) }))
      .filter((k): k is { t: AnyType; st: State } => k.st !== null);
    const contents = kids.filter((k) => !isElement(k.t, GROUP));
    const groups = kids.filter((k) => isElement(k.t, GROUP));
    // El contenido: apareado con el del bloque borrado del mismo id, o con el que reemplazó en el lugar.
    const newContent = contents.find((k) => k.st !== 'del' && k.t instanceof Y.XmlElement);
    const oldContent = old
      ? childItems(old).map(typeOf).find((t) => isElement(t) && t.nodeName !== GROUP && visible(t._item!, this.prev))
      : st === 'both' && newContent?.st === 'add'
        ? contents.find((k) => k.st === 'del' && k.t instanceof Y.XmlElement)?.t
        : undefined;
    let first: Y.XmlElement | null = null;
    for (const k of contents) {
      if (oldContent && k.t === oldContent) continue;
      if (oldContent && newContent && k.t === newContent.t) {
        const row = old ? this.h.insertRow(src._item!.id.client, src._item!.id.clock) : this.h.insertRow(k.t._item!.id.client, k.t._item!.id.clock);
        const made = this.paired(newContent.t as Y.XmlElement, oldContent as Y.XmlElement, el, row, old ? this.moved(src, old) : false);
        first ??= made;
        continue;
      }
      const made = this.node(k.t, k.st, st, el, src, true);
      if (made instanceof Y.XmlElement) first ??= made;
      // El formato o el tipo (título 1 a 2) cambiado en el lugar.
      if (made instanceof Y.XmlElement && k.st === 'both' && touched) this.inPlaceLabel(k.t as Y.XmlElement, made);
    }
    if (groups.length > 0) {
      const group = new Y.XmlElement(GROUP);
      this.push(el, group);
      for (const g of groups) this.groupChildren(g.t as Y.XmlElement, g.st, group);
      if (group.length === 0) el.delete(el.length - 1, 1);
    }
    // El bloque entero agregado o borrado (no la semilla: estructura vacía igual en todos los dispositivos).
    if ((st === 'add' && !old) || st === 'del') {
      const item = src._item!;
      if (!this.isSeed(item) && first) {
        const row = st === 'add' ? this.h.insertRow(item.id.client, item.id.clock) : this.h.deleteRow(item.id.client, item.id.clock);
        this.marks.push({ type: 'node', kind: st, at: this.at(first), row, block: true });
      }
    }
  }

  /** Los hijos borrados de verdad de un bloque que se rehízo (los que no tienen un bloque nuevo con su id). */
  private unpairedRemoved(src: Y.XmlElement, dst: Y.XmlElement): void {
    for (const n of childItems(src)) {
      const g = typeOf(n);
      if (!isElement(g, GROUP) || !visible(n, this.prev)) continue;
      for (const c of childItems(g)) {
        const t = typeOf(c);
        if (!visible(c, this.prev) || !isElement(t, BLOCK)) continue;
        // Con el grupo borrado: solo lo que se veía antes.
        this.container(t, 'del', dst);
      }
    }
  }

  /** Si el bloque rehecho está en otro lugar: otro padre u otro bloque antes. */
  private moved(now: Y.XmlElement, before: Y.XmlElement): boolean {
    const place = (t: Y.XmlElement, s: Y.Snapshot) => {
      let left: Y.Item | null = t._item!.left;
      while (left && !(visible(left, s) && left.content instanceof Y.ContentType)) left = left.left;
      const prevId = left ? this.idOf(typeOf(left) as Y.XmlElement, s) : '';
      const parent = (t._item!.parent as AnyType)._item?.parent as AnyType | undefined;
      const parentId = isElement(parent, BLOCK) ? this.idOf(parent, s) : '';
      return `${parentId}|${prevId}`;
    };
    return place(now, this.cur) !== place(before, this.prev);
  }

  /** El rótulo de un contenido que cambió de tipo o de formato en el lugar (el mismo elemento de Yjs). */
  private inPlaceLabel(src: Y.XmlElement, made: Y.XmlElement): void {
    const before = Y.typeMapGetAllSnapshot(src, this.prev);
    const now = Y.typeMapGetAllSnapshot(src, this.cur);
    if (sameAttrs(cleanAttrs(before), cleanAttrs(now))) return;
    const kNow = blockKind(src.nodeName, now);
    const label: ChangeLabel = sameKind(blockKind(src.nodeName, before), kNow) ? { kind: 'format' } : { kind: 'type', to: kNow };
    // Quién: la fila del valor nuevo más reciente (setAttribute crea un elemento nuevo por cada valor).
    let row = -1;
    for (const item of src._map.values()) {
      let v: Y.Item | null = item;
      while (v && !visible(v, this.cur)) v = v.left;
      if (v && !visible(v, this.prev)) row = Math.max(row, this.h.insertRow(v.id.client, v.id.clock));
    }
    this.marks.push({ type: 'node', kind: 'change', at: this.at(made), row, block: true, label });
  }

  /**
   * Un contenido rehecho: se arma el nuevo y su texto se compara letra por letra con el del viejo (las letras nuevas,
   * con la fila de cada una; las que se fueron, con la que las borró). Si la forma no es la misma (otra cantidad de
   * textos), lo nuevo va entero como agregado.
   */
  private paired(now: Y.XmlElement, before: Y.XmlElement, dst: Y.XmlElement, row: number, moved: boolean): Y.XmlElement {
    const el = new Y.XmlElement(now.nodeName);
    this.push(dst, el);
    const attrsNow = Y.typeMapGetAllSnapshot(now, this.cur);
    this.setAttrs(el, attrsNow);
    const oldTexts = this.texts(before, this.prev);
    const newTexts = this.texts(now, this.cur);
    const comparable = oldTexts.length === newTexts.length;
    let k = 0;
    let changedText = false;
    const copy = (src: Y.XmlElement, out: Y.XmlElement) => {
      for (const n of childItems(src)) {
        if (!visible(n, this.cur)) continue;
        const t = typeOf(n);
        if (t instanceof Y.XmlText) {
          const text = new Y.XmlText();
          this.push(out, text);
          this.setAttrs(text, Y.typeMapGetAllSnapshot(t, this.cur));
          const prevText = comparable ? oldTexts[k] : null;
          k++;
          if (this.diffInto(text, prevText, t, row)) changedText = true;
        } else if (t instanceof Y.XmlElement) {
          const child = new Y.XmlElement(t.nodeName);
          this.push(out, child);
          this.setAttrs(child, Y.typeMapGetAllSnapshot(t, this.cur));
          copy(t, child);
        }
      }
    };
    copy(now, el);
    const attrsBefore = Y.typeMapGetAllSnapshot(before, this.prev);
    const kBefore = blockKind(before.nodeName, attrsBefore);
    const kNow = blockKind(now.nodeName, attrsNow);
    let label: ChangeLabel | undefined;
    if (!sameKind(kBefore, kNow)) label = { kind: 'type', to: kNow };
    else if (!sameAttrs(cleanAttrs(attrsBefore), cleanAttrs(attrsNow))) label = { kind: 'format' };
    else if (moved && !changedText) label = { kind: 'moved' };
    if (label) this.marks.push({ type: 'node', kind: 'change', at: this.at(el), row, block: true, label });
    return el;
  }

  /** Los textos de un elemento en orden de documento, visibles en ese snapshot. */
  private texts(src: Y.XmlElement, s: Y.Snapshot): Y.XmlText[] {
    const out: Y.XmlText[] = [];
    const walk = (t: Y.XmlElement) => {
      for (const n of childItems(t)) {
        if (!visible(n, s)) continue;
        const c = typeOf(n);
        if (c instanceof Y.XmlText) out.push(c);
        else if (c instanceof Y.XmlElement) walk(c);
      }
    };
    walk(src);
    return out;
  }

  /** Los tramos de un texto en un snapshot, cada uno con el id de su primer elemento. */
  private runs(t: Y.XmlText, s: Y.Snapshot): Run[] {
    const out: Run[] = [];
    const delta = t.toDelta(s, this.empty, (_type: string, id: Y.ID) => ({ type: 'added', user: id.client, client: id.client, clock: id.clock })) as {
      insert: unknown;
      attributes?: Attrs & { ychange?: { client: number; clock: number } };
    }[];
    for (const op of delta) {
      if (typeof op.insert !== 'string') continue;
      const yc = op.attributes?.ychange;
      out.push({ text: op.insert, attrs: cleanAttrs(op.attributes), client: yc?.client ?? -1, clock: yc?.clock ?? -1 });
    }
    return out;
  }

  /** El texto nuevo comparado con el viejo, escrito en `out` con sus marcas. Devuelve si cambió algo. */
  private diffInto(out: Y.XmlText, before: Y.XmlText | null, now: Y.XmlText, fallbackRow: number): boolean {
    const a = before ? this.runs(before, this.prev) : [];
    const b = this.runs(now, this.cur);
    const flat = (runs: Run[]) => {
      const chars: { attrs: Attrs; run: number }[] = [];
      runs.forEach((r, i) => {
        for (let j = 0; j < r.text.length; j++) chars.push({ attrs: r.attrs, run: i });
      });
      return chars;
    };
    const sa = a.map((r) => r.text).join('');
    const sb = b.map((r) => r.text).join('');
    const ca = flat(a);
    const cb = flat(b);
    const ops = diffText(sa, sb);
    const delta: { insert: string; attributes?: Attrs }[] = [];
    const pending: PendingText[] = [];
    let ia = 0;
    let ib = 0;
    let offset = 0;
    let changed = false;
    const emit = (ch: string, attrs: Attrs, mark: { kind: 'add' | 'del'; row: number } | null) => {
      const last = delta[delta.length - 1];
      if (last && sameAttrs(last.attributes ?? {}, attrs)) last.insert += ch;
      else delta.push(Object.keys(attrs).length ? { insert: ch, attributes: attrs } : { insert: ch });
      if (mark) {
        const p = pending[pending.length - 1];
        if (p && p.kind === mark.kind && p.row === mark.row && p.to === offset) p.to++;
        else pending.push({ kind: mark.kind, from: offset, to: offset + 1, row: mark.row });
      }
      offset++;
    };
    for (const op of ops) {
      if (op === '=') {
        emit(sb[ib], cb[ib].attrs, null);
        ia++;
        ib++;
      } else if (op === '+') {
        const r = b[cb[ib].run];
        const row = r.client >= 0 ? this.h.insertRow(r.client, r.clock) : -1;
        emit(sb[ib], cb[ib].attrs, { kind: 'add', row: row >= 0 ? row : fallbackRow });
        ib++;
        changed = true;
      } else {
        const r = a[ca[ia].run];
        const row = r.client >= 0 ? this.h.deleteRow(r.client, r.clock) : -1;
        emit(sa[ia], ca[ia].attrs, { kind: 'del', row: row >= 0 ? row : fallbackRow });
        ia++;
        changed = true;
      }
    }
    // Para que el formato de un tramo no se "estire" al siguiente, cada uno lleva todos sus atributos (los que no
    // tiene, en null).
    out.applyDelta(withNulls(delta));
    this.textMarks(out, pending);
    return changed;
  }

  /** Un contenido o algo de adentro (un texto, una foto en línea, una fila de tabla), copiado con sus marcas. */
  private node(
    src: AnyType,
    st: State,
    parentState: State,
    dst: Y.XmlElement,
    container: Y.XmlElement | null,
    isContent: boolean,
  ): Y.XmlElement | Y.XmlText | null {
    const touched = this.isTouched(container);
    if (src instanceof Y.XmlText) {
      const text = new Y.XmlText();
      this.push(dst, text);
      this.setAttrs(text, Y.typeMapGetAllSnapshot(src, this.snapOf(st)));
      this.copyText(src, st, touched, text);
      return text;
    }
    if (!(src instanceof Y.XmlElement)) return null;
    const el = new Y.XmlElement(src.nodeName);
    this.push(dst, el);
    this.setAttrs(el, Y.typeMapGetAllSnapshot(src, this.snapOf(st)));
    for (const n of childItems(src)) {
      const cst = this.stateOf(n, st);
      if (!cst) continue;
      this.node(typeOf(n), cst, st, el, container, false);
    }
    // Algo agregado o borrado adentro de un bloque que sigue (una foto en línea, una fila): su propia marca.
    if (!isContent && st !== 'both' && st !== parentState && src.nodeName !== STABLE_GAPS && !this.isSeed(src._item)) {
      const item = src._item!;
      const row = st === 'add' ? this.h.insertRow(item.id.client, item.id.clock) : this.h.deleteRow(item.id.client, item.id.clock);
      this.marks.push({ type: 'node', kind: st, at: this.at(el), row, block: false });
    }
    return el;
  }

  /** El texto como era (o los dos juntos, con lo agregado y lo borrado marcado). */
  private copyText(src: Y.XmlText, st: State, touched: boolean, out: Y.XmlText): void {
    type Op = { insert: unknown; attributes?: Attrs & { ychange?: { type: string; client: number; clock: number } } };
    const yc = (type: string, id: Y.ID) => ({ type, user: id.client, client: id.client, clock: id.clock });
    let delta: Op[];
    let kindOf: (op: Op) => 'add' | 'del' | null;
    if (st === 'add') {
      delta = src.toDelta(this.cur, this.empty, yc) as Op[];
      kindOf = () => 'add';
    } else if (st === 'del') {
      delta = src.toDelta(this.prev, this.empty, yc) as Op[];
      kindOf = () => 'del';
    } else if (touched) {
      delta = src.toDelta(this.cur, this.prev, yc) as Op[];
      kindOf = (op) => (op.attributes?.ychange?.type === 'added' ? 'add' : op.attributes?.ychange?.type === 'removed' ? 'del' : null);
    } else {
      delta = src.toDelta(this.cur) as Op[];
      kindOf = () => null;
    }
    const plain: { insert: unknown; attributes?: Attrs }[] = [];
    const pending: PendingText[] = [];
    let offset = 0;
    for (const op of delta) {
      // Un tipo de Yjs adentro de un texto no lo escribe el editor: no se copia (no se puede integrar dos veces).
      if (op.insert instanceof Y.AbstractType) continue;
      const attrs = cleanAttrs(op.attributes);
      plain.push(Object.keys(attrs).length ? { insert: op.insert, attributes: attrs } : { insert: op.insert });
      const len = typeof op.insert === 'string' ? op.insert.length : 1;
      const kind = kindOf(op);
      const c = op.attributes?.ychange;
      if (kind && c && !this.h.seedClients.has(c.client)) {
        const row = kind === 'add' ? this.h.insertRow(c.client, c.clock) : this.h.deleteRow(c.client, c.clock);
        const p = pending[pending.length - 1];
        if (p && p.kind === kind && p.row === row && p.to === offset) p.to += len;
        else pending.push({ kind, from: offset, to: offset + len, row });
      }
      offset += len;
    }
    out.applyDelta(withNulls(plain));
    this.textMarks(out, pending);
  }

  private textMarks(out: Y.XmlText, pending: PendingText[]): void {
    for (const p of pending) {
      if (p.to <= p.from) continue;
      this.marks.push({
        type: 'text',
        kind: p.kind,
        from: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(out, p.from, 0)),
        to: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(out, p.to, -1)),
        row: p.row,
      });
    }
  }

  /** La posición justo antes de un nodo de la unión. */
  private at(el: Y.XmlElement | Y.XmlText): RelPosJSON {
    const id = el._item!.id;
    return { item: { client: id.client, clock: id.clock }, assoc: 0 };
  }
}

/** Cada tramo con todos los atributos de formato que aparecen en el texto (los que no tiene, en null). */
function withNulls<T extends { insert: unknown; attributes?: Attrs }>(delta: T[]): T[] {
  const keys = new Set<string>();
  for (const op of delta) for (const k of Object.keys(op.attributes ?? {})) keys.add(k);
  if (keys.size === 0) return delta;
  return delta.map((op) => {
    const attributes: Attrs = {};
    for (const k of keys) attributes[k] = op.attributes?.[k] ?? null;
    return { ...op, attributes };
  });
}

/** El bloque más cercano de un elemento del documento del historial (o `null` si no está adentro de uno). */
function containerOf(item: Y.Item, cache: Map<AnyType, Y.XmlElement | null>): Y.XmlElement | null {
  if (item.content instanceof Y.ContentType && isElement(item.content.type, BLOCK)) return item.content.type;
  const start = item.parent as AnyType | null;
  const seen: AnyType[] = [];
  let found: Y.XmlElement | null = null;
  for (let t = start; t; t = (t._item?.parent as AnyType | null) ?? null) {
    const known = cache.get(t);
    if (known !== undefined) {
      found = known;
      break;
    }
    seen.push(t);
    if (isElement(t, BLOCK)) {
      found = t;
      break;
    }
  }
  for (const t of seen) cache.set(t, found);
  return found;
}

/** Los bloques que tocaron las filas `(from, to]` con lo que trajeron por primera vez (agregado o borrado). */
export function touchedBlocks(h: PageHistory, fromRow: number, toRow: number): Set<AnyType> {
  const out = new Set<AnyType>();
  const cache = new Map<AnyType, Y.XmlElement | null>();
  for (let r = fromRow + 1; r <= toRow; r++) {
    const fresh = h.fresh[r];
    if (!fresh) continue;
    for (const [client, a, b] of [...fresh.ins, ...fresh.del]) {
      const list = h.doc.store.clients.get(client);
      if (!list || list.length === 0) continue;
      const last = list[list.length - 1];
      if (a >= last.id.clock + last.length) continue;
      for (let i = Y.findIndexSS(list, Math.max(a, list[0].id.clock)); i < list.length && list[i].id.clock < b; i++) {
        const s = list[i];
        if (!(s instanceof Y.Item)) continue;
        const c = containerOf(s, cache);
        if (c) out.add(c);
      }
    }
  }
  return out;
}

/** Todos los bloques del documento del historial (también los borrados): para la diferencia completa. */
function allBlocks(h: PageHistory): Y.XmlElement[] {
  const out: Y.XmlElement[] = [];
  const walk = (t: AnyType) => {
    for (const n of childItems(t)) {
      const c = typeOf(n);
      if (isElement(c, BLOCK)) out.push(c);
      if (c instanceof Y.XmlElement) walk(c);
    }
  };
  walk(h.doc.getXmlFragment(CONTENT_FRAGMENT));
  return out;
}

/**
 * Los cambios de la versión `index` contra la anterior de la lista (la primera, contra la página vacía). `scope`:
 * `'changed'` (la app) diferencia solo los bloques que tocó alguna fila del medio; `'all'`, todos.
 */
export function versionChanges(h: PageHistory, index: number, scope: 'changed' | 'all' = 'changed'): VersionChanges {
  const cur = h.snapshot(index);
  const prev = index > 0 ? h.snapshot(index - 1) : EMPTY();
  const fromRow = index > 0 ? h.sessions[index - 1].last : -1;
  const toRow = h.sessions[index].last;
  let builder!: UnionBuilder;
  // Una sola transacción sobre el documento del historial: Yjs parte los elementos en los bordes de cada snapshot UNA
  // vez (no en cada texto) y los vuelve a juntar al final. No cambia el contenido.
  h.doc.transact(() => {
    const touched = scope === 'all' ? null : touchedBlocks(h, fromRow, toRow);
    builder = new UnionBuilder(h, prev, cur, touched);
    builder.pairCandidates(touched ?? allBlocks(h));
    builder.build();
  });
  // La reparación de estructura, como la versión (solo en memoria): un bloque que el editor no aceptaría.
  normalizeStructure(builder.doc, 'history');
  const update = Y.encodeStateAsUpdate(builder.doc);
  builder.doc.destroy();
  return { update, marks: builder.marks, touched: builder.touchedCount };
}
