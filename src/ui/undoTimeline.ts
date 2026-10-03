import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';

// Deshacer en el orden en que editaste (P.26, entrega 1; Docs/Doc_Deshacer.md, sección 3).
//
// Una línea de tiempo por pestaña (y por instancia de servicios) arriba de las pilas de deshacer de Yjs de cada página.
// No guarda contenido: las pilas siguen siendo las de Yjs (las arma y-prosemirror en cada editor) y deshacer sigue siendo
// el deshacer de Yjs. Lo que agrega:
//
// - **Las pilas sobreviven al cambiar de página.** Al desmontarse el editor, sus listas (`undoStack`, `redoStack`)
//   quedan acá; al montarse el editor nuevo de la misma página, se le pasan (sin parchear y-prosemirror: el
//   `UndoManager` las usa como propias). El documento de una página con pasos se retiene (`docs.open`): sin eso Yjs no
//   podría volver a poner lo borrado (un documento rearmado desde lo guardado ya no lo tiene).
// - **El orden entre páginas.** Cada paso lleva un número de orden (el momento en que se creó o se extendió); el
//   próximo ⌘Z es el paso de arriba con el número más alto entre las páginas del proyecto (DH7: un orden por proyecto).
// - **Un paso por vez** (3.4, punto 4): Yjs, si un paso ya no cambia nada, sigue solo con el anterior de la misma pila;
//   eso saltearía un paso de otra página que iba antes. `step` le pasa a Yjs solo el de arriba.
// - **Algo nuevo borra lo de rehacer en todas las páginas del proyecto** (como cualquier editor: un solo orden).
// - **Topes** (3.2): las últimas `maxPages` páginas con pasos y `maxSteps` pasos en total; lo más viejo se olvida.
//
// Quien llama directo al `UndoManager` del editor en pantalla (el asistente que deshace su propio paso, restaurar una
// versión, el título recién creado desde una plantilla) no rompe nada: la línea de tiempo escucha los eventos de esa
// pila (`stack-item-added`, `-updated`, `-popped`), y lo que hagan queda en el orden. Nada de esto se guarda: dura lo
// que la pestaña (DH4).
//
// **El reemplazo del proyecto** (entrega 2, 3.3) es UNA entrada de la línea de tiempo. En las páginas con historia en la
// sesión (las que están acá), lo que escribe entra además como un paso de la pila de Yjs de esa página (el del editor si
// está en pantalla, o uno de un momento con las mismas opciones), así deshacerlo vuelve a poner las mismas letras y lo
// escrito antes sale exacto. En las demás, quien reemplaza usa las anclas de su registro. El orden lo da `seq` de la
// entrada; sus pasos en las pilas quedan marcados (`tagged`) y no cuentan como pasos de página.
//
// **Anotar una foto** (entrega 3, 3.1 y caso «Anotar» de la sección 5): con el anotador abierto, su ⌘Z es de esa foto
// (su propio `UndoManager` sobre el mapa de anotaciones). Al cerrarlo, todo lo de esa vez entra como UNA entrada de la
// página (`MarkupEntry`): los pasos del anotador, que se deshacen (o rehacen) todos juntos con un `UndoManager` de un
// momento sobre el mapa, uno por uno, como si se apretara ⌘Z en el anotador hasta vaciarlo. Lo de otra persona en la
// misma foto no se lleva (origen propio de la foto, y `protectMarkupOthers`).

type StackItem = Y.UndoManager['undoStack'][number];
type UndoManager = Y.UndoManager;
export type StepKind = 'undo' | 'redo';

/** Lo que la línea de tiempo usa de `PageDocs` (docs.ts): abrir y cerrar (contar referencias) y el aviso de rearmado. */
export interface TimelineDocs {
  open(pageId: string): Promise<Y.Doc>;
  close(pageId: string): void;
  subscribeUnsupported(fn: (pageId: string) => void): () => void;
}

export interface TimelineOptions {
  docs: TimelineDocs;
  /** El proyecto de una página (`null` si ya no está en el árbol). */
  projectOf: (pageId: string) => string | null;
  /** Páginas con pasos (las demás se olvidan, la más vieja primero). */
  maxPages?: number;
  /** Pasos en total (deshacer y rehacer, todas las páginas). */
  maxSteps?: number;
}

/** Lo que el editor en pantalla le da a la línea de tiempo al montarse (PageEditor.tsx). */
export interface AttachInfo {
  /**
   * El *binding* de y-prosemirror de este editor: es la clave con que guarda la selección en `stackItem.meta`. Al irse
   * el editor se borra de cada paso (si no, retiene el editor viejo entero con su documento de ProseMirror).
   */
  binding?: object | null;
  /** Si ahora se puede editar (solo entonces se deshace en esta página). */
  editable?: () => boolean;
  /** El elemento del editor: el ⌘Z con el foco adentro es de la línea de tiempo. */
  dom?: Element | null;
  /** Muestra lo que cambió un deshacer (el documento de ProseMirror de antes), con el cursor ahí. */
  reveal?: (before: unknown, opts: { moveCursor: boolean }) => void;
  /** El documento de ProseMirror ahora (para `reveal`). */
  snapshot?: () => unknown;
  /** Trae a la vista la foto de ese archivo (deshacer lo anotado); `false` si ya no está en la página. */
  showPhoto?: (fileId: string) => boolean;
}

interface PageHistory {
  pageId: string;
  /** El proyecto al crearse (si la página sale del árbol, se sigue sabiendo de cuál era). */
  project: string | null;
  doc: Y.Doc;
  /** Tiene una referencia de `docs.open` (se suelta con `docs.close`). */
  retained: boolean;
  /** El `UndoManager` del editor en pantalla (mientras esté montado, las listas son las suyas). */
  um: UndoManager | null;
  info: AttachInfo | null;
  /** Las listas mientras no hay editor montado. */
  undo: StackItem[];
  redo: StackItem[];
  offs: (() => void)[];
}

/**
 * Pasos que se perdieron: los de una página cuyo documento se rearmó (`reloaded`) o los que olvidó el tope (`limit`, uno
 * por proyecto, sin página). El próximo ⌘Z que llegue ahí lo avisa.
 */
interface LostMark {
  pageId: string;
  project: string | null;
  seq: number;
  reason: LostReason;
}

export type LostReason = 'reloaded' | 'limit';

export type NextStep =
  | { kind: 'page'; pageId: string }
  | { kind: 'replace'; opId: string }
  | { kind: 'markup'; id: string; pageId: string; fileId: string }
  | { kind: 'lost'; pageId: string; reason: LostReason }
  | null;

/** Un reemplazo del proyecto en la línea de tiempo (entrega 2; Doc_Deshacer.md, 3.3). */
interface ReplaceEntry {
  opId: string;
  project: string | null;
  /** `pending`: se está escribiendo; `undo` / `redo`: en qué lista está. */
  where: 'pending' | StepKind;
  seq: number;
  /** Por página con historia, su paso en la pila de Yjs de esa página (en la lista de `where`). */
  items: Map<string, StackItem>;
  /** Las páginas que se deshicieron (las que vuelve a escribir rehacer). */
  pages: string[];
  /** Lo que guarda quien reemplaza (el encabezado y los cambios de cada página): para rehacer y para el aviso. */
  saved: unknown;
  /** Cuántas veces hubo algo nuevo cuando empezó a deshacerse (`markReplace`). */
  mark: number;
}

