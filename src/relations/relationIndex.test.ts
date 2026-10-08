import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { indexKey, localIndexCache, INDEX_PREFIX } from '../search/indexCache';
import { ProjectIndex, PROGRESS_MIN_PAGES, type IndexTree } from '../search/projectIndex';
import { dirtyKey } from '../sync/localDb';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import type { PageSettings } from '../sync/types';
import { RelationsSession, REREAD_MS } from '../ui/relationsUi';
import { entityRelations, indexPages, pendingRelations, RelationIndex } from './relationIndex';


// Las relaciones en vivo con la base local de verdad (fake-indexeddb) y el árbol de verdad (Docs/Doc_Relaciones.md,
// secciones 3 a 6): el índice arranca, se guarda y se recupera sin abrir los documentos, relee la página abierta al
// dejar de escribir y solo cuenta lo que la persona ve.

const devices: Device[] = [];
afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.docs.dispose();
    d.db.close();
  }
});

async function device(): Promise<Device> {
  const d = await makeDevice(new FakeServer());
  devices.push(d);
  return d;
}

type Block = { text?: string; heading?: number; photo?: string; link?: { pageId: string; text: string } };

function container(block: Block, i: number): Y.XmlElement {
  const el = new Y.XmlElement('blockContainer');
  el.setAttribute('id', `b${i}-${Math.random().toString(36).slice(2, 8)}`);
  if (block.photo) {
    const image = new Y.XmlElement('image');
    image.setAttribute('url', `sdmedia://${block.photo}`);
    el.insert(0, [image]);
  } else {
    const content = new Y.XmlElement(block.heading ? 'heading' : 'paragraph');
    if (block.heading) content.setAttribute('level', block.heading as never);
    const text = new Y.XmlText();
    if (block.link) text.insert(0, block.link.text, { link: { href: `/p/${block.link.pageId}` } });
    else text.insert(0, block.text ?? '');
    content.insert(0, [text]);
    el.insert(0, [content]);
  }
  return el;
}

function write(doc: Y.Doc, blocks: Block[]): void {
  const fragment = doc.getXmlFragment(CONTENT_FRAGMENT);
  doc.transact(() => {
    if (fragment.length === 0) fragment.insert(0, [new Y.XmlElement('blockGroup')]);
    const group = fragment.get(0) as Y.XmlElement;
    group.insert(group.length, blocks.map(container));
  });
}

async function edit(d: Device, pageId: string, blocks: Block[]): Promise<void> {
  const doc = await d.docs.open(pageId);
  write(doc, blocks);
  d.docs.close(pageId);
  await d.docs.flush();
}

async function page(d: Device, title: string, blocks: Block[] = [], parent: string | null = null, settings?: PageSettings): Promise<string> {
  const id = await d.tree.create(parent, title);
  if (settings) await d.tree.setPatch(id, { settings });
  if (blocks.length) await edit(d, id, blocks);
  return id;
}

const PHOTO = '0000000a-aaaa-4bbb-8ccc-dddddddddddd';

/** Un proyecto chico: escenas en su carpeta, una locación, un día con secciones, y un archivo fuera del grafo. */
async function project(d: Device) {
  const bd = await page(d, 'Breakdown', [], null, { holds: 'scene' });
  const ep = await page(d, '101', [], bd);
  const s074 = await page(d, '074 | La cocina', [{ text: 'Desglose de la cocina' }], ep);
  await page(d, 'ERSO_101_074_010', [{ text: 'Ficha: nombra 101_075 que no existe' }], s074);
  const s075 = await page(d, '075 | El patio', [], ep);
  const locs = await page(d, 'Locations', [], null, { holds: 'location' });
  const cenade = await page(d, 'CENADE', [], locs);
  const days = await page(d, 'Shoot days', [], null, { holds: 'day' });
  const d59 = await page(
    d,
    'Día 59',
    [
      { heading: 1, text: 'Escena 101_074' },
      { link: { pageId: s075, text: '→ Escena 101_075' } },
      { photo: PHOTO },
      { heading: 1, text: 'Plates' },
      { text: 'En CENADE quedó la Escena 1074 pendiente (la 1074 sola no cuenta); Escena 101_099 mañana' },
    ],
    days,
  );
  const archivo = await page(d, '90 | Archivo', [{ text: 'Escena 101_074 vieja' }], null, { graph: false });
  return { bd, s074, s075, cenade, d59, archivo };
}

