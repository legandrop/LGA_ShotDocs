// @vitest-environment jsdom
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BlobSink, type DownloadTarget, type FileOut } from '../media/folderZip';
import { formatSize } from '../media/fileTrash';
import { HeicError } from '../media/heic';
import { mediaIdOf } from '../media/queue';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, fakeConvertHeic, makeDevice, type Device } from '../sync/testing';
import { ExportDialog } from '../ui/ExportDialog';
import { hasPython, pythonReadZip, text, type PyEntry, type PyZip } from '../test/zipCheck';
import { SHARED_COLLAPSE_MAP } from '../ui/collapseEditor';
import { porteroDownload } from '../ui/sharpImages';
import { ARCHIVE_CSS, blocksForArchive, escapeHtml, indexHtml, PAGE_BREAK_MARK, pageMarkdown, sanitize } from './archiveHtml';
import { appComments } from './exportComments';
import { ExportCancelled, ExportEditor } from './exportEditor';
import { exportPlan } from './exportPages';
import { appArchiveMedia, buildZip, estimateZip, exporterHash, missingText, porteroCost, remoteOf, settingsOf, totalOf, wantsOriginal, type ZipInclude, type ZipOptions } from './exportZip';
import { writeBlocks } from './testProject';
import { FileNames, hrefOf, pageFolderName, pageSlots, PAGE_FOLDER_MAX, pathLimit, relativePath, ROOT_NAME_MAX, rootFolderName, SAFE_PATH, TYPICAL_BASE } from './zipLayout';

// Exportar, entrega 2 (Docs/Doc_Exportar.md, sección 2.3): el zip para archivar. Con el servidor y el portero en
// memoria (src/sync/testing.ts) y el lector de zip de Python (`testzip`): qué carpetas y nombres salen, el `.html` sin
// JavaScript y con cada foto en su vista JPEG (también un HEIC, también sin los originales), el `.md`, el JSON para
// volver, los originales bajados por el portero (una sola vez aunque estén en dos páginas), lo que NO sale (lo borrado,
// la foto sacada, la papelera, lo de afuera de la rama, ningún correo), sin red, cancelar y que nada de esto escribe. Que
// cada `.html` se vea con `file://` sin red en Chromium y Firefox se mide aparte (el arnés `bench/zip.tsx`).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  // Los `Blob` de Node: la base en memoria (fake-indexeddb) guarda y devuelve un `Blob` de jsdom como un objeto vacío, y
  // las fotos tienen que ir y volver de la base (`fetch` de Node también lee las direcciones `blob:` de estos).
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
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
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

/**
 * El contenido de un archivo de prueba, en letras (jsdom no toma un `Uint8Array` de Node para armar un `File`: lo pasa a
 * texto y el peso no coincide), distinto para cada `seed`.
 */
const content = (size: number, seed: number) =>
  `SEED${seed}|${Array.from({ length: size }, (_, i) => String.fromCharCode(65 + ((i * 31 + seed * 7 + (i >> 7)) % 26))).join('')}`.slice(0, size);
const bytes = (size: number, seed: number) => new TextEncoder().encode(content(size, seed));
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

/** El editor de exportación, como lo arma la ventana (con las imágenes de la cola, si se pasa un dispositivo). */
async function editor(d?: Device) {
  const e = await ExportEditor.create({ imageTimeoutMs: 0, copyTimeoutMs: 0, ...(d ? { resolveFileUrl: (url: string, pageId: string) => d.media.resolve(url, pageId), media: d.media } : {}) });
  editors.push(e);
  return e;
}

/** Bytes de un texto (para buscarlos en el zip, que va sin comprimir). */
const utf8 = (s: string) => new TextEncoder().encode(s);

function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/**
 * Un proyecto con una rama "Rodaje" (A4) y otra "Afuera": en "Día 1" una foto, un HEIC que no se pudo convertir, un
 * video, un PDF, un título colapsado para todos, un salto de hoja, links a "Día 2" (adentro) y a "Afuera", y un texto y
 * una foto que se escribieron y se sacaron; en "Día 2", la misma foto otra vez; una página en la papelera; comentarios
 * del dueño y de Ana. Todo lo sube el dispositivo A del dueño; exporta B (el mismo dueño, sin los originales).
 */
async function world() {
  const server = new FakeServer();
  server.enableComments();
  server.enableTrash();
  const a = await device(server);
  await sync(a);
  const root = await a.tree.create(null, 'Rodaje · Semana 1');
  await a.tree.setSetting(root, 'format', { size: 'A4', landscape: false });
  const day1 = await a.tree.create(root, 'Día 1: exteriores');
  const day2 = await a.tree.create(root, 'Día 2');
  const trashed = await a.tree.create(root, 'Borrador en la papelera');
  const outside = await a.tree.create(null, 'Afuera');
  await sync(a);
  const photo = await a.media.add(day1, file(4000, 'IMG_0412.JPG', 'image/jpeg', 1));
  // Un HEIC que no se pudo pasar a JPEG al agregarlo (queda como original, sin miniatura).
  server.convertHeic = async () => {
    throw new HeicError('failed', 'no');
  };
  const heic = await a.media.add(day1, file(5000, 'IMG_0413.HEIC', 'image/heic', 2));
  const video = await a.media.add(day1, file(6000, 'clip 001.mov', 'video/quicktime', 3));
  const pdf = await a.media.add(day1, file(3000, 'plano_set.pdf', 'application/pdf', 4));
  const removed = await a.media.add(day1, file(2500, 'FOTO_SACADA.JPG', 'image/jpeg', 5));
  const inline = await a.media.add(day1, file(2200, 'IMG_0500.JPG', 'image/jpeg', 6));
  // Lo que se escribió y se borró: queda en el documento Yjs, nunca en el zip.
  await writeBlocks(a.docs, day1, [
    { type: 'paragraph', content: 'TEXTO_SECRETO_BORRADO' },
    { type: 'image', props: { url: removed, name: 'FOTO_SACADA.JPG' } },
  ] as never);
  const headingId = crypto.randomUUID();
  const planoId = crypto.randomUUID();
  await writeBlocks(a.docs, day1, [
    { id: headingId, type: 'heading', props: { level: 2 }, content: 'Escena 12', children: [{ type: 'paragraph', content: 'Adentro del título' }] },
    {
      id: planoId,
      type: 'paragraph',
      content: [
        'Plano general, ver ',
        { type: 'link', href: `/p/${day2}`, content: 'el día 2' },
        ' y ',
        { type: 'link', href: `/p/${outside}`, content: 'la otra rama' },
        ' y ',
        { type: 'link', href: 'javascript:alert(1)', content: 'nada' },
        ' con ',
        { type: 'photo', props: { url: inline, name: 'IMG_0500.JPG', w: 0 } },
      ],
    },
    { type: 'image', props: { url: photo, name: 'IMG_0412.JPG' } },
    { type: 'image', props: { url: heic, name: 'IMG_0413.HEIC' } },
    { type: 'paragraph', props: { pageBreak: true } },
    { type: 'image', props: { url: video, name: 'clip 001.mov' } },
    { type: 'image', props: { url: pdf, name: 'plano_set.pdf' } },
  ] as never);
  const doc = await a.docs.open(day1);
  doc.getMap(SHARED_COLLAPSE_MAP).set(headingId, true);
  a.docs.close(day1);
  await a.docs.flush();
  await writeBlocks(a.docs, day2, [
    { type: 'paragraph', content: 'Repetimos la referencia' },
    { type: 'image', props: { url: photo, name: 'IMG_0412.JPG' } },
  ] as never);
  await writeBlocks(a.docs, trashed, [{ type: 'paragraph', content: 'TEXTO_EN_LA_PAPELERA' }] as never);
  await writeBlocks(a.docs, outside, [{ type: 'paragraph', content: 'SECRETO_DE_AFUERA' }] as never);
  await a.tree.trash(trashed);
  await sync(a);
  await a.media.idle();
  await sync(a);
  // Comentarios: el dueño y Ana (con su correo en la cuenta; nunca sale).
  server.addMember('ana', 'member', ANA_EMAIL);
  server.grant('ana', { pageId: root }, 'comment');
  const thread = await a.comments.add(day1, planoId, 'Cambiar el lente a 35');
  await sync(a);
  const ana = await device(server, { id: 'ana', email: ANA_EMAIL });
  await sync(ana);
  await ana.comments.refresh(day1);
  await ana.comments.add(day1, null, 'COMENTARIO_DE_ANA', thread);
  const gone = await a.comments.add(day2, null, 'COMENTARIO_BORRADO');
  await a.comments.add(day2, null, 'Respuesta viva', gone);
  await a.comments.remove(day2, gone);
  await sync(ana);
  await sync(a);
  server.convertHeic = fakeConvertHeic;
  const b = await device(server);
  await sync(b);
  const ids = { photo: mediaIdOf(photo)!, heic: mediaIdOf(heic)!, video: mediaIdOf(video)!, pdf: mediaIdOf(pdf)!, removed: mediaIdOf(removed)!, inline: mediaIdOf(inline)! };
  return { server, a, b, root, day1, day2, trashed, outside, ids, headingId, planoId };
}

