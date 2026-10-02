import { Mark as MarkSet, type Mark, type Node as PMNode, type Schema } from '@tiptap/pm/model';
import { NodeSelection, type EditorState } from '@tiptap/pm/state';

// Lo elegido en la página, convertido al Markdown acotado que se le manda al modelo, y la respuesta convertida de vuelta
// (Docs/Doc_Asistente.md, secciones 6.2 a 6.4). Sin red ni editor: trabaja sobre el documento de ProseMirror.
//
// - Cada bloque de texto tocado por lo elegido es un "pedazo" (`TextPiece`); se manda en su propio párrafo, separado
//   del siguiente por una línea en blanco, con el prefijo de su tipo (`# `, `- `, `[ ] `…) solo como contexto: el tipo
//   del bloque nunca cambia (A1 no cambia la forma: eso es *Format as…*, A2).
// - Lo que no es texto (una foto-bloque, una tabla, un bloque de código, un adjunto, un divisor) va como una marca
//   `⟦block:N⟧` en su propio párrafo, que tiene que volver igual y en el mismo lugar. Las fotos en línea van como
//   `⟦photo:N⟧` y los links como `⟦link:N⟧texto⟦/link⟧`: la dirección no viaja.
// - La respuesta se compara con lo de antes por palabras (con su formato): solo lo que cambió se reemplaza. Lo igual no
//   se toca (ni sus colores, ni las fotos en línea que quedan en su lugar).

/**
 * Lo máximo que se manda en un pedido (unos 5 000 a 7 000 tokens). La respuesta tiene que entrar en el tope de salida
 * (prompt.ts: 16 000 tokens, para no pasar del máximo de ningún modelo): lo mismo de largo, o el doble al traducir. Con
 * más, una traducción larga llegaba cortada después de cobrarse.
 */
export const MAX_CHARS = 20_000;

/** Las marcas de texto que el Markdown acotado sabe escribir. Las demás (colores) se conservan aparte. */
export const MD_MARKS = ['bold', 'italic', 'underline', 'strike', 'code'] as const;
export type MdMark = (typeof MD_MARKS)[number];

const OPEN: Record<MdMark, string> = { bold: '**', italic: '*', underline: '++', strike: '~~', code: '`' };

export interface TextPiece {
  kind: 'text';
  /** Dónde empieza y termina lo elegido de este bloque (adentro de su contenido). */
  from: number;
  to: number;
  blockId: string;
  /** El prefijo de su tipo, solo para el modelo. */
  prefix: string;
  /** El contenido de antes, en unidades (palabras, signos, fotos y saltos de renglón). */
  units: OldUnit[];
}

export interface BlockPiece {
  kind: 'block';
  from: number;
  to: number;
  blockId: string;
  marker: number;
}

export type Piece = TextPiece | BlockPiece;

/** Una letra (con su formato), una foto en línea o un salto de renglón de la respuesta. */
export type Atom =
  | { t: 'char'; ch: string; marks: MdMark[]; link: number | null }
  | { t: 'photo'; n: number }
  | { t: 'br' };

/** Una unidad de lo de antes: dónde está en el documento y su clave para comparar. */
export interface OldUnit {
  key: string;
  from: number;
  to: number;
  /** Las marcas de afuera del Markdown (colores) de su primera letra: las hereda lo que se escriba en su lugar. */
  carry: readonly Mark[];
  text: string;
  atom?: 'photo' | 'br';
  marks: MdMark[];
  link: number | null;
}

export interface NewUnit {
  key: string;
  atoms: Atom[];
  text: string;
}

export interface Selected {
  /** Desde dónde hasta dónde va lo elegido (el primer y el último pedazo). */
  from: number;
  to: number;
  pieces: Piece[];
  /** Lo que se manda (sin las instrucciones). */
  markdown: string;
  /** Las fotos en línea por su número de marca (el nodo tal cual). */
  photos: Map<number, PMNode>;
  /** Los links por su número de marca (la marca con su dirección). */
  links: Map<number, Mark>;
  /** Cuántas letras de texto lleva (sin las marcas). */
  chars: number;
  /** El texto de antes, legible (para la vista previa y *Copy*), un renglón por bloque. */
  plain: string;
}

export type SelectError = 'empty' | 'tooLong';

/** El principio de la clave de una foto en línea (después va su número). */
const PHOTO_KEY = '\u0001photo:';

