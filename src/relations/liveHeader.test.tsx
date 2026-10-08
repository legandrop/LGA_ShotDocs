// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { LinkContext, type LinkInfo } from '../linkMode';
import { navigate, pagePath } from '../router';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { settled } from '../test/settle';
import { searchSession } from '../ui/projectSearchUi';
import { revealBlock } from '../ui/commentsUi';
import { relationsSession } from '../ui/relationsUi';
import { Shell } from '../ui/Workspace';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { buildProject, writeBlocks, type Built } from './fixtures/proyectoSintetico';
import { LiveHeader } from './LiveHeader';

// La cabecera viva en la app de verdad (Docs/Doc_Relaciones.md, sección 10): se dibuja con el índice, se pliega por tipo,
// arranca plegada en el teléfono, lleva al lugar exacto, se actualiza al escribir en otra página, no escribe nada en el
// documento y no aparece con un link público.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let phone = false;
beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: phone && query.includes('max-width: 760px'),
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

beforeEach(() => {
  phone = false;
  localStorage.clear();
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

async function app(start: string): Promise<{ d: Device; built: Built; host: HTMLElement; s: Services }> {
  const d = await makeDevice(new FakeServer());
  devices.push(d);
  const built = await buildProject(d, fakePhoto, { indexPage: false });
  history.replaceState(null, '', pagePath(built.ids[start]));
  const s = services(d);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <ServicesContext.Provider value={s}>
        <Shell />
      </ServicesContext.Provider>,
    ),
  );
  return { d, built, host, s };
}

const header = (host: HTMLElement) => host.querySelector<HTMLElement>('section.lh');
const go = async (built: Built, key: string) => {
  act(() => navigate(pagePath(built.ids[key])));
  await wait();
};
const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const byText = (host: HTMLElement, selector: string, text: string) => [...host.querySelectorAll<HTMLElement>(selector)].find((e) => e.textContent?.includes(text));

