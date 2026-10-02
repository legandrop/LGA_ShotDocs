// @vitest-environment jsdom
// Las anotaciones de las fotos viajan con las plantillas (P.20 y P.23; Docs/Doc_Plantillas.md, "Anotaciones de las
// fotos"; Docs/Doc_Anotar_Fotos.md, "Copiar y pegar con las anotaciones"). Las mismas reglas que copiar y pegar (D46):
// con las mismas claves y campo por campo, solo para las fotos que quedan en la página, nunca entre proyectos, un solo
// paso de deshacer, y una versión vieja abre lo creado sin tocar el mapa. *Clear filled-in values* saca las fotos y con
// ellas sus anotaciones.
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addShape, PHOTO_MARKUP_MAP, updateShape, type ShapeFields } from '../media/markup';
import { PHOTO_MARKUP_CAP } from '../media/markupLimits';
import { mediaIdsInDoc } from '../media/usage';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { mountEditor as harnessMount, tick as harnessTick, undoManager, unmountAll } from '../ui/collabHarness';
import { editorSchemaOptions } from '../ui/editorSchema';
import { schema as anteriorSchema } from '../ui/fixtures/editorSchemaAnterior';
import { schema as publishedSchema } from '../ui/fixtures/editorSchemaMain';
import { findUnknownContent } from '../ui/unknownContent';
import { copyTemplateDoc, insertTemplateCopy } from './apply';
import { createDayReport, planDayReport, writeNewPage } from './dayReportCreate';
import { clearFilledIn, markupForBlocks, readOwnTemplate, saveAsTemplate } from './ownCopy';

const devices: Device[] = [];
const editors: BlockNoteEditor[] = [];
afterEach(async () => {
  for (const e of editors.splice(0)) e.unmount();
  unmountAll();
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.db.close();
  }
});

async function device(server: FakeServer): Promise<Device> {
  const d = await makeDevice(server);
  devices.push(d);
  return d;
}

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const sync = async (...list: Device[]) => {
  for (let i = 0; i < 2; i++) for (const d of list) await d.engine.syncNow();
};
const deps = (d: Device) => ({ tree: d.tree, docs: d.docs, engine: d.engine });

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

const ID = (n: number) => `0f8fad5b-d9cb-469f-a165-7086772895${String(n).padStart(2, '0')}`;
const text = (t: string) => ({ type: 'text', text: t, styles: {} });
const FRAME = { w: 4000, h: 3000 };
const mapOf = (doc: Y.Doc) => doc.getMap<unknown>(PHOTO_MARKUP_MAP);

const ARROW: ShapeFields = { type: 'arrow', zValue: 1, posX: 2000, posY: 2000, startX: 0, startY: 0, endX: 900, endY: -600, strokeColor: '#FF3B30', strokeWidth: 9 };
const NOTE: ShapeFields = { type: 'text', zValue: 2, posX: 150, posY: 700, rectX: 0, rectY: 0, rectW: 1400, rectH: 200, text: 'Borrar el poste', fontSize: 90 };
const PENCIL: ShapeFields = { type: 'freehand_pencil', zValue: 3, posX: 2500, posY: 500, points: [0, 0, 40, 30, 120, 60] };

/** Lo del mapa de una foto, como valores planos: `<clave>` → campos (el marco, o una forma). */
function photoKeys(doc: Y.Doc, n: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  mapOf(doc).forEach((v, k) => {
    if (k === ID(n) || k.startsWith(`${ID(n)}/`)) out[k] = v instanceof Y.AbstractType ? v.toJSON() : v;
  });
  return out;
}

/** La página con tres fotos (bloque, en línea y en una celda): la 2 y la 3 anotadas, la 4 sin anotar. */
const PHOTO_BLOCKS = [
  { id: 'h', type: 'heading', props: { level: 2 }, content: [text('Markers')] },
  { type: 'image', props: { url: `sdmedia://${ID(2)}`, name: 'markers.jpg' } },
  { type: 'paragraph', content: [text('See '), { type: 'photo', props: { url: `sdmedia://${ID(3)}`, name: 'm.jpg', w: 0 } }] },
  {
    type: 'table',
    content: {
      type: 'tableContent',
      headerRows: 1,
      rows: [{ cells: [[text('Shot')], [text('Ref')]] }, { cells: [[text('010')], [{ type: 'photo', props: { url: `sdmedia://${ID(4)}`, name: 'c.jpg', w: 0 } }]] }],
    },
  },
  { type: 'paragraph', content: [text('Body')] },
] as never;

