-- Pruebas de `edit_comment(p_id, p_body, p_base)` (20261115120000_comentario_edicion_base.sql): editar un comentario
-- sin pisar una edición posterior. La base cambia el texto solo si el que tiene es el que el dispositivo tenía al
-- empezar a editar (`p_base`); si ya es otro, no escribe nada y contesta el conflicto con el texto de ahora.
--
-- Qué se prueba: que la función nueva corre con los mismos atributos y permisos que la de dos argumentos; cada tipo
-- de sesión que puede o no editar (quien lo escribió con comentar, con ver, sacada, con contraseña, sin persona;
-- quienes no lo escribieron, con ver, editar, editar y crear, la dueña, una invitada; quien no ve la página; `anon`),
-- con el mismo error que da la firma de dos argumentos y **sin que la respuesta diga nada del texto** a quien no
-- puede editarlo; el conflicto (no escribe; devuelve el texto y la fecha de ahora); el reintento de una edición que ya
-- llegó; un comentario nunca editado; dos ediciones encadenadas; un comentario borrado y un hilo resuelto; la base
-- nula; la versión mínima; y que la firma de dos argumentos sigue haciendo lo de siempre. Corre dentro de una
-- transacción que se deshace al final: no deja usuarios ni datos. Si todo pasa, devuelve una fila con result = 'ok'.

begin;

update public.workspace_settings set min_app_version = null where id;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-00000000' || s)::uuid;
$$;

-- La sesión de una persona. `version`: el header de la app (nulo: sin header). `amr`: cómo entró.
create function pg_temp.as_user(s text, version text default '9.999', amr jsonb default '[{"method": "otp"}]')
returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', pg_temp.u(s), 'role', 'authenticated', 'aal', 'aal1', 'amr', amr)::text, true),
         set_config('request.headers',
                    case when version is null then json_build_object('accept', '*/*')
                         else json_build_object('accept', '*/*', 'x-shotdocs-version', version) end::text, true);
$$;

create function pg_temp.as_console() returns void language sql as $$
  select set_config('role', 'postgres', true),
         set_config('request.jwt.claims', '', true),
         set_config('request.headers', '', true);
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

-- La fila entera de un comentario, en palabras, mirada desde la consola: para afirmar que algo NO escribió nada.
create function pg_temp.row_of(c text) returns text language sql security definer as $$
  select format('%s|%s|%s|%s|%s|%s', k.body, k.edited_at, k.updated_at, k.resolved_at, k.deleted_at, k.author_id)
  from public.comments k where k.id = pg_temp.u(c);
$$;

create function pg_temp.body_of(c text) returns text language sql security definer as $$
  select k.body from public.comments k where k.id = pg_temp.u(c);
$$;

-- La edición con base, como la manda la app.
create function pg_temp.edit(c text, body text, base text) returns jsonb language sql as $$
  select public.edit_comment(pg_temp.u(c), body, base);
$$;

-- Corre `stmt` y exige que falle con ese mensaje **y** con su código: la app trata distinto un 42501 (permiso) que un
-- P0001 o un P0002, así que el código de cada rechazo es parte de lo que la función promete.
create function pg_temp.expect_refusal(stmt text, expected text, what text) returns void language plpgsql as $$
declare
  code constant text := case expected
    when 'comment_not_found' then 'P0002' when 'not_allowed' then '42501' when 'comment_denied' then '42501'
    when 'comment_deleted' then 'P0001' end;
begin
  if code is null then
    raise exception 'FALLA: % (la prueba no sabe el código de %)', what, expected;
  end if;
  begin
    execute stmt;
  exception when others then
    if sqlerrm = expected and sqlstate = code then
      return;
    end if;
    raise exception 'FALLA: % (dio % %, se esperaba % %)', what, sqlstate, sqlerrm, code, expected;
  end;
  raise exception 'FALLA: %', what;
end;
$$;

