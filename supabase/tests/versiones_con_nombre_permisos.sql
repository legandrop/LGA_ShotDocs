-- Pruebas de las versiones con nombre (20261011120000_versiones_con_nombre.sql, Docs/Doc_Historial.md): nombrar,
-- renombrar, sacar el nombre y marcar una restauración, con los permisos del historial (nivel 3 o más, no invitado,
-- no en la papelera, por la página o una de arriba y nunca por una de abajo), renombrar y sacar solo quien lo puso o
-- nivel 4, la versión mínima de la app (header `x-shotdocs-version`), los nombres de una fila que ya no es la misma
-- (copia de seguridad restaurada) y la tabla cerrada a la API. Corre dentro de una transacción que se deshace al
-- final: no deja usuarios ni datos. Si todo pasa, devuelve una fila con result = 'ok'.

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

-- Nada del historial con nombre para esta persona en esa página (ni ver, ni nombrar, ni marcar).
create function pg_temp.expect_no_versions(page uuid, label text, expected text default 'page_not_found') returns void language plpgsql as $$
begin
  perform pg_temp.expect_error(format('select * from public.list_page_versions(%L)', page), expected, label || ': ve los nombres');
  perform pg_temp.expect_error(format('select public.name_page_version(gen_random_uuid(), %L, 1, %L)', page, 'x'),
    expected, label || ': nombra una versión');
  perform pg_temp.expect_error(format('select public.mark_page_restored(gen_random_uuid(), %L, 2, 1)', page),
    expected, label || ': marca una restauración');
end;
$$;

-- Personas: a (creó el proyecto P: nivel 4), e (Editar), d (Editar y crear páginas), c (Comentar), v (Ver), g (invitado
-- con Editar), x (sin permiso), s (Editar solo sobre la página de abajo) y k (Editar solo sobre la de arriba).
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-0000000b1a01', 'ver-a@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000b1e01', 'ver-e@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000b1d01', 'ver-d@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000b1c01', 'ver-c@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000b1f01', 'ver-v@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000b1b01', 'ver-g@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000b1001', 'ver-x@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000b1501', 'ver-s@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000b1601', 'ver-k@test.invalid', 'authenticated', 'authenticated');
insert into public.members (user_id, role) values
  ('00000000-0000-4000-8000-0000000b1a01', 'member'),
  ('00000000-0000-4000-8000-0000000b1e01', 'member'),
  ('00000000-0000-4000-8000-0000000b1d01', 'member'),
  ('00000000-0000-4000-8000-0000000b1c01', 'member'),
  ('00000000-0000-4000-8000-0000000b1f01', 'member'),
  ('00000000-0000-4000-8000-0000000b1b01', 'guest'),
  ('00000000-0000-4000-8000-0000000b1001', 'member'),
  ('00000000-0000-4000-8000-0000000b1501', 'member'),
  ('00000000-0000-4000-8000-0000000b1601', 'member');
insert into public.workspaces (id, owner_id, name) values
  ('00000000-0000-4000-8000-0000000b1e09', '00000000-0000-4000-8000-0000000b1a01', 'P');
-- p1 (arriba) con p1c adentro; t (en la papelera) con t2 adentro.
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  ('00000000-0000-4000-8000-0000000b1d09', '00000000-0000-4000-8000-0000000b1e09', null, 'p1', 'a0'),
  ('00000000-0000-4000-8000-0000000b1d0c', '00000000-0000-4000-8000-0000000b1e09', '00000000-0000-4000-8000-0000000b1d09', 'p1c', 'a1'),
  ('00000000-0000-4000-8000-0000000b1d0a', '00000000-0000-4000-8000-0000000b1e09', null, 't', 'a2'),
  ('00000000-0000-4000-8000-0000000b1d0b', '00000000-0000-4000-8000-0000000b1e09', '00000000-0000-4000-8000-0000000b1d0a', 't2', 'a3');
