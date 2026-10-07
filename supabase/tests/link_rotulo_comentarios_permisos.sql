-- Pruebas de `public_link_labels` (20261113120000_link_rotulo_comentarios.sql): de un link, por su id, el nivel, quién
-- lo creó y cómo está (apagado, vencido, si anda), **solo a quien puede compartir su página raíz** (la regla de
-- `get_public_link`), y nunca el token. Quien no la comparte (Ver, Comentar, Editar, Editar y crear sin ser admin ni
-- dueño del proyecto, sobre el proyecto, una rama o una página, un invitado, un admin que solo ve, alguien sacado,
-- una sesión con contraseña, `anon`) no recibe nada, y un link que no existe se contesta igual. La función mira el
-- permiso una vez por proyecto: para cada sesión el resultado tiene que ser el de la regla mirada link por link, y
-- quien no comparte nada en un proyecto no hace mirar ningún permiso de página (un link ajeno cuesta como uno que no
-- existe). Corre dentro de una transacción que se deshace al final: no deja usuarios ni datos. Si todo pasa, devuelve
-- una fila con result = 'ok'.

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

-- Todos los links de la prueba, más uno que no existe.
create function pg_temp.all_links() returns uuid[] language sql immutable as $$
  select array[pg_temp.u('e2c0'), pg_temp.u('e2c1'), pg_temp.u('e2c2'), pg_temp.u('e2c3'), pg_temp.u('e2c4'), pg_temp.u('e2c5'),
               pg_temp.u('e2c6'), pg_temp.u('e2c7'), pg_temp.u('e2c8'), pg_temp.u('e2c9'), pg_temp.u('e2ca'), pg_temp.u('e2cb'), pg_temp.u('e2cc'), pg_temp.u('e2cf')];
$$;

-- Una fila en palabras: "c0:comment:quien:" y tres marcas (r apagado, e vencido, a anda).
create function pg_temp.row_text(id uuid, lvl text, by_name text, revoked boolean, expired boolean, alive boolean)
returns text language sql immutable as $$
  select format('%s:%s:%s:%s%s%s', right(id::text, 2), lvl, coalesce(by_name, '-'),
                case when revoked then 'r' else '-' end, case when expired then 'e' else '-' end, case when alive then 'a' else '-' end);
$$;

-- Lo que la función le da a la sesión por estos ids (sin ids: todos los de la prueba).
create function pg_temp.labels(ids uuid[] default null) returns text language sql as $$
  select coalesce(string_agg(pg_temp.row_text(l.id, l.level, l.created_by_name, l.revoked, l.expired, l.alive), ',' order by l.id), '')
  from public.public_link_labels(coalesce(ids, pg_temp.all_links())) l;
$$;

-- Lo mismo armado desde la consola con la regla de siempre, link por link (`private.user_can_share_page`): tienen que
-- coincidir. Si la regla de compartir cambia y la función no la sigue, falla.
create function pg_temp.by_rule(who text) returns text language sql security definer as $$
  select coalesce(string_agg(pg_temp.row_text(
           pl.id, pl.level, (select nullif(split_part(u.email, '@', 1), '') from auth.users u where u.id = pl.created_by),
           pl.revoked_at is not null, pl.expires_at is not null and pl.expires_at <= now(),
           pl.revoked_at is null and (pl.expires_at is null or pl.expires_at > now()) and pl.created_by is not null
             and private.user_can_share_page(pl.page_id, pl.created_by)), ',' order by pl.id), '')
  from public.public_links pl
  where pl.id = any (pg_temp.all_links()) and private.user_can_share_page(pl.page_id, pg_temp.u(who));
$$;

-- Las páginas de la prueba que tienen algún link, y sus links.
create function pg_temp.linked_pages() returns table (page_id uuid, ids uuid[]) language sql security definer as $$
  select pl.page_id, array_agg(pl.id) from public.public_links pl where pl.id = any (pg_temp.all_links()) group by pl.page_id;
$$;

-- La misma regla que *Share*: de cada página con links, la función da todos sus links si `get_public_link` le contesta
-- a la sesión, y ninguno si no.
create function pg_temp.same_as_share() returns boolean language sql as $$
  select coalesce(bool_and(
    (select count(*) from public.public_link_labels(p.ids)) =
      case when public.get_public_link(p.page_id) is not null then cardinality(p.ids) else 0 end), false)
  from pg_temp.linked_pages() p;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Datos
