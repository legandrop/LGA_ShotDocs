-- Pruebas del equipo (paso 9): permisos por proyecto y página en las políticas, proyectos privados,
-- invitaciones, el hook "Before User Created", miembros, compartir y sacar a alguien. Corre dentro de una
-- transacción que se deshace al final: no deja usuarios ni datos. Si todo pasa, devuelve una fila con
-- result = 'ok'.

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
--   ow  dueña del workspace            ad  admin                     ad2, ad3 otras admins
--   me  miembro: comentar en P1 y editar en c                      gu  invitada: ver d y ver PS2
--   uv, uc, ue, ep  miembros con ver, comentar, editar y editar y crear páginas sobre c
--   mv  miembro con editar y crear páginas sobre c y sobre s       pe  miembro con editar y crear en P1
--   lv  miembro con proyectos propios (como las cuentas de antes del paso 5), al que se saca
--   nx  sin membresía   rx  admin ya sacada   nu  entra con una invitación   sv  correo sin verificar
insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('00000000-0000-4000-8000-000000000901', 'eq-ow@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000902', 'eq-ad@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000903', 'eq-ad2@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000904', 'eq-me@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000905', 'eq-gu@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000906', 'eq-uv@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000907', 'eq-uc@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000908', 'eq-ue@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000909', 'eq-ep@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-00000000090a', 'eq-mv@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-00000000090b', 'eq-pe@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-00000000090c', 'eq-lv@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-00000000090d', 'eq-nx@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000910', 'eq-rx@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000911', 'eq-ad3@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-00000000090f', 'eq-sv@test.invalid', 'authenticated', 'authenticated', null);

-- Si la base ya tiene dueño, queda fuera de la prueba (se deshace al final): hay un solo dueño activo.
update public.members set removed_at = now() where role = 'owner' and removed_at is null;
update public.workspace_settings set owner_id = '00000000-0000-4000-8000-000000000901';

insert into public.members (user_id, role, removed_at) values
  ('00000000-0000-4000-8000-000000000901', 'owner', null),
  ('00000000-0000-4000-8000-000000000902', 'admin', null),
  ('00000000-0000-4000-8000-000000000903', 'admin', null),
  ('00000000-0000-4000-8000-000000000904', 'member', null),
  ('00000000-0000-4000-8000-000000000905', 'guest', null),
  ('00000000-0000-4000-8000-000000000906', 'member', null),
  ('00000000-0000-4000-8000-000000000907', 'member', null),
  ('00000000-0000-4000-8000-000000000908', 'member', null),
  ('00000000-0000-4000-8000-000000000909', 'member', null),
  ('00000000-0000-4000-8000-00000000090a', 'member', null),
  ('00000000-0000-4000-8000-00000000090b', 'member', null),
  ('00000000-0000-4000-8000-00000000090c', 'member', null),
  ('00000000-0000-4000-8000-000000000910', 'admin', now()),
  ('00000000-0000-4000-8000-000000000911', 'admin', null);

-- La dueña crea P1 y su árbol desde la API: r › c › g, y s › d. La admin crea PA con la página pa.
select pg_temp.as_user('00000000-0000-4000-8000-000000000901');
insert into public.workspaces (id, name) values ('00000000-0000-4000-8000-000000000a01', 'P1')
on conflict (id) do nothing returning id;
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  ('00000000-0000-4000-8000-000000000b01', '00000000-0000-4000-8000-000000000a01', null, 'r', 'a0'),
  ('00000000-0000-4000-8000-000000000b04', '00000000-0000-4000-8000-000000000a01', null, 's', 'a1')
on conflict (id) do nothing returning id;
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  ('00000000-0000-4000-8000-000000000b02', '00000000-0000-4000-8000-000000000a01',
   '00000000-0000-4000-8000-000000000b01', 'c', 'a0'),
  ('00000000-0000-4000-8000-000000000b05', '00000000-0000-4000-8000-000000000a01',
   '00000000-0000-4000-8000-000000000b04', 'd', 'a0')
on conflict (id) do nothing returning id;
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  ('00000000-0000-4000-8000-000000000b03', '00000000-0000-4000-8000-000000000a01',
   '00000000-0000-4000-8000-000000000b02', 'g', 'a0')
on conflict (id) do nothing returning id;
select public.push_page_update(p, gen_random_uuid(), 'AQAAAA==', '9.999')
from unnest(array['00000000-0000-4000-8000-000000000b01', '00000000-0000-4000-8000-000000000b02',
                  '00000000-0000-4000-8000-000000000b03']::uuid[]) p;
insert into storage.objects (bucket_id, name)
values ('page-files', '00000000-0000-4000-8000-000000000b02/00000000-0000-4000-8000-000000000f01.png');

select pg_temp.as_user('00000000-0000-4000-8000-000000000902');
insert into public.workspaces (id, name) values ('00000000-0000-4000-8000-000000000a02', 'PA')
on conflict (id) do nothing returning id;
insert into public.pages (id, workspace_id, title, sort_key) values
  ('00000000-0000-4000-8000-000000000b09', '00000000-0000-4000-8000-000000000a02', 'pa', 'a0')
on conflict (id) do nothing returning id;

-- lv tiene cuatro proyectos de antes (la base los crea, como a las cuentas de antes del paso 5): PP (el más
-- viejo, privado), PS, PS2 y PS3. Los comparte él mismo, como quien creó el proyecto: PS con me (ver),
-- ad2 (editar) y ad3 (editar y crear), todos sobre el proyecto entero; PS2 solo con la invitada; PS3 con
-- la dueña, pero solo "ver" sobre una página.
select set_config('role', 'postgres', true);
insert into public.workspaces (id, owner_id, name, created_at) values
  ('00000000-0000-4000-8000-000000000a03', '00000000-0000-4000-8000-00000000090c', 'PS', now() - interval '1 day'),
  ('00000000-0000-4000-8000-000000000a04', '00000000-0000-4000-8000-00000000090c', 'PP', now() - interval '2 days'),
  ('00000000-0000-4000-8000-000000000a05', '00000000-0000-4000-8000-00000000090c', 'PS2', now()),
  ('00000000-0000-4000-8000-000000000a06', '00000000-0000-4000-8000-00000000090c', 'PS3', now());
insert into public.pages (id, workspace_id, title, sort_key) values
  ('00000000-0000-4000-8000-000000000b06', '00000000-0000-4000-8000-000000000a03', 'ps', 'a0'),
  ('00000000-0000-4000-8000-000000000b07', '00000000-0000-4000-8000-000000000a04', 'pp', 'a0'),
  ('00000000-0000-4000-8000-000000000b08', '00000000-0000-4000-8000-000000000a05', 'ps2', 'a0'),
  ('00000000-0000-4000-8000-000000000b0b', '00000000-0000-4000-8000-000000000a06', 'ps3', 'a0');

select pg_temp.as_user('00000000-0000-4000-8000-00000000090c');
select public.share('00000000-0000-4000-8000-000000000904', '00000000-0000-4000-8000-000000000a03', null, 'view');
select public.share('00000000-0000-4000-8000-000000000903', '00000000-0000-4000-8000-000000000a03', null, 'edit');
select public.share('00000000-0000-4000-8000-000000000911', '00000000-0000-4000-8000-000000000a03', null, 'edit_pages');
select public.share('00000000-0000-4000-8000-000000000901', null, '00000000-0000-4000-8000-000000000b0b', 'view');
select public.share('00000000-0000-4000-8000-000000000905', '00000000-0000-4000-8000-000000000a05', null, 'view');

-- La dueña comparte P1 (ella lo creó y es la dueña).
select pg_temp.as_user('00000000-0000-4000-8000-000000000901');
select public.share(u, p, pg, l) from (values
  ('00000000-0000-4000-8000-000000000904'::uuid, '00000000-0000-4000-8000-000000000a01'::uuid, null::uuid, 'comment'),
  ('00000000-0000-4000-8000-000000000904', null, '00000000-0000-4000-8000-000000000b02', 'edit'),
  ('00000000-0000-4000-8000-000000000905', null, '00000000-0000-4000-8000-000000000b05', 'view'),
  ('00000000-0000-4000-8000-000000000906', null, '00000000-0000-4000-8000-000000000b02', 'view'),
  ('00000000-0000-4000-8000-000000000907', null, '00000000-0000-4000-8000-000000000b02', 'comment'),
  ('00000000-0000-4000-8000-000000000908', null, '00000000-0000-4000-8000-000000000b02', 'edit'),
  ('00000000-0000-4000-8000-000000000909', null, '00000000-0000-4000-8000-000000000b02', 'edit_pages'),
  ('00000000-0000-4000-8000-00000000090a', null, '00000000-0000-4000-8000-000000000b02', 'edit_pages'),
  ('00000000-0000-4000-8000-00000000090a', null, '00000000-0000-4000-8000-000000000b04', 'edit_pages'),
  ('00000000-0000-4000-8000-00000000090b', '00000000-0000-4000-8000-000000000a01', null, 'edit_pages'),
  ('00000000-0000-4000-8000-00000000090c', null, '00000000-0000-4000-8000-000000000b01', 'edit')
) v (u, p, pg, l);

-- Lo que puede hacer la sesión en una página con un nivel: ver y bajar el contenido (1), subir contenido,
-- cambiar el título e imágenes (3), crear adentro y mandarla a la papelera y volverla (4). Todas las
-- escrituras se deshacen al final.
create function pg_temp.check_level(who text, ws uuid, p uuid, lvl int) returns void language plpgsql as $$
declare
  n int;