/** Lo de una vez en el anotador de una foto (entrega 3): un paso de la página. */
interface MarkupEntry {
  id: string;
  pageId: string;
  fileId: string;
  project: string | null;
  /** El mapa de las anotaciones del documento de la página (el mismo `Y.Doc` que retiene la página). */
  map: Y.Map<unknown>;
  where: StepKind;
  seq: number;
  /** Los pasos del anotador (los de abajo primero) en la lista de `where`. */
  items: StackItem[];
}

/** Cómo quedó deshacer o rehacer el paso de un reemplazo en una página; `none`: no tiene paso ahí (van las anclas). */
export type ReplacePop = 'done' | 'nothing' | 'failed' | 'none';

/**
 * - `done`: deshizo (o rehízo) algo;
 * - `nothing`: el paso ya no cambiaba nada (otra persona borró justo eso) y se descartó;
 * - `failed`: Yjs tiró un error al deshacerlo (la excepción de dos personas, B.22) y el paso se descartó;
 * - `notMounted` / `readOnly` / `empty`: no se hizo nada.
 */
export type StepResult = 'done' | 'nothing' | 'failed' | 'notMounted' | 'readOnly' | 'empty';

interface StackEvent {
  stackItem: StackItem;
  type: StepKind;
}

const DEFAULT_MAX_PAGES = 20;
const DEFAULT_MAX_STEPS = 1000;
/** Marcas de páginas que perdieron sus pasos (se avisan en el próximo ⌘Z que llegue ahí). */
const MAX_LOST = 50;

/** Los que quieren saber cuándo se deshizo un paso, de cualquier editor (la marca *Restored from…*, historyRestore.ts). */
const poppedListeners = new Set<(stackItem: unknown, type: StepKind) => void>();

/** Avisa cada paso deshecho o rehecho por un editor de página montado, en cualquier línea de tiempo. */
export function subscribeStepPopped(fn: (stackItem: unknown, type: StepKind) => void): () => void {
  poppedListeners.add(fn);
  return () => poppedListeners.delete(fn);
}

/** Si la clave de un `meta` es un *binding* de y-prosemirror (el editor que guardó la selección). */
function isBinding(key: unknown): key is object {
  return typeof key === 'object' && key !== null && 'prosemirrorView' in key && 'type' in key;
}

export class UndoTimeline {
  private readonly pages = new Map<string, PageHistory>();
  private readonly order = new WeakMap<StackItem, number>();
  private counter = 0;
  private lost: LostMark[] = [];
  private readonly replaces = new Map<string, ReplaceEntry>();
  /** Lo anotado en las fotos, una entrada por cada vez que se cerró el anotador (entrega 3). */
  private readonly markups = new Map<string, MarkupEntry>();
  private markupCount = 0;
  /** Cuántas veces hubo algo nuevo (escribir, reemplazar) en esta pestaña: lo que borra lo de rehacer. */
  private newEdits = 0;
  /** El filtro de borrado del `UndoManager` de y-prosemirror, del primer editor que se anotó (para `tempManager`). */
  private editorFilter: UndoManager['deleteFilter'] | null = null;
  /** Los pasos de las pilas que son de un reemplazo (no cuentan como pasos de su página). */
  private readonly tagged = new WeakMap<StackItem, ReplaceEntry>();
  private readonly maxPages: number;
  private readonly maxSteps: number;
  private readonly offUnsupported: () => void;
  private disposed = false;

  constructor(private readonly options: TimelineOptions) {
    this.maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    // El documento retenido quedó viejo (llegó algo que no se pudo aplicar) o se va a rearmar: sus pasos dejan de
    // valer. La referencia se suelta EN EL MOMENTO del aviso, antes de que la página vuelva a abrir: `docs.open` solo
    // rearma un documento viejo si nadie lo tiene abierto (Doc_Deshacer.md, 3.2).
    this.offUnsupported = options.docs.subscribeUnsupported((pageId) => {
      const h = this.pages.get(pageId);
      if (h) this.drop(h, true);
    });
  }

  // --- El editor en pantalla -----------------------------------------------------------------------------------

  /**
   * El editor de `pageId` se montó (su vista ya existe, todavía no se escribió nada): toma las listas guardadas de esa
   * página. Devuelve cómo soltarlo (al desmontarse). Si el `UndoManager` ya tiene algo (no debería: montar no
   * escribe), lo guardado va debajo: nunca se pisa una lista que no esté vacía.
   */
  attach(pageId: string, doc: Y.Doc, um: UndoManager, info: AttachInfo = {}): () => void {
    if (this.disposed) return () => undefined;
    let h = this.pages.get(pageId);
    const detach = () => {
      const current = this.pages.get(pageId);
      if (current?.um === um) this.detachUm(current);
    };
    // El mismo editor que avisa otra vez que se montó: solo cambia lo que dio.
    if (h?.um === um && h.doc === doc) {
      h.info = info;
      return detach;
    }
    // Otro documento para la misma página (se rearmó): lo de antes ya no se puede deshacer.
    if (h && h.doc !== doc) {
      this.drop(h, true);
      h = undefined;
    }
    // El editor anterior de la misma página (se volvió a montar: cambió el permiso, el idioma) todavía no se fue: deja
    // de usar las listas, así lo que se escriba no entra dos veces.
    if (h?.um && h.um !== um) this.detachUm(h);
    if (!h) {
      h = { pageId, project: this.options.projectOf(pageId), doc, retained: false, um: null, info: null, undo: [], redo: [], offs: [] };
      this.pages.set(pageId, h);
    }
    for (const item of [...um.undoStack, ...um.redoStack]) if (!this.order.has(item)) this.order.set(item, ++this.counter);
    um.undoStack = um.undoStack.length > 0 ? [...h.undo, ...um.undoStack] : h.undo;
    um.redoStack = um.redoStack.length > 0 ? [...h.redo, ...um.redoStack] : h.redo;
    h.undo = [];
    h.redo = [];
    h.um = um;
    h.info = info;
    cleanMeta([...um.undoStack, ...um.redoStack], info.binding ?? null);
    // El filtro de borrado de y-prosemirror (sin envolver): el `UndoManager` de un momento del reemplazo usa el mismo.
    // Se toma del editor y no se importa y-prosemirror acá: este archivo va en la primera carga (firstLoad.test.ts).
    if (!isProtected(um)) this.editorFilter = um.deleteFilter;
    protectOthers(um);
    const page = h;
    const onAdded = (e: StackEvent) => this.onStackItem(page, um, e, true);
    const onUpdated = (e: StackEvent) => this.onStackItem(page, um, e, false);
    const onPopped = (e: StackEvent) => {
      for (const fn of [...poppedListeners]) fn(e.stackItem, e.type);
    };
    um.on('stack-item-added', onAdded as never);
    um.on('stack-item-updated', onUpdated as never);
    um.on('stack-item-popped', onPopped as never);
    h.offs = [
      () => um.off('stack-item-added', onAdded as never),
      () => um.off('stack-item-updated', onUpdated as never),
      () => um.off('stack-item-popped', onPopped as never),
    ];
    if (this.size(h) > 0) this.retain(h);
    return detach;
  }

