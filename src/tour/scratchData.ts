import type { Stage } from '../relations/projectStructure';
import { BUILTIN_CREATIVE_SCOUT, BUILTIN_LOCATION, BUILTIN_ONSET, BUILTIN_SCENE } from '../templates/builtinIds';
import { builtinBlocks, type TemplateBlock } from '../templates/builtin';
import type { PageTree } from '../sync/tree';
import { fold } from '../relations/reader';

// El proyecto de práctica de «A project from scratch» (Docs/Plan_Proyecto_Desde_Cero.md, sección 6): un corto inventado,
// «El último tren», con 20 escenas en 5 locaciones. Los capítulos 2 a 4 crean a mano la escena 001, su locación y su
// decorado; el capítulo 5 («veinte escenas después») siembra el resto con esto, y cada capítulo que entra por el medio
// fabrica lo que le falta con las mismas funciones. Las fotos son libres (Wikimedia Commons, dominio público y CC0):
// `public/tour/img/LICENSES.txt`.
//
// Se escribe como la app: la página con su marca de tipo (`settings.entity`), la plantilla de fábrica llena y las fotos
// subidas al dispositivo (`media.add`), así la cabecera, la tabla de Escenas y el Overview las leen como cualquier otra.

type Bi = { en: string; es: string };

export interface SeedLocation {
  key: string;
  name: Bi;
  photo: string;
  address: Bi;
  sets: { key: string; name: Bi; photo: string }[];
}

export interface SeedScene {
  code: string;
  name: Bi;
  loc: string;
  set: string;
  intExt: Bi;
  /**
   * El día de rodaje planeado, contado desde hoy (0: hoy). Así el plan y el reporte del recorrido se crean con la fecha
   * que propone la app, sin tipear fechas, y traen las escenas de ese día.
   */
  date: number;
  text: Bi;
  vfx: number;
}

export const SCRATCH_LOCATIONS: SeedLocation[] = [
  {
    key: 'station',
    name: { en: 'Old Station', es: 'Estación Vieja' },
    photo: 'estacion-hall',
    address: { en: 'End of the line, by the freight yard', es: 'Fin de la línea, junto a la playa de cargas' },
    sets: [
      { key: 'platform', name: { en: 'Platform', es: 'Andén' }, photo: 'estacion-anden' },
      { key: 'waiting', name: { en: 'Waiting room', es: 'Sala de espera' }, photo: 'estacion-espera' },
      { key: 'hall', name: { en: 'Main hall', es: 'Hall central' }, photo: 'estacion-hall' },
    ],
  },
  {
    key: 'bridge',
    name: { en: 'Iron Bridge', es: 'Puente de hierro' },
    photo: 'puente',
    address: { en: 'Old rural road, 12 km from town', es: 'Camino rural viejo, a 12 km del pueblo' },
    sets: [{ key: 'bridge', name: { en: 'Bridge', es: 'Puente' }, photo: 'puente-detalle' }],
  },
  {
    key: 'chapel',
    name: { en: 'San Roque Chapel', es: 'Capilla San Roque' },
    photo: 'capilla',
    address: { en: 'Main square, north side', es: 'Plaza principal, lado norte' },
    sets: [{ key: 'chapel', name: { en: 'Chapel', es: 'Capilla' }, photo: 'capilla' }],
  },
  {
    key: 'corner',
    name: { en: 'Moreno Corner', es: 'Esquina Moreno' },
    photo: 'calle-noche',
    address: { en: 'Moreno and 9 de Julio', es: 'Moreno y 9 de Julio' },
    sets: [{ key: 'corner', name: { en: 'Bar corner', es: 'Esquina del bar' }, photo: 'calle-noche' }],
  },
  {
    key: 'stage',
    name: { en: 'Stage 2', es: 'Estudio 2' },
    photo: 'vagon',
    address: { en: 'The studio, stage 2 (built set)', es: 'El estudio, set 2 (decorado construido)' },
    sets: [{ key: 'car', name: { en: 'Train car', es: 'Vagón' }, photo: 'vagon' }],
  },
];

