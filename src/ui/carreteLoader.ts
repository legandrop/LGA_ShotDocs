import { fileKind, inlineType, safeBlob } from '../media/attachments';
import { PorteroError } from '../media/portero';
import type { MediaKind } from '../media/probe';
import { normalizeMime, type MediaQueue, type MediaSource } from '../media/queue';
import type { PageFiles } from '../sync/files';
import { isNetworkError } from '../sync/types';
import { fallbackName, type CarreteItem } from './carreteModel';

// De dónde saca el carrete lo que muestra (Docs/Doc_Carrete.md). Primero lo que ya está a mano (la
// miniatura, guardada en el dispositivo), después lo grande: la copia local si el archivo está en el
// dispositivo (anda sin red) o el archivo entero con un pase del portero. Lo que ya se pidió se guarda
// mientras el carrete está abierto, así ir y volver no pide dos veces; los pases del portero, mientras
// les falte más de una hora para vencer (también entre un carrete y el siguiente).
//
// Todo `blob:` que sale de un original se envuelve de nuevo (Docs/Doc_Adjuntos.md): un `blob:` tiene el origen
// de la app, y con los adjuntos un original puede ser un HTML o un SVG. Para bajar, siempre
// `application/octet-stream`; para mostrar en el carrete, su tipo solo si es una foto o un video.

export interface Preview {
  /** `null` si no se sabe (sin red y sin datos del archivo). */
  kind: MediaKind | null;
  /** El nombre para mostrar y para bajar el archivo. */
  name: string;
  /** Lo primero que se ve: la miniatura, un ícono o, si ya está a mano, la foto entera. */
  preview: string | null;
}

export interface Full {
  url: string;
  /** Está en este dispositivo (se baja con su nombre y anda sin red). */
  local: boolean;
  /** Es un pase del portero: para bajarlo se le agrega `?download=1` (si no, un PDF se abriría). */
  portero?: boolean;
}

export interface CarreteLoader {
  preview(item: CarreteItem): Promise<Preview>;
  /** La foto grande o el video. Tira si no se puede (sin red, sin portero, error del portero). */
  full(item: CarreteItem): Promise<Full>;
  /** Olvida lo grande de este elemento (y su pase): la próxima vez se pide de nuevo. */
  retry(item: CarreteItem): void;
  /** Suelta lo creado para este carrete (las direcciones de los originales en memoria). */
  dispose(): void;
}

/** El portero da pases de 8 horas: se reusan mientras les falte más de una hora. */
export const PASS_REUSE_MS = 7 * 60 * 60_000;

// Por cola de archivos (una por sesión del workspace): el pase de una persona no se le da a otra. `named`: el
// portero dijo que lo sirve con su nombre; sin el dato (pedido con `pass`), no se sabe.
const passCache = new WeakMap<object, Map<string, { url: string; at: number; named?: boolean }>>();

function passesOf(media: object): Map<string, { url: string; at: number; named?: boolean }> {
  let cache = passCache.get(media);
  if (!cache) {
    cache = new Map();
    passCache.set(media, cache);
  }
  return cache;
}

/** Un pase del portero para el archivo, reusando el de hace menos de 7 horas. */
export async function passFor(media: Pick<MediaQueue, 'pass'>, id: string): Promise<string> {
  const cache = passesOf(media);
  const known = cache.get(id);
  if (known && Date.now() - known.at < PASS_REUSE_MS) return known.url;
  const at = Date.now();
  const url = await media.pass(id);
  cache.set(id, { url, at });
  return url;
}

/**
 * Un pase para bajar: con `named` si el portero lo sirve con su nombre. Un pase guardado sin esa marca no se
 * usa para bajar (se pide otro: el portero pudo actualizarse); uno con nombre se reusa como `passFor`.
 */
async function namedPassFor(media: Pick<MediaQueue, 'pass' | 'passInfo'>, id: string): Promise<{ url: string; named: boolean }> {
  const cache = passesOf(media);
  const known = cache.get(id);
  if (known?.named && Date.now() - known.at < PASS_REUSE_MS) return { url: known.url, named: true };
  const at = Date.now();
  const info = await media.passInfo(id);
  cache.set(id, { url: info.url, at, named: info.named });
  return info;
}

