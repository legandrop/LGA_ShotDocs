// @vitest-environment jsdom
// Sacar una foto o filmar desde la app y guardar en Fotos (camera.ts; Docs/Doc_Fotos_En_Linea.md, "Cámara"): qué se
// ofrece según el dispositivo y el navegador, el archivo que va a la hoja de compartir, el selector con `capture` por el
// camino de "/Image" y la versión publicada con una foto sacada así.
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import {
  CAMERA_ACCEPT,
  CAMERA_FACING,
  cameraKinds,
  canShareFiles,
  pageCameraFor,
  registerPageCamera,
  saveToRollOffered,
  shareFile,
  shareFileOf,
} from './camera';
import { mountEditor, tick, unmountAll, view as viewOf } from './collabHarness';
import { schema } from './editorSchema';
import { schema as previousPublished } from './fixtures/editorSchemaAnterior';
import { PHOTO } from './inlinePhoto';
import { inlinePhotoSpotsExtension, pickFiles, type AddFilesOptions, type PhotoEditor } from './inlinePhotoCreate';
import { brokenGaps, storedPhotos } from './photoHarness';
import { findUnknownContent } from './unknownContent';

afterEach(() => {
  unmountAll();
  document.body.replaceChildren();
});

describe('qué se ofrece', () => {
  it('la cámara: nada en la compu; en el teléfono la foto, y el video solo con portero', () => {
    expect(cameraKinds({ touch: false, videos: true })).toEqual([]);
    expect(cameraKinds({ touch: false, videos: false })).toEqual([]);
    expect(cameraKinds({ touch: true, videos: false })).toEqual(['photo']);
    expect(cameraKinds({ touch: true, videos: true })).toEqual(['photo', 'video']);
    expect(CAMERA_ACCEPT).toEqual({ photo: 'image/*', video: 'video/*' });
    expect(CAMERA_FACING).toBe('environment');
  });

  it('compartir archivos: solo con share y canShare que acepte una foto', () => {
    expect(canShareFiles(undefined)).toBe(false);
    expect(canShareFiles({})).toBe(false);
    // Safari viejo: comparte texto, no archivos.
    expect(canShareFiles({ share: async () => undefined })).toBe(false);
    expect(canShareFiles({ share: async () => undefined, canShare: () => false })).toBe(false);
    expect(
      canShareFiles({
        share: async () => undefined,
        canShare: () => {
          throw new TypeError('no');
        },
      }),
    ).toBe(false);
    const seen: ShareData[] = [];
    const ok = canShareFiles({
      share: async () => undefined,
      canShare: (d?: ShareData) => {
        seen.push(d!);
        return true;
      },
    });
    expect(ok).toBe(true);
    expect(seen[0].files?.[0].type).toBe('image/jpeg');
  });

  it('Save to camera roll: foto o video, en un dispositivo de toque que comparte archivos; nunca un adjunto', () => {
    expect(saveToRollOffered({ kind: 'image', touch: true, share: true })).toBe(true);
    expect(saveToRollOffered({ kind: 'video', touch: true, share: true })).toBe(true);
    expect(saveToRollOffered({ kind: 'file', touch: true, share: true })).toBe(false);
    // La compu (Chrome de Windows comparte archivos, pero no tiene carrete) y el navegador que no comparte.
    expect(saveToRollOffered({ kind: 'image', touch: false, share: true })).toBe(false);
    expect(saveToRollOffered({ kind: 'image', touch: true, share: false })).toBe(false);
  });
});

