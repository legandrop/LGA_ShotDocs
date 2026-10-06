import { createClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it } from 'vitest';
import { SupabaseCommentRemote } from './commentsRemote';
import { SupabaseRemote, toRemoteError } from './remote';
import { FakeServer, makeDevice, type Device } from './testing';
import { isNetworkError, isPermanent, RemoteError } from './types';

// Cómo llega a la app un "no existe" de una función de la base. Las funciones lo levantan con `errcode = 'P0002'`
// (`page_not_found`, `file_not_found`, `comment_not_found`, `link_not_found`…) y PostgREST le pone estado 500 (da 400
// solo al `P0001`). Con el estado solo, la app lo tomaba como una falla pasajera: reintentaba para siempre algo
// definitivo y cortaba la vuelta de sincronización en esa página.

const devices: Device[] = [];
afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
    d.mediaDb.close();
  }
});

/** El cuerpo y el estado con que PostgREST entrega un `raise exception '<mensaje>' using errcode = 'P0002'`. */
const notFound = (message: string) => ({ error: { message, code: 'P0002', details: null, hint: null }, status: 500 });

describe('toRemoteError: el código P0002', () => {
  it('es definitivo aunque PostgREST lo mande con estado 500, y conserva el mensaje de la función', () => {
    for (const message of ['page_not_found', 'file_not_found', 'comment_not_found', 'link_not_found', 'version_not_found']) {
      const { error, status } = notFound(message);
      const err = toRemoteError(error, status);
      expect(err).toBeInstanceOf(RemoteError);
      expect(err.message).toBe(message);
      expect(err.code).toBe('P0002');
      expect(isPermanent(err)).toBe(true);
      expect(isNetworkError(err)).toBe(false);
    }
    // Con cualquier estado: lo que manda es el código.
    expect(isPermanent(toRemoteError({ message: 'page_not_found', code: 'P0002' }, 404))).toBe(true);
    expect(isPermanent(toRemoteError({ message: 'page_not_found', code: 'P0002', status: 500 }))).toBe(true);
  });

  it('un 500 sin ese código sigue siendo pasajero', () => {
    // Otra falla de PL/pgSQL, una interna de Postgres, un 500 sin código, y los estados que ya se reintentaban.
    expect(isPermanent(toRemoteError({ message: 'query returned more than one row', code: 'P0003' }, 500))).toBe(false);
    expect(isPermanent(toRemoteError({ message: 'internal error', code: 'XX000' }, 500))).toBe(false);
    expect(isPermanent(toRemoteError({ message: 'Internal Server Error' }, 500))).toBe(false);
    expect(isPermanent(toRemoteError({ message: 'upstream', code: '57014' }, 504))).toBe(false);
    expect(isPermanent(toRemoteError(null, 502))).toBe(false);
    // El rechazo por versión (503, `P0001`) también: se reintenta al actualizar.
    expect(isPermanent(toRemoteError({ message: 'app_outdated', code: 'P0001' }, 503))).toBe(false);
    // Sin red no es un rechazo, y los rechazos de siempre siguen siéndolo.
    const offline = toRemoteError({ message: 'Failed to fetch' }, 0);
    expect(isPermanent(offline)).toBe(false);
    expect(isNetworkError(offline)).toBe(true);
    expect(isPermanent(toRemoteError({ message: 'not_allowed', code: '42501' }, 403))).toBe(true);
    expect(isPermanent(toRemoteError({ message: 'label_invalid', code: '22023' }, 400))).toBe(true);
  });
});

describe('el cliente de la base con la respuesta de PostgREST', () => {
  /** Un cliente de Supabase de verdad cuya base contesta siempre lo mismo. */
  function clientAnswering(status: number, body: unknown) {
    return createClient('https://base.test', 'clave-publica', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }) },
    });
  }

  it('subir contenido, bajarlo y comentar en una página que la sesión ya no ve: rechazo definitivo', async () => {
    const body = { code: 'P0002', message: 'page_not_found', details: null, hint: null };
    const remote = new SupabaseRemote(clientAnswering(500, body), '9.999');
    const comments = new SupabaseCommentRemote(clientAnswering(500, body));
    const page = crypto.randomUUID();
    for (const call of [
      () => remote.pushUpdate(page, crypto.randomUUID(), new Uint8Array([1])),
      () => remote.pullUpdates(page, 0, 10),
      () => comments.addComment({ id: crypto.randomUUID(), pageId: page, blockId: null, threadId: null, body: 'x' }),
      () => comments.fetchCommentAuthors(page),
    ]) {
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RemoteError);
      expect((err as RemoteError).message).toBe('page_not_found');
      expect(isPermanent(err)).toBe(true);
    }
  });

  it('una falla de la base (500 con otro código) sigue reintentándose', async () => {
    const remote = new SupabaseRemote(clientAnswering(500, { code: 'XX000', message: 'internal error', details: null, hint: null }), '9.999');
    const err = await remote.pushUpdate(crypto.randomUUID(), crypto.randomUUID(), new Uint8Array([1])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RemoteError);
    expect(isPermanent(err)).toBe(false);
  });
});

describe('la sincronización con una página que la base ya no deja escribir', () => {
  it('esa página queda rechazada y las demás suben en la misma vuelta', async () => {
    const server = new FakeServer();
    const d = await makeDevice(server);
    devices.push(d);
    const lost = await d.tree.create(null, 'Sin permiso');
    const kept = await d.tree.create(null, 'Con permiso');
    await d.engine.syncNow();

    // La base contesta por `lost` lo que contesta `push_page_update` cuando la sesión perdió el permiso, tal como lo
    // entrega PostgREST; lo demás, como siempre.
    const push = d.remote.pushUpdate.bind(d.remote);
    d.remote.pushUpdate = async (pageId, clientUpdateId, update) => {
      if (pageId === lost) {
        const { error, status } = notFound('page_not_found');
        throw toRemoteError(error, status);
      }
      return push(pageId, clientUpdateId, update);
    };
    for (const pageId of [lost, kept]) {
      const doc = await d.docs.open(pageId);
      doc.getText('t').insert(0, 'texto');
      await d.docs.flush(pageId);
      d.docs.close(pageId);
    }

    await d.engine.syncNow();
    expect(server.updates.get(kept) ?? []).toHaveLength(1);
    expect(server.updates.get(lost) ?? []).toHaveLength(0);
    expect((await d.docs.states()).get(lost)?.rejected).toBe('page_not_found');
    expect(d.engine.getStatus().rejectedPages).toBe(1);
    // Lo escrito sigue en el dispositivo.
    expect(await d.docs.unsyncedPages()).toContain(lost);
  });
});