-- Las dos firmas rechazan igual (mismo mensaje y mismo código), con la base bien o mal puesta, y ninguna escribe: a
-- quien no puede editar el comentario la respuesta no le dice si la base coincide. `same_text`: además, proponiendo
-- como texto nuevo **el texto que el comentario tiene**. El reintento de una edición ya hecha (el mismo texto) da bien
-- antes de mirar el permiso, pero solo a quien lo escribió: si ese atajo no mirara quién es, cualquier cuenta podría
-- averiguar si un comentario que no ve dice exactamente tal cosa. Va en falso solo donde quien llama es la autora de
-- un comentario sin borrar (ahí el atajo le corresponde).
create function pg_temp.both_refuse(c text, expected text, what text, same_text boolean default true)
returns void language plpgsql as $$
declare
  before constant text := pg_temp.row_of(c);
  good   constant text := pg_temp.body_of(c);
begin
  perform pg_temp.expect_refusal(format('select public.edit_comment(%L, %L)', pg_temp.u(c), 'Pisado'), expected, what || ' (dos argumentos)');
  perform pg_temp.expect_refusal(format('select public.edit_comment(%L, %L, %L)', pg_temp.u(c), 'Pisado', good), expected,
    what || ' (con la base que coincide)');
  perform pg_temp.expect_refusal(format('select public.edit_comment(%L, %L, %L)', pg_temp.u(c), 'Pisado', 'otra base'), expected,
    what || ' (con otra base)');
  perform pg_temp.expect_refusal(format('select public.edit_comment(%L, %L, null)', pg_temp.u(c), 'Pisado'), expected,
    what || ' (con la base nula)');
  if same_text then
    perform pg_temp.expect_refusal(format('select public.edit_comment(%L, %L)', pg_temp.u(c), good), expected,
      what || ' (proponiendo el texto que tiene, dos argumentos)');
    perform pg_temp.expect_refusal(format('select public.edit_comment(%L, %L, %L)', pg_temp.u(c), good, good), expected,
      what || ' (proponiendo el texto que tiene, con la base que coincide)');
    perform pg_temp.expect_refusal(format('select public.edit_comment(%L, %L, %L)', pg_temp.u(c), good, 'otra base'), expected,
      what || ' (proponiendo el texto que tiene, con otra base)');
  end if;
  assert pg_temp.row_of(c) is not distinct from before, what || ': un rechazo escribió algo';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Datos
-- ---------------------------------------------------------------------------------------------------
-- Personas: o (dueña del workspace, creó P), a (miembro con comentar sobre la página C: escribió casi todo), v (ver),
-- e (editar), p (editar y crear páginas), g (invitada con comentar, escribió k4), x (miembro sin permiso), rm (miembro
-- con comentar, sacada del workspace, escribió k5). Páginas de P: C y R (que `a` no ve).
update public.members set removed_at = now() where role = 'owner' and removed_at is null;
insert into auth.users (id, email, aud, role, email_confirmed_at) values
  (pg_temp.u('ec01'), 'ceb-o@test.invalid', 'authenticated', 'authenticated', now()),
  (pg_temp.u('ec02'), 'ceb-a@test.invalid', 'authenticated', 'authenticated', now()),
  (pg_temp.u('ec03'), 'ceb-v@test.invalid', 'authenticated', 'authenticated', now()),
  (pg_temp.u('ec04'), 'ceb-e@test.invalid', 'authenticated', 'authenticated', now()),
  (pg_temp.u('ec05'), 'ceb-p@test.invalid', 'authenticated', 'authenticated', now()),
  (pg_temp.u('ec06'), 'ceb-g@test.invalid', 'authenticated', 'authenticated', now()),
  (pg_temp.u('ec07'), 'ceb-x@test.invalid', 'authenticated', 'authenticated', now()),
  (pg_temp.u('ec08'), 'ceb-rm@test.invalid', 'authenticated', 'authenticated', now());
update public.workspace_settings set owner_id = pg_temp.u('ec01') where id;
insert into public.members (user_id, role, removed_at) values
  (pg_temp.u('ec01'), 'owner', null), (pg_temp.u('ec02'), 'member', null), (pg_temp.u('ec03'), 'member', null),
  (pg_temp.u('ec04'), 'member', null), (pg_temp.u('ec05'), 'member', null), (pg_temp.u('ec06'), 'guest', null),
  (pg_temp.u('ec07'), 'member', null), (pg_temp.u('ec08'), 'member', now());
