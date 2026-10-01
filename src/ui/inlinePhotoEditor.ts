import { createExtension } from '@blocknote/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { photoKey } from './carreteModel';
import { groupRows } from './imageRows';
import { PHOTO, photoWidth } from './inlinePhoto';
import { onlyPhotosSelected, selectedPhotos } from './inlinePhotoSize';

// Lo que acompaña a la foto en línea en el editor (Docs/Doc_Fotos_En_Linea.md, entrega 1b): las filas, la marca
// de las fotos que abarca una selección de texto, y el teclado y el mouse con una foto elegida. Lo midió el
// prototipo de la entrega 0 en un navegador real; nada de esto cambia el documento (solo decoraciones y
// selecciones), salvo la tecla que sigue su camino después de mover el cursor.

// --- Filas ----------------------------------------------------------------------------------------------
//
// `w` significa lo mismo que `rowWidth` de las fotos-bloque (imageRows.ts). Las filas lógicas salen de
// `groupRows` sobre cada tanda de fotos SEGUIDAS del texto de un bloque (cualquier texto en el medio, también un
// espacio, corta la tanda; una foto con `w = 0` también). A cada foto con ancho propio la decoración le pone:
//   - `sd-photo-sized` y `--row-n` (cuántas hay en su fila): el CSS le da `w · (100% − (n − 1) · g − 1px)`;
//   - `sd-photo-row-first` a la primera de la fila (las demás llevan el espacio `g` a la izquierda);
//   - `sd-photo-row-break` y `--row-rest` a la última de una fila que NO llena el renglón y a la que le sigue
//     otra foto con ancho: un margen derecho que completa el renglón, así el navegador corta donde corta
//     `groupRows` (sin él, la primera de la fila siguiente entra arriba: medido, en todos los anchos).
// El navegador hace el corte de renglón; con estas medidas coincide con las filas (0 filas rotas en 831 anchos
// por 5 densidades de pantalla, en el prototipo).
//   - `sd-photo-row-start` (entrega 2): una fila LLENA que viene justo después de un texto del mismo renglón empieza
//     en un renglón nuevo (una marca que no es parte del documento). Sin ella, las primeras fotos de la fila
//     quedaban al lado del texto y la última bajaba sola (medido en Chromium al pegar tres al final de un texto, y
//     al acomodar fotos que siguen a un texto). Una fila que no llena sigue fluyendo al lado del texto.

/** La parte del ancho de una foto en línea (0: sin ancho propio, o no es una foto). */
function fractionOf(node: PMNode): number {
  return node.type.name === PHOTO ? photoWidth(node.attrs.w) : 0;
}

export interface PhotoRow {
  /** La posición de cada foto de la fila en el documento. */
  positions: number[];
  fracs: number[];
}

/** Las filas lógicas del texto de un bloque (`pos`: dónde empieza ese nodo de texto en el documento). */
export function rowsOfTextblock(block: PMNode, pos: number): PhotoRow[] {
  const out: PhotoRow[] = [];
  let run: { pos: number; f: number }[] = [];
  const flush = () => {
    if (run.length) {
      const fracs = run.map((r) => r.f);
      for (const row of groupRows(fracs)) out.push({ positions: row.map((i) => run[i].pos), fracs: row.map((i) => fracs[i]) });
    }
    run = [];
  };
  block.forEach((child, offset) => {
    if (child.type.name === PHOTO) {
      // Una foto que empieza fila (`rowStart`, "Arrange in rows" de las elegidas) corta la tanda.
      if (child.attrs.rowStart === true) flush();
      run.push({ pos: pos + 1 + offset, f: fractionOf(child) });
    } else flush();
  });
  flush();
  return out;
}

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** Lo que hay justo antes de la foto en `pos` es texto (o un contenido en línea que no es un salto de renglón). */
function afterText(doc: PMNode, pos: number): boolean {
  const before = doc.resolve(pos).nodeBefore;
  return !!before && before.type.name !== PHOTO && before.type.name !== 'hardBreak';
}

/** La marca que hace empezar una fila llena en un renglón nuevo (styles.css, `.sd-photo-row-start`). */
function rowStart(): HTMLElement {
  const el = document.createElement('span');
  el.className = 'sd-photo-row-start';
  return el;
}

