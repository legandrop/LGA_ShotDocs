-- Pruebas de borrar un proyecto para siempre (P.14, entrega 3, *Delete forever*; Docs/Doc_Proyectos_Borrar.md,
-- sección 2.3 y "Cómo quedó (entrega 3)"): quién puede (dueño y admins que manejan el proyecto; no un miembro con
-- editar y crear, ni la admin que solo lo ve, ni la invitada de una página, ni el creador miembro, ni quien no lo veía,
-- ni la sacada, ni una sesión con contraseña, ni anon), que solo borrado y recién a los 30 días (con el borde), que
-- antes la carpeta de Drive (pedida y confirmada; un archivo subido después del pedido la vuelve a pedir), la versión
-- mínima, que después no se restaura, ni se pide ni se trae la carpeta, ni se archiva, que sale de la papelera para
-- todos, que sus archivos quedan como mandados a la papelera de Drive, que el archivo de otro proyecto que solo usaba se
-- puede mandar desde la papelera de su proyecto, que repetirlo no cambia nada y que **ninguna fila se borró**. La
-- preparación es la de proyectos_borrar_permisos.sql (las mismas personas y datos). Corre dentro de una transacción que
-- se deshace al final: no deja usuarios ni datos. Si todo pasa, devuelve una fila con result = 'ok'.

begin;

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Una sesión con su `amr` (cómo entró): con contraseña no es miembro de nada.
create function pg_temp.as_session(uid uuid, amr jsonb) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'amr', amr)::text, true);
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

-- Cuántas filas de `workspaces` ve la sesión con ese id.
create function pg_temp.sees(p uuid) returns int language sql as $$
  select count(*)::int from public.workspaces w where w.id = p;
$$;

-- El peso de un proyecto como lo ve la sesión: principal, papelera de la app, papelera de Drive y sin subir.
create function pg_temp.size_of(p uuid) returns text language sql as $$
  select format('%s/%s %s/%s %s/%s %s/%s', s.drive_bytes, s.drive_files, s.trash_bytes, s.trash_files,
                s.drive_trash_bytes, s.drive_trash_files, s.pending_bytes, s.pending_files)
  from public.project_sizes() s where s.project_id = p;
$$;

-- Todo lo de la prueba que restaurar tiene que dejar igual, en una huella (solo las filas de la prueba: la base
-- real puede cambiar mientras corre).
create function pg_temp.fingerprint() returns text language sql as $$
  select md5(concat_ws('|',
    (select string_agg(w::text, ',' order by w.id) from public.workspaces w
      where w.id::text like '00000000-0000-4000-8000-0000000d1%'),
    (select string_agg(pg::text, ',' order by pg.id) from public.pages pg
      where pg.id::text like '00000000-0000-4000-8000-0000000d2%'),
    (select string_agg(u::text, ',' order by u.id) from public.page_updates u
      where u.page_id::text like '00000000-0000-4000-8000-0000000d2%'),
    (select string_agg(f::text, ',' order by f.id) from public.files f
      where f.id::text like '00000000-0000-4000-8000-0000000d3%'),
    (select string_agg(pf::text, ',' order by pf.page_id, pf.file_id) from public.page_files pf
      where pf.file_id::text like '00000000-0000-4000-8000-0000000d3%'),
    (select string_agg(c::text, ',' order by c.id) from public.comments c
      where c.id::text like '00000000-0000-4000-8000-0000000d4%'),
    (select string_agg(g::text, ',' order by g.id) from public.grants g
      where g.user_id::text like '00000000-0000-4000-8000-0000000d0%'),
    (select string_agg(m::text, ',' order by m.user_id) from public.members m
      where m.user_id::text like '00000000-0000-4000-8000-0000000d0%')));
$$;