/** Una página (plantilla o fuente) con esas fotos y sus anotaciones, escrita como la app (sin abrirla). */
async function pageWithPhotos(d: Device, projectId: string, parent: string | null, title: string): Promise<string> {
  const id = await d.tree.create(parent, title, projectId);
  await writeNewPage(d.docs, id, PHOTO_BLOCKS, ['h']);
  const doc = await d.docs.open(id);
  addShape(doc, ID(2), 'flecha', ARROW, FRAME);
  addShape(doc, ID(2), 'texto', NOTE, FRAME);
  addShape(doc, ID(3), 'trazo', PENCIL, { w: 1000, h: 500 });
  updateShape(doc, ID(3), 'trazo', { futuro: 7 });
  await d.docs.flush(id);
  d.docs.close(id);
  return id;
}

async function templateIn(d: Device, projectId: string): Promise<string> {
  const folder = await d.tree.create(null, 'Templates', projectId);
  await d.tree.setSetting(folder, 'templatesFolder', true);
  const tpl = await pageWithPhotos(d, projectId, folder, 'Shots');
  await d.tree.setSetting(tpl, 'template', { description: 'With photos' });
  return tpl;
}

async function openMap(d: Device, pageId: string): Promise<{ map: Record<string, unknown>; media: string[]; vector: Uint8Array; text: string }> {
  const doc = await d.docs.open(pageId);
  try {
    return { map: mapOf(doc).toJSON(), media: [...mediaIdsInDoc(doc)].sort(), vector: Y.encodeStateVector(doc), text: JSON.stringify(doc.getXmlFragment(CONTENT_FRAGMENT).toJSON()) };
  } finally {
    d.docs.close(pageId);
  }
}

describe('copyTemplateDoc: lee las anotaciones de la plantilla sin tocarla', () => {
  it('marco y formas de las fotos que tiene, campo por campo; la plantilla queda igual', async () => {
    const server = new FakeServer();
    const a = await device(server);
    await sync(a);
    const tpl = await templateIn(a, a.tree.workspaceId);
    const doc = await a.docs.open(tpl);
    const bytes = Y.encodeStateAsUpdate(doc);
    const copy = copyTemplateDoc(doc);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(bytes);
    a.docs.close(tpl);
    expect(copy.ok).toBe(true);
    if (!copy.ok) return;
    expect(copy.markup.map((p) => p.fileId).sort()).toEqual([ID(2), ID(3)]);
    const two = copy.markup.find((p) => p.fileId === ID(2))!;
    expect(two.frame).toEqual({ v: 1, ...FRAME });
    expect(two.shapes.map(([id]) => id)).toEqual(['flecha', 'texto']);
    expect(two.shapes[0][1]).toMatchObject({ type: 'arrow', strokeColor: '#FF3B30' });
    // Lo que esta versión no conoce también viaja.
    expect(copy.markup.find((p) => p.fileId === ID(3))!.shapes[0][1].futuro).toBe(7);
  });

  it('una anotación huérfana (de una foto que ya no está en el contenido) no viaja', async () => {
    const server = new FakeServer();
    const a = await device(server);
    await sync(a);
    const tpl = await templateIn(a, a.tree.workspaceId);
    const doc = await a.docs.open(tpl);
    addShape(doc, ID(9), 'vieja', ARROW, FRAME);
    const copy = copyTemplateDoc(doc);
    a.docs.close(tpl);
    if (!copy.ok) throw new Error('no ok');
    expect(copy.markup.map((p) => p.fileId)).not.toContain(ID(9));
  });
});

