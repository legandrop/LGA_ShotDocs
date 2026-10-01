-- Pruebas de la papelera de archivos (paso 11): cuándo un archivo entra y sale de la papelera (dejar de
-- usarlo en una página, volver a usarlo, mandar la página a la papelera de páginas y restaurarla, moverla),
-- quién ve la papelera y quién manda a la papelera de Drive, el borrado automático apagado y que nada se
-- borra de verdad. Corre dentro de una transacción que se deshace al final: no deja usuarios ni datos. Si
-- todo pasa, devuelve una fila con result = 'ok'.

begin;

-- Las funciones de archivos de abajo van sin versión (las de siempre): con una mínima de 0.090 o más no andan
-- (version_minima_archivos_permisos.sql). La prueba arranca sin mínima; se deshace al final.
update public.workspace_settings set min_app_version = null;

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

-- Personas (todas con correo @test.invalid):
--   ow   dueña del workspace, creó el proyecto P      ad   admin con ver sobre P
--   ad2  admin sin permiso sobre P (P es privado)     ep   miembro con editar y crear páginas sobre P
--   ed   miembro con editar sobre P                   gu   invitada con ver la página c
--   rx   miembro con editar y crear sobre P, sacada
insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('00000000-0000-4000-8000-000000000b01', 'pa-ow@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000b02', 'pa-ad@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000b03', 'pa-ad2@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000b04', 'pa-ep@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000b05', 'pa-ed@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000b06', 'pa-gu@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000b07', 'pa-rx@test.invalid', 'authenticated', 'authenticated', now());

-- Si la base ya tiene dueño, queda fuera de la prueba (se deshace al final): hay un solo dueño activo.
update public.members set removed_at = now() where role = 'owner' and removed_at is null;
update public.workspace_settings set owner_id = '00000000-0000-4000-8000-000000000b01';

insert into public.members (user_id, role, removed_at) values
  ('00000000-0000-4000-8000-000000000b01', 'owner', null),
  ('00000000-0000-4000-8000-000000000b02', 'admin', null),
  ('00000000-0000-4000-8000-000000000b03', 'admin', null),
  ('00000000-0000-4000-8000-000000000b04', 'member', null),
  ('00000000-0000-4000-8000-000000000b05', 'member', null),
  ('00000000-0000-4000-8000-000000000b06', 'guest', null),
  ('00000000-0000-4000-8000-000000000b07', 'member', now());

-- P: r › c, y s. Q (de la admin ad2): q.
insert into public.workspaces (id, owner_id, name) values
  ('00000000-0000-4000-8000-000000000e01', '00000000-0000-4000-8000-000000000b01', 'P'),
  ('00000000-0000-4000-8000-000000000e02', '00000000-0000-4000-8000-000000000b03', 'Q');
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  ('00000000-0000-4000-8000-000000000d01', '00000000-0000-4000-8000-000000000e01', null, 'r', 'a0'),
  ('00000000-0000-4000-8000-000000000d03', '00000000-0000-4000-8000-000000000e01', null, 's', 'a1'),
  ('00000000-0000-4000-8000-000000000d09', '00000000-0000-4000-8000-000000000e02', null, 'q', 'a0');
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  ('00000000-0000-4000-8000-000000000d02', '00000000-0000-4000-8000-000000000e01',
   '00000000-0000-4000-8000-000000000d01', 'c', 'a0');

insert into public.grants (user_id, project_id, page_id, level) values
  ('00000000-0000-4000-8000-000000000b02', '00000000-0000-4000-8000-000000000e01', null, 'view'),
  ('00000000-0000-4000-8000-000000000b04', '00000000-0000-4000-8000-000000000e01', null, 'edit_pages'),
  ('00000000-0000-4000-8000-000000000b05', '00000000-0000-4000-8000-000000000e01', null, 'edit'),
  ('00000000-0000-4000-8000-000000000b06', null, '00000000-0000-4000-8000-000000000d02', 'view'),
  ('00000000-0000-4000-8000-000000000b07', '00000000-0000-4000-8000-000000000e01', null, 'edit_pages');

-- Ids fijos para leer mejor: f1 en c, f2 en s, f3 en c y en s; fq en q.
create function pg_temp.t(f text) returns timestamptz language sql as $$
  select trashed_at from public.files where id = ('00000000-0000-4000-8000-0000000000' || f)::uuid;
$$;

-- Lo que hay que no se puede perder: cuántas filas de archivos y de usos, siempre.
create function pg_temp.check_nothing_deleted(files_n int, uses_n int, what text) returns void language plpgsql as $$
begin
  if (select count(*) from public.files) <> files_n or (select count(*) from public.page_files) <> uses_n then
    raise exception 'FALLA: se borró algo (%): % archivos, % usos', what,
      (select count(*) from public.files), (select count(*) from public.page_files);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Entrar y salir de la papelera: dejar de usarlo y volver a usarlo (ed, que edita P)
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-000000000b05');
do $$
declare
  c  constant uuid := '00000000-0000-4000-8000-000000000d02';
  s  constant uuid := '00000000-0000-4000-8000-000000000d03';
  q  constant uuid := '00000000-0000-4000-8000-000000000d09';
  f1 constant uuid := '00000000-0000-4000-8000-0000000000f1';
  f2 constant uuid := '00000000-0000-4000-8000-0000000000f2';
  f3 constant uuid := '00000000-0000-4000-8000-0000000000f3';
  t0 timestamptz;
  seq bigint;