/** Las decoraciones de las filas de todo el documento. */
export function decorateRows(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    for (const row of rowsOfTextblock(node, pos)) {
      const n = row.positions.length;
      const sum = row.fracs.reduce((s, f) => s + f, 0);
      const full = sum > 1 - 1e-3;
      // Después del cursor (`side: 1`): con el cursor al final del texto, lo que se escribe va al texto (antes de la
      // marca, el navegador lo ponía después de la primera foto: medido en Chromium).
      if (full && afterText(doc, row.positions[0])) {
        decorations.push(Decoration.widget(row.positions[0], rowStart, { side: 1, key: 'sd-photo-row-start', marks: [] }));
      }
      row.positions.forEach((at, k) => {
        const classes = ['sd-photo-sized'];
        let style = `--row-n: ${n}`;
        if (k === 0) classes.push('sd-photo-row-first');
        if (k === n - 1 && !full) {
          const next = doc.nodeAt(at + 1);
          if (next && fractionOf(next) > 0) {
            classes.push('sd-photo-row-break');
            style += `; --row-rest: ${round4(1 - sum)}`;
          }
        }
        decorations.push(Decoration.node(at, at + 1, { class: classes.join(' '), style }));
      });
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

const rowsKey = new PluginKey<DecorationSet>('shotdocs-photo-rows');

const rowsPlugin = new Plugin<DecorationSet>({
  key: rowsKey,
  state: {
    init: (_, state) => decorateRows(state.doc),
    apply: (tr, old) => (tr.docChanged ? decorateRows(tr.doc) : old),
  },
  props: { decorations: (state) => rowsKey.getState(state) },
});

// --- Las fotos que abarca una selección de texto -----------------------------------------------------------
//
// Una selección de texto que abarca fotos (Shift+flechas, Shift+clic, arrastrar) no se ve sobre ellas: el
// navegador pinta el fondo del texto, no las imágenes. Sin esta marca, una selección de solo fotos no se ve.

export const IN_RANGE_CLASS = 'sd-photo-in-range';

export function decorateRange(state: EditorState): DecorationSet | null {
  const sel = state.selection;
  if (sel.empty || sel instanceof NodeSelection) return null;
  const decorations: Decoration[] = [];
  for (const range of sel.ranges) {
    const from = range.$from.pos;
    const to = range.$to.pos;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name === PHOTO && pos >= from && pos + node.nodeSize <= to) {
        decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: IN_RANGE_CLASS }));
      }
      return true;
    });
  }
  return decorations.length ? DecorationSet.create(state.doc, decorations) : null;
}

const rangePlugin = new Plugin({
  key: new PluginKey('shotdocs-photo-range'),
  props: { decorations: decorateRange },
});

// --- Qué foto es (bloque más lugar) -----------------------------------------------------------------------

/**
 * La clave de la foto en línea que está en `pos` (la del carrete, `CarreteItem.key`): el id de su bloque más
 * su lugar entre las fotos en línea del texto de ese bloque (dos fotos de un párrafo comparten el id). `null` si
 * en `pos` no hay una foto en línea dentro de un bloque.
 */
export function photoKeyAtPos(doc: PMNode, pos: number): string | null {
  const node = doc.nodeAt(pos);
  if (!node || node.type.name !== PHOTO) return null;
  const $pos = doc.resolve(pos);
  for (let d = $pos.depth; d > 0; d--) {
    const container = $pos.node(d);
    if (container.type.name !== 'blockContainer') continue;
    const content = container.firstChild;
    if (!content) return null;
    const start = $pos.before(d) + 2;
    let at = 0;
    content.descendants((child, offset) => {
      if (child.type.name === PHOTO && start + offset < pos) at++;
      return true;
    });
    return photoKey(String(container.attrs.id ?? ''), at);
  }
  return null;
}

/**
 * La foto que abre la barra espaciadora: la elegida (`selectedPhotoKey`) o, con varias fotos en línea elegidas, la
 * primera.
 */
export function spacePhotoKey(state: EditorState): string | null {
  const key = selectedPhotoKey(state);
  if (key) return key;
  const range = photosRange(state);
  return range ? (selectedPhotos(state).map((p) => photoKeyAtPos(state.doc, p)).find((k) => k !== null) ?? null) : null;
}

/** La foto elegida (selección de nodo): la clave de un bloque `image` (su id) o de una foto en línea; o `null`. */
export function selectedPhotoKey(state: EditorState): string | null {
  const sel = state.selection;
  if (!(sel instanceof NodeSelection)) return null;
  if (sel.node.type.name === PHOTO) return photoKeyAtPos(state.doc, sel.from);
  if (sel.node.type.name !== 'image') return null;
  const $pos = state.doc.resolve(sel.from);
  const container = $pos.parent;
  return container.type.name === 'blockContainer' ? String(container.attrs.id ?? '') || null : null;
}

