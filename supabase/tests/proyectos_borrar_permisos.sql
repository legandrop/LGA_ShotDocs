-- Pruebas de archivar y borrar proyectos (P.14, Docs/Doc_Proyectos_Borrar.md): quién archiva, borra y restaura;
-- que con el proyecto borrado nadie lo ve ni lo escribe por ningún camino (también quien creó un archivo); la
-- papelera de archivos y el peso mientras tanto; que restaurar deja todo exactamente como estaba (una huella
-- antes y después); una invitación aceptada mientras estaba borrado; y que las marcas no se escriben desde la
-- API. Corre dentro de una transacción que se deshace al final: no deja usuarios ni datos. Si todo pasa,
-- devuelve una fila con result = 'ok'.

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

-- ---------------------------------------------------------------------------------------------------
-- A. Archivar: quién puede, que no cambia permisos, ensure_workspace
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0004');
do $$
begin
  perform pg_temp.expect_error($q$select public.set_project_archived('00000000-0000-4000-8000-0000000d1001', true)$q$,
    'not_allowed', 'un miembro con editar y crear (sin ser admin ni creador) archiva P');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0003');
do $$
begin
  perform pg_temp.expect_error($q$select public.set_project_archived('00000000-0000-4000-8000-0000000d1001', true)$q$,
    'not_allowed', 'una admin con ver archiva P');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0006');
do $$
begin
  perform pg_temp.expect_error($q$select public.set_project_archived('00000000-0000-4000-8000-0000000d1001', true)$q$,
    'not_allowed', 'la invitada archiva P');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0007');
do $$
begin
  perform pg_temp.expect_error($q$select public.set_project_archived('00000000-0000-4000-8000-0000000d1001', true)$q$,
    'project_not_found', 'una admin sin permiso sobre P lo archiva (o se entera de que existe)');
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$
declare
  first_at timestamptz;
begin
  assert public.ensure_workspace() = '00000000-0000-4000-8000-0000000d1001', 'ensure_workspace no da P antes de archivar';
  perform public.set_project_archived('00000000-0000-4000-8000-0000000d1001', true);
  select w.archived_at into first_at from public.workspaces w where w.id = '00000000-0000-4000-8000-0000000d1001';
  assert first_at is not null, 'P no quedó archivado';
  perform public.set_project_archived('00000000-0000-4000-8000-0000000d1001', true);
  assert (select w.archived_at from public.workspaces w where w.id = '00000000-0000-4000-8000-0000000d1001') = first_at,
    'archivar dos veces cambió la fecha';
  assert (select w.archived_by from public.workspaces w where w.id = '00000000-0000-4000-8000-0000000d1001')
         = '00000000-0000-4000-8000-0000000d0001', 'archived_by no es la dueña';
  -- Prefiere un proyecto no archivado.
  assert public.ensure_workspace() = '00000000-0000-4000-8000-0000000d1002', 'ensure_workspace da el archivado';
  perform pg_temp.expect_error($q$select public.set_project_archived('00000000-0000-4000-8000-0000000d1001', null)$q$,
    'archived_invalid', 'archivar con null');
end;
$$;

-- Archivado no cambia permisos: el miembro con editar y crear lo ve y edita igual.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0004');
do $$
begin
  assert pg_temp.sees('00000000-0000-4000-8000-0000000d1001') = 1, 'archivado, el miembro no ve P';
  assert private.page_level('00000000-0000-4000-8000-0000000d2001') = 4, 'archivado, el miembro perdió permisos en p1';
  update public.pages set title = 'p1 editada' where id = '00000000-0000-4000-8000-0000000d2001';
  assert (select title from public.pages where id = '00000000-0000-4000-8000-0000000d2001') = 'p1 editada',
    'archivado, el miembro no edita p1';
  update public.pages set title = 'p1' where id = '00000000-0000-4000-8000-0000000d2001';
end;
$$;

-- El creador de un proyecto (miembro, sin ser admin) archiva y desarchiva el suyo. Con su único proyecto propio
-- archivado y otro compartido sin archivar, ensure_workspace da el compartido (el archivado va después de todos).
select set_config('role', 'postgres', true);
insert into public.grants (id, user_id, project_id, page_id, level) values
  ('00000000-0000-4000-8000-0000000d6001', '00000000-0000-4000-8000-0000000d0005', '00000000-0000-4000-8000-0000000d1002',
   null, 'view');
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0005');
do $$
begin
  assert public.ensure_workspace() = '00000000-0000-4000-8000-0000000d1003', 'ensure_workspace no da M a su creador';
  perform public.set_project_archived('00000000-0000-4000-8000-0000000d1003', true);
  assert public.ensure_workspace() = '00000000-0000-4000-8000-0000000d1002',
    'ensure_workspace prefiere el propio archivado a uno compartido sin archivar';
  perform public.set_project_archived('00000000-0000-4000-8000-0000000d1003', false);
