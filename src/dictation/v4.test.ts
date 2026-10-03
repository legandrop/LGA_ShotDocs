// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { unmountAll, view } from '../ui/collabHarness';
import { builtinBlocks } from '../templates/builtin';
import { pageShot, sameShot, shotKeyOf, shotOfApplied, shotsOnPage, loadActiveShot, saveActiveShot } from './activeShot';
import { validateAnswer } from './answer';
import { recentForRequest, type AppliedEntry } from './corrections';
import { captureDictateLink, peekDictateLink, resetDictateLink, takeDictateLink, textOfHash } from './dictateLink';
import { answer, mapOf, reportEditor, targetBy, WORDS } from './fixtures/report';
import { buildPlaceRequest } from './prompt';

// Lo puro de la entrega V4 de *Dictate to report* (Docs/Doc_Dictado.md, fila V4 y 5.6/5.7): el nombre de un plano, los
// planos de la página, el plano activo como señal propia, las correcciones encadenadas con la dirección de ahora, el
// pedido con `ACTIVE_SHOT` y la entrada `/dictate` del Atajo de iOS.

afterEach(() => {
  unmountAll();
  resetDictateLink();
  localStorage.clear();
});

const BUILTIN = { word: 'Shot', checks: ['Clean plate', 'HDRI'] };

describe('el nombre de un plano', () => {
  it('los dos primeros números, y el mismo plano escrito de otra forma', () => {
    expect(shotKeyOf('12 · 010 · 3')).toBe('12_010');
    expect(shotKeyOf('Shot 12_010')).toBe('12_010');
    expect(shotKeyOf('Grúa')).toBe('Grúa');
    expect(shotKeyOf('  ')).toBeNull();
    expect(sameShot('12_010', '012_010')).toBe(true);
    expect(sameShot('12_010', '12_011')).toBe(false);
    expect(sameShot('Grúa', 'grua')).toBe(true);
  });

  it('los planos de la página: las Slate de Setups & takes y las secciones, sin repetir', () => {
    const ed = reportEditor();
    expect(shotsOnPage(mapOf(ed))).toEqual(['12_010']);
  });

  it('en una página Shot Breakdown, el plano es el de su ficha', () => {
    const blocks = builtinBlocks('shot', 'en') as { type: string; content?: { rows: { cells: unknown[] }[] } }[];
    blocks[0].content!.rows[0].cells[1] = '012_010';
    const ed = reportEditor(blocks);
    expect(pageShot(mapOf(ed, '012_010'))).toBe('012_010');
  });

  it('se guarda por página en el dispositivo', () => {
    saveActiveShot('Lega@wanka.tv', 'w', 'p1', '12_010');
    expect(loadActiveShot('lega@wanka.tv', 'w', 'p1')).toBe('12_010');
    expect(loadActiveShot('lega@wanka.tv', 'w', 'p2')).toBeNull();
    saveActiveShot('lega@wanka.tv', 'w', 'p1', null);
    expect(loadActiveShot('lega@wanka.tv', 'w', 'p1')).toBeNull();
  });
});

describe('el plano activo como señal', () => {
  const LENS = { op: 'setCell', at: 'T3 r3 c3', row: '12 · 010 · 3', col: 'Lens · Filters (ND, diffusion, pola)', old: '', new: '50 mm' };

  it('una fila del plano activo no es "elegida por el asistente"; una de otro plano sí', () => {
    const ed = reportEditor();
    const map = mapOf(ed);
    const plan = (activeShot: string | null) => {
      const p = validateAnswer(answer([LENS]), map, { note: 'con un 50', words: WORDS, activeShot }, BUILTIN);
      if (p === 'unreadable') throw new Error('no');
      return p.changes[0];
    };
    expect(plan(null).chosen).toBe(true);
    expect(plan('12_010').chosen).toBe(false);
    expect(plan('12_011').chosen).toBe(true);
  });

  it('el plano de lo aplicado: la Slate de la fila (o la que escribe en una vacía) y la sección', () => {
    const ed = reportEditor();
    const map = mapOf(ed);
    const p = validateAnswer(
      answer([
        { op: 'setCell', at: 'T3 r4 c1', row: '', col: 'Slate (Sc · Shot · Setup)', old: '', new: '12 · 011 · 1' },
        { op: 'setCell', at: 'T3 r4 c3', row: '', col: 'Lens · Filters (ND, diffusion, pola)', old: '', new: '35 mm' },
      ]),
      map,
      { note: 'el 12_011 con un 35', words: WORDS },
      BUILTIN,
    );
    if (p === 'unreadable') throw new Error('no');
    expect(shotOfApplied(p.changes.slice(1), map)).toBe('12_011');
    const hdri = targetBy(map, (t) => t.code === 'K' && t.plain === 'HDRI');
    const q = validateAnswer(answer([{ op: 'check', at: hdri.addr, label: 'HDRI' }]), map, { note: 'HDRI', words: WORDS }, BUILTIN);
    if (q === 'unreadable') throw new Error('no');
    // La sección de la plantilla todavía no tiene plano: no deja ninguno.
    expect(shotOfApplied(q.changes, map)).toBeNull();
  });

  it('el pedido lleva ACTIVE_SHOT fuera del mapa, y nada si no hay', () => {
    const ed = reportEditor();
    const map = mapOf(ed);
    expect(buildPlaceRequest(map, 'con un 50', { activeShot: '12_010' }).user).toContain('</page_map>\n\nACTIVE_SHOT "12_010"');
    expect(buildPlaceRequest(map, 'con un 50').user).not.toContain('ACTIVE_SHOT');
    expect(buildPlaceRequest(map, 'x').system).toContain('then ACTIVE_SHOT');
  });
});

