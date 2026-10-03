-- Pruebas del plan B del MCP (20261027120000_mcp_plan_b.sql, Docs/Doc_Asistente.md, "Cómo quedó M0", paso 2). Imita lo
-- que hace PostgREST antes de cada pedido (el rol, `request.jwt.claims`, `request.path` y `request.headers`, y después
-- `private.mcp_pre_request()`): una sesión de la app, el visitante del link público y `service_role` pasan siempre; un
-- token con `client_id` pasa solo a `/rpc/mcp_*`. Storage: las fotos y miniaturas no se suben ni se ven con un token
-- de asistente. Corre dentro de una transacción que se deshace al final: no deja usuarios ni datos. Si todo pasa,
-- devuelve una fila con result = 'ok'.

begin;

-- El pedido como lo arma PostgREST. `claims` null = sin JWT (texto vacío); `ruta` null = sin ruta.
create function pg_temp.req(rol text, claims text, ruta text, headers text default '{}') returns void
language sql as $$
  select set_config('role', rol, true),
         set_config('request.jwt.claims', coalesce(claims, ''), true),
         set_config('request.path', coalesce(ruta, ''), true),
         set_config('request.headers', headers, true);
$$;

-- true si el pre-request deja pasar, false si rechaza con mcp_route_not_allowed (42501). Otro error, falla la prueba.
create function pg_temp.pasa(rol text, claims text, ruta text, headers text default '{}') returns boolean
language plpgsql as $$
begin
  perform pg_temp.req(rol, claims, ruta, headers);
  begin
    perform private.mcp_pre_request();
  exception when others then
    if sqlstate = '42501' and sqlerrm = 'mcp_route_not_allowed' then
      perform set_config('role', 'postgres', true);
      return false;
    end if;
    raise exception 'FALLA: el pre-request tiró otro error (% %) con % en %', sqlstate, sqlerrm, claims, ruta;
  end;
  perform set_config('role', 'postgres', true);
  return true;
end;
$$;

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

-- ---------------------------------------------------------------------------------------------------
-- La conexión con PostgREST y los permisos
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  assert exists (select 1 from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
                 where r.rolname = 'authenticator' and s.setdatabase = 0
                   and 'pgrst.db_pre_request=private.mcp_pre_request' = any (s.setconfig)),
    'authenticator no tiene pgrst.db_pre_request';
  -- Sin estos permisos, todo pedido de ese rol a PostgREST falla.
  assert has_function_privilege('anon', 'private.mcp_pre_request()', 'execute')
     and has_function_privilege('authenticated', 'private.mcp_pre_request()', 'execute')
     and has_function_privilege('service_role', 'private.mcp_pre_request()', 'execute'),
    'falta execute del pre-request para anon, authenticated o service_role';
  assert has_schema_privilege('anon', 'private', 'usage')
     and has_schema_privilege('authenticated', 'private', 'usage')
     and has_schema_privilege('service_role', 'private', 'usage'),
    'falta usage en private para anon, authenticated o service_role';
  assert not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                     where p.oid = 'private.mcp_pre_request()'::regprocedure and a.grantee = 0),
    'PUBLIC puede ejecutar el pre-request';
  assert has_function_privilege('authenticated', 'public.mcp_ping()', 'execute')
     and not has_function_privilege('anon', 'public.mcp_ping()', 'execute'),
    'mcp_ping: authenticated sí, anon no';
  assert not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                     where p.oid = 'public.mcp_ping()'::regprocedure and a.grantee = 0),
    'PUBLIC puede ejecutar mcp_ping';
  -- El pre-request no escribe: corre también en los pedidos GET, que son de solo lectura.
  assert (select provolatile from pg_proc where oid = 'private.mcp_pre_request()'::regprocedure) = 's',
    'el pre-request no es stable';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- El pre-request
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  app text := '{"aud":"authenticated","sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated","aal":"aal1",'
              '"amr":[{"method":"otp","timestamp":1790996400}],"session_id":"4b938a09-5372-4177-a314-cfa292099ea2",'
              '"is_anonymous":false,"user_metadata":{},"app_metadata":{"provider":"email"}}';
  -- Una sesión de la app con "client_id" en los metadatos: no es un token de asistente.
  app_meta text := '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated",'
                   '"user_metadata":{"client_id":"x"},"app_metadata":{"note":"client_id"}}';
  oauth text := '{"aud":"authenticated","sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated",'
                '"aal":"aal1","amr":[{"method":"oauth_provider/authorization_code","timestamp":1790996400}],'
                '"session_id":"5b938a09-5372-4177-a314-cfa292099ea2","is_anonymous":false,'
                '"client_id":"9a1b2c3d-0000-4000-8000-000000000001"}';
  vacio text := '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated","client_id":""}';
  nulo text := '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated","client_id":null}';
  ruta text;
