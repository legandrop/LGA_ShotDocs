import { t } from '../i18n';
import { formatSize } from './fileTrash';
import { deletedLabel, escapeXml, mediaKind } from './probe';

// Los adjuntos (Docs/Doc_Adjuntos.md): cualquier archivo que no sea una foto o un video que se muestre. Va en
// el mismo bloque `image` con `sdmedia://<id>`; lo que cambia es cómo se dibuja (una tarjeta con el ícono del
// tipo, el nombre y el peso) y cómo se abre o se baja. Acá está lo que no depende de la cola: qué es cada
// archivo, qué se puede abrir, los nombres limpios y la tarjeta.

/** Qué es un archivo para la app: una foto, un video o un adjunto (todo lo demás). */
export type FileKind = 'image' | 'video' | 'file';

/** La familia del adjunto, para el color de la etiqueta. */
export type AttachmentFamily = 'pdf' | 'archive' | 'audio' | 'doc' | 'sheet' | 'slides' | 'exec' | 'project' | 'other';

/**
 * Tipos por extensión, para lo que el navegador entrega sin tipo (pasa con .mov y .heic en Windows, y con .rar,
 * .exe o .nk casi siempre). Primero las fotos y los videos: el primero de cada tipo es su extensión de siempre.
 */
export const EXTENSION_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  dng: 'image/x-adobe-dng',
  mov: 'video/quicktime',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  mts: 'video/mp2t',
  '3gp': 'video/3gpp',
  // Adjuntos. Los que son `image/*` pero el navegador no muestra (SVG, PSD, EXR...) quedan como adjuntos por
  // `fileKind`, no por el tipo.
  pdf: 'application/pdf',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pages: 'application/vnd.apple.pages',
  numbers: 'application/vnd.apple.numbers',
  key: 'application/vnd.apple.keynote',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  psd: 'image/vnd.adobe.photoshop',
  exr: 'image/x-exr',
  dpx: 'image/x-dpx',
  tga: 'image/x-tga',
  dwg: 'image/vnd.dwg',
  svg: 'image/svg+xml',
  exe: 'application/vnd.microsoft.portable-executable',
  dmg: 'application/x-apple-diskimage',
  nk: 'application/x-nuke',
  blend: 'application/x-blender',
  fbx: 'application/x-fbx',
  abc: 'application/x-alembic',
  usd: 'application/x-usd',
};

/** Tipos de imagen que el navegador nunca muestra (o que no conviene mostrar): en la página son adjuntos. */
const NEVER_SHOWN = new Set([
  // Puede traer scripts.
  'image/svg+xml',
  'image/vnd.adobe.photoshop',
  'image/x-photoshop',
  'image/x-exr',
  'image/x-dpx',
  'image/x-tga',
  'image/vnd.dwg',
]);

/** `tipo/subtipo` en minúsculas y sin parámetros (puede quedar vacío). */
function baseType(mime: string | null | undefined): string {
  return (mime ?? '').split(';')[0].trim().toLowerCase();
}

/** La extensión del nombre, en minúsculas y sin el punto, o `''`. */
function extensionOf(name: string | null | undefined): string {
  return /\.([a-z0-9]{1,10})$/i.exec((name ?? '').trim())?.[1]?.toLowerCase() ?? '';
}

/** El tipo que corresponde a la extensión del nombre, o `null` si no se conoce. */
export function mimeFromName(name: string | null | undefined): string | null {
  const ext = extensionOf(name);
  return (ext && EXTENSION_MIME[ext]) || null;
}

/**
 * Foto, video o adjunto. Es foto o video si `mediaKind` lo dice y no es uno de los que el navegador nunca
 * muestra (SVG, PSD, EXR, DPX, TGA, DWG). Sin tipo (o con el genérico), sale de la extensión del nombre.
 * HEIC, TIFF, DNG y los videos que no se reproducen siguen siendo fotos y videos.
 */