type World = Awaited<ReturnType<typeof world>>;

async function zipOf(w: World, d: Device, extra: Partial<ZipOptions> = {}, kind: 'page' | 'project' = 'page') {
  const sink = new BlobSink();
  const target = kind === 'page' ? w.root : w.server.workspaceId;
  const plan = exportPlan(d.tree, kind, target);
  const result = await buildZip({
    title: kind === 'page' ? d.tree.get(w.root)!.title : (d.tree.project(target)?.name ?? ''),
    kind,
    project: kind === 'project' ? { id: target, name: d.tree.project(target)?.name ?? '' } : null,
    plan,
    rows: (id) => d.tree.get(id),
    source: d.docs,
    editor: await editor(d),
    media: appArchiveMedia(d.media, d.mediaDb, porteroDownload(d.media, (u) => w.server.portero.fetch(u))),
    include: ALL,
    comments: appComments(d.comments, d.commentsDb, { id: d.remote.userId, email: OWNER_EMAIL }),
    me: { id: d.remote.userId, email: OWNER_EMAIL },
    online: w.server.online,
    target: { kind: 'zip', sink },
    download: { fetch: w.server.portero.fetch as never, online: () => w.server.online, wait: async () => undefined },
    convertHeic: fakeConvertHeic,
    appVersion: '0.0XX',
    lastSync: d.engine.getStatus().lastSyncAt,
    ...extra,
  });
  const zip = new Uint8Array(await sink.blob().arrayBuffer());
  return { result, zip, plan };
}

function read(zip: Uint8Array): PyZip & { get: (suffix: string) => PyEntry | undefined; names: string[] } {
  const z = pythonReadZip(zip);
  return { ...z, names: z.entries.map((e) => e.name), get: (suffix) => z.entries.find((e) => e.name.endsWith(suffix)) };
}

/** Todo lo guardado de una página (sus filas y su estado), para comparar. */
async function stored(d: Device, pageId: string): Promise<string> {
  const rows = await d.db.getAllFromIndex('docUpdates', 'pageId', pageId);
  const state = await d.db.get('docState', pageId);
  return JSON.stringify({ rows: rows.map((r) => Array.from(r.data)), state });
}

describe('exportar zip: los nombres y las rutas', () => {
  it('cada carpeta de página con su número, sin espacios ni tildes, topada en 60 letras sin partir un grafema', () => {
    expect(pageFolderName(1, 9, 'Preproducción')).toBe('01_Preproduccion');
    expect(pageFolderName(3, 120, 'Día 1: exteriores')).toBe('003_Dia_1_exteriores');
    expect(pageFolderName(2, 5, '  ')).toBe('02_Untitled');
    expect(pageFolderName(4, 5, 'a/b\\c?')).toBe('04_a_b_c');
    const long = pageFolderName(1, 2, 'Una escena con un título larguísimo que no entra en una ruta de Windows 👨‍👩‍👧 final');
    expect(Array.from(long).length).toBeLessThanOrEqual(PAGE_FOLDER_MAX);
    expect(long).not.toMatch(/\s/);
    // Otras escrituras quedan como están (el dakuten no es una tilde).
    expect(pageFolderName(1, 1, 'がっこう')).toBe('01_がっこう');
    expect(rootFolderName('Reporte ERSO')).toBe('Reporte_ERSO');
    expect(rootFolderName('')).toBe('Export');
  });

  it('las carpetas anidadas como el árbol, y las rutas relativas entre páginas y archivos', () => {
    const fmt = { size: 'A4' as const, landscape: false };
    const plan = [
      { id: 'r', title: 'Raíz', depth: 0, parent: null, header: [], format: fmt },
      { id: 'a', title: 'Pre', depth: 1, parent: 'r', header: [], format: fmt },
      { id: 'a1', title: 'Desglose', depth: 2, parent: 'a', header: [], format: fmt },
      { id: 'b', title: 'Rodaje', depth: 1, parent: 'r', header: [], format: fmt },
    ];
    const slots = pageSlots(plan);
    expect(slots.get('r')!.dir).toBe('01_Raiz');
    expect(slots.get('a1')!.dir).toBe('01_Raiz/01_Pre/01_Desglose');
    expect(slots.get('b')!.dir).toBe('01_Raiz/02_Rodaje');
    expect(relativePath('01_Raiz/02_Rodaje', '01_Raiz/01_Pre/01_Desglose/Files/a.jpg')).toBe('../01_Pre/01_Desglose/Files/a.jpg');
    expect(relativePath('01_Raiz/02_Rodaje', '01_Raiz/02_Rodaje/Files/a.jpg')).toBe('Files/a.jpg');
    expect(relativePath('01_Raiz/02_Rodaje', 'style.css')).toBe('../../style.css');
    expect(hrefOf('../Files/foto #1 100%.jpg')).toBe('../Files/foto%20%231%20100%25.jpg');
    expect(hrefOf('Files/IMG_1 (2).jpg')).toBe('Files/IMG_1%20%282%29.jpg');
  });

  it('los archivos con su nombre del Drive; dos iguales en la misma carpeta se separan; la vista con .jpg', () => {
    const names = new FileNames();
    expect(names.original('p', 'IMG_1.HEIC')).toBe('IMG_1.HEIC');
    expect(names.original('p', 'img_1.heic')).toBe('img_1 (2).heic');
    expect(names.original('p', '_view')).toBe('_view (2)');
    expect(names.view('p', 'IMG_1.HEIC')).toBe('IMG_1.jpg');
    expect(names.view('p', 'IMG_1.jpg')).toBe('IMG_1 (2).jpg');
    expect(names.original('q', 'IMG_1.HEIC')).toBe('IMG_1.HEIC');
  });
});

