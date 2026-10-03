// @vitest-environment jsdom
import { act, StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { prefs } from '../prefs';
import { ServicesContext, type Services } from '../services';
import { HISTORY_SCHEMA_VERSION } from '../sync/history';
import { block, group, textOf } from '../sync/historyTesting';
import type { SupabaseRemote } from '../sync/remote';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { legacyStorageNames, WANKA_LOCAL_KEY } from '../workspace';
import { mountEditor, unmountAll } from './collabHarness';
import { AppBarrier, ErrorBarrier, WorkspaceBarrier } from './ErrorBarrier';
import { schema as publishedSchema } from './fixtures/editorSchemaMain';
import { restoreInDoc } from './historyRestore';
import { closeHistory, requestRestore, useHistoryUi } from './historyUi';
import { HistoryPanel } from './HistoryPanel';
import { PageView } from './PageView';

// Las barreras de error (ErrorBarrier.tsx, Docs/Doc_Sincronizacion.md «Barreras de error»): un editor que tira al
// dibujarse deja el aviso en lugar de la página y el resto de la app sigue; no se vuelve a montar solo; cambiar de página
// la reinicia; lo que se escapa lo atrapa la barrera de la app, sin borrar nada del dispositivo ni de la cola. Con las
// tres filas hostiles de la auditoría del link *Can edit* (B3) que hacían tirar al editor real.

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

/** Los avisos de la barrera en la consola (los demás errores de React y del editor quedan callados en la prueba). */
let barrierLogs: string[] = [];
beforeEach(() => {
  prefs.set({ language: 'en' });
  barrierLogs = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith('[barrera]')) barrierLogs.push(`${args[0]} ${String(args[1])}`);
  });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

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
  act(() => closeHistory());
  unmountAll();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const wait = (ms = 30) => act(async () => new Promise((r) => setTimeout(r, ms)));
async function until(ok: () => boolean, tries = 120) {
  for (let i = 0; i < tries && !ok(); i++) await wait(50);
}

function services(d: Device): Services {
  const config = {
    url: 'https://znlvpuddswymxpffgvbz.supabase.co',
    publishableKey: 'sb_publishable_test',
    name: 'Wanka',
    localKey: WANKA_LOCAL_KEY,
    storage: legacyStorageNames(WANKA_LOCAL_KEY),
  };
  const client = { auth: { signOut: vi.fn() } } as never;
  return {
    workspace: { config, client },
    client,
    user: { id: d.remote.userId, email: `${d.remote.userId}@test` },
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

function render(node: ReactNode): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(node));
  (host as HTMLElement & { root?: Root }).root = root;
  return host;
}
const rootOf = (host: HTMLElement) => (host as HTMLElement & { root: Root }).root;

// --- Las filas hostiles (auditoría del link *Can edit*, B3) ------------------------------------------------------------

type Hostile = (doc: Y.Doc) => void;
/** Las tres de 19 que hacían tirar al editor real, al abrir la página y con la página abierta. */
const HOSTILE: Record<string, Hostile> = {
  // `text.toDelta is not a function`
  mapEnElParrafo: (v) => ((group(v).get(0) as Y.XmlElement).get(0) as Y.XmlElement).insert(0, [new Y.Map() as never]),
  // "h[object Object]" is not a valid element local name
  nivelObjeto: (v) => ((group(v).get(1) as Y.XmlElement).get(0) as Y.XmlElement).setAttribute('level', { x: 1 } as never),
  nivelTexto: (v) => ((group(v).get(1) as Y.XmlElement).get(0) as Y.XmlElement).setAttribute('level', 'x y' as never),
};

async function editPage(d: Device, pageId: string, fn: (doc: Y.Doc) => void): Promise<void> {
  const doc = await d.docs.open(pageId);
  doc.transact(() => fn(doc), 'test');
  await d.docs.flush(pageId);
  d.docs.close(pageId);
}

