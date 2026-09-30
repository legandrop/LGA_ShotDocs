-- LGA Shot Docs · equipo (paso 9 de Docs/Plan_Workspaces.md, sección 11): la base.
--
-- Las políticas de páginas, contenido, archivos y proyectos pasan a mirar `members` y `grants`:
--   - Una página se ve con `page_level >= 1` y se edita (título, ícono, ajustes, contenido, imágenes) con
--     `page_level >= 3`. Crear, mover, mandar a la papelera y restaurar piden 4 (editar y crear páginas).
--   - Quien creó un proyecto tiene 4 sobre él solo mientras sea miembro activo del workspace.
--   - Un proyecto se ve con permiso sobre él o sobre alguna página de adentro; lo crean solo el dueño y los
--     admins (queda privado: solo lo ve su creador) y lo renombra quien tiene 4 sobre él.
--   - El dueño del workspace no ve los proyectos privados de otros.
-- Suma las funciones del equipo (invitar, entrar con invitación, miembros y compartir) y la del hook
-- "Before User Created" de Supabase, que queda sin conectar: se conecta a mano (Doc_Supabase.md, "Login").
--
-- Nada de esto borra datos. Las cuentas que ya existen no pierden nada: el dueño entró como `owner` y las
-- demás con proyectos propios como `member` con `edit_pages` sobre ellos (migración de miembros). Cambio
-- para esas otras cuentas: un `member` ya no crea proyectos nuevos.

-- ---------------------------------------------------------------------------------------------------
-- Niveles: la regla de quien creó el proyecto vale solo para miembros activos
-- ---------------------------------------------------------------------------------------------------
-- Escala: 0 nada, 1 ver, 2 comentar, 3 editar, 4 editar y crear páginas. Sin membresía activa (nunca fue
-- miembro, o la sacaron) todo da 0, también en los proyectos que creó.

create or replace function private.page_level(p uuid)
returns int
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
  target as (
    select pg.workspace_id, w.owner_id
    from public.pages pg
    join public.workspaces w on w.id = pg.workspace_id
    where pg.id = p
  )
  select case when private.workspace_role() is null then 0 else greatest(
    coalesce((select 4 from target t where t.owner_id = (select auth.uid())), 0),
    coalesce((
      select max(private.grant_level_value(g.level))
      from public.grants g
      where g.user_id = (select auth.uid())
        and (g.project_id = (select t.workspace_id from target t)
             or g.page_id in (select c.id from chain c))
    ), 0)) end;
$$;

