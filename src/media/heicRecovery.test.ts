import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { HEIC_SAMPLE } from './fixtures/heicSample';
import { mediaIdOf, HEIC_ONLINE_TRIES, HEIC_RETRY_MS } from './queue';
import { recoverHeic, recoveryBytes, recoveryKeys } from './heicRecovery';
import { HeicError } from './heic';
import { freeOwn, OWN_MIN_AGE_MS } from './ownFree';
import { md5Blob } from './md5';

// Estados previos sembrados como los dejó la versión antigua; servidor/convertidor controlados para aislar cada carrera.
const devices: Device[] = [];
afterEach(() => { for (const d of devices.splice(0)) { d.offline.stop(); d.engine.stop(); d.db.close(); d.mediaDb.close(); d.commentsDb.close(); } vi.restoreAllMocks(); });
const gate = () => { let open!: () => void; const done = new Promise<void>(r => { open = r; }); return { done, open }; };
async function setup() {
  const server = new FakeServer(); server.enableMedia(); server.enableTrash();
  const d = await makeDevice(server); devices.push(d);
  await d.engine.syncNow(); const page = await d.tree.create(null, 'Antes'); await d.engine.syncNow();
  const id = mediaIdOf(await d.media.add(page, new File(['jpeg'], 'old.jpg', { type: 'image/jpeg' })))!;
  await d.media.idle(); const old = (await d.mediaDb.get('files', id))!;
  const original = new File([Uint8Array.from(atob(HEIC_SAMPLE), c => c.charCodeAt(0))], 'old.HEIC', { type: 'image/heic' });
  const record = { ...old, name: original.name, mime: original.type, size: original.size, thumb: 'none' as const, width: null, height: null };
  delete record.heic;
  await d.mediaDb.put('files', record); await d.mediaDb.put('blobs', original, id);
  let stopped = false;
  const convert = vi.fn((b: Blob) => server.convertHeic(b));
  const deps = { db: d.mediaDb, remote: d.remote, convert: convert as (b: Blob) => Promise<Blob>, stopped: () => stopped, offline: () => !server.online,
    now: () => Date.now() + server.clockOffset, tries: HEIC_ONLINE_TRIES, retry: HEIC_RETRY_MS };
  const recover = () => recoverHeic(id, deps);
  const get = async () => (await d.mediaDb.get('files', id))!;
  const primary = async () => md5Blob((await d.mediaDb.get('blobs', id))!);
  return { server, d, id, original, record, deps, convert, recover, get, primary, stop: () => { stopped = true; } };
}

