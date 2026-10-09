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
import { buildProject, writeBlocks, type Built } from './fixtures/proyectoSintetico';
import { DOT_GAP, dotGap, groupDots } from './MapView';
import { canMergeWith } from './MergeAction';

// El mapa en la app de verdad (Docs/Doc_Relaciones.md, sección 12) y la lupa por entidades (Docs/Doc_Buscar.md,
// «Escenas y locaciones primero»): la fila Map de la barra lateral, las cuatro pestañas, cada fila lleva a su página o al
// lugar exacto, Copy map / Copy JSON con solo lo que se ve, la escena primero en ⌘K, y que nada de esto escribe.

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

let clip: string[] = [];
beforeEach(() => {
  localStorage.clear();
  clip = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => void clip.push(t) } });
});

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

async function until(check: () => unknown, what: string, tries = 250): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (check()) return;
    await wait(40);
  }
  throw new Error(`no llegó: ${what}`);
}

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

function mount(d: Device, start: string): HTMLElement {
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
  return host;
}

async function app(start: (b: Built) => string, prepare?: (d: Device, b: Built) => Promise<void>): Promise<{ d: Device; built: Built; host: HTMLElement }> {
  const d = await makeDevice(new FakeServer());
  devices.push(d);
  const built = await buildProject(d, fakePhoto, { days: true, indexPage: false });
  await prepare?.(d, built);
  // El proyecto abierto es el de la última página: se entra por una página y después se va al mapa.
  const path = start(built);
  const host = mount(d, path.startsWith('/map') ? pagePath(built.ids.s027) : path);
  if (path.startsWith('/map')) {
    await until(() => host.querySelector('.page-title'), 'la página');
    act(() => navigate(path));
  }
  return { d, built, host };
}

const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const rows = (host: HTMLElement, sel: string) => [...host.querySelectorAll<HTMLElement>(sel)].filter((r) => !r.classList.contains('head'));
const complete = (host: HTMLElement) => !!host.querySelector('.mp-title') && !host.querySelector('.mp-reading');

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Todo el texto de una página, con los links como [texto](href). */
async function linkedRuns(d: Device, pageId: string): Promise<string> {
  const doc = await d.docs.open(pageId);
  let out = '';
  const walk = (node: Y.XmlElement | Y.XmlFragment) => {
    for (const child of node.toArray()) {
      if (child instanceof Y.XmlText) {
        for (const op of child.toDelta() as { insert: unknown; attributes?: { link?: { href: string } } }[]) {
          const t = typeof op.insert === 'string' ? op.insert : '';
          out += op.attributes?.link ? `[${t}](${op.attributes.link.href})` : t;
        }
        out += ' ¶ ';
      } else if (child instanceof Y.XmlElement) walk(child);
    }
  };
  walk(doc.getXmlFragment('document-store'));
  d.docs.close(pageId);
  return out;
}

function key(target: EventTarget, init: KeyboardEventInit) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  });
}

