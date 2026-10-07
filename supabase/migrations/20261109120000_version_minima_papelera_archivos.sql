-- LGA Shot Docs · la versión mínima de la app también frena mandar archivos a la papelera de Drive (B.17;
-- Docs/Doc_Sincronizacion.md, "La versión mínima y la papelera de archivos"; Docs/Doc_Portero.md, `POST /trash`).
--
-- `workspace_settings.min_app_version` ya frena el contenido, la cola de archivos, el árbol, los comentarios, los
-- proyectos, las versiones con nombre y compartir. Quedaba afuera `purge_file`: lo llama el portero con la sesión de
-- la persona, y el portero no sabía qué versión de la app se lo pedía. Desde esta versión la app le manda la suya al
-- portero en `POST /trash`, y el portero se la pasa a la base en el header `x-shotdocs-version` de `purge_file`.
--
-- La regla (`private.require_file_trash_version`), pensada para que el orden en que se publican la base, el portero y
-- la app no importe:
--   - Con el header, lo compara con la mínima como todo lo demás (`private.app_version_allowed`): menor o ilegible, el
--     503 `app_outdated` de siempre, sin escribir nada.
--   - Sin el header (un portero anterior, o una app anterior que todavía no le manda su versión al portero), pasa
--     como hasta ahora, salvo que la mínima sea la primera versión que lo manda o más: recién ahí toda app permitida
--     lo manda, y un pedido sin header es de una app más vieja que la mínima (o de un portero sin actualizar).
--
-- OJO: 0.218 es la primera versión de la app que le manda su versión al portero. Quien publica pone el número real acá,
-- en supabase/tests/version_minima_papelera_archivos_permisos.sql (`pg_temp.since`) y en `TRASH_VERSION_SINCE` de
-- src/sync/testing.ts antes de aplicar (src/media/trashVersion.test.ts comprueba que los tres coincidan y los compara
-- con la entrada del changelog que nombra esta migración). Un número más bajo que la versión real rechazaría versiones
-- permitidas. Un workspace con su propio portero lo actualiza antes de subir la mínima a ese número.
--
-- Corre después de los permisos y del estado del archivo (que avisan antes) y solo cuando la fila va a cambiar: pedir
-- de nuevo algo ya pedido no pasa por acá. `media_purged` (la confirmación del portero, después de mandarlo a Drive)
-- no se frena: lo que ya se pidió tiene que poder terminar.
--
-- Permisos: ninguno nuevo; nadie puede hacer nada que antes no pudiera. Solo se rechaza a una app más vieja que la
-- mínima.
--
-- Compatible con la app y el portero publicados: `purge_file` conserva la firma, el resultado, los errores y los
-- permisos; con la mínima de hoy (menor que 0.218) un pedido sin header pasa igual que antes. No sube
-- `schema_version`: la app manda su versión siempre y una base sin esta migración la ignora.

-- ¿Este pedido puede mandar un archivo a la papelera de Drive? Rechaza con el error que todas las versiones entienden
-- (503, `app_outdated`), como `private.require_write_version`. Quien llega hasta acá es siempre la sesión de una
-- persona (los permisos de `purge_file` lo exigen antes).
create function private.require_file_trash_version()
returns void
language plpgsql stable security definer set search_path = ''
as $$
declare
  v  constant text := private.request_app_version();
  ok boolean;
begin
  if v is not null then
    ok := private.app_version_allowed(v);
  else
    ok := not exists (select 1 from public.workspace_settings s where s.id and s.min_app_version >= 0.218);
  end if;
  if ok then
    return;
  end if;
  raise sqlstate 'PGRST' using
    message = json_build_object(
      'code', 'P0001',
      'message', 'app_outdated',
      'details', null,
      'hint', 'This version of the app is too old for this workspace. Reload the app to update it.')::text,
    detail = json_build_object('status', 503, 'headers', json_build_object())::text;
end;
$$;

revoke all on function private.require_file_trash_version() from public, anon, authenticated;

-- `purge_file` como en 20261001120000_proyectos_archivar_borrar.sql, más la versión antes de marcar.
create or replace function public.purge_file(p_file uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  f record;
begin
  select fl.project_id, fl.trashed_at, fl.purged_at into f from public.files fl where fl.id = p_file for update;
  if not found or (private.file_level(p_file) < 1 and not private.can_see_file_trash(f.project_id)) then
    raise exception 'file_not_found' using errcode = 'P0002';
  end if;
  if not private.can_purge_files(f.project_id) then
    raise exception 'not_allowed' using errcode = '42501',
      hint = 'Only the owner or an admin of the workspace sends files to the Google Drive trash.';
  end if;
  if f.trashed_at is null then
    raise exception 'file_not_trashed' using errcode = 'P0001',
      hint = 'A page still uses this file: it is not in the trash.';
  end if;
  if f.purged_at is null then
    if private.file_in_deleted_project(p_file) then
      raise exception 'file_in_deleted_project' using errcode = 'P0001',
        hint = 'A page of a deleted project uses this file: it comes back if that project is restored.';
    end if;
    perform private.require_file_trash_version();
    update public.files set purged_at = now(), purged_by = auth.uid() where id = p_file;
  end if;
end;
$$;

notify pgrst, 'reload schema';