end;
$$;
select set_config('role', 'postgres', true);
delete from public.grants where id = '00000000-0000-4000-8000-0000000d6001';
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0005');
do $$
begin
  assert (select w.archived_at from public.workspaces w where w.id = '00000000-0000-4000-8000-0000000d1003') is null,
    'el creador no desarchiva M';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- B. Antes de borrar: lo que muestra la ventana, la huella y quién puede borrar
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$
declare
  i json := public.project_delete_info('00000000-0000-4000-8000-0000000d1001');
begin
  assert (i ->> 'pages')::int = 2 and (i ->> 'trashed_pages')::int = 1, format('páginas: %s', i);
  -- Subidos fuera de la papelera de Drive: f1, f2 (en la papelera de la app) y f4.
  assert (i ->> 'files')::int = 3 and (i ->> 'drive_bytes')::bigint = 321000, format('archivos: %s', i);
  assert (i ->> 'pending_files')::int = 1, format('sin subir: %s', i);
  -- f4 se usa también en o1.
  assert (i ->> 'used_elsewhere')::int = 1, format('usados en otros proyectos: %s', i);
  -- f3 (de O) se usa solo en p2.
  assert (i ->> 'foreign_only_here')::int = 1, format('de otros proyectos usados solo acá: %s', i);
  perform set_config('borrar.info', i::text, true);
  -- ad, av, ep y gu (rx está sacada; la dueña es quien pregunta).
  assert (i ->> 'shared_with')::int = 4, format('compartido con: %s', i);
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000d1001') = '321000/3 20000/1 0/0 4000000/1',
    format('peso de P antes: %s', pg_temp.size_of('00000000-0000-4000-8000-0000000d1001'));
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000d1002') = '50000000/1 0/0 0/0 0/0',
    format('peso de O antes: %s', pg_temp.size_of('00000000-0000-4000-8000-0000000d1002'));
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0004');
do $$
begin
  perform pg_temp.expect_error($q$select public.project_delete_info('00000000-0000-4000-8000-0000000d1001')$q$,
    'not_allowed', 'un miembro sin manejar P lee la ventana de borrar');
end;
$$;

select set_config('role', 'postgres', true);
select set_config('borrar.antes', pg_temp.fingerprint(), true);

-- Quién no puede borrar P.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0004');
do $$ begin
  perform pg_temp.expect_error($q$select public.delete_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'not_allowed', 'un miembro con editar y crear borra P');
end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0003');
do $$ begin
  perform pg_temp.expect_error($q$select public.delete_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'not_allowed', 'una admin con ver borra P');
end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0006');
do $$ begin
  perform pg_temp.expect_error($q$select public.delete_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'not_allowed', 'la invitada borra P');
end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0007');
do $$ begin
  perform pg_temp.expect_error($q$select public.delete_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'project_not_found', 'una admin sin permiso sobre P lo borra');
end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0008');
do $$ begin
  perform pg_temp.expect_error($q$select public.delete_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'project_not_found', 'la sacada borra P');
end; $$;
select pg_temp.as_session('00000000-0000-4000-8000-0000000d0001', '[{"method": "password", "timestamp": 1790000000}]');
do $$ begin
  perform pg_temp.expect_error($q$select public.delete_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'project_not_found', 'la dueña con una sesión de contraseña borra P');
  assert (select count(*) from public.trashed_projects()) = 0, 'con contraseña ve la papelera de proyectos';
end; $$;

-- La dueña lo borra; repetirlo devuelve la misma fecha.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
select set_config('borrar.cuando', public.delete_project('00000000-0000-4000-8000-0000000d1001')::text, true);
do $$
begin
  assert public.delete_project('00000000-0000-4000-8000-0000000d1001') = current_setting('borrar.cuando')::timestamptz,
    'borrar dos veces dio otra fecha';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- C. Con P borrado
-- ---------------------------------------------------------------------------------------------------
-- La dueña (su creadora): no lo ve por ningún camino, ni lo escribe.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$
declare
  n int;
  r record;
