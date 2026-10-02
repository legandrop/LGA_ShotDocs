import { diffKeys, type Atom } from '../assistant/markup';
import { labelKey, noteMentions, shotOfHeading, type MapTable, type PageMap, type ShotSection, type Target } from './pageMap';

// La respuesta de *Dictate to report* (Docs/Doc_Dictado.md, 5.3 y 5.4): una lista de cambios en JSON que la app lee y
// valida contra el mapa antes de mostrar nada. Lo que no pasa la validación no se muestra: su texto va a *Couldn't
// place*. El destino que se muestra lo arma la app con el mapa (la sección, el rótulo de la fila y el de la columna),
// nunca con el texto del modelo (`why` se muestra aparte, en gris).

/** Lo máximo que se muestra de una respuesta, y el largo máximo de un texto nuevo. */
export const MAX_CHANGES = 20;
export const MAX_TEXT = 500;

export type Op = 'setCell' | 'setText' | 'addRow' | 'addShotSection' | 'check' | 'uncheck' | 'appendText';

/** Un cambio validado, listo para la vista previa y para aplicar. */
export interface Change {
  id: number;
  op: Op;
  /** El lugar (celda o bloque) donde escribe o tilda; en `addRow`, la fila de después de la que va. */
  target?: Target;
  /** `setCell`/`setText`: lo nuevo, como letras (con las fotos y los links del lugar). `appendText`: el texto. */
  atoms?: Atom[];
  /** `addRow`: la tabla y el texto de cada columna (en el orden de las columnas). */
  table?: MapTable;
  cells?: string[];
  /** `addShotSection`: el plano y los rótulos de las casillas que van tildadas. */
  shot?: string;
  checks?: string[];
  /** El destino en palabras (lo arma la app con el mapa). */
  where: string[];
  /** Lo de antes y lo de después, legibles. */
  before: string;
  after: string;
  /** Lo que se saca de lo que había (si reemplaza algo escrito, no solo agrega). */
  replaces: string;
  /** La fila (o la sección del plano) la eligió el modelo: no la nombra la nota, ni es la del cursor. */
  chosen: boolean;
  why: string;
  /** El texto que va a *Couldn't place* si la persona lo destilda. */
  text: string;
}

export interface AskOption {
  /** Lo que dice el botón. */
  label: string;
  /** Lo que se le contesta al modelo. */
  answer: string;
}

export interface Plan {
  heard: string;
  changes: Change[];
  /** Lo que no se pudo ubicar (lo del modelo y lo que no pasó la validación). */
  unplaced: string[];
  ask: { question: string; options: AskOption[] } | null;
  linksRemoved: boolean;
}

export type ReadError = 'unreadable';

/** El JSON de la respuesta: sin un bloque de código alrededor, del primer `{` al último `}`. */
export function extractJson(text: string): unknown {
  let s = text.replace(/\r\n?/g, '\n').trim();
  const fence = /^```[\w-]*\n([\s\S]*?)\n```$/.exec(s);
  if (fence) s = fence[1].trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return undefined;
  try {
    return JSON.parse(s.slice(a, b + 1));
  } catch {
    return undefined;
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/** Lo legible de unas letras nuevas (las fotos como ▣). */
export function atomsPlain(atoms: Atom[]): string {
  return atoms.map((a) => (a.t === 'char' ? a.ch : a.t === 'photo' ? '▣' : '\n')).join('');
}

/**
 * Lee un texto nuevo: las marcas de fotos y links del lugar, los saltos de renglón y el resto como texto (sin formato).
 * Un link nuevo `[texto](dirección)` queda como su texto. `'marker'` si falta, sobra o se inventa una marca.
 */
export function parseNew(src: string, target: Pick<Target, 'photos' | 'links'> | null, seen: { linksRemoved: boolean }): Atom[] | 'marker' {
  const atoms: Atom[] = [];
  const photos = new Map<number, number>();
  const links = new Map<number, number>();
  let link: number | null = null;
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    const m = /^⟦(photo|link):(\d{1,4})⟧|^⟦\/link⟧/.exec(rest);
    if (m) {
      if (m[0] === '⟦/link⟧') {
        if (link === null) return 'marker';
        link = null;
      } else {
        const n = Number(m[2]);
        if (m[1] === 'photo') {
          if (!target?.photos.has(n)) return 'marker';
          photos.set(n, (photos.get(n) ?? 0) + 1);
          atoms.push({ t: 'photo', n });
        } else {
          if (!target?.links.has(n) || link !== null) return 'marker';
          links.set(n, (links.get(n) ?? 0) + 1);
          link = n;
        }
      }
      i += m[0].length;
      continue;
    }
    const md = /^\[([^\]\n]*)\]\(([^)\s]*)\)/.exec(rest);
    if (md && src[i - 1] !== '!') {
      seen.linksRemoved = true;
      for (const ch of md[1]) atoms.push({ t: 'char', ch, marks: [], link });
      i += md[0].length;
      continue;
    }
    const ch = String.fromCodePoint(rest.codePointAt(0)!);
    if (ch === '\n') atoms.push({ t: 'br' });
    else atoms.push({ t: 'char', ch, marks: [], link });
    i += ch.length;
  }
  if (link !== null) return 'marker';
  // Cada foto y cada link del lugar, exactamente una vez (la regla de A1: lo nuevo nunca saca una foto ni un link).
  for (const n of target?.photos.keys() ?? []) if (photos.get(n) !== 1) return 'marker';
  for (const n of target?.links.keys() ?? []) if (links.get(n) !== 1) return 'marker';
  return atoms;
}

