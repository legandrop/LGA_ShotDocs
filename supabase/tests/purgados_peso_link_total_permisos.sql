-- Pruebas de 20261103120000_purgados_peso_link_total.sql: (1) el peso de un proyecto borrado para siempre ya no suma lo
-- que nunca llegó al Drive (papelera de la app y sin subir), sí lo mandado a la papelera de Drive durante sus 30 días, y
-- uno borrado sin purgar sigue sumando todo; quien no maneja el proyecto no ve su peso y anon no llama la función.
-- (2) `public_link_files` dice el total exacto en la columna `total` aunque la lista se corte en 500, con los mismos
-- permisos (quien no ve lo borrado de la página no la lista; anon no la llama) y las columnas de antes en su lugar.
-- Corre dentro de una transacción que se deshace al final: no deja usuarios ni datos. Si todo pasa, devuelve una fila
-- con result = 'ok'.

begin;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-0000000e' || s)::uuid;
$$;

create function pg_temp.as_user(s text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(s), 'role', 'authenticated')::text, true);
$$;

create function pg_temp.as_postgres() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
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

-- El peso de un proyecto como lo ve la sesión: principal, papelera de la app, papelera de Drive y sin subir; null si
-- la sesión no tiene su fila.
create function pg_temp.size_of(p uuid) returns text language sql as $$
  select format('%s/%s %s/%s %s/%s %s/%s', s.drive_bytes, s.drive_files, s.trash_bytes, s.trash_files,
                s.drive_trash_bytes, s.drive_trash_files, s.pending_bytes, s.pending_files)
  from public.project_sizes() s where s.project_id = p;
$$;

-- Personas: ow dueña; ad admin con editar y crear sobre P, Q y R (los maneja); av admin con ver sobre P, Q y R; ep
-- miembro con editar y crear sobre P, Q y R (no maneja un borrado).
insert into auth.users (id, email, aud, role, email_confirmed_at) values
  (pg_temp.u('0001'), 'pl-ow@test.invalid', 'authenticated', 'authenticated', now()),
  (pg_temp.u('0002'), 'pl-ad@test.invalid', 'authenticated', 'authenticated', now()),
  (pg_temp.u('0003'), 'pl-av@test.invalid', 'authenticated', 'authenticated', now()),
  (pg_temp.u('0004'), 'pl-ep@test.invalid', 'authenticated', 'authenticated', now());

update public.members set removed_at = now() where role = 'owner' and removed_at is null;
update public.workspace_settings
set owner_id = pg_temp.u('0001'), min_app_version = null, auto_purge_files = false where id;
insert into public.members (user_id, role, removed_at) values
  (pg_temp.u('0001'), 'owner', null), (pg_temp.u('0002'), 'admin', null),
  (pg_temp.u('0003'), 'admin', null), (pg_temp.u('0004'), 'member', null);

-- P (se borra para siempre), Q (se borra y queda en la papelera) y R (activo, con los links).
insert into public.workspaces (id, owner_id, name) values
  (pg_temp.u('1001'), pg_temp.u('0001'), 'P'), (pg_temp.u('1002'), pg_temp.u('0001'), 'Q'),
  (pg_temp.u('1003'), pg_temp.u('0001'), 'R');
insert into public.pages (id, workspace_id, parent_id, title, sort_key, deleted_at) values
  (pg_temp.u('2001'), pg_temp.u('1001'), null, 'p1', 'a0', null),
  (pg_temp.u('2002'), pg_temp.u('1001'), null, 'p2', 'a1', now() - interval '1 day'),
  (pg_temp.u('2003'), pg_temp.u('1002'), null, 'q1', 'a0', null),
  (pg_temp.u('2004'), pg_temp.u('1003'), null, 'l1', 'a0', null),
  (pg_temp.u('2005'), pg_temp.u('1003'), null, 'l2', 'a1', null),
  (pg_temp.u('2006'), pg_temp.u('1003'), null, 'l3', 'a2', null);
insert into public.grants (user_id, project_id, page_id, level)
select pg_temp.u(who), pg_temp.u(proj), null, lvl
from (values ('0002', 'edit_pages'), ('0003', 'view'), ('0004', 'edit_pages')) g(who, lvl),
     (values ('1001'), ('1002'), ('1003')) p(proj);

