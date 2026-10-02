import type { PartialBlock } from '@blocknote/core';
import { MEDIA_SCHEME, mediaIdOf } from '../media/queue';
import { pagePath } from '../router';
import { schema } from '../ui/editorSchema';

// Los bloques de una página de un archivo exportado (Docs/Doc_Exportar.md, sección 3, "Validación"), antes de
// escribirlos: el zip puede venir de cualquiera (editado a mano, de una versión más nueva, armado para romper algo).
// Se revisa cada bloque contra el esquema de la app y se cambia lo que apunta al proyecto viejo:
//
//   - Un tipo de bloque que esta versión no conoce pasa a párrafo con su texto (y sus hijos quedan); un tipo de
//     contenido en línea que no conoce, a su texto. Una propiedad que el esquema no tiene, o con un valor de otro tipo,
//     se saca (BlockNote la tiraría sin avisar). Todo queda anotado: nunca se descarta nada en silencio.
//   - Cada `sdmedia://<id viejo>` pasa al archivo nuevo; si el archivo no vino en el zip, la foto o el adjunto pasa a
//     un renglón con su nombre y "(not in the archive)" (nunca un bloque que apunte a un id de otro workspace). Una
//     dirección `https:`/`http:` queda; cualquier otra (`data:`, `blob:`, `javascript:`…) se saca, anotada.
//   - Un link a una página del archivo va a la página nueva; a una de afuera, queda su texto. Solo `https:`, `http:`,
//     `mailto:` y los de las páginas; otro esquema queda como texto.
//   - Los ids de los bloques se conservan (los comentarios y el colapsado para todos los usan); uno repetido en la
//     página, o con caracteres raros, recibe uno nuevo, anotado.
//
// Nada de tipos de bloque nuevos: lo que sale de acá son bloques del esquema de la app (regla 6 del doc).

type Loose = Record<string, unknown>;

/** Lo que la limpieza necesita saber del archivo y del proyecto nuevo. */
export interface BlockContext {
  /** El archivo nuevo de un id viejo, o `null` si no vino en el zip. */
  media(oldId: string): { url: string; name: string } | null;
  /** La página nueva de un id viejo, o `null` si no está en el archivo. */
  page(oldId: string): string | null;
  /** Un aviso para la lista del final (se juntan los iguales). */
  note(key: NoteKey, detail?: string): void;
}

export type NoteKey =
  | 'unknownBlock'
  | 'unknownInline'
  | 'unknownProp'
  | 'badProp'
  | 'missingFile'
  | 'badUrl'
  | 'badLink'
  | 'outsideLink'
  | 'externalImage'
  | 'duplicateId'
  | 'tooDeep'
  | 'tooMany';

/** Topes de una página (una de verdad tiene unos cientos de bloques). */
export const MAX_BLOCKS = 50_000;
export const MAX_DEPTH = 40;
/** El texto de una foto o un archivo que no vino en el zip. */
export const NOT_IN_ARCHIVE = '(not in the archive)';

const BLOCK_ID = /^[A-Za-z0-9_-]{1,128}$/;
const TABLE_CELL_PROPS: Record<string, 'string' | 'number'> = {
  backgroundColor: 'string',
  textColor: 'string',
  textAlignment: 'string',
  colspan: 'number',
  rowspan: 'number',
};
const ALIGN = ['left', 'center', 'right', 'justify'];

type PropSpec = { default?: unknown; type?: string; values?: readonly unknown[] };
const blockSchema = schema.blockSchema as unknown as Record<string, { propSchema: Record<string, PropSpec>; content: 'inline' | 'table' | 'none' | 'plain' }>;
const styleSchema = schema.styleSchema as unknown as Record<string, { propSchema: 'boolean' | 'string' }>;
const photoProps = (schema.inlineContentSchema as unknown as Record<string, { propSchema?: Record<string, PropSpec> }>).photo.propSchema!;

const isObj = (v: unknown): v is Loose => !!v && typeof v === 'object' && !Array.isArray(v);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** El tipo que espera una propiedad (`'string'`, `'number'`, `'boolean'`). */
const propType = (spec: PropSpec): string => spec.type ?? typeof spec.default;

