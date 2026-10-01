-- LGA Shot Docs · carpetas (P.9 del roadmap; Docs/Doc_Carpetas.md): `media_file` dice también quién agregó el
-- archivo (`created_by`).
--
-- El portero deja subir adentro de una carpeta soltada en una página solo a quien la agregó. El nivel que da
-- `media_file` es el más alto entre las páginas que usan el archivo, y alguien con "Ver" en una página y "Editar" en
-- otra del mismo proyecto puede pegar el bloque de la carpeta en la suya: sin esto, subiría adentro de una carpeta
-- que ven todos los de la primera. Hasta tener este dato, el portero toma como creador a quien la creó en Drive.
--
-- Compatible con la app y el portero publicados: la función conserva su firma y suma una clave al JSON (los dos la
-- leen por nombre). No cambia permisos ni datos; no sube `schema_version` (nada de la app depende de esto).

create or replace function public.media_file(p_file_id uuid)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  lvl int := private.file_level(p_file_id);
  r   json;
begin
  if lvl < 1 then
    return null;
  end if;
  select json_build_object(
    'id', f.id, 'project_id', f.project_id, 'project_name', w.name, 'name', f.name, 'mime', f.mime,
    'size', f.size, 'drive_id', f.drive_id, 'created_at', f.created_at, 'level', lvl,
    'trashed_at', f.trashed_at, 'purged_at', f.purged_at, 'drive_trashed_at', f.drive_trashed_at,
    'created_by', f.created_by)
  into r
  from public.files f
  join public.workspaces w on w.id = f.project_id
  where f.id = p_file_id;
  return r;
end;
$$;
