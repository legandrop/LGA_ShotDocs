-- Pruebas de los comentarios importados (Doc_Importar_Coda.md, "3. Comentarios"): `import_comment` pide editar y
-- crear páginas, guarda la fecha original, el autor externo (sin cuenta) o a nombre de quien importa, entra
-- resuelto; reintentar no duplica; importar de nuevo con otro bloque vuelve a anclar el hilo; lo que no se puede
-- (fechas fuera de rango, resuelto en una respuesta, otro origen, otra persona con el mismo id); quién edita y
-- borra un importado; `list_comments`, la vista y `comment_authors` con lo nuevo; las restricciones de la tabla
-- y que sin sesión no se importa. Corre dentro de una transacción que se deshace al final: no deja usuarios ni
-- datos. Si todo pasa, devuelve una fila con result = 'ok'.

begin;

-- Como la app actual (desde v0.099 manda su versión en el header `x-shotdocs-version`): la base puede pedir una
-- versión mínima (`workspace_settings.min_app_version`) y, sin header, rechaza las escrituras con `app_outdated`.
-- Vale para toda la transacción; la prueba de la versión mínima la cubre `version_minima_arbol_permisos.sql`.
select set_config('request.headers', '{"x-shotdocs-version": "9.999"}', true);

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

-- Personas (correo @test.invalid):
--   ow  dueña del workspace (creó P1)       cv, cc, ce, ep  ver, comentar, editar y editar y crear sobre c
--   nx  sin membresía
-- Páginas: P1 con r › c, y s.
insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('00000000-0000-4000-8000-000000000e01', 'ci-ow@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000e02', 'ci-cv@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000e03', 'ci-cc@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000e04', 'ci-ce@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000e05', 'ci-ep@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000e09', 'ci-nx@test.invalid', 'authenticated', 'authenticated', now());

-- Si la base ya tiene dueño, queda fuera de la prueba (se deshace al final): hay un solo dueño activo.
update public.members set removed_at = now() where role = 'owner' and removed_at is null;
update public.workspace_settings set owner_id = '00000000-0000-4000-8000-000000000e01';

insert into public.members (user_id, role) values
  ('00000000-0000-4000-8000-000000000e01', 'owner'),
  ('00000000-0000-4000-8000-000000000e02', 'member'),
  ('00000000-0000-4000-8000-000000000e03', 'member'),
  ('00000000-0000-4000-8000-000000000e04', 'member'),
  ('00000000-0000-4000-8000-000000000e05', 'member');

insert into public.workspaces (id, owner_id, name) values
  ('00000000-0000-4000-8000-000000000ea1', '00000000-0000-4000-8000-000000000e01', 'P1');
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  ('00000000-0000-4000-8000-000000000eb1', '00000000-0000-4000-8000-000000000ea1', null, 'r', 'a0'),
  ('00000000-0000-4000-8000-000000000eb3', '00000000-0000-4000-8000-000000000ea1', null, 's', 'a1');
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  ('00000000-0000-4000-8000-000000000eb2', '00000000-0000-4000-8000-000000000ea1',
   '00000000-0000-4000-8000-000000000eb1', 'c', 'a0');

insert into public.grants (user_id, page_id, level) values
  ('00000000-0000-4000-8000-000000000e02', '00000000-0000-4000-8000-000000000eb2', 'view'),
  ('00000000-0000-4000-8000-000000000e03', '00000000-0000-4000-8000-000000000eb2', 'comment'),
  ('00000000-0000-4000-8000-000000000e04', '00000000-0000-4000-8000-000000000eb2', 'edit'),
  ('00000000-0000-4000-8000-000000000e05', '00000000-0000-4000-8000-000000000eb2', 'edit_pages');

