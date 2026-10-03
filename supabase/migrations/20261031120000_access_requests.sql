-- LGA Shot Docs · links a los archivos en el PDF, entrega 2: *Request access* (P.30). Diseño: Docs/Doc_Links_PDF.md,
-- secciones 5 y 7, decisiones LF9 a LF15, LF19 y LF20.
--
-- Quien abre la dirección fija de un archivo (`/f/<clave local>/<id>`) sin poder verlo lo pide. El pedido queda en una
-- tabla nueva, `access_requests`, cerrada con Row Level Security y sin políticas: nadie la lee ni la escribe directo,
-- solo estas tres funciones.
--
-- - `request_access(archivo)`: un miembro vivo con sesión permitida. Responde lo mismo exista o no el archivo (`sent`),
--   deja una fila en los dos casos (`void` si no vale) y cuenta en el tope de 20 filas nuevas por persona y día. Un
--   pedido repetido renueva su fila como mucho una vez por hora y no mira si el archivo existe.
-- - `access_requests_pending()`: los pendientes de 30 días que quien llama puede decidir, o sea los de archivos que usa
--   alguna página viva que puede compartir (`user_can_share_page`: el dueño, un admin con nivel 4, el dueño del
--   proyecto aunque sea miembro común, LF19), con el correo y el rol de quien pide y solo esas páginas.
-- - `decide_access_request(pedido, aceptar, página, nivel)`: rechazar es explícito (LF20); aceptar da un permiso de los
--   de siempre (`share()`) sobre una de esas páginas y nunca baja uno que ya existe (LF11).
--
-- Compatible con las versiones publicadas: nada de lo que usan cambia. Sube `schema_version` a 22: la app ofrece
-- *Request access* y la lista de pedidos desde ahí.

-- ---------------------------------------------------------------------------------------------------
-- 1. La tabla
-- ---------------------------------------------------------------------------------------------------
create table public.access_requests (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  -- Sin clave foránea a propósito: un id que no existe también deja su fila ('void'), así ni la respuesta ni el tope
  -- dicen qué ids existen (LF9).
  file_id    uuid not null,
  state      text not null default 'pending' check (state in ('pending', 'accepted', 'declined', 'void')),
  times      int not null default 1 check (times between 1 and 1000),
  created_at timestamptz not null default now(),
  asked_at   timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  -- Al aceptar: sobre qué página y con qué nivel se dio el permiso (el permiso vive en `grants`).
  page_id    uuid references public.pages (id) on delete set null,
  level      text check (level in ('view', 'comment', 'edit', 'edit_pages')),
  constraint access_requests_decided check ((state in ('accepted', 'declined')) = (decided_at is not null))
);
-- Uno abierto por persona y archivo; los pendientes de un archivo; el tope por persona y día.
create unique index access_requests_open_key on public.access_requests (user_id, file_id)
  where state in ('pending', 'void');
create index access_requests_pending_idx on public.access_requests (file_id) where state = 'pending';
create index access_requests_user_day_idx on public.access_requests (user_id, created_at);