// --- Teclado y mouse ------------------------------------------------------------------------------------
//
// Con una foto en línea elegida (selección de nodo), `nodeSelectionKeyboard` de BlockNote traga las letras y con
// Enter mete un párrafo adentro del bloque (queda como hijo, con sangría). Este manejo corre ANTES
// (`runsBefore`): pasa la selección a un cursor a la derecha de la foto y deja seguir la tecla, así la letra se
// escribe después de la foto (no la reemplaza) y Enter parte el renglón ahí, como con el cursor puesto a mano.
// La barra espaciadora la toma antes PageEditor.tsx: abre el carrete, como con una foto-bloque elegida; si no
// puede abrirlo, sigue como una letra. ← → Backspace Supr Inicio Fin: los de ProseMirror (← y → pasan de a
// una: el primer toque elige la foto).

const selectedPhoto = (state: EditorState): NodeSelection | null => {
  const sel = state.selection;
  return sel instanceof NodeSelection && sel.node.type.name === PHOTO ? sel : null;
};

/** La tecla abre una composición (tilde muerta de la Mac: `Dead`; IME: `Process` o el código 229). */
export const startsComposition = (e: Pick<KeyboardEvent, 'key' | 'keyCode'>): boolean =>
  e.key === 'Dead' || e.key === 'Process' || e.keyCode === 229;

/**
 * La tecla escribe un carácter: una sola letra, sin ⌘ y sin Ctrl (Ctrl+letra es un atajo). Ctrl+Alt es AltGr en
 * Windows, que escribe "@" o "€" (otro carácter que el de la tecla), o un atajo de la página como Ctrl+Alt+M
 * (comentar) o Ctrl+Alt+1 (título), que da la letra o el número de la tecla misma: ese no mueve el cursor (la foto
 * sigue elegida, medido en Chromium).
 */
export const typesCharacter = (e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey'>): boolean => {
  if (e.key.length !== 1 || e.metaKey) return false;
  if (!e.ctrlKey) return true;
  return e.altKey && !keyOfItsOwn(e.key, e.code ?? '');
};

/** La tecla da su propia letra o número (`m` en `KeyM`, `1` en `Digit1`): con Ctrl+Alt, es un atajo, no AltGr. */
const keyOfItsOwn = (key: string, code: string): boolean =>
  (/^Key[A-Z]$/.test(code) && key.toLowerCase() === code.slice(3).toLowerCase()) || (/^Digit\d$/.test(code) && key === code.slice(5));

/** El cursor a la derecha de la foto elegida. */
function caretAfter(view: EditorView, sel: NodeSelection): void {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, sel.to)));
}

export function handlePhotoKey(view: EditorView, event: KeyboardEvent): boolean {
  if (!view.editable) return false;
  const range = photosRange(view.state);
  if (range) return handlePhotosRangeKey(view, range, event);
  const sel = selectedPhoto(view.state);
  if (!sel) return false;
  // La composición empieza con el cursor ya a la derecha (hacerlo recién en `compositionstart` corta la
  // composición entre dos fotos: queda duplicado el primer carácter, medido).
  if (startsComposition(event)) {
    caretAfter(view, sel);
    return false;
  }
  if (event.isComposing) return false;
  // Shift+flecha: la selección de nodo pasa a ser una de texto que abarca la foto (el ancla del lado contrario
  // al que se va) y la tecla sigue, así se extiende desde ahí. Sin esto, ProseMirror deja un cursor al lado de la
  // foto y no elige nada.
  if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && /^Arrow(Left|Right|Up|Down)$/.test(event.key)) {
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const [anchor, head] = forward ? [sel.from, sel.to] : [sel.to, sel.from];
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)));
    // ← y →: la foto ya quedó abarcada (es el paso de una letra); ↑ y ↓ siguen extendiendo.
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      return true;
    }
    return false;
  }
  const enter = event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
  if (!enter && !typesCharacter(event)) return false;
  caretAfter(view, sel);
  return false;
}

/**
 * Shift+clic EN una foto en línea. Con Shift, ProseMirror deja el clic al navegador, que sobre un elemento que no
 * se edita no hace nada. Acá pasa a ser una selección de texto desde el ancla (o desde la foto que estaba
 * elegida) hasta el borde lejano de la foto del clic, así abarca las dos y lo del medio. Shift+clic en un texto
 * con una foto elegida: la foto pasa a ser el principio de la selección (si no, el navegador extiende desde su
 * borde y la deja afuera) y el clic sigue.
 */
