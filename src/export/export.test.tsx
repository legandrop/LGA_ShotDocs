// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { mountEditor, unmountAll } from '../ui/collabHarness';
import { SHARED_COLLAPSE_MAP } from '../ui/collapseEditor';
import { schema as previousPublished } from '../ui/fixtures/editorSchemaAnterior';
import { ExportCancelled, ExportEditor } from './exportEditor';
import { exportPlan, renderPages, type ExportProgress } from './exportPages';
import { readPageContent, readPageContentFromUpdate } from './pageContent';
import { testProject, writeBlocks, writeTestProject, type TestPageSpec } from './testProject';

// Exportar, entrega 0 (Docs/Doc_Exportar.md): el editor de exportación con el esquema real sobre un proyecto de
// prueba. Acá, sin el navegador: qué páginas salen y en qué orden, que nada de lo exportado toca un documento ni la
// base local (byte por byte), que sale lo que se ve (y no lo borrado), cancelar y el avance. Los tiempos y las hojas
// contra las marcas de la pantalla se miden en Chromium (src/export/bench/, sección "Cómo quedó la entrega 0").

beforeAll(() => {
  // jsdom no trae estas dos; Mantine las pide.
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
  for (const e of editors.splice(0)) e.destroy();
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  document.body.replaceChildren();
});

const photo = (n: number) => ({ url: `https://photos.test/p${n}.jpg`, name: `IMG_${String(n).padStart(4, '0')}.jpg` });

async function project(pages = 14) {
  const device = await makeDevice(new FakeServer());
  devices.push(device);
  const specs = testProject({ pages, photosPerPage: 4, seed: 7 }, photo);
  const { projectId, ids } = await writeTestProject(device, 'Prueba', specs);
  return { device, specs, projectId, ids };
}

// jsdom no carga imágenes: no se las espera (en el navegador, sí; ver bench/).
async function editor() {
  const e = await ExportEditor.create({ imageTimeoutMs: 0, copyTimeoutMs: 0 });
  editors.push(e);
  return e;
}

/** Todo lo guardado de una página (sus filas y su estado), para comparar byte por byte. */
async function stored(device: Device, pageId: string): Promise<string> {
  const rows = await device.db.getAllFromIndex('docUpdates', 'pageId', pageId);
  const state = await device.db.get('docState', pageId);
  const snap = await device.docs.snapshot(pageId);
  const full = Y.encodeStateAsUpdate(snap.doc);
  snap.doc.destroy();
  return JSON.stringify({ rows: rows.map((r) => Array.from(r.data)), state, full: Array.from(full) });
}

