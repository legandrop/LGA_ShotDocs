-- Pruebas del peso de los proyectos en el Drive (P.7, `project_sizes`): qué estado cuenta dónde (en uso,
-- en la papelera de la app, en la papelera de Drive hoy y hace 40 días, sin subir, un uso de otro
-- proyecto), quién ve el peso de cada proyecto, la fila sin proyecto solo para el dueño y que llamarla no
-- cambia nada. Corre dentro de una transacción que se deshace al final: no deja usuarios ni datos. Si todo
-- pasa, devuelve una fila con result = 'ok'.

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

-- El peso de un proyecto como lo ve la sesión, en una línea: principal, papelera de la app, papelera de
-- Drive y sin subir (bytes/archivos). Con `p` nulo, la fila de los que no ve. Null si no viene.
create function pg_temp.size_of(p uuid) returns text language sql as $$
  select format('%s/%s %s/%s %s/%s %s/%s', s.drive_bytes, s.drive_files, s.trash_bytes, s.trash_files,
                s.drive_trash_bytes, s.drive_trash_files, s.pending_bytes, s.pending_files)
  from public.project_sizes() s where s.project_id is not distinct from p;
$$;

-- Los proyectos (con nombre) que devuelve para la sesión, ordenados.
create function pg_temp.seen() returns uuid[] language sql as $$
  select coalesce(array_agg(s.project_id order by s.project_id), '{}')
  from public.project_sizes() s where s.project_id is not null;
$$;

create function pg_temp.hidden_rows() returns int language sql as $$
  select count(*)::int from public.project_sizes() s where s.project_id is null;
$$;

-- Todo lo que la función no debería tocar, en una huella.
create function pg_temp.fingerprint() returns text language sql as $$
  select md5(concat_ws('|',
    (select string_agg(f::text, ',' order by f.id) from public.files f),
    (select string_agg(pf::text, ',' order by pf.page_id, pf.file_id) from public.page_files pf),
    (select string_agg(w::text, ',' order by w.id) from public.workspaces w),
    (select string_agg(g::text, ',' order by g.id) from public.grants g),
    (select string_agg(m::text, ',' order by m.user_id) from public.members m),
    (select s::text from public.workspace_settings s where s.id)));
$$;

-- Personas (todas con correo @test.invalid):
--   ow   dueña del workspace, creó P y O          ad   admin con ver sobre P
--   ad2  admin sin permiso sobre P; creó Q (privado) y R (con la dueña solo en una página)
--   ep   miembro con editar y crear páginas sobre P
--   ed   miembro con editar sobre P               gu   invitada con ver la página p1
--   rx   miembro con editar y crear sobre P, sacada
insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000c0001', 'pp-ow@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000c0002', 'pp-ad@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000c0003', 'pp-ad2@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000c0004', 'pp-ep@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000c0005', 'pp-ed@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000c0006', 'pp-gu@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000c0007', 'pp-rx@test.invalid', 'authenticated', 'authenticated', now());

-- Si la base ya tiene dueño, queda fuera de la prueba (se deshace al final): hay un solo dueño activo.
update public.members set removed_at = now() where role = 'owner' and removed_at is null;
update public.workspace_settings set owner_id = '00000000-0000-4000-8000-0000000c0001';

insert into public.members (user_id, role, removed_at) values
  ('00000000-0000-4000-8000-0000000c0001', 'owner', null),
  ('00000000-0000-4000-8000-0000000c0002', 'admin', null),
  ('00000000-0000-4000-8000-0000000c0003', 'admin', null),
  ('00000000-0000-4000-8000-0000000c0004', 'member', null),
  ('00000000-0000-4000-8000-0000000c0005', 'member', null),
  ('00000000-0000-4000-8000-0000000c0006', 'guest', null),
  ('00000000-0000-4000-8000-0000000c0007', 'member', now());

