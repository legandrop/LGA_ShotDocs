import { currentTarget } from '../assistant/assistantUi';
import { pageScrollAtNavOpen } from '../ui/navStore';

// Dónde estaba la persona al tocar "Mostrame" (Docs/Doc_Tutorial.md, entrega 3): al volver de la práctica, la página
// se vuelve a armar (arriba de todo, con el cursor en el título). Se anota el desplazamiento de la zona principal y,
// en una página, el cursor del editor, y se ponen de nuevo cuando la página está dibujada. Va en la primera carga y es
// chico: lo del editor (ProseMirror) se pide recién al volver, cuando el editor ya se bajó.

export interface ShowMePlace {
  /** La dirección (ruta y lo que va después del "?"). */
  path: string;
  /** Cuánto estaba desplazada `.main`. */
  scrollTop: number;
  /** La página del editor y su cursor (posiciones del documento de ProseMirror), si había uno. */
  pageId: string | null;
  anchor: number | null;
  head: number | null;
}

function scroller(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.main');
}

/** Anota dónde está la persona ahora. */
export function capturePlace(): ShowMePlace {
  const path = location.pathname + location.search;
  // En el teléfono la ayuda se abre desde el cajón: vale lo que estaba desplazada la página al abrirlo.
  const place: ShowMePlace = { path, scrollTop: pageScrollAtNavOpen() ?? scroller()?.scrollTop ?? 0, pageId: null, anchor: null, head: null };
  const target = currentTarget();
  const view = target?.view();
  if (target && view && !view.isDestroyed && location.pathname.endsWith(`/${target.pageId}`)) {
    place.pageId = target.pageId;
    place.anchor = view.state.selection.anchor;
    place.head = view.state.selection.head;
  }
  return place;
}

const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** Cuánto se espera a que la página se vuelva a dibujar. */
const WAIT_MS = 3000;

/**
 * Pone de nuevo el desplazamiento y el cursor cuando la página de `place` está dibujada (hasta 3 s). En un dispositivo
 * de toque no se le da el foco al editor (abriría el teclado en pantalla). Devuelve una función que lo cancela.
 */
export function restorePlace(place: ShowMePlace): () => void {
  let frame = 0;
  let done = false;
  const end = Date.now() + WAIT_MS;
  const here = () => location.pathname + location.search === place.path;
  const scroll = () => {
    const main = scroller();
    if (main) main.scrollTop = place.scrollTop;
  };
  const tick = () => {
    frame = 0;
    if (done) return;
    // Atrás del navegador llega un momento después.
    if (!here()) {
      if (Date.now() < end) frame = requestAnimationFrame(tick);
      return;
    }
    const main = scroller();
    const tall = !!main && (place.scrollTop === 0 || main.scrollHeight - main.clientHeight >= place.scrollTop - 1);
    const target = place.pageId ? currentTarget() : null;
    const view = target?.pageId === place.pageId ? target.view() : null;
    const ready = tall && (!place.pageId || (!!view && !view.isDestroyed));
    if (!ready) {
      if (Date.now() < end) frame = requestAnimationFrame(tick);
      else scroll();
      return;
    }
    done = true;
    if (view && place.anchor !== null && place.head !== null) void putCursor(view, place.anchor, place.head).then(() => !cancelled && scroll());
    scroll();
    // La página puede llevar el título a la vista en el cuadro siguiente: se vuelve a poner una vez más.
    frame = requestAnimationFrame(() => !cancelled && scroll());
  };
  let cancelled = false;
  frame = requestAnimationFrame(tick);
  return () => {
    cancelled = true;
    done = true;
    cancelAnimationFrame(frame);
  };
}

async function putCursor(view: import('@tiptap/pm/view').EditorView, anchor: number, head: number): Promise<void> {
  const { TextSelection } = await import('@tiptap/pm/state');
  if (view.isDestroyed) return;
  const size = view.state.doc.content.size;
  try {
    const sel = TextSelection.between(view.state.doc.resolve(Math.min(anchor, size)), view.state.doc.resolve(Math.min(head, size)));
    view.dispatch(view.state.tr.setSelection(sel));
    if (!coarse()) view.focus();
  } catch {
    // El documento cambió (otra persona editó): se queda donde la página lo deje.
  }
}
