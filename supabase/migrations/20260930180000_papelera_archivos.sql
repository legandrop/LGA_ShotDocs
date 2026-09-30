-- LGA Shot Docs · papelera de archivos (paso 11 de Docs/Plan_Workspaces.md, secciones 5 y 11): la base.
--
-- Un archivo está en la papelera (`files.trashed_at`, la fecha en que entró) cuando ninguna página viva lo
-- usa. Una página está viva si ni ella ni ninguna de las de arriba está en la papelera de páginas (como en
-- la app: mandar una página a la papelera se lleva sus subpáginas). Usar un archivo es tener una fila de
-- `page_files` sin `removed_at`: la app la marca con `unlink_page_file` cuando el bloque `sdmedia://`
-- desaparece de la página, y `link_page_file` o `register_file` la reactivan. Nada saca filas. Un uso en
-- una página de otro proyecto (una foto cortada de un proyecto y pegada en otro) queda guardado como uso de
-- afuera (`page_files.is_foreign`): cuenta para la papelera pero no da permisos sobre el archivo.
--
-- El estado se recalcula solo (`private.refresh_file_trash`) cada vez que cambia una fila de `page_files` o
-- una página entra, sale o se mueve de la papelera de páginas: si la página vuelve, el archivo sale.
--
-- Mandar a la papelera de Drive (dueño y admins, de a uno o todos): `purge_file` marca `purged_at` y el
-- portero, con la sesión de quien lo pidió, mueve el archivo a la papelera de Drive (nunca lo borra) y lo
-- confirma con `media_purged` (`drive_trashed_at`). La fila no se borra nunca. Decisión: pedirlo es
-- definitivo para la app: un archivo con `purged_at` ya no sale de la papelera aunque se vuelva a usar
-- (así el portero nunca manda a la papelera de Drive un archivo que alguien acaba de volver a usar); se
-- recupera a mano desde la papelera de Drive durante sus 30 días.
--
-- El borrado automático a los 30 días queda armado y APAGADO (`workspace_settings.auto_purge_files`):
-- `files_due_for_purge` no devuelve nada mientras esté apagado. Nada lo prende: lo decide Lega.
--
-- Quién ve la papelera de archivos de un proyecto: quien tiene editar y crear páginas (4) sobre el
-- proyecto entero, y el dueño y los admins con cualquier permiso sobre el proyecto entero (el dueño no ve
-- los proyectos privados de otros). Mandar a la papelera de Drive: solo el dueño y los admins con permiso
-- sobre el proyecto entero.
--
-- Compatible con la app publicada: suma columnas, funciones y triggers; `media_file` suma campos sin sacar
-- ninguno, y `link_page_file` y `register_file` hacen lo mismo que antes (más reactivar la fila).

-- ---------------------------------------------------------------------------------------------------
-- Columnas
-- ---------------------------------------------------------------------------------------------------

--   purged_at         Un dueño o admin pidió mandarlo a la papelera de Drive (solo estando en la papelera).
--   purged_by         Quién lo pidió.
--   drive_trashed_at  El portero confirmó que lo movió a la papelera de Drive (o que en Drive ya no estaba).
alter table public.files
  add column purged_at        timestamptz,
  add column purged_by        uuid references auth.users (id) on delete set null,
  add column drive_trashed_at timestamptz,
  add constraint files_purged_trashed check (purged_at is null or trashed_at is not null),
  add constraint files_purged_by check (purged_by is null or purged_at is not null),
  add constraint files_drive_trashed check (drive_trashed_at is null or purged_at is not null);

create index files_trash_idx on public.files (project_id, trashed_at) where trashed_at is not null;

-- La página dejó de usar el archivo (el bloque desapareció). La fila queda: volver a usarlo la reactiva.
--
-- `is_foreign`: un uso en una página de OTRO proyecto (se cortó una foto de un proyecto y se pegó en otro).
-- El archivo sigue siendo de su proyecto (la página de afuera lo muestra roto), pero ese uso cuenta para la
-- papelera: mientras una página viva lo use, aunque sea de otro proyecto, no entra. No da ningún permiso
-- sobre el archivo (file_level y can_view_file no lo cuentan) y quien no ve el archivo no ve la fila.
-- (El nombre no es `foreign` porque es una palabra reservada de SQL: habría que escribirla entre comillas
-- en todos lados, también en la API.)
alter table public.page_files
  add column removed_at timestamptz,
  add column is_foreign boolean not null default false;

