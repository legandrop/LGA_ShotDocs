-- Pruebas de miembros, permisos e invitaciones (paso 5). Corre dentro de una transacción que se deshace al
-- final: no deja usuarios ni datos. Si todo pasa, devuelve una fila con result = 'ok'.

begin;

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Personas:
--   ow  dueña del workspace         ad  admin, sin proyectos         me  miembro con permisos por página
--   gu  invitada con permisos       rm  admin sacada, con un proyecto nx  sin membresía ni proyectos
--   cr  miembro con un proyecto propio
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-000000000101', 'ow@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000102', 'ad@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000103', 'me@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000104', 'gu@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000105', 'rm@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000106', 'nx@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000107', 'cr@test.invalid', 'authenticated', 'authenticated');

-- Si la base ya tiene dueño, queda fuera de la prueba (se deshace al final): hay un solo dueño activo.
update public.members set removed_at = now() where role = 'owner' and removed_at is null;

insert into public.members (user_id, role, removed_at) values
  ('00000000-0000-4000-8000-000000000101', 'owner', null),
  ('00000000-0000-4000-8000-000000000102', 'admin', null),
  ('00000000-0000-4000-8000-000000000103', 'member', null),
  ('00000000-0000-4000-8000-000000000104', 'guest', null),
  ('00000000-0000-4000-8000-000000000105', 'admin', now()),
  ('00000000-0000-4000-8000-000000000107', 'member', null);

-- La dueña crea su primer proyecto desde la API (por su rol, todavía no tiene ninguno).
select pg_temp.as_user('00000000-0000-4000-8000-000000000101');
insert into public.workspaces (id, name) values ('00000000-0000-4000-8000-000000000201', 'P1')
on conflict (id) do nothing
returning id;

select set_config('role', 'postgres', true);

-- P2 de cr y P4 de rm. En P1: r (raíz) › c › g, y s (otra raíz). En P2: q.
insert into public.workspaces (id, owner_id, name) values
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000107', 'P2'),
  ('00000000-0000-4000-8000-000000000204', '00000000-0000-4000-8000-000000000105', 'P4');
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000201', null, 'r', 'a0'),
  ('00000000-0000-4000-8000-000000000304', '00000000-0000-4000-8000-000000000201', null, 's', 'a1'),
  ('00000000-0000-4000-8000-000000000305', '00000000-0000-4000-8000-000000000202', null, 'q', 'a0');
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000201',
   '00000000-0000-4000-8000-000000000301', 'c', 'a0');
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  ('00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000201',
   '00000000-0000-4000-8000-000000000302', 'g', 'a0');

insert into public.grants (user_id, project_id, page_id, level) values
  -- me: comentar en c (vale para g), editar en g (gana el más alto), ver q.
  ('00000000-0000-4000-8000-000000000103', null, '00000000-0000-4000-8000-000000000302', 'comment'),
  ('00000000-0000-4000-8000-000000000103', null, '00000000-0000-4000-8000-000000000303', 'edit'),
  ('00000000-0000-4000-8000-000000000103', null, '00000000-0000-4000-8000-000000000305', 'view'),
  -- gu: ver todo P1 y editar y crear páginas en c.
  ('00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000201', null, 'view'),
  ('00000000-0000-4000-8000-000000000104', null, '00000000-0000-4000-8000-000000000302', 'edit_pages'),
  -- rm (sacada) y nx (sin membresía): permisos que no cuentan.
  ('00000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-000000000201', null, 'edit'),
  ('00000000-0000-4000-8000-000000000106', '00000000-0000-4000-8000-000000000201', null, 'edit');

insert into public.invitations (email, role, grants, invited_by) values
  ('cliente@test.invalid', 'guest',
   '[{"page_id": "00000000-0000-4000-8000-000000000301", "level": "comment"}]',
   '00000000-0000-4000-8000-000000000101');

select set_config('test.n_members', (select count(*) from public.members)::text, true);
select set_config('test.n_grants', (select count(*) from public.grants)::text, true);
select set_config('test.n_invitations', (select count(*) from public.invitations)::text, true);
select set_config('test.n_projects', (select count(*) from public.workspaces)::text, true);

-- Reglas de las tablas (como la base: la API no escribe en ellas).
do $$
declare
  ow constant uuid := '00000000-0000-4000-8000-000000000101';
  me constant uuid := '00000000-0000-4000-8000-000000000103';
  p1 constant uuid := '00000000-0000-4000-8000-000000000201';
  r  constant uuid := '00000000-0000-4000-8000-000000000301';