-- P y O (de la dueña): p1 en P, o1 en O. O no tiene archivos propios.
insert into public.workspaces (id, owner_id, name) values
  ('00000000-0000-4000-8000-0000000c1001', '00000000-0000-4000-8000-0000000c0001', 'P'),
  ('00000000-0000-4000-8000-0000000c1002', '00000000-0000-4000-8000-0000000c0001', 'O');
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  ('00000000-0000-4000-8000-0000000c2001', '00000000-0000-4000-8000-0000000c1001', null, 'p1', 'a0'),
  ('00000000-0000-4000-8000-0000000c2002', '00000000-0000-4000-8000-0000000c1002', null, 'o1', 'a0');

insert into public.grants (user_id, project_id, page_id, level) values
  ('00000000-0000-4000-8000-0000000c0002', '00000000-0000-4000-8000-0000000c1001', null, 'view'),
  ('00000000-0000-4000-8000-0000000c0004', '00000000-0000-4000-8000-0000000c1001', null, 'edit_pages'),
  ('00000000-0000-4000-8000-0000000c0005', '00000000-0000-4000-8000-0000000c1001', null, 'edit'),
  ('00000000-0000-4000-8000-0000000c0006', null, '00000000-0000-4000-8000-0000000c2001', 'view'),
  ('00000000-0000-4000-8000-0000000c0007', '00000000-0000-4000-8000-0000000c1001', null, 'edit_pages');

-- Los archivos de P, uno por estado (los tamaños no se pisan: cada suma dice qué entró):
--   a1  en uso en p1 y además usado en o1 (uso de otro proyecto)          1.000
--   a2  en uso en p1                                                     20.000
--   a3  en la papelera de la app, subido                                300.000
--   a4  en la papelera de la app, pedido a Drive y nunca subido       4.000.000
--   a5  en la papelera de Drive desde hoy                             50.000.000
--   a6  en la papelera de Drive hace 40 días (Google ya lo borró)    600.000.000
--   a7  en la papelera de Drive sin haberse subido nunca           7.000.000.000
--   a8  registrado y todavía sin subir, en uso en p1                         80
--   a9  a la papelera de Drive hace 40 días pero subido hace 10 (el portero lo mandó al terminar la subida) 900
--   a10 en la papelera de la app, subido, vaciado y el portero todavía no lo mandó a Drive                3
--   a11 en la papelera de Drive hace 29 días (todavía cuenta: Google borra a los 30)                  40.000
insert into public.files (id, project_id, name, mime, size, drive_id, uploaded_at, trashed_at, purged_at, drive_trashed_at) values
  ('00000000-0000-4000-8000-0000000c3001', '00000000-0000-4000-8000-0000000c1001', 'a1.jpg', 'image/jpeg', 1000,
   'drive_a1_xxxxxxxx', now() - interval '5 days', null, null, null),
  ('00000000-0000-4000-8000-0000000c3002', '00000000-0000-4000-8000-0000000c1001', 'a2.jpg', 'image/jpeg', 20000,
   'drive_a2_xxxxxxxx', now() - interval '5 days', null, null, null),
  ('00000000-0000-4000-8000-0000000c3003', '00000000-0000-4000-8000-0000000c1001', 'a3.jpg', 'image/jpeg', 300000,
   'drive_a3_xxxxxxxx', now() - interval '5 days', now() - interval '2 days', null, null),
  ('00000000-0000-4000-8000-0000000c3004', '00000000-0000-4000-8000-0000000c1001', 'a4.mov', 'video/quicktime', 4000000,
   null, null, now() - interval '2 days', now() - interval '1 day', null),
  ('00000000-0000-4000-8000-0000000c3005', '00000000-0000-4000-8000-0000000c1001', 'a5.mov', 'video/quicktime', 50000000,
   'drive_a5_xxxxxxxx', now() - interval '50 days', now() - interval '3 days', now() - interval '1 hour', now()),
  ('00000000-0000-4000-8000-0000000c3006', '00000000-0000-4000-8000-0000000c1001', 'a6.mov', 'video/quicktime', 600000000,
   'drive_a6_xxxxxxxx', now() - interval '60 days', now() - interval '45 days', now() - interval '41 days', now() - interval '40 days'),
  ('00000000-0000-4000-8000-0000000c3007', '00000000-0000-4000-8000-0000000c1001', 'a7.mov', 'video/quicktime', 7000000000,
   null, null, now() - interval '3 days', now() - interval '2 days', now() - interval '1 day'),
  ('00000000-0000-4000-8000-0000000c3008', '00000000-0000-4000-8000-0000000c1001', 'a8.jpg', 'image/jpeg', 80,
   null, null, null, null, null),
  ('00000000-0000-4000-8000-0000000c3009', '00000000-0000-4000-8000-0000000c1001', 'a9.jpg', 'image/jpeg', 900,
   'drive_a9_xxxxxxxx', now() - interval '10 days', now() - interval '45 days', now() - interval '44 days', now() - interval '40 days'),
  ('00000000-0000-4000-8000-0000000c3010', '00000000-0000-4000-8000-0000000c1001', 'a10.jpg', 'image/jpeg', 3,
   'drive_a10_xxxxxxx', now() - interval '5 days', now() - interval '2 days', now() - interval '1 hour', null),
  ('00000000-0000-4000-8000-0000000c3011', '00000000-0000-4000-8000-0000000c1001', 'a11.jpg', 'image/jpeg', 40000,
   'drive_a11_xxxxxxx', now() - interval '60 days', now() - interval '31 days', now() - interval '30 days', now() - interval '29 days');