describe('la cabecera viva en la app', () => {
  it('escena: entre el título y el documento, fuera del editor, con lo que dice el índice y sin escribir en el documento', async () => {
    const { d, built, host } = await app('s027');
    await until(() => header(host)?.textContent?.includes('Live'), 'la cabecera completa');
    const lh = header(host)!;
    // Entre el título y el editor, nunca adentro del documento.
    const title = host.querySelector('.page-title')!;
    expect(title.compareDocumentPosition(lh) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(lh.closest('.bn-editor, [contenteditable]')).toBeNull();
    // El tipo y los alias, sin repetir el número de la escena ni la ruta.
    expect(lh.querySelector('.lh-id')!.textContent).toMatch(/^Scene/);
    expect(lh.querySelector('.lh-id')!.textContent).not.toContain('105_027 ');
    expect(lh.querySelector('.lh-id')!.textContent).not.toContain('Desglose');
    expect(lh.textContent).toContain('Día 59');
    expect(lh.textContent).toContain('§ Escena 105_027b');
    expect(lh.querySelector('[data-tip="Location per the day title"]')?.textContent).toBe('CENADE');
    expect(lh.textContent).toContain('2 cards');
    expect(lh.textContent).toContain('3 days · 4 sections');
    // Tooltips de la app, nunca `title=`.
    expect(lh.querySelectorAll('[title]').length).toBe(0);
    // Etapas cerradas; abrir una muestra sus extractos.
    expect(lh.querySelector('.lh-panel')).toBeNull();
    click(byText(lh, '.lh-stage', 'Scouting'));
    expect(lh.querySelector('.lh-panel')!.textContent).toContain('(5027b) Ambulancia vuelca');
    expect(lh.querySelector('.lh-panel')!.textContent).toContain('part B');
    // Nada de esto tocó el documento de la página.
    const doc = await d.docs.open(built.ids.s027);
    // La página vacía la siembra el editor al abrirla (eso es de siempre): se compara después de eso.
    await until(() => host.querySelector('.bn-editor') && Y.encodeStateVector(doc).length > 1, 'el editor listo');
    await wait(100);
    const before = Y.encodeStateVector(doc);
    click(byText(lh, '.lh-stage', 'Shoot'));
    click(lh.querySelector('.lh-tbtn'));
    await wait();
    click(header(host)!.querySelector('.lh-line'));
    await wait();
    expect(Y.encodeStateVector(doc)).toEqual(before);
    d.docs.close(built.ids.s027);
  });

  it('«No report section» y «No VFX» (nunca «not shot»), y se actualiza solo al escribir en otra página', async () => {
    const { d, built, host } = await app('s026');
    await until(() => header(host)?.textContent?.includes('Live'), 'la cabecera completa');
    expect(header(host)!.textContent).toContain('No report section');
    expect(header(host)!.textContent).toContain('No VFX · not expected in VFX reports');
    expect(header(host)!.textContent?.toLowerCase()).not.toContain('not shot');
    // Alguien escribe en el día 60: la escena se entera sola.
    await writeBlocks(d, built.ids.d60, [{ h: 1, text: 'Escena 105_029a' }, { p: '105_026 queda para mañana' }]);
    await until(() => byText(host, '.lh-dayline', 'named in the text')?.textContent?.includes('Día 60'), 'la mención nueva');
  });

  it('mientras el índice no leyó todo, dice «Reading…» en vez de afirmar ausencias', async () => {
    const d = await makeDevice(new FakeServer());
    devices.push(d);
    const built = await buildProject(d, fakePhoto, { indexPage: false });
    // El día 76 queda frenado: el índice no termina.
    const real = d.docs.indexSnapshot.bind(d.docs);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    vi.spyOn(d.docs, 'indexSnapshot').mockImplementation(async (pageId) => {
      if (pageId === built.ids.d76) await held;
      return real(pageId);
    });
    history.replaceState(null, '', pagePath(built.ids.s026));
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    act(() => root.render(<ServicesContext.Provider value={services(d)}><Shell /></ServicesContext.Provider>));
    await until(() => header(host)?.querySelector('.lh-livedot.reading'), 'la cabecera leyendo');
    expect(header(host)!.textContent).not.toContain('No report section');
    expect(header(host)!.textContent).not.toContain('Live');
    release();
    await until(() => header(host)?.textContent?.includes('No report section'), 'la cabecera completa');
    expect(header(host)!.querySelector('.lh-livedot.reading')).toBeNull();
  });

  it('plegado por tipo (escena / locación), recordado en el dispositivo, en un renglón', async () => {
    const { built, host } = await app('s027');
    await until(() => header(host)?.textContent?.includes('Live'), 'la cabecera');
    click(header(host)!.querySelector('.lh-tbtn'));
    expect(header(host)!.classList.contains('closed')).toBe(true);
    expect(header(host)!.querySelector('.lh-line')!.textContent).toContain('Shot at CENADE, La Arenera (estudio) · 3 days · 2 cards · ');
    expect(JSON.parse(localStorage.getItem('shotdocs.liveHeader.open')!)).toEqual({ scene: false });
    // La locación sigue abierta: el plegado es por tipo.
    await go(built, 'cenade');
    await until(() => header(host)?.querySelector('.lh-badge')?.textContent === 'Location', 'la locación');
    expect(header(host)!.classList.contains('closed')).toBe(false);
    expect(header(host)!.textContent).toContain('No report section yet: 104_008, 104_009, 105_025, 105_026');
    // Otra escena: plegada.
    await go(built, 's029');
    await until(() => header(host)?.querySelector('.lh-badge')?.textContent === 'Scene', 'otra escena');
    expect(header(host)!.classList.contains('closed')).toBe(true);
  });

  it('en el teléfono arranca plegada en un renglón; abrirla se recuerda', async () => {
    phone = true;
    const { host } = await app('s027');
    await until(() => header(host), 'la cabecera');
    expect(header(host)!.classList.contains('closed')).toBe(true);
    expect(header(host)!.querySelectorAll('.lh-line').length).toBe(1);
    click(header(host)!.querySelector('.lh-line'));
    expect(header(host)!.classList.contains('closed')).toBe(false);
    expect(JSON.parse(localStorage.getItem('shotdocs.liveHeader.open')!)).toEqual({ scene: true });
  });

  it('ir al lugar exacto: la página del día en la sección, con el pedido de la sección entera y su resaltado', async () => {
    const { built, host, s } = await app('s027');
    await until(() => header(host)?.textContent?.includes('Live'), 'la cabecera');
    const link = byText(header(host)!, '.lh-sec', '§ Escena 105_027b')!;
    const spy = vi.spyOn(searchSession(s), 'requestResult');
    click(link);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ pageId: built.ids.d59, term: null, place: { endBlockId: expect.any(String) } }));
    expect(location.pathname).toBe(pagePath(built.ids.d59));
    // El editor del día toma el pedido y resalta los bloques de la sección (título, texto y 5 fotos).
    await until(() => host.querySelectorAll('.bn-block-outer.rel-flash').length > 0, 'el resaltado');
    expect(host.querySelectorAll('.bn-block-outer.rel-flash').length).toBe(7);
    expect(host.querySelectorAll('.bn-block-outer.rel-flash-first').length).toBe(1);
  });
});

