-- LGA Shot Docs · El equipo de un vendor y sus artistas (Docs/Doc_Compartir_Escenas.md, sección 12, D854).
--
-- Hasta la versión 31, los vendors los manejaba solo el proyecto (dueño, admin, o quien tiene *Can share scenes*). Ahora:
--
-- - **El equipo del vendor** son los correos del vendor. Cada uno ve todas las escenas del vendor (como antes) y, en el
--   menú del proyecto, tiene dos cosas nuevas: **sumar correos al equipo** (*Share all scenes…*) y **repartir las escenas
--   del vendor entre sus artistas** (*Share scenes with artists…*). Lo que suma el equipo queda marcado
--   (`scene_vendor_emails.by_team`): el equipo solo saca lo que sumó el equipo (lo que sumó el proyecto, nunca; D854 (1)).
-- - **Los artistas** son vendors hijos (`scene_vendors.parent_id`), en la misma tabla: nombre, código, color, nivel (nunca
--   más que el del vendor), correos y escenas (solo de las del vendor). Así reusan todo lo de los vendors: un correo en un
--   solo lugar vivo del proyecto (vendor o artista), el acceso que se arma solo (`vendor_sync_email`), las invitaciones de
--   vendor, la marca del árbol y el freno de movimientos. Un artista no comparte nada: no tiene artistas ni equipo.
-- - **El proyecto manda sobre todo:** ve a los artistas de cada vendor (`scene_vendors_list`), puede sacarles correos o
--   borrarlos, y lo que le hace a un vendor arrastra a sus artistas: **sacarle una escena se la saca a sus artistas,
--   bajarlo a Ver los baja a Ver, y borrarlo los borra**.
-- - **El equipo nunca ve los otros vendors:** sus funciones (`vendor_team_get`, `save_vendor_team`) devuelven solo su
--   vendor y sus artistas; si un correo ya está en otro lado del proyecto, el error no dice dónde.
-- - El menú sabe quién es del equipo por una columna calculada de `workspaces` (`vendor_team`), que viene con la lista
--   de proyectos.
--
-- Compatible con las versiones publicadas: la ventana de vendors de la 0.331 a la 0.333 sigue andando (no ve a los
-- artistas, y lo que hace sobre un vendor los arrastra igual). Sube `schema_version` a 32.

-- ---------------------------------------------------------------------------------------------------
-- 0. Las columnas
-- ---------------------------------------------------------------------------------------------------
alter table public.scene_vendors
  add column parent_id uuid references public.scene_vendors (id) on delete cascade,
  add constraint scene_vendors_not_own_parent check (parent_id is distinct from id);
create index scene_vendors_parent_idx on public.scene_vendors (parent_id) where parent_id is not null;

-- Lo sumó el equipo del vendor (y no el proyecto): el equipo solo puede sacar estos.
alter table public.scene_vendor_emails
  add column by_team boolean not null default false;

-- ---------------------------------------------------------------------------------------------------
-- 1. Las piezas de adentro
-- ---------------------------------------------------------------------------------------------------
-- El vendor (sin padre, vivo, de un proyecto vivo) cuyo equipo integra la sesión: su correo confirmado está en él. Pide
-- una sesión permitida y un miembro activo (`workspace_role()`). `null`: no es del equipo de ningún vendor del proyecto.
create function private.vendor_team_of(p_project uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select v.id
  from public.scene_vendors v
  join public.scene_vendor_emails e on e.vendor_id = v.id
  join auth.users u on u.id = (select auth.uid()) and u.email_confirmed_at is not null and lower(u.email::text) = e.email
  join public.workspaces w on w.id = v.project_id and w.deleted_at is null
  where p_project is not null and v.project_id = p_project and v.parent_id is null and v.deleted_at is null
    and private.workspace_role() is not null
  order by v.created_at, v.id
  limit 1;
$$;

-- Los correos de un vendor (o artista), con su estado: `joined` (miembro activo), `invited` (invitación viva de este
-- vendor) o `expired`; `by_team`: lo sumó el equipo.
create function private.vendor_emails_json(p_vendor uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'email', e.email,
           'by_team', e.by_team,
           'state', case
                      when exists (select 1 from auth.users u
                                   where lower(u.email::text) = e.email and private.workspace_role(u.id) is not null) then 'joined'
                      when exists (select 1 from public.invitations i
                                   where i.vendor_id = p_vendor and i.email = e.email and private.invitation_live(i)) then 'invited'
                      else 'expired'
                    end)
         order by e.added_at, e.email), '[]'::jsonb)
  from public.scene_vendor_emails e where e.vendor_id = p_vendor;
$$;

-- Las escenas de un vendor (o artista): `alive` falso si está en la papelera; `ok` falso si hoy no se le puede dar.
create function private.vendor_scenes_json(p_vendor uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('page_id', s.page_id, 'alive', private.page_alive(s.page_id),
                                               'ok', private.vendor_scene_ok(s.page_id))
                            order by s.page_id), '[]'::jsonb)
  from public.scene_vendor_scenes s where s.vendor_id = p_vendor;
