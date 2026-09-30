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

/**
 * La reparación completa, la que usa la app al abrir una página y con cada cambio que llega (docs.ts, en la
 * misma transacción que el cambio): junta las raíces sobrantes (`mergeRootGroups`) y arregla los bloques que
 * el editor no podría mostrar (`repairBlocks`). Devuelve true si tuvo que reparar algo.
 */
export function normalizeStructure(doc: Y.Doc, origin: unknown): boolean {
  let changed = false;
  doc.transact(() => {
    const merged = mergeRootGroups(doc, origin);
    changed = repairBlocks(doc, origin) || merged;
  }, origin);
  return changed;
}

/**
 * Dos cambios de estructura a la vez sobre el mismo bloque pueden dejar un bloque que el esquema del editor
 * no acepta: los dos cambian el tipo del mismo párrafo (el bloque queda con dos contenidos) o los dos
 * sangran el mismo bloque (el de arriba queda con dos grupos de hijos). y-prosemirror no muestra un bloque
 * así: lo BORRA del documento compartido, con sus hijos, y ese borrado llega a todos. Esto los arregla antes
 * de que el editor los vea:
 *
 * - Dos grupos de hijos: quedan en uno (el primero). Un hijo del segundo que ya está igual en el primero (el
 *   mismo bloque sangrado por los dos) no se copia.
 * - Dos contenidos: queda el primero. Si el otro tiene el mismo texto (los dos cambiaron el tipo del mismo
 *   párrafo), se descarta: gana uno de los dos tipos. Si tiene otro texto, pasa a ser un bloque nuevo justo
 *   debajo.
 * - Un bloque con hijos y sin contenido recibe un párrafo vacío; un grupo antes del contenido pasa al final.
 * - La raíz vacía recibe un párrafo vacío.
 *
 * Lo que queda es siempre el primero en el orden de Yjs, que es el mismo en todos los dispositivos: dos
 * dispositivos que reparan a la vez descartan lo mismo. Lo que se copia (el contenido de más con otro
 * texto, los hijos del segundo grupo) sí puede quedar dos veces si reparan a la vez: se prefiere duplicar a
 * perder. Copiar es la única forma de mover algo en Yjs: lo que otro escriba en el original justo en ese
 * momento puede no llegar a la copia (se prefiere eso a que el editor borre el bloque entero).
 *
 * No se juntan dos bloques iguales con el mismo id: el editor puede dejar dos así por un momento mientras
 * llegan cambios de otro (lo mostró la prueba al azar, con dos bloques vacíos), y borrar uno perdía lo que
 * se escribía en él.
 */
export function repairBlocks(doc: Y.Doc, origin: unknown): boolean {
  const root = doc.getXmlFragment(CONTENT_FRAGMENT).get(0);
  if (!(root instanceof Y.XmlElement) || root.nodeName !== 'blockGroup') return false;
  let changed = false;
  doc.transact(() => {
    changed = repairGroup(root, true);
  }, origin);
  return changed;
}

const BLOCK_GROUP = 'blockGroup';
const BLOCK_CONTAINER = 'blockContainer';
const isElement = (node: unknown, name?: string): node is Y.XmlElement =>
  node instanceof Y.XmlElement && (name === undefined || node.nodeName === name);
const isContent = (node: unknown): node is Y.XmlElement => isElement(node) && node.nodeName !== BLOCK_GROUP;

function repairGroup(group: Y.XmlElement, isRoot: boolean): boolean {
  let changed = false;
  // Una sola pasada por la lista (con `get(i)` en cada vuelta sería cuadrático en páginas largas).
  let inserted = 0;
  group.toArray().forEach((child, index) => {
    if (!isElement(child, BLOCK_CONTAINER)) return;
    if (!wellFormed(child)) {
      const siblings = repairContainer(child);
      if (siblings.length > 0) {
        group.insert(index + inserted + 1, siblings);
        inserted += siblings.length;
      }
      changed = true;
    }
    const sub = child.get(1);
    if (isElement(sub, BLOCK_GROUP) && repairGroup(sub, false)) changed = true;
  });
  if (isRoot && group.length === 0) {
    group.insert(0, [emptyBlock()]);
    changed = true;
  }
  return changed;
}

/**
 * Si el bloque tiene la forma que acepta el editor: un contenido y a lo sumo un grupo de hijos después. Un
 * bloque vacío (sin nada adentro) se deja como está: el editor lo saca sin perder nada.
 */