/** La dirección del portero que obliga a bajar el archivo (en vez de abrirlo). */
export function forceDownload(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}download=1`;
}

/** El original con el tipo que le corresponde (el guardado puede no tenerlo: un .mov de Windows llega sin tipo). */
function typed(original: Blob, mime: string | undefined, name: string): Blob {
  const type = normalizeMime(mime || original.type, name);
  return original.type === type ? original : new Blob([original], { type });
}

/**
 * El original para mostrar dentro de la app (un `<img>` o un `<video>` del carrete): con su tipo solo si es una
 * foto o un video; si no, como algo para bajar.
 */
function viewBlob(source: MediaSource): Blob {
  const original = source.original!;
  const blob = typed(original, source.mime, source.name);
  return fileKind(blob.type, source.name) === 'file' ? safeBlob(blob, 'download') : blob;
}

/** Olvida el pase guardado (no anduvo: se pide uno nuevo). */
export function forgetPass(media: Pick<MediaQueue, 'pass'>, id: string): void {
  passCache.get(media)?.delete(id);
}

/**
 * Los atributos del link para bajar el original: con su nombre si está en el dispositivo; si viene del
 * portero, con `?download=1` (el portero lo manda como descarga, con su nombre) y en otra pestaña (si
 * respondiera un error, no reemplaza la app; ver Doc_Carrete.md).
 */
export function downloadProps(full: Full, name: string): { href: string; download: string; target?: string; rel?: string } {
  if (full.local) return { href: full.url, download: name };
  const href = full.portero ? forceDownload(full.url) : full.url;
  return { href, download: name, target: '_blank', rel: 'noreferrer' };
}

/**
 * El original de un `sdmedia://` para bajarlo desde la barra de la imagen: el del dispositivo (con su
 * nombre) o un pase del portero. `release` suelta la dirección en memoria del original local.
 */
export async function originalFor(
  media: Pick<MediaQueue, 'source' | 'pass'>,
  id: string,
): Promise<{ full: Full; name: string; release: () => void }> {
  const source = await media.source(id);
  if (source.original) {
    const url = URL.createObjectURL(safeBlob(source.original, 'download'));
    return { full: { url, local: true }, name: source.name, release: () => URL.revokeObjectURL(url) };
  }
  return { full: { url: await passFor(media, id), local: false, portero: true }, name: source.name, release: () => undefined };
}

type Opener = Pick<MediaQueue, 'source' | 'pass' | 'passInfo' | 'mediaUrl'>;

/**
 * La dirección para abrir un adjunto en otra pestaña. Si está en el dispositivo, un `blob:` que conserva su
 * tipo solo si está en la lista de lo que se puede abrir (`inline`; si no, se bajaría); si no, un pase del
 * portero (que decide por su cuenta si lo muestra o lo baja). `null` si no está acá y no hay portero. Tira si
 * el pase falla (sin red, todavía sin subir).
 */
export async function openTarget(media: Opener, id: string): Promise<{ url: string; release: () => void; inline: boolean } | null> {
  const source = await media.source(id);
  if (source.original) {
    const blob = safeBlob(typed(source.original, source.mime, source.name), 'open');
    const url = URL.createObjectURL(blob);
    return { url, release: () => URL.revokeObjectURL(url), inline: inlineType(blob.type) };
  }
  if (!media.mediaUrl) return null;
  const url = await passFor(media, id);
  return { url, release: () => undefined, inline: inlineType(source.mime ?? '') };
}

/**
 * La dirección para bajar un adjunto (o una foto) con su nombre. En el dispositivo, un `blob:` que no se puede
 * abrir (`application/octet-stream`) para un `<a download>`; si no, el pase con `?download=1`. `named`: `false`
 * si el portero todavía no pone el nombre (se baja igual, con un nombre feo). `null` si no está acá y no hay
 * portero.
 */
export async function downloadTarget(
  media: Opener,
  id: string,
): Promise<{ url: string; name: string; release: () => void; named: boolean } | null> {
  const source = await media.source(id);
  if (source.original) {
    const url = URL.createObjectURL(safeBlob(source.original, 'download'));
    return { url, name: source.name, release: () => URL.revokeObjectURL(url), named: true };
  }
  if (!media.mediaUrl) return null;
  const pass = await namedPassFor(media, id);
  return { url: forceDownload(pass.url), name: source.name, release: () => undefined, named: pass.named };
}

/**
 * Baja el original desde código (la barra de la imagen en el editor). Con un `Blob`, lo baja sin que se pueda
 * abrir (`application/octet-stream`) y suelta la dirección enseguida.
 */
