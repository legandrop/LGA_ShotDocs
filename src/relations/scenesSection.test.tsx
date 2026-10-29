// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { mapPath, navigate, pagePath } from '../router';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import type { PageSettings } from '../sync/types';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { settled } from '../test/settle';
import { shown } from '../test/shown';
import { searchSession } from '../ui/projectSearchUi';
import { Shell } from '../ui/Workspace';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { buildProject, type Built } from './fixtures/proyectoSintetico';
import { SceneStages } from './SceneStages';
import { sceneStageRows } from './sceneStageRows';
import type { SceneLive } from './liveView';
import { OVERVIEW_PAGE as SCENES_PAGE } from './OverviewNav';

// Lo de acá es el Overview sin el colapso automático (lo desplegado se recuerda); con el colapso: sidebarRows.test.ts.
vi.mock('../ui/treeNav', async (original) => ({ ...(await original<typeof import('../ui/treeNav')>()), AUTO_COLLAPSE: false }));

// *Overview* de la barra lateral con *Scenes* adentro (Docs/Doc_Relaciones.md, secciones 21 y 22) y la lista de las
// páginas de una escena, en la app de verdad: aparece sola en un proyecto con escenas, por episodio y plegable (recordado por proyecto), cada escena
// abre sus páginas por etapa con el lugar exacto, Overview › Scenes despliega la misma lista con «N pages», un invitado ve solo
// lo suyo, mientras lee no afirma nada, y con muchas escenas dibuja de a tandas. Nada de esto escribe.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as never;
  const empty = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) });
  Range.prototype.getClientRects ??= (() => []) as never;
  Range.prototype.getBoundingClientRect ??= empty as never;
  Element.prototype.scrollIntoView ??= (() => undefined) as never;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

beforeEach(() => localStorage.clear());

const roots: Root[] = [];
const devices: Device[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
});

const wait = (ms = 30) => act(() => settled(ms));

function services(device: Device): Services {
  return {
    workspace: { config: { url: 'https://x.supabase.co', publishableKey: 'k', name: 'W', localKey: WANKA_LOCAL_KEY, storage: legacyStorageNames(WANKA_LOCAL_KEY) }, client: {} },
    client: { auth: { signOut: vi.fn() } },
    user: { id: device.remote.userId, email: 'a@test' },
    db: device.db,
    tree: device.tree,
    docs: device.docs,
    files: device.files,
    media: device.media,
    engine: device.engine,
    access: device.access,
    remote: device.remote as unknown as SupabaseRemote,
    dbName: 'test',
    mediaDb: device.mediaDb,
    comments: device.comments,
    commentsDb: device.commentsDb,
    sizes: device.sizes,
    shutdown: async () => undefined,
  } as unknown as Services;
}

let n = 0;
const fakePhoto = async () => `0000${String(++n).padStart(4, '0')}-aaaa-4bbb-8ccc-dddddddddddd`;

function mount(d: Device, start: string): { host: HTMLElement; root: Root } {
  history.replaceState(null, '', start);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <ServicesContext.Provider value={services(d)}>
        <Shell />
      </ServicesContext.Provider>,
    ),
  );
  return { host, root };
}

const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const eps = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>('.scene-nav-ep')];
const sceneRows = (host: HTMLElement) => [...host.querySelectorAll<HTMLAnchorElement>('.scene-nav-row')];
const complete = (host: HTMLElement) => !!host.querySelector('.mp-title') && !host.querySelector('.mp-reading');
const scenesPart = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('.ov-part')].find((p) => p.querySelector('.ov-part-name')?.textContent === 'Scenes');

async function owner(): Promise<{ d: Device; built: Built }> {
  const d = await makeDevice(new FakeServer());
  devices.push(d);
  const built = await buildProject(d, fakePhoto, { days: true });
  return { d, built };
}