describe('el mapa en la app', () => {
  it('la fila Map de la barra lateral abre las Locations en el tiempo; cada fila lleva a su página', async () => {
    const { built, host } = await app((b) => pagePath(b.ids.s027));
    await until(() => host.querySelector('.map-nav'), 'la fila Map');
    const nav = host.querySelector<HTMLAnchorElement>('.map-nav')!;
    expect(nav.getAttribute('href')).toBe('/map');
    expect(nav.textContent).toContain('Map');
    // Un tooltip de la app, nunca `title=`; el pendiente sin número (Plates) se cuenta.
    expect(nav.dataset.tip).toBeTruthy();
    // El mismo número que la pestaña Pending: acá, la sección «Plates ambulancia» sin número (O4).
    await until(() => nav.querySelector('.map-nav-count'), 'el número de la fila Map');
    expect(nav.querySelector('.map-nav-count')!.textContent).toBe('1 pending');
    click(nav);
    await until(() => complete(host) && rows(host, '.mp-lrow').length === 2, 'el mapa completo');
    expect(location.pathname).toBe('/map');
    expect(host.querySelector('.crumb.current')!.textContent).toBe('Map');
    expect(host.querySelector('.mp-lede')!.textContent).toContain('6 scenes · 2 locations · 6 shoot days');
    const [cenade, arenera] = rows(host, '.mp-lrow');
    expect(cenade.querySelector('.mp-nm')!.textContent).toBe('CENADE');
    expect(cenade.querySelector('.mp-ct')!.textContent).toBe('6 scenes · 3 days');
    expect(arenera.querySelector('.mp-nm')!.textContent).toBe('La Arenera (estudio)');
    expect(host.querySelector('.mp-tab[href="/map/pending"] b')!.textContent).toBe('1');
    // Un punto por día, en el tiempo (el de CENADE antes que el de La Arenera), con el título del día en su tooltip. Cada
    // punto es su propio link dentro de un grupo (los días cercanos van juntos, uno al lado del otro: O3; ver groupDots).
    const groups = [...cenade.querySelectorAll<HTMLElement>('.mp-dots')];
    const dots = groups.flatMap((g) => [...g.querySelectorAll<HTMLAnchorElement>('a.mp-dot')]);
    expect(dots.map((x) => x.dataset.tip)).toEqual(['2026-02-18 | Día 58 | CENADE', '2026-02-19 | Día 59 | CENADE', '2026-02-20 | Día 60 | CENADE']);
    expect(dots.map((x) => x.getAttribute('href'))).toEqual([pagePath(built.ids.d58), pagePath(built.ids.d59), pagePath(built.ids.d60)]);
    expect(dots.every((x) => !x.style.left)).toBe(true);
    const left = (el: HTMLElement) => parseFloat(el.style.left);
    expect(left(groups[0])).toBeLessThan(left(arenera.querySelector<HTMLElement>('.mp-dots')!));
    click(dots[1]);
    await wait();
    expect(location.pathname).toBe(pagePath(built.ids.d59));
    act(() => navigate('/map'));
    await until(() => rows(host, '.mp-lrow').length === 2, 'de vuelta en el mapa');
    expect(host.querySelectorAll('.mp [title]').length).toBe(0);
    // El filtro.
    type(host.querySelector<HTMLInputElement>('.mp-filter input')!, 'aren');
    expect(rows(host, '.mp-lrow').map((r) => r.querySelector('.mp-nm')!.textContent)).toEqual(['La Arenera (estudio)']);
    // El nombre lleva a la página de la locación; un punto, al día.
    click(rows(host, '.mp-lrow')[0].querySelector('.mp-link'));
    await wait();
    expect(location.pathname).toBe(pagePath(built.ids.arenera));
  });

  it('la consulta abierta del / no cuenta en la fila Map ni en Pending; al cerrarse, sí (D568)', async () => {
    const { built, host } = await app(
      () => mapPath('pending'),
      async (dev, b) => {
        await writeBlocks(dev, b.ids.notas, [{ p: 'Revisar /e 105_141' }]);
      },
    );
    const count = () => host.querySelector('.map-nav-count')?.textContent;
    await shown(() => expect(count()).toBe('2 pending'));
    await shown(() => expect(host.textContent).toContain('105_141 doesn’t exist yet'));
    // El bloque de la nota (donde está la consulta).
    const { existingRelationsSession } = await import('../ui/relationsUi');
    const { pendingRelations } = await import('./relationIndex');
    const { setSlashDraft } = await import('./slashDraft');
    const snap = existingRelationsSession(services(devices[0]))!.relations.snapshot(built.projectId)!;
    const where = pendingRelations(snap).find((p) => p.ref === '105_141')!.pages[0];
    act(() => setSlashDraft({ pageId: where.pageId, blockId: where.blockIds[0], codes: ['105_141'], query: '/e 105_141' }));
    await shown(() => expect(count()).toBe('1 pending'));
    await shown(() => expect(host.textContent).not.toContain('105_141 doesn’t exist yet'));
    act(() => setSlashDraft(null));
    await shown(() => expect(count()).toBe('2 pending'));
    await shown(() => expect(host.textContent).toContain('105_141 doesn’t exist yet'));
  });

  it('Pending: Assign sobre un número que no existe lo linkea en cada página que lo nombra, con Undo (D567)', async () => {
    const { d, built, host } = await app(
      () => mapPath('pending'),
      async (dev, b) => {
        await writeBlocks(dev, b.ids.notas, [{ p: 'Falta la Escena 105_120 en el desglose.' }]);
        await writeBlocks(dev, b.ids.d58, [{ h: 1, text: 'Info general' }, { p: 'Llamado 8:00, después la 105_120.' }]);
      },
    );
    const card = () => [...host.querySelectorAll<HTMLElement>('.mp-pcard')].find((c) => c.textContent?.includes('105_120'));
    await shown(() => expect(card()?.querySelector('.rel-assign')).toBeTruthy());
    expect(card()!.querySelector('.rel-assign')!.getAttribute('data-tip')).toContain('everywhere');
    click(card()!.querySelector('.rel-assign'));
    type(host.querySelector<HTMLInputElement>('.lh-picker input')!, '5026');
    click(host.querySelector('.lh-picker-list button'));
    const href = `/p/${built.ids.s026}`;
    await shown(async () => {
      expect(await linkedRuns(d, built.ids.notas)).toContain(`[105_120](${href})`);
      expect(await linkedRuns(d, built.ids.d58)).toContain(`[105_120](${href})`);
    });
    await shown(() => expect(host.textContent).toContain('105_120 now links to 105_026 in 2 pages'));
    // El número deja de estar pendiente.
    await shown(() => expect(card()).toBeUndefined());
    click([...host.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === 'Undo'));
    await shown(async () => {
      expect(await linkedRuns(d, built.ids.notas)).not.toContain(href);
      expect(await linkedRuns(d, built.ids.d58)).not.toContain(href);
    });
    await shown(() => expect(card()?.textContent).toContain('105_120 doesn’t exist yet'));
  });

  it('Pending: Assign dice qué páginas que nombran el número no se pueden editar (D666)', async () => {
    const server = new FakeServer();
    server.enableTeam();
    const owner = await makeDevice(server);
    devices.push(owner);
    const built = await buildProject(owner, fakePhoto, { days: true, indexPage: false });
    await writeBlocks(owner, built.ids.notas, [{ p: 'Falta la Escena 105_120 en el desglose.' }]);
    await writeBlocks(owner, built.ids.d58, [{ h: 1, text: 'Info general' }, { p: 'Llamado 8:00, después la 105_120.' }]);
    await owner.engine.syncNow();
    // Beto edita el día y el desglose, y solo ve las notas de dirección.
    server.addMember('beto', 'member', 'beto@test');
    server.grant('beto', { pageId: built.ids.rodaje }, 'edit_pages');
    server.grant('beto', { pageId: built.ids.desglose }, 'edit_pages');
    server.grant('beto', { pageId: built.ids.notas }, 'view');
    const beto = await makeDevice(server, crypto.randomUUID(), '0.021', {}, undefined, { id: 'beto', email: 'beto@test' });
    devices.push(beto);
    await beto.engine.syncNow();
    await beto.engine.syncNow();
    const host = mount(beto, pagePath(built.ids.s027));
    await until(() => host.querySelector('.page-title'), 'la página');
    act(() => navigate(mapPath('pending')));
    const card = () => [...host.querySelectorAll<HTMLElement>('.mp-pcard')].find((c) => c.textContent?.includes('105_120'));
    await shown(() => expect(card()?.querySelector('.rel-assign')).toBeTruthy());
    click(card()!.querySelector('.rel-assign'));
    type(host.querySelector<HTMLInputElement>('.lh-picker input')!, '5026');
    click(host.querySelector('.lh-picker-list button'));
    await shown(() => expect(host.textContent).toContain('105_120 now links to 105_026 in 1 page · also in «Notas de dirección», which you can’t edit'));
    // La página que no podía editar quedó como estaba.
    expect(await linkedRuns(beto, built.ids.notas)).not.toContain(`/p/${built.ids.s026}`);
  });

  it('Scenes por episodio, Shoot days y Pending (con el lugar de los botones de E7); ir a la sección exacta', async () => {
    const { d, built, host } = await app(
      () => mapPath('scenes'),
      async (dev, b) => {
        await writeBlocks(dev, b.ids.notas, [{ p: 'Falta la Escena 105_120 en el desglose.' }]);
        // Un día cuyo título nombra un lugar que no es una locación del proyecto.
        await dev.tree.create(b.ids.rodaje, '2026-02-21 | Día 61 | Frente Ruso', b.projectId);
      },
    );
    await until(() => complete(host) && rows(host, '.mp-srow').length === 6, 'las escenas');
    expect([...host.querySelectorAll('.mp-ghead')].map((x) => x.textContent)).toEqual(['Episode 104 · 2 scenes', 'Episode 105 · 4 scenes']);
    const s027 = rows(host, '.mp-srow').find((r) => r.textContent!.startsWith('105_027'))!;
    expect(s027.querySelector('.mp-st')!.textContent).toBe('La ambulancia empieza a zigzaguear');
    expect(s027.querySelector('.mp-ls')!.textContent).toContain('CENADE · report');
    expect(s027.querySelector('.mp-dd')!.textContent).toBe('Día 59, Día 70, Día 76');
    // Nunca «not shot»: sin sección dice eso, o que está en un plan.
    const s026 = rows(host, '.mp-srow').find((r) => r.textContent!.startsWith('105_026'))!;
    expect(s026.querySelector('.mp-dd')!.textContent).toBe('No report section');
    expect(rows(host, '.mp-srow').find((r) => r.textContent!.startsWith('104_008'))!.querySelector('.mp-dd')!.textContent).toBe('in a plan');
    expect(host.textContent).not.toMatch(/not shot/i);
    // El filtro entiende el número compacto.
    // El filtro entiende cualquier forma del número, con el lector (O6).
    for (const q of ['5027', '105_027b', 'Escena 27', '105-027']) {
      type(host.querySelector<HTMLInputElement>('.mp-filter input')!, q);
      expect(rows(host, '.mp-srow').map((r) => r.querySelector('.mp-code')!.textContent), q).toEqual(['105_027']);
    }
    // Y la fecha de un día con sección.
    type(host.querySelector<HTMLInputElement>('.mp-filter input')!, '2026-03-14');
    expect(rows(host, '.mp-srow').map((r) => r.querySelector('.mp-code')!.textContent)).toEqual(['105_027']);

    // Shoot days.
    click(host.querySelector('.mp-tab[href="/map/days"]'));
    await until(() => rows(host, '.mp-drow').length === 7, 'los días');
    expect(location.pathname).toBe('/map/days');
    const d60 = rows(host, '.mp-drow').find((r) => r.textContent!.includes('Día 60'))!;
    expect(d60.querySelector('.mp-dd')!.textContent).toBe('1 with a section · 2 planned');
    // Sin una locación en el título: lo que dice el título, apagado (O7).
    const d61 = rows(host, '.mp-drow').find((r) => r.textContent!.includes('Día 61'))!;
    expect(d61.querySelector('.mp-ls .mp-none')!.textContent).toBe('Frente Ruso');
    type(host.querySelector<HTMLInputElement>('.mp-filter input')!, '5027');
    expect(rows(host, '.mp-drow').map((r) => r.querySelector('.mp-dt a')!.textContent)).toEqual(['Día 59', 'Día 70', 'Día 76']);

    // Pending: el número que no existe, con dónde; la sección sin número, que lleva ahí.
    click(host.querySelector('.mp-tab[href="/map/pending"]'));
    await until(() => host.querySelectorAll('.mp-pcard').length === 2, 'los pendientes');
    const cards = [...host.querySelectorAll<HTMLElement>('.mp-pcard')];
    expect(cards[0].textContent).toContain('105_120 doesn’t exist yet');
    expect(cards[0].textContent).toContain('Notas de dirección: «Falta la Escena 105_120 en el desglose.»');
    // Los botones de E7: *Create* (acá sin permisos conocidos, el rótulo con el motivo) y, en la sección sin número,
    // *Assign* y *Open section*.
    expect(cards[0].querySelector('.mp-pact')!.textContent).toBe('Create scene 105_120Assign');
    expect(cards[0].querySelector('.mp-pact .rel-cant')!.getAttribute('data-tip')).toContain('whole project');
    expect([...cards[1].querySelectorAll('.mp-pact button')].map((b) => b.textContent)).toEqual(['Assign', 'Open section']);
    expect(cards[1].textContent).toContain('«Plates ambulancia» has no scene number');
    // El pedido de ir a la sección exacta (lo toma el editor del día apenas está listo).
    const session = searchSession(services(d));
    const asked: unknown[] = [];
    const request = session.requestResult.bind(session);
    session.requestResult = (r) => {
      asked.push(r);
      request(r);
    };
    click([...cards[1].querySelectorAll('.mp-pact button')].at(-1));
    await wait();
    expect(location.pathname).toBe(pagePath(built.ids.d59));
    expect(asked).toEqual([expect.objectContaining({ pageId: built.ids.d59, term: null, place: { endBlockId: null } })]);
  });

  it('Copy map y Copy JSON: el portapapeles con lo que se ve, sin escribir nada en los documentos', async () => {
    const { d, built, host } = await app(() => mapPath());
    await until(() => complete(host) && rows(host, '.mp-lrow').length === 2, 'el mapa completo');
    const doc = await d.docs.open(built.ids.d59);
    const before = Y.encodeStateVector(doc);
    const [copyText, copyJson] = [...host.querySelectorAll<HTMLButtonElement>('.mp-actions .mp-btn')];
    expect(copyText.textContent).toBe('Copy map');
    expect(copyJson.textContent).toBe('Copy JSON');
    expect(copyText.dataset.tip).toBeTruthy();
    click(copyText);
    await until(() => clip.length === 1, 'el texto copiado');
    expect(clip[0]).toContain('# Serie de prueba — map');
    expect(clip[0]).toContain('- CENADE: 6 scenes · 3 days');
    click(copyJson);
    await until(() => clip.length === 2, 'el JSON copiado');
    const j = JSON.parse(clip[1]);
    expect([j.format, j.version, j.scope, j.complete]).toEqual(['shotdocs.map', 1, 'project', true]);
    expect(j.pageUrl.replace('{id}', built.ids.d59)).toBe(`${location.origin}/p/${built.ids.d59}`);
    expect(j.pages[built.ids.d59].kind).toBe('day');
    expect(Y.encodeStateVector(doc)).toEqual(before);
    d.docs.close(built.ids.d59);
  });

  it('un proyecto sin escenas, locaciones ni días no tiene la fila Map', async () => {
    const d = await makeDevice(new FakeServer());
    devices.push(d);
    const projectId = await d.tree.createProject('Notas sueltas');
    const page = await d.tree.create(null, 'Brief', projectId);
    await writeBlocks(d, page, [{ p: 'La Escena 27 y la 5027.' }]);
    await d.engine.syncNow();
    const host = mount(d, pagePath(page));
    await until(() => host.querySelector('.page-title'), 'la página');
    await wait(300);
    expect(host.querySelector('.map-nav')).toBeNull();
  });

  it('un invitado que ve solo una escena: su Map tiene solo esa escena', async () => {
    const server = new FakeServer();
    server.enableTeam();
    const owner = await makeDevice(server);
    devices.push(owner);
    const built = await buildProject(owner, fakePhoto, { days: true, indexPage: false });
    await owner.tree.setPatch(built.ids.s027, { settings: { entity: { kind: 'scene', code: '105_027' } } as unknown as PageSettings });
    await owner.engine.syncNow();
    server.addMember('ana', 'member', 'ana@test');
    server.grant('ana', { pageId: built.ids.s027 }, 'view');
    const guest = await makeDevice(server, crypto.randomUUID(), '0.021', {}, undefined, { id: 'ana', email: 'ana@test' });
    devices.push(guest);
    await guest.engine.syncNow();
    await guest.engine.syncNow();
    const host = mount(guest, mapPath('scenes'));
    await until(() => complete(host) && rows(host, '.mp-srow').length === 1, 'la escena del invitado');
    expect(host.querySelector('.mp-lede')!.textContent).toContain('from the pages you can see');
    expect(rows(host, '.mp-srow')[0].querySelector('.mp-dd')!.textContent).toBe('No report section you can see');
    for (const k of ['d59', 'cenade', 'scout', 'notas']) expect(host.textContent).not.toContain(owner.tree.get(built.ids[k])!.title);
  });

  it('un invitado nunca lee «no existe» de una escena que no ve: «isn’t in the pages you can see» (mapa, día y lupa)', async () => {
    const server = new FakeServer();
    server.enableTeam();
    const owner = await makeDevice(server);
    devices.push(owner);
    const built = await buildProject(owner, fakePhoto, { days: true, indexPage: false });
    // Ve la escena 105_027 y el Día 70, cuyo título de sección nombra también 105_029 (que no ve).
    await owner.tree.setPatch(built.ids.s027, { settings: { entity: { kind: 'scene', code: '105_027' } } as unknown as PageSettings });
    await owner.tree.setPatch(built.ids.d70, { settings: { entity: { kind: 'day' } } as unknown as PageSettings });
    // El Día 70 tiene una sección de 105_027 y otra de 105_029; la invitada ve la escena 105_027 y el día, no 105_029.
    await writeBlocks(owner, built.ids.d70, [{ h: 1, text: 'Escena 105_027A' }, { p: 'Interior en estudio.' }, { h: 1, text: 'Escena 105_029' }, { p: 'Primer plano.' }]);
    await owner.engine.syncNow();
    server.addMember('ana', 'member', 'ana@test');
    server.grant('ana', { pageId: built.ids.s027 }, 'view');
    server.grant('ana', { pageId: built.ids.d70 }, 'view');
    const guest = await makeDevice(server, crypto.randomUUID(), '0.021', {}, undefined, { id: 'ana', email: 'ana@test' });
    devices.push(guest);
    await guest.engine.syncNow();
    await guest.engine.syncNow();
    const host = mount(guest, pagePath(built.ids.d70));
    await until(() => host.querySelector('.map-nav'), 'la fila Map');
    click(host.querySelector('.map-nav'));
    await until(() => complete(host), 'el mapa del invitado');
    click(host.querySelector('.mp-tab[href="/map/pending"]'));
    await until(() => host.querySelector('.mp-pcard'), 'el pendiente');
    const card = host.querySelector<HTMLElement>('.mp-pcard')!;
    expect(card.textContent).toContain('105_029 isn’t in the pages you can see');
    expect(card.textContent).toContain('may exist in a page you can’t see');
    expect(host.textContent).not.toMatch(/doesn.t exist/);
    // La cabecera del día (la misma causa, DayHeader).
    act(() => navigate(pagePath(built.ids.d70)));
    await until(() => host.querySelector('section.lh')?.textContent?.includes('105_029'), 'la cabecera del día');
    expect(host.querySelector('section.lh')!.textContent).toContain('not in the pages you can see');
    expect(host.querySelector('section.lh')!.textContent).not.toMatch(/doesn.t exist/);
    // La lupa.
    key(document, { key: 'k', ctrlKey: true });
    await until(() => document.querySelector('.search-panel input'), 'el panel');
    type(document.querySelector<HTMLInputElement>('.search-panel input')!, '105_029');
    await until(() => document.querySelector('.search-entity'), 'la entidad');
    expect(document.querySelector('.search-entity .search-entity-why')!.textContent).toBe('Not in the pages you can see · Map › Pending');
  });
});

