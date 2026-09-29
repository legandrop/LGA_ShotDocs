import * as Y from 'yjs';

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
  const fragment = doc.getXmlFragment(CONTENT_FRAGMENT);
  if (fragment.length <= 1) return false;
  const roots = fragment.toArray();
  const first = roots.find((r): r is Y.XmlElement => r instanceof Y.XmlElement);
  if (!first) return false;
  doc.transact(() => {
    for (const extra of roots) {
      if (extra === first) continue;
      const blocks = extra instanceof Y.XmlElement ? extra.toArray() : [];
      const copies = blocks.map((b) => (b as Y.XmlElement | Y.XmlText).clone());
      if (copies.length > 0) first.insert(first.length, copies);
    }
    const firstIndex = roots.indexOf(first);
    if (fragment.length > firstIndex + 1) fragment.delete(firstIndex + 1, fragment.length - firstIndex - 1);
    if (firstIndex > 0) fragment.delete(0, firstIndex);
  }, origin);
  return true;
}
