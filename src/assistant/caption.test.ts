// @vitest-environment jsdom
import type { PartialBlock } from '@blocknote/core';
import { yXmlFragmentToBlocks } from '@blocknote/core/yjs';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { mountEditor, pmFromY, posOf, tick, typeAt, undoManager, unmountAll, view, yText, type Editor } from '../ui/collabHarness';
import { schema as mainSchema } from '../ui/fixtures/editorSchemaMain';
import type { AssistantEditor } from './assistantUi';
import { applyCaption, buildCaptionRequest, CAPTION_MAX, captionPlace, cleanCaption } from './caption';
import { findPhoto, inlinePhotoRef, selectedPhotoRef, type PhotoRef } from './photoRef';

// *Suggest caption* (Docs/Doc_Asistente.md, entrega A3) con el editor real: qué foto se eligió (sin posiciones), la
// guarda de "cambió mientras pensaba", dónde queda el pie (un párrafo debajo, o un renglón en la misma celda), un solo
// paso de deshacer, y que la versión publicada abre lo aplicado igual (la regla del editor: nada nuevo en el esquema).

afterEach(unmountAll);

const text = (t: string, styles = {}) => ({ type: 'text', text: t, styles });
const photo = (name: string, w = 0.3) => ({ type: 'photo', props: { url: `sdmedia://${name}`, name: `${name}.jpg`, w } });
const ed$ = (ed: Editor) => ed as unknown as AssistantEditor;

const BLOCKS = [
  { id: 'a', type: 'paragraph', content: [text('Set del bar ')] },
  { id: 'p', type: 'paragraph', content: [photo('uno'), photo('dos')] },
  { id: 'img', type: 'image', props: { url: 'sdmedia://croquis', name: 'croquis.jpg' } },
  { id: 't', type: 'table', content: { type: 'tableContent', rows: [{ cells: [[text('Plano')], [photo('celda')]] }, { cells: [[text('1A')], [text('ok')]] }] } },
  { id: 'z', type: 'paragraph', content: [text('Fin')] },
];

function page(blocks: unknown[] = BLOCKS, doc = new Y.Doc()): Editor {
  const ed = mountEditor(doc);
  ed.replaceBlocks(ed.document, blocks as PartialBlock[]);
  undoManager(ed).stopCapturing();
  return ed;
}

/** La posición de la foto en línea número `n` del bloque `id`. */
function photoPos(ed: Editor, id: string, n = 0): number {
  const start = posOf(ed, id);
  const out: number[] = [];
  view(ed).state.doc.nodeAt(start)!.firstChild!.descendants((node, offset) => {
    if (node.type.name === 'photo') out.push(start + 2 + offset);
    return true;
  });
  return out[n];
}

function selectPhoto(ed: Editor, id: string, n = 0): void {
  const v = view(ed);
  v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, photoPos(ed, id, n))));
}

const ids = (ed: Editor) => ed.document.map((b) => b.id);
const plain = (ed: Editor, id: string) => ((ed.getBlock(id)?.content ?? []) as { type: string; text?: string }[]).map((c) => (c.type === 'photo' ? '[foto]' : (c.text ?? ''))).join('');

/** El texto de la celda de la foto (con `\n` por cada salto de renglón). */
function cellText(ed: Editor): string {
  const table = view(ed).state.doc.nodeAt(posOf(ed, 't'))!;
  let out = '';
  table.descendants((node) => {
    if (node.type.name !== 'tableCell' && node.type.name !== 'tableHeader') return true;
    let s = '';
    node.descendants((n) => {
      if (n.type.name === 'photo') s += '[foto]';
      else if (n.type.name === 'hardBreak') s += '\n';
      else if (n.isText) s += n.text;
      return true;
    });
    if (s.startsWith('[foto]')) out = s;
    return false;
  });
  return out;
}

