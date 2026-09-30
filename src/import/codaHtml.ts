import { SCRIPT_PROP, scriptMarks } from '../ui/editorSchema';

// Convierte el HTML que exporta Coda (API `beginPageContentExport`, formato html) en bloques del editor.
// El texto, los títulos, las listas y las tablas los convierte BlockNote (`tryParseHTMLToBlocks`); lo que
// hace esto es lo que BlockNote no resuelve:
//
// - Fotos y archivos. BlockNote descarta una <img> que está adentro de un párrafo o de un ítem de lista
//   (Coda las pone siempre así: `<div><span><img></span></div>`) y todo <video>. Antes de convertir, cada
//   archivo de Coda se cambia por una marca de texto; después, cada marca pasa a ser un bloque `image` con
//   la dirección que devuelve `urlOf` (la de la cola de archivos, `sdmedia://`).
// - Colores. Coda escribe `rgb(...)`; el editor solo tiene sus colores con nombre (gray, yellow…). Se pasa
//   al más parecido. El gris del texto de cuerpo de Coda se saca: es la convención de Coda, no del texto.
// - Guion. Los párrafos debajo de un título "Guion" pasan a ser texto Script, que marca solo INT/EXT y DÍA/
//   NOCHE; los fondos que Coda les ponía a mano a esas palabras se sacan para que no queden dos veces.

/** Un archivo de Coda en la página (foto, video o adjunto). */
export interface CodaMedia {
  /** El número de la marca que lo reemplaza en el texto. */
  index: number;
  /** `bl-…`: el nombre del archivo en la carpeta exportada (con su extensión). */
  blobId: string;
  src: string;
  mime: string;
  /** El nombre original, si Coda lo sabe (a veces trae `image.png` o el mismo `bl-…`). */
  name: string;
  /** El ancho con que se veía en Coda, en px (0: el ancho natural). */
  width: number;
}

// Caracteres de uso privado: no aparecen en texto real y BlockNote los deja pasar tal cual.
const OPEN = '\uE000';
const CLOSE = '\uE001';
const TOKEN = /\uE000(\d+)\uE001/g;

const HOSTED = /^https:\/\/(?:codahosted\.io|coda\.io\/blobs|docs\.superhuman\.com\/blobs)\//;

