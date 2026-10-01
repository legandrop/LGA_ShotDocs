import { parseDriveLink } from '../ui/driveLinks';
import { DRIVE_CARD_PROP, SCRIPT_PROP, scriptMarks } from '../ui/editorSchema';

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
// - Links entre páginas. El comando escribe `coda-page:<id del manifest>` en un link a otra página del doc;
//   acá pasa a la dirección de la página creada (`/p/<id>`). El editor descarta un link con un esquema que
//   no conoce, por eso se cambia antes.
// - Direcciones sueltas. Lo que en Coda era un embebido (un video de Drive con su reproductor) sale como
//   la dirección en texto, sin link y pegada a lo de al lado. Cada una pasa a ser un link en su renglón, y
//   una de Drive sola en un párrafo, una tarjeta de Drive (ver `linkBareUrls`).

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
  /**
   * Una foto que no está guardada en Coda (una dirección de otro sitio): no hay archivo que subir. Si es
   * `https` queda enlazada a su sitio (anotada); si no, no se trae (anotada).
   */
  external?: boolean;
}

// Caracteres de uso privado: BlockNote los deja pasar tal cual. Antes de marcar se sacan del texto de
// Coda (ver `stripMarkers`), así una marca nunca se confunde con algo que ya estaba escrito.
const OPEN = '\uE000';
const CLOSE = '\uE001';
const TOKEN = /\uE000(\d+)\uE001/g;
const MARKERS = /[\uE000\uE001]/g;

const HOSTED = /^https:\/\/(?:codahosted\.io|coda\.io\/blobs|docs\.superhuman\.com\/blobs)\//;

/**
 * Cambia cada archivo de Coda por una marca y normaliza los colores. Devuelve el HTML, los archivos y los
 * videos o embebidos de otros sitios que quedaron como link.
 */