/**
 * Un workspace con dos páginas: «Rota» (lo del equipo y, después, una fila hostil escrita desde otro dispositivo) y
 * «Sana». `viewer`: quien abre es un miembro que solo ve.
 */
async function brokenWorkspace(hostile: Hostile, { viewer = false } = {}) {
  const server = new FakeServer();
  let clock = Date.parse('2026-10-01T15:00:00Z');
  server.now = () => clock;
  server.settings = { ...(server.settings ?? { generation: 1, minAppVersion: null, mediaUrl: null, schemaVersion: 1 }), schemaVersion: HISTORY_SCHEMA_VERSION };
  const writer = await makeDevice(server, undefined, '0.021', {}, HISTORY_SCHEMA_VERSION);
  devices.push(writer);
  const broken = await writer.tree.create(null, 'Rota');
  const healthy = await writer.tree.create(null, 'Sana');
  await writer.engine.syncNow();
  await editPage(writer, broken, (doc) =>
    group(doc).push([block('b0', 'texto del equipo cero'), block('b1', 'texto del equipo uno', 'heading', { level: '2' }), block('b2', 'texto del equipo dos')]),
  );
  await editPage(writer, healthy, (doc) => group(doc).push([block('s0', 'una página sana')]));
  await writer.engine.syncNow();
  // La fila hostil, una hora después (otra sesión en el historial), desde otro dispositivo (como llegaría de un link o
  // de una versión con un bug).
  clock += 60 * 60_000;
  const other = await makeDevice(server, undefined, '0.021', {}, HISTORY_SCHEMA_VERSION);
  devices.push(other);
  await other.engine.syncNow();
  await editPage(other, broken, hostile);
  await other.engine.syncNow();
  let reader = writer;
  if (viewer) {
    server.enableTeam();
    server.addMember('vera', 'member', 'vera@test');
    server.grant('vera', { projectId: server.workspaceId }, 'view');
    reader = await makeDevice(server, undefined, '0.021', {}, HISTORY_SCHEMA_VERSION, { id: 'vera', email: 'vera@test' });
    devices.push(reader);
  }
  await reader.engine.syncNow();
  return { server, writer, other, reader, broken, healthy };
}

/**
 * Una app mínima: el árbol (lo que tiene que seguir andando) y la página, adentro de las dos barreras de la app. Con
 * `history`, la pantalla del historial de verdad cuando se abre (como HistoryHost de Workspace.tsx).
 */
function Shell({ device, pageId, onTree, history = false }: { device: Device; pageId: string; onTree?: () => void; history?: boolean }) {
  return (
    <AppBarrier>
      <ServicesContext.Provider value={services(device)}>
        <WorkspaceBarrier>
          <nav className="tree-probe">
            <button className="tree-probe-button" onClick={onTree}>
              tree
            </button>
          </nav>
          <main className="main">
            <PageView key={pageId} id={pageId} />
          </main>
          {history ? <HistoryHost /> : <HistoryProbe />}
        </WorkspaceBarrier>
      </ServicesContext.Provider>
    </AppBarrier>
  );
}

/** Para ver si *Version history* abrió el historial (sin montar la pantalla del historial). */
function HistoryProbe() {
  const { pageId } = useHistoryUi();
  return pageId ? <div className="history-probe">{pageId}</div> : null;
}

function HistoryHost() {
  const { pageId } = useHistoryUi();
  return pageId ? <HistoryPanel key={pageId} pageId={pageId} /> : null;
}

const crashed = (host: HTMLElement) => !!host.querySelector('.page-crash');
const editorShown = (host: HTMLElement) => !!host.querySelector('.bn-editor');

