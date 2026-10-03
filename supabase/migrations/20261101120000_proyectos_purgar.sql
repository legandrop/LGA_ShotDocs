-- LGA Shot Docs · borrar un proyecto para siempre (P.14, entrega 3, *Delete forever*; Docs/Doc_Proyectos_Borrar.md,
-- secciones 2.2 y 2.3, y "Cómo quedó (entrega 3)").
--
-- *Delete forever* no borra ninguna fila: marca el proyecto (`purged_at`, `purged_by`), que sale de la papelera y ya no
-- se restaura desde la app. Sus archivos subidos quedan marcados como mandados a la papelera de Drive (la carpeta tiene
-- que haber ido antes: `drive_trash_first`). El texto, las páginas y los comentarios siguen en la base y se recuperan
-- solo a mano (SQL del dueño de la base); los archivos, desde la papelera de Drive mientras Google los tenga.
--
-- Recién a los 30 días de borrado (`project_trash_not_due`): "se puede restaurar durante 30 días" se cumple siempre.
-- Solo dueño y admins que manejan el proyecto (`private.can_purge_project`, D-23). Nada automático.
--
-- Además de la función nueva:
--   - `restore_project`, `request_project_drive_trash` y `project_drive_untrashed` rechazan uno borrado para siempre
--     (`project_purged`): nada lo trae de vuelta desde la app ni vuelve a pedir su carpeta.
--   - `trashed_projects` lo deja afuera (misma firma: la app publicada lo deja de ver sin cambiar nada).
--   - `media_project` suma `purged_at` (el portero no manda ni trae su carpeta).
--   - Un archivo de otro proyecto usado solo en páginas de uno borrado para siempre deja de estar "en un proyecto
--     borrado" (`file_in_deleted_project`) y "en una página de la papelera" (`trashed_files`, `files_due_for_purge`):
--     esas páginas ya no vuelven, así que se puede mandar a la papelera de Drive desde la papelera de su proyecto.
--
-- Compatible con la app y el portero publicados: ninguna firma cambia; sube `schema_version` a 23 (la app ofrece
-- *Delete forever* desde ahí). Va después de la 22 (*Request access*).

alter table public.workspaces
  add column purged_at timestamptz,
  add column purged_by uuid references auth.users (id) on delete set null,
  add constraint workspaces_purged    check (purged_at is null or deleted_at is not null),
  add constraint workspaces_purged_by check (purged_by is null or purged_at is not null);

