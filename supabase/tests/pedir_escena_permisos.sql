-- Pruebas de pedir una escena desde su link (20261119120000_pedir_escena.sql, Docs/Doc_Compartir_Escenas.md, B-2):
-- pedir (`request_scene_access`) responde siempre `sent`, exista o no el proyecto o la escena, guarda el id o el texto
-- normalizado, no repite filas (persona, proyecto o texto, escena) y el tope cuenta todas las llamadas (la 21 da
-- `rate_limited` exista o no lo pedido); la lista (`scene_access_requests_pending`) es solo de dueño o admin, resuelve el
-- texto al leer (el nombre entero gana a la primera palabra) y muestra solo los proyectos que quien mira puede compartir,
-- sin los de quien ya ve el proyecto entero, ni de alguien sacado, ni los propios, ni de más de 30 días; decidir
-- (`decide_scene_access_request`) pide dueño o admin que puede compartir un proyecto de los del pedido, y dar acceso pasa
-- por `set_page_shares` (interruptor de lo borrado, escena marcada y viva del proyecto, nada adentro, nivel Ver o
-- Comentar, nunca baja). Corre dentro de una transacción que se deshace al final: no deja usuarios ni datos. Si todo pasa,
-- devuelve una fila con result = 'ok'.

begin;

-- El interruptor empieza apagado (la prueba lo prende en la sección 5).
update public.workspace_settings set clean_min_version = null where id;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-00000000' || s)::uuid;
$$;

-- Una sesión: `otp` (la de la app) o `password` (la que no ve nada, `session_allowed`).
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

-- Pedir como `who`: el proyecto por sufijo (o un uuid entero, o nulo) o por texto, y la escena.
create function pg_temp.ask(who text, proj text, ptext text, scene text, method text default 'otp') returns text language sql as $$
  select pg_temp.run_as(who, format('select public.request_scene_access(%L::uuid, %L, %L)',
                                    case when proj is null then null when length(proj) = 4 then pg_temp.u(proj)::text else proj end,
                                    ptext, scene), method);
$$;

-- La lista de `who`: «persona:proyecto:escena» ordenada (el proyecto por su sufijo), con «~texto» si el pedido vino por
-- el nombre (y «~texto*» si salió por la primera palabra), separados por « ; », o '(vacía)'.
create function pg_temp.list(who text, method text default 'otp') returns text language sql as $$
  select pg_temp.run_as(who, $q$
    select coalesce(string_agg(x, ' ; ' order by x collate "C"), '(vacía)')
    from (select split_part(email, '@', 1) || ':' || right(project_id::text, 4) || ':' || scene_text
                 || coalesce('~' || project_text || case when exact then '' else '*' end, '') as x
          from public.scene_access_requests_pending()) l$q$, method);
$$;

-- Que una lista no traiga `needle`, y que sea una lista (un 'error:…' no pasa por vacía).
create function pg_temp.lacks(got text, needle text, what text) returns void language plpgsql as $$
begin
  if got like 'error:%' or position(needle in got) > 0 then
    raise exception 'FALLA: % (dio %)', what, got;
  end if;
end;
$$;

-- El pedido (el más nuevo en `st`) de `who` por esa escena.
create function pg_temp.rid(who text, scene text, st text default 'pending') returns uuid language sql as $$
  select id from public.scene_access_requests where user_id = pg_temp.u(who) and scene_text = scene and state = st
  order by created_at desc limit 1;
$$;

create function pg_temp.dec(who text, req uuid, accept boolean, proj text, page text, lvl text default 'view',
                            method text default 'otp') returns text language sql as $$
  select pg_temp.run_as(who, format('select public.decide_scene_access_request(%L, %L, %L, %L, %L)', req, accept,
                                    case when proj is null then null else pg_temp.u(proj) end,
                                    case when page is null then null else pg_temp.u(page) end, lvl), method);
$$;

create function pg_temp.state_of(req uuid) returns text language sql as $$
  select coalesce((select state from public.scene_access_requests where id = req), '(ninguno)');
$$;

create function pg_temp.grant_of(who text, page text) returns text language sql as $$
  select coalesce((select level from public.grants where user_id = pg_temp.u(who) and page_id = pg_temp.u(page)
                   and revoked_at is null), '(ninguno)');
$$;

-- ---------------------------------------------------------------------------------------------------
-- Datos
-- ---------------------------------------------------------------------------------------------------
-- Personas: o (dueña del workspace, creó PR, EX, M2 y M3), a (admin con Editar y crear páginas sobre PR), n (admin sin
-- nada), c (miembro común que creó Q), g (invitado: el vendor, Comentar sobre S1), h (otro invitado, sin nada), m
-- (miembro sin nada: el tope), w (miembro con Ver sobre todo PR), x (cuenta sin membresía), k (miembro que entra con
-- contraseña), y (miembro que después sacan).
update public.members set removed_at = now() where role = 'owner' and removed_at is null;
insert into auth.users (id, email, aud, role) values
  (pg_temp.u('e6a0'), 'pe-o@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e6a1'), 'pe-a@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e6a2'), 'pe-n@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e6a3'), 'pe-c@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e6a4'), 'pe-g@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e6a5'), 'pe-h@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e6a6'), 'pe-m@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e6a7'), 'pe-w@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e6a8'), 'pe-x@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e6a9'), 'pe-k@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e6aa'), 'pe-y@test.invalid', 'authenticated', 'authenticated');