-- Archivos de P y Q (los pesos no se pisan):
--   a1  de P, en p1, subido hace 5 días                     1.000
--   a2  de P, en p1, nunca subido                          20.000
--   a3  de P, solo en p2 (papelera de páginas), nunca subido 300.000
--   q1  de Q, en q1, nunca subido                               7
insert into public.files (id, project_id, name, mime, size, drive_id, uploaded_at, created_by) values
  (pg_temp.u('3001'), pg_temp.u('1001'), 'a1.jpg', 'image/jpeg', 1000, 'drive_a1_xxxxxxxx', now() - interval '5 days', null),
  (pg_temp.u('3002'), pg_temp.u('1001'), 'a2.jpg', 'image/jpeg', 20000, null, null, null),
  (pg_temp.u('3003'), pg_temp.u('1001'), 'a3.jpg', 'image/jpeg', 300000, null, null, null),
  (pg_temp.u('3004'), pg_temp.u('1002'), 'q1.jpg', 'image/jpeg', 7, null, null, null);
insert into public.page_files (page_id, file_id, is_foreign) values
  (pg_temp.u('2001'), pg_temp.u('3001'), false), (pg_temp.u('2001'), pg_temp.u('3002'), false),
  (pg_temp.u('2002'), pg_temp.u('3003'), false), (pg_temp.u('2003'), pg_temp.u('3004'), false);
update public.files set trashed_at = now() - interval '1 day' where id = pg_temp.u('3003');

-- ---------------------------------------------------------------------------------------------------
-- 1. El peso: activo, borrado y borrado para siempre
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('0001');
do $$ begin
  assert pg_temp.size_of(pg_temp.u('1001')) = '1000/1 300000/1 0/0 20000/1',
    format('peso de P activo: %s', pg_temp.size_of(pg_temp.u('1001')));
  assert pg_temp.size_of(pg_temp.u('1002')) = '0/0 0/0 0/0 7/1', format('peso de Q activo: %s', pg_temp.size_of(pg_temp.u('1002')));
end; $$;
select public.delete_project(pg_temp.u('1001'));
select public.delete_project(pg_temp.u('1002'));
select pg_temp.as_postgres();
update public.workspaces set deleted_at = now() - interval '31 days' where id in (pg_temp.u('1001'), pg_temp.u('1002'));
select pg_temp.as_user('0001');
select public.request_project_drive_trash(pg_temp.u('1001'));
select public.project_drive_trashed(pg_temp.u('1001'));
do $$ begin
  -- Borrado y con la carpeta en la papelera de Drive: a1 ahí, a2 y a3 en la papelera de la app (vuelven al restaurar).
  assert pg_temp.size_of(pg_temp.u('1001')) = '0/0 320000/2 1000/1 0/0',
    format('peso de P borrado: %s', pg_temp.size_of(pg_temp.u('1001')));
end; $$;
select public.purge_project(pg_temp.u('1001'));
do $$ begin
  -- Borrado para siempre: lo nunca subido ya no suma; a1 sigue en la papelera de Drive (30 días).
  assert pg_temp.size_of(pg_temp.u('1001')) = '0/0 0/0 1000/1 0/0',
    format('peso de P borrado para siempre: %s', pg_temp.size_of(pg_temp.u('1001')));
  -- Q, borrado pero restaurable: lo nunca subido sigue en la papelera de la app.
  assert pg_temp.size_of(pg_temp.u('1002')) = '0/0 7/1 0/0 0/0',
    format('peso de Q borrado sin purgar: %s', pg_temp.size_of(pg_temp.u('1002')));
end; $$;
-- La admin que lo maneja ve lo mismo.
select pg_temp.as_user('0002');
do $$ begin
  assert pg_temp.size_of(pg_temp.u('1001')) = '0/0 0/0 1000/1 0/0',
    format('peso de P para la admin que lo maneja: %s', pg_temp.size_of(pg_temp.u('1001')));
end; $$;
-- Quien no lo maneja no ve su peso: ni la admin con ver ni el miembro con editar y crear.
select pg_temp.as_user('0003');
do $$ begin
  assert pg_temp.size_of(pg_temp.u('1001')) is null, 'la admin con ver ve el peso de P borrado para siempre';
  assert pg_temp.size_of(pg_temp.u('1002')) is null, 'la admin con ver ve el peso de Q borrado';
  assert (select count(*) from public.project_sizes() s where s.project_id is null) = 0, 'la admin ve la fila de la dueña';
end; $$;
select pg_temp.as_user('0004');
do $$ begin
  assert pg_temp.size_of(pg_temp.u('1001')) is null, 'el miembro ve el peso de P borrado para siempre';
end; $$;

-- Un archivo subido de P que no está en la papelera de Drive (no pasa por la app: la base no deja subir a un proyecto
-- borrado) cuenta donde está: el peso nunca dice que se liberó algo que sigue ocupando.
select pg_temp.as_postgres();
insert into public.files (id, project_id, name, mime, size, drive_id, uploaded_at, created_by, trashed_at) values
  (pg_temp.u('3005'), pg_temp.u('1001'), 'a5.jpg', 'image/jpeg', 50000000, 'drive_a5_xxxxxxxx', now(), null, now());
