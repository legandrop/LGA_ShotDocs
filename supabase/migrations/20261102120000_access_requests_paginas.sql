-- LGA Shot Docs · *Request access*, entrega 3: pedir también una página (P.30). Diseño: Docs/Doc_Links_PDF.md, secciones
-- 5, 11 («E3») y 15 (O19); lo que quedó, en la sección 18.
--
-- Quien abre `/p/<id>` sin poder verla lo pide, igual que un archivo desde su dirección fija (la 22). La misma tabla
-- (`access_requests`) suma **otra columna** para la página pedida (`target_page_id`; `page_id` sigue siendo «sobre qué
-- página se dio el permiso»), `file_id` deja de ser obligatorio y un `check` pide uno de los dos. Las reglas son las de
-- la 22:
--
-- - `request_page_access(página)`: un miembro vivo con sesión permitida. Responde lo mismo exista o no la página
--   (`sent`), deja una fila en los dos casos (`void` si no vale: no existe, está en la papelera, el proyecto se borró o
--   la rechazaron hace menos de 24 horas) y cuenta en el **mismo** tope de 20 filas nuevas por persona y día que los
--   archivos. Repetido, renueva su fila como mucho una vez por hora.
-- - `access_requests_pending()` suma los pedidos de páginas que quien llama puede compartir (`user_can_share_page`, que
--   ya cuenta los permisos sobre una página de arriba), con esa sola página; suma la columna `target_page_id` al final.
-- - `decide_access_request()` decide también un pedido de página: el permiso va sobre la página pedida y ninguna otra
--   (lo mínimo, LF11), nunca baja uno que ya existe y rechazar sigue siendo explícito (LF20).
--
-- Compatible con las versiones publicadas: `request_access(archivo)` no cambia; la lista suma una columna al final y
-- las filas de páginas traen `file_id` nulo, que la app publicada descarta. Sube `schema_version` a 24: la app ofrece
-- pedir una página desde ahí.

-- ---------------------------------------------------------------------------------------------------
-- 1. La tabla: el objetivo es un archivo o una página, nunca los dos ni ninguno
-- ---------------------------------------------------------------------------------------------------
alter table public.access_requests alter column file_id drop not null;
-- Sin clave foránea a propósito, como `file_id`: una página que no existe también deja su fila ('void').
alter table public.access_requests add column target_page_id uuid;
alter table public.access_requests
  add constraint access_requests_target check (num_nonnulls(file_id, target_page_id) = 1);
-- Uno abierto por persona y página; los pendientes de una página.
create unique index access_requests_open_page_key on public.access_requests (user_id, target_page_id)
  where state in ('pending', 'void') and target_page_id is not null;
create index access_requests_page_pending_idx on public.access_requests (target_page_id)
  where state = 'pending' and target_page_id is not null;