begin
  assert private.page_level(p) = lvl,
    format('%s: page_level de %s da %s y no %s', who, p, private.page_level(p), lvl);
  select count(*) into n from public.pages where id = p;
  assert n = (lvl >= 1)::int, format('%s: ver la página %s (nivel %s)', who, p, lvl);
  if lvl >= 1 then
    perform public.pull_page_updates(p, 0);
  else
    perform pg_temp.expect_error(format('select public.pull_page_updates(%L, 0)', p), 'page_not_found',
      who || ': baja contenido sin permiso');
  end if;

  begin
    if lvl >= 3 then
      perform public.push_page_update(p, gen_random_uuid(), 'AQAAAA==', '9.999');
      update public.pages set title = title || ' ~', icon = 'x', settings = '{"a": 1}' where id = p;
      get diagnostics n = row_count;
      assert n = 1, format('%s: no edita el título de %s', who, p);
      insert into storage.objects (bucket_id, name) values ('page-files', p || '/' || gen_random_uuid() || '.png');
    else
      perform pg_temp.expect_error(
        format('select public.push_page_update(%L, gen_random_uuid(), %L, %L)', p, 'AQAAAA==', '9.999'),
        'page_not_found', who || ': sube contenido sin editar');
      update public.pages set title = 'x' where id = p;
      get diagnostics n = row_count;
      assert n = 0, format('%s: cambia el título de %s sin editar', who, p);
      perform pg_temp.expect_error(
        format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'page-files', p || '/x.png'),
        '42501', who || ': sube una imagen sin editar');
    end if;

    if lvl >= 4 then
      insert into public.pages (id, workspace_id, parent_id, title, sort_key)
      values (gen_random_uuid(), ws, p, 'nueva', 'zz');
      update public.pages set deleted_at = now() where id = p;
      get diagnostics n = row_count;
      assert n = 1, format('%s: no manda %s a la papelera', who, p);
      update public.pages set deleted_at = null where id = p;
      get diagnostics n = row_count;
      assert n = 1, format('%s: no restaura %s', who, p);
    else
      perform pg_temp.expect_error(
        format('insert into public.pages (id, workspace_id, parent_id, title, sort_key) values (gen_random_uuid(), %L, %L, %L, %L)',
               ws, p, 'x', 'zz'),
        'page_create_denied', who || ': crea una página adentro sin editar y crear');
      if lvl = 3 then
        perform pg_temp.expect_error(format('update public.pages set deleted_at = now() where id = %L', p),
          'page_trash_denied', who || ': manda a la papelera sin editar y crear');
      else
        update public.pages set deleted_at = now() where id = p;
        get diagnostics n = row_count;
        assert n = 0, format('%s: manda %s a la papelera sin permiso', who, p);
      end if;
    end if;
    raise sqlstate 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
end;
$$;

-- Los proyectos que ve la sesión, en orden de id.
create function pg_temp.projects() returns uuid[] language sql as $$
  select coalesce(array_agg(id order by id), '{}') from public.workspaces;
$$;

-- Cuántas filas hay (como la base), para ver después que sacar a alguien no borra nada.
select set_config('role', 'postgres', true);
select set_config('test.n', json_build_object(
  'members', (select count(*) from public.members), 'grants', (select count(*) from public.grants),
  'pages', (select count(*) from public.pages), 'projects', (select count(*) from public.workspaces),
  'updates', (select count(*) from public.page_updates),
  'objects', (select count(*) from storage.objects where bucket_id = 'page-files'))::text, true);

-- ---------------------------------------------------------------------------------------------------
-- Permisos sobre páginas: cada nivel, hacia abajo sí y hacia arriba no, gana el más alto
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-000000000906');
do $$
declare
  p1 constant uuid := '00000000-0000-4000-8000-000000000a01';
begin
  perform pg_temp.check_level('ver', p1, '00000000-0000-4000-8000-000000000b02', 1);
  perform pg_temp.check_level('ver', p1, '00000000-0000-4000-8000-000000000b03', 1);  -- baja a g
  perform pg_temp.check_level('ver', p1, '00000000-0000-4000-8000-000000000b01', 0);  -- no sube a r
  perform pg_temp.check_level('ver', p1, '00000000-0000-4000-8000-000000000b04', 0);  -- ni pasa a s
  assert (select count(*) from storage.objects where bucket_id = 'page-files') = 1, 'ver: no ve la imagen de c';
  assert (select count(*) from public.page_updates) = 2, 'ver: no ve el contenido de c y g, o ve el de r';
  -- Ve el proyecto (para su nombre), pero no tiene permiso sobre él.
  assert pg_temp.projects() = array[p1], 'ver: no ve el nombre del proyecto de su página';
  assert private.project_level(p1) = 0, 'ver: un permiso sobre una página sube al proyecto';
  assert public.ensure_workspace() = p1, 'ver: ensure_workspace no da el proyecto de su página';
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-000000000907');
do $$
begin
  perform pg_temp.check_level('comentar', '00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-000000000b02', 2);
  perform pg_temp.check_level('comentar', '00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-000000000b03', 2);
  perform pg_temp.check_level('comentar', '00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-000000000b01', 0);
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-000000000908');
do $$
begin
  perform pg_temp.check_level('editar', '00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-000000000b02', 3);
  perform pg_temp.check_level('editar', '00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-000000000b03', 3);
  perform pg_temp.check_level('editar', '00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-000000000b01', 0);
  -- Editar no mueve.
  perform pg_temp.expect_error($q$update public.pages set sort_key = 'b0' where id = '00000000-0000-4000-8000-000000000b03'$q$,
    'page_move_denied', 'editar: reordena una página');
  -- Archivos: registra en lo que edita.
  perform public.register_file('00000000-0000-4000-8000-000000000f02', '00000000-0000-4000-8000-000000000b03',
    'x.jpg', 'image/jpeg', 10, null, null, null);
  assert private.file_level('00000000-0000-4000-8000-000000000f02') = 3, 'editar: file_level';
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-000000000907');
do $$
begin
  assert private.file_level('00000000-0000-4000-8000-000000000f02') = 2, 'comentar: file_level';
  assert (select count(*) from public.files) = 1, 'comentar: no ve el archivo de g';
  perform pg_temp.expect_error(
    $q$select public.register_file(gen_random_uuid(), '00000000-0000-4000-8000-000000000b03', 'y.jpg', 'image/jpeg', 1, null, null, null)$q$,
    'page_not_found', 'comentar: registra un archivo');
end;
$$;

-- Editar y crear páginas sobre c: crea adentro (también con upsert, como la app, y reintentando), mueve y
-- manda a la papelera adentro, pero no crea raíces ni mueve fuera de su rama.
select pg_temp.as_user('00000000-0000-4000-8000-000000000909');
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  ('00000000-0000-4000-8000-000000000b10', '00000000-0000-4000-8000-000000000a01',
   '00000000-0000-4000-8000-000000000b03', 'nieta', 'a0')
on conflict (id) do nothing returning id;
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  ('00000000-0000-4000-8000-000000000b10', '00000000-0000-4000-8000-000000000a01',
   '00000000-0000-4000-8000-000000000b03', 'nieta', 'a0')
on conflict (id) do nothing returning id;
do $$
declare
  p1 constant uuid := '00000000-0000-4000-8000-000000000a01';
  r  constant uuid := '00000000-0000-4000-8000-000000000b01';
  c  constant uuid := '00000000-0000-4000-8000-000000000b02';
  g  constant uuid := '00000000-0000-4000-8000-000000000b03';
  s  constant uuid := '00000000-0000-4000-8000-000000000b04';
  n  int;
begin
  perform pg_temp.check_level('editar y crear', p1, c, 4);
  perform pg_temp.check_level('editar y crear', p1, g, 4);
  perform pg_temp.check_level('editar y crear', p1, r, 0);
  assert (select count(*) from public.pages where id = '00000000-0000-4000-8000-000000000b10') = 1,
    'editar y crear: no ve la página que creó';
  perform pg_temp.expect_error(
    format('insert into public.pages (id, workspace_id, title, sort_key) values (gen_random_uuid(), %L, %L, %L)', p1, 'raíz', 'zz'),
    'page_create_denied', 'editar y crear en una página: crea una raíz');
  -- Mover: en la página y en el destino.
  update public.pages set sort_key = 'a5' where id = g;
  get diagnostics n = row_count;
  assert n = 1, 'editar y crear: no reordena adentro de su rama';
  update public.pages set parent_id = c where id = '00000000-0000-4000-8000-000000000b10';
  perform pg_temp.expect_error(format('update public.pages set parent_id = %L where id = %L', s, g),
    'page_move_denied', 'mueve a una rama sin permiso en el destino');
  perform pg_temp.expect_error(format('update public.pages set parent_id = null where id = %L', g),
    'page_move_denied', 'mueve a la raíz sin permiso en el proyecto');
  perform pg_temp.expect_error(format('update public.pages set sort_key = %L where id = %L', 'zz', c),
    'page_move_denied', 'reordena c sin permiso en r (el orden es del padre)');
  assert (select parent_id from public.pages where id = g) = c, 'g se movió';
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-00000000090a');
do $$
declare
  r constant uuid := '00000000-0000-4000-8000-000000000b01';
  c constant uuid := '00000000-0000-4000-8000-000000000b02';
  g constant uuid := '00000000-0000-4000-8000-000000000b03';
  s constant uuid := '00000000-0000-4000-8000-000000000b04';
  d constant uuid := '00000000-0000-4000-8000-000000000b05';