-- Personas (todas con correo @test.invalid):
--   ow   dueña del workspace; creó P y O           ad   admin con editar y crear páginas sobre P
--   av   admin con ver sobre P                      ep   miembro con editar y crear páginas sobre P
--   mc   miembro que creó M (con editar y crear sobre M, como las cuentas de antes del paso 5)
--   gu   invitada con ver la página p1              ad2  admin sin permiso sobre P
--   rx   miembro con editar y crear sobre P, sacada nu   invitada nueva (sin fila en members)
insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000d0001', 'pb-ow@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000d0002', 'pb-ad@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000d0003', 'pb-av@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000d0004', 'pb-ep@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000d0005', 'pb-mc@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000d0006', 'pb-gu@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000d0007', 'pb-ad2@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000d0008', 'pb-rx@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000d0009', 'pb-nu@test.invalid', 'authenticated', 'authenticated', now());

-- Si la base ya tiene dueño, queda fuera de la prueba (se deshace al final): hay un solo dueño activo. Sin versión
-- mínima ni purga automática dentro de la prueba.
update public.members set removed_at = now() where role = 'owner' and removed_at is null;
update public.workspace_settings
set owner_id = '00000000-0000-4000-8000-0000000d0001', min_app_version = null, auto_purge_files = false;

insert into public.members (user_id, role, removed_at) values
  ('00000000-0000-4000-8000-0000000d0001', 'owner', null),
  ('00000000-0000-4000-8000-0000000d0002', 'admin', null),
  ('00000000-0000-4000-8000-0000000d0003', 'admin', null),
  ('00000000-0000-4000-8000-0000000d0004', 'member', null),
  ('00000000-0000-4000-8000-0000000d0005', 'member', null),
  ('00000000-0000-4000-8000-0000000d0006', 'guest', null),
  ('00000000-0000-4000-8000-0000000d0007', 'admin', null),
  ('00000000-0000-4000-8000-0000000d0008', 'member', now());

-- P (el más viejo de la dueña), O y M.
insert into public.workspaces (id, owner_id, name, created_at) values
  ('00000000-0000-4000-8000-0000000d1001', '00000000-0000-4000-8000-0000000d0001', 'P', now() - interval '2 days'),
  ('00000000-0000-4000-8000-0000000d1002', '00000000-0000-4000-8000-0000000d0001', 'O', now() - interval '1 day'),
  ('00000000-0000-4000-8000-0000000d1003', '00000000-0000-4000-8000-0000000d0005', 'M', now() - interval '1 day');

-- p1 y su hija p2 en P; p3 en P, en la papelera de páginas; o1 en O; m1 en M.
insert into public.pages (id, workspace_id, parent_id, title, sort_key, deleted_at) values
  ('00000000-0000-4000-8000-0000000d2001', '00000000-0000-4000-8000-0000000d1001', null, 'p1', 'a0', null);
insert into public.pages (id, workspace_id, parent_id, title, sort_key, deleted_at) values
  ('00000000-0000-4000-8000-0000000d2002', '00000000-0000-4000-8000-0000000d1001',
   '00000000-0000-4000-8000-0000000d2001', 'p2', 'a0', null),
  ('00000000-0000-4000-8000-0000000d2003', '00000000-0000-4000-8000-0000000d1001', null, 'p3', 'a1',
   now() - interval '1 day'),
  ('00000000-0000-4000-8000-0000000d2004', '00000000-0000-4000-8000-0000000d1002', null, 'o1', 'a0', null),
  ('00000000-0000-4000-8000-0000000d2005', '00000000-0000-4000-8000-0000000d1003', null, 'm1', 'a0', null);

insert into public.grants (user_id, project_id, page_id, level) values
  ('00000000-0000-4000-8000-0000000d0002', '00000000-0000-4000-8000-0000000d1001', null, 'edit_pages'),
  ('00000000-0000-4000-8000-0000000d0003', '00000000-0000-4000-8000-0000000d1001', null, 'view'),
  ('00000000-0000-4000-8000-0000000d0004', '00000000-0000-4000-8000-0000000d1001', null, 'edit_pages'),
  ('00000000-0000-4000-8000-0000000d0005', '00000000-0000-4000-8000-0000000d1003', null, 'edit_pages'),
  ('00000000-0000-4000-8000-0000000d0006', null, '00000000-0000-4000-8000-0000000d2001', 'view'),
  ('00000000-0000-4000-8000-0000000d0008', '00000000-0000-4000-8000-0000000d1001', null, 'edit_pages');

