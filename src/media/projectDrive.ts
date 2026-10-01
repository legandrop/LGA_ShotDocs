import type { SupabaseClient } from '@supabase/supabase-js';
import { t } from '../i18n';
import { Portero, PorteroError, readMediaUrl, sessionToken, type DriveStatus, type ProjectDriveResult } from './portero';

// La carpeta de un proyecto borrado en la papelera de Drive (P.14, entrega 2; Docs/Doc_Proyectos_Borrar.md, sección
// 3): la app le pide al portero que la mande (`/project/trash`) o la traiga (`/project/untrash`). La base decide
// quién puede (dueño y admins que manejan el proyecto) y guarda el estado en el proyecto, no en cada archivo.

export interface ProjectDrive {
  /** Manda a la papelera de Drive la carpeta de un proyecto ya borrado. Repetirlo no hace nada de más. */
  trash(projectId: string): Promise<ProjectDriveResult>;
  /**
   * La trae de la papelera de Drive (antes de restaurar, o *Look for its files again*). `missing`: Drive, conectado a
   * la misma cuenta con la que se mandó, no tiene ninguna carpeta del proyecto; la base no se tocó.
   */
  untrash(projectId: string): Promise<ProjectDriveResult>;
  /** Si Drive está conectado (para ofrecer la casilla de la ventana de borrar). */
  status(): Promise<DriveStatus>;
}

/** El cliente con la dirección del portero ya conocida (`workspace_settings.media_url`). */
export function projectDriveAt(baseUrl: string, client: SupabaseClient): ProjectDrive {
  const portero = new Portero(baseUrl, { token: sessionToken(client) });
  return {
    trash: (id) => portero.projectTrash(id),
    untrash: (id) => portero.projectUntrash(id),
    status: () => portero.status(),
  };
}

/**
 * El cliente que busca la dirección del portero la primera vez que hace falta (la pantalla "sin proyectos" no tiene
 * la sincronización abierta). Sin portero, cada pedido falla con `code: 'no_portero'`.
 */
export function lazyProjectDrive(client: SupabaseClient): ProjectDrive {
  let opened: Promise<ProjectDrive> | null = null;
  const open = () =>
    (opened ??= readMediaUrl(client).then((url) => {
      if (!url) throw new PorteroError(t('projectDrive.noPortero'), 0, false, 'no_portero');
      return projectDriveAt(url, client);
    })).catch((err: unknown) => {
      opened = null;
      throw err;
    });
  return {
    trash: async (id) => (await open()).trash(id),
    untrash: async (id) => (await open()).untrash(id),
    status: async () => (await open()).status(),
  };
}

/** Lo que pasó, en palabras de la persona (los errores del portero llevan un `code` fijo, Doc_Portero.md). */
export function projectDriveError(err: unknown): string {
  if (err instanceof PorteroError) {
    switch (err.code) {
      case 'drive_not_connected':
        return t('projectDrive.notConnected');
      case 'drive_other_account':
        return t('projectDrive.otherAccount');
      case 'drive_mismatch':
        return t('projectDrive.mismatch');
      case 'drive_failed':
        return t('projectDrive.driveFailed');
      case 'not_found':
      case 'not_allowed':
        return t('projectDrive.notAllowed');
      case 'db_outdated':
        return t('projectDrive.outdated');
      case 'project_restored':
        return t('projectDrive.restoredMeanwhile');
      case 'no_portero':
        return t('projectDrive.noPortero');
    }
    if (err.status === 0 || err.status === 408) return t('projectDrive.unreachable');
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * El nombre de la carpeta del proyecto en Drive, como lo arma el portero (`folderName` de portero/src/core.ts: sin
 * espacios ni caracteres raros). Solo para mostrarlo en la ventana; si el dueño la renombró a mano, Drive tiene otro.
 */
export function driveFolderLabel(projectName: string): string {
  const clean = Array.from(
    projectName
      .normalize('NFC')
      .replace(/[^\p{L}\p{M}\p{N}\s_\-.,()&+']/gu, '')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[_.]+|[_.]+$/g, ''),
  )
    .slice(0, 100)
    .join('');
  return `LGA_ShotDocs/${clean || 'Project'}`;
}
