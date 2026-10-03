// @vitest-environment jsdom
// La barra de formato en la Mac (D226; roadmap B.25a): los atajos con ⌘, nunca Ctrl. jsdom no es una Mac: la plataforma
// se fija antes de cargar los módulos (`IS_MAC` de shortcuts.ts se calcula al cargar), por eso va en su propio archivo.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.defineProperty(Navigator.prototype, 'platform', { configurable: true, get: () => 'MacIntel' });
});

import { cleanup, mount, setupDom, tips } from './formatToolbarHarness';
import { IS_MAC } from './shortcuts';

beforeAll(setupDom);
afterEach(cleanup);

describe('la barra de formato en la Mac', () => {
  it('cada atajo con ⌘ (escrito acá, no sacado del registro); ninguno con Ctrl', async () => {
    expect(IS_MAC).toBe(true);
    await mount();
    const all = tips();
    expect(all).toEqual({
      bold: '**⌘B**: bold',
      italic: '**⌘I**: italic',
      underline: '**⌘U**: underline',
      strike: '**⌘⇧S**: strike',
      alignTextLeft: 'Align text left',
      alignTextCenter: 'Align text center',
      alignTextRight: 'Align text right',
      colors: 'Colors',
      nestBlock: '**⇥**: nest block',
      unnestBlock: '**⇧⇥**: unnest block',
      createLink: '**⌘K**: create link',
      Comment: '**⌘⌥M**: comment',
    });
    expect(Object.values(all).some((tip) => tip?.includes('Ctrl'))).toBe(false);
  });

  it('en un iPad (táctil), sin atajos', async () => {
    await mount({ coarse: true });
    const all = tips();
    expect(all.bold).toBeNull();
    expect(all.strike).toBeNull();
    expect(all.alignTextLeft).toBe('Align text left');
  });
});
