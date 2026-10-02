-- Pruebas de la entrega 2 de las menciones (P.21; Docs/Doc_Menciones.md, secciones 4, 9 y ME2): quién recibe las
-- filas `has_access = false` de la lista del `@` (solo el dueño y los admins que pueden compartir la página, nunca en
-- la papelera) y `share_for_mention` (solo esa misma gente; siempre *Can comment*, solo sobre esa página y nunca
-- hacia arriba; no toca el permiso de quien ya la ve; un permiso quitado vuelve con Comentar). Corre dentro de una
-- transacción que se deshace al final: no deja usuarios ni datos. Si todo pasa, devuelve una fila con result = 'ok'.
--
-- Como todo pasa en la misma transacción, `now()` no cambia: que una fila "no se tocó" se mira con su `ctid`.

begin;

update public.workspace_settings set min_app_version = null;

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', uid, 'role', 'authenticated')::text, true),
         set_config('request.headers', '{"x-shotdocs-version": "9.999"}', true);
$$;

create function pg_temp.as_session(uid uuid, amr jsonb) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'amr', amr)::text, true);
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

create function pg_temp.sorted(a uuid[]) returns uuid[] language sql as $$
  select coalesce(array_agg(x order by x), '{}') from unnest(a) x;
$$;

-- La lista del `@` de quien llama: con acceso (`true`) o sin acceso (`false`), ordenada por id.
create function pg_temp.cands(p uuid, access boolean) returns uuid[] language sql as $$
  select coalesce(array_agg(c.user_id order by c.user_id), '{}') from public.mention_candidates(p) c
  where c.has_access = access;
$$;

-- Personas (correo @test.invalid):
--   ow  dueña del workspace (creó P1)         a4  admin con editar y crear sobre c (puede compartir c)
--   a3  admin con editar sobre c (no puede compartirla)
--   mo  miembro común dueño de P2, con comentar sobre c
--   mc  miembro con comentar sobre c          mv  miembro con ver sobre c
--   g1  invitada con comentar sobre c
--   m0  miembro sin nada                      g0  invitada sin nada
--   mr  miembro con editar y crear sobre c, quitado (revocado)
--   mx  miembro sacado del workspace
--   ap  admin sin nada (no ve c)
-- Páginas: P1 con r › c › g, s y t (en la papelera); P2 con x.
insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('00000000-0000-4000-8000-000000000f01', 'm2-ow@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000f02', 'm2-a4@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000f03', 'm2-a3@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000f04', 'm2-mo@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000f05', 'm2-mc@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000f06', 'm2-mv@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000f07', 'm2-g1@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000f08', 'm2-m0@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000f09', 'm2-g0@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000f10', 'm2-mr@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000f11', 'm2-mx@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000f12', 'm2-ap@test.invalid', 'authenticated', 'authenticated', now());

-- Los miembros de la base quedan fuera de la prueba (se deshace al final): la lista sin acceso es "todo el workspace".
update public.members set removed_at = now() where removed_at is null;
update public.workspace_settings set owner_id = '00000000-0000-4000-8000-000000000f01';

insert into public.members (user_id, role, removed_at) values
  ('00000000-0000-4000-8000-000000000f01', 'owner', null),
  ('00000000-0000-4000-8000-000000000f02', 'admin', null),
  ('00000000-0000-4000-8000-000000000f03', 'admin', null),
  ('00000000-0000-4000-8000-000000000f04', 'member', null),
  ('00000000-0000-4000-8000-000000000f05', 'member', null),
  ('00000000-0000-4000-8000-000000000f06', 'member', null),
  ('00000000-0000-4000-8000-000000000f07', 'guest', null),
  ('00000000-0000-4000-8000-000000000f08', 'member', null),
  ('00000000-0000-4000-8000-000000000f09', 'guest', null),
  ('00000000-0000-4000-8000-000000000f10', 'member', null),
  ('00000000-0000-4000-8000-000000000f11', 'member', now()),
  ('00000000-0000-4000-8000-000000000f12', 'admin', null);