function wellFormed(container: Y.XmlElement): boolean {
  if (container.length === 0) return true;
  if (!isContent(container.get(0))) return false;
  return container.length === 1 || (container.length === 2 && isElement(container.get(1), BLOCK_GROUP));
}

/**
 * Deja el bloque con un contenido y a lo sumo un grupo de hijos, en ese orden. Devuelve los bloques nuevos
 * que van justo debajo (el contenido de más con otro texto). Si el bloque ya estaba bien no escribe nada.
 */
function repairContainer(container: Y.XmlElement): Y.XmlElement[] {
  const kids = container.toArray();
  const groups = kids.filter((k): k is Y.XmlElement => isElement(k, BLOCK_GROUP));
  const contents = kids.filter(isContent);
  const remove = (node: Y.XmlElement) => container.delete(container.toArray().indexOf(node), 1);

  // Los grupos de hijos, en el primero.
  if (groups.length > 1) {
    const keep = groups[0];
    const present = new Set(keep.toArray().map((c) => c.toJSON()));
    for (const extra of groups.slice(1)) {
      const copies: (Y.XmlElement | Y.XmlText)[] = [];
      for (const child of extra.toArray() as (Y.XmlElement | Y.XmlText)[]) {
        const json = child.toJSON();
        if (present.has(json)) continue;
        present.add(json);
        copies.push(child.clone());
      }
      if (copies.length > 0) keep.insert(keep.length, copies);
      remove(extra);
    }
  }

  // Los contenidos: queda el primero.
  const siblings: Y.XmlElement[] = [];
  if (contents.length > 1) {
    const keep = contents[0];
    for (const extra of contents.slice(1)) {
      if (!sameContent(keep, extra)) {
        const block = new Y.XmlElement(BLOCK_CONTAINER);
        block.setAttribute('id', crypto.randomUUID());
        block.insert(0, [extra.clone()]);
        siblings.push(block);
      }
      remove(extra);
    }
  } else if (contents.length === 0) {
    container.insert(0, [emptyParagraph()]);
  }

  // El grupo, después del contenido.
  const group = container.toArray().find((k): k is Y.XmlElement => isElement(k, BLOCK_GROUP));
  const content = container.toArray().find(isContent);
  if (group && content && container.toArray().indexOf(group) < container.toArray().indexOf(content)) {
    const copy = group.clone();
    remove(group);
    container.insert(container.length, [copy]);
  }
  return siblings;
}

/**
 * Si dos contenidos dicen lo mismo: el mismo texto (con sus formatos), o, sin texto, el mismo tipo con las
 * mismas propiedades (dos imágenes distintas no son lo mismo).
 */
function sameContent(a: Y.XmlElement, b: Y.XmlElement): boolean {
  const inner = (e: Y.XmlElement) => e.toArray().map((c) => c.toJSON()).join('');
  const text = inner(a);
  if (text !== inner(b)) return false;
  if (text.length > 0) return true;
  return a.toJSON() === b.toJSON();
}

function emptyParagraph(): Y.XmlElement {
  const paragraph = new Y.XmlElement('paragraph');
  paragraph.setAttribute('backgroundColor', 'default');
  paragraph.setAttribute('textColor', 'default');
  paragraph.setAttribute('textAlignment', 'left');
  paragraph.insert(0, [new Y.XmlText()]);
  return paragraph;
}

function emptyBlock(): Y.XmlElement {
  const block = new Y.XmlElement(BLOCK_CONTAINER);
  block.setAttribute('id', crypto.randomUUID());
  block.insert(0, [emptyParagraph()]);
  return block;
}

/**
 * Versión de la semilla. NUNCA se cambia el contenido de una versión ya publicada: si dos dispositivos
 * escribieran semillas distintas con el mismo autor y los mismos números, sus documentos divergirían. Un
 * formato nuevo lleva otra versión (y por lo tanto otro autor).
 *
 * La raíz sigue siendo la de la versión 1 (v0.008), byte por byte: una versión vieja de la app y una nueva
 * que empiezan la misma página a la vez siguen compartiendo la raíz (con otra versión de la raíz habría dos
 * raíces y la reparación de arriba, que puede duplicar bloques). Desde v0.054 la semilla suma una capa
 * aparte con su propio autor (`SEED_TEXT_VERSION`): el texto vacío del primer párrafo (ver `seedTextUpdate`).
 */