  /** Si el paso de arriba guardó la selección de este editor (y-prosemirror la vuelve a poner al deshacerlo). */
  topRemembersCursor(pageId: string, kind: StepKind): boolean {
    const h = this.pages.get(pageId);
    if (!h?.um) return false;
    const stack = this.stack(h, kind);
    const binding = h.info?.binding;
    return !!binding && !!stack[stack.length - 1]?.meta.has(binding);
  }

  /** La página con el editor en pantalla (el último que se montó y sigue montado), o `null`. */
  activePage(): string | null {
    for (const h of this.pages.values()) if (h.um) return h.pageId;
    return null;
  }

  /** Lo que el editor en pantalla de `pageId` le dio al montarse, o `null` si no está montado. */
  mounted(pageId: string): AttachInfo | null {
    const h = this.pages.get(pageId);
    return h?.um ? h.info : null;
  }

  /** Si `el` está adentro del editor de una página montada (el ⌘Z con el foco ahí es de la línea de tiempo). */
  ownsElement(el: Element | null): boolean {
    if (!el) return false;
    for (const h of this.pages.values()) if (h.um && h.info?.dom?.contains(el)) return true;
    return false;
  }

  /**
   * Espera a que el editor de `pageId` esté montado y se pueda editar (después de ir a esa página), hasta `timeoutMs`.
   */
  whenAttached(pageId: string, timeoutMs: number): Promise<boolean> {
    const ready = () => {
      const h = this.pages.get(pageId);
      return !!h?.um && h.info?.editable?.() !== false;
    };
    if (ready()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (ready()) {
          clearInterval(timer);
          resolve(true);
        } else if (this.disposed || Date.now() - started > timeoutMs) {
          clearInterval(timer);
          resolve(false);
        }
      }, 25);
    });
  }

  // --- El orden -----------------------------------------------------------------------------------------------

  /**
   * El próximo paso para deshacer (o rehacer) en el proyecto: la página cuyo paso de arriba es el más nuevo, o la marca
   * de una página que perdió sus pasos (si es lo más nuevo). `null`: nada.
   */
  peek(project: string | null, kind: StepKind): NextStep {
    let best: NextStep = null;
    let bestSeq = -1;
    for (const h of this.pages.values()) {
      if (this.projectOfHistory(h) !== project) continue;
      const stack = this.stack(h, kind);
      const top = stack[stack.length - 1];
      // Arriba está el paso de un reemplazo: lo ofrece su entrada (lo de abajo es de antes).
      if (!top || this.tagged.has(top)) continue;
      const seq = this.order.get(top) ?? 0;
      if (seq > bestSeq) {
        bestSeq = seq;
        best = { kind: 'page', pageId: h.pageId };
      }
    }
    for (const entry of this.replaces.values()) {
      if (entry.where !== kind || entry.project !== project || entry.seq <= bestSeq) continue;
      bestSeq = entry.seq;
      best = { kind: 'replace', opId: entry.opId };
    }
    for (const entry of this.markups.values()) {
      if (entry.where !== kind || entry.seq <= bestSeq) continue;
      if ((this.options.projectOf(entry.pageId) ?? entry.project) !== project) continue;
      bestSeq = entry.seq;
      best = { kind: 'markup', id: entry.id, pageId: entry.pageId, fileId: entry.fileId };
    }
    if (kind === 'undo') {
      for (const mark of this.lost) {
        const markProject = mark.reason === 'limit' ? mark.project : (this.options.projectOf(mark.pageId) ?? mark.project);
        if (markProject !== project || mark.seq <= bestSeq) continue;
        bestSeq = mark.seq;
        best = { kind: 'lost', pageId: mark.pageId, reason: mark.reason };
      }
    }
    return best;
  }

  /** Saca la marca de pasos perdidos (ya se avisó): la de esa página, o la del tope en ese proyecto. */
  consumeLost(pageId: string, reason: LostReason = 'reloaded', project: string | null = null): void {
    this.lost = this.lost.filter((m) => (reason === 'limit' ? !(m.reason === 'limit' && m.project === project) : !(m.reason === 'reloaded' && m.pageId === pageId)));
  }

  /** Los topes (para el aviso). */
  limits(): { pages: number; steps: number } {
    return { pages: this.maxPages, steps: this.maxSteps };
  }

  /** Cuántos pasos para deshacer y rehacer tiene una página (para las pruebas y la memoria). */
  stepsOf(pageId: string): { undo: number; redo: number } {
    const h = this.pages.get(pageId);
    return h ? { undo: this.stack(h, 'undo').length, redo: this.stack(h, 'redo').length } : { undo: 0, redo: 0 };
  }

  /** Las páginas con pasos (o con su editor montado). */
  pageIds(): string[] {
    return [...this.pages.keys()];
  }

  /** Si la línea de tiempo retiene el documento de esa página. */
  retains(pageId: string): boolean {
    return this.pages.get(pageId)?.retained === true;
  }

  /**
   * Deshace (o rehace) el paso de arriba de `pageId`, que tiene que estar en pantalla y editable. **Un paso por vez**:
   * a Yjs se le pasa solo ese (los de abajo se sacan un momento), así un paso que ya no cambia nada no hace que Yjs siga
   * con otro de la misma página que no es el próximo del proyecto. Después se corta el tiempo: lo que se escriba
   * medio segundo después es otro paso (Yjs no corta después de rehacer).
   */
  step(pageId: string, kind: StepKind): StepResult {
    const h = this.pages.get(pageId);
    const um = h?.um;
    if (!h || !um) return 'notMounted';
    if (h.info?.editable?.() === false) return 'readOnly';
    const stack = kind === 'undo' ? um.undoStack : um.redoStack;
    if (stack.length === 0) return 'empty';
    const below = stack.splice(0, stack.length - 1);
    let result: StackItem | null = null;
    let failed = false;
    try {
      result = kind === 'undo' ? um.undo() : um.redo();
    } catch (err) {
      // B.22: con dos personas, Yjs a veces tira `TypeError` en `redoItem` (la copia del padre ya no está). El paso ya
      // salió de la pila; se descarta y se avisa como uno que no cambia nada.
      console.warn('Deshacer: Yjs no pudo deshacer un paso; se descarta.', err);
      failed = true;
    } finally {
      // Yjs no reemplaza la lista que está sacando (`clear` solo corre con una edición nueva).
      const now = kind === 'undo' ? um.undoStack : um.redoStack;
      now.unshift(...below);
      um.stopCapturing();
    }
    if (failed) return 'failed';
    return result ? 'done' : 'nothing';
  }

  /** Olvida todo lo de una página (se fue a la papelera, la borraron, ya no se puede editar). */
  forget(pageId: string): void {
    const h = this.pages.get(pageId);
    if (!h) return;
    this.forgetReplaceItems(pageId);
    this.discardMarkups(pageId);
    if (h.um) {
      h.um.undoStack.length = 0;
      h.um.redoStack.length = 0;
      this.release(h);
    } else this.drop(h, false);
  }

  /** Suelta todo (cerrar sesión, cambiar de workspace). */
  dispose(): void {
    if (this.disposed) return;
    for (const h of [...this.pages.values()]) this.drop(h, false);
    this.replaces.clear();
    this.markups.clear();
    this.lost = [];
    this.offUnsupported();
    this.disposed = true;
  }

  // --- El reemplazo del proyecto (entrega 2; Doc_Deshacer.md, 3.3) ----------------------------------------------
  //
  // Quien reemplaza (search/projectReplace.ts, `ReplaceHistory`) avisa cuándo empieza, escribe cada página por acá,
  // avisa cuándo termina, y para deshacer y rehacer pide el paso de cada página (`popReplace`) y después dónde quedó
  // (`settleReplace`). Lo que no tiene paso en una pila va por las anclas de su registro, que maneja quien reemplaza.

  /** Empieza a escribir un reemplazo: es algo nuevo, así que lo que había para rehacer en el proyecto se borra. */
  beginReplace(opId: string, project: string): void {
    if (this.disposed || this.replaces.has(opId)) return;
    this.clearRedoExcept(null, project);
    this.replaces.set(opId, { opId, project, where: 'pending', seq: 0, items: new Map(), pages: [], saved: null, mark: 0 });
  }

  /**
   * Escribe el reemplazo en una página: corre `write` (una sola vez, con el origen `origin`) y, si la página tiene
   * historia en la sesión, lo que escribe entra como un paso propio de su pila de Yjs (cortado antes y después: si no,
   * se pega a lo escrito medio segundo antes). Devuelve si entró en la pila.
   */
  writeReplace(pageId: string, doc: Y.Doc, opId: string, origin: symbol, write: () => void, as: 'new' | StepKind = 'new'): boolean {
    const entry = this.replaces.get(opId);
    const h = this.pages.get(pageId);
    // Sin editor en pantalla hace falta el filtro de un editor (siempre lo hay: los pasos de página salen de un editor).
    if (!entry || entry.where !== (as === 'new' ? 'pending' : as) || !h || h.doc !== doc || (!h.um && !this.editorFilter)) {
      write();
      return false;
    }
    // `undo` / `redo`: quien reemplaza deshace (o rehace) esta página por las anclas, en orden, y la página ahora tiene
    // historia. Lo que escribe entra en la pila como lo contrario (para rehacer, o para deshacer otra vez), igual que un
    // deshacer de Yjs: así lo que se rehaga después alrededor sigue a estas letras y no a las de antes (las anclas
    // escriben letras nuevas). Sin borrar nada para rehacer (Yjs no borra con `undoing` / `redoing`).
    const temp = !h.um;
    const um = h.um ?? tempManager(doc, this.editorFilter!);
    const target = () => (as === 'undo' ? um.redoStack : um.undoStack);
    const before = target().length;
    um.stopCapturing();
    um.trackedOrigins.add(origin);
    if (as === 'undo') um.undoing = true;
    if (as === 'redo') um.redoing = true;
    try {
      write();
    } finally {
      um.undoing = false;
      um.redoing = false;
      um.trackedOrigins.delete(origin);
      um.stopCapturing();
    }
    const stack = target();
    const item = stack.length > before ? stack[stack.length - 1] : null;
    if (temp) {
      um.undoStack = [];
      um.redoStack = [];
      um.destroy();
      if (item) {
        if (as === 'undo') h.redo.push(item);
        else h.undo.push(item);
        if (as === 'new') {
          // Algo nuevo en esta página: lo de rehacer de acá se va (en las demás lo borró `beginReplace`).
          h.redo = [];
          this.order.set(item, ++this.counter);
        }
        this.retain(h);
      }
    }
    if (!item) return false;
    this.tagged.set(item, entry);
    entry.items.set(pageId, item);
    if (as !== 'new') this.order.set(item, entry.seq);
    return true;
  }

  /** Terminó de escribir: entra en la línea de tiempo como un paso (sin nada escrito, `saved` es `null` y se va). */
  endReplace(opId: string, saved: unknown): void {
    const entry = this.replaces.get(opId);
    if (!entry || entry.where !== 'pending') return;
    if (saved === null || saved === undefined) {
      this.discard(entry);
      return;
    }
    entry.saved = saved;
    this.place(entry, 'undo', []);
    this.enforceLimits();
  }

  /**
   * Deshace (o rehace) el paso del reemplazo en esa página, aunque no sea el de arriba de su pila (fuera de orden: se
   * saca ese solo y los de arriba vuelven a su lugar). `keep`: lo contrario queda para rehacer (o deshacer); si no
   * (el *Undo* del panel cuando el reemplazo ya no es lo último, DH10), se descarta.
   */
  popReplace(pageId: string, doc: Y.Doc, opId: string, kind: StepKind, keep: boolean): ReplacePop {
    const entry = this.replaces.get(opId);
    const h = this.pages.get(pageId);
    const item = entry?.items.get(pageId);
    if (!entry || !h || h.doc !== doc || !item || (!h.um && !this.editorFilter)) return 'none';
    const list = this.stack(h, kind);
    const at = list.indexOf(item);
    if (at < 0) {
      entry.items.delete(pageId);
      return 'none';
    }
    entry.items.delete(pageId);
    this.tagged.delete(item);
    let result: StackItem | null = null;
    let failed = false;
    let inverse: StackItem | null = null;
    if (h.um) {
      const um = h.um;
      const own = kind === 'undo' ? um.undoStack : um.redoStack;
      const above = own.splice(at + 1);
      const below = own.splice(0, at);
      const otherBefore = (kind === 'undo' ? um.redoStack : um.undoStack).length;
      try {
        result = kind === 'undo' ? um.undo() : um.redo();
      } catch (err) {
        console.warn('Deshacer: Yjs no pudo deshacer un reemplazo en una página; se descarta.', err);
        failed = true;
      } finally {
        const now = kind === 'undo' ? um.undoStack : um.redoStack;
        // Yjs no reemplaza la lista que está sacando: queda vacía (o con el paso, si tiró antes de sacarlo).
        now.splice(0, now.length, ...below, ...above);
        um.stopCapturing();
      }
      const other = kind === 'undo' ? um.redoStack : um.undoStack;
      if (other.length > otherBefore) {
        inverse = other[other.length - 1];
        // Fuera de orden (o si Yjs tiró): lo contrario no queda en ninguna lista.
        if (!keep || failed) other.pop();
      }
    } else {
      const um = tempManager(h.doc, this.editorFilter!);
      list.splice(at, 1);
      if (kind === 'undo') um.undoStack = [item];
      else um.redoStack = [item];
      try {
        result = kind === 'undo' ? um.undo() : um.redo();
      } catch (err) {
        console.warn('Deshacer: Yjs no pudo deshacer un reemplazo en una página; se descarta.', err);
        failed = true;
      }
      inverse = (kind === 'undo' ? um.redoStack : um.undoStack)[0] ?? null;
      um.undoStack = [];
      um.redoStack = [];
      um.destroy();
      if (inverse && keep && !failed) (kind === 'undo' ? h.redo : h.undo).push(inverse);
    }
    if (inverse && keep && !failed) {
      this.tagged.set(inverse, entry);
      entry.items.set(pageId, inverse);
      this.order.set(inverse, entry.seq);
    }
    if (!h.um && this.size(h) === 0) this.drop(h, false);
    if (failed) return 'failed';
    return result ? 'done' : 'nothing';
  }

  /**
   * Terminó de deshacer (o rehacer) el reemplazo. Con `keep` (⌘Z en orden, o el *Undo* que es lo último), pasa a la otra
   * lista con las páginas hechas (`pages`); sin nada hecho, o sin `keep`, sale de la línea de tiempo. Lo que quedó de
   * él en la lista de donde venía (páginas que no se pudieron) sale de la pila: queda para *Undo the rest* del panel.
   */
  settleReplace(opId: string, kind: StepKind, pages: string[], keep: boolean): void {
    const entry = this.replaces.get(opId);
    if (!entry || entry.where === 'pending') return;
    // Si mientras se deshacía se escribió algo nuevo (auditoría de la entrega 2, O4), ya no queda para rehacer: algo
    // nuevo borra lo de rehacer, también lo que se estaba deshaciendo.
    if (kind === 'undo' && entry.mark !== this.newEdits) keep = false;
    for (const [pageId, item] of [...entry.items]) {
      const h = this.pages.get(pageId);
      const from = h ? this.stack(h, kind) : null;
      const at = from ? from.indexOf(item) : -1;
      if (at < 0) continue;
      from!.splice(at, 1);
      entry.items.delete(pageId);
      this.tagged.delete(item);
      if (h && !h.um && this.size(h) === 0) this.drop(h, false);
    }
    if (!keep || pages.length === 0) {
      this.discard(entry);
      return;
    }
    this.place(entry, kind === 'undo' ? 'redo' : 'undo', pages);
  }

  /** Empieza a deshacer (o rehacer) el reemplazo: anota cuántas veces hubo algo nuevo hasta ahora (ver `settleReplace`). */
  markReplace(opId: string): void {
    const entry = this.replaces.get(opId);
    if (entry) entry.mark = this.newEdits;
  }

  /** Si el próximo ⌘Z (o ⌘⇧Z) de su proyecto es este reemplazo. */
  replaceIsNext(opId: string, kind: StepKind): boolean {
    const entry = this.replaces.get(opId);
    if (!entry || entry.where !== kind) return false;
    const next = this.peek(entry.project, kind);
    return next?.kind === 'replace' && next.opId === opId;
  }

  /** Lo que guardó quien reemplaza (`endReplace`), o `null` si el reemplazo no está en la línea de tiempo. */
  replaceSaved(opId: string): unknown {
    return this.replaces.get(opId)?.saved ?? null;
  }

  /** Las páginas que se deshicieron (las que vuelve a escribir rehacer). */
  replacePages(opId: string): string[] {
    return [...(this.replaces.get(opId)?.pages ?? [])];
  }

  /** En qué lista está un reemplazo (para las pruebas). */
  replaceState(opId: string): 'pending' | StepKind | null {
    return this.replaces.get(opId)?.where ?? null;
  }

  // --- Anotar una foto (entrega 3; Doc_Deshacer.md, 3.1 y sección 19) -----------------------------------------
  //
  // El anotador (Annotator.tsx) avisa al cerrarse con lo que quedó en su pila: eso es UN paso de la página, en el orden
  // del proyecto. ⌘Z lo deshace entero (con la página en pantalla) y ⌘⇧Z lo rehace.

  /**
   * Se cerró el anotador de `fileId` en `pageId` con estos pasos (los de abajo primero): entran como un paso de la
   * página. Es algo nuevo: lo que había para rehacer en el proyecto se borra (también en esta página). Devuelve el id de
   * la entrada, o `null` si no entró (nada que deshacer, o el documento ya no es el de la página).
   */
  pushMarkup(pageId: string, map: Y.Map<unknown>, fileId: string, items: StackItem[]): string | null {
    if (this.disposed || items.length === 0 || !map.doc) return null;
    const doc = map.doc;
    let h = this.pages.get(pageId);
    // El documento de la página se rearmó mientras se anotaba: estos pasos ya no son de su documento.
    if (h && h.doc !== doc) return null;
    if (!h) {
      h = { pageId, project: this.options.projectOf(pageId), doc, retained: false, um: null, info: null, undo: [], redo: [], offs: [] };
      this.pages.set(pageId, h);
    }
    const id = `markup-${++this.markupCount}`;
    this.markups.set(id, { id, pageId, fileId, project: h.project, map, where: 'undo', seq: ++this.counter, items: [...items] });
    // Algo nuevo: lo de rehacer se va en todas las páginas del proyecto, también en esta (no lo borró ninguna pila).
    this.clearRedoExcept(null, this.projectOfHistory(h));
    this.retain(h);
    this.enforceLimits();
    return this.markups.has(id) ? id : null;
  }

  /**
   * Deshace (o rehace) TODO lo de esa vez en el anotador. La página tiene que estar en pantalla y editable (como `step`).
   * Con un `UndoManager` de un momento sobre el mapa, paso por paso hasta vaciar la lista (lo mismo que ⌘Z en el
   * anotador hasta el principio); lo contrario queda para rehacer (o deshacer otra vez). Si ya no cambia nada (otra
   * persona borró justo eso) o Yjs tira un error (B.22), la entrada sale.
   */
  stepMarkup(id: string, kind: StepKind): StepResult {
    const entry = this.markups.get(id);
    if (!entry || entry.where !== kind) return 'empty';
    const h = this.pages.get(entry.pageId);
    if (!h?.um) return 'notMounted';
    if (h.info?.editable?.() === false) return 'readOnly';
    if (entry.map.doc !== h.doc) {
      this.discardMarkup(entry);
      return 'nothing';
    }
    const um = markupManager(entry.map);
    if (kind === 'undo') um.undoStack = [...entry.items];
    else um.redoStack = [...entry.items];
    let changed = false;
    let failed = false;
    try {
      const left = () => (kind === 'undo' ? um.undoStack : um.redoStack).length;
      for (let guard = 0; left() > 0 && guard < 100_000; guard++) {
        if (popMarkupStep(um, kind)) changed = true;
      }
    } catch (err) {
      console.warn('Deshacer: Yjs no pudo deshacer lo anotado en una foto; se descarta.', err);
      failed = true;
    }
    const inverse = [...(kind === 'undo' ? um.redoStack : um.undoStack)];
    um.undoStack = [];
    um.redoStack = [];
    um.destroy();
    if (failed || !changed || inverse.length === 0) {
      this.discardMarkup(entry);
      return failed ? 'failed' : 'nothing';
    }
    entry.items = inverse;
    entry.where = kind === 'undo' ? 'redo' : 'undo';
    entry.seq = ++this.counter;
    return 'done';
  }

  /** En qué lista está lo anotado (para las pruebas), o `null` si ya no está en la línea de tiempo. */
  markupState(id: string): StepKind | null {
    return this.markups.get(id)?.where ?? null;
  }

  // --- Por dentro ---------------------------------------------------------------------------------------------

  /** Pone el reemplazo arriba de una lista (el más nuevo); sus pasos en las pilas toman su número. */
  private place(entry: ReplaceEntry, where: StepKind, pages: string[]): void {
    entry.where = where;
    entry.seq = ++this.counter;
    entry.pages = pages;
    for (const item of entry.items.values()) this.order.set(item, entry.seq);
  }

  /** Saca el reemplazo de la línea de tiempo, con sus pasos de las pilas. */
  private discard(entry: ReplaceEntry): void {
    if (this.replaces.get(entry.opId) !== entry) return;
    this.replaces.delete(entry.opId);
    for (const [pageId, item] of [...entry.items]) {
      this.tagged.delete(item);
      const h = this.pages.get(pageId);
      if (!h) continue;
      for (const kind of ['undo', 'redo'] as const) {
        const list = this.stack(h, kind);
        const at = list.indexOf(item);
        if (at >= 0) list.splice(at, 1);
      }
      if (!h.um && this.size(h) === 0) this.drop(h, false);
    }
    entry.items.clear();
  }

  private discardMarkup(entry: MarkupEntry): void {
    if (this.markups.get(entry.id) !== entry) return;
    this.markups.delete(entry.id);
    entry.items = [];
    const h = this.pages.get(entry.pageId);
    if (h && !h.um && this.size(h) === 0) this.drop(h, false);
  }

  /** Saca lo anotado de una página (sin soltarla: quien llama decide). */
  private discardMarkups(pageId: string): void {
    for (const entry of [...this.markups.values()]) {
      if (entry.pageId !== pageId) continue;
      this.markups.delete(entry.id);
      entry.items = [];
    }
  }

  /** Lo anotado de una página (de una lista, o de las dos). */
  private markupsOf(pageId: string, kind?: StepKind): MarkupEntry[] {
    const out: MarkupEntry[] = [];
    for (const entry of this.markups.values()) if (entry.pageId === pageId && (!kind || entry.where === kind)) out.push(entry);
    return out;
  }

  /** La página ya no está en la línea de tiempo (o se olvidaron sus pasos): los reemplazos van por las anclas ahí. */
  private forgetReplaceItems(pageId: string): void {
    for (const entry of this.replaces.values()) {
      const item = entry.items.get(pageId);
      if (!item) continue;
      entry.items.delete(pageId);
      this.tagged.delete(item);
    }
  }

  private projectOfHistory(h: PageHistory): string | null {
    return this.options.projectOf(h.pageId) ?? h.project;
  }

  private stack(h: PageHistory, kind: StepKind): StackItem[] {
    if (h.um) return kind === 'undo' ? h.um.undoStack : h.um.redoStack;
    return kind === 'undo' ? h.undo : h.redo;
  }

  /** Pasos de una página: los de sus pilas y lo anotado en sus fotos (que también la retiene). */
  private size(h: PageHistory): number {
    return this.stack(h, 'undo').length + this.stack(h, 'redo').length + this.markupsOf(h.pageId).length;
  }

  /** Un paso nuevo (o extendido) en la pila de una página montada. */
  private onStackItem(h: PageHistory, um: UndoManager, e: StackEvent, added: boolean): void {
    if (this.pages.get(h.pageId) !== h || h.um !== um) return;
    this.order.set(e.stackItem, ++this.counter);
    // Algo nuevo (ni deshacer ni rehacer): lo que había para rehacer se borra en todas las páginas del proyecto. Yjs ya
    // borró lo de esta pila. Escribir dentro del mismo paso (`stack-item-updated`) cuenta igual.
    if (e.type === 'undo' && !um.undoing && !um.redoing) this.clearRedoExcept(h);
    if (added) {
      this.retain(h);
      this.enforceLimits();
    }
  }

  private clearRedoExcept(h: PageHistory | null, project = h ? this.projectOfHistory(h) : null): void {
    this.newEdits++;
    // Los reemplazos para rehacer también (sus pasos en las pilas se van con ellas).
    for (const entry of [...this.replaces.values()]) if (entry.where === 'redo' && entry.project === project) this.discard(entry);
    // Lo anotado para rehacer, también.
    for (const entry of [...this.markups.values()]) {
      if (entry.where === 'redo' && (this.options.projectOf(entry.pageId) ?? entry.project) === project) this.discardMarkup(entry);
    }
    for (const other of [...this.pages.values()]) {
      if (other === h || this.projectOfHistory(other) !== project) continue;
      if (other.um) other.um.redoStack.length = 0;
      else other.redo = [];
      if (!other.um && this.size(other) === 0) this.drop(other, false);
    }
  }

  /** Retiene el documento (una referencia de `docs.open`, la misma que tiene el editor). */
  private retain(h: PageHistory): void {
    if (h.retained) return;
    h.retained = true;
    // `open` suma la referencia antes de su primer `await`: el documento no se puede destruir desde ahora.
    void this.options.docs.open(h.pageId).then(
      (doc) => {
        if (doc === h.doc) return;
        // No es el mismo documento (se rearmó en el medio): esta referencia no sirve y los pasos tampoco.
        this.options.docs.close(h.pageId);
        if (h.retained) {
          h.retained = false;
          if (this.pages.get(h.pageId) === h) this.drop(h, true);
        }
      },
      () => {
        // No se pudo cargar: la referencia que sumó `open` se devuelve.
        if (!h.retained) return;
        h.retained = false;
        this.options.docs.close(h.pageId);
      },
    );
  }

  private release(h: PageHistory): void {
    if (!h.retained) return;
    h.retained = false;
    this.options.docs.close(h.pageId);
  }

  /** El editor de la página se fue: sus listas quedan acá, sin la selección guardada con su clave. */
  private detachUm(h: PageHistory): void {
    const um = h.um;
    if (!um) return;
    for (const off of h.offs) off();
    h.offs = [];
    h.undo = um.undoStack;
    h.redo = um.redoStack;
    // El `UndoManager` que se va no se queda con las listas (si escribiera algo antes de destruirse, no entra acá).
    um.undoStack = [];
    um.redoStack = [];
    const binding = h.info?.binding ?? null;
    if (binding) for (const item of [...h.undo, ...h.redo]) item.meta.delete(binding);
    h.um = null;
    h.info = null;
    if (this.size(h) === 0) this.drop(h, false);
  }

  /** Saca la página de la línea de tiempo (y suelta su documento). `lost`: el próximo ⌘Z que llegue ahí lo avisa. */
  private drop(h: PageHistory, lost: boolean): void {
    if (this.pages.get(h.pageId) !== h) return;
    this.pages.delete(h.pageId);
    // Los reemplazos que tenían un paso acá siguen; en esta página van por las anclas.
    this.forgetReplaceItems(h.pageId);
    // Lo anotado sale con la página (sin su documento no se puede deshacer).
    const markupSeqs = this.markupsOf(h.pageId, 'undo').map((m) => m.seq);
    this.discardMarkups(h.pageId);
    if (lost) {
      const seq = Math.max(-1, ...this.stack(h, 'undo').map((i) => this.order.get(i) ?? 0), ...markupSeqs);
      if (seq >= 0) {
        this.lost = this.lost.filter((m) => !(m.reason === 'reloaded' && m.pageId === h.pageId)).slice(-(MAX_LOST - 1));
        this.lost.push({ pageId: h.pageId, project: this.projectOfHistory(h), seq, reason: 'reloaded' });
      }
    }
    for (const off of h.offs) off();
    h.offs = [];
    if (h.um) {
      // Un editor todavía montado sobre un documento que se va a rearmar: sigue con listas propias, que nadie mira.
      h.um.undoStack = [];
      h.um.redoStack = [];
      h.um = null;
    }
    h.undo = [];
    h.redo = [];
    this.release(h);
  }

  /** Topes: pasos en total y páginas con pasos. Lo más viejo se olvida (un reemplazo, entero). */
  private enforceLimits(): void {
    const total = () => {
      let n = 0;
      for (const h of this.pages.values()) n += this.size(h);
      for (const entry of this.replaces.values()) if (entry.where !== 'pending') n++;
      return n;
    };
    for (let left = total(), guard = 0; left > this.maxSteps && guard < 100_000; left = total(), guard++) {
      // El paso más viejo es el de abajo de alguna lista, o un reemplazo.
      let oldest: { h: PageHistory; kind: StepKind; seq: number } | null = null;
      let oldestEntry: ReplaceEntry | null = null;
      let oldestSeq = Infinity;
      for (const h of this.pages.values()) {
        for (const kind of ['undo', 'redo'] as const) {
          const first = this.stack(h, kind)[0];
          if (!first) continue;
          const seq = this.order.get(first) ?? 0;
          if (seq < oldestSeq) {
            oldestSeq = seq;
            oldest = { h, kind, seq };
            oldestEntry = this.tagged.get(first) ?? null;
          }
        }
      }
      for (const entry of this.replaces.values()) {
        if (entry.where !== 'pending' && entry.seq < oldestSeq) {
          oldestSeq = entry.seq;
          oldest = null;
          oldestEntry = entry;
        }
      }
      let oldestMarkup: MarkupEntry | null = null;
      for (const entry of this.markups.values()) {
        if (entry.seq < oldestSeq) {
          oldestSeq = entry.seq;
          oldest = null;
          oldestEntry = null;
          oldestMarkup = entry;
        }
      }
      if (oldestMarkup) {
        if (oldestMarkup.where === 'undo') this.markLimitIn(this.options.projectOf(oldestMarkup.pageId) ?? oldestMarkup.project, oldestMarkup.seq);
        this.discardMarkup(oldestMarkup);
        continue;
      }
      if (oldestEntry) {
        // Un reemplazo a medio escribir no se olvida (se cuenta al terminar).
        if (oldestEntry.where === 'pending') break;
        if (oldestEntry.where === 'undo') this.markLimitIn(oldestEntry.project, oldestEntry.seq);
        this.discard(oldestEntry);
        continue;
      }
      if (!oldest) break;
      if (oldest.kind === 'undo') this.markLimit(oldest.h, oldest.seq);
      this.stack(oldest.h, oldest.kind).shift();
      if (!oldest.h.um && this.size(oldest.h) === 0) this.drop(oldest.h, false);
    }
    const withSteps = [...this.pages.values()].filter((h) => this.size(h) > 0);
    let extra = withSteps.length - this.maxPages;
    if (extra <= 0) return;
    // Las páginas cuyo paso más nuevo es el más viejo; nunca la que está en pantalla.
    const seqs = (h: PageHistory, kinds: StepKind[]) => [
      ...kinds.flatMap((kind) => this.stack(h, kind).map((i) => this.order.get(i) ?? 0)),
      ...this.markupsOf(h.pageId).filter((m) => kinds.includes(m.where)).map((m) => m.seq),
    ];
    const newest = (h: PageHistory) => Math.max(0, ...seqs(h, ['undo', 'redo']));
    const candidates = withSteps.filter((h) => !h.um).sort((a, b) => newest(a) - newest(b));
    for (const h of candidates) {
      if (extra <= 0) break;
      const seq = Math.max(-1, ...seqs(h, ['undo']));
      if (seq >= 0) this.markLimit(h, seq);
      this.drop(h, false);
      extra--;
    }
  }

  /** Lo que olvida el tope se avisa cuando ⌘Z llega ahí (auditoría de la entrega 1, O3): una marca por proyecto. */
  private markLimit(h: PageHistory, seq: number): void {
    this.markLimitIn(this.projectOfHistory(h), seq);
  }

  private markLimitIn(project: string | null, seq: number): void {
    const prev = this.lost.find((m) => m.reason === 'limit' && m.project === project);
    if (prev) prev.seq = Math.max(prev.seq, seq);
    else this.lost.push({ pageId: '', project, seq, reason: 'limit' });
  }
}

