import { createClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommentRow } from './comments';
import { SupabaseCommentRemote } from './commentsRemote';
import { getPublicLinkLabels, LINK_LABELS_MAX } from './publicLinks';
import { FakeServer, makeDevice, type Device } from './testing';

// De qué link vino un comentario (Docs/Doc_Link_Publico.md, "De qué link vino cada comentario"): el id del link viaja
// con la fila (`plink_id`), queda guardado en el dispositivo tal como llega y sale en la vista (`linkId`); lo guardado
// por una versión anterior se sigue leyendo. Y los dos pedidos a la base: la vista de compatibilidad con las columnas
// del link (o sin ellas, si la base no las tiene) y `public_link_labels`.

const LINK = '00000000-0000-4000-8000-0000000000c1';

const devices: Device[] = [];
afterEach(async () => {
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.mentions.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
});

function linkComment(pageId: string, id: string, over: Partial<Omit<CommentRow, 'body'>> = {}): CommentRow & { body: string; updated_at: string } {
  const at = new Date().toISOString();
  return {
    id, page_id: pageId, block_id: null, thread_id: null, body: 'Hola desde el link', author_id: null, created_at: at, updated_at: at,
    edited_at: null, resolved_at: null, resolved_by: null, deleted_at: null, deleted_by: null, plink_author: 'Ana', plink_id: LINK, ...over,
  };
}

async function setup() {
  const server = new FakeServer();
  server.enableMentions();
  const dbName = crypto.randomUUID();
  const d = await makeDevice(server, dbName);
  devices.push(d);
  const page = await d.tree.create(null, 'Brief');
  await d.engine.syncNow();
  return { server, d, page, dbName };
}

describe('el id del link de un comentario', () => {
  it('viaja con la fila, queda guardado en el dispositivo y llega a la vista; sin red se lee de lo guardado', async () => {
    const { server, d, page, dbName } = await setup();
    server.comments.set('c1', linkComment(page, 'c1'));
    d.comments.watch(page);
    await d.engine.syncNow();
    const root = d.comments.threads(page)[0].root;
    expect(root).toMatchObject({ linkAuthor: 'Ana', linkId: LINK });
    // Lo guardado: la fila como llegó, con el id del link (nada del token: la base no lo manda).
    expect(await d.commentsDb.get('comments', 'c1')).toMatchObject({ plink_author: 'Ana', plink_id: LINK });

    // Otra sesión en el mismo dispositivo, sin red: el comentario sale de lo guardado, con su link.
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
    devices.length = 0;
    server.online = false;
    const again = await makeDevice(server, dbName);
    devices.push(again);
    again.comments.watch(page);
    await again.engine.syncNow().catch(() => undefined);
    await new Promise((r) => setTimeout(r, 30));
    expect(again.comments.threads(page)[0].root).toMatchObject({ body: 'Hola desde el link', linkAuthor: 'Ana', linkId: LINK });
  });

  it('una fila guardada por una versión anterior (sin el id) se sigue leyendo igual, y la bajada siguiente no la pierde', async () => {
    const { server, d, page } = await setup();
    // Como la guardó una versión que no conocía el campo, y con algo que esta versión tampoco conoce.
    const old = { ...linkComment(page, 'c1'), campo_futuro: 'x' } as CommentRow & { plink_id?: string; updated_at?: string };
    delete old.plink_id;
    delete old.updated_at;
    await d.commentsDb.put('comments', old);
    server.online = false;
    d.comments.watch(page);
    await new Promise((r) => setTimeout(r, 30));
    expect(d.comments.threads(page)[0].root).toMatchObject({ body: 'Hola desde el link', linkAuthor: 'Ana', linkId: null });
    // Leerla no la toca: sigue como estaba, con lo que esta versión no conoce.
    expect(await d.commentsDb.get('comments', 'c1')).toEqual(old);

    // Vuelve la red y la base lo trae con su link: la fila se completa.
    server.online = true;
    server.comments.set('c1', linkComment(page, 'c1'));
    await d.engine.syncNow();
    expect(d.comments.threads(page)[0].root).toMatchObject({ linkAuthor: 'Ana', linkId: LINK });
    expect(await d.commentsDb.get('comments', 'c1')).toMatchObject({ body: 'Hola desde el link', plink_id: LINK });
  });

  it('solo un comentario de un link lo lleva: uno del equipo, o un id sin el nombre, no', async () => {
    const { server, d, page } = await setup();
    server.comments.set('c1', linkComment(page, 'c1', { author_id: d.remote.userId, plink_author: null, plink_id: null }));
    server.comments.set('c2', linkComment(page, 'c2', { plink_author: null }));
    server.comments.set('c3', linkComment(page, 'c3', { plink_id: 7 as never }));
    d.comments.watch(page);
    await d.engine.syncNow();
    const byId = new Map(d.comments.threads(page).map((t) => [t.id, t.root]));
    expect(byId.get('c1')?.linkId).toBeNull();
    expect(byId.get('c2')?.linkId).toBeNull();
    expect(byId.get('c3')).toMatchObject({ linkAuthor: 'Ana', linkId: null });
  });
});

