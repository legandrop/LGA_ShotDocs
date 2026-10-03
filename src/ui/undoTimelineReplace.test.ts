// @vitest-environment jsdom
// Deshacer en el orden en que editaste, entrega 2 (P.26; Docs/Doc_Deshacer.md, 3.3, DH3, DH5, DH10 y sección 12): el
// reemplazo del proyecto como UN paso de la línea de tiempo, con el editor real, `PageDocs` de verdad y el motor de
// reemplazar (`ProjectReplace`) con su registro en `meta`. En las páginas con historia en la sesión el reemplazo entra
// en la pila de Yjs de la página (deshacerlo vuelve a poner las mismas letras); en las demás, las anclas.
import { defaultDeleteFilter, defaultProtectedNodes, ySyncPluginKey } from 'y-prosemirror';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { metaOf, ProjectReplace, type ReplaceRequest } from '../search/projectReplace';
import { ORIGIN_REPLACE } from '../sync/docs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { connect, mountEditor, undoManager, view, yText, type Editor } from './collabHarness';
import { para, previousSchema } from './photoHarness';
import { revealChange } from './undoReveal';
import { tempManager, UndoTimeline, type StepKind, type TimelineDocs } from './undoTimeline';
import { createUndoRunner } from './undoTimelineUi';
import { redoReplace, type ReplaceSession } from './replaceUi';

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

/** La posición del final del renglón `nth` con texto de la página. */
function endOf(E: Editor, nth = 0): number {
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

/** Escribe al final del renglón `nth` como un paso propio de la pila. */
function type(E: Editor, text: string, nth = 0): void {
  const v = view(E);
  v.dispatch(v.state.tr.insertText(text, endOf(E, nth)));
  undoManager(E).stopCapturing();
}

/** La app, en chico: una página en pantalla por vez, con su editor real anotado en la línea de tiempo. */
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

/** Páginas con sus renglones (escritos antes de la sesión: no están en ninguna pila), la línea de tiempo y el motor. */
async function setup(pages: Record<string, string[]>, opts: { maxPages?: number; maxSteps?: number; history?: boolean } = {}) {
  const d = await makeDevice(new FakeServer(), undefined, '0.999');
  devices.push(d);
  const ids: Record<string, string> = {};
  for (const [name, lines] of Object.entries(pages)) {
    const id = await d.tree.create(null, name);
    ids[name] = id;
    const doc = await d.docs.open(id, { seed: true });
    const E = mountEditor(doc, 'antes');
    E.replaceBlocks(E.document, lines.map((t, i) => para(`${name}-${i}`, [t])) as never);
    E.unmount();
    d.docs.close(id);
  }
  await d.docs.flush();
  const project = d.tree.get(Object.values(ids)[0])!.workspace_id;
  const docs: TimelineDocs = {
    open: (id) => d.docs.open(id),
    close: (id) => d.docs.close(id),
    subscribeUnsupported: (fn) => d.docs.subscribeUnsupported(fn),
  };
  const timeline = new UndoTimeline({ docs, projectOf: (id) => d.tree.get(id)?.workspace_id ?? null, maxPages: opts.maxPages, maxSteps: opts.maxSteps });
  const meta = metaOf(d.db);
  const engine = new ProjectReplace({
    tree: d.tree,
    docs: d.docs,
    meta,
    perms: () => ({ known: true, canEditPage: () => true }),
    online: () => true,
    history: opts.history === false ? undefined : timeline,
  });
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
    replace: (kind: StepKind, opId: string) => (kind === 'undo' ? engine.undo(opId, { inOrder: true }) : engine.redo(opId)),
  });
  const text = async (name: string) => {
    const doc = await d.docs.open(ids[name]);
    const s = yText(doc);
    d.docs.close(ids[name]);
    return s;
  };
  const texts = async () => {
    const out: Record<string, string> = {};
    for (const name of Object.keys(ids)) out[name] = await text(name);
    return out;
  };
  const request = (query: string, replacement: string, names = Object.keys(ids)): ReplaceRequest => ({
    projectId: project,
    pageIds: names.map((n) => ids[n]),
    query,
    replacement,
    options: {},
  });
  const replaceAll = async (query: string, replacement: string, names?: string[]) => {
    const r = await engine.run(request(query, replacement, names));
    return r.opId!;
  };
  const go = (name: string) => app.go(ids[name]);
  const where = () => Object.entries(ids).find(([, id]) => id === app.current)?.[0] ?? null;
  return { d, ids, project, timeline, engine, app, runner, notes, text, texts, replaceAll, go, where, meta };
}

