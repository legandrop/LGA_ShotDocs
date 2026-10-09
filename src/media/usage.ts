import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import type { PageDocs } from '../sync/docs';
import type { PageTree } from '../sync/tree';
import { MEDIA_SCHEME, mediaIdOf, type MediaQueue } from './queue';

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

// Un id de archivo después de `sdmedia://`, aunque siga otra cosa pegada (sobra antes que faltar).
const OWN_ID = /sdmedia:\/\/([0-9a-fA-F-]{36})/g;

/**
 * Los `sdmedia://` que trae lo que este dispositivo tiene de la página y el servidor todavía no (D611): la misma
 * diferencia contra `syncedSV` que arma la subida, decodificada. Se miran los valores de todos los ítems nuevos, no
 * solo el atributo `url`, para que sobre y nunca falte: en Yjs nada vuelve a aparecer sin un ítem nuevo (pegar, mover,
 * deshacer o rehacer escriben el `url` otra vez), así que toda foto que vuelve por lo propio está acá. Escribir texto
 * junto a una foto no la trae. Sin `syncedSV` no se sabe qué es propio: `null` (quien llama manda todo).
 */
export function ownMediaIds(doc: Y.Doc, syncedSV: Uint8Array | undefined): Set<string> | null {
  if (!syncedSV) return null;
  return mediaIdsInUpdate(Y.encodeStateAsUpdate(doc, syncedSV));
}

/**
 * Los `sdmedia://` que aparecen en los ítems de un update de Yjs (también en los que el mismo update da por borrados:
 * sobra antes que faltar). Lo usan `ownMediaIds` y el envío de una página antes de subirlo (D691).
 */
export function mediaIdsInUpdate(update: Uint8Array): Set<string> {
  const out = new Set<string>();
  for (const struct of Y.decodeUpdate(update).structs) {
    if (!(struct instanceof Y.Item)) continue;
    const content = struct.content as unknown as { getContent(): unknown[]; value?: unknown; embed?: unknown };
    for (const value of [...content.getContent(), content.value, content.embed]) {
      if (typeof value !== 'string' && (typeof value !== 'object' || value === null || value instanceof Y.AbstractType)) continue;
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      for (const match of text.matchAll(OWN_ID)) {
        const id = mediaIdOf(MEDIA_SCHEME + match[1]);
        if (id) out.add(id);
      }
    }
  }
  return out;
}

/**
 * Lo que el servidor ya tiene de la página, sin las fotos que trae lo propio sin subir (D611): esas pueden haber vuelto
 * por lo propio después de que otro dispositivo las quitó, y la lectura sería vieja para ellas (A2 de trash.test.ts).
 * Las demás están en el servidor con su `seq`: un `unlink` de otro dispositivo que no las vio lo rechaza `p_seen_seq`.
 * Si no se sabe qué es propio, o el cálculo falla, `undefined`: no se le cree a la lectura y se manda todo (C1).
 */
export function serverUsesBesidesOwn<T>(
  uses: ReadonlyMap<string, T> | undefined,
  doc: Y.Doc,
  syncedSV: Uint8Array | undefined,
): ReadonlyMap<string, T> | undefined {
  if (!uses) return undefined;
  let own: Set<string> | null;
  try {
    own = ownMediaIds(doc, syncedSV);
  } catch (err) {
    console.warn('No se pudo calcular qué fotos trae lo propio sin subir; se mandan todas.', err);
    return undefined;
  }
  if (!own) return undefined;
  return new Map([...uses].filter(([id]) => !own.has(id)));
}

/**
 * Lo que hace el editor con las fotos y videos de una página al abrirla (D601, D617). Si la página ya existe en el
 * servidor y guardar no está fallando, cada archivo sin fila que vino del servidor se anota **sin confirmar**: no se
 * cuenta ni se manda, y la comparación del motor lo confirma con lo que el servidor ya tiene (un dispositivo nuevo que
 * abría una página de 52 fotos mandaba 52 `link_page_file` que no cambiaban nada). Con algo propio sin subir, lo que vino
 * del servidor es todo lo que no trae lo propio (`ownMediaIds`); lo que trae lo propio, por mandar. Si no se puede
 * saber, o algo falla, todo por mandar, como siempre: nunca queda una foto sin fila (C1).
 */
export async function linkOnOpen(
  deps: {
    media: Pick<MediaQueue, 'ensureLinks'>;
    docs: Pick<PageDocs, 'hasOwnUnsent' | 'getWriteError' | 'snapshot'>;
    tree: Pick<PageTree, 'hasUnsentCreate'>;
  },
  pageId: string,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  let fromServer: string[] = [];
  try {
    fromServer = await idsFromServer(deps, pageId, ids);
  } catch (err) {
    console.warn('No se pudo ver qué fotos de la página vinieron del servidor; quedan todas por mandar.', err);
    fromServer = [];
  }
  const baseline = new Set(fromServer);
  const rest = ids.filter((id) => !baseline.has(id));
  if (fromServer.length > 0) await deps.media.ensureLinks(pageId, fromServer, { unconfirmed: true });
  if (rest.length > 0) await deps.media.ensureLinks(pageId, rest, { unconfirmed: false });
}

/** Cuáles de `ids` vinieron del servidor con el documento (ver `linkOnOpen`). Puede tirar: quien llama manda todo. */
async function idsFromServer(
  deps: { docs: Pick<PageDocs, 'hasOwnUnsent' | 'getWriteError' | 'snapshot'>; tree: Pick<PageTree, 'hasUnsentCreate'> },
  pageId: string,
  ids: string[],
): Promise<string[]> {
  if (deps.tree.hasUnsentCreate(pageId) || deps.docs.getWriteError()) return [];
  if (!(await deps.docs.hasOwnUnsent(pageId))) return ids;
  const snap = await deps.docs.snapshot(pageId);
  try {
    // Guardar empezó a fallar mientras se leía: lo guardado no es lo que se ve.
    if (deps.docs.getWriteError()) return [];
    const own = ownMediaIds(snap.doc, snap.state.syncedSV);
    if (!own) return [];
    // Solo lo que está en lo guardado: algo que el editor tiene y todavía no se guardó no se sabe de dónde vino.
    const saved = mediaIdsInDoc(snap.doc);
    return ids.filter((id) => saved.has(id.toLowerCase()) && !own.has(id.toLowerCase()));
  } finally {
    snap.doc.destroy();
  }
}