describe('exportar zip: el .html, el .md y el JSON', () => {
  it('el .html no lleva nada que corra código ni pida la red', () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<p onclick="x()" id="a" tabindex="0" role="textbox" aria-hidden="true">Hola</p><script>alert(1)</script><iframe src="https://x"></iframe>' +
      '<a href="javascript:alert(1)">mal</a><img src="x.jpg" onerror="x()" srcset="a 2x"><video src="v.mov"></video><form><input></form>';
    sanitize(host);
    expect(host.innerHTML).not.toMatch(/script|iframe|onclick|onerror|javascript:|srcset|video|form|input|tabindex|role=|aria-hidden|id="a"/);
    expect(host.textContent).toContain('Hola');
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
    expect(ARCHIVE_CSS).toContain('@media print');
  });

  it('el .md: cada foto con su vista y link al original, el salto de hoja en su línea, los links', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const md = pageMarkdown({
      blocks: [
        {
          id: 'b1',
          type: 'paragraph',
          props: {},
          content: [
            { type: 'text', text: 'Ver ', styles: {} },
            { type: 'link', href: '/p/22222222-2222-4222-8222-222222222222', content: [{ type: 'text', text: 'otra', styles: {} }] },
            { type: 'text', text: ' y ', styles: {} },
            { type: 'link', href: '/p/33333333-3333-4333-8333-333333333333', content: [{ type: 'text', text: 'afuera', styles: {} }] },
          ],
          children: [],
        },
        { id: 'b2', type: 'image', props: { url: `sdmedia://${id}`, name: 'IMG_1.HEIC' }, children: [] },
        { id: 'b3', type: 'paragraph', props: { pageBreak: true }, content: [], children: [] },
        { id: 'b4', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Después', styles: {} }], children: [] },
      ],
      title: 'Día 1',
      dir: '01_R/01_Dia_1',
      pageMd: (p) => (p === '22222222-2222-4222-8222-222222222222' ? '01_R/02_Dia_2/02_Dia_2.md' : null),
      media: () => ({ name: 'IMG_1.HEIC', view: '01_R/01_Dia_1/Files/_view/IMG_1.jpg', original: '01_R/01_Dia_1/Files/IMG_1.HEIC' }),
      notes: [],
      comments: null,
    });
    expect(md).toContain('# Día 1');
    expect(md).toContain('[![IMG_1.HEIC](Files/_view/IMG_1.jpg)](Files/IMG_1.HEIC)');
    expect(md).toContain('[otra](../02_Dia_2/02_Dia_2.md)');
    expect(md).toContain('y afuera');
    expect(md).not.toContain('33333333');
    expect(md.split('\n')).toContain(PAGE_BREAK_MARK);
    expect(md.indexOf(PAGE_BREAK_MARK)).toBeLessThan(md.indexOf('Después'));
    // Sin el original (casilla destildada): la vista sola.
    const light = pageMarkdown({
      blocks: [{ id: 'b2', type: 'image', props: { url: `sdmedia://${id}`, name: 'x' }, children: [] }],
      title: 'T',
      dir: 'd',
      pageMd: () => null,
      media: () => ({ name: 'IMG_1.HEIC', view: 'd/Files/_view/IMG_1.jpg', original: null }),
      notes: [],
      comments: null,
    });
    expect(light).toContain('![IMG_1.HEIC](Files/_view/IMG_1.jpg)');
    expect(light).not.toContain('](Files/IMG_1.HEIC)');
  });

  it('en los bloques para volver, un link a una página de afuera queda solo con su texto (también en las tablas)', () => {
    const inside = new Set(['22222222-2222-4222-8222-222222222222']);
    const out = blocksForArchive(
      [
        {
          id: 'b',
          type: 'paragraph',
          content: [
            { type: 'link', href: '/p/22222222-2222-4222-8222-222222222222', content: [{ type: 'text', text: 'adentro', styles: {} }] },
            { type: 'link', href: '/p/33333333-3333-4333-8333-333333333333', content: [{ type: 'text', text: 'afuera', styles: {} }] },
            { type: 'link', href: 'https://ejemplo.test', content: [{ type: 'text', text: 'web', styles: {} }] },
          ],
          children: [
            {
              id: 'c',
              type: 'table',
              content: { type: 'tableContent', rows: [{ cells: [[{ type: 'link', href: '/p/33333333-3333-4333-8333-333333333333', content: [{ type: 'text', text: 'celda', styles: {} }] }]] }] },
              children: [],
            },
          ],
        },
      ],
      inside,
    );
    const json = JSON.stringify(out);
    expect(json).not.toContain('33333333');
    expect(json).toContain('22222222');
    expect(json).toContain('https://ejemplo.test');
    expect(json).toContain('"afuera"');
    expect(json).toContain('"celda"');
  });

  it('el índice anida las páginas y avisa si falta algo; la lista de lo que falta, con BOM y sus motivos', () => {
    const html = indexHtml({
      title: 'R <b>',
      meta: 'Exported',
      rows: [
        { title: 'A', depth: 0, html: '01_A/01_A.html' },
        { title: 'B', depth: 1, html: '01_A/01_B/01_B.html' },
        { title: 'C', depth: 0, html: '02_C/02_C.html' },
      ],
      missing: true,
      lang: 'es',
    });
    expect(html).toContain('R &lt;b&gt;');
    expect(html).toContain('MISSING_FILES.txt');
    expect(html.match(/<ul>/g)).toHaveLength(2);
    expect(html.match(/<\/ul>/g)).toHaveLength(2);
    const txt = missingText([{ path: 'a/Files/x.mov', why: 'offline' }, { path: 'a/a.html', why: 'pageOutdated' }], 'R', new Date(2026, 9, 2), null);
    expect(txt.startsWith('﻿')).toBe(true);
    expect(txt).toContain('a/Files/x.mov — not on this device and there was no connection');
    expect(txt).toContain('a/a.html — this page may be out of date on this device');
    expect(txt).toContain('\r\n');
  });
});

describe('exportar zip: lo que pesa', () => {
  it('cuenta por tipo lo que va y lo que hay que bajar; los pedidos al portero', async () => {
    const w = await world();
    const plan = exportPlan(w.b.tree, 'page', w.root);
    const est = await estimateZip(plan, w.b.docs, appArchiveMedia(w.b.media, w.b.mediaDb));
    // La foto sacada y la página de la papelera no cuentan.
    expect(est.files).toBe(5);
    expect(est.byKind.image).toMatchObject({ count: 3, bytes: 4000 + 5000 + 2200, remote: 3 });
    expect(est.byKind.video).toMatchObject({ count: 1, bytes: 6000, remote: 1 });
    expect(est.byKind.file).toMatchObject({ count: 1, bytes: 3000, remote: 1 });
    expect(remoteOf(est, ALL)).toEqual({ files: 5, bytes: 20200 });
    expect(remoteOf(est, { ...ALL, originals: false, videos: false })).toEqual({ files: 1, bytes: 3000 });
    expect(totalOf(est, { ...ALL, attachments: false }).bytes).toBe(17200 + est.previews);
    // En el dispositivo que los agregó, nada que bajar.
    const own = await estimateZip(plan, w.a.docs, appArchiveMedia(w.a.media, w.a.mediaDb));
    expect(remoteOf(own, ALL).files).toBe(0);
    expect(porteroCost(2459)).toEqual({ requests: 4918, percent: 10 });
    expect(wantsOriginal('video', { originals: true, attachments: true, videos: false })).toBe(false);
  });
});

