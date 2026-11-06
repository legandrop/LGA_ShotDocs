// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultProjectColor, loadRecentColors, previewColor, PROJECT_PRESETS, projectColor, rememberRecentColor, useProjectColor } from './projectColor';

// El color de los proyectos (Docs/Doc_Navegacion.md, «Color del proyecto»): el de fábrica según el id, el elegido, la
// vista previa mientras se elige y los recientes del picker.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Lo que devuelve el hook, al día después de cada `act`. */
function renderHook<T>(hook: () => T): { result: { current: T } } {
  const result = { current: undefined as T };
  function Probe() {
    result.current = hook();
    return null;
  }
  const root = createRoot(document.createElement('div'));
  act(() => root.render(<Probe />));
  return { result };
}

beforeEach(() => {
  localStorage.clear();
  previewColor('x', null);
});

describe('projectColor', () => {
  it('sin elegir, uno de la paleta y siempre el mismo para el mismo id', () => {
    const id = '00000000-0000-4000-8000-0000000000e1';
    expect(PROJECT_PRESETS).toContain(defaultProjectColor(id));
    expect(defaultProjectColor(id)).toBe(defaultProjectColor(id));
    expect(projectColor({ id, color: null })).toBe(defaultProjectColor(id));
    // Uno que no es un color (una base vieja, un dato roto) se ignora.
    expect(projectColor({ id, color: 'red' })).toBe(defaultProjectColor(id));
    expect(projectColor({ id, color: '#8E2E5A' })).toBe('#8e2e5a');
  });

  it('distintos proyectos no caen todos en el mismo color', () => {
    const colors = new Set(Array.from({ length: 40 }, (_, i) => defaultProjectColor(`p-${i}`)));
    expect(colors.size).toBeGreaterThan(4);
  });

  it('la vista previa se ve solo en su proyecto y se saca', () => {
    const a = { id: 'a', color: '#2e5a8e' };
    const b = { id: 'b', color: '#443a91' };
    const { result } = renderHook(() => [useProjectColor(a), useProjectColor(b)]);
    expect(result.current).toEqual(['#2e5a8e', '#443a91']);
    act(() => previewColor('a', '#ff0000'));
    expect(result.current).toEqual(['#ff0000', '#443a91']);
    // Sacar la de otro proyecto no toca la de este.
    act(() => previewColor('b', null));
    expect(result.current[0]).toBe('#ff0000');
    act(() => previewColor('a', null));
    expect(result.current).toEqual(['#2e5a8e', '#443a91']);
  });

  it('recientes: el elegido al frente, sin repetidos, ocho como mucho', () => {
    for (let i = 0; i < 10; i++) rememberRecentColor(`#00000${i}`);
    rememberRecentColor('#000003');
    const recents = loadRecentColors();
    expect(recents).toHaveLength(8);
    expect(recents[0]).toBe('#000003');
    expect(new Set(recents).size).toBe(8);
    localStorage.setItem('shotdocs.colorRecents', '"roto"');
    expect(loadRecentColors()).toEqual([]);
  });
});
