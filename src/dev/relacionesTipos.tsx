// Arnés del recorrido del tipo de página (solo para desarrollo: no entra en el build ni se publica). Monta el árbol, el
// menú de la página y la página real (`Sidebar` + `PageView`) sobre el servidor en memoria de las pruebas, sin login ni
// red, con un proyecto armado como la estructura estándar (Docs/Doc_Estructura_Proyecto.md): desglose por episodio,
// locaciones, rodaje por bloques y una carpeta sin tipo. Un script de Chromium sin ventana lo recorre y saca capturas.
import { createRoot } from 'react-dom/client';
import { useSyncExternalStore } from 'react';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import '../ui/drive.css';
import '../styles.css';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { PageView } from '../ui/PageView';
import { Sidebar } from '../ui/Sidebar';
import { TooltipLayer } from '../ui/Tooltip';
import { NavMenuButton } from '../ui/NavMenuButton';
import { setNavOpen, useNavOpen } from '../ui/navStore';
import { navigate, pagePath, useRoute } from '../router';
import { prefs } from '../prefs';
import { placedEntity } from '../relations/entitySync';

function services(d: Device, userId: string): Services {
  const config = {
    url: 'https://example.invalid',
    publishableKey: 'sb_publishable_test',
    name: 'Wanka',
    localKey: WANKA_LOCAL_KEY,
    storage: legacyStorageNames(WANKA_LOCAL_KEY),
  };
  const client = { auth: { signOut: () => undefined } } as never;
  return {
    workspace: { config, client },
    client,
    user: { id: userId, email: `${userId}@test` },
    db: d.db,
    tree: d.tree,
    docs: d.docs,
    files: d.files,
    media: d.media,
    engine: d.engine,
    access: d.access,
    remote: d.remote as unknown as SupabaseRemote,
    dbName: 'test',
    mediaDb: d.mediaDb,
    comments: d.comments,
    commentsDb: d.commentsDb,
    sizes: d.sizes,
    offline: d.offline,
    shutdown: async () => undefined,
  } as Services;
}

function Shell({ device }: { device: Device }) {
  const route = useRoute();
  const navOpen = useNavOpen();
  useSyncExternalStore(device.tree.subscribe, device.tree.getRevision);
  const pageId = route.name === 'page' && device.tree.get(route.id) ? route.id : null;
  return (
    <div className={`shell${navOpen ? ' nav-open' : ''}`}>
      <Sidebar />
      <div className="scrim" onClick={() => setNavOpen(false)} />
      <main className="main">
        <header className="topbar">
          <NavMenuButton />
        </header>
        {pageId && <PageView key={pageId} id={pageId} />}
      </main>
    </div>
  );
}

async function main() {
  prefs.init();
  const theme = new URLSearchParams(location.search).get('theme');
  if (theme === 'dark' || theme === 'light') prefs.set({ theme });
  const server = new FakeServer();
  const A = await makeDevice(server);
  // Lo que hace services.ts: la marca de tipo al crear, renombrar o mover.
  A.tree.onPlaced = (id, how) => placedEntity(A.tree, id, how);
  await A.engine.syncNow();
  const project = await A.tree.createProject('ERSO (prueba)');
  const t = A.tree;
  const pre = await t.create(null, '1 | Preproducción', project);
  const desglose = await t.create(pre, '1.1 | Desglose', project);
  await t.setSetting(desglose, 'holds', 'scene');
  const ep = await t.create(desglose, '105 | Episodio 5', project);
  const esc = await t.create(ep, '027 | El vehículo comienza a zigzaguear | 105_027', project);
  await t.create(esc, 'ERSO_105_027_010 Ambulancia | Ruta INT', project);
  await t.create(ep, '029 | El RUSO abre los ojos, desorientado | 105_029', project);
  const locs = await t.create(pre, '1.2 | Locaciones y scoutings', project);
  await t.setSetting(locs, 'holds', 'location');
  const cenade = await t.create(locs, 'CENADE', project);
  await t.create(cenade, '260106 | Scouting técnico VFX | Cenade - Ezeiza', project);
  const rodaje = await t.create(null, '2 | Rodaje', project);
  await t.setSetting(rodaje, 'dayReports', {});
  const bloque = await t.create(rodaje, 'Bloque 2', project);
  await t.create(bloque, '2026-02-19 | Día 59 | Cenade', project);
  await t.create(bloque, '2026-02-20 | Día 60 | Cenade', project);
  const tablas = await t.create(null, '3 | Tablas y referencia', project);
  await t.create(tablas, 'Planos de VFX', project);
  await A.engine.syncNow();

  createRoot(document.getElementById('root')!).render(
    <>
      <ServicesContext.Provider value={services(A, server.ownerId)}>
        <Shell device={A} />
      </ServicesContext.Provider>
      <TooltipLayer />
    </>,
  );
  navigate(pagePath(esc), true);
  (window as unknown as { __dev: unknown }).__dev = { listo: true, tree: t, ids: { pre, desglose, ep, esc, locs, cenade, rodaje, bloque, tablas }, setNavOpen, navigate: (id: string) => navigate(pagePath(id)) };
}
void main();
