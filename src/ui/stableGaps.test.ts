// @vitest-environment jsdom
import type { BlockNoteEditor, PartialBlock } from '@blocknote/core';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { updateYFragment, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT, normalizeStructure } from '../sync/structure';
import { mountEditor, pmFromY, seeded, showsDoc, tick, unmountAll, view } from './collabHarness';
import { GAP_TEXT_SPEC, PHOTO } from './inlinePhoto';
import { brokenGaps, para, photo, photosIn, previousSchema, textEnds } from './photoHarness';
import { STABLE_GAPS_MARKER } from './unknownContent';

// Los huecos estables (Docs/Doc_Colaboracion.md, "Huecos estables"; patches/y-prosemirror+1.3.7.patch): en un
// renglón con fotos en línea, ningún texto de Yjs se borra ni se vuelve a crear. Borrar una foto saca solo la
// foto y los textos de los dos lados quedan seguidos; el editor los lee como un solo texto y escribe cada
// cambio en el texto que tiene esa posición. Lo de dos personas a la vez está en collabPhotos*.test.ts.

afterEach(unmountAll);

const top = para('p0', ['top']);

/** Un documento armado por un editor con ese contenido (y el editor desmontado). */
function docWith(blocks: PartialBlock[]): Y.Doc {
  const doc = new Y.Doc();
  const E = mountEditor(doc, 'x');
  E.replaceBlocks(E.document, blocks as never);
  unmountAll();
  return doc;
}

/** Una copia del documento, y los cambios que salgan de ella. */
function copyOf(doc: Y.Doc): { doc: Y.Doc; updates: Uint8Array[] } {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  const updates: Uint8Array[] = [];
  copy.on('update', (u: Uint8Array) => updates.push(u));
  return { doc: copy, updates };
}

/** El contenido (párrafo, título...) del bloque número `i` de la página. */
const contentOf = (doc: Y.Doc, i: number) =>
  ((doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).get(i) as Y.XmlElement).get(0) as Y.XmlElement;

/** Cómo está guardado un renglón: `"texto"` por texto (con `*` si no lleva la marca) y `<nombre>` por elemento. */
const stored = (el: Y.XmlElement) =>
  el
    .toArray()
    .map((c) =>
      c instanceof Y.XmlText
        ? `${c.getAttribute(GAP_TEXT_SPEC) === true ? '' : '*'}${JSON.stringify(c.toString().replace(/<[^>]+>/g, ''))}`
        : `<${(c as Y.XmlElement).nodeName}>`,
    )
    .join(' ');

const textsOf = (el: Y.XmlElement) => el.toArray().filter((c): c is Y.XmlText => c instanceof Y.XmlText);

/** El principio y el final del contenido del bloque `p1` en el editor. */
function rangeOf(E: BlockNoteEditor): [number, number] {
  const ends = textEnds(E);
  return [ends[2], ends[3]];
}

function dispatch(E: BlockNoteEditor, f: (tr: ReturnType<typeof view>['state']['tr']) => unknown): void {
  const v = view(E);
  const tr = v.state.tr;
  f(tr);
  v.dispatch(tr);
}