insert into public.members (user_id, role) values
  (pg_temp.u('e6a0'), 'owner'), (pg_temp.u('e6a1'), 'admin'), (pg_temp.u('e6a2'), 'admin'), (pg_temp.u('e6a3'), 'member'),
  (pg_temp.u('e6a4'), 'guest'), (pg_temp.u('e6a5'), 'guest'), (pg_temp.u('e6a6'), 'member'), (pg_temp.u('e6a7'), 'member'),
  (pg_temp.u('e6a9'), 'member'), (pg_temp.u('e6aa'), 'member');
-- Proyectos: PR «ERSO | Serie», EX «Érso» (se llama «erso» entero), M2 «MOR 2» y M3 «MOR 3» (empiezan con «mor»), Q
-- «Quinta» (de c), DEL «Borrado» (borrado).
insert into public.workspaces (id, owner_id, name) values
  (pg_temp.u('e6e0'), pg_temp.u('e6a0'), 'ERSO | Serie'),
  (pg_temp.u('e6e1'), pg_temp.u('e6a0'), 'Érso'),
  (pg_temp.u('e6e2'), pg_temp.u('e6a0'), 'MOR 2'),
  (pg_temp.u('e6e3'), pg_temp.u('e6a0'), 'MOR 3'),
  (pg_temp.u('e6e4'), pg_temp.u('e6a3'), 'Quinta'),
  (pg_temp.u('e6e5'), pg_temp.u('e6a0'), 'Borrado');
-- PR: DES (carpeta de escenas) › S1 (› F1, su ficha), S2, S3 (sin marca), S4 (escena › L4, una locación), T (escena, en
-- la papelera). EX: XS (escena). M2: MS2. M3: MS3. Q: QS. DEL: DS.
insert into public.pages (id, workspace_id, parent_id, title, sort_key, settings) values
  (pg_temp.u('e6b0'), pg_temp.u('e6e0'), null, 'DES', 'a0', '{"holds": "scene"}'),
  (pg_temp.u('e6b1'), pg_temp.u('e6e0'), pg_temp.u('e6b0'), 'S1', 'a0', '{"entity": {"kind": "scene", "code": "101_013"}}'),
  (pg_temp.u('e6b2'), pg_temp.u('e6e0'), pg_temp.u('e6b1'), 'F1', 'a0', '{}'),
  (pg_temp.u('e6b3'), pg_temp.u('e6e0'), pg_temp.u('e6b0'), 'S2', 'a1', '{"entity": {"kind": "scene", "code": "101_066"}}'),
  (pg_temp.u('e6b4'), pg_temp.u('e6e0'), pg_temp.u('e6b0'), 'S3', 'a2', '{}'),
  (pg_temp.u('e6b5'), pg_temp.u('e6e0'), pg_temp.u('e6b0'), 'S4', 'a3', '{"entity": {"kind": "scene", "code": "101_070"}}'),
  (pg_temp.u('e6b6'), pg_temp.u('e6e0'), pg_temp.u('e6b5'), 'L4', 'a0', '{"entity": {"kind": "location"}}'),
  (pg_temp.u('e6b7'), pg_temp.u('e6e0'), pg_temp.u('e6b0'), 'T', 'a4', '{"entity": {"kind": "scene", "code": "101_080"}}'),
  (pg_temp.u('e6b8'), pg_temp.u('e6e1'), null, 'XS', 'a0', '{"entity": {"kind": "scene", "code": "001"}}'),
  (pg_temp.u('e6b9'), pg_temp.u('e6e2'), null, 'MS2', 'a0', '{"entity": {"kind": "scene", "code": "001"}}'),
  (pg_temp.u('e6ba'), pg_temp.u('e6e3'), null, 'MS3', 'a0', '{"entity": {"kind": "scene", "code": "001"}}'),
  (pg_temp.u('e6bb'), pg_temp.u('e6e4'), null, 'QS', 'a0', '{"entity": {"kind": "scene", "code": "001"}}'),
  (pg_temp.u('e6bc'), pg_temp.u('e6e5'), null, 'DS', 'a0', '{"entity": {"kind": "scene", "code": "001"}}');
insert into public.grants (user_id, project_id, page_id, level) values
  (pg_temp.u('e6a1'), pg_temp.u('e6e0'), null, 'edit_pages'),
  (pg_temp.u('e6a7'), pg_temp.u('e6e0'), null, 'view'),
  (pg_temp.u('e6a4'), null, pg_temp.u('e6b1'), 'comment');
update public.pages set deleted_at = now() where id = pg_temp.u('e6b7');
update public.workspaces set deleted_at = now() where id = pg_temp.u('e6e5');

