import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import type { PageDocs } from '../sync/docs';
import type { PageTree } from '../sync/tree';
import { mediaIdOf, type MediaQueue } from './queue';

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

/**
 * Lo que hace el editor con las fotos y videos de una página al abrirla (D601). Si el documento es lo que vino del
 * servidor (la página ya existe ahí, no tiene nada propio sin guardar, sin subir ni rechazado, y guardar no está
 * fallando), cada archivo sin fila se anota sin confirmar: no se cuenta ni se manda, y la comparación del motor lo
 * confirma con lo que el servidor ya tiene (un dispositivo nuevo que abría una página de 52 fotos mandaba 52
 * `link_page_file` que no cambiaban nada y la pastilla decía «Uploading 52 changes…»). Si no, como siempre: por mandar.
 */
export async function linkOnOpen(
  deps: {
    media: Pick<MediaQueue, 'ensureLinks'>;
    docs: Pick<PageDocs, 'hasOwnUnsent' | 'getWriteError'>;
    tree: Pick<PageTree, 'hasUnsentCreate'>;
  },
  pageId: string,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  const fromServer = !deps.tree.hasUnsentCreate(pageId) && !deps.docs.getWriteError() && !(await deps.docs.hasOwnUnsent(pageId));
  await deps.media.ensureLinks(pageId, ids, { unconfirmed: fromServer });
}