insert into public.grants (user_id, project_id, page_id, level) values
  ('00000000-0000-4000-8000-0000000b1e01', '00000000-0000-4000-8000-0000000b1e09', null, 'edit'),
  ('00000000-0000-4000-8000-0000000b1d01', '00000000-0000-4000-8000-0000000b1e09', null, 'edit_pages'),
  ('00000000-0000-4000-8000-0000000b1c01', '00000000-0000-4000-8000-0000000b1e09', null, 'comment'),
  ('00000000-0000-4000-8000-0000000b1f01', '00000000-0000-4000-8000-0000000b1e09', null, 'view'),
  ('00000000-0000-4000-8000-0000000b1b01', '00000000-0000-4000-8000-0000000b1e09', null, 'edit'),
  ('00000000-0000-4000-8000-0000000b1501', null, '00000000-0000-4000-8000-0000000b1d0c', 'edit'),
  ('00000000-0000-4000-8000-0000000b1601', null, '00000000-0000-4000-8000-0000000b1d09', 'edit');

-- Subidas de verdad (`push_page_update`), con la sesión de quien sube: p1 seq 1 (a), 2 (e), 3 (a); p1c seq 1 (a);
-- t y t2 seq 1 (a).
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1a01');
select public.push_page_update('00000000-0000-4000-8000-0000000b1d09', '00000000-0000-4000-8000-0000000b1101', 'AAA=', '9.999');
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1e01');
select public.push_page_update('00000000-0000-4000-8000-0000000b1d09', '00000000-0000-4000-8000-0000000b1102', 'AAA=', '9.999');
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1a01');
select public.push_page_update('00000000-0000-4000-8000-0000000b1d09', '00000000-0000-4000-8000-0000000b1103', 'AAA=', '9.999');
select public.push_page_update('00000000-0000-4000-8000-0000000b1d0c', '00000000-0000-4000-8000-0000000b1104', 'AAA=', '9.999');
select public.push_page_update('00000000-0000-4000-8000-0000000b1d0a', '00000000-0000-4000-8000-0000000b1105', 'AAA=', '9.999');
select public.push_page_update('00000000-0000-4000-8000-0000000b1d0b', '00000000-0000-4000-8000-0000000b1106', 'AAA=', '9.999');

-- t a la papelera (con t2 adentro); la mínima en 0.099 (la de la base hoy), para probar el header.
select pg_temp.as_console();
update public.pages set deleted_at = now() where id = '00000000-0000-4000-8000-0000000b1d0a';
update public.workspace_settings set min_app_version = 0.099 where id;

-- ---------------------------------------------------------------------------------------------------
-- e (Editar) nombra; reintentar devuelve la misma; los errores de lo que pide.
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1e01');
do $$
declare
  p1 constant uuid := '00000000-0000-4000-8000-0000000b1d09';
  r public.page_version_row;
begin
  r := public.name_page_version('00000000-0000-4000-8000-0000000b1701', p1, 1, '  Antes   del   rodaje ');
  assert r.label = 'Antes del rodaje' and r.kind = 'named' and r.seq = 1, 'e: el nombre no quedó como se pidió';
  assert r.created_by = '00000000-0000-4000-8000-0000000b1e01', 'e: el nombre no es de quien lo puso';
  r := public.name_page_version('00000000-0000-4000-8000-0000000b1701', p1, 1, 'Otro texto');
  assert r.label = 'Antes del rodaje', 'e: reintentar el mismo pedido no devolvió el que había';
  assert (select count(*) from public.list_page_versions(p1)) = 1, 'e: reintentar duplicó el nombre';
  perform pg_temp.expect_error($q$select public.name_page_version('00000000-0000-4000-8000-0000000b1701', '00000000-0000-4000-8000-0000000b1d09', 2, 'x')$q$,
    'version_conflict', 'el mismo id para otra versión');
  perform pg_temp.expect_error($q$select public.name_page_version('00000000-0000-4000-8000-0000000b1701', '00000000-0000-4000-8000-0000000b1d0c', 1, 'x')$q$,
    'version_conflict', 'el mismo id para otra página');
  perform pg_temp.expect_error($q$select public.name_page_version(gen_random_uuid(), '00000000-0000-4000-8000-0000000b1d09', 1, 'Otro')$q$,
    'version_named', 'dos nombres vigentes para la misma versión');
  perform pg_temp.expect_error($q$select public.name_page_version(gen_random_uuid(), '00000000-0000-4000-8000-0000000b1d09', 99, 'x')$q$,
    'version_not_found', 'una fila que no existe');
  perform pg_temp.expect_error($q$select public.name_page_version(gen_random_uuid(), '00000000-0000-4000-8000-0000000b1d09', 2, '   ')$q$,
    'label_invalid', 'un nombre vacío');
  perform pg_temp.expect_error(format('select public.name_page_version(gen_random_uuid(), %L, 2, %L)', p1, repeat('x', 101)),
    'label_invalid', 'un nombre de más de 100');
  r := public.name_page_version('00000000-0000-4000-8000-0000000b1702', p1, 2, 'Rodaje');
  assert (select string_agg(label, ',' order by seq) from public.list_page_versions(p1)) = 'Antes del rodaje,Rodaje',
    'e: la lista no trae los dos nombres en orden';
