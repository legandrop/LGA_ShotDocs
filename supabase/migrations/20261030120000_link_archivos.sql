-- LGA Shot Docs · link público, entrega 2b: un link Can edit sube fotos, videos y archivos al Drive del dueño (por el
-- portero). Diseño: Docs/Doc_Link_Publico.md, "Entrega 2: Can edit", E2.4, E2.5, E2.7, E2.11 (2b) y 3.9.
--
-- El visitante registra cada archivo nuevo en una página de su rama (`plink_register_file`, con los topes de E2.5:
-- 100 por día, 500 de por vida, 500 MB cada uno, 1 GB por día y 5 GB de por vida, ajustables en `link_limits`), sube la
-- miniatura al bucket `thumbs` (política `thumbs_insert_link`, solo de un archivo que registró él) y el original va al
-- Drive del dueño por el portero, que al terminar llama `plink_set_file_drive` con el header del link. Un id que ya existe
-- nunca se vincula (ni de otro link, ni del equipo, ni de otro proyecto): conocer un id no alcanza para abrirlo.
--
-- Carpetas (P.9) por un link, no (LE7): `plink_register_file` rechaza `inode/directory` y el portero no abre `/folder/*`.
--
-- Compatible con las versiones publicadas: `files.plink_id` es nulable y nada de lo que usan cambia de firma ni de
-- resultado (`public_link_json` suma una clave al final; `link_media_allowed` acepta además lo registrado por el link).
-- Sube `schema_version` a 21: la app ofrece subir por un link desde ahí.

-- ---------------------------------------------------------------------------------------------------
-- 1. Quién registró el archivo
-- ---------------------------------------------------------------------------------------------------
-- Un archivo de un link no tiene cuenta (`created_by` nulo), como las filas admitidas de `page_updates`.
alter table public.files
  add column plink_id uuid references public.public_links (id),
  add constraint files_plink_no_author check (plink_id is null or created_by is null);
create index files_plink_idx on public.files (plink_id) where plink_id is not null;

-- Lo que registró el link también lo puede poner en una fila (LE9-B): además de lo que usa hoy una página de su rama.
create or replace function private.link_media_allowed(l public.public_links, f uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.files x where x.id = f and l.id is not null and x.plink_id = l.id)
      or exists (select 1 from public.page_files pf
                 where pf.file_id = f and pf.removed_at is null and not pf.is_foreign
                   and pf.page_id in (select private.link_branch(l)));
$$;

-- ---------------------------------------------------------------------------------------------------
-- 2. Lo que llama el visitante (anon, por POST; todas VOLATILE)
-- ---------------------------------------------------------------------------------------------------
-- Registrar un archivo nuevo en una página de la rama. Nunca uno que ya existe y no es de este link en esta página
-- (`file_other_project`): sin esto, un id conocido se colgaría de la rama y el link lo vería. Idempotente con el mismo
-- id, página y link (no cuenta otra vez). En una transacción: lo rechazado no suma.
create function public.plink_register_file(
  p_id uuid, p_page_id uuid, p_name text, p_mime text, p_size bigint,
  p_width int, p_height int, p_duration real, p_app_version text)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  l    public.public_links := private.current_plink();
  cur  public.files;
  ws   uuid;
  over text;
  mime text := lower(btrim(coalesce(p_mime, '')));
begin
  if l.id is null then
    raise exception 'link_not_found' using errcode = 'P0002';
  end if;
  if p_id is null or private.link_page_level(l, p_page_id) < 3 then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  -- Dos pedidos iguales a la vez: el segundo espera y sale por la idempotencia.
  perform pg_advisory_xact_lock(hashtextextended('plink_file:' || p_id::text, 0));
  select * into cur from public.files f where f.id = p_id;
  if found then
    if cur.plink_id = l.id
       and exists (select 1 from public.page_files pf where pf.page_id = p_page_id and pf.file_id = p_id) then
      return 'ok';
    end if;
    raise exception 'file_other_project' using errcode = 'P0001';
  end if;
  if not private.link_edit_version_allowed(p_app_version) or not private.files_version_allowed(p_app_version) then
    raise exception 'app_outdated' using errcode = 'P0001',
      hint = 'This version of the app is too old for this workspace. Reload the app to update it.';
  end if;
  -- Carpetas por un link, no (LE7): cientos de archivos y subcarpetas en el Drive del dueño.
  if mime = 'inode/directory' then
    raise exception 'folder_not_allowed' using errcode = 'P0001';
  end if;
  if p_size is null or p_size <= 0 or p_size > private.plink_limit('file_max_bytes') then
    raise exception 'file_too_big' using errcode = '22023';
  end if;
  perform private.plink_db_guard();
  update public.public_links set files_total = files_total + 1, upload_bytes_total = upload_bytes_total + p_size
  where id = l.id
  returning case when files_total > private.plink_limit('life_files') then 'life_files'
                 when upload_bytes_total > private.plink_limit('life_upload_bytes') then 'life_upload_bytes' end
  into over;
  if over is not null then
    raise exception 'link_rate_limited' using errcode = 'P0001', detail = over;
  end if;
  -- Por día: 100 archivos (`file`) y 1 GB (`upload_bytes`).
  perform private.plink_count('file', 1, 0);
  perform private.plink_count('upload', 1, p_size);
  select pg.workspace_id into ws from public.pages pg where pg.id = p_page_id;
  insert into public.files (id, project_id, name, mime, size, width, height, duration, created_by, plink_id)
  values (p_id, ws, coalesce(nullif(btrim(left(p_name, 250)), ''), 'file'), mime, p_size, p_width, p_height, p_duration,
          null, l.id);
  insert into public.page_files (page_id, file_id) values (p_page_id, p_id);
  return 'ok';
