-- Pruebas de los archivos de las páginas (`files`, `page_files`, sus funciones y el bucket `thumbs`). Corre
-- dentro de una transacción que se deshace al final: no deja usuarios ni datos. Si todo pasa, devuelve una
-- fila con result = 'ok'.

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

-- Personas: a (dueña de P1 y P3), b (dueño de P2) y m (miembro con permisos por página en P1).
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-00000000000a', 'files-a@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000000b', 'files-b@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000000c', 'files-m@test.invalid', 'authenticated', 'authenticated');

insert into public.members (user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'member'),
  ('00000000-0000-4000-8000-00000000000b', 'member'),
  ('00000000-0000-4000-8000-00000000000c', 'member');

-- P1: a1, a2, a3. P2: b1. P3 (también de a): c1.
insert into public.workspaces (id, owner_id, name) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000000a', 'Proyecto A'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-00000000000b', 'Proyecto B'),
  ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-00000000000a', 'Otro de A');
insert into public.pages (id, workspace_id, title, sort_key) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1', 'a1', 'a0'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000e1', 'a2', 'a1'),
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000e1', 'a3', 'a2'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000e2', 'b1', 'a0'),
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e3', 'c1', 'a0');

-- m: ver a1 y editar a2.
insert into public.grants (user_id, page_id, level) values
  ('00000000-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-0000000000a1', 'view'),
  ('00000000-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-0000000000a2', 'edit');

-- Nadie escribe en las tablas desde la API: ni insert, ni update, ni delete.
create function pg_temp.check_no_writes(who text) returns void language plpgsql as $$
begin
  perform pg_temp.expect_error(
    $q$insert into public.files (id, project_id, name, mime, size)
       values (gen_random_uuid(), '00000000-0000-4000-8000-0000000000e1', 'x', 'image/jpeg', 1)$q$,
    '42501', who || ' inserta en files');
  perform pg_temp.expect_error($q$update public.files set drive_id = 'robado_1234567'$q$,
    '42501', who || ' cambia files');
  perform pg_temp.expect_error($q$update public.files set thumb_at = now(), trashed_at = now()$q$,
    '42501', who || ' cambia la miniatura o la papelera de files');
  perform pg_temp.expect_error($q$delete from public.files$q$, '42501', who || ' borra en files');
  perform pg_temp.expect_error(
    $q$insert into public.page_files (page_id, file_id)
       values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000f1')$q$,
    '42501', who || ' inserta en page_files');
  perform pg_temp.expect_error($q$update public.page_files set created_at = now()$q$,
    '42501', who || ' cambia page_files');
  perform pg_temp.expect_error($q$delete from public.page_files$q$, '42501', who || ' borra en page_files');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- a: registra, linkea, marca la subida y la miniatura
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
do $$
declare
  a1 constant uuid := '00000000-0000-4000-8000-0000000000a1';
  a2 constant uuid := '00000000-0000-4000-8000-0000000000a2';
  c1 constant uuid := '00000000-0000-4000-8000-0000000000c1';
  e1 constant uuid := '00000000-0000-4000-8000-0000000000e1';
  f1 constant uuid := '00000000-0000-4000-8000-0000000000f1';
  j  jsonb;
  t  timestamptz;