-- ---------------------------------------------------------------------------------------------------
-- 1. Borrar para siempre
-- ---------------------------------------------------------------------------------------------------
-- Errores: `project_not_found` (P0002) si no existe o la sesión no lo veía; `not_allowed` (42501) si lo ve pero no es
-- dueño ni admin que lo maneja; `project_not_deleted` (P0001); `project_trash_not_due` (P0001) antes de los 30 días;
-- `drive_trash_first` (P0001) si tiene archivos subidos fuera de la papelera de Drive que la carpeta mandada no cubre
-- (o la carpeta está pedida y sin confirmar); `app_outdated` con una versión de la app más vieja que la mínima.
-- Repetirlo no cambia nada.
create function public.purge_project(p_project uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  w record;
begin
  select pr.owner_id, pr.deleted_at, pr.drive_trash_requested_at, pr.drive_trashed_at, pr.drive_missing_at,
         pr.purged_at into w
  from public.workspaces pr where pr.id = p_project for update;
  if not found or not private.could_view_project(p_project, w.owner_id) then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;
  if not private.can_purge_project(p_project) then
    raise exception 'not_allowed' using errcode = '42501',
      hint = 'Only an owner or admin of the workspace who manages the project deletes it forever.';
  end if;
  if w.purged_at is not null then
    return;
  end if;
  if w.deleted_at is null then
    raise exception 'project_not_deleted' using errcode = 'P0001';
  end if;
  if w.deleted_at > now() - interval '30 days' then
    raise exception 'project_trash_not_due' using errcode = 'P0001',
      hint = 'A deleted project can be deleted forever 30 days after it was deleted.';
  end if;
  if exists (
       select 1 from public.files f
       where f.project_id = p_project and f.drive_id is not null and f.drive_trashed_at is null
         and not ((w.drive_trashed_at is not null or w.drive_missing_at is not null)
                  and coalesce(f.uploaded_at, '-infinity') <= w.drive_trash_requested_at)) then
    raise exception 'drive_trash_first' using errcode = 'P0001',
      hint = 'Send the project folder to the Google Drive trash first.';
  end if;
  perform private.require_session_write_version();
  perform private.project_files_purged(p_project);
  update public.workspaces set purged_at = now(), purged_by = auth.uid() where id = p_project;
end;
$$;

revoke all on function public.purge_project(uuid) from public, anon;
grant execute on function public.purge_project(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 2. Lo que ya no se hace con uno borrado para siempre
-- ---------------------------------------------------------------------------------------------------
-- Restaurar: el cuerpo de 20261008120000_version_minima_arbol.sql, más `project_purged` (P0001).
create or replace function public.restore_project(p_project uuid, p_without_drive boolean default false)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  w record;
begin
  select pr.owner_id, pr.deleted_at, pr.drive_trash_requested_at, pr.drive_missing_at, pr.purged_at into w
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
  if w.purged_at is not null then
    raise exception 'project_purged' using errcode = 'P0001',
      hint = 'This project was deleted forever: it cannot be restored from the app.';
  end if;
  perform private.require_session_write_version();
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

-- Pedir la carpeta: el cuerpo de 20261005120000_proyectos_drive.sql, más `project_purged`.
create or replace function public.request_project_drive_trash(p_project uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  w record;
begin
  select pr.deleted_at, pr.drive_trash_requested_at, pr.drive_missing_at, pr.purged_at into w
  from public.workspaces pr where pr.id = p_project for update;
  if not found or not private.can_purge_project(p_project) then
    raise exception 'not_allowed' using errcode = '42501',
      hint = 'Only an owner or admin of the workspace who manages the project sends its folder to the Google Drive trash.';
  end if;
  if w.deleted_at is null then
    raise exception 'project_not_deleted' using errcode = 'P0001';
  end if;
  if w.purged_at is not null then
    raise exception 'project_purged' using errcode = 'P0001';
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

-- Traer la carpeta: el cuerpo de 20261005120000_proyectos_drive.sql, más `project_purged`.
create or replace function public.project_drive_untrashed(p_project uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  w record;
begin
  select pr.purged_at into w from public.workspaces pr where pr.id = p_project for update;
  if not found or not private.can_purge_project(p_project) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if w.purged_at is not null then
    raise exception 'project_purged' using errcode = 'P0001';
  end if;
  update public.workspaces
  set drive_trash_requested_at = null, drive_trash_requested_by = null, drive_trashed_at = null,
      drive_missing_at = null, drive_missing_by = null
  where id = p_project and drive_trash_requested_at is not null;
end;
$$;

-- Para el portero: como en la 10, con `purged_at` al final (no manda ni trae la carpeta de uno así).
create or replace function public.media_project(p_project uuid)
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
                           'drive_missing_at', w.drive_missing_at,
                           'purged_at', w.purged_at)
  into r from public.workspaces w where w.id = p_project;
  return r;
end;
$$;

-- La papelera de proyectos deja afuera los borrados para siempre. Misma firma que en la 10.
create or replace function public.trashed_projects()
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
  where w.deleted_at is not null and w.purged_at is null
    and private.could_view_project(w.id, w.owner_id)
  order by w.deleted_at desc, w.id;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 3. Los archivos de otros proyectos que usaba
-- ---------------------------------------------------------------------------------------------------
-- Un uso desde una página de un proyecto borrado para siempre ya no vuelve: no frena mandar el archivo a la papelera
-- de Drive. Como en la 9, con `purged_at is null`.
create or replace function private.file_in_deleted_project(p_file uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.page_files pf
    join public.pages pg on pg.id = pf.page_id
    join public.workspaces w on w.id = pg.workspace_id
    where pf.file_id = p_file and pf.removed_at is null and w.deleted_at is not null and w.purged_at is null);
$$;

-- `trashed_files` como en la 9: la página de la papelera que lo usa no puede ser de un proyecto borrado para siempre.
create or replace function public.trashed_files(p_project uuid)
returns table (id uuid, name text, mime text, size bigint, thumb_at timestamptz, trashed_at timestamptz,
               days_left int, purged_at timestamptz, in_trashed_page boolean, trashed_page_title text,
               in_deleted_project boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_project is null or not private.can_see_file_trash(p_project) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return query
    select f.id, f.name, f.mime, f.size, f.thumb_at, f.trashed_at,
           greatest(0, ceil(extract(epoch from (f.trashed_at + interval '30 days' - now())) / 86400))::int,
           f.purged_at, tp.id is not null, tp.title, private.file_in_deleted_project(f.id)
    from public.files f
    left join lateral (
      -- El título solo si la sesión ve esa página (puede ser de otro proyecto): si no, null.
      select pg.id, case when private.page_level(pg.id) >= 1 then pg.title end as title
      from public.page_files pf
      join public.pages pg on pg.id = pf.page_id
      join public.workspaces pw on pw.id = pg.workspace_id
      where pf.file_id = f.id and pf.removed_at is null and pw.purged_at is null and not private.page_alive(pf.page_id)
      order by private.page_level(pg.id) >= 1 desc, pg.title, pg.id
      limit 1
    ) tp on true
    where f.project_id = p_project and f.trashed_at is not null and f.drive_trashed_at is null
    order by f.trashed_at desc, f.id;
end;
$$;

-- La purga automática (apagada) tampoco cuenta esos usos. Como en 20260930180000_papelera_archivos.sql.
create or replace function public.files_due_for_purge(p_project uuid)
returns table (id uuid, name text, trashed_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_project is null or not private.can_purge_files(p_project) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if not coalesce((select s.auto_purge_files from public.workspace_settings s where s.id), false) then
    return;
  end if;
  return query
    select f.id, f.name, f.trashed_at
    from public.files f
    where f.project_id = p_project
      and f.trashed_at is not null
      and f.trashed_at <= now() - interval '30 days'
      and f.drive_trashed_at is null
      and not exists (
        select 1 from public.page_files pf
        join public.pages pg on pg.id = pf.page_id
        join public.workspaces pw on pw.id = pg.workspace_id
        where pf.file_id = f.id and pf.removed_at is null and pw.purged_at is null
          and not private.page_alive(pf.page_id))
    order by f.trashed_at, f.id;
end;
$$;

update public.workspace_settings set schema_version = 23 where id and schema_version < 23;

notify pgrst, 'reload schema';
