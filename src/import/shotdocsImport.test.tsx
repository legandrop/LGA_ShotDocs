// @vitest-environment jsdom
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { appComments } from '../export/exportComments';
import { ExportEditor } from '../export/exportEditor';
import { exportPlan } from '../export/exportPages';
import { appArchiveMedia, buildZip, type ZipInclude } from '../export/exportZip';
import { readPageContent } from '../export/pageContent';
import { writeBlocks } from '../export/testProject';
import { folderSource, openZip, type ArchiveSource } from '../export/zipReader';
import { BlobSink } from '../media/folderZip';
import { addShape, PHOTO_MARKUP_MAP } from '../media/markup';
import { mediaIdOf } from '../media/queue';
import { ARCHIVE_COMMENTS_SCHEMA_VERSION } from '../sync/comments';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, fakeConvertHeic, makeDevice, type Device } from '../sync/testing';
import { BUILTIN_ONSET } from '../templates/builtinIds';
import { mountEditor, unmountAll } from '../ui/collabHarness';
import { SHARED_COLLAPSE_MAP } from '../ui/collapseEditor';
import { schema as publishedSchema } from '../ui/fixtures/editorSchemaMain';
import { porteroDownload } from '../ui/sharpImages';
import { NOT_IN_ARCHIVE } from './archiveBlocks';
import {
  ArchiveError,
  archiveJournal,
  archiveWeight,
  findArchiveResumable,
  importArchive,
  openArchive,
  type ArchiveImportDeps,
  type ShotDocsArchive,
} from './shotdocsImport';

// Volver a Shot Docs desde el zip (P.22, entrega 3; Docs/Doc_Exportar.md, sección 3 y la prueba de aceptación de la
// entrega 3). Ida y vuelta con el servidor y el portero en memoria (src/sync/testing.ts): se exporta un proyecto con
// fotos anotadas, plantillas, tablas con fotos en las celdas, fotos en línea, títulos colapsados para todos, subpáginas y
// comentarios; se importa a un proyecto nuevo y se compara bloque por bloque. Más: lo que vuelve de quien exportó, dos
// importaciones del mismo zip, seguir donde quedó, la base sin la migración, zips rotos y hostiles, y que una versión
// publicada de la app abra lo importado sin perder nada.