alter table public.access_requests enable row level security;
revoke all on public.access_requests from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 2. Pedir
-- ---------------------------------------------------------------------------------------------------
-- ¿Vale? El archivo no se mandó a la papelera de Drive (`purged_at`), lo usa una página viva y no hubo un rechazo de ese
-- archivo a esa persona en 24 horas.
create function private.access_request_valid(uid uuid, p_file uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (select 1 from public.files f where f.id = p_file and f.purged_at is not null)
     and exists (select 1 from public.page_files pf
                 where pf.file_id = p_file and pf.removed_at is null and not pf.is_foreign
                   and private.page_alive(pf.page_id))
     and not exists (select 1 from public.access_requests r
                     where r.user_id = uid and r.file_id = p_file and r.state = 'declined'
                       and r.decided_at > now() - interval '24 hours');
$$;

revoke all on function private.access_request_valid(uuid, uuid) from public, anon, authenticated;

create function public.request_access(p_file uuid)
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
  if p_file is null then
    raise exception 'target_invalid' using errcode = '22023';
  end if;
  if private.file_level(p_file) >= 1 then
    return 'has_access';
  end if;
  -- Dos pestañas a la vez no pasan el tope.
  perform pg_advisory_xact_lock(hashtextextended('access_request:' || uid::text, 0));
  -- Repetido: el mismo camino valga o no; después de `file_level` (la misma pregunta que `media_file` y `POST /pass`, con
  -- su diferencia de tiempo ya aceptada en LF4) no vuelve a mirar el archivo.
  select * into cur from public.access_requests r
  where r.user_id = uid and r.file_id = p_file and r.state in ('pending', 'void')
  for update;
  if found then
    if cur.asked_at < now() - interval '1 hour' then
      update public.access_requests set asked_at = now(), times = least(times + 1, 1000) where id = cur.id;
      -- Un `void` de hace más de un día se vuelve a mirar (pasó el día del rechazo, o el archivo ya está en una página).
      if cur.state = 'void' and cur.created_at < now() - interval '24 hours' then
        update public.access_requests set state = 'pending'
        where id = cur.id and private.access_request_valid(uid, p_file);
      end if;
    end if;
    return 'sent';
  end if;
  select count(*) into n from public.access_requests r
  where r.user_id = uid and r.created_at > now() - interval '24 hours';
  if n >= 20 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  valid := private.access_request_valid(uid, p_file);
  insert into public.access_requests (user_id, file_id, state)
  values (uid, p_file, case when valid then 'pending' else 'void' end);
  return 'sent';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 3. Los pendientes de quien decide
-- ---------------------------------------------------------------------------------------------------
-- Los de 30 días, de miembros vivos que todavía no ven el archivo, sobre archivos que no se mandaron a la papelera de
-- Drive y usa alguna página viva que quien llama puede compartir; con solo esas páginas (id y título, en el orden en que se agregó el archivo). Hasta 100. Un
-- invitado, alguien sin membresía o una sesión con contraseña no ven nada.
create function public.access_requests_pending()
returns table (id uuid, user_id uuid, email text, role text, file_id uuid, file_name text, mime text,
               asked_at timestamptz, times int, pages jsonb)
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
    select r.id, r.user_id, u.email::text, m.role, f.id, f.name, f.mime, r.asked_at, r.times, sp.pages
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
    order by r.asked_at desc, r.id
    limit 100;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 4. Decidir
-- ---------------------------------------------------------------------------------------------------
-- `p_accept` explícito (LF20): un error de la app que pierde la página nunca rechaza un pedido. «No existe», «ya
-- decidido», «no te toca», «de hace más de 30 días» (la lista no lo muestra, LF14) y «el archivo se mandó a la papelera
-- de Drive» dan el mismo error (`request_not_found`). Dos que deciden a la vez: la fila se bloquea y el segundo recibe
-- `request_not_found`.
create function public.decide_access_request(p_id uuid, p_accept boolean, p_page uuid default null,
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
     or exists (select 1 from public.files f where f.id = r.file_id and f.purged_at is not null)
     or not exists (
      select 1 from public.page_files pf
      where pf.file_id = r.file_id and pf.removed_at is null and not pf.is_foreign
        and private.page_alive(pf.page_id) and private.user_can_share_page(pf.page_id, uid)) then
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
  if p_page is null or not exists (select 1 from public.page_files pf
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

revoke all on function public.request_access(uuid) from public, anon;
revoke all on function public.access_requests_pending() from public, anon;
revoke all on function public.decide_access_request(uuid, boolean, uuid, text) from public, anon;
grant execute on function public.request_access(uuid) to authenticated;
grant execute on function public.access_requests_pending() to authenticated;
grant execute on function public.decide_access_request(uuid, boolean, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 5. Versión de la base: la app ofrece *Request access* y la lista de pedidos desde la 22.
-- ---------------------------------------------------------------------------------------------------
update public.workspace_settings set schema_version = 22 where id and schema_version < 22;

notify pgrst, 'reload schema';
