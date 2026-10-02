import type { Mark, Node as PMNode } from '@tiptap/pm/model';
import { cleanAnswer, MD_MARKS, newUnits, parseInline, plainKey, type Atom, type MdMark, type Seen } from './markup';

// Lo que devuelve el modelo como Markdown con forma (entrega A2: *Summarize page* y *Format as…*), convertido a bloques
// de los tipos que ya existen (Docs/Doc_Asistente.md, 6.3): párrafo, título 1 a 3, viñeta, lista numerada, casilla,
// cita y tabla. Un renglón es un bloque (las filas de una tabla, juntas, son una tabla). Lo que no se reconoce queda
// como texto; nunca HTML, nunca imágenes, nunca links nuevos (sin "autolink"): una dirección suelta es texto.
//
// A diferencia de A1 (donde la respuesta tiene que traer los mismos bloques que se mandaron), acá la forma cambia: la
// validación es que cada foto en línea y cada link de lo elegido vuelvan exactamente una vez, y cada marca de bloque
// (`⟦block:N⟧`) una vez y sola en su renglón.

export type TextType = 'paragraph' | 'heading' | 'bulletListItem' | 'numberedListItem' | 'checkListItem' | 'quote';

export type MdBlock =
  | { kind: 'text'; type: TextType; level?: 1 | 2 | 3; checked?: boolean; atoms: Atom[] }
  | { kind: 'table'; header: boolean; rows: Atom[][][] }
  | { kind: 'marker'; n: number };

/** Lo de lo elegido que la respuesta puede nombrar con marcas (vacío en un resumen: las marcas se sacan). */
export interface Known {
  photos: Set<number>;
  links: Set<number>;
  blocks: Set<number>;
}

export interface MdParsed {
  blocks: MdBlock[];
  /** Había links nuevos y se sacaron (queda el texto). */
  linksRemoved: boolean;
}

const RULE = /^(?:-{3,}|\*{3,}|_{3,})$/;
const HEADING = /^(#{1,6})[ \t]+(.*)$/;
const CHECK = /^(?:[-*+][ \t]+)?\[([ xX])\][ \t]+(.*)$/;
const BULLET = /^[-*+•][ \t]+(.*)$/;
const NUMBERED = /^\d{1,3}[.)][ \t]+(.*)$/;
const QUOTE = /^>[ \t]?(.*)$/;
const BLOCK_MARKER = /^⟦block:(\d{1,4})⟧$/;

/** Las celdas de una fila de tabla (`| a | b |`), sin las barras de las puntas; `\|` es una barra escrita. */
function cellsOf(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) {
      cur += s[i] + s[i + 1];
      i++;
      continue;
    }
    if (s[i] === '|') {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += s[i];
  }
  out.push(cur.trim());
  return out;
}

const isSeparator = (cells: string[]) => cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c));

/** Un seguimiento vacío de lo que aparece (para validar al final). */
export function emptySeen(): Seen {
  return { photos: new Map(), links: new Map(), blocks: 0, linksRemoved: false, unbalanced: false };
}

/**
 * Lee la respuesta renglón por renglón. `known` dice qué marcas existen (las de más se cuentan en `seen` y no se
 * dibujan); `markers` cuenta las marcas de bloque solas en su renglón.
 */
