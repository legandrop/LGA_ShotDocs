// @vitest-environment jsdom
import type { PartialBlock } from '@blocknote/core';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { connect, mountEditor, pmFromY, posOf, typeAt, undoManager, unmountAll, view, yText, type Editor } from '../ui/collabHarness';
import { schema as mainSchema } from '../ui/fixtures/editorSchemaMain';
import { applySuggestion, retakeSnapshot, takeSnapshot, unchangedShift, type Snapshot } from './apply';
import { parseAnswer, type Parsed } from './markup';

// Aplicar una sugerencia con el editor real (Docs/Doc_Asistente.md, 6.1, 6.5 y pruebas 5 y 6 de la sección 13): un
// solo paso de deshacer, el bloque con su id, su tipo y sus propiedades, la foto en línea que sigue en su lugar, la
// guarda de "cambió mientras pensaba", el permiso de editar, editar a la vez y la versión publicada abriendo lo aplicado.

afterEach(unmountAll);

const settle = () => new Promise((r) => setTimeout(r, 0));
const photo = (name: string) => ({ type: 'photo', props: { url: `sdmedia://${name}`, name: `${name}.jpg`, w: 0.3 } });

function page(blocks: unknown[], doc = new Y.Doc()): Editor {
  const ed = mountEditor(doc);
  ed.replaceBlocks(ed.document, blocks as PartialBlock[]);
  undoManager(ed).stopCapturing();
  return ed;
}

function select(ed: Editor, fromId: string, a: number, toId: string, b: number): void {
  const v = view(ed);
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, posOf(ed, fromId) + 2 + a, posOf(ed, toId) + 2 + b)));
}

function snap(ed: Editor): Snapshot {
  const s = takeSnapshot(view(ed).state);
  if (typeof s === 'string') throw new Error(s);
  return s;
}

function answer(s: Snapshot, text: string): Parsed {
  const p = parseAnswer(text, s.selected);
  if (typeof p === 'string') throw new Error(p);
  return p;
}

const textOf = (ed: Editor, id: string) =>
  ((ed.getBlock(id)?.content ?? []) as { type: string; text?: string; content?: { text: string }[] }[])
    .map((c) => (c.type === 'photo' ? '[foto]' : c.type === 'link' ? (c.content ?? []).map((x) => x.text).join('') : c.text ?? ''))
    .join('');

/** Los elementos de Yjs de las fotos en línea de un documento (para ver que son los mismos, no recreados). */
function yPhotos(doc: Y.Doc): Y.XmlElement[] {
  const out: Y.XmlElement[] = [];
  const walk = (t: Y.XmlFragment | Y.XmlElement) => {
    for (const c of t.toArray()) {
      if (c instanceof Y.XmlElement) {
        if (c.nodeName === 'photo') out.push(c);
        walk(c);
      } else if (c instanceof Y.XmlText) {
        for (const d of c.toDelta() as { insert: unknown }[]) if (d.insert instanceof Y.XmlElement && d.insert.nodeName === 'photo') out.push(d.insert);
      }
    }
  };
  walk(doc.getXmlFragment(CONTENT_FRAGMENT));
  return out;
}

