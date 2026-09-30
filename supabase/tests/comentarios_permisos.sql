-- Pruebas de los comentarios (paso 10): ver y comentar según el nivel sobre la página, hilos, reintentos de
-- la cola, editar, borrar, resolver, alguien sacado, invitados (lo que pueden con comentar y con editar, y
-- los correos de los autores) y que nadie escriba directo en la tabla. Corre dentro de una transacción que
-- se deshace al final: no deja usuarios ni datos. Si todo pasa, devuelve una fila con result = 'ok'.

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

-- Personas (correo @test.invalid):
--   ow  dueña del workspace (creó P1 y P2)
--   cv, cc, ce, ep  miembros con ver, comentar, editar y editar y crear páginas sobre c
--   gc, ge  invitadas con comentar y con editar sobre c
--   rm  miembro con comentar sobre c, al que se saca      nx  sin membresía
-- Páginas: P1 con r › c › g y s; P2 con x.
insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('00000000-0000-4000-8000-000000000c01', 'cm-ow@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000c02', 'cm-cv@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000c03', 'cm-cc@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000c04', 'cm-ce@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000c05', 'cm-ep@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000c06', 'cm-gc@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000c07', 'cm-ge@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000c08', 'cm-rm@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000c09', 'cm-nx@test.invalid', 'authenticated', 'authenticated', now());

-- Si la base ya tiene dueño, queda fuera de la prueba (se deshace al final): hay un solo dueño activo.
update public.members set removed_at = now() where role = 'owner' and removed_at is null;
update public.workspace_settings set owner_id = '00000000-0000-4000-8000-000000000c01';

insert into public.members (user_id, role) values
  ('00000000-0000-4000-8000-000000000c01', 'owner'),
  ('00000000-0000-4000-8000-000000000c02', 'member'),
  ('00000000-0000-4000-8000-000000000c03', 'member'),
  ('00000000-0000-4000-8000-000000000c04', 'member'),
  ('00000000-0000-4000-8000-000000000c05', 'member'),
  ('00000000-0000-4000-8000-000000000c06', 'guest'),
  ('00000000-0000-4000-8000-000000000c07', 'guest'),
  ('00000000-0000-4000-8000-000000000c08', 'member');

insert into public.workspaces (id, owner_id, name) values
  ('00000000-0000-4000-8000-000000000ca1', '00000000-0000-4000-8000-000000000c01', 'P1'),
  ('00000000-0000-4000-8000-000000000ca2', '00000000-0000-4000-8000-000000000c01', 'P2');
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  ('00000000-0000-4000-8000-000000000cb1', '00000000-0000-4000-8000-000000000ca1', null, 'r', 'a0'),
  ('00000000-0000-4000-8000-000000000cb4', '00000000-0000-4000-8000-000000000ca1', null, 's', 'a1'),
  ('00000000-0000-4000-8000-000000000cb5', '00000000-0000-4000-8000-000000000ca2', null, 'x', 'a0');
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  ('00000000-0000-4000-8000-000000000cb2', '00000000-0000-4000-8000-000000000ca1',
   '00000000-0000-4000-8000-000000000cb1', 'c', 'a0');
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  ('00000000-0000-4000-8000-000000000cb3', '00000000-0000-4000-8000-000000000ca1',
   '00000000-0000-4000-8000-000000000cb2', 'g', 'a0');

insert into public.grants (user_id, page_id, level) values
  ('00000000-0000-4000-8000-000000000c02', '00000000-0000-4000-8000-000000000cb2', 'view'),
  ('00000000-0000-4000-8000-000000000c03', '00000000-0000-4000-8000-000000000cb2', 'comment'),
  ('00000000-0000-4000-8000-000000000c04', '00000000-0000-4000-8000-000000000cb2', 'edit'),
  ('00000000-0000-4000-8000-000000000c05', '00000000-0000-4000-8000-000000000cb2', 'edit_pages'),
  ('00000000-0000-4000-8000-000000000c06', '00000000-0000-4000-8000-000000000cb2', 'comment'),
  ('00000000-0000-4000-8000-000000000c07', '00000000-0000-4000-8000-000000000cb2', 'edit'),
  ('00000000-0000-4000-8000-000000000c08', '00000000-0000-4000-8000-000000000cb2', 'comment');