begin
  perform public.register_file(f1, c, 'IMG_0001.HEIC', 'image/heic', 3000000, 4032, 3024, null);
  perform public.register_file(f2, s, 'IMG_0002.MOV', 'video/quicktime', 62000000, 3840, 2160, 21);
  perform public.register_file(f3, c, 'IMG_0003.JPG', 'image/jpeg', 2000000, null, null, null);
  perform public.link_page_file(s, f3);
  assert pg_temp.t('f1') is null and pg_temp.t('f2') is null and pg_temp.t('f3') is null,
    'un archivo en uso arranca en la papelera';
  assert (select count(*) from public.page_files where removed_at is not null) = 0, 'un uso nuevo arranca marcado';

  -- f1 deja de usarse en c: entra a la papelera y el uso queda marcado, sin borrarse.
  perform public.unlink_page_file(c, f1);
  assert pg_temp.t('f1') is not null, 'f1 no entra a la papelera al dejar de usarse';
  assert (select removed_at is not null from public.page_files where page_id = c and file_id = f1),
    'el uso no queda marcado con removed_at';
  -- Reintentar no cambia la fecha del uso ni la de la papelera; un uso que no existe, nada.
  t0 := pg_temp.t('f1');
  perform public.unlink_page_file(c, f1);
  perform public.unlink_page_file(c, f2);
  assert pg_temp.t('f1') = t0, 'reintentar unlink cambió la fecha de la papelera';
  assert pg_temp.t('f2') is null, 'unlink de un uso que no existe mandó el archivo a la papelera';
  perform pg_temp.check_nothing_deleted(3, 4, 'unlink');

  -- f3 sigue en s: no entra.
  perform public.unlink_page_file(c, f3);
  assert pg_temp.t('f3') is null, 'f3 entra a la papelera aunque s lo usa';

  -- Volver a usarlo lo saca (link_page_file y register_file reactivan el uso).
  perform public.link_page_file(c, f1);
  assert pg_temp.t('f1') is null, 'f1 no sale de la papelera al volver a usarse';
  assert (select removed_at is null from public.page_files where page_id = c and file_id = f1),
    'link_page_file no reactiva el uso';
  perform public.unlink_page_file(c, f1);
  assert pg_temp.t('f1') is not null, 'f1 no vuelve a entrar';
  perform public.register_file(f1, c, 'IMG_0001.HEIC', 'image/heic', 3000000, 4032, 3024, null);
  assert pg_temp.t('f1') is null, 'register_file no reactiva el uso';
  perform public.link_page_file(c, f3);
  perform pg_temp.check_nothing_deleted(3, 4, 'volver a usar');

  -- Un "dejó de usarse" viejo (visto con un contenido anterior al del servidor) no gana: otro dispositivo
  -- pudo volver a poner el bloque. La base no marca nada y devuelve false; con el seq al día, sí.
  perform public.push_page_update(c, gen_random_uuid(), 'AQAAAA==', '9.999');
  seq := (select update_seq from public.pages where id = c);
  assert seq >= 1, 'push_page_update no subió update_seq';
  assert public.unlink_page_file(c, f1, seq - 1) = false, 'un unlink viejo no devuelve false';
  assert pg_temp.t('f1') is null and (select removed_at is null from public.page_files where page_id = c and file_id = f1),
    'un unlink viejo marcó el uso';
  assert public.unlink_page_file(c, f1, seq) = true, 'un unlink al día no devuelve true';
  assert pg_temp.t('f1') is not null, 'un unlink al día no manda f1 a la papelera';
  assert public.unlink_page_file(c, f1, seq) = true, 'repetir un unlink al día no devuelve true';
  assert public.unlink_page_file(c, f1) = true, 'sin seq no devuelve true';
  assert public.unlink_page_file(c, f1, seq + 5) = true, 'un seq más nuevo que el servidor no vale';
  perform public.link_page_file(c, f1);
  assert pg_temp.t('f1') is null, 'f1 no sale después del unlink con seq';
  perform pg_temp.check_nothing_deleted(3, 4, 'unlink con seq');

  -- Permisos de unlink: pide editar la página.
  perform pg_temp.expect_error(format('select public.unlink_page_file(%L, %L)', q, f1),
    'page_not_found', 'unlink en una página que no ve');
  perform pg_temp.expect_error(format('select public.unlink_page_file(%L, %L)', gen_random_uuid(), f1),
    'page_not_found', 'unlink en una página que no existe');

  -- Nadie escribe las columnas nuevas desde la API.
  perform pg_temp.expect_error($q$update public.files set trashed_at = null, purged_at = null, drive_trashed_at = null$q$,
    '42501', 'cambiar el estado de la papelera directo');
  perform pg_temp.expect_error($q$update public.page_files set removed_at = now()$q$,
    '42501', 'marcar un uso directo');
  perform pg_temp.expect_error($q$delete from public.files$q$, '42501', 'borrar archivos');
  perform pg_temp.expect_error($q$delete from public.page_files$q$, '42501', 'borrar usos');
  -- Las funciones de estado no se llaman desde la API.
  perform pg_temp.expect_error(format('select private.refresh_file_trash(%L)', f1), '42501', 'llamar a refresh_file_trash');
  perform pg_temp.expect_error(format('select private.page_alive(%L)', c), '42501', 'llamar a page_alive');