-- ---------------------------------------------------------------------------------------------------
-- Quién importa: editar y crear páginas (4) o más; ver, comentar y editar no; sin acceso, como si no existiera
-- ---------------------------------------------------------------------------------------------------
create function pg_temp.try_import(who text, expected text) returns void language plpgsql as $$
begin
  perform pg_temp.expect_error(
    $q$select public.import_comment(gen_random_uuid(), '00000000-0000-4000-8000-000000000eb2', null, null, 'x',
         '2026-01-01T10:00:00Z', null, 'coda', 'Persona Externa', 'ext@test.invalid')$q$,
    expected, 'importa ' || who);
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-000000000e02');
select pg_temp.try_import('con ver', 'import_denied');
select pg_temp.as_user('00000000-0000-4000-8000-000000000e03');
select pg_temp.try_import('con comentar', 'import_denied');
select pg_temp.as_user('00000000-0000-4000-8000-000000000e04');
select pg_temp.try_import('con editar', 'import_denied');
select pg_temp.as_user('00000000-0000-4000-8000-000000000e09');
select pg_temp.try_import('sin membresía', 'page_not_found');
-- Con editar y crear sobre c, no sobre r (el permiso vale hacia abajo, no hacia arriba).
select pg_temp.as_user('00000000-0000-4000-8000-000000000e05');
select pg_temp.expect_error(
  $q$select public.import_comment(gen_random_uuid(), '00000000-0000-4000-8000-000000000eb1', null, null, 'x',
       '2026-01-01T10:00:00Z', null, 'coda', 'Persona Externa', 'ext@test.invalid')$q$,
  'page_not_found', 'importa en la página de arriba');

-- ---------------------------------------------------------------------------------------------------
-- Importar: autor externo, fecha original, resuelto; respuesta propia; reintentos
-- ---------------------------------------------------------------------------------------------------
--   i1 (f01) hilo de "Persona Externa" en c, bloque blk-1, resuelto
--   i2 (f02) respuesta de ep (a su nombre) a i1
--   i3 (f03) hilo de "Persona Externa" en c, la página entera, abierto
do $$
declare
  r record;
