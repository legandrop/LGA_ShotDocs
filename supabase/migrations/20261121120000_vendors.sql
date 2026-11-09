-- LGA Shot Docs · Vendors de un proyecto y el permiso *Can share scenes* (Docs/Doc_Compartir_Escenas.md, sección 11,
-- D852).
--
-- Antes, *Share scenes* compartía escenas con una persona por guardado, y solo lo hacían el dueño y los admins. Ahora:
--
-- - **Vendors por proyecto** (`scene_vendors`): nombre, código corto, color y nivel (Ver o Comentar). Cada uno tiene
--   correos (`scene_vendor_emails`; un correo, un solo vendor vivo por proyecto) y escenas asignadas
--   (`scene_vendor_scenes`). **Sin correos es solo planificación**: no comparte nada. Cada correo ve todas las escenas
--   de su vendor, con su nivel, y lo de adentro, como antes (un permiso por página: la RLS de lectura no cambia).
-- - **Quién los maneja** (`private.vendor_cap`): el dueño o un admin que puede compartir el proyecto (hasta Comentar),
--   o quien tiene un permiso vivo sobre el proyecto con **`share_scenes`** (la casilla *Can share scenes*, también un
--   invitado), **nunca por encima de su propio nivel**. Control total sobre todos los vendors del proyecto, también los
--   que armó otro. Sacar siempre se puede; sumar acceso, solo a un vendor con un nivel que quien guarda puede dar.
-- - **El acceso se arma solo** (`private.vendor_sync_email`): a un miembro activo, permisos por página con
--   `grants.vendor_id` (el vendor los maneja: los sube, los baja y los saca); a alguien de afuera, **una invitación de
--   invitado por vendor** (`invitations.vendor_id`) que no copia las escenas: al aceptarla se dan las que el vendor tiene
--   en ese momento. Así no hay tope de 200 páginas por invitación, y lo que el vendor cambia vale también para quien
--   todavía no entró.
-- - Las invitaciones de vendors no las hace un dueño o admin: están vivas mientras el vendor y el correo lo estén
--   (`private.invitation_live`). `live_invitations` sigue siendo solo las de siempre (Members, *Share*), y cada lugar
--   que mira quién ve qué de afuera (la marca del árbol, el freno de `pages_scene_share_guard`, `project_page_shares`,
--   el registro con invitación) suma las de vendors.
-- - Un permiso de vendor deja de serlo si otro camino lo toca (`grants_vendor_guard`): revocarlo, revivirlo o cambiarle
--   el nivel desde *Share* le saca el `vendor_id`, y revocar o revivir un permiso apaga `share_scenes`.
--
-- Lo compartido antes persona por persona con *Share scenes* pasa a un vendor por persona (sección 7).
--
-- Compatible con las versiones publicadas: `set_page_shares` y `project_page_shares` siguen andando (la ventana vieja),
-- `list_access` suma una columna. Sube `schema_version` a 31.

