// @vitest-environment jsdom
// Deshacer en el orden en que editaste, entrega 3 (P.26; Docs/Doc_Deshacer.md, sección 19): lo de una vez en el
// anotador de fotos es UN paso de la línea de tiempo de la página. Con el editor real, `PageDocs` de verdad y el que
// corre ⌘Z (`createUndoRunner`): ⌘Z después de anotar deshace todo lo de esa vez, en orden con lo demás, también si la
// foto está en otra página (te lleva); ⌘⇧Z lo rehace; lo de otra persona en la misma foto queda.
import { ySyncPluginKey } from 'y-prosemirror';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addShape, deleteShape, markupOrigin, PHOTO_MARKUP_MAP, readAllMarkup, updateShape } from '../media/markup';
import { MARKUP_PASTE_ORIGIN } from '../media/markupClipboard';
import { mediaIdOf } from '../media/queue';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { connect, mountEditor, undoManager, view, yText, type Editor } from './collabHarness';
import { trackMarkupInUndo } from './markupClipboardEditor';
import { para, previousSchema } from './photoHarness';
import { revealChange, revealPhoto } from './undoReveal';
import { popMarkupStep, protectMarkupOthers, UndoTimeline, type TimelineDocs } from './undoTimeline';
import { createUndoRunner } from './undoTimelineUi';

const devices: Device[] = [];
const mounted: Editor[] = [];

afterEach(async () => {
  for (const e of mounted.splice(0)) {
    try {
      e.unmount();
    } catch {
      // Ya desmontado.
    }
  }
  document.body.replaceChildren();
  await new Promise((r) => setTimeout(r, 30));
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
  }
});

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const PHOTO_ID = '0f8fad5b-d9cb-469f-a165-708677289501';
const FRAME = { w: 4000, h: 3000 };
/** Una forma que se dibuja (una línea, con los campos del formato). */
const rect = (posX: number) => ({ type: 'line', zValue: 1, posX, posY: 10, startX: 0, startY: 0, endX: 50, endY: 50, strokeColor: '#FF0000' });
const markupOf = (doc: Y.Doc) => doc.getMap<unknown>(PHOTO_MARKUP_MAP).toJSON() as Record<string, Record<string, unknown>>;
/**
 * Lo que se dibuja: las formas (deshacer nunca borra el marco de la foto, auditoría B1; un marco solo no se dibuja).
 */
const drawn = (doc: Y.Doc) => {
  expect(readAllMarkup(doc.getMap<unknown>(PHOTO_MARKUP_MAP)).size === 0).toBe(Object.keys(markupOf(doc)).every((k) => !k.includes('/')));
  return Object.keys(markupOf(doc)).filter((k) => k.includes('/')).sort();
};

/** Escribe al final del primer renglón con texto como un paso propio de la pila. */
function type(E: Editor, text: string): void {
  const v = view(E);
  let end = -1;
  v.state.doc.descendants((n, p) => {
    if (end >= 0) return false;
    if (n.isTextblock) {
      end = p + 1 + n.content.size;
      return false;
    }
    return true;
  });
  v.dispatch(v.state.tr.insertText(text, end));
  undoManager(E).stopCapturing();
}

/**
 * Una vez en el anotador, como Annotator.tsx: su `UndoManager` (el origen de la foto, sin juntar pasos, lo ajeno
 * protegido); `work` escribe; al cerrar, lo que quedó en la pila va a la línea de tiempo.
 */
function annotate(timeline: UndoTimeline, pageId: string, doc: Y.Doc, work: (um: Y.UndoManager) => void, fileId = PHOTO_ID): string | null {
  const map = doc.getMap<unknown>(PHOTO_MARKUP_MAP);
  const um = new Y.UndoManager(map, { trackedOrigins: new Set([markupOrigin(fileId)]), captureTimeout: 0 });
  protectMarkupOthers(um, map);
  let wrote = false;
  um.on('stack-item-added', () => void (wrote = true));
  work(um);
  um.clear(false, true);
  const steps = um.undoStack;
  um.undoStack = [];
  um.destroy();
  return wrote ? timeline.pushMarkup(pageId, map, fileId, steps) : null;
}

