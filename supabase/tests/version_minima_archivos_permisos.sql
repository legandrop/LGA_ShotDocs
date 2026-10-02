-- Pruebas de la versión mínima en la cola de archivos (20261006120000_version_minima_archivos.sql): `register_file`,
-- `link_page_file` y `unlink_page_file` con la versión de la app, y las de siempre (sin versión), que dejan de andar
-- solo con una mínima de 0.090 o más. Lo rechazado no escribe nada. Corre dentro de una transacción que se deshace
-- al final: no deja usuarios ni datos. Si todo pasa, devuelve una fila con result = 'ok'.

begin;

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
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

-- Cuántas filas de archivos y de usos (sin marcar) hay: lo rechazado no cambia nada.
create function pg_temp.counts() returns text language sql as $$
  select (select count(*) from public.files)::text || '/' ||
         (select count(*) from public.page_files where removed_at is null)::text;
$$;

-- Personas: a (dueña del proyecto P) y b (sin permiso en P).
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-0000000009a1', 'vm-a@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000009b1', 'vm-b@test.invalid', 'authenticated', 'authenticated');
insert into public.members (user_id, role) values
  ('00000000-0000-4000-8000-0000000009a1', 'member'),
  ('00000000-0000-4000-8000-0000000009b1', 'member');
insert into public.workspaces (id, owner_id, name) values
  ('00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-0000000009a1', 'P');
insert into public.pages (id, workspace_id, title, sort_key) values
  ('00000000-0000-4000-8000-0000000009d1', '00000000-0000-4000-8000-0000000009e1', 'p1', 'a0'),
  ('00000000-0000-4000-8000-0000000009d2', '00000000-0000-4000-8000-0000000009e1', 'p2', 'a1');

-- ---------------------------------------------------------------------------------------------------
-- Sin mínima: todo anda, con versión, sin versión y con las de siempre.
-- ---------------------------------------------------------------------------------------------------
update public.workspace_settings set min_app_version = null;
select pg_temp.as_user('00000000-0000-4000-8000-0000000009a1');
do $$
declare
  p1 constant uuid := '00000000-0000-4000-8000-0000000009d1';
  p2 constant uuid := '00000000-0000-4000-8000-0000000009d2';
  f1 constant uuid := '00000000-0000-4000-8000-0000000009f1';
  f2 constant uuid := '00000000-0000-4000-8000-0000000009f2';
begin
  assert public.register_file(f1, p1, 'IMG_0001.JPG', 'image/jpeg', 1000, 10, 10, null) = 'ok', 'sin mínima: la de siempre no registra';
  assert public.register_file(f2, p1, 'IMG_0002.JPG', 'image/jpeg', 1000, 10, 10, null, '0.090') = 'ok', 'sin mínima: con versión no registra';
  assert public.link_page_file(p2, f1) = 'ok', 'sin mínima: la de siempre no usa';
  assert public.link_page_file(p2, f2, null) = 'ok', 'sin mínima: sin versión no usa';
  assert public.unlink_page_file(p2, f1), 'sin mínima: la de siempre (2) no deja de usar';
  assert public.unlink_page_file(p2, f2, null, '0.001'), 'sin mínima: con versión no deja de usar';
  assert pg_temp.counts() = '2/2', 'sin mínima: quedó ' || pg_temp.counts();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Mínima menor a 0.090: con versión se compara; sin versión (las de siempre) anda, porque quien llama puede
-- ser una versión permitida.
-- ---------------------------------------------------------------------------------------------------
select set_config('role', 'postgres', true);
update public.workspace_settings set min_app_version = 0.085;
select pg_temp.as_user('00000000-0000-4000-8000-0000000009a1');
do $$
declare
  p1 constant uuid := '00000000-0000-4000-8000-0000000009d1';
  p2 constant uuid := '00000000-0000-4000-8000-0000000009d2';
  f1 constant uuid := '00000000-0000-4000-8000-0000000009f1';
  f3 constant uuid := '00000000-0000-4000-8000-0000000009f3';
  f4 constant uuid := '00000000-0000-4000-8000-0000000009f4';