insert into public.workspaces (id, owner_id, name) values (pg_temp.u('eca1'), pg_temp.u('ec01'), 'P');
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  (pg_temp.u('ecb1'), pg_temp.u('eca1'), null, 'C', 'a0'),
  (pg_temp.u('ecb2'), pg_temp.u('eca1'), null, 'R', 'a1');
insert into public.grants (user_id, project_id, page_id, level) values
  (pg_temp.u('ec02'), null, pg_temp.u('ecb1'), 'comment'),
  (pg_temp.u('ec03'), null, pg_temp.u('ecb1'), 'view'),
  (pg_temp.u('ec04'), null, pg_temp.u('ecb1'), 'edit'),
  (pg_temp.u('ec05'), null, pg_temp.u('ecb1'), 'edit_pages'),
  (pg_temp.u('ec06'), null, pg_temp.u('ecb1'), 'comment'),
  (pg_temp.u('ec08'), null, pg_temp.u('ecb1'), 'comment');

-- Comentarios, escritos desde la consola (con fechas a mano):
--   k1 de a en C, nunca editado      k2 de a en C, respuesta a k1      k3 de o en R (a no ve la página)
--   k4 de la invitada en C           k5 de la sacada en C              k6 sin cuenta (de un link, o de afuera) en C
--   k7 de a en C, borrado            k8 de a en C, editado, con microsegundos en la fecha
--   k9 de a en C, para la versión mínima      ka de a en C, con saltos de línea, comillas y un emoji
insert into public.comments (id, page_id, thread_id, body, author_id, created_at, edited_at, updated_at, deleted_at, deleted_by) values
  (pg_temp.u('ecc1'), pg_temp.u('ecb1'), null, 'Original', pg_temp.u('ec02'), '2026-01-01 10:00+00', null, '2026-01-01 10:00+00', null, null),
  (pg_temp.u('ecc3'), pg_temp.u('ecb2'), null, 'En R', pg_temp.u('ec01'), '2026-01-01 10:00+00', null, '2026-01-01 10:00+00', null, null),
  (pg_temp.u('ecc4'), pg_temp.u('ecb1'), null, 'De la invitada', pg_temp.u('ec06'), '2026-01-01 10:00+00', null, '2026-01-01 10:00+00', null, null),
  (pg_temp.u('ecc5'), pg_temp.u('ecb1'), null, 'De la sacada', pg_temp.u('ec08'), '2026-01-01 10:00+00', null, '2026-01-01 10:00+00', null, null),
  (pg_temp.u('ecc6'), pg_temp.u('ecb1'), null, 'Sin cuenta', null, '2026-01-01 10:00+00', null, '2026-01-01 10:00+00', null, null),
  (pg_temp.u('ecc7'), pg_temp.u('ecb1'), null, 'Borrado', pg_temp.u('ec02'), '2026-01-01 10:00+00', null, '2026-01-01 11:00+00',
   '2026-01-01 11:00+00', pg_temp.u('ec02')),
  (pg_temp.u('ecc8'), pg_temp.u('ecb1'), null, 'Ya editado', pg_temp.u('ec02'), '2026-01-01 10:00+00',
   '2026-01-02 03:04:05.123456+00', '2026-01-02 03:04:05.123456+00', null, null),
  (pg_temp.u('ecc9'), pg_temp.u('ecb1'), null, 'Para la versión', pg_temp.u('ec02'), '2026-01-01 10:00+00', null, '2026-01-01 10:00+00', null, null),
  (pg_temp.u('ecca'), pg_temp.u('ecb1'), null, E'Línea 1\n  «dos» "tres" \U0001F3AC ', pg_temp.u('ec02'), '2026-01-01 10:00+00', null,
   '2026-01-01 10:00+00', null, null);
insert into public.comments (id, page_id, thread_id, body, author_id, created_at, updated_at) values
  (pg_temp.u('ecc2'), pg_temp.u('ecb1'), pg_temp.u('ecc1'), 'Respuesta', pg_temp.u('ec02'), '2026-01-01 10:05+00', '2026-01-01 10:05+00');