begin
  assert pg_temp.sees('00000000-0000-4000-8000-0000000d1001') = 0, 'la dueña ve P borrado';
  assert (select count(*) from public.pages pg where pg.workspace_id = '00000000-0000-4000-8000-0000000d1001') = 0,
    'la dueña ve páginas de P';
  assert (select count(*) from public.page_updates u where u.page_id = '00000000-0000-4000-8000-0000000d2001') = 0,
    'la dueña ve el contenido de p1';
  assert (select count(*) from public.comments c where c.page_id = '00000000-0000-4000-8000-0000000d2001') = 0,
    'la dueña ve los comentarios de p1';
  -- f1 lo creó ella: igual no lo ve.
  assert (select count(*) from public.files f where f.project_id = '00000000-0000-4000-8000-0000000d1001') = 0,
    'la dueña ve archivos de P';
  assert public.media_file('00000000-0000-4000-8000-0000000d3001') is null, 'media_file da f1 (el portero lo serviría)';
  assert private.page_level('00000000-0000-4000-8000-0000000d2001') = 0 and
         private.project_level('00000000-0000-4000-8000-0000000d1001') = 0, 'la dueña tiene nivel sobre P';
  perform pg_temp.expect_error($q$select * from public.pull_page_updates('00000000-0000-4000-8000-0000000d2001', 0)$q$,
    'page_not_found', 'baja el contenido de p1');
  perform pg_temp.expect_error($q$select public.push_page_update('00000000-0000-4000-8000-0000000d2001',
    gen_random_uuid(), 'AQ==', '9.999')$q$, 'page_not_found', 'sube contenido a p1');
  perform pg_temp.expect_error($q$select * from public.list_comments('00000000-0000-4000-8000-0000000d2001')$q$,
    'page_not_found', 'lee los comentarios de p1');
  perform pg_temp.expect_error($q$select public.add_comment(gen_random_uuid(), '00000000-0000-4000-8000-0000000d2001',
    null, null, 'otro')$q$, 'page_not_found', 'comenta en p1');
  perform pg_temp.expect_error($q$select public.register_file(gen_random_uuid(), '00000000-0000-4000-8000-0000000d2001',
    'x.jpg', 'image/jpeg', 10, null, null, null)$q$, 'page_not_found', 'registra un archivo en p1');
  perform pg_temp.expect_error($q$insert into public.pages (id, workspace_id, parent_id, title, sort_key)
    values (gen_random_uuid(), '00000000-0000-4000-8000-0000000d1001', null, 'nueva', 'b0')$q$,
    '42501', 'crea una página en P');
  update public.pages set title = 'cambiada' where id = '00000000-0000-4000-8000-0000000d2001';
  get diagnostics n = row_count;
  assert n = 0, 'cambia el título de p1';
  update public.workspaces set name = 'cambiado' where id = '00000000-0000-4000-8000-0000000d1001';
  get diagnostics n = row_count;
  assert n = 0, 'renombra P';
  perform pg_temp.expect_error($q$select * from public.trashed_files('00000000-0000-4000-8000-0000000d1001')$q$,
    'not_allowed', 've la papelera de archivos de P');
  perform pg_temp.expect_error($q$select public.share('00000000-0000-4000-8000-0000000d0004',
    '00000000-0000-4000-8000-0000000d1001', null, 'view')$q$, 'not_allowed', 'comparte P');
  assert public.ensure_workspace() = '00000000-0000-4000-8000-0000000d1002', 'ensure_workspace da P borrado';
  -- Crear con el mismo id (lo que hace la app vieja al reintentar): no falla y P sigue borrado.
  insert into public.workspaces (id, name) values ('00000000-0000-4000-8000-0000000d1001', 'P otra vez')
  on conflict (id) do nothing;

  -- La papelera de proyectos: P, que ella puede restaurar.
  select * into r from public.trashed_projects() t where t.id = '00000000-0000-4000-8000-0000000d1001';
  assert found and r.can_restore and r.deleted_by = '00000000-0000-4000-8000-0000000d0001'
         and r.deleted_by_email = 'pb-ow@test.invalid' and r.days_left = 30 and r.archived_at is not null
         and r.pages = 2 and r.files = 3, format('papelera de proyectos de la dueña: %s', r);
  -- La ventana da lo mismo con P borrado que antes (las mismas cuentas que la papelera de proyectos).
  assert public.project_delete_info('00000000-0000-4000-8000-0000000d1001')::jsonb = current_setting('borrar.info')::jsonb,
    format('ventana de P borrado: %s', public.project_delete_info('00000000-0000-4000-8000-0000000d1001'));

  -- El peso: f1 y f5 entraron a la papelera de la app (f5 sin subir: solo ahí); f4 sigue en uso por o1.
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000d1001') = '321000/3 4021000/3 0/0 0/0',
    format('peso de P borrado: %s', pg_temp.size_of('00000000-0000-4000-8000-0000000d1001'));
  -- f3 (de O) se usaba solo en p2: entra a la papelera de O, marcado como usado por una página que no está viva.
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000d1002') = '50000000/1 50000000/1 0/0 0/0',
    format('peso de O con P borrado: %s', pg_temp.size_of('00000000-0000-4000-8000-0000000d1002'));
  select * into r from public.trashed_files('00000000-0000-4000-8000-0000000d1002') t
  where t.id = '00000000-0000-4000-8000-0000000d3003';
  assert found and r.in_trashed_page and r.trashed_page_title is null and r.in_deleted_project,
    format('f3 en la papelera de O: %s', r);
  -- Nadie lo manda a la papelera de Drive mientras P esté borrado (la dueña de O no ve p2): al restaurar P vuelve.
  perform pg_temp.expect_error($q$select public.purge_file('00000000-0000-4000-8000-0000000d3003')$q$,
    'file_in_deleted_project', 'manda a Drive un archivo que usa una página de un proyecto borrado');
  select * into r from public.trashed_files('00000000-0000-4000-8000-0000000d1002') t
  where t.id = '00000000-0000-4000-8000-0000000d3003';
  assert r.purged_at is null, 'f3 quedó pedido para Drive';
