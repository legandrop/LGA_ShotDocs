import type { Language } from '../prefs';
import type { PageTree } from '../sync/tree';
import { markFolderHolds } from './entitySync';

// Las carpetas de las etapas con las que arranca todo proyecto nuevo, vacías y con su tipo (D817,
// Docs/Plan_Proyecto_Desde_Cero.md, sección 2). Los nombres van en el idioma de la interfaz al crearlo; después son
// páginas como cualquier otra (se renombran, se mueven o se borran).

export type Stage = 'prepro' | 'scenes' | 'locations' | 'scouting' | 'tests' | 'shoot' | 'references' | 'archive';

const NAMES: Record<Language, Record<Stage, string>> = {
  es: {
    prepro: '1 | Preproducción',
    scenes: '1.1 | Escenas',
    locations: '1.2 | Locaciones',
    scouting: '2 | Scouting reports',
    tests: '3 | Pruebas y previs',
    shoot: '4 | Rodaje',
    references: '5 | Referencias',
    archive: '90 | Archivo',
  },
  en: {
    prepro: '1 | Preproduction',
    scenes: '1.1 | Scenes',
    locations: '1.2 | Locations',
    scouting: '2 | Scouting reports',
    tests: '3 | Tests and previs',
    shoot: '4 | Shoot',
    references: '5 | References',
    archive: '90 | Archive',
  },
};

type Tree = Pick<PageTree, 'create' | 'get' | 'children' | 'isTrashed' | 'setSetting'>;

/** Crea las carpetas de las etapas en un proyecto (recién creado: no mira si ya hay algo) y devuelve sus ids. */
export async function createStageFolders(tree: Tree, projectId: string, lang: Language): Promise<Record<Stage, string>> {
  const name = NAMES[lang] ?? NAMES.en;
  const prepro = await tree.create(null, name.prepro, projectId);
  const scenes = await tree.create(prepro, name.scenes, projectId);
  await markFolderHolds(tree, scenes, 'scene');
  const locations = await tree.create(prepro, name.locations, projectId);
  await markFolderHolds(tree, locations, 'location');
  const scouting = await tree.create(null, name.scouting, projectId);
  await markFolderHolds(tree, scouting, 'scouting');
  const tests = await tree.create(null, name.tests, projectId);
  await markFolderHolds(tree, tests, 'test');
  const shoot = await tree.create(null, name.shoot, projectId);
  await markFolderHolds(tree, shoot, 'day');
  const references = await tree.create(null, name.references, projectId);
  const archive = await tree.create(null, name.archive, projectId);
  // Lo que se archiva no cuenta en las relaciones ni en el Overview.
  await tree.setSetting(archive, 'graph', false);
  return { prepro, scenes, locations, scouting, tests, shoot, references, archive };
}