export function handlePhotoShiftClick(view: EditorView, event: MouseEvent): boolean {
  if (!event.shiftKey || event.button !== 0 || !view.editable) return false;
  const el = (event.target as Element | null)?.closest?.('.sd-photo');
  if (!el || !view.dom.contains(el)) {
    const chosen = selectedPhoto(view.state);
    const at = chosen ? view.posAtCoords({ left: event.clientX, top: event.clientY }) : null;
    if (chosen && at) {
      const [anchor, head] = at.pos <= chosen.from ? [chosen.to, chosen.from] : [chosen.from, chosen.to];
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)));
    }
    return false;
  }
  const nodePos = view.posAtDOM(el, 0);
  const node = view.state.doc.nodeAt(nodePos);
  if (!node || node.type.name !== PHOTO) return false;
  const sel = view.state.selection;
  const anchor = sel instanceof NodeSelection ? (nodePos >= sel.from ? sel.from : sel.to) : sel.anchor;
  const head = nodePos >= anchor ? nodePos + node.nodeSize : nodePos;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)));
  view.focus();
  event.preventDefault();
  return true;
}

/**
 * Varias fotos elegidas (una selección de texto de solo fotos: Shift+clic, Shift+flechas, arrastrar, o después de
 * "Arrange in rows" o de un tamaño): `null` si no. La barra de la foto las trata como fotos elegidas, y el teclado
 * también (auditoría de la entrega 2: una letra, Enter o la barra espaciadora las borraban).
 */
export function photosRange(state: EditorState): TextSelection | null {
  const sel = state.selection;
  return sel instanceof TextSelection && onlyPhotosSelected(state) ? sel : null;
}

/** El cursor después de la última foto elegida. */
function caretAfterRange(view: EditorView, sel: TextSelection): void {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, sel.to)));
}

/**
 * Con varias fotos elegidas, como con una: una letra, Enter, una composición siguen después de la última (no las
 * reemplazan). Backspace, Supr y Shift+flechas, los de ProseMirror (borran, extienden).
 */
function handlePhotosRangeKey(view: EditorView, sel: TextSelection, event: KeyboardEvent): boolean {
  if (startsComposition(event)) {
    caretAfterRange(view, sel);
    return false;
  }
  if (event.isComposing) return false;
  const enter = event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
  if (!enter && !typesCharacter(event)) return false;
  caretAfterRange(view, sel);
  return false;
}

/**
 * Texto que entra SIN tecla con una foto elegida: el selector de emojis (Win+. en Windows, Ctrl+⌘+Espacio en la
 * Mac), el dictado o algunos teclados de terceros. El navegador lo escribe sobre la selección y ProseMirror
 * reemplazaría la foto (lo encontró la auditoría de v0.076). Va después de la foto, como una letra, con el cursor
 * a su derecha. Si lo que cambia no es la foto elegida (o un borde suyo), sigue lo de siempre.
 */
export function handlePhotoTextInput(view: EditorView, from: number, to: number, text: string): boolean {
  if (!view.editable) return false;
  const sel = selectedPhoto(view.state) ?? photosRange(view.state);
  if (!sel) return false;
  const overPhoto = from === sel.from && to === sel.to;
  const atEdge = from === to && (from === sel.from || from === sel.to);
  if (!overPhoto && !atEdge) return false;
  const tr = view.state.tr.insertText(text, sel.to);
  tr.setSelection(TextSelection.create(tr.doc, sel.to + text.length));
  view.dispatch(tr.scrollIntoView());
  return true;
}

// --- Arrastrar para elegir, soltando sobre una foto ---------------------------------------------------------
//
// Al arrastrar para elegir texto, el navegador ubica el final de la selección DENTRO de una foto (que no se
// edita) como se le ocurre: soltar en el centro de una foto podía dejar la selección antes de la foto anterior,
// o achicarla a un carácter (auditoría de v0.076). Mientras se arrastra, el final va al borde de la foto más
// cercano al puntero: mitad izquierda, antes de la foto; mitad derecha, después.

/** El final de la selección sobre la foto que empieza en `pos`: antes o después, según la mitad del puntero. */
export function photoDragHead(pos: number, rect: { left: number; width: number }, clientX: number): number {
  return clientX >= rect.left + rect.width / 2 ? pos + 1 : pos;
}

interface PhotoDrag {
  /** La foto que está debajo del puntero (o `null`) y dónde está el puntero. */
  over: HTMLElement | null;
  x: number;
}

const dragKey = new PluginKey('shotdocs-photo-drag');

/** El final que corresponde a la foto que está debajo del puntero, o `null`. */
function headOverPhoto(view: EditorView, drag: PhotoDrag): number | null {
  const el = drag.over;
  if (!el || !el.isConnected || !view.dom.contains(el)) return null;
  const pos = view.posAtDOM(el, 0);
  if (view.state.doc.nodeAt(pos)?.type.name !== PHOTO) return null;
  return photoDragHead(pos, el.getBoundingClientRect(), drag.x);
}

