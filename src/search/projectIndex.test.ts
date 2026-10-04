import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { addShape, deleteShape } from '../media/markup';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { parseWords, ProjectIndex, SNIPPETS_PER_PAGE, titlesOnly, type IndexTree } from './projectIndex';

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
  it('busca en títulos y contenido: cada palabra en algún lado, sin tildes, con partes de palabras, la ñ como otra letra', async () => {
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
    // La ñ es otra letra (D12): "ano" no encuentra "año"; "año", sí.
    expect(titles(index, d, 'ano')).toEqual([]);
    expect(titles(index, d, 'ANO')).toEqual([]);
    expect(titles(index, d, 'año')).toEqual(['Sonido']);
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
    expect(hit.snippets.map((s) => [s.blockId, s.field, s.field === 'annotation' ? undefined : s.occurrence])).toEqual([
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

  it('cede el hilo entre páginas y avisa lo que va leyendo (a lo sumo cada publishMs)', async () => {
    const d = await device();
    for (let i = 0; i < 6; i++) await page(d, `P${i}`, [{ text: `texto ${i}` }]);
    const index = new ProjectIndex(d.tree, d.docs, { yieldMs: 0, publishMs: 0 });
    const building: boolean[] = [];
    index.subscribe(() => building.push(index.info(d.tree.workspaceId).building));
    await index.refresh(d.tree.workspaceId);
    expect(index.info(d.tree.workspaceId).building).toBe(false);
    expect(building[0]).toBe(true);
    expect(building.length).toBeGreaterThan(3);
    expect(titles(index, d, 'texto')).toHaveLength(6);
    // Con la espera de siempre (250 ms), una lectura corta avisa al empezar y al terminar.
    const other = new ProjectIndex(d.tree, d.docs);
    let count = 0;
    other.subscribe(() => count++);
    await other.refresh(d.tree.workspaceId);
    expect(count).toBe(2);
  });

  it('sin cambios, una lectura no prende "leyendo" (no parpadea "Buscando…"); con un cambio, sí', async () => {
    const d = await device();
    const id = await page(d, 'Uno', [{ text: 'hola' }]);
    await page(d, 'Dos', [{ text: 'chau' }]);
    const index = new ProjectIndex(d.tree, d.docs);
    await index.refresh(d.tree.workspaceId);
    const building: boolean[] = [];
    index.subscribe(() => building.push(index.info(d.tree.workspaceId).building));
    await index.refresh(d.tree.workspaceId);
    await index.refresh(d.tree.workspaceId);
    expect(building).not.toContain(true);
    await edit(d, id, [{ text: 'nuevo' }]);
    await index.refresh(d.tree.workspaceId);
    expect(building).toContain(true);
  });

  it('cerrar el panel corta la lectura; la próxima sigue donde quedó', async () => {
    const d = await device();
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) ids.push(await page(d, `P${i}`, [{ text: `texto ${i}` }]));
    const index = new ProjectIndex(d.tree, d.docs, { yieldMs: 0 });
    const done = index.refresh(d.tree.workspaceId);
    await new Promise((r) => setTimeout(r, 5));
    index.cancel();
    await done;
    const read = ids.filter((id) => index.has(id)).length;
    expect(read).toBeLessThan(20);
    await index.refresh(d.tree.workspaceId);
    expect(ids.every((id) => index.has(id))).toBe(true);
  });

  it('una letra sola busca solo en los títulos', async () => {
    const d = await device();
    await page(d, 'Brief', [{ text: 'zeta' }]);
    await page(d, 'Otra', [{ text: 'z en el texto' }]);
    const index = new ProjectIndex(d.tree, d.docs);
    await index.refresh(d.tree.workspaceId);
    expect(titles(index, d, 'z')).toEqual([]);
    expect(titles(index, d, 'b')).toEqual(['Brief']);
    expect(index.query(d.tree.workspaceId, 'b').hits[0].snippets).toEqual([]);
    // Con dos letras, también el texto.
    expect(titles(index, d, 'ze')).toEqual(['Brief']);
    // En chino o japonés un carácter es una palabra: se busca también en el texto.
    expect(titlesOnly(parseWords('猫'))).toBe(false);
    expect(titlesOnly(parseWords('の'))).toBe(false);
    expect(titlesOnly(parseWords('a'))).toBe(true);
    await page(d, 'Gatos', [{ text: '黒い猫' }]);
    await index.refresh(d.tree.workspaceId);
    expect(titles(index, d, '猫')).toEqual(['Gatos']);
  });

  it('esperar a que se guarden las ediciones tiene un tope por pasada, y no se espera si guardar falla', async () => {
    const d = await device();
    for (let i = 0; i < 10; i++) await page(d, `P${i}`, [{ text: `texto ${i}` }]);
    vi.spyOn(d.docs, 'hasUnsavedEdits').mockReturnValue(true);
    let start = Date.now();
    await new ProjectIndex(d.tree, d.docs, { writeWaitMs: 200 }).refresh(d.tree.workspaceId);
    // Antes: hasta 1 s por página (10 s acá).
    expect(Date.now() - start).toBeLessThan(2000);
    vi.spyOn(d.docs, 'getWriteError').mockReturnValue('QuotaExceededError');
    start = Date.now();
    const index = new ProjectIndex(d.tree, d.docs);
    await index.refresh(d.tree.workspaceId);
    expect(Date.now() - start).toBeLessThan(1500);
    expect(titles(index, d, 'texto')).toHaveLength(10);
  });

  it('un error de escritura después de parar la sincronización no deja un error sin atrapar', async () => {
    const d = await device();
    d.engine.stop();
    d.db.close();
    d.docs.onWriteError?.('se cerró la base');
    await new Promise((r) => setTimeout(r, 30));
    expect(d.engine.getStatus().localError).toBe('se cerró la base');
  });

  it('dispose deja de escuchar y de leer; un escucha que falla no deja sin aviso a los demás ni frena la versión', async () => {
    const d = await device();
    const id = await page(d, 'Uno', [{ text: 'hola' }]);
    const index = new ProjectIndex(d.tree, d.docs);
    await index.refresh(d.tree.workspaceId);
    index.dispose();
    expect(index.has(id)).toBe(false);
    await index.refresh(d.tree.workspaceId);
    expect(index.has(id)).toBe(false);
    const seen: string[] = [];
    d.docs.subscribeLocalChange(() => {
      throw new Error('falla');
    });
    d.docs.subscribeLocalChange((p) => seen.push(p));
    const before = (await d.docs.states()).get(id)!.version;
    await edit(d, id, [{ text: 'otra' }]);
    await d.docs.flush();
    expect(seen).toContain(id);
    expect((await d.docs.states()).get(id)!.version).toBeGreaterThan(before);
  });

  it('leer para buscar (fusionando más de 64 updates) mientras se escribe, se sube y se baja no pierde nada: 80 cruces', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const b = await device(server);
    const id = await a.tree.create(null, 'Carrera');
    await a.engine.syncNow();
    await b.engine.syncNow();
    const live = await a.docs.open(id);
    write(live, [{ id: 'bloque', text: '' }]);
    await a.docs.flush();
    await a.engine.syncNow();
    await b.engine.syncNow();
    const textOf = (doc: Y.Doc) => {
      const group = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
      return group
        .toArray()
        .map((c) => (((c as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlText).toString())
        .join('|');
    };
    const insert = (doc: Y.Doc, token: string) => {
      const group = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
      const ytext = ((group.get(0) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlText;
      ytext.insert(ytext.length, ` ${token}`);
    };
    const rows = async () => (await a.db.getAllFromIndex('docUpdates', 'pageId', id)).length;
    const tokens: string[] = [];
    let seed = 7;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const later = (fn: () => Promise<unknown>) => new Promise((r) => setTimeout(r, Math.floor(random() * 3))).then(fn);
    let n = 0;
    let compacted = 0;
    for (let round = 0; round < 80; round++) {
      // Más de 64 updates sueltos: leer para buscar los fusiona.
      while ((await rows()) <= 64) {
        const token = `a${n++}`;
        tokens.push(token);
        insert(live, token);
        await a.docs.flush();
      }
      const typing = async () => {
        for (let i = 0; i < 3; i++) {
          const token = `t${n++}`;
          tokens.push(token);
          insert(live, token);
          await new Promise((r) => setTimeout(r, Math.floor(random() * 2)));
        }
      };
      const other = async () => {
        const doc = await b.docs.open(id);
        const token = `b${n++}`;
        tokens.push(token);
        insert(doc, token);
        b.docs.close(id);
        await b.docs.flush();
        await b.engine.syncNow();
      };
      const snapshot = async () => {
        const before = await rows();
        const snap = await a.docs.indexSnapshot(id);
        snap.doc.destroy();
        if (before > 64) compacted++;
      };
      const ops = [snapshot, typing, () => a.engine.syncNow(), other];
      await Promise.all(ops.map((op) => later(op)));
    }
    expect(compacted).toBeGreaterThan(40);
    await a.docs.flush();
    for (let i = 0; i < 3; i++) {
      await a.engine.syncNow();
      await b.engine.syncNow();
    }
    const text = textOf(live);
    for (const token of tokens) expect(text).toContain(` ${token}`);
    // Lo guardado es lo que se ve, todo subió, y otro dispositivo (y uno nuevo) ve lo mismo.
    const stored = await a.docs.indexSnapshot(id);
    expect(textOf(stored.doc)).toBe(text);
    stored.doc.destroy();
    expect(await a.docs.unsyncedPages()).toEqual([]);
    const bDoc = await b.docs.open(id);
    expect(textOf(bDoc)).toBe(text);
    b.docs.close(id);
    const c = await device(server);
    await c.engine.syncNow();
    const cDoc = await c.docs.open(id);
    expect(textOf(cDoc)).toBe(text);
    c.docs.close(id);
    a.docs.close(id);
    // Lo que las ediciones pidieron sincronizar termina antes de cerrar las bases.
    await new Promise((r) => setTimeout(r, 50));
    for (const d of [a, b, c]) await d.engine.syncNow();
  }, 120_000);

  it('1000 páginas: el índice se arma rápido y la primera búsqueda amplia no traba', async () => {
    const d = await device();
    // Sin sincronizar mil páginas en el medio (cada página nueva la pide).
    d.engine.stop();
    const words = ['cámara', 'lente', 'luz', 'grúa', 'plano', 'toma', 'escena', 'actor', 'set', 'rodaje'];
    for (let i = 0; i < 1000; i++) {
      const id = await d.tree.create(null, `Escena ${i}`);
      const doc = await d.docs.open(id);
      write(
        doc,
        Array.from({ length: 10 }, (_, k) => ({ text: `${words[(i + k) % 10]} de la ${words[(i * k) % 10]}, renglón ${k} de la página ${i}` })),
      );
      d.docs.close(id);
    }
    await d.docs.flush();
    const index = new ProjectIndex(d.tree, d.docs);
    const time = (fn: () => unknown) => {
      const start = performance.now();
      fn();
      return performance.now() - start;
    };
    let start = performance.now();
    await index.refresh(d.tree.workspaceId);
    const build = performance.now() - start;
    let results = index.query(d.tree.workspaceId, '');
    // La primera búsqueda amplia (sin nada calculado de antes: ni los títulos normalizados).
    const broad = time(() => (results = index.query(d.tree.workspaceId, 'de la')));
    const broadAgain = time(() => index.query(d.tree.workspaceId, 'de la'));
    const letter = time(() => index.query(d.tree.workspaceId, 'a'));
    const narrow = time(() => index.query(d.tree.workspaceId, 'camara grua'));
    start = performance.now();
    await index.refresh(d.tree.workspaceId);
    const noChange = performance.now() - start;
    console.log(
      `1000 páginas: índice ${build.toFixed(0)} ms; "de la" ${broad.toFixed(0)} ms (otra vez ${broadAgain.toFixed(0)}), "a" ${letter.toFixed(1)} ms, "camara grua" ${narrow.toFixed(0)} ms; releer sin cambios ${noChange.toFixed(0)} ms`,
    );
    expect(results.total).toBe(1000);
    expect(results.hits).toHaveLength(50);
    // Medido en esta máquina, sola: índice ~1,1 s, "de la" ~20 ms, "a" ~2 ms, "camara grua" ~8 ms, releer ~6 ms
    // (antes de la auditoría, la primera búsqueda amplia tardaba ~650 ms). Con SHOTDOCS_STRICT_PERF=1, estos
    // topes; si no, cinco veces más, para que la máquina cargada por otras pruebas no la haga fallar por el reloj.
    const slack = process.env.SHOTDOCS_STRICT_PERF === '1' ? 1 : 5;
    expect(build).toBeLessThan(5000 * slack);
    expect(broad).toBeLessThan(150 * slack);
    expect(broadAgain).toBeLessThan(150 * slack);
    expect(letter).toBeLessThan(30 * slack);
    expect(narrow).toBeLessThan(100 * slack);
    expect(noChange).toBeLessThan(500 * slack);
  }, 120_000);
});

describe('anotaciones en el índice del proyecto', () => {
  it('lee el snapshot offline, refresca el texto vivo y conserva frase/ordinales y filtro de acceso', async () => {
    const d = await device();
    const id = await page(d, 'Foto', [{ id: 'ordinary', text: 'cámara normal' }]);
    const doc = await d.docs.open(id);
    const file = '12345678-1234-1234-1234-123456789001';
    const image = new Y.XmlElement('image');
    image.setAttribute('url', `sdmedia://${file}`);
    const b = new Y.XmlElement('blockContainer'); b.setAttribute('id', 'photo'); b.insert(0, [image]);
    (doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).insert(1, [b]);
    addShape(doc, file, 's', { type: 'text', text: 'cámara anotada', posX: 10, posY: 10 }, { w: 640, h: 480 });
    d.docs.close(id); await d.docs.flush();
    const index = new ProjectIndex(d.tree, d.docs);
    await index.refresh(d.tree.workspaceId);
    const [hit] = index.query(d.tree.workspaceId, 'anotada').hits;
    expect(hit.snippets[0]).toMatchObject({ field: 'annotation', fileId: file, shapeId: 's', blockId: 'photo' });
    expect('occurrence' in hit.snippets[0]).toBe(false);
    expect(index.phrase(d.tree.workspaceId, 'anotada')).toEqual([]);
    expect(index.phrase(d.tree.workspaceId, 'cámara')[0].matches.map((m) => m.occurrence)).toEqual([0]);
    expect(index.query('otro-proyecto', 'anotada').hits).toEqual([]);
    const live = await d.docs.open(id);
    deleteShape(live, file, 's');
    await index.refresh(d.tree.workspaceId);
    expect(index.query(d.tree.workspaceId, 'anotada').hits).toEqual([]);
    addShape(live, file, 's2', { type: 'text', text: 'luz nueva' }, { w: 640, h: 480 });
    await index.refresh(d.tree.workspaceId);
    expect(index.query(d.tree.workspaceId, 'nueva').hits).toHaveLength(1);
    await d.engine.syncNow();
    await d.tree.setSnapshot([]);
    expect(index.query(d.tree.workspaceId, 'nueva').hits).toEqual([]);
    index.dispose();
  });
});
