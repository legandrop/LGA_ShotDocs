// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { schema as previousSchema } from './fixtures/editorSchemaAnterior';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { LinkContext } from '../linkMode';
import { addShape, PHOTO_MARKUP_MAP } from '../media/markup';
import { prepareMarkupRaster } from '../media/markupRaster';
import { AnnotatedDownload } from './AnnotatedDownload';
import { startDownload, type CarreteLoader } from './carreteLoader';
import { collectCarrete } from './carreteModel';
vi.mock('../media/markupRaster', async (actual) => ({ ...await actual<object>(), prepareMarkupRaster: vi.fn() }));
vi.mock('./carreteLoader', async (actual) => ({ ...await actual<object>(), startDownload: vi.fn() }));
const id = '12345678-1234-1234-1234-123456789012';
const item = collectCarrete([{ id: 'a', type: 'image', props: { url: `sdmedia://${id}`, name: 'set.jpg' } }])[0];
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.clearAllMocks(); });
async function setup(presentation: 'menu' | 'body' = 'menu') {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const doc = new Y.Doc(); addShape(doc, id, 'arrow', { type: 'arrow', startX: 0, startY: 0, endX: 100, endY: 100 }, { w: 200, h: 200 });
  const map = doc.getMap<unknown>(PHOTO_MARKUP_MAP), host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  let current = true;
  const annotatedOriginal = vi.fn(async () => ({ blob: new Blob(['original']), name: 'set.jpg', isCurrent: () => current }));
  const loader: CarreteLoader = { annotatedOriginal, preview: vi.fn(), full: vi.fn(), retry: vi.fn(), dispose: vi.fn() };
  const result = { blob: new Blob(['output']), name: 'set_annotated.jpg', width: 400, height: 300 };
  vi.mocked(prepareMarkupRaster).mockResolvedValue(result);
  const onDone = vi.fn();
  const render = async (link: unknown = null, chosen = item) => { await act(async () => root.render(<LinkContext.Provider value={link as never}><AnnotatedDownload item={chosen} loader={loader} map={map} original={<a href="blob:original">Original download</a>} presentation={presentation} onDone={onDone} /></LinkContext.Provider>)); };
  const click = async (text: string) => { const button = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text)); expect(button).toBeDefined(); await act(async () => button!.click()); };
  cleanups.push(() => { act(() => root.unmount()); host.remove(); doc.destroy(); });
  await render(); return { host, root, map, doc, loader, annotatedOriginal, result, click, render, onDone, change: () => current = false };
}
describe('descargar una foto anotada en el carrete', () => {
  it('body prepara explícitamente sin otro menú, Original ni cierre; el gesto final avisa después de descargar', async () => {
    const s = await setup('body');
    expect(s.host.querySelector('.annotated-download-menu')).toBeNull(); expect(s.host.querySelector('a')).toBeNull(); expect(s.host.textContent).not.toContain('Close');
    expect(s.annotatedOriginal).not.toHaveBeenCalled(); expect(s.onDone).not.toHaveBeenCalled();
    await s.click('With annotations'); expect(startDownload).not.toHaveBeenCalled();
    await s.click('Download'); expect(startDownload).toHaveBeenCalledWith(s.result.blob, s.result.name); expect(s.onDone).toHaveBeenCalledOnce();
    expect(vi.mocked(startDownload).mock.invocationCallOrder[0]).toBeLessThan(s.onDone.mock.invocationCallOrder[0]);
  });
  it('desmontar body aborta una preparación y no notifica salida tardía', async () => {
    const s = await setup('body'); let deliver!: (v: typeof s.result) => void;
    vi.mocked(prepareMarkupRaster).mockImplementation(() => new Promise((r) => deliver = r));
    await s.click('With annotations'); const signal = vi.mocked(prepareMarkupRaster).mock.calls[0][4];
    await act(async () => s.root.render(null)); expect(signal.aborted).toBe(true);
    await act(async () => deliver(s.result)); expect(startDownload).not.toHaveBeenCalled(); expect(s.onDone).not.toHaveBeenCalled();
  });
  it('body en un link no duplica el fallback Original que pertenece a la hoja', async () => {
    const s = await setup('body'); await s.render({ level: 'edit' }); expect(s.host.textContent).toBe(''); expect(s.annotatedOriginal).not.toHaveBeenCalled();
  });
  it('editor con esquema anterior conserva el mapa antes y después de la descarga', async () => {
    const s = await setup(); const oldHost = document.createElement('div'); document.body.append(oldHost);
    const old = BlockNoteEditor.create(withCollaboration({ schema: previousSchema, collaboration: { fragment: s.doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000000' } } }));
    old.mount(oldHost); cleanups.unshift(() => { old.unmount(); oldHost.remove(); });
    const before = JSON.stringify(s.map.toJSON());
    await s.click('Download'); await s.click('With annotations');
    expect(JSON.stringify(s.map.toJSON())).toBe(before); expect(old.document.length).toBeGreaterThan(0);
  });
  it('lector normal: prepara snapshot, espera segundo clic y nunca escribe mapa', async () => {
    const s = await setup(), before = Y.encodeStateAsUpdate(s.doc), updates = vi.fn(); s.doc.on('update', updates);
    await s.click('Download'); await s.click('With annotations');
    expect(s.host.textContent).toContain('400 × 300'); expect(startDownload).not.toHaveBeenCalled();
    expect(prepareMarkupRaster).toHaveBeenCalledWith(expect.any(Blob), 'set.jpg', expect.objectContaining({ shapes: expect.any(Array) }), false, expect.any(AbortSignal));
    const final = [...s.host.querySelectorAll('button')].find((b) => b.textContent === 'Download')!; await act(async () => final.click());
    expect(startDownload).toHaveBeenCalledWith(s.result.blob, s.result.name); expect(updates).not.toHaveBeenCalled(); expect(Y.encodeStateAsUpdate(s.doc)).toEqual(before);
  });
  it.each(['view', 'edit'])('LinkContext real %s excluye fuente y preparación, conserva original', async (level) => {
    const s = await setup(); await s.render({ level }); expect(s.host.textContent).toBe('Original download'); expect(s.annotatedOriginal).not.toHaveBeenCalled();
  });
  it('cambio a link público oculta resultado ya listo y no descarga', async () => {
    const s = await setup(); await s.click('Download'); await s.click('With annotations'); await s.render({ level: 'edit' });
    expect(s.host.textContent).toBe('Original download'); expect(startDownload).not.toHaveBeenCalled();
  });
  it('cambiar/cerrar durante preparación aborta y descarta llegada tardía', async () => {
    const s = await setup(); let deliver!: (v: typeof s.result) => void;
    vi.mocked(prepareMarkupRaster).mockImplementation(() => new Promise((r) => deliver = r));
    await s.click('Download'); await s.click('With annotations'); const signal = vi.mocked(prepareMarkupRaster).mock.calls[0][4];
    await s.render(null, { ...item, url: 'sdmedia://other', mediaId: 'other' }); expect(signal.aborted).toBe(true);
    await act(async () => deliver(s.result)); expect(s.host.textContent).not.toContain('set_annotated'); expect(startDownload).not.toHaveBeenCalled();
  });
  it('fuente modificada después de preparar no se descarga', async () => {
    const s = await setup(); await s.click('Download'); await s.click('With annotations'); s.change();
    await act(async () => [...s.host.querySelectorAll('button')].find((b) => b.textContent === 'Download')!.click());
    expect(startDownload).not.toHaveBeenCalled(); expect(s.host.querySelector('[role=alert]')).not.toBeNull(); expect(s.host.querySelector('a')?.getAttribute('href')).toBe('blob:original');
  });
  it('todas desconocidas no aparecen como foto limpia ni habilitan composición', async () => {
    const s = await setup(); await act(async () => { s.map.delete(`${id}/arrow`); s.map.set(`${id}/future`, { type: 'loupe' }); }); await s.click('Download');
    expect([...s.host.querySelectorAll('button')].find((b) => b.textContent === 'With annotations')?.disabled).toBe(true); expect(s.annotatedOriginal).not.toHaveBeenCalled(); expect(s.host.textContent).toContain('cannot all be included');
  });
});
