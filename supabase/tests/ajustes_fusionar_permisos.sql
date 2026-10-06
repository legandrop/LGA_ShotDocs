-- Pruebas de `patch_page_settings` (20261104120000_ajustes_fusionar.sql): fusiona las claves de `pages.settings` sobre
-- lo que la fila tenga, con exactamente los permisos del `update` directo de la tabla (ni más ni menos, para cada
-- persona y cada página), la versión mínima de la app, la forma de lo que recibe y el tope de tamaño. Corre dentro de
-- una transacción que se deshace al final: no deja usuarios ni datos. Si todo pasa, devuelve una fila con
-- result = 'ok'.

begin;

-- La sesión de una persona, con el header de la versión que mandaría su app (`version` null: una app sin header) y
-- cómo entró (`amr`).
create function pg_temp.as_user(uid uuid, version text default '9.999', amr text default 'otp') returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', uid, 'role', 'authenticated',
                                      'amr', json_build_array(json_build_object('method', amr, 'timestamp', 1)))::text, true),
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

-- Lo que la consola ve en `settings` (sin Row Level Security): para comprobar que un rechazo no cambió nada.
create function pg_temp.settings_of(page uuid) returns jsonb language sql security definer as $$
  select settings from public.pages where id = page;
$$;

-- La regla de esta migración: la función cambia los ajustes de una página si y solo si el `update` directo de la tabla
-- los cambia, para la sesión que esté puesta. Ninguno de los dos cambia nada acá (no ponen ni sacan claves).
create function pg_temp.same_as_table(page uuid, expected boolean, who text) returns void language plpgsql as $$
declare
  direct int;
  by_fn  boolean;
begin
  with u as (update public.pages set settings = settings where id = page returning 1)
  select count(*) into direct from u;
  by_fn := public.patch_page_settings(page, '{}'::jsonb, '{}'::text[]) is not null;
  if by_fn is distinct from (direct = 1) then
    raise exception 'FALLA: % en %: la tabla tocó % fila(s) y la función dijo %', who, page, direct, by_fn;
  end if;
  if by_fn is distinct from expected then
    raise exception 'FALLA: % en %: se esperaba % y dio %', who, page, expected, by_fn;
  end if;
end;
$$;

-- Personas: a (creó el proyecto P: nivel 4), e (Editar), c (Comentar), v (Ver), g (invitada con Editar), w (invitada
-- con Ver), x (miembro sin permiso), s (Editar solo sobre la página de abajo) y r (sacada del workspace, con Editar).
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-0000000f1a01', 'aju-a@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f1e01', 'aju-e@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f1c01', 'aju-c@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f1f01', 'aju-v@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f1b01', 'aju-g@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f1701', 'aju-w@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f1001', 'aju-x@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f1501', 'aju-s@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f1901', 'aju-r@test.invalid', 'authenticated', 'authenticated');
insert into public.members (user_id, role, removed_at) values
  ('00000000-0000-4000-8000-0000000f1a01', 'member', null),
  ('00000000-0000-4000-8000-0000000f1e01', 'member', null),
  ('00000000-0000-4000-8000-0000000f1c01', 'member', null),
  ('00000000-0000-4000-8000-0000000f1f01', 'member', null),
  ('00000000-0000-4000-8000-0000000f1b01', 'guest', null),
  ('00000000-0000-4000-8000-0000000f1701', 'guest', null),
  ('00000000-0000-4000-8000-0000000f1001', 'member', null),
  ('00000000-0000-4000-8000-0000000f1501', 'member', null),
  ('00000000-0000-4000-8000-0000000f1901', 'member', now());
-- P (de a) y Q (de x, privado: nadie más lo ve).
insert into public.workspaces (id, owner_id, name) values
  ('00000000-0000-4000-8000-0000000f1e09', '00000000-0000-4000-8000-0000000f1a01', 'P'),
  ('00000000-0000-4000-8000-0000000f1e0a', '00000000-0000-4000-8000-0000000f1001', 'Q');
