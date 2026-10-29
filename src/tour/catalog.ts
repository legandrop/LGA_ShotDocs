import type { Key } from '../i18n';
import { createStageFolders, type Stage } from '../relations/projectStructure';
import type { PageTree } from '../sync/tree';
import { TOUR_STEPS, type TourStep } from '../tutorial/steps';
import { conditionErrors, STAGES, type Condition } from './conditions';

// El catálogo de los recorridos (Docs/Plan_Proyecto_Desde_Cero.md, sección 6; el formato sigue al de las apps LGA de
// escritorio, skill «lga-tuto-walkthru»): recorrido → capítulos → pasos.
//
// CÓMO SE AGREGA UN CAPÍTULO
//
// 1. Un objeto en `CHAPTERS` con `id` (`área.tema`, único), `version` (1; se sube cuando el contenido cambia lo
//    bastante como para que valga volver a verlo: quien lo vio lo ve «Updated»), `title` y `summary` en los dos idiomas,
//    `minutes`, `needs` (lo que tiene que existir del capítulo anterior, ids de `STATES`) y `steps`.
// 2. Su id en la lista `chapters` del recorrido, en orden. Un capítulo vive una vez y puede estar en varios recorridos.
//    Un capítulo sin pasos se muestra «Coming soon» en la ayuda y el motor lo saltea.
// 3. Cada paso (`TourStep`, src/tutorial/steps.ts) tiene `id` (`capítulo.paso`, único en todo el catálogo), `mode`,
//    `title` y `text` ({ en, es } o una clave del diccionario; `**negrita**` vale) y `anchor`:
//    - `info`: explica; *Next* prendido. Lo de la app queda tapado (no se puede tocar).
//    - `do`: el usuario hace la acción de verdad en la app. Lleva `turn` (lo que hay que hacer, que el globo muestra
//      después de «Do this:») y `until` (la condición, de `conditions.ts`). Cuando la condición se cumple, el globo dice
//      «Done» medio segundo y avanza solo. *Next* queda gris y nunca hace la acción. Lo que hay que mirar del resultado va
//      en un `info` que sigue.
//    - `card`: tarjeta centrada (sin ancla). La primera de un capítulo lo presenta; la última del recorrido lo cierra.
//    Anclas: `{ tour: 'nombre' }` (un `data-tour="nombre"` puesto a propósito en el componente, nunca una clase de CSS),
//    `{ blocks: [...] }` (bloques de la página de práctica) o `{ page: ['scenes', …] }` (las filas del árbol de las
//    carpetas de esas etapas, en el proyecto de práctica). Si el ancla no está a la vista, el globo va al centro y el
//    recorrido no se traba. `drawer: true` abre el cajón del teléfono (el árbol, el selector, el Overview).
// 4. Si el capítulo trabaja sobre lo que dejó el anterior, cada cosa va en `needs` con un estado de `STATES`: `check`
//    (una condición: solo lee) y `make` (lo crea con las mismas funciones que usa la app). Con *Skip chapter* o entrando
//    por un capítulo del medio, el motor fabrica solo lo que falta. Sin eso, el capítulo arranca en un mundo vacío y se
//    traba en su primera acción.
// 5. `npx vitest run src/tour` valida el catálogo: ids únicos, textos en los dos idiomas, condiciones conocidas,
//    requisitos que existen, anclas que existen en el código (o anotadas como pendientes).

/** Un texto en los dos idiomas, o una clave del diccionario (los pasos de *Getting around*). */
export type Text = Key | Bi;
export interface Bi {
  en: string;
  es: string;
}

export interface TourDef {
  id: string;
  title: Bi;
  summary: Bi;
  /** `app`: corre en la app, en la página de práctica (`/practice`). `doc`: en el documento de práctica aparte (tour.html). */
  where: 'app' | 'doc';
  chapters: string[];
}

export interface ChapterDef {
  id: string;
  version: number;
  title: Bi;
  summary: Bi;
  minutes: number;
  /** Lo que tiene que existir antes (ids de `STATES`). */
  needs?: string[];
  steps: TourStep[];
}

/** El proyecto de práctica, como lo ven los requisitos (src/tour/world.ts). */
export interface NeedWorld {
  tree: PageTree;
  projectId: string;
  stages: Record<Stage, string>;
  lang: 'en' | 'es';
  /** Para escribir las páginas que siembra un requisito (*A project from scratch*); las pruebas del motor no los pasan. */
  docs?: DocsLike;
  media?: MediaLike;
}

/** Lo que usa la siembra de los documentos y de las fotos del dispositivo (`Services['docs']`, `Services['media']`). */
type DocsLike = Parameters<typeof import('../templates/dayReportCreate').writeNewPage>[0];
interface MediaLike {
  readonly enabled: boolean;
  add(pageId: string, file: Blob & { name?: string }): Promise<string>;
}

export interface NeedState {
  label: Bi;
  /** Otros estados que tienen que existir antes de fabricar este. */
  needs?: string[];
  /** Si ya existe (solo lee). */
  check: Condition;
  /** Lo crea, con las mismas funciones que usa la app. */
  make: (world: NeedWorld) => Promise<void>;
}

