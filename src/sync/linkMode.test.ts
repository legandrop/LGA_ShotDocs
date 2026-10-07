import { afterAll, afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  cleanVisitorName,
  linkHeaders,
  linkStorageNames,
  parseLinkHash,
  publicLinkUrl,
  readLinks,
  rememberLink,
  setVisitorName,
  visitorName,
} from '../linkMode';
import { legacyStorageNames, storageNamesFor } from '../workspace';
import type { KeyValueStore } from '../workspaces';
import { linkCommentRow, linkProblemOf } from './linkRemote';
import { addPublicLink, makeLinkDevice, type LinkDevice } from './linkTesting';
import type { SupabaseRemote } from './remote';
import { FakeServer, makeDevice, type Device } from './testing';

// El link público, entrega 1 (Docs/Doc_Link_Publico.md, sección 6.2): el visitante sin cuenta con el motor de verdad
// (`SyncEngine`, `PageDocs`, IndexedDB en memoria) contra el servidor en memoria con las reglas de
// 20261012120000_link_publico.sql. Cada texto es una marca única (`<tN>`): se busca en los bytes guardados.

const TOKEN_RE = /<t\d+>/g;
const URL_ = 'https://abcdefghijklmnopqrst.supabase.co';
const KEY = 'sb_publishable_abcdefghij';
const T = 'sdl_' + 'A'.repeat(43);

