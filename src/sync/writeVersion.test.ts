import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_VERSION_HEADER, appVersionHeaders, createWorkspaceClient, storageNamesFor } from '../workspace';
import { SupabaseRemote } from './remote';
import { FakeRemote, FakeServer, WRITE_VERSION_SINCE, makeDevice, microtasks, type Device } from './testing';
import { isPermanent, RemoteError } from './types';

// La versión mínima del workspace también frena los cambios del árbol y los comentarios (B.17; Docs/
// Doc_Sincronizacion.md, "La versión mínima, el árbol y los comentarios"). La app manda su versión en el header
// `x-shotdocs-version`; la base (supabase/migrations/20261008120000_version_minima_arbol.sql) la compara con la mínima,
// y sin header rechaza solo con una mínima de la primera versión que lo manda o más. El rechazo es pasajero (503,
// `app_outdated`): nada pasa a rechazados y todo sale al actualizar. Las versiones anteriores de verdad (la v0.090
// copiada) están en offlineLargo.test.ts.

const MIGRATION = '20261008120000_version_minima_arbol';
const NEW = WRITE_VERSION_SINCE.toFixed(3);
const NEWER = (WRITE_VERSION_SINCE + 0.001).toFixed(3);

const devices: Device[] = [];

async function device(server: FakeServer, dbName: string, appVersion: string): Promise<Device> {
  const d = await makeDevice(server, dbName, appVersion);
  devices.push(d);
  return d;
}

async function close(d: Device): Promise<void> {
  await d.engine.stop();
  await d.docs.flush();
  d.db.close();
  d.mediaDb.close();
  d.commentsDb.close();
  devices.splice(devices.indexOf(d), 1);
}

