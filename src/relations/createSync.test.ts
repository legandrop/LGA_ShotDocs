// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectIndex } from '../search/projectIndex';
import { unitsFromYDoc } from '../search/extract';
import { LEVEL_EDIT_PAGES } from '../sync/access';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { createDepsFrom, createEntity, freshSync, undoCreate, type GuardPerms } from './createEntity';
import { pageSignature } from './createWrite';
import { buildProject, writeBlocks, type Built } from './fixtures/proyectoSintetico';
import { projectMap } from './projectMap';
import { pendingRelations, RelationIndex, type RelationSnapshot } from './relationIndex';

// Dos dispositivos crean la misma escena (E7, D514, D520): sin red las guardas no dejan crear desde el texto; si igual
// la crean con el «+» del árbol, al juntarse quedan las dos páginas, nada se pierde ni se borra solo, *Pending* las muestra
// como duplicadas y un tercer intento ya no crea. Con red y a la vez, el mismo resultado como mucho.

const devices: Device[] = [];
afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.docs.dispose();
    d.db.close();
  }
});

let n = 0;
const fakePhoto = async () => `0000${String(++n).padStart(4, '0')}-ffff-4bbb-8ccc-dddddddddddd`;
const owner: GuardPerms = { known: true, projectLevel: () => LEVEL_EDIT_PAGES, canCreateIn: () => true };

interface Side {
  d: Device;
  snap: () => Promise<RelationSnapshot>;
  create: (code: string) => ReturnType<typeof createEntity>;
}

async function side(d: Device, built: Built): Promise<Side> {
  const index = new ProjectIndex(d.tree, d.docs);
  const rel = new RelationIndex(d.tree, index);
  let current: RelationSnapshot | null = null;
  const snap = async () => {
    await index.refresh(built.projectId);
    await rel.update(built.projectId);
    return (current = rel.snapshot(built.projectId)!);
  };
  const deps = createDepsFrom(d, { projectId: built.projectId, lang: 'es', perms: () => owner, snap: () => current });
  return { d, snap, create: (code) => createEntity(deps, { kind: 'scene', code }) };
}

async function two(): Promise<{ server: FakeServer; built: Built; A: Side; B: Side }> {
  const server = new FakeServer();
  const a = await makeDevice(server);
  devices.push(a);
  const built = await buildProject(a, fakePhoto, { indexPage: false });
  // La nota que nombra 105_120 (que no existe).
  await writeBlocks(a, built.ids.notas, [{ p: 'Falta la Escena 105_120 en el desglose.' }]);
  await a.engine.syncNow();
  const b = await makeDevice(server);
  devices.push(b);
  await b.engine.syncNow();
  const A = await side(a, built);
  const B = await side(b, built);
  return { server, built, A, B };
}

const scenePages = (d: Device, built: Built) => d.tree.children(built.ids.ep5).filter((p) => p.title === '105_120');
const textOf = async (d: Device, pageId: string) => {
  const doc = await d.docs.open(pageId);
  const out = unitsFromYDoc(doc).map((u) => u.text).join(' | ');
  d.docs.close(pageId);
  return out;
};