-- ---------------------------------------------------------------------------------------------------
-- Personas: o (dueña del workspace, creó Q), a (miembro, creó P y Z), ad (admin, Editar y crear P), adv (admin, Ver P),
-- m4 (miembro, Editar y crear P), g (invitado, Editar y crear P), c (Comentar P), v (Ver la página A), x (sin permiso),
-- rm (admin, Editar y crear P, sacada del workspace), adp (admin, Editar y crear solo la rama R), mb (miembro, Editar y
-- crear la rama R), mp (miembro, Editar y crear la página A), ed (miembro, Editar P), adl (admin, Editar y crear solo
-- la hoja R1), ade (admin, Editar P entero), adm (admin, Editar P entero y Editar y crear la hoja R1), mc (miembro, creó
-- S, con Editar y crear P), adq (admin, Editar y crear solo la página K de Q), gc (invitado que creó el proyecto V cuando
-- era miembro).
update public.members set removed_at = now() where role = 'owner' and removed_at is null;
update public.workspace_settings set min_app_version = null where id;
insert into auth.users (id, email, aud, role) values
  (pg_temp.u('e2a0'), 'lrc-o@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2a1'), 'lrc-a@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2a2'), 'lrc-ad@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2a3'), 'lrc-adv@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2a4'), 'lrc-m4@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2a5'), 'lrc-g@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2a6'), 'lrc-c@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2a7'), 'lrc-v@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2a8'), 'lrc-x@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2a9'), 'lrc-rm@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2aa'), 'lrc-adp@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2ab'), 'lrc-mb@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2ac'), 'lrc-mp@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2ad'), 'lrc-ed@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2ae'), 'lrc-adl@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2af'), 'lrc-ade@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2d0'), 'lrc-adm@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2d1'), 'lrc-mc@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2d2'), 'lrc-adq@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('e2d3'), 'lrc-gc@test.invalid', 'authenticated', 'authenticated');
update public.workspace_settings set owner_id = pg_temp.u('e2a0') where id;
insert into public.members (user_id, role, removed_at) values
  (pg_temp.u('e2a0'), 'owner', null), (pg_temp.u('e2a1'), 'member', null), (pg_temp.u('e2a2'), 'admin', null),
  (pg_temp.u('e2a3'), 'admin', null), (pg_temp.u('e2a4'), 'member', null), (pg_temp.u('e2a5'), 'guest', null),
  (pg_temp.u('e2a6'), 'member', null), (pg_temp.u('e2a7'), 'member', null), (pg_temp.u('e2a8'), 'member', null),
  (pg_temp.u('e2a9'), 'admin', now()), (pg_temp.u('e2aa'), 'admin', null), (pg_temp.u('e2ab'), 'member', null),
  (pg_temp.u('e2ac'), 'member', null), (pg_temp.u('e2ad'), 'member', null), (pg_temp.u('e2ae'), 'admin', null),
  (pg_temp.u('e2af'), 'admin', null), (pg_temp.u('e2d0'), 'admin', null), (pg_temp.u('e2d1'), 'member', null),
  (pg_temp.u('e2d2'), 'admin', null), (pg_temp.u('e2d3'), 'guest', null);
insert into public.workspaces (id, owner_id, name) values
  (pg_temp.u('e2e0'), pg_temp.u('e2a1'), 'P'),
  (pg_temp.u('e2e1'), pg_temp.u('e2a0'), 'Q'),
  (pg_temp.u('e2e2'), pg_temp.u('e2a1'), 'Z'),
  (pg_temp.u('e2e3'), pg_temp.u('e2d1'), 'S'),
  (pg_temp.u('e2e4'), pg_temp.u('e2d3'), 'V');