describe('la línea de tiempo: días cercanos juntos (O3)', () => {
  it('groupDots junta los días a menos del espacio de un punto y deja separados los demás', () => {
    const days = ['2026-02-18', '2026-02-19', '2026-02-20', '2026-03-14', '2026-03-16'].map((date) => ({ date }));
    const pos = (date: string) => (Date.parse(date) - Date.parse('2026-01-01')) / 86400e3; // un día = 1 %
    expect(groupDots(days, pos, 2.5).map((g) => g.map((d) => d.date))).toEqual([
      ['2026-02-18', '2026-02-19', '2026-02-20'],
      ['2026-03-14', '2026-03-16'],
    ]);
    expect(groupDots(days, pos, 1).map((g) => g.length)).toEqual([1, 1, 1, 1, 1]);
    // Un grupo largo termina más lejos que su último día: el que cae debajo de su cola se suma (en el teléfono, el Día 28
    // tapaba el punto de al lado, que estaba a más de un punto del día anterior pero debajo del grupo).
    const run = ['2026-02-01', '2026-02-02', '2026-02-03', '2026-02-04', '2026-02-08', '2026-02-20'].map((date) => ({ date }));
    expect(groupDots(run, pos, 2).map((g) => g.length)).toEqual([5, 1]);
    // Con un ancho de 560 px, el espacio de un punto (13 px) es 2,3 %.
    expect(dotGap(560)).toBeCloseTo(2.32, 1);
    expect(dotGap(0)).toBe(DOT_GAP);
  });
});