-- ---------------------------------------------------------------------------------------------------
-- La función: lo que recibe y devuelve, cómo corre y quién la ejecuta. Igual que la de dos argumentos.
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  f   constant regprocedure := 'public.edit_comment(uuid,text,text)'::regprocedure;
  old constant regprocedure := 'public.edit_comment(uuid,text)'::regprocedure;
begin
  assert (select p.proargnames = array['p_id', 'p_body', 'p_base'] and p.pronargdefaults = 0 from pg_proc p where p.oid = f),
    'los argumentos no son p_id, p_body y p_base, sin valores por defecto (un pedido con dos nombres no puede caer acá)';
  assert pg_get_function_result(f) = 'jsonb', 'no devuelve jsonb';
  assert pg_get_function_result(old) = 'void', 'la de dos argumentos dejó de devolver void';
  assert (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'edit_comment') = 2,
    'hay más (o menos) de dos firmas de edit_comment';
  -- Mismos atributos que la de siempre: definer, volátil, search_path vacío, mismo dueño y mismo lenguaje.
  assert (select (n.prosecdef, n.provolatile, n.proconfig, n.proowner, n.prolang, n.proisstrict, n.proleakproof, n.proparallel)
                 = (o.prosecdef, o.provolatile, o.proconfig, o.proowner, o.prolang, o.proisstrict, o.proleakproof, o.proparallel)
          from pg_proc n, pg_proc o where n.oid = f and o.oid = old), 'no corre con los mismos atributos que la de dos argumentos';
  assert (select p.prosecdef and p.provolatile = 'v' and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = f),
    'no es security definer, volátil y con search_path vacío';
  -- Mismos permisos: exactamente los de la de siempre (solo `authenticated`, además del dueño).
  assert (select n.proacl::text = o.proacl::text from pg_proc n, pg_proc o where n.oid = f and o.oid = old),
    format('los permisos no son los de la de dos argumentos: %s', (select p.proacl::text from pg_proc p where p.oid = f));
  assert has_function_privilege('authenticated', f, 'execute'), 'authenticated no la ejecuta';
  assert not has_function_privilege('anon', f, 'execute'), 'anon la ejecuta';
  assert not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = f and a.grantee = 0), 'PUBLIC la ejecuta';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Quien lo escribió, con comentar: edita si la base coincide; un comentario nunca editado no es un caso aparte.
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('ec02');
do $$
declare
  r jsonb;
begin
  r := pg_temp.edit('ecc1', 'Uno', 'Original');
  assert r = '{"conflict": false}'::jsonb, format('una edición que entra contesta %s', r);
  assert pg_temp.body_of('ecc1') = 'Uno', 'con la base que coincide no editó';
  assert (select edited_at = now() and updated_at = now() from public.comments where id = pg_temp.u('ecc1')),
    'no dejó la fecha de la edición ni la del cambio';
  -- Dos ediciones encadenadas: la segunda lleva de base el texto de la primera.
  r := pg_temp.edit('ecc1', 'Dos', 'Uno');
  assert r = '{"conflict": false}'::jsonb and pg_temp.body_of('ecc1') = 'Dos', 'la segunda edición encadenada no entró';
  -- Una respuesta se edita igual que un hilo.
  r := pg_temp.edit('ecc2', 'Respuesta corregida', 'Respuesta');
  assert r = '{"conflict": false}'::jsonb and pg_temp.body_of('ecc2') = 'Respuesta corregida', 'no editó una respuesta';
  -- El texto se compara tal cual: saltos de línea, comillas, un emoji y el espacio del final.
  r := pg_temp.edit('ecca', 'Nuevo', E'Línea 1\n  «dos» "tres" \U0001F3AC ');
  assert r = '{"conflict": false}'::jsonb and pg_temp.body_of('ecca') = 'Nuevo', 'un texto con saltos, comillas y emoji no coincidió consigo mismo';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- El conflicto: la base ya no es el texto. No escribe nada y contesta el texto y la fecha de ahora.
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  r      jsonb;
  before text;
