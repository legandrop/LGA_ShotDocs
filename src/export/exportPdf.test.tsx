// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { undoDepth } from 'prosemirror-history';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ServicesContext, type Services } from '../services';
import { Permissions, LEVEL_VIEW } from '../sync/access';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { installPrintShortcuts } from '../ui/printPage';
import { ExportDialog } from '../ui/ExportDialog';
import { appComments, authorLabel, blockText, commentsSection, nameFromEmail } from './exportComments';
import { ExportEditor } from './exportEditor';
import { PhotoLimitError, PixelBudget, printSize, shrinkImages, type Resizer } from './exportImages';
import { exportPlan, type ExportSource } from './exportPages';
import { anchorId, buildPdf, PageLimitError, pageRules, PDF_LIMITS, printBook, rewriteLinks, sheetName, type BuildOptions } from './exportPdf';
import { keepsPageSizes } from './printSupport';
import { testProject, writeBlocks, writeTestProject } from './testProject';

// Exportar, entrega 1 (Docs/Doc_Exportar.md): el PDF de una rama o de un proyecto. Acá, sin el navegador (jsdom no
// mide ni carga imágenes): qué páginas entran y con qué hoja, el índice y sus links, los links entre páginas, las
// fotos achicadas y el tope, los comentarios sin correos, una página mala que no corta todo, lo que NO sale (la
// papelera, lo de arriba de la rama, lo que un invitado no ve) y que nada de esto escribe. Los números de hoja contra
// el PDF de verdad, con `window.print()` y *Save as PDF*, se miden en Chrome y Edge (src/export/bench/pdf.tsx).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
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
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  document.body.replaceChildren();
  document.head.querySelectorAll('style[data-sd-export]').forEach((s) => s.remove());
  document.documentElement.classList.remove('sd-printing');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const photo = (n: number) => ({ url: `https://photos.test/p${n}.jpg`, name: `IMG_${String(n).padStart(4, '0')}.jpg` });

async function project(pages = 14, server = new FakeServer()) {
  const device = await makeDevice(server);
  devices.push(device);
  const specs = testProject({ pages, photosPerPage: 2, seed: 7 }, photo);
  const { projectId, ids } = await writeTestProject(device, 'Película secreta', specs);
  return { device, specs, projectId, ids, server };
}

async function editor() {
  const e = await ExportEditor.create({ imageTimeoutMs: 0, copyTimeoutMs: 0 });
  editors.push(e);
  return e;
}

async function build(device: Device, plan: BuildOptions['plan'], extra: Partial<BuildOptions> = {}) {
  return buildPdf({ title: 'Raíz', plan, source: device.docs, editor: await editor(), named: true, limits: PDF_LIMITS.desktop, ...extra });
}

/** Todo lo guardado de una página (sus filas y su estado), para comparar byte por byte. */
async function stored(device: Device, pageId: string): Promise<string> {
  const rows = await device.db.getAllFromIndex('docUpdates', 'pageId', pageId);
  const state = await device.db.get('docState', pageId);
  const comments = await device.commentsDb.getAllFromIndex('comments', 'page', pageId);
  return JSON.stringify({ rows: rows.map((r) => Array.from(r.data)), state, comments });
}