/** Cambia cada archivo de Coda por una marca y normaliza los colores. Devuelve el HTML y los archivos. */
export function prepareCodaHtml(html: string): { html: string; media: CodaMedia[] } {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const media: CodaMedia[] = [];

  const mark = (el: Element, src: string, fallbackName: string) => {
    const blobId = el.getAttribute('data-coda-blob-id') ?? src.match(/\/blobs\/(bl-[\w-]+)/)?.[1] ?? '';
    const index = media.length;
    media.push({
      index,
      blobId,
      src,
      mime: el.getAttribute('data-coda-mime-type') ?? '',
      name: el.getAttribute('alt') ?? fallbackName,
      width: Number(el.getAttribute('width')) || 0,
    });
    // Un <source> se va con su <video> (si no, BlockNote tira el video con la marca adentro). El
    // envoltorio `display: inline-block` que Coda pone alrededor de cada archivo se va con él.
    let target: Element = el.tagName === 'SOURCE' && el.parentElement?.tagName === 'VIDEO' ? el.parentElement : el;
    const wrapper = target.parentElement;
    if (wrapper?.tagName === 'SPAN' && wrapper.childNodes.length === 1) target = wrapper;
    target.replaceWith(doc.createTextNode(`${OPEN}${index}${CLOSE}`));
  };

  for (const el of [...doc.body.querySelectorAll('img, video, source')]) {
    if (!el.isConnected) continue;
    const src = el.getAttribute('src') ?? '';
    if (HOSTED.test(src) || src.startsWith('../media/')) mark(el, src, '');
  }
  // Una foto adentro de un link: la marca sale del link y va justo después (adentro, el link se la
  // llevaría). Si el link queda sin texto, se va.
  for (const a of [...doc.body.querySelectorAll('a')]) {
    const tokens = [...a.textContent!.matchAll(TOKEN)].map((m) => m[0]);
    if (!tokens.length) continue;
    const walker = doc.createTreeWalker(a, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) n.textContent = n.textContent!.replace(TOKEN, '');
    a.after(doc.createTextNode(tokens.join('')));
    if (!a.textContent!.trim()) a.remove();
  }
  // Un adjunto (PDF, zip…) llega como link a codahosted.
  for (const a of [...doc.body.querySelectorAll('a[href]')]) {
    const href = a.getAttribute('href') ?? '';
    if (HOSTED.test(href)) mark(a, href, a.textContent?.trim() ?? '');
  }
  // Un video embebido (YouTube, Vimeo…) queda como link.
  for (const frame of [...doc.body.querySelectorAll('iframe[src]')]) {
    const src = frame.getAttribute('src') ?? '';
    const p = doc.createElement('p');
    const a = doc.createElement('a');
    a.href = src;
    a.textContent = src;
    p.append(a);
    frame.replaceWith(p);
  }

  for (const el of [...doc.body.querySelectorAll<HTMLElement>('[style]')]) {
    const text = el.style.color ? namedColor(el.style.color, 'text') : null;
    const background = el.style.backgroundColor ? namedColor(el.style.backgroundColor, 'background') : null;
    const bold = /^(bold|[6-9]00)$/.test(el.style.fontWeight);
    const italic = el.style.fontStyle === 'italic';
    const underline = el.style.textDecoration.includes('underline');
    const strike = el.style.textDecoration.includes('line-through');
    el.removeAttribute('style');
    if (el.tagName !== 'SPAN') continue;
    // BlockNote lee el color del `style` de un <span>; con el nombre del color queda uno de los suyos.
    if (text) el.style.color = text;
    if (background) el.style.backgroundColor = background;
    if (bold) el.style.fontWeight = 'bold';
    if (italic) el.style.fontStyle = 'italic';
    if (underline || strike) el.style.textDecoration = [underline && 'underline', strike && 'line-through'].filter(Boolean).join(' ');
  }
  return { html: doc.body.innerHTML, media };
}

// Los colores del editor (los de BlockNote), por su tono. El gris y el marrón se eligen por la saturación.
const HUES: [string, number][] = [
  ['red', 0],
  ['orange', 30],
  ['yellow', 48],
  ['green', 140],
  ['blue', 205],
  ['purple', 265],
  ['pink', 320],
];

/** El color con nombre más parecido, o `null` si es negro, blanco o el gris del texto de cuerpo. */
export function namedColor(css: string, kind: 'text' | 'background'): string | null {
  const m = css.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => Number(v) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  const sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * light - 1));
  if (kind === 'background' && light > 0.97) return null;
  if (sat < 0.15) {
    // Texto gris o negro: el de cuerpo de Coda. Fondo gris: se respeta.
    return kind === 'background' ? 'gray' : null;
  }
  let hue = 0;
  if (max === r) hue = ((g - b) / (max - min) + 6) % 6;
  else if (max === g) hue = (b - r) / (max - min) + 2;
  else hue = (r - g) / (max - min) + 4;
  hue *= 60;
  if (hue < 45 && sat < 0.4 && light < 0.5) return 'brown';
  let best = HUES[0];
  for (const h of HUES) {
    const d = Math.min(Math.abs(h[1] - hue), 360 - Math.abs(h[1] - hue));
    const bd = Math.min(Math.abs(best[1] - hue), 360 - Math.abs(best[1] - hue));
    if (d < bd) best = h;
  }
  return best[0];
}

// --- después de convertir --------------------------------------------------------------------------

type Inline = { type: string; text?: string; styles?: Record<string, unknown>; content?: Inline[]; href?: string };
export interface LooseBlock {
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: LooseBlock[];
}

