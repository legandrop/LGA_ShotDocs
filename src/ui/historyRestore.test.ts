// @vitest-environment jsdom
import type { PartialBlock } from '@blocknote/core';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { PageHistory, rowHasTrace, STABLE_GAPS_MARKER, yShape, type HistoryRow } from '../sync/history';
import { STABLE_GAPS_MARKER as GUARD_MARKER } from './unknownContent';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { connect, mountEditor, pmFromY, undoManager, unmountAll, view, yText } from './collabHarness';
import { schema as mainSchema } from './fixtures/editorSchemaMain';
import { restoreInEditor, versionNode } from './historyRestore';

// Restaurar una versión del historial con el editor real (P.18, Docs/Doc_Historial.md, sección 6): una edición nueva
// por el editor, que conserva los ids de los bloques y lo que no cambió, se deshace en un paso, la versión publicada
// abre lo restaurado, y una versión que el editor no puede armar entera no se restaura.

afterEach(unmountAll);

/** Graba cada update del documento como una fila del servidor (en orden), con su autor y una hora. */
function recorder(doc: Y.Doc, who = 'a') {
  const rows: HistoryRow[] = [];
  let clock = Date.parse('2026-10-01T10:00:00Z');
  const push = (data: Uint8Array, by = who) => {
    clock += 60 * 60_000; // cada fila, su propia sesión
    rows.push({ id: rows.length + 1, seq: rows.length + 1, createdBy: by, createdAt: new Date(clock).toISOString(), data });
  };
  if (doc.store.clients.size > 0) push(Y.encodeStateAsUpdate(doc));
  doc.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') push(u);
  });
  return { rows, push, history: () => new PageHistory(rows) };
}

/** Los ids de los bloques del documento de Yjs. */
const ids = (d: Y.Doc) => yShape(d).ids;
const blockItem = (d: Y.Doc, id: string) => {
  const group = d.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
  return (group.toArray() as Y.XmlElement[]).find((bc) => bc.getAttribute('id') === id) ?? null;
};
const settle = () => new Promise((r) => setTimeout(r, 0));

const photo = (name: string) => ({ type: 'photo', props: { url: `sdmedia://${name}`, name: `${name}.jpg`, w: 0.3 } });