/** Las claves para comparar lo de antes con lo nuevo por palabras (sin el formato: lo que no cambia, no se toca). */
export function oldKeys(target: Target): string[] {
  return target.units.slice(target.labelUnits).map((u) => (u.atom === 'photo' ? `\u0001${u.key}` : u.atom === 'br' ? '\u0001br' : `${u.text}\u0000${u.link ?? ''}`));
}

const WORD = /[\p{L}\p{N}\p{M}_'’]/u;

/** Las letras nuevas en unidades (palabras, signos, fotos, saltos), con su clave. */
export function newUnitsOf(atoms: Atom[]): { key: string; atoms: Atom[]; text: string }[] {
  const out: { key: string; atoms: Atom[]; text: string }[] = [];
  let i = 0;
  while (i < atoms.length) {
    const a = atoms[i];
    if (a.t === 'photo') {
      out.push({ key: `\u0001\u0001photo:${a.n}`, atoms: [a], text: '' });
      i++;
      continue;
    }
    if (a.t === 'br') {
      out.push({ key: '\u0001br', atoms: [a], text: '\n' });
      i++;
      continue;
    }
    let j = i + 1;
    if (WORD.test(a.ch)) {
      while (j < atoms.length) {
        const b = atoms[j];
        if (b.t !== 'char' || !WORD.test(b.ch) || b.link !== a.link) break;
        j++;
      }
    }
    const slice = atoms.slice(i, j) as Extract<Atom, { t: 'char' }>[];
    const text = slice.map((x) => x.ch).join('');
    out.push({ key: `${text}\u0000${a.link ?? ''}`, atoms: slice, text });
    i = j;
  }
  return out;
}

/**
 * Lo que lo nuevo saca de lo que había, o `''` si solo agrega. Se muestra el valor entero que se toca (lo que hay entre
 * los separadores de una celda combinada, `35 mm · ND .6` → `35 mm`), no solo la palabra que cambia.
 */
function removedText(target: Target, atoms: Atom[]): string {
  const old = target.units.slice(target.labelUnits);
  const texts = old.map((u) => (u.atom === 'photo' ? '▣' : u.text));
  const starts: number[] = [];
  let at = 0;
  for (const t of texts) {
    starts.push(at);
    at += t.length;
  }
  const full = texts.join('');
  // Los valores de la celda: lo que hay entre separadores (·, coma, punto y coma, barra o salto de renglón).
  const segments: { from: number; to: number }[] = [];
  const sep = /\s*[·•,;|/\n]\s*/g;
  let last = 0;
  for (const m of full.matchAll(sep)) {
    segments.push({ from: last, to: m.index! });
    last = m.index! + m[0].length;
  }
  segments.push({ from: last, to: full.length });
  const touched = new Set<number>();
  for (const h of diffKeys(oldKeys(target), newUnitsOf(atoms).map((u) => u.key))) {
    for (let i = h.a0; i < h.a1; i++) {
      if (!/\S/.test(texts[i])) continue;
      const pos = starts[i];
      const k = segments.findIndex((s) => pos >= s.from && pos < Math.max(s.to, s.from + 1));
      if (k >= 0) touched.add(k);
    }
  }
  return [...touched]
    .sort((a, b) => a - b)
    .map((k) => full.slice(segments[k].from, segments[k].to).trim())
    .filter(Boolean)
    .join(' … ');
}

const same = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

/** El encabezado de una columna coincide con lo que dijo el modelo (entero, o sin lo de entre paréntesis). */
function sameColumn(said: string, header: string): boolean {
  const s = labelKey(said);
  return s === labelKey(header) || s === labelKey(header.replace(/\([^)]*\)/g, ''));
}