describe('aplicar', () => {
  it('reemplaza solo lo elegido, conserva el bloque (id, tipo, Script, color) y se deshace en UN paso, también escribiendo justo antes', () => {
    const ed = page([
      { id: 'a', type: 'paragraph', props: { script: true, textColor: 'blue' }, content: 'Antes. el kamara se movio en la toma 3. Después.' },
      { id: 'b', type: 'heading', props: { level: 2 }, content: 'Otro bloque' },
    ]);
    // Escribir algo justo antes (sin pausa): no se junta con aplicar.
    typeAt(ed, 'b', 'end', ' extra');
    select(ed, 'a', 7, 'a', 38);
    const s = snap(ed);
    expect(s.selected.markdown).toBe('el kamara se movio en la toma 3');
    const before = undoManager(ed).undoStack.length;
    const out = applySuggestion(view(ed), s, answer(s, 'La cámara se movió en la toma 3'), true);
    expect(out.ok).toBe(true);
    expect(textOf(ed, 'a')).toBe('Antes. La cámara se movió en la toma 3. Después.');
    const block = ed.getBlock('a')!;
    expect(block.type).toBe('paragraph');
    expect((block.props as Record<string, unknown>).script).toBe(true);
    expect((block.props as Record<string, unknown>).textColor).toBe('blue');
    expect(undoManager(ed).undoStack.length).toBe(before + 1);
    // Ctrl/⌘+Z: vuelve el texto con el error, y lo escrito antes sigue.
    ed.undo();
    expect(textOf(ed, 'a')).toBe('Antes. el kamara se movio en la toma 3. Después.');
    expect(textOf(ed, 'b')).toBe('Otro bloque extra');
    ed.redo();
    expect(textOf(ed, 'a')).toBe('Antes. La cámara se movió en la toma 3. Después.');
  });

  it('una foto en línea dentro de lo elegido sobrevive (el mismo elemento de Yjs) y un link conserva su dirección', () => {
    const doc = new Y.Doc();
    const ed = page(
      [
        {
          id: 'p',
          type: 'paragraph',
          content: [{ type: 'text', text: 'El plano general de la calle ', styles: {} }, photo('calle'), { type: 'text', text: ' con mucha lluvia muy fuerte y ', styles: {} }, { type: 'link', href: 'https://ref.example/a', content: 'la referencia' }],
        },
      ],
      doc,
    );
    const [photoBefore] = yPhotos(doc);
    expect(photoBefore).toBeDefined();
    select(ed, 'p', 0, 'p', 74);
    const s = snap(ed);
    expect(s.selected.markdown).toBe('El plano general de la calle ⟦photo:1⟧ con mucha lluvia muy fuerte y ⟦link:1⟧la referencia⟦/link⟧');
    const out = applySuggestion(view(ed), s, answer(s, 'Plano general de la calle ⟦photo:1⟧ con lluvia y ⟦link:1⟧referencia⟦/link⟧'), true);
    expect(out.ok).toBe(true);
    expect(textOf(ed, 'p')).toBe('Plano general de la calle [foto] con lluvia y referencia');
    const after = yPhotos(doc);
    expect(after).toHaveLength(1);
    expect(after[0]).toBe(photoBefore);
    const link = (ed.getBlock('p')!.content as { type: string; href?: string }[]).find((c) => c.type === 'link');
    expect(link?.href).toBe('https://ref.example/a');
    ed.undo();
    expect(textOf(ed, 'p')).toBe('El plano general de la calle [foto] con mucha lluvia muy fuerte y la referencia');
    expect(yPhotos(doc)).toHaveLength(1);
  });

  it('varios bloques con una foto-bloque en el medio: la foto no se toca y cada bloque conserva su id', () => {
    const doc = new Y.Doc();
    const ed = page(
      [
        { id: 'a', type: 'bulletListItem', content: 'primer renglon' },
        { id: 'img', type: 'image', props: { url: 'sdmedia://foto', name: 'foto.jpg' } },
        { id: 'c', type: 'checkListItem', props: { checked: true }, content: 'tercer renglon' },
      ],
      doc,
    );
    const imageBefore = (doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).get(1);
    select(ed, 'a', 0, 'c', 14);
    const s = snap(ed);
    expect(s.selected.markdown).toBe('- primer renglon\n\n⟦block:1⟧\n\n[x] tercer renglon');
    expect(applySuggestion(view(ed), s, answer(s, '- Primer renglón\n\n⟦block:1⟧\n\n[x] Tercer renglón'), true).ok).toBe(true);
    expect(ed.document.map((b) => b.id)).toEqual(['a', 'img', 'c']);
    expect(ed.document.map((b) => b.type)).toEqual(['bulletListItem', 'image', 'checkListItem']);
    expect(textOf(ed, 'a')).toBe('Primer renglón');
    expect(textOf(ed, 'c')).toBe('Tercer renglón');
    expect((doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).get(1)).toBe(imageBefore);
  });

  it('sin cambios no escribe nada', () => {
    const ed = page([{ id: 'p', type: 'paragraph', content: 'Todo bien.' }]);
    select(ed, 'p', 0, 'p', 10);
    const s = snap(ed);
    const before = undoManager(ed).undoStack.length;
    expect(applySuggestion(view(ed), s, answer(s, 'Todo bien.'), true)).toEqual({ ok: true, changed: 0 });
    expect(undoManager(ed).undoStack.length).toBe(before);
  });
});

