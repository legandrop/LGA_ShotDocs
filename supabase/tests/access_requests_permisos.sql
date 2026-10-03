-- Pruebas de *Request access* (20261031120000_access_requests.sql, Docs/Doc_Links_PDF.md, secciones 5, 7 y 9.2): pedir
-- (`request_access`) responde lo mismo exista o no el archivo y deja una fila en los dos casos, con el tope de 20 por día
-- y la renovación por hora; la lista (`access_requests_pending`) la ve solo quien puede compartir una página viva que usa
-- el archivo, con solo esas páginas; decidir (`decide_access_request`) rechaza solo si se lo pide (LF20), acepta con un
-- permiso de los de siempre sobre una de esas páginas y nunca baja uno que ya existe (LF11). La tabla no se lee ni se
-- escribe directo. Corre dentro de una transacción que se deshace al final: no deja usuarios ni datos. Si todo pasa,
-- devuelve una fila con result = 'ok'.

begin;

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

create function pg_temp.as_nosub() returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', '{"role": "authenticated"}', true),
         set_config('request.headers', '{}', true);
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

-- `stmt` como `who` (con su sesión), de vuelta a postgres.
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

-- Pedir un archivo (por su sufijo, o un uuid entero).
create function pg_temp.ask(who text, file text, method text default 'otp') returns text language sql as $$
  select pg_temp.run_as(who, format('select public.request_access(%L)',
                                    case when length(file) = 4 then pg_temp.u(file) else file::uuid end), method);
$$;

-- La lista de `who`: «persona:archivo:páginas» ordenada, o '(vacía)'.
create function pg_temp.list(who text, method text default 'otp') returns text language sql as $$
  select pg_temp.run_as(who, $q$
    select coalesce(string_agg(split_part(email, '@', 1) || ':' || file_name || ':'
                               || (select string_agg(p ->> 'title', '+' order by o) from jsonb_array_elements(pages) with ordinality as x(p, o)),
                               ' | ' order by email, file_name), '(vacía)')
    from public.access_requests_pending()$q$, method);
$$;

-- El id del pedido abierto (o en `st`) de `who` sobre `file`.
create function pg_temp.rid(who text, file text, st text default 'pending') returns uuid language sql as $$
  select id from public.access_requests where user_id = pg_temp.u(who) and file_id = pg_temp.u(file) and state = st
  order by created_at desc limit 1;
$$;

create function pg_temp.decide(who text, req uuid, accept boolean, page text, lvl text default 'view',
                               method text default 'otp') returns text language sql as $$
  select pg_temp.run_as(who, format('select public.decide_access_request(%L, %L, %L, %L)', req, accept,
                                    case when page is null then null else pg_temp.u(page) end, lvl), method);
$$;

-- Los estados de las filas de `who` sobre `file`, en orden alfabético (en la transacción, `now()` es uno solo).
create function pg_temp.states(who text, file text) returns text language sql as $$
  select coalesce(string_agg(state, ',' order by state), '(ninguna)') from public.access_requests
  where user_id = pg_temp.u(who) and file_id = pg_temp.u(file);
$$;

create function pg_temp.grant_of(who text, page text) returns text language sql as $$
  select coalesce((select level from public.grants where user_id = pg_temp.u(who) and page_id = pg_temp.u(page)
                   and revoked_at is null), '(ninguno)');
$$;

-- ---------------------------------------------------------------------------------------------------
-- Datos
-- ---------------------------------------------------------------------------------------------------
-- Personas: o (dueña del workspace y de PR), d (admin con 4 solo en P), n (admin sin nada), c (miembro común, dueño
-- de Q), b (invitado), e, y (la sacan), k (entra con contraseña), s (el tope), m (ya tiene Editar en P), x (sin
-- membresía).
update public.members set removed_at = now() where role = 'owner' and removed_at is null;
insert into auth.users (id, email, aud, role) values
  (pg_temp.u('e2a0'), 'ar-o@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2a1'), 'ar-d@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2a2'), 'ar-n@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2a3'), 'ar-c@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2a4'), 'ar-b@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2a5'), 'ar-e@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2a6'), 'ar-y@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2a7'), 'ar-x@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2a8'), 'ar-k@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2a9'), 'ar-s@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2aa'), 'ar-m@test.invalid', 'authenticated', 'authenticated');
insert into public.members (user_id, role) values
  (pg_temp.u('e2a0'), 'owner'), (pg_temp.u('e2a1'), 'admin'), (pg_temp.u('e2a2'), 'admin'), (pg_temp.u('e2a3'), 'member'),
  (pg_temp.u('e2a4'), 'guest'), (pg_temp.u('e2a5'), 'member'), (pg_temp.u('e2a6'), 'member'), (pg_temp.u('e2a8'), 'member'),
  (pg_temp.u('e2a9'), 'member'), (pg_temp.u('e2aa'), 'member');
