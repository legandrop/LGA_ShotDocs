// @vitest-environment jsdom
// La ventana de "Download all" (P.9) con *Retry missing*: el nombre de cada zip de reintento, el botón en memoria
// recién después de guardar, la carpeta que no se vuelve a pedir, el doble clic que no cancela y cancelar un
// reintento que vuelve al resultado de antes. Un portero y un Drive de mentira; los selectores de Chrome, a mano.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FolderListing } from '../media/portero';
import { ServicesContext, type Services } from '../services';
import { dirTarget, FolderDownloadDialog } from './FolderDownload';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FILES: Record<string, string> = { a: 'aaaa', b: 'bb', c: 'cccccc' };
const failing = new Set<string>();
/** Los archivos cuyo pedido queda colgado (hasta que se cancela). */
const hanging = new Set<string>();
const suggested: string[] = [];
let dirPicks = 0;
const roots: Root[] = [];

const lister = {
  async folderList(): Promise<FolderListing> {
    return {
      entries: Object.entries(FILES).map(([id, text]) => ({
        type: 'file' as const,
        id,
        name: `${id}.txt`,
        mime: 'text/plain',
        size: text.length,
        modified: null,
        url: `https://portero.test/m/${id}`,
        thumb: null,
      })),
      nextPageToken: null,
    };
  },
};

const status = { online: true };
const services = {
  media: { porteroClient: () => lister },
  engine: { subscribe: () => () => undefined, getStatus: () => status },
} as unknown as Services;

/** Una carpeta del disco en memoria (lo que da `showDirectoryPicker`). */
function memDir(name: string) {
  const files = new Map<string, string>();
  const dirs = new Map<string, ReturnType<typeof memDir>>();
  const removed: string[] = [];
  const handle = {
    name,
    files,
    removed,
    async getDirectoryHandle(n: string, opts?: { create?: boolean }) {
      if (!dirs.has(n)) {
        if (!opts?.create) throw new DOMException('no', 'NotFoundError');
        dirs.set(n, memDir(n));
      }
      return dirs.get(n)!;
    },
    async getFileHandle(n: string, opts?: { create?: boolean }) {
      if (!files.has(n)) {
        if (!opts?.create) throw new DOMException('no', 'NotFoundError');
        files.set(n, '');
      }
      return {
        name: n,
        async createWritable() {
          let text = '';
          return {
            write: async (c: Uint8Array) => void (text += new TextDecoder().decode(c)),
            close: async () => void files.set(n, text),
            abort: async () => undefined,
          };
        },
      };
    },
    async removeEntry(n: string) {
      removed.push(n);
      files.delete(n);
    },
  };
  return handle;
}

let picked: ReturnType<typeof memDir> | null = null;

beforeEach(() => {
  failing.clear();
  hanging.clear();
  suggested.length = 0;
  dirPicks = 0;
  picked = null;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (url.endsWith('/health')) return new Response('{}');
    const id = /\/m\/([^?]+)/.exec(url)?.[1] ?? '';
    if (hanging.has(id)) {
      return new Promise<Response>((_, fail) => init.signal?.addEventListener('abort', () => fail(new DOMException('aborted', 'AbortError'))));
    }
    if (failing.has(id)) return new Response('{"code":"drive_missing"}', { status: 404 });
    const body = new TextEncoder().encode(FILES[id]);
    return new Response(body, { headers: { 'Content-Length': String(body.length) } });
  });
  const w = window as unknown as Record<string, unknown>;
  w.showSaveFilePicker = async (opts: { suggestedName: string }) => {
    suggested.push(opts.suggestedName);
    return {
      name: opts.suggestedName,
      createWritable: async () => ({ write: async () => undefined, close: async () => undefined, abort: async () => undefined }),
      remove: async () => undefined,
    };
  };
  w.showDirectoryPicker = async () => {
    dirPicks++;
    picked = memDir('elegida');
    return picked;
  };
  URL.createObjectURL = () => 'blob:zz';
  URL.revokeObjectURL = () => undefined;
  HTMLAnchorElement.prototype.click = () => undefined;
});

afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  const w = window as unknown as Record<string, unknown>;
  delete w.showSaveFilePicker;
  delete w.showDirectoryPicker;
});

