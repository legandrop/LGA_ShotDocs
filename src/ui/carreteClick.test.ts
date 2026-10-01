import { describe, expect, it } from 'vitest';
import { clickOpens, mousePressOpens, shiftSelects } from './carreteClick';

describe('el clic en una foto', () => {
  const press = { editable: true, focused: true, selectedId: 'a', targetId: 'a' };

  it('con el mouse, apretar la foto ya elegida la abre; otra foto o sin foco, no', () => {
    expect(mousePressOpens(press)).toBe(true);
    expect(mousePressOpens({ ...press, targetId: 'b' })).toBe(false);
    expect(mousePressOpens({ ...press, selectedId: null })).toBe(false);
    expect(mousePressOpens({ ...press, focused: false })).toBe(false);
  });

  it('en solo lectura, apretar siempre abre', () => {
    expect(mousePressOpens({ editable: false, focused: false, selectedId: null, targetId: 'a' })).toBe(true);
  });

  it('con el mouse, el primer clic elige y no abre; el segundo (o el doble clic) abre', () => {
    const click = { kind: 'mouse', mouseOpens: false, pressedSelected: false, detail: 1, modifier: false };
    expect(clickOpens(click)).toBe(false);
    expect(clickOpens({ ...click, mouseOpens: true })).toBe(true);
    expect(clickOpens({ ...click, detail: 2 })).toBe(true);
  });

  it('con ⌘/Ctrl nunca abre', () => {
    expect(clickOpens({ kind: 'mouse', mouseOpens: true, pressedSelected: false, detail: 2, modifier: true })).toBe(false);
  });

  it('con el dedo, como antes: abre, salvo el toque sobre la foto ya elegida', () => {
    const tap = { kind: 'touch', mouseOpens: false, pressedSelected: false, detail: 1, modifier: false };
    expect(clickOpens(tap)).toBe(true);
    expect(clickOpens({ ...tap, pressedSelected: true })).toBe(false);
  });

  it('Shift+clic en una foto en línea elige texto (no abre) solo si se puede editar; en solo lectura abre', () => {
    expect(shiftSelects({ editable: true, shiftKey: true, inlinePhoto: true })).toBe(true);
    expect(shiftSelects({ editable: false, shiftKey: true, inlinePhoto: true })).toBe(false);
    expect(shiftSelects({ editable: true, shiftKey: false, inlinePhoto: true })).toBe(false);
    // Una foto-bloque: Shift no cambia nada (como antes).
    expect(shiftSelects({ editable: true, shiftKey: true, inlinePhoto: false })).toBe(false);
    // En solo lectura, apretar abre y el clic con Shift no cuenta como modificador.
    const modifier = shiftSelects({ editable: false, shiftKey: true, inlinePhoto: true });
    expect(clickOpens({ kind: 'mouse', mouseOpens: mousePressOpens({ editable: false, focused: false, selectedId: null, targetId: 'p#0' }), pressedSelected: false, detail: 1, modifier })).toBe(true);
  });
});
