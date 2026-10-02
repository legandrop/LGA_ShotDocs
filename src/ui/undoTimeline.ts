import type * as Y from 'yjs';

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

/** Pasos de una página que se perdieron (su documento se rearmó): el próximo ⌘Z que llegue ahí lo avisa. */
interface LostMark {
  pageId: string;
  project: string | null;
  seq: number;
}

export type NextStep = { kind: 'page'; pageId: string } | { kind: 'lost'; pageId: string } | null;

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
      if (!top) continue;
      const seq = this.order.get(top) ?? 0;
      if (seq > bestSeq) {
        bestSeq = seq;
        best = { kind: 'page', pageId: h.pageId };
      }
    }
    if (kind === 'undo') {
      for (const mark of this.lost) {
        if ((this.options.projectOf(mark.pageId) ?? mark.project) !== project || mark.seq <= bestSeq) continue;
        bestSeq = mark.seq;
        best = { kind: 'lost', pageId: mark.pageId };
      }
    }
    return best;
  }

  /** Saca la marca de pasos perdidos de esa página (ya se avisó). */
  consumeLost(pageId: string): void {
    this.lost = this.lost.filter((m) => m.pageId !== pageId);
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
    this.lost = [];
    this.offUnsupported();
    this.disposed = true;
  }

  // --- Por dentro ---------------------------------------------------------------------------------------------

  private projectOfHistory(h: PageHistory): string | null {
    return this.options.projectOf(h.pageId) ?? h.project;
  }

  private stack(h: PageHistory, kind: StepKind): StackItem[] {
    if (h.um) return kind === 'undo' ? h.um.undoStack : h.um.redoStack;
    return kind === 'undo' ? h.undo : h.redo;
  }

  private size(h: PageHistory): number {
    return this.stack(h, 'undo').length + this.stack(h, 'redo').length;
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

  private clearRedoExcept(h: PageHistory): void {
    const project = this.projectOfHistory(h);
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
    if (lost) {
      const seq = Math.max(-1, ...this.stack(h, 'undo').map((i) => this.order.get(i) ?? 0));
      if (seq >= 0) {
        this.lost = this.lost.filter((m) => m.pageId !== h.pageId).slice(-(MAX_LOST - 1));
        this.lost.push({ pageId: h.pageId, project: this.projectOfHistory(h), seq });
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

  /** Topes: pasos en total y páginas con pasos. Lo más viejo se olvida. */
  private enforceLimits(): void {
    let total = 0;
    for (const h of this.pages.values()) total += this.size(h);
    while (total > this.maxSteps) {
      // El paso más viejo es el de abajo de alguna lista.
      let oldest: { h: PageHistory; kind: StepKind; seq: number } | null = null;
      for (const h of this.pages.values()) {
        for (const kind of ['undo', 'redo'] as const) {
          const first = this.stack(h, kind)[0];
          if (!first) continue;
          const seq = this.order.get(first) ?? 0;
          if (!oldest || seq < oldest.seq) oldest = { h, kind, seq };
        }
      }
      if (!oldest) break;
      this.stack(oldest.h, oldest.kind).shift();
      total--;
      if (!oldest.h.um && this.size(oldest.h) === 0) this.drop(oldest.h, false);
    }
    const withSteps = [...this.pages.values()].filter((h) => this.size(h) > 0);
    let extra = withSteps.length - this.maxPages;
    if (extra <= 0) return;
    // Las páginas cuyo paso más nuevo es el más viejo; nunca la que está en pantalla.
    const newest = (h: PageHistory) => Math.max(0, ...[...this.stack(h, 'undo'), ...this.stack(h, 'redo')].map((i) => this.order.get(i) ?? 0));
    const candidates = withSteps.filter((h) => !h.um).sort((a, b) => newest(a) - newest(b));
    for (const h of candidates) {
      if (extra <= 0) break;
      this.drop(h, false);
      extra--;
    }
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

const protectedManagers = new WeakSet<UndoManager>();

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
