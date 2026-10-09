// @vitest-environment jsdom
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { AssistantEditor } from '../assistant/assistantUi';
import { applySuggestion, takeSnapshot } from '../assistant/apply';
import { parseAnswer } from '../assistant/markup';
import { applyChanges, locate } from '../dictation/applyPlan';
import { validateAnswer } from '../dictation/answer';
import { buildPageMap } from '../dictation/pageMap';
import { answer, WORDS } from '../dictation/fixtures/report';
import { mediaIdOf } from '../media/queue';
import { mediaIdsInDoc } from '../media/usage';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { caretAt, connect, editors, mountEditor, posOf, sameDocs, showsDoc, tick, unmountAll, view, yText, type Editor } from './collabHarness';
import { installBlockReorder, type BlockReorderStats } from './blockReorder';
import { schema } from './editorSchema';

// E20, C5/C7: no alcanza con converger si converge un texto mezclado o si una respuesta pendiente cae
// en el vecino. Los bloques iguales permiten detectar el último caso aunque la guarda de texto no lo note.
const devices: Device[] = [];
afterEach(() => {
  unmountAll();
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
});

const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];
const page = (equal = false): PartialBlock[] => words.map((word, i) => ({ id: `b${i}`, type: 'paragraph', content: equal ? 'same text' : word })) as never;
const move = (e: Editor, id: string, direction: 'up' | 'down') => {
  caretAt(e, id, 'start');
  if (direction === 'up') (e as unknown as { moveBlocksUp(): void }).moveBlocksUp();
  else (e as unknown as { moveBlocksDown(): void }).moveBlocksDown();
};
const drag = (e: Editor, id: string, before: string) => {
  const v = view(e);
  const from = posOf(e, id);
  const node = v.state.doc.nodeAt(from)!;
  const to = posOf(e, before);
  const tr = v.state.tr.delete(from, from + node.nodeSize);
  v.dispatch(tr.insert(tr.mapping.map(to), node));
};
const ids = (doc: Y.Doc) => {
  const group = doc.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
  return group.toArray().map((node) => String((node as Y.XmlElement).getAttribute('id')));
};
const unique = (doc: Y.Doc) => expect(new Set(ids(doc)).size).toBe(ids(doc).length);
const labels = (doc: Y.Doc) => yText(doc).split(' | ');

