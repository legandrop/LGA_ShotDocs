-- Pruebas del equipo de un vendor y sus artistas (20261122120000_vendor_artistas.sql, Docs/Doc_Compartir_Escenas.md,
-- sección 12, D854): las puertas; quién es del equipo (la columna calculada de la lista de proyectos, la lista del
-- equipo, que nunca muestra los otros vendors); el equipo suma correos (marcados), saca solo los que sumó el equipo y
-- nunca el propio; un correo en un solo lugar del proyecto (sin decir dónde); los artistas (nivel nunca mayor que el
-- vendor, solo escenas del vendor, el propio correo no, el acceso que se arma solo, planificación sin correos); lo que
-- ve el proyecto (los artistas debajo de cada vendor, `by_team`); el proyecto sobre un artista (sacarle correos o
-- borrarlo, nada más); lo que el proyecto le hace a un vendor arrastra a sus artistas (bajar el nivel, sacar una escena,
-- borrarlo); un artista no es del equipo. Corre dentro de una transacción que se deshace al final. Si todo pasa,
-- devuelve 'ok'.

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

-- `save_scene_vendors` (el proyecto) y `save_vendor_team` (el equipo) sobre PR: 'ok' o el error.
create function pg_temp.sv(who text, ops text) returns text language sql as $$
  select case when r like 'error:%' then r else 'ok' end
  from pg_temp.run_as(who, format('select public.save_scene_vendors(%L, %L::jsonb)::text', pg_temp.u('f1e0'), ops)) r;
$$;
create function pg_temp.st(who text, ops text, method text default 'otp') returns text language sql as $$
  select case when r like 'error:%' then r else 'ok' end
  from pg_temp.run_as(who, format('select public.save_vendor_team(%L, %L::jsonb)::text', pg_temp.u('f1e0'), ops), method) r;
$$;
-- El error entero de `save_vendor_team`, con su hint (para ver que no nombra a otro vendor).
create function pg_temp.st_hint(who text, ops text) returns text language plpgsql as $$
declare
  h text;
begin
  perform pg_temp.as_user(who);
  begin
    perform public.save_vendor_team(pg_temp.u('f1e0'), ops::jsonb);
    h := 'ok';
  exception when others then
    get stacked diagnostics h = pg_exception_hint;
    h := sqlerrm || '|' || coalesce(h, '');
  end;
  perform pg_temp.as_postgres();
  return h;
end;
$$;

-- `vendor_team_get` de PR como `who`, en texto (o el error).
create function pg_temp.team(who text, method text default 'otp') returns text language sql as $$
  select pg_temp.run_as(who, format('select public.vendor_team_get(%L)::text', pg_temp.u('f1e0')), method);
$$;

-- La columna calculada de la lista de proyectos, como `who`.
create function pg_temp.vteam(who text) returns text language sql as $$
  select pg_temp.run_as(who, format('select public.vendor_team(w)::text from public.workspaces w where w.id = %L', pg_temp.u('f1e0')));
$$;

-- El id de un vendor o artista vivo de PR por su nombre.
create function pg_temp.vid(name text) returns uuid language sql as $$
  select id from public.scene_vendors where project_id = pg_temp.u('f1e0') and name = $1 and deleted_at is null;
$$;

-- Los permisos vivos de `who` sobre páginas: «sufijo:nivel:vendor», o '(ninguno)'.
create function pg_temp.grants_of(who text) returns text language sql as $$
  select coalesce(string_agg(right(g.page_id::text, 4) || ':' || g.level || ':' || coalesce(v.name, '-'), ',' order by g.page_id),
                  '(ninguno)')
  from public.grants g left join public.scene_vendors v on v.id = g.vendor_id
  where g.user_id = pg_temp.u(who) and g.page_id is not null and g.revoked_at is null;
$$;

