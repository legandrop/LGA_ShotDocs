-- Pruebas de la carpeta de un proyecto borrado en la papelera de Drive (P.14, entrega 2; Docs/Doc_Proyectos_Borrar.md,
-- secciones 3.6 y 3.7): quién puede mandar y traer la carpeta (dueño y admins que manejan el proyecto; el creador
-- miembro no), que solo con el proyecto borrado, los pasos del portero en orden, el peso pedido y confirmado, que
-- restaurar pide traerla primero, la huella igual después de traerla, restaurar sin la carpeta (una marca del
-- proyecto, reversible, ningún archivo marcado), volver a mandarla con un archivo nuevo, ninguna fila borrada y sin
-- sesión nada. La preparación es la de proyectos_borrar_permisos.sql (las mismas personas y datos). Corre dentro de
-- una transacción que se deshace al final: no deja usuarios ni datos. Si todo pasa, devuelve una fila con
-- result = 'ok'.

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

-- Pruebas de la entrega 2 (la carpeta del proyecto en la papelera de Drive). Siguen a las de la entrega 1, con
-- las mismas personas y datos (P activo, sin archivar; f1, f2 y f4 subidos, f5 sin subir).

-- ---------------------------------------------------------------------------------------------------
-- J1. Quién puede, y solo con el proyecto borrado
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$
begin
  assert (public.media_project('00000000-0000-4000-8000-0000000d1001') ->> 'deleted_at') is null,
    'media_project: P activo no da su fila a la dueña';
  perform pg_temp.expect_error($q$select public.request_project_drive_trash('00000000-0000-4000-8000-0000000d1001')$q$,
    'project_not_deleted', 'manda a Drive la carpeta de un proyecto activo');
end;
$$;

select set_config('role', 'postgres', true);
select set_config('borrar.antes10', pg_temp.fingerprint(), true);
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0002');
select public.delete_project('00000000-0000-4000-8000-0000000d1001');

-- Un miembro con editar y crear (no lo maneja), la admin con ver, la invitada y la admin sin permiso: nada.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0004');
do $$
begin
  assert public.media_project('00000000-0000-4000-8000-0000000d1001') is null, 'media_project da P a un miembro';
  perform pg_temp.expect_error($q$select public.request_project_drive_trash('00000000-0000-4000-8000-0000000d1001')$q$,
    'not_allowed', 'un miembro manda la carpeta de P');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0003');
do $$
begin
  assert public.media_project('00000000-0000-4000-8000-0000000d1001') is null, 'media_project da P a la admin con ver';
  perform pg_temp.expect_error($q$select public.request_project_drive_trash('00000000-0000-4000-8000-0000000d1001')$q$,
    'not_allowed', 'la admin con ver manda la carpeta de P');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0006');
do $$
begin
  assert public.media_project('00000000-0000-4000-8000-0000000d1001') is null, 'media_project da P a la invitada';
  perform pg_temp.expect_error($q$select public.project_drive_untrashed('00000000-0000-4000-8000-0000000d1001')$q$,
    'not_allowed', 'la invitada trae la carpeta de P');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0007');
do $$
begin
  assert public.media_project('00000000-0000-4000-8000-0000000d1001') is null, 'media_project da P a la admin sin permiso';
end;
$$;

-- El creador de un proyecto que no es dueño ni admin lo borra y lo restaura, pero no manda su carpeta.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0005');
do $$
begin
  perform public.delete_project('00000000-0000-4000-8000-0000000d1003');
  assert public.media_project('00000000-0000-4000-8000-0000000d1003') is null, 'media_project da M a su creador miembro';
  perform pg_temp.expect_error($q$select public.request_project_drive_trash('00000000-0000-4000-8000-0000000d1003')$q$,
    'not_allowed', 'el creador miembro manda la carpeta de M');
  assert (select not t.can_purge from public.trashed_projects() t where t.id = '00000000-0000-4000-8000-0000000d1003'),
    'trashed_projects: el creador miembro puede mandar la carpeta de M';
  perform public.restore_project('00000000-0000-4000-8000-0000000d1003');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- J2. La dueña manda la carpeta (los pasos del portero), y restaurar pide traerla primero
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$
declare
  r record;
  first_at timestamptz;
