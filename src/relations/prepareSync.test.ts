// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import type * as Y from 'yjs';
import { ProjectIndex } from '../search/projectIndex';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { schema } from '../ui/editorSchema';
import { dayLive, linkTargetOf } from './dayLive';
import { buildProject } from './fixtures/proyectoSintetico';
import type { LiveSource } from './liveView';
import { prepareReport, undoPrepared } from './prepareDay';
import { RelationIndex } from './relationIndex';

// *Undo* y la limpieza de repetidos de *Prepare* de punta a punta (D436, D437): dos o tres dispositivos con el mismo
// servidor de prueba; lo que otro escribe mientras tanto llega a todos (R1 y R2 de la re-verificación).
const devices: Device[] = [];
afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.docs.dispose();
    d.db.close();
  }
});
let n = 0;
const fakePhoto = async () => `0000${String(++n).padStart(4, '0')}-bbbb-4bbb-8ccc-dddddddddddd`;
function editorOn(doc: Y.Doc, name: string): { e: BlockNoteEditor; done: () => void } {
  const e = BlockNoteEditor.create(withCollaboration({ schema, collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name, color: '#000' } } }) as never) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  e.mount(el);
  return { e, done: () => { e.unmount(); el.remove(); } };
}
function texts(doc: Y.Doc): string[] {
  const { e, done } = editorOn(doc, 'r');
  const out = e.document.map((b) => b.type + ':' + (Array.isArray(b.content) ? (b.content as { text?: string; content?: { text: string }[] }[]).map((c) => c.text ?? (c.content ?? []).map((x) => x.text).join('')).join('') : ''));
  done();
  return out;
}
async function world(A: Device) {
  const built = await buildProject(A, fakePhoto, { indexPage: false, days: true });
  await A.engine.syncNow();
  const index = new ProjectIndex(A.tree, A.docs);
  const rel = new RelationIndex(A.tree, index);
  await index.refresh(built.projectId);
  await rel.update(built.projectId);
  const src: LiveSource = { snap: rel.snapshot(built.projectId)!, title: (id) => A.tree.get(id)?.title, content: (id) => index.content(id) };
  const t = dayLive(src, built.ids.d59).tomorrow!;
  const linkTarget = linkTargetOf(src);
  const scenes = t.scenes.filter((x) => x.scenePageId).map((x) => ({ code: x.code, pageId: x.scenePageId! }));
  return { built, src, linkTarget, scenes };
}

describe('Prepare de punta a punta con dos dispositivos', () => {
  it('A prepara y sube; B baja y escribe en el renglón sin subir; A deshace; B sube: el texto de B queda', async () => {
    const server = new FakeServer();
    const A = await makeDevice(server);
    devices.push(A);
    const { built, src, linkTarget, scenes } = await world(A);
    const B = await makeDevice(server);
    devices.push(B);
    await B.engine.syncNow();
    const deps = { docs: A.docs, engine: A.engine };
    const res = await prepareReport(deps, built.ids.d60, { scenes, registry: src.snap.registry, linkTarget, word: 'Escena', level: 1 });
    if (res.status !== 'ok') throw new Error(res.status);
    await A.engine.syncNow();
    await B.engine.syncNow();
    const docB = await B.docs.open(built.ids.d60);
    const { e, done } = editorOn(docB, 'b');
    e.updateBlock(res.added[0].paragraphId, { content: 'Texto de B sin subir.' } as never);
    done();
    const undo = await undoPrepared(deps, built.ids.d60, res, linkTarget);
    expect(undo).toMatchObject({ titleOnly: true });
    await new Promise((r) => setTimeout(r, 50));
    await B.docs.flush(built.ids.d60);
    B.docs.close(built.ids.d60);
    await B.engine.syncNow();
    for (let k = 0; k < 3; k++) {
      await new Promise((r) => setTimeout(r, 100));
      await B.engine.syncNow();
      await A.engine.syncNow();
    }
    const C = await makeDevice(server);
    devices.push(C);
    await C.engine.syncNow();
    // En A, en B y en el servidor (un dispositivo nuevo), el texto de B sigue.
    for (const dev of [A, B, C]) expect((await textsOf(dev, built.ids.d60)).some((x) => x.includes('Texto de B sin subir.'))).toBe(true);
  });
  it('sin subir: Undo deja el reporte idéntico', async () => {
    const A = await makeDevice(new FakeServer());
    devices.push(A);
    const { built, src, linkTarget, scenes } = await world(A);
    const deps = { docs: A.docs, engine: A.engine };
    const d0 = await A.docs.open(built.ids.d60);
    const x0 = d0.getXmlFragment(CONTENT_FRAGMENT).toString();
    A.docs.close(built.ids.d60);
    const res = await prepareReport(deps, built.ids.d60, { scenes, registry: src.snap.registry, linkTarget, word: 'Escena', level: 1 });
    if (res.status !== 'ok') throw new Error(res.status);
    expect(await undoPrepared(deps, built.ids.d60, res, linkTarget)).toMatchObject({ titleOnly: false });
    const d1 = await A.docs.open(built.ids.d60);
    const x1 = d1.getXmlFragment(CONTENT_FRAGMENT).toString();
    expect(x1).toBe(x0);
  });
});

