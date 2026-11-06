-- Pruebas de *Share scenes* (20261118120000_compartir_escenas.sql, Docs/Doc_Compartir_Escenas.md, sección 6 y condiciones
-- 1 a 11 de la sección 8): quién puede llamar cada función (solo dueño o admin que puede compartir el proyecto; la marca
-- del árbol, quien puede compartirlo); `set_page_shares` pide el interruptor de lo borrado (`clean_off`), valida cada
-- página antes de escribir y rechaza todo con un único `page_invalid` (otro proyecto, papelera, inexistente, proyecto
-- borrado, sin marca de escena, una carpeta, una locación o un día); agregar y sacar tocan solo esos permisos, nunca baja
-- un nivel y nunca saca un Editar ni un permiso sobre el proyecto; la invitación de invitado nueva y la propia (solo
-- agregar, la de otro o con otro rol da error, tope de 200); un invitado con dos escenas no ve la tercera, ni la locación,
-- ni el día, ni las carpetas de arriba, ni sus filas de `page_updates`, `pull_page_updates`, comentarios ni archivos;
-- `project_page_shares` no muestra otros proyectos, y los permisos sobre páginas en la papelera van con `in_trash`;
-- sacar anda en la papelera; nada adentro marcado como otra escena, locación, día o decorado (`scene_contains_entities`);
-- el candado por correo y el miembro con una invitación viva; `pages_with_outside_readers` marca solo lo que ven
-- personas de afuera (no para un invitado dueño de un proyecto); `page_has_outside_readers` dice sí o no solo a quien
-- edita; el trigger `pages_scene_share_guard` no deja mover nada de afuera a una escena compartida (también como
-- postgres, también en dos pasos; adentro de la misma, o sacarlo, sí), ni crear o marcar adentro algo marcado, ni
-- desmarcar la escena compartida, y sí en una carpeta compartida con *Share*. Corre dentro de una transacción que se deshace al
-- final: no deja usuarios ni datos. Si todo pasa, devuelve una fila con result = 'ok'.

begin;

-- El interruptor empieza apagado (la prueba lo prende en la sección 3).
update public.workspace_settings set clean_min_version = null where id;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-00000000' || s)::uuid;
$$;

-- Una lista de sufijos (o uuids enteros) como uuid[].
create function pg_temp.us(list text[]) returns uuid[] language sql immutable as $$
  select coalesce(array_agg(case when length(x) = 4 then pg_temp.u(x) else x::uuid end order by o), '{}'::uuid[])
  from unnest(list) with ordinality as t(x, o);
$$;

-- Una sesión: `otp` (la de la app) o `password` (la que no ve nada, `session_allowed`).
create function pg_temp.as_user(s text, method text default 'otp') returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', pg_temp.u(s), 'role', 'authenticated',
                                      'amr', json_build_array(json_build_object('method', method, 'timestamp', 1)))::text, true),
         set_config('request.headers', json_build_object('x-shotdocs-version', '9.999')::text, true);
$$;

create function pg_temp.as_anon() returns void language sql as $$
  select set_config('role', 'anon', true),
         set_config('request.jwt.claims', '{"role": "anon"}', true),
         set_config('request.headers', '{}', true);
$$;

create function pg_temp.as_postgres() returns void language sql as $$
  select set_config('role', 'postgres', true),
         set_config('request.jwt.claims', '', true),
         set_config('request.headers', '', true);
$$;

-- Corre `stmt` y devuelve su valor (`<null>` si es nulo) o 'error:<mensaje>'.
create function pg_temp.val(stmt text) returns text language plpgsql as $$
declare
  v text;
begin
  execute stmt into v;
  return coalesce(v, '<null>');
exception when others then
  return 'error:' || sqlerrm;
end;
$$;

create function pg_temp.check(got text, want text, what text) returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FALLA: % (dio %, se esperaba %)', what, got, want;
  end if;
end;
$$;

create function pg_temp.run_as(who text, stmt text, method text default 'otp') returns text language plpgsql as $$
declare
  r text;
begin
  perform pg_temp.as_user(who, method);
  r := pg_temp.val(stmt);
  perform pg_temp.as_postgres();
  return r;
end;
$$;

-- `set_page_shares` sobre PR (o `proj`) como `who`: «member:n», «invited:n» o 'error:…'.
create function pg_temp.sps(who text, email text, adds text[], rems text[], lvl text default 'view',
                            proj text default 'e5e0', method text default 'otp') returns text language sql as $$
  select pg_temp.run_as(who, format(
    'select r ->> %L || %L || (r ->> %L) from public.set_page_shares(%L, %L, %L::uuid[], %L::uuid[], %L) r',
    'result', ':', 'pages', pg_temp.u(proj), email, pg_temp.us(adds), pg_temp.us(rems), lvl), method);
$$;

-- El permiso vivo de `who` sobre una página, o '(ninguno)'.
create function pg_temp.grant_of(who text, page text) returns text language sql as $$
  select coalesce((select level from public.grants where user_id = pg_temp.u(who) and page_id = pg_temp.u(page)
                   and revoked_at is null), '(ninguno)');
$$;

-- Los permisos vivos de `who` sobre páginas, «sufijo:nivel» ordenados, o '(ninguno)'.
create function pg_temp.grants_of(who text) returns text language sql as $$
  select coalesce(string_agg(right(page_id::text, 4) || ':' || level, ',' order by page_id), '(ninguno)')
  from public.grants where user_id = pg_temp.u(who) and page_id is not null and revoked_at is null;
$$;

-- Las invitaciones vivas de un correo: «rol|página:nivel,…» (una por invitación, ' / ' entre ellas), o '(ninguna)'.
create function pg_temp.inv_of(p_email text) returns text language sql as $$
  select coalesce(string_agg(x.txt, ' / ' order by x.created_at), '(ninguna)')
  from (
    select i.created_at, i.role || '|' || coalesce((
      select string_agg(case when el ? 'page_id' then right(el ->> 'page_id', 4) else 'proj' end || ':' || (el ->> 'level'),
                        ',' order by el ->> 'page_id')
      from jsonb_array_elements(i.grants) el), '') as txt
    from public.invitations i
    where i.email = p_email and i.used_at is null and i.revoked_at is null and i.expires_at > now()
  ) x;
$$;

create function pg_temp.reset_seq(page text) returns bigint language sql security definer as $$
  select pg.clean_reset_seq from public.pages pg where pg.id = pg_temp.u(page);
$$;

create function pg_temp.update_seq(page text) returns bigint language sql security definer as $$
  select pg.update_seq from public.pages pg where pg.id = pg_temp.u(page);
$$;

-- ---------------------------------------------------------------------------------------------------
-- Datos
-- ---------------------------------------------------------------------------------------------------
-- Personas: o (dueña del workspace y de PR), a (admin con Editar y crear páginas sobre PR), n (admin sin nada en PR),
-- c (miembro común que creó Q), g (invitado: el vendor), m (miembro con Editar sobre S1), w (miembro con Ver sobre todo
-- PR), x (cuenta sin membresía), k (miembro que entra con contraseña), d (admin con Editar y crear páginas solo sobre
-- S1), r (miembro con Ver sobre QS y sobre T, en la papelera), y (sacado del workspace), h (otro invitado), j (invitado
-- que es dueño de un proyecto, GP).
update public.members set removed_at = now() where role = 'owner' and removed_at is null;
insert into auth.users (id, email, aud, role) values
  (pg_temp.u('e5a0'), 'cs-o@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e5a1'), 'cs-a@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e5a2'), 'cs-n@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e5a3'), 'cs-c@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e5a4'), 'cs-g@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e5a5'), 'cs-m@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e5a6'), 'cs-w@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e5a7'), 'cs-x@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e5a8'), 'cs-k@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e5a9'), 'cs-d@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e5aa'), 'cs-r@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e5ab'), 'cs-y@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e5ac'), 'cs-h@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e5ad'), 'cs-j@test.invalid', 'authenticated', 'authenticated');
insert into public.members (user_id, role) values
  (pg_temp.u('e5a0'), 'owner'), (pg_temp.u('e5a1'), 'admin'), (pg_temp.u('e5a2'), 'admin'), (pg_temp.u('e5a3'), 'member'),
  (pg_temp.u('e5a4'), 'guest'), (pg_temp.u('e5a5'), 'member'), (pg_temp.u('e5a6'), 'member'), (pg_temp.u('e5a8'), 'member'),
  (pg_temp.u('e5a9'), 'admin'), (pg_temp.u('e5aa'), 'member'), (pg_temp.u('e5ab'), 'member'), (pg_temp.u('e5ac'), 'guest'),
  (pg_temp.u('e5ad'), 'guest');
update public.members set removed_at = now() where user_id = pg_temp.u('e5ab');
-- Proyectos: PR (de o), Q (de c), DEL (de o, borrado), GP (de j, un invitado).
insert into public.workspaces (id, owner_id, name) values
  (pg_temp.u('e5e0'), pg_temp.u('e5a0'), 'PR'),
  (pg_temp.u('e5e1'), pg_temp.u('e5a3'), 'Q'),
  (pg_temp.u('e5e2'), pg_temp.u('e5a0'), 'DEL'),
  (pg_temp.u('e5e3'), pg_temp.u('e5ad'), 'GP');
