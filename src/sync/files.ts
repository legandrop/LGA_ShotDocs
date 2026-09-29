import type { LocalDb } from './localDb';
import type { Remote } from './remote';
import { errorMessage, isPermanent } from './types';

/** Las imágenes se guardan en el documento con esta dirección, que no depende de ningún servidor. */
export const FILE_SCHEME = 'sdfile://';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

function extensionFor(file: { name?: string; type: string }): string {
  const known = EXTENSIONS[file.type];
  if (known) return known;
  const fromName = file.name?.match(/\.([a-z0-9]{1,8})$/i)?.[1];
  return fromName ? fromName.toLowerCase() : 'bin';
}

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
    const path = `${pageId}/${crypto.randomUUID()}.${extensionFor(file)}`;
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

  async pendingCount(): Promise<number> {
    return this.db.countFromIndex('files', 'uploaded', 0);
  }

  /** Sube las imágenes pendientes. Un error en una no frena a las demás; ninguna se descarta. */
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
        if (!isPermanent(err)) throw err;
      }
    }
    return lastError;
  }
}
