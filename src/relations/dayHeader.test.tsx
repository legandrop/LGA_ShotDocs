// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { navigate, pagePath } from '../router';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { settled } from '../test/settle';
import { unitsFromYDoc } from '../search/extract';
import { Shell } from '../ui/Workspace';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { buildProject, type Built } from './fixtures/proyectoSintetico';

// La cabecera del día y *Prepare tomorrow's report* en la app de verdad (Docs/Doc_Relaciones.md, sección 11): la
// cabecera no escribe en su página; *Prepare* escribe solo en el reporte de mañana, lleva ahí, avisa con *Undo*; el
// editor de mañana muestra el título de la escena y la pregunta abierta como vista; el teléfono arranca plegado; mientras
// lee no dice ceros; un invitado que no puede editar mañana no ve el botón.

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
    if (await check()) return;
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
  history.replaceState(null, '', pagePath(start));
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

async function app(start: string): Promise<{ d: Device; built: Built; host: HTMLElement }> {
  const d = await makeDevice(new FakeServer());
  devices.push(d);
  const built = await buildProject(d, fakePhoto, { indexPage: false, days: true });
  return { d, built, host: mount(d, built.ids[start]) };
}

const header = (host: HTMLElement) => host.querySelector<HTMLElement>('section.lh');
const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const headingsOf = async (d: Device, pageId: string) => {
  const doc = await d.docs.open(pageId);
  const meta: Parameters<typeof unitsFromYDoc>[1] = [];
  const units = unitsFromYDoc(doc, meta);
  const ids = new Set(meta.filter((m) => m.level > 0).map((m) => m.blockId));
  d.docs.close(pageId);
  return units.filter((u) => ids.has(u.blockId)).map((u) => u.text);
};

