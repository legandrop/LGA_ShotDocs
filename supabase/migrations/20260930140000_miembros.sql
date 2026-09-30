-- LGA Shot Docs · miembros, permisos e invitaciones (paso 5 de Docs/Plan_Workspaces.md, sección 11).
--
-- Prepara el equipo sin cambiar lo que ve nadie: las tablas nuevas y las funciones que dicen el rol de una
-- persona y su permiso sobre una página o un proyecto. Las políticas de lectura y escritura de `pages`,
-- `page_updates`, `workspaces` y de los archivos siguen igual hasta el paso 9; lo único que cambia hoy es
-- que `ensure_workspace()` ya no crea "My project" y que crear proyectos queda para quien ya tiene alguno
-- o es dueño o admin del workspace.
--
-- Nombres: la tabla `workspaces` guarda proyectos (historia). Las tablas nuevas no dicen "workspace".

-- ---------------------------------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------------------------------

-- Persona y rol en el workspace. Sacar a alguien no borra la fila: se marca `removed_at`, y esa es la
-- señal que la app va a usar para borrar lo del workspace en el dispositivo (paso 9).
create table public.members (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null check (role in ('owner', 'admin', 'member', 'guest')),
  added_by   uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  removed_at timestamptz
);

-- Un solo dueño activo a la vez (el de `workspace_settings.owner_id`).
create unique index members_one_owner on public.members (role)
  where role = 'owner' and removed_at is null;

-- Permiso de una persona sobre un proyecto o una página. Vale para lo que tiene debajo, nunca para lo de
-- arriba; si hay varios sobre la misma página, gana el más alto (ver private.page_level).
create table public.grants (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.workspaces (id) on delete cascade,
  page_id    uuid references public.pages (id) on delete cascade,
  level      text not null check (level in ('view', 'comment', 'edit', 'edit_pages')),
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint grants_one_target check ((project_id is null) <> (page_id is null))
);

-- Uno por persona y proyecto, y uno por persona y página: cambiar el permiso es cambiar la fila.
create unique index grants_user_project_key on public.grants (user_id, project_id)
  where project_id is not null;
create unique index grants_user_page_key on public.grants (user_id, page_id)
  where page_id is not null;
create index grants_project_idx on public.grants (project_id) where project_id is not null;
create index grants_page_idx on public.grants (page_id) where page_id is not null;

-- ¿La lista de permisos de una invitación tiene la forma esperada? Cada elemento es un objeto con
-- exactamente dos claves: `project_id` o `page_id` (un uuid) y `level`. Con topes de cantidad y tamaño.
create function private.invitation_grants_valid(g jsonb)
returns boolean
language sql immutable set search_path = ''
as $$
  select case
    when g is null or jsonb_typeof(g) <> 'array' then false
    when jsonb_array_length(g) > 200 or length(g::text) > 20000 then false
    else not exists (
      select 1
      from jsonb_array_elements(g) e
      where case
        when jsonb_typeof(e) <> 'object' then true
        when (e ? 'project_id') = (e ? 'page_id') then true
        when (select count(*) from jsonb_object_keys(e)) <> 2 then true
        when jsonb_typeof(e -> 'level') is distinct from 'string'
          or e ->> 'level' not in ('view', 'comment', 'edit', 'edit_pages') then true
        when jsonb_typeof(coalesce(e -> 'project_id', e -> 'page_id')) is distinct from 'string'
          or coalesce(e ->> 'project_id', e ->> 'page_id')
             !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then true
        else false
      end
    )
  end;
$$;

revoke all on function private.invitation_grants_valid(jsonb) from public, anon;
grant execute on function private.invitation_grants_valid(jsonb) to authenticated;

-- Invitaciones: el correo (en minúsculas), el rol y los permisos que va a recibir quien entre con ella.
-- Las crea y las usa el paso 9 (el control de entrada con el hook "Before User Created" de Supabase).
create table public.invitations (
  id         uuid primary key default gen_random_uuid(),
  email      text not null
             check (email = lower(btrim(email)) and length(email) between 3 and 320 and email like '%_@_%'),
  role       text not null check (role in ('admin', 'member', 'guest')),
  grants     jsonb not null default '[]'::jsonb check (private.invitation_grants_valid(grants)),
  invited_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  used_at    timestamptz,
  used_by    uuid references auth.users (id) on delete set null,
  constraint invitations_used check (used_by is null or used_at is not null)
);
create index invitations_email_idx on public.invitations (email);