/** El destino de una celda en palabras: la sección, el rótulo de la fila (o "row N") y el encabezado de la columna. */
function cellWhere(t: Target, table: MapTable, newSlate: string | null, rowWord: (n: number) => string, newRow: (slate: string) => string): string[] {
  const out: string[] = [];
  if (t.section) out.push(t.section);
  if (t.sub) out.push(t.sub);
  const label = (t.rowLabel ?? '').trim();
  if (table.headerRow || !table.labelCol) out.push(label ? label : newSlate ? `${rowWord(t.row!)} (${newRow(newSlate)})` : rowWord(t.row!));
  if (table.labelCol) out.push(label);
  else if (t.colLabel) out.push(t.colLabel);
  else out.push(`c${t.col}`);
  return out;
}

function blockWhere(t: Target): string[] {
  const out: string[] = [];
  if (t.section && t.code !== 'H1' && t.code !== 'H2') out.push(t.section);
  if (t.sub && t.code !== 'H3') out.push(t.sub);
  if (t.code === 'L') out.push(t.label);
  else if (t.code === 'K' || t.code === 'H1' || t.code === 'H2' || t.code === 'H3') out.push(t.plain.trim() || '—');
  return out;
}

export interface ValidateContext {
  /** La nota, para saber si nombra la fila elegida. */
  note: string;
  /** Los textos de la interfaz que arman el destino. */
  words: {
    row: (n: number) => string;
    newRow: (slate: string) => string;
    addRow: (after: string) => string;
    newSection: (title: string) => string;
  };
}

interface Raw {
  op?: unknown;
  at?: unknown;
  row?: unknown;
  col?: unknown;
  label?: unknown;
  old?: unknown;
  new?: unknown;
  why?: unknown;
  table?: unknown;
  after?: unknown;
  cells?: unknown;
  shot?: unknown;
  checks?: unknown;
  text?: unknown;
}

/** El texto de un cambio crudo (para *Couldn't place* si no se puede mostrar). */
function rawText(r: Raw): string {
  const op = str(r.op);
  if (op === 'check' || op === 'uncheck') return str(r.label);
  if (op === 'addRow' && r.cells && typeof r.cells === 'object') return Object.values(r.cells as Record<string, unknown>).map(str).filter(Boolean).join(' · ');
  if (op === 'addShotSection') return [str(r.shot), ...(Array.isArray(r.checks) ? r.checks.map(str) : [])].filter(Boolean).join(' · ');
  return str(r.new) || str(r.text);
}

const ADDR_CELL = /^\s*T(\d+)\s*r(\d+)\s*c(\d+)\s*$/i;
const ADDR_BLOCK = /^\s*b(\d+)\s*$/i;

/** La dirección del modelo, escrita como la del mapa (`T3 r3 c3`, `b12`). */
function normAddr(v: unknown): string {
  const s = str(v);
  const c = ADDR_CELL.exec(s);
  if (c) return `T${Number(c[1])} r${Number(c[2])} c${Number(c[3])}`;
  const b = ADDR_BLOCK.exec(s);
  return b ? `b${Number(b[1])}` : '';
}

/** La plantilla de la sección de un plano: la primera de la página con casillas (o la de fábrica, si no hay). */
export function shotTemplate(map: PageMap, builtin: { word: string; checks: string[] }): { word: string; checks: string[] } {
  const own = map.shots.find((s) => s.checks.length > 0);
  if (own) return { word: own.word, checks: own.checks.map((c) => c.plain.trim()).filter(Boolean) };
  return builtin;
}

/**
 * Valida la respuesta contra el mapa (5.4). `'unreadable'` si no es JSON o le falta la forma. `builtinShot`: la sección
 * de un plano de la plantilla de fábrica en el idioma de la página (si la página no tiene ninguna para copiar).
 */