describe('exportar PDF: la lista de navegadores probados', () => {
  it('solo Chrome y Edge de computadora imprimen cada hoja con su tamaño', () => {
    const ua = (s: string) => ({ userAgent: s });
    const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';
    expect(keepsPageSizes(ua(chrome))).toBe(true);
    expect(keepsPageSizes(ua(`${chrome} Edg/154.0.0.0`))).toBe(true);
    expect(keepsPageSizes({ userAgent: chrome, userAgentData: { brands: [{ brand: 'Google Chrome', version: '154' }], mobile: false } })).toBe(true);
    expect(keepsPageSizes({ userAgent: chrome, userAgentData: { brands: [{ brand: 'Microsoft Edge', version: '154' }], mobile: false } })).toBe(true);
    // Otro Chromium (sin medir), Chrome de un teléfono, Firefox y Safari: no.
    expect(keepsPageSizes({ userAgent: chrome, userAgentData: { brands: [{ brand: 'Brave', version: '1' }, { brand: 'Chromium', version: '154' }], mobile: false } })).toBe(false);
    expect(keepsPageSizes({ userAgent: chrome, userAgentData: { brands: [{ brand: 'Google Chrome', version: '154' }], mobile: true } })).toBe(false);
    expect(keepsPageSizes(ua(`${chrome} OPR/120.0.0.0`))).toBe(false);
    expect(keepsPageSizes(ua('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0 Mobile Safari/537.36'))).toBe(false);
    expect(keepsPageSizes(ua('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0'))).toBe(false);
    expect(keepsPageSizes(ua('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15'))).toBe(false);
    expect(keepsPageSizes(ua('Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1'))).toBe(false);
    expect(keepsPageSizes(null)).toBe(false);
  });

  it('las hojas con nombre de CSS: una regla por tamaño, y una sola sin nombre donde no se respetan', () => {
    expect(sheetName({ size: 'A4', landscape: false })).toBe('sd-A4');
    expect(sheetName({ size: 'A5', landscape: true })).toBe('sd-A5-l');
    expect(sheetName({ size: 'free', landscape: true })).toBe('sd-A4');
    const rules = pageRules([{ size: 'A4', landscape: false }, { size: 'A5', landscape: true }, { size: 'free', landscape: false }], true);
    expect(rules).toContain('@page sd-A4 { size: 210mm 297mm; margin: 20mm; }');
    expect(rules).toContain('@page sd-A5-l { size: 210mm 148mm; margin: 20mm; }');
    expect(rules.match(/@page/g)).toHaveLength(2);
    expect(pageRules([{ size: 'Letter', landscape: false }], false)).toBe('@page { size: 215.9mm 279.4mm; margin: 20mm; }');
  });
});