insert into public.workspaces (id, owner_id, name) values
  ('00000000-0000-4000-8000-000000000fa1', '00000000-0000-4000-8000-000000000f01', 'P1'),
  ('00000000-0000-4000-8000-000000000fa2', '00000000-0000-4000-8000-000000000f04', 'P2');
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  ('00000000-0000-4000-8000-000000000fb1', '00000000-0000-4000-8000-000000000fa1', null, 'r', 'a0'),
  ('00000000-0000-4000-8000-000000000fb4', '00000000-0000-4000-8000-000000000fa1', null, 's', 'a1'),
  ('00000000-0000-4000-8000-000000000fb6', '00000000-0000-4000-8000-000000000fa1', null, 't', 'a2'),
  ('00000000-0000-4000-8000-000000000fb5', '00000000-0000-4000-8000-000000000fa2', null, 'x', 'a0');
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  ('00000000-0000-4000-8000-000000000fb2', '00000000-0000-4000-8000-000000000fa1',
   '00000000-0000-4000-8000-000000000fb1', 'Plan de rodaje', 'a0');
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  ('00000000-0000-4000-8000-000000000fb3', '00000000-0000-4000-8000-000000000fa1',
   '00000000-0000-4000-8000-000000000fb2', 'g', 'a0');
-- r, c y g con historia: el reinicio de la privacidad de lo borrado (`clean_reset_seq`) se ve.
update public.pages set update_seq = 7
where id in ('00000000-0000-4000-8000-000000000fb1', '00000000-0000-4000-8000-000000000fb2',
             '00000000-0000-4000-8000-000000000fb3');

insert into public.grants (user_id, page_id, level, granted_by, revoked_at) values
  ('00000000-0000-4000-8000-000000000f02', '00000000-0000-4000-8000-000000000fb2', 'edit_pages', '00000000-0000-4000-8000-000000000f01', null),
  ('00000000-0000-4000-8000-000000000f03', '00000000-0000-4000-8000-000000000fb2', 'edit', '00000000-0000-4000-8000-000000000f01', null),
  ('00000000-0000-4000-8000-000000000f04', '00000000-0000-4000-8000-000000000fb2', 'comment', '00000000-0000-4000-8000-000000000f01', null),
  ('00000000-0000-4000-8000-000000000f05', '00000000-0000-4000-8000-000000000fb2', 'comment', '00000000-0000-4000-8000-000000000f01', null),
  ('00000000-0000-4000-8000-000000000f06', '00000000-0000-4000-8000-000000000fb2', 'view', '00000000-0000-4000-8000-000000000f01', null),
  ('00000000-0000-4000-8000-000000000f07', '00000000-0000-4000-8000-000000000fb2', 'comment', '00000000-0000-4000-8000-000000000f01', null),
  ('00000000-0000-4000-8000-000000000f10', '00000000-0000-4000-8000-000000000fb2', 'edit_pages', '00000000-0000-4000-8000-000000000f01', now()),
  ('00000000-0000-4000-8000-000000000f11', '00000000-0000-4000-8000-000000000fb2', 'comment', '00000000-0000-4000-8000-000000000f01', null);

-- t va a la papelera (la dueña la sigue viendo: crea el proyecto).
update public.pages set deleted_at = now() where id = '00000000-0000-4000-8000-000000000fb6';

-- ---------------------------------------------------------------------------------------------------
-- 1. Las filas sin acceso: el dueño y un admin que puede compartir la página
-- ---------------------------------------------------------------------------------------------------
-- Ven c: ow (creó P1), a4, a3, mo, mc, mv, g1. No la ven: m0, g0, mr (quitado), ap; mx no está en el workspace.
select pg_temp.as_user('00000000-0000-4000-8000-000000000f01');
do $$
declare
  outside uuid[] := pg_temp.cands('00000000-0000-4000-8000-000000000fb2', false);
  inside  uuid[] := pg_temp.cands('00000000-0000-4000-8000-000000000fb2', true);
