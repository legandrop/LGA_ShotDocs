// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MAP_TABS, pagePath, type MapTab } from '../router';
import { ServicesContext } from '../services';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { TourLayer } from '../tutorial/TourLayer';
import { dismissTour, getTourUi, startTour, tourSignal } from '../tutorial/tourState';
import { createStageFolders } from '../relations/projectStructure';
import { CATALOG_ERRORS, CHAPTERS, chapterById, STATES, tourById, validateCatalog, type ChapterDef, type NeedState, type TourDef } from './catalog';
import { conditionErrors, evaluate, type ConditionContext } from './conditions';
import { chapterAfter, ensureNeeds, nextOf, placeOf, prevOf } from './engine';
import { chapterState, clearCursor, cursorOf, markSeen, readProgress, setCursor } from './progress';
import { safeBack, tourDocHref, TOUR_DOC_PATH } from './reload';
import { setPracticeWorld } from './world';

// El motor de los recorridos con capítulos (Docs/Plan_Proyecto_Desde_Cero.md, sección 6): el catálogo y su validación,
// el progreso por id y versión, el recorrido por ids, los requisitos de un capítulo, y el globito de verdad: *Next*
// nunca hace la acción, *Back* no deshace, Esc dos veces sale y *Skip chapter*.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as never;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

const roots: Root[] = [];
const devices: Device[] = [];
afterEach(() => {
  act(() => dismissTour());
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  setPracticeWorld(null);
  document.body.innerHTML = '';
  localStorage.clear();
  history.replaceState(null, '', '/');
});

const scratch = tourById('scratch')!;
const around = tourById('getting-around')!;

// --- El catálogo ----------------------------------------------------------------------------------------------

describe('el catálogo', () => {
  it('el de la app es válido, con *Getting around* en tres capítulos (los diez pasos de siempre) y el capítulo 1 desde cero', () => {
    expect(CATALOG_ERRORS).toEqual([]);
    expect(around.chapters).toEqual(['around.pages', 'around.editor', 'around.saved']);
    const steps = (phone: boolean) => around.chapters.flatMap((id) => chapterById(id)!.steps.filter((s) => s.layout === 'all' || s.layout === (phone ? 'phone' : 'desktop')));
    expect(steps(false)).toHaveLength(10);
    expect(steps(true)).toHaveLength(9);
    expect(scratch.chapters).toHaveLength(9);
    expect(chapterById('scratch.empty')!.steps.length).toBeGreaterThan(0);
    // Todos los capítulos de *A project from scratch* tienen pasos.
    expect(scratch.chapters.every((id) => chapterById(id)!.steps.length > 0)).toBe(true);
  });

  const broken = (change: (c: ChapterDef) => void, states: Record<string, NeedState> = STATES) => {
    const chapter = structuredClone({ ...chapterById('scratch.empty')!, steps: chapterById('scratch.empty')!.steps.map((s) => ({ ...s })) });
    change(chapter);
    const tour: TourDef = { ...scratch, chapters: [chapter.id] };
    return validateCatalog([tour], [chapter], states);
  };

  it('una condición desconocida invalida el catálogo (y uno inválido no se ofrece)', () => {
    const errors = broken((c) => {
      c.steps.find((s) => s.mode === 'do')!.until = { what: 'magic' } as never;
    });
    expect(errors.join('\n')).toContain('condición desconocida «magic»');
  });

  it('un dato que la condición no entiende, o que le falta, también', () => {
    expect(conditionErrors({ what: 'open', stage: 'nope' }, 'x')).toHaveLength(1);
    expect(conditionErrors({ what: 'open' }, 'x')).toHaveLength(1);
    expect(conditionErrors({ what: 'pages', kind: 'scene', min: 0 }, 'x')).toHaveLength(1);
    expect(conditionErrors({ what: 'overview', part: 'scenes', extra: 1 }, 'x')).toHaveLength(1);
    expect(conditionErrors({ what: 'overview', part: 'nope' }, 'x')).toHaveLength(1);
    expect(conditionErrors({ what: 'childIn', stage: 'scenes', min: 2 }, 'x')).toEqual([]);
  });

  it('ids repetidos, un idioma que falta, un requisito que no existe, una tarjeta con ancla, un paso de acción sin condición', () => {
    expect(broken((c) => (c.steps[1].id = c.steps[0].id)).join('\n')).toContain('paso repetido');
    expect(broken((c) => (c.steps[0].text = { en: 'Hi', es: ' ' })).join('\n')).toContain('falta el texto en es');
    expect(broken((c) => (c.needs = ['nothing'])).join('\n')).toContain('requisito desconocido «nothing»');
    expect(broken((c) => (c.steps[0].anchor = { tour: 'pages' })).join('\n')).toContain('una tarjeta no lleva ancla');
    expect(broken((c) => delete c.steps.find((s) => s.mode === 'do')!.until).join('\n')).toContain('falta la condición');
    expect(broken((c) => (c.steps[1].until = { what: 'slashUsed' })).join('\n')).toContain('solo un paso «do»');
    expect(validateCatalog([{ ...scratch, chapters: ['nope'] }], [], STATES).join('\n')).toContain('capítulo desconocido «nope»');
  });

  it('cada `data-tour` que señala un paso existe en el código de la interfaz (o está anotado como pendiente)', () => {
    // Anclas que el catálogo ya usa y que todavía no están puestas: el globito va al centro hasta que existan.
    const PENDING = new Set<string>();
    const src = resolve(__dirname, '..');
    const code: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx$/.test(name) && !/\.test\./.test(name)) code.push(readFileSync(path, 'utf8'));
      }
    };
    walk(src);
    const all = code.join('\n');
    for (const chapter of CHAPTERS) {
      for (const step of chapter.steps) {
        if (!step.anchor || !('tour' in step.anchor) || PENDING.has(step.anchor.tour)) continue;
        // Las partes del Overview llevan `data-tour={`overview-${part}`}` (OverviewNav.tsx).
        const part = /^overview-(\w+)$/.exec(step.anchor.tour)?.[1];
        const dynamic = !!part && MAP_TABS.includes(part as MapTab) && all.includes('data-tour={`overview-${part}`}');
        expect(all.includes(`data-tour="${step.anchor.tour}"`) || all.includes(`'${step.anchor.tour}'`) || dynamic, `data-tour="${step.anchor.tour}"`).toBe(true);
      }
    }
  });
});

