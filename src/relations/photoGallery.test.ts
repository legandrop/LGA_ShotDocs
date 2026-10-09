// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectIndex } from '../search/projectIndex';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import type { PageSettings } from '../sync/types';
import { dayLive } from './dayLive';
import { buildProject, writeBlocks, type Built } from './fixtures/proyectoSintetico';
import { locationLive, sceneLive, type LiveSource } from './liveView';
import { dayGallery, groupCaption, groupLabel, locationGallery, sceneGallery, scoutDateOf, scoutKindOf, type Gallery, type GalleryWords } from './photoGallery';
import { RelationIndex } from './relationIndex';

// Las fotos por fuente (E8; Docs/Doc_Relaciones.md, sección 13) con el índice de verdad sobre el proyecto sintético:
// el orden y los rótulos de la maqueta, técnico y creativo por separado (C7 O7), cada foto en su bloque, cada grupo en su
// lugar, y solo lo que la persona ve.

const devices: Device[] = [];
afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.docs.dispose();
    d.db.close();
  }
});

let n = 0;
const fakePhoto = async () => `0000${String(++n).padStart(4, '0')}-eeee-4bbb-8ccc-dddddddddddd`;
const W: GalleryWords = { breakdown: 'Breakdown', location: 'Location', general: 'General', techScout: 'Tech scout', creativeScout: 'Creative scout', scouting: 'Scouting', art: 'Art' };

async function indexed(d: Device, projectId: string): Promise<LiveSource> {
  const index = new ProjectIndex(d.tree, d.docs);
  const relations = new RelationIndex(d.tree, index);
  await index.refresh(projectId);
  await relations.update(projectId);
  const snap = relations.snapshot(projectId)!;
  return { snap, title: (id) => d.tree.get(id)?.title, content: (id) => index.content(id) };
}

/** El proyecto de la maqueta más un scouting creativo de CENADE que nombra la 105_027 y una foto en un decorado. */
async function setup(server = new FakeServer()): Promise<{ d: Device; built: Built; src: LiveSource; creative: string; photos: Record<string, string> }> {
  const d = await makeDevice(server);
  devices.push(d);
  const built = await buildProject(d, fakePhoto, { indexPage: false });
  const photos: Record<string, string> = {};
  const creative = await d.tree.create(built.ids.cenade, 'Creative scout', built.projectId);
  photos.cr1 = await fakePhoto();
  photos.cr2 = await fakePhoto();
  photos.set = await fakePhoto();
  await writeBlocks(d, creative, [
    { table: [['Date', '08/01/2026'], ['Location', 'CENADE']] },
    { h: 1, text: 'Escena 105_027' },
    { p: 'Dirección quiere el vuelco más cerca de cámara.' },
    { photo: photos.cr1 },
    { photo: photos.cr2 },
  ]);
  await writeBlocks(d, built.ids.set_ext, [{ table: [['Locacion Real', 'CENADE'], ['Plate', 'Ruta']] }, { photo: photos.set }]);
  await d.engine.syncNow();
  const src = await indexed(d, built.projectId);
  return { d, built, src, creative, photos };
}

const labels = (g: Gallery) => g.groups.map((x) => [groupLabel(x, W), x.photos.length]);

describe('scoutKindOf y scoutDateOf', () => {
  it('técnico o creativo, del título', () => {
    expect(scoutKindOf('260106 | Scouting técnico VFX | Cenade - Ezeiza')).toBe('tech');
    expect(scoutKindOf('Tech scout 06/01')).toBe('tech');
    expect(scoutKindOf('Scouting creativo | CENADE')).toBe('creative');
    expect(scoutKindOf('Creative scout')).toBe('creative');
    expect(scoutKindOf('Scouting con dirección')).toBe('creative');
    expect(scoutKindOf('26.01.06 | Scouting | Cenade - Ezeiza')).toBe('other');
    // «Técnico» gana sobre «dirección» (un técnico al que fue dirección sigue siendo técnico).
    expect(scoutKindOf('Scouting técnico con dirección')).toBe('tech');
  });

  it('la fecha «dd/mm» del título (las formas de ERSO y la de la plantilla)', async () => {
    const { src, creative } = await setup();
    const none = 'no-page';
    expect(scoutDateOf(src, none, '260106 | Scouting técnico VFX | Cenade - Ezeiza')).toBe('06/01');
    expect(scoutDateOf(src, none, '26.01.06 | Scouting | Cenade - Ezeiza')).toBe('06/01');
    expect(scoutDateOf(src, none, '2026-01-06 | Tech scout')).toBe('06/01');
    expect(scoutDateOf(src, none, 'Tech scout 6/1')).toBe('06/01');
    expect(scoutDateOf(src, none, 'Scouting 2025 | Ruta 205')).toBe('');
    expect(scoutDateOf(src, none, '991399 | Scouting')).toBe('');
    // El campo *Date* de la página manda (la plantilla lo trae).
    expect(scoutDateOf(src, creative, 'Creative scout')).toBe('08/01');
  });
});