begin
  assert outside = pg_temp.sorted(array['00000000-0000-4000-8000-000000000f08', '00000000-0000-4000-8000-000000000f09',
    '00000000-0000-4000-8000-000000000f10', '00000000-0000-4000-8000-000000000f12']::uuid[]),
    format('caso 1: las sin acceso de la dueña no son {m0, g0, mr, ap}: %s', outside);
  assert inside = pg_temp.sorted(array['00000000-0000-4000-8000-000000000f02', '00000000-0000-4000-8000-000000000f03',
    '00000000-0000-4000-8000-000000000f04', '00000000-0000-4000-8000-000000000f05', '00000000-0000-4000-8000-000000000f06',
    '00000000-0000-4000-8000-000000000f07']::uuid[]),
    format('caso 1: las con acceso de la dueña cambiaron: %s', inside);
  -- Nadie aparece dos veces (con y sin acceso), ni ella misma, ni quien sacaron del workspace.
  assert not (inside && outside), 'caso 1: alguien aparece con y sin acceso';
  assert (select count(*) from public.mention_candidates('00000000-0000-4000-8000-000000000fb2')) = 10,
    'caso 1: la lista no tiene 10 filas';
  assert (select c.email from public.mention_candidates('00000000-0000-4000-8000-000000000fb2') c
          where c.user_id = '00000000-0000-4000-8000-000000000f08') = 'm2-m0@test.invalid', 'caso 1: sin el correo';
  assert (select c.label from public.mention_candidates('00000000-0000-4000-8000-000000000fb2') c
          where c.user_id = '00000000-0000-4000-8000-000000000f08') = 'm2-m0', 'caso 1: sin el rótulo';
  -- Las con acceso van primero.
  assert (select bool_and(x.has_access) from (select c.has_access from public.mention_candidates('00000000-0000-4000-8000-000000000fb2') c limit 6) x),
    'caso 1: las con acceso no van primero';
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-000000000f02');
do $$
begin
  assert pg_temp.cands('00000000-0000-4000-8000-000000000fb2', false) = pg_temp.sorted(array[
    '00000000-0000-4000-8000-000000000f08', '00000000-0000-4000-8000-000000000f09',
    '00000000-0000-4000-8000-000000000f10', '00000000-0000-4000-8000-000000000f12']::uuid[]),
    format('caso 1: las sin acceso de a4: %s', pg_temp.cands('00000000-0000-4000-8000-000000000fb2', false));
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 2. Nadie más recibe filas sin acceso
-- ---------------------------------------------------------------------------------------------------
-- Un admin que no puede compartir c (editar, 3).
select pg_temp.as_user('00000000-0000-4000-8000-000000000f03');
do $$
begin
  assert cardinality(pg_temp.cands('00000000-0000-4000-8000-000000000fb2', false)) = 0,
    format('caso 2: a3 (admin sin compartir) recibe sin acceso: %s', pg_temp.cands('00000000-0000-4000-8000-000000000fb2', false));
end;
$$;

-- Un miembro común dueño de P2: en x (que puede compartir) y en c, ninguna (B2 de la auditoría del diseño).
select pg_temp.as_user('00000000-0000-4000-8000-000000000f04');
do $$
begin
  assert cardinality(pg_temp.cands('00000000-0000-4000-8000-000000000fb5', false)) = 0,
    format('caso 2: mo recibe el workspace en su página x: %s', pg_temp.cands('00000000-0000-4000-8000-000000000fb5', false));
  assert cardinality(pg_temp.cands('00000000-0000-4000-8000-000000000fb5', true)) = 0, 'caso 2: mo ve a alguien en x';
  assert cardinality(pg_temp.cands('00000000-0000-4000-8000-000000000fb2', false)) = 0, 'caso 2: mo recibe sin acceso en c';
