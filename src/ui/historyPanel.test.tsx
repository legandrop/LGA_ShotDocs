// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { t } from '../i18n';
import { prefs } from '../prefs';
import { ServicesContext, type Services } from '../services';
import { HISTORY_SCHEMA_VERSION, NAMED_VERSIONS_SCHEMA_VERSION, traceFromSets, yShape, type HistoryRow } from '../sync/history';
import { HistoryCore, type HistoryRequest } from '../sync/historyCore';
import type { SupabaseRemote } from '../sync/remote';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeRemote, FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { HistoryPanel, mergeRows, recentOther } from './HistoryPanel';
import { canSeeHistory, closeHistory, registerRestoreTarget } from './historyUi';
import { addShape, PHOTO_MARKUP_MAP, writeFrame } from '../media/markup';
import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { compareAnnotations } from './historyAnnotations';

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

function services(d: Device, userId: string, dbName = `test-${crypto.randomUUID()}`): Services {
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
    dbName,
    mediaDb: d.mediaDb,
    comments: d.comments,
    commentsDb: d.commentsDb,
    sizes: d.sizes,
    offline: d.offline,
    shutdown: async () => undefined,
  };
}

const settle = (ms = 40) => act(async () => new Promise((r) => setTimeout(r, ms)));

async function mount(value: Services, pageId: string, parent: HTMLElement = document.body): Promise<HTMLElement> {
  const host = document.createElement('div');
  parent.append(host);
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
/** Un archivo del Drive ya mandado a la papelera de Drive, usado en la primera versión (con `photo`). */
const TRASHED_FILE = '00000000-0000-4000-8000-0000000f0001';

async function setup({ team = false, photo = false } = {}) {
  const server = new FakeServer();
  if (team) server.enableTeam();
  let clock = Date.parse('2026-09-30T15:00:00Z');
  server.now = () => clock;
  server.settings = { ...(server.settings ?? { generation: 1, minAppVersion: null, mediaUrl: null, schemaVersion: 1 }), schemaVersion: HISTORY_SCHEMA_VERSION };
  const a = await makeDevice(server, undefined, '0.021', {}, HISTORY_SCHEMA_VERSION);
  devices.push(a);
  const pageId = await a.tree.create(null, 'P');
  await a.engine.syncNow();
  await edit(a, pageId, (g) => {
    g.insert(0, [block('x', 'Primera versión')]);
    if (photo) {
      const bc = new Y.XmlElement('blockContainer');
      bc.setAttribute('id', 'img');
      const image = new Y.XmlElement('image');
      image.setAttribute('url', `sdmedia://${TRASHED_FILE}`);
      bc.insert(0, [image]);
      g.insert(1, [bc]);
    }
  });
  await a.engine.syncNow();
  if (photo) {
    server.mediaFiles.set(TRASHED_FILE, {
      id: TRASHED_FILE,
      name: 'IMG_0001.JPG',
      mime: 'image/jpeg',
      width: 10,
      height: 10,
      duration: null,
      thumb_at: null,
      drive_id: 'd1',
      size: 1000,
      project_id: server.workspaceId,
      purged_at: '2026-09-30T15:30:00Z',
      drive_trashed_at: '2026-09-30T15:31:00Z',
    });
  }
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
    // En el teléfono no hay tooltip: el motivo va también en una línea (la muestra el CSS en pantalla angosta).
    expect(host.querySelector('.history-why')?.textContent).toContain("aren't synced yet");
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
    const onAction = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail === 'object' && detail.action) actions.push(detail);
    };
    window.addEventListener('shotdocs:notice', onAction);
    offs.push(() => window.removeEventListener('shotdocs:notice', onAction));
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

  it('mientras está abierto, el teclado no llega a la página: el foco va al historial y lo demás queda inert; al cerrar, vuelve', async () => {
    prefs.set({ language: 'en' });
    const { a, pageId, server } = await setup();
    // Como la app: la página (un editor con el foco) y el historial, hermanos adentro de `.shell`.
    const shell = document.createElement('div');
    shell.className = 'shell';
    const page = document.createElement('div');
    page.contentEditable = 'true';
    page.tabIndex = 0;
    shell.append(page);
    document.body.append(shell);
    page.focus();
    expect(document.activeElement).toBe(page);
    const host = await mount(services(a, server.ownerId), pageId, shell);
    const screen = host.querySelector('.history-screen')!;
    expect(screen.contains(document.activeElement)).toBe(true);
    expect(page.hasAttribute('inert')).toBe(true);
    expect(host.hasAttribute('inert')).toBe(false);
    act(() => roots.pop()!.unmount());
    expect(page.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(page);
  });

  it('si otra persona cambió la página mientras el historial estaba abierto, al confirmar vuelve a preguntar con el aviso (y la cuenta de fotos)', async () => {
    prefs.set({ language: 'en' });
    const { a, b, pageId, server } = await setup({ photo: true });
    const asked: Y.Doc[] = [];
    offs.push(
      registerRestoreTarget(pageId, (version) => {
        asked.push(version);
        return { ok: true, undo: () => true, onEdit: () => () => undefined };
      }),
    );
    const host = await mount(services(a, server.ownerId), pageId);
    await act(async () => (host.querySelectorAll('.history-session')[1] as HTMLButtonElement).click());
    await settle(300);
    await act(async () => host.querySelector<HTMLButtonElement>('.history-restore')!.click());
    await settle(100);
    expect(host.querySelector('.history-confirm')?.textContent).not.toContain('could be left out');
    expect(host.querySelector('.history-confirm')?.textContent).toContain('1 photo or file in this version was deleted from Google Drive');
    // Bea escribe mientras tanto (desde su dispositivo).
    await edit(b, pageId, (g) => g.insert(0, [block('z', 'Bea, recién')]));
    await b.engine.syncNow();
    const confirm = () => [...host.querySelectorAll<HTMLButtonElement>('.history-confirm button')].find((x) => x.textContent === 'Restore')!;
    await act(async () => confirm().click());
    await settle(300);
    expect(asked.length).toBe(0);
    expect(host.querySelector('.history-confirm')?.textContent).toContain('bea@example.com changed this page in the last 2 minutes');
    // La segunda confirmación conserva la cuenta de fotos de la primera.
    expect(host.querySelector('.history-confirm')?.textContent).toContain('1 photo or file in this version was deleted from Google Drive');
    // La versión actual ya trae lo de Bea (la última sesión, con su correo).
    expect(host.querySelectorAll('.history-session')[0].textContent).toContain('bea@example.com');
    // Ahora sí: confirmar de nuevo restaura.
    await act(async () => confirm().click());
    await settle(300);
    expect(asked.length).toBe(1);
  });

  it('al confirmar no sirve la consulta de filas que ya estaba en curso (empezó antes de sincronizar): se espera y se pide otra (O9)', async () => {
    prefs.set({ language: 'en' });
    const { a, b, pageId, server } = await setup();
    const asked: Y.Doc[] = [];
    offs.push(
      registerRestoreTarget(pageId, (version) => {
        asked.push(version);
        return { ok: true, undo: () => true, onEdit: () => () => undefined };
      }),
    );
    // La próxima consulta de filas lee el servidor al empezar y contesta recién cuando se la suelta.
    const remote = a.remote as unknown as { pageHistory: (p: string, after: number, limit: number) => Promise<HistoryRow[]> };
    const original = remote.pageHistory.bind(remote);
    let hold: Promise<void> | null = null;
    let release = () => undefined as void;
    let held = 0;
    remote.pageHistory = async (p, after, limit) => {
      const rows = await original(p, after, limit);
      if (hold) {
        const wait = hold;
        hold = null;
        held++;
        await wait;
      }
      return rows;
    };
    const host = await mount(services(a, server.ownerId), pageId);
    await act(async () => (host.querySelectorAll('.history-session')[1] as HTMLButtonElement).click());
    await settle(300);
    await act(async () => host.querySelector<HTMLButtonElement>('.history-restore')!.click());
    await settle(100);
    expect(host.querySelector('.history-confirm')?.textContent).not.toContain('could be left out');
    // Una sincronización deja una consulta de la lista en curso (todavía sin lo de Bea)…
    hold = new Promise<void>((r) => (release = r));
    await act(async () => void (await a.engine.syncNow()));
    await settle(100);
    expect(held).toBe(1);
    // …y Bea escribe mientras tanto.
    await edit(b, pageId, (g) => g.insert(0, [block('z', 'Bea, recién')]));
    await b.engine.syncNow();
    const confirm = () => [...host.querySelectorAll<HTMLButtonElement>('.history-confirm button')].find((x) => x.textContent === 'Restore')!;
    await act(async () => confirm().click());
    await settle(200);
    // La restauración está esperando la consulta vieja: se suelta.
    release();
    await settle(300);
    expect(asked.length).toBe(0);
    expect(host.querySelector('.history-confirm')?.textContent).toContain('bea@example.com changed this page in the last 2 minutes');
  });

  it('una restauración que el editor intenta y deshace (no quedó igual a la versión) dice que no cambió nada', async () => {
    prefs.set({ language: 'en' });
    const { a, pageId, server } = await setup();
    offs.push(registerRestoreTarget(pageId, () => ({ ok: false, reason: 'failed' })));
    const host = await mount(services(a, server.ownerId), pageId);
    await act(async () => (host.querySelectorAll('.history-session')[1] as HTMLButtonElement).click());
    await settle(300);
    await act(async () => host.querySelector<HTMLButtonElement>('.history-restore')!.click());
    await settle(100);
    const confirm = [...host.querySelectorAll<HTMLButtonElement>('.history-confirm button')].find((x) => x.textContent === 'Restore')!;
    await act(async () => confirm.click());
    await settle(200);
    expect(host.querySelector('.history-message')?.textContent).toBe("Couldn't restore this version. Nothing changed.");
  });
});

