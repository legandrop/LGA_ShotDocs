import { parseDriveLink } from '../ui/driveLinks';
import { DRIVE_CARD_PROP, SCRIPT_PROP, scriptMarks } from '../ui/editorSchema';

// Convierte el HTML que exporta Coda (API `beginPageContentExport`, formato html) en bloques del editor.
// El texto, los títulos, las listas y las tablas los convierte BlockNote (`tryParseHTMLToBlocks`); lo que
// hace esto es lo que BlockNote no resuelve:
//
// - Fotos y archivos. BlockNote descarta una <img> que está adentro de un párrafo o de un ítem de lista
//   (Coda las pone siempre así: `<div><span><img></span></div>`) y todo <video>. Antes de convertir, cada
//   archivo de Coda se cambia por una marca de texto; después, cada marca pasa a ser una foto en línea en su
//   renglón (desde la entrega 4 de Doc_Fotos_En_Linea.md), o un bloque `image` si es un adjunto, con la
//   dirección de la cola de archivos (`sdmedia://`).
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
/** El car\u00E1cter de "objeto" (U+FFFC) que Coda deja al lado de una foto. */
const OBJECT = '\uFFFC';

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

/**
 * La dirección, si `text` es una sola dirección suelta que no es un archivo de Coda. Sin la puntuación del final
 * (un punto, una coma, un paréntesis que cierra uno que no abrió adentro): esa queda como texto, después del link.
 */