describe('dos dispositivos y la misma escena', () => {
  it('sin red: ninguno crea desde el texto; con el «+» las dos quedan, nada perdido, duplicadas en Pending; un tercer intento no crea', async () => {
    const { server, built, A, B } = await two();
    for (const s of [A, B]) {
      const snap = await s.snap();
      expect(pendingRelations(snap).map((p) => p.ref)).toEqual(['105_120']);
    }
    server.online = false;
    await A.d.engine.syncNow();
    await B.d.engine.syncNow();
    expect(await A.create('105_120')).toEqual({ ok: false, reason: 'offline' });
    expect(await B.create('105_120')).toEqual({ ok: false, reason: 'offline' });
    // Igual la crean con el «+» del árbol (sin red, como siempre) y escriben adentro.
    const pa = await A.d.tree.create(built.ids.ep5, '105_120', built.projectId);
    await writeBlocks(A.d, pa, [{ p: 'Escrito en A: el puente de noche.' }]);
    const pb = await B.d.tree.create(built.ids.ep5, '105_120', built.projectId);
    await writeBlocks(B.d, pb, [{ p: 'Escrito en B: plates del puente.' }]);
    server.online = true;
    for (let i = 0; i < 2; i++) {
      await A.d.engine.syncNow();
      await B.d.engine.syncNow();
    }
    for (const s of [A, B]) {
      expect(scenePages(s.d, built).map((p) => p.id).sort()).toEqual([pa, pb].sort());
      expect(await textOf(s.d, pa)).toContain('Escrito en A');
      expect(await textOf(s.d, pb)).toContain('Escrito en B');
      const snap = await s.snap();
      expect(snap.registration.duplicates).toEqual([{ code: '105_120', pageIds: expect.arrayContaining([pa, pb]) }]);
      expect(pendingRelations(snap)).toEqual([]);
      const map = projectMap({ snap, title: (id) => s.d.tree.get(id)?.title, content: () => undefined });
      expect(map.duplicates.map((x) => x.code)).toEqual(['105_120']);
      // La mención de la nota cuenta para la escena (la primera del árbol).
      expect(snap.pages.get(built.ids.notas)!.mentions.some((m) => m.kind === 'scene' && m.ref === '105_120')).toBe(true);
      // Un tercer intento: ya existe.
      expect(await s.create('105_120')).toMatchObject({ ok: false, reason: 'exists' });
    }
    // Nada fue a la papelera.
    expect([pa, pb].some((id) => A.d.tree.isTrashed(id) || B.d.tree.isTrashed(id))).toBe(false);
  });

  it('con red y a la vez: como mucho dos páginas, ninguna se borra sola, y después ninguno crea otra', async () => {
    const { built, A, B } = await two();
    await A.snap();
    await B.snap();
    const [ra, rb] = await Promise.all([A.create('105_120'), B.create('105_120')]);
    const made = [ra, rb].filter((r) => r.ok).length;
    expect(made).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < 2; i++) {
      await A.d.engine.syncNow();
      await B.d.engine.syncNow();
    }
    const ids = scenePages(A.d, built).map((p) => p.id).sort();
    expect(ids).toHaveLength(made);
    expect(scenePages(B.d, built).map((p) => p.id).sort()).toEqual(ids);
    for (const id of ids) expect(A.d.tree.isTrashed(id)).toBe(false);
    for (const s of [A, B]) {
      await s.snap();
      expect(await s.create('105_120')).toMatchObject({ ok: false, reason: 'exists' });
    }
    expect(scenePages(A.d, built)).toHaveLength(made);
  });

  it('A crea con red (la fila sube sola enseguida); B, que todavía no se enteró, sincroniza antes de crear y no la duplica', async () => {
    const { server, built, A, B } = await two();
    await A.snap();
    await B.snap();
    const ra = await A.create('105_120');
    expect(ra.ok).toBe(true);
    // A no sincroniza a mano: crear ya sube la fila (D546, O1).
    if (!ra.ok) return;
    for (let i = 0; i < 100 && !server.pages.has(ra.pageId); i++) await new Promise((r) => setTimeout(r, 10));
    expect(server.pages.has(ra.pageId)).toBe(true);
    // B tiene la foto y el árbol de antes.
    expect(scenePages(B.d, built)).toHaveLength(0);
    expect(await B.create('105_120')).toMatchObject({ ok: false, reason: 'exists' });
    expect(scenePages(B.d, built)).toHaveLength(1);
  });

  it('Undo de A no manda a la papelera una página en la que B ya escribió (sincroniza y compara antes, D547, O2)', async () => {
    const { server, built, A, B } = await two();
    await A.snap();
    const ra = await A.create('105_120');
    if (!ra.ok) throw new Error('no creó');
    const signature = await pageSignature(A.d.docs, ra.pageId);
    await A.d.engine.syncNow();
    await B.d.engine.syncNow();
    await writeBlocks(B.d, ra.pageId, [{ p: 'B ya escribe acá.' }]);
    await B.d.engine.syncNow();
    // A todavía tiene su copia de antes: sin sincronizar, la habría mandado a la papelera.
    expect(await textOf(A.d, ra.pageId)).not.toContain('B ya escribe');
    const same = async () => (await pageSignature(A.d.docs, ra.pageId)) === signature;
    expect(await undoCreate(A.d.tree, ra, same, () => freshSync(A.d.engine))).toBe('changed');
    expect(A.d.tree.isTrashed(ra.pageId)).toBe(false);
    // Sin red no se deshace: no se sabe si alguien escribe.
    const rb = await A.create('105_121');
    if (!rb.ok) throw new Error('no creó');
    server.online = false;
    expect(await undoCreate(A.d.tree, rb, async () => true, () => freshSync(A.d.engine, 2000))).toBe('offline');
    expect(A.d.tree.isTrashed(rb.pageId)).toBe(false);
    void built;
  });
});