create or replace function private.project_level(ws uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select case when private.workspace_role() is null then 0 else greatest(
    coalesce((select 4 from public.workspaces w where w.id = ws and w.owner_id = (select auth.uid())), 0),
    coalesce((
      select max(private.grant_level_value(g.level))
      from public.grants g
      where g.user_id = (select auth.uid()) and g.project_id = ws
    ), 0)) end;
$$;

-- Las usan las políticas de `pages`, `page_updates`, `page_files` y `files`, el bucket `page-files`,
-- `push_page_update` y `pull_page_updates`: cambian todas juntas.
create or replace function private.can_view_page(p uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.page_level(p) >= 1;
$$;

create or replace function private.can_edit_page(p uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.page_level(p) >= 3;
$$;

-- ¿La sesión puede crear una página con este proyecto y este padre? 4 sobre el padre (que tiene que ser
-- del mismo proyecto) o, si es raíz, sobre el proyecto. Es también el permiso del destino al mover.
create function private.can_create_page(p_workspace_id uuid, p_parent_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    when p_parent_id is null then private.project_level(p_workspace_id) >= 4
    else private.page_level(p_parent_id) >= 4
         and exists (select 1 from public.pages pg where pg.id = p_parent_id and pg.workspace_id = p_workspace_id)
  end;
$$;

-- La política de lectura de `pages` decide con los datos de la fila: `insert ... on conflict do nothing`
-- (así crea páginas la app) la evalúa sobre la fila nueva, que todavía no está en la tabla, así que no
-- alcanza con buscarla por id. Se ve si se ve el proyecto entero, la página o su padre (los permisos bajan:
-- en una fila que ya existe, ver el padre implica ver la página).
create function private.can_view_page_row(p_id uuid, p_workspace_id uuid, p_parent_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.project_level(p_workspace_id) >= 1
      or private.page_level(p_id) >= 1
      or (p_parent_id is not null and private.page_level(p_parent_id) >= 1);
$$;

-- Un archivo: quien lo creó lo ve solo mientras sea miembro activo (como todo lo demás).
create or replace function private.can_view_file(p_file uuid, p_created_by uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (coalesce(p_created_by = (select auth.uid()), false) and private.workspace_role() is not null)
      or exists (
        select 1 from public.page_files pf
        where pf.file_id = p_file and private.can_view_page(pf.page_id));
$$;

-- Proyectos: se ve el que creó (siendo miembro activo), uno con permiso sobre él, o uno con permiso sobre
-- alguna página de adentro (para mostrar su nombre; las páginas se filtran solas). Decide con los datos de
-- la fila por lo mismo que las páginas (crear con `on conflict do nothing`).
create function private.can_view_project_row(p_id uuid, p_owner_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.workspace_role() is not null and (
    p_owner_id = (select auth.uid())
    or private.project_level(p_id) >= 1
    or exists (
      select 1 from public.grants g
      join public.pages pg on pg.id = g.page_id
      where g.user_id = (select auth.uid()) and pg.workspace_id = p_id));
$$;

-- El corte completo: solo el dueño y los admins activos crean proyectos.
create or replace function private.can_create_project()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.workspace_role() in ('owner', 'admin'), false);
$$;

-- El orden de los roles, para no bajar uno más alto.
create function private.role_rank(r text)
returns int
language sql immutable set search_path = ''
as $$
  select case r when 'guest' then 1 when 'member' then 2 when 'admin' then 3 when 'owner' then 4 else 0 end;
$$;

revoke all on function private.can_create_page(uuid, uuid) from public, anon;
revoke all on function private.can_view_page_row(uuid, uuid, uuid) from public, anon;
revoke all on function private.can_view_project_row(uuid, uuid) from public, anon;
revoke all on function private.role_rank(text) from public, anon;
grant execute on function private.can_create_page(uuid, uuid) to authenticated;
grant execute on function private.can_view_page_row(uuid, uuid, uuid) to authenticated;
grant execute on function private.can_view_project_row(uuid, uuid) to authenticated;
grant execute on function private.role_rank(text) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Páginas
-- ---------------------------------------------------------------------------------------------------

drop policy pages_select on public.pages;
create policy pages_select on public.pages
  for select to authenticated using (private.can_view_page_row(id, workspace_id, parent_id));

drop policy pages_insert on public.pages;
create policy pages_insert on public.pages
  for insert to authenticated with check (private.can_create_page(workspace_id, parent_id));

-- `pages_update` sigue igual (`using` y `with check` con can_edit_page, que ahora pide 3). La política no
-- distingue columnas: lo que pide 4 lo controla el trigger de abajo.

-- Las dos anteriores ya no las usa nada.
drop function private.can_view_page_row(uuid, uuid);
drop function private.is_workspace_owner(uuid);

-- Qué pide cada cambio, con errores claros (42501). Corre como quien llama (no como definer) para saber si
-- viene de la API: solo controla al rol `authenticated`. Las funciones de la base que tocan páginas
-- (`push_page_update` sube `update_seq`) corren como su dueño y ya controlaron el permiso, y el SQL Editor
-- no tiene sesión. Va después de `pages_check_tree` (orden alfabético), que ya validó el padre y los
-- ciclos y fijó `workspace_id`.
--   crear                     4 sobre el padre, o sobre el proyecto si es raíz
--   mover (padre u orden)     4 sobre la página y 4 sobre el destino (el padre nuevo, o el proyecto)
--   papelera y restaurar      4 sobre la página
--   título, ícono, ajustes    3 (ya lo pide la política; acá por si acaso)
create function private.pages_permissions()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if not private.can_create_page(new.workspace_id, new.parent_id) then
      raise exception 'page_create_denied' using errcode = '42501',
        hint = 'Creating a page needs "edit and create pages" on its parent page (or on the project, at the top).';
    end if;
    return new;
  end if;

  if (new.parent_id, new.sort_key) is distinct from (old.parent_id, old.sort_key) then
    if private.page_level(old.id) < 4 or not private.can_create_page(new.workspace_id, new.parent_id) then
      raise exception 'page_move_denied' using errcode = '42501',
        hint = 'Moving a page needs "edit and create pages" on the page and on where it goes.';
    end if;
  end if;

  if new.deleted_at is distinct from old.deleted_at and private.page_level(old.id) < 4 then
    raise exception 'page_trash_denied' using errcode = '42501',
      hint = 'Moving a page to the trash or back needs "edit and create pages" on it.';
  end if;

  if (new.title, new.icon, new.settings, new.template_id)
     is distinct from (old.title, old.icon, old.settings, old.template_id)
     and private.page_level(old.id) < 3 then
    raise exception 'page_edit_denied' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.pages_permissions() from public, anon, authenticated;

create trigger pages_permissions
before insert or update on public.pages
for each row execute function private.pages_permissions();

-- ---------------------------------------------------------------------------------------------------
-- Proyectos (`workspaces`)
-- ---------------------------------------------------------------------------------------------------
-- Crear: `workspaces_insert` sigue pidiendo `owner_id = auth.uid()` y can_create_project (ahora solo dueño y
-- admins). `owner_id` sigue sin poder escribirse desde la API (solo `name` tiene permiso de update): lo
-- cambia únicamente `remove_member`, que corre como dueño de la tabla.

drop policy workspaces_select on public.workspaces;
create policy workspaces_select on public.workspaces
  for select to authenticated using (private.can_view_project_row(id, owner_id));

drop policy workspaces_update on public.workspaces;
create policy workspaces_update on public.workspaces
  for update to authenticated
  using (private.project_level(id) >= 4) with check (private.project_level(id) >= 4);

-- ---------------------------------------------------------------------------------------------------
-- ensure_workspace: el primer proyecto que la persona ve
-- ---------------------------------------------------------------------------------------------------
-- Primero el propio más viejo; si no, el primero con permiso sobre el proyecto; si no, el de una página
-- compartida; o null. Sin membresía activa, null.
create or replace function public.ensure_workspace()
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  ws  uuid;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if private.workspace_role(uid) is null then
    return null;
  end if;

  select w.id into ws
  from public.workspaces w
  where w.owner_id = uid
  order by w.created_at, w.id
  limit 1;
  if ws is not null then
    return ws;
  end if;

  select w.id into ws
  from public.grants g
  join public.workspaces w on w.id = g.project_id
  where g.user_id = uid
  order by w.created_at, w.id
  limit 1;
  if ws is not null then
    return ws;
  end if;

  select w.id into ws
  from public.grants g
  join public.pages pg on pg.id = g.page_id
  join public.workspaces w on w.id = pg.workspace_id
  where g.user_id = uid
  order by w.created_at, w.id
  limit 1;
  return ws;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Invitaciones
-- ---------------------------------------------------------------------------------------------------
-- Una invitación está viva si no se usó, no venció y quien la hizo sigue siendo dueño o admin activo (sacar
-- a un admin apaga las invitaciones que dejó sin usar). Una sola viva por correo: invitar de nuevo al mismo
-- correo la suma a la que ya hay (rol: el más alto de los dos; permisos: gana el más alto por proyecto o
-- página; vence a los 30 días de nuevo y queda a nombre de quien invitó último).

create function private.live_invitations(p_email text)
returns setof public.invitations
language sql stable security definer set search_path = ''
as $$
  select i.*
  from public.invitations i
  where i.email = lower(btrim(p_email))
    and i.used_at is null
    and i.expires_at > now()
    and exists (
      select 1 from public.members m
      where m.user_id = i.invited_by and m.removed_at is null and m.role in ('owner', 'admin'));
$$;

-- Junta dos listas de permisos de invitación: uno por proyecto o página, el más alto.
create function private.merge_invitation_grants(a jsonb, b jsonb)
returns jsonb
language sql immutable set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(x.k, x.id, 'level', x.lvl) order by x.k, x.id), '[]'::jsonb)
  from (
    select e.k, e.id, (array_agg(e.level order by private.grant_level_value(e.level) desc))[1] as lvl
    from (
      select case when el ? 'project_id' then 'project_id' else 'page_id' end as k,
             coalesce(el ->> 'project_id', el ->> 'page_id') as id,
             el ->> 'level' as level
      from jsonb_array_elements(coalesce(a, '[]'::jsonb) || coalesce(b, '[]'::jsonb)) el
    ) e
    group by e.k, e.id
  ) x;
$$;

revoke all on function private.live_invitations(text) from public, anon, authenticated;
revoke all on function private.merge_invitation_grants(jsonb, jsonb) from public, anon, authenticated;

-- Invita un correo con un rol y una lista de permisos ([{"project_id" | "page_id": uuid, "level": ...}]).
-- La hace el dueño o un admin activo; admins invita solo el dueño; cada permiso tiene que ser sobre algo en
-- lo que quien invita tiene 4. Devuelve el id de la invitación viva de ese correo.
create function public.create_invitation(p_email text, p_role text, p_grants jsonb default '[]'::jsonb)
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

  perform pg_advisory_xact_lock(hashtextextended('invitation:' || em, 0));
  select * into cur from private.live_invitations(em) i order by i.created_at, i.id limit 1;
  if found then
    update public.invitations
    set role = case when private.role_rank(p_role) > private.role_rank(cur.role) then p_role else cur.role end,
        grants = private.merge_invitation_grants(cur.grants, g),
        invited_by = uid,
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

-- Con la sesión de la persona: aplica sus invitaciones vivas (las de su correo verificado) y devuelve
-- cuántas. Crea su fila de `members`, o la reactiva si la habían sacado (con el rol de la invitación, y sin
-- los permisos que tenía antes: esos no vuelven); si ya es miembro activo, sube el rol si la invitación trae
-- uno más alto (nunca lo baja, y un `owner` nunca cambia). Suma los permisos (gana el más alto) y marca las
-- invitaciones como usadas. Se puede llamar siempre (en cada ingreso): sin invitaciones, no hace nada.
create function public.accept_invitations()
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
  n   int := 0;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
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
      delete from public.grants where user_id = uid;
      update public.members set role = inv.role, removed_at = null, added_by = inv.invited_by
      where user_id = uid;
    elsif cur.role <> 'owner' and private.role_rank(inv.role) > private.role_rank(cur.role) then
      update public.members set role = inv.role where user_id = uid;
    end if;

    for el in select * from jsonb_array_elements(inv.grants) loop
      if el ? 'project_id' then
        tgt := (el ->> 'project_id')::uuid;
        continue when not exists (select 1 from public.workspaces w where w.id = tgt);
        insert into public.grants as g (user_id, project_id, level, granted_by)
        values (uid, tgt, el ->> 'level', inv.invited_by)
        on conflict (user_id, project_id) where project_id is not null
        do update set level = excluded.level, granted_by = excluded.granted_by
        where private.grant_level_value(excluded.level) > private.grant_level_value(g.level);
      else
        tgt := (el ->> 'page_id')::uuid;
        continue when not exists (select 1 from public.pages pg where pg.id = tgt);
        insert into public.grants as g (user_id, page_id, level, granted_by)
        values (uid, tgt, el ->> 'level', inv.invited_by)
        on conflict (user_id, page_id) where page_id is not null
        do update set level = excluded.level, granted_by = excluded.granted_by
        where private.grant_level_value(excluded.level) > private.grant_level_value(g.level);
      end if;
    end loop;

    update public.invitations set used_at = now(), used_by = uid where id = inv.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.create_invitation(text, text, jsonb) from public, anon;
revoke all on function public.accept_invitations() from public, anon;
grant execute on function public.create_invitation(text, text, jsonb) to authenticated;
grant execute on function public.accept_invitations() to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Hook "Before User Created" de Supabase (queda sin conectar)
-- ---------------------------------------------------------------------------------------------------
-- Supabase Auth la llama antes de crear una cuenta (registro con código o link, invitación desde el panel,
-- proveedores externos, anónimos) con el evento {"metadata": {...}, "user": {"email": ..., ...}} y la
-- sesión de `supabase_auth_admin`. Devuelve {} para dejar crearla, o {"error": {"http_code", "message"}}
-- para rechazarla. Acepta solo los correos con una invitación viva. Crear usuarios con la API de
-- administración (`auth.admin.createUser`) no la llama. El mensaje empieza con "Signups not allowed" para
-- que la app lo muestre como el registro cerrado ("pedí una invitación").
-- Corre como dueño (definer) para leer `invitations` y `members` sin darle esas tablas a
-- `supabase_auth_admin`, que solo puede ejecutar esta función. Se conecta por la Management API
-- (Doc_Supabase.md, "Login"): primero el hook, probado; después se abre el registro.
create function private.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  em text := lower(btrim(event -> 'user' ->> 'email'));
begin
  if em is not null and em <> '' and exists (select 1 from private.live_invitations(em)) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'Signups not allowed for this email: ask the owner of this workspace for an invitation.'));
end;
$$;

revoke all on function private.hook_before_user_created(jsonb) from public, anon, authenticated;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.hook_before_user_created(jsonb) to supabase_auth_admin;

-- ---------------------------------------------------------------------------------------------------
-- Miembros y permisos (pantalla de miembros y diálogo de compartir)
-- ---------------------------------------------------------------------------------------------------
-- Todo por funciones: la API no escribe en `members`, `grants` ni `invitations`.
-- Errores: `not_allowed` (42501), `member_not_found` y `grant_not_found` (P0002), `owner_cannot_change`
-- (42501), `role_invalid`, `level_invalid` y `target_invalid` (22023).

-- El dueño y los admins activos ven a todos (también a los sacados); los demás, solo su fila.
create function public.list_members()
returns table (user_id uuid, email text, role text, created_at timestamptz, removed_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select m.user_id, u.email::text, m.role, m.created_at, m.removed_at
  from public.members m
  join auth.users u on u.id = m.user_id
  where coalesce(private.workspace_role() in ('owner', 'admin'), false) or m.user_id = (select auth.uid())
  order by m.removed_at is not null, m.created_at, m.user_id;
$$;

-- Cambia el rol de un miembro activo. Nadie cambia al dueño ni da el rol `owner`; a los admins (volver a
-- alguien admin o dejar de serlo) los maneja solo el dueño.
create function public.set_member_role(p_user uuid, p_role text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  my_role text := private.workspace_role();
  cur     public.members;
begin
  if my_role is null or my_role not in ('owner', 'admin') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('admin', 'member', 'guest') then
    raise exception 'role_invalid' using errcode = '22023';
  end if;
  select * into cur from public.members m where m.user_id = p_user and m.removed_at is null for update;
  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
  if cur.role = 'owner' then
    raise exception 'owner_cannot_change' using errcode = '42501';
  end if;
  if (cur.role = 'admin' or p_role = 'admin') and my_role <> 'owner' then
    raise exception 'not_allowed' using errcode = '42501', hint = 'Only the owner of the workspace manages admins.';
  end if;
  update public.members set role = p_role where user_id = p_user;
end;
$$;

-- Saca a alguien: pone `removed_at` (es la señal para su app) y no borra nada. Pierde todo al instante
-- (sus permisos y lo que creó dejan de contar). Los proyectos que creó y compartía con otra persona activa
-- pasan a un dueño o admin activo con permiso sobre ellos (primero quien lo tiene sobre el proyecto
-- entero, después el permiso más alto, después el dueño); si no hay ninguno, quedan como están y los
-- siguen viendo aquellos con quienes estaban compartidos. Los privados quedan a su nombre y nadie los ve.
-- Devuelve cuántos proyectos pasaron a otra persona. A alguien ya sacado: no hace nada y devuelve 0.
create function public.remove_member(p_user uuid)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  my_role text := private.workspace_role();
  cur     public.members;
  ws      uuid;
  heir    uuid;
  n       int := 0;
begin
  if my_role is null or my_role not in ('owner', 'admin') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select * into cur from public.members m where m.user_id = p_user for update;
  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
  if cur.removed_at is not null then
    return 0;
  end if;
  if cur.role = 'owner' then
    raise exception 'owner_cannot_change' using errcode = '42501';
  end if;
  if cur.role = 'admin' and my_role <> 'owner' then
    raise exception 'not_allowed' using errcode = '42501', hint = 'Only the owner of the workspace removes admins.';
  end if;

  update public.members set removed_at = now() where user_id = p_user;

  for ws in select w.id from public.workspaces w where w.owner_id = p_user order by w.created_at, w.id loop
    heir := null;
    select g.user_id into heir
    from public.grants g
    join public.members m on m.user_id = g.user_id and m.removed_at is null and m.role in ('owner', 'admin')
    where g.user_id <> p_user
      and (g.project_id = ws
           or g.page_id in (select pg.id from public.pages pg where pg.workspace_id = ws))
    order by (g.project_id is not null) desc, private.grant_level_value(g.level) desc,
             (m.role = 'owner') desc, g.created_at, g.user_id
    limit 1;
    if heir is not null then
      update public.workspaces set owner_id = heir where id = ws;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- ¿La sesión puede compartir este proyecto o esta página? Quien tiene 4 sobre eso y es dueño o admin, o
-- quien creó el proyecto (siendo miembro activo).
create function private.can_share(p_project uuid, p_page uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    when (p_project is null) = (p_page is null) then false
    when p_project is not null then
      private.project_level(p_project) >= 4
      and (coalesce(private.workspace_role() in ('owner', 'admin'), false)
           or exists (select 1 from public.workspaces w where w.id = p_project and w.owner_id = (select auth.uid())))
    else
      private.page_level(p_page) >= 4
      and (coalesce(private.workspace_role() in ('owner', 'admin'), false)
           or exists (select 1 from public.pages pg join public.workspaces w on w.id = pg.workspace_id
                      where pg.id = p_page and w.owner_id = (select auth.uid())))
  end;
$$;

revoke all on function private.can_share(uuid, uuid) from public, anon;
grant execute on function private.can_share(uuid, uuid) to authenticated;

-- Da (o cambia) el permiso de un miembro activo sobre un proyecto o una página (uno de los dos). Hay uno
-- por persona y proyecto o página: compartir de nuevo lo reemplaza (también para bajarlo). Devuelve el id
-- del permiso.
create function public.share(p_user uuid, p_project uuid, p_page uuid, p_level text)
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
    do update set level = excluded.level, granted_by = excluded.granted_by
    returning id into gid;
  else
    insert into public.grants (user_id, page_id, level, granted_by)
    values (p_user, p_page, p_level, auth.uid())
    on conflict (user_id, page_id) where page_id is not null
    do update set level = excluded.level, granted_by = excluded.granted_by
    returning id into gid;
  end if;
  return gid;
end;
$$;

-- Saca un permiso (con las mismas reglas que compartir).
create function public.unshare(p_grant uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  g public.grants;
begin
  select * into g from public.grants gr where gr.id = p_grant;
  if not found or not private.can_share(g.project_id, g.page_id) then
    raise exception 'grant_not_found' using errcode = 'P0002';
  end if;
  delete from public.grants where id = p_grant;
end;
$$;

-- Quién tiene acceso a un proyecto o a una página, con qué nivel y por qué: `creator` (quien creó el
-- proyecto), `project` (permiso sobre el proyecto), `page` (sobre esta página) o `parent_page` (sobre una
-- de arriba, que baja). Una fila por origen: el nivel de cada persona es el más alto de sus filas. Solo
-- miembros activos. Solo quien puede compartirlo.
create function public.list_access(p_project uuid, p_page uuid)
returns table (user_id uuid, email text, role text, level text, source text, grant_id uuid,
               project_id uuid, page_id uuid)
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
    access (uid, lvl, src, gid, prj, pag) as (
      select w.owner_id, 'edit_pages'::text, 'creator'::text, null::uuid, w.id, null::uuid
      from public.workspaces w where w.id = ws
      union all
      select g.user_id, g.level, 'project', g.id, g.project_id, null
      from public.grants g where g.project_id = ws
      union all
      select g.user_id, g.level, case when g.page_id = p_page then 'page' else 'parent_page' end, g.id, null, g.page_id
      from public.grants g where g.page_id in (select c.id from chain c)
    )
    select a.uid, u.email::text, m.role, a.lvl, a.src, a.gid, a.prj, a.pag
    from access a
    join public.members m on m.user_id = a.uid and m.removed_at is null
    join auth.users u on u.id = a.uid
    order by u.email, private.grant_level_value(a.lvl) desc, a.src;
end;
$$;

revoke all on function public.list_members() from public, anon;
revoke all on function public.set_member_role(uuid, text) from public, anon;
revoke all on function public.remove_member(uuid) from public, anon;
revoke all on function public.share(uuid, uuid, uuid, text) from public, anon;
revoke all on function public.unshare(uuid) from public, anon;
revoke all on function public.list_access(uuid, uuid) from public, anon;
grant execute on function public.list_members() to authenticated;
grant execute on function public.set_member_role(uuid, text) to authenticated;
grant execute on function public.remove_member(uuid) to authenticated;
grant execute on function public.share(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.unshare(uuid) to authenticated;
grant execute on function public.list_access(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Versión de la base
-- ---------------------------------------------------------------------------------------------------
update public.workspace_settings set schema_version = 4 where id and schema_version < 4;

notify pgrst, 'reload schema';
