import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { FileRejected } from './files';
import { block, group } from './historyTesting';
import { LINK_FILE_MAX_BYTES } from './linkRemote';
import { addPublicLink, fakeLinkClient, makeLinkDevice, resetPublicLink, type LinkDevice } from './linkTesting';
import { FakeServer, makeDevice, type Device } from './testing';
import { RemoteError } from './types';

// El link público con *Can edit*, entrega 2b (Docs/Doc_Link_Publico.md, E2.4, E2.5, E2.7, E2.12, E2.14): el visitante sube
// fotos y archivos al Drive del dueño con la cola de siempre, sobre el servidor en memoria con las reglas de
// 20261030120000_link_archivos.sql y el portero en memoria con las de portero/src/core.ts. Lo escrito de una página espera
// mientras muestre un archivo propio sin registrar (si no, en la sala se apartaría por `foreign_media`).

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
    v.media.stop?.();
    try {
      v.db.close();
    } catch {
      // ya cerrada
    }
  }
});

/** Un workspace con equipo, D14, Can edit y los archivos por un link (base 21, con portero): R › S › H. */
async function setup() {
  const server = new FakeServer();
  let clock = Date.parse('2026-10-03T10:00:00Z');
  server.now = () => clock;
  server.enableTeam();
  server.enableClean(0.1);
  server.enableLinkEdit(0.1);
  server.enableLinkFiles();
  const e1 = await makeDevice(server, undefined, '0.200');
  devices.push(e1);
  const r = await e1.tree.create(null, 'R');
  const s = await e1.tree.create(r, 'S');
  const h = await e1.tree.create(s, 'H');
  const out = await e1.tree.create(r, 'Out');
  await e1.engine.syncNow();
  // Contenido del equipo en cada página (la admisión prueba sobre las filas del servidor).
  for (const [page, text] of [[s, 'Escena'], [h, 'Plano']] as const) {
    const doc = await e1.docs.open(page);
    doc.transact(() => group(doc).push([block(`e${text}`, text)]), 'test');
    await e1.docs.flush(page);
    e1.docs.close(page);
  }
  await e1.engine.syncNow();
  return { server, e1, r, s, h, out, tick: (ms: number) => (clock += ms) };
}

async function visitor(server: FakeServer, token: string, opts: { device?: string; version?: string } = {}): Promise<LinkDevice> {
  const v = await makeLinkDevice(server, token, opts.device, opts.version ?? '0.200', 'Ana');
  visitors.push(v);
  return v;
}

/** Una foto chica (el sondeo de mentira le saca medidas y miniatura). */
function photo(name = 'foto.jpg', bytes = 2000): Blob & { name: string } {
  return Object.assign(new Blob([new Uint8Array(bytes).fill(7)], { type: 'image/jpeg' }), { name });
}

/** Agrega el archivo como la app: a la cola y, en la página, un bloque de imagen con su dirección. */
async function addPhoto(v: LinkDevice, pageId: string, file: Blob & { name?: string } = photo()): Promise<string> {
  const url = await v.media.add(pageId, file);
  const doc = await v.docs.open(pageId);
  doc.transact(() => group(doc).push([block(`img${url.slice(-6)}`, '', 'image', { url })]), 'test');
  await v.docs.flush(pageId);
  v.docs.close(pageId);
  await v.media.idle();
  return url.slice('sdmedia://'.length);
}

/** Saca del documento el bloque con esa dirección. */
async function removeBlock(v: LinkDevice, pageId: string, id: string): Promise<void> {
  const doc = await v.docs.open(pageId);
  doc.transact(() => {
    const g = group(doc);
    for (let i = 0; i < g.length; i++) {
      if (JSON.stringify((g.get(i) as Y.XmlElement).toJSON()).includes(id)) {
        g.delete(i, 1);
        return;
      }
    }
  }, 'test');
  await v.docs.flush(pageId);
  v.docs.close(pageId);
}

/** Un ciclo del visitante y su cola de archivos, dos veces (lo registrado vuelve a despertar al motor). */
async function visitorRound(v: LinkDevice): Promise<void> {
  for (let i = 0; i < 2; i++) {
    await v.engine.syncNow();
    await v.engine.syncMedia();
  }
}

