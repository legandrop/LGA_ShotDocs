import { describe, expect, it } from 'vitest';
import { folderName } from '../../portero/src/core';
import { PorteroError } from './portero';
import { driveFolderLabel, lazyProjectDrive, projectDriveError } from './projectDrive';
import { PROJECT_DRIVE_SCHEMA_VERSION, PROJECT_STATES_SCHEMA_VERSION, SupabaseRemote } from '../sync/remote';

// La carpeta de un proyecto borrado en la papelera de Drive, del lado de la app (P.14, entrega 2): el nombre que
// muestra la ventana, los errores del portero en palabras, las columnas que pide la sincronización según la versión
// de la base, y `restore_project` con su segundo parámetro solo cuando hace falta.

describe('la carpeta de un proyecto en Drive, en la app', () => {
  it('el nombre que muestra la ventana es el que arma el portero', () => {
    for (const name of ['Bosque Negro', 'Spot Coca-Cola / 2026', '  ERSO (prueba)  ', 'Año: ñandú ✨', '', '...']) {
      expect(driveFolderLabel(name)).toBe(`LGA_ShotDocs/${folderName(name)}`);
    }
  });

  it('los errores del portero, en palabras; lo que no conoce, con su mensaje', () => {
    const err = (code?: string, status = 409) => projectDriveError(new PorteroError('raw', status, false, code));
    expect(err('drive_other_account')).toContain('connected to another account');
    expect(err('drive_not_connected', 503)).toContain('not connected');
    expect(err('drive_mismatch', 403)).toContain('does not belong to this project');
    expect(err('drive_failed', 502)).toContain('Try again');
    expect(err('project_restored')).toContain('restored the project meanwhile');
    expect(err(undefined, 0)).toBe('Could not reach the file server.');
    expect(err('otra_cosa')).toBe('raw');
    expect(projectDriveError(new Error('x'))).toBe('x');
  });

  it('sin portero en el workspace, el cliente perezoso lo dice (y vuelve a preguntar la próxima vez)', async () => {
    let asked = 0;
    const client = {
      from: () => ({
        select: () => ({
          maybeSingle: async () => {
            asked++;
            return { data: { media_url: null }, error: null };
          },
        }),
      }),
    };
    const drive = lazyProjectDrive(client as never);
    await expect(drive.untrash('p')).rejects.toMatchObject({ code: 'no_portero' });
    await expect(drive.trash('p')).rejects.toMatchObject({ code: 'no_portero' });
    expect(asked).toBe(2);
  });

  it('con la versión 10, fetchProjects pide también las columnas de Drive; si faltan (42703), sigue con archived_at', async () => {
    const calls: string[] = [];
    let missing = true;
    const client = {
      from: () => ({
        select: (columns: string) => ({
          order: () => ({
            limit: async () => {
              calls.push(columns);
              if (missing && columns.includes('drive_')) {
                return { data: null, error: { message: 'column workspaces.drive_missing_at does not exist', code: '42703' }, status: 400 };
              }
              return { data: [{ id: 'p1', name: 'P', created_at: '2026-01-01', owner_id: 'u' }], error: null, status: 200 };
            },
          }),
        }),
      }),
    };
    const remote = new SupabaseRemote(client as never);
    await remote.fetchProjects(PROJECT_STATES_SCHEMA_VERSION);
    expect(calls).toEqual(['id, name, created_at, owner_id, archived_at']);
    calls.length = 0;
    expect(await remote.fetchProjects(PROJECT_DRIVE_SCHEMA_VERSION)).toHaveLength(1);
    expect(calls).toEqual([
      'id, name, created_at, owner_id, archived_at, drive_trash_requested_at, drive_missing_at',
      'id, name, created_at, owner_id, archived_at',
    ]);
    // Lo recuerda un rato: no vuelve a pedirlas enseguida.
    calls.length = 0;
    missing = false;
    await remote.fetchProjects(PROJECT_DRIVE_SCHEMA_VERSION);
    expect(calls).toEqual(['id, name, created_at, owner_id, archived_at']);
  });

  it('restore_project lleva p_without_drive solo cuando hace falta (una base de la versión 9 tiene un parámetro)', async () => {
    const args: unknown[] = [];
    const remote = new SupabaseRemote({
      rpc: async (_fn: string, a: unknown) => {
        args.push(a);
        return { data: null, error: null, status: 204 };
      },
    } as never);
    await remote.restoreProject('p');
    await remote.restoreProject('p', true);
    expect(args).toEqual([{ p_project: 'p' }, { p_project: 'p', p_without_drive: true }]);
  });

  it('trashed_projects con las columnas de Drive (versión 10) y sin ellas (versión 9)', async () => {
    const rows = (data: unknown) =>
      new SupabaseRemote({ rpc: async () => ({ data, error: null, status: 200 }) } as never).trashedProjects();
    const base = { id: 'p', name: 'P', archived_at: null, deleted_at: '2026-10-01T00:00:00Z', deleted_by: null, deleted_by_email: null, days_left: 30, can_restore: true, pages: 1, files: 1 };
    expect((await rows([base]))![0]).toMatchObject({ drive_trash_requested_at: null, drive_trashed_at: null, drive_missing_at: null, can_purge: false });
    const sent = { ...base, drive_trash_requested_at: '2026-10-01T01:00:00Z', drive_trashed_at: '2026-10-01T01:00:05Z', drive_missing_at: null, can_purge: true };
    expect((await rows([sent]))![0]).toMatchObject({ drive_trashed_at: '2026-10-01T01:00:05Z', can_purge: true });
  });
});
