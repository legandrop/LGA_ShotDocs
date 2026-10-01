// @vitest-environment jsdom
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { t } from '../i18n';
import { CONTENT_FRAGMENT } from '../sync/structure';
import type { HeadingRecord } from './collapse';
import { connect, yText } from './collabHarness';
import { toggleTip } from './CollapseToggles';
import {
  collapseExtension,
  collapseState,
  headingCollapse,
  readShared,
  setAllCollapsed,
  setCollapsed,
  SHARED_COLLAPSE_MAP,
  toggleCollapsed,
  toggleShared,
} from './collapseEditor';
import { schema } from './editorSchema';
import { schema as mainSchema } from './fixtures/editorSchemaMain';

// Colapsar para todos (P.11, entrega 2; Docs/Doc_Colapsar.md §4): un mapa de la página, al lado del contenido en el
// mismo Y.Doc. Shift+clic (quien puede editar) lo escribe; lo tuyo, si lo hay, manda sobre lo de todos; el mapa no
// es contenido (no se deshace con Ctrl+Z, no cambia el fragmento) y una versión vieja lo conserva sin verlo.

Range.prototype.getClientRects ??= (() => []) as never;
Range.prototype.getBoundingClientRect ??= (() => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 })) as never;

const editors: BlockNoteEditor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
  document.body.replaceChildren();
});

interface Mounted {
  editor: BlockNoteEditor;
  saves: ReadonlyMap<string, HeadingRecord>[];
}