-- Archivos (los pesos no se pisan: cada suma dice qué entró):
--   f1  de P, en uso en p1, subido, lo creó la dueña                          1.000
--   f2  de P, solo en p3 (papelera de páginas): ya estaba en la papelera     20.000
--   f3  de O, usado solo en p2 (uso de afuera), subido, lo creó la dueña  50.000.000
--   f4  de P, en uso en p2 y además en o1 (uso de afuera), subido           300.000
--   f5  de P, en uso en p1, todavía sin subir                             4.000.000
insert into public.files (id, project_id, name, mime, size, drive_id, uploaded_at, created_by) values
  ('00000000-0000-4000-8000-0000000d3001', '00000000-0000-4000-8000-0000000d1001', 'f1.jpg', 'image/jpeg', 1000,
   'drive_f1_xxxxxxxx', now() - interval '5 days', '00000000-0000-4000-8000-0000000d0001'),
  ('00000000-0000-4000-8000-0000000d3002', '00000000-0000-4000-8000-0000000d1001', 'f2.jpg', 'image/jpeg', 20000,
   'drive_f2_xxxxxxxx', now() - interval '5 days', null),
  ('00000000-0000-4000-8000-0000000d3003', '00000000-0000-4000-8000-0000000d1002', 'f3.jpg', 'image/jpeg', 50000000,
   'drive_f3_xxxxxxxx', now() - interval '5 days', '00000000-0000-4000-8000-0000000d0001'),
  ('00000000-0000-4000-8000-0000000d3004', '00000000-0000-4000-8000-0000000d1001', 'f4.jpg', 'image/jpeg', 300000,
   'drive_f4_xxxxxxxx', now() - interval '5 days', null),
  ('00000000-0000-4000-8000-0000000d3005', '00000000-0000-4000-8000-0000000d1001', 'f5.mov', 'video/quicktime', 4000000,
   null, null, null);
insert into public.page_files (page_id, file_id, is_foreign) values
  ('00000000-0000-4000-8000-0000000d2001', '00000000-0000-4000-8000-0000000d3001', false),
  ('00000000-0000-4000-8000-0000000d2003', '00000000-0000-4000-8000-0000000d3002', false),
  ('00000000-0000-4000-8000-0000000d2002', '00000000-0000-4000-8000-0000000d3003', true),
  ('00000000-0000-4000-8000-0000000d2002', '00000000-0000-4000-8000-0000000d3004', false),
  ('00000000-0000-4000-8000-0000000d2004', '00000000-0000-4000-8000-0000000d3004', true),
  ('00000000-0000-4000-8000-0000000d2001', '00000000-0000-4000-8000-0000000d3005', false);
-- f2 entró a la papelera al registrar su uso; se le da una fecha propia para ver que restaurar la conserva.
update public.files set trashed_at = now() - interval '3 days' where id = '00000000-0000-4000-8000-0000000d3002';

do $$
begin
  assert (select array_agg(f.id order by f.id) from public.files f
          where f.id::text like '00000000-0000-4000-8000-0000000d3%' and f.trashed_at is not null)
         = array['00000000-0000-4000-8000-0000000d3002']::uuid[],
    'preparación: la papelera de archivos no quedó como se esperaba';
end;
$$;

-- Contenido y un comentario en p1, como la dueña.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
select public.push_page_update('00000000-0000-4000-8000-0000000d2001', '00000000-0000-4000-8000-0000000d5001',
                               'AQ==', '9.999');
select public.add_comment('00000000-0000-4000-8000-0000000d4001', '00000000-0000-4000-8000-0000000d2001',
                          null, null, 'Un comentario en p1');
select set_config('role', 'postgres', true);

-- Pruebas de la entrega 3. Siguen a la preparación: P activo (de la dueña, que lo maneja con la admin `ad`), f1, f2 y
-- f4 subidos, f5 sin subir, f3 de O usado solo en p2 (de P).

