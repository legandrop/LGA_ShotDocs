-- Pruebas del historial de versiones (20261007120000_historial.sql, Docs/Doc_Historial.md): `page_history` y
-- `page_history_authors` solo con nivel 3 o más y sin ser invitado, no en la papelera ni en un proyecto borrado;
-- quién y cuándo ya no se leen directo de `page_updates` (el contenido sí, como antes), y `pull_page_updates` sigue
-- igual. Corre dentro de una transacción que se deshace al final: no deja usuarios ni datos. Si todo pasa, devuelve
-- una fila con result = 'ok'.

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

create function pg_temp.expect_no_history(label text) returns void language plpgsql as $$
begin
  perform pg_temp.expect_error($q$select * from public.page_history('00000000-0000-4000-8000-00000000a1d9', 0)$q$,
    'page_not_found', label || ': ve el historial');
  perform pg_temp.expect_error($q$select * from public.page_history_authors('00000000-0000-4000-8000-00000000a1d9')$q$,
    'page_not_found', label || ': ve los autores');
end;
$$;

create function pg_temp.expect_table_columns(label text) returns void language plpgsql as $$
begin
  assert (select count(*) from public.page_updates where page_id = '00000000-0000-4000-8000-00000000a1d9') = 2,
    label || ': no se cuentan las filas';
  assert (select count(*) from (select seq, update, client_update_id, id from public.page_updates
                                where page_id = '00000000-0000-4000-8000-00000000a1d9') s) = 2,
    label || ': no se lee el contenido';
  perform pg_temp.expect_error($q$select created_by from public.page_updates$q$, '42501', label || ' lee created_by directo');
  perform pg_temp.expect_error($q$select created_at from public.page_updates$q$, '42501', label || ' lee created_at directo');
  perform pg_temp.expect_error($q$select * from public.page_updates$q$, '42501', label || ' lee la fila entera directo');
end;
$$;

-- Personas: a (creó el proyecto P: nivel 4), e (Editar), c (Comentar), v (Ver), g (invitado con Editar), x (sin
-- permiso) y r (sacado, tenía Editar).
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-00000000a1a1', 'hist-a@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000a1e1', 'hist-e@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000a1c1', 'hist-c@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000a1f1', 'hist-v@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000a1b1', 'hist-g@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000a1d1', 'hist-x@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000a1a2', 'hist-r@test.invalid', 'authenticated', 'authenticated');
insert into public.members (user_id, role, removed_at) values
  ('00000000-0000-4000-8000-00000000a1a1', 'member', null),
  ('00000000-0000-4000-8000-00000000a1e1', 'member', null),
  ('00000000-0000-4000-8000-00000000a1c1', 'member', null),
  ('00000000-0000-4000-8000-00000000a1f1', 'member', null),
  ('00000000-0000-4000-8000-00000000a1b1', 'guest', null),
  ('00000000-0000-4000-8000-00000000a1d1', 'member', null),
  ('00000000-0000-4000-8000-00000000a1a2', 'member', now());
insert into public.workspaces (id, owner_id, name) values
  ('00000000-0000-4000-8000-00000000a1e9', '00000000-0000-4000-8000-00000000a1a1', 'P');
insert into public.grants (user_id, project_id, level) values
  ('00000000-0000-4000-8000-00000000a1e1', '00000000-0000-4000-8000-00000000a1e9', 'edit'),
  ('00000000-0000-4000-8000-00000000a1c1', '00000000-0000-4000-8000-00000000a1e9', 'comment'),
  ('00000000-0000-4000-8000-00000000a1f1', '00000000-0000-4000-8000-00000000a1e9', 'view'),
  ('00000000-0000-4000-8000-00000000a1b1', '00000000-0000-4000-8000-00000000a1e9', 'edit'),
  ('00000000-0000-4000-8000-00000000a1a2', '00000000-0000-4000-8000-00000000a1e9', 'edit');