begin
  perform public.register_file(f1, a1, 'IMG_0666.MOV', 'Video/QuickTime', 62000000, 3840, 2160, 21.5);
  assert (select count(*) from public.files) = 1, 'a no ve su archivo';
  assert (select project_id from public.files where id = f1) = e1, 'el proyecto no sale de la página';
  assert (select created_by from public.files where id = f1) = auth.uid(), 'created_by no es quien registra';
  assert (select mime from public.files where id = f1) = 'video/quicktime', 'el tipo no queda en minúsculas';
  assert (select drive_id is null and thumb_at is null and uploaded_at is null and trashed_at is null
          from public.files where id = f1), 'un archivo nuevo no arranca vacío';
  assert (select count(*) from public.page_files where file_id = f1 and page_id = a1) = 1,
    'register_file no suma la página';

  -- Reintentar no cambia nada, aunque traiga otros datos.
  perform public.register_file(f1, a1, 'otro.mov', 'video/mp4', 5, 10, 10, 1);
  assert (select name = 'IMG_0666.MOV' and mime = 'video/quicktime' and size = 62000000
          from public.files where id = f1), 'reintentar register_file cambió el archivo';
  assert (select count(*) from public.files) = 1 and (select count(*) from public.page_files) = 1,
    'reintentar register_file duplicó filas';

  -- Registrarlo en otra página del mismo proyecto solo suma la página; link_page_file también.
  perform public.link_page_file(a2, f1);
  perform public.link_page_file(a2, f1);
  perform public.register_file(f1, a2, 'IMG_0666.MOV', 'video/quicktime', 62000000, null, null, null);
  assert (select count(*) from public.page_files where file_id = f1) = 2, 'link_page_file no es idempotente';

  -- Entre proyectos: el archivo sigue siendo de su proyecto. Como a ve los dos, desde el paso 11 queda un uso
  -- de afuera (`is_foreign`, para la papelera) y la función lo dice con 'file_other_project' (sin error).
  assert public.link_page_file(c1, f1) = 'file_other_project', 'link_page_file entre proyectos';
  assert public.register_file(f1, c1, 'x.jpg', 'image/jpeg', 1, null, null, null) = 'file_other_project',
    'register_file con un id de otro proyecto';
  assert (select project_id from public.files where id = f1) = e1, 'el archivo cambió de proyecto';
  assert (select is_foreign from public.page_files where page_id = c1 and file_id = f1), 'el uso de afuera no queda marcado';
  perform pg_temp.expect_error(format('select public.link_page_file(%L, %L)', a1, gen_random_uuid()),
    'file_not_found', 'link_page_file de un archivo que no existe');
  perform pg_temp.expect_error(format('select public.link_page_file(%L, %L)', gen_random_uuid(), f1),
    'page_not_found', 'link_page_file a una página que no existe');

  -- Datos con forma inválida.
  perform pg_temp.expect_error(
    format('select public.register_file(%L, %L, %L, %L, 1, null, null, null)', gen_random_uuid(), a1, '', 'image/jpeg'),
    '23514', 'un archivo sin nombre');
  perform pg_temp.expect_error(
    format('select public.register_file(%L, %L, %L, %L, 1, null, null, null)',
           gen_random_uuid(), a1, repeat('x', 251), 'image/jpeg'),
    '23514', 'un nombre sin tope');
  perform pg_temp.expect_error(
    format('select public.register_file(%L, %L, %L, %L, 1, null, null, null)', gen_random_uuid(), a1, 'x', 'jpeg'),
    '23514', 'un tipo sin forma de tipo');
  perform pg_temp.expect_error(
    format('select public.register_file(%L, %L, %L, %L, 1, null, null, null)',
           gen_random_uuid(), a1, 'x', 'image/' || repeat('x', 200)),
    '23514', 'un tipo sin tope');
  perform pg_temp.expect_error(
    format('select public.register_file(%L, %L, %L, %L, 0, null, null, null)', gen_random_uuid(), a1, 'x', 'image/jpeg'),
    '23514', 'un archivo vacío');
  perform pg_temp.expect_error(
    format('select public.register_file(%L, %L, %L, %L, 1, 0, 10, null)', gen_random_uuid(), a1, 'x', 'image/jpeg'),
    '23514', 'un ancho de 0');
  perform pg_temp.expect_error(
    format('select public.register_file(%L, %L, %L, %L, 1, null, null, %L)', gen_random_uuid(), a1, 'x', 'video/mp4', 'NaN'),
    '23514', 'una duración NaN');
  perform pg_temp.expect_error(
    format('select public.register_file(null, %L, %L, %L, 1, null, null, null)', a1, 'x', 'image/jpeg'),
    'page_not_found', 'un archivo sin id');

  -- media_file: el json para el portero.
  j := public.media_file(f1)::jsonb;
  -- Sus 9 campos; la papelera de archivos (paso 11) suma otros sin sacar ninguno.
  assert j ?& array['id', 'project_id', 'project_name', 'name', 'mime', 'size', 'drive_id', 'created_at', 'level'],
    'media_file no trae sus 9 campos';
  assert j ->> 'id' = f1::text and j ->> 'project_id' = e1::text and j ->> 'project_name' = 'Proyecto A'
     and j ->> 'name' = 'IMG_0666.MOV' and j ->> 'mime' = 'video/quicktime'
     and (j ->> 'size')::bigint = 62000000 and j -> 'drive_id' = 'null'::jsonb
     and (j ->> 'level')::int = 4 and (j ->> 'created_at') is not null,
    format('media_file no da lo esperado a la dueña: %s', j);
  assert public.media_file(gen_random_uuid()) is null, 'media_file de un archivo que no existe';
  assert private.file_level(null) = 0, 'file_level(null)';

  -- set_file_drive: una sola vez; repetir el mismo no cambia nada.
  perform pg_temp.expect_error(format('select public.set_file_drive(%L, %L)', f1, 'corto'),
    'drive_id_invalid', 'un id de Drive corto');
  perform pg_temp.expect_error(format('select public.set_file_drive(%L, %L)', f1, '1AbC_def-GHI/../x'),
    'drive_id_invalid', 'un id de Drive con barras');
  perform public.set_file_drive(f1, '1AbC_def-GHIjkl');
  select uploaded_at into t from public.files where id = f1;
  assert t is not null, 'set_file_drive no pone uploaded_at';
  perform public.set_file_drive(f1, '1AbC_def-GHIjkl');
  assert (select uploaded_at from public.files where id = f1) = t, 'repetir set_file_drive cambió uploaded_at';
  perform pg_temp.expect_error(format('select public.set_file_drive(%L, %L)', f1, '1Otro_id_de_Drive'),
    'file_already_uploaded', 'set_file_drive cambió un drive_id ya puesto');
  assert (select drive_id from public.files where id = f1) = '1AbC_def-GHIjkl', 'el drive_id cambió';
  assert public.media_file(f1) ->> 'drive_id' = '1AbC_def-GHIjkl', 'media_file no trae el drive_id';
  perform pg_temp.expect_error(format('select public.set_file_drive(%L, %L)', gen_random_uuid(), '1AbC_def-GHIjkl'),
    'file_not_found', 'set_file_drive de un archivo que no existe');

  perform public.set_file_thumb(f1);
  assert (select thumb_at is not null from public.files where id = f1), 'set_file_thumb no pone thumb_at';

  perform pg_temp.check_no_writes('la dueña');
