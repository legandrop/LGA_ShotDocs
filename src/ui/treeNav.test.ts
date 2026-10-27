import { afterEach, describe, expect, it, vi } from 'vitest';
import { collapseToBranch, createOpenScheduler, isPlainKey, isTreeKey, revealDelta, revealRow, treeKeyAction, visibleRows, type VisibleRow } from './treeNav';

// Las reglas del teclado del árbol de páginas, sin la interfaz.

// u ▸ (a ▸ a1, b), d, t ▸ c
const kids: Record<string, string[]> = { u: ['a', 'b'], a: ['a1'], t: ['c'] };
const children = (id: string) => (kids[id] ?? []).map((k) => ({ id: k }));
const roots = [{ id: 'u' }, { id: 'd' }, { id: 't' }];
const ids = (rows: VisibleRow[]) => rows.map((r) => r.id);

describe('visibleRows', () => {
  it('en el orden en que se ven: las subpáginas de una abierta sí, las de una cerrada no', () => {
    expect(ids(visibleRows(roots, children, new Set()))).toEqual(['u', 'd', 't']);
    expect(ids(visibleRows(roots, children, new Set(['u'])))).toEqual(['u', 'a', 'b', 'd', 't']);
    expect(ids(visibleRows(roots, children, new Set(['u', 'a', 't'])))).toEqual(['u', 'a', 'a1', 'b', 'd', 't', 'c']);
    // Abierta adentro de una cerrada: no se ve.
    expect(ids(visibleRows(roots, children, new Set(['a'])))).toEqual(['u', 'd', 't']);
  });

  it('madre, nivel y estado de cada fila; "abierta" en una sin subpáginas no cuenta', () => {
    const rows = visibleRows(roots, children, new Set(['u', 'a', 'd']));
    expect(rows.find((r) => r.id === 'a1')).toEqual({ id: 'a1', parentId: 'a', depth: 2, hasChildren: false, open: false });
    expect(rows.find((r) => r.id === 'u')).toEqual({ id: 'u', parentId: null, depth: 0, hasChildren: true, open: true });
    expect(rows.find((r) => r.id === 'd')).toEqual({ id: 'd', parentId: null, depth: 0, hasChildren: false, open: false });
  });

  it('un ciclo en datos rotos no cuelga', () => {
    const loop = (id: string) => (id === 'x' ? [{ id: 'y' }] : [{ id: 'x' }]);
    expect(ids(visibleRows([{ id: 'x' }], loop, new Set(['x', 'y'])))).toEqual(['x', 'y']);
  });
});

