import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { FakeServer, makeDevice, PORTERO_URL, TRASH_VERSION_SINCE, type Device } from '../sync/testing';
import { emptyFileTrash, sendToDriveTrash } from './fileTrash';
import { Portero, PorteroError } from './portero';

// La versión mínima del workspace también frena mandar archivos a la papelera de Drive (Docs/Doc_Sincronizacion.md,
// "La versión mínima y la papelera de archivos"). `purge_file` lo llama el portero con la sesión de la persona: la app
// le dice su versión al portero en `POST /trash`, el portero se la pasa a la base y la base la compara con la mínima
// (supabase/migrations/20261109120000_version_minima_papelera_archivos.sql). Sin la versión (una app o un portero
// anteriores) pasa como siempre, hasta que la mínima llega a la primera versión que la manda. El servidor y el portero
// en memoria (src/sync/testing.ts) siguen esas reglas.

const MIGRATION = '20261109120000_version_minima_papelera_archivos';
const SINCE = TRASH_VERSION_SINCE.toFixed(3);
const BEFORE = (TRASH_VERSION_SINCE - 0.001).toFixed(3);
const AFTER = (TRASH_VERSION_SINCE + 0.001).toFixed(3);

const devices: Device[] = [];
afterEach(() => {
  for (const d of devices.splice(0)) {
    d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
});

/** Un archivo en la papelera de archivos del proyecto, como lo deja la base. */
function fileInTrash(server: FakeServer, id: string): void {
  server.mediaFiles.set(id, {
    id, name: `${id}.jpg`, mime: 'image/jpeg', width: null, height: null, duration: null, thumb_at: null,
    drive_id: `d-${id}`, size: 2048, trashed_at: new Date().toISOString(), purged_at: null, drive_trashed_at: null,
    project_id: server.workspaceId,
  });
}

/** El workspace con la papelera de archivos y tres archivos en ella; `min`: la versión mínima. */
function workspace(min: number | null = null): FakeServer {
  const server = new FakeServer();
  server.enableTrash();
  server.settings = { ...server.settings!, minAppVersion: min };
  for (const id of ['uno', 'dos', 'tres']) fileInTrash(server, id);
  return server;
}

/** El dispositivo del dueño con esa versión de la app, ya sincronizado (sabe la mínima de ese momento). */
async function device(server: FakeServer, appVersion: string): Promise<Device> {
  const d = await makeDevice(server, undefined, appVersion);
  devices.push(d);
  await d.engine.syncNow();
  return d;
}

/** El portero como lo llama una app que no dice su versión (anterior a esta). */
const oldApp = (server: FakeServer) =>
  new Portero(PORTERO_URL, { fetch: server.portero.fetch, token: async () => `token:${server.ownerId}`, wait: async () => undefined, appVersion: '' });

const purged = (server: FakeServer, id: string) => !!server.mediaFiles.get(id)?.purged_at;
const trashCalls = (server: FakeServer) => server.portero.calls.filter((c) => c.path === '/trash');

describe('la app le dice su versión al portero al mandar un archivo a la papelera de Drive', () => {
  /** Un portero que anota cada pedido y contesta que quedó hecho. */
  function recorder() {
    const seen: { headers: Record<string, string>; body: unknown }[] = [];
    const fetchImpl = (async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      seen.push({ headers: Object.fromEntries(new Headers(init.headers)), body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ status: 'done', file: 'f', drive: 'trashed' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    return { seen, fetchImpl };
  }

  it('va en el cuerpo del pedido y no en un header: un header nuevo no pasaría el CORS de un portero anterior', async () => {
    const { seen, fetchImpl } = recorder();
    await new Portero(PORTERO_URL, { fetch: fetchImpl, token: async () => 'sesion', appVersion: SINCE }).trash('f');
    expect(seen).toEqual([{ headers: { authorization: 'Bearer sesion', 'content-type': 'application/json' }, body: { file: 'f', appVersion: SINCE } }]);
  });

  it('por defecto manda la versión de esta compilación; sin versión conocida, no manda ninguna', async () => {
    const { seen, fetchImpl } = recorder();
    await new Portero(PORTERO_URL, { fetch: fetchImpl, token: async () => 'sesion' }).trash('f');
    await new Portero(PORTERO_URL, { fetch: fetchImpl, token: async () => 'sesion', appVersion: '' }).trash('f');
    expect(__APP_VERSION__).toMatch(/^\d+\.\d{3}$/);
    expect(seen.map((s) => s.body)).toEqual([{ file: 'f', appVersion: __APP_VERSION__ }, { file: 'f' }]);
  });

  it('el rechazo del portero llega con su código, y no es de los que se reintentan solos', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: 'This workspace needs a newer version of the app.', code: 'app_outdated' }), {
        status: 426,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    const err = await new Portero(PORTERO_URL, { fetch: fetchImpl, token: async () => 'sesion', appVersion: SINCE }).trash('f').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PorteroError);
    expect(err).toMatchObject({ status: 426, code: 'app_outdated', retryable: false });
  });
});

describe('mandar a la papelera de Drive con la versión mínima del workspace', () => {
  it('con la app al día sale, y a la base le llega la versión de la app', async () => {
    const server = workspace(TRASH_VERSION_SINCE);
    const a = await device(server, SINCE);
    expect(await sendToDriveTrash((f) => a.media.trash(f), 'uno')).toEqual({ status: 'done' });
    expect(server.portero.trashVersions).toEqual([SINCE]);
    expect(server.mediaFiles.get('uno')).toMatchObject({ purged_at: expect.any(String), drive_trashed_at: expect.any(String) });
    expect(a.media.outdated).toBe(false);
  });

  it('si suben la mínima con la app abierta: no marca nada, avisa que hay que actualizar y Empty no sigue con los demás', async () => {
    const server = workspace(TRASH_VERSION_SINCE);
    const a = await device(server, SINCE);
    expect(a.engine.getStatus().outdated).toBe(false);
    // La suben después de la última consulta del motor: la app todavía no lo sabe.
    server.settings = { ...server.settings!, minAppVersion: Number(AFTER) };
    const progress: string[] = [];
    const results = await emptyFileTrash((f) => a.media.trash(f), ['uno', 'dos', 'tres'], (_d, _t, id, outcome) => progress.push(`${id}:${outcome.status}`));
    expect(progress).toEqual(['uno:outdated']);
    expect([...results.values()]).toEqual([{ status: 'outdated', message: t('queue.outdated') }]);
    expect(trashCalls(server)).toHaveLength(1);
    for (const id of ['uno', 'dos', 'tres']) expect(purged(server, id)).toBe(false);
    expect(server.portero.driveTrash.size).toBe(0);
    // La cola queda frenada como con cualquier `app_outdated`, y el motor lo muestra.
    expect(a.media.outdated).toBe(true);
    expect(a.engine.getStatus().outdated).toBe(true);
    // Mientras tanto no vuelve a pedirle nada al portero.
    expect(await sendToDriveTrash((f) => a.media.trash(f), 'dos')).toEqual({ status: 'error', message: t('queue.outdated') });
    expect(trashCalls(server)).toHaveLength(1);
  });

  it('con la app actualizada, lo que no salió sale', async () => {
    const server = workspace(Number(AFTER));
    const b = await device(server, AFTER);
    const results = await emptyFileTrash((f) => b.media.trash(f), ['uno', 'dos', 'tres']);
    expect([...results.values()].map((r) => r.status)).toEqual(['done', 'done', 'done']);
    for (const id of ['uno', 'dos', 'tres']) expect(purged(server, id)).toBe(true);
  });

  it('una app anterior, que no dice su versión: pasa mientras la mínima es menor que la primera versión que la dice; desde ahí, no', async () => {
    const server = workspace(Number(BEFORE));
    expect(await sendToDriveTrash((f) => oldApp(server).trash(f), 'uno')).toEqual({ status: 'done' });
    expect(server.portero.trashVersions).toEqual([null]);

    server.settings = { ...server.settings!, minAppVersion: TRASH_VERSION_SINCE };
    expect(await sendToDriveTrash((f) => oldApp(server).trash(f), 'dos')).toEqual({ status: 'outdated', message: t('queue.outdated') });
    expect(purged(server, 'dos')).toBe(false);
    // Lo que ya había pedido se puede repetir: no pasa por la versión.
    expect(await sendToDriveTrash((f) => oldApp(server).trash(f), 'uno')).toEqual({ status: 'done' });
  });

  it('con un portero anterior (no le pasa la versión a la base): la app nueva manda como siempre con la mínima de hoy', async () => {
    const server = workspace(Number(BEFORE));
    server.portero.forwardsAppVersion = false;
    const a = await device(server, SINCE);
    expect(await sendToDriveTrash((f) => a.media.trash(f), 'uno')).toEqual({ status: 'done' });
    expect(purged(server, 'uno')).toBe(true);
    // Subir la mínima a la primera versión que la dice pide el portero actualizado: con el anterior, la base rechaza
    // y ese portero no sabe decir por qué.
    server.settings = { ...server.settings!, minAppVersion: TRASH_VERSION_SINCE };
    expect(await sendToDriveTrash((f) => a.media.trash(f), 'dos')).toEqual({ status: 'error', message: 'The workspace did not answer (503).' });
    expect(purged(server, 'dos')).toBe(false);
  });

  it('con una base que todavía no mira la versión, todo pasa como antes', async () => {
    const server = workspace(9);
    server.trashVersionSince = null;
    expect(await sendToDriveTrash((f) => oldApp(server).trash(f), 'uno')).toEqual({ status: 'done' });
    expect(purged(server, 'uno')).toBe(true);
  });
});

describe('el servidor en memoria frena purge_file como la base', () => {
  const attempt = (server: FakeServer, id: string, version: string | null, user = server.ownerId) => {
    try {
      server.purgeFile(user, id, version);
      return 'ok';
    } catch (err) {
      return (err as Error).message;
    }
  };

  it('sin mínima pasa todo; con versión, se compara con la mínima; sin versión, depende de la primera versión que la manda', () => {
    const cases: [min: number | null, version: string | null, expected: string][] = [
      [null, null, 'ok'],
      [null, '0.001', 'ok'],
      [null, 'invalid', 'ok'],
      [Number(BEFORE), null, 'ok'],
      [Number(BEFORE), '', 'ok'],
      [Number(BEFORE), '0.001', 'app_outdated'],
      [Number(BEFORE), 'invalid', 'app_outdated'],
      [Number(BEFORE), `${BEFORE}0`, 'app_outdated'],
      [Number(BEFORE), BEFORE, 'ok'],
      [Number(BEFORE), SINCE, 'ok'],
      [TRASH_VERSION_SINCE, null, 'app_outdated'],
      [TRASH_VERSION_SINCE, '', 'app_outdated'],
      [TRASH_VERSION_SINCE, BEFORE, 'app_outdated'],
      [TRASH_VERSION_SINCE, SINCE, 'ok'],
      [TRASH_VERSION_SINCE, AFTER, 'ok'],
      [Number(AFTER), SINCE, 'app_outdated'],
    ];
    for (const [min, version, expected] of cases) {
      const server = workspace(min);
      expect(attempt(server, 'uno', version), `mínima ${min}, versión ${JSON.stringify(version)}`).toBe(expected);
      expect(purged(server, 'uno')).toBe(expected === 'ok');
    }
  });

  it('el permiso y el estado del archivo van antes que la versión, y repetir lo ya pedido no pasa por ella', () => {
    const server = workspace(TRASH_VERSION_SINCE);
    server.addMember('lee', 'member');
    server.grant('lee', { projectId: server.workspaceId }, 'edit_pages');
    expect(attempt(server, 'uno', '0.001', 'lee')).toBe('not_allowed');
    expect(attempt(server, 'no-existe', '0.001')).toBe('file_not_found');
    server.mediaFiles.get('dos')!.trashed_at = null;
    expect(attempt(server, 'dos', null)).toBe('file_not_trashed');
    expect(attempt(server, 'uno', SINCE)).toBe('ok');
    const at = server.mediaFiles.get('uno')!.purged_at;
    expect(attempt(server, 'uno', '0.001')).toBe('ok');
    expect(attempt(server, 'uno', null)).toBe('ok');
    expect(server.mediaFiles.get('uno')!.purged_at).toBe(at);
  });
});

describe('la migración', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

  it('la primera versión que manda la suya al portero es una sola: en la migración, en su prueba SQL y en el servidor en memoria', () => {
    const migration = read(`../../supabase/migrations/${MIGRATION}.sql`);
    expect([...migration.matchAll(/min_app_version >= ([\d.]+)\)/g)].map((m) => m[1])).toEqual([SINCE]);
    const sql = read('../../supabase/tests/version_minima_papelera_archivos_permisos.sql');
    expect([...sql.matchAll(/select ([\d.]+)::numeric;/g)].map((m) => m[1])).toEqual([SINCE]);
    // Ninguna otra versión escrita a mano: las demás salen de esa (más o menos un milésimo, o una décima).
    for (const text of [migration, sql]) {
      const others = [...text.matchAll(/\b\d\.\d{3}\b/g)].map((m) => m[0]).filter((v) => !['0.001', '0.002', '0.000', '9.999', SINCE].includes(v));
      expect(others).toEqual([]);
    }
  });

  /**
   * La versión de la entrada del changelog que trajo algo: la más vieja que lo nombra (el changelog va de lo nuevo a
   * lo viejo, así que es la última mención del archivo). `null` si ninguna lo nombra.
   */
  function entryThatBrought(changelog: string, name: string): string | null {
    const at = changelog.lastIndexOf(name);
    if (at < 0) return null;
    const versions = [...changelog.slice(0, at).matchAll(/^v(\d+\.\d{3}) :$/gm)];
    return versions[versions.length - 1]?.[1] ?? null;
  }

  it('es la versión de la entrada del changelog que trajo la migración', () => {
    // Un número más bajo que la versión que de verdad trae el cambio rechazaría versiones permitidas (que no mandan su
    // versión al portero) apenas la mínima llegara a él: quien publica con otro número lo cambia en los tres lugares.
    expect(entryThatBrought(read('../../Docs/Changelog.md'), `${MIGRATION}.sql`)).toBe(SINCE);
  });

  it('una entrada posterior que vuelva a nombrar la migración no cambia cuál la trajo', () => {
    const changelog = [
      '# Changelog',
      'v0.230 :',
      'Un arreglo sobre `una_migracion.sql`.',
      '[Arreglar algo]',
      'v0.218 :',
      'Llega `una_migracion.sql`.',
      '[Traer algo]',
      'v0.217 :',
      'Otra cosa.',
    ].join('\n\n');
    expect(entryThatBrought(changelog, 'una_migracion.sql')).toBe('0.218');
    expect(entryThatBrought(changelog, 'otra_migracion.sql')).toBeNull();
  });
});