-- Comentarios:
--   k1 (d01) de ow en r, bloque de la semilla     k2 (d02) de ow en c, bloque blk-k2 (se borra)
--   k5 (d05) de ow en g    k6 (d06) de ow en s     k9 (d09) de ow en x (la página entera)
--   k3 (d03) de cc en g    k4 (d04) respuesta de cc a k2     k7 (d07) de rm en c
select pg_temp.as_user('00000000-0000-4000-8000-000000000c01');
do $$
begin
  perform public.add_comment('00000000-0000-4000-8000-000000000d01', '00000000-0000-4000-8000-000000000cb1',
    'initialBlockId', null, 'Hilo en r');
  perform public.add_comment('00000000-0000-4000-8000-000000000d02', '00000000-0000-4000-8000-000000000cb2',
    'blk-k2', null, '¿Qué lente usamos?');
  perform public.add_comment('00000000-0000-4000-8000-000000000d05', '00000000-0000-4000-8000-000000000cb3',
    '0f8fad5b-d9cb-469f-a165-70867728950e', null, 'En g');
  perform public.add_comment('00000000-0000-4000-8000-000000000d06', '00000000-0000-4000-8000-000000000cb4',
    null, null, 'En s');
  perform public.add_comment('00000000-0000-4000-8000-000000000d09', '00000000-0000-4000-8000-000000000cb5',
    null, null, 'En x');
  assert (select count(*) from public.comments_view) = 5, 'la dueña no ve sus cinco comentarios';
  assert (select author_id from public.comments_view where id = '00000000-0000-4000-8000-000000000d02')
         = '00000000-0000-4000-8000-000000000c01', 'el autor no es quien comenta';
  assert (select body from public.comments_view where id = '00000000-0000-4000-8000-000000000d02')
         = '¿Qué lente usamos?', 'la vista no da el texto';
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-000000000c08');
select public.add_comment('00000000-0000-4000-8000-000000000d07', '00000000-0000-4000-8000-000000000cb2',
  null, null, 'De rm');

-- ---------------------------------------------------------------------------------------------------
-- Ver y comentar según el nivel: hacia abajo sí, hacia arriba no
-- ---------------------------------------------------------------------------------------------------
-- Con 1 ve los comentarios (y sus autores) pero no comenta; con 2 o más comenta; con 0 no ve nada. Lo que
-- escribe se deshace al final.
create function pg_temp.check_comment(who text, p uuid, lvl int) returns void language plpgsql as $$
declare
  n int;
begin
  select count(*) into n from public.comments_view where page_id = p;
  assert (n > 0) = (lvl >= 1), format('%s: ve %s comentarios de %s con nivel %s', who, n, p, lvl);
  select count(*) into n from public.comments where page_id = p;
  assert (n > 0) = (lvl >= 1), format('%s: la tabla da %s filas de %s con nivel %s', who, n, p, lvl);
  if lvl >= 1 then
    perform public.comment_authors(p);
  else
    perform pg_temp.expect_error(format('select * from public.comment_authors(%L)', p), 'page_not_found',
      who || ': ve los autores sin ver la página');
  end if;
  begin
    if lvl >= 2 then
      perform public.add_comment(gen_random_uuid(), p, null, null, 'prueba');
    else
      perform pg_temp.expect_error(
        format('select public.add_comment(gen_random_uuid(), %L, null, null, %L)', p, 'x'),
        case when lvl = 1 then 'comment_denied' else 'page_not_found' end,
        format('%s: comenta en %s con nivel %s', who, p, lvl));
    end if;
    raise sqlstate 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-000000000c02');
do $$
begin
  perform pg_temp.check_comment('ver', '00000000-0000-4000-8000-000000000cb2', 1);
  perform pg_temp.check_comment('ver', '00000000-0000-4000-8000-000000000cb3', 1);  -- baja a g
  perform pg_temp.check_comment('ver', '00000000-0000-4000-8000-000000000cb1', 0);  -- no sube a r
  perform pg_temp.check_comment('ver', '00000000-0000-4000-8000-000000000cb4', 0);
  perform pg_temp.check_comment('ver', '00000000-0000-4000-8000-000000000cb5', 0);
  perform pg_temp.expect_error($q$select public.resolve_thread('00000000-0000-4000-8000-000000000d02', true)$q$,
    'comment_denied', 'ver: resuelve un hilo');
  perform pg_temp.expect_error(
    $q$select public.add_comment(gen_random_uuid(), '00000000-0000-4000-8000-000000000cb2', null, '00000000-0000-4000-8000-000000000d02', 'x')$q$,
    'comment_denied', 'ver: responde');
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-000000000c03');
do $$
begin
  perform pg_temp.check_comment('comentar', '00000000-0000-4000-8000-000000000cb2', 2);
  perform pg_temp.check_comment('comentar', '00000000-0000-4000-8000-000000000cb3', 2);
  perform pg_temp.check_comment('comentar', '00000000-0000-4000-8000-000000000cb1', 0);
  perform pg_temp.check_comment('comentar', '00000000-0000-4000-8000-000000000cb4', 0);
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-000000000c04');
do $$
begin
  perform pg_temp.check_comment('editar', '00000000-0000-4000-8000-000000000cb2', 3);
  perform pg_temp.check_comment('editar', '00000000-0000-4000-8000-000000000cb3', 3);
  perform pg_temp.check_comment('editar', '00000000-0000-4000-8000-000000000cb1', 0);
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-000000000c05');
do $$
begin
  perform pg_temp.check_comment('editar y crear', '00000000-0000-4000-8000-000000000cb2', 4);
  perform pg_temp.check_comment('editar y crear', '00000000-0000-4000-8000-000000000cb3', 4);
  perform pg_temp.check_comment('editar y crear', '00000000-0000-4000-8000-000000000cb1', 0);
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-000000000c01');
do $$
declare
  p uuid;