function mount(doc: Y.Doc, { canShare = true, initial }: { canShare?: boolean; initial?: ReadonlyMap<string, HeadingRecord> } = {}): Mounted {
  const saves: ReadonlyMap<string, HeadingRecord>[] = [];
  const editor = BlockNoteEditor.create(
    withCollaboration({
      schema,
      collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
      extensions: [collapseExtension({ initial, shared: doc.getMap(SHARED_COLLAPSE_MAP), canShare: () => canShare, save: (r) => saves.push(r) })],
    }),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  editor.mount(el);
  editors.push(editor);
  return { editor, saves };
}

const h = (id: string, text: string) => ({ id, type: 'heading', props: { level: 2 }, content: text }) as PartialBlock;
const p = (id: string, text: string) => ({ id, type: 'paragraph', content: text }) as PartialBlock;
const PAGE = [p('top', 'top'), h('S', 'Section'), p('s1', 'one'), h('T', 'Other'), p('t1', 'two')];
const view = (e: BlockNoteEditor) => e.prosemirrorView!;
const hidden = (e: BlockNoteEditor) => [...collapseState(e.prosemirrorState)!.analysis.hidden.keys()].sort();
const map = (d: Y.Doc) => d.getMap(SHARED_COLLAPSE_MAP);

/** Dos personas con la misma página, conectadas (cada cambio llega al otro enseguida). */
function two(options: { canShareB?: boolean } = {}) {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  connect(docA, docB, 'sync');
  const A = mount(docA);
  const B = mount(docB, { canShare: options.canShareB ?? true });
  A.editor.replaceBlocks(A.editor.document, PAGE as never);
  return { docA, docB, A: A.editor, B: B.editor, savesA: A.saves };
}

describe('Shift+clic: para todos', () => {
  it('colapsa para todos: el otro lo ve colapsado; el contenido no cambia; Ctrl+Z no lo deshace', () => {
    const { docA, docB, A, B } = two();
    const text = yText(docA);
    expect(toggleShared(view(A), 'S')).toBe(true);
    expect(map(docB).get('S')).toBe(true);
    expect(hidden(A)).toEqual(['s1']);
    expect(hidden(B)).toEqual(['s1']);
    expect(headingCollapse(B.prosemirrorState, 'S')).toEqual({ collapsed: true, forAll: true, onlyYou: false });
    // Lo tuyo no se guarda (ves lo de todos).
    expect(collapseState(A.prosemirrorState)!.records.has('S')).toBe(false);
    expect(yText(docA)).toBe(text);
    A.undo();
    expect(map(docA).get('S')).toBe(true);
    // Abrir para todos borra la clave (no se juntan valores `false`).
    expect(toggleShared(view(B), 'S')).toBe(true);
    expect(map(docA).has('S')).toBe(false);
    expect(hidden(A)).toEqual([]);
  });

  it('lo tuyo manda: un Shift+clic de otro no cambia lo que ve quien tiene lo suyo (decisión 17)', () => {
    const { A, B } = two();
    toggleShared(view(A), 'S');
    // B lo abre solo para B (un clic): queda guardado como suyo.
    toggleCollapsed(view(B), 'S');
    expect(hidden(B)).toEqual([]);
    expect(headingCollapse(B.prosemirrorState, 'S')).toEqual({ collapsed: false, forAll: true, onlyYou: true });
    // A lo abre y lo vuelve a colapsar para todos: B sigue viéndolo abierto.
    toggleShared(view(A), 'S');
    toggleShared(view(A), 'S');
    expect(hidden(A)).toEqual(['s1']);
    expect(hidden(B)).toEqual([]);
  });

  it('si lo que ves es solo tuyo, Shift+clic lo pasa a todos; si no, lo cambia para todos (la tabla del §3)', () => {
    const { docA, A, B } = two();
    // Colapsado solo para vos → Shift+clic: colapsar para todos.
    toggleCollapsed(view(A), 'S');
    expect(headingCollapse(A.prosemirrorState, 'S')).toEqual({ collapsed: true, forAll: false, onlyYou: true });
    toggleShared(view(A), 'S');
    expect(map(docA).get('S')).toBe(true);
    expect(headingCollapse(A.prosemirrorState, 'S')).toEqual({ collapsed: true, forAll: true, onlyYou: false });
    expect(hidden(B)).toEqual(['s1']);
    // Abierto solo para vos (para los demás colapsado) → Shift+clic: abrir para todos.
    toggleCollapsed(view(A), 'S');
    expect(headingCollapse(A.prosemirrorState, 'S')).toEqual({ collapsed: false, forAll: true, onlyYou: true });
    toggleShared(view(A), 'S');
    expect(map(docA).has('S')).toBe(false);
    expect(hidden(A)).toEqual([]);
    expect(hidden(B)).toEqual([]);
    // Abierto para todos → Shift+clic: colapsar para todos; colapsado para todos → abrir para todos.
    toggleShared(view(A), 'S');
    expect(hidden(B)).toEqual(['s1']);
    toggleShared(view(A), 'S');
    expect(hidden(B)).toEqual([]);
  });

  it('sin permiso de editar no escribe el mapa, y el atajo con Shift colapsa solo para vos', () => {
    const { docA, docB, B } = two({ canShareB: false });
    expect(toggleShared(view(B), 'S')).toBe(false);
    expect(map(docA).size).toBe(0);
    const v = view(B);
    let at = -1;
    v.state.doc.descendants((n, pos) => {
      if (at < 0 && n.type.name === 'blockContainer' && n.attrs.id === 'S') at = pos + 2;
      return at < 0;
    });
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, at)));
    v.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, altKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    expect(hidden(B)).toEqual(['s1']);
    expect(map(docB).size).toBe(0);
    expect(collapseState(B.prosemirrorState)!.records.get('S')?.c).toBe(true);
  });

  it('en solo lectura (el editor no editable) tampoco', () => {
    const { docA, B } = two();
    B.isEditable = false;
    expect(toggleShared(view(B), 'S')).toBe(false);
    expect(map(docA).size).toBe(0);
  });

  it('lo que otro colapsa para todos y escondería tu selección queda abierto para vos, con un aviso (corrección 5)', () => {
    const { A, B } = two();
    const notices: string[] = [];
    const listen = (e: Event) => notices.push((e as CustomEvent<string>).detail);
    window.addEventListener('shotdocs:notice', listen);
    try {
      const v = view(B);
      let at = -1;
      v.state.doc.descendants((n, pos) => {
        if (at < 0 && n.type.name === 'blockContainer' && n.attrs.id === 's1') at = pos + 3;
        return at < 0;
      });
      v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, at)));
      toggleShared(view(A), 'S');
      expect(hidden(A)).toEqual(['s1']);
      expect(hidden(B)).toEqual([]);
      expect(collapseState(B.prosemirrorState)!.records.get('S')).toEqual({ c: false, g: null });
      expect(notices).toEqual([t('collapse.keptOpen')]);
      // Otro que colapsa para todos un título donde no estás: lo ves colapsado, sin aviso.
      toggleShared(view(A), 'T');
      expect(hidden(B)).toEqual(['t1']);
      expect(notices).toHaveLength(1);
    } finally {
      window.removeEventListener('shotdocs:notice', listen);
    }
  });

  it('"Colapsar todo" y "Abrir todo" guardan lo tuyo en todos los títulos: lo de todos ya no los cambia', () => {
    const { A, B } = two();
    setAllCollapsed(view(B), false);
    expect([...collapseState(B.prosemirrorState)!.records.values()].map((r) => r.c)).toEqual([false, false]);
    toggleShared(view(A), 'S');
    expect(hidden(B)).toEqual([]);
    setAllCollapsed(view(B), true);
    toggleShared(view(A), 'S');
    expect(hidden(A)).toEqual([]);
    expect(hidden(B)).toEqual(['s1', 't1']);
  });

  it('un clic abre para vos lo colapsado para todos (y queda guardado); colapsar para vos sigue igual', () => {
    const { A, B } = two();
    toggleShared(view(A), 'S');
    setCollapsed(view(B), ['S'], false);
    expect(collapseState(B.prosemirrorState)!.records.get('S')).toEqual({ c: false, g: null });
    expect(hidden(B)).toEqual([]);
    expect(hidden(A)).toEqual(['s1']);
  });

  it('Enter al final de un título colapsado para todos: el renglón nuevo se ve (el fin pasa a ser tuyo)', () => {
    const { A, B } = two();
    toggleShared(view(A), 'S');
    const v = view(B);
    let at = -1;
    v.state.doc.descendants((n, pos) => {
      if (at < 0 && n.type.name === 'blockContainer' && n.attrs.id === 'S') at = pos + 2 + n.firstChild!.content.size;
      return at < 0;
    });
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, at)));
    v.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const record = collapseState(B.prosemirrorState)!.records.get('S');
    expect(record?.c).toBe(true);
    expect(record?.e).toBeTypeOf('string');
    expect(hidden(B)).toEqual(['s1']);
  });
});

