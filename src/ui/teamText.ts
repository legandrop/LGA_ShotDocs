import { t, type Key } from '../i18n';
import { isNetworkError, RemoteError } from '../sync/types';

// Los errores del equipo y de permisos, en palabras (ver supabase/migrations/20260930160000_equipo.sql). Se
// traducen al mostrarlos, con el idioma de ese momento.

const MESSAGES: Record<string, Key> = {
  not_allowed: 'teamError.notAllowed',
  owner_cannot_change: 'teamError.ownerCannotChange',
  member_not_found: 'teamError.memberNotFound',
  grant_not_found: 'teamError.grantNotFound',
  grant_not_allowed: 'teamError.grantNotAllowed',
  email_invalid: 'teamError.emailInvalid',
  role_invalid: 'teamError.roleInvalid',
  level_invalid: 'teamError.levelInvalid',
  target_invalid: 'teamError.targetInvalid',
  grants_invalid: 'teamError.grantsInvalid',
  invitation_exists: 'teamError.invitationExists',
  invitation_used: 'teamError.invitationUsed',
  invitation_not_found: 'teamError.invitationNotFound',
  session_not_allowed: 'teamError.sessionNotAllowed',
  page_create_denied: 'teamError.pageCreateDenied',
  page_move_denied: 'teamError.pageMoveDenied',
  page_trash_denied: 'teamError.pageTrashDenied',
  page_edit_denied: 'teamError.pageEditDenied',
  page_not_found: 'teamError.pageNotFound',
  page_in_trash: 'teamError.pageInTrash',
  project_not_found: 'teamError.projectNotFound',
};

const known = (message: string): string | null => (Object.hasOwn(MESSAGES, message) ? t(MESSAGES[message]) : null);

/** El error de una función del equipo, para mostrarlo en el diálogo. */
export function teamErrorText(err: unknown): string {
  if (isNetworkError(err)) return t('teamError.offline');
  const message = err instanceof Error ? err.message : String(err);
  const text = known(message);
  if (text) return text;
  if (err instanceof RemoteError && err.code === 'PGRST202') return t('teamError.schema');
  return message;
}

/** Un cambio que el servidor rechazó (lista de rechazados): el motivo en palabras si se conoce. */
export function rejectionText(error: string): string {
  const text = known(error);
  if (text) return text;
  if (/row-level security/i.test(error)) return t('teamError.rls', { error });
  return error;
}