describe('restaurar por el editor', () => {
  it('deja el documento como la versión, conserva los ids y lo que no cambió, se deshace en un paso y la versión publicada lo abre', async () => {
    const doc = new Y.Doc();
    const ed = mountEditor(doc, 'A');
    const rec = recorder(doc);
    ed.replaceBlocks(ed.document, [
      { type: 'heading', content: 'Escena 64' },
      { type: 'paragraph', content: 'Ramón suelta los cubiertos.' },
      { type: 'paragraph', content: 'Plano general de la mesa.' },
      { type: 'bulletListItem', content: 'Clean plate' },
      { type: 'paragraph', content: [{ type: 'text', text: 'Fotos ', styles: {} }, photo('uno'), photo('dos')] } as unknown as PartialBlock,
      { type: 'paragraph', content: 'Nota final que no cambia.' },
    ]);
    undoManager(ed).stopCapturing();
    await settle();
    const before = rec.history();
    const v = before.version(before.sessions.length - 1);
    const textV = yText(v);
    const idsV = ids(v);
    // Cambios después de la versión: escribir, borrar un bloque, cambiar un tipo, agregar.
    const blocks = ed.document;
    ed.updateBlock(blocks[1], { content: 'Ramón suelta los cubiertos y se levanta.' });
    ed.removeBlocks([blocks[2]]);
    ed.updateBlock(blocks[3], { type: 'paragraph' });
    ed.insertBlocks([{ type: 'paragraph', content: 'Agregado después.' }], blocks[5], 'after');
    undoManager(ed).stopCapturing();
    const textNow = yText(doc);
    const kept = blockItem(doc, String(idsV[5]));
    expect(kept).not.toBeNull();
    const afterChanges = Y.encodeStateVector(doc);
    const changes = Y.encodeStateAsUpdate(doc, Y.encodeStateVector(v));

    const outcome = restoreInEditor(view(ed), v);
    expect(outcome.ok).toBe(true);
    // La huella de la restauración (para *Restored from…*): la reconoce lo que sube después y no lo de antes.
    const trace = outcome.ok ? outcome.trace : undefined;
    expect(trace && trace.ins.length + trace.del.length).toBeGreaterThan(0);
    expect(rowHasTrace(Y.encodeStateAsUpdate(doc, afterChanges), trace!)).toBe(true);
    expect(rowHasTrace(changes, trace!)).toBe(false);
    expect(yText(doc)).toBe(textV);
    expect(ids(doc)).toEqual(idsV);
    expect(yShape(doc)).toEqual(yShape(v));
    // El bloque que no cambió sigue siendo el mismo elemento de Yjs (no se rehízo).
    expect(blockItem(doc, String(idsV[5]))).toBe(kept);
    // El editor muestra lo que dice el documento.
    expect(view(ed).state.doc.eq(pmFromY(ed, doc))).toBe(true);

    // Deshacer (el Undo del aviso), en un paso; rehacer la vuelve a dejar.
    expect(outcome.ok && outcome.undo()).toBe(true);
    expect(yText(doc)).toBe(textNow);
    undoManager(ed).redo();
    expect(yText(doc)).toBe(textV);
    // Con Ctrl/⌘+Z, lo mismo.
    undoManager(ed).undo();
    expect(yText(doc)).toBe(textNow);
    undoManager(ed).redo();

  });

  it('la versión publicada de la app (su esquema) abre lo restaurado igual, sin borrar nada', async () => {
    // Sin fotos en línea: el esquema publicado copiado en fixtures/ es anterior a ellas (las protege la versión mínima).
    const doc = new Y.Doc();
    const ed = mountEditor(doc, 'A');
    const rec = recorder(doc);
    ed.replaceBlocks(ed.document, [
      { type: 'heading', content: 'Escena' },
      { type: 'paragraph', content: 'Uno.' },
      { type: 'bulletListItem', content: 'Dos.' },
    ]);
    undoManager(ed).stopCapturing();
    const h = rec.history();
    const v = h.version(h.sessions.length - 1);
    ed.updateBlock(ed.document[1], { type: 'heading', content: 'Uno cambiado.' });
    ed.removeBlocks([ed.document[2]]);
    undoManager(ed).stopCapturing();
    expect(restoreInEditor(view(ed), v).ok).toBe(true);
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    const old = mountEditor(copy, 'old', mainSchema);
    await settle();
    expect(yText(copy)).toBe(yText(v));
    expect(yShape(copy)).toEqual(yShape(v));
    expect(view(old).state.doc.eq(pmFromY(old, copy))).toBe(true);
  });

  it('el Undo del aviso no deshace otra cosa: después de escribir, no hace nada', async () => {
    const doc = new Y.Doc();
    const ed = mountEditor(doc, 'A');
    const rec = recorder(doc);
    ed.replaceBlocks(ed.document, [{ type: 'paragraph', content: 'Uno.' }]);
    undoManager(ed).stopCapturing();
    const v = rec.history().version(rec.history().sessions.length - 1);
    ed.updateBlock(ed.document[0], { content: 'Uno. Dos.' });
    undoManager(ed).stopCapturing();
    const outcome = restoreInEditor(view(ed), v);
    expect(outcome.ok).toBe(true);
    ed.insertBlocks([{ type: 'paragraph', content: 'Después.' }], ed.document[0], 'after');
    undoManager(ed).stopCapturing();
    const now = yText(doc);
    expect(outcome.ok && outcome.undo()).toBe(false);
    expect(yText(doc)).toBe(now);
  });

  it('una versión con un bloque que el editor no puede armar no se restaura (y la página no cambia)', () => {
    // Una versión rota: un bloque de imagen con texto adentro (el esquema no lo acepta; y-prosemirror lo tiraría).
    const broken = new Y.Doc();
    const fragment = broken.getXmlFragment(CONTENT_FRAGMENT);
    const group = new Y.XmlElement('blockGroup');
    fragment.insert(0, [group]);
    const ok = new Y.XmlElement('blockContainer');
    ok.setAttribute('id', 'ok');
    const p = new Y.XmlElement('paragraph');
    const t = new Y.XmlText();
    t.insert(0, 'Bien');
    p.insert(0, [t]);
    ok.insert(0, [p]);
    const bad = new Y.XmlElement('blockContainer');
    bad.setAttribute('id', 'bad');
    const img = new Y.XmlElement('image');
    const inside = new Y.XmlText();
    inside.insert(0, 'texto donde no va');
    img.insert(0, [inside]);
    bad.insert(0, [img]);
    group.insert(0, [ok, bad]);

    const doc = new Y.Doc();
    const ed = mountEditor(doc, 'A');
    ed.replaceBlocks(ed.document, [{ type: 'paragraph', content: 'Lo de hoy.' }]);
    const now = yText(doc);
    expect(versionNode(broken, view(ed).state.schema).complete).toBe(false);
    const outcome = restoreInEditor(view(ed), broken);
    expect(outcome).toEqual({ ok: false, reason: 'shape' });
    expect(yText(doc)).toBe(now);
    // La versión (en memoria) tampoco se tocó: la ida y vuelta se hace sobre una copia.
    expect(ids(broken)).toEqual(['ok', 'bad']);
  });

  it('la marca de los huecos estables es la misma que conoce la guarda del editor', () => {
    expect(STABLE_GAPS_MARKER).toBe(GUARD_MARKER);
  });

  it('en un editor de solo lectura no restaura', () => {
    const doc = new Y.Doc();
    const ed = mountEditor(doc, 'A');
    ed.replaceBlocks(ed.document, [{ type: 'paragraph', content: 'Hoy.' }]);
    const v = new Y.Doc();
    Y.applyUpdate(v, Y.encodeStateAsUpdate(doc));
    ed.isEditable = false;
    expect(restoreInEditor(view(ed), v)).toEqual({ ok: false, reason: 'notEditable' });
  });
});