describe('correcciones encadenadas', () => {
  it('un renglón por lugar (lo primero de antes, lo último de después), con la dirección de ahora y el último marcado', () => {
    const ed = reportEditor();
    const map = mapOf(ed);
    const lens = map.targets.get('T3 r3 c3')!;
    const tstop = map.targets.get('T3 r3 c4')!;
    const entries: AppliedEntry[] = [
      { where: 'Setups & takes › 12 · 010 · 3 › Lens', before: '', after: '50 mm', at: 1, target: lens },
      { where: 'Setups & takes › 12 · 010 · 3 › T-stop', before: '', after: 'T2.8', at: 2, target: tstop },
      { where: 'Setups & takes › 12 · 010 · 3 › Lens', before: '50 mm', after: '35 mm', at: 3, target: lens },
    ];
    const { recent, addrs } = recentForRequest(entries, map, view(ed).state);
    expect(recent).toEqual([
      { where: 'Setups & takes › 12 · 010 · 3 › T-stop', before: '', after: 'T2.8', addr: 'T3 r3 c4' },
      { where: 'Setups & takes › 12 · 010 · 3 › Lens', before: '', after: '35 mm', addr: 'T3 r3 c3' },
    ]);
    expect([...addrs].sort()).toEqual(['T3 r3 c3', 'T3 r3 c4']);
    const user = buildPlaceRequest(map, 'no, era un 40', { recent }).user;
    expect(user).toContain('RECENT\n- T3 r3 c4 (Setups & takes › 12 · 010 · 3 › T-stop): "" → "T2.8"\n- T3 r3 c3 (Setups & takes › 12 · 010 · 3 › Lens): "" → "35 mm" (last)');
  });

  it('el lugar se sigue por su ancla aunque se agregue una fila arriba (la dirección cambia)', () => {
    const ed = reportEditor();
    const before = mapOf(ed);
    const lens = before.targets.get('T3 r3 c3')!;
    // Otra fila entera arriba (como la inserta *Apply*: un nodo).
    const v = view(ed);
    const $pos = v.state.doc.resolve(before.targets.get('T3 r2 c1')!.start);
    let d = $pos.depth;
    while ($pos.node(d).type.name !== 'tableRow') d--;
    v.dispatch(v.state.tr.insert($pos.before(d), $pos.node(d).copy($pos.node(d).content)));
    const after = mapOf(ed);
    const { recent } = recentForRequest([{ where: 'Lens', before: '', after: '50 mm', at: 1, target: lens }], after, view(ed).state);
    expect(recent[0].addr).toBe('T3 r4 c3');
  });

  it('un cambio en un lugar de RECENT es una corrección: ni "elegida por el asistente"', () => {
    const ed = reportEditor();
    const map = mapOf(ed);
    const p = validateAnswer(
      answer([{ op: 'setCell', at: 'T3 r3 c3', row: '12 · 010 · 3', col: 'Lens · Filters (ND, diffusion, pola)', old: '', new: '35 mm' }]),
      map,
      { note: 'no, era un 35', words: WORDS, recent: new Set(['T3 r3 c3']) },
      BUILTIN,
    );
    if (p === 'unreadable') throw new Error('no');
    expect(p.changes[0]).toMatchObject({ corrects: true, chosen: false });
  });
});

describe('/dictate (el Atajo de iOS)', () => {
  it('el texto del fragmento, con o sin text=, decodificado y con tope', () => {
    expect(textOfHash('#este%20plano%20con%20un%2050')).toBe('este plano con un 50');
    expect(textOfHash('#text=hola%0Achau')).toBe('hola\nchau');
    expect(textOfHash('#100%')).toBe('100%');
    expect(textOfHash('#' + 'x'.repeat(3000))).toHaveLength(2000);
  });

  it('toma el texto, deja la dirección en el inicio sin el fragmento y lo da una sola vez', () => {
    const replaceState = vi.fn();
    expect(captureDictateLink({ pathname: '/dictate', hash: '#el%2012_010%20con%20un%2050' }, { replaceState })).toBe(true);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/');
    expect(peekDictateLink()).toBe('el 12_010 con un 50');
    // Sobrevive a una recarga de la pestaña (sessionStorage).
    resetDictateLinkMemoryOnly();
    expect(peekDictateLink()).toBe('el 12_010 con un 50');
    expect(takeDictateLink()).toBe('el 12_010 con un 50');
    expect(takeDictateLink()).toBeNull();
  });

  it('otra dirección no se toca; /dictate sin texto abre la hoja con el campo vacío', () => {
    const replaceState = vi.fn();
    expect(captureDictateLink({ pathname: '/p/x', hash: '#algo' }, { replaceState })).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();
    expect(peekDictateLink()).toBeNull();
    expect(captureDictateLink({ pathname: '/dictate/', hash: '' }, { replaceState })).toBe(true);
    expect(takeDictateLink()).toBe('');
  });
});

/** Como una recarga: se olvida lo que había en memoria, queda lo de `sessionStorage`. */
function resetDictateLinkMemoryOnly(): void {
  const saved = sessionStorage.getItem('shotdocs-dictate-link');
  resetDictateLink();
  if (saved) sessionStorage.setItem('shotdocs-dictate-link', saved);
}