select pg_temp.as_user('0001');
do $$ begin
  assert pg_temp.size_of(pg_temp.u('1001')) = '50000000/1 50000000/1 1000/1 0/0',
    format('peso de P con un archivo subido fuera de la papelera de Drive: %s', pg_temp.size_of(pg_temp.u('1001')));
end; $$;
-- Pasados los 30 días de la papelera de Drive, a1 deja de contar y P no suma nada.
select pg_temp.as_postgres();
update public.files set uploaded_at = now() - interval '40 days', drive_trashed_at = now() - interval '31 days'
where id = pg_temp.u('3001');
update public.files set trashed_at = now(), purged_at = now(), drive_trashed_at = now() - interval '31 days',
                        uploaded_at = now() - interval '40 days'
where id = pg_temp.u('3005');
select pg_temp.as_user('0001');
do $$ begin
  assert pg_temp.size_of(pg_temp.u('1001')) = '0/0 0/0 0/0 0/0',
    format('peso de P a los 30 días de la papelera de Drive: %s', pg_temp.size_of(pg_temp.u('1001')));
end; $$;

-- La dueña que no ve un proyecto: lo suyo nunca subido, purgado, tampoco suma en la fila sin nombre. M es de la admin,
-- privado (solo ella), borrado para siempre con un archivo nunca subido.
select pg_temp.as_postgres();
insert into public.workspaces (id, owner_id, name) values (pg_temp.u('1004'), pg_temp.u('0002'), 'M');
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values (pg_temp.u('2007'), pg_temp.u('1004'), null, 'm1', 'a0');
insert into public.grants (user_id, project_id, page_id, level) values (pg_temp.u('0002'), pg_temp.u('1004'), null, 'edit_pages');
insert into public.files (id, project_id, name, mime, size, drive_id, uploaded_at, created_by) values
  (pg_temp.u('3006'), pg_temp.u('1004'), 'm.jpg', 'image/jpeg', 9, null, null, null);
insert into public.page_files (page_id, file_id, is_foreign) values (pg_temp.u('2007'), pg_temp.u('3006'), false);
select pg_temp.as_user('0001');
create temp table hidden_before as
  select coalesce((select s.pending_bytes + s.trash_bytes from public.project_sizes() s where s.project_id is null), 0) as v,
         exists (select 1 from public.project_sizes() s where s.project_id = pg_temp.u('1004')) as sees_m;
select pg_temp.as_postgres();
update public.workspaces set deleted_at = now() - interval '31 days', purged_at = now(), purged_by = pg_temp.u('0002')
where id = pg_temp.u('1004');
update public.files set trashed_at = now() where id = pg_temp.u('3006');
select pg_temp.as_user('0001');
do $$
declare
  hb record;
  now_v bigint;
begin
  select * into hb from pg_temp.hidden_before;
  assert not hb.sees_m, 'la dueña ve el peso del proyecto privado de la admin';
  now_v := coalesce((select s.pending_bytes + s.trash_bytes from public.project_sizes() s where s.project_id is null), 0);
  -- M sumaba 9 sin subir en la fila sin nombre; purgado, ya no suma (ni sin subir ni en la papelera de la app).
  assert hb.v - now_v = 9, format('la fila sin nombre: antes %s, ahora %s', hb.v, now_v);
end;
$$;

-- anon no pide el peso.
select set_config('role', 'anon', true);
select set_config('request.jwt.claims', '', true);
do $$ begin
  perform pg_temp.expect_error($q$select * from public.project_sizes()$q$, '42501', 'anon pide el peso');
end; $$;

-- ---------------------------------------------------------------------------------------------------
-- 2. Los archivos de los links de una página, con el total exacto
-- ---------------------------------------------------------------------------------------------------
-- l1: un link anterior (revocado) con 3 archivos y el vivo con 500 (503 en total). l2: un link con 2. l3: sin link.
select pg_temp.as_postgres();
insert into public.public_links (id, page_id, token, token_hash, level, created_by, created_at, revoked_at, revoked_by) values
  (pg_temp.u('5001'), pg_temp.u('2004'), 'sdl_' || repeat('a', 43), extensions.digest('sdl_' || repeat('a', 43), 'sha256'),
   'edit', pg_temp.u('0001'), now() - interval '2 days', now() - interval '1 day', pg_temp.u('0001')),
  (pg_temp.u('5002'), pg_temp.u('2004'), 'sdl_' || repeat('b', 43), extensions.digest('sdl_' || repeat('b', 43), 'sha256'),
   'edit', pg_temp.u('0001'), now() - interval '1 day', null, null),
  (pg_temp.u('5003'), pg_temp.u('2005'), 'sdl_' || repeat('c', 43), extensions.digest('sdl_' || repeat('c', 43), 'sha256'),
   'edit', pg_temp.u('0001'), now() - interval '1 day', null, null);
