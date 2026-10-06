import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingsDelta, SupabaseRemote } from './remote';
import { FakeServer, makeDevice, type Device } from './testing';
import { mergeSettings } from './tree';
import type { PageSettings } from './types';

// Los ajustes de una página (`pages.settings`) se fusionan por clave en la base (`patch_page_settings`,
// supabase/migrations/20261104120000_ajustes_fusionar.sql): dos cambios de claves distintas hechos a la vez en dos
// dispositivos quedan los dos. Antes cada cambio subía el objeto entero y ganaba el último que llegaba.

const devices: Device[] = [];
async function device(server: FakeServer, user?: { id: string; email?: string }): Promise<Device> {
  const d = await makeDevice(server, undefined, undefined, undefined, undefined, user ?? {});
  devices.push(d);
  return d;
}

afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
    d.mediaDb.close();
  }
  vi.useRealTimers();
});

const A4: PageSettings['format'] = { size: 'A4', landscape: false };

/** Dos dispositivos de la misma persona con la misma página ya sincronizada. */
async function twoDevices(server = new FakeServer()) {
  const a = await device(server);
  const page = await a.tree.create(null, 'Carpeta');
  await a.engine.syncNow();
  const b = await device(server);
  await b.engine.syncNow();
  expect(b.tree.get(page)?.title).toBe('Carpeta');
  return { server, a, b, page };
}

describe('ajustes por clave: dos dispositivos a la vez', () => {
  it('cada uno cambia una clave distinta sin haber visto el cambio del otro: quedan las dos', async () => {
    const { server, a, b, page } = await twoDevices();
    await a.tree.setSetting(page, 'format', A4);
    await b.tree.setSetting(page, 'split', true);
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(server.pages.get(page)?.settings).toEqual({ format: A4, split: true });
    await a.engine.syncNow();
    expect(a.tree.get(page)?.settings).toEqual({ format: A4, split: true });
    expect(b.tree.get(page)?.settings).toEqual({ format: A4, split: true });
    expect(a.tree.failedOps()).toEqual([]);
    expect(b.tree.failedOps()).toEqual([]);
    expect(server.settingsPatchCalls).toEqual([
      { id: page, keys: ['format'], merged: true },
      { id: page, keys: ['split'], merged: true },
    ]);
  });

  it('uno saca una clave mientras el otro pone otra: sale solo la sacada', async () => {
    const { server, a, b, page } = await twoDevices();
    await a.tree.setSetting(page, 'format', A4);
    await a.tree.setSetting(page, 'split', true);
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.tree.setSetting(page, 'format', undefined);
    await b.tree.setSetting(page, 'header', { levels: 2 });
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect(server.pages.get(page)?.settings).toEqual({ split: true, header: { levels: 2 } });
    await b.engine.syncNow();
    expect(b.tree.get(page)?.settings).toEqual({ split: true, header: { levels: 2 } });
  });

  it('la misma clave en los dos: gana el último que llega, y lo demás no se toca', async () => {
    const { server, a, b, page } = await twoDevices();
    await a.tree.setSetting(page, 'split', true);
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.tree.setSetting(page, 'format', A4);
    await b.tree.setSetting(page, 'format', { size: 'A5', landscape: true });
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(server.pages.get(page)?.settings).toEqual({ split: true, format: { size: 'A5', landscape: true } });
  });

  it('con el cambio propio todavía en la cola, lo que baja de otro dispositivo se ve junto con lo propio', async () => {
    const { server, a, b, page } = await twoDevices();
    await a.tree.setSetting(page, 'format', A4);
    await a.engine.syncNow();
    // B cambia otra clave y, antes de subirla, le llega el árbol con el cambio de A (la subida de B falla una vez).
    await b.tree.setSetting(page, 'split', true);
    server.online = false;
    await b.engine.syncNow().catch(() => undefined);
    server.online = true;
    await b.tree.setSnapshot([...server.pages.values()].map((p) => ({ ...p })));
    expect(b.tree.pendingOps()).toHaveLength(1);
    expect(b.tree.get(page)?.settings).toEqual({ format: A4, split: true });
    await b.engine.syncNow();
    expect(server.pages.get(page)?.settings).toEqual({ format: A4, split: true });
    expect(b.tree.get(page)?.settings).toEqual({ format: A4, split: true });
  });

  it('repetir el mismo cambio (la respuesta se perdió) deja lo mismo', async () => {
    const { server, a, page } = await twoDevices();
    await a.tree.setSetting(page, 'format', A4);
    const [op] = a.tree.pendingOps();
    expect(op.op).toMatchObject({ kind: 'update', settingsKeys: ['format'] });
    if (op.op.kind !== 'update') throw new Error('se esperaba un cambio de página');
    await a.remote.updatePage(page, op.op.patch, op.op.settingsKeys);
    await a.engine.syncNow();
    expect(server.pages.get(page)?.settings).toEqual({ format: A4 });
    expect(a.tree.pendingOps()).toEqual([]);
  });
});

