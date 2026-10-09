// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { HELP_ENTRIES } from '../help/entries';
import { searchHelp } from '../help/search';
import { ProjectIndex } from '../search/projectIndex';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { buildProject, type Built } from './fixtures/proyectoSintetico';
import { GENERAL_SECTION, sceneLive, type LiveSource } from './liveView';
import type { PageRelations, Section } from './pageRelations';
import { pendingSummary, projectMap } from './projectMap';
import { RelationIndex } from './relationIndex';

// R6 «repartir un reporte por escenas» se cerró SIN escribir (D581): el reporte no se parte, la escena muestra su parte
// en vivo. Esta es la prueba de conservación de esa vista: de punta a punta (documento → índice → cabecera de la escena
// y mapa), ninguna foto de un reporte se pierde, ninguna de la parte general ni de una sección sin escena llega a una
// escena, cada sección de escena aparece una vez en cada escena que nombra y mirar no cambia el documento.
//
// No repite al lector (`reader.test.ts`: 0116B, H1067, 1033B+C…) ni las fichas de `liveView.test.ts`: agrega lo que
// faltaba de punta a punta con el Día 80 de `buildProject({ coverage: true })`, que junta los casos raros de ERSO.
//
// Las fotos NO suman: `readPageRelations` anota cada foto en todas las secciones abiertas (la de un subtítulo cuenta en
// el subtítulo y en la sección que lo contiene, a propósito), así que la prueba compara CONJUNTOS, no sumas (C1 de la
// auditoría de R6).

const devices: Device[] = [];
afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.docs.dispose();
    d.db.close();
  }
});

let n = 0;
const fakePhoto = async () => `0000${String(++n).padStart(4, '0')}-aaaa-4bbb-8ccc-dddddddddddd`;

interface World {
  d: Device;
  built: Built;
  src: () => Promise<LiveSource>;
}

async function setup(): Promise<World> {
  const d = await makeDevice(new FakeServer());
  devices.push(d);
  const built = await buildProject(d, fakePhoto, { coverage: true, indexPage: false });
  const index = new ProjectIndex(d.tree, d.docs);
  const relations = new RelationIndex(d.tree, index);
  const src = async (): Promise<LiveSource> => {
    await index.refresh(built.projectId);
    await relations.update(built.projectId);
    const snap = relations.snapshot(built.projectId)!;
    return { snap, title: (id) => d.tree.get(id)?.title, content: (id) => index.content(id) };
  };
  return { d, built, src };
}

/**
 * «Sección externa» (la definición, una sola vez): el par (sección, escena) de un título que nombra la escena y que NO
 * está adentro de otra sección del mismo día que nombra esa misma escena. Una sección que nombra otra escena (el
 * subtítulo `5026 plano 1` adentro de `Escena 105_027`) sigue siendo externa para la suya. Es la regla de la cabecera de
 * la escena (`entityRelations`) y del mapa (`projectMap`), escrita acá a mano para compararlas con ella.
 */
function externalPairs(sections: Section[]): { s: Section; code: string }[] {
  const out: { s: Section; code: string }[] = [];
  sections.forEach((s, i) => {
    for (const x of s.scenes) {
      if (x.kind !== 'scene') continue;
      const enclosed = sections.some((o, j) => j < i && o.block < s.block && o.end >= s.end && o.scenes.some((y) => y.kind === 'scene' && y.ref === x.ref));
      if (!enclosed) out.push({ s, code: x.ref });
    }
  });
  return out;
}

/** La verdad del Día 80, escrita a mano: las escenas a las que llega cada foto (por su etiqueta en el fixture). */
const PHOTO_SCENES: Record<string, string[]> = {
  // La parte general: las fotos de arriba y las de «Info general».
  'Cov general previa 1': [],
  'Cov general previa 2': [],
  'Cov general 1': [],
  'Cov general 2': [],
  'Cov 0408 1': ['104_008', '105_029'], // repetida a propósito en dos secciones
  'Cov 0408 2': ['104_008'],
  'Cov H5029 1': ['105_029'],
  'Cov H5029 sub 1': ['105_029'], // adentro del subtítulo «Sup Notes»
  'Cov 5025+26 1': ['105_025', '105_026'], // un título que nombra dos escenas
  'Cov 5025+26 2': ['105_025', '105_026'],
  'Cov 027 1': ['105_027'],
  'Cov 026 plano 1': ['105_026', '105_027'], // el subtítulo «5026 plano 1» adentro de «Escena 105_027»: de las dos
  'Cov 026 1': ['105_026'],
  // Secciones sin escena con fotos.
  'Cov plates 1': [],
  'Cov plates 2': [],
  'Cov driving 1': [],
  'Cov viejitos 1': [], // las del título sin escena que contiene escenas de segundo nivel
  'Cov viejitos 0409 1': ['104_009'],
  'Cov viejitos 5025 1': ['105_025'],
};