begin
  -- Con permiso en las dos ramas, mueve de una a la otra y vuelve.
  update public.pages set parent_id = s where id = g;
  assert (select parent_id from public.pages where id = g) = s, 'no movió g a s';
  update public.pages set parent_id = d where id = g;
  update public.pages set parent_id = c where id = d;
  update public.pages set parent_id = s where id = d;
  update public.pages set parent_id = c where id = g;
  perform pg_temp.expect_error(format('update public.pages set parent_id = %L where id = %L', r, g),
    'page_move_denied', 'mueve a una página sin permiso');
  perform pg_temp.expect_error(format('update public.pages set parent_id = %L where id = %L', g, c),
    '23514', 'se arma un ciclo');
end;
$$;

-- Editar y crear sobre el proyecto: todo P1, raíces incluidas, y lo renombra.
select pg_temp.as_user('00000000-0000-4000-8000-00000000090b');
do $$
declare
  p1 constant uuid := '00000000-0000-4000-8000-000000000a01';
  c  constant uuid := '00000000-0000-4000-8000-000000000b02';
  n  int;
begin
  perform pg_temp.check_level('proyecto', p1, '00000000-0000-4000-8000-000000000b01', 4);
  perform pg_temp.check_level('proyecto', p1, '00000000-0000-4000-8000-000000000b05', 4);
  assert private.project_level(p1) = 4, 'editar y crear sobre P1';
  update public.pages set parent_id = null, sort_key = 'a9' where id = c;
  update public.pages set parent_id = '00000000-0000-4000-8000-000000000b01', sort_key = 'a0' where id = c;
  insert into public.pages (id, workspace_id, title, sort_key) values (gen_random_uuid(), p1, 'raíz de pe', 'b0');
  update public.workspaces set name = 'P1 renombrado' where id = p1;
  get diagnostics n = row_count;
  assert n = 1, 'con editar y crear sobre el proyecto no lo renombra';
  update public.workspaces set name = 'P1' where id = p1;
  perform pg_temp.expect_error(format('update public.workspaces set owner_id = auth.uid() where id = %L', p1),
    '42501', 'cambia el dueño de un proyecto desde la API');
end;
$$;

-- Miembro con comentar en P1 y editar en c: gana el más alto en cada página.
select pg_temp.as_user('00000000-0000-4000-8000-000000000904');
do $$
declare
  p1 constant uuid := '00000000-0000-4000-8000-000000000a01';
  n  int;
begin
  perform pg_temp.check_level('miembro', p1, '00000000-0000-4000-8000-000000000b01', 2);
  perform pg_temp.check_level('miembro', p1, '00000000-0000-4000-8000-000000000b02', 3);
  perform pg_temp.check_level('miembro', p1, '00000000-0000-4000-8000-000000000b03', 3);
  perform pg_temp.check_level('miembro', p1, '00000000-0000-4000-8000-000000000b05', 2);
  assert private.project_level(p1) = 2, 'miembro: comentar en P1';
  assert pg_temp.projects() = array[p1, '00000000-0000-4000-8000-000000000a03'::uuid],
    'miembro: no ve exactamente P1 y PS';
  -- Con permisos sobre dos proyectos, ensure_workspace da el más viejo (PS).
  assert public.ensure_workspace() = '00000000-0000-4000-8000-000000000a03', 'miembro: ensure_workspace';
  update public.workspaces set name = 'no' where id = p1;
  get diagnostics n = row_count;
  assert n = 0, 'miembro: renombra un proyecto donde comenta';
  perform pg_temp.expect_error($q$insert into public.workspaces (id, name) values (gen_random_uuid(), 'No')$q$,
    '42501', 'un miembro crea un proyecto');
end;
$$;

-- Invitada: solo la página d de P1 y el proyecto PS2 entero.
select pg_temp.as_user('00000000-0000-4000-8000-000000000905');
do $$
declare
  p1 constant uuid := '00000000-0000-4000-8000-000000000a01';
begin
  perform pg_temp.check_level('invitada', p1, '00000000-0000-4000-8000-000000000b05', 1);
  perform pg_temp.check_level('invitada', p1, '00000000-0000-4000-8000-000000000b04', 0);
  assert (select array_agg(id order by id) from public.pages)
         = array['00000000-0000-4000-8000-000000000b05', '00000000-0000-4000-8000-000000000b08']::uuid[],
    'invitada: no ve exactamente d y la página de PS2';
  assert pg_temp.projects() = array[p1, '00000000-0000-4000-8000-000000000a05'::uuid], 'invitada: proyectos';
  -- El permiso sobre un proyecto va antes que el de una página.
  assert public.ensure_workspace() = '00000000-0000-4000-8000-000000000a05', 'invitada: ensure_workspace';
  perform pg_temp.expect_error($q$insert into public.workspaces (id, name) values (gen_random_uuid(), 'No')$q$,
    '42501', 'una invitada crea un proyecto');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Roles y proyectos privados
-- ---------------------------------------------------------------------------------------------------
-- La dueña: todo P1, nada de los proyectos privados de otros (PA de la admin, PP, PS y PS2 de lv).
select pg_temp.as_user('00000000-0000-4000-8000-000000000901');
do $$
declare
  p1 constant uuid := '00000000-0000-4000-8000-000000000a01';
  pg uuid;
begin
  assert pg_temp.projects() = array[p1, '00000000-0000-4000-8000-000000000a06'::uuid],
    'la dueña ve proyectos privados de otros (o no ve PS3, donde le compartieron una página)';
  assert private.project_level('00000000-0000-4000-8000-000000000a02') = 0, 'la dueña tiene permiso sobre PA';
  assert (select count(*) from public.pages where workspace_id not in (p1, '00000000-0000-4000-8000-000000000a06')) = 0,
    'la dueña ve páginas de otros';
  perform pg_temp.check_level('dueña', '00000000-0000-4000-8000-000000000a06', '00000000-0000-4000-8000-000000000b0b', 1);
  perform pg_temp.expect_error($q$select public.pull_page_updates('00000000-0000-4000-8000-000000000b09', 0)$q$,
    'page_not_found', 'la dueña baja contenido de un proyecto privado ajeno');
  for pg in select id from public.pages where workspace_id = p1 loop
    perform pg_temp.check_level('dueña', p1, pg, 4);
  end loop;
  assert public.ensure_workspace() = p1, 'la dueña: ensure_workspace';
  assert (public.media_whoami() ->> 'is_owner')::boolean, 'la dueña no figura como dueña';
end;
$$;

-- La admin: crea proyectos (privados: solo ella), no ve los de otros.
select pg_temp.as_user('00000000-0000-4000-8000-000000000902');
do $$
declare
  pa constant uuid := '00000000-0000-4000-8000-000000000a02';
  n  int;
begin
  assert pg_temp.projects() = array[pa], 'la admin no ve solo su proyecto';
  assert private.page_level('00000000-0000-4000-8000-000000000b01') = 0, 'la admin tiene permiso sobre P1';
  perform pg_temp.check_level('admin', pa, '00000000-0000-4000-8000-000000000b09', 4);
  assert public.ensure_workspace() = pa, 'la admin: ensure_workspace';
  update public.workspaces set name = 'PA2' where id = pa;
  get diagnostics n = row_count;
  assert n = 1, 'la admin no renombra su proyecto';
  update public.workspaces set name = 'Robado' where id = '00000000-0000-4000-8000-000000000a01';
  get diagnostics n = row_count;
  assert n = 0, 'la admin renombra un proyecto ajeno';
end;
$$;

-- La otra admin ve PS por su permiso (editar) sobre el proyecto.
select pg_temp.as_user('00000000-0000-4000-8000-000000000903');
do $$
begin
  assert pg_temp.projects() = array['00000000-0000-4000-8000-000000000a03'::uuid], 'ad2: proyectos';
  assert public.ensure_workspace() = '00000000-0000-4000-8000-000000000a03', 'ad2: ensure_workspace';
  perform pg_temp.check_level('ad2', '00000000-0000-4000-8000-000000000a03', '00000000-0000-4000-8000-000000000b06', 3);
end;
$$;

-- lv (miembro con proyectos propios): tiene todo lo suyo, pero ya no crea proyectos.
select pg_temp.as_user('00000000-0000-4000-8000-00000000090c');
do $$
begin
  assert pg_temp.projects() = array['00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-000000000a03',
                                    '00000000-0000-4000-8000-000000000a04', '00000000-0000-4000-8000-000000000a05',
                                    '00000000-0000-4000-8000-000000000a06']::uuid[],
    'lv: proyectos';
  assert public.ensure_workspace() = '00000000-0000-4000-8000-000000000a04', 'lv: ensure_workspace no da el propio más viejo';
  perform pg_temp.check_level('lv', '00000000-0000-4000-8000-000000000a04', '00000000-0000-4000-8000-000000000b07', 4);
  perform pg_temp.check_level('lv', '00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-000000000b01', 3);
  perform pg_temp.expect_error($q$insert into public.workspaces (id, name) values (gen_random_uuid(), 'No')$q$,
    '42501', 'un miembro con proyectos crea otro');
end;
$$;

-- Sin membresía: nada, aunque tenga un permiso.
select set_config('role', 'postgres', true);
insert into public.grants (user_id, project_id, level)
values ('00000000-0000-4000-8000-00000000090d', '00000000-0000-4000-8000-000000000a01', 'edit_pages');
select pg_temp.as_user('00000000-0000-4000-8000-00000000090d');
do $$
begin
  assert pg_temp.projects() = '{}', 'sin membresía ve proyectos';
  assert (select count(*) from public.pages) = 0, 'sin membresía ve páginas';
  assert public.ensure_workspace() is null, 'sin membresía: ensure_workspace';
  perform pg_temp.check_level('sin membresía', '00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-000000000b01', 0);
