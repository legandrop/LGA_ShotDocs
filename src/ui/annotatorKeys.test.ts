import { describe, expect, it } from 'vitest';
import { annotatorKey } from './annotatorKeys';
import { parsePrefs } from './annotatorStyles';
import { DEFAULT_STYLES } from '../media/markupEdit';

// El teclado del anotador (P.20, entrega 2): las letras de FrameRev, `[` `]`, Ctrl/⌘+`[` `]` (en la Mac solo con ⌘:
// ⌘[ es "atrás" del navegador y el anotador lo frena), deshacer y rehacer, y nada de letras escribiendo un texto.

const none = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
const key = (k: string, extra: Partial<typeof none> & { code?: string } = {}) => ({ ...none, key: k, ...extra });

describe('las teclas del anotador', () => {
  it('las letras eligen la herramienta (sin modificadores, sin una caja de texto con el foco)', () => {
    const letters: Record<string, string> = { v: 'select', r: 'rectangle', e: 'ellipse', a: 'arrow', l: 'line', p: 'pencil', m: 'marker', t: 'text', n: 'number' };
    for (const [k, tool] of Object.entries(letters)) {
      expect(annotatorKey(key(k), false)).toEqual({ kind: 'tool', tool });
      expect(annotatorKey(key(k), false, true)).toBeNull();
      expect(annotatorKey(key(k.toUpperCase(), { shiftKey: true }), false)).toBeNull();
      expect(annotatorKey(key(k, { ctrlKey: true }), false)).toBeNull();
      expect(annotatorKey(key(k, { altKey: true }), false)).toBeNull();
    }
    // Un teclado ruso: la tecla de la R.
    expect(annotatorKey(key('к', { code: 'KeyR' }), false)).toEqual({ kind: 'tool', tool: 'rectangle' });
    expect(annotatorKey(key('f'), false)).toEqual({ kind: 'fit' });
  });

  it('[ y ]: lo elegido o la próxima; con Ctrl (Windows) o ⌘ (Mac), siempre la próxima; Ctrl en la Mac no', () => {
    expect(annotatorKey(key('['), false)).toEqual({ kind: 'width', delta: -1, next: false });
    expect(annotatorKey(key(']'), true)).toEqual({ kind: 'width', delta: 1, next: false });
    expect(annotatorKey(key('[', { ctrlKey: true }), false)).toEqual({ kind: 'width', delta: -1, next: true });
    expect(annotatorKey(key(']', { metaKey: true }), true)).toEqual({ kind: 'width', delta: 1, next: true });
    expect(annotatorKey(key('[', { ctrlKey: true }), true)).toBeNull();
    expect(annotatorKey(key('[', { metaKey: true }), false)).toBeNull();
    // Sin carácter (tecla muerta): el lugar de la tecla.
    expect(annotatorKey(key('Dead', { code: 'BracketRight', metaKey: true }), true)).toEqual({ kind: 'width', delta: 1, next: true });
    // Escribiendo, ni siquiera ⌘[ (el texto es del campo).
    expect(annotatorKey(key('[', { metaKey: true }), true, true)).toBeNull();
  });

  it('deshacer y rehacer con ⌘ en la Mac y Ctrl en Windows (también Ctrl+Y)', () => {
    expect(annotatorKey(key('z', { metaKey: true }), true)).toEqual({ kind: 'undo' });
    expect(annotatorKey(key('z', { metaKey: true, shiftKey: true }), true)).toEqual({ kind: 'redo' });
    expect(annotatorKey(key('y', { ctrlKey: true }), false)).toEqual({ kind: 'redo' });
    expect(annotatorKey(key('z', { ctrlKey: true }), true)).toBeNull();
    expect(annotatorKey(key('z', { metaKey: true }), false)).toBeNull();
  });

  it('borrar, Escape, la barra espaciadora y Ctrl/⌘+S (estos dos, también escribiendo)', () => {
    expect(annotatorKey(key('Delete'), false)).toEqual({ kind: 'delete' });
    expect(annotatorKey(key('Backspace'), false)).toEqual({ kind: 'delete' });
    expect(annotatorKey(key('Backspace'), false, true)).toBeNull();
    expect(annotatorKey(key(' '), false)).toEqual({ kind: 'pan' });
    expect(annotatorKey(key('Escape'), false, true)).toEqual({ kind: 'escape' });
    expect(annotatorKey(key('s', { metaKey: true }), true, true)).toEqual({ kind: 'save' });
    expect(annotatorKey(key('s', { ctrlKey: true }), false)).toEqual({ kind: 'save' });
    expect(annotatorKey(key('s', { ctrlKey: true }), true)).toBeNull();
    expect(annotatorKey(key('k', { ctrlKey: true }), false)).toBeNull();
  });
});

describe('el estilo guardado en el dispositivo', () => {
  it('lo guardado se limpia; algo roto vuelve a los valores de fábrica', () => {
    expect(parsePrefs(null)).toEqual({ styles: expect.any(Object), recent: [], tool: 'arrow', penOnly: false, penSet: false });
    expect(parsePrefs('{no es json').tool).toBe('arrow');
    const p = parsePrefs(JSON.stringify({ tool: 'pencil', recent: ['#ff0000', 'javascript:x', '#FF0000', 3], styles: { arrow: { color: '#0a84ff', width: 12 } } }));
    expect(p.tool).toBe('pencil');
    expect(p.recent).toEqual(['#FF0000']);
    expect(p.styles.arrow).toMatchObject({ color: '#0A84FF', width: 12 });
    expect(p.styles.ellipse).toEqual(DEFAULT_STYLES.ellipse);
    expect(parsePrefs(JSON.stringify({ tool: 'censor' })).tool).toBe('arrow');
  });
});