describe('exportar zip: el archivo entero', () => {
  it('Python lo abre; carpetas, vistas, originales bajados una vez, JSON, y nada de lo que no tiene que salir', async () => {
    const w = await world();
    const plan = exportPlan(w.b.tree, 'page', w.root);
    const before = new Map<string, string>();
    for (const p of plan) before.set(p.id, await stored(w.b, p.id));
    const opsBefore = w.b.tree.pendingOps().length;
    const calls = w.server.portero.calls.length;
    const { result, zip } = await zipOf(w, w.b);

    // Nada de lo que no tiene que salir, en ningún byte (el zip va sin comprimir).
    const projectName = w.b.tree.project(w.server.workspaceId)?.name ?? '';
    for (const secret of ['TEXTO_SECRETO_BORRADO', 'FOTO_SACADA', 'TEXTO_EN_LA_PAPELERA', 'Borrador en la papelera', 'SECRETO_DE_AFUERA', OWNER_EMAIL, ANA_EMAIL, '@wanka.test', '@estudio.test', 'COMENTARIO_BORRADO', w.outside, w.trashed, w.server.workspaceId, w.ids.removed]) {
      expect(contains(zip, utf8(secret)), secret).toBe(false);
    }
    expect(contains(zip, utf8('SEED5|'))).toBe(false);
    if (projectName) expect(contains(zip, utf8(`"${projectName}"`))).toBe(false);

    expect(result.missing).toEqual([]);
    expect(result.downloaded.files).toBe(4);
    // Nada cambió en el dispositivo que exportó: ni las páginas ni el árbol.
    for (const p of plan) expect(await stored(w.b, p.id)).toBe(before.get(p.id));
    expect(w.b.tree.pendingOps().length).toBe(opsBefore);
    // Pedidos al portero: un pase y una bajada por original (el HEIC sin vista se bajó una vez y sirvió para las dos).
    const used = w.server.portero.calls.slice(calls);
    expect(used.filter((c) => c.path === '/pass')).toHaveLength(5);
    expect(used.filter((c) => c.path.startsWith('/m/'))).toHaveLength(5);

    if (!hasPython) return;
    const z = read(zip);
    expect(z.bad).toBeNull();
    // Sin carpeta de arriba (O1): la página raíz de la rama queda arriba de todo, con el nombre del zip.
    const day1 = '01_Dia_1_exteriores';
    const day2 = '02_Dia_2';
    expect(z.names).toContain('index.html');
    expect(z.names).toContain('style.css');
    expect(z.names).toContain('Rodaje_·_Semana_1.html');
    expect(z.names).toContain('Rodaje_·_Semana_1.md');
    expect(z.names).toContain(`${day1}/01_Dia_1_exteriores.html`);
    expect(z.names).toContain(`${day1}/01_Dia_1_exteriores.md`);
    expect(z.names).toContain(`${day2}/02_Dia_2.html`);
    expect(z.names).not.toContain('MISSING_FILES.txt');
    // Ningún espacio en las carpetas de las páginas; los archivos con su nombre del Drive.
    for (const n of z.names.filter((x) => x.endsWith('.html'))) expect(n).not.toMatch(/\s/);
    expect(z.names).toContain(`${day1}/Files/clip 001.mov`);
    // Los originales, del portero, enteros; la foto de dos páginas va una sola vez (en la primera).
    expect(Buffer.from(z.get(`${day1}/Files/IMG_0412.JPG`)!.data!, 'base64')).toEqual(Buffer.from(bytes(4000, 1)));
    expect(z.names.filter((n) => n.endsWith('/IMG_0412.JPG'))).toHaveLength(1);
    expect(Buffer.from(z.get(`${day1}/Files/IMG_0413.HEIC`)!.data!, 'base64')).toEqual(Buffer.from(bytes(5000, 2)));
    // Las vistas JPEG: la foto, el video, la foto en línea y el HEIC (pasado a JPEG en el dispositivo).
    for (const v of ['IMG_0412.jpg', 'IMG_0413.jpg', 'clip 001.jpg', 'IMG_0500.jpg']) expect(z.names, v).toContain(`${day1}/Files/_view/${v}`);
    expect(text(z.get(`${day1}/Files/_view/IMG_0413.jpg`))).toContain('jpeg-of:5000');
    // El PDF va como original, sin vista (se ve con su tarjeta).
    expect(z.names).toContain(`${day1}/Files/plano_set.pdf`);
    expect(z.names.some((n) => n.includes('_view/plano_set'))).toBe(false);

    // El .html del día 1.
    const html = text(z.get(`${day1}/01_Dia_1_exteriores.html`));
    expect(html).not.toMatch(/<script|\son[a-z]+=|javascript:|<iframe|blob:/);
    expect(html).toContain('href="../style.css"');
    expect(html).toContain('<a class="sd-archive-link" href="Files/IMG_0413.HEIC"><img class="bn-visual-media" alt="IMG_0413.HEIC" src="Files/_view/IMG_0413.jpg">');
    expect(html).toContain('src="Files/_view/IMG_0500.jpg"');
    expect(html).toContain('href="../02_Dia_2/02_Dia_2.html"');
    expect(html).toContain('la otra rama');
    expect(html).not.toContain('/p/');
    expect(html).toContain('@page { size: 210mm 297mm;');
    expect(html).toContain('Cambiar el lente a 35');
    expect(html).toContain('COMENTARIO_DE_ANA');
    expect(html).toContain('ana.garcia');
    // Ninguna imagen pide la red: o una vista del zip, o una tarjeta `data:`.
    for (const src of html.match(/<img[^>]*src="([^"]*)"/g) ?? []) expect(src).toMatch(/src="(Files\/_view\/|\.\.\/|data:)/);
    // El de la página 2 apunta a la foto que quedó en la carpeta del día 1.
    const html2 = text(z.get(`${day2}/02_Dia_2.html`));
    expect(html2).toContain('href="../01_Dia_1_exteriores/Files/IMG_0412.JPG"');
    expect(html2).toContain('src="../01_Dia_1_exteriores/Files/_view/IMG_0412.jpg"');
    expect(html2).toContain('(deleted comment)');
    expect(html2).toContain('Respuesta viva');

    // El .md.
    const md = text(z.get(`${day1}/01_Dia_1_exteriores.md`));
    expect(md).toContain('# Día 1: exteriores');
    expect(md).toContain('Escena 12');
    expect(md).toContain('Adentro del título');
    expect(md).toContain('[![IMG_0412.JPG](Files/_view/IMG_0412.jpg)](Files/IMG_0412.JPG)');
    expect(md.split('\n')).toContain(PAGE_BREAK_MARK);
    expect(md).toContain('[el día 2](../02_Dia_2/02_Dia_2.md)');
    expect(md).toContain('Cambiar el lente a 35');
    // D57: cada foto y archivo del `.md` con su ruta relativa, que existe en el zip (así se ven en un visor de Markdown).
    const md2 = text(z.get(`${day2}/02_Dia_2.md`));
    expect(md2).toContain('[![IMG_0412.JPG](../01_Dia_1_exteriores/Files/_view/IMG_0412.jpg)](../01_Dia_1_exteriores/Files/IMG_0412.JPG)');
    for (const [file, dir] of [[md, day1], [md2, day2]] as const) {
      const targets = [...file.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]).filter((h) => !/^(https?:|mailto:|#)/.test(h));
      expect(targets.length).toBeGreaterThan(0);
      for (const h of targets) {
        const parts = `${dir}/${decodeURIComponent(h)}`.split('/');
        const resolved: string[] = [];
        for (const part of parts) if (part === '..') resolved.pop(); else resolved.push(part);
        expect(z.names, h).toContain(resolved.join('/'));
      }
    }

    // El JSON para volver: los bloques, el colapsado para todos, el manifest y los comentarios.
    const manifest = JSON.parse(text(z.get('_shotdocs/manifest.json'))) as Record<string, any>;
    expect(manifest.format).toBe(1);
    expect(manifest.kind).toBe('page');
    expect(manifest.project).toBeNull();
    expect(manifest.pages.map((p: { title: string }) => p.title)).toEqual(['Rodaje · Semana 1', 'Día 1: exteriores', 'Día 2']);
    expect(manifest.pages[0].parent).toBeNull();
    expect(manifest.pages[0].settings).toEqual({ format: { size: 'A4', landscape: false } });
    expect(manifest.pages[1].parent).toBe(w.root);
    expect(manifest.exporter.hash).toBe(await exporterHash(manifest.exporter.salt, OWNER_EMAIL));
    const files = manifest.files as { id: string; original: string | null; view: string | null; size: number }[];
    expect(files.map((f) => f.id).sort()).toEqual([w.ids.photo, w.ids.heic, w.ids.video, w.ids.pdf, w.ids.inline].sort());
    expect(files.find((f) => f.id === w.ids.photo)).toMatchObject({ original: '01_Dia_1_exteriores/Files/IMG_0412.JPG', size: 4000 });
    const page1 = JSON.parse(text(z.get(manifest.pages[1].json))) as { blocks: unknown[]; collapsedForAll: string[] };
    expect(page1.collapsedForAll).toEqual([w.headingId]);
    expect(JSON.stringify(page1.blocks)).toContain(`sdmedia://${w.ids.heic}`);
    const comments = JSON.parse(text(z.get('_shotdocs/comments.json'))) as {
      threads: { block: string | null; comments: { author?: string; mine?: boolean; deleted?: boolean; body?: string }[] }[];
    };
    const lens = comments.threads.find((th) => th.comments[0].body === 'Cambiar el lente a 35')!;
    expect(lens.block).toBe(w.planoId);
    expect(lens.comments[0]).toMatchObject({ author: 'lega.supervisor', mine: true });
    expect(lens.comments[1]).toMatchObject({ author: 'ana.garcia', mine: false, body: 'COMENTARIO_DE_ANA' });
    const dead = comments.threads.find((th) => th.comments[0].deleted)!;
    expect(dead.comments[1].body).toBe('Respuesta viva');
  });

  it('sin las fotos originales: cada foto (también el HEIC) igual con su vista JPEG, sin link', async () => {
    const w = await world();
    const { zip } = await zipOf(w, w.b, { include: { originals: false, attachments: false, videos: false, comments: false } });
    if (!hasPython) return;
    const z = read(zip);
    expect(z.bad).toBeNull();
    const day1 = '01_Dia_1_exteriores';
    expect(z.names.filter((n) => n.includes('/Files/') && !n.includes('/_view/'))).toEqual([]);
    for (const v of ['IMG_0412.jpg', 'IMG_0413.jpg', 'clip 001.jpg']) expect(z.names).toContain(`${day1}/Files/_view/${v}`);
    const html = text(z.get(`${day1}/01_Dia_1_exteriores.html`));
    expect(html).toContain('src="Files/_view/IMG_0413.jpg"');
    expect(html).not.toContain('sd-archive-link');
    expect(html).toContain('<span class="sd-archive-name">IMG_0413.HEIC</span>');
    expect(z.names.some((n) => n.endsWith('comments.json'))).toBe(false);
    expect(html).not.toContain('Cambiar el lente');
  });

  it('el proyecto entero lleva su nombre e id; una rama, no', async () => {
    const w = await world();
    const { zip } = await zipOf(w, w.b, { include: { ...ALL, originals: false, videos: false, attachments: false } }, 'project');
    if (!hasPython) return;
    const z = read(zip);
    const name = w.b.tree.project(w.server.workspaceId)!.name;
    const manifest = JSON.parse(text(z.get('_shotdocs/manifest.json'))) as Record<string, any>;
    expect(manifest.project).toEqual({ id: w.server.workspaceId, name });
    expect(manifest.pages.map((p: { title: string }) => p.title)).toEqual(['Rodaje · Semana 1', 'Día 1: exteriores', 'Día 2', 'Afuera']);
    // Con "Afuera" adentro, el link a esa página es un link.
    const html = text(z.get('01_Dia_1_exteriores.html'));
    expect(html).toContain('href="../../02_Afuera/02_Afuera.html"');
  });

  it('sin red: el texto y las vistas que hay; los originales que no están quedan en MISSING_FILES.txt', async () => {
    const w = await world();
    // B miró las páginas antes (tiene las miniaturas) y se quedó sin red.
    await zipOf(w, w.b, { include: { originals: false, attachments: false, videos: false, comments: false } });
    w.server.online = false;
    const calls = w.server.portero.calls.length;
    const { result, zip } = await zipOf(w, w.b, { online: false });
    expect(w.server.portero.calls.length).toBe(calls);
    expect(result.missing.filter((m) => m.why === 'offline').map((m) => m.path.split('/').pop()).sort()).toEqual(['IMG_0412.JPG', 'IMG_0413.HEIC', 'IMG_0500.JPG', 'clip 001.mov', 'plano_set.pdf']);
    // Los comentarios no se pudieron poner al día.
    expect(result.missing.some((m) => m.why === 'comments')).toBe(true);
    if (!hasPython) return;
    const z = read(zip);
    expect(z.bad).toBeNull();
    const missing = text(z.get('MISSING_FILES.txt'));
    expect(missing).toContain('clip 001.mov — not on this device and there was no connection');
    expect(missing).toContain('comments as on this device on');
    const index = text(z.get('index.html'));
    expect(index).toContain('MISSING_FILES.txt');
    expect(index).toContain('as on this device on');
    const manifest = JSON.parse(text(z.get('_shotdocs/manifest.json'))) as { files: { original: string | null }[]; lastSyncAt: string | null };
    expect(manifest.files.every((f) => f.original === null)).toBe(true);
    expect(manifest.lastSyncAt).not.toBeNull();
    const html = text(z.get('01_Dia_1_exteriores.html'));
    expect(html).toContain('src="Files/_view/IMG_0412.jpg"');
  });

  it('sin red, en un dispositivo que nunca vio los archivos: el texto sale y cada archivo queda en la lista con su id', async () => {
    const w = await world();
    w.server.online = false;
    const { result, zip } = await zipOf(w, w.b, { online: false });
    expect(result.missing.filter((m) => m.why === 'unknown').map((m) => m.path.split('/').pop()).sort()).toEqual(
      [w.ids.photo, w.ids.heic, w.ids.video, w.ids.pdf, w.ids.inline].sort(),
    );
    if (!hasPython) return;
    const z = read(zip);
    expect(z.bad).toBeNull();
    const html = text(z.get('01_Dia_1_exteriores.html'));
    expect(html).toContain('Plano general');
    // Ninguna imagen rota que pida algo de afuera.
    for (const src of html.match(/<img[^>]*src="([^"]*)"/g) ?? []) expect(src).toMatch(/src="data:/);
  });

  it('un archivo que el portero no da queda en la lista, y su foto sin link a un original que no está', async () => {
    const w = await world();
    w.server.portero.hidden.add(w.ids.video);
    const { result, zip } = await zipOf(w, w.b);
    expect(result.missing).toEqual([expect.objectContaining({ why: 'failed', path: expect.stringContaining('clip 001.mov') })]);
    if (!hasPython) return;
    const z = read(zip);
    expect(z.bad).toBeNull();
    expect(z.names.some((n) => n.endsWith('Files/clip 001.mov'))).toBe(false);
    const html = text(z.get('01_Dia_1_exteriores.html'));
    expect(html).not.toContain('href="Files/clip%20001.mov"');
    expect(html).toContain('src="Files/_view/clip%20001.jpg"');
    expect(text(z.get('MISSING_FILES.txt'))).toContain('clip 001.mov — could not be downloaded');
  });

  it('cancelar corta con su error y no escribe nada en el dispositivo', async () => {
    const w = await world();
    const ctrl = new AbortController();
    const plan = exportPlan(w.b.tree, 'page', w.root);
    const before = await Promise.all(plan.map((p) => stored(w.b, p.id)));
    await expect(
      zipOf(w, w.b, {
        signal: ctrl.signal,
        onProgress: (p) => {
          if (p.step === 'pages' && p.done >= 1) ctrl.abort();
        },
      }),
    ).rejects.toBeInstanceOf(ExportCancelled);
    expect(await Promise.all(plan.map((p) => stored(w.b, p.id)))).toEqual(before);
    expect(document.querySelectorAll('.print-view')).toHaveLength(0);
  });

  it('a una carpeta del disco: el mismo árbol, sin zip', async () => {
    const w = await world();
    const written = new Map<string, Uint8Array>();
    const target: DownloadTarget = {
      kind: 'dir',
      makeDir: async () => undefined,
      makeFile: async (path): Promise<FileOut> => {
        const parts: Uint8Array[] = [];
        return {
          write: async (c) => void parts.push(c.slice()),
          close: async () => void written.set(path, Uint8Array.from(parts.flatMap((p) => Array.from(p)))),
          abort: async () => undefined,
        };
      },
    };
    await zipOf(w, w.b, { target });
    const day1 = '01_Dia_1_exteriores';
    expect([...written.keys()]).toEqual(expect.arrayContaining(['index.html', 'style.css', '_shotdocs/manifest.json', `${day1}/01_Dia_1_exteriores.html`, `${day1}/Files/_view/IMG_0412.jpg`]));
    expect(new TextDecoder().decode(written.get(`${day1}/Files/IMG_0412.JPG`))).toBe(content(4000, 1));
  });
});