export const STATES: Record<string, NeedState> = {
  stageFolders: {
    label: { en: 'The stage folders', es: 'Las carpetas de las etapas' },
    check: { what: 'stageFolders' },
    // Lo que está en la papelera vuelve (como *Restore*); si faltara alguna, se arman de nuevo (*New project*).
    make: async (w) => {
      if (STAGES.every((s) => w.tree.get(w.stages[s]))) {
        for (const s of STAGES) if (w.tree.isTrashed(w.stages[s])) await w.tree.restore(w.stages[s]);
      } else w.stages = await createStageFolders(w.tree, w.projectId, w.lang);
    },
  },
  // Lo de «El último tren» que hace cada capítulo a mano, por si se entra salteándolo (src/tour/scratchData.ts; se carga
  // recién al usarlo, con las plantillas de fábrica).
  firstScene: {
    label: { en: 'The first scene', es: 'La primera escena' },
    needs: ['stageFolders'],
    check: { what: 'pages', kind: 'scene' },
    make: (w) => seed(w, (m, d) => m.seedScene(d, '001', { location: false })),
  },
  firstLocation: {
    label: { en: 'Its location', es: 'Su locación' },
    needs: ['firstScene'],
    check: { what: 'pages', kind: 'location' },
    make: (w) => seed(w, (m, d) => m.seedLocation(d, 'station', { sets: false })),
  },
  firstSet: {
    label: { en: 'Its set', es: 'Su decorado' },
    needs: ['firstLocation'],
    check: { what: 'pages', kind: 'set' },
    make: (w) => seed(w, (m, d) => m.seedSet(d, 'station', 'platform')),
  },
  twentyScenes: {
    label: { en: 'The twenty scenes', es: 'Las veinte escenas' },
    needs: ['stageFolders'],
    check: { what: 'pages', kind: 'scene', min: 20 },
    make: (w) => seed(w, (m, d) => m.seedScenes(d)),
  },
  // El scouting tiene que nombrar su locación (si no, la cabecera del capítulo 9 no lo muestra): lo dice el índice de las
  // relaciones, que el motor espera un momento después de sembrar. El plan y el reporte los marca la siembra en el árbol.
  scouting: {
    label: { en: 'A scouting of the station', es: 'Un scouting de la estación' },
    needs: ['twentyScenes'],
    check: { what: 'related', link: 'scouted' },
    make: (w) => seed(w, (m, d) => m.seedScouting(d)),
  },
  dayPlan: {
    label: { en: "Today's plan", es: 'El plan de hoy' },
    needs: ['twentyScenes'],
    check: { what: 'marked', doc: 'plan' },
    make: (w) => seed(w, (m, d) => m.seedPlan(d)),
  },
  dayReport: {
    label: { en: "Today's report", es: 'El reporte de hoy' },
    needs: ['dayPlan'],
    check: { what: 'pages', kind: 'day' },
    make: (w) => seed(w, (m, d) => m.seedReport(d)),
  },
};

/** Siembra con lo de scratchData.ts sobre el proyecto de práctica. */
async function seed(w: NeedWorld, run: (m: typeof import('./scratchData'), d: import('./scratchData').SeedDeps) => Promise<unknown>): Promise<void> {
  const m = await import('./scratchData');
  await run(m, await m.seedDepsOf(w));
}

const step = (id: string): TourStep => {
  const found = TOUR_STEPS.find((s) => s.id === id);
  if (!found) throw new Error(`paso desconocido: ${id}`);
  return found;
};

// --- Getting around: la recorrida de la app, sobre la página de práctica ------------------------------------

const AROUND: ChapterDef[] = [
  {
    id: 'around.pages',
    version: 1,
    title: { en: 'Pages and projects', es: 'Páginas y proyectos' },
    summary: { en: 'The practice page, the page tree and the project switcher.', es: 'La página de práctica, el árbol de páginas y el selector de proyectos.' },
    minutes: 1,
    steps: [step('hello'), step('pages'), step('project-switcher')],
  },
  {
    id: 'around.editor',
    version: 1,
    title: { en: 'Writing on a page', es: 'Escribir en una página' },
    summary: { en: 'The / menu, photos, comments, find and the page menu.', es: 'El menú /, las fotos, los comentarios, buscar y el menú de la página.' },
    minutes: 2,
    steps: [step('slash'), step('practice-photos'), step('comments'), step('find'), step('page-menu')],
  },
  {
    id: 'around.saved',
    version: 1,
    title: { en: 'Always saved', es: 'Siempre guardado' },
    summary: { en: 'Syncing, offline, and where the help is.', es: 'La sincronización, sin red, y dónde está la ayuda.' },
    minutes: 1,
    steps: [step('sync'), step('help')],
  },
];

// --- A project from scratch: en el documento de práctica, con un proyecto nuevo -----------------------------

const SIDEBAR = ['right', 'below', 'above', 'left'] as const;

