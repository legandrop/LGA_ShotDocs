-- LGA Shot Docs · archivos de las páginas (pasos 6 y 8 de Docs/Plan_Workspaces.md, sección 11).
--
-- Cada foto o video que se agrega a una página es una fila de `files` (el id lo crea el dispositivo) y la
-- página lo usa con una fila de `page_files`. El original va al Drive del dueño por el portero; acá queda
-- de qué proyecto es, cómo es, su id en Drive cuando termina de subir y si ya tiene miniatura (en el
-- bucket `thumbs`). Desde la API las dos tablas solo se leen: se escriben con las funciones de abajo, y
-- nada se borra (ni filas ni miniaturas). `trashed_at` queda para la papelera de archivos (paso 11).
--
-- Permisos: un archivo se ve si lo creó la persona o si puede ver alguna página que lo usa (con
-- `private.can_view_page`, como las páginas hasta el paso 9). Lo que puede hacer con él lo dice
-- `private.file_level` (0 nada, 1 ver, 2 comentar, 3 editar, 4 editar y crear páginas), que ya mira los
-- permisos por página (`private.page_level`): la usan las funciones, el bucket `thumbs` y el portero.

-- ---------------------------------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------------------------------

-- Sin cascade en las referencias: nada se borra, y un proyecto o una página con archivos no se puede
-- borrar por debajo (por ejemplo, borrando la cuenta de su dueño en el panel) sin sacar antes esto.
-- `created_by` sigue a `pages.created_by`: si se borra la cuenta, queda vacío.
create table public.files (
  id          uuid primary key,                                   -- lo genera el dispositivo
  project_id  uuid not null references public.workspaces (id),
  name        text not null check (length(name) between 1 and 250),
  -- En minúsculas y sin parámetros (`video/quicktime`): el portero lo usa como tipo al servirlo.
  mime        text not null
              check (length(mime) between 1 and 200
                     and mime ~ '^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$'),
  size        bigint not null check (size > 0),
  width       int check (width between 1 and 100000),
  height      int check (height between 1 and 100000),
  duration    real check (duration between 0 and 10000000),         -- segundos (videos); sin NaN
  drive_id    text check (drive_id ~ '^[A-Za-z0-9_-]{10,200}$'),   -- null hasta que termina la subida
  thumb_at    timestamptz,                                          -- null: todavía no hay miniatura
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  uploaded_at timestamptz,
  trashed_at  timestamptz                                           -- paso 11; hoy siempre null
);
create index files_project_idx on public.files (project_id);

-- Qué páginas usan cada archivo. Las mantienen los dispositivos (register_file y link_page_file); por
-- ahora nunca se sacan filas.
create table public.page_files (
  page_id    uuid not null references public.pages (id),
  file_id    uuid not null references public.files (id),
  created_at timestamptz not null default now(),
  primary key (page_id, file_id)
);
create index page_files_file_idx on public.page_files (file_id);

-- ---------------------------------------------------------------------------------------------------
-- Permisos: funciones auxiliares
-- ---------------------------------------------------------------------------------------------------
-- Como las de `members`: corren como definer (leen las tablas sin pasar por sus políticas, así la
-- política de `files` no pasa por la de `page_files` ni al revés) y con search_path vacío.