begin
  -- k8 se editó desde otro dispositivo (ahora dice «Ya editado»); este todavía tenía «Antes».
  before := pg_temp.row_of('ecc8');
  r := pg_temp.edit('ecc8', 'Lo del teléfono', 'Antes');
  assert pg_temp.row_of('ecc8') = before, 'un conflicto escribió algo';
  assert r ->> 'conflict' = 'true' and r ->> 'body' = 'Ya editado', format('el conflicto contesta %s', r);
  -- La fecha viaja entera, con sus microsegundos, y nada más que esas tres claves.
  assert (r ->> 'edited_at')::timestamptz = '2026-01-02 03:04:05.123456+00'::timestamptz, format('la fecha del conflicto es %s', r ->> 'edited_at');
  assert (select array_agg(k order by k) from jsonb_object_keys(r) k) = array['body', 'conflict', 'edited_at'], format('el conflicto trae %s', r);
  -- Un espacio de más o de menos es otro texto.
  r := pg_temp.edit('ecc8', 'Lo del teléfono', 'Ya editado ');
  assert r ->> 'conflict' = 'true' and pg_temp.row_of('ecc8') = before, 'una base con un espacio de más entró';
  r := pg_temp.edit('ecc8', 'Lo del teléfono', 'ya editado');
  assert r ->> 'conflict' = 'true' and pg_temp.row_of('ecc8') = before, 'una base con otra mayúscula entró';
  r := pg_temp.edit('ecc8', 'Lo del teléfono', '');
  assert r ->> 'conflict' = 'true' and pg_temp.row_of('ecc8') = before, 'una base vacía entró';
  -- Un comentario nunca editado que cambió... no puede: si nunca se editó, su texto es el original. Lo que sí: el
  -- conflicto de uno que nunca se editó no existe, y el de uno editado una vez trae su fecha (arriba). Con la base
  -- nula no se compara nada: es un pedido mal armado, y no escribe.
  perform pg_temp.expect_error(format('select public.edit_comment(%L, %L, null)', pg_temp.u('ecc8'), 'Lo del teléfono'),
    'base_invalid', 'con la base nula');
  perform pg_temp.expect_error(format('select public.edit_comment(%L, %L, null)', pg_temp.u('ecc8'), 'Lo del teléfono'),
    '22023', 'con la base nula (código)');
  assert pg_temp.row_of('ecc8') = before, 'la base nula escribió algo';
  -- Un texto inválido con otra base: gana el conflicto (no escribe). Con la base bien, la restricción de la tabla.
  r := pg_temp.edit('ecc8', '   ', 'Antes');
  assert r ->> 'conflict' = 'true' and pg_temp.row_of('ecc8') = before, 'un texto vacío con otra base no dio conflicto';
  perform pg_temp.expect_error(format('select public.edit_comment(%L, %L, %L)', pg_temp.u('ecc8'), '   ', 'Ya editado'), '23514', 'edita con un texto vacío');
  perform pg_temp.expect_error(format('select public.edit_comment(%L, %L, %L)', pg_temp.u('ecc8'), repeat('x', 10001), 'Ya editado'), '23514',
    'edita con un texto de más de 10000 caracteres');
  assert pg_temp.row_of('ecc8') = before, 'un texto inválido escribió algo';

  -- Con el texto de ahora como base (lo que hace la app al quedarse con lo propio), entra.
  r := pg_temp.edit('ecc8', 'Lo del teléfono', r ->> 'body');
  assert r = '{"conflict": false}'::jsonb and pg_temp.body_of('ecc8') = 'Lo del teléfono', 'con la base de ahora no entró';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- El reintento de una edición que ya llegó (la respuesta se perdió): el mismo texto da bien y no escribe, aunque la
-- base ya no coincida, y antes de mirar el permiso.
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  r      jsonb;
  before text;
begin
  before := pg_temp.row_of('ecc8');
  r := pg_temp.edit('ecc8', 'Lo del teléfono', 'Ya editado');
  assert r = '{"conflict": false}'::jsonb, format('el reintento contesta %s', r);
  assert pg_temp.row_of('ecc8') = before, 'el reintento escribió algo (cambió una fecha)';