begin
  perform pg_temp.expect_error(
    format('select public.register_file(%L, %L, %L, %L, 1000, null, null, null, %L)', f3, p1, 'IMG_0003.HEIC', 'image/heic', '0.084'),
    'app_outdated', 'mínima 0.085: registra una 0.084');
  perform pg_temp.expect_error(format('select public.link_page_file(%L, %L, %L)', p2, f1, '0.084'),
    'app_outdated', 'mínima 0.085: usa una 0.084');
  perform pg_temp.expect_error(format('select public.unlink_page_file(%L, %L, null, %L)', p1, f1, '0.084'),
    'app_outdated', 'mínima 0.085: deja de usar una 0.084');
  assert pg_temp.counts() = '2/2', 'mínima 0.085: lo rechazado escribió algo: ' || pg_temp.counts();

  assert public.register_file(f3, p1, 'IMG_0003.JPG', 'image/jpeg', 1000, null, null, null, '0.085') = 'ok', 'mínima 0.085: la 0.085 no registra';
  assert public.register_file(f4, p1, 'IMG_0004.JPG', 'image/jpeg', 1000, null, null, null) = 'ok', 'mínima 0.085: la de siempre no registra';
  assert public.link_page_file(p2, f1) = 'ok', 'mínima 0.085: la de siempre no usa';
  assert public.unlink_page_file(p2, f1, null), 'mínima 0.085: la de siempre (3) no deja de usar';
  assert pg_temp.counts() = '4/4', 'mínima 0.085: quedó ' || pg_temp.counts();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Mínima 0.090 o más: las de siempre (versiones anteriores a 0.090) y las versiones menores no escriben nada.
-- ---------------------------------------------------------------------------------------------------
select set_config('role', 'postgres', true);
update public.workspace_settings set min_app_version = 0.090;
select pg_temp.as_user('00000000-0000-4000-8000-0000000009a1');
do $$
declare
  p1 constant uuid := '00000000-0000-4000-8000-0000000009d1';
  p2 constant uuid := '00000000-0000-4000-8000-0000000009d2';
  f1 constant uuid := '00000000-0000-4000-8000-0000000009f1';
  f5 constant uuid := '00000000-0000-4000-8000-0000000009f5';
  f6 constant uuid := '00000000-0000-4000-8000-0000000009f6';
  v  text;
