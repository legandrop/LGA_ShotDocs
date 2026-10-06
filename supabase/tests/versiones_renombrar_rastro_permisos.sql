-- Pruebas del rastro de los renombres de una versión con nombre (20261105120000_versiones_renombrar_rastro.sql,
-- Docs/Doc_Historial.md): cada nombre reemplazado queda en `page_version_labels` con quién lo cambió; `rename_page_version`
-- devuelve lo mismo que antes (mismo id, mismo dueño del nombre); lo que no cambia el nombre (repetirlo, un rechazo, sacar
-- el nombre, una marca de restauración) no deja fila; y la tabla está cerrada a la API. Corre dentro de una transacción
-- que se deshace al final: no deja usuarios ni datos. Si todo pasa, devuelve una fila con result = 'ok'.

begin;

-- La sesión de una persona, con el header de la versión que mandaría su app (`version` null: una app sin header).
create function pg_temp.as_user(uid uuid, version text default '9.999') returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', uid, 'role', 'authenticated')::text, true),
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

-- Corre `stmt` y exige el rechazo por versión: sqlstate PGRST, mensaje `app_outdated` y estado 503.
create function pg_temp.expect_outdated(stmt text, what text) returns void language plpgsql as $$
declare
  d text;
begin
  begin
    execute stmt;
  exception when others then
    get stacked diagnostics d = pg_exception_detail;
    if sqlstate = 'PGRST' and (sqlerrm::json ->> 'message') = 'app_outdated' and (d::json ->> 'status') = '503' then
      return;
    end if;
    raise exception 'FALLA: % (dio % % / %)', what, sqlstate, sqlerrm, d;
  end;
  raise exception 'FALLA: % (no rechazó)', what;
end;
$$;

-- Lo que hay en el rastro de una versión, en orden, como lo ve la consola: "nombre anterior<quién lo cambió".
create function pg_temp.trail(version uuid) returns text language sql security definer as $$
  select coalesce(string_agg(l.label || '<' || coalesce(right(l.replaced_by::text, 4), 'consola'), ' | ' order by l.id), '')
  from public.page_version_labels l where l.version_id = version;
$$;
create function pg_temp.trail_rows() returns bigint language sql security definer as $$
  select count(*) from public.page_version_labels;
$$;
create function pg_temp.label_of(version uuid) returns text language sql security definer as $$
  select label from public.page_versions where id = version;
$$;

-- Personas: a (creó el proyecto: nivel 4), e (Editar), d (Editar y crear páginas), v (Ver), g (invitada con Editar) y x
-- (sin permiso).
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-0000000c1a01', 'ras-a@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000c1e01', 'ras-e@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000c1d01', 'ras-d@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000c1f01', 'ras-v@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000c1b01', 'ras-g@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000c1001', 'ras-x@test.invalid', 'authenticated', 'authenticated');
insert into public.members (user_id, role) values
  ('00000000-0000-4000-8000-0000000c1a01', 'member'),
  ('00000000-0000-4000-8000-0000000c1e01', 'member'),
  ('00000000-0000-4000-8000-0000000c1d01', 'member'),
  ('00000000-0000-4000-8000-0000000c1f01', 'member'),
  ('00000000-0000-4000-8000-0000000c1b01', 'guest'),
  ('00000000-0000-4000-8000-0000000c1001', 'member');
insert into public.workspaces (id, owner_id, name) values
  ('00000000-0000-4000-8000-0000000c1e09', '00000000-0000-4000-8000-0000000c1a01', 'P');
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  ('00000000-0000-4000-8000-0000000c1d09', '00000000-0000-4000-8000-0000000c1e09', null, 'p1', 'a0');
insert into public.grants (user_id, project_id, page_id, level) values
  ('00000000-0000-4000-8000-0000000c1e01', '00000000-0000-4000-8000-0000000c1e09', null, 'edit'),
  ('00000000-0000-4000-8000-0000000c1d01', '00000000-0000-4000-8000-0000000c1e09', null, 'edit_pages'),
  ('00000000-0000-4000-8000-0000000c1f01', '00000000-0000-4000-8000-0000000c1e09', null, 'view'),
  ('00000000-0000-4000-8000-0000000c1b01', '00000000-0000-4000-8000-0000000c1e09', null, 'edit');
