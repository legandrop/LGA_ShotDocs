import type { Services } from '../services';
import { existingRelationsSession } from '../ui/relationsUi';
import { markFolderHolds } from './entitySync';
import { sceneCode } from './kind';

// La carpeta de un tipo (escenas, locaciones, decorados) cuando el proyecto no tiene ninguna, y el número de escena que se
// escribió: los usa el `/e` / `/l` del editor para crear la escena o la locación con su carpeta (simulación de D813).

/** Las tres carpetas con tipo. */
export type TypedPart = 'scenes' | 'locations' | 'sets';

export const FOLDER = { scenes: 'type.scenes', locations: 'type.locations', sets: 'type.sets' } as const;
const KIND = { scenes: 'scene', locations: 'location', sets: 'set' } as const;

/**
 * El número de escena que se escribió, canónico (`059`, `105_120`), o `null`. En un largo, `59` o `Escena 59`; en una
 * serie, el número completo (`105-120`, `105_120`).
 */
export function typedSceneCode(text: string, flat: boolean): string | null {
  const t = text.trim();
  const short = /^(\d{1,3})([A-Za-z]{0,2})$/.exec(t);
  if (flat && short) return `${short[1].padStart(3, '0')}${short[2].toUpperCase()}`;
  return sceneCode(t, null, flat);
}

/** Espera a que el índice del proyecto termine de leer (como mucho `ms`). */
export function indexReady(services: Parameters<typeof existingRelationsSession>[0], projectId: string, ms = 5000): Promise<void> {
  const relations = existingRelationsSession(services)?.relations;
  if (!relations) return Promise.resolve();
  return new Promise((resolve) => {
    let stop = () => undefined as void;
    const done = () => {
      clearTimeout(timer);
      stop();
      resolve();
    };
    const timer = setTimeout(done, ms);
    const check = () => {
      if (relations.snapshot(projectId)?.complete) done();
    };
    stop = relations.subscribe(check);
    // Recién creada la carpeta, la foto vieja todavía puede decir «completa»: se mira después de que el índice la vea.
    setTimeout(check, 50);
  });
}

/**
 * Una carpeta en la raíz del proyecto con su tipo («Scenes», «Locations», «Sets»), para cuando no hay ninguna: la crea el
 * `/e` / `/l` (simulación de D813). Espera a que el índice la vea antes de volver.
 */
export async function createTypedFolder(services: Pick<Services, 'tree'> & Parameters<typeof existingRelationsSession>[0], projectId: string, part: TypedPart, label: string): Promise<void> {
  const folder = await services.tree.create(null, label, projectId);
  await markFolderHolds(services.tree, folder, KIND[part]);
  // El índice vuelve a leer con la carpeta nueva: las guardas esperan a que termine (G2).
  await indexReady(services, projectId);
}