describe('el archivo para la hoja de compartir', () => {
  it('lleva un tipo: el del blob, el de la cola o el de la extensión', () => {
    expect(shareFileOf(new Blob(['x'], { type: 'image/png' }), 'A.png').type).toBe('image/png');
    expect(shareFileOf(new Blob(['x']), 'Toma.MOV', 'video/quicktime').type).toBe('video/quicktime');
    expect(shareFileOf(new Blob(['x'], { type: 'application/octet-stream' }), 'IMG_1.JPG').type).toBe('image/jpeg');
    expect(shareFileOf(new Blob(['x']), 'clip.mp4').type).toBe('video/mp4');
    expect(shareFileOf(new Blob(['x']), 'raro').type).toBe('application/octet-stream');
    const f = shareFileOf(new Blob(['abc'], { type: 'image/jpeg' }), 'Plano 1.jpg');
    expect(f.name).toBe('Plano 1.jpg');
    expect(f.size).toBe(3);
    expect(shareFileOf(new Blob(['x'], { type: 'video/mp4' }), '').name).toBe('video.mp4');
  });

  it('cómo termina: elegido, cerrado, otro toque, no se puede o falló', async () => {
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    const fail = (name: string) => ({ canShare: () => true, share: () => Promise.reject(Object.assign(new Error(name), { name })) });
    const share = vi.fn(async () => undefined);
    expect(await shareFile(file, { canShare: () => true, share })).toBe('shared');
    expect(share).toHaveBeenCalledWith({ files: [file] });
    expect(await shareFile(file, fail('AbortError'))).toBe('cancelled');
    expect(await shareFile(file, fail('NotAllowedError'))).toBe('again');
    expect(await shareFile(file, fail('DataError'))).toBe('failed');
    expect(await shareFile(file, { canShare: () => false, share })).toBe('unsupported');
    expect(await shareFile(file, {})).toBe('unsupported');
    expect(share).toHaveBeenCalledTimes(1);
  });
});

describe('el menú de la página', () => {
  it('ofrece la cámara solo mientras el editor de esa página la registra, y con algo que ofrecer', () => {
    const open = vi.fn();
    expect(pageCameraFor('p1')).toBeNull();
    const off = registerPageCamera('p1', { kinds: ['photo'], open });
    pageCameraFor('p1')!.open('photo');
    expect(open).toHaveBeenCalledWith('photo');
    expect(pageCameraFor('p2')).toBeNull();
    // Un editor nuevo de la misma página (se volvió a montar) no se borra cuando se va el viejo.
    const newer = registerPageCamera('p1', { kinds: ['photo', 'video'], open });
    off();
    expect(pageCameraFor('p1')?.kinds).toEqual(['photo', 'video']);
    newer();
    expect(pageCameraFor('p1')).toBeNull();
    const none = registerPageCamera('p3', { kinds: [], open });
    expect(pageCameraFor('p3')).toBeNull();
    none();
  });
});

// --- El selector con `capture`, por el camino de "/Image" -------------------------------------------------------

const text = (t: string) => ({ type: 'text', text: t, styles: {} });

function mountCreating(blocks: PartialBlock[], doc = new Y.Doc()): BlockNoteEditor {
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
  editor.replaceBlocks(editor.document, blocks as never);
  return editor;
}

const options = (stored: string[] = []): AddFilesOptions => ({
  isInline: (f) => f.type.startsWith('image/') || f.type.startsWith('video/'),
  store: async (f) => {
    stored.push(f.name);
    return `sdmedia://${f.name}`;
  },
  insertAttachments: () => undefined,
});

/** Cada bloque como texto, con `[nombre@w]` por foto en línea. */
function lines(E: BlockNoteEditor): string[] {
  const out: string[] = [];
  viewOf(E).state.doc.descendants((n) => {
    if (n.type.name !== 'paragraph') return true;
    let s = '';
    n.descendants((x) => {
      if (x.isText) s += x.text;
      else if (x.type.name === PHOTO) s += `[${x.attrs.name}@${+Number(x.attrs.w).toFixed(4)}]`;
      return true;
    });
    out.push(s);
    return false;
  });
  return out;
}

/** El selector que abrió `pickFiles`, y cómo "sacar" la foto (el cambio del selector con ese archivo). */
function picker(): { input: HTMLInputElement; take: (...files: File[]) => void } {
  const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
  expect(input).not.toBeNull();
  return {
    input,
    take: (...files) => {
      Object.defineProperty(input, 'files', { value: files, configurable: true });
      input.dispatchEvent(new Event('change'));
    },
  };
}

const shot = (name = 'image.jpg', type = 'image/jpeg') => new File([new Uint8Array([1, 2, 3])], name, { type });
/** Donde empieza el texto del primer párrafo (el grupo, el contenedor y el párrafo). */
const T0 = 3;
const caret = (E: BlockNoteEditor, pos: number) => viewOf(E).dispatch(viewOf(E).state.tr.setSelection(TextSelection.create(viewOf(E).state.doc, pos)));

