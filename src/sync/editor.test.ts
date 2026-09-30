// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/y';
import { afterEach, expect, it } from 'vitest';
import type * as Y from '@y/y';
import { schema } from '../ui/editorSchema';
import { Permissions } from './access';
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
      collaboration: { fragment: doc.get(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
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
  expect(docC.get(CONTENT_FRAGMENT).length).toBe(1);
  const editorC = mountEditor(docC);
  await tick(100);
  editorC.insertBlocks([{ type: 'paragraph', content: 'Edición en C' }], editorC.document[0], 'after');
  await tick();
  const xml = docC.get(CONTENT_FRAGMENT).toString();
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
    const xml = (await c.docs.open(pageId)).get(CONTENT_FRAGMENT);
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

// Roadmap B.3: abrir una página vacía con el editor montado no deja nada pendiente; la semilla se guarda
// recién con lo primero que se escribe, y al volver a abrir se ve.
it('con el editor real, abrir una página vacía sin escribir no crea un cambio, y lo escrito después se guarda con la semilla', async () => {
  const server = new FakeServer();
  const a = await device(server);
  const pageId = await a.tree.create(null, 'P');
  await a.engine.syncNow();

  const doc = await a.docs.open(pageId, { seed: true });
  const editor = mountEditor(doc);
  await tick(100);
  await a.docs.flush(pageId);
  expect(await a.db.countFromIndex('docUpdates', 'pageId', pageId)).toBe(0);
  expect(await a.docs.unsyncedPages()).toEqual([]);
  expect(a.docs.hasUnsavedEdits()).toBe(false);
  await a.engine.syncNow();
  expect(server.updates.get(pageId) ?? []).toHaveLength(0);

  editor.setTextCursorPosition(editor.document[0], 'end');
  editor.insertInlineContent('Primera línea');
  await tick();
  await a.docs.flush(pageId);
  expect(await a.docs.unsyncedPages()).toEqual([pageId]);
  await a.engine.syncNow();
  expect(await a.docs.unsyncedPages()).toEqual([]);

  // Otro dispositivo (y lo guardado en este) tienen una sola raíz, con lo escrito.
  const b = await device(server);
  await b.engine.syncNow();
  for (const snap of [await a.docs.snapshot(pageId), await b.docs.snapshot(pageId)]) {
    expect(snap.doc.get(CONTENT_FRAGMENT).length).toBe(1);
    expect(snap.doc.get(CONTENT_FRAGMENT).toString()).toContain('Primera línea');
    expect(snap.doc.store.pendingStructs).toBeNull();
    snap.doc.destroy();
  }
  const editorB = mountEditor(await b.docs.open(pageId, { seed: true }));
  await tick(100);
  expect(texts(editorB)).toEqual(['Primera línea']);
});

// En un workspace sin la versión del equipo (sin datos de permisos) el editor queda editable, así que
// también se siembra: si no, cada dispositivo crearía su propia raíz. Como la semilla queda en memoria,
// abrir no genera cambios hasta que se escribe.
it('sin datos de permisos (workspace sin equipo) se siembra, abrir no crea cambios y dos dispositivos comparten la raíz', async () => {
  const server = new FakeServer();
  const a = await device(server);
  const b = await device(server);
  const pageId = await a.tree.create(null, 'P');
  await a.engine.syncNow();
  await b.engine.syncNow();

  const editors: BlockNoteEditor[] = [];
  for (const d of [a, b]) {
    expect(d.access.get()).toBeNull();
    const perms = new Permissions(d.tree, d.access.get(), d.remote.userId);
    expect(perms.canEditPage(pageId)).toBe(true);
    // Como PageEditor: con todo bajado y editable, se siembra.
    const complete = await d.engine.prefetchPage(pageId);
    const doc = await d.docs.open(pageId, { seed: complete && perms.canSeed(pageId) });
    expect(doc.get(CONTENT_FRAGMENT).length).toBe(1);
    editors.push(mountEditor(doc));
  }
  await tick(100);
  for (const d of [a, b]) {
    await d.docs.flush(pageId);
    expect(await d.db.countFromIndex('docUpdates', 'pageId', pageId)).toBe(0);
    expect(await d.docs.unsyncedPages()).toEqual([]);
    await d.engine.syncNow();
  }
  expect(server.updates.get(pageId) ?? []).toHaveLength(0);

  // Los dos escriben sin red y después sincronizan: una sola raíz, con las dos líneas.
  server.online = false;
  const [editorA, editorB] = editors;
  editorA.setTextCursorPosition(editorA.document[0], 'end');
  editorA.insertInlineContent('Línea de A');
  editorB.setTextCursorPosition(editorB.document[0], 'end');
  editorB.insertInlineContent('Línea de B');
  await tick();
  await a.docs.flush(pageId);
  await b.docs.flush(pageId);
  expect(await a.docs.unsyncedPages()).toEqual([pageId]);
  server.online = true;
  for (let i = 0; i < 3; i++) {
    await a.engine.syncNow();
    await b.engine.syncNow();
    await tick(60);
  }
  for (const editor of editors) {
    const all = texts(editor).join(' ');
    expect(all).toContain('Línea de A');
    expect(all).toContain('Línea de B');
  }
  const c = await device(server);
  await c.engine.syncNow();
  const docC = await c.docs.open(pageId);
  expect(docC.get(CONTENT_FRAGMENT).length).toBe(1);
});