describe('Overview y Scenes en la barra lateral', () => {
  it('por episodio, plegable y recordada por proyecto; cada escena abre todas sus páginas, por etapa, y lleva al lugar exacto', async () => {
    const { d, built } = await owner();
    const { host } = mount(d, pagePath(built.ids.notas));
    await shown(() => expect(eps(host).length).toBe(3));
    const head = scenesPart(host)!;
    // Adentro de Overview, arriba de Pages (D772); sin tooltip (Lega, D808: no agregaba nada), con el total y los
    // episodios cerrados. De fábrica, Scenes es la parte desplegada.
    expect(head.textContent).toBe('Scenes24');
    expect(head.querySelector('[data-tip]')).toBeNull();
    expect(host.querySelectorAll('.sidebar [title]').length).toBe(0);
    const nav = host.querySelector('.sidebar')!;
    const order = [...nav.querySelectorAll('.ov-nav, .section-title')].map((x) => (x.classList.contains('ov-nav') ? 'overview' : 'pages'));
    expect(order).toEqual(['overview', 'pages']);
    // Las escenas primero, como en Pages (D818).
    // Todas las partes, siempre (D825).
    expect([...nav.querySelectorAll('.ov-part-name')].map((a) => a.textContent)).toEqual(['Scenes', 'Locations', 'Sets', 'Shoot days', 'Shots', 'Pending']);
    expect(eps(host).map((b) => [b.textContent, b.getAttribute('aria-expanded')])).toEqual([
      ['Episode 10118', 'false'],
      ['Episode 1042', 'false'],
      ['Episode 1054', 'false'],
    ]);
    expect(sceneRows(host)).toEqual([]);
    // Abrir el 105: número y título en vivo.
    click(eps(host)[2]);
    expect(sceneRows(host).map((r) => [r.querySelector('.code')!.textContent, r.querySelector('.title')!.textContent])).toEqual([
      ['105_025', 'El fugitivo espera escondido'],
      ['105_026', 'El fugitivo cruza la ruta'],
      ['105_027', 'La ambulancia empieza a zigzaguear'],
      ['105_029', 'El fugitivo abre los ojos'],
    ]);
    // El título cambia en vivo.
    await act(() => d.tree.rename(built.ids.s026, '026 | El fugitivo cruza la autopista'));
    await shown(() => expect(sceneRows(host)[1].querySelector('.title')!.textContent).toBe('El fugitivo cruza la autopista'));

    // La escena: dónde está cada cosa, por etapa (D783).
    const r027 = sceneRows(host)[2];
    expect(r027.getAttribute('href')).toBe('/map/scenes?scene=105_027');
    click(r027);
    await shown(() => expect(complete(host) && host.querySelector('.mp-scene .ss')).toBeTruthy());
    expect(location.pathname + location.search).toBe('/map/scenes?scene=105_027');
    expect(sceneRows(host)[2].classList.contains('active')).toBe(true);
    const view = host.querySelector<HTMLElement>('.mp-scene')!;
    expect(view.querySelector('.mp-sh')!.textContent).toBe('105_027La ambulancia empieza a zigzaguear');
    expect(view.querySelector('.mp-smeta')!.textContent).toBe('Episode 105 · INT-EXT/NOCHE · 3 shots · shot on 3 days');
    // Un renglón por tipo, «Etapa | Tipo» y sus links; vacío, lo dice (ya leyó todo).
    expect([...view.querySelectorAll('.ss-row')].map((r) => r.textContent)).toEqual([
      'Preproduction | Breakdown027 | La ambulancia empieza a zigzaguear · 3 shots',
      'Preproduction | LocationLa Arenera (estudio), CENADE',
      'Preproduction | SetAmbulancia | Ruta INT',
      'Preproduction | Open questions? ¿Todo el interior de la ambulancia se filma en estudio o solo el vuelco? · in 2 cards · +1',
      'Scouting | ReportsTech scout 06/01',
      'Planning | Day planNo day plan names it',
      'Shoot | ReportsDía 59 · 19 Feb › Escena 105_027b · 5 photosDía 70 · 6 Mar › Escena 105_027A + 029B · 4 photosDía 76 · 14 Mar › Escena 5-27, Escena 5-27A · 4 photos',
      'Other | Also named inNotas de dirección1 index page ▾',
    ]);
    // Los links en el color de lo que son (D774): la escena, la locación, el día; lo demás, en el acento.
    const row = (id: string) => view.querySelector<HTMLElement>(`.ss-row[data-row="${id}"]`)!;
    expect(row('breakdown').querySelector('a')!.className).toBe('ss-a scene');
    expect([...row('location').querySelectorAll('a')].map((a) => a.className)).toEqual(['ss-a loc', 'ss-a loc']);
    expect(row('shoot').querySelector('a')!.className).toBe('ss-a day');
    expect(row('scouting').querySelector('a')!.className).toBe('ss-a');
    // Las páginas índice, plegadas.
    const idx = row('other').querySelector<HTMLButtonElement>('.ss-more')!;
    expect(idx.getAttribute('aria-expanded')).toBe('false');
    expect(row('other').querySelector('.ss-idx')).toBeNull();
    click(idx);
    expect(row('other').querySelectorAll('.ss-idx a')).toHaveLength(1);
    // *Export…* pide la ventana con las 9 páginas de la lista, en su orden y sin la página índice.
    const exported: { kind: string; id: string; title: string; ids: string[] }[] = [];
    const onExport = (e: Event) => exported.push((e as CustomEvent).detail);
    window.addEventListener('shotdocs:export', onExport);
    try {
      click([...view.querySelectorAll('button')].find((b) => b.textContent === 'Export…')!);
    } finally {
      window.removeEventListener('shotdocs:export', onExport);
    }
    expect(exported).toHaveLength(1);
    expect(exported[0]).toMatchObject({ kind: 'pages', id: 'scene:105_027', title: 'Scene 105_027' });
    expect(exported[0].ids).toHaveLength(9);
    expect(exported[0].ids).toEqual(expect.arrayContaining([built.ids.s027, built.ids.d59, built.ids.d70, built.ids.d76, built.ids.notas]));
    // El filtro de la lista no está en la vista de una escena.
    expect(host.querySelector('.mp-filter')).toBeNull();
    // Un lugar lleva a la sección exacta del día (el mismo pedido que la búsqueda, lo toma el editor).
    const session = searchSession(services(d));
    const asked: unknown[] = [];
    const request = session.requestResult.bind(session);
    session.requestResult = (r) => {
      asked.push(r);
      request(r);
    };
    const d59 = row('shoot').querySelector('.ss-line')!;
    expect(d59.querySelector('a.day')!.getAttribute('href')).toBe(pagePath(built.ids.d59));
    click([...d59.querySelectorAll('a')].find((a) => a.textContent === 'Escena 105_027b'));
    await wait();
    expect(location.pathname).toBe(pagePath(built.ids.d59));
    expect(asked).toEqual([expect.objectContaining({ pageId: built.ids.d59, term: null, place: { endBlockId: expect.any(String) } })]);

    // Lo plegado se recuerda por proyecto: al volver a montar, el 105 sigue abierto; plegar la sección entera, también.
    expect(JSON.parse(localStorage.getItem('shotdocs-overview-nav')!)[built.projectId]).toEqual({ closed: false, part: 'scenes', eps: ['105'] });
    click(scenesPart(host)!.querySelector('.toggle'));
    expect(eps(host)).toEqual([]);
    for (const r of roots.splice(0)) act(() => r.unmount());
    const again = mount(d, pagePath(built.ids.notas)).host;
    await shown(() => expect(scenesPart(again)).toBeTruthy());
    expect(eps(again)).toEqual([]);
    click(scenesPart(again)!.querySelector('.toggle'));
    expect(eps(again).map((b) => b.getAttribute('aria-expanded'))).toEqual(['false', 'false', 'true']);
    // Un episodio a la vez (D745): abrir el 104 cierra el 105, así Pages no queda muy abajo.
    click(eps(again)[1]);
    expect(eps(again).map((b) => b.getAttribute('aria-expanded'))).toEqual(['false', 'true', 'false']);
    expect(sceneRows(again).map((r) => r.querySelector('.code')!.textContent)).toEqual(['104_008', '104_009']);
  });

  it('Overview y Pages son títulos iguales; Pages se pliega, se recuerda por proyecto y abrir una página la despliega', async () => {
    const { d, built } = await owner();
    // En `/map` no hay página abierta que diga el proyecto: el elegido en el dispositivo.
    localStorage.setItem(legacyStorageNames(WANKA_LOCAL_KEY).project, JSON.stringify({ [d.remote.userId]: built.projectId }));
    const { host } = mount(d, mapPath());
    await shown(() => expect(host.querySelector('.ov-head')).toBeTruthy());
    // Los dos con la misma letra de título (D770, D772); en `/map`, Locations elegida como una página y desplegada sola.
    const titles = [...host.querySelectorAll('.sidebar .nav-title')];
    expect(titles.map((t) => t.querySelector('.nav-title-label')!.textContent)).toEqual(['Overview', 'Pages']);
    await shown(() => expect(host.querySelector('.ov-part.on .ov-part-name')!.textContent).toBe('Locations'));
    expect(host.querySelector('.ov-part.on .ov-part-name')!.getAttribute('aria-current')).toBe('page');
    expect([...host.querySelectorAll('.ov-part .toggle[aria-expanded="true"]')]).toHaveLength(1);
    // Pages, plegada: sin filas del árbol, y lo recuerda al volver a montar.
    const pages = () => host.querySelector<HTMLButtonElement>('.pages-head')!;
    expect(pages().getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelectorAll('.sidebar .tree-row').length).toBeGreaterThan(0);
    click(pages());
    expect(pages().getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelectorAll('.sidebar .tree-row')).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem('shotdocs-pages-nav')!)).toEqual({ [built.projectId]: true });
    for (const r of roots.splice(0)) act(() => r.unmount());
    const again = mount(d, mapPath()).host;
    await shown(() => expect(again.querySelector('.pages-head')).toBeTruthy());
    expect(again.querySelector('.pages-head')!.getAttribute('aria-expanded')).toBe('false');
    expect(again.querySelectorAll('.sidebar .tree-row')).toHaveLength(0);
    // Abrir una página (acá, por la dirección, como un link) despliega Pages con su fila elegida.
    act(() => navigate(pagePath(built.ids.notas)));
    await wait();
    expect(again.querySelector('.pages-head')!.getAttribute('aria-expanded')).toBe('true');
    expect(again.querySelector('.sidebar .tree-row.active')!.textContent).toContain('Notas de dirección');
    expect(localStorage.getItem('shotdocs-pages-nav')).toBe('{}');
    // Plegarla con la página abierta queda plegada aunque el árbol cambie.
    click(again.querySelector('.pages-head'));
    await act(() => d.tree.rename(built.ids.notas, 'Notas de dirección 2'));
    await wait();
    expect(again.querySelector('.pages-head')!.getAttribute('aria-expanded')).toBe('false');
    // Abrir una página de otro proyecto (cambiar de proyecto) no despliega ni borra lo plegado del primero.
    const other = await d.tree.createProject('Otro');
    const page = await d.tree.create(null, 'Suelta', other);
    act(() => navigate(pagePath(page)));
    await wait();
    expect(JSON.parse(localStorage.getItem('shotdocs-pages-nav')!)).toEqual({ [built.projectId]: true });
    act(() => navigate(pagePath(built.ids.notas)));
    await wait();
    expect(again.querySelector('.pages-head')!.getAttribute('aria-expanded')).toBe('false');
    // El tour (o «Mostrame») que señala el árbol lo despliega.
    act(() => void window.dispatchEvent(new CustomEvent('shotdocs:tour-anchor', { detail: 'pages' })));
    await wait();
    expect(again.querySelector('.pages-head')!.getAttribute('aria-expanded')).toBe('true');
  });

  it('Overview: el nombre de una parte abre su vista y despliega solo esa; la flecha solo pliega; el título pliega todo', async () => {
    const { d, built } = await owner();
    const { host } = mount(d, pagePath(built.ids.notas));
    await shown(() => expect(scenesPart(host)).toBeTruthy());
    const part = (name: string) => [...host.querySelectorAll<HTMLElement>('.ov-part')].find((p) => p.querySelector('.ov-part-name')!.textContent === name)!;
    const open = () => [...host.querySelectorAll('.ov-part .toggle[aria-expanded="true"]')].map((b) => b.closest('.ov-part')!.querySelector('.ov-part-name')!.textContent);
    expect(open()).toEqual(['Scenes']);
    // *Shoot days*: abre su pestaña, lista los días (cada uno a su página) y pliega *Scenes*.
    click(part('Shoot days').querySelector('.ov-part-name'));
    await shown(() => expect(location.pathname).toBe('/map/days'));
    expect(open()).toEqual(['Shoot days']);
    expect(part('Shoot days').classList.contains('on')).toBe(true);
    // Otro clic del mouse en la parte abierta la pliega, sin cambiar de vista; el siguiente la despliega (D826). Enter
    // (un clic sin mouse, `detail` 0) y el segundo clic de un doble clic no la pliegan.
    const mouse = (el: Element | null, detail = 1) => act(() => void el!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail })));
    click(part('Shoot days').querySelector('.ov-part-name'));
    expect(open()).toEqual(['Shoot days']);
    mouse(part('Shoot days').querySelector('.ov-part-name'), 2);
    expect(open()).toEqual(['Shoot days']);
    mouse(part('Shoot days').querySelector('.ov-part-name'));
    expect(open()).toEqual([]);
    expect(location.pathname).toBe('/map/days');
    mouse(part('Shoot days'));
    expect(open()).toEqual(['Shoot days']);
    const day = host.querySelector<HTMLAnchorElement>(`.ov-list a[href="${pagePath(built.ids.d59)}"]`)!;
    expect(day.querySelector('.code')!.textContent).toBe('Día 59');
    // Sin tooltip: la fila ya muestra las locaciones del día (D794).
    expect(day.querySelector<HTMLElement>('.title')!.hasAttribute('data-tip')).toBe(false);
    // Las locaciones del día, en su color (D774).
    expect(day.querySelector('.title')!.classList.contains('locs')).toBe(true);
    click(day);
    await wait();
    expect(location.pathname).toBe(pagePath(built.ids.d59));
    expect(day.classList.contains('active')).toBe(true);
    // La flecha solo pliega: no cambia de vista.
    click(part('Shoot days').querySelector('.toggle'));
    expect(open()).toEqual([]);
    expect(location.pathname).toBe(pagePath(built.ids.d59));
    // Un clic en cualquier lugar de la fila (o en su flecha) deja el foco en la parte, como en *Pages*: si quedara en
    // el documento o en el botón, las flechas desplazarían la barra en vez de recorrerla (Lega, D808).
    host.querySelector<HTMLElement>('.ov-fold')!.focus();
    click(part('Scenes'));
    expect(document.activeElement).toBe(part('Scenes').querySelector('.ov-part-name'));
    click(part('Locations').querySelector('.toggle'));
    expect(document.activeElement).toBe(part('Locations').querySelector('.ov-part-name'));
    click(part('Locations').querySelector('.toggle'));
    // El título pliega el bloque entero (y se recuerda); tocar el nombre lo vuelve a abrir en la parte desplegada o, sin
    // ninguna, en la primera, *Scenes* (D818).
    click(host.querySelector('.ov-fold'));
    expect(host.querySelector('.ov-parts')).toBeNull();
    expect(JSON.parse(localStorage.getItem('shotdocs-overview-nav')!)[built.projectId]).toMatchObject({ closed: true });
    click(host.querySelector('.ov-head'));
    await shown(() => expect(host.querySelector('.ov-parts')).toBeTruthy());
    expect(location.pathname).toBe('/map/scenes');
  });

  it('el número de una escena en el árbol lleva su color (D773); el de su episodio, no', async () => {
    const { d, built } = await owner();
    const { host } = mount(d, pagePath(built.ids.s027));
    await shown(() => expect(host.querySelector('.sidebar .tree-row.active .code')).toBeTruthy());
    const code = (row: Element) => row.querySelector('.code')!;
    const active = host.querySelector('.sidebar .tree-row.active')!;
    expect(code(active).textContent).toBe('027');
    expect(code(active).classList.contains('scene')).toBe(true);
    const rows = [...host.querySelectorAll('.sidebar .tree-row')];
    const episode = rows.find((r) => r.querySelector('.code')?.textContent === '105')!;
    expect(code(episode).classList.contains('scene')).toBe(false);
  });

  it('Overview sin locaciones: `/map` no pliega Scenes y el título abre la primera parte con algo', async () => {
    const d = await makeDevice(new FakeServer());
    devices.push(d);
    const projectId = await d.tree.createProject('Corto');
    const folder = await d.tree.create(null, 'Escenas', projectId);
    await d.tree.setPatch(folder, { settings: { holds: 'scene' } as PageSettings });
    for (let i = 1; i <= 3; i++) await d.tree.create(folder, `${String(i).padStart(3, '0')} | Escena ${i}`, projectId);
    await d.engine.syncNow();
    const { host } = mount(d, pagePath(folder));
    await shown(() => expect(scenesPart(host)).toBeTruthy());
    expect([...host.querySelectorAll('.ov-part-name')].map((a) => a.textContent)).toEqual(['Scenes', 'Locations', 'Sets', 'Shoot days', 'Shots', 'Pending']);
    // Una parte vacía está, con su 0 apagado (cuando terminó de leer: mientras lee, un cero no se afirma, D402) y sin
    // flecha para desplegar (no hay nada adentro).
    const locations = host.querySelector('[data-tour="overview-locations"]')!;
    await shown(() => expect(locations.querySelector('.scene-nav-n')?.textContent).toBe('0'));
    expect(locations.querySelector('.scene-nav-n')!.className).toBe('scene-nav-n zero');
    expect(locations.querySelector('.toggle')).toBeNull();
    // Un clic en la parte vacía abre su vista y no pliega Scenes, que estaba desplegada.
    const before = scenesPart(host)!.querySelector('.toggle')!.getAttribute('aria-expanded');
    click(locations.querySelector('.ov-part-name'));
    await wait();
    expect(location.pathname).toBe(mapPath('locations'));
    expect(scenesPart(host)!.querySelector('.toggle')!.getAttribute('aria-expanded')).toBe(before);
    act(() => navigate(mapPath()));
    await wait();
    expect(scenesPart(host)!.querySelector('.toggle')!.getAttribute('aria-expanded')).toBe('true');
    expect(JSON.parse(localStorage.getItem('shotdocs-overview-nav') ?? '{}')[projectId]?.part ?? 'scenes').toBe('scenes');
    click(scenesPart(host)!.querySelector('.toggle'));
    expect(host.querySelector('.ov-head .nav-title-label')!.getAttribute('href')).toBe('/map/scenes');
  });

  it('Overview › Scenes: «N pages» despliega la misma lista; un número que no es escena no dice nada falso', async () => {
    const { d, built } = await owner();
    const { host } = mount(d, pagePath(built.ids.notas));
    await shown(() => expect(host.querySelector('.ov-nav')).toBeTruthy());
    act(() => navigate(mapPath('scenes')));
    await shown(() => expect(complete(host) && host.querySelectorAll('.mp-srow:not(.head)').length).toBe(24));
    const row = [...host.querySelectorAll<HTMLElement>('.mp-srow:not(.head)')].find((r) => r.textContent!.startsWith('105_027'))!;
    const btn = row.querySelector<HTMLButtonElement>('.mp-pages')!;
    expect(btn.textContent).toBe('9 pages');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(row.querySelector('.mp-sexp')).toBeNull();
    click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect([...row.querySelectorAll('.mp-sexp .ss-row')].map((r) => r.textContent)).toEqual([
      'Preproduction | Breakdown027 | La ambulancia empieza a zigzaguear · 3 shots',
      'Preproduction | LocationLa Arenera (estudio), CENADE',
      'Preproduction | SetAmbulancia | Ruta INT',
      'Preproduction | Open questions? ¿Todo el interior de la ambulancia se filma en estudio o solo el vuelco? · in 2 cards · +1',
      'Scouting | ReportsTech scout 06/01',
      'Planning | Day planNo day plan names it',
      'Shoot | ReportsDía 59 · 19 Feb › Escena 105_027b · 5 photosDía 70 · 6 Mar › Escena 105_027A + 029B · 4 photosDía 76 · 14 Mar › Escena 5-27, Escena 5-27A · 4 photos',
      'Other | Also named inNotas de dirección1 index page ▾',
    ]);
    // Una escena de la página índice que nadie más nombra: la escena sola, y lo dice.
    const lone = [...host.querySelectorAll<HTMLElement>('.mp-srow:not(.head)')].find((r) => r.textContent!.startsWith('101_005'))!;
    expect(lone.querySelector('.mp-pages')!.textContent).toBe('1 page');
    click(lone.querySelector('.mp-pages'));
    // Sin nada en cada etapa, cada renglón lo dice (ya leyó todo); la página índice, plegada.
    expect(lone.querySelector('.ss-row[data-row="shoot"]')!.textContent).toBe('Shoot | ReportsNo report section');
    expect(lone.querySelector('.ss-row[data-row="scouting"]')!.textContent).toBe('Scouting | ReportsNo scouting names it');
    expect(lone.querySelector('.ss-row[data-row="other"] .ss-more')!.textContent).toBe('1 index page ▾');
    // Una dirección con un número que no es una escena.
    act(() => navigate('/map/scenes?scene=105_999'));
    await shown(() => expect(host.querySelector('.mp-scene .mp-empty')!.textContent).toBe('105_999 isn’t a scene of this project.'));
    // «All scenes» vuelve a la lista.
    click(host.querySelector('.mp-back'));
    await shown(() => expect(host.querySelectorAll('.mp-srow:not(.head)').length).toBe(24));
    expect(location.search).toBe('');
    // El número de la dirección se lee con el lector de la lupa (O3): otra forma lleva a la misma escena.
    for (const q of ['105-027', '5027', '105_027b']) {
      act(() => navigate(`/map/scenes?scene=${q}`));
      await shown(() => expect(host.querySelector('.mp-scene .mp-sh')?.textContent, q).toBe('105_027La ambulancia empieza a zigzaguear'));
    }
    // Desde la vista de una escena, la pestaña Scenes vuelve a la lista y Locations de la barra a su pestaña (O1).
    click(host.querySelector('.mp-tab[href="/map/scenes"]'));
    await shown(() => expect(host.querySelectorAll('.mp-srow:not(.head)').length).toBe(24));
    act(() => navigate('/map/scenes?scene=105_027'));
    await shown(() => expect(host.querySelector('.mp-scene .ss')).toBeTruthy());
    click(host.querySelector('.ov-part-name[href="/map"]'));
    await shown(() => expect(location.pathname + location.search).toBe('/map'));
    await shown(() => expect(host.querySelector('.mp-lrow:not(.head)')).toBeTruthy());
    // Nada se escribió en los documentos.
    const doc = await d.docs.open(built.ids.d59);
    const before = Y.encodeStateVector(doc);
    await wait(100);
    expect(Y.encodeStateVector(doc)).toEqual(before);
    d.docs.close(built.ids.d59);
  });

  it('un invitado ve solo sus escenas y sus páginas, y nunca lee que algo no existe', async () => {
    const server = new FakeServer();
    server.enableTeam();
    const o = await makeDevice(server);
    devices.push(o);
    const built = await buildProject(o, fakePhoto, { days: true, indexPage: false });
    await o.tree.setPatch(built.ids.s027, { settings: { entity: { kind: 'scene', code: '105_027' } } as unknown as PageSettings });
    await o.tree.setPatch(built.ids.d70, { settings: { entity: { kind: 'day' } } as unknown as PageSettings });
    await o.engine.syncNow();
    server.addMember('ana', 'member', 'ana@test');
    server.grant('ana', { pageId: built.ids.s027 }, 'view');
    server.grant('ana', { pageId: built.ids.d70 }, 'view');
    const guest = await makeDevice(server, crypto.randomUUID(), '0.021', {}, undefined, { id: 'ana', email: 'ana@test' });
    devices.push(guest);
    await guest.engine.syncNow();
    await guest.engine.syncNow();
    const { host } = mount(guest, pagePath(built.ids.d70));
    // Una sola escena: va directo, sin renglón de episodio.
    await shown(() => expect(sceneRows(host).map((r) => r.querySelector('.code')!.textContent)).toEqual(['105_027']));
    expect(eps(host)).toEqual([]);
    click(sceneRows(host)[0]);
    await shown(() => expect(complete(host) && host.querySelector('.mp-scene .ss')).toBeTruthy());
    const view = host.querySelector<HTMLElement>('.mp-scene')!;
    // Las páginas que no ve no aparecen (la ficha dice «CENADE» en su texto: se busca por el título de cada página).
    const titles = [...view.querySelectorAll('.ss a')].map((a) => a.textContent);
    for (const k of ['d59', 'd76', 'scout', 'notas', 'cenade']) expect(titles).not.toContain(o.tree.get(built.ids[k])!.title);
    expect(view.textContent).toContain('Día 70');
    // Lo que no ve se dice «que veas», nunca «no hay» (D401).
    expect(view.querySelector('.ss-row[data-row="scouting"]')!.textContent).toBe('Scouting | ReportsNo scouting you can see names it');
    // Una escena que no ve: «no está en las páginas que ves», nunca «no existe» (D401).
    act(() => navigate('/map/scenes?scene=105_029'));
    await shown(() => expect(host.querySelector('.mp-scene .mp-empty')!.textContent).toBe('105_029 isn’t in the pages you can see.'));
    expect(host.textContent).not.toMatch(/isn’t a scene|doesn.t exist/);
  });

  it('un proyecto sin escenas tiene el Panorama igual, con todas sus partes en 0 (D825)', async () => {
    const d = await makeDevice(new FakeServer());
    devices.push(d);
    const projectId = await d.tree.createProject('Notas sueltas');
    const page = await d.tree.create(null, 'Brief', projectId);
    await d.engine.syncNow();
    const { host } = mount(d, pagePath(page));
    await shown(() => expect(host.querySelector('.ov-nav')).toBeTruthy());
    expect([...host.querySelectorAll('.ov-part-name')].map((a) => a.textContent)).toEqual(['Scenes', 'Locations', 'Sets', 'Shoot days', 'Shots', 'Pending']);
    await shown(() => expect([...host.querySelectorAll('.ov-part .scene-nav-n')].map((n) => n.textContent)).toEqual(['0', '0', '0', '0']));
    expect(host.querySelectorAll('.ov-part .toggle').length).toBe(0);
  });

  it('226 escenas sin episodios: dibuja de a tandas, la abierta siempre se ve, y es rápido', async () => {
    const d = await makeDevice(new FakeServer());
    devices.push(d);
    const projectId = await d.tree.createProject('Largo');
    const folder = await d.tree.create(null, 'Escenas', projectId);
    await d.tree.setPatch(folder, { settings: { holds: 'scene' } as PageSettings });
    for (let i = 1; i <= 226; i++) await d.tree.create(folder, `${String(i).padStart(3, '0')} | Escena ${i}`, projectId);
    await d.engine.syncNow();
    const { host } = mount(d, pagePath(folder));
    await shown(() => expect(host.querySelector('.scene-nav-n')?.textContent).toBe('226'), 20000);
    // Un solo grupo: sin renglón de episodio; las primeras tandas y «Show N more».
    expect(eps(host)).toEqual([]);
    expect(sceneRows(host).length).toBe(SCENES_PAGE);
    const more = () => host.querySelector<HTMLButtonElement>('.scene-nav-more');
    expect(more()!.textContent).toBe(`Show ${SCENES_PAGE} more`);
    const t0 = performance.now();
    click(more());
    const ms = performance.now() - t0;
    expect(sceneRows(host).length).toBe(2 * SCENES_PAGE);
    expect(ms).toBeLessThan(500);
    // Abrir la 200 (desde una dirección): su fila se dibuja aunque esté más allá del límite, y queda marcada.
    act(() => navigate('/map/scenes?scene=200'));
    await shown(() => expect(host.querySelector('.scene-nav-row.active .code')?.textContent).toBe('200'));
    expect(sceneRows(host).length).toBe(200);
    expect(host.querySelector('.scene-nav-more')!.textContent).toBe('Show 26 more');
  }, 120_000);

  it('salir de la vista de una escena no rompe la app (en Chromium scrollIntoView devuelve una promesa)', async () => {
    const { d, built } = await owner();
    const before = Element.prototype.scrollIntoView;
    // Así lo hace el Chromium del recorrido: React tomaba la promesa como la limpieza del efecto y la app caía.
    Element.prototype.scrollIntoView = (() => Promise.resolve()) as never;
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => errors.push(e.error);
    window.addEventListener('error', onError);
    try {
      const { host } = mount(d, pagePath(built.ids.notas));
      await shown(() => expect(eps(host).length).toBe(3));
      act(() => navigate('/map/scenes?scene=105_027'));
      await shown(() => expect(host.querySelector('.mp-scene .ss')).toBeTruthy());
      act(() => navigate('/map/scenes?scene=105_029'));
      await shown(() => expect(host.querySelector('.mp-sh')!.textContent).toContain('105_029'));
      await shown(() => expect(host.querySelector('.mp-scene .ss-row[data-row="breakdown"] a')).toBeTruthy());
      click(host.querySelector('.mp-scene .ss-row[data-row="breakdown"] a'));
      await shown(() => expect(host.querySelector('.page-title')).toBeTruthy());
      expect(location.pathname).toBe(pagePath(built.ids.s029));
      expect(errors).toEqual([]);
    } finally {
      window.removeEventListener('error', onError);
      Element.prototype.scrollIntoView = before;
    }
  });
});

