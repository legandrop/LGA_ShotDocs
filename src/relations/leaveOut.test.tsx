// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { shown } from '../test/shown';
import { PageMenu } from '../ui/menus';
import { disposeRelationsSession, relationsSession } from '../ui/relationsUi';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { placedEntity } from './entitySync';
import { writeBlocks } from './fixtures/proyectoSintetico';
import { HoldsTag } from './HoldsTag';
import { LiveHeader } from './LiveHeader';
import { LinkContext, type LinkInfo } from '../linkMode';
import { linkFragment } from './LinkLocation';
import { t } from '../i18n';

// *Leave out of relations* (D540, D541) y el aviso de un nombre escrito que no cuenta (D534), en la interfaz de verdad:
// la casilla del menú ⋯ escribe solo `graph`, se hereda deshabilitada «By folder», el árbol lo rotula y la cabecera de lo
// que quedó afuera lo dice en vez de desaparecer.

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
});

const roots: Root[] = [];
const devices: Device[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const d of devices.splice(0)) {
    disposeRelationsSession({ docs: d.docs });
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  document.body.innerHTML = '';
});

function services(d: Device): Services {
  const config = { url: 'https://example.invalid', publishableKey: 'sb_publishable_test', name: 'Wanka', localKey: WANKA_LOCAL_KEY, storage: legacyStorageNames(WANKA_LOCAL_KEY) };
  const client = { auth: { signOut: () => undefined } } as never;
  return {
    workspace: { config, client },
    client,
    user: { id: d.remote.userId, email: 'a@test' },
    db: d.db,
    tree: d.tree,
    docs: d.docs,
    files: d.files,
    media: d.media,
    engine: d.engine,
    access: d.access,
    remote: d.remote as unknown as SupabaseRemote,
    dbName: 'test',
    mediaDb: d.mediaDb,
    comments: d.comments,
    commentsDb: d.commentsDb,
    sizes: d.sizes,
    offline: d.offline,
    shutdown: async () => undefined,
  } as Services;
}

/** Un proyecto chico con escenas, locaciones (dos con «Europa» escrito) y un archivo; con las relaciones ya leídas. */
async function project(opts: { typed?: boolean } = {}) {
  const server = new FakeServer();
  const d = await makeDevice(server);
  d.tree.onPlaced = (id, how) => placedEntity(d.tree, id, how);
  devices.push(d);
  const ids: Record<string, string> = {};
  if (opts.typed !== false) {
    ids.bd = await d.tree.create(null, 'Breakdown');
    await d.tree.setSetting(ids.bd, 'holds', 'scene');
    ids.scene = await d.tree.create(ids.bd, '101_074 | Llegan al bar');
    ids.locs = await d.tree.create(null, 'Locations');
    await d.tree.setSetting(ids.locs, 'holds', 'location');
    ids.europa = await d.tree.create(ids.locs, 'Europa (plates)');
    ids.brand = await d.tree.create(ids.locs, 'Brandemburgo (Europa)');
    await writeBlocks(d, ids.europa, [{ p: 'Otros nombres: Europa' }]);
    await writeBlocks(d, ids.brand, [{ p: 'Otros nombres: Europa' }]);
    ids.archivo = await d.tree.create(null, '90 | Archivo');
    ids.copia = await d.tree.create(ids.archivo, '101_075 | Copia vieja');
    await d.tree.setSetting(ids.copia, 'entity', { kind: 'scene', code: '101_075' });
    await d.tree.setSetting(ids.archivo, 'graph', false);
  } else {
    ids.notes = await d.tree.create(null, 'Notas');
  }
  const session = relationsSession({ tree: d.tree, docs: d.docs, db: d.db });
  session.open(d.tree.workspaceId);
  await session.index.refresh(d.tree.workspaceId);
  await session.relations.update(d.tree.workspaceId);
  return { d, server, ids, session };
}

function mount(d: Device, node: React.ReactNode): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<ServicesContext.Provider value={services(d)}>{node}</ServicesContext.Provider>));
  return host;
}