describe('el índice del proyecto: caché en el dispositivo', () => {
  it('lo guardado se recupera sin abrir los documentos, y solo se relee lo que cambió', async () => {
    const d = await device();
    const a = await page(d, 'Uno', [{ text: 'la cámara' }]);
    const b = await page(d, 'Dos', [{ text: 'el trípode' }]);
    // Subido: sin ediciones pendientes (esas se releen siempre, ver la prueba que sigue).
    await d.engine.syncNow();
    const first = new ProjectIndex(d.tree, d.docs, { cache: localIndexCache(d.db) });
    await first.refresh(d.tree.workspaceId);
    await first.flush();
    first.dispose();
    expect((await d.db.getAllKeys('meta')).filter((k) => String(k).startsWith(INDEX_PREFIX)).length).toBe(2);

    await edit(d, b, [{ text: 'y la grúa' }]);
    await d.engine.syncNow();
    const read = vi.spyOn(d.docs, 'indexSnapshot');
    const second = new ProjectIndex(d.tree, d.docs, { cache: localIndexCache(d.db) });
    await second.refresh(d.tree.workspaceId);
    expect(read.mock.calls.map(([id]) => id)).toEqual([b]);
    expect(second.query(d.tree.workspaceId, 'camara').hits.map((h) => h.page.id)).toEqual([a]);
    expect(second.query(d.tree.workspaceId, 'grua').hits.map((h) => h.page.id)).toEqual([b]);
    second.dispose();
  });

  it('una página con ediciones sin subir (la marca `docDirty:`) se vuelve a leer aunque su marca no cambie', async () => {
    const d = await device();
    const a = await page(d, 'Uno', [{ text: 'la cámara' }]);
    await d.engine.syncNow();
    const first = new ProjectIndex(d.tree, d.docs, { cache: localIndexCache(d.db) });
    await first.refresh(d.tree.workspaceId);
    await first.flush();
    first.dispose();
    // Como si la app se hubiera cerrado entre guardar una edición y sumar la versión.
    await d.db.put('meta', 'x', dirtyKey(a));
    const read = vi.spyOn(d.docs, 'indexSnapshot');
    const second = new ProjectIndex(d.tree, d.docs, { cache: localIndexCache(d.db) });
    await second.refresh(d.tree.workspaceId);
    expect(read.mock.calls.map(([id]) => id)).toEqual([a]);
    second.dispose();
  });

  it('lo que ya no está en el árbol se borra del caché; lo guardado con otro formato no se usa', async () => {
    const d = await device();
    const a = await page(d, 'Uno', [{ text: 'la cámara' }]);
    const b = await page(d, 'Dos', [{ text: 'el trípode' }]);
    const first = new ProjectIndex(d.tree, d.docs, { cache: localIndexCache(d.db) });
    await first.refresh(d.tree.workspaceId);
    await first.flush();
    first.dispose();
    await d.db.put('meta', { v: 0, mark: 'x', units: [] }, indexKey(d.tree.workspaceId, a));
    // Un árbol en el que `b` ya no está (le sacaron el permiso, se borró del todo).
    const hidden: IndexTree = {
      get: (id) => (id === b ? undefined : d.tree.get(id)),
      isTrashed: (id) => d.tree.isTrashed(id),
      roots: (p) => d.tree.roots(p).filter((r) => r.id !== b),
      children: (id) => d.tree.children(id).filter((r) => r.id !== b),
      ancestors: (id) => d.tree.ancestors(id),
      hasUnsentCreate: (id) => d.tree.hasUnsentCreate(id),
    };
    const read = vi.spyOn(d.docs, 'indexSnapshot');
    const second = new ProjectIndex(hidden, d.docs, { cache: localIndexCache(d.db) });
    await second.refresh(d.tree.workspaceId);
    await second.flush();
    expect(read.mock.calls.map(([id]) => id)).toEqual([a]);
    const keys = (await d.db.getAllKeys('meta')).map(String).filter((k) => k.startsWith(INDEX_PREFIX));
    expect(keys).toEqual([indexKey(d.tree.workspaceId, a)]);
    expect(((await d.db.get('meta', indexKey(d.tree.workspaceId, a))) as { v: number }).v).toBe(1);
    second.dispose();
  });

  it('las relaciones retienen la lectura: cerrar el panel de buscar no la corta', async () => {
    const d = await device();
    for (let i = 0; i < 3; i++) await page(d, `P${i}`, [{ text: 'algo' }]);
    const index = new ProjectIndex(d.tree, d.docs);
    const release = index.retain();
    const run = index.refresh(d.tree.workspaceId);
    index.cancel();
    await run;
    expect(d.tree.roots(d.tree.workspaceId).every((p) => index.has(p.id))).toBe(true);
    release();
    index.dispose();
  });

  it('una lectura grande muestra cuántas páginas están al día; una chica, no', async () => {
    const d = await device();
    for (let i = 0; i < PROGRESS_MIN_PAGES; i++) await page(d, `P${i}`, [{ text: `texto ${i}` }]);
    const index = new ProjectIndex(d.tree, d.docs, { publishMs: 0 });
    const seen: string[] = [];
    index.subscribe(() => {
      const p = index.info(d.tree.workspaceId).progress;
      if (p) seen.push(`${p.ready}/${p.total}`);
    });
    await index.refresh(d.tree.workspaceId);
    expect(seen[0]).toBe(`0/${PROGRESS_MIN_PAGES}`);
    expect(seen.at(-1)).toBe(`${PROGRESS_MIN_PAGES}/${PROGRESS_MIN_PAGES}`);
    expect(index.info(d.tree.workspaceId).progress).toBeNull();
    // Una sola página que cambió: sin progreso.
    seen.length = 0;
    await edit(d, d.tree.roots(d.tree.workspaceId)[0].id, [{ text: 'más' }]);
    await index.refresh(d.tree.workspaceId);
    expect(seen).toEqual([]);
    index.dispose();
  });
});