const NIGHT: Bi = { en: 'EXT · Night', es: 'EXT · Noche' };
const INT_NIGHT: Bi = { en: 'INT · Night', es: 'INT · Noche' };
const INT_DAY: Bi = { en: 'INT · Day', es: 'INT · Día' };
const DAWN: Bi = { en: 'EXT · Dawn', es: 'EXT · Amanecer' };

export const SCRATCH_SCENES: SeedScene[] = [
  { code: '001', name: { en: 'Platform at night', es: 'Andén de noche' }, loc: 'station', set: 'platform', intExt: NIGHT, date: 0, vfx: 2, text: { en: 'MARA waits for the last train. The platform is empty; a clock reads 11:58.', es: 'MARA espera el último tren. El andén está vacío; un reloj marca las 23:58.' } },
  { code: '002', name: { en: 'The waiting room', es: 'La sala de espera' }, loc: 'station', set: 'waiting', intExt: INT_NIGHT, date: 0, vfx: 0, text: { en: 'MARA finds an old ticket on a bench, dated forty years ago.', es: 'MARA encuentra en un banco un boleto viejo, de hace cuarenta años.' } },
  { code: '003', name: { en: 'The train arrives', es: 'Llega el tren' }, loc: 'station', set: 'platform', intExt: NIGHT, date: 0, vfx: 4, text: { en: 'A train comes out of the fog. Nobody gets off.', es: 'Un tren sale de la niebla. No baja nadie.' } },
  { code: '004', name: { en: 'Inside the car', es: 'Adentro del vagón' }, loc: 'stage', set: 'car', intExt: INT_NIGHT, date: 2, vfx: 6, text: { en: 'The fields slide by the windows; the car is full of sleeping passengers.', es: 'Los campos pasan por las ventanas; el vagón está lleno de pasajeros dormidos.' } },
  { code: '005', name: { en: 'The conductor', es: 'El guarda' }, loc: 'stage', set: 'car', intExt: INT_NIGHT, date: 2, vfx: 1, text: { en: 'The CONDUCTOR punches the old ticket without a word.', es: 'El GUARDA marca el boleto viejo sin decir nada.' } },
  { code: '006', name: { en: 'On the bridge', es: 'Sobre el puente' }, loc: 'bridge', set: 'bridge', intExt: NIGHT, date: 1, vfx: 5, text: { en: 'The train crosses the iron bridge over a swollen river.', es: 'El tren cruza el puente de hierro sobre un río crecido.' } },
  { code: '007', name: { en: 'Emergency brake', es: 'Freno de emergencia' }, loc: 'stage', set: 'car', intExt: INT_NIGHT, date: 2, vfx: 3, text: { en: 'MARA pulls the brake. Sparks, darkness, silence.', es: 'MARA tira del freno. Chispas, oscuridad, silencio.' } },
  { code: '008', name: { en: 'The empty bridge', es: 'El puente vacío' }, loc: 'bridge', set: 'bridge', intExt: DAWN, date: 1, vfx: 2, text: { en: 'At dawn there is no train and no rails: only the bridge.', es: 'Al amanecer no hay tren ni vías: solo el puente.' } },
  { code: '009', name: { en: 'Walk to the chapel', es: 'Caminata a la capilla' }, loc: 'bridge', set: 'bridge', intExt: DAWN, date: 1, vfx: 0, text: { en: 'MARA follows the old road towards the town.', es: 'MARA sigue el camino viejo hacia el pueblo.' } },
  { code: '010', name: { en: 'The chapel', es: 'La capilla' }, loc: 'chapel', set: 'chapel', intExt: INT_DAY, date: 3, vfx: 0, text: { en: 'The chapel is open and empty. Candles still burning.', es: 'La capilla está abierta y vacía. Las velas siguen prendidas.' } },
  { code: '011', name: { en: 'The priest', es: 'El cura' }, loc: 'chapel', set: 'chapel', intExt: INT_DAY, date: 3, vfx: 0, text: { en: 'The PRIEST recognizes the ticket: the train stopped running in 1986.', es: 'El CURA reconoce el boleto: el tren dejó de pasar en 1986.' } },
  { code: '012', name: { en: 'The old photos', es: 'Las fotos viejas' }, loc: 'chapel', set: 'chapel', intExt: INT_DAY, date: 3, vfx: 1, text: { en: 'In a photo of the last trip, MARA sees her own face.', es: 'En una foto del último viaje, MARA ve su propia cara.' } },
  { code: '013', name: { en: 'Back to town', es: 'De vuelta al pueblo' }, loc: 'corner', set: 'corner', intExt: NIGHT, date: 4, vfx: 1, text: { en: 'Rain. MARA crosses the empty square towards the bar.', es: 'Lluvia. MARA cruza la plaza vacía hacia el bar.' } },
  { code: '014', name: { en: 'The bar', es: 'El bar' }, loc: 'corner', set: 'corner', intExt: NIGHT, date: 4, vfx: 0, text: { en: 'The OWNER closes up. He has heard the whistle too.', es: 'El DUEÑO cierra. Él también escuchó el silbato.' } },
  { code: '015', name: { en: 'The phone call', es: 'La llamada' }, loc: 'corner', set: 'corner', intExt: NIGHT, date: 4, vfx: 3, text: { en: 'From a phone booth MARA calls home. Nobody has that number anymore.', es: 'Desde un teléfono público MARA llama a su casa. Nadie tiene ese número.' } },
  { code: '016', name: { en: 'The abandoned hall', es: 'El hall abandonado' }, loc: 'station', set: 'hall', intExt: INT_NIGHT, date: 5, vfx: 4, text: { en: 'The station hall, ruined. For a second, the lamps light up as they were.', es: 'El hall de la estación, en ruinas. Por un segundo las lámparas se prenden como eran.' } },
  { code: '017', name: { en: 'The timetable', es: 'Los horarios' }, loc: 'station', set: 'hall', intExt: INT_NIGHT, date: 5, vfx: 2, text: { en: 'The timetable board turns by itself to the 11:58 departure.', es: 'El tablero de horarios gira solo hasta la salida de las 23:58.' } },
  { code: '018', name: { en: 'The last train', es: 'El último tren' }, loc: 'station', set: 'platform', intExt: NIGHT, date: 5, vfx: 6, text: { en: 'The train comes back. This time MARA knows where it goes.', es: 'El tren vuelve. Esta vez MARA sabe a dónde va.' } },
  { code: '019', name: { en: 'Departure', es: 'Partida' }, loc: 'stage', set: 'car', intExt: INT_NIGHT, date: 6, vfx: 3, text: { en: 'MARA sits by the window. The CONDUCTOR smiles.', es: 'MARA se sienta junto a la ventana. El GUARDA sonríe.' } },
  { code: '020', name: { en: 'Dawn', es: 'Amanecer' }, loc: 'bridge', set: 'bridge', intExt: DAWN, date: 1, vfx: 2, text: { en: 'The empty bridge in the first light. A ticket flies away in the wind.', es: 'El puente vacío con la primera luz. Un boleto se vuela con el viento.' } },
];