describe('ronda de corrección (auditoría de E3)', () => {
  it('B2: con el índice incompleto, el renglón plegado (teléfono) dice «Reading…» y no afirma ceros', async () => {
    phone = true;
    const d = await makeDevice(new FakeServer());
    devices.push(d);
    const built = await buildProject(d, fakePhoto, { indexPage: false });
    // Ningún documento termina de leerse: el índice no tiene nada.
    vi.spyOn(d.docs, 'indexSnapshot').mockImplementation(() => new Promise(() => undefined));
    history.replaceState(null, '', pagePath(built.ids.cenade));
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    act(() => root.render(<ServicesContext.Provider value={services(d)}><Shell /></ServicesContext.Provider>));
    await until(() => header(host)?.querySelector('.lh-line'), 'la locación plegada');
    await wait(400);
    const line = header(host)!.querySelector('.lh-line')!;
    expect(line.querySelector('.lh-livedot.reading')).not.toBeNull();
    expect(line.textContent).not.toMatch(/(^|\D)0 /);
    act(() => navigate(pagePath(built.ids.s027)));
    await until(() => header(host)?.querySelector('.lh-badge')?.textContent === 'Scene', 'la escena plegada');
    await wait(200);
    expect(header(host)!.querySelector('.lh-line .lh-livedot.reading')).not.toBeNull();
    expect(header(host)!.querySelector('.lh-line')!.textContent).not.toMatch(/(^|\D)0 /);
  });

  it('O1: un invitado que ve solo la escena no lee «No report section» como si viera todo', async () => {
    const server = new FakeServer();
    server.enableTeam();
    const owner = await makeDevice(server);
    devices.push(owner);
    const built = await buildProject(owner, fakePhoto, { indexPage: false });
    await owner.tree.setPatch(built.ids.s026, { settings: { entity: { kind: 'scene', code: '105_026' } } });
    await owner.engine.syncNow();
    server.addMember('ana', 'member', 'ana@test');
    server.grant('ana', { pageId: built.ids.s026 }, 'view');
    const guest = await makeDevice(server, crypto.randomUUID(), '0.021', {}, undefined, { id: 'ana', email: 'ana@test' });
    devices.push(guest);
    await guest.engine.syncNow();
    await guest.engine.syncNow();
    history.replaceState(null, '', pagePath(built.ids.s026));
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    act(() => root.render(<ServicesContext.Provider value={services(guest)}><Shell /></ServicesContext.Provider>));
    await until(() => header(host)?.textContent?.includes('Live'), 'la cabecera del invitado');
    expect(header(host)!.textContent).toContain('No report section you can see');
  });

  it('O4: cada ficha dice «From the breakdown of 105_027» y su título una sola vez', async () => {
    const { host } = await app('s027');
    await until(() => header(host)?.textContent?.includes('Live'), 'la cabecera');
    click(byText(header(host)!, '.lh-stage', 'Breakdown'));
    const ex = header(host)!.querySelector('.lh-panel .lh-ex')!;
    expect(ex.querySelector('.src')!.textContent).toContain('From the breakdown of 105_027');
    expect(ex.textContent!.split('PRUEBA_105_027_010 Ambulancia').length - 1).toBe(1);
  });

  it('O5 y O6: el foco pasa al control nuevo al plegar y desplegar, con aria-expanded; las fotos sin tooltip repetido', async () => {
    const { host } = await app('s027');
    await until(() => header(host)?.textContent?.includes('Live'), 'la cabecera');
    const collapse = header(host)!.querySelector<HTMLButtonElement>('.lh-tbtn')!;
    expect(collapse.getAttribute('aria-expanded')).toBe('true');
    expect(header(host)!.querySelectorAll('.lh-fig[data-tip]').length).toBe(0);
    act(() => collapse.focus());
    click(collapse);
    await wait();
    const line = header(host)!.querySelector<HTMLButtonElement>('.lh-line')!;
    expect(document.activeElement).toBe(line);
    expect(line.getAttribute('aria-expanded')).toBe('false');
    expect(line.getAttribute('aria-label')).toBeNull();
    click(line);
    await wait();
    expect(document.activeElement).toBe(header(host)!.querySelector('.lh-tbtn'));
  });

  it('O7: una miniatura que no se pudo resolver se vuelve a pedir', async () => {
    const { d, host } = await app('s027');
    let fail = true;
    vi.spyOn(d.media, 'resolve').mockImplementation(async () => {
      if (fail) throw new Error('sin red');
      return 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    });
    await until(() => header(host)?.textContent?.includes('Live'), 'la cabecera');
    await wait(100);
    expect(header(host)!.querySelectorAll('.lh-strip img').length).toBe(0);
    fail = false;
    click(header(host)!.querySelector('.lh-tbtn'));
    click(header(host)!.querySelector('.lh-line'));
    await until(() => header(host)!.querySelectorAll('.lh-strip img').length > 0, 'las miniaturas otra vez');
  });
});

