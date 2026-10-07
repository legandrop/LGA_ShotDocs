-- Pruebas de la versión mínima en la papelera de archivos (20261109120000_version_minima_papelera_archivos.sql):
-- `purge_file` (lo llama el portero con la sesión de la persona) mira la versión que el portero le pasa en el header
-- `x-shotdocs-version`. Con header, menor que la mínima o ilegible no marca nada (503 `app_outdated`); sin header pasa
-- como siempre mientras la mínima sea menor que la primera versión que lo manda, y desde ahí se rechaza. El permiso y el
-- estado del archivo van antes; repetir lo ya pedido y confirmar (`media_purged`) no se frenan. Corre dentro de una
-- transacción que se deshace al final: no deja usuarios ni datos. Si todo pasa, devuelve una fila con result = 'ok'.

begin;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-00000000' || s)::uuid;
$$;

-- La sesión de una persona, como le llega a la base el pedido del portero: con el header de la versión que la app le
-- mandó al portero (`version` null: un portero anterior, o una app que todavía no se la manda).
create function pg_temp.as_user(s text, version text default '9.999') returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', pg_temp.u(s), 'role', 'authenticated')::text, true),
         set_config('request.headers',
                    case when version is null then json_build_object('accept', '*/*')
                         else json_build_object('accept', '*/*', 'x-shotdocs-version', version) end::text, true);
$$;

create function pg_temp.as_console() returns void language sql as $$
  select set_config('role', 'postgres', true),
         set_config('request.jwt.claims', '', true),
         set_config('request.headers', '', true);
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

-- Corre `stmt` y exige el rechazo por versión: sqlstate PGRST, mensaje `app_outdated`, código P0001 y estado 503.
create function pg_temp.expect_outdated(stmt text, what text) returns void language plpgsql as $$
declare
  d text;
begin
  begin
    execute stmt;
  exception when others then
    get stacked diagnostics d = pg_exception_detail;
    if sqlstate = 'PGRST' and (sqlerrm::json ->> 'message') = 'app_outdated' and (sqlerrm::json ->> 'code') = 'P0001'
       and (d::json ->> 'status') = '503' then
      return;
    end if;
    raise exception 'FALLA: % (dio % % / %)', what, sqlstate, sqlerrm, d;
  end;
  raise exception 'FALLA: % (no rechazó)', what;
end;
$$;

create function pg_temp.min(v numeric) returns void language sql security definer as $$
  update public.workspace_settings set min_app_version = v where id;
$$;

-- La primera versión de la app que le manda su versión al portero: el número de la migración. Es el único lugar de
-- esta prueba donde está escrito; las demás versiones se arman a partir de él (`v(-0.001)`: la anterior).
create function pg_temp.since() returns numeric language sql immutable as $$
  select 0.218::numeric;
$$;
create function pg_temp.v(delta numeric default 0) returns text language sql immutable as $$
  select to_char(pg_temp.since() + delta, 'FM0.000');
$$;

-- La huella de los archivos de la prueba, como los ve la consola: si un rechazo cambia algo, cambia.
create function pg_temp.files_print() returns text language sql security definer as $$
  select md5(string_agg(f::text, '|' order by f.id)) from public.files f where f.project_id = pg_temp.u('a3e0');
$$;
create function pg_temp.purged(s text) returns boolean language sql security definer as $$
  select f.purged_at is not null from public.files f where f.id = pg_temp.u(s);
$$;

-- `purge_file` de un archivo con esa versión (null: sin header) tiene que marcarlo.
create function pg_temp.purges(who text, version text, file text, what text) returns void language plpgsql as $$
begin
  perform pg_temp.as_user(who, version);
  perform public.purge_file(pg_temp.u(file));
  assert pg_temp.purged(file), format('%s: no quedó marcado', what);
  perform pg_temp.as_console();
exception when others then
  raise exception 'FALLA: % (dio % %)', what, sqlstate, sqlerrm;
end;
$$;

-- `purge_file` con esa versión tiene que dar el 503 y no cambiar nada.
create function pg_temp.rejects(who text, version text, file text, what text) returns void language plpgsql as $$
declare
  before constant text := pg_temp.files_print();