describe('la lupa ⌘K: escenas y locaciones primero', () => {
  async function search(host: HTMLElement, q: string) {
    if (!host.querySelector('.search-panel')) key(document, { key: 'k', ctrlKey: true });
    await until(() => host.ownerDocument.querySelector('.search-panel input'), 'el panel');
    type(document.querySelector<HTMLInputElement>('.search-panel input')!, q);
    await wait(200);
  }
  const first = () => document.querySelector<HTMLElement>('.search-option');

  it('cualquier forma del número pone la escena primero; Enter la abre; el texto se sigue buscando', async () => {
    const { built, host } = await app((b) => pagePath(b.ids.d59));
    await until(() => host.querySelector('.map-nav'), 'las relaciones');
    for (const q of ['105_027', '105-027', '5027', '5027b']) {
      await search(host, q);
      await until(() => first()?.classList.contains('search-entity'), `la escena con «${q}»`);
      expect(first()!.querySelector('.search-entity-chip')!.textContent, q).toBe('105_027');
      expect(first()!.textContent).toContain('La ambulancia empieza a zigzaguear');
      expect(first()!.getAttribute('aria-selected')).toBe('true');
    }
    // «Escena 27» dentro del episodio de la página abierta (un día no tiene episodio: busca en todos y hay uno).
    await search(host, 'Escena 29');
    await until(() => first()?.textContent?.includes('105_029'), 'Escena 29');
    // La locación por una parte del nombre.
    await search(host, 'cenad');
    await until(() => first()?.querySelector('.search-entity-chip.loc'), 'la locación');
    expect(first()!.textContent).toContain('CENADE');
    // El texto sigue: «Plates» encuentra la página del día, sin entidades.
    await search(host, 'Plates de ruta');
    await until(() => document.querySelector('.search-page'), 'la búsqueda de texto');
    expect(document.querySelector('.search-entity')).toBeNull();
    // Enter con la escena primero abre su página.
    await search(host, '5027');
    await until(() => first()?.classList.contains('search-entity'), 'la escena');
    key(document.querySelector('.search-panel input')!, { key: 'Enter' });
    await wait();
    expect(location.pathname).toBe(pagePath(built.ids.s027));
    expect(document.querySelector('.search-panel')).toBeNull();
  });

  it('un número que no existe va a Map › Pending', async () => {
    const { host } = await app((b) => pagePath(b.ids.d59), async (dev, b) => {
      await writeBlocks(dev, b.ids.notas, [{ p: 'Falta la Escena 105_120.' }]);
    });
    await until(() => host.querySelector('.map-nav'), 'las relaciones');
    await search(host, '105_120');
    await until(() => first()?.querySelector('.search-entity-chip.pending'), 'el pendiente');
    key(document.querySelector('.search-panel input')!, { key: 'Enter' });
    await wait();
    expect(location.pathname).toBe('/map/pending');
  });
});


