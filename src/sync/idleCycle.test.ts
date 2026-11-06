import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeServer, makeDevice, type Device } from './testing';
import type { SyncEngine } from './engine';

// El ciclo en reposo y las listas cada minuto (Docs/Doc_Sincronizacion.md, «El ciclo en reposo»): cada ciclo eran unos
// 5 pedidos aunque no cambiara nada, cada 10 s, también con una pestaña olvidada a la vista. Ahora el reloj de fondo se
// espacia sin uso, y los proyectos y los permisos propios se piden cada minuto o cuando algo los pudo cambiar.

const devices: Device[] = [];
async function device(server: FakeServer, user?: { id: string }): Promise<Device> {
  const d = await makeDevice(server, undefined, undefined, undefined, undefined, user ?? {});
  devices.push(d);
  return d;
}

afterEach(() => {
  vi.useRealTimers();
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
    d.mediaDb.close();
  }
});

/** Lo privado del motor que miran estas pruebas. */
type Inside = {
  syncQuiet(): Promise<void>;
  tickDue(now: number): boolean;
  startedAt: number;
  lastInputAt: number;
  lastActivityAt: number;
  lastCycleAt: number;
};
const inside = (e: SyncEngine) => e as unknown as Inside;

/** Cuenta los pedidos de proyectos y de permisos propios de un dispositivo. */
function count(d: Device) {
  const n = { projects: 0, access: 0 };
  const projects = d.remote.fetchProjects.bind(d.remote);
  const access = d.remote.fetchMyAccess.bind(d.remote);
  d.remote.fetchProjects = (v) => {
    n.projects++;
    return projects(v);
  };
  d.remote.fetchMyAccess = (u) => {
    n.access++;
    return access(u);
  };
  return n;
}

describe('proyectos y permisos propios: cada minuto, no en cada ciclo', () => {
  it('el primer ciclo los pide; los ciclos de fondo del minuto siguiente usan los guardados; pasado el minuto, otra vez', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = Date.parse('2026-11-06T12:00:00Z');
    vi.setSystemTime(t0);
    const server = new FakeServer();
    server.enableTeam();
    const d = await device(server);
    const n = count(d);
    await d.engine.syncNow();
    expect(n).toEqual({ projects: 1, access: 1 });

    for (const s of [10, 20, 50]) {
      vi.setSystemTime(t0 + s * 1000);
      await inside(d.engine).syncQuiet();
    }
    expect(n).toEqual({ projects: 1, access: 1 });

    vi.setSystemTime(t0 + 61_000);
    await inside(d.engine).syncQuiet();
    expect(n).toEqual({ projects: 2, access: 2 });
  });

  it('syncNow (compartir, reintentar, volver a la app) los pide siempre', async () => {
    const server = new FakeServer();
    server.enableTeam();
    const d = await device(server);
    const n = count(d);
    await d.engine.syncNow();
    await d.engine.syncNow();
    expect(n).toEqual({ projects: 2, access: 2 });
  });

  it('un syncNow que llega a mitad de un ciclo (una invitación aceptada mientras sincroniza) deja pedido el siguiente', async () => {
    const server = new FakeServer();
    server.enableTeam();
    const d = await device(server);
    await d.engine.syncNow();
    const n = count(d);
    const projects = d.remote.fetchProjects.bind(d.remote);
    let once = true;
    d.remote.fetchProjects = (v) => {
      if (once) {
        once = false;
        void d.engine.syncNow();
      }
      return projects(v);
    };
    await d.engine.syncNow();
    // El ciclo pedido y el que dejó pedido el syncNow del medio: los dos piden las listas.
    expect(n).toEqual({ projects: 2, access: 2 });
  });

  it('un proyecto nuevo creado acá: el ciclo que lo sube vuelve a pedir los proyectos, y se ve en el árbol', async () => {
    const server = new FakeServer();
    server.enableTeam();
    const d = await device(server);
    await d.engine.syncNow();
    const n = count(d);
    const project = await d.tree.createProject('Nuevo');
    await inside(d.engine).syncQuiet();
    expect(n.projects).toBe(1);
    expect(d.tree.failedOps()).toEqual([]);
    expect(d.tree.projects().some((p) => p.id === project)).toBe(true);
    // El siguiente ciclo de fondo, sin nada que subir, usa los guardados.
    await inside(d.engine).syncQuiet();
    expect(n.projects).toBe(1);
  });

  it('un permiso nuevo de otro dispositivo llega a más tardar al minuto', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = Date.parse('2026-11-06T12:00:00Z');
    vi.setSystemTime(t0);
    const server = new FakeServer();
    server.enableTeam();
    const owner = await device(server);
    const page = await owner.tree.create(null, 'A');
    await owner.engine.syncNow();
    const guestId = crypto.randomUUID();
    server.addMember(guestId, 'member');
    const other = await device(server, { id: guestId });
    await other.engine.syncNow();
    expect(other.tree.get(page)).toBeUndefined();

    server.grant(guestId, { pageId: page }, 'view');
    vi.setSystemTime(t0 + 10_000);
    await inside(other.engine).syncQuiet();
    // Todavía con los permisos guardados: el árbol no la trae hasta el minuto.
    expect(other.tree.get(page)).toBeUndefined();
    vi.setSystemTime(t0 + 61_000);
    await inside(other.engine).syncQuiet();
    expect(other.tree.get(page)?.title).toBe('A');
  });
});

describe('el ciclo en reposo', () => {
  it('con uso reciente, cada latido; sin uso, cada 30 s; pasado el cuarto de hora, cada minuto', () => {
    const server = new FakeServer();
    return device(server).then((d) => {
      const e = inside(d.engine);
      const t0 = 1_000_000_000;
      e.startedAt = t0;
      e.lastInputAt = 0;
      e.lastActivityAt = 0;
      // Recién arrancada: cada 10 s.
      e.lastCycleAt = t0;
      expect(e.tickDue(t0 + 10_000)).toBe(true);
      // Dos minutos sin uso: cada 30 s.
      e.lastCycleAt = t0 + 130_000;
      expect(e.tickDue(t0 + 140_000)).toBe(false);
      expect(e.tickDue(t0 + 150_000)).toBe(false);
      expect(e.tickDue(t0 + 160_000)).toBe(true);
      // Más de 15 minutos sin uso: cada minuto.
      e.lastCycleAt = t0 + 16 * 60_000;
      expect(e.tickDue(t0 + 16 * 60_000 + 30_000)).toBe(false);
      expect(e.tickDue(t0 + 16 * 60_000 + 60_000)).toBe(true);
      // Alguien toca la app: vuelve a cada latido.
      e.lastInputAt = t0 + 17 * 60_000;
      e.lastCycleAt = t0 + 17 * 60_000;
      expect(e.tickDue(t0 + 17 * 60_000 + 10_000)).toBe(true);
      // Contenido que sube o baja también es uso.
      e.lastInputAt = 0;
      e.lastActivityAt = t0 + 40 * 60_000;
      e.lastCycleAt = t0 + 40 * 60_000;
      expect(e.tickDue(t0 + 40 * 60_000 + 10_000)).toBe(true);
    });
  });
});