class App {
  current: string | null = null;
  editor: Editor | null = null;
  doc: Y.Doc | null = null;
  shown: string[] = [];
  /** Como PageEditor.tsx: el deshacer de cada editor sigue también lo pegado en el mapa de anotaciones (F1). */
  trackMarkup = true;
  private detach: (() => void) | null = null;
  constructor(
    readonly d: Device,
    readonly timeline: UndoTimeline,
  ) {}

  async go(pageId: string): Promise<void> {
    this.leave();
    const doc = await this.d.docs.open(pageId, { seed: true });
    const E = mountEditor(doc, 'a');
    mounted.push(E);
    const v = view(E);
    const binding = (ySyncPluginKey.getState(v.state as never) as { binding: object }).binding;
    if (this.trackMarkup) trackMarkupInUndo(v.state, doc);
    this.detach = this.timeline.attach(pageId, doc, undoManager(E), {
      binding,
      editable: () => true,
      dom: v.dom,
      snapshot: () => v.state.doc,
      reveal: (before, opts) => revealChange(v, before as never, opts),
      showPhoto: (fileId) => {
        this.shown.push(fileId);
        return revealPhoto(v, fileId, mediaIdOf);
      },
    });
    this.current = pageId;
    this.editor = E;
    this.doc = doc;
  }

  leave(): void {
    if (!this.current) return;
    this.detach?.();
    this.editor!.unmount();
    mounted.splice(mounted.indexOf(this.editor!), 1);
    this.d.docs.close(this.current);
    this.current = null;
    this.editor = null;
    this.doc = null;
  }
}

/** Dos páginas: A con un renglón y la foto (una foto-bloque del Drive), B con un renglón. */
async function setup(opts: { maxPages?: number; maxSteps?: number; photoInA?: boolean } = {}) {
  const d = await makeDevice(new FakeServer(), undefined, '0.999');
  devices.push(d);
  const ids = { A: await d.tree.create(null, 'A'), B: await d.tree.create(null, 'B') };
  for (const [name, id] of Object.entries(ids)) {
    const doc = await d.docs.open(id, { seed: true });
    const E = mountEditor(doc, 'antes');
    const blocks = [para(`${name}-0`, [`Toma ${name}: `])];
    if (name === 'A' && opts.photoInA !== false) blocks.push({ id: 'A-foto', type: 'image', props: { url: `sdmedia://${PHOTO_ID}`, name: 'IMG_0423.jpg' } } as never);
    E.replaceBlocks(E.document, blocks as never);
    E.unmount();
    d.docs.close(id);
  }
  await d.docs.flush();
  const project = d.tree.get(ids.A)!.workspace_id;
  let unsupported: ((id: string) => void)[] = [];
  const docs: TimelineDocs = {
    open: (id) => d.docs.open(id),
    close: (id) => d.docs.close(id),
    subscribeUnsupported: (fn) => {
      unsupported.push(fn);
      const off = d.docs.subscribeUnsupported(fn);
      return () => {
        unsupported = unsupported.filter((f) => f !== fn);
        off();
      };
    },
  };
  const timeline = new UndoTimeline({ docs, projectOf: (id) => d.tree.get(id)?.workspace_id ?? null, maxPages: opts.maxPages, maxSteps: opts.maxSteps });
  const app = new App(d, timeline);
  const notes: string[] = [];
  const runner = createUndoRunner({
    timeline,
    currentPage: () => app.current,
    currentProject: () => project,
    title: (id) => d.tree.get(id)?.title ?? '',
    blocked: (id) => (d.tree.isTrashed(id) ? 'trash' : null),
    go: (id) => void app.go(id),
    notify: (m) => void notes.push(m),
    waitMs: 2000,
  });
  const where = () => Object.entries(ids).find(([, id]) => id === app.current)?.[0] ?? null;
  const fire = (id: string) => unsupported.forEach((fn) => fn(id));
  return { d, ids, project, timeline, app, runner, notes, where, fire };
}