/** Los colores del editor (los de BlockNote): un color es uno de estos nombres, nunca otro texto (O5 de la auditoría). */
export const COLORS = ['default', 'gray', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'];
const COLOR_PROPS = new Set(['textColor', 'backgroundColor']);

const hostOf = (url: string): string => {
  try {
    return new URL(url).host.slice(0, 60);
  } catch {
    return url.slice(0, 60);
  }
};

/** Una propiedad acorde a su especificación; `undefined` si no. */
function propValue(spec: PropSpec, value: unknown, name = ''): unknown {
  if (COLOR_PROPS.has(name) && !COLORS.includes(value as string)) return undefined;
  if (typeof value !== propType(spec)) return undefined;
  if (typeof value === 'number' && !Number.isFinite(value)) return undefined;
  if (spec.values && !spec.values.includes(value)) return undefined;
  if (typeof value === 'string' && value.length > 100_000) return undefined;
  return value;
}

/** Una dirección de una foto o un archivo: el archivo nuevo, una de afuera que queda, o `null` (se saca). */
type UrlFix = { kind: 'media'; url: string; name: string } | { kind: 'keep'; url: string } | { kind: 'missing'; name: string } | { kind: 'drop' };

function fixUrl(url: string, name: string, ctx: BlockContext): UrlFix {
  if (url === '') return { kind: 'keep', url };
  if (url.startsWith(MEDIA_SCHEME)) {
    const id = mediaIdOf(url);
    const got = id ? ctx.media(id) : null;
    if (got) return { kind: 'media', url: got.url, name: got.name };
    ctx.note('missingFile', name || url.slice(MEDIA_SCHEME.length, MEDIA_SCHEME.length + 36));
    return { kind: 'missing', name };
  }
  if (/^https?:\/\//i.test(url) && url.length <= 4000) {
    // Queda (la app ya muestra imágenes de otros sitios), pero se avisa: el sitio se entera de cuándo se abre la página.
    ctx.note('externalImage', hostOf(url));
    return { kind: 'keep', url };
  }
  ctx.note('badUrl', url.slice(0, 60));
  return { kind: 'drop' };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** El id de la página de un link interno (`/p/<id>`, también con el origen de la app que exportó), o `null`. */
export function archivePageLink(href: string): string | null {
  const m = /^(?:https?:\/\/[^/?#]+)?\/p\/([0-9a-fA-F-]{36})(?:[?#].*)?$/.exec(href.trim());
  return m && UUID.test(m[1]) ? m[1].toLowerCase() : null;
}

/** Un link: a la página nueva, de afuera que queda, o `null` (queda el texto). */
function fixHref(href: unknown, ctx: BlockContext): string | null {
  if (typeof href !== 'string' || href.length > 4000) {
    ctx.note('badLink');
    return null;
  }
  const pageId = archivePageLink(href);
  if (pageId) {
    const now = ctx.page(pageId);
    if (now) return pagePath(now);
    // Una página de afuera del archivo (de otro proyecto u otro workspace) nunca queda como link, con la dirección
    // que sea (`/p/<id>` o `https://<la app>/p/<id>`): su texto (O3 de la auditoría).
    ctx.note('outsideLink');
    return null;
  }
  if (/^\s*(https?:|mailto:)/i.test(href)) return href.trim();
  ctx.note('badLink', href.slice(0, 60));
  return null;
}

/** Los estilos de un texto, solo los del esquema y con su tipo. */
function cleanStyles(styles: unknown, ctx: BlockContext): Loose {
  const out: Loose = {};
  if (!isObj(styles)) return out;
  for (const [k, v] of Object.entries(styles)) {
    const spec = styleSchema[k];
    if (!spec) {
      ctx.note('unknownProp', `style ${k}`);
      continue;
    }
    if (spec.propSchema === 'boolean' ? v === true : typeof v === 'string' && (COLOR_PROPS.has(k) ? COLORS.includes(v) : v.length <= 64)) out[k] = v;
    else if (!(spec.propSchema === 'boolean' && v === false)) ctx.note('badProp', `style ${k}`);
  }
  return out;
}

const textItem = (text: string, styles: Loose = {}) => ({ type: 'text', text, styles });

/** El texto plano de cualquier contenido (para lo que pasa a párrafo o a texto). */
export function plainText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(plainText).join('');
  if (!isObj(content)) return '';
  if (typeof content.text === 'string') return content.text;
  if (content.type === 'tableContent') {
    return asArray(content.rows)
      .map((r) => asArray(isObj(r) ? r.cells : []).map((c) => plainText(isObj(c) && 'content' in c ? c.content : c)).join(' | '))
      .join('\n');
  }
  if ('content' in content) return plainText(content.content);
  if (isObj(content.props) && typeof content.props.name === 'string') return content.props.name;
  return '';
}

/** Lo que va en un renglón en lugar de una foto o un archivo que no vino. */
const missingText = (name: string) => `${name || 'File'} ${NOT_IN_ARCHIVE}`;

/** El contenido en línea de un bloque o de una celda. */
function cleanInline(content: unknown, ctx: BlockContext): Loose[] {
  if (typeof content === 'string') return content ? [textItem(content)] : [];
  const out: Loose[] = [];
  for (const item of asArray(content)) {
    if (typeof item === 'string') {
      if (item) out.push(textItem(item));
      continue;
    }
    if (!isObj(item)) continue;
    if (item.type === 'text') {
      if (typeof item.text === 'string' && item.text) out.push(textItem(item.text, cleanStyles(item.styles, ctx)));
      continue;
    }
    if (item.type === 'link') {
      const inner = cleanInline(item.content, ctx).filter((c) => c.type === 'text');
      const href = fixHref(item.href, ctx);
      if (href && inner.length) out.push({ type: 'link', href, content: inner });
      else out.push(...inner);
      continue;
    }
    if (item.type === 'photo') {
      const props = isObj(item.props) ? item.props : {};
      const name = typeof props.name === 'string' ? props.name : '';
      const fix = fixUrl(typeof props.url === 'string' ? props.url : '', name, ctx);
      if (fix.kind === 'missing') {
        out.push(textItem(`[${missingText(fix.name)}]`));
        continue;
      }
      if (fix.kind === 'drop') {
        if (name) out.push(textItem(`[${name}]`));
        continue;
      }
      const clean: Loose = {};
      for (const [k, v] of Object.entries(props)) {
        const spec = photoProps[k];
        if (!spec) {
          ctx.note('unknownProp', `photo.${k}`);
          continue;
        }
        const ok = propValue(spec, v);
        if (ok === undefined) ctx.note('badProp', `photo.${k}`);
        else clean[k] = ok;
      }
      clean.url = fix.url;
      if (fix.kind === 'media') clean.name = fix.name;
      out.push({ type: 'photo', props: clean });
      continue;
    }
    // Un contenido en línea que esta versión no conoce: su texto.
    ctx.note('unknownInline', typeof item.type === 'string' ? item.type.slice(0, 40) : '?');
    const text = plainText(item);
    if (text) out.push(textItem(text));
  }
  return out;
}

/** El contenido de una tabla, celda por celda. */
function cleanTable(content: unknown, ctx: BlockContext): Loose | null {
  if (!isObj(content) || content.type !== 'tableContent' || !Array.isArray(content.rows)) return null;
  const out: Loose = { type: 'tableContent', rows: [] as Loose[] };
  if (Array.isArray(content.columnWidths)) {
    out.columnWidths = content.columnWidths.map((w) => (typeof w === 'number' && Number.isFinite(w) && w > 0 && w < 10_000 ? w : undefined));
  }
  for (const key of ['headerRows', 'headerCols'] as const) {
    const v = content[key];
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1000) out[key] = v;
  }
  for (const row of content.rows) {
    const cells: unknown[] = [];
    for (const cell of asArray(isObj(row) ? row.cells : [])) {
      if (Array.isArray(cell) || typeof cell === 'string') {
        cells.push(cleanInline(cell, ctx));
        continue;
      }
      if (!isObj(cell)) {
        cells.push([]);
        continue;
      }
      const props: Loose = {};
      for (const [k, v] of Object.entries(isObj(cell.props) ? cell.props : {})) {
        const t = TABLE_CELL_PROPS[k];
        if (!t) {
          ctx.note('unknownProp', `tableCell.${k}`);
          continue;
        }
        const ok =
          t === 'number'
            ? typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 1000
            : typeof v === 'string' && (k === 'textAlignment' ? ALIGN.includes(v) : COLORS.includes(v));
        if (ok) props[k] = v;
        else ctx.note('badProp', `tableCell.${k}`);
      }
      cells.push({ type: 'tableCell', props, content: cleanInline(cell.content, ctx) });
    }
    (out.rows as Loose[]).push({ cells });
  }
  return out;
}

/**
 * Los bloques de un archivo, listos para escribir con el editor de la app. `raw` es lo que dice el JSON de la página
 * (cualquier cosa): lo que no es una lista no tiene bloques.
 */
export function cleanArchiveBlocks(raw: unknown, ctx: BlockContext): PartialBlock<any, any, any>[] {
  const seen = new Set<string>();
  let count = 0;
  let cut = false;

  const idFor = (id: unknown): string => {
    if (typeof id === 'string' && BLOCK_ID.test(id) && !seen.has(id)) {
      seen.add(id);
      return id;
    }
    if (typeof id === 'string' && id) ctx.note('duplicateId');
    let fresh = crypto.randomUUID();
    while (seen.has(fresh)) fresh = crypto.randomUUID();
    seen.add(fresh);
    return fresh;
  };

  const walk = (list: unknown, depth: number): Loose[] => {
    const out: Loose[] = [];
    for (const item of asArray(list)) {
      if (!isObj(item)) continue;
      if (++count > MAX_BLOCKS) {
        if (!cut) ctx.note('tooMany');
        cut = true;
        break;
      }
      const id = idFor(item.id);
      // Lo más hondo que el tope no se pierde: sube como hermano, con su texto.
      const children = depth >= MAX_DEPTH ? [] : walk(item.children, depth + 1);
      if (depth >= MAX_DEPTH && asArray(item.children).length) {
        ctx.note('tooDeep');
        for (const deep of flatten(item.children)) children.push({ type: 'paragraph', content: [textItem(deep)], children: [] });
      }
      const type = typeof item.type === 'string' ? item.type : '';
      const spec = blockSchema[type];
      if (!spec) {
        ctx.note('unknownBlock', type.slice(0, 40) || '?');
        const text = plainText(item.content) || (isObj(item.props) && typeof item.props.name === 'string' ? item.props.name : '');
        out.push({ id, type: 'paragraph', content: text ? [textItem(text)] : [], children });
        continue;
      }
      const props: Loose = {};
      for (const [k, v] of Object.entries(isObj(item.props) ? item.props : {})) {
        const p = spec.propSchema[k];
        if (!p) {
          ctx.note('unknownProp', `${type}.${k}`);
          continue;
        }
        const ok = propValue(p, v, k);
        if (ok === undefined) {
          if (v !== undefined && v !== null) ctx.note('badProp', `${type}.${k}`);
        } else props[k] = ok;
      }
      // Una foto, un video o un adjunto (bloque `image`).
      if (type === 'image') {
        const name = typeof props.name === 'string' ? props.name : '';
        const fix = fixUrl(typeof props.url === 'string' ? props.url : '', name, ctx);
        if (fix.kind === 'missing' || fix.kind === 'drop') {
          const caption = typeof props.caption === 'string' && props.caption ? ` — ${props.caption}` : '';
          const text = fix.kind === 'missing' ? missingText(fix.name) : name ? `[${name}]` : '';
          out.push({ id, type: 'paragraph', content: text || caption ? [textItem(text + caption)] : [], children });
          continue;
        }
        props.url = fix.url;
        if (fix.kind === 'media') props.name = fix.name;
      }
      const block: Loose = { id, type, props, children };
      if (spec.content === 'inline' || spec.content === 'plain') block.content = cleanInline(item.content, ctx);
      else if (spec.content === 'table') {
        const table = cleanTable(item.content, ctx);
        if (!table) {
          // Una tabla sin forma de tabla: su texto, en un párrafo.
          ctx.note('badProp', `${type}.content`);
          const text = plainText(item.content);
          out.push({ id, type: 'paragraph', content: text ? [textItem(text)] : [], children });
          continue;
        }
        block.content = table;
      }
      out.push(block);
    }
    return out;
  };

  return walk(raw, 0) as PartialBlock<any, any, any>[];
}

/** El texto de cada bloque de un árbol (para lo que pasa el tope de profundidad). */
function flatten(list: unknown): string[] {
  const out: string[] = [];
  const go = (l: unknown) => {
    for (const b of asArray(l)) {
      if (!isObj(b)) continue;
      const t = plainText(b.content);
      if (t) out.push(t);
      go(b.children);
    }
  };
  go(list);
  return out;
}

/** Todo el texto de unos bloques, en párrafos (lo último que se prueba si el editor no acepta los bloques). */
export function textOnlyBlocks(blocks: unknown): PartialBlock<any, any, any>[] {
  return flatten(blocks).map((t) => ({ type: 'paragraph', content: [textItem(t)] }) as PartialBlock<any, any, any>);
}