end;
$$;
-- Le bajan el permiso a ver: ya no edita, pero el reintento de lo que hizo sigue dando bien (como la de dos argumentos).
select pg_temp.as_console();
update public.grants set level = 'view' where user_id = pg_temp.u('ec02') and page_id = pg_temp.u('ecb1');
select pg_temp.as_user('ec02');
do $$
declare
  before constant text := pg_temp.row_of('ecc8');
begin
  assert pg_temp.edit('ecc8', 'Lo del teléfono', 'Ya editado') = '{"conflict": false}'::jsonb, 'con ver, el reintento de lo ya hecho no da bien';
  perform public.edit_comment(pg_temp.u('ecc8'), 'Lo del teléfono');
  assert pg_temp.row_of('ecc8') = before, 'con ver, un reintento escribió algo';
  -- (Es la autora: con el mismo texto es el reintento de arriba, que da bien.)
  perform pg_temp.both_refuse('ecc8', 'comment_denied', 'quien lo escribió, con ver', false);
  perform pg_temp.both_refuse('ecc1', 'comment_denied', 'quien lo escribió, con ver, otro comentario', false);
  -- El orden de los rechazos: uno suyo que además está borrado dice primero que ya no puede comentar, en las dos
  -- firmas, también con su mismo texto (borrado, el atajo del reintento no corre).
  perform pg_temp.both_refuse('ecc7', 'comment_denied', 'quien lo escribió, con ver, uno borrado');
end;
$$;
select pg_temp.as_console();
update public.grants set level = 'comment' where user_id = pg_temp.u('ec02') and page_id = pg_temp.u('ecb1');

-- ---------------------------------------------------------------------------------------------------
-- Quien no lo escribió no lo edita, tenga el nivel que tenga; y la respuesta no le dice nada del texto.
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  who text;
begin
  -- v: ver. e: editar. p: editar y crear páginas. o: la dueña (creó el proyecto). g: una invitada con comentar.
  foreach who in array array['ec03', 'ec04', 'ec05', 'ec01', 'ec06'] loop
    perform pg_temp.as_user(who);
    perform pg_temp.both_refuse('ecc1', 'not_allowed', who || ' edita un comentario ajeno');
    perform pg_temp.both_refuse('ecc8', 'not_allowed', who || ' edita un comentario ajeno ya editado');
  end loop;
  -- Uno sin cuenta (hecho por un link, o de afuera): nadie del equipo lo edita, ni la dueña.
  foreach who in array array['ec01', 'ec02', 'ec05'] loop
    perform pg_temp.as_user(who);
    perform pg_temp.both_refuse('ecc6', 'not_allowed', who || ' edita un comentario sin cuenta');
  end loop;
  perform pg_temp.as_console();
end;
$$;

-- La invitada edita el suyo como cualquiera, y con otra base no lo pisa.
select pg_temp.as_user('ec06');
do $$
declare
  r jsonb;
begin
  r := pg_temp.edit('ecc4', 'Pisado', 'otra base');
  assert r ->> 'conflict' = 'true' and r ->> 'body' = 'De la invitada' and r -> 'edited_at' = 'null'::jsonb,
    format('el conflicto de un comentario nunca editado contesta %s', r);
  assert pg_temp.body_of('ecc4') = 'De la invitada', 'la invitada pisó con otra base';
  assert pg_temp.edit('ecc4', 'De la invitada, corregido', 'De la invitada') = '{"conflict": false}'::jsonb
     and pg_temp.body_of('ecc4') = 'De la invitada, corregido', 'la invitada no edita lo suyo';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Quien no ve la página, o no es nadie: «no existe», exista o no, con cualquier base.
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  -- a no ve R. x es miembro sin permiso. La sacada escribió k5 y ya no ve nada.
  perform pg_temp.as_user('ec02');
  perform pg_temp.both_refuse('ecc3', 'comment_not_found', 'edita un comentario de una página que no ve');
  perform pg_temp.both_refuse('ecff', 'comment_not_found', 'edita un comentario que no existe');
  perform pg_temp.expect_error(format('select public.edit_comment(%L, %L, %L)', pg_temp.u('ecff'), 'x', 'y'), 'P0002', 'uno que no existe (código)');
  perform pg_temp.as_user('ec07');
  perform pg_temp.both_refuse('ecc1', 'comment_not_found', 'un miembro sin permiso edita');
  perform pg_temp.as_user('ec08');
  -- (Lo suyo con su mismo texto es el reintento de algo ya hecho: da bien antes de mirar el permiso, como siempre.)
  perform pg_temp.both_refuse('ecc5', 'comment_not_found', 'la sacada edita lo suyo', false);
  perform pg_temp.both_refuse('ecc1', 'comment_not_found', 'la sacada edita lo ajeno');
  -- Una sesión abierta con contraseña no es miembro de nada.
  perform pg_temp.as_user('ec02', '9.999', '[{"method": "password", "timestamp": 1790000000}]');
  perform pg_temp.both_refuse('ecc1', 'comment_not_found', 'una sesión con contraseña edita lo suyo', false);
  perform pg_temp.both_refuse('ecc4', 'comment_not_found', 'una sesión con contraseña edita lo ajeno');
  -- Una sesión sin persona.
  perform set_config('request.jwt.claims', '{"role": "authenticated"}', true);
  perform pg_temp.both_refuse('ecc1', 'comment_not_found', 'una sesión sin persona edita');
  perform pg_temp.both_refuse('ecc6', 'comment_not_found', 'una sesión sin persona edita uno sin cuenta');
  perform pg_temp.as_console();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Un comentario borrado no se edita (con cualquier base); un hilo resuelto sí: resolver no cambia el texto.
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('ec02');
do $$
declare
  r jsonb;