/** Las letras que forman una palabra (una palabra es una unidad de la diferencia). */
const WORD = /[\p{L}\p{N}\p{M}_'’]/u;

function blockIdAt(doc: PMNode, pos: number): string {
  const $pos = doc.resolve(pos);
  for (let d = $pos.depth; d >= 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === 'blockContainer') return String(node.attrs.id ?? '');
  }
  return '';
}

function prefixOf(node: PMNode): string {
  switch (node.type.name) {
    case 'heading':
      return `${'#'.repeat(Math.max(1, Math.min(6, Number(node.attrs.level) || 1)))} `;
    case 'bulletListItem':
    case 'toggleListItem':
      return '- ';
    case 'numberedListItem':
      return '1. ';
    case 'checkListItem':
      return node.attrs.checked ? '[x] ' : '[ ] ';
    case 'quote':
      return '> ';
    default:
      return '';
  }
}

/** Un bloque de texto que el asistente puede cambiar: los de texto, menos el código. */
function editableTextblock(node: PMNode): boolean {
  return node.isTextblock && node.type.name !== 'codeBlock';
}

/** La celda de tabla donde está una posición, o -1. */
function cellAt(doc: PMNode, pos: number): number {
  const $pos = doc.resolve(pos);
  for (let d = $pos.depth; d > 0; d--) {
    const name = $pos.node(d).type.name;
    if (name === 'tableCell' || name === 'tableHeader') return $pos.before(d);
  }
  return -1;
}

/** Las marcas del Markdown que tiene un pedazo de texto, en el orden de `MD_MARKS`. */
function mdMarksOf(marks: readonly Mark[]): MdMark[] {
  return MD_MARKS.filter((m) => marks.some((x) => x.type.name === m));
}

const carryOf = (marks: readonly Mark[]) => marks.filter((m) => m.type.name !== 'link' && !(MD_MARKS as readonly string[]).includes(m.type.name));

/**
 * La clave para comparar lo que quedó con lo pedido: sin los números de las marcas (al volver a leer, se numeran de
 * nuevo desde 1).
 */
export const plainKey = (key: string) =>
  key.startsWith('\u0001photo:') ? '\u0001photo' : key.replace(/\u0000(\d+)$/, '\u0000L');

/** La clave de una unidad: su texto, su formato y su link. El formato de un espacio no cuenta (no se ve). */
const unitKey = (text: string, marks: MdMark[], link: number | null) =>
  `${text}\u0000${/^\s+$/.test(text) ? '' : marks.join(',')}\u0000${link ?? ''}`;

/**
 * Las unidades de un pedazo de texto: cada palabra, cada signo o espacio, cada foto y cada salto de renglón, con su
 * formato. Los links se numeran a medida que aparecen (`links`), uno por tramo seguido con la misma dirección.
 */