end;
$$;
select set_config('role', 'postgres', true);
delete from public.grants where user_id = '00000000-0000-4000-8000-00000000090d';

-- ---------------------------------------------------------------------------------------------------
-- Invitaciones
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-000000000902');
do $$
declare
  pa constant uuid := '00000000-0000-4000-8000-000000000a02';
  i  uuid;
begin
  i := public.create_invitation('  Nuevo@Test.Invalid ', 'guest',
    jsonb_build_array(jsonb_build_object('page_id', '00000000-0000-4000-8000-000000000b09', 'level', 'comment')));
  perform set_config('test.inv', i::text, true);
  assert (select email from public.invitations where id = i) = 'nuevo@test.invalid', 'el correo no queda en minúsculas';
  assert (select invited_by from public.invitations where id = i) = auth.uid(), 'invited_by';

  perform pg_temp.expect_error($q$select public.create_invitation('otro-admin@test.invalid', 'admin', '[]')$q$,
    'not_allowed', 'una admin invita a una admin');
  perform pg_temp.expect_error($q$select public.create_invitation('x@test.invalid', 'owner', '[]')$q$,
    'role_invalid', 'se invita a alguien como dueño');
  perform pg_temp.expect_error($q$select public.create_invitation('sin-arroba', 'guest', '[]')$q$,
    'email_invalid', 'un correo inválido');
  perform pg_temp.expect_error($q$select public.create_invitation('x@test.invalid', 'guest', '{}')$q$,
    'grants_invalid', 'permisos que no son una lista');
  perform pg_temp.expect_error(
    $q$select public.create_invitation('x@test.invalid', 'guest', '[{"page_id": "00000000-0000-4000-8000-000000000b02", "level": "view"}]')$q$,
    'grant_not_allowed', 'la admin comparte una página donde no tiene 4');
  perform pg_temp.expect_error(
    $q$select public.create_invitation('x@test.invalid', 'guest', '[{"project_id": "00000000-0000-4000-8000-000000000a01", "level": "view"}]')$q$,
    'grant_not_allowed', 'la admin comparte un proyecto ajeno');
  perform pg_temp.expect_error(
    format('select public.create_invitation(%L, %L, %L)', 'x@test.invalid', 'guest',
           jsonb_build_array(jsonb_build_object('page_id', gen_random_uuid(), 'level', 'view'))),
    'grant_not_allowed', 'un permiso sobre una página que no existe');

  -- Invitar a quien ya es miembro (con un rol más alto) y a la dueña.
  perform public.create_invitation('eq-ad2@test.invalid', 'guest',
    jsonb_build_array(jsonb_build_object('page_id', '00000000-0000-4000-8000-000000000b09', 'level', 'view')));
  perform public.create_invitation('eq-ow@test.invalid', 'member', '[]');
end;
$$;

-- Quien la hizo suma a su invitación viva del mismo correo: rol más alto y permisos (gana el más alto).
do $$
declare
  i uuid;
begin
  i := public.create_invitation('nuevo@test.invalid', 'member', jsonb_build_array(
    jsonb_build_object('page_id', '00000000-0000-4000-8000-000000000b09', 'level', 'edit'),
    jsonb_build_object('project_id', '00000000-0000-4000-8000-000000000a02', 'level', 'view')));
  assert i = current_setting('test.inv')::uuid, 'invitar de nuevo al mismo correo no suma a la invitación viva';
  assert (select count(*) from public.invitations where email = 'nuevo@test.invalid') = 1, 'dos invitaciones';
  assert (select role from public.invitations where id = i) = 'member', 'no queda el rol más alto';
  assert (select jsonb_array_length(grants) from public.invitations where id = i) = 2, 'los permisos no se juntan';
  assert (select g ->> 'level' from public.invitations, jsonb_array_elements(grants) g
          where id = i and g ->> 'page_id' = '00000000-0000-4000-8000-000000000b09') = 'edit',
    'en la misma página no gana el más alto';
  assert (select invited_by from public.invitations where id = i) = auth.uid(), 'invited_by cambió';
end;
$$;

-- La dueña no suma ni sube el rol de una invitación ajena; sí invita admins.
select pg_temp.as_user('00000000-0000-4000-8000-000000000901');
do $$
begin
  perform pg_temp.expect_error($q$select public.create_invitation('nuevo@test.invalid', 'admin', '[]')$q$,
    'invitation_exists', 'la dueña cambia la invitación de otra persona');
  assert (select role from public.invitations where email = 'nuevo@test.invalid') = 'member',
    'una invitación ajena cambió de rol';
  perform public.create_invitation('nuevo-admin@test.invalid', 'admin', '[]');
  perform public.create_invitation('eq-sv@test.invalid', 'guest', '[]');
  perform public.create_invitation('eq-lv@test.invalid', 'guest',
    jsonb_build_array(jsonb_build_object('page_id', '00000000-0000-4000-8000-000000000b05', 'level', 'view')));
end;
$$;

-- Nadie más invita.
select pg_temp.as_user('00000000-0000-4000-8000-000000000909');
do $$
begin
  perform pg_temp.expect_error($q$select public.create_invitation('x@test.invalid', 'guest', '[]')$q$,
    'not_allowed', 'un miembro invita');
end;
$$;

-- Una vencida y una de una admin ya sacada no están vivas.
select set_config('role', 'postgres', true);
insert into public.invitations (email, role, invited_by, expires_at) values
  ('vencida@test.invalid', 'guest', '00000000-0000-4000-8000-000000000901', now() - interval '1 minute');
insert into public.invitations (email, role, invited_by) values
  ('de-sacada@test.invalid', 'guest', '00000000-0000-4000-8000-000000000910');

-- El evento que manda Supabase Auth (documentación del hook "Before User Created").
create function pg_temp.hook_event(email text) returns jsonb language sql as $$
  select jsonb_build_object(
    'metadata', jsonb_build_object('uuid', gen_random_uuid(), 'time', now(), 'name', 'before-user-created',
                                   'ip_address', '127.0.0.1'),
    'user', jsonb_build_object('id', gen_random_uuid(), 'aud', 'authenticated', 'role', '', 'email', email,
                               'phone', '', 'app_metadata', jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
                               'user_metadata', '{}'::jsonb, 'identities', '[]'::jsonb,
                               'created_at', '0001-01-01T00:00:00Z', 'updated_at', '0001-01-01T00:00:00Z',
                               'is_anonymous', false));
$$;

create function pg_temp.check_rejected(r jsonb, what text) returns void language plpgsql as $$
begin
  assert (select array_agg(k) from jsonb_object_keys(r) k) = array['error'], format('%s: no es solo un error: %s', what, r);
  assert (select array_agg(k order by k) from jsonb_object_keys(r -> 'error') k) = array['http_code', 'message'],
    format('%s: el error no tiene http_code y message: %s', what, r);
  assert r -> 'error' -> 'http_code' = '403'::jsonb, format('%s: http_code no es 403: %s', what, r);
  assert r -> 'error' ->> 'message' like 'Signups not allowed%', format('%s: mensaje: %s', what, r);
end;
$$;

create function pg_temp.check_error_shape(r jsonb, what text) returns void language plpgsql as $$
begin
  assert (select array_agg(k) from jsonb_object_keys(r) k) = array['error'], format('%s: no es solo un error: %s', what, r);
  assert (select array_agg(k order by k) from jsonb_object_keys(r -> 'error') k) = array['http_code', 'message']
     and r -> 'error' -> 'http_code' = '403'::jsonb, format('%s: forma del error: %s', what, r);
end;
$$;

do $$
declare
  hook constant regprocedure := 'private.hook_before_user_created(jsonb)';
