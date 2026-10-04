-- Pruebas de *Request access* para una página (20261102120000_access_requests_paginas.sql, Docs/Doc_Links_PDF.md,
-- secciones 5, 11 «E3» y 18): pedir una página (`request_page_access`) responde lo mismo exista o no, deja una fila en
-- los dos casos y comparte el tope de 20 por día con los archivos; la lista (`access_requests_pending`) muestra un pedido
-- de página solo a quien puede compartir esa página (o una de arriba), con esa sola página; decidir da el permiso sobre
-- la página pedida y ninguna otra, nunca baja uno que ya existe y rechazar es explícito. Los pedidos de archivos de la
-- 22 siguen igual (su prueba es access_requests_permisos.sql). Corre dentro de una transacción que se deshace al final:
-- no deja usuarios ni datos. Si todo pasa, devuelve una fila con result = 'ok'.

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

-- Pedir una página (por su sufijo, o un uuid entero).
create function pg_temp.askp(who text, page text, method text default 'otp') returns text language sql as $$
  select pg_temp.run_as(who, format('select public.request_page_access(%L)',
                                    case when length(page) = 4 then pg_temp.u(page) else page::uuid end), method);
$$;

-- Pedir un archivo (la 22), para ver que conviven.
create function pg_temp.askf(who text, file text) returns text language sql as $$
  select pg_temp.run_as(who, format('select public.request_access(%L)',
                                    case when length(file) = 4 then pg_temp.u(file) else file::uuid end));
$$;

-- La lista de `who`: «persona:objetivo:páginas» ordenada (una página pedida va entre corchetes), o '(vacía)'.
create function pg_temp.list(who text, method text default 'otp') returns text language sql as $$
  select pg_temp.run_as(who, $q$
    select coalesce(string_agg(split_part(email, '@', 1) || ':'
                               || coalesce(file_name, '[' || (pages -> 0 ->> 'title') || ']') || ':'
                               || (select string_agg(p ->> 'title', '+' order by o) from jsonb_array_elements(pages) with ordinality as x(p, o)),
                               ' | ' order by email collate "C", coalesce(file_name, '[' || (pages -> 0 ->> 'title') || ']') collate "C"), '(vacía)')
    from public.access_requests_pending()$q$, method);
$$;

-- El id del pedido de página abierto (o en `st`) de `who` sobre `page`.
create function pg_temp.ridp(who text, page text, st text default 'pending') returns uuid language sql as $$
  select id from public.access_requests where user_id = pg_temp.u(who) and target_page_id = pg_temp.u(page) and state = st
  order by created_at desc limit 1;
$$;

create function pg_temp.decide(who text, req uuid, accept boolean, page text, lvl text default 'view',
                               method text default 'otp') returns text language sql as $$
  select pg_temp.run_as(who, format('select public.decide_access_request(%L, %L, %L, %L)', req, accept,
                                    case when page is null then null else pg_temp.u(page) end, lvl), method);
$$;

-- Los estados de las filas de página de `who` sobre `page`, en orden alfabético.
create function pg_temp.statesp(who text, page text) returns text language sql as $$
  select coalesce(string_agg(state, ',' order by state), '(ninguna)') from public.access_requests
  where user_id = pg_temp.u(who) and target_page_id = pg_temp.u(page);
$$;

create function pg_temp.grant_of(who text, page text) returns text language sql as $$
  select coalesce((select level from public.grants where user_id = pg_temp.u(who) and page_id = pg_temp.u(page)
                   and revoked_at is null), '(ninguno)');
$$;

create function pg_temp.level_of(who text, page text) returns text language sql as $$
  select private.user_page_level(pg_temp.u(page), pg_temp.u(who))::text;
$$;

-- Cuántos pedidos ve `who` de `person` (de páginas o de archivos).
create function pg_temp.seen(who text, person text) returns text language sql as $$
  select pg_temp.run_as(who, format('select count(*) from public.access_requests_pending() where user_id = %L', pg_temp.u(person)));
$$;

-- ---------------------------------------------------------------------------------------------------
-- Datos
-- ---------------------------------------------------------------------------------------------------
-- Personas: o (dueña del workspace y de PR), d (admin con 4 solo en P, que vale para PC), n (admin sin nada), c
-- (miembro común, dueño de Q), b (invitado), e, y (la sacan), k (entra con contraseña), s (el tope), m (ya tiene Editar
-- en P), v (Ver sobre R: ve todo PR y no comparte), x (sin membresía).
update public.members set removed_at = now() where role = 'owner' and removed_at is null;
insert into auth.users (id, email, aud, role) values
  (pg_temp.u('e3a0'), 'ap-o@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e3a1'), 'ap-d@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e3a2'), 'ap-n@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e3a3'), 'ap-c@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e3a4'), 'ap-b@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e3a5'), 'ap-e@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e3a6'), 'ap-y@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e3a7'), 'ap-x@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e3a8'), 'ap-k@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e3a9'), 'ap-s@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e3aa'), 'ap-m@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e3ab'), 'ap-v@test.invalid', 'authenticated', 'authenticated');