describe('la galería de una escena', () => {
  it('105_027: desglose → técnico → creativo → cada sección de cada día, con los rótulos de la maqueta', async () => {
    const { built, src, creative, photos } = await setup();
    const g = sceneGallery(src, sceneLive(src, '105_027'));
    expect(labels(g)).toEqual([
      ['Breakdown', 2],
      ['Tech scout 06/01', 3],
      ['Creative scout 08/01', 2],
      ['Día 59 · Escena 105_027b', 5],
      ['Día 70 · Escena 105_027A + 029B', 4],
      ['Día 76 · Escena 5-27', 2],
      ['Día 76 · Escena 5-27A', 2],
    ]);
    // «All N»: todas, sin repetir, en el orden de los grupos.
    expect(g.all.length).toBe(20);
    expect(g.all.map((x) => x.photo.id).slice(0, 2)).toEqual([built.photos['Desglose 027 1'], built.photos['Desglose 027 2']]);
    // Las fotos de una sección son las de esa sección: nada de «Plates ambulancia» en la 105_027.
    expect(g.all.some((x) => x.photo.id === built.photos['D59 plates 1'])).toBe(false);
    // El grupo de una sección lleva a la sección entera (resaltada); cada foto, a su propio bloque.
    const d59 = g.groups[3];
    expect(d59.pageId).toBe(built.ids.d59);
    expect(d59.place.endBlockId).toBeTruthy();
    const rel = src.snap.pages.get(built.ids.d59)!;
    const heading = rel.sections.find((s) => s.title === 'Escena 105_027b')!;
    expect(d59.place.blockId).toBe(heading.blockId);
    for (const p of d59.photos) {
      expect(p.place.endBlockId).toBeUndefined();
      expect(rel.media.find((m) => m.blockId === p.place.blockId)!.ids).toContain(p.id);
    }
    // El creativo va con su página y su sección.
    const cr = g.groups[2];
    expect([cr.pageId, cr.scout, cr.photos.map((p) => p.id)]).toEqual([creative, 'creative', [photos.cr1, photos.cr2]]);
    expect(cr.pageTitle).toBe('Creative scout');
  });

  it('con más de una ficha con fotos, cada una dice su plano', async () => {
    const { d, built } = await setup();
    const extra = await fakePhoto();
    await writeBlocks(d, built.ids.s027_020, [{ table: [['Shot Name', 'PRUEBA_105_027_020']] }, { photo: extra }]);
    await d.engine.syncNow();
    const src = await indexed(d, built.projectId);
    const g = sceneGallery(src, sceneLive(src, '105_027'));
    expect(labels(g).slice(0, 2)).toEqual([
      ['Breakdown · PRUEBA_105_027_010', 2],
      ['Breakdown · PRUEBA_105_027_020', 1],
    ]);
  });

  it('O1: dos fichas con la misma imagen son una sola fuente; en la miniatura, el rótulo corto', async () => {
    const { d, built } = await setup();
    // La ficha 020 con la misma foto que la 010 (en ERSO, la 105_027: la misma imagen en sus dos fichas).
    await writeBlocks(d, built.ids.s027_020, [{ table: [['Shot Name', 'PRUEBA_105_027_020']] }, { photo: built.photos['Desglose 027 1'] }, { photo: built.photos['Desglose 027 2'] }]);
    await d.engine.syncNow();
    const src = await indexed(d, built.projectId);
    const g = sceneGallery(src, sceneLive(src, '105_027'));
    expect(labels(g).slice(0, 2)).toEqual([
      ['Breakdown', 2],
      ['Tech scout 06/01', 3],
    ]);
    expect(g.groups.map((x) => groupCaption(x, W))).toEqual(['Breakdown', 'Tech scout 06/01', 'Creative scout 08/01', 'Día 59', 'Día 70', 'Día 76', 'Día 76']);
  });

  it('las carpetas (o lo que se pida saltear) no entran, y un grupo que se queda sin fotos no aparece', async () => {
    const { built, src } = await setup();
    const skip = new Set([built.photos['D70 1'], built.photos['D70 2'], built.photos['D70 3'], built.photos['D70 4']]);
    const g = sceneGallery(src, sceneLive(src, '105_027'), (id) => skip.has(id));
    expect(labels(g).map((x) => x[0])).not.toContain('Día 70 · Escena 105_027A + 029B');
    expect(g.all.length).toBe(16);
  });
});

