// @vitest-environment jsdom
import { Component, act, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BlockNoteEditor } from '@blocknote/core';
import { BlockNoteView } from '@blocknote/mantine';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { ServicesContext } from '../services';
import { WorkspaceContext } from '../workspace';
import { LinkContext } from '../linkMode';
import { prefs } from '../prefs';
import { addShape, PHOTO_MARKUP_MAP } from '../media/markup';
import { PhotoAnnotatedSheet } from './PageEditor';
import { editorSchemaOptions } from './editorSchema';
import { collectCarrete } from './carreteModel';
import { startDownload, type CarreteLoader } from './carreteLoader';
vi.mock('./carreteLoader', async (actual) => ({ ...await actual<object>(), startDownload: vi.fn() }));
const cleanups: (() => void)[] = [];
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as never;
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
  Range.prototype.getClientRects ??= (() => []) as never;
  Range.prototype.getBoundingClientRect ??= (() => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })) as never;
  prefs.set({ language: 'en' });
});
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });
async function waitFor(predicate: () => boolean) {
  for (let n = 0; n < 100 && !predicate(); n++) await act(async () => { await new Promise((yes) => setTimeout(yes, 10)); });
  expect(predicate()).toBe(true);
}
async function setup(outside = false, isCurrent?: () => boolean, originalSource?: () => Promise<{ original: null; name: string }>) {
  const id = '12345678-1234-1234-1234-123456789012', doc = new Y.Doc();
  addShape(doc, id, 'arrow', { type: 'arrow', startX: 0, startY: 0, endX: 100, endY: 100 }, { w: 200, h: 200 });
  const map = doc.getMap(PHOTO_MARKUP_MAP), item = collectCarrete([{ id: 'photo', type: 'image', props: { url: `sdmedia://${id}`, name: 'set.jpg' } }])[0];
  const editor = BlockNoteEditor.create(editorSchemaOptions) as unknown as BlockNoteEditor, host = document.createElement('div'), trigger = document.createElement('button');
  trigger.textContent = 'Abrir'; document.body.append(trigger, host); const root = createRoot(host);
  const onClose = vi.fn(), errors: unknown[] = [];
  const annotatedOriginal = vi.fn<(chosen: typeof item, signal: AbortSignal, max: number) => Promise<never>>(() => new Promise(() => {}));
  const loader: CarreteLoader = { annotatedOriginal, preview: vi.fn(), full: vi.fn(), retry: vi.fn(), dispose: vi.fn() };
  const media = { source: vi.fn(originalSource ?? (async () => ({ original: null, name: 'source.jpg' }))), pass: vi.fn(async () => 'https://example.invalid/full') }, workspace = { id: 'isolated-test' };
  class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> { state = { failed: false }; static getDerivedStateFromError() { return { failed: true }; } componentDidCatch(error: unknown) { errors.push(error); } render() { return this.state.failed ? null : this.props.children; } }
  function Contents() {
    const [open, setOpen] = useState(true), sheet = open ? <PhotoAnnotatedSheet item={item} map={map} loader={loader} trigger={trigger} isCurrent={isCurrent} onClose={() => { onClose(); setOpen(false); }} /> : null;
    return <><BlockNoteView editor={editor} sideMenu={false} formattingToolbar={false} slashMenu={false}>{outside ? null : sheet}</BlockNoteView>{outside && sheet}</>;
  }
  await act(async () => root.render(<WorkspaceContext.Provider value={workspace as never}><ServicesContext.Provider value={{ media, workspace } as never}><LinkContext.Provider value={null}><Boundary><Contents /></Boundary></LinkContext.Provider></ServicesContext.Provider></WorkspaceContext.Provider>));
  cleanups.push(() => { act(() => root.unmount()); host.remove(); trigger.remove(); doc.destroy(); });
  return { loader, media, annotatedOriginal, map, trigger, onClose, errors };
}
describe('hoja anotada dentro de los providers reales del editor', () => {
  it('Original único conserva su provider/pase al cambiar rama; desmontar cancela y devuelve foco', async () => {
    const s = await setup(); await waitFor(() => !!document.querySelector('.photo-export-body'));
    const original = document.querySelector<HTMLButtonElement>('button[aria-label=Original]')!;
    expect(original).not.toBeNull(); expect(document.querySelectorAll('button[aria-label=Original]')).toHaveLength(1); expect(document.querySelector('.annotated-download-menu')).toBeNull();
    expect(s.annotatedOriginal).not.toHaveBeenCalled();
    await act(async () => original.click()); expect(startDownload).toHaveBeenCalledWith({ url: 'https://example.invalid/full', local: false, portero: true }, 'source.jpg');
    const click = async (text: string, selector: string) => { const button = [...document.querySelectorAll<HTMLButtonElement>(selector)].find((b) => b.textContent === text)!; expect(button).toBeDefined(); await act(async () => button.click()); };
    await click('With annotations', '.photo-export-body button'); const signal = s.annotatedOriginal.mock.calls[0][1];
    await click('Copy', '.photo-export-selector button'); expect(signal.aborted).toBe(true); expect(document.querySelector('button[aria-label=Original]')).toBe(original); expect(document.querySelectorAll('.photo-export-body')).toHaveLength(1);
    await click('Close', '.photo-export-sheet button'); expect(s.onClose).toHaveBeenCalledOnce(); expect(document.querySelector('.photo-export-sheet')).toBeNull(); expect(document.activeElement).toBe(s.trigger); expect(s.errors).toEqual([]);
  });
  it('negativa causal: montar el mismo portal como hermano de BlockNoteView pierde el provider', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = await setup(true); expect(s.errors).toHaveLength(1); expect(document.querySelector('button[aria-label=Original]')).toBeNull(); expect(startDownload).not.toHaveBeenCalled();
  });
  it.each(['Copy', 'Download'])('al preparar %s retira el control enfocado, conserva Escape y cancela una sola vez', async (action) => {
    vi.stubGlobal('isSecureContext', true); vi.stubGlobal('ClipboardItem', class {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: vi.fn() } });
    cleanups.push(() => { delete (navigator as unknown as { clipboard?: unknown }).clipboard; });
    const s = await setup(); await waitFor(() => !!document.querySelector('.photo-export-body'));
    if (action === 'Copy') await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.photo-export-selector button')].find((b) => b.textContent === 'Copy')!.click());
    const prepare = document.querySelector<HTMLButtonElement>('.photo-export-body button')!;
    prepare.focus(); expect(document.activeElement).toBe(prepare);
    await act(async () => prepare.click()); await waitFor(() => !!document.querySelector('[role=status]'));
    expect(prepare.isConnected && !prepare.disabled).toBe(false);
    expect(document.querySelector('.photo-export-sheet')!.contains(document.activeElement)).toBe(true);
    const signal = s.annotatedOriginal.mock.calls[0][1], aborted = vi.fn(); signal.addEventListener('abort', aborted);
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('.photo-export-sheet')).toBeNull(); expect(signal.aborted).toBe(true); expect(aborted).toHaveBeenCalledOnce();
    expect(s.onClose).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(s.trigger);
  });
  it('la transición de preparación no toma foco trasladado fuera de la hoja', async () => {
    const s = await setup(); await waitFor(() => !!document.querySelector('.photo-export-body'));
    const prepare = document.querySelector<HTMLButtonElement>('.photo-export-body button')!; prepare.focus();
    await act(async () => { prepare.click(); s.trigger.focus(); });
    expect(s.annotatedOriginal).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(s.trigger);
  });
  it('Original preparado no descarga si la identidad cambió antes del gesto', async () => {
    let current = true; const s = await setup(false, () => current);
    await waitFor(() => !!document.querySelector('button[aria-label=Original]')); current = false;
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label=Original]')!.click());
    expect(startDownload).not.toHaveBeenCalled(); expect(s.annotatedOriginal).not.toHaveBeenCalled();
  });
  it('Original pendiente vuelve a validar identidad al llegar el pase después del gesto', async () => {
    let current = true, deliver!: (value: { original: null; name: string }) => void;
    await setup(false, () => current, () => new Promise((yes) => { deliver = yes; }));
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label=Original]')!.click());
    current = false; await act(async () => deliver({ original: null, name: 'late.jpg' }));
    expect(startDownload).not.toHaveBeenCalled();
  });
});