/** Lo que hace falta para sembrar: los mismos servicios que usa la app. */
export interface SeedDeps {
  tree: PageTree;
  projectId: string;
  stages: Record<Stage, string>;
  lang: 'en' | 'es';
  /** Escribe los bloques en una página nueva (`writeNewPage`). */
  write(pageId: string, blocks: TemplateBlock[]): Promise<void>;
  /** Sube una foto al dispositivo y devuelve su dirección (`media.add`); `null` si no se pudo (sin la foto, sigue). */
  photo(pageId: string, name: string): Promise<string | null>;
  /** Los documentos del dispositivo, para el plan y el reporte del día (con las funciones de la app). */
  docs?: DocsLike;
}

type DocsLike = import('../templates/dayReportCreate').DayReportDeps['docs'];

const live = (tree: PageTree, id: string) => !!tree.get(id) && !tree.isTrashed(id);

/** La página hija con ese título (sin tildes ni mayúsculas), si existe. */
function childNamed(tree: PageTree, parentId: string, title: string): string | null {
  const want = fold(title).trim();
  return tree.children(parentId).find((r) => live(tree, r.id) && fold(r.title).trim() === want)?.id ?? null;
}

/** La escena con ese número en el proyecto, si existe (por su marca o por su título). */
function sceneByCode(tree: PageTree, projectId: string, code: string): string | null {
  for (const r of tree.allRowsOf(projectId)) {
    if (!live(tree, r.id)) continue;
    const mark = r.settings?.entity as { kind?: string; code?: string } | undefined;
    if (mark?.kind === 'scene' && mark.code === code) return r.id;
    if (r.title === code || r.title.startsWith(`${code} |`)) return r.id;
  }
  return null;
}

