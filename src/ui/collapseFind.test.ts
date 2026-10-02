// @vitest-environment jsdom
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { afterEach, describe, expect, it } from 'vitest';
import { yUndoPluginKey } from 'y-prosemirror';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import type { HeadingRecord } from './collapse';
import { collapseExtension, collapseState, setCollapsed, SHARED_COLLAPSE_MAP, toggleShared } from './collapseEditor';
import { schema } from './editorSchema';
import { clearFind, closeFind, findExtension, getFindState, hiddenCount, replaceAll, setFind, stepFind } from './findEditor';

// Colapsar (Docs/Doc_Colapsar.md) con la búsqueda en la página (Docs/Doc_Buscar.md), con el editor real y las dos
// extensiones. Decisión D11 de Lega (2026-10-02): al buscar, las secciones colapsadas que esconden coincidencias se
// abren, solo a la vista y en este dispositivo (nunca se escribe el Y.Doc ni lo colapsado para todos, ni se guarda
// en el dispositivo), y al terminar la búsqueda vuelven a cerrarse, salvo lo que la persona tocó. "Reemplazar todo"
// (que escribe en el Y.Doc) y su deshacer y rehacer no abren nada por sí mismos.

Range.prototype.getClientRects ??= (() => []) as never;
Range.prototype.getBoundingClientRect ??= (() => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 })) as never;

const editors: BlockNoteEditor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.unmount();
  document.body.replaceChildren();
});