export function validateAnswer(answer: string, map: PageMap, ctx: ValidateContext, builtinShot: { word: string; checks: string[] }): Plan | ReadError {
  const json = extractJson(answer) as { heard?: unknown; changes?: unknown; ask?: unknown; unplaced?: unknown } | undefined;
  if (!json || typeof json !== 'object' || Array.isArray(json)) return 'unreadable';
  const raws: Raw[] = Array.isArray(json.changes) ? (json.changes.filter((c) => c && typeof c === 'object') as Raw[]) : [];
  if (json.changes !== undefined && !Array.isArray(json.changes)) return 'unreadable';
  const seen = { linksRemoved: false };
  const unplaced: string[] = [];
  const keepOut = (r: Raw) => {
    const t = rawText(r).trim();
    if (t) unplaced.push(t.slice(0, MAX_TEXT));
  };
  const changes: Change[] = [];
  const used = new Set<string>();
  const shotsAdded = new Set<string>();
  // La *Slate* que escribe la nota en cada fila vacía (las filas vacías tienen todas el mismo rótulo).
  const slates = new Map<string, string>();
  for (const r of raws) {
    if (str(r.op) !== 'setCell') continue;
    const t = map.targets.get(normAddr(r.at));
    if (t && t.kind === 'cell' && t.col === 1 && !t.labelCell && !(t.rowLabel ?? '').trim()) slates.set(`${t.table}:${t.row}`, str(r.new).trim());
  }
  const tableOf = (t: Target) => map.tables.find((x) => x.n === t.table)!;
  // El nombre que la nota le pone a la sección vacía de un plano (`Shot ` → `Shot 12_010`).
  const renamed = new Map<string, string>();
  for (const r of raws) {
    if (str(r.op) !== 'setText') continue;
    const t = map.targets.get(normAddr(r.at));
    const shot = t && map.shots.find((x) => x.heading.addr === t.addr);
    const name = shotOfHeading(str(r.new))?.name;
    if (shot && name) renamed.set(shot.heading.addr, name);
  }

  for (const [i, r] of raws.entries()) {
    if (i >= MAX_CHANGES) {
      keepOut(r);
      continue;
    }
    const op = str(r.op) as Op;
    const why = str(r.why).slice(0, 200);
    const newText = str(r.new);
    if (newText.length > MAX_TEXT || str(r.text).length > MAX_TEXT) {
      keepOut(r);
      continue;
    }
    if (op === 'setCell' || op === 'setText') {
      const t = map.targets.get(normAddr(r.at));
      if (!t || used.has(t.addr) || (op === 'setCell') !== (t.kind === 'cell')) {
        keepOut(r);
        continue;
      }
      if (t.kind === 'cell') {
        const slate = slates.get(`${t.table}:${t.row}`) ?? null;
        // Los rótulos de la fila y de la columna, comparados con el mapa: frena correrse una fila o una columna.
        const rowOk = labelKey(str(r.row)) === labelKey(t.rowLabel ?? '') || (!!slate && labelKey(str(r.row)) === labelKey(slate));
        const colOk = t.colLabel ? sameColumn(str(r.col), t.colLabel) : !str(r.col).trim() || labelKey(str(r.col)) === labelKey(t.rowLabel ?? '') || /^c\d+$/i.test(str(r.col).trim());
        // Las filas vacías tienen todas el mismo rótulo: si la nota le puso la *Slate* a otra fila vacía de esta tabla,
        // lo de una fila vacía sin *Slate* propia se corrió de fila (no se adivina cuál era).
        const strayEmpty =
          !slate && !(t.rowLabel ?? '').trim() && [...slates.keys()].some((k) => k.startsWith(`${t.table}:`) && k !== `${t.table}:${t.row}`);
        if (t.labelCell || !rowOk || !colOk || strayEmpty) {
          keepOut(r);
          continue;
        }
      } else {
        if (labelKey(str(r.label)) !== labelKey(t.label)) {
          keepOut(r);
          continue;
        }
      }
      // Lo que había: tiene que ser lo del mapa (el modelo leyó bien).
      if ((r.old === undefined && t.text.trim() !== '') || (r.old !== undefined && !same(str(r.old), t.text))) {
        keepOut(r);
        continue;
      }
      let value = newText;
      // Un renglón con rótulo: si el modelo repitió el rótulo, se saca (el rótulo es de la plantilla).
      if (t.code === 'L' && labelKey(value).startsWith(labelKey(t.label)) && value.trimStart().toLowerCase().startsWith(t.label.toLowerCase())) value = value.trimStart().slice(t.label.length).trimStart();
      const atoms = parseNew(value, t, seen);
      if (atoms === 'marker') {
        keepOut(r);
        continue;
      }
      if (same(atomsPlain(atoms), t.plain) && value.trim() === t.text.trim()) continue;
      used.add(t.addr);
      const table = t.kind === 'cell' ? tableOf(t) : null;
      const slate = t.kind === 'cell' ? (slates.get(`${t.table}:${t.row}`) ?? null) : null;
      const where = table ? cellWhere(t, table, slate, ctx.words.row, ctx.words.newRow) : blockWhere(t);
      changes.push({
        id: changes.length + 1,
        op,
        target: t,
        atoms,
        where,
        before: t.plain,
        after: atomsPlain(atoms),
        replaces: removedText(t, atoms),
        chosen: chosenRow(map, ctx.note, t, slate, renamed),
        why,
        text: atomsPlain(atoms),
      });
      continue;
    }
    if (op === 'check' || op === 'uncheck') {
      const t = map.targets.get(normAddr(r.at));
      if (!t || used.has(t.addr) || t.code !== 'K' || labelKey(str(r.label)) !== labelKey(t.plain)) {
        keepOut(r);
        continue;
      }
      if (t.checked === (op === 'check')) continue;
      used.add(t.addr);
      changes.push({
        id: changes.length + 1,
        op,
        target: t,
        where: blockWhere(t),
        before: t.checked ? '☑' : '☐',
        after: op === 'check' ? '☑' : '☐',
        replaces: '',
        chosen: chosenRow(map, ctx.note, t, null, renamed),
        why,
        text: t.plain.trim(),
      });
      continue;
    }
    if (op === 'appendText') {
      const t = map.targets.get(normAddr(r.at));
      const text = (str(r.text) || newText).trim();
      // Un solo cambio por lugar: escribir y agregar en el mismo párrafo vacío chocarían al aplicar.
      if (!t || t.kind !== 'block' || !text || used.has(t.addr)) {
        keepOut(r);
        continue;
      }
      used.add(t.addr);
      const atoms = parseNew(text, null, seen);
      if (atoms === 'marker') {
        keepOut(r);
        continue;
      }
      changes.push({
        id: changes.length + 1,
        op,
        target: t,
        atoms,
        where: [...blockWhere(t), ...(t.code === 'H1' || t.code === 'H2' || t.code === 'H3' ? [] : [t.plain.trim().slice(0, 40) || '—'])].filter(Boolean),
        before: '',
        after: atomsPlain(atoms),
        replaces: '',
        chosen: false,
        why,
        text: atomsPlain(atoms),
      });
      continue;
    }
    if (op === 'addRow') {
      const tableN = /^\s*T(\d+)/i.exec(str(r.table))?.[1] ?? /^\s*T(\d+)/i.exec(str(r.after))?.[1];
      const table = tableN ? map.tables.find((x) => x.n === Number(tableN)) : undefined;
      const afterN = Number(/r(\d+)\s*$/i.exec(str(r.after))?.[1] ?? NaN);
      const afterRow = table?.rows[afterN - 1];
      if (!table || !table.headerRow || !afterRow || labelKey(str(r.row)) !== labelKey(afterRow[0]?.rowLabel ?? '') || !r.cells || typeof r.cells !== 'object') {
        keepOut(r);
        continue;
      }
      const cells = Array.from({ length: table.cols }, () => '');
      const extra: string[] = [];
      for (const [col, value] of Object.entries(r.cells as Record<string, unknown>)) {
        const text = str(value).trim();
        if (!text) continue;
        const at = table.rows[0].findIndex((h) => sameColumn(col, h.plain) || col.trim().toLowerCase() === `c${h.col}`);
        if (at < 0 || cells[at] || text.length > MAX_TEXT || /⟦/.test(text)) extra.push(text);
        else cells[at] = text;
      }
      unplaced.push(...extra);
      if (cells.every((c) => !c)) continue;
      const slate = cells[0];
      const where = [table.section, table.sub, ctx.words.addRow(afterRow[0]?.rowLabel?.trim() || ctx.words.row(afterN))].filter(Boolean);
      const after = cells.map((c, k) => (c ? `${table.rows[0][k]?.plain ?? `c${k + 1}`}: ${c}` : '')).filter(Boolean).join(' · ');
      changes.push({
        id: changes.length + 1,
        op,
        target: afterRow[0],
        table,
        cells: cells.map((c) => linkFree(c, seen)),
        where,
        before: '',
        after,
        replaces: '',
        chosen: !!slate && !noteMentions(ctx.note, slate),
        why,
        text: cells.filter(Boolean).join(' · '),
      });
      continue;
    }
    if (op === 'addShotSection') {
      const shot = str(r.shot).trim().slice(0, 80);
      const template = shotTemplate(map, builtinShot);
      const exists = (name: string) => map.shots.some((s) => s.name && labelKey(s.name) === labelKey(name)) || shotsAdded.has(labelKey(name));
      if (!shot || !map.vfx?.blockId || exists(shot)) {
        keepOut(r);
        continue;
      }
      const wanted = Array.isArray(r.checks) ? r.checks.map(str).filter(Boolean) : [];
      const checks: string[] = [];
      for (const w of wanted) {
        const hit = template.checks.find((c) => labelKey(c) === labelKey(w));
        if (hit) checks.push(hit);
        else unplaced.push(w);
      }
      shotsAdded.add(labelKey(shot));
      const title = `${capital(template.word)} ${linkFree(shot, seen)}`;
      changes.push({
        id: changes.length + 1,
        op,
        shot: linkFree(shot, seen),
        checks,
        where: [map.vfx.text, ctx.words.newSection(title)],
        before: '',
        after: [title, ...checks.map((c) => `☑ ${c}`)].join(' · '),
        replaces: '',
        chosen: false,
        why,
        text: [title, ...checks].join(' · '),
      });
      continue;
    }
    keepOut(r);
  }

  const extraUnplaced = json.unplaced;
  if (typeof extraUnplaced === 'string' && extraUnplaced.trim()) unplaced.unshift(extraUnplaced.trim().slice(0, MAX_TEXT * 2));
  else if (Array.isArray(extraUnplaced)) unplaced.unshift(...extraUnplaced.map(str).map((s) => s.trim()).filter(Boolean));

  let ask: Plan['ask'] = null;
  const rawAsk = json.ask as { question?: unknown; options?: unknown } | null | undefined;
  if (rawAsk && typeof rawAsk === 'object' && Array.isArray(rawAsk.options)) {
    const options: AskOption[] = [];
    for (const o of rawAsk.options.slice(0, 8)) {
      const s = str(o).trim();
      if (!s) continue;
      const addr = /^\s*T(\d+)\s*r(\d+)/i.exec(s);
      const table = addr ? map.tables.find((x) => x.n === Number(addr[1])) : undefined;
      const row = table?.rows[Number(addr![2]) - 1];
      if (table && row && !(table.headerRow && Number(addr![2]) === 1)) {
        const label = row[0]?.plain.trim() || ctx.words.row(Number(addr![2]));
        options.push({ label, answer: `${label} (row r${addr![2]} of table T${table.n}${table.section ? `, "${table.section}"` : ''})` });
      } else if (!addr) options.push({ label: s.slice(0, 80), answer: s.slice(0, 200) });
    }
    if (options.length > 0) ask = { question: str(rawAsk.question).trim().slice(0, 200), options };
  }
  return { heard: str(json.heard).trim().slice(0, 1000), changes, unplaced, ask, linksRemoved: seen.linksRemoved };
}