describe('treeKeyAction', () => {
  const rows = visibleRows(roots, children, new Set(['u', 'a']));
  // u, a, a1, b, d, t (t cerrada)

  it('↓ y ↑: la siguiente y la anterior visibles; en las puntas, nada', () => {
    expect(treeKeyAction(rows, 'a1', 'ArrowDown')).toEqual({ type: 'go', id: 'b' });
    expect(treeKeyAction(rows, 'b', 'ArrowUp')).toEqual({ type: 'go', id: 'a1' });
    expect(treeKeyAction(rows, 'u', 'ArrowUp')).toEqual({ type: 'none' });
    expect(treeKeyAction(rows, 't', 'ArrowDown')).toEqual({ type: 'none' });
  });

  it('Inicio y Fin: la primera y la última; parado ahí, nada', () => {
    expect(treeKeyAction(rows, 'b', 'Home')).toEqual({ type: 'go', id: 'u' });
    expect(treeKeyAction(rows, 'b', 'End')).toEqual({ type: 'go', id: 't' });
    expect(treeKeyAction(rows, 'u', 'Home')).toEqual({ type: 'none' });
    expect(treeKeyAction(rows, 't', 'End')).toEqual({ type: 'none' });
  });

  it('→: cerrada con subpáginas la abre; abierta va a la primera subpágina; sin subpáginas, nada', () => {
    expect(treeKeyAction(rows, 't', 'ArrowRight')).toEqual({ type: 'expand', id: 't' });
    expect(treeKeyAction(rows, 'u', 'ArrowRight')).toEqual({ type: 'go', id: 'a' });
    expect(treeKeyAction(rows, 'a', 'ArrowRight')).toEqual({ type: 'go', id: 'a1' });
    expect(treeKeyAction(rows, 'd', 'ArrowRight')).toEqual({ type: 'none' });
    expect(treeKeyAction(rows, 'a1', 'ArrowRight')).toEqual({ type: 'none' });
  });

  it('←: abierta la cierra; cerrada o sin subpáginas va a la madre; en el primer nivel sin nada que cerrar, nada', () => {
    expect(treeKeyAction(rows, 'u', 'ArrowLeft')).toEqual({ type: 'collapse', id: 'u' });
    expect(treeKeyAction(rows, 'a', 'ArrowLeft')).toEqual({ type: 'collapse', id: 'a' });
    expect(treeKeyAction(rows, 'a1', 'ArrowLeft')).toEqual({ type: 'go', id: 'a' });
    expect(treeKeyAction(rows, 'b', 'ArrowLeft')).toEqual({ type: 'go', id: 'u' });
    expect(treeKeyAction(rows, 't', 'ArrowLeft')).toEqual({ type: 'none' });
    expect(treeKeyAction(rows, 'd', 'ArrowLeft')).toEqual({ type: 'none' });
    // Una cerrada con subpáginas que no es del primer nivel: a la madre.
    const closed = visibleRows(roots, children, new Set(['u']));
    expect(treeKeyAction(closed, 'a', 'ArrowLeft')).toEqual({ type: 'go', id: 'u' });
  });

  it('Enter y Espacio abren la del foco; otra tecla o una fila que no se ve, nada', () => {
    expect(treeKeyAction(rows, 'd', 'Enter')).toEqual({ type: 'open', id: 'd' });
    expect(treeKeyAction(rows, 'd', ' ')).toEqual({ type: 'open', id: 'd' });
    expect(treeKeyAction(rows, 'd', 'a')).toEqual({ type: 'none' });
    expect(treeKeyAction(rows, 'c', 'ArrowDown')).toEqual({ type: 'none' });
  });

  it('las teclas del árbol, y solas', () => {
    for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' ']) expect(isTreeKey(k)).toBe(true);
    for (const k of ['Tab', 'Escape', 'PageDown', 'a', 'F2']) expect(isTreeKey(k)).toBe(false);
    const none = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
    expect(isPlainKey(none)).toBe(true);
    for (const mod of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey'] as const) expect(isPlainKey({ ...none, [mod]: true })).toBe(false);
    expect(isPlainKey({ ...none, isComposing: true })).toBe(false);
  });
});

describe('createOpenScheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    vi.useFakeTimers();
    let t = 1000;
    const opened: string[] = [];
    let wait = 0;
    const s = createOpenScheduler((id) => opened.push(id), { delay: 150, now: () => t, queued: () => wait });
    // Lo que ya está listo corre antes de que pase el tiempo (dibujar la página abierta, en la app).
    const advance = (ms: number) => {
      vi.advanceTimersByTime(0);
      t += ms;
      vi.advanceTimersByTime(ms);
    };
    return { s, opened, advance, busy: (ms: number) => (t += ms), queuedFor: (ms: number) => (wait = ms) };
  }

  it('una tecla que esperó en cola (la página se dibujó más tarde) no abre al instante', () => {
    const { s, opened, advance, queuedFor } = setup();
    s.request('a');
    advance(1000);
    queuedFor(300);
    s.request('b');
    expect(opened).toEqual(['a']);
    queuedFor(0);
    advance(150);
    expect(opened).toEqual(['a', 'b']);
  });

  it('una página pesada no encola las teclas que llegaron mientras se dibujaba (D810)', () => {
    const { s, opened, advance, busy } = setup();
    s.request('a');
    expect(opened).toEqual(['a']);
    // La página tarda 800 ms en dibujarse; las teclas apretadas mientras tanto llegan después, de golpe.
    busy(800);
    s.request('b');
    s.request('c');
    expect(opened).toEqual(['a']);
    advance(150);
    expect(opened).toEqual(['a', 'c']);
    // Y lo que llega enseguida después de abrir c, también espera.
    busy(600);
    s.request('d');
    expect(opened).toEqual(['a', 'c']);
    advance(150);
    expect(opened).toEqual(['a', 'c', 'd']);
  });

  it('una pulsación suelta abre al instante', () => {
    const { s, opened, advance } = setup();
    s.request('a');
    expect(opened).toEqual(['a']);
    advance(400);
    s.request('b');
    expect(opened).toEqual(['a', 'b']);
  });

  it('con la tecla apretada solo abre la última, al frenar', () => {
    const { s, opened, advance } = setup();
    s.request('a', true);
    advance(30);
    s.request('b', true);
    advance(30);
    s.request('c', true);
    expect(opened).toEqual([]);
    expect(s.pending()).toBe('c');
    advance(149);
    expect(opened).toEqual([]);
    advance(1);
    expect(opened).toEqual(['c']);
    expect(s.pending()).toBeNull();
  });

  it('pulsaciones más seguidas que la espera: la primera al instante, las demás juntas al frenar', () => {
    const { s, opened, advance } = setup();
    s.request('a');
    advance(60);
    s.request('b');
    advance(60);
    s.request('c');
    expect(opened).toEqual(['a']);
    advance(150);
    expect(opened).toEqual(['a', 'c']);
  });

  it('cancel olvida lo pendiente', () => {
    const { s, opened, advance } = setup();
    s.request('a', true);
    s.cancel();
    advance(500);
    expect(opened).toEqual([]);
    expect(s.pending()).toBeNull();
  });
});