describe('usar una plantilla propia: las anotaciones viajan con sus fotos', () => {
  it('mismo proyecto: mismas claves, marco y formas idénticos, la plantilla no cambia, la foto sin anotar sigue limpia', async () => {
    const server = new FakeServer();
    const a = await device(server);
    await sync(a);
    const home = a.tree.workspaceId;
    const tpl = await templateIn(a, home);
    const before = await openMap(a, tpl);
    const read = await readOwnTemplate(deps(a), tpl, home);
    if (read.status !== 'ok') throw new Error(read.status);
    expect(read.markup.map((p) => p.fileId).sort()).toEqual([ID(2), ID(3)]);

    const page = await a.tree.create(null, '', home);
    const doc = await a.docs.open(page, { seed: true });
    const editor = mountOn(doc);
    await tick();
    const carried = insertTemplateCopy(editor as never, doc, { blocks: read.blocks, collapsed: read.collapsed, markup: read.markup });
    await tick();
    expect(carried?.skipped).toEqual([]);
    expect(carried?.shapes).toBe(3);
    const source = await a.docs.open(tpl);
    for (const n of [2, 3]) expect(photoKeys(doc, n)).toEqual(photoKeys(source, n));
    expect(photoKeys(doc, 4)).toEqual({});
    expect(Object.keys(photoKeys(doc, 2))).toEqual([ID(2), `${ID(2)}/flecha`, `${ID(2)}/texto`]);
    a.docs.close(tpl);
    // La plantilla no cambió.
    const after = await openMap(a, tpl);
    expect(after.vector).toEqual(before.vector);
    expect(after.map).toEqual(before.map);
    a.docs.close(page);
  });

  it('el contenido y las anotaciones son un solo paso de deshacer; rehacer trae las dos cosas', async () => {
    const server = new FakeServer();
    const a = await device(server);
    await sync(a);
    const home = a.tree.workspaceId;
    const tpl = await templateIn(a, home);
    const read = await readOwnTemplate(deps(a), tpl, home);
    if (read.status !== 'ok') throw new Error(read.status);
    const page = await a.tree.create(null, '', home);
    const doc = await a.docs.open(page, { seed: true });
    const editor = mountOn(doc);
    await tick();
    insertTemplateCopy(editor as never, doc, { blocks: read.blocks, collapsed: read.collapsed, markup: read.markup });
    await tick();
    expect(mapOf(doc).size).toBe(2 + 3);
    const um = undoManager(editor);
    um.undo();
    await tick();
    expect(mediaIdsInDoc(doc).size).toBe(0);
    expect(mapOf(doc).size).toBe(0);
    um.redo();
    await tick();
    expect(mediaIdsInDoc(doc).size).toBe(3);
    expect(mapOf(doc).size).toBe(2 + 3);
    a.docs.close(page);
  });

  it('lo escrito antes es otro paso de deshacer, y solo viajan las anotaciones de las fotos que quedaron en la página', async () => {
    const server = new FakeServer();
    const a = await device(server);
    await sync(a);
    const home = a.tree.workspaceId;
    const page = await a.tree.create(null, '', home);
    const doc = await a.docs.open(page, { seed: true });
    const editor = mountOn(doc);
    await tick();
    editor.insertBlocks([{ type: 'paragraph', content: 'Escrito antes' }] as never, editor.document[0].id, 'before');
    // Anotaciones de la 2 (que está en los bloques) y de la 9 (que no): la 9 no se lleva nada.
    const photo = (n: number) => ({ fileId: ID(n), frame: { v: 1, ...FRAME }, shapes: [['a', { type: 'arrow', zValue: 1 }]] as [string, Record<string, unknown>][] });
    const carried = insertTemplateCopy(editor as never, doc, { blocks: PHOTO_BLOCKS, collapsed: [], markup: [photo(2), photo(9)] });
    await tick();
    expect(carried?.written).toEqual([ID(2)]);
    expect(carried?.skipped).toEqual([{ fileId: ID(9), reason: 'notInContent' }]);
    expect(Object.keys(mapOf(doc).toJSON()).sort()).toEqual([ID(2), `${ID(2)}/a`]);
    undoManager(editor).undo();
    await tick();
    expect(mapOf(doc).size).toBe(0);
    expect(mediaIdsInDoc(doc).size).toBe(0);
    expect(JSON.stringify(doc.getXmlFragment(CONTENT_FRAGMENT).toJSON())).toContain('Escrito antes');
    a.docs.close(page);
  });

  it('D136: de otro proyecto no viajan (las fotos tampoco), y la plantilla queda con las suyas', async () => {
    const server = new FakeServer();
    const a = await device(server);
    await sync(a);
    const home = a.tree.workspaceId;
    const tpl = await templateIn(a, home);
    const other = await a.tree.createProject('MGTZD');
    await sync(a);
    const foreign = await readOwnTemplate(deps(a), tpl, other);
    if (foreign.status !== 'ok') throw new Error(foreign.status);
    expect(foreign.markup).toEqual([]);
    expect(foreign.removed).toBe(3);
    const page = await a.tree.create(null, '', other);
    const doc = await a.docs.open(page, { seed: true });
    const editor = mountOn(doc);
    await tick();
    insertTemplateCopy(editor as never, doc, { blocks: foreign.blocks, collapsed: foreign.collapsed, markup: foreign.markup });
    await tick();
    expect(mediaIdsInDoc(doc).size).toBe(0);
    expect(mapOf(doc).size).toBe(0);
    a.docs.close(page);
    expect((await openMap(a, tpl)).media).toEqual([ID(2), ID(3), ID(4)]);
  });

  it('el reporte del día desde una plantilla con fotos anotadas las lleva (sin abrir la página)', async () => {
    const server = new FakeServer();
    const a = await device(server);
    await sync(a);
    const home = a.tree.workspaceId;
    const tpl = await templateIn(a, home);
    await a.tree.setSetting(tpl, 'template', { description: 'Report', dayReport: true });
    const folder = await a.tree.create(null, 'Reportes', home);
    await a.tree.setSetting(folder, 'dayReports', { template: tpl });
    const plan = await planDayReport(deps(a), { parentId: folder, projectId: home }, { now: new Date(2026, 9, 2, 8, 0) });
    expect(plan.template?.id).toBe(tpl);
    const made = await createDayReport(deps(a), plan, plan.suggestion, 'en', { canMark: true, template: plan.template, markTemplate: tpl });
    const result = await openMap(a, made);
    expect(result.media).toEqual([ID(2), ID(3), ID(4)]);
    const source = await openMap(a, tpl);
    for (const n of [2, 3]) {
      for (const [k, v] of Object.entries(source.map)) if (k === ID(n) || k.startsWith(`${ID(n)}/`)) expect(result.map[k]).toEqual(v);
    }
    expect(Object.keys(result.map)).toHaveLength(5);
  });

  it('dos dispositivos: la página creada con sus anotaciones llega a otro dispositivo', async () => {
    const server = new FakeServer();
    const a = await device(server);
    await sync(a);
    const home = a.tree.workspaceId;
    const tpl = await templateIn(a, home);
    const read = await readOwnTemplate(deps(a), tpl, home);
    if (read.status !== 'ok') throw new Error(read.status);
    const page = await a.tree.create(null, 'Escena 1', home);
    await writeNewPage(a.docs, page, read.blocks, read.collapsed, read.markup);
    await sync(a);
    const b = await device(server);
    await sync(b);
    await b.engine.prefetchPage(page);
    const onB = await openMap(b, page);
    const onA = await openMap(a, page);
    expect(Object.keys(onB.map)).toHaveLength(5);
    expect(onB.map).toEqual(onA.map);
  });

  it('un tope que no entra: la foto llega limpia, sin cortar la página, y la función avisa', async () => {
    const server = new FakeServer();
    const a = await device(server);
    await sync(a);
    const home = a.tree.workspaceId;
    const page = await a.tree.create(null, '', home);
    const doc = await a.docs.open(page, { seed: true });
    const editor = mountOn(doc);
    await tick();
    const huge = [{ fileId: ID(2), frame: { v: 1, ...FRAME }, shapes: [['gigante', { type: 'text', text: 'x'.repeat(PHOTO_MARKUP_CAP + 10) }]] as [string, Record<string, unknown>][] }];
    const carried = insertTemplateCopy(editor as never, doc, { blocks: PHOTO_BLOCKS, collapsed: [], markup: huge });
    await tick();
    expect(carried?.skipped.map((s) => s.reason)).toEqual(['limit']);
    expect(mediaIdsInDoc(doc).has(ID(2))).toBe(true);
    expect(mapOf(doc).size).toBe(0);
    a.docs.close(page);
  });
});

