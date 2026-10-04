// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { LinkContext } from '../linkMode';
import { addShape, PHOTO_MARKUP_MAP } from '../media/markup';
import { prepareMarkupRaster, type RasterResult } from '../media/markupRaster';
import { AnnotatedCopy } from './AnnotatedCopy';
import { canCopyImage, copyImage } from './clipboardImage';
import type { CarreteLoader } from './carreteLoader';
import { collectCarrete } from './carreteModel';
vi.mock('../media/markupRaster', async (actual) => ({ ...await actual<object>(), prepareMarkupRaster: vi.fn() }));
const id = '12345678-1234-1234-1234-123456789012';
const item = collectCarrete([{ id: 'a', type: 'image', props: { url: `sdmedia://${id}`, name: 'set.jpg' } }])[0];
const cleanups: (() => void)[] = [];
class ImageItem { constructor(readonly data: Record<string, Blob>) {} }
function pngResult(width = 400, height = 300) { const header = new Uint8Array(33); header.set([137,80,78,71,13,10,26,10]); header.set([73,72,68,82],12); const v = new DataView(header.buffer); v.setUint32(8,13); v.setUint32(16,width); v.setUint32(20,height); return new Blob([header], { type: 'image/png' }); }
afterEach(() => { for (const f of cleanups.splice(0)) f(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });
async function setup(presentation: 'menu' | 'body' = 'menu') {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('isSecureContext', true); vi.stubGlobal('ClipboardItem', ImageItem);
  const write = vi.fn<(items: ImageItem[]) => Promise<void>>(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } });
  cleanups.push(() => { delete (navigator as unknown as { clipboard?: unknown }).clipboard; });
  const doc = new Y.Doc(); addShape(doc, id, 'a', { type: 'arrow', startX: 0, startY: 0, endX: 100, endY: 100 }, { w: 200, h: 200 });
  const map = doc.getMap<unknown>(PHOTO_MARKUP_MAP), host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  let sourceCurrent = true;
  const annotatedOriginal = vi.fn(async () => ({ blob: new Blob(['source']), name: 'set.jpg', isCurrent: () => sourceCurrent }));
  const loader: CarreteLoader = { annotatedOriginal, preview: vi.fn(), full: vi.fn(), retry: vi.fn(), dispose: vi.fn() };
  const result = { blob: pngResult(), name: 'set_annotated.png', width: 400, height: 300 };
  vi.mocked(prepareMarkupRaster).mockResolvedValue(result);
  const render = async (link: unknown = null, chosen = item) => { await act(async () => root.render(<LinkContext.Provider value={link as never}><AnnotatedCopy item={chosen} loader={loader} map={map} original={<a href="blob:original">Original download</a>} presentation={presentation} /></LinkContext.Provider>)); };
  const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === text);
  const click = async (text: string) => { const b = button(text); expect(b).toBeDefined(); await act(async () => b!.click()); };
  cleanups.push(() => { act(() => root.unmount()); host.remove(); doc.destroy(); });
  await render(); return { doc, map, host, root, result, write, annotatedOriginal, button, click, render, change: () => sourceCurrent = false };
}
describe('copiar foto anotada: gesto, vigencia y resultado externo', () => {
  it('body no prepara al montar ni duplica Original/cierre/popover, y conserva el segundo gesto', async () => {
    const s = await setup('body'); expect(s.host.querySelector('.annotated-download-menu')).toBeNull(); expect(s.host.querySelector('a')).toBeNull(); expect(s.button('Close')).toBeUndefined();
    expect(s.annotatedOriginal).not.toHaveBeenCalled(); await s.click('Copy with annotations'); expect(s.write).not.toHaveBeenCalled();
    await s.click('Copy'); expect(s.write).toHaveBeenCalledOnce(); expect(s.host.textContent).toContain('Copied');
  });
  it('desmontar body aborta y descarta PNG tardío sin escribir', async () => {
    const s = await setup('body'); let deliver!: (v: RasterResult) => void;
    vi.mocked(prepareMarkupRaster).mockImplementation(() => new Promise((r) => deliver = r));
    await s.click('Copy with annotations'); const signal = vi.mocked(prepareMarkupRaster).mock.calls[0][4];
    await act(async () => s.root.render(null)); expect(signal.aborted).toBe(true);
    await act(async () => deliver(s.result)); expect(s.write).not.toHaveBeenCalled(); expect(s.host.textContent).toBe('');
  });
  it.each(['disguised', 'dimensions'])('negativa PNG %s rechaza antes de ready/write', async (invalid) => {
    const s = await setup(); vi.mocked(prepareMarkupRaster).mockResolvedValue({ ...s.result, blob: invalid === 'disguised' ? new Blob([new Uint8Array([255,216,255,224,...new Array(40).fill(0)])], { type: 'image/png' }) : pngResult(200,150) });
    await s.click('Copy with annotations'); expect(s.button('Copy')).toBeUndefined(); expect(s.host.textContent).toContain('PNG could not be prepared'); expect(s.write).not.toHaveBeenCalled();
  });
  it('preparar no escribe; segundo gesto escribe síncronamente PNG y no toca Yjs', async () => {
    const s = await setup(), before = Y.encodeStateAsUpdate(s.doc), updates = vi.fn(); s.doc.on('update', updates);
    await s.click('Copy with annotations'); expect(s.write).not.toHaveBeenCalled();
    expect(prepareMarkupRaster).toHaveBeenCalledWith(expect.any(Blob), 'set.jpg', expect.any(Object), false, expect.any(AbortSignal), 'png');
    let gesture = false; s.host.addEventListener('click', () => { gesture = true; queueMicrotask(() => gesture = false); }, { capture: true });
    s.write.mockImplementation(async (items) => { expect(gesture).toBe(true); expect(items[0].data['image/png']).toBe(s.result.blob); });
    await s.click('Copy'); expect(s.write).toHaveBeenCalledOnce(); expect(s.host.textContent).toContain('Copied'); expect(updates).not.toHaveBeenCalled(); expect(Y.encodeStateAsUpdate(s.doc)).toEqual(before);
  });
  it('negativa de la misma guarda: un await antes de write pierde el gesto controlado', async () => {
    const s = await setup(); let gesture = true; queueMicrotask(() => gesture = false);
    s.write.mockImplementation(async () => { if (!gesture) throw new DOMException('fuera del gesto', 'NotAllowedError'); });
    await Promise.resolve(); await expect(copyImage(s.result.blob)).rejects.toMatchObject({ name: 'NotAllowedError' });
  });
  it.each(['view', 'edit'])('Provider público real %s oculta acción y no pide fuente', async (level) => {
    const s = await setup(); await s.render({ level }); expect(s.host.textContent).toBe(''); expect(s.annotatedOriginal).not.toHaveBeenCalled(); expect(s.write).not.toHaveBeenCalled();
  });
  it.each(['secure', 'item', 'write', 'png'])('sin capacidad %s rechaza antes del original', async (missing) => {
    const s = await setup();
    if (missing === 'secure') vi.stubGlobal('isSecureContext', false);
    if (missing === 'item') vi.stubGlobal('ClipboardItem', undefined);
    if (missing === 'write') Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {} });
    if (missing === 'png') vi.stubGlobal('ClipboardItem', class extends ImageItem { static supports() { return false; } });
    await s.click('Copy with annotations'); expect(s.host.textContent).toContain('cannot copy images'); expect(s.host.querySelector('a')?.getAttribute('href')).toBe('blob:original'); expect(s.annotatedOriginal).not.toHaveBeenCalled(); expect(s.write).not.toHaveBeenCalled();
  });
  it('supports ausente no bloquea PNG; MIME JPEG y PNG vacío jamás llegan a write', async () => {
    const s = await setup(); expect(canCopyImage()).toBe(true);
    for (const b of [new Blob(['jpeg'], { type: 'image/jpeg' }), new Blob([], { type: 'image/png' })]) await expect(copyImage(b)).rejects.toBeDefined();
    expect(s.write).not.toHaveBeenCalled();
  });
  it.each(['shape', 'frame', 'replace', 'delete'])('cambio propio %s descarta ready antes del gesto', async (change) => {
    const s = await setup(); await s.click('Copy with annotations');
    await act(async () => { if (change === 'shape') (s.map.get(`${id}/a`) as Y.Map<unknown>).set('endX', 120); else if (change === 'frame') s.map.set(id, { v: 1, w: 250, h: 200 }); else if (change === 'replace') s.map.set(`${id}/a`, { type: 'future' }); else s.map.delete(`${id}/a`); });
    expect(s.button('Copy')).toBeUndefined(); expect(s.write).not.toHaveBeenCalled();
  });
  it('otra foto no invalida; rechazo de permiso mantiene PNG para otro gesto explícito', async () => {
    const s = await setup(); await s.click('Copy with annotations'); await act(async () => s.map.set('other/frame', { type: 'future' }));
    s.write.mockRejectedValueOnce(new DOMException('no', 'NotAllowedError')); await s.click('Copy'); expect(s.host.textContent).not.toContain('Copied'); expect(s.host.textContent).toContain('did not allow'); expect(s.write).toHaveBeenCalledOnce();
    await s.click('Copy'); expect(s.write).toHaveBeenCalledTimes(2); expect(s.host.textContent).toContain('Copied');
  });
  it.each(['source', 'context', 'photo', 'close'])('invalidación %s antes de Copy da cero writes', async (change) => {
    const s = await setup(); await s.click('Copy with annotations');
    if (change === 'source') { s.change(); await s.click('Copy'); }
    if (change === 'context') await s.render({ level: 'edit' });
    if (change === 'photo') await s.render(null, { ...item, url: 'sdmedia://other', mediaId: 'other' });
    if (change === 'close') await s.click('Close');
    expect(s.write).not.toHaveBeenCalled(); expect(s.host.textContent).not.toContain('Copied');
  });
  it.each(['close', 'shape', 'frame', 'context'])('cancelar %s durante preparación descarta PNG tardío', async (change) => {
    const s = await setup(); let deliver!: (v: RasterResult) => void; vi.mocked(prepareMarkupRaster).mockImplementation(() => new Promise((r) => deliver = r));
    await s.click('Copy with annotations'); const signal = vi.mocked(prepareMarkupRaster).mock.calls[0][4];
    if (change === 'close') await s.click('Close');
    if (change === 'context') await s.render({ level: 'view' });
    if (change === 'shape') await act(async () => (s.map.get(`${id}/a`) as Y.Map<unknown>).set('endX', 130));
    if (change === 'frame') await act(async () => s.map.set(id, { v: 1, w: 220, h: 200 }));
    expect(signal.aborted).toBe(true); await act(async () => deliver(s.result)); expect(s.button('Copy')).toBeUndefined(); expect(s.write).not.toHaveBeenCalled();
  });
  it.each(['resolve', 'reject'])('write %s tardío después de cerrar no revive UI ni reintenta', async (finish) => {
    const s = await setup(); let resolve!: () => void, reject!: () => void; s.write.mockImplementation(() => new Promise((yes, no) => { resolve = yes; reject = () => no(new Error('no')); }));
    await s.click('Copy with annotations'); await s.click('Copy'); expect(s.host.textContent).toContain('Copying'); expect(s.button('Copy')).toBeUndefined(); await s.click('Close');
    await act(async () => finish === 'resolve' ? resolve() : reject()); expect(s.host.querySelector('[role=group]')).toBeNull(); expect(s.host.textContent).not.toContain('Copied'); expect(s.write).toHaveBeenCalledOnce();
  });
  it('unknown-only rechaza completo antes del original y no fabrica foto limpia', async () => {
    const s = await setup(); await act(async () => { s.map.delete(`${id}/a`); s.map.set(`${id}/future`, { type: 'loupe' }); }); await s.click('Copy with annotations');
    expect(s.host.textContent).toContain('cannot include all'); expect(s.annotatedOriginal).not.toHaveBeenCalled(); expect(s.write).not.toHaveBeenCalled();
  });
});