describe('el tooltip del triángulo (Doc_Colapsar.md §3)', () => {
  const tip = (collapsed: boolean, forAll: boolean, canShare: boolean) => toggleTip(t as never, { collapsed, forAll }, canShare).split('\n').slice(0, 2);
  it('quien puede editar: los cuatro estados', () => {
    expect(tip(false, false, true)).toEqual([`**${t('collapse.collapseJustYou')}**`, t('collapse.shiftForAll')]);
    expect(tip(true, false, true)).toEqual([`**${t('collapse.collapsedJustYou')}**`, t('collapse.clickOpenShiftCollapseAll')]);
    expect(tip(true, true, true)).toEqual([`**${t('collapse.collapsedForAll')}**`, t('collapse.clickOpenYouShiftOpenAll')]);
    expect(tip(false, true, true)).toEqual([`**${t('collapse.openJustYou')}**`, t('collapse.clickCollapseShiftOpenAll')]);
  });
  it('quien solo ve o comenta: sin Shift', () => {
    for (const [c, f] of [
      [false, false],
      [true, false],
      [true, true],
      [false, true],
    ] as const)
      expect(tip(c, f, false).join(' ')).not.toMatch(/Shift/);
    expect(tip(true, true, false)[0]).toBe(`**${t('collapse.expand')}**`);
  });
});

describe('versiones', () => {
  it('una versión vieja del editor (sin el mapa) edita la página y el mapa sigue; la nueva lo ve colapsado', async () => {
    const docA = new Y.Doc();
    const A = mount(docA).editor;
    A.replaceBlocks(A.document, PAGE as never);
    toggleShared(view(A), 'S');
    // La versión publicada: su esquema, sin colapsar ni el mapa (un Y.Doc que nunca lo pide).
    const old = new Y.Doc();
    Y.applyUpdate(old, Y.encodeStateAsUpdate(docA));
    const oldEditor = BlockNoteEditor.create(
      withCollaboration({ schema: mainSchema as never, collaboration: { fragment: old.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'o', color: '#000' } } }),
    ) as unknown as BlockNoteEditor;
    const el = document.createElement('div');
    document.body.appendChild(el);
    oldEditor.mount(el);
    editors.push(oldEditor);
    oldEditor.insertBlocks([{ type: 'paragraph', content: 'old edit' } as never], 't1', 'after');
    // Lo que sube la versión vieja (el estado entero) lleva el mapa.
    const server = new Y.Doc();
    Y.applyUpdate(server, Y.encodeStateAsUpdate(old));
    expect(readShared(server.getMap(SHARED_COLLAPSE_MAP))).toEqual(new Set(['S']));
    expect(yText(server)).toContain('old edit');
    const fresh = mount(server).editor;
    expect(hidden(fresh)).toEqual(['s1']);
  });

  it('el mapa no es contenido: abrir la página no lo crea ni escribe nada', () => {
    const doc = new Y.Doc();
    const writes: unknown[] = [];
    const A = mount(doc).editor;
    A.replaceBlocks(A.document, PAGE as never);
    doc.on('update', (_u: Uint8Array, origin: unknown) => writes.push(origin));
    const again = mount(doc).editor;
    expect(hidden(again)).toEqual([]);
    expect(writes).toEqual([]);
  });
});
