// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectIndex } from '../search/projectIndex';
import { unitsFromYDoc } from '../search/extract';
import { LEVEL_EDIT_PAGES, Permissions } from '../sync/access';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { BUILTIN_SCENE } from '../templates/builtinIds';
import { createDepsFrom, createEntity, createGuard, undoCreate, type GuardContext, type GuardPerms } from './createEntity';
import { pageSignature } from './createWrite';
import { buildProject, writeBlocks, type Built } from './fixtures/proyectoSintetico';
import { RelationIndex, type RelationSnapshot } from './relationIndex';
import { sceneLive } from './liveView';

// Crear una escena o una locación desde el texto (E7, D512–D517, D525): cada guarda con su caso negativo, dónde y cómo
// queda la página creada, dos pedidos a la vez, sin red, y *Undo*.

const devices: Device[] = [];
afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.docs.dispose();
    d.db.close();
  }
});

let n = 0;
const fakePhoto = async () => `0000${String(++n).padStart(4, '0')}-cccc-4bbb-8ccc-dddddddddddd`;

const owner: GuardPerms = { known: true, projectLevel: () => LEVEL_EDIT_PAGES, canCreateIn: () => true };

async function world(server = new FakeServer()): Promise<{ d: Device; built: Built; snap: () => Promise<RelationSnapshot>; ctx: (over?: Partial<GuardContext>) => Promise<GuardContext> }> {
  const d = await makeDevice(server);
  devices.push(d);
  const built = await buildProject(d, fakePhoto, { indexPage: false });
  await d.engine.syncNow();
  const index = new ProjectIndex(d.tree, d.docs);
  const rel = new RelationIndex(d.tree, index);
  const snap = async () => {
    await index.refresh(built.projectId);
    await rel.update(built.projectId);
    return rel.snapshot(built.projectId)!;
  };
  const ctx = async (over: Partial<GuardContext> = {}) => ({ tree: d.tree, perms: owner, snap: await snap(), sync: d.engine.getStatus(), projectId: built.projectId, ...over });
  return { d, built, snap, ctx };
}