-- Cuántas filas de la prueba hay en cada tabla: borrar para siempre no puede cambiar ninguna cuenta.
create function pg_temp.row_counts() returns text language sql as $$
  select format('%s %s %s %s %s %s %s %s',
    (select count(*) from public.workspaces where id::text like '00000000-0000-4000-8000-0000000d1%'),
    (select count(*) from public.pages where id::text like '00000000-0000-4000-8000-0000000d2%'),
    (select count(*) from public.page_updates where page_id::text like '00000000-0000-4000-8000-0000000d2%'),
    (select count(*) from public.files where id::text like '00000000-0000-4000-8000-0000000d3%'),
    (select count(*) from public.page_files where file_id::text like '00000000-0000-4000-8000-0000000d3%'),
    (select count(*) from public.comments where id::text like '00000000-0000-4000-8000-0000000d4%'),
    (select count(*) from public.grants where user_id::text like '00000000-0000-4000-8000-0000000d0%'),
    (select count(*) from public.members where user_id::text like '00000000-0000-4000-8000-0000000d0%'));
$$;

-- El texto (páginas, contenido, comentarios, permisos): borrar para siempre no lo toca.
create function pg_temp.text_print() returns text language sql as $$
  select md5(concat_ws('|',
    (select string_agg(pg::text, ',' order by pg.id) from public.pages pg
      where pg.id::text like '00000000-0000-4000-8000-0000000d2%'),
    (select string_agg(u::text, ',' order by u.id) from public.page_updates u
      where u.page_id::text like '00000000-0000-4000-8000-0000000d2%'),
    (select string_agg(c::text, ',' order by c.id) from public.comments c
      where c.id::text like '00000000-0000-4000-8000-0000000d4%'),
    (select string_agg(g::text, ',' order by g.id) from public.grants g
      where g.user_id::text like '00000000-0000-4000-8000-0000000d0%')));
$$;

-- Cómo ve la sesión a P en la papelera de proyectos: "días can_restore can_purge", o "no está".
create function pg_temp.trash_row(p uuid) returns text language sql as $$
  select coalesce((select format('%s %s %s', t.days_left, case when t.can_restore then 't' else 'f' end,
                                 case when t.can_purge then 't' else 'f' end)
                   from public.trashed_projects() t where t.id = p), 'no está');
$$;

-- ---------------------------------------------------------------------------------------------------
-- K1. Solo un proyecto borrado, y recién a los 30 días
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$
begin
  perform pg_temp.expect_error($q$select public.purge_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'project_not_deleted', 'la dueña borra para siempre P activo');
  perform pg_temp.expect_error($q$select public.purge_project('00000000-0000-4000-8000-0000000d1002')$q$,
    'project_not_deleted', 'la dueña borra para siempre O activo');
  perform pg_temp.expect_error($q$select public.purge_project('00000000-0000-4000-8000-0000000d9999')$q$,
    'project_not_found', 'borra para siempre un proyecto que no existe');
end;
$$;
-- Con P activo, un miembro con editar y crear no puede (antes que decir que no está borrado).
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0004');
do $$ begin
  perform pg_temp.expect_error($q$select public.purge_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'not_allowed', 'un miembro con editar y crear borra para siempre P activo');
end; $$;

select pg_temp.as_user('00000000-0000-4000-8000-0000000d0002');
select public.delete_project('00000000-0000-4000-8000-0000000d1001');
do $$
begin
  assert pg_temp.trash_row('00000000-0000-4000-8000-0000000d1001') = '30 t t',
    format('P recién borrado para la admin que lo maneja: %s', pg_temp.trash_row('00000000-0000-4000-8000-0000000d1001'));
  perform pg_temp.expect_error($q$select public.purge_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'project_trash_not_due', 'borra para siempre recién borrado');
end;
$$;
-- El borde: a un segundo de los 30 días, todavía no.
select set_config('role', 'postgres', true);
update public.workspaces set deleted_at = now() - interval '30 days' + interval '1 second'
where id = '00000000-0000-4000-8000-0000000d1001';
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0002');
do $$
begin
  assert pg_temp.trash_row('00000000-0000-4000-8000-0000000d1001') = '1 t t',
    format('P a un segundo de los 30 días: %s', pg_temp.trash_row('00000000-0000-4000-8000-0000000d1001'));
  perform pg_temp.expect_error($q$select public.purge_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'project_trash_not_due', 'borra para siempre a un segundo de los 30 días');