insert into public.page_files (page_id, file_id, is_foreign) values
  ('00000000-0000-4000-8000-0000000c2001', '00000000-0000-4000-8000-0000000c3001', false),
  ('00000000-0000-4000-8000-0000000c2002', '00000000-0000-4000-8000-0000000c3001', true),
  ('00000000-0000-4000-8000-0000000c2001', '00000000-0000-4000-8000-0000000c3002', false),
  ('00000000-0000-4000-8000-0000000c2001', '00000000-0000-4000-8000-0000000c3008', false);

do $$
begin
  assert (select count(*) from public.files where project_id = '00000000-0000-4000-8000-0000000c1001' and trashed_at is null) = 3,
    'preparación: los usos cambiaron el estado de los archivos de P';
end;
$$;

-- Lo que la dueña de la prueba no ve de la base real (todos los proyectos que ya había) queda en su fila sin
-- proyecto antes de sumar Q y R: se guarda para comparar después.
select pg_temp.as_user('00000000-0000-4000-8000-0000000c0001');
do $$
declare
  base record;
begin
  select coalesce(sum(s.drive_bytes), 0) as b, coalesce(sum(s.drive_files), 0) as n,
         coalesce(sum(s.trash_bytes), 0) as tb, coalesce(sum(s.trash_files), 0) as tn
  into base
  from public.project_sizes() s where s.project_id is null;
  perform set_config('peso.base', format('%s/%s %s/%s', base.b, base.n, base.tb, base.tn), true);
end;
$$;
select set_config('role', 'postgres', true);

-- Q (privado de ad2) y R (de ad2, con la dueña solo en la página r1).
insert into public.workspaces (id, owner_id, name) values
  ('00000000-0000-4000-8000-0000000c1003', '00000000-0000-4000-8000-0000000c0003', 'Q'),
  ('00000000-0000-4000-8000-0000000c1004', '00000000-0000-4000-8000-0000000c0003', 'R');
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  ('00000000-0000-4000-8000-0000000c2003', '00000000-0000-4000-8000-0000000c1003', null, 'q1', 'a0'),
  ('00000000-0000-4000-8000-0000000c2004', '00000000-0000-4000-8000-0000000c1004', null, 'r1', 'a0');
insert into public.grants (user_id, project_id, page_id, level) values
  ('00000000-0000-4000-8000-0000000c0001', null, '00000000-0000-4000-8000-0000000c2004', 'edit_pages');
