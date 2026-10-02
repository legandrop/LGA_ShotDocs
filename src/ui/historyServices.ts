import type { Services } from '../services';
import { FileRejected } from '../sync/files';
import {
  DOCS_READS,
  ENGINE_READS,
  MemoryComments,
  OFFLINE_READS,
  PracticeWriteError,
  readOnly,
  SIZES_READS,
  TREE_READS,
} from '../tutorial/practiceServices';

// Los servicios con que se muestra una versión del historial (P.18, Docs/Doc_Historial.md, sección 1.3). La versión
// se ve con el editor de verdad (el mismo `BlockEditor`, en solo lectura) sobre un documento en memoria, adentro de
// un `ServicesContext` con los servicios del workspace pisados, como la página de práctica: nada de lo que pase ahí
// llega a la base local, al servidor ni al Drive.
//
// - `media`: el de verdad para ver (miniaturas, el carrete, los pases del portero), con lo que escribe apagado: una
//   foto de una versión vieja NUNCA se vuelve a colgar de la página (`ensureLinks`, que la sacaría de la papelera).
// - `files`: solo `resolve`.
// - `docs`, `tree`, `engine`, `remote`, `client`, `sizes` y `offline`: envueltos para que solo pasen las lecturas.
// - `comments`: vacíos, en memoria (los comentarios no tienen historial); `db`: `null` (colapsar queda en memoria).

/** Lo de la cola de fotos y videos que escribe algo (en el dispositivo, en la base o en el Drive). */
const MEDIA_WRITES = new Set([
  'add',
  'addFolder',
  'ensureLinks',
  'reconcilePage',
  'trash',
  'autoPurge',
  'clearBlocked',
  'resetForRestore',
  'configure',
  'setOutdated',
  'run',
  'stop',
  'dispose',
  'setFolderNote',
  'setFolderSize',
  'setVerified',
  'setUsageMarks',
  'forgetUsageMark',
  'ensureConverted',
  'syncGeneration',
]);

function readOnlyMedia(media: Services['media']): Services['media'] {
  return new Proxy(media, {
    get(obj, prop, receiver) {
      if (typeof prop === 'string' && MEDIA_WRITES.has(prop)) {
        if (prop === 'add' || prop === 'addFolder') return async () => Promise.reject(new FileRejected(''));
        // Lo demás no hace nada (el editor de solo lectura no debería llamarlo; si lo hace, no escribe).
        return async () => undefined;
      }
      const value = Reflect.get(obj, prop, receiver);
      return typeof value === 'function' ? value.bind(obj) : value;
    },
    set: (_obj, prop) => {
      throw new PracticeWriteError(`media.${String(prop)} =`);
    },
  });
}

const historyFiles = (files: Services['files']) => ({
  resolve: (url: string) => files.resolve(url),
  add: async () => Promise.reject(new FileRejected('')),
});

/** Los servicios del workspace con los del visor del historial encima (ver arriba). */
export function historyServices(real: Services): Services {
  return {
    workspace: real.workspace,
    user: real.user,
    client: readOnly(real.client, 'client', []),
    db: null as never,
    tree: readOnly(real.tree, 'tree', TREE_READS),
    docs: readOnly(real.docs, 'docs', DOCS_READS),
    files: historyFiles(real.files) as never,
    media: readOnlyMedia(real.media),
    engine: readOnly(real.engine, 'engine', ENGINE_READS),
    access: real.access,
    remote: readOnly(real.remote, 'remote', []),
    dbName: '',
    mediaDb: null,
    comments: new MemoryComments(real.user.id) as never,
    commentsDb: null,
    sizes: readOnly(real.sizes, 'sizes', SIZES_READS),
    offline: real.offline ? readOnly(real.offline, 'offline', OFFLINE_READS) : (undefined as never),
    shutdown: async () => {
      throw new PracticeWriteError('shutdown');
    },
    firstLoad: false,
  };
}