describe('guardar como plantilla: las anotaciones viajan, salvo con Clear filled-in values', () => {
  it('sin vaciar: la plantilla tiene las fotos y sus anotaciones; la página de origen no cambia; usarla las lleva otra vez', async () => {
    const server = new FakeServer();
    const a = await device(server);
    await sync(a);
    const home = a.tree.workspaceId;
    const source = await pageWithPhotos(a, home, null, 'Reporte');
    const before = await openMap(a, source);
    server.online = false;
    const tpl = await saveAsTemplate(deps(a), source, { name: 'Con fotos', description: '', dayReport: false, clear: false }, { canMarkFolder: () => true });
    const after = await openMap(a, source);
    expect(after.vector).toEqual(before.vector);
    const saved = await openMap(a, tpl);
    expect(saved.media).toEqual([ID(2), ID(3), ID(4)]);
    expect(saved.map).toEqual(before.map);
    // Y usarla en otra página del proyecto las lleva de nuevo.
    const read = await readOwnTemplate(deps(a), tpl, home);
    if (read.status !== 'ok') throw new Error(read.status);
    const page = await a.tree.create(null, '', home);
    await writeNewPage(a.docs, page, read.blocks, read.collapsed, read.markup);
    expect((await openMap(a, page)).map).toEqual(before.map);
  });

  it('con Clear filled-in values las fotos se van y con ellas sus anotaciones (cuentan como valores llenados)', async () => {
    const server = new FakeServer();
    const a = await device(server);
    await sync(a);
    const home = a.tree.workspaceId;
    const source = await pageWithPhotos(a, home, null, 'Reporte');
    const tpl = await saveAsTemplate(deps(a), source, { name: 'Limpia', description: '', dayReport: false, clear: true }, { canMarkFolder: () => true });
    const saved = await openMap(a, tpl);
    expect(saved.media).toEqual([]);
    expect(saved.map).toEqual({});
    // La página de origen conserva sus fotos y sus flechas.
    const orig = await openMap(a, source);
    expect(orig.media).toEqual([ID(2), ID(3), ID(4)]);
    expect(Object.keys(orig.map)).toHaveLength(5);
  });

  it('markupForBlocks: solo las anotaciones de las fotos que quedan', () => {
    const photo = (n: number) => ({ fileId: ID(n), frame: { v: 1, ...FRAME }, shapes: [['a', { type: 'arrow' }]] as [string, Record<string, unknown>][] });
    const blocks = PHOTO_BLOCKS as never[];
    expect(markupForBlocks([photo(2), photo(3), photo(9)], blocks).map((p) => p.fileId)).toEqual([ID(2), ID(3)]);
    expect(markupForBlocks([photo(2)], clearFilledIn(blocks))).toEqual([]);
    expect(markupForBlocks([], blocks)).toEqual([]);
  });
});