begin
  perform pg_temp.expect_error(
    format('select public.register_file(%L, %L, %L, %L, 1000, null, null, null)', f5, p1, 'IMG_0005.HEIC', 'image/heic'),
    'app_outdated', 'mínima 0.090: la de siempre registra');
  perform pg_temp.expect_error(format('select public.link_page_file(%L, %L)', p2, f1),
    'app_outdated', 'mínima 0.090: la de siempre usa');
  perform pg_temp.expect_error(format('select public.unlink_page_file(%L, %L)', p1, f1),
    'app_outdated', 'mínima 0.090: la de siempre (2) deja de usar');
  perform pg_temp.expect_error(format('select public.unlink_page_file(%L, %L, 5)', p1, f1),
    'app_outdated', 'mínima 0.090: la de siempre (3) deja de usar');
  foreach v in array array['0.089', 'abc', ''] loop
    perform pg_temp.expect_error(
      format('select public.register_file(%L, %L, %L, %L, 1000, null, null, null, %L)', f5, p1, 'IMG_0005.JPG', 'image/jpeg', v),
      'app_outdated', 'mínima 0.090: registra con versión ' || quote_literal(v));
  end loop;
  perform pg_temp.expect_error(
    format('select public.register_file(%L, %L, %L, %L, 1000, null, null, null, null)', f5, p1, 'IMG_0005.JPG', 'image/jpeg'),
    'app_outdated', 'mínima 0.090: registra sin versión');
  perform pg_temp.expect_error(format('select public.link_page_file(%L, %L, %L)', p2, f1, '0.089'),
    'app_outdated', 'mínima 0.090: usa una 0.089');
  perform pg_temp.expect_error(format('select public.unlink_page_file(%L, %L, null, %L)', p1, f1, '0.089'),
    'app_outdated', 'mínima 0.090: deja de usar una 0.089');
  assert pg_temp.counts() = '4/4', 'mínima 0.090: lo rechazado escribió algo: ' || pg_temp.counts();
  assert not exists (select 1 from public.files where id = f5), 'mínima 0.090: quedó el archivo rechazado';

  -- La mínima y las mayores andan; reintentar no duplica.
  assert public.register_file(f5, p1, 'IMG_0005.JPG', 'image/jpeg', 1000, null, null, null, '0.090') = 'ok', 'mínima 0.090: la 0.090 no registra';
  assert public.register_file(f5, p1, 'IMG_0005.JPG', 'image/jpeg', 1000, null, null, null, '0.090') = 'ok', 'mínima 0.090: reintentar falla';
  assert public.register_file(f6, p1, 'IMG_0006.JPG', 'image/jpeg', 1000, null, null, null, '1.2') = 'ok', 'mínima 0.090: una mayor no registra';
  assert public.link_page_file(p2, f1, '0.090') = 'ok', 'mínima 0.090: la 0.090 no usa';
  assert public.unlink_page_file(p2, f1, null, '0.091'), 'mínima 0.090: la 0.091 no deja de usar';
  assert pg_temp.counts() = '6/6', 'mínima 0.090: quedó ' || pg_temp.counts();
end;
$$;

-- El permiso va antes que la versión (como en push_page_update): sin permiso, el error de siempre.
select pg_temp.as_user('00000000-0000-4000-8000-0000000009b1');
do $$
begin
  perform pg_temp.expect_error(
    format('select public.register_file(%L, %L, %L, %L, 1000, null, null, null, %L)',
      '00000000-0000-4000-8000-0000000009f7', '00000000-0000-4000-8000-0000000009d1', 'x.jpg', 'image/jpeg', '0.089'),
    'page_not_found', 'sin permiso: registra o dice otra cosa');
  perform pg_temp.expect_error(
    format('select public.link_page_file(%L, %L, %L)',
      '00000000-0000-4000-8000-0000000009d1', '00000000-0000-4000-8000-0000000009f1', '9.999'),
    'page_not_found', 'sin permiso: usa o dice otra cosa');
end;
$$;

-- Sin sesión: nada.
select set_config('role', 'anon', true);
do $$
begin
  perform pg_temp.expect_error(
    format('select public.register_file(%L, %L, %L, %L, 1000, null, null, null, %L)',
      '00000000-0000-4000-8000-0000000009f8', '00000000-0000-4000-8000-0000000009d1', 'x.jpg', 'image/jpeg', '9.999'),
    '42501', 'anon llama a register_file con versión');
  perform pg_temp.expect_error(
    format('select public.link_page_file(%L, %L, %L)',
      '00000000-0000-4000-8000-0000000009d1', '00000000-0000-4000-8000-0000000009f1', '9.999'),
    '42501', 'anon llama a link_page_file con versión');
  perform pg_temp.expect_error(
    format('select public.unlink_page_file(%L, %L, null, %L)',
      '00000000-0000-4000-8000-0000000009d1', '00000000-0000-4000-8000-0000000009f1', '9.999'),
    '42501', 'anon llama a unlink_page_file con versión');
  perform pg_temp.expect_error($q$select private.files_version_allowed('9.999')$q$, '42501', 'anon pregunta la versión');
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-0000000009a1');
do $$
begin
  perform pg_temp.expect_error($q$select private.files_version_allowed('9.999')$q$, '42501',
    'una sesión llama a private.files_version_allowed');
end;
$$;

rollback;

select 'ok' as result;
