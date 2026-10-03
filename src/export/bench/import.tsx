// La vuelta del zip en un navegador de verdad, entrega 3 (Docs/Doc_Exportar.md, "Cómo quedó la entrega 3"). Solo para
// desarrollo: no es parte de la app (el build no la incluye) y no usa ninguna cuenta ni la red. Se abre con el servidor
// de vite:
//
//   npx vite --port 5237 --strictPort
//   http://127.0.0.1:5237/src/export/bench/import.html
//
// Arma en el servidor en memoria (src/sync/testing.ts) un proyecto con fotos JPEG de verdad (hechas en un canvas, con sus
// miniaturas reales), una anotada, una en línea, una en una celda, un video con su cuadro, un PDF, un título colapsado
// para todos, una plantilla propia con su carpeta de reportes, subpáginas y comentarios; otro dispositivo del dueño lo
// exporta como zip (exportZip.ts, con los originales) y lo deja en `window.__zip`. Después dibuja la ventana de verdad
// *Import Shot Docs archive* (ImportArchiveDialog.tsx) para un tercer dispositivo: el script de afuera elige el zip con
// el selector de archivo y aprieta *Import*. `window.__check()` compara después cada página, bloque por bloque.
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import '../../ui/drive.css';
import '../../styles.css';
import { createRoot } from 'react-dom/client';
import { importJobFor } from '../../import/importJob';
import { addShape, PHOTO_MARKUP_MAP } from '../../media/markup';
import { BlobSink } from '../../media/folderZip';
import { mediaIdOf } from '../../media/queue';
import { prefs } from '../../prefs';
import { ServicesContext } from '../../services';
import { ARCHIVE_COMMENTS_SCHEMA_VERSION } from '../../sync/comments';
import { FakeServer, PORTERO_URL } from '../../sync/testing';
import { ImportArchiveDialog } from '../../ui/ImportArchiveDialog';
import { SHARED_COLLAPSE_MAP } from '../../ui/collapseEditor';
import { porteroDownload } from '../../ui/sharpImages';
import { appComments } from '../exportComments';
import { ExportEditor } from '../exportEditor';
import { exportPlan } from '../exportPages';
import { appArchiveMedia, buildZip } from '../exportZip';
import { readPageContent } from '../pageContent';
import { writeBlocks } from '../testProject';
import { makeDevice, photoFile, servicesOf, type Device } from './benchDevice';

const EMAIL = 'lega.supervisor@wanka.test';

prefs.init();
document.documentElement.dataset.theme = 'light';

const log = (...a: unknown[]) => {
  console.log('[import]', ...a);
  const el = document.getElementById('bench-log');
  if (el) el.textContent += a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n';
};

async function sync(d: Device) {
  for (let i = 0; i < 2; i++) {
    await d.engine.syncNow();
    await d.engine.syncMedia();
  }
  await d.comments.run();
  await d.engine.syncNow();
}

async function settle(d: Device) {
  await d.media.idle();
  for (let quiet = 0; quiet < 3; ) {
    await d.engine.syncMedia();
    quiet = (await d.media.status()).pending === 0 ? quiet + 1 : 0;
    await new Promise((r) => setTimeout(r, 150));
  }
  await sync(d);
}

/** Los bloques, el colapsado y las anotaciones de una página, con cada archivo por su nombre y cada página por su título. */
async function pageState(d: Device, pageId: string) {
  const snap = await d.docs.snapshot(pageId);
  try {
    const c = readPageContent(snap.doc);
    const text = JSON.stringify(c.blocks);
    const names = new Map<string, string>();
    for (const m of text.matchAll(/sdmedia:\/\/([0-9a-f-]{36})/g)) names.set(m[1], (await d.mediaDb.get('files', m[1]))?.name ?? (await d.mediaDb.get('known', m[1]))?.name ?? '?');
    for (const p of c.photoMarkup) if (!names.has(p.fileId)) names.set(p.fileId, '?');
    const normal = text.replace(/sdmedia:\/\/([0-9a-f-]{36})/g, (_, id: string) => `sdmedia://${names.get(id)}`).replace(/\/p\/([0-9a-f-]{36})/g, (_, id: string) => `/p/${d.tree.get(id)?.title ?? '?'}`);
    return {
      blocks: normal,
      collapsed: JSON.stringify(c.collapsedForAll),
      markup: JSON.stringify(c.photoMarkup.map((p) => ({ file: names.get(p.fileId), frame: p.frame, shapes: p.shapes }))),
      markupKeys: snap.doc.getMap(PHOTO_MARKUP_MAP).size,
    };
  } finally {
    snap.doc.destroy();
  }
}