end;
$$;

-- Un uso de ed que la invitada ve (ver c) no le deja marcar nada.
select pg_temp.as_user('00000000-0000-4000-8000-000000000b06');
do $$
begin
  perform pg_temp.expect_error(
    format('select public.unlink_page_file(%L, %L)', '00000000-0000-4000-8000-000000000d02', '00000000-0000-4000-8000-0000000000f1'),
    'page_not_found', 'la invitada (ver) marca un uso');
  assert pg_temp.t('f1') is null, 'la invitada mandó f1 a la papelera';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Papelera de páginas: una página en la papelera (o adentro de una) no cuenta (ep, que tiene 4)
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-000000000b04');
do $$
declare
  r  constant uuid := '00000000-0000-4000-8000-000000000d01';
  c  constant uuid := '00000000-0000-4000-8000-000000000d02';
  s  constant uuid := '00000000-0000-4000-8000-000000000d03';
  t1 timestamptz;
  x  record;
begin
  -- r a la papelera se lleva a c: f1 (solo en c) entra; f3 (también en s) no.
  update public.pages set deleted_at = now() where id = r;
  assert pg_temp.t('f1') is not null, 'f1 no entra al mandar a la papelera la página de arriba';
  -- La papelera dice que lo usa una página en la papelera de páginas (c, adentro de r), con su título.
  select * into strict x from public.trashed_files('00000000-0000-4000-8000-000000000e01');
  assert x.id = '00000000-0000-4000-8000-0000000000f1' and x.in_trashed_page and x.trashed_page_title = 'c',
    format('trashed_files no dice que lo usa una página en la papelera: %s', x);
  assert pg_temp.t('f3') is null, 'f3 entra aunque s lo usa';
  assert pg_temp.t('f2') is null, 'f2 entra sin motivo';

  -- s también: ahora f2 y f3 entran.
  update public.pages set deleted_at = now() where id = s;
  assert pg_temp.t('f2') is not null and pg_temp.t('f3') is not null, 'f2 y f3 no entran con s en la papelera';

  -- Restaurar s: f2 y f3 salen; f1 sigue (c está adentro de r, todavía en la papelera).
  update public.pages set deleted_at = null where id = s;
  assert pg_temp.t('f2') is null and pg_temp.t('f3') is null, 'restaurar s no saca f2 y f3';
  assert pg_temp.t('f1') is not null, 'f1 sale aunque r sigue en la papelera';

  -- Mover c afuera de r (a la raíz): vuelve a estar viva y f1 sale.
  update public.pages set parent_id = null, sort_key = 'a2' where id = c;
  assert pg_temp.t('f1') is null, 'mover c afuera de la papelera no saca f1';
  -- Y de nuevo adentro de r (que sigue en la papelera): entra.
  update public.pages set parent_id = r, sort_key = 'a0' where id = c;
  assert pg_temp.t('f1') is not null, 'mover c adentro de una página en la papelera no manda f1';

  -- Restaurar r: f1 sale.
  update public.pages set deleted_at = null where id = r;
  assert pg_temp.t('f1') is null, 'restaurar r no saca f1';

  -- Un uso marcado en una página viva no cuenta aunque la página se restaure.
  perform public.unlink_page_file(c, '00000000-0000-4000-8000-0000000000f1');
  t1 := pg_temp.t('f1');
  update public.pages set deleted_at = now() where id = r;
  update public.pages set deleted_at = null where id = r;
  assert pg_temp.t('f1') = t1, 'mandar y restaurar la página cambió la fecha de entrada (o sacó f1)';
  -- Un uso marcado en una página en la papelera no cuenta como "en una página en la papelera".
  update public.pages set deleted_at = now() where id = r;
  select * into strict x from public.trashed_files('00000000-0000-4000-8000-000000000e01');
  assert not x.in_trashed_page and x.trashed_page_title is null, format('un uso marcado cuenta como página en la papelera: %s', x);
  update public.pages set deleted_at = null where id = r;
  perform pg_temp.check_nothing_deleted(3, 4, 'papelera de páginas');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Quién ve la papelera (f1 está adentro, desde hace 2 días)
-- ---------------------------------------------------------------------------------------------------
select set_config('role', 'postgres', true);
update public.files set trashed_at = now() - interval '2 days' where id = '00000000-0000-4000-8000-0000000000f1';

create function pg_temp.sees_trash(who text) returns void language plpgsql as $$
declare
  r record;