describe('ajustes por clave: lo que no cambia', () => {
  it('una base sin la función: sube el objeto entero y gana el último, como siempre, sin rechazos', async () => {
    const server = new FakeServer();
    server.settingsPatch = false;
    const { a, b, page } = await twoDevices(server);
    await a.tree.setSetting(page, 'format', A4);
    await b.tree.setSetting(page, 'split', true);
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(server.pages.get(page)?.settings).toEqual({ split: true });
    expect(a.tree.failedOps()).toEqual([]);
    expect(b.tree.failedOps()).toEqual([]);
    expect(server.settingsPatchCalls.every((c) => !c.merged)).toBe(true);
  });

  it('un cambio guardado por una versión anterior (sin las claves) reemplaza el objeto entero', async () => {
    const { server, a, b, page } = await twoDevices();
    await a.tree.setSetting(page, 'format', A4);
    await a.engine.syncNow();
    // Como lo dejó en la cola la versión publicada: los ajustes enteros, sin `settingsKeys`.
    await b.tree.setPatch(page, { settings: { split: true } });
    expect(b.tree.pendingOps()[0].op).not.toHaveProperty('settingsKeys');
    await b.engine.syncNow();
    expect(server.pages.get(page)?.settings).toEqual({ split: true });
    expect(server.settingsPatchCalls).toHaveLength(1);
  });

  it('quien solo ve la página no cambia sus ajustes: el cambio queda rechazado, con los ajustes del servidor intactos', async () => {
    const server = new FakeServer();
    server.enableTeam();
    const owner = await device(server);
    const page = await owner.tree.create(null, 'Carpeta');
    await owner.tree.setSetting(page, 'format', A4);
    await owner.engine.syncNow();
    server.addMember('vera', 'member');
    server.grant('vera', { pageId: page }, 'view');
    const vera = await device(server, { id: 'vera' });
    await vera.engine.syncNow();
    expect(vera.tree.get(page)?.settings).toEqual({ format: A4 });
    await vera.tree.setSetting(page, 'split', true);
    await vera.engine.syncNow();
    expect(server.pages.get(page)?.settings).toEqual({ format: A4 });
    expect(vera.tree.failedOps().map((f) => f.error)).toEqual(['page_not_found']);
  });

  it('si la fusión pasa el tope de 2000 caracteres, la base la rechaza y no cambia nada', async () => {
    const { server, a, b, page } = await twoDevices();
    await a.tree.setSetting(page, 'template', { description: 'x'.repeat(1200) });
    await b.tree.setSetting(page, 'dayReports', { template: 'y'.repeat(1200) });
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(server.pages.get(page)?.settings).toEqual({ template: { description: 'x'.repeat(1200) } });
    expect(b.tree.failedOps()).toHaveLength(1);
    expect(b.tree.failedOps()[0].error).toContain('pages_settings_shape');
  });

  it('suben la mínima entre la consulta y el cambio de ajustes: la base lo rechaza, queda en la cola con el aviso, y sale al actualizar', async () => {
    const server = new FakeServer();
    const dbName = crypto.randomUUID();
    let d = await makeDevice(server, dbName, '0.300');
    devices.push(d);
    const page = await d.tree.create(null, 'Carpeta');
    await d.engine.syncNow();
    await d.tree.setSetting(page, 'format', A4);
    // Otra persona sube la mínima justo antes de que salga el pedido: el motor ya consultó y lo manda igual.
    const update = d.remote.updatePage.bind(d.remote);
    let sent = 0;
    d.remote.updatePage = (...args) => {
      if (sent++ === 0) server.settings = { ...server.settings!, minAppVersion: 0.5 };
      return update(...args);
    };
    await d.engine.syncNow();
    // El pedido llegó a la base con su clave y la base lo rechazó (503 `app_outdated`): nada escrito, nada rechazado.
    expect(sent).toBe(1);
    expect(server.settingsPatchCalls).toEqual([{ id: page, keys: ['format'], merged: true }]);
    expect(server.pages.get(page)?.settings).toEqual({});
    expect(d.tree.pendingOps().map((o) => o.op)).toMatchObject([{ kind: 'update', id: page, settingsKeys: ['format'] }]);
    expect(d.tree.failedOps()).toEqual([]);
    expect(d.engine.getStatus().outdated).toBe(true);
    expect(d.tree.get(page)?.settings).toEqual({ format: A4 });
    // Otra vuelta con la app vieja no manda nada más (ya sabe que es vieja).
    await d.engine.syncNow();
    expect(sent).toBe(1);

    // Al actualizar la app, el mismo cambio sale de la cola, todavía por clave.
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
    devices.splice(devices.indexOf(d), 1);
    d = await makeDevice(server, dbName, '0.500');
    devices.push(d);
    await d.engine.syncNow();
    expect(server.pages.get(page)?.settings).toEqual({ format: A4 });
    expect(server.settingsPatchCalls.at(-1)).toEqual({ id: page, keys: ['format'], merged: true });
    expect(d.tree.pendingOps()).toEqual([]);
    expect(d.tree.failedOps()).toEqual([]);
    expect(d.engine.getStatus().outdated).toBe(false);
  });

  it('con la app ya marcada como vieja, el cambio ni se manda: queda en la cola y sale cuando la mínima lo permite', async () => {
    const { server, a, page } = await twoDevices();
    await a.tree.setSetting(page, 'format', A4);
    server.settings = { ...server.settings!, minAppVersion: 9 };
    await a.engine.syncNow().catch(() => undefined);
    expect(server.pages.get(page)?.settings).toEqual({});
    expect(a.tree.pendingOps()).toHaveLength(1);
    expect(a.tree.failedOps()).toEqual([]);
    server.settings = { ...server.settings!, minAppVersion: null };
    await a.engine.syncNow();
    expect(server.pages.get(page)?.settings).toEqual({ format: A4 });
  });
});

