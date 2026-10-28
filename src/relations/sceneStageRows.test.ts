import { describe, expect, it } from 'vitest';
import type { SceneLive } from './liveView';
import { sceneStageRows, stagePageIds, type StageOptions } from './sceneStageRows';

// Los renglones «Etapa | Tipo: links» de una escena (D783, D784), sin la app: qué renglones van siempre, cuáles solo con
// algo, «Reading…» mientras el índice lee (nunca un cero), la cabecera sin *Desglose*, y a dónde lleva cada link.

const day = (n: number, date: string, locs: string[] = []) => ({ pageId: `d${n}`, label: `Día ${n}`, date, locs });

function live(over: Partial<SceneLive> = {}): SceneLive {
  return {
    pageId: 'scene',
    complete: true,
    shots: [],
    cards: [],
    sets: [],
    plannedAt: [],
    questions: [],
    scoutPages: [],
    scoutsVia: [],
    testPages: [],
    plans: [],
    days: [],
    ...over,
  } as unknown as SceneLive;
}

const opts = (over: Partial<StageOptions> = {}): StageOptions => ({
  self: false,
  title: (id) => (id === 'scene' ? '032 | Repentinamente se escucha un crujido' : id),
  locPage: (name) => (name === 'Inquilinato' ? 'loc-inq' : null),
  others: [],
  index: [],
  ...over,
});