export function parseMdBlocks(answer: string, known: Known, seen: Seen, markers: Map<number, number>): MdBlock[] {
  const lines = cleanAnswer(answer).split('\n');
  const inlineKnown = { photos: known.photos, links: known.links };
  const inline = (text: string) => parseInline(text, inlineKnown, seen);
  const out: MdBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || RULE.test(line) || line.startsWith('```')) continue;
    const marker = BLOCK_MARKER.exec(line);
    if (marker) {
      const n = Number(marker[1]);
      markers.set(n, (markers.get(n) ?? 0) + 1);
      if (known.blocks.has(n)) out.push({ kind: 'marker', n });
      continue;
    }
    if (line.startsWith('|')) {
      // Las filas seguidas son una tabla; el renglón de guiones dice que la primera es el encabezado.
      const rows: string[][] = [];
      let header = false;
      let j = i;
      for (; j < lines.length && lines[j].trim().startsWith('|'); j++) {
        const cells = cellsOf(lines[j]);
        if (isSeparator(cells)) {
          if (rows.length === 1) header = true;
          continue;
        }
        rows.push(cells);
      }
      i = j - 1;
      if (rows.length === 0) continue;
      const width = Math.max(...rows.map((r) => r.length));
      out.push({ kind: 'table', header, rows: rows.map((r) => Array.from({ length: width }, (_, k) => inline(r[k] ?? ''))) });
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = HEADING.exec(line))) {
      out.push({ kind: 'text', type: 'heading', level: Math.min(3, m[1].length) as 1 | 2 | 3, atoms: inline(m[2]) });
    } else if ((m = CHECK.exec(line))) {
      out.push({ kind: 'text', type: 'checkListItem', checked: m[1] !== ' ', atoms: inline(m[2]) });
    } else if ((m = BULLET.exec(line))) {
      out.push({ kind: 'text', type: 'bulletListItem', atoms: inline(m[1]) });
    } else if ((m = NUMBERED.exec(line))) {
      out.push({ kind: 'text', type: 'numberedListItem', atoms: inline(m[1]) });
    } else if ((m = QUOTE.exec(line))) {
      out.push({ kind: 'text', type: 'quote', atoms: inline(m[1]) });
    } else {
      out.push({ kind: 'text', type: 'paragraph', atoms: inline(line) });
    }
  }
  // Un renglón que quedó sin nada (solo una marca que no existe) no es un bloque.
  return out.filter((b) => b.kind !== 'text' || b.atoms.length > 0);
}

export type ShapeError = 'empty' | 'marker';

/**
 * La respuesta de *Format as…*: los bloques nuevos, si cada foto y cada link de lo elegido aparecen exactamente una vez,
 * cada marca de bloque una vez y sola en su renglón, sin marcas inventadas ni links mal cerrados (6.4).
 */
export function parseShape(answer: string, known: Known): MdParsed | ShapeError {
  const seen = emptySeen();
  const markers = new Map<number, number>();
  const blocks = parseMdBlocks(answer, known, seen, markers);
  if (blocks.length === 0) return 'empty';
  if (seen.blocks > 0 || seen.unbalanced) return 'marker';
  for (const n of known.photos) if (seen.photos.get(n) !== 1) return 'marker';
  for (const n of known.links) if (seen.links.get(n) !== 1) return 'marker';
  for (const n of known.blocks) if (markers.get(n) !== 1) return 'marker';
  for (const n of seen.photos.keys()) if (!known.photos.has(n)) return 'marker';
  for (const n of seen.links.keys()) if (!known.links.has(n)) return 'marker';
  for (const n of markers.keys()) if (!known.blocks.has(n)) return 'marker';
  return { blocks, linksRemoved: seen.linksRemoved };
}

/**
 * Un resumen: texto nuevo, sin fotos, links ni bloques de la página (las marcas que traiga se sacan, el texto de un
 * link queda). `null` si viene vacío.
 */
export function parseSummary(answer: string): MdParsed | null {
  const seen = emptySeen();
  const none: Known = { photos: new Set(), links: new Set(), blocks: new Set() };
  const blocks = parseMdBlocks(answer, none, seen, new Map());
  return blocks.length ? { blocks, linksRemoved: seen.linksRemoved } : null;
}

// --- A bloques de BlockNote ------------------------------------------------------------------------------------------

/** Lo que hace falta para volver a armar las marcas: la foto tal cual, el link con su dirección, el bloque entero. */
export interface Restore {
  photos: Map<number, PMNode>;
  links: Map<number, Mark>;
  /** El bloque de BlockNote de cada marca de bloque (con su id: se mueve, no se copia). */
  blocks: Map<number, unknown>;
}