-- p1 (arriba) con p1c adentro; t (en la papelera); q1 en Q.
insert into public.pages (id, workspace_id, parent_id, title, sort_key, settings, deleted_at) values
  ('00000000-0000-4000-8000-0000000f1d01', '00000000-0000-4000-8000-0000000f1e09', null, 'p1', 'a0', '{"header": {"levels": 2}}', null),
  ('00000000-0000-4000-8000-0000000f1d02', '00000000-0000-4000-8000-0000000f1e09', '00000000-0000-4000-8000-0000000f1d01', 'p1c', 'a1', '{}', null),
  ('00000000-0000-4000-8000-0000000f1d03', '00000000-0000-4000-8000-0000000f1e09', null, 't', 'a2', '{"split": true}', now()),
  ('00000000-0000-4000-8000-0000000f1d04', '00000000-0000-4000-8000-0000000f1e0a', null, 'q1', 'a0', '{"split": true}', null);
insert into public.grants (user_id, project_id, page_id, level) values
  ('00000000-0000-4000-8000-0000000f1e01', '00000000-0000-4000-8000-0000000f1e09', null, 'edit'),
  ('00000000-0000-4000-8000-0000000f1c01', '00000000-0000-4000-8000-0000000f1e09', null, 'comment'),
  ('00000000-0000-4000-8000-0000000f1f01', '00000000-0000-4000-8000-0000000f1e09', null, 'view'),
  ('00000000-0000-4000-8000-0000000f1b01', '00000000-0000-4000-8000-0000000f1e09', null, 'edit'),
  ('00000000-0000-4000-8000-0000000f1701', '00000000-0000-4000-8000-0000000f1e09', null, 'view'),
  ('00000000-0000-4000-8000-0000000f1501', null, '00000000-0000-4000-8000-0000000f1d02', 'edit'),
  ('00000000-0000-4000-8000-0000000f1901', '00000000-0000-4000-8000-0000000f1e09', null, 'edit');

-- Sin versión mínima para lo que sigue (la versión mínima tiene su bloque más abajo).
update public.workspace_settings set min_app_version = null;

-- ---------------------------------------------------------------------------------------------------
-- La función: quién la ejecuta y con qué permisos corre.
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  assert has_function_privilege('authenticated', 'public.patch_page_settings(uuid, jsonb, text[])', 'execute'),
    'authenticated no la ejecuta';
  assert not has_function_privilege('anon', 'public.patch_page_settings(uuid, jsonb, text[])', 'execute'), 'anon la ejecuta';
  assert not exists (
    select 1 from pg_proc p, aclexplode(p.proacl) x
    where p.oid = 'public.patch_page_settings(uuid, jsonb, text[])'::regprocedure and x.grantee = 0),
    'PUBLIC la ejecuta';
  -- Con los permisos de quien llama: el update de adentro pasa por las políticas, los privilegios y los triggers.
  assert (select not p.prosecdef and p.proconfig @> array['search_path=""']
          from pg_proc p where p.oid = 'public.patch_page_settings(uuid, jsonb, text[])'::regprocedure),
    'la función no corre con los permisos de quien llama, o no fija search_path';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Fusionar: poner, sacar, repetir.
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000f1a01');
do $$
declare
  p1 constant uuid := '00000000-0000-4000-8000-0000000f1d01';
  r  jsonb;
begin
  -- Poner una clave deja las demás; devuelve cómo quedó.
  r := public.patch_page_settings(p1, '{"format": {"size": "A4", "landscape": false}}', '{}');
  assert r = '{"header": {"levels": 2}, "format": {"size": "A4", "landscape": false}}'::jsonb, format('poner una clave: %s', r);
  assert pg_temp.settings_of(p1) = r, 'lo devuelto no es lo guardado';
end;
$$;
-- Otra persona (como otro dispositivo que no vio el cambio anterior) pone otra clave: quedan las tres.
select pg_temp.as_user('00000000-0000-4000-8000-0000000f1e01');
do $$
declare
  p1 constant uuid := '00000000-0000-4000-8000-0000000f1d01';
  r  jsonb;