begin
  perform public.import_comment('00000000-0000-4000-8000-000000000f01', '00000000-0000-4000-8000-000000000eb2',
    'blk-1', null, 'Es de noche.', '2026-01-01T10:00:00.250Z', '2026-01-01T11:00:00Z', 'coda',
    '  Persona Externa ', 'Ext@Test.Invalid');
  perform public.import_comment('00000000-0000-4000-8000-000000000f02', '00000000-0000-4000-8000-000000000eb2',
    null, '00000000-0000-4000-8000-000000000f01', 'Ok, anotado.', '2026-01-01T10:30:00Z', null, 'coda',
    null, 'se-ignora@test.invalid');
  perform public.import_comment('00000000-0000-4000-8000-000000000f03', '00000000-0000-4000-8000-000000000eb2',
    null, null, 'Sin anclaje.', '2026-01-02T09:00:00Z', null, 'coda', 'Persona Externa', null);

  select * into r from public.comments_view where id = '00000000-0000-4000-8000-000000000f01';
  assert r.author_id is null, 'el importado externo tiene autor de la app';
  assert r.imported_author = 'Persona Externa', format('nombre: %s', r.imported_author);
  assert r.imported_author_email = 'ext@test.invalid', format('correo: %s', r.imported_author_email);
  assert r.imported_from = 'coda', 'sin origen';
  assert r.imported_by = '00000000-0000-4000-8000-000000000e05', 'imported_by no es quien importó';
  assert r.created_at = '2026-01-01T10:00:00.250Z'::timestamptz, format('fecha: %s', r.created_at);
  assert r.updated_at > now() - interval '1 minute', 'updated_at no es el momento de importar';
  assert r.resolved_at = '2026-01-01T11:00:00Z'::timestamptz and r.resolved_by is null, 'no entró resuelto';
  assert r.block_id = 'blk-1' and r.body = 'Es de noche.', 'bloque o texto';

  select * into r from public.comments_view where id = '00000000-0000-4000-8000-000000000f02';
  assert r.author_id = '00000000-0000-4000-8000-000000000e05', 'lo propio no quedó a nombre de quien importa';
  assert r.imported_author is null and r.imported_author_email is null, 'lo propio tiene autor externo';
  assert r.block_id = 'blk-1', 'la respuesta no tomó el bloque del hilo';
  assert r.thread_id = '00000000-0000-4000-8000-000000000f01', 'la respuesta no cuelga del hilo';

  select * into r from public.comments_view where id = '00000000-0000-4000-8000-000000000f03';
  assert r.block_id is null and r.resolved_at is null and r.imported_author_email is null, 'hilo de la página';

  -- Reintentar lo mismo no cambia nada (tampoco con el nombre sin recortar o el correo en mayúsculas).
  perform public.import_comment('00000000-0000-4000-8000-000000000f01', '00000000-0000-4000-8000-000000000eb2',
    'blk-1', null, 'Es de noche.', '2026-01-01T10:00:00.250Z', '2026-01-01T11:00:00Z', 'coda',
    'Persona Externa', 'ext@test.invalid');
  perform public.import_comment('00000000-0000-4000-8000-000000000f02', '00000000-0000-4000-8000-000000000eb2',
    null, '00000000-0000-4000-8000-000000000f01', 'Ok, anotado.', '2026-01-01T10:30:00Z', null, 'coda', null, null);
  assert (select count(*) from public.comments where page_id = '00000000-0000-4000-8000-000000000eb2') = 3,
    'el reintento duplicó';

  -- Importar de nuevo con otro bloque (seguir una importación: la página se reescribió) vuelve a anclar el hilo
  -- y sus respuestas; el texto que tiene la base queda.
  perform public.import_comment('00000000-0000-4000-8000-000000000f01', '00000000-0000-4000-8000-000000000eb2',
    'blk-nuevo', null, 'Es de noche (otro texto).', '2026-01-01T10:00:00.250Z', '2026-01-01T11:00:00Z', 'coda',
    'Persona Externa', 'ext@test.invalid');
  perform public.import_comment('00000000-0000-4000-8000-000000000f02', '00000000-0000-4000-8000-000000000eb2',
    null, '00000000-0000-4000-8000-000000000f01', 'Ok, anotado.', '2026-01-01T10:30:00Z', null, 'coda', null, null);
  assert (select block_id from public.comments where id = '00000000-0000-4000-8000-000000000f01') = 'blk-nuevo',
    'el hilo no pasó al bloque nuevo';
  assert (select block_id from public.comments where id = '00000000-0000-4000-8000-000000000f02') = 'blk-nuevo',
    'la respuesta no pasó al bloque nuevo';
  assert (select body from public.comments_view where id = '00000000-0000-4000-8000-000000000f01') = 'Es de noche.',
    'importar de nuevo cambió el texto';
  assert (select count(*) from public.comments where page_id = '00000000-0000-4000-8000-000000000eb2') = 3,
    'volver a anclar duplicó';
  -- Sin bloque (esta vez no se encontró su texto), el hilo queda donde estaba.
  perform public.import_comment('00000000-0000-4000-8000-000000000f01', '00000000-0000-4000-8000-000000000eb2',
    null, null, 'Es de noche.', '2026-01-01T10:00:00.250Z', '2026-01-01T11:00:00Z', 'coda',
    'Persona Externa', 'ext@test.invalid');
  assert (select block_id from public.comments where id = '00000000-0000-4000-8000-000000000f01') = 'blk-nuevo',
    'importar sin bloque sacó el hilo de su bloque';
end;
$$;

-- Con otra fecha, otro autor, o la misma fila importada por otra persona: `comment_conflict`.
select pg_temp.expect_error(
  $q$select public.import_comment('00000000-0000-4000-8000-000000000f01', '00000000-0000-4000-8000-000000000eb2',
       'blk-nuevo', null, 'Es de noche.', '2026-01-01T10:00:00Z', null, 'coda', 'Persona Externa', 'ext@test.invalid')$q$,
  'comment_conflict', 'reintento con otra fecha');
select pg_temp.expect_error(
  $q$select public.import_comment('00000000-0000-4000-8000-000000000f01', '00000000-0000-4000-8000-000000000eb2',
       'blk-nuevo', null, 'Es de noche.', '2026-01-01T10:00:00.250Z', null, 'coda', 'Otra Persona', 'ext@test.invalid')$q$,
  'comment_conflict', 'reintento con otro autor');
