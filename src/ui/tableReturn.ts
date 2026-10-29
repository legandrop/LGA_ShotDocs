import { goBack, navPosition, previousPath } from '../navHistory';
import { navigate, tableReturnPath } from '../router';

// Esc vuelve a la tabla (D822, Lega 2026-10-29): en una página abierta desde una fila de una tabla (la de Escenas o
// Locaciones, las del Panorama), Esc vuelve a la tabla. La marca la pone el router (`nextFromTable`) en la entrada del
// historial de la página; atrás y adelante la conservan.
//
// - Se decide en la fase de captura de `window`, antes que nadie: muchos menús y diálogos se cierran con Esc desde
//   `document` sin frenar el evento, y React los saca de la página en una microtarea que corre antes de la fase de
//   burbuja de `window`. Mirado ahí, el menú ya no estaría y Esc cerraría el menú y además volvería (auditoría v0.309).
// - Con algo abierto encima (un diálogo, un menú, el menú "/" o la barra de formato del editor, los comentarios, el
//   carrete, el adelanto de un subrayado, la pregunta de salir del recorrido) no hace nada: el Esc es de eso.
// - En un campo de texto (un buscador, un formulario) el Esc es del campo; el título de la página no cuenta (el título
//   se guarda igual al salir). En el texto de la página, sí: el editor solo suelta el foco (y frena el evento).
// - El recorrido (src/tutorial/TourLayer.tsx) usa la misma decisión para no preguntar si salir.

/** Esc solo, sin otras teclas. */
export function isBackToTableShortcut(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): boolean {
  return e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
}

const OPEN = [
  '[aria-modal="true"]',
  '.modal-backdrop',
  '.carrete',
  'dialog[open]',
  '[role="dialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '.menu',
  '.rel-peek',
  '.comments-panel',
  '.bn-suggestion-menu',
  '.bn-grid-suggestion-menu',
  '.bn-formatting-toolbar',
  '.bn-link-toolbar',
  '.bn-menu-dropdown',
].join(', ');

/**
 * A qué tabla vuelve este Esc, o `null`: se llama en la fase de captura, con la página todavía como la ve la persona.
 * El globito del recorrido no tapa (Esc vuelve también durante un recorrido), salvo con su pregunta de salir a la vista.
 */
export function escTableTarget(e: KeyboardEvent, win: Window = window): string | null {
  // `keyCode 229`: el Esc que cancela una composición (IME) en Safari llega con `isComposing` en falso.
  if (e.isComposing || e.keyCode === 229 || e.repeat || !isBackToTableShortcut(e)) return null;
  const from = tableReturnPath();
  if (!from) return null;
  const target = e.target as Element | null;
  if (target?.closest?.('input, textarea, select') && !target.closest('.page-title')) return null;
  // Solo lo que se ve (un diálogo escondido que queda en la página no cuenta).
  const covered = [...win.document.querySelectorAll(OPEN)].some(
    // El globito del recorrido (salvo su pregunta de salir) y su tarjeta de la esquina (invitar, retomar) no tapan.
    (el) => el.getClientRects().length > 0 && !el.matches('.tour-bubble:not([data-asking]), .tour-card'),
  );
  return covered ? null : from;
}

export function listenBackToTable(win: Window = window): () => void {
  let from: string | null = null;
  const decide = (e: KeyboardEvent) => {
    from = e.key === 'Escape' ? escTableTarget(e, win) : null;
  };
  const onKey = (e: KeyboardEvent) => {
    const to = from;
    from = null;
    if (!to || e.key !== 'Escape') return;
    // Lo que tomó otro no vuelve; el editor frena su Esc solo para soltar el foco, y ese sí vuelve.
    const inEditor = !!(e.target as Element | null)?.closest?.('.bn-editor');
    if (e.defaultPrevented && !inEditor) return;
    e.preventDefault();
    // Atrás, si la entrada de atrás es la tabla (casi siempre: la página se abrió desde ella); si no (el documento de
    // práctica tiene una sola entrada), se abre la tabla. Un atrás que el historial no acepta todavía (otro en camino)
    // no se reemplaza por una entrada nueva.
    const prev = previousPath();
    const back = !!prev && new URL(prev, win.location.origin).pathname === new URL(to, win.location.origin).pathname;
    if (back && navPosition().canBack) goBack(win);
    else navigate(to);
  };
  win.addEventListener('keydown', decide, true);
  win.addEventListener('keydown', onKey);
  return () => {
    win.removeEventListener('keydown', decide, true);
    win.removeEventListener('keydown', onKey);
  };
}