end;
$$;
select set_config('role', 'postgres', true);
update public.workspaces set deleted_at = now() - interval '30 days' where id = '00000000-0000-4000-8000-0000000d1001';

-- ---------------------------------------------------------------------------------------------------
-- K2. Quién no puede, a los 30 días
-- ---------------------------------------------------------------------------------------------------
-- Lo ven pero no lo manejan como dueño o admin: no. En la papelera, sin poder borrarlo para siempre.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0004');
do $$ begin
  assert pg_temp.trash_row('00000000-0000-4000-8000-0000000d1001') = '0 f f', 'el miembro ve can_purge';
  perform pg_temp.expect_error($q$select public.purge_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'not_allowed', 'un miembro con editar y crear borra P para siempre');
end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0003');
do $$ begin
  assert pg_temp.trash_row('00000000-0000-4000-8000-0000000d1001') = '0 f f', 'la admin que solo ve tiene can_purge';
  perform pg_temp.expect_error($q$select public.purge_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'not_allowed', 'la admin con ver (sin manejarlo) borra P para siempre');
end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0006');
do $$ begin
  assert pg_temp.trash_row('00000000-0000-4000-8000-0000000d1001') = '0 f f', 'la invitada tiene can_purge';
  perform pg_temp.expect_error($q$select public.purge_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'not_allowed', 'la invitada de una página borra P para siempre');
end; $$;
-- No lo veían: para ellos no existe.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0005');
do $$ begin
  assert pg_temp.trash_row('00000000-0000-4000-8000-0000000d1001') = 'no está', 'el creador de M ve P en la papelera';
  perform pg_temp.expect_error($q$select public.purge_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'project_not_found', 'un miembro sin permiso sobre P lo borra para siempre');
end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0007');
do $$ begin
  assert pg_temp.trash_row('00000000-0000-4000-8000-0000000d1001') = 'no está', 'la admin sin permiso ve P';
  perform pg_temp.expect_error($q$select public.purge_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'project_not_found', 'la admin sin permiso borra P para siempre');
end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0008');
do $$ begin
  perform pg_temp.expect_error($q$select public.purge_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'project_not_found', 'la sacada borra P para siempre');
end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0009');
do $$ begin
  perform pg_temp.expect_error($q$select public.purge_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'project_not_found', 'alguien sin fila en members borra P para siempre');
end; $$;
select pg_temp.as_session('00000000-0000-4000-8000-0000000d0001', '[{"method": "password", "timestamp": 1790000000}]');
do $$ begin
  perform pg_temp.expect_error($q$select public.purge_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'project_not_found', 'la dueña con una sesión con contraseña borra P para siempre');
end; $$;
select set_config('role', 'anon', true);
select set_config('request.jwt.claims', '', true);
do $$ begin
  perform pg_temp.expect_error($q$select public.purge_project('00000000-0000-4000-8000-0000000d1001')$q$,
    '42501', 'anon: borra para siempre');
end; $$;
-- La marca no se escribe desde la API, ni siquiera la dueña.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$ begin
  perform pg_temp.expect_error(
    $q$update public.workspaces set purged_at = now() where id = '00000000-0000-4000-8000-0000000d1002'$q$,
    '42501', 'la dueña escribe purged_at desde la API');
  -- f3 (de O) lo usa solo p2 (de P, borrado): por ahora no se manda a Drive (vuelve si restauran P).
  assert (select t.in_deleted_project from public.trashed_files('00000000-0000-4000-8000-0000000d1002') t
          where t.id = '00000000-0000-4000-8000-0000000d3003'), 'f3 no está marcado como de un proyecto borrado';
  perform pg_temp.expect_error($q$select public.purge_file('00000000-0000-4000-8000-0000000d3003')$q$,
    'file_in_deleted_project', 'manda a Drive f3 con P borrado (todavía restaurable)');
end; $$;

