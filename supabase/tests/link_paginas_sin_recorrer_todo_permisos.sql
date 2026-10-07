-- Pruebas de la lista de páginas con link sin recorrer todos los links
-- (20261111120000_link_paginas_sin_recorrer_todo.sql): `public_link_pages()` le da a cada sesión exactamente las filas
-- que daba la regla de siempre mirada link por link (`private.can_share` de la página y, para si anda,
-- `private.user_can_share_page` de quien lo creó), en todos los casos donde el atajo por proyecto podría equivocarse:
-- el permiso dado página por página, una página de la papelera, un proyecto borrado, un invitado, quien creó el link
-- que ya no comparte. Y no pregunta nada de más a quien no puede recibir nada. Corre dentro de una transacción que se
-- deshace al final: no deja usuarios ni datos. Si todo pasa, devuelve una fila con result = 'ok'.

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

-- Un link, puesto desde la consola (crear uno con la función pide el interruptor de lo borrado, que acá no importa).
create function pg_temp.link(id text, page text, lvl text, by text, expires timestamptz default null, revoked boolean default false)
returns void language sql security definer as $$
  insert into public.public_links (id, page_id, token, token_hash, level, created_by, created_at, expires_at, revoked_at)
  values (pg_temp.u(id), pg_temp.u(page), 'sdl_' || rpad(id, 43, 'x'), extensions.digest('sdl_' || rpad(id, 43, 'x'), 'sha256'),
          lvl, case when by is null then null else pg_temp.u(by) end, now() - interval '2 days', expires,
          case when revoked then now() end);
$$;

-- La regla de siempre, link por link: el cuerpo de 20261107120000_link_paginas_quien_comparte.sql. Solo los links de
-- la prueba (los que ya había en la base no cuentan).
create function pg_temp.reference() returns table (page_id uuid, level text, created_by_name text, alive boolean)
language sql stable security definer set search_path = '' as $$
  select pl.page_id,
         pl.level,
         (select nullif(split_part(u.email, '@', 1), '') from auth.users u where u.id = pl.created_by),
         coalesce(pl.created_by is not null and private.user_can_share_page(pl.page_id, pl.created_by), false)
  from public.public_links pl
  where pl.revoked_at is null and (pl.expires_at is null or pl.expires_at > now())
    and private.can_share(null, pl.page_id);
$$;

create function pg_temp.title(p uuid) returns text language sql security definer as $$
  select pg.title from public.pages pg where pg.id = p;
$$;

-- Lo que la lista le da a la sesión, por títulos: "A:comment:quien:true,B:…".
create function pg_temp.listed() returns text language sql as $$
  select coalesce(string_agg(format('%s:%s:%s:%s', t.title, t.level, coalesce(t.created_by_name, '-'), t.alive::text), ',' order by t.title), '')
  from (select pg_temp.title(l.page_id) as title, l.level, l.created_by_name, l.alive from public.public_link_pages() l) t;
$$;

-- Lo que una da y la otra no, para la sesión de ahora. Vacío si coinciden fila por fila.
create function pg_temp.differences() returns text language sql as $$
  select coalesce(string_agg(d.what, '; ' order by d.what), '')
  from (
    select 'sobra ' || pg_temp.title(x.page_id) || ':' || x.level || ':' || coalesce(x.created_by_name, '-') || ':' || x.alive::text as what
    from (select * from public.public_link_pages() except all select * from pg_temp.reference()) x
    union all
    select 'falta ' || pg_temp.title(x.page_id) || ':' || x.level || ':' || coalesce(x.created_by_name, '-') || ':' || x.alive::text
    from (select * from pg_temp.reference() except all select * from public.public_link_pages()) x) d;
$$;

-- Cada persona de la prueba, con cada forma de entrar: la lista coincide con la regla de siempre.
create function pg_temp.check_everyone(moment text) returns void language plpgsql as $$
declare
  who text;
