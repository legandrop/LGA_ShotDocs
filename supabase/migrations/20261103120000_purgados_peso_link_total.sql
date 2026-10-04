-- LGA Shot Docs · restos de SQL de la tanda 18: el peso de un proyecto borrado para siempre (P.14, O4 de la auditoría
-- de la entrega 3; Docs/Doc_Proyectos_Borrar.md, "Cómo quedó (entrega 3)") y el total exacto de los archivos de los
-- links de una página (P.30, D279 B; Docs/Doc_Link_Publico.md, "Cómo quedó la 2b").
--
-- 1. `project_sizes`: un proyecto borrado para siempre (`purged_at`) ya no suma lo que nunca llegó al Drive (ni en la
--    papelera de la app ni como "sin subir"). Esas filas no ocupan nada en el Drive del dueño, ya no se suben (nadie ve
--    el proyecto) y no había forma de sacarlas desde la app. Lo subido sigue contando donde está de verdad: en la
--    papelera de Drive durante 30 días desde que se mandó (después Google ya lo borró y deja de contar solo), como
--    cualquier archivo. Ninguna fila se borra.
-- 2. `public_link_files` suma la columna `total` al final: cuántos archivos registraron los links de la página, aunque
--    la lista siga cortada en 500. Misma lista, mismo orden y mismos permisos; la app publicada no lee la columna nueva.
--
-- Compatible con la app y el portero publicados: `project_sizes` no cambia de firma; `public_link_files` se crea de
-- nuevo con una columna más al final (PostgREST devuelve un objeto por fila y la app vieja ignora la clave). Sube
-- `schema_version` a 25. Va después de la 24.

-- ---------------------------------------------------------------------------------------------------
-- 1. El peso, sin lo nunca subido de un proyecto borrado para siempre
-- ---------------------------------------------------------------------------------------------------
-- El cuerpo de 20261005120000_proyectos_drive.sql y dos cambios: la puerta trae `purged_at` y, en un proyecto borrado
-- para siempre, un archivo sin `drive_id` no tiene estado (no suma en ninguna columna). Lo subido de un proyecto así
-- ya está marcado como mandado a la papelera de Drive (`purge_project` lo exige), así que sigue el primer caso.
create or replace function public.project_sizes()
returns table (project_id uuid,
               drive_bytes bigint, drive_files int,
               trash_bytes bigint, trash_files int,
               drive_trash_bytes bigint, drive_trash_files int,
               pending_bytes bigint, pending_files int)