/** La ficha de la plantilla con los valores, por fila (la primera columna es el rótulo). */
function fill(blocks: TemplateBlock[], values: (string | undefined)[]): TemplateBlock[] {
  const [table, ...rest] = blocks;
  const content = table.content as { rows: { cells: string[] }[] };
  const rows = content.rows.map((r, i) => ({ cells: [r.cells[0], values[i] ?? r.cells[1] ?? ''] }));
  return [{ ...table, content: { ...content, rows } }, ...rest];
}

const image = (url: string): TemplateBlock => ({ type: 'image', props: { url } });
const para = (text: string): TemplateBlock => ({ type: 'paragraph', content: text });

/** Después del primer título 2 (*Notes*), el texto; el resto de la plantilla queda igual. */
function afterNotes(blocks: TemplateBlock[], add: TemplateBlock[]): TemplateBlock[] {
  const at = blocks.findIndex((b) => b.type === 'heading');
  if (at < 0) return [...blocks, ...add];
  // El párrafo vacío de la plantilla debajo de *Notes* se reemplaza.
  const next = blocks[at + 1];
  const skip = next?.type === 'paragraph' && !next.content ? 1 : 0;
  return [...blocks.slice(0, at + 1), ...add, ...blocks.slice(at + 1 + skip)];
}

/** La locación (y sus decorados adentro), si falta. Devuelve su página. */
export async function seedLocation(d: SeedDeps, key: string, opts: { sets?: boolean } = {}): Promise<string> {
  const loc = SCRATCH_LOCATIONS.find((l) => l.key === key)!;
  const name = loc.name[d.lang];
  let id = childNamed(d.tree, d.stages.locations, name);
  if (!id) {
    id = await d.tree.create(d.stages.locations, name, d.projectId, { templateId: BUILTIN_LOCATION });
    await d.tree.setSetting(id, 'entity', { kind: 'location' });
    const scenes = SCRATCH_SCENES.filter((s) => s.loc === key).map((s) => s.code).join(', ');
    const url = await d.photo(id, loc.photo);
    // Ficha: Also known as, Scenes, Address, …; las fotos al final, debajo de su título.
    const blocks = fill(builtinBlocks('location', d.lang), [undefined, scenes, loc.address[d.lang]]);
    await d.write(id, url ? [...blocks, image(url)] : blocks);
  }
  if (opts.sets !== false) for (const s of loc.sets) await seedSet(d, key, s.key);
  return id;
}

/** El decorado adentro de su locación, si falta. */
export async function seedSet(d: SeedDeps, locKey: string, setKey: string): Promise<string> {
  const loc = SCRATCH_LOCATIONS.find((l) => l.key === locKey)!;
  const set = loc.sets.find((s) => s.key === setKey)!;
  const locId = await seedLocation(d, locKey, { sets: false });
  const existing = childNamed(d.tree, locId, set.name[d.lang]);
  if (existing) return existing;
  const id = await d.tree.create(locId, set.name[d.lang], d.projectId);
  await d.tree.setSetting(id, 'entity', { kind: 'set' });
  const url = await d.photo(id, set.photo);
  await d.write(id, url ? [image(url)] : [para('')]);
  return id;
}

/**
 * La escena (con su locación y su decorado), si falta. `location: false`: como queda después del capítulo 2 (solo el
 * número y el nombre, la ficha vacía), para que el capítulo 3 escriba la locación.
 */