begin
  select * into strict r from public.trashed_files('00000000-0000-4000-8000-000000000e01');
  if r.id <> '00000000-0000-4000-8000-0000000000f1' or r.name <> 'IMG_0001.HEIC' or r.mime <> 'image/heic'
     or r.size <> 3000000 or r.thumb_at is not null or r.days_left <> 28 or r.purged_at is not null
     or r.in_trashed_page or r.trashed_page_title is not null
     or r.trashed_at > now() - interval '47 hours' then
    raise exception 'FALLA: % no ve bien la papelera: %', who, r;
  end if;
end;
$$;

create function pg_temp.no_trash(who text) returns void language plpgsql as $$
begin
  perform pg_temp.expect_error($q$select * from public.trashed_files('00000000-0000-4000-8000-000000000e01')$q$,
    'not_allowed', who || ' ve la papelera');
  perform pg_temp.expect_error($q$select * from public.files_due_for_purge('00000000-0000-4000-8000-000000000e01')$q$,
    'not_allowed', who || ' ve los vencidos');
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-000000000b01');
select pg_temp.sees_trash('la dueña');
select pg_temp.as_user('00000000-0000-4000-8000-000000000b02');
select pg_temp.sees_trash('la admin con ver');
select pg_temp.as_user('00000000-0000-4000-8000-000000000b04');
select pg_temp.sees_trash('el miembro con editar y crear');
-- ep ve la papelera pero no los vencidos (son para quien puede mandar a Drive).
do $$
begin
  perform pg_temp.expect_error($q$select * from public.files_due_for_purge('00000000-0000-4000-8000-000000000e01')$q$,
    'not_allowed', 'el miembro con editar y crear ve los vencidos');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-000000000b05');
select pg_temp.no_trash('el miembro con editar (sin 4)');
select pg_temp.as_user('00000000-0000-4000-8000-000000000b06');
select pg_temp.no_trash('la invitada');
select pg_temp.as_user('00000000-0000-4000-8000-000000000b03');
select pg_temp.no_trash('la admin sin permiso sobre el proyecto');
select pg_temp.as_user('00000000-0000-4000-8000-000000000b07');
select pg_temp.no_trash('la sacada');
do $$
begin
  perform pg_temp.expect_error($q$select * from public.trashed_files(null)$q$, 'not_allowed', 'la papelera de null');
end;
$$;

-- La admin ad2 ve la papelera de su proyecto Q (vacía) y no la de P.
select pg_temp.as_user('00000000-0000-4000-8000-000000000b03');
do $$
begin
  assert (select count(*) from public.trashed_files('00000000-0000-4000-8000-000000000e02')) = 0,
    'la papelera de Q no está vacía';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Borrado automático: apagado, no devuelve nada aunque haya vencidos
-- ---------------------------------------------------------------------------------------------------
select set_config('role', 'postgres', true);
update public.files set trashed_at = now() - interval '40 days' where id = '00000000-0000-4000-8000-0000000000f1';
do $$
begin
  assert (select auto_purge_files = false from public.workspace_settings), 'el borrado automático no arranca apagado';
  assert (select is_nullable = 'NO' and column_default = 'false'
          from information_schema.columns
          where table_schema = 'public' and table_name = 'workspace_settings' and column_name = 'auto_purge_files'),
    'auto_purge_files no es not null default false';
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-000000000b01');
do $$
declare
  r record;
begin
  assert (select count(*) from public.files_due_for_purge('00000000-0000-4000-8000-000000000e01')) = 0,
    'files_due_for_purge devuelve algo con el borrado automático apagado';
  select * into strict r from public.trashed_files('00000000-0000-4000-8000-000000000e01');
  assert r.days_left = 0, 'un archivo con 40 días no tiene 0 días';
  -- La app no puede prenderlo.
  perform pg_temp.expect_error($q$update public.workspace_settings set auto_purge_files = true$q$,
    '42501', 'la dueña prende el borrado automático desde la API');
end;
$$;

-- Prendido (solo dentro de esta prueba): devuelve los vencidos, no los recientes.
select set_config('role', 'postgres', true);
update public.workspace_settings set auto_purge_files = true;
select pg_temp.as_user('00000000-0000-4000-8000-000000000b02');
do $$
begin
  assert (select array_agg(id) from public.files_due_for_purge('00000000-0000-4000-8000-000000000e01'))
         = array['00000000-0000-4000-8000-0000000000f1'::uuid], 'files_due_for_purge no da el vencido';
  -- Con ver no marca usos.
  perform pg_temp.expect_error(
    format('select public.unlink_page_file(%L, %L)', '00000000-0000-4000-8000-000000000d03', '00000000-0000-4000-8000-0000000000f2'),
    'page_not_found', 'la admin con ver marca un uso');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-000000000b04');
do $$
begin
  -- ep (editar y crear sobre P) deja de usar f2 en s: f2 entra hoy, así que no está vencido.
  perform public.unlink_page_file('00000000-0000-4000-8000-000000000d03', '00000000-0000-4000-8000-0000000000f2');
  assert pg_temp.t('f2') is not null, 'f2 no entra a la papelera';
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-000000000b02');
do $$
begin
  assert (select count(*) from public.files_due_for_purge('00000000-0000-4000-8000-000000000e01')) = 1,
    'files_due_for_purge da uno que entró hoy';