const SCRATCH: ChapterDef[] = [
  {
    id: 'scratch.empty',
    version: 1,
    title: { en: 'The empty project', es: 'El proyecto vacío' },
    summary: {
      en: 'What each folder in Pages is for, and what the Overview does.',
      es: 'Para qué es cada carpeta de Páginas y qué hace el Panorama.',
    },
    minutes: 2,
    needs: ['stageFolders'],
    steps: [
      {
        id: 'scratch.empty.hello',
        mode: 'card',
        anchor: null,
        layout: 'all',
        title: { en: 'A project from scratch', es: 'Un proyecto desde cero' },
        text: {
          en: "This is a practice project, apart from yours: nothing you do here is saved or seen by anyone. A new project starts like this, with an empty folder for each stage.",
          es: 'Este es un proyecto de práctica, aparte de los tuyos: lo que hagas acá no se guarda ni lo ve nadie. Un proyecto nuevo arranca así, con una carpeta vacía por etapa.',
        },
      },
      {
        id: 'scratch.empty.prepro',
        mode: 'info',
        anchor: { page: ['prepro', 'scenes', 'locations'] },
        layout: 'all',
        drawer: true,
        sides: [...SIDEBAR],
        title: { en: 'Preproduction', es: 'Preproducción' },
        text: {
          en: '**Scenes** gets one page per scene, with its number and name. **Locations**, one page per real place. Each scene says its location and its set.',
          es: 'En **Escenas** va una página por escena, con su número y su nombre. En **Locaciones**, una por cada lugar real. Cada escena dice su locación y su decorado.',
        },
      },
      {
        id: 'scratch.empty.stages',
        mode: 'info',
        anchor: { page: ['scouting', 'tests', 'shoot'] },
        layout: 'all',
        drawer: true,
        sides: [...SIDEBAR],
        title: { en: 'One folder per stage', es: 'Una carpeta por etapa' },
        text: {
          en: '**Scouting reports**, **Tests and previs** and **Shoot** hold what each stage leaves behind. In Shoot, every day has its plan and its report.',
          es: '**Scouting reports**, **Pruebas y previs** y **Rodaje** guardan lo que deja cada etapa. En Rodaje, cada día tiene su plan y su reporte.',
        },
      },
      {
        id: 'scratch.empty.rest',
        mode: 'info',
        anchor: { page: ['references', 'archive'] },
        layout: 'all',
        drawer: true,
        sides: [...SIDEBAR],
        title: { en: 'References and Archive', es: 'Referencias y Archivo' },
        text: {
          en: '**References** is for everything else. What goes into **Archive** stays out of the Overview.',
          es: '**Referencias** es para todo lo demás. Lo que va a **Archivo** queda fuera del Panorama.',
        },
      },
      {
        // En un proyecto vacío el Overview todavía no se ve en la barra (aparece con la primera escena, locación,
        // decorado o día): por eso se explica acá y se abre en un capítulo que siga.
        id: 'scratch.empty.overview',
        mode: 'info',
        anchor: { tour: 'overview' },
        layout: 'all',
        drawer: true,
        sides: [...SIDEBAR],
        title: { en: 'The Overview builds itself', es: 'El Panorama se arma solo' },
        text: {
          en: "Pages is what you write. Below it, the **Overview** gathers what all your pages say about each scene, location, set and shoot day, each part in a table. It shows up with your first scene, and you don't edit it.",
          es: 'Páginas es lo que escribís. Debajo, el **Panorama** junta lo que dicen todas tus páginas de cada escena, locación, decorado y día de rodaje, cada parte en una tabla. Aparece con tu primera escena, y no se edita.',
        },
      },
      {
        id: 'scratch.empty.openScenes',
        mode: 'do',
        anchor: { page: ['scenes'] },
        layout: 'all',
        drawer: true,
        sides: [...SIDEBAR],
        title: { en: 'Where it starts', es: 'Por dónde se empieza' },
        text: {
          en: 'A project starts with its scenes: everything else hangs from them.',
          es: 'Un proyecto empieza por sus escenas: todo lo demás cuelga de ellas.',
        },
        turn: { en: 'open **Scenes**', es: 'abrí **Escenas**' },
        until: { what: 'open', stage: 'scenes' },
      },
      {
        id: 'scratch.empty.end',
        mode: 'card',
        anchor: null,
        layout: 'all',
        title: { en: 'Write in Pages, read in the Overview', es: 'Escribís en Páginas, leés en el Panorama' },
        text: {
          en: 'That is the whole idea: you write each thing once, in its page, and the Overview gathers it for the whole crew.',
          es: 'Esa es toda la idea: cada cosa se escribe una vez, en su página, y el Panorama la junta para todo el equipo.',
        },
      },
    ],
  },
  {
    id: 'scratch.firstScene',
    version: 1,
    title: { en: 'The first scene', es: 'La primera escena' },
    summary: { en: 'New scene, its number and name, and its card.', es: 'New scene, el número y el nombre, y su ficha.' },
    minutes: 2,
    needs: ['stageFolders'],
    steps: [
      {
        id: 'scratch.firstScene.hello',
        mode: 'card',
        anchor: null,
        layout: 'all',
        title: { en: 'The first scene', es: 'La primera escena' },
        text: {
          en: 'Each scene is a page inside **Scenes**. The app gives it a number; you give it a name.',
          es: 'Cada escena es una página adentro de **Escenas**. La app le pone el número; vos, el nombre.',
        },
      },
      {
        id: 'scratch.firstScene.open',
        mode: 'do',
        anchor: { page: ['scenes'] },
        layout: 'all',
        drawer: true,
        sides: [...SIDEBAR],
        title: { en: 'Scenes', es: 'Escenas' },
        text: { en: 'Everything about the scenes starts here.', es: 'Todo lo de las escenas empieza acá.' },
        turn: { en: 'open **Scenes**', es: 'abrí **Escenas**' },
        until: { what: 'open', stage: 'scenes' },
      },
      {
        id: 'scratch.firstScene.new',
        mode: 'do',
        anchor: { tour: 'scenes-new' },
        layout: 'all',
        title: { en: 'A new scene', es: 'Una escena nueva' },
        text: {
          en: 'The Scenes page has its own button, and below it a table that fills itself.',
          es: 'La página de Escenas tiene su botón, y debajo una tabla que se llena sola.',
        },
        turn: { en: 'click **New scene**', es: 'un clic en **Nueva escena**' },
        until: { what: 'pages', kind: 'scene' },
      },
      {
        id: 'scratch.firstScene.code',
        mode: 'info',
        anchor: { tour: 'scene-title-code' },
        layout: 'all',
        sides: ['below', 'right', 'above'],
        title: { en: 'The number', es: 'El número' },
        text: {
          en: 'The app proposes the next free number, in gray. A click on it lets you change it.',
          es: 'La app propone el número siguiente libre, en gris. Un clic encima lo deja cambiar.',
        },
      },
      {
        id: 'scratch.firstScene.name',
        mode: 'do',
        anchor: { tour: 'scene-title-name' },
        layout: 'all',
        sides: ['below', 'right', 'above'],
        title: { en: 'The name', es: 'El nombre' },
        text: { en: 'A short name, the way the crew calls the scene.', es: 'Un nombre corto, como le dice el equipo a la escena.' },
        turn: { en: 'type a name, for example **Platform at night**, and press **Enter**', es: 'escribí un nombre, por ejemplo **Andén de noche**, y apretá **Enter**' },
        until: { what: 'named', kind: 'scene' },
      },
      {
        id: 'scratch.firstScene.fields',
        mode: 'info',
        anchor: { fields: true },
        layout: 'all',
        sides: ['right', 'below', 'above'],
        title: { en: 'Its card', es: 'Su ficha' },
        text: {
          en: 'The scene card: its location, its set, INT/EXT and the planned date. Below go the notes, the questions for each department and the shots.',
          es: 'La ficha de la escena: su locación, su decorado, INT/EXT y la fecha planeada. Debajo van las notas, las preguntas a cada departamento y los planos.',
        },
      },
      {
        id: 'scratch.firstScene.overview',
        mode: 'info',
        anchor: { tour: 'overview-scenes' },
        layout: 'all',
        drawer: true,
        sides: [...SIDEBAR],
        title: { en: 'Already in the Overview', es: 'Ya está en el Panorama' },
        text: {
          en: 'You did not copy it anywhere: the Overview and the Scenes table already list it.',
          es: 'No la copiaste a ningún lado: el Panorama y la tabla de Escenas ya la muestran.',
        },
      },
    ],
  },
  {
    id: 'scratch.location',
    version: 1,
    title: { en: 'Its location', es: 'Su locación' },
    summary: { en: 'Named in the scene; its page is created from there.', es: 'Se nombra en la escena y su página se crea desde ahí.' },
    minutes: 2,
    needs: ['firstScene'],
    steps: [
      {
        id: 'scratch.location.hello',
        mode: 'card',
        anchor: null,
        layout: 'all',
        title: { en: 'Its location', es: 'Su locación' },
        text: {
          en: 'A location is a real place where you shoot. You write it in the scene, and the app offers to create its page.',
          es: 'Una locación es un lugar real donde se filma. Se escribe en la escena, y la app ofrece crear su página.',
        },
      },
      {
        id: 'scratch.location.openScene',
        mode: 'do',
        anchor: { page: ['scenes'] },
        layout: 'all',
        drawer: true,
        sides: [...SIDEBAR],
        title: { en: 'The scene', es: 'La escena' },
        text: { en: 'It all starts in the scene.', es: 'Todo empieza en la escena.' },
        turn: { en: 'open your scene, inside **Scenes**', es: 'abrí tu escena, adentro de **Escenas**' },
        until: { what: 'openKind', kind: 'scene' },
      },
      {
        id: 'scratch.location.type',
        mode: 'do',
        anchor: { fields: true },
        layout: 'all',
        sides: ['right', 'below', 'above'],
        title: { en: 'Where it is shot', es: 'Dónde se filma' },
        text: {
          en: 'The location goes in the scene card, in plain text.',
          es: 'La locación va en la ficha de la escena, como texto.',
        },
        turn: { en: 'in **Location (planned)**, type **Old Station**', es: 'en **Locación (planeada)**, escribí **Estación Vieja**' },
        until: { what: 'shown', anchor: 'scene-create-location' },
      },
      {
        id: 'scratch.location.create',
        mode: 'do',
        anchor: { tour: 'scene-create-location' },
        layout: 'all',
        sides: ['below', 'right', 'above'],
        title: { en: 'Its page', es: 'Su página' },
        text: {
          en: 'The header of the scene noticed a location that has no page yet.',
          es: 'La cabecera de la escena vio una locación que todavía no tiene página.',
        },
        turn: { en: 'click **Create page**', es: 'un clic en **Crear la página**' },
        until: { what: 'pages', kind: 'location' },
      },
      {
        id: 'scratch.location.folder',
        mode: 'info',
        anchor: { page: ['locations'] },
        layout: 'all',
        drawer: true,
        sides: [...SIDEBAR],
        title: { en: 'In Locations', es: 'En Locaciones' },
        text: {
          en: 'The page went into **Locations**, with its own card. **New location** on that folder creates more.',
          es: 'La página quedó en **Locaciones**, con su ficha. **Nueva locación** en esa carpeta crea otras.',
        },
      },
      {
        id: 'scratch.location.overview',
        mode: 'info',
        anchor: { tour: 'overview-locations' },
        layout: 'all',
        drawer: true,
        sides: [...SIDEBAR],
        title: { en: 'And in the Overview', es: 'Y en el Panorama' },
        text: {
          en: 'The location now knows its scene: both are linked, without you linking anything.',
          es: 'La locación ya sabe cuál es su escena: quedaron unidas sin que unieras nada.',
        },
      },
    ],
  },
  {
    id: 'scratch.set',
    version: 1,
    title: { en: 'The set', es: 'El decorado' },
    summary: { en: 'What the story shows, inside its location.', es: 'Lo que muestra la historia, adentro de su locación.' },
    minutes: 2,
    needs: ['firstLocation'],
    steps: [
      {
        id: 'scratch.set.hello',
        mode: 'card',
        anchor: null,
        layout: 'all',
        title: { en: 'The set', es: 'El decorado' },
        text: {
          en: 'The location is where you shoot; the set is what the story shows there: the platform, the waiting room. A set lives inside its location.',
          es: 'La locación es dónde se filma; el decorado, lo que la historia muestra ahí: el andén, la sala de espera. Un decorado vive adentro de su locación.',
        },
      },
      {
        id: 'scratch.set.openScene',
        mode: 'do',
        anchor: { page: ['scenes'] },
        layout: 'all',
        drawer: true,
        sides: [...SIDEBAR],
        title: { en: 'Back to the scene', es: 'De vuelta a la escena' },
        text: { en: 'The set is also written in the scene.', es: 'El decorado también se escribe en la escena.' },
        turn: { en: 'open your scene again', es: 'abrí tu escena otra vez' },
        until: { what: 'openKind', kind: 'scene' },
      },
      {
        id: 'scratch.set.type',
        mode: 'do',
        anchor: { fields: true },
        layout: 'all',
        sides: ['right', 'below', 'above'],
        title: { en: 'Its set', es: 'Su decorado' },
        text: { en: 'Right below the location.', es: 'Justo debajo de la locación.' },
        turn: { en: 'in **Set**, type **Platform**', es: 'en **Decorado**, escribí **Andén**' },
        until: { what: 'shown', anchor: 'scene-create-set' },
      },
      {
        id: 'scratch.set.create',
        mode: 'do',
        anchor: { tour: 'scene-create-set' },
        layout: 'all',
        sides: ['below', 'right', 'above'],
        title: { en: 'Its page, inside the location', es: 'Su página, adentro de la locación' },
        text: {
          en: 'The set page is created inside the scene location.',
          es: 'La página del decorado se crea adentro de la locación de la escena.',
        },
        turn: { en: 'click **Create page**', es: 'un clic en **Crear la página**' },
        until: { what: 'pages', kind: 'set' },
      },
      {
        id: 'scratch.set.openLocation',
        mode: 'do',
        anchor: { tour: 'live-header' },
        layout: 'all',
        sides: ['below', 'left', 'above'],
        title: { en: 'Inside its location', es: 'Adentro de su locación' },
        text: {
          en: 'The set page went inside **Old Station**, in Locations. Go to the location: the link is right here.',
          es: 'La página del decorado quedó adentro de **Estación Vieja**, en Locaciones. Andá a la locación: el link está acá.',
        },
        turn: { en: 'open **Old Station**', es: 'abrí **Estación Vieja**' },
        until: { what: 'openKind', kind: 'location' },
      },
      {
        id: 'scratch.set.header',
        mode: 'info',
        anchor: { tour: 'live-header' },
        layout: 'all',
        sides: ['below', 'left', 'above'],
        title: { en: 'The location gathers them', es: 'La locación las junta' },
        text: {
          en: 'Its header already shows the scene planned here and its set. **New set**, here, creates more sets inside it.',
          es: 'Su cabecera ya muestra la escena que se planea acá y su decorado. **Nuevo decorado**, acá, crea otros adentro.',
        },
      },
      {
        id: 'scratch.set.end',
        mode: 'card',
        anchor: null,
        layout: 'all',
        title: { en: 'Three things, all linked', es: 'Tres cosas, todas unidas' },
        text: {
          en: 'You wrote a scene, its location and its set. The app already knows what is shot where, and the Overview shows it.',
          es: 'Escribiste una escena, su locación y su decorado. La app ya sabe qué se filma dónde, y el Panorama lo muestra.',
        },
      },
    ],
  },
  {
    id: 'scratch.jump',
    version: 1,
    title: { en: 'Twenty scenes later', es: 'Veinte escenas después' },
    summary: { en: 'The Scenes and Locations tables, full.', es: 'Las tablas de Escenas y Locaciones, llenas.' },
    minutes: 2,
    needs: ['twentyScenes'],
    steps: [
      {
        id: 'scratch.jump.hello',
        mode: 'card',
        anchor: null,
        layout: 'all',
        title: { en: 'Twenty scenes later', es: 'Veinte escenas después' },
        text: {
          en: 'Let us jump ahead: the twenty scenes of the short film are already written, each with its location and its set, the same way you did the first one.',
          es: 'Saltamos en el tiempo: las veinte escenas del corto ya están escritas, cada una con su locación y su decorado, igual que hiciste la primera.',
        },
      },
      {
        id: 'scratch.jump.openScenes',
        mode: 'do',
        anchor: { page: ['scenes'] },
        layout: 'all',
        drawer: true,
        sides: [...SIDEBAR],
        title: { en: 'Scenes', es: 'Escenas' },
        text: { en: 'Look at the Scenes page now.', es: 'Mirá ahora la página de Escenas.' },
        turn: { en: 'open **Scenes**', es: 'abrí **Escenas**' },
        until: { what: 'open', stage: 'scenes' },
      },
      {
        id: 'scratch.jump.scenesTable',
        mode: 'info',
        anchor: { tour: 'scenes-table' },
        layout: 'all',
        sides: ['above', 'left', 'below'],
        title: { en: 'The table fills itself', es: 'La tabla se llena sola' },
        text: {
          en: 'Photo, number, name, location and set of every scene, read from each page. Drag the edge of a column to widen it.',
          es: 'Foto, número, nombre, locación y decorado de cada escena, leídos de cada página. Arrastrá el borde de una columna para agrandarla.',
        },
      },
      {
        id: 'scratch.jump.openLocations',
        mode: 'do',
        anchor: { page: ['locations'] },
        layout: 'all',
        drawer: true,
        sides: [...SIDEBAR],
        title: { en: 'Locations', es: 'Locaciones' },
        text: { en: 'The same, from the side of the places.', es: 'Lo mismo, del lado de los lugares.' },
        turn: { en: 'open **Locations**', es: 'abrí **Locaciones**' },
        until: { what: 'open', stage: 'locations' },
      },
      {
        id: 'scratch.jump.locationsTable',
        mode: 'info',
        anchor: { tour: 'locations-table' },
        layout: 'all',
        sides: ['above', 'left', 'below'],
        title: { en: 'Each place, with its sets and scenes', es: 'Cada lugar, con sus decorados y escenas' },
        text: {
          en: 'Nobody typed this table: the sets come from the pages inside each location, the scenes from what each scene says.',
          es: 'Esta tabla no la escribió nadie: los decorados salen de las páginas adentro de cada locación; las escenas, de lo que dice cada escena.',
        },
      },
      {
        id: 'scratch.jump.openLocation',
        mode: 'do',
        anchor: { tour: 'locations-table' },
        layout: 'all',
        sides: ['above', 'left', 'below'],
        title: { en: 'One location', es: 'Una locación' },
        text: { en: 'Open one to see its header.', es: 'Abrí una para ver su cabecera.' },
        turn: { en: 'click **Old Station** in the table', es: 'un clic en **Estación Vieja** en la tabla' },
        until: { what: 'openKind', kind: 'location' },
      },
      {
        id: 'scratch.jump.header',
        mode: 'info',
        anchor: { tour: 'live-header' },
        layout: 'all',
        sides: ['below', 'left', 'above'],
        title: { en: 'Its header gathers everything', es: 'Su cabecera junta todo' },
        text: {
          en: 'The scenes planned here, its sets, its scoutings and its shoot days, with the photos. It updates as you write anywhere.',
          es: 'Las escenas planeadas acá, sus decorados, sus scoutings y sus días de rodaje, con las fotos. Se actualiza al escribir en cualquier página.',
        },
      },
    ],
  },
  {
    id: 'scratch.scouting',
    version: 1,
    title: { en: 'Scouting', es: 'Scouting' },
    summary: { en: 'A visit to the location, and how the location gathers it.', es: 'Una visita a la locación, y cómo la locación la junta.' },
    minutes: 3,
    needs: ['twentyScenes'],
    steps: [
      {
        id: 'scratch.scouting.hello',
        mode: 'card',
        anchor: null,
        layout: 'all',
        title: { en: 'Scouting', es: 'Scouting' },
        text: {
          en: 'Before shooting you visit the place: first with the director, then the technical scout. Each visit is a page in **Scouting reports**.',
          es: 'Antes de filmar se visita el lugar: primero con dirección, después el scouting técnico. Cada visita es una página en **Scouting reports**.',
        },
      },
      {
        id: 'scratch.scouting.new',
        mode: 'do',
        anchor: { page: ['scouting'] },
        layout: 'all',
        drawer: true,
        sides: [...SIDEBAR],
        title: { en: 'A new visit', es: 'Una visita nueva' },
        text: { en: 'A page inside Scouting reports.', es: 'Una página adentro de Scouting reports.' },
        turn: { en: 'on **Scouting reports**, click **+** (Add a page inside)', es: 'en **Scouting reports**, tocá **+** (Agregar una página adentro)' },
        until: { what: 'childIn', stage: 'scouting' },
      },
      {
        id: 'scratch.scouting.template',
        mode: 'do',
        anchor: { tour: 'template-strip' },
        layout: 'all',
        sides: ['below', 'right', 'above'],
        title: { en: 'Its template', es: 'Su plantilla' },
        text: {
          en: "The creative scout brings date, location, attendees, director's notes and the shots discussed.",
          es: 'El scouting creativo trae fecha, locación, asistentes, notas de dirección y los planos conversados.',
        },
        turn: { en: 'click **Creative scout**', es: 'tocá **Scouting creativo**' },
        until: { what: 'marked', doc: 'scouting' },
      },
      {
        id: 'scratch.scouting.location',
        mode: 'do',
        anchor: { fields: true },
        layout: 'all',
        sides: ['right', 'below', 'above'],
        title: { en: 'Where it was', es: 'Dónde fue' },
        text: {
          en: 'Writing the location is what links the visit to it. Write a title too, if you like.',
          es: 'Escribir la locación es lo que une la visita con ella. Ponele un título también, si querés.',
        },
        turn: { en: 'in **Location**, type **Old Station**', es: 'en **Locación**, escribí **Estación Vieja**' },
        until: { what: 'related', link: 'scouted' },
      },
      {
        id: 'scratch.scouting.notes',
        mode: 'info',
        anchor: { fields: true },
        layout: 'all',
        sides: ['right', 'below', 'above'],
        title: { en: 'Notes and photos', es: 'Notas y fotos' },
        text: {
          en: "Below go the director's notes, the shots you discussed and the photos you drop on the page. The technical scout is the same, with **Tech scout**.",
          es: 'Abajo van las notas de dirección, los planos que conversaron y las fotos que sueltes en la página. El scouting técnico es igual, con **Scouting técnico**.',
        },
      },
      {
        id: 'scratch.scouting.openLocation',
        mode: 'do',
        anchor: { fields: true },
        layout: 'all',
        sides: ['right', 'below', 'above'],
        title: { en: 'Now, the location', es: 'Ahora, la locación' },
        text: {
          en: 'The app recognized it: in the field it is underlined. You did not touch the location page.',
          es: 'La app la reconoció: en la ficha quedó subrayada. La página de la locación no la tocaste.',
        },
        turn: { en: 'rest the mouse on **Old Station** (or tap it) and click **Open Old Station**', es: 'dejá el mouse sobre **Estación Vieja** (o tocala) y tocá **Abrir Estación Vieja**' },
        until: { what: 'openKind', kind: 'location' },
      },
      {
        id: 'scratch.scouting.header',
        mode: 'info',
        anchor: { tour: 'live-header' },
        layout: 'all',
        sides: ['below', 'left', 'above'],
        title: { en: 'The visit is already here', es: 'La visita ya está acá' },
        text: {
          en: 'Its header shows your scouting, and its photos once it has some. Every scout that names this location shows up here, without copying anything.',
          es: 'Su cabecera muestra tu scouting, y sus fotos cuando las tenga. Todo scouting que nombre esta locación aparece acá, sin copiar nada.',
        },
      },
    ],
  },
  {
    id: 'scratch.plan',
    version: 1,
    title: { en: "The day's plan", es: 'El plan del día' },
    summary: { en: 'PLN: the scenes of the day and what each department needs.', es: 'PLN: las escenas del día y lo que necesita cada departamento.' },
    minutes: 3,
    needs: ['twentyScenes'],
    steps: [
      {
        id: 'scratch.plan.hello',
        mode: 'card',
        anchor: null,
        layout: 'all',
        title: { en: "The day's plan", es: 'El plan del día' },
        text: {
          en: 'Before each shoot day you write its plan: the scenes, the VFX needs and what you ask each department. It lives in **Shoot**, above its report.',
          es: 'Antes de cada jornada se escribe su plan: las escenas, lo que necesita VFX y lo que le pedís a cada departamento. Vive en **Rodaje**, arriba de su reporte.',
        },
      },
      {
        id: 'scratch.plan.openShoot',
        mode: 'do',
        anchor: { page: ['shoot'] },
        layout: 'all',
        drawer: true,
        sides: [...SIDEBAR],
        title: { en: 'Shoot', es: 'Rodaje' },
        text: { en: 'Plans and reports go here.', es: 'Acá van los planes y los reportes.' },
        turn: { en: 'open **Shoot**', es: 'abrí **Rodaje**' },
        until: { what: 'open', stage: 'shoot' },
      },
      {
        id: 'scratch.plan.button',
        mode: 'do',
        anchor: { tour: 'day-new' },
        layout: 'all',
        sides: ['below', 'left', 'above'],
        title: { en: 'A new day', es: 'Un día nuevo' },
        text: { en: 'The same button makes the plan and the report.', es: 'El mismo botón hace el plan y el reporte.' },
        turn: { en: 'click **New day report**', es: 'tocá **Nuevo reporte del día**' },
        until: { what: 'shown', anchor: 'day-popover' },
      },
      {
        id: 'scratch.plan.create',
        mode: 'do',
        anchor: { tour: 'day-popover' },
        layout: 'all',
        sides: ['left', 'below', 'above'],
        title: { en: 'Plan, for today', es: 'Plan, para hoy' },
        text: {
          en: 'The date, the day number and the location come proposed: the location is the one the breakdown plans for that date.',
          es: 'La fecha, el número de día y la locación vienen propuestos: la locación es la que el desglose planea para esa fecha.',
        },
        turn: { en: 'choose **New day plan** and click **Create**', es: 'elegí **Nuevo plan del día** y tocá **Crear**' },
        until: { what: 'marked', doc: 'plan' },
      },
      {
        id: 'scratch.plan.page',
        mode: 'info',
        anchor: { fields: true },
        layout: 'all',
        sides: ['right', 'below', 'above'],
        title: { en: 'It comes with its scenes', es: 'Viene con sus escenas' },
        text: {
          en: 'Below, **Scenes** already lists the ones the breakdown plans for today. **Art department** and **Post** are for what you ask each department.',
          es: 'Abajo, **Escenas** ya trae las que el desglose planea para hoy. **Arte** y **Post** son para lo que le pedís a cada departamento.',
        },
      },
      {
        id: 'scratch.plan.tree',
        mode: 'info',
        anchor: { page: ['shoot'] },
        layout: 'all',
        drawer: true,
        sides: [...SIDEBAR],
        title: { en: 'PLN, in amber', es: 'PLN, en ámbar' },
        text: {
          en: 'In Shoot, the plan shows **PLN**; its report will go right below, with **REP** in green.',
          es: 'En Rodaje, el plan se ve con **PLN**; su reporte va a ir justo debajo, con **REP** en verde.',
        },
      },
    ],
  },
  {
    id: 'scratch.report',
    version: 1,
    title: { en: "The day's report", es: 'El reporte del día' },
    summary: { en: 'REP: one section per scene, and the scene knows it was shot.', es: 'REP: una sección por escena, y la escena sabe que se filmó.' },
    minutes: 3,
    needs: ['dayPlan'],
    steps: [
      {
        id: 'scratch.report.hello',
        mode: 'card',
        anchor: null,
        layout: 'all',
        title: { en: "The day's report", es: 'El reporte del día' },
        text: {
          en: 'On set you write what was shot, scene by scene. The report is made from its plan.',
          es: 'En el set se escribe lo que se filmó, escena por escena. El reporte se hace desde su plan.',
        },
      },
      {
        id: 'scratch.report.openPlan',
        mode: 'do',
        anchor: { page: ['shoot'] },
        layout: 'all',
        drawer: true,
        sides: [...SIDEBAR],
        title: { en: 'Its plan', es: 'Su plan' },
        text: { en: 'The report starts from the plan of its day.', es: 'El reporte arranca desde el plan de su día.' },
        turn: { en: 'open the plan (**PLN**) in **Shoot**', es: 'abrí el plan (**PLN**) en **Rodaje**' },
        until: { what: 'openDoc', doc: 'plan' },
      },
      {
        id: 'scratch.report.button',
        mode: 'do',
        anchor: { tour: 'day-new' },
        layout: 'all',
        sides: ['below', 'left', 'above'],
        title: { en: 'From the plan', es: 'Desde el plan' },
        text: {
          en: 'With the plan open, the report proposes its date, its day and its location.',
          es: 'Con el plan abierto, el reporte propone su fecha, su día y su locación.',
        },
        turn: { en: 'on the plan, click **New day report**', es: 'en el plan, tocá **Nuevo reporte del día**' },
        until: { what: 'shown', anchor: 'day-popover' },
      },
      {
        id: 'scratch.report.create',
        mode: 'do',
        anchor: { tour: 'day-popover' },
        layout: 'all',
        sides: ['left', 'below', 'above'],
        title: { en: 'The report', es: 'El reporte' },
        text: { en: 'Everything is already proposed.', es: 'Ya está todo propuesto.' },
        turn: { en: 'click **Create**', es: 'tocá **Crear**' },
        until: { what: 'openKind', kind: 'day' },
      },
      {
        id: 'scratch.report.header',
        mode: 'info',
        anchor: { tour: 'live-header' },
        layout: 'all',
        sides: ['below', 'left', 'above'],
        title: { en: 'The day knows its scenes', es: 'El día sabe sus escenas' },
        text: {
          en: "Its header lists the scenes planned for today, from the plan, and tomorrow's.",
          es: 'Su cabecera lista las escenas planeadas para hoy, las del plan, y las de mañana.',
        },
      },
      {
        id: 'scratch.report.sections',
        mode: 'do',
        anchor: { tour: 'day-add-sections' },
        layout: 'all',
        sides: ['below', 'left', 'above'],
        title: { en: 'One section per scene', es: 'Una sección por escena' },
        text: {
          en: 'Each section is where you write what was shot of that scene: takes, data, notes and photos.',
          es: 'Cada sección es donde escribís lo que se filmó de esa escena: tomas, datos, notas y fotos.',
        },
        turn: { en: 'click **Add a section for each planned scene**', es: 'tocá **Agregar una sección por escena planeada**' },
        until: { what: 'related', link: 'reported' },
      },
      {
        id: 'scratch.report.tree',
        mode: 'info',
        anchor: { page: ['shoot'] },
        layout: 'all',
        drawer: true,
        sides: [...SIDEBAR],
        title: { en: 'PLN and REP', es: 'PLN y REP' },
        text: {
          en: 'The day now has its plan (**PLN**) and, below, its report (**REP**).',
          es: 'El día ya tiene su plan (**PLN**) y, debajo, su reporte (**REP**).',
        },
      },
    ],
  },
  {
    id: 'scratch.overview',
    version: 1,
    title: { en: 'The Overview for post', es: 'El Panorama para post' },
    summary: { en: 'How post finds everything about a scene.', es: 'Cómo postproducción encuentra todo lo de una escena.' },
    minutes: 2,
    needs: ['scouting', 'dayReport'],
    steps: [
      {
        id: 'scratch.overview.hello',
        mode: 'card',
        anchor: null,
        layout: 'all',
        title: { en: 'Months later, post', es: 'Meses después, post' },
        text: {
          en: 'Post asks: what was shot of scene 001, where, with which notes? You never wrote that in one place, but it is all together.',
          es: 'Postproducción pregunta: ¿qué se filmó de la escena 001, dónde, con qué notas? Nunca lo escribiste en un solo lugar, pero está todo junto.',
        },
      },
      {
        id: 'scratch.overview.open',
        mode: 'do',
        anchor: { tour: 'overview-scenes' },
        layout: 'all',
        drawer: true,
        sides: [...SIDEBAR],
        title: { en: 'Overview › Scenes', es: 'Panorama › Escenas' },
        text: { en: 'The Overview is read-only: it builds itself from your pages.', es: 'El Panorama es de solo lectura: se arma solo con tus páginas.' },
        turn: { en: 'click **Scenes** in the Overview', es: 'tocá **Escenas** en el Panorama' },
        until: { what: 'overview', part: 'scenes' },
      },
      {
        id: 'scratch.overview.table',
        mode: 'info',
        anchor: { tour: 'map-view' },
        layout: 'all',
        sides: ['left', 'below', 'above'],
        title: { en: 'Every scene, with everything', es: 'Cada escena, con todo' },
        text: {
          en: 'Each scene with its location (planned, or the one of a report), the days it was shot and its pages. **Shots** lists the shots of the whole project the same way.',
          es: 'Cada escena con su locación (la planeada, o la de un reporte), los días en que se filmó y sus páginas. **Planos** lista igual los planos de todo el proyecto.',
        },
      },
      {
        id: 'scratch.overview.scene',
        mode: 'do',
        anchor: { tour: 'map-view' },
        layout: 'all',
        sides: ['left', 'below', 'above'],
        title: { en: 'One scene', es: 'Una escena' },
        text: { en: 'Its page gathers the rest.', es: 'Su página junta el resto.' },
        turn: {
          en: 'in the row of **001**, click its **pages** and choose **001 | Platform at night**',
          es: 'en la fila de **001**, tocá sus **páginas** y elegí **001 | Andén de noche**',
        },
        until: { what: 'openKind', kind: 'scene' },
      },
      {
        id: 'scratch.overview.header',
        mode: 'info',
        anchor: { tour: 'live-header' },
        layout: 'all',
        sides: ['below', 'left', 'above'],
        title: { en: 'From breakdown to set', es: 'Del desglose al set' },
        text: {
          en: 'Its header goes by stage: what preproduction wrote, the scouting of its location, its plan and, under **Shoot**, what the report says. A click opens each part where it was written.',
          es: 'Su cabecera va por etapas: lo que escribió preproducción, el scouting de su locación, su plan y, en **Rodaje**, lo que dice el reporte. Un clic abre cada parte donde se escribió.',
        },
      },
      {
        id: 'scratch.overview.end',
        mode: 'card',
        anchor: null,
        layout: 'all',
        title: { en: 'That is all', es: 'Eso es todo' },
        text: {
          en: 'You write in **Pages**, each thing once; the headers, the tables and the **Overview** link it all by themselves.',
          es: 'Escribís en **Páginas**, cada cosa una vez; las cabeceras, las tablas y el **Panorama** unen todo solos.',
        },
      },
    ],
  },
];

