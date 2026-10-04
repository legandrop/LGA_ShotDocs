import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  accessRequestsEnabled,
  AccessRequestsInbox,
  askedAt,
  askedScope,
  parseAccessRequest,
  rememberAsked,
  requestAccess,
  requestPageAccess,
  supabaseAccessRequests,
  type AccessRequest,
  type AccessRequestsRemote,
} from './accessRequests';
import { RemoteError } from './types';

// *Request access* del lado de la app (P.30, entrega 2; Docs/Doc_Links_PDF.md, 5.2 y 5.3): cómo se leen las filas, qué se
// le manda a la base al decidir (rechazar nunca lleva página, LF20), la lista de quien decide y lo que recuerda el
// dispositivo de quien pide.

const ROW = {
  id: 'r1',
  user_id: 'u1',
  email: 'ana@example.com',
  role: 'guest',
  file_id: 'f1',
  file_name: 'plano.pdf',
  mime: 'application/pdf',
  asked_at: '2026-10-03T12:00:00Z',
  times: 2,
  pages: [
    { page_id: 'p1', title: 'Escena 12' },
    { page_id: 'p2', title: 'Reporte' },
  ],
};

function req(id: string, pages = ['p1']): AccessRequest {
  return { id, userId: `u-${id}`, email: `${id}@x.com`, role: 'member', fileId: `f-${id}`, targetPageId: null, fileName: `${id}.pdf`, mime: 'application/pdf', askedAt: '2026-10-03T12:00:00Z', times: 1, pages: pages.map((p) => ({ pageId: p, title: p })) };
}

function fakeClient(answer: (fn: string, args: Record<string, unknown>) => { data?: unknown; error?: unknown }) {
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => ({ data: null, error: null, status: 200, ...answer(fn, args) }));
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe('cuándo se pregunta la lista', () => {
  it('con la base en la 22 y un rol que comparte; nunca a un invitado, a quien sacaron o con la base vieja', () => {
    expect(accessRequestsEnabled(22, 'owner')).toBe(true);
    expect(accessRequestsEnabled(23, 'admin')).toBe(true);
    expect(accessRequestsEnabled(22, 'member')).toBe(true);
    expect(accessRequestsEnabled(22, 'guest')).toBe(false);
    expect(accessRequestsEnabled(22, null)).toBe(false);
    expect(accessRequestsEnabled(21, 'owner')).toBe(false);
    expect(accessRequestsEnabled(null, 'owner')).toBe(false);
  });
});