end;
$$;
-- Un vencido que usa una página en la papelera de páginas no se devuelve (restaurarla lo tiene que
-- encontrar): f3 vive en c y en s; se marca su uso en s, se manda r (con c) a la papelera y se lo hace viejo.
select pg_temp.as_user('00000000-0000-4000-8000-000000000b04');
do $$
begin
  perform public.unlink_page_file('00000000-0000-4000-8000-000000000d03', '00000000-0000-4000-8000-0000000000f3');
  update public.pages set deleted_at = now() where id = '00000000-0000-4000-8000-000000000d01';
  assert pg_temp.t('f3') is not null, 'f3 no entra con c en la papelera de páginas';
end;
$$;
select set_config('role', 'postgres', true);
update public.files set trashed_at = now() - interval '40 days' where id = '00000000-0000-4000-8000-0000000000f3';
select pg_temp.as_user('00000000-0000-4000-8000-000000000b01');
do $$
begin
  assert (select bool_or(id = '00000000-0000-4000-8000-0000000000f3' and in_trashed_page)
          from public.trashed_files('00000000-0000-4000-8000-000000000e01')), 'la papelera no dice que f3 está en una página en la papelera';
  assert (select array_agg(id) from public.files_due_for_purge('00000000-0000-4000-8000-000000000e01'))
         = array['00000000-0000-4000-8000-0000000000f1'::uuid],
    'files_due_for_purge devuelve un vencido que usa una página en la papelera de páginas';
end;
$$;
-- Restaurar r lo saca de la papelera; y el uso en s vuelve, como estaba.
select pg_temp.as_user('00000000-0000-4000-8000-000000000b04');
do $$
begin
  update public.pages set deleted_at = null where id = '00000000-0000-4000-8000-000000000d01';
  assert pg_temp.t('f3') is null, 'restaurar r no saca f3';
  perform public.link_page_file('00000000-0000-4000-8000-000000000d03', '00000000-0000-4000-8000-0000000000f3');
end;
$$;

select set_config('role', 'postgres', true);
update public.workspace_settings set auto_purge_files = false;

-- ---------------------------------------------------------------------------------------------------
-- Mandar a la papelera de Drive: solo dueño y admins, solo lo que está en la papelera; nada se borra
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-000000000b04');
do $$
begin
  perform pg_temp.expect_error($q$select public.purge_file('00000000-0000-4000-8000-0000000000f1')$q$,
    'not_allowed', 'el miembro con editar y crear manda a Drive');
  -- Confirmar lo puede quien edita (termina una subida), pero solo lo que un dueño o admin pidió.
  perform pg_temp.expect_error($q$select public.media_purged('00000000-0000-4000-8000-0000000000f1')$q$,
    'file_not_purged', 'el miembro con editar y crear confirma algo que no se pidió');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-000000000b05');
do $$
begin
  perform pg_temp.expect_error($q$select public.purge_file('00000000-0000-4000-8000-0000000000f1')$q$,
    'not_allowed', 'el miembro con editar manda a Drive');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-000000000b06');
do $$
begin
  perform pg_temp.expect_error($q$select public.purge_file('00000000-0000-4000-8000-0000000000f1')$q$,
    'not_allowed', 'la invitada manda a Drive');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-000000000b03');
do $$
begin
  perform pg_temp.expect_error($q$select public.purge_file('00000000-0000-4000-8000-0000000000f1')$q$,
    'file_not_found', 'la admin sin permiso sobre P manda a Drive');
  perform pg_temp.expect_error($q$select public.media_purged('00000000-0000-4000-8000-0000000000f1')$q$,
    'file_not_found', 'la admin sin permiso sobre P confirma');
  assert public.media_file('00000000-0000-4000-8000-0000000000f1') is null, 'la admin sin permiso ve el archivo';
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-000000000b07');
do $$
begin
  perform pg_temp.expect_error($q$select public.purge_file('00000000-0000-4000-8000-0000000000f1')$q$,
    'file_not_found', 'la sacada manda a Drive');
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-000000000b01');
do $$
declare
  f1 constant uuid := '00000000-0000-4000-8000-0000000000f1';
  f3 constant uuid := '00000000-0000-4000-8000-0000000000f3';
  c  constant uuid := '00000000-0000-4000-8000-000000000d02';
  j  jsonb;
  p0 timestamptz;