async function mount() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <ServicesContext.Provider value={services}>
        <FolderDownloadDialog fileId="carpeta-1" name="X" onClose={() => undefined} />
      </ServicesContext.Provider>,
    );
  });
  await until(() => /files in/.test(text()));
  return host;
}

const text = () => document.querySelector('.folder-download')?.textContent ?? '';

async function until(ok: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`no llegó: ${text()}`);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.folder-download button')].find((b) => b.textContent === label) ?? null;

async function click(label: string, detail = 1) {
  const b = button(label);
  if (!b) throw new Error(`sin botón ${label}: ${text()}`);
  await act(async () => {
    b.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }));
  });
}

describe('Download all: la ventana con Retry missing', () => {
  it('B1: cada zip de reintento lleva su número (el segundo no propone el nombre del primero)', async () => {
    failing.add('a').add('b');
    await mount();
    await click('Download as .zip…');
    await until(() => /Done: X\.zip is saved/.test(text()));
    failing.delete('a');
    await click('Retry missing');
    await until(() => /Done: X \(missing files\)\.zip is saved/.test(text()));
    expect(text()).toContain('1 item is not in the download');
    failing.clear();
    await click('Retry missing');
    await until(() => /Done: X \(missing files 2\)\.zip is saved/.test(text()));
    expect(suggested).toEqual(['X.zip', 'X (missing files).zip', 'X (missing files 2).zip']);
    expect(button('Retry missing')).toBeNull();
  });

  it('en memoria, Retry missing aparece recién después de guardar el zip', async () => {
    const w = window as unknown as Record<string, unknown>;
    delete w.showSaveFilePicker;
    delete w.showDirectoryPicker;
    failing.add('c');
    await mount();
    await click('Download as .zip');
    await until(() => /The zip is ready/.test(text()));
    expect(button('Retry missing')).toBeNull();
    await click('Save X.zip');
    expect(button('Retry missing')).not.toBeNull();
    failing.clear();
    await click('Retry missing');
    await until(() => button('Save X (missing files).zip') !== null);
  });

  it('a una carpeta: el reintento escribe en la misma, sin volver a pedirla', async () => {
    failing.add('b');
    await mount();
    await click('Download to a folder…');
    await until(() => /Done: the folder X/.test(text()));
    expect(dirPicks).toBe(1);
    const top = await picked!.getDirectoryHandle('X');
    expect(top.files.has('b.txt')).toBe(false);
    expect(top.files.has('MISSING_FILES.txt')).toBe(true);
    failing.clear();
    await click('Retry missing');
    await until(() => !/not in the download/.test(text()) && /Done:/.test(text()));
    expect(dirPicks).toBe(1);
    expect(top.files.get('b.txt')).toBe('bb');
    expect(top.files.has('MISSING_FILES.txt')).toBe(false);
  });

  it('el segundo clic de un doble clic no cancela; cancelar un reintento vuelve al resultado de antes, con su botón', async () => {
    failing.add('a');
    await mount();
    await click('Download as .zip…');
    await until(() => /Done: X\.zip is saved/.test(text()));
    failing.clear();
    hanging.add('a');
    await click('Retry missing');
    await until(() => button('Cancel') !== null && /of 1 files?/.test(text()));
    // El doble clic en "Retry missing": su segundo clic cae en "Cancel".
    await click('Cancel', 2);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(button('Cancel')).not.toBeNull();
    await click('Cancel');
    await until(() => /Retry cancelled/.test(text()));
    expect(text()).toContain('1 item is not in the download');
    expect(button('Retry missing')).not.toBeNull();
    // Y se puede volver a reintentar (el zip cancelado se borró: el número es el mismo).
    hanging.clear();
    await click('Retry missing');
    await until(() => /Done: X \(missing files\)\.zip is saved/.test(text()));
    expect(suggested).toEqual(['X.zip', 'X (missing files).zip', 'X (missing files).zip']);
  });

  it('a una carpeta, un archivo que falla no borra uno que ya estaba (lo trajo un reintento cancelado)', async () => {
    const top = memDir('X');
    top.files.set('viejo.txt', 'bueno');
    const target = dirTarget(top as never);
    if (target.kind !== 'dir') throw new Error('dir');
    const old = await target.makeFile('viejo.txt');
    await old.abort();
    expect(top.removed).toEqual([]);
    const fresh = await target.makeFile('nuevo.txt');
    await fresh.abort();
    expect(top.removed).toEqual(['nuevo.txt']);
  });
});