beforeAll(() => {
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('File', NodeFile);
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as never;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

const devices: Device[] = [];
const editors: ExportEditor[] = [];
afterEach(async () => {
  unmountAll();
  for (const e of editors.splice(0)) e.destroy();
  for (const d of devices.splice(0)) {
    d.offline.stop();
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const OWNER_EMAIL = 'lega.supervisor@wanka.test';
const ANA_EMAIL = 'ana.garcia@estudio.test';
const ALL: ZipInclude = { originals: true, attachments: true, videos: true, comments: true };

const content = (size: number, seed: number) =>
  `SEED${seed}|${Array.from({ length: size }, (_, i) => String.fromCharCode(65 + ((i * 31 + seed * 7 + (i >> 7)) % 26))).join('')}`.slice(0, size);
const file = (size: number, name: string, type: string, seed: number) => new File([content(size, seed)], name, { type });

async function sync(d: Device) {
  for (let i = 0; i < 2; i++) {
    await d.engine.syncNow();
    await d.engine.syncMedia();
  }
  await d.comments.run();
  await d.engine.syncNow();
}

async function device(server: FakeServer, user: { id?: string; email?: string } = { email: OWNER_EMAIL }) {
  const d = await makeDevice(server, crypto.randomUUID(), '0.021', {}, undefined, user);
  devices.push(d);
  return d;
}

/**
 * El proyecto de ida: "Rodaje" (A4) con "Escena 1" (título colapsado para todos, Script, pregunta, foto en línea, tabla
 * con una foto en una celda, foto-bloque anotada con su ancho, salto de hoja, links adentro y afuera, una lista con
 * hijos) y su subpágina "Toma 1A"; "Día 1" (de la plantilla de fábrica del reporte), "Templates" con una plantilla
 * propia, "Reportes" (la carpeta de reportes con esa plantilla) y "Escena 2" (de esa plantilla, con un video y un PDF).
 * Comentarios del dueño y de Ana, uno resuelto y un hilo con el primero borrado.
 */
async function world() {
  const server = new FakeServer();
  server.enableComments();
  server.enableTrash();
  server.importCommentsEnabled = true;
  server.settings = { ...server.settings!, schemaVersion: ARCHIVE_COMMENTS_SCHEMA_VERSION };
  const a = await device(server);
  await sync(a);
  const project = server.workspaceId;
  const root = await a.tree.create(null, 'Rodaje');
  await a.tree.setSetting(root, 'format', { size: 'A4', landscape: false });
  await a.tree.setSetting(root, 'header', { levels: 1 });
  const scene = await a.tree.create(root, 'Escena 1');
  const take = await a.tree.create(scene, 'Toma 1A');
  const day = await a.tree.create(root, 'Día 1', undefined, { templateId: BUILTIN_ONSET });
  const templates = await a.tree.create(null, 'Templates');
  await a.tree.setSetting(templates, 'templatesFolder', true);
  const tpl = await a.tree.create(templates, 'Plantilla de escena');
  await a.tree.setSetting(tpl, 'template', { description: 'Para cada escena', dayReport: true });
  const reports = await a.tree.create(null, 'Reportes');
  await a.tree.setSetting(reports, 'dayReports', { template: tpl });
  const scene2 = await a.tree.create(reports, 'Escena 2', undefined, { templateId: tpl });
  await a.tree.setSetting(scene2, 'split', true);
  await a.tree.setPatch(scene2, { icon: '🎬' });
  const outside = await a.tree.create(null, 'Afuera');
  await sync(a);

  const photo = await a.media.add(scene, file(4000, 'IMG_0412.JPG', 'image/jpeg', 1));
  const inline = await a.media.add(scene, file(2200, 'IMG_0500.JPG', 'image/jpeg', 2));
  const cell = await a.media.add(scene, file(2100, 'IMG_0600.JPG', 'image/jpeg', 3));
  const video = await a.media.add(scene2, file(6000, 'clip 001.mov', 'video/quicktime', 4));
  const pdf = await a.media.add(scene2, file(3000, 'plano_set.pdf', 'application/pdf', 5));
  const headingId = crypto.randomUUID();
  const planoId = crypto.randomUUID();
  const imageId = crypto.randomUUID();
  await writeBlocks(a.docs, scene, [
    { id: headingId, type: 'heading', props: { level: 2 }, content: 'Escena 12', children: [{ type: 'paragraph', content: 'Adentro del título' }] },
    { type: 'paragraph', props: { script: true }, content: 'INT. CASA DE ANA - NOCHE' },
    { type: 'paragraph', props: { question: true }, content: '¿Qué lente?' },
    {
      id: planoId,
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Plano ', styles: { bold: true } },
        { type: 'link', href: `/p/${day}`, content: 'el día 1' },
        ' y ',
        { type: 'link', href: `/p/${outside}`, content: 'la otra rama' },
        ' y ',
        { type: 'link', href: 'https://drive.google.com/file/d/abc/view', content: 'el Drive' },
        ' con ',
        { type: 'photo', props: { url: inline, name: 'IMG_0500.JPG', w: 140 } },
      ],
    },
    {
      type: 'table',
      content: {
        type: 'tableContent',
        rows: [
          { cells: [[{ type: 'text', text: '1A', styles: {} }], [{ type: 'photo', props: { url: cell, name: 'IMG_0600.JPG', w: 0 } }]] },
          { cells: [[{ type: 'text', text: '35mm', styles: { italic: true } }], []] },
        ],
      },
    },
    { id: imageId, type: 'image', props: { url: photo, name: 'IMG_0412.JPG', previewWidth: 320 } },
    { type: 'paragraph', props: { pageBreak: true } },
    { type: 'bulletListItem', content: 'Croma', children: [{ type: 'numberedListItem', content: 'Marcas' }, { type: 'checkListItem', props: { checked: true }, content: 'Gris' }] },
  ] as never);
  const doc = await a.docs.open(scene);
  doc.getMap(SHARED_COLLAPSE_MAP).set(headingId, true);
  addShape(doc, mediaIdOf(photo)!, 'r1', { type: 'rectangle', posX: 10, posY: 20, w: 100, h: 50, strokeColor: '#FF0000', z: 1 }, { w: 1600, h: 1200 });
  addShape(doc, mediaIdOf(photo)!, 'n1', { type: 'numbered_marker', posX: 300, posY: 400, number: 1, z: 2, futureField: 'de una versión nueva' }, { w: 1600, h: 1200 });
  a.docs.close(scene);
  await a.docs.flush();
  await writeBlocks(a.docs, take, [{ type: 'paragraph', content: 'Toma con la misma foto' }, { type: 'image', props: { url: photo, name: 'IMG_0412.JPG' } }] as never);
  await writeBlocks(a.docs, day, [{ type: 'heading', props: { level: 1 }, content: 'Reporte' }, { type: 'paragraph', content: 'Llovió' }] as never);
  await writeBlocks(a.docs, tpl, [{ type: 'heading', props: { level: 2 }, content: 'Plano' }, { type: 'paragraph', content: '' }] as never);
  await writeBlocks(a.docs, scene2, [
    { type: 'paragraph', content: 'Referencias' },
    { type: 'image', props: { url: video, name: 'clip 001.mov' } },
    { type: 'image', props: { url: pdf, name: 'plano_set.pdf' } },
  ] as never);
  await writeBlocks(a.docs, outside, [{ type: 'paragraph', content: 'SECRETO_DE_AFUERA' }] as never);
  await sync(a);
  await a.media.idle();
  await sync(a);

  // Comentarios: el dueño en el plano, Ana responde; un hilo resuelto de Ana en la página; uno con el primero borrado.
  server.addMember('ana', 'member', ANA_EMAIL);
  server.grant('ana', { pageId: root }, 'comment');
  const thread = await a.comments.add(scene, planoId, 'Cambiar el lente a 35');
  await sync(a);
  const ana = await device(server, { id: 'ana', email: ANA_EMAIL });
  await sync(ana);
  await ana.comments.refresh(scene);
  await ana.comments.add(scene, null, 'COMENTARIO_DE_ANA', thread);
  const anaThread = await ana.comments.add(scene, imageId, 'La foto está movida');
  await sync(ana);
  await ana.comments.resolve(scene, anaThread, true);
  const gone = await a.comments.add(take, null, 'COMENTARIO_BORRADO');
  await a.comments.add(take, null, 'Respuesta viva', gone);
  await a.comments.remove(take, gone);
  await sync(ana);
  await sync(a);
  return { server, a, ana, project, root, scene, take, day, templates, tpl, reports, scene2, outside, headingId, planoId, imageId, ids: { photo: mediaIdOf(photo)!, inline: mediaIdOf(inline)!, cell: mediaIdOf(cell)!, video: mediaIdOf(video)!, pdf: mediaIdOf(pdf)! } };
}

type World = Awaited<ReturnType<typeof world>>;

async function exportEditor(d: Device) {
  const e = await ExportEditor.create({ imageTimeoutMs: 0, copyTimeoutMs: 0, resolveFileUrl: (url: string, pageId: string) => d.media.resolve(url, pageId), media: d.media });
  editors.push(e);
  return e;
}

/** El zip del proyecto entero (o de una rama), como lo arma la ventana. */
async function zipOf(w: World, d: Device, kind: 'project' | 'page' = 'project', include: ZipInclude = ALL, email = OWNER_EMAIL): Promise<Blob> {
  const sink = new BlobSink();
  const target = kind === 'page' ? w.root : w.project;
  await buildZip({
    title: kind === 'page' ? d.tree.get(w.root)!.title : (d.tree.project(target)?.name ?? 'Proyecto'),
    kind,
    project: kind === 'project' ? { id: target, name: d.tree.project(target)?.name ?? 'Proyecto' } : null,
    plan: exportPlan(d.tree, kind, target),
    rows: (id) => d.tree.get(id),
    source: d.docs,
    editor: await exportEditor(d),
    media: appArchiveMedia(d.media, d.mediaDb, porteroDownload(d.media, (u) => w.server.portero.fetch(u))),
    include,
    comments: appComments(d.comments, d.commentsDb, { id: d.remote.userId, email }),
    me: { id: d.remote.userId, email },
    online: true,
    target: { kind: 'zip', sink },
    download: { fetch: w.server.portero.fetch as never, online: () => true, wait: async () => undefined },
    convertHeic: fakeConvertHeic,
    appVersion: '0.135',
    lastSync: d.engine.getStatus().lastSyncAt,
  });
  return sink.blob();
}

function deps(d: Device, extra: Partial<ArchiveImportDeps> = {}): ArchiveImportDeps {
  return {
    tree: d.tree,
    docs: d.docs,
    media: d.media,
    journal: archiveJournal(d.db),
    comments: d.comments,
    userEmail: d.remote.email ?? OWNER_EMAIL,
    schemaVersion: ARCHIVE_COMMENTS_SCHEMA_VERSION,
    ...extra,
  };
}

/** Los bloques y lo de al lado de una página (de una copia), con cada archivo por su nombre y cada página por su título. */
async function pageState(d: Device, pageId: string) {
  const snap = await d.docs.snapshot(pageId);
  try {
    const c = readPageContent(snap.doc);
    const names = new Map<string, string>();
    for (const p of c.photoMarkup) names.set(p.fileId, '');
    const text = JSON.stringify(c.blocks);
    const ids = new Set([...text.matchAll(/sdmedia:\/\/([0-9a-f-]{36})/g)].map((m) => m[1]));
    for (const id of ids) names.set(id, (await d.mediaDb.get('files', id))?.name ?? (await d.mediaDb.get('known', id))?.name ?? `?${id}`);
    const normal = text
      .replace(/sdmedia:\/\/([0-9a-f-]{36})/g, (_, id: string) => `sdmedia://${names.get(id)}`)
      .replace(/\/p\/([0-9a-f-]{36})/g, (_, id: string) => `/p/${d.tree.get(id)?.title ?? '?'}`);
    const markup = c.photoMarkup.map((p) => ({ file: names.get(p.fileId) || p.fileId, frame: p.frame, shapes: p.shapes }));
    return { blocks: JSON.parse(normal) as unknown[], collapsed: c.collapsedForAll, markup, unknown: c.unknown };
  } finally {
    snap.doc.destroy();
  }
}

/** El árbol de un proyecto: título, nivel, ajustes, ícono y plantilla (por título), en orden. */
function treeOf(d: Device, projectId: string) {
  const out: { title: string; depth: number; settings: unknown; icon: string | null; template: string | null }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const p of parent ? d.tree.children(parent) : d.tree.roots(projectId)) {
      if (d.tree.isTrashed(p.id)) continue;
      const s = { ...(p.settings ?? {}) } as Record<string, unknown>;
      if (s.dayReports && typeof s.dayReports === 'object' && (s.dayReports as { template?: string }).template) s.dayReports = { template: d.tree.get((s.dayReports as { template: string }).template)?.title };
      out.push({ title: p.title, depth, settings: s, icon: p.icon ?? null, template: p.template_id ? (d.tree.get(p.template_id)?.title ?? p.template_id) : null });
      walk(p.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Las páginas de un proyecto (sin la papelera), en el orden del árbol. */
function allPages(d: Device, projectId: string) {
  const out: ReturnType<Device['tree']['children']> = [];
  const walk = (list: ReturnType<Device['tree']['children']>) => {
    for (const p of list) {
      out.push(p);
      walk(d.tree.children(p.id));
    }
  };
  walk(d.tree.roots(projectId));
  return out;
}

async function bytesOf(d: Device, url: string): Promise<string> {
  const blob = await d.mediaDb.get('blobs', mediaIdOf(url)!);
  return blob ? Buffer.from(await (blob as Blob).arrayBuffer()).toString('latin1') : '';
}

describe('volver a Shot Docs: ida y vuelta', () => {
  it('el proyecto vuelve igual: árbol, ajustes, plantillas, bloques, colapsado, anotaciones, archivos y comentarios', async () => {
    const w = await world();
    const zip = await zipOf(w, w.a);
    // Quien importa es el mismo dueño, en otro dispositivo (el workspace de destino es el mismo: dos islas iguales).
    const b = await device(w.server);
    await sync(b);
    const archive = await openArchive(await openZip(zip));
    expect(archive.manifest.pages.length).toBe(9);
    const weight = archiveWeight(archive);
    expect(weight).toMatchObject({ files: 5, previews: 0, missing: 0 });
    const progress: number[] = [];
    const result = await importArchive(archive, deps(b), { projectName: 'Rodaje (vuelta)', onProgress: (p) => progress.push(p.done) });
    // Lo único para revisar: el hilo de "Toma 1A" cuyo primer comentario se borró.
    expect(result.problems).toEqual(['Toma 1A: 1 thread had its first comment deleted; its first reply opens it now']);
    expect(result).toMatchObject({ pages: 9, files: 5, previews: 0, resumable: false });
    expect(progress.at(-1)).toBe(9);
    await sync(b);
    await b.media.idle();
    await sync(b);

    // El árbol, en el mismo orden, con los ajustes y las marcas de plantilla apuntando a las páginas nuevas.
    expect(b.tree.project(result.projectId)?.name).toBe('Rodaje (vuelta)');
    const before = treeOf(w.a, w.project);
    const after = treeOf(b, result.projectId);
    expect(after).toEqual(before);
    expect(after.find((p) => p.title === 'Día 1')?.template).toBe(BUILTIN_ONSET);
    expect(after.find((p) => p.title === 'Escena 2')).toMatchObject({ template: 'Plantilla de escena', icon: '🎬', settings: { split: true } });
    expect(after.find((p) => p.title === 'Reportes')?.settings).toEqual({ dayReports: { template: 'Plantilla de escena' } });
    expect(after.find((p) => p.title === 'Plantilla de escena')?.settings).toEqual({ template: { description: 'Para cada escena', dayReport: true } });
    expect(after.find((p) => p.title === 'Templates')?.settings).toEqual({ templatesFolder: true });
    // Ningún id viejo quedó en el árbol nuevo.
    const oldIds = new Set([w.root, w.scene, w.take, w.day, w.templates, w.tpl, w.reports, w.scene2, w.outside]);
    const newPages = allPages(b, result.projectId);
    expect(newPages.length).toBe(9);
    for (const p of newPages) {
      expect(oldIds.has(p.id)).toBe(false);
      if (p.template_id) expect(oldIds.has(p.template_id)).toBe(false);
    }

    // Cada página, bloque por bloque (con los mismos ids de bloque), el colapsado para todos y las anotaciones.
    const byTitle = (d: Device, project: string, title: string) => allPages(d, project).find((p) => p.title === title)!.id;
    let blocks = 0;
    for (const page of before) {
      const was = await pageState(w.a, byTitle(w.a, w.project, page.title));
      const now = await pageState(b, byTitle(b, result.projectId, page.title));
      expect(now.blocks, page.title).toEqual(was.blocks);
      expect(now.collapsed, page.title).toEqual(was.collapsed);
      expect(now.markup, page.title).toEqual(was.markup);
      expect(now.unknown).toBeNull();
      blocks += JSON.stringify(was.blocks).match(/"id":/g)?.length ?? 0;
    }
    expect(blocks).toBeGreaterThan(20);
    const scene = await pageState(b, byTitle(b, result.projectId, 'Escena 1'));
    expect(scene.collapsed).toEqual([w.headingId]);
    expect(scene.markup).toEqual([{ file: 'IMG_0412.JPG', frame: { v: 1, w: 1600, h: 1200 }, shapes: expect.arrayContaining([['r1', expect.objectContaining({ type: 'rectangle', strokeColor: '#FF0000' })], ['n1', expect.objectContaining({ futureField: 'de una versión nueva' })]]) }]);
    // Los links entre páginas van a las páginas nuevas (el proyecto entero: "Afuera" también está adentro).
    const sceneText = JSON.stringify(scene.blocks);
    expect(sceneText).toContain('"href":"/p/Día 1"');
    expect(sceneText).toContain('"href":"/p/Afuera"');
    expect(sceneText).toContain('"href":"https://drive.google.com/file/d/abc/view"');

    // Los archivos: cada uno una vez (la foto de dos páginas, una sola), con los mismos bytes, y suben al Drive.
    const journalFiles = await b.mediaDb.getAll('files');
    expect(journalFiles.filter((f) => f.name === 'IMG_0412.JPG').length).toBe(1);
    expect(journalFiles.length).toBe(5);
    for (const f of journalFiles) {
      const original = (await w.a.mediaDb.getAll('files')).find((x) => x.name === f.name)!;
      expect(f.size, f.name).toBe(original.size);
      expect(await bytesOf(b, `sdmedia://${f.id}`), f.name).toBe(await bytesOf(w.a, `sdmedia://${original.id}`));
      expect(f.pending, f.name).toBe(0);
    }

    // Los comentarios: los mismos hilos, con su autor, su fecha y si están resueltos; los del dueño a su nombre.
    const newScene = byTitle(b, result.projectId, 'Escena 1');
    const newTake = byTitle(b, result.projectId, 'Toma 1A');
    const rows = [...w.server.comments.values()].filter((c) => c.page_id === newScene || c.page_id === newTake);
    expect(rows.length).toBe(4);
    for (const r of rows) {
      expect(r.imported_from).toBe('shotdocs');
      expect(r.imported_author_email).toBeNull();
    }
    const of = (body: string) => rows.find((r) => r.body === body)!;
    const lens = of('Cambiar el lente a 35');
    expect(lens).toMatchObject({ author_id: b.remote.userId, imported_author: null, block_id: w.planoId, thread_id: null });
    expect(of('COMENTARIO_DE_ANA')).toMatchObject({ author_id: null, imported_author: 'ana.garcia', thread_id: lens.id });
    const original = [...w.server.comments.values()].find((c) => c.body === 'La foto está movida' && c.page_id === w.scene)!;
    expect(of('La foto está movida')).toMatchObject({ imported_author: 'ana.garcia', block_id: w.imageId, created_at: original.created_at });
    expect(of('La foto está movida').resolved_at).toBeTruthy();
    // El hilo con el primero borrado: la respuesta viva lo abre.
    expect(of('Respuesta viva')).toMatchObject({ thread_id: null, author_id: b.remote.userId });
    expect(rows.some((r) => r.body === 'COMENTARIO_BORRADO')).toBe(false);
    expect(result.comments).toBe(4);

    // Nada de lo de afuera ni de lo viejo cambió: el proyecto original sigue igual.
    expect(treeOf(w.a, w.project)).toEqual(before);
    // El diario se borró al terminar: nada para seguir.
    expect(await findArchiveResumable(archive, { tree: b.tree, journal: archiveJournal(b.db) })).toBeNull();
  });

  it('importar dos veces el mismo zip: dos proyectos, comentarios sin chocar; quien no exportó ve los nombres', async () => {
    const w = await world();
    const zip = await zipOf(w, w.a);
    const archive = await openArchive(await openZip(zip));
    const first = await importArchive(archive, deps(w.a));
    const second = await importArchive(archive, deps(w.a));
    await sync(w.a);
    expect(first.projectId).not.toBe(second.projectId);
    const imported = [...w.server.comments.values()].filter((c) => c.imported_from === 'shotdocs');
    expect(imported.length).toBe(8);
    expect(new Set(imported.map((c) => c.id)).size).toBe(8);
    // Un admin que no exportó: todo con el nombre, nadie a su nombre, ningún correo.
    w.server.addMember('beto', 'admin', 'beto@wanka.test');
    const beto = await device(w.server, { id: 'beto', email: 'beto@wanka.test' });
    await sync(beto);
    const third = await importArchive(archive, deps(beto, { userEmail: 'beto@wanka.test' }));
    await sync(beto);
    const pages = new Set(allPages(beto, third.projectId).map((p) => p.id));
    const rows = [...w.server.comments.values()].filter((c) => pages.has(c.page_id));
    expect(rows.length).toBe(4);
    for (const r of rows) {
      expect(r.author_id).toBeNull();
      expect(r.imported_author_email).toBeNull();
    }
    expect(rows.map((r) => r.imported_author).sort()).toEqual(['ana.garcia', 'ana.garcia', 'lega.supervisor', 'lega.supervisor']);
  });

  it('una rama, sin los originales: vuelve con las vistas de las fotos (avisado) y el nombre del video y del PDF en su lugar', async () => {
    const w = await world();
    const zip = await zipOf(w, w.a, 'project', { originals: false, attachments: false, videos: false, comments: false });
    const archive = await openArchive(await openZip(zip));
    const weight = archiveWeight(archive);
    expect(weight).toMatchObject({ previews: 3, missing: 2 });
    const result = await importArchive(archive, deps(w.a));
    expect(result.previews).toBe(3);
    expect(result.comments).toBe(0);
    expect(result.problems.some((p) => p.includes('IMG_0412.JPG') && p.includes('preview'))).toBe(true);
    expect(result.problems.some((p) => p.startsWith('Escena 2:') && p.includes('clip 001.mov'))).toBe(true);
    const scene2 = allPages(w.a, result.projectId).find((p) => p.title === 'Escena 2')!.id;
    const state = await pageState(w.a, scene2);
    expect(JSON.stringify(state.blocks)).toContain(`clip 001.mov ${NOT_IN_ARCHIVE}`);
    expect(JSON.stringify(state.blocks)).toContain(`plano_set.pdf ${NOT_IN_ARCHIVE}`);
    expect(JSON.stringify(state.blocks)).not.toMatch(new RegExp(`${w.ids.video}|${w.ids.pdf}`));
    // La foto anotada volvió desde su vista, con las anotaciones (mismo marco: la vista tiene la misma proporción).
    const scene = allPages(w.a, result.projectId).find((p) => p.title === 'Escena 1')!.id;
    const s = await pageState(w.a, scene);
    expect(s.markup.map((m) => m.file)).toEqual(['IMG_0412.jpg']);
    // Una rama sola: la raíz exportada queda arriba de todo, sin nada de arriba.
    const branch = await openArchive(await openZip(await zipOf(w, w.a, 'page')));
    const r2 = await importArchive(branch, deps(w.a));
    expect(treeOf(w.a, r2.projectId).map((p) => `${p.depth}:${p.title}`)).toEqual(['0:Rodaje', '1:Escena 1', '2:Toma 1A', '1:Día 1']);
    expect(w.a.tree.project(r2.projectId)?.name).toBe('Rodaje');
    // El link a la rama de afuera quedó como texto (ya en el zip); el de adentro, a la página nueva.
    const branchScene = await pageState(w.a, allPages(w.a, r2.projectId).find((p) => p.title === 'Escena 1')!.id);
    const branchText = JSON.stringify(branchScene.blocks);
    expect(branchText).toContain('"href":"/p/Día 1"');
    expect(branchText).toContain('la otra rama');
    expect(branchText).not.toContain(w.outside);
    expect(branchText).not.toContain('/p/Afuera');
  });

  it('una versión publicada de la app abre lo importado y no pierde nada (sin tipos de bloque nuevos)', async () => {
    const w = await world();
    const archive = await openArchive(await openZip(await zipOf(w, w.a)));
    const result = await importArchive(archive, deps(w.a));
    const scene = allPages(w.a, result.projectId).find((p) => p.title === 'Escena 1')!.id;
    const snap = await w.a.docs.snapshot(scene);
    const before = Y.encodeStateVector(snap.doc);
    const xml = snap.doc.getXmlFragment(CONTENT_FRAGMENT).toString();
    const markup = JSON.stringify(snap.doc.getMap(PHOTO_MARKUP_MAP).toJSON());
    const changes: Uint8Array[] = [];
    snap.doc.on('update', (u: Uint8Array) => changes.push(u));
    mountEditor(snap.doc, 'publicada', publishedSchema);
    expect(changes).toEqual([]);
    expect(snap.doc.getXmlFragment(CONTENT_FRAGMENT).toString()).toBe(xml);
    expect(JSON.stringify(snap.doc.getMap(PHOTO_MARKUP_MAP).toJSON())).toBe(markup);
    expect(Y.encodeStateVector(snap.doc)).toEqual(before);
    snap.doc.destroy();
  });
});

describe('volver a Shot Docs: cortes, la base y los zips hostiles', () => {
  it('cortar a mitad y seguir: no duplica páginas, archivos, contenido ni comentarios', async () => {
    const w = await world();
    const archive = await openArchive(await openZip(await zipOf(w, w.a)));
    // La cuarta escritura falla (se cortó la luz entre escribir y anotar: el documento ya quedó guardado).
    let writes = 0;
    const docs = {
      open: w.a.docs.open.bind(w.a.docs),
      close: w.a.docs.close.bind(w.a.docs),
      flush: async (id?: string) => {
        await w.a.docs.flush(id);
        if (++writes === 4) throw new Error('corte');
      },
    };
    const first = await importArchive(archive, deps(w.a, { docs: docs as never }));
    expect(first.resumable).toBe(true);
    const resumable = await findArchiveResumable(archive, { tree: w.a.tree, journal: archiveJournal(w.a.db) });
    expect(resumable).toMatchObject({ projectId: first.projectId, total: 9 });
    expect(resumable!.done).toBeLessThan(9);
    const filesBefore = (await w.a.mediaDb.getAll('files')).length;
    const second = await importArchive(archive, deps(w.a), { resume: true });
    expect(second.projectId).toBe(first.projectId);
    expect(second.resumable).toBe(false);
    expect(second.problems).toEqual([]);
    await sync(w.a);
    const pages = allPages(w.a, first.projectId);
    expect(pages.length).toBe(9);
    // Ningún archivo nuevo al seguir (los cinco ya estaban guardados o se guardaron una vez).
    expect((await w.a.mediaDb.getAll('files')).length - filesBefore).toBeLessThanOrEqual(5);
    expect((await w.a.mediaDb.getAll('files')).filter((f) => f.name === 'IMG_0412.JPG').length).toBe(2);
    for (const p of pages) {
      const was = await pageState(w.a, allPages(w.a, w.project).find((x) => x.title === p.title)!.id);
      const now = await pageState(w.a, p.id);
      expect(now.blocks, p.title).toEqual(was.blocks);
    }
    const ids = new Set(pages.map((p) => p.id));
    expect([...w.server.comments.values()].filter((c) => ids.has(c.page_id)).length).toBe(4);
  });

  it('si la persona escribió en una página antes de que la importación llegara a escribirla, lo importado va debajo', async () => {
    const w = await world();
    const archive = await openArchive(await openZip(await zipOf(w, w.a)));
    // La importación se corta al abrir "Día 1" para escribirla (ya anotó la huella que iba a escribir).
    let block = true;
    const docs = {
      open: async (id: string, o?: { seed?: boolean }) => {
        if (block && w.a.tree.get(id)?.title === 'Día 1' && w.a.tree.get(id)?.workspace_id !== w.project) throw new Error('corte');
        return w.a.docs.open(id, o);
      },
      close: w.a.docs.close.bind(w.a.docs),
      flush: w.a.docs.flush.bind(w.a.docs),
    };
    const first = await importArchive(archive, deps(w.a, { docs: docs as never }));
    expect(first.resumable).toBe(true);
    const day = allPages(w.a, first.projectId).find((p) => p.title === 'Día 1')!.id;
    await writeBlocks(w.a.docs, day, [{ type: 'paragraph', content: 'LO_QUE_ESCRIBIÓ_LA_PERSONA' }] as never);
    block = false;
    const second = await importArchive(archive, deps(w.a), { resume: true });
    expect(second.problems).toContain('Día 1: it already had other text; the imported content went below');
    const text = JSON.stringify((await pageState(w.a, day)).blocks);
    expect(text.indexOf('LO_QUE_ESCRIBIÓ_LA_PERSONA')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('Llovió')).toBeGreaterThan(text.indexOf('LO_QUE_ESCRIBIÓ_LA_PERSONA'));
  });

  it('con la base sin la migración (versión 17), los comentarios esperan; con la base al día, seguir los suma', async () => {
    const w = await world();
    const archive = await openArchive(await openZip(await zipOf(w, w.a)));
    const first = await importArchive(archive, deps(w.a, { schemaVersion: 17 }));
    expect(first.comments).toBe(0);
    expect(first.resumable).toBe(true);
    expect(first.problems.some((p) => p.includes('database'))).toBe(true);
    await sync(w.a);
    const second = await importArchive(archive, deps(w.a), { resume: true });
    expect(second.resumable).toBe(false);
    await sync(w.a);
    const ids = new Set(allPages(w.a, first.projectId).map((p) => p.id));
    expect([...w.server.comments.values()].filter((c) => ids.has(c.page_id)).length).toBe(4);
    expect(allPages(w.a, first.projectId).length).toBe(9);
  });

  it('un zip de otra app, cortado, de una versión más nueva o con el manifest roto: avisa y no crea nada', async () => {
    const w = await world();
    const projects = () => w.a.tree.projects().length;
    const before = projects();
    const zip = await zipOf(w, w.a);
    await expect(openZip(zip.slice(0, zip.size - 100))).rejects.toMatchObject({ code: 'damaged' });
    await expect(openZip(zip.slice(0, Math.floor(zip.size / 2)))).rejects.toMatchObject({ code: 'damaged' });
    const folder = (files: Record<string, string>): ArchiveSource =>
      folderSource(Object.entries(files).map(([p, text]) => Object.assign(new NodeFile([text], p.split('/').pop()!), { webkitRelativePath: `X/${p}` }) as unknown as File));
    await expect(openArchive(folder({ 'readme.txt': 'hola', 'otra/cosa.json': '{}' }))).rejects.toMatchObject({ code: 'notArchive' });
    await expect(openArchive(folder({ '_shotdocs/manifest.json': '{"format":2,"id":"x","pages":[]}' }))).rejects.toMatchObject({ code: 'newer' });
    await expect(openArchive(folder({ '_shotdocs/manifest.json': '{"format":1,"id":"x","pages":[' }))).rejects.toMatchObject({ code: 'badManifest' });
    await expect(openArchive(folder({ '_shotdocs/manifest.json': '{"id":"x"}' }))).rejects.toBeInstanceOf(ArchiveError);
    await expect(openArchive(folder({ '_shotdocs/manifest.json': '{"format":1,"pages":[]}' }))).rejects.toMatchObject({ code: 'badManifest' });
    expect(projects()).toBe(before);
    expect(new ArchiveError('newer').message).toMatch(/Update the app to import this archive/);
  });

  it('un manifest editado: rutas raras, páginas repetidas o con padres en círculo; nada se escribe afuera y nada se pierde', async () => {
    const w = await world();
    const P = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const page = (id: string, parent: string | null, title: string, json: string) => ({ id, parent, order: 0, title, icon: null, settings: {}, templateId: null, json, dir: '', html: '', md: '', complete: true });
    const files: Record<string, string> = {
      '_shotdocs/manifest.json': JSON.stringify({
        format: 1,
        id: 'a-mano',
        title: 'Hecho a mano',
        pages: [
          page(P(1), null, 'Uno', '../../afuera.json'),
          page(P(2), P(3), 'Dos', '_shotdocs/pages/2.json'),
          page(P(3), P(2), 'Tres', 'C:/Windows/x.json'),
          page(P(1), null, 'Uno otra vez', ''),
          { id: 'no-es-uuid', title: 'Mala' },
          page(P(4), null, 'Cuatro', '_shotdocs/pages/4.json'),
          // Marcas de plantilla que apuntan a páginas de afuera del archivo (otro proyecto): no se escriben (O6).
          { ...page(P(5), null, 'Ajena', ''), templateId: w.tpl, settings: { dayReports: { template: w.tpl }, split: true } },
          { ...page(P(6), null, 'Propia', ''), templateId: P(1), settings: { dayReports: { template: P(1) } } },
        ],
        files: [{ id: P(9), name: '../../evil.exe', mime: 'application/x-msdownload', kind: 'file', size: 3, original: '../evil.exe', view: null }],
      }),
      '_shotdocs/pages/2.json': JSON.stringify({ format: 1, id: P(2), blocks: [{ id: 'b', type: 'paragraph', content: [{ type: 'text', text: 'Texto de dos', styles: {} }] }, { id: 'c', type: 'image', props: { url: `sdmedia://${P(9)}`, name: 'evil.exe' } }] }),
      '_shotdocs/pages/4.json': '{"blocks": [ roto',
    };
    const src = folderSource(Object.entries(files).map(([p, text]) => Object.assign(new NodeFile([text], p.split('/').pop()!), { webkitRelativePath: `X/${p}` }) as unknown as File));
    const archive = await openArchive(src);
    expect(archive.manifest.pages.map((p) => p.title)).toEqual(['Uno', 'Dos', 'Tres', 'Cuatro', 'Ajena', 'Propia']);
    expect(archiveWeight(archive)).toMatchObject({ files: 0, missing: 1 });
    const result = await importArchive(archive, deps(w.a));
    // Las cuatro páginas están (Dos y Tres, en círculo, quedan una arriba), la de JSON roto creada y anotada.
    const pages = allPages(w.a, result.projectId);
    expect(pages.map((p) => p.title).sort()).toEqual(['Ajena', 'Cuatro', 'Dos', 'Propia', 'Tres', 'Uno']);
    const ajena = pages.find((p) => p.title === 'Ajena')!;
    expect(ajena.template_id ?? null).toBeNull();
    expect(ajena.settings).toEqual({ dayReports: {}, split: true });
    const propia = pages.find((p) => p.title === 'Propia')!;
    const uno = pages.find((p) => p.title === 'Uno')!.id;
    expect(propia.template_id).toBe(uno);
    expect(propia.settings).toEqual({ dayReports: { template: uno } });
    expect(result.problems.some((p) => p.startsWith('Cuatro:'))).toBe(true);
    expect(result.problems.some((p) => p.includes('appears twice'))).toBe(true);
    expect(result.problems.some((p) => p.includes('page 5 of the manifest'))).toBe(true);
    const dos = await pageState(w.a, pages.find((p) => p.title === 'Dos')!.id);
    expect(JSON.stringify(dos.blocks)).toContain('Texto de dos');
    expect(JSON.stringify(dos.blocks)).toContain(`evil.exe ${NOT_IN_ARCHIVE}`);
    expect(await w.a.mediaDb.getAll('files')).toHaveLength(5);
    // Cuatro quedó para reintentar; nada de esto pisa ni toca el proyecto original.
    expect(result.resumable).toBe(true);
  });

  it('un original vuelto a comprimir y más grande que el tope: la foto vuelve desde su vista y el video queda con su nombre, avisados (O2)', async () => {
    const w = await world();
    const archive = await openArchive(await openZip(await zipOf(w, w.a)));
    const originalOf = (name: string) => archive.manifest.files.find((f) => f.name === name)!.original!;
    const big = new Set([originalOf('IMG_0412.JPG'), originalOf('clip 001.mov')]);
    // El zip dice que esos dos son *deflate* de más de 1 GB (lo que hace `tooBig` con el índice de verdad: zipReader.test.ts).
    const source = { ...archive.source, tooBig: (p: string) => big.has(p) };
    const limited: ShotDocsArchive = { ...archive, source };
    expect(archiveWeight(limited)).toMatchObject({ tooBig: 2, previews: 1, missing: 1 });
    const result = await importArchive(limited, deps(w.a));
    expect(result.problems.some((p) => p.startsWith('Escena 1:') && p.includes('IMG_0412.JPG was compressed again'))).toBe(true);
    expect(result.problems.some((p) => p.startsWith('Escena 2:') && p.includes('clip 001.mov was compressed again'))).toBe(true);
    const scene2 = allPages(w.a, result.projectId).find((p) => p.title === 'Escena 2')!.id;
    expect(JSON.stringify((await pageState(w.a, scene2)).blocks)).toContain(`clip 001.mov ${NOT_IN_ARCHIVE}`);
    const scene = allPages(w.a, result.projectId).find((p) => p.title === 'Escena 1')!.id;
    expect(JSON.stringify((await pageState(w.a, scene)).blocks)).toContain('sdmedia://IMG_0412.jpg');
    expect(result.resumable).toBe(false);
  });

  it('sin lugar para un archivo: la página queda para seguir y el resto entra', async () => {
    const w = await world();
    const archive = await openArchive(await openZip(await zipOf(w, w.a)));
    const add = w.a.media.add.bind(w.a.media);
    let calls = 0;
    const media = {
      get enabled() {
        return w.a.media.enabled;
      },
      add: async (pageId: string, f: Blob & { name?: string }) => {
        if (++calls === 1) throw new Error('No space left on this device.');
        return add(pageId, f);
      },
    };
    const first = await importArchive(archive, deps(w.a, { media: media as never }));
    expect(first.resumable).toBe(true);
    expect(first.problems.some((p) => p.includes('No space left'))).toBe(true);
    const second = await importArchive(archive, deps(w.a), { resume: true });
    expect(second.resumable).toBe(false);
    const scene = allPages(w.a, first.projectId).find((p) => p.title === 'Escena 1')!.id;
    const state = await pageState(w.a, scene);
    // Al seguir, la página se reescribió con el archivo (nunca quedó un "not in the archive" de algo que sí estaba).
    expect(JSON.stringify(state.blocks)).not.toContain(NOT_IN_ARCHIVE);
    expect(JSON.stringify(state.blocks)).toContain('sdmedia://IMG_0412.JPG');
  });

  it('sin el Drive conectado, un archivo con fotos no empieza; uno solo de texto sí', async () => {
    const w = await world();
    const archive: ShotDocsArchive = await openArchive(await openZip(await zipOf(w, w.a)));
    const media = { enabled: false, add: async () => '' };
    await expect(importArchive(archive, deps(w.a, { media: media as never }))).rejects.toMatchObject({ code: 'needsDrive' });
    expect(w.a.tree.projects().filter((p) => p.name === 'Proyecto').length).toBeLessThanOrEqual(1);
  });
});
