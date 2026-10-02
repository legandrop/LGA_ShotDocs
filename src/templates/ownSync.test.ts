// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration, yXmlFragmentToBlocks } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { mediaIdsInDoc } from '../media/usage';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { SHARED_COLLAPSE_MAP } from '../ui/collapseEditor';
import { mountEditor, tick as harnessTick, unmountAll } from '../ui/collabHarness';
import { editorSchemaOptions, schema } from '../ui/editorSchema';
import { schema as anteriorSchema } from '../ui/fixtures/editorSchemaAnterior';
import { schema as publishedSchema } from '../ui/fixtures/editorSchemaMain';
import { findUnknownContent } from '../ui/unknownContent';
import { insertTemplate, insertTemplateCopy, isEmptyPage } from './apply';
import { builtinBlocks, builtinTexts } from './builtin';
import { BUILTIN_ONSET, BUILTIN_SHOT } from './builtinIds';
import { dayReportsMark, isDayReportFolder, reportTitle } from './dayReport';
import { readFacts } from './dayReportFacts';
import { createDayReport, folderTemplateId, markReportFolder, planDayReport, reportBlocks, writeNewPage } from './dayReportCreate';
import { isTemplatePage, isTemplatesFolder, listTemplates, templateInfo, templatesFolderOf } from './own';
import { customizeBuiltin, readOwnTemplate, saveAsTemplate, TemplateReadError } from './ownCopy';

// Las plantillas propias con el servidor en memoria (Docs/Doc_Plantillas.md, entrega 3): la prueba de aceptación (guardar
// un reporte como plantilla con *Clear filled-in values*, editarla, y que el próximo *New day report* la use), sin red, de
// otro proyecto (sus fotos no se copian y se cuentan), a medio bajar y de una versión más nueva (nunca se copia a medias
// ni se pierde nada), la plantilla de la carpeta que la persona no ve (O4), *Customize*, y la versión publicada abriendo
// lo creado sin escribir nada.

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

async function sync(...list: Device[]): Promise<void> {
  for (let i = 0; i < 2; i++) for (const d of list) await d.engine.syncNow();
}

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

const reader = () => BlockNoteEditor.create({ schema }) as unknown as BlockNoteEditor;
type AnyBlock = { id: string; type: string; props?: Record<string, unknown>; content?: unknown; children?: AnyBlock[] };
const blocksOf = (doc: Y.Doc) => yXmlFragmentToBlocks(reader() as never, doc.getXmlFragment(CONTENT_FRAGMENT)) as unknown as AnyBlock[];

async function read(d: Device, pageId: string) {
  const doc = await d.docs.open(pageId);
  try {
    const blocks = blocksOf(doc);
    return { blocks, facts: readFacts(blocks as never), text: JSON.stringify(blocks), media: mediaIdsInDoc(doc), vector: Y.encodeStateVector(doc) };
  } finally {
    d.docs.close(pageId);
  }
}

const deps = (d: Device) => ({ tree: d.tree, docs: d.docs, engine: d.engine });
const DAY1 = new Date(2026, 9, 1, 9, 0);
const DAY2 = new Date(2026, 9, 2, 7, 30);
const ID = (n: number) => `0f8fad5b-d9cb-469f-a165-7086772895${String(n).padStart(2, '0')}`;
const text = (t: string) => ({ type: 'text', text: t, styles: {} });

/** El primer reporte, desde la tira (lo que hace TemplateHost con *On-Set Report* en una página vacía de una carpeta). */
async function firstReport(d: Device, folder: string): Promise<string> {
  const page = await d.tree.create(folder, '');
  const doc = await d.docs.open(page, { seed: true });
  const editor = mountOn(doc);
  await tick();
  const plan = await planDayReport(deps(d), { parentId: folder, projectId: d.tree.workspaceId }, { exclude: page, now: DAY1 });
  insertTemplate(editor as never, reportBlocks(plan, plan.suggestion, 'en'));
  await d.tree.setPatch(page, { template_id: BUILTIN_ONSET, title: reportTitle(plan.suggestion.date, plan.suggestion.day, 'en') });
  await markReportFolder(d.tree, folder);
  await d.docs.flush(page);
  await tick();
  editor.unmount();
  editors.splice(editors.indexOf(editor), 1);
  d.docs.close(page);
  return page;
}