export async function seedScene(d: SeedDeps, code: string, opts: { location?: boolean } = {}): Promise<string> {
  const s = SCRATCH_SCENES.find((x) => x.code === code)!;
  const existing = sceneByCode(d.tree, d.projectId, code);
  if (existing) return existing;
  if (opts.location === false) {
    const id = await d.tree.create(d.stages.scenes, `${code} | ${s.name[d.lang]}`, d.projectId, { templateId: BUILTIN_SCENE });
    await d.tree.setSetting(id, 'entity', { kind: 'scene', code });
    await d.write(id, fill(builtinBlocks('scene', d.lang), [code]));
    return id;
  }
  await seedSet(d, s.loc, s.set);
  const loc = SCRATCH_LOCATIONS.find((l) => l.key === s.loc)!;
  const set = loc.sets.find((x) => x.key === s.set)!;
  const id = await d.tree.create(d.stages.scenes, `${code} | ${s.name[d.lang]}`, d.projectId, { templateId: BUILTIN_SCENE });
  await d.tree.setSetting(id, 'entity', { kind: 'scene', code });
  const url = await d.photo(id, set.photo);
  // Ficha: Scene, Location (planned), Set, INT/EXT, Shoot date (planned), VFX shots.
  const blocks = fill(builtinBlocks('scene', d.lang), [code, loc.name[d.lang], set.name[d.lang], s.intExt[d.lang], shootDate(s.date), String(s.vfx)]);
  await d.write(id, afterNotes(blocks, [para(s.text[d.lang]), ...(url ? [image(url)] : [])]));
  return id;
}