-- Las invitaciones vivas de vendors de un correo, o '(ninguna)'.
create function pg_temp.vinv(p_email text) returns text language sql security definer as $$
  select coalesce(string_agg(v.name, ',' order by v.name), '(ninguna)')
  from private.live_vendor_invitations(p_email) i join public.scene_vendors v on v.id = i.vendor_id;
$$;

-- Las escenas de un artista, por sufijo.
create function pg_temp.scenes_of(name text) returns text language sql as $$
  select coalesce(string_agg(right(s.page_id::text, 4), ',' order by s.page_id), '(ninguna)')
  from public.scene_vendor_scenes s where s.vendor_id = pg_temp.vid(name);
$$;

-- ---------------------------------------------------------------------------------------------------
-- Datos
-- ---------------------------------------------------------------------------------------------------
-- o (dueña); t (invitado, productor de DNEG); c (invitado, coordinador que suma t); s (invitada, artista); x (invitado,
-- de otro vendor); m (miembro con Comentar sobre PR, sin vendor); n (cuenta nueva, sin membresía).
update public.members set removed_at = now() where role = 'owner' and removed_at is null;
insert into auth.users (id, email, aud, role, email_confirmed_at) values
  (pg_temp.u('f1a0'), 'va-o@test.invalid', 'authenticated', 'authenticated', now()),
  (pg_temp.u('f1a1'), 'va-t@test.invalid', 'authenticated', 'authenticated', now()),
  (pg_temp.u('f1a2'), 'va-c@test.invalid', 'authenticated', 'authenticated', now()),
  (pg_temp.u('f1a3'), 'va-s@test.invalid', 'authenticated', 'authenticated', now()),
  (pg_temp.u('f1a4'), 'va-x@test.invalid', 'authenticated', 'authenticated', now()),
  (pg_temp.u('f1a5'), 'va-m@test.invalid', 'authenticated', 'authenticated', now()),
  (pg_temp.u('f1a6'), 'va-n@test.invalid', 'authenticated', 'authenticated', now());
insert into public.members (user_id, role) values
  (pg_temp.u('f1a0'), 'owner'), (pg_temp.u('f1a1'), 'guest'), (pg_temp.u('f1a2'), 'guest'), (pg_temp.u('f1a3'), 'guest'),
  (pg_temp.u('f1a4'), 'guest'), (pg_temp.u('f1a5'), 'member');
insert into public.workspaces (id, owner_id, name) values (pg_temp.u('f1e0'), pg_temp.u('f1a0'), 'PR');
-- PR: DES › S1, S2, S3, S4 (escenas); LOC › L1.
insert into public.pages (id, workspace_id, parent_id, title, sort_key, settings) values
  (pg_temp.u('f1b0'), pg_temp.u('f1e0'), null, 'DES', 'a0', '{"holds": "scene"}'),
  (pg_temp.u('f1b1'), pg_temp.u('f1e0'), pg_temp.u('f1b0'), 'S1', 'a0', '{"entity": {"kind": "scene", "code": "101"}}'),
  (pg_temp.u('f1b2'), pg_temp.u('f1e0'), pg_temp.u('f1b0'), 'S2', 'a1', '{"entity": {"kind": "scene", "code": "102"}}'),
  (pg_temp.u('f1b3'), pg_temp.u('f1e0'), pg_temp.u('f1b0'), 'S3', 'a2', '{"entity": {"kind": "scene", "code": "103"}}'),
  (pg_temp.u('f1b4'), pg_temp.u('f1e0'), pg_temp.u('f1b0'), 'S4', 'a3', '{"entity": {"kind": "scene", "code": "104"}}'),
  (pg_temp.u('f1b5'), pg_temp.u('f1e0'), null, 'LOC', 'a1', '{"holds": "location"}'),
  (pg_temp.u('f1b6'), pg_temp.u('f1e0'), pg_temp.u('f1b5'), 'L1', 'a0', '{"entity": {"kind": "location"}}');
insert into public.grants (user_id, project_id, level) values (pg_temp.u('f1a5'), pg_temp.u('f1e0'), 'comment');
update public.workspace_settings set clean_min_version = '0.1' where id;