begin
  perform pg_temp.expect_error($q$select public.project_drive_trashed('00000000-0000-4000-8000-0000000d1001')$q$,
    'project_drive_not_requested', 'confirma una carpeta que nadie pidió');
  perform public.request_project_drive_trash('00000000-0000-4000-8000-0000000d1001');
  first_at := (public.media_project('00000000-0000-4000-8000-0000000d1001') ->> 'drive_trash_requested_at')::timestamptz;
  assert first_at is not null, 'media_project no muestra el pedido';
  perform public.request_project_drive_trash('00000000-0000-4000-8000-0000000d1001');
  -- Pedida y sin confirmar: el peso sigue como con el proyecto borrado (puede que siga en Drive).
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000d1001') = '321000/3 4021000/3 0/0 0/0',
    format('peso de P con la carpeta pedida: %s', pg_temp.size_of('00000000-0000-4000-8000-0000000d1001'));
  perform public.project_drive_trashed('00000000-0000-4000-8000-0000000d1001');
  perform public.project_drive_trashed('00000000-0000-4000-8000-0000000d1001');
  -- Confirmada: lo subido (f1, f2, f4) está en la papelera de Drive; f5 (sin subir) sigue en la de la app.
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000d1001') = '0/0 4000000/1 321000/3 0/0',
    format('peso de P con la carpeta en la papelera de Drive: %s', pg_temp.size_of('00000000-0000-4000-8000-0000000d1001'));
  select * into r from public.trashed_projects() t where t.id = '00000000-0000-4000-8000-0000000d1001';
  assert found and r.can_purge and r.drive_trashed_at is not null and r.drive_trash_requested_at = first_at,
    format('trashed_projects de la dueña con la carpeta: %s', r);
  perform pg_temp.expect_error($q$select public.restore_project('00000000-0000-4000-8000-0000000d1001')$q$,
    'drive_untrash_first', 'restaura sin traer la carpeta');
  -- Ningún archivo cambió: la marca es del proyecto.
  assert not exists (select 1 from public.files f where f.id::text like '00000000-0000-4000-8000-0000000d3%'
                     and (f.purged_at is not null or f.drive_trashed_at is not null)),
    'mandar la carpeta marcó archivos';
end;
$$;
-- Quien no maneja P no ve el estado de Drive.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0004');
do $$
begin
  assert (select t.drive_trashed_at is null and not t.can_purge from public.trashed_projects() t
          where t.id = '00000000-0000-4000-8000-0000000d1001'), 'el miembro ve el estado de Drive de P';
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000d1001') is null, 'el miembro ve el peso de P';
end;
$$;
-- La admin que maneja P (no la que lo mandó) lo trae y lo restaura: todo exactamente como estaba.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0002');
select public.project_drive_untrashed('00000000-0000-4000-8000-0000000d1001');
select public.project_drive_untrashed('00000000-0000-4000-8000-0000000d1001');
select public.restore_project('00000000-0000-4000-8000-0000000d1001');
select set_config('role', 'postgres', true);
do $$
begin
  assert pg_temp.fingerprint() = current_setting('borrar.antes10'), 'traer la carpeta y restaurar no dejó todo como estaba';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- J3. Restaurar sin la carpeta (el portero, con Drive conectado a la misma cuenta, no la encontró): una marca del
--     proyecto, reversible, y ningún archivo marcado
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
select public.delete_project('00000000-0000-4000-8000-0000000d1001');
select public.request_project_drive_trash('00000000-0000-4000-8000-0000000d1001');
select public.project_drive_trashed('00000000-0000-4000-8000-0000000d1001');
select public.restore_project('00000000-0000-4000-8000-0000000d1001', true);
do $$
begin
  assert pg_temp.sees('00000000-0000-4000-8000-0000000d1001') = 1, 'restaurado sin la carpeta, la dueña no ve P';
  assert (select w.drive_missing_at is not null and w.drive_missing_by = '00000000-0000-4000-8000-0000000d0001'
                 and w.drive_trash_requested_at is not null and w.drive_trashed_at is not null
          from public.workspaces w where w.id = '00000000-0000-4000-8000-0000000d1001'),
    'no quedó la marca de "sin la carpeta" en P';
  -- Ningún archivo cambió: la marca es del proyecto.
  assert not exists (select 1 from public.files f where f.id::text like '00000000-0000-4000-8000-0000000d3%'
                     and (f.purged_at is not null or f.drive_trashed_at is not null)),
    'restaurar sin la carpeta marcó archivos';
  -- Lo subido hasta el pedido (f1, f2, f4) no está en este Drive: no cuenta; f5 vuelve a estar en uso y sin subir.
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000d1001') = '0/0 0/0 0/0 4000000/1',
    format('peso de P restaurado sin la carpeta: %s', pg_temp.size_of('00000000-0000-4000-8000-0000000d1001'));
  -- No se puede confirmar una carpeta que no está.
  perform pg_temp.expect_error($q$select public.project_drive_trashed('00000000-0000-4000-8000-0000000d1001')$q$,
    'project_drive_not_requested', 'confirma la carpeta de un proyecto restaurado sin ella');
end;
$$;
-- La carpeta aparece (Drive reconectado a la cuenta de antes): el portero la trae y todo vuelve a como estaba.
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0002');
select public.project_drive_untrashed('00000000-0000-4000-8000-0000000d1001');
select set_config('role', 'postgres', true);
do $$
begin
  assert pg_temp.fingerprint() = current_setting('borrar.antes10'), 'traer la carpeta después de restaurar sin ella no dejó todo como estaba';
end;
$$;

