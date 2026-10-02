import * as Y from 'yjs';
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
  return new Set(mediaCountsInDoc(doc).keys());
}

/**
 * Cuántas veces aparece cada `sdmedia://` en el contenido (la misma foto dos veces cuenta dos). Lo usa pegar una foto con
 * sus anotaciones (D46) para saber qué fotos trajo de verdad el pegado: las que aparecen más veces que antes.
 */
export function mediaCountsInDoc(doc: Y.Doc): Map<string, number> {
  const counts = new Map<string, number>();
  const stack: unknown[] = doc.getXmlFragment(CONTENT_FRAGMENT).toArray();
  while (stack.length > 0) {
    const item = stack.pop();
    if (!(item instanceof Y.XmlElement)) continue;
    const url = item.getAttribute('url') as unknown;
    const id = typeof url === 'string' ? mediaIdOf(url) : null;
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    stack.push(...item.toArray());
  }
  return counts;
}