-- ---------------------------------------------------------------------------------------------------
-- 1. Las puertas
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  assert not has_function_privilege('anon', 'public.vendor_team_get(uuid)', 'execute'), 'anon lee el equipo';
  assert not has_function_privilege('anon', 'public.save_vendor_team(uuid, jsonb, uuid)', 'execute'), 'anon guarda el equipo';
  assert not has_function_privilege('anon', 'public.vendor_team(public.workspaces)', 'execute'), 'anon, la columna';
  assert not has_function_privilege('public', 'public.save_vendor_team(uuid, jsonb, uuid)', 'execute'), 'public guarda';
  assert has_function_privilege('authenticated', 'public.vendor_team_get(uuid)', 'execute'), 'authenticated no lee';
  assert has_function_privilege('authenticated', 'public.save_vendor_team(uuid, jsonb, uuid)', 'execute'), 'authenticated no guarda';
  assert has_function_privilege('authenticated', 'public.vendor_team(public.workspaces)', 'execute'), 'la columna';
  assert not has_function_privilege('authenticated', 'private.vendor_team_of(uuid)', 'execute'), 'vendor_team_of';
  assert not has_function_privilege('authenticated', 'private.vendor_artists_follow(uuid, uuid)', 'execute'), 'follow';
  assert not has_function_privilege('authenticated', 'private.vendor_emails_json(uuid)', 'execute'), 'emails_json';
  assert not has_function_privilege('authenticated', 'private.vendor_artists_json(uuid)', 'execute'), 'artists_json';
  assert (select count(*) = 5 and bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('vendor_team_get', 'save_vendor_team', 'vendor_team', 'scene_vendors_list', 'save_scene_vendors')),
    'una función sin SECURITY DEFINER o sin search_path vacío';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 2. Quién es del equipo
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  -- La dueña arma DNEG (S1, S2, S3; Comentar; t) y Otro (S4; x).
  perform pg_temp.check(pg_temp.sv('f1a0', format(
    '[{"op":"create","name":"DNEG","code":"DN","color":"#2e5a8e","level":"comment","add_scenes":["%s","%s","%s"],"add_emails":["va-t@test.invalid"]},
      {"op":"create","name":"Otro","color":"#774dcb","level":"comment","add_scenes":["%s"],"add_emails":["va-x@test.invalid"]}]',
    pg_temp.u('f1b1'), pg_temp.u('f1b2'), pg_temp.u('f1b3'), pg_temp.u('f1b4'))), 'ok', 'la dueña arma DNEG y Otro');
  perform pg_temp.check(pg_temp.grants_of('f1a1'), 'f1b1:comment:DNEG,f1b2:comment:DNEG,f1b3:comment:DNEG', 't ve DNEG');

  perform pg_temp.check(pg_temp.vteam('f1a1'), 'true', 't es del equipo');
  perform pg_temp.check(pg_temp.vteam('f1a4'), 'true', 'x es del equipo de Otro');
  perform pg_temp.check(pg_temp.vteam('f1a5'), 'false', 'm no');
  perform pg_temp.check(pg_temp.vteam('f1a0'), 'false', 'la dueña no es de ningún equipo');

  perform pg_temp.check(pg_temp.team('f1a1')::jsonb #>> '{vendor,name}', 'DNEG', 't lee su vendor');
  perform pg_temp.check((pg_temp.team('f1a1') like '%Otro%')::text, 'false', 't nunca ve Otro');
  perform pg_temp.check((pg_temp.team('f1a1') like '%va-x@%')::text, 'false', 't nunca ve los correos de Otro');
  perform pg_temp.check(pg_temp.team('f1a1')::jsonb ->> 'me', 'va-t@test.invalid', 'me');
  perform pg_temp.check(pg_temp.team('f1a5'), 'error:not_allowed', 'm no lee');
  perform pg_temp.check(pg_temp.team('f1a0'), 'error:not_allowed', 'la dueña no lee como equipo');
  perform pg_temp.check(pg_temp.team('f1a1', 'password'), 'error:not_allowed', 'con contraseña, no');
  perform pg_temp.check(pg_temp.st('f1a5', '[{"op":"team","add_emails":["va-n@test.invalid"]}]'), 'error:not_allowed', 'm no guarda');
  perform pg_temp.check(pg_temp.st('f1a1', '[{"op":"team","add_emails":["va-n@test.invalid"]}]', 'password'),
    'error:not_allowed', 't con contraseña no guarda');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 3. El equipo suma y saca correos
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  -- t suma a c: ve las tres escenas, y el correo queda marcado como del equipo.
  perform pg_temp.check(pg_temp.st('f1a1', '[{"op":"team","add_emails":["VA-C@test.invalid"]}]'), 'ok', 't suma a c');
  perform pg_temp.check(pg_temp.grants_of('f1a2'), 'f1b1:comment:DNEG,f1b2:comment:DNEG,f1b3:comment:DNEG', 'c ve DNEG');
  perform pg_temp.check((select by_team::text from public.scene_vendor_emails where vendor_id = pg_temp.vid('DNEG') and email = 'va-c@test.invalid'),
    'true', 'c, sumado por el equipo');
  perform pg_temp.check((select by_team::text from public.scene_vendor_emails where vendor_id = pg_temp.vid('DNEG') and email = 'va-t@test.invalid'),
    'false', 't, sumado por el proyecto');
  perform pg_temp.check(pg_temp.vteam('f1a2'), 'true', 'c es del equipo');
  -- Y c, a su vez, maneja lo mismo.
  perform pg_temp.check(pg_temp.team('f1a2')::jsonb #>> '{vendor,name}', 'DNEG', 'c lee DNEG');

  -- Lo que sumó el proyecto no lo saca el equipo; el propio, tampoco.
  perform pg_temp.check(pg_temp.st('f1a2', '[{"op":"team","remove_emails":["va-t@test.invalid"]}]'), 'error:email_locked',
    'c no saca a t');
  perform pg_temp.check(pg_temp.st('f1a2', '[{"op":"team","remove_emails":["va-c@test.invalid"]}]'), 'error:own_email',
    'c no se saca a sí mismo');
  perform pg_temp.check(pg_temp.st('f1a1', '[{"op":"team","remove_emails":["va-zz@test.invalid"]}]'), 'error:email_not_found',
    'un correo que no está');
  -- Lo que sumó el equipo, sí.
  perform pg_temp.check(pg_temp.st('f1a1', '[{"op":"team","remove_emails":["va-c@test.invalid"]}]'), 'ok', 't saca a c');
  perform pg_temp.check(pg_temp.grants_of('f1a2'), '(ninguno)', 'c ya no ve nada');
  perform pg_temp.check(pg_temp.st('f1a1', '[{"op":"team","add_emails":["va-c@test.invalid"]}]'), 'ok', 'c vuelve');

  -- Un correo que está en otro vendor: el error no dice cuál.
  perform pg_temp.check(pg_temp.st_hint('f1a1', '[{"op":"team","add_emails":["va-x@test.invalid"]}]'),
    'email_in_use|va-x@test.invalid', 'x está en Otro, sin nombrarlo');
  perform pg_temp.check(pg_temp.grants_of('f1a4'), 'f1b4:comment:Otro', 'x sigue en Otro');
  perform pg_temp.check(pg_temp.st('f1a1', '[{"op":"team","add_emails":["no-es-correo"]}]'), 'error:email_invalid', 'inválido');
  perform pg_temp.check(pg_temp.st('f1a1', '[{"op":"team","add_scenes":[]}]'), 'error:ops_invalid', 'el equipo no toca escenas');

  -- La ventana dice qué vendor tenía abierto: si ya no es el de la sesión, no guarda nada (`vendor_changed`).
  perform pg_temp.check(
    (select case when r like 'error:%' then r else 'ok' end
     from pg_temp.run_as('f1a1', format('select public.save_vendor_team(%L, %L::jsonb, %L)::text', pg_temp.u('f1e0'),
       '[{"op":"team","add_emails":["va-otro@test.invalid"]}]', pg_temp.vid('Otro'))) r),
    'error:vendor_changed', 'otro vendor en la ventana');
  perform pg_temp.check((select count(*)::text from public.scene_vendor_emails where email = 'va-otro@test.invalid'), '0', 'no guardó');
  perform pg_temp.check(
    (select case when r like 'error:%' then r else 'ok' end
     from pg_temp.run_as('f1a1', format('select public.save_vendor_team(%L, %L::jsonb, %L)::text', pg_temp.u('f1e0'),
       '[{"op":"team","reinvite":["va-c@test.invalid"]}]', pg_temp.vid('DNEG'))) r),
    'ok', 'el mismo vendor en la ventana');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 4. Los artistas
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  -- Sofi: S1 y S2, Comentar, con s. Roto: S3, sin correos (planificación).
  perform pg_temp.check(pg_temp.st('f1a1', format(
    '[{"op":"create","key":"k1","name":"Sofi","code":"SC","color":"#8e4a2e","level":"comment","add_scenes":["%s","%s"],"add_emails":["va-s@test.invalid"]},
      {"op":"create","key":"k2","name":"Roto","color":"#8e2e5a","level":"view","add_scenes":["%s"]}]',
    pg_temp.u('f1b1'), pg_temp.u('f1b2'), pg_temp.u('f1b3'))), 'ok', 't crea Sofi y Roto');
  perform pg_temp.check(pg_temp.grants_of('f1a3'), 'f1b1:comment:Sofi,f1b2:comment:Sofi', 's ve sus dos escenas');
  perform pg_temp.check(pg_temp.vteam('f1a3'), 'false', 'una artista no es del equipo');
  perform pg_temp.check(pg_temp.team('f1a3'), 'error:not_allowed', 'ni lee el equipo');
  perform pg_temp.check(jsonb_array_length(pg_temp.team('f1a1')::jsonb -> 'artists')::text, '2', 't ve sus dos artistas');

  -- Solo escenas del vendor; nunca más nivel que el vendor; ni campos raros.
  perform pg_temp.check(pg_temp.st('f1a1', format('[{"op":"create","name":"Mal","color":"#2e5a8e","level":"view","add_scenes":["%s"]}]',
    pg_temp.u('f1b4'))), 'error:page_invalid', 'S4 no es de DNEG');
  perform pg_temp.check(pg_temp.st('f1a1', format('[{"op":"create","name":"Mal","color":"#2e5a8e","level":"view","add_scenes":["%s"]}]',
    pg_temp.u('f1b6'))), 'error:page_invalid', 'una locación');
  perform pg_temp.check(pg_temp.st('f1a1', '[{"op":"create","name":"Mal","color":"#2e5a8e","level":"edit"}]'), 'error:vendor_invalid',
    'Editar no existe para un artista');
  perform pg_temp.check(pg_temp.st('f1a1', '[{"op":"create","name":"","color":"#2e5a8e","level":"view"}]'), 'error:vendor_invalid',
    'sin nombre');
  -- El propio correo no; uno del equipo tampoco (un solo lugar).
  perform pg_temp.check(pg_temp.st('f1a1', format('[{"op":"update","id":"%s","add_emails":["va-t@test.invalid"]}]', pg_temp.vid('Roto'))),
    'error:own_email', 't no se suma a Roto');
  perform pg_temp.check(pg_temp.st('f1a1', format('[{"op":"update","id":"%s","add_emails":["va-c@test.invalid"]}]', pg_temp.vid('Roto'))),
    'error:email_in_use', 'c ya es del equipo');
  perform pg_temp.check(pg_temp.st('f1a1', format('[{"op":"update","id":"%s","add_emails":["va-s@test.invalid"]}]', pg_temp.vid('Roto'))),
    'error:email_in_use', 's ya es de Sofi');
  -- Un artista de otro vendor no se toca desde acá.
  perform pg_temp.check(pg_temp.st('f1a4', format('[{"op":"delete","id":"%s"}]', pg_temp.vid('Sofi'))), 'error:vendor_not_found',
    'x no borra a Sofi');

  -- Una persona nueva como artista: invitación de invitado de ese artista.
  perform pg_temp.check(pg_temp.st('f1a1', format('[{"op":"update","id":"%s","add_emails":["va-n@test.invalid"]}]', pg_temp.vid('Roto'))),
    'ok', 'n en Roto');
  perform pg_temp.check(pg_temp.vinv('va-n@test.invalid'), 'Roto', 'n invitado a Roto');

  -- Sacar una escena a un artista le saca el permiso.
  perform pg_temp.check(pg_temp.st('f1a1', format('[{"op":"update","id":"%s","remove_scenes":["%s"]}]', pg_temp.vid('Sofi'), pg_temp.u('f1b1'))),
    'ok', 'Sofi sin S1');
  perform pg_temp.check(pg_temp.grants_of('f1a3'), 'f1b2:comment:Sofi', 's solo S2');
  perform pg_temp.check(pg_temp.st('f1a1', format('[{"op":"update","id":"%s","add_scenes":["%s"]}]', pg_temp.vid('Sofi'), pg_temp.u('f1b1'))),
    'ok', 'Sofi con S1 otra vez');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 5. Lo que ve y hace el proyecto
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  l jsonb;
begin
  perform pg_temp.as_user('f1a0');
  l := public.scene_vendors_list(pg_temp.u('f1e0'));
  perform pg_temp.as_postgres();
  perform pg_temp.check(jsonb_array_length(l -> 'vendors')::text, '2', 'solo los dos vendors, sin los artistas');
  perform pg_temp.check((select string_agg(a ->> 'name', ',' order by a ->> 'name')
                         from jsonb_array_elements(l -> 'vendors') v, jsonb_array_elements(v -> 'artists') a
                         where v ->> 'name' = 'DNEG'), 'Roto,Sofi', 'los artistas debajo de DNEG');
  perform pg_temp.check((select e ->> 'by_team' from jsonb_array_elements(l -> 'vendors') v, jsonb_array_elements(v -> 'emails') e
                         where e ->> 'email' = 'va-c@test.invalid'), 'true', 'c, marcado');

  -- Sobre un artista, el proyecto solo saca correos o lo borra.
  perform pg_temp.check(pg_temp.sv('f1a0', format('[{"op":"update","id":"%s","name":"Otra"}]', pg_temp.vid('Sofi'))),
    'error:ops_invalid', 'la dueña no renombra a Sofi');
  perform pg_temp.check(pg_temp.sv('f1a0', format('[{"op":"update","id":"%s","add_scenes":["%s"]}]', pg_temp.vid('Sofi'), pg_temp.u('f1b3'))),
    'error:ops_invalid', 'ni le suma escenas');
  perform pg_temp.check(pg_temp.sv('f1a0', format('[{"op":"update","id":"%s","remove_emails":["va-s@test.invalid"]}]', pg_temp.vid('Sofi'))),
    'ok', 'la dueña le saca s a Sofi');
  perform pg_temp.check(pg_temp.grants_of('f1a3'), '(ninguno)', 's ya no ve nada');
  perform pg_temp.check(pg_temp.st('f1a1', format('[{"op":"update","id":"%s","add_emails":["va-s@test.invalid"]}]', pg_temp.vid('Sofi'))),
    'ok', 't vuelve a sumar a s');
  -- El proyecto saca a quien sumó el equipo.
  perform pg_temp.check(pg_temp.sv('f1a0', format('[{"op":"update","id":"%s","remove_emails":["va-c@test.invalid"]}]', pg_temp.vid('DNEG'))),
    'ok', 'la dueña saca a c');
  perform pg_temp.check(pg_temp.grants_of('f1a2'), '(ninguno)', 'c afuera');

  -- Bajar DNEG a Ver baja a sus artistas, y el equipo no los puede subir.
  perform pg_temp.check(pg_temp.sv('f1a0', format('[{"op":"update","id":"%s","level":"view"}]', pg_temp.vid('DNEG'))), 'ok', 'DNEG a Ver');
  perform pg_temp.check((select level from public.scene_vendors where id = pg_temp.vid('Sofi')), 'view', 'Sofi a Ver');
  perform pg_temp.check(pg_temp.grants_of('f1a3'), 'f1b1:view:Sofi,f1b2:view:Sofi', 's ve con Ver');
  perform pg_temp.check(pg_temp.st('f1a1', format('[{"op":"update","id":"%s","level":"comment"}]', pg_temp.vid('Sofi'))),
    'error:level_not_allowed', 't no sube a Sofi');
  perform pg_temp.check(pg_temp.st('f1a1', '[{"op":"create","name":"Alto","color":"#2e5a8e","level":"comment"}]'),
    'error:level_not_allowed', 'ni crea uno con Comentar');

  -- Sacarle S1 a DNEG se la saca a Sofi.
  perform pg_temp.check(pg_temp.sv('f1a0', format('[{"op":"update","id":"%s","remove_scenes":["%s"]}]', pg_temp.vid('DNEG'), pg_temp.u('f1b1'))),
    'ok', 'DNEG sin S1');
  perform pg_temp.check(pg_temp.scenes_of('Sofi'), 'f1b2', 'Sofi sin S1');
  perform pg_temp.check(pg_temp.grants_of('f1a3'), 'f1b2:view:Sofi', 's sin S1');
  perform pg_temp.check(pg_temp.grants_of('f1a1'), 'f1b2:view:DNEG,f1b3:view:DNEG', 't sin S1');

  -- Borrar a un artista desde el proyecto.
  perform pg_temp.check(pg_temp.sv('f1a0', format('[{"op":"delete","id":"%s"}]', pg_temp.vid('Roto'))), 'ok', 'la dueña borra Roto');
  perform pg_temp.check(pg_temp.vinv('va-n@test.invalid'), '(ninguna)', 'la invitación de n ya no vale');

  -- Borrar DNEG borra a sus artistas: nadie del vendor ve nada, y el equipo deja de serlo.
  perform pg_temp.check(pg_temp.sv('f1a0', format('[{"op":"delete","id":"%s"}]', pg_temp.vid('DNEG'))), 'ok', 'la dueña borra DNEG');
  perform pg_temp.check(pg_temp.grants_of('f1a3'), '(ninguno)', 's sin nada');
  perform pg_temp.check(pg_temp.grants_of('f1a1'), '(ninguno)', 't sin nada');
  perform pg_temp.check(coalesce(pg_temp.vid('Sofi')::text, 'borrada'), 'borrada', 'Sofi borrada');
  -- Sin nada en PR, t ni ve la fila del proyecto (la columna no llega).
  perform pg_temp.check(pg_temp.vteam('f1a1'), '<null>', 't ya no es del equipo');
  perform pg_temp.check(pg_temp.run_as('f1a1', format('select private.vendor_team_of(%L)::text', pg_temp.u('f1e0'))),
    'error:permission denied for function vendor_team_of', 'ni llama a la pieza de adentro');
  perform pg_temp.check(pg_temp.st('f1a1', '[{"op":"team","add_emails":["va-n@test.invalid"]}]'), 'error:not_allowed', 't no guarda');
  -- Y su correo puede ir a otro lado.
  perform pg_temp.check(pg_temp.sv('f1a0', format('[{"op":"update","id":"%s","add_emails":["va-s@test.invalid"]}]', pg_temp.vid('Otro'))),
    'ok', 's pasa a Otro');
  perform pg_temp.check(pg_temp.grants_of('f1a3'), 'f1b4:comment:Otro', 's ve S4');
end;
$$;

rollback;
select 'ok' as result;
