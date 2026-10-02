import { describe, expect, it } from 'vitest';
import { isCommentShortcut, isSendShortcut } from './commentsUi';
import { isFindShortcut } from './findUi';
import { isPrintShortcut } from './printPage';
import { isSearchShortcut } from './projectSearchUi';
import { isRedoShortcut, isUndoShortcut } from './undoTimelineUi';

// Regla del repo: en la Mac, siempre ⌘ y nunca Ctrl (Ctrl+clic y Ctrl+tecla son otra cosa ahí); en Windows y
// Linux, Ctrl y nunca la tecla de Windows.

const none = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
const ctrl = { ...none, ctrlKey: true };
const cmd = { ...none, metaKey: true };

describe('los atajos con Ctrl/⌘', () => {
  it('buscar en la página y en el proyecto', () => {
    for (const [fn, key] of [
      [isFindShortcut, 'f'],
      [isSearchShortcut, 'k'],
    ] as const) {
      expect(fn({ ...cmd, key }, true)).toBe(true);
      expect(fn({ ...ctrl, key }, true)).toBe(false);
      expect(fn({ ...ctrl, key }, false)).toBe(true);
      expect(fn({ ...cmd, key }, false)).toBe(false);
    }
  });

  it('comentar (⌘⌥M / Ctrl+Alt+M), también con la tecla que escribe otra cosa con Alt', () => {
    const m = { key: 'µ', code: 'KeyM' };
    expect(isCommentShortcut({ ...cmd, altKey: true, ...m }, true)).toBe(true);
    expect(isCommentShortcut({ ...ctrl, altKey: true, ...m }, true)).toBe(false);
    expect(isCommentShortcut({ ...ctrl, altKey: true, key: 'm', code: 'KeyM' }, false)).toBe(true);
    expect(isCommentShortcut({ ...cmd, altKey: true, key: 'm', code: 'KeyM' }, false)).toBe(false);
    // AltGr en Windows (llega como Ctrl+Alt) escribe un carácter: no.
    expect(isCommentShortcut({ ...ctrl, altKey: true, key: 'm', code: 'KeyM', getModifierState: (k) => k === 'AltGraph' }, false)).toBe(false);
  });

  it('mandar un comentario (⌘Enter / Ctrl+Enter)', () => {
    expect(isSendShortcut({ ...cmd, key: 'Enter' }, true)).toBe(true);
    expect(isSendShortcut({ ...ctrl, key: 'Enter' }, true)).toBe(false);
    expect(isSendShortcut({ ...ctrl, key: 'Enter' }, false)).toBe(true);
    expect(isSendShortcut({ ...cmd, key: 'Enter' }, false)).toBe(false);
    expect(isSendShortcut({ ...none, key: 'Enter' }, false)).toBe(false);
  });

  it('deshacer y rehacer en el orden en que editaste (⌘Z, ⌘⇧Z y ⌘Y / Ctrl+Z, Ctrl+Shift+Z y Ctrl+Y)', () => {
    expect(isUndoShortcut({ ...cmd, key: 'z' }, true)).toBe(true);
    expect(isUndoShortcut({ ...ctrl, key: 'z' }, true)).toBe(false);
    expect(isUndoShortcut({ ...ctrl, key: 'z' }, false)).toBe(true);
    expect(isUndoShortcut({ ...cmd, key: 'z' }, false)).toBe(false);
    expect(isUndoShortcut({ ...cmd, shiftKey: true, key: 'Z' }, true)).toBe(false);
    expect(isRedoShortcut({ ...cmd, shiftKey: true, key: 'Z' }, true)).toBe(true);
    expect(isRedoShortcut({ ...cmd, key: 'y' }, true)).toBe(true);
    expect(isRedoShortcut({ ...ctrl, shiftKey: true, key: 'Z' }, true)).toBe(false);
    expect(isRedoShortcut({ ...ctrl, key: 'y' }, false)).toBe(true);
    expect(isRedoShortcut({ ...ctrl, shiftKey: true, key: 'y' }, false)).toBe(false);
    expect(isRedoShortcut({ ...ctrl, altKey: true, key: 'z' }, false)).toBe(false);
    // Un teclado ruso: la tecla de la Z.
    expect(isUndoShortcut({ ...ctrl, key: 'я', code: 'KeyZ' }, false)).toBe(true);
  });

  it('imprimir (⌘P / Ctrl+P), sin Alt ni Shift', () => {
    expect(isPrintShortcut({ ...cmd, key: 'p' }, true)).toBe(true);
    expect(isPrintShortcut({ ...ctrl, key: 'p' }, true)).toBe(false);
    expect(isPrintShortcut({ ...ctrl, key: 'p' }, false)).toBe(true);
    expect(isPrintShortcut({ ...cmd, key: 'p' }, false)).toBe(false);
    expect(isPrintShortcut({ ...ctrl, shiftKey: true, key: 'P' }, false)).toBe(false);
    // Un teclado ruso: la tecla de la P.
    expect(isPrintShortcut({ ...ctrl, key: 'з', code: 'KeyP' }, false)).toBe(true);
  });
});