insert into public.files (id, project_id, name, mime, size, created_by, plink_id, created_at)
select gen_random_uuid(), pg_temp.u('1003'), 'viejo' || i || '.jpg', 'image/jpeg', 10, null, pg_temp.u('5001'),
       now() - interval '2 days' + i * interval '1 second'
from generate_series(1, 3) i;
insert into public.files (id, project_id, name, mime, size, created_by, plink_id, created_at)
select gen_random_uuid(), pg_temp.u('1003'), 'nuevo' || i || '.jpg', 'image/jpeg', 10, null, pg_temp.u('5002'),
       now() - interval '1 day' + i * interval '1 second'
from generate_series(1, 500) i;
insert into public.files (id, project_id, name, mime, size, created_by, plink_id, created_at)
select gen_random_uuid(), pg_temp.u('1003'), 'otro' || i || '.jpg', 'image/jpeg', 10, null, pg_temp.u('5003'), now()
from generate_series(1, 2) i;

select pg_temp.as_user('0001');
do $$ begin
  -- 500 filas (el tope de siempre), cada una con el total de verdad.
  assert (select count(*) from public.public_link_files(pg_temp.u('2004'))) = 500, 'l1 no devuelve 500 filas';
  assert (select array_agg(distinct t.total) from public.public_link_files(pg_temp.u('2004')) t) = array[503]::bigint[],
    format('el total de l1: %s', (select array_agg(distinct t.total) from public.public_link_files(pg_temp.u('2004')) t));
  -- La lista sigue siendo la de antes: las 500 más nuevas (las del link vivo), de la más nueva a la más vieja.
  assert (select bool_and(t.link_id = pg_temp.u('5002') and t.link_live) from public.public_link_files(pg_temp.u('2004')) t),
    'l1 no lista primero las más nuevas';
  assert (select array_agg(distinct t.total) from public.public_link_files(pg_temp.u('2005')) t) = array[2]::bigint[],
    'el total de l2';
  assert (select count(*) from public.public_link_files(pg_temp.u('2005'))) = 2, 'l2 no devuelve 2 filas';
  assert (select count(*) from public.public_link_files(pg_temp.u('2006'))) = 0, 'l3 devuelve filas';
  -- Las columnas de antes, en su lugar (la app publicada las pide por nombre): `total` va al final.
  assert (select string_agg(a, ',' order by n) from unnest(
            (select p.proargnames from pg_proc p where p.oid = 'public.public_link_files(uuid)'::regprocedure))
            with ordinality x(a, n))
         = 'p_page,id,link_id,link_live,page_id,name,mime,size,created_at,uploaded,trashed,total',
    'las columnas de public_link_files cambiaron de orden';
end; $$;
-- La admin con ver no ve lo borrado de la página: no lista (ni el total).
select pg_temp.as_user('0003');
do $$ begin
  perform pg_temp.expect_error(format('select * from public.public_link_files(%L)', pg_temp.u('2004')),
    'page_not_found', 'la admin con ver lista los archivos del link');
end; $$;
-- La admin con editar y crear sí, con el mismo total.
select pg_temp.as_user('0002');
do $$ begin
  assert (select array_agg(distinct t.total) from public.public_link_files(pg_temp.u('2004')) t) = array[503]::bigint[],
    'el total de l1 para la admin';
end; $$;
select set_config('role', 'anon', true);
select set_config('request.jwt.claims', '', true);
do $$ begin
  perform pg_temp.expect_error(format('select * from public.public_link_files(%L)', pg_temp.u('2004')),
    '42501', 'anon lista los archivos del link');
end; $$;

-- ---------------------------------------------------------------------------------------------------
-- 3. Cómo quedaron las funciones y la versión
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_postgres();
do $$
declare
  fn text;
begin
  foreach fn in array array['public.project_sizes()', 'public.public_link_files(uuid)'] loop
    assert (select p.prosecdef and p.proconfig @> array['search_path=""'] and p.provolatile = 's' from pg_proc p
            where p.oid = fn::regprocedure), format('%s no es security definer, estable y con search_path vacío', fn);
    assert not has_function_privilege('anon', fn, 'execute'), format('anon llama a %s', fn);
    assert has_function_privilege('authenticated', fn, 'execute'), format('authenticated no llama a %s', fn);
  end loop;
  assert (select schema_version from public.workspace_settings where id) >= 25, 'la versión de la base no es 25';
end;
$$;

rollback;

select 'ok' as result;
