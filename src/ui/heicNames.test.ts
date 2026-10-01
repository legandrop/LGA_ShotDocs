// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { FileInfo } from '../media/queue';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { schema } from './editorSchema';
import { renameConvertedHeic, type NameEditor } from './heicNames';

// El nombre del bloque de una foto que se agregó como HEIC y ya es un JPEG (Docs/Doc_Imagenes.md, "Fotos HEIC").

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

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const info = (mime: string, name: string): FileInfo => ({ kind: 'image', mime, name, size: 1, local: true });

describe('el nombre del bloque de un HEIC convertido', () => {
  it('cuando el archivo ya es un JPEG, sus bloques pasan de .HEIC a .jpg (también uno anidado); nada más cambia', () => {
    const editor = mount();
    editor.replaceBlocks(editor.document, [
      { type: 'image', props: { url: `sdmedia://${A}`, name: 'IMG_0001.HEIC' } },
      { type: 'paragraph', content: 'Madre', children: [{ type: 'image', props: { url: `sdmedia://${A}`, name: 'otra copia.heif' } }] },
      { type: 'image', props: { url: `sdmedia://${B}`, name: 'IMG_0002.HEIC' } },
    ] as never);
    const files = new Map([[A, info('image/jpeg', 'IMG_0001.jpg')], [B, info('image/heic', 'IMG_0002.HEIC')]]);
    const media = { fileInfo: (id: string) => files.get(id) ?? null };
    expect(renameConvertedHeic(editor as unknown as NameEditor, media, A)).toBe(2);
    const names = () =>
      [editor.document[0], editor.document[1].children[0], editor.document[2]].map((b) => (b.props as { name: string; url: string }).name);
    expect(names()).toEqual(['IMG_0001.jpg', 'otra copia.jpg', 'IMG_0002.HEIC']);
    expect((editor.document[0].props as { url: string }).url).toBe(`sdmedia://${A}`);
    // Un HEIC que no se convirtió (B) no cambia, y la segunda pasada no tiene nada que hacer.
    expect(renameConvertedHeic(editor as unknown as NameEditor, media, B)).toBe(0);
    expect(renameConvertedHeic(editor as unknown as NameEditor, media, A)).toBe(0);
    // Sin saber todavía qué es el archivo, tampoco.
    expect(renameConvertedHeic(editor as unknown as NameEditor, { fileInfo: () => null }, B)).toBe(0);
  });

  it('una foto en línea también (solo su nombre; el texto del renglón y la otra foto, iguales)', () => {
    const editor = mount();
    const ph = (id: string, name: string) => ({ type: 'photo', props: { url: `sdmedia://${id}`, name, w: 0.5 } });
    editor.replaceBlocks(editor.document, [
      { type: 'paragraph', content: [{ type: 'text', text: 'antes ', styles: {} }, ph(A, 'IMG_0001.HEIC'), ph(B, 'IMG_0002.HEIC')] },
    ] as never);
    const files = new Map([[A, info('image/jpeg', 'IMG_0001.jpg')], [B, info('image/heic', 'IMG_0002.HEIC')]]);
    const media = { fileInfo: (id: string) => files.get(id) ?? null };
    expect(renameConvertedHeic(editor as unknown as NameEditor, media, A)).toBe(1);
    const content = editor.document[0].content as { type: string; text?: string; props?: { name: string; url: string; w: number } }[];
    expect(content.map((c) => c.text ?? `${c.props!.name}@${c.props!.w}`)).toEqual(['antes ', 'IMG_0001.jpg@0.5', 'IMG_0002.HEIC@0.5']);
    expect(renameConvertedHeic(editor as unknown as NameEditor, media, A)).toBe(0);
  });
});