const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Un texto sin links nuevos (quedan como su texto). */
function linkFree(text: string, seen: { linksRemoved: boolean }): string {
  return text.replace(/(^|[^!])\[([^\]\n]*)\]\(([^)\s]*)\)/g, (_all, pre: string, inner: string) => {
    seen.linksRemoved = true;
    return pre + inner;
  });
}

/**
 * Si la fila (o la sección del plano) la eligió el modelo sin una señal propia: no es la del cursor y la nota no la
 * nombra. Solo cuenta en tablas con encabezado (las de filas por plano) y en las secciones de los planos.
 */
function chosenRow(map: PageMap, note: string, t: Target, slate: string | null, renamed: Map<string, string>): boolean {
  if (t.kind === 'cell') {
    const table = map.tables.find((x) => x.n === t.table);
    if (!table?.headerRow) return false;
    if (map.cursor?.table === t.table && map.cursor?.row === t.row) return false;
    const label = (slate ?? t.rowLabel ?? '').trim();
    return !label || !noteMentions(note, label);
  }
  const shot: ShotSection | undefined = map.shots.find((s) => s.heading.addr === t.addr || s.checks.some((c) => c.addr === t.addr));
  if (!shot) return false;
  if (map.cursor?.shot !== undefined && map.cursor.shot === shot.name) return false;
  const name = shot.name || renamed.get(shot.heading.addr) || '';
  return !name || !noteMentions(note, name);
}