function memoryStore(): KeyValueStore {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

describe('el link: dirección, lo guardado y los headers', () => {
  it('ida y vuelta, y rechaza lo que no es un link', () => {
    const url = publicLinkUrl('https://app.example/', { u: URL_, k: KEY, l: 'wanka_1', t: T });
    expect(url.startsWith('https://app.example/#link=')).toBe(true);
    expect(url).not.toContain(T);
    expect(parseLinkHash(new URL(url).hash)).toEqual({ u: URL_, k: KEY, l: 'wanka_1', t: T });
    const bad = (p: Record<string, string>) => publicLinkUrl('https://a', p as never).replace('https://a/', '');
    expect(parseLinkHash(bad({ u: URL_, k: KEY, l: 'wanka_1', t: 'sdl_corto' }))).toBeNull();
    expect(parseLinkHash(bad({ u: 'http://evil.example', k: KEY, l: 'wanka_1', t: T }))).toBeNull();
    expect(parseLinkHash(bad({ u: URL_, k: 'sb_secret_xxxxxxxxxx', l: 'wanka_1', t: T }))).toBeNull();
    expect(parseLinkHash(bad({ u: URL_, k: KEY, l: 'NO VALE', t: T }))).toBeNull();
    expect(parseLinkHash('#invite=abc')).toBeNull();
    expect(parseLinkHash('#link=%%%')).toBeNull();
  });

  it('guardar el mismo link no lo duplica; cada link tiene su id de dispositivo; el nombre se limpia', () => {
    const store = memoryStore();
    const a = rememberLink({ u: URL_, k: KEY, l: 'wanka_1', t: T }, store);
    const again = rememberLink({ u: URL_, k: KEY, l: 'wanka_1', t: T }, store);
    const b = rememberLink({ u: URL_, k: KEY, l: 'wanka_1', t: 'sdl_' + 'B'.repeat(43) }, store);
    expect(again.id).toBe(a.id);
    expect(again.device).toBe(a.device);
    expect(b.device).not.toBe(a.device);
    expect(a.device).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(readLinks(store).links).toHaveLength(2);
    expect(readLinks(store).active).toBe(b.id);
    setVisitorName(a.id, '  Ana\u202e\u0007 ', store);
    expect(visitorName(a.id, store)).toBe('Ana');
    expect(cleanVisitorName('x'.repeat(80))).toHaveLength(60);
  });

  it('el nombre no puede traer «(via link)»: la app lo pone al lado, y escrito en el nombre saldría dos veces', () => {
    expect(cleanVisitorName('Ana (via link)')).toBe('Ana');
    expect(cleanVisitorName('Ana (vía link)')).toBe('Ana');
    expect(cleanVisitorName('Ana ( VIA   Link ) Pérez')).toBe('Ana Pérez');
    expect(cleanVisitorName('(via link)(via link) Ana')).toBe('Ana');
    // Sacar uno puede dejar armado otro: tampoco queda.
    expect(cleanVisitorName('(via (via link) link) Ana')).toBe('Ana');
    expect(cleanVisitorName('(via ((via link)via link) link)')).toBe('');
    // Solo el rótulo: no queda nombre, y la app lo vuelve a pedir.
    expect(cleanVisitorName(' (via link) ')).toBe('');
    // Un nombre con paréntesis propios, o que nombra un link sin ser el rótulo, queda como está.
    expect(cleanVisitorName('Ana (cliente)')).toBe('Ana (cliente)');
    expect(cleanVisitorName('Olivia Linker')).toBe('Olivia Linker');
    // El corte de 60 se hace después de sacarlo, y un nombre ya guardado con el rótulo se lee limpio.
    expect(cleanVisitorName('x'.repeat(60) + ' (via link)')).toBe('x'.repeat(60));
    const store = memoryStore();
    const a = rememberLink({ u: URL_, k: KEY, l: 'wanka_1', t: T }, store);
    setVisitorName(a.id, 'Ana (via link)', store);
    expect(readLinks(store).links[0].name).toBe('Ana');
    const saved = readLinks(store);
    saved.links[0].name = 'Lega (via link)';
    store.setItem('shotdocs-links', JSON.stringify(saved));
    expect(visitorName(a.id, store)).toBe('Lega');
  });

  it('lo guardado del link nunca se llama como lo de una cuenta, y los headers llevan el link sin sesión', () => {
    const entry = rememberLink({ u: URL_, k: KEY, l: 'wanka_1', t: T }, memoryStore());
    const names = linkStorageNames(entry);
    const account = [legacyStorageNames('wanka_1'), storageNamesFor('wanka_1')];
    for (const other of account) {
      for (const k of ['auth', 'lastUser', 'project', 'lastPages', 'inviteTarget'] as const) expect(names[k]).not.toBe(other[k]);
      expect(names.db('u')).not.toBe(other.db('u'));
    }
    const h = linkHeaders(entry, '0.200');
    expect(h).toEqual({ 'x-shotdocs-version': '0.200', 'x-shotdocs-link': T, 'x-shotdocs-device': entry.device });
    expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain('authorization');
  });

  it('un comentario visto por el link: sin correos ni ids, los propios con el id del visitante', () => {
    const base = { id: 'c', page_id: 'p', block_id: null, thread_id: null, body: 'x', created_at: 'a', edited_at: null, resolved_at: null, deleted_at: null, updated_at: 'a' };
    expect(linkCommentRow({ ...base, author_name: 'lega', author_kind: 'team', mine: false }, 'me')).toMatchObject({ author_id: null, imported_author: 'lega', plink_author: null });
    expect(linkCommentRow({ ...base, author_name: 'Ana', author_kind: 'link', mine: false }, 'me')).toMatchObject({ author_id: null, imported_author: null, plink_author: 'Ana' });
    expect(linkCommentRow({ ...base, author_name: 'Ana', author_kind: 'link', mine: true }, 'me')).toMatchObject({ author_id: 'me', plink_author: null });
    expect(linkProblemOf(new Error('link_not_found'))).toBe('link_not_found');
    expect(linkProblemOf(new Error('link_rate_limited'))).toBe('link_rate_limited');
    expect(linkProblemOf(new Error('page_not_found'))).toBeNull();
  });
});

const devices: Device[] = [];
const visitors: LinkDevice[] = [];
const swallow = (e: unknown) => {
  if (String(e).includes('closed') || String(e).includes('InvalidStateError')) return;
  throw e;
};
process.on('unhandledRejection', swallow);
afterAll(() => {
  process.off('unhandledRejection', swallow);
});
afterEach(async () => {
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    try {
      d.db.close();
      d.mediaDb.close();
      d.commentsDb.close();
    } catch {
      // ya cerrada
    }
  }
  for (const v of visitors.splice(0)) {
    await v.engine.stop();
    try {
      v.db.close();
    } catch {
      // ya cerrada
    }
  }
});

