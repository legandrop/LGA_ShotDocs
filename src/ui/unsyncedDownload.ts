import type { Services } from '../services';
import { exportUnsyncedBlob } from '../sync/unsynced';

// Bajar lo que no se subió como archivo JSON: lo usan la pantalla de "sacado" y el detalle de la
// sincronización (una página que dejaron de compartir sale del árbol, pero su contenido sin subir sigue en
// el dispositivo y se puede bajar desde ahí).

/** Guarda un Blob como archivo descargado. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Arma el archivo con todo lo pendiente del dispositivo y lo baja. */
export async function downloadUnsynced(services: Services, workspaceName: string): Promise<void> {
  const { db, mediaDb, commentsDb, docs, tree, user, workspace } = services;
  await docs.flush();
  const blob = await exportUnsyncedBlob(
    db,
    mediaDb,
    {
      appVersion: __APP_VERSION__,
      workspace: { url: workspace.config.url, localKey: workspace.config.localKey, name: workspaceName },
      user: { id: user.id, email: user.email },
      titleOf: (id) => tree.get(id)?.title,
    },
    commentsDb,
  );
  saveBlob(blob, `shotdocs-unsynced-${new Date().toISOString().slice(0, 10)}.json`);
}
