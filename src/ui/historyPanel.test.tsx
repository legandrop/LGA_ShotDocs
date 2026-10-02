// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { prefs } from '../prefs';
import { ServicesContext, type Services } from '../services';
import { HISTORY_SCHEMA_VERSION, yShape } from '../sync/history';
import type { SupabaseRemote } from '../sync/remote';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { HistoryPanel } from './HistoryPanel';
import { canSeeHistory, closeHistory, registerRestoreTarget } from './historyUi';

// La pantalla del historial (P.18, Docs/Doc_Historial.md, entrega 1) montada contra el servidor en memoria: la lista
// con quién y cuándo, sin red, sin permiso, lo sin subir y el camino de restaurar (que pide el editor de la página).

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
  Range.prototype.getClientRects ??= (() => []) as never;
  Range.prototype.getBoundingClientRect ??= (() => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 })) as never;
});

const roots: Root[] = [];
const devices: Device[] = [];
const offs: (() => void)[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const off of offs.splice(0)) off();
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
  }
  closeHistory();
  document.body.innerHTML = '';
});

function services(d: Device, userId: string): Services {
  const config = {
    url: 'https://znlvpuddswymxpffgvbz.supabase.co',
    publishableKey: 'sb_publishable_test',
    name: 'Wanka',
    localKey: WANKA_LOCAL_KEY,
    storage: legacyStorageNames(WANKA_LOCAL_KEY),
  };
  const client = { auth: {} } as never;
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
  };
}

const settle = (ms = 40) => act(async () => new Promise((r) => setTimeout(r, ms)));

async function mount(value: Services, pageId: string): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<ServicesContext.Provider value={value}><HistoryPanel pageId={pageId} /></ServicesContext.Provider>));
  for (let i = 0; i < 10 && host.querySelector('.history-state'); i++) await settle(60);
  await settle(200);
  return host;
}

function block(id: string, text: string): Y.XmlElement {
  const bc = new Y.XmlElement('blockContainer');
  bc.setAttribute('id', id);
  const p = new Y.XmlElement('paragraph');
  const t = new Y.XmlText();
  t.insert(0, text);
  p.insert(0, [t]);
  bc.insert(0, [p]);
  return bc;
}

async function edit(d: Device, pageId: string, fn: (g: Y.XmlElement) => void): Promise<void> {
  const doc = await d.docs.open(pageId);
  doc.transact(() => {
    const f = doc.getXmlFragment(CONTENT_FRAGMENT);
    if (f.length === 0) f.insert(0, [new Y.XmlElement('blockGroup')]);
    fn(f.get(0) as Y.XmlElement);
  }, 'test');
  await d.docs.flush(pageId);
  d.docs.close(pageId);
}

/** Una página con dos sesiones: una de la dueña y, una hora después, una de Bea. */
async function setup({ team = false } = {}) {
  const server = new FakeServer();
  if (team) server.enableTeam();
  let clock = Date.parse('2026-09-30T15:00:00Z');
  server.now = () => clock;
  server.settings = { ...(server.settings ?? { generation: 1, minAppVersion: null, mediaUrl: null, schemaVersion: 1 }), schemaVersion: HISTORY_SCHEMA_VERSION };
  const a = await makeDevice(server, undefined, '0.021', {}, HISTORY_SCHEMA_VERSION);
  devices.push(a);
  const pageId = await a.tree.create(null, 'P');
  await a.engine.syncNow();
  await edit(a, pageId, (g) => g.insert(0, [block('x', 'Primera versión')]));
  await a.engine.syncNow();
  clock += 60 * 60_000;
  server.addMember('bea', 'member', 'bea@example.com');
  if (team) server.grant('bea', { projectId: server.workspaceId }, 'edit');
  const b = await makeDevice(server, undefined, '0.021', {}, HISTORY_SCHEMA_VERSION, { id: 'bea', email: 'bea@example.com' });
  devices.push(b);
  await b.engine.syncNow();
  await edit(b, pageId, (g) => g.insert(1, [block('y', 'Lo de Bea')]));
  await b.engine.syncNow();
  await a.engine.syncNow();
  return { server, a, b, pageId };
}

describe('quién lo ve', () => {
  const perms = (edit: boolean, role: string | null) => ({ canEditPage: () => edit, role }) as never;
  it('quien edita, el dueño y los admins; no quien solo ve, ni un invitado aunque edite, ni con la base sin migrar', () => {
    expect(canSeeHistory(perms(true, 'member'), 'p', HISTORY_SCHEMA_VERSION)).toBe(true);
    expect(canSeeHistory(perms(true, 'owner'), 'p', HISTORY_SCHEMA_VERSION)).toBe(true);
    expect(canSeeHistory(perms(true, null), 'p', HISTORY_SCHEMA_VERSION)).toBe(true);
    expect(canSeeHistory(perms(false, 'member'), 'p', HISTORY_SCHEMA_VERSION)).toBe(false);
    expect(canSeeHistory(perms(true, 'guest'), 'p', HISTORY_SCHEMA_VERSION)).toBe(false);
    expect(canSeeHistory(perms(true, 'member'), 'p', HISTORY_SCHEMA_VERSION - 1)).toBe(false);
    expect(canSeeHistory(perms(true, 'member'), 'p', null)).toBe(false);
  });
});