describe('la barrera (sola)', () => {
  it('muestra el aviso, no vuelve a montar lo que tiró, Try again lo intenta una vez más y cambiar la clave la reinicia', async () => {
    let mounts = 0;
    let fail = true;
    function Throws() {
      useEffect(() => {
        mounts++;
        if (fail) throw new Error('falla al montar');
      }, []);
      return <p className="ok">ok</p>;
    }
    const tree = (key: string) => (
      <ErrorBarrier resetKey={key} what="Prueba" fallback={(retry) => <button className="retry" onClick={retry}>retry</button>}>
        <Throws />
      </ErrorBarrier>
    );
    const host = render(tree('a'));
    await wait(200);
    expect(host.querySelector('.retry')).not.toBeNull();
    const first = mounts;
    expect(first).toBeGreaterThanOrEqual(1);
    // Sin bucle: el tiempo pasa y no se vuelve a montar.
    await wait(300);
    expect(mounts).toBe(first);
    expect(barrierLogs.length).toBe(1);
    expect(barrierLogs[0]).toContain('Prueba');
    expect(barrierLogs[0]).toContain('falla al montar');
    // Try again: una sola vez más, y vuelve el aviso.
    act(() => host.querySelector<HTMLButtonElement>('.retry')!.click());
    await wait(100);
    expect(mounts).toBe(first + 1);
    expect(host.querySelector('.retry')).not.toBeNull();
    // Otra clave (otra página) la reinicia; ahora anda.
    fail = false;
    act(() => rootOf(host).render(tree('b')));
    await wait(100);
    expect(host.querySelector('.ok')).not.toBeNull();
    expect(mounts).toBe(first + 2);
  });

  it('un error al dibujar (no al montar) tampoco entra en bucle, también en modo estricto', async () => {
    let renders = 0;
    function Throws(): ReactNode {
      renders++;
      throw new Error('falla al dibujar');
    }
    const host = render(
      <StrictMode>
        <ErrorBarrier what="Prueba" fallback={() => <p className="fallback">fallback</p>}>
          <Throws />
        </ErrorBarrier>
      </StrictMode>,
    );
    await wait(100);
    expect(host.querySelector('.fallback')).not.toBeNull();
    const first = renders;
    await wait(300);
    expect(renders).toBe(first);
    // React vuelve a dibujar una vez antes de rendirse (y el modo estricto duplica): un número chico y fijo.
    expect(first).toBeLessThanOrEqual(4);
  });
});