export function startDownload(target: Full | Blob, name: string): void {
  const blobUrl = target instanceof Blob ? URL.createObjectURL(safeBlob(target, 'download')) : null;
  const full: Full = blobUrl ? { url: blobUrl, local: true } : (target as Full);
  const a = document.createElement('a');
  const props = downloadProps(full, name);
  a.href = props.href;
  a.download = props.download;
  if (props.target) a.target = props.target;
  if (props.rel) a.rel = props.rel;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // La descarga empieza después del clic: la dirección se suelta un rato más tarde.
  if (blobUrl) setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

/** El error es por falta de red (o el navegador dice que no hay). */
export function isOffline(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (err instanceof PorteroError) return err.status === 0;
  if (isNetworkError(err)) return true;
  return err instanceof TypeError && /fetch|network|load failed/i.test(err.message);
}

type Media = Pick<MediaQueue, 'resolve' | 'thumbnail' | 'source' | 'pass'> & Partial<Pick<MediaQueue, 'viewUrl' | 'view'>>;
type Files = Pick<PageFiles, 'resolve'>;

export function createCarreteLoader({ media, files }: { media: Media; files: Files }): CarreteLoader {
  const previews = new Map<string, Promise<Preview>>();
  const fulls = new Map<string, Promise<Full>>();
  const sources = new Map<string, Promise<MediaSource>>();
  const created: string[] = [];
  let disposed = false;

  const sourceOf = (id: string) => {
    let pending = sources.get(id);
    if (!pending) {
      pending = media.source(id).catch((): MediaSource => ({ kind: null, name: '', original: null }));
      sources.set(id, pending);
      // Sin red y sin datos del archivo: se vuelve a preguntar la próxima vez.
      void pending.then((s) => {
        if (s.kind === null) sources.delete(id);
      });
    }
    return pending;
  };

  const loadPreview = async (item: CarreteItem): Promise<Preview> => {
    if (item.source === 'media' && item.mediaId) {
      const id = item.mediaId;
      const [source, thumb] = await Promise.all([sourceOf(id), media.thumbnail(id).catch(() => null)]);
      // Si la página ya tiene la imagen nítida (sharpImages.ts), esa; si no, la miniatura. Sin miniatura: lo que
      // muestra la página (un ícono con el nombre).
      // Sin el original en el dispositivo, la de 2048 guardada (la de "Available offline" o una ya hecha), sin bajar
      // nada: así sin red el carrete muestra en grande también las fotos que la página no llegó a procesar.
      const saved = source.kind === 'image' && !source.original ? ((await media.view?.(id).catch(() => null))?.url ?? null) : null;
      const preview = media.viewUrl?.(id) ?? saved ?? thumb ?? (await media.resolve(item.url).catch(() => null));
      return { kind: source.kind, name: source.name || fallbackName(item), preview };
    }
    if (item.source === 'file') {
      // La imagen entera, guardada en el dispositivo o bajada de Supabase.
      const preview = await files.resolve(item.url).catch(() => null);
      return { kind: 'image', name: fallbackName(item), preview };
    }
    return { kind: 'image', name: fallbackName(item), preview: item.url };
  };

  const loadFull = async (item: CarreteItem): Promise<Full> => {
    if (item.source === 'media' && item.mediaId) {
      const source = await sourceOf(item.mediaId);
      if (source.original) {
        const url = URL.createObjectURL(viewBlob(source));
        if (disposed) URL.revokeObjectURL(url);
        else created.push(url);
        return { url, local: true };
      }
      return { url: await passFor(media, item.mediaId), local: false, portero: true };
    }
    if (item.source === 'file') return { url: await files.resolve(item.url), local: true };
    return { url: item.url, local: item.url.startsWith('data:') };
  };

  const once = <T>(cache: Map<string, Promise<T>>, key: string, work: () => Promise<T>, keepErrors: boolean): Promise<T> => {
    let pending = cache.get(key);
    if (!pending) {
      pending = work();
      cache.set(key, pending);
      // Lo que falló se vuelve a intentar la próxima vez (por ejemplo, al volver la red).
      if (!keepErrors) pending.catch(() => cache.delete(key));
    }
    return pending;
  };

  return {
    preview: (item) => {
      const pending = once(previews, item.url, () => loadPreview(item), true);
      void pending.then((p) => {
        if (p.kind === null || p.preview === null) previews.delete(item.url);
      });
      return pending;
    },
    full: (item) => once(fulls, item.url, () => loadFull(item), false),
    retry(item) {
      fulls.delete(item.url);
      if (item.mediaId) forgetPass(media, item.mediaId);
    },
    dispose() {
      disposed = true;
      for (const url of created.splice(0)) URL.revokeObjectURL(url);
    },
  };
}
