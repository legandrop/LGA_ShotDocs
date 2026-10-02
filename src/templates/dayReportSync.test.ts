// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration, yXmlFragmentToBlocks } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { mountEditor, tick as harnessTick, unmountAll } from '../ui/collabHarness';
import { editorSchemaOptions, schema } from '../ui/editorSchema';
import { schema as anteriorSchema } from '../ui/fixtures/editorSchemaAnterior';
import { schema as publishedSchema } from '../ui/fixtures/editorSchemaMain';
import { findUnknownContent } from '../ui/unknownContent';
import { insertTemplate, isEmptyPage } from './apply';
import { BUILTIN_ONSET } from './builtinIds';
import { dayReportsMark, isDayReportFolder, reportTitle } from './dayReport';
import { readFacts } from './dayReportFacts';
import {
  createDayReport,
  DayReportWriteError,
  markReportFolder,
  planDayReport,
  placeBefore,
  reportBlocks,
  reportsOn,
  suggestedDay,
  writeNewPage,
} from './dayReportCreate';

// La prueba de aceptación de la entrega 2 (Docs/Doc_Plantillas.md, sección 11) con el servidor en memoria: en una
// carpeta *Reportes*, el primero desde la tira (queda `… | Day 01` y la carpeta queda marcada); se escribe una locación y
// el equipo de cámara; en modo avión, *New day report* → `… | Day 02` con la locación y el equipo de ayer; otra vez el
// mismo día → ya existe; al volver la red, todo sube una vez y otro dispositivo lo ve entero. Más el orden, el anterior a
// medio bajar y la versión publicada abriendo lo creado.

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

