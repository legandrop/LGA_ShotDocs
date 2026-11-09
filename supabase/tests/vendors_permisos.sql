-- Pruebas de los vendors y de *Can share scenes* (20261121120000_vendors.sql, Docs/Doc_Compartir_Escenas.md, sección 11):
-- las puertas (anon, tablas cerradas, security definer, las piezas de adentro no se ejecutan); quién maneja los vendors
-- (dueña y admin que comparten el proyecto; con la casilla, hasta su nivel, también un invitado; sin casilla, con
-- contraseña o sin membresía, no) y el interruptor de lo borrado; crear, cambiar y borrar vendors (campos, nivel por
-- encima del propio, sumar acceso a un vendor de más nivel, bajar y sacar sí); cada escena que entra (sin marca, en la
-- papelera, de otro proyecto, una carpeta, con una locación adentro, repetida; todo o nada); los correos (inválido,
-- repetido, que no está, un correo en un solo vendor vivo, pasar de un vendor a otro en un guardado); planificación sin
-- correos (no comparte nada); un miembro recibe permisos del vendor (no si ya ve más) y una persona nueva una invitación
-- de invitado sin páginas que *Members* no ve, que el registro acepta y que al aceptarla trae las escenas de ese momento;
-- sacar una escena, bajar el nivel, sacar el correo y borrar el vendor revocan; el reinicio de lo que empieza a verse;
-- la marca del árbol, el sí o no de quien edita y el freno de movimientos con las invitaciones de vendors; la casilla
-- (quién la pone, sobre qué, se apaga al revocar y no vuelve al revivir) y `list_access`; el `vendor_id` que otro camino
-- toca deja de ser del vendor. Corre dentro de una transacción que se deshace al final. Si todo pasa, devuelve 'ok'.

begin;

update public.workspace_settings set clean_min_version = null where id;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-00000000' || s)::uuid;
$$;

create function pg_temp.as_user(s text, method text default 'otp') returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', pg_temp.u(s), 'role', 'authenticated',
                                      'amr', json_build_array(json_build_object('method', method, 'timestamp', 1)))::text, true),
         set_config('request.headers', json_build_object('x-shotdocs-version', '9.999')::text, true);
$$;

create function pg_temp.as_postgres() returns void language sql as $$
  select set_config('role', 'postgres', true),
         set_config('request.jwt.claims', '', true),
         set_config('request.headers', '', true);
$$;

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

-- `save_scene_vendors` sobre PR (o `proj`) como `who`: la respuesta en texto, o 'error:…'.
create function pg_temp.svs(who text, ops text, method text default 'otp', proj text default 'f0e0') returns text language sql as $$
  select pg_temp.run_as(who, format('select public.save_scene_vendors(%L, %L::jsonb)::text', pg_temp.u(proj), ops), method);
$$;

-- Como `svs`, pero solo 'ok' o el error.
create function pg_temp.sv(who text, ops text, method text default 'otp') returns text language sql as $$
  select case when r like 'error:%' then r else 'ok' end from pg_temp.svs(who, ops, method) r;
$$;

-- `scene_vendors_list` de PR como `who`: el `cap`, o el error.
create function pg_temp.cap(who text, method text default 'otp') returns text language sql as $$
  select pg_temp.run_as(who, format('select (public.scene_vendors_list(%L) ->> %L)', pg_temp.u('f0e0'), 'cap'), method);
$$;

-- El id de un vendor vivo de PR por su nombre.
create function pg_temp.vid(name text) returns uuid language sql as $$
  select id from public.scene_vendors where project_id = pg_temp.u('f0e0') and name = $1 and deleted_at is null;
$$;

-- Los permisos vivos de `who` sobre páginas: «sufijo:nivel:vendor» (vendor = su nombre, o '-'), o '(ninguno)'.
create function pg_temp.grants_of(who text) returns text language sql as $$
  select coalesce(string_agg(right(g.page_id::text, 4) || ':' || g.level || ':' || coalesce(v.name, '-'), ',' order by g.page_id),
                  '(ninguno)')
  from public.grants g left join public.scene_vendors v on v.id = g.vendor_id
  where g.user_id = pg_temp.u(who) and g.page_id is not null and g.revoked_at is null;
$$;

-- Las invitaciones vivas de vendors de un correo: «vendor» ordenadas, o '(ninguna)'.
create function pg_temp.vinv(p_email text) returns text language sql security definer as $$
  select coalesce(string_agg(v.name, ',' order by v.name), '(ninguna)')
  from private.live_vendor_invitations(p_email) i join public.scene_vendors v on v.id = i.vendor_id;
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
-- Personas: o (dueña), a (admin con Editar y crear páginas sobre PR), p (miembro con Comentar sobre PR y la casilla),
-- q (miembro con Ver sobre PR y la casilla), r (miembro con Comentar sobre PR, sin casilla), g (invitado con Comentar
-- sobre PR y la casilla: un productor de afuera), v (invitado que ya entró: un vendor), e (miembro con Editar sobre PR),
-- n (cuenta confirmada sin membresía: alguien nuevo), y (admin sin nada en PR).
update public.members set removed_at = now() where role = 'owner' and removed_at is null;
insert into auth.users (id, email, aud, role, email_confirmed_at) values
  (pg_temp.u('f0a0'), 'vd-o@test.invalid', 'authenticated', 'authenticated', now()),
  (pg_temp.u('f0a1'), 'vd-a@test.invalid', 'authenticated', 'authenticated', now()),
  (pg_temp.u('f0a2'), 'vd-p@test.invalid', 'authenticated', 'authenticated', now()),
  (pg_temp.u('f0a3'), 'vd-q@test.invalid', 'authenticated', 'authenticated', now()),
  (pg_temp.u('f0a4'), 'vd-r@test.invalid', 'authenticated', 'authenticated', now()),
  (pg_temp.u('f0a5'), 'vd-g@test.invalid', 'authenticated', 'authenticated', now()),
  (pg_temp.u('f0a6'), 'vd-v@test.invalid', 'authenticated', 'authenticated', now()),
  (pg_temp.u('f0a8'), 'vd-e@test.invalid', 'authenticated', 'authenticated', now()),
  (pg_temp.u('f0a9'), 'vd-n@test.invalid', 'authenticated', 'authenticated', now()),
  (pg_temp.u('f0aa'), 'vd-y@test.invalid', 'authenticated', 'authenticated', now());