// --- Recorrer por ids -----------------------------------------------------------------------------------------

describe('recorrer por ids', () => {
  it('un capítulo o un paso que ya no existen caen al primero', () => {
    expect(placeOf(around, 'gone', 'gone', false)).toMatchObject({ chapter: { id: 'around.pages' }, index: 0 });
    expect(placeOf(around, 'around.editor', 'gone', false)).toMatchObject({ chapter: { id: 'around.editor' }, index: 0 });
  });

  it('Next cruza de capítulo, Back vuelve al último paso del anterior, y el último termina', () => {
    const last = placeOf(around, 'around.pages', 'project-switcher', false)!;
    expect(nextOf(around, last, false)).toEqual({ chapter: 'around.editor', step: 'slash' });
    const first = placeOf(around, 'around.editor', 'slash', false)!;
    expect(prevOf(around, first, false)).toEqual({ chapter: 'around.pages', step: 'project-switcher' });
    expect(prevOf(around, placeOf(around, 'around.pages', 'hello', false)!, false)).toBeNull();
    expect(nextOf(around, placeOf(around, 'around.saved', 'help', false)!, false)).toBe('end');
  });

  it('Skip chapter va al primer paso del que sigue; los capítulos sin pasos se saltean', () => {
    expect(chapterAfter(around, 'around.pages', false)).toEqual({ chapter: 'around.editor', step: 'slash' });
    expect(chapterAfter(scratch, 'scratch.empty', false)).toEqual({ chapter: 'scratch.firstScene', step: 'scratch.firstScene.hello' });
    expect(chapterAfter(scratch, 'scratch.overview', false)).toBe('end');
  });

  it('en el teléfono, el paso de buscar no está (como antes)', () => {
    const editor = placeOf(around, 'around.editor', '', true)!;
    expect(editor.steps.map((s) => s.id)).toEqual(['slash', 'practice-photos', 'comments', 'page-menu']);
  });
});

// --- El progreso ----------------------------------------------------------------------------------------------