end;
$$;

-- Fuera de "vaciar" y de la purga automática mientras P esté borrado, aunque tenga más de 30 días.
select set_config('role', 'postgres', true);
update public.files set trashed_at = now() - interval '40 days' where id = '00000000-0000-4000-8000-0000000d3003';
update public.workspace_settings set auto_purge_files = true;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$
begin
  assert not exists (select 1 from public.files_due_for_purge('00000000-0000-4000-8000-0000000d1002') d
                     where d.id = '00000000-0000-4000-8000-0000000d3003'),
    'la purga automática toma un archivo usado por una página de un proyecto borrado';
end;
$$;
select set_config('role', 'postgres', true);
update public.workspace_settings set auto_purge_files = false;
do $$
begin
  -- Ninguna fila se borró y P sigue borrado con su nombre de antes.
  assert (select count(*) from public.pages where workspace_id = '00000000-0000-4000-8000-0000000d1001') = 3,
    'se borraron páginas';
  assert (select count(*) from public.files where id::text like '00000000-0000-4000-8000-0000000d3%') = 5,
    'se borraron archivos';
  assert (select w.name = 'P' and w.deleted_at is not null from public.workspaces w
          where w.id = '00000000-0000-4000-8000-0000000d1001'), 'el upsert cambió P';
end;
$$;

-- La admin con editar y crear: no lo ve, pero lo puede restaurar y ve su peso.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0002');
do $$
begin
  assert pg_temp.sees('00000000-0000-4000-8000-0000000d1001') = 0, 'la admin ve P borrado';
  assert (select t.can_restore from public.trashed_projects() t where t.id = '00000000-0000-4000-8000-0000000d1001'),
    'la admin no puede restaurar P';
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000d1001') = '321000/3 4021000/3 0/0 0/0',
    'la admin no ve el peso de P borrado';
end;
$$;

-- Los que lo veían sin poder restaurarlo: lo ven en la papelera de proyectos, sin restaurar, y nada más.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0003');
do $$
begin
  assert (select not t.can_restore from public.trashed_projects() t where t.id = '00000000-0000-4000-8000-0000000d1001'),
    'la admin con ver no lo ve en la papelera de proyectos, o lo puede restaurar';
  -- Una admin ve quién lo borró, pero no cuánto tenía (no lo maneja).
  assert (select t.deleted_by_email = 'pb-ow@test.invalid' and t.pages is null and t.files is null
          from public.trashed_projects() t where t.id = '00000000-0000-4000-8000-0000000d1001'),
    'la admin con ver: quién lo borró o los números de P no son los esperados';
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000d1001') is null, 'la admin con ver ve el peso de P borrado';
  perform pg_temp.expect_error($q$select public.restore_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'not_allowed', 'la admin con ver restaura P');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0004');