/** Escribe en un bloque del Día 60 en un dispositivo, sin subir. */
async function writeOn(dev: Device, pageId: string, blockId: string, text: string): Promise<void> {
  const doc = await dev.docs.open(pageId);
  const { e, done } = editorOn(doc, 'w');
  e.updateBlock(blockId, { content: text } as never);
  done();
  await dev.docs.flush(pageId);
  dev.docs.close(pageId);
}
async function textsOf(dev: Device, pageId: string): Promise<string[]> {
  const doc = await dev.docs.open(pageId);
  const out = texts(doc);
  dev.docs.close(pageId);
  return out;
}
const three = ['104_008', '104_009', '105_027'];

describe('tres secciones con el servidor de prueba: lo que B escribe bajo la primera, la del medio o la última llega a todos', () => {
  for (const k of [0, 1, 2]) {
    it(`Undo después de subir (solo títulos), B bajo la sección ${k + 1}`, async () => {
      const server = new FakeServer();
      const A = await makeDevice(server);
      devices.push(A);
      const { built, src, linkTarget } = await world(A);
      const scenes = three.map((code) => ({ code, pageId: src.snap.registry.scenes.get(code)!.pageId! }));
      const B = await makeDevice(server);
      devices.push(B);
      await B.engine.syncNow();
      const deps = { docs: A.docs, engine: A.engine };
      const res = await prepareReport(deps, built.ids.d60, { scenes, registry: src.snap.registry, linkTarget, word: 'Escena', level: 1 });
      if (res.status !== 'ok') throw new Error(res.status);
      await A.engine.syncNow();
      await B.engine.syncNow();
      await writeOn(B, built.ids.d60, res.added[k].paragraphId, `B bajo ${three[k]}.`);
      const undo = await undoPrepared(deps, built.ids.d60, res, linkTarget);
      expect(undo).toMatchObject({ removed: 3, titleOnly: true });
      await A.engine.syncNow();
      await B.engine.syncNow();
      await A.engine.syncNow();
      const C = await makeDevice(server);
      devices.push(C);
      await C.engine.syncNow();
      for (const dev of [A, B, C]) {
        const t = await textsOf(dev, built.ids.d60);
        expect(t).toContain(`paragraph:B bajo ${three[k]}.`);
        expect(t.filter((x) => x.startsWith('heading:Escena 10') && !x.includes('105_029'))).toEqual([]);
      }
    });
    it(`D436 de punta a punta: A y B preparan sin red, C escribe bajo el repetido ${k + 1} y A limpia`, async () => {
      const server = new FakeServer();
      const A = await makeDevice(server);
      devices.push(A);
      const { built, src, linkTarget } = await world(A);
      const scenes = three.map((code) => ({ code, pageId: src.snap.registry.scenes.get(code)!.pageId! }));
      const B = await makeDevice(server);
      devices.push(B);
      await B.engine.syncNow();
      const opts = { scenes, registry: src.snap.registry, linkTarget, word: 'Escena', level: 1 as const };
      // Los dos preparan sin haberse visto; después se juntan.
      const ra = await prepareReport({ docs: A.docs, engine: A.engine }, built.ids.d60, opts);
      const rb = await prepareReport({ docs: B.docs, engine: B.engine }, built.ids.d60, opts);
      if (ra.status !== 'ok' || rb.status !== 'ok') throw new Error('prepare');
      await A.engine.syncNow();
      await B.engine.syncNow();
      await A.engine.syncNow();
      const C = await makeDevice(server);
      devices.push(C);
      await C.engine.syncNow();
      // C escribe bajo el segundo título de esa escena (el que la limpieza saca), sin subir.
      const docC = await C.docs.open(built.ids.d60);
      const { e, done } = editorOn(docC, 'c');
      const blocks = e.document;
      const idx = blocks.map((x, i) => [x, i] as const).filter(([x]) => x.type === 'heading' && JSON.stringify(x.content).includes(three[k])).map(([, i]) => i);
      expect(idx).toHaveLength(2);
      e.updateBlock(blocks[idx[1] + 1].id, { content: `C bajo el repetido de ${three[k]}.` } as never);
      done();
      await C.docs.flush(built.ids.d60);
      C.docs.close(built.ids.d60);
      const again = await prepareReport({ docs: A.docs, engine: A.engine }, built.ids.d60, opts);
      expect(again.status === 'ok' && again.merged).toBe(3);
      await A.engine.syncNow();
      await C.engine.syncNow();
      await A.engine.syncNow();
      await B.engine.syncNow();
      for (const dev of [A, B, C]) {
        const t = await textsOf(dev, built.ids.d60);
        expect(t).toContain(`paragraph:C bajo el repetido de ${three[k]}.`);
        for (const code of three) expect(t.filter((x) => x === `heading:Escena ${code}`)).toHaveLength(1);
      }
    });
  }
});
