-- Pruebas de los proyectos favoritos (20261120120000_proyectos_favoritos.sql): cada persona marca solo proyectos que
-- ve y solo con su propio `user_id`; ve y borra solo sus filas; un anónimo y una sesión con contraseña no tocan nada; el
-- embebido de `workspaces` trae solo las propias; y borrar el proyecto borra sus filas. Corre dentro de una transacción
-- que se deshace al final: no deja usuarios ni datos. Si todo pasa, devuelve una fila con result = 'ok'.

begin;

-- D14 (`clean_min_version`) está prendido en la base desde el 2026-11-06. Esta prueba baja `min_app_version` y
-- chocaría con `workspace_settings_clean_min_le_min_app`: se apaga acá, dentro de la transacción que se deshace.
update public.workspace_settings set clean_min_version = null where id;

select set_config('request.headers', '{"x-shotdocs-version": "9.999"}', true);

create function pg_temp.as_user(uid uuid, method text default 'otp') returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', uid, 'role', 'authenticated',
                                      'amr', json_build_array(json_build_object('method', method, 'timestamp', 1)))::text, true);
$$;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-00000000000a', 'fav-a@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000000b', 'fav-b@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000000c', 'fav-c@test.invalid', 'authenticated', 'authenticated');
insert into public.members (user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'admin'),
  ('00000000-0000-4000-8000-00000000000b', 'member'),
  ('00000000-0000-4000-8000-00000000000c', 'member');
insert into public.workspaces (id, owner_id, name) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000000a', 'Uno'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-00000000000a', 'Dos');
-- B ve el proyecto Uno (Ver); C no ve nada.
insert into public.grants (user_id, project_id, page_id, level) values
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000000e1', null, 'view');

-- A marca los dos; no puede marcar uno a nombre de B.
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
do $$
begin
  insert into public.project_favorites (project_id) values ('00000000-0000-4000-8000-0000000000e1');
  insert into public.project_favorites (project_id) values ('00000000-0000-4000-8000-0000000000e2');
  -- Marcar dos veces no duplica (como lo manda la app).
  insert into public.project_favorites (project_id) values ('00000000-0000-4000-8000-0000000000e1') on conflict do nothing;
  assert (select count(*) from public.project_favorites) = 2, 'A no ve sus dos favoritos';
  begin
    insert into public.project_favorites (user_id, project_id)
      values ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000000e1');
    raise exception 'FALLA: A marcó un favorito a nombre de B';
  exception when insufficient_privilege then null;
  end;
  -- El embebido trae el favorito.
  assert (select count(*) from public.workspaces w
          where exists (select 1 from public.project_favorites f where f.project_id = w.id)) = 2,
    'A no ve sus favoritos junto a los proyectos';
end;
$$;

-- B: marca el que ve, no el que no ve; no ve ni borra los de A.
select pg_temp.as_user('00000000-0000-4000-8000-00000000000b');
do $$
declare
  n int;
begin
  assert (select count(*) from public.project_favorites) = 0, 'B ve los favoritos de A';
  insert into public.project_favorites (project_id) values ('00000000-0000-4000-8000-0000000000e1');
  begin
    insert into public.project_favorites (project_id) values ('00000000-0000-4000-8000-0000000000e2');
    raise exception 'FALLA: B marcó un proyecto que no ve';
  exception when insufficient_privilege then null;
  end;
  delete from public.project_favorites where user_id = '00000000-0000-4000-8000-00000000000a';
  get diagnostics n = row_count;
  assert n = 0, 'B borró favoritos de A';
  begin
    update public.project_favorites set project_id = '00000000-0000-4000-8000-0000000000e2';
    raise exception 'FALLA: B pudo cambiar una fila de favoritos';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- C no ve ningún proyecto: no marca nada. Con contraseña, A no ve ni marca nada.
select pg_temp.as_user('00000000-0000-4000-8000-00000000000c');
do $$
begin
  insert into public.project_favorites (project_id) values ('00000000-0000-4000-8000-0000000000e1');
  raise exception 'FALLA: C marcó un proyecto que no ve';
exception when insufficient_privilege then null;
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-00000000000a', 'password');
do $$
begin
  assert (select count(*) from public.project_favorites) = 0, 'una sesión con contraseña ve favoritos';
  insert into public.project_favorites (project_id) values ('00000000-0000-4000-8000-0000000000e1');
  raise exception 'FALLA: una sesión con contraseña marcó un favorito';
exception when insufficient_privilege then null;
end;
$$;

select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role": "anon"}', true);
do $$
begin
  perform count(*) from public.project_favorites;
  raise exception 'FALLA: un anónimo lee favoritos';
exception when insufficient_privilege then null;
end;
$$;

-- A desmarca uno; borrar del todo el proyecto Uno borra sus filas.
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
delete from public.project_favorites where project_id = '00000000-0000-4000-8000-0000000000e2';

select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
do $$
begin
  assert (select count(*) from public.project_favorites
          where project_id in ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000e2')) = 2, 'los favoritos no quedaron como se esperaba';
  delete from public.workspaces where id = '00000000-0000-4000-8000-0000000000e1';
  assert (select count(*) from public.project_favorites
          where project_id in ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000e2')) = 0, 'borrar el proyecto dejó favoritos';
  assert (select schema_version from public.workspace_settings where id) >= 30, 'schema_version no llegó a 30';
end;
$$;

rollback;

select 'ok' as result;