begin
  foreach who in array array['e2a0', 'e2a1', 'e2a2', 'e2a3', 'e2a4', 'e2a5', 'e2a6', 'e2a7', 'e2a8', 'e2a9', 'e2aa', 'e2ab', 'e2ac'] loop
    perform pg_temp.as_user(who);
    assert pg_temp.differences() = '', format('%s, %s: %s', moment, who, pg_temp.differences());
    perform pg_temp.as_user(who, '[{"method": "password"}]');
    assert pg_temp.differences() = '' and (select count(*) from public.public_link_pages()) = 0, format('%s, %s con contraseña: %s', moment, who, pg_temp.differences());
  end loop;
  perform pg_temp.as_console();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Datos
-- ---------------------------------------------------------------------------------------------------
-- Los links que ya había en la base no son de la prueba: apagados, no entran en ninguna lista.
update public.public_links set revoked_at = now() where revoked_at is null;
-- Personas: o (dueña del workspace, creó Q), a (miembro, creó P), ad (admin, Editar y crear P), adp (admin, Editar y
-- crear solo la página S de P: el permiso dado por página), adv (admin, Ver P), m4 (miembro, Editar y crear P), g
-- (invitado, Editar y crear P), gq (invitado que creó R), c (Comentar P), x (miembro sin permiso), rm (admin, Editar y
-- crear P, sacada del workspace), ow (miembro, creó R; Editar y crear Q). El invitado g es además el dueño del
-- proyecto G (lo creó antes de ser invitado), que ad edita entero. Y ade (admin, **Editar** todo P: un nivel menos
-- que Editar y crear páginas, no comparte nada).
update public.members set removed_at = now() where role = 'owner' and removed_at is null;
update public.workspace_settings set min_app_version = null where id;
insert into auth.users (id, email, aud, role) values
  (pg_temp.u('e2a0'), 'lsr-o@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2a1'), 'lsr-a@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2a2'), 'lsr-ad@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2a3'), 'lsr-adp@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2a4'), 'lsr-adv@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2a5'), 'lsr-m4@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2a6'), 'lsr-g@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2a7'), 'lsr-gq@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2a8'), 'lsr-c@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2a9'), 'lsr-x@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2aa'), 'lsr-rm@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2ab'), 'lsr-ow@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2ac'), 'lsr-ade@test.invalid', 'authenticated', 'authenticated');
update public.workspace_settings set owner_id = pg_temp.u('e2a0') where id;
insert into public.members (user_id, role, removed_at) values
  (pg_temp.u('e2a0'), 'owner', null), (pg_temp.u('e2a1'), 'member', null), (pg_temp.u('e2a2'), 'admin', null),
  (pg_temp.u('e2a3'), 'admin', null), (pg_temp.u('e2a4'), 'admin', null), (pg_temp.u('e2a5'), 'member', null),
  (pg_temp.u('e2a6'), 'guest', null), (pg_temp.u('e2a7'), 'guest', null), (pg_temp.u('e2a8'), 'member', null),
  (pg_temp.u('e2a9'), 'member', null), (pg_temp.u('e2aa'), 'admin', now()), (pg_temp.u('e2ab'), 'member', null),
  (pg_temp.u('e2ac'), 'admin', null);
-- P (de a), Q (de o), R (de ow, con una página que creó cuando gq todavía no era invitado), D (de a, borrado).
insert into public.workspaces (id, owner_id, name) values
  (pg_temp.u('e2e0'), pg_temp.u('e2a1'), 'P'),
  (pg_temp.u('e2e1'), pg_temp.u('e2a0'), 'Q'),
  (pg_temp.u('e2e2'), pg_temp.u('e2ab'), 'R'),
  (pg_temp.u('e2e3'), pg_temp.u('e2a1'), 'D'),
  (pg_temp.u('e2e4'), pg_temp.u('e2a6'), 'G');