begin
  -- Lo que está en uso no se manda.
  perform pg_temp.expect_error(format('select public.purge_file(%L)', f3), 'file_not_trashed', 'mandar a Drive algo en uso');
  perform pg_temp.expect_error(format('select public.media_purged(%L)', f3), 'file_not_purged', 'confirmar algo que no se pidió');
  perform pg_temp.expect_error(format('select public.purge_file(%L)', gen_random_uuid()), 'file_not_found', 'mandar algo que no existe');
  assert (select purged_at is null from public.files where id = f3), 'un intento fallido marcó f3';

  -- media_file: los 9 campos de siempre, más el estado de la papelera y, desde las carpetas (P.9), quién agregó el
  -- archivo (`created_by`).
  j := public.media_file(f1)::jsonb;
  assert j ?& array['id', 'project_id', 'project_name', 'name', 'mime', 'size', 'drive_id', 'created_at', 'level'],
    format('media_file perdió campos: %s', j);
  assert (select count(*) from jsonb_object_keys(j)) = 13 and j ? 'created_by', format('media_file no trae 13 campos: %s', j);
  assert j ->> 'trashed_at' is not null and j -> 'purged_at' = 'null'::jsonb and j -> 'drive_trashed_at' = 'null'::jsonb,
    format('media_file no dice bien el estado de la papelera: %s', j);

  -- La dueña lo pide: queda marcado, la fila sigue. Pedirlo de nuevo no cambia nada.
  perform public.purge_file(f1);
  select purged_at into p0 from public.files where id = f1;
  assert p0 is not null and (select purged_by from public.files where id = f1) = auth.uid(), 'purge_file no marca quién y cuándo';
  perform public.purge_file(f1);
  assert (select purged_at from public.files where id = f1) = p0, 'repetir purge_file cambió la fecha';
  j := public.media_file(f1)::jsonb;
  assert j ->> 'purged_at' is not null and j -> 'drive_trashed_at' = 'null'::jsonb, 'media_file no dice que se pidió';
  assert (select purged_at from public.trashed_files('00000000-0000-4000-8000-000000000e01') where id = f1) = p0,
    'la papelera no muestra que ya se pidió';

  -- Pedirlo es definitivo: volver a usarlo no lo saca de la papelera (el portero no lo manda en uso).
  perform public.link_page_file(c, f1);
  assert pg_temp.t('f1') is not null and (select purged_at from public.files where id = f1) = p0,
    'volver a usar un archivo ya pedido lo sacó de la papelera';
  perform public.unlink_page_file(c, f1);

  -- Quien solo ve no confirma; quien edita sí (el portero, al terminar una subida de un archivo ya pedido).
  perform pg_temp.as_user('00000000-0000-4000-8000-000000000b06');
  perform pg_temp.expect_error(format('select public.media_purged(%L)', f1), 'not_allowed', 'la invitada (ver) confirma');
  perform pg_temp.as_user('00000000-0000-4000-8000-000000000b05');
  perform public.media_purged(f1);
  perform pg_temp.as_user('00000000-0000-4000-8000-000000000b01');

  -- El portero confirma: sale de la lista de la papelera; la fila sigue. Repetir no cambia nada.
  perform public.media_purged(f1);
  assert (select drive_trashed_at is not null from public.files where id = f1), 'media_purged no confirma';
  perform public.media_purged(f1);
  perform public.purge_file(f1);
  assert (select count(*) from public.trashed_files('00000000-0000-4000-8000-000000000e01') where id = f1) = 0,
    'lo que ya está en la papelera de Drive sigue en la lista';
  assert (select count(*) from public.files where id = f1) = 1, 'la fila de f1 se borró';
  perform pg_temp.check_nothing_deleted(3, 4, 'mandar a Drive');
end;
$$;

-- La admin con ver sobre P también manda y confirma (f2).
select pg_temp.as_user('00000000-0000-4000-8000-000000000b02');
do $$
begin
  perform public.purge_file('00000000-0000-4000-8000-0000000000f2');
  perform public.media_purged('00000000-0000-4000-8000-0000000000f2');
  assert (select purged_by = auth.uid() and drive_trashed_at is not null from public.files
          where id = '00000000-0000-4000-8000-0000000000f2'), 'la admin no manda f2';
  assert (select count(*) from public.trashed_files('00000000-0000-4000-8000-000000000e01')) = 0,
    'la papelera no quedó vacía';
  perform pg_temp.check_nothing_deleted(3, 4, 'la admin manda a Drive');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- La base
-- ---------------------------------------------------------------------------------------------------
select set_config('role', 'postgres', true);
do $$
begin
  assert (select schema_version from public.workspace_settings) >= 6, 'schema_version no subió a 6';
  -- La dueña ve y edita sus páginas igual que antes.
  perform pg_temp.as_user('00000000-0000-4000-8000-000000000b01');
  assert (select count(*) from public.pages where workspace_id = '00000000-0000-4000-8000-000000000e01') = 3,
    'la dueña no ve sus páginas';
  assert (select bool_and(private.page_level(id) = 4) from public.pages
          where workspace_id = '00000000-0000-4000-8000-000000000e01'), 'la dueña no edita sus páginas';
  assert (select count(*) from public.files) = 3, 'la dueña no ve los archivos de su proyecto (también los mandados)';
  perform set_config('role', 'postgres', true);
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Un archivo cortado de un proyecto y pegado en otro: el uso de afuera cuenta para la papelera y no da
-- permisos. R es otro proyecto de la dueña con la página rb; vb edita R y no ve P; la admin ad ve P y no R.
-- ---------------------------------------------------------------------------------------------------
select set_config('role', 'postgres', true);
insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('00000000-0000-4000-8000-000000000b08', 'pa-vb@test.invalid', 'authenticated', 'authenticated', now());
insert into public.members (user_id, role) values ('00000000-0000-4000-8000-000000000b08', 'member');
insert into public.workspaces (id, owner_id, name) values
  ('00000000-0000-4000-8000-000000000e03', '00000000-0000-4000-8000-000000000b01', 'R');
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  ('00000000-0000-4000-8000-000000000d10', '00000000-0000-4000-8000-000000000e03', null, 'rb', 'a0');
insert into public.grants (user_id, project_id, level) values
  ('00000000-0000-4000-8000-000000000b08', '00000000-0000-4000-8000-000000000e03', 'edit');