/** Un ciclo del editor que admite y arma bases sin esperar la cadencia. */
async function editorRound(e: Device, tick: (ms: number) => void, pageIds: string[]): Promise<void> {
  await e.engine.syncNow();
  tick(25_000);
  await e.engine.syncNow();
  await e.engine.prepareBases(pageIds);
}

/** La sala tiene una fila que muestra este archivo. */
function roomShows(server: FakeServer, fileId: string): boolean {
  return server.linkRoom.some((r) => r.data && Buffer.from(r.data).toString('latin1').includes(fileId));
}

describe('Can edit por un link: archivos (entrega 2b)', () => {
  it('el visitante sube una foto: se registra con el link, miniatura y original por el portero con el header, el equipo la admite y la ve', async () => {
    const { server, e1, s, tick } = await setup();
    const token = addPublicLink(server, s, server.ownerId, 'edit');
    await e1.engine.prepareBases([s]);
    const v = await visitor(server, token);
    await v.engine.syncNow();
    expect(await v.engine.prefetchPage(s)).toBe(true);
    const id = await addPhoto(v, s);
    // Registrarlo despierta al motor (lo escrito de la página esperaba al archivo).
    const poke = vi.spyOn(v.engine, 'poke');
    await v.engine.syncMedia();
    expect(server.mediaFiles.has(id)).toBe(true);
    expect(poke).toHaveBeenCalled();
    poke.mockRestore();
    await visitorRound(v);
    const link = server.publicLinks.get(token)!;
    // Registrada por el link (sin cuenta), en la página, con su miniatura, y en Drive por el portero.
    expect(server.mediaFiles.get(id)!.plink_id).toBe(link.id);
    expect(server.mediaFiles.get(id)!.created_by).toBeUndefined();
    expect(server.pageFiles.has(`${s}:${id}`)).toBe(true);
    expect(server.thumbs.has(id)).toBe(true);
    expect(server.mediaFiles.get(id)!.thumb_at).not.toBeNull();
    expect(server.mediaFiles.get(id)!.drive_id).toMatch(/^drive-/);
    expect(link).toMatchObject({ filesTotal: 1, uploadBytes: 2000 });
    // Al portero, siempre con el header del link y nunca con una sesión.
    const uploads = server.portero.calls.filter((c) => c.path.startsWith('/upload'));
    expect(uploads.length).toBeGreaterThan(0);
    expect((await v.media.status()).pending).toBe(0);
    // Lo pedido a la base fue solo lo del visitante.
    expect(v.calls.every((c) => c.fn.startsWith('plink_') || c.fn.startsWith('storage.upload thumbs/'))).toBe(true);
    // El bloque espera en la sala y un editor lo admite: el archivo es del link (no `foreign_media`).
    expect(roomShows(server, id)).toBe(true);
    await editorRound(e1, tick, [s]);
    expect(server.linkRoom.every((r) => r.decision === 'admitted')).toBe(true);
    // El editor que admitió reconcilia la página: el uso queda registrado y el archivo, visible para el equipo.
    await e1.engine.syncNow();
    expect((await e1.remote.fetchMediaFiles([id])).map((f) => f.id)).toEqual([id]);
  });

  it('lo escrito de una página espera mientras muestre un archivo propio sin registrar; sin el bloque, sale', async () => {
    const { server, e1, s, h, tick } = await setup();
    const token = addPublicLink(server, s, server.ownerId, 'edit');
    await e1.engine.prepareBases([s, h]);
    const v = await visitor(server, token);
    await v.engine.syncNow();
    await v.engine.prefetchPage(s);
    await v.engine.prefetchPage(h);
    // El tope del día de archivos, lleno: la foto no se registra.
    server.linkLimits.file = 0;
    const id = await addPhoto(v, s);
    await visitorRound(v);
    expect(server.mediaFiles.has(id)).toBe(false);
    expect(await v.docs.unsyncedPages()).toEqual([s]);
    expect(roomShows(server, id)).toBe(false);
    expect((await v.media.failures()).map((f) => f.error)).toEqual([expect.stringMatching(/limit for adding files/)]);
    // Otra página sin archivos sale igual.
    const doc = await v.docs.open(h);
    doc.transact(() => group(doc).push([block('hx', 'Hola')]), 'test');
    await v.docs.flush(h);
    v.docs.close(h);
    await visitorRound(v);
    expect(await v.docs.unsyncedPages()).toEqual([s]);
    // Al día siguiente (el tope vuelve): Retry la registra y recién ahí sale lo escrito, que entra.
    server.linkLimits.file = 100;
    await v.media.clearBlocked();
    await visitorRound(v);
    expect(server.mediaFiles.get(id)?.plink_id).toBe(server.publicLinks.get(token)!.id);
    expect(await v.docs.unsyncedPages()).toEqual([]);
    expect(roomShows(server, id)).toBe(true);
    await editorRound(e1, tick, [s, h]);
    expect(server.linkRoom.map((r) => r.decision)).toEqual(['admitted', 'admitted']);
  });

  it('sacar el bloque de un archivo que no se pudo registrar destraba la página (y nunca manda el archivo)', async () => {
    const { server, e1, s } = await setup();
    const token = addPublicLink(server, s, server.ownerId, 'edit');
    await e1.engine.prepareBases([s]);
    const v = await visitor(server, token);
    await v.engine.syncNow();
    await v.engine.prefetchPage(s);
    server.linkLimits.life_files = 0;
    const id = await addPhoto(v, s);
    await visitorRound(v);
    expect(await v.docs.unsyncedPages()).toEqual([s]);
    await removeBlock(v, s, id);
    await visitorRound(v);
    expect(await v.docs.unsyncedPages()).toEqual([]);
    expect(server.linkRoom).toHaveLength(1);
    expect(server.mediaFiles.has(id)).toBe(false);
  });

  it('topes: más de 500 MB no se guarda; una carpeta no; el registro de por vida, del día y de bytes no suma lo rechazado', async () => {
    const { server, e1, s } = await setup();
    const token = addPublicLink(server, s, server.ownerId, 'edit');
    await e1.engine.prepareBases([s]);
    const v = await visitor(server, token);
    await v.engine.syncNow();
    // Más de 500 MB: no se guarda nada en el dispositivo.
    const huge = photo('huge.mov');
    Object.defineProperty(huge, 'size', { value: LINK_FILE_MAX_BYTES + 1 });
    await expect(v.media.add(s, huge)).rejects.toBeInstanceOf(FileRejected);
    expect((await v.media.status()).pending).toBe(0);
    // Una carpeta (P.9), tampoco: ni la cola ni la base.
    await expect(v.media.addFolder(s, 'Fotos', 1000)).rejects.toBeInstanceOf(FileRejected);
    await expect(v.remote.registerFile({ id: crypto.randomUUID(), pageId: s, name: 'Fotos', mime: 'inode/directory', size: 1, width: null, height: null, duration: null })).rejects.toBeInstanceOf(RemoteError);
    // Ni se le pregunta a la base.
    expect(v.calls.some((c) => c.fn === 'plink_register_file')).toBe(false);
    // La base, directo (lo que haría un visitante sin la app).
    const client = fakeLinkClient(server, { 'x-shotdocs-version': '0.200', 'x-shotdocs-link': token, 'x-shotdocs-device': 'd'.repeat(20) });
    const reg = (size: number, mime = 'image/jpeg', id: string = crypto.randomUUID()) =>
      client.rpc('plink_register_file', { p_id: id, p_page_id: s, p_name: 'a.jpg', p_mime: mime, p_size: size, p_width: null, p_height: null, p_duration: null, p_app_version: '0.200' });
    expect((await reg(1, 'inode/directory')).error?.message).toBe('folder_not_allowed');
    expect((await reg(LINK_FILE_MAX_BYTES + 1)).error?.message).toBe('file_too_big');
    expect((await reg(0)).error?.message).toBe('file_too_big');
    const link = server.publicLinks.get(token)!;
    server.linkLimits.life_upload_bytes = 100;
    expect((await reg(101)).error).toMatchObject({ message: 'link_rate_limited', details: 'life_upload_bytes' });
    server.linkLimits.life_upload_bytes = 5368709120;
    server.linkLimits.upload_bytes = 100;
    expect((await reg(101)).error).toMatchObject({ message: 'link_rate_limited', details: 'upload_bytes' });
    server.linkLimits.upload_bytes = 1073741824;
    server.linkLimits.file = 1;
    expect((await reg(10)).error).toBeNull();
    expect((await reg(10)).error).toMatchObject({ message: 'link_rate_limited', details: 'file' });
    // Lo rechazado no sumó: un archivo y 10 bytes.
    expect(link).toMatchObject({ filesTotal: 1, uploadBytes: 10 });
    expect(server.linkUsage.get(`${link.id}:upload`)).toEqual({ n: 1, bytes: 10 });
  });

  it('guardas: un id ajeno nunca se vincula, afuera de la rama no, Can view no, otra versión no, revocado no, la base vieja no', async () => {
    const { server, e1, s, out } = await setup();
    const token = addPublicLink(server, s, server.ownerId, 'edit');
    await e1.engine.prepareBases([s]);
    // Un archivo del equipo en otra página (afuera de la rama).
    const team = crypto.randomUUID();
    await e1.remote.registerFile({ id: team, pageId: out, name: 'team.jpg', mime: 'image/jpeg', size: 10, width: null, height: null, duration: null });
    const headers = (t: string, version = '0.200') => ({ 'x-shotdocs-version': version, 'x-shotdocs-link': t, 'x-shotdocs-device': 'd'.repeat(20) });
    const reg = (t: string, id: string, page = s, version = '0.200') =>
      fakeLinkClient(server, headers(t, version)).rpc('plink_register_file', {
        p_id: id, p_page_id: page, p_name: 'a.jpg', p_mime: 'image/jpeg', p_size: 10, p_width: null, p_height: null, p_duration: null, p_app_version: version,
      });
    // Registrar el id de un archivo del equipo: nunca lo cuelga de la rama.
    expect((await reg(token, team)).error?.message).toBe('file_other_project');
    expect(server.pageFiles.has(`${s}:${team}`)).toBe(false);
    // Una página de afuera de la rama.
    expect((await reg(token, crypto.randomUUID(), out)).error?.message).toBe('page_not_found');
    // El mismo id, la misma página y el mismo link: idempotente, sin contar otra vez.
    const mine = crypto.randomUUID();
    expect((await reg(token, mine)).error).toBeNull();
    expect((await reg(token, mine)).error).toBeNull();
    expect(server.publicLinks.get(token)!.filesTotal).toBe(1);
    // Otro link (de otra página de la rama) con ese id: ajeno.
    const other = addPublicLink(server, out, server.ownerId, 'edit');
    expect((await reg(other, mine, out)).error?.message).toBe('file_other_project');
    // La miniatura y el original de un archivo que no es suyo: no.
    const v = await visitor(server, other);
    await v.engine.syncNow();
    await expect(v.remote.setFileThumb(mine)).rejects.toThrow('file_not_found');
    await expect(v.remote.uploadThumb(mine, new Blob([new Uint8Array(10)], { type: 'image/jpeg' }))).rejects.toThrow(/row-level security/);
    // Una versión más vieja que el interruptor: app_outdated.
    server.enableLinkEdit(0.3);
    expect((await reg(token, crypto.randomUUID())).error?.message).toBe('app_outdated');
    server.enableLinkEdit(0.1);
    // Can view.
    const view = addPublicLink(server, out, server.ownerId, 'comment');
    expect((await reg(view, crypto.randomUUID(), out)).error?.message).toBe('page_not_found');
    const viewer = await visitor(server, view, { device: 'viewer-' + 'x'.repeat(20) });
    await viewer.engine.syncNow();
    await expect(viewer.remote.registerFile({ id: crypto.randomUUID(), pageId: out, name: 'a.jpg', mime: 'image/jpeg', size: 1, width: null, height: null, duration: null })).rejects.toThrow('link_read_only');
    // Una base anterior a la 21: el aviso de siempre, sin preguntarle nada.
    server.settings = { ...server.settings!, schemaVersion: 20 };
    const old = await visitor(server, token, { device: 'old-' + 'x'.repeat(20) });
    await old.engine.syncNow();
    const before = old.calls.length;
    await expect(old.remote.registerFile({ id: crypto.randomUUID(), pageId: s, name: 'a.jpg', mime: 'image/jpeg', size: 1, width: null, height: null, duration: null })).rejects.toThrow(/isn't available yet/);
    expect(old.calls.slice(before).some((c) => c.fn === 'plink_register_file')).toBe(false);
    server.enableLinkFiles();
    // Revocado: link_not_found y la pantalla lo sabe.
    const keep = await visitor(server, token, { device: 'keep-' + 'x'.repeat(20) });
    await keep.engine.syncNow();
    server.revokePublicLink(token);
    await expect(keep.remote.registerFile({ id: crypto.randomUUID(), pageId: s, name: 'a.jpg', mime: 'image/jpeg', size: 1, width: null, height: null, duration: null })).rejects.toThrow('link_not_found');
    expect(keep.problems).toContain('link_not_found');
  });

  it('un tope de archivos no apaga el link entero (no avisa link_rate_limited a la pantalla)', async () => {
    const { server, e1, s } = await setup();
    const token = addPublicLink(server, s, server.ownerId, 'edit');
    await e1.engine.prepareBases([s]);
    const v = await visitor(server, token);
    await v.engine.syncNow();
    server.linkLimits.file = 0;
    await expect(v.remote.registerFile({ id: crypto.randomUUID(), pageId: s, name: 'a.jpg', mime: 'image/jpeg', size: 1, width: null, height: null, duration: null })).rejects.toThrow('link_rate_limited');
    expect(v.problems).not.toContain('link_rate_limited');
  });

  it('el portero: una foto del equipo de la rama no se sube con el link; Reset link corta la subida en curso', async () => {
    const { server, e1, s } = await setup();
    const token = addPublicLink(server, s, server.ownerId, 'edit');
    await e1.engine.prepareBases([s]);
    // Una foto del equipo en S que todavía no terminó de subir.
    const team = crypto.randomUUID();
    await e1.remote.registerFile({ id: team, pageId: s, name: 'team.jpg', mime: 'image/jpeg', size: 10, width: null, height: null, duration: null });
    const linkHeaders = { 'x-shotdocs-link': token, 'Content-Type': 'application/json' };
    const res = await server.portero.fetch('https://portero.test/upload', { method: 'POST', headers: linkHeaders, body: JSON.stringify({ file: team, size: 10, day: '2026-10-03' }) });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('not_mine');
    // El visitante empieza a subir algo grande y lo resetean a mitad: la parte siguiente no entra y queda sin confirmar.
    const v = await visitor(server, token);
    await v.engine.syncNow();
    await v.engine.prefetchPage(s);
    server.portero.cutAfterParts = 0;
    const id = await addPhoto(v, s, photo('big.jpg', 3000));
    await visitorRound(v);
    expect(server.mediaFiles.get(id)?.plink_id).toBeDefined();
    expect(server.mediaFiles.get(id)!.drive_id).toBeNull();
    const fresh = resetPublicLink(server, token);
    server.portero.reconnect();
    await v.engine.syncMedia();
    expect(server.mediaFiles.get(id)!.drive_id).toBeNull();
    // Lo que esperaba en la sala quedó apartado (E2.7); el archivo sigue registrado (nada se borra).
    expect(server.linkRoom.every((r) => r.decision === 'aside' && r.reason === 'link_revoked')).toBe(true);
    expect(server.pageFiles.has(`${s}:${id}`)).toBe(true);
    // El link nuevo no lo tiene como propio: no lo puede subir con el portero.
    expect(server.mediaFiles.get(id)!.plink_id).not.toBe(server.publicLinks.get(fresh)!.id);
  });
});