describe('exportar: las páginas', () => {
  it('el plan sigue el árbol, hereda la hoja y no nombra nada de arriba de la rama', async () => {
    const { device, specs, projectId, ids } = await project(14);
    const plan = exportPlan(device.tree, 'project', projectId);
    expect(plan.map((p) => p.id)).toEqual(specs.map((s) => ids.get(s.key)));
    expect(plan.filter((p) => p.depth === 0)).toHaveLength(5);
    // Las hojas de las ramas: A4, A5 horizontal, Carta, A3 horizontal, A4.
    expect(plan.find((p) => p.id === ids.get('2.1'))?.format).toEqual({ size: 'A5', landscape: true });
    expect(plan.find((p) => p.id === ids.get('4.1'))?.format).toEqual({ size: 'A3', landscape: true });
    // La última rama es libre (como la mayoría de un proyecto real): sale en A4, como el PDF de siempre.
    expect(plan.find((p) => p.id === ids.get('5'))?.format).toEqual({ size: 'free', landscape: false });

    // Una rama: sus páginas y nada más; el encabezado empieza en la raíz exportada.
    const nested = specs.find((s) => s.key.split('.').length === 3)!;
    const branchRoot = ids.get(nested.parent!)!;
    const branch = exportPlan(device.tree, 'page', branchRoot);
    expect(branch[0]).toMatchObject({ id: branchRoot, depth: 0, header: [] });
    const child = branch.find((p) => p.id === ids.get(nested.key))!;
    expect(child.depth).toBe(1);
    expect(child.header).toEqual([device.tree.get(branchRoot)!.title]);
    // En el proyecto entero, la misma página lleva también su raíz.
    expect(plan.find((p) => p.id === ids.get(nested.key))!.header.length).toBe(2);

    // Lo que está en la papelera no sale (ni sus hijas).
    await device.tree.trash(branchRoot);
    const after = exportPlan(device.tree, 'project', projectId).map((p) => p.id);
    expect(after).not.toContain(branchRoot);
    expect(after).not.toContain(ids.get(nested.key));
    expect(exportPlan(device.tree, 'page', branchRoot)).toEqual([]);
  });

  it('dibuja cada página con el esquema real y no cambia nada guardado, byte por byte', async () => {
    const { device, specs, projectId, ids } = await project(14);
    // Acá el único que puede escribir es el exportador. El motor sube solo lo pendiente un rato después de la última
    // escritura, y con eso vacía la cola del árbol y anota en cada página lo que ya subió: si le tocaba en medio de la
    // prueba (alcanza con que la máquina esté cargada), lo guardado cambiaba sin que el exportador hubiera hecho nada.
    await device.engine.stop();
    const plan = exportPlan(device.tree, 'project', projectId);
    const before = new Map<string, string>();
    for (const p of plan) before.set(p.id, await stored(device, p.id));
    const ops = device.tree.pendingOps().length;
    // Una página abierta en el editor mientras tanto: su documento no recibe nada.
    const open = ids.get(specs.find((s) => s.blocks.length > 0 && s.parent)!.key)!;
    const live = await device.docs.open(open);
    const liveBefore = Y.encodeStateAsUpdate(live);
    let liveUpdates = 0;
    live.on('update', () => liveUpdates++);

    const e = await editor();
    const seen: { title: string; html: string; photos: number; script: number; questions: number; breaks: number; tables: number; cards: number }[] = [];
    const progress: ExportProgress[] = [];
    const out = await renderPages(plan, device.docs, e, {
      onProgress: (p) => progress.push(p),
      onPage: (page) => {
        const root = page.view.root;
        seen.push({
          title: root.querySelector('.page-title')?.textContent ?? '',
          html: root.innerHTML,
          photos: root.querySelectorAll('.sd-photo img.bn-visual-media, [data-content-type="image"] img.bn-visual-media').length,
          script: root.querySelectorAll('.script-line').length,
          questions: root.querySelectorAll('.question-line').length,
          breaks: root.querySelectorAll('.print-page-break-empty').length,
          tables: root.querySelectorAll('table').length,
          cards: root.querySelectorAll('.drive-card').length,
        });
        page.view.root.remove();
      },
    });

    expect(out).toHaveLength(plan.length);
    expect(progress[0]).toEqual({ done: 0, total: plan.length, title: plan[0].title });
    expect(progress.at(-1)).toEqual({ done: plan.length, total: plan.length, title: '' });
    // Lo que tiene cada página, en la copia de la vista de impresión.
    specs.forEach((s, i) => {
      const got = seen[i];
      expect(got.title).toBe(s.title);
      expect(got.photos).toBe(s.photos);
      const flat = JSON.stringify(s.blocks);
      expect(got.script).toBe((flat.match(/"script":true/g) ?? []).length);
      expect(got.questions).toBe((flat.match(/"question":true/g) ?? []).length);
      expect(got.breaks).toBe((flat.match(/"pageBreak":true/g) ?? []).length);
      expect(got.tables).toBe((flat.match(/"tableContent"/g) ?? []).length);
      // La tarjeta de Drive, sin el reproductor (queda el link).
      expect(got.cards).toBe((flat.match(/"driveCard":true/g) ?? []).length);
      expect(got.html).not.toContain('<iframe');
      // Sin tiradores, ni editable, ni ids repetidos.
      expect(got.html).not.toContain('contenteditable');
      expect(got.html).not.toMatch(/\sid="/);
    });
    // Las clases y la estructura de cada tipo están en algún lado.
    for (const what of ['photos', 'script', 'questions', 'breaks', 'tables', 'cards'] as const) expect(seen.some((p) => p[what] > 0)).toBe(true);
    // Ninguna vista queda en el documento.
    expect(document.querySelectorAll('.print-view')).toHaveLength(0);

    // Nada cambió: ni lo guardado de cada página, ni el árbol, ni la página abierta.
    for (const p of plan) expect(await stored(device, p.id)).toBe(before.get(p.id));
    expect(device.tree.pendingOps().length).toBe(ops);
    expect(liveUpdates).toBe(0);
    expect(Y.encodeStateAsUpdate(live)).toEqual(liveBefore);
    device.docs.close(open);
  });

  it('sale lo que se ve: ni el texto escrito y borrado ni la foto sacada', async () => {
    const device = await makeDevice(new FakeServer());
    devices.push(device);
    const projectId = await device.tree.createProject('Secretos');
    const page = await device.tree.create(null, 'Notas', projectId);
    await writeBlocks(device.docs, page, [
      { type: 'paragraph', content: 'Visible' },
      { type: 'paragraph', content: 'SECRETO_INTERNO' },
      { type: 'image', props: { url: 'https://photos.test/sacada.jpg', name: 'FOTO_SACADA.jpg' } },
    ]);
    // Se borra el párrafo y la foto, con el editor de la página (quedan como lápidas en el documento).
    await writeBlocks(device.docs, page, [{ type: 'paragraph', content: 'Visible' }]);
    const rows = await device.db.getAllFromIndex('docUpdates', 'pageId', page);
    const raw = rows.map((r) => new TextDecoder('latin1').decode(r.data)).join('');
    // La premisa (EX5): lo guardado en el dispositivo lleva lo borrado.
    expect(raw).toContain('SECRETO_INTERNO');
    expect(raw).toContain('FOTO_SACADA');

    const e = await editor();
    let html = '';
    let json = '';
    await renderPages(exportPlan(device.tree, 'project', projectId), device.docs, e, {
      onPage: (rendered, content) => {
        html = rendered.view.root.outerHTML;
        json = JSON.stringify(content.blocks);
        rendered.view.root.remove();
      },
    });
    expect(html).toContain('Visible');
    for (const s of ['SECRETO_INTERNO', 'FOTO_SACADA']) {
      expect(html).not.toContain(s);
      expect(json).not.toContain(s);
    }
  });

  it('el colapsado para todos sale aparte, solo con ids de bloques que existen', () => {
    const doc = new Y.Doc();
    const block = new Y.XmlElement('blockContainer');
    block.setAttribute('id', 'h1');
    const heading = new Y.XmlElement('heading');
    heading.insert(0, [new Y.XmlText('Título')]);
    block.insert(0, [heading]);
    const group = new Y.XmlElement('blockGroup');
    group.insert(0, [block]);
    doc.getXmlFragment(CONTENT_FRAGMENT).insert(0, [group]);
    const map = doc.getMap(SHARED_COLLAPSE_MAP);
    map.set('h1', true);
    map.set('borrado', true);
    map.set('h2', false);
    const content = readPageContentFromUpdate(Y.encodeStateAsUpdate(doc));
    expect(content.blocks.map((b) => b.id)).toEqual(['h1']);
    expect(content.collapsedForAll).toEqual(['h1']);
    expect(content.unknown).toBeNull();
  });

  it('lo que esta versión no conoce se avisa, y solo se pierde en la copia', () => {
    const doc = new Y.Doc();
    const block = new Y.XmlElement('blockContainer');
    block.setAttribute('id', 'a');
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText('Queda')]);
    block.insert(0, [p]);
    const future = new Y.XmlElement('blockContainer');
    future.setAttribute('id', 'b');
    future.insert(0, [new Y.XmlElement('bloqueDelFuturo')]);
    const group = new Y.XmlElement('blockGroup');
    group.insert(0, [block, future]);
    doc.getXmlFragment(CONTENT_FRAGMENT).insert(0, [group]);
    const original = Y.encodeStateAsUpdate(doc);
    const copy = new Y.Doc();
    Y.applyUpdate(copy, original);
    const content = readPageContent(copy);
    copy.destroy();
    expect(content.unknown).toBe('"bloqueDelFuturo"');
    expect(JSON.stringify(content.blocks)).toContain('Queda');
    // El documento de verdad no se tocó (se leyó una copia).
    expect(Y.encodeStateAsUpdate(doc)).toEqual(original);
  });

  it('una página escrita por la versión anterior se exporta igual (el esquema de hoy la lee entera)', async () => {
    const doc = new Y.Doc();
    const old = mountEditor(doc, 'vieja', previousPublished);
    old.replaceBlocks(old.document, [
      { type: 'heading', props: { level: 2 }, content: 'Escena 12' },
      { type: 'paragraph', props: { script: true }, content: 'INT. CASA - NOCHE' },
      { type: 'paragraph', props: { question: true }, content: '¿Lente?' },
      { type: 'image', props: { url: 'https://photos.test/vieja.jpg', name: 'vieja.jpg', previewWidth: 300 } },
      { type: 'table', content: { type: 'tableContent', rows: [{ cells: [[{ type: 'text', text: '1A', styles: {} }], [{ type: 'text', text: '35mm', styles: {} }]] }] } },
    ] as never);
    const update = Y.encodeStateAsUpdate(doc);
    unmountAll();
    const content = readPageContentFromUpdate(update);
    expect(content.unknown).toBeNull();
    expect(content.blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'paragraph', 'image', 'table']);
    const e = await editor();
    const page = await e.render({ id: 'p', title: 'Vieja', header: [], format: { size: 'A4', landscape: false }, blocks: content.blocks });
    const root = page.view.root;
    expect(root.querySelector('.script-line')?.textContent).toBe('INT. CASA - NOCHE');
    expect(root.querySelector('.question-line')?.textContent).toBe('¿Lente?');
    expect(root.querySelector('[data-content-type="image"] img')?.getAttribute('src')).toBe('https://photos.test/vieja.jpg');
    expect(root.querySelector('table')?.textContent).toContain('35mm');
    page.view.root.remove();
  });

  it('cancelar corta entre páginas, no deja vistas y el editor sigue sirviendo', async () => {
    const { device, projectId } = await project(10);
    const plan = exportPlan(device.tree, 'project', projectId);
    const e = await editor();
    const controller = new AbortController();
    let pages = 0;
    await expect(
      renderPages(plan, device.docs, e, {
        signal: controller.signal,
        onPage: (rendered) => {
          rendered.view.root.remove();
          if (++pages === 2) controller.abort();
        },
      }),
    ).rejects.toBeInstanceOf(ExportCancelled);
    expect(pages).toBe(2);
    expect(document.querySelectorAll('.print-view')).toHaveLength(0);
    // El mismo editor exporta después, y deja los bloques de la última página puesta.
    const again = await renderPages(plan.slice(0, 3), device.docs, e);
    expect(again).toHaveLength(3);
    expect(e.blocks.length).toBeGreaterThan(0);
  });

  it('el proyecto de prueba tiene de todo y es siempre el mismo', () => {
    const a = testProject({ pages: 300, seed: 22 }, photo);
    const b = testProject({ pages: 300, seed: 22 }, photo);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a).toHaveLength(300);
    const all = JSON.stringify(a.map((s: TestPageSpec) => s.blocks));
    for (const needle of ['"script":true', '"question":true', '"pageBreak":true', '"tableContent"', '"type":"photo"', '"rowWidth"', '"previewWidth"', '"driveCard":true']) {
      expect(all).toContain(needle);
    }
    const photos = a.reduce((n, s) => n + s.photos, 0);
    expect(photos).toBeGreaterThan(1500);
    expect(a.filter((s) => s.blocks.length === 0).length).toBeGreaterThan(20);
  });
});
