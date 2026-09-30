import * as Y from '@y/y';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { mediaIdOf } from './queue';

// Qué fotos y videos (`sdmedia://<id>`) usa una página, leído del documento de Yjs y no del editor: sirve
// para las páginas cerradas y para lo que llega de otros dispositivos (papelera de archivos, paso 11 de
// Docs/Plan_Workspaces.md).

/**
 * Los ids de `sdmedia://` del contenido de una página. Mira el atributo `url` de cualquier elemento, no solo
 * del bloque `image`: si una versión más nueva guardara un archivo en otro tipo de bloque, igual cuenta como
 * usado (así nunca se lo da por quitado por no reconocer el bloque).
 */
export function mediaIdsInDoc(doc: Y.Doc): Set<string> {
  const ids = new Set<string>();
  const stack: unknown[] = doc.get(CONTENT_FRAGMENT).toArray();
  while (stack.length > 0) {
    const item = stack.pop();
    if (!(item instanceof Y.Type)) continue;
    const url = item.getAttr('url') as unknown;
    const id = typeof url === 'string' ? mediaIdOf(url) : null;
    if (id) ids.add(id);
    stack.push(...item.toArray());
  }
  return ids;
}
