// La prueba del zip de exportar en un navegador de verdad, entrega 2 (Docs/Doc_Exportar.md, "Cómo quedó la entrega 2").
// Solo para desarrollo: no es parte de la app (el build no la incluye) y no usa ninguna cuenta ni la red. Se abre con el
// servidor de vite:
//
//   npx vite --port 5201 --strictPort
//   http://127.0.0.1:5201/src/export/bench/zip.html?originals=1&comments=1
//
// Arma en el servidor en memoria (src/sync/testing.ts) una rama con fotos JPEG de verdad (hechas en un canvas, con sus
// miniaturas reales), un HEIC de verdad que no tiene miniatura (como uno que no se pudo convertir al subirlo), un video
// con su cuadro, un PDF, una tabla con una foto en una celda, un salto de hoja, un texto que se escribió y se borró y
// comentarios; otro dispositivo (sin los originales) arma el zip en memoria con lo mismo que la ventana *Export*
// (exportZip.ts): el editor de exportación, las vistas, los originales bajados por el portero en memoria y el HEIC pasado
// a JPEG con el convertidor de la app. Deja el zip en `window.__zip` (un `Blob`) y lo medido en `window.__zipInfo`; el
// script de afuera lo guarda, lo abre con Python (`testzip`) y abre cada `.html` con `file://` y sin red en Chromium y
// Firefox.
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import '../../ui/drive.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/instrument-serif/latin-400.css';
import '@fontsource/courier-prime/latin-400.css';
import '@fontsource/courier-prime/latin-700.css';
import '../../styles.css';
import { HEIC_SAMPLE } from '../../media/fixtures/heicSample';
import { BlobSink } from '../../media/folderZip';
import { mediaIdOf } from '../../media/queue';
import { prefs } from '../../prefs';
import { FakeServer, PORTERO_URL } from '../../sync/testing';
import { porteroDownload } from '../../ui/sharpImages';
import { appComments } from '../exportComments';
import { ExportEditor } from '../exportEditor';
import { exportPlan } from '../exportPages';
import { appArchiveMedia, buildZip, estimateZip, remoteOf } from '../exportZip';
import { writeBlocks } from '../testProject';
import { makeDevice, photoFile, storedHash, type Device } from './benchDevice';

const q = new URLSearchParams(location.search);
const ORIGINALS = q.get('originals') !== '0';
const COMMENTS = q.get('comments') !== '0';
const EMAIL = 'lega.supervisor@wanka.test';

prefs.init();
document.documentElement.dataset.theme = 'light';

const log = (...a: unknown[]) => {
  console.log('[zip]', ...a);
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

/** Un JPEG hecho en un canvas (el cuadro del video). */
async function frame(): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 270;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#2b4a6f';
  ctx.fillRect(0, 0, 480, 270);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 60px sans-serif';
  ctx.fillText('CLIP 001', 90, 150);
  return new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.85));
}

/** Un archivo que ya está en el Drive del dueño (sin pasar por la cola de este dispositivo). */
function driveFile(server: FakeServer, projectId: string, pageId: string, name: string, mime: string, data: Uint8Array, thumb: boolean): string {
  const id = crypto.randomUUID();
  const driveId = `drive-${id.slice(0, 8)}`;
  server.mediaFiles.set(id, {
    id,
    project_id: projectId,
    name,
    mime,
    size: data.length,
    width: null,
    height: null,
    duration: mime.startsWith('video/') ? 12 : null,
    thumb_at: thumb ? new Date().toISOString() : null,
    drive_id: driveId,
    trashed_at: null,
    purged_at: null,
    drive_trashed_at: null,
  });
  server.portero.drive.set(driveId, { file: id, data, folder: 'LGA_ShotDocs/Bench', name });
  server.pageFiles.add(`${pageId}:${id}`);
  return id;
}