insert into public.members (user_id, role) values
  (pg_temp.u('e3a0'), 'owner'), (pg_temp.u('e3a1'), 'admin'), (pg_temp.u('e3a2'), 'admin'), (pg_temp.u('e3a3'), 'member'),
  (pg_temp.u('e3a4'), 'guest'), (pg_temp.u('e3a5'), 'member'), (pg_temp.u('e3a6'), 'member'), (pg_temp.u('e3a8'), 'member'),
  (pg_temp.u('e3a9'), 'member'), (pg_temp.u('e3aa'), 'member'), (pg_temp.u('e3ab'), 'member');
-- Proyectos: PR (de o), Q (de c, miembro común), DEL (de o, borrado).
insert into public.workspaces (id, owner_id, name) values
  (pg_temp.u('e3e0'), pg_temp.u('e3a0'), 'PR'),
  (pg_temp.u('e3e1'), pg_temp.u('e3a3'), 'Q'),
  (pg_temp.u('e3e2'), pg_temp.u('e3a0'), 'DEL');
-- PR: R › P › PC, R › P2, R › T (papelera) › TC. Q: QP. DEL: DP.
insert into public.pages (id, workspace_id, parent_id, title, sort_key, settings) values
  (pg_temp.u('e3b0'), pg_temp.u('e3e0'), null, 'R', 'a0', '{}'),
  (pg_temp.u('e3b1'), pg_temp.u('e3e0'), pg_temp.u('e3b0'), 'P', 'a0', '{}'),
  (pg_temp.u('e3b2'), pg_temp.u('e3e0'), pg_temp.u('e3b1'), 'PC', 'a0', '{}'),
  (pg_temp.u('e3b3'), pg_temp.u('e3e0'), pg_temp.u('e3b0'), 'P2', 'a1', '{}'),
  (pg_temp.u('e3b4'), pg_temp.u('e3e0'), pg_temp.u('e3b0'), 'T', 'a2', '{}'),
  (pg_temp.u('e3b5'), pg_temp.u('e3e0'), pg_temp.u('e3b4'), 'TC', 'a0', '{}'),
  (pg_temp.u('e3b6'), pg_temp.u('e3e1'), null, 'QP', 'a0', '{}'),
  (pg_temp.u('e3b7'), pg_temp.u('e3e2'), null, 'DP', 'a0', '{}');
-- Un archivo F en P (para ver que los pedidos de archivos conviven).
insert into public.files (id, project_id, name, mime, size, created_by) values
  (pg_temp.u('e3f0'), pg_temp.u('e3e0'), 'f.pdf', 'application/pdf', 10, pg_temp.u('e3a0'));
insert into public.page_files (page_id, file_id) values (pg_temp.u('e3b1'), pg_temp.u('e3f0'));
-- d: Editar y crear páginas solo sobre P. m: Editar sobre P. v: Ver sobre R.
insert into public.grants (user_id, page_id, level) values
  (pg_temp.u('e3a1'), pg_temp.u('e3b1'), 'edit_pages'),
  (pg_temp.u('e3aa'), pg_temp.u('e3b1'), 'edit'),
  (pg_temp.u('e3ab'), pg_temp.u('e3b0'), 'view');
update public.pages set deleted_at = now() where id = pg_temp.u('e3b4');
update public.workspaces set deleted_at = now() where id = pg_temp.u('e3e2');