async function stored(db: Device['db'], pageId: string): Promise<Uint8Array[]> {
  return (await db.getAllFromIndex('docUpdates', 'pageId', pageId)).map((r) => r.data);
}
function tokens(list: Uint8Array[]): Set<string> {
  const out = new Set<string>();
  for (const bytes of list) for (const m of Buffer.from(bytes).toString('latin1').match(TOKEN_RE) ?? []) out.add(m);
  return out;
}
async function edit(d: Device, pageId: string, fn: (t: Y.Text) => void): Promise<void> {
  const doc = await d.docs.open(pageId);
  doc.transact(() => fn(doc.getText('t')), 'test');
  await d.docs.flush(pageId);
  d.docs.close(pageId);
}
const add = (tok: string) => (t: Y.Text) => t.insert(t.length, `${tok} `);
const del = (tok: string) => (t: Y.Text) => {
  const i = t.toString().indexOf(`${tok} `);
  if (i >= 0) t.delete(i, tok.length + 1);
};

/** Un workspace con equipo y el interruptor prendido: el dueño tiene R › S › H, y otra raíz K. */
async function setup() {
  const server = new FakeServer();
  let clock = Date.parse('2026-10-02T10:00:00Z');
  server.now = () => clock;
  server.enableTeam();
  server.enableClean(0.1);
  const e1 = await makeDevice(server, undefined, '0.101');
  devices.push(e1);
  const r = await e1.tree.create(null, 'R');
  const s = await e1.tree.create(r, 'S');
  const h = await e1.tree.create(s, 'H');
  const k = await e1.tree.create(null, 'K');
  await e1.engine.syncNow();
  return { server, e1, r, s, h, k, tick: (ms: number) => (clock += ms) };
}

async function visitor(server: FakeServer, token: string, device?: string): Promise<LinkDevice> {
  const v = await makeLinkDevice(server, token, device);
  visitors.push(v);
  return v;
}