-- P: A (link de a), S (link de adp) con T adentro (link de ad) y U adentro de T (link de m4, que no comparte), V (en la
-- papelera, link de a) con W adentro (link de adp, que ahí no llega), X (link de una cuenta borrada), Y (vencido), Z
-- (apagado). Q: K (link de o), L (link de ow, que edita Q sin ser admin ni dueño). R: M (link de ow), N (link de gq,
-- invitado). D: O (link de a). G: GG (link de g, invitado y dueño del proyecto: no anda). Y en P, dos links de admins
-- a los que el proyecto entero no les alcanza para compartir: VV (de adv, que solo lo ve) y EE (de ade, que lo edita):
-- ninguno anda.
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  (pg_temp.u('e2b0'), pg_temp.u('e2e0'), null, 'A', 'a0'),
  (pg_temp.u('e2b1'), pg_temp.u('e2e0'), null, 'S', 'a1'),
  (pg_temp.u('e2b2'), pg_temp.u('e2e0'), pg_temp.u('e2b1'), 'T', 'a0'),
  (pg_temp.u('e2b3'), pg_temp.u('e2e0'), pg_temp.u('e2b2'), 'U', 'a0'),
  (pg_temp.u('e2b4'), pg_temp.u('e2e0'), null, 'V', 'a2'),
  (pg_temp.u('e2b5'), pg_temp.u('e2e0'), pg_temp.u('e2b4'), 'W', 'a0'),
  (pg_temp.u('e2b6'), pg_temp.u('e2e0'), null, 'X', 'a3'),
  (pg_temp.u('e2b7'), pg_temp.u('e2e0'), null, 'Y', 'a4'),
  (pg_temp.u('e2b8'), pg_temp.u('e2e0'), null, 'Z', 'a5'),
  (pg_temp.u('e2b9'), pg_temp.u('e2e1'), null, 'K', 'a0'),
  (pg_temp.u('e2ba'), pg_temp.u('e2e1'), null, 'L', 'a1'),
  (pg_temp.u('e2bb'), pg_temp.u('e2e2'), null, 'M', 'a0'),
  (pg_temp.u('e2bc'), pg_temp.u('e2e2'), null, 'N', 'a1'),
  (pg_temp.u('e2bd'), pg_temp.u('e2e3'), null, 'O', 'a0'),
  (pg_temp.u('e2be'), pg_temp.u('e2e4'), null, 'GG', 'a0'),
  (pg_temp.u('e2bf'), pg_temp.u('e2e0'), null, 'VV', 'a6'),
  (pg_temp.u('e2f0'), pg_temp.u('e2e0'), null, 'EE', 'a7');
update public.pages set deleted_at = now() where id = pg_temp.u('e2b4');
insert into public.grants (user_id, project_id, page_id, level) values
  (pg_temp.u('e2a2'), pg_temp.u('e2e0'), null, 'edit_pages'),
  (pg_temp.u('e2a2'), pg_temp.u('e2e4'), null, 'edit_pages'),
  (pg_temp.u('e2a3'), null, pg_temp.u('e2b1'), 'edit_pages'),
  (pg_temp.u('e2a3'), null, pg_temp.u('e2b5'), 'edit'),
  (pg_temp.u('e2a4'), pg_temp.u('e2e0'), null, 'view'),
  (pg_temp.u('e2a5'), pg_temp.u('e2e0'), null, 'edit_pages'),
  (pg_temp.u('e2a6'), pg_temp.u('e2e0'), null, 'edit_pages'),
  (pg_temp.u('e2a7'), pg_temp.u('e2e2'), null, 'edit_pages'),
  (pg_temp.u('e2a8'), pg_temp.u('e2e0'), null, 'comment'),
  (pg_temp.u('e2aa'), pg_temp.u('e2e0'), null, 'edit_pages'),
  (pg_temp.u('e2ab'), pg_temp.u('e2e1'), null, 'edit_pages'),
  (pg_temp.u('e2a0'), pg_temp.u('e2e2'), null, 'view'),
  (pg_temp.u('e2ac'), pg_temp.u('e2e0'), null, 'edit');