function page(blocks: PartialBlock[], { shared = false }: { shared?: boolean } = {}) {
  const doc = new Y.Doc();
  const saves: ReadonlyMap<string, HeadingRecord>[] = [];
  const editor = BlockNoteEditor.create(
    withCollaboration({
      schema,
      extensions: [findExtension, collapseExtension({ save: (r) => saves.push(r), ...(shared ? { shared: doc.getMap(SHARED_COLLAPSE_MAP), canShare: () => true } : {}) })],
      collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
    }),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  document.body.appendChild(el);
  editor.mount(el);
  editors.push(editor);
  editor.replaceBlocks(editor.document, blocks as never);
  return { editor, doc, saves };
}

/** Cuántas veces cambió el Y.Doc (contenido o mapa de "para todos") desde que se llama. */
function countUpdates(doc: Y.Doc): { count: () => number } {
  let n = 0;
  doc.on('update', () => n++);
  return { count: () => n };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const h = (text: string) => ({ type: 'heading', props: { level: 2 }, content: text }) as PartialBlock;
const p = (text: string) => ({ type: 'paragraph', content: text }) as PartialBlock;
const view = (e: BlockNoteEditor) => e.prosemirrorView!;
const tick = () => new Promise((r) => setTimeout(r, 30));
const texts = (e: BlockNoteEditor) => e.document.map((b) => (Array.isArray(b.content) ? b.content.map((c) => ('text' in c ? c.text : '')).join('') : ''));
const hiddenTexts = (e: BlockNoteEditor) => {
  const hidden = collapseState(view(e).state)!.analysis.hidden;
  return e.document.filter((b) => hidden.has(b.id)).map((b) => (Array.isArray(b.content) ? b.content.map((c) => ('text' in c ? c.text : '')).join('') : ''));
};

describe('buscar con secciones colapsadas', () => {
  it('abre las secciones que esconden coincidencias (solo esas) y deja colapsadas las demás', () => {
    const { editor } = page([h('T'), p('uno escondido'), h('U'), p('uno visible'), h('V'), p('nada')]);
    setCollapsed(view(editor), [editor.document[0].id, editor.document[4].id], true);
    editor.setTextCursorPosition(editor.document[3].id, 'start');
    setFind(view(editor), 'uno', {});
    const state = getFindState(view(editor).state);
    expect(state.matches).toHaveLength(2);
    // D11: la sección con la coincidencia ya se abrió sola; la otra sigue colapsada.
    expect(hiddenCount(state.matches, view(editor))).toBe(0);
    expect(hiddenTexts(editor)).toEqual(['nada']);
    stepFind(view(editor), 1);
    expect(hiddenTexts(editor)).toEqual(['nada']);
  });

  it('"Reemplazar todo" en secciones colapsadas las deja colapsadas; deshacer y rehacer también', async () => {
    const { editor } = page([h('T'), p('uno uno'), h('U'), p('otro uno'), h('V'), p('uno')]);
    await tick();
    const um = (yUndoPluginKey.getState(view(editor).state as never) as { undoManager: Y.UndoManager }).undoManager;
    um.stopCapturing();
    setCollapsed(view(editor), [editor.document[0].id, editor.document[2].id], true);
    const before = hiddenTexts(editor);
    expect(before).toEqual(['uno uno', 'otro uno']);
    setFind(view(editor), 'uno', {});
    // D11: buscar las abrió.
    expect(hiddenTexts(editor)).toEqual([]);
    const result = replaceAll(editor, 'dos');
    expect(result.replaced).toBe(4);
    expect(texts(editor)).toEqual(['T', 'dos dos', 'U', 'otro dos', 'V', 'dos']);
    // Ya no hay coincidencias: al volver a buscar, vuelven a quedar colapsadas.
    await wait(400);
    expect(getFindState(view(editor).state).matches).toHaveLength(0);
    expect(hiddenTexts(editor)).toEqual(['dos dos', 'otro dos']);
    clearFind(view(editor));
    um.undo();
    await tick();
    expect(texts(editor)).toEqual(['T', 'uno uno', 'U', 'otro uno', 'V', 'uno']);
    expect(hiddenTexts(editor)).toEqual(['uno uno', 'otro uno']);
    um.redo();
    await tick();
    expect(texts(editor)).toEqual(['T', 'dos dos', 'U', 'otro dos', 'V', 'dos']);
    expect(hiddenTexts(editor)).toEqual(['dos dos', 'otro dos']);
  });

  it('los enganches son de cada editor: abrir otro y cerrarlo no se los saca al primero', () => {
    const one = page([h('T'), p('uno'), h('U')]);
    const two = page([h('T'), p('uno'), h('U')]);
    two.editor.unmount();
    editors.splice(editors.indexOf(two.editor), 1);
    setCollapsed(view(one.editor), [one.editor.document[0].id], true);
    setFind(view(one.editor), 'uno', {});
    expect(hiddenTexts(one.editor)).toEqual([]);
    closeFind(view(one.editor), { select: false });
    expect(hiddenTexts(one.editor)).toEqual(['uno']);
  });

  // --- D11: abrir al buscar, cerrar al terminar ---------------------------------------------------------------

  const PAGE = () => [h('A'), p('uno en A'), h('B'), p('nada en B'), h('C'), p('uno en C'), h('D'), p('nada en D')];
  const heads = (e: BlockNoteEditor) => [0, 2, 4, 6].map((i) => e.document[i].id);

  it('al cerrar la búsqueda las secciones que abrió vuelven a colapsarse', () => {
    const { editor } = page(PAGE());
    const ids = heads(editor);
    setCollapsed(view(editor), ids, true);
    expect(hiddenTexts(editor)).toEqual(['uno en A', 'nada en B', 'uno en C', 'nada en D']);
    setFind(view(editor), 'uno', {});
    expect(hiddenTexts(editor)).toEqual(['nada en B', 'nada en D']);
    closeFind(view(editor), { select: false });
    expect(hiddenTexts(editor)).toEqual(['uno en A', 'nada en B', 'uno en C', 'nada en D']);
    expect([...collapseState(view(editor).state)!.records.keys()].sort()).toEqual([...ids].sort());
  });

  it('al cambiar lo buscado, se cierran las que ya no tienen coincidencias y se abren las nuevas', () => {
    const { editor } = page(PAGE());
    setCollapsed(view(editor), heads(editor), true);
    setFind(view(editor), 'uno', {});
    expect(hiddenTexts(editor)).toEqual(['nada en B', 'nada en D']);
    setFind(view(editor), 'en B', {});
    expect(hiddenTexts(editor)).toEqual(['uno en A', 'uno en C', 'nada en D']);
    setFind(view(editor), 'zzz', {});
    expect(hiddenTexts(editor)).toEqual(['uno en A', 'nada en B', 'uno en C', 'nada en D']);
  });

  it('Esc (cerrar dejando elegida la coincidencia): queda abierta la sección donde está, las demás se cierran', () => {
    const { editor } = page(PAGE());
    setCollapsed(view(editor), heads(editor), true);
    setFind(view(editor), 'uno', {});
    stepFind(view(editor), 1);
    expect(getFindState(view(editor).state).current).toBe(1);
    closeFind(view(editor), { select: true });
    // La selección quedó en "uno en C": esa sección sigue abierta y es tuya; la de A vuelve a su lugar.
    expect(hiddenTexts(editor)).toEqual(['uno en A', 'nada en B', 'nada en D']);
    expect(view(editor).state.selection.empty).toBe(false);
  });

  it('lo que la persona toca durante la búsqueda es suyo: no se vuelve a cerrar ni a abrir sola', () => {
    const { editor } = page(PAGE());
    const [a, b, c, d] = heads(editor);
    setCollapsed(view(editor), [a, b, c, d], true);
    setFind(view(editor), 'uno', {});
    // Cierra con el triángulo la de A, que la búsqueda había abierto.
    setCollapsed(view(editor), [a], true);
    expect(hiddenTexts(editor)).toEqual(['uno en A', 'nada en B', 'nada en D']);
    // Otra búsqueda que también la encuentra no la reabre.
    setFind(view(editor), 'uno en', {});
    expect(hiddenTexts(editor)).toEqual(['uno en A', 'nada en B', 'nada en D']);
    closeFind(view(editor), { select: false });
    expect(hiddenTexts(editor)).toEqual(['uno en A', 'nada en B', 'uno en C', 'nada en D']);
    // Abrir con el triángulo algo que la búsqueda no abrió tampoco se vuelve a cerrar.
    setFind(view(editor), 'uno', {});
    setCollapsed(view(editor), [b], false);
    closeFind(view(editor), { select: false });
    expect(hiddenTexts(editor)).toEqual(['uno en A', 'uno en C', 'nada en D']);
  });

  it('ir a una coincidencia (Enter) muestra la sección aunque la persona la haya cerrado durante la búsqueda', () => {
    const { editor } = page(PAGE());
    const [a, b, c, d] = heads(editor);
    setCollapsed(view(editor), [a, b, c, d], true);
    setFind(view(editor), 'uno', {});
    setCollapsed(view(editor), [c], true);
    expect(hiddenTexts(editor)).toContain('uno en C');
    stepFind(view(editor), 1);
    expect(getFindState(view(editor).state).current).toBe(1);
    expect(hiddenTexts(editor)).not.toContain('uno en C');
    closeFind(view(editor), { select: false });
    expect(hiddenTexts(editor)).toContain('uno en C');
  });

  it('una sección con la selección adentro no se cierra sola (se escribe ahí mientras se busca)', () => {
    const { editor } = page(PAGE());
    setCollapsed(view(editor), heads(editor), true);
    setFind(view(editor), 'uno', {});
    editor.setTextCursorPosition(editor.document[1].id, 'end');
    setFind(view(editor), 'nada', {});
    expect(hiddenTexts(editor)).toEqual(['uno en C']);
    closeFind(view(editor), { select: false });
    // La de A, donde está el cursor, sigue abierta; las demás vuelven a cerrarse.
    expect(hiddenTexts(editor)).toEqual(['nada en B', 'uno en C', 'nada en D']);
  });

  it('buscar no escribe nada: ni el contenido ni lo colapsado para todos, ni lo guarda en el dispositivo', async () => {
    const { editor, doc, saves } = page(PAGE(), { shared: true });
    await tick();
    const [a, b, c, d] = heads(editor);
    setCollapsed(view(editor), [a, b], true);
    // C se colapsa para todos (Shift+clic).
    expect(toggleShared(view(editor), c)).toBe(true);
    await tick();
    expect([...doc.getMap(SHARED_COLLAPSE_MAP).keys()]).toEqual([c]);
    setCollapsed(view(editor), [d], true);
    const baseline = new Set(collapseState(view(editor).state)!.records.keys());
    const before = Y.encodeStateAsUpdate(doc);
    const updates = countUpdates(doc);
    saves.length = 0;

    setFind(view(editor), 'uno', {});
    expect(hiddenTexts(editor)).toEqual(['nada en B', 'nada en D']);
    // Lo de C se ve para vos (un registro tuyo que lo abre), y el mapa de todos sigue igual.
    expect([...doc.getMap(SHARED_COLLAPSE_MAP).keys()]).toEqual([c]);
    stepFind(view(editor), 1);
    setFind(view(editor), 'nada', {});
    closeFind(view(editor), { select: false });
    await tick();

    expect(updates.count()).toBe(0);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    expect([...doc.getMap(SHARED_COLLAPSE_MAP).keys()]).toEqual([c]);
    // Al terminar: todo como antes (lo de C colapsado para todos, sin un registro tuyo que lo abra).
    expect(hiddenTexts(editor)).toEqual(['uno en A', 'nada en B', 'uno en C', 'nada en D']);
    expect(new Set(collapseState(view(editor).state)!.records.keys())).toEqual(baseline);
    // Nada de lo abierto por la búsqueda llegó al dispositivo: cada guardado es lo de antes (A, B y D tuyos).
    expect(saves.length).toBeGreaterThan(0);
    for (const saved of saves) expect([...saved.keys()].sort()).toEqual([a, b, d].sort());
  });

  it('sin secciones colapsadas, buscar no hace nada de esto', () => {
    const { editor, saves } = page(PAGE());
    saves.length = 0;
    setFind(view(editor), 'uno', {});
    closeFind(view(editor), { select: false });
    expect(saves).toEqual([]);
    expect(collapseState(view(editor).state)!.records.size).toBe(0);
  });
});
