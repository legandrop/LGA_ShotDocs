-- LGA Shot Docs · privacidad de lo borrado (D14, entrega 1; Docs/Doc_Privacidad_Borrado.md, secciones 4 y 7).
--
-- El contenido de una página viaja como filas de `page_updates`, con el texto tal como se subió: quien la ve baja
-- también lo que se escribió y después se borró. Con esta migración:
--
--   - Quien NO ve lo borrado de una página (el criterio del historial, D13: menos que Editar, o invitado) deja de
--     recibir filas por `pull_page_updates`: recibe la última **base limpia**, la página entera con lo borrado como
--     hueco, que arma el dispositivo de alguien que sí lo ve y sube con `push_clean_base`. Sin base vigente, nada
--     (la app dice "en preparación"). **Solo con el interruptor prendido** (`workspace_settings.clean_min_version`):
--     esta migración lo deja apagado y, apagado, todos bajan filas como siempre.
--   - Compartir (`share`), invitar (`create_invitation`) con Ver, Comentar o a un invitado, y mover una página a una
--     rama con lectores, reinician la base de lo alcanzado (`clean_reset_seq = update_seq`): una base armada con una
--     vista anterior ya no se sirve ni se acepta.
--   - Vale desde que se aplica, con el interruptor apagado: la columna `update` de `page_updates` deja de leerse
--     directo desde la API (la app baja por funciones); un uso sacado de una foto o un archivo
--     (`page_files.removed_at`) deja de dar permiso a quien no ve lo borrado de esa página (`can_view_file`,
--     `file_level`, la política de `page_files`; de ahí `files`, `thumbs`, el portero); y la papelera de archivos
--     (`trashed_files`) no responde a invitados.
--
-- Nada se borra ni se reescribe: la base es una copia derivada (D4) que se puede tirar y volver a armar.
--
-- Compatible con la app publicada (v0.100) y las anteriores: las firmas no cambian; con el interruptor apagado
-- `pull_page_updates` devuelve lo mismo que hoy. Sube `schema_version` a 12: la app pide `pages.clean_seq` desde ahí.
-- Para prender el interruptor: el script de restaurar del repo de copias tiene que vaciar `page_clean_bases` y dejar
-- `clean_seq` en 0 y `clean_reset_seq` en el `update_seq` restaurado; `min_app_version` en la versión de esta entrega;
-- copia de seguridad; y recién ahí `clean_min_version` (sección 10 del doc).
--
-- Necesita `pgcrypto` (`extensions.digest`), que Supabase ya trae.