describe('sumar las filas nuevas a la lista (M5)', () => {
  const row = (seq: number, by = 'a'): HistoryRow => ({ id: seq * 10, seq, createdBy: by, createdAt: new Date(seq * 60_000).toISOString(), data: new Uint8Array() });
  it('descarta las que ya estaban (la última vuelve en la consulta) y las repetidas, y las deja en orden', () => {
    const known = [row(1), row(2), row(3)];
    const got = mergeRows(known, [row(5), row(3, 'otra'), row(4), row(5), row(2)]);
    expect(got.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5]);
    // La que ya estaba queda la conocida (no la que volvió).
    expect(got[2]).toBe(known[2]);
    expect(mergeRows([], [row(2), row(1), row(2)]).map((r) => r.seq)).toEqual([1, 2]);
    expect(mergeRows(known, [])).toEqual(known);
  });
});

describe('quién cambió la página hace poco', () => {
  const row = (seq: number, by: string, at: string): HistoryRow => ({ id: seq, seq, createdBy: by, createdAt: at, data: new Uint8Array() });
  it('otra persona en los últimos 2 minutos; uno mismo o algo más viejo, no', () => {
    const now = Date.parse('2026-10-01T10:02:00Z');
    expect(recentOther([row(1, 'ana', '2026-10-01T10:00:30Z'), row(2, 'yo', '2026-10-01T10:01:00Z')], 'yo', now)).toBe('ana');
    expect(recentOther([row(1, 'ana', '2026-10-01T09:59:00Z'), row(2, 'yo', '2026-10-01T10:01:00Z')], 'yo', now)).toBeUndefined();
    expect(recentOther([row(1, 'yo', '2026-10-01T10:01:00Z')], 'yo', now)).toBeUndefined();
    expect(recentOther([], 'yo', now)).toBeUndefined();
  });
});