-- Proyectos: PR (de o), Q (de c, miembro común), DEL (de o, borrado).
insert into public.workspaces (id, owner_id, name) values
  (pg_temp.u('e2e0'), pg_temp.u('e2a0'), 'PR'),
  (pg_temp.u('e2e1'), pg_temp.u('e2a3'), 'Q'),
  (pg_temp.u('e2e2'), pg_temp.u('e2a0'), 'DEL');
-- PR: R › P, P2, P3, P4, T (papelera). Q: QP. DEL: DP.
insert into public.pages (id, workspace_id, parent_id, title, sort_key, settings) values
  (pg_temp.u('e2b0'), pg_temp.u('e2e0'), null, 'R', 'a0', '{}'),
  (pg_temp.u('e2b1'), pg_temp.u('e2e0'), pg_temp.u('e2b0'), 'P', 'a0', '{}'),
  (pg_temp.u('e2b2'), pg_temp.u('e2e0'), pg_temp.u('e2b0'), 'P2', 'a1', '{}'),
  (pg_temp.u('e2b3'), pg_temp.u('e2e0'), pg_temp.u('e2b0'), 'P3', 'a2', '{}'),
  (pg_temp.u('e2b4'), pg_temp.u('e2e0'), pg_temp.u('e2b0'), 'P4', 'a3', '{}'),
  (pg_temp.u('e2b5'), pg_temp.u('e2e0'), pg_temp.u('e2b0'), 'T', 'a4', '{}'),
  (pg_temp.u('e2b6'), pg_temp.u('e2e1'), null, 'QP', 'a0', '{}'),
  (pg_temp.u('e2b7'), pg_temp.u('e2e2'), null, 'DP', 'a0', '{}');
-- Archivos: F en P y en P2 (P primero), F3 en P3, F4 en P4, G en T, QF en QP, DF en DP, F5 en ninguna página; FP (ya en
-- la papelera de Drive) y F6 en P.
insert into public.files (id, project_id, name, mime, size, created_by) values
  (pg_temp.u('e2f0'), pg_temp.u('e2e0'), 'f.pdf', 'application/pdf', 10, pg_temp.u('e2a0')),
  (pg_temp.u('e2f3'), pg_temp.u('e2e0'), 'f3.mp4', 'video/mp4', 10, pg_temp.u('e2a0')),
  (pg_temp.u('e2f4'), pg_temp.u('e2e0'), 'f4.pdf', 'application/pdf', 10, pg_temp.u('e2a0')),
  (pg_temp.u('e2f5'), pg_temp.u('e2e0'), 'g.pdf', 'application/pdf', 10, pg_temp.u('e2a0')),
  (pg_temp.u('e2f6'), pg_temp.u('e2e1'), 'qf.pdf', 'application/pdf', 10, pg_temp.u('e2a3')),
  (pg_temp.u('e2f7'), pg_temp.u('e2e2'), 'df.pdf', 'application/pdf', 10, pg_temp.u('e2a0')),
  (pg_temp.u('e2f8'), pg_temp.u('e2e0'), 'f5.pdf', 'application/pdf', 10, pg_temp.u('e2a0')),
  (pg_temp.u('e2f9'), pg_temp.u('e2e0'), 'fp.pdf', 'application/pdf', 10, pg_temp.u('e2a0')),
  (pg_temp.u('e2fa'), pg_temp.u('e2e0'), 'f6.pdf', 'application/pdf', 10, pg_temp.u('e2a0'));
insert into public.page_files (page_id, file_id, created_at) values
  (pg_temp.u('e2b2'), pg_temp.u('e2f0'), now()),
  (pg_temp.u('e2b1'), pg_temp.u('e2f0'), now() - interval '1 minute'),
  (pg_temp.u('e2b3'), pg_temp.u('e2f3'), now()),
  (pg_temp.u('e2b4'), pg_temp.u('e2f4'), now()),
  (pg_temp.u('e2b5'), pg_temp.u('e2f5'), now()),
  (pg_temp.u('e2b6'), pg_temp.u('e2f6'), now()),
  (pg_temp.u('e2b7'), pg_temp.u('e2f7'), now()),
  (pg_temp.u('e2b1'), pg_temp.u('e2f9'), now()),
  (pg_temp.u('e2b1'), pg_temp.u('e2fa'), now());