describe('la barrera de la página, con las filas hostiles', () => {
  for (const [name, hostile] of Object.entries(HOSTILE)) {
    it(`${name}: el aviso en lugar de la página, el árbol sigue, otra página abre, volver muestra el aviso sin bucle`, async () => {
      const { reader, broken, healthy } = await brokenWorkspace(hostile);
      let treeClicks = 0;
      const host = render(<Shell device={reader} pageId={broken} onTree={() => treeClicks++} />);
      await until(() => crashed(host) || editorShown(host));
      expect(crashed(host)).toBe(true);
      expect(host.querySelector('.app-crash')).toBeNull();
      expect(host.querySelector('.page-crash')!.textContent).toContain("This page can't be shown right now.");
      // El título de la página y el árbol siguen.
      expect(host.querySelector<HTMLTextAreaElement>('.page-title')?.value).toBe('Rota');
      act(() => host.querySelector<HTMLButtonElement>('.tree-probe-button')!.click());
      expect(treeClicks).toBe(1);
      // El id de la página y el error en la consola, una vez; sin bucle.
      await wait(400);
      expect(barrierLogs.length).toBe(1);
      expect(barrierLogs[0]).toContain(broken);
      // Otra página abre bien.
      act(() => rootOf(host).render(<Shell device={reader} pageId={healthy} />));
      await until(() => editorShown(host));
      expect(editorShown(host)).toBe(true);
      expect(crashed(host)).toBe(false);
      expect(host.textContent).toContain('una página sana');
      // Volver a la rota: el aviso otra vez (la barrera se reinició al cambiar de página), y una sola vez más.
      act(() => rootOf(host).render(<Shell device={reader} pageId={broken} />));
      await until(() => crashed(host));
      expect(crashed(host)).toBe(true);
      await wait(400);
      expect(barrierLogs.length).toBe(2);
      expect(host.querySelector('.app-crash')).toBeNull();
    });
  }

  it('la fila llega con la página abierta: el aviso en lugar de la página, sin bucle', async () => {
    const server = new FakeServer();
    const a = await makeDevice(server);
    devices.push(a);
    const pageId = await a.tree.create(null, 'Abierta');
    await a.engine.syncNow();
    await editPage(a, pageId, (doc) =>
      group(doc).push([block('b0', 'cero'), block('b1', 'uno', 'heading', { level: '2' }), block('b2', 'dos')]),
    );
    await a.engine.syncNow();
    const host = render(<Shell device={a} pageId={pageId} />);
    await until(() => editorShown(host));
    expect(editorShown(host)).toBe(true);
    const b = await makeDevice(server);
    devices.push(b);
    await b.engine.syncNow();
    await editPage(b, pageId, HOSTILE.nivelObjeto);
    await b.engine.syncNow();
    await act(async () => void (await a.engine.syncNow()));
    await until(() => crashed(host));
    expect(crashed(host)).toBe(true);
    expect(host.querySelector('.app-crash')).toBeNull();
    await wait(500);
    expect(barrierLogs.length).toBe(1);
  });

  it('quien solo ve (o un visitante con link): el aviso sin historial', async () => {
    const { reader, broken } = await brokenWorkspace(HOSTILE.nivelTexto, { viewer: true });
    const host = render(<Shell device={reader} pageId={broken} />);
    await until(() => crashed(host) || editorShown(host));
    expect(crashed(host)).toBe(true);
    const box = host.querySelector('.page-crash')!;
    expect(box.textContent).toContain('Nothing was deleted, and the rest of the app keeps working.');
    expect(box.textContent).not.toContain('Version history');
    expect([...box.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Try again']);
  });

  it('quien puede editar: Version history abre el historial y restaurar (sin editor) arregla la página y la guarda', async () => {
    const { reader, broken, server } = await brokenWorkspace(HOSTILE.mapEnElParrafo);
    const host = render(<Shell device={reader} pageId={broken} />);
    await until(() => crashed(host) || editorShown(host));
    expect(crashed(host)).toBe(true);
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('.page-crash button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Version history', 'Try again']);
    act(() => buttons[0].click());
    expect(host.querySelector('.history-probe')?.textContent).toBe(broken);

    // La versión de antes de la fila hostil (la primera del servidor) y el esquema del editor que la muestra.
    const before = new Y.Doc();
    for (const row of server.updates.get(broken)!.slice(0, -1)) Y.applyUpdate(before, row.data);
    const schema = mountEditor(new Y.Doc()).prosemirrorView!.state.schema;
    let outcome = requestRestore(broken, before, null);
    // Sin el esquema no se restaura (no hay cómo hacer la ida y vuelta).
    for (let i = 0; i < 40 && !outcome.ok && outcome.reason === 'notEditable'; i++) {
      await wait(50);
      outcome = requestRestore(broken, before, null);
    }
    expect(outcome).toEqual({ ok: false, reason: 'shape' });
    await act(async () => {
      outcome = requestRestore(broken, before, schema);
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.undoable).toBe(false);
    // El editor se vuelve a montar con la página restaurada.
    await until(() => editorShown(host));
    expect(editorShown(host)).toBe(true);
    expect(crashed(host)).toBe(false);
    expect(host.textContent).toContain('texto del equipo cero');
    expect(host.textContent).toContain('texto del equipo dos');
    // Quedó guardada en el dispositivo y sube como cualquier edición.
    expect(await reader.docs.unsyncedPages()).toContain(broken);
    await act(async () => void (await reader.engine.syncNow()));
    expect(await reader.docs.unsyncedPages()).not.toContain(broken);
    const onServer = new Y.Doc();
    for (const row of server.updates.get(broken)!) Y.applyUpdate(onServer, row.data);
    expect(JSON.stringify(onServer.getXmlFragment(CONTENT_FRAGMENT).toJSON())).toBe(JSON.stringify(before.getXmlFragment(CONTENT_FRAGMENT).toJSON()));
  });
});

describe('el historial desde la barrera', () => {
  it('la versión actual (rota) no se lleva el historial; elegir la anterior y Restore arreglan la página, sin Undo', async () => {
    const { reader, broken } = await brokenWorkspace(HOSTILE.nivelObjeto);
    const notices: unknown[] = [];
    const onNotice = (e: Event) => notices.push((e as CustomEvent).detail);
    window.addEventListener('shotdocs:notice', onNotice);
    try {
      const host = render(<Shell device={reader} pageId={broken} history />);
      await until(() => crashed(host) || editorShown(host));
      expect(crashed(host)).toBe(true);
      act(() => host.querySelector<HTMLButtonElement>('.page-crash button')!.click());
      await until(() => host.querySelectorAll('.history-session').length >= 2 && !!host.querySelector('.history-version-crash'));
      // La versión actual tiene la fila hostil: su vista tira, el historial sigue (y la app también).
      expect(host.querySelector('.history-version-crash')?.textContent).toContain("This version can't be shown.");
      expect(host.querySelector('.app-crash')).toBeNull();
      await act(async () => host.querySelectorAll<HTMLButtonElement>('.history-session')[1].click());
      await until(() => !!host.querySelector('.history-page .bn-editor') && !!host.querySelector<HTMLButtonElement>('.history-restore:not([disabled])'));
      expect(host.querySelector('.history-version-crash')).toBeNull();
      expect(host.querySelector('.history-page')?.textContent).toContain('texto del equipo uno');
      await act(async () => host.querySelector<HTMLButtonElement>('.history-restore')!.click());
      await wait(100);
      const confirm = [...host.querySelectorAll<HTMLButtonElement>('.history-confirm button')].find((b) => b.textContent === 'Restore')!;
      await act(async () => confirm.click());
      await until(() => !host.querySelector('.history-page') && editorShown(host));
      expect(crashed(host)).toBe(false);
      expect(host.querySelector('main .bn-editor')?.textContent).toContain('texto del equipo uno');
      // El aviso de restaurada, sin **Undo** (no se deshace desde ahí: se restaura otra versión).
      expect(notices.some((n) => typeof n === 'string' && n.startsWith('Restored the version from'))).toBe(true);
      expect(notices.some((n) => typeof n === 'object')).toBe(false);
      expect(await reader.docs.unsyncedPages()).toContain(broken);
    } finally {
      window.removeEventListener('shotdocs:notice', onNotice);
    }
  });
});

describe('restaurar sin editor', () => {
  it('reemplaza el contenido por la versión, con los ids de los bloques, y la versión publicada la abre bien', () => {
    const before = new Y.Doc();
    group(before).push([block('b0', 'cero'), block('b1', 'uno', 'heading', { level: '2' })]);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(before));
    textOf(group(doc).get(0) as Y.XmlElement).insert(4, ' y algo más');
    HOSTILE.nivelObjeto(doc);
    // El colapsado (otra raíz) no se toca.
    doc.getMap('collapsedHeadings').set('b1', { at: 1 });
    const schema = mountEditor(new Y.Doc()).prosemirrorView!.state.schema;
    const outcome = restoreInDoc(doc, before, schema);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.trace && outcome.trace.ins.length + outcome.trace.del.length).toBeGreaterThan(0);
      expect(outcome.undo()).toBe(false);
    }
    expect(doc.getXmlFragment(CONTENT_FRAGMENT).toJSON()).toBe(before.getXmlFragment(CONTENT_FRAGMENT).toJSON());
    expect(doc.getMap('collapsedHeadings').get('b1')).toEqual({ at: 1 });
    // La versión publicada de la app (el esquema anterior) abre lo restaurado sin perder nada.
    const old = mountEditor(doc, 'viejo', publishedSchema);
    expect(old.document.map((b) => b.id)).toEqual(['b0', 'b1']);
    expect(JSON.stringify(old.document)).toContain('cero');
    expect(JSON.stringify(old.document)).toContain('uno');
  });

  it('una versión que el editor no puede armar no se restaura: el documento queda igual', () => {
    const broken = new Y.Doc();
    group(broken).push([block('b0', 'cero'), block('b1', 'uno', 'heading', { level: '2' })]);
    HOSTILE.mapEnElParrafo(broken);
    const doc = new Y.Doc();
    group(doc).push([block('z', 'lo de ahora')]);
    const json = doc.getXmlFragment(CONTENT_FRAGMENT).toJSON();
    const schema = mountEditor(new Y.Doc()).prosemirrorView!.state.schema;
    expect(restoreInDoc(doc, broken, schema)).toEqual({ ok: false, reason: 'shape' });
    expect(doc.getXmlFragment(CONTENT_FRAGMENT).toJSON()).toBe(json);
  });
});