insert into public.members (user_id, role) values
  (pg_temp.u('f0a0'), 'owner'), (pg_temp.u('f0a1'), 'admin'), (pg_temp.u('f0a2'), 'member'), (pg_temp.u('f0a3'), 'member'),
  (pg_temp.u('f0a4'), 'member'), (pg_temp.u('f0a5'), 'guest'), (pg_temp.u('f0a6'), 'guest'), (pg_temp.u('f0a8'), 'member'),
  (pg_temp.u('f0aa'), 'admin');
insert into public.workspaces (id, owner_id, name) values
  (pg_temp.u('f0e0'), pg_temp.u('f0a0'), 'PR'),
  (pg_temp.u('f0e1'), pg_temp.u('f0a0'), 'Q');
-- PR: DES (carpeta de escenas) › S1 (› F1, su ficha), S2, S3, S4 (sin marca), S5 (escena › L5, una locación), T (escena,
-- en la papelera); LOC › L1; OTRA (una página suelta, para mover). Q: QS (escena).
insert into public.pages (id, workspace_id, parent_id, title, sort_key, settings) values
  (pg_temp.u('f0b0'), pg_temp.u('f0e0'), null, 'DES', 'a0', '{"holds": "scene"}'),
  (pg_temp.u('f0b1'), pg_temp.u('f0e0'), pg_temp.u('f0b0'), 'S1', 'a0', '{"entity": {"kind": "scene", "code": "101"}}'),
  (pg_temp.u('f0b2'), pg_temp.u('f0e0'), pg_temp.u('f0b1'), 'F1', 'a0', '{}'),
  (pg_temp.u('f0b3'), pg_temp.u('f0e0'), pg_temp.u('f0b0'), 'S2', 'a1', '{"entity": {"kind": "scene", "code": "102"}}'),
  (pg_temp.u('f0b4'), pg_temp.u('f0e0'), pg_temp.u('f0b0'), 'S3', 'a2', '{"entity": {"kind": "scene", "code": "103"}}'),
  (pg_temp.u('f0b5'), pg_temp.u('f0e0'), pg_temp.u('f0b0'), 'S4', 'a3', '{}'),
  (pg_temp.u('f0b6'), pg_temp.u('f0e0'), pg_temp.u('f0b0'), 'S5', 'a4', '{"entity": {"kind": "scene", "code": "105"}}'),
  (pg_temp.u('f0b7'), pg_temp.u('f0e0'), pg_temp.u('f0b6'), 'L5', 'a0', '{"entity": {"kind": "location"}}'),
  (pg_temp.u('f0b8'), pg_temp.u('f0e0'), pg_temp.u('f0b0'), 'T', 'a5', '{"entity": {"kind": "scene", "code": "108"}}'),
  (pg_temp.u('f0b9'), pg_temp.u('f0e0'), null, 'LOC', 'a1', '{"holds": "location"}'),
  (pg_temp.u('f0ba'), pg_temp.u('f0e0'), pg_temp.u('f0b9'), 'L1', 'a0', '{"entity": {"kind": "location"}}'),
  (pg_temp.u('f0bc'), pg_temp.u('f0e0'), null, 'OTRA', 'a2', '{}'),
  (pg_temp.u('f0bb'), pg_temp.u('f0e1'), null, 'QS', 'a0', '{"entity": {"kind": "scene", "code": "101"}}');
insert into public.grants (user_id, project_id, page_id, level, share_scenes) values
  (pg_temp.u('f0a1'), pg_temp.u('f0e0'), null, 'edit_pages', false),
  (pg_temp.u('f0a2'), pg_temp.u('f0e0'), null, 'comment', true),
  (pg_temp.u('f0a3'), pg_temp.u('f0e0'), null, 'view', true),
  (pg_temp.u('f0a4'), pg_temp.u('f0e0'), null, 'comment', false),
  (pg_temp.u('f0a5'), pg_temp.u('f0e0'), null, 'comment', true),
  (pg_temp.u('f0a8'), pg_temp.u('f0e0'), null, 'edit', false);
-- Contenido (la base no lee Yjs): S1, S2 y S3 tienen algo, para ver el reinicio.
select pg_temp.as_user('f0a0');
select public.push_page_update(pg_temp.u('f0b1'), gen_random_uuid(), 'AQ==', '9.999');
select public.push_page_update(pg_temp.u('f0b3'), gen_random_uuid(), 'Ag==', '9.999');
select public.push_page_update(pg_temp.u('f0b4'), gen_random_uuid(), 'Aw==', '9.999');
select pg_temp.as_postgres();
update public.pages set deleted_at = now() where id = pg_temp.u('f0b8');