-- ---------------------------------------------------------------------------------------------------
-- Permisos: funciones auxiliares
-- ---------------------------------------------------------------------------------------------------
-- Corren como definer (leen las tablas sin pasar por sus políticas, así una política que las llama no se
-- llama a sí misma) y con search_path vacío.

-- El rol de una persona en el workspace; null si no es miembro o si la sacaron.
create function private.workspace_role(uid uuid default auth.uid())
returns text
language sql stable security definer set search_path = ''
as $$
  select m.role from public.members m where m.user_id = uid and m.removed_at is null;
$$;

-- El número de cada permiso, para quedarse con el más alto: 1 ver, 2 comentar, 3 editar, 4 editar y crear
-- páginas.
create function private.grant_level_value(level text)
returns int
language sql immutable set search_path = ''
as $$
  select case level
    when 'view' then 1
    when 'comment' then 2
    when 'edit' then 3
    when 'edit_pages' then 4
    else 0
  end;
$$;

-- El permiso de la sesión sobre una página: 0 nada, 1 ver, 2 comentar, 3 editar, 4 editar y crear páginas.
-- El más alto entre: 4 si creó el proyecto de la página (la regla de hoy), el permiso sobre ese proyecto y
-- los permisos sobre la página o cualquiera de las de arriba. Los permisos cuentan solo si la persona es
-- miembro y no la sacaron; ser quien creó el proyecto vale igual que hoy.
create function private.page_level(p uuid)
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
  select greatest(
    coalesce((select 4 from target t where t.owner_id = (select auth.uid())), 0),
    coalesce((
      select max(private.grant_level_value(g.level))
      from public.grants g
      where g.user_id = (select auth.uid())
        and private.workspace_role(g.user_id) is not null
        and (g.project_id = (select t.workspace_id from target t)
             or g.page_id in (select c.id from chain c))
    ), 0));
$$;

-- El permiso de la sesión sobre un proyecto entero (misma escala). Un permiso sobre una página de adentro
-- no da nada sobre el proyecto: los permisos valen hacia abajo, nunca hacia arriba.
create function private.project_level(ws uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select greatest(
    coalesce((select 4 from public.workspaces w where w.id = ws and w.owner_id = (select auth.uid())), 0),
    coalesce((
      select max(private.grant_level_value(g.level))
      from public.grants g
      where g.user_id = (select auth.uid())
        and g.project_id = ws
        and private.workspace_role(g.user_id) is not null
    ), 0));
$$;

-- ¿La sesión puede crear un proyecto? Quien ya creó alguno (si no lo sacaron del workspace) o el dueño y
-- los admins. El corte completo (solo dueño y admins) llega con las políticas del paso 9.
create function private.can_create_project()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.workspace_role() in ('owner', 'admin'), false)
      or (
        exists (select 1 from public.workspaces w where w.owner_id = (select auth.uid()))
        and not exists (
          select 1 from public.members m
          where m.user_id = (select auth.uid()) and m.removed_at is not null)
      );
$$;

revoke all on function private.workspace_role(uuid) from public, anon;
revoke all on function private.grant_level_value(text) from public, anon;
revoke all on function private.page_level(uuid) from public, anon;
revoke all on function private.project_level(uuid) from public, anon;
revoke all on function private.can_create_project() from public, anon;
grant execute on function private.workspace_role(uuid) to authenticated;
grant execute on function private.grant_level_value(text) to authenticated;
grant execute on function private.page_level(uuid) to authenticated;
grant execute on function private.project_level(uuid) to authenticated;
grant execute on function private.can_create_project() to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Row Level Security: en este paso las tres tablas solo se leen desde la API
-- ---------------------------------------------------------------------------------------------------
-- Cada persona ve su fila de `members` (también si la sacaron: es la señal para la app) y sus permisos.
-- El dueño y los admins que no fueron sacados ven todo. Crear, cambiar y borrar llega con las funciones
-- del paso 9.

alter table public.members enable row level security;
alter table public.grants enable row level security;
alter table public.invitations enable row level security;

create policy members_select on public.members
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.workspace_role()) in ('owner', 'admin'));

create policy grants_select on public.grants
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.workspace_role()) in ('owner', 'admin'));