end;
$$;

-- Miniaturas de a: sube la de su archivo (con la fila devuelta, como la API) y la ve.
insert into storage.objects (bucket_id, name) values ('thumbs', '00000000-0000-4000-8000-0000000000f1.jpg')
returning name;

do $$
declare
  n int;
begin
  assert (select count(*) from storage.objects where bucket_id = 'thumbs') = 1, 'a no ve su miniatura';
  perform pg_temp.expect_error(
    $q$insert into storage.objects (bucket_id, name) values ('thumbs', '00000000-0000-4000-8000-0000000000f1.jpg')$q$,
    '23505', 'una segunda miniatura con el mismo nombre');
  perform pg_temp.expect_error(
    $q$insert into storage.objects (bucket_id, name) values ('thumbs', 'x.jpg')$q$,
    '42501', 'una miniatura con un nombre que no es de un archivo');
  perform pg_temp.expect_error(
    $q$insert into storage.objects (bucket_id, name) values ('thumbs', '00000000-0000-4000-8000-0000000000F1.jpg')$q$,
    '42501', 'una miniatura con el id en mayúsculas');
  perform pg_temp.expect_error(
    $q$insert into storage.objects (bucket_id, name) values ('thumbs', 'x/00000000-0000-4000-8000-0000000000f1.jpg')$q$,
    '42501', 'una miniatura dentro de una carpeta');
  perform pg_temp.expect_error(
    $q$insert into storage.objects (bucket_id, name) values ('thumbs', '00000000-0000-4000-8000-0000000000f1.png')$q$,
    '42501', 'una miniatura con otra extensión');
  perform pg_temp.expect_error(
    format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'thumbs', gen_random_uuid() || '.jpg'),
    '42501', 'una miniatura de un archivo que no existe');

  update storage.objects set name = '00000000-0000-4000-8000-0000000000f9.jpg' where bucket_id = 'thumbs';
  get diagnostics n = row_count;
  assert n = 0, 'a modifica una miniatura';
  -- Borrar por SQL lo frena Supabase; por la API de Storage, la falta de política de borrado.
  begin
    delete from storage.objects where bucket_id = 'thumbs';
    get diagnostics n = row_count;
    assert n = 0, 'a borra una miniatura';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- b: no ve nada de a ni lo toca
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-00000000000b');
do $$
declare
  a1 constant uuid := '00000000-0000-4000-8000-0000000000a1';
  b1 constant uuid := '00000000-0000-4000-8000-0000000000b1';
  f1 constant uuid := '00000000-0000-4000-8000-0000000000f1';
  fb constant uuid := '00000000-0000-4000-8000-0000000000fb';
  n int;