begin
  r := public.patch_page_settings(p1, '{"split": true}', '{}');
  assert r = '{"header": {"levels": 2}, "format": {"size": "A4", "landscape": false}, "split": true}'::jsonb,
    format('dos cambios de claves distintas: %s', r);
  -- Repetirlo deja lo mismo.
  assert public.patch_page_settings(p1, '{"split": true}', '{}') = r, 'repetir cambió algo';
  -- Una clave que ya estaba se reemplaza entera (no se mezcla por dentro).
  r := public.patch_page_settings(p1, '{"format": {"size": "A5"}}', '{}');
  assert r -> 'format' = '{"size": "A5"}'::jsonb, format('reemplazar una clave: %s', r);
  -- Sacar una clave deja las demás; sacar una que no está no cambia nada.
  r := public.patch_page_settings(p1, '{}', '{format}');
  assert r = '{"header": {"levels": 2}, "split": true}'::jsonb, format('sacar una clave: %s', r);
  assert public.patch_page_settings(p1, '{}', '{format,nunca}') = r, 'sacar una clave que no está cambió algo';
  -- Poner y sacar a la vez; si la misma clave viene en los dos, se saca.
  r := public.patch_page_settings(p1, '{"templatesFolder": true, "split": false}', '{header,split}');
  assert r = '{"templatesFolder": true}'::jsonb, format('poner y sacar: %s', r);
  -- `false` es un valor, no un borrado.
  r := public.patch_page_settings(p1, '{"dayReports": false}', '{templatesFolder}');
  assert r = '{"dayReports": false}'::jsonb, format('false es un valor: %s', r);
  -- Sin nada que poner ni sacar (o con nulos) no cambia nada y no falla.
  assert public.patch_page_settings(p1, null, null) = r, 'nulos cambiaron algo';
  assert public.patch_page_settings(p1, '{}', array[null]::text[]) = r, 'una clave nula a sacar cambió algo';

  -- Lo que no es un objeto no entra, y no cambia nada.
  perform pg_temp.expect_error(format('select public.patch_page_settings(%L, %L, %L)', p1, '[1]', '{}'), 'settings_invalid', 'acepta una lista');
  perform pg_temp.expect_error(format('select public.patch_page_settings(%L, %L, %L)', p1, '"x"', '{}'), 'settings_invalid', 'acepta un texto');
  perform pg_temp.expect_error(format('select public.patch_page_settings(%L, %L, %L)', p1, '3', '{}'), 'settings_invalid', 'acepta un número');
  perform pg_temp.expect_error(format('select public.patch_page_settings(%L, %L, %L)', p1, 'null', '{}'), 'settings_invalid', 'acepta un null de JSON');
  -- El tope de tamaño vale para el resultado de la fusión: dos cambios que entran por separado y juntos no.
  perform public.patch_page_settings(p1, jsonb_build_object('template', jsonb_build_object('description', repeat('x', 1200))), '{}');
  perform pg_temp.expect_error(
    format('select public.patch_page_settings(%L, %L, %L)', p1, jsonb_build_object('header', jsonb_build_object('pad', repeat('y', 1200))), '{}'),
    '23514', 'la fusión pasa el tope de tamaño');
  assert pg_temp.settings_of(p1) = jsonb_build_object('dayReports', false, 'template', jsonb_build_object('description', repeat('x', 1200))),
    'un rechazo cambió los ajustes';
  perform public.patch_page_settings(p1, '{"header": {"levels": 2}}', '{template,dayReports}');
  -- Una página que no existe: null, sin error.
  assert public.patch_page_settings('00000000-0000-4000-8000-0000000f1dff', '{"split": true}', '{}') is null, 'una página que no existe no da null';
  assert public.patch_page_settings(null, '{"split": true}', '{}') is null, 'sin página no da null';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Permisos: para cada persona y cada página, la función cambia si y solo si el update de la tabla cambia.
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  a  constant uuid := '00000000-0000-4000-8000-0000000f1a01';
  e  constant uuid := '00000000-0000-4000-8000-0000000f1e01';
  c  constant uuid := '00000000-0000-4000-8000-0000000f1c01';
  v  constant uuid := '00000000-0000-4000-8000-0000000f1f01';
  g  constant uuid := '00000000-0000-4000-8000-0000000f1b01';
  w  constant uuid := '00000000-0000-4000-8000-0000000f1701';
  x  constant uuid := '00000000-0000-4000-8000-0000000f1001';
  s  constant uuid := '00000000-0000-4000-8000-0000000f1501';
  r  constant uuid := '00000000-0000-4000-8000-0000000f1901';
  p1 constant uuid := '00000000-0000-4000-8000-0000000f1d01';
  pc constant uuid := '00000000-0000-4000-8000-0000000f1d02';
  t  constant uuid := '00000000-0000-4000-8000-0000000f1d03';
  q1 constant uuid := '00000000-0000-4000-8000-0000000f1d04';
  before jsonb;