/** Edita una página con el editor, como la persona: `change` recibe el editor montado. */
async function edit(d: Device, pageId: string, change: (editor: BlockNoteEditor) => void): Promise<void> {
  const doc = await d.docs.open(pageId);
  const editor = mountOn(doc);
  await tick();
  change(editor);
  await tick();
  await d.docs.flush(pageId);
  editor.unmount();
  editors.splice(editors.indexOf(editor), 1);
  d.docs.close(pageId);
  await tick();
}

/** Llena la ficha (Location) y la tabla *Camera package*, marca una casilla y pega una foto en *Summary*. */
function fillYesterday(editor: BlockNoteEditor) {
  const blocks = editor.document as unknown as (AnyBlock & { content: { rows: { cells: unknown[] }[] } })[];
  const facts = blocks[0];
  const rows = structuredClone(facts.content.rows);
  const at = rows.findIndex((r) => JSON.stringify(r.cells[0]).includes('"Location"'));
  rows[at].cells[1] = { type: 'tableCell', content: 'Estancia La Paz' };
  editor.updateBlock(facts.id, { content: { ...facts.content, rows } } as never);
  const camera = blocks.find((b, i) => i > 0 && b.type === 'table')!;
  const cameraRows = structuredClone(camera.content.rows);
  cameraRows[1].cells[1] = { type: 'tableCell', content: 'ARRI Alexa 35' };
  editor.updateBlock(camera.id, { content: { ...camera.content, rows: cameraRows } } as never);
  const check = blocks.find((b) => b.type === 'checkListItem')!;
  editor.updateBlock(check.id, { props: { checked: true } } as never);
  const summary = blocks.findIndex((b) => b.type === 'heading');
  editor.insertBlocks([{ type: 'image', props: { url: `sdmedia://${ID(1)}`, name: 'set.jpg' } }] as never, blocks[summary + 1].id, 'after');
}