async function device(server: FakeServer, dbName?: string): Promise<Device> {
  const d = await makeDevice(server, dbName);
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
const blocksOf = (doc: Y.Doc) => yXmlFragmentToBlocks(reader() as never, doc.getXmlFragment(CONTENT_FRAGMENT)) as never[];

async function factsOn(d: Device, pageId: string) {
  const doc = await d.docs.open(pageId);
  try {
    return { facts: readFacts(blocksOf(doc)), blocks: blocksOf(doc) as { id: string; type: string }[], text: JSON.stringify(blocksOf(doc)) };
  } finally {
    d.docs.close(pageId);
  }
}

const deps = (d: Device) => ({ tree: d.tree, docs: d.docs, engine: d.engine });
const DAY1 = new Date(2026, 9, 1, 9, 0);
const DAY2 = new Date(2026, 9, 2, 7, 30);

/**
 * Lo que hace la tira al elegir *On-Set Report* en una página vacía adentro de una carpeta (TemplateHost.tsx): arma el
 * reporte con lo de la carpeta, lo agrega con el editor visible, pone el título si estaba vacío y marca la carpeta.
 */
async function firstFromStrip(d: Device, folder: string, now: Date): Promise<string> {
  const page = await d.tree.create(folder, '');
  const doc = await d.docs.open(page, { seed: true });
  const editor = mountOn(doc);
  await tick();
  expect(isEmptyPage(doc)).toBe(true);
  const plan = await planDayReport(deps(d), { parentId: folder, projectId: d.tree.workspaceId }, { exclude: page, now });
  const input = plan.suggestion;
  insertTemplate(editor as never, reportBlocks(plan, input, 'en'));
  await d.tree.setPatch(page, { template_id: BUILTIN_ONSET, title: reportTitle(input.date, input.day, 'en') });
  await markReportFolder(d.tree, folder);
  await d.tree.dropFresh(page);
  await d.docs.flush(page);
  await tick();
  return page;
}

/** Escribe en la ficha (Location) y en el equipo de cámara, con el editor, como la persona. */
async function writeYesterday(d: Device, page: string, location: string, body: string): Promise<void> {
  const doc = await d.docs.open(page);
  const editor = mountOn(doc);
  await tick();
  const blocks = editor.document as unknown as { id: string; type: string; content: { rows: { cells: unknown[] }[] } }[];
  const facts = blocks[0];
  const rows = structuredClone(facts.content.rows);
  const at = rows.findIndex((r) => JSON.stringify(r.cells[0]).includes('"Location"'));
  rows[at].cells[1] = { type: 'tableCell', content: location };
  editor.updateBlock(facts.id, { content: { ...facts.content, rows } } as never);
  const camera = blocks.find((b, i) => i > 0 && b.type === 'table')!;
  const cameraRows = structuredClone(camera.content.rows);
  cameraRows[1].cells[1] = { type: 'tableCell', content: body };
  editor.updateBlock(camera.id, { content: { ...camera.content, rows: cameraRows } } as never);
  await tick();
  await d.docs.flush(page);
  editor.unmount();
  editors.splice(editors.indexOf(editor), 1);
  d.docs.close(page);
  await tick();
}

describe('el reporte del día: la prueba de aceptación', () => {
  it('el primero desde la tira, el segundo sin red con lo de ayer, "ya existe", y al volver la red sube una vez', async () => {
    const server = new FakeServer();
    const a = await device(server);
    await sync(a);
    const folder = await a.tree.create(null, 'Reportes');
    await sync(a);
    expect(isDayReportFolder(a.tree, folder)).toBe(false);

    // 1. El primero, desde la tira: `2026-10-01 | Day 01`, y la carpeta queda marcada.
    const first = await firstFromStrip(a, folder, DAY1);
    expect(a.tree.get(first)?.title).toBe('2026-10-01 | Day 01');
    expect(a.tree.get(first)?.template_id).toBe(BUILTIN_ONSET);
    expect(dayReportsMark(a.tree.get(folder))).toBe('on');
    expect(isDayReportFolder(a.tree, folder)).toBe(true);
    for (const e of editors.splice(0)) e.unmount();
    a.docs.close(first);
    await writeYesterday(a, first, 'Estancia La Paz – galpón', 'ARRI Alexa 35');
    await sync(a);

    // 2. Modo avión: New day report → Enter.
    server.online = false;
    const plan = await planDayReport(deps(a), { parentId: folder, projectId: a.tree.workspaceId }, { now: DAY2 });
    expect(plan.suggestion).toEqual({ date: '2026-10-02', day: 2, location: 'Estancia La Paz – galpón' });
    expect(plan.lastIncomplete).toBe(false);
    expect(reportsOn(plan, '2026-10-02')).toEqual([]);
    const second = await createDayReport(deps(a), plan, plan.suggestion, 'en', { canMark: true });
    expect(a.tree.get(second)?.title).toBe('2026-10-02 | Day 02');
    expect(a.tree.get(second)?.parent_id).toBe(folder);
    expect(a.tree.get(second)?.template_id).toBe(BUILTIN_ONSET);
    const made = await factsOn(a, second);
    expect(made.facts.date).toBe('2026-10-02');
    expect(made.facts.day).toBe(2);
    expect(made.facts.location).toBe('Estancia La Paz – galpón');
    expect(made.text).toContain('ARRI Alexa 35');
    // El párrafo vacío de la semilla queda al final: nada se reemplazó.
    expect(made.blocks.at(-1)!.id).toBe('initialBlockId');
    await sync(a);
    expect(server.pages.has(second)).toBe(false);

    // 3. Otra vez, el mismo día: ya existe (Enter abre ese).
    const again = await planDayReport(deps(a), { parentId: folder, projectId: a.tree.workspaceId }, { now: DAY2 });
    expect(reportsOn(again, '2026-10-02').map((r) => r.id)).toEqual([second]);
    expect(again.suggestion.day).toBe(3);

    // 4. Vuelve la red: todo sube, una vez, y otro dispositivo lo ve entero.
    server.online = true;
    await sync(a);
    await sync(a);
    expect(a.tree.pendingOps()).toEqual([]);
    expect(a.tree.failedOps()).toEqual([]);
    expect([...server.pages.values()].filter((p) => p.parent_id === folder && !p.deleted_at).length).toBe(2);
    expect(server.pages.get(second)?.template_id).toBe(BUILTIN_ONSET);
    expect((server.pages.get(folder)?.settings as { dayReports?: unknown })?.dayReports).toEqual({});
    const b = await device(server);
    await sync(b);
    expect(isDayReportFolder(b.tree, folder)).toBe(true);
    await b.engine.prefetchPage(second);
    const onB = await factsOn(b, second);
    expect(onB.facts.location).toBe('Estancia La Paz – galpón');
    expect(onB.text).toContain('ARRI Alexa 35');
  });

  it('con la marca perdida, cada New day report la vuelve a escribir; "Stop using" no se pisa', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const folder = await a.tree.create(null, 'Unidad 2');
    const plan = await planDayReport(deps(a), { parentId: folder, projectId: a.tree.workspaceId }, { now: DAY1 });
    await createDayReport(deps(a), plan, plan.suggestion, 'es', { canMark: false });
    // Sin permiso para editar la carpeta no se marca, pero se deduce por el reporte de adentro.
    expect(dayReportsMark(a.tree.get(folder))).toBeNull();
    expect(isDayReportFolder(a.tree, folder)).toBe(true);
    const next = await planDayReport(deps(a), { parentId: folder, projectId: a.tree.workspaceId }, { now: DAY2 });
    await createDayReport(deps(a), next, next.suggestion, 'es', { canMark: true });
    expect(dayReportsMark(a.tree.get(folder))).toBe('on');
    expect(a.tree.children(folder).map((p) => p.title)).toEqual(['2026-10-01 | Día 01', '2026-10-02 | Día 02']);

    // A mano: Stop using gana sobre lo deducido y un reporte nuevo no lo pisa.
    await a.tree.setSetting(folder, 'dayReports', false);
    expect(isDayReportFolder(a.tree, folder)).toBe(false);
    await markReportFolder(a.tree, folder);
    expect(dayReportsMark(a.tree.get(folder))).toBe('off');

    // Cambiar el formato de la carpeta conserva la marca (setSetting copia las claves).
    await a.tree.setSetting(folder, 'dayReports', {});
    await a.tree.setSetting(folder, 'format', { size: 'A4' });
    expect(a.tree.get(folder)?.settings).toEqual({ dayReports: {}, format: { size: 'A4' } });
  });

  it('una fecha anterior va antes del primer reporte con fecha mayor; las páginas sin fecha no cuentan', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const folder = await a.tree.create(null, 'Reportes');
    const calls = await a.tree.create(folder, 'Call sheets');
    for (const now of [new Date(2026, 9, 1, 9), new Date(2026, 9, 3, 9), new Date(2026, 9, 5, 9)]) {
      const plan = await planDayReport(deps(a), { parentId: folder, projectId: a.tree.workspaceId }, { now });
      await createDayReport(deps(a), plan, plan.suggestion, 'en', { canMark: true });
    }
    expect(a.tree.children(folder).map((p) => p.title)).toEqual([
      'Call sheets',
      '2026-10-01 | Day 01',
      '2026-10-03 | Day 02',
      '2026-10-05 | Day 03',
    ]);
    const plan = await planDayReport(deps(a), { parentId: folder, projectId: a.tree.workspaceId }, { now: new Date(2026, 9, 2, 9) });
    expect(plan.reports.length).toBe(3);
    expect(plan.last?.title).toBe('2026-10-05 | Day 03');
    expect(placeBefore(plan, '2026-10-02')).toBe(a.tree.children(folder)[2].id);
    expect(placeBefore(plan, '2026-10-06')).toBeUndefined();
    await createDayReport(deps(a), plan, { date: '2026-10-02', day: 2, location: '' }, 'en', { canMark: true });
    expect(a.tree.children(folder).map((p) => p.title)).toEqual([
      'Call sheets',
      '2026-10-01 | Day 01',
      '2026-10-02 | Day 02',
      '2026-10-03 | Day 02',
      '2026-10-05 | Day 03',
    ]);
    expect(a.tree.get(calls)?.title).toBe('Call sheets');
  });

  it('sin número legible: la cantidad de reportes + 1; carpeta vacía: día 1 sin locación', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const folder = await a.tree.create(null, 'Reportes');
    const empty = await planDayReport(deps(a), { parentId: folder, projectId: a.tree.workspaceId }, { now: DAY1 });
    expect(empty.suggestion).toEqual({ date: '2026-10-01', day: 1, location: '' });
    expect(empty.last).toBeNull();
    // Con algo escrito: una página con fecha pero vacía no cuenta (O2).
    for (const title of ['2026-09-29 | Ensayo', '2026-09-30 | Prueba de cámara']) {
      const id = await a.tree.create(folder, title);
      await writeNewPage(a.docs, id, [{ type: 'paragraph', content: 'Notas' }]);
    }
    const plan = await planDayReport(deps(a), { parentId: folder, projectId: a.tree.workspaceId }, { now: DAY1 });
    expect(plan.suggestion.day).toBe(3);
  });

  it('el anterior a medio bajar: se usa lo que hay y se avisa (O2)', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const folder = await a.tree.create(null, 'Reportes');
    const first = await firstFromStrip(a, folder, DAY1);
    for (const e of editors.splice(0)) e.unmount();
    a.docs.close(first);
    await writeYesterday(a, first, 'Galpón', 'Venice');
    // El motor dice que al de ayer le falta algo del servidor (`update_seq` mayor que lo bajado).
    const missing = new Set([first]);
    const engine = { isMissingContent: async (id: string) => missing.has(id) };
    const plan = await planDayReport({ ...deps(a), engine }, { parentId: folder, projectId: a.tree.workspaceId }, { now: DAY2 });
    expect(plan.lastIncomplete).toBe(true);
    expect(plan.suggestion.location).toBe('Galpón');
    // Igual se puede crear, con lo que hay.
    const id = await createDayReport(deps(a), plan, plan.suggestion, 'en', { canMark: true });
    expect(a.tree.get(id)?.title).toBe('2026-10-02 | Day 02');
    missing.clear();
    const after = await planDayReport({ ...deps(a), engine }, { parentId: folder, projectId: a.tree.workspaceId }, { now: DAY2 });
    expect(after.lastIncomplete).toBe(false);
  });
});