describe('el reemplazo en la línea de tiempo (entrega 2)', () => {
  it('el hueco de 1.3 (D167): escribir, reemplazar, ⌘Z y ⌘Z deja "Toma 1: " exacto; ⌘⇧Z dos veces lo vuelve todo', async () => {
    const { timeline, app, runner, text, replaceAll, go, engine, project } = await setup({ A: ['Toma 1: '], B: ['otra cámara'] });
    await go('A');
    type(app.editor!, 'cámara roja');
    const op = await replaceAll('camara', 'Camera');
    expect(await text('A')).toBe('Toma 1: Camera roja');
    expect(await text('B')).toBe('otra Camera');
    // En A entró como un paso de su pila (A tiene historia en la sesión); B va por las anclas.
    expect(timeline.stepsOf(app.current!).undo).toBe(2);
    expect(timeline.peek(project, 'undo')).toEqual({ kind: 'replace', opId: op });
    await runner.run('undo');
    expect(await text('A')).toBe('Toma 1: cámara roja');
    expect(await text('B')).toBe('otra cámara');
    expect(await engine.list(project)).toEqual([]);
    await runner.run('undo');
    expect(await text('A')).toBe('Toma 1: ');
    await runner.run('redo');
    expect(await text('A')).toBe('Toma 1: cámara roja');
    await runner.run('redo');
    expect(await text('A')).toBe('Toma 1: Camera roja');
    expect(await text('B')).toBe('otra Camera');
    // Rehacer vuelve a escribir su registro: *Undo* del panel lo encuentra.
    expect((await engine.list(project)).map((h) => h.id)).toEqual([op]);
    expect(timeline.peek(project, 'redo')).toBeNull();
  });

  it('lo mismo cambiando de página: el reemplazo se deshace sin moverte, y lo de antes te lleva a su página', async () => {
    const { app, runner, text, replaceAll, go, where } = await setup({ A: ['Toma 1: '], B: ['otra cámara'], C: ['nada'] });
    await go('A');
    type(app.editor!, 'cámara roja');
    await go('C');
    // A ya no está en pantalla: el reemplazo entra en su pila con un UndoManager de un momento.
    await replaceAll('camara', 'Camera');
    expect(await text('A')).toBe('Toma 1: Camera roja');
    await runner.run('undo');
    expect(where()).toBe('C');
    expect(await text('A')).toBe('Toma 1: cámara roja');
    expect(await text('B')).toBe('otra cámara');
    await runner.run('undo');
    expect(where()).toBe('A');
    expect(await text('A')).toBe('Toma 1: ');
    await runner.run('redo');
    await go('C');
    await runner.run('redo');
    expect(where()).toBe('C');
    expect(await text('A')).toBe('Toma 1: Camera roja');
    expect(await text('B')).toBe('otra Camera');
  });

  it('sin la línea de tiempo (como antes, por las anclas) queda el texto de más: "Toma 1: cámara"', async () => {
    const { app, text, replaceAll, go, engine } = await setup({ A: ['Toma 1: '] }, { history: false });
    await go('A');
    type(app.editor!, 'cámara roja');
    const op = await replaceAll('camara', 'Camera');
    await engine.undo(op);
    undoManager(app.editor!).undo();
    expect(await text('A')).toBe('Toma 1: cámara');
  });

  it('el ejemplo de Lega (3.5): Shot 3, el reemplazo en todas, Shot 12; tres ⌘Z y tres ⌘⇧Z en orden', async () => {
    const pages: Record<string, string[]> = { 'Shot 3': ['plano'], 'Shot 12': ['toma'] };
    for (let i = 0; i < 6; i++) pages[`Shot ${20 + i}`] = [`la cámara ${i}`, 'otra Cámara'];
    const { app, runner, texts, replaceAll, go, where, notes } = await setup(pages);
    const before = await texts();
    await go('Shot 3');
    type(app.editor!, ' general con cámara');
    const afterShot3 = await texts();
    await replaceAll('camara', 'Camera');
    const afterReplace = await texts();
    expect(afterReplace['Shot 3']).toBe('plano general con Camera');
    expect(afterReplace['Shot 22']).toBe('la Camera 2 | otra Camera');
    await go('Shot 12');
    type(app.editor!, ' 2');
    const last = await texts();
    await runner.run('undo');
    expect(await texts()).toEqual(afterReplace);
    await runner.run('undo');
    expect(where()).toBe('Shot 12');
    expect(await texts()).toEqual(afterShot3);
    await runner.run('undo');
    expect(where()).toBe('Shot 3');
    expect(await texts()).toEqual(before);
    expect(notes.filter((n) => n.startsWith('Undone in'))).toHaveLength(1);
    await runner.run('redo');
    expect(await texts()).toEqual(afterShot3);
    await runner.run('redo');
    expect(await texts()).toEqual(afterReplace);
    await runner.run('redo');
    expect(where()).toBe('Shot 12');
    expect(await texts()).toEqual(last);
  });

  it('DH10 / C1: Undo del panel cuando el reemplazo ya no es lo último: por la pila en las páginas con historia, y ⌘Z, ⌘Z deja "Toma 1: "', async () => {
    const { timeline, app, runner, text, replaceAll, go, engine, project } = await setup({ A: ['Toma 1: '], B: ['algo'], C: ['la cámara de C'] });
    await go('A');
    type(app.editor!, 'cámara roja');
    const op = await replaceAll('camara', 'Camera');
    await go('B');
    type(app.editor!, ' más');
    expect(timeline.peek(project, 'undo')).toEqual({ kind: 'page', pageId: app.current });
    // El *Undo* del panel (o del aviso): fuera de orden.
    const r = await engine.undo(op, { inOrder: timeline.replaceIsNext(op, 'undo') });
    expect([r.undone, r.changed, r.remaining, r.pages]).toEqual([2, 0, 0, 2]);
    expect(await text('A')).toBe('Toma 1: cámara roja');
    expect(await text('C')).toBe('la cámara de C');
    expect(await text('B')).toBe('algo más');
    // Sale de la línea de tiempo: no se rehace.
    expect(timeline.replaceState(op)).toBeNull();
    await runner.run('undo');
    expect(await text('B')).toBe('algo');
    await runner.run('undo');
    expect(await text('A')).toBe('Toma 1: ');
    expect(timeline.peek(project, 'undo')).toBeNull();
    await runner.run('redo');
    await runner.run('redo');
    expect(await text('A')).toBe('Toma 1: cámara roja');
    expect(await text('B')).toBe('algo más');
    expect(await text('C')).toBe('la cámara de C');
    expect(timeline.peek(project, 'redo')).toBeNull();
  });

  it('una página sin historia al reemplazar, y después escribís adentro de lo reemplazado: deshacer todo y rehacer todo, exactos', async () => {
    const { app, runner, text, replaceAll, go, project, timeline } = await setup({ A: ['la cámara roja'], C: ['nada'] });
    await go('C');
    await replaceAll('camara', 'Camera');
    // A no tenía historia: se reemplazó por las anclas. Ahora escribís adentro de "Camera".
    await go('A');
    const v = view(app.editor!);
    let at = -1;
    v.state.doc.descendants((n, p) => {
      if (at < 0 && n.isText && n.text!.includes('Camera')) at = p + n.text!.indexOf('Camera') + 3;
      return at < 0;
    });
    v.dispatch(v.state.tr.insertText('wk', at));
    undoManager(app.editor!).stopCapturing();
    const last = await text('A');
    expect(last).toBe('la Camwkera roja');
    while (timeline.peek(project, 'undo')) await runner.run('undo');
    expect(await text('A')).toBe('la cámara roja');
    // Deshacer el reemplazo por las anclas en orden entró en la pila de A: rehacerlo es el de Yjs y "wk" vuelve adentro.
    while (timeline.peek(project, 'redo')) await runner.run('redo');
    expect(await text('A')).toBe(last);
    while (timeline.peek(project, 'undo')) await runner.run('undo');
    expect(await text('A')).toBe('la cámara roja');
  });

  it('cortar el tiempo antes: reemplazar enseguida después de escribir es otro paso (no se pega a lo escrito)', async () => {
    const { app, runner, text, replaceAll, go } = await setup({ A: ['la '] });
    await go('A');
    const v = view(app.editor!);
    // Sin cortar: lo que se escriba en medio segundo se juntaría en el mismo paso.
    v.dispatch(v.state.tr.insertText('cámara', endOf(app.editor!)));
    await replaceAll('camara', 'Camera');
    expect(await text('A')).toBe('la Camera');
    await runner.run('undo');
    expect(await text('A')).toBe('la cámara');
    await runner.run('undo');
    expect(await text('A')).toBe('la ');
  });

  it('DH10 con la página en pantalla: lo contrario del paso deshecho fuera de orden no queda para rehacer', async () => {
    const { timeline, app, runner, text, replaceAll, go, engine, project } = await setup({ A: ['Toma 1: ', 'nota'] });
    await go('A');
    type(app.editor!, 'cámara roja');
    const op = await replaceAll('camara', 'Camera');
    type(app.editor!, ' bien', 1);
    await engine.undo(op, { inOrder: timeline.replaceIsNext(op, 'undo') });
    expect(await text('A')).toBe('Toma 1: cámara roja | nota bien');
    expect(timeline.peek(project, 'redo')).toBeNull();
    await runner.run('undo');
    await runner.run('undo');
    expect(await text('A')).toBe('Toma 1:  | nota');
    await runner.run('redo');
    await runner.run('redo');
    expect(await text('A')).toBe('Toma 1: cámara roja | nota bien');
    expect(timeline.peek(project, 'redo')).toBeNull();
  });

  it('reemplazar borra lo que había para rehacer aunque no toque esa página', async () => {
    const { timeline, app, runner, replaceAll, go, project } = await setup({ A: ['la cámara'], B: ['luz'] });
    await go('B');
    type(app.editor!, ' uno');
    await runner.run('undo');
    expect(timeline.peek(project, 'redo')).not.toBeNull();
    // A no tiene historia: va por las anclas, sin ningún paso de pila.
    await replaceAll('camara', 'Camera', ['A']);
    expect(timeline.peek(project, 'redo')).toBeNull();
  });

  it('auditoría O2: dos ⌘Z seguidos sobre un reemplazo deshacen solo el reemplazo y su ⌘⇧Z sigue', async () => {
    const { timeline, app, runner, text, replaceAll, go } = await setup({ A: ['la cámara'], B: ['luz'] });
    await go('B');
    type(app.editor!, ' uno');
    const op = await replaceAll('camara', 'Camera');
    await Promise.all([runner.run('undo'), runner.run('undo')]);
    expect(await text('A')).toBe('la cámara');
    expect(await text('B')).toBe('luz uno');
    expect(timeline.replaceIsNext(op, 'redo')).toBe(true);
    await runner.run('redo');
    expect(await text('A')).toBe('la Camera');
  });

  it('auditoría O3: un reemplazo que no cambió nada no borra lo que había para rehacer', async () => {
    const { timeline, app, runner, replaceAll, go, project } = await setup({ A: ['la cámara'], B: ['luz'] });
    await go('B');
    type(app.editor!, ' uno');
    await runner.run('undo');
    expect(await replaceAll('zzz', 'y')).toBeFalsy();
    expect(timeline.peek(project, 'redo')).not.toBeNull();
  });

  it('auditoría O3: el Redo de un aviso viejo no rehace el reemplazo si ya no es lo próximo', async () => {
    const { timeline, engine, app, runner, text, replaceAll, go } = await setup({ A: ['la cámara'] });
    await go('A');
    type(app.editor!, ' uno');
    const op = await replaceAll('camara', 'Camera');
    await runner.run('undo');
    await runner.run('undo');
    expect(await text('A')).toBe('la cámara');
    const r = await redoReplace({ timeline, engine } as unknown as ReplaceSession, op);
    expect(r.pages).toBe(0);
    expect(await text('A')).toBe('la cámara');
    expect(timeline.replaceState(op)).toBe('redo');
    await runner.run('redo');
    await runner.run('redo');
    expect(await text('A')).toBe('la Camera uno');
  });

  it('auditoría O3: el paso de una página se deshace solo con su mismo documento', async () => {
    const { timeline, ids, app, runner, text, replaceAll, go } = await setup({ A: ['la cámara'] });
    await go('A');
    type(app.editor!, ' uno');
    const op = await replaceAll('camara', 'Camera');
    expect(timeline.popReplace(ids.A, new Y.Doc(), op, 'undo', true)).toBe('none');
    expect(await text('A')).toBe('la Camera uno');
    await runner.run('undo');
    await runner.run('undo');
    expect(await text('A')).toBe('la cámara');
  });

  it('auditoría O4: si escribís mientras se deshace un reemplazo, ya no queda para rehacer', async () => {
    const pages: Record<string, string[]> = { Z: ['nada'] };
    for (let i = 0; i < 8; i++) pages[`P${i}`] = [`la cámara ${i}`];
    const { timeline, engine, app, runner, replaceAll, go, project, text } = await setup(pages);
    await go('Z');
    const op = await replaceAll('camara', 'Camera');
    const undoing = runner.run('undo');
    for (let i = 0; i < 200 && !engine.isRunning(); i++) await tick(1);
    expect(engine.isRunning()).toBe(true);
    type(app.editor!, ' nuevo');
    await undoing;
    expect(await text('P7')).toBe('la cámara 7');
    expect(timeline.replaceState(op)).toBeNull();
    expect(timeline.peek(project, 'redo')).toBeNull();
  });

  it('el Undo del panel cuando el reemplazo ES lo último hace lo mismo que ⌘Z: se puede rehacer', async () => {
    const { timeline, text, replaceAll, engine, runner } = await setup({ A: ['la cámara'] });
    const op = await replaceAll('camara', 'Camera');
    expect(timeline.replaceIsNext(op, 'undo')).toBe(true);
    await engine.undo(op, { inOrder: timeline.replaceIsNext(op, 'undo') });
    expect(await text('A')).toBe('la cámara');
    expect(timeline.replaceIsNext(op, 'redo')).toBe(true);
    await runner.run('redo');
    expect(await text('A')).toBe('la Camera');
  });

  it('algo nuevo después de deshacer el reemplazo borra su rehacer; otro reemplazo también', async () => {
    const { timeline, app, runner, replaceAll, go, project, text } = await setup({ A: ['la cámara'], B: ['luz'] });
    await go('B');
    type(app.editor!, ' uno');
    const op = await replaceAll('camara', 'Camera');
    await runner.run('undo');
    expect(timeline.replaceState(op)).toBe('redo');
    type(app.editor!, ' dos');
    expect(timeline.replaceState(op)).toBeNull();
    expect(timeline.peek(project, 'redo')).toBeNull();
    // Otro reemplazo después de deshacer lo escrito: lo de rehacer se va.
    await runner.run('undo');
    expect(timeline.peek(project, 'redo')).not.toBeNull();
    await replaceAll('luz', 'Light');
    expect(timeline.peek(project, 'redo')).toBeNull();
    expect(await text('B')).toBe('Light uno');
  });

  it('mantener apretado ⌘Z se frena antes de un reemplazo; mientras se deshace, otro ⌘Z no hace nada', async () => {
    const { app, runner, replaceAll, go, text } = await setup({ A: ['la cámara'] });
    await go('A');
    await replaceAll('camara', 'Camera');
    type(app.editor!, ' roja');
    await runner.run('undo', { repeat: true });
    expect(await text('A')).toBe('la Camera');
    await runner.run('undo', { repeat: true });
    expect(await text('A')).toBe('la Camera');
    const first = runner.run('undo');
    const second = runner.run('undo');
    await Promise.all([first, second]);
    expect(await text('A')).toBe('la cámara');
  });

  it('con otra persona escribiendo adentro de lo reemplazado: lo suyo queda y los dos terminan iguales', async () => {
    const { app, runner, replaceAll, go, text } = await setup({ A: ['Toma 1: '] });
    await go('A');
    type(app.editor!, 'cámara roja');
    await replaceAll('camara', 'Camera');
    // El otro (otro documento conectado, otro autor) escribe "XX" adentro de "Camera".
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(app.doc!));
    connect(app.doc!, other, 'sync', { repair: false });
    other.transact(() => {
      const walk = (n: Y.XmlElement | Y.XmlFragment | Y.XmlText): boolean => {
        if (n instanceof Y.XmlText) {
          const at = n.toString().indexOf('Camera');
          if (at < 0) return false;
          n.insert(at + 3, 'XX');
          return true;
        }
        return n.toArray().some((c) => walk(c as never));
      };
      walk(other.getXmlFragment(CONTENT_FRAGMENT));
    });
    expect(await text('A')).toBe('Toma 1: CamXXera roja');
    await runner.run('undo');
    expect(await text('A')).toContain('XX');
    expect(await text('A')).toContain('cámara');
    await runner.run('undo');
    expect(await text('A')).toBe('Toma 1: XX');
    expect(yText(other)).toBe(yText(app.doc!));
  });

  it('una página en la papelera: se deshace en las demás, esa queda para Undo the rest, y ⌘⇧Z rehace solo las deshechas', async () => {
    const { d, ids, runner, replaceAll, texts, engine, project, timeline } = await setup({ A: ['la cámara'], B: ['otra cámara'] });
    const op = await replaceAll('camara', 'Camera');
    await d.tree.trash(ids.B);
    const r = await engine.undo(op, { inOrder: timeline.replaceIsNext(op, 'undo') });
    expect([r.pages, r.remaining]).toEqual([1, 1]);
    expect(await texts()).toEqual({ A: 'la cámara', B: 'otra Camera' });
    const [partial] = await engine.list(project);
    expect(partial.status).toBe('partial');
    expect(timeline.replacePages(op)).toEqual([ids.A]);
    await runner.run('redo');
    expect(await texts()).toEqual({ A: 'la Camera', B: 'otra Camera' });
  });

  it('una página con historia que no se pudo deshacer: su paso del reemplazo sale de la pila y lo de antes sigue en orden', async () => {
    const { d, ids, app, runner, replaceAll, go, text, where } = await setup({ A: ['la cámara'], B: ['otra cámara'] });
    await go('A');
    type(app.editor!, ' uno');
    await go('B');
    type(app.editor!, ' dos');
    await go('A');
    await replaceAll('camara', 'Camera');
    await d.tree.trash(ids.B);
    await runner.run('undo');
    expect(await text('A')).toBe('la cámara uno');
    expect(await text('B')).toBe('otra Camera dos');
    await d.tree.restore(ids.B);
    // Lo próximo es lo escrito en B (después de lo de A): el paso del reemplazo que quedó en B no lo tapa.
    await runner.run('undo');
    expect(where()).toBe('B');
    expect(await text('B')).toBe('otra Camera');
  });

  it('un reemplazo que ya no está entre los últimos 5 del panel se deshace igual con ⌘Z (con lo guardado en memoria)', async () => {
    const words = ['uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis'];
    const { runner, replaceAll, text, engine, project } = await setup({ A: [words.join(' ')] });
    for (const w of words) await replaceAll(w, w.toUpperCase());
    expect(await engine.list(project)).toHaveLength(5);
    for (let i = 0; i < words.length; i++) await runner.run('undo');
    expect(await text('A')).toBe(words.join(' '));
    for (let i = 0; i < words.length; i++) await runner.run('redo');
    expect(await text('A')).toBe(words.join(' ').toUpperCase());
  });

  it('topes: un reemplazo viejo se olvida entero (sus pasos de las pilas también) y el panel lo sigue deshaciendo por las anclas', async () => {
    const { timeline, app, runner, replaceAll, go, text, engine, project, notes } = await setup({ A: ['la cámara'], B: ['x'] }, { maxSteps: 4 });
    await go('A');
    type(app.editor!, ' roja');
    const op = await replaceAll('camara', 'Camera');
    await go('B');
    for (const s of [' 1', ' 2', ' 3', ' 4']) type(app.editor!, s);
    expect(timeline.replaceState(op)).toBeNull();
    for (let i = 0; i < 6; i++) await runner.run('undo');
    expect(notes.some((n) => n.startsWith('Older changes'))).toBe(true);
    expect(await text('A')).toBe('la Camera roja');
    await engine.undo(op);
    expect(await text('A')).toBe('la cámara roja');
    expect(await engine.list(project)).toEqual([]);
  });

  it('el UndoManager de un momento tiene las mismas opciones que el del editor (riesgo 2)', async () => {
    const { app, go, d, ids, timeline } = await setup({ A: ['la cámara', 'otra'] });
    await go('A');
    const editorUm = undoManager(app.editor!);
    const doc = await d.docs.open(ids.A);
    // La línea de tiempo toma el filtro del editor (sin envolver): es el de y-prosemirror.
    const filter = (timeline as unknown as { editorFilter: (i: Y.Item) => boolean }).editorFilter;
    const temp = tempManager(doc, filter);
    expect(temp.scope).toEqual(editorUm.scope);
    expect(temp.trackedOrigins.has(null)).toBe(false);
    const items: Y.Item[] = [];
    for (const structs of doc.store.clients.values()) for (const s of structs) if (s instanceof Y.Item) items.push(s);
    expect(items.length).toBeGreaterThan(5);
    expect(items.map((i) => temp.deleteFilter(i))).toEqual(items.map((i) => editorUm.deleteFilter(i)));
    expect(items.map((i) => filter(i))).toEqual(items.map((i) => defaultDeleteFilter(i, defaultProtectedNodes)));
    expect(items.some((i) => !filter(i))).toBe(true);
    const fake = { meta: new Map([['addToHistory', false]]) } as unknown as Y.Transaction;
    expect(temp.captureTransaction(fake)).toBe(editorUm.captureTransaction(fake));
    temp.destroy();
    d.docs.close(ids.A);
  });

  it('el reemplazo escrito por la línea de tiempo usa el origen del reemplazo (se guarda y se sube como cualquier edición)', async () => {
    const { d, ids, app, replaceAll, go } = await setup({ A: ['la cámara'] });
    await go('A');
    type(app.editor!, ' roja');
    const origins: unknown[] = [];
    app.doc!.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin));
    await replaceAll('camara', 'Camera');
    expect(origins).toContain(ORIGIN_REPLACE);
    expect(await d.docs.unsyncedPages()).toContain(ids.A);
  });

  it('una versión vieja (el esquema anterior) abre lo deshecho y rehecho por el reemplazo sin escribir nada', async () => {
    const { d, ids, app, runner, replaceAll, go } = await setup({ A: ['Toma 1: '], B: ['otra cámara'] });
    await go('A');
    type(app.editor!, 'cámara roja');
    await replaceAll('camara', 'Camera');
    await runner.run('undo');
    await runner.run('redo');
    await runner.run('undo');
    app.leave();
    for (const id of [ids.A, ids.B]) {
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
});