begin
  -- Quien creó el proyecto y quien tiene Editar (miembro o invitada): sí, en lo suyo; nunca en el proyecto de otro.
  perform pg_temp.as_user(a);
  perform pg_temp.same_as_table(p1, true, 'a');
  perform pg_temp.same_as_table(pc, true, 'a');
  perform pg_temp.same_as_table(t, true, 'a (papelera)');
  perform pg_temp.same_as_table(q1, false, 'a (otro proyecto)');
  perform pg_temp.as_user(e);
  perform pg_temp.same_as_table(p1, true, 'e');
  perform pg_temp.same_as_table(pc, true, 'e');
  perform pg_temp.same_as_table(t, true, 'e (papelera)');
  perform pg_temp.same_as_table(q1, false, 'e (otro proyecto)');
  perform pg_temp.as_user(g);
  perform pg_temp.same_as_table(p1, true, 'g (invitada con Editar)');
  -- La papelera no es para invitados (20261009120000_papelera_lectores.sql).
  perform pg_temp.same_as_table(t, false, 'g (papelera)');
  perform pg_temp.same_as_table(q1, false, 'g (otro proyecto)');
  -- Editar solo abajo: abajo sí, arriba no.
  perform pg_temp.as_user(s);
  perform pg_temp.same_as_table(pc, true, 's (su página)');
  perform pg_temp.same_as_table(p1, false, 's (la de arriba)');
  perform pg_temp.same_as_table(t, false, 's (al costado)');
  -- Comentar, Ver (miembro e invitada), sin permiso y sacada: no, en ninguna.
  perform pg_temp.as_user(c);
  perform pg_temp.same_as_table(p1, false, 'c');
  perform pg_temp.same_as_table(pc, false, 'c');
  perform pg_temp.same_as_table(t, false, 'c (papelera)');
  perform pg_temp.as_user(v);
  perform pg_temp.same_as_table(p1, false, 'v');
  perform pg_temp.same_as_table(pc, false, 'v');
  perform pg_temp.as_user(w);
  perform pg_temp.same_as_table(p1, false, 'w (invitada con Ver)');
  perform pg_temp.as_user(x);
  perform pg_temp.same_as_table(p1, false, 'x');
  perform pg_temp.same_as_table(pc, false, 'x');
  perform pg_temp.same_as_table(q1, true, 'x (su proyecto)');
  perform pg_temp.as_user(r);
  perform pg_temp.same_as_table(p1, false, 'r (sacada)');
  -- Una sesión abierta con contraseña no es miembro de nada.
  perform pg_temp.as_user(a, '9.999', 'password');
  perform pg_temp.same_as_table(p1, false, 'a con contraseña');

  -- Y con un cambio de verdad: quien no puede recibe null y la fila queda igual.
  before := pg_temp.settings_of(p1);
  perform pg_temp.as_user(v);
  assert public.patch_page_settings(p1, '{"split": true}', '{header}') is null, 'Ver cambió los ajustes';
  perform pg_temp.as_user(c);
  assert public.patch_page_settings(p1, '{"split": true}', '{header}') is null, 'Comentar cambió los ajustes';
  perform pg_temp.as_user(w);
  assert public.patch_page_settings(p1, '{"split": true}', '{header}') is null, 'una invitada con Ver cambió los ajustes';
  perform pg_temp.as_user(x);
  assert public.patch_page_settings(p1, '{"split": true}', '{header}') is null, 'sin permiso cambió los ajustes';
  perform pg_temp.as_user(s);
  assert public.patch_page_settings(p1, '{"split": true}', '{header}') is null, 'Editar abajo cambió los ajustes de arriba';
  perform pg_temp.as_user(r);
  assert public.patch_page_settings(p1, '{"split": true}', '{header}') is null, 'la sacada cambió los ajustes';
  perform pg_temp.as_user(a, '9.999', 'password');
  assert public.patch_page_settings(p1, '{"split": true}', '{header}') is null, 'una sesión con contraseña cambió los ajustes';
  assert pg_temp.settings_of(p1) = before, 'alguien que no puede cambió los ajustes';
  assert pg_temp.settings_of(q1) = '{"split": true}'::jsonb, 'cambiaron los ajustes del otro proyecto';
  -- La función no toca otra columna: el título y el lugar siguen igual.
  perform pg_temp.as_console();
  assert (select title = 'p1' and parent_id is null and sort_key = 'a0' and deleted_at is null and icon is null
          from public.pages where id = p1), 'la función cambió otra columna';
