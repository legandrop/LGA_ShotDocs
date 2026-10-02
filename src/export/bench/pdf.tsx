// La medición del PDF de exportar, entrega 1 (Docs/Doc_Exportar.md, "Cómo quedó la entrega 1"). Solo para desarrollo:
// no es parte de la app (el build no la incluye) y no usa ninguna cuenta ni la red. Se abre con el servidor de vite:
//
//   npx vite --port 5189 --strictPort
//   http://127.0.0.1:5189/src/export/bench/pdf.html?pages=300&photos=8&print=1
//
// Arma el proyecto de prueba (testProject.ts) en el servidor en memoria (src/sync/testing.ts) con fotos de verdad,
// comentarios en algunas páginas y una página en la papelera, y arma el PDF con lo mismo que la ventana *Export*
// (exportPdf.ts): el editor de exportación, las fotos achicadas del dispositivo, los comentarios. Mide el tiempo, la
// memoria y los píxeles, comprueba que nada guardado cambió y, con `print=1`, abre el diálogo de imprimir de verdad
// (`window.print()`). Con Chrome o Edge abiertos con `--kiosk-printing` y *Save as PDF* elegido, el PDF se guarda
// solo; el script de afuera lo lee con pdf.js y lo compara con `window.__pdf` (las hojas de cada página).
//
// Parámetros: `pages`, `photos`, `scope=project|branch` (la rama: la segunda de primer nivel), `comments=0|1`,
// `named=auto|0|1` (las hojas con nombre: lo que diga la lista de navegadores, o forzado).
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import '../../ui/drive.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/instrument-serif/latin-400.css';
import '@fontsource/courier-prime/latin-400.css';
import '@fontsource/courier-prime/latin-700.css';
import '../../styles.css';
import { prefs } from '../../prefs';
import { FakeServer } from '../../sync/testing';
import { appComments } from '../exportComments';
import { ExportEditor } from '../exportEditor';
import { deviceImages } from '../exportImages';
import { exportPlan } from '../exportPages';
import { buildPdf, PDF_LIMITS, printBook, type PdfBook } from '../exportPdf';
import { keepsPageSizes } from '../printSupport';
import { testProject, writeBlocks, type TestPageSpec } from '../testProject';
import { makeDevice, photoFile, placeholders, storedHash, withUrls } from './benchDevice';

const q = new URLSearchParams(location.search);
const PAGES = Number(q.get('pages') ?? 60);
const PHOTOS = Number(q.get('photos') ?? 6);
const SCOPE = q.get('scope') === 'branch' ? 'branch' : 'project';
const COMMENTS = q.get('comments') !== '0';
const NAMED = q.get('named') === '1' ? true : q.get('named') === '0' ? false : keepsPageSizes();
const PRINT = q.get('print') === '1';

prefs.init();
document.documentElement.dataset.theme = 'light';

const log = (...a: unknown[]) => {
  console.log('[pdf]', ...a);
  const el = document.getElementById('bench-log');
  if (el) el.textContent += a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n';
};

const heap = () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;