describe('plantillas propias: la prueba de aceptación (entrega 3)', () => {
  it('guardar un reporte como plantilla vaciándola, editarla, y el próximo New day report la usa; sin red y en otro dispositivo', async () => {
    const server = new FakeServer();
    const a = await device(server);
    await sync(a);
    const folder = await a.tree.create(null, 'Reportes');
    const first = await firstReport(a, folder);
    await edit(a, first, fillYesterday);
    await sync(a);
    const before = await read(a, first);
    expect(before.media.size).toBe(1);

    // 1. Save as template, con Clear filled-in values (sin red: todo local).
    server.online = false;
    const tpl = await saveAsTemplate(
      deps(a),
      first,
      { name: 'ERSO On-Set', description: 'Our report', dayReport: true, clear: true },
      { canMarkFolder: () => true },
    );
    // La página original no cambió.
    const after = await read(a, first);
    expect(after.vector).toEqual(before.vector);
    expect(after.text).toBe(before.text);
    // La plantilla: en Templates (creada), marcada, con su origen, y la carpeta de reportes pasa a usarla.
    const templates = templatesFolderOf(a.tree, a.tree.workspaceId)!;
    expect(templates).toBeTruthy();
    expect(isTemplatesFolder(templates)).toBe(true);
    expect(a.tree.get(tpl)?.parent_id).toBe(templates.id);
    expect(a.tree.get(tpl)?.title).toBe('ERSO On-Set');
    expect(a.tree.get(tpl)?.template_id).toBe(BUILTIN_ONSET);
    expect(templateInfo(a.tree.get(tpl))).toEqual({ description: 'Our report', dayReport: true });
    expect(isTemplatePage(a.tree, tpl)).toBe(true);
    expect(folderTemplateId(a.tree, folder)).toBe(tpl);
    // Vaciada: sin la locación ni el equipo de ayer, sin la foto, la casilla desmarcada; los rótulos quedan.
    const saved = await read(a, tpl);
    expect(saved.facts.location).toBe('');
    expect(saved.text).not.toContain('ARRI Alexa 35');
    expect(saved.text).not.toContain('Estancia La Paz');
    expect(saved.media.size).toBe(0);
    expect(saved.text).not.toContain('"checked":true');
    expect(saved.text).toContain('Camera package');
    expect(saved.blocks.at(-1)?.type).toBe('paragraph');
    expect(isDayReportFolder(a.tree, templates.id)).toBe(false);

    // 2. Editarla: es una página. Se le suma una sección.
    await edit(a, tpl, (editor) => {
      const last = editor.document.at(-1)!;
      editor.insertBlocks([{ type: 'heading', props: { level: 2 }, content: 'Drone' }, { type: 'paragraph', content: 'Pilot: ' }] as never, last.id, 'before');
    });

    // 3. El próximo New day report sale de ella, con lo de ayer (locación y equipo de cámara).
    const plan = await planDayReport(deps(a), { parentId: folder, projectId: a.tree.workspaceId }, { now: DAY2 });
    expect(plan.template?.id).toBe(tpl);
    expect(plan.templateNotice).toBeNull();
    expect(plan.suggestion.location).toBe('Estancia La Paz');
    const second = await createDayReport(deps(a), plan, plan.suggestion, 'en', { canMark: true, template: plan.template, markTemplate: plan.template!.id });
    expect(a.tree.get(second)?.template_id).toBe(tpl);
    expect(a.tree.get(second)?.title).toBe('2026-10-02 | Day 02');
    const made = await read(a, second);
    expect(made.text).toContain('Drone');
    expect(made.text).toContain('Pilot: ');
    expect(made.facts.location).toBe('Estancia La Paz');
    expect(made.facts.day).toBe(2);
    expect(made.text).toContain('ARRI Alexa 35');
    expect(made.blocks.at(-1)?.id).toBe('initialBlockId');
    // Un reporte que salió de la plantilla propia cuenta como reporte (la carpeta se deduce aunque pierda la marca).
    expect(isDayReportFolder(a.tree, folder)).toBe(true);
    // Cambiar la plantilla después no toca lo creado.
    await edit(a, tpl, (editor) => editor.insertBlocks([{ type: 'paragraph', content: 'Later change' }] as never, editor.document[0].id, 'before'));
    expect((await read(a, second)).text).not.toContain('Later change');

    // 4. Vuelve la red: todo sube una vez y otro dispositivo ve la plantilla y la puede usar.
    server.online = true;
    await sync(a);
    await sync(a);
    expect(a.tree.pendingOps()).toEqual([]);
    expect(a.tree.failedOps()).toEqual([]);
    expect((server.pages.get(tpl)?.settings as { template?: unknown })?.template).toEqual({ description: 'Our report', dayReport: true });
    expect((server.pages.get(templates.id)?.settings as { templatesFolder?: unknown })?.templatesFolder).toBe(true);
    const b = await device(server);
    await sync(b);
    expect(listTemplates(b.tree, b.tree.workspaceId).thisProject.map((t) => t.row.id)).toEqual([tpl]);
    await b.engine.prefetchPage(tpl);
    const onB = await readOwnTemplate(deps(b), tpl, b.tree.workspaceId);
    expect(onB.status).toBe('ok');
    expect(JSON.stringify(onB.status === 'ok' && onB.blocks)).toContain('Later change');
  });
});