describe('lo creado con anotaciones en una versión vieja de la app (la regla de degradar)', () => {
  for (const [name, old] of [['la versión publicada', publishedSchema], ['la versión anterior', anteriorSchema]] as const) {
    it(`${name} abre la página, la edita y saca una foto: el mapa de anotaciones queda intacto`, async () => {
      const server = new FakeServer();
      const a = await device(server);
      await sync(a);
      const home = a.tree.workspaceId;
      const tpl = await templateIn(a, home);
      const read = await readOwnTemplate(deps(a), tpl, home);
      if (read.status !== 'ok') throw new Error(read.status);
      const page = await a.tree.create(null, 'Escena', home);
      await writeNewPage(a.docs, page, read.blocks, read.collapsed, read.markup);
      const doc = await a.docs.open(page);
      const update = Y.encodeStateAsUpdate(doc);
      a.docs.close(page);
      expect(findUnknownContent(doc)).toBeNull();

      // Abrir sin editar no escribe nada.
      const clone = new Y.Doc();
      Y.applyUpdate(clone, update);
      const writes: Uint8Array[] = [];
      clone.on('update', (u: Uint8Array) => writes.push(u));
      const e = harnessMount(clone, 'vieja', old);
      await harnessTick(20);
      expect(writes).toEqual([]);
      const mapBefore = mapOf(clone).toJSON();
      expect(Object.keys(mapBefore)).toHaveLength(5);
      // Editarla (una nota y sacar la foto-bloque) no toca el mapa: lo que dibujó la plantilla sigue ahí.
      e.insertBlocks([{ type: 'paragraph', content: 'nota de la vieja' }] as never, e.document[0].id, 'after');
      const img = e.document.find((b) => b.type === 'image');
      if (img) e.removeBlocks([img.id]);
      await harnessTick(20);
      expect(JSON.stringify(e.document)).toContain('nota de la vieja');
      expect(mapOf(clone).toJSON()).toEqual(mapBefore);
      unmountAll();
    });
  }
});