describe('Merge en la app (E16)', () => {
  /** El proyecto con 105_029 en dos páginas: la segunda con texto y una ficha adentro. */
  const twin = async (dev: Device, b: Built) => {
    const second = await dev.tree.create(b.ids.ep5, '029 | El fugitivo (otra)', b.projectId);
    await writeBlocks(dev, second, [{ p: 'Lo que escribió el otro dispositivo.' }]);
    const card = await dev.tree.create(second, 'PRUEBA_105_029_020', b.projectId);
    await writeBlocks(dev, card, [{ p: 'Una ficha nueva.' }]);
    b.ids.s029b = second;
    b.ids.s029b_card = card;
  };
  const dupCard = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('.mp-pcard')].find((c) => c.textContent?.includes('105_029 is in 2 pages'));
  const button = (host: HTMLElement, text: string) => [...host.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === text);

  it('Pending: Merge… abre el adelanto con las dos, une, avisa con Open y Undo; Undo trae todo de vuelta', async () => {
    const { d, built, host } = await app(() => mapPath('pending'), twin);
    await shown(() => expect(dupCard(host)?.querySelector('.rel-merge')).toBeTruthy());
    expect(dupCard(host)!.querySelector('.rel-merge')!.getAttribute('data-tip')).toBeTruthy();
    expect(dupCard(host)!.textContent).toContain('Merge… copies what’s written in one');
    click(dupCard(host)!.querySelector('.rel-merge'));
    const dialog = () => document.querySelector<HTMLElement>('.merge-dialog')!;
    await shown(() => expect(dialog().querySelector('.merge-actions .primary')!.hasAttribute('disabled')).toBe(false));
    expect(dialog().querySelector('h2')!.textContent).toBe('Merge the two pages of 105_029');
    expect([...dialog().querySelectorAll('.merge-title')].map((x) => x.textContent)).toEqual(['029 | El fugitivo abre los ojos', '029 | El fugitivo (otra)']);
    // La primera del árbol queda; la otra tiene una subpágina que pasa.
    expect(dialog().querySelector('.merge-card.on .merge-title')!.textContent).toBe('029 | El fugitivo abre los ojos');
    expect(dialog().textContent).toContain('Its subpage moves into «029 | El fugitivo abre los ojos».');
    expect(dialog().querySelector('.merge-actions .primary')!.textContent).toBe('Merge into «029 | El fugitivo abre los ojos»');
    click(dialog().querySelector('.merge-actions .primary'));
    await shown(() => expect(host.textContent).toContain('Merged «029 | El fugitivo (otra)» into «029 | El fugitivo abre los ojos»'), 20_000);
    expect(d.tree.isTrashed(built.ids.s029b)).toBe(true);
    // D687: el vigía de las uniones a mitad está montado (la app entera) y no corre otra vez la misma unión: ningún
    // segundo aviso diciendo que la otra «queda», ni la fila «didn’t finish».
    await wait(1500);
    expect(host.textContent).not.toContain('changed while merging');
    expect(host.textContent).not.toContain('didn’t finish');
    expect(d.tree.get(built.ids.s029b_card)?.parent_id).toBe(built.ids.s029);
    await shown(() => expect(dupCard(host)).toBeUndefined());
    expect(await linkedRuns(d, built.ids.s029)).toContain('Lo que escribió el otro dispositivo.');
    click(button(host, 'Undo'));
    await shown(() => expect(host.textContent).toContain('Merge undone: «029 | El fugitivo (otra)» is back'), 20_000);
    expect(d.tree.isTrashed(built.ids.s029b)).toBe(false);
    expect(d.tree.get(built.ids.s029b_card)?.parent_id).toBe(built.ids.s029b);
    expect(await linkedRuns(d, built.ids.s029)).not.toContain('Lo que escribió el otro dispositivo.');
    await shown(() => expect(dupCard(host)).toBeTruthy());
  });

  it('la cabecera de las dos páginas dice «Also in» con Merge…; la página unida dice a cuál en la papelera', async () => {
    const { d, built, host } = await app((b) => pagePath(b.ids.s029), twin);
    await shown(() => expect(host.querySelector('.lh-twin')?.textContent).toContain('Also in«029 | El fugitivo (otra)»Merge…'));
    act(() => navigate(pagePath(built.ids.s029b)));
    await shown(() => expect(host.querySelector('.lh-twin')?.textContent).toContain('Also in«029 | El fugitivo abre los ojos»Merge…'));
    click(host.querySelector('.lh-twin .rel-merge'));
    await shown(() => expect(document.querySelector<HTMLElement>('.merge-actions .primary')!.hasAttribute('disabled')).toBe(false));
    click(document.querySelector('.merge-actions .primary'));
    await shown(() => expect(d.tree.isTrashed(built.ids.s029b)).toBe(true), 20_000);
    await shown(() => expect(host.querySelector('.banner')?.textContent).toContain('Merged into «029 | El fugitivo abre los ojos»'));
    expect(host.querySelector('.lh-twin')).toBeNull();
  });

  it('Pending lista lo que llegó tarde a la página unida, con Open y Dismiss; sin repetidas no hay Merge', async () => {
    const { d, built, host } = await app(() => mapPath('pending'), twin);
    await shown(() => expect(dupCard(host)?.querySelector('.rel-merge')).toBeTruthy());
    click(dupCard(host)!.querySelector('.rel-merge'));
    await shown(() => expect(document.querySelector<HTMLElement>('.merge-actions .primary')!.hasAttribute('disabled')).toBe(false));
    click(document.querySelector('.merge-actions .primary'));
    await shown(() => expect(d.tree.isTrashed(built.ids.s029b)).toBe(true), 20_000);
    // Como si otro dispositivo hubiera escrito en ella después: el puntero quedó atrás del contenido.
    const row = d.tree.get(built.ids.s029b)!;
    await act(() => d.tree.setSetting(built.ids.s029b, 'merged', { ...row.settings!.merged!, seq: row.update_seq - 1 }));
    const late = () => [...host.querySelectorAll<HTMLElement>('.mp-pcard')].find((c) => c.textContent?.includes('changed after it was merged'));
    await shown(() => expect(late()).toBeTruthy());
    expect([...late()!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Open', 'Dismiss']);
    expect(host.querySelector('.mp-tab[href="/map/pending"] b')!.textContent).toBe('2');
    click([...late()!.querySelectorAll('button')].find((b) => b.textContent === 'Dismiss'));
    await shown(() => expect(late()).toBeUndefined());
    // Sin repetidas no hay ningún Merge a la vista.
    expect(host.querySelector('.rel-merge')).toBeNull();
  });

  it('M1: quien no puede editar y crear páginas en las dos no ve Merge (ni en Pending ni en la cabecera)', async () => {
    const server = new FakeServer();
    server.enableTeam();
    const owner = await makeDevice(server);
    devices.push(owner);
    const built = await buildProject(owner, fakePhoto, { days: true, indexPage: false });
    await twin(owner, built);
    await owner.engine.syncNow();
    server.addMember('beto', 'member', 'beto@test');
    server.grant('beto', { pageId: built.ids.desglose }, 'edit');
    const beto = await makeDevice(server, crypto.randomUUID(), '0.021', {}, undefined, { id: 'beto', email: 'beto@test' });
    devices.push(beto);
    await beto.engine.syncNow();
    await beto.engine.syncNow();
    const host = mount(beto, pagePath(built.ids.s029));
    await shown(() => expect(host.querySelector('.lh-twin')).toBeTruthy());
    expect(host.querySelector('.rel-merge')).toBeNull();
    act(() => navigate(mapPath('pending')));
    await shown(() => expect(dupCard(host)).toBeTruthy());
    expect(dupCard(host)!.querySelector('.rel-merge')).toBeNull();
  });

  it('M1: un invitado con Edit & create pages en las dos no ve Merge; tampoco quien recibe base limpia', async () => {
    const server = new FakeServer();
    server.enableTeam();
    const owner = await makeDevice(server);
    devices.push(owner);
    const built = await buildProject(owner, fakePhoto, { days: true, indexPage: false });
    await twin(owner, built);
    await owner.engine.syncNow();
    server.addMember('gina', 'guest', 'gina@test');
    server.grant('gina', { pageId: built.ids.desglose }, 'edit_pages');
    const gina = await makeDevice(server, crypto.randomUUID(), '0.021', {}, undefined, { id: 'gina', email: 'gina@test' });
    devices.push(gina);
    await gina.engine.syncNow();
    await gina.engine.syncNow();
    const host = mount(gina, pagePath(built.ids.s029));
    await shown(() => expect(host.querySelector('.lh-twin')).toBeTruthy());
    expect(host.querySelector('.rel-merge')).toBeNull();
    // El lector de base limpia, aparte (con permisos que si no alcanzarían).
    const perms = { canManagePage: () => true, role: 'member' as const, viaLink: false };
    expect(canMergeWith(perms, { engine: { isBaseReader: () => false } })('p')).toBe(true);
    expect(canMergeWith(perms, { engine: { isBaseReader: () => true } })('p')).toBe(false);
  });
});