-- PR: DES (carpeta de escenas) › EP (episodio) › S1 (› F1, su ficha), S2, S3, S4 (sin marca), S5 (marca `false`),
-- S6 (escena), T (escena, en la papelera), S7 (escena › L7, una locación), S8 (escena › X, un día en la papelera), S9
-- (escena › H, una carpeta que guarda locaciones), EPS (un episodio marcado como escena › SS, una escena); LOC › L1
-- (locación); DAYS › D1 (día). Q: QS (escena). DEL: DS (escena). GP: GS (escena, que w ve con Ver).
insert into public.pages (id, workspace_id, parent_id, title, sort_key, settings) values
  (pg_temp.u('e5b0'), pg_temp.u('e5e0'), null, 'DES', 'a0', '{"holds": "scene"}'),
  (pg_temp.u('e5b1'), pg_temp.u('e5e0'), pg_temp.u('e5b0'), 'EP', 'a0', '{}'),
  (pg_temp.u('e5b2'), pg_temp.u('e5e0'), pg_temp.u('e5b1'), 'S1', 'a0', '{"entity": {"kind": "scene", "code": "105_001"}}'),
  (pg_temp.u('e5b3'), pg_temp.u('e5e0'), pg_temp.u('e5b2'), 'F1', 'a0', '{}'),
  (pg_temp.u('e5b4'), pg_temp.u('e5e0'), pg_temp.u('e5b1'), 'S2', 'a1', '{"entity": {"kind": "scene", "code": "105_002"}}'),
  (pg_temp.u('e5b5'), pg_temp.u('e5e0'), pg_temp.u('e5b1'), 'S3', 'a2', '{"entity": {"kind": "scene", "code": "105_003"}}'),
  (pg_temp.u('e5b6'), pg_temp.u('e5e0'), pg_temp.u('e5b1'), 'S4', 'a3', '{}'),
  (pg_temp.u('e5bc'), pg_temp.u('e5e0'), pg_temp.u('e5b1'), 'S5', 'a4', '{"entity": false}'),
  (pg_temp.u('e5bf'), pg_temp.u('e5e0'), pg_temp.u('e5b1'), 'S6', 'a5', '{"entity": {"kind": "scene", "code": "105_006"}}'),
  (pg_temp.u('e5bb'), pg_temp.u('e5e0'), pg_temp.u('e5b1'), 'T', 'a6', '{"entity": {"kind": "scene", "code": "105_009"}}'),
  (pg_temp.u('e5b7'), pg_temp.u('e5e0'), null, 'LOC', 'a1', '{"holds": "location"}'),
  (pg_temp.u('e5b8'), pg_temp.u('e5e0'), pg_temp.u('e5b7'), 'L1', 'a0', '{"entity": {"kind": "location"}}'),
  (pg_temp.u('e5b9'), pg_temp.u('e5e0'), null, 'DAYS', 'a2', '{}'),
  (pg_temp.u('e5ba'), pg_temp.u('e5e0'), pg_temp.u('e5b9'), 'D1', 'a0', '{"entity": {"kind": "day"}}'),
  (pg_temp.u('e5bd'), pg_temp.u('e5e1'), null, 'QS', 'a0', '{"entity": {"kind": "scene", "code": "105_001"}}'),
  (pg_temp.u('e5be'), pg_temp.u('e5e2'), null, 'DS', 'a0', '{"entity": {"kind": "scene", "code": "105_001"}}'),
  (pg_temp.u('e5d0'), pg_temp.u('e5e0'), pg_temp.u('e5b1'), 'S7', 'a7', '{"entity": {"kind": "scene", "code": "105_007"}}'),
  (pg_temp.u('e5d1'), pg_temp.u('e5e0'), pg_temp.u('e5d0'), 'L7', 'a0', '{"entity": {"kind": "location"}}'),
  (pg_temp.u('e5d2'), pg_temp.u('e5e0'), pg_temp.u('e5b1'), 'S8', 'a8', '{"entity": {"kind": "scene", "code": "105_008"}}'),
  (pg_temp.u('e5d3'), pg_temp.u('e5e0'), pg_temp.u('e5d2'), 'X', 'a0', '{"entity": {"kind": "day"}}'),
  (pg_temp.u('e5d4'), pg_temp.u('e5e0'), pg_temp.u('e5b1'), 'S9', 'a9', '{"entity": {"kind": "scene", "code": "105_010"}}'),
  (pg_temp.u('e5d5'), pg_temp.u('e5e0'), pg_temp.u('e5d4'), 'H', 'a0', '{"holds": "location"}'),
  (pg_temp.u('e5d6'), pg_temp.u('e5e0'), pg_temp.u('e5b0'), 'EPS', 'a1', '{"entity": {"kind": "scene", "code": "101"}}'),
  (pg_temp.u('e5d7'), pg_temp.u('e5e0'), pg_temp.u('e5d6'), 'SS', 'a0', '{"entity": {"kind": "scene", "code": "101_001"}}'),
  (pg_temp.u('e5d8'), pg_temp.u('e5e3'), null, 'GS', 'a0', '{"entity": {"kind": "scene", "code": "105_001"}}');
insert into public.grants (user_id, project_id, page_id, level) values
  (pg_temp.u('e5a1'), pg_temp.u('e5e0'), null, 'edit_pages'),
  (pg_temp.u('e5a6'), pg_temp.u('e5e0'), null, 'view'),
  (pg_temp.u('e5a5'), null, pg_temp.u('e5b2'), 'edit'),
  (pg_temp.u('e5a9'), null, pg_temp.u('e5b2'), 'edit_pages'),
  (pg_temp.u('e5aa'), null, pg_temp.u('e5bd'), 'view'),
  (pg_temp.u('e5aa'), null, pg_temp.u('e5bb'), 'view'),
  (pg_temp.u('e5a6'), null, pg_temp.u('e5d8'), 'view');
-- Invitaciones vivas: la de otra persona (a) y una propia de o con otro rol (miembro).
insert into public.invitations (email, role, grants, invited_by) values
  ('cs-otra@test.invalid', 'guest', jsonb_build_array(jsonb_build_object('page_id', pg_temp.u('e5b4'), 'level', 'view')), pg_temp.u('e5a1')),
  ('cs-rol@test.invalid', 'member', jsonb_build_array(jsonb_build_object('page_id', pg_temp.u('e5b4'), 'level', 'view')), pg_temp.u('e5a0'));

-- Contenido de las páginas (bytes cualquiera: la base no lee Yjs).
select pg_temp.as_user('e5a0');
select public.push_page_update(pg_temp.u('e5b0'), gen_random_uuid(), 'AQ==', '9.999');
select public.push_page_update(pg_temp.u('e5b1'), gen_random_uuid(), 'Ag==', '9.999');
select public.push_page_update(pg_temp.u('e5b2'), gen_random_uuid(), 'Aw==', '9.999');
select public.push_page_update(pg_temp.u('e5b3'), gen_random_uuid(), 'BA==', '9.999');
select public.push_page_update(pg_temp.u('e5b4'), gen_random_uuid(), 'BQ==', '9.999');
select public.push_page_update(pg_temp.u('e5b5'), gen_random_uuid(), 'Bg==', '9.999');
select public.push_page_update(pg_temp.u('e5b8'), gen_random_uuid(), 'Bw==', '9.999');
select public.push_page_update(pg_temp.u('e5ba'), gen_random_uuid(), 'CA==', '9.999');
-- Comentarios en S1, S3, L1 y D1.
select public.add_comment(pg_temp.u('e5c1'), pg_temp.u('e5b2'), null, null, 'En S1');
select public.add_comment(pg_temp.u('e5c3'), pg_temp.u('e5b5'), null, null, 'En S3');
select public.add_comment(pg_temp.u('e5c8'), pg_temp.u('e5b8'), null, null, 'En L1');
select public.add_comment(pg_temp.u('e5ca'), pg_temp.u('e5ba'), null, null, 'En D1');
select pg_temp.as_postgres();
-- Archivos: f1 en S1, f3 en S3, f8 en L1, fa en D1.
insert into public.files (id, project_id, name, mime, size, created_by) values
  (pg_temp.u('e5f1'), pg_temp.u('e5e0'), 's1.jpg', 'image/jpeg', 1, pg_temp.u('e5a0')),
  (pg_temp.u('e5f3'), pg_temp.u('e5e0'), 's3.jpg', 'image/jpeg', 1, pg_temp.u('e5a0')),
  (pg_temp.u('e5f8'), pg_temp.u('e5e0'), 'l1.jpg', 'image/jpeg', 1, pg_temp.u('e5a0')),
  (pg_temp.u('e5fa'), pg_temp.u('e5e0'), 'd1.jpg', 'image/jpeg', 1, pg_temp.u('e5a0'));
insert into public.page_files (page_id, file_id) values
  (pg_temp.u('e5b2'), pg_temp.u('e5f1')), (pg_temp.u('e5b5'), pg_temp.u('e5f3')),
  (pg_temp.u('e5b8'), pg_temp.u('e5f8')), (pg_temp.u('e5ba'), pg_temp.u('e5fa'));