begin
  assert private.hook_before_user_created(pg_temp.hook_event('nuevo@test.invalid')) = '{}'::jsonb, 'el hook rechaza a un invitado';
  assert private.hook_before_user_created(pg_temp.hook_event('NUEVO@test.invalid')) = '{}'::jsonb, 'el hook distingue mayúsculas';
  assert private.hook_before_user_created(pg_temp.hook_event('nuevo-admin@test.invalid')) = '{}'::jsonb, 'el hook rechaza a una admin invitada';
  perform pg_temp.check_rejected(private.hook_before_user_created(pg_temp.hook_event('otro@test.invalid')), 'sin invitación');
  perform pg_temp.check_rejected(private.hook_before_user_created(pg_temp.hook_event('vencida@test.invalid')), 'vencida');
  perform pg_temp.check_rejected(private.hook_before_user_created(pg_temp.hook_event('de-sacada@test.invalid')), 'de una admin sacada');
  perform pg_temp.check_rejected(private.hook_before_user_created(pg_temp.hook_event('')), 'sin correo (teléfono o anónimo)');
  perform pg_temp.check_rejected(private.hook_before_user_created(
    pg_temp.hook_event('nuevo@test.invalid') #- '{user,email}'), 'sin el campo email');
  perform pg_temp.check_rejected(private.hook_before_user_created('{}'::jsonb), 'un evento vacío');

  -- Permisos: la ejecuta solo supabase_auth_admin (además del dueño), que no puede nada más.
  assert (select prosecdef from pg_proc where oid = hook), 'el hook no corre como definer';
  assert has_function_privilege('supabase_auth_admin', hook, 'execute'), 'supabase_auth_admin no ejecuta el hook';
  assert has_schema_privilege('supabase_auth_admin', 'private', 'usage'), 'supabase_auth_admin no usa private';
  assert not has_function_privilege('authenticated', hook, 'execute'), 'authenticated ejecuta el hook';
  assert not has_function_privilege('anon', hook, 'execute'), 'anon ejecuta el hook';
  assert not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = hook and a.grantee = 0),
    'public ejecuta el hook';
  assert (select count(*) from pg_proc p
          where p.pronamespace = 'private'::regnamespace
            and has_function_privilege('supabase_auth_admin', p.oid, 'execute')) = 2,
    'supabase_auth_admin ejecuta otras funciones de private (además de los dos hooks)';
  assert has_function_privilege('supabase_auth_admin', 'private.hook_custom_access_token(jsonb)', 'execute')
     and not has_function_privilege('authenticated', 'private.hook_custom_access_token(jsonb)', 'execute')
     and not has_function_privilege('anon', 'private.hook_custom_access_token(jsonb)', 'execute'),
    'permisos del hook de token';
  assert not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                     where p.oid = 'private.hook_custom_access_token(jsonb)'::regprocedure and a.grantee = 0),
    'public ejecuta el hook de token';
  assert (select count(*) from information_schema.role_table_grants where grantee = 'supabase_auth_admin'
          and table_schema in ('public', 'private')) = 0, 'supabase_auth_admin tiene permisos sobre tablas de la app';
  assert not has_table_privilege('supabase_auth_admin', 'public.invitations', 'select')
     and not has_table_privilege('supabase_auth_admin', 'public.members', 'select')
     and not has_table_privilege('supabase_auth_admin', 'public.grants', 'select'),
    'supabase_auth_admin lee las tablas del equipo';
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-000000000904');
do $$
begin
  perform pg_temp.expect_error($q$select private.hook_before_user_created('{}'::jsonb)$q$, '42501',
    'authenticated llama al hook');
end;
$$;

-- Entra nu (el hook lo dejó pasar): antes de aceptar no es miembro ni ve nada.
select set_config('role', 'postgres', true);
insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('00000000-0000-4000-8000-00000000090e', 'nuevo@test.invalid', 'authenticated', 'authenticated', now());

select pg_temp.as_user('00000000-0000-4000-8000-00000000090e');
do $$
declare
  p1 constant uuid := '00000000-0000-4000-8000-000000000a01';
begin
  assert private.workspace_role() is null and pg_temp.projects() = '{}' and public.ensure_workspace() is null,
    'nu ve algo antes de aceptar';
  assert public.accept_invitations() = 1, 'accept_invitations no aplica la invitación';
  assert public.accept_invitations() = 0, 'accept_invitations aplica dos veces';
  assert private.workspace_role() = 'member', 'nu no queda con el rol de la invitación';
  assert (select count(*) from public.list_members()) = 1, 'nu ve otros miembros';
  perform pg_temp.check_level('nu', '00000000-0000-4000-8000-000000000a02', '00000000-0000-4000-8000-000000000b09', 3);
  assert private.project_level('00000000-0000-4000-8000-000000000a02') = 1, 'nu no recibe ver PA';
  perform pg_temp.check_level('nu', p1, '00000000-0000-4000-8000-000000000b02', 0);
  assert public.ensure_workspace() = '00000000-0000-4000-8000-000000000a02', 'nu: ensure_workspace';
end;
$$;

select set_config('role', 'postgres', true);
do $$
begin
  assert (select used_at is not null and used_by = '00000000-0000-4000-8000-00000000090e'
          from public.invitations where email = 'nuevo@test.invalid'), 'la invitación no queda usada';
  assert (select added_by from public.members where user_id = '00000000-0000-4000-8000-00000000090e')
         = '00000000-0000-4000-8000-000000000902', 'added_by no es quien invitó';
end;
$$;
do $$
begin
  perform pg_temp.check_rejected(private.hook_before_user_created(pg_temp.hook_event('nuevo@test.invalid')),
    'una invitación ya usada');
end;
$$;

-- Quien ya tiene un rol más alto no baja, y la dueña nunca cambia; suman los permisos.
select pg_temp.as_user('00000000-0000-4000-8000-000000000903');
do $$
begin
  assert public.accept_invitations() = 1, 'ad2 no acepta';
  assert private.workspace_role() = 'admin', 'aceptar una invitación de invitada le bajó el rol a una admin';
  assert private.page_level('00000000-0000-4000-8000-000000000b09') = 1, 'ad2 no suma el permiso';
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-000000000901');
do $$
begin
  assert public.accept_invitations() = 1, 'la dueña no acepta';
  assert private.workspace_role() = 'owner', 'la dueña cambió de rol';
end;
$$;

-- Un correo sin verificar no aplica nada.
select pg_temp.as_user('00000000-0000-4000-8000-00000000090f');
do $$
begin
  assert public.accept_invitations() = 0, 'aplica invitaciones con el correo sin verificar';
  assert private.workspace_role() is null, 'un correo sin verificar queda como miembro';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Miembros: lista y roles
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-000000000902');
do $$
declare
  me constant uuid := '00000000-0000-4000-8000-000000000904';
begin
  assert (select count(*) from public.list_members()) = (select count(*) from public.members),
    'la admin no ve todos los miembros';
  assert (select email from public.list_members() where user_id = me) = 'eq-me@test.invalid', 'list_members: correo';
  assert (select removed_at is not null from public.list_members() where user_id = '00000000-0000-4000-8000-000000000910'),
    'list_members no muestra a los sacados';
  perform public.set_member_role(me, 'guest');
  assert (select role from public.list_members() where user_id = me) = 'guest', 'set_member_role no cambia';
  perform public.set_member_role(me, 'member');
  perform pg_temp.expect_error(format('select public.set_member_role(%L, %L)', me, 'admin'),
    'not_allowed', 'una admin nombra admins');
  perform pg_temp.expect_error($q$select public.set_member_role('00000000-0000-4000-8000-000000000903', 'member')$q$,
    'not_allowed', 'una admin cambia a otra admin');
  perform pg_temp.expect_error($q$select public.set_member_role('00000000-0000-4000-8000-000000000901', 'member')$q$,
    'owner_cannot_change', 'una admin cambia a la dueña');
  perform pg_temp.expect_error(format('select public.set_member_role(%L, %L)', me, 'owner'),
    'role_invalid', 'se da el rol owner');
  perform pg_temp.expect_error($q$select public.set_member_role('00000000-0000-4000-8000-00000000090d', 'member')$q$,
    'member_not_found', 'se cambia el rol de alguien sin membresía');
  perform pg_temp.expect_error($q$select public.set_member_role('00000000-0000-4000-8000-000000000910', 'member')$q$,
    'member_not_found', 'se cambia el rol de alguien sacado');
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-000000000901');
do $$
begin
  perform public.set_member_role('00000000-0000-4000-8000-000000000903', 'member');
  perform public.set_member_role('00000000-0000-4000-8000-000000000903', 'admin');
  assert private.workspace_role('00000000-0000-4000-8000-000000000903') = 'admin', 'la dueña no maneja admins';
  perform pg_temp.expect_error($q$select public.set_member_role('00000000-0000-4000-8000-000000000901', 'admin')$q$,
    'owner_cannot_change', 'la dueña se cambia el rol');
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-000000000904');
do $$
begin
  assert (select array_agg(user_id) from public.list_members()) = array['00000000-0000-4000-8000-000000000904'::uuid],
    'un miembro ve a los demás';
  perform pg_temp.expect_error($q$select public.set_member_role('00000000-0000-4000-8000-000000000905', 'member')$q$,
    'not_allowed', 'un miembro cambia roles');
  perform pg_temp.expect_error($q$select public.remove_member('00000000-0000-4000-8000-000000000905')$q$,
    'not_allowed', 'un miembro saca gente');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Compartir
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-000000000902');
do $$
declare
  me constant uuid := '00000000-0000-4000-8000-000000000904';
  pa constant uuid := '00000000-0000-4000-8000-000000000a02';
  g1 uuid;
  g2 uuid;
begin
  g1 := public.share(me, pa, null, 'view');
  g2 := public.share(me, pa, null, 'edit');
  assert g1 = g2, 'compartir de nuevo no reemplaza el permiso';
  perform set_config('test.g_me_pa', g1::text, true);
  assert (select level from public.grants where id = g1) = 'edit', 'compartir de nuevo no cambia el nivel';
  assert (select array_agg(source order by source) from public.list_access(pa, null)) = array['creator', 'project', 'project'],
    'list_access del proyecto';
  assert (select level from public.list_access(pa, null) where user_id = me) = 'edit', 'list_access: nivel';
  assert (select email from public.list_access(pa, null) where source = 'creator') = 'eq-ad@test.invalid',
    'list_access: correo de quien creó';
  assert (select array_agg(source order by source) from public.list_access(null, '00000000-0000-4000-8000-000000000b09'))
         = array['creator', 'page', 'page', 'project', 'project'], 'list_access de una página';

  perform pg_temp.expect_error(format('select public.share(%L, %L, null, %L)', me, '00000000-0000-4000-8000-000000000a01', 'view'),
    'not_allowed', 'la admin comparte un proyecto ajeno');
  perform pg_temp.expect_error(format('select public.share(%L, null, null, %L)', me, 'view'),
    'target_invalid', 'compartir sin proyecto ni página');
  perform pg_temp.expect_error(format('select public.share(%L, %L, %L, %L)', me, pa, '00000000-0000-4000-8000-000000000b09', 'view'),
    'target_invalid', 'compartir proyecto y página a la vez');
  perform pg_temp.expect_error(format('select public.share(%L, %L, null, %L)', me, pa, 'owner'),
    'level_invalid', 'un nivel desconocido');
  perform pg_temp.expect_error(format('select public.share(%L, %L, null, %L)', '00000000-0000-4000-8000-00000000090d', pa, 'view'),
    'member_not_found', 'compartir con alguien sin membresía');
  perform pg_temp.expect_error(format('select public.share(%L, %L, null, %L)', '00000000-0000-4000-8000-000000000910', pa, 'view'),
    'member_not_found', 'compartir con alguien sacado');
  perform pg_temp.expect_error(format('select public.list_access(%L, null)', '00000000-0000-4000-8000-000000000a01'),
    'not_allowed', 'list_access de un proyecto ajeno');
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-000000000904');
do $$
declare
  pa constant uuid := '00000000-0000-4000-8000-000000000a02';