begin
  foreach p in array array['00000000-0000-4000-8000-000000000cb1', '00000000-0000-4000-8000-000000000cb2',
                           '00000000-0000-4000-8000-000000000cb3', '00000000-0000-4000-8000-000000000cb4',
                           '00000000-0000-4000-8000-000000000cb5']::uuid[] loop
    perform pg_temp.check_comment('la dueña', p, 4);
  end loop;
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-000000000c09');
do $$
begin
  perform pg_temp.check_comment('sin membresía', '00000000-0000-4000-8000-000000000cb2', 0);
  assert (select count(*) from public.comments_view) = 0, 'sin membresía: ve comentarios';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Hilos, datos y reintentos de la cola (cc, con comentar sobre c)
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-000000000c03');
do $$
declare
  c  constant uuid := '00000000-0000-4000-8000-000000000cb2';
  g  constant uuid := '00000000-0000-4000-8000-000000000cb3';
  k2 constant uuid := '00000000-0000-4000-8000-000000000d02';
  k3 constant uuid := '00000000-0000-4000-8000-000000000d03';
  k4 constant uuid := '00000000-0000-4000-8000-000000000d04';
  t  timestamptz;
begin
  perform public.add_comment(k3, g, 'blk-k3', null, 'Mi comentario');
  -- La respuesta toma el bloque del hilo.
  perform public.add_comment(k4, c, null, k2, 'Respuesta');
  assert (select (block_id, thread_id) = ('blk-k2', k2) from public.comments_view where id = k4),
    'la respuesta no queda en el hilo y el bloque de k2';
  perform public.add_comment(gen_random_uuid(), c, 'blk-k2', k2, 'Con el mismo bloque');

  -- Hilo en otra página, respuesta a una respuesta, hilo que no existe, otro bloque, él mismo.
  perform pg_temp.expect_error(format('select public.add_comment(gen_random_uuid(), %L, null, %L, %L)', g, k2, 'x'),
    'thread_other_page', 'responde en g a un hilo de c');
  perform pg_temp.expect_error(format('select public.add_comment(gen_random_uuid(), %L, null, %L, %L)', c, k3, 'x'),
    'thread_other_page', 'responde en c a un hilo de g');
  perform pg_temp.expect_error(format('select public.add_comment(gen_random_uuid(), %L, null, %L, %L)', c, k4, 'x'),
    'thread_invalid', 'responde a una respuesta');
  perform pg_temp.expect_error(format('select public.add_comment(gen_random_uuid(), %L, null, gen_random_uuid(), %L)', c, 'x'),
    'thread_not_found', 'responde a un hilo que no existe');
  perform pg_temp.expect_error(format('select public.add_comment(gen_random_uuid(), %L, %L, %L, %L)', c, 'otro', k2, 'x'),
    'thread_invalid', 'responde en otro bloque');
  perform pg_temp.expect_error(format('select public.add_comment(%L, %L, null, %L, %L)', 'd0000000-0000-4000-8000-000000000001', c, 'd0000000-0000-4000-8000-000000000001', 'x'),
    'thread_invalid', 'un comentario es su propio hilo');
  perform pg_temp.expect_error(format('select public.add_comment(null, %L, null, null, %L)', c, 'x'),
    'page_not_found', 'comenta sin id');

  -- Datos con forma inválida.
  perform pg_temp.expect_error(format('select public.add_comment(gen_random_uuid(), %L, null, null, %L)', c, ''),
    '23514', 'comentario vacío');
  perform pg_temp.expect_error(format('select public.add_comment(gen_random_uuid(), %L, null, null, %L)', c, E'  \n '),
    '23514', 'comentario con solo espacios');
  perform pg_temp.expect_error(format('select public.add_comment(gen_random_uuid(), %L, null, null, repeat(%L, 10001))', c, 'a'),
    '23514', 'comentario de más de 10000 caracteres');
  perform pg_temp.expect_error(format('select public.add_comment(gen_random_uuid(), %L, null, null, null)', c),
    '23502', 'comentario null');
  perform pg_temp.expect_error(format('select public.add_comment(gen_random_uuid(), %L, %L, null, %L)', c, 'a b', 'x'),
    '23514', 'bloque con espacios');
  perform pg_temp.expect_error(format('select public.add_comment(gen_random_uuid(), %L, repeat(%L, 129), null, %L)', c, 'a', 'x'),
    '23514', 'bloque de más de 128 caracteres');
  perform public.add_comment(gen_random_uuid(), c, repeat('a', 128), null, repeat('ñ', 10000));

  -- Reintento de la cola: el mismo id y el mismo contenido no hace nada; distinto, comment_conflict.
  select created_at into t from public.comments where id = k3;
  perform public.add_comment(k3, g, 'blk-k3', null, 'Mi comentario');
  perform public.add_comment(k4, c, null, k2, 'Respuesta');
  perform public.add_comment(k4, c, 'blk-k2', k2, 'Respuesta');
  assert (select count(*) from public.comments where id in (k3, k4)) = 2, 'un reintento duplica';
  assert (select created_at from public.comments where id = k3) = t, 'un reintento cambia el comentario';
  perform pg_temp.expect_error(format('select public.add_comment(%L, %L, %L, null, %L)', k3, g, 'blk-k3', 'Otro texto'),
    'comment_conflict', 'reintento con otro texto');
  perform pg_temp.expect_error(format('select public.add_comment(%L, %L, %L, null, %L)', k3, g, 'blk-otro', 'Mi comentario'),
    'comment_conflict', 'reintento con otro bloque');
  perform pg_temp.expect_error(format('select public.add_comment(%L, %L, %L, null, %L)', k3, c, 'blk-k3', 'Mi comentario'),
    'comment_conflict', 'reintento en otra página');
  perform pg_temp.expect_error(format('select public.add_comment(%L, %L, null, %L, %L)', k3, g, k2, 'Mi comentario'),
    'thread_other_page', 'reintento como respuesta');
  -- Un id que ya usó otro comentario de una página que no ve (k1, en r): no lo pisa.
  perform pg_temp.expect_error(format('select public.add_comment(%L, %L, null, null, %L)', '00000000-0000-4000-8000-000000000d01', c, 'Hilo en r'),
    'comment_conflict', 'reusa el id de un comentario ajeno');