describe('exportar PDF: las fotos', () => {
  it('cada foto se achica a su ancho impreso a 200 ppp, con tope de 2400 px y nunca más grande que la fuente', () => {
    // 160 px de CSS en la hoja: 334 px a 200 ppp.
    expect(printSize(160, { width: 4000, height: 3000 })).toEqual({ width: 334, height: 251 });
    // Una foto de hoja entera en A3 horizontal: el lado mayor queda en 2400.
    expect(printSize(1400, { width: 6000, height: 4000 })).toEqual({ width: 2400, height: 1600 });
    // Una vertical alta: manda el alto.
    expect(printSize(1000, { width: 3000, height: 6000 })).toEqual({ width: 1200, height: 2400 });
    // La fuente ya es chica: queda la fuente.
    expect(printSize(600, { width: 480, height: 360 })).toEqual({ width: 480, height: 360 });
  });

  /** Un achicador falso: las medidas salen del tipo (`image/x-<ancho>x<alto>`). */
  const fake: Resizer & { calls: [number, number][] } = {
    calls: [],
    async size(blob) {
      const m = /x-(\d+)x(\d+)/.exec(blob.type);
      return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
    },
    async resize(_blob, width, height) {
      this.calls.push([width, height]);
      return new Blob(['jpeg'], { type: 'image/jpeg' });
    },
  };

  function viewWithPhotos(widths: number[]): HTMLElement {
    const root = document.createElement('div');
    for (const [i, w] of widths.entries()) {
      const holder = document.createElement('div');
      holder.dataset.url = `sdmedia://00000000-0000-4000-8000-00000000000${i}`;
      const img = document.createElement('img');
      img.className = 'bn-visual-media';
      img.src = `https://thumbs.test/${i}.jpg`;
      img.getBoundingClientRect = () => ({ width: w, height: w * 0.75 }) as DOMRect;
      holder.append(img);
      root.append(holder);
    }
    document.body.append(root);
    return root;
  }

  it('cambia cada foto por la mejor del dispositivo achicada, y cuenta lo decodificado', async () => {
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test/${Math.random()}`);
    fake.calls = [];
    const root = viewWithPhotos([160, 640]);
    const budget = new PixelBudget(PDF_LIMITS.desktop.pixels);
    const asked: string[] = [];
    const out = await shrinkImages(root, {
      source: { best: async (id) => (asked.push(id), new Blob(['x'], { type: 'image/x-4000x3000' })) },
      budget,
      resizer: fake,
    });
    expect(asked).toHaveLength(2);
    expect(out.shrunk).toBe(2);
    expect(fake.calls).toEqual([
      [334, 251],
      [1334, 1001],
    ]);
    expect(budget.used).toBe(334 * 251 + 1334 * 1001);
    for (const img of root.querySelectorAll('img')) expect(img.getAttribute('src')).toMatch(/^blob:test\//);
    expect(out.urls).toHaveLength(2);
  });

  it('pasado el tope de píxeles corta con su error', async () => {
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:test/x');
    const root = viewWithPhotos([640, 640, 640]);
    const budget = new PixelBudget(2_000_000);
    await expect(
      shrinkImages(root, { source: { best: async () => new Blob(['x'], { type: 'image/x-4000x3000' }) }, budget, resizer: fake }),
    ).rejects.toBeInstanceOf(PhotoLimitError);
  });

  it('una foto que el navegador no abre (un HEIC) queda con la que se ve', async () => {
    const root = viewWithPhotos([300]);
    const out = await shrinkImages(root, { source: { best: async () => new Blob(['x'], { type: 'image/heic' }) }, budget: new PixelBudget(1e9), resizer: fake });
    expect(out.kept).toBe(1);
    expect(root.querySelector('img')?.getAttribute('src')).toBe('https://thumbs.test/0.jpg');
  });
});

describe('exportar PDF: el libro', () => {
  it('el índice lleva cada página con su link y la hoja donde empieza; cada página con su hoja de CSS', async () => {
    const { device, projectId } = await project(14);
    const plan = exportPlan(device.tree, 'project', projectId);
    const book = await build(device, plan, { title: 'Película secreta' });
    const views = [...book.root.children] as HTMLElement[];
    // El índice primero, después cada página en el orden del árbol.
    expect(views[0].classList.contains('sd-export-index')).toBe(true);
    expect(views.slice(1).map((v) => v.id)).toEqual(plan.map((p) => anchorId(p.id)));
    const rows = [...views[0].querySelectorAll<HTMLAnchorElement>('a.sd-export-row')];
    expect(rows.map((r) => r.getAttribute('href'))).toEqual(plan.map((p) => `#${anchorId(p.id)}`));
    // La hoja de cada renglón: después del índice, sumando las hojas de las de antes.
    let next = book.indexSheets + 1;
    book.pages.forEach((p, i) => {
      expect(p.start).toBe(next);
      expect(rows[i].querySelector('.sd-export-row-sheet')?.textContent).toBe(String(next));
      next += p.sheets;
    });
    expect(book.sheets).toBe(next - 1);
    // La sangría por nivel.
    expect(rows.map((r) => r.style.getPropertyValue('--depth'))).toEqual(plan.map((p) => String(p.depth)));
    // Cada página con su hoja de CSS (la rama libre, A4).
    plan.forEach((p, i) => expect(views[i + 1].style.getPropertyValue('page')).toBe(sheetName(p.format)));
    expect(views[0].style.getPropertyValue('page')).toBe(sheetName(plan[0].format));
    expect(book.css).toContain('@page sd-A5-l');
    expect(book.css).toContain('@page sd-A3-l');
    expect(book.css).toContain('@page sd-Letter');
    expect(book.fileTitle).toMatch(/^Película secreta \d{4}-\d{2}-\d{2}$/);
    book.destroy();
    expect(document.querySelectorAll('.print-view, .sd-export-book')).toHaveLength(0);
  });

  it('en un navegador sin la lista, todas las páginas con la hoja de la raíz y una sola regla @page', async () => {
    const { device, ids } = await project(14);
    const plan = exportPlan(device.tree, 'page', ids.get('2')!);
    expect(plan[0].format).toEqual({ size: 'A5', landscape: true });
    const book = await build(device, plan, { named: false });
    for (const v of book.root.children) expect((v as HTMLElement).style.getPropertyValue('page')).toBe('');
    for (const v of book.root.querySelectorAll<HTMLElement>(':scope > .print-view')) expect(v.dataset.format).toBe('A5');
    expect(book.css).toBe('@page { size: 210mm 148mm; margin: 20mm; }');
    book.destroy();
  });

  it('una rama no nombra el proyecto ni nada de arriba, y no lleva la papelera', async () => {
    const { device, ids, specs } = await project(30);
    const branchRoot = ids.get('3')!;
    const trashed = specs.find((s) => s.parent === '3' && s.key.split('.').length === 2)!;
    await device.tree.trash(ids.get(trashed.key)!);
    const plan = exportPlan(device.tree, 'page', branchRoot);
    expect(plan.map((p) => p.id)).not.toContain(ids.get(trashed.key));
    const title = device.tree.get(branchRoot)!.title;
    const book = await build(device, plan, { title });
    const text = book.root.textContent ?? '';
    expect(text).not.toContain('Película secreta');
    expect(text).not.toContain(trashed.title);
    // Ninguna otra rama.
    for (const s of specs.filter((s) => s.parent === null && s.key !== '3')) expect(text).not.toContain(s.title);
    expect(book.root.querySelector('.sd-export-index-title')?.textContent).toBe(title);
    book.destroy();
  });

  it('los links entre páginas: adentro del PDF, internos; afuera, solo el texto', async () => {
    const root = document.createElement('div');
    root.innerHTML = `<p><a href="/p/aaaaaaaa-0000-4000-8000-000000000001">Adentro</a> <a href="${location.origin}/p/bbbbbbbb-0000-4000-8000-000000000002">Afuera</a> <a href="https://example.com/x">Web</a> <a href="javascript:alert(1)">Malo</a></p>`;
    rewriteLinks(root, new Set(['aaaaaaaa-0000-4000-8000-000000000001']));
    const links = [...root.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]);
    expect(links).toEqual([
      ['Adentro', `#${anchorId('aaaaaaaa-0000-4000-8000-000000000001')}`],
      ['Web', 'https://example.com/x'],
    ]);
    expect(root.textContent).toBe('Adentro Afuera Web Malo');
    expect(root.innerHTML).not.toContain('bbbbbbbb');
  });

  it('un link a otra página del proyecto sale interno en el libro, y uno de afuera de la rama sale como texto', async () => {
    const device = await makeDevice(new FakeServer());
    devices.push(device);
    const projectId = await device.tree.createProject('Proyecto');
    const a = await device.tree.create(null, 'A', projectId);
    const a1 = await device.tree.create(a, 'A1', projectId);
    const b = await device.tree.create(null, 'B', projectId);
    await writeBlocks(device.docs, a, [
      { type: 'paragraph', content: [{ type: 'link', href: `/p/${a1}`, content: 'Ir a A1' }, ' y ', { type: 'link', href: `/p/${b}`, content: 'ir a B' }] },
    ] as never);
    const book = await build(device, exportPlan(device.tree, 'page', a));
    const page = book.root.querySelector<HTMLElement>(`#${anchorId(a)}`)!;
    expect(page.querySelector('a')?.getAttribute('href')).toBe(`#${anchorId(a1)}`);
    expect(page.textContent).toContain('ir a B');
    expect(page.innerHTML).not.toContain(b);
    book.destroy();
  });

  it('demasiadas páginas: lo dice antes de empezar, sin armar nada', async () => {
    const { device, projectId } = await project(14);
    const plan = exportPlan(device.tree, 'project', projectId);
    await expect(build(device, plan, { limits: { ...PDF_LIMITS.touch, pages: 5 } })).rejects.toBeInstanceOf(PageLimitError);
    expect(document.querySelectorAll('.print-view, .sd-export-book')).toHaveLength(0);
  });

  it('una página que no se puede leer no corta la exportación: sale marcada y las demás siguen', async () => {
    const { device, projectId } = await project(8);
    const plan = exportPlan(device.tree, 'project', projectId);
    const bad = plan[3].id;
    const source: ExportSource = {
      snapshot: (id) => (id === bad ? Promise.reject(new Error('rota')) : device.docs.snapshot(id)),
    };
    const book = await build(device, plan, { source });
    expect(book.pages).toHaveLength(plan.length);
    expect(book.pages[3].failed).toBe(true);
    const view = book.root.querySelector<HTMLElement>(`#${anchorId(bad)}`)!;
    expect(view.textContent).toContain('This page could not be exported.');
    expect(view.textContent).toContain(plan[3].title);
    expect(book.pages.filter((p) => p.failed)).toHaveLength(1);
    book.destroy();
  });

  it('lo que esta versión no conoce y lo que falta bajar salen avisados arriba del título', async () => {
    const { device, projectId } = await project(8);
    const plan = exportPlan(device.tree, 'project', projectId);
    const target = plan.find((p) => p.depth === 1)!;
    const book = await build(device, plan, { gap: (id) => (id === target.id ? 'missing' : null) });
    const view = book.root.querySelector<HTMLElement>(`#${anchorId(target.id)}`)!;
    const note = view.querySelector('.sd-export-note');
    expect(note?.textContent).toBe('This page may be out of date on this device.');
    // Arriba del título.
    expect(note!.compareDocumentPosition(view.querySelector('.page-title')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(book.pages.find((p) => p.id === target.id)?.outdated).toBe(true);
    expect(book.pages.filter((p) => p.outdated)).toHaveLength(1);
    book.destroy();
  });

  it('cancelar no deja nada en el documento', async () => {
    const { device, projectId } = await project(10);
    const controller = new AbortController();
    const out = build(device, exportPlan(device.tree, 'project', projectId), {
      signal: controller.signal,
      onProgress: (p) => p.done === 3 && controller.abort(),
    });
    await expect(out).rejects.toThrow('Export cancelled');
    expect(document.querySelectorAll('.print-view, .sd-export-book')).toHaveLength(0);
  });
});

describe('exportar PDF: los comentarios', () => {
  it('con la casilla, cada página termina con sus hilos: nombres y nunca correos; sin la casilla, nada', async () => {
    const server = new FakeServer();
    server.enableComments();
    const { device, projectId, ids, specs } = await project(8, server);
    await device.engine.syncNow();
    const pageKey = specs.find((s) => s.blocks.length > 0)!.key;
    const page = ids.get(pageKey)!;
    const thread = await device.comments.add(page, null, 'Cambiar el lente a 35');
    await device.comments.add(page, null, 'Hecho', thread);
    const deleted = await device.comments.add(page, null, 'BORRADO_SECRETO');
    await device.comments.add(page, null, 'Respuesta viva', deleted);
    await device.comments.remove(page, deleted);
    await device.engine.syncNow();
    await device.comments.run();

    const plan = exportPlan(device.tree, 'project', projectId);
    const me = { id: device.remote.userId, email: 'lega.supervisor@wanka.test' };
    const without = await build(device, plan);
    expect(without.root.querySelector('.sd-export-comments')).toBeNull();
    without.destroy();

    const before = new Map<string, string>();
    for (const p of plan) before.set(p.id, await stored(device, p.id));
    const book = await build(device, plan, { comments: appComments(device.comments, device.commentsDb, me) });
    const view = book.root.querySelector<HTMLElement>(`#${anchorId(page)}`)!;
    const text = view.querySelector('.sd-export-comments')?.textContent ?? '';
    expect(text).toContain('Cambiar el lente a 35');
    expect(text).toContain('Hecho');
    expect(text).toContain('lega.supervisor');
    expect(text).toContain('(deleted comment)');
    expect(text).toContain('Respuesta viva');
    expect(book.root.textContent).not.toContain('BORRADO_SECRETO');
    // Ningún correo en ningún lado del PDF.
    expect(book.root.textContent).not.toMatch(/@/);
    // Solo la página comentada lleva la sección.
    expect(book.root.querySelectorAll('.sd-export-comments')).toHaveLength(1);
    // Nada cambió: ni las páginas ni los comentarios guardados.
    for (const p of plan) expect(await stored(device, p.id)).toBe(before.get(p.id));
    book.destroy();
  });

  it('el autor sale con su nombre: el del equipo sin la parte del correo, el importado y el del link tal cual', () => {
    const source = { nameOf: (id: string) => (id === 'u1' ? nameFromEmail('ana.garcia@estudio.test') : null) };
    expect(authorLabel({ authorId: 'u1', importedAuthor: null, linkAuthor: null }, source)).toBe('ana.garcia');
    expect(authorLabel({ authorId: null, importedAuthor: 'Productora', linkAuthor: null }, source)).toBe('Productora');
    expect(authorLabel({ authorId: null, importedAuthor: 'cliente@afuera.test', linkAuthor: null }, source)).toBe('cliente');
    expect(authorLabel({ authorId: null, importedAuthor: null, linkAuthor: 'Juan' }, source)).toBe('Juan (via link)');
    expect(authorLabel({ authorId: null, importedAuthor: null, linkAuthor: null }, source)).toBe('Deleted account');
    expect(authorLabel({ authorId: 'u9', importedAuthor: null, linkAuthor: null }, source)).toBe('Someone');
  });

  it('el hilo dice a qué bloque está anclado (80 letras) y si está resuelto', () => {
    const blocks = [{ id: 'b1', content: [{ type: 'text', text: 'Plano general '.repeat(10) }], children: [{ id: 'b2', content: [{ type: 'text', text: 'Hijo' }] }] }];
    expect(blockText(blocks[0])).toMatch(/^Plano general Plano/);
    const view = (id: string, body: string, extra = {}) => ({
      id,
      pageId: 'p',
      blockId: 'b1',
      threadId: null,
      body,
      authorId: null,
      importedFrom: null,
      importedAuthor: 'Ana',
      importedAuthorEmail: 'ana@x.test',
      importedBy: null,
      createdAt: '2026-10-02T10:00:00Z',
      editedAt: null,
      deleted: false,
      pending: false,
      local: false,
      error: null,
      failedSeqs: [],
      failedKinds: [],
      rejectedText: null,
      ...extra,
    });
    const section = commentsSection(
      [
        { id: 't1', pageId: 'p', blockId: 'b1', root: view('t1', 'Uno'), replies: [], resolved: true, resolvedAt: null, resolvedBy: null, count: 1, pending: false, error: null },
        { id: 't2', pageId: 'p', blockId: 'b2', root: view('t2', 'Dos'), replies: [], resolved: false, resolvedAt: null, resolvedBy: null, count: 1, pending: false, error: null },
      ],
      blocks,
      { nameOf: () => null },
    )!;
    const anchors = [...section.querySelectorAll('.sd-export-anchor')].map((a) => a.textContent ?? '');
    expect(anchors[0]).toMatch(/^“Plano general .*…” Resolved$/);
    expect(Array.from(anchors[0].split('”')[0].slice(1).replace('…', '')).length).toBe(80);
    expect(anchors[1]).toBe('“Hijo”');
    expect(section.textContent).not.toContain('ana@x.test');
  });
});

describe('exportar PDF: un invitado', () => {
  it('con dos ramas exporta solo la suya: ni la otra, ni el proyecto', async () => {
    const server = new FakeServer();
    server.enableTeam();
    const owner = await makeDevice(server);
    devices.push(owner);
    const a = await owner.tree.create(null, 'Rama del cliente');
    const a1 = await owner.tree.create(a, 'Escena del cliente');
    const b = await owner.tree.create(null, 'Rama interna');
    await owner.tree.create(b, 'Notas internas');
    const c = await owner.tree.create(null, 'Otra rama del cliente');
    await writeBlocks(owner.docs, a1, [{ type: 'paragraph', content: 'Texto de la escena' }]);
    await owner.engine.syncNow();
    server.addMember('cli', 'guest');
    server.grant('cli', { pageId: a }, 'view');
    server.grant('cli', { pageId: c }, 'view');
    const guest = await makeDevice(server, crypto.randomUUID(), '0.021', {}, undefined, { id: 'cli', email: 'cliente@afuera.test' });
    devices.push(guest);
    await guest.engine.syncNow();
    await guest.engine.syncNow();
    const perms = new Permissions(guest.tree, guest.access.get(), 'cli');
    // "Export project…" no se le ofrece: no ve el proyecto entero.
    expect(perms.projectLevel(server.workspaceId)).toBeLessThan(LEVEL_VIEW);
    expect(guest.tree.get(b)).toBeUndefined();
    const plan = exportPlan(guest.tree, 'page', a);
    expect(plan.map((p) => p.title)).toEqual(['Rama del cliente', 'Escena del cliente']);
    const book = await build(guest, plan, { title: guest.tree.get(a)!.title });
    const text = book.root.textContent ?? '';
    expect(text).toContain('Texto de la escena');
    const projectName = owner.tree.project(server.workspaceId)?.name ?? '';
    for (const hidden of ['Rama interna', 'Notas internas', 'Otra rama del cliente', projectName].filter(Boolean)) expect(text).not.toContain(hidden);
    expect(book.root.querySelector('.sd-export-index-title')?.textContent).toBe('Rama del cliente');
    book.destroy();
  });
});

describe('exportar PDF: imprimir', () => {
  it('abre el diálogo con solo el libro y sus hojas, y al cerrarlo deja todo como estaba', async () => {
    const { device, projectId } = await project(6);
    const book = await build(device, exportPlan(device.tree, 'project', projectId), { title: 'Proyecto' });
    const before = document.title;
    let printed = 0;
    let during = { cls: false, css: '', title: '' };
    printBook(book, {
      print: () => {
        printed++;
        during = { cls: document.documentElement.classList.contains('sd-printing'), css: document.head.querySelector('style[data-sd-export]')?.textContent ?? '', title: document.title };
      },
    });
    expect(printed).toBe(1);
    expect(during.cls).toBe(true);
    expect(during.css).toBe(book.css);
    expect(during.title).toBe(book.fileTitle);
    window.dispatchEvent(new Event('afterprint'));
    expect(document.documentElement.classList.contains('sd-printing')).toBe(false);
    expect(document.head.querySelector('style[data-sd-export]')).toBeNull();
    expect(document.title).toBe(before);
    // El libro sigue armado (se puede volver a abrir el diálogo).
    expect(book.root.isConnected).toBe(true);
    book.destroy();
  });

  it('con el libro listo, la impresión de la página de atrás no se arma encima', async () => {
    const { device, projectId } = await project(4);
    const book = await build(device, exportPlan(device.tree, 'project', projectId));
    const article = document.createElement('article');
    article.className = 'page';
    article.dataset.pageId = 'p1';
    article.innerHTML = '<div class="page-header"></div><textarea class="page-title"></textarea><div class="editor-host"><div class="bn-editor"><p>x</p></div></div>';
    document.body.append(article);
    const stop = installPrintShortcuts(() => ({ pageId: 'p1', format: { size: 'A4', landscape: false } }));
    try {
      const done = printBook(book, { print: () => window.dispatchEvent(new Event('beforeprint')) });
      expect(document.querySelectorAll('body > .print-view.print-output')).toHaveLength(0);
      done();
    } finally {
      stop();
      book.destroy();
    }
  });
});

describe('exportar PDF: el editor de exportación (observaciones de la entrega 0)', () => {
  it('no guarda historial de deshacer de las páginas anteriores', async () => {
    const { device, projectId } = await project(6);
    const e = await editor();
    const plan = exportPlan(device.tree, 'project', projectId);
    const book = await buildPdf({ title: 'x', plan, source: device.docs, editor: e, named: true, limits: PDF_LIMITS.desktop });
    const view = (e as unknown as { editor: { prosemirrorView: { state: Parameters<typeof undoDepth>[0] } } }).editor.prosemirrorView;
    expect(undoDepth(view.state)).toBe(0);
    book.destroy();
  });

  it('con imágenes que nunca llegan, no espera dos veces y después de tres páginas acorta la espera', async () => {
    // Un `resolveFileUrl` que no contesta nunca: la imagen queda "cargando".
    const e = await ExportEditor.create({ resolveFileUrl: () => new Promise<string>(() => undefined), imageTimeoutMs: 200, copyTimeoutMs: 5000, shortTimeoutMs: 20 });
    editors.push(e);
    const page = (n: number) => ({ id: `p${n}`, title: `P${n}`, header: [], format: { size: 'A4' as const, landscape: false }, blocks: [{ type: 'image', props: { url: `sdmedia://00000000-0000-4000-8000-00000000000${n}`, name: 'x.jpg' } }] as never });
    const times: number[] = [];
    const timedOut: boolean[] = [];
    for (let n = 0; n < 6; n++) {
      const t0 = performance.now();
      const r = await e.render(page(n));
      times.push(performance.now() - t0);
      timedOut.push(r.imagesTimedOut);
      r.view.root.remove();
    }
    expect(timedOut.every(Boolean)).toBe(true);
    // Sin la espera de la copia (5 s): cada una de las tres primeras, unos 200 ms.
    for (const ms of times.slice(0, 3)) expect(ms).toBeLessThan(1500);
    // Las siguientes, con la espera corta.
    for (const ms of times.slice(3)) expect(ms).toBeLessThan(150);
  });
});

describe('exportar PDF: la ventana', () => {
  function services(d: Device): Services {
    const config = { url: 'https://x.supabase.co', publishableKey: 'sb_publishable_test', name: 'Test', localKey: 'test', storage: {} };
    const client = { auth: { getSession: async () => ({ data: { session: null } }) } } as never;
    return {
      workspace: { config, client },
      client,
      user: { id: d.remote.userId, email: 'owner@test' },
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

  it('arma el PDF de la rama con avance, abre el diálogo y al cerrar suelta todo', async () => {
    const { device, ids } = await project(14);
    const branch = ids.get('1')!;
    const inside = exportPlan(device.tree, 'page', branch).length - 1;
    const print = vi.fn();
    vi.stubGlobal('print', print);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    let closed = 0;
    await act(async () =>
      root.render(
        <ServicesContext.Provider value={services(device)}>
          <ExportDialog target={{ kind: 'page', id: branch }} onClose={() => closed++} />
        </ServicesContext.Provider>,
      ),
    );
    expect(host.textContent).toContain(`This page and the pages inside (${inside})`);
    // jsdom no está en la lista medida: lo avisa.
    expect(host.textContent).toContain('This browser prints every page at A4');
    const exportButton = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Export PDF')!;
    await act(async () => exportButton.click());
    for (let i = 0; i < 200 && !host.textContent?.includes('Ready'); i++) await settle(30);
    expect(host.textContent).toMatch(/Ready: \d+ PDF pages?\./);
    expect(print).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.sd-export-book')).toHaveLength(1);
    expect(document.querySelectorAll('.sd-export-book > .print-view')).toHaveLength(inside + 2);
    window.dispatchEvent(new Event('afterprint'));
    // Ctrl+P con el PDF listo: este PDF otra vez.
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', ctrlKey: true })));
    expect(print).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event('afterprint'));
    await act(async () => root.unmount());
    roots.splice(roots.indexOf(root), 1);
    expect(document.querySelectorAll('.sd-export-book, .print-view')).toHaveLength(0);
    expect(document.documentElement.classList.contains('sd-printing')).toBe(false);
    expect(closed).toBe(0);
  });

  it('pasado el tope de páginas no empieza y ofrece las partes', async () => {
    const { device, projectId } = await project(14);
    const original = PDF_LIMITS.desktop.pages;
    PDF_LIMITS.desktop.pages = 5;
    try {
      const host = document.createElement('div');
      document.body.append(host);
      const root = createRoot(host);
      roots.push(root);
      await act(async () =>
        root.render(
          <ServicesContext.Provider value={services(device)}>
            <ExportDialog target={{ kind: 'project', id: projectId }} onClose={() => undefined} />
          </ServicesContext.Provider>,
        ),
      );
      expect(host.textContent).toContain('14 pages are too many for one PDF on this device (up to 5)');
      const exportButton = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Export PDF')!;
      expect(exportButton.disabled).toBe(true);
      const parts = [...host.querySelectorAll('.export-too-big button')];
      expect(parts).toHaveLength(5);
      await act(async () => (parts[0] as HTMLButtonElement).click());
      expect(host.textContent).not.toContain('too many');
    } finally {
      PDF_LIMITS.desktop.pages = original;
    }
  });
});
