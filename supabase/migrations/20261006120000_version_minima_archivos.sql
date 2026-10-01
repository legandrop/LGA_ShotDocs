-- LGA Shot Docs · la versión mínima de la app también frena la cola de archivos (v0.090; Docs/Doc_Sincronizacion.md,
-- "La versión mínima y los archivos").
--
-- Hasta acá `workspace_settings.min_app_version` frenaba solo la subida de contenido (`push_page_update`, que recibe
-- la versión de la app). `register_file`, `link_page_file` y `unlink_page_file` no sabían qué versión los llamaba: una
-- pestaña vieja seguía registrando archivos aunque el workspace pidiera una más nueva (por ejemplo, una v0.074 que
-- registra un HEIC sin pasarlo a JPEG).
--
-- Desde v0.090 la app manda su versión también en esas tres (`p_app_version`, funciones nuevas de abajo) y además se
-- frena sola al leer la mínima. Las versiones anteriores no mandan nada que las identifique, pero solo ellas llaman a
-- las funciones de siempre (sin versión). Por eso:
--   - Con una mínima de 0.090 o más, las de siempre se rechazan (`app_outdated`): quien las llama es seguro más viejo.
--   - Con una mínima menor (o sin mínima), andan como siempre: quien llama puede estar por arriba de la mínima, y
--     rechazarla rompería a una versión permitida.
-- Una versión rechazada no pierde nada: el archivo queda en el dispositivo y en su cola, con el error a la vista, y
-- sale cuando la app se actualiza (las detenidas se vuelven a intentar al abrir la app).
--
-- OJO: 0.090 es la primera versión que manda `p_app_version` en estas funciones. Si se publica con otro número, se
-- cambia acá (`private.files_version_allowed`) y en supabase/tests/version_minima_archivos_permisos.sql antes de
-- aplicar. Un número más bajo que la versión real rechazaría versiones permitidas.
--
-- Compatible con la app y el portero publicados: las firmas de siempre quedan (ahora llaman a las nuevas sin versión),
-- no cambian datos ni permisos y no sube `schema_version` (la app nueva prueba la función con versión y, si la base
-- no la tiene, usa la de siempre).

-- ¿Esta versión puede escribir en los archivos? Con versión, la misma regla que el contenido
-- (`private.app_version_allowed`). Sin versión (las funciones de siempre, que llaman solo versiones anteriores a
-- 0.090): sí, salvo que la mínima sea 0.090 o más.
create function private.files_version_allowed(p_version text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    when p_version is not null then private.app_version_allowed(p_version)
    else not exists (
      select 1 from public.workspace_settings s where s.id and s.min_app_version >= 0.090)
  end;
$$;

revoke all on function private.files_version_allowed(text) from public, anon, authenticated;

-- register_file con la versión de la app. El cuerpo es el de 20260930180000_papelera_archivos.sql, más la versión.
create function public.register_file(
  p_id uuid, p_page_id uuid, p_name text, p_mime text, p_size bigint,
  p_width int, p_height int, p_duration real, p_app_version text)
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
  if not private.files_version_allowed(p_app_version) then
    raise exception 'app_outdated' using errcode = 'P0001',
      hint = 'This version of the app is too old for this workspace. Reload the app to update it.';
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

-- link_page_file con la versión de la app (mismo cuerpo que en la papelera de archivos, más la versión).
create function public.link_page_file(p_page_id uuid, p_file_id uuid, p_app_version text)
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
  if not private.files_version_allowed(p_app_version) then
    raise exception 'app_outdated' using errcode = 'P0001',
      hint = 'This version of the app is too old for this workspace. Reload the app to update it.';
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

-- unlink_page_file con la versión de la app (mismo cuerpo, más la versión). Sin valores por defecto: así una llamada
-- con dos o tres parámetros sigue yendo, sin dudas, a la de siempre.
create function public.unlink_page_file(p_page_id uuid, p_file_id uuid, p_seen_seq bigint, p_app_version text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  cur bigint;
begin
  if private.page_level(p_page_id) < 3 then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  if not private.files_version_allowed(p_app_version) then
    raise exception 'app_outdated' using errcode = 'P0001',
      hint = 'This version of the app is too old for this workspace. Reload the app to update it.';
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

revoke all on function public.register_file(uuid, uuid, text, text, bigint, int, int, real, text) from public, anon;
revoke all on function public.link_page_file(uuid, uuid, text) from public, anon;
revoke all on function public.unlink_page_file(uuid, uuid, bigint, text) from public, anon;
grant execute on function public.register_file(uuid, uuid, text, text, bigint, int, int, real, text) to authenticated;
grant execute on function public.link_page_file(uuid, uuid, text) to authenticated;
grant execute on function public.unlink_page_file(uuid, uuid, bigint, text) to authenticated;

-- Las de siempre (las usan las versiones anteriores a 0.090): las nuevas sin versión. Conservan firma, valor por
-- defecto y permisos.
create or replace function public.register_file(
  p_id uuid, p_page_id uuid, p_name text, p_mime text, p_size bigint,
  p_width int, p_height int, p_duration real)
returns text
language sql security definer set search_path = ''
as $$
  select public.register_file(p_id, p_page_id, p_name, p_mime, p_size, p_width, p_height, p_duration, null::text);
$$;

create or replace function public.link_page_file(p_page_id uuid, p_file_id uuid)
returns text
language sql security definer set search_path = ''
as $$
  select public.link_page_file(p_page_id, p_file_id, null::text);
$$;

create or replace function public.unlink_page_file(p_page_id uuid, p_file_id uuid, p_seen_seq bigint default null)
returns boolean
language sql security definer set search_path = ''
as $$
  select public.unlink_page_file(p_page_id, p_file_id, p_seen_seq, null::text);
$$;

notify pgrst, 'reload schema';