describe('mergeSettings y settingsDelta', () => {
  it('ponen las claves que el cambio trae y sacan las que no trae, sin tocar las demás', () => {
    const current: PageSettings = { split: true, format: A4 };
    expect(mergeSettings(current, { header: { levels: 1 } }, ['header', 'format'])).toEqual({ split: true, header: { levels: 1 } });
    expect(mergeSettings(undefined, { split: false }, ['split'])).toEqual({ split: false });
    expect(current).toEqual({ split: true, format: A4 });
    expect(settingsDelta({ header: { levels: 1 }, split: true }, ['header', 'format'])).toEqual({ set: { header: { levels: 1 } }, unset: ['format'] });
    // `false` es un valor (la marca que se dejó a mano), no una clave sacada.
    expect(settingsDelta({ dayReports: false }, ['dayReports'])).toEqual({ set: { dayReports: false }, unset: [] });
  });
});

describe('SupabaseRemote.updatePage con las claves de los ajustes', () => {
  type Call = { rpc?: string; args?: unknown; update?: unknown };
  function client(answers: { rpc?: () => unknown; update?: () => unknown }) {
    const calls: Call[] = [];
    const c = {
      rpc: async (fn: string, args: unknown) => {
        calls.push({ rpc: fn, args });
        return { data: null, error: null, status: 200, ...(answers.rpc?.() as object) };
      },
      from: () => ({
        update: (patch: unknown) => ({
          eq: () => ({
            select: async () => {
              calls.push({ update: patch });
              return { data: [{ id: 'p' }], error: null, status: 200, ...(answers.update?.() as object) };
            },
          }),
        }),
      }),
    };
    return { remote: new SupabaseRemote(c as never, '9.999'), calls };
  }

  it('manda solo las claves que cambiaron a patch_page_settings, y no toca la tabla', async () => {
    const { remote, calls } = client({ rpc: () => ({ data: { format: A4, split: true } }) });
    await remote.updatePage('p', { settings: { format: A4, split: true } }, ['format']);
    await remote.updatePage('p', { settings: { split: true } }, ['format']);
    expect(calls).toEqual([
      { rpc: 'patch_page_settings', args: { p_page_id: 'p', p_set: { format: A4 }, p_unset: [] } },
      { rpc: 'patch_page_settings', args: { p_page_id: 'p', p_set: {}, p_unset: ['format'] } },
    ]);
  });

  it('sin fila tocada (la función devuelve null) es page_not_found, para siempre, como el update de siempre', async () => {
    const { remote } = client({ rpc: () => ({ data: null }) });
    await expect(remote.updatePage('p', { settings: { split: true } }, ['split'])).rejects.toMatchObject({
      message: 'page_not_found',
      permanent: true,
      code: 'P0002',
    });
  });

  it('sin la función (PGRST202) sube el objeto entero por la tabla y no vuelve a probar enseguida', async () => {
    const { remote, calls } = client({ rpc: () => ({ error: { message: 'Could not find the function', code: 'PGRST202' }, status: 404 }) });
    await remote.updatePage('p', { settings: { format: A4, split: true } }, ['format']);
    expect(calls.map((c) => c.rpc ?? 'update')).toEqual(['patch_page_settings', 'update']);
    expect(calls[1].update).toEqual({ settings: { format: A4, split: true } });
    calls.length = 0;
    await remote.updatePage('p', { settings: { split: true } }, ['format']);
    expect(calls).toEqual([{ update: { settings: { split: true } } }]);
  });

  it('sin la función vuelve a probarla a los 10 minutos, y desde que la base la tiene fusiona de nuevo', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T12:00:00Z'));
    let migrated = false;
    const { remote, calls } = client({
      rpc: () => (migrated ? { data: { split: true } } : { error: { message: 'Could not find the function', code: 'PGRST202' }, status: 404 }),
    });
    const change = () => remote.updatePage('p', { settings: { split: true } }, ['split']);
    const kinds = () => calls.splice(0).map((c) => c.rpc ?? 'update');
    await change();
    expect(kinds()).toEqual(['patch_page_settings', 'update']);
    // Aplican la migración enseguida: hasta los 10 minutos sigue por la tabla, sin preguntar.
    migrated = true;
    vi.setSystemTime(Date.now() + 10 * 60_000 - 1);
    await change();
    expect(kinds()).toEqual(['update']);
    // A los 10 minutos vuelve a probar la función y, como ya está, no toca la tabla.
    vi.setSystemTime(Date.now() + 1);
    await change();
    expect(kinds()).toEqual(['patch_page_settings']);
    await change();
    expect(kinds()).toEqual(['patch_page_settings']);
  });

  it('si a los 10 minutos la función sigue sin estar, espera otros 10 antes de volver a probar', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T12:00:00Z'));
    const { remote, calls } = client({ rpc: () => ({ error: { message: 'Could not find the function', code: 'PGRST202' }, status: 404 }) });
    const change = () => remote.updatePage('p', { settings: { split: true } }, ['split']);
    const kinds = () => calls.splice(0).map((c) => c.rpc ?? 'update');
    await change();
    expect(kinds()).toEqual(['patch_page_settings', 'update']);
    vi.setSystemTime(Date.now() + 10 * 60_000);
    await change();
    expect(kinds()).toEqual(['patch_page_settings', 'update']);
    vi.setSystemTime(Date.now() + 5 * 60_000);
    await change();
    expect(kinds()).toEqual(['update']);
  });

  it('el rechazo por versión (503, app_outdated) no es para siempre y no cae a la tabla', async () => {
    const { remote, calls } = client({ rpc: () => ({ error: { message: 'app_outdated', code: 'P0001' }, status: 503 }) });
    await expect(remote.updatePage('p', { settings: { split: true } }, ['split'])).rejects.toMatchObject({ message: 'app_outdated', permanent: false });
    expect(calls).toHaveLength(1);
  });

  it('un rechazo de la base (el tope de tamaño) llega como rechazo para siempre', async () => {
    const { remote, calls } = client({
      rpc: () => ({ error: { message: 'new row for relation "pages" violates check constraint "pages_settings_shape"', code: '23514' }, status: 400 }),
    });
    await expect(remote.updatePage('p', { settings: { split: true } }, ['split'])).rejects.toMatchObject({ permanent: true, code: '23514' });
    expect(calls).toHaveLength(1);
  });

  it('sin las claves, o con algo más que ajustes en el cambio, va por la tabla como siempre', async () => {
    const { remote, calls } = client({});
    await remote.updatePage('p', { settings: { split: true } });
    await remote.updatePage('p', { settings: { split: true } }, []);
    await remote.updatePage('p', { title: 'T', settings: { split: true } }, ['split']);
    await remote.updatePage('p', { title: 'T' }, ['split']);
    expect(calls.map((c) => c.rpc ?? 'update')).toEqual(['update', 'update', 'update', 'update']);
  });
});