describe('exportar zip: la ventana', () => {
  function services(d: Device): Services {
    const config = { url: 'https://x.supabase.co', publishableKey: 'sb_publishable_test', name: 'Test', localKey: 'test', storage: {} };
    const client = { auth: { getSession: async () => ({ data: { session: null } }) } } as never;
    return {
      workspace: { config, client },
      client,
      user: { id: d.remote.userId, email: OWNER_EMAIL },
      db: d.db,
      tree: d.tree,
      docs: d.docs,
      files: d.files,
      media: d.media,
      engine: d.engine,
      access: d.access,
      remote: d.remote as unknown as SupabaseRemote,
      dbName: 'test',
      mediaDb: d.mediaDb,
      comments: d.comments,
      commentsDb: d.commentsDb,
      sizes: d.sizes,
      shutdown: async () => undefined,
    } as unknown as Services;
  }

  const settle = (ms = 30) => act(async () => new Promise((r) => setTimeout(r, ms)));
  // jsdom no carga imágenes: sin esto, la ventana espera 8 s por página a que se pongan (como en el navegador si no llegan).
  const imagesLoad = () => vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
  const button = (host: HTMLElement, label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label);

  it('elegir el zip: los pesos por casilla, armarlo en memoria con avance y guardarlo; Escape no cierra mientras trabaja', async () => {
    const w = await world();
    imagesLoad();
    // El portero en memoria también para lo que pide la app con `fetch` (los originales y el HEIC).
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith('https://portero.test') ? w.server.portero.fetch(input, init) : real(input, init),
    );
    const saved: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download);
    });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    let closed = 0;
    await act(async () =>
      root.render(
        <ServicesContext.Provider value={services(w.b)}>
          <ExportDialog target={{ kind: 'page', id: w.root }} onClose={() => closed++} />
        </ServicesContext.Provider>,
      ),
    );
    const zipRadio = [...host.querySelectorAll<HTMLInputElement>('input[name="export-format"]')][1]!;
    expect(zipRadio.parentElement?.textContent).toBe('Zip — to archive');
    await act(async () => zipRadio.click());
    for (let i = 0; i < 100 && !host.textContent?.includes('previews'); i++) await settle();
    expect(host.textContent).toContain(`Original photos3 · ${formatSize(4000 + 5000 + 2200)}`);
    expect(host.textContent).toContain(`Videos1 · ${formatSize(6000)}`);
    expect(host.textContent).toContain('3 pages');
    expect(host.textContent).toContain('5 files');
    expect(host.textContent).toMatch(/≈ 10 file server requests · 1% of today's limit/);
    // Las casillas: el tooltip no repite el nombre.
    expect(host.querySelector('[data-tip]')?.getAttribute('data-tip')).not.toBe('Original photos');
    // jsdom no tiene `showSaveFilePicker`: el zip se arma en memoria.
    await act(async () => button(host, 'Prepare .zip')!.click());
    expect(host.textContent).toContain('Keep this tab open');
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(closed).toBe(0);
    for (let i = 0; i < 300 && !host.textContent?.includes('The zip is ready'); i++) await settle();
    expect(host.textContent).toContain('The zip is ready.');
    const save = button(host, 'Save Rodaje_·_Semana_1.zip')!;
    await act(async () => save.click());
    expect(saved).toEqual(['Rodaje_·_Semana_1.zip']);
    expect(document.querySelectorAll('.print-view, .sd-export-source')).toHaveLength(0);
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(closed).toBe(1);
  });

  it('sin red avisa qué originales van a faltar; cancelar a mitad vuelve sin dejar nada', async () => {
    const w = await world();
    imagesLoad();
    // B ya vio las páginas con red (sabe qué archivos son) y se quedó sin red.
    await estimateZip(exportPlan(w.b.tree, 'page', w.root), w.b.docs, appArchiveMedia(w.b.media, w.b.mediaDb));
    w.server.online = false;
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () =>
      root.render(
        <ServicesContext.Provider value={services(w.b)}>
          <ExportDialog target={{ kind: 'page', id: w.root }} onClose={() => undefined} />
        </ServicesContext.Provider>,
      ),
    );
    await act(async () => [...host.querySelectorAll<HTMLInputElement>('input[name="export-format"]')][1]!.click());
    for (let i = 0; i < 100 && !host.textContent?.includes('previews'); i++) await settle();
    expect(host.textContent).toContain('5 originals are not on this device; they will be missing until you are online.');
    expect(host.textContent).not.toContain('file server requests');
    // Sin las fotos, los adjuntos ni los videos, no falta nada.
    for (const label of ['Original photos', 'Attachments', 'Videos']) {
      const box = [...host.querySelectorAll('label')].find((l) => l.textContent?.startsWith(label))!.querySelector('input')!;
      await act(async () => box.click());
    }
    expect(host.textContent).not.toContain('are not on this device');
    await act(async () => button(host, 'Prepare .zip')!.click());
    await act(async () => button(host, 'Cancel')!.click());
    for (let i = 0; i < 100 && !host.textContent?.includes('Cancelled'); i++) await settle();
    expect(host.textContent).toContain('Cancelled: nothing was saved.');
    expect(document.querySelectorAll('.print-view, .sd-export-source')).toHaveLength(0);
  });
  it('el zip, solo para el dueño y los admins y nunca desde un teléfono; el PDF sigue para quien ve (D60, D63)', async () => {
    const w = await world();
    w.server.addMember('mem', 'member', 'miembro@estudio.test');
    w.server.grant('mem', { pageId: w.root }, 'view');
    const member = await device(w.server, { id: 'mem', email: 'miembro@estudio.test' });
    await sync(member);
    await sync(member);
    const render = async (d: Device, user = OWNER_EMAIL) => {
      const host = document.createElement('div');
      document.body.append(host);
      const root = createRoot(host);
      roots.push(root);
      const s = services(d);
      (s as { user: unknown }).user = { id: d.remote.userId, email: user };
      await act(async () =>
        root.render(
          <ServicesContext.Provider value={s}>
            <ExportDialog target={{ kind: 'page', id: w.root }} onClose={() => undefined} />
          </ServicesContext.Provider>,
        ),
      );
      const radios = [...host.querySelectorAll<HTMLInputElement>('input[name="export-format"]')];
      return { host, pdf: radios[0]!, zip: radios[1]! };
    };
    // Un miembro con Ver: el PDF sí; el zip apagado, con su porqué.
    const m = await render(member, 'miembro@estudio.test');
    expect(m.pdf.disabled).toBe(false);
    expect(m.zip.disabled).toBe(true);
    expect(m.zip.parentElement?.getAttribute('data-tip')).toBe('Only the workspace owner and admins can export a zip.');
    expect([...m.host.querySelectorAll('button')].some((b) => b.textContent === 'Export PDF')).toBe(true);
    // Un admin, sí.
    w.server.addMember('adm', 'admin', 'admin@estudio.test');
    const admin = await device(w.server, { id: 'adm', email: 'admin@estudio.test' });
    await sync(admin);
    expect((await render(admin, 'admin@estudio.test')).zip.disabled).toBe(false);
    // El dueño en un iPhone: apagado (solo el PDF).
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1');
    const phone = await render(w.b);
    expect(phone.zip.disabled).toBe(true);
    expect(phone.zip.parentElement?.getAttribute('data-tip')).toBe('The zip is made from a computer. On a phone or tablet, export the PDF.');
  });
});