-- p1 (con contenido de a y de e), t (en la papelera) y t2 (adentro de t).
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  ('00000000-0000-4000-8000-00000000a1d9', '00000000-0000-4000-8000-00000000a1e9', null, 'p1', 'a0'),
  ('00000000-0000-4000-8000-00000000a1da', '00000000-0000-4000-8000-00000000a1e9', null, 't', 'a1'),
  ('00000000-0000-4000-8000-00000000a1db', '00000000-0000-4000-8000-00000000a1e9', '00000000-0000-4000-8000-00000000a1da', 't2', 'a2');

-- Subidas de verdad (`push_page_update`), cada una con la sesión de quien la sube: así el autor lo pone la base.
-- Con la versión '9.999', para pasar cualquier versión mínima que tenga la base.
select pg_temp.as_user('00000000-0000-4000-8000-00000000a1a1');
select public.push_page_update('00000000-0000-4000-8000-00000000a1d9', '00000000-0000-4000-8000-00000000a101', 'AAA=', '9.999');
select public.push_page_update('00000000-0000-4000-8000-00000000a1da', '00000000-0000-4000-8000-00000000a102', 'AAA=', '9.999');
select public.push_page_update('00000000-0000-4000-8000-00000000a1db', '00000000-0000-4000-8000-00000000a103', 'AAA=', '9.999');
select pg_temp.as_user('00000000-0000-4000-8000-00000000a1e1');
select public.push_page_update('00000000-0000-4000-8000-00000000a1d9', '00000000-0000-4000-8000-00000000a104', 'AAA=', '9.999');

select set_config('role', 'postgres', true);
update public.pages set deleted_at = now() where id = '00000000-0000-4000-8000-00000000a1da';

-- ---------------------------------------------------------------------------------------------------
-- Quien puede editar (a con nivel 4, e con nivel 3): las filas en orden, con autor y hora, y los correos.
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-00000000a1a1');
do $$
declare
  p1 constant uuid := '00000000-0000-4000-8000-00000000a1d9';
  a  constant uuid := '00000000-0000-4000-8000-00000000a1a1';
  e  constant uuid := '00000000-0000-4000-8000-00000000a1e1';
begin
  assert (select count(*) from public.page_history(p1, 0)) = 2, 'a: no ve las dos filas de p1';
  assert (select string_agg(created_by::text, ',' order by seq) from public.page_history(p1, 0)) = a || ',' || e,
    'a: el autor de cada fila no es quien la subió';
  assert (select bool_and(created_at is not null and update = 'AAA=' and id is not null) from public.page_history(p1, 0)),
    'a: falta la hora, el id o el contenido';
  assert (select string_agg(seq::text, ',' order by seq) from public.page_history(p1, 1)) = '2', 'a: after_seq no corta';
  assert (select count(*) from public.page_history(p1, 0, 1)) = 1, 'a: el límite no corta';
  assert (select string_agg(email, ',' order by email) from public.page_history_authors(p1)) =
    'hist-a@test.invalid,hist-e@test.invalid', 'a: los correos de los autores';
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-00000000a1e1');
do $$
begin
  assert (select count(*) from public.page_history('00000000-0000-4000-8000-00000000a1d9', 0)) = 2, 'e (Editar): no ve el historial';
  assert (select count(*) from public.page_history_authors('00000000-0000-4000-8000-00000000a1d9')) = 2, 'e: no ve los autores';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Ver, Comentar, invitado con Editar, sin permiso y sacado: nada (page_not_found), pero pull_page_updates como antes.
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-00000000a1f1');
select pg_temp.expect_no_history('Ver');
select pg_temp.as_user('00000000-0000-4000-8000-00000000a1c1');
select pg_temp.expect_no_history('Comentar');
select pg_temp.as_user('00000000-0000-4000-8000-00000000a1b1');
select pg_temp.expect_no_history('invitado con Editar');
select pg_temp.as_user('00000000-0000-4000-8000-00000000a1d1');
select pg_temp.expect_no_history('sin permiso');
select pg_temp.as_user('00000000-0000-4000-8000-00000000a1a2');
select pg_temp.expect_no_history('sacado');