describe('el progreso en el dispositivo', () => {
  it('va por id y versión de capítulo, nunca por posición: subir la versión lo deja «actualizado»', () => {
    const chapter = chapterById('scratch.empty')!;
    expect(chapterState(readProgress(), 'scratch', chapter)).toBe('pending');
    markSeen('scratch', chapter.id, chapter.version);
    expect(chapterState(readProgress(), 'scratch', chapter)).toBe('seen');
    expect(chapterState(readProgress(), 'scratch', { ...chapter, version: chapter.version + 1 })).toBe('updated');
    // Reordenar los capítulos no cambia nada: lo guardado nombra ids.
    const raw = localStorage.getItem('shotdocs-tour-progress')!;
    expect(raw).toContain('"scratch.empty"');
    expect(raw).not.toMatch(/"(?:index|position|step)":\s*\d/);
  });

  it('el cursor (dónde quedaste) es por recorrido, por ids, y se borra al terminar', () => {
    setCursor('getting-around', { chapter: 'around.editor', step: 'comments' });
    const p = readProgress();
    expect(cursorOf('getting-around', p)).toEqual({ chapter: 'around.editor', step: 'comments' });
    expect(chapterState(p, 'getting-around', chapterById('around.editor')!)).toBe('here');
    expect(cursorOf('scratch', p)).toBeNull();
    clearCursor('getting-around');
    expect(cursorOf('getting-around')).toBeNull();
  });

  it('lo que no se entiende cuenta como nada visto', () => {
    localStorage.setItem('shotdocs-tour-progress', '{roto');
    expect(readProgress()).toEqual({ seen: {}, at: {} });
  });
});

describe('la vuelta del documento de práctica', () => {
  it('solo se vuelve a una dirección de este sitio, nunca a otra pestaña de práctica', () => {
    expect(safeBack('/p/abc?x=1')).toBe('/p/abc?x=1');
    expect(safeBack('https://evil.test/')).toBe('/');
    expect(safeBack('//evil.test/')).toBe('/');
    expect(safeBack(`${TOUR_DOC_PATH}?tour=scratch`)).toBe('/');
    expect(safeBack('/tour?tour=scratch')).toBe('/');
    expect(safeBack('/tours-and-more')).toBe('/tours-and-more');
    expect(tourDocHref('scratch', 'scratch.empty', '/p/abc')).toBe(`${TOUR_DOC_PATH}?tour=scratch&chapter=scratch.empty&back=%2Fp%2Fabc`);
  });
});

// --- Los requisitos de un capítulo ----------------------------------------------------------------------------

async function practiceWorld() {
  const server = new FakeServer();
  const d = await makeDevice(server);
  devices.push(d);
  const projectId = await d.tree.createProject('Practice');
  const stages = await createStageFolders(d.tree, projectId, 'en');
  const world = { tree: d.tree, projectId, stages, lang: 'en' as const };
  setPracticeWorld(world);
  return world;
}

const ctxOf = (world: Awaited<ReturnType<typeof practiceWorld>> | null): ConditionContext => ({ route: { name: 'home' } as never, world, slashUsed: false });

