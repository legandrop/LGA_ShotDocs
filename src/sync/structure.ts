import * as Y from '@y/y';

/** Fragmento de Yjs donde vive el contenido de una página. No se cambia: lo usan todos los documentos. */
export const CONTENT_FRAGMENT = 'document-store';

/**
 * El editor guarda cada página como un único `blockGroup` raíz. Si dos dispositivos empiezan la misma
 * página sin haberse visto (una página nueva, o sin red), cada uno crea su raíz y al fusionarse quedan
 * dos. El editor muestra solo una y, en la próxima edición, borra la otra, que se sincroniza como un
 * borrado a todos lados.
 *
 * Esto junta los bloques de las raíces sobrantes al final de la primera y borra las sobrantes, antes de
 * que el editor las vea. Si dos dispositivos reparan a la vez, los bloques quedan duplicados: se prefiere
 * duplicar a perder. Devuelve true si tuvo que reparar.
 */
export function mergeRootGroups(doc: Y.Doc, origin: unknown): boolean {
  const fragment = doc.get(CONTENT_FRAGMENT);
  if (fragment.length <= 1) return false;
  const roots = fragment.toArray();
  const first = roots.find((r): r is Y.Type => r instanceof Y.Type);
  if (!first) return false;
  doc.transact(() => {
    for (const extra of roots) {
      if (extra === first) continue;
      const blocks = extra instanceof Y.Type ? extra.toArray() : [];
      const copies = blocks.filter((b): b is Y.Type => b instanceof Y.Type).map((b) => b.clone());
      if (copies.length > 0) first.insert(first.length, copies);
    }
    const firstIndex = roots.indexOf(first);
    if (fragment.length > firstIndex + 1) fragment.delete(firstIndex + 1, fragment.length - firstIndex - 1);
    if (firstIndex > 0) fragment.delete(0, firstIndex);
  }, origin);
  return true;
}

/**
 * Versión de la semilla. NUNCA se cambia el contenido de una versión ya publicada: si dos dispositivos
 * escribieran semillas distintas con el mismo autor y los mismos números, sus documentos divergirían. Un
 * formato nuevo lleva otra versión (y por lo tanto otro autor).
 */
// 2: formato de Yjs 14 (@y/prosemirror 2): los atributos del párrafo son todos los que escribe el editor,
// incluidos los propios (driveCard, question, script), para que el editor no reescriba la semilla al abrir.
const SEED_VERSION = 2;

/** Autor de Yjs de la semilla: sale del id de la página, así que es el mismo en todos los dispositivos. */
export function seedClientId(pageId: string): number {
  let h = 0x811c9dc5;
  for (const ch of `shotdocs-seed:${SEED_VERSION}:${pageId}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // Los autores normales de Yjs también son de 32 bits; se evita el 0.
  return h || 1;
}

/**
 * La raíz inicial de una página, idéntica a la que crea el editor al escribir en una página vacía. Cada
 * dispositivo la arma con el mismo autor y el mismo contenido, así que Yjs la reconoce como el mismo
 * cambio: dos dispositivos que empiezan la misma página sin verse terminan con UNA sola raíz, y no hace
 * falta reparar nada.
 */
export function buildSeed(pageId: string): Uint8Array {
  const doc = new Y.Doc();
  doc.clientID = seedClientId(pageId);
  const group = new Y.Type('blockGroup');
  const container = new Y.Type('blockContainer');
  const paragraph = new Y.Type('paragraph');
  doc.transact(() => {
    doc.get(CONTENT_FRAGMENT).insert(0, [group]);
    group.insert(0, [container]);
    container.setAttr('id', 'initialBlockId');
    container.insert(0, [paragraph]);
    paragraph.setAttr('backgroundColor', 'default');
    paragraph.setAttr('driveCard', false);
    paragraph.setAttr('question', false);
    paragraph.setAttr('script', false);
    paragraph.setAttr('textAlignment', 'left');
    paragraph.setAttr('textColor', 'default');
  });
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}

/** Si la página está vacía, le pone la raíz inicial. Devuelve true si la puso. */
export function seedIfEmpty(doc: Y.Doc, pageId: string, origin: unknown): boolean {
  if (doc.get(CONTENT_FRAGMENT).length > 0) return false;
  Y.applyUpdate(doc, buildSeed(pageId), origin);
  return doc.get(CONTENT_FRAGMENT).length > 0;
}
