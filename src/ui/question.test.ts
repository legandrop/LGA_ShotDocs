// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { paragraphProps, QUESTION_PROP, schema, SCRIPT_PROP } from './editorSchema';
import { schema as mainSchema } from './fixtures/editorSchemaMain';
import { findUnknownContent, knownContent } from './unknownContent';

// Preguntas (paso 10): un párrafo con `question: true`, nunca un tipo de bloque nuevo. La versión publicada
// (el esquema de `main`, copiado en fixtures/) no conoce la propiedad: tiene que abrir la página, mostrar el
// texto y no borrar el párrafo; si edita esa línea, se pierde solo la marca (el texto y el id del bloque,
// al que están anclados los comentarios, quedan).

const editors: BlockNoteEditor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
});

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
const question = (text: string) => ({ type: 'paragraph' as const, props: paragraphProps('question') as never, content: text });
const kinds = (e: BlockNoteEditor) =>
  e.document.map((b) => {
    const props = b.props as Record<string, unknown>;
    return b.type === 'paragraph' && props[QUESTION_PROP] ? 'question' : b.type === 'paragraph' && props[SCRIPT_PROP] ? 'script' : b.type;
  });
const texts = (e: BlockNoteEditor) =>
  e.document.map((b) => (b.content as { text?: string }[] | undefined)?.map((c) => c.text).join('') ?? '');

function newPage(): { doc: Y.Doc; editor: BlockNoteEditor } {
  const doc = new Y.Doc();
  const editor = mount(doc);
  editor.replaceBlocks(editor.document, [
    { type: 'paragraph', content: 'Brief del spot.' },
    question('¿Se filma de noche?'),
    { type: 'paragraph', content: 'Nota.' },
  ]);
  return { doc, editor };
}

function openInMain(doc: Y.Doc): { old: BlockNoteEditor; updates: Uint8Array[] } {
  const docOld = new Y.Doc();
  Y.applyUpdate(docOld, Y.encodeStateAsUpdate(doc));
  const updates: Uint8Array[] = [];
  docOld.on('update', (u: Uint8Array) => updates.push(u));
  return { old: mount(docOld, mainSchema), updates };
}

describe('preguntas con el editor de la versión publicada (main)', () => {
  it('abre la página, muestra la pregunta como párrafo y no borra nada al editar otro bloque', async () => {
    const { doc, editor } = newPage();
    await tick();
    const questionId = editor.document[1].id;

    const { old, updates } = openInMain(doc);
    await tick();
    expect(old.document.map((b) => b.type)).toEqual(['paragraph', 'paragraph', 'paragraph']);
    expect(texts(old)).toEqual(['Brief del spot.', '¿Se filma de noche?', 'Nota.']);
    expect(old.document[1].id).toBe(questionId);

    old.setTextCursorPosition(old.document[2], 'end');
    old.insertInlineContent(' Editada en la versión publicada.');
    await tick();
    for (const u of updates) Y.applyUpdate(doc, u);
    await tick();

    expect(texts(editor)).toEqual(['Brief del spot.', '¿Se filma de noche?', 'Nota. Editada en la versión publicada.']);
    expect(kinds(editor)).toEqual(['paragraph', 'question', 'paragraph']);
  });

  it('si la versión publicada edita la pregunta, queda el texto y el id del bloque (se pierde solo la marca)', async () => {
    const { doc, editor } = newPage();
    await tick();
    const questionId = editor.document[1].id;

    const { old, updates } = openInMain(doc);
    await tick();
    old.setTextCursorPosition(old.document[1], 'end');
    old.insertInlineContent(' ¿Y con lluvia?');
    await tick();
    for (const u of updates) Y.applyUpdate(doc, u);
    await tick();

    expect(texts(editor)).toEqual(['Brief del spot.', '¿Se filma de noche? ¿Y con lluvia?', 'Nota.']);
    expect(editor.document[1].id).toBe(questionId);
    expect(editor.document).toHaveLength(3);
  });

  it('la guarda contra lo desconocido de la versión publicada no la bloquea', async () => {
    const { doc } = newPage();
    await tick();
    const probe = BlockNoteEditor.create({ schema: mainSchema });
    const mainNames = { nodes: new Set(Object.keys(probe.pmSchema.nodes)), marks: new Set(Object.keys(probe.pmSchema.marks)) };
    expect(findUnknownContent(doc, mainNames)).toBeNull();
    expect(findUnknownContent(doc)).toBeNull();
    // Ningún bloque ni marca nuevos: los mismos nombres que la versión publicada.
    expect([...knownContent().nodes, 'doc', 'text'].sort()).toEqual([...mainNames.nodes].sort());
    expect([...knownContent().marks].sort()).toEqual([...mainNames.marks].sort());
    expect(Object.keys(schema.blockSpecs).sort()).toEqual(Object.keys(mainSchema.blockSpecs).sort());
  });
});

describe('preguntas en esta versión', () => {
  it('se ven con su clase, llegan a otro dispositivo y no son Script a la vez', async () => {
    const { doc, editor } = newPage();
    await tick();
    expect(editor.domElement?.querySelectorAll('p.question-line')).toHaveLength(1);

    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(doc));
    const b = mount(docB);
    await tick();
    expect(kinds(b)).toEqual(['paragraph', 'question', 'paragraph']);

    // Pasar la pregunta a Script le saca la marca de pregunta, y al revés.
    editor.updateBlock(editor.document[1], { props: paragraphProps('script') } as never);
    expect(kinds(editor)).toEqual(['paragraph', 'script', 'paragraph']);
    editor.updateBlock(editor.document[1], { props: paragraphProps('question') } as never);
    expect(kinds(editor)).toEqual(['paragraph', 'question', 'paragraph']);
    expect(editor.domElement?.querySelectorAll('.script-line')).toHaveLength(0);
  });

  it('Ctrl/⌘+Alt+P marca la línea como pregunta y Enter sigue en un párrafo común', () => {
    const editor = mount(new Y.Doc());
    editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: '¿Qué lente?' }]);
    editor.setTextCursorPosition(editor.document[0], 'end');
    const key = (init: KeyboardEventInit) =>
      editor.prosemirrorView!.someProp('handleKeyDown', (f) => f(editor.prosemirrorView!, new KeyboardEvent('keydown', init)));
    key({ key: 'p', code: 'KeyP', keyCode: 80, ctrlKey: true, altKey: true });
    expect(kinds(editor)).toEqual(['question']);
    key({ key: 'Enter' });
    editor.insertInlineContent('Respuesta en el texto');
    expect(kinds(editor)).toEqual(['question', 'paragraph']);
  });

  it('se copia y se pega como HTML con su marca', () => {
    const editor = mount(new Y.Doc());
    editor.replaceBlocks(editor.document, [question('¿Hay dobles?')]);
    const html = editor.blocksToHTMLLossy(editor.document);
    expect(html).toContain('question-line');
    const parsed = editor.tryParseHTMLToBlocks('<p class="question-line">¿Hay dobles?</p><p class="script-line">INT. CASA - DÍA</p>');
    expect(parsed.map((b) => [(b.props as Record<string, unknown>)[QUESTION_PROP], (b.props as Record<string, unknown>)[SCRIPT_PROP]])).toEqual([
      [true, false],
      [false, true],
    ]);
  });
});