begin
  assert (select count(*) from public.files) = 0, 'b ve archivos de a';
  assert (select count(*) from public.page_files) = 0, 'b ve page_files de a';
  assert public.media_file(f1) is null, 'media_file le da el archivo de a a b';
  assert private.file_level(f1) = 0, 'b tiene permiso sobre el archivo de a';
  assert (select count(*) from storage.objects where bucket_id = 'thumbs') = 0, 'b ve miniaturas de a';

  perform pg_temp.expect_error(
    format('select public.register_file(%L, %L, %L, %L, 1, null, null, null)', gen_random_uuid(), a1, 'x.jpg', 'image/jpeg'),
    'page_not_found', 'b registra un archivo en una página de a');
  perform pg_temp.expect_error(
    format('select public.register_file(%L, %L, %L, %L, 1, null, null, null)', f1, b1, 'x.jpg', 'image/jpeg'),
    'file_other_project', 'b registra el archivo de a en su página');
  perform pg_temp.expect_error(format('select public.link_page_file(%L, %L)', b1, f1),
    'file_not_found', 'b linkea el archivo de a en su página');
  perform pg_temp.expect_error(format('select public.link_page_file(%L, %L)', a1, f1),
    'page_not_found', 'b linkea en una página de a');
  perform pg_temp.expect_error(format('select public.set_file_drive(%L, %L)', f1, '1Otro_id_de_Drive'),
    'file_not_found', 'b marca la subida de un archivo de a');
  perform pg_temp.expect_error(format('select public.set_file_thumb(%L)', f1),
    'file_not_found', 'b marca la miniatura de un archivo de a');
  perform pg_temp.expect_error(
    $q$insert into storage.objects (bucket_id, name) values ('thumbs', '00000000-0000-4000-8000-0000000000f1.jpg')$q$,
    '42501', 'b sube una miniatura para un archivo de a');

  update storage.objects set name = 'robada.jpg' where bucket_id = 'thumbs';
  get diagnostics n = row_count;
  assert n = 0, 'b modifica miniaturas de a';
  begin
    delete from storage.objects where bucket_id = 'thumbs';
    get diagnostics n = row_count;
    assert n = 0, 'b borra miniaturas de a';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.check_no_writes('b');

  -- Lo suyo sí, y a no lo ve.
  perform public.register_file(fb, b1, 'b.jpg', 'image/jpeg', 10, 100, 100, null);
  assert (select count(*) from public.files) = 1, 'b no ve su archivo';
  assert (public.media_file(fb) ->> 'level')::int = 4, 'b no tiene su archivo';
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
do $$
begin
  assert (select count(*) from public.files) = 1, 'a ve archivos de b';
  assert public.media_file('00000000-0000-4000-8000-0000000000fb') is null, 'media_file le da el de b a a';
  assert (select name from public.files) = 'IMG_0666.MOV' , 'b cambió el archivo de a';
  assert (select count(*) from public.page_files where not is_foreign) = 2, 'b cambió las páginas del archivo de a';
  assert (select count(*) from storage.objects where bucket_id = 'thumbs') = 1, 'b tocó la miniatura de a';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- m: permisos por página (ver a1, editar a2). Las políticas de las tablas siguen a can_view_page, que