-- P: A (c0, Can view de a), B (c1, Can edit de ad), C (c2, vencido), D (c3, apagado, y c8, el que lo reemplazó), E (c4,
-- en la papelera), F (c5, de m4, que no puede compartir: no anda), G (c6, de una cuenta borrada: no anda), R con R1
-- adentro (c9, de ad). Q: K (c7, de o, con vencimiento a futuro). Z, proyecto borrado y purgado: Y (ca, de a). S, de
-- mc: T (cb, de mc). V, de un invitado: U (cc, del invitado: no anda).
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  (pg_temp.u('e2b0'), pg_temp.u('e2e0'), null, 'A', 'a0'),
  (pg_temp.u('e2b1'), pg_temp.u('e2e0'), null, 'B', 'a1'),
  (pg_temp.u('e2b2'), pg_temp.u('e2e0'), null, 'C', 'a2'),
  (pg_temp.u('e2b3'), pg_temp.u('e2e0'), null, 'D', 'a3'),
  (pg_temp.u('e2b4'), pg_temp.u('e2e0'), null, 'E', 'a4'),
  (pg_temp.u('e2b5'), pg_temp.u('e2e0'), null, 'F', 'a5'),
  (pg_temp.u('e2b6'), pg_temp.u('e2e0'), null, 'G', 'a6'),
  (pg_temp.u('e2b7'), pg_temp.u('e2e0'), null, 'R', 'a7'),
  (pg_temp.u('e2b9'), pg_temp.u('e2e1'), null, 'K', 'a0'),
  (pg_temp.u('e2ba'), pg_temp.u('e2e2'), null, 'Y', 'a0'),
  (pg_temp.u('e2bb'), pg_temp.u('e2e3'), null, 'T', 'a0'),
  (pg_temp.u('e2bc'), pg_temp.u('e2e4'), null, 'U', 'a0');
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  (pg_temp.u('e2b8'), pg_temp.u('e2e0'), pg_temp.u('e2b7'), 'R1', 'a0');
update public.pages set deleted_at = now() where id = pg_temp.u('e2b4');
insert into public.grants (user_id, project_id, page_id, level) values
  (pg_temp.u('e2a2'), pg_temp.u('e2e0'), null, 'edit_pages'),
  (pg_temp.u('e2a3'), pg_temp.u('e2e0'), null, 'view'),
  (pg_temp.u('e2a4'), pg_temp.u('e2e0'), null, 'edit_pages'),
  (pg_temp.u('e2a5'), pg_temp.u('e2e0'), null, 'edit_pages'),
  (pg_temp.u('e2a6'), pg_temp.u('e2e0'), null, 'comment'),
  (pg_temp.u('e2a7'), null, pg_temp.u('e2b0'), 'view'),
  (pg_temp.u('e2a9'), pg_temp.u('e2e0'), null, 'edit_pages'),
  (pg_temp.u('e2aa'), null, pg_temp.u('e2b7'), 'edit_pages'),
  (pg_temp.u('e2ab'), null, pg_temp.u('e2b7'), 'edit_pages'),
  (pg_temp.u('e2ac'), null, pg_temp.u('e2b0'), 'edit_pages'),
  (pg_temp.u('e2ad'), pg_temp.u('e2e0'), null, 'edit'),
  (pg_temp.u('e2ae'), null, pg_temp.u('e2b8'), 'edit_pages'),
  (pg_temp.u('e2af'), pg_temp.u('e2e0'), null, 'edit'),
  (pg_temp.u('e2d0'), pg_temp.u('e2e0'), null, 'edit'),
  (pg_temp.u('e2d0'), null, pg_temp.u('e2b8'), 'edit_pages'),
  (pg_temp.u('e2d1'), pg_temp.u('e2e0'), null, 'edit_pages'),
  (pg_temp.u('e2d2'), null, pg_temp.u('e2b9'), 'edit_pages');
-- El admin que solo ve P tuvo Editar y crear sobre la página B y se lo sacaron: no cuenta.
insert into public.grants (user_id, project_id, page_id, level, revoked_at) values
  (pg_temp.u('e2a3'), null, pg_temp.u('e2b1'), 'edit_pages', now());