-- Borrado automático a los 30 días de haber entrado a la papelera: apagado. Se cambia solo desde el SQL
-- Editor (lo decide Lega); la app lo lee como el resto de la fila.
alter table public.workspace_settings add column auto_purge_files boolean not null default false;

-- ---------------------------------------------------------------------------------------------------
-- Funciones auxiliares
-- ---------------------------------------------------------------------------------------------------
-- Corren como definer y con search_path vacío. Las de estado (page_alive, refresh_file_trash) no las
-- puede llamar nadie desde la API: las usan los triggers y las funciones de abajo.

-- ¿La página existe y ni ella ni ninguna de las de arriba está en la papelera de páginas?
create function private.page_alive(p uuid)
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

-- Recalcula si el archivo está en la papelera: entra (con la fecha de hoy) si ninguna página viva lo usa y
-- sale si alguna lo usa. Si ya estaba, conserva la fecha en que entró. Un archivo con `purged_at` no
-- cambia más (ver arriba). Bloquea la fila del archivo: `purge_file` y esta función no se pisan.
create function private.refresh_file_trash(p_file uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  f    record;
  used boolean;
begin
  select fl.trashed_at, fl.purged_at into f from public.files fl where fl.id = p_file for update;
  if not found or f.purged_at is not null then
    return;
  end if;
  used := exists (
    select 1 from public.page_files pf
    where pf.file_id = p_file and pf.removed_at is null and private.page_alive(pf.page_id));
  if used and f.trashed_at is not null then
    update public.files set trashed_at = null where id = p_file;
  elsif not used and f.trashed_at is null then
    update public.files set trashed_at = now() where id = p_file;
  end if;
end;
$$;

-- Los usos de otro proyecto (`is_foreign`) no dan permiso sobre el archivo: file_level y can_view_file
-- quedan como en las migraciones de archivos y equipo, sin contarlos.
create or replace function private.can_view_file(p_file uuid, p_created_by uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (coalesce(p_created_by = (select auth.uid()), false) and private.workspace_role() is not null)
      or exists (
        select 1 from public.page_files pf
        where pf.file_id = p_file and not pf.is_foreign and private.can_view_page(pf.page_id));
$$;

create or replace function private.file_level(p_file uuid)
returns int
language plpgsql stable security definer set search_path = ''
as $$
declare
  f   record;
  lvl int;
begin
  select fl.project_id, fl.created_by into f from public.files fl where fl.id = p_file;
  if not found then
    return 0;
  end if;
  select coalesce(max(private.page_level(pf.page_id)), 0) into lvl
  from public.page_files pf
  where pf.file_id = p_file and not pf.is_foreign;
  if lvl < 3 and f.created_by = auth.uid() and private.can_edit_some_page(f.project_id) then
    lvl := 3;
  end if;
  return lvl;
end;
$$;

-- Un uso de otro proyecto lo ve solo quien ve también el archivo (no filtra el id a quien solo ve la página
-- de afuera, aunque el id ya está en el contenido de esa página).
drop policy page_files_select on public.page_files;
create policy page_files_select on public.page_files
  for select to authenticated
  using (private.can_view_page(page_id) and (not is_foreign or private.file_level(file_id) >= 1));

-- ¿La sesión ve la papelera de archivos del proyecto? 4 sobre el proyecto entero, o dueño o admin activo
-- con algún permiso sobre el proyecto entero.
create function private.can_see_file_trash(ws uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.project_level(ws) >= 4
      or (coalesce(private.workspace_role() in ('owner', 'admin'), false) and private.project_level(ws) >= 1);
$$;

-- ¿La sesión puede mandar archivos del proyecto a la papelera de Drive? Dueño o admin activo con algún
-- permiso sobre el proyecto entero.
create function private.can_purge_files(ws uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.workspace_role() in ('owner', 'admin'), false) and private.project_level(ws) >= 1;
$$;

revoke all on function private.page_alive(uuid) from public, anon, authenticated;
revoke all on function private.refresh_file_trash(uuid) from public, anon, authenticated;
revoke all on function private.can_see_file_trash(uuid) from public, anon;
revoke all on function private.can_purge_files(uuid) from public, anon;
grant execute on function private.can_see_file_trash(uuid) to authenticated;
grant execute on function private.can_purge_files(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Triggers: el estado se recalcula solo
-- ---------------------------------------------------------------------------------------------------
-- Corren como definer: quien cambia una página o un uso desde la API no puede escribir en `files`.

create function private.page_files_trash()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform private.refresh_file_trash(old.file_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.file_id <> old.file_id) then
    perform private.refresh_file_trash(new.file_id);
  end if;
  return null;
end;
$$;

revoke all on function private.page_files_trash() from public, anon, authenticated;

create trigger page_files_trash
after insert or update or delete on public.page_files
for each row execute function private.page_files_trash();

-- Una página entra o sale de la papelera de páginas, o se mueve (puede quedar adentro o afuera de una que
-- está en la papelera): se recalculan los archivos que usan ella y sus subpáginas, en orden de id (dos a la
-- vez no se bloquean en orden cruzado).
create function private.pages_file_trash()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  fid uuid;
begin
  for fid in
    with recursive sub (id, depth) as (
      select new.id, 0
      union all
      select pg.id, s.depth + 1
      from public.pages pg
      join sub s on pg.parent_id = s.id
      where s.depth < 10000
    )
    select distinct pf.file_id
    from public.page_files pf
    where pf.page_id in (select s.id from sub s)
    order by pf.file_id
  loop
    perform private.refresh_file_trash(fid);
  end loop;
  return null;
end;
$$;

revoke all on function private.pages_file_trash() from public, anon, authenticated;

create trigger pages_file_trash
after update of deleted_at, parent_id on public.pages
for each row
when (old.deleted_at is distinct from new.deleted_at or old.parent_id is distinct from new.parent_id)
execute function private.pages_file_trash();

-- ---------------------------------------------------------------------------------------------------
-- Usar y dejar de usar un archivo en una página
-- ---------------------------------------------------------------------------------------------------
-- register_file y link_page_file, como en la migración de archivos, salvo dos cosas:
--   - Un uso marcado con `removed_at` se reactiva.
--   - Un archivo de OTRO proyecto que la sesión ve (file_level >= 1), en una página que edita: en vez de solo
--     fallar, guardan el uso marcado `is_foreign` (cuenta para la papelera, ver arriba) y devuelven el texto
--     'file_other_project' (sin error). Devolver el error desharía la fila en el mismo pedido: por eso es un
--     valor. Si la sesión no ve el archivo, el error de siempre (`file_other_project` en register_file,
--     `file_not_found` en link_page_file) y no se guarda nada.
-- Devuelven 'ok' cuando el archivo es del proyecto de la página. Antes no devolvían nada: la app publicada
-- ignora el valor (un archivo de otro proyecto le queda como hecho, sin su aviso de "otro proyecto").
drop function public.register_file(uuid, uuid, text, text, bigint, int, int, real);
drop function public.link_page_file(uuid, uuid);

-- Guarda el uso de un archivo de otro proyecto (ya se comprobó que la sesión lo ve y edita la página).
create function private.link_foreign_file(p_page_id uuid, p_file_id uuid)
returns text
language sql security definer set search_path = ''
as $$
  insert into public.page_files as pf (page_id, file_id, is_foreign) values (p_page_id, p_file_id, true)
  on conflict (page_id, file_id) do update set removed_at = null where pf.removed_at is not null;
  select 'file_other_project';
$$;

revoke all on function private.link_foreign_file(uuid, uuid) from public, anon, authenticated;

create function public.register_file(
  p_id uuid, p_page_id uuid, p_name text, p_mime text, p_size bigint,
  p_width int, p_height int, p_duration real)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  ws      uuid;
  file_ws uuid;
begin
  if p_id is null or private.page_level(p_page_id) < 3 then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  select pg.workspace_id into ws from public.pages pg where pg.id = p_page_id;

  select f.project_id into file_ws from public.files f where f.id = p_id;
  if not found then
    insert into public.files (id, project_id, name, mime, size, width, height, duration, created_by)
    values (p_id, ws, p_name, lower(btrim(p_mime)), p_size, p_width, p_height, p_duration, auth.uid())
    on conflict (id) do nothing;
    select f.project_id into file_ws from public.files f where f.id = p_id;
  elsif private.file_level(p_id) < 1 then
    raise exception 'file_other_project' using errcode = 'P0001';
  end if;

  if file_ws is distinct from ws then
    -- De otro proyecto: si la sesión lo ve, se guarda el uso de afuera (si otro lo acaba de crear en otro
    -- proyecto y no lo ve, el error de siempre).
    if private.file_level(p_id) >= 1 then
      return private.link_foreign_file(p_page_id, p_id);
    end if;
    raise exception 'file_other_project' using errcode = 'P0001';
  end if;

  insert into public.page_files as pf (page_id, file_id) values (p_page_id, p_id)
  on conflict (page_id, file_id) do update set removed_at = null where pf.removed_at is not null;
  return 'ok';
end;
$$;

create function public.link_page_file(p_page_id uuid, p_file_id uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  ws      uuid;
  file_ws uuid;
begin
  if private.page_level(p_page_id) < 3 then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  select pg.workspace_id into ws from public.pages pg where pg.id = p_page_id;

  select f.project_id into file_ws from public.files f where f.id = p_file_id;
  if not found or private.file_level(p_file_id) < 1 then
    raise exception 'file_not_found' using errcode = 'P0002';
  end if;
  if file_ws <> ws then
    return private.link_foreign_file(p_page_id, p_file_id);
  end if;

  insert into public.page_files as pf (page_id, file_id) values (p_page_id, p_file_id)
  on conflict (page_id, file_id) do update set removed_at = null where pf.removed_at is not null;
  return 'ok';
end;
$$;

revoke all on function public.register_file(uuid, uuid, text, text, bigint, int, int, real) from public, anon;
revoke all on function public.link_page_file(uuid, uuid) from public, anon;
grant execute on function public.register_file(uuid, uuid, text, text, bigint, int, int, real) to authenticated;
grant execute on function public.link_page_file(uuid, uuid) to authenticated;

-- La página dejó de usar el archivo (el bloque `sdmedia://` desapareció): marca el uso con `removed_at`,
-- sin borrarlo. Pide editar la página (`page_not_found` si no). Si el uso no existe o ya estaba marcado, no
-- hace nada (reintentar no cambia nada, tampoco la fecha).
--
-- `p_seen_seq`: el último `seq` del contenido de la página que el dispositivo tenía al ver que el bloque ya
-- no estaba (`pages.update_seq` de lo que bajó y subió). Si la página tiene contenido más nuevo en el
-- servidor (`update_seq` mayor), otro dispositivo pudo volver a poner el bloque: la base no marca nada y
-- devuelve false, y el dispositivo vuelve a comparar después de bajar lo nuevo. Así un "dejó de usarse"
-- viejo que llega tarde (la cola sin red) no le gana a un uso más nuevo. Sin `p_seen_seq`, como antes.
-- Devuelve true cuando el pedido vale (marcó el uso, o ya estaba marcado o no existía).
-- La fila de la página se bloquea como en `push_page_update` (que sube `update_seq`): los dos no se cruzan.
create function public.unlink_page_file(p_page_id uuid, p_file_id uuid, p_seen_seq bigint default null)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  cur bigint;
begin
  if private.page_level(p_page_id) < 3 then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  select pg.update_seq into cur from public.pages pg where pg.id = p_page_id for share;
  if p_seen_seq is not null and cur > p_seen_seq then
    return false;
  end if;
  update public.page_files set removed_at = now()
  where page_id = p_page_id and file_id = p_file_id and removed_at is null;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- La papelera de archivos de un proyecto
-- ---------------------------------------------------------------------------------------------------
-- Errores: `not_allowed` (42501) si la sesión no ve esa papelera o no puede mandar a Drive (también si el
-- proyecto no existe); `file_not_found` (P0002) si el archivo no existe o la sesión no lo ve;
-- `file_not_trashed` y `file_not_purged` (P0001).

-- Lo que está en la papelera y todavía no llegó a la papelera de Drive, lo último primero. `days_left`:
-- cuántos días faltan para los 30 (30 el día que entra, 0 si ya pasaron). `purged_at`: ya se pidió
-- mandarlo a Drive y el portero todavía no lo confirmó (se puede volver a pedir). `in_trashed_page`: lo usa
-- (sin `removed_at`) alguna página que está en la papelera de páginas, o adentro de una; restaurarla lo
-- saca de acá. `trashed_page_title` es el título de una de esas páginas (la primera por título, entre las
-- que la sesión ve; null si no ve ninguna, por ejemplo una de otro proyecto), para mostrarlo; la app no los
-- incluye en "vaciar". Los usos de otro proyecto (`is_foreign`) cuentan.
create function public.trashed_files(p_project uuid)
returns table (id uuid, name text, mime text, size bigint, thumb_at timestamptz, trashed_at timestamptz,
               days_left int, purged_at timestamptz, in_trashed_page boolean, trashed_page_title text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_project is null or not private.can_see_file_trash(p_project) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return query
    select f.id, f.name, f.mime, f.size, f.thumb_at, f.trashed_at,
           greatest(0, ceil(extract(epoch from (f.trashed_at + interval '30 days' - now())) / 86400))::int,
           f.purged_at, tp.id is not null, tp.title
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

-- Los que ya cumplieron 30 días en la papelera y no llegaron a la papelera de Drive, solo si el borrado
-- automático está prendido (hoy no: devuelve nada). No incluye los que usa (sin `removed_at`) una página que
-- está en la papelera de páginas (el `in_trashed_page` de trashed_files): restaurar esa página los tiene que
-- encontrar; quedan para que una persona los mande a mano. Para el dueño y los admins que pueden mandarlos a Drive:
-- la app, al abrirse, se los pasaría al portero de a uno.
create function public.files_due_for_purge(p_project uuid)
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
        where pf.file_id = f.id and pf.removed_at is null and not private.page_alive(pf.page_id))
    order by f.trashed_at, f.id;
end;
$$;

-- Pide mandar un archivo de la papelera a la papelera de Drive: marca `purged_at` y `purged_by` y no borra
-- nada (lo mueve el portero). Solo el dueño y los admins con permiso sobre el proyecto, y solo si está en la
-- papelera. Pedirlo de nuevo no cambia nada (queda quién y cuándo lo pidió primero).
create function public.purge_file(p_file uuid)
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
    update public.files set purged_at = now(), purged_by = auth.uid() where id = p_file;
  end if;
end;
$$;

-- La llama el portero, con la sesión de quien lo pidió, después de mover el archivo a la papelera de Drive
-- (o de ver que en Drive ya no estaba). Tiene que tener `purged_at` (lo pidió un dueño o admin). La puede
-- confirmar el dueño o un admin (como purge_file) o quien edita el archivo (nivel 3): es quien termina una
-- subida que seguía en curso cuando se pidió, y el portero manda a la papelera de Drive lo que sube de un
-- archivo ya pedido. Confirmar no borra ni mueve nada; en el peor caso un archivo queda en Drive sin ir a
-- su papelera. Repetirla no cambia nada.
create function public.media_purged(p_file uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  f record;
begin
  select fl.project_id, fl.purged_at, fl.drive_trashed_at into f from public.files fl where fl.id = p_file for update;
  if not found or (private.file_level(p_file) < 1 and not private.can_see_file_trash(f.project_id)) then
    raise exception 'file_not_found' using errcode = 'P0002';
  end if;
  if not private.can_purge_files(f.project_id) and private.file_level(p_file) < 3 then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if f.purged_at is null then
    raise exception 'file_not_purged' using errcode = 'P0001';
  end if;
  if f.drive_trashed_at is null then
    update public.files set drive_trashed_at = now() where id = p_file;
  end if;
end;
$$;

-- Para el portero: lo de siempre y además el estado de la papelera (`trashed_at`, `purged_at`,
-- `drive_trashed_at`). No saca ningún campo.
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
    'trashed_at', f.trashed_at, 'purged_at', f.purged_at, 'drive_trashed_at', f.drive_trashed_at)
  into r
  from public.files f
  join public.workspaces w on w.id = f.project_id
  where f.id = p_file_id;
  return r;
end;
$$;

revoke all on function public.unlink_page_file(uuid, uuid, bigint) from public, anon;
revoke all on function public.trashed_files(uuid) from public, anon;
revoke all on function public.files_due_for_purge(uuid) from public, anon;
revoke all on function public.purge_file(uuid) from public, anon;
revoke all on function public.media_purged(uuid) from public, anon;
grant execute on function public.unlink_page_file(uuid, uuid, bigint) to authenticated;
grant execute on function public.trashed_files(uuid) to authenticated;
grant execute on function public.files_due_for_purge(uuid) to authenticated;
grant execute on function public.purge_file(uuid) to authenticated;
grant execute on function public.media_purged(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Lo que ya existe
-- ---------------------------------------------------------------------------------------------------
-- Los archivos que ya hay (si hay) quedan con su estado calculado. No borra nada.
do $$
declare
  fid uuid;
begin
  for fid in select f.id from public.files f order by f.id loop
    perform private.refresh_file_trash(fid);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Versión de la base
-- ---------------------------------------------------------------------------------------------------
update public.workspace_settings set schema_version = 6 where id and schema_version < 6;

notify pgrst, 'reload schema';