-- desde el paso 9 mira los permisos, igual que file_level y media_file.
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-00000000000c');
do $$
declare
  a1 constant uuid := '00000000-0000-4000-8000-0000000000a1';
  a2 constant uuid := '00000000-0000-4000-8000-0000000000a2';
  f1 constant uuid := '00000000-0000-4000-8000-0000000000f1';
  fm constant uuid := '00000000-0000-4000-8000-0000000000f2';
begin
  -- f1 está en a2 (editar), así que gana 3.
  assert private.file_level(f1) = 3, 'm no edita el archivo de a2';
  assert (public.media_file(f1) ->> 'level')::int = 3, 'media_file no da el permiso de m';
  assert (select array_agg(id) from public.files) = array[f1], 'm no ve el archivo de las páginas que ve';
  assert (select count(*) from public.page_files) = 2, 'm no ve en qué páginas está el archivo';

  perform pg_temp.expect_error(
    format('select public.register_file(%L, %L, %L, %L, 1, null, null, null)', fm, a1, 'm.jpg', 'image/jpeg'),
    'page_not_found', 'm registra en una página que solo ve');
  perform public.register_file(fm, a2, 'm.jpg', 'image/jpeg', 10, null, null, null);
  assert (select count(*) from public.files) = 2, 'm no ve el archivo que creó';
  assert private.file_level(fm) = 3, 'm no edita el archivo que creó';
  perform pg_temp.expect_error(format('select public.link_page_file(%L, %L)', a1, fm),
    'page_not_found', 'm linkea en una página que solo ve');
  perform pg_temp.check_no_writes('m');
end;
$$;

-- El piso de quien lo creó: 3 mientras edite alguna página del proyecto, aunque ya no edite las que lo usan.
select set_config('role', 'postgres', true);
update public.grants set level = 'view'
where user_id = '00000000-0000-4000-8000-00000000000c' and page_id = '00000000-0000-4000-8000-0000000000a2';
insert into public.grants (user_id, page_id, level) values
  ('00000000-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-0000000000a3', 'edit');

select pg_temp.as_user('00000000-0000-4000-8000-00000000000c');
do $$
declare
  f1 constant uuid := '00000000-0000-4000-8000-0000000000f1';
  fm constant uuid := '00000000-0000-4000-8000-0000000000f2';
begin
  assert private.file_level(fm) = 3, 'quien lo creó y edita otra página del proyecto perdió el archivo';
  assert private.file_level(f1) = 1, 'm edita un archivo de otro que solo ve';
  assert (public.media_file(f1) ->> 'level')::int = 1, 'media_file no da ver a m';
  perform pg_temp.expect_error(format('select public.set_file_drive(%L, %L)', f1, '1Otro_id_de_Drive'),
    'file_not_found', 'alguien que solo ve marca la subida');
  perform pg_temp.expect_error(format('select public.set_file_thumb(%L)', f1),
    'file_not_found', 'alguien que solo ve marca la miniatura');
  -- Ve la miniatura del archivo que ve, pero no sube.
  assert (select count(*) from storage.objects where bucket_id = 'thumbs') = 1, 'm no ve la miniatura de f1';
  perform pg_temp.expect_error(
    $q$insert into storage.objects (bucket_id, name) values ('thumbs', '00000000-0000-4000-8000-0000000000f2.png')$q$,
    '42501', 'una miniatura .png');
  insert into storage.objects (bucket_id, name) values ('thumbs', '00000000-0000-4000-8000-0000000000f2.jpg');
  perform public.set_file_thumb(fm);
end;
$$;

select set_config('role', 'postgres', true);
delete from public.grants
where user_id = '00000000-0000-4000-8000-00000000000c' and page_id = '00000000-0000-4000-8000-0000000000a3';

select pg_temp.as_user('00000000-0000-4000-8000-00000000000c');
do $$
begin
  assert private.file_level('00000000-0000-4000-8000-0000000000f2') = 1,
    'quien lo creó sigue editando sin poder editar ninguna página del proyecto';
end;
$$;