-- ¿La sesión ve el archivo? Si lo creó o si ve alguna página que lo usa. La política de `files` le pasa
-- `created_by` de la fila para no volver a buscarla.
create function private.can_view_file(p_file uuid, p_created_by uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(p_created_by = (select auth.uid()), false)
      or exists (
        select 1 from public.page_files pf
        where pf.file_id = p_file and private.can_view_page(pf.page_id));
$$;

-- ¿La sesión puede editar alguna página del proyecto? Primero lo barato (el permiso sobre el proyecto
-- entero, que cubre al dueño); si no, página por página.
create function private.can_edit_some_page(ws uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.project_level(ws) >= 3
      or exists (
        select 1 from public.pages pg
        where pg.workspace_id = ws and private.page_level(pg.id) >= 3);
$$;

-- El permiso de la sesión sobre un archivo (misma escala que page_level): el más alto sobre las páginas
-- que lo usan. Quien lo creó tiene como mínimo 3 mientras pueda editar alguna página de su proyecto
-- (decisión: no "simplemente si lo creó", para que sacar a alguien del workspace o quitarle la edición
-- del proyecto le corte también sus archivos, como pide la sección 6 del plan). 0 si no existe.
create function private.file_level(p_file uuid)
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
  where pf.file_id = p_file;
  if lvl < 3 and f.created_by = auth.uid() and private.can_edit_some_page(f.project_id) then
    lvl := 3;
  end if;
  return lvl;
end;
$$;

-- El archivo de una miniatura: el nombre tiene que ser exactamente `<uuid en minúsculas>.jpg` (uno solo
-- por archivo, sin carpetas). Cualquier otro nombre da null, y file_level(null) = 0.
create function private.thumb_file_id(p_name text)
returns uuid
language sql immutable set search_path = ''
as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
    then left(p_name, 36)::uuid
  end;
$$;

revoke all on function private.can_view_file(uuid, uuid) from public, anon;
revoke all on function private.can_edit_some_page(uuid) from public, anon;
revoke all on function private.file_level(uuid) from public, anon;
revoke all on function private.thumb_file_id(text) from public, anon;
grant execute on function private.can_view_file(uuid, uuid) to authenticated;
grant execute on function private.can_edit_some_page(uuid) to authenticated;
grant execute on function private.file_level(uuid) to authenticated;
grant execute on function private.thumb_file_id(text) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Row Level Security: desde la API solo se lee
-- ---------------------------------------------------------------------------------------------------

alter table public.files enable row level security;
alter table public.page_files enable row level security;

create policy files_select on public.files
  for select to authenticated using (private.can_view_file(id, created_by));

create policy page_files_select on public.page_files
  for select to authenticated using (private.can_view_page(page_id));

revoke all on public.files, public.page_files from public, anon, authenticated;
grant select on public.files, public.page_files to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- API (RPC)
-- ---------------------------------------------------------------------------------------------------
-- Errores: `page_not_found` y `file_not_found` (P0002) cuando no existe o no alcanza el permiso (no dicen
-- cuál de las dos), `file_other_project` y `file_already_uploaded` (P0001), `drive_id_invalid` (22023) y
-- los de las restricciones de la tabla (23514) si un dato no tiene la forma esperada.

-- Registra un archivo nuevo en una página que la sesión puede editar; el proyecto sale de la página.
-- Reintentar no cambia nada: si el archivo ya existe en el mismo proyecto solo asegura la fila de
-- `page_files`. Decisión: en ese caso además hace falta ver el archivo (file_level >= 1, como en
-- link_page_file), para que conocer un id no alcance para colgarlo de otra página y así verlo; un
-- reintento de quien lo registró siempre lo cumple. Si no, `file_other_project`, igual que si es de otro
-- proyecto.
create function public.register_file(
  p_id uuid, p_page_id uuid, p_name text, p_mime text, p_size bigint,
  p_width int, p_height int, p_duration real)
returns void
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
    raise exception 'file_other_project' using errcode = 'P0001';
  end if;

  insert into public.page_files (page_id, file_id) values (p_page_id, p_id)
  on conflict (page_id, file_id) do nothing;
end;
$$;

-- Suma un archivo que ya existe a otra página (por ejemplo, al copiar el bloque). Si el archivo todavía no
-- llegó al servidor (lo registra otro dispositivo), o la sesión no lo ve, `file_not_found`: la app
-- reintenta más tarde. Reintentar no duplica nada.
create function public.link_page_file(p_page_id uuid, p_file_id uuid)
returns void
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
    raise exception 'file_other_project' using errcode = 'P0001';
  end if;

  insert into public.page_files (page_id, file_id) values (p_page_id, p_file_id)
  on conflict (page_id, file_id) do nothing;
end;
$$;

-- Para el portero, con la sesión de la persona: lo que necesita saber de un archivo y el permiso de la
-- persona sobre él. Null si no existe o si no lo puede ver.
create function public.media_file(p_file_id uuid)
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
    'size', f.size, 'drive_id', f.drive_id, 'created_at', f.created_at, 'level', lvl)
  into r
  from public.files f
  join public.workspaces w on w.id = f.project_id
  where f.id = p_file_id;
  return r;
end;
$$;

-- Lo llama el portero cuando termina la subida. El id en Drive se pone una sola vez: repetir el mismo no
-- cambia nada (tampoco `uploaded_at`); otro distinto es `file_already_uploaded`.
create function public.set_file_drive(p_file_id uuid, p_drive_id text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  cur text;
begin
  if private.file_level(p_file_id) < 3 then
    raise exception 'file_not_found' using errcode = 'P0002';
  end if;
  if p_drive_id is null or p_drive_id !~ '^[A-Za-z0-9_-]{10,200}$' then
    raise exception 'drive_id_invalid' using errcode = '22023';
  end if;

  select f.drive_id into cur from public.files f where f.id = p_file_id for update;
  if cur is null then
    update public.files set drive_id = p_drive_id, uploaded_at = now() where id = p_file_id;
  elsif cur <> p_drive_id then
    raise exception 'file_already_uploaded' using errcode = 'P0001';
  end if;
end;
$$;

-- La app la llama después de subir la miniatura a `thumbs/<id>.jpg`. No mira el bucket (decisión: lo más
-- simple; si la subida falló, la app no llega a llamarla).
create function public.set_file_thumb(p_file_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if private.file_level(p_file_id) < 3 then
    raise exception 'file_not_found' using errcode = 'P0002';
  end if;
  update public.files set thumb_at = now() where id = p_file_id;
end;
$$;

revoke all on function public.register_file(uuid, uuid, text, text, bigint, int, int, real) from public, anon;
revoke all on function public.link_page_file(uuid, uuid) from public, anon;
revoke all on function public.media_file(uuid) from public, anon;
revoke all on function public.set_file_drive(uuid, text) from public, anon;
revoke all on function public.set_file_thumb(uuid) from public, anon;
grant execute on function public.register_file(uuid, uuid, text, text, bigint, int, int, real) to authenticated;
grant execute on function public.link_page_file(uuid, uuid) to authenticated;
grant execute on function public.media_file(uuid) to authenticated;
grant execute on function public.set_file_drive(uuid, text) to authenticated;
grant execute on function public.set_file_thumb(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Miniaturas: bucket privado `thumbs`
-- ---------------------------------------------------------------------------------------------------
-- Un objeto por archivo, `<file_id>.jpg` (el nombre dice .jpg también si es WebP), hasta 512 KB. Lee quien
-- ve el archivo y sube quien lo edita; no hay políticas de update ni de delete, así que una miniatura no
-- se reemplaza ni se borra desde la API (subir con `upsert` falla si ya existe: la app toma "ya existe"
-- como hecho). Las dos políticas buscan el archivo por el nombre del objeto, no por la fila nueva, así
-- que la de lectura también vale para el objeto que se está subiendo.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('thumbs', 'thumbs', false, 524288, array['image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy thumbs_select on storage.objects
  for select to authenticated
  using (bucket_id = 'thumbs' and private.file_level(private.thumb_file_id(name)) >= 1);

create policy thumbs_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'thumbs' and private.file_level(private.thumb_file_id(name)) >= 3);

-- ---------------------------------------------------------------------------------------------------
-- Versión de la base
-- ---------------------------------------------------------------------------------------------------
update public.workspace_settings set schema_version = 3 where id and schema_version < 3;

notify pgrst, 'reload schema';