describe('la pantalla del historial', () => {
  it('lista las sesiones con quién (Vos, el correo) y cuándo, la más nueva arriba como versión actual, y muestra la elegida', async () => {
    prefs.set({ language: 'en' });
    const { a, pageId, server } = await setup();
    const host = await mount(services(a, server.ownerId), pageId);
    const items = [...host.querySelectorAll('.history-session')];
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain('Current version');
    expect(items[0].textContent).toContain('bea@example.com');
    expect(items[1].textContent).toContain('You');
    expect(items[0].getAttribute('aria-current')).toBe('true');
    // La versión actual no se restaura (no hay botón); la anterior se muestra con el editor de verdad.
    expect(host.querySelector('.history-restore')).toBeNull();
    await act(async () => (items[1] as HTMLButtonElement).click());
    await settle(300);
    expect(host.querySelector('.history-page')?.textContent).toContain('Primera versión');
    expect(host.querySelector('.history-page')?.textContent).not.toContain('Lo de Bea');
    expect(host.querySelector('.history-restore')).not.toBeNull();
  });

  it('sin red avisa que necesita conexión', async () => {
    prefs.set({ language: 'en' });
    const { a, pageId, server } = await setup();
    server.online = false;
    const host = await mount(services(a, server.ownerId), pageId);
    expect(host.textContent).toContain('Version history needs a connection.');
    expect(host.querySelector('.history-session')).toBeNull();
  });

  it('quien solo ve la página (o un invitado) recibe el rechazo de la base: no ve nada', async () => {
    prefs.set({ language: 'en' });
    const { server, pageId } = await setup({ team: true });
    server.addMember('vera', 'member');
    server.grant('vera', { projectId: server.workspaceId }, 'view');
    server.addMember('gus', 'guest');
    server.grant('gus', { projectId: server.workspaceId }, 'edit');
    for (const who of ['vera', 'gus']) {
      const d = await makeDevice(server, undefined, '0.021', {}, HISTORY_SCHEMA_VERSION, { id: who });
      devices.push(d);
      await d.engine.syncNow();
      const host = await mount(services(d, who), pageId);
      expect(host.textContent, who).toContain("You can't see the history of this page.");
      expect(host.querySelector('.history-session'), who).toBeNull();
    }
  });

  it('con cambios de la página sin subir en el dispositivo, lo avisa y no deja restaurar', async () => {
    prefs.set({ language: 'en' });
    const { a, pageId, server } = await setup();
    server.online = true;
    await edit(a, pageId, (g) => g.insert(0, [block('z', 'Sin subir')]));
    const host = await mount(services(a, server.ownerId), pageId);
    expect(host.textContent).toContain("aren't synced yet");
    await act(async () => (host.querySelectorAll('.history-session')[1] as HTMLButtonElement).click());
    await settle(300);
    const button = host.querySelector<HTMLButtonElement>('.history-restore')!;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('data-tip')).toContain("aren't synced yet");
  });

  it('restaurar: confirma, sincroniza, se lo pide al editor de la página con la versión elegida y deja el aviso con Undo', async () => {
    prefs.set({ language: 'en' });
    const { a, pageId, server } = await setup();
    const asked: Y.Doc[] = [];
    let undone = 0;
    offs.push(
      registerRestoreTarget(pageId, (version) => {
        asked.push(version);
        return { ok: true, undo: () => (undone++, true), onEdit: () => () => undefined };
      }),
    );
    const actions: { message: string; action: { label: string; run: () => void } }[] = [];
    const onAction = (e: Event) => actions.push((e as CustomEvent).detail);
    window.addEventListener('shotdocs:notice-action', onAction);
    offs.push(() => window.removeEventListener('shotdocs:notice-action', onAction));
    const host = await mount(services(a, server.ownerId), pageId);
    await act(async () => (host.querySelectorAll('.history-session')[1] as HTMLButtonElement).click());
    await settle(300);
    const button = host.querySelector<HTMLButtonElement>('.history-restore')!;
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    await settle(100);
    expect(host.querySelector('.history-confirm')?.textContent).toContain('Nothing is lost');
    // Bea editó hace más de 2 minutos (una hora): no hay aviso de alguien editando.
    expect(host.querySelector('.history-confirm')?.textContent).not.toContain('could be left out');
    const confirm = [...host.querySelectorAll<HTMLButtonElement>('.history-confirm button')].find((b) => b.textContent === 'Restore')!;
    await act(async () => confirm.click());
    await settle(200);
    expect(asked.length).toBe(1);
    expect(yShape(asked[0]).ids).toEqual(['x']);
    expect(actions.length).toBe(1);
    expect(actions[0].message).toContain('Restored the version from');
    expect(actions[0].action.label).toBe('Undo');
    actions[0].action.run();
    expect(undone).toBe(1);
  });

  it('si el editor de la página no la puede restaurar (no está abierto para editar), lo dice y no pasa nada', async () => {
    prefs.set({ language: 'en' });
    const { a, pageId, server } = await setup();
    const host = await mount(services(a, server.ownerId), pageId);
    await act(async () => (host.querySelectorAll('.history-session')[1] as HTMLButtonElement).click());
    await settle(300);
    await act(async () => host.querySelector<HTMLButtonElement>('.history-restore')!.click());
    await settle(100);
    const confirm = [...host.querySelectorAll<HTMLButtonElement>('.history-confirm button')].find((b) => b.textContent === 'Restore')!;
    await act(async () => confirm.click());
    await settle(200);
    expect(host.querySelector('.history-message')?.textContent).toContain("The page isn't open for editing on this device");
  });
});