-- ---------------------------------------------------------------------------------------------------
-- 1. Las tablas y las puertas
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  assert (select relrowsecurity from pg_class where oid = 'public.scene_access_requests'::regclass), 'pedidos sin RLS';
  assert (select relrowsecurity from pg_class where oid = 'public.scene_access_calls'::regclass), 'tope sin RLS';
  assert (select count(*) from pg_policies where schemaname = 'public'
          and tablename in ('scene_access_requests', 'scene_access_calls')) = 0, 'una tabla tiene políticas';
  assert not has_table_privilege('authenticated', 'public.scene_access_requests', 'select'), 'authenticated lee los pedidos';
  assert not has_table_privilege('authenticated', 'public.scene_access_requests', 'insert'), 'authenticated inserta pedidos';
  assert not has_table_privilege('authenticated', 'public.scene_access_calls', 'select'), 'authenticated lee el tope';
  assert not has_table_privilege('authenticated', 'public.scene_access_calls', 'update'), 'authenticated toca el tope';
  assert not has_table_privilege('anon', 'public.scene_access_requests', 'select'), 'anon lee los pedidos';
  assert not has_function_privilege('anon', 'public.request_scene_access(uuid, text, text)', 'execute'), 'anon pide';
  assert not has_function_privilege('anon', 'public.scene_access_requests_pending()', 'execute'), 'anon lista';
  assert not has_function_privilege('anon', 'public.decide_scene_access_request(uuid, boolean, uuid, uuid, text)', 'execute'),
    'anon decide';
  assert not has_function_privilege('public', 'public.request_scene_access(uuid, text, text)', 'execute'), 'public pide';
  assert has_function_privilege('authenticated', 'public.request_scene_access(uuid, text, text)', 'execute'), 'authenticated no pide';
  assert has_function_privilege('authenticated', 'public.scene_access_requests_pending()', 'execute'), 'authenticated no lista';
  assert has_function_privilege('authenticated', 'public.decide_scene_access_request(uuid, boolean, uuid, uuid, text)', 'execute'),
    'authenticated no decide';
  assert not has_function_privilege('authenticated', 'private.scene_request_projects(uuid, text)', 'execute'),
    'authenticated resuelve proyectos por texto';
  assert not has_function_privilege('authenticated', 'private.project_text_key(text)', 'execute'), 'authenticated normaliza';
  assert not has_function_privilege('authenticated', 'private.project_text_code(text)', 'execute'), 'authenticated corta';
  assert (select count(*) = 4 and bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where (n.nspname, p.proname) in (('public', 'request_scene_access'), ('public', 'scene_access_requests_pending'),
                                           ('public', 'decide_scene_access_request'), ('private', 'scene_request_projects'))),
    'una función sin SECURITY DEFINER o sin search_path vacío';
  -- La normalización, como `projectKey` y `projectCode` de la app.
  perform pg_temp.check(private.project_text_key('  ÉRSO   |  Serie '), 'erso | serie', 'el texto comparable');
  perform pg_temp.check(private.project_text_key('Ñandú Ç'), 'nandu c', 'eñe y cedilla');
  perform pg_temp.check(private.project_text_code('erso | serie'), 'erso', 'la primera palabra');
  perform pg_temp.check(private.project_text_code('mor_2'), 'mor', 'la primera palabra, con guion bajo');
  perform pg_temp.check(private.project_text_code('| a'), 'a', 'la primera palabra no vacía');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 2. Pedir: siempre `sent`, exista o no; quién puede; lo mal formado
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  -- Sin membresía, con contraseña o sacado: `not_member` (dice algo de quien pide, nada de lo pedido).
  perform pg_temp.check(pg_temp.ask('e6a8', 'e6e0', null, '1013'), 'error:not_member', 'sin membresía');
  perform pg_temp.check(pg_temp.ask('e6a9', 'e6e0', null, '1013', 'password'), 'error:not_member', 'con contraseña');
  -- La misma respuesta: un proyecto que existe, uno que no, un texto que nombra uno, uno que no, uno borrado, una escena
  -- que no existe. El invitado g pide aunque ya vea S1.
  perform pg_temp.check(pg_temp.ask('e6a4', 'e6e0', null, '1066'), 'sent', 'por id, existe');
  perform pg_temp.check(pg_temp.ask('e6a4', '00000000-0000-4000-8000-0000000000ff', null, '1066'), 'sent', 'por id, no existe');
  perform pg_temp.check(pg_temp.ask('e6a4', 'e6e5', null, '1066'), 'sent', 'por id, borrado');
  perform pg_temp.check(pg_temp.ask('e6a4', null, '  ÉRSO  ', '1066'), 'sent', 'por texto, existe');
  perform pg_temp.check(pg_temp.ask('e6a4', null, 'Nada que exista', '1066'), 'sent', 'por texto, no existe');
  perform pg_temp.check(pg_temp.ask('e6a4', 'e6e0', null, '9999'), 'sent', 'una escena que no existe');
  perform pg_temp.check(pg_temp.ask('e6a4', null, 'ERSO | Serie', 'ERSO_1066_010'), 'sent', 'por el nombre entero');
  perform pg_temp.check(pg_temp.ask('e6a4', null, 'mor', '001'), 'sent', 'una palabra que nombra dos');
  perform pg_temp.check(pg_temp.ask('e6a5', 'e6e4', null, '001'), 'sent', 'h pide Q');
  perform pg_temp.check(pg_temp.ask('e6a7', 'e6e0', null, '1066'), 'sent', 'w, que ve todo PR, pide igual');
  perform pg_temp.check(pg_temp.ask('e6aa', 'e6e0', null, '1013'), 'sent', 'y pide');
  perform pg_temp.check(pg_temp.ask('e6a0', 'e6e0', null, '1013'), 'sent', 'la dueña pide (lo propio, y lo que ya ve entero, no se lista)');
  -- Lo guardado: el id tal cual, el texto normalizado, la escena sin espacios de más.
  assert (select count(*) from public.scene_access_requests where user_id = pg_temp.u('e6a4')) = 8, 'g dejó 8 filas';
  assert exists (select 1 from public.scene_access_requests where user_id = pg_temp.u('e6a4') and project_text = 'erso'
                 and project_id is null and scene_text = '1066'), 'el texto se guarda normalizado';
  assert exists (select 1 from public.scene_access_requests where user_id = pg_temp.u('e6a4')
                 and project_id = '00000000-0000-4000-8000-0000000000ff'), 'un id que no existe también deja su fila';

  -- Lo mal formado: `target_invalid`, sin fila.
  perform pg_temp.check(pg_temp.ask('e6a5', null, null, '1013'), 'error:target_invalid', 'sin proyecto');
  perform pg_temp.check(pg_temp.ask('e6a5', 'e6e0', 'ERSO', '1013'), 'error:target_invalid', 'id y texto');
  perform pg_temp.check(pg_temp.ask('e6a5', null, '   ', '1013'), 'error:target_invalid', 'texto vacío');
  perform pg_temp.check(pg_temp.ask('e6a5', null, repeat('a', 201), '1013'), 'error:target_invalid', 'texto largo');
  perform pg_temp.check(pg_temp.ask('e6a5', 'e6e0', null, '  '), 'error:target_invalid', 'escena vacía');
  perform pg_temp.check(pg_temp.ask('e6a5', 'e6e0', null, null), 'error:target_invalid', 'sin escena');
  perform pg_temp.check(pg_temp.ask('e6a5', 'e6e0', null, repeat('1', 81)), 'error:target_invalid', 'escena larga');
  assert (select count(*) from public.scene_access_requests where user_id = pg_temp.u('e6a5')) = 1, 'h: solo el de Q';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 3. Repetidos y el tope: todas las llamadas cuentan
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  i int;
begin
  -- Repetido (mismo id o mismo texto normalizado, misma escena sin mayúsculas): la misma fila, sin otra.
  perform pg_temp.check(pg_temp.ask('e6a4', null, 'erso', '1066'), 'sent', 'repetido por texto');
  perform pg_temp.check(pg_temp.ask('e6a4', null, 'Erso', ' 1066 '), 'sent', 'repetido, otra forma');
  perform pg_temp.check(pg_temp.ask('e6a4', null, 'erso | serie', 'erso_1066_010'), 'sent', 'repetido, la escena en minúsculas');
  assert (select count(*) from public.scene_access_requests where user_id = pg_temp.u('e6a4')) = 8, 'un repetido dejó otra fila';
  -- Renovar: como mucho una vez por hora.
  update public.scene_access_requests set asked_at = now() - interval '2 hours'
  where user_id = pg_temp.u('e6a4') and project_text = 'erso';
  perform pg_temp.ask('e6a4', null, 'erso', '1066');
  assert (select times from public.scene_access_requests where user_id = pg_temp.u('e6a4') and project_text = 'erso') = 2,
    'renovar después de una hora';

  -- El tope cuenta todas las llamadas: m pide 20 veces lo mismo y la 21 da `rate_limited`, exista o no lo pedido.
  for i in 1..20 loop
    perform pg_temp.check(pg_temp.ask('e6a6', 'e6e0', null, '1013'), 'sent', 'm, llamada ' || i);
  end loop;
  assert (select count(*) from public.scene_access_requests where user_id = pg_temp.u('e6a6')) = 1, 'm: una sola fila';
  perform pg_temp.check(pg_temp.ask('e6a6', 'e6e0', null, '1013'), 'error:rate_limited', 'la 21, lo mismo');
  perform pg_temp.check(pg_temp.ask('e6a6', '00000000-0000-4000-8000-0000000000fe', null, '1'), 'error:rate_limited',
    'la 21, un id que no existe');
  perform pg_temp.check(pg_temp.ask('e6a6', null, 'Quinta', '001'), 'error:rate_limited', 'la 21, un texto que existe');
  perform pg_temp.check(pg_temp.ask('e6a6', null, 'zzz', '001'), 'error:rate_limited', 'la 21, un texto que no existe');
  assert (select calls from public.scene_access_calls where user_id = pg_temp.u('e6a6')) = 20, 'el rechazo no cuenta de más';
  assert (select count(*) from public.scene_access_requests where user_id = pg_temp.u('e6a6')) = 1, 'm: el tope dejó filas';
  -- El tope es por persona: h sigue pidiendo.
  perform pg_temp.check(pg_temp.ask('e6a5', 'e6e0', null, '1066'), 'sent', 'h no está topado por m');
  -- Pasadas las 24 horas, la ventana vuelve a empezar.
  update public.scene_access_calls set window_start = now() - interval '25 hours' where user_id = pg_temp.u('e6a6');
  perform pg_temp.check(pg_temp.ask('e6a6', 'e6e0', null, '1066'), 'sent', 'm, otra ventana');
  assert (select calls from public.scene_access_calls where user_id = pg_temp.u('e6a6')) = 1, 'la ventana nueva cuenta desde 1';

  -- Sin tope de abiertos al pedir: nada de lo que decida quien decide cambia la respuesta. k tiene 20 abiertos (un id
  -- que no existe): uno nuevo da `sent`, uno repetido pendiente da `sent`, y uno repetido que fue rechazado (fuera del
  -- día) también da `sent`, igual que si siguiera pendiente.
  insert into public.scene_access_requests (user_id, project_id, scene_text, state)
  select pg_temp.u('e6a9'), '00000000-0000-4000-8000-0000000000fd', 'k' || g.n, case when g.n <= 18 then 'pending' else 'void' end
  from generate_series(1, 20) as g(n);
  insert into public.scene_access_requests (user_id, project_id, scene_text, state, decided_at) values
    (pg_temp.u('e6a9'), '00000000-0000-4000-8000-0000000000fd', 'k-rechazado', 'declined', now() - interval '2 days');
  perform pg_temp.check(pg_temp.ask('e6a9', 'e6e0', null, '1013'), 'sent', 'k, uno nuevo con 20 abiertos');
  perform pg_temp.check(pg_temp.ask('e6a9', '00000000-0000-4000-8000-0000000000fd', null, 'k3'), 'sent', 'k, uno repetido pendiente');
  perform pg_temp.check(pg_temp.ask('e6a9', '00000000-0000-4000-8000-0000000000fd', null, 'k-rechazado'), 'sent',
    'k, uno repetido rechazado');
  -- Y al pedir se borran las filas propias creadas hace más de 30 días, en cualquier estado (pendiente, aceptada,
  -- rechazada); las propias más nuevas (aunque se decidieran hace mucho) y las de otros, no.
  insert into public.scene_access_requests (user_id, project_id, scene_text, state, created_at, asked_at, decided_at) values
    (pg_temp.u('e6a9'), '00000000-0000-4000-8000-0000000000fd', 'k-viejo-p', 'pending', now() - interval '40 days', now() - interval '1 day', null),
    (pg_temp.u('e6a9'), '00000000-0000-4000-8000-0000000000fd', 'k-viejo-a', 'accepted', now() - interval '40 days', now() - interval '40 days', now() - interval '1 day'),
    (pg_temp.u('e6a9'), '00000000-0000-4000-8000-0000000000fd', 'k-viejo-d', 'declined', now() - interval '31 days', now() - interval '31 days', now() - interval '31 days'),
    (pg_temp.u('e6a9'), '00000000-0000-4000-8000-0000000000fd', 'k-reciente', 'declined', now() - interval '29 days', now() - interval '29 days', now() - interval '29 days'),
    (pg_temp.u('e6a5'), '00000000-0000-4000-8000-0000000000fd', 'h-viejo', 'declined', now() - interval '40 days', now() - interval '40 days', now() - interval '35 days');
  perform pg_temp.check(pg_temp.ask('e6a9', 'e6e0', null, '1066'), 'sent', 'k pide y limpia');
  assert not exists (select 1 from public.scene_access_requests where scene_text in ('k-viejo-p', 'k-viejo-a', 'k-viejo-d')),
    'no se borró lo viejo de k';
  assert (select count(*) from public.scene_access_requests where scene_text in ('k1', 'k-reciente', 'h-viejo')) = 3,
    'se borró lo que no tocaba';
  -- k deja de molestar en las listas de abajo.
  delete from public.scene_access_requests where user_id = pg_temp.u('e6a9');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 4. La lista: dueño o admin, los proyectos que puede compartir, el texto resuelto al leer
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  -- La dueña (comparte PR, EX, M2 y M3): el id de PR; «erso» → EX (se llama así entero, gana a la primera palabra de PR);
  -- «erso | serie» → PR; «mor» → M2 y M3 (una fila por proyecto). Nada del id que no existe, del borrado, de «nada…»,
  -- de Q (no lo puede compartir), de w (ve todo PR), ni lo propio.
  perform pg_temp.check(pg_temp.list('e6a0'),
    'pe-g:e6e0:1066 ; pe-g:e6e0:9999 ; pe-g:e6e0:ERSO_1066_010~erso | serie ; pe-g:e6e1:1066~erso ; pe-g:e6e2:001~mor* ; '
    || 'pe-g:e6e3:001~mor* ; pe-h:e6e0:1066 ; pe-m:e6e0:1013 ; pe-m:e6e0:1066 ; pe-y:e6e0:1013',
    'la lista de la dueña');
  -- a (admin con 4 sobre PR): solo lo de PR (el de la dueña no: ella ve PR entero, como w). «erso» resuelve solo entre
  -- los proyectos de a: EX existe y se llama «erso» entero, pero a no lo comparte, así que para a «erso» es PR por la
  -- primera palabra (si EX ganara antes del filtro, a no vería la fila y sabría que existe otro «erso»).
  perform pg_temp.check(pg_temp.list('e6a1'),
    'pe-g:e6e0:1066 ; pe-g:e6e0:1066~erso* ; pe-g:e6e0:9999 ; pe-g:e6e0:ERSO_1066_010~erso | serie ; pe-h:e6e0:1066 ; '
    || 'pe-m:e6e0:1013 ; pe-m:e6e0:1066 ; pe-y:e6e0:1013',
    'la lista de a');
  perform pg_temp.check(pg_temp.val($q$select count(*)::text from public.workspaces where id = '00000000-0000-4000-8000-00000000e6e1'
    and deleted_at is null$q$), '1', 'EX sigue vivo');
  -- n (admin sin permiso sobre ningún proyecto, B3): nada; ni el nombre ni que existen.
  perform pg_temp.check(pg_temp.list('e6a2'), '(vacía)', 'admin sin el proyecto');
  -- c creó Q y lo puede compartir, pero no es dueño ni admin: nada (decidir es de *Share scenes*: dueño y admins).
  perform pg_temp.check(pg_temp.list('e6a3'), '(vacía)', 'miembro que creó Q');
  -- Un invitado, una sesión con contraseña, alguien sin membresía: nada.
  perform pg_temp.check(pg_temp.list('e6a4'), '(vacía)', 'invitado');
  perform pg_temp.check(pg_temp.list('e6a0', 'password'), '(vacía)', 'con contraseña');
  perform pg_temp.check(pg_temp.list('e6a8'), '(vacía)', 'sin membresía');

  -- Sacado del workspace: su pedido no se lista.
  update public.members set removed_at = now() where user_id = pg_temp.u('e6aa');
  perform pg_temp.check(pg_temp.val($q$select count(*)::text from public.scene_access_requests r
    where r.user_id = '00000000-0000-4000-8000-00000000e6aa' and r.state = 'pending'$q$), '1', 'la fila de y sigue');
  perform pg_temp.lacks(pg_temp.list('e6a0'), 'pe-y', 'y sacado no se lista');
  -- De más de 30 días: no se lista.
  update public.scene_access_requests set asked_at = now() - interval '31 days'
  where user_id = pg_temp.u('e6a4') and scene_text = '9999';
  perform pg_temp.lacks(pg_temp.list('e6a0'), ':9999', 'de más de 30 días');

  -- De cada persona, solo sus 20 pendientes más nuevos (el tope de abiertos vive en la lista, no al pedir): k tiene 22
  -- pendientes de PR; a ve los 20 más nuevos (k01…k20), no k21 ni k22. Lo `void` y lo rechazado de k no ocupan lugar.
  insert into public.scene_access_requests (user_id, project_id, scene_text, state, asked_at)
  select pg_temp.u('e6a9'), pg_temp.u('e6e0'), 'k' || lpad(g.n::text, 2, '0'), 'pending', now() - g.n * interval '1 minute'
  from generate_series(1, 22) as g(n);
  insert into public.scene_access_requests (user_id, project_id, scene_text, state, asked_at, decided_at) values
    (pg_temp.u('e6a9'), pg_temp.u('e6e0'), 'kv', 'void', now(), null),
    (pg_temp.u('e6a9'), pg_temp.u('e6e0'), 'kd', 'declined', now(), now());
  perform pg_temp.check(pg_temp.run_as('e6a1', $q$
    select string_agg(scene_text, ',' order by scene_text) from public.scene_access_requests_pending()
    where email = 'pe-k@test.invalid'$q$), 'k01,k02,k03,k04,k05,k06,k07,k08,k09,k10,k11,k12,k13,k14,k15,k16,k17,k18,k19,k20',
    'k: sus 20 pendientes más nuevos');
  -- El tope es por persona: los de los demás siguen en la lista de a (los 8 de arriba sin y, sacado, ni 9999, viejo).
  perform pg_temp.check(pg_temp.run_as('e6a1', $q$
    select count(*)::text from public.scene_access_requests_pending() where email <> 'pe-k@test.invalid'$q$), '6',
    'los demás, con k topado');
  delete from public.scene_access_requests where user_id = pg_temp.u('e6a9');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 5. Decidir: quién, sobre qué, y dar acceso con las reglas de *Share scenes*
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  r_pr  uuid := (select id from public.scene_access_requests where user_id = pg_temp.u('e6a4') and project_id = pg_temp.u('e6e0')
                 and scene_text = '1066');
  r_ex  uuid := (select id from public.scene_access_requests where user_id = pg_temp.u('e6a4') and project_text = 'erso');
  r_mor uuid := (select id from public.scene_access_requests where user_id = pg_temp.u('e6a4') and project_text = 'mor');
  r_q   uuid := (select id from public.scene_access_requests where user_id = pg_temp.u('e6a5') and project_id = pg_temp.u('e6e4'));
  r_old uuid := (select id from public.scene_access_requests where user_id = pg_temp.u('e6a4') and scene_text = '9999');
  r_y   uuid := (select id from public.scene_access_requests where user_id = pg_temp.u('e6aa'));