-- ---------------------------------------------------------------------------------------------------
-- 1. Las puertas
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  assert not has_function_privilege('anon', 'public.scene_vendors_list(uuid)', 'execute'), 'anon lista';
  assert not has_function_privilege('anon', 'public.save_scene_vendors(uuid, jsonb)', 'execute'), 'anon guarda';
  assert not has_function_privilege('anon', 'public.set_share_scenes(uuid, uuid, boolean)', 'execute'), 'anon pone la casilla';
  assert not has_function_privilege('public', 'public.save_scene_vendors(uuid, jsonb)', 'execute'), 'public guarda';
  assert has_function_privilege('authenticated', 'public.scene_vendors_list(uuid)', 'execute'), 'authenticated no lista';
  assert has_function_privilege('authenticated', 'public.save_scene_vendors(uuid, jsonb)', 'execute'), 'authenticated no guarda';
  assert has_function_privilege('authenticated', 'public.set_share_scenes(uuid, uuid, boolean)', 'execute'),
    'authenticated no pone la casilla';
  assert has_function_privilege('authenticated', 'public.list_access(uuid, uuid)', 'execute'), 'authenticated no lista accesos';
  assert not has_function_privilege('anon', 'public.list_access(uuid, uuid)', 'execute'), 'anon lista accesos';
  assert not has_function_privilege('authenticated', 'private.vendor_sync_email(uuid, text, uuid)', 'execute'), 'sync';
  assert not has_function_privilege('authenticated', 'private.vendor_cap(uuid)', 'execute'), 'vendor_cap';
  assert not has_function_privilege('authenticated', 'private.invitation_live(public.invitations)', 'execute'), 'invitation_live';
  assert not has_function_privilege('authenticated', 'private.live_vendor_invitations(text)', 'execute'), 'live_vendor_invitations';
  assert not has_function_privilege('authenticated', 'private.grants_vendor_guard()', 'execute'), 'el trigger';
  assert not has_table_privilege('authenticated', 'public.scene_vendors', 'select'), 'la tabla de vendors se lee';
  assert not has_table_privilege('authenticated', 'public.scene_vendor_emails', 'select'), 'la tabla de correos se lee';
  assert not has_table_privilege('authenticated', 'public.scene_vendor_scenes', 'select'), 'la tabla de escenas se lee';
  assert not has_table_privilege('authenticated', 'public.scene_vendors', 'insert'), 'la tabla de vendors se escribe';
  assert (select count(*) = 4 and bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('scene_vendors_list', 'save_scene_vendors', 'set_share_scenes', 'list_access')),
    'una función sin SECURITY DEFINER o sin search_path vacío';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 2. Quién maneja los vendors, y el interruptor de lo borrado
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.check(pg_temp.cap('f0a0'), '2', 'la dueña');
  perform pg_temp.check(pg_temp.cap('f0a1'), '2', 'un admin que comparte el proyecto');
  perform pg_temp.check(pg_temp.cap('f0a2'), '2', 'con la casilla y Comentar');
  perform pg_temp.check(pg_temp.cap('f0a3'), '1', 'con la casilla y Ver: hasta Ver');
  perform pg_temp.check(pg_temp.cap('f0a5'), '2', 'un invitado con la casilla');
  perform pg_temp.check(pg_temp.cap('f0a4'), 'error:not_allowed', 'sin la casilla');
  perform pg_temp.check(pg_temp.cap('f0a8'), 'error:not_allowed', 'con Editar y sin la casilla');
  perform pg_temp.check(pg_temp.cap('f0aa'), 'error:not_allowed', 'un admin sin el proyecto');
  perform pg_temp.check(pg_temp.cap('f0a9'), 'error:not_allowed', 'sin membresía');
  perform pg_temp.check(pg_temp.cap('f0a2', 'password'), 'error:not_allowed', 'con contraseña');
  perform pg_temp.check(pg_temp.sv('f0a4', '[{"op":"create","name":"X","color":"#2e5a8e","level":"view"}]'),
    'error:not_allowed', 'guardar sin la casilla');
  -- Sin el interruptor de lo borrado, nada.
  perform pg_temp.check(pg_temp.sv('f0a0', '[{"op":"create","name":"X","color":"#2e5a8e","level":"view"}]'),
    'error:clean_off', 'sin el interruptor');
end;
$$;
update public.workspace_settings set clean_min_version = '0.1' where id;