-- ---------------------------------------------------------------------------------------------------
-- 1. El contenido de page_updates no se lee directo desde la API
-- ---------------------------------------------------------------------------------------------------
-- La app nunca leyó la tabla: baja con `pull_page_updates` y el historial con `page_history`. Quedan legibles las
-- columnas sin contenido (`id`, `page_id`, `seq`, `client_update_id`), que no dicen nada que no diga `update_seq`.
revoke select (update) on public.page_updates from authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 2. ¿La sesión recibe lo borrado de esta página? El criterio del historial (D13), sin mirar la papelera
-- ---------------------------------------------------------------------------------------------------
-- Una sola función para todo (bajar, armar, archivos). Si Lega abre el historial a otros, cambia acá.
create function private.sees_deleted(p uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.page_level(p) >= 3 and not private.history_denied_for_guest();
$$;

revoke all on function private.sees_deleted(uuid) from public, anon;
-- La usa la política de `page_files` (corre con la sesión).
grant execute on function private.sees_deleted(uuid) to authenticated;

-- ¿Alguien activo ve esta página sin ver lo borrado? Un invitado con cualquier nivel, o alguien con Ver o Comentar.
-- Solo entre quienes tienen un permiso sobre el proyecto o sobre la página o una de arriba (el creador del proyecto
-- tiene 4 y no es invitado).
create function private.has_plain_readers(p uuid)
returns boolean
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
  cand as (
    select distinct g.user_id
    from public.grants g
    where g.revoked_at is null
      and (g.project_id = (select pg.workspace_id from public.pages pg where pg.id = p)
           or g.page_id in (select c.id from chain c))
  )
  select exists (
    select 1
    from cand c
    join public.members m on m.user_id = c.user_id and m.removed_at is null
    where (m.role = 'guest' and private.user_page_level(p, c.user_id) >= 1)
       or (m.role <> 'guest' and private.user_page_level(p, c.user_id) between 1 and 2));
$$;

revoke all on function private.has_plain_readers(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 3. La base vigente, una por página
-- ---------------------------------------------------------------------------------------------------
create table public.page_clean_bases (
  page_id        uuid primary key references public.pages (id) on delete cascade,
  -- Lo crea el dispositivo: reintentar con el mismo id no hace nada nuevo.
  id             uuid not null,
  -- Hasta qué fila llega, y el `page_updates.id` de esa fila: después de restaurar una copia, otra fila puede tener
  -- ese `seq`, y entonces la base no vale.
  to_seq         bigint not null check (to_seq > 0),
  last_update_id bigint not null,
  state          bytea not null check (octet_length(state) between 1 and 8388608),
  sha256         bytea not null check (octet_length(sha256) = 32),
  app_version    numeric(8, 3) not null,
  created_by     uuid default auth.uid() references auth.users (id) on delete set null,
  created_at     timestamptz not null default now()
);

alter table public.page_clean_bases enable row level security;
-- Todo por funciones: ninguna política, ningún permiso.
revoke all on public.page_clean_bases from public, anon, authenticated;

alter table public.pages
  -- `to_seq` de la base vigente (0: ninguna). Para quien no ve lo borrado, "al día" es llegar hasta acá.
  add column clean_seq       bigint not null default 0 check (clean_seq >= 0),
  -- Cuándo se armó (la cadencia de `clean_work`).
  add column clean_at        timestamptz,
  -- El `update_seq` al compartir: una base vale si llega por lo menos hasta acá.
  add column clean_reset_seq bigint not null default 0 check (clean_reset_seq >= 0);
-- Las tres se leen con el árbol (`grant select` de la tabla) y no se escriben desde la API (los `grant update` de
-- `pages` son por columna y no las nombran).

alter table public.workspace_settings
  -- El interruptor: null, apagado (todos bajan filas). Con un número, la versión mínima de la app que arma bases.
  add column clean_min_version numeric(8, 3) check (clean_min_version >= 0);

create function private.clean_min_version()
returns numeric
language sql stable security definer set search_path = ''
as $$
  select s.clean_min_version from public.workspace_settings s where s.id;
$$;

-- ¿Esta versión de la app puede armar bases? La mínima del workspace y la del interruptor.
create function private.clean_version_allowed(p_version text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.clean_min_version() is not null
     and private.app_version_allowed(p_version)
     and coalesce(p_version ~ '^[0-9]{1,4}(\.[0-9]{1,3})?$', false)
     and (case when p_version ~ '^[0-9]{1,4}(\.[0-9]{1,3})?$' then p_version::numeric else -1 end)
         >= private.clean_min_version();
$$;

-- La base vigente: llega por lo menos al reinicio, no pasa de `update_seq` y su fila final sigue teniendo su id.
create function private.current_clean_base(p uuid)
returns public.page_clean_bases
language sql stable security definer set search_path = ''
as $$
  select b.*
  from public.page_clean_bases b
  join public.pages pg on pg.id = b.page_id
  where b.page_id = p
    and b.to_seq >= pg.clean_reset_seq
    and b.to_seq <= pg.update_seq
    and exists (
      select 1 from public.page_updates u
      where u.page_id = p and u.seq = b.to_seq and u.id = b.last_update_id);
$$;

revoke all on function private.clean_min_version() from public, anon, authenticated;
revoke all on function private.clean_version_allowed(text) from public, anon, authenticated;
revoke all on function private.current_clean_base(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 4. Bajar: misma firma
-- ---------------------------------------------------------------------------------------------------
-- Con el interruptor apagado, o si la sesión ve lo borrado: las filas, como siempre. Si no: la base vigente, como
-- una sola fila con `seq = to_seq`, si llega más allá de `p_after_seq`; sin base vigente, nada.
create or replace function public.pull_page_updates(p_page_id uuid, p_after_seq bigint, p_limit int default 200)
returns table (seq bigint, update text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  b public.page_clean_bases;
begin
  if not private.can_view_page(p_page_id) then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  if private.clean_min_version() is null or private.sees_deleted(p_page_id) then
    return query
      select u.seq, translate(encode(u.update, 'base64'), E'\n', '')
      from public.page_updates u
      where u.page_id = p_page_id and u.seq > p_after_seq
      order by u.seq
      limit least(greatest(p_limit, 1), 1000);
    return;
  end if;
  b := private.current_clean_base(p_page_id);
  if b.page_id is not null and b.to_seq > coalesce(p_after_seq, 0) then
    return query select b.to_seq, translate(encode(b.state, 'base64'), E'\n', '');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 5. Armar: qué páginas y subir una base
-- ---------------------------------------------------------------------------------------------------
-- Las páginas que esta sesión puede armar ahora (como mucho 50; la app arma hasta 20 por vuelta). Solo con el
-- interruptor prendido y una versión que alcanza, y solo páginas con algún lector (`has_plain_readers`) que la sesión
-- ve con lo borrado. Una página entra si no tiene base vigente (la primera, después de compartir o de restaurar) o si
-- tiene filas después de la base y: la última tiene más de 20 s × f (se dejó de escribir) o la base tiene más de
-- 2 minutos × f (se sigue escribiendo), con f = max(1, tamaño de la base / 100 KB). `p_urgent` (la app pasa a
-- segundo plano, o se acaba de compartir) no espera. `p_pages` limita a esas páginas.
-- Primero se juntan las páginas que alcanza algún permiso de lector (cero si no hay ninguno: lo de todos los días
-- mientras nadie comparte con Ver, Comentar o un invitado) y después se mira cada una.
create function public.clean_work(p_app_version text, p_pages uuid[] default null, p_urgent boolean default false)
returns table (page_id uuid, update_seq bigint, last_update_id bigint, clean_seq bigint, base_bytes int)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if private.workspace_role() is null or not private.clean_version_allowed(p_app_version) then
    return;
  end if;
  return query
    with recursive reader_grants as (
      select g.project_id, g.page_id
      from public.grants g
      join public.members m on m.user_id = g.user_id and m.removed_at is null
      where g.revoked_at is null and (g.level in ('view', 'comment') or m.role = 'guest')
    ),
    sub (id, depth) as (
      select rg.page_id, 0 from reader_grants rg where rg.page_id is not null
      union all
      select pg.id, s.depth + 1
      from public.pages pg
      join sub s on pg.parent_id = s.id
      where s.depth < 10000
    ),
    reach as (
      select pg.id from public.pages pg
      where pg.workspace_id in (select rg.project_id from reader_grants rg where rg.project_id is not null)
      union
      select s.id from sub s
    ),
    cand as (
      select pg.id, pg.update_seq, pg.clean_seq, pg.clean_at, u.id as last_id, u.created_at as last_at,
             cb.page_id is not null as has_base, coalesce(octet_length(b.state), 0) as bytes
      from public.pages pg
      join reach r on r.id = pg.id
      join public.page_updates u on u.page_id = pg.id and u.seq = pg.update_seq
      left join lateral (select (private.current_clean_base(pg.id)).page_id) cb (page_id) on true
      left join public.page_clean_bases b on b.page_id = pg.id
      where pg.update_seq > 0
        and (p_pages is null or pg.id = any (p_pages))
        and (cb.page_id is null or pg.update_seq > pg.clean_seq)
    ),
    due as (
      select c.*
      from cand c
      where not c.has_base
         or coalesce(p_urgent, false)
         or c.last_at < now() - make_interval(secs => 20 * greatest(1, c.bytes / 102400.0))
         or c.clean_at is null
         or c.clean_at < now() - make_interval(secs => 120 * greatest(1, c.bytes / 102400.0))
      order by c.has_base, c.clean_at nulls first, c.id
      limit 200
    )
    select d.id, d.update_seq, d.last_id, d.clean_seq, d.bytes::int
    from due d
    where private.sees_deleted(d.id) and private.has_plain_readers(d.id)
    order by d.has_base, d.clean_at nulls first, d.id
    limit 50;
end;
$$;

-- Sube una base (el update de Yjs en base64 y su SHA-256 en hexadecimal). Devuelve 'ok' (guardada, o el mismo id ya
-- guardado), 'clean_old' (no es más nueva que la vigente: no hace nada; dos editores que arman a la vez no se pisan)
-- o 'clean_stale' (anterior al último reinicio: una vista atrasada, o un reintento de una base de antes de compartir).
-- Errores: `page_not_found` (P0002), `not_allowed` (42501, no ve lo borrado), `clean_off` (P0001, interruptor
-- apagado), `app_outdated` (P0001), `clean_invalid` y `state_size_invalid` y `sha256_mismatch` (22023),
-- `clean_row_mismatch` (P0001: `to_seq` fuera de rango o su fila con otro id).
create function public.push_clean_base(
  p_id uuid, p_page_id uuid, p_to_seq bigint, p_last_update_id bigint, p_state text, p_sha256 text,
  p_app_version text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  pg_row record;
  cur    public.page_clean_bases;
  bin    bytea;
  hash   bytea;
begin
  if p_id is null or p_page_id is null or p_to_seq is null or p_last_update_id is null or p_state is null
     or p_sha256 is null then
    raise exception 'clean_invalid' using errcode = '22023';
  end if;
  if not private.can_view_page(p_page_id) then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  if not private.sees_deleted(p_page_id) then
    raise exception 'not_allowed' using errcode = '42501',
      hint = 'Only someone who can edit the page and is not a guest prepares it for the others.';
  end if;
  if private.clean_min_version() is null then
    raise exception 'clean_off' using errcode = 'P0001';
  end if;
  if not private.clean_version_allowed(p_app_version) then
    raise exception 'app_outdated' using errcode = 'P0001',
      hint = 'This version of the app is too old for this workspace. Reload the app to update it.';
  end if;

  -- Como push_page_update: con la fila de la página bloqueada, una subida y una base no se cruzan.
  select pg.update_seq, pg.clean_seq, pg.clean_reset_seq into pg_row
  from public.pages pg where pg.id = p_page_id for update;

  if exists (select 1 from public.page_clean_bases b where b.page_id = p_page_id and b.id = p_id) then
    return 'ok';
  end if;

  begin
    bin := decode(p_state, 'base64');
    hash := decode(p_sha256, 'hex');
  exception when others then
    raise exception 'clean_invalid' using errcode = '22023';
  end;
  if octet_length(bin) = 0 or octet_length(bin) > 8 * 1024 * 1024 then
    raise exception 'state_size_invalid' using errcode = '22023';
  end if;
  if hash is distinct from extensions.digest(bin, 'sha256') then
    raise exception 'sha256_mismatch' using errcode = '22023';
  end if;
  if p_to_seq < 1 or p_to_seq > pg_row.update_seq or not exists (
       select 1 from public.page_updates u
       where u.page_id = p_page_id and u.seq = p_to_seq and u.id = p_last_update_id) then
    raise exception 'clean_row_mismatch' using errcode = 'P0001';
  end if;
  if p_to_seq < pg_row.clean_reset_seq then
    return 'clean_stale';
  end if;
  cur := private.current_clean_base(p_page_id);
  if cur.page_id is not null and p_to_seq <= cur.to_seq then
    -- La vigente sigue sirviendo: `clean_seq` la nombra (un reinicio con una base que ya llegaba hasta ahí la dejó
    -- en 0; ver `clean_reset`).
    if pg_row.clean_seq <> cur.to_seq then
      update public.pages set clean_seq = cur.to_seq where id = p_page_id;
    end if;
    return 'clean_old';
  end if;

  insert into public.page_clean_bases (page_id, id, to_seq, last_update_id, state, sha256, app_version, created_by)
  values (p_page_id, p_id, p_to_seq, p_last_update_id, bin, hash, p_app_version::numeric, auth.uid())
  on conflict (page_id) do update
    set id = excluded.id, to_seq = excluded.to_seq, last_update_id = excluded.last_update_id,
        state = excluded.state, sha256 = excluded.sha256, app_version = excluded.app_version,
        created_by = excluded.created_by, created_at = now();
  update public.pages set clean_seq = p_to_seq, clean_at = now() where id = p_page_id;
  return 'ok';
end;
$$;

revoke all on function public.clean_work(text, uuid[], boolean) from public, anon;
revoke all on function public.push_clean_base(uuid, uuid, bigint, bigint, text, text, text) from public, anon;
grant execute on function public.clean_work(text, uuid[], boolean) to authenticated;
grant execute on function public.push_clean_base(uuid, uuid, bigint, bigint, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 6. Compartir con alguien que no ve lo borrado reinicia lo alcanzado
-- ---------------------------------------------------------------------------------------------------
-- El proyecto entero, o la página y su rama: `clean_reset_seq = update_seq`. `clean_seq` queda en 0 salvo que la base
-- vigente ya llegue hasta `update_seq` (sigue valiendo: es la página tal como se comparte).
create function private.clean_reset(p_project uuid, p_page uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_project is not null then
    update public.pages
    set clean_reset_seq = update_seq, clean_seq = case when clean_seq >= update_seq then clean_seq else 0 end
    where workspace_id = p_project;
  elsif p_page is not null then
    with recursive sub (id, depth) as (
      select p_page, 0
      union all
      select pg.id, s.depth + 1
      from public.pages pg
      join sub s on pg.parent_id = s.id
      where s.depth < 10000
    )
    update public.pages
    set clean_reset_seq = update_seq, clean_seq = case when clean_seq >= update_seq then clean_seq else 0 end
    where id in (select s.id from sub s);
  end if;
end;
$$;

revoke all on function private.clean_reset(uuid, uuid) from public, anon, authenticated;

-- `share` como en la migración del equipo, más el reinicio con Ver, Comentar o un invitado. Misma firma: conserva
-- sus permisos.
create or replace function public.share(p_user uuid, p_project uuid, p_page uuid, p_level text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  gid uuid;
begin
  if (p_project is null) = (p_page is null) then
    raise exception 'target_invalid' using errcode = '22023';
  end if;
  if p_level is null or p_level not in ('view', 'comment', 'edit', 'edit_pages') then
    raise exception 'level_invalid' using errcode = '22023';
  end if;
  if not private.can_share(p_project, p_page) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if private.workspace_role(p_user) is null then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;

  if p_project is not null then
    insert into public.grants (user_id, project_id, level, granted_by)
    values (p_user, p_project, p_level, auth.uid())
    on conflict (user_id, project_id) where project_id is not null
    do update set level = excluded.level, granted_by = excluded.granted_by, revoked_at = null, revoked_by = null
    returning id into gid;
  else
    insert into public.grants (user_id, page_id, level, granted_by)
    values (p_user, p_page, p_level, auth.uid())
    on conflict (user_id, page_id) where page_id is not null
    do update set level = excluded.level, granted_by = excluded.granted_by, revoked_at = null, revoked_by = null
    returning id into gid;
  end if;
  if p_level in ('view', 'comment') or private.workspace_role(p_user) = 'guest' then
    perform private.clean_reset(p_project, p_page);
  end if;
  return gid;
end;
$$;

-- `create_invitation` como en la migración del equipo, más el reinicio de lo que comparte con Ver, Comentar o a un
-- invitado: al invitar, no al aceptar (sección 4.2 del doc). Misma firma: conserva sus permisos.
create or replace function public.create_invitation(p_email text, p_role text, p_grants jsonb default '[]'::jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid     uuid := auth.uid();
  my_role text := private.workspace_role();
  em      text := lower(btrim(p_email));
  g       jsonb := coalesce(p_grants, '[]'::jsonb);
  el      jsonb;
  cur     public.invitations;
  new_id  uuid;
begin
  if my_role is null or my_role not in ('owner', 'admin') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('guest', 'member', 'admin') then
    raise exception 'role_invalid' using errcode = '22023';
  end if;
  if p_role = 'admin' and my_role <> 'owner' then
    raise exception 'not_allowed' using errcode = '42501', hint = 'Only the owner of the workspace invites admins.';
  end if;
  if em is null or em !~ '^[^@[:space:]]+@[^@[:space:]]+$' or length(em) > 320 then
    raise exception 'email_invalid' using errcode = '22023';
  end if;
  if not private.invitation_grants_valid(g) then
    raise exception 'grants_invalid' using errcode = '22023';
  end if;
  for el in select * from jsonb_array_elements(g) loop
    if (el ? 'project_id' and private.project_level((el ->> 'project_id')::uuid) < 4)
       or (el ? 'page_id' and private.page_level((el ->> 'page_id')::uuid) < 4) then
      raise exception 'grant_not_allowed' using errcode = '42501',
        hint = 'You can only share what you can edit and create pages in.';
    end if;
  end loop;

  -- Lo que va a ver sin ver lo borrado empieza de una base nueva (ya se validó arriba que quien invita tiene 4 ahí).
  for el in select * from jsonb_array_elements(g) loop
    if p_role = 'guest' or el ->> 'level' in ('view', 'comment') then
      perform private.clean_reset((el ->> 'project_id')::uuid, (el ->> 'page_id')::uuid);
    end if;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended('invitation:' || em, 0));
  select * into cur from private.live_invitations(em) i order by i.created_at, i.id limit 1;
  if found then
    if cur.invited_by is distinct from uid then
      raise exception 'invitation_exists' using errcode = 'P0001',
        hint = 'Someone else already invited this email. They can add to their invitation, or revoke it.';
    end if;
    update public.invitations
    set role = case when private.role_rank(p_role) > private.role_rank(cur.role) then p_role else cur.role end,
        grants = private.merge_invitation_grants(cur.grants, g),
        expires_at = now() + interval '30 days'
    where id = cur.id;
    return cur.id;
  end if;

  insert into public.invitations (email, role, grants, invited_by)
  values (em, p_role, private.merge_invitation_grants(g, '[]'::jsonb), uid)
  returning id into new_id;
  return new_id;
end;
$$;

-- Mover una página (cambiar su padre) adentro de una rama con lectores reinicia la página y su rama. Corre después
-- de los permisos y de la comprobación del árbol, para cualquiera que mueva (la app, la consola). Su propia
-- actualización no nombra `parent_id`: no se vuelve a disparar.
create function private.pages_clean_move()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if private.has_plain_readers(new.id) then
    perform private.clean_reset(null, new.id);
  end if;
  return null;
end;
$$;

revoke all on function private.pages_clean_move() from public, anon, authenticated;

create trigger pages_clean_move
after update of parent_id on public.pages
for each row
when (old.parent_id is distinct from new.parent_id)
execute function private.pages_clean_move();

-- ---------------------------------------------------------------------------------------------------
-- 7. Fotos y archivos: un uso sacado no cuenta para quien no ve lo borrado de esa página
-- ---------------------------------------------------------------------------------------------------
-- Como en 20261001120000_proyectos_archivar_borrar.sql, con la condición del uso sacado. Quien lo creó lo sigue
-- viendo (es suyo). Quien ve lo borrado, sí (restaurar del historial vuelve a usar la foto).
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
        where pf.file_id = p_file and not pf.is_foreign and private.can_view_page(pf.page_id)
          and (pf.removed_at is null or private.sees_deleted(pf.page_id)));
$$;

-- Como en 20260930180000_papelera_archivos.sql, con la misma condición. De acá salen la política de `thumbs`, la de
-- `page_files` de otro proyecto y `media_file` (lo que pregunta el portero).
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
  where pf.file_id = p_file and not pf.is_foreign
    and (pf.removed_at is null or private.sees_deleted(pf.page_id));
  if lvl < 3 and f.created_by = auth.uid() and private.can_edit_some_page(f.project_id) then
    lvl := 3;
  end if;
  return lvl;
end;
$$;

-- Los usos sacados no se listan a quien no ve lo borrado de la página.
drop policy page_files_select on public.page_files;
create policy page_files_select on public.page_files
  for select to authenticated
  using (private.can_view_page(page_id)
         and (not is_foreign or private.file_level(file_id) >= 1)
         and (removed_at is null or private.sees_deleted(page_id)));

-- La papelera de archivos (nombre, tipo y peso de lo que ninguna página usa) no es para invitados, aunque tengan
-- "Editar y crear páginas" sobre todo el proyecto: son los nombres de lo sacado.
create or replace function private.can_see_file_trash(ws uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select not private.history_denied_for_guest()
     and (private.project_level(ws) >= 4
          or (coalesce(private.workspace_role() in ('owner', 'admin'), false) and private.project_level(ws) >= 1));
$$;

-- ---------------------------------------------------------------------------------------------------
-- 8. Versión de la base: la app pide `pages.clean_seq` desde la 12
-- ---------------------------------------------------------------------------------------------------
update public.workspace_settings set schema_version = 12 where id and schema_version < 12;

notify pgrst, 'reload schema';
