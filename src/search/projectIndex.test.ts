import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { parseWords, ProjectIndex, SNIPPETS_PER_PAGE, type IndexTree } from './projectIndex';

// La búsqueda en todo el proyecto (Docs/Doc_Buscar.md, secciones 7 y 8, y "Cómo quedó (entrega 2)"): el índice
// en memoria, con la base local de verdad (fake-indexeddb) y el árbol de verdad.

const devices: Device[] = [];
afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.docs.dispose();
    d.db.close();
  }
});

async function device(server = new FakeServer()): Promise<Device> {
  const d = await makeDevice(server);
  devices.push(d);
  return d;
}

type Block = { text?: string; caption?: string; name?: string; children?: Block[]; id?: string };

function container(block: Block, i: number): Y.XmlElement {
  const el = new Y.XmlElement('blockContainer');
  el.setAttribute('id', block.id ?? `b${i}-${Math.random().toString(36).slice(2, 8)}`);
  if (block.caption !== undefined || block.name !== undefined) {
    const image = new Y.XmlElement('image');
    if (block.caption !== undefined) image.setAttribute('caption', block.caption);
    if (block.name !== undefined) image.setAttribute('name', block.name);
    el.insert(0, [image]);
  } else {
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [new Y.XmlText(block.text ?? '')]);
    el.insert(0, [paragraph]);
  }
  if (block.children) {
    const group = new Y.XmlElement('blockGroup');
    group.insert(0, block.children.map(container));
    el.insert(el.length, [group]);
  }
  return el;
}

/** Escribe los bloques al final de la página (como el editor). */
function write(doc: Y.Doc, blocks: Block[]): void {
  const fragment = doc.getXmlFragment(CONTENT_FRAGMENT);
  doc.transact(() => {
    if (fragment.length === 0) fragment.insert(0, [new Y.XmlElement('blockGroup')]);
    const group = fragment.get(0) as Y.XmlElement;
    group.insert(group.length, blocks.map(container));
  });
}

/** Abre la página, escribe y la cierra (queda guardado en el dispositivo). */
async function edit(d: Device, pageId: string, blocks: Block[]): Promise<void> {
  const doc = await d.docs.open(pageId);
  write(doc, blocks);
  d.docs.close(pageId);
  await d.docs.flush();
}

async function page(d: Device, title: string, blocks: Block[] = [], parent: string | null = null): Promise<string> {
  const id = await d.tree.create(parent, title);
  if (blocks.length) await edit(d, id, blocks);
  return id;
}

const titles = (index: ProjectIndex, d: Device, q: string) => index.query(d.tree.workspaceId, q).hits.map((h) => h.page.title);

describe('las palabras', () => {
  it('sin tildes ni mayúsculas, sin repetir, sin las vacías', () => {
    expect(parseWords('  Cámara   LUZ cámara ')).toEqual([
      { raw: 'Cámara', norm: 'camara' },
      { raw: 'LUZ', norm: 'luz' },
    ]);
    expect(parseWords('   ')).toEqual([]);
  });
});