-- ---------------------------------------------------------------------------------------------------
-- K3. Antes, la carpeta de Drive (pedida y confirmada), y la versión mínima
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0002');
do $$
begin
  perform pg_temp.expect_error($q$select public.purge_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'drive_trash_first', 'borra para siempre con archivos fuera de la papelera de Drive');
  -- Pedida y sin confirmar (el portero no terminó): todavía no.
  perform public.request_project_drive_trash('00000000-0000-4000-8000-0000000d1001');
  perform pg_temp.expect_error($q$select public.purge_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'drive_trash_first', 'borra para siempre con la carpeta pedida sin confirmar');
end;
$$;
-- Un archivo subido después del pedido (fue a otra carpeta): la carpeta mandada no lo cubre.
select set_config('role', 'postgres', true);
insert into public.files (id, project_id, name, mime, size, drive_id, uploaded_at, created_by) values
  ('00000000-0000-4000-8000-0000000d3006', '00000000-0000-4000-8000-0000000d1001', 'f6.jpg', 'image/jpeg', 7,
   'drive_f6_xxxxxxxx', now() + interval '1 minute', null);
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0002');
select public.project_drive_trashed('00000000-0000-4000-8000-0000000d1001');
do $$ begin
  perform pg_temp.expect_error($q$select public.purge_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'drive_trash_first', 'borra para siempre con un archivo subido después del pedido');
end; $$;
-- f6 se mandó solo (como `/trash`); con la versión mínima por encima de la de quien llama, tampoco.
select set_config('role', 'postgres', true);
update public.files set trashed_at = now(), purged_at = now(), drive_trashed_at = now()
where id = '00000000-0000-4000-8000-0000000d3006';
update public.workspace_settings set min_app_version = '9.999' where id;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0002');
do $$ begin
  perform pg_temp.expect_error($q$select public.purge_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'PGRST', 'borra para siempre una versión de la app más vieja que la mínima');
  assert (select w.purged_at is null from public.workspaces w where w.id = '00000000-0000-4000-8000-0000000d1001') is not false,
    'la versión vieja marcó P';
end; $$;
select set_config('role', 'postgres', true);
update public.workspace_settings set min_app_version = null where id;
select set_config('purgar.filas', pg_temp.row_counts(), true);
select set_config('purgar.texto', pg_temp.text_print(), true);
select set_config('purgar.borrado', (select deleted_at::text from public.workspaces
                                     where id = '00000000-0000-4000-8000-0000000d1001'), true);

-- ---------------------------------------------------------------------------------------------------
-- K4. Borrar para siempre, y lo que ya no se hace
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0002');
select public.purge_project('00000000-0000-4000-8000-0000000d1001');
-- Repetirlo no cambia nada (tampoco si lo repite la dueña).
select public.purge_project('00000000-0000-4000-8000-0000000d1001');
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
select public.purge_project('00000000-0000-4000-8000-0000000d1001');

select pg_temp.as_user('00000000-0000-4000-8000-0000000d0002');
do $$
begin
  assert pg_temp.trash_row('00000000-0000-4000-8000-0000000d1001') = 'no está', 'P sigue en la papelera de la admin';
  perform pg_temp.expect_error($q$select public.restore_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'project_purged', 'restaura un proyecto borrado para siempre');
  perform pg_temp.expect_error($q$select public.restore_project('00000000-0000-4000-8000-0000000d1001', true)$q$,
    'project_purged', 'restaura sin Drive un proyecto borrado para siempre');
  perform pg_temp.expect_error($q$select public.request_project_drive_trash('00000000-0000-4000-8000-0000000d1001')$q$,
    'project_purged', 'vuelve a pedir la carpeta de un proyecto borrado para siempre');
  perform pg_temp.expect_error($q$select public.project_drive_untrashed('00000000-0000-4000-8000-0000000d1001')$q$,
    'project_purged', 'trae la carpeta de un proyecto borrado para siempre');
  perform pg_temp.expect_error($q$select public.project_drive_trashed('00000000-0000-4000-8000-0000000d1001')$q$,
    'project_drive_not_requested', 'confirma la carpeta de un proyecto borrado para siempre');
  perform pg_temp.expect_error($q$select public.set_project_archived('00000000-0000-4000-8000-0000000d1001', true)$q$,
    'project_deleted', 'archiva un proyecto borrado para siempre');
  assert public.delete_project('00000000-0000-4000-8000-0000000d1001')::text = current_setting('purgar.borrado'),
    'borrar otra vez cambió la fecha de borrado';
  assert (public.media_project('00000000-0000-4000-8000-0000000d1001') ->> 'purged_at') is not null,
    'media_project no le dice al portero que está borrado para siempre';
  assert pg_temp.sees('00000000-0000-4000-8000-0000000d1001') = 0, 'la admin ve P';
  -- f1, f2 y f4 (de la carpeta) y f6 (mandado solo) en la papelera de Drive; f5 (sin subir) en la papelera de la app.
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000d1001') = '0/0 4000000/1 321007/4 0/0',
    format('peso de P borrado para siempre: %s', pg_temp.size_of('00000000-0000-4000-8000-0000000d1001'));
