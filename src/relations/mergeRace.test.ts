// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { RemoteError, REQUEST_TIMEOUT } from '../sync/types';
import { writeBlocks } from './fixtures/proyectoSintetico';
import { mergeDepsFrom, resumeMerges, runMerge, type MergeDeps } from './mergeJob';

// El vigía de las uniones a mitad (`MergeResumer`) corriendo a la vez que la unión del adelanto (B1 de la auditoría del
// resultado de E16, D687): con el candado por página, una sola corrida; C3 vale siempre (B nunca va a la papelera sin los
// usos de sus fotos confirmados en A) y no hay un segundo resultado («B queda») con B ya en la papelera.

const devices: Device[] = [];
afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.docs.dispose();
    d.db.close();
  }
});

const PHOTO = '0000e16a-aaaa-4bbb-8ccc-dddddddddddd';

async function device(server: FakeServer, dbName?: string): Promise<Device> {
  const d = await makeDevice(server, dbName);
  devices.push(d);
  return d;
}

interface World {
  server: FakeServer;
  a: Device;
  b: Device;
  /** La escena (la primera, la que queda), la repetida (la que se va), su ficha y un día que linkea a la repetida. */
  keep: string;
  gone: string;
  card: string;
  day: string;
}

async function world(): Promise<World> {
  const server = new FakeServer();
  server.enableTrash();
  server.mediaFiles.set(PHOTO, {
    id: PHOTO, name: 'curva.jpg', mime: 'image/jpeg', width: 1920, height: 1080, duration: null, thumb_at: null,
    drive_id: 'd-curva', size: 2048, trashed_at: null, purged_at: null, drive_trashed_at: null, project_id: server.workspaceId,
  });
  const a = await device(server);
  await a.engine.syncNow();
  const bd = await a.tree.create(null, 'Breakdown');
  await a.tree.setSetting(bd, 'holds', 'scene');
  const ep = await a.tree.create(bd, '105');
  const keep = await a.tree.create(ep, '123 | La camioneta');
  await writeBlocks(a, keep, [{ h: 1, text: 'Notas' }, { p: 'Lo de la primera página.' }]);
  const gone = await a.tree.create(ep, '123 | La camioneta (otra)');
  await writeBlocks(a, gone, [{ h: 2, text: 'Plano general' }, { p: 'Texto de la segunda.' }, { photo: PHOTO, caption: 'La curva' }]);
  const card = await a.tree.create(gone, 'PRUEBA_105_123_010');
  await writeBlocks(a, card, [{ p: 'La ficha de la segunda.' }]);
  const days = await a.tree.create(null, 'Shoot days');
  await a.tree.setSetting(days, 'holds', 'day');
  const day = await a.tree.create(days, '2026-03-16 | Día 77');
  await writeBlocks(a, day, [{ hl: 1, runs: ['Escena ', { link: gone, text: '105_123' }] }, { p: 'Se filmó.' }]);
  await a.engine.syncNow();
  server.pageFiles.add(`${gone}:${PHOTO}`);
  const b = await device(server);
  await b.engine.syncNow();
  return { server, a, b, keep, gone, card, day };
}

function deps(d: Device, extra: Partial<MergeDeps> = {}): MergeDeps {
  return { ...mergeDepsFrom(d, { comments: d.remote, check: () => null }), waitMs: 1500, ...extra };
}



const merge = (d: Device, w: World, extra: Partial<MergeDeps> = {}) =>
  runMerge(deps(d, extra), { keep: w.keep, gone: w.gone, projectId: d.tree.workspaceId, text: 'Merged from the other page' });



describe('el vigía corre a la vez que la unión del adelanto (D687)', () => {
  it('con el uso de la foto en A sin confirmar, B no va a la papelera aunque corra el vigía', async () => {
    const w = await world();
    const remote = w.a.remote as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const link = remote.linkPageFile.bind(w.a.remote);
    remote.linkPageFile = async (...args: unknown[]) => {
      if (args[0] === w.keep) throw new RemoteError('timeout', false, REQUEST_TIMEOUT);
      return link(...args);
    };
    const hold: { p: Promise<unknown> | null } = { p: null };
    const out = await merge(w.a, w, {
      waitMs: 1500,
      afterStep: (step) => {
        // Lo que hace MergeResumer cuando cambia lastSyncAt: el trabajo ya está anotado en 'started'.
        if (step === 'started' && !hold.p) hold.p = resumeMerges(deps(w.a, { waitMs: 1500 }));
      },
    });
    const r = (await hold.p) as { status: string; job: { copy?: unknown } }[];
    expect(w.server.pageFiles.has(`${w.keep}:${PHOTO}`) || !w.server.pages.get(w.gone)?.deleted_at).toBe(true);
    // El vigía no corrió: la del adelanto tenía el candado y quedó a mitad, anotada para seguir.
    expect([out.status, r.length]).toEqual(['pending', 0]);
  });

  it('una unión normal con el vigía a la vez: un solo resultado, y el que trae Undo tiene la copia', async () => {
    const w = await world();
    const hold: { p: Promise<unknown> | null } = { p: null };
    const out = await merge(w.a, w, {
      afterStep: (step) => {
        if (step === 'started' && !hold.p) hold.p = resumeMerges(deps(w.a));
      },
    });
    const r = (await hold.p) as { status: string; reason?: string; job: { copy?: unknown } }[];
    const statuses = [out.status, ...r.map((o) => o.status)];
    expect(statuses.filter((s) => s === 'stopped')).toHaveLength(0);
    // Un solo resultado, con la copia (su Undo la saca).
    expect(statuses).toEqual(['done']);
    expect((out as { job?: { copy?: unknown } }).job?.copy).toBeTruthy();
  });

  it('la corrida que sigue sin el registro de la copia (la app se cerró entre copiar y anotarlo) espera igual las fotos', async () => {
    const w = await world();
    await expect(
      merge(w.a, w, {
        afterStep: (step) => {
          if (step === 'copied') throw new Error('la app se cerró');
        },
      }),
    ).rejects.toThrow('la app se cerró');
    // Lo anotado queda como si el registro de la copia no hubiera llegado a guardarse.
    const store = deps(w.a).store;
    const key = `mergeJob:${w.gone}`;
    const job = (await store.get(key)) as Record<string, unknown>;
    delete job.copy;
    await store.put(key, job);
    const remote = w.a.remote as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const link = remote.linkPageFile.bind(w.a.remote);
    remote.linkPageFile = async (...args: unknown[]) => {
      if (args[0] === w.keep) throw new RemoteError('timeout', false, REQUEST_TIMEOUT);
      return link(...args);
    };
    const outs = await resumeMerges(deps(w.a, { waitMs: 800 }));
    expect(outs.map((o) => o.status)).toEqual(['pending']);
    expect(w.server.pages.get(w.gone)?.deleted_at ?? null).toBeNull();
  });
});
