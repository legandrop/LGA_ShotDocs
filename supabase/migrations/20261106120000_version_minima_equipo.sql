-- LGA Shot Docs · la versión mínima de la app también frena compartir e invitar (B.17; Docs/Doc_Sincronizacion.md,
-- "La versión mínima, el equipo y los permisos").
--
-- `workspace_settings.min_app_version` ya frena el contenido, la cola de archivos, el árbol, los comentarios, los
-- proyectos y las versiones con nombre. Quedaba afuera todo lo que cambia quién ve qué: una versión anterior a la
-- mínima, abierta en una pestaña, seguía compartiendo, sacando permisos, invitando, cambiando roles y sacando personas
-- del workspace. Esas versiones no hacen lo que la mínima exige antes de compartir (por ejemplo, subir lo pendiente
-- de la rama antes de darle acceso a alguien que no ve lo borrado).
--
-- `grants`, `members` e `invitations` se escriben solo con funciones (`share`, `unshare`, `create_invitation`,
-- `revoke_invitation`, `accept_invitations`, `set_member_role`, `remove_member` y las que llaman a `share`:
-- `decide_access_request` y `share_for_mention`). Como con los comentarios (20261008120000_version_minima_arbol.sql),
-- lo mira un trigger en cada tabla y no el cuerpo de cada función: ninguna función cambia, y una función nueva que
-- escriba estas tablas queda frenada sin acordarse de nada.
--
--   - Corre después de los permisos de cada función (que avisan antes) y solo cuando una fila se crea o cambia de
--     verdad: repetir algo que ya está hecho (compartir con el mismo permiso, revocar lo revocado) no pasa por acá.
--   - La regla es la de siempre (`private.require_session_write_version`): mira solo los pedidos de una sesión de la
--     app; con el header `x-shotdocs-version`, lo compara con la mínima; sin header, rechaza solo con una mínima de
--     0.099 o más. La consola, las migraciones, la clave de servicio y los hooks de login no se frenan.
--   - El rechazo es el mismo 503 `app_outdated`, y deshace todo lo que la función había hecho en ese pedido.
--   - Borrar una cuenta también dispara los triggers de update: el `on delete set null` de `granted_by`, `invited_by`
--     y las demás columnas que apuntan a una cuenta cambia filas. Sin sesión de la app, que es como borra el servicio
--     de login, pasa; con los datos de una sesión puestos a mano y sin el header (impersonando desde el editor SQL),
--     daría el 503.
--
-- Permisos: ninguno nuevo; nadie puede hacer nada que antes no pudiera. Solo se rechaza a una app más vieja que la
-- mínima.
--
-- No frena la papelera de archivos: mandar un archivo a la papelera de Drive (`purge_file`) lo llama el portero con la
-- sesión de la persona y sin la versión de la app; frenarlo pide que el portero la reciba y la pase.
--
-- Compatible con la app y el portero publicados: no cambia firmas, cuerpos, datos ni permisos. Toda versión igual o
-- mayor que la mínima manda el header y sigue igual; el portero no escribe estas tablas. No sube `schema_version`: la
-- app manda el header siempre y una base sin esta migración lo ignora.

create function private.team_write_version()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_session_write_version();
  return null;
end;
$$;

revoke all on function private.team_write_version() from public, anon, authenticated;

create trigger grants_write_version_insert
  after insert on public.grants
  for each row execute function private.team_write_version();
create trigger grants_write_version_update
  after update on public.grants
  for each row when (old.* is distinct from new.*)
  execute function private.team_write_version();

create trigger members_write_version_insert
  after insert on public.members
  for each row execute function private.team_write_version();
create trigger members_write_version_update
  after update on public.members
  for each row when (old.* is distinct from new.*)
  execute function private.team_write_version();

create trigger invitations_write_version_insert
  after insert on public.invitations
  for each row execute function private.team_write_version();
create trigger invitations_write_version_update
  after update on public.invitations
  for each row when (old.* is distinct from new.*)
  execute function private.team_write_version();