-- FP se mandó a la papelera de Drive y su página sigue viva (por ejemplo, se restauró la página después: O1).
update public.files set trashed_at = now(), purged_at = now() where id = pg_temp.u('e2f9');
-- d: Editar y crear páginas solo sobre P. m: Editar sobre P.
insert into public.grants (user_id, page_id, level) values
  (pg_temp.u('e2a1'), pg_temp.u('e2b1'), 'edit_pages'),
  (pg_temp.u('e2aa'), pg_temp.u('e2b1'), 'edit');
update public.pages set deleted_at = now() where id = pg_temp.u('e2b5');
update public.workspaces set deleted_at = now() where id = pg_temp.u('e2e2');

-- ---------------------------------------------------------------------------------------------------
-- 1. La tabla y las puertas: anon, sin sesión, sin membresía, con contraseña
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  assert (select relrowsecurity from pg_class where oid = 'public.access_requests'::regclass), 'la tabla sin RLS';
  assert (select count(*) from pg_policies where schemaname = 'public' and tablename = 'access_requests') = 0,
    'la tabla tiene políticas';
  assert not has_table_privilege('authenticated', 'public.access_requests', 'select'), 'authenticated lee la tabla';
  assert not has_table_privilege('authenticated', 'public.access_requests', 'insert'), 'authenticated inserta en la tabla';
  assert not has_table_privilege('authenticated', 'public.access_requests', 'update'), 'authenticated cambia la tabla';
  assert not has_table_privilege('anon', 'public.access_requests', 'select'), 'anon lee la tabla';
  assert not has_function_privilege('anon', 'public.request_access(uuid)', 'execute'), 'anon pide';
  assert not has_function_privilege('anon', 'public.access_requests_pending()', 'execute'), 'anon lista';
  assert not has_function_privilege('anon', 'public.decide_access_request(uuid, boolean, uuid, text)', 'execute'), 'anon decide';
  assert not has_function_privilege('anon', 'public.media_file(uuid)', 'execute'), 'anon pregunta por un archivo';
  assert not has_function_privilege('authenticated', 'private.access_request_valid(uuid, uuid)', 'execute'),
    'authenticated llama a la regla interna';
  assert has_function_privilege('authenticated', 'public.request_access(uuid)', 'execute'), 'authenticated no pide';
  assert has_function_privilege('authenticated', 'public.access_requests_pending()', 'execute'), 'authenticated no lista';
  assert has_function_privilege('authenticated', 'public.decide_access_request(uuid, boolean, uuid, text)', 'execute'),
    'authenticated no decide';
  assert (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where (n.nspname, p.proname) in (('public', 'request_access'), ('public', 'access_requests_pending'),
                                           ('public', 'decide_access_request'), ('private', 'access_request_valid'))),
    'una función sin SECURITY DEFINER o sin search_path vacío';

  perform pg_temp.as_anon();
  perform pg_temp.check(pg_temp.val('select count(*) from public.access_requests'),
    'error:permission denied for table access_requests', 'anon lee la tabla');
  perform pg_temp.check(pg_temp.val(format('select public.request_access(%L)', pg_temp.u('e2f0'))),
    'error:permission denied for function request_access', 'anon pide (llamado)');
  perform pg_temp.as_nosub();
  perform pg_temp.check(pg_temp.val(format('select public.request_access(%L)', pg_temp.u('e2f0'))), 'error:not_member', 'sin sub pide');
  perform pg_temp.check(pg_temp.val('select count(*) from public.access_requests_pending()'), '0', 'sin sub lista');
  perform pg_temp.check(pg_temp.val(format('select public.decide_access_request(%L, true, %L)', gen_random_uuid(), pg_temp.u('e2b1'))),
    'error:request_not_found', 'sin sub decide');
  perform pg_temp.as_postgres();

  perform pg_temp.check(pg_temp.ask('e2a7', 'e2f0'), 'error:not_member', 'x (sin membresía) pide');
  perform pg_temp.check(pg_temp.list('e2a7'), '(vacía)', 'x lista');
  perform pg_temp.check(pg_temp.ask('e2a8', 'e2f0', 'password'), 'error:not_member', 'k con contraseña pide');
  perform pg_temp.check(pg_temp.ask('e2a5', null), 'error:target_invalid', 'pedir sin archivo');
  perform pg_temp.check(pg_temp.ask('e2a0', 'e2f0'), 'has_access', 'la dueña pide lo que ve');
  assert not exists (select 1 from public.access_requests), 'quedó una fila de un pedido rechazado';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 2. Pedir: la misma respuesta exista o no, una fila en los dos casos, repetido sin filas nuevas
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.check(pg_temp.ask('e2a4', 'e2f0'), 'sent', 'b pide F');
  perform pg_temp.check(pg_temp.ask('e2a4', 'e2f0'), 'sent', 'b pide F otra vez');
  perform pg_temp.check(pg_temp.ask('e2a4', 'e2ff'), 'sent', 'b pide un id que no existe');
  perform pg_temp.check(pg_temp.ask('e2a4', 'e2ff'), 'sent', 'b pide un id que no existe otra vez');
  perform pg_temp.check(pg_temp.ask('e2a4', 'e2f5'), 'sent', 'b pide G (su página en la papelera)');
  perform pg_temp.check(pg_temp.ask('e2a4', 'e2f7'), 'sent', 'b pide DF (proyecto borrado)');
  perform pg_temp.check(pg_temp.states('e2a4', 'e2f0'), 'pending', 'F no quedó pendiente');
  perform pg_temp.check(pg_temp.states('e2a4', 'e2ff'), 'void', 'el id inexistente no quedó void');
  perform pg_temp.check(pg_temp.states('e2a4', 'e2f5'), 'void', 'G no quedó void');
  perform pg_temp.check(pg_temp.states('e2a4', 'e2f7'), 'void', 'DF no quedó void');
  assert (select times from public.access_requests where id = pg_temp.rid('e2a4', 'e2f0')) = 1,
    'el pedido repetido en la hora sumó';
  assert (select count(*) from public.access_requests where user_id = pg_temp.u('e2a4')) = 4, 'b no tiene 4 filas';

  -- Leer o escribir la tabla directo: no, ni siquiera lo propio.
  perform pg_temp.check(pg_temp.run_as('e2a4', 'select count(*) from public.access_requests'),
    'error:permission denied for table access_requests', 'b lee la tabla');
  perform pg_temp.check(pg_temp.run_as('e2a4', format(
      'insert into public.access_requests (user_id, file_id) values (%L, %L) returning id', pg_temp.u('e2a4'), pg_temp.u('e2f3'))),
    'error:permission denied for table access_requests', 'b inserta en la tabla');
  perform pg_temp.check(pg_temp.run_as('e2a4', format(
      'update public.access_requests set state = %L returning id', 'accepted')),
    'error:permission denied for table access_requests', 'b cambia la tabla');

  -- Los demás pedidos de la prueba.
  perform pg_temp.check(pg_temp.ask('e2a5', 'e2f0'), 'sent', 'e pide F');
  perform pg_temp.check(pg_temp.ask('e2a3', 'e2f0'), 'sent', 'c pide F');
  perform pg_temp.check(pg_temp.ask('e2a6', 'e2f0'), 'sent', 'y pide F');
  perform pg_temp.check(pg_temp.ask('e2a4', 'e2f6'), 'sent', 'b pide QF');
  perform pg_temp.check(pg_temp.ask('e2a4', 'e2f3'), 'sent', 'b pide F3');
  perform pg_temp.check(pg_temp.ask('e2a5', 'e2f4'), 'sent', 'e pide F4');
  perform pg_temp.check(pg_temp.ask('e2aa', 'e2f0'), 'has_access', 'm pide lo que ve');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 3. Quién ve la lista: quien puede compartir una página viva que usa el archivo, con solo esas páginas
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.check(pg_temp.list('e2a0'),
    'ar-b:f.pdf:P+P2 | ar-b:f3.mp4:P3 | ar-c:f.pdf:P+P2 | ar-e:f.pdf:P+P2 | ar-e:f4.pdf:P4 | ar-y:f.pdf:P+P2',
    'la lista de la dueña (sin QF de Q, sin los void)');
  -- c, miembro común dueño de Q: solo lo de su proyecto, con el rol de quien pide (LF19).
  perform pg_temp.check(pg_temp.list('e2a3'), 'ar-b:qf.pdf:QP', 'la lista de c');
  perform pg_temp.check(pg_temp.run_as('e2a3', 'select string_agg(role, '','') from public.access_requests_pending()'),
    'guest', 'c no ve el rol de quien pide');
  -- d, admin con 4 solo en P: los de F, con solo P.
  perform pg_temp.check(pg_temp.list('e2a1'), 'ar-b:f.pdf:P | ar-c:f.pdf:P | ar-e:f.pdf:P | ar-y:f.pdf:P', 'la lista de d');
  perform pg_temp.check(pg_temp.list('e2a2'), '(vacía)', 'la lista de n (admin sin nada)');
  perform pg_temp.check(pg_temp.list('e2a4'), '(vacía)', 'la lista de b (invitado)');
  perform pg_temp.check(pg_temp.list('e2a5'), '(vacía)', 'la lista de e (miembro sin compartir)');
  perform pg_temp.check(pg_temp.list('e2a0', 'password'), '(vacía)', 'la lista de la dueña con contraseña');
  -- m ya ve F por su permiso: si pidiera, no aparecería (lo cubre la sección 5).
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 4. Decidir: quién, qué página, qué nivel, rechazar explícito
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  -- No le toca: invitado, admin sin nada, miembro común de otro proyecto, contraseña, un id al azar.
  perform pg_temp.check(pg_temp.decide('e2a4', pg_temp.rid('e2a5', 'e2f0'), true, 'e2b1'), 'error:request_not_found', 'b decide');
  perform pg_temp.check(pg_temp.decide('e2a2', pg_temp.rid('e2a5', 'e2f0'), true, 'e2b1'), 'error:request_not_found', 'n decide');
  perform pg_temp.check(pg_temp.decide('e2a3', pg_temp.rid('e2a5', 'e2f0'), true, 'e2b1'), 'error:request_not_found', 'c decide uno de PR');
  perform pg_temp.check(pg_temp.decide('e2a3', pg_temp.rid('e2a5', 'e2f0'), false, null), 'error:request_not_found', 'c rechaza uno de PR');
  perform pg_temp.check(pg_temp.decide('e2a0', pg_temp.rid('e2a4', 'e2f6'), true, 'e2b6'), 'error:request_not_found', 'la dueña decide uno de Q');
  perform pg_temp.check(pg_temp.decide('e2a0', pg_temp.rid('e2a5', 'e2f0'), true, 'e2b1', 'view', 'password'),
    'error:request_not_found', 'la dueña con contraseña decide');
  perform pg_temp.check(pg_temp.decide('e2a0', gen_random_uuid(), true, 'e2b1'), 'error:request_not_found', 'decidir un id al azar');
  perform pg_temp.check(pg_temp.decide('e2a0', pg_temp.rid('e2a4', 'e2ff', 'void'), true, 'e2b1'), 'error:request_not_found', 'decidir un void');

  -- Rechazar es explícito (LF20); la página solo cuenta al aceptar.
  perform pg_temp.check(pg_temp.decide('e2a1', pg_temp.rid('e2a5', 'e2f0'), null, 'e2b1'), 'error:decision_invalid', 'decidir con aceptar nulo');
  perform pg_temp.check(pg_temp.decide('e2a1', pg_temp.rid('e2a5', 'e2f0'), true, null), 'error:page_invalid', 'aceptar sin página');
  perform pg_temp.check(pg_temp.decide('e2a1', pg_temp.rid('e2a5', 'e2f0'), true, 'e2b2'), 'error:page_invalid', 'd acepta en P2 (no la comparte)');
  perform pg_temp.check(pg_temp.decide('e2a1', pg_temp.rid('e2a5', 'e2f0'), true, 'e2b0'), 'error:page_invalid', 'd acepta en R (arriba, sin el archivo)');
  perform pg_temp.check(pg_temp.decide('e2a0', pg_temp.rid('e2a5', 'e2f0'), true, 'e2b3'), 'error:page_invalid', 'aceptar en una página sin el archivo');
  perform pg_temp.check(pg_temp.decide('e2a1', pg_temp.rid('e2a5', 'e2f0'), true, 'e2b1', 'owner'), 'error:level_invalid', 'aceptar con nivel owner');
  perform pg_temp.check(pg_temp.decide('e2a1', pg_temp.rid('e2a5', 'e2f0'), true, 'e2b1', null), 'error:level_invalid', 'aceptar sin nivel');
  perform pg_temp.check(pg_temp.states('e2a5', 'e2f0'), 'pending', 'un error cambió el pedido');

  -- Bien: d acepta a e en P con Can view.
  perform pg_temp.check(pg_temp.decide('e2a1', pg_temp.rid('e2a5', 'e2f0'), true, 'e2b1'), 'accepted', 'd acepta a e en P');
  perform pg_temp.check(pg_temp.grant_of('e2a5', 'e2b1'), 'view', 'e no recibió Can view en P');
  assert (select granted_by = pg_temp.u('e2a1') from public.grants where user_id = pg_temp.u('e2a5') and page_id = pg_temp.u('e2b1')),
    'el permiso no quedó dado por d';
  assert (select page_id = pg_temp.u('e2b1') and level = 'view' and decided_by = pg_temp.u('e2a1') and decided_at is not null
          from public.access_requests where user_id = pg_temp.u('e2a5') and file_id = pg_temp.u('e2f0')),
    'el pedido no anotó página, nivel y quién';
  perform pg_temp.check(pg_temp.run_as('e2a5', format('select public.media_file(%L) ->> %L', pg_temp.u('e2f0'), 'level')), '1',
    'e no ve F');
  perform pg_temp.check(pg_temp.ask('e2a5', 'e2f0'), 'has_access', 'e pide F de nuevo');
  -- Otra vez el mismo: ya decidido.
  perform pg_temp.check(pg_temp.decide('e2a0', (select id from public.access_requests where user_id = pg_temp.u('e2a5')
                                                 and file_id = pg_temp.u('e2f0')), true, 'e2b1'),
    'error:request_not_found', 'decidir dos veces');
  perform pg_temp.check(pg_temp.list('e2a1'), 'ar-b:f.pdf:P | ar-c:f.pdf:P | ar-y:f.pdf:P', 'la lista de d después de aceptar');

  -- c, miembro común dueño de Q, acepta a b (invitado) con Can comment.
  perform pg_temp.check(pg_temp.decide('e2a3', pg_temp.rid('e2a4', 'e2f6'), true, 'e2b6', 'comment'), 'accepted', 'c acepta a b en QP');
  perform pg_temp.check(pg_temp.run_as('e2a4', format('select public.media_file(%L) ->> %L', pg_temp.u('e2f6'), 'level')), '2',
    'b no ve QF con Can comment');
  -- Un invitado con los mismos niveles que Share (O17).
  perform pg_temp.check(pg_temp.decide('e2a0', pg_temp.rid('e2a4', 'e2f3'), true, 'e2b3', 'edit_pages'), 'accepted', 'b con edit_pages');
  perform pg_temp.check(pg_temp.grant_of('e2a4', 'e2b3'), 'edit_pages', 'b no recibió edit_pages en P3');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 5. Nunca baja (LF11): m tiene Editar en P; se acepta un pedido suyo con Can view y sigue con Editar
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  -- m perdió su permiso un momento y pidió; se lo devuelven por Share y después alguien acepta su pedido viejo.
  update public.grants set revoked_at = now() where user_id = pg_temp.u('e2aa') and page_id = pg_temp.u('e2b1');
  perform pg_temp.check(pg_temp.ask('e2aa', 'e2f0'), 'sent', 'm pide F sin permiso');
  perform pg_temp.check(pg_temp.run_as('e2a0', format('select public.share(%L, null, %L, %L) is not null', pg_temp.u('e2aa'),
                                                     pg_temp.u('e2b1'), 'edit')), 'true', 'la dueña le devuelve Editar a m');
  perform pg_temp.check(pg_temp.run_as('e2a0', format('select count(*) from public.access_requests_pending() where user_id = %L',
                                                     pg_temp.u('e2aa'))), '0', 'la lista muestra a quien ya ve');
  perform pg_temp.check(pg_temp.decide('e2a0', pg_temp.rid('e2aa', 'e2f0'), true, 'e2b1', 'view'), 'accepted', 'aceptar a m');
  perform pg_temp.check(pg_temp.grant_of('e2aa', 'e2b1'), 'edit', 'aceptar bajó el permiso de m');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 6. Rechazar: el mismo día queda void; 25 horas después vuelve a pendiente
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.check(pg_temp.decide('e2a0', pg_temp.rid('e2a3', 'e2f0'), false, null), 'declined', 'la dueña rechaza a c');
  perform pg_temp.check(pg_temp.ask('e2a3', 'e2f0'), 'sent', 'c pide de nuevo el mismo día');
  perform pg_temp.check(pg_temp.states('e2a3', 'e2f0'), 'declined,void', 'las filas de c después del rechazo');
  -- Un void de un archivo real no se decide (ni aceptar ni rechazar).
  perform pg_temp.check(pg_temp.decide('e2a0', pg_temp.rid('e2a3', 'e2f0', 'void'), true, 'e2b1'), 'error:request_not_found',
    'aceptar el void de c');
  perform pg_temp.check(pg_temp.run_as('e2a0', format('select count(*) from public.access_requests_pending() where user_id = %L',
                                                     pg_temp.u('e2a3'))), '0', 'la lista muestra a c rechazado');
  -- Renovarlo antes de las 24 horas no lo trae (O15).
  update public.access_requests set asked_at = now() - interval '2 hours'
  where user_id = pg_temp.u('e2a3') and file_id = pg_temp.u('e2f0') and state = 'void';
  perform pg_temp.check(pg_temp.ask('e2a3', 'e2f0'), 'sent', 'c renueva antes del día');
  perform pg_temp.check(pg_temp.states('e2a3', 'e2f0'), 'declined,void', 'renovar antes del día lo trajo');
  update public.access_requests set decided_at = now() - interval '25 hours'
  where user_id = pg_temp.u('e2a3') and file_id = pg_temp.u('e2f0') and state = 'declined';
  update public.access_requests set created_at = now() - interval '25 hours', asked_at = now() - interval '2 hours'
  where user_id = pg_temp.u('e2a3') and file_id = pg_temp.u('e2f0') and state = 'void';
  perform pg_temp.check(pg_temp.ask('e2a3', 'e2f0'), 'sent', 'c pide al día siguiente');
  perform pg_temp.check(pg_temp.states('e2a3', 'e2f0'), 'declined,pending', 'al día siguiente no volvió a pendiente');
  perform pg_temp.check(pg_temp.run_as('e2a0', format('select count(*) from public.access_requests_pending() where user_id = %L',
                                                     pg_temp.u('e2a3'))), '1', 'la lista no muestra a c al día siguiente');

  -- Un void de un archivo que después se agrega a una página: recién a las 24 horas (O15).
  perform pg_temp.check(pg_temp.ask('e2a5', 'e2f8'), 'sent', 'e pide F5 (en ninguna página)');
  insert into public.page_files (page_id, file_id) values (pg_temp.u('e2b1'), pg_temp.u('e2f8'));
  update public.access_requests set asked_at = now() - interval '2 hours' where user_id = pg_temp.u('e2a5') and file_id = pg_temp.u('e2f8');
  perform pg_temp.check(pg_temp.ask('e2a5', 'e2f8'), 'has_access', 'e ya ve F5 por P');
  update public.grants set revoked_at = now() where user_id = pg_temp.u('e2a5') and page_id = pg_temp.u('e2b1');
  perform pg_temp.check(pg_temp.ask('e2a5', 'e2f8'), 'sent', 'e renueva F5 antes del día');
  perform pg_temp.check(pg_temp.states('e2a5', 'e2f8'), 'void', 'F5 volvió antes del día');
  update public.access_requests set created_at = now() - interval '25 hours', asked_at = now() - interval '2 hours'
  where user_id = pg_temp.u('e2a5') and file_id = pg_temp.u('e2f8');
  perform pg_temp.check(pg_temp.ask('e2a5', 'e2f8'), 'sent', 'e renueva F5 al día siguiente');
  perform pg_temp.check(pg_temp.states('e2a5', 'e2f8'), 'pending', 'F5 no volvió al día siguiente');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 7. La papelera, el miembro sacado, 30 días, la renovación por hora
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  -- F4 en la papelera: sale de la lista y no se decide; restaurado, vuelve.
  update public.pages set deleted_at = now() where id = pg_temp.u('e2b4');
  perform pg_temp.check(pg_temp.run_as('e2a0', format('select count(*) from public.access_requests_pending() where file_id = %L',
                                                     pg_temp.u('e2f4'))), '0', 'la lista muestra un archivo de la papelera');
  perform pg_temp.check(pg_temp.decide('e2a0', pg_temp.rid('e2a5', 'e2f4'), true, 'e2b4'), 'error:request_not_found',
    'aceptar un archivo de la papelera');
  update public.pages set deleted_at = null where id = pg_temp.u('e2b4');
  perform pg_temp.check(pg_temp.run_as('e2a0', format('select count(*) from public.access_requests_pending() where file_id = %L',
                                                     pg_temp.u('e2f4'))), '1', 'restaurada, la lista no lo muestra');

  -- y sacado: sale de la lista, aceptarlo da member_not_found y no puede pedir.
  update public.members set removed_at = now() where user_id = pg_temp.u('e2a6');
  perform pg_temp.check(pg_temp.run_as('e2a0', format('select count(*) from public.access_requests_pending() where user_id = %L',
                                                     pg_temp.u('e2a6'))), '0', 'la lista muestra a un miembro sacado');
  perform pg_temp.check(pg_temp.decide('e2a0', pg_temp.rid('e2a6', 'e2f0'), true, 'e2b1'), 'error:member_not_found', 'aceptar a y sacado');
  perform pg_temp.check(pg_temp.ask('e2a6', 'e2f4'), 'error:not_member', 'y sacado pide');

  -- 30 días: oculto; renovar lo trae; renovar dos veces en la hora suma una.
  update public.access_requests set asked_at = now() - interval '31 days', created_at = now() - interval '31 days'
  where id = pg_temp.rid('e2a4', 'e2f0');
  perform pg_temp.check(pg_temp.run_as('e2a0', format('select count(*) from public.access_requests_pending() where user_id = %L and file_id = %L',
                                                     pg_temp.u('e2a4'), pg_temp.u('e2f0'))), '0', 'la lista muestra uno de 31 días');
  -- Tampoco se decide por su id (O2 de la auditoría).
  perform pg_temp.check(pg_temp.decide('e2a0', pg_temp.rid('e2a4', 'e2f0'), true, 'e2b1'), 'error:request_not_found', 'aceptar uno de 31 días');
  perform pg_temp.check(pg_temp.decide('e2a0', pg_temp.rid('e2a4', 'e2f0'), false, null), 'error:request_not_found', 'rechazar uno de 31 días');
  perform pg_temp.check(pg_temp.states('e2a4', 'e2f0'), 'pending', 'decidir uno de 31 días lo cambió');
  perform pg_temp.check(pg_temp.ask('e2a4', 'e2f0'), 'sent', 'b renueva');
  perform pg_temp.check(pg_temp.ask('e2a4', 'e2f0'), 'sent', 'b renueva otra vez');
  assert (select times from public.access_requests where id = pg_temp.rid('e2a4', 'e2f0')) = 2, 'renovar dos veces en la hora no sumó una';
  perform pg_temp.check(pg_temp.run_as('e2a0', format('select count(*) from public.access_requests_pending() where user_id = %L and file_id = %L',
                                                     pg_temp.u('e2a4'), pg_temp.u('e2f0'))), '1', 'renovado, la lista no lo muestra');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 7b. Un archivo en la papelera de Drive (`purged_at`) en una página viva (O1 de la auditoría)
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  -- Pedirlo deja un void (la misma respuesta) y no aparece.
  perform pg_temp.check(pg_temp.ask('e2a5', 'e2f9'), 'sent', 'e pide FP');
  perform pg_temp.check(pg_temp.states('e2a5', 'e2f9'), 'void', 'FP no quedó void');
  perform pg_temp.check(pg_temp.run_as('e2a0', format('select count(*) from public.access_requests_pending() where file_id = %L',
                                                     pg_temp.u('e2f9'))), '0', 'la lista muestra FP');
  -- Un pendiente de un archivo que después se manda a Drive: sale de la lista y no se decide; si vuelve, aparece.
  perform pg_temp.check(pg_temp.ask('e2a5', 'e2fa'), 'sent', 'e pide F6');
  perform pg_temp.check(pg_temp.run_as('e2a0', format('select count(*) from public.access_requests_pending() where file_id = %L',
                                                     pg_temp.u('e2fa'))), '1', 'la lista no muestra F6');
  update public.files set trashed_at = now(), purged_at = now() where id = pg_temp.u('e2fa');
  perform pg_temp.check(pg_temp.run_as('e2a0', format('select count(*) from public.access_requests_pending() where file_id = %L',
                                                     pg_temp.u('e2fa'))), '0', 'la lista muestra F6 en la papelera de Drive');
  perform pg_temp.check(pg_temp.decide('e2a0', pg_temp.rid('e2a5', 'e2fa'), true, 'e2b1'), 'error:request_not_found',
    'aceptar F6 en la papelera de Drive');
  perform pg_temp.check(pg_temp.grant_of('e2a5', 'e2b1'), '(ninguno)', 'aceptar F6 le dio permiso a e');
  update public.files set trashed_at = null, purged_at = null where id = pg_temp.u('e2fa');
  perform pg_temp.check(pg_temp.run_as('e2a0', format('select count(*) from public.access_requests_pending() where file_id = %L',
                                                     pg_temp.u('e2fa'))), '1', 'restaurado, la lista no muestra F6');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 8. El tope: 20 filas nuevas por persona y día, valgan o no; repetir uno abierto no cuenta
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  i int;
begin
  perform pg_temp.check(pg_temp.ask('e2a9', 'e2f0'), 'sent', 's pide F');
  for i in 1..19 loop
    perform pg_temp.check(pg_temp.ask('e2a9', gen_random_uuid()::text), 'sent', format('s pide al azar %s', i));
  end loop;
  perform pg_temp.check(pg_temp.ask('e2a9', gen_random_uuid()::text), 'error:rate_limited', 's pide el 21');
  perform pg_temp.check(pg_temp.ask('e2a9', 'e2f0'), 'sent', 's repite F con el tope lleno');
  assert (select count(*) from public.access_requests where user_id = pg_temp.u('e2a9')) = 20, 's no tiene 20 filas';
  -- Las de ayer no cuentan.
  update public.access_requests set created_at = now() - interval '25 hours' where user_id = pg_temp.u('e2a9');
  perform pg_temp.check(pg_temp.ask('e2a9', gen_random_uuid()::text), 'sent', 's pide al día siguiente');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 9. La versión de la base
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  assert (select schema_version from public.workspace_settings where id) >= 22, 'schema_version';
end;
$$;

rollback;
select 'ok' as result;