describe('la guarda de "cambió mientras pensaba" (6.1, paso 6)', () => {
  it('otro escribe DENTRO de lo elegido mientras el modelo piensa: no se aplica nada', async () => {
    const da = new Y.Doc();
    const db = new Y.Doc();
    const link = connect(da, db, 'sync');
    const a = page([{ id: 'p', type: 'paragraph', content: 'el kamara se movio en la toma 3' }], da);
    const b = mountEditor(db, 'B');
    await settle();
    select(a, 'p', 0, 'p', 31);
    const s = snap(a);
    typeAt(b, 'p', 9, ' nueva');
    link.flush();
    await settle();
    expect(textOf(a, 'p')).toBe('el kamara nueva se movio en la toma 3');
    expect(unchangedShift(view(a).state, s)).toBeNull();
    expect(applySuggestion(view(a), s, answer(s, 'La cámara se movió en la toma 3'), true)).toEqual({ ok: false, reason: 'changed' });
    expect(textOf(a, 'p')).toBe('el kamara nueva se movio en la toma 3');
    // *Try again*: una foto nueva del mismo lugar, con lo que hay hoy.
    const again = retakeSnapshot(view(a).state, s);
    if (typeof again === 'string') throw new Error(again);
    expect(again.selected.markdown).toBe('el kamara nueva se movio en la toma 3');
  });

  it('la misma persona escribe dentro de lo elegido (paso 5 de la aceptación): no se aplica nada', () => {
    const ed = page([{ id: 'p', type: 'paragraph', content: 'Plano general de la calle con lluvia.' }]);
    select(ed, 'p', 0, 'p', 37);
    const s = snap(ed);
    typeAt(ed, 'p', 13, ' amplio');
    expect(applySuggestion(view(ed), s, answer(s, 'Plano general de la calle bajo la lluvia.'), true)).toEqual({ ok: false, reason: 'changed' });
    expect(textOf(ed, 'p')).toBe('Plano general amplio de la calle con lluvia.');
  });

  it('un cambio de formato adentro también cuenta como cambio', () => {
    const ed = page([{ id: 'p', type: 'paragraph', content: 'Plano general de la calle.' }]);
    select(ed, 'p', 0, 'p', 26);
    const s = snap(ed);
    const v = view(ed);
    v.dispatch(v.state.tr.addMark(posOf(ed, 'p') + 2, posOf(ed, 'p') + 7, v.state.schema.marks.bold.create()));
    expect(applySuggestion(v, s, answer(s, 'Plano general.'), true)).toEqual({ ok: false, reason: 'changed' });
  });

  it('otro escribe AFUERA (otro bloque, y el mismo bloque antes de lo elegido): se aplica y lo del otro queda', async () => {
    const da = new Y.Doc();
    const db = new Y.Doc();
    const link = connect(da, db, 'sync');
    const a = page(
      [
        { id: 'x', type: 'paragraph', content: 'Arriba.' },
        { id: 'p', type: 'paragraph', content: 'Inicio: el kamara se movio.' },
      ],
      da,
    );
    const b = mountEditor(db, 'B');
    await settle();
    select(a, 'p', 7, 'p', 27);
    const s = snap(a);
    typeAt(b, 'x', 'end', ' Escrito por B.');
    typeAt(b, 'p', 0, 'B: ');
    link.flush();
    await settle();
    const out = applySuggestion(view(a), s, answer(s, 'la cámara se movió.'), true);
    expect(out.ok).toBe(true);
    await settle();
    expect(textOf(a, 'x')).toBe('Arriba. Escrito por B.');
    expect(textOf(a, 'p')).toBe('B: Inicio: la cámara se movió.');
    expect(yText(da)).toBe(yText(db));
  });

  it('otro borra el bloque: no se aplica', async () => {
    const da = new Y.Doc();
    const db = new Y.Doc();
    const link = connect(da, db, 'sync');
    const a = page(
      [
        { id: 'p', type: 'paragraph', content: 'el kamara se movio' },
        { id: 'q', type: 'paragraph', content: 'queda' },
      ],
      da,
    );
    const b = mountEditor(db, 'B');
    await settle();
    select(a, 'p', 0, 'p', 18);
    const s = snap(a);
    b.removeBlocks(['p']);
    link.flush();
    await settle();
    expect(applySuggestion(view(a), s, answer(s, 'La cámara se movió'), true)).toEqual({ ok: false, reason: 'changed' });
    expect(a.document.map((x) => x.id)).toEqual(['q']);
  });
});