begin
  assert pa = any (pg_temp.projects()), 'el miembro no ve el proyecto que le compartieron';
  assert private.page_level('00000000-0000-4000-8000-000000000b09') = 3, 'el miembro no edita pa';
  -- Editar no alcanza para compartir, ni editar y crear sin ser admin o quien creó el proyecto.
  perform pg_temp.expect_error(format('select public.list_access(%L, null)', pa), 'not_allowed', 'un miembro ve el acceso');
  perform pg_temp.expect_error(format('select public.share(%L, %L, null, %L)', '00000000-0000-4000-8000-000000000905', pa, 'view'),
    'not_allowed', 'un miembro comparte');
  perform pg_temp.expect_error(format('select public.unshare(%L)', current_setting('test.g_me_pa')),
    'grant_not_found', 'un miembro saca un permiso');
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-000000000909');
do $$
begin
  perform pg_temp.expect_error(
    $q$select public.share('00000000-0000-4000-8000-000000000905', null, '00000000-0000-4000-8000-000000000b03', 'view')$q$,
    'not_allowed', 'un miembro con editar y crear comparte');
end;
$$;

-- La dueña ve quién tiene acceso a g y por qué (lo de arriba baja; los sacados no cuentan).
select pg_temp.as_user('00000000-0000-4000-8000-000000000901');
do $$
declare
  g constant uuid := '00000000-0000-4000-8000-000000000b03';
begin
  assert (select count(*) from public.list_access(null, g) where source = 'creator') = 1, 'list_access: creator';
  assert (select array_agg(email order by email) from public.list_access(null, g) where source = 'project')
         = array['eq-me@test.invalid', 'eq-pe@test.invalid'], 'list_access: permisos sobre el proyecto';
  assert (select count(*) from public.list_access(null, g) where source = 'parent_page') = 7,
    'list_access: permisos sobre páginas de arriba';
  assert (select level from public.list_access(null, g)
          where email = 'eq-lv@test.invalid' and page_id = '00000000-0000-4000-8000-000000000b01') = 'edit',
    'list_access: el permiso de lv sobre r';
end;
$$;

-- La admin saca el permiso que dio: el miembro deja de ver PA.
select pg_temp.as_user('00000000-0000-4000-8000-000000000902');
do $$
begin
  perform public.unshare(current_setting('test.g_me_pa')::uuid);
  assert (select revoked_at is not null and revoked_by = auth.uid() from public.grants
          where id = current_setting('test.g_me_pa')::uuid), 'unshare no deja el permiso marcado (o lo borró)';
  perform public.unshare(current_setting('test.g_me_pa')::uuid);
  assert (select count(*) from public.list_access('00000000-0000-4000-8000-000000000a02', null)
          where user_id = '00000000-0000-4000-8000-000000000904') = 0, 'list_access muestra un permiso revocado';
  -- Compartir de nuevo lo vuelve a activar (la misma fila), y se vuelve a sacar.
  assert public.share('00000000-0000-4000-8000-000000000904', '00000000-0000-4000-8000-000000000a02', null, 'view')
         = current_setting('test.g_me_pa')::uuid, 'compartir de nuevo crea otra fila';
  assert (select revoked_at is null and level = 'view' from public.grants where id = current_setting('test.g_me_pa')::uuid),
    'compartir de nuevo no vuelve a activar el permiso';
  perform public.unshare(current_setting('test.g_me_pa')::uuid);
  perform pg_temp.expect_error(format('select public.unshare(%L)', gen_random_uuid()), 'grant_not_found', 'unshare de algo que no existe');
  perform pg_temp.expect_error(
    format('select public.unshare(%L)', (select id from public.grants
                                         where user_id = '00000000-0000-4000-8000-00000000090b' limit 1)),
    'grant_not_found', 'la admin saca un permiso de un proyecto ajeno');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-000000000904');
do $$
begin
  assert not ('00000000-0000-4000-8000-000000000a02' = any (pg_temp.projects())), 'el miembro sigue viendo PA';
  assert private.page_level('00000000-0000-4000-8000-000000000b09') = 0, 'el miembro sigue con permiso sobre pa';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Sacar a alguien
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-000000000902');
do $$
declare
  r jsonb;
begin
  perform pg_temp.expect_error($q$select public.remove_member('00000000-0000-4000-8000-000000000903')$q$,
    'not_allowed', 'una admin saca a otra admin');
  perform pg_temp.expect_error($q$select public.remove_member('00000000-0000-4000-8000-000000000901')$q$,
    'owner_cannot_change', 'una admin saca a la dueña');
  perform pg_temp.expect_error($q$select public.remove_member('00000000-0000-4000-8000-00000000090d')$q$,
    'member_not_found', 'sacar a alguien sin membresía');
  -- lv: PS pasa a ad3 (editar y crear sobre el proyecto gana a editar de ad2). PS2 (compartido solo con una
  -- invitada) y PS3 (la dueña solo tiene "ver" sobre una página) quedan sin heredero y se informan. PP
  -- (privado) queda a su nombre y no se informa.
  r := public.remove_member('00000000-0000-4000-8000-00000000090c');
  assert r -> 'transferred' = jsonb_build_array(jsonb_build_object(
           'project_id', '00000000-0000-4000-8000-000000000a03', 'to', '00000000-0000-4000-8000-000000000911')),
    format('remove_member no pasa PS a ad3: %s', r);
  assert r -> 'without_heir' = '["00000000-0000-4000-8000-000000000a05", "00000000-0000-4000-8000-000000000a06"]'::jsonb,
    format('remove_member no informa los proyectos sin heredero: %s', r);
  assert public.remove_member('00000000-0000-4000-8000-00000000090c') = '{"transferred": [], "without_heir": []}'::jsonb,
    'sacar dos veces';
end;
$$;

select set_config('role', 'postgres', true);
do $$
declare
  n json := current_setting('test.n')::json;
begin
  -- Nada se borró (hay más filas por lo que agregó la prueba, nunca menos).
  assert (select count(*) from public.members) = (n ->> 'members')::int + 1, 'se borraron miembros';
  assert (select count(*) from public.pages) = (n ->> 'pages')::int + 2,
    format('se borraron páginas (%s, antes %s)', (select count(*) from public.pages), n ->> 'pages');
  assert (select count(*) from public.workspaces) = (n ->> 'projects')::int, 'se borraron proyectos';
  assert (select count(*) from public.page_updates) >= (n ->> 'updates')::int, 'se borraron updates';
  assert (select count(*) from storage.objects where bucket_id = 'page-files') >= (n ->> 'objects')::int,
    'se borraron imágenes';
  assert (select count(*) from public.grants where user_id = '00000000-0000-4000-8000-00000000090c') = 1,
    'se borraron los permisos de lv';
  assert (select removed_at is not null from public.members where user_id = '00000000-0000-4000-8000-00000000090c'),
    'lv no quedó sacado';
  assert (select owner_id from public.workspaces where id = '00000000-0000-4000-8000-000000000a03')
         = '00000000-0000-4000-8000-000000000911', 'PS no pasó a ad3';
  assert (select owner_id from public.workspaces where id = '00000000-0000-4000-8000-000000000a06')
         = '00000000-0000-4000-8000-00000000090c', 'PS3 pasó a alguien que solo tenía "ver" sobre una página';
  assert (select owner_id from public.workspaces where id = '00000000-0000-4000-8000-000000000a04')
         = '00000000-0000-4000-8000-00000000090c', 'PP cambió de dueño';
  assert (select owner_id from public.workspaces where id = '00000000-0000-4000-8000-000000000a05')
         = '00000000-0000-4000-8000-00000000090c', 'PS2 cambió de dueño sin una admin con permiso';
end;
$$;

-- lv pierde todo al instante y ve la señal (su fila con removed_at).
select pg_temp.as_user('00000000-0000-4000-8000-00000000090c');
do $$
begin
  assert pg_temp.projects() = '{}', 'lv sacado ve proyectos';
  assert (select count(*) from public.pages) = 0, 'lv sacado ve páginas';
  assert (select count(*) from public.page_updates) = 0, 'lv sacado ve contenido';
  assert public.ensure_workspace() is null, 'lv sacado: ensure_workspace';
  assert (select removed_at is not null from public.list_members()), 'lv no ve que lo sacaron';
  assert (select removed_at is not null from public.members), 'lv no ve su fila con removed_at';
  perform pg_temp.check_level('lv sacado', '00000000-0000-4000-8000-000000000a04', '00000000-0000-4000-8000-000000000b07', 0);
  perform pg_temp.check_level('lv sacado', '00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-000000000b01', 0);
  perform pg_temp.expect_error($q$select public.share('00000000-0000-4000-8000-000000000904', '00000000-0000-4000-8000-000000000a04', null, 'view')$q$,
    'not_allowed', 'lv sacado comparte');