const LIST_ITEMS = new Set(['bulletListItem', 'numberedListItem', 'checkListItem', 'toggleListItem']);
const SCRIPT_HEADING = /^gui[oó]n\b|^script\b/i;

/**
 * Cambia cada marca por su bloque `image` (`imageOf`), junta los párrafos vacíos seguidos, saca los del
 * final y marca como Script lo que está debajo de un título "Guion". Los bloques salen sin id.
 */
export function finishBlocks(blocks: LooseBlock[], imageOf: (index: number) => LooseBlock | null): LooseBlock[] {
  const out = splitAll(blocks, imageOf);
  markScript(out);
  // Una marca que quedó donde no se la buscó (no debería pasar) no se ve como basura en el texto; la foto
  // la ubica al final quien importa (codaImport.ts).
  return stripTableTokens(collapseEmpty(out), []) as LooseBlock[];
}

function splitAll(blocks: LooseBlock[], imageOf: (index: number) => LooseBlock | null): LooseBlock[] {
  const out: LooseBlock[] = [];
  for (const block of blocks) {
    const children = splitAll(block.children ?? [], imageOf);
    const base: LooseBlock = { type: block.type, props: block.props, content: block.content, children };
    if (block.type === 'table') {
      // Una foto no puede ir en una celda: la marca se saca y la foto va debajo de la tabla.
      const found: number[] = [];
      base.content = stripTableTokens(block.content, found);
      out.push(base);
      for (const i of found) {
        const img = imageOf(i);
        if (img) out.push(img);
      }
      continue;
    }
    if (!Array.isArray(block.content)) {
      out.push(base);
      continue;
    }
    const parts = splitInline(block.content as Inline[]);
    if (parts.length === 1 && typeof parts[0] !== 'number') {
      out.push(base);
      continue;
    }
    // El primer tramo de texto se queda con el bloque (y sus hijos). En un ítem de lista, lo que sigue
    // (fotos y texto) va adentro del ítem, como se veía en Coda; en el resto, va a continuación.
    const pieces: LooseBlock[] = [];
    let first: LooseBlock | null = null;
    for (const part of parts) {
      if (typeof part === 'number') {
        const img = imageOf(part);
        if (img) pieces.push(img);
      } else if (!first) {
        first = { ...base, content: part };
      } else if (!isBlank(part)) {
        pieces.push({ type: LIST_ITEMS.has(block.type) ? 'paragraph' : block.type, props: block.props, content: part, children: [] });
      }
    }
    first ??= { ...base, content: [] };
    if (LIST_ITEMS.has(block.type)) {
      first.children = [...pieces, ...children];
      out.push(first);
    } else {
      // Un párrafo, título o cita que solo tenía fotos no deja una línea vacía.
      if (!isBlank(first.content as Inline[])) out.push({ ...first, children: [] });
      out.push(...pieces);
      if (children.length) out.push(...children);
    }
  }
  return out;
}

/** Parte el contenido en tramos de texto y números de marca, sin saltos de línea sueltos en los bordes. */
function splitInline(content: Inline[]): (Inline[] | number)[] {
  const parts: (Inline[] | number)[] = [];
  let current: Inline[] = [];
  const push = () => {
    parts.push(trimBreaks(current));
    current = [];
  };
  for (const item of content) {
    if (item.type !== 'text' || !item.text || !item.text.includes(OPEN)) {
      current.push(item);
      continue;
    }
    let last = 0;
    for (const m of item.text.matchAll(TOKEN)) {
      const before = item.text.slice(last, m.index);
      if (before) current.push({ ...item, text: before });
      push();
      parts.push(Number(m[1]));
      last = m.index + m[0].length;
    }
    const rest = item.text.slice(last);
    if (rest) current.push({ ...item, text: rest });
  }
  push();
  // Sin tramos vacíos entre fotos; el primero se deja (es el que se queda con el bloque).
  return parts.filter((p, i) => i === 0 || typeof p === 'number' || !isBlank(p));
}

