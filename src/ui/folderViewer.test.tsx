// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PorteroError, type FolderEntry, type FolderListing } from '../media/portero';
import { prefs } from '../prefs';
import { ServicesContext, type Services } from '../services';
import { FolderViewer } from './FolderViewer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const entries: FolderEntry[] = [
  { type: 'folder', id: 'day', name: 'Día 2', modified: null },
  { type: 'file', id: 'pdf', name: 'Plano.pdf', mime: 'application/pdf', size: 20, modified: null, url: 'https://portero.test/m/pdf?pass=p', thumb: null },
  { type: 'file', id: 'txt', name: 'Notas.txt', mime: 'text/plain', size: 4, modified: null, url: 'https://portero.test/m/txt?pass=t', thumb: null },
  { type: 'shortcut', name: 'Acceso', modified: null },
  { type: 'google', name: 'Guion', mime: 'application/vnd.google-apps.document', modified: null },
];
const lister = { folderList: vi.fn<(...args: [string, string | null, string | null]) => Promise<FolderListing>>() };
const status = { online: true };
const services = {
  media: { porteroClient: () => lister },
  engine: { subscribe: () => () => undefined, getStatus: () => status },
} as unknown as Services;
let root: Root | null;
const close = vi.fn();

beforeEach(() => {
  localStorage.clear();
  prefs.set({ language: 'en' });
  status.online = true;
  close.mockClear();
  lister.folderList.mockReset().mockResolvedValue({ entries, nextPageToken: 'next' });
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});
async function mount(fileId = 'folder') {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<ServicesContext.Provider value={services}><FolderViewer fileId={fileId} name="Referencias" onClose={close} /></ServicesContext.Provider>));
}
function button(name: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.getAttribute('aria-label') || b.textContent?.trim()) === name);
  expect(found, `botón ${name}`).toBeTruthy();
  return found!;
}
async function click(name: string) {
  await act(async () => button(name).dispatchEvent(new MouseEvent('click', { bubbles: true })));
}
const names = () => [...document.querySelectorAll('.folder-row-name')].map((e) => e.textContent);

describe('Visor de carpetas: List y Grid', () => {
  it('cambia sólo presentación y conserva entradas, orden y pedido', async () => {
    await mount();
    const before = names();
    await click('Grid');
    expect(button('Grid').getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.folder-grid')).toBeTruthy();
    expect(names()).toEqual(before);
    await click('List');
    expect(button('List').getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.folder-grid')).toBeNull();
    expect(names()).toEqual(before);
    expect(lister.folderList.mock.calls).toEqual([['folder', null, null]]);
  });

  it('mantiene la paginación y lo cargado tras un error y al alternar las vistas', async () => {
    await mount();
    await click('Grid');
    lister.folderList.mockRejectedValueOnce(new PorteroError('temporal', 503));
    await click('Show more');
    expect(names()).toEqual(entries.map((e) => e.name));
    await click('List');
    const extra: FolderEntry = { type: 'folder', id: 'more', name: 'Más', modified: null };
    lister.folderList.mockResolvedValueOnce({ entries: [extra], nextPageToken: null });
    await click('Show more');
    await click('Grid');
    expect(names()).toEqual([...entries.map((e) => e.name), 'Más']);
    expect(lister.folderList.mock.calls).toEqual([['folder', null, null], ['folder', null, 'next'], ['folder', null, 'next']]);
    expect(document.querySelector('.folder-viewer')?.textContent).not.toContain('Show more');
  });

  it('entra en una subcarpeta y vuelve por miga o Escape sin perder Grid ni ir arriba de la raíz', async () => {
    await mount();
    await click('Grid');
    lister.folderList.mockResolvedValueOnce({ entries: [], nextPageToken: null });
    await click('Día 2');
    expect(document.querySelector('.folder-grid')).toBeNull(); // Carpeta vacía, selector sigue activo.
    expect(button('Grid').getAttribute('aria-pressed')).toBe('true');
    await click('Referencias');
    await click('Día 2');
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(document.querySelector('.folder-grid')).toBeTruthy();
    expect(lister.folderList.mock.calls.map((c) => c.slice(0, 2))).toEqual([
      ['folder', null], ['folder', 'day'], ['folder', null], ['folder', 'day'], ['folder', null],
    ]);
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(close).toHaveBeenCalledOnce();
    expect(lister.folderList).toHaveBeenCalledTimes(5);
  });

  it('recuerda sólo el modo al reabrir otra carpeta; valores desconocidos abren List', async () => {
    await mount();
    await click('Grid');
    expect(localStorage.getItem('shotdocs.folderView')).toBe('grid');
    act(() => root!.unmount());
    await mount('other');
    expect(button('Grid').getAttribute('aria-pressed')).toBe('true');
    await click('List');
    act(() => root!.unmount());
    await mount();
    expect(button('List').getAttribute('aria-pressed')).toBe('true');
    act(() => root!.unmount());
    localStorage.setItem('shotdocs.folderView', 'future');
    await mount();
    expect(button('List').getAttribute('aria-pressed')).toBe('true');
  });

  it('con storage bloqueado abre List y Grid funciona durante el visor', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('bloqueado', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('bloqueado', 'SecurityError'); });
    await mount();
    expect(button('List').getAttribute('aria-pressed')).toBe('true');
    await click('Grid');
    expect(document.querySelector('.folder-grid')).toBeTruthy();
    await click('List');
    expect(names()).toEqual(entries.map((e) => e.name));
    expect(lister.folderList).toHaveBeenCalledOnce();
  });

  it('Download usa el pase intacto, abrir PDF mantiene su acción y las entradas inactivas no actúan', async () => {
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.href); });
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null);
    await mount();
    await click('Download Notas.txt');
    await click('Grid');
    await click('Download Notas.txt');
    expect(downloads).toEqual(['https://portero.test/m/txt?pass=t&download=1', 'https://portero.test/m/txt?pass=t&download=1']);
    const pdf = document.querySelector<HTMLButtonElement>('.folder-row-file .folder-row-main')!;
    await act(async () => pdf.click());
    expect(opened).toHaveBeenCalledWith('https://portero.test/m/pdf?pass=p', '_blank', 'noopener');
    for (const off of document.querySelectorAll<HTMLElement>('.folder-row-off')) {
      expect(off.querySelector('button,a')).toBeNull();
      await act(async () => off.click());
    }
    expect(downloads).toHaveLength(2);
    expect(opened).toHaveBeenCalledOnce();
    expect(lister.folderList).toHaveBeenCalledOnce();
  });

  it('vacío y sin red conservan sus avisos; Grid no inventa un listado guardado', async () => {
    lister.folderList.mockResolvedValueOnce({ entries: [], nextPageToken: null });
    await mount();
    await click('Grid');
    expect(document.querySelector('.folder-viewer')?.textContent).toContain('This folder is empty.');
    act(() => root!.unmount());
    status.online = false;
    lister.folderList.mockRejectedValueOnce(new PorteroError('sin red', 0));
    await mount();
    expect(button('Grid').getAttribute('aria-pressed')).toBe('true');
    expect(names()).toEqual([]);
    expect(button('Download all').getAttribute('aria-disabled')).toBe('true');
    expect(document.querySelector('.folder-viewer')?.textContent).toContain('connection');
    expect(lister.folderList).toHaveBeenCalledTimes(2);
  });
});