end;
$$;
-- Para nadie está en la papelera.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$ begin
  assert pg_temp.trash_row('00000000-0000-4000-8000-0000000d1001') = 'no está', 'P sigue en la papelera de la dueña';
  assert pg_temp.sees('00000000-0000-4000-8000-0000000d1001') = 0, 'la dueña ve P';
  assert (select count(*) from public.pages where id = '00000000-0000-4000-8000-0000000d2001') = 0, 'la dueña ve p1';
  -- f3 (de O): P ya no vuelve, así que se puede mandar a Drive desde la papelera de O, sin la página de P.
  assert (select not t.in_deleted_project and not t.in_trashed_page from public.trashed_files('00000000-0000-4000-8000-0000000d1002') t
          where t.id = '00000000-0000-4000-8000-0000000d3003'), 'f3 sigue frenado por P borrado para siempre';
  perform public.purge_file('00000000-0000-4000-8000-0000000d3003');
end; $$;
-- La purga automática (apagada; acá se prende dentro de la prueba) tampoco lo frena por la página de P.
select set_config('role', 'postgres', true);
update public.workspace_settings set auto_purge_files = true where id;
update public.files set trashed_at = now() - interval '31 days' where id = '00000000-0000-4000-8000-0000000d3003';
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$ begin
  assert exists (select 1 from public.files_due_for_purge('00000000-0000-4000-8000-0000000d1002') d
                 where d.id = '00000000-0000-4000-8000-0000000d3003'), 'la purga automática deja afuera f3';
end; $$;
select set_config('role', 'postgres', true);
update public.workspace_settings set auto_purge_files = false where id;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0004');
do $$ begin
  assert pg_temp.trash_row('00000000-0000-4000-8000-0000000d1001') = 'no está', 'P sigue en la papelera del miembro';
end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0006');
do $$ begin
  assert pg_temp.trash_row('00000000-0000-4000-8000-0000000d1001') = 'no está', 'P sigue en la papelera de la invitada';
end; $$;

