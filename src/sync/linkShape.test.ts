// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { mountEditor, unmountAll } from '../ui/collabHarness';
import { editorSchemaOptions, schema } from '../ui/editorSchema';
import { STABLE_GAPS_MARKER } from '../ui/unknownContent';
import { block, group, textOf } from './historyTesting';
import { CHILDREN, MARK_ATTRS, NODE_ATTRS, ROOT, shapeProblem, TEXT, valueOk } from './linkShape';
import { CONTENT_FRAGMENT } from './structure';

afterEach(() => unmountAll());
const tick = () => new Promise((r) => setTimeout(r, 30));

/** El editor con las mismas opciones que el de la app, para leer su esquema. */
function realEditor(): BlockNoteEditor {
  return BlockNoteEditor.create(
    withCollaboration({
      ...editorSchemaOptions,
      collaboration: { fragment: new Y.Doc().getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
    }),
  ) as unknown as BlockNoteEditor;
}

type PropSpec = { default?: unknown; type?: string; values?: readonly unknown[] };

/** Lo que agrega `fn` sobre `doc` (para `shapeProblem`). */
function changed(doc: Y.Doc, fn: () => void): string | null {
  const before = Y.decodeStateVector(Y.encodeStateVector(doc));
  fn();
  return shapeProblem(doc, before);
}

describe('la forma de lo que escribe un link (paso 8)', () => {
  it('la lista de nodos y atributos es la del esquema real del editor', () => {
    const editor = realEditor();
    // Los nodos que y-prosemirror guarda como elemento (sin `doc` ni `text`) más la marca de los huecos estables.
    const pmNodes = Object.keys(editor.pmSchema.nodes).filter((n) => n !== 'doc' && n !== 'text');
    expect([...pmNodes, STABLE_GAPS_MARKER].sort()).toEqual(Object.keys(NODE_ATTRS).sort());
    for (const name of pmNodes) {
      const attrs = Object.keys(editor.pmSchema.nodes[name].spec.attrs ?? {}).sort();
      expect([name, attrs]).toEqual([name, Object.keys(NODE_ATTRS[name]).sort()]);
    }
    // Los bloques: el tipo de cada propiedad es el de su valor por defecto (o el declarado) y sus valores, los del esquema.
    const specs = (schema as unknown as { blockSpecs: Record<string, { config: { propSchema: Record<string, PropSpec> } }> }).blockSpecs;
    for (const [name, spec] of Object.entries(specs)) {
      for (const [prop, p] of Object.entries(spec.config.propSchema)) {
        const rule = NODE_ATTRS[name][prop];
        const kind = p.type ?? typeof p.default;
        expect([name, prop, rule.type]).toEqual([name, prop, kind]);
        expect([name, prop, rule.values ?? null]).toEqual([name, prop, p.values ?? null]);
        // Sin valor por defecto: el editor guarda `undefined` (siempre vale) o nada.
        if (p.default === undefined) expect([name, prop, rule.nullable]).toEqual([name, prop, true]);
      }
    }
    // Las marcas y sus atributos.
    expect(Object.keys(editor.pmSchema.marks).sort()).toEqual(Object.keys(MARK_ATTRS).sort());
    for (const [name, type] of Object.entries(editor.pmSchema.marks)) {
      expect([name, Object.keys(type.spec.attrs ?? {}).sort()]).toEqual([name, Object.keys(MARK_ATTRS[name]).sort()]);
    }
  });

  it('los hijos de cada nodo son los que acepta su `contentMatch` en el esquema real (B2)', () => {
    const editor = realEditor();
    const nodes = editor.pmSchema.nodes as Record<string, { contentMatch: unknown; spec: { lgaGapText?: boolean } }>;
    type Match = { edgeCount: number; edge(n: number): { type: { name: string }; next: Match } };
    /** Todos los tipos que el contenido de un nodo acepta en algún lugar (recorriendo el autómata). */
    const reachable = (start: Match): string[] => {
      const seen = new Set<Match>();
      const out = new Set<string>();
      const todo = [start];
      while (todo.length) {
        const m = todo.pop()!;
        if (seen.has(m)) continue;
        seen.add(m);
        for (let i = 0; i < m.edgeCount; i++) {
          const e = m.edge(i);
          out.add(e.type.name === 'text' ? TEXT : e.type.name);
          todo.push(e.next);
        }
      }
      // La marca de los renglones con fotos (solo en Yjs) va donde va una foto.
      if (out.has('photo')) out.add(STABLE_GAPS_MARKER);
      return [...out].sort();
    };
    for (const name of Object.keys(nodes).filter((n) => n !== 'text')) {
      const key = name === 'doc' ? ROOT : name;
      expect([key, reachable(nodes[name].contentMatch as Match)]).toEqual([key, [...CHILDREN[key]].sort()]);
    }
    expect([STABLE_GAPS_MARKER, CHILDREN[STABLE_GAPS_MARKER]]).toEqual([STABLE_GAPS_MARKER, []]);
  });

  it('topes a los números (B3)', () => {
    expect(valueOk(NODE_ATTRS.tableCell.colspan, 100_000_000)).toBe(false);
    expect(valueOk(NODE_ATTRS.tableCell.colspan, 0)).toBe(false);
    expect(valueOk(NODE_ATTRS.tableCell.rowspan, -3)).toBe(false);
    expect(valueOk(NODE_ATTRS.tableCell.colspan, 1.5)).toBe(false);
    expect(valueOk(NODE_ATTRS.tableCell.colspan, 50)).toBe(true);
    expect(valueOk(NODE_ATTRS.tableCell.colwidth, Array(51).fill(100))).toBe(false);
    expect(valueOk(NODE_ATTRS.tableCell.colwidth, [1e9])).toBe(false);
    expect(valueOk(NODE_ATTRS.image.previewWidth, 1e9)).toBe(false);
    expect(valueOk(NODE_ATTRS.numberedListItem.start, '999999999')).toBe(false);
    expect(valueOk(NODE_ATTRS.photo.w, 0.25)).toBe(true);
    expect(valueOk(NODE_ATTRS.heading.level, '2.000')).toBe(true);
  });

  it('todo lo que guarda el editor real tiene la forma (cada propiedad propia de la app, R3)', async () => {
    const doc = new Y.Doc();
    const before = Y.decodeStateVector(Y.encodeStateVector(doc));
    const e = mountEditor(doc);
    e.replaceBlocks(e.document, [
      { type: 'heading', props: { level: 3, isToggleable: true } as never, content: 'Escena' },
      {
        type: 'paragraph',
        props: { script: true, textAlignment: 'center', textColor: 'red', backgroundColor: 'blue' } as never,
        content: [
          { type: 'text', text: 'neg', styles: { bold: true, italic: true, textColor: 'red', backgroundColor: 'yellow', strike: true, underline: true } },
          { type: 'text', text: 'cod', styles: { code: true } },
          { type: 'link', href: 'https://example.invalid', content: 'link' },
        ],
      },
      { type: 'paragraph', props: { question: true } as never, content: '¿Qué?' },
      { type: 'paragraph', props: { driveCard: true } as never, content: 'https://drive.google.com/file/d/abc/view' },
      { type: 'paragraph', props: { pageBreak: true } as never },
      { type: 'checkListItem', props: { checked: true } as never, content: 'x' },
      { type: 'numberedListItem', props: { start: 3 } as never, content: 'n' },
      { type: 'image', props: { url: 'sdmedia://aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', previewWidth: 300, rowWidth: 0.5 } as never },
      { type: 'image' },
      { type: 'codeBlock', props: { language: 'js' } as never, content: 'x' },
      {
        type: 'table',
        props: { thumbHeight: 120 } as never,
        content: {
          type: 'tableContent',
          columnWidths: [120, undefined],
          rows: [{ cells: [{ type: 'tableCell', props: { colspan: 1, rowspan: 1 }, content: 'a' } as never, 'b'] }],
        } as never,
      },
      { type: 'quote', content: 'q' },
      { type: 'divider' },
      { type: 'toggleListItem', content: 't' },
      { type: 'bulletListItem', content: 'b' },
    ]);
    await tick();
    expect(shapeProblem(doc, before)).toBeNull();
    // `colwidth` como lista y como nulo (achicar una columna y volverla a su ancho).
    expect(valueOk(NODE_ATTRS.tableCell.colwidth, [120])).toBe(true);
    expect(valueOk(NODE_ATTRS.tableCell.colwidth, null)).toBe(true);
    expect(valueOk(NODE_ATTRS.tableCell.colspan, 2)).toBe(true);
    expect(valueOk(NODE_ATTRS.tableHeader.rowspan, 2)).toBe(true);
    expect(valueOk(NODE_ATTRS.table.thumbHeight, 150)).toBe(true);
    expect(valueOk(NODE_ATTRS.image.rowWidth, 0.33)).toBe(true);
    expect(valueOk(NODE_ATTRS.image.rowWidth, 3)).toBe(false);
  });

  it('un número como texto de dígitos vale si su valor vale; los valores de la lista, solo esos', () => {
    const level = NODE_ATTRS.heading.level;
    expect(valueOk(level, '2')).toBe(true);
    expect(valueOk(level, 2)).toBe(true);
    expect(valueOk(level, '99')).toBe(false);
    expect(valueOk(level, 'x y')).toBe(false);
    expect(valueOk(level, { x: 1 })).toBe(false);
    expect(valueOk(NODE_ATTRS.paragraph.textAlignment, 'bogus')).toBe(false);
    expect(valueOk(NODE_ATTRS.paragraph.script, 'true')).toBe(false);
    expect(valueOk(NODE_ATTRS.paragraph.textColor, null)).toBe(false);
    expect(valueOk(NODE_ATTRS.photo.rowStart, null)).toBe(true);
    expect(valueOk(NODE_ATTRS.tableCell.colwidth, ['1'])).toBe(false);
    expect(valueOk(NODE_ATTRS.tableCell.colwidth, [150, null])).toBe(true);
  });

  it('aparta lo que el editor no puede dibujar', () => {
    const base = () => {
      const d = new Y.Doc({ gc: false });
      group(d).push([block('b0', 'cero'), block('b1', 'uno', 'heading', { level: '2' })]);
      return d;
    };
    const cases: Record<string, (d: Y.Doc) => void> = {
      mapaEnElParrafo: (d) => ((group(d).get(0) as Y.XmlElement).get(0) as Y.XmlElement).insert(0, [new Y.Map() as never]),
      mapaEnElGrupo: (d) => group(d).insert(1, [new Y.Map() as never]),
      valorSueltoEnElGrupo: (d) => (group(d) as unknown as Y.Array<unknown>).insert(1, [42 as never]),
      arrayEnLaRaiz: (d) => d.getXmlFragment(CONTENT_FRAGMENT).insert(0, [new Y.Array() as never]),
      embebidoEnElTexto: (d) => textOf(group(d).get(0) as Y.XmlElement).insertEmbed(1, { x: 1 }),
      nivelObjeto: (d) => ((group(d).get(1) as Y.XmlElement).get(0) as Y.XmlElement).setAttribute('level', { x: 1 } as never),
      nivelTexto: (d) => ((group(d).get(1) as Y.XmlElement).get(0) as Y.XmlElement).setAttribute('level', 'x y'),
      atributoQueNoExiste: (d) => ((group(d).get(0) as Y.XmlElement).get(0) as Y.XmlElement).setAttribute('onclick', 'x'),
      atributoEnElTexto: (d) => textOf(group(d).get(0) as Y.XmlElement).setAttribute('x', 'y'),
      marcaConValorRaro: (d) => textOf(group(d).get(0) as Y.XmlElement).format(0, 2, { textColor: { a: [1, 2] } }),
      marcaDesconocida: (d) => textOf(group(d).get(0) as Y.XmlElement).format(0, 2, { evil: true }),
      nodoDesconocido: (d) => group(d).push([block('z', 'z', 'fooBlock')]),
      binario: (d) => ((group(d).get(0) as Y.XmlElement).get(0) as Y.XmlElement).setAttribute('textColor', new Uint8Array([1]) as never),
    };
    for (const [name, fn] of Object.entries(cases)) {
      const d = base();
      expect([name, changed(d, () => fn(d)) !== null]).toEqual([name, true]);
      d.destroy();
    }
    // Lo honesto hecho a mano también pasa (un párrafo con texto y marcas, un número como texto).
    const d = base();
    expect(
      changed(d, () => {
        group(d).push([block('n', 'nuevo', 'heading', { level: '3', textAlignment: 'right' })]);
        textOf(group(d).get(0) as Y.XmlElement).format(0, 2, { bold: {}, link: { href: 'https://x.invalid' } });
        textOf(group(d).get(0) as Y.XmlElement).format(0, 1, { bold: null });
      }),
    ).toBeNull();
  });
});
