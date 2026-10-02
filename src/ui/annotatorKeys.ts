import { TOOL_LETTERS, TOOLS, type Tool } from '../media/markupEdit';
import { isLetter, modPressed } from './findUi';
import { IS_MAC } from './shortcuts';

// El teclado del anotador (P.20, entrega 2; Docs/Doc_Anotar_Fotos.md, "Atajos"): qué hace cada tecla, sin pantalla
// (Annotator.tsx la escucha en la captura de `window`, así nada de la página actúa debajo). Las teclas están en el
// registro (shortcuts.ts, lugar `annotate`) y en la ayuda. En la Mac, ⌘ y nunca Ctrl (`modPressed`).
//
// Las letras sueltas solo valen sin una caja de texto con el foco (`typing`). ⌘[ y ⌘] son "atrás" y "adelante" del
// navegador en la Mac: con el anotador abierto se frenan (`preventDefault`) y cambian el grosor de la próxima forma.

export type AnnotatorAction =
  | { kind: 'tool'; tool: Tool }
  /** `[` (-1) y `]` (+1): lo elegido si el cursor está sobre ello; si no, la próxima forma. Con Ctrl/⌘, siempre la próxima. */
  | { kind: 'width'; delta: -1 | 1; next: boolean }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'delete' }
  | { kind: 'escape' }
  | { kind: 'fit' }
  | { kind: 'save' }
  /** La barra espaciadora apretada: arrastrar mueve la foto ampliada. */
  | { kind: 'pan' };

interface KeyLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Lo que manda el navegador cuando la tecla no da un carácter (una tecla muerta, algún teclado con ⌘). */
const UNNAMED = new Set(['Dead', 'Unidentified']);

/** `[` o `]` (en un teclado que no da la tecla, su lugar). */
function bracket(e: KeyLike): -1 | 1 | 0 {
  if (e.key === '[') return -1;
  if (e.key === ']') return 1;
  // Sin carácter: el lugar de la tecla en el teclado de EE. UU.
  if (UNNAMED.has(e.key)) return e.code === 'BracketLeft' ? -1 : e.code === 'BracketRight' ? 1 : 0;
  return 0;
}

/**
 * Qué hace la tecla en el anotador, o `null` (no es suya: sigue de largo). `typing`: el foco está en una caja de texto
 * (escribir un texto, el número del grosor), donde solo cuentan Escape y ⌘/Ctrl+S.
 */
export function annotatorKey(e: KeyLike, mac = IS_MAC, typing = false): AnnotatorAction | null {
  const mod = modPressed(e, mac);
  const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
  if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey) return { kind: 'escape' };
  if (mod && !e.altKey && !e.shiftKey && isLetter(e, 's')) return { kind: 'save' };
  if (typing) return null;
  if (mod && !e.altKey) {
    const b = bracket(e);
    if (b !== 0) return { kind: 'width', delta: b, next: true };
    if (isLetter(e, 'z')) return e.shiftKey ? { kind: 'redo' } : { kind: 'undo' };
    if (isLetter(e, 'y') && !e.shiftKey) return { kind: 'redo' };
    return null;
  }
  if (!plain) return null;
  const b = bracket(e);
  if (b !== 0) return { kind: 'width', delta: b, next: false };
  if (e.key === 'Delete' || e.key === 'Backspace') return { kind: 'delete' };
  if (e.key === ' ') return { kind: 'pan' };
  if (e.shiftKey) return null;
  if (isLetter(e, 'f')) return { kind: 'fit' };
  for (const tool of TOOLS) if (isLetter(e, TOOL_LETTERS[tool])) return { kind: 'tool', tool };
  return null;
}
