-- Pruebas de la versión mínima en compartir e invitar (20261106120000_version_minima_equipo.sql): con una mínima de
-- 0.099 o más, una app sin header, con un header menor o ilegible no escribe `grants`, `members` ni `invitations` por
-- ninguna función (503 `app_outdated`, y nada de lo que la función había hecho queda); repetir lo ya hecho y leer
-- siguen andando; el permiso va antes; la mínima y las mayores escriben todo; la consola y la clave de servicio no se
-- frenan. Corre dentro de una transacción que se deshace al final: no deja usuarios ni datos. Si todo pasa, devuelve
-- una fila con result = 'ok'.

begin;

-- La sesión de una persona, con el header de la versión que mandaría su app (`version` null: una app sin header).
create function pg_temp.as_user(uid uuid, version text default '9.999') returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', uid, 'role', 'authenticated')::text, true),
         set_config('request.headers',
                    case when version is null then json_build_object('accept', '*/*')
                         else json_build_object('accept', '*/*', 'x-shotdocs-version', version) end::text, true);
$$;

create function pg_temp.as_console() returns void language sql as $$
  select set_config('role', 'postgres', true),
         set_config('request.jwt.claims', '', true),
         set_config('request.headers', '', true);
$$;

-- Corre `stmt` y exige que falle con ese mensaje o ese código (sqlstate).
create function pg_temp.expect_error(stmt text, expected text, what text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm = expected or sqlstate = expected then
      return;
    end if;
    raise exception 'FALLA: % (dio % %)', what, sqlstate, sqlerrm;
  end;
  raise exception 'FALLA: %', what;
end;
$$;

-- Corre `stmt` y exige el rechazo por versión: sqlstate PGRST, mensaje `app_outdated` y estado 503.
create function pg_temp.expect_outdated(stmt text, what text) returns void language plpgsql as $$
declare
  d text;
begin
  begin
    execute stmt;
  exception when others then
    get stacked diagnostics d = pg_exception_detail;
    if sqlstate = 'PGRST' and (sqlerrm::json ->> 'message') = 'app_outdated' and (d::json ->> 'status') = '503' then
      return;
    end if;
    raise exception 'FALLA: % (dio % % / %)', what, sqlstate, sqlerrm, d;
  end;
  raise exception 'FALLA: % (no rechazó)', what;
end;
$$;

-- La huella de todo lo que estas funciones escriben (las tres tablas enteras y el reinicio de las páginas de la
-- prueba), como lo ve la consola: si un rechazo cambia algo, cambia.
create function pg_temp.team_print() returns text language sql security definer as $$
  select md5(
    coalesce((select string_agg(g::text, '|' order by g.id) from public.grants g), '') || '#' ||
    coalesce((select string_agg(m::text, '|' order by m.user_id) from public.members m), '') || '#' ||
    coalesce((select string_agg(i::text, '|' order by i.id) from public.invitations i), '') || '#' ||
    coalesce((select string_agg(p.id::text || ':' || p.clean_reset_seq, '|' order by p.id)
              from public.pages p where p.workspace_id = '00000000-0000-4000-8000-0000000d1e09'), ''));
$$;

-- Personas: o (dueña del workspace y del proyecto P), ad (admin), me (miembro), gu (invitada), rm (miembro, para
-- sacarla) y nu (sin fila en `members`, con una invitación).
insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000d1a01', 'vme-o@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000d1a02', 'vme-ad@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000d1a03', 'vme-me@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000d1a04', 'vme-gu@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000d1a05', 'vme-rm@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000d1a06', 'vme-nu@test.invalid', 'authenticated', 'authenticated', now());
update public.members set removed_at = now() where role = 'owner' and removed_at is null;
update public.workspace_settings set owner_id = '00000000-0000-4000-8000-0000000d1a01', min_app_version = null;
insert into public.members (user_id, role) values
  ('00000000-0000-4000-8000-0000000d1a01', 'owner'),
  ('00000000-0000-4000-8000-0000000d1a02', 'admin'),
  ('00000000-0000-4000-8000-0000000d1a03', 'member'),
  ('00000000-0000-4000-8000-0000000d1a04', 'guest'),
  ('00000000-0000-4000-8000-0000000d1a05', 'member');
insert into public.workspaces (id, owner_id, name) values
  ('00000000-0000-4000-8000-0000000d1e09', '00000000-0000-4000-8000-0000000d1a01', 'P');
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  ('00000000-0000-4000-8000-0000000d1d01', '00000000-0000-4000-8000-0000000d1e09', null, 'p1', 'a0'),
  ('00000000-0000-4000-8000-0000000d1d02', '00000000-0000-4000-8000-0000000d1e09', null, 'p2', 'a1');

-- ---------------------------------------------------------------------------------------------------
-- Los triggers y su función.
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  assert (select count(*) from pg_trigger t
          where not t.tgisinternal and t.tgfoid = 'private.team_write_version()'::regprocedure
            and t.tgrelid in ('public.grants'::regclass, 'public.members'::regclass, 'public.invitations'::regclass)) = 6,
    'no están los seis triggers';
  assert (select p.prosecdef and p.proconfig @> array['search_path=""']
          from pg_proc p where p.oid = 'private.team_write_version()'::regprocedure), 'el trigger no fija search_path';
  assert not has_function_privilege('authenticated', 'private.team_write_version()', 'execute'), 'authenticated llama al trigger';
  assert not has_function_privilege('anon', 'private.team_write_version()', 'execute'), 'anon llama al trigger';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Sin mínima: todo anda, con header y sin header. Queda armado lo que sigue: un permiso de me sobre p1 (g1), una
-- invitación viva de o (i1) y una para nu (i2).
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000d1a01', null);
do $$
declare
  o  constant uuid := '00000000-0000-4000-8000-0000000d1a01';
  me constant uuid := '00000000-0000-4000-8000-0000000d1a03';
  rm constant uuid := '00000000-0000-4000-8000-0000000d1a05';
  p1 constant uuid := '00000000-0000-4000-8000-0000000d1d01';
  p2 constant uuid := '00000000-0000-4000-8000-0000000d1d02';
  g  uuid;
  i  uuid;
begin
  g := public.share(me, null, p1, 'edit');
  perform set_config('test.g1', g::text, true);
  g := public.share(rm, null, p2, 'view');
  perform public.unshare(g);
  i := public.create_invitation('vme-otro@test.invalid', 'member', '[]');
  perform set_config('test.i1', i::text, true);
  i := public.create_invitation('vme-borrar@test.invalid', 'member', '[]');
  perform public.revoke_invitation(i);
  perform set_config('test.i0', i::text, true);
  i := public.create_invitation('vme-nu@test.invalid', 'member', jsonb_build_array(jsonb_build_object('page_id', p2, 'level', 'comment')));
  perform set_config('test.i2', i::text, true);
  perform public.set_member_role(rm, 'guest');
  perform public.set_member_role(rm, 'member');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Mínima menor a 0.099: con header se compara; sin header anda (quien llama puede ser una versión permitida).
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_console();
update public.workspace_settings set min_app_version = 0.099 - 0.001;
do $$
declare
  o  constant uuid := '00000000-0000-4000-8000-0000000d1a01';
  gu constant uuid := '00000000-0000-4000-8000-0000000d1a04';
  p2 constant uuid := '00000000-0000-4000-8000-0000000d1d02';
  before text := pg_temp.team_print();
begin
  perform pg_temp.as_user(o, '0.001');
  perform pg_temp.expect_outdated(format('select public.share(%L, null, %L, %L)', gu, p2, 'view'), 'mínima menor: comparte con un header más viejo');
  assert pg_temp.team_print() = before, 'mínima menor: un rechazo escribió algo';
  perform pg_temp.as_user(o, null);
  perform public.share(gu, null, p2, 'view');
  assert pg_temp.team_print() <> before, 'mínima menor: sin header no compartió';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Mínima 0.099 o más: sin header, con un header menor o ilegible, nada de esto escribe.
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_console();
update public.workspace_settings set min_app_version = 0.099;
do $$
declare
  o  constant uuid := '00000000-0000-4000-8000-0000000d1a01';
  ad constant uuid := '00000000-0000-4000-8000-0000000d1a02';
  me constant uuid := '00000000-0000-4000-8000-0000000d1a03';
  gu constant uuid := '00000000-0000-4000-8000-0000000d1a04';
  rm constant uuid := '00000000-0000-4000-8000-0000000d1a05';
  nu constant uuid := '00000000-0000-4000-8000-0000000d1a06';
  ws constant uuid := '00000000-0000-4000-8000-0000000d1e09';
  p1 constant uuid := '00000000-0000-4000-8000-0000000d1d01';
  g1 constant uuid := current_setting('test.g1')::uuid;
  i0 constant uuid := current_setting('test.i0')::uuid;
  i1 constant uuid := current_setting('test.i1')::uuid;
  before text := pg_temp.team_print();
  v  text;
begin
  foreach v in array array[null, '0.098', 'abc', ''] loop
    perform pg_temp.as_user(o, v);
    -- Compartir: un permiso nuevo (sobre una página y sobre el proyecto), cambiar uno que hay, y sacarlo.
    perform pg_temp.expect_outdated(format('select public.share(%L, null, %L, %L)', rm, p1, 'view'), 'comparte una página');
    perform pg_temp.expect_outdated(format('select public.share(%L, %L, null, %L)', gu, ws, 'comment'), 'comparte el proyecto');
    perform pg_temp.expect_outdated(format('select public.share(%L, null, %L, %L)', me, p1, 'view'), 'cambia un permiso');
    perform pg_temp.expect_outdated(format('select public.unshare(%L)', g1), 'saca un permiso');
    -- Invitar: una invitación nueva, sumar a la propia y revocarla.
    perform pg_temp.expect_outdated($q$select public.create_invitation('vme-nueva@test.invalid', 'guest', '[]')$q$, 'invita');
    perform pg_temp.expect_outdated(
      format('select public.create_invitation(%L, %L, %L)', 'vme-otro@test.invalid', 'member',
             jsonb_build_array(jsonb_build_object('page_id', p1, 'level', 'view'))),
      'suma a su invitación');
    perform pg_temp.expect_outdated(format('select public.revoke_invitation(%L)', i1), 'revoca una invitación');
    -- Roles y sacar a alguien.
    perform pg_temp.expect_outdated(format('select public.set_member_role(%L, %L)', rm, 'guest'), 'cambia un rol');
    perform pg_temp.expect_outdated(format('select public.set_member_role(%L, %L)', me, 'admin'), 'vuelve admin a alguien');
    perform pg_temp.expect_outdated(format('select public.remove_member(%L)', rm), 'saca a alguien');
    -- Aceptar una invitación (crea la fila de `members`, da el permiso y marca la invitación).
    perform pg_temp.as_user(nu, v);
    perform pg_temp.expect_outdated('select public.accept_invitations()', 'acepta una invitación');
    perform pg_temp.as_console();
    assert pg_temp.team_print() = before, format('con la versión %s, un rechazo escribió algo', coalesce(v, '(sin header)'));

    -- Repetir lo que ya está hecho no escribe, y anda: el mismo permiso de la misma persona, lo ya revocado, el mismo
    -- rol, y aceptar sin invitaciones.
    perform pg_temp.as_user(o, v);
    assert public.share(me, null, p1, 'edit') = g1, 'repetir el mismo permiso dio otro id';
    perform public.revoke_invitation(i0);
    perform public.set_member_role(rm, 'member');
    perform pg_temp.as_user(ad, v);
    assert public.accept_invitations() = 0, 'aceptar sin invitaciones no dio 0';
    -- Leer sigue andando.
    perform pg_temp.as_user(o, v);
    assert (select count(*) from public.list_members()) >= 5, 'la lista de miembros no anda';
    assert (select count(*) from public.list_invitations()) >= 2, 'la lista de invitaciones no anda';
    assert (select count(*) from public.list_access(null, p1)) >= 2, 'la lista de accesos no anda';
    -- El permiso va antes que la versión: quien no puede recibe el error de siempre.
    perform pg_temp.as_user(me, v);
    perform pg_temp.expect_error(format('select public.share(%L, null, %L, %L)', gu, p1, 'view'), 'not_allowed', 'un miembro comparte');
    perform pg_temp.expect_error($q$select public.create_invitation('vme-x@test.invalid', 'guest', '[]')$q$, 'not_allowed', 'un miembro invita');
    perform pg_temp.expect_error(format('select public.remove_member(%L)', rm), 'not_allowed', 'un miembro saca a alguien');
    perform pg_temp.expect_error(format('select public.unshare(%L)', g1), 'grant_not_found', 'un miembro saca un permiso');
    perform pg_temp.as_user(ad, v);
    perform pg_temp.expect_error(format('select public.set_member_role(%L, %L)', me, 'admin'), 'not_allowed', 'una admin nombra admins');
    perform pg_temp.expect_error(format('select public.revoke_invitation(%L)', i1), 'invitation_not_found', 'una admin revoca la de otra');
    perform pg_temp.as_console();
    assert pg_temp.team_print() = before, format('con la versión %s, repetir o un rechazo de permisos escribió algo', coalesce(v, '(sin header)'));
  end loop;
end;
$$;

-- La mínima y las mayores escriben todo.
do $$
declare
  o  constant uuid := '00000000-0000-4000-8000-0000000d1a01';
  me constant uuid := '00000000-0000-4000-8000-0000000d1a03';
  gu constant uuid := '00000000-0000-4000-8000-0000000d1a04';
  rm constant uuid := '00000000-0000-4000-8000-0000000d1a05';
  nu constant uuid := '00000000-0000-4000-8000-0000000d1a06';
  ws constant uuid := '00000000-0000-4000-8000-0000000d1e09';
  p1 constant uuid := '00000000-0000-4000-8000-0000000d1d01';
  p2 constant uuid := '00000000-0000-4000-8000-0000000d1d02';
  g1 constant uuid := current_setting('test.g1')::uuid;
  i1 constant uuid := current_setting('test.i1')::uuid;
  i  uuid;
begin
  perform pg_temp.as_user(o, '0.099');
  perform public.share(rm, null, p1, 'view');
  perform public.share(gu, ws, null, 'comment');
  assert public.share(me, null, p1, 'view') = g1, 'cambiar un permiso dio otro id';
  perform public.unshare(g1);
  i := public.create_invitation('vme-nueva@test.invalid', 'guest', '[]');
  assert public.create_invitation('vme-otro@test.invalid', 'member',
                                  jsonb_build_array(jsonb_build_object('page_id', p1, 'level', 'view'))) = i1,
    'sumar a la invitación dio otra';
  perform public.revoke_invitation(i1);
  perform public.set_member_role(rm, 'guest');
  perform pg_temp.as_user(o, '1.500');
  perform public.set_member_role(me, 'admin');
  perform public.remove_member(rm);
  perform pg_temp.as_user(nu, '0.099');
  assert public.accept_invitations() = 1, 'con la versión mínima no aceptó la invitación';
  perform pg_temp.as_console();
  assert (select level from public.grants where id = g1) = 'view' and (select revoked_at is not null from public.grants where id = g1),
    'con la versión mínima no cambió ni sacó el permiso';
  assert (select removed_at is not null from public.members where user_id = rm), 'con la versión mínima no sacó a nadie';
  assert (select role from public.members where user_id = me) = 'admin', 'con la versión mínima no cambió el rol';
  assert (select role from public.members where user_id = nu and removed_at is null) = 'member', 'la invitada no quedó como miembro';
  assert exists (select 1 from public.grants where user_id = nu and page_id = p2 and level = 'comment' and revoked_at is null),
    'la invitada no recibió su permiso';
  assert (select revoked_at is not null from public.invitations where id = i1), 'con la versión mínima no revocó';
end;
$$;

-- La consola, las migraciones y la clave de servicio (sin sesión de la app) no se frenan, con la mínima puesta.
select pg_temp.as_console();
do $$
begin
  insert into public.grants (user_id, page_id, level) values
    ('00000000-0000-4000-8000-0000000d1a04', '00000000-0000-4000-8000-0000000d1d01', 'view');
  update public.members set role = 'member' where user_id = '00000000-0000-4000-8000-0000000d1a03';
  update public.invitations set expires_at = now() + interval '1 day' where id = current_setting('test.i2')::uuid;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  update public.grants set level = 'comment'
  where user_id = '00000000-0000-4000-8000-0000000d1a04' and page_id = '00000000-0000-4000-8000-0000000d1d01';
  update public.members set role = 'guest' where user_id = '00000000-0000-4000-8000-0000000d1a03';
end;
$$;

-- Sin sesión: nada.
select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  perform pg_temp.expect_error('select private.team_write_version()', '42501', 'anon llama al trigger');
  perform pg_temp.expect_error(
    format('select public.share(%L, null, %L, %L)', '00000000-0000-4000-8000-0000000d1a04', '00000000-0000-4000-8000-0000000d1d01', 'edit'),
    '42501', 'anon comparte');
  perform pg_temp.expect_error($q$select public.create_invitation('vme-anon@test.invalid', 'guest', '[]')$q$, '42501', 'anon invita');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d1a01');
do $$
begin
  perform pg_temp.expect_error('select private.team_write_version()', '42501', 'una sesión llama al trigger');
  perform pg_temp.expect_error(
    $q$insert into public.grants (user_id, page_id, level) values ('00000000-0000-4000-8000-0000000d1a05', '00000000-0000-4000-8000-0000000d1d02', 'edit')$q$,
    '42501', 'una sesión escribe grants directo');
  perform pg_temp.expect_error($q$update public.members set role = 'admin'$q$, '42501', 'una sesión escribe members directo');
  perform pg_temp.expect_error($q$update public.invitations set role = 'admin'$q$, '42501', 'una sesión escribe invitations directo');
end;
$$;

rollback;

select 'ok' as result;