select pg_temp.as_user('00000000-0000-4000-8000-00000000a1f1');
do $$
begin
  assert (select count(*) from public.pull_page_updates('00000000-0000-4000-8000-00000000a1d9', 0)) = 2,
    'Ver: pull_page_updates dejó de andar';
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-00000000a1b1');
do $$
begin
  assert (select count(*) from public.pull_page_updates('00000000-0000-4000-8000-00000000a1d9', 0)) = 2,
    'invitado: pull_page_updates dejó de andar';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- La tabla directo: el contenido se lee como antes (con la política de siempre), quién y cuándo no.
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-00000000a1f1');
select pg_temp.expect_table_columns('Ver');
select pg_temp.as_user('00000000-0000-4000-8000-00000000a1b1');
select pg_temp.expect_table_columns('invitado');
select pg_temp.as_user('00000000-0000-4000-8000-00000000a1a1');
select pg_temp.expect_table_columns('creador del proyecto');
-- sin permiso: la política sigue sin dejarle ver nada
select pg_temp.as_user('00000000-0000-4000-8000-00000000a1d1');
do $$
begin
  assert (select count(*) from public.page_updates where page_id = '00000000-0000-4000-8000-00000000a1d9') = 0,
    'sin permiso: ve filas';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- La papelera: la página y lo de adentro, page_in_trash (también para quien puede editar).
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-00000000a1a1');
do $$
begin
  perform pg_temp.expect_error($q$select * from public.page_history('00000000-0000-4000-8000-00000000a1da', 0)$q$,
    'page_in_trash', 'una página en la papelera da su historial');
  perform pg_temp.expect_error($q$select * from public.page_history('00000000-0000-4000-8000-00000000a1db', 0)$q$,
    'page_in_trash', 'una página adentro de una en la papelera da su historial');
  perform pg_temp.expect_error($q$select * from public.page_history_authors('00000000-0000-4000-8000-00000000a1db')$q$,
    'page_in_trash', 'los autores de una página adentro de una en la papelera');
  perform pg_temp.expect_error($q$select * from public.page_history(gen_random_uuid(), 0)$q$,
    'page_not_found', 'una página que no existe');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Las funciones auxiliares no se llaman desde la API; anon no llama a nada.
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.expect_error($q$select private.history_denied_for_guest()$q$, '42501', 'una sesión llama a history_denied_for_guest');
  perform pg_temp.expect_error($q$select private.page_in_trash('00000000-0000-4000-8000-00000000a1d9')$q$, '42501',
    'una sesión llama a page_in_trash');
  perform pg_temp.expect_error($q$select private.check_history('00000000-0000-4000-8000-00000000a1d9')$q$, '42501',
    'una sesión llama a check_history');
end;
$$;

select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  perform pg_temp.expect_error($q$select * from public.page_history('00000000-0000-4000-8000-00000000a1d9', 0)$q$, '42501',
    'anon pide el historial');
  perform pg_temp.expect_error($q$select * from public.page_history_authors('00000000-0000-4000-8000-00000000a1d9')$q$, '42501',
    'anon pide los autores');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Un proyecto borrado (P.14): nadie ve su historial.
-- ---------------------------------------------------------------------------------------------------
select set_config('role', 'postgres', true);
update public.workspaces set deleted_at = now() where id = '00000000-0000-4000-8000-00000000a1e9';
select pg_temp.as_user('00000000-0000-4000-8000-00000000a1a1');
do $$
begin
  perform pg_temp.expect_error($q$select * from public.page_history('00000000-0000-4000-8000-00000000a1d9', 0)$q$,
    'page_not_found', 'el historial de un proyecto borrado');
end;
$$;

-- Nada de lo de arriba escribió: siguen las cuatro filas de la prueba.
select set_config('role', 'postgres', true);
do $$
begin
  assert (select count(*) from public.page_updates where page_id in ('00000000-0000-4000-8000-00000000a1d9',
    '00000000-0000-4000-8000-00000000a1da', '00000000-0000-4000-8000-00000000a1db')) = 4, 'cambiaron las filas';
end;
$$;

rollback;

select 'ok' as result;