end;
$$;

-- Otra persona con el mismo id y el mismo contenido: comment_conflict.
select pg_temp.as_user('00000000-0000-4000-8000-000000000c04');
select pg_temp.expect_error(
  $q$select public.add_comment('00000000-0000-4000-8000-000000000d03', '00000000-0000-4000-8000-000000000cb3', 'blk-k3', null, 'Mi comentario')$q$,
  'comment_conflict', 'otra persona reintenta un comentario ajeno');

select set_config('role', 'postgres', true);
do $$
begin
  assert (select body from public.comments where id = '00000000-0000-4000-8000-000000000d03') = 'Mi comentario',
    'un reintento cambió el texto';
  assert (select author_id from public.comments where id = '00000000-0000-4000-8000-000000000d01')
         = '00000000-0000-4000-8000-000000000c01', 'el comentario de r cambió de autor';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Editar: solo quien lo escribió
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-000000000c03');
do $$
begin
  perform public.edit_comment('00000000-0000-4000-8000-000000000d03', 'Editado');
  assert (select body = 'Editado' and edited_at is not null from public.comments_view
          where id = '00000000-0000-4000-8000-000000000d03'), 'el autor no edita';
  perform pg_temp.expect_error($q$select public.edit_comment('00000000-0000-4000-8000-000000000d03', '')$q$,
    '23514', 'edita con un texto vacío');
  perform pg_temp.expect_error($q$select public.edit_comment(gen_random_uuid(), 'x')$q$,
    'comment_not_found', 'edita un comentario que no existe');
  perform pg_temp.expect_error($q$select public.edit_comment('00000000-0000-4000-8000-000000000d01', 'x')$q$,
    'comment_not_found', 'edita un comentario de una página que no ve');
end;
$$;

-- El mismo texto no cambia nada.
select set_config('role', 'postgres', true);
update public.comments set edited_at = '2000-01-01' where id = '00000000-0000-4000-8000-000000000d03';
select pg_temp.as_user('00000000-0000-4000-8000-000000000c03');
select public.edit_comment('00000000-0000-4000-8000-000000000d03', 'Editado');
select set_config('role', 'postgres', true);
do $$
begin
  assert (select edited_at from public.comments where id = '00000000-0000-4000-8000-000000000d03') = '2000-01-01',
    'editar con el mismo texto cambia edited_at';
end;
$$;

create function pg_temp.check_no_edit(who text) returns void language plpgsql as $$
begin
  perform pg_temp.expect_error($q$select public.edit_comment('00000000-0000-4000-8000-000000000d03', 'Pisado')$q$,
    'not_allowed', who || ' edita un comentario ajeno');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-000000000c02');
select pg_temp.check_no_edit('ver');
select pg_temp.as_user('00000000-0000-4000-8000-000000000c04');
select pg_temp.check_no_edit('editar');
select pg_temp.as_user('00000000-0000-4000-8000-000000000c05');
select pg_temp.check_no_edit('editar y crear');
select pg_temp.as_user('00000000-0000-4000-8000-000000000c01');
select pg_temp.check_no_edit('la dueña');
select pg_temp.as_user('00000000-0000-4000-8000-000000000c06');
select pg_temp.check_no_edit('la invitada');