describe('borrar una foto deja los textos de los dos lados, seguidos, y se leen como uno', () => {
  it('ida y vuelta: Yjs → editor → Yjs no cambia nada; los textos son los mismos de antes', async () => {
    const doc = docWith([top, para('p1', ['abc', photo('F1'), 'def', photo('F2'), 'ghi'])]);
    const p = contentOf(doc, 1);
    const before = textsOf(p);
    expect(stored(p)).toBe('<lgaStableGaps> "abc" <photo> "def" <photo> "ghi"');

    const E = mountEditor(doc);
    for (const f of photosIn(E).reverse()) dispatch(E, (tr) => tr.delete(f.pos, f.pos + 1));
    // Solo se fueron las fotos: los tres textos son los mismos objetos de Yjs, con la marca.
    expect(stored(p)).toBe('<lgaStableGaps> "abc" "def" "ghi"');
    expect(textsOf(p)).toEqual(before);
    expect(before.every((t) => !t._item!.deleted)).toBe(true);
    // El editor los muestra como un solo texto, y es lo que se lee de Yjs.
    const block = view(E).state.doc.nodeAt(rangeOf(E)[0] - 1)!;
    expect(block.childCount).toBe(1);
    expect(block.textContent).toBe('abcdefghi');
    expect(showsDoc(E, doc)).toBe(true);

    // Otro dispositivo abre la página: la ve igual y no escribe nada.
    const { doc: other, updates } = copyOf(doc);
    const B = mountEditor(other, 'b');
    await tick(20);
    expect(updates).toEqual([]);
    expect(B.document).toEqual(E.document);
    // Escribir algo en otro bloque tampoco toca este renglón.
    const others = textsOf(contentOf(other, 1));
    B.setTextCursorPosition('p0', 'end');
    B.insertInlineContent('!');
    expect(stored(contentOf(other, 1))).toBe('<lgaStableGaps> "abc" "def" "ghi"');
    expect(textsOf(contentOf(other, 1))).toEqual(others);
  });

  it('lo que se escribe donde se tocan dos textos va al final del de la izquierda', () => {
    const doc = docWith([top, para('p1', ['abc', photo('F1'), 'def'])]);
    const p = contentOf(doc, 1);
    const E = mountEditor(doc);
    const f = photosIn(E)[0];
    dispatch(E, (tr) => tr.delete(f.pos, f.pos + 1));
    const [start] = rangeOf(E);
    dispatch(E, (tr) => tr.insertText('X', start + 3));
    expect(stored(p)).toBe('<lgaStableGaps> "abcX" "def"');
    // Al principio y al final del renglón: en el primero y en el último.
    dispatch(E, (tr) => tr.insertText('Y', start));
    dispatch(E, (tr) => tr.insertText('Z', rangeOf(E)[1]));
    expect(stored(p)).toBe('<lgaStableGaps> "YabcX" "defZ"');
    // Borrar a los dos lados del borde borra letras de los dos textos (los textos quedan).
    dispatch(E, (tr) => tr.delete(start + 4, start + 6));
    expect(stored(p)).toBe('<lgaStableGaps> "Yabc" "efZ"');
    // Borrar todo deja los textos vacíos (no se borran).
    dispatch(E, (tr) => tr.delete(rangeOf(E)[0], rangeOf(E)[1]));
    expect(stored(p)).toBe('<lgaStableGaps> "" ""');
    dispatch(E, (tr) => tr.insertText('q', rangeOf(E)[0]));
    expect(stored(p)).toBe('<lgaStableGaps> "q" ""');
    expect(showsDoc(E, doc)).toBe(true);
  });

  it('una foto en el medio de un texto deja la parte izquierda en su lugar y crea un texto a la derecha', () => {
    const doc = docWith([top, para('p1', ['abc', photo('F1'), 'def'])]);
    const p = contentOf(doc, 1);
    const [abc, def] = textsOf(p);
    const E = mountEditor(doc);
    const [start] = rangeOf(E);
    dispatch(E, (tr) => tr.insert(start + 5, view(E).state.schema.nodes[PHOTO].create({ name: 'F2' })));
    expect(stored(p)).toBe('<lgaStableGaps> "abc" <photo> "d" <photo> "ef"');
    expect(textsOf(p).slice(0, 2)).toEqual([abc, def]);
    // Un cambio de ancho no vuelve a crear la foto (la 0 es la marca del renglón).
    const photoEl = p.get(2);
    dispatch(E, (tr) => tr.setNodeAttribute(photosIn(E)[0].pos, 'w', 0.5));
    expect(p.get(2)).toBe(photoEl);
    expect((photoEl as Y.XmlElement).getAttribute('w')).toBe(0.5);
    expect(showsDoc(E, doc)).toBe(true);
  });

  it('los formatos que cruzan el borde entre dos textos se guardan en los dos y se leen igual', async () => {
    const doc = docWith([top, para('p1', ['abc', photo('F1'), 'def'])]);
    const E = mountEditor(doc);
    const f = photosIn(E)[0];
    dispatch(E, (tr) => tr.delete(f.pos, f.pos + 1));
    const [start] = rangeOf(E);
    const bold = view(E).state.schema.marks.bold.create();
    dispatch(E, (tr) => tr.addMark(start + 2, start + 4, bold));
    expect(textsOf(contentOf(doc, 1)).map((t) => t.toDelta())).toEqual([
      [{ insert: 'ab' }, { insert: 'c', attributes: { bold: {} } }],
      [{ insert: 'd', attributes: { bold: {} } }, { insert: 'ef' }],
    ]);
    expect(showsDoc(E, doc)).toBe(true);
    const { doc: other, updates } = copyOf(doc);
    const B = mountEditor(other, 'b');
    await tick(20);
    expect(updates).toEqual([]);
    expect(B.document).toEqual(E.document);
  });

  it('el renglón sigue así después de borrar su última foto (por la marca), y un párrafo sin fotos no la lleva', () => {
    const doc = docWith([para('p0', ['solo texto']), para('p1', ['abc', photo('F1')])]);
    expect(stored(contentOf(doc, 0))).toBe('*"solo texto"');
    const E = mountEditor(doc);
    dispatch(E, (tr) => tr.delete(photosIn(E)[0].pos, photosIn(E)[0].pos + 1));
    expect(stored(contentOf(doc, 1))).toBe('<lgaStableGaps> "abc" ""');
    // Una foto nueva al final, donde se tocan los dos textos: va entre los dos (ninguno se toca).
    const [abc, empty] = textsOf(contentOf(doc, 1));
    dispatch(E, (tr) => tr.insert(rangeOf(E)[1], view(E).state.schema.nodes[PHOTO].create({ name: 'F2' })));
    expect(stored(contentOf(doc, 1))).toBe('<lgaStableGaps> "abc" <photo> ""');
    expect(textsOf(contentOf(doc, 1))).toEqual([abc, empty]);
    // El otro párrafo, escrito por el camino de siempre: sin marca.
    E.setTextCursorPosition('p0', 'end');
    E.insertInlineContent('!');
    expect(stored(contentOf(doc, 0))).toBe('*"solo texto!"');
  });

  it('la reparación de estructura conserva la marca de los textos y la del renglón al copiarlo', () => {
    const doc = docWith([top, para('p1', ['abc', photo('F1'), 'def'])]);
    const E = mountEditor(doc);
    dispatch(E, (tr) => tr.delete(photosIn(E)[0].pos, photosIn(E)[0].pos + 1));
    unmountAll();
    // Un segundo contenido en el mismo bloque (como cuando dos cambian el tipo a la vez): la reparación deja el
    // primero y pasa el otro, copiado, a un bloque nuevo.
    const container = (doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).get(1) as Y.XmlElement;
    const extra = new Y.XmlElement('heading');
    const t1 = new Y.XmlText('uno');
    t1.setAttribute(GAP_TEXT_SPEC, true);
    const t2 = new Y.XmlText('dos');
    t2.setAttribute(GAP_TEXT_SPEC, true);
    extra.insert(0, [new Y.XmlElement(STABLE_GAPS_MARKER), t1, t2]);
    container.insert(1, [extra]);
    expect(normalizeStructure(doc, 'repair')).toBe(true);
    expect(stored(contentOf(doc, 2))).toBe('<lgaStableGaps> "uno" "dos"');
  });
});