end;
$$;

-- a (creador, nivel 4) los ve; d (Editar y crear) también.
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1a01');
do $$
begin
  assert (select count(*) from public.list_page_versions('00000000-0000-4000-8000-0000000b1d09')) = 2, 'a: no ve los nombres';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Ver, Comentar, invitado con Editar y sin permiso: nada.
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1f01');
select pg_temp.expect_no_versions('00000000-0000-4000-8000-0000000b1d09', 'Ver');
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1c01');
select pg_temp.expect_no_versions('00000000-0000-4000-8000-0000000b1d09', 'Comentar');
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1b01');
select pg_temp.expect_no_versions('00000000-0000-4000-8000-0000000b1d09', 'invitado con Editar');
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1001');
select pg_temp.expect_no_versions('00000000-0000-4000-8000-0000000b1d09', 'sin permiso');
-- Tampoco renombran ni sacan un nombre ajeno (no ven la página).
do $$
begin
  perform pg_temp.expect_error($q$select public.rename_page_version('00000000-0000-4000-8000-0000000b1701', 'x')$q$,
    'page_not_found', 'sin permiso renombra');
  perform pg_temp.expect_error($q$select public.remove_page_version('00000000-0000-4000-8000-0000000b1701')$q$,
    'page_not_found', 'sin permiso saca el nombre');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1b01');
do $$
begin
  perform pg_temp.expect_error($q$select public.rename_page_version('00000000-0000-4000-8000-0000000b1701', 'x')$q$,
    'page_not_found', 'el invitado con Editar renombra');
  perform pg_temp.expect_error($q$select public.remove_page_version('00000000-0000-4000-8000-0000000b1701')$q$,
    'page_not_found', 'el invitado con Editar saca el nombre');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Por la página o una de arriba, nunca por una de abajo.
-- ---------------------------------------------------------------------------------------------------
-- s edita solo p1c: nada en p1 (la de arriba), sí en p1c.
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1501');
select pg_temp.expect_no_versions('00000000-0000-4000-8000-0000000b1d09', 'Editar sobre la de abajo');
do $$
begin
  perform public.name_page_version('00000000-0000-4000-8000-0000000b1703', '00000000-0000-4000-8000-0000000b1d0c', 1, 'De s');
  assert (select count(*) from public.list_page_versions('00000000-0000-4000-8000-0000000b1d0c')) = 1, 's: no nombra en su página';
end;
$$;
-- Nombres raros: se guardan literal (sin interpretar nada); saltos de línea y tabulaciones, un espacio; se cuentan
-- letras, no bytes; nulo, vacío o de más de 100, rechazados. Un seq que solo existe en otra página, no.
do $$
declare
  r public.page_version_row;