describe('HEIC anterior sin marca: registro incierto con bytes protegidos', () => {
  it('recupera antes del registro genérico y sube JPEG manteniendo el HEIC exacto', async () => {
    const s = await setup(); await s.d.engine.syncMedia();
    const r = await s.get(); expect(r).toMatchObject({ mime: 'image/jpeg', pending: 0, heicRecovery: { state: 'promoted' } });
    expect(s.server.mediaFiles.get(s.id)).toMatchObject({ mime: 'image/jpeg', size: r.size });
    expect(await md5Blob((await s.d.mediaDb.get('blobs', recoveryKeys(r)[0]))!)).toBe(await md5Blob(s.original));
    expect(await s.primary()).toBe(r.heicRecovery!.jpeg!.md5);
    expect(s.server.portero.drive.get(r.driveId!)!.data.length).toBe(r.size);
  });
  it('una respuesta perdida del registro HEIC conserva y sube sus mismos bytes, sin convertir', async () => {
    const s = await setup(); await s.d.remote.registerFile({ ...s.record, width: null, height: null });
    await s.d.engine.syncMedia(); const r = await s.get();
    expect(r).toMatchObject({ mime: 'image/heic', pending: 0, heicRecovery: { state: 'heic' } });
    expect(await s.primary()).toBe(await md5Blob(s.original)); expect(s.convert).not.toHaveBeenCalled();
  });
  it('respuesta perdida del registro JPEG: retoma el mismo candidato durable sin volver a convertir', async () => {
    const s = await setup(); s.server.loseMediaResponse.add('register_file');
    await expect(s.recover()).rejects.toThrow(); const before = await s.get();
    expect(before.heicRecovery?.state).toBe('prepared'); expect(await s.primary()).toBe(await md5Blob(s.original));
    const candidateHash = await md5Blob((await s.d.mediaDb.get('blobs', recoveryKeys(before)[1]))!);
    s.server.loseMediaResponse.clear(); const resumed = await s.recover();
    expect(resumed?.heicRecovery?.state).toBe('promoted'); expect(s.convert).toHaveBeenCalledOnce();
    expect(await s.primary()).toBe(candidateHash);
  });
  it('ok falso y SELECT vacío no autorizan promover: original y candidato siguen intactos', async () => {
    const s = await setup(); vi.spyOn(s.d.remote, 'registerFile').mockResolvedValue('ok');
    vi.spyOn(s.d.remote, 'fetchMediaFiles').mockResolvedValue([]);
    expect(await s.recover()).toBeNull(); const r = await s.get();
    expect(r.heicRecovery?.state).toBe('prepared'); expect(r.registered).toBe(false);
    expect(await s.primary()).toBe(await md5Blob(s.original)); expect(await recoveryBytes(s.d.mediaDb, r)).toBe(s.original.size + r.heicRecovery!.jpeg!.size);
  });
  it('SELECT vacío por falta de acceso + registro denegado conservan bytes', async () => {
    const s = await setup(); vi.spyOn(s.d.remote, 'fetchMediaFiles').mockResolvedValue([]);
    vi.spyOn(s.d.remote, 'registerFile').mockRejectedValue(new Error('sin permiso'));
    await expect(s.recover()).rejects.toThrow('sin permiso'); expect(await s.primary()).toBe(await md5Blob(s.original));
    expect((await s.get()).registered).toBe(false);
  });
  it('HEIC gana entre consulta y registro candidato: no se reescribe su formato ni el original', async () => {
    const s = await setup(); const real = s.d.remote.registerFile.bind(s.d.remote);
    vi.spyOn(s.d.remote, 'registerFile').mockImplementation(async f => { await real({ ...s.record, width: null, height: null }); return real(f); });
    const r = await s.recover(); expect(r?.heicRecovery?.state).toBe('heic');
    expect(s.server.mediaFiles.get(s.id)?.mime).toBe('image/heic'); expect(await s.primary()).toBe(await md5Blob(s.original));
  });
  it('otra pestaña cambia el principal durante la conversión: nunca lo sobrescribe', async () => {
    const s = await setup(); const g = gate(); const start = gate(); const real = s.deps.convert;
    s.deps.convert = async b => { start.open(); await g.done; return real(b); };
    const work = s.recover(); await start.done;
    const changed = new Blob([new Uint8Array(s.original.size).fill(9)], { type: s.original.type });
    await s.d.mediaDb.put('blobs', changed, s.id); g.open(); expect(await work).toBeNull();
    expect(await s.primary()).toBe(await md5Blob(changed)); expect(s.server.mediaFiles.has(s.id)).toBe(false);
    expect(await md5Blob((await s.d.mediaDb.get('blobs', recoveryKeys(await s.get())[0]))!)).toBe(await md5Blob(s.original));
  });
  it('stop durante conversión no registra ni promociona al llegar la respuesta', async () => {
    const s = await setup(); const g = gate(); const start = gate(); const real = s.deps.convert;
    s.deps.convert = async b => { start.open(); await g.done; return real(b); };
    const work = s.recover(); await start.done; s.stop(); g.open(); expect(await work).toBeNull();
    expect(s.server.mediaFiles.has(s.id)).toBe(false); expect(await s.primary()).toBe(await md5Blob(s.original));
  });
  it('offline prepara sin registrar; volver online usa el candidato existente', async () => {
    const s = await setup(); s.server.online = false; expect(await s.recover()).toBeNull();
    expect((await s.get()).heicRecovery?.state).toBe('prepared'); expect(s.server.mediaFiles.has(s.id)).toBe(false);
    s.server.online = true; expect((await s.recover())?.mime).toBe('image/jpeg'); expect(s.convert).toHaveBeenCalledOnce();
  });
  it('cerrar y abrir otra cola retoma el candidato durable y conserva el registro de formato anterior', async () => {
    const s = await setup(); s.server.online = false; await s.recover(); const before = await s.get();
    const legacyWrite = { ...before, failures: 2 }; // La versión publicada escribía con spread; ignora propiedades nuevas.
    await s.d.mediaDb.put('files', legacyWrite);
    s.d.engine.stop(); s.d.db.close(); s.d.mediaDb.close(); s.d.commentsDb.close(); devices.splice(devices.indexOf(s.d), 1);
    s.server.online = true; const reopened = await makeDevice(s.server, s.d.db.name); devices.push(reopened);
    await reopened.engine.syncNow(); await reopened.engine.syncMedia();
    const r = (await reopened.mediaDb.get('files', s.id))!;
    expect(r.heicRecovery?.rev).toBe(before.heicRecovery!.rev); expect(r.heicRecovery?.state).toBe('promoted');
    expect(await md5Blob((await reopened.mediaDb.get('blobs', recoveryKeys(r)[0]))!)).toBe(await md5Blob(s.original));
  });
  it('stop esperando consulta no inicia conversión ni registro', async () => {
    const s = await setup(); const g = gate(); const started = gate();
    vi.spyOn(s.d.remote, 'fetchMediaFiles').mockImplementation(async () => { started.open(); await g.done; return []; });
    const work = s.recover(); await started.done; s.stop(); g.open(); expect(await work).toBeNull();
    expect(s.convert).not.toHaveBeenCalled(); expect(s.server.mediaFiles.has(s.id)).toBe(false);
  });
  it('una pausa del portero prepara/reconcilia recuperación sin subir el original', async () => {
    const s = await setup(); Object.assign(s.d.media, { stallPause: { until: Date.now() + 60_000, storage: false } });
    await s.d.engine.syncMedia(); const r = await s.get();
    expect(r).toMatchObject({ registered: true, mime: 'image/jpeg', pending: 1, heicRecovery: { state: 'promoted' } });
    expect(r.driveId).toBeNull(); expect(s.server.portero.drive.size).toBe(0);
  });
  it('stop tras registrar remoto impide promoción; al retomar reconcilia sin registrar distinto', async () => {
    const s = await setup(); const register = s.d.remote.registerFile.bind(s.d.remote);
    vi.spyOn(s.d.remote, 'registerFile').mockImplementation(async f => { const out = await register(f); s.stop(); return out; });
    expect(await s.recover()).toBeNull(); const r = await s.get();
    expect(r.heicRecovery?.state).toBe('prepared'); expect(r.registered).toBe(false); expect(await s.primary()).toBe(await md5Blob(s.original));
    s.deps.stopped = () => false; expect((await s.recover())?.heicRecovery?.state).toBe('promoted');
  });
  it('una revisión cambiada durante conversión no guarda candidato ni registra', async () => {
    const s = await setup(); const g = gate(); const start = gate(); const real = s.deps.convert;
    s.deps.convert = async b => { start.open(); await g.done; return real(b); };
    const work = s.recover(); await start.done; const r = await s.get();
    await s.d.mediaDb.put('files', { ...r, heicRecovery: { ...r.heicRecovery!, rev: crypto.randomUUID() } });
    g.open(); expect(await work).toBeNull(); expect(s.server.mediaFiles.has(s.id)).toBe(false); expect(await s.primary()).toBe(await md5Blob(s.original));
  });
  it('otra pestaña registra durante conversión: no guarda ni promociona su candidato', async () => {
    const s = await setup(); const g = gate(); const start = gate(); const real = s.deps.convert;
    s.deps.convert = async b => { start.open(); await g.done; return real(b); };
    const work = s.recover(); await start.done; const r = await s.get();
    await s.d.mediaDb.put('files', { ...r, registered: true }); g.open(); expect(await work).toBeNull();
    expect(await s.primary()).toBe(await md5Blob(s.original)); expect(await s.d.mediaDb.get('blobs', recoveryKeys(r)[1])).toBeUndefined();
  });
  it('quota durante promoción revierte el principal y conserva ambos auxiliares', async () => {
    const s = await setup(); s.server.online = false; await s.recover(); s.server.online = true; const r = await s.get();
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === 'blobs' && key === s.id) { this.transaction.abort(); throw new DOMException('sin espacio', 'QuotaExceededError'); }
      return put.call(this, value, key);
    });
    await expect(s.recover()).rejects.toMatchObject({ name: 'QuotaExceededError' });
    expect(await s.primary()).toBe(await md5Blob(s.original)); expect((await s.get()).heicRecovery?.state).toBe('prepared');
    expect(await recoveryBytes(s.d.mediaDb, r)).toBe(s.original.size + r.heicRecovery!.jpeg!.size);
  });
  it.each([0, 1])('auxiliar alterado %i impide promoción pese a fila JPEG positiva', async which => {
    const s = await setup(); s.server.online = false; await s.recover(); const r = await s.get(); s.server.online = true;
    await s.d.remote.registerFile({ id: s.id, pageId: r.pageId, ...r.heicRecovery!.jpeg!, width: null, height: null, duration: null });
    const key = recoveryKeys(r)[which], previous = (await s.d.mediaDb.get('blobs', key))!;
    await s.d.mediaDb.put('blobs', new Blob([new Uint8Array(previous.size).fill(9)]), key);
    expect(await s.recover()).toBeNull(); expect(await s.primary()).toBe(await md5Blob(s.original)); expect((await s.get()).registered).toBe(false);
  });
  it.each(['image/jpeg','image/png','image/avif','image/heic-sequence','application/pdf'])('no readapta %s sin firma HEIC de imagen', async mime => {
    const s = await setup(); const r = await s.get();
    await s.d.mediaDb.put('blobs', new Blob([new Uint8Array(s.original.size)], { type: mime }), s.id);
    await s.d.mediaDb.put('files', { ...r, mime }); expect(await s.recover()).toBeUndefined(); expect(s.convert).not.toHaveBeenCalled();
  });
  it.each(['project_id','name','mime','size'] as const)('metadata positiva distinta en %s no promueve', async field => {
    const s = await setup(); s.server.online = false; await s.recover(); const r = await s.get(); s.server.online = true;
    const row = { id: s.id, project_id: r.projectId, ...r.heicRecovery!.jpeg!, [field]: field === 'size' ? 1 : 'distinto' };
    vi.spyOn(s.d.remote, 'fetchMediaFiles').mockResolvedValue([row as never]);
    expect(await s.recover()).toBeNull(); expect(await s.primary()).toBe(await md5Blob(s.original));
    expect(s.server.mediaFiles.has(s.id)).toBe(false);
  });
  it('estado desconocido no se convierte ni registra, conserva sus copias', async () => {
    const s = await setup(); s.server.online = false; await s.recover(); const r = await s.get(); s.server.online = true;
    await s.d.mediaDb.put('files', { ...r, heicRecovery: { ...r.heicRecovery!, state: 'futuro' } as never });
    expect(await s.recover()).toBeNull(); expect(s.server.mediaFiles.has(s.id)).toBe(false); expect(await s.primary()).toBe(await md5Blob(s.original));
  });
  it('quota al persistir candidato no reemplaza el original ni envía su registro', async () => {
    const s = await setup(); s.server.online = false;
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === 'blobs' && typeof key === 'string' && key.startsWith('heic-candidate:')) {
        this.transaction.abort(); throw new DOMException('sin espacio', 'QuotaExceededError');
      }
      return put.call(this, value, key);
    });
    await expect(s.recover()).rejects.toMatchObject({ name: 'QuotaExceededError' });
    expect(await s.primary()).toBe(await md5Blob(s.original)); expect(s.server.mediaFiles.has(s.id)).toBe(false);
    expect((await s.get()).heicRecovery?.state).toBe('waiting');
  });
  it('decoder ausente offline no cuenta intentos; tres intentos online vuelven al HEIC', async () => {
    const s = await setup(); s.deps.convert = async () => { throw new HeicError('unavailable', 'sin decoder'); };
    s.server.online = false; await s.recover(); expect((await s.get()).heicMisses).toBeUndefined();
    s.server.online = true; for (let i = 0; i < HEIC_ONLINE_TRIES; i++) await s.recover();
    expect((await s.get()).heicRecovery?.state).toBe('failed'); expect(await s.primary()).toBe(await md5Blob(s.original));
  });
  it.each(['heic','registered','uploadId','freedAt','pending','missing'] as const)('excluye estado previo %s', async field => {
    const s = await setup(); const r = await s.get();
    if (field === 'missing') await s.d.mediaDb.delete('blobs', s.id);
    else await s.d.mediaDb.put('files', { ...r, [field]: ({ heic: 'pending', registered: true, uploadId: 'iniciado', freedAt: 1, pending: 0 } as const)[field] });
    expect(await s.recover()).toBeUndefined(); expect(s.convert).not.toHaveBeenCalled();
  });
});