function oldUnits(doc: PMNode, from: number, to: number, photos: Map<number, PMNode>, links: Map<number, Mark>, counter: { photo: number; link: number }): OldUnit[] {
  const out: OldUnit[] = [];
  let lastLink: { mark: Mark; n: number; end: number } | null = null;
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isInline) return true;
    if (node.isText) {
      const start = Math.max(from, pos);
      const end = Math.min(to, pos + node.nodeSize);
      const text = node.text!.slice(start - pos, end - pos);
      const marks = mdMarksOf(node.marks);
      const linkMark = node.marks.find((m) => m.type.name === 'link') ?? null;
      let link: number | null = null;
      if (linkMark) {
        // El mismo link sigue si el pedazo anterior terminaba justo acá con la misma dirección.
        if (lastLink && lastLink.end === start && lastLink.mark.eq(linkMark)) link = lastLink.n;
        else {
          link = ++counter.link;
          links.set(link, linkMark);
        }
        lastLink = { mark: linkMark, n: link, end };
      } else lastLink = null;
      const carry = carryOf(node.marks);
      // Palabras enteras, o un signo por unidad.
      let i = 0;
      while (i < text.length) {
        const cp = text.codePointAt(i)!;
        const ch = String.fromCodePoint(cp);
        let j = i + ch.length;
        if (WORD.test(ch)) {
          while (j < text.length) {
            const next = String.fromCodePoint(text.codePointAt(j)!);
            if (!WORD.test(next)) break;
            j += next.length;
          }
        }
        const piece = text.slice(i, j);
        out.push({ key: unitKey(piece, marks, link), from: start + i, to: start + j, carry, text: piece, marks, link });
        i = j;
      }
      return false;
    }
    lastLink = null;
    if (node.type.name === 'hardBreak') {
      if (pos >= from && pos + node.nodeSize <= to) out.push({ key: '\u0001br', from: pos, to: pos + 1, carry: [], text: '\n', atom: 'br', marks: [], link: null });
      return false;
    }
    if (node.isInline && node.isAtom) {
      if (pos >= from && pos + node.nodeSize <= to) {
        const n = ++counter.photo;
        photos.set(n, node);
        out.push({ key: `\u0001photo:${n}`, from: pos, to: pos + node.nodeSize, carry: [], text: '', atom: 'photo', marks: [], link: null });
      }
      return false;
    }
    return false;
  });
  // Una palabra partida en dos nodos de texto (con distinto formato) queda en dos unidades: está bien, cada una con lo
  // suyo. Dos unidades seguidas de la misma palabra con el mismo formato (un color distinto en el medio) se juntan.
  const merged: OldUnit[] = [];
  for (const u of out) {
    const prev = merged[merged.length - 1];
    if (prev && !u.atom && !prev.atom && prev.to === u.from && WORD.test(prev.text.slice(-1)) && WORD.test(u.text[0]) && prev.key.slice(prev.text.length) === u.key.slice(u.text.length)) {
      merged[merged.length - 1] = { ...prev, text: prev.text + u.text, to: u.to, key: unitKey(prev.text + u.text, prev.marks, prev.link) };
    } else merged.push(u);
  }
  return merged;
}