-- ---------------------------------------------------------------------------------------------------
-- 3. Crear, campos y niveles
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  r text;
begin
  perform pg_temp.check(pg_temp.sv('f0a0', '[]'), 'error:ops_invalid', 'una lista vacía');
  perform pg_temp.check(pg_temp.sv('f0a0', '{}'), 'error:ops_invalid', 'no es una lista');
  perform pg_temp.check(pg_temp.sv('f0a0', '[{"op":"rename"}]'), 'error:ops_invalid', 'una operación que no existe');
  perform pg_temp.check(pg_temp.sv('f0a0', '[{"op":"create","name":"X","color":"#2e5a8e","level":"view","add_scenes":"no"}]'),
    'error:ops_invalid', 'una lista que no es lista');
  perform pg_temp.check(pg_temp.sv('f0a0', '[{"op":"create","name":"X","color":"#2e5a8e","level":"view","add_scenes":["no"]}]'),
    'error:ops_invalid', 'una escena que no es un id');
  perform pg_temp.check(pg_temp.sv('f0a0', '[{"op":"create","name":"X","color":"azul","level":"view"}]'),
    'error:vendor_invalid', 'un color que no es hex');
  perform pg_temp.check(pg_temp.sv('f0a0', '[{"op":"create","name":"","color":"#2e5a8e","level":"view"}]'),
    'error:vendor_invalid', 'sin nombre');
  perform pg_temp.check(pg_temp.sv('f0a0', '[{"op":"create","name":"X","code":"ABCDE","color":"#2e5a8e","level":"view"}]'),
    'error:vendor_invalid', 'un código de 5');
  perform pg_temp.check(pg_temp.sv('f0a0', '[{"op":"create","name":"X","color":"#2e5a8e","level":"edit"}]'),
    'error:vendor_invalid', 'Editar');
  perform pg_temp.check(pg_temp.sv('f0a3', '[{"op":"create","name":"X","color":"#2e5a8e","level":"comment"}]'),
    'error:level_not_allowed', 'con Ver no crea uno con Comentar');
  perform pg_temp.check((select count(*)::text from public.scene_vendors where project_id = pg_temp.u('f0e0')), '0',
    'nada quedó');

  -- Planificación: un vendor sin correos con dos escenas no comparte nada.
  r := pg_temp.svs('f0a0', format('[{"op":"create","key":"k1","name":"DNEG","code":"DN","color":"#2e5a8e","level":"comment","add_scenes":[%s,%s]}]',
                                  to_json(pg_temp.u('f0b1')), to_json(pg_temp.u('f0b3'))));
  perform pg_temp.check(r::jsonb -> 'keys' ->> 'k1', pg_temp.vid('DNEG')::text, 'la clave devuelve el id');
  perform pg_temp.check(r::jsonb ->> 'pending', '[]', 'sin correos, nadie pendiente');
  perform pg_temp.check((select count(*)::text from public.scene_vendor_scenes where vendor_id = pg_temp.vid('DNEG')), '2', 'dos escenas');
  perform pg_temp.check((select count(*)::text from public.invitations where vendor_id is not null), '0', 'ninguna invitación');
  perform pg_temp.check(pg_temp.run_as('f0a8', format('select public.page_has_outside_readers(%L)::text', pg_temp.u('f0b1'))),
    'false', 'un vendor sin correos no hace que la vean de afuera');
  -- Con Ver: no suma escenas a un vendor con Comentar, pero saca y baja.
  perform pg_temp.check(pg_temp.sv('f0a3', format('[{"op":"update","id":"%s","add_scenes":["%s"]}]', pg_temp.vid('DNEG'), pg_temp.u('f0b4'))),
    'error:level_not_allowed', 'con Ver no suma a uno con Comentar');
  perform pg_temp.check(pg_temp.sv('f0a3', format('[{"op":"update","id":"%s","add_emails":["x@test.invalid"]}]', pg_temp.vid('DNEG'))),
    'error:level_not_allowed', 'con Ver no le suma un correo');
  perform pg_temp.check(pg_temp.sv('f0a3', format('[{"op":"update","id":"%s","name":"DNEG Ltd"}]', pg_temp.vid('DNEG'))),
    'ok', 'con Ver lo renombra');
  perform pg_temp.check(pg_temp.sv('f0a3', format('[{"op":"update","id":"%s","name":"DNEG","level":"view"}]', pg_temp.vid('DNEG Ltd'))),
    'ok', 'con Ver lo baja a Ver');
  perform pg_temp.check(pg_temp.sv('f0a3', format('[{"op":"update","id":"%s","level":"comment"}]', pg_temp.vid('DNEG'))),
    'error:level_not_allowed', 'con Ver no lo sube');
  perform pg_temp.check(pg_temp.sv('f0a2', format('[{"op":"update","id":"%s","level":"comment"}]', pg_temp.vid('DNEG'))),
    'ok', 'con Comentar lo sube a Comentar');
  perform pg_temp.check(pg_temp.sv('f0a0', format('[{"op":"update","id":"%s"},{"op":"update","id":"%s"}]', pg_temp.vid('DNEG'), pg_temp.vid('DNEG'))),
    'error:ops_invalid', 'el mismo vendor dos veces');
  perform pg_temp.check(pg_temp.sv('f0a0', format('[{"op":"update","id":"%s"}]', gen_random_uuid())),
    'error:vendor_not_found', 'un vendor que no existe');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 4. Las escenas que entran y salen
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  dn uuid := pg_temp.vid('DNEG');
  op text := '[{"op":"update","id":"%s","add_scenes":["%s"]}]';