begin
  begin
    insert into public.members (user_id, role) values ('00000000-0000-4000-8000-000000000106', 'owner');
    raise exception 'FALLA: dos dueños activos';
  exception when unique_violation then null;
  end;
  begin
    insert into public.members (user_id, role) values ('00000000-0000-4000-8000-000000000106', 'boss');
    raise exception 'FALLA: members acepta un rol desconocido';
  exception when check_violation then null;
  end;
  begin
    insert into public.grants (user_id, project_id, level) values (me, p1, 'view');
    insert into public.grants (user_id, project_id, level) values (me, p1, 'edit');
    raise exception 'FALLA: dos permisos de la misma persona sobre el mismo proyecto';
  exception when unique_violation then null;
  end;
  begin
    insert into public.grants (user_id, page_id, level)
    values (me, '00000000-0000-4000-8000-000000000302', 'view');
    raise exception 'FALLA: dos permisos de la misma persona sobre la misma página';
  exception when unique_violation then null;
  end;
  begin
    insert into public.grants (user_id, project_id, page_id, level) values (me, p1, r, 'view');
    raise exception 'FALLA: un permiso sobre un proyecto y una página a la vez';
  exception when check_violation then null;
  end;
  begin
    insert into public.grants (user_id, level) values (me, 'view');
    raise exception 'FALLA: un permiso sin proyecto ni página';
  exception when check_violation then null;
  end;
  begin
    insert into public.grants (user_id, project_id, level) values (me, p1, 'owner');
    raise exception 'FALLA: grants acepta un permiso desconocido';
  exception when check_violation then null;
  end;

  begin
    insert into public.invitations (email, role) values ('Cliente@Test.invalid', 'guest');
    raise exception 'FALLA: una invitación con mayúsculas en el correo';
  exception when check_violation then null;
  end;
  begin
    insert into public.invitations (email, role) values ('x@test.invalid', 'owner');
    raise exception 'FALLA: se invita a alguien como dueño';
  exception when check_violation then null;
  end;
  begin
    insert into public.invitations (email, role, grants) values ('x@test.invalid', 'guest', '{}');
    raise exception 'FALLA: los permisos de una invitación no son una lista';
  exception when check_violation then null;
  end;
  begin
    insert into public.invitations (email, role, grants) values ('x@test.invalid', 'guest',
      jsonb_build_array(jsonb_build_object('project_id', p1, 'page_id', r, 'level', 'view')));
    raise exception 'FALLA: un permiso de invitación con proyecto y página';
  exception when check_violation then null;
  end;
  begin
    insert into public.invitations (email, role, grants) values ('x@test.invalid', 'guest',
      jsonb_build_array(jsonb_build_object('page_id', r, 'level', 'admin')));
    raise exception 'FALLA: un permiso de invitación desconocido';
  exception when check_violation then null;
  end;
  begin
    insert into public.invitations (email, role, grants) values ('x@test.invalid', 'guest',
      jsonb_build_array(jsonb_build_object('page_id', 'no-es-un-id', 'level', 'view')));
    raise exception 'FALLA: un permiso de invitación sin id válido';
  exception when check_violation then null;
  end;
  begin
    insert into public.invitations (email, role, grants) values ('x@test.invalid', 'guest',
      (select jsonb_agg(jsonb_build_object('page_id', r, 'level', 'view')) from generate_series(1, 201)));
    raise exception 'FALLA: una invitación con demasiados permisos';
  exception when check_violation then null;
  end;
  assert (select expires_at > now() + interval '29 days' from public.invitations
          where email = 'cliente@test.invalid'), 'la invitación no vence a los 30 días';

  begin
    update public.workspace_settings set local_key = 'Con Mayúsculas';
    raise exception 'FALLA: local_key acepta cualquier cosa';
  exception when check_violation then null;
  end;
  begin
    update public.workspace_settings set name = '';
    raise exception 'FALLA: el workspace queda sin nombre';
  exception when check_violation then null;
  end;
  begin
    update public.workspace_settings set name = repeat('x', 81);
    raise exception 'FALLA: el nombre del workspace no tiene tope';
  exception when check_violation then null;
  end;
  assert (select schema_version >= 2 from public.workspace_settings), 'schema_version no subió';
end;
$$;