export function fileKind(mime: string | null | undefined, name?: string | null): FileKind {
  let type = baseType(mime);
  if (!type || type === 'application/octet-stream') type = mimeFromName(name) ?? '';
  const kind = mediaKind(type);
  // Un subtipo XML (`image/x+xml`) el navegador lo muestra como documento: es un adjunto, como el SVG.
  const xml = /\/(?:.*\+)?xml$|svg/.test(type);
  return kind && !NEVER_SHOWN.has(type) && !xml ? kind : 'file';
}

/**
 * Lo que se abre en una pestaña: lo que el navegador sabe mostrar (fotos y audio comunes, videos, PDF y texto
 * plano). Más estricto que el portero (que muestra cualquier foto, video o audio menos SVG y XML): un PSD, un
 * EXR o un AIFF abierto en una pestaña terminaría bajándose con un nombre sin extensión, así que se bajan con
 * su nombre. Nunca un SVG ni un subtipo XML.
 */
const INLINE_IMAGE = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/bmp']);
const INLINE_AUDIO = new Set(['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/flac']);
export function inlineType(mime: string): boolean {
  const type = baseType(mime);
  if (/svg|\/(?:.*\+)?xml$/.test(type) || NEVER_SHOWN.has(type)) return false;
  if (INLINE_IMAGE.has(type) || INLINE_AUDIO.has(type)) return true;
  if (/^video\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(type)) return true;
  return type === 'application/pdf' || type === 'text/plain';
}