select pg_temp.link('e2c0', 'e2b0', 'comment', 'e2a1');
select pg_temp.link('e2c1', 'e2b1', 'edit', 'e2a2');
select pg_temp.link('e2c2', 'e2b2', 'comment', 'e2a1', now() - interval '1 hour');
select pg_temp.link('e2c3', 'e2b3', 'comment', 'e2a1', null, true);
select pg_temp.link('e2c4', 'e2b4', 'comment', 'e2a1');
select pg_temp.link('e2c5', 'e2b5', 'comment', 'e2a4');
select pg_temp.link('e2c6', 'e2b6', 'edit', null);
select pg_temp.link('e2c7', 'e2b9', 'comment', 'e2a0', now() + interval '1 day');
select pg_temp.link('e2c8', 'e2b3', 'edit', 'e2a2');
select pg_temp.link('e2c9', 'e2b8', 'comment', 'e2a2');
select pg_temp.link('e2ca', 'e2ba', 'comment', 'e2a1');
select pg_temp.link('e2cb', 'e2bb', 'comment', 'e2d1');
select pg_temp.link('e2cc', 'e2bc', 'comment', 'e2d3');
update public.workspaces set deleted_at = now(), deleted_by = pg_temp.u('e2a1'), purged_at = now(), purged_by = pg_temp.u('e2a1')
where id = pg_temp.u('e2e2');

-- ---------------------------------------------------------------------------------------------------
-- La función: lo que devuelve, cómo corre y quién la ejecuta.
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  f constant regprocedure := 'public.public_link_labels(uuid[])'::regprocedure;
begin
  assert (select p.proargnames = array['p_ids', 'id', 'level', 'created_by_name', 'revoked', 'expired', 'alive'] from pg_proc p where p.oid = f),
    'las columnas no son id, level, created_by_name, revoked, expired, alive';
  assert (select p.prosecdef and p.provolatile = 's' and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = f),
    'no es security definer, stable y con search_path vacío';
  assert has_function_privilege('authenticated', f, 'execute'), 'authenticated no la ejecuta';
  assert not has_function_privilege('anon', f, 'execute'), 'anon la ejecuta';
  assert not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = f and a.grantee = 0), 'PUBLIC la ejecuta';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Quien comparte la raíz del link: el nivel, quién lo creó y cómo está. Igual que la regla de *Share*.
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  -- Los de P: el vivo, el Can edit, el vencido, el apagado y su reemplazo, el de la papelera, el de quien no comparte,
  -- el de la cuenta borrada y el de la rama. Sin lo de Q, sin lo del proyecto borrado y sin el que no existe.
  expected constant text := 'c0:comment:lrc-a:--a,c1:edit:lrc-ad:--a,c2:comment:lrc-a:-e-,c3:comment:lrc-a:r--,c4:comment:lrc-a:--a,'
    || 'c5:comment:lrc-m4:---,c6:edit:-:---,c8:edit:lrc-ad:--a,c9:comment:lrc-ad:--a';