describe('E20 C5: movimientos concurrentes', () => {
  it('un id repetido fuera del tramo movido deja el grupo ambiguo sin primera pasada', () => {
    const doc = new Y.Doc();
    // Aísla el intervalo previo a la próxima reparación de BlockNote: el caso anterior comprueba
    // esa reparación real. Acá se retiene el id repetido para comprobar el contrato de la guarda.
    const E = BlockNoteEditor.create(withCollaboration({ schema,
      collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } },
    })) as unknown as Editor;
    const host = document.createElement('div');
    document.body.appendChild(host);
    E.mount(host);
    editors.push(E);
    E.replaceBlocks(E.document, page());
    const v = view(E);
    // Conserva el esquema de BlockNote (incluido el atributo id); aparta solo la reparación para esta sonda.
    const plugins = v.state.plugins.filter((plugin) => !(plugin as unknown as { key: string }).key.startsWith('uniqueID$'));
    expect(plugins.length).toBe(v.state.plugins.length - 1);
    v.updateState(v.state.reconfigure({ plugins }));
    v.dispatch(v.state.tr.setNodeMarkup(posOf(E, 'b4'), undefined, { ...v.state.doc.nodeAt(posOf(E, 'b4'))!.attrs, id: 'b0' }));
    expect(ids(doc).filter((id) => id === 'b0')).toHaveLength(2);
    const stats: BlockReorderStats = { calls: 0, triggered: 0, ms: 0, yVisits: 0, pmVisits: 0 };
    const release = installBlockReorder(v, stats);
    drag(E, 'b2', 'b1');
    expect(stats.calls).toBe(1);
    expect(stats.triggered).toBe(0);
    expect(labels(doc)).toEqual(['alpha', 'charlie', 'bravo', 'delta', 'echo']);
    expect(showsDoc(E, doc)).toBe(true);
    release();
  });

  for (const scene of ['mismo', 'cruzados', 'arrastres opuestos'] as const) {
    it(`${scene}: contenido intacto, convergencia, ids únicos y otro mover protegido tras editar`, async () => {
      const docA = new Y.Doc();
      const docB = new Y.Doc();
      const net = connect(docA, docB);
      const A = mountEditor(docA);
      const B = mountEditor(docB);
      A.replaceBlocks(A.document, page());
      net.flush();
      await tick();
      net.offline();
      if (scene === 'arrastres opuestos') {
        drag(A, 'b4', 'b0');
        drag(B, 'b0', 'b4');
      } else {
        move(A, scene === 'mismo' ? 'b2' : 'b3', 'up');
        move(B, 'b2', scene === 'mismo' ? 'up' : 'down');
      }
      net.online();
      net.flush();
      await tick();
      // Solo una nueva edición en A: BlockNote publica la reparación de identidades; B la recibe.
      view(A).dispatch(view(A).state.tr.setSelection(TextSelection.atStart(view(A).state.doc)));
      net.flush();
      await tick();
      unique(docA);
      unique(docB);
      expect(sameDocs(docA, docB)).toBe(true);
      for (const word of words) expect(labels(docA)).toContain(word);
      expect(labels(docA).every((word) => words.includes(word))).toBe(true);
      expect(showsDoc(A, docA) && showsDoc(B, docB)).toBe(true);
      // La guarda debe volver a actuar en el mismo grupo reparado: mover b2 y borrar b2 a la vez
      // no puede borrar el bloque que b2 salta. Se borra en Yjs por identidad, como la app.
      const before = labels(docA);
      net.offline();
      move(B, 'b2', 'up');
      const group = docA.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement;
      group.delete(ids(docA).indexOf('b2'), 1);
      net.online();
      net.flush();
      await tick();
      for (const word of before.filter((word) => word !== 'charlie')) expect(labels(docA)).toContain(word);
      expect(sameDocs(docA, docB)).toBe(true);
      expect(showsDoc(A, docA) && showsDoc(B, docB)).toBe(true);
    });
  }

  it('dos mueven la foto: borrar una copia con el editor no desvincula la que sigue en la página', async () => {
    const server = new FakeServer();
    server.enableTrash();
    const a = await makeDevice(server);
    const b = await makeDevice(server);
    devices.push(a, b);
    const pageId = await a.tree.create(null, 'Move photos');
    await a.engine.syncNow();
    await b.engine.syncNow();
    const file = mediaIdOf(await a.media.add(pageId, new File([new Uint8Array(1024)], 'frame.jpg', { type: 'image/jpeg' })))!;
    const docA = await a.docs.open(pageId);
    const A = mountEditor(docA);
    A.replaceBlocks(A.document, [page()[0], page()[2], { id: 'foto', type: 'image', props: { url: `sdmedia://${file}`, name: 'frame.jpg' } }] as never);
    await a.docs.flush();
    await a.engine.syncNow();
    await a.engine.syncMedia();
    await b.engine.syncNow();
    const docB = await b.docs.open(pageId);
    const B = mountEditor(docB);
    // Los dos trabajan sin entregar cambios, y después se reúnen por PageDocs/servidor real de prueba.
    drag(A, 'foto', 'b0');
    drag(B, 'foto', 'b0');
    for (let round = 0; round < 3; round++) for (const d of [a, b]) {
      await d.docs.flush();
      await d.engine.syncNow();
      await d.engine.syncMedia();
    }
    view(A).dispatch(view(A).state.tr.setSelection(TextSelection.atStart(view(A).state.doc)));
    for (let round = 0; round < 2; round++) for (const d of [a, b]) {
      await d.docs.flush();
      await d.engine.syncNow();
    }
    unique(docA);
    unique(docB);
    const photos = A.document.filter((block) => block.type === 'image');
    expect(photos).toHaveLength(2);
    expect(sameDocs(docA, docB)).toBe(true);
    const callStart = server.mediaCalls.length;
    A.removeBlocks([photos[0].id]);
    expect(A.document.filter((block) => block.type === 'image')).toHaveLength(1);
    expect(mediaIdsInDoc(docA)).toContain(file);
    for (let round = 0; round < 3; round++) for (const d of [a, b]) {
      await d.docs.flush();
      await d.engine.syncNow();
      await d.engine.syncMedia();
    }
    expect(server.mediaCalls.slice(callStart).filter((call) => call.startsWith('unlink_page_file'))).toEqual([]);
    expect(server.pageFiles.has(`${pageId}:${file}`)).toBe(true);
    expect(server.mediaFiles.get(file)?.trashed_at ?? null).toBeNull();
    expect(sameDocs(docA, docB)).toBe(true);
    expect(showsDoc(A, docA) && showsDoc(B, docB)).toBe(true);
  });
});

