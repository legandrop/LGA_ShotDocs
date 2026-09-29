// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, expect, it } from 'vitest';
import type * as Y from 'yjs';
import { schema } from '../ui/editorSchema';
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
      schema,
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

it('páginas sin semilla (anteriores a v0.008): la reparación junta las dos raíces sin perder nada', async () => {
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

// Con la semilla, dos dispositivos que empiezan la misma página sin verse tienen la MISMA raíz, así que
// no hay nada que reparar y lo que cada uno siga escribiendo después se conserva (re-auditoría, N1). Se
// repite porque el resultado de una fusión depende de los ids de Yjs, que son al azar.
for (let run = 0; run < 6; run++) {
  it(`con semilla, lo que un dispositivo sigue escribiendo sin red no se pierde (corrida ${run + 1})`, async () => {
    const server = new FakeServer();
    const a = await device(server);
    const b = await device(server);
    const pageId = await a.tree.create(null, 'P');
    await a.engine.syncNow();
    await b.engine.syncNow();

    const editorA = mountEditor(await a.docs.open(pageId, { seed: true }));
    const editorB = mountEditor(await b.docs.open(pageId, { seed: true }));
    await tick();
    editorA.replaceBlocks(editorA.document, [{ type: 'paragraph', content: 'Línea de A' }]);
    editorB.replaceBlocks(editorB.document, [{ type: 'paragraph', content: 'B v1' }]);
    await tick();
    await a.docs.flush(pageId);
    await b.docs.flush(pageId);

    // B sube y se queda sin red; sigue escribiendo.
    await b.engine.syncNow();
    server.online = false;
    editorB.insertBlocks([{ type: 'paragraph', content: 'B v2 sin red' }], editorB.document[0], 'after');
    await tick();
    await b.docs.flush(pageId);

    // A sube, baja lo de B y sigue.
    server.online = true;
    await a.engine.syncNow();
    await tick(50);
    await a.engine.syncNow();
    await tick(50);
    // B sincroniza, y otra vuelta de los dos.
    await b.engine.syncNow();
    await tick(80);
    await b.engine.syncNow();
    await a.engine.syncNow();
    await tick(80);

    const c = await device(server);
    await c.engine.syncNow();
    const xml = (await c.docs.open(pageId)).getXmlFragment(CONTENT_FRAGMENT);
    expect(xml.length).toBe(1);
    // Lo que A y B escribieron a la vez en el mismo primer párrafo puede quedar junto en ese párrafo (se
    // fusiona letra por letra); lo que importa es que no falte nada.
    for (const line of ['Línea de A', 'B v1', 'B v2 sin red']) {
      expect(xml.toString()).toContain(line);
      expect(texts(editorA).join('\n')).toContain(line);
      expect(texts(editorB).join('\n')).toContain(line);
    }
  });
}

// Como en la prueba de punta a punta: los dos escriben en el párrafo vacío de la semilla, sin red.
for (let run = 0; run < 4; run++) {
  it(`con semilla, dos dispositivos escriben en la página vacía sin red y se ven las dos líneas (corrida ${run + 1})`, async () => {
    const server = new FakeServer();
    const a = await device(server);
    const b = await device(server);
    const pageId = await a.tree.create(null, 'P');
    await a.engine.syncNow();
    await b.engine.syncNow();

    const editorA = mountEditor(await a.docs.open(pageId, { seed: true }));
    const editorB = mountEditor(await b.docs.open(pageId, { seed: true }));
    await tick();
    server.online = false;
    editorA.setTextCursorPosition(editorA.document[0], 'end');
    editorA.insertInlineContent('Línea escrita en A');
    editorB.setTextCursorPosition(editorB.document[0], 'end');
    editorB.insertInlineContent('Línea escrita en B');
    await tick();
    await a.docs.flush(pageId);
    await b.docs.flush(pageId);

    server.online = true;
    for (let i = 0; i < 3; i++) {
      await a.engine.syncNow();
      await b.engine.syncNow();
      await tick(60);
    }
    for (const editor of [editorA, editorB]) {
      const all = texts(editor).join(' ');
      expect(all).toContain('Línea escrita en A');
      expect(all).toContain('Línea escrita en B');
    }
  });
}
