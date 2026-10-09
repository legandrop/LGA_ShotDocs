// Arnés de la cabecera viva (solo para desarrollo: no entra en el build ni se publica). Monta la app de verdad (`Shell`:
// barra lateral, página, editor) sobre el servidor en memoria de las pruebas, sin login ni red, con el proyecto
// sintético de `relations/fixtures/proyectoSintetico.ts` (la forma del recorte de la maqueta S4, con nombres
// inventados) y fotos dibujadas en el momento. Sirve para comparar con la maqueta en un navegador de verdad.
//
//   /src/dev/cabecera-viva.html?page=s027        la escena 105_027 (o cenade, d59, s026…)
//   &collapsed=1                                   con la sección del día 59 colapsada para todos
//   &ronda=1 / &lento=1                            casos de la auditoría / índice que nunca termina
//   &days=1                                        el día de rodaje y Tomorrow (E5): ?page=d59&days=1
//   &largo=1 / &lentofotos=1                       el Día 60 largo con fotos grandes / fotos que tardan en llegar
//   &e7=1                                          crear y asignar (E7): con equipo (permisos conocidos, dueño), un
//                                                  pendiente 105_120 en el Día 58 y en las notas, 104_054A sin base,
//                                                  105_121 en «90 | Archivo» y 105_122 en la papelera
//   &e7=1&como=ana                                 lo mismo, visto por una invitada (edita los días, ve el desglose)
//   &e11=1                                         la tarjeta del último día (E11): 104_008 y 105_029 con fecha de
//                                                  rodaje 16/03 (el lunes después del Día 76), para ?page=d76
//   window.__cabecera = { listo, ids, ir(clave), red(bool) }
import { createRoot } from 'react-dom/client';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import '../ui/drive.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '../styles.css';
import { prefs } from '../prefs';
import { navigate, pagePath } from '../router';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { buildProject, writeBlocks, type Block } from '../relations/fixtures/proyectoSintetico';
import { Shell } from '../ui/Workspace';
import { SHARED_COLLAPSE_MAP } from '../ui/collapseEditor';
import { unitsFromYDoc } from '../search/extract';

function services(d: Device): Services {
  return {
    workspace: { config: { url: 'https://example.invalid', publishableKey: 'sb_publishable_test', name: 'Wanka', localKey: WANKA_LOCAL_KEY, storage: legacyStorageNames(WANKA_LOCAL_KEY) }, client: {} },
    client: { auth: { signOut: () => undefined } },
    user: { id: d.remote.userId, email: 'lega@test' },
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
  } as unknown as Services;
}

// Una foto inventada: un degradé con formas y su rótulo, como JPEG.
const PALETTES = [
  ['#2b4a6f', '#86b6d9', '#e8d9a8'],
  ['#3d5a2f', '#9cc27a', '#f2e6b8'],
  ['#4a2f2f', '#c98b6b', '#f0d2a0'],
  ['#1f2a33', '#5a7d8c', '#d9e4e8'],
  ['#5a4a2f', '#d9b36b', '#fbf1d9'],
];
let count = 0;
async function drawPhoto(label: string, w = 900, h = 600): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g0 = c.getContext('2d')!;
  g0.scale(w / 900, h / 600);
  const g = g0;
  const [a, b, light] = PALETTES[count++ % PALETTES.length];
  const grad = g.createLinearGradient(0, 0, 900, 600);
  grad.addColorStop(0, a);
  grad.addColorStop(1, b);
  g.fillStyle = grad;
  g.fillRect(0, 0, 900, 600);
  g.fillStyle = light;
  g.globalAlpha = 0.5;
  g.beginPath();
  g.ellipse(250 + (count * 97) % 400, 380, 260, 90, 0, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
  g.fillStyle = 'rgba(0,0,0,.35)';
  g.fillRect(0, 520, 900, 80);
  g.fillStyle = '#fff';
  g.font = '600 44px sans-serif';
  g.fillText(label, 30, 575);
  return new Promise((resolve) => c.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.85));
}