-- ---------------------------------------------------------------------------------------------------
-- 0. Las tablas
-- ---------------------------------------------------------------------------------------------------
create table public.scene_vendors (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.workspaces (id) on delete cascade,
  name       text not null check (name = btrim(name) and length(name) between 1 and 80),
  -- Opcional: sin código, la app muestra las primeras letras del nombre.
  code       text not null default '' check (code ~ '^[A-Z0-9]{0,4}$'),
  color      text not null check (color ~ '^#[0-9a-f]{6}$'),
  level      text not null check (level in ('view', 'comment')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Borrar un vendor lo marca: sus correos dejan de ver sus escenas; la fila y lo asignado quedan.
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null,
  constraint scene_vendors_deleted_by check (deleted_by is null or deleted_at is not null)
);
create index scene_vendors_project_idx on public.scene_vendors (project_id) where deleted_at is null;

create table public.scene_vendor_emails (
  vendor_id uuid not null references public.scene_vendors (id) on delete cascade,
  email     text not null
            check (email = lower(btrim(email)) and length(email) between 3 and 320 and email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  added_by  uuid references auth.users (id) on delete set null,
  added_at  timestamptz not null default now(),
  primary key (vendor_id, email)
);
create index scene_vendor_emails_email_idx on public.scene_vendor_emails (email);

create table public.scene_vendor_scenes (
  vendor_id uuid not null references public.scene_vendors (id) on delete cascade,
  page_id   uuid not null references public.pages (id) on delete cascade,
  added_by  uuid references auth.users (id) on delete set null,
  added_at  timestamptz not null default now(),
  primary key (vendor_id, page_id)
);
create index scene_vendor_scenes_page_idx on public.scene_vendor_scenes (page_id);

-- Cerradas: solo las tocan las funciones de abajo (un vendor nunca ve la lista de vendors).
alter table public.scene_vendors enable row level security;
alter table public.scene_vendor_emails enable row level security;
alter table public.scene_vendor_scenes enable row level security;
revoke all on public.scene_vendors, public.scene_vendor_emails, public.scene_vendor_scenes from public, anon, authenticated;

-- Escribirlas pide la versión de la app, como `grants` e `invitations`.
create trigger scene_vendors_write_version_insert after insert on public.scene_vendors
  for each row execute function private.team_write_version();
create trigger scene_vendors_write_version_update after update on public.scene_vendors
  for each row when (old.* is distinct from new.*) execute function private.team_write_version();
create trigger scene_vendor_emails_write_version after insert or delete on public.scene_vendor_emails
  for each row execute function private.team_write_version();
create trigger scene_vendor_scenes_write_version after insert or delete on public.scene_vendor_scenes
  for each row execute function private.team_write_version();

-- El permiso *Can share scenes* (solo sobre un proyecto) y el vendor que maneja un permiso (solo sobre una página).
alter table public.grants
  add column share_scenes boolean not null default false,
  add column vendor_id uuid references public.scene_vendors (id) on delete set null,
  add constraint grants_share_scenes_project check (not share_scenes or project_id is not null),
  add constraint grants_vendor_page check (vendor_id is null or page_id is not null);

alter table public.invitations
  add column vendor_id uuid references public.scene_vendors (id) on delete set null;
create index invitations_vendor_idx on public.invitations (vendor_id) where vendor_id is not null;

-- ---------------------------------------------------------------------------------------------------
-- 1. Un permiso de vendor deja de serlo si otro camino lo toca
-- ---------------------------------------------------------------------------------------------------
-- Las funciones de vendors prenden `shotdocs.vendor_sync` (solo en su transacción) mientras escriben. Cualquier otro
-- camino (*Share*, `unshare`, `set_page_shares`, `accept_invitations` de una invitación de siempre) que revoque, reviva o
-- cambie el nivel de un permiso le saca el vendor (si no, el vendor después lo sacaría o lo bajaría sin ser suyo), y
-- revocar o revivir apaga *Can share scenes* (volver a compartir el proyecto no devuelve la casilla).
create function private.grants_vendor_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if coalesce(current_setting('shotdocs.vendor_sync', true), '') = 'on' then
    return new;
  end if;
  if new.revoked_at is distinct from old.revoked_at then
    new.share_scenes := false;
    new.vendor_id := null;
  elsif new.level is distinct from old.level then
    new.vendor_id := null;
  end if;
  return new;
end;
$$;

revoke all on function private.grants_vendor_guard() from public, anon, authenticated;

create trigger grants_vendor_guard
before update of revoked_at, level on public.grants
for each row execute function private.grants_vendor_guard();

-- ---------------------------------------------------------------------------------------------------
-- 2. Las piezas de adentro
-- ---------------------------------------------------------------------------------------------------
-- Hasta qué nivel puede dar la sesión en los vendors del proyecto: 0 no los maneja, 1 Ver, 2 Comentar. El dueño o un
-- admin que puede compartir el proyecto, 2; quien tiene `share_scenes` en un permiso vivo sobre el proyecto, su nivel
-- sobre el proyecto (hasta 2). `workspace_role()` ya pide una sesión permitida y un miembro activo.
create function private.vendor_cap(p_project uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select case
    when p_project is null or private.workspace_role() is null then 0
    when private.workspace_role() in ('owner', 'admin') and private.can_share(p_project, null) then 2
    when exists (select 1 from public.grants g
                 where g.user_id = (select auth.uid()) and g.project_id = p_project
                   and g.revoked_at is null and g.share_scenes)
      then least(2, private.project_level(p_project))
    else 0
  end;
$$;

-- ¿Está viva la invitación? Sin usar, sin revocar, sin vencer y: la de siempre, de un dueño o admin activo
-- (`live_invitations`); la de un vendor, con el vendor sin borrar y el correo todavía en él.
create function private.invitation_live(i public.invitations)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select i.used_at is null and i.revoked_at is null and i.expires_at > now()
     and case
           when i.vendor_id is null then exists (
             select 1 from public.members m
             where m.user_id = i.invited_by and m.removed_at is null and m.role in ('owner', 'admin'))
           else exists (
             select 1 from public.scene_vendors v
             join public.scene_vendor_emails e on e.vendor_id = v.id and e.email = i.email
             join public.workspaces w on w.id = v.project_id and w.deleted_at is null
             where v.id = i.vendor_id and v.deleted_at is null)
         end;
$$;

-- Las invitaciones de siempre (Members, *Share*, `set_page_shares`): las de vendors no se suman ni se cambian por acá.
create or replace function private.live_invitations(p_email text)
returns setof public.invitations
language sql stable security definer set search_path = ''
as $$
  select i.*
  from public.invitations i
  where i.email = lower(btrim(p_email))
    and i.vendor_id is null
    and i.used_at is null
    and i.revoked_at is null
    and i.expires_at > now()
    and exists (
      select 1 from public.members m
      where m.user_id = i.invited_by and m.removed_at is null and m.role in ('owner', 'admin'));
$$;

-- Las invitaciones vivas de vendors para un correo.
create function private.live_vendor_invitations(p_email text)
returns setof public.invitations
language sql stable security definer set search_path = ''
as $$
  select i.*
  from public.invitations i
  where i.email = lower(btrim(p_email))
    and i.vendor_id is not null
    and private.invitation_live(i);
$$;

-- ¿Se le puede dar hoy esta escena a un vendor? Viva, con la marca de escena, sin la marca de carpeta y sin otra
-- entidad adentro: lo mismo que se mira al asignarla. Una escena asignada que dejó de cumplirlo (le sacaron la marca, le
-- movieron una locación adentro mientras el vendor no tenía correos) **no se da**: ni a un miembro, ni al aceptar, ni la
-- reinicia una invitación nueva; la ventana la muestra bloqueada en el vendor (`ok` en `scene_vendors_list`).
create function private.vendor_scene_ok(p_page uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.pages pg
    where pg.id = p_page
      and coalesce(pg.settings -> 'entity' ->> 'kind', '') = 'scene'
      and not private.folder_marked(pg.settings))
    and private.page_alive(p_page)
    and not private.branch_has_entities(p_page);
$$;

revoke all on function private.vendor_cap(uuid) from public, anon, authenticated;
revoke all on function private.vendor_scene_ok(uuid) from public, anon, authenticated;
revoke all on function private.invitation_live(public.invitations) from public, anon, authenticated;
revoke all on function private.live_invitations(text) from public, anon, authenticated;
revoke all on function private.live_vendor_invitations(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 3. Armar el acceso de un correo
-- ---------------------------------------------------------------------------------------------------
-- Deja lo que un correo ve por vendors en este proyecto igual a lo que dicen los vendors (un correo está en un solo
-- vendor vivo del proyecto, o en ninguno). Devuelve las páginas que empiezan a verse (se reiniciaron: la app arma sus
-- bases limpias). Toma el candado del correo, el mismo de `create_invitation`.
-- - **Miembro activo:** saca los permisos de vendors de este proyecto que ya no le corresponden (otro vendor, ninguno,
--   o una escena que salió), pone el nivel del vendor en los suyos (puede bajar) y suma las escenas vivas que no ve con
--   ese nivel (un upsert que no baja nada que no sea del vendor y reinicia la rama). Revoca sus invitaciones de vendors
--   del proyecto (ya entró).
-- - **Alguien de afuera:** revoca sus invitaciones de otros vendors del proyecto; si está en uno, deja viva una
--   invitación de invitado de ese vendor (sin escenas en `grants`: se toman al aceptar) y la renueva 30 días. Una nueva
--   reinicia todas las escenas vivas del vendor.
create function private.vendor_sync_email(p_project uuid, p_email text, p_actor uuid)
returns uuid[]
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_vendor public.scene_vendors;
  v_level  int;
  v_uid    uuid;
  v_inv    uuid;
  v_page   uuid;
  v_new    uuid[] := '{}';
  v_ids    uuid[];
begin
  perform pg_advisory_xact_lock(hashtextextended('invitation:' || p_email, 0));
  perform set_config('shotdocs.vendor_sync', 'on', true);

  select x.* into v_vendor
  from public.scene_vendors x
  join public.scene_vendor_emails e on e.vendor_id = x.id and e.email = p_email
  where x.project_id = p_project and x.deleted_at is null
  order by x.created_at, x.id
  limit 1;
  v_level := case when v_vendor.id is null then 0 else private.grant_level_value(v_vendor.level) end;
  -- Los vendors del proyecto, también los borrados: sus permisos e invitaciones se sacan.
  select coalesce(array_agg(x.id), '{}') into v_ids from public.scene_vendors x where x.project_id = p_project;

  select u.id into v_uid
  from auth.users u
  where lower(u.email::text) = p_email and private.workspace_role(u.id) is not null
  order by u.created_at, u.id
  limit 1;

  if v_uid is not null then
    update public.grants g
    set revoked_at = now(), revoked_by = p_actor
    where g.user_id = v_uid and g.revoked_at is null and g.vendor_id = any (v_ids)
      and (v_vendor.id is null or g.vendor_id <> v_vendor.id
           or not exists (select 1 from public.scene_vendor_scenes s
                          where s.vendor_id = v_vendor.id and s.page_id = g.page_id)
           or not private.vendor_scene_ok(g.page_id));
    if v_vendor.id is not null then
      update public.grants g
      set level = v_vendor.level, granted_by = p_actor
      where g.user_id = v_uid and g.revoked_at is null and g.vendor_id = v_vendor.id and g.level <> v_vendor.level;
      for v_page in
        select s.page_id from public.scene_vendor_scenes s where s.vendor_id = v_vendor.id order by s.page_id
      loop
        continue when not private.vendor_scene_ok(v_page);
        continue when private.user_page_level(v_page, v_uid) >= v_level;
        -- Un permiso vivo que no es de un vendor (de *Share*, de un pedido) no se toma: si lo tomara, sacar el correo
        -- del vendor se lo revocaría entero. Queda como estaba (la persona sigue con su nivel de antes en esa escena).
        insert into public.grants as g (user_id, page_id, level, granted_by, vendor_id)
        values (v_uid, v_page, v_vendor.level, p_actor, v_vendor.id)
        on conflict (user_id, page_id) where page_id is not null
        do update set level = excluded.level, granted_by = excluded.granted_by, revoked_at = null, revoked_by = null,
                      vendor_id = excluded.vendor_id
        where g.revoked_at is not null
           or (g.vendor_id is not null
               and private.grant_level_value(excluded.level) > private.grant_level_value(g.level));
        continue when not found;
        perform private.clean_reset(null, v_page);
        v_new := v_new || v_page;
      end loop;
    end if;
    update public.invitations i
    set revoked_at = now(), revoked_by = p_actor
    where i.email = p_email and i.vendor_id = any (v_ids) and i.used_at is null and i.revoked_at is null;
    perform set_config('shotdocs.vendor_sync', 'off', true);
    return v_new;
  end if;

  update public.invitations i
  set revoked_at = now(), revoked_by = p_actor
  where i.email = p_email and i.vendor_id = any (v_ids) and i.used_at is null and i.revoked_at is null
    and (v_vendor.id is null or i.vendor_id <> v_vendor.id);
  if v_vendor.id is not null then
    select i.id into v_inv
    from public.invitations i
    where i.email = p_email and i.vendor_id = v_vendor.id and i.used_at is null and i.revoked_at is null
      and i.expires_at > now()
    order by i.created_at desc, i.id
    limit 1;
    if v_inv is null then
      insert into public.invitations (email, role, grants, invited_by, vendor_id)
      values (p_email, 'guest', '[]'::jsonb, p_actor, v_vendor.id);
      for v_page in
        select s.page_id from public.scene_vendor_scenes s where s.vendor_id = v_vendor.id order by s.page_id
      loop
        continue when not private.vendor_scene_ok(v_page);
        perform private.clean_reset(null, v_page);
        v_new := v_new || v_page;
      end loop;
    else
      update public.invitations set expires_at = now() + interval '30 days' where id = v_inv;
    end if;
  end if;
  perform set_config('shotdocs.vendor_sync', 'off', true);
  return v_new;
end;
$$;

revoke all on function private.vendor_sync_email(uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 4. Los vendors de un proyecto
-- ---------------------------------------------------------------------------------------------------
-- Para quien los maneja. `cap`: hasta qué nivel puede dar (1 Ver, 2 Comentar); `admin`: dueño o admin que comparte el
-- proyecto. Cada vendor vivo con sus correos (`joined`: miembro activo; `invited`: con una invitación viva de este
-- vendor; `expired`: ni una cosa ni la otra) y sus escenas (`alive`: falso si ella o una de arriba está en la papelera).
-- `others`: las páginas vivas del proyecto que ven personas de afuera **sin vendor** (un permiso sin vendor, o una
-- invitación de siempre), con cuántas: la ventana lo dice para que se sepa quién más las ve. Costo: un
-- `user_page_level` por permiso sobre una página del proyecto, como `pages_with_outside_readers`.
create function public.scene_vendors_list(p_project uuid)
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
               'emails', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'email', e.email,
                          'state', case
                                     when exists (select 1 from auth.users u
                                                  where lower(u.email::text) = e.email
                                                    and private.workspace_role(u.id) is not null) then 'joined'
                                     when exists (select 1 from public.invitations i
                                                  where i.vendor_id = v.id and i.email = e.email
                                                    and private.invitation_live(i)) then 'invited'
                                     else 'expired'
                                   end)
                        order by e.added_at, e.email)
                 from public.scene_vendor_emails e where e.vendor_id = v.id), '[]'::jsonb),
               'scenes', coalesce((
                 select jsonb_agg(jsonb_build_object('page_id', s.page_id, 'alive', private.page_alive(s.page_id),
                                            'ok', private.vendor_scene_ok(s.page_id))
                        order by s.page_id)
                 from public.scene_vendor_scenes s where s.vendor_id = v.id), '[]'::jsonb))
             order by v.created_at, v.id)
      from public.scene_vendors v
      where v.project_id = p_project and v.deleted_at is null), '[]'::jsonb),
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
-- 5. Guardar los cambios de los vendors, todo o nada
-- ---------------------------------------------------------------------------------------------------
-- `p_ops`: una lista (hasta 100) de
--   {"op": "create", "key": <texto de la app>, "name", "code", "color", "level",
--    "add_scenes": [ids], "add_emails": [correos]}
--   {"op": "update", "id", y lo que cambia: "name", "code", "color", "level", "add_scenes", "remove_scenes",
--    "add_emails", "remove_emails", "reinvite": [correos que siguen en el vendor]}
--   {"op": "delete", "id"}
-- En este orden: quien guarda los maneja (`not_allowed`); el interruptor de lo borrado (`clean_off`); la lista
-- (`ops_invalid`); un candado por proyecto; cada operación (vendor de este proyecto, vivo y una sola vez:
-- `vendor_not_found`, `ops_invalid`; campos: `vendor_invalid`; **sumar acceso a un vendor con un nivel mayor que el de
-- quien guarda, o crearlo o subirlo por encima: `level_not_allowed`**; cada escena que se suma: del proyecto, viva, con
-- la marca de escena, que quien guarda puede compartir (dueño o admin: `user_can_share_page`; con la casilla: que la ve)
-- y que no es ni tiene adentro otra entidad: `page_invalid` o `scene_contains_entities`; sacar una que no está:
-- `page_invalid`; correos: `email_invalid`, `email_exists`, `email_not_found`); los topes (100 vendors por proyecto,
-- 30 correos por vendor, 1000 cambios de escenas y 200 de correos por guardado); **un correo en un solo vendor vivo del
-- proyecto** (`email_in_other_vendor`, con el correo en el `hint`), mirado después de todas las operaciones (así un
-- correo pasa de un vendor a otro en un guardado). Después, cada correo tocado se sincroniza (`vendor_sync_email`), en
-- orden. Devuelve `{"keys": {key: id}, "reset": [páginas que empiezan a verse], "pending": [correos de afuera con
-- invitación viva]}`.
create function public.save_scene_vendors(p_project uuid, p_ops jsonb)
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
  -- Las listas de cada operación, bien formadas (antes de tocar nada). Con `case`, que mira en orden: desarmar como lista
  -- algo que no lo es daría otro error.
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
      if (select count(*) from public.scene_vendors x where x.project_id = p_project and x.deleted_at is null) >= 100 then
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
      if v_kind = 'delete' then
        update public.scene_vendors set deleted_at = now(), deleted_by = v_uid where id = v_vendor.id;
        select v_emails || coalesce(array_agg(e.email), '{}') into v_emails
        from public.scene_vendor_emails e where e.vendor_id = v_vendor.id;
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
      -- Subir el nivel (no bajarlo) por encima de lo que quien guarda puede dar.
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

    -- Sumar acceso (escenas, correos, volver a invitar) a un vendor con un nivel que quien guarda no puede dar.
    v_more := jsonb_array_length(coalesce(v_op -> 'add_scenes', '[]')) > 0
           or jsonb_array_length(coalesce(v_op -> 'add_emails', '[]')) > 0
           or jsonb_array_length(coalesce(v_op -> 'reinvite', '[]')) > 0;
    if v_more and private.grant_level_value(v_vendor.level) > v_cap then
      raise exception 'level_not_allowed' using errcode = '42501',
        hint = 'You can give vendors up to your own access to the project.';
    end if;

    -- Escenas que salen.
    for v_page in select x::uuid from jsonb_array_elements_text(coalesce(v_op -> 'remove_scenes', '[]')) x loop
      delete from public.scene_vendor_scenes s where s.vendor_id = v_vendor.id and s.page_id = v_page;
      if not found then
        raise exception 'page_invalid' using errcode = '22023';
      end if;
      v_scene_n := v_scene_n + 1;
      v_touch := true;
    end loop;
    -- Escenas que entran: cada una vale sola; una sola respuesta que no dice cuál ni si existe.
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

    -- Correos que salen, que entran y a los que se vuelve a invitar.
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
      -- Quien maneja vendors con la casilla no se carga a sí mismo: le quedarían escenas por vendor que nadie ve venir
      -- el día que le saquen el permiso del proyecto.
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

    -- Cambiaron sus escenas o su nivel: todos sus correos. Lo que entra a un vendor con correos empieza de una base
    -- nueva (a un miembro lo reinicia también `vendor_sync_email`; a una invitación ya viva, solo esto).
    if v_touch then
      select v_emails || coalesce(array_agg(e.email), '{}') into v_emails
      from public.scene_vendor_emails e where e.vendor_id = v_vendor.id;
    end if;
    if cardinality(v_added) > 0
       and exists (select 1 from public.scene_vendor_emails e where e.vendor_id = v_vendor.id) then
      foreach v_page in array v_added loop
        perform private.clean_reset(null, v_page);
      end loop;
      v_reset := v_reset || v_added;
    end if;
  end loop;

  -- Un correo, un solo vendor vivo del proyecto (después de todas las operaciones).
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
-- 6. La casilla *Can share scenes*
-- ---------------------------------------------------------------------------------------------------
-- La pone o la saca el dueño o un admin que puede compartir el proyecto, sobre el permiso vivo de un miembro activo
-- sobre ese proyecto (`grant_not_found` si no tiene). Sacarla no toca lo que ya compartió (D852 (3)).
create function public.set_share_scenes(p_project uuid, p_user uuid, p_on boolean)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if p_project is null or p_user is null or p_on is null
     or not coalesce(private.workspace_role() in ('owner', 'admin'), false)
     or not private.can_share(p_project, null) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.grants g
  set share_scenes = p_on
  where g.user_id = p_user and g.project_id = p_project and g.revoked_at is null
    and private.workspace_role(p_user) is not null;
  if not found then
    raise exception 'grant_not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- `list_access` suma `share_scenes` (de un permiso sobre el proyecto; en las demás filas, falso).