describe('la barrera de la app', () => {
  function Bomb({ armed }: { armed: boolean }) {
    if (armed) throw new Error('falla en la app');
    return <p className="app-ok">ok</p>;
  }

  it('lo que se escapa: pantalla con Reload y lo que falta subir; la sincronización sigue y nada se borra', async () => {
    const server = new FakeServer();
    const d = await makeDevice(server);
    devices.push(d);
    const pageId = await d.tree.create(null, 'P');
    await d.engine.syncNow();
    server.online = false;
    await editPage(d, pageId, (doc) => group(doc).push([block('x', 'sin subir')]));
    await d.engine.syncNow().catch(() => undefined);
    const rowsBefore = await d.db.count('docUpdates');
    const deleteDb = vi.spyOn(indexedDB, 'deleteDatabase');
    function Toggle() {
      const [armed, setArmed] = useState(false);
      return (
        <>
          <button className="arm" onClick={() => setArmed(true)}>
            arm
          </button>
          <Bomb armed={armed} />
        </>
      );
    }
    const host = render(
      <AppBarrier>
        <ServicesContext.Provider value={services(d)}>
          <WorkspaceBarrier>
            <Toggle />
          </WorkspaceBarrier>
        </ServicesContext.Provider>
      </AppBarrier>,
    );
    await wait(50);
    act(() => host.querySelector<HTMLButtonElement>('.arm')!.click());
    await wait(50);
    const screen = host.querySelector('.app-crash');
    expect(screen).not.toBeNull();
    expect(screen!.textContent).toContain('Something went wrong');
    expect(screen!.querySelector('button')!.textContent).toBe('Reload');
    expect(screen!.textContent).toMatch(/\d+ changes? still to upload/);
    expect(barrierLogs.length).toBe(1);
    // Nada se borró: lo guardado en el dispositivo sigue y la cola también.
    expect(await d.db.count('docUpdates')).toBe(rowsBefore);
    expect(await d.docs.unsyncedPages()).toContain(pageId);
    expect(deleteDb).not.toHaveBeenCalled();
    // La sincronización sigue viva debajo de la pantalla: vuelve la red, sube y el aviso de lo pendiente se va.
    server.online = true;
    await act(async () => void (await d.engine.syncNow()));
    await wait(50);
    expect(await d.docs.unsyncedPages()).not.toContain(pageId);
    expect(host.querySelector('.app-crash')!.textContent).not.toMatch(/still to upload/);
    // Sin bucle.
    await wait(300);
    expect(barrierLogs.length).toBe(1);
  });

  it('sin servicios (fuera de un workspace): la misma pantalla, sin contar nada', async () => {
    const host = render(
      <AppBarrier>
        <Bomb armed />
      </AppBarrier>,
    );
    await wait(50);
    expect(host.querySelector('.app-crash')).not.toBeNull();
    expect(host.querySelector('.app-crash-pending')).toBeNull();
    expect(host.querySelector('.app-crash button')!.textContent).toBe('Reload');
  });
});