describe('la versión anterior (sin `photo` en el esquema) y un renglón al que le borraron todas las fotos', () => {
  it('lo abre sin escribir nada y lo muestra igual; escribir ahí no pierde texto', async () => {
    const doc = docWith([top, para('p1', ['abc', photo('F1'), 'def', photo('F2'), 'ghi'])]);
    const E = mountEditor(doc);
    for (const f of photosIn(E).reverse()) dispatch(E, (tr) => tr.delete(f.pos, f.pos + 1));
    unmountAll();
    const { doc: copy, updates } = copyOf(doc);
    const old = mountEditor(copy, 'old', previousSchema);
    await tick(20);
    expect(updates).toEqual([]);
    expect(old.document[1].content).toEqual([{ type: 'text', text: 'abcdefghi', styles: {} }]);
    old.setTextCursorPosition('p1', 'end');
    old.insertInlineContent('!');
    expect(textsOf(contentOf(copy, 1)).map((t) => t.toString()).join('')).toBe('abcdefghi!');
  });
});

// --- Un editor al azar ------------------------------------------------------------------------------------

/** Pasos al azar sobre el bloque `p1`. Devuelve los documentos del editor, uno por paso (con el inicial). */
function randomEdits(E: BlockNoteEditor, rand: () => number, steps: number, check: (step: string) => void, { photos = true } = {}): PMNode[] {
  const states: PMNode[] = [view(E).state.doc];
  const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)];
  const between = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
  const kinds = photos
    ? ['type', 'type', 'type', 'del', 'del', 'photo', 'photo', 'delphoto', 'move', 'width', 'bold', 'unbold', 'break']
    : ['type', 'type', 'type', 'del', 'del', 'bold', 'unbold', 'break'];
  for (let i = 0; i < steps; i++) {
    const kind = pick(kinds);
    const [start, end] = rangeOf(E);
    const schema = view(E).state.schema as Schema;
    const ph = photosIn(E).filter((p) => p.pos >= start && p.pos < end);
    switch (kind) {
      case 'type':
        dispatch(E, (tr) => tr.insertText(pick(['x', 'yz', `{${i}}`, 'ab', 'é']), between(start, end)));
        break;
      case 'del': {
        if (end === start) break;
        const a = between(start, end - 1);
        dispatch(E, (tr) => tr.delete(a, Math.min(end, a + 1 + Math.floor(rand() * 4))));
        break;
      }
      case 'photo':
        dispatch(E, (tr) => tr.insert(between(start, end), schema.nodes[PHOTO].create({ name: `F${i}`, w: pick([0, 0.5]) })));
        break;
      case 'delphoto':
        if (ph.length) {
          const p = pick(ph);
          dispatch(E, (tr) => tr.delete(p.pos, p.pos + 1));
        }
        break;
      case 'move':
        if (ph.length) {
          const p = pick(ph);
          const to = between(start, end);
          const node = view(E).state.doc.nodeAt(p.pos)!;
          dispatch(E, (tr) => tr.delete(p.pos, p.pos + 1).insert(tr.mapping.map(to), node));
        }
        break;
      case 'width':
        if (ph.length) {
          const p = pick(ph);
          dispatch(E, (tr) => tr.setNodeAttribute(p.pos, 'w', p.w === 1 ? 0.25 : 1));
        }
        break;
      case 'bold':
      case 'unbold': {
        if (end === start) break;
        const a = between(start, end - 1);
        const b = Math.min(end, a + 1 + Math.floor(rand() * 5));
        const mark = schema.marks.bold;
        // Solo sobre las letras: y-prosemirror no guarda formatos en un elemento en línea (una foto, un salto), y
        // el editor de la app tampoco los pone ahí.
        const texts: [number, number][] = [];
        view(E).state.doc.nodesBetween(a, b, (n, pos) => {
          if (n.isText) texts.push([Math.max(a, pos), Math.min(b, pos + n.nodeSize)]);
          return true;
        });
        dispatch(E, (tr) => texts.forEach(([x, y]) => (kind === 'bold' ? tr.addMark(x, y, mark.create()) : tr.removeMark(x, y, mark))));
        break;
      }
      case 'break':
        dispatch(E, (tr) => tr.insert(between(start, end), schema.nodes.hardBreak.create()));
        break;
    }
    check(`${i} ${kind}`);
    states.push(view(E).state.doc);
  }
  return states;
}