describe('sceneStageRows', () => {
  it('una escena sin nada: los renglones de siempre, cada uno diciendo que no hay; ninguno de los opcionales', () => {
    const rows = sceneStageRows(live(), opts());
    expect(rows.map((r) => r.id)).toEqual(['breakdown', 'location', 'scouting', 'plan', 'shoot']);
    expect(rows.filter((r) => r.id !== 'breakdown').every((r) => r.empty === 'none')).toBe(true);
  });

  it('mientras el índice lee, lo vacío dice que está leyendo (no afirma un cero)', () => {
    const rows = sceneStageRows(live({ complete: false }), opts());
    expect(rows.filter((r) => !r.lines.length).every((r) => r.empty === 'reading')).toBe(true);
  });

  it('la cabecera de la página de la escena no tiene *Desglose* (es esa página)', () => {
    expect(sceneStageRows(live(), opts({ self: true })).some((r) => r.id === 'breakdown')).toBe(false);
  });

  it('desglose con sus planos, locaciones sin repetir (la del desglose y la del día), días con sus secciones y fotos', () => {
    const d73 = day(73, '2026-03-11', ['Inquilinato']);
    const v = live({
      shots: [{ pageId: 'scene', title: 'ERSO_101_032_010' }, { pageId: 'scene', title: 'ERSO_101_032_010 · 2' }],
      plannedAt: [{ title: 'Inquilinato', pageId: '' }],
      days: [
        { day: d73, sections: [{ pageId: 'd73', heading: 'Escena 101_032a', place: { pageId: 'd73', blockId: 'b1' } }], mentions: [], photos: [1, 2, 3] },
        { day: day(80, '2026-03-20'), sections: [], mentions: [{ pageId: 'd80', place: { pageId: 'd80', blockId: 'm1' } }], photos: [] },
      ],
    } as unknown as Partial<SceneLive>);
    const rows = sceneStageRows(v, opts());
    const bd = rows.find((r) => r.id === 'breakdown')!.lines[0];
    expect(bd).toMatchObject({ kind: 'links', shots: 2, links: [{ target: { kind: 'scene', pageId: 'scene' } }] });
    const loc = rows.find((r) => r.id === 'location')!.lines[0];
    expect(loc).toEqual({ kind: 'links', links: [{ label: 'Inquilinato', target: { kind: 'loc', pageId: 'loc-inq' } }] });
    const shoot = rows.find((r) => r.id === 'shoot')!.lines;
    expect(shoot[0]).toMatchObject({ kind: 'path', lead: { label: 'Día 73', date: '2026-03-11', target: { kind: 'day', pageId: 'd73' } }, photos: 3 });
    expect(shoot[0].kind === 'path' && shoot[0].links[0].target).toEqual({ kind: 'place', place: { pageId: 'd73', blockId: 'b1' } });
    // Un día que solo la nombra en el texto va marcado aparte.
    expect(shoot[1]).toMatchObject({ kind: 'path', named: true, lead: { label: 'Día 80' } });
  });

  it('preguntas abiertas: un renglón con rótulo es otra (una por departamento), la primera se ve y las demás suman «+N»', () => {
    const v = live({
      questions: [
        { text: 'Director: ¿la lluvia es de día?\nArt: ¿los carteles se cambian?', place: { pageId: 'scene', blockId: 'q1' }, cards: [] },
        { text: '¿Permiso de corte de calle?\nVer con locaciones.', place: { pageId: 'scene', blockId: 'q2' }, cards: [] },
      ],
    } as unknown as Partial<SceneLive>);
    const q = sceneStageRows(v, opts()).find((r) => r.id === 'question')!.lines[0];
    expect(q).toMatchObject({ kind: 'question', text: 'Director: ¿la lluvia es de día?', more: 2, place: { pageId: 'scene', blockId: 'q1' } });
  });

  it('scouting: los que la nombran; si no hay, los de la locación donde se filmó, con «de …»', () => {
    const via = sceneStageRows(live({ scoutsVia: [{ pageId: 'sc1', title: '260109 | Scouting técnico', loc: 'Inquilinato' }] } as unknown as Partial<SceneLive>), opts());
    expect(via.find((r) => r.id === 'scouting')!.lines).toEqual([{ kind: 'links', via: 'Inquilinato', links: [{ label: '260109 | Scouting técnico', target: { kind: 'page', pageId: 'sc1' } }] }]);
    const own = sceneStageRows(live({ scoutPages: [{ pageId: 'sc2', title: 'Tech scout', blockId: 'h2' }] } as unknown as Partial<SceneLive>), opts());
    expect(own.find((r) => r.id === 'scouting')!.lines[0]).toMatchObject({ links: [{ target: { kind: 'place', place: { pageId: 'sc2', blockId: 'h2' } } }] });
  });

  it('planeamiento: cada día con sus planes, una página una sola vez', () => {
    const v = live({
      plans: [
        {
          day: day(73, '2026-03-11'),
          items: [
            { pageId: 'p1', pageTitle: 'D73 26.03.11 | Inquilinato', place: { pageId: 'p1', blockId: 'x' } },
            { pageId: 'p1', pageTitle: 'D73 26.03.11 | Inquilinato', place: { pageId: 'p1', blockId: 'y' } },
          ],
        },
      ],
    } as unknown as Partial<SceneLive>);
    const plan = sceneStageRows(v, opts()).find((r) => r.id === 'plan')!;
    expect(plan.empty).toBeNull();
    expect(plan.lines[0].kind === 'path' && plan.lines[0].links).toEqual([{ label: 'D73 26.03.11 | Inquilinato', target: { kind: 'place', place: { pageId: 'p1', blockId: 'x' } } }]);
  });

  it('*Otras*: solo con algo; las páginas índice, plegadas aparte', () => {
    const rows = sceneStageRows(live(), opts({ others: [{ pageId: 'o1', title: 'BA | Calle Marginal' }], index: [{ pageId: 'i1', title: 'Breakdown index' }] }));
    expect(rows.find((r) => r.id === 'other')!.lines.map((l) => l.kind)).toEqual(['links', 'index']);
  });

  it('stagePageIds junta las páginas que ya están en algún renglón', () => {
    const v = live({ cards: [{ pageId: 'c1', title: 'ficha' }], scoutPages: [{ pageId: 'sc2', title: 'x' }] } as unknown as Partial<SceneLive>);
    expect([...stagePageIds(v)].sort()).toEqual(['c1', 'sc2', 'scene']);
  });
});