describe('el permiso de aplicar (IA6)', () => {
  it('sin Editar no aplica nada (aunque el editor sea editable), y con el editor en solo lectura tampoco', () => {
    const ed = page([{ id: 'p', type: 'paragraph', content: 'el kamara' }]);
    select(ed, 'p', 0, 'p', 9);
    const s = snap(ed);
    const before = undoManager(ed).undoStack.length;
    expect(applySuggestion(view(ed), s, answer(s, 'La cámara'), false)).toEqual({ ok: false, reason: 'readOnly' });
    expect(textOf(ed, 'p')).toBe('el kamara');
    ed.isEditable = false;
    expect(applySuggestion(view(ed), s, answer(s, 'La cámara'), true)).toEqual({ ok: false, reason: 'readOnly' });
    expect(textOf(ed, 'p')).toBe('el kamara');
    expect(undoManager(ed).undoStack.length).toBe(before);
  });
});

describe('editar a la vez sin red (6.5)', () => {
  it('con Fix, lo que otro escribió sin red dentro de lo elegido y llega después queda en la página', async () => {
    const da = new Y.Doc();
    const db = new Y.Doc();
    const link = connect(da, db, 'async');
    const a = page([{ id: 'p', type: 'paragraph', content: 'el kamara se movio en la toma 3' }], da);
    link.flush();
    const b = mountEditor(db, 'B');
    await settle();
    link.offline();
    typeAt(b, 'p', 31, ' (de B)');
    select(a, 'p', 0, 'p', 31);
    const s = snap(a);
    expect(applySuggestion(view(a), s, answer(s, 'La cámara se movió en la toma 3'), true).ok).toBe(true);
    link.online();
    link.flush();
    await settle();
    expect(yText(da)).toBe(yText(db));
    expect(textOf(a, 'p')).toContain('(de B)');
    expect(textOf(a, 'p')).toContain('cámara');
    expect(view(a).state.doc.eq(pmFromY(a, da))).toBe(true);
  });
});

describe('versiones viejas (regla del editor)', () => {
  it('la versión publicada de la app (su esquema) abre lo aplicado igual, con la foto en línea, sin borrar nada', async () => {
    const doc = new Y.Doc();
    const ed = page(
      [
        { id: 'p', type: 'paragraph', props: { script: true }, content: [{ type: 'text', text: 'INT. BAR - DIA. el kamara ', styles: {} }, photo('bar'), { type: 'text', text: ' se movio', styles: { bold: true } }] },
        { id: 'q', type: 'numberedListItem', content: 'segundo item' },
      ],
      doc,
    );
    select(ed, 'p', 0, 'q', 12);
    const s = snap(ed);
    expect(applySuggestion(view(ed), s, answer(s, 'INT. BAR - DÍA. La cámara ⟦photo:1⟧** se movió**\n\n1. Segundo ítem'), true).ok).toBe(true);
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    const before = yText(copy);
    const old = mountEditor(copy, 'old', mainSchema);
    await settle();
    expect(yText(copy)).toBe(before);
    expect(yPhotos(copy)).toHaveLength(1);
    expect(view(old).state.doc.eq(pmFromY(old, copy))).toBe(true);
    expect(textOf(old, 'p')).toBe('INT. BAR - DÍA. La cámara [foto] se movió');
  });
});
