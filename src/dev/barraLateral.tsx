// Arnés de prueba visual (solo para desarrollo: no entra en el build ni se publica; se abre con el servidor de
// desarrollo en /src/dev/barra-lateral.html). La app de verdad (Shell) sobre el servidor en memoria de las pruebas, sin
// login ni red, con el proyecto sintético de las relaciones (escenas, locaciones y días): sirve para mirar los títulos
// de la barra lateral (Overview, Pages), las partes de *Overview* y su selección contra la de una página. `?map` abre el mapa; `?muchas`
// suma 120 escenas al episodio 5 y una rama *Preproducción › Decorados* con 80 páginas, para ver qué queda pegado arriba
// al bajar (D771).
import { createRoot } from 'react-dom/client';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import '../ui/drive.css';
import '../styles.css';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { Shell } from '../ui/Workspace';
import { TooltipLayer } from '../ui/Tooltip';
import { prefs } from '../prefs';
import { mapPath, pagePath } from '../router';
import { installNavHistory } from '../navHistory';
import { buildProject } from '../relations/fixtures/proyectoSintetico';

function services(d: Device, userId: string): Services {
  const config = { url: 'https://znlvpuddswymxpffgvbz.supabase.co', publishableKey: 'sb_publishable_test', name: 'Wanka', localKey: WANKA_LOCAL_KEY, storage: legacyStorageNames(WANKA_LOCAL_KEY) };
  const client = { auth: { signOut: () => undefined } } as never;
  return {
    workspace: { config, client }, client, user: { id: userId, email: `${userId}@test` },
    db: d.db, tree: d.tree, docs: d.docs, files: d.files, media: d.media, engine: d.engine, access: d.access,
    remote: d.remote as unknown as SupabaseRemote, dbName: 'test', mediaDb: d.mediaDb, comments: d.comments,
    commentsDb: d.commentsDb, sizes: d.sizes, offline: d.offline, shutdown: async () => undefined,
  } as Services;
}

let n = 0;
const fakePhoto = async () => `0000${String(++n).padStart(4, '0')}-aaaa-4bbb-8ccc-dddddddddddd`;

async function main() {
  prefs.init();
  const server = new FakeServer();
  const A = await makeDevice(server);
  await A.engine.syncNow();
  const built = await buildProject(A, fakePhoto, { days: true });
  if (new URLSearchParams(location.search).has('muchas')) {
    for (let i = 100; i < 220; i++) await A.tree.create(built.ids.ep5, `${i} | Escena de prueba ${i}`, built.projectId);
    const pre = await A.tree.create(null, '3 | Preproducción', built.projectId);
    const deco = await A.tree.create(pre, 'Decorados', built.projectId);
    for (let i = 1; i <= 80; i++) await A.tree.create(deco, `Decorado ${String(i).padStart(2, '0')}`, built.projectId);
    await A.tree.create(pre, 'Vestuario', built.projectId);
    localStorage.setItem('shotdocs-expanded', JSON.stringify([pre, deco]));
  }
  await A.engine.syncNow();
  // El proyecto sintético como el elegido (en `/map` no hay página abierta que lo diga).
  localStorage.setItem(legacyStorageNames(WANKA_LOCAL_KEY).project, JSON.stringify({ [server.ownerId]: built.projectId }));
  installNavHistory();
  history.replaceState(null, '', new URLSearchParams(location.search).has('map') ? mapPath() : pagePath(built.ids.notas));
  createRoot(document.getElementById('root')!).render(
    <>
      <ServicesContext.Provider value={services(A, server.ownerId)}>
        <Shell />
      </ServicesContext.Provider>
      <TooltipLayer />
    </>,
  );
  (window as unknown as { __barra: unknown }).__barra = { listo: true, ids: built.ids };
}
void main();