begin
  perform pg_temp.check(pg_temp.sv('f0a0', format(op, dn, pg_temp.u('f0b5'))), 'error:page_invalid', 'sin la marca de escena');
  perform pg_temp.check(pg_temp.sv('f0a0', format(op, dn, pg_temp.u('f0b8'))), 'error:page_invalid', 'en la papelera');
  perform pg_temp.check(pg_temp.sv('f0a0', format(op, dn, pg_temp.u('f0bb'))), 'error:page_invalid', 'de otro proyecto');
  perform pg_temp.check(pg_temp.sv('f0a0', format(op, dn, pg_temp.u('f0b0'))), 'error:page_invalid', 'la carpeta de escenas');
  perform pg_temp.check(pg_temp.sv('f0a0', format(op, dn, pg_temp.u('f0ba'))), 'error:page_invalid', 'una locación');
  perform pg_temp.check(pg_temp.sv('f0a0', format(op, dn, gen_random_uuid())), 'error:page_invalid', 'una que no existe');
  perform pg_temp.check(pg_temp.sv('f0a0', format(op, dn, pg_temp.u('f0b1'))), 'error:page_invalid', 'una que ya tiene');
  perform pg_temp.check(pg_temp.sv('f0a0', format(op, dn, pg_temp.u('f0b6'))), 'error:scene_contains_entities',
    'una escena con una locación adentro');
  perform pg_temp.check(pg_temp.sv('f0a0', format('[{"op":"update","id":"%s","remove_scenes":["%s"]}]', dn, pg_temp.u('f0b4'))),
    'error:page_invalid', 'sacar una que no tiene');
  -- Todo o nada: S3 (buena) con S4 (sin marca) no deja nada.
  perform pg_temp.check(pg_temp.sv('f0a0', format('[{"op":"update","id":"%s","name":"Cambiado","add_scenes":["%s","%s"]}]',
                                                   dn, pg_temp.u('f0b4'), pg_temp.u('f0b5'))),
    'error:page_invalid', 'una buena y una mala');
  perform pg_temp.check((select count(*)::text from public.scene_vendor_scenes where vendor_id = dn), '2', 'no entró S3');
  perform pg_temp.check((select name from public.scene_vendors where id = dn), 'DNEG', 'no cambió el nombre');
  -- Un productor con la casilla suma escenas que ve.
  perform pg_temp.check(pg_temp.sv('f0a2', format(op, dn, pg_temp.u('f0b4'))), 'ok', 'el productor suma S3');
  perform pg_temp.check(pg_temp.sv('f0a2', format('[{"op":"update","id":"%s","remove_scenes":["%s"]}]', dn, pg_temp.u('f0b4'))),
    'ok', 'y la saca');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 5. Correos: miembros, personas nuevas, un correo en un solo vendor
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  dn uuid := pg_temp.vid('DNEG');
  r text;
  seq bigint;
begin
  perform pg_temp.check(pg_temp.sv('f0a0', format('[{"op":"update","id":"%s","add_emails":["no es correo"]}]', dn)),
    'error:email_invalid', 'un correo inválido');
  perform pg_temp.check(pg_temp.sv('f0a0', format('[{"op":"update","id":"%s","remove_emails":["nadie@test.invalid"]}]', dn)),
    'error:email_not_found', 'sacar uno que no está');
  perform pg_temp.check(pg_temp.sv('f0a0', format('[{"op":"update","id":"%s","reinvite":["nadie@test.invalid"]}]', dn)),
    'error:email_not_found', 'volver a invitar a uno que no está');

  -- Alguien nuevo: una invitación de invitado del vendor, sin páginas, que reinicia S1 y S2.
  r := pg_temp.svs('f0a0', format('[{"op":"update","id":"%s","add_emails":[" VD-New@Test.Invalid "]}]', dn));
  perform pg_temp.check(r::jsonb ->> 'pending', '["vd-new@test.invalid"]', 'pendiente, en minúsculas');
  perform pg_temp.check((select jsonb_agg(x order by x)::text from jsonb_array_elements_text(r::jsonb -> 'reset') x),
    format('["%s", "%s"]', pg_temp.u('f0b1'), pg_temp.u('f0b3')), 'reinicia S1 y S2');
  perform pg_temp.check(pg_temp.vinv('vd-new@test.invalid'), 'DNEG', 'la invitación del vendor');
  perform pg_temp.check((select role || '|' || grants::text from public.invitations where email = 'vd-new@test.invalid'),
    'guest|[]', 'de invitado y sin páginas');
  perform pg_temp.check((pg_temp.reset_seq('f0b1') = pg_temp.update_seq('f0b1'))::text, 'true', 'S1 reiniciada');
  perform pg_temp.check((select count(*)::text from private.live_invitations('vd-new@test.invalid')), '0',
    'no es una invitación de siempre');
  perform pg_temp.check(pg_temp.run_as('f0a0', 'select count(*)::text from public.list_invitations() where email = ''vd-new@test.invalid'''),
    '0', 'Members no la ve');
  perform pg_temp.check(private.hook_before_user_created('{"user": {"email": "vd-new@test.invalid"}}')::text, '{}',
    'el registro la acepta');
  perform pg_temp.check(pg_temp.run_as('f0a8', format('select public.page_has_outside_readers(%L)::text', pg_temp.u('f0b2'))),
    'true', 'quien edita sabe que F1 la ven de afuera');
  perform pg_temp.check(pg_temp.run_as('f0a0', format('select string_agg(right(page_id::text, 4), %L order by page_id) from public.pages_with_outside_readers(%L)', ',', pg_temp.u('f0e0'))),
    'f0b1,f0b3', 'la marca del árbol');
  perform pg_temp.check(pg_temp.run_as('f0a0', format('select count(*)::text from public.project_page_shares(%L) where email = %L', pg_temp.u('f0e0'), 'vd-new@test.invalid')),
    '2', 'la ventana vieja la ve con sus dos escenas');

  -- Un invitado que ya entró: permisos del vendor con su nivel.
  perform pg_temp.check(pg_temp.sv('f0a0', format('[{"op":"update","id":"%s","add_emails":["vd-v@test.invalid"]}]', dn)), 'ok', 'suma a v');
  perform pg_temp.check(pg_temp.grants_of('f0a6'), 'f0b1:comment:DNEG,f0b3:comment:DNEG', 'v ve S1 y S2 con Comentar');
  -- Quien ya ve más (Editar sobre el proyecto) no recibe permisos.
  perform pg_temp.check(pg_temp.sv('f0a0', format('[{"op":"update","id":"%s","add_emails":["vd-e@test.invalid"]}]', dn)), 'ok', 'suma a e');
  perform pg_temp.check(pg_temp.grants_of('f0a8'), '(ninguno)', 'e no recibe nada');
  perform pg_temp.check(pg_temp.sv('f0a0', format('[{"op":"update","id":"%s","add_emails":["vd-v@test.invalid"]}]', dn)),
    'error:email_exists', 'el mismo correo dos veces');

  -- Un correo, un solo vendor vivo: a otro no; moverlo en un guardado, sí.
  perform pg_temp.check(pg_temp.sv('f0a0', format('[{"op":"create","name":"Framestore","code":"FS","color":"#774dcb","level":"view","add_scenes":["%s"],"add_emails":["vd-v@test.invalid"]}]',
                                                   pg_temp.u('f0b4'))),
    'error:email_in_other_vendor', 'en dos vendors');
  perform pg_temp.check((select count(*)::text from public.scene_vendors where name = 'Framestore'), '0', 'no quedó Framestore');
  -- El productor de afuera (invitado con la casilla) crea Framestore con S3 y lleva a v de DNEG a Framestore.
  perform pg_temp.check(pg_temp.sv('f0a5', format('[{"op":"update","id":"%s","remove_emails":["vd-v@test.invalid"]},{"op":"create","name":"Framestore","code":"FS","color":"#774dcb","level":"view","add_scenes":["%s"],"add_emails":["vd-v@test.invalid"]}]',
                                                   dn, pg_temp.u('f0b4'))),
    'ok', 'mover v de un vendor a otro');
  perform pg_temp.check(pg_temp.grants_of('f0a6'), 'f0b4:view:Framestore', 'v ve solo S3, con Ver');
  perform pg_temp.check((pg_temp.reset_seq('f0b4') = pg_temp.update_seq('f0b4'))::text, 'true', 'S3 reiniciada');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 6. Aceptar trae las escenas de ese momento
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  dn uuid := pg_temp.vid('DNEG');
begin
  -- DNEG suma S3 mientras la invitación de vd-new sigue sin usar.
  perform pg_temp.check(pg_temp.sv('f0a2', format('[{"op":"update","id":"%s","add_scenes":["%s"]}]', dn, pg_temp.u('f0b4'))),
    'ok', 'S3 a DNEG');
  perform pg_temp.check(pg_temp.vinv('vd-new@test.invalid'), 'DNEG', 'la invitación sigue viva');
  perform pg_temp.as_postgres();
  insert into auth.users (id, email, aud, role, email_confirmed_at)
  values (pg_temp.u('f0ab'), 'vd-new@test.invalid', 'authenticated', 'authenticated', now());
  perform pg_temp.check(pg_temp.run_as('f0ab', 'select public.accept_invitations()::text'), '1', 'acepta una');
  perform pg_temp.check((select role from public.members where user_id = pg_temp.u('f0ab')), 'guest', 'entra como invitado');
  perform pg_temp.check(pg_temp.grants_of('f0ab'), 'f0b1:comment:DNEG,f0b3:comment:DNEG,f0b4:comment:DNEG',
    'las tres escenas de ahora, con Comentar');
  perform pg_temp.check(pg_temp.vinv('vd-new@test.invalid'), '(ninguna)', 'la invitación se usó');
  perform pg_temp.check((pg_temp.run_as('f0a0', format('select (public.scene_vendors_list(%L) -> %L)::text', pg_temp.u('f0e0'), 'vendors')) like '%"vd-new@test.invalid", "state": "joined"%')::text,
    'true', 'la lista lo muestra adentro');
  -- Un vendor nunca ve la lista de vendors.
  perform pg_temp.check(pg_temp.cap('f0ab'), 'error:not_allowed', 'el vendor no ve la lista');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 7. Sacar una escena, bajar el nivel, sacar un correo y borrar un vendor revocan
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  dn uuid := pg_temp.vid('DNEG');
  fs uuid := pg_temp.vid('Framestore');
