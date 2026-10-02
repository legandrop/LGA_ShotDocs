// La medición de exportar, entrega 0 (Docs/Doc_Exportar.md, "Cómo quedó la entrega 0"). Solo para desarrollo: no es
// parte de la app (el build no la incluye) y no usa ninguna cuenta ni la red. Se abre con el servidor de vite:
//
//   npx vite --port 5295 --strictPort
//   http://127.0.0.1:5295/src/export/bench/index.html?pages=300&photos=8
//
// Arma un proyecto de prueba de N páginas (testProject.ts) en el servidor en memoria de las pruebas
// (src/sync/testing.ts), con fotos de verdad (JPEG hechos en un canvas, guardados con la cola de fotos de la app, que
// hace sus miniaturas), y mide la prueba de aceptación de la entrega 0:
//  1. Las marcas de la pantalla: cada página abierta en la página de la app (PageView, con su editor y SheetBreaks).
//  2. Lo guardado de cada página, antes (SHA-256 de sus filas, su estado y el documento armado).
//  3. Exportar todo el proyecto con el editor de exportación, medido.
//  4. Lo guardado, después: tiene que ser igual byte por byte; y la página abierta no recibe nada.
//  5. Las hojas de cada página exportada contra las marcas de la pantalla.
// El resultado queda en `window.__bench` y en la pantalla.
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import '../../ui/drive.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/instrument-serif/latin-400.css';
import '@fontsource/courier-prime/latin-400.css';
import '@fontsource/courier-prime/latin-700.css';
import '../../styles.css';
import { createRoot } from 'react-dom/client';
import * as Y from 'yjs';
import { prefs } from '../../prefs';
import { ServicesContext } from '../../services';
import { FakeServer } from '../../sync/testing';
import { pageFormat } from '../../ui/pageFormat';
import { PageView } from '../../ui/PageView';
import { imagesPending } from '../../ui/printPage';
import { buildPrintView, paginateView } from '../../ui/printView';
import { ExportEditor } from '../exportEditor';
import { exportPlan, renderPages, type ExportedPage } from '../exportPages';
import { testProject, writeBlocks, type TestPageSpec } from '../testProject';
import { makeDevice, photoFile, placeholders, servicesOf, sha256, storedHash, withUrls, type Device } from './benchDevice';

const q = new URLSearchParams(location.search);
const PAGES = Number(q.get('pages') ?? 300);
const PHOTOS = Number(q.get('photos') ?? 8);
/** `0`: sin la fase de la pantalla (solo exportar). */
const SCREEN = q.get('screen') !== '0';
/** `keep`: las vistas de todas las páginas quedan juntas en el documento (como el PDF de la entrega 1). */
const KEEP = q.get('keep') === '1';

prefs.init();
document.documentElement.dataset.theme = 'light';

const log = (...a: unknown[]) => {
  console.log('[bench]', ...a);
  const el = document.getElementById('bench-log');
  if (el) el.textContent += a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n';
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function stats(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
  const round = (x: number) => Math.round(x * 10) / 10;
  return { p50: round(at(0.5)), p95: round(at(0.95)), max: round(s[s.length - 1] ?? 0), sum: round(s.reduce((a, b) => a + b, 0)) };
}

const heap = () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;

interface ScreenPage {
  id: string;
  /** Las marcas dibujadas por SheetBreaks (`.sheet-break`) + 1. */
  domSheets: number;
  /** El mismo cálculo que SheetBreaks, con las claves. */
  sheets: number;
  breaks: { key: string; offset: number }[];
  header: string[];
  ms: number;
}

/** Abre cada página en la página de la app y lee sus marcas de hoja. */
async function screenPhase(d: Device, ids: string[], main: HTMLElement): Promise<ScreenPage[]> {
  const out: ScreenPage[] = [];
  const root = createRoot(main);
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const t0 = performance.now();
    root.render(
      <ServicesContext.Provider value={servicesOf(d)}>
        <PageView key={id} id={id} />
      </ServicesContext.Provider>,
    );
    let article: HTMLElement | null = null;
    for (let k = 0; k < 400; k++) {
      article = main.querySelector<HTMLElement>(`article.page[data-page-id="${id}"]`);
      if (article?.querySelector('.editor-host .bn-editor')) break;
      await wait(25);
    }
    if (!article?.querySelector('.editor-host .bn-editor')) throw new Error(`La página ${id} no abrió`);
    // Las imágenes, y después que las marcas queden quietas (SheetBreaks recalcula con una pausa de 120 ms).
    for (let k = 0; k < 400 && imagesPending(article); k++) await wait(25);
    let last = -1;
    let still = 0;
    for (let k = 0; k < 80 && still < 3; k++) {
      await wait(150);
      const n = main.querySelectorAll('.sheet-break, .sheet-inside').length;
      still = n === last ? still + 1 : 0;
      last = n;
    }
    const format = pageFormat(d.tree, id);
    const view = buildPrintView(article, format, 'measure');
    let result;
    try {
      result = paginateView(view);
    } finally {
      view.root.remove();
    }
    out.push({
      id,
      domSheets: last + 1,
      sheets: result.pagination.sheets,
      breaks: result.pagination.breaks.map((b) => ({ key: b.key, offset: Math.round(b.offset * 10) / 10 })),
      header: [...article.querySelectorAll('.page-header .ancestor')].map((el) => el.textContent ?? ''),
      ms: performance.now() - t0,
    });
    if (i % 20 === 0) log(`pantalla ${i + 1}/${ids.length}`);
  }
  root.unmount();
  return out;
}