// --- Nunca pisar lo ajeno adentro de un bloque propio (auditoría de la entrega 1, B1) --------------------------------
//
// El filtro de borrado de y-prosemirror protege los `paragraph` con contenido, no el `blockContainer` de BlockNote. Al
// deshacer la creación de un renglón (Enter y escribir), Yjs borraba el `blockContainer`, que es tuyo, y con él lo que
// otra persona había escrito adentro. Ahora no se borra un elemento que tiene adentro algo vivo de otro autor: lo tuyo
// de adentro se va (son sus propios items del paso) y lo del otro queda en su renglón, con el bloque y sus atributos.
// Si Yjs le cambió el autor al documento abierto (B.16), un renglón tuyo con texto tuyo posterior puede quedar: sobra
// un renglón, nunca falta nada.

interface ItemLike {
  id: { client: number };
  deleted: boolean;
  right: ItemLike | null;
  content: { type?: { _start?: ItemLike | null } };
}

/** Si adentro del tipo de `item` (recorriendo todo lo de abajo) hay algo vivo de un autor que no es el de `item`. */
export function hasOthersInside(item: ItemLike, client = item.id.client): boolean {
  let child = item.content?.type?._start ?? null;
  while (child) {
    if (!child.deleted) {
      if (child.id.client !== client) return true;
      if (hasOthersInside(child, client)) return true;
    }
    child = child.right;
  }
  return false;
}

