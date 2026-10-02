// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration, yXmlFragmentToBlocks } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import type * as Y from 'yjs';
import { openLocalDb } from '../sync/localDb';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { PageTree } from '../sync/tree';
import { editorSchemaOptions, schema } from '../ui/editorSchema';
import { insertTemplate, isEmptyPage } from './apply';
import { BUILTIN_ONSET, BUILTIN_SHOT, builtinBlocks } from './builtin';

// La prueba de aceptación de la entrega 1 (Docs/Doc_Plantillas.md, sección 11) con el servidor en memoria: crear una
// página con "+", elegir *Shot Breakdown* y escribir; sin red, crear otra y elegir *On-Set Report*; al volver la red,
// las dos suben, con su `template_id`, y nada se duplica. Y la marca de "recién creada acá" que decide la tira.

const devices: Device[] = [];
const editors: BlockNoteEditor[] = [];
afterEach(async () => {
  for (const e of editors.splice(0)) e.unmount();
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.db.close();
  }
});

async function device(server: FakeServer, dbName?: string): Promise<Device> {
  const d = await makeDevice(server, dbName);
  devices.push(d);
  return d;
}

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function mountOn(doc: Y.Doc): BlockNoteEditor {
  const editor = BlockNoteEditor.create(
    withCollaboration({ ...editorSchemaOptions, collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } } }),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  editor.mount(el);
  editors.push(editor);
  return editor;
}

/** Lo que hace la página abierta al tocar una de la tira (TemplateHost.tsx): agrega, anota la plantilla, deja de ofrecer. */
async function choose(d: Device, pageId: string, kind: 'shot' | 'onset', templateId: string): Promise<BlockNoteEditor> {
  const doc = await d.docs.open(pageId, { seed: true });
  const editor = mountOn(doc);
  await tick();
  expect(isEmptyPage(doc)).toBe(true);
  insertTemplate(editor as never, builtinBlocks(kind, 'en'));
  await d.tree.setPatch(pageId, { template_id: templateId });
  await d.tree.dropFresh(pageId);
  await tick();
  return editor;
}

async function sync(...list: Device[]): Promise<void> {
  for (let i = 0; i < 2; i++) for (const d of list) await d.engine.syncNow();
}

const blocksOf = (doc: Y.Doc) =>
  yXmlFragmentToBlocks(BlockNoteEditor.create({ schema }) as never, doc.getXmlFragment(CONTENT_FRAGMENT)) as unknown as { id: string; type: string }[];

describe('crear desde una de fábrica, con y sin red', () => {
  it('las dos páginas suben con su plantilla, una sola vez cada una, y otro dispositivo las ve enteras', async () => {
    const server = new FakeServer();
    const a = await device(server);
    await sync(a);

    // 1. "+" y Shot Breakdown, y se escribe el título y en la ficha.
    const first = await a.tree.create(null, '');
    expect(a.tree.isFresh(first)).toBe(true);
    const editor = await choose(a, first, 'shot', BUILTIN_SHOT);
    expect(a.tree.isFresh(first)).toBe(false);
    await a.tree.rename(first, '012_010 | Lucía mira al vacío');
    editor.insertBlocks([{ type: 'paragraph', content: 'Escrito después' }], editor.document[0].id, 'before');
    await a.docs.flush(first);
    a.docs.close(first);
    await sync(a);

    // 2. Sin red: otra página y On-Set Report.
    server.online = false;
    const second = await a.tree.create(null, '');
    await choose(a, second, 'onset', BUILTIN_ONSET);
    await a.docs.flush(second);
    a.docs.close(second);
    await sync(a);
    expect(server.pages.has(second)).toBe(false);
    expect(a.tree.get(second)?.template_id).toBe(BUILTIN_ONSET);

    // 3. Vuelve la red: sube todo, una vez.
    server.online = true;
    await sync(a);
    await sync(a);
    expect(a.tree.pendingOps()).toEqual([]);
    expect(a.tree.failedOps()).toEqual([]);
    expect([...server.pages.values()].filter((p) => !p.deleted_at).length).toBe(2);
    expect(server.pages.get(first)?.template_id).toBe(BUILTIN_SHOT);
    expect(server.pages.get(second)?.template_id).toBe(BUILTIN_ONSET);

    // 4. Otro dispositivo baja las dos, con su contenido entero y la plantilla anotada.
    const b = await device(server);
    await sync(b);
    expect(b.tree.get(first)?.template_id).toBe(BUILTIN_SHOT);
    expect(b.tree.get(first)?.title).toBe('012_010 | Lucía mira al vacío');
    expect(b.tree.isFresh(first)).toBe(false);
    for (const [id, kind, extra] of [
      [first, 'shot', 1],
      [second, 'onset', 0],
    ] as const) {
      await b.engine.prefetchPage(id);
      const doc = await b.docs.open(id);
      const blocks = blocksOf(doc);
      expect(blocks.length, kind).toBe(builtinBlocks(kind, 'en').length + 1 + extra);
      expect(blocks.at(-1)!.id).toBe('initialBlockId');
      b.docs.close(id);
    }
  });
});

describe('la marca de "recién creada acá" (la tira)', () => {
  it('solo la página sin título del "+"; se borra al llenarla y se acuerda al volver a abrir la app', async () => {
    const server = new FakeServer();
    const dbName = crypto.randomUUID();
    const a = await device(server, dbName);
    const blank = await a.tree.create(null, '');
    const titled = await a.tree.create(null, 'Escena 12');
    const fromTemplate = await a.tree.create(null, '', undefined, { templateId: BUILTIN_SHOT });
    const kept = await a.tree.create(null, '');
    expect(a.tree.isFresh(blank)).toBe(true);
    expect(a.tree.isFresh(titled)).toBe(false);
    expect(a.tree.isFresh(fromTemplate)).toBe(false);
    expect(a.tree.get(fromTemplate)?.template_id).toBe(BUILTIN_SHOT);
    await a.tree.dropFresh(blank);
    expect(a.tree.isFresh(blank)).toBe(false);

    // Otra vez la app, con la misma base local.
    const db = await openLocalDb(dbName);
    const again = new PageTree(db, server.workspaceId);
    await again.load();
    expect(again.isFresh(blank)).toBe(false);
    expect(again.isFresh(kept)).toBe(true);
    db.close();

    // En otro dispositivo, la página llega vacía pero no es "recién creada acá": la tira no aparece.
    await sync(a);
    const b = await device(server);
    await sync(b);
    expect(b.tree.get(kept)).toBeDefined();
    expect(b.tree.isFresh(kept)).toBe(false);
  });

  it('se recuerdan las últimas 50', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const ids: string[] = [];
    for (let i = 0; i < 52; i++) ids.push(await a.tree.create(null, ''));
    expect(a.tree.isFresh(ids[0])).toBe(false);
    expect(a.tree.isFresh(ids[1])).toBe(false);
    expect(a.tree.isFresh(ids[2])).toBe(true);
    expect(a.tree.isFresh(ids[51])).toBe(true);
  });
});
