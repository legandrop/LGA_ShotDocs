-- LGA Shot Docs · archivar y borrar proyectos (P.14 del roadmap; Docs/Doc_Proyectos_Borrar.md), entrega 1.
--
-- Un proyecto (una fila de `workspaces`) puede estar archivado (`archived_at`) y/o borrado (`deleted_at`). Las dos
-- marcas se ponen y se sacan solo con las funciones de abajo; la API las lee y no las escribe. Nada se borra.
--
-- Archivar es solo orden: no cambia permisos ni contenido (la app lo saca de la lista de todos los días).
--
-- Borrar manda el proyecto a la papelera de proyectos: todos los niveles de permiso sobre él y sus páginas dan 0
-- (`private.user_page_level` y `private.user_project_level`), así que deja de verse y de escribirse por todos los
-- caminos (páginas, contenido, comentarios, archivos, miniaturas, portero), también para la app publicada. Sus
-- páginas dejan de estar vivas (`private.page_alive`): sus archivos entran a la papelera de archivos. Restaurar
-- saca la marca y vuelve a calcular esa papelera: el proyecto queda exactamente como estaba.
--
-- Quién: archivar, borrar y restaurar, quien puede compartir el proyecto entero (4 sobre él y dueño o admin, o
-- su creador), calculado sin mirar el borrado (`private.can_manage_project`).
--
-- Un archivo de otro proyecto usado en una página de un proyecto borrado no se manda a la papelera de Drive
-- (`purge_file` da `file_in_deleted_project`): restaurar ese proyecto lo tiene que encontrar.
--
-- Compatible con la app publicada: suma columnas y funciones; las que cambian conservan su firma y lo que
-- devuelven, salvo `trashed_files`, que suma una columna al final (la app lee las filas por nombre). Mientras
-- nadie borre nada, nada cambia para nadie.

-- ---------------------------------------------------------------------------------------------------
-- Columnas
-- ---------------------------------------------------------------------------------------------------
alter table public.workspaces
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users (id) on delete set null,
  add column deleted_at  timestamptz,
  add column deleted_by  uuid references auth.users (id) on delete set null,
  add constraint workspaces_archived_by check (archived_by is null or archived_at is not null),
  add constraint workspaces_deleted_by  check (deleted_by is null or deleted_at is not null);

-- Desde la API la tabla se sigue escribiendo solo en `name` (`grant update (name)` de la fase 1): las columnas
-- nuevas se leen (la tabla tiene `grant select`) y no se escriben.

-- ---------------------------------------------------------------------------------------------------
-- Niveles: un proyecto borrado da 0
-- ---------------------------------------------------------------------------------------------------
-- El cálculo de siempre (migración del equipo) queda en las versiones `_any`, que no miran el borrado. Las usan
-- solo las funciones de este archivo: quién puede restaurar, quién lo veía y las invitaciones.