end;
$$;

-- Un miembro con Comentar y una invitada con Comentar.
select pg_temp.as_user('00000000-0000-4000-8000-000000000f05');
do $$
begin
  assert cardinality(pg_temp.cands('00000000-0000-4000-8000-000000000fb2', false)) = 0, 'caso 2: mc recibe sin acceso';
  assert not ('00000000-0000-4000-8000-000000000f08' = any (pg_temp.cands('00000000-0000-4000-8000-000000000fb2', true))),
    'caso 2: mc ve a m0';
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-000000000f07');
do $$
begin
  assert cardinality(pg_temp.cands('00000000-0000-4000-8000-000000000fb2', false)) = 0, 'caso 2: g1 recibe sin acceso';
end;
$$;

-- Un admin sin nada sobre c: no ve la página, no hay lista.
select pg_temp.as_user('00000000-0000-4000-8000-000000000f12');
select pg_temp.expect_error($q$select * from public.mention_candidates('00000000-0000-4000-8000-000000000fb2')$q$,
  'page_not_found', 'caso 2: ap recibe la lista de c');

-- Una sesión con contraseña de la dueña: ni lista ni compartir.
select pg_temp.as_session('00000000-0000-4000-8000-000000000f01', '[{"method": "password"}]');
select pg_temp.expect_error($q$select * from public.mention_candidates('00000000-0000-4000-8000-000000000fb2')$q$,
  'page_not_found', 'caso 2: con contraseña recibe la lista');
select pg_temp.expect_error($q$select public.share_for_mention('00000000-0000-4000-8000-000000000fb2', '00000000-0000-4000-8000-000000000f08')$q$,
  'page_not_found', 'caso 2: con contraseña comparte');

-- ---------------------------------------------------------------------------------------------------
-- 3. En la papelera, ninguna fila sin acceso ni compartir
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-000000000f01');
do $$
begin
  assert cardinality(pg_temp.cands('00000000-0000-4000-8000-000000000fb6', false)) = 0,
    format('caso 3: la dueña recibe sin acceso en la papelera: %s', pg_temp.cands('00000000-0000-4000-8000-000000000fb6', false));
  perform pg_temp.expect_error($q$select public.share_for_mention('00000000-0000-4000-8000-000000000fb6', '00000000-0000-4000-8000-000000000f08')$q$,
    'page_in_trash', 'caso 3: la dueña comparte una página en la papelera');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 4. Quién no puede compartir desde la mención
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-000000000f03');
select pg_temp.expect_error($q$select public.share_for_mention('00000000-0000-4000-8000-000000000fb2', '00000000-0000-4000-8000-000000000f08')$q$,
  'not_allowed', 'caso 4: a3 (admin sin compartir) comparte');
-- Con alguien que ya ve la página, también `not_allowed` (no `shared: false`): quien no puede compartir no averigua
-- por la respuesta quién ve la página.
select pg_temp.expect_error($q$select public.share_for_mention('00000000-0000-4000-8000-000000000fb2', '00000000-0000-4000-8000-000000000f06')$q$,
  'not_allowed', 'caso 4: a3 averigua que mv ve c');
select pg_temp.as_user('00000000-0000-4000-8000-000000000f04');
select pg_temp.expect_error($q$select public.share_for_mention('00000000-0000-4000-8000-000000000fb5', '00000000-0000-4000-8000-000000000f08')$q$,
  'not_allowed', 'caso 4: mo (miembro dueño de P2) comparte su página');
select pg_temp.expect_error($q$select public.share_for_mention('00000000-0000-4000-8000-000000000fb2', '00000000-0000-4000-8000-000000000f08')$q$,
  'not_allowed', 'caso 4: mo comparte c');