select pg_temp.link('e2c0', 'e2b0', 'comment', 'e2a1');
select pg_temp.link('e2c1', 'e2b1', 'edit', 'e2a3');
select pg_temp.link('e2c2', 'e2b2', 'comment', 'e2a2');
select pg_temp.link('e2c3', 'e2b3', 'comment', 'e2a5');
select pg_temp.link('e2c4', 'e2b4', 'comment', 'e2a1');
select pg_temp.link('e2c5', 'e2b5', 'edit', 'e2a3');
select pg_temp.link('e2c6', 'e2b6', 'edit', null);
select pg_temp.link('e2c7', 'e2b7', 'comment', 'e2a1', now() - interval '1 hour');
select pg_temp.link('e2c8', 'e2b8', 'comment', 'e2a1', null, true);
select pg_temp.link('e2c9', 'e2b9', 'comment', 'e2a0', now() + interval '1 day');
select pg_temp.link('e2ca', 'e2ba', 'comment', 'e2ab');
select pg_temp.link('e2cb', 'e2bb', 'edit', 'e2ab');
select pg_temp.link('e2cc', 'e2bc', 'comment', 'e2a7');
select pg_temp.link('e2cd', 'e2bd', 'comment', 'e2a1');
select pg_temp.link('e2ce', 'e2be', 'comment', 'e2a6');
select pg_temp.link('e2cf', 'e2bf', 'comment', 'e2a4');
select pg_temp.link('e2d0', 'e2f0', 'comment', 'e2ac');
update public.workspaces set deleted_at = now(), deleted_by = pg_temp.u('e2a1') where id = pg_temp.u('e2e3');