-- ---------------------------------------------------------------------------------------------------
-- K5. Ninguna fila se borró; las marcas son las esperadas
-- ---------------------------------------------------------------------------------------------------
select set_config('role', 'postgres', true);
do $$
begin
  assert pg_temp.row_counts() = current_setting('purgar.filas'),
    format('borrar para siempre borró filas: %s (antes %s)', pg_temp.row_counts(), current_setting('purgar.filas'));
  assert pg_temp.text_print() = current_setting('purgar.texto'), 'borrar para siempre cambió el texto';
  assert (select w.purged_at is not null and w.purged_by = '00000000-0000-4000-8000-0000000d0002'
                 and w.deleted_at::text = current_setting('purgar.borrado')
                 and w.drive_trash_requested_at is null and w.drive_trashed_at is null and w.drive_missing_at is null
          from public.workspaces w where w.id = '00000000-0000-4000-8000-0000000d1001'), 'las marcas de P no son las esperadas';
  assert (select count(*) from public.files f
          where f.id in ('00000000-0000-4000-8000-0000000d3001', '00000000-0000-4000-8000-0000000d3002',
                         '00000000-0000-4000-8000-0000000d3004', '00000000-0000-4000-8000-0000000d3006')
            and f.trashed_at is not null and f.purged_at is not null and f.drive_trashed_at is not null) = 4,
    'los archivos subidos de P no quedaron como mandados a la papelera de Drive';
  assert (select f.purged_at is null and f.drive_trashed_at is null from public.files f
          where f.id = '00000000-0000-4000-8000-0000000d3005'), 'f5 (sin subir) quedó marcado';
  assert (select f.purged_at is not null and f.drive_trashed_at is null from public.files f
          where f.id = '00000000-0000-4000-8000-0000000d3003'), 'f3 no quedó pedido para Drive';
  -- La restricción: no hay purged_at sin deleted_at.
  perform pg_temp.expect_error(
    $q$update public.workspaces set purged_at = now() where id = '00000000-0000-4000-8000-0000000d1002'$q$,
    '23514', 'purged_at en un proyecto activo');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- K6. El creador miembro no lo borra para siempre; la dueña no ve el privado de otro
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0005');
select public.delete_project('00000000-0000-4000-8000-0000000d1003');
select set_config('role', 'postgres', true);
update public.workspaces set deleted_at = now() - interval '31 days' where id = '00000000-0000-4000-8000-0000000d1003';
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0005');
do $$ begin
  assert pg_temp.trash_row('00000000-0000-4000-8000-0000000d1003') = '0 t f', 'el creador miembro de M tiene can_purge';
  perform pg_temp.expect_error($q$select public.purge_project('00000000-0000-4000-8000-0000000d1003')$q$,
    'not_allowed', 'el creador miembro borra M para siempre');
end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$ begin
  perform pg_temp.expect_error($q$select public.purge_project('00000000-0000-4000-8000-0000000d1003')$q$,
    'project_not_found', 'la dueña borra para siempre un proyecto privado de otro');
end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0002');
do $$ begin
  perform pg_temp.expect_error($q$select public.purge_project('00000000-0000-4000-8000-0000000d1003')$q$,
    'project_not_found', 'una admin sin permiso borra M para siempre');
end; $$;
-- M sigue restaurable por su creador.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0005');
select public.restore_project('00000000-0000-4000-8000-0000000d1003');

-- ---------------------------------------------------------------------------------------------------
-- K7. Cómo quedaron las funciones
-- ---------------------------------------------------------------------------------------------------
select set_config('role', 'anon', true);
select set_config('request.jwt.claims', '', true);
do $$ begin
  perform pg_temp.expect_error($q$select public.restore_project('00000000-0000-4000-8000-0000000d1001')$q$, '42501', 'anon: restaura');
  perform pg_temp.expect_error($q$select * from public.trashed_projects()$q$, '42501', 'anon: la papelera');
end; $$;
select set_config('role', 'postgres', true);
do $$
declare
  fn text;
begin
  foreach fn in array array['public.purge_project(uuid)', 'public.restore_project(uuid,boolean)',
                            'public.request_project_drive_trash(uuid)', 'public.project_drive_untrashed(uuid)',
                            'public.media_project(uuid)', 'public.trashed_projects()', 'public.trashed_files(uuid)',
                            'public.files_due_for_purge(uuid)', 'private.file_in_deleted_project(uuid)'] loop
    assert (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p
            where p.oid = fn::regprocedure), format('%s no es security definer con search_path vacío', fn);
  end loop;
  assert not has_function_privilege('anon', 'public.purge_project(uuid)', 'execute'), 'anon llama a purge_project';
  assert has_function_privilege('authenticated', 'public.purge_project(uuid)', 'execute'),
    'authenticated no llama a purge_project';
  assert not has_function_privilege('authenticated', 'private.file_in_deleted_project(uuid)', 'execute'),
    'authenticated llama a file_in_deleted_project';
  assert (select schema_version from public.workspace_settings where id) >= 23, 'la versión de la base no es 23';
end;
$$;

rollback;

select 'ok' as result;