begin
  -- La sesión de la app pasa a todo, como hoy (también sin ruta y a /rpc/graphql).
  foreach ruta in array array['/rpc/share', '/pages', '/rpc/pull_page_updates', '/rpc/push_page_update', '/rpc/graphql',
                              '/workspaces', '/', '', '/rpc/mcp_ping'] loop
    assert pg_temp.pasa('authenticated', app, nullif(ruta, '')), format('la sesión de la app no pasa a %s', ruta);
    assert pg_temp.pasa('authenticated', app_meta, nullif(ruta, '')),
      format('la sesión con client_id en los metadatos no pasa a %s', ruta);
  end loop;

  -- Sin JWT (anon), con el header del link público o sin él, y la clave publicable (claims con solo el rol).
  foreach ruta in array array['/rpc/plink_open', '/pages', '/rpc/share', '/'] loop
    assert pg_temp.pasa('anon', null, ruta), format('anon sin JWT no pasa a %s', ruta);
    assert pg_temp.pasa('anon', '{"role":"anon"}', ruta, '{"x-shotdocs-link":"tok","x-shotdocs-version":"9.999"}'),
      format('el link público no pasa a %s', ruta);
  end loop;
  assert pg_temp.pasa('anon', null, null), 'anon sin JWT ni ruta no pasa';
  assert pg_temp.pasa('service_role', '{"role":"service_role"}', '/pages'), 'service_role no pasa';

  -- El token de un asistente: solo /rpc/mcp_<minúsculas, números y _>.
  assert pg_temp.pasa('authenticated', oauth, '/rpc/mcp_ping'), 'el token OAuth no pasa a mcp_ping';
  assert pg_temp.pasa('authenticated', oauth, '/rpc/mcp_pull_page'), 'el token OAuth no pasa a mcp_pull_page';
  assert pg_temp.pasa('authenticated', oauth, '/rpc/mcp_list_projects2'), 'el token OAuth no pasa a mcp_list_projects2';
  foreach ruta in array array['/rpc/share', '/pages', '/rpc/pull_page_updates', '/rpc/push_page_update',
                              '/rpc/graphql', '/rpc/MCP_ping', '/rpc/Mcp_ping', '/rpc/mcp_', '/rpc/mcp_ping/',
                              '/rpc/mcp_../share', '/rpc/mcp_ping/../share', '/rpc/mcp-ping', '/rpc/mcp_ping;x',
                              '/rest/v1/rpc/share', 'rpc/mcp_ping', '/rpc/mcp_ping' || chr(10), '/', '/workspaces',
                              '/rpc/share?x=/rpc/mcp_ping', '/storage/v1/object'] loop
    assert not pg_temp.pasa('authenticated', oauth, ruta), format('el token OAuth pasa a %s', ruta);
  end loop;
  assert not pg_temp.pasa('authenticated', oauth, null), 'el token OAuth pasa sin ruta';
  -- Un client_id vacío o null también es un token de asistente.
  assert not pg_temp.pasa('authenticated', vacio, '/pages'), 'client_id vacío pasa a /pages';
  assert pg_temp.pasa('authenticated', vacio, '/rpc/mcp_ping'), 'client_id vacío no pasa a mcp_ping';
  assert not pg_temp.pasa('authenticated', nulo, '/pages'), 'client_id null pasa a /pages';
  -- Unos claims que no se pueden leer: si dicen client_id, cerrado; si no, como una sesión común.
  assert not pg_temp.pasa('authenticated', '{"client_id": "x"', '/pages'), 'claims rotos con client_id pasan';
  assert pg_temp.pasa('authenticated', '{"client_id": "x"', '/rpc/mcp_ping'), 'claims rotos con client_id no pasan a mcp_ping';
  assert pg_temp.pasa('authenticated', '{"role": "authenticated"', '/pages'), 'claims rotos sin client_id no pasan';
  assert not pg_temp.pasa('authenticated', '["client_id"]', '/pages'), 'claims que no son un objeto pasan';
end;
$$;

-- El error que ve quien llama: 42501 con el mensaje y una pista, nada más.
do $$
begin
  perform pg_temp.req('authenticated', '{"sub":"00000000-0000-4000-8000-00000000000a","client_id":"c"}', '/pages');
  begin
    perform private.mcp_pre_request();
    raise exception 'FALLA: no rechazó';
  exception when sqlstate '42501' then
    null;
  end;
  perform set_config('role', 'postgres', true);
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- mcp_ping
-- ---------------------------------------------------------------------------------------------------
select pg_temp.req('authenticated',
  '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated","client_id":"c"}', '/rpc/mcp_ping');
do $$
begin
  assert public.mcp_ping() = '00000000-0000-4000-8000-00000000000a'::uuid, 'mcp_ping no da la persona del token';
end;
$$;
select pg_temp.req('anon', null, '/rpc/mcp_ping');
do $$
begin
  perform pg_temp.expect_error('select public.mcp_ping()', '42501', 'anon ejecuta mcp_ping');
end;
$$;
select set_config('role', 'postgres', true);