type Styles = Partial<Record<MdMark, true>>;
type StyledText = { type: 'text'; text: string; styles: Styles };
type InlineOut = StyledText | { type: 'link'; href: string; content: StyledText[] } | { type: 'photo'; props: Record<string, unknown> };

/** El contenido en línea de BlockNote de unas letras: texto con formato, links de lo elegido y fotos en línea. */
export function inlineContent(atoms: Atom[], restore: Restore): InlineOut[] {
  const out: InlineOut[] = [];
  const push = (text: string, marks: MdMark[], link: number | null) => {
    const styles: Styles = {};
    for (const m of marks) if ((MD_MARKS as readonly string[]).includes(m)) styles[m] = true;
    const run: StyledText = { type: 'text', text, styles };
    const href = link !== null ? String(restore.links.get(link)?.attrs.href ?? '') : '';
    const last = out[out.length - 1];
    const same = (a: StyledText) => JSON.stringify(a.styles) === JSON.stringify(styles);
    if (href) {
      if (last?.type === 'link' && last.href === href && (last as { n?: number }).n === link) {
        const tail = last.content[last.content.length - 1];
        if (tail && same(tail)) tail.text += text;
        else last.content.push(run);
      } else out.push({ type: 'link', href, content: [run], n: link } as InlineOut);
      return;
    }
    if (last?.type === 'text' && same(last)) last.text += text;
    else out.push(run);
  };
  for (const a of atoms) {
    if (a.t === 'photo') {
      const node = restore.photos.get(a.n);
      if (node) out.push({ type: 'photo', props: { ...node.attrs } });
    } else if (a.t === 'br') push('\n', [], null);
    else push(a.ch, a.marks, a.link);
  }
  // El número del link solo servía para no juntar dos links distintos con la misma dirección.
  for (const x of out) if (x.type === 'link') delete (x as { n?: number }).n;
  return out;
}

/** Los bloques de BlockNote (sin id: el editor les pone uno nuevo), con las marcas vueltas a lo que eran. */
export function toPartialBlocks(blocks: MdBlock[], restore: Restore): unknown[] {
  return blocks.map((b) => {
    if (b.kind === 'marker') return restore.blocks.get(b.n);
    if (b.kind === 'table') {
      return {
        type: 'table',
        content: {
          type: 'tableContent',
          ...(b.header ? { headerRows: 1 } : {}),
          rows: b.rows.map((r) => ({ cells: r.map((c) => inlineContent(c, restore)) })),
        },
      };
    }
    const props: Record<string, unknown> = {};
    if (b.type === 'heading') props.level = b.level ?? 2;
    if (b.type === 'checkListItem') props.checked = !!b.checked;
    return { type: b.type, props, content: inlineContent(b.atoms, restore) };
  });
}

/** Las claves del texto de un bloque nuevo (para ver si solo cambió el tipo). */
export const atomKeys = (atoms: Atom[]) => newUnits(atoms).map((u) => plainKey(u.key));

/** El texto legible de unos bloques nuevos (para *Copy*): un renglón por bloque, las tablas con `|`. */
export function plainBlocks(blocks: MdBlock[]): string {
  const text = (atoms: Atom[]) => atoms.map((a) => (a.t === 'char' ? a.ch : a.t === 'br' ? '\n' : '')).join('');
  return blocks
    .flatMap((b) => {
      if (b.kind === 'marker') return [];
      if (b.kind === 'table') return b.rows.map((r) => `| ${r.map(text).join(' | ')} |`);
      const prefix = b.type === 'heading' ? `${'#'.repeat(b.level ?? 2)} ` : b.type === 'bulletListItem' ? '- ' : b.type === 'numberedListItem' ? '1. ' : b.type === 'checkListItem' ? (b.checked ? '[x] ' : '[ ] ') : b.type === 'quote' ? '> ' : '';
      return [prefix + text(b.atoms)];
    })
    .join('\n');
}
