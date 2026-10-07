-- LGA Shot Docs · la papelera de archivos de todos los proyectos en un solo pedido (Docs/Doc_Proyectos_Borrar.md,
-- "Cómo quedó: una sola papelera"; Docs/Plan_Workspaces.md, paso 11).
--
-- Con *All projects*, la papelera pedía `trashed_files` una vez por proyecto: con muchos proyectos, muchos pedidos la
-- primera vez que se abre. `trashed_files_all()` junta lo mismo en uno.
--
--   - Recorre los proyectos sin borrar y, de los que la sesión puede ver la papelera de archivos
--     (`private.can_see_file_trash`, la regla de `trashed_files`), devuelve las filas de `trashed_files` de ese
--     proyecto con `project_id` adelante. No repite la consulta: llama a `trashed_files`, así que las dos dan siempre
--     lo mismo.
--   - De un proyecto cuya papelera ve y está vacía devuelve una fila con solo `project_id` (`id` nulo): la app
--     distingue "vacía" de "no la ves" (que no trae ninguna fila).
--   - De un proyecto que no ve, borrado o inexistente para la sesión, nada: ni filas ni la marca.
--
-- Permisos: ninguno nuevo. Cada proyecto pasa por la misma regla que `trashed_files(proyecto)`: quien recibe una fila
-- por acá la recibe también por allá, y quien allá recibe `not_allowed` acá no recibe nada de ese proyecto. Solo lee
-- (`stable`). Es `security definer` como `trashed_files`, que lee tablas que la sesión no lee enteras. `anon` no la
-- ejecuta.
--
-- Compatible con la app publicada: no cambia nada de lo que existe; sigue pidiendo `trashed_files` por proyecto. No
-- sube `schema_version`: la app nueva la prueba y, si la base no la tiene, pide por proyecto como antes.

create function public.trashed_files_all()
returns table (project_id uuid, id uuid, name text, mime text, size bigint, thumb_at timestamptz,
               trashed_at timestamptz, days_left int, purged_at timestamptz, in_trashed_page boolean,
               trashed_page_title text, in_deleted_project boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  w uuid;
begin
  for w in
    select ws.id from public.workspaces ws where ws.deleted_at is null order by ws.id
  loop
    if private.can_see_file_trash(w) then
      return query
        select w, t.id, t.name, t.mime, t.size, t.thumb_at, t.trashed_at, t.days_left, t.purged_at,
               t.in_trashed_page, t.trashed_page_title, t.in_deleted_project
        from public.trashed_files(w) t;
      if not found then
        -- La ve y está vacía: solo el proyecto.
        return query
          select w, null::uuid, null::text, null::text, null::bigint, null::timestamptz, null::timestamptz, null::int,
                 null::timestamptz, null::boolean, null::text, null::boolean;
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function public.trashed_files_all() from public, anon;
grant execute on function public.trashed_files_all() to authenticated;

notify pgrst, 'reload schema';