-- Dueña y admin: ven todas las filas de las tres tablas, y nada se escribe desde la API.
create function pg_temp.check_sees_all(who text) returns void language plpgsql as $$
begin
  assert (select count(*) from public.members) = current_setting('test.n_members')::int,
    who || ' no ve todos los miembros';
  assert (select count(*) from public.grants) = current_setting('test.n_grants')::int,
    who || ' no ve todos los permisos';
  assert (select count(*) from public.invitations) = current_setting('test.n_invitations')::int,
    who || ' no ve las invitaciones';
end;
$$;

-- Nadie crea, cambia ni borra miembros, permisos o invitaciones desde la API (llega en el paso 9).
create function pg_temp.check_no_writes(who text) returns void language plpgsql as $$
declare
  self uuid := auth.uid();
begin
  begin
    insert into public.members (user_id, role) values (self, 'admin');
    raise exception 'FALLA: % inserta en members', who;
  exception when insufficient_privilege then null;
  end;
  begin
    update public.members set role = 'owner', removed_at = null;
    raise exception 'FALLA: % cambia members', who;
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.members;
    raise exception 'FALLA: % borra en members', who;
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.grants (user_id, project_id, level)
    values (self, '00000000-0000-4000-8000-000000000201', 'edit_pages');
    raise exception 'FALLA: % inserta en grants', who;
  exception when insufficient_privilege then null;
  end;
  begin
    update public.grants set level = 'edit_pages';
    raise exception 'FALLA: % cambia grants', who;
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.grants;
    raise exception 'FALLA: % borra en grants', who;
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.invitations (email, role) values ('otro@test.invalid', 'admin');
    raise exception 'FALLA: % inserta en invitations', who;
  exception when insufficient_privilege then null;
  end;
  begin
    update public.invitations set used_at = now();
    raise exception 'FALLA: % cambia invitations', who;
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.invitations;
    raise exception 'FALLA: % borra en invitations', who;
  exception when insufficient_privilege then null;
  end;
  begin
    update public.workspace_settings set name = 'Otro';
    raise exception 'FALLA: % cambia el nombre del workspace', who;
  exception when insufficient_privilege then null;
  end;
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-000000000101');
do $$
declare
  p1 constant uuid := '00000000-0000-4000-8000-000000000201';
  p2 constant uuid := '00000000-0000-4000-8000-000000000202';
begin
  perform pg_temp.check_sees_all('la dueña');
  perform pg_temp.check_no_writes('la dueña');
  assert private.workspace_role() = 'owner', 'la dueña no figura como owner';
  assert public.media_whoami() ->> 'role' = 'owner', 'media_whoami no dice el rol';
  assert public.ensure_workspace() = p1, 'ensure_workspace no devuelve el proyecto de la dueña';
  assert private.page_level('00000000-0000-4000-8000-000000000303') = 4, 'la dueña no edita su página';
  assert private.project_level(p1) = 4, 'la dueña no tiene su proyecto';
  -- Los proyectos privados de otros no son de la dueña.
  assert private.project_level(p2) = 0, 'la dueña tiene permiso sobre el proyecto de otro';
  assert private.page_level('00000000-0000-4000-8000-000000000305') = 0,
    'la dueña tiene permiso sobre una página de otro';
  assert private.page_level(gen_random_uuid()) = 0, 'una página que no existe da permiso';
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-000000000102');
do $$
declare
  f constant uuid := '00000000-0000-4000-8000-000000000206';
  n int;
begin
  perform pg_temp.check_sees_all('el admin');
  perform pg_temp.check_no_writes('el admin');
  assert public.ensure_workspace() is null, 'el admin sin proyectos recibe uno';

  -- Un admin crea proyectos aunque no tenga ninguno, y reintentar el mismo id no falla.
  insert into public.workspaces (id, name) values (f, 'Del admin') on conflict (id) do nothing;
  get diagnostics n = row_count;
  assert n = 1, 'el admin no crea un proyecto';
  insert into public.workspaces (id, name) values (f, 'Del admin') on conflict (id) do nothing;
  assert (select owner_id from public.workspaces where id = f) = '00000000-0000-4000-8000-000000000102',
    'el proyecto del admin no es suyo';
  assert public.ensure_workspace() = f, 'ensure_workspace no devuelve el proyecto nuevo del admin';
end;
$$;
-- Reintento con la fila devuelta, como la API.
insert into public.workspaces (id, name) values ('00000000-0000-4000-8000-000000000206', 'Del admin')
on conflict (id) do nothing
returning id;