-- T y X a la papelera y DEL borrado (después del contenido).
update public.pages set deleted_at = now() where id in (pg_temp.u('e5bb'), pg_temp.u('e5d3'));
update public.workspaces set deleted_at = now() where id = pg_temp.u('e5e2');

-- ---------------------------------------------------------------------------------------------------
-- 1. Las puertas
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  assert not has_function_privilege('anon', 'public.project_page_shares(uuid)', 'execute'), 'anon lista';
  assert not has_function_privilege('anon', 'public.set_page_shares(uuid, text, uuid[], uuid[], text)', 'execute'), 'anon comparte';
  assert not has_function_privilege('anon', 'public.pages_with_outside_readers(uuid)', 'execute'), 'anon pide la marca';
  assert not has_function_privilege('anon', 'public.page_has_outside_readers(uuid)', 'execute'), 'anon pregunta por una página';
  assert not has_function_privilege('public', 'public.set_page_shares(uuid, text, uuid[], uuid[], text)', 'execute'),
    'public comparte';
  assert has_function_privilege('authenticated', 'public.project_page_shares(uuid)', 'execute'), 'authenticated no lista';
  assert has_function_privilege('authenticated', 'public.set_page_shares(uuid, text, uuid[], uuid[], text)', 'execute'),
    'authenticated no comparte';
  assert has_function_privilege('authenticated', 'public.pages_with_outside_readers(uuid)', 'execute'),
    'authenticated no pide la marca';
  assert has_function_privilege('authenticated', 'public.page_has_outside_readers(uuid)', 'execute'),
    'authenticated no pregunta por una página';
  assert not has_function_privilege('authenticated', 'private.pages_scene_share_guard()', 'execute'),
    'authenticated ejecuta el trigger';
  assert (select count(*) = 4 and bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('project_page_shares', 'set_page_shares', 'pages_with_outside_readers',
                              'page_has_outside_readers')),
    'una función sin SECURITY DEFINER o sin search_path vacío';

  perform pg_temp.as_anon();
  perform pg_temp.check(pg_temp.val(format('select count(*) from public.project_page_shares(%L)', pg_temp.u('e5e0'))),
    'error:permission denied for function project_page_shares', 'anon lista (llamado)');
  perform pg_temp.check(pg_temp.val(format('select public.set_page_shares(%L, %L, %L::uuid[], null, %L)',
                                           pg_temp.u('e5e0'), 'cs-g@test.invalid', pg_temp.us(array['e5b2']), 'view')),
    'error:permission denied for function set_page_shares', 'anon comparte (llamado)');
  perform pg_temp.as_postgres();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 2. Quién puede: dueño o admin que puede compartir el proyecto (la marca: quien puede compartirlo)
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  who text;
begin
  -- Un miembro común que creó Q (puede compartirlo con *Share*), un invitado, una cuenta sin membresía, una sesión con
  -- contraseña, un admin sin nada en PR y un admin con 4 solo sobre una escena: ninguno.
  foreach who in array array['e5a3', 'e5a4', 'e5a7', 'e5a2', 'e5a9', 'e5a5', 'e5a6'] loop
    perform pg_temp.check(pg_temp.sps(who, 'cs-g@test.invalid', array['e5b2'], null), 'error:not_allowed', who || ' comparte en PR');
    perform pg_temp.check(pg_temp.run_as(who, format('select count(*) from public.project_page_shares(%L)', pg_temp.u('e5e0'))),
      'error:not_allowed', who || ' lista PR');
  end loop;
  perform pg_temp.check(pg_temp.sps('e5a3', 'cs-g@test.invalid', array['e5bd'], null, 'view', 'e5e1'), 'error:not_allowed',
    'c (miembro, creó Q) comparte escenas de Q');
  perform pg_temp.check(pg_temp.run_as('e5a3', format('select count(*) from public.project_page_shares(%L)', pg_temp.u('e5e1'))),
    'error:not_allowed', 'c lista Q');
  perform pg_temp.check(pg_temp.sps('e5a8', 'cs-g@test.invalid', array['e5b2'], null, 'view', 'e5e0', 'password'),
    'error:not_allowed', 'k con contraseña comparte');
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', array['e5b2'], null, 'view', 'e5e0', 'password'),
    'error:not_allowed', 'la dueña con contraseña comparte');
  -- La dueña del workspace no comparte Q (privado de c: no lo ve), ni el proyecto borrado, ni uno que no existe.
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', array['e5bd'], null, 'view', 'e5e1'), 'error:not_allowed', 'o comparte Q');
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', array['e5be'], null, 'view', 'e5e2'), 'error:not_allowed', 'o comparte DEL');
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', array['e5b2'], null, 'view', 'e5ff'), 'error:not_allowed',
    'o comparte un proyecto que no existe');
  perform pg_temp.check(pg_temp.run_as('e5a0', 'select count(*) from public.project_page_shares(null)'), 'error:not_allowed',
    'o lista sin proyecto');

  -- La marca del árbol: quien puede compartir el proyecto (también quien lo creó sin ser admin); nadie más.
  perform pg_temp.check(pg_temp.run_as('e5a3', format('select count(*) from public.pages_with_outside_readers(%L)', pg_temp.u('e5e1'))),
    '1', 'c pide la marca de Q (lo creó)');
  foreach who in array array['e5a3', 'e5a4', 'e5a7', 'e5a2', 'e5a9', 'e5a5', 'e5a6'] loop
    perform pg_temp.check(pg_temp.run_as(who, format('select count(*) from public.pages_with_outside_readers(%L)', pg_temp.u('e5e0'))),
      'error:not_allowed', who || ' pide la marca de PR');
  end loop;
  perform pg_temp.check(pg_temp.run_as('e5a0', format('select count(*) from public.pages_with_outside_readers(%L)', pg_temp.u('e5e0')),
                                       'password'), 'error:not_allowed', 'la dueña con contraseña pide la marca');
  -- j es invitado y dueño de GP (lo creó): ninguna de las funciones, tampoco la marca de su proyecto (B2).
  perform pg_temp.check(pg_temp.run_as('e5ad', format('select count(*) from public.pages_with_outside_readers(%L)', pg_temp.u('e5e3'))),
    'error:not_allowed', 'j (invitado, dueño de GP) pide la marca de GP');
  perform pg_temp.check(pg_temp.run_as('e5ad', format('select count(*) from public.project_page_shares(%L)', pg_temp.u('e5e3'))),
    'error:not_allowed', 'j lista GP');
  perform pg_temp.check(pg_temp.sps('e5ad', 'cs-h@test.invalid', array['e5d8'], null, 'view', 'e5e3'), 'error:not_allowed',
    'j comparte GS');
  perform pg_temp.check(pg_temp.run_as('e5ad', format('select public.page_has_outside_readers(%L)', pg_temp.u('e5d8'))),
    'false', 'j pregunta por GS');
  assert not exists (select 1 from public.grants where user_id = pg_temp.u('e5a4')), 'quedó un permiso de g';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 3. Sin el interruptor de lo borrado, no (C1); después se prende para el resto de la prueba
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', array['e5b2'], null), 'error:clean_off', 'o comparte sin el interruptor');
  perform pg_temp.check(pg_temp.sps('e5a1', 'cs-nuevo@test.invalid', array['e5b2'], null), 'error:clean_off', 'a invita sin el interruptor');
  assert not exists (select 1 from public.grants where user_id = pg_temp.u('e5a4')), 'sin interruptor quedó un permiso';
  assert pg_temp.inv_of('cs-nuevo@test.invalid') = '(ninguna)', 'sin interruptor quedó una invitación';
  -- La marca del árbol no depende del interruptor: S2 está en dos invitaciones (de a, y de o con rol de miembro).
  perform pg_temp.check(pg_temp.run_as('e5a0', format('select count(*) from public.pages_with_outside_readers(%L)', pg_temp.u('e5e0'))),
    '1', 'o pide la marca sin el interruptor');
end;
$$;

update public.workspace_settings set min_app_version = coalesce(min_app_version, 0.001) where id;
update public.workspace_settings set clean_min_version = min_app_version where id;

-- ---------------------------------------------------------------------------------------------------
-- 4. Lo que se pide: nivel, correo, listas y cada página. Todo o nada, sin decir cuál página falló
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  many text[];
  bad text;