async function main() {
  prefs.init();
  const server = new FakeServer();
  const e7 = new URLSearchParams(location.search).get('e7') === '1';
  // E7: con equipo, la app conoce los permisos (sin equipo, no los conoce y no deja crear desde el texto).
  if (e7) server.enableTeam();
  const owner = await makeDevice(server);
  let d = owner;
  // El dispositivo de las pruebas guarda miniaturas de mentira (unos bytes): acá cada foto se muestra con su imagen
  // dibujada, en el editor y en la cabecera (las dos piden la dirección a `resolve`).
  const drawn = new Map<string, string>();
  const resolve = d.media.resolve.bind(d.media);
  // `?lentofotos=1`: cada foto tarda en llegar (0,4 a 2 s), como en un teléfono con mala señal: la página crece mientras
  // tanto (para probar que ir a un lugar lo sigue hasta que termina de cargar, B3 de la auditoría de E5).
  const slow = new URLSearchParams(location.search).get('lentofotos') === '1';
  const wait = () => new Promise((r) => setTimeout(r, slow ? 400 + Math.random() * 1600 : 0));
  d.media.resolve = (url: string, pageId?: string) => (drawn.has(url) ? wait().then(() => drawn.get(url)!) : resolve(url, pageId));
  await d.engine.syncNow();
  const params = new URLSearchParams(location.search);
  // `?days=1`: lo del día de rodaje (E5): fechas en las fichas, Día 58 y el Día 60 sin página Plan (como la maqueta).
  const addPhoto = async (label: string, pageId: string, w?: number, h?: number) => {
    const blob = Object.assign(await drawPhoto(label, w, h), { name: `${label.replace(/\s+/g, '_')}.jpg` });
    const url = await d.media.add(pageId, blob as Blob & { name: string });
    drawn.set(url, URL.createObjectURL(blob));
    return url.replace('sdmedia://', '');
  };
  const built = await buildProject(d, (label, pageId) => addPhoto(label, pageId), { days: params.get('days') === '1' });
  // `?largo=1`: el Día 60 largo, con 24 fotos grandes arriba (como un día de ERSO): después de Prepare, lo agregado
  // queda al final, miles de píxeles abajo.
  if (params.get('largo') === '1') {
    const blocks: Block[] = [{ h: 1, text: 'Info general:' }, { p: 'Llamado 7:00. Lluvia a la tarde.' }];
    for (let i = 1; i <= 24; i++) blocks.push({ photo: await addPhoto(`D60 grande ${i}`, built.ids.d60, 2400, 1600) });
    blocks.push({ h: 1, text: 'Escena 105_029a' }, { p: 'Primer plano del fugitivo, luz de atardecer.' });
    for (let i = 1; i <= 6; i++) blocks.push({ photo: await addPhoto(`D60 029 ${i}`, built.ids.d60, 2400, 1600) });
    await writeBlocks(d, built.ids.d60, blocks);
    await d.engine.syncNow();
  }
  // `?ronda=1`: los casos de la auditoría de la v0.238 (una escena con fichas mezcladas, un día con dos locaciones, el
  // plan de un día en que la escena ya tiene sección).
  if (params.get('ronda') === '1') {
    await writeBlocks(d, built.ids.s025_010, [{ p: 'Locación real: CENADE' }, { row: ['VFX Cat', 'DMP 2.5D, CG'] }]);
    const c020 = await d.tree.create(built.ids.s025, 'PRUEBA_105_025_020 Ambulancia', built.projectId);
    await writeBlocks(d, c020, [{ row: ['VFX Cat', 'No VFX'] }]);
    const d82 = await d.tree.create(built.ids.rodaje, '2026-03-20 | Día 82 | CENADE + La Arenera', built.projectId);
    await writeBlocks(d, d82, [{ h: 1, text: 'Escena 105_029' }, { p: 'Retomas del primer plano.' }]);
    const plan59 = await d.tree.create(built.ids.d59, 'Plan | Día 59', built.projectId);
    await writeBlocks(d, plan59, [{ p: 'Orden: 105_027 primero.' }]);
    await d.engine.syncNow();
  }
  // `?e7=1`: lo de crear y asignar (E7).
  if (e7) {
    await writeBlocks(d, built.ids.d58, [
      { h: 1, text: 'Info general' },
      { p: 'Llamado 8:00. Prueba de cámara en la curva.' },
      { h: 1, text: 'Escena 105_120' },
      { p: 'Plano del puente, la 105_121 quedó para otro día.' },
    ]);
    await writeBlocks(d, built.ids.notas, [{ p: 'Revisar con dirección la 105_027 antes del día 70.' }, { p: 'Falta la 105_120 en el desglose y la 104_054 de la plaza.' }]);
    await d.tree.create(built.ids.ep4, '054A | La plaza de noche', built.projectId);
    await d.tree.create(built.ids.archivo, '105_121 | Descartada', built.projectId);
    const trashed = await d.tree.create(built.ids.ep5, '122 | La que se borró', built.projectId);
    await d.tree.trash(trashed);
    await d.engine.syncNow();
    if (params.get('como') === 'ana') {
      server.addMember('ana', 'member', 'ana@test');
      server.grant('ana', { pageId: built.ids.rodaje }, 'edit_pages');
      server.grant('ana', { pageId: built.ids.desglose }, 'view');
      d = await makeDevice(server, crypto.randomUUID(), '0.021', {}, undefined, { id: 'ana', email: 'ana@test' });
      d.media.resolve = owner.media.resolve;
      await d.engine.syncNow();
      await d.engine.syncNow();
    }
  }
  // `?e11=1`: la tarjeta del último día (E11): dos fichas filmadas el lunes después del Día 76.
  if (params.get('e11') === '1') {
    await writeBlocks(owner, built.ids.s008, [{ table: [['Fecha Rodaje', '16/03/2026']] }]);
    await writeBlocks(owner, built.ids.s029, [{ table: [['Fecha Rodaje', '16/03/2026']] }]);
    await owner.engine.syncNow();
    await d.engine.syncNow();
  }
  // `?lento=1`: el índice nunca termina de leer los documentos (para ver la cabecera mientras lee).
  if (params.get('lento') === '1') d.docs.indexSnapshot = () => new Promise(() => undefined);
  // `?collapsed=1`: la sección «Escena 105_027b» del día 59 colapsada para todos (ir ahí tiene que abrirla).
  if (params.get('collapsed') === '1') {
    const doc = await d.docs.open(built.ids.d59);
    const unit = unitsFromYDoc(doc).find((u) => u.text === 'Escena 105_027b');
    if (unit) doc.getMap(SHARED_COLLAPSE_MAP).set(unit.blockId, true);
    d.docs.close(built.ids.d59);
    await d.docs.flush();
  }
  const start = built.ids[params.get('page') ?? 's027'] ?? built.ids.s027;
  history.replaceState(null, '', `${pagePath(start)}${location.search}`);
  createRoot(document.getElementById('root')!).render(
    <ServicesContext.Provider value={services(d)}>
      <Shell />
    </ServicesContext.Provider>,
  );
  (window as unknown as Record<string, unknown>).__cabecera = {
    listo: true,
    ids: built.ids,
    photos: built.photos,
    ir: (key: string) => navigate(pagePath(built.ids[key] ?? key)),
    // Sin red / con red (el servidor en memoria deja de contestar), y una sincronización ya.
    red: async (on: boolean) => {
      server.online = on;
      await d.engine.syncNow();
    },
    tree: d.tree,
  };
}
void main();