async function run() {
  document.body.insertAdjacentHTML(
    'beforeend',
    '<pre id="bench-log" style="position:fixed;right:0;top:0;width:520px;max-height:100vh;overflow:auto;background:#fff;z-index:9;font:11px monospace;margin:0;padding:8px"></pre>',
  );
  const server = new FakeServer();
  server.enableComments();
  server.enableTrash();
  // Lo que la app pide al portero con `fetch` (los originales y el HEIC) va al portero en memoria; nada sale a la red.
  const realFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    return url.startsWith(PORTERO_URL) ? server.portero.fetch(input, init) : realFetch(input, init);
  };
  const a = await makeDevice(server);
  await sync(a);
  const projectId = server.workspaceId;
  const root = await a.tree.create(null, 'Rodaje · Semana 1');
  await a.tree.setSetting(root, 'format', { size: 'A4', landscape: false });
  const day1 = await a.tree.create(root, 'Día 1: exteriores');
  const day2 = await a.tree.create(root, 'Día 2');
  const notes = await a.tree.create(root, 'Notas');
  await a.tree.setSetting(notes, 'format', { size: 'A5', landscape: true });
  const outside = await a.tree.create(null, 'Afuera');
  await sync(a);
  const p1 = await a.media.add(day1, await photoFile(1));
  const p2 = await a.media.add(day1, await photoFile(3));
  const p3 = await a.media.add(day1, await photoFile(5));
  const pdf = await a.media.add(day1, new File(['%PDF-1.4 plano de set'], 'plano_set.pdf', { type: 'application/pdf' }));
  const heicBytes = Uint8Array.from(atob(HEIC_SAMPLE), (c) => c.charCodeAt(0));
  const heic = `sdmedia://${driveFile(server, projectId, day1, 'IMG_0413.HEIC', 'image/heic', heicBytes, false)}`;
  const videoId = driveFile(server, projectId, day1, 'clip 001.mov', 'video/quicktime', new TextEncoder().encode('video de prueba'), true);
  server.thumbs.set(videoId, await frame());
  const video = `sdmedia://${videoId}`;
  await writeBlocks(a.docs, notes, [{ type: 'paragraph', content: 'TEXTO_SECRETO_BORRADO' }] as never);
  await writeBlocks(a.docs, notes, [{ type: 'paragraph', content: 'Notas del día, en A5 horizontal.' }] as never);
  await writeBlocks(a.docs, day1, [
    { type: 'heading', props: { level: 2 }, content: 'EXT. PUERTO - DÍA' },
    {
      type: 'paragraph',
      content: ['Plano general, ver ', { type: 'link', href: `/p/${day2}`, content: 'el día 2' }, ' y ', { type: 'link', href: `/p/${outside}`, content: 'la otra rama' }, '.'],
    },
    { type: 'image', props: { url: p1, name: 'IMG_0001.jpg', previewWidth: 320 } },
    { type: 'image', props: { url: heic, name: 'IMG_0413.HEIC', previewWidth: 200 } },
    { type: 'paragraph', props: { pageBreak: true } },
    { type: 'image', props: { url: video, name: 'clip 001.mov' } },
    { type: 'image', props: { url: pdf, name: 'plano_set.pdf' } },
    {
      type: 'table',
      content: {
        type: 'tableContent',
        rows: [
          { cells: ['Plano', 'Foto'] },
          { cells: ['1A', [{ type: 'photo', props: { url: p3, name: 'IMG_0005.jpg', w: 0 } }]] },
        ],
      },
    },
    { type: 'paragraph', props: { script: true }, content: 'INT. CASA - NOCHE' },
  ] as never);
  await writeBlocks(a.docs, day2, [
    { type: 'paragraph', content: 'La misma foto de referencia, y otra.' },
    { type: 'image', props: { url: p1, name: 'IMG_0001.jpg', previewWidth: 240 } },
    { type: 'image', props: { url: p2, name: 'IMG_0003.jpg', previewWidth: 240 } },
  ] as never);
  await a.comments.add(day1, null, 'Cambiar el lente a 35');
  await sync(a);
  await a.media.idle();
  for (let quiet = 0; quiet < 3; ) {
    await a.engine.syncMedia();
    quiet = (await a.media.status()).pending === 0 ? quiet + 1 : 0;
    await new Promise((r) => setTimeout(r, 200));
  }
  await sync(a);
  log('armado', Object.fromEntries(Object.entries({ p1, p2, p3, pdf, heic, video }).map(([k, v]) => [k, mediaIdOf(v)])));

  // Otro dispositivo del dueño, sin los originales: exporta.
  const b = await makeDevice(server);
  await sync(b);
  const plan = exportPlan(b.tree, 'page', root);
  const before = await Promise.all(plan.map((p) => storedHash(b, p.id)));
  const media = appArchiveMedia(b.media, b.mediaDb, porteroDownload(b.media));
  const include = { originals: ORIGINALS, attachments: ORIGINALS, videos: ORIGINALS, comments: COMMENTS };
  const t0 = performance.now();
  const estimate = await estimateZip(plan, b.docs, media);
  const editor = await ExportEditor.create({ resolveFileUrl: (url, pageId) => b.media.resolve(url, pageId), media: b.media });
  const sink = new BlobSink();
  const calls = server.portero.calls.length;
  try {
    const result = await buildZip({
      title: b.tree.get(root)!.title,
      kind: 'page',
      plan,
      rows: (id) => b.tree.get(id),
      source: b.docs,
      editor,
      media,
      include,
      comments: COMMENTS ? appComments(b.comments, b.commentsDb, { id: b.remote.userId, email: EMAIL }) : null,
      me: { id: b.remote.userId, email: EMAIL },
      online: true,
      target: { kind: 'zip', sink },
      expected: remoteOf(estimate, include),
      appVersion: '0.129',
      lastSync: b.engine.getStatus().lastSyncAt,
    });
    const after = await Promise.all(plan.map((p) => storedHash(b, p.id)));
    const zip = sink.blob();
    (window as unknown as { __zip: Blob }).__zip = zip;
    const info = {
      ms: Math.round(performance.now() - t0),
      bytes: zip.size,
      pages: result.pages,
      files: result.files,
      downloaded: result.downloaded,
      missing: result.missing,
      porteroCalls: server.portero.calls.slice(calls).map((c) => `${c.method} ${c.path.replace(/[0-9a-f-]{8,}/g, '…')}`),
      changed: after.filter((h, i) => h !== before[i]).length,
      estimate: { files: estimate.files, previews: estimate.previews },
    };
    (window as unknown as { __zipInfo: unknown }).__zipInfo = info;
    log(JSON.stringify(info, null, 1));
    document.body.dataset.benchDone = '1';
  } finally {
    editor.destroy();
  }
}

run().catch((err: unknown) => {
  console.error(err);
  (window as unknown as { __zipInfo: unknown }).__zipInfo = { error: String(err instanceof Error ? (err.stack ?? err.message) : err) };
  document.body.dataset.benchDone = 'error';
  log('ERROR', String(err instanceof Error ? (err.stack ?? err.message) : err));
});