describe('el índice de relaciones', () => {
  it('reconoce escenas, secciones con sus fotos, links y locaciones; deja afuera lo excluido y lo de adentro de una escena', async () => {
    const d = await device();
    const p = await project(d);
    const index = new ProjectIndex(d.tree, d.docs);
    const relations = new RelationIndex(d.tree, index);
    await index.refresh(d.tree.workspaceId);
    await relations.update(d.tree.workspaceId);
    const snap = relations.snapshot(d.tree.workspaceId)!;
    expect(snap.complete).toBe(true);
    expect([...snap.registry.scenes.keys()]).toEqual(['101_074', '101_075']);

    const s074 = entityRelations(snap, 'scene', '101_074');
    expect(s074.pageId).toBe(p.s074);
    // El día: la sección «Escena 101_074» (con la foto) y la mención en «Plates»; el archivo no cuenta.
    expect(s074.pages.map((x) => [x.pageId, x.stage, x.own])).toEqual([[p.d59, 'shoot', false]]);
    const [day] = s074.byStage.shoot;
    expect(day.sections.map((s) => s.title)).toEqual(['Escena 101_074']);
    expect(day.mentions.map((m) => m.via)).toEqual(['heading', 'text']);
    expect(s074.photos).toEqual([{ pageId: p.d59, sectionBlockId: day.sections[0].blockId, media: [PHOTO] }]);
    // El link a la escena 101_075 (adentro de la sección de 101_074) la nombra.
    expect(entityRelations(snap, 'scene', '101_075').pages.map((x) => [x.stage, x.mentions.map((m) => m.via).join()])).toEqual([['breakdown', 'text'], ['shoot', 'link']]);
    expect(entityRelations(snap, 'loc', 'CENADE').pages.map((x) => x.pageId)).toEqual([p.d59]);
    // Pendientes: 101_099 (con «Escena»); la ficha nombra 101_075, que existe.
    expect(pendingRelations(snap).map((x) => x.ref)).toEqual(['101_099']);
    expect(snap.registration.roles.get(p.archivo)!.excluded).toBe(true);
    expect(indexPages(snap)).toEqual([]);
    relations.dispose();
    index.dispose();
  });

  it('una página en la papelera deja de aportar; una escena nueva se reconoce sin releer los documentos', async () => {
    const d = await device();
    const p = await project(d);
    const index = new ProjectIndex(d.tree, d.docs);
    const relations = new RelationIndex(d.tree, index);
    await index.refresh(d.tree.workspaceId);
    await relations.update(d.tree.workspaceId);
    expect(pendingRelations(relations.snapshot(d.tree.workspaceId)!).map((x) => x.ref)).toEqual(['101_099']);
    // Se crea la escena 099: el pendiente pasa a ser una mención, sin abrir ningún documento.
    const read = vi.spyOn(d.docs, 'indexSnapshot');
    const ep = d.tree.children(p.bd)[0].id;
    await page(d, '099 | Nueva', [], ep);
    await index.refresh(d.tree.workspaceId);
    await relations.update(d.tree.workspaceId);
    let snap = relations.snapshot(d.tree.workspaceId)!;
    expect(pendingRelations(snap)).toEqual([]);
    expect(entityRelations(snap, 'scene', '101_099').pages.map((x) => x.pageId)).toEqual([p.d59]);
    expect(read.mock.calls.length).toBeLessThanOrEqual(1);
    // El día a la papelera: la escena 074 se queda sin nada.
    await d.tree.trash(p.d59);
    await relations.update(d.tree.workspaceId);
    snap = relations.snapshot(d.tree.workspaceId)!;
    expect(entityRelations(snap, 'scene', '101_074').pages).toEqual([]);
    relations.dispose();
    index.dispose();
  });

  it('más de 20 escenas distintas en una página: es una página índice', async () => {
    const d = await device();
    const bd = await page(d, 'Breakdown', [], null, { holds: 'scene' });
    for (let i = 1; i <= 21; i++) await page(d, `101_${String(i).padStart(3, '0')}`, [], bd);
    const list = await page(d, 'Lista', [{ text: Array.from({ length: 21 }, (_, i) => `101_${String(i + 1).padStart(3, '0')}`).join(' ') }]);
    const index = new ProjectIndex(d.tree, d.docs);
    const relations = new RelationIndex(d.tree, index);
    await index.refresh(d.tree.workspaceId);
    await relations.update(d.tree.workspaceId);
    const snap = relations.snapshot(d.tree.workspaceId)!;
    expect(indexPages(snap)).toEqual([list]);
    expect(entityRelations(snap, 'scene', '101_005').pages[0].indexPage).toBe(true);
    relations.dispose();
    index.dispose();
  });
});