$$;

-- Los artistas vivos de un vendor, cada uno con sus correos y escenas.
create function private.vendor_artists_json(p_vendor uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'name', a.name, 'code', a.code, 'color', a.color, 'level', a.level, 'created_at', a.created_at,
           'emails', private.vendor_emails_json(a.id),
           'scenes', private.vendor_scenes_json(a.id))
         order by a.created_at, a.id), '[]'::jsonb)
  from public.scene_vendors a where a.parent_id = p_vendor and a.deleted_at is null;
$$;

-- Lo que un cambio sobre un vendor le hace a sus artistas, antes de sincronizar: les saca las escenas que el vendor ya no
-- tiene, los baja a su nivel (si el vendor quedó en Ver) y, si el vendor está borrado, los borra. Devuelve los correos
-- de los artistas que cambiaron (para `vendor_sync_email`).
create function private.vendor_artists_follow(p_vendor uuid, p_actor uuid)
returns text[]
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_parent public.scene_vendors;
  v_ids    uuid[];
  v_out    text[];
begin
  select * into v_parent from public.scene_vendors x where x.id = p_vendor;
  if not found or v_parent.parent_id is not null then
    return '{}';
  end if;
  if v_parent.deleted_at is not null then
    update public.scene_vendors a set deleted_at = coalesce(v_parent.deleted_at, now()), deleted_by = p_actor
    where a.parent_id = p_vendor and a.deleted_at is null;
    select coalesce(array_agg(a.id), '{}') into v_ids from public.scene_vendors a where a.parent_id = p_vendor;
  else
    with gone as (
      delete from public.scene_vendor_scenes s
      using public.scene_vendors a
      where a.id = s.vendor_id and a.parent_id = p_vendor and a.deleted_at is null
        and not exists (select 1 from public.scene_vendor_scenes ps where ps.vendor_id = p_vendor and ps.page_id = s.page_id)
      returning s.vendor_id
    ), lowered as (
      update public.scene_vendors a set level = v_parent.level
      where a.parent_id = p_vendor and a.deleted_at is null
        and private.grant_level_value(a.level) > private.grant_level_value(v_parent.level)
      returning a.id
    )
    select coalesce(array_agg(distinct x), '{}') into v_ids
    from (select vendor_id as x from gone union all select id from lowered) t;
  end if;
  select coalesce(array_agg(distinct e.email), '{}') into v_out
  from public.scene_vendor_emails e where e.vendor_id = any (v_ids);
  return v_out;
end;
$$;

revoke all on function private.vendor_team_of(uuid) from public, anon, authenticated;
revoke all on function private.vendor_emails_json(uuid) from public, anon, authenticated;
revoke all on function private.vendor_scenes_json(uuid) from public, anon, authenticated;
revoke all on function private.vendor_artists_json(uuid) from public, anon, authenticated;
revoke all on function private.vendor_artists_follow(uuid, uuid) from public, anon, authenticated;

-- La columna calculada de la lista de proyectos: ¿la sesión es del equipo de un vendor de este proyecto? PostgREST la
-- trae con `select=…,vendor_team`.
create function public.vendor_team(w public.workspaces)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.vendor_team_of(w.id) is not null;
$$;