begin
  perform pg_temp.check(pg_temp.sv('f0a0', format('[{"op":"update","id":"%s","remove_scenes":["%s"]}]', dn, pg_temp.u('f0b3'))),
    'ok', 'saca S2');
  perform pg_temp.check(pg_temp.grants_of('f0ab'), 'f0b1:comment:DNEG,f0b4:comment:DNEG', 'sin S2');
  perform pg_temp.check(pg_temp.sv('f0a0', format('[{"op":"update","id":"%s","level":"view"}]', dn)), 'ok', 'baja a Ver');
  perform pg_temp.check(pg_temp.grants_of('f0ab'), 'f0b1:view:DNEG,f0b4:view:DNEG', 'con Ver');
  -- Un correo pendiente en Framestore, y v sale de Framestore.
  perform pg_temp.check(pg_temp.sv('f0a0', format('[{"op":"update","id":"%s","add_emails":["vd-pend@test.invalid"],"remove_emails":["vd-v@test.invalid"]}]', fs)),
    'ok', 'pendiente adentro, v afuera');
  perform pg_temp.check(pg_temp.grants_of('f0a6'), '(ninguno)', 'v ya no ve nada');
  perform pg_temp.check(pg_temp.vinv('vd-pend@test.invalid'), 'Framestore', 'invitación de Framestore');
  -- Volver a invitar renueva la misma.
  perform pg_temp.check(pg_temp.sv('f0a0', format('[{"op":"update","id":"%s","reinvite":["vd-pend@test.invalid"]}]', fs)), 'ok', 'reinvitar');
  perform pg_temp.check((select count(*)::text from public.invitations where email = 'vd-pend@test.invalid'), '1', 'una sola invitación');
  -- Borrar Framestore: la invitación muere y el registro ya no la acepta.
  perform pg_temp.check(pg_temp.sv('f0a0', format('[{"op":"delete","id":"%s"}]', fs)), 'ok', 'borra Framestore');
  perform pg_temp.check(pg_temp.vinv('vd-pend@test.invalid'), '(ninguna)', 'sin invitación');
  perform pg_temp.check((private.hook_before_user_created('{"user": {"email": "vd-pend@test.invalid"}}') ? 'error')::text, 'true',
    'el registro no la acepta');
  perform pg_temp.check(pg_temp.sv('f0a0', format('[{"op":"update","id":"%s","name":"X"}]', fs)), 'error:vendor_not_found',
    'un vendor borrado no se toca');
  -- Su correo puede ir a otro vendor.
  perform pg_temp.check(pg_temp.sv('f0a0', format('[{"op":"update","id":"%s","add_emails":["vd-pend@test.invalid"]}]', dn)),
    'ok', 'a DNEG');
  -- Borrar DNEG: vd-new pierde todo.
  perform pg_temp.check(pg_temp.sv('f0a0', format('[{"op":"delete","id":"%s"}]', dn)), 'ok', 'borra DNEG');
  perform pg_temp.check(pg_temp.grants_of('f0ab'), '(ninguno)', 'vd-new ya no ve nada');
  perform pg_temp.check(pg_temp.vinv('vd-pend@test.invalid'), '(ninguna)', 'vd-pend tampoco');
  perform pg_temp.check(pg_temp.run_as('f0a0', format('select count(*)::text from public.pages_with_outside_readers(%L)', pg_temp.u('f0e0'))),
    '0', 'nada lo ven de afuera');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 8. El freno de movimientos con una invitación de vendor