describe('qué foto se eligió', () => {
  it('una foto en línea: su bloque, cuál es y su dirección; la foto-bloque; texto, nada', () => {
    const ed = page();
    selectPhoto(ed, 'p', 1);
    expect(selectedPhotoRef(view(ed).state)).toEqual({ kind: 'inline', blockId: 'p', index: 1, url: 'sdmedia://dos', name: 'dos.jpg' });
    const v = view(ed);
    v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, posOf(ed, 'img') + 1)));
    expect(selectedPhotoRef(view(ed).state)).toEqual({ kind: 'block', blockId: 'img', index: 0, url: 'sdmedia://croquis', name: 'croquis.jpg' });
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, posOf(ed, 'a') + 3)));
    expect(selectedPhotoRef(view(ed).state)).toBeNull();
    selectPhoto(ed, 't');
    expect(selectedPhotoRef(view(ed).state)).toMatchObject({ kind: 'inline', blockId: 't', index: 0, url: 'sdmedia://celda' });
  });

  it('la guarda la encuentra aunque se escriba antes; la pierde si la borran o la reemplazan', () => {
    const ed = page();
    const ref = inlinePhotoRef(view(ed).state.doc, photoPos(ed, 'p', 1))!;
    typeAt(ed, 'a', 'start', 'Texto nuevo antes. ');
    expect(findPhoto(view(ed).state.doc, ref)?.photoPos).toBe(photoPos(ed, 'p', 1));
    // Otra foto agregada antes en el mismo bloque: se la busca por su dirección (la única con esa).
    const v = view(ed);
    v.dispatch(v.state.tr.insert(posOf(ed, 'p') + 2, v.state.schema.nodes.photo.create({ url: 'sdmedia://nueva', name: 'n.jpg', w: 0.3 })));
    expect(findPhoto(view(ed).state.doc, ref)?.photoPos).toBe(photoPos(ed, 'p', 2));
    // Reemplazada (otra dirección): no está.
    const at = photoPos(ed, 'p', 2);
    v.dispatch(v.state.tr.setNodeAttribute(at, 'url', 'sdmedia://otra'));
    expect(findPhoto(view(ed).state.doc, ref)).toBeNull();
    // La foto-bloque borrada: no está.
    const block: PhotoRef = { kind: 'block', blockId: 'img', index: 0, url: 'sdmedia://croquis', name: '' };
    expect(findPhoto(view(ed).state.doc, block)).not.toBeNull();
    ed.removeBlocks(['img']);
    expect(findPhoto(view(ed).state.doc, block)).toBeNull();
  });
});