describe('entrega 2: Show changes, el texto huérfano y la lista que se actualiza sola', () => {
  it('Show changes está prendido: lo agregado se marca con el color y el correo de quien lo escribió; apagado, la versión limpia', async () => {
    prefs.set({ language: 'en' });
    const { a, pageId, server } = await setup();
    const host = await mount(services(a, server.ownerId), pageId);
    const toggle = host.querySelector<HTMLInputElement>('.history-changes input')!;
    expect(toggle.checked).toBe(true);
    // La versión actual (la de Bea) contra la anterior: el bloque de Bea, agregado entero.
    const added = [...host.querySelectorAll<HTMLElement>('.history-page .hist-add')];
    expect(added.map((x) => x.textContent).join('')).toContain('Lo de Bea');
    expect(added[0].getAttribute('data-tip')).toContain('Added by bea@example.com');
    // Bea es la segunda persona de la página: su color es el segundo de la paleta.
    expect(added[0].getAttribute('style')).toContain('--hc: var(--hist-2)');
    expect(host.querySelector('.history-page .hist-node-add.hist-block')).not.toBeNull();
    // Lo que no cambió no se marca.
    expect(added.map((x) => x.textContent).join('')).not.toContain('Primera versión');
    await act(async () => toggle.click());
    await settle(300);
    expect(host.querySelector('.history-page .hist-add')).toBeNull();
    expect(host.querySelector('.history-page')?.textContent).toContain('Lo de Bea');
    // Queda como lo dejó la persona (se vuelve a prender para las demás pruebas).
    await act(async () => host.querySelector<HTMLInputElement>('.history-changes input')!.click());
    await settle(300);
    expect(host.querySelector('.history-page .hist-add')).not.toBeNull();
  });

  it('con el historial abierto llegan cambios nuevos: la lista se actualiza sola y la versión elegida sigue elegida', async () => {
    prefs.set({ language: 'en' });
    const { a, b, pageId, server } = await setup();
    const host = await mount(services(a, server.ownerId), pageId);
    await act(async () => (host.querySelectorAll('.history-session')[1] as HTMLButtonElement).click());
    await settle(300);
    const editorBefore = host.querySelector('.history-page .ProseMirror');
    expect(host.querySelector('.history-page')?.textContent).toContain('Primera versión');
    // Dos horas después Bea escribe de nuevo (una sesión nueva) y el dispositivo sincroniza.
    server.now = () => Date.parse('2026-09-30T18:00:00Z');
    await edit(b, pageId, (g) => g.insert(0, [block('n', 'Bea, más tarde')]));
    await b.engine.syncNow();
    await act(async () => void (await a.engine.syncNow()));
    await settle(400);
    const items = [...host.querySelectorAll('.history-session')];
    expect(items.length).toBe(3);
    expect(items[0].textContent).toContain('Current version');
    // La elegida sigue siendo la misma (la primera, de la dueña), con el mismo editor (no se volvió a armar).
    expect(host.querySelector('.history-session[aria-current="true"]')?.textContent).toContain('You');
    expect(host.querySelector('.history-session[aria-current="true"]')?.textContent).not.toContain('Current version');
    expect(host.querySelector('.history-page .ProseMirror')).toBe(editorBefore);
    expect(host.querySelector('.history-page')?.textContent).not.toContain('Bea, más tarde');
  });

  it('si en un mismo lote crece la versión elegida y aparece otra más nueva, la elegida sigue elegida (no salta a la actual; M10)', async () => {
    prefs.set({ language: 'en' });
    const { a, b, pageId, server } = await setup();
    const host = await mount(services(a, server.ownerId), pageId);
    // Se elige la de Bea, que hoy es la actual.
    await act(async () => (host.querySelectorAll('.history-session')[0] as HTMLButtonElement).click());
    await settle(300);
    expect(host.querySelector('.history-session[aria-current="true"]')?.textContent).toContain('Current version');
    // Sin que el dispositivo sincronice en el medio: Bea sigue escribiendo diez minutos después (su sesión crece) y
    // vuelve dos horas más tarde (una sesión nueva). Las dos filas llegan en el mismo lote.
    server.now = () => Date.parse('2026-09-30T16:10:00Z');
    await edit(b, pageId, (g) => g.insert(0, [block('m', 'Bea, un rato después')]));
    await b.engine.syncNow();
    server.now = () => Date.parse('2026-09-30T18:10:00Z');
    await edit(b, pageId, (g) => g.insert(0, [block('n', 'Bea, más tarde')]));
    await b.engine.syncNow();
    await act(async () => void (await a.engine.syncNow()));
    await settle(400);
    const items = [...host.querySelectorAll('.history-session')];
    expect(items.length).toBe(3);
    const chosen = host.querySelector('.history-session[aria-current="true"]');
    expect(chosen).toBe(items[1]);
    expect(chosen?.textContent).toContain('bea@example.com');
    expect(chosen?.textContent).not.toContain('Current version');
    // La versión elegida, con lo que creció, sin lo de la nueva.
    expect(host.querySelector('.history-page')?.textContent).toContain('Bea, un rato después');
    expect(host.querySelector('.history-page')?.textContent).not.toContain('Bea, más tarde');
  });

  it('el texto huérfano: lo que Bea escribió en un bloque que la dueña ya había borrado se ve aparte, en la versión de Bea', async () => {
    prefs.set({ language: 'en' });
    const { a, b, pageId, server } = await setup();
    server.now = () => Date.parse('2026-09-30T18:00:00Z');
    await b.engine.syncNow();
    // Bea escribe sin subir; la dueña borra el bloque y sube; Bea baja el borrado antes de subir.
    await edit(b, pageId, (g) => {
      const t = ((g.get(0) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlText;
      t.insert(t.length, ' TEXTO-HUÉRFANO');
    });
    await edit(a, pageId, (g) => g.delete(0, 1));
    await a.engine.syncNow();
    server.now = () => Date.parse('2026-09-30T18:01:00Z');
    await b.docs.pullPage(pageId, b.remote);
    await b.engine.syncNow();
    await a.engine.syncNow();
    const host = await mount(services(a, server.ownerId), pageId);
    const orphan = host.querySelector('.history-orphan');
    expect(orphan?.textContent).toContain('bea@example.com wrote in a part that had already been removed');
    expect(orphan?.textContent).toContain('TEXTO-HUÉRFANO');
    // No está en la página ni en la versión: solo en la franja.
    expect(host.querySelector('.history-page')?.textContent).not.toContain('TEXTO-HUÉRFANO');
    // En las versiones anteriores, no aparece.
    await act(async () => (host.querySelectorAll('.history-session')[1] as HTMLButtonElement).click());
    await settle(300);
    expect(host.querySelector('.history-orphan')).toBeNull();
  });
});

/** Tres sesiones: la dueña escribe dos bloques; Bea borra «dos » y el segundo bloque; la dueña agrega uno. */
async function three() {
  const server = new FakeServer();
  let clock = Date.parse('2026-09-30T10:00:00Z');
  server.now = () => clock;
  server.settings = { ...(server.settings ?? { generation: 1, minAppVersion: null, mediaUrl: null, schemaVersion: 1 }), schemaVersion: HISTORY_SCHEMA_VERSION };
  const a = await makeDevice(server, undefined, '0.021', {}, HISTORY_SCHEMA_VERSION);
  devices.push(a);
  const pageId = await a.tree.create(null, 'P');
  await a.engine.syncNow();
  await edit(a, pageId, (g) => g.insert(0, [block('x', 'Uno dos tres'), block('y', 'Se va entero')]));
  await a.engine.syncNow();
  clock += 60 * 60_000;
  server.addMember('bea', 'member', 'bea@example.com');
  const b = await makeDevice(server, undefined, '0.021', {}, HISTORY_SCHEMA_VERSION, { id: 'bea', email: 'bea@example.com' });
  devices.push(b);
  await b.engine.syncNow();
  await edit(b, pageId, (g) => {
    (((g.get(0) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlText).delete(4, 4); // "dos "
    g.delete(1, 1);
  });
  await b.engine.syncNow();
  clock += 60 * 60_000;
  await a.engine.syncNow();
  await edit(a, pageId, (g) => g.insert(1, [block('z', 'Lo último')]));
  await a.engine.syncNow();
  return { server, a, b, pageId };
}

/** Un Worker de mentira con el mismo código que history.worker.ts (para ver que se crean y se cierran). */
class CountingWorker {
  static made: CountingWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  terminated = false;
  private core = new HistoryCore();
  constructor() {
    CountingWorker.made.push(this);
    setTimeout(() => this.onmessage?.({ data: { ready: true } }), 0);
  }
  postMessage(message: unknown) {
    const { id, req } = structuredClone(message) as { id: number; req: HistoryRequest };
    setTimeout(() => {
      if (this.terminated) return;
      try {
        this.onmessage?.({ data: structuredClone({ id, ok: true, reply: this.core.handle(req) }) });
      } catch (err) {
        this.onmessage?.({ data: { id, ok: false, error: (err as Error).message } });
      }
    }, 1);
  }
  terminate() {
    this.terminated = true;
  }
}

/** Retiene payloads reales del Worker para el recorrido sesión → aparte → resolución tardía. */
class HoldingAnnotationWorker extends CountingWorker {
  static holding = true;
  static held: { resolve(): void; reject(): void }[] = [];
  override postMessage(message: unknown) {
    const { id, req } = message as { id: number; req: HistoryRequest };
    if (req.op === 'version' && HoldingAnnotationWorker.holding) {
      HoldingAnnotationWorker.held.push({
        resolve: () => super.postMessage(message),
        reject: () => this.onmessage?.({ data: { id, ok: false, error: 'fallo dirigido del par' } }),
      });
    } else super.postMessage(message);
  }
}

describe('comparación de dibujos históricos', () => {
  it('el esquema anterior conserva referencias y mapas al abrir después de la comparación', async () => {
    const { a, pageId } = await setup({ photo: true });
    const current = await a.docs.open(pageId);
    writeFrame(current, TRASHED_FILE, 1920, 1080);
    addShape(current, TRASHED_FILE, 'arrow', { type: 'arrow', startX: 0, startY: 0, endX: 400, endY: 200 });
    const old = new Y.Doc(), empty = new Y.Doc(); Y.applyUpdate(old, Y.encodeStateAsUpdate(current));
    const before = old.getMap(PHOTO_MARKUP_MAP).toJSON();
    expect(compareAnnotations(empty, old).cards).toHaveLength(1);
    const { audio: _a, video: _v, file: _f, ...oldSpecs } = defaultBlockSpecs;
    const oldSchema = BlockNoteSchema.create({ blockSpecs: oldSpecs });
    const editor = BlockNoteEditor.create(withCollaboration({ schema: oldSchema, collaboration: { fragment: old.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'Legacy', color: '#000' } } }));
    const host = document.createElement('div'); document.body.append(host);
    try {
      await act(async () => editor.mount(host)); await settle(50);
      expect(JSON.stringify(editor.document)).toContain(`sdmedia://${TRASHED_FILE}`);
      expect(old.getMap(PHOTO_MARKUP_MAP).toJSON()).toEqual(before);
      expect(current.getMap(PHOTO_MARKUP_MAP).toJSON()).toEqual(before);
    } finally { await act(async () => editor.unmount()); old.destroy(); empty.destroy(); a.docs.close(pageId); }
  });
  it('una fila ilegible mantiene el aviso parcial y no anuncia cuentas de formas', async () => {
    prefs.set({ language: 'en' });
    const { a, pageId, server } = await setup({ photo: true });
    server.now = () => Date.parse('2026-09-30T18:00:00Z');
    const document = await a.docs.open(pageId);
    writeFrame(document, TRASHED_FILE, 1920, 1080);
    addShape(document, TRASHED_FILE, 'arrow', { type: 'arrow', startX: 0, startY: 0, endX: 400, endY: 200 });
    await a.docs.flush(pageId); await a.engine.syncNow(); a.docs.close(pageId);
    const value = services(a, server.ownerId), read = value.remote.pageHistory.bind(value.remote);
    value.remote.pageHistory = async (...args) => {
      const rows = await read(...args), last = rows.at(-1);
      return args[1] === 0 && last ? [...rows, { ...last, id: last.id + 1, seq: last.seq + 1, data: new Uint8Array([255]) }] : rows;
    };
    const host = await mount(value, pageId);
    expect(host.querySelector('.history-annotations')?.textContent).toContain('Partial annotation comparison');
    expect(host.querySelector('.history-annotations')?.textContent).not.toContain('Added:');
    expect(host.textContent).toContain(t('history.unreadable', { count: 1 }));
  });
  it.each(['success', 'rejection'])('aparte invalida payloads tardíos (%s); volver a la misma sesión carga un par nuevo', async (ending) => {
    prefs.set({ language: 'en' });
    const { a, pageId, server } = await setup({ photo: true });
    server.settings!.schemaVersion = 20;
    server.now = () => Date.parse('2026-09-30T18:00:00Z');
    const document = await a.docs.open(pageId);
    writeFrame(document, TRASHED_FILE, 1920, 1080);
    addShape(document, TRASHED_FILE, 'arrow', { type: 'arrow', startX: 0, startY: 0, endX: 400, endY: 200, strokeColor: '#123456' });
    await a.docs.flush(pageId); await a.engine.syncNow();
    const before = Y.encodeStateAsUpdate(document);
    const value = services(a, server.ownerId);
    value.remote.linkAside = async () => [{ id: 'aside-1', page_id: pageId, link_id: 'link-1', link_page_id: pageId, author: 'Visitor', created_at: '2026-09-30T18:30:00Z', decided_at: null, bytes: 2, reason: 'link_revoked' }];
    value.remote.linkUpdateBytes = async () => new Uint8Array([0, 0]);
    const g = globalThis as { Worker?: unknown }, saved = g.Worker;
    HoldingAnnotationWorker.holding = true; HoldingAnnotationWorker.held = []; g.Worker = HoldingAnnotationWorker;
    try {
      const host = await mount(value, pageId);
      expect(HoldingAnnotationWorker.held.length).toBeGreaterThan(1);
      const aside = host.querySelector<HTMLButtonElement>('.history-aside-row .history-session');
      expect(aside).not.toBeNull();
      await act(async () => aside!.click());
      const released = HoldingAnnotationWorker.held.splice(0);
      await act(async () => released.forEach((reply) => ending === 'success' ? reply.resolve() : reply.reject()));
      await settle(200);
      expect(host.querySelector('.history-aside')).not.toBeNull();
      expect(host.querySelector('.history-annotations')).toBeNull();
      expect(host.textContent).not.toContain('Annotation comparison unavailable');
      HoldingAnnotationWorker.holding = false;
      const session = [...host.querySelectorAll<HTMLButtonElement>('.history-session')].find((button) => !button.closest('.history-aside-row'))!;
      await act(async () => session.click()); await settle(250);
      expect(host.querySelector('.history-aside')).toBeNull();
      expect(host.querySelector('.history-annotations')).not.toBeNull();
      expect(host.querySelector('.history-annotation-pair')?.textContent).toContain('Before');
      expect(host.querySelector('.history-annotation-pair')?.textContent).toContain('Selected version');
      expect(host.querySelector('.history-annotation-drawing [stroke="#123456"]')).not.toBeNull();
      expect(host.querySelector('.history-page .history-annotations')).toBeNull();
      expect(Y.encodeStateAsUpdate(document)).toEqual(before);
      expect(document.getMap(PHOTO_MARKUP_MAP).size).toBe(2);
      const toggle = host.querySelector<HTMLInputElement>('.history-changes input')!;
      await act(async () => toggle.click()); await settle(150);
      expect(host.querySelector('.history-annotations')).toBeNull();
      await act(async () => toggle.click()); await settle(150);
      expect(host.querySelector('.history-annotations')).not.toBeNull();
    } finally { g.Worker = saved; a.docs.close(pageId); }
  });
});

/** Un evento de copiar con un portapapeles en memoria (jsdom no tiene `ClipboardEvent`). */
function copyEvent(data: Map<string, string>): Event {
  const event = new Event('copy', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { setData: (k: string, v: string) => data.set(k, v), clearData: () => data.clear(), getData: (k: string) => data.get(k) ?? '' },
  });
  return event;
}

describe('correcciones de la auditoría de la entrega 2', () => {
  it('con StrictMode (como npm run dev) el historial carga, con un Worker por montaje, y al cerrar no queda ninguno abierto', async () => {
    prefs.set({ language: 'en' });
    const { a, pageId, server } = await setup();
    const g = globalThis as { Worker?: unknown };
    const saved = g.Worker;
    g.Worker = CountingWorker;
    CountingWorker.made = [];
    try {
      const host = document.createElement('div');
      document.body.append(host);
      const root = createRoot(host);
      await act(async () =>
        root.render(
          <StrictMode>
            <ServicesContext.Provider value={services(a, server.ownerId)}>
              <HistoryPanel pageId={pageId} />
            </ServicesContext.Provider>
          </StrictMode>,
        ),
      );
      for (let i = 0; i < 20 && !host.querySelector('.history-session'); i++) await settle(60);
      expect(host.textContent).not.toContain('could not be loaded');
      expect(host.querySelectorAll('.history-session').length).toBe(2);
      expect(CountingWorker.made.length).toBeGreaterThan(0);
      act(() => root.unmount());
      expect(CountingWorker.made.every((w) => w.terminated)).toBe(true);
    } finally {
      g.Worker = saved;
    }
  });

  it('restaurar con Show changes prendido manda la versión limpia (sin lo borrado de la unión) y nada escribe en la página', async () => {
    prefs.set({ language: 'en' });
    const { a, pageId, server } = await three();
    const pageDoc = await a.docs.open(pageId);
    let pageUpdates = 0;
    pageDoc.on('update', () => pageUpdates++);
    const rowsBefore = server.updates.get(pageId)!.length;
    const asked: Y.Doc[] = [];
    offs.push(
      registerRestoreTarget(pageId, (version) => {
        asked.push(version);
        return { ok: true, undo: () => true, onEdit: () => () => undefined };
      }),
    );
    const host = await mount(services(a, server.ownerId), pageId);
    await act(async () => (host.querySelectorAll('.history-session')[1] as HTMLButtonElement).click());
    await settle(400);
    expect(host.querySelector<HTMLInputElement>('.history-changes input')!.checked).toBe(true);
    // La unión muestra lo borrado...
    expect(host.querySelector('.history-page')?.textContent).toContain('Se va entero');
    await act(async () => host.querySelector<HTMLButtonElement>('.history-restore')!.click());
    await settle(150);
    const confirm = [...host.querySelectorAll<HTMLButtonElement>('.history-confirm button')].find((b) => b.textContent === 'Restore')!;
    await act(async () => confirm.click());
    await settle(300);
    // ...pero a restaurar va la versión limpia.
    expect(asked.length).toBe(1);
    const v = asked[0].getXmlFragment(CONTENT_FRAGMENT).toString();
    expect(v).not.toContain('Se va');
    expect(v).not.toContain('dos');
    expect(yShape(asked[0]).ids).toEqual(['x']);
    expect(pageUpdates, 'el documento de la página no recibió nada').toBe(0);
    expect(server.updates.get(pageId)!.length).toBe(rowsBefore);
    expect(await a.docs.unsyncedPages()).toEqual([]);
  });

  it('copiar con Show changes prendido deja en el portapapeles la versión, sin lo borrado', async () => {
    prefs.set({ language: 'en' });
    const { a, pageId, server } = await three();
    const host = await mount(services(a, server.ownerId), pageId);
    await act(async () => (host.querySelectorAll('.history-session')[1] as HTMLButtonElement).click());
    await settle(400);
    const pm = host.querySelector<HTMLElement>('.history-page .ProseMirror')!;
    expect(pm.textContent).toContain('Se va entero');
    // Se elige todo lo de la versión (con la selección del navegador sobre el editor).
    const range = document.createRange();
    range.selectNodeContents(pm);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    const data = new Map<string, string>();
    const event = copyEvent(data);
    await act(async () => void pm.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    for (const kind of ['blocknote/html', 'text/html', 'text/plain']) {
      expect(data.get(kind), kind).toContain('Uno tres');
      expect(data.get(kind), kind).not.toContain('Se va');
      expect(data.get(kind), kind).not.toContain('dos');
    }
  });

  it('cuando llega una versión nueva arriba, la lista corrida no salta (se compensa lo que creció)', async () => {
    prefs.set({ language: 'en' });
    const { a, b, pageId, server } = await setup();
    const host = await mount(services(a, server.ownerId), pageId);
    const list = host.querySelector<HTMLElement>('.history-list')!;
    // jsdom no mide: cada renglón, 50 px.
    Object.defineProperty(list, 'scrollHeight', { get: () => 50 * list.querySelectorAll('.history-session').length, configurable: true });
    // Una fila que crece la sesión actual (anota el alto) y la persona baja la lista.
    server.now = () => Date.parse('2026-09-30T16:01:00Z');
    await edit(b, pageId, (g) => g.insert(0, [block('m', 'Bea, un minuto después')]));
    await b.engine.syncNow();
    await act(async () => void (await a.engine.syncNow()));
    await settle(300);
    list.scrollTop = 30;
    // Dos horas después, una sesión nueva arriba: 50 px más de lista.
    server.now = () => Date.parse('2026-09-30T18:00:00Z');
    await edit(b, pageId, (g) => g.insert(0, [block('n', 'Bea, más tarde')]));
    await b.engine.syncNow();
    await act(async () => void (await a.engine.syncNow()));
    await settle(300);
    expect(host.querySelectorAll('.history-session').length).toBe(3);
    expect(list.scrollTop).toBe(80);
  });
});

describe('en el teléfono, tocar una marca', () => {
  it('muestra quién y cuándo en un aviso (no hay tooltip con el dedo); con el mouse, no', async () => {
    prefs.set({ language: 'en' });
    const { a, pageId, server } = await setup();
    const notices: string[] = [];
    const onNotice = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      notices.push(typeof detail === 'string' ? detail : String(detail?.message ?? ''));
    };
    window.addEventListener('shotdocs:notice', onNotice);
    offs.push(() => window.removeEventListener('shotdocs:notice', onNotice));
    const host = await mount(services(a, server.ownerId), pageId);
    const mark = host.querySelector<HTMLElement>('.history-page .hist-add')!;
    const tap = (pointerType: string) => {
      const down = new Event('pointerdown', { bubbles: true });
      Object.defineProperty(down, 'pointerType', { value: pointerType });
      mark.dispatchEvent(down);
      mark.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    };
    await act(async () => tap('mouse'));
    expect(notices).toEqual([]);
    await act(async () => tap('touch'));
    expect(notices.length).toBe(1);
    expect(notices[0]).toContain('Added by bea@example.com');
  });
});

/** Un Worker que retiene los pedidos de la unión hasta que se sueltan (para ver la pantalla mientras se arma). */
class HoldingWorker extends CountingWorker {
  static held: (() => void)[] = [];
  postMessage(message: unknown) {
    if ((message as { req: HistoryRequest }).req.op === 'changes') HoldingWorker.held.push(() => super.postMessage(message));
    else super.postMessage(message);
  }
}

describe('mientras se arma la unión', () => {
  it('se ve el aviso de carga (no la vista en blanco ni la versión limpia que después salta)', async () => {
    prefs.set({ language: 'en' });
    const { a, pageId, server } = await setup();
    const g = globalThis as { Worker?: unknown };
    const saved = g.Worker;
    g.Worker = HoldingWorker;
    HoldingWorker.held = [];
    try {
      const host = await mount(services(a, server.ownerId), pageId);
      // La versión llegó; la unión, todavía no.
      expect(HoldingWorker.held.length).toBeGreaterThan(0);
      expect(host.querySelector('.history-version-loading')?.textContent).toBe('Loading the version…');
      expect(host.querySelector('.history-page')).toBeNull();
      await act(async () => {
        for (const release of HoldingWorker.held.splice(0)) release();
      });
      await settle(300);
      expect(host.querySelector('.history-version-loading')).toBeNull();
      expect(host.querySelector('.history-page .hist-add')).not.toBeNull();
    } finally {
      g.Worker = saved;
    }
  });
});

// --- Entrega 3: versiones con nombre, Restored from… y el historial sin red con la caché -------------------------------

/** Como `setup`, con la base en la versión de las versiones con nombre y una tercera sesión (la dueña, otra hora más). */
async function setupNamed({ schema = NAMED_VERSIONS_SCHEMA_VERSION } = {}) {
  const got = await setup();
  const { server, a, b, pageId } = got;
  server.settings = { ...server.settings!, schemaVersion: schema };
  const clock = Date.parse('2026-09-30T17:30:00Z');
  server.now = () => clock;
  await edit(a, pageId, (g) => g.insert(0, [block('w', 'Tercera')]));
  await a.engine.syncNow();
  await b.engine.syncNow();
  return got;
}

/** Escribe en un campo controlado por React. */
function typeInto(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const press = (el: Element, key: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

async function menuItem(host: HTMLElement, row: Element, label: string): Promise<void> {
  await act(async () => (row.querySelector('.history-more') as HTMLButtonElement).click());
  const item = [...host.querySelectorAll<HTMLButtonElement>('.history-menu button')].find((x) => x.textContent === label);
  expect(item, label).toBeDefined();
  await act(async () => item!.click());
}

/** El `seq` de la última fila de la primera sesión (la de la dueña, antes de las 16). */
function firstSessionEnd(server: FakeServer, pageId: string): number {
  return (server.updates.get(pageId) ?? []).filter((u) => Date.parse(u.createdAt!) < Date.parse('2026-09-30T16:00:00Z')).at(-1)!.seq;
}

describe('entrega 3: versiones con nombre', () => {
  it('nombrar desde el ⋯ de una versión: queda en la lista, arriba y en la base; Only named versions; renombrar y quitar', async () => {
    prefs.set({ language: 'en' });
    const { a, pageId, server } = await setupNamed();
    const host = await mount(services(a, server.ownerId), pageId);
    const rows = () => [...host.querySelectorAll('.history-session-row')];
    expect(rows().length).toBe(3);
    // La más vieja (la primera de la dueña).
    await menuItem(host, rows()[2], 'Name this version');
    const input = host.querySelector<HTMLInputElement>('.history-name-input')!;
    await act(async () => typeInto(input, '  Antes de   Bea '));
    await act(async () => press(input, 'Enter'));
    await settle(200);
    expect(server.versions.map((v) => `${v.kind}:${v.label}:${v.seq}`)).toEqual([`named:Antes de Bea:${firstSessionEnd(server, pageId)}`]);
    expect(rows()[2].querySelector('.history-name')?.textContent).toBe('Antes de Bea');
    // Elegida, arriba se ve su nombre.
    await act(async () => (rows()[2].querySelector('.history-session') as HTMLButtonElement).click());
    await settle(300);
    expect(host.querySelector('.history-version-name')?.textContent).toBe('Antes de Bea');
    expect(host.querySelector('.history-page')?.textContent).toContain('Primera versión');
    // Solo las que tienen nombre (y la actual).
    await act(async () => host.querySelector<HTMLInputElement>('.history-filter input')!.click());
    expect(rows().length).toBe(2);
    expect(rows()[0].textContent).toContain('Current version');
    expect(rows()[1].textContent).toContain('Antes de Bea');
    await act(async () => host.querySelector<HTMLInputElement>('.history-filter input')!.click());
    expect(rows().length).toBe(3);
    // Renombrar: el campo trae el nombre; Escape deja como estaba (y no cierra el historial).
    await menuItem(host, rows()[2], 'Rename');
    let field = host.querySelector<HTMLInputElement>('.history-name-input')!;
    expect(field.value).toBe('Antes de Bea');
    await act(async () => typeInto(field, 'Otro'));
    await act(async () => press(field, 'Escape'));
    await settle(100);
    expect(host.querySelector('.history-name-input')).toBeNull();
    expect(host.querySelector('.history-screen')).not.toBeNull();
    expect(server.versions[0].label).toBe('Antes de Bea');
    await menuItem(host, rows()[2], 'Rename');
    field = host.querySelector<HTMLInputElement>('.history-name-input')!;
    await act(async () => typeInto(field, 'Para el cliente'));
    await act(async () => press(field, 'Enter'));
    await settle(200);
    expect(server.versions[0].label).toBe('Para el cliente');
    expect(rows()[2].querySelector('.history-name')?.textContent).toBe('Para el cliente');
    // Quitar el nombre: la fila queda en la base, marcada.
    await menuItem(host, rows()[2], 'Remove name');
    await settle(200);
    expect(server.versions[0].removedAt).not.toBeNull();
    expect(rows()[2].querySelector('.history-name')).toBeNull();
  });

  it('lo escrito después de una versión con nombre va a una nueva (la sesión se corta en el nombre)', async () => {
    prefs.set({ language: 'en' });
    const { a, pageId, server } = await setupNamed();
    const host = await mount(services(a, server.ownerId), pageId);
    const rows = () => [...host.querySelectorAll('.history-session-row')];
    // Nombrar la actual.
    await menuItem(host, rows()[0], 'Name this version');
    const input = host.querySelector<HTMLInputElement>('.history-name-input')!;
    await act(async () => typeInto(input, 'Entregada'));
    await act(async () => press(input, 'Enter'));
    await settle(200);
    // Un minuto después (misma sesión de 30 minutos) la dueña sigue escribiendo: la lista se actualiza sola.
    server.now = () => Date.parse('2026-09-30T17:31:00Z');
    await edit(a, pageId, (g) => g.insert(0, [block('v', 'Después del nombre')]));
    await act(async () => a.engine.syncNow());
    for (let i = 0; i < 20 && rows().length < 4; i++) await settle(100);
    expect(rows().length).toBe(4);
    expect(rows()[0].textContent).toContain('Current version');
    expect(rows()[0].querySelector('.history-name')).toBeNull();
    expect(rows()[1].querySelector('.history-name')?.textContent).toBe('Entregada');
    await act(async () => (rows()[1].querySelector('.history-session') as HTMLButtonElement).click());
    await settle(400);
    expect(host.querySelector('.history-page')?.textContent).toContain('Tercera');
    expect(host.querySelector('.history-page')?.textContent).not.toContain('Después del nombre');
  });

  it('un nombre ajeno sin nivel 4 no ofrece acciones; con la base sin la migración (o sin la función) no hay nombres ni filtro', async () => {
    prefs.set({ language: 'en' });
    // Carla (Editar) ve el nombre que puso Bea, sin acciones; en las demás versiones, nombrar.
    const { server, pageId } = await setupNamed();
    server.enableTeam();
    // Prender el equipo deja la base en la versión 4: se vuelve a la de los nombres.
    server.settings = { ...server.settings!, schemaVersion: NAMED_VERSIONS_SCHEMA_VERSION };
    server.addMember('carla', 'member', 'carla@example.com');
    server.grant('carla', { projectId: server.workspaceId }, 'edit');
    server.grant('bea', { projectId: server.workspaceId }, 'edit');
    await new FakeRemote(server, '9.999', 'bea').namePageVersion('n', pageId, firstSessionEnd(server, pageId), 'De Bea');
    const c = await makeDevice(server, undefined, '9.999', {}, HISTORY_SCHEMA_VERSION, { id: 'carla', email: 'carla@example.com' });
    devices.push(c);
    await c.engine.syncNow();
    const hc = await mount(services(c, 'carla'), pageId);
    const crow = [...hc.querySelectorAll('.history-session-row')];
    const withName = crow.find((r) => r.querySelector('.history-name'))!;
    expect(withName.querySelector('.history-name')?.textContent).toBe('De Bea');
    expect(withName.querySelector('.history-more')).toBeNull();
    expect(crow.filter((r) => r.querySelector('.history-more')).length).toBe(crow.length - 1);
    act(() => roots.pop()!.unmount());
    // La base en la versión del historial (11 o 12): ni nombres ni filtro, y el historial anda.
    const old = await setupNamed({ schema: HISTORY_SCHEMA_VERSION });
    const h2 = await mount(services(old.a, old.server.ownerId), old.pageId);
    expect(h2.querySelectorAll('.history-session').length).toBe(3);
    expect(h2.querySelector('.history-more')).toBeNull();
    expect(h2.querySelector('.history-filter')).toBeNull();
    act(() => roots.pop()!.unmount());
    // La versión dice que sí pero la función no está (PGRST202): igual, sin errores a la vista.
    const missing = await setupNamed();
    missing.server.versionsMissing = true;
    const h3 = await mount(services(missing.a, missing.server.ownerId), missing.pageId);
    expect(h3.querySelectorAll('.history-session').length).toBe(3);
    expect(h3.querySelector('.history-more')).toBeNull();
    expect(h3.querySelector('.history-message')).toBeNull();
  });

  it('nombrar sin respuesta del servidor lo dice y no cambia nada; si otro dispositivo la nombró antes, la lista se pone al día', async () => {
    prefs.set({ language: 'en' });
    const { a, pageId, server } = await setupNamed();
    const host = await mount(services(a, server.ownerId), pageId);
    const rows = () => [...host.querySelectorAll('.history-session-row')];
    await menuItem(host, rows()[2], 'Name this version');
    const input = () => host.querySelector<HTMLInputElement>('.history-name-input')!;
    await act(async () => typeInto(input(), 'Sin red'));
    server.online = false;
    await act(async () => press(input(), 'Enter'));
    await settle(200);
    expect(host.querySelector('.history-message')?.textContent).toBe('Naming versions needs a connection.');
    expect(server.versions).toEqual([]);
    server.online = true;
    // Otro dispositivo le pone nombre a la misma versión mientras tanto.
    await new FakeRemote(server, '9.999').namePageVersion('del-otro', pageId, firstSessionEnd(server, pageId), 'Del otro');
    await act(async () => press(input(), 'Enter'));
    await settle(300);
    expect(host.querySelector('.history-message')?.textContent).toContain('The names changed on another device');
    expect(rows()[2].querySelector('.history-name')?.textContent).toBe('Del otro');
    expect(server.versions.length).toBe(1);
  });
});

describe('entrega 3: Restored from…', () => {
  it('después de restaurar, la lista dice "Restored from" y la fecha de la versión, y la de antes de restaurar sigue', async () => {
    prefs.set({ language: 'en' });
    const { a, pageId, server } = await setupNamed();
    // El editor de la página "restaura": una edición propia (con su huella, como el paso de deshacer del editor) que
    // sube con la sincronización.
    const live = await a.docs.open(pageId);
    offs.push(() => a.docs.close(pageId));
    offs.push(
      registerRestoreTarget(pageId, () => {
        const was = Y.getState(live.store, live.clientID);
        live.transact(() => (live.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).insert(0, [block('r', 'Restaurada')]), 'test');
        const now = Y.getState(live.store, live.clientID);
        const trace = traceFromSets({ clients: new Map([[live.clientID, [{ clock: was, len: now - was }]]]) }, { clients: new Map() });
        void a.docs.flush(pageId).then(() => a.engine.syncNow());
        return { ok: true, undo: () => true, onEdit: () => () => undefined, trace };
      }),
    );
    // Diez minutos después de la última: sin el corte, la restauración caería en la misma sesión.
    server.now = () => Date.parse('2026-09-30T17:40:00Z');
    const host = await mount(services(a, server.ownerId), pageId);
    const before = host.querySelectorAll('.history-session-row').length;
    await act(async () => (host.querySelectorAll('.history-session')[2] as HTMLButtonElement).click());
    await settle(300);
    await act(async () => host.querySelector<HTMLButtonElement>('.history-restore')!.click());
    await settle(100);
    const confirm = [...host.querySelectorAll<HTMLButtonElement>('.history-confirm button')].find((x) => x.textContent === 'Restore')!;
    await act(async () => confirm.click());
    for (let i = 0; i < 40 && !server.versions.some((v) => v.kind === 'restore'); i++) await settle(100);
    const mark = server.versions.find((v) => v.kind === 'restore');
    expect(mark).toBeDefined();
    expect(mark!.restoredFromSeq).toBe(firstSessionEnd(server, pageId));
    act(() => roots.pop()!.unmount());
    closeHistory();
    // Abrirlo de nuevo: la restauración es una versión nueva con su rótulo; la de antes sigue.
    const again = await mount(services(a, server.ownerId), pageId);
    const rows = [...again.querySelectorAll('.history-session-row')];
    expect(rows.length).toBe(before + 1);
    expect(rows[0].querySelector('.history-restored')?.textContent).toMatch(/^Restored from .*\d/);
    expect(rows[1].querySelector('.history-restored')).toBeNull();
  });
});

describe('Restored from… y Ctrl/⌘+Z', () => {
  it('deshacer la restauración con el teclado (no con el Undo del aviso) antes de que suba también deja de lado la marca', async () => {
    prefs.set({ language: 'en' });
    const { a, pageId, server } = await setupNamed();
    const live = await a.docs.open(pageId);
    offs.push(() => a.docs.close(pageId));
    let undone: (() => void) | null = null;
    let watching = 0;
    offs.push(
      registerRestoreTarget(pageId, () => {
        const was = Y.getState(live.store, live.clientID);
        live.transact(() => (live.getXmlFragment(CONTENT_FRAGMENT).get(0) as Y.XmlElement).insert(0, [block('r', 'Restaurada')]), 'test');
        const now = Y.getState(live.store, live.clientID);
        const trace = traceFromSets({ clients: new Map([[live.clientID, [{ clock: was, len: now - was }]]]) }, { clients: new Map() });
        // Como el editor: avisa cuando ese paso se deshace (acá lo dispara la prueba, como un Ctrl/⌘+Z).
        const onUndone = (fn: () => void) => {
          undone = fn;
          watching++;
          return () => {
            watching--;
          };
        };
        return { ok: true, undo: () => true, onEdit: () => () => undefined, onUndone, trace };
      }),
    );
    server.now = () => Date.parse('2026-09-30T17:40:00Z');
    const host = await mount(services(a, server.ownerId), pageId);
    await act(async () => (host.querySelectorAll('.history-session')[2] as HTMLButtonElement).click());
    await settle(300);
    await act(async () => host.querySelector<HTMLButtonElement>('.history-restore')!.click());
    await settle(100);
    const confirm = [...host.querySelectorAll<HTMLButtonElement>('.history-confirm button')].find((x) => x.textContent === 'Restore')!;
    await act(async () => confirm.click());
    for (let i = 0; i < 50 && !undone; i++) await settle(5);
    expect(undone).not.toBeNull();
    expect(watching).toBe(1);
    // Ctrl/⌘+Z antes de que suba; después sube lo que haya quedado (la fila trae la restauración y el deshacer).
    await act(async () => undone!());
    await a.docs.flush(pageId);
    await act(async () => void (await a.engine.syncNow()));
    await settle(1000);
    expect(server.versions.some((v) => v.kind === 'restore')).toBe(false);
    // Dejada de lado, ya no se mira el deshacer.
    expect(watching).toBe(0);
  });
});

describe('entrega 3: sin red, con lo guardado en el dispositivo', () => {
  it('muestra el historial hasta lo último bajado, con el aviso; restaurar y nombrar quedan apagados; al volver la red, se baja lo nuevo', async () => {
    prefs.set({ language: 'en' });
    const { a, pageId, server } = await setupNamed();
    const dbName = `test-${crypto.randomUUID()}`;
    await mount(services(a, server.ownerId, dbName), pageId);
    act(() => roots.pop()!.unmount());
    closeHistory();
    server.online = false;
    const host = await mount(services(a, server.ownerId, dbName), pageId);
    expect(host.querySelectorAll('.history-session').length).toBe(3);
    expect(host.querySelector('.history-offline-saved')?.textContent).toContain('Offline: showing the history up to');
    await act(async () => (host.querySelectorAll('.history-session')[2] as HTMLButtonElement).click());
    await settle(300);
    expect(host.querySelector('.history-page')?.textContent).toContain('Primera versión');
    const restore = host.querySelector<HTMLButtonElement>('.history-restore')!;
    expect(restore.disabled).toBe(true);
    expect(restore.getAttribute('data-tip')).toBe(t('history.why.offline'));
    const more = host.querySelector<HTMLButtonElement>('.history-more')!;
    expect(more.disabled).toBe(true);
    expect(more.getAttribute('data-tip')).toBe('Naming versions needs a connection.');
    // Vuelve la red: con la próxima sincronización se baja lo nuevo y se va el aviso.
    server.online = true;
    server.now = () => Date.parse('2026-09-30T19:00:00Z');
    await edit(a, pageId, (g) => g.insert(0, [block('n', 'Nueva')]));
    await act(async () => a.engine.syncNow());
    for (let i = 0; i < 30 && host.querySelector('.history-offline-saved'); i++) await settle(100);
    await settle(300);
    expect(host.querySelector('.history-offline-saved')).toBeNull();
    expect(host.querySelectorAll('.history-session').length).toBe(4);
    expect(host.querySelector<HTMLButtonElement>('.history-more')!.disabled).toBe(false);
  });

  it('sin nada guardado sigue diciendo que necesita conexión', async () => {
    prefs.set({ language: 'en' });
    const { a, pageId, server } = await setupNamed();
    server.online = false;
    const host = await mount(services(a, server.ownerId), pageId);
    expect(host.textContent).toContain('Version history needs a connection.');
  });
});
