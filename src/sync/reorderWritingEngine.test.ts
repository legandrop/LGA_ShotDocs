// @vitest-environment jsdom
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { installBlockReorder } from '../ui/blockReorder';
import { collapseExtension } from '../ui/collapseEditor';
import { caretAt, editors, posOf, press, showsDoc, tick, typeAt, unmountAll, view } from '../ui/collabHarness';
import { schema } from '../ui/editorSchema';
import { CONTENT_FRAGMENT } from './structure';
import { ownClientRange } from './removedWriting';
import { FakeServer, makeDevice, type Device } from './testing';

const devices: Device[] = [];
async function device(server: FakeServer, name?: string) {
  const d = await makeDevice(server, name);
  devices.push(d);
  return d;
}
afterEach(async () => {
  unmountAll();
  for (const d of devices.splice(0)) {
    d.engine.stop();
    await d.docs.flush();
    d.docs.dispose();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
});

function mount(doc: Y.Doc) {
  const editor = BlockNoteEditor.create(withCollaboration({
    schema,
    collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
    extensions: [collapseExtension({})],
  })) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  editor.mount(el);
  editors.push(editor);
  installBlockReorder(view(editor));
  return editor;
}

async function scenario(nested = false) {
  const server = new FakeServer();
  const a = await device(server);
  const b = await device(server);
  const page = await a.tree.create(null, 'Concurrent writing and moving');
  const docA = await a.docs.open(page);
  const A = mount(docA);
  A.replaceBlocks(A.document, ['alpha', 'bravo', 'charlie', 'delta', 'echo'].map((word, i) => ({
    id: `b${i}`, type: 'paragraph', content: word,
    ...(nested && i === 1 ? { children: [{ id: 'c1', type: 'paragraph', content: 'kid' }] } : {}),
  })) as PartialBlock[] as never);
  await a.docs.flush(page);
  await a.engine.syncNow();
  await b.engine.syncNow();
  const docB = await b.docs.open(page);
  const B = mount(docB);
  await tick();
  return { server, a, b, page, A, B, docA, docB };
}

function keyboard(B: BlockNoteEditor) {
  caretAt(B, 'b2', 'end');
  press(B, 'ArrowUp', { ctrlKey: true, shiftKey: true });
}
function drag(B: BlockNoteEditor) {
  // La transacción que ProseMirror entrega al soltar el arrastre; el gesto de los puntos se prueba en navegador.
  const v = view(B);
  const from = posOf(B, 'b3');
  const node = v.state.doc.nodeAt(from)!;
  const target = posOf(B, 'b0');
  const tr = v.state.tr.delete(from, from + node.nodeSize);
  v.dispatch(tr.insert(tr.mapping.map(target), node));
}

describe('E20: el aviso llega por applyRemote, inspectRemovedWriting y el registro persistente', () => {
  for (const [name, move, recreatedId] of [['teclado', keyboard, 'b1'], ['arrastre', drag, 'b3']] as const) {
    it(`${name}: ZZZ capturado por el motor de quien sigue en la sesión`, async () => {
      const { a, b, page, A, B, docB } = await scenario();
      // B conserva la base, sin bajar ZZZ: ambos cambios son concurrentes.
      move(B);
      typeAt(A, recreatedId, 'start', 'ZZZ');
      await a.docs.flush(page);
      await a.docs.pushPage(page, a.remote);
      expect(await a.docs.unsyncedPages()).toEqual([]);
      expect((await a.db.getAllKeys('meta', ownClientRange(page))).length).toBeGreaterThan(0);
      let heard = 0;
      a.docs.subscribeRemovedWriting(() => heard++);
      await b.docs.flush(page);
      await b.docs.pushPage(page, b.remote);
      await a.docs.pullPage(page, a.remote);
      expect((await a.docs.removedWriting(page)).map((n) => n.text)).toEqual(['ZZZ']);
      expect(heard).toBe(1);
      const finalA = await a.docs.open(page);
      expect(finalA.getXmlFragment(CONTENT_FRAGMENT).toString()).not.toContain('ZZZ');
      await b.docs.pullPage(page, b.remote);
      expect(docB.getXmlFragment(CONTENT_FRAGMENT).toString()).toBe(finalA.getXmlFragment(CONTENT_FRAGMENT).toString());
      expect(showsDoc(B, docB)).toBe(true);
      expect(showsDoc(A, finalA)).toBe(true);
    });
  }

  it('D725: el bloque movido dentro de un padre borrado avisa a quien lo mueve', async () => {
    const { a, b, page, A, B } = await scenario(true);
    keyboard(B);
    A.removeBlocks(['b1']);
    await a.docs.flush(page);
    await a.docs.pushPage(page, a.remote);
    await b.docs.flush(page);
    await b.docs.pullPage(page, b.remote);
    const notices = await b.docs.removedWriting(page);
    expect(notices.map((n) => n.text).join('\n')).toContain('charlie');
  });
});