/**
 * Un `UndoManager` de un momento sobre el contenido de una página sin editor en pantalla (escribir, deshacer o rehacer
 * el paso de un reemplazo), con las mismas opciones que el de y-prosemirror: su filtro de borrado (protege los párrafos
 * y la marca de huecos estables; la línea de tiempo lo toma del editor), lo de fondo afuera, y lo ajeno protegido como
 * en el del editor (B1). Riesgo 2 del diseño: una prueba lo compara con el del editor.
 */
export function tempManager(doc: Y.Doc, deleteFilter: UndoManager['deleteFilter']): UndoManager {
  const um = new Y.UndoManager(doc.getXmlFragment(CONTENT_FRAGMENT), {
    trackedOrigins: new Set(),
    deleteFilter,
    captureTransaction: (tr) => tr.meta.get('addToHistory') !== false,
  });
  protectOthers(um);
  return um;
}

// --- Anotaciones: nunca llevarse lo de otro (entrega 3) ---------------------------------------------------------------
//
// El mapa de las anotaciones (media/markup.ts) tiene una clave por forma (`<fileId>/<shapeId>`, un `Y.Map` con un campo
// por propiedad) y una por el marco de la foto (`<fileId>`, `{ v, w, h }`). Deshacer sigue solo el origen de la foto
// (lo de otro no está en sus pasos), y Yjs no vuelve a poner un campo que otro cambió después. Lo que faltaba: borrar
// algo tuyo que tiene adentro lo de otro. Al deshacer la forma que creaste, si otra persona la movió o le cambió el
// color, Yjs borraba la forma entera con su cambio; y al deshacer la primera anotación de una foto, el marco (que
// escribiste vos) se iba aunque otra persona hubiera dibujado con él, y sus formas quedaban sin marco. Ahora:
//   - una forma con un campo vivo de otro autor no se borra, ni sus campos si la forma se creó en ese mismo paso (si
//     no, quedaría una forma a medias); tus cambios a una forma que ya existía se deshacen igual;
//   - el marco de una foto con formas vivas de otro autor no se borra.
// Para saber qué creó el paso, se deshace de a un paso por vez (`popMarkupStep`), con el paso a mano.