function trimBreaks(items: Inline[]): Inline[] {
  const out = items.map((i) => ({ ...i }));
  const edge = (i: Inline | undefined, side: 'start' | 'end') => {
    if (!i || i.type !== 'text' || i.text === undefined) return false;
    i.text = side === 'start' ? i.text.replace(/^\s*\n\s*/, '') : i.text.replace(/\s*\n\s*$/, '');
    return i.text === '';
  };
  while (out.length && edge(out[0], 'start')) out.shift();
  while (out.length && edge(out.at(-1), 'end')) out.pop();
  return out;
}

/** Sin nada: solo texto en blanco (un link, aunque sea sin texto, no es nada). */
function isBlank(items: Inline[]): boolean {
  return items.every((i) => i.type === 'text' && !(i.text ?? '').trim());
}

/** Saca las marcas de todo el texto de adentro y anota qué fotos eran. */
function stripTableTokens(content: unknown, found: number[]): unknown {
  if (typeof content === 'string') {
    for (const m of content.matchAll(TOKEN)) found.push(Number(m[1]));
    return content.replace(TOKEN, '');
  }
  if (Array.isArray(content)) return content.map((c) => stripTableTokens(c, found));
  if (content && typeof content === 'object') {
    return Object.fromEntries(Object.entries(content).map(([k, v]) => [k, stripTableTokens(v, found)]));
  }
  return content;
}

// El texto de un bloque, también el de adentro de los links (un link no tiene `text`, tiene `content`).
const inlineText = (items: Inline[]): string => items.map((i) => i.text ?? inlineText(i.content ?? [])).join('');
const textOf = (b: LooseBlock) => (Array.isArray(b.content) ? inlineText(b.content as Inline[]) : '');

function markScript(blocks: LooseBlock[]): void {
  let inScript = false;
  for (const b of blocks) {
    if (b.type === 'heading' && textOf(b).trim()) {
      inScript = SCRIPT_HEADING.test(textOf(b).trim());
      continue;
    }
    if (!inScript || b.type !== 'paragraph' || !textOf(b).trim()) continue;
    b.props = { ...b.props, [SCRIPT_PROP]: true };
    // Los fondos que Coda ponía a mano en INT/EXT y DÍA/NOCHE: Script ya los marca.
    b.content = (b.content as Inline[]).map((i) => {
      if (i.type !== 'text' || !i.styles?.backgroundColor || !i.text) return i;
      const marks = scriptMarks(i.text.trim());
      const whole = marks.length === 1 && marks[0][0] === 0 && marks[0][1] === i.text.trim().length;
      if (!whole) return i;
      const { backgroundColor: _bg, ...styles } = i.styles;
      return { ...i, styles };
    });
    b.content = mergeRuns(b.content as Inline[]);
  }
}

/** Junta los tramos de texto seguidos con los mismos estilos. */
function mergeRuns(items: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const i of items) {
    const prev = out.at(-1);
    if (prev?.type === 'text' && i.type === 'text' && JSON.stringify(prev.styles ?? {}) === JSON.stringify(i.styles ?? {})) {
      out[out.length - 1] = { ...prev, text: (prev.text ?? '') + (i.text ?? '') };
    } else {
      out.push(i);
    }
  }
  return out;
}

function collapseEmpty(blocks: LooseBlock[]): LooseBlock[] {
  const isEmpty = (b: LooseBlock) =>
    b.type === 'paragraph' && !b.children?.length && Array.isArray(b.content) && isBlank(b.content as Inline[]);
  const out = blocks.filter((b, i) => !(isEmpty(b) && i > 0 && isEmpty(blocks[i - 1])));
  while (out.length > 1 && isEmpty(out.at(-1)!)) out.pop();
  while (out.length > 1 && isEmpty(out[0])) out.shift();
  return out;
}