-- ---------------------------------------------------------------------------------------------------
-- 2. Pedir una página
-- ---------------------------------------------------------------------------------------------------
-- ¿Vale? La página está viva (ni ella ni una de arriba en la papelera, proyecto sin borrar) y no hubo un rechazo de esa
-- página a esa persona en 24 horas.
create function private.page_request_valid(uid uuid, p_page uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.page_alive(p_page)
     and not exists (select 1 from public.access_requests r
                     where r.user_id = uid and r.target_page_id = p_page and r.state = 'declined'
                       and r.decided_at > now() - interval '24 hours');
$$;

revoke all on function private.page_request_valid(uuid, uuid) from public, anon, authenticated;

create function public.request_page_access(p_page uuid)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  uid   uuid := auth.uid();
  cur   public.access_requests;
  valid boolean;
  n     int;
begin
  if uid is null or private.workspace_role(uid) is null then
    raise exception 'not_member' using errcode = '42501';
  end if;
  if p_page is null then
    raise exception 'target_invalid' using errcode = '22023';
  end if;
  -- La misma pregunta que el `select` de `pages` (`can_view_page`): quien ya la ve lo sabe.
  if private.page_level(p_page) >= 1 then
    return 'has_access';
  end if;
  -- El mismo candado que los archivos: el tope es uno solo.
  perform pg_advisory_xact_lock(hashtextextended('access_request:' || uid::text, 0));
  select * into cur from public.access_requests r
  where r.user_id = uid and r.target_page_id = p_page and r.state in ('pending', 'void')
  for update;
  if found then
    if cur.asked_at < now() - interval '1 hour' then
      update public.access_requests set asked_at = now(), times = least(times + 1, 1000) where id = cur.id;
      if cur.state = 'void' and cur.created_at < now() - interval '24 hours' then
        update public.access_requests set state = 'pending'
        where id = cur.id and private.page_request_valid(uid, p_page);
      end if;
    end if;
    return 'sent';
  end if;
  select count(*) into n from public.access_requests r
  where r.user_id = uid and r.created_at > now() - interval '24 hours';
  if n >= 20 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  valid := private.page_request_valid(uid, p_page);
  insert into public.access_requests (user_id, target_page_id, state)
  values (uid, p_page, case when valid then 'pending' else 'void' end);
  return 'sent';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 3. Los pendientes de quien decide: los de archivos (como en la 22) y los de páginas
-- ---------------------------------------------------------------------------------------------------
-- La forma de la fila cambia (una columna más al final): hay que borrar la función y crearla de nuevo.
drop function public.access_requests_pending();

create function public.access_requests_pending()
returns table (id uuid, user_id uuid, email text, role text, file_id uuid, file_name text, mime text,
               asked_at timestamptz, times int, pages jsonb, target_page_id uuid)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
begin
  if uid is null or coalesce(private.workspace_role(uid), 'guest') = 'guest' then
    return;
  end if;
  return query
    select * from (
      select r.id as req_id, r.user_id as req_user, u.email::text as req_email, m.role as req_role, f.id as req_file,
             f.name as req_file_name, f.mime as req_mime, r.asked_at as req_asked_at, r.times as req_times,
             sp.pages as req_pages, null::uuid as req_target
      from public.access_requests r
      join public.members m on m.user_id = r.user_id and m.removed_at is null
      join auth.users u on u.id = r.user_id
      join public.files f on f.id = r.file_id and f.purged_at is null
      cross join lateral (
        select jsonb_agg(jsonb_build_object('page_id', pg.id, 'title', pg.title) order by pf.created_at, pg.id) as pages
        from public.page_files pf join public.pages pg on pg.id = pf.page_id
        where pf.file_id = r.file_id and pf.removed_at is null and not pf.is_foreign
          and private.page_alive(pf.page_id) and private.user_can_share_page(pf.page_id, uid)
      ) sp
      where r.state = 'pending' and r.asked_at > now() - interval '30 days' and r.user_id <> uid
        and sp.pages is not null
        and not exists (select 1 from public.page_files pf2
                        where pf2.file_id = r.file_id and pf2.removed_at is null and not pf2.is_foreign
                          and private.user_page_level(pf2.page_id, r.user_id) >= 1)
      union all
      -- Una página: la ve quien puede compartirla (o una de arriba), con esa sola página; nunca a quien ya la ve.
      select r.id, r.user_id, u.email::text, m.role, null::uuid, null::text, null::text, r.asked_at, r.times,
             jsonb_build_array(jsonb_build_object('page_id', pg.id, 'title', pg.title)), pg.id
      from public.access_requests r
      join public.members m on m.user_id = r.user_id and m.removed_at is null
      join auth.users u on u.id = r.user_id
      join public.pages pg on pg.id = r.target_page_id
      where r.state = 'pending' and r.asked_at > now() - interval '30 days' and r.user_id <> uid
        and private.page_alive(pg.id) and private.user_can_share_page(pg.id, uid)
        and private.user_page_level(pg.id, r.user_id) < 1
    ) q
    order by q.req_asked_at desc, q.req_id
    limit 100;
end;
$$;

revoke all on function public.access_requests_pending() from public, anon;
grant execute on function public.access_requests_pending() to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 4. Decidir: un archivo como en la 22; una página, solo sobre ella
-- ---------------------------------------------------------------------------------------------------
-- «No existe», «ya decidido», «no te toca», «de hace más de 30 días» y «el objetivo ya no está vivo» dan el mismo error
-- (`request_not_found`). Dos que deciden a la vez: la fila se bloquea y el segundo recibe `request_not_found`.
create or replace function public.decide_access_request(p_id uuid, p_accept boolean, p_page uuid default null,
                                                        p_level text default 'view')
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  r   public.access_requests;
begin
  select * into r from public.access_requests ar where ar.id = p_id for update;
  if not found or r.state <> 'pending' or r.asked_at <= now() - interval '30 days'
     or (r.target_page_id is not null
         and not (private.page_alive(r.target_page_id) and private.user_can_share_page(r.target_page_id, uid)))
     or (r.file_id is not null
         and (exists (select 1 from public.files f where f.id = r.file_id and f.purged_at is not null)
              or not exists (
                select 1 from public.page_files pf
                where pf.file_id = r.file_id and pf.removed_at is null and not pf.is_foreign
                  and private.page_alive(pf.page_id) and private.user_can_share_page(pf.page_id, uid)))) then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  if p_accept is null then
    raise exception 'decision_invalid' using errcode = '22023';
  end if;
  if not p_accept then
    update public.access_requests set state = 'declined', decided_at = now(), decided_by = uid where id = p_id;
    return 'declined';
  end if;
  if p_level is null or p_level not in ('view', 'comment', 'edit', 'edit_pages') then
    raise exception 'level_invalid' using errcode = '22023';
  end if;
  if r.target_page_id is not null then
    -- Una página: el permiso va sobre ella (ya se comprobó que está viva y que quien llama la puede compartir).
    if p_page is distinct from r.target_page_id then
      raise exception 'page_invalid' using errcode = '22023';
    end if;
  elsif p_page is null or not exists (select 1 from public.page_files pf
                 where pf.file_id = r.file_id and pf.page_id = p_page and pf.removed_at is null and not pf.is_foreign)
     or not private.page_alive(p_page) or not private.user_can_share_page(p_page, uid) then
    raise exception 'page_invalid' using errcode = '22023';
  end if;
  if private.workspace_role(r.user_id) is null then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
  -- Nunca baja (LF11): `share()` pisa el nivel de un permiso sobre la misma página, así que solo se llama si sube.
  if private.user_page_level(p_page, r.user_id) < private.grant_level_value(p_level) then
    perform public.share(r.user_id, null, p_page, p_level);
  end if;
  update public.access_requests
  set state = 'accepted', decided_at = now(), decided_by = uid, page_id = p_page, level = p_level
  where id = p_id;
  return 'accepted';
end;
$$;

revoke all on function public.request_page_access(uuid) from public, anon;
grant execute on function public.request_page_access(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 5. Versión de la base: la app ofrece pedir una página desde la 24.
-- ---------------------------------------------------------------------------------------------------
update public.workspace_settings set schema_version = 24 where id and schema_version < 24;

notify pgrst, 'reload schema';