describe('anotar como un paso de la línea de tiempo (entrega 3)', () => {
  it('aceptación: anotar en A, escribir en B; ⌘Z, ⌘Z vuelve a A y saca la anotación entera; ⌘⇧Z, ⌘⇧Z lo vuelve todo', async () => {
    const { ids, app, runner, notes, where } = await setup();
    await app.go(ids.A);
    const docA = app.doc!;
    annotate(app.timeline, ids.A, docA, () => {
      addShape(docA, PHOTO_ID, 's1', rect(10), FRAME);
      addShape(docA, PHOTO_ID, 's2', rect(20), FRAME);
      updateShape(docA, PHOTO_ID, 's1', { posX: 999 });
    });
    const annotated = markupOf(docA);
    expect(Object.keys(markupOf(docA))).toHaveLength(3);
    await app.go(ids.B);
    type(app.editor!, 'hola');
    expect(yText(app.doc!)).toContain('Toma B: hola');

    await runner.run('undo');
    expect(where()).toBe('B');
    expect(yText(app.doc!)).not.toContain('hola');
    await runner.run('undo');
    expect(where()).toBe('A');
    // Todo lo de esa vez: las dos formas, el cambio y el marco.
    expect(drawn(app.doc!)).toEqual([]);
    expect(app.shown).toEqual([PHOTO_ID]);
    expect(notes.at(-1)).toBe('Undone in “A”');

    await runner.run('redo');
    expect(where()).toBe('A');
    expect(markupOf(app.doc!)).toEqual(annotated);
    await runner.run('redo');
    expect(where()).toBe('B');
    expect(yText(app.doc!)).toContain('Toma B: hola');
    // Nada más para rehacer.
    expect(app.timeline.peek(app.d.tree.get(ids.A)!.workspace_id, 'redo')).toBeNull();
  });

  it('en el orden con lo escrito en la misma página: escribir, anotar, escribir; tres ⌘Z, uno por vez', async () => {
    const { ids, app, runner } = await setup();
    await app.go(ids.A);
    const doc = app.doc!;
    type(app.editor!, 'uno');
    annotate(app.timeline, ids.A, doc, () => addShape(doc, PHOTO_ID, 's1', rect(10), FRAME));
    type(app.editor!, ' dos');
    await runner.run('undo');
    expect(yText(doc)).toContain('Toma A: uno');
    expect(yText(doc)).not.toContain('dos');
    expect(Object.keys(markupOf(doc))).toHaveLength(2);
    await runner.run('undo');
    expect(drawn(doc)).toEqual([]);
    expect(yText(doc)).toContain('Toma A: uno');
    await runner.run('undo');
    expect(yText(doc)).not.toContain('uno');
  });

  it('dos veces en el anotador sobre la misma foto son dos pasos; lo deshecho adentro del anotador no vuelve', async () => {
    const { ids, app, runner } = await setup();
    await app.go(ids.A);
    const doc = app.doc!;
    annotate(app.timeline, ids.A, doc, () => addShape(doc, PHOTO_ID, 's1', rect(10), FRAME));
    annotate(app.timeline, ids.A, doc, (um) => {
      addShape(doc, PHOTO_ID, 's2', rect(20));
      addShape(doc, PHOTO_ID, 's3', rect(30));
      // ⌘Z en el anotador antes de cerrar: s3 ya no está y no entra en el paso.
      popMarkupStep(um, 'undo');
    });
    expect(Object.keys(markupOf(doc)).sort()).toEqual([PHOTO_ID, `${PHOTO_ID}/s1`, `${PHOTO_ID}/s2`]);
    await runner.run('undo');
    expect(Object.keys(markupOf(doc)).sort()).toEqual([PHOTO_ID, `${PHOTO_ID}/s1`]);
    await runner.run('undo');
    expect(drawn(doc)).toEqual([]);
    await runner.run('redo');
    await runner.run('redo');
    expect(Object.keys(markupOf(doc)).sort()).toEqual([PHOTO_ID, `${PHOTO_ID}/s1`, `${PHOTO_ID}/s2`]);
  });

  it('cerrar el anotador sin hacer nada no es un paso ni borra lo de rehacer', async () => {
    const { ids, app, runner, project } = await setup();
    await app.go(ids.A);
    type(app.editor!, 'uno');
    await runner.run('undo');
    expect(annotate(app.timeline, ids.A, app.doc!, () => undefined)).toBeNull();
    expect(app.timeline.peek(project, 'redo')).toEqual({ kind: 'page', pageId: ids.A });
  });

  it('anotar es algo nuevo: borra lo de rehacer (también en la misma página); escribir borra el rehacer de lo anotado', async () => {
    const { ids, app, runner, project } = await setup();
    await app.go(ids.B);
    type(app.editor!, 'b');
    await app.go(ids.A);
    type(app.editor!, 'a');
    await runner.run('undo');
    await runner.run('undo');
    await app.go(ids.A);
    expect(app.timeline.stepsOf(ids.A).redo).toBe(1);
    expect(app.timeline.stepsOf(ids.B).redo).toBe(1);
    const id = annotate(app.timeline, ids.A, app.doc!, () => addShape(app.doc!, PHOTO_ID, 's1', rect(10), FRAME))!;
    expect(app.timeline.stepsOf(ids.A).redo).toBe(0);
    expect(app.timeline.stepsOf(ids.B).redo).toBe(0);
    await runner.run('undo');
    expect(app.timeline.markupState(id)).toBe('redo');
    type(app.editor!, 'x');
    expect(app.timeline.markupState(id)).toBeNull();
    expect(app.timeline.peek(project, 'redo')).toBeNull();
  });

  it('dibujar y deshacer todo adentro del anotador también es algo nuevo: lo anotado antes ya no se rehace (como en cualquier editor)', async () => {
    const { ids, app, runner, project } = await setup();
    await app.go(ids.A);
    const doc = app.doc!;
    const first = annotate(app.timeline, ids.A, doc, () => addShape(doc, PHOTO_ID, 's1', rect(10), FRAME))!;
    await runner.run('undo');
    expect(drawn(doc)).toEqual([]);
    expect(app.timeline.markupState(first)).toBe('redo');
    // Otra vez en el anotador: dibuja y lo deshace adentro antes de cerrar.
    expect(annotate(app.timeline, ids.A, doc, (um) => {
      addShape(doc, PHOTO_ID, 's2', rect(20), FRAME);
      popMarkupStep(um, 'undo');
    })).toBeNull();
    expect(drawn(doc)).toEqual([]);
    expect(app.timeline.markupState(first)).toBeNull();
    expect(app.timeline.peek(project, 'redo')).toBeNull();
  });

  it('manteniendo apretado ⌘Z se frena antes de lo anotado (como un reemplazo)', async () => {
    const { ids, app, runner } = await setup();
    await app.go(ids.A);
    const doc = app.doc!;
    annotate(app.timeline, ids.A, doc, () => addShape(doc, PHOTO_ID, 's1', rect(10), FRAME));
    type(app.editor!, 'uno');
    await runner.run('undo', { repeat: true });
    expect(yText(doc)).not.toContain('uno');
    await runner.run('undo', { repeat: true });
    expect(Object.keys(markupOf(doc))).toHaveLength(2);
    await runner.run('undo');
    expect(drawn(doc)).toEqual([]);
  });

  it('con otra persona anotando la misma foto: su forma, su cambio a la mía y el marco quedan; lo demás mío se va', async () => {
    const { ids, app, runner } = await setup();
    await app.go(ids.A);
    const doc = app.doc!;
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    connect(doc, other, 'sync', { repair: false });
    annotate(app.timeline, ids.A, doc, () => {
      addShape(doc, PHOTO_ID, 'mia1', rect(10), FRAME);
      addShape(doc, PHOTO_ID, 'mia2', rect(20), FRAME);
    });
    // El otro dibuja la suya y mueve una mía.
    other.transact(() => {
      const m = other.getMap<unknown>(PHOTO_MARKUP_MAP);
      const s = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(rect(500))) s.set(k, v);
      m.set(`${PHOTO_ID}/suya`, s);
      (m.get(`${PHOTO_ID}/mia1`) as Y.Map<unknown>).set('posX', 777);
    }, 'otra');
    await runner.run('undo');
    const after = markupOf(doc);
    expect(Object.keys(after).sort()).toEqual([PHOTO_ID, `${PHOTO_ID}/mia1`, `${PHOTO_ID}/suya`]);
    expect(after[`${PHOTO_ID}/mia1`]).toEqual({ ...rect(10), posX: 777 });
    expect(after[`${PHOTO_ID}/suya`]).toEqual(rect(500));
    expect(markupOf(other)).toEqual(after);
    // ⌘⇧Z vuelve a poner lo que se deshizo (mia2).
    await runner.run('redo');
    expect(Object.keys(markupOf(doc)).sort()).toEqual([PHOTO_ID, `${PHOTO_ID}/mia1`, `${PHOTO_ID}/mia2`, `${PHOTO_ID}/suya`]);
  });

  it('auditoría B1 (R6/D2): el otro dibuja sin red con el marco que escribí yo, deshago mi anotación, vuelve la red: lo suyo se ve', async () => {
    const { ids, app, runner } = await setup();
    await app.go(ids.A);
    const doc = app.doc!;
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    const link = connect(doc, other, 'sync', { repair: false });
    annotate(app.timeline, ids.A, doc, () => addShape(doc, PHOTO_ID, 'mia', rect(10), FRAME));
    link.offline();
    // El otro ya tiene el marco: su forma no lo escribe.
    addShape(other, PHOTO_ID, 'suya', rect(500), FRAME);
    await runner.run('undo');
    expect(drawn(doc)).toEqual([]);
    link.online();
    const seen = readAllMarkup(doc.getMap<unknown>(PHOTO_MARKUP_MAP)).get(PHOTO_ID);
    expect(seen?.shapes.map((s) => s.id)).toEqual(['suya']);
    expect(readAllMarkup(other.getMap<unknown>(PHOTO_MARKUP_MAP)).get(PHOTO_ID)?.shapes.map((s) => s.id)).toEqual(['suya']);
  });

  it('auditoría O2 (D1): deshago, el otro anota esa foto y deshace lo suyo, rehago: lo mío se ve', async () => {
    const { ids, app, runner } = await setup();
    await app.go(ids.A);
    const doc = app.doc!;
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    connect(doc, other, 'sync', { repair: false });
    annotate(app.timeline, ids.A, doc, () => addShape(doc, PHOTO_ID, 'mia', rect(10), FRAME));
    await runner.run('undo');
    const otherMap = other.getMap<unknown>(PHOTO_MARKUP_MAP);
    const theirs = new Y.UndoManager(otherMap, { trackedOrigins: new Set([markupOrigin(PHOTO_ID)]), captureTimeout: 0 });
    protectMarkupOthers(theirs, otherMap);
    addShape(other, PHOTO_ID, 'suya', rect(500), FRAME);
    popMarkupStep(theirs, 'undo');
    await runner.run('redo');
    expect(readAllMarkup(doc.getMap<unknown>(PHOTO_MARKUP_MAP)).get(PHOTO_ID)?.shapes.map((s) => s.id)).toEqual(['mia']);
    expect(markupOf(other)).toEqual(markupOf(doc));
  });

  it('en el anotador: deshacer la forma que el otro movió no se la lleva (protectMarkupOthers)', async () => {
    const doc = new Y.Doc();
    const other = new Y.Doc();
    connect(doc, other, 'sync', { repair: false });
    const map = doc.getMap<unknown>(PHOTO_MARKUP_MAP);
    const um = new Y.UndoManager(map, { trackedOrigins: new Set([markupOrigin(PHOTO_ID)]), captureTimeout: 0 });
    protectMarkupOthers(um, map);
    addShape(doc, PHOTO_ID, 'mia', rect(10), FRAME);
    updateShape(doc, PHOTO_ID, 'mia', { color: '#00ff00' });
    other.transact(() => (other.getMap<unknown>(PHOTO_MARKUP_MAP).get(`${PHOTO_ID}/mia`) as Y.Map<unknown>).set('posX', 777), 'otra');
    // Mi cambio de color sí se deshace (la forma ya existía).
    popMarkupStep(um, 'undo');
    expect(markupOf(doc)[`${PHOTO_ID}/mia`]).toEqual({ ...rect(10), posX: 777 });
    // Crear la forma: queda entera, con lo del otro.
    expect(popMarkupStep(um, 'undo')).toBeNull();
    expect(markupOf(doc)[`${PHOTO_ID}/mia`]).toEqual({ ...rect(10), posX: 777 });
    expect(markupOf(doc)[PHOTO_ID]).toBeTruthy();
    // Sin el otro adentro, deshacer crear sí la borra (el marco queda: auditoría B1).
    const um2 = new Y.UndoManager(map, { trackedOrigins: new Set([markupOrigin(PHOTO_ID)]), captureTimeout: 0 });
    protectMarkupOthers(um2, map);
    deleteShape(doc, PHOTO_ID, 'mia');
    addShape(doc, PHOTO_ID, 'otra', rect(1));
    popMarkupStep(um2, 'undo');
    expect(markupOf(doc)[`${PHOTO_ID}/otra`]).toBeUndefined();
  });

  it('el marco de la foto queda si el otro dibujó con él, aunque lo hayas escrito vos', async () => {
    const doc = new Y.Doc();
    const other = new Y.Doc();
    connect(doc, other, 'sync', { repair: false });
    const map = doc.getMap<unknown>(PHOTO_MARKUP_MAP);
    const um = new Y.UndoManager(map, { trackedOrigins: new Set([markupOrigin(PHOTO_ID)]), captureTimeout: 0 });
    protectMarkupOthers(um, map);
    addShape(doc, PHOTO_ID, 'mia', rect(10), FRAME);
    addShape(other, PHOTO_ID, 'suya', rect(20), FRAME);
    popMarkupStep(um, 'undo');
    expect(Object.keys(markupOf(doc)).sort()).toEqual([PHOTO_ID, `${PHOTO_ID}/suya`]);
    expect(markupOf(other)).toEqual(markupOf(doc));
  });

  it('la foto en otra página te lleva ahí; si ya no está en la página, se deshace igual y se dice', async () => {
    const { ids, app, runner, notes, where } = await setup({ photoInA: false });
    await app.go(ids.A);
    const doc = app.doc!;
    annotate(app.timeline, ids.A, doc, () => addShape(doc, PHOTO_ID, 's1', rect(10), FRAME));
    await app.go(ids.B);
    await runner.run('undo');
    expect(where()).toBe('A');
    expect(drawn(app.doc!)).toEqual([]);
    expect(notes.at(-1)).toBe('Undid annotations on a photo that\'s no longer in “A”.');
    await runner.run('redo');
    expect(notes.at(-1)).toBe('Redid annotations on a photo that\'s no longer in “A”.');
    expect(Object.keys(markupOf(app.doc!))).toHaveLength(2);
  });

  it('la página en la papelera: lo anotado se olvida, se avisa y el próximo ⌘Z sigue con lo anterior', async () => {
    const { d, ids, app, runner, notes, where } = await setup();
    await app.go(ids.B);
    type(app.editor!, 'b');
    await app.go(ids.A);
    const doc = app.doc!;
    annotate(app.timeline, ids.A, doc, () => addShape(doc, PHOTO_ID, 's1', rect(10), FRAME));
    await app.go(ids.B);
    await d.tree.trash(ids.A);
    await runner.run('undo');
    expect(notes.at(-1)).toContain('Can’t undo in “A”'.replace('’', "'"));
    expect(Object.keys(markupOf(doc))).toHaveLength(2);
    await runner.run('undo');
    expect(where()).toBe('B');
    expect(yText(app.doc!)).not.toContain('Toma B: b');
  });

  it('el documento se rearmó: lo anotado sale y el próximo ⌘Z lo avisa; el tope lo olvida como a cualquier paso', async () => {
    const { ids, app, runner, notes, fire, project } = await setup();
    await app.go(ids.A);
    const doc = app.doc!;
    annotate(app.timeline, ids.A, doc, () => addShape(doc, PHOTO_ID, 's1', rect(10), FRAME));
    await app.go(ids.B);
    expect(app.timeline.retains(ids.A)).toBe(true);
    fire(ids.A);
    expect(app.timeline.retains(ids.A)).toBe(false);
    await runner.run('undo');
    expect(notes.at(-1)).toBe('Older changes in “A” can\'t be undone (the page was reloaded).');
    expect(app.timeline.peek(project, 'undo')).toBeNull();

    const s2 = await setup({ maxSteps: 2 });
    await s2.app.go(s2.ids.A);
    const docA = s2.app.doc!;
    annotate(s2.app.timeline, s2.ids.A, docA, () => addShape(docA, PHOTO_ID, 's1', rect(10), FRAME));
    type(s2.app.editor!, 'uno');
    type(s2.app.editor!, ' dos');
    await s2.runner.run('undo');
    await s2.runner.run('undo');
    await s2.runner.run('undo');
    expect(s2.notes.at(-1)).toContain('Older changes can\'t be undone');
    expect(Object.keys(markupOf(docA))).toHaveLength(2);
  });

  it('retiene el documento de la página mientras haya algo anotado para deshacer, y lo suelta al olvidarlo', async () => {
    const { d, ids, app } = await setup();
    await app.go(ids.A);
    const doc = app.doc!;
    annotate(app.timeline, ids.A, doc, () => addShape(doc, PHOTO_ID, 's1', rect(10), FRAME));
    await app.go(ids.B);
    await tick();
    expect(app.timeline.retains(ids.A)).toBe(true);
    expect(d.docs.peek(ids.A)).toBe(doc);
    app.timeline.forget(ids.A);
    expect(app.timeline.retains(ids.A)).toBe(false);
  });

  it('auditoría O1: la foto queda en el medio de la vista (no tapada por el aviso), también si la página termina de armarse después', async () => {
    const { ids, app } = await setup();
    await app.go(ids.A);
    const v = view(app.editor!);
    const calls: unknown[] = [];
    let box = { top: 900, bottom: 1170, height: 270 };
    const proto = Element.prototype as unknown as { scrollIntoView?: unknown; getBoundingClientRect: () => DOMRect };
    const was = { scroll: proto.scrollIntoView, rect: proto.getBoundingClientRect };
    proto.scrollIntoView = function (this: Element, arg: unknown) {
      calls.push(arg);
    };
    proto.getBoundingClientRect = () => ({ ...box, left: 0, right: 100, width: 100, x: 0, y: box.top, toJSON: () => ({}) }) as DOMRect;
    try {
      expect(revealPhoto(v, PHOTO_ID, mediaIdOf)).toBe(true);
      expect(calls).toEqual([{ block: 'center' }]);
      // La página siguió armándose (las fotos de arriba cargaron): se vuelve a centrar.
      await tick(350);
      expect(calls).toHaveLength(2);
      // Ya se ve entera, con lugar para el aviso: no se mueve.
      box = { top: 200, bottom: 470, height: 270 };
      calls.length = 0;
      expect(revealPhoto(v, PHOTO_ID, mediaIdOf)).toBe(true);
      await tick(350);
      expect(calls).toEqual([]);
      // Si la persona se movió, no se la lleva de vuelta.
      box = { top: 900, bottom: 1170, height: 270 };
      revealPhoto(v, PHOTO_ID, mediaIdOf);
      window.dispatchEvent(new Event('wheel'));
      await tick(350);
      expect(calls).toEqual([{ block: 'center' }]);
    } finally {
      proto.scrollIntoView = was.scroll;
      proto.getBoundingClientRect = was.rect;
    }
  });

  for (const track of [true, false]) {
    it(`auditoría F1: pegar con anotaciones, ⌘Z, ir y volver, ⌘⇧Z: ${track ? 'vuelven las anotaciones' : 'sin el mapa en el editor nuevo, no vuelven (el error)'}`, async () => {
      const { ids, app, runner } = await setup();
      app.trackMarkup = track;
      await app.go(ids.A);
      const doc = app.doc!;
      // El pegado (pasteWithMarkup): el editor sigue el mapa y lo pegado entra en el mismo paso que el texto.
      trackMarkupInUndo(view(app.editor!).state, doc);
      const v = view(app.editor!);
      v.dispatch(v.state.tr.insertText(' pegado', 3));
      doc.transact(() => {
        const m = doc.getMap<unknown>(PHOTO_MARKUP_MAP);
        m.set(PHOTO_ID, { v: 1, w: FRAME.w, h: FRAME.h });
        const shape = new Y.Map<unknown>();
        for (const [k, val] of Object.entries(rect(10))) shape.set(k, val);
        m.set(`${PHOTO_ID}/pegada`, shape);
      }, MARKUP_PASTE_ORIGIN);
      undoManager(app.editor!).stopCapturing();
      expect(drawn(doc)).toEqual([`${PHOTO_ID}/pegada`]);
      await runner.run('undo');
      expect(yText(doc)).not.toContain('pegado');
      expect(drawn(doc)).toEqual([]);
      await app.go(ids.B);
      await app.go(ids.A);
      await runner.run('redo');
      expect(yText(doc)).toContain('pegado');
      expect(drawn(doc)).toEqual(track ? [`${PHOTO_ID}/pegada`] : []);
    });
  }

  it('una versión vieja (el esquema anterior) abre la página con lo anotado deshecho y rehecho sin escribir nada', async () => {
    const { d, ids, app, runner } = await setup();
    await app.go(ids.A);
    const doc = app.doc!;
    annotate(app.timeline, ids.A, doc, () => addShape(doc, PHOTO_ID, 's1', rect(10), FRAME));
    await runner.run('undo');
    await runner.run('redo');
    app.leave();
    const opened = await d.docs.open(ids.A);
    const want = markupOf(opened);
    let writes = 0;
    const count = () => void writes++;
    opened.on('update', count);
    const old = mountEditor(opened, 'vieja', previousSchema);
    mounted.push(old);
    await tick();
    expect(writes).toBe(0);
    expect(markupOf(opened)).toEqual(want);
    opened.off('update', count);
    d.docs.close(ids.A);
  });
});

