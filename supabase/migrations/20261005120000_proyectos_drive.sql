-- LGA Shot Docs · la carpeta de un proyecto borrado en la papelera de Drive (P.14, entrega 2;
-- Docs/Doc_Proyectos_Borrar.md, sección 3).
--
-- Con la casilla de la ventana de borrar, la carpeta del proyecto en el Drive del dueño (`LGA_ShotDocs/<Proyecto>`,
-- la que lleva la marca `sdProject`) va entera a la papelera de Drive. Lo hace el portero con la sesión de la
-- persona (`POST /project/trash`); la base decide si puede y guarda el estado en el proyecto, no en cada archivo:
--   drive_trash_requested_at/_by  alguien pidió mandar la carpeta (el proyecto tiene que estar borrado).
--   drive_trashed_at              el portero confirmó que la mandó (o que Drive no la tenía).
--   drive_missing_at/_by          se restauró sin la carpeta: el portero, con Drive conectado a la misma cuenta, no
--                                 la encontró. Es reversible: si la carpeta aparece, `/project/untrash` la trae
--                                 y borra todas las marcas.
-- Mientras haya marca, los archivos subidos del proyecto hasta `drive_trash_requested_at` se tratan como "en la
-- papelera de Drive" (peso, app); los subidos después (a una carpeta nueva) no. Ningún archivo se marca uno por
-- uno salvo cuando ya no hay vuelta: borrar para siempre (entrega 3), o volver a mandar la carpeta de un proyecto
-- que tenía la marca de "sin la carpeta" (la marca vieja se cierra antes de abrir la nueva).
--
-- Quién: dueño o admin del workspace que maneja el proyecto (`private.can_purge_project`), como mandar archivos a
-- la papelera de Drive. Nada se borra: ni filas ni archivos de Drive (la papelera de Drive los guarda 30 días).
--
-- Compatible con la app de la entrega 1: `restore_project(p)` sigue andando igual (el segundo parámetro tiene
-- valor por defecto) y solo falla con `drive_untrash_first` si alguien mandó la carpeta con una app nueva.
-- `trashed_projects` suma columnas al final.

alter table public.workspaces
  add column drive_trash_requested_at timestamptz,
  add column drive_trash_requested_by uuid references auth.users (id) on delete set null,
  add column drive_trashed_at         timestamptz,
  add column drive_missing_at         timestamptz,
  add column drive_missing_by         uuid references auth.users (id) on delete set null,
  add constraint workspaces_drive_requested    check (drive_trash_requested_at is null or deleted_at is not null
                                                      or drive_missing_at is not null),
  add constraint workspaces_drive_requested_by check (drive_trash_requested_by is null or drive_trash_requested_at is not null),
  add constraint workspaces_drive_trashed      check (drive_trashed_at is null or drive_trash_requested_at is not null),
  add constraint workspaces_drive_missing      check (drive_missing_at is null or drive_trash_requested_at is not null),
  add constraint workspaces_drive_missing_by   check (drive_missing_by is null or drive_missing_at is not null);

-- ---------------------------------------------------------------------------------------------------
-- Quién manda o trae la carpeta
-- ---------------------------------------------------------------------------------------------------
create function private.can_purge_project(ws uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.workspace_role() in ('owner', 'admin'), false) and private.can_manage_project(ws);
$$;

