-- Pruebas de la lista de páginas con link público (20261107120000_link_paginas_quien_comparte.sql): `public_link_pages()`
-- contesta solo con las páginas que la sesión puede compartir (la regla de `get_public_link`), con el nivel, quién creó
-- el link y si anda, y nunca el token. Quien ve la página sin poder compartirla (Ver, Comentar, Editar y crear sin ser
-- admin ni dueño del proyecto, un invitado, un admin que solo la ve) no recibe nada. Corre dentro de una transacción
-- que se deshace al final: no deja usuarios ni datos. Si todo pasa, devuelve una fila con result = 'ok'.

begin;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-00000000' || s)::uuid;
$$;

-- La sesión de una persona. `amr`: cómo entró (con contraseña no es miembro de nada).
create function pg_temp.as_user(s text, amr jsonb default '[{"method": "otp"}]') returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', pg_temp.u(s), 'role', 'authenticated', 'aal', 'aal1', 'amr', amr)::text, true),
         set_config('request.headers', '{"x-shotdocs-version": "9.999"}', true);
$$;

create function pg_temp.as_console() returns void language sql as $$
  select set_config('role', 'postgres', true),
         set_config('request.jwt.claims', '', true),
         set_config('request.headers', '', true);
$$;

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

-- Un link, puesto desde la consola (crear uno con la función pide el interruptor de lo borrado, que acá no importa).
create function pg_temp.link(id text, page text, lvl text, by text, expires timestamptz default null, revoked boolean default false)
returns void language sql security definer as $$
  insert into public.public_links (id, page_id, token, token_hash, level, created_by, created_at, expires_at, revoked_at)
  values (pg_temp.u(id), pg_temp.u(page), 'sdl_' || rpad(id, 43, 'x'), extensions.digest('sdl_' || rpad(id, 43, 'x'), 'sha256'),
          lvl, case when by is null then null else pg_temp.u(by) end, now() - interval '2 days', expires,
          case when revoked then now() end);
$$;

create function pg_temp.title(p uuid) returns text language sql security definer as $$
  select pg.title from public.pages pg where pg.id = p;
$$;
create function pg_temp.test_pages() returns table (id uuid) language sql security definer as $$
  select pg.id from public.pages pg where pg.workspace_id in (pg_temp.u('e1e0'), pg_temp.u('e1e1'));
$$;

-- Lo que la lista le da a la sesión, por títulos: "A:comment:quien:true,B:…".
create function pg_temp.listed() returns text language sql as $$
  select coalesce(string_agg(format('%s:%s:%s:%s', t.title, t.level, coalesce(t.created_by_name, '-'), t.alive::text), ',' order by t.title), '')
  from (select pg_temp.title(l.page_id) as title, l.level, l.created_by_name, l.alive from public.public_link_pages() l) t;
$$;

-- Lo mismo, armado con `get_public_link` de cada página de la prueba (lo que muestra *Share*): tienen que coincidir.
create function pg_temp.by_share() returns text language sql as $$
  select coalesce(string_agg(format('%s:%s:%s:%s', pg_temp.title(p.id), g.j ->> 'level', coalesce(g.j ->> 'created_by_name', '-'),
                                    g.j ->> 'alive'), ',' order by pg_temp.title(p.id)), '')
  from (select id from pg_temp.test_pages()) p
  cross join lateral (select public.get_public_link(p.id) -> 'link' as j) g
  where jsonb_typeof(g.j) = 'object'
    and ((g.j ->> 'expires_at') is null or (g.j ->> 'expires_at')::timestamptz > now());
$$;