do $$
begin
  assert pg_temp.sees('00000000-0000-4000-8000-0000000d1001') = 0, 'el miembro ve P borrado';
  assert private.page_level('00000000-0000-4000-8000-0000000d2001') = 0, 'el miembro tiene nivel sobre p1';
  assert (select not t.can_restore from public.trashed_projects() t where t.id = '00000000-0000-4000-8000-0000000d1001'),
    'el miembro no lo ve en la papelera de proyectos, o lo puede restaurar';
  assert (select t.deleted_by_email is null and t.pages is null
          from public.trashed_projects() t where t.id = '00000000-0000-4000-8000-0000000d1001'),
    'el miembro ve quién borró P o cuánto tenía';
  assert public.ensure_workspace() is null, 'ensure_workspace da al miembro un proyecto borrado';
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0006');
do $$
begin
  assert pg_temp.sees('00000000-0000-4000-8000-0000000d1001') = 0, 'la invitada ve P borrado';
  assert (select count(*) from public.pages pg where pg.id = '00000000-0000-4000-8000-0000000d2001') = 0,
    'la invitada ve p1';
  assert (select not t.can_restore from public.trashed_projects() t where t.id = '00000000-0000-4000-8000-0000000d1001'),
    'la invitada no lo ve en la papelera de proyectos, o lo puede restaurar';
  -- Ni el correo de quien lo borró ni cuánto tenía el proyecto: solo veía una página.
  assert (select t.deleted_by is null and t.deleted_by_email is null and t.pages is null and t.files is null
          from public.trashed_projects() t where t.id = '00000000-0000-4000-8000-0000000d1001'),
    'la invitada ve quién borró P o cuánto tenía';
end;
$$;
-- Los que nunca lo vieron: tampoco en la papelera de proyectos.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0007');
do $$
begin
  assert not exists (select 1 from public.trashed_projects() t where t.id = '00000000-0000-4000-8000-0000000d1001'),
    'la admin sin permiso ve P en la papelera de proyectos';
  perform pg_temp.expect_error($q$select public.restore_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'project_not_found', 'la admin sin permiso restaura P');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0008');
do $$
begin
  assert (select count(*) from public.trashed_projects()) = 0, 'la sacada ve la papelera de proyectos';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- D. Restaurar: todo exactamente como estaba
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0004');
do $$ begin
  perform pg_temp.expect_error($q$select public.restore_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'not_allowed', 'un miembro con editar y crear restaura P');
end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0002');
select public.restore_project('00000000-0000-4000-8000-0000000d1001');
select public.restore_project('00000000-0000-4000-8000-0000000d1001');
select set_config('role', 'postgres', true);
do $$
begin
  assert pg_temp.fingerprint() = current_setting('borrar.antes'), 'restaurar no dejó todo como estaba';
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0004');
do $$
begin
  assert pg_temp.sees('00000000-0000-4000-8000-0000000d1001') = 1, 'restaurado, el miembro no ve P';
  assert private.page_level('00000000-0000-4000-8000-0000000d2001') = 4, 'restaurado, el miembro no tiene 4 en p1';
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0006');
do $$
begin
  assert (select count(*) from public.pages pg where pg.id = '00000000-0000-4000-8000-0000000d2001') = 1,
    'restaurado, la invitada no ve p1';
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$
begin
  assert (select count(*) from public.files f where f.project_id = '00000000-0000-4000-8000-0000000d1001') = 4,
    'restaurado, la dueña no ve los archivos de P';
  assert public.media_file('00000000-0000-4000-8000-0000000d3001') is not null, 'restaurado, media_file no da f1';
  assert (select count(*) from public.list_comments('00000000-0000-4000-8000-0000000d2001')) = 1,
    'restaurado, no está el comentario';
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000d1001') = '321000/3 20000/1 0/0 4000000/1',
    'restaurado, el peso de P no es el de antes';
  -- Sigue archivado (como estaba antes de borrarlo): ensure_workspace sigue dando O.
  assert public.ensure_workspace() = '00000000-0000-4000-8000-0000000d1002', 'restaurado, P dejó de estar archivado';
  -- E. Desarchivar.
  perform public.set_project_archived('00000000-0000-4000-8000-0000000d1001', false);
  assert public.ensure_workspace() = '00000000-0000-4000-8000-0000000d1001', 'desarchivado, ensure_workspace no da P';
end;
$$;