drop function public.list_access(uuid, uuid);
create function public.list_access(p_project uuid, p_page uuid)
returns table (user_id uuid, email text, role text, level text, source text, grant_id uuid,
               project_id uuid, page_id uuid, share_scenes boolean)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  ws uuid;
begin
  if (p_project is null) = (p_page is null) then
    raise exception 'target_invalid' using errcode = '22023';
  end if;
  if not private.can_share(p_project, p_page) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  ws := coalesce(p_project, (select pg.workspace_id from public.pages pg where pg.id = p_page));

  return query
    with recursive chain (id, parent_id, depth) as (
      select pg.id, pg.parent_id, 0 from public.pages pg where pg.id = p_page
      union all
      select pg.id, pg.parent_id, c.depth + 1
      from public.pages pg
      join chain c on pg.id = c.parent_id
      where c.depth < 10000
    ),
    access (uid, lvl, src, gid, prj, pag, ss) as (
      select w.owner_id, 'edit_pages'::text, 'creator'::text, null::uuid, w.id, null::uuid, false
      from public.workspaces w where w.id = ws
      union all
      select g.user_id, g.level, 'project', g.id, g.project_id, null, g.share_scenes
      from public.grants g where g.project_id = ws and g.revoked_at is null
      union all
      select g.user_id, g.level, case when g.page_id = p_page then 'page' else 'parent_page' end, g.id, null, g.page_id, false
      from public.grants g where g.page_id in (select c.id from chain c) and g.revoked_at is null
    )
    select a.uid, u.email::text, m.role, a.lvl, a.src, a.gid, a.prj, a.pag, a.ss
    from access a
    join public.members m on m.user_id = a.uid and m.removed_at is null
    join auth.users u on u.id = a.uid
    order by u.email, private.grant_level_value(a.lvl) desc, a.src;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 7. Invitaciones: la pantalla de miembros, aceptar y el registro
