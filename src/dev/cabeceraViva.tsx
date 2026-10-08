// Arnés de la cabecera viva (solo para desarrollo: no entra en el build ni se publica). Monta la app de verdad (`Shell`:
// barra lateral, página, editor) sobre el servidor en memoria de las pruebas, sin login ni red, con el proyecto
// sintético de `relations/fixtures/proyectoSintetico.ts` (la forma del recorte de la maqueta S4, con nombres
// inventados) y fotos dibujadas en el momento. Sirve para comparar con la maqueta en un navegador de verdad.
//
//   /src/dev/cabecera-viva.html?page=s027        la escena 105_027 (o cenade, d59, s026…)
//   &collapsed=1                                   con la sección del día 59 colapsada para todos
//   &ronda=1 / &lento=1                            casos de la auditoría / índice que nunca termina
//   window.__cabecera = { listo, ids, ir(clave) }
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
import { buildProject, writeBlocks } from '../relations/fixtures/proyectoSintetico';
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
async function drawPhoto(label: string): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = 900;
  c.height = 600;
  const g = c.getContext('2d')!;
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
  const d = await makeDevice(server);
  // El dispositivo de las pruebas guarda miniaturas de mentira (unos bytes): acá cada foto se muestra con su imagen
  // dibujada, en el editor y en la cabecera (las dos piden la dirección a `resolve`).
  const drawn = new Map<string, string>();
  const resolve = d.media.resolve.bind(d.media);
  d.media.resolve = (url: string, pageId?: string) => (drawn.has(url) ? Promise.resolve(drawn.get(url)!) : resolve(url, pageId));
  await d.engine.syncNow();
  const built = await buildProject(d, async (label, pageId) => {
    const blob = Object.assign(await drawPhoto(label), { name: `${label.replace(/\s+/g, '_')}.jpg` });
    const url = await d.media.add(pageId, blob as Blob & { name: string });
    drawn.set(url, URL.createObjectURL(blob));
    return url.replace('sdmedia://', '');
  });
  const params = new URLSearchParams(location.search);
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
  };
}
void main();