select pg_temp.as_user('00000000-0000-4000-8000-000000000e01');
select pg_temp.expect_error(
  $q$select public.import_comment('00000000-0000-4000-8000-000000000f01', '00000000-0000-4000-8000-000000000eb2',
       'blk-nuevo', null, 'Es de noche.', '2026-01-01T10:00:00.250Z', '2026-01-01T11:00:00Z', 'coda',
       'Persona Externa', 'ext@test.invalid')$q$,
  'comment_conflict', 'otra persona con el mismo id');
-- Un id que ya usa un comentario normal tampoco se pisa.
select public.add_comment('00000000-0000-4000-8000-000000000f09', '00000000-0000-4000-8000-000000000eb2', null, null, 'Normal');
select pg_temp.expect_error(
  $q$select public.import_comment('00000000-0000-4000-8000-000000000f09', '00000000-0000-4000-8000-000000000eb2',
       null, null, 'Normal', '2026-01-01T10:00:00Z', null, 'coda', null, null)$q$,
  'comment_conflict', 'importa sobre un comentario normal');

-- ---------------------------------------------------------------------------------------------------
-- Lo que no se puede
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-000000000e05');
do $$
begin
  perform pg_temp.expect_error(
    $q$select public.import_comment(gen_random_uuid(), '00000000-0000-4000-8000-000000000eb2', null, null, 'x',
         now() + interval '1 day', null, 'coda', 'Persona Externa', null)$q$,
    'created_invalid', 'fecha futura');
  perform pg_temp.expect_error(
    $q$select public.import_comment(gen_random_uuid(), '00000000-0000-4000-8000-000000000eb2', null, null, 'x',
         '1999-12-31T00:00:00Z', null, 'coda', 'Persona Externa', null)$q$,
    'created_invalid', 'fecha anterior a 2000');
  perform pg_temp.expect_error(
    $q$select public.import_comment(gen_random_uuid(), '00000000-0000-4000-8000-000000000eb2', null, null, 'x',
         null, null, 'coda', 'Persona Externa', null)$q$,
    'created_invalid', 'sin fecha');
  perform pg_temp.expect_error(
    $q$select public.import_comment(gen_random_uuid(), '00000000-0000-4000-8000-000000000eb2', null,
         '00000000-0000-4000-8000-000000000f01', 'x', '2026-01-01T10:00:00Z', '2026-01-01T10:00:00Z', 'coda',
         'Persona Externa', null)$q$,
    'resolved_invalid', 'respuesta resuelta');
  perform pg_temp.expect_error(
    $q$select public.import_comment(gen_random_uuid(), '00000000-0000-4000-8000-000000000eb2', null, null, 'x',
         '2026-01-01T10:00:00Z', '1990-01-01T00:00:00Z', 'coda', 'Persona Externa', null)$q$,
    'resolved_invalid', 'resuelto antes de 2000');
  perform pg_temp.expect_error(
    $q$select public.import_comment(gen_random_uuid(), '00000000-0000-4000-8000-000000000eb2', null,
         '00000000-0000-4000-8000-000000000f02', 'x', '2026-01-01T10:00:00Z', null, 'coda', 'Persona Externa', null)$q$,
    'thread_invalid', 'respuesta a una respuesta');
  perform pg_temp.expect_error(
    $q$select public.import_comment(gen_random_uuid(), '00000000-0000-4000-8000-000000000eb2', 'otro',
         '00000000-0000-4000-8000-000000000f01', 'x', '2026-01-01T10:00:00Z', null, 'coda', 'Persona Externa', null)$q$,
    'thread_invalid', 'respuesta en otro bloque');
  perform pg_temp.expect_error(
    $q$select public.import_comment(gen_random_uuid(), '00000000-0000-4000-8000-000000000eb2', null,
         gen_random_uuid(), 'x', '2026-01-01T10:00:00Z', null, 'coda', 'Persona Externa', null)$q$,
    'thread_not_found', 'respuesta a un hilo que no existe');
  perform pg_temp.expect_error(
    $q$select public.import_comment(gen_random_uuid(), '00000000-0000-4000-8000-000000000eb2', null, null, 'x',
         '2026-01-01T10:00:00Z', null, 'otra', 'Persona Externa', null)$q$,
    '23514', 'un origen que no se conoce');
  -- Desde 20261026120000_comentarios_archivo.sql, `'shotdocs'` (un archivo exportado que vuelve, Doc_Exportar.md 3) sí.
  -- En un bloque que se deshace solo (la excepción del final), así no cambia las cuentas de más abajo.
  begin
    perform public.import_comment('00000000-0000-4000-8000-000000000f0a', '00000000-0000-4000-8000-000000000eb2', null,
      null, 'Vuelve del archivo.', '2026-01-03T09:00:00Z', null, 'shotdocs', 'Persona Externa', null);
    assert exists (select 1 from public.comments_view where id = '00000000-0000-4000-8000-000000000f0a'
                   and imported_from = 'shotdocs' and imported_author_email is null), 'el origen shotdocs no entró';
    raise exception 'shotdocs_ok';
  exception when others then
    if sqlerrm <> 'shotdocs_ok' then
      raise;
    end if;
  end;
  perform pg_temp.expect_error(
    $q$select public.import_comment(gen_random_uuid(), '00000000-0000-4000-8000-000000000eb2', 'mal bloque', null,
         'x', '2026-01-01T10:00:00Z', null, 'coda', 'Persona Externa', null)$q$,
    '23514', 'bloque con forma inválida');
  perform pg_temp.expect_error(
    $q$select public.import_comment(gen_random_uuid(), '00000000-0000-4000-8000-000000000eb2', null, null, '  ',
         '2026-01-01T10:00:00Z', null, 'coda', 'Persona Externa', null)$q$,
    '23514', 'texto vacío');
  perform pg_temp.expect_error(
    $q$select public.import_comment(gen_random_uuid(), '00000000-0000-4000-8000-000000000eb2', null, null, 'x',
         '2026-01-01T10:00:00Z', null, 'coda', repeat('n', 201), null)$q$,
    '23514', 'nombre demasiado largo');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Después de importar: editar, borrar, responder, resolver
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  -- El externo no lo edita nadie; lo propio, quien importó.
  perform pg_temp.expect_error($q$select public.edit_comment('00000000-0000-4000-8000-000000000f01', 'y')$q$,
    'not_allowed', 'edita un importado externo');
  perform public.edit_comment('00000000-0000-4000-8000-000000000f02', 'Ok, anotado (editado).');