-- El creador (miembro) borra y restaura el suyo.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0005');
do $$
begin
  perform public.delete_project('00000000-0000-4000-8000-0000000d1003');
  assert pg_temp.sees('00000000-0000-4000-8000-0000000d1003') = 0, 'el creador ve M borrado';
  assert (select t.can_restore from public.trashed_projects() t where t.id = '00000000-0000-4000-8000-0000000d1003'),
    'el creador no puede restaurar M';
  perform public.restore_project('00000000-0000-4000-8000-0000000d1003');
  assert pg_temp.sees('00000000-0000-4000-8000-0000000d1003') = 1, 'el creador no recuperó M';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- F. Una invitación aceptada mientras el proyecto está borrado vale al restaurarlo
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0002');
select public.create_invitation('pb-nu@test.invalid', 'guest',
  jsonb_build_array(jsonb_build_object('project_id', '00000000-0000-4000-8000-0000000d1001', 'level', 'view')));
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
select public.delete_project('00000000-0000-4000-8000-0000000d1001');
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0009');
do $$
begin
  assert public.accept_invitations() = 1, 'la invitada nueva no aplicó su invitación';
  assert pg_temp.sees('00000000-0000-4000-8000-0000000d1001') = 0, 'la invitada nueva ve P borrado';
end;
$$;
select set_config('role', 'postgres', true);
do $$
begin
  assert exists (select 1 from public.grants g
                 where g.user_id = '00000000-0000-4000-8000-0000000d0009'
                   and g.project_id = '00000000-0000-4000-8000-0000000d1001'
                   and g.level = 'view' and g.revoked_at is null),
    'el permiso de la invitación se perdió por estar P borrado';
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0002');
select public.restore_project('00000000-0000-4000-8000-0000000d1001');
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0009');
do $$
begin
  assert pg_temp.sees('00000000-0000-4000-8000-0000000d1001') = 1, 'restaurado, la invitada nueva no ve P';
  assert private.page_level('00000000-0000-4000-8000-0000000d2001') = 1, 'restaurado, la invitada nueva no ve p1';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- G. Las marcas no se escriben desde la API, y nada se borra
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$
begin
  perform pg_temp.expect_error($q$update public.workspaces set deleted_at = now()
    where id = '00000000-0000-4000-8000-0000000d1001'$q$, '42501', 'marca el borrado directo');
  perform pg_temp.expect_error($q$update public.workspaces set archived_at = now()
    where id = '00000000-0000-4000-8000-0000000d1001'$q$, '42501', 'marca el archivado directo');
  perform pg_temp.expect_error($q$insert into public.workspaces (id, name, deleted_at)
    values ('00000000-0000-4000-8000-0000000d1009', 'X', now())$q$, '42501', 'crea un proyecto ya borrado');
  perform pg_temp.expect_error($q$delete from public.workspaces where id = '00000000-0000-4000-8000-0000000d1001'$q$,
    '42501', 'borra un proyecto desde la API');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- H. Sin sesión, nada; y cómo quedaron las funciones
-- ---------------------------------------------------------------------------------------------------
select set_config('role', 'anon', true);
select set_config('request.jwt.claims', '', true);
do $$
begin
  perform pg_temp.expect_error($q$select * from public.trashed_projects()$q$, '42501', 'anon ve la papelera de proyectos');
  perform pg_temp.expect_error($q$select public.delete_project('00000000-0000-4000-8000-0000000d1001')$q$,
    '42501', 'anon borra');
  perform pg_temp.expect_error($q$select public.restore_project('00000000-0000-4000-8000-0000000d1001')$q$,
    '42501', 'anon restaura');
  perform pg_temp.expect_error($q$select public.set_project_archived('00000000-0000-4000-8000-0000000d1001', true)$q$,
    '42501', 'anon archiva');
  perform pg_temp.expect_error($q$select public.project_delete_info('00000000-0000-4000-8000-0000000d1001')$q$,
    '42501', 'anon lee la ventana de borrar');
end;
$$;

select set_config('role', 'postgres', true);
do $$
declare
  fn text;