begin
  r := public.rename_page_version('00000000-0000-4000-8000-0000000b1703', $l$x'); drop table public.page_versions; --$l$);
  assert r.label = $l$x'); drop table public.page_versions; --$l$, 'el nombre con comillas no quedó literal';
  assert to_regclass('public.page_versions') is not null, 'la tabla desapareció';
  r := public.rename_page_version('00000000-0000-4000-8000-0000000b1703', E'línea\nnueva\ttab');
  assert r.label = 'línea nueva tab', 'los saltos de línea no se volvieron un espacio: ' || r.label;
  r := public.rename_page_version('00000000-0000-4000-8000-0000000b1703', repeat('ñ', 100));
  assert char_length(r.label) = 100, '100 ñ';
  perform pg_temp.expect_error(format('select public.rename_page_version(%L, %L)', '00000000-0000-4000-8000-0000000b1703', repeat('ñ', 101)),
    'label_invalid', '101 ñ');
  perform pg_temp.expect_error(format('select public.rename_page_version(%L, null)', '00000000-0000-4000-8000-0000000b1703'),
    'label_invalid', 'renombrar a nulo');
  r := public.rename_page_version('00000000-0000-4000-8000-0000000b1703', 'De s');
  perform pg_temp.expect_error($q$select public.name_page_version(gen_random_uuid(), '00000000-0000-4000-8000-0000000b1d0c', 3, 'x')$q$,
    'version_not_found', 'un seq que solo existe en otra página');
end;
$$;
-- k edita p1 (compartida arriba): nombra en p1c, que hereda.
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1601');
do $$
begin
  assert (select count(*) from public.list_page_versions('00000000-0000-4000-8000-0000000b1d0c')) = 1, 'k: no ve los nombres de la de abajo';
  assert (select count(*) from public.list_page_versions('00000000-0000-4000-8000-0000000b1d09')) = 2, 'k: no ve los nombres de su página';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Renombrar y sacar: quien lo puso o nivel 4; k (Editar, no lo puso) no.
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1601');
do $$
begin
  perform pg_temp.expect_error($q$select public.rename_page_version('00000000-0000-4000-8000-0000000b1701', 'De k')$q$,
    'not_allowed', 'Editar renombra un nombre ajeno');
  perform pg_temp.expect_error($q$select public.remove_page_version('00000000-0000-4000-8000-0000000b1701')$q$,
    'not_allowed', 'Editar saca un nombre ajeno');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1e01');
do $$
declare
  r public.page_version_row;
begin
  r := public.rename_page_version('00000000-0000-4000-8000-0000000b1701', 'Antes del rodaje (final)');
  assert r.label = 'Antes del rodaje (final)', 'e: no renombra el suyo';
  perform pg_temp.expect_error($q$select public.rename_page_version('00000000-0000-4000-8000-0000000b1701', '')$q$,
    'label_invalid', 'renombrar a vacío');
  perform pg_temp.expect_error($q$select public.rename_page_version(gen_random_uuid(), 'x')$q$,
    'version_not_found', 'renombrar uno que no existe');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1d01');
do $$
begin
  assert (public.rename_page_version('00000000-0000-4000-8000-0000000b1702', 'Rodaje día 1')).label = 'Rodaje día 1',
    'd (Editar y crear): no renombra uno ajeno';
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1a01');
do $$
begin
  perform public.remove_page_version('00000000-0000-4000-8000-0000000b1702');
  perform public.remove_page_version('00000000-0000-4000-8000-0000000b1702');
  assert (select string_agg(label, ',') from public.list_page_versions('00000000-0000-4000-8000-0000000b1d09')) = 'Antes del rodaje (final)',
    'a: el nombre sacado sigue en la lista';
  perform pg_temp.expect_error($q$select public.rename_page_version('00000000-0000-4000-8000-0000000b1702', 'x')$q$,
    'version_not_found', 'renombrar uno sacado');
  -- Con el nombre sacado, esa versión se puede volver a nombrar.
  perform public.name_page_version('00000000-0000-4000-8000-0000000b1704', '00000000-0000-4000-8000-0000000b1d09', 2, 'Rodaje otra vez');
end;
$$;
-- Un nombre de alguien cuya cuenta se borró (`created_by` nulo): Editar no lo cambia, nivel 4 sí.
select pg_temp.as_console();
update public.page_versions set created_by = null where id = '00000000-0000-4000-8000-0000000b1704';
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1601');
do $$
begin
  perform pg_temp.expect_error($q$select public.rename_page_version('00000000-0000-4000-8000-0000000b1704', 'De k')$q$,
    'not_allowed', 'Editar renombra el nombre de una cuenta borrada');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1d01');
do $$
begin
  assert (public.rename_page_version('00000000-0000-4000-8000-0000000b1704', 'Rodaje otra vez')).label = 'Rodaje otra vez',
    'd (Editar y crear): no renombra el de una cuenta borrada';
end;
$$;

-- Sacarlo otra vez, ahora d (nivel 4), no pisa quién ni cuándo; y reintentar nombrar con el id de uno sacado no lo
-- devuelve (la respuesta de antes se perdió y alguien lo sacó en el medio).
select pg_temp.as_console();
create temp table removed_before on commit drop as
  select removed_at from public.page_versions where id = '00000000-0000-4000-8000-0000000b1702';
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1d01');
select public.remove_page_version('00000000-0000-4000-8000-0000000b1702');
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1e01');
do $$
begin
  perform pg_temp.expect_error($q$select public.name_page_version('00000000-0000-4000-8000-0000000b1702', '00000000-0000-4000-8000-0000000b1d09', 2, 'Rodaje')$q$,
    'version_not_found', 'reintentar el id de un nombre sacado lo devuelve');
end;
$$;

-- Sacar el nombre no borra la fila: queda con quién y cuándo.
select pg_temp.as_console();
do $$
begin
  assert (select v.removed_at = b.removed_at from public.page_versions v, removed_before b
          where v.id = '00000000-0000-4000-8000-0000000b1702'), 'sacar otra vez cambió cuándo se sacó';
end;
$$;
do $$
begin
  assert (select removed_at is not null and removed_by = '00000000-0000-4000-8000-0000000b1a01' and label = 'Rodaje día 1'
          from public.page_versions where id = '00000000-0000-4000-8000-0000000b1702'), 'sacar el nombre borró la fila o no dice quién';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- La marca de restauración: solo sobre una fila propia, de una versión anterior; no se renombra ni se saca.
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1a01');
do $$
declare
  r public.page_version_row;
begin
  r := public.mark_page_restored('00000000-0000-4000-8000-0000000b1705', '00000000-0000-4000-8000-0000000b1d09', 3, 1);
  assert r.kind = 'restore' and r.restored_from_seq = 1 and r.seq = 3 and r.label is null, 'a: la marca no quedó';
  r := public.mark_page_restored('00000000-0000-4000-8000-0000000b1705', '00000000-0000-4000-8000-0000000b1d09', 3, 1);
  perform pg_temp.expect_error($q$select public.mark_page_restored('00000000-0000-4000-8000-0000000b1705', '00000000-0000-4000-8000-0000000b1d09', 3, 2)$q$,
    'version_conflict', 'el mismo id con otro origen');
  perform pg_temp.expect_error($q$select public.mark_page_restored(gen_random_uuid(), '00000000-0000-4000-8000-0000000b1d09', 2, 1)$q$,
    'version_not_found', 'marcar una fila de otra persona');
  perform pg_temp.expect_error($q$select public.mark_page_restored(gen_random_uuid(), '00000000-0000-4000-8000-0000000b1d09', 3, 3)$q$,
    'version_not_found', 'restaurada desde ella misma');
  perform pg_temp.expect_error($q$select public.mark_page_restored(gen_random_uuid(), '00000000-0000-4000-8000-0000000b1d09', 3, 77)$q$,
    'version_not_found', 'restaurada desde una que no existe');
  perform pg_temp.expect_error($q$select public.mark_page_restored(gen_random_uuid(), '00000000-0000-4000-8000-0000000b1d09', 3, 0)$q$,
    'version_not_found', 'restaurada desde una fila anterior que no existe (0)');
  perform pg_temp.expect_error($q$select public.rename_page_version('00000000-0000-4000-8000-0000000b1705', 'x')$q$,
    'version_not_named', 'renombrar una marca de restauración');
  perform pg_temp.expect_error($q$select public.remove_page_version('00000000-0000-4000-8000-0000000b1705')$q$,
    'version_not_named', 'sacar una marca de restauración');
  assert (select count(*) from public.list_page_versions('00000000-0000-4000-8000-0000000b1d09') where kind = 'restore') = 1,
    'a: la lista no trae la marca';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- La papelera: ni ver ni nombrar en una página en la papelera o adentro de una (quien edita: page_in_trash; quien
-- solo ve: no la ve).
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1a01');
do $$
begin
  perform pg_temp.expect_error($q$select * from public.list_page_versions('00000000-0000-4000-8000-0000000b1d0a')$q$,
    'page_in_trash', 'los nombres de una página en la papelera');
  perform pg_temp.expect_error($q$select public.name_page_version(gen_random_uuid(), '00000000-0000-4000-8000-0000000b1d0b', 1, 'x')$q$,
    'page_in_trash', 'nombrar adentro de una página en la papelera');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1f01');
select pg_temp.expect_no_versions('00000000-0000-4000-8000-0000000b1d0b', 'Ver, en la papelera');
-- Mandar p1c a la papelera esconde su nombre también para quien lo puso.
select pg_temp.as_console();
update public.pages set deleted_at = now() where id = '00000000-0000-4000-8000-0000000b1d0c';
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1501');
select pg_temp.expect_no_versions('00000000-0000-4000-8000-0000000b1d0c', 'Editar, su página en la papelera', 'page_in_trash');
do $$
begin
  perform pg_temp.expect_error($q$select public.rename_page_version('00000000-0000-4000-8000-0000000b1703', 'x')$q$,
    'page_in_trash', 'renombrar en una página en la papelera');
  perform pg_temp.expect_error($q$select public.remove_page_version('00000000-0000-4000-8000-0000000b1703')$q$,
    'page_in_trash', 'sacar un nombre en una página en la papelera');
end;
$$;
select pg_temp.as_console();
update public.pages set deleted_at = null where id = '00000000-0000-4000-8000-0000000b1d0c';

-- ---------------------------------------------------------------------------------------------------
-- La versión mínima de la app: sin header (anterior a 0.099) o con una versión vieja, no escribe nada; repetir lo que
-- ya está no escribe y anda.
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1a01', null);
select pg_temp.expect_outdated($q$select public.name_page_version(gen_random_uuid(), '00000000-0000-4000-8000-0000000b1d09', 3, 'x')$q$, 'nombrar sin header');
select pg_temp.expect_outdated($q$select public.rename_page_version('00000000-0000-4000-8000-0000000b1704', 'x')$q$, 'renombrar sin header');
select pg_temp.expect_outdated($q$select public.remove_page_version('00000000-0000-4000-8000-0000000b1704')$q$, 'sacar sin header');
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1a01', '0.050');
select pg_temp.expect_outdated($q$select public.name_page_version(gen_random_uuid(), '00000000-0000-4000-8000-0000000b1d09', 3, 'x')$q$, 'nombrar con una versión vieja');
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1e01', null);
do $$
begin
  -- Leer y repetir lo que ya está, sí.
  assert (select count(*) from public.list_page_versions('00000000-0000-4000-8000-0000000b1d09')) = 3, 'sin header no lee';
  assert (public.name_page_version('00000000-0000-4000-8000-0000000b1701', '00000000-0000-4000-8000-0000000b1d09', 1, 'x')).label
    = 'Antes del rodaje (final)', 'sin header no repite lo que ya está';
end;
$$;
-- Una marca de restauración sin header: e sube una fila propia (con versión) y la marca sin header.
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1e01');
select public.push_page_update('00000000-0000-4000-8000-0000000b1d09', '00000000-0000-4000-8000-0000000b1107', 'AAA=', '9.999');
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1e01', null);
select pg_temp.expect_outdated($q$select public.mark_page_restored(gen_random_uuid(), '00000000-0000-4000-8000-0000000b1d09', 4, 2)$q$, 'marcar sin header');
select pg_temp.as_console();
do $$
begin
  assert (select count(*) from public.page_versions where page_id = '00000000-0000-4000-8000-0000000b1d09') = 4,
    'algo rechazado por la versión escribió';
  assert (select label from public.page_versions where id = '00000000-0000-4000-8000-0000000b1704') = 'Rodaje otra vez',
    'renombrar sin header cambió el nombre';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Una copia de seguridad restaurada: la fila con ese seq ya no es la misma (otro id) y su nombre deja de mostrarse.
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_console();
update public.page_updates set id = default
where page_id = '00000000-0000-4000-8000-0000000b1d09' and seq = 1;
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1e01');
do $$
begin
  assert (select string_agg(coalesce(label, 'restore'), ',' order by seq)
          from public.list_page_versions('00000000-0000-4000-8000-0000000b1d09')) = 'Rodaje otra vez,restore',
    'el nombre de una fila que ya no es la misma se sigue mostrando';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- La tabla no se lee ni se escribe directo; lo de private no se llama; anon no llama a nada.
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1a01');
do $$
begin
  perform pg_temp.expect_error($q$select count(*) from public.page_versions$q$, '42501', 'la sesión lee la tabla');
  perform pg_temp.expect_error($q$insert into public.page_versions (id, page_id, seq, update_id, kind, label) values (gen_random_uuid(), '00000000-0000-4000-8000-0000000b1d09', 2, 1, 'named', 'x')$q$,
    '42501', 'la sesión inserta en la tabla');
  perform pg_temp.expect_error($q$update public.page_versions set label = 'x'$q$, '42501', 'la sesión cambia la tabla');
  perform pg_temp.expect_error($q$delete from public.page_versions$q$, '42501', 'la sesión borra de la tabla');
  perform pg_temp.expect_error($q$select private.page_update_id('00000000-0000-4000-8000-0000000b1d09', 1)$q$, '42501', 'la sesión llama a page_update_id');
  perform pg_temp.expect_error($q$select private.can_manage_version('00000000-0000-4000-8000-0000000b1d09', null)$q$, '42501', 'la sesión llama a can_manage_version');
  perform pg_temp.expect_error($q$select private.version_label('x')$q$, '42501', 'la sesión llama a version_label');
end;
$$;
select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  perform pg_temp.expect_error($q$select * from public.list_page_versions('00000000-0000-4000-8000-0000000b1d09')$q$, '42501', 'anon lista');
  perform pg_temp.expect_error($q$select public.name_page_version(gen_random_uuid(), '00000000-0000-4000-8000-0000000b1d09', 2, 'x')$q$, '42501', 'anon nombra');
  perform pg_temp.expect_error($q$select public.rename_page_version('00000000-0000-4000-8000-0000000b1704', 'x')$q$, '42501', 'anon renombra');
  perform pg_temp.expect_error($q$select public.remove_page_version('00000000-0000-4000-8000-0000000b1704')$q$, '42501', 'anon saca');
  perform pg_temp.expect_error($q$select public.mark_page_restored(gen_random_uuid(), '00000000-0000-4000-8000-0000000b1d09', 3, 1)$q$, '42501', 'anon marca');
  perform pg_temp.expect_error($q$select count(*) from public.page_versions$q$, '42501', 'anon lee la tabla');
end;
$$;

-- Quien puso un nombre y después bajó a Ver ya no lo cambia ni lo saca.
select pg_temp.as_console();
update public.grants set level = 'view' where user_id = '00000000-0000-4000-8000-0000000b1e01';
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1e01');
do $$
begin
  perform pg_temp.expect_error($q$select public.rename_page_version('00000000-0000-4000-8000-0000000b1701', 'x')$q$,
    'page_not_found', 'bajado a Ver renombra el suyo');
  perform pg_temp.expect_error($q$select public.remove_page_version('00000000-0000-4000-8000-0000000b1701')$q$,
    'page_not_found', 'bajado a Ver saca el suyo');
end;
$$;
select pg_temp.as_console();
update public.grants set level = 'edit' where user_id = '00000000-0000-4000-8000-0000000b1e01';

-- ---------------------------------------------------------------------------------------------------
-- Un proyecto borrado (P.14): nadie ve sus nombres. Y el historial de siempre sigue igual.
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1a01');
do $$
begin
  assert (select count(*) from public.page_history('00000000-0000-4000-8000-0000000b1d09', 0)) = 4, 'page_history cambió';
  assert (select count(*) from public.pull_page_updates('00000000-0000-4000-8000-0000000b1d09', 0)) = 4, 'pull_page_updates cambió';
end;
$$;
select pg_temp.as_console();
update public.workspaces set deleted_at = now() where id = '00000000-0000-4000-8000-0000000b1e09';
select pg_temp.as_user('00000000-0000-4000-8000-0000000b1a01');
select pg_temp.expect_no_versions('00000000-0000-4000-8000-0000000b1d09', 'proyecto borrado');

-- La base quedó en la versión de esta migración (o más).
select pg_temp.as_console();
do $$
begin
  assert (select schema_version >= 13 from public.workspace_settings where id), 'schema_version no subió';
end;
$$;

rollback;

select 'ok' as result;