revoke all on function public.vendor_team(public.workspaces) from public, anon;
grant execute on function public.vendor_team(public.workspaces) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 2. Los vendors de un proyecto, para el proyecto: ahora con sus artistas
-- ---------------------------------------------------------------------------------------------------
-- Como en 20261121120000_vendors.sql, más: solo los vendors (sin padre), cada uno con `artists`, y cada correo con
-- `by_team`.
create or replace function public.scene_vendors_list(p_project uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_cap int := private.vendor_cap(p_project);
begin
  if v_cap = 0 then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'cap', v_cap,
    'admin', coalesce(private.workspace_role() in ('owner', 'admin') and private.can_share(p_project, null), false),
    'vendors', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', v.id, 'name', v.name, 'code', v.code, 'color', v.color, 'level', v.level,
               'created_at', v.created_at,
               'emails', private.vendor_emails_json(v.id),
               'scenes', private.vendor_scenes_json(v.id),
               'artists', private.vendor_artists_json(v.id))
             order by v.created_at, v.id)
      from public.scene_vendors v
      where v.project_id = p_project and v.parent_id is null and v.deleted_at is null), '[]'::jsonb),
    'others', coalesce((
      with direct (pid, who) as (
        select g.page_id, 'u:' || g.user_id::text
        from public.grants g
        join public.pages pg on pg.id = g.page_id
        join public.members m on m.user_id = g.user_id and m.removed_at is null
        where g.revoked_at is null and g.vendor_id is null and pg.workspace_id = p_project
          and (m.role = 'guest' or private.user_page_level(g.page_id, g.user_id) between 1 and 2)
        union
        select (el ->> 'page_id')::uuid, 'i:' || i.id::text
        from public.invitations i
        cross join lateral jsonb_array_elements(i.grants) el
        where i.vendor_id is null and private.invitation_live(i)
          and el ? 'page_id'
          and (i.role = 'guest' or el ->> 'level' in ('view', 'comment'))
          and exists (select 1 from public.pages pg
                      where pg.id = (el ->> 'page_id')::uuid and pg.workspace_id = p_project)
      )
      select jsonb_agg(jsonb_build_object('page_id', x.pid, 'readers', x.n) order by x.pid)
      from (select d.pid, count(distinct d.who)::int as n from direct d
            where private.page_alive(d.pid) group by d.pid) x), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 3. Guardar los vendors, para el proyecto: ahora arrastra a los artistas
-- ---------------------------------------------------------------------------------------------------
-- Como en 20261121120000_vendors.sql, con tres cambios:
-- - Sobre **un artista** (el id de un vendor hijo) el proyecto solo puede `delete` o `update` con `remove_emails`
--   (cualquier otra cosa: `ops_invalid`). `create` siempre crea un vendor (sin padre).
-- - Después de cada operación sobre **un vendor**, `vendor_artists_follow`: sacarle escenas o bajarle el nivel arrastra
--   a sus artistas, y borrarlo los borra. Sus correos se sincronizan.
-- - Un correo que suma el proyecto queda con `by_team` falso (el equipo no lo puede sacar).
create or replace function public.save_scene_vendors(p_project uuid, p_ops jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_cap     int := private.vendor_cap(p_project);
  v_admin   boolean;
  v_op      jsonb;
  v_kind    text;
  v_vendor  public.scene_vendors;
  v_keys    jsonb := '{}'::jsonb;
  v_seen    uuid[] := '{}';
  v_text    text;
  v_page    uuid;
  v_ws      uuid;
  v_pkind   text;
  v_settings jsonb;
  v_email   text;
  v_emails  text[] := '{}';
  v_added   uuid[];
  v_reset   uuid[] := '{}';
  v_scene_n int := 0;
  v_mail_n  int := 0;
  v_touch   boolean;
  v_more    boolean;
  v_dup     text;
  v_pending text[] := '{}';
  v_uuid    constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if v_uid is null or v_cap = 0 then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  v_admin := coalesce(private.workspace_role() in ('owner', 'admin') and private.can_share(p_project, null), false);
  if private.clean_min_version() is null then
    raise exception 'clean_off' using errcode = 'P0001',
      hint = 'Sharing scenes needs the workspace setting that keeps deleted text out of shared pages.';
  end if;
  if p_ops is null or jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) not between 1 and 100 then
    raise exception 'ops_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_ops) o
    cross join lateral (values ('add_scenes'), ('remove_scenes'), ('add_emails'), ('remove_emails'), ('reinvite')) k(list)
    where case
            when jsonb_typeof(o) <> 'object' then true
            when not (o ? k.list) then false
            when jsonb_typeof(o -> k.list) <> 'array' then true
            when exists (select 1 from jsonb_array_elements(o -> k.list) x where jsonb_typeof(x) <> 'string') then true
            when k.list like '%scenes' then exists (select 1 from jsonb_array_elements_text(o -> k.list) x where x !~ v_uuid)
            else false
          end) then
    raise exception 'ops_invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('vendors:' || p_project::text, 0));

  for v_op in select * from jsonb_array_elements(p_ops) loop
    v_kind := v_op ->> 'op';
    v_touch := false;
    v_added := '{}';

    if v_kind = 'create' then
      if (select count(*) from public.scene_vendors x
          where x.project_id = p_project and x.parent_id is null and x.deleted_at is null) >= 100 then
        raise exception 'too_many_vendors' using errcode = '22023', hint = 'Up to 100 vendors in a project.';
      end if;
      begin
        insert into public.scene_vendors (project_id, name, code, color, level, created_by)
        values (p_project, btrim(v_op ->> 'name'), coalesce(v_op ->> 'code', ''), v_op ->> 'color', v_op ->> 'level', v_uid)
        returning * into v_vendor;
      exception when check_violation or not_null_violation then
        raise exception 'vendor_invalid' using errcode = '22023';
      end;
      if private.grant_level_value(v_vendor.level) > v_cap then
        raise exception 'level_not_allowed' using errcode = '42501',
          hint = 'You can give vendors up to your own access to the project.';
      end if;
      if v_op ? 'key' then
        v_keys := v_keys || jsonb_build_object(v_op ->> 'key', v_vendor.id);
      end if;
    elsif v_kind in ('update', 'delete') then
      v_text := v_op ->> 'id';
      if v_text is null or v_text !~ v_uuid then
        raise exception 'ops_invalid' using errcode = '22023';
      end if;
      select * into v_vendor from public.scene_vendors x
      where x.id = v_text::uuid and x.project_id = p_project and x.deleted_at is null
      for update;
      if not found then
        raise exception 'vendor_not_found' using errcode = 'P0002';
      end if;
      if v_vendor.id = any (v_seen) then
        raise exception 'ops_invalid' using errcode = '22023';
      end if;
      -- Un artista: el proyecto solo lo borra o le saca correos.
      if v_vendor.parent_id is not null and v_kind = 'update'
         and exists (select 1 from jsonb_object_keys(v_op) k where k not in ('op', 'id', 'remove_emails')) then
        raise exception 'ops_invalid' using errcode = '22023';
      end if;
      if v_kind = 'delete' then
        update public.scene_vendors set deleted_at = now(), deleted_by = v_uid where id = v_vendor.id;
        select v_emails || coalesce(array_agg(e.email), '{}') into v_emails
        from public.scene_vendor_emails e where e.vendor_id = v_vendor.id;
        v_emails := v_emails || private.vendor_artists_follow(v_vendor.id, v_uid);
        v_seen := v_seen || v_vendor.id;
        continue;
      end if;
      begin
        update public.scene_vendors x
        set name = case when v_op ? 'name' then btrim(v_op ->> 'name') else x.name end,
            code = case when v_op ? 'code' then coalesce(v_op ->> 'code', '') else x.code end,
            color = case when v_op ? 'color' then v_op ->> 'color' else x.color end,
            level = case when v_op ? 'level' then v_op ->> 'level' else x.level end
        where x.id = v_vendor.id;
      exception when check_violation or not_null_violation then
        raise exception 'vendor_invalid' using errcode = '22023';
      end;
      if v_op ? 'level' and v_op ->> 'level' is distinct from v_vendor.level then
        if private.grant_level_value(v_op ->> 'level') > v_cap
           and private.grant_level_value(v_op ->> 'level') > private.grant_level_value(v_vendor.level) then
          raise exception 'level_not_allowed' using errcode = '42501',
            hint = 'You can give vendors up to your own access to the project.';
        end if;
        v_touch := true;
      end if;
      select * into v_vendor from public.scene_vendors x where x.id = v_vendor.id;
    else
      raise exception 'ops_invalid' using errcode = '22023';
    end if;
    v_seen := v_seen || v_vendor.id;

    v_more := jsonb_array_length(coalesce(v_op -> 'add_scenes', '[]')) > 0
           or jsonb_array_length(coalesce(v_op -> 'add_emails', '[]')) > 0
           or jsonb_array_length(coalesce(v_op -> 'reinvite', '[]')) > 0;
    if v_more and private.grant_level_value(v_vendor.level) > v_cap then
      raise exception 'level_not_allowed' using errcode = '42501',
        hint = 'You can give vendors up to your own access to the project.';
    end if;

    for v_page in select x::uuid from jsonb_array_elements_text(coalesce(v_op -> 'remove_scenes', '[]')) x loop
      delete from public.scene_vendor_scenes s where s.vendor_id = v_vendor.id and s.page_id = v_page;
      if not found then
        raise exception 'page_invalid' using errcode = '22023';
      end if;
      v_scene_n := v_scene_n + 1;
      v_touch := true;
    end loop;
    for v_page in select x::uuid from jsonb_array_elements_text(coalesce(v_op -> 'add_scenes', '[]')) x loop
      select pg.workspace_id, coalesce(pg.settings -> 'entity' ->> 'kind', ''), pg.settings
        into v_ws, v_pkind, v_settings
        from public.pages pg where pg.id = v_page;
      if not found or v_ws is distinct from p_project or not private.page_alive(v_page) or v_pkind <> 'scene'
         or not (case when v_admin then private.user_can_share_page(v_page, v_uid) else private.page_level(v_page) >= 1 end) then
        raise exception 'page_invalid' using errcode = '22023';
      end if;
      if private.folder_marked(v_settings) or private.branch_has_entities(v_page) then
        raise exception 'scene_contains_entities' using errcode = 'P0001',
          hint = 'A scene to share has another scene, a location, a day or a set inside.';
      end if;
      insert into public.scene_vendor_scenes (vendor_id, page_id, added_by) values (v_vendor.id, v_page, v_uid)
      on conflict do nothing;
      if not found then
        raise exception 'page_invalid' using errcode = '22023';
      end if;
      v_added := v_added || v_page;
      v_scene_n := v_scene_n + 1;
      v_touch := true;
    end loop;
    if v_scene_n > 1000 then
      raise exception 'too_many_pages' using errcode = '22023', hint = 'Up to 1000 scene changes at a time.';
    end if;

    for v_email in select lower(btrim(x)) from jsonb_array_elements_text(coalesce(v_op -> 'remove_emails', '[]')) x loop
      delete from public.scene_vendor_emails e where e.vendor_id = v_vendor.id and e.email = v_email;
      if not found then
        raise exception 'email_not_found' using errcode = 'P0002';
      end if;
      v_emails := v_emails || v_email;
      v_mail_n := v_mail_n + 1;
    end loop;
    for v_email in select lower(btrim(x)) from jsonb_array_elements_text(coalesce(v_op -> 'add_emails', '[]')) x loop
      if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' or length(v_email) > 320 then
        raise exception 'email_invalid' using errcode = '22023';
      end if;
      if not v_admin and exists (select 1 from auth.users u where u.id = v_uid and lower(u.email::text) = v_email) then
        raise exception 'own_email' using errcode = '42501', hint = 'You can''t add your own email to a vendor.';
      end if;
      insert into public.scene_vendor_emails (vendor_id, email, added_by) values (v_vendor.id, v_email, v_uid)
      on conflict do nothing;
      if not found then
        raise exception 'email_exists' using errcode = 'P0001', hint = v_email;
      end if;
      v_emails := v_emails || v_email;
      v_mail_n := v_mail_n + 1;
    end loop;
    for v_email in select lower(btrim(x)) from jsonb_array_elements_text(coalesce(v_op -> 'reinvite', '[]')) x loop
      if not exists (select 1 from public.scene_vendor_emails e where e.vendor_id = v_vendor.id and e.email = v_email) then
        raise exception 'email_not_found' using errcode = 'P0002';
      end if;
      v_emails := v_emails || v_email;
    end loop;
    if v_mail_n > 200 then
      raise exception 'too_many_emails' using errcode = '22023', hint = 'Up to 200 email changes at a time.';
    end if;
    if (select count(*) from public.scene_vendor_emails e where e.vendor_id = v_vendor.id) > 30 then
      raise exception 'too_many_emails' using errcode = '22023', hint = 'Up to 30 emails in a vendor.';
    end if;

    if v_touch then
      select v_emails || coalesce(array_agg(e.email), '{}') into v_emails
      from public.scene_vendor_emails e where e.vendor_id = v_vendor.id;
      -- Lo que cambió en el vendor arrastra a sus artistas (escenas que salieron, nivel que bajó).
      v_emails := v_emails || private.vendor_artists_follow(v_vendor.id, v_uid);
    end if;
    if cardinality(v_added) > 0
       and exists (select 1 from public.scene_vendor_emails e where e.vendor_id = v_vendor.id) then
      foreach v_page in array v_added loop
        perform private.clean_reset(null, v_page);
      end loop;
      v_reset := v_reset || v_added;
    end if;
  end loop;

  -- Un correo, un solo lugar vivo del proyecto (vendor o artista), después de todas las operaciones.
  select e.email into v_dup
  from public.scene_vendor_emails e
  join public.scene_vendors x on x.id = e.vendor_id
  where x.project_id = p_project and x.deleted_at is null
  group by e.email
  having count(*) > 1
  order by e.email
  limit 1;
  if v_dup is not null then
    raise exception 'email_in_other_vendor' using errcode = 'P0001', hint = v_dup;
  end if;

  for v_email in select distinct x from unnest(v_emails) x order by x loop
    v_reset := v_reset || private.vendor_sync_email(p_project, v_email, v_uid);
    if exists (select 1 from private.live_vendor_invitations(v_email) i
               join public.scene_vendors x on x.id = i.vendor_id where x.project_id = p_project) then
      v_pending := v_pending || v_email;
    end if;
  end loop;

  return jsonb_build_object(
    'keys', v_keys,
    'reset', coalesce((select jsonb_agg(distinct x) from unnest(v_reset) x), '[]'::jsonb),
    'pending', coalesce(to_jsonb(v_pending), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 4. Lo que ve el equipo de un vendor
-- ---------------------------------------------------------------------------------------------------
-- Solo su vendor y sus artistas, nunca los otros vendors. `me`: el correo de la sesión (en el equipo).
create function public.vendor_team_get(p_project uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_id uuid := private.vendor_team_of(p_project);
  v    public.scene_vendors;
begin
  if v_id is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select * into v from public.scene_vendors x where x.id = v_id;
  return jsonb_build_object(
    'me', (select lower(u.email::text) from auth.users u where u.id = (select auth.uid())),
    'vendor', jsonb_build_object(
      'id', v.id, 'name', v.name, 'code', v.code, 'color', v.color, 'level', v.level,
      'emails', private.vendor_emails_json(v.id),
      'scenes', private.vendor_scenes_json(v.id)),
    'artists', private.vendor_artists_json(v.id));
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 5. Guardar lo del equipo, todo o nada
-- ---------------------------------------------------------------------------------------------------
-- `p_ops`: una lista (hasta 100) de
--   {"op": "team", "add_emails", "remove_emails", "reinvite"}            el equipo de su vendor
--   {"op": "create", "key", "name", "code", "color", "level", "add_scenes", "add_emails"}   un artista
--   {"op": "update", "id", "name", "code", "color", "level", "add_scenes", "remove_scenes", "add_emails",
--    "remove_emails", "reinvite"}                                        un artista de su vendor
--   {"op": "delete", "id"}                                               un artista de su vendor
-- Reglas: quien guarda es del equipo de un vendor del proyecto (`not_allowed`); el interruptor de lo borrado
-- (`clean_off`); **el equipo solo saca correos que sumó el equipo** (`email_locked`) y nunca el propio (`own_email`);
-- un artista nunca tiene más nivel que el vendor (`level_not_allowed`) ni una escena que el vendor no tiene o que hoy no
-- se puede dar (`page_invalid`); topes (100 artistas por vendor, 30 correos por vendor o artista, 1000 cambios de
-- escenas y 200 de correos por guardado); **un correo en un solo lugar vivo del proyecto** (`email_in_use`, con el
-- correo en el `hint`: nunca dice en qué otro vendor está). Devuelve lo mismo que `save_scene_vendors`.
-- `p_vendor`: el vendor que la ventana tenía abierto; si la sesión ya no es de su equipo (la sacaron, la pasaron a otro
-- vendor o lo borraron mientras tanto), `vendor_changed`. De qué vendor es se mira **después** del candado del proyecto
-- (el mismo de `save_scene_vendors`): así un vendor que se borra al mismo tiempo no deja un artista vivo debajo.
create function public.save_vendor_team(p_project uuid, p_ops jsonb, p_vendor uuid default null)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_vid     uuid;
  v_parent  public.scene_vendors;
  v_me      text;
  v_op      jsonb;
  v_kind    text;
  v_art     public.scene_vendors;
  v_keys    jsonb := '{}'::jsonb;
  v_seen    uuid[] := '{}';
  v_text    text;
  v_page    uuid;
  v_email   text;
  v_emails  text[] := '{}';
  v_added   uuid[];
  v_reset   uuid[] := '{}';
  v_scene_n int := 0;
  v_mail_n  int := 0;
  v_touch   boolean;
  v_dup     text;
  v_pending text[] := '{}';
  v_uuid    constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if v_uid is null or private.vendor_team_of(p_project) is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if private.clean_min_version() is null then
    raise exception 'clean_off' using errcode = 'P0001',
      hint = 'Sharing scenes needs the workspace setting that keeps deleted text out of shared pages.';
  end if;
  if p_ops is null or jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) not between 1 and 100 then
    raise exception 'ops_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_ops) o
    cross join lateral (values ('add_scenes'), ('remove_scenes'), ('add_emails'), ('remove_emails'), ('reinvite')) k(list)
    where case
            when jsonb_typeof(o) <> 'object' then true
            when not (o ? k.list) then false
            when jsonb_typeof(o -> k.list) <> 'array' then true
            when exists (select 1 from jsonb_array_elements(o -> k.list) x where jsonb_typeof(x) <> 'string') then true
            when k.list like '%scenes' then exists (select 1 from jsonb_array_elements_text(o -> k.list) x where x !~ v_uuid)
            else false
          end) then
    raise exception 'ops_invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('vendors:' || p_project::text, 0));
  -- Ya con el candado: de qué vendor es la sesión ahora (vivo, sin padre), y que sea el que la ventana tenía abierto.
  v_vid := private.vendor_team_of(p_project);
  if v_vid is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_vendor is not null and p_vendor is distinct from v_vid then
    raise exception 'vendor_changed' using errcode = 'P0001', hint = 'You are on another vendor''s team now.';
  end if;
  select * into v_parent from public.scene_vendors x where x.id = v_vid and x.deleted_at is null for update;
  if not found then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select lower(u.email::text) into v_me from auth.users u where u.id = v_uid;

  for v_op in select * from jsonb_array_elements(p_ops) loop
    v_kind := v_op ->> 'op';
    v_touch := false;
    v_added := '{}';

    -- El equipo del vendor.
    if v_kind = 'team' then
      if exists (select 1 from jsonb_object_keys(v_op) k where k not in ('op', 'add_emails', 'remove_emails', 'reinvite')) then
        raise exception 'ops_invalid' using errcode = '22023';
      end if;
      for v_email in select lower(btrim(x)) from jsonb_array_elements_text(coalesce(v_op -> 'remove_emails', '[]')) x loop
        if v_email = v_me then
          raise exception 'own_email' using errcode = '42501', hint = 'You can''t remove yourself from the team.';
        end if;
        if exists (select 1 from public.scene_vendor_emails e
                   where e.vendor_id = v_vid and e.email = v_email and not e.by_team) then
          raise exception 'email_locked' using errcode = '42501', hint = 'Only the project can remove this email.';
        end if;
        delete from public.scene_vendor_emails e where e.vendor_id = v_vid and e.email = v_email;
        if not found then
          raise exception 'email_not_found' using errcode = 'P0002';
        end if;
        v_emails := v_emails || v_email;
        v_mail_n := v_mail_n + 1;
      end loop;
      for v_email in select lower(btrim(x)) from jsonb_array_elements_text(coalesce(v_op -> 'add_emails', '[]')) x loop
        if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' or length(v_email) > 320 then
          raise exception 'email_invalid' using errcode = '22023';
        end if;
        insert into public.scene_vendor_emails (vendor_id, email, added_by, by_team) values (v_vid, v_email, v_uid, true)
        on conflict do nothing;
        if not found then
          raise exception 'email_exists' using errcode = 'P0001', hint = v_email;
        end if;
        v_emails := v_emails || v_email;
        v_mail_n := v_mail_n + 1;
      end loop;
      for v_email in select lower(btrim(x)) from jsonb_array_elements_text(coalesce(v_op -> 'reinvite', '[]')) x loop
        if not exists (select 1 from public.scene_vendor_emails e where e.vendor_id = v_vid and e.email = v_email) then
          raise exception 'email_not_found' using errcode = 'P0002';
        end if;
        v_emails := v_emails || v_email;
      end loop;
      if (select count(*) from public.scene_vendor_emails e where e.vendor_id = v_vid) > 30 then
        raise exception 'too_many_emails' using errcode = '22023', hint = 'Up to 30 emails in a vendor.';
      end if;
      if v_mail_n > 200 then
        raise exception 'too_many_emails' using errcode = '22023', hint = 'Up to 200 email changes at a time.';
      end if;
      continue;
    end if;

    -- Un artista.
    if v_kind = 'create' then
      if (select count(*) from public.scene_vendors x where x.parent_id = v_vid and x.deleted_at is null) >= 100 then
        raise exception 'too_many_vendors' using errcode = '22023', hint = 'Up to 100 artists in a vendor.';
      end if;
      begin
        insert into public.scene_vendors (project_id, parent_id, name, code, color, level, created_by)
        values (p_project, v_vid, btrim(v_op ->> 'name'), coalesce(v_op ->> 'code', ''), v_op ->> 'color', v_op ->> 'level', v_uid)
        returning * into v_art;
      exception when check_violation or not_null_violation then
        raise exception 'vendor_invalid' using errcode = '22023';
      end;
      if v_op ? 'key' then
        v_keys := v_keys || jsonb_build_object(v_op ->> 'key', v_art.id);
      end if;
    elsif v_kind in ('update', 'delete') then
      v_text := v_op ->> 'id';
      if v_text is null or v_text !~ v_uuid then
        raise exception 'ops_invalid' using errcode = '22023';
      end if;
      select * into v_art from public.scene_vendors x
      where x.id = v_text::uuid and x.parent_id = v_vid and x.deleted_at is null
      for update;
      if not found then
        raise exception 'vendor_not_found' using errcode = 'P0002';
      end if;
      if v_art.id = any (v_seen) then
        raise exception 'ops_invalid' using errcode = '22023';
      end if;
      if v_kind = 'delete' then
        update public.scene_vendors set deleted_at = now(), deleted_by = v_uid where id = v_art.id;
        select v_emails || coalesce(array_agg(e.email), '{}') into v_emails
        from public.scene_vendor_emails e where e.vendor_id = v_art.id;
        v_seen := v_seen || v_art.id;
        continue;
      end if;
      begin
        update public.scene_vendors x
        set name = case when v_op ? 'name' then btrim(v_op ->> 'name') else x.name end,
            code = case when v_op ? 'code' then coalesce(v_op ->> 'code', '') else x.code end,
            color = case when v_op ? 'color' then v_op ->> 'color' else x.color end,
            level = case when v_op ? 'level' then v_op ->> 'level' else x.level end
        where x.id = v_art.id;
      exception when check_violation or not_null_violation then
        raise exception 'vendor_invalid' using errcode = '22023';
      end;
      if v_op ? 'level' and v_op ->> 'level' is distinct from v_art.level then
        v_touch := true;
      end if;
      select * into v_art from public.scene_vendors x where x.id = v_art.id;
    else
      raise exception 'ops_invalid' using errcode = '22023';
    end if;
    v_seen := v_seen || v_art.id;

    -- Nunca más que el vendor.
    if private.grant_level_value(v_art.level) > private.grant_level_value(v_parent.level) then
      raise exception 'level_not_allowed' using errcode = '42501',
        hint = 'An artist can''t have more access than their vendor.';
    end if;

    for v_page in select x::uuid from jsonb_array_elements_text(coalesce(v_op -> 'remove_scenes', '[]')) x loop
      delete from public.scene_vendor_scenes s where s.vendor_id = v_art.id and s.page_id = v_page;
      if not found then
        raise exception 'page_invalid' using errcode = '22023';
      end if;
      v_scene_n := v_scene_n + 1;
      v_touch := true;
    end loop;
    -- Solo escenas del vendor que hoy se le pueden dar; una sola respuesta que no dice cuál.
    for v_page in select x::uuid from jsonb_array_elements_text(coalesce(v_op -> 'add_scenes', '[]')) x loop
      if not exists (select 1 from public.scene_vendor_scenes s where s.vendor_id = v_vid and s.page_id = v_page)
         or not private.vendor_scene_ok(v_page) then
        raise exception 'page_invalid' using errcode = '22023';
      end if;
      insert into public.scene_vendor_scenes (vendor_id, page_id, added_by) values (v_art.id, v_page, v_uid)
      on conflict do nothing;
      if not found then
        raise exception 'page_invalid' using errcode = '22023';
      end if;
      v_added := v_added || v_page;
      v_scene_n := v_scene_n + 1;
      v_touch := true;
    end loop;
    if v_scene_n > 1000 then
      raise exception 'too_many_pages' using errcode = '22023', hint = 'Up to 1000 scene changes at a time.';
    end if;

    for v_email in select lower(btrim(x)) from jsonb_array_elements_text(coalesce(v_op -> 'remove_emails', '[]')) x loop
      delete from public.scene_vendor_emails e where e.vendor_id = v_art.id and e.email = v_email;
      if not found then
        raise exception 'email_not_found' using errcode = 'P0002';
      end if;
      v_emails := v_emails || v_email;
      v_mail_n := v_mail_n + 1;
    end loop;
    for v_email in select lower(btrim(x)) from jsonb_array_elements_text(coalesce(v_op -> 'add_emails', '[]')) x loop
      if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' or length(v_email) > 320 then
        raise exception 'email_invalid' using errcode = '22023';
      end if;
      if v_email = v_me then
        raise exception 'own_email' using errcode = '42501', hint = 'You can''t add your own email to an artist.';
      end if;
      insert into public.scene_vendor_emails (vendor_id, email, added_by, by_team) values (v_art.id, v_email, v_uid, true)
      on conflict do nothing;
      if not found then
        raise exception 'email_exists' using errcode = 'P0001', hint = v_email;
      end if;
      v_emails := v_emails || v_email;
      v_mail_n := v_mail_n + 1;
    end loop;
    for v_email in select lower(btrim(x)) from jsonb_array_elements_text(coalesce(v_op -> 'reinvite', '[]')) x loop
      if not exists (select 1 from public.scene_vendor_emails e where e.vendor_id = v_art.id and e.email = v_email) then
        raise exception 'email_not_found' using errcode = 'P0002';
      end if;
      v_emails := v_emails || v_email;
    end loop;
    if v_mail_n > 200 then
      raise exception 'too_many_emails' using errcode = '22023', hint = 'Up to 200 email changes at a time.';
    end if;
    if (select count(*) from public.scene_vendor_emails e where e.vendor_id = v_art.id) > 30 then
      raise exception 'too_many_emails' using errcode = '22023', hint = 'Up to 30 emails in an artist.';
    end if;

    if v_touch then
      select v_emails || coalesce(array_agg(e.email), '{}') into v_emails
      from public.scene_vendor_emails e where e.vendor_id = v_art.id;
    end if;
    if cardinality(v_added) > 0
       and exists (select 1 from public.scene_vendor_emails e where e.vendor_id = v_art.id) then
      foreach v_page in array v_added loop
        perform private.clean_reset(null, v_page);
      end loop;
      v_reset := v_reset || v_added;
    end if;
  end loop;

  -- Un correo, un solo lugar vivo del proyecto. El error no dice dónde está el otro.
  select e.email into v_dup
  from public.scene_vendor_emails e
  join public.scene_vendors x on x.id = e.vendor_id
  where x.project_id = p_project and x.deleted_at is null
  group by e.email
  having count(*) > 1
  order by e.email
  limit 1;
  if v_dup is not null then
    raise exception 'email_in_use' using errcode = 'P0001', hint = v_dup;
  end if;

  for v_email in select distinct x from unnest(v_emails) x order by x loop
    v_reset := v_reset || private.vendor_sync_email(p_project, v_email, v_uid);
    if exists (select 1 from private.live_vendor_invitations(v_email) i
               join public.scene_vendors x on x.id = i.vendor_id where x.project_id = p_project) then
      v_pending := v_pending || v_email;
    end if;
  end loop;

  return jsonb_build_object(
    'keys', v_keys,
    'reset', coalesce((select jsonb_agg(distinct x) from unnest(v_reset) x), '[]'::jsonb),
    'pending', coalesce(to_jsonb(v_pending), '[]'::jsonb));
end;
$$;

revoke all on function public.vendor_team_get(uuid) from public, anon;
revoke all on function public.save_vendor_team(uuid, jsonb, uuid) from public, anon;
grant execute on function public.vendor_team_get(uuid) to authenticated;
grant execute on function public.save_vendor_team(uuid, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 6. Versión de la base: la app ofrece el equipo del vendor y los artistas desde la 32.
-- ---------------------------------------------------------------------------------------------------
update public.workspace_settings set schema_version = 32 where id and schema_version < 32;

notify pgrst, 'reload schema';
