-- Pruebas de permisos de los ajustes (por rama y por cuenta). Corre dentro de una transacción que se
-- deshace al final: no deja usuarios ni datos. Si todo pasa, devuelve una fila con result = 'ok'.

begin;

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-00000000000a', 'rls-a@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000000b', 'rls-b@test.invalid', 'authenticated', 'authenticated');

-- El proyecto de A lo crea la base (ensure_workspace ya no crea proyectos).
insert into public.workspaces (id, owner_id) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000000a');

-- A: una página con ajustes y sus preferencias.
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
select set_config('test.ws_a', public.ensure_workspace()::text, true);

insert into public.pages (id, workspace_id, title, sort_key, settings) values
  ('00000000-0000-4000-8000-0000000000a1', current_setting('test.ws_a')::uuid, 'Raíz A', 'a0',
   '{"header": {"levels": 2}}');
insert into public.user_settings (prefs) values ('{"theme": "dark"}');

do $$
declare
  a1 constant uuid := '00000000-0000-4000-8000-0000000000a1';
begin
  assert (select settings -> 'header' ->> 'levels' from public.pages where id = a1) = '2',
    'no se guardaron los ajustes al crear';

  begin
    update public.pages set updated_at = now() - interval '1 hour' where id = a1;
    raise exception 'FALLA: updated_at se puede editar desde la API';
  exception when insufficient_privilege then null;
  end;

  update public.pages set settings = '{"split": false}' where id = a1;
  assert (select settings ->> 'split' from public.pages where id = a1) = 'false', 'no cambió settings';

  begin
    update public.pages set settings = '[]' where id = a1;
    raise exception 'FALLA: settings acepta algo que no es un objeto';
  exception when check_violation then null;
  end;

  begin
    update public.pages set settings = jsonb_build_object('x', repeat('y', 3000)) where id = a1;
    raise exception 'FALLA: settings acepta objetos enormes';
  exception when check_violation then null;
  end;

  assert (select prefs ->> 'theme' from public.user_settings) = 'dark', 'A no ve sus preferencias';
  update public.user_settings set prefs = '{"theme": "light"}';
  assert (select prefs ->> 'theme' from public.user_settings) = 'light', 'A no cambia sus preferencias';

  begin
    insert into public.user_settings (user_id, prefs)
    values ('00000000-0000-4000-8000-00000000000b', '{}');
    raise exception 'FALLA: A crea preferencias a nombre de B';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.user_settings set user_id = '00000000-0000-4000-8000-00000000000b';
    raise exception 'FALLA: A cambia el dueño de sus preferencias';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.user_settings;
    raise exception 'FALLA: se pueden borrar preferencias desde la API';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- B: no ve ni toca lo de A.
select pg_temp.as_user('00000000-0000-4000-8000-00000000000b');

do $$
begin
  assert (select count(*) from public.user_settings) = 0, 'B ve las preferencias de A';
  update public.user_settings set prefs = '{"theme": "system"}';
  update public.pages set settings = '{}' where id = '00000000-0000-4000-8000-0000000000a1';
  insert into public.user_settings (prefs) values ('{"font": "editorial"}');
  assert (select count(*) from public.user_settings) = 1, 'B no puede crear las suyas';
end;
$$;

select set_config('role', 'postgres', true);

do $$
begin
  assert (select prefs ->> 'theme' from public.user_settings
          where user_id = '00000000-0000-4000-8000-00000000000a') = 'light',
    'B cambió las preferencias de A';
  assert (select settings ->> 'split' from public.pages
          where id = '00000000-0000-4000-8000-0000000000a1') = 'false',
    'B cambió los ajustes de una página de A';
end;
$$;

-- Sin sesión: nada.
select set_config('role', 'anon', true);

do $$
begin
  perform 1 from public.user_settings;
  raise exception 'FALLA: anon lee user_settings';
exception when insufficient_privilege then null;
end;
$$;

rollback;

select 'ok' as result;