const STEPS = 400;

describe(`un editor al azar (${STEPS} pasos): lo que se lee de Yjs es lo que muestra el editor`, () => {
  it('renglón con fotos: ningún texto se borra, la forma de los huecos se cumple y abrir la página no escribe', async () => {
    const doc = new Y.Doc();
    const E = mountEditor(doc);
    E.replaceBlocks(E.document, [top, para('p1', ['abc', photo('F1'), 'def', photo('F2')])] as never);
    const p = contentOf(doc, 1);
    let seen = new Set(textsOf(p));
    randomEdits(E, seeded(4242), STEPS, (step) => {
      expect(contentOf(doc, 1), step).toBe(p);
      expect(showsDoc(E, doc), step).toBe(true);
      expect(brokenGaps(doc), step).toEqual([]);
      // Ningún texto que estaba se borró (los nuevos se suman a la lista).
      expect([...seen].filter((t) => t._item!.deleted), step).toEqual([]);
      seen = new Set([...seen, ...textsOf(p)]);
      expect(textsOf(p).every((t) => t.getAttribute(GAP_TEXT_SPEC) === true), step).toBe(true);
    });
    const { doc: other, updates } = copyOf(doc);
    const B = mountEditor(other, 'b');
    await tick(20);
    expect(updates).toEqual([]);
    expect(B.document).toEqual(E.document);
  });

  it('control, renglón sin fotos (texto, negrita y saltos): por el camino de siempre, sin marca', () => {
    const doc = new Y.Doc();
    const E = mountEditor(doc);
    E.replaceBlocks(E.document, [top, para('p1', ['ab\ncd'])] as never);
    randomEdits(
      E,
      seeded(77),
      STEPS,
      (step) => {
        expect(showsDoc(E, doc), step).toBe(true);
        expect(textsOf(contentOf(doc, 1)).some((t) => t.getAttribute(GAP_TEXT_SPEC) !== undefined), step).toBe(false);
      },
      { photos: false },
    );
  });
});