begin
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', array['e5b2'], null, 'edit'), 'error:level_invalid', 'nivel edit');
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', array['e5b2'], null, 'edit_pages'), 'error:level_invalid', 'nivel edit_pages');
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', array['e5b2'], null, null), 'error:level_invalid', 'sin nivel');
  perform pg_temp.check(pg_temp.sps('e5a0', 'no-es-correo', array['e5b2'], null), 'error:email_invalid', 'un correo roto');
  perform pg_temp.check(pg_temp.sps('e5a0', null, array['e5b2'], null), 'error:email_invalid', 'sin correo');
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', null, null), 'error:pages_invalid', 'sin páginas');
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', array[]::text[], array[]::text[]), 'error:pages_invalid', 'listas vacías');
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', array['e5b2', 'e5b2'], null), 'error:pages_invalid', 'repetida');
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', array['e5b2'], array['e5b2']), 'error:pages_invalid', 'en las dos listas');
  perform pg_temp.check(pg_temp.run_as('e5a0', format('select public.set_page_shares(%L, %L, array[%L, null]::uuid[], null, %L)',
                                                      pg_temp.u('e5e0'), 'cs-g@test.invalid', pg_temp.u('e5b2'), 'view')),
    'error:pages_invalid', 'un nulo en la lista');
  select array_agg(gen_random_uuid()::text) into many from generate_series(1, 201);
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', many, null), 'error:too_many_pages', '201 páginas');
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', many[1:150], many[151:201]), 'error:too_many_pages',
    '201 páginas entre agregar y sacar');

  -- Cada página que no vale, sola y junto a una que sí: el mismo error, y nada se escribe.
  foreach bad in array array[
    'e5bd',                       -- de otro proyecto (Q)
    'e5bb',                       -- en la papelera
    'e5be',                       -- de un proyecto borrado
    'e5ff',                       -- no existe
    'e5b6',                       -- sin marca de escena
    'e5bc',                       -- marca `false`
    'e5b3',                       -- la ficha de una escena
    'e5b8',                       -- una locación
    'e5ba',                       -- un día
    'e5b0',                       -- la carpeta de escenas
    'e5b1'                        -- el episodio
  ] loop
    perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', array[bad], null), 'error:page_invalid', 'agregar ' || bad);
    perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', array['e5b2', 'e5b4', bad], null), 'error:page_invalid',
      'agregar S1, S2 y ' || bad);
    perform pg_temp.check(pg_temp.sps('e5a0', 'cs-nuevo@test.invalid', array['e5b2', bad], null), 'error:page_invalid',
      'invitar con S1 y ' || bad);
  end loop;
  -- Sacar no pide la marca ni que esté viva (la papelera se prueba en la sección 5), pero sí el proyecto y que exista.
  foreach bad in array array['e5bd', 'e5be', 'e5ff'] loop
    perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', array['e5b2'], array[bad]), 'error:page_invalid', 'sacar ' || bad);
  end loop;
  -- Solo esa escena: una escena con una locación, un día (aunque esté en la papelera), una carpeta de locaciones u otra
  -- escena adentro no se agrega, sola o con S1, y el error no dice cuál. Una página que no vale gana (`page_invalid`).
  foreach bad in array array['e5d0', 'e5d2', 'e5d4', 'e5d6'] loop
    perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', array[bad], null), 'error:scene_contains_entities',
      'agregar ' || bad);
    perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', array['e5b2', bad], null), 'error:scene_contains_entities',
      'agregar S1 y ' || bad);
    perform pg_temp.check(pg_temp.sps('e5a0', 'cs-nuevo@test.invalid', array[bad], null), 'error:scene_contains_entities',
      'invitar con ' || bad);
    perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', array[bad, 'e5b6'], null), 'error:page_invalid',
      'agregar ' || bad || ' y S4 (sin marca)');
  end loop;
  -- La escena que está adentro del episodio sí se agrega sola (lo de arriba no cuenta); se saca enseguida.
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-h@test.invalid', array['e5d7'], null), 'member:1', 'agregar SS a h');
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-h@test.invalid', null, array['e5d7']), 'member:0', 'sacar SS a h');
  -- d es admin con 4 sobre S1 pero no sobre el proyecto: no llega a validar páginas.
  perform pg_temp.check(pg_temp.sps('e5a9', 'cs-g@test.invalid', array['e5b2'], null), 'error:not_allowed', 'd comparte S1');

  assert pg_temp.grants_of('e5a4') = '(ninguno)', 'una validación dejó un permiso: ' || pg_temp.grants_of('e5a4');
  assert pg_temp.inv_of('cs-nuevo@test.invalid') = '(ninguna)', 'una validación dejó una invitación';
  assert pg_temp.reset_seq('e5b2') = 0, 'una validación reinició la base de S1';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 5. A un miembro: agrega Ver o Comentar sin bajar nunca, saca solo Ver o Comentar sobre esa página
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  -- g (invitado del workspace, el vendor): S1 y S2 con Ver. La rama empieza de una base nueva (D14).
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', array['e5b2', 'e5b4'], null), 'member:2', 'o comparte S1 y S2 con g');
  perform pg_temp.check(pg_temp.grants_of('e5a4'), 'e5b2:view,e5b4:view', 'los permisos de g');
  assert pg_temp.reset_seq('e5b2') = pg_temp.update_seq('e5b2') and pg_temp.update_seq('e5b2') > 0, 'S1 no se reinició';
  assert pg_temp.reset_seq('e5b3') = pg_temp.update_seq('e5b3') and pg_temp.update_seq('e5b3') > 0, 'F1 (la ficha) no se reinició';
  assert pg_temp.reset_seq('e5b5') = 0, 'S3 se reinició sin compartirse';
  -- El correo con otras mayúsculas y espacios es la misma persona; repetir no cambia nada.
  perform pg_temp.check(pg_temp.sps('e5a0', '  CS-G@Test.Invalid ', array['e5b2'], null), 'member:2', 'o repite S1 con otro formato');
  perform pg_temp.check(pg_temp.grants_of('e5a4'), 'e5b2:view,e5b4:view', 'los permisos de g después de repetir');
  -- Sube a Comentar y saca: S2 a Comentar, después se saca (queda revocado, no borrado).
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', array['e5b4'], null, 'comment'), 'member:2', 'S2 a Comentar');
  perform pg_temp.check(pg_temp.grant_of('e5a4', 'e5b4'), 'comment', 'S2 de g en Comentar');
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', array['e5b4'], null, 'view'), 'member:2', 'S2 otra vez a Ver');
  perform pg_temp.check(pg_temp.grant_of('e5a4', 'e5b4'), 'comment', 'agregar Ver bajó el Comentar de g');
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', null, array['e5b4']), 'member:1', 'o saca S2 a g');
  perform pg_temp.check(pg_temp.grant_of('e5a4', 'e5b4'), '(ninguno)', 'S2 de g sigue');
  assert exists (select 1 from public.grants where user_id = pg_temp.u('e5a4') and page_id = pg_temp.u('e5b4')
                 and revoked_at is not null and revoked_by = pg_temp.u('e5a0')), 'sacar no dejó la fila revocada por o';
  -- Sacar algo que no tiene (o sin marca de escena) no es un error.
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', null, array['e5b4', 'e5b6']), 'member:1', 'sacar lo que no tiene');
  -- Y vuelve con Ver (reactiva la fila).
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', array['e5b4'], null), 'member:2', 'S2 vuelve a g');
  perform pg_temp.check(pg_temp.grants_of('e5a4'), 'e5b2:view,e5b4:view', 'g otra vez con S1 y S2');
  -- Sacar en la papelera: S2 en la papelera (y F1, con S1 de arriba en la papelera) se sacan igual; agregarlas, no.
  update public.pages set deleted_at = now() where id = pg_temp.u('e5b4');
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', array['e5b4'], null), 'error:page_invalid', 'agregar S2 en la papelera');
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', null, array['e5b4']), 'member:1', 'sacar S2 en la papelera');
  perform pg_temp.check(pg_temp.grant_of('e5a4', 'e5b4'), '(ninguno)', 'S2 en la papelera sigue para g');
  update public.pages set deleted_at = null where id = pg_temp.u('e5b4');
  insert into public.grants (user_id, page_id, level) values (pg_temp.u('e5a4'), pg_temp.u('e5b3'), 'view');
  update public.pages set deleted_at = now() where id = pg_temp.u('e5b2');
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', null, array['e5b3']), 'member:0',
    'sacar F1 con S1 en la papelera');
  perform pg_temp.check(pg_temp.grant_of('e5a4', 'e5b3'), '(ninguno)', 'F1 sigue para g');
  update public.pages set deleted_at = null where id = pg_temp.u('e5b2');
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', array['e5b4'], null), 'member:2', 'S2 vuelve a g otra vez');
  perform pg_temp.check(pg_temp.grants_of('e5a4'), 'e5b2:view,e5b4:view', 'g con S1 y S2 después de la papelera');
  -- Un Editar revocado no cuenta: agregar Ver reactiva la fila con Ver.
  insert into public.grants (user_id, page_id, level, revoked_at) values (pg_temp.u('e5a4'), pg_temp.u('e5b5'), 'edit', now());
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', array['e5b5'], null), 'member:3', 'S3 a g sobre un Editar revocado');
  perform pg_temp.check(pg_temp.grant_of('e5a4', 'e5b5'), 'view', 'S3 de g');
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', null, array['e5b5']), 'member:2', 'sacar S3 a g');

  -- Un miembro con una invitación viva para su correo: no (al aceptarla le volvería lo que se saca). Revocada, sí.
  insert into public.invitations (email, role, grants, invited_by) values
    ('cs-m@test.invalid', 'guest', jsonb_build_array(jsonb_build_object('page_id', pg_temp.u('e5b2'), 'level', 'view')), pg_temp.u('e5a0'));
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-m@test.invalid', array['e5b4'], null), 'error:invitation_exists',
    'o comparte con m, que tiene una invitación viva');
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-m@test.invalid', null, array['e5b2']), 'error:invitation_exists',
    'o le saca a m, que tiene una invitación viva');
  perform pg_temp.check(pg_temp.grant_of('e5a5', 'e5b4'), '(ninguno)', 'm recibió S2 con una invitación viva');
  update public.invitations set revoked_at = now() where email = 'cs-m@test.invalid';

  -- m tiene Editar sobre S1: agregar Ver no lo toca, sacar no lo saca.
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-m@test.invalid', array['e5b2'], null), 'member:1', 'o agrega S1 a m (Editar)');
  perform pg_temp.check(pg_temp.grant_of('e5a5', 'e5b2'), 'edit', 'agregar Ver bajó el Editar de m');
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-m@test.invalid', null, array['e5b2']), 'member:1', 'o saca S1 a m');
  perform pg_temp.check(pg_temp.grant_of('e5a5', 'e5b2'), 'edit', 'sacar le sacó el Editar a m');
  -- F1 está adentro de S1: m la edita por S1; agregar F1 no se puede (no es escena) y sacarla no toca nada.
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-m@test.invalid', null, array['e5b3']), 'member:1', 'o saca F1 a m');
  perform pg_temp.check(pg_temp.grant_of('e5a5', 'e5b2'), 'edit', 'sacar F1 le sacó S1 a m');

  -- w ve todo PR por el proyecto: agregar no crea nada (ya la ve), sacar no toca el permiso del proyecto.
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-w@test.invalid', array['e5b2'], null), 'member:0', 'o agrega S1 a w');
  perform pg_temp.check(pg_temp.grant_of('e5a6', 'e5b2'), '(ninguno)', 'w recibió un permiso sobre S1');
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-w@test.invalid', null, array['e5b2']), 'member:0', 'o saca S1 a w');
  assert exists (select 1 from public.grants where user_id = pg_temp.u('e5a6') and project_id = pg_temp.u('e5e0')
                 and level = 'view' and revoked_at is null), 'sacar le sacó a w el permiso del proyecto';

  -- a (admin con Editar y crear páginas sobre PR) también: S3 a h, otro invitado.
  perform pg_temp.check(pg_temp.sps('e5a1', 'cs-h@test.invalid', array['e5b5'], null, 'comment'), 'member:1', 'a comparte S3 con h');
  perform pg_temp.check(pg_temp.grants_of('e5ac'), 'e5b5:comment', 'los permisos de h');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 6. A alguien que no es miembro: una invitación de invitado, solo para agregar
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  first_id uuid;
  many text[];