-- El autor que pasa a ver ya no edita ni borra lo suyo (la dueña le baja el permiso y se lo devuelve).
select pg_temp.as_user('00000000-0000-4000-8000-000000000c01');
select public.share('00000000-0000-4000-8000-000000000c03', null, '00000000-0000-4000-8000-000000000cb2', 'view');
select pg_temp.as_user('00000000-0000-4000-8000-000000000c03');
do $$
begin
  perform pg_temp.expect_error($q$select public.edit_comment('00000000-0000-4000-8000-000000000d03', 'x')$q$,
    'comment_denied', 'con ver, el autor edita');
  perform pg_temp.expect_error($q$select public.delete_comment('00000000-0000-4000-8000-000000000d03')$q$,
    'not_allowed', 'con ver, el autor borra');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-000000000c01');
select public.share('00000000-0000-4000-8000-000000000c03', null, '00000000-0000-4000-8000-000000000cb2', 'comment');

-- ---------------------------------------------------------------------------------------------------
-- Borrar: quien lo escribió o quien tiene editar y crear páginas; el texto queda en la base
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-000000000c02');
select pg_temp.expect_error($q$select public.delete_comment('00000000-0000-4000-8000-000000000d02')$q$,
  'not_allowed', 'ver: borra un comentario');
select pg_temp.as_user('00000000-0000-4000-8000-000000000c03');
select pg_temp.expect_error($q$select public.delete_comment('00000000-0000-4000-8000-000000000d02')$q$,
  'not_allowed', 'comentar: borra un comentario ajeno');
select pg_temp.as_user('00000000-0000-4000-8000-000000000c04');
select pg_temp.expect_error($q$select public.delete_comment('00000000-0000-4000-8000-000000000d03')$q$,
  'not_allowed', 'editar: borra un comentario ajeno');
select pg_temp.expect_error($q$select public.delete_comment('00000000-0000-4000-8000-000000000d01')$q$,
  'comment_not_found', 'borra un comentario de una página que no ve');
select pg_temp.expect_error($q$select public.delete_comment(gen_random_uuid())$q$,
  'comment_not_found', 'borra un comentario que no existe');

-- ep (4 sobre c) borra el de la dueña; cc borra el suyo.
select pg_temp.as_user('00000000-0000-4000-8000-000000000c05');
select public.delete_comment('00000000-0000-4000-8000-000000000d02');
select pg_temp.as_user('00000000-0000-4000-8000-000000000c03');
select public.delete_comment('00000000-0000-4000-8000-000000000d03');
do $$
begin
  assert (select body is null and deleted_at is not null and deleted_by = '00000000-0000-4000-8000-000000000c05'
          from public.comments_view where id = '00000000-0000-4000-8000-000000000d02'),
    'el borrado sigue en la vista con su texto, o sin quién lo borró';
  assert (select body is null from public.comments_view where id = '00000000-0000-4000-8000-000000000d03'),
    'la vista da el texto de un comentario borrado';
  assert private.comment_body('00000000-0000-4000-8000-000000000d02') is null, 'comment_body da un texto borrado';
  -- La respuesta de un hilo borrado sigue ahí; y se puede seguir respondiendo (la cola sin red).
  assert (select body from public.comments_view where id = '00000000-0000-4000-8000-000000000d04') = 'Respuesta',
    'borrar el hilo tocó la respuesta';
  perform public.add_comment('00000000-0000-4000-8000-000000000d08', '00000000-0000-4000-8000-000000000cb2', null,
    '00000000-0000-4000-8000-000000000d02', 'Respuesta a un borrado');
  perform pg_temp.expect_error($q$select public.edit_comment('00000000-0000-4000-8000-000000000d03', 'Otro')$q$,
    'comment_deleted', 'edita un comentario borrado');
  -- Reintentar el alta de un borrado no hace nada (sigue borrado).
  perform public.add_comment('00000000-0000-4000-8000-000000000d03', '00000000-0000-4000-8000-000000000cb3',
    'blk-k3', null, 'Editado');
  assert (select deleted_at is not null from public.comments where id = '00000000-0000-4000-8000-000000000d03'),
    'reintentar el alta revive un borrado';
  perform pg_temp.expect_error('select body from public.comments', '42501', 'lee el texto en la tabla');
  perform pg_temp.expect_error('select * from public.comments', '42501', 'lee la tabla entera');
end;
$$;

-- Borrar dos veces no cambia nada; el texto queda en la base.
select set_config('role', 'postgres', true);
update public.comments set deleted_at = '2000-01-01' where id = '00000000-0000-4000-8000-000000000d03';
select pg_temp.as_user('00000000-0000-4000-8000-000000000c03');
select public.delete_comment('00000000-0000-4000-8000-000000000d03');
select set_config('role', 'postgres', true);
do $$
begin
  assert (select deleted_at from public.comments where id = '00000000-0000-4000-8000-000000000d03') = '2000-01-01',
    'borrar dos veces cambia deleted_at';
  assert (select body from public.comments where id = '00000000-0000-4000-8000-000000000d02') = '¿Qué lente usamos?',
    'borrar no conserva el texto';
  assert (select body from public.comments where id = '00000000-0000-4000-8000-000000000d03') = 'Editado',
    'borrar no conserva el texto editado';