describe('revealDelta', () => {
  const view = { top: 100, bottom: 400 };
  it('si la fila se ve entera, nada', () => {
    expect(revealDelta({ top: 100, bottom: 132 }, view, 8)).toBe(0);
    expect(revealDelta({ top: 368, bottom: 400 }, view, 8)).toBe(0);
  });
  it('debajo o a medias abajo: lo justo para dejarla con aire abajo', () => {
    expect(revealDelta({ top: 390, bottom: 422 }, view, 8)).toBe(30);
    expect(revealDelta({ top: 900, bottom: 932 }, view, 8)).toBe(540);
  });
  it('arriba o a medias arriba: lo justo para dejarla con aire arriba', () => {
    expect(revealDelta({ top: 90, bottom: 122 }, view, 8)).toBe(-18);
    expect(revealDelta({ top: -500, bottom: -468 }, view, 8)).toBe(-608);
  });
  it('más alta que lo que se ve: manda su borde de arriba', () => {
    expect(revealDelta({ top: 50, bottom: 600 }, view, 8)).toBe(-58);
  });
});

describe('revealRow', () => {
  const box = (top: number, height: number) => ({ top, bottom: top + height, height });
  const el = (r: { top: number; bottom: number; height: number }) => ({ getBoundingClientRect: () => r }) as unknown as HTMLElement;
  const area = (top: number, height: number, scrollTop = 0) =>
    ({ getBoundingClientRect: () => box(top, height), clientTop: 0, clientHeight: height, scrollTop }) as unknown as HTMLElement;

  it('desplaza solo el área que se le da y devuelve cuánto', () => {
    const c = area(0, 300, 50);
    expect(revealRow(el(box(500, 32)), c)).toBe(240);
    expect(c.scrollTop).toBe(290);
  });
  it('hacia arriba, si la fila cabe en la primera pantalla, vuelve al principio (reaparece el encabezado)', () => {
    const c = area(0, 300, 137);
    // La fila está a 8 px del borde de arriba del área: a 145 px del principio del contenido.
    expect(revealRow(el(box(-100, 32)), c)).toBe(-137);
    expect(c.scrollTop).toBe(0);
  });
  it('hacia arriba, si no cabe en la primera pantalla, queda pegada al borde con su aire', () => {
    const c = area(0, 300, 1000);
    expect(revealRow(el(box(-100, 32)), c)).toBe(-108);
    expect(c.scrollTop).toBe(892);
  });
  it('si la fila se ve, no toca nada', () => {
    const c = area(0, 300, 50);
    expect(revealRow(el(box(100, 32)), c)).toBe(0);
    expect(c.scrollTop).toBe(50);
  });
  it('sin caja (el árbol no se dibuja), no mide', () => {
    const c = area(0, 0, 50);
    expect(revealRow(el(box(0, 0)), c)).toBe(0);
    expect(c.scrollTop).toBe(50);
  });
});

describe('collapseToBranch (colapso automático)', () => {
  it('deja solo las madres, la página si ya estaba abierta y lo de otros proyectos', () => {
    const prev = new Set(['uno', 'a', 'tres', 'otro-proyecto']);
    const next = collapseToBranch(prev, ['uno'], 'a', (id) => id === 'otro-proyecto');
    expect(next).toEqual(new Set(['uno', 'a', 'otro-proyecto']));
    // Una página cerrada no se abre por abrirla.
    expect(collapseToBranch(prev, ['tres'], 'c')).toEqual(new Set(['tres']));
  });
  it('si no cambia nada, devuelve lo mismo (sin redibujar)', () => {
    const prev = new Set(['uno', 'a']);
    expect(collapseToBranch(prev, ['uno', 'a'], 'a1')).toBe(prev);
  });
});