describe('usar una plantilla propia (4.2)', () => {
  /** Una plantilla con una foto-bloque, una foto en línea y un título colapsado para todos. */
  async function templateWithPhotos(d: Device, projectId: string): Promise<string> {
    const folder = await d.tree.create(null, 'Templates', projectId);
    await d.tree.setSetting(folder, 'templatesFolder', true);
    const tpl = await d.tree.create(folder, 'Shots', projectId);
    await d.tree.setSetting(tpl, 'template', { description: 'With photos' });
    await writeNewPage(
      d.docs,
      tpl,
      [
        { id: 'h', type: 'heading', props: { level: 2 }, content: [text('Markers')] },
        { type: 'image', props: { url: `sdmedia://${ID(2)}`, name: 'markers.jpg' } },
        { type: 'paragraph', content: [text('See '), { type: 'photo', props: { url: `sdmedia://${ID(3)}`, name: 'm.jpg', w: 0 } }] },
        { type: 'paragraph', content: [text('Body')] },
      ] as never,
      ['h'],
    );
    return tpl;
  }

  it('del mismo proyecto se copia con sus fotos; de otro, sin ellas y contadas; el colapsado va con los ids nuevos', async () => {
    const server = new FakeServer();
    const a = await device(server);
    await sync(a);
    const home = a.tree.workspaceId;
    const tpl = await templateWithPhotos(a, home);
    const other = await a.tree.createProject('MGTZD');
    await sync(a);

    const same = await readOwnTemplate(deps(a), tpl, home);
    expect(same.status).toBe('ok');
    if (same.status !== 'ok') return;
    expect(same.removed).toBe(0);
    const foreign = await readOwnTemplate(deps(a), tpl, other);
    expect(foreign.status).toBe('ok');
    if (foreign.status !== 'ok') return;
    expect(foreign.removed).toBe(2);

    // Usada en una página de otro proyecto (como la ventana, con el editor visible).
    const page = await a.tree.create(null, '', other);
    const doc = await a.docs.open(page, { seed: true });
    const editor = mountOn(doc);
    await tick();
    insertTemplateCopy(editor as never, doc, { ok: true, blocks: foreign.blocks, collapsed: foreign.collapsed });
    await tick();
    expect(mediaIdsInDoc(doc).size).toBe(0);
    expect(JSON.stringify(blocksOf(doc))).toContain('Body');
    const collapsed = [...doc.getMap(SHARED_COLLAPSE_MAP).keys()];
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]).not.toBe('h');
    expect(blocksOf(doc)[0].id).toBe(collapsed[0]);
    // La plantilla no cambió y sigue teniendo sus fotos.
    expect((await read(a, tpl)).media.size).toBe(2);
    a.docs.close(page);
  });

  it('a medio bajar: no se copia (ni a medias) y la carpeta de reportes usa la de fábrica sin pisar su plantilla', async () => {
    const server = new FakeServer();
    const a = await device(server);
    await sync(a);
    const home = a.tree.workspaceId;
    const folder = await a.tree.create(null, 'Reportes');
    const tpl = await customizeBuiltin(deps(a), 'onset', home, 'en');
    await a.tree.setSetting(folder, 'dayReports', { template: tpl });
    const missing = new Set([tpl]);
    const tries: string[] = [];
    const engine = {
      isMissingContent: async (id: string) => missing.has(id),
      prefetchPage: async (id: string) => {
        tries.push(id);
        return !missing.has(id);
      },
    };
    expect((await readOwnTemplate({ ...deps(a), engine }, tpl, home)).status).toBe('missing');
    // Se intentó bajarla antes de rendirse.
    expect(tries).toEqual([tpl]);
    const plan = await planDayReport({ ...deps(a), engine }, { parentId: folder, projectId: home }, { now: DAY2 });
    expect(plan.template).toBeNull();
    expect(plan.templateNotice).toBe('missing');
    const id = await createDayReport({ ...deps(a), engine }, plan, plan.suggestion, 'en', { canMark: true, template: null, markTemplate: undefined });
    expect(a.tree.get(id)?.template_id).toBe(BUILTIN_ONSET);
    expect(folderTemplateId(a.tree, folder)).toBe(tpl);
    // Al llegar, se usa entera.
    missing.clear();
    const ready = await readOwnTemplate({ ...deps(a), engine }, tpl, home);
    expect(ready.status).toBe('ok');
  });

  it('O4: la plantilla de la carpeta que la persona no ve, o en la papelera: la de fábrica con aviso, sin pisar la anotada', async () => {
    const server = new FakeServer();
    const a = await device(server);
    await sync(a);
    const home = a.tree.workspaceId;
    const folder = await a.tree.create(null, 'Reportes');
    const hidden = crypto.randomUUID();
    await a.tree.setSetting(folder, 'dayReports', { template: hidden });
    const plan = await planDayReport(deps(a), { parentId: folder, projectId: home }, { now: DAY1 });
    expect(plan.template).toBeNull();
    expect(plan.templateNotice).toBe('notShared');
    const id = await createDayReport(deps(a), plan, plan.suggestion, 'en', { canMark: true, template: plan.template, markTemplate: undefined });
    expect(a.tree.get(id)?.template_id).toBe(BUILTIN_ONSET);
    expect(folderTemplateId(a.tree, folder)).toBe(hidden);
    expect((await read(a, id)).text).toContain('Camera package');

    const trashed = await customizeBuiltin(deps(a), 'onset', home, 'en');
    await a.tree.setSetting(folder, 'dayReports', { template: trashed });
    await a.tree.trash(trashed);
    const again = await planDayReport(deps(a), { parentId: folder, projectId: home }, { now: DAY2 });
    expect(again.templateNotice).toBe('gone');
    expect(dayReportsMark(a.tree.get(folder))).toBe('on');
  });

  it('de una versión más nueva: no se usa ni se guarda como plantilla, y no se crea nada', async () => {
    const server = new FakeServer();
    const a = await device(server);
    await sync(a);
    const home = a.tree.workspaceId;
    const tpl = await customizeBuiltin(deps(a), 'shot', home, 'en');
    // Algo que esta versión no conoce, como llega de otro dispositivo (sin editor encima).
    const doc = await a.docs.open(tpl);
    const group = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
    const container = new Y.XmlElement('blockContainer');
    container.setAttribute('id', 'futuro');
    container.insert(0, [new Y.XmlElement('bloqueDelFuturo')]);
    group.insert(group.length, [container]);
    await a.docs.flush(tpl);
    a.docs.close(tpl);
    await tick();
    expect((await readOwnTemplate(deps(a), tpl, home)).status).toBe('newer');
    const count = a.tree.children(templatesFolderOf(a.tree, home)!.id).length;
    await expect(saveAsTemplate(deps(a), tpl, { name: 'x', description: '', dayReport: false, clear: false }, { canMarkFolder: () => true })).rejects.toBeInstanceOf(
      TemplateReadError,
    );
    expect(a.tree.children(templatesFolderOf(a.tree, home)!.id).length).toBe(count);
  });
});