function bareUrl(text: string): string | null {
  const whole = text.trim();
  if (!BARE_URL.test(whole) || HOSTED.test(whole)) return null;
  // Dos direcciones pegadas en un mismo texto, o una que lleva otra adentro (un redireccionador): no se
  // sabe dónde cortar, y un link a las dos juntas no iría a ningún lado. Queda como texto.
  if (/https?:\/\//i.test(whole.slice(4))) return null;
  const url = withoutTrailingPunctuation(whole);
  try {
    return new URL(url).hostname ? url : null;
  } catch {
    return null;
  }
}

// La puntuación que cierra una frase. Un `)` o un `]` solo si no cierra uno que se abrió en la dirección
// (`https://es.wikipedia.org/wiki/Foo_(bar)` lo lleva).
const TRAILING = /[.,;:!?'"\u201D\u2019\u00BB\u2026]$/;
function withoutTrailingPunctuation(url: string): string {
  const count = (s: string, c: string) => s.split(c).length - 1;
  let out = url;
  for (;;) {
    const last = out.at(-1)!;
    const open = last === ')' ? '(' : last === ']' ? '[' : '';
    if (TRAILING.test(out) || (open && count(out, open) < count(out, last))) out = out.slice(0, -1);
    else return out;
  }
}

// Lo que puede llevar una dirección (sin espacios ni letras con tilde), lo que deja una dirección sin terminar
// y lo que solo aparece en el medio de una.
const URL_CHARS = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/;
const OPEN_END = /[/?=&#%\-_~+:@]$/;
const URL_STRUCTURE = /[/?=&#%]/;

/**
 * Una dirección partida en dos o más textos por un cambio de formato (parte en negrita, parte de otro color):
 * `<span>https://drive.google.com/file/d/</span><b>1AbC/view</b>`. El primero solo ya parece una dirección y
 * quedaba como un link cortado, con el resto en otro renglón. Si lo que sigue pegado (sin espacio, en la misma
 * línea) la continúa, pasa al primer texto: la dirección queda entera, con el formato de su primera parte. Lo
 * pegado que no la continúa (una palabra, otra dirección, un link, código) no se toca. No se pierde texto: se
 * mueve.
 */
function joinSplitUrl(node: Text): void {
  const token = node.textContent!.trimStart();
  if (!/^https?:\/\/\S+$/i.test(token)) return;
  const pieces: { node: Text; length: number }[] = [];
  let tail = '';
  for (let next = nextTextInLine(node); next; next = nextTextInLine(next)) {
    if (next.parentElement?.closest('a, code, pre')) break;
    const piece = next.textContent!.match(/^\S*/)![0];
    if (!piece || /^(?:https?:\/\/|www\.)/i.test(piece) || !URL_CHARS.test(piece)) break;
    pieces.push({ node: next, length: piece.length });
    tail += piece;
    // Con un espacio adentro, la palabra termina ahí.
    if (piece.length < next.textContent!.length) break;
  }
  if (!tail) return;
  // Que la continúa: lo que sigue tiene forma de dirección (`1AbC/view?usp=sharing`); o la primera parte quedó
  // abierta (`/d/`, `?id=`, `plano-`) y lo que sigue no es una palabra común ("Luego", "Sigue.": un embebido de
  // Instagram termina en `/` y en Coda el texto de al lado puede ir pegado); o, después de un punto, un dominio en
  // minúsculas (`google.com`; "Google.com" empieza otra frase). `www.` es otra dirección.
  const word = /^\p{Lu}?\p{Ll}+[.,;:!?'")\]]*$/u.test(tail);
  const continues = (OPEN_END.test(token) && !word) || URL_STRUCTURE.test(tail) || (token.endsWith('.') && /^[a-z0-9-]+\.[a-z]{2,}/.test(tail));
  if (!continues || !bareUrl(token + tail)) return;
  node.textContent += tail;
  for (const p of pieces) {
    p.node.textContent = p.node.textContent!.slice(p.length);
    if (p.node.textContent) continue;
    // El envoltorio que quedó vacío se va (si no, una tarjeta no vería sola a la dirección).
    let gone: Node = p.node;
    while (gone.parentElement && INLINE.has(gone.parentElement.tagName) && gone.parentElement.childNodes.length === 1) gone = gone.parentElement;
    gone.parentNode?.removeChild(gone);
  }
}

/** El texto siguiente en la misma línea (sin pasar un <br>, un bloque ni una celda), o `null`. */
function nextTextInLine(from: Node): Text | null {
  let node: Node = from;
  for (;;) {
    while (!node.nextSibling) {
      const parent = node.parentElement;
      if (!parent || !INLINE.has(parent.tagName)) return null;
      node = parent;
    }
    node = node.nextSibling;
    // Hacia adentro, hasta el primer texto con algo (un envoltorio vacío se saltea).
    for (;;) {
      if (node.nodeType === 3) {
        if (node.textContent) return node as Text;
        break;
      }
      if (node.nodeType !== 1) break;
      if (!INLINE.has(node.nodeName)) return null;
      if (!node.firstChild) break;
      node = node.firstChild;
    }
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
    if (n.parentElement?.closest('a, code, pre')) continue;
    joinSplitUrl(n as Text);
    const url = bareUrl(n.textContent ?? '');
    if (url) found.push({ node: n, url });
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

const CLOSING = /^[.,;:!?)\]}'"\u201D\u2019\u00BB\u2026]+(?:\s|$)/;
const OPENING = /[([{\u00BF\u00A1\u00AB\u201C\u2018"']$/;

/**
 * Lo que hay de ese lado en la misma línea es texto (u otra dirección) sin un espacio de por medio. La
 * puntuación que cierra (`.`, `,`, `)`…) después y la que abre (`(`, `«`…) antes no la pegan: va con ella en su
 * renglón. El espacio de ancho cero que Coda deja al lado de una foto cuenta como espacio.
 */
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
      const text = next.textContent!;
      if (side === 'nextSibling' ? CLOSING.test(text) : OPENING.test(text)) return false;
      const edge = side === 'previousSibling' ? text.slice(-1) : text[0];
      return !/[\s\u200B\uFEFF]/.test(edge);
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
 * separaban (también los renglones en blanco: la tarjeta ya es su propio bloque). Adentro de un ítem de lista,
 * de una tabla o de un título no hay tarjeta: queda el link.
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

  for (const side of ['previousSibling', 'nextSibling'] as const) {
    for (let n = unit[side]; n && (n.nodeName === 'BR' || blank(n)); ) {
      const next: ChildNode | null = n[side];
      n.remove();
      n = next;
    }
  }
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

/**
 * Saca los caracteres que se usan de marca del texto y de los atributos que trae Coda, y el carácter de "objeto"
 * (U+FFFC) que Coda deja en el texto al lado de una foto: no es texto y se vería como un cuadradito.
 */
function stripMarkers(root: Element): void {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent!;
    if (text.includes(OPEN) || text.includes(CLOSE) || text.includes(OBJECT)) n.textContent = text.replace(MARKERS, '').replaceAll(OBJECT, '');
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

/** Una foto en línea (`photo`, Doc_Fotos_En_Linea.md): lo que da `photoOf` para una marca. */
export interface InlinePhoto {
  type: 'photo';
  props: { url: string; name: string; w: number };
}

/** El ancho del texto de una página de Coda (px): una foto de ese ancho o más ocupa todo el renglón. */
export const CODA_TEXT_WIDTH = 624;

/**
 * Lo que entra un ítem de lista de Coda por cada nivel (px): medido en una captura de Coda, el texto de un ítem empieza
 * 22 a 24 px más adentro que el de un párrafo.
 */
export const CODA_LIST_INDENT = 24;

/** El ancho del renglón de Coda (px) adentro de `depth` niveles de lista. */
export const codaLineWidth = (depth: number): number => Math.max(CODA_TEXT_WIDTH / 2, CODA_TEXT_WIDTH - depth * CODA_LIST_INDENT);

/**
 * El `w` de una foto en línea con el ancho con que se veía en Coda: la parte de SU renglón de Coda que ocupaba
 * (`line`: 624 px, menos la sangría si está en una lista), porque `w` es una parte del renglón donde está. Así las que
 * entraban juntas en un renglón de Coda entran juntas en uno de la app, y una foto de un ítem no sale más chica que en
 * Coda (auditoría, ronda 3). 0: su ancho natural.
 */
export function codaPhotoWidth(px: number, line = CODA_TEXT_WIDTH): number {
  return px > 0 ? Math.min(1, Math.round((px / line) * 10000) / 10000) : 0;
}

// Los bloques cuyo renglón lleva fotos en línea. En los demás (código) la foto sigue siendo un bloque aparte.
const PHOTO_HOSTS = new Set(['paragraph', 'heading', 'quote', 'bulletListItem', 'numberedListItem', 'checkListItem', 'toggleListItem']);

/**
 * Cambia cada marca por su foto: en el renglón donde estaba (`photoOf`, entrega 4 de Doc_Fotos_En_Linea.md) o, si
 * no es una foto ni un video (un adjunto) o el bloque no lleva fotos en línea, por su bloque `image` (`imageOf`).
 * Saca el último salto de línea de cada renglón (`dropLastBreak`), deja hasta dos párrafos vacíos seguidos, saca
 * los del final y marca como Script lo que está debajo de un título "Guion". Los bloques salen sin id. Sin
 * `photoOf`, todas van como bloque (como antes de la entrega 4).
 */
export function finishBlocks(
  blocks: LooseBlock[],
  imageOf: (index: number) => LooseBlock | null,
  photoOf?: (index: number, line: number) => InlinePhoto | null,
): LooseBlock[] {
  const out = splitAll(blocks, imageOf, photoOf, 0);
  dropLastBreak(out);
  markScript(out);
  // Una marca que quedó donde no se la buscó (no debería pasar) no se ve como basura en el texto; la foto
  // la ubica al final quien importa (codaImport.ts).
  return stripTableTokens(collapseEmpty(out), []) as LooseBlock[];
}

function splitAll(
  blocks: LooseBlock[],
  imageOf: (index: number) => LooseBlock | null,
  photoOf: ((index: number, line: number) => InlinePhoto | null) | undefined,
  depth: number,
): LooseBlock[] {
  const out: LooseBlock[] = [];
  for (const block of blocks) {
    // `depth`: niveles de lista alrededor (el renglón de un ítem es más angosto que el de la página).
    const inner = LIST_ITEMS.has(block.type) ? depth + 1 : depth;
    const children = splitAll(block.children ?? [], imageOf, photoOf, inner);
    const base: LooseBlock = { type: block.type, props: block.props, content: block.content, children };
    if (block.type === 'table') {
      // Una foto no va en una celda (todavía: entrega 5): la marca se saca y la foto va debajo de la tabla, las
      // seguidas en un mismo renglón.
      const found: number[] = [];
      base.content = stripTableTokens(block.content, found);
      out.push(base);
      let row: InlinePhoto[] = [];
      const flush = () => {
        if (row.length) out.push({ type: 'paragraph', content: row, children: [] });
        row = [];
      };
      for (const i of found) {
        const photo = photoOf?.(i, codaLineWidth(depth));
        if (photo) {
          row.push(photo);
          continue;
        }
        flush();
        const img = imageOf(i);
        if (img) out.push(img);
      }
      flush();
      continue;
    }
    if (!Array.isArray(block.content)) {
      out.push(base);
      continue;
    }
    if (photoOf && PHOTO_HOSTS.has(block.type)) {
      const line = codaLineWidth(inner);
      const content = inlinePhotos(block.content as Inline[], (i) => photoOf(i, line));
      if (content !== block.content) {
        base.content = content;
        // Un título que quedó solo con fotos (sin texto) es un renglón de fotos: un título sin texto cortaría el
        // guion y quedaría vacío en el índice.
        if (block.type === 'heading' && !inlineText(content).trim()) {
          base.type = 'paragraph';
          base.props = { textAlignment: block.props?.textAlignment ?? 'left' };
        }
      }
    }
    const parts = splitInline(base.content as Inline[]);
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

/**
 * Cada marca que `photoOf` resuelve pasa a ser la foto en línea, en su lugar del renglón (las demás quedan como
 * marca, para ir como bloque). Coda pone cada foto en un `<span style="display: inline-block">` dentro del renglón:
 * lo que se veía junto en Coda queda junto. Sin cambios devuelve el mismo arreglo.
 *
 * Lo que rodeaba a las fotos en Coda y no es texto se saca: el espacio de ancho cero (U+200B) que Coda pone antes de
 * una foto, los espacios sueltos entre dos fotos (cortarían la fila) y los del borde del renglón, y los espacios
 * entre un salto de línea y una foto. Los saltos de línea quedan: la foto que en Coda iba debajo del texto sigue
 * debajo.
 */
function inlinePhotos(content: Inline[], photoOf: (index: number) => InlinePhoto | null): Inline[] {
  const items: Inline[] = [];
  let found = false;
  for (const item of content) {
    if (item.type !== 'text' || !item.text || !item.text.includes(OPEN)) {
      items.push(item);
      continue;
    }
    let last = 0;
    for (const m of item.text.matchAll(TOKEN)) {
      const photo = photoOf(Number(m[1]));
      if (!photo) continue;
      found = true;
      const before = item.text.slice(last, m.index);
      if (before) items.push({ ...item, text: before });
      items.push(photo as unknown as Inline);
      last = m.index + m[0].length;
    }
    const rest = item.text.slice(last);
    if (rest) items.push({ ...item, text: rest });
  }
  if (!found) return content;
  const isPhoto = (i: Inline | undefined) => i?.type === 'photo';
  const out = items
    .map((i) => (i.type === 'text' && i.text ? { ...i, text: i.text.replace(/​/g, '') } : i))
    .map((i, k, all) => {
      if (i.type !== 'text' || i.text === undefined) return i;
      let text = i.text;
      if (isPhoto(all[k + 1])) text = text.replace(/\n[ \t]+$/, '\n');
      if (isPhoto(all[k - 1])) text = text.replace(/^[ \t]+\n/, '\n');
      // Solo espacios entre dos fotos, o entre una foto y el borde del renglón.
      const between = (k === 0 || isPhoto(all[k - 1])) && (k === all.length - 1 || isPhoto(all[k + 1]));
      if (between && !text.trim() && !text.includes('\n')) text = '';
      return { ...i, text };
    })
    .filter((i) => i.type !== 'text' || i.text !== '');
  return trimBreaks(out);
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
    // El editor guarda el salto que sigue a un link adentro del link (`https://…\n`): también se saca, pero
    // nunca el link ni su texto.
    if (i?.type === 'link' && i.content?.length) {
      const k = side === 'start' ? 0 : i.content.length - 1;
      const inner = i.content[k];
      const text = inner.type === 'text' && inner.text ? (side === 'start' ? inner.text.replace(/^\s*\n\s*/, '') : inner.text.replace(/\s*\n\s*$/, '')) : '';
      if (text) i.content = i.content.map((c, j) => (j === k ? { ...c, text } : c));
      return false;
    }
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

/**
 * Saca un salto de línea al final de cada renglón (párrafo, título, cita, ítem): el último `<br>` de un bloque
 * de HTML no agrega un renglón, pero en el editor sí (se veía de dos renglones de alto). Así `<div><br></div>`
 * (un renglón en blanco de Coda) es un párrafo vacío y `<div>Dos<br></div>` es "Dos"; con dos saltos queda uno,
 * como se veía. Si el salto quedó adentro de un link al final (así lo guarda el editor), también, pero nunca el
 * texto del link. Solo saca saltos: ninguna letra.
 */
function dropLastBreak(blocks: LooseBlock[]): void {
  for (const b of blocks) {
    dropLastBreak(b.children ?? []);
    if (!PHOTO_HOSTS.has(b.type) || !Array.isArray(b.content)) continue;
    const items = b.content as Inline[];
    const last = items.at(-1);
    if (last?.type === 'text' && last.text?.endsWith('\n')) {
      const text = last.text.slice(0, -1);
      b.content = text ? [...items.slice(0, -1), { ...last, text }] : items.slice(0, -1);
    } else if (last?.type === 'link' && last.content?.length) {
      const inner = last.content.at(-1)!;
      if (inner.type !== 'text' || !inner.text?.endsWith('\n')) continue;
      const text = inner.text.slice(0, -1);
      // Un link que es solo un salto queda como estaba.
      if (!text && last.content.length === 1) continue;
      const content = text ? [...last.content.slice(0, -1), { ...inner, text }] : last.content.slice(0, -1);
      b.content = [...items.slice(0, -1), { ...last, content }];
    }
  }
}

/** Hasta dos párrafos vacíos seguidos (en Coda, casi todos los huecos son de uno o dos renglones); sin los de las puntas. */
function collapseEmpty(blocks: LooseBlock[]): LooseBlock[] {
  const isEmpty = (b: LooseBlock) =>
    b.type === 'paragraph' && !b.children?.length && Array.isArray(b.content) && isBlank(b.content as Inline[]);
  const out = blocks.filter((b, i) => !(isEmpty(b) && i > 1 && isEmpty(blocks[i - 1]) && isEmpty(blocks[i - 2])));
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
  for (const original of blocks) {
    let block = original;
    // Las fotos en línea del renglón, igual que los bloques.
    if (Array.isArray(block.content) && (block.content as Inline[]).some((i) => i.type === 'photo')) {
      const content = (block.content as (Inline & { props?: { url?: unknown } })[]).filter((i) => {
        if (i.type !== 'photo') return true;
        const url = String(i.props?.url ?? '');
        if (url.startsWith('sdmedia://')) return true;
        const kept = /^https:\/\//i.test(url);
        note(url, kept);
        return kept;
      });
      block = { ...block, content };
    }
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