/** La fecha (`AAAA-MM-DD`, la del dispositivo) de `offset` días desde hoy. */
export function shootDate(offset: number, now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Todas las escenas de `from` en adelante (el salto del capítulo 5), en orden. */
export async function seedScenes(d: SeedDeps, codes: string[] = SCRATCH_SCENES.map((s) => s.code)): Promise<void> {
  for (const code of codes) await seedScene(d, code);
}

const STATION = 'station';

/** El scouting de dirección de la locación del capítulo 6 (con su campo de locación y una foto), si falta. */
export async function seedScouting(d: SeedDeps): Promise<string> {
  const loc = SCRATCH_LOCATIONS.find((l) => l.key === STATION)!;
  const title = d.lang === 'es' ? `Scouting de dirección · ${loc.name.es}` : `Director's scout · ${loc.name.en}`;
  const existing = childNamed(d.tree, d.stages.scouting, title);
  if (existing) return existing;
  await seedLocation(d, STATION, { sets: false });
  const id = await d.tree.create(d.stages.scouting, title, d.projectId, { templateId: BUILTIN_CREATIVE_SCOUT });
  await d.tree.setSetting(id, 'entity', { kind: 'scouting' });
  const url = await d.photo(id, 'estacion-anden');
  const ref = await d.photo(id, 'referencia-1903');
  // Ficha: Date, Location, Attendees; las notas de dirección debajo de su título.
  const attendees = d.lang === 'es' ? 'Dirección, fotografía, arte' : 'Director, DP, art';
  const notes = d.lang === 'es' ? 'El andén de noche, con niebla. El reloj se ve desde el banco.' : 'The platform at night, with fog. The clock is seen from the bench.';
  const blocks = fill(builtinBlocks('creativeScout', d.lang), [shootDate(-7), loc.name[d.lang], attendees]);
  const refNote = d.lang === 'es' ? 'Referencia: El gran robo del tren (1903).' : 'Reference: The Great Train Robbery (1903).';
  await d.write(id, afterNotes(blocks, [para(notes), ...(url ? [image(url)] : []), ...(ref ? [para(refNote), image(ref)] : [])]));
  return id;
}

/** Lo que usan las funciones del plan y del reporte (sin red: el proyecto de práctica no baja nada). */
function dayDeps(d: SeedDeps) {
  if (!d.docs) throw new Error('la siembra del día necesita los documentos del dispositivo');
  return { tree: d.tree, docs: d.docs, engine: { isMissingContent: async () => false } };
}

/** Las escenas que el desglose de práctica planea para hoy (el día 1). */
const todayScenes = () => SCRATCH_SCENES.filter((s) => s.date === 0);

/** El plan del día 1 (hoy), con sus escenas, si falta (capítulo 7). */
export async function seedPlan(d: SeedDeps): Promise<string> {
  const mine = d.tree.children(d.stages.shoot).find((r) => live(d.tree, r.id) && (r.settings?.entity as { kind?: string } | undefined)?.kind === 'plan');
  if (mine) return mine.id;
  const { planDayReport, createDayPlan } = await import('../templates/dayReportCreate');
  const deps = dayDeps(d);
  const plan = await planDayReport(deps, { parentId: d.stages.shoot, projectId: d.projectId });
  const place = SCRATCH_LOCATIONS.find((l) => l.key === STATION)!.name[d.lang];
  const scenes = [];
  for (const s of todayScenes()) scenes.push({ code: s.code, pageId: await seedScene(d, s.code), name: s.name[d.lang] });
  return createDayPlan(deps, plan, { date: shootDate(0), day: 1, location: place }, d.lang, { scenes });
}

/** El reporte del día 1 (hoy), con una sección por escena como *Add a section for each planned scene*, si falta (capítulo 8). */
export async function seedReport(d: SeedDeps): Promise<string> {
  const { pageKind } = await import('../relations/kind');
  const mine = d.tree.children(d.stages.shoot).find((r) => live(d.tree, r.id) && pageKind(d.tree, r.id).kind === 'day');
  if (mine) return mine.id;
  const { planDayReport, reportBlocks, writeNewPage } = await import('../templates/dayReportCreate');
  const { newDayTitle } = await import('../templates/dayReport');
  const { sectionBlocks, sectionsSpot } = await import('../relations/prepareDay');
  const deps = dayDeps(d);
  const plan = await planDayReport(deps, { parentId: d.stages.shoot, projectId: d.projectId });
  const place = SCRATCH_LOCATIONS.find((l) => l.key === STATION)!.name[d.lang];
  const input = { date: shootDate(0), day: 1, location: place };
  const id = await d.tree.create(d.stages.shoot, newDayTitle(null, input.date, input.day, d.lang, place), d.projectId, { templateId: BUILTIN_ONSET });
  const scenes = [];
  for (const s of todayScenes()) scenes.push({ code: s.code, pageId: await seedScene(d, s.code) });
  const base = reportBlocks(plan, input, d.lang, null);
  const at = sectionsSpot(base, new Set(), 2);
  const word = d.lang === 'es' ? 'Escena' : 'Scene';
  // Una foto del set en la sección de la primera escena: la cabecera de la escena la muestra como «del reporte».
  const set = await d.photo(id, 'rodaje');
  const sections = scenes.flatMap((x, i) => {
    const b = sectionBlocks(x, word, 2);
    return i === 0 && set ? [b[0], para(d.lang === 'es' ? 'Toma 3 buena. La niebla entra desde la izquierda.' : 'Take 3 good. The fog comes in from the left.'), image(set)] : b;
  });
  const blocks = [...base.slice(0, at), ...sections, ...base.slice(at)] as TemplateBlock[];
  await writeNewPage(deps.docs, id, blocks);
  return id;
}

/** La siembra sobre el proyecto de práctica del recorrido (src/tour/world.ts): escribe como la app y sube las fotos. */
export async function seedDepsOf(w: {
  tree: PageTree;
  projectId: string;
  stages: Record<Stage, string>;
  lang: 'en' | 'es';
  docs?: Parameters<typeof import('../templates/dayReportCreate').writeNewPage>[0];
  media?: { readonly enabled: boolean; add(pageId: string, file: Blob & { name?: string }): Promise<string> };
}): Promise<SeedDeps> {
  const { writeNewPage } = await import('../templates/dayReportCreate');
  const docs = w.docs;
  if (!docs) throw new Error('el proyecto de práctica no tiene documentos para escribir');
  return {
    tree: w.tree,
    projectId: w.projectId,
    stages: w.stages,
    lang: w.lang,
    docs,
    write: async (pageId, blocks) => void (await writeNewPage(docs, pageId, blocks)),
    photo: async (pageId, name) => {
      if (!w.media?.enabled) return null;
      try {
        const res = await fetch(`/tour/img/${name}.webp`);
        if (!res.ok) return null;
        const blob = await res.blob();
        return await w.media.add(pageId, new File([blob], `${name}.webp`, { type: 'image/webp' }));
      } catch (err) {
        // Sin la foto, la página igual se crea (el recorrido sigue).
        console.warn('[recorrido] no se pudo agregar la foto', name, err);
        return null;
      }
    },
  };
}