describe('exportar zip: rutas largas de Windows y marcas de plantilla (auditoría O1 y O6)', () => {
  /** Un árbol hostil: títulos de 200 letras con emojis, 6 niveles, hermanas con el mismo título, archivos de 180 letras. */
  async function hostile() {
    const server = new FakeServer();
    server.enableTrash();
    const a = await device(server);
    await sync(a);
    const long = (n: number) => `Escena ${n} 👨‍👩‍👧‍👦 con un título larguísimo de supervisión de efectos visuales que no termina más `.repeat(4).slice(0, 200);
    const root = await a.tree.create(null, `${long(0)} Rodaje`);
    const chain = [root];
    for (let level = 1; level < 6; level++) chain.push(await a.tree.create(chain[level - 1], long(level)));
    // Hermanas con el mismo título (en dos niveles) y una página en el fondo con el mismo título que su madre.
    const twinA = await a.tree.create(root, long(1));
    const twinB = await a.tree.create(root, long(1));
    await sync(a);
    const deepest = chain[5];
    const fileName = `${'Foto de referencia del set con un nombre de archivo muy largo 📷 '.repeat(4).slice(0, 176)}.JPG`;
    const photo = await a.media.add(deepest, file(1500, fileName, 'image/jpeg', 11));
    const twin = await a.media.add(deepest, file(1600, fileName.toLowerCase(), 'image/jpeg', 12));
    await writeBlocks(a.docs, deepest, [
      { type: 'paragraph', content: [{ type: 'link', href: `/p/${twinA}`, content: 'la gemela' }] },
      { type: 'image', props: { url: photo, name: fileName } },
      { type: 'image', props: { url: twin, name: fileName } },
    ] as never);
    await writeBlocks(a.docs, twinB, [{ type: 'image', props: { url: photo, name: fileName } }] as never);
    await sync(a);
    await a.media.idle();
    await sync(a);
    return { server, a, root, chain, twinA, twinB };
  }

  async function build(a: Device, kind: 'page' | 'project', target: string, title: string) {
    const sink = new BlobSink();
    const result = await buildZip({
      title,
      kind,
      project: kind === 'project' ? { id: target, name: title } : null,
      plan: exportPlan(a.tree, kind, target),
      rows: (id) => a.tree.get(id),
      source: a.docs,
      editor: await editor(a),
      media: appArchiveMedia(a.media, a.mediaDb),
      include: ALL,
      comments: null,
      me: { id: a.remote.userId, email: OWNER_EMAIL },
      online: true,
      target: { kind: 'zip', sink },
      convertHeic: fakeConvertHeic,
      appVersion: '0.0XX',
    });
    return { result, zip: new Uint8Array(await sink.blob().arrayBuffer()) };
  }

  it('ninguna ruta pasa el tope con la carpeta de Descargas, sin choques, y los links del .html y el .md siguen andando', async () => {
    const h = await hostile();
    const title = h.a.tree.get(h.root)!.title;
    for (const [kind, target, name] of [
      ['page', h.root, title],
      ['project', h.server.workspaceId, `${'Proyecto con un nombre larguísimo 🎬 '.repeat(8)}`],
    ] as const) {
      const { result, zip } = await build(h.a, kind, target, name);
      expect(result.missing).toEqual([]);
      if (!hasPython) continue;
      const z = read(zip);
      expect(z.bad).toBeNull();
      const root = rootFolderName(name);
      expect(root.length).toBeLessThanOrEqual(ROOT_NAME_MAX);
      const base = TYPICAL_BASE.length + root.length + 1;
      const files = z.names.filter((n) => !n.endsWith('/'));
      // El tope: la carpeta de destino típica, el nombre del zip y la ruta adentro (Windows cuenta en UTF-16).
      const longest = Math.max(...files.map((n) => base + n.length));
      expect(longest, files.find((n) => base + n.length === longest)).toBeLessThanOrEqual(SAFE_PATH);
      // Ninguna entrada repite el nombre del zip como carpeta de arriba.
      expect(files.some((n) => n.startsWith(`${root}/`))).toBe(false);
      // Sin choques (Windows y la Mac no distinguen mayúsculas).
      expect(new Set(files.map((n) => n.toLowerCase())).size).toBe(files.length);
      // Las dos fotos con el mismo nombre (salvo mayúsculas) quedan separadas, con su extensión.
      const originals = files.filter((n) => /\/Files\/[^/]+\.jpg$/i.test(n) && !n.includes('/_view/'));
      expect(originals).toHaveLength(2);
      for (const o of originals) expect(o).toMatch(/\.JPG$|\.jpg$/);
      // Cada link del .html y del .md (fotos, originales, otras páginas, estilos) existe en el zip.
      const resolve = (dir: string, h: string) => {
        const out: string[] = [];
        for (const part of (dir ? `${dir}/${decodeURIComponent(h)}` : decodeURIComponent(h)).split('/')) if (part === '..') out.pop(); else out.push(part);
        return out.join('/');
      };
      let links = 0;
      for (const f of files.filter((n) => /\.(html|md)$/.test(n))) {
        const body = text(z.entries.find((e) => e.name === f));
        const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '';
        const targets = f.endsWith('.html')
          ? [...body.matchAll(/(?:href|src)="([^"#]+)"/g)].map((m) => m[1]!).filter((x) => !/^(https?:|data:|mailto:)/.test(x))
          : [...body.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]!).filter((x) => !/^(https?:|mailto:|#)/.test(x));
        for (const t of targets) {
          links++;
          expect(files, `${f} → ${t}`).toContain(resolve(dir, t));
        }
      }
      expect(links).toBeGreaterThan(20);
      // El manifest dice dónde está cada página y cada archivo (para volver, EX6): todo existe.
      const manifest = JSON.parse(text(z.entries.find((e) => e.name === '_shotdocs/manifest.json'))) as {
        pages: { html: string; md: string; json: string }[];
        files: { original: string | null; view: string | null }[];
      };
      for (const p of manifest.pages) for (const path of [p.html, p.md, p.json]) expect(files).toContain(path);
      for (const f of manifest.files) for (const path of [f.original, f.view]) if (path) expect(files).toContain(path);
    }
  });

  it('cada carpeta reparte lo que queda entre ella y las de abajo; los nombres se cortan sin partir un emoji', () => {
    const fmt = { size: 'A4' as const, landscape: false };
    const t = 'Título larguísimo 👨‍👩‍👧‍👦 '.repeat(20);
    const plan = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, title: t, depth: i, parent: i ? `p${i - 1}` : null, header: [], format: fmt }));
    const limit = pathLimit(rootFolderName(t));
    const slots = pageSlots(plan, { flatRoot: true, root: rootFolderName(t), limit });
    expect(slots.get('p0')!.dir).toBe('');
    const deepest = slots.get('p7')!.dir;
    expect(deepest.length + '/Files/_view/'.length + 32).toBeLessThanOrEqual(limit + 8);
    for (const s of slots.values()) for (const part of s.dir.split('/').filter(Boolean)) expect(part).toMatch(/^\d{2}_/);
    // Sin medio emoji: cada parte es texto bien formado.
    for (const s of slots.values()) expect(() => encodeURIComponent(s.dir)).not.toThrow();
    const names = new FileNames(limit);
    const long = `${'a'.repeat(170)}.HEIC`;
    const cut = names.original(deepest, long);
    expect(cut.endsWith('.HEIC')).toBe(true);
    expect(deepest.length + '/Files/'.length + cut.length).toBeLessThanOrEqual(limit);
    expect(names.original(deepest, long.toUpperCase().replace('.HEIC', '.heic'))).toMatch(/ \(2\)\.heic$/);
    // La raíz nunca pisa el índice.
    expect(pageSlots([{ ...plan[0]!, title: 'index' }], { flatRoot: true, root: 'index', limit }).get('p0')!.name).toBe('index_page');
  });

  it('el manifest guarda las marcas de plantilla (v0.124) sin nombrar páginas de afuera', async () => {
    const server = new FakeServer();
    const a = await device(server);
    await sync(a);
    const folder = await a.tree.create(null, 'Templates');
    await a.tree.setSetting(folder, 'templatesFolder', true);
    const own = await a.tree.create(folder, 'Mi reporte');
    await a.tree.setSetting(own, 'template', { description: 'El de cada día', dayReport: true });
    const off = await a.tree.create(folder, 'Vieja');
    await a.tree.setSetting(off, 'template', false);
    const outside = await a.tree.create(null, 'Plantilla de afuera');
    const reports = await a.tree.create(null, 'Reportes');
    await a.tree.setSetting(reports, 'dayReports', { template: own });
    const day = await a.tree.create(reports, '2026-10-02 | Day 01', undefined, { templateId: own });
    const fromBuiltin = await a.tree.create(reports, 'De fábrica', undefined, { templateId: '5d1b7a0e-3c4f-4e8a-9b21-0f6c2a7d1e02' });
    const fromOutside = await a.tree.create(reports, 'De afuera', undefined, { templateId: outside });
    await sync(a);
    const pagesOf = async (kind: 'page' | 'project', target: string) => {
      const { zip } = await build(a, kind, target, 'X');
      const z = read(zip);
      const manifest = JSON.parse(text(z.entries.find((e) => e.name === '_shotdocs/manifest.json'))) as { pages: { id: string; settings: Record<string, unknown>; templateId: string | null }[] };
      return new Map(manifest.pages.map((p) => [p.id, p]));
    };
    if (!hasPython) return;
    // El proyecto entero: todo, con la plantilla de los reportes (que también va).
    const all = await pagesOf('project', server.workspaceId);
    expect(all.get(folder)!.settings).toEqual({ templatesFolder: true });
    expect(all.get(own)!.settings).toEqual({ template: { description: 'El de cada día', dayReport: true } });
    expect(all.get(off)!.settings).toEqual({ template: false });
    expect(all.get(reports)!.settings).toEqual({ dayReports: { template: own } });
    expect(all.get(day)!.templateId).toBe(own);
    expect(all.get(fromBuiltin)!.templateId).toBe('5d1b7a0e-3c4f-4e8a-9b21-0f6c2a7d1e02');
    expect(all.get(fromOutside)!.templateId).toBe(outside);
    // Solo la rama de los reportes: la marca queda, sin el id de la plantilla, que quedó afuera.
    const branch = await pagesOf('page', reports);
    expect(branch.get(reports)!.settings).toEqual({ dayReports: {} });
    expect(branch.get(day)!.templateId).toBeNull();
    expect(branch.get(fromBuiltin)!.templateId).toBe('5d1b7a0e-3c4f-4e8a-9b21-0f6c2a7d1e02');
    expect(branch.get(fromOutside)!.templateId).toBeNull();
    expect(settingsOf({ dayReports: false }, { parent: 'x', format: { size: 'free', landscape: false } }, new Set())).toEqual({ dayReports: false });
  });
});