-- ---------------------------------------------------------------------------------------------------
create function pg_temp.move_as(who text, page text, parent text) returns text language sql as $$
  select pg_temp.run_as(who, format('update public.pages set parent_id = %L where id = %L returning %L',
                                    pg_temp.u(parent), pg_temp.u(page), 'ok'));
$$;

do $$
begin
  perform pg_temp.check(pg_temp.sv('f0a0', format('[{"op":"create","name":"Weta","color":"#2e8e7a","level":"view","add_scenes":["%s"],"add_emails":["vd-w@test.invalid"]}]',
                                                   pg_temp.u('f0b1'))),
    'ok', 'Weta con S1 y un correo pendiente');
  perform pg_temp.check(pg_temp.move_as('f0a0', 'f0ba', 'f0b1'), 'error:moved_into_shared_scene', 'mover L1 a S1');
  perform pg_temp.check(pg_temp.move_as('f0a0', 'f0bc', 'f0b1'), 'error:moved_into_shared_scene', 'una página suelta tampoco');
  -- Sin correos (planificación), S2 no frena nada.
  perform pg_temp.check(pg_temp.sv('f0a0', '[{"op":"create","name":"Plan","color":"#4a7a2e","level":"view","add_scenes":["00000000-0000-4000-8000-00000000f0b3"]}]'),
    'ok', 'Plan con S2, sin correos');
  perform pg_temp.check(pg_temp.move_as('f0a0', 'f0ba', 'f0b3'), 'ok', 'mover L1 a S2');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 9. La casilla *Can share scenes* y `list_access`
-- ---------------------------------------------------------------------------------------------------
create function pg_temp.ssc(who text, target text, on_ boolean) returns text language sql as $$
  select pg_temp.run_as(who, format('select public.set_share_scenes(%L, %L, %L)::text', pg_temp.u('f0e0'), pg_temp.u(target), on_));
$$;