describe('la galería de una locación y de un día', () => {
  it('CENADE: decorado → técnico → creativo → cada día (por el título del día)', async () => {
    const { built, src, photos } = await setup();
    const g = locationGallery(src, locationLive(src, 'CENADE'));
    expect(labels(g)).toEqual([
      ['Art · Ambulancia | Ruta EXT', 1],
      ['Tech scout 06/01', 5],
      ['Creative scout 08/01', 2],
      ['Día 59', 7],
      ['Día 60', 2],
    ]);
    expect(g.groups[0].photos[0].id).toBe(photos.set);
    expect(g.groups[3].pageId).toBe(built.ids.d59);
    // Un grupo de una página entera lleva al primer bloque con fotos.
    expect(g.groups[3].place).toEqual(g.groups[3].photos[0].place);
  });

  it('Día 59: cada sección con su título; lo general del día primero', async () => {
    const { d, built } = await setup();
    const loose = await fakePhoto();
    await writeBlocks(d, built.ids.d59, [
      { h: 1, text: 'Info general' },
      { p: 'Llamado 7:00.' },
      { photo: loose },
      { h: 1, text: 'Escena 105_027b' },
      { p: 'Tres tomas del vuelco.' },
      { photo: built.photos['D59 vuelco 1'] },
      { h: 1, text: 'Plates ambulancia' },
      { p: 'Plates de ruta.' },
      { photo: built.photos['D59 plates 1'] },
    ]);
    await d.engine.syncNow();
    const src = await indexed(d, built.projectId);
    const g = dayGallery(src, dayLive(src, built.ids.d59));
    expect(labels(g)).toEqual([
      ['General', 1],
      ['105_027b', 1],
      ['Plates ambulancia', 1],
    ]);
    expect(g.groups[1].place.endBlockId).toBeTruthy();
  });
});

describe('permisos', () => {
  it('un invitado que ve solo la escena: solo las fotos de su rama, ni scoutings ni días', async () => {
    const server = new FakeServer();
    server.enableTeam();
    const { d: owner, built } = await setup(server);
    // La marca de la página (E2): sin la carpeta, el invitado igual sabe que es una escena.
    await owner.tree.setPatch(built.ids.s027, { settings: { entity: { kind: 'scene', code: '105_027' } } as unknown as PageSettings });
    await owner.engine.syncNow();
    server.addMember('ana', 'member', 'ana@test');
    server.grant('ana', { pageId: built.ids.s027 }, 'view');
    const guest = await makeDevice(server, crypto.randomUUID(), '0.021', {}, undefined, { id: 'ana', email: 'ana@test' });
    devices.push(guest);
    await guest.engine.syncNow();
    await guest.engine.syncNow();
    const src = await indexed(guest, built.projectId);
    const g = sceneGallery(src, sceneLive(src, '105_027'));
    expect(labels(g)).toEqual([['Breakdown', 2]]);
    for (const group of g.groups) expect(guest.tree.get(group.pageId)).toBeTruthy();
    // Aunque la foto del índice trajera una página que ya no ve (le sacaron el permiso), el grupo no aparece.
    const hidden: LiveSource = { ...src, title: (id) => (id === built.ids.s027_010 ? undefined : src.title(id)) };
    expect(sceneGallery(hidden, sceneLive(src, '105_027')).groups.length).toBe(0);
  });
});
