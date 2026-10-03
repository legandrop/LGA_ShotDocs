// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { block, group } from '../sync/historyTesting';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { ExportEditor } from './exportEditor';
import { exportPlan, renderPages } from './exportPages';

// Exportar una rama con una página que hace tirar al editor (las filas hostiles de la auditoría del link *Can edit*,
// B3; la barrera de la página es ErrorBarrier.tsx). El editor de exportación vive en su propia raíz de React, fuera de
// la app: no la deja en blanco. Acá, que esa página se saltea con su motivo y las demás salen igual, también la de
// después (el editor de exportación sigue sano).

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as never;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

const devices: Device[] = [];
const editors: ExportEditor[] = [];
afterEach(async () => {
  for (const e of editors.splice(0)) e.destroy();
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const HOSTILE: Record<string, (v: Y.Doc) => void> = {
  mapEnElParrafo: (v) => ((group(v).get(0) as Y.XmlElement).get(0) as Y.XmlElement).insert(0, [new Y.Map() as never]),
  nivelObjeto: (v) => ((group(v).get(1) as Y.XmlElement).get(0) as Y.XmlElement).setAttribute('level', { x: 1 } as never),
  nivelTexto: (v) => ((group(v).get(1) as Y.XmlElement).get(0) as Y.XmlElement).setAttribute('level', 'x y' as never),
};

async function write(d: Device, pageId: string, fn: (doc: Y.Doc) => void) {
  const doc = await d.docs.open(pageId);
  doc.transact(() => fn(doc), 'test');
  await d.docs.flush(pageId);
  d.docs.close(pageId);
}

describe('exportar con una página rota', () => {
  for (const [name, hostile] of Object.entries(HOSTILE)) {
    it(`${name}: la página rota se saltea con su motivo y las demás salen`, async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const d = await makeDevice(new FakeServer());
      devices.push(d);
      const root = await d.tree.create(null, 'Raíz');
      const ids = [await d.tree.create(root, 'Antes'), await d.tree.create(root, 'Rota'), await d.tree.create(root, 'Después')];
      for (const [i, id] of ids.entries()) {
        await write(d, id, (doc) => group(doc).push([block(`a${i}`, `texto ${i}`), block(`h${i}`, `título ${i}`, 'heading', { level: '2' })]));
      }
      await write(d, ids[1], hostile);
      const e = await ExportEditor.create({ imageTimeoutMs: 0, copyTimeoutMs: 0 });
      editors.push(e);
      const plan = exportPlan(d.tree, 'page', root);
      const html = new Map<string, string>();
      const out = await renderPages(plan, d.docs, e, {
        onPage: (page) => {
          html.set(page.pageId, page.view.root.textContent ?? '');
          page.view.root.remove();
        },
      });
      const byId = new Map(out.map((p) => [p.id, p]));
      expect(byId.get(ids[1])?.failed).toBeTruthy();
      expect(byId.get(ids[0])?.failed).toBeUndefined();
      expect(byId.get(ids[2])?.failed).toBeUndefined();
      expect(html.get(ids[0])).toContain('texto 0');
      expect(html.get(ids[2])).toContain('texto 2');
      expect(html.get(ids[2])).toContain('título 2');
    });
  }
});
