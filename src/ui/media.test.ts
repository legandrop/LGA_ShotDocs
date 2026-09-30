// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { schema, setVideosAccepted } from './editorSchema';
import { schema as mainSchema } from './fixtures/editorSchemaMain';
import { findUnknownContent, knownContent } from './unknownContent';

// Una foto o un video del Drive es un bloque `image` con `url: "sdmedia://<id>"` (paso 6 del plan). La
// versión publicada (el esquema de `main`) no conoce esa dirección: tiene que mostrar una imagen rota y
// conservarla, nunca borrar el bloque.

const editors: BlockNoteEditor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
});

function mount(doc: Y.Doc, withSchema: unknown, resolved?: string[]): BlockNoteEditor {
  const editor = BlockNoteEditor.create(
    withCollaboration({
      schema: withSchema as typeof schema,
      // Como la versión publicada: `files.resolve` devuelve tal cual lo que no es `sdfile://`.
      resolveFileUrl: async (url: string) => {
        resolved?.push(url);
        return url;
      },
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
const VIDEO = 'sdmedia://6f1c2a4e-0b7d-4c8e-9f10-112233445566';
const PHOTO = 'sdmedia://0a1b2c3d-4e5f-4a6b-8c7d-8e9f00112233';

const summary = (e: BlockNoteEditor) =>
  e.document.map((b) =>
    b.type === 'image'
      ? `image ${(b.props as { url: string }).url} ${(b.props as { caption: string }).caption}`.trim()
      : `${b.type} ${(b.content as { text?: string }[] | undefined)?.map((c) => c.text).join('') ?? ''}`,
  );

function newPage(): { doc: Y.Doc; editor: BlockNoteEditor } {
  const doc = new Y.Doc();
  const editor = mount(doc, schema);
  editor.replaceBlocks(editor.document, [
    { type: 'paragraph', content: 'Plano 12, toma 3.' },
    { type: 'image', props: { url: VIDEO, name: 'IMG_0666.MOV' } },
    { type: 'image', props: { url: PHOTO, name: 'IMG_1234.HEIC' } },
    { type: 'paragraph', content: 'Nota.' },
  ]);
  return { doc, editor };
}

describe('sdmedia:// con el editor de la versión publicada (main)', () => {
  it('lo abre sin borrarlo y conserva la dirección aunque se edite otro bloque', async () => {
    const { doc, editor } = newPage();
    await tick();

    const docOld = new Y.Doc();
    Y.applyUpdate(docOld, Y.encodeStateAsUpdate(doc));
    const updates: Uint8Array[] = [];
    docOld.on('update', (u: Uint8Array) => updates.push(u));
    const resolved: string[] = [];
    const old = mount(docOld, mainSchema, resolved);
    await tick();
    expect(summary(old)).toEqual(['paragraph Plano 12, toma 3.', `image ${VIDEO}`, `image ${PHOTO}`, 'paragraph Nota.']);
    // La muestra como una imagen (rota) con esa dirección.
    expect(resolved).toEqual(expect.arrayContaining([VIDEO, PHOTO]));

    // Edita otro bloque y la leyenda de la imagen.
    old.setTextCursorPosition(old.document[3], 'end');
    old.insertInlineContent(' Editada en la versión publicada.');
    old.updateBlock(old.document[1], { props: { caption: 'Toma buena' } } as never);
    await tick();

    for (const u of updates) Y.applyUpdate(doc, u);
    await tick();
    expect(summary(editor)).toEqual([
      'paragraph Plano 12, toma 3.',
      `image ${VIDEO} Toma buena`,
      `image ${PHOTO}`,
      'paragraph Nota. Editada en la versión publicada.',
    ]);
    expect((editor.document[1].props as { name: string }).name).toBe('IMG_0666.MOV');
  });

  it('la guarda contra lo desconocido de la versión publicada no lo bloquea', async () => {
    const { doc } = newPage();
    await tick();
    const probe = BlockNoteEditor.create({ schema: mainSchema });
    const mainNames = { nodes: new Set(Object.keys(probe.pmSchema.nodes)), marks: new Set(Object.keys(probe.pmSchema.marks)) };
    expect(findUnknownContent(doc, mainNames)).toBeNull();
    expect(findUnknownContent(doc)).toBeNull();
    // El esquema de esta versión tiene los mismos bloques y marcas que el publicado.
    expect([...knownContent().nodes, 'doc', 'text'].sort()).toEqual([...mainNames.nodes].sort());
    expect([...knownContent().marks].sort()).toEqual([...mainNames.marks].sort());
  });

  it('el bloque image acepta videos solo con portero, y sigue siendo image', () => {
    const accept = () => (schema.blockSpecs.image.implementation.meta as { fileBlockAccept?: string[] }).fileBlockAccept;
    expect(accept()).toEqual(['image/*']);
    setVideosAccepted(true);
    // Con portero, el selector ofrece también cualquier archivo (adjuntos, Docs/Doc_Adjuntos.md).
    expect(accept()).toEqual(['image/*', 'video/*', '*/*']);
    setVideosAccepted(false);
    expect(accept()).toEqual(['image/*']);
    expect('video' in schema.blockSpecs).toBe(false);
    expect('file' in schema.blockSpecs).toBe(false);
  });
});