create function private.user_page_level_any(p uuid, uid uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  with recursive chain (id, parent_id, depth) as (
    select pg.id, pg.parent_id, 0 from public.pages pg where pg.id = p
    union all
    select pg.id, pg.parent_id, c.depth + 1
    from public.pages pg
    join chain c on pg.id = c.parent_id
    where c.depth < 10000
  ),
  target as (
    select pg.workspace_id, w.owner_id
    from public.pages pg
    join public.workspaces w on w.id = pg.workspace_id
    where pg.id = p
  )
  select case when uid is null or private.workspace_role(uid) is null then 0 else greatest(
    coalesce((select 4 from target t where t.owner_id = uid), 0),
    coalesce((
      select max(private.grant_level_value(g.level))
      from public.grants g
      where g.user_id = uid and g.revoked_at is null
        and (g.project_id = (select t.workspace_id from target t)
             or g.page_id in (select c.id from chain c))
    ), 0)) end;
$$;

create function private.user_project_level_any(ws uuid, uid uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select case when uid is null or private.workspace_role(uid) is null then 0 else greatest(
    coalesce((select 4 from public.workspaces w where w.id = ws and w.owner_id = uid), 0),
    coalesce((
      select max(private.grant_level_value(g.level))
      from public.grants g
      where g.user_id = uid and g.project_id = ws and g.revoked_at is null
    ), 0)) end;
$$;

revoke all on function private.user_page_level_any(uuid, uuid) from public, anon, authenticated;
revoke all on function private.user_project_level_any(uuid, uuid) from public, anon, authenticated;

-- Las de siempre: 0 si el proyecto está borrado. `page_level`, `project_level`, `can_view_page`, `can_edit_page`
-- y todo lo que las usa cambian con ellas.
create or replace function private.user_page_level(p uuid, uid uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.pages pg
      join public.workspaces w on w.id = pg.workspace_id
      where pg.id = p and w.deleted_at is not null) then 0
    else private.user_page_level_any(p, uid)
  end;
$$;

create or replace function private.user_project_level(ws uuid, uid uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select case
    when exists (select 1 from public.workspaces w where w.id = ws and w.deleted_at is not null) then 0
    else private.user_project_level_any(ws, uid)
  end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Quién veía un proyecto y quién lo maneja (sin mirar el borrado)
-- ---------------------------------------------------------------------------------------------------

-- Lo mismo que `can_view_project_row`, pero con el nivel que tenía la sesión antes de que lo borraran: su
-- creador (miembro activo), quien tiene permiso sobre el proyecto o sobre una página de adentro.
create function private.could_view_project(p_id uuid, p_owner_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.workspace_role() is not null and (
    p_owner_id = (select auth.uid())
    or private.user_project_level_any(p_id, (select auth.uid())) >= 1
    or exists (
      select 1 from public.grants g
      join public.pages pg on pg.id = g.page_id
      where g.user_id = (select auth.uid()) and g.revoked_at is null and pg.workspace_id = p_id));
$$;

-- Archivar, borrar y restaurar: la regla de compartir el proyecto entero (`private.can_share`), sin mirar el
-- borrado (así se puede restaurar): 4 sobre el proyecto y ser dueño o admin del workspace, o su creador.
create function private.can_manage_project(ws uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.user_project_level_any(ws, (select auth.uid())) >= 4
     and (coalesce(private.workspace_role() in ('owner', 'admin'), false)
          or exists (select 1 from public.workspaces w where w.id = ws and w.owner_id = (select auth.uid())));
$$;

-- Solo las llaman funciones `security definer` de este archivo: nadie más las necesita (y `could_view_project`
-- con un dueño inventado daría sí).
revoke all on function private.could_view_project(uuid, uuid) from public, anon, authenticated;
revoke all on function private.can_manage_project(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Lo que se ve
-- ---------------------------------------------------------------------------------------------------

-- Un proyecto borrado no se lista. La puerta de siempre sigue decidiendo con los datos de la fila (crear con
-- `on conflict do nothing`: una fila nueva nunca está borrada).
drop policy workspaces_select on public.workspaces;
create policy workspaces_select on public.workspaces
  for select to authenticated using (deleted_at is null and private.can_view_project_row(id, owner_id));

-- Un archivo: quien lo creó lo ve solo mientras sea miembro activo y su proyecto no esté borrado.
create or replace function private.can_view_file(p_file uuid, p_created_by uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (coalesce(p_created_by = (select auth.uid()), false)
          and private.workspace_role() is not null
          and not exists (
            select 1 from public.files f
            join public.workspaces w on w.id = f.project_id
            where f.id = p_file and w.deleted_at is not null))
      or exists (
        select 1 from public.page_files pf
        where pf.file_id = p_file and not pf.is_foreign and private.can_view_page(pf.page_id));
$$;

-- ---------------------------------------------------------------------------------------------------
-- Papelera de archivos: una página de un proyecto borrado no está viva
-- ---------------------------------------------------------------------------------------------------
-- La cuenta de siempre (la página y las de arriba fuera de la papelera de páginas), sin mirar el proyecto: la usan
-- los números de la ventana de borrar y de la papelera de proyectos, que tienen que dar lo mismo con el proyecto
-- activo o borrado.
create function private.page_alive_any(p uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  with recursive chain (id, parent_id, deleted_at, depth) as (
    select pg.id, pg.parent_id, pg.deleted_at, 0 from public.pages pg where pg.id = p
    union all
    select pg.id, pg.parent_id, pg.deleted_at, c.depth + 1
    from public.pages pg
    join chain c on pg.id = c.parent_id
    where c.depth < 10000
  )
  select exists (select 1 from chain) and not exists (select 1 from chain c where c.deleted_at is not null);
$$;

create or replace function private.page_alive(p uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.page_alive_any(p)
     and not exists (
       select 1 from public.pages pg
       join public.workspaces w on w.id = pg.workspace_id
       where pg.id = p and w.deleted_at is not null);
$$;

-- ¿Lo usa (sin `removed_at`) alguna página de un proyecto borrado? Un archivo así no se manda a la papelera de
-- Drive (ni de a uno ni con "vaciar"): restaurar ese proyecto lo tiene que encontrar.
create function private.file_in_deleted_project(p_file uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.page_files pf
    join public.pages pg on pg.id = pf.page_id
    join public.workspaces w on w.id = pg.workspace_id
    where pf.file_id = p_file and pf.removed_at is null and w.deleted_at is not null);
$$;

revoke all on function private.page_alive_any(uuid) from public, anon, authenticated;
revoke all on function private.file_in_deleted_project(uuid) from public, anon, authenticated;

-- `purge_file` como en la migración de la papelera de archivos, más `file_in_deleted_project` (P0001): un archivo
-- de otro proyecto usado en una página de un proyecto borrado entra a la papelera de su proyecto, pero no se
-- puede mandar a la papelera de Drive mientras ese proyecto esté borrado (quien lo manda ni siquiera ve la
-- página). Pedirlo de nuevo sobre uno ya pedido sigue sin cambiar nada.
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
    update public.files set purged_at = now(), purged_by = auth.uid() where id = p_file;
  end if;
end;
$$;

-- `trashed_files` como en la migración de la papelera de archivos, con una columna más al final:
-- `in_deleted_project` (lo usa una página de un proyecto borrado; la app lo dice y no ofrece mandarlo a Drive).
-- Cambia lo que devuelve: drop y create.
drop function public.trashed_files(uuid);
create function public.trashed_files(p_project uuid)
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
      where pf.file_id = f.id and pf.removed_at is null and not private.page_alive(pf.page_id)
      order by private.page_level(pg.id) >= 1 desc, pg.title, pg.id
      limit 1
    ) tp on true
    where f.project_id = p_project and f.trashed_at is not null and f.drive_trashed_at is null
    order by f.trashed_at desc, f.id;
end;
$$;

revoke all on function public.trashed_files(uuid) from public, anon;
grant execute on function public.trashed_files(uuid) to authenticated;

-- Recalcula la papelera de archivos de todo lo que toca el proyecto: sus archivos y los de otros proyectos que
-- usan sus páginas. En orden de id, como `pages_file_trash` (dos a la vez no se bloquean en orden cruzado).
-- `refresh_file_trash` no toca los que ya se mandaron a la papelera de Drive y conserva la fecha de entrada de
-- los que ya estaban: por eso restaurar deja todo como estaba.
create function private.refresh_project_files(p_project uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  fid uuid;
begin
  for fid in
    select f.id from public.files f where f.project_id = p_project
    union
    select pf.file_id
    from public.page_files pf
    join public.pages pg on pg.id = pf.page_id
    where pg.workspace_id = p_project
    order by 1
  loop
    perform private.refresh_file_trash(fid);
  end loop;
end;
$$;

revoke all on function private.refresh_project_files(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Archivar, borrar y restaurar
-- ---------------------------------------------------------------------------------------------------
-- Errores: `project_not_found` (P0002) si no existe o la sesión no lo veía (no dice cuál de las dos);
-- `not_allowed` (42501) si lo ve pero no lo maneja; `project_deleted` (P0001) al archivar uno borrado;
-- `archived_invalid` (22023).

-- Archiva (`p_archived` true) o desarchiva. Repetirlo no cambia nada (queda quién y cuándo lo archivó primero).
create function public.set_project_archived(p_project uuid, p_archived boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  w record;
begin
  if p_archived is null then
    raise exception 'archived_invalid' using errcode = '22023';
  end if;
  select pr.owner_id, pr.archived_at, pr.deleted_at into w
  from public.workspaces pr where pr.id = p_project for update;
  if not found or not private.could_view_project(p_project, w.owner_id) then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;
  if not private.can_manage_project(p_project) then
    raise exception 'not_allowed' using errcode = '42501',
      hint = 'Archiving a project needs "edit and create pages" on the whole project, and being an owner or admin of the workspace or the creator of the project.';
  end if;
  if w.deleted_at is not null then
    raise exception 'project_deleted' using errcode = 'P0001';
  end if;
  if p_archived and w.archived_at is null then
    update public.workspaces set archived_at = now(), archived_by = auth.uid() where id = p_project;
  elsif not p_archived and w.archived_at is not null then
    update public.workspaces set archived_at = null, archived_by = null where id = p_project;
  end if;
end;
$$;

-- Manda el proyecto a la papelera de proyectos y devuelve cuándo. Si ya estaba, devuelve la fecha de entonces.
create function public.delete_project(p_project uuid)
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  w     record;
  v_now timestamptz := now();
begin
  select pr.owner_id, pr.deleted_at into w
  from public.workspaces pr where pr.id = p_project for update;
  if not found or not private.could_view_project(p_project, w.owner_id) then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;
  if not private.can_manage_project(p_project) then
    raise exception 'not_allowed' using errcode = '42501',
      hint = 'Deleting a project needs "edit and create pages" on the whole project, and being an owner or admin of the workspace or the creator of the project.';
  end if;
  if w.deleted_at is not null then
    return w.deleted_at;
  end if;
  update public.workspaces set deleted_at = v_now, deleted_by = auth.uid() where id = p_project;
  perform private.refresh_project_files(p_project);
  return v_now;
end;
$$;

-- Lo saca de la papelera de proyectos. Si no estaba borrado, no hace nada. La marca de archivado no se toca.
create function public.restore_project(p_project uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  w record;
begin
  select pr.owner_id, pr.deleted_at into w
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
  update public.workspaces set deleted_at = null, deleted_by = null where id = p_project;
  perform private.refresh_project_files(p_project);
end;
$$;

-- Los números de un proyecto, iguales con el proyecto activo o borrado (los usan la ventana de borrar y la
-- papelera de proyectos, así las dos muestran lo mismo). Páginas: vivas y en la papelera de páginas, sin mirar el
-- proyecto (`page_alive_any`). Archivos: subidos y fuera de la papelera de Drive, con su peso (como `drive_*` de
-- `project_sizes`); sin subir (los que usa alguna página que no está en la papelera de páginas); del proyecto
-- usados en páginas vivas de otros proyectos (dejan de verse ahí mientras esté borrado); y de otros proyectos que
-- solo usan páginas de este (entran a la papelera de su proyecto mientras esté borrado).
create function private.project_numbers(p_project uuid)
returns json
language sql stable security definer set search_path = ''
as $$
  select json_build_object(
    'pages', (select count(*) from public.pages pg
              where pg.workspace_id = p_project and private.page_alive_any(pg.id)),
    'trashed_pages', (select count(*) from public.pages pg
                      where pg.workspace_id = p_project and not private.page_alive_any(pg.id)),
    'files', (select count(*) from public.files f
              where f.project_id = p_project and f.drive_id is not null and f.drive_trashed_at is null),
    'drive_bytes', (select coalesce(sum(f.size), 0)::bigint from public.files f
                    where f.project_id = p_project and f.drive_id is not null and f.drive_trashed_at is null),
    'pending_files', (select count(*) from public.files f
                      where f.project_id = p_project and f.drive_id is null and f.purged_at is null
                        and exists (select 1 from public.page_files pf
                                    where pf.file_id = f.id and pf.removed_at is null
                                      and private.page_alive_any(pf.page_id))),
    'used_elsewhere', (select count(distinct pf.file_id)
                       from public.page_files pf
                       join public.files f on f.id = pf.file_id
                       join public.pages pg on pg.id = pf.page_id
                       where f.project_id = p_project and pg.workspace_id <> p_project
                         and pf.removed_at is null and private.page_alive(pf.page_id)),
    'foreign_only_here', (select count(distinct pf.file_id)
                          from public.page_files pf
                          join public.files f on f.id = pf.file_id
                          join public.pages pg on pg.id = pf.page_id
                          where pg.workspace_id = p_project and f.project_id <> p_project
                            and f.drive_trashed_at is null
                            and pf.removed_at is null and private.page_alive_any(pf.page_id)
                            and not exists (
                              select 1 from public.page_files o
                              join public.pages op on op.id = o.page_id
                              where o.file_id = pf.file_id and op.workspace_id <> p_project
                                and o.removed_at is null and private.page_alive(o.page_id))));
$$;

revoke all on function private.project_numbers(uuid) from public, anon, authenticated;

-- La papelera de proyectos: los borrados que la sesión veía antes, lo último primero. `days_left`: cuántos días
-- faltan para los 30 (30 el día que entra, 0 si ya pasaron; después se sigue pudiendo restaurar). `can_restore`:
-- si la sesión lo puede restaurar. Quién lo borró (`deleted_by`, `deleted_by_email`): solo a quien lo maneja y al
-- dueño y los admins (los demás no ven correos del equipo: `list_members`). `pages` y `files` (los mismos números
-- que la ventana de borrar, `project_numbers`): solo a quien lo maneja (a quien veía una sola página no se le dice
-- cuánto tenía el proyecto). El peso sale de `project_sizes` (también solo a quien puede restaurarlo).
create function public.trashed_projects()
returns table (id uuid, name text, archived_at timestamptz, deleted_at timestamptz, deleted_by uuid,
               deleted_by_email text, days_left int, can_restore boolean, pages int, files int)
language sql stable security definer set search_path = ''
as $$
  select w.id, w.name, w.archived_at, w.deleted_at,
         case when m.can or m.staff then w.deleted_by end,
         case when m.can or m.staff then u.email::text end,
         greatest(0, ceil(extract(epoch from (w.deleted_at + interval '30 days' - now())) / 86400))::int,
         m.can,
         case when m.can then (n.j ->> 'pages')::int end,
         case when m.can then (n.j ->> 'files')::int end
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

-- Lo que muestra la ventana de borrar (y la lista de borrados al mandar sus archivos a Drive), a quien lo maneja:
-- `project_numbers` más con cuántas personas activas está compartido (sin contar a quien pregunta). Da lo mismo con
-- el proyecto activo o borrado.
create function public.project_delete_info(p_project uuid)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  w record;
begin
  select pr.owner_id into w from public.workspaces pr where pr.id = p_project;
  if not found or not private.could_view_project(p_project, w.owner_id) then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;
  if not private.can_manage_project(p_project) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return (private.project_numbers(p_project)::jsonb || jsonb_build_object(
    'shared_with', (select count(distinct a.uid)
                    from (
                      select g.user_id as uid from public.grants g
                      where g.project_id = p_project and g.revoked_at is null
                      union
                      select g.user_id from public.grants g
                      join public.pages pg on pg.id = g.page_id
                      where pg.workspace_id = p_project and g.revoked_at is null
                      union
                      select w.owner_id
                    ) a
                    join public.members m on m.user_id = a.uid and m.removed_at is null
                    where a.uid is distinct from auth.uid())))::json;
end;
$$;

revoke all on function public.set_project_archived(uuid, boolean) from public, anon;
revoke all on function public.delete_project(uuid) from public, anon;
revoke all on function public.restore_project(uuid) from public, anon;
revoke all on function public.trashed_projects() from public, anon;
revoke all on function public.project_delete_info(uuid) from public, anon;
grant execute on function public.set_project_archived(uuid, boolean) to authenticated;
grant execute on function public.delete_project(uuid) to authenticated;
grant execute on function public.restore_project(uuid) to authenticated;
grant execute on function public.trashed_projects() to authenticated;
grant execute on function public.project_delete_info(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- ensure_workspace: nunca uno borrado, y primero los no archivados
-- ---------------------------------------------------------------------------------------------------
-- El mismo orden de siempre (el propio más viejo; si no, uno con permiso sobre el proyecto; si no, el de una página
-- compartida), pero un archivado va después de todos los no archivados, de cualquiera de los tres caminos.
create or replace function public.ensure_workspace()
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  ws  uuid;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if private.workspace_role(uid) is null then
    return null;
  end if;

  select c.id into ws
  from (
    select w.id, 1 as step, w.created_at, w.archived_at
    from public.workspaces w
    where w.owner_id = uid and w.deleted_at is null
    union all
    select w.id, 2, w.created_at, w.archived_at
    from public.grants g
    join public.workspaces w on w.id = g.project_id
    where g.user_id = uid and g.revoked_at is null and w.deleted_at is null
    union all
    select w.id, 3, w.created_at, w.archived_at
    from public.grants g
    join public.pages pg on pg.id = g.page_id
    join public.workspaces w on w.id = pg.workspace_id
    where g.user_id = uid and g.revoked_at is null and w.deleted_at is null
  ) c
  order by (c.archived_at is not null), c.step, c.created_at, c.id
  limit 1;
  return ws;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- accept_invitations: quien invitó se revisa sin mirar el borrado
-- ---------------------------------------------------------------------------------------------------
-- Igual que en la migración del equipo, salvo las dos revisiones de quien invitó, que usan las versiones `_any`:
-- una invitación a un proyecto borrado guarda su permiso (sin efecto mientras esté borrado) y vale al restaurarlo.
create or replace function public.accept_invitations()
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  em  text;
  inv public.invitations;
  cur public.members;
  el  jsonb;
  tgt uuid;
  n   int := 0;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not private.session_allowed() then
    raise exception 'session_not_allowed' using errcode = '42501',
      hint = 'Sign in with the code sent by email.';
  end if;
  select lower(u.email) into em from auth.users u where u.id = uid and u.email_confirmed_at is not null;
  if em is null then
    return 0;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('invitation:' || em, 0));

  for inv in select * from private.live_invitations(em) i order by i.created_at, i.id loop
    select * into cur from public.members m where m.user_id = uid for update;
    if not found then
      insert into public.members (user_id, role, added_by) values (uid, inv.role, inv.invited_by);
    elsif cur.removed_at is not null then
      update public.grants set revoked_at = now(), revoked_by = inv.invited_by
      where user_id = uid and revoked_at is null;
      update public.members set role = inv.role, removed_at = null, added_by = inv.invited_by
      where user_id = uid;
    elsif cur.role <> 'owner' and private.role_rank(inv.role) > private.role_rank(cur.role) then
      update public.members set role = inv.role where user_id = uid;
    end if;

    for el in select * from jsonb_array_elements(inv.grants) loop
      if el ? 'project_id' then
        tgt := (el ->> 'project_id')::uuid;
        continue when private.user_project_level_any(tgt, inv.invited_by) < 4;
        insert into public.grants as g (user_id, project_id, level, granted_by)
        values (uid, tgt, el ->> 'level', inv.invited_by)
        on conflict (user_id, project_id) where project_id is not null
        do update set level = excluded.level, granted_by = excluded.granted_by, revoked_at = null, revoked_by = null
        where g.revoked_at is not null
           or private.grant_level_value(excluded.level) > private.grant_level_value(g.level);
      else
        tgt := (el ->> 'page_id')::uuid;
        continue when private.user_page_level_any(tgt, inv.invited_by) < 4;
        insert into public.grants as g (user_id, page_id, level, granted_by)
        values (uid, tgt, el ->> 'level', inv.invited_by)
        on conflict (user_id, page_id) where page_id is not null
        do update set level = excluded.level, granted_by = excluded.granted_by, revoked_at = null, revoked_by = null
        where g.revoked_at is not null
           or private.grant_level_value(excluded.level) > private.grant_level_value(g.level);
      end if;
    end loop;

    update public.invitations set used_at = now(), used_by = uid where id = inv.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- project_sizes: el peso de los borrados, a quien puede restaurarlos
-- ---------------------------------------------------------------------------------------------------
-- Igual que en la migración del peso, salvo la puerta de un proyecto borrado (`can_see_file_trash` daría no):
-- `can_manage_project`. Mientras está borrado, sus archivos están en la papelera de la app (estado `trash`) y
-- siguen sumando en el número principal si están subidos: siguen ocupando el Drive.
create or replace function public.project_sizes()
returns table (project_id uuid,
               drive_bytes bigint, drive_files int,
               trash_bytes bigint, trash_files int,
               drive_trash_bytes bigint, drive_trash_files int,
               pending_bytes bigint, pending_files int)
language sql stable security definer set search_path = ''
as $$
  with gate as materialized (
    select w.id,
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
-- Versión de la base
-- ---------------------------------------------------------------------------------------------------
update public.workspace_settings set schema_version = 9 where id and schema_version < 9;

notify pgrst, 'reload schema';