end;
$$;

-- La dueña (4 sobre todo P1) borra el de cc en g... dentro de una subtransacción que se deshace.
select pg_temp.as_user('00000000-0000-4000-8000-000000000c01');
do $$
begin
  begin
    perform public.delete_comment('00000000-0000-4000-8000-000000000d04');
    assert (select deleted_by from public.comments where id = '00000000-0000-4000-8000-000000000d04')
           = '00000000-0000-4000-8000-000000000c01', 'la dueña no borra';
    raise sqlstate 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Resolver un hilo: con comentar
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-000000000c03');
do $$
begin
  perform public.resolve_thread('00000000-0000-4000-8000-000000000d02', true);
  assert (select resolved_at is not null and resolved_by = '00000000-0000-4000-8000-000000000c03'
          from public.comments_view where id = '00000000-0000-4000-8000-000000000d02'), 'no resuelve';
  perform pg_temp.expect_error($q$select public.resolve_thread('00000000-0000-4000-8000-000000000d04', true)$q$,
    'thread_invalid', 'resuelve una respuesta');
  perform pg_temp.expect_error($q$select public.resolve_thread(gen_random_uuid(), true)$q$,
    'thread_not_found', 'resuelve un hilo que no existe');
  perform pg_temp.expect_error($q$select public.resolve_thread('00000000-0000-4000-8000-000000000d01', true)$q$,
    'thread_not_found', 'resuelve un hilo de una página que no ve');
  perform pg_temp.expect_error($q$select public.resolve_thread('00000000-0000-4000-8000-000000000d02', null)$q$,
    'resolved_invalid', 'resuelve con null');
end;
$$;

-- Resolver uno resuelto no cambia quién ni cuándo.
select set_config('role', 'postgres', true);
update public.comments set resolved_at = '2000-01-01' where id = '00000000-0000-4000-8000-000000000d02';
select pg_temp.as_user('00000000-0000-4000-8000-000000000c06');
select public.resolve_thread('00000000-0000-4000-8000-000000000d02', true);
do $$
begin
  assert (select resolved_at = '2000-01-01' and resolved_by = '00000000-0000-4000-8000-000000000c03'
          from public.comments_view where id = '00000000-0000-4000-8000-000000000d02'),
    'resolver dos veces cambia quién o cuándo';
  perform public.resolve_thread('00000000-0000-4000-8000-000000000d02', false);
  assert (select resolved_at is null and resolved_by is null
          from public.comments_view where id = '00000000-0000-4000-8000-000000000d02'), 'no vuelve a abrir';
  perform public.resolve_thread('00000000-0000-4000-8000-000000000d02', false);
  perform public.resolve_thread('00000000-0000-4000-8000-000000000d05', true);  -- g: baja
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Alguien sacado no ve ni escribe (tampoco lo suyo)
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-000000000c01');
select public.remove_member('00000000-0000-4000-8000-000000000c08');
select pg_temp.as_user('00000000-0000-4000-8000-000000000c08');
do $$
begin
  perform pg_temp.check_comment('sacado', '00000000-0000-4000-8000-000000000cb2', 0);
  assert (select count(*) from public.comments_view) = 0, 'sacado: ve comentarios';
  assert (select count(*) from public.comments) = 0, 'sacado: la tabla le da filas';
  perform pg_temp.expect_error($q$select public.edit_comment('00000000-0000-4000-8000-000000000d07', 'x')$q$,
    'comment_not_found', 'sacado: edita lo suyo');
  perform pg_temp.expect_error($q$select public.delete_comment('00000000-0000-4000-8000-000000000d07')$q$,
    'comment_not_found', 'sacado: borra lo suyo');
  perform pg_temp.expect_error($q$select public.resolve_thread('00000000-0000-4000-8000-000000000d07', true)$q$,
    'thread_not_found', 'sacado: resuelve');
  perform pg_temp.expect_error(
    $q$select public.add_comment('00000000-0000-4000-8000-000000000d07', '00000000-0000-4000-8000-000000000cb2', null, null, 'De rm')$q$,
    'page_not_found', 'sacado: reintenta el alta');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Invitadas: comentar (comenta y responde, no edita) y editar (sube archivos, no crea páginas)
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-000000000c06');
do $$
declare
  c constant uuid := '00000000-0000-4000-8000-000000000cb2';
  g constant uuid := '00000000-0000-4000-8000-000000000cb3';
  n int;