-- ---------------------------------------------------------------------------------------------------
-- La función sigue siendo la misma hacia afuera.
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  f constant regprocedure := 'public.public_link_pages()'::regprocedure;
begin
  assert (select p.proargnames = array['page_id', 'level', 'created_by_name', 'alive']
                 and p.proallargtypes = array['uuid'::regtype, 'text'::regtype, 'text'::regtype, 'boolean'::regtype]::oid[]
          from pg_proc p where p.oid = f), 'cambiaron las columnas';
  assert (select p.prosecdef and p.provolatile = 's' and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = f),
    'no es security definer, stable y con search_path vacío';
  assert has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute'), 'cambió quién la ejecuta';
  assert not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = f and a.grantee = 0), 'PUBLIC la ejecuta';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Cada persona: lo que daba la regla de siempre.
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.check_everyone('al empezar');

  -- Y dicho en limpio, para que la comparación no pase por dar las dos vacías.
  -- a creó P: todo lo vivo de P (también en la papelera); el de m4 y el de la cuenta borrada no andan; W sí (adp es
  -- admin... pero ahí tiene solo Editar: no anda).
  perform pg_temp.as_user('e2a1');
  assert pg_temp.listed() = 'A:comment:lsr-a:true,EE:comment:lsr-ade:false,S:edit:lsr-adp:true,T:comment:lsr-ad:true,U:comment:lsr-m4:false,V:comment:lsr-a:true,VV:comment:lsr-adv:false,W:edit:lsr-adp:false,X:edit:-:false',
    format('la creadora de P recibe %s', pg_temp.listed());
  -- ad, admin con Editar y crear sobre P: lo mismo, más lo de G (el link de su dueño, que es invitado, no anda).
  perform pg_temp.as_user('e2a2');
  assert pg_temp.listed() = 'A:comment:lsr-a:true,EE:comment:lsr-ade:false,GG:comment:lsr-g:false,S:edit:lsr-adp:true,T:comment:lsr-ad:true,U:comment:lsr-m4:false,V:comment:lsr-a:true,VV:comment:lsr-adv:false,W:edit:lsr-adp:false,X:edit:-:false',
    format('el admin con todo P recibe %s', pg_temp.listed());
  -- adp, admin con el permiso solo sobre S: S y lo de adentro. No A ni X (del mismo proyecto), ni W (ahí solo edita,
  -- y está en la papelera).
  perform pg_temp.as_user('e2a3');
  assert pg_temp.listed() = 'S:edit:lsr-adp:true,T:comment:lsr-ad:true,U:comment:lsr-m4:false', format('el admin con una página recibe %s', pg_temp.listed());
  -- o, dueña del workspace: lo de Q (el link de ow no anda: edita Q pero no es admin ni lo creó). De R, que solo ve, nada.
  perform pg_temp.as_user('e2a0');
  assert pg_temp.listed() = 'K:comment:lsr-o:true,L:comment:lsr-ow:false', format('la dueña recibe %s', pg_temp.listed());
  -- ow, miembro que creó R: lo de R (el del invitado no anda). De Q, que edita sin haberlo creado, nada.
  perform pg_temp.as_user('e2ab');
  assert pg_temp.listed() = 'M:edit:lsr-ow:true,N:comment:lsr-gq:false', format('el miembro que creó R recibe %s', pg_temp.listed());
  -- Nada: el admin que solo ve P, el miembro con Editar y crear, los invitados, quien comenta, quien no tiene nada y
  -- la sacada.
  perform pg_temp.as_user('e2a4');
  assert (select count(*) from public.public_link_pages()) = 0, 'el admin que solo ve recibe la lista';
  -- El admin con Editar sobre todo P: tampoco (compartir pide Editar y crear páginas, un nivel más).
  perform pg_temp.as_user('e2ac');
  assert (select count(*) from public.public_link_pages()) = 0, 'el admin con Editar sobre el proyecto entero recibe la lista';
  assert private.project_level(pg_temp.u('e2e0')) = 3, 'el admin con Editar no tiene nivel 3 sobre el proyecto';
  perform pg_temp.as_user('e2a5');
  assert (select count(*) from public.public_link_pages()) = 0, 'el miembro con Editar y crear recibe la lista';
  perform pg_temp.as_user('e2a6');
  assert (select count(*) from public.public_link_pages()) = 0, 'el invitado recibe la lista';
  perform pg_temp.as_user('e2aa');
  assert (select count(*) from public.public_link_pages()) = 0, 'la sacada recibe la lista';
  -- Una sesión sin persona.
  perform set_config('request.jwt.claims', '{"role": "authenticated"}', true);
  assert (select count(*) from public.public_link_pages()) = 0, 'una sesión sin persona recibe la lista';
  perform pg_temp.as_console();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Lo que cambia: roles, permisos, la papelera y los proyectos borrados. Siempre lo que da la regla de siempre.
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  -- El invitado que creó N pasa a admin (su link anda y recibe R... si lo edita entero: sí); m4 pasa a admin (su link
  -- de U anda y recibe P); adp baja a miembro (ya no comparte S); la sacada vuelve.
  update public.members set role = 'admin' where user_id in (pg_temp.u('e2a7'), pg_temp.u('e2a5'));
  update public.members set role = 'member' where user_id = pg_temp.u('e2a3');
  update public.members set removed_at = null where user_id = pg_temp.u('e2aa');
  perform pg_temp.check_everyone('con los roles cambiados');
  perform pg_temp.as_user('e2a5');
  assert pg_temp.listed() = 'A:comment:lsr-a:true,EE:comment:lsr-ade:false,S:edit:lsr-adp:false,T:comment:lsr-ad:true,U:comment:lsr-m4:true,V:comment:lsr-a:true,VV:comment:lsr-adv:false,W:edit:lsr-adp:false,X:edit:-:false',
    format('el que pasó a admin recibe %s', pg_temp.listed());
  perform pg_temp.as_user('e2a3');
  assert (select count(*) from public.public_link_pages()) = 0, 'quien bajó a miembro sigue recibiendo la lista';
  perform pg_temp.as_console();

  -- S va a la papelera (con T y U adentro), V vuelve, ad pierde el proyecto y queda con Editar y crear solo en T, y a
  -- la dueña le dan Editar y crear sobre R.
  update public.pages set deleted_at = now() where id = pg_temp.u('e2b1');
  update public.pages set deleted_at = null where id = pg_temp.u('e2b4');
  update public.grants set revoked_at = now() where user_id = pg_temp.u('e2a2') and project_id = pg_temp.u('e2e0');
  insert into public.grants (user_id, project_id, page_id, level) values (pg_temp.u('e2a2'), null, pg_temp.u('e2b2'), 'edit_pages');
  update public.grants set level = 'edit_pages' where user_id = pg_temp.u('e2a0') and project_id = pg_temp.u('e2e2');
  perform pg_temp.check_everyone('con la papelera y los permisos cambiados');
  perform pg_temp.as_user('e2a2');
  assert pg_temp.listed() = 'GG:comment:lsr-g:false,T:comment:lsr-ad:true,U:comment:lsr-m4:true', format('el admin que quedó con una página recibe %s', pg_temp.listed());
  perform pg_temp.as_user('e2a0');
  assert pg_temp.listed() = 'K:comment:lsr-o:true,L:comment:lsr-ow:false,M:edit:lsr-ow:true,N:comment:lsr-gq:true', format('la dueña con R recibe %s', pg_temp.listed());
  perform pg_temp.as_console();

  -- Quien creó P sale del workspace (sus links dejan de andar); P se borra y D vuelve; un link vence y otro se apaga.
  update public.members set removed_at = now() where user_id = pg_temp.u('e2a1');
  perform pg_temp.check_everyone('con la creadora de P afuera');
  update public.members set removed_at = null where user_id = pg_temp.u('e2a1');
  update public.workspaces set deleted_at = now(), deleted_by = pg_temp.u('e2a1') where id = pg_temp.u('e2e0');
  update public.workspaces set deleted_at = null, deleted_by = null where id = pg_temp.u('e2e3');
  update public.public_links set expires_at = now() - interval '1 second' where id = pg_temp.u('e2c9');
  update public.public_links set revoked_at = now() where id = pg_temp.u('e2cb');
  perform pg_temp.check_everyone('con P borrado y D de vuelta');
  perform pg_temp.as_user('e2a1');
  assert pg_temp.listed() = 'O:comment:lsr-a:true', format('con P borrado su creadora recibe %s', pg_temp.listed());
  perform pg_temp.as_user('e2a0');
  assert pg_temp.listed() = 'L:comment:lsr-ow:false,N:comment:lsr-gq:true', format('con uno vencido y uno apagado la dueña recibe %s', pg_temp.listed());
  perform pg_temp.as_console();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- El trabajo: quien no puede recibir nada no hace mirar ningún permiso de página.