end;
$$;

-- El proyecto que pasó: ad3 lo tiene entero; ad2 y me siguen con lo suyo. La dueña sigue viendo la página de
-- PS3 (sin el proyecto). Nadie ve PP; la invitada sigue en PS2.
select pg_temp.as_user('00000000-0000-4000-8000-000000000903');
do $$
begin
  assert private.project_level('00000000-0000-4000-8000-000000000a03') = 3, 'ad2 cambió de permiso sobre PS';
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-000000000901');
do $$
begin
  assert private.project_level('00000000-0000-4000-8000-000000000a06') = 0, 'la dueña heredó PS3';
  assert private.page_level('00000000-0000-4000-8000-000000000b0b') = 1, 'la dueña dejó de ver la página de PS3';
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-000000000911');
do $$
begin
  assert private.project_level('00000000-0000-4000-8000-000000000a03') = 4, 'ad3 no tiene PS entero';
  insert into public.pages (id, workspace_id, title, sort_key)
  values (gen_random_uuid(), '00000000-0000-4000-8000-000000000a03', 'de ad2', 'b0');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-000000000904');
do $$
begin
  assert private.project_level('00000000-0000-4000-8000-000000000a03') = 1, 'me perdió PS';
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-000000000905');
do $$
begin
  assert private.project_level('00000000-0000-4000-8000-000000000a05') = 1, 'la invitada perdió PS2';
end;
$$;

create function pg_temp.nobody_sees_pp() returns void language plpgsql as $$
declare
  u uuid;
begin
  foreach u in array (select array_agg(m.user_id) from public.members m) loop
    perform pg_temp.as_user(u);
    if exists (select 1 from public.workspaces where id = '00000000-0000-4000-8000-000000000a04')
       or exists (select 1 from public.pages where workspace_id = '00000000-0000-4000-8000-000000000a04') then
      raise exception 'FALLA: % ve el proyecto privado de alguien sacado', u;
    end if;
  end loop;
  perform set_config('role', 'postgres', true);
end;
$$;
select set_config('role', 'postgres', true);
select pg_temp.nobody_sees_pp();

-- Si lo invitan de nuevo: vuelve con el rol y los permisos de la invitación, sin los de antes (su permiso
-- sobre r no vuelve). Lo que creó y no pasó a nadie (PP, PS2) vuelve a ser suyo.
select pg_temp.as_user('00000000-0000-4000-8000-00000000090c');
do $$
begin
  assert public.accept_invitations() = 1, 'lv no acepta la invitación nueva';
  assert private.workspace_role() = 'guest', 'lv no vuelve con el rol de la invitación';
  assert private.page_level('00000000-0000-4000-8000-000000000b01') = 0, 'lv recupera el permiso de antes';
  assert private.page_level('00000000-0000-4000-8000-000000000b05') = 1, 'lv no recibe el permiso nuevo';
  assert private.project_level('00000000-0000-4000-8000-000000000a04') = 4, 'lv no recupera su proyecto privado';
  assert private.project_level('00000000-0000-4000-8000-000000000a03') = 0, 'lv recupera el proyecto que pasó a ad3';
end;
$$;
select set_config('role', 'postgres', true);
do $$
begin
  assert (select revoked_at is not null from public.grants
          where user_id = '00000000-0000-4000-8000-00000000090c' and page_id = '00000000-0000-4000-8000-000000000b01'),
    'el permiso viejo de lv no quedó marcado (o se borró)';
  assert (select count(*) from public.grants where user_id = '00000000-0000-4000-8000-00000000090c') = 2,
    'se borraron o duplicaron permisos de lv';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Invitaciones: lista, revocar, y quien invitó ya no tiene 4
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-000000000902');
select set_config('test.inv_rev', public.create_invitation('revocada@test.invalid', 'guest', '[]')::text, true);
select pg_temp.as_user('00000000-0000-4000-8000-000000000901');
select set_config('test.inv_ow', public.create_invitation('de-la-duenia@test.invalid', 'guest', '[]')::text, true);

select pg_temp.as_user('00000000-0000-4000-8000-000000000902');
do $$
declare
  rev constant uuid := current_setting('test.inv_rev')::uuid;
begin
  assert (select count(*) from public.list_invitations()) = (select count(*) from public.invitations i
          where i.used_at is null and i.revoked_at is null and i.expires_at > now()
            and i.invited_by in (select m.user_id from public.members m where m.removed_at is null and m.role in ('owner', 'admin'))),
    'list_invitations no da exactamente las vivas';
  assert (select invited_by_email = 'eq-ad@test.invalid' and role = 'guest' and grants = '[]'::jsonb
                 and expires_at > now() + interval '29 days'
          from public.list_invitations() where id = rev), 'list_invitations: campos';
  assert not exists (select 1 from public.list_invitations() where email = 'vencida@test.invalid' or email = 'nuevo@test.invalid'),
    'list_invitations muestra vencidas o usadas';
  -- La admin no revoca la de la dueña; la suya sí (dos veces no cambia nada).
  perform pg_temp.expect_error(format('select public.revoke_invitation(%L)', current_setting('test.inv_ow')),
    'invitation_not_found', 'una admin revoca una invitación ajena');
  perform public.revoke_invitation(rev);
  perform public.revoke_invitation(rev);
  assert not exists (select 1 from public.list_invitations() where id = rev), 'list_invitations muestra una revocada';
  perform pg_temp.expect_error(format('select public.revoke_invitation(%L)', gen_random_uuid()),
    'invitation_not_found', 'revocar una invitación que no existe');
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-000000000904');
do $$
begin
  assert (select count(*) from public.list_invitations()) = 0, 'un miembro ve invitaciones';
  perform pg_temp.expect_error(format('select public.revoke_invitation(%L)', current_setting('test.inv_ow')),
    'invitation_not_found', 'un miembro revoca');
end;
$$;

-- La dueña revoca la suya y la de otra persona; una usada no se revoca.
select pg_temp.as_user('00000000-0000-4000-8000-000000000901');
do $$
begin
  perform public.revoke_invitation(current_setting('test.inv_ow')::uuid);
  perform pg_temp.expect_error(
    format('select public.revoke_invitation(%L)', (select id from public.invitations where email = 'nuevo@test.invalid')),
    'invitation_used', 'se revoca una invitación usada');
end;
$$;

select set_config('role', 'postgres', true);
do $$
begin
  assert (select revoked_at is not null and revoked_by = '00000000-0000-4000-8000-000000000902'
          from public.invitations where id = current_setting('test.inv_rev')::uuid), 'la revocada no quedó marcada';
  perform pg_temp.check_rejected(private.hook_before_user_created(pg_temp.hook_event('revocada@test.invalid')), 'revocada');
  perform pg_temp.check_rejected(private.hook_before_user_created(pg_temp.hook_event('de-la-duenia@test.invalid')),
    'revocada por la dueña');
end;
$$;
insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('00000000-0000-4000-8000-000000000912', 'revocada@test.invalid', 'authenticated', 'authenticated', now());
select pg_temp.as_user('00000000-0000-4000-8000-000000000912');
do $$
begin
  assert public.accept_invitations() = 0, 'se aplica una invitación revocada';
  assert private.workspace_role() is null, 'una invitación revocada da membresía';
end;
$$;

-- ad2 invita con dos permisos donde tiene 4 (pa y pa2); antes de que se acepte, la admin le baja pa a
-- "ver": al aceptar, ese permiso se saltea y el otro no.
select pg_temp.as_user('00000000-0000-4000-8000-000000000902');
insert into public.pages (id, workspace_id, title, sort_key) values
  ('00000000-0000-4000-8000-000000000b0a', '00000000-0000-4000-8000-000000000a02', 'pa2', 'a1');
select public.share('00000000-0000-4000-8000-000000000903', null, '00000000-0000-4000-8000-000000000b09', 'edit_pages');
select public.share('00000000-0000-4000-8000-000000000903', null, '00000000-0000-4000-8000-000000000b0a', 'edit_pages');
select pg_temp.as_user('00000000-0000-4000-8000-000000000903');
select public.create_invitation('nuevo2@test.invalid', 'guest', jsonb_build_array(
  jsonb_build_object('page_id', '00000000-0000-4000-8000-000000000b09', 'level', 'view'),
  jsonb_build_object('page_id', '00000000-0000-4000-8000-000000000b0a', 'level', 'view')));
select pg_temp.as_user('00000000-0000-4000-8000-000000000902');
select public.share('00000000-0000-4000-8000-000000000903', null, '00000000-0000-4000-8000-000000000b09', 'view');
select set_config('role', 'postgres', true);
insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('00000000-0000-4000-8000-000000000913', 'nuevo2@test.invalid', 'authenticated', 'authenticated', now());
select pg_temp.as_user('00000000-0000-4000-8000-000000000913');
do $$
begin
  assert public.accept_invitations() = 1, 'nuevo2 no acepta';
  assert private.workspace_role() = 'guest', 'nuevo2: rol';
  assert private.page_level('00000000-0000-4000-8000-000000000b09') = 0,
    'se aplicó un permiso sobre algo donde quien invitó ya no tiene 4';
  assert private.page_level('00000000-0000-4000-8000-000000000b0a') = 1, 'nuevo2 no recibe el otro permiso';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Sesiones abiertas con contraseña: nada. Con código o link: todo igual.
