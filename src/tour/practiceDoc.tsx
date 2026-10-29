// El documento de práctica de los recorridos (tour.html; Docs/Plan_Proyecto_Desde_Cero.md, sección 6): la app de verdad
// (Shell) sobre el servidor en memoria de las pruebas (src/sync/testing.ts, como src/dev/simulacion.tsx), con un proyecto
// nuevo que arranca con las carpetas de sus etapas. Sin login, sin red y sin tocar nada de este dispositivo:
// - `isolate` (lo primero) deja `localStorage` y `sessionStorage` en memoria, y `fake-indexeddb/auto` pisa IndexedDB;
// - no se crea ningún cliente de Supabase (el de los servicios es un objeto vacío) y la dirección del workspace es una
//   que no existe (`.invalid`): ningún pedido puede llegar a la base ni al portero;
// - el historial queda en una sola entrada (cada `pushState` pasa a `replaceState`): Atrás del navegador sale del
//   recorrido a la página de donde se vino, y al salir no quedan direcciones de práctica en el historial;
// - si se recarga a mitad, la app real vuelve acá (src/tour/reload.ts), al principio del capítulo, y sus requisitos se
//   preparan solos.
// Se abre con `/tour.html?tour=<id>&chapter=<id>&back=<dirección de la app>`.
import './isolate';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import '../ui/drive.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/instrument-serif/latin-400.css';
import '@fontsource/courier-prime/latin-400.css';
import '@fontsource/courier-prime/latin-700.css';
import '../styles.css';
import { createRoot } from 'react-dom/client';
import { language } from '../i18n';
import { installNavHistory } from '../navHistory';
import { prefs } from '../prefs';
import { probeMedia, viewImage } from '../media/probe';
import { setLiveOpen } from '../relations/liveFold';
import { createStageFolders } from '../relations/projectStructure';
import { pagePath } from '../router';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { enterTourDocument, getTourUi, subscribeTourUi } from '../tutorial/tourState';
import { TooltipLayer } from '../ui/Tooltip';
import { Shell } from '../ui/Workspace';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { markTourDoc, safeBack, tourDocHref } from './reload';
import { setPracticeWorld } from './world';

function services(d: Device, userId: string): Services {
  const config = { url: 'https://practice.invalid', publishableKey: 'practice', name: 'Practice', localKey: WANKA_LOCAL_KEY, storage: legacyStorageNames(WANKA_LOCAL_KEY) };
  // Ningún cliente de Supabase: lo poco que la interfaz le pide (salir de la sesión) no hace nada.
  const client = { auth: { signOut: async () => ({ error: null }) } } as never;
  return {
    workspace: { config, client },
    client,
    user: { id: userId, email: 'you@practice.test' },
    db: d.db,
    tree: d.tree,
    docs: d.docs,
    files: d.files,
    media: d.media,
    engine: d.engine,
    access: d.access,
    remote: d.remote as unknown as SupabaseRemote,
    dbName: 'practice',
    mediaDb: d.mediaDb,
    comments: d.comments,
    commentsDb: d.commentsDb,
    sizes: d.sizes,
    offline: d.offline,
    shutdown: async () => undefined,
  } as Services;
}

async function main() {
  prefs.init();
  const params = new URLSearchParams(location.search);
  const tour = params.get('tour') || 'scratch';
  const back = safeBack(params.get('back'));
  const lang = language();

  const server = new FakeServer();
  // Con el portero en memoria: las fotos del proyecto de práctica (y las que agregue la persona) se guardan en el
  // dispositivo de mentira y se ven en la cabecera y en las tablas, sin salir a la red.
  server.enableMedia();
  // Las miniaturas y la vista de las fotos, las del navegador (el dispositivo de prueba trae unas de mentira para node).
  server.probe = probeMedia;
  server.viewImage = viewImage;
  // Con las reglas del equipo, como la base real: la persona es la dueña (sin esto, los permisos quedan sin datos y
  // *Create* de escenas y locaciones no se ofrece). Después del portero: `enableMedia` deja la base en la versión 3 y
  // `enableTeam` la sube a la 4 (al revés, la bajaría y no habría permisos).
  server.enableTeam();
  const device = await makeDevice(server);
  await device.engine.syncNow();
  const projectId = await device.tree.createProject(lang === 'es' ? 'Proyecto de práctica' : 'Practice project');
  const stages = await createStageFolders(device.tree, projectId, lang);
  await device.engine.syncNow();
  // El proyecto que abre la app (en el `localStorage` en memoria).
  localStorage.setItem(legacyStorageNames(WANKA_LOCAL_KEY).project, JSON.stringify({ [server.ownerId]: projectId }));
  // Preproducción desplegada en el árbol: se ven Escenas y Locaciones (la clave de Sidebar.tsx, en memoria).
  localStorage.setItem('shotdocs-expanded', JSON.stringify([stages.prepro]));
  // Las cabeceras vivas abiertas también en el teléfono (ahí se pliegan de fábrica): los capítulos explican lo que
  // muestran. Es el almacenamiento en memoria de la práctica: no llega a la app de verdad.
  for (const kind of ['scene', 'location', 'day', 'set'] as const) setLiveOpen(kind, true);
  setPracticeWorld({ tree: device.tree, projectId, stages, lang, docs: device.docs, media: device.media });

  // Una sola entrada en el historial, y la marca para volver si se recarga (con el capítulo de ahora).
  installNavHistory();
  const replace = history.replaceState.bind(history);
  const remember = () => markTourDoc(tourDocHref(tour, getTourUi().chapter || params.get('chapter'), back), location.pathname + location.search);
  history.pushState = (state, unused, url) => {
    replace(state, unused, url);
    remember();
  };
  history.replaceState = (state, unused, url) => {
    replace(state, unused, url);
    remember();
  };
  subscribeTourUi(remember);
  // Arranca en la carpeta de Preproducción, como queda un proyecto recién creado.
  history.replaceState(null, '', pagePath(stages.prepro));

  enterTourDocument(tour, params.get('chapter') ?? '', back);
  createRoot(document.getElementById('root')!).render(
    <>
      <ServicesContext.Provider value={services(device, server.ownerId)}>
        <Shell />
      </ServicesContext.Provider>
      <TooltipLayer />
    </>,
  );
}
void main();