begin
  perform pg_temp.as_user(who, version);
  perform pg_temp.expect_outdated(format('select public.purge_file(%L)', pg_temp.u(file)), what);
  perform pg_temp.as_console();
  assert pg_temp.files_print() = before, format('%s: el rechazo cambió algo', what);
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Datos
-- ---------------------------------------------------------------------------------------------------
-- Personas: o (dueña del workspace y del proyecto), ad (admin con Ver sobre el proyecto: manda a Drive), m4 (miembro
-- con Editar y crear: ve la papelera y no manda), x (miembro sin permisos).
update public.members set removed_at = now() where role = 'owner' and removed_at is null;
update public.workspace_settings set min_app_version = null, auto_purge_files = false where id;
insert into auth.users (id, email, aud, role) values
  (pg_temp.u('a3a0'), 'vmp-o@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('a3a1'), 'vmp-ad@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('a3a2'), 'vmp-m4@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('a3a3'), 'vmp-x@test.invalid', 'authenticated', 'authenticated');
update public.workspace_settings set owner_id = pg_temp.u('a3a0') where id;
insert into public.members (user_id, role) values
  (pg_temp.u('a3a0'), 'owner'), (pg_temp.u('a3a1'), 'admin'), (pg_temp.u('a3a2'), 'member'), (pg_temp.u('a3a3'), 'member');
insert into public.workspaces (id, owner_id, name) values (pg_temp.u('a3e0'), pg_temp.u('a3a0'), 'P');
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  (pg_temp.u('a3b0'), pg_temp.u('a3e0'), null, 'viva', 'a0');
insert into public.grants (user_id, project_id, page_id, level) values
  (pg_temp.u('a3a1'), pg_temp.u('a3e0'), null, 'view'),
  (pg_temp.u('a3a2'), pg_temp.u('a3e0'), null, 'edit_pages');
-- c0 a cb: en la papelera, sin pedir. cc: en uso. cd: en la papelera, ya pedido.
insert into public.files (id, project_id, name, mime, size, drive_id, uploaded_at, trashed_at, purged_at)
select pg_temp.u('a3c' || d), pg_temp.u('a3e0'), 'f' || d || '.jpg', 'image/jpeg', 100, 'drive_vmp_' || d || '_xxxxx',
       now() - interval '9 days', now() - interval '2 days', null
from unnest(array['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b']) d;
insert into public.files (id, project_id, name, mime, size, drive_id, uploaded_at, trashed_at, purged_at) values
  (pg_temp.u('a3cc'), pg_temp.u('a3e0'), 'en-uso.jpg', 'image/jpeg', 100, 'drive_vmp_c_xxxxx', now() - interval '9 days', null, null),
  (pg_temp.u('a3cd'), pg_temp.u('a3e0'), 'pedido.jpg', 'image/jpeg', 100, 'drive_vmp_d_xxxxx', now() - interval '9 days',
   now() - interval '2 days', now() - interval '1 day');
insert into public.page_files (page_id, file_id) values (pg_temp.u('a3b0'), pg_temp.u('a3cc'));

-- ---------------------------------------------------------------------------------------------------
-- Las funciones: la regla no la llama nadie de afuera y `purge_file` sigue igual por fuera.
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  rule  constant regprocedure := 'private.require_file_trash_version()'::regprocedure;
  purge constant regprocedure := 'public.purge_file(uuid)'::regprocedure;
begin
  assert (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = rule), 'la regla no fija search_path';
  assert not has_function_privilege('authenticated', rule, 'execute'), 'authenticated llama a la regla';
  assert not has_function_privilege('anon', rule, 'execute'), 'anon llama a la regla';
  assert (select p.prosecdef and p.proconfig @> array['search_path=""'] and p.prorettype = 'void'::regtype and p.provolatile = 'v'
          from pg_proc p where p.oid = purge), 'purge_file cambió por fuera';
  assert has_function_privilege('authenticated', purge, 'execute'), 'authenticated no ejecuta purge_file';
  assert not has_function_privilege('anon', purge, 'execute'), 'anon ejecuta purge_file';
  assert (select trashed_at is null from public.files where id = pg_temp.u('a3cc')), 'el archivo en uso entró a la papelera';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Sin mínima: todo pasa, con cualquier header y sin header.
-- ---------------------------------------------------------------------------------------------------
select pg_temp.purges('a3a0', null, 'a3c0', 'sin mínima y sin header');
select pg_temp.purges('a3a0', '0.001', 'a3c1', 'sin mínima y con una versión vieja');
select pg_temp.purges('a3a1', 'no-es-una-version', 'a3c2', 'sin mínima y con una versión ilegible');

-- ---------------------------------------------------------------------------------------------------
-- Con una mínima menor que la primera versión que manda el header: sin header pasa (un portero anterior, o una app
-- permitida que todavía no le manda su versión al portero); con header, se compara.
-- ---------------------------------------------------------------------------------------------------
select pg_temp.min(pg_temp.since() - 0.001);
select pg_temp.purges('a3a0', null, 'a3c3', 'mínima por debajo del umbral, sin header');
select pg_temp.purges('a3a1', '', 'a3c4', 'mínima por debajo del umbral, header vacío (es como sin header)');
select pg_temp.rejects('a3a0', '0.001', 'a3c5', 'mínima por debajo del umbral, header menor');
select pg_temp.rejects('a3a1', pg_temp.v(-0.002), 'a3c5', 'mínima por debajo del umbral, header apenas menor');
select pg_temp.rejects('a3a0', 'invalid', 'a3c5', 'mínima por debajo del umbral, header ilegible');
select pg_temp.rejects('a3a0', pg_temp.v(-0.001) || '0', 'a3c5', 'mínima por debajo del umbral, header con una forma que la base no lee');
select pg_temp.purges('a3a0', pg_temp.v(-0.001), 'a3c5', 'mínima por debajo del umbral, header igual a la mínima');
select pg_temp.purges('a3a1', pg_temp.v(), 'a3c6', 'mínima por debajo del umbral, header mayor');

-- ---------------------------------------------------------------------------------------------------
-- Con la mínima en la primera versión que manda el header, o más: sin header ya no pasa.
-- ---------------------------------------------------------------------------------------------------
select pg_temp.min(pg_temp.since());
select pg_temp.rejects('a3a0', null, 'a3c7', 'mínima en el umbral, sin header');
select pg_temp.rejects('a3a1', '', 'a3c7', 'mínima en el umbral, header vacío');
select pg_temp.rejects('a3a0', pg_temp.v(-0.001), 'a3c7', 'mínima en el umbral, header menor');
select pg_temp.rejects('a3a0', 'invalid', 'a3c7', 'mínima en el umbral, header ilegible');
select pg_temp.purges('a3a0', pg_temp.v(), 'a3c7', 'mínima en el umbral, header igual');
select pg_temp.purges('a3a1', pg_temp.v(0.001), 'a3c8', 'mínima en el umbral, header mayor');
select pg_temp.min(pg_temp.since() + 0.1);
select pg_temp.rejects('a3a0', null, 'a3c9', 'mínima por arriba del umbral, sin header');
select pg_temp.rejects('a3a0', pg_temp.v(), 'a3c9', 'mínima por arriba del umbral, header menor');
select pg_temp.purges('a3a0', pg_temp.v(0.1), 'a3c9', 'mínima por arriba del umbral, header igual');

-- ---------------------------------------------------------------------------------------------------
-- El permiso y el estado del archivo van antes que la versión; repetir y confirmar no se frenan.
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  before text;
begin
  before := pg_temp.files_print();
  -- Con una versión vieja y sin header, cada uno recibe su error de siempre.
  perform pg_temp.as_user('a3a2', '0.001');
  perform pg_temp.expect_error(format('select public.purge_file(%L)', pg_temp.u('a3ca')), 'not_allowed', 'el miembro con una versión vieja no recibe not_allowed');
  perform pg_temp.as_user('a3a2', null);
  perform pg_temp.expect_error(format('select public.purge_file(%L)', pg_temp.u('a3ca')), 'not_allowed', 'el miembro sin header no recibe not_allowed');
  perform pg_temp.as_user('a3a3', '0.001');
  perform pg_temp.expect_error(format('select public.purge_file(%L)', pg_temp.u('a3ca')), 'file_not_found', 'quien no ve el archivo no recibe file_not_found');
  perform pg_temp.as_user('a3a0', '0.001');
  perform pg_temp.expect_error(format('select public.purge_file(%L)', pg_temp.u('a3ff')), 'file_not_found', 'un archivo que no existe no da file_not_found');
  perform pg_temp.expect_error(format('select public.purge_file(%L)', pg_temp.u('a3cc')), 'file_not_trashed', 'un archivo en uso con una versión vieja no da file_not_trashed');
  perform pg_temp.as_user('a3a0', null);
  perform pg_temp.expect_error(format('select public.purge_file(%L)', pg_temp.u('a3cc')), 'file_not_trashed', 'un archivo en uso sin header no da file_not_trashed');

  -- Pedir de nuevo lo ya pedido no escribe nada y no pasa por la versión: ni con una vieja ni sin header.
  perform pg_temp.as_user('a3a0', '0.001');
  perform public.purge_file(pg_temp.u('a3cd'));
  perform public.purge_file(pg_temp.u('a3c0'));
  perform pg_temp.as_user('a3a1', null);
  perform public.purge_file(pg_temp.u('a3cd'));
  perform pg_temp.as_console();
  assert pg_temp.files_print() = before, 'repetir un pedido cambió algo';

  -- La confirmación del portero no se frena: lo pedido termina, también sin header y con una versión vieja.
  perform pg_temp.as_user('a3a0', null);
  perform public.media_purged(pg_temp.u('a3cd'));
  perform pg_temp.as_user('a3a1', '0.001');
  perform public.media_purged(pg_temp.u('a3c0'));
  perform pg_temp.as_console();
  assert (select count(*) from public.files where id in (pg_temp.u('a3cd'), pg_temp.u('a3c0')) and drive_trashed_at is not null) = 2,
    'la confirmación no quedó';

  -- anon no llama, con header o sin él.
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  perform set_config('request.headers', '{"x-shotdocs-version": "9.999"}', true);
  perform pg_temp.expect_error(format('select public.purge_file(%L)', pg_temp.u('a3ca')), '42501', 'anon llama a purge_file');
  perform pg_temp.as_console();

  -- Quedaron sin pedir justo los que nadie pudo mandar.
  assert (select string_agg(right(f.id::text, 2), ',' order by f.id) from public.files f
          where f.project_id = pg_temp.u('a3e0') and f.purged_at is null) = 'ca,cb,cc', 'no quedaron sin pedir los que tenían que quedar';
end;
$$;

-- Con la mínima de vuelta en nada, lo que quedaba se manda sin header.
select pg_temp.min(null);
select pg_temp.purges('a3a0', null, 'a3ca', 'sin mínima de nuevo, sin header');

rollback;

select 'ok' as result;
