// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ServicesContext, type Services } from '../services';
import type { SupabaseRemote } from '../sync/remote';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { PageMenu } from '../ui/menus';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { placedEntity } from './entitySync';
import { HoldsTag } from './HoldsTag';

// *Type* en el menú de la página y el rótulo de la carpeta en el árbol (Doc_Estructura_Proyecto.md, «Tipo de página»).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const devices: Device[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  document.body.innerHTML = '';
});

function services(d: Device, userId: string): Services {
  const config = { url: 'https://example.invalid', publishableKey: 'sb_publishable_test', name: 'Wanka', localKey: WANKA_LOCAL_KEY, storage: legacyStorageNames(WANKA_LOCAL_KEY) };
  const client = { auth: { signOut: () => undefined } } as never;
  return {
    workspace: { config, client },
    client,
    user: { id: userId, email: `${userId}@test` },
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

async function setup() {
  const server = new FakeServer();
  const device = await makeDevice(server);
  device.tree.onPlaced = (id, how) => placedEntity(device.tree, id, how);
  devices.push(device);
  await device.engine.syncNow();
  return { server, device };
}

function mount(device: Device, server: FakeServer, node: React.ReactNode): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<ServicesContext.Provider value={services(device, device.remote.userId ?? server.ownerId)}>{node}</ServicesContext.Provider>));
  return host;
}

const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));
const button = (host: HTMLElement, label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith(label));

function menu(device: Device, server: FakeServer, pageId: string, closed: { n: number }) {
  return mount(
    device,
    server,
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

describe('Type en el menú de la página', () => {
  it('marca la carpeta como de escenas: el rótulo aparece y lo de adentro queda marcado', async () => {
    const { device, server } = await setup();
    const folder = await device.tree.create(null, 'Desglose');
    const scene = await device.tree.create(folder, '101_074 | Llegan al bar');
    const tag = mount(device, server, <HoldsTag pageId={folder} />);
    expect(tag.textContent).toBe('');
    const closed = { n: 0 };
    const host = menu(device, server, folder, closed);
    act(() => button(host, 'Type')!.click());
    expect(host.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe('Type');
    expect(button(host, 'Scenes')?.getAttribute('aria-checked')).toBe('false');
    expect(button(host, 'Nothing in particular')?.getAttribute('aria-checked')).toBe('true');
    act(() => button(host, 'Scenes')!.click());
    await wait(30);
    expect(closed.n).toBe(1);
    expect(device.tree.get(folder)?.settings?.holds).toBe('scene');
    expect(device.tree.get(scene)?.settings?.entity).toEqual({ kind: 'scene', code: '101_074' });
    const span = tag.querySelector('.tree-holds')!;
    expect(span.textContent).toBe('Scenes');
    expect(span.getAttribute('data-tip')).toBe('Everything created inside is a scene');
  });

  it('en una página: muestra su tipo y su número, y «None of these» la desmarca', async () => {
    const { device, server } = await setup();
    const folder = await device.tree.create(null, 'Desglose');
    await device.tree.setSetting(folder, 'holds', 'scene');
    const scene = await device.tree.create(folder, '101_074 | Llegan al bar');
    const closed = { n: 0 };
    const host = menu(device, server, scene, closed);
    expect(button(host, 'Type')?.querySelector('.check')?.textContent).toBe('Scene');
    act(() => button(host, 'Type')!.click());
    expect(button(host, 'Scene')?.getAttribute('aria-checked')).toBe('true');
    expect(button(host, 'Scene')?.querySelector('.check')?.textContent).toBe('101_074');
    act(() => button(host, 'None of these')!.click());
    await wait(30);
    expect(device.tree.get(scene)?.settings?.entity).toBe(false);
  });

  it('Back vuelve a los ítems del menú', async () => {
    const { device, server } = await setup();
    const page = await device.tree.create(null, 'Algo');
    const host = menu(device, server, page, { n: 0 });
    act(() => button(host, 'Type')!.click());
    act(() => (host.querySelector('.type-back') as HTMLButtonElement).click());
    expect(button(host, 'Rename')).toBeDefined();
  });

  it('una carpeta de reportes del día muestra SHOOT DAYS y se marca como días', async () => {
    const { device, server } = await setup();
    const folder = await device.tree.create(null, 'Rodaje');
    const host = menu(device, server, folder, { n: 0 });
    act(() => button(host, 'Type')!.click());
    act(() => button(host, 'Shoot days')!.click());
    await wait(30);
    expect(device.tree.get(folder)?.settings).toEqual({ dayReports: {} });
    const tag = mount(device, server, <HoldsTag pageId={folder} />);
    expect(tag.textContent).toBe('Shoot days');
  });

  it('Use for day reports (el renglón de siempre) es lo mismo que Shoot days: no deja `holds` de otro tipo (O5)', async () => {
    const { device, server } = await setup();
    const folder = await device.tree.create(null, 'Desglose');
    await device.tree.setSetting(folder, 'holds', 'scene');
    let host = menu(device, server, folder, { n: 0 });
    act(() => button(host, 'Use for day reports')!.click());
    await wait(30);
    expect(device.tree.get(folder)?.settings).toEqual({ dayReports: {} });
    for (const r of roots.splice(0)) act(() => r.unmount());
    host = menu(device, server, folder, { n: 0 });
    act(() => button(host, 'Stop using for day reports')!.click());
    await wait(30);
    expect(device.tree.get(folder)?.settings).toEqual({ dayReports: false });
  });
});

describe('Type solo para quien puede cambiar la fila (O6)', () => {
  async function guest(level: 'view' | 'comment' | 'edit') {
    const { device: owner, server } = await setup();
    // Con la versión del equipo en la base (sin ella no hay datos de permisos y no se bloquea nada).
    server.enableTeam();
    const folder = await owner.tree.create(null, 'Desglose');
    const scene = await owner.tree.create(folder, '101_074 | Llegan');
    await owner.engine.syncNow();
    const id = '00000000-0000-4000-8000-0000000000b1';
    server.addMember(id, 'guest', 'ana@test');
    server.grant(id, { pageId: scene }, level);
    const ana = await makeDevice(server, crypto.randomUUID(), '0.021', {}, undefined, { id, email: 'ana@test' });
    devices.push(ana);
    await ana.engine.syncNow();
    expect(ana.tree.get(scene)).toBeDefined();
    return { server, ana, scene };
  }

  it('un lector y un invitado que comenta no ven Type', async () => {
    for (const level of ['view', 'comment'] as const) {
      const { server, ana, scene } = await guest(level);
      const host = menu(ana, server, scene, { n: 0 });
      expect(button(host, 'Rename'), level).toBeDefined();
      expect(button(host, 'Type'), level).toBeUndefined();
    }
  });

  it('un invitado que edita la escena sí lo ve', async () => {
    const { server, ana, scene } = await guest('edit');
    const host = menu(ana, server, scene, { n: 0 });
    expect(button(host, 'Type')).toBeDefined();
  });
});