-- Miembro con permisos por página: ve solo su fila y sus permisos.
select pg_temp.as_user('00000000-0000-4000-8000-000000000103');
do $$
declare
  r  constant uuid := '00000000-0000-4000-8000-000000000301';
  c  constant uuid := '00000000-0000-4000-8000-000000000302';
  g  constant uuid := '00000000-0000-4000-8000-000000000303';
  s  constant uuid := '00000000-0000-4000-8000-000000000304';
  q  constant uuid := '00000000-0000-4000-8000-000000000305';
  p1 constant uuid := '00000000-0000-4000-8000-000000000201';
  n  int;
begin
  assert (select count(*) from public.members) = 1, 'el miembro ve otros miembros';
  assert (select user_id from public.members) = auth.uid(), 'el miembro no ve su fila';
  assert (select count(*) from public.grants) = 3, 'el miembro no ve solo sus permisos';
  assert (select count(*) from public.grants where user_id <> auth.uid()) = 0, 'el miembro ve permisos ajenos';
  assert (select count(*) from public.invitations) = 0, 'el miembro ve invitaciones';
  perform pg_temp.check_no_writes('el miembro');

  -- Hacia abajo sí, hacia arriba no; si hay varios, gana el más alto.
  assert private.page_level(c) = 2, 'comentar en c';
  assert private.page_level(g) = 3, 'en g gana editar sobre comentar';
  assert private.page_level(r) = 0, 'un permiso sobre c sube a r';
  assert private.page_level(s) = 0, 'un permiso sobre c pasa a otra rama';
  assert private.page_level(q) = 1, 'ver q';
  assert private.project_level(p1) = 0, 'un permiso sobre una página sube al proyecto';

  -- Las políticas de hoy no cambian en este paso: todavía no ve las páginas compartidas.
  assert (select count(*) from public.pages) = 0, 'las políticas de pages cambiaron';

  -- Sin proyectos propios ni rol de admin, no crea proyectos; ensure_workspace no crea nada.
  assert public.ensure_workspace() = p1, 'ensure_workspace no devuelve el proyecto de una página compartida';
  begin
    insert into public.workspaces (id, name) values (gen_random_uuid(), 'No') on conflict (id) do nothing;
    raise exception 'FALLA: un miembro sin proyectos crea uno';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- Invitada: permiso sobre todo P1 y uno más alto sobre c.
select pg_temp.as_user('00000000-0000-4000-8000-000000000104');
do $$
declare
  p1 constant uuid := '00000000-0000-4000-8000-000000000201';
  p2 constant uuid := '00000000-0000-4000-8000-000000000202';
begin
  assert (select count(*) from public.members) = 1, 'la invitada ve otros miembros';
  assert (select count(*) from public.grants) = 2, 'la invitada no ve solo sus permisos';
  assert private.page_level('00000000-0000-4000-8000-000000000301') = 1, 'el proyecto no baja a r';
  assert private.page_level('00000000-0000-4000-8000-000000000304') = 1, 'el proyecto no baja a s';
  assert private.page_level('00000000-0000-4000-8000-000000000302') = 4, 'en c no gana el más alto';
  assert private.page_level('00000000-0000-4000-8000-000000000303') = 4, 'el permiso de c no baja a g';
  assert private.page_level('00000000-0000-4000-8000-000000000305') = 0, 'la invitada ve otro proyecto';
  assert private.project_level(p1) = 1, 'ver P1';
  assert private.project_level(p2) = 0, 'la invitada tiene permiso sobre P2';
  assert public.ensure_workspace() = p1, 'ensure_workspace no devuelve el proyecto compartido';
  begin
    insert into public.workspaces (id, name) values (gen_random_uuid(), 'No');
    raise exception 'FALLA: una invitada crea un proyecto';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- Admin sacada: ve su fila (la señal de que la sacaron) y nada de lo del dueño y los admins; sus permisos