create policy invitations_select on public.invitations
  for select to authenticated
  using ((select private.workspace_role()) in ('owner', 'admin'));

revoke all on public.members, public.grants, public.invitations from public, anon, authenticated;
grant select on public.members, public.grants, public.invitations to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Crear proyectos
-- ---------------------------------------------------------------------------------------------------
-- Como antes, el dueño es siempre quien lo crea, y ahora además tiene que poder crear proyectos. La app
-- crea con `insert ... on conflict do nothing` (y la API devuelve la fila): un reintento con el mismo id
-- vuelve a pasar por esta política y por la de lectura, y quien ya tiene proyectos la sigue cumpliendo.

drop policy workspaces_insert on public.workspaces;
create policy workspaces_insert on public.workspaces
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select private.can_create_project()));

-- ---------------------------------------------------------------------------------------------------
-- ensure_workspace: ya no crea "My project"
-- ---------------------------------------------------------------------------------------------------
-- Devuelve el primer proyecto que la persona puede ver, o null. Primero los que creó (el más viejo: lo
-- mismo que devolvía antes a quien ya tenía proyectos); si no, uno con permiso sobre el proyecto entero, y
-- si no, el proyecto de una página que le compartieron. Las versiones anteriores de la app guardan lo que
-- devuelve como su proyecto: solo las usa gente que ya tiene proyectos, así que para ellas no cambia nada.
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

  select w.id into ws
  from public.workspaces w
  where w.owner_id = uid
  order by w.created_at, w.id
  limit 1;
  if ws is not null or private.workspace_role(uid) is null then
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
-- Ajustes del workspace: nombre, clave local y versión de la base
-- ---------------------------------------------------------------------------------------------------
--   name       El nombre del workspace (el de Lega: Wanka).
--   local_key  Cómo se llama lo guardado en los dispositivos para este workspace. Viaja en los links de
--              invitación y una copia restaurada en otro proyecto de Supabase la conserva. En una base
--              nueva queda vacía y la completa el comando de instalación (paso 12).
-- Siguen siendo de solo lectura para la app, como el resto de la fila.
alter table public.workspace_settings
  add column name text not null default 'Workspace'
    check (length(btrim(name)) >= 1 and length(name) <= 80),
  add column local_key text check (local_key is null or local_key ~ '^[a-z0-9_-]{4,64}$');

-- Una instalación que ya existía (tiene dueño) es Wanka: su clave local es el ref de su proyecto de
-- Supabase, fijo como texto, que es el nombre que ya tiene lo guardado en sus dispositivos y nunca cambia.
update public.workspace_settings
set name = 'Wanka', local_key = 'znlvpuddswymxpffgvbz'
where id and owner_id is not null and local_key is null;

update public.workspace_settings set schema_version = 2 where id and schema_version < 2;

-- ---------------------------------------------------------------------------------------------------
-- Cuentas que ya existen
-- ---------------------------------------------------------------------------------------------------
-- El dueño del workspace entra como `owner`. Cada otra cuenta con proyectos propios entra como `member`,
-- con `edit_pages` sobre cada uno de sus proyectos, para que no pierda nada cuando lleguen las políticas
-- del paso 9. No se borra ninguna cuenta. Se puede correr dos veces sin duplicar nada.

insert into public.members (user_id, role)
select s.owner_id, 'owner'
from public.workspace_settings s
where s.id and s.owner_id is not null
on conflict (user_id) do nothing;

insert into public.members (user_id, role)
select distinct w.owner_id, 'member'
from public.workspaces w
on conflict (user_id) do nothing;

insert into public.grants (user_id, project_id, level)
select w.owner_id, w.id, 'edit_pages'
from public.workspaces w
where w.owner_id is distinct from (select s.owner_id from public.workspace_settings s where s.id)
on conflict (user_id, project_id) where project_id is not null do nothing;

-- ---------------------------------------------------------------------------------------------------
-- Portero: suma el rol (sin sacar nada: el portero publicado lee `user_id` e `is_owner`)
-- ---------------------------------------------------------------------------------------------------
create or replace function public.media_whoami()
returns json
language sql stable security definer set search_path = ''
as $$
  select json_build_object(
    'user_id', auth.uid(),
    'is_owner', coalesce((select s.owner_id = auth.uid() from public.workspace_settings s where s.id), false),
    'role', private.workspace_role(auth.uid()));
$$;

notify pgrst, 'reload schema';
