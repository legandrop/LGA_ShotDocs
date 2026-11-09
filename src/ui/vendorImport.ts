// Importar vendors desde una planilla (Docs/Doc_Compartir_Escenas.md, sección 13, D855). Todo pasa en el dispositivo:
// se lee un .xlsx o un .csv, se encuentra la hoja con los planos (el encabezado con «SHOT» y «VENDOR», aunque haya filas
// de resumen arriba), y de cada plano salen la escena (del shot name: `ERSO_1016_0300` → 1016) y sus vendors (la celda
// se parte por la coma). Si el proyecto tiene esa escena solo con letra (1016A y 1016B), la letra sale del clip
// (`101_16A2-01-06` → 1016A). El resultado no toca nada: la ventana lo muestra y, al aplicar, queda marcado en la
// ventana de vendors hasta *Save*.
//
// Sin librería: un .xlsx es un zip de XML. El zip se recorre a mano (directorio central) y cada archivo se descomprime
// con `DecompressionStream('deflate-raw')`, que traen los navegadores y Node.

/** Una hoja: sus filas como texto, con las celdas vacías en blanco. */
export interface Sheet {
  name: string;
  rows: string[][];
}

/** Lo más grande que se lee de un CSV. Un .xlsx puede pesar cientos de MB (las miniaturas de cada plano van adentro):
 * de ese se leen solo el índice y las hojas, nunca las imágenes. */
export const MAX_CSV_BYTES = 50 * 1024 * 1024;
/** Lo más grande que se descomprime de una hoja (una de miles de filas pesa pocos MB). */
const MAX_PART_BYTES = 200 * 1024 * 1024;

export class SheetError extends Error {}

/** Lee un .xlsx o un .csv (por el contenido). Las hojas ocultas de Excel no se ofrecen. */
export async function readSpreadsheet(file: Blob, name: string): Promise<Sheet[]> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (head[0] === 0x50 && head[1] === 0x4b) return readXlsx(file);
  if (/\.(xls|numbers)$/i.test(name)) throw new SheetError('format');
  if (file.size > MAX_CSV_BYTES) throw new SheetError('too_big');
  const sheet = { name: name.replace(/\.[^.]+$/, '') || 'CSV', rows: parseCsv(new TextDecoder().decode(await file.arrayBuffer())) };
  return [sheet];
}

/* ---------- Zip ---------- */

const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
const bytes = async (file: Blob, from: number, to: number) => new Uint8Array(await file.slice(from, to).arrayBuffer());

/** Los archivos del zip que pide `want`, descomprimidos. Lee del archivo solo el índice y esos archivos. */
export async function unzip(file: Blob, want: (name: string) => boolean): Promise<Map<string, Uint8Array>> {
  // El final del directorio central: desde el final, salteando el comentario (hasta 64 KB).
  const tailFrom = Math.max(0, file.size - 65557);
  const tail = await bytes(file, tailFrom, file.size);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32(tail, i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new SheetError('format');
  const count = u16(tail, end + 10);
  const dirSize = u32(tail, end + 12);
  const dirAt = u32(tail, end + 16);
  // Un zip de más de 4 GB o con más de 65.535 archivos (ZIP64) no se lee.
  if (count === 0xffff || dirAt === 0xffffffff || dirAt + dirSize > file.size) throw new SheetError('format');
  const dir = await bytes(file, dirAt, dirAt + dirSize);
  const out = new Map<string, Uint8Array>();
  const names = new TextDecoder();
  let at = 0;
  for (let n = 0; n < count; n++) {
    if (u32(dir, at) !== 0x02014b50) throw new SheetError('format');
    const method = u16(dir, at + 10);
    const size = u32(dir, at + 20);
    const nameLen = u16(dir, at + 28);
    const extraLen = u16(dir, at + 30);
    const commentLen = u16(dir, at + 32);
    const local = u32(dir, at + 42);
    const fileName = names.decode(dir.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;
    if (!want(fileName)) continue;
    if (size > MAX_PART_BYTES) throw new SheetError('too_big');
    const lh = await bytes(file, local, local + 30);
    if (u32(lh, 0) !== 0x04034b50) throw new SheetError('format');
    const start = local + 30 + u16(lh, 26) + u16(lh, 28);
    const data = await bytes(file, start, start + size);
    if (method === 0) out.set(fileName, data);
    else if (method === 8) out.set(fileName, await inflate(data));
    else throw new SheetError('format');
  }
  return out;
}

/** Lo más que puede ocupar una parte ya descomprimida: un archivo que se infla de más se corta, no llena la memoria. */
const MAX_INFLATED_BYTES = 256 * 1024 * 1024;

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const reader = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_INFLATED_BYTES) {
      await reader.cancel();
      throw new SheetError('too_big');
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/* ---------- Excel ---------- */

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
/** Un carácter por su número; uno que no existe queda escrito como venía. */
const codePoint = (n: number, raw: string) => (Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : raw);
/** Saca el prefijo de las etiquetas (`<x:row>` → `<row>`): lo usan algunos programas que generan Excel. */
const unprefix = (xml: string) => xml.replace(/<(\/?)[A-Za-z][\w.-]*:(?=[A-Za-z])/g, '<$1');
const unescapeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
    e[0] === '#' ? codePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1), m) : (ENTITY[e] ?? m),
  );
