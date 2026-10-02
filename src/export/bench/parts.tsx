// La medición del PDF en partes con las fotos en resolución completa (entrega 1b: D84 y D85; Docs/Doc_Exportar.md, "Cómo
// quedó la entrega 1b"). Solo para desarrollo: no es parte de la app (el build no la incluye) y no usa ninguna cuenta ni
// la red. Se abre con el servidor de vite:
//
//   npx vite --port 5217 --strictPort
//   http://127.0.0.1:5217/src/export/bench/parts.html?pages=300&photos=8&full=1&photoW=4032&rotated=0.25
//
// Arma el proyecto de prueba (testProject.ts) como pdf.tsx y deja en `window.__part(from, part)` el armado de una
// parte con lo mismo que la ventana *Export* (exportPdf.ts): el script de afuera la arma, la imprime con `page.pdf` de
// Chromium (nunca una impresora), mide la memoria y pide la siguiente. Los ORIGINALES no salen de la cola de fotos (un
// proyecto con 2000 fotos de 12 megapíxeles no entra en la base en memoria del arnés): `original(id)` hace un JPEG de
// `photoW` × ¾ por foto, cada uno con sus propios bytes (una base de 24 fotos con ruido, más un comentario distinto),
// y `rotated` de ellas llevan el giro de EXIF de una foto vertical de teléfono (se pasan a JPEG en los Workers).
//
// Parámetros: `pages`, `photos`, `full=0|1`, `photoW`, `rotated` (0 a 1), `bytes` y `fullPixels` (los topes, en MB y
// millones), `comments=0|1`.
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
import { deviceImages, type ImageSource } from '../exportImages';
import { exportPlan } from '../exportPages';
import { buildPdf, PDF_LIMITS, printBook, type PdfBook } from '../exportPdf';
import { testProject, writeBlocks, type TestPageSpec } from '../testProject';
import { makeDevice, photoFile, placeholders, storedHash, withUrls } from './benchDevice';

const q = new URLSearchParams(location.search);
const PAGES = Number(q.get('pages') ?? 60);
const PHOTOS = Number(q.get('photos') ?? 6);
const FULL = q.get('full') !== '0';
const PHOTO_W = Number(q.get('photoW') ?? 4032);
const ROTATED = Number(q.get('rotated') ?? 0.25);
const COMMENTS = q.get('comments') === '1';
const LIMITS = {
  ...PDF_LIMITS.desktop,
  ...(q.get('bytes') ? { bytes: Number(q.get('bytes')) * 1e6 } : {}),
  ...(q.get('fullPixels') ? { fullPixels: Number(q.get('fullPixels')) * 1e6 } : {}),
};

prefs.init();
document.documentElement.dataset.theme = 'light';

const log = (...a: unknown[]) => console.log('[parts]', ...a);

/** Una foto de `w` × ¾ con ruido de verdad (una foto real no comprime como un degradé). */
async function noisyJpeg(n: number, w: number): Promise<Uint8Array> {
  const h = Math.round((w * 3) / 4);
  const c = new OffscreenCanvas(w, h);
  const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, `hsl(${(n * 47) % 360} 60% 55%)`);
  g.addColorStop(1, `hsl(${(n * 47 + 120) % 360} 50% 30%)`);
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  // Ruido fino en mosaicos (un sensor de teléfono): lo que hace pesar a un JPEG.
  const tile = x.createImageData(256, 256);
  let seed = n * 7919 + 1;
  for (let i = 0; i < tile.data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const v = seed & 255;
    tile.data[i] = v;
    tile.data[i + 1] = (v * 3) & 255;
    tile.data[i + 2] = (v * 7) & 255;
    tile.data[i + 3] = 46;
  }
  const bmp = await createImageBitmap(tile);
  for (let y = 0; y < h; y += 256) for (let xx = 0; xx < w; xx += 256) x.drawImage(bmp, xx, y);
  bmp.close();
  for (let i = 0; i < 1500; i++) {
    x.fillStyle = `hsl(${(n + i * 13) % 360} 70% ${20 + (i % 7) * 10}%)`;
    x.fillRect((i * 151 + n * 31) % w, (i * 97 + n * 17) % h, 8 + (i % 9) * 30, 6 + (i % 5) * 24);
  }
  return new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 })).arrayBuffer());
}

/** El segmento APP1 con Orientation = 6 (una foto vertical de teléfono). */
const EXIF6 = [0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0];

/** Los originales de mentira: cada pedido, bytes nuevos (como una foto bajada o leída de la base). */
function syntheticOriginals(base: Uint8Array[]): ImageSource['original'] {
  let k = 0;
  return async (id) => {
    const i = k++;
    const src = base[i % base.length];
    const rotated = ((i * 0.618) % 1) < ROTATED;
    const comment = new TextEncoder().encode(`foto ${id} ${i}`);
    const com = [0xff, 0xfe, (comment.length + 2) >> 8, (comment.length + 2) & 255, ...comment];
    const extra = [...(rotated ? EXIF6 : []), ...com];
    const out = new Uint8Array(src.length + extra.length);
    out.set(src.subarray(0, 2));
    out.set(extra, 2);
    out.set(src.subarray(2), 2 + extra.length);
    return new Blob([out], { type: 'image/jpeg' });
  };
}

