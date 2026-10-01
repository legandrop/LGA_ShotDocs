// @vitest-environment jsdom
import type { BlockNoteEditor, PartialBlock } from '@blocknote/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { mediaIdsInDoc } from '../media/usage';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { connect, mountEditor, sameDocs, showsDoc, tick, undoManager, unmountAll, view, yText } from './collabHarness';
import { schema } from './editorSchema';
import { GAP_TEXT_SPEC, PHOTO } from './inlinePhoto';
import {
  caret,
  deletePhotoAt,
  insertPhotoAt,
  noGapsSchema,
  para,
  photo,
  photosIn,
  previousSchema,
  setPhotoWidth,
  storedInline,
  storedPhotos,
  textEnds,
  typeAtPos,
} from './photoHarness';
import { findUnknownContent, knownContent } from './unknownContent';

// La foto en línea (Docs/Doc_Fotos_En_Linea.md, entrega 1a): el nodo, cómo se guarda, el resguardo de las
// versiones anteriores y deshacer. Lo de dos personas a la vez está en collabPhotos*.test.ts.

afterEach(unmountAll);

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const sdPhoto = (name: string, w = 0) => ({ type: 'photo', props: { url: `sdmedia://${ID}`, name, w } }) as never;

/** Un documento armado por un editor con ese contenido (y el editor desmontado). */
function docWith(blocks: PartialBlock[], withSchema: unknown = schema): Y.Doc {
  const doc = new Y.Doc();
  const E = mountEditor(doc, 'x', withSchema);
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

const table = (cell: unknown[]): PartialBlock =>
  ({ id: 't1', type: 'table', content: { type: 'tableContent', rows: [{ cells: [cell, ['b']] }] } }) as never;

describe('el nodo', () => {
  it('es un nodo en línea, atómico, elegible y arrastrable, con url, name y w', () => {
    const E = mountEditor(new Y.Doc());
    const type = view(E).state.schema.nodes[PHOTO];
    expect(type.isInline && type.isAtom && type.isLeaf).toBe(true);
    expect(type.spec.selectable).toBe(true);
    expect(type.spec.draggable).toBe(true);
    expect(Object.keys(type.spec.attrs ?? {}).sort()).toEqual(['name', 'url', 'w']);
    expect(schema.inlineContentSchema.photo).toMatchObject({ type: 'photo', content: 'none' });
  });

  it('lleva la marca de los huecos que lee el parche de y-prosemirror (y el parche la lee con ese nombre)', () => {
    const E = mountEditor(new Y.Doc());
    expect(view(E).state.schema.nodes[PHOTO].spec[GAP_TEXT_SPEC]).toBe(true);
    // Ningún otro nodo la tiene (tampoco el salto de línea).
    const marked = Object.values(view(E).state.schema.nodes).filter((t) => t.spec[GAP_TEXT_SPEC]);
    expect(marked.map((t) => t.name)).toEqual([PHOTO]);
    const noGaps = mountEditor(new Y.Doc(), 'y', noGapsSchema);
    expect(view(noGaps).state.schema.nodes[PHOTO].spec[GAP_TEXT_SPEC]).toBeUndefined();
    for (const file of ['src/plugins/sync-plugin.js', 'dist/y-prosemirror.cjs']) {
      const source = readFileSync(resolve(process.cwd(), 'node_modules/y-prosemirror', file), 'utf8');
      expect(source).toContain(`n.type.spec.${GAP_TEXT_SPEC} === true`);
    }
  });

  it('se inserta por la API, en un párrafo, un título, una lista y una celda de tabla, y se lee igual', () => {
    const doc = new Y.Doc();
    const E = mountEditor(doc);
    E.replaceBlocks(E.document, [
      { id: 'p1', type: 'paragraph', content: ['antes ', sdPhoto('a.jpg', 0.5), ' después'] },
      { id: 'h1', type: 'heading', content: [sdPhoto('b.jpg')] },
      { id: 'l1', type: 'bulletListItem', content: ['ítem ', sdPhoto('c.jpg', 1 / 3)] },
      table([sdPhoto('d.jpg', 0.25)]),
    ] as never);
    E.setTextCursorPosition('p1', 'end');
    E.insertInlineContent([sdPhoto('e.jpg', 1)]);
    expect(E.getBlock('p1')!.content).toEqual([
      { type: 'text', text: 'antes ', styles: {} },
      { type: 'photo', props: { url: `sdmedia://${ID}`, name: 'a.jpg', w: 0.5 }, content: undefined },
      { type: 'text', text: ' después', styles: {} },
      { type: 'photo', props: { url: `sdmedia://${ID}`, name: 'e.jpg', w: 1 }, content: undefined },
    ]);
    expect(storedPhotos(doc)).toEqual(['a.jpg', 'e.jpg', 'b.jpg', 'c.jpg', 'd.jpg']);

    // Otro dispositivo lo ve igual.
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    const B = mountEditor(other, 'b');
    expect(B.document).toEqual(E.document);
  });

  it('copiar adentro de la app la conserva; un <img> de afuera no crea una foto en línea', async () => {
    const E = mountEditor(new Y.Doc());
    const blocks = [{ type: 'paragraph', content: ['a ', sdPhoto('x.jpg', 0.5), ' b'] }] as never;
    const html = E.blocksToFullHTML(blocks);
    expect(html).toContain('data-inline-content-type="photo"');
    const back = await E.tryParseHTMLToBlocks(html);
    expect(back[0].content).toContainEqual({ type: 'photo', props: { url: `sdmedia://${ID}`, name: 'x.jpg', w: 0.5 }, content: undefined });

    // Pegar de una web: nada de fotos en línea hasta que se publique la versión que las crea.
    const outside = await E.tryParseHTMLToBlocks('<p>uno <img src="https://example.invalid/a.jpg" alt="a"> dos</p>');
    expect(JSON.stringify(outside)).not.toContain('"photo"');
  });

  it('la vista: la imagen con su dirección, y cambiar el ancho no la vuelve a cargar ni a armar', () => {
    const E = mountEditor(new Y.Doc());
    E.replaceBlocks(E.document, [para('p1', ['a', photo('F1', 0.5)])] as never);
    const dom = view(E).dom.querySelector<HTMLElement>('.sd-photo')!;
    const img = dom.querySelector('img')!;
    expect(dom.getAttribute('data-inline-content-type')).toBe(PHOTO);
    expect(dom.contentEditable).toBe('false');
    expect(img.className).toBe('bn-visual-media');
    expect(img.draggable).toBe(false);
    expect(img.getAttribute('src')).toBe('https://example.invalid/F1.jpg');
    expect(dom.dataset).toMatchObject({ name: 'F1', w: '0.5' });

    let loads = 0;
    const original = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
    Object.defineProperty(img, 'src', {
      get: () => original.get!.call(img),
      set: (v: string) => {
        loads++;
        original.set!.call(img, v);
      },
    });
    setPhotoWidth(E, photosIn(E)[0].pos, 1);
    expect(view(E).dom.querySelector('.sd-photo img')).toBe(img);
    expect(dom.dataset.w).toBe('1');
    expect(loads).toBe(0);
    const v = view(E);
    v.dispatch(v.state.tr.setNodeAttribute(photosIn(E)[0].pos, 'url', 'https://example.invalid/F2.jpg'));
    expect(loads).toBe(1);
    expect(img.getAttribute('src')).toBe('https://example.invalid/F2.jpg');
  });

  it('una foto en línea con sdmedia:// cuenta como archivo usado por la página (media/usage.ts)', () => {
    const other = 'a1b2c3d4-e5f6-4789-8abc-def012345678';
    const doc = docWith([
      { type: 'heading', content: [sdPhoto('a.jpg')] },
      table([{ type: 'photo', props: { url: `sdmedia://${other}`, name: 'b.jpg', w: 0 } }]),
    ] as never);
    expect(mediaIdsInDoc(doc)).toEqual(new Set([ID, other]));
  });
});

describe('cómo se guarda: un texto (aunque esté vacío) a cada lado de cada foto', () => {
  const F = () => photo('F');
  const cases: [string, Parameters<typeof para>[1], string][] = [
    ['una foto sola', [F()], '"" <photo> ""'],
    ['dos fotos', [F(), F()], '"" <photo> "" <photo> ""'],
    ['texto y fotos', ['abc', F(), 'def', F()], '"abc" <photo> "def" <photo> ""'],
    ['foto y texto', [F(), 'x'], '"" <photo> "x"'],
    // El salto de línea (Shift+Enter) queda como siempre: sin textos vacíos a su lado...
    ['un salto', ['\n'], '<hardBreak>'],
    ['dos saltos', ['\n\n'], '<hardBreak> <hardBreak>'],
    ['texto, salto, texto', ['a\nb'], '"a" <hardBreak> "b"'],
    ['salto al principio y al final', ['\na\n'], '<hardBreak> "a" <hardBreak>'],
    // ...también al lado de una foto: el texto vacío va solo del lado de la foto.
    ['salto y foto', ['\n', F()], '<hardBreak> "" <photo> ""'],
    ['foto y salto', [F(), '\n'], '"" <photo> "" <hardBreak>'],
    ['dos saltos y una foto', ['\n\n', F()], '<hardBreak> <hardBreak> "" <photo> ""'],
    ['foto, salto, foto', [F(), '\n', F()], '"" <photo> "" <hardBreak> "" <photo> ""'],
  ];
  for (const [name, content, stored] of cases) {
    it(name, () => expect(storedInline(docWith([para('p1', content)]))).toEqual([stored]));
  }

  it('sin la marca, como guardaría y-prosemirror sin la parte nueva del parche (para comparar)', () => {
    expect(storedInline(docWith([para('p1', [photo('F'), photo('G')])], noGapsSchema))).toEqual(['<photo> <photo>']);
  });

  it('los párrafos sin fotos se guardan igual que en la versión anterior, escribiendo y con Shift+Enter', () => {
    const steps = (E: BlockNoteEditor) => {
      E.replaceBlocks(E.document, [para('p1', ['ab\ncd']), para('p2', ['\n'])] as never);
      const v = view(E);
      let at = -1;
      v.state.doc.descendants((n, pos) => {
        if (n.type.name === 'hardBreak' && at < 0) at = pos;
        return true;
      });
      typeAtPos(E, at, 'X');
      typeAtPos(E, at + 2, 'Y');
      caret(E, at);
      v.dispatch(v.state.tr.insert(at, v.state.schema.nodes.hardBreak.create()));
      E.setTextCursorPosition('p2', 'end');
      v.dispatch(v.state.tr.replaceSelectionWith(v.state.schema.nodes.hardBreak.create()));
    };
    const now = new Y.Doc();
    steps(mountEditor(now));
    const before = new Y.Doc();
    steps(mountEditor(before, 'b', previousSchema));
    expect(storedInline(now)).toEqual(storedInline(before));
    expect(storedInline(now)).toEqual(['"ab" <hardBreak> "X" <hardBreak> "Ycd"', '<hardBreak> <hardBreak>']);
  });

  it('agregar una foto a un renglón no vuelve a crear su texto ni sus saltos (se agrega al lado)', () => {
    const doc = docWith([para('p1', ['\nabc']), para('p2', ['abc\n'])]);
    const children = (i: number) => ((doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).get(i) as Y.XmlElement).get(0) as Y.XmlElement;
    const before = [children(0).toArray(), children(1).toArray()];
    const E = mountEditor(doc);
    // Una al final del primero y otra al principio del segundo.
    insertPhotoAt(E, textEnds(E)[1], 'F1');
    insertPhotoAt(E, textEnds(E)[2], 'F0');
    expect(storedInline(doc)).toEqual(['<hardBreak> "abc" <photo> ""', '"" <photo> "abc" <hardBreak>']);
    // Los mismos elementos de antes, en el mismo orden.
    expect(children(0).toArray().filter((c) => before[0].includes(c))).toEqual(before[0]);
    expect(children(1).toArray().filter((c) => before[1].includes(c))).toEqual(before[1]);
  });
});

describe('abrir una página no la cambia', () => {
  const docs: [string, () => Y.Doc][] = [
    ['saltos de línea (uno, seguidos, al principio y al final)', () => docWith([para('a', ['\n']), para('b', ['\n\n\nx\n\n']), para('c', ['x\ny'])])],
    ['fotos en línea en un párrafo, un título, una lista y una tabla', () =>
      docWith([para('a', [photo('F'), photo('G')]), { type: 'heading', content: ['t', sdPhoto('h')] } as never, { type: 'bulletListItem', content: [sdPhoto('i')] } as never, table([sdPhoto('j')])])],
    ['fotos y saltos juntos', () => docWith([para('a', ['\n', photo('F'), '\n\n', photo('G'), 'x\n'])])],
    ['fotos guardadas sin los huecos (otra forma)', () => docWith([para('a', [photo('F'), photo('G'), '\n'])], noGapsSchema)],
  ];
  for (const [name, make] of docs) {
    it(`${name}: montar el editor no escribe nada`, async () => {
      const { doc, updates } = copyOf(make());
      mountEditor(doc);
      await tick(20);
      expect(updates).toEqual([]);
    });
  }

  it('la versión anterior abre una página con saltos de línea sin escribir nada', async () => {
    const { doc, updates } = copyOf(docs[0][1]());
    mountEditor(doc, 'old', previousSchema);
    await tick(20);
    expect(updates).toEqual([]);
  });
});

describe('una versión anterior (sin `photo` en su esquema)', () => {
  // La lista de la versión anterior: la de esta sin `photo`.
  const previous = { nodes: new Set([...knownContent().nodes].filter((n) => n !== PHOTO)), marks: knownContent().marks };

  it('la lista de esta versión es la anterior más `photo`', () => {
    const E = mountEditor(new Y.Doc(), 'old', previousSchema);
    expect([...previous.nodes, 'doc', 'text'].sort()).toEqual(Object.keys(view(E).state.schema.nodes).sort());
  });

  const where: [string, PartialBlock][] = [
    ['un párrafo', para('p1', ['texto ', photo('F')])],
    ['un título', { type: 'heading', content: ['título ', photo('F')] } as never],
    ['un ítem de lista', { type: 'bulletListItem', content: [photo('F'), ' ítem'] } as never],
    ['una celda de tabla', table(['celda ', photo('F')])],
  ];
  for (const [name, block] of where) {
    it(`detecta una foto en línea adentro de ${name}: no abre la página`, () => {
      const doc = docWith([para('p0', ['arriba']), block]);
      expect(findUnknownContent(doc, previous)).toBe('"photo"');
      expect(findUnknownContent(doc)).toBeNull();
    });
  }

  it('si la montara igual, borraría las fotos del documento compartido (el texto queda): por eso no la abre', async () => {
    const shared = docWith([para('p1', ['antes ', photo('F'), ' medio ', photo('G')]), { type: 'heading', content: [photo('H'), 'título'] } as never]);
    const { doc, updates } = copyOf(shared);
    mountEditor(doc, 'old', previousSchema);
    await tick(20);
    // El borrado sale del dispositivo viejo como un cambio más, y llega a todos.
    expect(updates.length).toBeGreaterThan(0);
    for (const u of updates) Y.applyUpdate(shared, u);
    expect(storedPhotos(shared)).toEqual([]);
    expect(yText(shared).replace(/ \| /g, '')).toBe('antes  medio título');
  });
});

describe('deshacer (un paso, y los dos editores terminan iguales)', () => {
  async function setup() {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const net = connect(docA, docB, 'sync');
    const A = mountEditor(docA, 'a');
    const B = mountEditor(docB, 'b');
    A.replaceBlocks(A.document, [para('p1', ['abc', photo('F1', 0.5), photo('F2')])] as never);
    await tick();
    undoManager(A).stopCapturing();
    const initial = storedInline(docA);
    const check = async () => {
      net.flush();
      await tick();
      expect(sameDocs(docA, docB)).toBe(true);
      expect(showsDoc(A, docA) && showsDoc(B, docB)).toBe(true);
    };
    return { A, B, docA, docB, initial, check };
  }

  it('insertar una foto', async () => {
    const { A, docA, docB, initial, check } = await setup();
    insertPhotoAt(A, photosIn(A)[1].pos, 'F3', 1 / 3);
    await check();
    expect(storedInline(docB)).toEqual(['"abc" <photo> "" <photo> "" <photo> ""']);
    undoManager(A).stopCapturing();
    A.undo();
    await check();
    expect(storedInline(docA)).toEqual(initial);
    expect(storedPhotos(docB)).toEqual(['F1', 'F2']);
  });

  it('borrar una foto', async () => {
    const { A, docA, docB, initial, check } = await setup();
    deletePhotoAt(A, photosIn(A)[0].pos);
    await check();
    expect(storedPhotos(docB)).toEqual(['F2']);
    undoManager(A).stopCapturing();
    A.undo();
    await check();
    expect(storedInline(docA)).toEqual(initial);
    expect(photosIn(A).map((p) => [p.name, p.w])).toEqual([['F1', 0.5], ['F2', 0]]);
  });

  it('cambiar el ancho', async () => {
    const { A, B, docB, check } = await setup();
    setPhotoWidth(A, photosIn(A)[0].pos, 0.25);
    await check();
    expect(photosIn(B)[0].w).toBe(0.25);
    undoManager(A).stopCapturing();
    A.undo();
    await check();
    expect(photosIn(B).map((p) => p.w)).toEqual([0.5, 0]);
    expect(storedPhotos(docB)).toEqual(['F1', 'F2']);
  });
});