/** Las secciones de escena del Día 80 que muestra la cabecera de cada escena, en orden. */
const SECTIONS_OF: Record<string, string[]> = {
  '104_008': ['0408'],
  '104_009': ['0409'],
  '105_025': ['Escena 5025 + 5026', '5025'],
  '105_026': ['Escena 5025 + 5026', '5026 plano 1', 'Escena 105_026'],
  '105_027': ['Escena 105_027'],
  '105_029': ['H5029'],
};

const CODES = Object.keys(SECTIONS_OF);

describe('cobertura de las secciones de un reporte (R6, D581–D583)', () => {
  it('cada sección de escena aparece una vez en cada escena que nombra, con el mismo lugar en la cabecera y en el mapa', async () => {
    const { built, src } = await setup();
    const s = await src();
    expect(s.snap.complete).toBe(true);
    const dayId = built.ids.d80;
    const rel = s.snap.pages.get(dayId)!;
    const m = projectMap(s);
    const mapDay = m.days.find((x) => x.pageId === dayId)!;

    // La definición de «externa» de la prueba da exactamente la verdad escrita a mano.
    const pairs = externalPairs(rel.sections);
    for (const code of CODES) expect(pairs.filter((p) => p.code === code).map((p) => p.s.title)).toEqual(SECTIONS_OF[code]);
    expect(pairs).toHaveLength(Object.values(SECTIONS_OF).flat().length);

    for (const code of CODES) {
      const live = sceneLive(s, code).days.find((x) => x.day.pageId === dayId)!;
      // (a1) Una vez cada una, en el orden del reporte.
      expect(live.sections.map((e) => e.heading)).toEqual(SECTIONS_OF[code]);
      const blocks = live.sections.map((e) => e.place.blockId);
      expect(new Set(blocks).size).toBe(blocks.length);
      // (a2) El lugar (donde empieza y donde cierra) es el de la sección del reporte.
      const expected = pairs.filter((p) => p.code === code).map((p) => ({ blockId: p.s.blockId, endBlockId: p.s.endBlockId }));
      expect(live.sections.map((e) => ({ blockId: e.place.blockId, endBlockId: e.place.endBlockId }))).toEqual(expected);
      // (a3) El mapa dice lo mismo que la cabecera.
      const onMap = mapDay.sections.filter((x) => x.scenes.includes(code)).map((x) => ({ blockId: x.blockId, endBlockId: x.endBlockId }));
      expect(onMap).toEqual(expected);
      expect(m.scenes.find((x) => x.code === code)!.shot.find((x) => x.dayId === dayId)!.sections.map((x) => x.blockId)).toEqual(blocks);
      expect(mapDay.scenes).toContain(code);
    }
    // Y el mapa no tiene ninguna sección de escena de más.
    expect(mapDay.sections.flatMap((x) => x.scenes).sort()).toEqual(pairs.map((p) => p.code).sort());
  });

  it('las fotos son un conjunto: ninguna se pierde, ninguna de lo general ni de lo que no tiene escena cruza, y las que llegan a dos escenas son las previstas', async () => {
    const { built, src } = await setup();
    const s = await src();
    const dayId = built.ids.d80;
    const rel: PageRelations = s.snap.pages.get(dayId)!;
    const m = projectMap(s);
    const mapDay = m.days.find((x) => x.pageId === dayId)!;
    const labelOf = new Map(Object.entries(built.photos).map(([label, id]) => [id, label]));
    const label = (id: string) => labelOf.get(id) ?? id;
    const dayIds = new Set(rel.media.flatMap((x) => x.ids));
    // El fixture es la verdad: las fotos del día son exactamente las de la tabla.
    expect([...dayIds].map(label).sort()).toEqual(Object.keys(PHOTO_SCENES).sort());

    // Las tres partes del reporte, por separado (con la misma definición de «externa»).
    const firstHeading = rel.sections[0].block;
    const general = new Set<string>(rel.media.filter((x) => x.block < firstHeading).flatMap((x) => x.ids));
    for (const sec of rel.sections) if (GENERAL_SECTION.test(sec.title)) for (const id of sec.media) general.add(id);
    const scenePart = new Set(externalPairs(rel.sections).flatMap((p) => p.s.media));
    const unnumberedBlocks = new Set(mapDay.unnumbered.map((u) => u.blockId));
    const unnumberedPart = new Set(rel.sections.filter((sec) => unnumberedBlocks.has(sec.blockId)).flatMap((sec) => sec.media));

    // (i) Conservación como conjunto: toda foto del día está en alguna parte.
    for (const id of dayIds) expect(general.has(id) || scenePart.has(id) || unnumberedPart.has(id), label(id)).toBe(true);

    // (ii) Lo que llega a cada escena, por fotos de verdad (cabecera y mapa).
    const reaches = new Map<string, string[]>();
    for (const code of CODES) {
      const live = sceneLive(s, code).days.find((x) => x.day.pageId === dayId)!;
      const ids = new Set(live.photos.map((p) => p.id));
      // La cabecera de la escena y la suma de sus secciones muestran las mismas fotos.
      expect(new Set(live.sections.flatMap((e) => e.photos.map((p) => p.id)))).toEqual(ids);
      for (const id of ids) reaches.set(id, [...(reaches.get(id) ?? []), code].sort());
    }
    // Nada de la parte general cruza a una escena.
    for (const id of general) expect(reaches.has(id), label(id)).toBe(false);
    // Ni nada de lo propio de una sección sin escena (las de sus escenas de segundo nivel sí, porque son de la escena).
    for (const l of ['Cov plates 1', 'Cov plates 2', 'Cov driving 1', 'Cov viejitos 1']) expect(reaches.has(built.photos[l]), l).toBe(false);
    // Lo que llega a una escena sale de sus secciones: ni una foto de más.
    for (const id of reaches.keys()) expect(scenePart.has(id), label(id)).toBe(true);

    // (iii) Cada foto llega exactamente a las escenas previstas. Las que llegan a dos o más son solo estas: un título con
    // dos escenas, un subtítulo que nombra otra escena adentro de una sección, y la misma foto repetida en dos bloques.
    for (const [l, scenes] of Object.entries(PHOTO_SCENES)) expect(reaches.get(built.photos[l]) ?? [], l).toEqual(scenes);
    const shared = [...reaches].filter(([, scenes]) => scenes.length > 1).map(([id]) => label(id)).sort();
    expect(shared).toEqual(['Cov 026 plano 1', 'Cov 0408 1', 'Cov 5025+26 1', 'Cov 5025+26 2']);
  });

  it('lo que no es de ninguna escena queda a la vista: las secciones sin escena con fotos van a Pending (el caso del Día 79 incluido) y la general no', async () => {
    const { built, src } = await setup();
    const s = await src();
    const dayId = built.ids.d80;
    const m = projectMap(s);
    const mapDay = m.days.find((x) => x.pageId === dayId)!;
    // «Plate viejitos + gestapo» tiene fotos propias y escenas de segundo nivel: va a Pending (sus fotos propias son de
    // nadie), y sus escenas de segundo nivel siguen siendo de su escena. «Info general» (la parte general) no va.
    expect(mapDay.unnumbered.map((u) => u.title)).toEqual(['Plates ambulancia', 'Escena Driving POV', 'Plate viejitos + gestapo']);
    expect(m.unnumbered.filter((u) => u.dayId === dayId).map((u) => u.title)).toEqual(mapDay.unnumbered.map((u) => u.title));
    expect(mapDay.sections.map((x) => x.title)).not.toContain('Info general');
    expect(mapDay.sections.map((x) => x.title)).not.toContain('Plate viejitos + gestapo');
    // Nada en el reporte nombra una escena que no existe.
    expect(mapDay.sections.flatMap((x) => x.pending)).toEqual([]);
    // La barra lateral cuenta lo mismo que el mapa.
    expect(pendingSummary(s).unnumbered).toBe(m.unnumbered.length);
  });

  it('armar la cabecera, el mapa y la lista de pendientes no cambia el documento del reporte', async () => {
    // Guarda barata: la vista lee del índice, no del documento. El valor de la prueba está en las otras tres.
    const { d, built, src } = await setup();
    const doc = await d.docs.open(built.ids.d80);
    const vector = Y.encodeStateVector(doc);
    const state = Y.encodeStateAsUpdate(doc);
    const s = await src();
    for (const code of CODES) sceneLive(s, code);
    projectMap(s);
    pendingSummary(s);
    expect(Y.encodeStateVector(doc)).toEqual(vector);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(state);
    d.docs.close(built.ids.d80);
  });
});

describe('la ayuda de R6', () => {
  it('buscar «split» o «repartir» lleva a la entrada que dice que los reportes quedan enteros', () => {
    for (const [query, lang] of [['split', 'en'], ['repartir', 'es'], ['dividir', 'es']] as const) {
      expect(searchHelp(HELP_ENTRIES, query, lang).map((h) => h.entry.id), query).toContain('liveHeader');
    }
  });
});