async function run() {
  const t0 = performance.now();
  const server = new FakeServer();
  server.enableMedia();
  server.enableComments();
  const d = await makeDevice(server);
  await d.engine.syncNow();
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
  for (const [i, s] of specs.entries()) {
    const pageId = ids.get(s.key)!;
    const urls = new Map<string, string>();
    for (const p of placeholders(s.blocks)) {
      urls.set(p, await d.media.add(pageId, await photoFile(Number(p.slice('bench://'.length)))));
      photos++;
    }
    const next = specs[i + 1] ? ids.get(specs[i + 1].key)! : null;
    let blocks = withUrls(s.blocks, urls) as TestPageSpec['blocks'];
    if (next && blocks.length > 0) blocks = [...blocks, { type: 'paragraph', content: [{ type: 'link', href: `/p/${next}`, content: 'Next page' }] }] as TestPageSpec['blocks'];
    if (blocks.length > 0) await writeBlocks(d.docs, pageId, blocks);
    if (i % 25 === 0) log(`armado ${i + 1}/${specs.length} (${photos} fotos)`);
  }
  if (COMMENTS) {
    for (const s of specs.filter((_, i) => i % 7 === 3)) await d.comments.add(ids.get(s.key)!, null, `Comentario en ${s.title}`);
  }
  await d.engine.syncNow();
  await d.media.idle();
  for (let quiet = 0; quiet < 3; ) {
    await d.engine.syncMedia();
    quiet = (await d.media.status()).pending === 0 ? quiet + 1 : 0;
    await new Promise((r) => setTimeout(r, 200));
  }
  await d.engine.syncNow();
  const base: Uint8Array[] = [];
  if (FULL) for (let n = 0; n < 24; n++) base.push(await noisyJpeg(n, PHOTO_W));
  const plan = exportPlan(d.tree, 'project', projectId);
  const before = new Map<string, string>();
  for (const p of plan) before.set(p.id, await storedHash(d, p.id));
  const setupMs = performance.now() - t0;
  const baseMB = base.reduce((a, b) => a + b.length, 0) / base.length / 1e6;
  log(`proyecto: ${plan.length} páginas, ${photos} fotos, base ${baseMB.toFixed(2)} MB por foto, ${Math.round(setupMs / 1000)} s`);

  const device = deviceImages(d.media);
  const images: ImageSource = FULL ? { ...device, best: device.best, original: syntheticOriginals(base), isPhoto: async () => true } : device;
  const comments = COMMENTS ? appComments(d.comments, d.commentsDb, { id: d.remote.userId, email: 'x@test' }) : null;
  let book: PdfBook | null = null;
  let finish: (() => void) | null = null;
  const w = window as unknown as Record<string, unknown>;
  w.__setup = { pages: plan.length, photos, setupMs: Math.round(setupMs), photoMB: Math.round(baseMB * 100) / 100 };
  w.__part = async (from: number, part: number) => {
    finish?.();
    book?.destroy();
    book = null;
    const editor = await ExportEditor.create({ resolveFileUrl: (url, pageId) => d.media.resolve(url, pageId), media: d.media });
    const t = performance.now();
    try {
      book = await buildPdf({ title: 'Proyecto de prueba', plan, from, part, source: d.docs, editor, images, full: FULL, comments, named: true, limits: LIMITS, lastSync: d.engine.getStatus().lastSyncAt });
    } finally {
      editor.destroy();
    }
    const ms = performance.now() - t;
    // Las hojas y la clase de imprimir, como el diálogo (sin abrirlo: lo imprime `page.pdf` de afuera).
    finish = printBook(book, { print: () => undefined });
    return {
      from: book.from,
      to: book.to,
      part: book.part,
      fileTitle: book.fileTitle,
      sheets: book.sheets,
      buildMs: Math.round(ms),
      mpx: Math.round(book.pixels / 1e6),
      mb: Math.round(book.bytes / 1e6),
      lowRes: book.pages.reduce((a, p) => a + p.lowRes, 0),
      shrunkToFit: book.pages.filter((p) => p.shrunkToFit).length,
      failed: book.pages.filter((p) => p.failed).length,
      imgs: book.root.querySelectorAll('img[src^="blob:"]').length,
    };
  };
  w.__done = async () => {
    finish?.();
    book?.destroy();
    book = null;
    let changed = 0;
    for (const p of plan) if ((await storedHash(d, p.id)) !== before.get(p.id)) changed++;
    return { changed };
  };
  document.body.dataset.benchDone = '1';
}

run().catch((err: unknown) => {
  console.error(err);
  (window as unknown as { __error: unknown }).__error = String(err instanceof Error ? (err.stack ?? err.message) : err);
  document.body.dataset.benchDone = 'error';
});
