import { fileHref, linkHash, workspaceHash } from '../fileLink';
import { fileKind, isFolderMime, mimeFromName } from '../media/attachments';

// Los links a los archivos en la copia de impresión (P.30, Docs/Doc_Links_PDF.md, sección 3): cada tarjeta de un adjunto
// o de una carpeta y cada cuadro de un video llevan un link a la dirección fija del archivo (`/f/…`), la tarjeta entera
// (`<a>` con `display: block`, medido en Chromium: un rectángulo exacto; en línea sumaba una franja) y debajo el nombre
// como texto con el mismo link. Las fotos no. Tampoco el marcador de un archivo de otro proyecto, la tarjeta de uno
// borrado ni el "no está en este dispositivo", ni un video en línea (`.sd-photo`): el nombre debajo rompería el renglón.
//
// La vista de medir (las marcas de hoja, SheetBreaks) suma el mismo renglón del nombre, sin link, y decide con la misma
// función: así las marcas siguen coincidiendo con el PDF (LF6).

const MEDIA = 'sdmedia://';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lo que la copia de impresión necesita saber de los archivos del workspace abierto. */
export interface MediaLinkSource {
  /** Lo que se sabe del archivo sin esperar (`MediaQueue.fileInfo`), o `null`. */
  info(id: string): { mime: string; name: string } | null;
  /** Si en esa página se muestra el archivo (y no un marcador de otro proyecto, borrado o sin el archivo). */
  linkable(id: string, pageId: string | null): boolean;
  /**
   * La dirección del link. Con una cuenta, siempre con el `#ws=` del workspace (imprimir nunca pone el token de un
   * link público: LF17); con un link público, el `#link=` del propio link.
   */
  href(id: string): string;
}

let current: MediaLinkSource | null = null;

/**
 * La fuente de la app abierta (la pone `Shell`, Workspace.tsx). Con una cuenta, el `#` es siempre el del workspace
 * (`#ws=`): imprimir nunca pone el token de un link público (LF17). Con un link público abierto, el del propio link.
 */
export function appLinkSource(
  media: { fileInfo(id: string): { mime: string; name: string } | null; linkable(id: string, pageId: string | null): boolean },
  config: { url: string; publishableKey: string; localKey: string },
  link: { url: string; publishableKey: string; localKey: string; token: string } | null,
  origin: string,
): MediaLinkSource {
  const hash = link
    ? linkHash({ u: link.url, k: link.publishableKey, l: link.localKey, t: link.token })
    : workspaceHash({ u: config.url, k: config.publishableKey, l: config.localKey });
  const key = link ? link.localKey : config.localKey;
  return {
    info: (id) => media.fileInfo(id),
    linkable: (id, page) => media.linkable(id, page),
    href: (id) => fileHref(origin, key, id, hash),
  };
}

/** La pone el workspace abierto (Workspace.tsx). Devuelve cómo sacarla. */
export function setMediaLinkSource(source: MediaLinkSource): () => void {
  current = source;
  return () => {
    if (current === source) current = null;
  };
}

export function mediaLinkSource(): MediaLinkSource | null {
  return current;
}

export interface MediaLinkTarget {
  id: string;
  name: string;
}

/** Si el bloque (`[data-content-type="image"]`) lleva link en el PDF, y a qué archivo. */
export function mediaLinkTarget(block: HTMLElement, source: MediaLinkSource, pageId: string | null): MediaLinkTarget | null {
  const url = block.getAttribute('data-url') ?? '';
  if (!url.startsWith(MEDIA)) return null;
  const id = url.slice(MEDIA.length).toLowerCase();
  if (!UUID.test(id)) return null;
  const info = source.info(id);
  const blockName = block.getAttribute('data-name') ?? '';
  let linked: boolean;
  if (info) {
    linked = isFolderMime(info.mime) || fileKind(info.mime, info.name) !== 'image';
  } else {
    // Sin la info todavía (el esquema de siempre: un bloque `image` con `sdmedia://`), solo por una extensión conocida que
    // no es de fotos (como `isAttachment`): un nombre sin extensión puede ser una foto.
    const mime = mimeFromName(blockName);
    linked = mime !== null && fileKind(mime, blockName) !== 'image';
  }
  if (!linked || !source.linkable(id, pageId)) return null;
  return { id, name: (info?.name || blockName).trim() };
}

/**
 * Pone los links en la copia (antes de agregarla al documento). `href` nulo: la vista de medir (el renglón del nombre
 * sin link, del mismo alto). `pageId`: la página que se copia (para el marcador de otro proyecto).
 */
export function addMediaLinks(
  copy: HTMLElement,
  options: { source: MediaLinkSource | null; pageId: string | null; href: ((id: string) => string | null) | null },
): void {
  const { source } = options;
  if (!source) return;
  for (const block of copy.querySelectorAll<HTMLElement>(`[data-content-type="image"][data-url^="${MEDIA}"]`)) {
    const target = mediaLinkTarget(block, source, options.pageId);
    if (!target) continue;
    const img = block.querySelector<HTMLImageElement>('img.bn-visual-media');
    if (!img) continue;
    const href = options.href ? safeHref(options.href(target.id)) : null;
    if (href) {
      const a = document.createElement('a');
      a.className = 'sd-media-link';
      a.href = href;
      img.replaceWith(a);
      a.append(img);
    }
    const name = document.createElement(href ? 'a' : 'span');
    name.className = 'sd-media-name';
    if (href) (name as HTMLAnchorElement).href = href;
    name.textContent = target.name || '—';
    (img.closest('.bn-visual-media-wrapper') ?? img.closest('a') ?? img).after(name);
  }
}

/** Solo una dirección `http(s)` (nunca `javascript:` ni otra cosa). */
function safeHref(href: string | null): string | null {
  if (!href) return null;
  try {
    const url = new URL(href);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}