interface MapItemLike {
  id: { client: number; clock: number };
  deleted: boolean;
  parentSub: string | null;
  parent: unknown;
  content: { type?: { _map?: Map<string, MapItemLike> } };
}

/** El paso que está deshaciendo (o rehaciendo) cada `UndoManager` de anotaciones. */
const markupStepOf = new WeakMap<UndoManager, StackItem>();

/** Si en el `Y.Map` de `item` hay algún campo vivo de un autor que no es el de `item`. */
function mapHasOthers(item: MapItemLike): boolean {
  const fields = item.content?.type?._map;
  if (!fields) return false;
  for (const field of fields.values()) if (!field.deleted && field.id.client !== item.id.client) return true;
  return false;
}

/** Envuelve el filtro de borrado de un `UndoManager` sobre el mapa de anotaciones `map` (ver arriba). Una vez. */
export function protectMarkupOthers(um: UndoManager, map: Y.Map<unknown>): void {
  if (protectedManagers.has(um)) return;
  protectedManagers.add(um);
  const previous = um.deleteFilter;
  const root = map as unknown as { _map: Map<string, MapItemLike> };
  um.deleteFilter = (raw) => {
    if (!previous(raw)) return false;
    const item = raw as unknown as MapItemLike;
    if (item.parent === map && item.parentSub !== null) {
      if (item.parentSub.includes('/')) return !mapHasOthers(item);
      // El marco de una foto: queda si hay formas vivas de otro autor de esa foto.
      const prefix = `${item.parentSub}/`;
      for (const [key, shape] of root._map) if (!shape.deleted && shape.id.client !== item.id.client && key.startsWith(prefix)) return false;
      return true;
    }
    // Un campo de una forma que este mismo paso creó y que queda por lo del otro: queda también.
    const owner = item.parentSub !== null ? (item.parent as { _item?: MapItemLike | null } | null)?._item : null;
    if (!owner || owner.deleted || owner.parent !== map || !mapHasOthers(owner)) return true;
    const step = markupStepOf.get(um);
    return !(step && Y.isDeleted(step.insertions, owner.id as Y.ID));
  };
}

