-- Historial de versiones de una página (P.18, entrega 1; Docs/Doc_Historial.md, secciones 7 y 9).
--
-- Las versiones se arman en el dispositivo con las filas de `page_updates` aplicadas en orden: no se guarda nada
-- nuevo. Esta migración agrega:
--
--   - `page_history(page, after_seq, limit)`: las filas con su autor y su hora, solo a quien puede editar la página
--     (nivel 3 o más) y no es invitado (decisión del 2026-10-01). Una página en la papelera (o adentro de una) no.
--   - `page_history_authors(page)`: los correos de quienes subieron algo a esa página (también si ya no son
--     miembros), con la misma comprobación.
--   - El autor y la hora de cada fila dejan de leerse directo desde la API: hasta ahora la política
--     `page_updates_select` dejaba a cualquiera que ve la página (nivel 1, invitados incluidos) pedir
--     `created_by` y `created_at`, y armarse el historial con quién y cuándo. Ahora `authenticated` puede leer solo
--     las columnas del contenido (la app nunca leyó la tabla directo: baja con `pull_page_updates`, que no cambia).
--
-- No toca `push_page_update`, `pull_page_updates` ni ninguna fila. La app lo usa desde `HISTORY_SCHEMA_VERSION`
-- (src/sync/history.ts): con la base sin migrar, el historial no se ofrece.

-- Invitados: sin historial (decisión de Lega del 2026-10-01). El rol es de todo el workspace.
create function private.history_denied_for_guest()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.workspace_role((select auth.uid())) = 'guest', false);
$$;

-- ¿La página o alguna de las de arriba está en la papelera? (Como `trashedAncestor` en la app.)
create function private.page_in_trash(p uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  with recursive chain (id, parent_id, deleted_at, depth) as (
    select pg.id, pg.parent_id, pg.deleted_at, 0 from public.pages pg where pg.id = p
    union all
    select pg.id, pg.parent_id, pg.deleted_at, c.depth + 1
    from public.pages pg join chain c on pg.id = c.parent_id
    where c.depth < 1000
  )
  select exists (select 1 from chain where deleted_at is not null);
$$;

-- La comprobación de las dos funciones: nivel 3 o más, no invitado, no en la papelera.
create function private.check_history(p uuid)
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if private.page_level(p) < 3 or private.history_denied_for_guest() then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  if private.page_in_trash(p) then
    raise exception 'page_in_trash' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function private.history_denied_for_guest() from public, anon, authenticated;
revoke all on function private.page_in_trash(uuid) from public, anon, authenticated;
revoke all on function private.check_history(uuid) from public, anon, authenticated;

-- Las filas de una página, en orden, con su autor y su hora (el contenido en base64, como pull_page_updates).
-- `id` es el contador de page_updates: la caché del dispositivo lo usa para darse cuenta de que restauraron una copia.
create function public.page_history(p_page_id uuid, p_after_seq bigint, p_limit int default 500)
returns table (id bigint, seq bigint, created_by uuid, created_at timestamptz, update text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.check_history(p_page_id);
  return query
    select u.id, u.seq, u.created_by, u.created_at, translate(encode(u.update, 'base64'), E'\n', '')
    from public.page_updates u
    where u.page_id = p_page_id and u.seq > p_after_seq
    order by u.seq
    limit least(greatest(p_limit, 1), 1000);
end;
$$;

-- Quiénes subieron algo a esta página, con su correo (también quienes ya no son miembros: lo que hicieron sigue).
create function public.page_history_authors(p_page_id uuid)
returns table (user_id uuid, email text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.check_history(p_page_id);
  return query
    select au.id, au.email::text
    from auth.users au
    where au.id in (select distinct u.created_by from public.page_updates u where u.page_id = p_page_id)
    order by au.email, au.id;
end;
$$;

revoke all on function public.page_history(uuid, bigint, int) from public, anon;
revoke all on function public.page_history_authors(uuid) from public, anon;
grant execute on function public.page_history(uuid, bigint, int) to authenticated;
grant execute on function public.page_history_authors(uuid) to authenticated;

-- Quién y cuándo, solo por page_history: desde la API se leen solo las columnas del contenido (lo mismo que ya da
-- pull_page_updates). La política `page_updates_select` no cambia.
revoke select on public.page_updates from authenticated;
grant select (id, page_id, seq, client_update_id, update) on public.page_updates to authenticated;

update public.workspace_settings set schema_version = 11 where id and schema_version < 11;

notify pgrst, 'reload schema';