update public.workspace_settings set min_app_version = null;

-- Tres filas en p1: seq 1 (a), 2 (e), 3 (e).
select pg_temp.as_user('00000000-0000-4000-8000-0000000c1a01');
select public.push_page_update('00000000-0000-4000-8000-0000000c1d09', '00000000-0000-4000-8000-0000000c1101', 'AAA=', '9.999');
select pg_temp.as_user('00000000-0000-4000-8000-0000000c1e01');
select public.push_page_update('00000000-0000-4000-8000-0000000c1d09', '00000000-0000-4000-8000-0000000c1102', 'AAA=', '9.999');
select public.push_page_update('00000000-0000-4000-8000-0000000c1d09', '00000000-0000-4000-8000-0000000c1103', 'AAA=', '9.999');

-- ---------------------------------------------------------------------------------------------------
-- e nombra y renombra: cada nombre reemplazado queda, y lo que devuelve la función no cambia.
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  p1 constant uuid := '00000000-0000-4000-8000-0000000c1d09';
  n1 constant uuid := '00000000-0000-4000-8000-0000000c1701';
  e  constant uuid := '00000000-0000-4000-8000-0000000c1e01';
  r  public.page_version_row;
begin
  r := public.name_page_version(n1, p1, 1, 'Corte 1');
  assert pg_temp.trail(n1) = '', 'nombrar dejó una fila en el rastro';

  r := public.rename_page_version(n1, 'Corte 2');
  assert r.id = n1 and r.label = 'Corte 2' and r.seq = 1 and r.kind = 'named' and r.created_by = e,
    format('renombrar devuelve otra cosa: %s', r);
  assert pg_temp.trail(n1) = 'Corte 1<1e01', format('el primer renombre: %s', pg_temp.trail(n1));

  -- El mismo nombre (también con espacios de más, que la función saca) no deja fila.
  perform public.rename_page_version(n1, 'Corte 2');
  perform public.rename_page_version(n1, '  Corte   2 ');
  assert pg_temp.trail(n1) = 'Corte 1<1e01', 'repetir el nombre dejó una fila';

  -- Un nombre que no entra no cambia nada ni deja fila.
  perform pg_temp.expect_error(format('select public.rename_page_version(%L, %L)', n1, '   '), 'label_invalid', 'acepta un nombre vacío');
  perform pg_temp.expect_error(format('select public.rename_page_version(%L, %L)', n1, repeat('x', 101)), 'label_invalid', 'acepta 101 letras');
  assert pg_temp.trail(n1) = 'Corte 1<1e01' and pg_temp.label_of(n1) = 'Corte 2', 'un nombre rechazado dejó rastro o cambió el nombre';
end;
$$;

-- d (nivel 4) renombra el de e: queda el nombre que había puesto e y que lo cambió d; el nombre sigue siendo de e.
select pg_temp.as_user('00000000-0000-4000-8000-0000000c1d01');
do $$
declare
  n1 constant uuid := '00000000-0000-4000-8000-0000000c1701';
  r  public.page_version_row;
begin
  r := public.rename_page_version(n1, 'Entrega');
  assert r.id = n1 and r.label = 'Entrega' and r.created_by = '00000000-0000-4000-8000-0000000c1e01',
    'renombrar el de otro cambió el id o de quién es';
  assert pg_temp.trail(n1) = 'Corte 1<1e01 | Corte 2<1d01', format('el renombre de otra persona: %s', pg_temp.trail(n1));
end;
$$;
-- e sigue pudiendo renombrar el suyo.
select pg_temp.as_user('00000000-0000-4000-8000-0000000c1e01');
select public.rename_page_version('00000000-0000-4000-8000-0000000c1701', 'Entrega final');