begin
  assert private.workspace_role() = 'guest', 'gc no es invitada';
  -- Ve solo lo compartido: c y g, y sus comentarios.
  assert (select array_agg(id order by id) from public.pages) = array[c, g], 'la invitada no ve exactamente c y g';
  assert (select array_agg(distinct page_id) from public.comments_view) = array[c, g],
    'la invitada ve comentarios de otras páginas';
  perform pg_temp.check_comment('invitada con comentar', c, 2);
  perform pg_temp.check_comment('invitada con comentar', g, 2);
  perform pg_temp.check_comment('invitada con comentar', '00000000-0000-4000-8000-000000000cb1', 0);
  perform pg_temp.check_comment('invitada con comentar', '00000000-0000-4000-8000-000000000cb4', 0);
  perform pg_temp.check_comment('invitada con comentar', '00000000-0000-4000-8000-000000000cb5', 0);
  -- Comenta, responde, edita y borra lo suyo, y resuelve.
  perform public.add_comment('00000000-0000-4000-8000-000000000d10', c, 'blk-q', null, 'Pregunta del cliente');
  perform public.add_comment('00000000-0000-4000-8000-000000000d11', c, null, '00000000-0000-4000-8000-000000000d10', 'Respuesta del cliente');
  perform public.add_comment('00000000-0000-4000-8000-000000000d12', g, null, '00000000-0000-4000-8000-000000000d05', 'En g');
  perform public.edit_comment('00000000-0000-4000-8000-000000000d11', 'Respuesta corregida');
  perform public.delete_comment('00000000-0000-4000-8000-000000000d12');
  perform public.resolve_thread('00000000-0000-4000-8000-000000000d10', true);
  perform pg_temp.expect_error($q$select public.delete_comment('00000000-0000-4000-8000-000000000d05')$q$,
    'not_allowed', 'la invitada borra un comentario ajeno');
  -- No edita la página ni sube archivos.
  perform pg_temp.expect_error(format('select public.push_page_update(%L, gen_random_uuid(), %L, %L)', c, 'AQAAAA==', '9.999'),
    'page_not_found', 'la invitada con comentar sube contenido');
  update public.pages set title = 'x' where id = c;
  get diagnostics n = row_count;
  assert n = 0, 'la invitada con comentar cambia el título';
  perform pg_temp.expect_error(
    format('select public.register_file(gen_random_uuid(), %L, %L, %L, 1, null, null, null)', c, 'y.jpg', 'image/jpeg'),
    'page_not_found', 'la invitada con comentar sube un archivo');
  perform pg_temp.expect_error(
    format('insert into public.pages (id, workspace_id, parent_id, title, sort_key) values (gen_random_uuid(), %L, %L, %L, %L)',
           '00000000-0000-4000-8000-000000000ca1', c, 'x', 'zz'),
    'page_create_denied', 'la invitada con comentar crea una página');
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-000000000c07');
do $$
declare
  c constant uuid := '00000000-0000-4000-8000-000000000cb2';
begin
  perform public.add_comment('00000000-0000-4000-8000-000000000d13', c, null, '00000000-0000-4000-8000-000000000d10', 'Otra respuesta');
  perform public.push_page_update(c, gen_random_uuid(), 'AQAAAA==', '9.999');
  perform public.register_file('00000000-0000-4000-8000-000000000cf1', c, 'foto.jpg', 'image/jpeg', 10, null, null, null);
  assert private.file_level('00000000-0000-4000-8000-000000000cf1') = 3, 'la invitada con editar: file_level';
  perform pg_temp.expect_error(
    format('insert into public.pages (id, workspace_id, parent_id, title, sort_key) values (gen_random_uuid(), %L, %L, %L, %L)',
           '00000000-0000-4000-8000-000000000ca1', c, 'x', 'zz'),
    'page_create_denied', 'la invitada con editar crea una página');
  perform pg_temp.expect_error(format('update public.pages set deleted_at = now() where id = %L', c),
    'page_trash_denied', 'la invitada con editar manda una página a la papelera');
  perform pg_temp.expect_error($q$insert into public.workspaces (id, name) values (gen_random_uuid(), 'No')$q$,
    '42501', 'la invitada con editar crea un proyecto');
end;
$$;

-- Los nombres y correos del equipo en los comentarios: la invitada ve los de c (quien escribió, resolvió o
-- borró, también el sacado) y nada de otras páginas; en la lista de miembros, solo su fila.
select pg_temp.as_user('00000000-0000-4000-8000-000000000c06');
do $$
declare
  got text[];