select pg_temp.as_user('00000000-0000-4000-8000-000000000b01');
do $$
declare
  c  constant uuid := '00000000-0000-4000-8000-000000000d02';
  rb constant uuid := '00000000-0000-4000-8000-000000000d10';
  f4 constant uuid := '00000000-0000-4000-8000-0000000000f4';
begin
  perform public.register_file(f4, c, 'IMG_0004.JPG', 'image/jpeg', 100, null, null, null);
  -- Se corta de c y se pega en rb: el uso queda marcado de afuera, la función lo dice (sin error) y el
  -- archivo sigue siendo de P. Repetirlo no cambia nada.
  assert public.link_page_file(rb, f4) = 'file_other_project', 'link_page_file entre proyectos no lo dice';
  assert public.link_page_file(rb, f4) = 'file_other_project', 'repetir link_page_file entre proyectos';
  assert (select is_foreign from public.page_files where page_id = rb and file_id = f4), 'el uso de afuera no queda marcado';
  assert (select count(*) from public.page_files where file_id = f4) = 2, 'el uso de afuera se duplicó';
  assert (select project_id from public.files where id = f4) = '00000000-0000-4000-8000-000000000e01', 'el archivo cambió de proyecto';
  assert public.link_page_file(c, f4) = 'ok', 'link_page_file en su proyecto no devuelve ok';

  -- Otro dispositivo sincroniza P y lo saca de c: no entra, porque rb (viva, de otro proyecto) lo usa.
  perform public.unlink_page_file(c, f4);
  assert pg_temp.t('f4') is null, 'f4 entra a la papelera aunque una página de otro proyecto lo usa';
  perform pg_temp.expect_error(format('select public.purge_file(%L)', f4), 'file_not_trashed', 'la dueña manda a Drive algo en uso afuera');
end;
$$;

-- La admin que ve P y no R: no lo ve en la papelera ni lo puede mandar.
select pg_temp.as_user('00000000-0000-4000-8000-000000000b02');
do $$
begin
  assert (select count(*) from public.trashed_files('00000000-0000-4000-8000-000000000e01')
          where id = '00000000-0000-4000-8000-0000000000f4') = 0, 'la admin ve en la papelera algo en uso afuera';
  perform pg_temp.expect_error($q$select public.purge_file('00000000-0000-4000-8000-0000000000f4')$q$,
    'file_not_trashed', 'la admin sin acceso a R manda a Drive algo que usa R');
  -- Ve el archivo por P, pero no la fila de afuera (no ve rb) ni el proyecto R.
  assert (select count(*) from public.page_files where file_id = '00000000-0000-4000-8000-0000000000f4') = 1,
    'la admin ve el uso en una página que no ve';
end;
$$;

-- vb edita rb pero no ve P: la fila de afuera no le da nada, ni siquiera saber que existe.
select pg_temp.as_user('00000000-0000-4000-8000-000000000b08');
do $$
declare
  rb constant uuid := '00000000-0000-4000-8000-000000000d10';
  f4 constant uuid := '00000000-0000-4000-8000-0000000000f4';
begin
  assert private.file_level(f4) = 0, 'el uso de afuera da permiso sobre el archivo';
  assert not private.can_view_file(f4, null), 'el uso de afuera deja ver el archivo';
  assert public.media_file(f4) is null, 'media_file le da el archivo a quien solo ve la página de afuera';
  assert (select count(*) from public.files where id = f4) = 0, 'quien solo ve la página de afuera ve el archivo';
  assert (select count(*) from public.page_files where file_id = f4) = 0, 'quien solo ve la página de afuera ve la fila';
  assert (select count(*) from public.page_files where page_id = rb) = 0, 'la fila de afuera se ve desde su página';
  perform pg_temp.expect_error(format('select public.link_page_file(%L, %L)', rb, f4), 'file_not_found', 'vb linkea un archivo que no ve');
  perform pg_temp.expect_error(format('select public.register_file(%L, %L, %L, %L, 1, null, null, null)', f4, rb, 'x.jpg', 'image/jpeg'),
    'file_other_project', 'vb registra un archivo de otro proyecto que no ve');
  perform pg_temp.expect_error(format('select public.set_file_thumb(%L)', f4), 'file_not_found', 'vb marca la miniatura');
  perform pg_temp.expect_error(format('select public.purge_file(%L)', f4), 'file_not_found', 'vb manda a Drive');
  perform pg_temp.expect_error(
    $q$insert into storage.objects (bucket_id, name) values ('thumbs', '00000000-0000-4000-8000-0000000000f4.jpg')$q$,
    '42501', 'vb sube la miniatura');
  assert (select count(*) from storage.objects where bucket_id = 'thumbs' and name like '00000000-0000-4000-8000-0000000000f4%') = 0,
    'vb ve la miniatura';