describe('en vivo', () => {
  it('medio segundo después de dejar de escribir, la página abierta se relee y la escena se entera', async () => {
    const d = await device();
    const p = await project(d);
    const session = new RelationsSession({ tree: d.tree, docs: d.docs, db: d.db });
    session.open(d.tree.workspaceId);
    await session.index.refresh(d.tree.workspaceId);
    await session.relations.update(d.tree.workspaceId);
    // La nombran la ficha de 101_074 y el link del día.
    expect(entityRelations(session.relations.snapshot(d.tree.workspaceId)!, 'scene', '101_075').pages.length).toBe(2);
    const doc = await d.docs.open(p.d59);
    const read = vi.spyOn(d.docs, 'indexSnapshot');
    write(doc, [{ text: '101_075 queda para mañana' }]);
    await d.docs.flush();
    // Antes de la espera, nada.
    const day = () => entityRelations(session.relations.snapshot(d.tree.workspaceId)!, 'scene', '101_075').pages.find((x) => x.pageId === p.d59);
    expect(day()!.mentions.map((m) => m.via)).toEqual(['link']);
    await new Promise((r) => setTimeout(r, REREAD_MS + 100));
    await session.relations.update(d.tree.workspaceId);
    expect(day()!.mentions.map((m) => m.via)).toEqual(['link', 'text']);
    // Del documento vivo: sin leer lo guardado.
    expect(read).not.toHaveBeenCalled();
    d.docs.close(p.d59);
    session.dispose();
  });
});