language sql stable security definer set search_path = ''
as $$
  with gate as materialized (
    select w.id, w.drive_trash_requested_at as requested_at, w.drive_trashed_at as folder_trashed_at,
           w.drive_missing_at as folder_missing_at, w.purged_at,
           case when w.deleted_at is null then private.can_see_file_trash(w.id)
                else private.can_manage_project(w.id) end as allowed
    from public.workspaces w
  ),
  me as materialized (
    select coalesce(private.workspace_role() = 'owner', false) as is_owner
  ),
  state as (
    select f.project_id, f.size, f.drive_id is not null as uploaded,
           case
             when f.drive_trashed_at is not null then
               case when f.drive_id is not null
                         and greatest(f.drive_trashed_at, f.uploaded_at) > now() - interval '30 days'
                    then 'drive_trash' end
             when f.drive_id is not null
                  and (g.folder_trashed_at is not null or g.folder_missing_at is not null)
                  and coalesce(f.uploaded_at, '-infinity') <= g.requested_at then
               case when g.folder_missing_at is null
                         and greatest(g.folder_trashed_at, f.uploaded_at) > now() - interval '30 days'
                    then 'drive_trash' end
             -- Borrado para siempre: lo que nunca llegó al Drive no ocupa nada y ya no va a subir.
             when g.purged_at is not null and f.drive_id is null then null
             when f.trashed_at is not null then 'trash'
             when f.drive_id is null then 'pending'
             else 'live'
           end as st
    from public.files f
    join gate g on g.id = f.project_id
    where g.allowed or (select me.is_owner from me)
  ),
  per_project as (
    select s.project_id,
           coalesce(sum(s.size) filter (where s.st = 'live' or (s.st = 'trash' and s.uploaded)), 0)::bigint as drive_bytes,
           (count(*) filter (where s.st = 'live' or (s.st = 'trash' and s.uploaded)))::int as drive_files,
           coalesce(sum(s.size) filter (where s.st = 'trash'), 0)::bigint as trash_bytes,
           (count(*) filter (where s.st = 'trash'))::int as trash_files,
           coalesce(sum(s.size) filter (where s.st = 'drive_trash'), 0)::bigint as drive_trash_bytes,
           (count(*) filter (where s.st = 'drive_trash'))::int as drive_trash_files,
           coalesce(sum(s.size) filter (where s.st = 'pending'), 0)::bigint as pending_bytes,
           (count(*) filter (where s.st = 'pending'))::int as pending_files
    from state s
    group by s.project_id
  )
  select g.id,
         coalesce(p.drive_bytes, 0::bigint), coalesce(p.drive_files, 0),
         coalesce(p.trash_bytes, 0::bigint), coalesce(p.trash_files, 0),
         coalesce(p.drive_trash_bytes, 0::bigint), coalesce(p.drive_trash_files, 0),
         coalesce(p.pending_bytes, 0::bigint), coalesce(p.pending_files, 0)
  from gate g
  left join per_project p on p.project_id = g.id
  where g.allowed
  union all
  -- Los que no ve, todos juntos y sin nombres: solo el dueño.
  select null::uuid,
         coalesce(sum(p.drive_bytes), 0)::bigint, coalesce(sum(p.drive_files), 0)::int,
         coalesce(sum(p.trash_bytes), 0)::bigint, coalesce(sum(p.trash_files), 0)::int,
         coalesce(sum(p.drive_trash_bytes), 0)::bigint, coalesce(sum(p.drive_trash_files), 0)::int,
         coalesce(sum(p.pending_bytes), 0)::bigint, coalesce(sum(p.pending_files), 0)::int
  from gate g
  left join per_project p on p.project_id = g.id
  where not g.allowed and (select me.is_owner from me)
  having count(*) > 0;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 2. Los archivos de los links de una página, con el total
-- ---------------------------------------------------------------------------------------------------
-- El cuerpo de 20261030120000_link_archivos.sql y `total` al final: `count(*) over ()` se calcula sobre todas las filas
-- antes del `limit`, así que dice cuántos hay aunque lleguen 500. Cambiar las columnas de una función que devuelve una
-- tabla pide borrarla y crearla otra vez (en la misma transacción: nadie la ve faltar).
drop function public.public_link_files(uuid);

create function public.public_link_files(p_page uuid)
returns table (id uuid, link_id uuid, link_live boolean, page_id uuid, name text, mime text, size bigint,
               created_at timestamptz, uploaded boolean, trashed boolean, total bigint)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_page is null or not private.sees_deleted(p_page) then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  return query
    select f.id, f.plink_id, l.revoked_at is null,
           (select pf.page_id from public.page_files pf where pf.file_id = f.id order by pf.created_at limit 1),
           f.name, f.mime, f.size, f.created_at, f.drive_id is not null, f.trashed_at is not null,
           count(*) over ()
    from public.public_links l
    join public.files f on f.plink_id = l.id
    where l.page_id = p_page
    order by f.created_at desc, f.id
    limit 500;
end;
$$;

revoke all on function public.public_link_files(uuid) from public, anon;
grant execute on function public.public_link_files(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 3. Versión de la base: la app muestra el total exacto desde la 25. Nada cambia para la versión publicada.
-- ---------------------------------------------------------------------------------------------------
update public.workspace_settings set schema_version = 25 where id and schema_version < 25;

notify pgrst, 'reload schema';
