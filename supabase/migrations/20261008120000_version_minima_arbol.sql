-- LGA Shot Docs · la versión mínima de la app también frena los cambios del árbol y los comentarios (B.17, v0.0XX;
-- Docs/Doc_Sincronizacion.md, "La versión mínima, el árbol y los comentarios").
--
-- Hasta acá `workspace_settings.min_app_version` frenaba el contenido (`push_page_update`) y la cola de archivos
-- (20261006120000_version_minima_archivos.sql), que reciben la versión de la app. El árbol va directo a las tablas
-- (`pages` y `workspaces`, con Row Level Security) y los comentarios por funciones (`add_comment`, `import_comment`,
-- `edit_comment`, `delete_comment`, `resolve_thread`): una versión anterior a v0.097 abierta seguía creando,
-- renombrando, moviendo y mandando a la papelera páginas, y comentando, aunque el workspace pidiera una más nueva.
--
-- Desde v0.0XX la app manda su versión en el header `x-shotdocs-version` de cada pedido (PostgREST lo deja en
-- `request.headers`). Las versiones anteriores no lo mandan. La regla es la de los archivos:
--   - Con header, se compara con la mínima (`private.app_version_allowed`).
--   - Sin header, se rechaza solo con una mínima de 0.0XX o más: quien llama es seguro más viejo. Con una mínima
--     menor (o sin mínima) anda como siempre, porque quien llama puede ser una versión permitida (la v0.098 no manda
--     el header).
-- Lo miran dos políticas restrictivas (insert y update) en `pages` y en `workspaces`, que solo alcanzan a la escritura
-- directa de la API (las funciones `security definer` no pasan por Row Level Security, así que el portero, la subida
-- de contenido y las de proyectos no cambian), y un trigger en `comments`, que solo escriben esas cinco funciones.
--
-- El rechazo es un error de PostgREST con estado 503 y mensaje `app_outdated`. Todas las versiones publicadas tratan
-- un 503 como pasajero: el cambio del árbol queda en su cola y el comentario queda pendiente, y salen cuando la app se
-- actualiza. Con un 400 la versión vieja los pasaba a la lista de rechazados, donde un renombre o un movimiento se
-- podían descartar con un clic.
--
-- OJO: 0.0XX es la primera versión que manda el header. Quien publica pone el número real acá
-- (`private.write_version_allowed`) y en supabase/tests/version_minima_arbol_permisos.sql antes de aplicar
-- (src/sync/writeVersion.test.ts lo compara con la entrada del changelog que nombra esta migración). Con `0.0XX` la
-- migración no corre. Un número más bajo que la versión real rechazaría versiones permitidas.
--
-- Compatible con la app y el portero publicados: no cambia firmas, datos ni los permisos de siempre, y no sube
-- `schema_version` (la app manda el header siempre; una base sin esta migración lo ignora).

-- La versión que mandó la app en el header `x-shotdocs-version`; null sin header o fuera de un pedido de la API.
create function private.request_app_version()
returns text
language sql stable set search_path = ''
as $$
  select nullif(btrim(nullif(current_setting('request.headers', true), '')::json ->> 'x-shotdocs-version'), '');
$$;

-- ¿Este pedido puede escribir el árbol o los comentarios? Con header, la regla del contenido; sin header (versiones
-- anteriores a 0.0XX), sí, salvo que la mínima sea 0.0XX o más.
create function private.write_version_allowed()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    when private.request_app_version() is not null then private.app_version_allowed(private.request_app_version())
    else not exists (
      select 1 from public.workspace_settings s where s.id and s.min_app_version >= 0.0XX)
  end;
$$;

-- Lo mismo, pero rechaza con el error que las versiones publicadas reintentan (503, `app_outdated`). Devuelve `true`
-- para poder ir en una política.
create function private.require_write_version()
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
begin
  if private.write_version_allowed() then
    return true;
  end if;
  raise sqlstate 'PGRST' using
    message = json_build_object(
      'code', 'P0001',
      'message', 'app_outdated',
      'details', null,
      'hint', 'This version of the app is too old for this workspace. Reload the app to update it.')::text,
    detail = json_build_object('status', 503, 'headers', json_build_object())::text;
end;
$$;

revoke all on function private.request_app_version() from public, anon;
revoke all on function private.write_version_allowed() from public, anon;
revoke all on function private.require_write_version() from public, anon;
-- Las políticas corren con la sesión: `authenticated` las tiene que poder llamar (como `private.page_level`).
grant execute on function private.request_app_version() to authenticated;
grant execute on function private.write_version_allowed() to authenticated;
grant execute on function private.require_write_version() to authenticated;

-- Páginas y proyectos: restrictivas, se suman a las de siempre (que siguen decidiendo quién puede). En el update, la
-- fila que no se ve sigue dando "no encontrada" como siempre: la versión se mira en la fila nueva.
create policy pages_app_version_insert on public.pages
  as restrictive for insert to authenticated
  with check (private.require_write_version());
create policy pages_app_version_update on public.pages
  as restrictive for update to authenticated
  using (true) with check (private.require_write_version());
create policy workspaces_app_version_insert on public.workspaces
  as restrictive for insert to authenticated
  with check (private.require_write_version());
create policy workspaces_app_version_update on public.workspaces
  as restrictive for update to authenticated
  using (true) with check (private.require_write_version());

-- Comentarios: solo los escriben las funciones de siempre, que no pasan por Row Level Security. El trigger mira los
-- pedidos de una sesión de la app (rol `authenticated`); la consola, las migraciones y la clave de servicio no.
-- Corre después de los permisos de cada función (que avisan antes, como `push_page_update`), y una llamada que no
-- escribe nada (el reintento de algo que ya está) no pasa por acá.
create function private.comments_write_version()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '') = 'authenticated' then
    perform private.require_write_version();
  end if;
  return new;
end;
$$;

revoke all on function private.comments_write_version() from public, anon, authenticated;

create trigger comments_write_version
  before insert or update on public.comments
  for each row execute function private.comments_write_version();

notify pgrst, 'reload schema';