--   q1  en uso en Q, más de lo que entra en un int      5.000.000.000
--   r1  en la papelera de la app en R                              7
insert into public.files (id, project_id, name, mime, size, drive_id, uploaded_at, trashed_at) values
  ('00000000-0000-4000-8000-0000000c3101', '00000000-0000-4000-8000-0000000c1003', 'q1.mov', 'video/quicktime', 5000000000,
   'drive_q1_xxxxxxxx', now() - interval '5 days', null),
  ('00000000-0000-4000-8000-0000000c3102', '00000000-0000-4000-8000-0000000c1004', 'r1.jpg', 'image/jpeg', 7,
   'drive_r1_xxxxxxxx', now() - interval '5 days', now() - interval '1 day');
insert into public.page_files (page_id, file_id) values
  ('00000000-0000-4000-8000-0000000c2003', '00000000-0000-4000-8000-0000000c3101');

select set_config('peso.fingerprint', pg_temp.fingerprint(), true);

-- ---------------------------------------------------------------------------------------------------
-- La dueña: P con cada estado en su lugar, O en cero, y la fila sin proyecto con Q y R
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000c0001');
do $$
declare
  p constant uuid := '00000000-0000-4000-8000-0000000c1001';
  o constant uuid := '00000000-0000-4000-8000-0000000c1002';
  base text[] := regexp_split_to_array(current_setting('peso.base'), '[/ ]');
  got text;
  t  record;
  r  record;
begin
  -- Principal: a1 + a2 (en uso) + a3 + a10 (papelera de la app, subidos); a4 va a la papelera de la app
  -- pero no al principal (nunca llegó a Drive). Papelera de la app: a3 + a4 + a10. Papelera de Drive: a5 + a9
  -- + a11. Sin subir: a8. a6 (Google ya lo borró) y a7 (nunca llegó a Drive) no cuentan. El uso de a1 en O
  -- no suma dos veces.
  got := pg_temp.size_of(p);
  assert got = '321003/4 4300003/3 50040900/3 80/1', format('P para la dueña: %s', got);
  got := pg_temp.size_of(o);
  assert got = '0/0 0/0 0/0 0/0', format('O (sin archivos propios) para la dueña: %s', got);
  assert pg_temp.seen() = array[p, o]::uuid[], format('la dueña ve otros proyectos: %s', pg_temp.seen());

  -- La papelera de la app coincide con la papelera de archivos del proyecto.
  select coalesce(sum(tf.size), 0) as b, count(*) as n into t from public.trashed_files(p) tf;
  select s.trash_bytes, s.trash_files into r from public.project_sizes() s where s.project_id = p;
  assert t.b = r.trash_bytes and t.n = r.trash_files, format('papelera: %s/%s contra %s/%s', t.b, t.n, r.trash_bytes, r.trash_files);

  -- Q (privado de otra) y R (compartido con ella solo por una página) van a la fila sin proyecto, sin nombres.
  assert pg_temp.hidden_rows() = 1, 'la dueña no tiene su fila sin proyecto (o tiene dos)';
  select s.* into r from public.project_sizes() s where s.project_id is null;
  assert r.drive_bytes = base[1]::bigint + 5000000007 and r.drive_files = base[2]::int + 2,
    format('fila sin proyecto: %s/%s (antes %s/%s)', r.drive_bytes, r.drive_files, base[1], base[2]);
  assert r.trash_bytes = base[3]::bigint + 7 and r.trash_files = base[4]::int + 1,
    format('fila sin proyecto, papelera: %s/%s (antes %s/%s)', r.trash_bytes, r.trash_files, base[3], base[4]);
  assert pg_typeof(r.drive_bytes)::text = 'bigint', 'la suma no es bigint';

  -- Sigue viendo y editando todo lo suyo.
  assert private.project_level(p) = 4 and private.page_level('00000000-0000-4000-8000-0000000c2001') = 4,
    'la dueña perdió permisos sobre P';
  update public.pages set title = 'p1 editada' where id = '00000000-0000-4000-8000-0000000c2001';
  assert (select title from public.pages where id = '00000000-0000-4000-8000-0000000c2001') = 'p1 editada',
    'la dueña no edita p1';
  update public.pages set title = 'p1' where id = '00000000-0000-4000-8000-0000000c2001';
  assert (select count(*) from public.files where project_id = p) = 3, 'la dueña no ve los archivos en uso de P';