-- ---------------------------------------------------------------------------------------------------
-- Quien no puede renombrar no deja rastro ni cambia el nombre.
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  n1 constant uuid := '00000000-0000-4000-8000-0000000c1701';
  n2 constant uuid := '00000000-0000-4000-8000-0000000c1702';
  a  constant uuid := '00000000-0000-4000-8000-0000000c1a01';
  e  constant uuid := '00000000-0000-4000-8000-0000000c1e01';
  rows_before bigint;
  stmt constant text := format('select public.rename_page_version(%L, %L)', '00000000-0000-4000-8000-0000000c1701', 'No');
begin
  -- Un nombre de a, para que e (Editar, no lo puso) no pueda.
  perform pg_temp.as_user(a);
  perform public.name_page_version(n2, '00000000-0000-4000-8000-0000000c1d09', 2, 'De a');
  rows_before := pg_temp.trail_rows();

  perform pg_temp.as_user(e);
  perform pg_temp.expect_error(format('select public.rename_page_version(%L, %L)', n2, 'No'), 'not_allowed', 'Editar renombra el de otra persona');
  perform pg_temp.as_user('00000000-0000-4000-8000-0000000c1f01');
  perform pg_temp.expect_error(stmt, 'page_not_found', 'Ver renombra');
  perform pg_temp.as_user('00000000-0000-4000-8000-0000000c1b01');
  perform pg_temp.expect_error(stmt, 'page_not_found', 'una invitada con Editar renombra');
  perform pg_temp.as_user('00000000-0000-4000-8000-0000000c1001');
  perform pg_temp.expect_error(stmt, 'page_not_found', 'sin permiso renombra');

  -- La versión mínima: el rechazo no cambia el nombre ni deja rastro.
  perform pg_temp.as_console();
  update public.workspace_settings set min_app_version = 0.099;
  perform pg_temp.as_user(e, null);
  perform pg_temp.expect_outdated(stmt, 'renombra sin header');
  perform pg_temp.as_user(e, '0.098');
  perform pg_temp.expect_outdated(stmt, 'renombra con una versión menor');
  perform pg_temp.as_console();
  update public.workspace_settings set min_app_version = null;

  assert pg_temp.trail_rows() = rows_before, 'alguien que no puede dejó una fila en el rastro';
  assert pg_temp.label_of(n1) = 'Entrega final' and pg_temp.label_of(n2) = 'De a', 'alguien que no puede cambió un nombre';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Sacar el nombre y las marcas de restauración no dejan fila; el rastro de un nombre sacado sigue.
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000c1e01');
do $$
declare
  p1 constant uuid := '00000000-0000-4000-8000-0000000c1d09';
  n1 constant uuid := '00000000-0000-4000-8000-0000000c1701';
  rows_before bigint := pg_temp.trail_rows();
begin
  perform public.mark_page_restored('00000000-0000-4000-8000-0000000c1703', p1, 3, 1);
  perform public.remove_page_version(n1);
  perform public.remove_page_version(n1);
  assert pg_temp.trail_rows() = rows_before, 'sacar el nombre o marcar una restauración dejó una fila';
  assert pg_temp.trail(n1) = 'Corte 1<1e01 | Corte 2<1d01 | Entrega<1e01', format('el rastro del nombre sacado: %s', pg_temp.trail(n1));
  -- Un nombre sacado ya no se renombra.
  perform pg_temp.expect_error(format('select public.rename_page_version(%L, %L)', n1, 'Otra vez'), 'version_not_found', 'renombra un nombre sacado');
  assert pg_temp.trail_rows() = rows_before, 'renombrar un nombre sacado dejó una fila';
end;
$$;