const FAMILY_EXTENSIONS: [AttachmentFamily, string[]][] = [
  ['archive', ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz']],
  ['audio', ['mp3', 'wav', 'aif', 'aiff', 'm4a', 'flac', 'ogg', 'opus']],
  ['sheet', ['csv', 'tsv', 'xls', 'xlsx', 'numbers', 'ods']],
  ['slides', ['ppt', 'pptx', 'key', 'odp']],
  ['doc', ['txt', 'doc', 'docx', 'pages', 'rtf', 'md', 'odt', 'json']],
  ['exec', ['exe', 'msi', 'dmg', 'pkg', 'app', 'apk', 'deb', 'bat', 'sh']],
  [
    'project',
    ['nk', 'blend', 'fbx', 'abc', 'usd', 'usda', 'usdc', 'usdz', 'obj', 'ma', 'mb', 'hip', 'hiplc', 'c4d', 'aep', 'prproj', 'drp', 'psd', 'exr', 'dpx', 'tga', 'dwg'],
  ],
];

const FAMILY_TYPES: [AttachmentFamily, RegExp][] = [
  ['archive', /^application\/(zip|x-zip-compressed|vnd\.rar|x-rar-compressed|x-7z-compressed|x-tar|gzip|x-gzip|x-bzip2|x-xz)$/],
  ['sheet', /^(text\/(csv|tab-separated-values)|application\/(vnd\.ms-excel|vnd\.openxmlformats-officedocument\.spreadsheetml\..+|vnd\.apple\.numbers|vnd\.oasis\.opendocument\.spreadsheet))$/],
  ['slides', /^application\/(vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.presentationml\..+|vnd\.apple\.keynote|vnd\.oasis\.opendocument\.presentation)$/],
  ['doc', /^(text\/.+|application\/(msword|vnd\.openxmlformats-officedocument\.wordprocessingml\..+|vnd\.apple\.pages|rtf|json|vnd\.oasis\.opendocument\.text))$/],
  ['exec', /^application\/(vnd\.microsoft\.portable-executable|x-msdownload|x-msi|x-apple-diskimage|vnd\.android\.package-archive)$/],
  ['project', /^(model\/.+|image\/(vnd\.adobe\.photoshop|x-photoshop|x-exr|x-dpx|x-tga|vnd\.dwg)|application\/x-(nuke|blender|fbx|alembic|usd))$/],
];

/** La familia de un adjunto: primero por el tipo, después por la extensión. */
export function attachmentFamily(mime: string | null | undefined, name?: string | null): AttachmentFamily {
  const type = baseType(mime);
  const ext = extensionOf(name);
  if (type === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (type.startsWith('audio/')) return 'audio';
  for (const [family, pattern] of FAMILY_TYPES) if (pattern.test(type)) return family;
  for (const [family, list] of FAMILY_EXTENSIONS) if (list.includes(ext)) return family;
  return 'other';
}

/** Extensiones largas conocidas, dichas en corto. */
const SHORT_LABEL: Record<string, string> = { numbers: 'NUM', keynote: 'KEY', prproj: 'PRPJ', sketch: 'SKTCH' };

/**
 * La etiqueta del ícono (PDF, ZIP, NK...): hasta 5 letras en mayúsculas, de la extensión del nombre o, si no
 * tiene, del tipo. `''` si no se sabe.
 */
export function extensionLabel(name: string | null | undefined, mime: string | null | undefined): string {
  const fit = (ext: string) => (SHORT_LABEL[ext] ?? ext.slice(0, 5)).toUpperCase();
  const ext = (name ?? '').trim() ? extensionOf(cleanFileName(name ?? '')) : '';
  if (ext) return fit(ext);
  const type = baseType(mime);
  if (!type || type === 'application/octet-stream') return '';
  const known = Object.entries(EXTENSION_MIME).find(([, m]) => m === type)?.[0];
  if (known) return fit(known);
  // Del subtipo: `application/x-nuke` → NUKE. Si es largo, no se inventa nada.
  const sub = (type.split('/')[1] ?? '').replace(/^(x-|vnd\.)/, '').split('+')[0].split('.').pop() ?? '';
  const letters = sub.replace(/[^a-z0-9]/g, '');
  return letters && letters.length <= 5 ? letters.toUpperCase() : '';
}

/** El largo máximo de un nombre en la base (`files.name`, en caracteres). */
const MAX_NAME = 250;

/**
 * El nombre sin lo que puede engañar o romper algo: caracteres de control, los que XML no admite (y pares
 * sustitutos sueltos) y los de dirección del texto (con los que `exe.pdf` se ve como `fdp.exe`). Se recorta a
 * 250 caracteres contados por puntos de código (nunca queda medio emoji), conservando la extensión. Vacío,
 * `file.bin`.
 */
export function cleanFileName(name: string, max = MAX_NAME): string {
  const kept: string[] = [];
  for (const ch of name ?? '') {
    const c = ch.codePointAt(0)!;
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) continue;
    if (c >= 0xd800 && c <= 0xdfff) continue;
    if (c === 0xfffe || c === 0xffff) continue;
    // Dirección del texto, los de ancho cero y los separadores de renglón (los mismos que saca el portero).
    if (c === 0x061c || (c >= 0x200b && c <= 0x200f) || c === 0x2028 || c === 0x2029 || (c >= 0x202a && c <= 0x202e)) continue;
    if (c === 0x2060 || (c >= 0x2066 && c <= 0x2069)) continue;
    kept.push(ch);
  }
  const clean = kept.join('').trim();
  if (!clean) return 'file.bin';
  const points = Array.from(clean);
  if (points.length <= max) return clean;
  const ext = /\.[A-Za-z0-9]{1,10}$/.exec(clean)?.[0] ?? '';
  return points.slice(0, max - ext.length).join('').trimEnd() + ext;
}

/**
 * El mismo contenido con un tipo que no se ejecuta en el origen de la app (un `blob:` hereda el origen: un HTML
 * o un SVG abierto ahí podría correr código). `download`: siempre `application/octet-stream`; `open`: su tipo
 * solo si está en la lista de lo que se puede abrir.
 */
export function safeBlob(blob: Blob, mode: 'download' | 'open'): Blob {
  const type = mode === 'open' && inlineType(blob.type) ? baseType(blob.type) : 'application/octet-stream';
  return blob.type === type ? blob : new Blob([blob], { type });
}

// --- la tarjeta -------------------------------------------------------------------------------------

export interface AttachmentCardInfo {
  name: string;
  mime: string;
  size?: number | null;
  /** `pending`: todavía no se puede abrir; `foreign`: de otro proyecto; `deleted`: en la papelera de Drive. */
  state?: 'ok' | 'pending' | 'foreign' | 'deleted';
  /** Con `deleted`, lo que se dice en vez de "Borrado" (por ejemplo, que se pidió y falta confirmarlo). */
  notice?: string;
}

const WIDTH = 360;
const HEIGHT = 96;
const TEXT_X = 88;
const TEXT_W = WIDTH - TEXT_X - 16;
const NAME_SIZE = 15;
const META_SIZE = 13;
const FONT = "-apple-system, system-ui, 'Segoe UI', Roboto, sans-serif";

/** Los colores de la etiqueta por familia: fondo y letra. */
const FAMILY_COLORS: Record<AttachmentFamily, [string, string]> = {
  pdf: ['#d93025', '#ffffff'],
  archive: ['#f2b705', '#3d2e00'],
  audio: ['#8e44ad', '#ffffff'],
  doc: ['#2f6fd6', '#ffffff'],
  sheet: ['#1e8e3e', '#ffffff'],
  slides: ['#e8710a', '#ffffff'],
  exec: ['#3c4043', '#ffffff'],
  project: ['#1a9bc9', '#ffffff'],
  other: ['#8a8580', '#ffffff'],
};

/**
 * El ancho aproximado de un carácter, en `em`, para una fuente del sistema. Se estima de más: lo que se pase
 * lo corta el `clipPath` igual, pero así casi nunca llega a cortarse.
 */
function charWidth(ch: string): number {
  const c = ch.codePointAt(0)!;
  // Con margen para las fuentes anchas (la de Linux, DejaVu Sans, es más ancha que las de Mac y Windows).
  if (c >= 0x2e80) return 1.08;
  if (/[\s.,:;'|!()[\]ijlItf]/.test(ch)) return 0.38;
  if (/[mwMW@%]/.test(ch)) return 0.98;
  if (/[A-Z]/.test(ch)) return 0.76;
  if (/[0-9]/.test(ch)) return 0.66;
  return 0.64;
}

function widthOf(chars: string[], size: number): number {
  return chars.reduce((sum, ch) => sum + charWidth(ch), 0) * size;
}

/** Un renglón que entra en el ancho, con "…" al final si hubo que cortar. */
function fitOne(text: string, size: number): string {
  const chars = Array.from(text);
  if (widthOf(chars, size) <= TEXT_W) return text;
  const out: string[] = [];
  let width = charWidth('…') * size;
  for (const ch of chars) {
    const w = charWidth(ch) * size;
    if (width + w > TEXT_W) break;
    out.push(ch);
    width += w;
  }
  return `${out.join('').trimEnd()}…`;
}

/**
 * El nombre en uno o dos renglones. Si no entra en dos, se corta en el medio: el primer renglón es el
 * principio y el segundo, "…" y el final (así se sigue viendo la extensión).
 */
function nameLines(name: string): string[] {
  const chars = Array.from(name);
  if (widthOf(chars, NAME_SIZE) <= TEXT_W) return [name];
  let end = 0;
  let width = 0;
  while (end < chars.length && width + charWidth(chars[end]) * NAME_SIZE <= TEXT_W) {
    width += charWidth(chars[end]) * NAME_SIZE;
    end++;
  }
  end = Math.max(1, end);
  // Si hay un separador cerca del final del renglón, se corta ahí (se lee mejor).
  let cut = end;
  for (let i = end; i > end * 0.6; i--) {
    if (/[\s_\-.]/.test(chars[i - 1])) {
      cut = i;
      break;
    }
  }
  const rest = chars.slice(cut);
  if (widthOf(rest, NAME_SIZE) <= TEXT_W) return [chars.slice(0, cut).join('').trimEnd(), rest.join('').trimStart()];
  const tail: string[] = [];
  let tailWidth = charWidth('…') * NAME_SIZE;
  for (let i = chars.length - 1; i >= end; i--) {
    const w = charWidth(chars[i]) * NAME_SIZE;
    if (tailWidth + w > TEXT_W) break;
    tail.unshift(chars[i]);
    tailWidth += w;
  }
  return [chars.slice(0, end).join('').trimEnd(), `…${tail.join('').trimStart()}`];
}

/**
 * La tarjeta de un adjunto para la página: un SVG de 360×96 sin scripts ni nada de afuera, como dirección
 * `data:` (BlockNote la pone en su `<img>`, así que elegir, mover, comentar e imprimir andan igual que con una
 * foto). A la izquierda el documento con la etiqueta del tipo; a la derecha el nombre y "PDF · 2,4 MB". Las
 * variantes (todavía no disponible, de otro proyecto, borrado) tienen la misma forma.
 */
export function attachmentCardUrl(info: AttachmentCardInfo): string {
  const state = info.state ?? 'ok';
  const raw = (info.name ?? '').trim();
  const name = raw ? cleanFileName(raw) : '';
  const label = extensionLabel(name, info.mime);
  const [badge, badgeInk] = FAMILY_COLORS[state === 'deleted' ? 'other' : attachmentFamily(info.mime, name)];
  const size = typeof info.size === 'number' && info.size > 0 ? formatSize(info.size) : '';
  const details = [label, size].filter(Boolean).join(' · ');

  let title: string;
  let meta: string;
  if (state === 'pending') {
    title = name || t('queue.notYet');
    meta = name ? t('queue.notYet') : details;
  } else if (state === 'foreign') {
    title = name || t('attachment.foreign');
    meta = name ? t('attachment.foreign') : details;
  } else if (state === 'deleted') {
    title = name || cleanFileName('');
    meta = info.notice ?? deletedLabel();
  } else {
    title = name || cleanFileName('');
    meta = details;
  }

  const lines = nameLines(title);
  const faded = state === 'deleted';
  const nameY = lines.length === 1 ? [45] : [36, 55];
  const metaY = lines.length === 1 ? 67 : 76;
  const titleInk = faded ? '#8a8580' : '#3f3b37';
  const strike = faded ? ' text-decoration="line-through"' : '';

  const badgeSvg = label
    ? `<rect x="18" y="50" width="56" height="20" rx="4" fill="${badge}"/>` +
      `<text x="46" y="64.5" text-anchor="middle" font-size="11.5" font-weight="700" letter-spacing="0.3" fill="${badgeInk}">${escapeXml(label)}</text>`
    : '';
  const text =
    lines
      .map(
        (line, i) =>
          `<text x="${TEXT_X}" y="${nameY[i]}" font-size="${NAME_SIZE}" font-weight="500" fill="${titleInk}"${strike}>${escapeXml(line)}</text>`,
      )
      .join('') +
    (meta ? `<text x="${TEXT_X}" y="${metaY}" font-size="${META_SIZE}" fill="#76716b">${escapeXml(fitOne(meta, META_SIZE))}</text>` : '');

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">` +
    `<defs><clipPath id="text"><rect x="${TEXT_X}" y="0" width="${TEXT_W}" height="${HEIGHT}"/></clipPath></defs>` +
    `<rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}" rx="10" fill="#ebe8e4" stroke="#dcd8d3"/>` +
    `<g font-family="${FONT}"${faded ? ' opacity="0.6"' : ''}>` +
    '<path d="M24 12h32l16 16v54a2 2 0 0 1-2 2H24a2 2 0 0 1-2-2V14a2 2 0 0 1 2-2z" fill="#ffffff" stroke="#b9b4ae" stroke-width="1.5"/>' +
    '<path d="M56 12v14a2 2 0 0 0 2 2h14" fill="#e3dfda" stroke="#b9b4ae" stroke-width="1.5" stroke-linejoin="round"/>' +
    badgeSvg +
    '</g>' +
    `<g font-family="${FONT}" clip-path="url(#text)">${text}</g>` +
    '</svg>';
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