begin
  -- Sin el interruptor de lo borrado: `clean_off` (de `set_page_shares`), nada escrito, el pedido sigue.
  perform pg_temp.check(pg_temp.dec('e6a0', r_pr, true, 'e6e0', 'e6b3'), 'error:clean_off', 'sin interruptor');
  perform pg_temp.check(pg_temp.state_of(r_pr), 'pending', 'sin interruptor, sigue pendiente');
  perform pg_temp.check(pg_temp.grant_of('e6a4', 'e6b3'), '(ninguno)', 'sin interruptor, sin permiso');
end;
$$;

update public.workspace_settings set min_app_version = coalesce(min_app_version, 0.001) where id;
update public.workspace_settings set clean_min_version = min_app_version where id;

do $$
declare
  r_pr  uuid := (select id from public.scene_access_requests where user_id = pg_temp.u('e6a4') and project_id = pg_temp.u('e6e0')
                 and scene_text = '1066');
  r_ex  uuid := (select id from public.scene_access_requests where user_id = pg_temp.u('e6a4') and project_text = 'erso');
  r_mor uuid := (select id from public.scene_access_requests where user_id = pg_temp.u('e6a4') and project_text = 'mor');
  r_q   uuid := (select id from public.scene_access_requests where user_id = pg_temp.u('e6a5') and project_id = pg_temp.u('e6e4'));
  r_old uuid := (select id from public.scene_access_requests where user_id = pg_temp.u('e6a4') and scene_text = '9999');
  r_y   uuid := (select id from public.scene_access_requests where user_id = pg_temp.u('e6aa'));
  r_h   uuid := (select id from public.scene_access_requests where user_id = pg_temp.u('e6a5') and project_id = pg_temp.u('e6e0'));
  r_w   uuid := (select id from public.scene_access_requests where user_id = pg_temp.u('e6a7'));