describe('los renglones mientras el índice lee', () => {
  it('dicen «Reading…» y nunca que no hay nada; ya leído, que no hay', async () => {
    const v = { pageId: 'a', complete: false, shots: [], cards: [], sets: [], plannedAt: [], questions: [], scoutPages: [], scoutsVia: [], testPages: [], plans: [], days: [] } as unknown as SceneLive;
    const o = { self: false, title: () => '027 | La ambulancia', locPage: () => null, others: [], index: [] };
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    act(() => root.render(<ServicesContext.Provider value={{} as Services}><SceneStages rows={sceneStageRows(v, o)} partial={false} /></ServicesContext.Provider>));
    expect([...host.querySelectorAll('.ss-none')].map((e) => e.textContent)).toEqual(['Reading…', 'Reading…', 'Reading…', 'Reading…']);
    expect(host.textContent).not.toContain('No scouting');
    act(() => root.render(<ServicesContext.Provider value={{} as Services}><SceneStages rows={sceneStageRows({ ...v, complete: true }, o)} partial /></ServicesContext.Provider>));
    expect(host.textContent).toContain('No scouting you can see names it');
    expect(host.textContent).not.toContain('Reading…');
  });
});

describe('el Overview de solo lectura (D815)', () => {
  const part = (host: HTMLElement, name: string) => [...host.querySelectorAll<HTMLElement>('.ov-part')].find((p) => p.querySelector('.ov-part-name')?.textContent === name);
  const pagesRows = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('.pages-section .tree-row')];

  it('Pages muestra todo lo escrito; una locación o un decorado del Overview abre su resumen, sin editor, y su nombre abre la página en Pages', async () => {
    const { d, built } = await owner();
    await d.tree.setSetting(built.ids.decorados, 'holds', 'set');
    const { host } = mount(d, pagePath(built.ids.notas));
    await shown(() => expect(part(host, 'Locations')).toBeTruthy());
    // Las carpetas de escenas, locaciones y decorados siguen en Pages: es donde se escribe.
    const titles = pagesRows(host).map((r) => r.getAttribute('aria-label'));
    expect(titles).toEqual(expect.arrayContaining(['1.1 | Desglose', '1.2 | Locaciones y scoutings', '1.3 | Decorados']));
    // Ninguna escena, locación ni decorado tiene un «+» ni un ⋯ en el Overview: se crean y se ordenan en Pages.
    expect(host.querySelectorAll('.ov-nav .tree-row, .ov-nav .ov-add, .ov-nav .ov-more')).toHaveLength(0);

    click(part(host, 'Locations')!.querySelector('.toggle'));
    const cenade = () => [...host.querySelectorAll<HTMLAnchorElement>('.ov-locs .scene-nav-row')].find((a) => a.textContent === 'CENADE')!;
    await shown(() => expect(cenade()).toBeTruthy());
    expect(cenade().getAttribute('href')).toBe(`${mapPath('locations')}?page=${built.ids.cenade}`);
    click(cenade());
    await shown(() => expect(host.querySelector('.mp-scene .lh')).toBeTruthy());
    expect(location.pathname + location.search).toBe(`${mapPath('locations')}?page=${built.ids.cenade}`);
    expect(cenade().classList.contains('active')).toBe(true);
    const view = host.querySelector<HTMLElement>('.mp-scene')!;
    expect(view.querySelector('.mp-sh')!.textContent).toBe('LocationCENADE');
    // Siempre abierta, sin «Collapse», y sin nada para escribir: el resumen se arma solo.
    expect(view.querySelector('.lh-tools .lh-tbtn')).toBeNull();
    expect(view.querySelector('[contenteditable="true"]')).toBeNull();
    expect(view.textContent).toContain('Tech scout 06/01');
    // El nombre abre la página, que se ve en Pages, en su carpeta.
    click(view.querySelector('.mp-sh .mp-link'));
    await shown(() => expect(location.pathname).toBe(pagePath(built.ids.cenade)));
    await shown(() => expect(host.querySelector('.pages-section .tree-row.active')?.getAttribute('data-page')).toBe(built.ids.cenade));

    // Un decorado, lo mismo.
    // Abrir la vista de la parte la despliega.
    act(() => navigate(mapPath('sets')));
    const set = () => [...host.querySelectorAll<HTMLAnchorElement>('.ov-sets .scene-nav-row')].find((a) => a.textContent === 'Ambulancia | Ruta INT')!;
    await shown(() => expect(set()).toBeTruthy());
    click(set());
    await shown(() => expect(host.querySelector('.mp-scene .lh')).toBeTruthy());
    expect(location.search).toBe(`?page=${built.ids.set_int}`);
    expect(host.querySelector('.mp-scene .mp-sh')!.textContent).toBe('SetAmbulancia | Ruta INT');
    expect(host.querySelector('.mp-scene .lh-tools .lh-tbtn')).toBeNull();
  });

  it('un día abierto desde Shoot days se ve en Pages; el plan y el reporte del mismo día llevan su etiqueta', async () => {
    const { d, built } = await owner();
    // El plan del día 59, arriba de su reporte (D813).
    const plan = await d.tree.create(built.ids.rodaje, '2026-02-19 | Día 59 | CENADE | Plan', built.projectId, { before: built.ids.d59 });
    const { host } = mount(d, pagePath(built.ids.notas));
    await shown(() => expect(part(host, 'Shoot days')).toBeTruthy());
    click(part(host, 'Shoot days')!.querySelector('.toggle'));
    const day = () => [...host.querySelectorAll<HTMLAnchorElement>('.ov-days .scene-nav-row')].find((a) => a.getAttribute('href') === pagePath(built.ids.d59))!;
    await shown(() => expect(day()).toBeTruthy());
    click(day());
    await shown(() => expect(location.pathname).toBe(pagePath(built.ids.d59)));
    // La página del día vive en Pages: ahí queda marcada, en su carpeta, y Shoot days sigue abierta.
    await shown(() => expect(host.querySelector('.pages-section .tree-row.active')?.getAttribute('data-page')).toBe(built.ids.d59));
    expect(day().classList.contains('active')).toBe(true);
    // PLN y REP, en el lugar del triángulo: el mismo nombre ya no confunde.
    const stage = (id: string) => host.querySelector(`.pages-section .tree-row[data-page="${id}"] .tree-stage`);
    await shown(() => expect(stage(plan)?.textContent).toBe('PLN'));
    expect(stage(plan)!.getAttribute('data-stage')).toBe('plan');
    expect(stage(built.ids.d59)!.textContent).toBe('REP');
    expect(stage(built.ids.d58)!.getAttribute('data-stage')).toBe('report');
    const order = pagesRows(host).map((r) => r.getAttribute('data-page'));
    expect(order.indexOf(plan)).toBe(order.indexOf(built.ids.d59) - 1);
    // Dos planes del mismo día se distinguen por su nota, que va en lugar del lugar (el reporte ya lo dice).
    const other = await act(() => d.tree.create(built.ids.rodaje, '2026-02-19 | Día 59 | CENADE | Plan · Casa Rosada', built.projectId, { before: built.ids.d59 }));
    const row = (id: string) => host.querySelector(`.pages-section .tree-row[data-page="${id}"] .label.dated`);
    await shown(() => expect(row(other)?.querySelector('.plan-note')?.textContent).toBe('Casa Rosada'));
    expect(row(other)!.querySelector('.place')).toBeNull();
    expect(row(plan)!.querySelector('.place')?.textContent).toBe('CENADE');
    expect(row(built.ids.d59)!.querySelector('.place')?.textContent).toBe('CENADE');
  });

  it('en Rodaje, un plan que todavía no tiene su reporte ya lleva PLN', async () => {
    const { d, built } = await owner();
    const rodaje = await d.tree.create(null, '4 | Rodaje nuevo', built.projectId);
    await d.tree.setSetting(rodaje, 'holds', 'day');
    const plan = await d.tree.create(rodaje, '2026-11-16 | Día 01 | Estación Vieja | Plan', built.projectId);
    await d.tree.setSetting(plan, 'entity', { kind: 'plan' });
    const { host } = mount(d, pagePath(plan));
    await shown(() => expect(host.querySelector('.pages-section .tree-row.active')?.getAttribute('data-page')).toBe(plan));
    await shown(() => expect(host.querySelector(`.pages-section .tree-row[data-page="${plan}"] .tree-stage`)?.getAttribute('data-stage')).toBe('plan'));
  });

  it('una semana sin planes no lleva etiquetas', async () => {
    const { d, built } = await owner();
    const { host } = mount(d, pagePath(built.ids.d58));
    await shown(() => expect(host.querySelector('.pages-section .tree-row.active')).toBeTruthy());
    expect(host.querySelectorAll('.pages-section .tree-stage')).toHaveLength(0);
  });
});
