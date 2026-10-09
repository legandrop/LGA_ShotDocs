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
import { shown } from '../test/shown';
import { unitsFromYDoc } from '../search/extract';
import { prefs } from '../prefs';
import { Shell } from '../ui/Workspace';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { buildProject, writeBlocks, type Built } from './fixtures/proyectoSintetico';

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
  it('la fecha larga y la corta salen en el idioma de la app, no en inglés fijo (D667)', async () => {
    try {
      act(() => prefs.set({ language: 'es' }));
      const { host } = await app('d59');
      await until(() => header(host)?.textContent?.includes('En vivo'), 'la cabecera completa');
      expect(header(host)!.querySelector('.lh-id')!.textContent).toContain('jue 19 feb 2026');
      expect(header(host)!.querySelector('.lh-id')!.textContent).not.toContain('Thu');
    } finally {
      act(() => prefs.set({ language: 'en' }));
    }
  });

  it('Día 59: escenas, preguntas, plan y Tomorrow; Prepare escribe solo en el Día 60, lleva ahí y se deshace', async () => {
    const { d, built, host } = await app('d59');
    await until(() => header(host)?.textContent?.includes('Live'), 'la cabecera completa');
    const lh = header(host)!;
    expect(lh.querySelector('.lh-badge')!.textContent).toBe('Shoot day');
    expect(lh.querySelector('.lh-id')!.textContent).toContain('Thu 19 Feb 2026');
    expect(lh.textContent).toContain('Scenes of the day');
    expect([...lh.querySelectorAll('.lh-mrow')].map((r) => r.textContent)).toEqual([
      '105_027 BLa ambulancia empieza a zigzaguear · 5 photosshot',
      '«Plates ambulancia» · no scene number · 2 photosAssign',
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

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Lo que dice cada título de un reporte, con los links como [texto](href). */
async function headingRuns(d: Device, pageId: string): Promise<string[]> {
  const doc = await d.docs.open(pageId);
  const out: string[] = [];
  const walk = (node: Y.XmlElement | Y.XmlFragment) => {
    for (const child of node.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;
      if (child.nodeName === 'heading') {
        out.push(
          child
            .toArray()
            .map((x) => (x instanceof Y.XmlText ? (x.toDelta() as { insert: string; attributes?: { link?: { href: string } } }[]).map((op) => (op.attributes?.link ? `[${op.insert}](${op.attributes.link.href})` : op.insert)).join('') : ''))
            .join(''),
        );
      } else walk(child);
    }
  };
  walk(doc.getXmlFragment('document-store'));
  d.docs.close(pageId);
  return out;
}

describe('Tomorrow sin día siguiente: crear y preparar el reporte de mañana (D573–D577)', () => {
  it('Día 76: la tarjeta propone el 16/03 del desglose; crea, lleva al reporte nuevo y Undo lo manda a la papelera', async () => {
    const d = await makeDevice(new FakeServer());
    devices.push(d);
    const built = await buildProject(d, fakePhoto, { indexPage: false, days: true });
    await writeBlocks(d, built.ids.s029, [{ table: [['Fecha Rodaje', '16/03/2026']] }]);
    await d.engine.syncNow();
    const host = mount(d, built.ids.d76);
    const card = await shown(() => {
      const c = header(host)?.querySelector<HTMLElement>('.lh-tomorrow.new');
      expect(c).toBeTruthy();
      return c!;
    });
    expect(card.querySelector('.th')!.textContent).toBe('Tomorrow · Mon 16 Mar · no report yet');
    expect([...card.querySelectorAll('.tchip .k')].map((x) => x.textContent)).toEqual(['105_029']);
    expect(card.querySelector('.row2')!.textContent).toContain('Creates «2026-03-16 | Día 77» in «2 | Rodaje»');
    // Sumar una escena a mano antes de crear (se guarda en el dispositivo y pasa al reporte nuevo).
    click(card.querySelector('.lh-tbtn.add'));
    type(header(host)!.querySelector<HTMLInputElement>('.lh-picker input')!, '025');
    click(header(host)!.querySelector('.lh-picker-list button'));
    await shown(() => expect([...header(host)!.querySelectorAll('.lh-tomorrow.new .tchip .k')].map((x) => x.textContent)).toEqual(['105_029', '105_025']));
    click(header(host)!.querySelector('.lh-tomorrow.new .lh-prepare'));
    const created = await shown(() => {
      const row = d.tree.children(built.ids.rodaje).find((p) => p.title === '2026-03-16 | Día 77');
      expect(row).toBeTruthy();
      return row!;
    });
    await shown(() => expect(location.pathname).toBe(pagePath(created.id)));
    await shown(async () => expect((await headingRuns(d, created.id)).filter((h) => h.startsWith('Escena'))).toEqual([`Escena [105_029](/p/${built.ids.s029})`, `Escena [105_025](/p/${built.ids.s025})`]));
    await shown(() => expect(host.textContent).toContain('Created «2026-03-16 | Día 77» · added 2 sections'));
    // El Día 76 ahora tiene día siguiente: el reporte nuevo es un día.
    expect(created.settings?.entity).toEqual({ kind: 'day' });
    click([...host.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === 'Undo'));
    await shown(() => expect(d.tree.isTrashed(created.id)).toBe(true));
    await shown(() => expect(host.textContent).toContain('«2026-03-16 | Día 77» went to the trash'));
  });

  it('D709: si todas las fichas de esa fecha dicen la misma locación, el título de mañana la lleva (y la tarjeta lo dice)', async () => {
    const d = await makeDevice(new FakeServer());
    devices.push(d);
    const built = await buildProject(d, fakePhoto, { indexPage: false, days: true });
    await writeBlocks(d, built.ids.s029, [{ table: [['Fecha Rodaje', '16/03/2026'], ['Locacion Real', 'CENADE']] }]);
    await d.engine.syncNow();
    const host = mount(d, built.ids.d76);
    const card = await shown(() => {
      const c = header(host)?.querySelector<HTMLElement>('.lh-tomorrow.new');
      expect(c).toBeTruthy();
      return c!;
    });
    expect(card.querySelector('.row2')!.textContent).toContain('Creates «2026-03-16 | Día 77 | CENADE» in «2 | Rodaje»');
    click(card.querySelector('.lh-prepare'));
    await shown(() => expect(d.tree.children(built.ids.rodaje).some((p) => p.title === '2026-03-16 | Día 77 | CENADE')).toBe(true));
  });

  it('quien ve una parte del proyecto (un invitado a la carpeta de días) no tiene la tarjeta: mañana puede estar donde no ve', async () => {
    const server = new FakeServer();
    server.enableTeam();
    const owner = await makeDevice(server);
    devices.push(owner);
    const built = await buildProject(owner, fakePhoto, { indexPage: false, days: true });
    await owner.engine.syncNow();
    server.addMember('beto', 'member', 'beto@test');
    server.grant('beto', { pageId: built.ids.rodaje }, 'edit_pages');
    const guest = await makeDevice(server, crypto.randomUUID(), '0.021', {}, undefined, { id: 'beto', email: 'beto@test' });
    devices.push(guest);
    await guest.engine.syncNow();
    await guest.engine.syncNow();
    const host = mount(guest, built.ids.d76);
    await shown(() => expect(header(host)?.textContent).toContain('Live'));
    await act(() => settled(300));
    expect(header(host)!.querySelector('.lh-tomorrow')).toBeNull();
    // El dueño, en cambio, sí.
    const host2 = mount(owner, built.ids.d76);
    await shown(() => expect(host2.querySelector('section.lh .lh-tomorrow.new')).toBeTruthy());
  });

  it('sin red: no crea nada y lo dice', async () => {
    const server = new FakeServer();
    const d = await makeDevice(server);
    devices.push(d);
    const built = await buildProject(d, fakePhoto, { indexPage: false, days: true });
    await d.engine.syncNow();
    const host = mount(d, built.ids.d76);
    const button = await shown(() => {
      const b = header(host)?.querySelector<HTMLElement>('.lh-tomorrow.new .lh-prepare');
      expect(b).toBeTruthy();
      return b!;
    });
    const before = d.tree.children(built.ids.rodaje).length;
    server.online = false;
    click(button);
    // Mientras mira si otro dispositivo ya lo creó, la tarjeta lo dice (no solo el botón apagado, D629).
    await shown(() => expect(header(host)!.querySelector('.lh-tomorrow.new .row2 [role=status]')?.textContent).toMatch(/^Creating «2026-03-\d\d \| Día 77»… first it checks/));
    await shown(() => expect(host.textContent).toContain('Connect to create tomorrow’s report'), 15000);
    expect(header(host)!.querySelector('.lh-tomorrow.new .row2 [role=status]')).toBeNull();
    expect(d.tree.children(built.ids.rodaje).length).toBe(before);
    server.online = true;
  });
});

describe('Create y Assign en la cabecera del día (E7)', () => {
  it('Assign en una sección sin número: agrega « · 105_025» con link al título y la sección pasa a esa escena con sus fotos', async () => {
    const { d, built, host } = await app('d59');
    await until(() => header(host)?.textContent?.includes('Live'), 'la cabecera completa');
    const row = () => [...header(host)!.querySelectorAll<HTMLElement>('.lh-mrow')].find((r) => r.textContent?.includes('Plates ambulancia'));
    click(row()!.querySelector('.rel-assign'));
    const input = header(host)!.querySelector<HTMLInputElement>('.lh-picker input')!;
    type(input, '025');
    const options = [...header(host)!.querySelectorAll<HTMLElement>('.lh-picker-list button')];
    expect(options[0].textContent).toBe('105_025El fugitivo espera escondido');
    click(options[0]);
    await until(async () => (await headingRuns(d, built.ids.d59)).some((h) => h.includes('105_025')), 'el título con la escena');
    expect(await headingRuns(d, built.ids.d59)).toContain(`Plates ambulancia · [105_025](/p/${built.ids.s025})`);
    await until(() => [...header(host)!.querySelectorAll('.lh-mrow')].some((r) => r.textContent?.startsWith('105_025') && r.textContent.includes('2 photos')), 'la fila de 105_025');
    expect([...header(host)!.querySelectorAll('.lh-mrow')].some((r) => r.textContent?.includes('no scene number'))).toBe(false);
    // Tooltips de la app, nunca `title=`.
    expect(header(host)!.querySelectorAll('[title]').length).toBe(0);
  });

  it('Assign tiene Undo en su aviso: saca solo « · 105_025»; si alguien cambió el título después, no toca nada (D566)', async () => {
    const { d, built, host } = await app('d59');
    await until(() => header(host)?.textContent?.includes('Live'), 'la cabecera completa');
    const row = () => [...header(host)!.querySelectorAll<HTMLElement>('.lh-mrow')].find((r) => r.textContent?.includes('Plates ambulancia'));
    const assign = async () => {
      click(row()!.querySelector('.rel-assign'));
      type(header(host)!.querySelector<HTMLInputElement>('.lh-picker input')!, '025');
      click(header(host)!.querySelector('.lh-picker-list button'));
      await shown(async () => expect(await headingRuns(d, built.ids.d59)).toContain(`Plates ambulancia · [105_025](/p/${built.ids.s025})`));
      return shown(() => {
        const undo = [...host.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === 'Undo');
        expect(undo).toBeTruthy();
        return undo!;
      });
    };
    const undo = await assign();
    expect(host.textContent).toContain('Assigned 105_025 to «Plates ambulancia»');
    click(undo);
    await shown(async () => expect(await headingRuns(d, built.ids.d59)).toContain('Plates ambulancia'));
    await shown(() => expect(host.textContent).toContain('Assign undone'));
    await shown(() => expect(row()?.textContent).toContain('no scene number'));

    // Otra vez, y ahora alguien escribe en el medio de lo agregado antes de deshacer: no se toca nada.
    const undo2 = await assign();
    const doc = await d.docs.open(built.ids.d59);
    let text: Y.XmlText | null = null;
    const walk = (node: Y.XmlElement | Y.XmlFragment) => {
      for (const c of node.toArray()) {
        if (c instanceof Y.XmlText && c.toString().startsWith('Plates ambulancia')) text = c;
        else if (c instanceof Y.XmlElement) walk(c);
      }
    };
    walk(doc.getXmlFragment('document-store'));
    (text as Y.XmlText | null)!.insert('Plates ambulancia · '.length, 'ruta ', {});
    d.docs.close(built.ids.d59);
    click(undo2);
    await shown(() => expect(host.textContent).toContain('It changed since: nothing was undone'));
    expect((await headingRuns(d, built.ids.d59)).some((h) => h.startsWith('Plates ambulancia · ruta ') && h.includes(`/p/${built.ids.s025}`))).toBe(true);
  });

  it('un número que no existe: Create con el motivo (permisos desconocidos) y Assign pone el link sobre lo escrito', async () => {
    const d = await makeDevice(new FakeServer());
    devices.push(d);
    const built = await buildProject(d, fakePhoto, { indexPage: false, days: true });
    await writeBlocks(d, built.ids.d58, [{ h: 1, text: 'Info general' }, { p: 'Llamado 8:00.' }, { h: 1, text: 'Escena 105_120' }, { p: 'Plano del puente.' }]);
    const host = mount(d, built.ids.d58);
    await until(() => [...(header(host)?.querySelectorAll('.lh-mrow') ?? [])].some((r) => r.textContent?.includes('105_120')), 'la fila pendiente');
    const row = [...header(host)!.querySelectorAll<HTMLElement>('.lh-mrow')].find((r) => r.textContent?.includes('105_120'))!;
    const cant = row.querySelector('.rel-cant')!;
    expect(cant.textContent).toBe('Create scene 105_120');
    expect(cant.getAttribute('data-tip')).toContain('whole project');
    click(row.querySelector('.rel-assign'));
    // Sin plan ni secciones de escena en el día: primero las del episodio del número escrito (D570, O8 de E7).
    const firsts = [...header(host)!.querySelectorAll('.lh-picker-list button .k')].map((x) => x.textContent);
    expect(firsts.slice(0, 4)).toEqual(['105_025', '105_026', '105_027', '105_029']);
    type(header(host)!.querySelector<HTMLInputElement>('.lh-picker input')!, '5026');
    click(header(host)!.querySelector('.lh-picker-list button'));
    await until(async () => (await headingRuns(d, built.ids.d58)).some((h) => h.includes('/p/')), 'el link');
    expect(await headingRuns(d, built.ids.d58)).toEqual(['Info general', `Escena [105_120](/p/${built.ids.s026})`]);
    await until(() => [...header(host)!.querySelectorAll('.lh-mrow')].some((r) => r.textContent?.startsWith('105_026')), 'la fila de 105_026');
  });

  it('con las guardas: Create crea la escena en su carpeta, la fila pasa a ser de ella, y Undo la manda a la papelera', async () => {
    const server = new FakeServer();
    server.enableTeam();
    const d = await makeDevice(server);
    devices.push(d);
    const built = await buildProject(d, fakePhoto, { indexPage: false, days: true });
    await writeBlocks(d, built.ids.d58, [{ h: 1, text: 'Escena 105_120' }, { p: 'Plano del puente.' }]);
    await d.engine.syncNow();
    const host = mount(d, built.ids.d58);
    await until(() => [...(header(host)?.querySelectorAll('.lh-mrow .rel-create') ?? [])].length === 1, 'el botón Create');
    const button = header(host)!.querySelector<HTMLElement>('.lh-mrow .rel-create')!;
    expect(button.textContent).toBe('Create scene 105_120');
    expect(button.getAttribute('data-tip')).toBe('In «105 | Episodio 5»');
    click(button);
    await until(() => d.tree.children(built.ids.ep5).some((p) => p.title === '105_120'), 'la escena creada');
    const created = d.tree.children(built.ids.ep5).find((p) => p.title === '105_120')!;
    expect(created.settings?.entity).toEqual({ kind: 'scene', code: '105_120' });
    await until(() => [...host.querySelectorAll('button')].some((b) => b.textContent === 'Undo'), 'el aviso');
    expect(host.textContent).toContain('Created scene 105_120 in «105 | Episodio 5»');
    await until(() => [...header(host)!.querySelectorAll('.lh-mrow')].some((r) => r.textContent?.startsWith('105_120') && !r.querySelector('.rel-create')), 'la fila de la escena');
    click([...host.querySelectorAll('button')].find((b) => b.textContent === 'Undo'));
    await until(() => d.tree.isTrashed(created.id), 'a la papelera');
    // La fila vuelve a pendiente y dice a la vista que está en la papelera, con el link para restaurarla (O4).
    await until(() => header(host)!.querySelector('.rel-cant.trash'), 'el rótulo de la papelera');
    expect(header(host)!.querySelector('.rel-cant.trash')!.textContent).toBe('In the trash · restore it');
    click(header(host)!.querySelector('.rel-cant.trash'));
    await until(() => location.pathname === '/trash', 'la papelera');
    // El reporte no cambió: crear no escribe en el día.
    expect(await headingRuns(d, built.ids.d58)).toEqual(['Escena 105_120']);
  });

  it('invitados (permiso sobre carpetas, no sobre el proyecto): Create con el motivo; Assign solo para quien edita el día', async () => {
    const server = new FakeServer();
    server.enableTeam();
    const owner = await makeDevice(server);
    devices.push(owner);
    const built = await buildProject(owner, fakePhoto, { indexPage: false, days: true });
    await writeBlocks(owner, built.ids.d58, [{ h: 1, text: 'Escena 105_120' }, { p: 'Plano del puente.' }]);
    await owner.engine.syncNow();
    for (const [who, level] of [['ana', 'view'], ['beto', 'edit_pages']] as const) {
      server.addMember(who, 'member', `${who}@test`);
      server.grant(who, { pageId: built.ids.rodaje }, level);
      server.grant(who, { pageId: built.ids.desglose }, level);
    }
    for (const who of ['ana', 'beto']) {
      const guest = await makeDevice(server, crypto.randomUUID(), '0.021', {}, undefined, { id: who, email: `${who}@test` });
      devices.push(guest);
      await guest.engine.syncNow();
      await guest.engine.syncNow();
      const host = mount(guest, built.ids.d58);
      await until(() => header(host)?.querySelector('.rel-cant'), `el rótulo de ${who}`);
      expect(header(host)!.querySelector('.rel-cant')!.getAttribute('data-tip')).toContain('whole project');
      expect(header(host)!.querySelector('.rel-create')).toBeNull();
      expect(!!header(host)!.querySelector('.rel-assign')).toBe(who === 'beto');
      act(() => roots.pop()!.unmount());
      host.remove();
    }
  });
});
