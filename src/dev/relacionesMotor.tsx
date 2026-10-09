// Arnés del motor de relaciones en vivo (solo para desarrollo: no entra en el build ni se publica). Monta la barra lateral,
// la página real y las relaciones (`RelationsRunner`) sobre el servidor en memoria de las pruebas, sin login ni red, con un
// proyecto INVENTADO de unas 900 páginas armado como la estructura estándar (Docs/Doc_Estructura_Proyecto.md): desglose
// por episodio con fichas, locaciones con scoutings, días de rodaje por bloques con secciones por escena, fotos y links,
// un planning por día, notas y un archivo fuera del grafo (`graph: false`). Sirve para ver «Reading N of M…» en el pie y
// para consultar `__shotdocsRelations` en la consola (Docs/Doc_Relaciones.md, sección 7).
//
// Parámetros: `?theme=dark|light`, `?slow=<ms>` (demora cada página que lee el índice, para ver el progreso con calma;
// sin él, la primera lectura de 900 páginas chicas dura un par de segundos).
import { createRoot } from 'react-dom/client';
import { useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import '../ui/drive.css';
import '../styles.css';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { CONTENT_FRAGMENT } from '../sync/structure';
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
import { RelationsRunner } from '../ui/relationsUi';

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
      <RelationsRunner />
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

type Block = { text?: string; heading?: number; photo?: boolean; link?: { pageId: string; text: string } };

/** Escribe los bloques en la página (como el editor) y la cierra. */
async function write(d: Device, pageId: string, blocks: Block[]): Promise<void> {
  const doc = await d.docs.open(pageId);
  const fragment = doc.getXmlFragment(CONTENT_FRAGMENT);
  doc.transact(() => {
    if (fragment.length === 0) fragment.insert(0, [new Y.XmlElement('blockGroup')]);
    const group = fragment.get(0) as Y.XmlElement;
    group.insert(
      group.length,
      blocks.map((b) => {
        const el = new Y.XmlElement('blockContainer');
        el.setAttribute('id', crypto.randomUUID());
        if (b.photo) {
          const image = new Y.XmlElement('image');
          image.setAttribute('url', `sdmedia://${crypto.randomUUID()}`);
          el.insert(0, [image]);
          return el;
        }
        const content = new Y.XmlElement(b.heading ? 'heading' : 'paragraph');
        if (b.heading) content.setAttribute('level', b.heading as never);
        const text = new Y.XmlText();
        if (b.link) text.insert(0, b.link.text, { link: { href: `/p/${b.link.pageId}` } });
        else text.insert(0, b.text ?? '');
        content.insert(0, [text]);
        el.insert(0, [content]);
        return el;
      }),
    );
  });
  d.docs.close(pageId);
}

const LOCATIONS = ['Puerto Norte', 'Galpón Sur', 'Estación Vieja', 'Hotel Central', 'Usina Costera', 'Plaza Mayor', 'Hospital San Telmo', 'Club Náutico', 'Fábrica Textil', 'Teatro Colón Chico'];
const pad = (n: number) => String(n).padStart(3, '0');

async function main() {
  const root = document.getElementById('root')!;
  root.textContent = 'Preparing a synthetic project…';
  prefs.init();
  const params = new URLSearchParams(location.search);
  const theme = params.get('theme');
  if (theme === 'dark' || theme === 'light') prefs.set({ theme });
  const slow = Number(params.get('slow') ?? 0);
  const server = new FakeServer();
  const A = await makeDevice(server);
  A.tree.onPlaced = (id, how) => placedEntity(A.tree, id, how);
  await A.engine.syncNow();
  server.online = false;
  const project = await A.tree.createProject('Serie de prueba');
  const t = A.tree;
  const ids: Record<string, string> = {};

  // Desglose: 3 episodios × 60 escenas, cada una con una ficha.
  const desglose = await t.create(null, '1 | Desglose', project);
  await t.setSetting(desglose, 'holds', 'scene');
  const scenes: { code: string; id: string }[] = [];
  for (const ep of [101, 102, 103]) {
    const epId = await t.create(desglose, `${ep} | Episodio ${ep - 100}`, project);
    for (let n = 1; n <= 60; n++) {
      const id = await t.create(epId, `${pad(n)} | Escena ${n} del episodio ${ep - 100}`, project);
      scenes.push({ code: `${ep}_${pad(n)}`, id });
      const ficha = await t.create(id, `SDP_${ep}_${pad(n)}_010`, project);
      // Una ficha con el lugar escrito con otro nombre de la locación (D526, D530): «Puerto» es de Puerto Norte.
      if (ep === 101 && n === 27) {
        ids.ficha = ficha;
        await write(A, ficha, [{ text: 'Locacion Real: Puerto' }, { text: 'Plates del muelle.' }]);
      }
      await write(A, id, [{ text: `Desglose de ${ep}_${pad(n)}. Locación planeada: ${LOCATIONS[n % LOCATIONS.length]}.` }]);
    }
  }
  ids.scene = scenes[26].id;
  // Locaciones, cada una con un scouting.
  const locs = await t.create(null, '2 | Locaciones', project);
  await t.setSetting(locs, 'holds', 'location');
  for (const name of LOCATIONS) {
    const id = await t.create(locs, name, project);
    ids[name] = id;
    // Otros nombres (D526): «Muelle Norte» cuenta en todos lados; «Puerto», de una sola palabra, solo donde se espera un lugar.
    if (name === 'Puerto Norte') await write(A, id, [{ text: 'Otros nombres: Muelle Norte, Puerto' }, { text: 'Muelle de carga, acceso por el portón 3.' }]);
    const scout = await t.create(id, `Tech scout | ${name}`, project);
    await write(A, scout, [{ heading: 1, text: 'Acceso' }, { text: `Sirve para la Escena ${scenes[LOCATIONS.indexOf(name)].code}.` }, { photo: true }]);
  }
  // Rodaje: 3 bloques × 30 días; cada día con dos secciones por escena (con foto y link) y un planning.
  const rodaje = await t.create(null, '3 | Rodaje', project);
  await t.setSetting(rodaje, 'dayReports', {});
  let day = 0;
  for (const b of [1, 2, 3]) {
    const bloque = await t.create(rodaje, `Bloque ${b}`, project);
    for (let k = 0; k < 30; k++) {
      day++;
      const date = new Date(Date.UTC(2026, 1, 1 + day)).toISOString().slice(0, 10);
      const loc = LOCATIONS[day % LOCATIONS.length];
      const id = await t.create(bloque, `${date} | Día ${day} | ${loc}`, project);
      if (day === 59 || day === 1) ids[`day${day}`] = id;
      const s1 = scenes[(day * 2) % scenes.length];
      const s2 = scenes[(day * 2 + 1) % scenes.length];
      await write(A, id, [
        { heading: 1, text: 'Info general' },
        { text: `Llamado 7:00 en ${loc}. Av. Corrientes 2095, 3500 nits.` },
        { heading: 1, text: `Escena ${s1.code}` },
        { link: { pageId: s1.id, text: `→ Escena ${s1.code}` } },
        { text: 'Plates de fondo, dos pasadas.' },
        { photo: true },
        { heading: 1, text: `Escena ${s2.code.slice(2, 3)}${s2.code.slice(4)}` },
        { text: `Se repite la ${s1.code}. Queda la Escena ${s2.code.slice(0, 4)}199 pendiente.` },
        { photo: true },
      ]);
      const plan = await t.create(id, 'Plan', project);
      await write(A, plan, [{ text: `${s1.code} y ${s2.code}` }]);
    }
  }
  // Notas sueltas y un archivo fuera del grafo.
  const notas = await t.create(null, '4 | Notas', project);
  for (let i = 1; i <= 220; i++) await t.create(notas, `Nota ${i}`, project);
  const archivo = await t.create(null, '90 | Archivo', project);
  await t.setSetting(archivo, 'graph', false);
  for (let i = 1; i <= 100; i++) {
    const id = await t.create(archivo, `Backup ${i}`, project);
    if (i <= 5) await write(A, id, [{ text: `Copia vieja: Escena ${scenes[i].code}` }]);
  }
  await A.docs.flush();

  // Una lectura lenta a pedido, para ver el progreso con calma.
  if (slow > 0) {
    const real = A.docs.indexSnapshot.bind(A.docs);
    A.docs.indexSnapshot = async (pageId: string) => {
      await new Promise((r) => setTimeout(r, slow));
      return real(pageId);
    };
  }

  root.textContent = '';
  createRoot(root).render(
    <>
      <ServicesContext.Provider value={services(A, server.ownerId)}>
        <Shell device={A} />
      </ServicesContext.Provider>
      <TooltipLayer />
    </>,
  );
  navigate(pagePath(ids.day59), true);
  (window as unknown as { __dev: unknown }).__dev = {
    listo: true,
    pages: [...function* walk(): Generator<string> {
      const stack = [...t.roots(project)];
      while (stack.length) {
        const p = stack.pop()!;
        yield p.id;
        stack.push(...t.children(p.id));
      }
    }()].length,
    tree: t,
    ids,
    setNavOpen,
    navigate: (id: string) => navigate(pagePath(id)),
  };
}
void main();