async function run() {
  document.body.insertAdjacentHTML(
    'beforeend',
    '<pre id="bench-log" style="position:fixed;right:0;top:0;width:520px;max-height:100vh;overflow:auto;background:#fff;z-index:9;font:11px monospace;margin:0;padding:8px"></pre>',
  );
  const phase = (name: string) => (document.body.dataset.phase = name);
  phase('setup');
  const t0 = performance.now();
  const server = new FakeServer();
  server.enableMedia();
  server.enableComments();
  const d = await makeDevice(server);
  await d.engine.syncNow();

  const specs: TestPageSpec[] = testProject({ pages: PAGES, photosPerPage: PHOTOS, seed: 22 }, (n) => ({ url: `bench://${n}`, name: `IMG_${String(n).padStart(4, '0')}.jpg` }));
  const projectId = await d.tree.createProject('Proyecto secreto de prueba');
  const ids = new Map<string, string>();
  for (const s of specs) {
    const id = await d.tree.create(s.parent ? ids.get(s.parent)! : null, s.title, projectId);
    ids.set(s.key, id);
    if (s.format) await d.tree.setSetting(id, 'format', s.format);
  }
  await d.engine.syncNow();
  let photos = 0;
  for (const [i, s] of specs.entries()) {
    const pageId = ids.get(s.key)!;
    const urls = new Map<string, string>();
    for (const p of placeholders(s.blocks)) {
      urls.set(p, await d.media.add(pageId, await photoFile(Number(p.slice('bench://'.length)))));
      photos++;
    }
    let blocks = withUrls(s.blocks, urls) as TestPageSpec['blocks'];
    // Un link a la página siguiente (adentro del PDF) y uno a la raíz de la primera rama (afuera, si se exporta otra).
    const next = specs[i + 1] ? ids.get(specs[i + 1].key)! : null;
    if (next && blocks.length > 0) {
      blocks = [
        ...blocks,
        { type: 'paragraph', content: [{ type: 'link', href: `/p/${next}`, content: 'Next page' }, ' · ', { type: 'link', href: `/p/${ids.get('1')}`, content: 'Root one' }] },
      ] as TestPageSpec['blocks'];
    }
    if (blocks.length > 0) await writeBlocks(d.docs, pageId, blocks);
    if (i % 20 === 0) log(`armado ${i + 1}/${specs.length} (${photos} fotos)`);
  }
  // Comentarios en algunas páginas (uno con correo en el autor: nunca tiene que salir en el PDF).
  if (COMMENTS) {
    for (const s of specs.filter((_, i) => i % 7 === 3)) {
      const page = ids.get(s.key)!;
      const thread = await d.comments.add(page, null, `Comentario de prueba en ${s.title}`);
      await d.comments.add(page, null, 'Respuesta', thread);
    }
  }
  // Una página en la papelera: no sale.
  const trashedSpec = specs.find((s) => s.parent === '2' && s.key !== '2.1');
  if (trashedSpec) await d.tree.trash(ids.get(trashedSpec.key)!);
  await d.engine.syncNow();
  await d.comments.run();
  const setupMs = performance.now() - t0;
  log(`proyecto: ${specs.length} páginas, ${photos} fotos, ${Math.round(setupMs / 1000)} s`);

  const target = SCOPE === 'branch' ? { kind: 'page' as const, id: ids.get('2')! } : { kind: 'project' as const, id: projectId };
  const plan = exportPlan(d.tree, target.kind, target.id);
  const title = SCOPE === 'branch' ? d.tree.get(target.id)!.title : 'Proyecto secreto de prueba';

  const before = new Map<string, string>();
  for (const p of plan) before.set(p.id, await storedHash(d, p.id));
  const opsBefore = d.tree.pendingOps().length;
  const commentsBefore = JSON.stringify(await d.commentsDb.getAll('comments'));

  phase('export');
  const heapBefore = heap();
  const te = performance.now();
  const editor = await ExportEditor.create({ resolveFileUrl: (url, pageId) => d.media.resolve(url, pageId), media: d.media });
  let book: PdfBook;
  try {
    book = await buildPdf({
      title,
      plan,
      source: d.docs,
      editor,
      images: deviceImages(d.media),
      comments: COMMENTS ? appComments(d.comments, d.commentsDb, { id: d.remote.userId, email: 'lega.supervisor@wanka.test' }) : null,
      named: NAMED,
      limits: PDF_LIMITS.desktop,
      lastSync: d.engine.getStatus().lastSyncAt,
      onProgress: (p) => p.done % 25 === 0 && log(`página ${p.done}/${p.total}`),
    });
  } finally {
    editor.destroy();
  }
  const buildMs = performance.now() - te;
  const heapAfter = heap();
  phase('built');

  const changed: string[] = [];
  for (const p of plan) if ((await storedHash(d, p.id)) !== before.get(p.id)) changed.push(p.id);
  const commentsSame = JSON.stringify(await d.commentsDb.getAll('comments')) === commentsBefore;

  const text = book.root.textContent ?? '';
  const result = {
    pages: plan.length,
    photos,
    scope: SCOPE,
    named: NAMED,
    title,
    fileTitle: book.fileTitle,
    sheets: book.sheets,
    indexSheets: book.indexSheets,
    buildMs: Math.round(buildMs),
    heapMB: heapBefore !== null && heapAfter !== null ? { before: Math.round(heapBefore / 1e6), after: Math.round(heapAfter / 1e6) } : null,
    pixelsM: Math.round(book.pixels / 1e5) / 10,
    images: book.root.querySelectorAll('img').length,
    blobImages: book.root.querySelectorAll('img[src^="blob:"]').length,
    imagesTimedOut: book.pages.filter((p) => p.imagesTimedOut).length,
    commentSections: book.root.querySelectorAll('.sd-export-comments').length,
    hasEmail: /@/.test(text),
    hasProjectName: SCOPE === 'branch' && text.includes('Proyecto secreto de prueba'),
    hasTrashed: trashedSpec ? plan.some((p) => p.id === ids.get(trashedSpec.key)) : false,
    internalLinks: book.root.querySelectorAll('a[href^="#sd-x-"]').length,
    appLinks: book.root.querySelectorAll('a[href^="/p/"]').length,
    unchanged: { pagesChanged: changed.length, treeOpsBefore: opsBefore, treeOpsAfter: d.tree.pendingOps().length, commentsSame },
    book: book.pages.map((p) => ({ id: p.id, title: p.title, start: p.start, sheets: p.sheets, size: p.format.size, landscape: p.format.landscape })),
  };
  (window as unknown as { __pdf: unknown }).__pdf = result;
  log(JSON.stringify({ ...result, book: `${result.book.length} páginas` }, null, 2));
  document.body.dataset.benchDone = '1';
  if (PRINT) {
    phase('print');
    // El mismo camino que la ventana: el diálogo de imprimir de verdad.
    // Un momento antes: mientras el diálogo está abierto la página no contesta (el script de afuera lee `__pdf` antes).
    setTimeout(() => printBook(book, { onDone: () => (document.body.dataset.printed = '1') }), 1500);
  }
}

run().catch((err: unknown) => {
  console.error(err);
  (window as unknown as { __pdf: unknown }).__pdf = { error: String(err instanceof Error ? (err.stack ?? err.message) : err) };
  document.body.dataset.benchDone = 'error';
  log('ERROR', String(err instanceof Error ? (err.stack ?? err.message) : err));
});