select pg_temp.as_user('00000000-0000-4000-8000-000000000f05');
select pg_temp.expect_error($q$select public.share_for_mention('00000000-0000-4000-8000-000000000fb2', '00000000-0000-4000-8000-000000000f08')$q$,
  'not_allowed', 'caso 4: mc comparte');
select pg_temp.as_user('00000000-0000-4000-8000-000000000f07');
select pg_temp.expect_error($q$select public.share_for_mention('00000000-0000-4000-8000-000000000fb2', '00000000-0000-4000-8000-000000000f08')$q$,
  'not_allowed', 'caso 4: g1 comparte');
select pg_temp.as_user('00000000-0000-4000-8000-000000000f12');
select pg_temp.expect_error($q$select public.share_for_mention('00000000-0000-4000-8000-000000000fb2', '00000000-0000-4000-8000-000000000f08')$q$,
  'page_not_found', 'caso 4: ap (no ve c) comparte');
-- A quien no es del workspace (sacado, o un id cualquiera): member_not_found.
select pg_temp.as_user('00000000-0000-4000-8000-000000000f01');
select pg_temp.expect_error($q$select public.share_for_mention('00000000-0000-4000-8000-000000000fb2', '00000000-0000-4000-8000-000000000f11')$q$,
  'member_not_found', 'caso 4: comparte con quien sacaron del workspace');
select pg_temp.expect_error($q$select public.share_for_mention('00000000-0000-4000-8000-000000000fb2', '00000000-0000-4000-8000-0000000000ff')$q$,
  'member_not_found', 'caso 4: comparte con alguien que no existe');

select set_config('role', 'postgres', true);
do $$
begin
  assert not exists (select 1 from public.grants where user_id = '00000000-0000-4000-8000-000000000f08'),
    'caso 4: un rechazo dejó un permiso para m0';
  assert not has_function_privilege('anon', 'public.share_for_mention(uuid, uuid)', 'execute'), 'caso 4: anon comparte';
  assert has_function_privilege('authenticated', 'public.share_for_mention(uuid, uuid)', 'execute'),
    'caso 4: authenticated no puede llamarla';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 5. La dueña comparte con m0 desde la mención: Comentar, solo c (y lo de abajo), nunca hacia arriba
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-000000000f01');
do $$
declare
  got jsonb := public.share_for_mention('00000000-0000-4000-8000-000000000fb2', '00000000-0000-4000-8000-000000000f08');
begin
  assert (got ->> 'shared')::boolean, format('caso 5: no compartió: %s', got);
  assert got ->> 'grant_id' is not null, 'caso 5: sin el id del permiso';
end;
$$;

select set_config('role', 'postgres', true);
do $$
declare
  g public.grants;
begin
  assert (select count(*) from public.grants where user_id = '00000000-0000-4000-8000-000000000f08') = 1,
    'caso 5: m0 no tiene exactamente un permiso';
  select * into g from public.grants where user_id = '00000000-0000-4000-8000-000000000f08';
  assert g.level = 'comment', format('caso 5: el permiso no es Comentar: %s', g.level);
  assert g.page_id = '00000000-0000-4000-8000-000000000fb2' and g.project_id is null, 'caso 5: el permiso no es sobre c';
  assert g.granted_by = '00000000-0000-4000-8000-000000000f01' and g.revoked_at is null, 'caso 5: quién lo dio';
  assert private.user_page_level('00000000-0000-4000-8000-000000000fb2', '00000000-0000-4000-8000-000000000f08') = 2,
    'caso 5: m0 no comenta en c';
  assert private.user_page_level('00000000-0000-4000-8000-000000000fb3', '00000000-0000-4000-8000-000000000f08') = 2,
    'caso 5: m0 no ve g (abajo)';
  assert private.user_page_level('00000000-0000-4000-8000-000000000fb1', '00000000-0000-4000-8000-000000000f08') = 0,
    'caso 5: m0 ve r (arriba)';
  assert private.user_page_level('00000000-0000-4000-8000-000000000fb4', '00000000-0000-4000-8000-000000000f08') = 0,
    'caso 5: m0 ve s (al lado)';
  assert private.user_project_level('00000000-0000-4000-8000-000000000fa1', '00000000-0000-4000-8000-000000000f08') = 0,
    'caso 5: m0 tiene permiso sobre el proyecto';
  -- Como *Share* con Comentar: la rama alcanzada empieza de una base nueva; lo de arriba, no.
  assert (select clean_reset_seq from public.pages where id = '00000000-0000-4000-8000-000000000fb2') = 7,
    'caso 5: c no se reinició (privacidad de lo borrado)';
  assert (select clean_reset_seq from public.pages where id = '00000000-0000-4000-8000-000000000fb3') = 7,
    'caso 5: g no se reinició';
  assert (select clean_reset_seq from public.pages where id = '00000000-0000-4000-8000-000000000fb1') = 0,
    'caso 5: r se reinició';