end;
$$;

-- La dueña con una sesión de contraseña no es miembro de nada: ni proyectos ni fila sin proyecto.
select pg_temp.as_session('00000000-0000-4000-8000-0000000c0001', '[{"method": "password", "timestamp": 1790000000}]');
do $$
begin
  assert (select count(*) from public.project_sizes()) = 0, 'con contraseña, la dueña ve pesos';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Quién ve el peso: quien ve la papelera de archivos del proyecto
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000c0002');
do $$
begin
  assert pg_temp.seen() = array['00000000-0000-4000-8000-0000000c1001']::uuid[], 'la admin con ver no ve solo P';
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000c1001') = '321003/4 4300003/3 50040900/3 80/1',
    'la admin con ver ve otro peso';
  assert pg_temp.hidden_rows() = 0, 'la admin tiene fila sin proyecto';
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-0000000c0003');
do $$
begin
  -- Sin permiso sobre P: no lo ve. Sus proyectos, sí; y no tiene fila sin proyecto.
  assert pg_temp.seen() = array['00000000-0000-4000-8000-0000000c1003', '00000000-0000-4000-8000-0000000c1004']::uuid[],
    format('la admin sin permiso sobre P ve %s', pg_temp.seen());
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000c1003') = '5000000000/1 0/0 0/0 0/0', 'Q para su dueña';
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000c1004') = '7/1 7/1 0/0 0/0', 'R para su dueña';
  assert pg_temp.hidden_rows() = 0, 'la admin sin permiso tiene fila sin proyecto';
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-0000000c0004');
do $$
begin
  assert pg_temp.seen() = array['00000000-0000-4000-8000-0000000c1001']::uuid[], 'editar y crear no ve P';
  assert pg_temp.size_of('00000000-0000-4000-8000-0000000c1001') = '321003/4 4300003/3 50040900/3 80/1',
    'editar y crear ve otro peso';
  assert pg_temp.hidden_rows() = 0, 'editar y crear tiene fila sin proyecto';
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-0000000c0005');
do $$
begin
  assert (select count(*) from public.project_sizes()) = 0, 'editar (sin 4) ve pesos';
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-0000000c0006');
do $$
begin
  assert (select count(*) from public.project_sizes()) = 0, 'la invitada ve pesos';
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-0000000c0007');
do $$
begin
  assert (select count(*) from public.project_sizes()) = 0, 'la sacada ve pesos';
end;
$$;

-- Sin sesión: no se puede llamar.
select set_config('role', 'anon', true);
select set_config('request.jwt.claims', '', true);
do $$
begin
  perform pg_temp.expect_error($q$select * from public.project_sizes()$q$, '42501', 'anon ve los pesos');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Llamarla no cambió nada
-- ---------------------------------------------------------------------------------------------------
select set_config('role', 'postgres', true);
do $$
begin
  assert pg_temp.fingerprint() = current_setting('peso.fingerprint'), 'llamar a project_sizes cambió filas';
  assert (select provolatile from pg_proc where oid = 'public.project_sizes'::regproc) = 's', 'project_sizes no es stable';
  assert (select prosecdef from pg_proc where oid = 'public.project_sizes'::regproc), 'project_sizes no es security definer';
  assert (select schema_version from public.workspace_settings where id) >= 7, 'la versión de la base no es 7';
end;
$$;

rollback;

select 'ok' as result;