afterEach(() => {
  for (const d of devices.splice(0)) {
    void d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
  vi.unstubAllGlobals();
});

/** Un workspace con comentarios (versión 5 de la base o más). */
function workspace(): FakeServer {
  const server = new FakeServer();
  server.enableComments();
  return server;
}

/** Lo pendiente y lo rechazado de un dispositivo. */
function counts(d: Device) {
  const s = d.engine.getStatus();
  return {
    pendingOps: s.pendingOps,
    failedOps: s.failedOps,
    pendingComments: s.pendingComments,
    failedComments: s.failedComments,
    outdated: s.outdated,
  };
}

/** Sube la mínima justo antes del próximo pedido `method` de este dispositivo (otra persona la sube a la vez). */
function raiseMinBefore(d: Device, method: 'updatePage' | 'createPage' | 'addComment', min: number): void {
  const remote = d.remote as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const original = remote[method].bind(d.remote);
  let done = false;
  remote[method] = (...args: unknown[]) => {
    if (!done) {
      done = true;
      d.remote.server.settings = { ...d.remote.server.settings!, minAppVersion: min };
    }
    return original(...args);
  };
}

describe('el servidor en memoria frena el árbol y los comentarios como la base', () => {
  const page = { id: crypto.randomUUID(), workspace_id: '', parent_id: null, title: 'P', sort_key: 'a0' };

  it('sin header: anda con la mínima por debajo del umbral y se rechaza (pasajero) desde el umbral', async () => {
    const server = new FakeServer();
    const old = new FakeRemote(server, '0.090');
    old.versionHeader = false;
    server.settings = { ...server.settings!, minAppVersion: WRITE_VERSION_SINCE - 0.001 };
    await old.createPage({ ...page, workspace_id: server.workspaceId });
    await old.updatePage(page.id, { title: 'renombrada' });
    server.settings = { ...server.settings!, minAppVersion: WRITE_VERSION_SINCE };
    const err = await old.updatePage(page.id, { title: 'vieja' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RemoteError);
    expect((err as RemoteError).message).toBe('app_outdated');
    expect(isPermanent(err)).toBe(false);
    await expect(old.addComment({ id: crypto.randomUUID(), pageId: page.id, blockId: null, threadId: null, body: 'x' })).rejects.toThrow(
      'app_outdated',
    );
    expect(server.pages.get(page.id)?.title).toBe('renombrada');
    expect(server.comments.size).toBe(0);
  });

  it('con header: la versión contra la mínima; una base sin la migración no mira nada', async () => {
    const server = new FakeServer();
    server.settings = { ...server.settings!, minAppVersion: Number(NEWER) };
    const low = new FakeRemote(server, NEW);
    await expect(low.createPage({ ...page, workspace_id: server.workspaceId })).rejects.toThrow('app_outdated');
    await new FakeRemote(server, NEWER).createPage({ ...page, workspace_id: server.workspaceId });
    server.writeVersionSince = null;
    const old = new FakeRemote(server, '0.090');
    old.versionHeader = false;
    await low.updatePage(page.id, { title: 'sin migración' });
    await old.updatePage(page.id, { title: 'vieja sin migración' });
    expect(server.pages.get(page.id)?.title).toBe('vieja sin migración');
  });
});

describe('la app con la base que frena el árbol y los comentarios por versión', () => {
  it('una versión por arriba de la mínima sube todo normal', async () => {
    const server = workspace();
    server.settings = { ...server.settings!, minAppVersion: Number(NEW) };
    const d = await device(server, crypto.randomUUID(), NEW);
    const p = await d.tree.create(null, 'Escena 1');
    const child = await d.tree.create(p, 'Toma 1');
    await d.tree.rename(p, 'Escena 1 (rodaje)');
    await d.tree.move(child, null);
    await d.comments.add(p, null, 'revisar');
    await d.engine.syncNow();
    expect(counts(d)).toEqual({ pendingOps: 0, failedOps: 0, pendingComments: 0, failedComments: 0, outdated: false });
    expect(server.pages.get(p)?.title).toBe('Escena 1 (rodaje)');
    expect(server.pages.get(child)?.parent_id).toBeNull();
    expect([...server.comments.values()].map((c) => c.body)).toEqual(['revisar']);
  });

  it('suben la mínima entre la consulta y un cambio del árbol: queda en la cola, se avisa, y sale al actualizar', async () => {
    const server = workspace();
    const dbName = crypto.randomUUID();
    let d = await device(server, dbName, NEW);
    const p = await d.tree.create(null, 'Escena 2');
    await d.engine.syncNow();
    await d.tree.rename(p, 'Escena 2 (lluvia)');
    const later = await d.tree.create(p, 'Toma nueva');
    raiseMinBefore(d, 'updatePage', Number(NEWER));
    await d.engine.syncNow();
    // Ni el renombre ni lo que venía después (la página nueva) salieron; nada quedó rechazado.
    expect(counts(d)).toEqual({ pendingOps: 2, failedOps: 0, pendingComments: 0, failedComments: 0, outdated: true });
    expect(server.pages.get(p)?.title).toBe('Escena 2');
    expect(server.pages.has(later)).toBe(false);
    expect(d.tree.get(p)?.title).toBe('Escena 2 (lluvia)');
    // Otra vuelta con la app vieja no manda nada (ya sabe que es vieja).
    await d.engine.syncNow();
    expect(counts(d).pendingOps).toBe(2);

    await close(d);
    d = await device(server, dbName, NEWER);
    await d.engine.syncNow();
    expect(counts(d)).toEqual({ pendingOps: 0, failedOps: 0, pendingComments: 0, failedComments: 0, outdated: false });
    expect(server.pages.get(p)?.title).toBe('Escena 2 (lluvia)');
    expect(server.pages.get(later)?.parent_id).toBe(p);
  });

  it('suben la mínima entre la consulta y un comentario: queda pendiente sin error, se avisa, y sale al actualizar', async () => {
    const server = workspace();
    const dbName = crypto.randomUUID();
    let d = await device(server, dbName, NEW);
    const p = await d.tree.create(null, 'Escena 3');
    await d.engine.syncNow();
    await d.comments.add(p, null, 'el inserto va con arte');
    await d.comments.add(p, null, 'y el plano general también');
    raiseMinBefore(d, 'addComment', Number(NEWER));
    await d.engine.syncNow();
    expect(counts(d)).toEqual({ pendingOps: 0, failedOps: 0, pendingComments: 2, failedComments: 0, outdated: true });
    expect(d.comments.status().error).toBeNull();
    expect(server.comments.size).toBe(0);

    await close(d);
    d = await device(server, dbName, NEWER);
    await d.engine.syncNow();
    expect(counts(d)).toEqual({ pendingOps: 0, failedOps: 0, pendingComments: 0, failedComments: 0, outdated: false });
    expect([...server.comments.values()].map((c) => c.body).sort()).toEqual(['el inserto va con arte', 'y el plano general también']);
  });

  it('al abrir, lo que una versión anterior dejó rechazado por la versión vuelve a la cola; los otros rechazos quedan', async () => {
    const server = workspace();
    const dbName = crypto.randomUUID();
    let d = await device(server, dbName, NEW);
    const a = await d.tree.create(null, 'A');
    const b = await d.tree.create(null, 'B');
    await d.engine.syncNow();
    // Lo que hacía una versión anterior con un `app_outdated` de 400 (y con cualquier otro rechazo).
    await d.tree.rename(a, 'A renombrada');
    await d.tree.rename(b, 'B renombrada');
    const [opA, opB] = d.tree.pendingOps();
    await d.tree.failOp(opA, 'app_outdated');
    await d.tree.failOp(opB, 'page_trash_denied');
    await close(d);

    d = await device(server, dbName, NEW);
    d.engine.start();
    await microtasks();
    await d.engine.syncNow();
    expect(server.pages.get(a)?.title).toBe('A renombrada');
    expect(server.pages.get(b)?.title).toBe('B');
    expect(d.tree.failedOps().map((f) => f.error)).toEqual(['page_trash_denied']);
    expect(counts(d)).toMatchObject({ pendingOps: 0, failedOps: 1 });
  });

  it('con la base sin la migración todo sigue andando, también con la mínima subida para una versión anterior', async () => {
    const server = workspace();
    server.writeVersionSince = null;
    server.settings = { ...server.settings!, minAppVersion: Number(NEW) };
    const d = await device(server, crypto.randomUUID(), NEW);
    const p = await d.tree.create(null, 'Sin migrar');
    await d.tree.rename(p, 'Sin migrar (ok)');
    await d.comments.add(p, null, 'anda');
    await d.engine.syncNow();
    expect(counts(d)).toEqual({ pendingOps: 0, failedOps: 0, pendingComments: 0, failedComments: 0, outdated: false });
    expect(server.pages.get(p)?.title).toBe('Sin migrar (ok)');
    expect(server.comments.size).toBe(1);
  });
});

describe('archivar, borrar y restaurar proyectos, y los textos', () => {
  it('una versión anterior no archiva, borra ni restaura con la mínima en el umbral; repetir lo hecho sí anda', async () => {
    const server = new FakeServer();
    server.enableProjectStates();
    const owner = new FakeRemote(server, NEW);
    const projectId = server.workspaceId;
    server.settings = { ...server.settings!, minAppVersion: WRITE_VERSION_SINCE };
    const old = new FakeRemote(server, '0.098');
    old.versionHeader = false;
    for (const call of [() => old.setProjectArchived(projectId, true), () => old.deleteProject(projectId)]) {
      const err = await call().catch((e: unknown) => e);
      expect((err as RemoteError).message).toBe('app_outdated');
      expect(isPermanent(err)).toBe(false);
    }
    await old.setProjectArchived(projectId, false);
    await old.restoreProject(projectId);
    await owner.deleteProject(projectId);
    await expect(old.restoreProject(projectId)).rejects.toThrow('app_outdated');
    await old.deleteProject(projectId);
    await owner.restoreProject(projectId);
    expect(server.projectDeleted(projectId)).toBe(false);
  });

  it('`app_outdated` se muestra en palabras, en los dos idiomas (proyectos, comentarios)', async () => {
    const { projectStateError } = await import('../ui/project');
    const { commentErrorText } = await import('./comments');
    const { translate } = await import('../i18n');
    const es = Object.assign((key: never, params?: never) => translate('es', key, params), { lang: 'es' }) as never;
    const err = new RemoteError('app_outdated', false, 'P0001');
    expect(projectStateError(err)).toBe(translate('en', 'common.appOutdated'));
    expect(projectStateError(err, es)).toBe(translate('es', 'common.appOutdated'));
    expect(translate('es', 'common.appOutdated')).toMatch(/versión más nueva/);
    expect(commentErrorText('app_outdated')).toBe(translate('en', 'commentError.outdated'));
    expect(commentErrorText('app_outdated')).not.toBe('app_outdated');
  });
});

describe('el header con la versión y la respuesta de la base', () => {
  const ok = () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });

  it('el cliente del workspace manda la versión de la app en cada pedido a la base', async () => {
    expect(appVersionHeaders('0.123')).toEqual({ [APP_VERSION_HEADER]: '0.123' });
    // Sin versión (una compilación sin changelog): ningún header, como una versión anterior.
    expect(appVersionHeaders('')).toEqual({});
    const calls: { url: string; headers: Headers }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), headers: new Headers(init?.headers) });
        return ok();
      }),
    );
    const localKey = `prueba-${crypto.randomUUID()}`;
    const client = createWorkspaceClient({
      url: 'https://base.test',
      publishableKey: 'clave-publica',
      name: '',
      localKey,
      storage: storageNamesFor(localKey),
    });
    await client.from('pages').update({ title: 'x' }).eq('id', crypto.randomUUID());
    await client.rpc('add_comment', {});
    const rest = calls.filter((c) => c.url.startsWith('https://base.test/rest/v1/'));
    expect(rest).toHaveLength(2);
    expect(__APP_VERSION__).not.toBe('');
    for (const c of rest) expect(c.headers.get(APP_VERSION_HEADER)).toBe(__APP_VERSION__);
  });

  it('el 503 `app_outdated` de la base llega como un error pasajero (no rechazado) con ese mensaje', async () => {
    const body = { code: 'P0001', message: 'app_outdated', details: null, hint: 'Reload the app to update it.' };
    const client = createClient('https://base.test', 'clave-publica', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: async () => new Response(JSON.stringify(body), { status: 503, headers: { 'content-type': 'application/json' } }),
      },
    });
    const remote = new SupabaseRemote(client, NEW);
    for (const call of [
      () => remote.updatePage(crypto.randomUUID(), { title: 'x' }),
      () => remote.createPage({ id: crypto.randomUUID(), workspace_id: crypto.randomUUID(), parent_id: null, title: 'x', sort_key: 'a0' }),
      () => remote.renameProject(crypto.randomUUID(), 'x'),
    ]) {
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RemoteError);
      expect((err as RemoteError).message).toBe('app_outdated');
      expect(isPermanent(err)).toBe(false);
    }
  });
});