-- ---------------------------------------------------------------------------------------------------
-- *Members* sigue mostrando solo las de siempre (las de vendors se ven en *Share scenes*).
create or replace function public.list_invitations()
returns table (id uuid, email text, role text, grants jsonb, invited_by uuid, invited_by_email text,
               created_at timestamptz, expires_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select i.id, i.email, i.role, i.grants, i.invited_by, u.email::text, i.created_at, i.expires_at
  from public.invitations i
  left join auth.users u on u.id = i.invited_by
  where coalesce(private.workspace_role() in ('owner', 'admin'), false)
    and i.vendor_id is null
    and i.used_at is null and i.revoked_at is null and i.expires_at > now()
    and exists (
      select 1 from public.members m
      where m.user_id = i.invited_by and m.removed_at is null and m.role in ('owner', 'admin'))
  order by i.created_at desc, i.id;
$$;

-- Como en `20261001120000_proyectos_archivar_borrar.sql`, más las invitaciones de vendors: entra como invitado (un
-- miembro activo queda con su rol; uno sacado vuelve como invitado, sin sus permisos de antes) y recibe las escenas
-- vivas que el vendor tiene **ahora**, con su nivel, como permisos del vendor. Lo de adentro ya se reinició al invitar o
-- al sumar la escena (ver `vendor_sync_email` y `save_scene_vendors`).
create or replace function public.accept_invitations()
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  em  text;
  inv public.invitations;
  cur public.members;
  el  jsonb;
  tgt uuid;
  ven public.scene_vendors;
  n   int := 0;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not private.session_allowed() then
    raise exception 'session_not_allowed' using errcode = '42501',
      hint = 'Sign in with the code sent by email.';
  end if;
  select lower(u.email) into em from auth.users u where u.id = uid and u.email_confirmed_at is not null;
  if em is null then
    return 0;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('invitation:' || em, 0));

  for inv in select * from private.live_invitations(em) i order by i.created_at, i.id loop
    select * into cur from public.members m where m.user_id = uid for update;
    if not found then
      insert into public.members (user_id, role, added_by) values (uid, inv.role, inv.invited_by);
    elsif cur.removed_at is not null then
      update public.grants set revoked_at = now(), revoked_by = inv.invited_by
      where user_id = uid and revoked_at is null;
      update public.members set role = inv.role, removed_at = null, added_by = inv.invited_by
      where user_id = uid;
    elsif cur.role <> 'owner' and private.role_rank(inv.role) > private.role_rank(cur.role) then
      update public.members set role = inv.role where user_id = uid;
    end if;

    for el in select * from jsonb_array_elements(inv.grants) loop
      if el ? 'project_id' then
        tgt := (el ->> 'project_id')::uuid;
        continue when private.user_project_level_any(tgt, inv.invited_by) < 4;
        insert into public.grants as g (user_id, project_id, level, granted_by)
        values (uid, tgt, el ->> 'level', inv.invited_by)
        on conflict (user_id, project_id) where project_id is not null
        do update set level = excluded.level, granted_by = excluded.granted_by, revoked_at = null, revoked_by = null
        where g.revoked_at is not null
           or private.grant_level_value(excluded.level) > private.grant_level_value(g.level);
      else
        tgt := (el ->> 'page_id')::uuid;
        continue when private.user_page_level_any(tgt, inv.invited_by) < 4;
        insert into public.grants as g (user_id, page_id, level, granted_by)
        values (uid, tgt, el ->> 'level', inv.invited_by)
        on conflict (user_id, page_id) where page_id is not null
        do update set level = excluded.level, granted_by = excluded.granted_by, revoked_at = null, revoked_by = null
        where g.revoked_at is not null
           or private.grant_level_value(excluded.level) > private.grant_level_value(g.level);
      end if;
    end loop;

    update public.invitations set used_at = now(), used_by = uid where id = inv.id;
    n := n + 1;
  end loop;

  for inv in select * from private.live_vendor_invitations(em) i order by i.created_at, i.id loop
    select * into cur from public.members m where m.user_id = uid for update;
    if not found then
      insert into public.members (user_id, role, added_by) values (uid, 'guest', inv.invited_by);
    elsif cur.removed_at is not null then
      update public.grants set revoked_at = now(), revoked_by = inv.invited_by
      where user_id = uid and revoked_at is null;
      update public.members set role = 'guest', removed_at = null, added_by = inv.invited_by
      where user_id = uid;
    end if;

    select * into ven from public.scene_vendors v where v.id = inv.vendor_id;
    perform set_config('shotdocs.vendor_sync', 'on', true);
    for tgt in select s.page_id from public.scene_vendor_scenes s where s.vendor_id = ven.id order by s.page_id loop
      continue when not private.vendor_scene_ok(tgt);
      continue when private.user_page_level(tgt, uid) >= private.grant_level_value(ven.level);
      insert into public.grants as g (user_id, page_id, level, granted_by, vendor_id)
      values (uid, tgt, ven.level, inv.invited_by, ven.id)
      on conflict (user_id, page_id) where page_id is not null
      do update set level = excluded.level, granted_by = excluded.granted_by, revoked_at = null, revoked_by = null,
                    vendor_id = excluded.vendor_id
      where g.revoked_at is not null
         or (g.vendor_id is not null
             and private.grant_level_value(excluded.level) > private.grant_level_value(g.level));
    end loop;
    perform set_config('shotdocs.vendor_sync', 'off', true);

    update public.invitations set used_at = now(), used_by = uid where id = inv.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- El registro con invitación (el hook): también con una de vendor.