// --- Los dos archivos de la librería -----------------------------------------------------------------------

describe('los dos archivos de y-prosemirror (src para el navegador, dist .cjs para require) escriben y leen igual', () => {
  // La app usa `src` (import); `dist/y-prosemirror.cjs` es la otra copia del mismo código, que el parche también
  // cambia. Se cargan las dos, cada una con su Yjs, y se les da la misma secuencia de documentos.
  const require = createRequire(import.meta.url);
  const cjsY = require('yjs') as typeof Y;
  const cjs = require('y-prosemirror') as { updateYFragment: typeof updateYFragment; yXmlFragmentToProseMirrorRootNode: typeof yXmlFragmentToProseMirrorRootNode };
  // La copia .cjs arma los nodos con su propio prosemirror-model: lee con el mismo esquema hecho con esa copia.
  const cjsModel = require('prosemirror-model') as { Schema: new (spec: unknown) => Schema };
  const cjsSchemaOf = (schema: Schema) => {
    const nodes: Record<string, unknown> = {};
    const marks: Record<string, unknown> = {};
    schema.spec.nodes.forEach((name, spec) => (nodes[name] = spec));
    schema.spec.marks.forEach((name, spec) => (marks[name] = spec));
    return new cjsModel.Schema({ nodes, marks, topNode: schema.spec.topNode });
  };

  const replay = (lib: { Y: typeof Y; update: typeof updateYFragment; read: typeof yXmlFragmentToProseMirrorRootNode }, states: PMNode[], schema: Schema) => {
    const doc = new lib.Y.Doc();
    doc.clientID = 7;
    const fragment = doc.getXmlFragment('f');
    const meta = { mapping: new Map(), isOMark: new Map() };
    return states.map((s, i) => {
      lib.update(doc, fragment, s, meta as never);
      expect(lib.read(fragment, schema).toJSON(), `paso ${i}`).toEqual(s.toJSON());
      return Buffer.from(lib.Y.encodeStateAsUpdate(doc)).toString('base64');
    });
  };

  for (const [name, photos, seed] of [
    ['renglón con fotos', true, 9191],
    ['renglón sin fotos', false, 9292],
  ] as const) {
    it(`${name}: los mismos cambios de Yjs, byte a byte, y la misma lectura`, () => {
      const E = mountEditor(new Y.Doc());
      E.replaceBlocks(E.document, [top, para('p1', photos ? ['abc', photo('F1'), 'def', photo('F2')] : ['ab\ncd'])] as never);
      const states = randomEdits(E, seeded(seed), 200, () => {}, { photos });
      const schema = view(E).state.schema as Schema;
      const esm = replay({ Y, update: updateYFragment, read: yXmlFragmentToProseMirrorRootNode }, states, schema);
      const other = replay({ Y: cjsY, update: cjs.updateYFragment, read: cjs.yXmlFragmentToProseMirrorRootNode }, states, cjsSchemaOf(schema));
      expect(other).toEqual(esm);
    });
  }

  it('lo que el editor muestra después de cada paso se lee igual de Yjs (pmFromY)', () => {
    const doc = new Y.Doc();
    const E = mountEditor(doc);
    E.replaceBlocks(E.document, [top, para('p1', [photo('F1'), photo('F2')])] as never);
    randomEdits(E, seeded(31), 50, (step) => expect(pmFromY(E, doc).eq(view(E).state.doc), step).toBe(true));
  });
});
