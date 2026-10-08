// Arnés de prueba visual (solo para desarrollo: no entra en el build ni se publica; se abre con el servidor de
// desarrollo en /src/dev/arbol-sigue.html). La app de verdad (Shell) sobre el servidor en memoria de las pruebas, sin
// login ni red, con un árbol largo y una página con un link a una página lejana: sirve para mirar en un navegador de
// verdad cómo el árbol sigue a la página que se abre por un link (`window.__arbol` trae los ids).
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
import { Shell } from '../ui/Workspace';
import { TooltipLayer } from '../ui/Tooltip';
import { prefs } from '../prefs';
import { pagePath } from '../router';

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

async function main() {
  prefs.init();
  const server = new FakeServer();
  const A = await makeDevice(server);
  await A.engine.syncNow();
  const p = await A.tree.createProject('ERSO prueba');
  const index = await A.tree.create(null, 'Index', p);
  const shooting = await A.tree.create(null, 'Shooting', p);
  for (let i = 1; i <= 45; i++) await A.tree.create(shooting, `Day ${String(i).padStart(2, '0')}`, p);
  const scenes = await A.tree.create(null, 'Scenes', p);
  let far = '';
  for (let i = 100; i <= 125; i++) {
    const id = await A.tree.create(scenes, `Scene ${i}`, p);
    if (i === 120) far = id;
  }
  await A.engine.syncNow();
  const doc = await A.docs.open(index, { seed: true });
  const editor = BlockNoteEditor.create(
    withCollaboration({ schema, collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'o', color: '#000' } } }),
  ) as unknown as BlockNoteEditor;
  editor.mount(document.createElement('div'));
  editor.replaceBlocks(editor.document, [
    { type: 'paragraph', content: [{ type: 'text', text: 'Link to ', styles: {} }, { type: 'link', href: location.origin + pagePath(far), content: 'Scene 120' }] },
  ] as never);
  await new Promise((r) => setTimeout(r, 50));
  editor.unmount();
  await A.docs.flush(index);
  A.docs.close(index);
  await A.engine.syncNow();
  // El árbol con Shooting abierto (lo que deja la persona al recorrer los días): Scenes queda cerrada y abajo.
  localStorage.setItem('shotdocs-expanded', JSON.stringify([shooting]));
  history.replaceState(null, '', pagePath(index));
  createRoot(document.getElementById('root')!).render(
    <>
      <ServicesContext.Provider value={services(A, server.ownerId)}>
        <Shell />
      </ServicesContext.Provider>
      <TooltipLayer />
    </>,
  );
  (window as unknown as { __arbol: unknown }).__arbol = { listo: true, far, index };
}
void main();
