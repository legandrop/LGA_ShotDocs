import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  buildSeed,
  buildSeedRoot,
  CONTENT_FRAGMENT,
  normalizeStructure,
  seedClientId,
  seedIfEmpty,
  seedTextClientId,
} from './structure';

// La semilla de las páginas nuevas y la reparación de estructura (structure.ts, Docs/Doc_Colaboracion.md).

/** La semilla de la versión 1 tal como la armaba v0.008–v0.053 (copiada acá a propósito: no se cambia). */
function seedV1(pageId: string): Uint8Array {
  let h = 0x811c9dc5;
  for (const ch of `shotdocs-seed:1:${pageId}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const doc = new Y.Doc();
  doc.clientID = h || 1;
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
  return Y.encodeStateAsUpdate(doc);
}

const fragment = (doc: Y.Doc) => doc.getXmlFragment(CONTENT_FRAGMENT);
const seedParagraph = (doc: Y.Doc) => ((fragment(doc).get(0) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlElement;

/** Escribe en el párrafo de la semilla como el editor: en el texto que haya, o en uno nuevo si no hay. */
function typeInSeed(doc: Y.Doc, text: string): void {
  doc.transact(() => {
    const paragraph = seedParagraph(doc);
    let node = paragraph.get(0) as Y.XmlText | undefined;
    if (!node) {
      node = new Y.XmlText();
      paragraph.insert(0, [node]);
    }
    node.insert(node.length, text);
  });
}

function exchange(a: Y.Doc, b: Y.Doc): void {
  const toB = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
  const toA = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
  Y.applyUpdate(b, toB);
  Y.applyUpdate(a, toA);
}

describe('la semilla', () => {
  it('la raíz es byte por byte la de la versión 1 (una versión vieja y una nueva comparten la raíz)', () => {
    for (const pageId of ['page-1', crypto.randomUUID()]) {
      expect(Buffer.from(buildSeedRoot(pageId)).equals(Buffer.from(seedV1(pageId)))).toBe(true);
    }
  });

  it('suma un texto vacío en el párrafo, con un autor fijo que sale de la página', () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, buildSeed('page-1'));
    const paragraph = seedParagraph(doc);
    expect(paragraph.length).toBe(1);
    expect(paragraph.get(0)).toBeInstanceOf(Y.XmlText);
    expect((paragraph.get(0) as Y.XmlText).length).toBe(0);
    const sv = Y.decodeStateVector(Y.encodeStateVector(doc));
    expect([...sv.keys()].sort()).toEqual([seedClientId('page-1'), seedTextClientId('page-1')].sort());
    expect(seedTextClientId('page-1')).toBe(seedTextClientId('page-1'));
    expect(seedTextClientId('page-1')).not.toBe(seedTextClientId('page-2'));
    expect(seedTextClientId('page-1')).not.toBe(seedClientId('page-1'));
    // Siempre la misma.
    expect(Buffer.from(buildSeed('page-1')).equals(Buffer.from(buildSeed('page-1')))).toBe(true);
  });

  it('se aplica en una sola transacción (docs.ts la guarda entera con la primera edición)', () => {
    const doc = new Y.Doc();
    const updates: Uint8Array[] = [];
    doc.on('update', (u: Uint8Array) => updates.push(u));
    expect(seedIfEmpty(doc, 'page-1', 'seed')).toBe(true);
    expect(updates).toHaveLength(1);
    expect(seedIfEmpty(doc, 'page-1', 'seed')).toBe(false);
  });

  it('dos dispositivos nuevos que escriben a la vez en la página nueva escriben en el MISMO texto', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    seedIfEmpty(a, 'page-1', 'seed');
    seedIfEmpty(b, 'page-1', 'seed');
    typeInSeed(a, 'de A');
    typeInSeed(b, 'de B');
    exchange(a, b);
    for (const doc of [a, b]) {
      expect(fragment(doc).length).toBe(1);
      expect(seedParagraph(doc).length).toBe(1);
      const text = seedParagraph(doc).get(0).toString();
      expect(text).toContain('de A');
      expect(text).toContain('de B');
      expect(normalizeStructure(doc, 'repair')).toBe(false);
    }
  });

  it('una versión vieja (semilla 1) y una nueva a la vez: una sola raíz, nada que reparar, nada se pierde', () => {
    const old = new Y.Doc();
    const fresh = new Y.Doc();
    Y.applyUpdate(old, seedV1('page-1'));
    seedIfEmpty(fresh, 'page-1', 'seed');
    typeInSeed(old, 'vieja');
    typeInSeed(fresh, 'nueva');
    exchange(old, fresh);
    for (const doc of [old, fresh]) {
      expect(fragment(doc).length).toBe(1);
      expect(normalizeStructure(doc, 'repair')).toBe(false);
      const texts = seedParagraph(doc).toArray().map(String).join('');
      expect(texts).toContain('vieja');
      expect(texts).toContain('nueva');
    }
    // El párrafo queda con dos textos (lo mismo que pasaba antes entre dos dispositivos): el editor los muestra
    // juntos. Solo pasa mientras convivan versiones.
    expect(seedParagraph(fresh).length).toBe(2);
  });

  it('una página sembrada por una versión vieja no se vuelve a sembrar', () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, seedV1('page-1'));
    const before = Y.encodeStateAsUpdate(doc);
    expect(seedIfEmpty(doc, 'page-1', 'seed')).toBe(false);
    expect(normalizeStructure(doc, 'repair')).toBe(false);
    expect(Buffer.from(Y.encodeStateAsUpdate(doc)).equals(Buffer.from(before))).toBe(true);
  });
});

// --- Reparación de bloques ------------------------------------------------------------------------------

function paragraph(text: string, type = 'paragraph', attrs: Record<string, string> = {}): Y.XmlElement {
  const p = new Y.XmlElement(type);
  for (const [k, v] of Object.entries(attrs)) p.setAttribute(k, v);
  const t = new Y.XmlText();
  t.insert(0, text);
  p.insert(0, [t]);
  return p;
}

function block(id: string, kids: (Y.XmlElement | Y.XmlText)[]): Y.XmlElement {
  const c = new Y.XmlElement('blockContainer');
  c.setAttribute('id', id);
  c.insert(0, kids);
  return c;
}

function group(blocks: Y.XmlElement[]): Y.XmlElement {
  const g = new Y.XmlElement('blockGroup');
  g.insert(0, blocks);
  return g;
}

/** Un documento con esa raíz, escrita por un autor fijo (así dos copias parten de lo mismo). */
function docWith(root: () => Y.XmlElement): Y.Doc {
  const doc = new Y.Doc();
  doc.clientID = 1;
  fragment(doc).insert(0, [root()]);
  return doc;
}

const clone = (doc: Y.Doc) => {
  const c = new Y.Doc();
  Y.applyUpdate(c, Y.encodeStateAsUpdate(doc));
  return c;
};

/** El documento como texto, sin los atributos de los párrafos. */
const xml = (doc: Y.Doc) => fragment(doc).toJSON();
const root = (doc: Y.Doc) => fragment(doc).get(0) as Y.XmlElement;

describe('la reparación de bloques', () => {
  it('un documento sano no se toca (ni una transacción que escriba)', () => {
    const doc = docWith(() => group([block('a', [paragraph('uno')]), block('b', [paragraph('dos'), group([block('c', [paragraph('tres')])])])]));
    const updates: Uint8Array[] = [];
    doc.on('update', (u: Uint8Array) => updates.push(u));
    expect(normalizeStructure(doc, 'repair')).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('dos contenidos con el mismo texto (los dos cambiaron el tipo): queda el primero', () => {
    const doc = docWith(() => group([block('a', [paragraph('alpha', 'heading', { level: '2' }), paragraph('alpha', 'heading', { level: '3' })])]));
    expect(normalizeStructure(doc, 'repair')).toBe(true);
    expect(xml(doc)).toBe('<blockgroup><blockcontainer id="a"><heading level="2">alpha</heading></blockcontainer></blockgroup>');
    expect(normalizeStructure(doc, 'repair')).toBe(false);
  });

  it('dos contenidos con otro texto: el segundo pasa a ser un bloque nuevo justo debajo, con los hijos donde estaban', () => {
    const doc = docWith(() =>
      group([
        block('a', [paragraph('uno'), paragraph('otro', 'heading', { level: '1' }), group([block('c', [paragraph('hijo')])])]),
        block('b', [paragraph('dos')]),
      ]),
    );
    expect(normalizeStructure(doc, 'repair')).toBe(true);
    const blocks = root(doc).toArray() as Y.XmlElement[];
    expect(blocks.map((b) => b.getAttribute('id')?.length ?? 0).slice(1, 2)[0]).toBeGreaterThan(8);
    expect(blocks.map((b) => b.toArray().map((k) => (k as Y.XmlElement).nodeName).join('+'))).toEqual([
      'paragraph+blockGroup',
      'heading',
      'paragraph',
    ]);
    expect(blocks.map((b) => (b.get(0) as Y.XmlElement).toArray().map(String).join(''))).toEqual(['uno', 'otro', 'dos']);
  });

  it('dos grupos de hijos (los dos sangraron): quedan en uno, sin copiar lo que ya está igual', () => {
    const doc = docWith(() =>
      group([
        block('a', [
          paragraph('arriba'),
          group([block('p2', [paragraph('sangrado')])]),
          group([block('p2', [paragraph('sangrado')]), block('p9', [paragraph('otro hijo')])]),
        ]),
      ]),
    );
    expect(normalizeStructure(doc, 'repair')).toBe(true);
    expect(xml(doc)).toBe(
      '<blockgroup><blockcontainer id="a"><paragraph>arriba</paragraph><blockgroup>' +
        '<blockcontainer id="p2"><paragraph>sangrado</paragraph></blockcontainer>' +
        '<blockcontainer id="p9"><paragraph>otro hijo</paragraph></blockcontainer>' +
        '</blockgroup></blockcontainer></blockgroup>',
    );
  });

  it('un grupo antes del contenido pasa al final; un bloque con hijos y sin contenido recibe un párrafo', () => {
    const doc = docWith(() =>
      group([block('a', [group([block('c', [paragraph('hijo')])]), paragraph('contenido')]), block('b', [group([block('d', [paragraph('huérfano')])])])]),
    );
    expect(normalizeStructure(doc, 'repair')).toBe(true);
    const [a, b] = root(doc).toArray() as Y.XmlElement[];
    expect(a.toArray().map((k) => (k as Y.XmlElement).nodeName)).toEqual(['paragraph', 'blockGroup']);
    expect(b.toArray().map((k) => (k as Y.XmlElement).nodeName)).toEqual(['paragraph', 'blockGroup']);
    expect(xml(doc)).toContain('huérfano');
    expect(xml(doc)).toContain('hijo');
    expect(normalizeStructure(doc, 'repair')).toBe(false);
  });

  it('un grupo antes del contenido: se mueve el contenido, así lo que otro escribe en los hijos no se pierde', () => {
    const base = docWith(() =>
      group([block('a', [group([block('k1', [paragraph('kid1')]), block('k2', [paragraph('kid2')])]), paragraph('content')])]),
    );
    const a = clone(base);
    const b = clone(base);
    const c = clone(base);
    // Un tercer dispositivo escribe en un hijo mientras A y B reparan a la vez.
    const kid1 = (((root(c).get(0) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlElement;
    (kid1.get(0) as Y.XmlText).insert(4, ' TYPED');
    normalizeStructure(a, 'repair');
    normalizeStructure(b, 'repair');
    for (let i = 0; i < 2; i++) for (const x of [a, b, c]) for (const y of [a, b, c]) if (x !== y) exchange(x, y);
    normalizeStructure(a, 'repair');
    exchange(a, b);
    exchange(a, c);
    expect(xml(a)).toContain('kid1 TYPED');
    // Los hijos no quedan dos veces, y el contenido tampoco.
    expect(xml(a).split('kid1').length - 1).toBe(1);
    expect(xml(a).split('kid2').length - 1).toBe(1);
    expect(xml(a).split('content').length - 1).toBe(1);
    const kids = (root(a).get(0) as Y.XmlElement).toArray().map((k) => (k as Y.XmlElement).nodeName);
    expect(kids).toEqual(['paragraph', 'blockGroup']);
    expect(normalizeStructure(a, 'repair')).toBe(false);
  });

  it('un texto suelto adentro de un bloque pasa a un bloque propio (el editor si no borraba el bloque)', () => {
    const doc = new Y.Doc();
    doc.clientID = 1;
    const stray = new Y.XmlText();
    stray.insert(0, 'suelto');
    const empty = new Y.XmlText();
    fragment(doc).insert(0, [group([block('a', [paragraph('x'), stray, empty])])]);
    expect(normalizeStructure(doc, 'repair')).toBe(true);
    const blocks = root(doc).toArray() as Y.XmlElement[];
    expect(blocks.map((b) => b.toArray().map((k) => (k as Y.XmlElement).nodeName).join('+'))).toEqual(['paragraph', 'paragraph']);
    expect(xml(doc)).toContain('suelto');
    // Ya reparado: no dice que reparó ni escribe nada.
    const updates: Uint8Array[] = [];
    doc.on('update', (u: Uint8Array) => updates.push(u));
    expect(normalizeStructure(doc, 'repair')).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('un texto suelto en un grupo de bloques también pasa a un bloque propio', () => {
    const doc = new Y.Doc();
    doc.clientID = 1;
    const stray = new Y.XmlText();
    stray.insert(0, 'suelto');
    const g = new Y.XmlElement('blockGroup');
    g.insert(0, [block('a', [paragraph('x')]), stray]);
    fragment(doc).insert(0, [g]);
    expect(normalizeStructure(doc, 'repair')).toBe(true);
    const blocks = root(doc).toArray();
    expect(blocks.every((b) => b instanceof Y.XmlElement && b.nodeName === 'blockContainer')).toBe(true);
    expect(xml(doc)).toContain('suelto');
    expect(normalizeStructure(doc, 'repair')).toBe(false);
  });

  it('repara también adentro de los hijos', () => {
    const doc = docWith(() =>
      group([block('a', [paragraph('arriba'), group([block('c', [paragraph('x', 'heading', { level: '1' }), paragraph('x', 'heading', { level: '2' })])])])]),
    );
    expect(normalizeStructure(doc, 'repair')).toBe(true);
    expect(xml(doc)).toBe(
      '<blockgroup><blockcontainer id="a"><paragraph>arriba</paragraph><blockgroup><blockcontainer id="c"><heading level="1">x</heading></blockcontainer></blockgroup></blockcontainer></blockgroup>',
    );
  });

  it('la raíz vacía recibe un párrafo vacío', () => {
    const doc = docWith(() => group([]));
    expect(normalizeStructure(doc, 'repair')).toBe(true);
    const only = root(doc).get(0) as Y.XmlElement;
    expect(only.nodeName).toBe('blockContainer');
    expect((only.get(0) as Y.XmlElement).nodeName).toBe('paragraph');
  });

  it('dos dispositivos que reparan a la vez descartan lo mismo: terminan iguales y sin duplicar', () => {
    const base = docWith(() => group([block('a', [paragraph('alpha', 'heading', { level: '2' }), paragraph('alpha', 'heading', { level: '3' })])]));
    const a = clone(base);
    const b = clone(base);
    normalizeStructure(a, 'repair');
    normalizeStructure(b, 'repair');
    exchange(a, b);
    expect(xml(a)).toBe(xml(b));
    expect(xml(a).split('alpha').length - 1).toBe(1);
  });

  it('dos dispositivos que copian a la vez pueden duplicar, nunca perder', () => {
    const base = docWith(() => group([block('a', [paragraph('uno'), paragraph('otro')])]));
    const a = clone(base);
    const b = clone(base);
    normalizeStructure(a, 'repair');
    normalizeStructure(b, 'repair');
    exchange(a, b);
    expect(xml(a)).toBe(xml(b));
    expect(xml(a)).toContain('uno');
    expect(xml(a)).toContain('otro');
    expect(normalizeStructure(a, 'repair')).toBe(false);
  });

  it('sigue juntando las raíces sobrantes (páginas anteriores a la semilla)', () => {
    const doc = new Y.Doc();
    fragment(doc).insert(0, [group([block('a', [paragraph('uno')])]), group([block('b', [paragraph('dos')])])]);
    expect(normalizeStructure(doc, 'repair')).toBe(true);
    expect(fragment(doc).length).toBe(1);
    expect(xml(doc)).toContain('uno');
    expect(xml(doc)).toContain('dos');
  });
});