-- ---------------------------------------------------------------------------------------------------
-- 1. La tabla y las puertas
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  assert (select relrowsecurity from pg_class where oid = 'public.access_requests'::regclass), 'la tabla sin RLS';
  assert (select count(*) from pg_policies where schemaname = 'public' and tablename = 'access_requests') = 0,
    'la tabla tiene políticas';
  assert not has_table_privilege('authenticated', 'public.access_requests', 'select'), 'authenticated lee la tabla';
  assert not has_table_privilege('authenticated', 'public.access_requests', 'insert'), 'authenticated inserta en la tabla';
  assert not has_function_privilege('anon', 'public.request_page_access(uuid)', 'execute'), 'anon pide una página';
  assert not has_function_privilege('anon', 'public.access_requests_pending()', 'execute'), 'anon lista';
  assert not has_function_privilege('anon', 'public.decide_access_request(uuid, boolean, uuid, text)', 'execute'), 'anon decide';
  assert not has_function_privilege('authenticated', 'private.page_request_valid(uuid, uuid)', 'execute'),
    'authenticated llama a la regla interna';
  assert has_function_privilege('authenticated', 'public.request_page_access(uuid)', 'execute'), 'authenticated no pide una página';
  assert has_function_privilege('authenticated', 'public.access_requests_pending()', 'execute'), 'authenticated no lista';
  assert has_function_privilege('authenticated', 'public.decide_access_request(uuid, boolean, uuid, text)', 'execute'),
    'authenticated no decide';
  assert (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where (n.nspname, p.proname) in (('public', 'request_page_access'), ('public', 'access_requests_pending'),
                                           ('public', 'decide_access_request'), ('private', 'page_request_valid'))),
    'una función sin SECURITY DEFINER o sin search_path vacío';

  -- Uno de los dos objetivos, nunca ninguno ni los dos.
  perform pg_temp.check(pg_temp.val(format('insert into public.access_requests (user_id) values (%L) returning id', pg_temp.u('e3a5'))),
    'error:new row for relation "access_requests" violates check constraint "access_requests_target"', 'una fila sin objetivo');
  perform pg_temp.check(pg_temp.val(format('insert into public.access_requests (user_id, file_id, target_page_id) values (%L, %L, %L) returning id',
                                           pg_temp.u('e3a5'), pg_temp.u('e3f0'), pg_temp.u('e3b1'))),
    'error:new row for relation "access_requests" violates check constraint "access_requests_target"', 'una fila con los dos objetivos');

  perform pg_temp.as_anon();
  perform pg_temp.check(pg_temp.val(format('select public.request_page_access(%L)', pg_temp.u('e3b1'))),
    'error:permission denied for function request_page_access', 'anon pide una página (llamado)');
  perform pg_temp.as_nosub();
  perform pg_temp.check(pg_temp.val(format('select public.request_page_access(%L)', pg_temp.u('e3b1'))), 'error:not_member', 'sin sub pide');
  perform pg_temp.as_postgres();

  perform pg_temp.check(pg_temp.askp('e3a7', 'e3b1'), 'error:not_member', 'x (sin membresía) pide');
  perform pg_temp.check(pg_temp.askp('e3a8', 'e3b1', 'password'), 'error:not_member', 'k con contraseña pide');
  perform pg_temp.check(pg_temp.askp('e3a5', null), 'error:target_invalid', 'pedir sin página');
  perform pg_temp.check(pg_temp.askp('e3a0', 'e3b1'), 'has_access', 'la dueña pide lo que ve');
  perform pg_temp.check(pg_temp.askp('e3a1', 'e3b2'), 'has_access', 'd pide PC (la ve por P)');
  perform pg_temp.check(pg_temp.askp('e3ab', 'e3b2'), 'has_access', 'v pide PC (la ve por R)');
  perform pg_temp.check(pg_temp.askp('e3aa', 'e3b1'), 'has_access', 'm pide P (la edita)');
  assert not exists (select 1 from public.access_requests), 'quedó una fila de un pedido sin fila';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 2. Pedir: la misma respuesta exista o no, una fila en los dos casos, repetido sin filas nuevas
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.check(pg_temp.askp('e3a4', 'e3b1'), 'sent', 'b pide P');
  perform pg_temp.check(pg_temp.askp('e3a4', 'e3b1'), 'sent', 'b pide P otra vez');
  perform pg_temp.check(pg_temp.askp('e3a4', 'e3ff'), 'sent', 'b pide una página que no existe');
  perform pg_temp.check(pg_temp.askp('e3a4', 'e3ff'), 'sent', 'b pide una página que no existe otra vez');
  perform pg_temp.check(pg_temp.askp('e3a4', 'e3b4'), 'sent', 'b pide T (en la papelera)');
  perform pg_temp.check(pg_temp.askp('e3a4', 'e3b5'), 'sent', 'b pide TC (adentro de una de la papelera)');
  perform pg_temp.check(pg_temp.askp('e3a4', 'e3b7'), 'sent', 'b pide DP (proyecto borrado)');
  perform pg_temp.check(pg_temp.statesp('e3a4', 'e3b1'), 'pending', 'P no quedó pendiente');
  perform pg_temp.check(pg_temp.statesp('e3a4', 'e3ff'), 'void', 'la inexistente no quedó void');
  perform pg_temp.check(pg_temp.statesp('e3a4', 'e3b4'), 'void', 'T no quedó void');
  perform pg_temp.check(pg_temp.statesp('e3a4', 'e3b5'), 'void', 'TC no quedó void');
  perform pg_temp.check(pg_temp.statesp('e3a4', 'e3b7'), 'void', 'DP no quedó void');
  assert (select times from public.access_requests where id = pg_temp.ridp('e3a4', 'e3b1')) = 1, 'el pedido repetido en la hora sumó';
  assert (select count(*) from public.access_requests where user_id = pg_temp.u('e3a4')) = 5, 'b no tiene 5 filas';
  assert (select bool_and(file_id is null) from public.access_requests where user_id = pg_temp.u('e3a4')), 'una fila de página con archivo';

  -- La tabla, ni siquiera lo propio.
  perform pg_temp.check(pg_temp.run_as('e3a4', 'select count(*) from public.access_requests'),
    'error:permission denied for table access_requests', 'b lee la tabla');
  -- Dos abiertos de la misma persona y página: no (el índice único por objetivo).
  perform pg_temp.check(pg_temp.val(format('insert into public.access_requests (user_id, target_page_id) values (%L, %L) returning id',
                                           pg_temp.u('e3a4'), pg_temp.u('e3b1'))),
    'error:duplicate key value violates unique constraint "access_requests_open_page_key"', 'dos abiertos de la misma página');
  -- La página y un archivo de esa página: dos pedidos distintos.
  perform pg_temp.check(pg_temp.askf('e3a4', 'e3f0'), 'sent', 'b pide F (un archivo de P)');
  -- Un id de página pedido como archivo es un archivo que no existe: void, sin tocar el pedido de la página.
  perform pg_temp.check(pg_temp.askf('e3a4', 'e3b3'), 'sent', 'b pide P2 como archivo');
  assert (select state = 'void' and target_page_id is null from public.access_requests
          where user_id = pg_temp.u('e3a4') and file_id = pg_temp.u('e3b3')), 'P2 como archivo no quedó void';

  -- Los demás pedidos de la prueba.
  perform pg_temp.check(pg_temp.askp('e3a5', 'e3b2'), 'sent', 'e pide PC');
  perform pg_temp.check(pg_temp.askp('e3a5', 'e3b3'), 'sent', 'e pide P2');
  perform pg_temp.check(pg_temp.askp('e3a3', 'e3b1'), 'sent', 'c pide P');
  perform pg_temp.check(pg_temp.askp('e3a6', 'e3b1'), 'sent', 'y pide P');
  perform pg_temp.check(pg_temp.askp('e3a4', 'e3b6'), 'sent', 'b pide QP');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 3. Quién ve la lista: quien puede compartir la página (o una de arriba), con esa sola página
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.check(pg_temp.list('e3a0'),
    'ap-b:[P]:P | ap-b:f.pdf:P | ap-c:[P]:P | ap-e:[P2]:P2 | ap-e:[PC]:PC | ap-y:[P]:P',
    'la lista de la dueña (sin QP de Q, sin los void)');
  -- La columna nueva: la página en los de página, nula en los de archivo.
  perform pg_temp.check(pg_temp.run_as('e3a0', $q$select string_agg(coalesce(file_name, '-') || '=' ||
      (case when target_page_id is null then 'null' when target_page_id = (pages -> 0 ->> 'page_id')::uuid then 'misma' else 'otra' end),
      ',' order by coalesce(file_name, '-') collate "C") from public.access_requests_pending() where user_id = pg_temp.u('e3a4')$q$),
    '-=misma,f.pdf=null', 'target_page_id en la lista');
  -- c, miembro común dueño de Q: solo lo de su proyecto, con el rol de quien pide (LF19).
  perform pg_temp.check(pg_temp.list('e3a3'), 'ap-b:[QP]:QP', 'la lista de c');
  perform pg_temp.check(pg_temp.run_as('e3a3', 'select string_agg(role, '','') from public.access_requests_pending()'),
    'guest', 'c no ve el rol de quien pide');
  -- d, admin con 4 solo en P: P y PC (la de abajo), no P2; y el archivo de P.
  perform pg_temp.check(pg_temp.list('e3a1'), 'ap-b:[P]:P | ap-b:f.pdf:P | ap-c:[P]:P | ap-e:[PC]:PC | ap-y:[P]:P', 'la lista de d');
  perform pg_temp.check(pg_temp.list('e3a2'), '(vacía)', 'la lista de n (admin sin nada)');
  perform pg_temp.check(pg_temp.list('e3a4'), '(vacía)', 'la lista de b (invitado)');
  perform pg_temp.check(pg_temp.list('e3ab'), '(vacía)', 'la lista de v (ve y no comparte)');
  perform pg_temp.check(pg_temp.list('e3a0', 'password'), '(vacía)', 'la lista de la dueña con contraseña');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 4. Decidir: quién, qué página, qué nivel, rechazar explícito
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  -- No le toca: invitado, admin sin nada, quien solo ve, miembro común de otro proyecto, d sobre P2, contraseña, al azar.
  perform pg_temp.check(pg_temp.decide('e3a4', pg_temp.ridp('e3a5', 'e3b3'), true, 'e3b3'), 'error:request_not_found', 'b decide');
  perform pg_temp.check(pg_temp.decide('e3a2', pg_temp.ridp('e3a5', 'e3b3'), true, 'e3b3'), 'error:request_not_found', 'n decide');
  perform pg_temp.check(pg_temp.decide('e3ab', pg_temp.ridp('e3a5', 'e3b3'), true, 'e3b3'), 'error:request_not_found', 'v decide');
  perform pg_temp.check(pg_temp.decide('e3a3', pg_temp.ridp('e3a5', 'e3b3'), false, null), 'error:request_not_found', 'c rechaza uno de PR');
  perform pg_temp.check(pg_temp.decide('e3a1', pg_temp.ridp('e3a5', 'e3b3'), true, 'e3b3'), 'error:request_not_found', 'd decide P2');
  perform pg_temp.check(pg_temp.decide('e3a0', pg_temp.ridp('e3a4', 'e3b6'), true, 'e3b6'), 'error:request_not_found', 'la dueña decide uno de Q');
  perform pg_temp.check(pg_temp.decide('e3a0', pg_temp.ridp('e3a5', 'e3b3'), true, 'e3b3', 'view', 'password'),
    'error:request_not_found', 'la dueña con contraseña decide');
  perform pg_temp.check(pg_temp.decide('e3a0', pg_temp.ridp('e3a4', 'e3ff', 'void'), true, 'e3b1'), 'error:request_not_found', 'decidir un void');

  -- Rechazar es explícito; la página es la pedida y ninguna otra; el nivel.
  perform pg_temp.check(pg_temp.decide('e3a1', pg_temp.ridp('e3a5', 'e3b2'), null, 'e3b2'), 'error:decision_invalid', 'decidir con aceptar nulo');
  perform pg_temp.check(pg_temp.decide('e3a1', pg_temp.ridp('e3a5', 'e3b2'), true, null), 'error:page_invalid', 'aceptar sin página');
  perform pg_temp.check(pg_temp.decide('e3a1', pg_temp.ridp('e3a5', 'e3b2'), true, 'e3b1'), 'error:page_invalid', 'aceptar en P (la de arriba)');
  perform pg_temp.check(pg_temp.decide('e3a0', pg_temp.ridp('e3a5', 'e3b3'), true, 'e3b0'), 'error:page_invalid', 'aceptar en R (arriba)');
  perform pg_temp.check(pg_temp.decide('e3a0', pg_temp.ridp('e3a3', 'e3b1'), true, 'e3b2'), 'error:page_invalid', 'aceptar en PC (abajo)');
  perform pg_temp.check(pg_temp.decide('e3a0', pg_temp.ridp('e3a5', 'e3b3'), true, 'e3b1'), 'error:page_invalid', 'aceptar en otra página');
  perform pg_temp.check(pg_temp.decide('e3a1', pg_temp.ridp('e3a5', 'e3b2'), true, 'e3b2', 'owner'), 'error:level_invalid', 'aceptar con nivel owner');
  perform pg_temp.check(pg_temp.decide('e3a1', pg_temp.ridp('e3a5', 'e3b2'), true, 'e3b2', null), 'error:level_invalid', 'aceptar sin nivel');
  perform pg_temp.check(pg_temp.statesp('e3a5', 'e3b2'), 'pending', 'un error cambió el pedido');

  -- Bien: d acepta a e en PC (la comparte por P, la de arriba) con Can view.
  perform pg_temp.check(pg_temp.decide('e3a1', pg_temp.ridp('e3a5', 'e3b2'), true, 'e3b2'), 'accepted', 'd acepta a e en PC');
  perform pg_temp.check(pg_temp.grant_of('e3a5', 'e3b2'), 'view', 'e no recibió Can view en PC');
  perform pg_temp.check(pg_temp.grant_of('e3a5', 'e3b1'), '(ninguno)', 'e recibió algo en P');
  assert (select granted_by = pg_temp.u('e3a1') from public.grants where user_id = pg_temp.u('e3a5') and page_id = pg_temp.u('e3b2')),
    'el permiso no quedó dado por d';
  assert (select page_id = pg_temp.u('e3b2') and level = 'view' and decided_by = pg_temp.u('e3a1') and decided_at is not null
          from public.access_requests where user_id = pg_temp.u('e3a5') and target_page_id = pg_temp.u('e3b2')),
    'el pedido no anotó página, nivel y quién';
  perform pg_temp.check(pg_temp.run_as('e3a5', format('select count(*) from public.pages where id = %L', pg_temp.u('e3b2'))), '1', 'e no ve PC');
  perform pg_temp.check(pg_temp.run_as('e3a5', format('select count(*) from public.pages where id = %L', pg_temp.u('e3b1'))), '0', 'e ve P (arriba)');
  perform pg_temp.check(pg_temp.askp('e3a5', 'e3b2'), 'has_access', 'e pide PC de nuevo');
  perform pg_temp.check(pg_temp.decide('e3a0', (select id from public.access_requests where user_id = pg_temp.u('e3a5')
                                                 and target_page_id = pg_temp.u('e3b2')), true, 'e3b2'),
    'error:request_not_found', 'decidir dos veces');

  -- c, miembro común dueño de Q, acepta a b (invitado) con Can comment.
  perform pg_temp.check(pg_temp.decide('e3a3', pg_temp.ridp('e3a4', 'e3b6'), true, 'e3b6', 'comment'), 'accepted', 'c acepta a b en QP');
  perform pg_temp.check(pg_temp.level_of('e3a4', 'e3b6'), '2', 'b no tiene Can comment en QP');
  -- Un invitado con los mismos niveles que Share (O17).
  perform pg_temp.check(pg_temp.decide('e3a0', pg_temp.ridp('e3a4', 'e3b1'), true, 'e3b1', 'edit_pages'), 'accepted', 'b con edit_pages en P');
  perform pg_temp.check(pg_temp.grant_of('e3a4', 'e3b1'), 'edit_pages', 'b no recibió edit_pages en P');
  -- Su pedido del archivo de P ya no aparece (ya lo ve).
  perform pg_temp.check(pg_temp.seen('e3a0', 'e3a4'), '0', 'la lista sigue mostrando a b');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 5. Nunca baja (LF11): m tiene Editar en P; se acepta un pedido suyo de P con Can view y sigue con Editar
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  update public.grants set revoked_at = now() where user_id = pg_temp.u('e3aa') and page_id = pg_temp.u('e3b1');
  perform pg_temp.check(pg_temp.askp('e3aa', 'e3b1'), 'sent', 'm pide P sin permiso');
  perform pg_temp.check(pg_temp.run_as('e3a0', format('select public.share(%L, null, %L, %L) is not null', pg_temp.u('e3aa'),
                                                     pg_temp.u('e3b1'), 'edit')), 'true', 'la dueña le devuelve Editar a m');
  perform pg_temp.check(pg_temp.seen('e3a0', 'e3aa'), '0', 'la lista muestra a quien ya ve');
  perform pg_temp.check(pg_temp.decide('e3a0', pg_temp.ridp('e3aa', 'e3b1'), true, 'e3b1', 'view'), 'accepted', 'aceptar a m');
  perform pg_temp.check(pg_temp.grant_of('e3aa', 'e3b1'), 'edit', 'aceptar bajó el permiso de m');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 6. Rechazar: el mismo día queda void; 25 horas después vuelve a pendiente
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.check(pg_temp.decide('e3a0', pg_temp.ridp('e3a3', 'e3b1'), false, null), 'declined', 'la dueña rechaza a c');
  perform pg_temp.check(pg_temp.grant_of('e3a3', 'e3b1'), '(ninguno)', 'rechazar dio un permiso');
  perform pg_temp.check(pg_temp.askp('e3a3', 'e3b1'), 'sent', 'c pide de nuevo el mismo día');
  perform pg_temp.check(pg_temp.statesp('e3a3', 'e3b1'), 'declined,void', 'las filas de c después del rechazo');
  perform pg_temp.check(pg_temp.decide('e3a0', pg_temp.ridp('e3a3', 'e3b1', 'void'), true, 'e3b1'), 'error:request_not_found', 'aceptar el void de c');
  perform pg_temp.check(pg_temp.seen('e3a0', 'e3a3'), '0', 'la lista muestra a c rechazado');
  update public.access_requests set asked_at = now() - interval '2 hours'
  where user_id = pg_temp.u('e3a3') and target_page_id = pg_temp.u('e3b1') and state = 'void';
  perform pg_temp.check(pg_temp.askp('e3a3', 'e3b1'), 'sent', 'c renueva antes del día');
  perform pg_temp.check(pg_temp.statesp('e3a3', 'e3b1'), 'declined,void', 'renovar antes del día lo trajo');
  update public.access_requests set decided_at = now() - interval '25 hours'
  where user_id = pg_temp.u('e3a3') and target_page_id = pg_temp.u('e3b1') and state = 'declined';
  update public.access_requests set created_at = now() - interval '25 hours', asked_at = now() - interval '2 hours'
  where user_id = pg_temp.u('e3a3') and target_page_id = pg_temp.u('e3b1') and state = 'void';
  perform pg_temp.check(pg_temp.askp('e3a3', 'e3b1'), 'sent', 'c pide al día siguiente');
  perform pg_temp.check(pg_temp.statesp('e3a3', 'e3b1'), 'declined,pending', 'al día siguiente no volvió a pendiente');
  perform pg_temp.check(pg_temp.seen('e3a0', 'e3a3'), '1', 'la lista no muestra a c al día siguiente');
  -- Un rechazo de la página no frena un pedido de un archivo de esa página (otro objetivo).
  perform pg_temp.check(pg_temp.askf('e3a3', 'e3f0'), 'sent', 'c pide F');
  assert (select state = 'pending' from public.access_requests where user_id = pg_temp.u('e3a3') and file_id = pg_temp.u('e3f0')),
    'el rechazo de la página frenó el archivo';

  -- Un void de una página en la papelera que después se restaura: recién a las 24 horas (O15).
  update public.pages set deleted_at = null where id = pg_temp.u('e3b4');
  update public.access_requests set asked_at = now() - interval '2 hours' where user_id = pg_temp.u('e3a4') and target_page_id = pg_temp.u('e3b4');
  perform pg_temp.check(pg_temp.askp('e3a4', 'e3b4'), 'sent', 'b renueva T antes del día');
  perform pg_temp.check(pg_temp.statesp('e3a4', 'e3b4'), 'void', 'T volvió antes del día');
  update public.access_requests set created_at = now() - interval '25 hours', asked_at = now() - interval '2 hours'
  where user_id = pg_temp.u('e3a4') and target_page_id = pg_temp.u('e3b4');
  perform pg_temp.check(pg_temp.askp('e3a4', 'e3b4'), 'sent', 'b renueva T al día siguiente');
  perform pg_temp.check(pg_temp.statesp('e3a4', 'e3b4'), 'pending', 'T no volvió al día siguiente');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 7. La papelera, el proyecto borrado, el miembro sacado, 30 días, la renovación por hora
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  -- P2 (o R, la de arriba) en la papelera: sale de la lista y no se decide; restaurada, vuelve.
  update public.pages set deleted_at = now() where id = pg_temp.u('e3b0');
  perform pg_temp.check(pg_temp.seen('e3a0', 'e3a5'), '0', 'la lista muestra una página adentro de la papelera');
  perform pg_temp.check(pg_temp.decide('e3a0', pg_temp.ridp('e3a5', 'e3b3'), true, 'e3b3'), 'error:request_not_found',
    'aceptar una página adentro de la papelera');
  update public.pages set deleted_at = null where id = pg_temp.u('e3b0');
  update public.pages set deleted_at = now() where id = pg_temp.u('e3b3');
  perform pg_temp.check(pg_temp.seen('e3a0', 'e3a5'), '0', 'la lista muestra una página de la papelera');
  perform pg_temp.check(pg_temp.decide('e3a0', pg_temp.ridp('e3a5', 'e3b3'), false, null), 'error:request_not_found',
    'rechazar una página de la papelera');
  update public.pages set deleted_at = null where id = pg_temp.u('e3b3');
  perform pg_temp.check(pg_temp.seen('e3a0', 'e3a5'), '1', 'restaurada, la lista no la muestra');

  -- El proyecto borrado: sale de la lista y no se decide.
  update public.workspaces set deleted_at = now() where id = pg_temp.u('e3e0');
  perform pg_temp.check(pg_temp.seen('e3a0', 'e3a5'), '0', 'la lista muestra una página de un proyecto borrado');
  perform pg_temp.check(pg_temp.decide('e3a0', pg_temp.ridp('e3a5', 'e3b3'), true, 'e3b3'), 'error:request_not_found',
    'aceptar una página de un proyecto borrado');
  update public.workspaces set deleted_at = null where id = pg_temp.u('e3e0');

  -- y sacado: sale de la lista, aceptarlo da member_not_found y no puede pedir.
  update public.members set removed_at = now() where user_id = pg_temp.u('e3a6');
  perform pg_temp.check(pg_temp.seen('e3a0', 'e3a6'), '0', 'la lista muestra a un miembro sacado');
  perform pg_temp.check(pg_temp.decide('e3a0', pg_temp.ridp('e3a6', 'e3b1'), true, 'e3b1'), 'error:member_not_found', 'aceptar a y sacado');
  perform pg_temp.check(pg_temp.askp('e3a6', 'e3b3'), 'error:not_member', 'y sacado pide');

  -- El borde de los 30 días: con 29 días y 23 horas se lista; con 30 días y 1 hora ya no, y no se decide.
  update public.access_requests set asked_at = now() - interval '29 days 23 hours', created_at = now() - interval '29 days 23 hours'
  where id = pg_temp.ridp('e3a5', 'e3b3');
  perform pg_temp.check(pg_temp.seen('e3a0', 'e3a5'), '1', 'la lista no muestra uno de 29 días y 23 horas');
  update public.access_requests set asked_at = now() - interval '30 days 1 hour', created_at = now() - interval '30 days 1 hour'
  where id = pg_temp.ridp('e3a5', 'e3b3');
  perform pg_temp.check(pg_temp.seen('e3a0', 'e3a5'), '0', 'la lista muestra uno de 30 días y 1 hora');
  perform pg_temp.check(pg_temp.decide('e3a0', pg_temp.ridp('e3a5', 'e3b3'), true, 'e3b3'), 'error:request_not_found', 'aceptar uno de 30 días y 1 hora');
  perform pg_temp.check(pg_temp.decide('e3a0', pg_temp.ridp('e3a5', 'e3b3'), false, null), 'error:request_not_found', 'rechazar uno de 30 días y 1 hora');

  -- 30 días: oculto y sin decidir; renovar lo trae; renovar dos veces en la hora suma una.
  update public.access_requests set asked_at = now() - interval '31 days', created_at = now() - interval '31 days'
  where id = pg_temp.ridp('e3a5', 'e3b3');
  perform pg_temp.check(pg_temp.seen('e3a0', 'e3a5'), '0', 'la lista muestra uno de 31 días');
  perform pg_temp.check(pg_temp.decide('e3a0', pg_temp.ridp('e3a5', 'e3b3'), true, 'e3b3'), 'error:request_not_found', 'aceptar uno de 31 días');
  perform pg_temp.check(pg_temp.decide('e3a0', pg_temp.ridp('e3a5', 'e3b3'), false, null), 'error:request_not_found', 'rechazar uno de 31 días');
  perform pg_temp.check(pg_temp.askp('e3a5', 'e3b3'), 'sent', 'e renueva');
  perform pg_temp.check(pg_temp.askp('e3a5', 'e3b3'), 'sent', 'e renueva otra vez');
  assert (select times from public.access_requests where id = pg_temp.ridp('e3a5', 'e3b3')) = 2, 'renovar dos veces en la hora no sumó una';
  perform pg_temp.check(pg_temp.seen('e3a0', 'e3a5'), '1', 'renovado, la lista no lo muestra');
  -- Rechazado: no se da permiso.
  perform pg_temp.check(pg_temp.decide('e3a0', pg_temp.ridp('e3a5', 'e3b3'), false, 'e3b3'), 'declined', 'rechazar a e (con página)');
  perform pg_temp.check(pg_temp.grant_of('e3a5', 'e3b3'), '(ninguno)', 'rechazar con página dio permiso');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 8. El tope: uno solo para archivos y páginas, 20 filas nuevas por persona y día
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  i int;
begin
  perform pg_temp.check(pg_temp.askp('e3a9', 'e3b1'), 'sent', 's pide P');
  for i in 1..9 loop
    perform pg_temp.check(pg_temp.askp('e3a9', gen_random_uuid()::text), 'sent', format('s pide una página al azar %s', i));
  end loop;
  for i in 1..10 loop
    perform pg_temp.check(pg_temp.askf('e3a9', gen_random_uuid()::text), 'sent', format('s pide un archivo al azar %s', i));
  end loop;
  perform pg_temp.check(pg_temp.askp('e3a9', gen_random_uuid()::text), 'error:rate_limited', 's pide la página 21');
  perform pg_temp.check(pg_temp.askf('e3a9', gen_random_uuid()::text), 'error:rate_limited', 's pide el archivo 21');
  perform pg_temp.check(pg_temp.askp('e3a9', 'e3b1'), 'sent', 's repite P con el tope lleno');
  assert (select count(*) from public.access_requests where user_id = pg_temp.u('e3a9')) = 20, 's no tiene 20 filas';
  update public.access_requests set created_at = now() - interval '25 hours' where user_id = pg_temp.u('e3a9');
  perform pg_temp.check(pg_temp.askp('e3a9', gen_random_uuid()::text), 'sent', 's pide al día siguiente');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 9. La versión de la base
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  assert (select schema_version from public.workspace_settings where id) >= 24, 'schema_version';
end;
$$;

rollback;
select 'ok' as result;