describe('los requisitos (`needs`)', () => {
  it('fabrica solo lo que falta, en orden (lo que necesita cada estado, antes), y comprueba después', async () => {
    const made: string[] = [];
    let a = false;
    let b = false;
    const states: Record<string, NeedState> = {
      a: { label: { en: 'A', es: 'A' }, check: { what: 'slashUsed' }, make: async () => void (made.push('a'), (a = true)) },
      b: { label: { en: 'B', es: 'B' }, needs: ['a'], check: { what: 'stageFolders' }, make: async () => void (made.push('b'), (b = true)) },
    };
    const ctx = () => ({ route: { name: 'home' } as never, world: null, slashUsed: a }) as ConditionContext;
    // `b` mira las carpetas: sin mundo nunca se cumple, así que fabricarlo falla con su nombre.
    const chapter = { ...chapterById('scratch.empty')!, needs: ['b'] };
    await expect(ensureNeeds(chapter, { stages: {} } as never, ctx, states)).rejects.toThrow('no se pudo preparar: b');
    expect(made).toEqual(['a', 'b']);
    expect(b).toBe(true);
    // Lo que ya existe no se vuelve a fabricar.
    made.length = 0;
    await expect(ensureNeeds({ ...chapter, needs: ['a'] }, { stages: {} } as never, ctx, states)).resolves.toBeUndefined();
    expect(made).toEqual([]);
    await expect(ensureNeeds({ ...chapter, needs: ['zzz'] }, null, ctx, states)).rejects.toThrow('requisito desconocido: zzz');
  });

  it('las carpetas de las etapas: si están en la papelera vuelven; si faltan, se arman de nuevo', async () => {
    const world = await practiceWorld();
    const chapter = chapterById('scratch.empty')!;
    expect(evaluate({ what: 'stageFolders' }, ctxOf(world))).toBe(true);
    await world.tree.trash(world.stages.scenes);
    await world.tree.trash(world.stages.archive);
    expect(evaluate({ what: 'stageFolders' }, ctxOf(world))).toBe(false);
    await ensureNeeds(chapter, world, () => ctxOf(world));
    expect(evaluate({ what: 'stageFolders' }, ctxOf(world))).toBe(true);
    // Sin carpetas (un proyecto que no las tiene): se crean y el mundo apunta a las nuevas.
    const empty = { ...world, projectId: await world.tree.createProject('Other'), stages: { ...world.stages, prepro: 'gone' } };
    await ensureNeeds(chapter, empty, () => ctxOf(empty));
    expect(empty.stages.prepro).not.toBe('gone');
    expect(world.tree.get(empty.stages.scenes)?.workspace_id).toBe(empty.projectId);
  });

  it('las condiciones leen el proyecto: abierta la carpeta de Escenas, una escena con número, un hijo en Locaciones', async () => {
    const world = await practiceWorld();
    const at = (path: string): ConditionContext => ({ ...ctxOf(world), route: { name: 'page', id: path } as never });
    expect(evaluate({ what: 'open', stage: 'scenes' }, at(world.stages.scenes))).toBe(true);
    expect(evaluate({ what: 'open', stage: 'scenes' }, at(world.stages.locations))).toBe(false);
    expect(evaluate({ what: 'childIn', stage: 'locations' }, ctxOf(world))).toBe(false);
    await world.tree.create(world.stages.locations, 'Train station', world.projectId);
    expect(evaluate({ what: 'childIn', stage: 'locations' }, ctxOf(world))).toBe(true);
    expect(evaluate({ what: 'overview', part: 'scenes' }, { ...ctxOf(world), route: { name: 'map', tab: 'scenes' } as never })).toBe(true);
    expect(evaluate({ what: 'overview', part: 'days' }, { ...ctxOf(world), route: { name: 'map', tab: 'scenes' } as never })).toBe(false);
  });

  it('un documento con su marca (su plantilla), un documento abierto, y lo que juntan las relaciones', async () => {
    const world = await practiceWorld();
    // Una página nueva en Scouting reports ya es un scouting por su carpeta, pero sin plantilla no está marcada.
    const id = await world.tree.create(world.stages.scouting, '', world.projectId);
    expect(evaluate({ what: 'marked', doc: 'scouting' }, ctxOf(world))).toBe(false);
    expect(evaluate({ what: 'openDoc', doc: 'scouting' }, { ...ctxOf(world), route: { name: 'page', id } as never })).toBe(true);
    expect(evaluate({ what: 'openDoc', doc: 'plan' }, { ...ctxOf(world), route: { name: 'page', id } as never })).toBe(false);
    await world.tree.setSetting(id, 'entity', { kind: 'scouting' });
    expect(evaluate({ what: 'marked', doc: 'scouting' }, ctxOf(world))).toBe(true);
    // `related` pregunta al índice de las relaciones (en la práctica, `engine.ts`); sin índice, nunca se cumple.
    expect(evaluate({ what: 'related', link: 'scouted' }, ctxOf(world))).toBe(false);
    expect(evaluate({ what: 'related', link: 'reported' }, { ...ctxOf(world), related: (l) => l === 'reported' })).toBe(true);
    expect(conditionErrors({ what: 'related', link: 'other' }, 'x')).toHaveLength(1);
  });
});

// --- El globito -----------------------------------------------------------------------------------------------

const wait = (ms = 30) => act(() => new Promise((r) => setTimeout(r, ms)));
async function until(check: () => unknown, what: string, tries = 150): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (check()) return;
    await wait(40);
  }
  throw new Error(`no llegó: ${what}`);
}

const bubble = () => document.querySelector<HTMLElement>('.tour-bubble');
const title = () => bubble()?.querySelector('h3')?.textContent;
const where = () => bubble()?.querySelector('.mono-label')?.textContent;
const buttonIn = (text: string) => [...(bubble()?.querySelectorAll('button') ?? [])].find((b) => b.textContent === text) as HTMLButtonElement | undefined;
const click = (el: Element | null | undefined) => act(() => void el!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const press = (key: string, target: EventTarget = document.body) => act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));

function mount() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <ServicesContext.Provider value={{ media: { enabled: false } } as never}>
        <TourLayer />
      </ServicesContext.Provider>,
    ),
  );
}

/** El capítulo 1 desde cero, en su paso de acción (abrir Escenas), sobre un proyecto de práctica en memoria. */
async function atOpenScenes() {
  const world = await practiceWorld();
  history.replaceState(null, '', pagePath(world.stages.prepro));
  mount();
  act(() => startTour('scratch', 'scratch.empty', 'scratch.empty.openScenes'));
  await until(() => title() === 'Where it starts', 'el paso de acción');
  return world;
}

