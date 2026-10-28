// Arnés de la simulación de un proyecto de punta a punta (solo para desarrollo: no entra en el build ni se publica; se
// abre con el servidor de desarrollo en /src/dev/simulacion.html). La app de verdad (Shell) sobre el servidor en memoria
// de las pruebas, sin login ni red, con un proyecto vacío: se arma todo desde la interfaz, como lo haría una persona
// (páginas, carpetas y su tipo, escenas, locaciones, scoutings, planes y reportes). Nada llega a Supabase; al recargar
// se pierde. `window.__sim.foto('texto')` pega una foto generada (una placa con ese texto) donde está el cursor del
// editor, como si viniera de la cámara.
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
import { pagePath } from '../router';
import { installNavHistory } from '../navHistory';

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

const COLORES = ['#3d5a80', '#7a5c3e', '#4f6d4a', '#6b4e71', '#8a4b4b', '#4a6b78'];
let fotos = 0;

/** Una placa de 1600×900 con el texto, como JPEG. */
async function placa(texto: string): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 900;
  const g = canvas.getContext('2d')!;
  g.fillStyle = COLORES[fotos++ % COLORES.length];
  g.fillRect(0, 0, 1600, 900);
  g.fillStyle = 'rgba(255,255,255,0.12)';
  for (let x = -900; x < 1600; x += 120) {
    g.beginPath();
    g.moveTo(x, 900);
    g.lineTo(x + 900, 0);
    g.lineWidth = 40;
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.stroke();
  }
  g.fillStyle = '#fff';
  g.font = '600 72px Inter, sans-serif';
  g.textAlign = 'center';
  g.fillText(texto, 800, 470);
  const blob = await new Promise<Blob>((ok) => canvas.toBlob((b) => ok(b!), 'image/jpeg', 0.85));
  return new File([blob], `${texto.replace(/[^\w-]+/g, '_')}.jpg`, { type: 'image/jpeg' });
}

/** Pega una foto generada en el editor que tiene el foco (donde está el cursor). */
async function foto(texto: string): Promise<string> {
  const target = document.activeElement?.closest('[contenteditable="true"]');
  if (!target) return 'no hay un editor con el foco: hacé clic en el renglón donde va la foto';
  const dt = new DataTransfer();
  dt.items.add(await placa(texto));
  target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  return 'pegada';
}

async function main() {
  prefs.init();
  const server = new FakeServer();
  // Con las reglas del equipo, como la base real: la persona es la dueña y lo sabe (sin esto, los permisos quedan sin
  // datos y *Create* de escenas y locaciones no se ofrece).
  server.enableTeam();
  const A = await makeDevice(server);
  await A.engine.syncNow();
  const projectId = await A.tree.createProject('La Costanera');
  // Una página para empezar: un proyecto nuevo de verdad arranca con la que crea la persona.
  const first = await A.tree.create(null, 'Inicio', projectId);
  await A.engine.syncNow();
  localStorage.setItem(legacyStorageNames(WANKA_LOCAL_KEY).project, JSON.stringify({ [server.ownerId]: projectId }));
  installNavHistory();
  history.replaceState(null, '', pagePath(first));
  createRoot(document.getElementById('root')!).render(
    <>
      <ServicesContext.Provider value={services(A, server.ownerId)}>
        <Shell />
      </ServicesContext.Provider>
      <TooltipLayer />
    </>,
  );
  (window as unknown as { __sim: unknown }).__sim = { listo: true, projectId, foto, tree: A.tree };
}
void main();
