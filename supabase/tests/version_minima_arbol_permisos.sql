-- Pruebas de la versión mínima en el árbol y los comentarios (20261008120000_version_minima_arbol.sql): la escritura
-- directa de `pages` y `workspaces` y las funciones de comentarios miran el header `x-shotdocs-version`; sin header
-- (versiones anteriores a 0.0XX) se rechaza solo con una mínima de 0.0XX o más. El rechazo es el error de PostgREST
-- con estado 503 y mensaje `app_outdated`, y no escribe nada. Leer sigue andando. Corre dentro de una transacción que
-- se deshace al final: no deja usuarios ni datos. Si todo pasa, devuelve una fila con result = 'ok'.
--
-- OJO: 0.0XX es el mismo número que en la migración (quien publica lo cambia en los dos).

begin;

-- La sesión de una persona, con los headers que mandaría su app: `version` null es una versión sin header.
create function pg_temp.as_user(uid uuid, version text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', uid, 'role', 'authenticated')::text, true),
         set_config('request.headers',
                    case when version is null then json_build_object('accept', '*/*')
                         else json_build_object('accept', '*/*', 'x-shotdocs-version', version) end::text, true);
$$;

-- La consola (sin sesión de la app ni headers).
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

-- Corre `stmt` y exige el rechazo por versión: sqlstate PGRST, mensaje `app_outdated` y estado 503.
create function pg_temp.expect_outdated(stmt text, what text) returns void language plpgsql as $$
declare
  d text;
begin
  begin
    execute stmt;
  exception when others then
    get stacked diagnostics d = pg_exception_detail;
    if sqlstate = 'PGRST' and (sqlerrm::json ->> 'message') = 'app_outdated'
       and (d::json ->> 'status') = '503' then
      return;
    end if;
    raise exception 'FALLA: % (dio % % / %)', what, sqlstate, sqlerrm, d;
  end;
  raise exception 'FALLA: % (no rechazó)', what;
end;
$$;

-- Una huella de lo que se puede escribir: lo rechazado no la cambia. Como definer: la sesión no lee `comments.body`.
create function pg_temp.snapshot() returns text language sql security definer as $$
  select (select string_agg(id::text || ':' || title || ':' || coalesce(parent_id::text, '-') || ':' ||
                            coalesce(deleted_at::text, '-') || ':' || coalesce(icon, '-'), ',' order by id)
          from public.pages where workspace_id in ('00000000-0000-4000-8000-00000000a0e1', '00000000-0000-4000-8000-00000000a0e2'))
      || '|' ||
         (select string_agg(id::text || ':' || name, ',' order by id)
          from public.workspaces where owner_id = '00000000-0000-4000-8000-00000000a0a1')
      || '|' ||
         (select string_agg(id::text || ':' || body || ':' || coalesce(resolved_at::text, '-') || ':' ||
                            coalesce(deleted_at::text, '-'), ',' order by id)
          from public.comments where page_id = '00000000-0000-4000-8000-00000000a0d1');
$$;

-- Personas: a (admin, dueña del proyecto P: puede crear proyectos) y b (miembro sin permiso en P).
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-00000000a0a1', 'va-a@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000a0b1', 'va-b@test.invalid', 'authenticated', 'authenticated');
insert into public.members (user_id, role) values
  ('00000000-0000-4000-8000-00000000a0a1', 'admin'),
  ('00000000-0000-4000-8000-00000000a0b1', 'member');
insert into public.workspaces (id, owner_id, name) values
  ('00000000-0000-4000-8000-00000000a0e1', '00000000-0000-4000-8000-00000000a0a1', 'P');
insert into public.pages (id, workspace_id, title, sort_key) values
  ('00000000-0000-4000-8000-00000000a0d1', '00000000-0000-4000-8000-00000000a0e1', 'p1', 'a0'),
  ('00000000-0000-4000-8000-00000000a0d2', '00000000-0000-4000-8000-00000000a0e1', 'p2', 'a1');
-- Un hilo de a en p1, escrito desde la consola (el trigger no mira la consola).
insert into public.comments (id, page_id, body, author_id) values
  ('00000000-0000-4000-8000-00000000a0c1', '00000000-0000-4000-8000-00000000a0d1', 'hilo', '00000000-0000-4000-8000-00000000a0a1');

-- ---------------------------------------------------------------------------------------------------
-- Sin mínima: todo anda, con header, sin header y con un header ilegible.
-- ---------------------------------------------------------------------------------------------------
update public.workspace_settings set min_app_version = null;
select pg_temp.as_user('00000000-0000-4000-8000-00000000a0a1', null);
do $$
declare
  ws constant uuid := '00000000-0000-4000-8000-00000000a0e1';
  p1 constant uuid := '00000000-0000-4000-8000-00000000a0d1';
begin
  assert private.write_version_allowed(), 'sin mínima: sin header no deja';
  insert into public.pages (id, workspace_id, title, sort_key) values ('00000000-0000-4000-8000-00000000a1d1', ws, 'nueva', 'b0');
  update public.pages set title = 'p1 sin header' where id = p1;
  perform public.add_comment('00000000-0000-4000-8000-00000000a1c1', p1, null, null, 'sin header');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-00000000a0a1', 'abc');
do $$
begin
  assert private.write_version_allowed(), 'sin mínima: un header ilegible no deja';
  update public.pages set icon = 'x' where id = '00000000-0000-4000-8000-00000000a0d1';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Mínima menor a 0.0XX: con header se compara; sin header anda (quien llama puede ser una versión permitida, como la
-- v0.098 publicada).
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_console();
update public.workspace_settings set min_app_version = 0.0XX - 0.001;
select pg_temp.as_user('00000000-0000-4000-8000-00000000a0a1', '0.001');
do $$
declare
  before text := pg_temp.snapshot();
  ws constant uuid := '00000000-0000-4000-8000-00000000a0e1';
  p1 constant uuid := '00000000-0000-4000-8000-00000000a0d1';
begin
  assert not private.write_version_allowed(), 'mínima menor: una 0.001 con header pasa';
  perform pg_temp.expect_outdated(format('insert into public.pages (id, workspace_id, title, sort_key) values (%L, %L, %L, %L)',
    '00000000-0000-4000-8000-00000000a1d2', ws, 'vieja', 'c0'), 'mínima menor: una 0.001 crea una página');
  perform pg_temp.expect_outdated(format('update public.pages set title = %L where id = %L', 'vieja', p1),
    'mínima menor: una 0.001 renombra');
  perform pg_temp.expect_outdated(format('select public.add_comment(%L, %L, null, null, %L)',
    '00000000-0000-4000-8000-00000000a1c2', p1, 'vieja'), 'mínima menor: una 0.001 comenta');
  assert pg_temp.snapshot() = before, 'mínima menor: lo rechazado escribió algo';
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-00000000a0a1', null);
do $$
declare
  p1 constant uuid := '00000000-0000-4000-8000-00000000a0d1';
begin
  assert private.write_version_allowed(), 'mínima menor: sin header no deja';
  update public.pages set title = 'p1 v0.098' where id = p1;
  update public.workspaces set name = 'P renombrado' where id = '00000000-0000-4000-8000-00000000a0e1';
  perform public.edit_comment('00000000-0000-4000-8000-00000000a1c1', 'editado sin header');
  perform public.resolve_thread('00000000-0000-4000-8000-00000000a0c1', true);
  assert (select title from public.pages where id = p1) = 'p1 v0.098', 'mínima menor: sin header no renombró';
end;
$$;
select pg_temp.as_console();
do $$
begin
  assert (select min_app_version from public.workspace_settings where id) = 0.0XX - 0.001, 'mínima menor: no quedó';
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-00000000a0a1', (select (0.0XX - 0.001)::text));
do $$
begin
  assert private.write_version_allowed(), 'mínima menor: la mínima con header no pasa';
  update public.pages set icon = 'y' where id = '00000000-0000-4000-8000-00000000a0d1';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Mínima 0.0XX o más: sin header (versiones anteriores) y con un header menor o ilegible no se escribe nada. Leer sí.
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_console();
update public.workspace_settings set min_app_version = 0.0XX;
do $$
declare
  ws constant uuid := '00000000-0000-4000-8000-00000000a0e1';
  p1 constant uuid := '00000000-0000-4000-8000-00000000a0d1';
  p2 constant uuid := '00000000-0000-4000-8000-00000000a0d2';
  v  text;
  before text;
begin
  foreach v in array array[null, '', '   ', '0.001', 'abc', (0.0XX - 0.001)::text] loop
    perform pg_temp.as_user('00000000-0000-4000-8000-00000000a0a1', v);
    before := pg_temp.snapshot();
    assert not private.write_version_allowed(), 'mínima 0.0XX: pasa con ' || coalesce(quote_literal(v), 'sin header');
    perform pg_temp.expect_outdated(format('insert into public.pages (id, workspace_id, title, sort_key) values (%L, %L, %L, %L)',
      '00000000-0000-4000-8000-00000000a1d3', ws, 'vieja', 'c0'), 'mínima 0.0XX: crea una página con ' || coalesce(quote_literal(v), 'sin header'));
    -- Reintentar una creación que ya está (`upsert` sin pisar) también se rechaza: la política mira la fila propuesta.
    perform pg_temp.expect_outdated(format('insert into public.pages (id, workspace_id, title, sort_key) values (%L, %L, %L, %L) on conflict (id) do nothing',
      p2, ws, 'p2', 'a1'), 'mínima 0.0XX: reintenta crear una página que ya está');
    perform pg_temp.expect_outdated(format('update public.pages set title = %L where id = %L', 'vieja', p1), 'mínima 0.0XX: renombra');
    perform pg_temp.expect_outdated(format('update public.pages set parent_id = %L, sort_key = %L where id = %L', p2, 'z0', p1), 'mínima 0.0XX: mueve');
    perform pg_temp.expect_outdated(format('update public.pages set deleted_at = now() where id = %L', p1), 'mínima 0.0XX: manda a la papelera');
    perform pg_temp.expect_outdated(format('update public.pages set icon = %L, settings = %L where id = %L', 'z', '{"paper":"A4"}', p1), 'mínima 0.0XX: cambia ícono y formato');
    perform pg_temp.expect_outdated(format('insert into public.workspaces (id, name) values (%L, %L)',
      '00000000-0000-4000-8000-00000000a0e2', 'Q'), 'mínima 0.0XX: crea un proyecto');
    perform pg_temp.expect_outdated(format('update public.workspaces set name = %L where id = %L', 'viejo', ws), 'mínima 0.0XX: renombra el proyecto');
    perform pg_temp.expect_outdated(format('select public.add_comment(%L, %L, null, null, %L)',
      '00000000-0000-4000-8000-00000000a1c3', p1, 'vieja'), 'mínima 0.0XX: comenta');
    perform pg_temp.expect_outdated(format('select public.add_comment(%L, %L, null, %L, %L)',
      '00000000-0000-4000-8000-00000000a1c4', p1, '00000000-0000-4000-8000-00000000a0c1', 'respuesta'), 'mínima 0.0XX: responde');
    perform pg_temp.expect_outdated(format('select public.edit_comment(%L, %L)',
      '00000000-0000-4000-8000-00000000a1c1', 'editado viejo'), 'mínima 0.0XX: edita un comentario');
    perform pg_temp.expect_outdated(format('select public.delete_comment(%L)', '00000000-0000-4000-8000-00000000a1c1'),
      'mínima 0.0XX: borra un comentario');
    perform pg_temp.expect_outdated(format('select public.resolve_thread(%L, false)', '00000000-0000-4000-8000-00000000a0c1'),
      'mínima 0.0XX: vuelve a abrir un hilo');
    perform pg_temp.expect_outdated(format('select public.import_comment(%L, %L, null, null, %L, now(), null, %L, null, null)',
      '00000000-0000-4000-8000-00000000a1c5', p1, 'importado', 'coda'), 'mínima 0.0XX: importa un comentario');
    assert pg_temp.snapshot() = before, 'mínima 0.0XX: lo rechazado escribió algo con ' || coalesce(quote_literal(v), 'sin header');
    -- Leer sigue andando: la versión vieja baja el árbol y los comentarios.
    assert (select count(*) from public.pages where workspace_id = ws) = 3, 'mínima 0.0XX: no lee el árbol';
    assert (select count(*) from public.list_comments(p1, null)) >= 2, 'mínima 0.0XX: no lee los comentarios';
    -- Lo que ya está hecho no escribe nada y no se rechaza (el reintento de algo que ya llegó).
    perform public.edit_comment('00000000-0000-4000-8000-00000000a1c1', 'editado sin header');
    perform public.resolve_thread('00000000-0000-4000-8000-00000000a0c1', true);
  end loop;
end;
$$;

-- La mínima y las mayores con header escriben todo; reintentar no duplica.
do $$
declare
  ws constant uuid := '00000000-0000-4000-8000-00000000a0e1';
  p1 constant uuid := '00000000-0000-4000-8000-00000000a0d1';
  p2 constant uuid := '00000000-0000-4000-8000-00000000a0d2';
  v  text;
begin
  foreach v in array array[(0.0XX)::text, '1.2'] loop
    perform pg_temp.as_user('00000000-0000-4000-8000-00000000a0a1', v);
    assert private.write_version_allowed(), 'mínima 0.0XX: no pasa ' || v;
    insert into public.pages (id, workspace_id, title, sort_key) values ('00000000-0000-4000-8000-00000000a1d3', ws, 'nueva ' || v, 'c0')
      on conflict (id) do nothing;
    update public.pages set title = 'p1 ' || v, parent_id = p2, sort_key = 'z0', icon = 'i', settings = '{"paper":"A4"}' where id = p1;
    update public.pages set deleted_at = now() where id = '00000000-0000-4000-8000-00000000a1d1';
    insert into public.workspaces (id, name) values ('00000000-0000-4000-8000-00000000a0e2', 'Q')
      on conflict (id) do nothing;
    update public.workspaces set name = 'P ' || v where id = ws;
    perform public.add_comment('00000000-0000-4000-8000-00000000a1c3', p1, null, null, 'nueva');
    perform public.add_comment('00000000-0000-4000-8000-00000000a1c4', p1, null, '00000000-0000-4000-8000-00000000a0c1', 'respuesta');
    perform public.edit_comment('00000000-0000-4000-8000-00000000a1c1', 'editado ' || v);
    perform public.resolve_thread('00000000-0000-4000-8000-00000000a0c1', v = '1.2');
    perform public.import_comment('00000000-0000-4000-8000-00000000a1c5', p1, null, null, 'importado', '2026-01-01T00:00:00Z', null, 'coda', null, null);
    assert (select title from public.pages where id = p1) = 'p1 ' || v, 'mínima 0.0XX: no renombró con ' || v;
    assert (select name from public.workspaces where id = ws) = 'P ' || v, 'mínima 0.0XX: no renombró el proyecto con ' || v;
    assert (select body from public.comments_view where id = '00000000-0000-4000-8000-00000000a1c1') = 'editado ' || v, 'mínima 0.0XX: no editó con ' || v;
  end loop;
  perform public.delete_comment('00000000-0000-4000-8000-00000000a1c3');
  assert (select count(*) from public.pages where workspace_id = ws) = 4, 'mínima 0.0XX: crear duplicó o no creó';
  assert (select count(*) from public.comments where page_id = p1) = 5, 'mínima 0.0XX: comentar duplicó o no comentó';
  assert (select deleted_at is not null from public.comments where id = '00000000-0000-4000-8000-00000000a1c3'), 'mínima 0.0XX: no borró';
end;
$$;

-- El permiso va antes que la versión: sin permiso, lo de siempre (el update no ve la fila; comentar, page_not_found).
select pg_temp.as_user('00000000-0000-4000-8000-00000000a0b1', null);
do $$
declare
  n int;
begin
  update public.pages set title = 'ajena' where id = '00000000-0000-4000-8000-00000000a0d2';
  get diagnostics n = row_count;
  assert n = 0, 'sin permiso: cambió una página ajena';
  perform pg_temp.expect_error(format('select public.add_comment(%L, %L, null, null, %L)',
    '00000000-0000-4000-8000-00000000a1c6', '00000000-0000-4000-8000-00000000a0d1', 'ajeno'),
    'page_not_found', 'sin permiso: comenta o dice otra cosa');
end;
$$;

-- La consola y las migraciones (sin sesión de la app) no se frenan.
select pg_temp.as_console();
do $$
begin
  update public.pages set title = 'consola' where id = '00000000-0000-4000-8000-00000000a0d2';
  update public.comments set body = 'consola' where id = '00000000-0000-4000-8000-00000000a0c1';
end;
$$;

-- Sin sesión: nada.
select set_config('role', 'anon', true);
do $$
begin
  perform pg_temp.expect_error($q$select private.require_write_version()$q$, '42501', 'anon llama a require_write_version');
  perform pg_temp.expect_error($q$select private.write_version_allowed()$q$, '42501', 'anon llama a write_version_allowed');
  perform pg_temp.expect_error($q$select private.comments_write_version()$q$, '42501', 'anon llama al trigger');
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-00000000a0a1', '9.999');
do $$
begin
  perform pg_temp.expect_error($q$select private.comments_write_version()$q$, '42501', 'una sesión llama al trigger');
end;
$$;

rollback;

select 'ok' as result;