describe('las guardas (G1–G5)', () => {
  it('pasa: la carpeta de su episodio, en orden por número, título = el código', async () => {
    const { built, ctx } = await world();
    const c = await ctx();
    expect(createGuard(c, { kind: 'scene', code: '105_120' })).toEqual({ ok: true, parentId: built.ids.ep5, before: undefined, title: '105_120' });
    expect(createGuard(c, { kind: 'scene', code: '105_028' })).toMatchObject({ ok: true, parentId: built.ids.ep5, before: built.ids.s029 });
    expect(createGuard(c, { kind: 'scene', code: '104_001' })).toMatchObject({ ok: true, parentId: built.ids.ep4, before: built.ids.s008 });
    // Un episodio que no existe no se ofrece; un código que no es canónico, tampoco.
    expect(createGuard(c, { kind: 'scene', code: '106_001' })).toEqual({ ok: false, reason: 'invalid' });
    expect(createGuard(c, { kind: 'scene', code: '105-120' })).toEqual({ ok: false, reason: 'invalid' });
  });

  it('G1: sin permiso sobre el proyecto entero (invitado con Edit & create en la carpeta) o con los permisos desconocidos, no', async () => {
    const { ctx } = await world();
    const guest: GuardPerms = { known: true, projectLevel: () => 0, canCreateIn: () => true };
    expect(createGuard(await ctx({ perms: guest }), { kind: 'scene', code: '105_120' })).toEqual({ ok: false, reason: 'partial' });
    expect(createGuard(await ctx({ perms: { ...owner, known: false } }), { kind: 'scene', code: '105_120' })).toEqual({ ok: false, reason: 'partial' });
    expect(createGuard(await ctx({ perms: guest }), { kind: 'location', name: 'Planta Bernal' })).toEqual({ ok: false, reason: 'partial' });
  });

  it('G1 con la cuenta de la base: un miembro con permiso sobre la carpeta del desglose (Edit & create) no ve el proyecto entero', async () => {
    const server = new FakeServer();
    server.enableTeam();
    const { built } = await world(server);
    server.addMember('ana', 'member', 'ana@test');
    server.grant('ana', { pageId: built.ids.desglose }, 'edit_pages');
    const guest = await makeDevice(server, crypto.randomUUID(), '0.021', {}, undefined, { id: 'ana', email: 'ana@test' });
    devices.push(guest);
    await guest.engine.syncNow();
    await guest.engine.syncNow();
    const perms = new Permissions(guest.tree, guest.access.get(), 'ana');
    expect(perms.known).toBe(true);
    expect(perms.canCreateIn(built.ids.ep5, built.projectId)).toBe(true);
    const index = new ProjectIndex(guest.tree, guest.docs);
    const rel = new RelationIndex(guest.tree, index);
    await index.refresh(built.projectId);
    await rel.update(built.projectId);
    const c: GuardContext = { tree: guest.tree, perms, snap: rel.snapshot(built.projectId), sync: guest.engine.getStatus(), projectId: built.projectId };
    expect(createGuard(c, { kind: 'scene', code: '105_120' })).toEqual({ ok: false, reason: 'partial' });
  });

  it('G2: mientras el índice lee (o sin foto), no', async () => {
    const { ctx } = await world();
    const c = await ctx();
    expect(createGuard({ ...c, snap: { ...c.snap!, complete: false } }, { kind: 'scene', code: '105_120' })).toEqual({ ok: false, reason: 'reading' });
    expect(createGuard({ ...c, snap: null }, { kind: 'scene', code: '105_120' })).toEqual({ ok: false, reason: 'reading' });
  });

  it('G3: sin red, o sin una sincronización buena en esta sesión, no', async () => {
    const { ctx } = await world();
    expect(createGuard(await ctx({ sync: { online: false, lastSyncAt: Date.now() } }), { kind: 'scene', code: '105_120' })).toEqual({ ok: false, reason: 'offline' });
    expect(createGuard(await ctx({ sync: { online: true, lastSyncAt: null } }), { kind: 'scene', code: '105_120' })).toEqual({ ok: false, reason: 'offline' });
  });

  it('G4: en la papelera, fuera de las relaciones, con letra o la base', async () => {
    const { d, built, ctx } = await world();
    const trashed = await d.tree.create(built.ids.ep5, '120 | La vieja', built.projectId);
    await d.tree.trash(trashed);
    await d.tree.create(built.ids.archivo, '105_121 | Descartada', built.projectId);
    await d.tree.create(built.ids.ep5, '122A | Con letra', built.projectId);
    const c = await ctx();
    expect(createGuard(c, { kind: 'scene', code: '105_120' })).toEqual({ ok: false, reason: 'trash', pageId: trashed });
    expect(createGuard(c, { kind: 'scene', code: '105_121' })).toEqual({ ok: false, reason: 'archived', pageId: built.ids.archivo });
    expect(createGuard(c, { kind: 'scene', code: '105_122' })).toMatchObject({ ok: false, reason: 'letter', other: '105_122A' });
    expect(createGuard(c, { kind: 'scene', code: '105_025B' })).toMatchObject({ ok: false, reason: 'base', other: '105_025', pageId: built.ids.s025 });
    expect(createGuard(c, { kind: 'scene', code: '105_027' })).toEqual({ ok: false, reason: 'exists', pageId: built.ids.s027 });
    // Adentro de una página en la papelera (no la escena misma) también cuenta.
    const folder = await d.tree.create(built.ids.ep5, 'Viejas', built.projectId);
    await d.tree.create(folder, '105_123 | Adentro', built.projectId);
    await d.tree.trash(folder);
    expect(createGuard(await ctx(), { kind: 'scene', code: '105_123' })).toEqual({ ok: false, reason: 'trash', pageId: folder });
  });

  it('G5: sin carpeta Scenes, con dos carpetas candidatas o sin permiso de crear ahí', async () => {
    const server = new FakeServer();
    const d = await makeDevice(server);
    devices.push(d);
    const projectId = await d.tree.createProject('Largo');
    // Un largo (sin episodios) con dos carpetas de escenas, una escena en cada una: no se elige por la persona.
    const a = await d.tree.create(null, 'Escenas A', projectId);
    await d.tree.setSetting(a, 'holds', 'scene');
    const b = await d.tree.create(null, 'Escenas B', projectId);
    await d.tree.setSetting(b, 'holds', 'scene');
    await d.tree.create(a, '001 | Uno', projectId);
    await d.tree.create(b, '002 | Dos', projectId);
    await d.engine.syncNow();
    const index = new ProjectIndex(d.tree, d.docs);
    const rel = new RelationIndex(d.tree, index);
    const snap = async () => {
      await index.refresh(projectId);
      await rel.update(projectId);
      return rel.snapshot(projectId)!;
    };
    const c = async (): Promise<GuardContext> => ({ tree: d.tree, perms: owner, snap: await snap(), sync: d.engine.getStatus(), projectId });
    expect(createGuard(await c(), { kind: 'scene', code: '003' })).toEqual({ ok: false, reason: 'twoFolders' });
    const four = await d.tree.create(a, '004 | Cuatro', projectId);
    expect(createGuard(await c(), { kind: 'scene', code: '003' })).toEqual({ ok: true, parentId: a, before: four, title: '003' });
    expect(createGuard({ ...(await c()), perms: { ...owner, canCreateIn: () => false } }, { kind: 'scene', code: '003' })).toEqual({ ok: false, reason: 'cantCreate', pageId: a });
    // Las escenas de un episodio repartidas entre su grupo y la carpeta Scenes misma (empatan): no se elige (O9).
    const p3 = await d.tree.createProject('Serie repartida');
    const scenes = await d.tree.create(null, 'Desglose', p3);
    await d.tree.setSetting(scenes, 'holds', 'scene');
    const group = await d.tree.create(scenes, '105 | Episodio 5', p3);
    await d.tree.create(group, '001 | Uno', p3);
    await d.tree.create(scenes, '105_002 | Suelta en la carpeta', p3);
    await index.refresh(p3);
    await rel.update(p3);
    const s3 = rel.snapshot(p3)!;
    expect([...s3.registry.scenes.keys()].sort()).toEqual(['105_001', '105_002']);
    expect(createGuard({ tree: d.tree, perms: owner, snap: s3, sync: d.engine.getStatus(), projectId: p3 }, { kind: 'scene', code: '105_003' })).toEqual({ ok: false, reason: 'twoFolders' });
    // Sin carpeta de locaciones.
    expect(createGuard(await c(), { kind: 'location', name: 'Planta Bernal' })).toEqual({ ok: false, reason: 'noFolder' });
    // Una escena marcada a mano en la raíz y ninguna carpeta Scenes: no hay dónde.
    const p2 = await d.tree.createProject('Otra');
    const loose = await d.tree.create(null, '105_001 | Suelta', p2);
    await d.tree.setSetting(loose, 'entity', { kind: 'scene', code: '105_001' });
    await index.refresh(p2);
    await rel.update(p2);
    expect(createGuard({ tree: d.tree, perms: owner, snap: rel.snapshot(p2), sync: d.engine.getStatus(), projectId: p2 }, { kind: 'scene', code: '105_002' })).toEqual({ ok: false, reason: 'noFolder' });
  });

  it('D525: locaciones: no si ya existe con ese nombre, un alias o el nombre sin el paréntesis; una genérica se crea con aviso', async () => {
    const { built, ctx } = await world();
    const c = await ctx();
    expect(createGuard(c, { kind: 'location', name: 'cenade' })).toEqual({ ok: false, reason: 'exists', pageId: built.ids.cenade });
    expect(createGuard(c, { kind: 'location', name: 'la arenera' })).toEqual({ ok: false, reason: 'exists', pageId: built.ids.arenera });
    expect(createGuard(c, { kind: 'location', name: 'planta bernal' })).toEqual({ ok: true, parentId: built.ids.locaciones, title: 'Planta bernal', generic: false });
    expect(createGuard(c, { kind: 'location', name: 'Casa' })).toMatchObject({ ok: true, generic: true });
    expect(createGuard(c, { kind: 'location', name: ' ' })).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('crear', () => {
  const depsOf = (d: Device, built: Built, snap: () => Promise<RelationSnapshot>, perms: GuardPerms = owner) => {
    let current: RelationSnapshot | null = null;
    const deps = createDepsFrom(d, { projectId: built.projectId, lang: 'es', perms: () => perms, snap: () => current });
    return { deps, ready: async () => (current = await snap()) };
  };

  it('la escena queda en su carpeta, en orden, con su marca, la plantilla Scene y su contenido; otra vez, ya existe', async () => {
    const { d, built, snap } = await world();
    const { deps, ready } = depsOf(d, built, snap);
    await ready();
    const res = await createEntity(deps, { kind: 'scene', code: '105_028' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = d.tree.get(res.pageId)!;
    expect(row).toMatchObject({ parent_id: built.ids.ep5, title: '105_028', template_id: BUILTIN_SCENE });
    expect(row.settings?.entity).toEqual({ kind: 'scene', code: '105_028' });
    const kids = d.tree.children(built.ids.ep5).map((p) => p.title);
    expect(kids.indexOf('105_028')).toBe(kids.findIndex((t) => t.startsWith('029')) - 1);
    const doc = await d.docs.open(res.pageId);
    expect(unitsFromYDoc(doc).length).toBeGreaterThan(2);
    d.docs.close(res.pageId);
    const now = await ready();
    // La plantilla trae «Director: » y «Production design: » para llenar: no son preguntas abiertas (O11).
    const live = sceneLive({ snap: now, title: (id) => d.tree.get(id)?.title, content: () => undefined }, '105_028');
    expect(live.questions).toEqual([]);
    expect(await createEntity(deps, { kind: 'scene', code: '105_028' })).toEqual({ ok: false, reason: 'exists', pageId: res.pageId });
  });

  it('dos pedidos a la vez (el / y el adelanto, o dos ↵): una sola página', async () => {
    const { d, built, snap } = await world();
    const { deps, ready } = depsOf(d, built, snap);
    await ready();
    const [a, b] = await Promise.all([createEntity(deps, { kind: 'scene', code: '105_120' }), createEntity(deps, { kind: 'scene', code: '105_120' })]);
    expect(a).toEqual(b);
    expect(d.tree.children(built.ids.ep5).filter((p) => p.title === '105_120')).toHaveLength(1);
  });

  it('sin red en el momento de crear (la sincronización de antes falla): no crea y dice por qué', async () => {
    const server = new FakeServer();
    const { d, built, snap } = await world(server);
    const { deps, ready } = depsOf(d, built, snap);
    await ready();
    server.online = false;
    expect(await createEntity(deps, { kind: 'scene', code: '105_120' })).toEqual({ ok: false, reason: 'offline' });
    expect(d.tree.children(built.ids.ep5).some((p) => p.title === '105_120')).toBe(false);
  });

  it('la sincronización de antes trae la escena que otro dispositivo acaba de crear: no la duplica', async () => {
    const server = new FakeServer();
    const { d, built, snap } = await world(server);
    const { deps, ready } = depsOf(d, built, snap);
    await ready();
    const other = await makeDevice(server);
    devices.push(other);
    await other.engine.syncNow();
    const theirs = await other.tree.create(built.ids.ep5, '105_120', built.projectId);
    await other.engine.syncNow();
    // A todavía no la vio: su foto y su árbol son de antes.
    expect(d.tree.get(theirs)).toBeUndefined();
    expect(await createEntity(deps, { kind: 'scene', code: '105_120' })).toEqual({ ok: false, reason: 'exists', pageId: theirs });
  });

  it('una locación: al final de la carpeta de locaciones, con su marca', async () => {
    const { d, built, snap } = await world();
    const { deps, ready } = depsOf(d, built, snap);
    await ready();
    const res = await createEntity(deps, { kind: 'location', name: 'planta bernal' });
    expect(res).toMatchObject({ ok: true, parentId: built.ids.locaciones, title: 'Planta bernal' });
    if (!res.ok) return;
    expect(d.tree.get(res.pageId)!.settings?.entity).toEqual({ kind: 'location' });
    expect(d.tree.children(built.ids.locaciones).at(-1)!.id).toBe(res.pageId);
  });

  it('Undo: a la papelera solo si nadie la tocó', async () => {
    const { d, built, snap } = await world();
    const { deps, ready } = depsOf(d, built, snap);
    await ready();
    const a = await createEntity(deps, { kind: 'scene', code: '105_120' });
    const b = await createEntity(deps, { kind: 'scene', code: '105_121' });
    if (!a.ok || !b.ok) throw new Error('no creó');
    const sigA = await pageSignature(d.docs, a.pageId);
    const sigB = await pageSignature(d.docs, b.pageId);
    // En la B alguien escribió algo.
    await writeBlocks(d, b.pageId, [{ p: 'Notas del set' }]);
    expect(await undoCreate(d.tree, a, async () => (await pageSignature(d.docs, a.pageId)) === sigA)).toBe('trashed');
    expect(d.tree.isTrashed(a.pageId)).toBe(true);
    expect(await undoCreate(d.tree, b, async () => (await pageSignature(d.docs, b.pageId)) === sigB)).toBe('changed');
    expect(d.tree.isTrashed(b.pageId)).toBe(false);
    expect(await undoCreate(d.tree, a, async () => true)).toBe('gone');
  });
});