end;
$$;

-- rb a la papelera de páginas: ahora sí entra, y la papelera de P dice que lo usa una página en la papelera
-- (con el título para quien la ve; sin título para la admin, que no ve R).
select pg_temp.as_user('00000000-0000-4000-8000-000000000b01');
do $$
declare
  x record;
begin
  update public.pages set deleted_at = now() where id = '00000000-0000-4000-8000-000000000d10';
  assert pg_temp.t('f4') is not null, 'f4 no entra con rb en la papelera de páginas';
  select * into strict x from public.trashed_files('00000000-0000-4000-8000-000000000e01') where id = '00000000-0000-4000-8000-0000000000f4';
  assert x.in_trashed_page and x.trashed_page_title = 'rb', format('la dueña no ve que lo usa rb: %s', x);
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-000000000b02');
do $$
declare
  x record;
begin
  select * into strict x from public.trashed_files('00000000-0000-4000-8000-000000000e01') where id = '00000000-0000-4000-8000-0000000000f4';
  assert x.in_trashed_page and x.trashed_page_title is null, format('a la admin se le filtra el título de rb: %s', x);
end;
$$;
-- Vencido y con el borrado automático prendido: no se devuelve (lo usa una página en la papelera).
select set_config('role', 'postgres', true);
update public.files set trashed_at = now() - interval '40 days' where id = '00000000-0000-4000-8000-0000000000f4';
update public.workspace_settings set auto_purge_files = true;
select pg_temp.as_user('00000000-0000-4000-8000-000000000b01');
do $$
begin
  assert (select count(*) from public.files_due_for_purge('00000000-0000-4000-8000-000000000e01')
          where id = '00000000-0000-4000-8000-0000000000f4') = 0, 'files_due_for_purge da uno que usa una página de afuera en la papelera';
end;
$$;
select set_config('role', 'postgres', true);
update public.workspace_settings set auto_purge_files = false;

-- Restaurar rb lo saca; dejar de usarlo en rb (unlink marca también la fila de afuera) lo manda; volver a
-- pegarlo (link_page_file o register_file) lo saca.
select pg_temp.as_user('00000000-0000-4000-8000-000000000b01');
do $$
declare
  rb constant uuid := '00000000-0000-4000-8000-000000000d10';
  f4 constant uuid := '00000000-0000-4000-8000-0000000000f4';
begin
  update public.pages set deleted_at = null where id = rb;
  assert pg_temp.t('f4') is null, 'restaurar rb no saca f4';
  assert public.unlink_page_file(rb, f4) = true, 'unlink en la página de afuera';
  assert (select removed_at is not null and is_foreign from public.page_files where page_id = rb and file_id = f4),
    'unlink no marca la fila de afuera';
  assert pg_temp.t('f4') is not null, 'f4 no entra al dejar de usarse afuera';
  assert public.link_page_file(rb, f4) = 'file_other_project', 'volver a pegarlo afuera';
  assert pg_temp.t('f4') is null, 'volver a pegarlo afuera no lo saca';
  perform public.unlink_page_file(rb, f4);
  assert public.register_file(f4, rb, 'IMG_0004.JPG', 'image/jpeg', 100, null, null, null) = 'file_other_project',
    'register_file afuera no lo dice';
  assert pg_temp.t('f4') is null, 'register_file afuera no lo saca';
  assert (select count(*) from public.page_files where file_id = f4) = 2 and (select count(*) from public.files where id = f4) = 1,
    'se duplicó o se borró algo';
end;
$$;

-- Sin sesión: nada.
select set_config('role', 'anon', true);
do $$
begin
  perform pg_temp.expect_error($q$select public.unlink_page_file('00000000-0000-4000-8000-000000000d02', '00000000-0000-4000-8000-0000000000f3')$q$,
    '42501', 'anon llama a unlink_page_file');
  perform pg_temp.expect_error($q$select public.unlink_page_file('00000000-0000-4000-8000-000000000d02', '00000000-0000-4000-8000-0000000000f3', 1)$q$,
    '42501', 'anon llama a unlink_page_file con seq');
  perform pg_temp.expect_error($q$select * from public.trashed_files('00000000-0000-4000-8000-000000000e01')$q$,
    '42501', 'anon ve la papelera');
  perform pg_temp.expect_error($q$select * from public.files_due_for_purge('00000000-0000-4000-8000-000000000e01')$q$,
    '42501', 'anon ve los vencidos');
  perform pg_temp.expect_error($q$select public.purge_file('00000000-0000-4000-8000-0000000000f3')$q$,
    '42501', 'anon manda a Drive');
  perform pg_temp.expect_error($q$select public.media_purged('00000000-0000-4000-8000-0000000000f3')$q$,
    '42501', 'anon confirma');
end;
$$;

rollback;

select 'ok' as result;