describe('auditoría de E1: cambiar de proyecto, caché por proyecto, filas rotas', () => {
  /** Dos proyectos: A (el del árbol de prueba) con `n` páginas y B con `m`. */
  async function two(d: Device, n: number, m: number) {
    const a = d.tree.workspaceId;
    for (let i = 0; i < n; i++) await page(d, `A${i}`, [{ text: `uno ${i}` }]);
    const b = await d.tree.createProject('Otro');
    const bIds: string[] = [];
    for (let i = 0; i < m; i++) {
      const id = await d.tree.create(null, `B${i}`, b);
      await edit(d, id, [{ text: `dos ${i}` }]);
      bIds.push(id);
    }
    return { a, b, bIds };
  }

  it('B2: pedir otro proyecto corta la pasada del anterior aunque esté retenida, y el progreso es del proyecto pedido', async () => {
    const d = await device();
    const { a, b } = await two(d, PROGRESS_MIN_PAGES + 10, PROGRESS_MIN_PAGES + 2);
    // La lectura de A queda frenada en su tercera página hasta que la prueba la suelta.
    const real = d.docs.indexSnapshot.bind(d.docs);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let readA = 0;
    vi.spyOn(d.docs, 'indexSnapshot').mockImplementation(async (pageId) => {
      if (d.tree.get(pageId)?.workspace_id === a && ++readA === 3) await held;
      return real(pageId);
    });
    const index = new ProjectIndex(d.tree, d.docs);
    const stop = index.retain();
    const runA = index.refresh(a);
    await vi.waitFor(() => expect(readA).toBe(3));
    expect(index.info(a).progress?.total).toBe(PROGRESS_MIN_PAGES + 10);
    const runB = index.refresh(b);
    // El progreso de A no se muestra en B.
    expect(index.info(b).progress).toBeNull();
    release();
    await runA;
    await runB;
    // A se cortó (quedó a mitad) y B se leyó entero.
    expect(readA).toBeLessThan(PROGRESS_MIN_PAGES + 10);
    expect(index.pagesOf(b).every((p) => index.has(p.id))).toBe(true);
    stop();
    index.dispose();
  });

  it('O1: abrir un proyecto recupera solo lo suyo del caché', async () => {
    const d = await device();
    const { a, b, bIds } = await two(d, 3, 2);
    await d.engine.syncNow();
    const first = new ProjectIndex(d.tree, d.docs, { cache: localIndexCache(d.db) });
    await first.refresh(a);
    await first.refresh(b);
    await first.flush();
    first.dispose();
    const keys = (await d.db.getAllKeys('meta')).map(String).filter((k) => k.startsWith(INDEX_PREFIX));
    expect(keys.filter((k) => k.startsWith(`${INDEX_PREFIX}${b}:`)).length).toBe(2);
    const second = new ProjectIndex(d.tree, d.docs, { cache: localIndexCache(d.db) });
    const read = vi.spyOn(d.docs, 'indexSnapshot');
    await second.refresh(a);
    expect(read).not.toHaveBeenCalled();
    expect(bIds.some((id) => second.has(id))).toBe(false);
    await second.refresh(b);
    expect(read).not.toHaveBeenCalled();
    expect(bIds.every((id) => second.has(id))).toBe(true);
    second.dispose();
  });

  it('O4: una fila del caché con la forma de arriba bien pero rota se descarta sola, sin cortar la pasada', async () => {
    const d = await device();
    const ids = [await page(d, 'Uno', [{ text: 'la cámara' }]), await page(d, 'Dos', [{ text: 'el trípode' }])];
    await d.engine.syncNow();
    const first = new ProjectIndex(d.tree, d.docs, { cache: localIndexCache(d.db) });
    await first.refresh(d.tree.workspaceId);
    await first.flush();
    first.dispose();
    const key = indexKey(d.tree.workspaceId, ids[0]);
    const saved = (await d.db.get('meta', key)) as { units: unknown[] };
    await d.db.put('meta', { ...saved, units: [{ blockId: 'x', field: 'text' }] }, key);
    const read = vi.spyOn(d.docs, 'indexSnapshot');
    const second = new ProjectIndex(d.tree, d.docs, { cache: localIndexCache(d.db) });
    await second.refresh(d.tree.workspaceId);
    await second.flush();
    expect(read.mock.calls.map(([id]) => id)).toEqual([ids[0]]);
    expect(second.query(d.tree.workspaceId, 'camara').hits.map((h) => h.page.id)).toEqual([ids[0]]);
    expect(((await d.db.get('meta', key)) as { units: { text?: string }[] }).units[0].text).toBe('la cámara');
    second.dispose();
  });
});