/**
 * Deshace (o rehace) el paso de arriba de un `UndoManager` de anotaciones, de a uno (así el filtro sabe qué creó ese
 * paso); si no cambia nada, sigue con el anterior, como Yjs. Devuelve el paso, o `null` si no cambió nada.
 */
export function popMarkupStep(um: UndoManager, kind: StepKind): StackItem | null {
  for (let guard = 0; guard < 100_000; guard++) {
    const stack = kind === 'undo' ? um.undoStack : um.redoStack;
    if (stack.length === 0) return null;
    const below = stack.splice(0, stack.length - 1);
    markupStepOf.set(um, stack[0]);
    let result: StackItem | null = null;
    try {
      result = kind === 'undo' ? um.undo() : um.redo();
    } finally {
      markupStepOf.delete(um);
      (kind === 'undo' ? um.undoStack : um.redoStack).unshift(...below);
    }
    if (result) return result;
  }
  return null;
}

/**
 * Un `UndoManager` de un momento sobre el mapa de anotaciones, con las mismas opciones que el del anotador (sin juntar
 * pasos, el filtro de siempre) y lo ajeno protegido.
 */
export function markupManager(map: Y.Map<unknown>): UndoManager {
  const um = new Y.UndoManager(map, { trackedOrigins: new Set(), captureTimeout: 0 });
  protectMarkupOthers(um, map);
  return um;
}