describe('las filas y la base', () => {
  it('una fila se lee entera; sin páginas, sin rol válido o sin ids, no', () => {
    expect(parseAccessRequest(ROW)).toEqual({
      id: 'r1',
      userId: 'u1',
      email: 'ana@example.com',
      role: 'guest',
      fileId: 'f1',
      targetPageId: null,
      fileName: 'plano.pdf',
      mime: 'application/pdf',
      askedAt: '2026-10-03T12:00:00Z',
      times: 2,
      pages: [
        { pageId: 'p1', title: 'Escena 12' },
        { pageId: 'p2', title: 'Reporte' },
      ],
    });
    expect(parseAccessRequest({ ...ROW, pages: [] })).toBeNull();
    expect(parseAccessRequest({ ...ROW, pages: null })).toBeNull();
    expect(parseAccessRequest({ ...ROW, role: 'superuser' })).toBeNull();
    expect(parseAccessRequest({ ...ROW, id: null })).toBeNull();
    expect(parseAccessRequest({ ...ROW, pages: [{ title: 'sin id' }, { page_id: 'p9', title: null }] })?.pages).toEqual([{ pageId: 'p9', title: '' }]);
  });

  it('entrega 3: una página pedida trae su sola página; un archivo y una página a la vez, ninguno, u otra página, no', () => {
    const PAGE = { ...ROW, id: 'r3', file_id: null, file_name: null, mime: null, target_page_id: 'p1', pages: [{ page_id: 'p1', title: 'Escena 12' }] };
    expect(parseAccessRequest(PAGE)).toMatchObject({ id: 'r3', fileId: null, targetPageId: 'p1', fileName: '', pages: [{ pageId: 'p1', title: 'Escena 12' }] });
    // La app publicada (sin `target_page_id`) descartaba las filas sin archivo: la nueva también descarta las rotas.
    expect(parseAccessRequest({ ...PAGE, file_id: 'f1' })).toBeNull();
    expect(parseAccessRequest({ ...PAGE, target_page_id: null })).toBeNull();
    expect(parseAccessRequest({ ...PAGE, pages: [{ page_id: 'p2', title: 'Otra' }] })).toBeNull();
    expect(parseAccessRequest({ ...PAGE, pages: [{ page_id: 'p1', title: 'A' }, { page_id: 'p2', title: 'B' }] })).toBeNull();
    // Una fila de archivo con la columna nueva en nulo, como la manda la 24.
    expect(parseAccessRequest({ ...ROW, target_page_id: null })?.fileId).toBe('f1');
  });

  it('entrega 3: pedir una página va a request_page_access; el tope se tira igual', async () => {
    const { client, rpc } = fakeClient((_fn, args) => ({ data: args.p_page === 'mine' ? 'has_access' : 'sent' }));
    expect(await requestPageAccess(client, 'p1')).toBe('sent');
    expect(await requestPageAccess(client, 'mine')).toBe('has_access');
    expect(rpc).toHaveBeenCalledWith('request_page_access', { p_page: 'p1' });
    expect(rpc).not.toHaveBeenCalledWith('request_access', expect.anything());
    const limited = fakeClient(() => ({ data: null, error: { message: 'rate_limited', code: 'P0001' } }));
    await expect(requestPageAccess(limited.client, 'p1')).rejects.toThrow('rate_limited');
  });

  it('entrega 3: lo que recuerda el dispositivo de una página no se mezcla con un archivo del mismo id', () => {
    const store = new Map<string, string>();
    const fake = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    rememberAsked('w.u', { kind: 'page', id: 'x1' }, new Date('2026-10-03T12:00:00Z'), fake);
    expect(askedAt('w.u', { kind: 'page', id: 'x1' }, fake)).toBe('2026-10-03T12:00:00.000Z');
    expect(askedAt('w.u', { kind: 'file', id: 'x1' }, fake)).toBeNull();
    expect(askedAt('w.u', 'x1', fake)).toBeNull();
    // Un archivo se guarda como en la entrega 2 (por su id), así lo anotado antes se sigue leyendo.
    rememberAsked('w.u', 'f9', new Date('2026-10-02T12:00:00Z'), fake);
    expect(askedAt('w.u', { kind: 'file', id: 'f9' }, fake)).toBe('2026-10-02T12:00:00.000Z');
  });

  it('pedir: sent o has_access; un error de la base se tira con su mensaje', async () => {
    const { client, rpc } = fakeClient((_fn, args) => ({ data: args.p_file === 'mine' ? 'has_access' : 'sent' }));
    expect(await requestAccess(client, 'f1')).toBe('sent');
    expect(await requestAccess(client, 'mine')).toBe('has_access');
    expect(rpc).toHaveBeenCalledWith('request_access', { p_file: 'f1' });
    const limited = fakeClient(() => ({ data: null, error: { message: 'rate_limited', code: 'P0001' } }));
    await expect(requestAccess(limited.client, 'f1')).rejects.toThrow('rate_limited');
  });

  it('decidir: aceptar lleva página y nivel; rechazar es explícito y nunca lleva página (LF20)', async () => {
    const { client, rpc } = fakeClient((_fn, args) => ({ data: args.p_accept ? 'accepted' : 'declined' }));
    const remote = supabaseAccessRequests(client);
    expect(await remote.decide('r1', true, 'p2', 'comment')).toBe('accepted');
    expect(rpc).toHaveBeenLastCalledWith('decide_access_request', { p_id: 'r1', p_accept: true, p_page: 'p2', p_level: 'comment' });
    expect(await remote.decide('r1', false, 'p2', 'view')).toBe('declined');
    expect(rpc).toHaveBeenLastCalledWith('decide_access_request', { p_id: 'r1', p_accept: false, p_page: null, p_level: 'view' });
    await expect(remote.decide('r1', true, 'p2', 'owner' as never)).rejects.toThrow('level_invalid');
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('la lista descarta lo que no tiene forma', async () => {
    const { client, rpc } = fakeClient(() => ({ data: [ROW, { ...ROW, id: 'r2', pages: [] }, { nada: 1 }] }));
    const list = await supabaseAccessRequests(client).pending();
    expect(list.map((r) => r.id)).toEqual(['r1']);
    expect(rpc).toHaveBeenCalledWith('access_requests_pending', {});
  });
});

describe('AccessRequestsInbox', () => {
  function remote(items: AccessRequest[] = [req('a'), req('b')]) {
    const state = { items, fail: null as unknown };
    const r: AccessRequestsRemote & { pending: ReturnType<typeof vi.fn>; decide: ReturnType<typeof vi.fn> } = {
      pending: vi.fn(async () => {
        if (state.fail) throw state.fail;
        return state.items;
      }),
      decide: vi.fn(async (id: string, accept: boolean) => {
        if (state.fail) throw state.fail;
        state.items = state.items.filter((x) => x.id !== id);
        return accept ? ('accepted' as const) : ('declined' as const);
      }),
    };
    return { r, state };
  }

  it('apagada no pregunta; al prenderse pregunta ya; al apagarse, vacía', async () => {
    const { r } = remote();
    const inbox = new AccessRequestsInbox(r);
    await inbox.poll();
    expect(r.pending).not.toHaveBeenCalled();
    expect(inbox.getSnapshot()).toEqual({ ready: false, items: [] });
    const seen = vi.fn();
    inbox.subscribe(seen);
    inbox.setEnabled(true);
    await inbox.poll();
    expect(inbox.getSnapshot().ready).toBe(true);
    expect(inbox.getSnapshot().items.map((x) => x.id)).toEqual(['a', 'b']);
    expect(seen).toHaveBeenCalled();
    inbox.setEnabled(false);
    expect(inbox.getSnapshot()).toEqual({ ready: false, items: [] });
  });

  it('sin red no pregunta; un error deja lo último', async () => {
    const { r, state } = remote();
    let online = false;
    const inbox = new AccessRequestsInbox(r, { online: () => online });
    inbox.setEnabled(true);
    await inbox.poll();
    expect(r.pending).not.toHaveBeenCalled();
    online = true;
    await inbox.poll();
    expect(inbox.getSnapshot().items).toHaveLength(2);
    state.fail = new RemoteError('boom', false, undefined, true);
    await inbox.poll();
    expect(inbox.getSnapshot().items).toHaveLength(2);
  });

  it('decidir saca el pedido enseguida y vuelve a preguntar; ya decidido por otro, también lo saca', async () => {
    const { r, state } = remote();
    const inbox = new AccessRequestsInbox(r);
    inbox.setEnabled(true);
    await inbox.poll();
    // La lista vieja todavía lo trae: igual sale de la vista apenas se decide.
    r.pending.mockImplementationOnce(async () => new Promise(() => undefined));
    expect(await inbox.decide('a', true, 'p1', 'view')).toBe('accepted');
    expect(r.decide).toHaveBeenCalledWith('a', true, 'p1', 'view');
    expect(inbox.getSnapshot().items.map((x) => x.id)).toEqual(['b']);
    state.fail = new RemoteError('request_not_found', true, 'P0002');
    await expect(inbox.decide('b', false, null, 'view')).rejects.toThrow('request_not_found');
    expect(inbox.getSnapshot().items).toEqual([]);
  });

  it('un error que no es "ya decidido" deja el pedido en la lista', async () => {
    const { r, state } = remote();
    const inbox = new AccessRequestsInbox(r);
    inbox.setEnabled(true);
    await inbox.poll();
    state.fail = new RemoteError('page_invalid', true, '22023');
    await expect(inbox.decide('a', true, 'p9', 'view')).rejects.toThrow('page_invalid');
    expect(inbox.getSnapshot().items.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('dos preguntas a la vez: una sola en curso y otra al terminar', async () => {
    const { r } = remote();
    const inbox = new AccessRequestsInbox(r);
    inbox.setEnabled(true);
    await inbox.poll();
    r.pending.mockClear();
    const a = inbox.poll();
    const b = inbox.poll();
    await Promise.all([a, b]);
    expect(r.pending).toHaveBeenCalledTimes(2);
  });

  it('parada: no vuelve a prenderse', async () => {
    const { r } = remote();
    const inbox = new AccessRequestsInbox(r);
    inbox.stop();
    inbox.setEnabled(true);
    await inbox.poll();
    expect(r.pending).not.toHaveBeenCalled();
  });
});

describe('cuándo pidió (el dispositivo de quien pide)', () => {
  function memory() {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
  }

  it('se anota por workspace y archivo; lo roto no cuenta', () => {
    const store = memory();
    expect(askedAt('wanka_1', 'f1', store)).toBeNull();
    rememberAsked('wanka_1', 'f1', new Date('2026-10-03T10:00:00Z'), store);
    expect(askedAt('wanka_1', 'f1', store)).toBe('2026-10-03T10:00:00.000Z');
    expect(askedAt('otro_ws', 'f1', store)).toBeNull();
    store.setItem('shotdocs.accessAsked.roto', '{no es json');
    expect(askedAt('roto', 'f1', store)).toBeNull();
    rememberAsked('roto', 'f1', new Date('2026-10-04T10:00:00Z'), store);
    expect(askedAt('roto', 'f1', store)).toBe('2026-10-04T10:00:00.000Z');
  });

  it('guarda los últimos 200 y pedir de nuevo lo pasa al final', () => {
    const store = memory();
    for (let i = 0; i < 205; i++) rememberAsked('w', `f${i}`, new Date(Date.UTC(2026, 9, 3, 0, 0, i)), store);
    expect(askedAt('w', 'f0', store)).toBeNull();
    expect(askedAt('w', 'f5', store)).not.toBeNull();
    rememberAsked('w', 'f5', new Date('2026-10-05T00:00:00Z'), store);
    for (let i = 205; i < 404; i++) rememberAsked('w', `f${i}`, new Date(Date.UTC(2026, 9, 3, 0, 0, i)), store);
    expect(askedAt('w', 'f5', store)).toBe('2026-10-05T00:00:00.000Z');
    expect(Object.keys(JSON.parse(store.data.get('shotdocs.accessAsked.w')!))).toHaveLength(200);
  });

  it('por persona: otra cuenta del mismo workspace en el mismo dispositivo no lo ve (O4)', () => {
    const store = memory();
    rememberAsked(askedScope('wanka_1', 'ana'), 'f1', new Date('2026-10-03T10:00:00Z'), store);
    expect(askedAt(askedScope('wanka_1', 'ana'), 'f1', store)).toBe('2026-10-03T10:00:00.000Z');
    expect(askedAt(askedScope('wanka_1', 'beto'), 'f1', store)).toBeNull();
    expect(askedAt(askedScope('otro_ws', 'ana'), 'f1', store)).toBeNull();
  });

  it('sin almacenamiento, no tira', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(askedAt('w', 'f', broken)).toBeNull();
    expect(() => rememberAsked('w', 'f', new Date(), broken)).not.toThrow();
  });
});