end;
$$;

-- Un proyecto borrado: nadie, tampoco quien lo creó.
select pg_temp.as_console();
update public.workspaces set deleted_at = now() where id = '00000000-0000-4000-8000-0000000f1e09';
select pg_temp.as_user('00000000-0000-4000-8000-0000000f1a01');
select pg_temp.same_as_table('00000000-0000-4000-8000-0000000f1d01', false, 'a (proyecto borrado)');
select pg_temp.as_console();
update public.workspaces set deleted_at = null where id = '00000000-0000-4000-8000-0000000f1e09';

-- ---------------------------------------------------------------------------------------------------
-- La versión mínima: la misma regla que el update de la tabla (503 `app_outdated`, sin escribir nada).
-- ---------------------------------------------------------------------------------------------------
update public.workspace_settings set min_app_version = 0.099;
do $$
declare
  e  constant uuid := '00000000-0000-4000-8000-0000000f1e01';
  p1 constant uuid := '00000000-0000-4000-8000-0000000f1d01';
  before jsonb := pg_temp.settings_of('00000000-0000-4000-8000-0000000f1d01');
  stmt constant text := format('select public.patch_page_settings(%L, %L, %L)', '00000000-0000-4000-8000-0000000f1d01', '{"split": true}', '{}');
begin
  perform pg_temp.as_user(e, null);
  perform pg_temp.expect_outdated(stmt, 'sin header');
  perform pg_temp.as_user(e, '0.098');
  perform pg_temp.expect_outdated(stmt, 'con una versión menor');
  perform pg_temp.as_user(e, 'abc');
  perform pg_temp.expect_outdated(stmt, 'con una versión ilegible');
  assert pg_temp.settings_of(p1) = before, 'un rechazo por versión cambió los ajustes';
  -- El permiso va antes: quien no puede sigue recibiendo null, no el rechazo por versión.
  perform pg_temp.as_user('00000000-0000-4000-8000-0000000f1f01', null);
  assert public.patch_page_settings(p1, '{"split": true}', '{}') is null, 'Ver con la app vieja no dio null';
  -- La mínima y las mayores escriben.
  perform pg_temp.as_user(e, '0.099');
  assert public.patch_page_settings(p1, '{"split": true}', '{}') -> 'split' = 'true'::jsonb, 'la versión mínima no escribe';
end;
$$;
select pg_temp.as_console();
update public.workspace_settings set min_app_version = null;

-- ---------------------------------------------------------------------------------------------------
-- Sin sesión: nada, tampoco con el header de un link público.
-- ---------------------------------------------------------------------------------------------------
select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role":"anon"}', true),
       set_config('request.headers', '{"x-shotdocs-version": "9.999", "x-shotdocs-link": "sdl_no-existe"}', true);
do $$
begin
  perform pg_temp.expect_error(
    format('select public.patch_page_settings(%L, %L, %L)', '00000000-0000-4000-8000-0000000f1d01', '{"split": false}', '{}'),
    '42501', 'anon cambia los ajustes');
end;
$$;
select pg_temp.as_console();
do $$
begin
  assert pg_temp.settings_of('00000000-0000-4000-8000-0000000f1d01') -> 'split' = 'true'::jsonb, 'anon cambió los ajustes';
end;
$$;

rollback;

select 'ok' as result;