create or replace function private.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  em text := lower(btrim(event -> 'user' ->> 'email'));
begin
  if em is not null and em <> ''
     and (exists (select 1 from private.live_invitations(em))
          or exists (select 1 from private.live_vendor_invitations(em))) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'Signups not allowed for this email: ask the owner of this workspace for an invitation.'));
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 8. Lo que ven personas de afuera: también por las invitaciones de vendors
-- ---------------------------------------------------------------------------------------------------
-- Como en `20261118120000_compartir_escenas.sql`, más: una escena asignada a un vendor con una invitación viva la ven de
-- afuera (las invitaciones de vendors son de invitado). La marca del árbol, el sí o no de quien edita y el freno de
-- `pages_scene_share_guard` (que llama a estas) las cuentan.
create or replace function private.page_outside_readers(p uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
           select 1
           from public.grants g
           join public.members m on m.user_id = g.user_id and m.removed_at is null
           where g.page_id = p and g.revoked_at is null
             and (m.role = 'guest' or private.user_page_level(p, g.user_id) between 1 and 2))
      or exists (
           select 1
           from public.invitations i
           cross join lateral jsonb_array_elements(i.grants) el
           where i.vendor_id is null and private.invitation_live(i)
             and el ->> 'page_id' = p::text
             and (i.role = 'guest' or el ->> 'level' in ('view', 'comment')))
      or exists (
           select 1
           from public.scene_vendor_scenes s
           join public.invitations i on i.vendor_id = s.vendor_id
           where s.page_id = p and private.invitation_live(i));