begin
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-nuevo@test.invalid', array['e5b2', 'e5b4'], null), 'invited:2', 'o invita a nuevo');
  perform pg_temp.check(pg_temp.inv_of('cs-nuevo@test.invalid'), 'guest|e5b2:view,e5b4:view', 'la invitación de nuevo');
  select id into first_id from public.invitations where email = 'cs-nuevo@test.invalid';
  assert (select invited_by from public.invitations where id = first_id) = pg_temp.u('e5a0'), 'la invitación no es de o';
  -- Sumar a la propia: la misma invitación, sin bajar un nivel.
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-nuevo@test.invalid', array['e5b5'], null, 'comment'), 'invited:3', 'o suma S3');
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-nuevo@test.invalid', array['e5b2'], null, 'comment'), 'invited:3', 'o sube S1');
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-nuevo@test.invalid', array['e5b2'], null, 'view'), 'invited:3', 'o repite S1 con Ver');
  perform pg_temp.check(pg_temp.inv_of('cs-nuevo@test.invalid'), 'guest|e5b2:comment,e5b4:view,e5b5:comment', 'la invitación sumada');
  assert (select count(*) from public.invitations where email = 'cs-nuevo@test.invalid') = 1, 'se creó otra invitación';
  -- Sacar de una invitación pendiente: no («revocá y volvé a invitar»), y no cambia nada.
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-nuevo@test.invalid', null, array['e5b2']), 'error:invitation_remove', 'o saca de la invitación');
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-nuevo@test.invalid', array['e5bf'], array['e5b2']), 'error:invitation_remove',
    'o agrega y saca en la invitación');
  perform pg_temp.check(pg_temp.inv_of('cs-nuevo@test.invalid'), 'guest|e5b2:comment,e5b4:view,e5b5:comment', 'la invitación después de sacar');
  -- La de otra persona y la de otro rol: error, y no cambian.
  perform pg_temp.check(pg_temp.sps('e5a1', 'cs-nuevo@test.invalid', array['e5bf'], null), 'error:invitation_exists', 'a suma a la de o');
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-otra@test.invalid', array['e5bf'], null), 'error:invitation_exists', 'o suma a la de a');
  perform pg_temp.check(pg_temp.inv_of('cs-otra@test.invalid'), 'guest|e5b4:view', 'la invitación de a cambió');
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-rol@test.invalid', array['e5bf'], null), 'error:invitation_role', 'o suma a su invitación de miembro');
  perform pg_temp.check(pg_temp.inv_of('cs-rol@test.invalid'), 'member|e5b4:view', 'la invitación de miembro cambió');
  -- Una cuenta sin membresía y una sacada del workspace entran por invitación.
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-x@test.invalid', array['e5bf'], null), 'invited:1', 'o invita a x');
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-y@test.invalid', array['e5bf'], null), 'invited:1', 'o invita a y (sacado)');
  assert not exists (select 1 from public.grants where user_id in (pg_temp.u('e5a7'), pg_temp.u('e5ab'))), 'x o y recibieron un permiso';

  -- El tope de 200 por invitación: 200 escenas nuevas en PR.
  select array_agg(id::text order by id) into many from (
    select gen_random_uuid() as id from generate_series(1, 210)
  ) x;
  insert into public.pages (id, workspace_id, parent_id, title, sort_key, settings)
  select m::uuid, pg_temp.u('e5e0'), pg_temp.u('e5b1'), 'Escena ' || o, 'b' || lpad(o::text, 4, '0'),
         jsonb_build_object('entity', jsonb_build_object('kind', 'scene'))
  from unnest(many) with ordinality as t(m, o);
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-tope@test.invalid', many[1:150], null), 'invited:150', 'o invita con 150');
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-tope@test.invalid', many[151:201], null), 'error:too_many_pages', 'o suma 51 más');
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-tope@test.invalid', many[151:200], null), 'invited:200', 'o suma 50 más');
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-tope@test.invalid', many[201:201], null), 'error:too_many_pages', 'o suma la 201');
  -- Repetir una que ya está no suma (la unión sigue en 200).
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-tope@test.invalid', many[1:1], null, 'comment'), 'invited:200', 'o repite una');
  update public.pages set deleted_at = now() where id = any (pg_temp.us(many[1:210]));
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 7. Lo que ve el vendor: g con S1 y S2 (Ver). Nada de los costados ni de arriba (condición 11)
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  p text;
begin
  perform pg_temp.check(pg_temp.run_as('e5a4', 'select string_agg(title, '','' order by title) from public.pages'),
    'F1,S1,S2', 'las páginas que ve g');
  perform pg_temp.check(pg_temp.run_as('e5a4', 'select string_agg(name, '','' order by name) from public.workspaces'),
    'PR', 'los proyectos que ve g');
  -- El contenido: las filas de lo que ve, y nada de lo demás (ni por la tabla ni por las funciones).
  perform pg_temp.check(pg_temp.run_as('e5a4', format('select count(id) from public.page_updates where page_id in (%L, %L, %L)',
                                                      pg_temp.u('e5b2'), pg_temp.u('e5b3'), pg_temp.u('e5b4'))),
    '3', 'g cuenta las filas de S1, F1 y S2');
  foreach p in array array['e5b5', 'e5b8', 'e5ba', 'e5b0', 'e5b1', 'e5b6', 'e5bf', 'e5bd'] loop
    perform pg_temp.check(pg_temp.run_as('e5a4', format('select count(id) from public.page_updates where page_id = %L', pg_temp.u(p))),
      '0', 'g ve filas de ' || p);
    perform pg_temp.check(pg_temp.run_as('e5a4', format('select count(*) from public.pull_page_updates(%L, 0)', pg_temp.u(p))),
      'error:page_not_found', 'g baja ' || p);
    perform pg_temp.check(pg_temp.run_as('e5a4', format('select count(*) from public.list_comments(%L)', pg_temp.u(p))),
      'error:page_not_found', 'g lista los comentarios de ' || p);
    perform pg_temp.check(pg_temp.run_as('e5a4', format('select count(id) from public.comments where page_id = %L', pg_temp.u(p))),
      '0', 'g ve comentarios de ' || p);
    perform pg_temp.check(pg_temp.run_as('e5a4', format('select count(file_id) from public.page_files where page_id = %L', pg_temp.u(p))),
      '0', 'g ve archivos de ' || p);
  end loop;
  -- Lo suyo sí: S1 baja (sin lo borrado: es invitado), su comentario y su foto.
  -- Sin base limpia armada (se reinició al compartir), S1 no baja nada: ni lo borrado ni lo de antes.
  perform pg_temp.check(pg_temp.run_as('e5a4', format('select count(*) from public.pull_page_updates(%L, 0)', pg_temp.u('e5b2'))),
    '0', 'g baja S1 sin base limpia');
  perform pg_temp.check(pg_temp.run_as('e5a4', format('select count(*) from public.list_comments(%L)', pg_temp.u('e5b2'))),
    '1', 'g lista el comentario de S1');
  perform pg_temp.check(pg_temp.run_as('e5a4', 'select string_agg(name, '','' order by name) from public.files'),
    's1.jpg', 'los archivos que ve g');
  -- Ninguna de las funciones nuevas.
  perform pg_temp.check(pg_temp.run_as('e5a4', format('select count(*) from public.project_page_shares(%L)', pg_temp.u('e5e0'))),
    'error:not_allowed', 'g lista quién tiene qué');
  perform pg_temp.check(pg_temp.run_as('e5a4', format('select count(*) from public.pages_with_outside_readers(%L)', pg_temp.u('e5e0'))),
    'error:not_allowed', 'g pide la marca');
  perform pg_temp.check(pg_temp.sps('e5a4', 'cs-g@test.invalid', array['e5b5'], null), 'error:not_allowed', 'g se comparte S3');
  -- h (S3 con Comentar) ve solo S3.
  perform pg_temp.check(pg_temp.run_as('e5ac', 'select string_agg(title, '','' order by title) from public.pages'), 'S3', 'las páginas que ve h');
  perform pg_temp.check(pg_temp.run_as('e5ac', 'select string_agg(name, '','' order by name) from public.files'), 's3.jpg', 'los archivos que ve h');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 8. Quién tiene qué: solo este proyecto, solo páginas vivas, solo miembros activos e invitaciones vivas
