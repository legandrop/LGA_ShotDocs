// @vitest-environment jsdom
// Deshacer en el orden en que editaste (P.26, entrega 1; Docs/Doc_Deshacer.md, secciones 3 y 12): la línea de tiempo
// arriba de las pilas de Yjs de cada página, con el editor real (BlockNote + y-prosemirror) y `PageDocs` de verdad
// (IndexedDB en memoria y el servidor de prueba). Las páginas se montan y desmontan como en la app: el editor abre el
// documento (`docs.open`), se monta, se le pasa la pila (`attach`) y al irse la deja y cierra el documento.
import { ySyncPluginKey } from 'y-prosemirror';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { connect, mountEditor, undoManager, view, yText, type Editor } from './collabHarness';
import { previousSchema } from './photoHarness';
import { revealChange } from './undoReveal';
import { subscribeStepPopped, UndoTimeline, type TimelineDocs } from './undoTimeline';
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
  // Lo que dispara cada edición guardada (el recuento de pendientes) termina antes de cerrar la base.
  await new Promise((r) => setTimeout(r, 30));
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
  }
});

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

async function device(server = new FakeServer()): Promise<Device> {
  const d = await makeDevice(server, undefined, '0.999');
  devices.push(d);
  return d;
}

/** La posición del final del primer renglón con texto (o vacío) de la página. */
function endOfFirst(E: Editor, nth = 0): number {
  let pos = -1;
  let seen = 0;
  view(E).state.doc.descendants((n, p) => {
    if (pos >= 0) return false;
    if (n.isTextblock) {
      if (seen++ === nth) pos = p + 1 + n.content.size;
      return false;
    }
    return true;
  });
  return pos;
}

/** Escribe al final del primer renglón como un paso propio de la pila. */
function type(E: Editor, text: string, { cut = true } = {}): void {
  const v = view(E);
  v.dispatch(v.state.tr.insertText(text, endOfFirst(E)));
  if (cut) undoManager(E).stopCapturing();
}

/** Borra las últimas `n` letras del primer renglón (un paso propio). */
function erase(E: Editor, n: number): void {
  const v = view(E);
  const end = endOfFirst(E);
  v.dispatch(v.state.tr.delete(end - n, end));
  undoManager(E).stopCapturing();
}

/** Otra persona borra `text` (una transacción que no es del editor: no entra en ninguna pila). */
function removeText(doc: Y.Doc, text: string): void {
  doc.transact(() => {
    const walk = (n: Y.XmlElement | Y.XmlFragment | Y.XmlText): void => {
      if (n instanceof Y.XmlText) {
        const at = n.toString().indexOf(text);
        if (at >= 0) n.delete(at, text.length);
      } else n.toArray().forEach((c) => walk(c as never));
    };
    walk(doc.getXmlFragment(CONTENT_FRAGMENT));
  }, 'otra-persona');
}

/** Otra persona (otro documento conectado, otro autor) escribe `text` al final del renglón que dice `where`. */
function otherWritesIn(doc: Y.Doc, where: string, text: string): Y.Doc {
  const other = new Y.Doc();
  Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
  connect(doc, other, 'sync', { repair: false });
  const walk = (n: Y.XmlElement | Y.XmlFragment | Y.XmlText): boolean => {
    if (n instanceof Y.XmlText) {
      if (n.toString().includes(where)) {
        n.insert(n.length, text);
        return true;
      }
      return false;
    }
    return n.toArray().some((c) => walk(c as never));
  };
  walk(other.getXmlFragment(CONTENT_FRAGMENT));
  return other;
}

/** La app, en chico: una página en pantalla por vez, con su editor real sobre el documento de `PageDocs`. */
class App {
  current: string | null = null;
  editor: Editor | null = null;
  doc: Y.Doc | null = null;
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
    this.detach = this.timeline.attach(pageId, doc, undoManager(E), {
      binding,
      editable: () => true,
      dom: v.dom,
      snapshot: () => v.state.doc,
      reveal: (before, opts) => revealChange(v, before as never, opts),
    });
    this.current = pageId;
    this.editor = E;
    this.doc = doc;
  }

  /** Se va de la página: deja la pila, desmonta el editor y cierra el documento (como PageEditor). */
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

