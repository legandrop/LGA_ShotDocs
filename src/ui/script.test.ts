// @vitest-environment jsdom
import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { schema, scriptMarks, SCRIPT_PROP } from './editorSchema';

const editors: BlockNoteEditor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
});

// El esquema de la versión anterior (v0.014): sin la propiedad `script` en el párrafo.
const { audio: _a, file: _f, video: _v, ...oldSpecs } = defaultBlockSpecs;
const oldSchema = BlockNoteSchema.create({ blockSpecs: oldSpecs });

function mount(doc: Y.Doc, withSchema: unknown = schema): BlockNoteEditor {
  const editor = BlockNoteEditor.create(
    withCollaboration({
      schema: withSchema as typeof schema,
      collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
    }),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  editor.mount(el);
  editors.push(editor);
  return editor;
}

const tick = () => new Promise((r) => setTimeout(r, 30));
const script = (text: string) => ({ type: 'paragraph' as const, props: { [SCRIPT_PROP]: true } as never, content: text });
const kinds = (e: BlockNoteEditor) =>
  e.document.map((b) => (b.type === 'paragraph' && (b.props as Record<string, unknown>)[SCRIPT_PROP] ? 'script' : b.type));
const texts = (e: BlockNoteEditor) =>
  e.document.map((b) => (b.content as { text?: string }[] | undefined)?.map((c) => c.text).join('') ?? '');

const marked = (text: string) => scriptMarks(text).map(([a, b, kind]) => `${text.slice(a, b)}:${kind}`);

describe('marcas del guion', () => {
  it('marca lugar y momento del día en los encabezados', () => {
    expect(marked('64 INT. RESTAURANTE - DÍA')).toEqual(['INT.:place', 'DÍA:day']);
    expect(marked('12 EXT. BOSQUE - NOCHE')).toEqual(['EXT.:place', 'NOCHE:night']);
    expect(marked('3 INT./EXT. AUTO - ATARDECER')).toEqual(['INT./EXT.:place', 'ATARDECER:golden']);
    expect(marked('EXT. BEACH - DAWN')).toEqual(['EXT.:place', 'DAWN:golden']);
    expect(marked('INT. HOUSE - NIGHT')).toEqual(['INT.:place', 'NIGHT:night']);
    expect(marked('I/E CAR - DAY')).toEqual(['I/E:place', 'DAY:day']);
    // "DÍA" pegado desde macOS, con la tilde como carácter aparte.
    expect(marked('INT. BAR - DÍA')).toEqual(['INT.:place', 'DÍA:day']);
  });

  it('no marca palabras en minúscula ni pedazos de otras palabras', () => {
    expect(marked('Un día de sol, a la noche llueve.')).toEqual([]);
    expect(marked('INTERIOR del EXTRAÑO DIARIO')).toEqual([]);
    expect(marked('MEDIODÍA')).toEqual([]);
  });
});

describe('Script', () => {
  it('Enter sigue en Script y en una línea vacía sale a párrafo', () => {
    const editor = mount(new Y.Doc());
    editor.replaceBlocks(editor.document, [script('64 INT. BAR - DÍA')]);
    editor.setTextCursorPosition(editor.document[0], 'end');
    const enter = () =>
      editor.prosemirrorView!.someProp('handleKeyDown', (f) =>
        f(editor.prosemirrorView!, new KeyboardEvent('keydown', { key: 'Enter' })),
      );
    enter();
    editor.insertInlineContent('El cura come.');
    expect(kinds(editor)).toEqual(['script', 'script']);
    expect(new Set(editor.document.map((b) => b.id)).size).toBe(2);
    enter();
    enter();
    expect(kinds(editor)).toEqual(['script', 'script', 'paragraph']);
  });

  it('se marca aunque la palabra tenga partes con distinto estilo', () => {
    const editor = mount(new Y.Doc());
    editor.replaceBlocks(editor.document, [
      {
        type: 'paragraph',
        props: { [SCRIPT_PROP]: true } as never,
        content: [
          { type: 'text', text: 'IN', styles: { bold: true } },
          { type: 'text', text: 'T. BAR - NOCHE', styles: {} },
        ],
      },
    ]);
    const html = editor.domElement?.innerHTML ?? '';
    expect(html.match(/script-mark script-place/g)).toHaveLength(2); // una marca, en dos pedazos
    expect(html).toContain('script-mark script-night');
  });

  it('llega a otro dispositivo con las marcas, y un párrafo común no se marca', async () => {
    const docA = new Y.Doc();
    const a = mount(docA);
    a.replaceBlocks(a.document, [script('64 INT. RESTAURANTE - DÍA'), { type: 'paragraph', content: 'Un DÍA cualquiera.' }]);
    await tick();

    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const b = mount(docB);
    await tick();

    expect(kinds(b)).toEqual(['script', 'paragraph']);
    const html = b.domElement?.innerHTML ?? '';
    expect(html).toContain('script-line');
    expect(html.match(/script-mark/g)).toHaveLength(2);
  });

  it('una app con el editor anterior lo ve como párrafo y no borra nada', async () => {
    const docA = new Y.Doc();
    const a = mount(docA);
    a.replaceBlocks(a.document, [script('64 INT. RESTAURANTE - DÍA'), { type: 'paragraph', content: 'Párrafo.' }]);
    await tick();

    // El dispositivo viejo abre la página, la muestra y edita otro bloque.
    const docOld = new Y.Doc();
    Y.applyUpdate(docOld, Y.encodeStateAsUpdate(docA));
    const updates: Uint8Array[] = [];
    docOld.on('update', (u: Uint8Array) => updates.push(u));
    const old = mount(docOld, oldSchema);
    await tick();
    expect(texts(old)).toEqual(['64 INT. RESTAURANTE - DÍA', 'Párrafo.']);
    old.setTextCursorPosition(old.document[1], 'end');
    old.insertInlineContent(' Editado en la versión vieja.');
    await tick();

    // Lo que el viejo manda de vuelta no borra el guion ni le saca la marca.
    for (const u of updates) Y.applyUpdate(docA, u);
    await tick();
    expect(texts(a)).toEqual(['64 INT. RESTAURANTE - DÍA', 'Párrafo. Editado en la versión vieja.']);
    expect(kinds(a)).toEqual(['script', 'paragraph']);
  });
});
