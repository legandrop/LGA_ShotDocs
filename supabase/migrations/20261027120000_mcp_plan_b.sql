-- LGA Shot Docs · MCP, plan B: el token de un asistente solo llega a las funciones `mcp_*` (Docs/Doc_Asistente.md,
-- 9.2 y "Cómo quedó M0", paso 2).
--
-- Un cliente MCP recibe del servidor OAuth de Supabase un token de la persona con `client_id`, rol `authenticated`.
-- Sin esto, ese token valdría como una sesión de la app: vería y podría todo lo de la cuenta. Esta migración:
--   1. `private.mcp_pre_request()`: la función que PostgREST corre antes de cada pedido (`db_pre_request`). Si el JWT
--      trae `client_id`, deja pasar solo `/rpc/mcp_<minúsculas, números y _>`; si no, no hace nada.
--   2. La conecta a PostgREST (`pgrst.db_pre_request` en el rol `authenticator`) y le pide recargar la configuración.
--   3. Las cuatro políticas de Storage de `authenticated` (fotos y miniaturas) exigen además que el token no traiga
--      `client_id`: Storage no pasa por PostgREST. La de `anon` (link público) no cambia.
--   4. `public.mcp_ping()`: devuelve la persona del token. Sirve para probar el camino del token OAuth (paso 6).
--
-- Corre en CADA pedido de la app a PostgREST: si tirara un error, la app dejaría de andar. Por eso, con una sesión de
-- la app (sin `client_id`) sale enseguida sin convertir nada, sin tablas y sin nada que pueda fallar.
--
-- Compatible con la app publicada: no cambia ninguna tabla ni función que use; `schema_version` no cambia (la app no
-- depende de nada nuevo). Volver atrás (Doc_Supabase.md, "MCP: plan B"):
--   alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config';
-- y las cuatro políticas con su expresión de antes. Nunca mientras quede una sesión OAuth viva.

-- ---------------------------------------------------------------------------------------------------
-- 1. La función de pre-request
-- ---------------------------------------------------------------------------------------------------
-- PostgREST la llama después de cambiar al rol del pedido (`anon`, `authenticated` o `service_role`) y de cargar
-- `request.jwt.claims` y `request.path` (la ruta sin `/rest/v1`, por ejemplo `/rpc/share` o `/pages`), y antes de la
-- consulta. Un error acá corta el pedido y vuelve a quien llamó (42501 → 403 con sesión, 401 sin).
--
-- - Camino rápido: si el texto de los claims no dice `client_id`, vuelve sin más (todo pedido de la app, con sesión o
--   sin ella, incluido el link público). No convierte a jsonb: nada puede fallar.
-- - Si lo dice (un token de asistente, o una sesión con `client_id` en sus metadatos), recién ahí lo lee como jsonb.
--   Sin `client_id` arriba de todo, vuelve. Con `client_id` (aunque sea vacío) o si no se pudo leer, solo pasa una ruta
--   `/rpc/mcp_[a-z0-9_]+`. Sin ruta, se rechaza.
-- - El camino rápido busca la clave escrita tal cual: Supabase Auth la escribe así y PostgREST vuelve a escribir los
--   claims sin escapar `_` (un `client_id` no llega nunca; Storage, que no pasa por acá, igual lo frena).
-- `create or replace`: la vuelta atrás deja la función, y la migración se puede volver a aplicar.
create or replace function private.mcp_pre_request()
returns void
language plpgsql stable set search_path = ''
as $$
declare
  raw text := current_setting('request.jwt.claims', true);
  claims jsonb;
  ruta text;
begin
  if raw is null or strpos(raw, 'client_id') = 0 then
    return;
  end if;

  begin
    claims := raw::jsonb;
  exception when others then
    claims := null;
  end;
  if jsonb_typeof(claims) = 'object' and not (claims ? 'client_id') then
    return;
  end if;

  ruta := current_setting('request.path', true);
  if ruta ~ '^/rpc/mcp_[a-z0-9_]+$' then
    return;
  end if;

  raise exception using
    errcode = '42501',
    message = 'mcp_route_not_allowed',
    hint = 'An assistant connection can only call the assistant functions.';
end;
$$;

-- La ejecutan los roles a los que cambia PostgREST. Sin este permiso, TODO pedido a PostgREST de ese rol falla.
-- `service_role` no tenía `usage` en `private` (la app no lo usa, pero un script o el panel podrían).
revoke all on function private.mcp_pre_request() from public;
grant usage on schema private to service_role;
grant execute on function private.mcp_pre_request() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------
-- 2. Conectarla a PostgREST
-- ---------------------------------------------------------------------------------------------------
-- PostgREST lee su configuración de la base (`pgrst.*` en el rol con que entra) al arrancar y con
-- `notify pgrst, 'reload config'`, que llega al hacer commit: para entonces la función y sus permisos ya existen.
alter role authenticator set pgrst.db_pre_request = 'private.mcp_pre_request';

-- ---------------------------------------------------------------------------------------------------
-- 3. Storage: los tokens de asistentes no suben ni bajan fotos ni miniaturas
-- ---------------------------------------------------------------------------------------------------
-- Las mismas expresiones de hoy, con `client_id is null` al final. `alter policy` cambia solo la expresión: el nombre,
-- la orden y el rol quedan, y no hay un momento sin política. Toma un instante un lock exclusivo de `storage.objects`:
-- aplicarla sin subidas en curso.
alter policy page_files_select on storage.objects
  using (
    bucket_id = 'page-files'
    and private.can_view_page(private.try_uuid((storage.foldername(name))[1]))
    and (auth.jwt() ->> 'client_id') is null
  );

alter policy page_files_insert on storage.objects
  with check (
    bucket_id = 'page-files'
    and private.can_edit_page(private.try_uuid((storage.foldername(name))[1]))
    and (auth.jwt() ->> 'client_id') is null
  );

alter policy thumbs_select on storage.objects
  using (
    bucket_id = 'thumbs'
    and private.file_level(private.thumb_file_id(name)) >= 1
    and (auth.jwt() ->> 'client_id') is null
  );

alter policy thumbs_insert on storage.objects
  with check (
    bucket_id = 'thumbs'
    and private.file_level(private.thumb_file_id(name)) >= 3
    and (auth.jwt() ->> 'client_id') is null
  );

-- ---------------------------------------------------------------------------------------------------
-- 4. mcp_ping: la persona del token
-- ---------------------------------------------------------------------------------------------------
-- La única función `mcp_*` hasta M1. No lee tablas: con un token de asistente devuelve su persona, y prueba que
-- PostgREST deja pasar `/rpc/mcp_ping` y nada más.
create or replace function public.mcp_ping()
returns uuid
language sql stable set search_path = ''
as $$
  select auth.uid();
$$;

revoke all on function public.mcp_ping() from public, anon;
grant execute on function public.mcp_ping() to authenticated;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
