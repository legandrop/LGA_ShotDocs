// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectIndex } from '../search/projectIndex';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { buildProject, writeBlocks, type Block } from './fixtures/proyectoSintetico';
import type { LiveSource } from './liveView';
import { RelationIndex } from './relationIndex';
import { buildShotsTable, byScene, shotsTable, shotsTsv } from './shotsTable';

// *Overview › Shots* (D813, parte 3): una fila por plano de todas las escenas, con los planos escritos adentro de la
// página de la escena (título 1 «Planos», un título 2 por plano, D785) y las fichas que siguen siendo subpáginas.

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

async function sourceOf(d: Device, projectId: string): Promise<LiveSource> {
  const index = new ProjectIndex(d.tree, d.docs);
  const rel = new RelationIndex(d.tree, index);
  await index.refresh(projectId);
  await rel.update(projectId);
  return { snap: rel.snapshot(projectId)!, title: (id) => d.tree.get(id)?.title, content: (id) => index.content(id) };
}

describe('la tabla de planos', () => {
  it('los planos adentro de la escena y las fichas subpáginas, con sus campos como columnas', async () => {
    const d = await makeDevice(new FakeServer());
    devices.push(d);
    const built = await buildProject(d, fakePhoto, { indexPage: false });
    // La 105_029 con sus planos adentro, como los deja *Bring shots into this page*.
    await writeBlocks(d, built.ids.s029, [
      { p: 'La escena entera.' },
      { h: 1, text: 'Planos' },
      { h: 2, text: 'ERSO_105_029_010' },
      { table: [['Shot Name', 'ERSO_105_029_010'], ['Descripción', 'Vuelco de la ambulancia'], ['Complejidad', 'Alta'], ['Fecha Rodaje', '20/02/2026']] },
      { h: 2, text: 'ERSO_105_029_020' },
      { table: [['Shot Name', 'ERSO_105_029_020'], ['Descripción', 'Plano detalle\nde la rueda'], ['Complejidad', '—']] },
      { h: 1, text: 'Notas' },
      { table: [['Complejidad', 'esto no es de ningún plano']] },
    ]);
    const src = await sourceOf(d, built.projectId);
    const table = buildShotsTable(src);

    const inPage = table.rows.filter((r) => r.scene === '105_029' && r.place.pageId === built.ids.s029);
    expect(inPage.map((r) => r.shot)).toEqual(['ERSO_105_029_010', 'ERSO_105_029_020']);
    expect(inPage[0].values.get('complejidad')).toBe('Alta');
    // Un valor de varios renglones va en uno; «—» es vacío; lo de afuera de «Planos» no es de ningún plano.
    expect(inPage[1].values.get('descripcion')).toBe('Plano detalle / de la rueda');
    expect(inPage[1].values.has('complejidad')).toBe(false);
    expect(table.rows.some((r) => r.values.get('complejidad') === 'esto no es de ningún plano')).toBe(false);
    // La fila lleva a la sección del plano.
    expect(inPage[0].place.endBlockId).toBeTruthy();

    // Las fichas subpáginas (las del proyecto sintético, con *Shot Name*) también son planos.
    const cards = table.rows.filter((r) => r.place.pageId !== built.ids.s029 && r.scene === '105_027');
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((r) => r.shot.length > 0)).toBe(true);

    // Las filas en orden de escena; las columnas que se buscan siempre, primero.
    expect(table.rows.map((r) => r.scene)).toEqual([...table.rows.map((r) => r.scene)].sort(byScene));
    const keys = table.columns.map((c) => c.key);
    expect(keys.indexOf('descripcion')).toBeLessThan(keys.indexOf('complejidad'));
    // El *Shot Name* que ya está en el nombre de la fila (también en el de una ficha, «PRUEBA_104_008_010 Ambulancia»)
    // no es una columna.
    expect(keys).not.toContain('shot name');
    expect(table.scenes + table.withoutShots).toBe(src.snap.registry.scenes.size);

    // Guardada por foto.
    expect(shotsTable(src)).toBe(shotsTable(src));

    // Para pegar en una planilla: una fila por plano, separada por tabulaciones, sin saltos de renglón adentro.
    const tsv = shotsTsv(table, inPage, { scene: 'Scene', shot: 'Shot' }).split('\n');
    expect(tsv[0].split('\t').slice(0, 2)).toEqual(['Scene', 'Shot']);
    expect(tsv).toHaveLength(3);
    expect(tsv[2]).toContain('Plano detalle / de la rueda');
  });

  it('una escena en dos páginas, documentos y nietas adentro, y lo que el nombre no dice (auditoría)', async () => {
    const d = await makeDevice(new FakeServer());
    devices.push(d);
    const built = await buildProject(d, fakePhoto, { indexPage: false });
    const shots = (title: string, extra: [string, string][] = []): Block[] => [
      { h: 1, text: 'Planos' },
      { h: 2, text: title },
      { table: [['Shot Name', title], ['Descripción', `Descripción de ${title}`], ...extra] },
    ];
    await writeBlocks(d, built.ids.s029, shots('ERSO_105_029_010', [['Plano', 'Plano detalle']]));
    // La misma escena en otra página (dos dispositivos la crearon a la vez): sus planos también, hasta que se unan.
    const twin = await d.tree.create(d.tree.get(built.ids.s029)!.parent_id, '029 | La misma escena', built.projectId);
    await writeBlocks(d, twin, shots('ERSO_105_029_020'));
    // Adentro de la escena: una prueba (un documento) y la subpágina de una ficha (una nieta) no son planos.
    const test = await d.tree.create(built.ids.s029, 'Prueba de lente', built.projectId);
    await d.tree.setPatch(test, { settings: { entity: { kind: 'test' } } });
    await writeBlocks(d, test, [{ table: [['Descripción', 'una prueba'], ['Complejidad', 'Alta']] }]);
    const card = await d.tree.create(built.ids.s029, 'ERSO_105_029_030', built.projectId);
    await writeBlocks(d, card, [{ table: [['Shot Name', 'ERSO_105_029_030'], ['Descripción', 'la ficha']] }]);
    const grandchild = await d.tree.create(card, 'Referencias', built.projectId);
    await writeBlocks(d, grandchild, [{ table: [['Descripción', 'una referencia']] }]);

    const src = await sourceOf(d, built.projectId);
    expect(src.snap.registration.duplicates.map((x) => x.code)).toContain('105_029');
    const mine = buildShotsTable(src).rows.filter((r) => r.scene === '105_029');
    // (Más la ficha que el proyecto sintético ya tiene en la 105_029.)
    expect(mine.map((r) => r.shot).sort()).toEqual(['ERSO_105_029_010', 'ERSO_105_029_020', 'ERSO_105_029_030', 'PRUEBA_105_029_010 Ambulancia']);
    // «Plano | Plano detalle» dice algo distinto del nombre: queda como columna, no se pierde.
    expect(mine.find((r) => r.shot === 'ERSO_105_029_010')!.values.get('plano')).toBe('Plano detalle');
  });
});