/** Escapa lo que el Markdown acotado leería como formato o como marca. */
export function escapeMd(text: string): string {
  return text.replace(/[\\*`[\]⟦⟧~+]/g, (c) => `\\${c}`);
}

/** El Markdown de un pedazo de texto (sin el prefijo). */
function pieceMarkdown(units: OldUnit[]): string {
  let out = '';
  const open: MdMark[] = [];
  let link: number | null = null;
  // Los espacios esperan a ver qué sigue: quedan adentro del formato si lo que sigue lo continúa, y si no, afuera
  // (`**hola** mundo`, no `**hola **mundo`).
  let spaces = '';
  const closeTo = (keep: MdMark[]) => {
    // Se cierran en orden inverso hasta que lo abierto sea el principio de lo que sigue.
    while (open.length > 0 && !(open.length <= keep.length && open.every((m, i) => keep[i] === m))) out += OPEN[open.pop()!];
  };
  const setLink = (next: number | null) => {
    if (next === link) return;
    closeTo([]);
    if (link !== null) out += '⟦/link⟧';
    out += spaces;
    spaces = '';
    if (next !== null) out += `⟦link:${next}⟧`;
    link = next;
  };
  for (const u of units) {
    if (u.atom) {
      setLink(null);
      closeTo([]);
      out += spaces;
      spaces = '';
      out += u.atom === 'br' ? '\n' : `⟦photo:${u.key.slice(PHOTO_KEY.length)}⟧`;
      continue;
    }
    if (/^\s+$/.test(u.text) && u.link === link) {
      spaces += u.text;
      continue;
    }
    setLink(u.link);
    closeTo(u.marks);
    out += spaces;
    spaces = '';
    for (const m of u.marks.slice(open.length)) {
      out += OPEN[m];
      open.push(m);
    }
    out += escapeMd(u.text);
  }
  closeTo([]);
  if (link !== null) out += '⟦/link⟧';
  out += spaces;
  // Un texto que empieza como un prefijo de tipo (`1. `, `- `, `# `) no se lee como tal.
  if (PREFIX.test(out)) out = /^\d/.test(out) ? out.replace(/^(\d{1,3})([.)])/, '$1\\$2') : `\\${out}`;
  // Un `<user_content>` o `</user_content>` escrito en la página no "cierra" la etiqueta del pedido (las palabras van
  // en unidades separadas: se mira el pedazo entero).
  return out.replace(/<(?=\/?user_content)/gi, '\\<');
}

/** Un espacio o un salto de renglón (lo que no viaja en las puntas de un pedazo). */
const blank = (u: OldUnit) => u.atom === 'br' || (!u.atom && /^\s+$/.test(u.text));

/** El texto legible de unas unidades (sin formato; las fotos no se ven). */
const plainOf = (units: { text: string }[]) => units.map((u) => u.text).join('');

/**
 * Lo elegido en el editor como pedazos. Sin nada elegido, el bloque donde está el cursor. `null` con el motivo si no hay
 * texto (una foto elegida, un renglón vacío) o si es demasiado largo.
 */
export function collectSelection(state: EditorState): Selected | SelectError {
  const { doc } = state;
  const sel = state.selection;
  let from = sel.from;
  let to = sel.to;
  if (sel.empty) {
    const $from = sel.$from;
    if (!editableTextblock($from.parent)) return 'empty';
    from = $from.start();
    to = $from.end();
  } else if (sel instanceof NodeSelection && sel.node.type.name !== 'blockContainer' && !sel.node.isTextblock) {
    // Una foto o un bloque que no es texto, elegido solo: no hay texto que cambiar.
    if (!sel.node.isInline) return 'empty';
  }
  return collectBetween(doc, from, to);
}

/**
 * Lo que hay entre dos posiciones, como pedazos (lo usa también la comprobación después de aplicar). Con `cells` (la
 * página entera, entrega A2), cada celda de una tabla es su propio pedazo: así *Translate page* traduce las tablas.
 */
export function collectBetween(doc: PMNode, from: number, to: number, opts: { cells?: boolean } = {}): Selected | SelectError {
  // Las dos puntas en la misma celda: solo esa celda. Si no, las tablas no se tocan (van como marca).
  const cellA = cellAt(doc, from);
  const singleCell = !!opts.cells || (cellA >= 0 && cellA === cellAt(doc, to));
  const pieces: Piece[] = [];
  const photos = new Map<number, PMNode>();
  const links = new Map<number, Mark>();
  const counter = { photo: 0, link: 0 };
  let markers = 0;
  doc.nodesBetween(from, to, (node, pos) => {
    const name = node.type.name;
    if (name === 'doc' || name === 'blockGroup' || name === 'blockContainer') return true;
    if (singleCell && (name === 'table' || name === 'tableRow' || name === 'tableCell' || name === 'tableHeader')) return true;
    if (editableTextblock(node) && (name !== 'tableParagraph' || singleCell)) {
      const start = Math.max(from, pos + 1);
      const end = Math.min(to, pos + 1 + node.content.size);
      if (end <= start) return false;
      const units = oldUnits(doc, start, end, photos, links, counter);
      // Un renglón vacío, con solo espacios o solo fotos no viaja: no hay texto que cambiar.
      if (units.every((u) => u.atom || /^\s*$/.test(u.text))) return false;
      // Los espacios y saltos de renglón de las puntas no viajan (el modelo los perdería): quedan como están.
      let i0 = 0;
      let i1 = units.length;
      while (i0 < i1 && blank(units[i0])) i0++;
      while (i1 > i0 && blank(units[i1 - 1])) i1--;
      const kept = units.slice(i0, i1);
      pieces.push({ kind: 'text', from: kept[0].from, to: kept[kept.length - 1].to, blockId: blockIdAt(doc, pos), prefix: name === 'tableParagraph' ? '' : prefixOf(node), units: kept });
      return false;
    }
    // Lo que no es texto: el bloque entero, como marca.
    pieces.push({ kind: 'block', from: pos, to: pos + node.nodeSize, blockId: blockIdAt(doc, pos), marker: ++markers });
    return false;
  });
  // Marcas de bloque al principio o al final, sin texto en el medio: no hay nada que mandar.
  while (pieces[0]?.kind === 'block' && !pieces.some((p) => p.kind === 'text')) pieces.shift();
  if (!pieces.some((p) => p.kind === 'text')) return 'empty';
  // Las marcas de bloque de las puntas no hacen falta: lo elegido empieza y termina en texto.
  while (pieces[0].kind === 'block') pieces.shift();
  while (pieces[pieces.length - 1].kind === 'block') pieces.pop();
  // Se vuelven a numerar las marcas de bloque que quedaron.
  let n = 0;
  for (const p of pieces) if (p.kind === 'block') p.marker = ++n;
  // Un link que quedó solo en un espacio de una punta no viaja.
  const used = new Set(pieces.flatMap((p) => (p.kind === 'text' ? p.units.map((u) => u.link) : [])));
  for (const k of [...links.keys()]) if (!used.has(k)) links.delete(k);
  const chars = pieces.reduce((sum, p) => sum + (p.kind === 'text' ? plainOf(p.units).length : 0), 0);
  if (chars > MAX_CHARS) return 'tooLong';
  const markdown = pieces
    .map((p) => (p.kind === 'block' ? `⟦block:${p.marker}⟧` : p.prefix + pieceMarkdown(p.units)))
    .join('\n\n');
  const plain = pieces.map((p) => (p.kind === 'block' ? '' : plainOf(p.units))).filter((t) => t !== '').join('\n');
  return { from: pieces[0].from, to: pieces[pieces.length - 1].to, pieces, markdown, photos, links, chars, plain };
}

// --- La respuesta ---------------------------------------------------------------------------------------------------

export type ParseError =
  /** Vino vacía. */
  | 'empty'
  /** No tiene la misma cantidad de bloques (párrafos) que lo que se mandó. */
  | 'structure'
  /** Falta una marca, sobra o está repetida, o una marca de bloque cambió de lugar. */
  | 'marker';

export interface Parsed {
  /** Lo nuevo de cada pedazo de texto (en el orden de `pieces`; `null` para las marcas de bloque). */
  blocks: (NewUnit[] | null)[];
  /** Había links nuevos y se sacaron (queda el texto). */
  linksRemoved: boolean;
}

/** Saca lo que el modelo a veces agrega alrededor: un bloque de código entero o las etiquetas del pedido. */
export function cleanAnswer(text: string): string {
  let s = text.replace(/\r\n?/g, '\n').trim();
  s = s.replace(/^<user_content>\s*/i, '').replace(/\s*(?<!\\)<\/user_content>$/i, '').trim();
  const fence = /^```[\w-]*\n([\s\S]*?)\n```$/.exec(s);
  if (fence) s = fence[1].trim();
  return s;
}

const PREFIX = /^(?:#{1,6}[ \t]+|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d{1,3}[.)][ \t]+|\[[ xX]\][ \t]+|>[ \t]?)/;

const MARKER = /^⟦(photo|link|block):(\d{1,4})⟧|^⟦\/link⟧/;

/**
 * Lee un bloque de la respuesta (sin el prefijo): letras con formato, fotos, links de lo elegido y saltos de renglón.
 * Un link nuevo (`[texto](dirección)`) queda como texto. Lo que no reconoce queda como texto. Cada `⟦link:N⟧` se cierra
 * con un `⟦/link⟧` antes de terminar el bloque, sin links adentro de otro ni cierres sueltos; si no, `seen.unbalanced`
 * (6.4: una marca mal cerrada no se aplica, porque el link se extendería sobre texto que no lo era).
 */
export function parseInline(src: string, known: { photos: Set<number>; links: Set<number> }, seen: Seen): Atom[] {
  const atoms: Atom[] = [];
  const marks: MdMark[] = [];
  let link: number | null = null;
  /** Hay un `⟦link:N⟧` abierto (aunque N no exista: entonces `link` es `null`). */
  let open = false;
  const push = (text: string) => {
    for (const ch of text) atoms.push({ t: 'char', ch, marks: [...marks], link });
  };
  const toggle = (m: MdMark) => {
    const at = marks.indexOf(m);
    if (at >= 0) marks.splice(at, 1);
    else marks.push(m);
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const rest = src.slice(i);
    if (c === '\\' && i + 1 < src.length && /[\\*`[\]⟦⟧~+_#<>\-.!()|]/.test(src[i + 1])) {
      push(src[i + 1]);
      i += 2;
      continue;
    }
    if (c === '\n') {
      atoms.push({ t: 'br' });
      i++;
      continue;
    }
    if (c === '⟦') {
      const m = MARKER.exec(rest);
      if (m) {
        if (m[0] === '⟦/link⟧') {
          if (!open) seen.unbalanced = true;
          open = false;
          link = null;
        } else {
          const n = Number(m[2]);
          if (m[1] === 'photo') {
            seen.photos.set(n, (seen.photos.get(n) ?? 0) + 1);
            if (known.photos.has(n)) atoms.push({ t: 'photo', n });
          } else if (m[1] === 'link') {
            seen.links.set(n, (seen.links.get(n) ?? 0) + 1);
            if (open) seen.unbalanced = true;
            open = true;
            link = known.links.has(n) ? n : null;
          } else {
            // Una marca de bloque adentro de un texto: cambió de lugar.
            seen.blocks++;
          }
        }
        i += m[0].length;
        continue;
      }
    }
    if (c === '`') {
      // Código: hasta la comilla que cierra, sin leer nada adentro.
      const end = src.indexOf('`', i + 1);
      if (end > i) {
        marks.push('code');
        push(src.slice(i + 1, end));
        marks.pop();
        i = end + 1;
        continue;
      }
    }
    if (rest.startsWith('**')) {
      toggle('bold');
      i += 2;
      continue;
    }
    if (rest.startsWith('~~')) {
      toggle('strike');
      i += 2;
      continue;
    }
    if (rest.startsWith('++')) {
      toggle('underline');
      i += 2;
      continue;
    }
    if (c === '*') {
      toggle('italic');
      i++;
      continue;
    }
    if (c === '[' && src[i - 1] !== '!') {
      // Un link nuevo: `[texto](dirección)` → el texto, sin link.
      const m = /^\[([^\]\n]*)\]\(([^)\s]*)\)/.exec(rest);
      if (m) {
        seen.linksRemoved = true;
        const inner = parseInline(m[1], known, seen);
        for (const a of inner) atoms.push(a.t === 'char' ? { ...a, marks: [...new Set([...marks, ...a.marks])].sort((x, y) => MD_MARKS.indexOf(x) - MD_MARKS.indexOf(y)), link } : a);
        i += m[0].length;
        continue;
      }
    }
    push(String.fromCodePoint(rest.codePointAt(0)!));
    i += String.fromCodePoint(rest.codePointAt(0)!).length;
  }
  if (open) seen.unbalanced = true;
  return atoms;
}

/** Lo que `parseInline` va anotando de todos los bloques de una respuesta, para validarla al final. */
export interface Seen {
  photos: Map<number, number>;
  links: Map<number, number>;
  /** Marcas de bloque adentro de un texto. */
  blocks: number;
  linksRemoved: boolean;
  /** Un link sin cerrar, un cierre suelto o un link adentro de otro. */
  unbalanced: boolean;
}

/** Las unidades de lo nuevo (las mismas reglas que lo de antes, para compararlas). */
export function newUnits(atoms: Atom[]): NewUnit[] {
  const out: NewUnit[] = [];
  let i = 0;
  while (i < atoms.length) {
    const a = atoms[i];
    if (a.t === 'photo') {
      out.push({ key: `\u0001photo:${a.n}`, atoms: [a], text: '' });
      i++;
      continue;
    }
    if (a.t === 'br') {
      out.push({ key: '\u0001br', atoms: [a], text: '\n' });
      i++;
      continue;
    }
    const sig = `${a.marks.join(',')}\u0000${a.link ?? ''}`;
    let j = i + 1;
    if (WORD.test(a.ch)) {
      while (j < atoms.length) {
        const b = atoms[j];
        if (b.t !== 'char' || !WORD.test(b.ch) || `${b.marks.join(',')}\u0000${b.link ?? ''}` !== sig) break;
        j++;
      }
    }
    const slice = atoms.slice(i, j) as Extract<Atom, { t: 'char' }>[];
    const text = slice.map((x) => x.ch).join('');
    out.push({ key: unitKey(text, a.marks, a.link), atoms: slice, text });
    i = j;
  }
  return out;
}

/**
 * Convierte la respuesta en lo nuevo de cada pedazo y la valida contra lo elegido (6.4): la misma cantidad de bloques,
 * las marcas de bloque en su lugar, cada foto y cada link exactamente una vez, sin marcas inventadas.
 */
export function parseAnswer(answer: string, selected: Selected): Parsed | ParseError {
  const clean = cleanAnswer(answer);
  if (!clean) return 'empty';
  // Sin los espacios de las puntas de cada bloque (lo de las puntas no se mandó y no se toca).
  const raw = clean.split(/\n[ \t]*\n+/).map((b) => b.replace(/^\s+|\s+$/g, ''));
  if (raw.length !== selected.pieces.length) return 'structure';
  const known = { photos: new Set(selected.photos.keys()), links: new Set(selected.links.keys()) };
  const seen: Seen = { photos: new Map<number, number>(), links: new Map<number, number>(), blocks: 0, linksRemoved: false, unbalanced: false };
  const blocks: (NewUnit[] | null)[] = [];
  for (const [i, piece] of selected.pieces.entries()) {
    const text = raw[i];
    if (piece.kind === 'block') {
      if (text.trim() !== `⟦block:${piece.marker}⟧`) return 'marker';
      blocks.push(null);
      continue;
    }
    // Sin el prefijo de tipo, si el bloque lo tiene (si el modelo lo cambió, el tipo del bloque no cambia). En un
    // párrafo no se saca nada: un "- " que agregó el modelo queda como texto, a la vista en la vista previa.
    const body = piece.prefix ? text.replace(PREFIX, '') : text;
    blocks.push(newUnits(parseInline(body, known, seen)));
  }
  if (seen.blocks > 0 || seen.unbalanced) return 'marker';
  for (const n of known.photos) if (seen.photos.get(n) !== 1) return 'marker';
  for (const n of known.links) if (seen.links.get(n) !== 1) return 'marker';
  for (const n of seen.photos.keys()) if (!known.photos.has(n)) return 'marker';
  for (const n of seen.links.keys()) if (!known.links.has(n)) return 'marker';
  return { blocks, linksRemoved: seen.linksRemoved };
}

// --- La diferencia --------------------------------------------------------------------------------------------------

/** Lo que cambia en un pedazo: las unidades de antes `[a0, a1)` pasan a ser las nuevas `[b0, b1)`. */
export interface Hunk {
  a0: number;
  a1: number;
  b0: number;
  b1: number;
}

const MAX_CELLS = 4_000_000;

/** Los tramos que cambian entre dos listas de claves (por palabras, la subsecuencia común más larga). */
export function diffKeys(a: readonly string[], b: readonly string[]): Hunk[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const n = endA - start;
  const m = endB - start;
  if (n === 0 && m === 0) return [];
  if (n === 0 || m === 0 || n * m > MAX_CELLS) return [{ a0: start, a1: endA, b0: start, b1: endB }];
  const len: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      len[i][j] = a[start + i] === b[start + j] ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1]);
    }
  }
  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  let open: Hunk | null = null;
  const close = () => {
    if (open) hunks.push(open);
    open = null;
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[start + i] === b[start + j]) {
      close();
      i++;
      j++;
      continue;
    }
    if (!open) open = { a0: start + i, a1: start + i, b0: start + j, b1: start + j };
    if (j >= m || (i < n && len[i + 1][j] >= len[i][j + 1])) {
      i++;
      open.a1 = start + i;
    } else {
      j++;
      open.b1 = start + j;
    }
  }
  close();
  return hunks;
}