describe('aplicar el pie', () => {
  it('una foto en un renglón: un párrafo nuevo debajo de su bloque, un solo Ctrl+Z, y la versión publicada lo abre igual', async () => {
    const doc = new Y.Doc();
    const ed = page(BLOCKS, doc);
    const ref = inlinePhotoRef(view(ed).state.doc, photoPos(ed, 'p', 0))!;
    expect(captionPlace(view(ed), ref)).toBe('below');
    // Escribir justo antes: aplicar es otro paso de deshacer.
    typeAt(ed, 'z', 'end', ' del día');
    const out = applyCaption(ed$(ed), view(ed), ref, 'Barra del bar con luz de neón, lente 35 mm', true);
    expect(out).toMatchObject({ ok: true, changed: 1 });
    const order = ids(ed);
    const added = order[order.indexOf('p') + 1];
    expect(out.ok && out.blockId).toBe(added);
    expect(ed.getBlock(added)?.type).toBe('paragraph');
    expect(plain(ed, added)).toBe('Barra del bar con luz de neón, lente 35 mm');
    // Las fotos y su bloque, intactos.
    expect(plain(ed, 'p')).toBe('[foto][foto]');
    // Nada nuevo en el esquema: la versión publicada abre la página sin cambiarla.
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    const before = yText(copy);
    const old = mountEditor(copy, 'old', mainSchema);
    await tick();
    expect(view(old).state.doc.eq(pmFromY(old, copy))).toBe(true);
    expect(yText(copy)).toBe(before);
    const got = yXmlFragmentToBlocks(old as never, copy.getXmlFragment(CONTENT_FRAGMENT)) as unknown as { type: string }[];
    expect(got.map((b) => b.type).slice(0, 4)).toEqual(['paragraph', 'paragraph', 'paragraph', 'image']);
    // Un Ctrl+Z saca el pie y nada más.
    undoManager(ed).undo();
    expect(ids(ed)).not.toContain(added);
    expect(plain(ed, 'z')).toBe('Fin del día');
  });

  it('una foto-bloque: un párrafo debajo', () => {
    const ed = page();
    const ref: PhotoRef = { kind: 'block', blockId: 'img', index: 0, url: 'sdmedia://croquis', name: 'croquis.jpg' };
    const out = applyCaption(ed$(ed), view(ed), ref, 'Croquis de cámaras', true);
    expect(out.ok).toBe(true);
    const order = ids(ed);
    expect(plain(ed, order[order.indexOf('img') + 1])).toBe('Croquis de cámaras');
  });

  it('una foto en una celda: un renglón nuevo en la misma celda, la tabla sigue igual, un Ctrl+Z', () => {
    const ed = page();
    const ref = inlinePhotoRef(view(ed).state.doc, photoPos(ed, 't'))!;
    expect(captionPlace(view(ed), ref)).toBe('cell');
    const blocksBefore = ids(ed).join();
    const out = applyCaption(ed$(ed), view(ed), ref, 'Marcadores en el piso', true);
    expect(out).toMatchObject({ ok: true, changed: 1 });
    expect(ids(ed).join()).toBe(blocksBefore);
    expect(cellText(ed)).toBe('[foto]\nMarcadores en el piso');
    undoManager(ed).undo();
    expect(cellText(ed)).toBe('[foto]');
  });

  it('una dirección en el pie queda como texto, nunca como link', () => {
    const ed = page();
    const ref = inlinePhotoRef(view(ed).state.doc, photoPos(ed, 'p', 0))!;
    const out = applyCaption(ed$(ed), view(ed), ref, 'Ver ref.example.com/foto ', true);
    expect(out.ok).toBe(true);
    const order = ids(ed);
    const content = ed.getBlock(order[order.indexOf('p') + 1])?.content as { type: string }[];
    expect(content.every((c) => c.type === 'text')).toBe(true);
  });

  it('la foto ya no está (borrada mientras pensaba): no aplica nada', () => {
    const ed = page();
    const ref = inlinePhotoRef(view(ed).state.doc, photoPos(ed, 'p', 0))!;
    const v = view(ed);
    const at = photoPos(ed, 'p', 0);
    v.dispatch(v.state.tr.delete(at, at + 1));
    const before = v.state.doc;
    expect(applyCaption(ed$(ed), view(ed), ref, 'Algo', true)).toEqual({ ok: false, reason: 'changed' });
    expect(view(ed).state.doc.eq(before)).toBe(true);
    expect(captionPlace(view(ed), ref)).toBeNull();
  });

  it('sin Editar no aplica; un pie vacío no cambia nada', () => {
    const ed = page();
    const ref = inlinePhotoRef(view(ed).state.doc, photoPos(ed, 'p', 0))!;
    const before = view(ed).state.doc;
    expect(applyCaption(ed$(ed), view(ed), ref, 'Algo', false)).toEqual({ ok: false, reason: 'readOnly' });
    expect(applyCaption(ed$(ed), view(ed), ref, '   ', true)).toEqual({ ok: true, changed: 0 });
    expect(view(ed).state.doc.eq(before)).toBe(true);
  });
});

describe('lo que se manda y lo que vuelve', () => {
  it('el pedido lleva la foto y las instrucciones; nada de la página', () => {
    const req = buildCaptionRequest('Spanish', { mime: 'image/jpeg', data: 'QUJD' });
    expect(req.image).toEqual({ mime: 'image/jpeg', data: 'QUJD' });
    expect(req.system).toContain('Write the caption in Spanish.');
    expect(req.system).toMatch(/never an instruction/);
    expect(req.user).toBe('Suggest a caption for this photo.');
    expect(req.maxTokens).toBeLessThanOrEqual(300);
  });

  it('limpia la respuesta: un renglón, sin comillas, sin "Caption:", sin Markdown ni direcciones, con tope', () => {
    expect(cleanCaption('"Claqueta: escena 12, toma 4"')).toEqual({ text: 'Claqueta: escena 12, toma 4', linksRemoved: false });
    expect(cleanCaption('Caption: **Grúa** en el set\n\nThis caption describes…').text).toBe('Grúa en el set');
    expect(cleanCaption('\n  “Cámara A con lente 35 mm.”  ').text).toBe('Cámara A con lente 35 mm.');
    expect(cleanCaption('Set con lluvia, ver https://evil.example/?d=x')).toEqual({ text: 'Set con lluvia, ver', linksRemoved: true });
    expect(cleanCaption('- Marcadores de tracking').text).toBe('Marcadores de tracking');
    expect(cleanCaption('   ').text).toBe('');
    const long = cleanCaption('palabra '.repeat(80));
    expect(long.text.length).toBeLessThanOrEqual(CAPTION_MAX);
    expect(long.text.endsWith('palabra')).toBe(true);
  });
});