describe('E20 C7: anclas mientras llega una respuesta', () => {
  for (const gesture of ['teclado', 'arrastre'] as const) for (const targetId of ['b1', 'b2', 'b3']) {
    it(`asistente ${gesture}, ${targetId}: aplica en su bloque o rechaza, nunca en un vecino idéntico`, async () => {
      const docA = new Y.Doc();
      const docB = new Y.Doc();
      const net = connect(docA, docB);
      const A = mountEditor(docA);
      const B = mountEditor(docB);
      A.replaceBlocks(A.document, page(true));
      net.flush();
      await tick();
      const v = view(A);
      const from = posOf(A, targetId) + 2;
      v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, from, from + 9)));
      const snapshot = takeSnapshot(v.state);
      if (typeof snapshot === 'string') throw new Error(snapshot);
      expect(snapshot.anchors).not.toBeNull();
      const parsed = parseAnswer('changed text', snapshot.selected);
      if (typeof parsed === 'string') throw new Error(parsed);
      net.offline();
      if (gesture === 'teclado') move(B, 'b2', 'up');
      else drag(B, 'b3', 'b0');
      net.online();
      net.flush();
      await tick();
      const before = v.state.doc.toJSON();
      const result = applySuggestion(v, snapshot, parsed, true);
      if (!result.ok) expect(v.state.doc.toJSON()).toEqual(before);
      else {
        const changed = A.document.filter((block) => JSON.stringify(block.content).includes('changed text'));
        expect(changed.map((block) => block.id)).toEqual([targetId]);
      }
      expect(result.ok).toBe(gesture === 'teclado' ? targetId !== 'b1' : targetId !== 'b3');
      net.flush();
      await tick();
      expect(sameDocs(docA, docB)).toBe(true);
      expect(showsDoc(A, docA) && showsDoc(B, docB)).toBe(true);
    });

    it(`dictado ${gesture}, ${targetId}: su ancla solo escribe en el bloque correcto`, async () => {
      const docA = new Y.Doc();
      const docB = new Y.Doc();
      const net = connect(docA, docB);
      const A = mountEditor(docA);
      const B = mountEditor(docB);
      A.replaceBlocks(A.document, page(true));
      net.flush();
      await tick();
      const map = buildPageMap(view(A).state, 'On-set');
      if (typeof map === 'string') throw new Error(map);
      const target = [...map.targets.values()].find((t) => t.blockId === targetId)!;
      expect(target.anchor).not.toBeNull();
      const plan = validateAnswer(answer([{ op: 'setText', at: target.addr, label: '', old: target.text, new: 'changed text' }]), map, { note: 'nota', words: WORDS }, { word: 'Shot', checks: ['Clean plate', 'HDRI'] });
      if (typeof plan === 'string') throw new Error(plan);
      expect(plan.changes).toHaveLength(1);
      net.offline();
      if (gesture === 'teclado') move(B, 'b2', 'up');
      else drag(B, 'b3', 'b0');
      net.online();
      net.flush();
      await tick();
      const resolved = locate(view(A).state, target);
      const before = view(A).state.doc.toJSON();
      const result = applyChanges(view(A), A as unknown as AssistantEditor, map, plan.changes, true, { word: 'Shot', checks: ['Clean plate', 'HDRI'] });
      if (!result.ok) expect(view(A).state.doc.toJSON()).toEqual(before);
      else expect(A.document.filter((block) => JSON.stringify(block.content).includes('changed text')).map((block) => block.id)).toEqual([targetId]);
      expect(result.ok).toBe(gesture === 'teclado' ? targetId !== 'b1' : targetId !== 'b3');
      if (result.ok) expect(resolved).not.toBeNull();
      else expect(resolved).toBeNull();
      net.flush();
      await tick();
      expect(sameDocs(docA, docB)).toBe(true);
      expect(showsDoc(A, docA) && showsDoc(B, docB)).toBe(true);
    });
  }
});