async function run() {
  document.body.insertAdjacentHTML(
    'beforeend',
    '<pre id="bench-log" style="position:fixed;right:0;top:0;width:520px;max-height:100vh;overflow:auto;background:#fff;z-index:9;font:11px monospace;margin:0;padding:8px"></pre>',
  );
  const main = document.createElement('main');
  main.className = 'main';
  document.getElementById('root')!.append(main);

  const phase = (name: string) => (document.body.dataset.phase = name);
  phase('setup');
  const t0 = performance.now();
  const server = new FakeServer();
  server.enableMedia();
  server.enableComments();
  const d = await makeDevice(server);
  await d.engine.syncNow();

  // El proyecto: el árbol primero, después las fotos de cada página (la cola de la app) y los bloques.
  const specs: TestPageSpec[] = testProject({ pages: PAGES, photosPerPage: PHOTOS, seed: 22 }, (n) => ({ url: `bench://${n}`, name: `IMG_${String(n).padStart(4, '0')}.jpg` }));
  const projectId = await d.tree.createProject('Proyecto de prueba');
  const ids = new Map<string, string>();
  for (const s of specs) {
    const id = await d.tree.create(s.parent ? ids.get(s.parent)! : null, s.title, projectId);
    ids.set(s.key, id);
    if (s.format) await d.tree.setSetting(id, 'format', s.format);
  }
  await d.engine.syncNow();
  let photos = 0;
  let textBytes = 0;
  for (const [i, s] of specs.entries()) {
    const pageId = ids.get(s.key)!;
    const urls = new Map<string, string>();
    for (const p of placeholders(s.blocks)) {
      urls.set(p, await d.media.add(pageId, await photoFile(Number(p.slice('bench://'.length)))));
      photos++;
    }
    const blocks = withUrls(s.blocks, urls) as TestPageSpec['blocks'];
    textBytes += JSON.stringify(blocks).length;
    if (blocks.length > 0) await writeBlocks(d.docs, pageId, blocks);
    if (i % 20 === 0) log(`armado ${i + 1}/${specs.length} (${photos} fotos)`);
  }
  await d.engine.syncNow();
  const setupMs = performance.now() - t0;
  log(`proyecto: ${specs.length} páginas, ${photos} fotos, ${Math.round(textBytes / 1024)} KB de bloques, ${Math.round(setupMs / 1000)} s`);

  const plan = exportPlan(d.tree, 'project', projectId);

  // 1. Las marcas de la pantalla.
  let screen: ScreenPage[] = [];
  if (SCREEN) {
    phase('screen');
    const ts = performance.now();
    screen = await screenPhase(d, plan.map((p) => p.id), main);
    log(`pantalla: ${Math.round((performance.now() - ts) / 1000)} s`);
  }

  // 2. Una página abierta mientras se exporta (abrirla puede guardar su reparación, por eso antes de leer lo
  // guardado), y lo guardado de todas, antes.
  const openId = plan.find((_, i) => i > 0 && specs[i].blocks.length > 0)!.id;
  const live = await d.docs.open(openId);
  await d.docs.flush(openId);
  const before = new Map<string, string>();
  for (const p of plan) before.set(p.id, await storedHash(d, p.id));
  const liveBefore = await sha256([Y.encodeStateAsUpdate(live)]);
  let liveUpdates = 0;
  live.on('update', () => liveUpdates++);
  const opsBefore = d.tree.pendingOps().length;

  // 3. Exportar.
  phase('export');
  const heapBefore = heap();
  const keep = document.createElement('div');
  keep.className = 'bench-kept';
  document.body.append(keep);
  const te = performance.now();
  const editor = await ExportEditor.create({ resolveFileUrl: (url, pageId) => d.media.resolve(url, pageId), media: d.media });
  const createMs = performance.now() - te;
  let progressCalls = 0;
  const exported: ExportedPage[] = await renderPages(plan, d.docs, editor, {
    onProgress: () => progressCalls++,
    onPage: (page) => {
      if (KEEP) keep.append(page.view.root);
      else page.view.root.remove();
    },
  });
  const exportMs = performance.now() - te;
  const heapAfter = heap();
  const keptImages = keep.querySelectorAll('img').length;
  phase('exported');
  // Un momento con las vistas puestas (para medir la memoria desde afuera), y después se sacan.
  if (KEEP) await wait(3000);
  editor.destroy();
  keep.remove();
  log(`exportar: ${plan.length} páginas en ${Math.round(exportMs)} ms (editor ${Math.round(createMs)} ms)`);

  // 4. Lo guardado, después.
  const changed: string[] = [];
  for (const p of plan) if ((await storedHash(d, p.id)) !== before.get(p.id)) changed.push(p.id);
  const liveAfter = await sha256([Y.encodeStateAsUpdate(live)]);
  d.docs.close(openId);
  const opsAfter = d.tree.pendingOps().length;

  // 5. Contra las marcas de la pantalla.
  const mismatches: unknown[] = [];
  let domMismatch = 0;
  let headerMismatch = 0;
  if (SCREEN) {
    exported.forEach((e, i) => {
      const s = screen[i];
      if (s.domSheets !== s.sheets) domMismatch++;
      if (JSON.stringify(s.header) !== JSON.stringify(plan[i].header)) headerMismatch++;
      const keys = (b: { key: string; offset: number }[]) => b.map((x) => `${x.key}@${Math.round(x.offset)}`).join(' ');
      if (e.sheets !== s.sheets || keys(e.breaks) !== keys(s.breaks)) {
        mismatches.push({ page: i, id: e.id, title: plan[i].title, export: { sheets: e.sheets, breaks: keys(e.breaks) }, screen: { sheets: s.sheets, dom: s.domSheets, breaks: keys(s.breaks) } });
      }
    });
  }

  const result = {
    pages: plan.length,
    photos,
    textKB: Math.round(textBytes / 1024),
    setupS: Math.round(setupMs / 100) / 10,
    keep: KEEP,
    export: {
      totalMs: Math.round(exportMs),
      editorCreateMs: Math.round(createMs),
      perPage: stats(exported.map((e) => e.ms.read + e.ms.blocks + e.ms.images + e.ms.copy + e.ms.paginate)),
      read: stats(exported.map((e) => e.ms.read)),
      blocks: stats(exported.map((e) => e.ms.blocks)),
      images: stats(exported.map((e) => e.ms.images)),
      copy: stats(exported.map((e) => e.ms.copy)),
      paginate: stats(exported.map((e) => e.ms.paginate)),
      sheets: exported.reduce((n, e) => n + e.sheets, 0),
      imagesTimedOut: exported.filter((e) => e.imagesTimedOut).length,
      unreadable: exported.filter((e) => e.unreadable).length,
      progressCalls,
      heapMB: heapBefore !== null && heapAfter !== null ? { before: Math.round(heapBefore / 1e6), after: Math.round(heapAfter / 1e6) } : null,
      keptImages,
    },
    unchanged: { pagesChanged: changed.length, changed: changed.map((id) => ({ id, open: id === openId })), liveUpdates, liveSame: liveBefore === liveAfter, treeOpsBefore: opsBefore, treeOpsAfter: opsAfter },
    screen: SCREEN
      ? {
          perPage: stats(screen.map((s) => s.ms)),
          sheets: screen.reduce((n, s) => n + s.sheets, 0),
          domMismatch,
          headerMismatch,
          sheetMismatches: mismatches.length,
          examples: mismatches.slice(0, 8),
        }
      : null,
  };
  (window as unknown as { __bench: unknown }).__bench = result;
  log(JSON.stringify(result, null, 2));
  document.body.dataset.benchDone = '1';
}

run().catch((err: unknown) => {
  console.error(err);
  (window as unknown as { __bench: unknown }).__bench = { error: String(err instanceof Error ? (err.stack ?? err.message) : err) };
  document.body.dataset.benchDone = 'error';
  log('ERROR', String(err instanceof Error ? (err.stack ?? err.message) : err));
});
