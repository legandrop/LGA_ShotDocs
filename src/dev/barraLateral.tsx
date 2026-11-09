// Arnés de prueba visual (solo para desarrollo: no entra en el build ni se publica; se abre con el servidor de
// desarrollo en /src/dev/barra-lateral.html). La app de verdad (Shell) sobre el servidor en memoria de las pruebas, sin
// login ni red, con el proyecto sintético de las relaciones (escenas, locaciones y días): sirve para mirar los títulos
// de la barra lateral (Overview, Pages), las partes de *Overview* y su selección contra la de una página. `?map` abre el mapa; `?muchas`
// suma 120 escenas al episodio 5 y una rama *Preproducción › Decorados* con 80 páginas, para ver qué queda pegado arriba
// al bajar (D771). `?compartir` abre encima *Share scenes* (v0.331), con dos vendors; DNEG con dos artistas y un correo
// que sumó su equipo (D854). `?equipo` abre la app como Vera, del equipo de DNEG: su ⋯ del proyecto ofrece *Share all
// scenes…* y *Share scenes with artists…*.
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
import { ShareScenesDialog } from '../ui/ShareScenesDialog';
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
  // `?compartir`: abre *Share scenes* (v0.331) con la base 31, el interruptor de lo borrado y dos vendors.
  const share = new URLSearchParams(location.search).has('compartir');
  const asTeam = new URLSearchParams(location.search).has('equipo');
  if (share || asTeam) {
    server.enableTeam();
    server.enableClean();
    server.enableVendorTeam();
  }
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
  // `?fechas`: scoutings y planes con los títulos de Lega, para ver la fila con fecha de las tres familias (D789).
  if (new URLSearchParams(location.search).has('fechas')) {
    const doc = async (parent: string | null, title: string, holds?: 'scouting' | 'plan') => {
      const id = await A.tree.create(parent, title, built.projectId);
      if (holds) await A.tree.setPatch(id, { settings: { holds } });
      return id;
    };
    const sc = await doc(null, '3 | Scouting', 'scouting');
    await doc(sc, '260106 | Scouting técnico VFX | CENADE');
    await doc(sc, '260107 | Scouting técnico VFX | La Arenera (estudio)');
    await doc(sc, '260109 | Scouting técnico VFX | Senade Ezeiza');
    const pl = await doc(null, '4 | Planeamiento', 'plan');
    const bloque = await doc(pl, 'Bloque 2');
    await doc(bloque, 'D37 26.01.18 | CENADE');
    await doc(bloque, 'D37 26.01.18 | sin lugar (2)');
    await doc(bloque, 'D38 26.01.19 | La Arenera');
    localStorage.setItem('shotdocs-expanded', JSON.stringify([sc, pl, bloque, built.ids.rodaje]));
  }
  // `?proyectos`: varios proyectos con nombres largos, para ver el menú de proyectos (que se lean los nombres enteros).
  if (new URLSearchParams(location.search).has('proyectos')) {
    for (const name of ['MGTZD comercial Mercado Libre segunda tanda', 'ERSO | El Robo del Siglo', 'Prueba color de proyecto con nombre largo', 'VLLF'])
      await A.tree.createProject(name);
  }
  let vera: Device | null = null;
  if (share || asTeam) {
    server.addMember('vera', 'guest', 'vera@vendor.test');
    for (const k of ['s027', 's029']) await A.tree.setPatch(built.ids[k], { settings: { entity: { kind: 'scene', code: k } } });
    await A.engine.syncNow();
    await A.remote.saveSceneVendors(built.projectId, [
      { op: 'create', key: 'dn', name: 'DNEG', code: 'DN', color: '#2e5a8e', level: 'comment', add_scenes: [built.ids.s027, built.ids.s029], add_emails: ['vera@vendor.test'] },
      { op: 'create', key: 'fs', name: 'Framestore', code: 'FS', color: '#774dcb', level: 'view', add_scenes: [built.ids.s027], add_emails: [] },
    ]);
    // El equipo de DNEG (Vera): suma a Celia y arma dos artistas, uno con correo.
    vera = await makeDevice(server, crypto.randomUUID(), '0.021', {}, undefined, { id: 'vera', email: 'vera@vendor.test' });
    await vera.remote.saveVendorTeam(built.projectId, [
      { op: 'team', add_emails: ['celia@vendor.test'] },
      { op: 'create', key: 'so', name: 'Sofi', code: 'SO', color: '#2f8f6b', level: 'comment', add_scenes: [built.ids.s027], add_emails: ['sofia@art.test'] },
      { op: 'create', key: 'ju', name: 'Juan', code: 'JU', color: '#c4572e', level: 'view', add_scenes: [built.ids.s027, built.ids.s029], add_emails: [] },
    ]);
  }
  await A.engine.syncNow();
  if (vera && asTeam) await vera.engine.syncNow();
  const who = vera && asTeam ? vera : A;
  const whoId = vera && asTeam ? 'vera' : server.ownerId;
  // El proyecto sintético como el elegido (en `/map` no hay página abierta que lo diga).
  localStorage.setItem(legacyStorageNames(WANKA_LOCAL_KEY).project, JSON.stringify({ [whoId]: built.projectId }));
  installNavHistory();
  history.replaceState(null, '', new URLSearchParams(location.search).has('map') ? mapPath() : pagePath(asTeam ? built.ids.s027 : built.ids.notas));
  createRoot(document.getElementById('root')!).render(
    <>
      <ServicesContext.Provider value={services(who, whoId)}>
        <Shell />
        {share && <ShareScenesDialog projectId={built.projectId} onClose={() => undefined} />}
      </ServicesContext.Provider>
      <TooltipLayer />
    </>,
  );
  (window as unknown as { __barra: unknown }).__barra = { listo: true, ids: built.ids };
}
void main();