export const CHAPTERS: ChapterDef[] = [...AROUND, ...SCRATCH];

export const TOURS: TourDef[] = [
  {
    id: 'getting-around',
    where: 'app',
    title: { en: 'Getting around', es: 'Lo básico' },
    summary: {
      en: 'The tree, the editor, photos, comments and syncing, on a practice page.',
      es: 'El árbol, el editor, las fotos, los comentarios y la sincronización, en una página de práctica.',
    },
    chapters: AROUND.map((c) => c.id),
  },
  {
    id: 'scratch',
    where: 'doc',
    title: { en: 'A project from scratch', es: 'Un proyecto desde cero' },
    summary: {
      en: 'Scenes, locations and sets, and how the Overview comes out of them, in a practice project.',
      es: 'Escenas, locaciones y decorados, y cómo sale de eso el Panorama, en un proyecto de práctica.',
    },
    chapters: SCRATCH.map((c) => c.id),
  },
];

export function tourById(id: string): TourDef | undefined {
  return TOURS.find((t) => t.id === id);
}

export function chapterById(id: string): ChapterDef | undefined {
  return CHAPTERS.find((c) => c.id === id);
}

/** Los pasos del capítulo para este diseño (computadora o teléfono). */
export function stepsOf(chapter: ChapterDef, phone: boolean): TourStep[] {
  return chapter.steps.filter((s) => s.layout === 'all' || s.layout === (phone ? 'phone' : 'desktop'));
}