describe('sacar con la cámara', () => {
  const page = (): PartialBlock[] =>
    [
      { id: 'a', type: 'paragraph', content: [text('Plano 1')] },
      { id: 'z', type: 'paragraph', content: [text('Último')] },
    ] as never;

  it('el selector pide la cámara de atrás, una sola toma, y la foto entra en el renglón donde estaba el cursor', async () => {
    const E = mountCreating(page());
    caret(E, T0 + 'Plano'.length);
    const stored: string[] = [];
    pickFiles(E as unknown as PhotoEditor, CAMERA_ACCEPT.photo, options(stored), { capture: CAMERA_FACING });
    const { input, take } = picker();
    expect(input.getAttribute('capture')).toBe('environment');
    expect(input.accept).toBe('image/*');
    expect(input.multiple).toBe(false);
    take(shot());
    await tick(20);
    expect(stored).toEqual(['image.jpg']);
    // Una sola: su ancho natural (`w = 0`), como al pegar una.
    expect(lines(E)).toEqual(['Plano[image.jpg@0] 1', 'Último']);
    expect(document.querySelector('input[type=file]')).toBeNull();
  });

  it('un video, igual (con portero): entra en el renglón', async () => {
    const E = mountCreating(page());
    caret(E, T0 + 'Plano 1'.length);
    pickFiles(E as unknown as PhotoEditor, CAMERA_ACCEPT.video, options(), { capture: CAMERA_FACING });
    const { input, take } = picker();
    expect(input.accept).toBe('video/*');
    take(shot('video.mov', 'video/quicktime'));
    await tick(20);
    expect(lines(E)).toEqual(['Plano 1[video.mov@0]', 'Último']);
  });

  it('desde el menú de la página sin cursor: en un renglón nuevo después del último bloque', async () => {
    const E = mountCreating(page());
    caret(E, 2);
    pickFiles(E as unknown as PhotoEditor, CAMERA_ACCEPT.photo, options(), { capture: CAMERA_FACING, at: { blockId: 'z', placement: 'after' } });
    picker().take(shot());
    await tick(20);
    expect(lines(E)).toEqual(['Plano 1', 'Último', '[image.jpg@0]']);
  });

  it('cerrar la cámara sin sacar nada no cambia la página; "/Image" sigue eligiendo varias, sin cámara', async () => {
    const E = mountCreating(page());
    caret(E, 2);
    pickFiles(E as unknown as PhotoEditor, CAMERA_ACCEPT.photo, options(), { capture: CAMERA_FACING });
    picker().input.dispatchEvent(new Event('cancel'));
    await tick(20);
    expect(lines(E)).toEqual(['Plano 1', 'Último']);
    expect(document.querySelector('input[type=file]')).toBeNull();
    pickFiles(E as unknown as PhotoEditor, 'image/*', options());
    const { input } = picker();
    expect(input.hasAttribute('capture')).toBe(false);
    expect(input.multiple).toBe(true);
  });

  it('la versión publicada abre una página con una foto sacada así sin escribir nada, y al editar no la borra', async () => {
    const shared = new Y.Doc();
    const E = mountCreating(page(), shared);
    caret(E, T0 + 'Plano 1'.length);
    pickFiles(E as unknown as PhotoEditor, CAMERA_ACCEPT.photo, options(), { capture: CAMERA_FACING });
    picker().take(shot());
    await tick(20);
    unmountAll();
    expect(storedPhotos(shared)).toEqual(['image.jpg']);
    expect(findUnknownContent(shared)).toBeNull();
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(shared));
    const updates: Uint8Array[] = [];
    copy.on('update', (u: Uint8Array) => updates.push(u));
    const old = mountEditor(copy, 'old', previousPublished);
    await tick(20);
    expect(updates).toEqual([]);
    viewOf(old).dispatch(viewOf(old).state.tr.insertText(' toma', T0 + 'Plano 1'.length + 1));
    await tick(20);
    expect(storedPhotos(copy)).toEqual(['image.jpg']);
    expect(lines(old)).toEqual(['Plano 1[image.jpg@0] toma', 'Último']);
    expect(brokenGaps(copy)).toEqual([]);
  });
});