describe('el índice del proyecto', () => {
  it('busca en títulos y contenido: cada palabra en algún lado, sin tildes, con partes de palabras, la ñ como n', async () => {
    const d = await device();
    await page(d, 'Cámara A', [{ text: 'Lente de 35 mm y luz de relleno' }]);
    await page(d, 'Sonido', [{ text: 'El año pasado, la CÁMARA estaba rota' }]);
    await page(d, 'Vestuario', [{ text: 'Nada que ver' }]);
    const index = new ProjectIndex(d.tree, d.docs);
    await index.refresh(d.tree.workspaceId);
    // Primero la del título.
    expect(titles(index, d, 'camara')).toEqual(['Cámara A', 'Sonido']);
    // Una palabra en el título y otra en el texto.
    expect(titles(index, d, 'camara luz')).toEqual(['Cámara A']);
    // Falta una palabra: no entra.
    expect(titles(index, d, 'camara vestuario')).toEqual([]);
    expect(titles(index, d, 'ano')).toEqual(['Sonido']);
    expect(titles(index, d, 'relle')).toEqual(['Cámara A']);
    expect(titles(index, d, '')).toEqual([]);
  });

  it('agrupa por página, con el camino y hasta 3 fragmentos resaltados; el resto se cuenta', async () => {
    const d = await device();
    const parent = await page(d, 'Brief');
    const mid = await page(d, 'Uruguay', [], parent);
    const long = 'palabra '.repeat(20) + 'la cámara grande ' + 'relleno '.repeat(30);
    await page(d, 'Escena 12', [{ text: 'cámara uno' }, { text: long }, { text: 'otra cámara' }, { text: 'sin nada' }, { text: 'cámara cuatro' }, { text: 'Cámara cinco' }], mid);
    const index = new ProjectIndex(d.tree, d.docs);
    await index.refresh(d.tree.workspaceId);
    const [hit] = index.query(d.tree.workspaceId, 'camara').hits;
    expect(hit.path.map((p) => p.title)).toEqual(['Brief', 'Uruguay']);
    expect(hit.titleRanges).toEqual([]);
    expect(hit.snippets).toHaveLength(SNIPPETS_PER_PAGE);
    expect(hit.more).toBe(2);
    const [first, second] = hit.snippets;
    expect(first.text).toBe('cámara uno');
    expect(first.ranges).toEqual([[0, 6]]);
    expect(first.term).toBe('camara');
    // Un bloque largo: cortado alrededor de lo encontrado, con "…" y sin partir palabras.
    expect(second.cutStart).toBe(true);
    expect(second.cutEnd).toBe(true);
    expect(second.text.startsWith('palabra')).toBe(true);
    const [s, e] = second.ranges[0];
    expect(second.text.slice(s, e)).toBe('cámara');
  });

  it('los hijos anidados son bloques propios; pies y nombres se encuentran y se cuentan por bloque', async () => {
    const d = await device();
    await page(d, 'Fotos', [
      { id: 'padre', text: 'arriba', children: [{ id: 'hijo', text: 'la cámara del hijo' }] },
      { id: 'foto', caption: 'Cámara en el set', name: 'camara-b.jpg' },
    ]);
    const index = new ProjectIndex(d.tree, d.docs);
    await index.refresh(d.tree.workspaceId);
    const [hit] = index.query(d.tree.workspaceId, 'camara').hits;
    expect(hit.snippets.map((s) => [s.blockId, s.field, s.occurrence])).toEqual([
      ['hijo', 'text', 0],
      ['foto', 'caption', 0],
      // La segunda del bloque de la foto (la primera está en el pie): la barra de la página cuenta igual.
      ['foto', 'name', 1],
    ]);
    // "arriba" es del padre, no del hijo.
    expect(index.query(d.tree.workspaceId, 'arriba camara').hits).toHaveLength(1);
    expect(index.query(d.tree.workspaceId, 'arriba').hits[0].snippets.map((s) => s.blockId)).toEqual(['padre']);
  });

  it('la papelera no entra, tampoco lo que está adentro de una página en la papelera (al buscar, sin volver a leer)', async () => {
    const d = await device();
    const parent = await page(d, 'Madre', [{ text: 'cámara madre' }]);
    await page(d, 'Hija', [{ text: 'cámara hija' }], parent);
    await page(d, 'Otra', [{ text: 'cámara otra' }]);
    const index = new ProjectIndex(d.tree, d.docs);
    await index.refresh(d.tree.workspaceId);
    expect(titles(index, d, 'camara')).toEqual(['Madre', 'Hija', 'Otra']);
    await d.tree.trash(parent);
    expect(titles(index, d, 'camara')).toEqual(['Otra']);
    expect(index.info(d.tree.workspaceId).pages).toBe(1);
  });

  it('una página que sale del árbol (le sacaron el permiso) no da resultados aunque siga guardada y leída', async () => {
    const server = new FakeServer();
    const d = await device(server);
    const secret = await page(d, 'Secreta', [{ text: 'cámara secreta' }]);
    await page(d, 'Pública', [{ text: 'cámara pública' }]);
    await d.engine.syncNow();
    const index = new ProjectIndex(d.tree, d.docs);
    await index.refresh(d.tree.workspaceId);
    expect(titles(index, d, 'camara')).toEqual(['Secreta', 'Pública']);
    // El árbol deja de traerla (como con la política del servidor); lo guardado de la página sigue.
    const rows = [...server.pages.values()].filter((r) => r.id !== secret);
    await d.tree.setSnapshot(rows);
    expect((await d.docs.states()).has(secret)).toBe(true);
    expect(titles(index, d, 'camara')).toEqual(['Pública']);
    expect(titles(index, d, 'secreta')).toEqual([]);
    // Un árbol que la esconde al buscar (sin volver a leer nada) también.
    const hidden: IndexTree = {
      get: (id) => (id === secret ? undefined : d.tree.get(id)),
      isTrashed: (id) => d.tree.isTrashed(id),
      roots: (p) => d.tree.roots(p),
      children: (id) => d.tree.children(id),
      ancestors: (id) => d.tree.ancestors(id),
      hasUnsentCreate: (id) => d.tree.hasUnsentCreate(id),
    };
    await d.tree.setSnapshot([...server.pages.values()]);
    const other = new ProjectIndex(hidden, d.docs);
    await other.refresh(d.tree.workspaceId);
    expect(other.query(d.tree.workspaceId, 'secreta').hits).toEqual([]);
    expect(other.has(secret)).toBe(false);
  });

  it('solo busca en el proyecto abierto', async () => {
    const d = await device();
    await page(d, 'Acá', [{ text: 'cámara' }]);
    const project = await d.tree.createProject('Otro');
    const there = await d.tree.create(null, 'Allá', project);
    await edit(d, there, [{ text: 'cámara' }]);
    const index = new ProjectIndex(d.tree, d.docs);
    await index.refresh(d.tree.workspaceId);
    expect(titles(index, d, 'camara')).toEqual(['Acá']);
    await index.refresh(project);
    expect(index.query(project, 'camara').hits.map((h) => h.page.title)).toEqual(['Allá']);
  });

  it('solo vuelve a leer lo que cambió: una edición local, algo bajado de otro dispositivo', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const b = await device(server);
    const one = await page(a, 'Uno', [{ text: 'primero' }]);
    await page(a, 'Dos', [{ text: 'segundo' }]);
    await a.engine.syncNow();
    await b.engine.syncNow();
    const index = new ProjectIndex(a.tree, a.docs);
    const reads = vi.spyOn(a.docs, 'indexSnapshot');
    await index.refresh(a.tree.workspaceId);
    expect(reads).toHaveBeenCalledTimes(2);
    reads.mockClear();
    await index.refresh(a.tree.workspaceId);
    expect(reads).not.toHaveBeenCalled();
    // Una edición en este dispositivo.
    await edit(a, one, [{ text: 'tercero' }]);
    await index.refresh(a.tree.workspaceId);
    expect(reads.mock.calls.map((c) => c[0])).toEqual([one]);
    expect(titles(index, a, 'tercero')).toEqual(['Uno']);
    reads.mockClear();
    // Algo que llega de otro dispositivo (avanza el cursor).
    await edit(b, one, [{ text: 'cuarto' }]);
    await b.engine.syncNow();
    await a.engine.syncNow();
    await index.refresh(a.tree.workspaceId);
    expect(reads.mock.calls.map((c) => c[0])).toEqual([one]);
    expect(titles(index, a, 'cuarto')).toEqual(['Uno']);
  });

  it('una edición guardada marca la página aunque la marca de la base no cambie; la sincronización también se entera', async () => {
    const d = await device();
    const id = await page(d, 'Uno', [{ text: 'antes' }]);
    const index = new ProjectIndex(d.tree, d.docs);
    await index.refresh(d.tree.workspaceId);
    const seen: string[] = [];
    const stop = d.docs.subscribeLocalChange((p) => seen.push(p));
    const poke = vi.spyOn(d.engine, 'poke');
    // La base no dice que cambió (como si la suma de la versión fallara): igual se vuelve a leer por el aviso.
    const frozen = new Map(await d.docs.states());
    vi.spyOn(d.docs, 'states').mockImplementation(async () => new Map(frozen));
    await edit(d, id, [{ text: 'después' }]);
    expect(seen).toEqual([id]);
    expect(poke).toHaveBeenCalled();
    await index.refresh(d.tree.workspaceId);
    expect(titles(index, d, 'despues')).toEqual(['Uno']);
    stop();
  });

  it('la página abierta se lee de su documento vivo, con lo recién escrito y sin leer la base', async () => {
    const d = await device();
    const id = await page(d, 'Abierta', [{ text: 'hola' }]);
    const doc = await d.docs.open(id);
    const index = new ProjectIndex(d.tree, d.docs);
    const reads = vi.spyOn(d.docs, 'indexSnapshot');
    await index.refresh(d.tree.workspaceId);
    expect(reads).not.toHaveBeenCalled();
    write(doc, [{ text: 'recién escrito' }]);
    // Sin esperar a que se guarde.
    await index.refresh(d.tree.workspaceId);
    expect(titles(index, d, 'recien')).toEqual(['Abierta']);
    // Un borrado también (no mueve el vector de estado).
    const group = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
    group.delete(group.length - 1, 1);
    await index.refresh(d.tree.workspaceId);
    expect(titles(index, d, 'recien')).toEqual([]);
    expect(reads).not.toHaveBeenCalled();
    d.docs.close(id);
    await d.docs.flush();
    await index.refresh(d.tree.workspaceId);
    expect(reads).toHaveBeenCalledTimes(1);
    expect(titles(index, d, 'hola')).toEqual(['Abierta']);
  });

  it('una página con muchos updates sueltos se fusiona al leerla (con el candado)', async () => {
    const d = await device();
    const id = await d.tree.create(null, 'Muchos');
    for (let i = 0; i < 70; i++) {
      const doc = await d.docs.open(id);
      write(doc, [{ text: `renglón ${i}` }]);
      d.docs.close(id);
      await d.docs.flush();
    }
    const rows = async () => (await d.db.getAllFromIndex('docUpdates', 'pageId', id)).length;
    expect(await rows()).toBeGreaterThan(64);
    const index = new ProjectIndex(d.tree, d.docs);
    await index.refresh(d.tree.workspaceId);
    expect(await rows()).toBe(1);
    expect(index.query(d.tree.workspaceId, 'renglon 69').hits[0].snippets[0].text).toBe('renglón 69');
  });

  it('avisa las páginas que faltan bajar y las que no se pudieron leer enteras', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const b = await device(server);
    const id = await page(a, 'Compartida', [{ text: 'uno' }]);
    await a.engine.syncNow();
    await b.engine.syncNow();
    await edit(b, id, [{ text: 'dos' }]);
    await b.engine.syncNow();
    // A baja el árbol (el servidor tiene más) pero todavía no el contenido.
    const projects = await a.remote.fetchProjects();
    await a.tree.setSnapshot(await a.remote.fetchTree(projects.map((p) => p.id)), projects);
    const index = new ProjectIndex(a.tree, a.docs);
    await index.refresh(a.tree.workspaceId);
    expect(index.info(a.tree.workspaceId)).toMatchObject({ pages: 1, missing: 1, unreadable: 0, building: false });
    await a.engine.syncNow();
    await a.docs.markUnreadable(id);
    await index.refresh(a.tree.workspaceId);
    expect(index.info(a.tree.workspaceId)).toMatchObject({ missing: 0, unreadable: 1 });
    expect(titles(index, a, 'dos')).toEqual(['Compartida']);
  });

  it('cede el hilo entre páginas y avisa lo que va leyendo', async () => {
    const d = await device();
    for (let i = 0; i < 6; i++) await page(d, `P${i}`, [{ text: `texto ${i}` }]);
    const index = new ProjectIndex(d.tree, d.docs, { yieldMs: 0 });
    const revisions: number[] = [];
    index.subscribe(() => revisions.push(index.getRevision()));
    const done = index.refresh(d.tree.workspaceId);
    expect(index.info(d.tree.workspaceId).building).toBe(true);
    await done;
    expect(index.info(d.tree.workspaceId).building).toBe(false);
    expect(revisions.length).toBeGreaterThan(3);
    expect(titles(index, d, 'texto')).toHaveLength(6);
  });

  it('300 páginas se leen en poco tiempo, y buscar después es inmediato', async () => {
    const d = await device();
    const words = ['cámara', 'lente', 'luz', 'grúa', 'plano', 'toma', 'escena', 'actor', 'set', 'rodaje'];
    for (let i = 0; i < 300; i++) {
      const id = await d.tree.create(null, `Escena ${i}`);
      const doc = await d.docs.open(id);
      write(
        doc,
        Array.from({ length: 20 }, (_, k) => ({ text: `${words[(i + k) % 10]} ${words[(i * k) % 10]} renglón ${k} de la página ${i}` })),
      );
      d.docs.close(id);
    }
    await d.docs.flush();
    const index = new ProjectIndex(d.tree, d.docs);
    let start = performance.now();
    await index.refresh(d.tree.workspaceId);
    const build = performance.now() - start;
    start = performance.now();
    const results = index.query(d.tree.workspaceId, 'camara grua');
    const query = performance.now() - start;
    console.log(`índice: 300 páginas en ${build.toFixed(0)} ms; buscar, ${query.toFixed(1)} ms`);
    expect(results.total).toBeGreaterThan(0);
    expect(build).toBeLessThan(15_000);
    expect(query).toBeLessThan(200);
  }, 60_000);
});