begin
  -- Quién no puede: el mismo `request_not_found` para todo, sin tocar el pedido.
  perform pg_temp.check(pg_temp.dec('e6a2', r_pr, true, 'e6e0', 'e6b3'), 'error:request_not_found', 'admin sin PR');
  perform pg_temp.check(pg_temp.dec('e6a2', r_pr, false, 'e6e0', null), 'error:request_not_found', 'admin sin PR, rechazar');
  perform pg_temp.check(pg_temp.dec('e6a3', r_q, false, 'e6e4', null), 'error:request_not_found', 'miembro que creó Q, rechazar');
  perform pg_temp.check(pg_temp.dec('e6a3', r_q, true, 'e6e4', 'e6bb'), 'error:request_not_found', 'miembro que creó Q, dar');
  perform pg_temp.check(pg_temp.dec('e6a4', r_h, true, 'e6e0', 'e6b3'), 'error:request_not_found', 'un invitado');
  perform pg_temp.check(pg_temp.dec('e6a0', r_pr, true, 'e6e0', 'e6b3', 'view', 'password'), 'error:request_not_found',
    'con contraseña');
  perform pg_temp.check(pg_temp.dec('e6a0', null, true, 'e6e0', 'e6b3'), 'error:request_not_found', 'sin pedido');
  perform pg_temp.check(pg_temp.dec('e6a0', r_old, true, 'e6e0', 'e6b3'), 'error:request_not_found', 'de más de 30 días');
  -- Un proyecto que no es del pedido (aunque lo pueda compartir), o ninguno: no.
  perform pg_temp.check(pg_temp.dec('e6a0', r_pr, true, 'e6e1', 'e6b8'), 'error:request_not_found', 'otro proyecto (EX)');
  perform pg_temp.check(pg_temp.dec('e6a0', r_ex, true, 'e6e0', 'e6b3'), 'error:request_not_found',
    '«erso» es EX, no PR (el nombre entero gana)');
  perform pg_temp.check(pg_temp.dec('e6a0', r_pr, true, null, 'e6b3'), 'error:request_not_found', 'sin proyecto');
  perform pg_temp.check(pg_temp.dec('e6a1', r_ex, false, 'e6e1', null), 'error:request_not_found', 'a no comparte EX');
  -- Lo propio no se decide (la dueña pidió S1 de PR).
  perform pg_temp.check(pg_temp.dec('e6a0', pg_temp.rid('e6a0', '1013'), false, 'e6e0', null), 'error:request_not_found',
    'decidir uno propio');
  perform pg_temp.check(pg_temp.state_of(pg_temp.rid('e6a0', '1013')), 'pending', 'lo propio sigue pendiente');
  perform pg_temp.check(pg_temp.state_of(r_pr), 'pending', 'nada lo decidió');
  perform pg_temp.check(pg_temp.state_of(r_q), 'pending', 'Q sigue pendiente');

  -- Lo que se pide al dar: decisión, nivel, página. Las reglas de la página son las de `set_page_shares`.
  perform pg_temp.check(pg_temp.dec('e6a0', r_pr, null, 'e6e0', 'e6b3'), 'error:decision_invalid', 'sin decisión');
  perform pg_temp.check(pg_temp.dec('e6a0', r_pr, true, 'e6e0', 'e6b3', 'edit'), 'error:level_invalid', 'Editar no');
  perform pg_temp.check(pg_temp.dec('e6a0', r_pr, true, 'e6e0', 'e6b3', 'edit_pages'), 'error:level_invalid', 'Editar y crear no');
  perform pg_temp.check(pg_temp.dec('e6a0', r_pr, true, 'e6e0', null), 'error:page_invalid', 'sin página');
  perform pg_temp.check(pg_temp.dec('e6a0', r_pr, true, 'e6e0', 'e6b4'), 'error:page_invalid', 'una página sin marca');
  perform pg_temp.check(pg_temp.dec('e6a0', r_pr, true, 'e6e0', 'e6b0'), 'error:page_invalid', 'la carpeta de escenas');
  perform pg_temp.check(pg_temp.dec('e6a0', r_pr, true, 'e6e0', 'e6b2'), 'error:page_invalid', 'la ficha');
  perform pg_temp.check(pg_temp.dec('e6a0', r_pr, true, 'e6e0', 'e6b7'), 'error:page_invalid', 'una escena en la papelera');
  perform pg_temp.check(pg_temp.dec('e6a0', r_pr, true, 'e6e0', 'e6b8'), 'error:page_invalid', 'una escena de otro proyecto');
  perform pg_temp.check(pg_temp.dec('e6a0', r_pr, true, 'e6e0', 'e6b5'), 'error:scene_contains_entities',
    'una escena con una locación adentro');
  perform pg_temp.check(pg_temp.state_of(r_pr), 'pending', 'los rechazos de la página no lo decidieron');
  assert not exists (select 1 from public.grants where user_id = pg_temp.u('e6a4') and page_id <> pg_temp.u('e6b1')),
    'quedó un permiso de un intento fallido';

  -- Dar: a (admin que comparte PR) le da S2 con Ver. Sale de la lista, de las dos.
  perform pg_temp.check(pg_temp.dec('e6a1', r_pr, true, 'e6e0', 'e6b3'), 'accepted', 'a le da S2 a g');
  perform pg_temp.check(pg_temp.grant_of('e6a4', 'e6b3'), 'view', 'g tiene Ver sobre S2');
  perform pg_temp.check(pg_temp.state_of(r_pr), 'accepted', 'aceptado');
  assert (select decided_project = pg_temp.u('e6e0') and page_id = pg_temp.u('e6b3') and level = 'view'
          and decided_by = pg_temp.u('e6a1') from public.scene_access_requests where id = r_pr), 'lo anotado al aceptar';
  perform pg_temp.check(pg_temp.dec('e6a0', r_pr, true, 'e6e0', 'e6b3'), 'error:request_not_found', 'ya decidido');
  perform pg_temp.lacks(pg_temp.list('e6a0') || ' ; ', 'pe-g:e6e0:1066 ; ', 'decidido, fuera de la lista');
  -- g ve S2 y su ficha no: S2 no tiene; ve S1 como antes, no S3, ni la carpeta.
  perform pg_temp.check(private.user_page_level(pg_temp.u('e6b3'), pg_temp.u('e6a4'))::text, '1', 'g ve S2');
  perform pg_temp.check(private.user_page_level(pg_temp.u('e6b4'), pg_temp.u('e6a4'))::text, '0', 'g no ve S3');
  perform pg_temp.check(private.user_page_level(pg_temp.u('e6b0'), pg_temp.u('e6a4'))::text, '0', 'g no ve la carpeta');

  -- Nunca baja: g ya tiene Comentar sobre S1; un pedido de S1 aceptado con Ver lo deja en Comentar.
  perform pg_temp.check(pg_temp.ask('e6a4', 'e6e0', null, '1013'), 'sent', 'g pide S1');
  perform pg_temp.check(pg_temp.dec('e6a0', pg_temp.rid('e6a4', '1013'), true, 'e6e0', 'e6b1'), 'accepted', 'dar S1 con Ver');
  perform pg_temp.check(pg_temp.grant_of('e6a4', 'e6b1'), 'comment', 'Comentar sigue');

  -- «mor» nombra M2 y M3: se da desde M2 y el pedido sale de las dos filas.
  perform pg_temp.check(pg_temp.dec('e6a0', r_mor, true, 'e6e2', 'e6b9', 'comment'), 'accepted', 'dar MS2 con Comentar');
  perform pg_temp.check(pg_temp.grant_of('e6a4', 'e6b9'), 'comment', 'g comenta MS2');
  perform pg_temp.lacks(pg_temp.list('e6a0'), ':001', 'mor, fuera de la lista');

  -- Quien pidió y ya no es miembro: `member_not_found` (no se lo invita como alguien nuevo).
  perform pg_temp.check(pg_temp.dec('e6a0', r_y, true, 'e6e0', 'e6b3'), 'error:member_not_found', 'sacado');
  assert not exists (select 1 from public.invitations where email = 'pe-y@test.invalid'), 'se invitó a alguien sacado';

  -- Rechazar: explícito, sin permiso; el mismo pedido dentro de las 24 horas queda `void` y no se lista.
  perform pg_temp.check(pg_temp.dec('e6a1', r_h, false, 'e6e0', null), 'declined', 'a rechaza el de h');
  perform pg_temp.check(pg_temp.grant_of('e6a5', 'e6b3'), '(ninguno)', 'rechazar no da nada');
  perform pg_temp.check(pg_temp.ask('e6a5', 'e6e0', null, '1066'), 'sent', 'h vuelve a pedir');
  perform pg_temp.check(pg_temp.state_of(pg_temp.rid('e6a5', '1066', 'void')), 'void', 'dentro del día, void');
  perform pg_temp.lacks(pg_temp.list('e6a0'), 'pe-h:e6e0', 'void no se lista');
  -- Pasado el día del rechazo, al pedir de nuevo vuelve a la lista.
  update public.scene_access_requests set decided_at = now() - interval '25 hours' where id = r_h;
  perform pg_temp.ask('e6a5', 'e6e0', null, '1066');
  perform pg_temp.check(pg_temp.state_of(pg_temp.rid('e6a5', '1066')), 'pending', 'pasado el día, pendiente');

  -- Para a, «erso» es PR (no comparte EX): lo puede decidir desde PR, y la dueña ya no lo ve en EX.
  perform pg_temp.check(pg_temp.dec('e6a1', r_ex, false, 'e6e0', null), 'declined', 'a rechaza «erso» como PR');
  perform pg_temp.lacks(pg_temp.list('e6a0') || ' ; ', '~erso ; ', '«erso» decidido, fuera de la lista de la dueña');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 6. La versión de la base
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  assert (select schema_version from public.workspace_settings where id) >= 29, 'schema_version';
end;
$$;

rollback;
select 'ok' as result;