-- ---------------------------------------------------------------------------------------------------
create function pg_temp.shares(who text, proj text default 'e5e0') returns text language sql as $$
  select pg_temp.run_as(who, format($q$
    select string_agg(split_part(email, '@', 1) || ':' || coalesce(right(page_id::text, 4), 'proj') || ':' || level
                      || case when invitation_id is null then '' else ':inv' end
                      || case when in_trash then ':trash' else '' end,
                      ' ' order by email collate "C", coalesce(right(page_id::text, 4), 'proj') collate "C")
    from public.project_page_shares(%L)
    where email not like 'cs-tope@%%'$q$, pg_temp.u(proj)));
$$;

do $$
declare
  want text := 'cs-a:proj:edit_pages cs-d:e5b2:edit_pages cs-g:e5b2:view cs-g:e5b4:view cs-h:e5b5:comment '
               'cs-m:e5b2:edit cs-nuevo:e5b2:comment:inv cs-nuevo:e5b4:view:inv cs-nuevo:e5b5:comment:inv '
               'cs-otra:e5b4:view:inv cs-r:e5bb:view:trash cs-rol:e5b4:view:inv cs-w:proj:view cs-x:e5bf:view:inv '
               'cs-y:e5bf:view:inv';
begin
  perform pg_temp.check(pg_temp.shares('e5a0'), want, 'lo que lista o');
  perform pg_temp.check(pg_temp.shares('e5a1'), want, 'lo que lista a');
  -- Las filas de miembros traen su persona y su permiso; las de invitaciones, la invitación.
  perform pg_temp.check(pg_temp.run_as('e5a0', format($q$
    select count(*) from public.project_page_shares(%L)
    where (invitation_id is null) = (user_id is null) or (invitation_id is null) = (grant_id is null)$q$, pg_temp.u('e5e0'))),
    '0', 'una fila con persona e invitación, o sin ninguna');
  perform pg_temp.check(pg_temp.run_as('e5a0', format('select count(*) - count(distinct row_key) from public.project_page_shares(%L)',
                                                      pg_temp.u('e5e0'))), '0', 'row_key repetida');
  -- Una invitación vencida, revocada o de un admin que ya no está no aparece.
  update public.invitations set expires_at = now() - interval '1 second' where email = 'cs-x@test.invalid';
  update public.invitations set revoked_at = now() where email = 'cs-y@test.invalid';
  update public.members set removed_at = now() where user_id = pg_temp.u('e5a1');
  perform pg_temp.check(pg_temp.shares('e5a0'),
    'cs-d:e5b2:edit_pages cs-g:e5b2:view cs-g:e5b4:view cs-h:e5b5:comment cs-m:e5b2:edit cs-nuevo:e5b2:comment:inv '
    'cs-nuevo:e5b4:view:inv cs-nuevo:e5b5:comment:inv cs-r:e5bb:view:trash cs-rol:e5b4:view:inv cs-w:proj:view',
    'lo que lista o sin las invitaciones muertas ni el admin sacado');
  update public.members set removed_at = null where user_id = pg_temp.u('e5a1');
  update public.invitations set expires_at = now() + interval '30 days' where email = 'cs-x@test.invalid';
  -- Una escena que pasa a la papelera: el permiso sigue en la lista con `in_trash` (para poder sacarlo) y las
  -- invitaciones sobre ella salen (vuelven al restaurarla).
  update public.pages set deleted_at = now() where id = pg_temp.u('e5b4');
  perform pg_temp.check(pg_temp.shares('e5a0'),
    'cs-a:proj:edit_pages cs-d:e5b2:edit_pages cs-g:e5b2:view cs-g:e5b4:view:trash cs-h:e5b5:comment cs-m:e5b2:edit '
    'cs-nuevo:e5b2:comment:inv cs-nuevo:e5b5:comment:inv cs-r:e5bb:view:trash cs-w:proj:view cs-x:e5bf:view:inv',
    'lo que lista o con S2 en la papelera');
  update public.pages set deleted_at = null where id = pg_temp.u('e5b4');
  -- r tiene Ver sobre QS (Q) y sobre T (PR, en la papelera): en PR, solo T, con `in_trash`.
  perform pg_temp.check(pg_temp.run_as('e5a0', format(
    'select string_agg(right(page_id::text, 4) || %L || in_trash, %L) from public.project_page_shares(%L) where email = %L',
    ':', ',', pg_temp.u('e5e0'), 'cs-r@test.invalid')), 'e5bb:true', 'r en PR');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 9. La marca del árbol: las páginas que ven personas de afuera, y nada más
-- ---------------------------------------------------------------------------------------------------
create function pg_temp.readers(who text, proj text default 'e5e0') returns text language sql as $$
  select pg_temp.run_as(who, format($q$
    select coalesce(string_agg(right(page_id::text, 4) || ':' || readers, ' ' order by right(page_id::text, 4)), '(ninguna)')
    from public.pages_with_outside_readers(%L) r
    where exists (select 1 from public.pages pg where pg.id = r.page_id and pg.title not like 'Escena %%')$q$, pg_temp.u(proj)));
$$;

do $$
begin
  -- S1: g (invitado) y la invitación de nuevo; m (Editar) y d (admin con 4) no son de afuera.
  -- S2: g, nuevo, otra (invitada por a) y rol (Ver, aunque sea de miembro). S3: h y nuevo. S6: x (y está revocada).
  perform pg_temp.check(pg_temp.readers('e5a0'), 'e5b2:2 e5b4:4 e5b5:2 e5bf:1', 'la marca para o');
  perform pg_temp.check(pg_temp.readers('e5a1'), 'e5b2:2 e5b4:4 e5b5:2 e5bf:1', 'la marca para a');
  -- Un miembro con Ver o Comentar sobre una página sin nada más es de afuera; con Editar arriba, no.
  insert into public.grants (user_id, page_id, level) values (pg_temp.u('e5a5'), pg_temp.u('e5b3'), 'view');
  perform pg_temp.check(pg_temp.readers('e5a0'), 'e5b2:2 e5b4:4 e5b5:2 e5bf:1', 'Ver de m sobre F1 (Editar por S1) no cuenta');
  insert into public.grants (user_id, page_id, level) values (pg_temp.u('e5a5'), pg_temp.u('e5b8'), 'comment');
  perform pg_temp.check(pg_temp.readers('e5a0'), 'e5b2:2 e5b4:4 e5b5:2 e5b8:1 e5bf:1', 'Comentar de m sobre L1 cuenta');
  -- Lo de la papelera y lo de otro proyecto no: r con Ver sobre T (PR, en la papelera) y sobre QS (Q).
  perform pg_temp.check(pg_temp.readers('e5a3', 'e5e1'), 'e5bd:1', 'la marca de Q para c');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 10. Sí o no, para quien edita: `page_has_outside_readers`
-- ---------------------------------------------------------------------------------------------------
create function pg_temp.has(who text, page text, method text default 'otp') returns text language sql as $$
  select pg_temp.run_as(who, format('select public.page_has_outside_readers(%L)', pg_temp.u(page)), method);
$$;