do $$
begin
  perform pg_temp.check(pg_temp.ssc('f0a0', 'f0a4', true), '', 'la dueña se la pone a r');
  perform pg_temp.check(pg_temp.cap('f0a4'), '2', 'r ahora maneja vendors');
  perform pg_temp.check(pg_temp.ssc('f0a1', 'f0a4', false), '', 'un admin que comparte se la saca');
  perform pg_temp.check(pg_temp.cap('f0a4'), 'error:not_allowed', 'r ya no');
  perform pg_temp.check(pg_temp.ssc('f0a2', 'f0a4', true), 'error:not_allowed', 'con la casilla no se la da a otro');
  perform pg_temp.check(pg_temp.ssc('f0aa', 'f0a4', true), 'error:not_allowed', 'un admin sin el proyecto');
  perform pg_temp.check(pg_temp.ssc('f0a0', 'f0aa', true), 'error:grant_not_found', 'sin permiso sobre el proyecto');
  perform pg_temp.check(pg_temp.ssc('f0a0', 'f0a2', true), '', 'repetir no cambia nada');
  perform pg_temp.check(pg_temp.run_as('f0a0', format('select string_agg(email || %L || share_scenes::text, %L order by email) from public.list_access(%L, null) where source = %L',
                                                       ':', ',', pg_temp.u('f0e0'), 'project')),
    'vd-a@test.invalid:false,vd-e@test.invalid:false,vd-g@test.invalid:true,vd-p@test.invalid:true,vd-q@test.invalid:true,vd-r@test.invalid:false',
    'list_access la muestra');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 10. Otro camino que toca un permiso
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  -- Revocar el permiso de p apaga la casilla, y revivirlo no la devuelve.
  update public.grants set revoked_at = now() where user_id = pg_temp.u('f0a2') and project_id = pg_temp.u('f0e0');
  update public.grants set revoked_at = null where user_id = pg_temp.u('f0a2') and project_id = pg_temp.u('f0e0');
  perform pg_temp.check((select share_scenes::text from public.grants where user_id = pg_temp.u('f0a2') and project_id = pg_temp.u('f0e0')),
    'false', 'revivir no devuelve la casilla');
  -- Un permiso de Weta: cambiarle el nivel por otro camino le saca el vendor.
  perform pg_temp.check(pg_temp.sv('f0a0', format('[{"op":"update","id":"%s","add_emails":["vd-v@test.invalid"]}]', pg_temp.vid('Weta'))),
    'ok', 'v en Weta');
  perform pg_temp.check(pg_temp.grants_of('f0a6'), 'f0b1:view:Weta', 'v ve S1 por Weta');
  update public.grants set level = 'comment' where user_id = pg_temp.u('f0a6') and page_id = pg_temp.u('f0b1');
  perform pg_temp.check(pg_temp.grants_of('f0a6'), 'f0b1:comment:-', 'ya no es de Weta');
  -- Sacar a v de Weta no toca ese permiso (ya no es del vendor).
  perform pg_temp.check(pg_temp.sv('f0a0', format('[{"op":"update","id":"%s","remove_emails":["vd-v@test.invalid"]}]', pg_temp.vid('Weta'))),
    'ok', 'v afuera de Weta');
  perform pg_temp.check(pg_temp.grants_of('f0a6'), 'f0b1:comment:-', 'sigue con su permiso propio');
  -- El registro sin invitación, no.
  perform pg_temp.check((private.hook_before_user_created('{"user": {"email": "nadie@test.invalid"}}') ? 'error')::text, 'true',
    'sin invitación no entra');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 11. Lo que encontró la auditoría
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  -- Una escena que dejó de poder compartirse mientras el vendor no tenía correos (L1 quedó adentro de S2, sección 8):
  -- la lista la marca y un correo nuevo no la recibe (ni un miembro ni una invitación, que tampoco la reinicia).
  perform pg_temp.check(pg_temp.run_as('f0a0', format('select (s ->> %L) from jsonb_array_elements(public.scene_vendors_list(%L) -> %L) v, jsonb_array_elements(v -> %L) s where v ->> %L = %L',
                                                      'ok', pg_temp.u('f0e0'), 'vendors', 'scenes', 'name', 'Plan')),
    'false', 'S2 queda bloqueada en Plan');
  perform pg_temp.check(pg_temp.sv('f0a0', format('[{"op":"update","id":"%s","add_emails":["vd-v@test.invalid","vd-x@test.invalid"]}]', pg_temp.vid('Plan'))),
    'ok', 'Plan recibe a v y a alguien nuevo');
  perform pg_temp.check(pg_temp.grants_of('f0a6'), 'f0b1:comment:-', 'v no recibe S2');
  perform pg_temp.check(pg_temp.vinv('vd-x@test.invalid'), 'Plan', 'x queda invitado a Plan');
  perform pg_temp.check(pg_temp.run_as('f0a0', format('select count(*)::text from public.project_page_shares(%L) where page_id = %L', pg_temp.u('f0e0'), pg_temp.u('f0b3'))),
    '0', 'S2 no figura como compartida');
  perform pg_temp.check(pg_temp.sv('f0a0', format('[{"op":"update","id":"%s","remove_emails":["vd-v@test.invalid","vd-x@test.invalid"]}]', pg_temp.vid('Plan'))),
    'ok', 'Plan sin correos otra vez');

  -- Un permiso propio (sin vendor) no se lo toma el vendor: sacar el correo no se lo lleva.
  update public.grants set level = 'view' where user_id = pg_temp.u('f0a6') and page_id = pg_temp.u('f0b1');
  perform pg_temp.check(pg_temp.sv('f0a0', format('[{"op":"create","name":"Up","color":"#8e7a2e","level":"comment","add_scenes":["%s"],"add_emails":["vd-v@test.invalid"]}]',
                                                   pg_temp.u('f0b1'))),
    'ok', 'Up con S1 y v');
  perform pg_temp.check(pg_temp.grants_of('f0a6'), 'f0b1:view:-', 'el permiso de v sigue siendo suyo');
  perform pg_temp.check(pg_temp.sv('f0a0', format('[{"op":"update","id":"%s","remove_emails":["vd-v@test.invalid"]}]', pg_temp.vid('Up'))),
    'ok', 'v afuera de Up');
  perform pg_temp.check(pg_temp.grants_of('f0a6'), 'f0b1:view:-', 'y no lo pierde');

  -- Con la casilla, uno no se carga a sí mismo (dueña y admin, sí pueden).
  perform pg_temp.check(pg_temp.sv('f0a5', format('[{"op":"update","id":"%s","add_emails":["VD-G@test.invalid"]}]', pg_temp.vid('Up'))),
    'error:own_email', 'g no se suma a Up');
  perform pg_temp.check(pg_temp.sv('f0a5', format('[{"op":"update","id":"%s","add_emails":["vd-y@test.invalid"]}]', pg_temp.vid('Up'))),
    'ok', 'g suma a otro');

  -- La invitación de un vendor de un proyecto borrado no vale (ni para registrarse).
  perform pg_temp.check(pg_temp.vinv('vd-w@test.invalid'), 'Weta', 'w invitado a Weta');
  update public.workspaces set deleted_at = now() where id = pg_temp.u('f0e0');
  perform pg_temp.check(pg_temp.vinv('vd-w@test.invalid'), '(ninguna)', 'con PR borrado, no');
  perform pg_temp.check((private.hook_before_user_created('{"user": {"email": "vd-w@test.invalid"}}') ? 'error')::text, 'true',
    'y no se registra');
end;
$$;

rollback;
select 'ok' as result;