describe('la cabecera del día en la app', () => {
  it('Día 59: escenas, preguntas, plan y Tomorrow; Prepare escribe solo en el Día 60, lleva ahí y se deshace', async () => {
    const { d, built, host } = await app('d59');
    await until(() => header(host)?.textContent?.includes('Live'), 'la cabecera completa');
    const lh = header(host)!;
    expect(lh.querySelector('.lh-badge')!.textContent).toBe('Shoot day');
    expect(lh.querySelector('.lh-id')!.textContent).toContain('Thu 19 Feb 2026');
    expect(lh.textContent).toContain('Scenes of the day');
    expect([...lh.querySelectorAll('.lh-mrow')].map((r) => r.textContent)).toEqual([
      '105_027 BLa ambulancia empieza a zigzaguear · 5 photosshot',
      '«Plates ambulancia» · no scene number · 2 photos',
      '105_025El fugitivo espera escondidoplanned · no section',
    ]);
    expect(lh.textContent).toContain('2 scenes from the breakdown (Fecha Rodaje 19/02)');
    const card = lh.querySelector('.lh-tomorrow')!;
    expect(card.textContent).toContain('Tomorrow · Día 60');
    expect(card.textContent).toContain('3 scenes · from the breakdown (Fecha Rodaje 20/02');
    // Tooltips de la app, nunca `title=`.
    expect(lh.querySelectorAll('[title]').length).toBe(0);
    // La cabecera es vista: el documento del Día 59 no cambia con nada de esto.
    const doc59 = await d.docs.open(built.ids.d59);
    await until(() => host.querySelector('.bn-editor') && Y.encodeStateVector(doc59).length > 1, 'el editor listo');
    await wait(100);
    const before59 = Y.encodeStateVector(doc59);
    // Sacar 104_009 de la lista y preparar.
    click(card.querySelector('[aria-label="Remove 104_009 from tomorrow"]'));
    await wait();
    expect(header(host)!.querySelector('.lh-tomorrow .chips')!.textContent).not.toContain('104_009');
    click(header(host)!.querySelector('.lh-prepare'));
    await until(() => location.pathname === pagePath(built.ids.d60), 'el Día 60');
    await until(async () => (await headingsOf(d, built.ids.d60)).includes('Escena 104_008'), 'la sección nueva');
    expect(await headingsOf(d, built.ids.d60)).toEqual(['Escena 105_029a', 'Escena 104_008']);
    expect(Y.encodeStateVector(doc59)).toEqual(before59);
    d.docs.close(built.ids.d59);
    // El aviso con Undo.
    await until(() => [...host.querySelectorAll('button')].some((b) => b.textContent === 'Undo'), 'el aviso con Undo');
    const notice = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Undo')!;
    expect(host.textContent).toContain('Día 60 · added 1 section · 105_029 already had one');
    // El Día 60 la muestra «prepared», y el editor, el título de la escena y su pregunta abierta (vista, no documento).
    await until(() => [...host.querySelectorAll('.lh-mrow')].some((r) => r.textContent?.includes('104_008') && r.textContent.includes('prepared')), 'prepared en el Día 60');
    await until(() => host.querySelector('.bn-editor .lh-qcall'), 'la pregunta abierta en el editor');
    expect(host.querySelector('.bn-editor .lh-ltitle')!.textContent).toBe(' · La camioneta frena en la banquina');
    expect(host.querySelector('.bn-editor .lh-qcall')!.textContent).toContain('¿Solo planos desde el exterior?');
    expect(host.querySelector('.bn-editor .lh-qcall')!.textContent).toContain('PRUEBA_104_008_010 · Locaciones, Guion Técnico');
    expect(await headingsOf(d, built.ids.d60)).not.toContain('La camioneta frena en la banquina');
    // Undo: se va lo agregado (seguía vacío).
    click(notice);
    await until(async () => !(await headingsOf(d, built.ids.d60)).includes('Escena 104_008'), 'Undo');
    expect(await headingsOf(d, built.ids.d60)).toEqual(['Escena 105_029a']);
  });

  it('en el teléfono el día arranca plegado en un renglón, sin ceros mientras lee', async () => {
    phone = true;
    const d = await makeDevice(new FakeServer());
    devices.push(d);
    const built = await buildProject(d, fakePhoto, { indexPage: false, days: true });
    const real = d.docs.indexSnapshot.bind(d.docs);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    vi.spyOn(d.docs, 'indexSnapshot').mockImplementation(async (pageId) => {
      if (pageId === built.ids.d76) await held;
      return real(pageId);
    });
    const host = mount(d, built.ids.d59);
    await until(() => header(host)?.querySelector('.lh-line'), 'el renglón');
    const line = header(host)!.querySelector('.lh-line')!;
    expect(line.querySelector('.lh-badge')!.textContent).toBe('Shoot day');
    expect(line.textContent).not.toMatch(/(^|\D)0 /);
    release();
    await until(() => header(host)?.querySelector('.lh-line')?.textContent?.includes('7 photos'), 'el renglón completo');
    expect(header(host)!.querySelector('.lh-line')!.textContent).toContain('CENADE · 2 scenes · 7 photos · 2 open questions');
    // Abrirlo se recuerda para todos los días.
    click(header(host)!.querySelector('.lh-line'));
    await wait();
    act(() => navigate(pagePath(built.ids.d60)));
    await until(() => header(host)?.querySelector('.lh-facts'), 'el Día 60 abierto');
  });

  it('D401: quien ve solo los días (no el desglose) lee las ausencias como «you can see» y sin permiso de editar no tiene Prepare', async () => {
    const server = new FakeServer();
    server.enableTeam();
    const owner = await makeDevice(server);
    devices.push(owner);
    const built = await buildProject(owner, fakePhoto, { indexPage: false, days: true });
    await owner.engine.syncNow();
    server.addMember('ana', 'member', 'ana@test');
    server.grant('ana', { pageId: built.ids.rodaje }, 'view');
    const guest = await makeDevice(server, crypto.randomUUID(), '0.021', {}, undefined, { id: 'ana', email: 'ana@test' });
    devices.push(guest);
    await guest.engine.syncNow();
    await guest.engine.syncNow();
    const host = mount(guest, built.ids.d59);
    await until(() => header(host)?.textContent?.includes('Live'), 'la cabecera del invitado');
    const lh = header(host)!;
    expect(lh.textContent).toContain('No Plan page and no breakdown date you can see for this day');
    expect(lh.querySelector('.lh-prepare')).toBeNull();
    expect(lh.querySelector('.lh-tomorrow')!.textContent).toContain('You can’t edit «Día 60»');
    // No ve las fichas: nada de sus preguntas ni de sus títulos.
    expect(lh.textContent).not.toContain('¿Todo el interior');
  });
});
