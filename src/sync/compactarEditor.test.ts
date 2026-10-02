// @vitest-environment jsdom
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, expect, it } from 'vitest';
import * as Y from 'yjs';
import { schema } from '../ui/editorSchema';
import { buildDoc, compareDocs } from './compact';
import { CONTENT_FRAGMENT } from './structure';
import { FakeServer, makeDevice, type Device } from './testing';

// Compactar, entrega 2, prueba 4 (Docs/Doc_Compactar.md, sección 15): con el editor real, una página con fotos en línea,
// un bloque de foto con su dirección, script y preguntas, compactada por el dispositivo de quien edita y abierta en un
// dispositivo nuevo: el mismo documento que sin snapshot, y abrirla no repara ni sube nada.

const devices: Device[] = [];
const editors: BlockNoteEditor[] = [];

afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
  }
});

async function device(server: FakeServer, version: string): Promise<Device> {
  const d = await makeDevice(server, undefined, version, {}, undefined, {}, { minRows: 5, fullCheckEvery: 1 });
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

/** El documento como lo ve el editor, sin los ids de bloque (cambian con cada apertura de BlockNote, no con el contenido). */
const shape = (e: BlockNoteEditor) => JSON.parse(JSON.stringify(e.document, (k, v) => (k === 'id' ? undefined : v)));

async function storedRows(d: Device, pageId: string): Promise<Uint8Array[]> {
  return (await d.db.getAllFromIndex('docUpdates', 'pageId', pageId)).map((r) => r.data);
}

it('una página con fotos en línea, script y preguntas, compactada: un dispositivo nuevo la abre igual que sin snapshot', async () => {
  const server = new FakeServer();
  server.enableSnapshots(0.5);
  server.snapshotMinRows = 5;
  server.snapshotMinTailBytes = 1;
  // Quien escribe (0.124: no compacta) y quien compacta (1.000, la misma persona en otro dispositivo).
  const a = await device(server, '0.124');
  const pageId = await a.tree.create(null, 'Escena');
  await a.engine.syncNow();
  const editor = mountEditor(await a.docs.open(pageId, { seed: true }));
  await tick();
  const blocks: PartialBlock[] = [
    { type: 'paragraph', content: 'Plano 12: exterior noche' },
    { type: 'paragraph', props: { script: true } as never, content: 'INT. CASA - NOCHE' },
    { type: 'paragraph', props: { question: true } as never, content: '¿Va con lluvia?' },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Referencia ', styles: {} }, { type: 'photo', props: { url: 'sdmedia://foto-1', name: 'F1.jpg', w: 0.5 } } as never],
    },
    { type: 'image', props: { url: 'sdmedia://video-1', name: 'toma.mov' } as never },
  ];
  editor.replaceBlocks(editor.document, blocks);
  // Muchas ediciones chicas (una fila por sincronización), con algo borrado en el medio.
  for (let i = 0; i < 8; i++) {
    editor.insertBlocks([{ type: 'paragraph', content: `Nota ${i}` }], editor.document[editor.document.length - 1], 'after');
    if (i % 3 === 2) editor.removeBlocks([editor.document[editor.document.length - 2]]);
    await tick();
    await a.docs.flush(pageId);
    await a.engine.syncNow();
  }
  const k = await device(server, '1.000');
  await k.engine.syncNow();
  expect(k.compactions.map((c) => c.outcome.kind)).toEqual(['confirmed']);

  // Un dispositivo nuevo baja el snapshot; otro baja las filas (sin `pull_page_content`).
  const withSnap = await device(server, '0.124');
  const served: boolean[] = [];
  const pull = withSnap.remote.pullContent.bind(withSnap.remote);
  withSnap.remote.pullContent = async (p, after, limit) => {
    const got = await pull(p, after, limit);
    served.push(got.some((u) => u.snapshotId !== undefined));
    return got;
  };
  await withSnap.engine.syncNow();
  expect(served).toContain(true);
  const rowsOnly = await device(server, '0.124');
  (rowsOnly.remote as { pullContent?: unknown }).pullContent = undefined;
  await rowsOnly.engine.syncNow();

  // Lo guardado en los dos es el mismo documento (unidad por unidad, también lo borrado).
  const x = buildDoc(null, await storedRows(withSnap, pageId));
  const y = buildDoc(null, await storedRows(rowsOnly, pageId));
  expect(compareDocs(x, y)).toBeNull();
  x.destroy();
  y.destroy();

  // Y abierta en el editor se ve igual, sin repararse ni dejar nada para subir.
  const e1 = mountEditor(await withSnap.docs.open(pageId));
  const e2 = mountEditor(await rowsOnly.docs.open(pageId));
  await tick(60);
  expect(shape(e1)).toEqual(shape(e2));
  expect(shape(e1)).toEqual(shape(editor));
  const doc = e1.document;
  expect(doc.some((b) => (b.props as { script?: boolean }).script)).toBe(true);
  expect(doc.some((b) => (b.props as { question?: boolean }).question)).toBe(true);
  expect(doc.some((b) => b.type === 'image' && (b.props as { url?: string }).url === 'sdmedia://video-1')).toBe(true);
  expect(JSON.stringify(doc)).toContain('sdmedia://foto-1');
  await withSnap.docs.flush(pageId);
  expect(await withSnap.docs.unsyncedPages()).toEqual([]);
  const rows = server.updates.get(pageId)!.length;
  await withSnap.engine.syncNow();
  expect(server.updates.get(pageId)!.length).toBe(rows);
});