end;
$$;

-- El portero, al terminar la subida (con el header del link): solo un archivo de este link que la rama usa hoy, una vez.
-- Si el link se revocó mientras subía, el archivo queda en Drive y en la base sin `drive_id` (como una subida de alguien
-- sacado): no se pierde nada y no entra.
create function public.plink_set_file_drive(p_file_id uuid, p_drive_id text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  l   public.public_links := private.current_plink();
  cur text;
begin
  if l.id is null then
    raise exception 'link_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.files f where f.id = p_file_id and f.plink_id = l.id)
     or private.plink_file_level(p_file_id) < 3 then
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

-- La app, después de subir la miniatura de un archivo que registró este link.
create function public.plink_set_file_thumb(p_file_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  l public.public_links := private.current_plink();
begin
  if l.id is null then
    raise exception 'link_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.files f where f.id = p_file_id and f.plink_id = l.id)
     or private.plink_file_level(p_file_id) < 3 then
    raise exception 'file_not_found' using errcode = 'P0002';
  end if;
  update public.files set thumb_at = now() where id = p_file_id;
end;
$$;

-- Lo que pregunta el portero: el cuerpo de la entrega 1 (20261012120000_link_publico.sql) y dos claves al final.
--   `mine`: el archivo lo registró este link. El portero abre una subida por un link solo con `mine`: con Can edit el
--     link tiene nivel 3 sobre las fotos del equipo de su rama, y sin esto podría subir otros bytes para una que todavía
--     no terminó de subir (el portero recuerda lo subido y se lo daría a la base cuando la persona del equipo la suba).
--   `project_mark`: la huella del proyecto (SHA-256 de `sdproject:<id>`), para que el portero ponga el archivo en la
--     carpeta del proyecto sin que el link sepa cuál es (P10: ni el nombre ni el id del proyecto).
create or replace function public.plink_media_file(p_file uuid)
returns json
language plpgsql volatile security definer set search_path = ''
as $$
declare
  l   public.public_links := private.current_plink();
  lvl int;
  r   json;
begin
  if l.id is null then
    raise exception 'link_not_found' using errcode = 'P0002';
  end if;
  lvl := private.plink_file_level(p_file);
  if lvl < 1 then
    return null;
  end if;
  perform private.plink_count('pass');
  select json_build_object(
    'id', f.id, 'project_id', l.id, 'project_name', '', 'name', f.name, 'mime', f.mime, 'size', f.size,
    'drive_id', f.drive_id, 'created_at', f.created_at, 'level', lvl, 'trashed_at', f.trashed_at,
    'purged_at', f.purged_at, 'drive_trashed_at', f.drive_trashed_at, 'created_by', null, 'via_link', true,
    'mine', f.plink_id is not distinct from l.id,
    'project_mark', encode(extensions.digest('sdproject:' || f.project_id::text, 'sha256'), 'hex'))
  into r
  from public.files f
  where f.id = p_file;
  return r;
end;
$$;

revoke all on function public.plink_register_file(uuid, uuid, text, text, bigint, int, int, real, text) from public, authenticated;
revoke all on function public.plink_set_file_drive(uuid, text) from public, authenticated;
revoke all on function public.plink_set_file_thumb(uuid) from public, authenticated;
grant execute on function public.plink_register_file(uuid, uuid, text, text, bigint, int, int, real, text) to anon;
grant execute on function public.plink_set_file_drive(uuid, text) to anon;
grant execute on function public.plink_set_file_thumb(uuid) to anon;

-- ---------------------------------------------------------------------------------------------------
-- 3. La miniatura de un archivo que registró el link (512 KB y JPEG o WebP: los límites del bucket)
-- ---------------------------------------------------------------------------------------------------
-- Sin header, la política no hace nada más (la guarda del token va primero). Sin update ni delete: una miniatura no se
-- reemplaza ni se borra desde la API.
create function private.plink_thumb_insertable(p_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.files f, private.current_plink() l
    where l.id is not null and l.level = 'edit' and f.plink_id = l.id and f.id::text || '.jpg' = p_name
      and private.plink_file_level(f.id) >= 3);
$$;

revoke all on function private.plink_thumb_insertable(text) from public, anon, authenticated;
grant execute on function private.plink_thumb_insertable(text) to anon;
create policy thumbs_insert_link on storage.objects
  for insert to anon
  with check (bucket_id = 'thumbs' and private.plink_token() is not null and private.plink_thumb_insertable(name));

-- ---------------------------------------------------------------------------------------------------
-- 4. Lo que ve el equipo en Share: lo subido al Drive (E2.8, E2.10)
-- ---------------------------------------------------------------------------------------------------
-- El cuerpo de la 2a (20261028120000_link_editar.sql) y dos cambios: `limited` cuenta también los archivos del día
-- (`file`, `upload_bytes`), y `files` dice cuántos archivos registró el link y cuánto pesan, de por vida (Share avisa al
-- pasar 1 GB).
create or replace function private.public_link_json(l public.public_links)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', l.id, 'page_id', l.page_id, 'level', l.level, 'created_at', l.created_at, 'expires_at', l.expires_at,
    'created_by', l.created_by,
    'created_by_name', (select nullif(split_part(u.email, '@', 1), '') from auth.users u where u.id = l.created_by),
    'token', l.token,
    -- Anda hoy: no venció y quien lo creó todavía puede compartir (la raíz en la papelera, aparte).
    'alive', (l.expires_at is null or l.expires_at > now()) and l.created_by is not null
             and private.user_can_share_page(l.page_id, l.created_by),
    'usage_today', coalesce((
      select jsonb_object_agg(u.kind, jsonb_build_object('n', u.n, 'bytes', u.bytes))
      from public.public_link_usage u where u.link_id = l.id and u.day = current_date), '{}'::jsonb),
    'limited', exists (
      select 1 from public.public_link_usage u
      where u.link_id = l.id and u.day = current_date
        and ((u.kind = 'open' and u.n >= private.plink_limit('open'))
             or (u.kind = 'pull' and u.bytes >= private.plink_limit('pull_bytes'))
             or (u.kind = 'pass' and u.n >= private.plink_limit('pass'))
             or (u.kind = 'comment' and (u.n >= private.plink_limit('comment')
                                         or u.bytes >= private.plink_limit('comment_bytes')))
             or (u.kind = 'push' and (u.n >= private.plink_limit('push')
                                      or u.bytes >= private.plink_limit('push_bytes')))
             or (u.kind = 'file' and u.n >= private.plink_limit('file'))
             or (u.kind = 'upload' and u.bytes >= private.plink_limit('upload_bytes')))),
    'comments', (select count(*) from public.comments c where c.plink_id = l.id and c.deleted_at is null),
    'edits', (select jsonb_build_object(
        'waiting', coalesce(sum(x.n) filter (where x.state = 'waiting'), 0),
        'held', coalesce(sum(x.n) filter (where x.state = 'held'), 0),
        'aside', (select count(*) from public.public_link_updates a where a.link_id = l.id and a.decision = 'aside'),
        'admitted_today', (select count(*) from public.public_link_updates a
                           where a.link_id = l.id and a.decision = 'admitted' and a.decided_at >= current_date),
        'push_bytes_total', l.push_bytes_total)
      from (select case when private.link_page_level(l, w.page_id) = 3 then 'waiting' else 'held' end as state, w.n
            from (select u.page_id, count(*) as n from public.public_link_updates u
                  where u.link_id = l.id and u.decided_at is null group by u.page_id) w) x),
    'files', jsonb_build_object('total', l.files_total, 'bytes', l.upload_bytes_total));
$$;

-- ---------------------------------------------------------------------------------------------------
-- 5. Versión de la base: la app sube archivos por un link desde la 21. Nada cambia para la versión publicada.
-- ---------------------------------------------------------------------------------------------------
update public.workspace_settings set schema_version = 21 where id and schema_version < 21;

notify pgrst, 'reload schema';