$$;

create or replace function public.pages_with_outside_readers(p_project uuid)
returns table (page_id uuid, readers int)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_project is null or coalesce(private.workspace_role(), 'guest') = 'guest'
     or not private.can_share(p_project, null) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  return query
    with direct (pid, who) as (
      select g.page_id, 'u:' || g.user_id::text
      from public.grants g
      join public.pages pg on pg.id = g.page_id
      join public.members m on m.user_id = g.user_id and m.removed_at is null
      where g.revoked_at is null and pg.workspace_id = p_project
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
      union
      select s.page_id, 'i:' || i.id::text
      from public.scene_vendor_scenes s
      join public.pages pg on pg.id = s.page_id
      join public.invitations i on i.vendor_id = s.vendor_id
      where pg.workspace_id = p_project and private.invitation_live(i)
    )
    select d.pid, count(distinct d.who)::int
    from direct d
    where private.page_alive(d.pid)
    group by d.pid;
end;
$$;

-- `project_page_shares` (la ventana de la v0.330 y anteriores): también una fila por escena viva de cada invitación viva
-- de un vendor, con el nivel del vendor.
create or replace function public.project_page_shares(p_project uuid)
returns table (row_key text, email text, user_id uuid, role text, page_id uuid, level text, grant_id uuid,
               invitation_id uuid, in_trash boolean)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_project is null
     or not coalesce(private.workspace_role() in ('owner', 'admin'), false)
     or not private.can_share(p_project, null) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  return query
    select 'g:' || g.id::text, u.email::text, g.user_id, m.role, null::uuid, g.level, g.id, null::uuid, false
    from public.grants g
    join public.members m on m.user_id = g.user_id and m.removed_at is null
    join auth.users u on u.id = g.user_id
    where g.revoked_at is null and g.project_id = p_project
    union all
    select 'g:' || g.id::text, u.email::text, g.user_id, m.role, g.page_id, g.level, g.id, null::uuid,
           not private.page_alive(g.page_id)
    from public.grants g
    join public.pages pg on pg.id = g.page_id
    join public.members m on m.user_id = g.user_id and m.removed_at is null
    join auth.users u on u.id = g.user_id
    where g.revoked_at is null and pg.workspace_id = p_project
    union all
    select 'i:' || i.id::text || ':' || coalesce(el ->> 'page_id', 'project'), i.email, null::uuid, i.role,
           (el ->> 'page_id')::uuid, el ->> 'level', null::uuid, i.id, false
    from public.invitations i
    cross join lateral jsonb_array_elements(i.grants) el
    where i.vendor_id is null and private.invitation_live(i)
      and ((el ? 'project_id' and el ->> 'project_id' = p_project::text)
           or (el ? 'page_id'
               and exists (select 1 from public.pages pg
                           where pg.id = (el ->> 'page_id')::uuid and pg.workspace_id = p_project)
               and private.page_alive((el ->> 'page_id')::uuid)))
    union all
    select 'i:' || i.id::text || ':' || s.page_id::text, i.email, null::uuid, 'guest', s.page_id, v.level, null::uuid,
           i.id, false
    from public.scene_vendors v
    join public.scene_vendor_scenes s on s.vendor_id = v.id
    join public.invitations i on i.vendor_id = v.id
    where v.project_id = p_project and private.invitation_live(i) and private.vendor_scene_ok(s.page_id);