function pagesOf(d: Device, projectId: string) {
  const out: { id: string; title: string; depth: number; settings: unknown; icon: string | null; template: string | null }[] = [];
  const walk = (list: ReturnType<Device['tree']['children']>, depth: number) => {
    for (const p of list) {
      out.push({ id: p.id, title: p.title, depth, settings: p.settings ?? {}, icon: p.icon ?? null, template: p.template_id ? (d.tree.get(p.template_id)?.title ?? p.template_id) : null });
      walk(d.tree.children(p.id), depth + 1);
    }
  };
  walk(d.tree.roots(projectId), 0);
  return out;
}

async function run() {
  document.body.insertAdjacentHTML(
    'beforeend',
    '<pre id="bench-log" style="position:fixed;right:0;bottom:0;width:420px;max-height:40vh;overflow:auto;background:#fff;z-index:9;font:11px monospace;margin:0;padding:8px"></pre>',
  );
  const server = new FakeServer();
  server.enableComments();
  server.enableTrash();
  server.importCommentsEnabled = true;
  server.settings = { ...server.settings!, schemaVersion: ARCHIVE_COMMENTS_SCHEMA_VERSION };
  const realFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    return url.startsWith(PORTERO_URL) ? server.portero.fetch(input, init) : realFetch(input, init);
  };
  const a = await makeDevice(server);
  await sync(a);
  const project = server.workspaceId;
  const root = await a.tree.create(null, 'Rodaje · Semana 1');
  await a.tree.setSetting(root, 'format', { size: 'A4', landscape: false });
  const scene = await a.tree.create(root, 'Escena 12');
  const take = await a.tree.create(scene, 'Toma 12A');
  const templates = await a.tree.create(null, 'Templates');
  await a.tree.setSetting(templates, 'templatesFolder', true);
  const tpl = await a.tree.create(templates, 'Plantilla de escena');
  await a.tree.setSetting(tpl, 'template', { description: 'Para cada escena', dayReport: true });
  const reports = await a.tree.create(null, 'Reportes');
  await a.tree.setSetting(reports, 'dayReports', { template: tpl });
  const day = await a.tree.create(reports, 'Día 1', undefined, { templateId: tpl });
  await sync(a);
  const p1 = await a.media.add(scene, await photoFile(1));
  const p2 = await a.media.add(scene, await photoFile(2));
  const p3 = await a.media.add(scene, await photoFile(3));
  const pdf = await a.media.add(day, new File(['%PDF-1.4 plano de set'], 'plano_set.pdf', { type: 'application/pdf' }));
  const headingId = crypto.randomUUID();
  const planoId = crypto.randomUUID();
  await writeBlocks(a.docs, scene, [
    { id: headingId, type: 'heading', props: { level: 2 }, content: 'EXT. PUERTO - DÍA', children: [{ type: 'paragraph', content: 'Adentro del título colapsado' }] },
    { id: planoId, type: 'paragraph', content: ['Plano general, ver ', { type: 'link', href: `/p/${day}`, content: 'el día 1' }, ' y ', { type: 'photo', props: { url: p2, name: 'IMG_0002.jpg', w: 160 } }] },
    { type: 'paragraph', props: { script: true }, content: 'INT. CASA - NOCHE' },
    { type: 'paragraph', props: { question: true }, content: '¿Qué lente?' },
    { type: 'image', props: { url: p1, name: 'IMG_0001.jpg', previewWidth: 320 } },
    { type: 'paragraph', props: { pageBreak: true } },
    { type: 'table', content: { type: 'tableContent', rows: [{ cells: ['Plano', 'Foto'] }, { cells: ['1A', [{ type: 'photo', props: { url: p3, name: 'IMG_0003.jpg', w: 0 } }]] }] } },
  ] as never);
  const doc = await a.docs.open(scene);
  doc.getMap(SHARED_COLLAPSE_MAP).set(headingId, true);
  addShape(doc, mediaIdOf(p1)!, 'flecha', { type: 'arrow', posX: 0, posY: 0, startX: 200, startY: 200, endX: 900, endY: 700, strokeColor: '#FF3B30', strokeWidth: 12, z: 1 }, { w: 1600, h: 1200 });
  addShape(doc, mediaIdOf(p1)!, 'nota', { type: 'text', posX: 900, posY: 650, text: 'Cambiar el fondo', fontSize: 60, z: 2 }, { w: 1600, h: 1200 });
  a.docs.close(scene);
  await a.docs.flush();
  await writeBlocks(a.docs, take, [{ type: 'paragraph', content: 'La misma foto de referencia' }, { type: 'image', props: { url: p1, name: 'IMG_0001.jpg', previewWidth: 240 } }] as never);
  await writeBlocks(a.docs, tpl, [{ type: 'heading', props: { level: 2 }, content: 'Plano' }, { type: 'paragraph', content: '' }] as never);
  await writeBlocks(a.docs, day, [{ type: 'heading', props: { level: 2 }, content: 'Plano' }, { type: 'paragraph', content: 'Llovió toda la mañana.' }, { type: 'image', props: { url: pdf, name: 'plano_set.pdf' } }] as never);
  const thread = await a.comments.add(scene, planoId, 'Cambiar el lente a 35');
  await a.comments.add(scene, null, 'Listo, lo cambio', thread);
  await settle(a);
  log('armado');

  // Otro dispositivo del dueño exporta el proyecto entero, con los originales.
  const b = await makeDevice(server);
  await sync(b);
  const editor = await ExportEditor.create({ resolveFileUrl: (url, pageId) => b.media.resolve(url, pageId), media: b.media });
  const sink = new BlobSink();
  try {
    await buildZip({
      title: b.tree.project(project)?.name ?? 'Proyecto',
      kind: 'project',
      project: { id: project, name: b.tree.project(project)?.name ?? 'Proyecto' },
      plan: exportPlan(b.tree, 'project', project),
      rows: (id) => b.tree.get(id),
      source: b.docs,
      editor,
      media: appArchiveMedia(b.media, b.mediaDb, porteroDownload(b.media)),
      include: { originals: true, attachments: true, videos: true, comments: true },
      comments: appComments(b.comments, b.commentsDb, { id: b.remote.userId, email: EMAIL }),
      me: { id: b.remote.userId, email: EMAIL },
      online: true,
      target: { kind: 'zip', sink },
      appVersion: '0.135',
      lastSync: b.engine.getStatus().lastSyncAt,
    });
  } finally {
    editor.destroy();
  }
  const zip = sink.blob();
  (window as unknown as { __zip: Blob }).__zip = zip;
  log('zip', zip.size);

  // El tercer dispositivo (el mismo dueño, con su correo) importa con la ventana de verdad.
  const c = await makeDevice(server);
  await sync(c);
  const services = { ...servicesOf(c), user: { id: c.remote.userId, email: EMAIL } } as never;
  const job = importJobFor(c.tree);
  job.show('archive');
  const host = document.getElementById('root')!;
  createRoot(host).render(
    <ServicesContext.Provider value={services}>
      <ImportArchiveDialog />
    </ServicesContext.Provider>,
  );

  (window as unknown as { __check: () => Promise<unknown> }).__check = async () => {
    const result = job.get().archiveResult;
    if (!result) return { error: 'sin resultado' };
    await settle(c);
    const before = pagesOf(a, project);
    const after = pagesOf(c, result.projectId);
    const differences: string[] = [];
    let blocks = 0;
    if (before.length !== after.length) differences.push(`páginas: ${before.length} → ${after.length}`);
    for (const [i, was] of before.entries()) {
      const now = after[i];
      if (!now) continue;
      const shape = (p: typeof was) => JSON.stringify({ title: p.title, depth: p.depth, icon: p.icon, template: p.template });
      if (shape(was) !== shape(now)) differences.push(`árbol ${i}: ${shape(was)} → ${shape(now)}`);
      const x = await pageState(a, was.id);
      const y = await pageState(c, now.id);
      blocks += (x.blocks.match(/"id":/g) ?? []).length;
      for (const k of ['blocks', 'collapsed', 'markup'] as const) if (x[k] !== y[k]) differences.push(`${was.title} · ${k}`);
    }
    const files = await c.mediaDb.getAll('files');
    const originals = await a.mediaDb.getAll('files');
    for (const f of files) {
      const o = originals.find((x) => x.name === f.name);
      const fb = await c.mediaDb.get('blobs', f.id);
      const ob = o ? await a.mediaDb.get('blobs', o.id) : undefined;
      let same = !!fb && !!ob && fb.size === ob.size;
      if (same) {
        const x = new Uint8Array(await fb!.arrayBuffer());
        const y = new Uint8Array(await ob!.arrayBuffer());
        same = x.every((v, i) => v === y[i]);
      }
      if (!o || f.size !== o.size || !same) differences.push(`archivo ${f.name}`);
      if (f.pending) differences.push(`archivo sin subir ${f.name}`);
    }
    const ids = new Set(after.map((p) => p.id));
    const comments = [...server.comments.values()].filter((r) => ids.has(r.page_id)).map((r) => ({ body: r.body, mine: r.author_id === c.remote.userId, from: r.imported_from, email: r.imported_author_email }));
    return { result, pages: after.length, blocks, files: files.length, comments, differences };
  };
  document.body.dataset.benchDone = '1';
  log('listo');
}

run().catch((err: unknown) => {
  console.error(err);
  document.body.dataset.benchDone = 'error';
  log('ERROR', String(err instanceof Error ? (err.stack ?? err.message) : err));
});
