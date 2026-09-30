-- Pruebas de los ajustes del workspace (generación, versión mínima) y de la subida de contenido según la
-- versión de la app. Corre dentro de una transacción que se deshace al final: no deja usuarios ni datos.
-- Si todo pasa, devuelve una fila con result = 'ok'.

begin;

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-00000000000a', 'rls-a@test.invalid', 'authenticated', 'authenticated');

select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
select set_config('test.ws_a', public.ensure_workspace()::text, true);
insert into public.pages (id, workspace_id, title, sort_key) values
  ('00000000-0000-4000-8000-0000000000a1', current_setting('test.ws_a')::uuid, 'Raíz A', 'a0');

do $$
declare
  a1 constant uuid := '00000000-0000-4000-8000-0000000000a1';
  u  constant text := 'AQAAAA==';  -- un update de Yjs vacío (4 bytes), alcanza para la prueba
  s  bigint;
begin
  -- Todos leen los ajustes; nadie los cambia desde la API.
  assert (select count(*) from public.workspace_settings) = 1, 'no se ven los ajustes del workspace';
  assert (select generation from public.workspace_settings) >= 1, 'generación inválida';

  begin
    update public.workspace_settings set generation = generation + 1;
    raise exception 'FALLA: un usuario cambia la generación';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.workspace_settings (id) values (true);
    raise exception 'FALLA: un usuario inserta ajustes del workspace';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.workspace_settings;
    raise exception 'FALLA: un usuario borra los ajustes del workspace';
  exception when insufficient_privilege then null;
  end;

  -- Sin versión mínima: suben la función vieja (3 parámetros) y la nueva (con versión).
  s := public.push_page_update(a1, gen_random_uuid(), u);
  assert s = 1, 'la función vieja no sube sin mínimo';
  s := public.push_page_update(a1, gen_random_uuid(), u, '0.021');
  assert s = 2, 'la función nueva no sube sin mínimo';
end;
$$;

-- El dueño de la base pone una versión mínima.
select set_config('role', 'postgres', true);
update public.workspace_settings set min_app_version = 0.021;
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');

do $$
declare
  a1 constant uuid := '00000000-0000-4000-8000-0000000000a1';
  u  constant text := 'AQAAAA==';
  s  bigint;
  retry constant uuid := gen_random_uuid();
begin
  begin
    perform public.push_page_update(a1, gen_random_uuid(), u);
    raise exception 'FALLA: la función vieja sube con versión mínima';
  exception when raise_exception then
    assert sqlerrm = 'app_outdated', 'la función vieja falla por otra cosa: ' || sqlerrm;
  end;

  begin
    perform public.push_page_update(a1, gen_random_uuid(), u, '0.020');
    raise exception 'FALLA: sube una versión menor a la mínima';
  exception when raise_exception then
    assert sqlerrm = 'app_outdated', 'una versión vieja falla por otra cosa: ' || sqlerrm;
  end;

  begin
    perform public.push_page_update(a1, gen_random_uuid(), u, 'abc');
    raise exception 'FALLA: sube una versión ilegible';
  exception when raise_exception then
    assert sqlerrm = 'app_outdated', 'una versión ilegible falla por otra cosa: ' || sqlerrm;
  end;

  begin
    perform public.push_page_update(a1, gen_random_uuid(), u, null);
    raise exception 'FALLA: sube sin versión';
  exception when raise_exception then
    assert sqlerrm = 'app_outdated', 'sin versión falla por otra cosa: ' || sqlerrm;
  end;

  s := public.push_page_update(a1, retry, u, '0.021');
  assert s = 3, 'la versión mínima no sube';
  assert public.push_page_update(a1, retry, u, '0.030') = 3, 'un reintento duplicó el update';
  assert public.push_page_update(a1, gen_random_uuid(), u, '1.2') = 4, 'una versión mayor no sube';
end;
$$;

-- Sin sesión: nada.
select set_config('role', 'anon', true);

do $$
begin
  perform 1 from public.workspace_settings;
  raise exception 'FALLA: anon lee workspace_settings';
exception when insufficient_privilege then null;
end;
$$;

do $$
begin
  perform public.push_page_update('00000000-0000-4000-8000-0000000000a1', gen_random_uuid(), 'AQAAAA==', '9.9');
  raise exception 'FALLA: anon llama a push_page_update';
exception when insufficient_privilege then null;
end;
$$;

-- Portero: quién soy y si soy el dueño. Nadie cambia el dueño ni la dirección del portero desde la API.
select set_config('role', 'postgres', true);
update public.workspace_settings set owner_id = '00000000-0000-4000-8000-00000000000a';
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-00000000000b', 'rls-b@test.invalid', 'authenticated', 'authenticated');

select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
do $$
begin
  assert (public.media_whoami() ->> 'is_owner')::boolean, 'el dueño no figura como dueño';
  assert public.media_whoami() ->> 'user_id' = '00000000-0000-4000-8000-00000000000a', 'user_id equivocado';
  begin
    update public.workspace_settings set media_url = 'https://otro.example';
    raise exception 'FALLA: un usuario cambia la dirección del portero';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-00000000000b');
do $$
begin
  assert not (public.media_whoami() ->> 'is_owner')::boolean, 'otro usuario figura como dueño';
  begin
    update public.workspace_settings set owner_id = '00000000-0000-4000-8000-00000000000b';
    raise exception 'FALLA: un usuario se hace dueño';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('role', 'postgres', true);
do $$
begin
  begin
    update public.workspace_settings set media_url = 'http://sin-https.example';
    raise exception 'FALLA: media_url acepta http';
  exception when check_violation then null;
  end;
end;
$$;

select set_config('role', 'anon', true);
do $$
begin
  perform public.media_whoami();
  raise exception 'FALLA: anon llama a media_whoami';
exception when insufficient_privilege then null;
end;
$$;

rollback;

select 'ok' as result;