end;
$$;

revoke all on function public.scene_vendors_list(uuid) from public, anon;
revoke all on function public.save_scene_vendors(uuid, jsonb) from public, anon;
revoke all on function public.set_share_scenes(uuid, uuid, boolean) from public, anon;
revoke all on function public.list_access(uuid, uuid) from public, anon;
grant execute on function public.scene_vendors_list(uuid) to authenticated;
grant execute on function public.save_scene_vendors(uuid, jsonb) to authenticated;
grant execute on function public.set_share_scenes(uuid, uuid, boolean) to authenticated;
grant execute on function public.list_access(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 9. Lo compartido antes persona por persona pasa a un vendor por persona
-- ---------------------------------------------------------------------------------------------------
-- Por cada proyecto y cada **invitado** activo con permisos vivos de Ver o Comentar (sin vendor) sobre páginas vivas con
-- la marca de escena de ese proyecto: un vendor con su correo (el nombre es la parte de antes de la @) y el **nivel más
-- bajo** de esos permisos; entran las escenas con ese nivel y sus permisos quedan como del vendor. Las de nivel más alto
-- quedan como permisos sueltos, sin vendor (un correo va en un solo vendor: dos niveles no entran en dos vendors), así
-- nadie gana ni pierde nada. Los miembros del equipo no se convierten: lo suyo vino de *Share*. Las invitaciones pendientes no se tocan (siguen siendo
-- de siempre). Con los triggers de la versión de la app: corre como dueño de la base, sin sesión.
do $$
declare
  r       record;
  v_id    uuid;
  v_n     int := 0;
  v_color text[] := array['#2e5a8e', '#443a91', '#774dcb', '#2e8e7a', '#4a7a2e', '#8e7a2e', '#8e4a2e', '#8e2e5a'];
begin
  perform set_config('shotdocs.vendor_sync', 'on', true);
  for r in
    select pg.workspace_id as project_id, g.user_id, lower(u.email::text) as email,
           min(private.grant_level_value(g.level)) as lvl,
           array_agg(g.id) filter (where g.level = 'view') as view_ids,
           array_agg(distinct g.page_id) filter (where g.level = 'view') as view_pages,
           array_agg(g.id) as all_ids, array_agg(distinct g.page_id) as all_pages
    from public.grants g
    join public.pages pg on pg.id = g.page_id
    join public.members m on m.user_id = g.user_id and m.removed_at is null and m.role = 'guest'
    join auth.users u on u.id = g.user_id
    where g.revoked_at is null and g.vendor_id is null and g.level in ('view', 'comment')
      and coalesce(pg.settings -> 'entity' ->> 'kind', '') = 'scene'
      and private.page_alive(g.page_id)
    group by pg.workspace_id, g.user_id, lower(u.email::text)
    order by pg.workspace_id, lower(u.email::text)
  loop
    insert into public.scene_vendors (project_id, name, code, color, level, created_by)
    values (r.project_id, left(btrim(split_part(r.email, '@', 1)), 80), '', v_color[1 + (v_n % 8)],
            case when r.lvl >= 2 then 'comment' else 'view' end, null)
    returning id into v_id;
    insert into public.scene_vendor_emails (vendor_id, email) values (v_id, r.email);
    insert into public.scene_vendor_scenes (vendor_id, page_id)
    select v_id, x from unnest(case when r.lvl >= 2 then r.all_pages else r.view_pages end) x;
    update public.grants set vendor_id = v_id
    where id = any (case when r.lvl >= 2 then r.all_ids else r.view_ids end);
    v_n := v_n + 1;
  end loop;
  perform set_config('shotdocs.vendor_sync', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 10. Versión de la base: la app ofrece los vendors y la casilla desde la 31.
-- ---------------------------------------------------------------------------------------------------
update public.workspace_settings set schema_version = 31 where id and schema_version < 31;

notify pgrst, 'reload schema';