const attrs = (tag: string) => {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:]+)="([^"]*)"/g)) out[m[1]] = unescapeXml(m[2]);
  return out;
};
/** El texto de un `<si>` o un `<is>`: todos sus `<t>` (también el texto con formato, en partes). */
const textOf = (xml: string) =>
  [...xml.replace(/<t\b[^>]*\/>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join('');
/** `A` → 0, `Z` → 25, `AA` → 26. */
export const columnIndex = (letters: string) => [...letters.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
/** 0 → `A`, 26 → `AA`. */
export const columnLetters = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : columnLetters(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));

async function readXlsx(file: Blob): Promise<Sheet[]> {
  const files = await unzip(file,(n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/[^/]+\.xml$/.test(n));
  const text = (n: string) => {
    const f = files.get(n);
    return f ? unprefix(new TextDecoder().decode(f)) : null;
  };
  const workbook = text('xl/workbook.xml');
  const rels = text('xl/_rels/workbook.xml.rels');
  if (!workbook || !rels) throw new SheetError('format');
  const targets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const a = attrs(m[1]);
    if (a.Id && a.Target) targets.set(a.Id, a.Target.replace(/^\/?xl\//, '').replace(/^\//, ''));
  }
  const strings = [...(text('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  const listed = [...workbook.matchAll(/<sheet\b([^>]*)\/?>/g)].map((m) => attrs(m[1]));
  const visible = listed.filter((a) => a.state !== 'hidden' && a.state !== 'veryHidden');
  const sheets: Sheet[] = [];
  for (const a of visible.length ? visible : listed) {
    const target = targets.get(a['r:id'] ?? '');
    const xml = target ? text(`xl/${target}`) : null;
    if (a.name && xml !== null) sheets.push({ name: a.name, rows: sheetRows(xml, strings) });
  }
  if (sheets.length === 0) throw new SheetError('empty');
  return sheets;
}

function sheetRows(xml: string, strings: string[]): string[][] {
  const rows: string[][] = [];
  let next = 0;
  for (const r of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const ra = attrs(r[1]);
    const n = ra.r ? +ra.r - 1 : next;
    next = n + 1;
    const cells: string[] = [];
    let col = 0;
    for (const c of (r[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ca = attrs(c[1]);
      const at = ca.r ? columnIndex(ca.r.replace(/\d+$/, '')) : col;
      col = at + 1;
      const body = c[2] ?? '';
      let v: string;
      if (ca.t === 'inlineStr') v = textOf(body);
      else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        if (raw === undefined) continue;
        v = ca.t === 's' ? (strings[+raw] ?? '') : unescapeXml(raw);
        // Excel guarda 1001 como «1001» y a veces como «1001.0»: el número sin decimales vacíos.
        if (!ca.t && /^-?\d+\.0+$/.test(v)) v = v.replace(/\.0+$/, '');
      }
      cells[at] = v.trim();
    }
    rows[n] = Array.from(cells, (x) => x ?? '');
  }
  return Array.from(rows, (x) => x ?? []);
}

/* ---------- CSV ---------- */

/** CSV con comillas. El separador (coma, punto y coma o tabulación) es el que está en más renglones de los primeros 40:
 * un renglón de resumen arriba (`Total: 1,234`) no lo cambia. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const head = src.split(/\r?\n/, 40).filter((l) => l.trim());
  const score = (s: string) => [head.filter((l) => l.includes(s)).length, head.reduce((n, l) => n + l.split(s).length - 1, 0)] as const;
  const sep = [',', ';', '\t']
    .map((s) => [s, score(s)] as const)
    .sort((a, b) => b[1][0] - a[1][0] || b[1][1] - a[1][1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    }
    else if (ch === sep) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows;
}

/* ---------- Encontrar las columnas ---------- */

/** Dónde está cada cosa: la fila del encabezado y las columnas (−1: no hay). */
export interface Layout {
  header: number;
  shot: number;
  vendor: number;
  letter: number;
}

const SHOT_HEAD = /^(shot\s*_?\s*name|shotname|shot\s*code|shot|plano|nombre\s+del\s+plano)$/i;
const VENDOR_HEAD = /^(vendors?|vendor\s*name|proveedor(es)?)$/i;
const LETTER_HEAD = /^(sub\s*clip|subclip|clip\s*name|clip)$/i;

/** El encabezado en las primeras 40 filas: la que tiene una columna de shot y una de vendor. */
export function detectLayout(rows: string[][]): Layout | null {
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const row = rows[r] ?? [];
    const find = (re: RegExp) => row.findIndex((c) => re.test(c.trim()));
    const shot = find(SHOT_HEAD);
    const vendor = find(VENDOR_HEAD);
    if (shot >= 0 && vendor >= 0) return { header: r, shot, vendor, letter: find(LETTER_HEAD) };
  }
  return null;
}

/** La primera hoja con encabezado de shot y vendor, o la primera. */
export function pickSheet(sheets: Sheet[]): number {
  const i = sheets.findIndex((s) => detectLayout(s.rows) !== null);
  return i >= 0 ? i : 0;
}

/* ---------- Escenas ---------- */

/** El shot name: `<prefijo>_<escena>_<plano>` (`ERSO_1016_0300`, `ERSO_1033A_0100`, `PROY_074_010`). */
const SHOT = /^[A-Za-z][A-Za-z0-9-]*_(\d{3,4})([A-Za-z]{0,2})_[A-Za-z0-9]+$/;

/** La escena de un shot name en la forma de la post (`1016`, `1033A`, `074`), o `null`. */
export function shotScene(shot: string): string | null {
  const m = SHOT.exec(shot.trim());
  return m ? m[1] + m[2].toUpperCase() : null;
}
export const isShotName = (s: string) => shotScene(s) !== null;

/** La clave de una escena del proyecto en la forma de la post: `101_016A` → `1016A`; sin episodio, `074` → `074`. */
export function postKey(code: string): string | null {
  const ep = /^(\d{3})_(\d{3})([A-Z]{0,2})$/.exec(code);
  if (ep) {
    // La cifra de la post es el número del episodio sin la primera cifra (101 → 1); 110 no tiene una sola.
    const d = String(+ep[1].slice(1));
    return d.length === 1 && d !== '0' ? d + ep[2] + ep[3] : null;
  }
  const flat = /^(\d{3})([A-Z]{0,2})$/.exec(code);
  return flat ? flat[1] + flat[2] : null;
}

/** La letra que da el clip para esa escena (`101_16A2-01-06` con `1016` → `A`), o `null`. Si el clip dice el
 * episodio, tiene que ser el de la escena (`102_16A…` no es de la `1016`). */
export function clipLetter(clip: string, scene: string): string | null {
  const m = /^(?:(\d{3})_)?0*(\d{1,3})([A-Za-z])/.exec(clip.trim());
  if (!m || +m[2] !== +scene.slice(-3)) return null;
  if (m[1] && scene.length === 4 && String(+m[1].slice(1)) !== scene[0]) return null;
  return m[3].toUpperCase();
}

/* ---------- Vendors ---------- */

/** Los vendors de una celda: se parte por coma, punto y coma o barra. */
export const splitVendors = (cell: string) =>
  cell
    .split(/[,;/]/)
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const keyOfName = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

function distance(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return d[b.length];
}
/** Dos nombres que son el mismo vendor escrito distinto: iguales sin signos, o a una letra (`Net-Fx` y `Net VFX`). */
export function similarNames(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return Math.min(x.length, y.length) >= 4 && distance(x, y) <= 1;
}

/** El nombre (o el código) de un vendor del proyecto es el de la planilla, sin ninguna diferencia más que signos y
 * espacios: lo demás es un parecido y se marca como sugerido. */
export function sameVendor(v: { name: string; code?: string }, name: string): boolean {
  return (!!norm(v.name) && norm(v.name) === norm(name)) || (!!v.code && norm(v.code) === norm(name));
}

/** El código que se propone: una palabra corta entera (BOAT), una larga en 3 letras (WAN), varias por iniciales (MW), y
 * si la última es una sigla, la inicial más la sigla (Net-Fx → NFX). */
export function proposeCode(name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9 -]/g, '').split(/[\s-]+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0].slice(0, words[0].length <= 4 ? 4 : 3);
  const last = words[words.length - 1];
  return (last.length <= 2 ? words.slice(0, -1).map((w) => w[0]).join('') + last : words.map((w) => w[0]).join('')).slice(0, 4);
}

/** Un nombre de la planilla, con cuántos planos y escenas lo nombran. */
export interface Source {
  key: string;
  name: string;
  shots: number;
  scenes: number;
}

/** Qué se hace con un nombre de la planilla. */
export type Mapping =
  | { mode: 'new'; name: string; code: string; color: string }
  | { mode: 'existing'; vendor: string }
  | { mode: 'merge'; into: string }
  | { mode: 'skip' };

/** Un vendor del proyecto, como lo ve la importación. */
export interface ExistingVendor {
  key: string;
  name: string;
  code: string;
}

/** Las filas de planos de una hoja, desde abajo del encabezado. */
export interface ShotRow {
  shot: string;
  vendors: string[];
  clip: string;
}

export function shotRows(rows: string[][], layout: Layout): ShotRow[] {
  const out: ShotRow[] = [];
  for (const row of rows.slice(layout.header + 1)) {
    const shot = (row[layout.shot] ?? '').trim();
    if (!shot) continue;
    out.push({ shot, vendors: layout.vendor >= 0 ? splitVendors(row[layout.vendor] ?? '') : [], clip: layout.letter >= 0 ? (row[layout.letter] ?? '') : '' });
  }
  return out;
}

/** Cuántas filas de la columna parecen shot names (para avisar si se eligió otra columna). */
export function shotShare(rows: ShotRow[]): number {
  return rows.length ? rows.filter((r) => isShotName(r.shot)).length / rows.length : 0;
}

export function sourcesOf(rows: ShotRow[]): Source[] {
  const m = new Map<string, { name: string; shots: number; scenes: Set<string> }>();
  for (const r of rows) {
    const scene = shotScene(r.shot);
    for (const name of r.vendors) {
      const k = keyOfName(name);
      const s = m.get(k) ?? { name, shots: 0, scenes: new Set<string>() };
      s.shots++;
      if (scene) s.scenes.add(scene);
      m.set(k, s);
    }
  }
  return [...m]
    .map(([key, s]) => ({ key, name: s.name, shots: s.shots, scenes: s.scenes.size }))
    .sort((a, b) => b.shots - a.shots || a.name.localeCompare(b.name));
}

/** Lo que se propone para cada nombre: un vendor del proyecto que se escribe igual o casi; si no, otro nombre de la
 * planilla más usado y casi igual (`Net VFX` → `Net-Fx`); si no, crearlo con código y el primer color libre. */
export function defaultMappings(sources: Source[], vendors: ExistingVendor[], colors: { presets: readonly string[]; used: Iterable<string> }): Record<string, Mapping> {
  const used = new Set(colors.used);
  const codes = new Set(vendors.map((v) => v.code).filter(Boolean));
  const out: Record<string, Mapping> = {};
  for (const s of sources) {
    const ex = vendors.find((v) => similarNames(v.name, s.name) || (!!v.code && norm(v.code) === norm(s.name)));
    if (ex) {
      out[s.key] = { mode: 'existing', vendor: ex.key };
      continue;
    }
    // El más usado de los dos; empatados, el primero de la lista (si no, ninguno se uniría al otro).
    const before = (o: Source) => o.shots > s.shots || (o.shots === s.shots && sources.indexOf(o) < sources.indexOf(s));
    const twin = sources.find((o) => o !== s && before(o) && similarNames(o.name, s.name));
    if (twin) {
      // Si ese también se une a otro, va directo al último: nunca una cadena de uniones.
      const t = out[twin.key];
      out[s.key] = { mode: 'merge', into: t?.mode === 'merge' ? t.into : twin.key };
      continue;
    }
    const color = colors.presets.find((c) => !used.has(c)) ?? colors.presets[used.size % colors.presets.length];
    used.add(color);
    out[s.key] = { mode: 'new', name: s.name, code: uniqueCode(proposeCode(s.name), codes), color };
  }
  return out;
}

/** Un código que no tenga otro vendor: si está, se le cambia el final por una cifra (`BOAT` → `BOA2`). */
function uniqueCode(code: string, taken: Set<string>): string {
  let out = code;
  for (let n = 2; out && taken.has(out) && n < 10; n++) out = code.slice(0, 3) + n;
  if (out) taken.add(out);
  return out;
}

/** El destino de un nombre: `v:<vendor>` (uno del proyecto), `n:<nombre>` (uno nuevo) o `null` (no se importa). */
export function targetOf(maps: Record<string, Mapping>, key: string, seen = new Set<string>()): string | null {
  const m = maps[key];
  if (!m || seen.has(key)) return null;
  seen.add(key);
  if (m.mode === 'new') return `n:${key}`;
  if (m.mode === 'existing') return `v:${m.vendor}`;
  if (m.mode === 'merge') return targetOf(maps, m.into, seen);
  return null;
}

/* ---------- El análisis ---------- */

/** Una escena del proyecto. */
export interface SceneRef {
  pageId: string;
  code: string;
}

/** Las escenas del proyecto por su clave en la forma de la post (`1016A`). Si dos escenas dan la misma clave (101_016 y
 * 201_016, dos episodios que terminan igual) la clave queda en `null`: no se adivina cuál es. */
export function sceneIndex(scenes: SceneRef[]): Map<string, SceneRef | null> {
  const out = new Map<string, SceneRef | null>();
  for (const s of scenes) {
    const k = postKey(s.code);
    if (!k) continue;
    const had = out.get(k);
    out.set(k, had === undefined || had?.pageId === s.pageId ? s : null);
  }
  return out;
}

/** La escena de un plano: la exacta, la de la letra del clip (si existe solo con letra), ninguna clara, o sin página. */
export type ShotScene =
  | { kind: 'exact' | 'letter'; base: string; scene: SceneRef }
  | { kind: 'ambiguous' | 'none'; base: string }
  | { kind: 'bad' };

export function resolveShot(row: Pick<ShotRow, 'shot' | 'clip'>, index: Map<string, SceneRef | null>): ShotScene {
  const base = shotScene(row.shot);
  if (!base) return { kind: 'bad' };
  const exact = index.get(base);
  if (exact === null) return { kind: 'ambiguous', base };
  if (exact) return { kind: 'exact', base, scene: exact };
  const lettered = [...index.keys()].some((k) => k.length > base.length && k.startsWith(base) && /^[A-Z]+$/.test(k.slice(base.length)));
  if (!lettered) return { kind: 'none', base };
  const letter = clipLetter(row.clip, base);
  const scene = letter ? index.get(base + letter) : undefined;
  return scene ? { kind: 'letter', base, scene } : { kind: 'ambiguous', base };
}

export interface Analysis {
  /** Escena → destinos, de lo que se puede asignar. */
  assign: Map<string, Set<string>>;
  /** Las que existen solo con letra y se resolvieron por el clip: la escena de la post → página → destinos. */
  viaLetter: Map<string, Map<string, Set<string>>>;
  /** Las que existen solo con letra y el clip no la dice: la escena de la post → destinos. */
  ambiguous: Map<string, Set<string>>;
  /** Sin página en el proyecto: la escena de la post → destinos. */
  noPage: Map<string, Set<string>>;
  /** Página que no se puede asignar (bloqueada o sin la marca) → destinos. */
  blocked: Map<string, Set<string>>;
  shots: number;
  shotsNoVendor: number;
  /** Escenas con planos pero ninguno con vendor. */
  scenesNoVendor: number;
  /** Filas cuyo shot name no tiene la forma de un plano. */
  badShots: number;
}

/**
 * Cruza los planos con las escenas del proyecto. `canAssign` dice si una escena se le puede dar a un destino (la que está
 * bloqueada, o un vendor que quien importa no puede ampliar): si no, va a `blocked`.
 */
export function analyze(rows: ShotRow[], scenes: SceneRef[], maps: Record<string, Mapping>, canAssign: (pageId: string, target: string) => boolean): Analysis {
  const index = sceneIndex(scenes);
  const add =<K>(m: Map<K, Set<string>>, k: K, ts: string[]) => {
    const s = m.get(k) ?? new Set<string>();
    for (const t of ts) s.add(t);
    m.set(k, s);
  };
  const a: Analysis = {
    assign: new Map(),
    viaLetter: new Map(),
    ambiguous: new Map(),
    noPage: new Map(),
    blocked: new Map(),
    shots: rows.length,
    shotsNoVendor: 0,
    scenesNoVendor: 0,
    badShots: 0,
  };
  const seen = new Set<string>();
  const withVendor = new Set<string>();
  for (const r of rows) {
    const base = shotScene(r.shot);
    if (!base) {
      a.badShots++;
      continue;
    }
    seen.add(base);
    const ts = [...new Set(r.vendors.map((n) => targetOf(maps, keyOfName(n))).filter((t): t is string => t !== null))];
    if (ts.length === 0) {
      a.shotsNoVendor++;
      continue;
    }
    withVendor.add(base);
    const found = resolveShot(r, index);
    if (!('scene' in found)) {
      add(found.kind === 'none' ? a.noPage : a.ambiguous, base, ts);
      continue;
    }
    const scene = found.scene;
    const fromLetter = found.kind === 'letter';
    const ok = ts.filter((t) => canAssign(scene.pageId, t));
    if (ok.length < ts.length) add(a.blocked, scene.pageId, ts.filter((t) => !ok.includes(t)));
    if (ok.length === 0) continue;
    add(a.assign, scene.pageId, ok);
    if (fromLetter) {
      const per = a.viaLetter.get(base) ?? new Map<string, Set<string>>();
      add(per, scene.pageId, ok);
      a.viaLetter.set(base, per);
    }
  }
  a.scenesNoVendor = [...seen].filter((s) => !withVendor.has(s)).length;
  return a;
}

/** Una escena que la planilla le da a otro vendor que el que tiene. */
export interface Change {
  pageId: string;
  /** Los vendors que tiene y la planilla ya no le da: se le sacan solo si se confirma. */
  gone: string[];
  /** Los que la planilla le da y no tiene. */
  add: string[];
  /** Los que tiene y la planilla también le da. */
  keep: string[];
}

/**
 * Lo que cambia contra lo que ya está asignado (`current`: escena → vendors del proyecto, como `v:<vendor>`). Solo se
 * miran las escenas de la planilla: las demás no se tocan.
 */
export function diff(assign: Map<string, Set<string>>, current: Map<string, Set<string>>): { adds: [string, string][]; changes: Change[]; untouched: number } {
  const adds: [string, string][] = [];
  const changes: Change[] = [];
  for (const [pageId, ts] of assign) {
    const was = current.get(pageId) ?? new Set<string>();
    const add = [...ts].filter((t) => !was.has(t));
    for (const t of add) adds.push([pageId, t]);
    const gone = [...was].filter((t) => !ts.has(t));
    if (gone.length) changes.push({ pageId, gone, add, keep: [...ts].filter((t) => was.has(t)) });
  }
  let untouched = 0;
  for (const [pageId, vs] of current) if (vs.size && !assign.has(pageId)) untouched++;
  return { adds, changes, untouched };
}