-- Solo la llaman funciones `security definer`.
revoke all on function private.can_purge_project(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Para el portero
-- ---------------------------------------------------------------------------------------------------
-- El proyecto y su estado de Drive, si la sesión puede mandar o traer su carpeta; null si no (no dice si existe).
create function public.media_project(p_project uuid)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  r json;
begin
  if p_project is null or not private.can_purge_project(p_project) then
    return null;
  end if;
  select json_build_object('id', w.id, 'name', w.name, 'deleted_at', w.deleted_at,
                           'drive_trash_requested_at', w.drive_trash_requested_at,
                           'drive_trashed_at', w.drive_trashed_at,
                           'drive_missing_at', w.drive_missing_at)
  into r from public.workspaces w where w.id = p_project;
  return r;
end;
$$;

-- Sin vuelta: cada archivo subido del proyecto hasta el pedido queda como mandado a la papelera de Drive (las
-- marcas de hoy, archivo por archivo) y el proyecto deja de tener las suyas. Lo usan borrar para siempre y volver a
-- mandar la carpeta de un proyecto que tenía la marca de "sin la carpeta". En orden de id, como
-- `refresh_project_files`. No llama a nadie de afuera.
create function private.project_files_purged(p_project uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  w record;
begin
  select pr.drive_trash_requested_at, pr.drive_trash_requested_by, pr.drive_trashed_at, pr.drive_missing_at into w
  from public.workspaces pr where pr.id = p_project;
  if w.drive_trash_requested_at is null then
    return;
  end if;
  perform 1 from public.files f
  where f.project_id = p_project and f.drive_id is not null
    and coalesce(f.uploaded_at, '-infinity') <= w.drive_trash_requested_at
  order by f.id for update;
  update public.files f
  set trashed_at       = coalesce(f.trashed_at, w.drive_trash_requested_at),
      purged_at        = coalesce(f.purged_at, w.drive_trash_requested_at),
      purged_by        = case when f.purged_at is null then w.drive_trash_requested_by else f.purged_by end,
      drive_trashed_at = coalesce(f.drive_trashed_at, w.drive_trashed_at, w.drive_missing_at, w.drive_trash_requested_at)
  where f.project_id = p_project and f.drive_id is not null
    and coalesce(f.uploaded_at, '-infinity') <= w.drive_trash_requested_at;
  update public.workspaces
  set drive_trash_requested_at = null, drive_trash_requested_by = null, drive_trashed_at = null,
      drive_missing_at = null, drive_missing_by = null
  where id = p_project;
end;
$$;

-- Pide mandar la carpeta (antes de tocar Drive). Solo con el proyecto borrado. Repetirlo no cambia nada. Si el
-- proyecto tenía la marca de "sin la carpeta" (se restauró sin ella y se volvió a borrar), esa marca se cierra
-- archivo por archivo y empieza un pedido nuevo: la carpeta nueva es otra.
create function public.request_project_drive_trash(p_project uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  w record;
begin
  select pr.deleted_at, pr.drive_trash_requested_at, pr.drive_missing_at into w
  from public.workspaces pr where pr.id = p_project for update;
  if not found or not private.can_purge_project(p_project) then
    raise exception 'not_allowed' using errcode = '42501',
      hint = 'Only an owner or admin of the workspace who manages the project sends its folder to the Google Drive trash.';
  end if;
  if w.deleted_at is null then
    raise exception 'project_not_deleted' using errcode = 'P0001';
  end if;
  if w.drive_missing_at is not null then
    perform private.project_files_purged(p_project);
    w.drive_trash_requested_at := null;
  end if;
  if w.drive_trash_requested_at is null then
    update public.workspaces set drive_trash_requested_at = now(), drive_trash_requested_by = auth.uid()
    where id = p_project;
  end if;
end;
$$;

-- La confirma el portero después de mandar la carpeta (o de ver que Drive no la tiene). Repetirla no cambia nada.
create function public.project_drive_trashed(p_project uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  w record;
begin
  select pr.drive_trash_requested_at, pr.drive_trashed_at, pr.drive_missing_at into w
  from public.workspaces pr where pr.id = p_project for update;
  if not found or not private.can_purge_project(p_project) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if w.drive_trash_requested_at is null or w.drive_missing_at is not null then
    raise exception 'project_drive_not_requested' using errcode = 'P0001';
  end if;
  if w.drive_trashed_at is null then
    update public.workspaces set drive_trashed_at = now() where id = p_project;
  end if;
end;
$$;

-- La carpeta salió de la papelera de Drive, o apareció (Drive reconectado a la cuenta de antes): el proyecto
-- vuelve a tener sus archivos. La llama el portero después de traerla, con el proyecto borrado o ya restaurado
-- sin ella. Borra las marcas de Drive del proyecto; si no había, no hace nada.
create function public.project_drive_untrashed(p_project uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from public.workspaces pr where pr.id = p_project for update;
  if not found or not private.can_purge_project(p_project) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.workspaces
  set drive_trash_requested_at = null, drive_trash_requested_by = null, drive_trashed_at = null,
      drive_missing_at = null, drive_missing_by = null
  where id = p_project and drive_trash_requested_at is not null;
end;
$$;

revoke all on function private.project_files_purged(uuid) from public, anon, authenticated;
revoke all on function public.media_project(uuid) from public, anon;
revoke all on function public.request_project_drive_trash(uuid) from public, anon;
revoke all on function public.project_drive_trashed(uuid) from public, anon;
revoke all on function public.project_drive_untrashed(uuid) from public, anon;
grant execute on function public.media_project(uuid) to authenticated;
grant execute on function public.request_project_drive_trash(uuid) to authenticated;
grant execute on function public.project_drive_trashed(uuid) to authenticated;
grant execute on function public.project_drive_untrashed(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Restaurar: con la carpeta pedida para la papelera de Drive, primero traerla
-- ---------------------------------------------------------------------------------------------------
-- `drive_untrash_first` (P0001) si la carpeta está pedida o en la papelera de Drive, salvo `p_without_drive`, que la
-- app usa solo cuando el portero, con Drive conectado a la misma cuenta, respondió que la carpeta no está
-- (`drive: 'missing'`). Entonces el proyecto vuelve con la marca `drive_missing_at` (reversible: ningún archivo se
-- marca) y el texto vuelve. Lo demás, como en la entrega 1.
drop function public.restore_project(uuid);
create function public.restore_project(p_project uuid, p_without_drive boolean default false)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  w record;
begin
  select pr.owner_id, pr.deleted_at, pr.drive_trash_requested_at, pr.drive_missing_at into w
  from public.workspaces pr where pr.id = p_project for update;
  if not found or not private.could_view_project(p_project, w.owner_id) then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;
  if not private.can_manage_project(p_project) then
    raise exception 'not_allowed' using errcode = '42501',
      hint = 'Restoring a project needs the same permission as deleting it.';
  end if;
  if w.deleted_at is null then
    return;
  end if;
  if w.drive_trash_requested_at is not null and w.drive_missing_at is null then
    if not coalesce(p_without_drive, false) then
      raise exception 'drive_untrash_first' using errcode = 'P0001',
        hint = 'Bring the project folder back from the Google Drive trash first, or restore it without its files.';
    end if;
    update public.workspaces set drive_missing_at = now(), drive_missing_by = auth.uid() where id = p_project;
  end if;
  update public.workspaces set deleted_at = null, deleted_by = null where id = p_project;
  perform private.refresh_project_files(p_project);
end;
$$;

revoke all on function public.restore_project(uuid, boolean) from public, anon;
grant execute on function public.restore_project(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- La papelera de proyectos: el estado de Drive
-- ---------------------------------------------------------------------------------------------------
-- Como en la entrega 1, más: `drive_trash_requested_at`, `drive_trashed_at` y `drive_missing_at` (solo a quien lo
-- maneja) y `can_purge` (si la sesión puede mandar o traer la carpeta). Cambia lo que devuelve: drop y create.
drop function public.trashed_projects();
create function public.trashed_projects()
returns table (id uuid, name text, archived_at timestamptz, deleted_at timestamptz, deleted_by uuid,
               deleted_by_email text, days_left int, can_restore boolean, pages int, files int,
               drive_trash_requested_at timestamptz, drive_trashed_at timestamptz, drive_missing_at timestamptz,
               can_purge boolean)
language sql stable security definer set search_path = ''
as $$
  select w.id, w.name, w.archived_at, w.deleted_at,
         case when m.can or m.staff then w.deleted_by end,
         case when m.can or m.staff then u.email::text end,
         greatest(0, ceil(extract(epoch from (w.deleted_at + interval '30 days' - now())) / 86400))::int,
         m.can,
         case when m.can then (n.j ->> 'pages')::int end,
         case when m.can then (n.j ->> 'files')::int end,
         case when m.can then w.drive_trash_requested_at end,
         case when m.can then w.drive_trashed_at end,
         case when m.can then w.drive_missing_at end,
         m.can and private.can_purge_project(w.id)
  from public.workspaces w
  cross join lateral (
    select private.can_manage_project(w.id) as can,
           coalesce(private.workspace_role() in ('owner', 'admin'), false) as staff
  ) m
  cross join lateral (select case when m.can then private.project_numbers(w.id) end as j) n
  left join auth.users u on u.id = w.deleted_by
  where w.deleted_at is not null
    and private.could_view_project(w.id, w.owner_id)
  order by w.deleted_at desc, w.id;
$$;

revoke all on function public.trashed_projects() from public, anon;
grant execute on function public.trashed_projects() to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- project_sizes: los archivos de una carpeta en la papelera de Drive o que no está
-- ---------------------------------------------------------------------------------------------------
-- Como en la entrega 1, con un estado más mirado justo después de la marca por archivo: un archivo subido hasta el
-- pedido (`uploaded_at <= drive_trash_requested_at`) de un proyecto con la carpeta confirmada en la papelera de
-- Drive está "en la papelera de Drive" durante 30 días desde la confirmación (después Google ya lo borró y no
-- cuenta); con la marca de "sin la carpeta" no cuenta (no está en este Drive). Uno pedido sin confirmar sigue
-- contando como antes (puede que siga en Drive). Los subidos después del pedido van a otra carpeta: como siempre.
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
           w.drive_missing_at as folder_missing_at,
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

update public.workspace_settings set schema_version = 10 where id and schema_version < 10;

notify pgrst, 'reload schema';