/** Los nodos de ProseMirror de unas unidades nuevas, con las marcas heredadas (colores) de `carry`. */
export function buildNodes(schema: Schema, units: NewUnit[], selected: Selected, carry: readonly Mark[]): PMNode[] {
  const nodes: PMNode[] = [];
  for (const u of units) {
    for (const a of u.atoms) {
      if (a.t === 'photo') {
        const photo = selected.photos.get(a.n);
        if (photo) nodes.push(photo);
        continue;
      }
      if (a.t === 'br') {
        const hb = schema.nodes.hardBreak;
        if (hb) nodes.push(hb.create());
        continue;
      }
      const marks: Mark[] = [...carry];
      for (const m of a.marks) {
        const type = schema.marks[m];
        if (type) marks.push(type.create());
      }
      if (a.link !== null) {
        const link = selected.links.get(a.link);
        if (link) marks.push(link);
      }
      const set = marks.reduce((acc, m) => m.addToSet(acc), [] as readonly Mark[]);
      const prev = nodes[nodes.length - 1];
      if (prev?.isText && MarkSet.sameSet(prev.marks, set)) nodes[nodes.length - 1] = schema.text(prev.text! + a.ch, set);
      else nodes.push(schema.text(a.ch, set));
    }
  }
  return nodes;
}

/** El texto legible de lo nuevo (para *Copy* y para comparar largos). */
export function plainNew(blocks: (NewUnit[] | null)[]): string {
  return blocks
    .filter((b): b is NewUnit[] => b !== null)
    .map((b) => plainOf(b))
    .join('\n');
}