const protectedManagers = new WeakSet<UndoManager>();

const isProtected = (um: UndoManager) => protectedManagers.has(um);

/** Envuelve el filtro de borrado del `UndoManager` (una vez): lo de siempre y, además, nada con lo de otro adentro. */
function protectOthers(um: UndoManager): void {
  if (protectedManagers.has(um)) return;
  protectedManagers.add(um);
  const previous = um.deleteFilter;
  um.deleteFilter = (item) => {
    if (!previous(item)) return false;
    const it = item as unknown as ItemLike & { parentSub: string | null; parent: { _item?: ItemLike | null } | null };
    if (hasOthersInside(it)) return false;
    // Un atributo (el `id` del bloque, su tipo de párrafo) de un elemento que queda por lo del otro: queda también. Sin
    // él, el bloque quedaría sin `id` y el editor le pondría uno nuevo, una edición que borra lo que había para rehacer.
    const owner = it.parentSub !== null ? it.parent?._item : null;
    return !(owner && !owner.deleted && hasOthersInside(owner));
  };
}

/** Saca de cada paso la selección guardada por editores que ya no están (todo *binding* que no sea `keep`). */
function cleanMeta(items: StackItem[], keep: object | null): void {
  for (const item of items) {
    for (const key of [...item.meta.keys()]) if (key !== keep && isBinding(key)) item.meta.delete(key);
  }
}

const timelines = new WeakMap<object, UndoTimeline>();

/** La línea de tiempo de una instancia de servicios (una por pestaña y workspace). */
export function undoTimelineFor(services: {
  docs: TimelineDocs;
  tree: { get(id: string): { workspace_id: string } | undefined };
}): UndoTimeline {
  let timeline = timelines.get(services.docs);
  if (!timeline) {
    timeline = new UndoTimeline({ docs: services.docs, projectOf: (id) => services.tree.get(id)?.workspace_id ?? null });
    timelines.set(services.docs, timeline);
  }
  return timeline;
}

/** Suelta la línea de tiempo de una instancia de servicios (cerrar sesión, cambiar de workspace). */
export function disposeUndoTimeline(services: { docs: TimelineDocs }): void {
  timelines.get(services.docs)?.dispose();
  timelines.delete(services.docs);
}

// --- Quién corre ⌘Z y ⌘⇧Z ---------------------------------------------------------------------------------------
//
// El deshacer del navegador sobre el editor (`historyUndo`, el menú Edición, el gesto de iOS) llega a undoGuard.ts, en
// el editor; la app (Workspace.tsx) anota acá quién lo corre. Sin nadie anotado (la página de práctica, pruebas), el
// editor deshace como siempre.

type Runner = (kind: StepKind, el: Element | null) => boolean;
let runner: Runner | null = null;

export function setUndoRunner(fn: Runner | null): () => void {
  runner = fn;
  return () => {
    if (runner === fn) runner = null;
  };
}

/** Corre ⌘Z / ⌘⇧Z por la línea de tiempo si el editor de `el` es de ella; si no, `false` (que lo haga el editor). */
export function runUndoFrom(kind: StepKind, el: Element | null): boolean {
  return runner ? runner(kind, el) : false;
}