-- J3b. Restaurado sin la carpeta, con un archivo nuevo (a la carpeta nueva), se vuelve a borrar y a mandar la
--      carpeta: la marca vieja se cierra archivo por archivo (f1, f2, f4) y el archivo nuevo (f6) queda con la
--      carpeta nueva
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
select public.delete_project('00000000-0000-4000-8000-0000000d1001');
select public.request_project_drive_trash('00000000-0000-4000-8000-0000000d1001');
select public.project_drive_trashed('00000000-0000-4000-8000-0000000d1001');
select public.restore_project('00000000-0000-4000-8000-0000000d1001', true);
select set_config('role', 'postgres', true);
insert into public.files (id, project_id, name, mime, size, drive_id, uploaded_at, created_by) values
  ('00000000-0000-4000-8000-0000000d3006', '00000000-0000-4000-8000-0000000d1001', 'f6.jpg', 'image/jpeg', 7000,
   'drive_f6_xxxxxxxx', now() + interval '1 hour', '00000000-0000-4000-8000-0000000d0001');
insert into public.page_files (page_id, file_id, is_foreign) values
  ('00000000-0000-4000-8000-0000000d2001', '00000000-0000-4000-8000-0000000d3006', false);
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$
begin
  -- f6 (subido después, a otra carpeta) cuenta como siempre.
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000d1001') = '7000/1 0/0 0/0 4000000/1',
    format('peso de P con f6: %s', pg_temp.size_of('00000000-0000-4000-8000-0000000d1001'));
  perform public.delete_project('00000000-0000-4000-8000-0000000d1001');
  -- Borrado otra vez con la marca vieja, se vuelve a mandar la carpeta.
  perform public.request_project_drive_trash('00000000-0000-4000-8000-0000000d1001');
end;
$$;
-- Lo que quedó (como dueño de la base: con P borrado la dueña no ve sus filas).
select set_config('role', 'postgres', true);
do $$
begin
  assert (select w.drive_missing_at is null and w.drive_trash_requested_at is not null and w.drive_trashed_at is null
          from public.workspaces w where w.id = '00000000-0000-4000-8000-0000000d1001'),
    'el pedido nuevo no reemplazó a la marca vieja';
  assert (select count(*) from public.files f where f.project_id = '00000000-0000-4000-8000-0000000d1001'
          and f.purged_at is not null and f.drive_trashed_at is not null) = 3,
    'la marca vieja no se cerró en f1, f2 y f4';
  assert (select f.purged_at is null and f.drive_trashed_at is null from public.files f
          where f.id = '00000000-0000-4000-8000-0000000d3006'), 'la marca vieja alcanzó a f6';
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
do $$
begin
  perform public.project_drive_untrashed('00000000-0000-4000-8000-0000000d1001');
  perform public.restore_project('00000000-0000-4000-8000-0000000d1001');
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000d1001') = '7000/1 0/0 321000/3 4000000/1',
    format('peso de P al final: %s', pg_temp.size_of('00000000-0000-4000-8000-0000000d1001'));
end;
$$;
select set_config('role', 'postgres', true);
do $$
begin
  -- Ninguna fila se borró.
  assert (select count(*) from public.pages where workspace_id = '00000000-0000-4000-8000-0000000d1001') = 3,
    'se borraron páginas';
  assert (select count(*) from public.page_files where file_id::text like '00000000-0000-4000-8000-0000000d3%') = 7,
    'se borraron usos';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- J4. Sin sesión, nada; y cómo quedaron las funciones
-- ---------------------------------------------------------------------------------------------------
select set_config('role', 'anon', true);
select set_config('request.jwt.claims', '', true);
do $$
begin
  perform pg_temp.expect_error($q$select public.media_project('00000000-0000-4000-8000-0000000d1001')$q$, '42501', 'anon: media_project');
  perform pg_temp.expect_error($q$select public.request_project_drive_trash('00000000-0000-4000-8000-0000000d1001')$q$, '42501', 'anon: pide');
  perform pg_temp.expect_error($q$select public.project_drive_trashed('00000000-0000-4000-8000-0000000d1001')$q$, '42501', 'anon: confirma');
  perform pg_temp.expect_error($q$select public.project_drive_untrashed('00000000-0000-4000-8000-0000000d1001')$q$, '42501', 'anon: trae');
  perform pg_temp.expect_error($q$select public.restore_project('00000000-0000-4000-8000-0000000d1001', true)$q$, '42501', 'anon: restaura');
end;
$$;
select set_config('role', 'postgres', true);
do $$
declare
  fn text;
begin
  foreach fn in array array['public.media_project(uuid)', 'public.request_project_drive_trash(uuid)',
                            'public.project_drive_trashed(uuid)', 'public.project_drive_untrashed(uuid)',
                            'public.restore_project(uuid,boolean)', 'public.trashed_projects()',
                            'private.can_purge_project(uuid)', 'private.project_files_purged(uuid)'] loop
    assert (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p
            where p.oid = fn::regprocedure), format('%s no es security definer con search_path vacío', fn);
  end loop;
  assert not has_function_privilege('authenticated', 'private.project_files_purged(uuid)', 'execute'),
    'authenticated marca los archivos de un proyecto';
  assert not has_function_privilege('authenticated', 'private.can_purge_project(uuid)', 'execute'),
    'authenticated llama a can_purge_project';
  assert to_regprocedure('public.restore_project(uuid)') is null, 'quedó la firma vieja de restore_project';
  assert (select schema_version from public.workspace_settings where id) >= 10, 'la versión de la base no es 10';
end;
$$;

rollback;

select 'ok' as result;