describe('con otro editando a la vez', () => {
  it('lo que el otro escribe en un bloque que la versión conserva queda; en uno que la versión quita, sale (Doc_Historial.md, 5.4)', async () => {
    const da = new Y.Doc();
    const db = new Y.Doc();
    const link = connect(da, db, 'async');
    const a = mountEditor(da, 'A');
    const rec = recorder(da);
    a.replaceBlocks(a.document, [
      { type: 'paragraph', content: 'Uno.' },
      { type: 'paragraph', content: 'Dos.' },
    ]);
    undoManager(a).stopCapturing();
    link.flush();
    const b = mountEditor(db, 'B');
    await settle();
    const h = rec.history();
    const v = h.version(h.sessions.length - 1);
    a.insertBlocks([{ type: 'paragraph', content: 'Agregado.' }], a.document[1], 'after');
    a.updateBlock(a.document[1], { content: 'Dos cambiado.' });
    link.flush();
    await settle();
    // Sin verse: B escribe en "Uno." (la versión lo conserva) y en "Agregado." (la versión no lo tiene).
    link.offline();
    b.updateBlock(b.document[0], { content: 'Uno. Escrito por B.' });
    b.updateBlock(b.document[2], { content: 'Agregado. También B.' });
    const outcome = restoreInEditor(view(a), v);
    expect(outcome.ok).toBe(true);
    link.online();
    link.flush();
    await settle();
    expect(yText(da)).toBe(yText(db));
    expect(yText(da)).toContain('Escrito por B');
    expect(yText(da)).not.toContain('También B');
    expect(yText(da)).toContain('Dos.');
    expect(view(a).state.doc.eq(pmFromY(a, da))).toBe(true);
    expect(view(b).state.doc.eq(pmFromY(b, db))).toBe(true);
  });

  it('lo que el otro escribe en un bloque igual que queda entre dos cambios también queda (cada tramo, su transacción)', async () => {
    const da = new Y.Doc();
    const db = new Y.Doc();
    const link = connect(da, db, 'async');
    const a = mountEditor(da, 'A');
    const rec = recorder(da);
    a.replaceBlocks(a.document, [
      { type: 'paragraph', content: 'Uno.' },
      { type: 'paragraph', content: 'Dos.' },
      { type: 'paragraph', content: 'Tres.' },
    ]);
    undoManager(a).stopCapturing();
    link.flush();
    const b = mountEditor(db, 'B');
    await settle();
    const h = rec.history();
    const v = h.version(h.sessions.length - 1);
    a.updateBlock(a.document[0], { content: 'Uno cambiado.' });
    a.updateBlock(a.document[2], { type: 'heading', content: 'Tres cambiado.' });
    link.flush();
    await settle();
    link.offline();
    b.updateBlock(b.document[1], { content: 'Dos. Escrito por B.' });
    expect(restoreInEditor(view(a), v).ok).toBe(true);
    link.online();
    link.flush();
    await settle();
    expect(yText(da)).toBe(yText(db));
    expect(yText(da)).toBe('Uno. | Dos. Escrito por B. | Tres.');
  });
});