describe('la migración', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

  it('el umbral es la versión de la entrada del changelog que la nombra, también en la prueba SQL (si se renumera, esto falla)', () => {
    const changelog = read('../../Docs/Changelog.md');
    const at = changelog.indexOf(`${MIGRATION}.sql`);
    expect(at).toBeGreaterThan(0);
    // Mientras no se publica, la entrada es `v0.099 :` y el umbral también; quien publica pone el número en los tres.
    const headers = [...changelog.slice(0, at).matchAll(/^v(\d+\.(?:\d{3}|0XX)) :$/gm)];
    const version = headers[headers.length - 1]?.[1];
    expect(version).toMatch(/^\d+\.(\d{3}|0XX)$/);

    const migration = read(`../../supabase/migrations/${MIGRATION}.sql`);
    const thresholds = [...migration.matchAll(/min_app_version >= ([\dX.]+)\)/g)].map((m) => m[1]);
    expect(thresholds).toEqual([version]);

    const sql = read(`../../supabase/tests/version_minima_arbol_permisos.sql`);
    expect(sql).toContain(`set min_app_version = ${version};`);
    expect(sql).toContain(`set min_app_version = ${version} - 0.001;`);
    // Ninguna otra versión escrita a mano en la migración ni en la prueba.
    for (const text of [migration, sql]) {
      const others = [...text.matchAll(/\b0\.(\d{3}|0XX)\b/g)].map((m) => m[0]).filter((v) => v !== version && v !== '0.001' && v !== '0.098');
      expect(others).toEqual([]);
    }
  });
});
