import { isNetworkError, RemoteError } from '../sync/types';

// Los errores del equipo y de permisos, en palabras (ver supabase/migrations/20260930160000_equipo.sql).

const MESSAGES: Record<string, string> = {
  not_allowed: 'You are not allowed to do this.',
  owner_cannot_change: 'Nobody can change or remove the owner of the workspace.',
  member_not_found: 'This person is not an active member of the workspace anymore.',
  grant_not_found: 'That access was already removed, or you cannot change it.',
  grant_not_allowed: 'You can only share what you can edit and create pages in.',
  email_invalid: 'That email does not look right.',
  role_invalid: 'That role is not valid.',
  level_invalid: 'That access level is not valid.',
  target_invalid: 'Choose a project or a page to share.',
  grants_invalid: 'The access for this invitation is not valid.',
  page_create_denied: 'You cannot create pages here: it needs “Edit & create pages”.',
  page_move_denied: 'You cannot move this page there: it needs “Edit & create pages” on the page and on where it goes.',
  page_trash_denied: 'You cannot move this page to the trash or back: it needs “Edit & create pages”.',
  page_edit_denied: 'You cannot edit this page: it needs “Edit”.',
  page_not_found: 'The page is not there anymore, or you cannot edit it (it needs “Edit”).',
  project_not_found: 'The project is not there anymore, or you cannot rename it (it needs “Edit & create pages”).',
};

/** El error de una función del equipo, para mostrarlo en el diálogo. */
export function teamErrorText(err: unknown): string {
  if (isNetworkError(err)) return 'You are offline. Managing people needs an internet connection.';
  const message = err instanceof Error ? err.message : String(err);
  if (MESSAGES[message]) return MESSAGES[message];
  if (err instanceof RemoteError && err.code === 'PGRST202') {
    return 'The workspace database needs an update before people can be managed from the app.';
  }
  return message;
}

/** Un cambio que el servidor rechazó (lista de rechazados): el motivo en palabras si se conoce. */
export function rejectionText(error: string): string {
  if (MESSAGES[error]) return MESSAGES[error];
  if (/row-level security/i.test(error)) return `You do not have permission for this (${error}).`;
  return error;
}