describe('Customize (5.3)', () => {
  it('copia una de fábrica a Templates (una sola carpeta), con su nombre, descripción y origen; On-Set Report queda de reportes', async () => {
    const server = new FakeServer();
    const a = await device(server);
    await sync(a);
    const home = a.tree.workspaceId;
    const onset = await customizeBuiltin(deps(a), 'onset', home, 'es');
    const shot = await customizeBuiltin(deps(a), 'shot', home, 'es');
    const folders = a.tree.roots(home).filter((p) => isTemplatesFolder(p));
    expect(folders).toHaveLength(1);
    expect(folders[0].title).toBe('Templates');
    const texts = builtinTexts('es');
    expect(a.tree.get(onset)?.title).toBe(texts.names.onset);
    expect(templateInfo(a.tree.get(onset))).toEqual({ description: texts.descriptions.onset, dayReport: true });
    expect(templateInfo(a.tree.get(shot)).dayReport).toBe(false);
    expect(a.tree.get(shot)?.template_id).toBe(BUILTIN_SHOT);
    const content = await read(a, shot);
    const strip = (list: AnyBlock[]): unknown => list.map((b) => ({ type: b.type, children: strip(b.children ?? []) }));
    expect(strip(content.blocks.slice(0, -1))).toEqual(strip(builtinBlocks('shot', 'es') as never));
    expect(listTemplates(a.tree, home).thisProject.map((t) => t.row.id)).toEqual([onset, shot]);
  });
});

describe('lo creado desde una plantilla propia en una versión vieja de la app', () => {
  it('la versión publicada (y la anterior) abren la plantilla y la página creada sin escribir ni borrar nada', async () => {
    const server = new FakeServer();
    const a = await device(server);
    await sync(a);
    const home = a.tree.workspaceId;
    const folder = await a.tree.create(null, 'Reportes');
    const first = await firstReport(a, folder);
    await edit(a, first, fillYesterday);
    const tpl = await saveAsTemplate(deps(a), first, { name: 'Ours', description: '', dayReport: true, clear: false }, { canMarkFolder: () => true });
    const plan = await planDayReport(deps(a), { parentId: folder, projectId: home }, { now: DAY2 });
    const made = await createDayReport(deps(a), plan, plan.suggestion, 'en', { canMark: true, template: plan.template, markTemplate: tpl });
    for (const id of [tpl, made]) {
      const doc = await a.docs.open(id);
      const update = Y.encodeStateAsUpdate(doc);
      const count = blocksOf(doc).length;
      a.docs.close(id);
      expect(findUnknownContent(doc)).toBeNull();
      expect(isEmptyPage(doc)).toBe(false);
      for (const old of [publishedSchema, anteriorSchema]) {
        const clone = new Y.Doc();
        Y.applyUpdate(clone, update);
        const before = Y.encodeStateVector(clone);
        const writes: Uint8Array[] = [];
        clone.on('update', (u: Uint8Array) => writes.push(u));
        const e = mountEditor(clone, 'vieja', old);
        await harnessTick(20);
        expect(writes).toEqual([]);
        expect(Y.encodeStateVector(clone)).toEqual(before);
        expect(e.document.length).toBe(count);
        expect(JSON.stringify(e.document)).toContain('ARRI Alexa 35');
        unmountAll();
      }
    }
  });
});