-- ---------------------------------------------------------------------------------------------------
-- Datos
-- ---------------------------------------------------------------------------------------------------
-- Personas: o (dueña del workspace, creó Q), a (miembro, creó P), ad (admin, Editar y crear P), adv (admin, Ver P),
-- m4 (miembro, Editar y crear P: ni admin ni creó P), g (invitado, Editar y crear P), c (Comentar P), v (Ver la página
-- A), x (sin permiso), rm (admin, Editar y crear P, sacada del workspace).
update public.members set removed_at = now() where role = 'owner' and removed_at is null;
update public.workspace_settings set min_app_version = null where id;
insert into auth.users (id, email, aud, role) values
  (pg_temp.u('e1a0'), 'lpq-o@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e1a1'), 'lpq-a@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e1a2'), 'lpq-ad@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e1a3'), 'lpq-adv@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e1a4'), 'lpq-m4@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e1a5'), 'lpq-g@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e1a6'), 'lpq-c@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e1a7'), 'lpq-v@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e1a8'), 'lpq-x@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e1a9'), 'lpq-rm@test.invalid', 'authenticated', 'authenticated');
update public.workspace_settings set owner_id = pg_temp.u('e1a0') where id;
insert into public.members (user_id, role, removed_at) values
  (pg_temp.u('e1a0'), 'owner', null), (pg_temp.u('e1a1'), 'member', null), (pg_temp.u('e1a2'), 'admin', null),
  (pg_temp.u('e1a3'), 'admin', null), (pg_temp.u('e1a4'), 'member', null), (pg_temp.u('e1a5'), 'guest', null),
  (pg_temp.u('e1a6'), 'member', null), (pg_temp.u('e1a7'), 'member', null), (pg_temp.u('e1a8'), 'member', null),
  (pg_temp.u('e1a9'), 'admin', now());
insert into public.workspaces (id, owner_id, name) values
  (pg_temp.u('e1e0'), pg_temp.u('e1a1'), 'P'),
  (pg_temp.u('e1e1'), pg_temp.u('e1a0'), 'Q');
-- P: A (link Can view de a), B (Can edit de ad), C (vencido), D (revocado), E (en la papelera, con link), F (de m4, que
-- no puede compartir: no anda), G (de una cuenta borrada: no anda), H (sin link). Q: K (link de o).
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  (pg_temp.u('e1b0'), pg_temp.u('e1e0'), null, 'A', 'a0'),
  (pg_temp.u('e1b1'), pg_temp.u('e1e0'), null, 'B', 'a1'),
  (pg_temp.u('e1b2'), pg_temp.u('e1e0'), null, 'C', 'a2'),
  (pg_temp.u('e1b3'), pg_temp.u('e1e0'), null, 'D', 'a3'),
  (pg_temp.u('e1b4'), pg_temp.u('e1e0'), null, 'E', 'a4'),
  (pg_temp.u('e1b5'), pg_temp.u('e1e0'), null, 'F', 'a5'),
  (pg_temp.u('e1b6'), pg_temp.u('e1e0'), null, 'G', 'a6'),
  (pg_temp.u('e1b7'), pg_temp.u('e1e0'), null, 'H', 'a7'),
  (pg_temp.u('e1b8'), pg_temp.u('e1e1'), null, 'K', 'a0');
update public.pages set deleted_at = now() where id = pg_temp.u('e1b4');
insert into public.grants (user_id, project_id, page_id, level) values
  (pg_temp.u('e1a2'), pg_temp.u('e1e0'), null, 'edit_pages'),
  (pg_temp.u('e1a3'), pg_temp.u('e1e0'), null, 'view'),
  (pg_temp.u('e1a4'), pg_temp.u('e1e0'), null, 'edit_pages'),
  (pg_temp.u('e1a5'), pg_temp.u('e1e0'), null, 'edit_pages'),
  (pg_temp.u('e1a6'), pg_temp.u('e1e0'), null, 'comment'),
  (pg_temp.u('e1a7'), null, pg_temp.u('e1b0'), 'view'),
  (pg_temp.u('e1a9'), pg_temp.u('e1e0'), null, 'edit_pages');