const dragPlugin = new Plugin<null>({
  key: dragKey,
  view(view) {
    let drag: PhotoDrag | null = null;
    const doc = view.dom.ownerDocument;
    const onDown = (e: PointerEvent) => {
      // Solo un arrastre que empieza en el texto (en una foto, el clic la elige o la arrastra para moverla).
      const onPhoto = !!(e.target as Element | null)?.closest?.('.sd-photo');
      drag = e.button === 0 && !e.shiftKey && !onPhoto && view.editable ? { over: null, x: e.clientX } : null;
      dragOf.set(view, drag);
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      if (!(e.buttons & 1)) {
        drag = null;
        dragOf.set(view, null);
        return;
      }
      drag.over = (e.target as Element | null)?.closest?.<HTMLElement>('.sd-photo') ?? null;
      drag.x = e.clientX;
      // No se corrige acá, mientras se arrastra: cambiar la selección en el medio de un arrastre del navegador le
      // corre el ancla (medido en Chromium). Se corrige al leerla (`createSelectionBetween`) y al soltar.
    };
    const onUp = () => {
      const last = drag;
      drag = null;
      dragOf.set(view, null);
      // Al soltar sobre una foto: el final, en su borde (por si el navegador no avisó del último cambio).
      if (!last) return;
      const head = headOverPhoto(view, last);
      const sel = view.state.selection;
      if (head === null || !(sel instanceof TextSelection) || sel.head === head || sel.anchor === head) return;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, sel.anchor, head)));
    };
    // Apretar sobre texto elegido y mover lo arrastra (no elige): el navegador cancela el puntero y empieza a
    // arrastrar. Ahí no se corrige nada.
    const onCancel = () => {
      drag = null;
      dragOf.set(view, null);
    };
    view.dom.addEventListener('pointerdown', onDown);
    view.dom.addEventListener('dragstart', onCancel);
    doc.addEventListener('pointermove', onMove);
    doc.addEventListener('pointerup', onUp);
    doc.addEventListener('pointercancel', onCancel);
    return {
      destroy() {
        view.dom.removeEventListener('pointerdown', onDown);
        view.dom.removeEventListener('dragstart', onCancel);
        doc.removeEventListener('pointermove', onMove);
        doc.removeEventListener('pointerup', onUp);
        doc.removeEventListener('pointercancel', onCancel);
        dragOf.delete(view);
      },
    };
  },
  props: {
    // La selección que lee ProseMirror del navegador mientras se arrastra: con el puntero sobre una foto, el
    // final va a su borde más cercano.
    createSelectionBetween(view, $anchor, $head) {
      const drag = dragOf.get(view);
      if (!drag) return null;
      const head = headOverPhoto(view, drag);
      if (head === null || head === $head.pos || head === $anchor.pos) return null;
      return TextSelection.create(view.state.doc, $anchor.pos, head);
    },
  },
});

/** El arrastre en curso de cada editor (lo escribe la vista del plugin y lo lee `createSelectionBetween`). */
const dragOf = new WeakMap<EditorView, PhotoDrag | null>();

const keysPlugin = new Plugin({
  key: new PluginKey('shotdocs-photo-keys'),
  props: {
    handleKeyDown: handlePhotoKey,
    handleTextInput: handlePhotoTextInput,
    handleDOMEvents: {
      mousedown: handlePhotoShiftClick,
      // Una composición que empieza sin la tecla de antes (algunos teclados del teléfono): igual, el cursor pasa a
      // la derecha de la foto antes, así lo que se compone no la reemplaza.
      compositionstart(view) {
        const sel = view.editable ? (selectedPhoto(view.state) ?? photosRange(view.state)) : null;
        if (sel instanceof NodeSelection) caretAfter(view, sel);
        else if (sel) caretAfterRange(view, sel);
        return false;
      },
    },
  },
});

/** Las filas y la marca de la selección: dibujo, sin teclado. */
export const inlinePhotoRowsExtension = createExtension({
  key: 'shotdocs-photo-rows',
  prosemirrorPlugins: [rowsPlugin, rangePlugin],
});

/** El teclado y el mouse con una foto en línea elegida: antes que el de BlockNote. */
export const inlinePhotoKeysExtension = createExtension({
  key: 'shotdocs-photo-keys',
  runsBefore: ['nodeSelectionKeyboard'],
  prosemirrorPlugins: [keysPlugin, dragPlugin],
});

export const inlinePhotoExtensions = [inlinePhotoRowsExtension, inlinePhotoKeysExtension];
