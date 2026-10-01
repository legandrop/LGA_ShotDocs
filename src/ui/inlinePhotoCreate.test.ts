// @vitest-environment jsdom
// Crear fotos en línea (Docs/Doc_Fotos_En_Linea.md, entrega 2): pegar, soltar y elegir archivos.
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { undoManager } from './collabHarness';
import { schema } from './editorSchema';
import { PHOTO } from './inlinePhoto';
import {
  addFiles,
  canHostPhoto,
  inlinePhotoSpotsExtension,
  NEW_PHOTO_WIDTH,
  pasteSpot,
  spotsOf,
  type AddFilesOptions,
  type PhotoEditor,
} from './inlinePhotoCreate';
import { brokenGaps } from './photoHarness';

const editors: BlockNoteEditor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
  document.body.replaceChildren();
});

function mount(blocks: PartialBlock[], doc = new Y.Doc()): BlockNoteEditor {
  const editor = BlockNoteEditor.create(
    withCollaboration({
      schema,
      collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
      extensions: [inlinePhotoSpotsExtension],
    }),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.append(el);
  editor.mount(el);
  editors.push(editor);
  if (blocks.length) editor.replaceBlocks(editor.document, blocks as never);
  return editor;
}

const view = (e: BlockNoteEditor) => e.prosemirrorView!;
const p = (id: string, ...content: unknown[]): PartialBlock =>
  ({ id, type: 'paragraph', content: content.map((c) => (typeof c === 'string' ? { type: 'text', text: c, styles: {} } : c)) }) as never;
const ph = (name: string, w = 0.5) => ({ type: 'photo', props: { url: `https://example.invalid/${name}.jpg`, name, w } });
const file = (name: string, type = 'image/jpeg') => new File([new Uint8Array([1, 2, 3])], name, { type });
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** Cada bloque como texto, con `[nombre@w]` por foto en línea y `<image>` por foto-bloque. */
function lines(e: BlockNoteEditor): string[] {
  const out: string[] = [];
  const walk = (blocks: typeof e.document) => {
    for (const b of blocks) {
      if (b.type === 'image') out.push('<image>');
      else if (Array.isArray(b.content)) {
        out.push(
          (b.content as { type: string; text?: string; props?: { name: string; w: number } }[])
            .map((c) => (c.type === PHOTO ? `[${c.props!.name}@${+c.props!.w.toFixed(4)}]` : (c.text ?? '')))
            .join(''),
        );
      } else out.push(`<${b.type}>`);
      walk(b.children);
    }
  };
  walk(e.document);
  return out;
}

/** Un guardado que se resuelve cuando se le pide (o falla con los nombres de `fail`). */
function storage(fail: string[] = []) {
  const waiting: (() => void)[] = [];
  const stored: string[] = [];
  const store = (f: File) =>
    new Promise<string>((resolve, reject) =>
      waiting.push(() => {
        if (fail.includes(f.name)) reject(new Error('no'));
        else {
          stored.push(f.name);
          resolve(`sdmedia://${f.name}`);
        }
      }),
    );
  return {
    store,
    stored,
    /** Termina de guardar todo lo pedido. */
    async finish() {
      for (const w of waiting.splice(0)) w();
      await tick();
    },
  };
}

function options(s: ReturnType<typeof storage>, attachments: { files: string[]; at: unknown }[] = []): AddFilesOptions {
  return {
    isInline: (f) => f.type.startsWith('image/') || f.type.startsWith('video/'),
    store: s.store,
    insertAttachments: (files, at) => attachments.push({ files: files.map((f) => f.name), at }),
  };
}

function caret(e: BlockNoteEditor, pos: number): void {
  view(e).dispatch(view(e).state.tr.setSelection(TextSelection.create(view(e).state.doc, pos)));
}

/** La posición dentro del texto del bloque `id`, `offset` caracteres después de su principio. */
function at(e: BlockNoteEditor, id: string, offset: number): number {
  let found = -1;
  view(e).state.doc.descendants((n, pos) => {
    if (found >= 0) return false;
    if (n.type.name === 'blockContainer' && n.attrs.id === id) found = pos + 2 + offset;
    return found < 0;
  });
  return found;
}

describe('dónde puede ir una foto en línea', () => {
  it('en párrafos, títulos, listas y citas; no en una celda ni en código', () => {
    const E = mount([
      p('a', 'texto'),
      { id: 'h', type: 'heading', content: 'Título' } as never,
      { id: 'l', type: 'bulletListItem', content: 'item' } as never,
      { id: 'q', type: 'quote', content: 'cita' } as never,
      { id: 'c', type: 'codeBlock', content: 'code' } as never,
      { id: 't', type: 'table', content: { type: 'tableContent', rows: [{ cells: ['celda'] }] } } as never,
    ]);
    const ok = (id: string) => canHostPhoto(view(E).state.doc.resolve(at(E, id, 1)));
    expect(['a', 'h', 'l', 'q'].map(ok)).toEqual([true, true, true, true]);
    expect(ok('c')).toBe(false);
    let cell = -1;
    view(E).state.doc.descendants((n, pos) => {
      if (n.type.name === 'tableParagraph' && cell < 0) cell = pos + 1;
      return cell < 0;
    });
    expect(canHostPhoto(view(E).state.doc.resolve(cell))).toBe(false);
  });

  it('al pegar: el cursor; con una foto elegida, después de ella; con un bloque elegido entero, ninguno', () => {
    const E = mount([p('a', 'ab', ph('F1'), 'cd'), { id: 'i', type: 'image', props: { url: 'https://example.invalid/x.jpg' } } as never]);
    caret(E, at(E, 'a', 1));
    expect(pasteSpot(view(E).state)).toBe(at(E, 'a', 1));
    view(E).dispatch(view(E).state.tr.setSelection(NodeSelection.create(view(E).state.doc, at(E, 'a', 2))));
    expect(pasteSpot(view(E).state)).toBe(at(E, 'a', 3));
    view(E).dispatch(view(E).state.tr.setSelection(NodeSelection.create(view(E).state.doc, at(E, 'i', -1))));
    expect(pasteSpot(view(E).state)).toBeNull();
  });
});

describe('pegar fotos', () => {
  it('una: entra donde está el cursor, con su ancho natural, cuando terminó de guardarse; el cursor queda después', async () => {
    const E = mount([p('a', 'antes después')]);
    caret(E, at(E, 'a', 6));
    const s = storage();
    const done = addFiles(E as unknown as PhotoEditor, [file('F1.jpg')], null, options(s));
    // Mientras se guarda: nada en el documento, una marca de espera en el lugar.
    expect(lines(E)).toEqual(['antes después']);
    expect(spotsOf(view(E).state)).toHaveLength(1);
    expect(view(E).dom.querySelectorAll('.sd-photo-pending')).toHaveLength(1);
    await s.finish();
    await done;
    expect(lines(E)).toEqual([`antes [F1.jpg@${NEW_PHOTO_WIDTH.single}]después`]);
    expect(spotsOf(view(E).state)).toHaveLength(0);
    expect(view(E).dom.querySelectorAll('.sd-photo-pending')).toHaveLength(0);
    expect(view(E).state.selection.from).toBe(at(E, 'a', 7));
  });

  it('varias: juntas, en orden, a 1/3 cada una, en un solo cambio (un solo deshacer)', async () => {
    const E = mount([p('a', 'xy')]);
    caret(E, at(E, 'a', 1));
    const s = storage();
    const done = addFiles(E as unknown as PhotoEditor, [file('A.jpg'), file('B.png'), file('C.mp4', 'video/mp4')], null, options(s));
    await s.finish();
    await done;
    expect(lines(E)).toEqual(['x[A.jpg@0.3333][B.png@0.3333][C.mp4@0.3333]y']);
    undoManager(E as never).undo();
    expect(lines(E)).toEqual(['xy']);
  });

  it('lo que se escribe mientras se guardan queda después de las fotos; lo borrado antes corre el lugar', async () => {
    const E = mount([p('a', 'abcdef')]);
    caret(E, at(E, 'a', 3));
    const s = storage();
    const done = addFiles(E as unknown as PhotoEditor, [file('F.jpg')], null, options(s));
    view(E).dispatch(view(E).state.tr.insertText('XY', at(E, 'a', 3)));
    view(E).dispatch(view(E).state.tr.delete(at(E, 'a', 0), at(E, 'a', 1)));
    await s.finish();
    await done;
    expect(lines(E)).toEqual(['bc[F.jpg@0]XYdef']);
  });

  it('con texto elegido, lo reemplaza; con una foto elegida, va después de ella (no la reemplaza)', async () => {
    const E = mount([p('a', 'abcdef'), p('b', 'x', ph('F1'), 'y')]);
    view(E).dispatch(view(E).state.tr.setSelection(TextSelection.create(view(E).state.doc, at(E, 'a', 1), at(E, 'a', 4))));
    let s = storage();
    let done = addFiles(E as unknown as PhotoEditor, [file('N.jpg')], null, options(s));
    await s.finish();
    await done;
    view(E).dispatch(view(E).state.tr.setSelection(NodeSelection.create(view(E).state.doc, at(E, 'b', 1))));
    s = storage();
    done = addFiles(E as unknown as PhotoEditor, [file('M.jpg')], null, options(s));
    await s.finish();
    await done;
    expect(lines(E)).toEqual(['a[N.jpg@0]ef', 'x[F1@0.5][M.jpg@0]y']);
  });

  it('con una foto-bloque elegida o el cursor en una celda: en un renglón nuevo después del bloque', async () => {
    const E = mount([p('a', 'uno'), { id: 'i', type: 'image', props: { url: 'https://example.invalid/x.jpg' } } as never, p('z', 'fin')]);
    view(E).dispatch(view(E).state.tr.setSelection(NodeSelection.create(view(E).state.doc, at(E, 'i', -1))));
    const s = storage();
    const done = addFiles(E as unknown as PhotoEditor, [file('A.jpg'), file('B.jpg')], null, options(s));
    await s.finish();
    await done;
    expect(lines(E)).toEqual(['uno', '<image>', '[A.jpg@0.3333][B.jpg@0.3333]', 'fin']);
  });

  it('los adjuntos van como bloques después del bloque (como hasta ahora); las fotos, en el renglón', async () => {
    const E = mount([p('a', 'ab')]);
    caret(E, at(E, 'a', 1));
    const s = storage();
    const attachments: { files: string[]; at: unknown }[] = [];
    const done = addFiles(E as unknown as PhotoEditor, [file('doc.pdf', 'application/pdf'), file('A.jpg')], null, options(s, attachments));
    await s.finish();
    await done;
    expect(attachments).toEqual([{ files: ['doc.pdf'], at: { blockId: 'a', placement: 'after' } }]);
    expect(lines(E)).toEqual(['a[A.jpg@0]b']);
    // Solo adjuntos: no se sigue ningún lugar.
    await addFiles(E as unknown as PhotoEditor, [file('z.zip', 'application/zip')], null, options(s, attachments));
    expect(spotsOf(view(E).state)).toHaveLength(0);
  });

  it('un archivo que no se pudo guardar no corta los demás; si no se guarda ninguno, no queda nada', async () => {
    const E = mount([p('a', 'ab')]);
    caret(E, at(E, 'a', 1));
    let s = storage(['B.jpg']);
    let done = addFiles(E as unknown as PhotoEditor, [file('A.jpg'), file('B.jpg'), file('C.jpg')], null, options(s));
    await s.finish();
    await done;
    // Entraron dos: cuentan como "varias" (1/3), las que se iban a poner juntas.
    expect(lines(E)).toEqual(['a[A.jpg@0.3333][C.jpg@0.3333]b']);
    s = storage(['X.jpg']);
    done = addFiles(E as unknown as PhotoEditor, [file('X.jpg')], null, options(s));
    await s.finish();
    expect(await done).toEqual([]);
    expect(spotsOf(view(E).state)).toHaveLength(0);
    expect(lines(E)).toEqual(['a[A.jpg@0.3333][C.jpg@0.3333]b']);
  });

  it('si el renglón del lugar se borra mientras se guardan, van en un renglón nuevo donde estaba', async () => {
    const E = mount([p('a', 'uno'), p('b', 'dos'), p('c', 'tres')]);
    caret(E, at(E, 'b', 2));
    const s = storage();
    const done = addFiles(E as unknown as PhotoEditor, [file('F.jpg')], null, options(s));
    E.removeBlocks(['b']);
    await s.finish();
    await done;
    expect(lines(E).filter((l) => l.includes('F.jpg'))).toHaveLength(1);
    expect(lines(E)).toContain('uno');
    expect(lines(E)).toContain('tres');
  });
});

describe('soltar fotos', () => {
  it('entre las letras donde se soltaron; si ahí no pueden ir, en un renglón nuevo antes o después del bloque', async () => {
    const E = mount([p('a', 'abcd'), { id: 'i', type: 'image', props: { url: 'https://example.invalid/x.jpg' } } as never]);
    let s = storage();
    let done = addFiles(E as unknown as PhotoEditor, [file('A.jpg')], { pos: at(E, 'a', 2), block: { blockId: 'a', placement: 'after' } }, options(s));
    await s.finish();
    await done;
    expect(lines(E)).toEqual(['ab[A.jpg@0]cd', '<image>']);
    // Sobre la foto-bloque (no es un renglón): antes de ella, como dijo `dropTarget`, aunque el cursor esté en un
    // renglón (no va donde está el cursor).
    caret(E, at(E, 'a', 1));
    s = storage();
    done = addFiles(E as unknown as PhotoEditor, [file('B.jpg')], { pos: at(E, 'i', -1), block: { blockId: 'i', placement: 'before' } }, options(s));
    await s.finish();
    await done;
    expect(lines(E)).toEqual(['ab[A.jpg@0]cd', '[B.jpg@0]', '<image>']);
  });
});

describe('con otro editor a la vez', () => {
  it('lo que el otro escribe en el renglón mientras se guardan no se pierde, y el renglón queda con su forma', async () => {
    const d1 = new Y.Doc();
    const d2 = new Y.Doc();
    const E1 = mount([p('a', 'abcdef')], d1);
    Y.applyUpdate(d2, Y.encodeStateAsUpdate(d1));
    // El segundo editor se abre sobre el documento del primero (sin reemplazar nada).
    const E2 = mount([], d2);
    d1.on('update', (u: Uint8Array, o: unknown) => o !== 'r' && Y.applyUpdate(d2, u, 'r'));
    d2.on('update', (u: Uint8Array, o: unknown) => o !== 'r' && Y.applyUpdate(d1, u, 'r'));
    await tick(20);
    caret(E1, at(E1, 'a', 3));
    const s = storage();
    const done = addFiles(E1 as unknown as PhotoEditor, [file('A.jpg'), file('B.jpg')], null, options(s));
    view(E2).dispatch(view(E2).state.tr.insertText('XY', at(E2, 'a', 3)));
    view(E2).dispatch(view(E2).state.tr.insertText('Z', at(E2, 'a', 8)));
    await s.finish();
    await done;
    await tick(5);
    expect(lines(E1)).toEqual(lines(E2));
    expect(lines(E1)[0].replace(/\[[^\]]+\]/g, '')).toBe('abcXYdefZ');
    expect(lines(E1)[0].match(/\[[^\]]+\]/g)).toEqual(['[A.jpg@0.3333]', '[B.jpg@0.3333]']);
    expect(brokenGaps(d1)).toEqual([]);
  });
});