-- ---------------------------------------------------------------------------------------------------
-- Storage: fotos (page-files) y miniaturas (thumbs)
-- ---------------------------------------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-00000000000a', 'mcp-a@test.invalid', 'authenticated', 'authenticated');
insert into public.members (user_id, role) values ('00000000-0000-4000-8000-00000000000a', 'member');
insert into public.workspaces (id, owner_id, name) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000000a', 'Proyecto MCP');
insert into public.pages (id, workspace_id, title, sort_key) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1', 'a1', 'a0');
-- f1 tiene miniatura subida por la app; f2 todavía no (para ver que el asistente no la puede subir: el nombre es válido,
-- `.jpg` como pide `private.thumb_file_id`, así que solo lo frena la condición de `client_id`).
insert into public.files (id, project_id, name, mime, size, created_by) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000e1', 'x.jpg', 'image/jpeg', 1,
   '00000000-0000-4000-8000-00000000000a'),
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000e1', 'y.jpg', 'image/jpeg', 1,
   '00000000-0000-4000-8000-00000000000a');
insert into public.page_files (page_id, file_id) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000f1'),
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000f2');

-- Con la sesión de la app: sube y ve, como hoy.
select pg_temp.req('authenticated',
  '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}', '');
insert into storage.objects (bucket_id, name) values ('page-files', '00000000-0000-4000-8000-0000000000a1/foto.jpg');
insert into storage.objects (bucket_id, name) values ('thumbs', '00000000-0000-4000-8000-0000000000f1.jpg');
do $$
begin
  assert (select count(*) from storage.objects where bucket_id = 'page-files') = 1, 'la app no ve su foto';
  assert (select count(*) from storage.objects where bucket_id = 'thumbs') = 1, 'la app no ve su miniatura';
end;
$$;

-- Con el token de un asistente de la misma persona: no ve ni sube nada (tampoco con client_id vacío).
select pg_temp.req('authenticated',
  '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated","client_id":"9a1b2c3d-0000-4000-8000-000000000001"}', '');
do $$
begin
  assert (select count(*) from storage.objects where bucket_id in ('page-files', 'thumbs')) = 0,
    'el token de asistente ve fotos o miniaturas';
  perform pg_temp.expect_error(
    $q$insert into storage.objects (bucket_id, name) values ('page-files', '00000000-0000-4000-8000-0000000000a1/otra.jpg')$q$,
    '42501', 'el token de asistente sube una foto');
  perform pg_temp.expect_error(
    $q$insert into storage.objects (bucket_id, name) values ('thumbs', '00000000-0000-4000-8000-0000000000f2.jpg')$q$,
    '42501', 'el token de asistente sube una miniatura');
end;
$$;
select pg_temp.req('authenticated', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated","client_id":""}', '');
do $$
begin
  assert (select count(*) from storage.objects where bucket_id in ('page-files', 'thumbs')) = 0,
    'client_id vacío ve fotos o miniaturas';
end;
$$;
-- Control: la misma miniatura que el asistente no pudo subir, la app sí (el nombre es válido).
select pg_temp.req('authenticated',
  '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}', '');
insert into storage.objects (bucket_id, name) values ('thumbs', '00000000-0000-4000-8000-0000000000f2.jpg');
select set_config('role', 'postgres', true);

-- Las políticas: las cuatro de authenticated con la condición y lo de antes igual; la del link público, sin tocar.
do $$
declare
  p record;
begin
  for p in select policyname, coalesce(qual, with_check) as expr from pg_policies
           where schemaname = 'storage' and tablename = 'objects'
             and policyname in ('page_files_select', 'page_files_insert', 'thumbs_select', 'thumbs_insert') loop
    assert p.expr like '%(auth.jwt() ->> ''client_id''::text) IS NULL%', format('%s sin la condición', p.policyname);
  end loop;
  assert (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
            and policyname in ('page_files_select', 'page_files_insert', 'thumbs_select', 'thumbs_insert')
            and roles = '{authenticated}') = 4, 'faltan políticas o cambiaron de rol';
  assert (select with_check from pg_policies where schemaname = 'storage' and policyname = 'page_files_insert')
           like '%private.can_edit_page(private.try_uuid((storage.foldername(name))[1]))%', 'page_files_insert cambió';
  assert (select qual from pg_policies where schemaname = 'storage' and policyname = 'page_files_select')
           like '%private.can_view_page(private.try_uuid((storage.foldername(name))[1]))%', 'page_files_select cambió';
  assert (select qual from pg_policies where schemaname = 'storage' and policyname = 'thumbs_select')
           like '%private.file_level(private.thumb_file_id(name)) >= 1%', 'thumbs_select cambió';
  assert (select with_check from pg_policies where schemaname = 'storage' and policyname = 'thumbs_insert')
           like '%private.file_level(private.thumb_file_id(name)) >= 3%', 'thumbs_insert cambió';
  assert (select qual from pg_policies where schemaname = 'storage' and policyname = 'thumbs_select_link')
           not like '%client_id%', 'thumbs_select_link cambió';
end;
$$;

rollback;

select 'ok' as result;