-- ---------------------------------------------------------------------------------------------------
create function pg_temp.page_level_calls() returns bigint language sql as $$
  select coalesce(nullif(current_setting('test.page_level_calls', true), ''), '0')::bigint;
$$;

-- `private.user_page_level` es lo caro (la cadena de páginas de arriba): se cuenta cuántas veces corre, poniéndole
-- adelante, solo para esta parte de la prueba, una función con su nombre que cuenta y llama a la de verdad.
alter function private.user_page_level(uuid, uuid) rename to user_page_level_de_verdad;
create function private.user_page_level(p uuid, uid uuid) returns int
language plpgsql stable security definer set search_path = '' as $$
begin
  perform set_config('test.page_level_calls', (pg_temp.page_level_calls() + 1)::text, true);
  return private.user_page_level_de_verdad(p, uid);
end;
$$;
revoke all on function private.user_page_level(uuid, uuid) from public, anon, authenticated;

do $$
declare
  before bigint;
  mine   bigint;
  who    text;
begin
  -- El miembro sin permisos, quien comenta, el invitado y el miembro que no creó ningún proyecto con links: ninguna.
  foreach who in array array['e2a9', 'e2a8', 'e2a6', 'e2a3'] loop
    perform pg_temp.as_user(who);
    before := pg_temp.page_level_calls();
    perform count(*) from public.public_link_pages();
    assert pg_temp.page_level_calls() = before, format('%s hace mirar %s permisos de página', who, pg_temp.page_level_calls() - before);
  end loop;
  -- La dueña, con todo Q y todo R: de esos dos proyectos no mira ninguna página (alcanza el proyecto); solo las de D
  -- y G, donde no tiene nada, y la de quien creó un link sin compartir el proyecto entero. La regla de siempre mira
  -- una por link y otra por cada link que pasa.
  perform pg_temp.as_user('e2a0');
  before := pg_temp.page_level_calls();
  perform count(*) from public.public_link_pages();
  mine := pg_temp.page_level_calls() - before;
  before := pg_temp.page_level_calls();
  perform count(*) from pg_temp.reference();
  -- (Trece links vivos, los nueve de P borrado incluidos, y los dos que pasan.)
  assert pg_temp.page_level_calls() - before = 15, format('la regla de siempre mira %s permisos de página y se esperaban 15', pg_temp.page_level_calls() - before);
  assert mine = 3, format('la dueña hace mirar %s permisos de página y se esperaban 3', mine);
  perform pg_temp.as_console();
end;
$$;

rollback;

select 'ok' as result;