export function prepareCodaHtml(
  html: string,
  pageLink?: (codaId: string) => string | null,
): { html: string; media: CodaMedia[]; embeds: string[]; brokenLinks: BrokenLink[] } {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const media: CodaMedia[] = [];
  stripMarkers(doc.body);
  const brokenLinks = resolvePageLinks(doc.body, pageLink);

  const mark = (el: Element, src: string, fallbackName: string, external = false) => {
    const blobId = external ? '' : (el.getAttribute('data-coda-blob-id') ?? blobOf(src));
    const index = media.length;
    media.push({
      index,
      blobId,
      src,
      mime: el.getAttribute('data-coda-mime-type') ?? '',
      name: el.getAttribute('alt') ?? fallbackName,
      width: Number(el.getAttribute('width')) || 0,
      ...(external ? { external } : {}),
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
    // Una foto de otro sitio: BlockNote la tiraría sin avisar si está en un párrafo. Con la marca, quien
    // importa decide (enlazada si es https, si no afuera) y la anota.
    else if (el.tagName === 'IMG' && src) mark(el, src, '', true);
  }
  // Una foto adentro de un link: la marca sale del link y va justo después (adentro, el link se la
  // llevaría). Si el link queda sin texto, se va. Un link a la misma foto de Coda (Coda envuelve así la
  // foto para abrirla grande) queda como texto: si no, la foto entraría dos veces.
  for (const a of [...doc.body.querySelectorAll('a')]) {
    const found = [...a.textContent!.matchAll(TOKEN)];
    if (!found.length) continue;
    const walker = doc.createTreeWalker(a, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) n.textContent = n.textContent!.replace(TOKEN, '');
    a.after(doc.createTextNode(found.map((m) => m[0]).join('')));
    const href = a.getAttribute('href') ?? '';
    const sameFile = HOSTED.test(href) && found.some((m) => sameMedia(media[Number(m[1])], href));
    if (!a.textContent!.trim()) a.remove();
    else if (sameFile) a.replaceWith(...a.childNodes);
  }
  // Un adjunto (PDF, zip…) llega como link a codahosted.
  for (const a of [...doc.body.querySelectorAll('a[href]')]) {
    const href = a.getAttribute('href') ?? '';
    if (HOSTED.test(href)) mark(a, href, a.textContent?.trim() ?? '');
  }
  // Un video embebido (YouTube, Vimeo…), un <video> de otro sitio o un <embed> quedan como link (BlockNote
  // los tiraría) y se anotan en `embeds`: no hay archivo que traer.
  const embeds: string[] = [];
  for (const el of [...doc.body.querySelectorAll('iframe, embed, video')]) {
    if (!el.isConnected) continue;
    const src = el.getAttribute('src') || el.querySelector('source[src]')?.getAttribute('src') || '';
    if (!src) continue;
    embeds.push(src);
    const p = doc.createElement('p');
    const a = doc.createElement('a');
    a.setAttribute('href', src);
    a.textContent = src;
    p.append(a);
    el.replaceWith(p);
  }
  // Después de las marcas: así una foto al lado de una dirección ya es texto y nunca se la toma por nada.
  linkBareUrls(doc.body);

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
  return { html: doc.body.innerHTML, media, embeds, brokenLinks };
}

/** Un link a otra página del doc que quedó como texto: el id de Coda y el texto del link. */
export interface BrokenLink {
  id: string;
  text: string;
}

/** El esquema con que el comando marca un link a otra página del mismo doc de Coda. */
export const CODA_PAGE_SCHEME = 'coda-page:';

/**
 * Cada link `coda-page:<id>` pasa a la dirección que da `pageLink`. Uno sin dirección (la página no está en
 * la exportación o no se pudo crear) queda como su texto, sin link. Devuelve los que quedaron sin dirección,
 * uno por id.
 */
function resolvePageLinks(body: HTMLElement, pageLink?: (codaId: string) => string | null): BrokenLink[] {
  const broken = new Map<string, BrokenLink>();
  for (const a of [...body.querySelectorAll('a[href]')]) {
    const href = a.getAttribute('href')!.trim();
    if (!href.toLowerCase().startsWith(CODA_PAGE_SCHEME)) continue;
    const id = safeDecode(href.slice(CODA_PAGE_SCHEME.length)).trim();
    const target = id && pageLink ? pageLink(id) : null;
    if (target) {
      a.setAttribute('href', target);
    } else {
      if (!broken.has(id)) broken.set(id, { id, text: (a.textContent ?? '').replace(MARKERS, '').trim() });
      a.replaceWith(...a.childNodes);
    }
  }
  return [...broken.values()];
}

// --- Direcciones sueltas -----------------------------------------------------------------------------
//
// Un link de verdad Coda lo exporta como <a>. Lo que era un embebido sale como la dirección en texto, cada
// una en su <span>, sin espacio con lo que tiene al lado:
//   <li><span>Referencia:</span><span>https://…/view</span><span>https://…/view</span></li>
// Sin esto entraba todo como un solo texto, sin links y con las direcciones pegadas.

/** El texto entero es una dirección (lo que hay en un mismo texto con más palabras no se toca). */
const BARE_URL = /^https?:\/\/\S+$/i;
// Lo que va en la línea de un texto. Cualquier otra etiqueta corta la línea (un bloque, una celda, un <br>).
const INLINE = new Set(['SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'A', 'CODE', 'FONT', 'MARK', 'SMALL', 'SUB', 'SUP']);
// La clase con que el editor reconoce una tarjeta de Drive al convertir HTML (el `parse` del párrafo en
// `ui/editorSchema.ts`): el mismo camino que pegar una tarjeta copiada.
const DRIVE_CARD_CLASS = 'drive-card-line';

/** La dirección, si `text` es una sola dirección suelta que no es un archivo de Coda. */
function bareUrl(text: string): string | null {
  const url = text.trim();
  if (!BARE_URL.test(url) || HOSTED.test(url)) return null;
  // Dos direcciones pegadas en un mismo texto, o una que lleva otra adentro (un redireccionador): no se
  // sabe dónde cortar, y un link a las dos juntas no iría a ningún lado. Queda como texto.
  if (/https?:\/\//i.test(url.slice(4))) return null;
  try {
    return new URL(url).hostname ? url : null;
  } catch {
    return null;
  }
}

/**
 * Cada dirección suelta pasa a ser un link, en su propio renglón si estaba pegada a un texto o a otra
 * dirección. Una de Drive que queda sola en su renglón de un párrafo va a su propio párrafo, como tarjeta.
 * No toca lo que ya es un link ni lo que está escrito como código.
 */
function linkBareUrls(body: HTMLElement): void {
  const doc = body.ownerDocument;
  const found: { node: Node; url: string }[] = [];
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const url = bareUrl(n.textContent ?? '');
    if (url && !n.parentElement?.closest('a, code, pre')) found.push({ node: n, url });
  }
  // En el orden de la página: el salto que se pone después de una dirección es el "antes" de la siguiente.
  for (const { node, url } of found) {
    const text = node.textContent!;
    const at = text.indexOf(url);
    const a = doc.createElement('a');
    a.setAttribute('href', url);
    a.textContent = url;
    (node as ChildNode).replaceWith(...[text.slice(0, at), a, text.slice(at + url.length)].filter((part) => part !== ''));
    // La dirección con los envoltorios que son solo suyos (el <span> de Coda): lo que se mueve entero.
    let unit: Element = a;
    for (let p = unit.parentElement; p && p !== body && INLINE.has(p.tagName) && p.textContent!.trim() === url; p = unit.parentElement) unit = p;
    if (isStuck(unit, 'previousSibling')) unit.before(doc.createElement('br'));
    if (isStuck(unit, 'nextSibling')) unit.after(doc.createElement('br'));
    if (parseDriveLink(url)) driveCardParagraph(unit, body);
  }
}

/** Lo que hay de ese lado en la misma línea es texto (u otra dirección) sin un espacio de por medio. */
function isStuck(unit: Node, side: 'previousSibling' | 'nextSibling'): boolean {
  for (let node: Node = unit; ; ) {
    let next = node[side];
    while (next && next.nodeName !== 'BR' && !next.textContent) next = next[side];
    if (next) {
      if (next.nodeType !== 3 && !INLINE.has(next.nodeName)) return false;
      // Un envoltorio que empieza (o termina) con un salto de línea ya separa.
      let leaf: Node = next;
      while (side === 'previousSibling' ? leaf.lastChild : leaf.firstChild) leaf = (side === 'previousSibling' ? leaf.lastChild : leaf.firstChild)!;
      if (leaf.nodeName === 'BR') return false;
      const edge = side === 'previousSibling' ? next.textContent!.slice(-1) : next.textContent![0];
      return !/\s/.test(edge);
    }
    // Nada de ese lado adentro del envoltorio: se mira afuera, mientras siga siendo la misma línea.
    const parent = node.parentElement;
    if (!parent || !INLINE.has(parent.tagName)) return false;
    node = parent;
  }
}

/**
 * Una dirección de Drive sola en su renglón de un párrafo de primer nivel sale a su propio párrafo, que el
 * editor convierte en tarjeta de Drive: lo que en Coda se veía con reproductor se sigue viendo así. El
 * texto de antes y el de después quedan en sus párrafos; nada se borra salvo los saltos de línea que la
 * separaban. Adentro de un ítem de lista, de una tabla o de un título no hay tarjeta: queda el link.
 */
function driveCardParagraph(unit: Element, body: HTMLElement): void {
  const host = unit.parentElement!;
  if (host.parentElement !== body || (host.tagName !== 'DIV' && host.tagName !== 'P')) return;
  // Un <div> que envuelve una tabla o una lista no es un párrafo.
  if ([...host.children].some((c) => c.tagName !== 'BR' && !INLINE.has(c.tagName))) return;
  const blank = (n: Node | null): boolean => !!n && n.nodeType === 3 && !n.textContent!.trim();
  const beside = (side: 'previousSibling' | 'nextSibling') => {
    let n = unit[side];
    while (blank(n)) n = n![side];
    return n;
  };
  const before = beside('previousSibling');
  const after = beside('nextSibling');
  if ((before && before.nodeName !== 'BR') || (after && after.nodeName !== 'BR')) return;
  const empty = (el: Element) => [...el.childNodes].every((n) => n.nodeName === 'BR' || blank(n));

  before?.remove();
  after?.remove();
  const rest = host.cloneNode(false) as Element;
  while (unit.nextSibling) rest.append(unit.nextSibling);
  const card = body.ownerDocument.createElement('p');
  card.className = DRIVE_CARD_CLASS;
  card.append(unit);
  host.after(card);
  if (!empty(rest)) card.after(rest);
  if (empty(host)) host.remove();
}

/** Un `%` suelto no corta la importación: queda el texto tal cual. */
function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

const blobOf = (url: string): string => url.match(/\/blobs\/(bl-[\w-]+)/)?.[1] ?? '';

/** El link apunta al mismo archivo de Coda que la foto (por su blob, o por la misma dirección). */
function sameMedia(m: CodaMedia | undefined, href: string): boolean {
  if (!m) return false;
  const blob = blobOf(href);
  return blob ? blob === m.blobId : href === m.src;
}

/** Saca los caracteres que se usan de marca del texto y de los atributos que trae Coda. */
function stripMarkers(root: Element): void {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent!;
    if (text.includes(OPEN) || text.includes(CLOSE)) n.textContent = text.replace(MARKERS, '');
  }
  for (const el of root.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      if (attr.value.includes(OPEN) || attr.value.includes(CLOSE)) el.setAttribute(attr.name, attr.value.replace(MARKERS, ''));
    }
  }
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
  // `rgb(...)` (lo que escribe Coda) o `#rrggbb` / `#rgb`.
  const m = css.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  const hex = m ? null : css.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (!m && !hex) return null;
  const full = hex && hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  const channels = m ? [m[1], m[2], m[3]].map(Number) : [0, 2, 4].map((i) => parseInt(full!.slice(i, i + 2), 16));
  const [r, g, b] = channels.map((v) => v / 255);
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
  // En Coda toda la gama de 70° a 165° se ve verde (un verde muy claro, como #f1f8e9, está a ~88°: por cercanía
  // quedaba amarillo).
  if (hue >= 70 && hue <= 165) return 'green';
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
    // Una tarjeta de Drive no va junto con Script: debajo de un "Guion" sigue siendo tarjeta.
    if (b.props?.[DRIVE_CARD_PROP] === true) continue;
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

/**
 * Las fotos que no quedaron guardadas en la app (su dirección no es `sdmedia://`): una de otro sitio que
 * BlockNote convirtió por su cuenta, por ejemplo. Una `https` queda enlazada a su sitio; cualquier otra
 * (`http`, `data:`, una ruta suelta) se saca. Cada una se avisa con `note`.
 */
export function checkForeignImages(blocks: LooseBlock[], note: (url: string, kept: boolean) => void): LooseBlock[] {
  const out: LooseBlock[] = [];
  for (const block of blocks) {
    const children = block.children?.length ? checkForeignImages(block.children, note) : block.children;
    if (block.type === 'image') {
      const url = String(block.props?.url ?? '');
      if (!url.startsWith('sdmedia://')) {
        const kept = /^https:\/\//i.test(url);
        note(url, kept);
        if (!kept) {
          // Lo que tenía adentro (no debería tener nada) no se pierde con ella.
          if (children?.length) out.push(...children);
          continue;
        }
      }
    }
    out.push(children === block.children ? block : { ...block, children });
  }
  return out;
}