describe('correcciones de la auditoría', () => {
  it('O1: otro reporte con una fecha que ya tiene uno propone el mismo día de rodaje', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const folder = await a.tree.create(null, 'Reportes');
    for (const now of [DAY1, DAY2]) {
      const plan = await planDayReport(deps(a), { parentId: folder, projectId: a.tree.workspaceId }, { now });
      await createDayReport(deps(a), plan, plan.suggestion, 'en', { canMark: true });
    }
    const plan = await planDayReport(deps(a), { parentId: folder, projectId: a.tree.workspaceId }, { now: DAY2 });
    expect(plan.suggestion.day).toBe(3);
    expect(suggestedDay(plan, '2026-10-02')).toBe(2);
    expect(suggestedDay(plan, '2026-10-01')).toBe(1);
    expect(suggestedDay(plan, '2026-10-03')).toBe(3);
  });

  it('O2: el primero deshecho (página con título de reporte y vacía) no cuenta, y el próximo se escribe en ella', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const folder = await a.tree.create(null, 'Reportes');
    const first = await firstFromStrip(a, folder, DAY1);
    // Deshacer la plantilla: la página queda vacía con su título y su template_id.
    const editor = editors.at(-1)!;
    editor.removeBlocks(editor.document.slice(0, -1).map((b) => b.id));
    await tick();
    await a.docs.flush(first);
    for (const e of editors.splice(0)) e.unmount();
    a.docs.close(first);
    expect(a.tree.get(first)?.title).toBe('2026-10-01 | Day 01');

    const plan = await planDayReport(deps(a), { parentId: folder, projectId: a.tree.workspaceId }, { now: DAY1 });
    expect(plan.reports).toEqual([]);
    expect(plan.emptyReports.map((r) => r.id)).toEqual([first]);
    expect(plan.suggestion.day).toBe(1);
    expect(reportsOn(plan, '2026-10-01')).toEqual([]);
    // Crear ese día usa la página vacía: no queda un segundo Day 01.
    const id = await createDayReport(deps(a), plan, plan.suggestion, 'en', { canMark: true });
    expect(id).toBe(first);
    expect(a.tree.children(folder).length).toBe(1);
    expect((await factsOn(a, first)).facts.date).toBe('2026-10-01');

    // Una página "vacía" a la que le falta contenido del servidor no es vacía: no se toca.
    const other = await a.tree.create(folder, '2026-10-02 | Day 02', undefined, { templateId: BUILTIN_ONSET });
    const engine = { isMissingContent: async (pageId: string) => pageId === other };
    const later = await planDayReport({ ...deps(a), engine }, { parentId: folder, projectId: a.tree.workspaceId }, { now: DAY2 });
    expect(later.emptyReports).toEqual([]);
    expect(reportsOn(later, '2026-10-02').map((r) => r.id)).toEqual([other]);
  });

  it('O4: si escribir el contenido falla, el reintento usa la página ya creada (no la duplica)', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const folder = await a.tree.create(null, 'Reportes');
    const plan = await planDayReport(deps(a), { parentId: folder, projectId: a.tree.workspaceId }, { now: DAY1 });
    const realOpen = a.docs.open.bind(a.docs);
    let fail = true;
    const docs = {
      ...deps(a).docs,
      open: async (id: string, o?: { seed?: boolean }) => {
        if (fail) {
          fail = false;
          throw new Error('QuotaExceededError');
        }
        return realOpen(id, o);
      },
      close: a.docs.close.bind(a.docs),
      flush: a.docs.flush.bind(a.docs),
      snapshot: a.docs.snapshot.bind(a.docs),
    };
    let failed: DayReportWriteError | null = null;
    try {
      await createDayReport({ ...deps(a), docs }, plan, plan.suggestion, 'en', { canMark: true });
    } catch (err) {
      failed = err as DayReportWriteError;
    }
    expect(failed).toBeInstanceOf(DayReportWriteError);
    expect(a.tree.children(folder).map((p) => p.id)).toEqual([failed!.pageId]);
    const id = await createDayReport({ ...deps(a), docs }, plan, plan.suggestion, 'en', { canMark: true, reuse: failed!.pageId });
    expect(id).toBe(failed!.pageId);
    expect(a.tree.children(folder).length).toBe(1);
    const made = await factsOn(a, id);
    expect(made.facts.date).toBe('2026-10-01');
    // Otra vez con la página ya llena: no agrega una segunda copia.
    const count = made.blocks.length;
    await createDayReport(deps(a), plan, plan.suggestion, 'en', { canMark: true, reuse: id });
    expect((await factsOn(a, id)).blocks.length).toBe(count);
    // Sin `reuse`, la página vacía de la fecha también se reusaría (O2): tampoco duplica.
    expect(a.tree.children(folder).length).toBe(1);
  });
});

