// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, expect, it } from 'vitest';
import type * as Y from 'yjs';
import { CONTENT_FRAGMENT } from './structure';
import { FakeServer, makeDevice, type Device } from './testing';

// Con el editor real: dos dispositivos que empiezan la misma página sin haberse visto no pueden perder el
// contenido de ninguno al fusionarse (auditoría de la fase 1, B1).

const devices: Device[] = [];
const editors: BlockNoteEditor[] = [];

afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
  }
});

async function device(server: FakeServer): Promise<Device> {
  const d = await makeDevice(server);
  devices.push(d);
  return d;
}

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function mountEditor(doc: Y.Doc): BlockNoteEditor {
  const editor = BlockNoteEditor.create(
    withCollaboration({
      collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
    }),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  editor.mount(el);
  editors.push(editor);
  return editor;
}

const texts = (e: BlockNoteEditor) =>
  e.document.map((b) => (b.content as { text?: string }[] | undefined)?.map((c) => c.text).join('') ?? '');

it('dos dispositivos que empiezan la misma página sin verse no pierden nada al fusionarse', async () => {
  const server = new FakeServer();
  const a = await device(server);
  const b = await device(server);

  const pageId = await a.tree.create(null, 'Escena');
  await a.engine.syncNow();
  await b.engine.syncNow();

  // Los dos abren la página vacía y escriben sin haber visto lo del otro.
  const editorA = mountEditor(await a.docs.open(pageId));
  const editorB = mountEditor(await b.docs.open(pageId));
  await tick();
  editorA.replaceBlocks(editorA.document, [
    { type: 'paragraph', content: 'Línea 1 de A' },
    { type: 'paragraph', content: 'Línea 2 de A' },
  ]);
  editorB.replaceBlocks(editorB.document, [{ type: 'paragraph', content: 'Escrito en B sin red' }]);
  await tick();
  await a.docs.flush(pageId);
  await b.docs.flush(pageId);

  // Sincronizan en los dos sentidos, con los editores abiertos.
  await a.engine.syncNow();
  await b.engine.syncNow();
  await a.engine.syncNow();
  await tick(100);
  await b.engine.syncNow();
  await a.engine.syncNow();
  await tick(100);

  for (const editor of [editorA, editorB]) {
    const shown = texts(editor);
    expect(shown).toContain('Línea 1 de A');
    expect(shown).toContain('Línea 2 de A');
    expect(shown).toContain('Escrito en B sin red');
  }

  // Un tercer dispositivo abre la página fusionada y edita: no se borra nada.
  const c = await device(server);
  await c.engine.syncNow();
  const docC = await c.docs.open(pageId);
  expect(docC.getXmlFragment(CONTENT_FRAGMENT).length).toBe(1);
  const editorC = mountEditor(docC);
  await tick(100);
  editorC.insertBlocks([{ type: 'paragraph', content: 'Edición en C' }], editorC.document[0], 'after');
  await tick();
  const xml = docC.getXmlFragment(CONTENT_FRAGMENT).toString();
  for (const line of ['Línea 1 de A', 'Línea 2 de A', 'Escrito en B sin red', 'Edición en C']) {
    expect(xml).toContain(line);
  }
});