end;
$$;

-- Con editar (3) no borra lo ajeno.
select pg_temp.as_user('00000000-0000-4000-8000-000000000e04');
select pg_temp.expect_error($q$select public.delete_comment('00000000-0000-4000-8000-000000000f03')$q$,
  'not_allowed', 'borra un importado externo con editar');

select pg_temp.as_user('00000000-0000-4000-8000-000000000e03');
do $$
begin
  -- Con comentar, responde y reabre un hilo importado.
  perform public.add_comment('00000000-0000-4000-8000-000000000f04', '00000000-0000-4000-8000-000000000eb2',
    null, '00000000-0000-4000-8000-000000000f01', 'Respuesta nueva');
  assert (select block_id from public.comments_view where id = '00000000-0000-4000-8000-000000000f04') = 'blk-nuevo',
    'la respuesta nueva no tomó el bloque del hilo importado';
  perform public.resolve_thread('00000000-0000-4000-8000-000000000f01', false);
  assert (select resolved_at from public.comments_view where id = '00000000-0000-4000-8000-000000000f01') is null,
    'no se reabrió';
end;
$$;

-- Con editar y crear, borra el de afuera (queda marcado, con el texto en la base).
select pg_temp.as_user('00000000-0000-4000-8000-000000000e05');
select public.delete_comment('00000000-0000-4000-8000-000000000f03');
-- Un hilo borrado no se vuelve a anclar al importarlo de nuevo.
select public.import_comment('00000000-0000-4000-8000-000000000f03', '00000000-0000-4000-8000-000000000eb2',
  'blk-x', null, 'Sin anclaje.', '2026-01-02T09:00:00Z', null, 'coda', 'Persona Externa', null);