-- Sacada del workspace: sus permisos no cuentan y pierde también lo que creó.
select set_config('role', 'postgres', true);
update public.members set removed_at = now() where user_id = '00000000-0000-4000-8000-00000000000c';

select pg_temp.as_user('00000000-0000-4000-8000-00000000000c');
do $$
declare
  f1 constant uuid := '00000000-0000-4000-8000-0000000000f1';
  fm constant uuid := '00000000-0000-4000-8000-0000000000f2';
begin
  assert private.file_level(fm) = 0 and private.file_level(f1) = 0, 'la sacada conserva permisos sobre archivos';
  assert public.media_file(fm) is null and public.media_file(f1) is null, 'media_file le da archivos a la sacada';
  assert (select count(*) from storage.objects where bucket_id = 'thumbs') = 0, 'la sacada ve miniaturas';
  assert (select count(*) from public.files) = 0, 'la sacada ve archivos, también los que creó';
  assert (select count(*) from public.page_files) = 0, 'la sacada ve page_files';
  perform pg_temp.expect_error(format('select public.set_file_thumb(%L)', fm),
    'file_not_found', 'la sacada marca la miniatura de lo que creó');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- La base: el bucket, la versión y lo de antes
-- ---------------------------------------------------------------------------------------------------
select set_config('role', 'postgres', true);
do $$
begin
  assert (select not public and file_size_limit = 524288
                 and allowed_mime_types = array['image/jpeg', 'image/webp']
          from storage.buckets where id = 'thumbs'), 'el bucket thumbs no es privado, de 512 KB y JPEG/WebP';
  assert (select schema_version from public.workspace_settings) >= 3, 'schema_version no subió a 3';
  assert (select count(*) from pg_policies
          where schemaname = 'storage' and tablename = 'objects' and policyname like 'thumbs%'
            and roles = array['authenticated']::name[]) = 2,
    'thumbs tiene políticas de más';
  -- Desde el link público (20261012120000_link_publico.sql), una más, solo para anon y con el header del link; desde la
  -- entrega 2b (20261030120000_link_archivos.sql), la de subir la miniatura de un archivo del link.
  assert (select count(*) from pg_policies
          where schemaname = 'storage' and tablename = 'objects' and policyname like 'thumbs%'
            and roles <> array['authenticated']::name[]) <= 2,
    'thumbs tiene políticas de más para otros roles';
  assert (select count(*) from public.files where created_by is null) = 0, 'un archivo sin autor';
end;
$$;

-- a sigue viendo la miniatura de su archivo y media_whoami no cambió.
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
do $$
begin
  assert (select count(*) from storage.objects where bucket_id = 'thumbs') = 2, 'a no ve las miniaturas de P1';
  assert (select array_agg(k order by k) from json_object_keys(public.media_whoami()) k)
         = array['is_owner', 'role', 'user_id'], 'media_whoami cambió';
end;
$$;

-- Sin sesión: nada.
select set_config('role', 'anon', true);
do $$
begin
  perform pg_temp.expect_error('select 1 from public.files', '42501', 'anon lee files');
  perform pg_temp.expect_error('select 1 from public.page_files', '42501', 'anon lee page_files');
  perform pg_temp.expect_error(
    $q$select public.media_file('00000000-0000-4000-8000-0000000000f1')$q$, '42501', 'anon llama a media_file');
  perform pg_temp.expect_error(
    $q$select public.register_file(gen_random_uuid(), '00000000-0000-4000-8000-0000000000a1', 'x', 'image/jpeg', 1, null, null, null)$q$,
    '42501', 'anon llama a register_file');
  perform pg_temp.expect_error(
    $q$select public.set_file_drive('00000000-0000-4000-8000-0000000000f1', '1AbC_def-GHIjkl')$q$,
    '42501', 'anon llama a set_file_drive');
  perform pg_temp.expect_error(
    $q$select private.file_level('00000000-0000-4000-8000-0000000000f1')$q$, '42501', 'anon llama a file_level');
  assert (select count(*) from storage.objects where bucket_id = 'thumbs') = 0, 'anon ve miniaturas';
end;
$$;

rollback;

select 'ok' as result;
