// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { schema } from './editorSchema';
import { insertFiles, isFilesTransfer, takeFiles, type FileEditor } from './fileDrop';

// Soltar o pegar archivos (Docs/Doc_Adjuntos.md): se reconocen los eventos de archivos (y no los de HTML), se
// leen en el acto, y se inserta un bloque `image` por archivo, en orden, sin cortar si uno falla.

const fakeTransfer = (types: string[], files: File[] = [], folders = 0): DataTransfer =>
  ({
    types,
    files,
    items: [
      ...files.map((f) => ({ kind: 'file', getAsFile: () => f, webkitGetAsEntry: () => ({ isDirectory: false }) })),
      ...Array.from({ length: folders }, () => ({ kind: 'file', getAsFile: () => null, webkitGetAsEntry: () => ({ isDirectory: true }) })),
    ],
  }) as unknown as DataTransfer;

describe('qué eventos son de archivos', () => {
  it('Files sin HTML sí (también con el nombre como texto, como copia el Finder)', () => {
    expect(isFilesTransfer(fakeTransfer(['Files']))).toBe(true);
    expect(isFilesTransfer(fakeTransfer(['Files', 'text/plain']))).toBe(true);
  });

  it('con HTML no (pegar desde Excel o Word, copiar imagen, arrastrar desde otra pestaña, un bloque del editor)', () => {
    expect(isFilesTransfer(fakeTransfer(['text/html', 'Files']))).toBe(false);
    expect(isFilesTransfer(fakeTransfer(['blocknote/html', 'text/html']))).toBe(false);
    expect(isFilesTransfer(fakeTransfer(['text/plain']))).toBe(false);
    expect(isFilesTransfer(null)).toBe(false);
  });

  it('lee todos los archivos y cuenta las carpetas aparte', () => {
    const a = new File(['a'], 'a.pdf', { type: 'application/pdf' });
    const b = new File(['b'], 'b.zip', { type: '' });
    expect(takeFiles(fakeTransfer(['Files'], [a, b], 1))).toEqual({ files: [a, b], folders: 1 });
  });
});

const editors: BlockNoteEditor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
});

function mount(): BlockNoteEditor {
  const editor = BlockNoteEditor.create(
    withCollaboration({
      schema,
      collaboration: { fragment: new Y.Doc().getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
    }),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  editor.mount(el);
  editors.push(editor);
  return editor;
}

describe('insertar archivos', () => {
  it('un bloque image por archivo, en orden, y ningún bloque file; un archivo que falla no corta los demás', async () => {
    const editor = mount();
    editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: 'Antes' }, { type: 'paragraph', content: 'Después' }]);
    const first = editor.document[0].id;
    const files = ['a.pdf', 'b.zip', 'c.jpg'].map((n) => new File(['x'], n));
    const fe = editor as unknown as FileEditor;
    fe.uploadFile = async (file: File, id?: string) => {
      if (file.name === 'b.zip') {
        editor.removeBlocks([id!]);
        throw new Error('no');
      }
      return `sdmedia://${file.name}`;
    };
    await insertFiles(fe, files, { blockId: first, placement: 'after' });
    expect(editor.document.map((b) => b.type)).toEqual(['paragraph', 'image', 'image', 'paragraph']);
    expect(editor.document.slice(1, 3).map((b) => (b.props as { url: string; name: string }).url)).toEqual([
      'sdmedia://a.pdf',
      'sdmedia://c.jpg',
    ]);
    expect(editor.document.slice(1, 3).map((b) => (b.props as { name: string }).name)).toEqual(['a.pdf', 'c.jpg']);
  });

  it('un párrafo común vacío se reemplaza; una pregunta vacía no', async () => {
    const editor = mount();
    editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: '' }]);
    const fe = editor as unknown as FileEditor;
    fe.uploadFile = async (file: File) => `sdmedia://${file.name}`;
    await insertFiles(fe, [new File(['x'], 'a.pdf')], { blockId: editor.document[0].id, placement: 'after' });
    expect(editor.document.map((b) => b.type).filter((t) => t === 'image')).toHaveLength(1);
    expect(editor.document[0].type).toBe('image');

    editor.replaceBlocks(editor.document, [{ type: 'paragraph', props: { question: true } as never, content: '' }]);
    await insertFiles(fe, [new File(['x'], 'b.pdf')], { blockId: editor.document[0].id, placement: 'after' });
    expect(editor.document[0].type).toBe('paragraph');
    expect(editor.document[1].type).toBe('image');
  });

  it('un párrafo vacío con bloques adentro no se reemplaza (se llevaría los de adentro)', async () => {
    const editor = mount();
    editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: '', children: [{ type: 'paragraph', content: 'Adentro' }] }]);
    const fe = editor as unknown as FileEditor;
    fe.uploadFile = async (file: File) => `sdmedia://${file.name}`;
    await insertFiles(fe, [new File(['x'], 'a.pdf')], { blockId: editor.document[0].id, placement: 'after' });
    expect(editor.document[0].type).toBe('paragraph');
    expect(editor.document[0].children).toHaveLength(1);
    expect(editor.document[1].type).toBe('image');
  });
});