-- ---------------------------------------------------------------------------------------------------
create function pg_temp.as_session(uid uuid, amr jsonb) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'amr', amr)::text, true);
$$;

select pg_temp.as_session('00000000-0000-4000-8000-000000000901', '[{"method": "password", "timestamp": 1790000000}]');
do $$
declare
  p1 constant uuid := '00000000-0000-4000-8000-000000000a01';
begin
  assert not private.session_allowed(), 'session_allowed con contraseña';
  assert private.workspace_role() is null, 'con contraseña, la dueña tiene rol';
  assert pg_temp.projects() = '{}' and (select count(*) from public.pages) = 0
     and (select count(*) from public.page_updates) = 0, 'con contraseña se ven proyectos, páginas o contenido';
  assert private.project_level(p1) = 0 and not private.can_create_project(), 'con contraseña hay permisos';
  perform pg_temp.check_level('dueña con contraseña', p1, '00000000-0000-4000-8000-000000000b01', 0);
  assert public.ensure_workspace() is null, 'con contraseña: ensure_workspace';
  assert (select count(*) from public.members) = 0 and (select count(*) from public.grants) = 0
     and (select count(*) from public.list_members()) = 0, 'con contraseña se ven miembros o permisos';
  assert not (public.media_whoami() ->> 'is_owner')::boolean and public.media_whoami() ->> 'role' is null,
    'con contraseña media_whoami da dueña o rol';
  perform pg_temp.expect_error($q$select public.create_invitation('x@test.invalid', 'guest', '[]')$q$,
    'not_allowed', 'con contraseña se invita');
  perform pg_temp.expect_error('select public.accept_invitations()', 'session_not_allowed',
    'con contraseña se aceptan invitaciones');
  perform pg_temp.expect_error($q$insert into public.workspaces (id, name) values (gen_random_uuid(), 'No')$q$,
    '42501', 'con contraseña se crea un proyecto');
end;
$$;

-- Contraseña y después un segundo factor: sigue sin contar.
select pg_temp.as_session('00000000-0000-4000-8000-000000000901',
  '[{"method": "totp", "timestamp": 1790000100}, {"method": "password", "timestamp": 1790000000}]');
do $$
begin
  assert private.workspace_role() is null and pg_temp.projects() = '{}', 'contraseña más TOTP cuenta';
end;
$$;

select pg_temp.as_session('00000000-0000-4000-8000-000000000901', '[{"method": "otp", "timestamp": 1790000000}]');
do $$
begin
  assert private.session_allowed() and private.workspace_role() = 'owner', 'con código, la dueña no tiene su rol';
  assert '00000000-0000-4000-8000-000000000a01' = any (pg_temp.projects()), 'con código, la dueña no ve P1';
  perform pg_temp.check_level('dueña con código', '00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-000000000b01', 4);
  assert (public.media_whoami() ->> 'is_owner')::boolean, 'con código, la dueña no figura como dueña';
end;
$$;

select pg_temp.as_session('00000000-0000-4000-8000-000000000908', '[{"method": "password", "timestamp": 1790000000}]');
do $$
begin
  assert private.file_level('00000000-0000-4000-8000-000000000f02') = 0 and (select count(*) from public.files) = 0,
    'con contraseña se ven archivos';
end;
$$;
select pg_temp.as_session('00000000-0000-4000-8000-000000000908', '[{"method": "magiclink", "timestamp": 1790000000}]');
do $$
begin
  assert private.file_level('00000000-0000-4000-8000-000000000f02') = 3, 'con link, editar no edita el archivo';
  perform pg_temp.check_level('editar con link', '00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-000000000b02', 3);
end;
$$;

-- El hook de token (opcional): deja pasar código, link y renovaciones; rechaza contraseña.
select set_config('role', 'postgres', true);
do $$
declare
  claims constant jsonb := jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'aal', 'aal1',
    'amr', '[{"method": "otp", "timestamp": 1790000000}]'::jsonb);
  r jsonb;
begin
  r := private.hook_custom_access_token(jsonb_build_object('user_id', gen_random_uuid(), 'claims', claims,
                                                           'authentication_method', 'otp'));
  assert r = jsonb_build_object('claims', claims), format('el hook de token cambia los claims: %s', r);
  r := private.hook_custom_access_token(jsonb_build_object('user_id', gen_random_uuid(), 'claims', claims,
                                                           'authentication_method', 'token_refresh'));
  assert r = jsonb_build_object('claims', claims), 'el hook de token rechaza una renovación';
  r := private.hook_custom_access_token(jsonb_build_object('user_id', gen_random_uuid(),
         'claims', jsonb_set(claims, '{amr}', '[{"method": "password", "timestamp": 1}]'), 'authentication_method', 'password'));
  perform pg_temp.check_error_shape(r, 'el hook de token con contraseña');
  r := private.hook_custom_access_token(jsonb_build_object('user_id', gen_random_uuid(),
         'claims', jsonb_set(claims, '{amr}', '[{"method": "password", "timestamp": 1}]'), 'authentication_method', 'token_refresh'));
  perform pg_temp.check_error_shape(r, 'el hook de token renovando una sesión de contraseña');
end;
$$;

-- supabase_auth_admin (el rol de Supabase Auth) no ejecuta ninguna función de la app en `public` (la única
-- que puede es `rls_auto_enable`, de Supabase) ni en `private` salvo los dos hooks, y no tiene tablas.
do $$
begin
  assert not exists (
    select 1 from pg_proc p
    where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
      and has_function_privilege('supabase_auth_admin', p.oid, 'execute')
      and p.oid not in ('private.hook_before_user_created(jsonb)'::regprocedure,
                        'private.hook_custom_access_token(jsonb)'::regprocedure)
      and p.proname <> 'rls_auto_enable'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
    'supabase_auth_admin ejecuta funciones de la app';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Nadie escribe en members, grants ni invitations desde la API
-- ---------------------------------------------------------------------------------------------------
create function pg_temp.check_no_writes(who text) returns void language plpgsql as $$
declare
  self uuid := auth.uid();
begin
  perform pg_temp.expect_error(format('insert into public.members (user_id, role) values (%L, %L)', self, 'admin'),
    '42501', who || ' inserta en members');
  perform pg_temp.expect_error($q$update public.members set role = 'owner', removed_at = null$q$, '42501', who || ' cambia members');
  perform pg_temp.expect_error($q$delete from public.members$q$, '42501', who || ' borra en members');
  perform pg_temp.expect_error(
    format('insert into public.grants (user_id, project_id, level) values (%L, %L, %L)', self, '00000000-0000-4000-8000-000000000a01', 'edit_pages'),
    '42501', who || ' inserta en grants');
  perform pg_temp.expect_error($q$update public.grants set level = 'edit_pages'$q$, '42501', who || ' cambia grants');
  perform pg_temp.expect_error($q$delete from public.grants$q$, '42501', who || ' borra en grants');
  perform pg_temp.expect_error($q$insert into public.invitations (email, role) values ('x@test.invalid', 'admin')$q$,
    '42501', who || ' inserta en invitations');
  perform pg_temp.expect_error($q$update public.invitations set used_at = null, expires_at = now() + interval '1 year'$q$,
    '42501', who || ' cambia invitations');
  perform pg_temp.expect_error($q$delete from public.invitations$q$, '42501', who || ' borra en invitations');
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-000000000901');
select pg_temp.check_no_writes('la dueña');
select pg_temp.as_user('00000000-0000-4000-8000-000000000902');
select pg_temp.check_no_writes('la admin');
select pg_temp.as_user('00000000-0000-4000-8000-000000000904');
select pg_temp.check_no_writes('un miembro');
select pg_temp.as_user('00000000-0000-4000-8000-000000000905');
select pg_temp.check_no_writes('una invitada');
select pg_temp.as_user('00000000-0000-4000-8000-000000000910');
select pg_temp.check_no_writes('una admin sacada');

-- La versión de la base.
select set_config('role', 'postgres', true);
do $$
begin
  assert (select schema_version from public.workspace_settings) >= 4, 'schema_version no subió a 4';
end;
$$;

-- Sin sesión: nada.
select set_config('role', 'anon', true);
do $$
begin
  perform pg_temp.expect_error($q$select public.create_invitation('x@test.invalid', 'guest', '[]')$q$, '42501', 'anon invita');
  perform pg_temp.expect_error('select public.accept_invitations()', '42501', 'anon acepta invitaciones');
  perform pg_temp.expect_error('select * from public.list_members()', '42501', 'anon lista miembros');
  perform pg_temp.expect_error(format('select public.set_member_role(%L, %L)', gen_random_uuid(), 'member'), '42501', 'anon cambia roles');
  perform pg_temp.expect_error(format('select public.remove_member(%L)', gen_random_uuid()), '42501', 'anon saca gente');
  perform pg_temp.expect_error(format('select public.share(%L, %L, null, %L)', gen_random_uuid(), gen_random_uuid(), 'view'), '42501', 'anon comparte');
  perform pg_temp.expect_error(format('select public.unshare(%L)', gen_random_uuid()), '42501', 'anon saca permisos');
  perform pg_temp.expect_error(format('select * from public.list_access(%L, null)', gen_random_uuid()), '42501', 'anon ve accesos');
  perform pg_temp.expect_error($q$select private.hook_before_user_created('{}'::jsonb)$q$, '42501', 'anon llama al hook');
end;
$$;

rollback;

select 'ok' as result;