begin
  -- restore_project suma un parámetro con la entrega 2 (migración 10): vale cualquiera de las dos firmas.
  foreach fn in array array['public.delete_project(uuid)',
                            coalesce(to_regprocedure('public.restore_project(uuid)'),
                                     to_regprocedure('public.restore_project(uuid,boolean)'))::text,
                            'public.set_project_archived(uuid,boolean)', 'public.trashed_projects()',
                            'public.project_delete_info(uuid)', 'private.can_manage_project(uuid)',
                            'private.could_view_project(uuid,uuid)', 'private.refresh_project_files(uuid)',
                            'private.user_page_level_any(uuid,uuid)', 'private.user_project_level_any(uuid,uuid)',
                            'private.page_alive_any(uuid)', 'private.file_in_deleted_project(uuid)',
                            'private.project_numbers(uuid)', 'public.purge_file(uuid)', 'public.trashed_files(uuid)'] loop
    assert (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p
            where p.oid = fn::regprocedure), format('%s no es security definer con search_path vacío', fn);
  end loop;
  assert not has_function_privilege('authenticated', 'private.refresh_project_files(uuid)', 'execute'),
    'authenticated puede recalcular la papelera de un proyecto';
  assert not has_function_privilege('authenticated', 'private.user_page_level_any(uuid,uuid)', 'execute'),
    'authenticated llama a user_page_level_any';
  foreach fn in array array['private.could_view_project(uuid,uuid)', 'private.can_manage_project(uuid)',
                            'private.page_alive_any(uuid)', 'private.file_in_deleted_project(uuid)',
                            'private.project_numbers(uuid)'] loop
    assert not has_function_privilege('authenticated', fn, 'execute'), format('authenticated llama a %s', fn);
  end loop;
  assert has_function_privilege('authenticated', 'public.trashed_files(uuid)', 'execute'),
    'authenticated perdió trashed_files';
  assert (select schema_version from public.workspace_settings where id) >= 9, 'la versión de la base no es 9';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- I. Todos los niveles en 0 con el proyecto borrado, y de vuelta igual al restaurar (por persona), más los
--    buckets `page-files` y `thumbs`
-- ---------------------------------------------------------------------------------------------------
-- Todo lo que decide permisos sobre P, p1, p2 y f1, en un texto. Corre como la sesión.
create function pg_temp.levels() returns text language sql as $$
  select concat_ws(' ',
    'pl1=' || private.page_level('00000000-0000-4000-8000-0000000d2001'),
    'pl2=' || private.page_level('00000000-0000-4000-8000-0000000d2002'),
    'prl=' || private.project_level('00000000-0000-4000-8000-0000000d1001'),
    'vp=' || private.can_view_page('00000000-0000-4000-8000-0000000d2001'),
    'ep=' || private.can_edit_page('00000000-0000-4000-8000-0000000d2001'),
    'cp=' || private.can_create_page('00000000-0000-4000-8000-0000000d1001', null),
    'cpp=' || private.can_create_page('00000000-0000-4000-8000-0000000d1001', '00000000-0000-4000-8000-0000000d2001'),
    'sh=' || private.can_share('00000000-0000-4000-8000-0000000d1001', null),
    'shp=' || private.can_share(null, '00000000-0000-4000-8000-0000000d2001'),
    'ft=' || private.can_see_file_trash('00000000-0000-4000-8000-0000000d1001'),
    'pu=' || private.can_purge_files('00000000-0000-4000-8000-0000000d1001'),
    'fl=' || private.file_level('00000000-0000-4000-8000-0000000d3001'),
    'es=' || private.can_edit_some_page('00000000-0000-4000-8000-0000000d1001'),
    'w=' || (select count(*) from public.workspaces w where w.id = '00000000-0000-4000-8000-0000000d1001'),
    'pg=' || (select count(*) from public.pages pg where pg.workspace_id = '00000000-0000-4000-8000-0000000d1001'),
    'up=' || (select count(*) from public.page_updates u where u.page_id = '00000000-0000-4000-8000-0000000d2001'),
    'f=' || (select count(*) from public.files f where f.project_id = '00000000-0000-4000-8000-0000000d1001'),
    'pf=' || (select count(*) from public.page_files pf where pf.page_id = '00000000-0000-4000-8000-0000000d2001'),
    'c=' || (select count(*) from public.comments c where c.page_id = '00000000-0000-4000-8000-0000000d2001'),
    'st=' || (select count(*) from storage.objects o
              where (o.bucket_id = 'thumbs' and o.name = '00000000-0000-4000-8000-0000000d3001.jpg')
                 or (o.bucket_id = 'page-files' and o.name = '00000000-0000-4000-8000-0000000d2001/x.jpg')));
$$;

-- Lo que da todo cero.
create function pg_temp.zero() returns text language sql as $$
  select 'pl1=0 pl2=0 prl=0 vp=false ep=false cp=false cpp=false sh=false shp=false ft=false pu=false fl=0 es=false w=0 pg=0 up=0 f=0 pf=0 c=0 st=0';
$$;

select set_config('role', 'postgres', true);
-- Una miniatura de f1 y un archivo viejo de p1 en los buckets (filas solas: el contenido no importa).
insert into storage.objects (bucket_id, name) values
  ('thumbs', '00000000-0000-4000-8000-0000000d3001.jpg'),
  ('page-files', '00000000-0000-4000-8000-0000000d2001/x.jpg');

