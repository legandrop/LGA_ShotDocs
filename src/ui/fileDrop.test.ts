// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { yUndoPluginKey } from 'y-prosemirror';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { schema } from './editorSchema';
import { insertFiles, isEmptyParagraph, isFilesTransfer, takeFiles, type FileEditor } from './fileDrop';

// Soltar o pegar archivos (Docs/Doc_Adjuntos.md): se reconocen los eventos de archivos (y no los de HTML), se
// leen en el acto, y se inserta un bloque `image` por archivo, en orden, sin cortar si uno falla.

const fakeTransfer = (types: string[], files: File[] = [], folders = 0, html = '<p>Hola</p>'): DataTransfer =>
  ({
    types,
    files,
    getData: (type: string) => (type === 'text/html' ? html : ''),
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

  it('con HTML no (pegar desde Excel o Word, arrastrar texto desde otra pestaña, un bloque del editor)', () => {
    expect(isFilesTransfer(fakeTransfer(['text/html', 'Files']))).toBe(false);
    expect(isFilesTransfer(fakeTransfer(['text/html', 'Files'], [], 0, '<p>Texto <img src="x.png"></p>'))).toBe(false);
    expect(isFilesTransfer(fakeTransfer(['text/html', 'Files', 'blocknote/html'], [], 0, '<img src="x.png">'))).toBe(false);
    expect(isFilesTransfer(fakeTransfer(['blocknote/html', 'text/html']))).toBe(false);
    expect(isFilesTransfer(fakeTransfer(['text/plain']))).toBe(false);
    expect(isFilesTransfer(null)).toBe(false);
  });

  it('"Copiar imagen" de una web (el archivo y un HTML que es solo esa imagen): son archivos', () => {
    const chrome = '<html><body><!--StartFragment--><img src="https://example.invalid/a.jpg" alt=""/><!--EndFragment--></body></html>';
    expect(isFilesTransfer(fakeTransfer(['text/html', 'Files'], [], 0, chrome))).toBe(true);
    expect(isFilesTransfer(fakeTransfer(['text/html', 'Files'], [], 0, '<meta charset="utf-8"><a href="x"><img src="a.png"></a>'))).toBe(true);
    // Sin el archivo (solo el HTML con la imagen), no: eso no se puede guardar.
    expect(isFilesTransfer(fakeTransfer(['text/html'], [], 0, '<img src="a.png">'))).toBe(false);
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

    // Un salto de hoja vacío (pageBreak) tampoco: el archivo va debajo y el salto queda.
    editor.replaceBlocks(editor.document, [{ type: 'paragraph', props: { pageBreak: true } as never, content: '' }]);
    expect(isEmptyParagraph(editor.document[0] as never)).toBe(false);
    await insertFiles(fe, [new File(['x'], 'c.pdf')], { blockId: editor.document[0].id, placement: 'after' });
    expect(editor.document[0].type).toBe('paragraph');
    expect((editor.document[0].props as Record<string, unknown>).pageBreak).toBe(true);
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

describe('la dirección al terminar de subir es de la app (P.26)', () => {
  it('no entra en la pila de deshacer: un ⌘Z saca el bloque entero, no deja uno sin dirección', async () => {
    const editor = mount();
    editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: 'Antes' }]);
    const um = (yUndoPluginKey.getState(editor.prosemirrorView!.state as never) as { undoManager: Y.UndoManager }).undoManager;
    um.clear();
    um.stopCapturing();
    const fe = editor as unknown as FileEditor;
    fe.uploadFile = async (file: File) => {
      // La subida termina después: lo que venga es otro paso si entra en la pila.
      um.stopCapturing();
      return `sdmedia://${file.name}`;
    };
    await insertFiles(fe, [new File(['x'], 'a.pdf')], { blockId: editor.document[0].id, placement: 'after' });
    expect((editor.document[1].props as { url: string }).url).toBe('sdmedia://a.pdf');
    expect(um.undoStack).toHaveLength(1);
  });
});