select pg_temp.link('e1c0', 'e1b0', 'comment', 'e1a1');
select pg_temp.link('e1c1', 'e1b1', 'edit', 'e1a2');
select pg_temp.link('e1c2', 'e1b2', 'comment', 'e1a1', now() - interval '1 hour');
select pg_temp.link('e1c3', 'e1b3', 'comment', 'e1a1', null, true);
select pg_temp.link('e1c4', 'e1b4', 'comment', 'e1a1');
select pg_temp.link('e1c5', 'e1b5', 'comment', 'e1a4');
select pg_temp.link('e1c6', 'e1b6', 'edit', null);
select pg_temp.link('e1c7', 'e1b8', 'comment', 'e1a0', now() + interval '1 day');

-- ---------------------------------------------------------------------------------------------------
-- La función: lo que devuelve, cómo corre y quién la ejecuta.
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  f constant regprocedure := 'public.public_link_pages()'::regprocedure;
begin
  assert (select p.proargnames = array['page_id', 'level', 'created_by_name', 'alive'] from pg_proc p where p.oid = f),
    'las columnas no son page_id, level, created_by_name, alive (page_id primero: la app publicada lee solo esa)';
  assert (select p.prosecdef and p.provolatile = 's' and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = f),
    'no es security definer, stable y con search_path vacío';
  assert has_function_privilege('authenticated', f, 'execute'), 'authenticated no la ejecuta';
  assert not has_function_privilege('anon', f, 'execute'), 'anon la ejecuta';
  assert not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = f and a.grantee = 0), 'PUBLIC la ejecuta';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Quien comparte: sus páginas con link vivo, con el nivel, quién lo creó y si anda. Igual que *Share*.
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  expected constant text := 'A:comment:lpq-a:true,B:edit:lpq-ad:true,E:comment:lpq-a:true,F:comment:lpq-m4:false,G:edit:-:false';
begin
  -- Quien creó el proyecto: los vivos de P (también el de la página en la papelera, que ve), sin el vencido, el
  -- revocado, la página sin link ni lo de Q.
  perform pg_temp.as_user('e1a1');
  assert pg_temp.listed() = expected, format('la creadora del proyecto recibe %s', pg_temp.listed());
  assert pg_temp.listed() = pg_temp.by_share(), format('la lista no coincide con Share: %s / %s', pg_temp.listed(), pg_temp.by_share());
  -- La app publicada lee solo `page_id`.
  assert (select count(*) from (select page_id from public.public_link_pages()) q) = 5, 'pedir solo page_id no anda';
  -- Nunca el token ni el id del link.
  assert (select bool_and(to_jsonb(l) ?& array['page_id', 'level', 'created_by_name', 'alive']
                          and (select count(*) from jsonb_object_keys(to_jsonb(l))) = 4
                          and to_jsonb(l)::text !~ 'sdl_') from public.public_link_pages() l), 'una fila trae algo más';

  -- Un admin con Editar y crear páginas sobre P: lo mismo.
  perform pg_temp.as_user('e1a2');
  assert pg_temp.listed() = expected, format('el admin que comparte recibe %s', pg_temp.listed());
  assert pg_temp.listed() = pg_temp.by_share(), 'la lista del admin no coincide con Share';

  -- La dueña del workspace no ve P (es privado de otra persona): solo lo de Q, con su vencimiento a futuro.
  perform pg_temp.as_user('e1a0');
  assert pg_temp.listed() = 'K:comment:lpq-o:true', format('la dueña recibe %s', pg_temp.listed());
  assert pg_temp.listed() = pg_temp.by_share(), 'la lista de la dueña no coincide con Share';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Quien ve la página y no la comparte: nada (antes recibía la fila).
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  who text;
begin
  -- adv: admin que solo ve P. m4: Editar y crear sin ser admin ni haber creado P. g: invitado con Editar y crear.
  -- c: Comentar. v: Ver la página A. x: sin permiso. rm: admin sacada del workspace.
  foreach who in array array['e1a3', 'e1a4', 'e1a5', 'e1a6', 'e1a7', 'e1a8', 'e1a9'] loop
    perform pg_temp.as_user(who);
    assert (select count(*) from public.public_link_pages()) = 0, format('%s recibe páginas con link', who);
    assert pg_temp.by_share() = '', format('%s lee un link con get_public_link', who);
  end loop;
  -- Las que ven la página la siguen viendo: lo que cambia es solo la lista.
  perform pg_temp.as_user('e1a3');
  assert private.page_level(pg_temp.u('e1b0')) = 1, 'el admin con Ver dejó de ver la página';
  perform pg_temp.as_user('e1a5');
  assert private.page_level(pg_temp.u('e1b0')) = 4, 'el invitado perdió su permiso';
  perform pg_temp.as_user('e1a7');
  assert private.page_level(pg_temp.u('e1b0')) = 1, 'quien tiene Ver dejó de ver la página';

  -- Con contraseña, la que comparte no es miembro de nada.
  perform pg_temp.as_user('e1a1', '[{"method": "password"}]');
  assert (select count(*) from public.public_link_pages()) = 0, 'una sesión con contraseña recibe páginas con link';
  -- Una sesión sin persona.
  perform set_config('request.jwt.claims', '{"role": "authenticated"}', true);
  assert (select count(*) from public.public_link_pages()) = 0, 'una sesión sin persona recibe páginas con link';

  -- anon no la llama, tampoco con el header de un link.
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  perform pg_temp.expect_error('select * from public.public_link_pages()', '42501', 'anon llama a la lista');
  perform set_config('request.headers', json_build_object('x-shotdocs-link', 'sdl_' || rpad('e1c0', 43, 'x'))::text, true);
  perform pg_temp.expect_error('select * from public.public_link_pages()', '42501', 'un link llama a la lista');
  perform pg_temp.as_console();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Lo que cambia con el tiempo y con los permisos.
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  -- El invitado pasa a miembro: con Editar y crear sigue sin compartir. Pasa a admin: comparte y recibe la lista.
  update public.members set role = 'member' where user_id = pg_temp.u('e1a5');
  perform pg_temp.as_user('e1a5');
  assert (select count(*) from public.public_link_pages()) = 0, 'un miembro con Editar y crear recibe la lista';
  perform pg_temp.as_console();
  update public.members set role = 'admin' where user_id = pg_temp.u('e1a5');
  perform pg_temp.as_user('e1a5');
  assert (select count(*) from public.public_link_pages()) = 5, 'un admin con Editar y crear no recibe la lista';
  perform pg_temp.as_console();

  -- m4 pasa a admin: su link (F) anda. La que creó A sale del workspace: A deja de andar para quien sigue compartiendo.
  update public.members set role = 'admin' where user_id = pg_temp.u('e1a4');
  update public.members set removed_at = now() where user_id = pg_temp.u('e1a1');
  perform pg_temp.as_user('e1a2');
  assert pg_temp.listed() = 'A:comment:lpq-a:false,B:edit:lpq-ad:true,E:comment:lpq-a:false,F:comment:lpq-m4:true,G:edit:-:false',
    format('después de los cambios el admin recibe %s', pg_temp.listed());
  assert pg_temp.listed() = pg_temp.by_share(), 'después de los cambios la lista no coincide con Share';
  perform pg_temp.as_user('e1a1');
  assert (select count(*) from public.public_link_pages()) = 0, 'la sacada recibe la lista';
  perform pg_temp.as_console();

  -- Un link que vence y uno que se revoca salen; el proyecto borrado no lista nada.
  update public.public_links set expires_at = now() - interval '1 second' where id = pg_temp.u('e1c1');
  update public.public_links set revoked_at = now() where id = pg_temp.u('e1c5');
  perform pg_temp.as_user('e1a2');
  assert pg_temp.listed() = 'A:comment:lpq-a:false,E:comment:lpq-a:false,G:edit:-:false', format('con uno vencido y uno revocado recibe %s', pg_temp.listed());
  perform pg_temp.as_console();
  update public.workspaces set deleted_at = now(), deleted_by = pg_temp.u('e1a2') where id = pg_temp.u('e1e0');
  perform pg_temp.as_user('e1a2');
  assert (select count(*) from public.public_link_pages()) = 0, 'un proyecto borrado lista sus links';
  perform pg_temp.as_console();
end;
$$;

rollback;

select 'ok' as result;