describe('el globito', () => {
  it('un paso de acción: *Next* queda gris y nunca la hace (ni con clic, ni con → o Enter); hecha de verdad, «Done» y sigue solo', async () => {
    const world = await atOpenScenes();
    expect(where()).toBe('Ch. 1/9 · Step 6/7');
    expect(bubble()!.textContent).toContain('Do this:');
    const next = buttonIn('Next')!;
    expect(next.disabled).toBe(true);
    // La app queda a mano: sin bloqueador ni `inert`.
    expect(document.querySelector('.tour-blocker')).toBeNull();
    click(next);
    press('ArrowRight');
    press('Enter');
    await wait(400);
    expect(title()).toBe('Where it starts');
    expect(location.pathname).toBe(pagePath(world.stages.prepro));
    expect(getTourUi().step).toBe('scratch.empty.openScenes');
    // El globito no se lleva el foco.
    expect(bubble()!.contains(document.activeElement)).toBe(false);
    // La persona abre Escenas.
    act(() => history.replaceState(null, '', pagePath(world.stages.scenes)));
    await until(() => bubble()?.textContent?.includes('Done'), '«Done»');
    expect(bubble()!.classList.contains('is-done')).toBe(true);
    await until(() => title() === 'Write in Pages, read in the Overview', 'el paso que sigue');
    expect(location.pathname).toBe(pagePath(world.stages.scenes));
  });

  it('*Back* no deshace: el paso de acción ya cumplido dice «Already done», no sigue solo, y *Next* se prende', async () => {
    const world = await atOpenScenes();
    act(() => history.replaceState(null, '', pagePath(world.stages.scenes)));
    await until(() => title() === 'Write in Pages, read in the Overview', 'la tarjeta final');
    click(buttonIn('Back'));
    await until(() => title() === 'Where it starts', 'atrás');
    expect(bubble()!.textContent).toContain('Already done');
    expect(bubble()!.textContent).not.toContain('Do this:');
    await wait(900);
    expect(title()).toBe('Where it starts');
    expect(location.pathname).toBe(pagePath(world.stages.scenes));
    expect(buttonIn('Next')!.disabled).toBe(false);
    click(buttonIn('Next'));
    await until(() => title() === 'Write in Pages, read in the Overview', 'adelante otra vez');
  });

  it('Esc pregunta en el globito (*Keep going* sigue) y el segundo Esc sale', async () => {
    await atOpenScenes();
    press('Escape');
    await until(() => buttonIn('Keep going'), 'la pregunta');
    expect(bubble()!.textContent).toContain('Exit the tour?');
    click(buttonIn('Keep going'));
    await until(() => bubble()?.textContent?.includes('Do this:'), 'de vuelta al paso');
    expect(getTourUi().mode).toBe('running');
    press('Escape');
    await until(() => buttonIn('Keep going'), 'la pregunta otra vez');
    press('Escape');
    await until(() => !bubble(), 'que salga');
    expect(getTourUi().mode).toBe('off');
    // Lo de dónde quedó se guarda para *Continue* en la ayuda.
    expect(cursorOf('scratch')).toEqual({ chapter: 'scratch.empty', step: 'scratch.empty.openScenes' });
  });

  it('entrar por un capítulo cuyo requisito falta: se prepara solo y arranca en su primer paso', async () => {
    const world = await practiceWorld();
    await world.tree.trash(world.stages.prepro);
    mount();
    act(() => startTour('scratch', 'scratch.empty'));
    await until(() => title() === 'A project from scratch', 'el primer paso');
    expect(world.tree.isTrashed(world.stages.prepro)).toBe(false);
    expect(where()).toBe('Ch. 1/9 · Step 1/7');
  });

  it('*Skip chapter* va al capítulo que sigue sin darlo por visto', async () => {
    history.replaceState(null, '', '/practice');
    mount();
    act(() => startTour('getting-around'));
    await until(() => title() === 'Hi!', 'el primer paso');
    expect(where()).toBe('Ch. 1/3 · Step 1/3');
    click(bubble()!.querySelector('.tour-skip'));
    await until(() => where() === 'Ch. 2/3 · Step 1/5', 'el capítulo 2');
    expect(readProgress().seen['around.pages']).toBeUndefined();
    // El paso del menú "/" es de acción: *Next* gris; hecho (la práctica avisa), sigue solo.
    expect(buttonIn('Next')!.disabled).toBe(true);
    act(() => tourSignal('slash'));
    await until(() => where() === 'Ch. 2/3 · Step 2/5', 'el paso 2 del capítulo 2');
  });
});