describe('lo que crea el reporte del día en una versión vieja de la app', () => {
  it('la versión publicada (y la anterior) abren un reporte con lo copiado de ayer sin escribir ni borrar nada', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const folder = await a.tree.create(null, 'Reportes');
    const first = await firstFromStrip(a, folder, DAY1);
    for (const e of editors.splice(0)) e.unmount();
    a.docs.close(first);
    await writeYesterday(a, first, 'Galpón', 'ARRI Alexa 35');
    for (const lang of ['en', 'es'] as const) {
      const plan = await planDayReport(deps(a), { parentId: folder, projectId: a.tree.workspaceId }, { now: DAY2 });
      const id = await createDayReport(deps(a), plan, { ...plan.suggestion, date: lang === 'en' ? '2026-10-02' : '2026-10-03' }, lang, { canMark: true });
      const doc = await a.docs.open(id);
      const update = Y.encodeStateAsUpdate(doc);
      const count = blocksOf(doc).length;
      a.docs.close(id);
      expect(findUnknownContent(doc)).toBeNull();
      for (const old of [publishedSchema, anteriorSchema]) {
        const clone = new Y.Doc();
        Y.applyUpdate(clone, update);
        const before = Y.encodeStateVector(clone);
        const writes: Uint8Array[] = [];
        clone.on('update', (u: Uint8Array) => writes.push(u));
        const e = mountEditor(clone, 'vieja', old);
        await harnessTick(20);
        expect(writes, lang).toEqual([]);
        expect(Y.encodeStateVector(clone)).toEqual(before);
        expect(e.document.length).toBe(count);
        expect(JSON.stringify(e.document)).toContain('ARRI Alexa 35');
        unmountAll();
      }
    }
  });
});