describe('auxiliares HEIC: contabilidad y liberación bajo la política de propios', () => {
  it('cuenta HEIC protegido/candidato incluso si el principal desaparece', async () => {
    const s = await setup(); s.server.online = false; await s.recover(); const r = await s.get();
    const auxiliary = s.original.size + r.heicRecovery!.jpeg!.size;
    expect((await s.d.offline.usage()).kept).toBe(s.original.size + auxiliary);
    await s.d.mediaDb.delete('blobs', s.id); expect((await s.d.offline.usage()).kept).toBe(auxiliary);
  });
  it('una revisión reemplazada conserva y cuenta los auxiliares antiguos sin ofrecer liberarlos', async () => {
    const s = await setup(); s.server.online = false; await s.recover(); const r = await s.get();
    const total = s.original.size * 2 + r.heicRecovery!.jpeg!.size;
    await s.d.mediaDb.put('files', { ...r, heicRecovery: { ...r.heicRecovery!, rev: crypto.randomUUID() } });
    expect((await s.d.offline.usage()).kept).toBe(total); expect((await s.d.offline.usage()).own.freeable).toBe(0);
  });
  it('no libera recuperación activa ni revisión cambiada; tras confirmación y 14 días libera solo sus claves', async () => {
    const s = await setup(); await s.d.engine.syncMedia(); const r = await s.get();
    const md5 = await s.primary(); const keys = recoveryKeys(r); const extra = await recoveryBytes(s.d.mediaDb, r);
    const otherKey = `${keys[0]}-ajeno`; await s.d.mediaDb.put('blobs', new Blob(['ajeno']), otherKey);
    const guard = { rev: 0, driveId: r.driveId!, size: r.size, md5, now: Date.now() + OWN_MIN_AGE_MS + 1_000, rollout: null, recoveryRev: crypto.randomUUID() };
    expect(await freeOwn(s.d.mediaDb, s.id, guard)).toBe(0);
    expect(await freeOwn(s.d.mediaDb, s.id, { ...guard, recoveryRev: r.heicRecovery!.rev, now: Date.now() })).toBe(0);
    expect(await freeOwn(s.d.mediaDb, s.id, { ...guard, recoveryRev: r.heicRecovery!.rev })).toBe(r.size + extra);
    for (const key of [s.id, ...keys]) expect(await s.d.mediaDb.getKey('blobs', key)).toBeUndefined();
    expect(await s.d.mediaDb.getKey('blobs', otherKey)).toBe(otherKey);
  });
});