-- Quien ve la página ve el autor importado, su correo y quién importó, por la función, la vista y los autores.
select pg_temp.as_user('00000000-0000-4000-8000-000000000e02');
do $$
declare
  r record;
begin
  select * into r from public.list_comments('00000000-0000-4000-8000-000000000eb2')
    where id = '00000000-0000-4000-8000-000000000f01';
  assert r.imported_author = 'Persona Externa' and r.imported_author_email = 'ext@test.invalid'
         and r.imported_from = 'coda' and r.imported_by = '00000000-0000-4000-8000-000000000e05',
    'list_comments no da el autor importado';
  assert (select count(*) from public.list_comments('00000000-0000-4000-8000-000000000eb2')) = 5,
    'list_comments no da los cinco';
  select * into r from public.list_comments('00000000-0000-4000-8000-000000000eb2')
    where id = '00000000-0000-4000-8000-000000000f03';
  assert r.body is null and r.deleted_at is not null and r.block_id is null, 'el importado borrado da el texto o se movió';
  assert (select imported_author from public.comments where id = '00000000-0000-4000-8000-000000000f01')
         = 'Persona Externa', 'la tabla no da el autor importado';
  assert exists (select 1 from public.comment_authors('00000000-0000-4000-8000-000000000eb2')
                 where user_id = '00000000-0000-4000-8000-000000000e05'), 'comment_authors no da a quien importó';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Restricciones de la tabla (directo, como postgres)
-- ---------------------------------------------------------------------------------------------------
select set_config('role', 'postgres', true);
do $$
begin
  perform pg_temp.expect_error(
    $q$insert into public.comments (id, page_id, body, author_id, imported_from, imported_author)
       values (gen_random_uuid(), '00000000-0000-4000-8000-000000000eb2', 'x',
               '00000000-0000-4000-8000-000000000e04', 'coda', 'Persona Externa')$q$,
    '23514', 'autor externo con autor de la app');
  perform pg_temp.expect_error(
    $q$insert into public.comments (id, page_id, body, author_id, imported_author)
       values (gen_random_uuid(), '00000000-0000-4000-8000-000000000eb2', 'x', null, 'Persona Externa')$q$,
    '23514', 'autor externo sin origen');
  perform pg_temp.expect_error(
    $q$insert into public.comments (id, page_id, body, author_id, imported_from, imported_author_email)
       values (gen_random_uuid(), '00000000-0000-4000-8000-000000000eb2', 'x', null, 'coda', 'a@test.invalid')$q$,
    '23514', 'correo sin nombre');
  perform pg_temp.expect_error(
    $q$insert into public.comments (id, page_id, body, author_id, imported_by)
       values (gen_random_uuid(), '00000000-0000-4000-8000-000000000eb2', 'x', null,
               '00000000-0000-4000-8000-000000000e04')$q$,
    '23514', 'imported_by sin origen');
  assert (select schema_version from public.workspace_settings) >= 8, 'schema_version no subió a 8';
end;
$$;

-- Nadie escribe directo en la tabla, y sin sesión no se importa.
select pg_temp.as_user('00000000-0000-4000-8000-000000000e01');
select pg_temp.expect_error(
  $q$update public.comments set imported_author = 'Otra' where id = '00000000-0000-4000-8000-000000000f01'$q$,
  '42501', 'la dueña cambia el autor importado directo');
select set_config('role', 'anon', true);
select pg_temp.expect_error(
  $q$select public.import_comment(gen_random_uuid(), '00000000-0000-4000-8000-000000000eb2', null, null, 'x',
       '2026-01-01T10:00:00Z', null, 'coda', 'Persona Externa', null)$q$,
  '42501', 'anon importa');

rollback;

select 'ok' as result;