do $$
begin
  -- La dueña: S1 (g), F1 (adentro de S1), S6 (la invitación de x) y L1 (el Comentar de m); no lo de arriba ni S4.
  perform pg_temp.check(pg_temp.has('e5a0', 'e5b2'), 'true', 'o: S1');
  perform pg_temp.check(pg_temp.has('e5a0', 'e5b3'), 'true', 'o: F1');
  perform pg_temp.check(pg_temp.has('e5a0', 'e5bf'), 'true', 'o: S6');
  perform pg_temp.check(pg_temp.has('e5a0', 'e5b8'), 'true', 'o: L1');
  perform pg_temp.check(pg_temp.has('e5a0', 'e5b0'), 'false', 'o: DES');
  perform pg_temp.check(pg_temp.has('e5a0', 'e5b1'), 'false', 'o: EP');
  perform pg_temp.check(pg_temp.has('e5a0', 'e5b6'), 'false', 'o: S4');
  -- m edita S1 (sí) y no edita S2 (no, aunque la vean de afuera); d (admin con 4 sobre S1) también.
  perform pg_temp.check(pg_temp.has('e5a5', 'e5b2'), 'true', 'm: S1');
  perform pg_temp.check(pg_temp.has('e5a5', 'e5b4'), 'false', 'm: S2');
  perform pg_temp.check(pg_temp.has('e5a9', 'e5b3'), 'true', 'd: F1');
  -- Quien no edita, un invitado, una sesión con contraseña, una página que no existe o de otro proyecto: no.
  perform pg_temp.check(pg_temp.has('e5a6', 'e5b2'), 'false', 'w (ve PR) pregunta por S1');
  perform pg_temp.check(pg_temp.has('e5a4', 'e5b2'), 'false', 'g (invitado) pregunta por S1');
  perform pg_temp.check(pg_temp.has('e5ac', 'e5b5'), 'false', 'h (invitado con Comentar) pregunta por S3');
  perform pg_temp.check(pg_temp.has('e5a0', 'e5b2', 'password'), 'false', 'o con contraseña');
  perform pg_temp.check(pg_temp.has('e5a0', 'e5ff'), 'false', 'o: una página que no existe');
  perform pg_temp.check(pg_temp.has('e5a0', 'e5bd'), 'false', 'o: QS (de Q, no la ve)');
  perform pg_temp.check(pg_temp.run_as('e5a0', 'select public.page_has_outside_readers(null)'), 'false', 'o: nula');
  perform pg_temp.as_anon();
  perform pg_temp.check(pg_temp.val(format('select public.page_has_outside_readers(%L)', pg_temp.u('e5b2'))),
    'error:permission denied for function page_has_outside_readers', 'anon pregunta');
  perform pg_temp.as_postgres();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 11. Nada marcado adentro de una escena que ven personas de afuera (`pages_scene_share_guard`)
-- ---------------------------------------------------------------------------------------------------
-- Una página nueva como postgres (el trigger frena a cualquiera): «ok» o 'error:…'.
create function pg_temp.new_page(id text, parent text, settings text) returns text language sql as $$
  select pg_temp.val(format(
    'insert into public.pages (id, workspace_id, parent_id, title, sort_key, settings) values (%L, %L, %L, %L, %L, %L::jsonb) returning %L',
    pg_temp.u(id), pg_temp.u('e5e0'), pg_temp.u(parent), 'N' || id, 'z' || id, settings, 'ok'));
$$;

-- Mover `page` adentro de `parent` como `who` (la app): «ok» o 'error:…'.
create function pg_temp.move_as(who text, page text, parent text) returns text language sql as $$
  select pg_temp.run_as(who, format('update public.pages set parent_id = %L where id = %L returning %L',
                                    pg_temp.u(parent), pg_temp.u(page), 'ok'));
$$;

do $$
begin
  -- Crear adentro de S1 (la ve g): una locación, un día, un decorado, otra escena o una carpeta que las guarda, no; una
  -- página sin marca, sí.
  perform pg_temp.check(pg_temp.new_page('e5f0', 'e5b2', '{"entity": {"kind": "location"}}'), 'error:entity_in_shared_scene', 'crear L en S1');
  perform pg_temp.check(pg_temp.new_page('e5f0', 'e5b2', '{"entity": {"kind": "day"}}'), 'error:entity_in_shared_scene', 'crear un día en S1');
  perform pg_temp.check(pg_temp.new_page('e5f0', 'e5b2', '{"entity": {"kind": "set"}}'), 'error:entity_in_shared_scene', 'crear un decorado en S1');
  perform pg_temp.check(pg_temp.new_page('e5f0', 'e5b2', '{"entity": {"kind": "scene"}}'), 'error:entity_in_shared_scene', 'crear una escena en S1');
  perform pg_temp.check(pg_temp.new_page('e5f0', 'e5b3', '{"holds": "location"}'), 'error:entity_in_shared_scene', 'crear una carpeta en F1');
  perform pg_temp.check(pg_temp.new_page('e5f0', 'e5b2', '{}'), 'ok', 'crear una página sin marca en S1');
  perform pg_temp.check(pg_temp.new_page('e5f2', 'e5b2', '{"entity": false}'), 'ok', 'crear una página con la marca en false en S1');
  -- Adentro de S4 (sin marca de escena) y de EP (sin lectores), sí.
  perform pg_temp.check(pg_temp.new_page('e5f4', 'e5b1', '{"entity": {"kind": "location"}}'), 'ok', 'crear L en EP');

  -- Mover adentro de S1 o de S3 (como o, la app): nada de afuera, con marca o sin ella (la locación L1, la carpeta LOC,
  -- DAYS, la locación nueva de EP, la página sin marca de S1 a S2, otra escena compartida). Adentro de S4 (sin marca de
  -- escena) o de DES (sin lectores), sí.
  perform pg_temp.check(pg_temp.move_as('e5a0', 'e5b8', 'e5b2'), 'error:moved_into_shared_scene', 'mover L1 a S1');
  perform pg_temp.check(pg_temp.move_as('e5a0', 'e5b8', 'e5b3'), 'error:moved_into_shared_scene', 'mover L1 a F1');
  perform pg_temp.check(pg_temp.move_as('e5a0', 'e5b7', 'e5b5'), 'error:moved_into_shared_scene', 'mover LOC a S3');
  perform pg_temp.check(pg_temp.move_as('e5a0', 'e5b9', 'e5b2'), 'error:moved_into_shared_scene', 'mover DAYS a S1');
  perform pg_temp.check(pg_temp.move_as('e5a0', 'e5f4', 'e5bf'), 'error:moved_into_shared_scene', 'mover la L nueva a S6 (invitación de x)');
  perform pg_temp.check(pg_temp.move_as('e5a0', 'e5b8', 'e5b6'), 'ok', 'mover L1 a S4');
  perform pg_temp.check(pg_temp.move_as('e5a0', 'e5b8', 'e5b7'), 'ok', 'L1 vuelve a LOC');
  perform pg_temp.check(pg_temp.move_as('e5a0', 'e5f0', 'e5b4'), 'error:moved_into_shared_scene',
    'mover la página sin marca de S1 a S2 (otra escena compartida, por la invitación de a)');
  assert (select parent_id from public.pages where id = pg_temp.u('e5f0')) = pg_temp.u('e5b2'), 'la página salió de S1';
  -- Adentro de la misma escena compartida, sí: la página sin marca de S1 a F1, y de vuelta.
  perform pg_temp.check(pg_temp.move_as('e5a0', 'e5f0', 'e5b3'), 'ok', 'mover la página sin marca de S1 a F1');
  perform pg_temp.check(pg_temp.move_as('e5a0', 'e5f0', 'e5b2'), 'ok', 'y de F1 a S1');
  -- Como postgres (una versión vieja de la app tampoco pasa: el trigger no mira quién).
  perform pg_temp.check(pg_temp.val(format('update public.pages set parent_id = %L where id = %L returning %L',
                                           pg_temp.u('e5b2'), pg_temp.u('e5b8'), 'ok')),
    'error:moved_into_shared_scene', 'postgres mueve L1 a S1');
  assert (select parent_id from public.pages where id = pg_temp.u('e5b8')) = pg_temp.u('e5b7'), 'L1 se movió';

  -- Marcar adentro: F1 como locación o como carpeta de días, no; lo que ya estaba marcado se puede seguir cambiando.
  perform pg_temp.check(pg_temp.run_as('e5a0', format('update public.pages set settings = %L::jsonb where id = %L returning %L',
                                                      '{"entity": {"kind": "location"}}', pg_temp.u('e5b3'), 'ok')),
    'error:entity_in_shared_scene', 'marcar F1 como locación');
  perform pg_temp.check(pg_temp.run_as('e5a0', format('update public.pages set settings = %L::jsonb where id = %L returning %L',
                                                      '{"holds": "day"}', pg_temp.u('e5b3'), 'ok')),
    'error:entity_in_shared_scene', 'marcar F1 como carpeta de días');
  perform pg_temp.check(pg_temp.run_as('e5a0', format('update public.pages set settings = %L::jsonb where id = %L returning %L',
                                                      '{"sheet": "a4"}', pg_temp.u('e5b3'), 'ok')),
    'ok', 'cambiar un ajuste sin marca de F1');
  -- S8 lleva X (un día en la papelera, de antes de compartir): se comparte a mano con h y X se puede seguir cambiando
  -- sin moverla. La escena compartida misma también (su propia marca no cuenta).
  insert into public.grants (user_id, page_id, level) values (pg_temp.u('e5ac'), pg_temp.u('e5d2'), 'view');
  perform pg_temp.check(pg_temp.val(format('update public.pages set settings = %L::jsonb where id = %L returning %L',
                                           '{"entity": {"kind": "location"}}', pg_temp.u('e5d3'), 'ok')),
    'ok', 'cambiar la marca de X, que ya estaba');
  perform pg_temp.check(pg_temp.run_as('e5a0', format('update public.pages set settings = %L::jsonb where id = %L returning %L',
                                                      '{"entity": {"kind": "scene", "code": "105_002"}, "sheet": "a4"}',
                                                      pg_temp.u('e5b4'), 'ok')),
    'ok', 'cambiar los ajustes de S2, compartida');

  -- Una carpeta compartida con *Share* que no es una escena (LOC con h): sigue recibiendo locaciones.
  insert into public.grants (user_id, page_id, level) values (pg_temp.u('e5ac'), pg_temp.u('e5b7'), 'view');
  perform pg_temp.check(pg_temp.new_page('e5f6', 'e5b7', '{"entity": {"kind": "location"}}'), 'ok', 'crear una locación en LOC compartida');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 12. Las vueltas para esquivar el trigger