describe('el visitante con el motor de verdad', () => {
  it('ve solo la rama, recibe solo bases (nunca lo borrado) y baja solo lo que abre (modo liviano)', async () => {
    const { server, e1, r, s, h, k } = await setup();
    await edit(e1, s, add('<t1>'));
    await edit(e1, s, add('<t2>'));
    await e1.engine.syncNow();
    await edit(e1, s, del('<t2>'));
    await edit(e1, h, add('<t3>'));
    await e1.engine.syncNow();
    const token = addPublicLink(server, s);

    const v = await visitor(server, token);
    await v.engine.syncNow();
    // El árbol: S (sin padre) y H; nunca R ni K, ni el proyecto.
    const ids = [s, h, r, k].filter((id) => v.tree.get(id));
    expect(ids.sort()).toEqual([s, h].sort());
    expect(v.tree.get(s)?.parent_id).toBeNull();
    expect(v.tree.get(r)).toBeUndefined();
    expect(v.tree.get(k)).toBeUndefined();
    expect(v.tree.projects().map((p) => p.name)).toEqual(['S']);
    // Sin bases todavía: "en preparación", nada bajado.
    expect(await v.engine.contentGap(s)).toBe('preparing');

    // El editor arma las bases (las páginas con link tienen lectores).
    await e1.engine.syncNow();
    expect(server.cleanPushes.filter((p) => p.result === 'ok').map((p) => p.pageId).sort()).toEqual([s, h].sort());
    await v.engine.syncNow();
    // Modo liviano: nada se bajó solo.
    expect(await stored(v.db, s)).toEqual([]);
    expect(await stored(v.db, h)).toEqual([]);
    // Al abrir S, baja su base: con <t1>, nunca <t2>.
    expect(await v.engine.prefetchPage(s)).toBe(true);
    expect(tokens(await stored(v.db, s))).toEqual(new Set(['<t1>']));
    // H sigue sin bajar hasta abrirla.
    await v.engine.syncNow();
    expect(await stored(v.db, h)).toEqual([]);
    // Lo pedido fue solo plink_*, siempre con el link y el dispositivo, nunca una sesión.
    expect(v.calls.length).toBeGreaterThan(0);
    for (const c of v.calls) {
      expect(c.fn.startsWith('plink_')).toBe(true);
      expect(c.headers['x-shotdocs-link']).toBe(token);
      expect(Object.keys(c.headers).map((x) => x.toLowerCase())).not.toContain('authorization');
    }
    // Lo nuevo del editor en una página ya bajada llega en el ciclo (cuando hay base nueva).
    await edit(e1, s, add('<t4>'));
    await e1.engine.syncNow();
    await e1.engine.prepareBases([s]);
    await v.engine.syncNow();
    expect(tokens(await stored(v.db, s))).toEqual(new Set(['<t1>', '<t4>']));
  });

  it('comenta con su nombre (sin nombre, espera en la cola); el equipo lo ve como "via link"; solo edita los suyos', async () => {
    const { server, e1, s } = await setup();
    server.enableComments();
    await e1.engine.syncNow();
    const token = addPublicLink(server, s);
    const v = await visitor(server, token, 'dev-uno-xxxxxxxxxxxxxxxx');
    await v.engine.syncNow();
    const id = await v.comments.add(s, null, 'hola');
    await v.engine.syncNow();
    // Sin nombre no sube: queda en el dispositivo.
    expect(server.comments.has(id)).toBe(false);
    expect(v.comments.threads(s).length).toBe(1);
    v.name.value = 'Ana';
    await v.comments.run(() => false);
    expect((server.comments.get(id) as { plink_author?: string }).plink_author).toBe('Ana');
    expect(server.comments.get(id)?.author_id).toBeNull();
    // El equipo: con el nombre del link.
    await e1.comments.watch(s);
    await e1.engine.syncNow();
    await e1.comments.run(() => false);
    const seen = e1.comments.threads(s)[0]?.root;
    expect(seen?.linkAuthor ?? null).toBe('Ana');
    // Otro dispositivo con el mismo link: no es suyo, no lo edita.
    const w = await visitor(server, token, 'dev-dos-xxxxxxxxxxxxxxxx');
    w.name.value = 'Beto';
    await w.engine.syncNow();
    w.comments.watch(s);
    await w.comments.run(() => false);
    const other = w.comments.threads(s)[0]?.root;
    expect(other?.authorId).toBeNull();
    expect(other?.linkAuthor).toBe('Ana');
    // El dueño del comentario sí lo edita.
    await v.comments.edit(s, id, 'hola editado');
    await v.comments.run(() => false);
    expect(server.comments.get(id)?.body).toBe('hola editado');
  });

  it('revocar corta en el próximo ciclo (sin borrar lo del dispositivo); nada se escribe nunca en el árbol ni el contenido', async () => {
    const { server, e1, s } = await setup();
    await edit(e1, s, add('<t1>'));
    await e1.engine.syncNow();
    const token = addPublicLink(server, s);
    await e1.engine.syncNow();
    const v = await visitor(server, token);
    await v.engine.syncNow();
    await v.engine.prefetchPage(s);
    const before = await stored(v.db, s);
    expect(tokens(before)).toEqual(new Set(['<t1>']));
    // El visitante no puede crear ni editar: la app no le ofrece nada y su cola queda vacía.
    expect(v.tree.pendingOps()).toEqual([]);
    expect(await v.docs.unsyncedPages()).toEqual([]);
    const updatesBefore = server.updates.get(s)?.length;
    server.publicLinks.get(token)!.revoked = true;
    await v.engine.syncNow();
    expect(v.problems).toContain('link_not_found');
    expect(await stored(v.db, s)).toEqual(before);
    expect(server.updates.get(s)?.length).toBe(updatesBefore);
  });

  it('un link no archiva, borra, restaura ni borra para siempre un proyecto: el pedido ni sale', async () => {
    const { server, e1, s } = await setup();
    const token = addPublicLink(server, s);
    const v = await visitor(server, token);
    await v.engine.syncNow();
    const project = e1.tree.workspaceId;
    const sent = v.calls.length;
    // Como lo llama la app: por el tipo común, que es el que recibe el proyecto.
    const remote: SupabaseRemote = v.remote;
    await expect(remote.setProjectArchived(project, true)).rejects.toThrow('link_read_only');
    await expect(remote.deleteProject(project)).rejects.toThrow('link_read_only');
    await expect(remote.restoreProject(project)).rejects.toThrow('link_read_only');
    await expect(remote.purgeProject(project)).rejects.toThrow('link_read_only');
    expect(v.calls.length).toBe(sent);
  });

  it('quien creó el link deja de poder compartir (pasa a invitado): el link se apaga', async () => {
    const { server, e1, s } = await setup();
    server.addMember('ad', 'admin');
    server.grant('ad', { pageId: s }, 'edit_pages');
    await e1.engine.syncNow();
    const token = addPublicLink(server, s, 'ad');
    const v = await visitor(server, token);
    await v.engine.syncNow();
    expect(v.problems.at(-1) ?? null).toBeNull();
    server.members.get('ad')!.role = 'guest';
    await v.engine.syncNow();
    expect(v.problems).toContain('link_not_found');
  });
});