/** Los capítulos del recorrido, en orden. */
export function chaptersOf(tour: TourDef): ChapterDef[] {
  return tour.chapters.map((id) => chapterById(id)).filter((c): c is ChapterDef => !!c);
}

/** Los minutos de un recorrido (los capítulos que ya tienen pasos). */
export function tourMinutes(tour: TourDef): number {
  return chaptersOf(tour).reduce((n, c) => n + (c.steps.length ? c.minutes : 0), 0);
}

// --- Validación ---------------------------------------------------------------------------------------------

const MODES = ['info', 'do', 'card'] as const;

function biErrors(text: unknown, where: string): string[] {
  if (typeof text === 'string') return text ? [] : [`${where}: texto vacío`];
  const t = text as Partial<Bi> | null;
  if (!t || typeof t !== 'object') return [`${where}: falta el texto`];
  return (['en', 'es'] as const).filter((l) => typeof t[l] !== 'string' || !t[l]!.trim()).map((l) => `${where}: falta el texto en ${l}`);
}

/**
 * Lo que está mal en un catálogo (vacío si está bien). Un catálogo con errores no se ofrece: la ayuda dice por qué.
 * Comprueba ids únicos, textos en los dos idiomas, modos y condiciones conocidas, requisitos que existen y que cada
 * recorrido nombre capítulos que existen, sin repetir.
 */