end;
$$;

-- Ya la ve: la mención pasa, y le llega a la campana.
select pg_temp.as_user('00000000-0000-4000-8000-000000000f01');
do $$
declare
  got jsonb;
begin
  assert '00000000-0000-4000-8000-000000000f08' = any (pg_temp.cands('00000000-0000-4000-8000-000000000fb2', true)),
    'caso 5: m0 no pasa a la lista con acceso';
  assert not ('00000000-0000-4000-8000-000000000f08' = any (pg_temp.cands('00000000-0000-4000-8000-000000000fb2', false))),
    'caso 5: m0 sigue sin acceso';
  perform public.add_comment('00000000-0000-4000-8000-000000000d21', '00000000-0000-4000-8000-000000000fb2',
    null, null, '@m2-m0 mirá la toma 12');
  got := public.set_comment_mentions('00000000-0000-4000-8000-000000000d21',
    jsonb_build_array(jsonb_build_object('user_id', '00000000-0000-4000-8000-000000000f08', 'label', 'm2-m0')));
  assert got = '["00000000-0000-4000-8000-000000000f08"]'::jsonb, format('caso 5: la mención a m0 no pasó: %s', got);
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-000000000f08');
do $$
begin
  assert (public.mentions_inbox() ->> 'unread')::int = 1, 'caso 5: la campana de m0 no da 1';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 6. Repetir no cambia nada; nunca toca el permiso de quien ya ve la página
-- ---------------------------------------------------------------------------------------------------
select set_config('role', 'postgres', true);
create temp table e2_before as
  select g.id, g.ctid::text as ct from public.grants g
  where g.user_id in ('00000000-0000-4000-8000-000000000f08', '00000000-0000-4000-8000-000000000f06',
                      '00000000-0000-4000-8000-000000000f05', '00000000-0000-4000-8000-000000000f02');
grant select on e2_before to authenticated;

select pg_temp.as_user('00000000-0000-4000-8000-000000000f01');
do $$
declare
  got jsonb;
begin
  -- m0 (el reintento), mv (ve con Ver: no sube a Comentar), mc (comenta), a4 (edita y crea: no baja).
  got := public.share_for_mention('00000000-0000-4000-8000-000000000fb2', '00000000-0000-4000-8000-000000000f08');
  assert got = '{"shared": false}'::jsonb, format('caso 6: el reintento con m0 da %s', got);
  got := public.share_for_mention('00000000-0000-4000-8000-000000000fb2', '00000000-0000-4000-8000-000000000f06');
  assert got = '{"shared": false}'::jsonb, format('caso 6: mv da %s', got);
  got := public.share_for_mention('00000000-0000-4000-8000-000000000fb2', '00000000-0000-4000-8000-000000000f05');
  assert got = '{"shared": false}'::jsonb, format('caso 6: mc da %s', got);
  got := public.share_for_mention('00000000-0000-4000-8000-000000000fb2', '00000000-0000-4000-8000-000000000f02');
  assert got = '{"shared": false}'::jsonb, format('caso 6: a4 da %s', got);
  -- A sí misma: nada.
  got := public.share_for_mention('00000000-0000-4000-8000-000000000fb2', '00000000-0000-4000-8000-000000000f01');
  assert got = '{"shared": false}'::jsonb, format('caso 6: a sí misma da %s', got);
  -- Sobre g (abajo de c), m0 ya la ve por c: nada.
  got := public.share_for_mention('00000000-0000-4000-8000-000000000fb3', '00000000-0000-4000-8000-000000000f08');
  assert got = '{"shared": false}'::jsonb, format('caso 6: m0 en g da %s', got);