begin
  perform pg_temp.both_refuse('ecc7', 'comment_deleted', 'edita un comentario borrado');
  perform pg_temp.expect_error(format('select public.edit_comment(%L, %L, %L)', pg_temp.u('ecc7'), 'x', 'Borrado'), 'P0001', 'uno borrado (código)');
  -- Ni siquiera con su mismo texto (no es un reintento: está borrado).
  perform pg_temp.expect_error(format('select public.edit_comment(%L, %L, %L)', pg_temp.u('ecc7'), 'Borrado', 'Borrado'), 'comment_deleted',
    'edita uno borrado con su mismo texto');

  -- Lo borra y lo edita en la misma sesión: borrado.
  perform public.delete_comment(pg_temp.u('ecc2'));
  perform pg_temp.both_refuse('ecc2', 'comment_deleted', 'edita lo que acaba de borrar');

  -- El hilo se resuelve (desde otro dispositivo, o lo resuelve otra persona): la edición entra, y sigue resuelto.
  perform public.resolve_thread(pg_temp.u('ecc1'), true);
  r := pg_temp.edit('ecc1', 'Tres', 'Dos');
  assert r = '{"conflict": false}'::jsonb and pg_temp.body_of('ecc1') = 'Tres', format('editar un hilo resuelto contesta %s', r);
  assert (select resolved_at is not null and resolved_by = pg_temp.u('ec02') from public.comments where id = pg_temp.u('ecc1')),
    'editar reabrió el hilo';
  perform public.resolve_thread(pg_temp.u('ecc1'), false);
  r := pg_temp.edit('ecc1', 'Cuatro', 'Tres');
  assert r = '{"conflict": false}'::jsonb and pg_temp.body_of('ecc1') = 'Cuatro', 'editar un hilo reabierto no entró';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- La versión mínima: la frena el trigger de la tabla cuando la función escribe. Un conflicto no escribe.
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_console();
update public.workspace_settings set min_app_version = '9.000' where id;
select pg_temp.as_user('ec02', '0.100');
do $$
declare
  before constant text := pg_temp.row_of('ecc9');
  r jsonb;
begin
  perform pg_temp.expect_error(format('select public.edit_comment(%L, %L, %L)', pg_temp.u('ecc9'), 'De una app vieja', 'Para la versión'),
    'PGRST', 'una app por debajo de la mínima edita con base');
  perform pg_temp.expect_error(format('select public.edit_comment(%L, %L)', pg_temp.u('ecc9'), 'De una app vieja'),
    'PGRST', 'una app por debajo de la mínima edita');
  assert pg_temp.row_of('ecc9') = before, 'una app por debajo de la mínima escribió';
  -- Lo que no escribe no pasa por el trigger: el conflicto y el reintento contestan igual.
  r := pg_temp.edit('ecc9', 'De una app vieja', 'otra base');
  assert r ->> 'conflict' = 'true' and r ->> 'body' = 'Para la versión', format('por debajo de la mínima, el conflicto contesta %s', r);
  assert pg_temp.edit('ecc9', 'Para la versión', 'otra base') = '{"conflict": false}'::jsonb, 'por debajo de la mínima, el reintento no da bien';
  assert pg_temp.row_of('ecc9') = before, 'por debajo de la mínima, algo escribió';