begin
  -- Quien creó el proyecto (un miembro común).
  perform pg_temp.as_user('e2a1');
  assert pg_temp.labels() = expected, format('la creadora del proyecto recibe %s', pg_temp.labels());
  assert pg_temp.labels() = pg_temp.by_rule('e2a1'), format('no coincide con la regla: %s / %s', pg_temp.labels(), pg_temp.by_rule('e2a1'));
  assert pg_temp.same_as_share(), 'la creadora: no coincide con lo que contesta get_public_link';
  -- Solo lo pedido: un id, dos ids, el mismo repetido, con nulos; nada pedido, nada.
  assert pg_temp.labels(array[pg_temp.u('e2c0')]) = 'c0:comment:lrc-a:--a', 'pedir un id no devuelve solo ese';
  assert pg_temp.labels(array[pg_temp.u('e2c3'), null, pg_temp.u('e2c3'), pg_temp.u('e2c8')]) = 'c3:comment:lrc-a:r--,c8:edit:lrc-ad:--a',
    format('repetidos y nulos: %s', pg_temp.labels(array[pg_temp.u('e2c3'), null, pg_temp.u('e2c3'), pg_temp.u('e2c8')]));
  assert (select count(*) from public.public_link_labels('{}'::uuid[])) = 0, 'sin ids devuelve algo';
  assert (select count(*) from public.public_link_labels(null)) = 0, 'con nulo devuelve algo';
  -- Nunca el token, la página ni nada más que las seis columnas.
  assert (select bool_and(to_jsonb(l) ?& array['id', 'level', 'created_by_name', 'revoked', 'expired', 'alive']
                          and (select count(*) from jsonb_object_keys(to_jsonb(l))) = 6
                          and to_jsonb(l)::text !~ 'sdl_'
                          and to_jsonb(l)::text !~ '0000e2b') from public.public_link_labels(pg_temp.all_links()) l),
    'una fila trae algo más (el token o la página)';
  -- Hasta 200 ids: con 200 contesta, con 201 no (por lo que se manda, no por lo que hay).
  assert (select count(*) from public.public_link_labels(
            (select array_agg(pg_temp.u('e2c0')) from generate_series(1, 200)))) = 1, 'con 200 ids no contesta';
  begin
    perform count(*) from public.public_link_labels((select array_agg(gen_random_uuid()) from generate_series(1, 201)));
    raise exception 'FALLA: acepta más de 200 ids';
  exception when others then
    -- El mensaje y el código: la app lo recibe como un pedido mal armado (400), no como un error de la base.
    if sqlerrm <> 'ids_invalid' or sqlstate <> '22023' then
      raise exception 'FALLA: más de 200 ids da % %', sqlstate, sqlerrm;
    end if;
  end;

  -- Un admin con Editar y crear páginas sobre P: lo mismo.
  perform pg_temp.as_user('e2a2');
  assert pg_temp.labels() = expected, format('el admin que comparte recibe %s', pg_temp.labels());
  assert pg_temp.labels() = pg_temp.by_rule('e2a2'), 'el admin: no coincide con la regla';
  assert pg_temp.same_as_share(), 'el admin: no coincide con lo que contesta get_public_link';

  -- Un admin con Editar y crear solo la rama R: el link de R1 y nada más.
  perform pg_temp.as_user('e2aa');
  assert pg_temp.labels() = 'c9:comment:lrc-ad:--a', format('el admin de la rama recibe %s', pg_temp.labels());
  assert pg_temp.labels() = pg_temp.by_rule('e2aa'), 'el admin de la rama: no coincide con la regla';
  assert pg_temp.same_as_share(), 'el admin de la rama: no coincide con lo que contesta get_public_link';

  -- Un admin con Editar y crear solo la hoja R1: lo mismo. Y uno que además tiene Editar sobre P entero: el nivel 3
  -- sobre el proyecto no alcanza para compartir lo demás.
  perform pg_temp.as_user('e2ae');
  assert pg_temp.labels() = 'c9:comment:lrc-ad:--a', format('el admin de la hoja recibe %s', pg_temp.labels());
  assert pg_temp.labels() = pg_temp.by_rule('e2ae'), 'el admin de la hoja: no coincide con la regla';
  assert pg_temp.same_as_share(), 'el admin de la hoja: no coincide con lo que contesta get_public_link';
  perform pg_temp.as_user('e2d0');
  assert pg_temp.labels() = 'c9:comment:lrc-ad:--a', format('el admin con Editar P y la hoja recibe %s', pg_temp.labels());
  assert pg_temp.labels() = pg_temp.by_rule('e2d0'), 'el admin con Editar P y la hoja: no coincide con la regla';
  assert pg_temp.same_as_share(), 'el admin con Editar P y la hoja: no coincide con lo que contesta get_public_link';

  -- Un miembro que creó S y tiene Editar y crear sobre P: lo de su proyecto, y de P nada (ahí no es admin ni lo creó).
  perform pg_temp.as_user('e2d1');
  assert pg_temp.labels() = 'cb:comment:lrc-mc:--a', format('el miembro que creó S recibe %s', pg_temp.labels());
  assert pg_temp.labels() = pg_temp.by_rule('e2d1'), 'el miembro que creó S: no coincide con la regla';
  assert pg_temp.same_as_share(), 'el miembro que creó S: no coincide con lo que contesta get_public_link';

  -- Un admin con Editar y crear solo una página de Q: el link de esa página, y nada de P.
  perform pg_temp.as_user('e2d2');
  assert pg_temp.labels() = 'c7:comment:lrc-o:--a', format('el admin de la página de Q recibe %s', pg_temp.labels());
  assert pg_temp.labels() = pg_temp.by_rule('e2d2'), 'el admin de la página de Q: no coincide con la regla';
  assert pg_temp.same_as_share(), 'el admin de la página de Q: no coincide con lo que contesta get_public_link';

  -- La dueña del workspace no ve P (es de otra persona): solo lo de Q.
  perform pg_temp.as_user('e2a0');
  assert pg_temp.labels() = 'c7:comment:lrc-o:--a', format('la dueña recibe %s', pg_temp.labels());
  assert pg_temp.labels() = pg_temp.by_rule('e2a0'), 'la dueña: no coincide con la regla';
  assert pg_temp.same_as_share(), 'la dueña: no coincide con lo que contesta get_public_link';
  perform pg_temp.as_console();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Quien no comparte: nada, y sin decir si el link existe.
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  who text;
begin
  -- adv: admin que solo ve P. m4: Editar y crear P sin ser admin ni haberlo creado. g: invitado con Editar y crear.
  -- c: Comentar. v: Ver la página A. x: sin permiso. rm: admin sacada. mb: Editar y crear la rama R. mp: Editar y
  -- crear la página A. ed: Editar P. ade: admin con Editar P entero. gc: invitado que creó V (tiene nivel 4 sobre todo V,
  -- pero un invitado no comparte nunca).
  foreach who in array array['e2a3', 'e2a4', 'e2a5', 'e2a6', 'e2a7', 'e2a8', 'e2a9', 'e2ab', 'e2ac', 'e2ad', 'e2af', 'e2d3'] loop
    perform pg_temp.as_user(who);
    assert (select count(*) from public.public_link_labels(pg_temp.all_links())) = 0, format('%s recibe rótulos', who);
    assert pg_temp.by_rule(who) = '', format('%s comparte algo según la regla', who);
    assert pg_temp.same_as_share(), format('%s: no coincide con lo que contesta get_public_link', who);
    -- Uno que existe y uno que no: la misma respuesta, sin error.
    assert (select count(*) from public.public_link_labels(array[pg_temp.u('e2c0')])) = 0
       and (select count(*) from public.public_link_labels(array[pg_temp.u('e2cf')])) = 0, format('%s distingue un link que existe', who);
  end loop;
  -- Siguen viendo o comentando la página: lo que no reciben es solo el rótulo.
  perform pg_temp.as_user('e2a3');
  assert private.page_level(pg_temp.u('e2b0')) = 1, 'el admin con Ver dejó de ver la página';
  perform pg_temp.as_user('e2a5');
  assert private.page_level(pg_temp.u('e2b0')) = 4, 'el invitado perdió su permiso';
  perform pg_temp.as_user('e2a6');
  assert private.page_level(pg_temp.u('e2b0')) = 2, 'quien comenta dejó de comentar';
  perform pg_temp.as_user('e2d3');
  assert private.page_level(pg_temp.u('e2bc')) = 4, 'el invitado que creó V perdió su proyecto';
  perform pg_temp.as_user('e2ab');
  assert private.page_level(pg_temp.u('e2b8')) = 4, 'el miembro de la rama perdió su permiso';
  perform pg_temp.as_user('e2ac');
  assert private.page_level(pg_temp.u('e2b0')) = 4, 'el miembro de la página perdió su permiso';

  -- Quien comparte P no recibe lo que no comparte (Q, S, el proyecto que creó y está borrado y purgado) ni lo que no
  -- existe.
  perform pg_temp.as_user('e2a1');
  assert (select count(*) from public.public_link_labels(
            array[pg_temp.u('e2c7'), pg_temp.u('e2ca'), pg_temp.u('e2cb'), pg_temp.u('e2cf')])) = 0,
    'la creadora de P recibe un link de Q, de S, de un proyecto borrado o uno que no existe';

  -- Con contraseña, la que comparte no es miembro de nada.
  perform pg_temp.as_user('e2a1', '[{"method": "password"}]');
  assert (select count(*) from public.public_link_labels(pg_temp.all_links())) = 0, 'una sesión con contraseña recibe rótulos';
  -- Una sesión sin persona.
  perform set_config('request.jwt.claims', '{"role": "authenticated"}', true);
  assert (select count(*) from public.public_link_labels(pg_temp.all_links())) = 0, 'una sesión sin persona recibe rótulos';

  -- anon no la llama, tampoco con el header de un link (ni el de un link que comenta en esa página).
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  perform pg_temp.expect_error($q$select * from public.public_link_labels(array['00000000-0000-4000-8000-00000000e2c0']::uuid[])$q$,
    'permission denied for function public_link_labels', 'anon pide rótulos');
  perform set_config('request.headers', json_build_object('x-shotdocs-link', 'sdl_' || rpad('e2c0', 43, 'x'))::text, true);
  perform pg_temp.expect_error($q$select * from public.public_link_labels(array['00000000-0000-4000-8000-00000000e2c0']::uuid[])$q$,
    'permission denied for function public_link_labels', 'un link pide rótulos');
  perform pg_temp.as_console();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Lo que cambia con el tiempo y con los permisos.
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  -- El invitado pasa a miembro: con Editar y crear sigue sin compartir. Pasa a admin: comparte y recibe los rótulos.
  update public.members set role = 'member' where user_id = pg_temp.u('e2a5');
  perform pg_temp.as_user('e2a5');
  assert (select count(*) from public.public_link_labels(pg_temp.all_links())) = 0, 'un miembro con Editar y crear recibe rótulos';
  perform pg_temp.as_console();
  update public.members set role = 'admin' where user_id = pg_temp.u('e2a5');
  perform pg_temp.as_user('e2a5');
  assert (select count(*) from public.public_link_labels(pg_temp.all_links())) = 9, 'un admin con Editar y crear no recibe los rótulos';
  assert pg_temp.labels() = pg_temp.by_rule('e2a5'), 'el nuevo admin: no coincide con la regla';
  perform pg_temp.as_console();

  -- m4 pasa a admin: su link (c5) anda. La que creó c0 sale del workspace: c0 y c4 dejan de andar para quien sigue
  -- compartiendo, y ella no recibe nada.
  update public.members set role = 'admin' where user_id = pg_temp.u('e2a4');
  update public.members set removed_at = now() where user_id = pg_temp.u('e2a1');
  perform pg_temp.as_user('e2a2');
  assert pg_temp.labels() = 'c0:comment:lrc-a:---,c1:edit:lrc-ad:--a,c2:comment:lrc-a:-e-,c3:comment:lrc-a:r--,c4:comment:lrc-a:---,'
    || 'c5:comment:lrc-m4:--a,c6:edit:-:---,c8:edit:lrc-ad:--a,c9:comment:lrc-ad:--a',
    format('después de los cambios el admin recibe %s', pg_temp.labels());
  assert pg_temp.labels() = pg_temp.by_rule('e2a2'), 'después de los cambios: no coincide con la regla';
  assert pg_temp.same_as_share(), 'después de los cambios: no coincide con lo que contesta get_public_link';
  perform pg_temp.as_user('e2a1');
  assert (select count(*) from public.public_link_labels(pg_temp.all_links())) = 0, 'la sacada recibe rótulos';
  perform pg_temp.as_console();

  -- Un link que vence y uno que se apaga siguen saliendo, con su estado (los comentarios quedan); uno apagado que
  -- además había vencido dice las dos cosas.
  update public.public_links set expires_at = now() - interval '1 second' where id = pg_temp.u('e2c1');
  update public.public_links set revoked_at = now() where id in (pg_temp.u('e2c5'), pg_temp.u('e2c2'));
  perform pg_temp.as_user('e2a2');
  assert pg_temp.labels(array[pg_temp.u('e2c1'), pg_temp.u('e2c2'), pg_temp.u('e2c5')])
           = 'c1:edit:lrc-ad:-e-,c2:comment:lrc-a:re-,c5:comment:lrc-m4:r--',
    format('con uno vencido y dos apagados recibe %s', pg_temp.labels(array[pg_temp.u('e2c1'), pg_temp.u('e2c2'), pg_temp.u('e2c5')]));
  perform pg_temp.as_console();

  -- La página de la rama va a la papelera: quien la comparte la sigue compartiendo (ve la papelera).
  update public.pages set deleted_at = now() where id = pg_temp.u('e2b7');
  perform pg_temp.as_user('e2aa');
  assert pg_temp.labels() = pg_temp.by_rule('e2aa'), 'con la rama en la papelera: no coincide con la regla';
  assert pg_temp.same_as_share(), 'con la rama en la papelera: no coincide con lo que contesta get_public_link';
  perform pg_temp.as_console();

  -- El proyecto borrado no da nada, tampoco a quien lo compartía.
  update public.workspaces set deleted_at = now(), deleted_by = pg_temp.u('e2a2') where id = pg_temp.u('e2e0');
  perform pg_temp.as_user('e2a2');
  assert (select count(*) from public.public_link_labels(pg_temp.all_links())) = 0, 'un proyecto borrado da rótulos';
  perform pg_temp.as_user('e2aa');
  assert (select count(*) from public.public_link_labels(pg_temp.all_links())) = 0, 'un proyecto borrado da rótulos al admin de la rama';
  perform pg_temp.as_console();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- El trabajo: quien no comparte nada en un proyecto no hace mirar ningún permiso de página.