async function setup(names: string[], opts: { maxPages?: number; maxSteps?: number } = {}) {
  const d = await device();
  const ids: string[] = [];
  for (const n of names) ids.push(await d.tree.create(null, n));
  const project = d.tree.get(ids[0])!.workspace_id;
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
  const timeline = new UndoTimeline({ docs, projectOf: (id) => d.tree.get(id)?.workspace_id ?? null, ...opts });
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
  const text = async (id: string) => {
    const doc = await d.docs.open(id);
    const s = yText(doc);
    d.docs.close(id);
    return s;
  };
  const fire = (id: string) => unsupported.forEach((fn) => fn(id));
  return { d, ids, project, timeline, app, runner, notes, text, fire };
}

/** El documento vivo de una página (sin contar como abierta). */
const liveDoc = async (d: Device, id: string) => d.docs.peek(id)!;

/** Cuántas referencias tiene abierto el documento de una página en `PageDocs`. */
const refs = (d: Device, id: string) => (d.docs as unknown as { live: Map<string, { refs: number }> }).live.get(id)?.refs ?? 0;

describe('la línea de tiempo', () => {
  it('aceptación: escribir en A, en B y en A; desde C, tres ⌘Z deshacen A, B y A con su página en pantalla, y tres ⌘⇧Z lo vuelven', async () => {
    const { ids, app, runner, text, notes } = await setup(['A', 'B', 'C']);
    const [A, B, C] = ids;
    await app.go(A);
    type(app.editor!, 'uno');
    await app.go(B);
    type(app.editor!, 'dos');
    await app.go(A);
    type(app.editor!, ' tres');
    await app.go(C);
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      await runner.run('undo');
      seen.push(`${app.current === A ? 'A' : app.current === B ? 'B' : 'C'}:${yText(app.doc!)}`);
    }
    expect(seen).toEqual(['A:uno', 'B:', 'A:']);
    expect(notes.filter((n) => n.startsWith('Undone in'))).toHaveLength(3);
    for (let i = 0; i < 3; i++) await runner.run('redo');
    expect(app.current).toBe(A);
    expect(await text(A)).toBe('uno tres');
    expect(await text(B)).toBe('dos');
  });

  it('la pila sobrevive al cambiar de página: el documento se retiene y deshacer vuelve a poner lo borrado', async () => {
    const { d, ids, app, runner, timeline, text } = await setup(['A', 'B']);
    const [A, B] = ids;
    await app.go(A);
    type(app.editor!, 'plano general');
    erase(app.editor!, 'general'.length);
    await app.go(B);
    // El editor cerró su referencia; la línea de tiempo tiene la suya: el documento sigue vivo.
    expect(timeline.retains(A)).toBe(true);
    expect(refs(d, A)).toBe(1);
    expect(d.docs.peek(A)).not.toBeNull();
    await runner.run('undo');
    expect(app.current).toBe(A);
    expect(yText(app.doc!)).toBe('plano general');
    await runner.run('undo');
    expect(await text(A)).toBe('');
  });

  it('el meta del editor viejo se borra al irse (no lo retiene) y el editor nuevo recibe las listas', async () => {
    const { ids, app, timeline } = await setup(['A', 'B']);
    const [A, B] = ids;
    await app.go(A);
    const oldBinding = (ySyncPluginKey.getState(view(app.editor!).state as never) as { binding: object }).binding;
    type(app.editor!, 'uno');
    type(app.editor!, ' dos');
    const items = [...undoManager(app.editor!).undoStack];
    expect(items.every((i) => i.meta.has(oldBinding))).toBe(true);
    await app.go(B);
    expect(items.every((i) => !i.meta.has(oldBinding))).toBe(true);
    await app.go(A);
    expect(undoManager(app.editor!).undoStack).toEqual(items);
    expect(timeline.stepsOf(A)).toEqual({ undo: 2, redo: 0 });
  });

  it('una lista que no está vacía no se pisa: lo guardado va debajo', async () => {
    const { d, ids, app, timeline } = await setup(['A', 'B']);
    const [A, B] = ids;
    await app.go(A);
    type(app.editor!, 'uno');
    await app.go(B);
    // Un editor de A que ya escribió algo antes de que la línea de tiempo le pase la pila.
    const doc = await d.docs.open(A);
    const E = mountEditor(doc, 'a');
    mounted.push(E);
    type(E, ' dos');
    const own = [...undoManager(E).undoStack];
    expect(own).toHaveLength(1);
    timeline.attach(A, doc, undoManager(E));
    expect(undoManager(E).undoStack).toHaveLength(2);
    expect(undoManager(E).undoStack[1]).toBe(own[0]);
  });

  it('el mismo editor que se vuelve a montar en la misma página no duplica los pasos', async () => {
    const { ids, app, timeline } = await setup(['A']);
    const [A] = ids;
    await app.go(A);
    const E = app.editor!;
    const v = view(E);
    timeline.attach(A, app.doc!, undoManager(E), { editable: () => true, dom: v.dom });
    type(E, 'uno');
    expect(timeline.stepsOf(A)).toEqual({ undo: 1, redo: 0 });
  });

  it('un editor nuevo de la misma página antes de que se vaya el viejo: lo escrito entra una sola vez', async () => {
    const { ids, app, timeline } = await setup(['A']);
    const [A] = ids;
    await app.go(A);
    type(app.editor!, 'uno');
    // Como al cambiar el idioma: el editor nuevo se arma y se monta antes de que el viejo se desmonte.
    const E2 = mountEditor(app.doc!, 'a');
    mounted.push(E2);
    timeline.attach(A, app.doc!, undoManager(E2), { editable: () => true, dom: view(E2).dom });
    type(E2, ' dos');
    expect(timeline.stepsOf(A)).toEqual({ undo: 2, redo: 0 });
    // El viejo, hasta que se destruye, anota en listas propias que nadie mira.
    expect(undoManager(app.editor!).undoStack).not.toBe(undoManager(E2).undoStack);
  });

  it('un paso por vez: si el de arriba ya no cambia nada, no se saltea un paso de otra página que iba antes', async () => {
    const server = new FakeServer();
    const d = await device(server);
    const A = await d.tree.create(null, 'Shot 3');
    const B = await d.tree.create(null, 'Shot 12');
    const project = d.tree.get(A)!.workspace_id;
    const timeline = new UndoTimeline({ docs: d.docs, projectOf: (id) => d.tree.get(id)?.workspace_id ?? null });
    const app = new App(d, timeline);
    const notes: string[] = [];
    const runner = createUndoRunner({
      timeline,
      currentPage: () => app.current,
      currentProject: () => project,
      title: (id) => d.tree.get(id)?.title ?? '',
      blocked: () => null,
      go: (id) => void app.go(id),
      notify: (m) => void notes.push(m),
    });
    // A: "uno" (a0); B: "x" (b1); A: "dos" (a2). Después "dos" lo borra otra persona: a2 ya no cambia nada.
    await app.go(A);
    type(app.editor!, 'uno');
    await app.go(B);
    type(app.editor!, 'x');
    await app.go(A);
    type(app.editor!, 'dos');
    // Lo borra "otra persona": una transacción que no es del editor (no entra en la pila).
    removeText(app.doc!, 'dos');
    expect(yText(app.doc!)).toBe('uno');
    await runner.run('undo');
    // No cambió nada y lo anterior es de otra página: se frena y avisa; "uno" sigue.
    expect(yText(app.doc!)).toBe('uno');
    expect(notes.at(-1)).toMatch(/^Nothing to undo there/);
    await runner.run('undo');
    expect(app.current).toBe(B);
    expect(yText(app.doc!)).toBe('');
    await runner.run('undo');
    expect(app.current).toBe(A);
    expect(yText(app.doc!)).toBe('');
  });

  it('un paso que no cambia nada sigue con el anterior en el mismo ⌘Z si es de la misma página', async () => {
    const { ids, app, runner, notes } = await setup(['A']);
    const [A] = ids;
    await app.go(A);
    type(app.editor!, 'uno');
    type(app.editor!, 'dos');
    removeText(app.doc!, 'dos');
    await runner.run('undo');
    expect(yText(app.doc!)).toBe('');
    expect(notes).toEqual([]);
  });

  it('cortar el tiempo después de rehacer: lo que se escribe enseguida es otro paso', async () => {
    const { ids, app, runner } = await setup(['A']);
    const [A] = ids;
    await app.go(A);
    type(app.editor!, 'uno', { cut: false });
    await runner.run('undo');
    await runner.run('redo');
    type(app.editor!, ' dos', { cut: false });
    await runner.run('undo');
    expect(yText(app.doc!)).toBe('uno');
  });

  it('algo nuevo borra lo de rehacer en todas las páginas del proyecto', async () => {
    const { ids, app, runner, timeline } = await setup(['A', 'B']);
    const [A, B] = ids;
    await app.go(A);
    type(app.editor!, 'uno');
    await app.go(B);
    type(app.editor!, 'dos');
    await runner.run('undo'); // B
    await runner.run('undo'); // A (va a A)
    expect(timeline.stepsOf(B)).toEqual({ undo: 0, redo: 1 });
    type(app.editor!, 'tres');
    expect(timeline.stepsOf(B)).toEqual({ undo: 0, redo: 0 });
    expect(timeline.stepsOf(A)).toEqual({ undo: 1, redo: 0 });
    // B ya no tiene pasos: se soltó su documento.
    expect(timeline.retains(B)).toBe(false);
  });

  it('lo que la app escribe de fondo (addToHistory: false) no entra ni borra lo de rehacer', async () => {
    const { ids, app, runner, timeline } = await setup(['A', 'B']);
    const [A, B] = ids;
    await app.go(A);
    type(app.editor!, 'uno');
    await app.go(B);
    type(app.editor!, 'dos');
    await runner.run('undo');
    const v = view(app.editor!);
    v.dispatch(v.state.tr.insertText('z', endOfFirst(app.editor!)).setMeta('addToHistory', false));
    expect(timeline.stepsOf(B)).toEqual({ undo: 0, redo: 1 });
    expect(timeline.stepsOf(A)).toEqual({ undo: 1, redo: 0 });
  });

  it('mantener apretado no cruza de página; mientras va a otra página, otro ⌘Z no hace nada', async () => {
    const { ids, app, runner } = await setup(['A', 'B']);
    const [A, B] = ids;
    await app.go(A);
    type(app.editor!, 'uno');
    await app.go(B);
    type(app.editor!, 'dos');
    await runner.run('undo', { repeat: true });
    expect(yText(app.doc!)).toBe('');
    await runner.run('undo', { repeat: true });
    expect(app.current).toBe(B);
    const first = runner.run('undo');
    const second = runner.run('undo');
    await Promise.all([first, second]);
    expect(app.current).toBe(A);
    expect(yText(app.doc!)).toBe('');
  });

  it('una página en la papelera: sus pasos se sacan y se avisa', async () => {
    const { d, ids, app, runner, notes, timeline } = await setup(['A', 'B']);
    const [A, B] = ids;
    await app.go(A);
    type(app.editor!, 'uno');
    await app.go(B);
    await d.tree.trash(A);
    await runner.run('undo');
    expect(app.current).toBe(B);
    expect(notes.at(-1)).toMatch(/^Can't undo in “A”: it's in the trash/);
    expect(timeline.retains(A)).toBe(false);
  });

  it('el documento retenido que se rearma: se suelta en el momento del aviso, sus pasos se sacan y el próximo ⌘Z lo dice', async () => {
    const { d, ids, app, runner, notes, timeline, fire } = await setup(['A', 'B']);
    const [A, B] = ids;
    await app.go(A);
    type(app.editor!, 'uno');
    const first = app.doc!;
    await app.go(B);
    expect(refs(d, A)).toBe(1);
    // Como `PageDocs` al aplicar algo que no se pudo mostrar: el documento queda viejo y avisa.
    (d.docs as unknown as { live: Map<string, { stale?: boolean }> }).live.get(A)!.stale = true;
    fire(A);
    // Nadie la tiene abierta: la próxima vez que se abra, `PageDocs` la arma de nuevo desde lo guardado.
    expect(refs(d, A)).toBe(0);
    expect(timeline.stepsOf(A)).toEqual({ undo: 0, redo: 0 });
    await runner.run('undo');
    expect(notes.at(-1)).toMatch(/^Older changes in “A” can't be undone/);
    expect(app.current).toBe(B);
    // El siguiente no encuentra nada.
    await runner.run('undo');
    expect(notes).toHaveLength(1);
    await app.go(A);
    expect(app.doc).not.toBe(first);
  });

  it('B.22: si Yjs tira un error al deshacer, el paso se descarta, se avisa y lo de abajo queda', async () => {
    const { ids, app, runner, notes, timeline } = await setup(['A']);
    const [A] = ids;
    await app.go(A);
    type(app.editor!, 'uno');
    type(app.editor!, 'dos');
    const um = undoManager(app.editor!);
    const real = um.undo.bind(um);
    let once = true;
    um.undo = () => {
      if (once) {
        once = false;
        um.undoStack.pop();
        throw new TypeError("Cannot read properties of null (reading 'client')");
      }
      return real();
    };
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      await runner.run('undo');
    } finally {
      console.warn = warn;
    }
    // El paso que falló se descartó; el de abajo sigue (no se deshace en el mismo ⌘Z: se avisa y se frena).
    expect(timeline.stepsOf(A).undo).toBe(1);
    expect(yText(app.doc!)).toBe('unodos');
    expect(notes.at(-1)).toMatch(/^Nothing to undo there/);
    await runner.run('undo');
    expect(yText(app.doc!)).toBe('dos');
  });

  it('topes: más de N páginas o pasos olvida lo más viejo y suelta el documento', async () => {
    const { d, ids, app, timeline } = await setup(['A', 'B', 'C', 'D'], { maxPages: 2, maxSteps: 5 });
    for (const id of ids) {
      await app.go(id);
      type(app.editor!, 'x');
    }
    expect(timeline.pageIds().filter((id) => timeline.stepsOf(id).undo > 0)).toEqual([ids[2], ids[3]]);
    expect(refs(d, ids[0])).toBe(0);
    for (let i = 0; i < 6; i++) type(app.editor!, 'y');
    const total = ids.reduce((n, id) => n + timeline.stepsOf(id).undo + timeline.stepsOf(id).redo, 0);
    expect(total).toBe(5);
    expect(timeline.stepsOf(ids[2]).undo).toBe(0);
    expect(timeline.retains(ids[2])).toBe(false);
  });

  it('cada proyecto con su orden: ⌘Z en otro proyecto no te lleva', async () => {
    const { d, ids, app, timeline } = await setup(['A']);
    const other = await d.tree.createProject('MGTZD');
    const X = await d.tree.create(null, 'X', other);
    await app.go(ids[0]);
    type(app.editor!, 'uno');
    await app.go(X);
    expect(timeline.peek(other, 'undo')).toBeNull();
    expect(timeline.peek(d.tree.get(ids[0])!.workspace_id, 'undo')).toEqual({ kind: 'page', pageId: ids[0] });
  });

  it('quien llama directo al UndoManager (el asistente, restaurar) queda en el orden, y se avisa lo deshecho', async () => {
    const { ids, app, timeline } = await setup(['A', 'B']);
    const [A, B] = ids;
    await app.go(A);
    type(app.editor!, 'uno');
    await app.go(B);
    type(app.editor!, 'dos');
    const popped: unknown[] = [];
    const off = subscribeStepPopped((item) => popped.push(item));
    const top = undoManager(app.editor!).undoStack.at(-1);
    undoManager(app.editor!).undo();
    off();
    expect(popped).toEqual([top]);
    expect(timeline.peek(timeline['options'].projectOf(A), 'undo')).toEqual({ kind: 'page', pageId: A });
    expect(timeline.peek(timeline['options'].projectOf(A), 'redo')).toEqual({ kind: 'page', pageId: B });
  });

  it('con otro dispositivo escribiendo en la misma página, deshacer saca solo lo tuyo y lo suyo queda', async () => {
    const server = new FakeServer();
    const a = await device(server);
    const A = await a.tree.create(null, 'A');
    const B = await a.tree.create(null, 'B');
    await a.engine.syncNow();
    const b = await device(server);
    await b.engine.syncNow();
    const timeline = new UndoTimeline({ docs: a.docs, projectOf: (id) => a.tree.get(id)?.workspace_id ?? null });
    const app = new App(a, timeline);
    const runner = createUndoRunner({
      timeline,
      currentPage: () => app.current,
      currentProject: () => a.tree.get(A)!.workspace_id,
      title: (id) => a.tree.get(id)?.title ?? '',
      blocked: () => null,
      go: (id) => void app.go(id),
      notify: () => undefined,
    });
    await app.go(A);
    type(app.editor!, 'mío');
    await a.docs.flush(A);
    await a.engine.syncNow();
    await app.go(B);
    // El otro dispositivo escribe en A mientras A no está en pantalla (su documento está retenido en este).
    await b.engine.prefetchPage(A);
    const docB = await b.docs.open(A, { seed: true });
    const EB = mountEditor(docB, 'b');
    mounted.push(EB);
    type(EB, ' suyo');
    await b.docs.flush(A);
    await b.engine.syncNow();
    await a.engine.syncNow();
    await tick();
    expect(yText(await liveDoc(a, A))).toMatch(/mío/);
    await runner.run('undo');
    expect(app.current).toBe(A);
    expect(yText(app.doc!)).not.toMatch(/mío/);
    expect(yText(app.doc!)).toMatch(/ suyo/);
    await a.docs.flush(A);
    await a.engine.syncNow();
    await b.engine.syncNow();
    await tick();
    expect(yText(docB)).toBe(yText(app.doc!));
    await runner.run('redo');
    expect(yText(app.doc!)).toMatch(/mío/);
    expect(yText(app.doc!)).toMatch(/ suyo/);
    b.docs.close(A);
  });
  it('una versión vieja (el esquema anterior) abre lo deshecho y rehecho entre páginas sin escribir nada', async () => {
    const { d, ids, app, runner } = await setup(['A', 'B']);
    const [A, B] = ids;
    await app.go(A);
    type(app.editor!, 'uno');
    erase(app.editor!, 2);
    await app.go(B);
    type(app.editor!, 'dos');
    await runner.run('undo');
    await runner.run('undo');
    await runner.run('redo');
    app.leave();
    for (const id of [A, B]) {
      const doc = await d.docs.open(id);
      const want = yText(doc);
      let writes = 0;
      const count = () => void writes++;
      doc.on('update', count);
      const old = mountEditor(doc, 'vieja', previousSchema);
      mounted.push(old);
      await tick();
      expect(writes).toBe(0);
      expect(yText(doc)).toBe(want);
      doc.off('update', count);
      d.docs.close(id);
    }
  });
  it('B1: deshacer un renglón que creaste no se lleva lo que otra persona escribió adentro (cruzando de página)', async () => {
    const { ids, app, runner } = await setup(['A', 'B']);
    const [A, B] = ids;
    await app.go(A);
    type(app.editor!, 'plano');
    const E = app.editor!;
    E.insertBlocks([{ type: 'paragraph', content: 'nuevo' }] as never, E.document[0].id, 'after');
    undoManager(E).stopCapturing();
    await app.go(B);
    // A no está en pantalla: su documento retenido recibe lo del otro.
    const other = otherWritesIn(app.d.docs.peek(A)!, 'nuevo', ' deB');
    expect(yText(other)).toContain('nuevo deB');
    await runner.run('undo');
    expect(app.current).toBe(A);
    expect(yText(app.doc!)).not.toContain('nuevo');
    expect(yText(app.doc!)).toContain(' deB');
    expect(yText(other)).toBe(yText(app.doc!));
    await runner.run('undo');
    expect(yText(app.doc!)).toContain(' deB');
    expect(yText(app.doc!)).not.toContain('plano');
  });

  it('B1: lo mismo sin cambiar de página (el ⌘Z de siempre)', async () => {
    const { ids, app, runner } = await setup(['A']);
    const [A] = ids;
    await app.go(A);
    const E = app.editor!;
    E.insertBlocks([{ type: 'paragraph', content: 'nuevo' }] as never, E.document[0].id, 'after');
    undoManager(E).stopCapturing();
    const other = otherWritesIn(app.doc!, 'nuevo', ' deB');
    await runner.run('undo');
    expect(app.current).toBe(A);
    expect(yText(app.doc!)).not.toContain('nuevo');
    expect(yText(app.doc!)).toContain(' deB');
    expect(yText(other)).toBe(yText(app.doc!));
    // Rehacer vuelve a poner lo tuyo, con lo del otro.
    await runner.run('redo');
    expect(yText(app.doc!)).toContain('nuevo');
    expect(yText(app.doc!)).toContain(' deB');
  });
});
