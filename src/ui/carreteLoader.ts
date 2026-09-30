import { PorteroError } from '../media/portero';
import type { MediaKind } from '../media/probe';
import type { MediaQueue, MediaSource } from '../media/queue';
import type { PageFiles } from '../sync/files';
import { isNetworkError } from '../sync/types';
import { fallbackName, type CarreteItem } from './carrete';

// De dónde saca el carrete lo que muestra (Docs/Doc_Carrete.md). Primero lo que ya está a mano (la
// miniatura, guardada en el dispositivo), después lo grande: la copia local si el archivo está en el
// dispositivo (anda sin red) o el archivo entero con un pase del portero. Lo que ya se pidió se guarda
// mientras el carrete está abierto, así ir y volver no pide dos veces.

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
}

export interface CarreteLoader {
  preview(item: CarreteItem): Promise<Preview>;
  /** La foto grande o el video. Tira si no se puede (sin red, sin portero, error del portero). */
  full(item: CarreteItem): Promise<Full>;
  /** Suelta lo creado para este carrete (las direcciones de los originales en memoria). */
  dispose(): void;
}

/** El error es por falta de red (o el navegador dice que no hay). */
export function isOffline(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (err instanceof PorteroError) return err.status === 0;
  if (isNetworkError(err)) return true;
  return err instanceof TypeError && /fetch|network|load failed/i.test(err.message);
}

type Media = Pick<MediaQueue, 'resolve' | 'thumbnail' | 'source' | 'pass'>;
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
      // Sin miniatura: lo que muestra la página (la foto local entera, o un ícono con el nombre).
      const preview = thumb ?? (await media.resolve(item.url).catch(() => null));
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
        const url = URL.createObjectURL(source.original);
        if (disposed) URL.revokeObjectURL(url);
        else created.push(url);
        return { url, local: true };
      }
      return { url: await media.pass(item.mediaId), local: false };
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
    dispose() {
      disposed = true;
      for (const url of created.splice(0)) URL.revokeObjectURL(url);
    },
  };
}