begin
  select array_agg(email order by email) into got from public.comment_authors('00000000-0000-4000-8000-000000000cb2');
  assert got = array['cm-cc@test.invalid', 'cm-ep@test.invalid', 'cm-gc@test.invalid', 'cm-ge@test.invalid',
                     'cm-ow@test.invalid', 'cm-rm@test.invalid'],
    format('comment_authors de c da %s', got);
  assert (select user_id from public.comment_authors('00000000-0000-4000-8000-000000000cb2')
          where email = 'cm-ow@test.invalid') = '00000000-0000-4000-8000-000000000c01', 'comment_authors: id';
  -- En g: la dueña (k5), cc (k3, borrado) y la invitada (k12 y resolvió k5).
  select array_agg(email order by email) into got from public.comment_authors('00000000-0000-4000-8000-000000000cb3');
  assert got = array['cm-cc@test.invalid', 'cm-gc@test.invalid', 'cm-ow@test.invalid'],
    format('comment_authors de g da %s', got);
  perform pg_temp.expect_error($q$select * from public.comment_authors('00000000-0000-4000-8000-000000000cb1')$q$,
    'page_not_found', 'la invitada ve los autores de r');
  perform pg_temp.expect_error($q$select * from public.comment_authors('00000000-0000-4000-8000-000000000cb5')$q$,
    'page_not_found', 'la invitada ve los autores de otro proyecto');
  perform pg_temp.expect_error($q$select * from public.comment_authors(gen_random_uuid())$q$,
    'page_not_found', 'autores de una página que no existe');
  assert (select array_agg(user_id) from public.list_members()) = array['00000000-0000-4000-8000-000000000c06'::uuid],
    'la invitada ve otros miembros';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Nadie escribe directo en la tabla ni en la vista
-- ---------------------------------------------------------------------------------------------------
create function pg_temp.check_no_writes(who text) returns void language plpgsql as $$
begin
  perform pg_temp.expect_error(
    $q$insert into public.comments (id, page_id, body) values (gen_random_uuid(), '00000000-0000-4000-8000-000000000cb2', 'x')$q$,
    '42501', who || ' inserta en comments');
  perform pg_temp.expect_error($q$update public.comments set deleted_at = null, deleted_by = null$q$,
    '42501', who || ' revive comentarios');
  perform pg_temp.expect_error($q$update public.comments set body = 'x'$q$, '42501', who || ' cambia textos');
  perform pg_temp.expect_error($q$update public.comments set resolved_at = now()$q$, '42501', who || ' resuelve en la tabla');
  perform pg_temp.expect_error($q$delete from public.comments$q$, '42501', who || ' borra en comments');
  perform pg_temp.expect_error($q$truncate public.comments$q$, '42501', who || ' vacía comments');
  perform pg_temp.expect_error(
    $q$insert into public.comments_view (id, page_id) values (gen_random_uuid(), '00000000-0000-4000-8000-000000000cb2')$q$,
    '42501', who || ' inserta en la vista');
  perform pg_temp.expect_error($q$update public.comments_view set deleted_at = null$q$, '42501', who || ' cambia la vista');
  perform pg_temp.expect_error($q$delete from public.comments_view$q$, '42501', who || ' borra en la vista');
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-000000000c01');
select pg_temp.check_no_writes('la dueña');
select pg_temp.as_user('00000000-0000-4000-8000-000000000c05');
select pg_temp.check_no_writes('editar y crear');
select pg_temp.as_user('00000000-0000-4000-8000-000000000c06');
select pg_temp.check_no_writes('una invitada');
select pg_temp.as_user('00000000-0000-4000-8000-000000000c08');
select pg_temp.check_no_writes('un sacado');

-- Nada se borró: todos los comentarios siguen en la base, y la versión de la base.
select set_config('role', 'postgres', true);
do $$
begin
  assert (select count(*) from public.comments where id::text like '00000000-0000-4000-8000-000000000d%') = 13,
    format('faltan comentarios: %s', (select count(*) from public.comments where id::text like '00000000-0000-4000-8000-000000000d%'));
  assert (select schema_version from public.workspace_settings) >= 5, 'schema_version no subió a 5';
end;
$$;

-- Sin sesión: nada.
select set_config('role', 'anon', true);
do $$
begin
  perform pg_temp.expect_error('select * from public.comments_view', '42501', 'anon lee la vista');
  perform pg_temp.expect_error('select id from public.comments', '42501', 'anon lee la tabla');
  perform pg_temp.expect_error(
    $q$select public.add_comment(gen_random_uuid(), '00000000-0000-4000-8000-000000000cb2', null, null, 'x')$q$,
    '42501', 'anon comenta');
  perform pg_temp.expect_error($q$select public.edit_comment('00000000-0000-4000-8000-000000000d04', 'x')$q$, '42501', 'anon edita');
  perform pg_temp.expect_error($q$select public.delete_comment('00000000-0000-4000-8000-000000000d04')$q$, '42501', 'anon borra');
  perform pg_temp.expect_error($q$select public.resolve_thread('00000000-0000-4000-8000-000000000d02', true)$q$, '42501', 'anon resuelve');
  perform pg_temp.expect_error($q$select * from public.comment_authors('00000000-0000-4000-8000-000000000cb2')$q$, '42501', 'anon ve autores');
end;
$$;

rollback;

select 'ok' as result;