-- Desde la consola también queda, sin persona.
select pg_temp.as_console();
update public.page_versions set label = 'Consola' where id = '00000000-0000-4000-8000-0000000c1702';
do $$
begin
  assert pg_temp.trail('00000000-0000-4000-8000-0000000c1702') = 'De a<consola', 'un cambio desde la consola no quedó';
  -- Otra columna de la misma fila no deja fila.
  update public.page_versions set removed_at = now() where id = '00000000-0000-4000-8000-0000000c1702';
  assert pg_temp.trail('00000000-0000-4000-8000-0000000c1702') = 'De a<consola', 'cambiar otra columna dejó una fila';
  -- Con la sesión de una cuenta que no existe (su `sub` no está en `auth.users`): el renombre no falla por la clave
  -- foránea y queda sin persona.
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000c1fff", "role": "service_role"}', true);
  assert not exists (select 1 from auth.users where id = '00000000-0000-4000-8000-0000000c1fff'), 'la cuenta de la prueba existe';
  update public.page_versions set label = 'Sin cuenta' where id = '00000000-0000-4000-8000-0000000c1702';
  assert pg_temp.trail('00000000-0000-4000-8000-0000000c1702') = 'De a<consola | Consola<consola',
    format('el renombre de una cuenta que no existe: %s', pg_temp.trail('00000000-0000-4000-8000-0000000c1702'));
  assert (select count(*) from public.page_version_labels where replaced_by is not null and replaced_by not in (select id from auth.users)) = 0,
    'quedó una persona que no existe';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- La tabla y el trigger, cerrados a la API.
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  assert (select relrowsecurity from pg_class where oid = 'public.page_version_labels'::regclass), 'la tabla no tiene Row Level Security';
  assert not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'page_version_labels'), 'la tabla tiene políticas';
  assert not has_table_privilege('authenticated', 'public.page_version_labels', 'select, insert, update, delete, truncate'),
    'authenticated tiene privilegios sobre la tabla';
  assert not has_table_privilege('anon', 'public.page_version_labels', 'select, insert, update, delete, truncate'),
    'anon tiene privilegios sobre la tabla';
  assert not has_function_privilege('authenticated', 'private.page_versions_keep_label()', 'execute'), 'authenticated llama al trigger';
  assert not has_function_privilege('anon', 'private.page_versions_keep_label()', 'execute'), 'anon llama al trigger';
  assert (select p.prosecdef and p.proconfig @> array['search_path=""']
          from pg_proc p where p.oid = 'private.page_versions_keep_label()'::regprocedure), 'el trigger no fija search_path';
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000c1a01');
do $$
begin
  perform pg_temp.expect_error('select count(*) from public.page_version_labels', '42501', 'quien creó el proyecto lee el rastro');
  perform pg_temp.expect_error(
    $q$insert into public.page_version_labels (version_id, label) values ('00000000-0000-4000-8000-0000000c1701', 'x')$q$,
    '42501', 'quien creó el proyecto escribe el rastro');
  perform pg_temp.expect_error($q$update public.page_version_labels set label = 'x'$q$, '42501', 'quien creó el proyecto cambia el rastro');
  perform pg_temp.expect_error('delete from public.page_version_labels', '42501', 'quien creó el proyecto borra el rastro');
end;
$$;
select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  perform pg_temp.expect_error('select count(*) from public.page_version_labels', '42501', 'anon lee el rastro');
  perform pg_temp.expect_error(
    format('select public.rename_page_version(%L, %L)', '00000000-0000-4000-8000-0000000c1701', 'x'), '42501', 'anon renombra');
end;
$$;

-- Lo de siempre sigue igual: la lista de nombres de la página y `rename_page_version` con su firma y sus permisos.
select pg_temp.as_user('00000000-0000-4000-8000-0000000c1a01');
do $$
begin
  assert (select count(*) from public.list_page_versions('00000000-0000-4000-8000-0000000c1d09')) = 1, 'la lista de nombres cambió';
  assert has_function_privilege('authenticated', 'public.rename_page_version(uuid, text)', 'execute'), 'authenticated ya no renombra';
end;
$$;

rollback;

select 'ok' as result;