export function validateCatalog(tours: TourDef[], chapters: ChapterDef[], states: Record<string, NeedState>): string[] {
  const errors: string[] = [];
  const chapterIds = new Set<string>();
  const stepIds = new Set<string>();
  for (const [id, s] of Object.entries(states)) {
    errors.push(...biErrors(s.label, `estado ${id}`), ...conditionErrors(s.check, `estado ${id}`));
    for (const n of s.needs ?? []) if (!states[n]) errors.push(`estado ${id}: requisito desconocido «${n}»`);
  }
  for (const c of chapters) {
    if (chapterIds.has(c.id)) errors.push(`capítulo repetido: ${c.id}`);
    chapterIds.add(c.id);
    if (!Number.isInteger(c.version) || c.version < 1) errors.push(`${c.id}: la versión tiene que ser un entero desde 1`);
    if (!(c.minutes > 0)) errors.push(`${c.id}: faltan los minutos`);
    errors.push(...biErrors(c.title, `${c.id}.title`), ...biErrors(c.summary, `${c.id}.summary`));
    for (const n of c.needs ?? []) if (!states[n]) errors.push(`${c.id}: requisito desconocido «${n}»`);
    for (const s of c.steps) {
      const where = `${c.id} › ${s.id}`;
      if (stepIds.has(s.id)) errors.push(`paso repetido: ${s.id}`);
      stepIds.add(s.id);
      if (!MODES.includes(s.mode)) errors.push(`${where}: modo desconocido «${String(s.mode)}»`);
      errors.push(...biErrors(s.title, `${where}.title`), ...biErrors(s.text, `${where}.text`));
      if (s.mode === 'do') {
        errors.push(...biErrors(s.turn, `${where}.turn`), ...conditionErrors(s.until, `${where}.until`));
      } else if (s.until || s.turn) errors.push(`${where}: solo un paso «do» lleva until y turn`);
      if (s.mode === 'card' && s.anchor) errors.push(`${where}: una tarjeta no lleva ancla`);
      if (s.anchor && 'page' in s.anchor) {
        for (const st of s.anchor.page) if (!STAGES.includes(st)) errors.push(`${where}: etapa desconocida «${st}»`);
      }
    }
  }
  const tourIds = new Set<string>();
  for (const t of tours) {
    if (tourIds.has(t.id)) errors.push(`recorrido repetido: ${t.id}`);
    tourIds.add(t.id);
    errors.push(...biErrors(t.title, `${t.id}.title`), ...biErrors(t.summary, `${t.id}.summary`));
    if (t.where !== 'app' && t.where !== 'doc') errors.push(`${t.id}: where tiene que ser app o doc`);
    if (t.chapters.length === 0) errors.push(`${t.id}: sin capítulos`);
    if (new Set(t.chapters).size !== t.chapters.length) errors.push(`${t.id}: un capítulo repetido`);
    for (const id of t.chapters) if (!chapterIds.has(id)) errors.push(`${t.id}: capítulo desconocido «${id}»`);
  }
  return errors;
}

/** Los errores del catálogo de la app (vacío: está bien; lo comprueba una prueba). */
export const CATALOG_ERRORS = validateCatalog(TOURS, CHAPTERS, STATES);