const item = (host: HTMLElement) => [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Leave out of relations'));

function menu(d: Device, pageId: string, closed = { n: 0 }) {
  return mount(
    d,
    <PageMenu
      pageId={pageId}
      position={{ top: 0, left: 0 }}
      anchor={null}
      onClose={() => closed.n++}
      onNewChild={() => undefined}
      onRename={() => undefined}
      onMove={() => undefined}
      onFormat={() => undefined}
      onTrash={() => undefined}
    />,
  );
}

describe('Leave out of relations en el menú ⋯ (D540)', () => {
  it('marcar y desmarcar escribe solo la clave `graph`; el árbol la rotula', async () => {
    const { d, ids } = await project();
    const before = { ...d.tree.get(ids.scene)!.settings };
    const closed = { n: 0 };
    let host = menu(d, ids.scene, closed);
    const box = await shown(() => item(host)!);
    expect(box.getAttribute('role')).toBe('menuitemcheckbox');
    expect(box.getAttribute('aria-checked')).toBe('false');
    expect(box.getAttribute('data-tip')).toContain('Map');
    act(() => box.click());
    await shown(() => expect(d.tree.get(ids.scene)!.settings).toEqual({ ...before, graph: false }));
    expect(closed.n).toBe(1);
    const tag = mount(d, <HoldsTag pageId={ids.scene} />);
    await shown(() => expect(tag.querySelector('[data-holds="off"]')?.textContent).toBe('Left out'));
    for (const r of roots.splice(0)) act(() => r.unmount());
    host = menu(d, ids.scene);
    const on = await shown(() => item(host)!);
    expect(on.getAttribute('aria-checked')).toBe('true');
    expect(on.querySelector('.check')?.textContent).toBe('On');
    act(() => on.click());
    await shown(() => expect(d.tree.get(ids.scene)!.settings).toEqual(before));
  });

  it('heredado de una carpeta: marcado, deshabilitado, «By folder», y el clic no escribe nada', async () => {
    const { d, ids } = await project();
    const host = menu(d, ids.copia);
    const box = await shown(() => item(host)!);
    expect(box.getAttribute('aria-checked')).toBe('true');
    expect(box.getAttribute('aria-disabled')).toBe('true');
    expect(box.querySelector('.check')?.textContent).toBe('By folder');
    expect(box.getAttribute('data-tip')).toBe('“90 | Archivo” is left out, with everything inside');
    act(() => box.click());
    expect(d.tree.get(ids.copia)!.settings?.graph).toBeUndefined();
    // Lo de adentro no lleva el rótulo: solo la página marcada.
    expect(mount(d, <HoldsTag pageId={ids.copia} />).querySelector('[data-holds="off"]')).toBeNull();
    expect(mount(d, <HoldsTag pageId={ids.archivo} />).querySelector('[data-holds="off"]')?.getAttribute('data-tip')).toBe('Left out of relations, with everything inside');
  });

  it('un proyecto sin escenas, locaciones ni días y sin marcas no lo muestra', async () => {
    const { d, ids } = await project({ typed: false });
    const host = menu(d, ids.notes);
    await shown(() => expect([...host.querySelectorAll('button')].some((b) => b.textContent?.startsWith('Rename'))).toBe(true));
    expect(item(host)).toBeUndefined();
  });

  it('quien no puede cambiar la fila (un invitado que ve) no lo ve', async () => {
    const { d: owner, server, ids } = await project();
    server.enableTeam();
    await owner.engine.syncNow();
    const id = '00000000-0000-4000-8000-0000000000b1';
    server.addMember(id, 'guest', 'ana@test');
    server.grant(id, { pageId: ids.scene }, 'view');
    const ana = await makeDevice(server, crypto.randomUUID(), '0.021', {}, undefined, { id, email: 'ana@test' });
    devices.push(ana);
    await ana.engine.syncNow();
    const host = menu(ana, ids.scene);
    await shown(() => expect([...host.querySelectorAll('button')].some((b) => b.textContent?.startsWith('Rename'))).toBe(true));
    expect(item(host)).toBeUndefined();
  });
});

describe('la cabecera de lo que quedó afuera (D541) y el nombre que no cuenta (D534)', () => {
  it('una escena dentro de una carpeta afuera: «Left out of relations · by “90 | Archivo”» con el toque a la carpeta', async () => {
    const { d, ids } = await project();
    const host = mount(d, <LiveHeader pageId={ids.copia} />);
    const line = await shown(() => host.querySelector('.lh-out-line')!);
    expect(line.textContent).toBe('Left out of relations · by “90 | Archivo”');
    expect(line.getAttribute('data-tip')).toContain('Leave out of relations');
    act(() => (host.querySelector('.lh-out-by') as HTMLButtonElement).click());
    expect(location.pathname).toContain(ids.archivo);
  });

  it('la escena con su propia marca: el renglón sin «by»', async () => {
    const { d, ids, session } = await project();
    await d.tree.setSetting(ids.scene, 'graph', false);
    await session.relations.update(d.tree.workspaceId);
    const host = mount(d, <LiveHeader pageId={ids.scene} />);
    await shown(() => expect(host.querySelector('.lh-out-line')?.textContent).toBe('Left out of relations'));
    expect(host.querySelector('.lh-out-by')).toBeNull();
  });

  it('«Europa» escrito en dos locaciones: un renglón apagado en las dos, con el toque a la otra', async () => {
    const { d, ids } = await project();
    const host = mount(d, <LiveHeader pageId={ids.europa} />);
    const note = await shown(() => host.querySelector('.lh-anote')!);
    expect(note.textContent).toBe('“Europa” is also another name of Brandemburgo (Europa) — not used for either');
    expect(note.getAttribute('data-tip')).toContain('Other names');
    act(() => (note.querySelector('.lh-anote-go') as HTMLButtonElement).click());
    expect(location.pathname).toContain(ids.brand);
  });
});

describe('el texto de cada aviso de nombre (D661)', () => {
  it('el nombre de otra locación y el compartido dicen cosas distintas', async () => {
    const { d, ids } = await project();
    const norte = await d.tree.create(ids.locs, 'Estudio Norte');
    const taller = await d.tree.create(ids.locs, 'Taller Sur');
    await writeBlocks(d, taller, [{ p: 'Otros nombres: Estudio Norte' }]);
    const session = relationsSession({ tree: d.tree, docs: d.docs, db: d.db });
    await session.index.refresh(d.tree.workspaceId);
    await session.relations.update(d.tree.workspaceId);
    void norte;
    const own = mount(d, <LiveHeader pageId={taller} />);
    const name = await shown(() => own.querySelector('.lh-anote')!);
    expect(name.textContent).toContain('is the name of');
    expect(name.getAttribute('data-tip')).toContain('name of another location');
    expect(name.getAttribute('data-tip')).not.toContain('one of the two');
    const shared = mount(d, <LiveHeader pageId={ids.europa} />);
    const note = await shown(() => shared.querySelector('.lh-anote')!);
    expect(note.getAttribute('data-tip')).toContain('on the other one too');
    expect(note.getAttribute('data-tip')).toContain('one of the two');
  });
});

describe('Leave out of relations con un link público (D663)', () => {
  it('con un link abierto la casilla no se ofrece, ni siquiera en una página que ya tiene la marca', async () => {
    const { d, ids } = await project();
    const link = { entry: { id: 'l1' }, domain: 'x.supabase.co', linkId: 'l1', pageId: ids.archivo } as unknown as LinkInfo;
    // Con una cuenta la casilla está (control); con el link abierto, el mismo menú no la trae.
    await shown(() => expect(item(menu(d, ids.archivo))).toBeDefined());
    const host = mount(
      d,
      <LinkContext.Provider value={link}>
        <PageMenu pageId={ids.archivo} position={{ top: 0, left: 0 }} anchor={null} onClose={() => undefined} onNewChild={() => undefined} onRename={() => undefined} onMove={() => undefined} onFormat={() => undefined} onTrash={() => undefined} />
      </LinkContext.Provider>,
    );
    await shown(() => expect(host.querySelector('button')).not.toBeNull());
    expect(item(host)).toBeUndefined();
  });
});

describe('Link to a location… no escribe lo que el lector ignoraría (D662)', () => {
  it('con comas, más de 60 caracteres o el nombre de la locación misma, el aviso no dice «agregado» y la página no cambia', async () => {
    const { d, ids } = await project();
    const edif = await d.tree.create(ids.locs, 'Edificio Ministerial Hall');
    await writeBlocks(d, edif, [{ p: 'Hall de mármol.' }]);
    const notices: string[] = [];
    const listen = (ev: Event) => {
      const n = (ev as CustomEvent).detail;
      notices.push(typeof n === 'object' ? n.message : String(n));
    };
    window.addEventListener('shotdocs:notice', listen);
    try {
      const loc = { name: 'Edificio Ministerial Hall', pageId: edif };
      for (const raw of ['Edif Ministe Hall, Bar Berlin', 'Edificio '.repeat(8), 'edificio ministerial hall']) await linkFragment(services(d), t, loc, raw);
      expect(notices.some((m) => m.startsWith('Added'))).toBe(false);
      expect(notices).toHaveLength(3);
      expect(notices[0]).toContain('can’t be a name');
      expect(notices[2]).toBe('“edificio ministerial hall” was already a name of Edificio Ministerial Hall');
      const { unitsFromYDoc } = await import('../search/extract');
      const doc = await d.docs.open(edif);
      expect(unitsFromYDoc(doc).map((u) => u.text)).toEqual(['Hall de mármol.']);
      d.docs.close(edif);
    } finally {
      window.removeEventListener('shotdocs:notice', listen);
    }
  });
});

describe('Link to a location… desde un día sin lugar (D539)', () => {
  it('ofrece primero la parecida, escribe el texto del título en Otros nombres, el día pasa a ser de esa locación y Undo lo saca', async () => {
    const { d, ids, session } = await project();
    const days = await d.tree.create(null, 'Rodaje');
    await d.tree.setSetting(days, 'holds', 'day');
    const day = await d.tree.create(days, '2026-02-18 | Día 58 | Edif Ministe Hall');
    const edif = await d.tree.create(ids.locs, 'Edificio Ministerial Hall');
    await writeBlocks(d, edif, [{ p: 'Hall de mármol.' }]);
    await session.index.refresh(d.tree.workspaceId);
    await session.relations.update(d.tree.workspaceId);
    const notices: { message: string; action?: { run: () => void }; second?: { run: () => void } }[] = [];
    const listen = (ev: Event) => notices.push((ev as CustomEvent).detail);
    window.addEventListener('shotdocs:notice', listen);
    try {
      const host = mount(d, <LiveHeader pageId={day} />);
      const button = await shown(() => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Link to a location…')!);
      expect(host.textContent).toContain('Edif Ministe Hall');
      expect(button.getAttribute('data-tip')).toContain('“Edif Ministe Hall”');
      act(() => button.click());
      const options = [...host.querySelectorAll('.lh-picker-list button')];
      expect(options[0].textContent).toBe('Edificio Ministerial Hallsimilar');
      act(() => (options[0] as HTMLButtonElement).click());
      const done = await shown(() => {
        const n = notices.find((x) => typeof x === 'object' && x.message === 'Added “Edif Ministe Hall” to Edificio Ministerial Hall');
        if (!n) throw new Error(`sin el aviso: ${JSON.stringify(notices)}`);
        return n;
      });
      const { unitsFromYDoc } = await import('../search/extract');
      const doc = await d.docs.open(edif);
      expect(unitsFromYDoc(doc).map((u) => u.text)).toEqual(['Other names: Edif Ministe Hall', 'Hall de mármol.']);
      d.docs.close(edif);
      // El día ya es de esa locación (2 s después, D537).
      await shown(async () => {
        await session.relations.update(d.tree.workspaceId);
        const role = session.relations.snapshot(d.tree.workspaceId)!.pages.get(day);
        expect(role).toBeDefined();
        const { dayRef } = await import('./liveView');
        expect(dayRef({ snap: session.relations.snapshot(d.tree.workspaceId)!, title: (id) => d.tree.get(id)?.title, content: (id) => session.index.content(id) }, day).locs).toEqual(['Edificio Ministerial Hall']);
      }, 8000);
      done.second!.run();
      await shown(() => expect(notices.some((n) => typeof n === 'object' ? n.message?.startsWith('Removed') : String(n).startsWith('Removed'))).toBe(true));
      const after = await d.docs.open(edif);
      expect(unitsFromYDoc(after).map((u) => u.text)).toEqual(['Hall de mármol.']);
      d.docs.close(edif);
    } finally {
      window.removeEventListener('shotdocs:notice', listen);
    }
  });
});