-- Antes de borrar: cada persona anota lo suyo.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001'); select set_config('borrar.lv1', pg_temp.levels(), true);
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0002'); select set_config('borrar.lv2', pg_temp.levels(), true);
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0004'); select set_config('borrar.lv4', pg_temp.levels(), true);
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0006'); select set_config('borrar.lv6', pg_temp.levels(), true);
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0007'); select set_config('borrar.lv7', pg_temp.levels(), true);
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0009'); select set_config('borrar.lv9', pg_temp.levels(), true);

do $$
begin
  -- Que la prueba mida algo: antes de borrar, la dueña ve todo, la invitada ve p1 y p2 por su permiso de
  -- página, y la admin sin permiso no ve nada.
  assert current_setting('borrar.lv1') like 'pl1=4 pl2=4 prl=4 vp=true ep=true cp=true cpp=true sh=true shp=true ft=true pu=true fl=4 es=true w=1 pg=3 up=1 f=4 pf=2 c=1 st=2',
    format('la dueña antes: %s', current_setting('borrar.lv1'));
  assert current_setting('borrar.lv6') like 'pl1=1 pl2=1 prl=0 vp=true ep=false % w=1 pg=2 %',
    format('la invitada antes: %s', current_setting('borrar.lv6'));
  assert current_setting('borrar.lv7') = pg_temp.zero(), format('la admin sin permiso antes: %s', current_setting('borrar.lv7'));
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-0000000d0002');
select public.delete_project('00000000-0000-4000-8000-0000000d1001');

-- Con P borrado: todo en cero para todos (dueña, admin que lo borró, miembro, invitada por página, sin permiso,
-- invitada nueva).
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$ begin assert pg_temp.levels() = pg_temp.zero(), format('dueña con P borrado: %s', pg_temp.levels()); end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0002');
do $$ begin assert pg_temp.levels() = pg_temp.zero(), format('admin con P borrado: %s', pg_temp.levels()); end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0004');
do $$ begin assert pg_temp.levels() = pg_temp.zero(), format('miembro con P borrado: %s', pg_temp.levels()); end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0006');
do $$
begin
  assert pg_temp.levels() = pg_temp.zero(), format('invitada con P borrado: %s', pg_temp.levels());
  -- Tampoco por los caminos de la papelera de archivos ni del portero.
  assert public.media_file('00000000-0000-4000-8000-0000000d3001') is null, 'la invitada: media_file da f1';
  perform pg_temp.expect_error($q$select public.project_delete_info('00000000-0000-4000-8000-0000000d1001')$q$,
    'not_allowed', 'la invitada lee la ventana de borrar de P borrado');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0007');
do $$
begin
  assert pg_temp.levels() = pg_temp.zero(), format('admin sin permiso con P borrado: %s', pg_temp.levels());
  perform pg_temp.expect_error($q$select public.project_delete_info('00000000-0000-4000-8000-0000000d1001')$q$,
    'project_not_found', 'la admin sin permiso lee la ventana de borrar');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0009');
do $$ begin assert pg_temp.levels() = pg_temp.zero(), format('invitada nueva con P borrado: %s', pg_temp.levels()); end; $$;

-- Un proyecto borrado no se puede archivar; y la papelera la ve la invitada por página (sin restaurar).
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$
begin
  perform pg_temp.expect_error($q$select public.set_project_archived('00000000-0000-4000-8000-0000000d1001', true)$q$,
    'project_deleted', 'archiva un proyecto borrado');
end;
$$;

-- Restaurar (la dueña): cada persona vuelve a tener exactamente lo de antes.
select public.restore_project('00000000-0000-4000-8000-0000000d1001');
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$ begin assert pg_temp.levels() = current_setting('borrar.lv1'), format('dueña restaurado: %s', pg_temp.levels()); end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0002');
do $$ begin assert pg_temp.levels() = current_setting('borrar.lv2'), format('admin restaurado: %s', pg_temp.levels()); end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0004');
do $$ begin assert pg_temp.levels() = current_setting('borrar.lv4'), format('miembro restaurado: %s', pg_temp.levels()); end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0006');
do $$ begin assert pg_temp.levels() = current_setting('borrar.lv6'), format('invitada restaurado: %s', pg_temp.levels()); end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0007');
do $$ begin assert pg_temp.levels() = current_setting('borrar.lv7'), format('sin permiso restaurado: %s', pg_temp.levels()); end; $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0009');
do $$ begin assert pg_temp.levels() = current_setting('borrar.lv9'), format('invitada nueva restaurado: %s', pg_temp.levels()); end; $$;
select set_config('role', 'postgres', true);

rollback;

select 'ok' as result;
