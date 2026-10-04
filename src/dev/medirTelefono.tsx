// Arnés de `scripts/medir-telefono.mjs` (solo para desarrollo: no entra en el build ni se publica). Monta la página real
// (`PageView`) sobre el servidor en memoria de las pruebas, sin login ni red, con párrafos de «m» que llegan a ras del
// margen derecho y 1, 12 y 120 comentarios, para que el script mida en un navegador de verdad el botón de comentar y el
// contador contra el final del texto.
import { createRoot } from 'react-dom/client';
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import '../ui/drive.css';
import '../styles.css';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { schema } from '../ui/editorSchema';
import { PageView } from '../ui/PageView';
import { TooltipLayer } from '../ui/Tooltip';
import { prefs } from '../prefs';

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

/** Cuántos comentarios lleva cada bloque con contador (el script mide cada uno): 1, 12 y 120. */
const COMMENTS: Record<string, number> = { c1: 1, c12: 12, c120: 120 };

async function main() {
  prefs.init();
  const server = new FakeServer();
  const A = await makeDevice(server);
  await A.engine.syncNow();
  const projectId = await A.tree.createProject('Proyecto de prueba');
  const pageId = await A.tree.create(null, 'Margen del teléfono', projectId);
  await A.engine.syncNow();
  const doc = await A.docs.open(pageId, { seed: true });
  const editor = BlockNoteEditor.create(
    withCollaboration({ schema, collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'o', color: '#000' } } }),
  ) as unknown as BlockNoteEditor;
  editor.mount(document.createElement('div'));
  // Renglones de «m» (la letra ancha) que llegan hasta el final del margen: lo peor que puede pasar con el texto.
  const long = 'm'.repeat(130);
  editor.replaceBlocks(editor.document, [
    { id: 'c1', type: 'paragraph', content: long },
    { id: 'c12', type: 'paragraph', content: long },
    { id: 'c120', type: 'paragraph', content: long },
    { id: 'sin', type: 'paragraph', content: long },
  ] as never);
  await new Promise((r) => setTimeout(r, 50));
  editor.unmount();
  await A.docs.flush(pageId);
  A.docs.close(pageId);
  await A.engine.syncNow();
  for (const [block, n] of Object.entries(COMMENTS)) for (let i = 0; i < n; i++) await A.comments.add(pageId, block, `c${i}`);

  createRoot(document.getElementById('root')!).render(
    <>
      <div className="main" style={{ height: '100vh', overflow: 'auto' }}>
        <ServicesContext.Provider value={services(A, server.ownerId)}>
          <PageView id={pageId} />
        </ServicesContext.Provider>
      </div>
      <TooltipLayer />
    </>,
  );
  (window as unknown as { __medir: { listo: boolean } }).__medir = { listo: true };
}
void main();