-- ---------------------------------------------------------------------------------------------------
-- Cambiar los ajustes de una página como `who`: «ok» o 'error:…'.
create function pg_temp.set_as(who text, page text, settings text) returns text language sql as $$
  select pg_temp.run_as(who, format('update public.pages set settings = %L::jsonb where id = %L returning %L',
                                    settings, pg_temp.u(page), 'ok'));
$$;

do $$
begin
  -- (a) Desmarcar la escena compartida, meter algo y volver a marcarla: S1 (la ve g) no deja de ser escena, ni pasa a
  -- ser otra entidad, ni carpeta de entidades.
  perform pg_temp.check(pg_temp.set_as('e5a0', 'e5b2', '{}'), 'error:entity_in_shared_scene', 'desmarcar S1');
  perform pg_temp.check(pg_temp.set_as('e5a0', 'e5b2', '{"entity": {"kind": "location"}}'), 'error:entity_in_shared_scene',
    'S1 pasa a locación');
  perform pg_temp.check(pg_temp.set_as('e5a0', 'e5b2', '{"entity": {"kind": "scene", "code": "105_001"}, "holds": "location"}'),
    'error:entity_in_shared_scene', 'S1 pasa a carpeta de locaciones');
  perform pg_temp.check(pg_temp.set_as('e5a0', 'e5b2', '{"entity": {"kind": "scene", "code": "105_001"}, "dayReports": {}}'),
    'error:entity_in_shared_scene', 'S1 pasa a carpeta de reportes');
  perform pg_temp.check(pg_temp.set_as('e5a0', 'e5b2', '{"entity": {"kind": "scene", "code": "105_001"}, "sheet": "a4"}'),
    'ok', 'S1 cambia otro ajuste');
  -- La otra punta: S4 (sin marca) la ve h; se le mete una locación (no es una escena: se puede) y después no puede pasar
  -- a ser escena con eso adentro.
  insert into public.grants (user_id, page_id, level) values (pg_temp.u('e5ac'), pg_temp.u('e5b6'), 'view');
  perform pg_temp.check(pg_temp.move_as('e5a0', 'e5f4', 'e5b6'), 'ok', 'mover la locación nueva a S4 (sin marca)');
  perform pg_temp.check(pg_temp.set_as('e5a0', 'e5b6', '{"entity": {"kind": "scene", "code": "105_004"}}'),
    'error:entity_in_shared_scene', 'marcar S4 como escena con una locación adentro');
  perform pg_temp.check(pg_temp.move_as('e5a0', 'e5f4', 'e5b1'), 'ok', 'la locación vuelve a EP');
  perform pg_temp.check(pg_temp.set_as('e5a0', 'e5b6', '{"entity": {"kind": "scene", "code": "105_004"}}'),
    'ok', 'marcar S4 como escena sin nada adentro');

  -- (b) Entidades sin marca propia (una página sin marca de LOC, una carpeta de reportes del día, S5 con la marca en
  -- `false`): no entran en S1 ni en S3, tampoco en dos pasos (primero a la raíz o a una página neutra).
  perform pg_temp.check(pg_temp.new_page('e5f8', 'e5b7', '{}'), 'ok', 'una página sin marca en LOC');
  perform pg_temp.check(pg_temp.move_as('e5a0', 'e5f8', 'e5b2'), 'error:moved_into_shared_scene', 'mover la locación sin marca a S1');
  perform pg_temp.check(pg_temp.move_as('e5a0', 'e5f8', null), 'ok', 'la locación sin marca a la raíz');
  perform pg_temp.check(pg_temp.move_as('e5a0', 'e5f8', 'e5b2'), 'error:moved_into_shared_scene',
    'y de la raíz a S1 (el segundo paso)');
  perform pg_temp.check(pg_temp.move_as('e5a0', 'e5bc', 'e5b9'), 'ok', 'S5 a DAYS (una página neutra)');
  perform pg_temp.check(pg_temp.move_as('e5a0', 'e5bc', 'e5b5'), 'error:moved_into_shared_scene', 'y de DAYS a S3');
  perform pg_temp.check(pg_temp.move_as('e5a0', 'e5bc', 'e5b1'), 'ok', 'S5 vuelve a EP');
  perform pg_temp.check(pg_temp.new_page('e5fa', null, '{"dayReports": {}}'), 'ok', 'una carpeta de reportes en la raíz');
  perform pg_temp.check(pg_temp.move_as('e5a0', 'e5fa', 'e5b2'), 'error:moved_into_shared_scene', 'mover la carpeta de reportes a S1');
  perform pg_temp.check(pg_temp.new_page('e5fb', 'e5b2', '{"dayReports": {}}'), 'error:entity_in_shared_scene',
    'crear una carpeta de reportes en S1');

  -- Una película: S10 cuelga directo de DES (sin episodio), con dos fichas, compartida con h. Mover una ficha adentro de
  -- la otra, sí (antes la regla del abuelo lo frenaba); crear adentro sin marca, sí; sacar una ficha, sí; de S1 (otra
  -- escena compartida) a S10, no.
  perform pg_temp.check(pg_temp.new_page('e5f5', 'e5b0', '{"entity": {"kind": "scene", "code": "105_010"}}'), 'ok', 'S10 en DES');
  perform pg_temp.check(pg_temp.new_page('e5f7', 'e5f5', '{}'), 'ok', 'la ficha A en S10');
  perform pg_temp.check(pg_temp.new_page('e5f9', 'e5f5', '{}'), 'ok', 'la ficha B en S10');
  insert into public.grants (user_id, page_id, level) values (pg_temp.u('e5ac'), pg_temp.u('e5f5'), 'view');
  perform pg_temp.check(pg_temp.move_as('e5a0', 'e5f9', 'e5f7'), 'ok', 'mover la ficha B adentro de la A');
  perform pg_temp.check(pg_temp.new_page('e5fe', 'e5f7', '{}'), 'ok', 'crear sin marca adentro de la ficha A');
  perform pg_temp.check(pg_temp.move_as('e5a0', 'e5f9', 'e5b1'), 'ok', 'sacar la ficha B de S10 a EP');
  perform pg_temp.check(pg_temp.move_as('e5a0', 'e5f9', 'e5f5'), 'error:moved_into_shared_scene', 'y volverla a meter');
  perform pg_temp.check(pg_temp.move_as('e5a0', 'e5f0', 'e5f5'), 'error:moved_into_shared_scene', 'de S1 a S10');
  -- Para meterla: dejar de compartir, mover y volver a compartir.
  update public.grants set revoked_at = now() where user_id = pg_temp.u('e5ac') and page_id = pg_temp.u('e5f5');
  perform pg_temp.check(pg_temp.move_as('e5a0', 'e5f9', 'e5f5'), 'ok', 'meter la ficha B con S10 sin compartir');
  -- Compartir una escena que guarda locaciones y tiene algo adentro: `scene_contains_entities`.
  perform pg_temp.check(pg_temp.new_page('e5fc', 'e5b1', '{"entity": {"kind": "scene", "code": "105_011"}, "holds": "location"}'),
    'ok', 'una escena que guarda locaciones');
  perform pg_temp.check(pg_temp.new_page('e5fd', 'e5fc', '{}'), 'ok', 'una página sin marca adentro');
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', array['e5fc'], null), 'error:scene_contains_entities',
    'compartir la escena que guarda locaciones');
  -- Y con nada adentro: una escena que es carpeta de entidades no se comparte igual.
  perform pg_temp.check(pg_temp.new_page('e5c7', 'e5b1', '{"entity": {"kind": "scene", "code": "105_013"}, "holds": "location"}'),
    'ok', 'una escena vacía que guarda locaciones');
  perform pg_temp.check(pg_temp.sps('e5a0', 'cs-g@test.invalid', array['e5c7'], null), 'error:scene_contains_entities',
    'compartir la escena vacía que guarda locaciones');

  -- Bajo: `holds: false` («nada», a mano) no es una marca: se crea en S1, y una escena con eso adentro se comparte.
  perform pg_temp.check(pg_temp.new_page('e5c4', 'e5b2', '{"holds": false}'), 'ok', 'crear con holds false en S1');
  perform pg_temp.check(pg_temp.new_page('e5c5', 'e5b1', '{"entity": {"kind": "scene", "code": "105_012"}}'), 'ok', 'otra escena');
  perform pg_temp.check(pg_temp.new_page('e5c6', 'e5c5', '{"holds": false}'), 'ok', 'adentro, holds false');
  perform pg_temp.check(left(pg_temp.sps('e5a0', 'cs-h@test.invalid', array['e5c5'], null), 7), 'member:',
    'compartir la escena con holds false adentro');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 13. La versión de la base
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  assert (select schema_version from public.workspace_settings where id) >= 28, 'schema_version';
end;
$$;

rollback;
select 'ok' as result;