-- no cuentan y no crea proyectos aunque tenga uno propio, que sigue siendo suyo como hoy.
select pg_temp.as_user('00000000-0000-4000-8000-000000000105');
do $$
begin
  assert (select count(*) from public.members) = 1, 'la sacada ve otros miembros';
  assert (select removed_at is not null from public.members), 'la sacada no ve que la sacaron';
  assert (select count(*) from public.grants) = 1, 'la sacada ve permisos ajenos';
  assert (select count(*) from public.invitations) = 0, 'la sacada ve invitaciones';
  assert private.workspace_role() is null, 'la sacada todavía tiene rol';
  assert public.media_whoami() ->> 'role' is null, 'media_whoami da rol a la sacada';
  assert private.page_level('00000000-0000-4000-8000-000000000301') = 0, 'los permisos de la sacada cuentan';
  assert private.project_level('00000000-0000-4000-8000-000000000201') = 0, 'la sacada tiene P1';
  assert private.project_level('00000000-0000-4000-8000-000000000204') = 4, 'la sacada perdió su proyecto';
  assert public.ensure_workspace() = '00000000-0000-4000-8000-000000000204',
    'ensure_workspace no devuelve el proyecto de la sacada';
  perform pg_temp.check_no_writes('la sacada');
  begin
    insert into public.workspaces (id, name) values (gen_random_uuid(), 'No');
    raise exception 'FALLA: una admin sacada crea un proyecto';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- Sin membresía ni proyectos: nada, ensure_workspace da null y no crea proyectos.
select pg_temp.as_user('00000000-0000-4000-8000-000000000106');
do $$
begin
  assert (select count(*) from public.members) = 0, 'alguien sin membresía ve miembros';
  assert (select count(*) from public.grants) = 1, 'alguien sin membresía no ve solo sus permisos';
  assert (select count(*) from public.invitations) = 0, 'alguien sin membresía ve invitaciones';
  assert private.page_level('00000000-0000-4000-8000-000000000301') = 0, 'sin membresía, un permiso cuenta';
  assert public.ensure_workspace() is null, 'ensure_workspace devuelve algo a quien no tiene nada';
  assert public.ensure_workspace() is null, 'ensure_workspace no es estable';
  assert (select count(*) from public.workspaces) = 0, 'alguien sin nada ve proyectos';
  perform pg_temp.check_no_writes('alguien sin membresía');
  begin
    insert into public.workspaces (id, name) values (gen_random_uuid(), 'No') on conflict (id) do nothing;
    raise exception 'FALLA: alguien sin proyectos ni rol crea uno';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- Miembro que ya tiene un proyecto: crea otro y reintenta el mismo id (con la fila devuelta, como la API).
select pg_temp.as_user('00000000-0000-4000-8000-000000000107');
select set_config('test.cr_first', public.ensure_workspace()::text, true);
insert into public.workspaces (id, name) values ('00000000-0000-4000-8000-000000000207', 'Otro de cr')
on conflict (id) do nothing
returning id;
insert into public.workspaces (id, name) values ('00000000-0000-4000-8000-000000000207', 'Otro de cr')
on conflict (id) do nothing
returning id;
do $$
begin
  assert current_setting('test.cr_first') = '00000000-0000-4000-8000-000000000202',
    'ensure_workspace no devuelve el proyecto de cr';
  assert (select count(*) from public.workspaces) = 2, 'cr no ve sus dos proyectos';
  assert public.ensure_workspace() = '00000000-0000-4000-8000-000000000202',
    'ensure_workspace cambió al crear otro proyecto';
  -- Reusar el id de un proyecto ajeno no da acceso.
  insert into public.workspaces (id, name) values ('00000000-0000-4000-8000-000000000201', 'Copia')
  on conflict (id) do nothing;
  assert (select count(*) from public.workspaces) = 2, 'cr tomó un proyecto ajeno reusando su id';
end;
$$;

-- ensure_workspace no creó proyectos: solo están los de la prueba (P1 de la dueña, el del admin y el
-- segundo de cr, más P2 y P4).
select set_config('role', 'postgres', true);
do $$
begin
  assert (select count(*) from public.workspaces) = current_setting('test.n_projects')::int + 2,
    'se crearon proyectos de más';
  assert (select name from public.workspaces where id = '00000000-0000-4000-8000-000000000201') = 'P1',
    'se cambió un proyecto al reusar su id';
end;
$$;

-- Sin sesión: nada.
select set_config('role', 'anon', true);
do $$
begin
  begin
    perform 1 from public.members;
    raise exception 'FALLA: anon lee members';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.grants;
    raise exception 'FALLA: anon lee grants';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.invitations;
    raise exception 'FALLA: anon lee invitations';
  exception when insufficient_privilege then null;
  end;
end;
$$;

rollback;

select 'ok' as result;
