// Copia de la versión publicada v0.090 (commit ca593e7) de src/sync/files.ts, para probar que lo que esa versión
// deja en el dispositivo (por ejemplo, después de semanas sin red) lo lee y lo sube la versión actual sin perder
// nada (src/sync/offlineLargo.test.ts). No se toca, salvo los caminos de los imports.
import { t } from '../../../i18n';
import type { LocalDb } from './localDb';
import type { Remote } from '../../remote';
import { errorMessage, isNetworkError } from '../../types';

/** Las imágenes se guardan en el documento con esta dirección, que no depende de ningún servidor. */
export const FILE_SCHEME = 'sdfile://';

/** Los mismos tipos que acepta el bucket (ver supabase/migrations). Sin SVG: puede traer scripts. */
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

export function isAllowedImage(type: string): boolean {
  return type in EXTENSIONS;
}

/** El tope del bucket. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** El archivo no se puede guardar: el mensaje se muestra tal cual. */
export class FileRejected extends Error {}

/**
 * Imágenes pegadas en las páginas. Se guardan primero en el dispositivo y se suben después, igual que
 * el texto. Para mostrarlas se usa la copia local; si no está, se baja del servidor y se guarda.
 */
export class PageFiles {
  private readonly objectUrls = new Map<string, string>();
  private readonly downloads = new Map<string, Promise<string>>();

  onQueued?: () => void;

  constructor(
    private readonly db: LocalDb,
    private readonly remote: Remote,
  ) {}

  async add(pageId: string, file: Blob & { name?: string }): Promise<string> {
    const extension = EXTENSIONS[file.type];
    if (!extension) {
      throw new FileRejected(t('files.onlyImages'));
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new FileRejected(t('files.tooBig', { mb: (file.size / 1024 / 1024).toFixed(0) }));
    }
    const path = `${pageId}/${crypto.randomUUID()}.${extension}`;
    await this.db.put('files', {
      path,
      pageId,
      mime: file.type || 'application/octet-stream',
      data: await file.arrayBuffer(),
      uploaded: 0,
      createdAt: Date.now(),
    });
    this.onQueued?.();
    return FILE_SCHEME + path;
  }

  /** Convierte la dirección guardada en el documento en una que el navegador pueda mostrar. */
  resolve(url: string): Promise<string> {
    if (!url.startsWith(FILE_SCHEME)) return Promise.resolve(url);
    const path = url.slice(FILE_SCHEME.length);
    const cached = this.objectUrls.get(path);
    if (cached) return Promise.resolve(cached);
    let pending = this.downloads.get(path);
    if (!pending) {
      pending = this.load(path).finally(() => this.downloads.delete(path));
      this.downloads.set(path, pending);
    }
    return pending;
  }

  private async load(path: string): Promise<string> {
    let record = await this.db.get('files', path);
    if (!record) {
      const blob = await this.remote.downloadFile(path);
      record = {
        path,
        pageId: path.split('/')[0],
        mime: blob.type,
        data: await blob.arrayBuffer(),
        uploaded: 1,
        createdAt: Date.now(),
      };
      await this.db.put('files', record);
    }
    const objectUrl = URL.createObjectURL(new Blob([record.data], { type: record.mime }));
    this.objectUrls.set(path, objectUrl);
    return objectUrl;
  }

  /**
   * Que la imagen quede en el dispositivo sin mostrarla (para "Available offline", Docs/Doc_Copias_Locales.md):
   * si ya está, no baja nada. Devuelve si quedó.
   */
  async ensureStored(url: string): Promise<boolean> {
    if (!url.startsWith(FILE_SCHEME)) return false;
    const path = url.slice(FILE_SCHEME.length);
    if (await this.db.get('files', path)) return true;
    const blob = await this.remote.downloadFile(path);
    if (await this.db.get('files', path)) return true;
    await this.db.put('files', { path, pageId: path.split('/')[0], mime: blob.type, data: await blob.arrayBuffer(), uploaded: 1, createdAt: Date.now() });
    return true;
  }

  /** La imagen vieja ya está en el dispositivo. */
  async isStored(url: string): Promise<boolean> {
    return url.startsWith(FILE_SCHEME) && !!(await this.db.get('files', url.slice(FILE_SCHEME.length)));
  }

  /**
   * La base se restauró desde una copia de seguridad: las imágenes subidas después de esa copia ya no
   * figuran en el servidor. Todas las que están en el dispositivo vuelven a la cola; las que el servidor
   * todavía tiene se dan por subidas sin volver a mandarlas.
   */
  async resetForRestore(): Promise<number> {
    // De a una, con un cursor: puede haber muchas y pesadas.
    const tx = this.db.transaction('files', 'readwrite');
    let count = 0;
    for (let cursor = await tx.store.index('uploaded').openCursor(1); cursor; cursor = await cursor.continue()) {
      await cursor.update({ ...cursor.value, uploaded: 0 });
      count++;
    }
    await tx.done;
    return count;
  }

  /** Las páginas de las imágenes todavía sin subir, una por imagen (P.14). */
  async pendingPageIds(): Promise<string[]> {
    return (await this.db.getAllFromIndex('files', 'uploaded', 0)).map((f) => f.pageId);
  }

  async pendingCount(): Promise<number> {
    return this.db.countFromIndex('files', 'uploaded', 0);
  }

  /**
   * Sube las imágenes pendientes. Nunca tira: un error en una no frena a las demás ni al resto de la
   * sincronización, y ninguna se descarta. Devuelve el último error, si hubo.
   */
  async pushPending(skipPage: (pageId: string) => boolean): Promise<string | null> {
    const pending = await this.db.getAllFromIndex('files', 'uploaded', 0);
    let lastError: string | null = null;
    for (const file of pending) {
      if (skipPage(file.pageId)) continue;
      try {
        await this.remote.uploadFile(file.path, file.data, file.mime);
        await this.db.put('files', { ...file, uploaded: 1, lastError: undefined });
      } catch (err) {
        lastError = errorMessage(err);
        await this.db.put('files', { ...file, lastError });
        if (isNetworkError(err)) break;
      }
    }
    return lastError;
  }
}