// Las guardas de lo anotado en la línea de tiempo (auditoría de la entrega 3, O3), sin el editor: dos proyectos, páginas
// con un `UndoManager` simple anotado como el editor en pantalla.
describe('anotar como un paso: las guardas (auditoría O3)', () => {
  function core() {
    const docs: Record<string, Y.Doc> = { A: new Y.Doc(), B: new Y.Doc(), X: new Y.Doc() };
    const project: Record<string, string> = { A: 'P1', B: 'P1', X: 'P2' };
    const tdocs: TimelineDocs = { open: async (id) => docs[id], close: () => undefined, subscribeUnsupported: () => () => undefined };
    const timeline = new UndoTimeline({ docs: tdocs, projectOf: (id) => project[id] ?? null });
    let editable = true;
    const attach = (id: string) =>
      timeline.attach(id, docs[id], new Y.UndoManager(docs[id].getXmlFragment('content'), { trackedOrigins: new Set(['texto']) }), { editable: () => editable });
    const annotateIn = (id: string, shape: string) =>
      annotate(timeline, id, docs[id], () => addShape(docs[id], PHOTO_ID, shape, rect(10), FRAME));
    return { docs, timeline, attach, annotateIn, setEditable: (on: boolean) => (editable = on) };
  }

  it('peek mira el proyecto de lo anotado: ⌘Z en otro proyecto no lo ofrece', () => {
    const { timeline, attach, annotateIn } = core();
    attach('A');
    attach('X');
    const id = annotateIn('A', 's1')!;
    expect(timeline.peek('P1', 'undo')).toEqual({ kind: 'markup', id, pageId: 'A', fileId: PHOTO_ID });
    expect(timeline.peek('P2', 'undo')).toBeNull();
  });

  it('forget con la página en pantalla saca lo anotado (el próximo ⌘Z no vuelve a avisar)', () => {
    const { timeline, attach, annotateIn } = core();
    attach('A');
    annotateIn('A', 's1');
    timeline.forget('A');
    expect(timeline.peek('P1', 'undo')).toBeNull();
  });

  it('stepMarkup no deshace en una página que no se puede editar (ni sin su editor)', () => {
    const { docs, timeline, attach, annotateIn, setEditable } = core();
    const detach = attach('A');
    const id = annotateIn('A', 's1')!;
    setEditable(false);
    expect(timeline.stepMarkup(id, 'undo')).toBe('readOnly');
    expect(drawn(docs.A)).toEqual([`${PHOTO_ID}/s1`]);
    setEditable(true);
    detach();
    expect(timeline.stepMarkup(id, 'undo')).toBe('notMounted');
    attach('A');
    expect(timeline.stepMarkup(id, 'undo')).toBe('done');
    expect(drawn(docs.A)).toEqual([]);
  });

  it('pushMarkup con otro documento que el de la página no entra; stepMarkup con el documento cambiado lo descarta', () => {
    const { docs, timeline, attach, annotateIn } = core();
    attach('A');
    // Lo anotado sobre otro documento (la página se rearmó mientras se anotaba).
    const stray = new Y.Doc();
    expect(annotate(timeline, 'A', stray, () => addShape(stray, PHOTO_ID, 's0', rect(1), FRAME))).toBeNull();
    const id = annotateIn('A', 's1')!;
    // El documento de la entrada deja de ser el de la página (sin pasar por el aviso de rearmado): una copia con lo mismo.
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(docs.A));
    const entry = (timeline as unknown as { markups: Map<string, { map: Y.Map<unknown> }> }).markups.get(id)!;
    entry.map = copy.getMap<unknown>(PHOTO_MARKUP_MAP);
    expect(timeline.stepMarkup(id, 'undo')).toBe('nothing');
    expect(timeline.markupState(id)).toBeNull();
    // No deshace en ninguno de los dos.
    expect(drawn(docs.A)).toEqual([`${PHOTO_ID}/s1`]);
    expect(drawn(copy)).toEqual([`${PHOTO_ID}/s1`]);
  });
});