-- ---------------------------------------------------------------------------------------------------
-- Es lo que hace que un link ajeno cueste casi lo mismo que uno que no existe. Los datos son los del principio: lo de
-- arriba cambió roles y borró P, así que se vuelve atrás.
update public.workspaces set deleted_at = null, deleted_by = null where id = pg_temp.u('e2e0');
update public.pages set deleted_at = null where id = pg_temp.u('e2b7');
update public.members set role = 'guest' where user_id = pg_temp.u('e2a5');
update public.members set role = 'member' where user_id = pg_temp.u('e2a4');
update public.members set removed_at = null where user_id = pg_temp.u('e2a1');
update public.public_links set expires_at = null where id = pg_temp.u('e2c1');
update public.public_links set revoked_at = null where id in (pg_temp.u('e2c2'), pg_temp.u('e2c5'));

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

-- Cuántos permisos de página hace mirar la sesión al pedir estos links (sin ids: todos los de la prueba).
create function pg_temp.looked(ids uuid[] default null) returns bigint language plpgsql as $$
declare
  before constant bigint := pg_temp.page_level_calls();
begin
  perform count(*) from public.public_link_labels(coalesce(ids, pg_temp.all_links()));
  return pg_temp.page_level_calls() - before;
end;
$$;

do $$
declare
  who text;