end;
$$;

select set_config('role', 'postgres', true);
do $$
begin
  assert not exists (select 1 from e2_before b join public.grants g on g.id = b.id where g.ctid::text <> b.ct),
    'caso 6: se tocó el permiso de alguien que ya veía la página';
  assert (select count(*) from public.grants g where g.user_id in ('00000000-0000-4000-8000-000000000f08',
            '00000000-0000-4000-8000-000000000f06', '00000000-0000-4000-8000-000000000f05',
            '00000000-0000-4000-8000-000000000f02', '00000000-0000-4000-8000-000000000f01')) = (select count(*) from e2_before),
    'caso 6: apareció un permiso nuevo';
  assert (select level from public.grants where user_id = '00000000-0000-4000-8000-000000000f06') = 'view',
    'caso 6: mv dejó de tener Ver';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 7. Un permiso quitado vuelve con Comentar (no con lo que tenía); un admin que puede compartir, a una invitada
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-000000000f02');
do $$
begin
  assert (public.share_for_mention('00000000-0000-4000-8000-000000000fb2', '00000000-0000-4000-8000-000000000f10') ->> 'shared')::boolean,
    'caso 7: a4 no compartió con mr';
  assert (public.share_for_mention('00000000-0000-4000-8000-000000000fb2', '00000000-0000-4000-8000-000000000f09') ->> 'shared')::boolean,
    'caso 7: a4 no compartió con g0';
  -- Ya no están sin acceso.
  assert cardinality(pg_temp.cands('00000000-0000-4000-8000-000000000fb2', false)) = 1,
    format('caso 7: las sin acceso de a4 no son solo {ap}: %s', pg_temp.cands('00000000-0000-4000-8000-000000000fb2', false));
end;
$$;

select set_config('role', 'postgres', true);
do $$
begin
  assert (select count(*) from public.grants where user_id = '00000000-0000-4000-8000-000000000f10') = 1,
    'caso 7: mr tiene más de un permiso';
  assert (select level from public.grants where user_id = '00000000-0000-4000-8000-000000000f10') = 'comment',
    format('caso 7: mr volvió con %s', (select level from public.grants where user_id = '00000000-0000-4000-8000-000000000f10'));
  assert (select revoked_at is null from public.grants where user_id = '00000000-0000-4000-8000-000000000f10'),
    'caso 7: el permiso de mr sigue quitado';
  assert private.user_page_level('00000000-0000-4000-8000-000000000fb2', '00000000-0000-4000-8000-000000000f10') = 2,
    'caso 7: mr no comenta en c';
  assert (select level from public.grants where user_id = '00000000-0000-4000-8000-000000000f09') = 'comment'
     and (select page_id from public.grants where user_id = '00000000-0000-4000-8000-000000000f09') = '00000000-0000-4000-8000-000000000fb2',
    'caso 7: g0 no tiene Comentar sobre c';
  assert (select granted_by from public.grants where user_id = '00000000-0000-4000-8000-000000000f09') = '00000000-0000-4000-8000-000000000f02',
    'caso 7: el permiso de g0 no lo dio a4';
end;
$$;

rollback;
select 'ok' as result;