const SEED_VERSION = 1;
/** Versión de la capa de texto de la semilla (v0.054). Misma regla: nunca se cambia su contenido. */
const SEED_TEXT_VERSION = 1;

function fnv1a(key: string): number {
  let h = 0x811c9dc5;
  for (const ch of key) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // Los autores normales de Yjs también son de 32 bits; se evita el 0.
  return h || 1;
}

/** Autor de Yjs de la semilla: sale del id de la página, así que es el mismo en todos los dispositivos. */
export function seedClientId(pageId: string): number {
  return fnv1a(`shotdocs-seed:${SEED_VERSION}:${pageId}`);
}

/** Autor de la capa de texto de la semilla: también sale del id de la página, con otra clave. */
export function seedTextClientId(pageId: string): number {
  return fnv1a(`shotdocs-seed-text:${SEED_TEXT_VERSION}:${pageId}`);
}

/**
 * La raíz inicial de una página, idéntica a la que crea el editor al escribir en una página vacía. Cada
 * dispositivo la arma con el mismo autor y el mismo contenido, así que Yjs la reconoce como el mismo
 * cambio: dos dispositivos que empiezan la misma página sin verse terminan con UNA sola raíz, y no hace
 * falta reparar nada. Es la semilla de la versión 1, sin la capa de texto (ver `buildSeed`).
 */
export function buildSeedRoot(pageId: string): Uint8Array {
  const doc = new Y.Doc();
  doc.clientID = seedClientId(pageId);
  const group = new Y.XmlElement('blockGroup');
  const container = new Y.XmlElement('blockContainer');
  const paragraph = new Y.XmlElement('paragraph');
  doc.transact(() => {
    doc.getXmlFragment(CONTENT_FRAGMENT).insert(0, [group]);
    group.insert(0, [container]);
    container.setAttribute('id', 'initialBlockId');
    container.insert(0, [paragraph]);
    paragraph.setAttribute('backgroundColor', 'default');
    paragraph.setAttribute('textColor', 'default');
    paragraph.setAttribute('textAlignment', 'left');
  });
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}

/**
 * La capa de texto de la semilla: un texto vacío (Y.XmlText) adentro del párrafo de la raíz, con su propio
 * autor fijo. Sin él, dos dispositivos que escriben a la vez en el párrafo vacío de una página nueva crean
 * cada uno su propio texto, y el editor después los junta copiando uno en el otro y borrando el segundo: lo
 * escrito en el borrado mientras tanto se perdía (Docs/Doc_Colaboracion.md). Como es el mismo cambio en
 * todos los dispositivos, los dos escriben en el mismo texto.
 *
 * Una versión vieja de la app (sin la capa) que empieza la misma página a la vez comparte la raíz; si
 * además escribe en el párrafo antes de ver la capa, el párrafo queda con dos textos, que es lo mismo que
 * pasaba antes entre dos dispositivos: nada se duplica, y el riesgo queda solo mientras convivan versiones.
 */
function seedTextUpdate(pageId: string, root: Uint8Array): Uint8Array {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, root);
  const before = Y.encodeStateVector(doc);
  doc.clientID = seedTextClientId(pageId);
  const group = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
  const paragraph = (group.get(0) as Y.XmlElement).get(0) as Y.XmlElement;
  paragraph.insert(0, [new Y.XmlText()]);
  const update = Y.encodeStateAsUpdate(doc, before);
  doc.destroy();
  return update;
}

/**
 * La semilla completa: la raíz de la versión 1 y la capa de texto, en un solo update (se aplica en una sola
 * transacción, así `docs.ts` la guarda entera con la primera edición).
 */
export function buildSeed(pageId: string): Uint8Array {
  const root = buildSeedRoot(pageId);
  return Y.mergeUpdates([root, seedTextUpdate(pageId, root)]);
}

/** Si la página está vacía, le pone la raíz inicial. Devuelve true si la puso. */
export function seedIfEmpty(doc: Y.Doc, pageId: string, origin: unknown): boolean {
  if (doc.getXmlFragment(CONTENT_FRAGMENT).length > 0) return false;
  Y.applyUpdate(doc, buildSeed(pageId), origin);
  return doc.getXmlFragment(CONTENT_FRAGMENT).length > 0;
}