begin
  -- Quien no comparte nada en ningún proyecto de estos links: ninguno, existan o no. adv: admin con Ver P. ade: admin
  -- con Editar P entero. m4, mb, mp, ed, c, v, x: miembros que no crearon nada. g y gc: invitados. rm: sacada.
  foreach who in array array['e2a3', 'e2af', 'e2a4', 'e2ab', 'e2ac', 'e2ad', 'e2a6', 'e2a7', 'e2a8', 'e2a5', 'e2d3', 'e2a9'] loop
    perform pg_temp.as_user(who);
    assert pg_temp.looked() = 0, format('%s hace mirar %s permisos de página', who, pg_temp.looked());
  end loop;
  -- Quien comparte en otro proyecto no hace mirar nada por los links de este: el admin de la página de Q y el miembro
  -- que creó S, por los de P; la creadora de P, por los de Q, los de S y los del proyecto que creó y está borrado.
  foreach who in array array['e2d2', 'e2d1'] loop
    perform pg_temp.as_user(who);
    assert pg_temp.looked(array[pg_temp.u('e2c0'), pg_temp.u('e2c1'), pg_temp.u('e2c3'), pg_temp.u('e2c9')]) = 0,
      format('%s hace mirar permisos de página por los links de P', who);
  end loop;
  perform pg_temp.as_user('e2a1');
  assert pg_temp.looked(array[pg_temp.u('e2c7'), pg_temp.u('e2cb'), pg_temp.u('e2ca'), pg_temp.u('e2cf')]) = 0,
    'la creadora de P hace mirar permisos de página por links de otros proyectos o de uno borrado';
  -- Quien comparte el proyecto entero no hace mirar la página de ningún link: solo, por cada link que anda (ni apagado
  -- ni vencido, con su cuenta), si quien lo creó sigue compartiendo. Los que andan en P: c0, c1, c4, c5, c8 y c9.
  perform pg_temp.as_user('e2a2');
  assert pg_temp.looked() = 6, format('el admin con todo P hace mirar %s permisos de página y se esperaban 6', pg_temp.looked());
  -- El admin con el permiso dado por página: una por cada página de P con links pedidos (ocho: D tiene dos links y
  -- cuenta una vez) y la de quien creó el único que le llega.
  perform pg_temp.as_user('e2aa');
  assert pg_temp.looked() = 9, format('el admin de la rama hace mirar %s permisos de página y se esperaban 9', pg_temp.looked());
  perform pg_temp.as_console();
end;
$$;

rollback;

select 'ok' as result;