describe('ganchos de desarrollo (E4)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete (window as unknown as Record<string, unknown>).__shotdocsDev;
    delete (window as unknown as Record<string, unknown>).__shotdocsRelations;
  });

  it('en desarrollo: __shotdocsDev con el árbol, los documentos y el proyecto, y dump() con la forma del plan', async () => {
    const { d, built, host } = await app('s027');
    await until(() => header(host)?.textContent?.includes('Live'), 'la cabecera completa');
    const w = window as unknown as { __shotdocsDev: { tree: unknown; docs: unknown; projectId: string }; __shotdocsRelations: { dump(name?: string): Record<string, unknown> } };
    expect(w.__shotdocsDev.tree).toBe(d.tree);
    expect(w.__shotdocsDev.docs).toBe(d.docs);
    expect(w.__shotdocsDev.projectId).toBe(built.projectId);
    const dump = w.__shotdocsRelations.dump('prueba') as { name: string; projectId: string; complete: boolean; registry: { scenes: Record<string, string>; locations: Record<string, { pageId: string; aliases: string[] }> }; duplicates: unknown[]; pending: unknown[]; pages: { id: string; parent: string | null; title: string; settings: object; role: unknown; rel: unknown; units: { b: string; f: string; t: string }[] | null }[] };
    expect(Object.keys(dump)).toEqual(['name', 'projectId', 'complete', 'registry', 'duplicates', 'pending', 'pages']);
    expect(dump.name).toBe('prueba');
    expect(dump.complete).toBe(true);
    expect(dump.registry.scenes['105_027']).toBe(built.ids.s027);
    expect(dump.registry.locations.CENADE.pageId).toBe(built.ids.cenade);
    expect(Object.keys(dump.pages[0])).toEqual(['id', 'parent', 'title', 'settings', 'role', 'rel', 'units']);
    // En el orden del árbol: una carpeta antes de lo de adentro.
    const order = dump.pages.map((p) => p.id);
    expect(order.indexOf(built.ids.desglose)).toBeLessThan(order.indexOf(built.ids.s027));
    const d59 = dump.pages.find((p) => p.id === built.ids.d59)!;
    expect(d59.units!.some((u) => u.t === 'Escena 105_027b')).toBe(true);
    expect(d59.rel).not.toBeNull();
  });

  it('fuera de desarrollo no hay ganchos', async () => {
    vi.stubEnv('DEV', false);
    const { host } = await app('s027');
    await until(() => header(host)?.textContent?.includes('Live'), 'la cabecera completa');
    expect((window as unknown as Record<string, unknown>).__shotdocsDev).toBeUndefined();
    expect((window as unknown as Record<string, unknown>).__shotdocsRelations).toBeUndefined();
  });
});

describe('«Ir al bloque» de los comentarios', () => {
  it('resalta el bloque con una decoración del editor, que dura y se va sola', async () => {
    const { host } = await app('d60');
    await until(() => host.querySelectorAll('.editor .bn-block-outer').length > 2, 'el editor');
    const id = host.querySelectorAll('.editor .bn-block-outer')[1].getAttribute('data-id')!;
    let found = false;
    act(() => {
      found = revealBlock(id);
    });
    expect(found).toBe(true);
    await wait(300);
    const flashed = host.querySelector(`.editor .bn-block-outer.comment-flash[data-id="${id}"]`);
    expect(flashed).not.toBeNull();
    await until(() => !host.querySelector('.editor .comment-flash'), 'que se vaya', 100);
  });
});

describe('sin cabecera', () => {
  it('con un link público no aparece (y sin las relaciones arrancadas, tampoco)', async () => {
    const d = await makeDevice(new FakeServer());
    devices.push(d);
    const built = await buildProject(d, fakePhoto, { indexPage: false });
    history.replaceState(null, '', pagePath(built.ids.s027));
    const s = services(d);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    // Sin relaciones: nada.
    act(() => root.render(<ServicesContext.Provider value={s}><LiveHeader pageId={built.ids.s027} /></ServicesContext.Provider>));
    expect(host.innerHTML).toBe('');
    const session = relationsSession(s);
    session.open(built.projectId);
    await until(() => session.relations.snapshot(built.projectId)?.complete, 'el índice');
    act(() => root.render(<ServicesContext.Provider value={s}><LiveHeader pageId={built.ids.s027} /></ServicesContext.Provider>));
    await until(() => header(host), 'con cuenta, sí');
    const link = { entry: {}, domain: 'x', linkId: 'l', pageId: built.ids.s027 } as unknown as LinkInfo;
    act(() =>
      root.render(
        <ServicesContext.Provider value={s}>
          <LinkContext.Provider value={link}>
            <LiveHeader pageId={built.ids.s027} />
          </LinkContext.Provider>
        </ServicesContext.Provider>,
      ),
    );
    expect(host.innerHTML).toBe('');
    act(() => root.unmount());
    roots.splice(roots.indexOf(root), 1);
    session.dispose();
  });
});