end;
$$;
select pg_temp.as_user('ec02', '9.000');
do $$
begin
  assert pg_temp.edit('ecc9', 'De la app al día', 'Para la versión') = '{"conflict": false}'::jsonb
     and pg_temp.body_of('ecc9') = 'De la app al día', 'una app en la mínima no edita';
end;
$$;
select pg_temp.as_console();
update public.workspace_settings set min_app_version = null where id;

-- ---------------------------------------------------------------------------------------------------
-- La firma de dos argumentos sigue haciendo lo de siempre: guarda lo que llega, devuelve void.
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('ec02');
do $$
declare
  before text;
begin
  -- No mira ninguna base: pisa (es lo que hace una app publicada, y lo que la firma nueva evita).
  perform public.edit_comment(pg_temp.u('ecc1'), 'Pisado por la de dos argumentos');
  assert pg_temp.body_of('ecc1') = 'Pisado por la de dos argumentos', 'la de dos argumentos dejó de guardar lo que llega';
  perform public.edit_comment(pg_temp.u('ecc1'), 'Otra vez');
  assert pg_temp.body_of('ecc1') = 'Otra vez', 'la de dos argumentos no editó dos veces seguidas';
  -- El mismo texto no cambia nada.
  before := pg_temp.row_of('ecc1');
  perform public.edit_comment(pg_temp.u('ecc1'), 'Otra vez');
  assert pg_temp.row_of('ecc1') = before, 'la de dos argumentos escribe con el mismo texto';
  perform pg_temp.expect_error(format('select public.edit_comment(%L, %L)', pg_temp.u('ecc1'), ''), '23514', 'la de dos argumentos acepta un texto vacío');
  -- Y la nueva, sobre lo que dejó la de siempre.
  assert pg_temp.edit('ecc1', 'Con base', 'Otra vez') = '{"conflict": false}'::jsonb and pg_temp.body_of('ecc1') = 'Con base',
    'la nueva no edita sobre lo que dejó la de dos argumentos';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Sin sesión: nada, tampoco con el header de un link.
-- ---------------------------------------------------------------------------------------------------
select set_config('role', 'anon', true);
select set_config('request.jwt.claims', '{"role": "anon"}', true);
do $$
begin
  perform pg_temp.expect_error(format('select public.edit_comment(%L, %L, %L)', pg_temp.u('ecc1'), 'x', 'Con base'), '42501', 'anon edita con base');
  perform pg_temp.expect_error(format('select public.edit_comment(%L, %L, %L)', pg_temp.u('ecc1'), 'x', 'Con base'),
    'permission denied for function edit_comment', 'anon edita con base (mensaje)');
  perform set_config('request.headers', json_build_object('x-shotdocs-link', 'sdl_' || rpad('ec', 43, 'x'))::text, true);
  perform pg_temp.expect_error(format('select public.edit_comment(%L, %L, %L)', pg_temp.u('ecc6'), 'x', 'Sin cuenta'), '42501', 'un link edita con base');
end;
$$;

-- Nada cambió de lo que no se podía tocar, y la versión de la base no se movió.
select pg_temp.as_console();
do $$
begin
  assert pg_temp.body_of('ecc3') = 'En R' and pg_temp.body_of('ecc5') = 'De la sacada' and pg_temp.body_of('ecc6') = 'Sin cuenta'
     and pg_temp.body_of('ecc7') = 'Borrado', 'cambió un comentario que nadie podía editar';
  assert (select count(*) from public.comments where id::text like '00000000-0000-4000-8000-00000000ecc%') = 10, 'faltan o sobran comentarios';
end;
$$;

rollback;

select 'ok' as result;