/** Un cliente de Supabase de verdad con una base que contesta lo que diga `answer` (recibe la dirección del pedido). */
function clientWith(answer: (url: URL, body: unknown) => { status: number; body: unknown }) {
  const urls: URL[] = [];
  const client = createClient('https://base.test', 'clave-publica', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input instanceof Request ? input.url : input));
        urls.push(url);
        const res = answer(url, typeof init?.body === 'string' ? JSON.parse(init.body) : null);
        return new Response(JSON.stringify(res.body), { status: res.status, headers: { 'content-type': 'application/json' } });
      },
    },
  });
  return { client, urls };
}

describe('la vista de compatibilidad de los comentarios', () => {
  it('pide también quién escribió con un link, y lo entrega', async () => {
    const row = { id: 'c1', page_id: 'p', plink_id: LINK, plink_author: 'Ana' };
    const { client, urls } = clientWith(() => ({ status: 200, body: [row] }));
    const remote = new SupabaseCommentRemote(client);
    expect(await remote.fetchComments('p')).toEqual([row]);
    expect(urls).toHaveLength(1);
    expect(urls[0].searchParams.get('select')?.replace(/\s/g, '')).toMatch(/,deleted_by,plink_id,plink_author$/);
  });

  it('con una base cuya vista no tiene esas columnas, lee sin ellas y no las vuelve a pedir', async () => {
    const { client, urls } = clientWith((url) =>
      url.searchParams.get('select')?.includes('plink_id')
        ? { status: 400, body: { code: '42703', message: 'column comments_view.plink_id does not exist', details: null, hint: null } }
        : { status: 200, body: [{ id: 'c1', page_id: 'p' }] });
    const remote = new SupabaseCommentRemote(client);
    expect(await remote.fetchComments('p')).toEqual([{ id: 'c1', page_id: 'p' }]);
    expect(urls.map((u) => u.searchParams.get('select')?.includes('plink_id'))).toEqual([true, false]);
    expect(await remote.fetchComments('p')).toEqual([{ id: 'c1', page_id: 'p' }]);
    expect(urls.map((u) => u.searchParams.get('select')?.includes('plink_id'))).toEqual([true, false, false]);
  });

  it('otro error no se traga: sigue saliendo como siempre', async () => {
    const { client, urls } = clientWith(() => ({ status: 403, body: { code: '42501', message: 'permission denied for view comments_view', details: null, hint: null } }));
    const remote = new SupabaseCommentRemote(client);
    await expect(remote.fetchComments('p')).rejects.toMatchObject({ message: 'permission denied for view comments_view', code: '42501' });
    expect(urls).toHaveLength(1);
  });
});

describe('public_link_labels desde la app', () => {
  const answerRows = (rows: unknown[]) => clientWith(() => ({ status: 200, body: rows }));

  it('devuelve el rótulo de cada link que la base contesta, y nada de lo demás', async () => {
    const { client } = answerRows([
      { id: 'a', level: 'comment', created_by_name: 'lega', revoked: false, expired: false, alive: true },
      { id: 'b', level: 'edit', created_by_name: null, revoked: true, expired: true, alive: false, token: 'sdl_x' },
      // Una fila a medias: lo que no dice no se da por bueno (no anda hasta que la base diga que anda).
      { id: 'e', level: 'comment' },
      { id: 7, level: 'edit' },
      { id: 'd' },
      null,
    ]);
    const labels = await getPublicLinkLabels(client, ['a', 'b', 'c']);
    expect([...labels!.entries()]).toEqual([
      ['a', { level: 'comment', createdBy: 'lega', revoked: false, expired: false, alive: true }],
      ['b', { level: 'edit', createdBy: null, revoked: true, expired: true, alive: false }],
      ['e', { level: 'comment', createdBy: null, revoked: false, expired: false, alive: false }],
    ]);
    expect(JSON.stringify([...labels!])).not.toContain('sdl_');
  });

  it('manda los ids de a 200 por pedido, y sin ids no pide nada', async () => {
    const sent: number[] = [];
    const { client, urls } = clientWith((_url, body) => {
      sent.push((body as { p_ids: string[] }).p_ids.length);
      return { status: 200, body: [] };
    });
    await getPublicLinkLabels(client, Array.from({ length: LINK_LABELS_MAX * 2 + 5 }, (_, i) => `id${i}`));
    expect(sent).toEqual([LINK_LABELS_MAX, LINK_LABELS_MAX, 5]);
    expect(urls.every((u) => u.pathname.endsWith('/rpc/public_link_labels'))).toBe(true);
    urls.length = 0;
    expect((await getPublicLinkLabels(client, []))?.size).toBe(0);
    expect(urls).toHaveLength(0);
  });

  it('con una base sin la función (PGRST202) contesta null; otro error sale', async () => {
    const missing = clientWith(() => ({ status: 404, body: { code: 'PGRST202', message: 'Could not find the function public.public_link_labels(p_ids) in the schema cache', details: null, hint: null } }));
    expect(await getPublicLinkLabels(missing.client, ['a'])).toBeNull();
    const broken = clientWith(() => ({ status: 400, body: { code: '22023', message: 'ids_invalid', details: null, hint: null } }));
    await expect(getPublicLinkLabels(broken.client, ['a'])).rejects.toMatchObject({ message: 'ids_invalid' });
  });
});
