-- Pruebas de las menciones en comentarios (P.21, entrega 1; Docs/Doc_Menciones.md, sección 8.1): a quién se puede
-- mencionar según quién escribe (dueño, admin, miembro, invitado), la lista del `@`, el conjunto entero de un
-- comentario (idempotente, sacar y volver), la campana (el número con tope, lo que deja de verse, el índice
-- liviano), leídas, que nadie lea la tabla, `list_comments` y `comment_authors`, la versión mínima, lo importado y
-- una sesión con contraseña. Corre dentro de una transacción que se deshace al final: no deja usuarios ni datos. Si
-- todo pasa, devuelve una fila con result = 'ok'.
--
-- Como la tabla y las funciones se escriben dentro de la misma transacción, `now()` no cambia: que una fila "no se
-- tocó" se mira con su `ctid` (cambia con cada update).

begin;

-- Sin mínima (la prueba 15 la pone); se deshace al final.
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

-- Corre `stmt` y exige que falle con ese mensaje o ese código (sqlstate).
create function pg_temp.expect_error(stmt text, expected text, what text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm = expected or sqlstate = expected then
      return;
    end if;
    -- El rechazo por versión llega como PGRST con el mensaje en JSON (y estado 503).
    if sqlstate = 'PGRST' and (sqlerrm::json ->> 'message') = expected then
      return;
    end if;
    raise exception 'FALLA: % (dio % %)', what, sqlstate, sqlerrm;
  end;
  raise exception 'FALLA: %', what;
end;
$$;

-- Una mención para `set_comment_mentions`.
create function pg_temp.m(uid uuid, label text) returns jsonb language sql as $$
  select jsonb_build_object('user_id', uid, 'label', label);
$$;

-- Los ids aceptados, ordenados (para comparar con `array[...]`).
create function pg_temp.ids(j jsonb) returns uuid[] language sql as $$
  select coalesce(array_agg(x::uuid order by x), '{}') from jsonb_array_elements_text(j) x;
$$;

create function pg_temp.sorted(a uuid[]) returns uuid[] language sql as $$
  select coalesce(array_agg(x order by x), '{}') from unnest(a) x;
$$;

-- La lista del `@` de quien llama, ordenada por id.
create function pg_temp.candidates(p uuid) returns uuid[] language sql as $$
  select coalesce(array_agg(c.user_id order by c.user_id), '{}') from public.mention_candidates(p) c;
$$;

create function pg_temp.unread() returns int language sql as $$
  select (public.mentions_inbox() ->> 'unread')::int;
$$;

-- Personas (correo @test.invalid):
--   ow  dueña del workspace (creó P1)        ad  admin, con editar sobre c
--   mc  miembro con comentar sobre c         mv  miembro con ver sobre c
--   me  miembro con editar y crear sobre c   m0  miembro sin nada
--   mo  miembro común con comentar sobre c y dueño de P2
--   g1  invitada con comentar sobre c (se lo compartió ow; entró con la invitación de me)
--   g2  invitada con comentar sobre c, que nunca comenta
--   g3  invitada con ver sobre c
-- Páginas: P1 con r › c › g, y s; P2 con x.
insert into auth.users (id, email, aud, role, email_confirmed_at) values
  ('00000000-0000-4000-8000-000000000e01', 'mn-ow@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000e02', 'mn-ad@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000e03', 'mn-mc@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000e04', 'mn-mv@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000e05', 'mn-me@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000e06', 'mn-m0@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000e07', 'mn-mo@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000e08', 'mn-g1@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000e09', 'mn-g2@test.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-000000000e10', 'mn-g3@test.invalid', 'authenticated', 'authenticated', now());

-- Si la base ya tiene dueño, queda fuera de la prueba (se deshace al final): hay un solo dueño activo.
update public.members set removed_at = now() where role = 'owner' and removed_at is null;
update public.workspace_settings set owner_id = '00000000-0000-4000-8000-000000000e01';

insert into public.members (user_id, role) values
  ('00000000-0000-4000-8000-000000000e01', 'owner'),
  ('00000000-0000-4000-8000-000000000e02', 'admin'),
  ('00000000-0000-4000-8000-000000000e03', 'member'),
  ('00000000-0000-4000-8000-000000000e04', 'member'),
  ('00000000-0000-4000-8000-000000000e05', 'member'),
  ('00000000-0000-4000-8000-000000000e06', 'member'),
  ('00000000-0000-4000-8000-000000000e07', 'member'),
  ('00000000-0000-4000-8000-000000000e08', 'guest'),
  ('00000000-0000-4000-8000-000000000e09', 'guest'),
  ('00000000-0000-4000-8000-000000000e10', 'guest');

insert into public.workspaces (id, owner_id, name) values
  ('00000000-0000-4000-8000-000000000ea1', '00000000-0000-4000-8000-000000000e01', 'P1'),
  ('00000000-0000-4000-8000-000000000ea2', '00000000-0000-4000-8000-000000000e07', 'P2');
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  ('00000000-0000-4000-8000-000000000eb1', '00000000-0000-4000-8000-000000000ea1', null, 'r', 'a0'),
  ('00000000-0000-4000-8000-000000000eb4', '00000000-0000-4000-8000-000000000ea1', null, 's', 'a1'),
  ('00000000-0000-4000-8000-000000000eb5', '00000000-0000-4000-8000-000000000ea2', null, 'x', 'a0');
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  ('00000000-0000-4000-8000-000000000eb2', '00000000-0000-4000-8000-000000000ea1',
   '00000000-0000-4000-8000-000000000eb1', 'Plan de rodaje', 'a0');
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  ('00000000-0000-4000-8000-000000000eb3', '00000000-0000-4000-8000-000000000ea1',
   '00000000-0000-4000-8000-000000000eb2', 'g', 'a0');

insert into public.grants (user_id, page_id, level, granted_by) values
  ('00000000-0000-4000-8000-000000000e02', '00000000-0000-4000-8000-000000000eb2', 'edit', '00000000-0000-4000-8000-000000000e01'),
  ('00000000-0000-4000-8000-000000000e03', '00000000-0000-4000-8000-000000000eb2', 'comment', '00000000-0000-4000-8000-000000000e01'),
  ('00000000-0000-4000-8000-000000000e04', '00000000-0000-4000-8000-000000000eb2', 'view', '00000000-0000-4000-8000-000000000e01'),
  ('00000000-0000-4000-8000-000000000e05', '00000000-0000-4000-8000-000000000eb2', 'edit_pages', '00000000-0000-4000-8000-000000000e01'),
  ('00000000-0000-4000-8000-000000000e07', '00000000-0000-4000-8000-000000000eb2', 'comment', '00000000-0000-4000-8000-000000000e01'),
  ('00000000-0000-4000-8000-000000000e08', '00000000-0000-4000-8000-000000000eb2', 'comment', '00000000-0000-4000-8000-000000000e01'),
  ('00000000-0000-4000-8000-000000000e09', '00000000-0000-4000-8000-000000000eb2', 'comment', '00000000-0000-4000-8000-000000000e01'),
  ('00000000-0000-4000-8000-000000000e10', '00000000-0000-4000-8000-000000000eb2', 'view', '00000000-0000-4000-8000-000000000e01');

-- g1 entró con la invitación de me (caso 18): me nunca le compartió nada después ni comentó.
insert into public.invitations (email, role, invited_by, used_at, used_by) values
  ('mn-g1@test.invalid', 'guest', '00000000-0000-4000-8000-000000000e05', now(), '00000000-0000-4000-8000-000000000e08');

-- ---------------------------------------------------------------------------------------------------
-- 1 y 2. Un miembro con Comentar menciona a otro que ve la página (aceptado) y a uno que no la ve (descartado)
-- ---------------------------------------------------------------------------------------------------
-- k1 (ed01): de mc en c, nombra a mv y a m0.
select pg_temp.as_user('00000000-0000-4000-8000-000000000e03');
do $$
declare
  got jsonb;
begin
  perform public.add_comment('00000000-0000-4000-8000-000000000d01', '00000000-0000-4000-8000-000000000eb2',
    null, null, '@mn-mv fijate la toma 12 y @mn-m0');
  got := public.set_comment_mentions('00000000-0000-4000-8000-000000000d01', jsonb_build_array(
    pg_temp.m('00000000-0000-4000-8000-000000000e04', 'mn-mv'),
    pg_temp.m('00000000-0000-4000-8000-000000000e06', 'mn-m0')));
  assert pg_temp.ids(got) = array['00000000-0000-4000-8000-000000000e04']::uuid[],
    format('caso 2: m0 (no ve la página) no se descarta: %s', got);
end;
$$;

select set_config('role', 'postgres', true);
do $$
begin
  assert (select count(*) from public.comment_mentions where comment_id = '00000000-0000-4000-8000-000000000d01') = 1,
    'caso 2: queda una fila de m0';
  assert (select mentioned_by from public.comment_mentions where comment_id = '00000000-0000-4000-8000-000000000d01')
    = '00000000-0000-4000-8000-000000000e03', 'mentioned_by no es quien escribe';
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-000000000e04');
do $$
declare
  box jsonb := public.mentions_inbox();
  row jsonb := box -> 'rows' -> 0;
begin
  assert (box ->> 'unread')::int = 1, format('caso 1: la campana de mv no da 1: %s', box);
  assert jsonb_array_length(box -> 'rows') = 1, 'caso 1: la campana no trae la fila';
  assert row ->> 'snippet' = '@mn-mv fijate la toma 12 y @mn-m0', 'caso 1: sin el comienzo del texto';
  assert row ->> 'page_title' = 'Plan de rodaje', 'caso 1: sin el título de la página';
  assert row ->> 'mentioned_by_email' = 'mn-mc@test.invalid', 'caso 1: sin quién mencionó';
  assert (row ->> 'gone')::boolean = false, 'caso 1: la fila llega gone';
  assert row ->> 'label' = 'mn-mv', 'caso 1: sin el rótulo';
  assert (box ->> 'now') is not null, 'caso 1: sin la hora del servidor';
  -- Con `desde` posterior no trae nada.
  assert jsonb_array_length(public.mentions_inbox(now() + interval '1 second') -> 'rows') = 0, 'caso 1: desde no filtra';
  assert jsonb_array_length(public.mentions_index()) = 1, 'caso 1: el índice no trae la mención';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 3 y 18. Un invitado menciona: a quien participa, a quien le compartió y a quien lo invitó, sí; al resto, no
-- ---------------------------------------------------------------------------------------------------
-- k2 (ed02): de g1 en c. mc comentó (k1); ow le compartió c; me lo invitó; mv ve la página pero no participa ni le
-- compartió nada; g2 es otra invitada que no comentó.
select pg_temp.as_user('00000000-0000-4000-8000-000000000e08');
do $$
declare
  got jsonb;
begin
  -- Caso 5 (invitado), antes de que comenten ow y ad: su lista corta.
  assert pg_temp.candidates('00000000-0000-4000-8000-000000000eb2') = pg_temp.sorted(array[
    '00000000-0000-4000-8000-000000000e01', '00000000-0000-4000-8000-000000000e03',
    '00000000-0000-4000-8000-000000000e05']::uuid[]),
    format('caso 5: la lista de g1 no es {ow, mc, me}: %s', pg_temp.candidates('00000000-0000-4000-8000-000000000eb2'));
  perform public.add_comment('00000000-0000-4000-8000-000000000d02', '00000000-0000-4000-8000-000000000eb2',
    null, null, 'Hola @mn-mv @mn-mc @mn-ow @mn-g2 @mn-me');
  got := public.set_comment_mentions('00000000-0000-4000-8000-000000000d02', jsonb_build_array(
    pg_temp.m('00000000-0000-4000-8000-000000000e04', 'mn-mv'),
    pg_temp.m('00000000-0000-4000-8000-000000000e03', 'mn-mc'),
    pg_temp.m('00000000-0000-4000-8000-000000000e01', 'mn-ow'),
    pg_temp.m('00000000-0000-4000-8000-000000000e09', 'mn-g2'),
    pg_temp.m('00000000-0000-4000-8000-000000000e05', 'mn-me')));
  assert pg_temp.ids(got) = pg_temp.sorted(array['00000000-0000-4000-8000-000000000e03',
    '00000000-0000-4000-8000-000000000e01', '00000000-0000-4000-8000-000000000e05']::uuid[]),
    format('casos 3 y 18: g1 menciona a otros que {mc, ow, me}: %s', got);
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 4. Un miembro a una invitada: solo si ya participa. El dueño y un admin, a cualquiera que vea la página
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-000000000e03');
do $$
declare
  got jsonb;
begin
  perform public.add_comment('00000000-0000-4000-8000-000000000d03', '00000000-0000-4000-8000-000000000eb2',
    null, null, '@mn-g2 y @mn-g1');
  got := public.set_comment_mentions('00000000-0000-4000-8000-000000000d03', jsonb_build_array(
    pg_temp.m('00000000-0000-4000-8000-000000000e09', 'mn-g2'),
    pg_temp.m('00000000-0000-4000-8000-000000000e08', 'mn-g1')));
  assert pg_temp.ids(got) = array['00000000-0000-4000-8000-000000000e08']::uuid[],
    format('caso 4: mc (miembro) menciona a otras que g1: %s', got);
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-000000000e01');
do $$
declare
  got jsonb;
begin
  perform public.add_comment('00000000-0000-4000-8000-000000000d04', '00000000-0000-4000-8000-000000000eb2',
    null, null, '@mn-g2 mirá esto');
  got := public.set_comment_mentions('00000000-0000-4000-8000-000000000d04',
    jsonb_build_array(pg_temp.m('00000000-0000-4000-8000-000000000e09', 'mn-g2')));
  assert pg_temp.ids(got) = array['00000000-0000-4000-8000-000000000e09']::uuid[], 'caso 4: la dueña no menciona a g2';
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-000000000e02');
do $$
declare
  got jsonb;
begin
  perform public.add_comment('00000000-0000-4000-8000-000000000d05', '00000000-0000-4000-8000-000000000eb2',
    null, null, '@mn-g3 vos también');
  -- g3 ve la página (ver) y nunca comentó: un admin la menciona igual.
  got := public.set_comment_mentions('00000000-0000-4000-8000-000000000d05',
    jsonb_build_array(pg_temp.m('00000000-0000-4000-8000-000000000e10', 'mn-g3')));
  assert pg_temp.ids(got) = array['00000000-0000-4000-8000-000000000e10']::uuid[], 'caso 4: el admin no menciona a g3';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 5. La lista del `@` de cada uno
-- ---------------------------------------------------------------------------------------------------
-- Ven c: ow, ad, mc, mv, me, mo, g1, g2, g3 (m0 no). Comentaron en c: mc, g1, ow, ad.
select pg_temp.as_user('00000000-0000-4000-8000-000000000e03');
do $$
declare
  got uuid[] := pg_temp.candidates('00000000-0000-4000-8000-000000000eb2');
begin
  -- Un miembro: el equipo que ve la página (no él) y las invitadas que comentaron (g1), no g2 ni g3 ni m0.
  assert got = pg_temp.sorted(array['00000000-0000-4000-8000-000000000e01', '00000000-0000-4000-8000-000000000e02',
    '00000000-0000-4000-8000-000000000e04', '00000000-0000-4000-8000-000000000e05',
    '00000000-0000-4000-8000-000000000e07', '00000000-0000-4000-8000-000000000e08']::uuid[]),
    format('caso 5: la lista de mc: %s', got);
  assert not exists (select 1 from public.mention_candidates('00000000-0000-4000-8000-000000000eb2') c where not c.has_access),
    'caso 5: un miembro recibe filas sin acceso';
  assert (select c.label from public.mention_candidates('00000000-0000-4000-8000-000000000eb2') c
          where c.user_id = '00000000-0000-4000-8000-000000000e01') = 'mn-ow', 'caso 5: el rótulo no es la parte del correo';
  assert (select c.email from public.mention_candidates('00000000-0000-4000-8000-000000000eb2') c
          where c.user_id = '00000000-0000-4000-8000-000000000e01') = 'mn-ow@test.invalid', 'caso 5: sin el correo';
  -- Sin acceso a la página: page_not_found.
  perform pg_temp.expect_error($q$select * from public.mention_candidates('00000000-0000-4000-8000-000000000eb4')$q$,
    'page_not_found', 'caso 5: mc ve la lista de s');
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-000000000e01');
do $$
declare
  got uuid[] := pg_temp.candidates('00000000-0000-4000-8000-000000000eb2');
begin
  assert got = pg_temp.sorted(array['00000000-0000-4000-8000-000000000e02', '00000000-0000-4000-8000-000000000e03',
    '00000000-0000-4000-8000-000000000e04', '00000000-0000-4000-8000-000000000e05',
    '00000000-0000-4000-8000-000000000e07', '00000000-0000-4000-8000-000000000e08',
    '00000000-0000-4000-8000-000000000e09', '00000000-0000-4000-8000-000000000e10']::uuid[]),
    format('caso 5: la lista de la dueña: %s', got);
  assert not exists (select 1 from public.mention_candidates('00000000-0000-4000-8000-000000000eb2') c where not c.has_access),
    'caso 5: la dueña recibe filas sin acceso en la entrega 1';
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-000000000e02');
do $$
begin
  assert cardinality(pg_temp.candidates('00000000-0000-4000-8000-000000000eb2')) = 8, 'caso 5: el admin no ve a los 8';
  assert '00000000-0000-4000-8000-000000000e09' = any (pg_temp.candidates('00000000-0000-4000-8000-000000000eb2')),
    'caso 5: el admin no ve a g2';
end;
$$;

-- El miembro común dueño de P2: en c, como cualquier miembro; en x (suya), nadie más la ve: lista vacía (con la
-- parte "sin acceso" del borrador viejo recibía a todo el workspace).
select pg_temp.as_user('00000000-0000-4000-8000-000000000e07');
do $$
begin
  assert not ('00000000-0000-4000-8000-000000000e09' = any (pg_temp.candidates('00000000-0000-4000-8000-000000000eb2'))),
    'caso 5: mo ve a g2, que nunca comentó';
  assert not ('00000000-0000-4000-8000-000000000e06' = any (pg_temp.candidates('00000000-0000-4000-8000-000000000eb2'))),
    'caso 5: mo ve a m0, que no ve la página';
  assert cardinality(pg_temp.candidates('00000000-0000-4000-8000-000000000eb5')) = 0,
    format('caso 5: la lista de mo en su página x no está vacía: %s', pg_temp.candidates('00000000-0000-4000-8000-000000000eb5'));
end;
$$;

-- Con Ver: comment_denied (con ver no se comenta).
select pg_temp.as_user('00000000-0000-4000-8000-000000000e04');
select pg_temp.expect_error($q$select * from public.mention_candidates('00000000-0000-4000-8000-000000000eb2')$q$,
  'comment_denied', 'caso 5: mv (ver) recibe la lista');
-- Sin nada: page_not_found.
select pg_temp.as_user('00000000-0000-4000-8000-000000000e06');
select pg_temp.expect_error($q$select * from public.mention_candidates('00000000-0000-4000-8000-000000000eb2')$q$,
  'page_not_found', 'caso 5: m0 recibe la lista');

-- ---------------------------------------------------------------------------------------------------
-- 6. Lo que `set_comment_mentions` rechaza
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-000000000e03');
do $$
declare
  many jsonb := '[]';
  got jsonb;
begin
  -- Un comentario ajeno (k2 es de g1).
  perform pg_temp.expect_error($q$select public.set_comment_mentions('00000000-0000-4000-8000-000000000d02',
    jsonb_build_array(pg_temp.m('00000000-0000-4000-8000-000000000e01', 'mn-ow')))$q$, 'not_allowed', 'caso 6: comentario ajeno');
  -- 21 personas.
  for i in 1..21 loop
    many := many || jsonb_build_array(pg_temp.m(gen_random_uuid(), 'p' || i));
  end loop;
  perform pg_temp.expect_error(format('select public.set_comment_mentions(%L, %L::jsonb)',
    '00000000-0000-4000-8000-000000000d01', many), 'mentions_invalid', 'caso 6: 21 personas');
  -- Formas malas.
  perform pg_temp.expect_error($q$select public.set_comment_mentions('00000000-0000-4000-8000-000000000d01', '{}'::jsonb)$q$,
    'mentions_invalid', 'caso 6: no es una lista');
  perform pg_temp.expect_error($q$select public.set_comment_mentions('00000000-0000-4000-8000-000000000d01', null)$q$,
    'mentions_invalid', 'caso 6: nulo');
  perform pg_temp.expect_error($q$select public.set_comment_mentions('00000000-0000-4000-8000-000000000d01',
    '[{"user_id": "00000000-0000-4000-8000-000000000e04", "label": "mn-mv", "x": 1}]'::jsonb)$q$,
    'mentions_invalid', 'caso 6: una clave de más');
  perform pg_temp.expect_error($q$select public.set_comment_mentions('00000000-0000-4000-8000-000000000d01',
    '[{"user_id": "no-es-un-id", "label": "mn-mv"}]'::jsonb)$q$, 'mentions_invalid', 'caso 6: id malo');
  perform pg_temp.expect_error($q$select public.set_comment_mentions('00000000-0000-4000-8000-000000000d01',
    '[{"user_id": "00000000-0000-4000-8000-000000000e04", "label": 5}]'::jsonb)$q$, 'mentions_invalid', 'caso 6: rótulo no texto');
  -- Rótulos malos: con espacio, vacío, de 65, con @ (nunca 23514).
  perform pg_temp.expect_error($q$select public.set_comment_mentions('00000000-0000-4000-8000-000000000d01',
    jsonb_build_array(pg_temp.m('00000000-0000-4000-8000-000000000e04', 'mn mv')))$q$, 'mentions_invalid', 'caso 6: rótulo con espacio');
  perform pg_temp.expect_error($q$select public.set_comment_mentions('00000000-0000-4000-8000-000000000d01',
    jsonb_build_array(pg_temp.m('00000000-0000-4000-8000-000000000e04', '')))$q$, 'mentions_invalid', 'caso 6: rótulo vacío');
  perform pg_temp.expect_error($q$select public.set_comment_mentions('00000000-0000-4000-8000-000000000d01',
    jsonb_build_array(pg_temp.m('00000000-0000-4000-8000-000000000e04', repeat('a', 65))))$q$, 'mentions_invalid', 'caso 6: rótulo de 65');
  perform pg_temp.expect_error($q$select public.set_comment_mentions('00000000-0000-4000-8000-000000000d01',
    jsonb_build_array(pg_temp.m('00000000-0000-4000-8000-000000000e04', 'a@b')))$q$, 'mentions_invalid', 'caso 6: rótulo con @');
  -- Uno que no existe.
  perform pg_temp.expect_error($q$select public.set_comment_mentions(gen_random_uuid(), '[]'::jsonb)$q$,
    'comment_not_found', 'caso 6: comentario que no existe');
  -- Mencionarse a uno mismo se descarta (y el resto queda igual).
  got := public.set_comment_mentions('00000000-0000-4000-8000-000000000d01', jsonb_build_array(
    pg_temp.m('00000000-0000-4000-8000-000000000e04', 'mn-mv'), pg_temp.m('00000000-0000-4000-8000-000000000e03', 'mn-mc')));
  assert pg_temp.ids(got) = array['00000000-0000-4000-8000-000000000e04']::uuid[], format('caso 6: se menciona a sí mismo: %s', got);
  -- Un comentario borrado (k6, ed06).
  perform public.add_comment('00000000-0000-4000-8000-000000000d06', '00000000-0000-4000-8000-000000000eb2',
    null, null, 'borrame @mn-mv');
  perform public.delete_comment('00000000-0000-4000-8000-000000000d06');
  perform pg_temp.expect_error($q$select public.set_comment_mentions('00000000-0000-4000-8000-000000000d06',
    jsonb_build_array(pg_temp.m('00000000-0000-4000-8000-000000000e04', 'mn-mv')))$q$, 'comment_deleted', 'caso 6: comentario borrado');
end;
$$;

-- Un comentario de una página que no se ve: comment_not_found (no dice que existe).
select pg_temp.as_user('00000000-0000-4000-8000-000000000e06');
select pg_temp.expect_error($q$select public.set_comment_mentions('00000000-0000-4000-8000-000000000d01', '[]'::jsonb)$q$,
  'comment_not_found', 'caso 6: m0 sobre un comentario que no ve');

-- ---------------------------------------------------------------------------------------------------
-- 7. El mismo conjunto no cambia nada; el reintento con el permiso ya bajado da bien
-- ---------------------------------------------------------------------------------------------------
select set_config('role', 'postgres', true);
create temp table snap as
  select (select ctid::text from public.comment_mentions where comment_id = '00000000-0000-4000-8000-000000000d01'
            and user_id = '00000000-0000-4000-8000-000000000e04') as mention,
         (select ctid::text from public.comments where id = '00000000-0000-4000-8000-000000000d01') as comment;
grant select on snap to authenticated;

select pg_temp.as_user('00000000-0000-4000-8000-000000000e03');
do $$
declare
  got jsonb;
begin
  got := public.set_comment_mentions('00000000-0000-4000-8000-000000000d01',
    jsonb_build_array(pg_temp.m('00000000-0000-4000-8000-000000000e04', 'mn-mv')));
  assert pg_temp.ids(got) = array['00000000-0000-4000-8000-000000000e04']::uuid[], 'caso 7: el reintento no da lo mismo';
end;
$$;
select set_config('role', 'postgres', true);
do $$
begin
  assert (select ctid::text from public.comment_mentions where comment_id = '00000000-0000-4000-8000-000000000d01'
            and user_id = '00000000-0000-4000-8000-000000000e04') = (select mention from snap),
    'caso 7: repetir el conjunto tocó la mención';
  assert (select ctid::text from public.comments where id = '00000000-0000-4000-8000-000000000d01') = (select comment from snap),
    'caso 7: repetir el conjunto tocó el comentario';
end;
$$;
-- Sumar a alguien no toca la fila de quien ya estaba (mismo rótulo); después vuelve a quedar solo mv.
select pg_temp.as_user('00000000-0000-4000-8000-000000000e03');
select public.set_comment_mentions('00000000-0000-4000-8000-000000000d01', jsonb_build_array(
  pg_temp.m('00000000-0000-4000-8000-000000000e04', 'mn-mv'), pg_temp.m('00000000-0000-4000-8000-000000000e01', 'mn-ow')));
select set_config('role', 'postgres', true);
do $$
begin
  assert (select ctid::text from public.comment_mentions where comment_id = '00000000-0000-4000-8000-000000000d01'
            and user_id = '00000000-0000-4000-8000-000000000e04') = (select mention from snap),
    'caso 7: sumar a otra tocó la mención que ya estaba';
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-000000000e03');
select public.set_comment_mentions('00000000-0000-4000-8000-000000000d01',
  jsonb_build_array(pg_temp.m('00000000-0000-4000-8000-000000000e04', 'mn-mv')));
select set_config('role', 'postgres', true);
-- mc baja a Ver: el reintento idéntico da bien; uno distinto, comment_denied.
update public.grants set level = 'view' where user_id = '00000000-0000-4000-8000-000000000e03'
  and page_id = '00000000-0000-4000-8000-000000000eb2';
select pg_temp.as_user('00000000-0000-4000-8000-000000000e03');
do $$
begin
  perform public.set_comment_mentions('00000000-0000-4000-8000-000000000d01',
    jsonb_build_array(pg_temp.m('00000000-0000-4000-8000-000000000e04', 'mn-mv')));
  perform pg_temp.expect_error($q$select public.set_comment_mentions('00000000-0000-4000-8000-000000000d01', '[]'::jsonb)$q$,
    'comment_denied', 'caso 7: con Ver cambia las menciones');
end;
$$;
select set_config('role', 'postgres', true);
update public.grants set level = 'comment' where user_id = '00000000-0000-4000-8000-000000000e03'
  and page_id = '00000000-0000-4000-8000-000000000eb2';

-- ---------------------------------------------------------------------------------------------------
-- 8. Sacar del conjunto marca `removed_at` y deja de contar; volver la reactiva con `read_at` intacto
-- ---------------------------------------------------------------------------------------------------
-- k3 (de mc) nombra a g1. g1 la lee; mc la saca; g1 deja de contarla; mc la vuelve a poner: leída.
select pg_temp.as_user('00000000-0000-4000-8000-000000000e08');
do $$
declare
  n int;
begin
  assert pg_temp.unread() = 1, format('caso 8: g1 no tiene 1 sin leer: %s', public.mentions_inbox());
  n := public.mark_mentions_read(array(select (r ->> 'id')::uuid from jsonb_array_elements(public.mentions_inbox() -> 'rows') r));
  assert n = 1, 'caso 8: no marcó la leída';
  assert pg_temp.unread() = 0, 'caso 8: sigue sin leer';
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-000000000e03');
select public.set_comment_mentions('00000000-0000-4000-8000-000000000d03', '[]'::jsonb);
select set_config('role', 'postgres', true);
do $$
begin
  assert (select removed_at from public.comment_mentions where comment_id = '00000000-0000-4000-8000-000000000d03'
          and user_id = '00000000-0000-4000-8000-000000000e08') is not null, 'caso 8: sacarla no marca removed_at';
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-000000000e08');
do $$
declare
  box jsonb := public.mentions_inbox();
begin
  assert (box -> 'rows' -> 0 ->> 'gone')::boolean, format('caso 8: la sacada no llega gone: %s', box);
  assert (select count(*) from jsonb_object_keys(box -> 'rows' -> 0)) = 3, 'caso 8: la fila gone trae más que id, gone y updated_at';
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-000000000e03');
select public.set_comment_mentions('00000000-0000-4000-8000-000000000d03',
  jsonb_build_array(pg_temp.m('00000000-0000-4000-8000-000000000e08', 'mn-g1')));
select set_config('role', 'postgres', true);
do $$
begin
  assert (select removed_at is null and read_at is not null from public.comment_mentions
          where comment_id = '00000000-0000-4000-8000-000000000d03' and user_id = '00000000-0000-4000-8000-000000000e08'),
    'caso 8: volver no la reactiva o pierde read_at';
end;
$$;
-- Sin leer de nuevo para el caso 9.
update public.comment_mentions set read_at = null where comment_id = '00000000-0000-4000-8000-000000000d03';

-- ---------------------------------------------------------------------------------------------------
-- 9. Lo que deja de verse: permiso sacado, página movida, papelera, sacada del workspace
-- ---------------------------------------------------------------------------------------------------
-- k7 (ed07): de ow en g (debajo de c), nombra a mv.
select pg_temp.as_user('00000000-0000-4000-8000-000000000e01');
select public.add_comment('00000000-0000-4000-8000-000000000d07', '00000000-0000-4000-8000-000000000eb3',
  null, null, '@mn-mv en g');
select public.set_comment_mentions('00000000-0000-4000-8000-000000000d07',
  jsonb_build_array(pg_temp.m('00000000-0000-4000-8000-000000000e04', 'mn-mv')));

select pg_temp.as_user('00000000-0000-4000-8000-000000000e04');
do $$
begin
  assert pg_temp.unread() = 2, format('caso 9: mv no tiene 2 sin leer: %s', public.mentions_inbox());
end;
$$;

-- La página g sale de la rama de c (va debajo de s): la de g deja de verse; la de c, no.
select set_config('role', 'postgres', true);
update public.pages set parent_id = '00000000-0000-4000-8000-000000000eb4' where id = '00000000-0000-4000-8000-000000000eb3';
select pg_temp.as_user('00000000-0000-4000-8000-000000000e04');
do $$
declare
  box jsonb := public.mentions_inbox();
  g jsonb := (select r from jsonb_array_elements(box -> 'rows') r where (r ->> 'gone')::boolean);
begin
  assert pg_temp.unread() = 1, format('caso 9: la movida sigue contando: %s', box);
  assert g is not null and (select count(*) from jsonb_object_keys(g)) = 3, format('caso 9: la movida no llega gone y sin datos: %s', box);
  assert (select count(*) from jsonb_array_elements(public.mentions_index()) x where (x ->> 1)::boolean) = 1,
    'caso 9: el índice no da gone la movida';
  assert not (box::text like '%en g%'), 'caso 9: la movida deja ver el texto';
end;
$$;
select set_config('role', 'postgres', true);
update public.pages set parent_id = '00000000-0000-4000-8000-000000000eb2' where id = '00000000-0000-4000-8000-000000000eb3';

-- Le sacan el permiso a mv.
update public.grants set revoked_at = now() where user_id = '00000000-0000-4000-8000-000000000e04';
select pg_temp.as_user('00000000-0000-4000-8000-000000000e04');
do $$
declare
  box jsonb := public.mentions_inbox();
begin
  assert pg_temp.unread() = 0, format('caso 9: sin permiso sigue contando: %s', box);
  assert not exists (select 1 from jsonb_array_elements(box -> 'rows') r where not (r ->> 'gone')::boolean),
    'caso 9: sin permiso llega una fila con datos';
  assert not (box::text like '%toma 12%') and not (box::text like '%Plan de rodaje%'), 'caso 9: sin permiso deja ver texto o título';
  assert not exists (select 1 from jsonb_array_elements(public.mentions_index()) x where not (x ->> 1)::boolean),
    'caso 9: el índice no da gone sin permiso';
end;
$$;
select set_config('role', 'postgres', true);
update public.grants set revoked_at = null where user_id = '00000000-0000-4000-8000-000000000e04';

-- c en la papelera: mv (ver) y g1 (invitada) dejan de verla; ow (edita) la sigue viendo.
update public.pages set deleted_at = now() where id = '00000000-0000-4000-8000-000000000eb2';
select pg_temp.as_user('00000000-0000-4000-8000-000000000e04');
do $$
begin
  assert pg_temp.unread() = 0, 'caso 9: en la papelera mv sigue contando';
  assert not exists (select 1 from jsonb_array_elements(public.mentions_inbox() -> 'rows') r where not (r ->> 'gone')::boolean),
    'caso 9: en la papelera mv ve una fila';
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-000000000e08');
do $$
begin
  assert pg_temp.unread() = 0, 'caso 9: en la papelera g1 sigue contando';
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-000000000e01');
do $$
begin
  -- ow fue mencionada por g1 en k2: edita, la sigue viendo (la app la marca In trash).
  assert pg_temp.unread() = 1, format('caso 9: en la papelera ow no la ve: %s', public.mentions_inbox());
end;
$$;
select set_config('role', 'postgres', true);
update public.pages set deleted_at = null where id = '00000000-0000-4000-8000-000000000eb2';

-- Sacan a mv del workspace: campana vacía.
update public.members set removed_at = now() where user_id = '00000000-0000-4000-8000-000000000e04';
select pg_temp.as_user('00000000-0000-4000-8000-000000000e04');
do $$
declare
  box jsonb := public.mentions_inbox();
begin
  assert (box ->> 'unread')::int = 0 and jsonb_array_length(box -> 'rows') = 0, format('caso 9: sacada, la campana no está vacía: %s', box);
  assert jsonb_array_length(public.mentions_index()) = 0, 'caso 9: sacada, el índice no está vacío';
  assert public.mark_mentions_read(null, now()) = 0, 'caso 9: sacada, marca leídas';
end;
$$;
select set_config('role', 'postgres', true);
update public.members set removed_at = null where user_id = '00000000-0000-4000-8000-000000000e04';

-- ---------------------------------------------------------------------------------------------------
-- 10. Borrar el comentario: gone, `mentions` nulo, y `comment_authors` ya no da a la mencionada por él
-- ---------------------------------------------------------------------------------------------------
-- g3 solo aparece en k5 (del admin), como mencionada.
select pg_temp.as_user('00000000-0000-4000-8000-000000000e03');
do $$
begin
  assert '00000000-0000-4000-8000-000000000e10' in (select a.user_id from public.comment_authors('00000000-0000-4000-8000-000000000eb2') a),
    'caso 14: comment_authors no da a la mencionada';
  assert (select l.mentions from public.list_comments('00000000-0000-4000-8000-000000000eb2') l
          where l.id = '00000000-0000-4000-8000-000000000d05') = '[{"label": "mn-g3", "user_id": "00000000-0000-4000-8000-000000000e10"}]'::jsonb,
    'caso 14: list_comments no da las menciones';
  assert (select l.mentions from public.list_comments('00000000-0000-4000-8000-000000000eb2') l
          where l.id = '00000000-0000-4000-8000-000000000d06') is null, 'caso 10: un borrado da menciones';
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-000000000e02');
select public.delete_comment('00000000-0000-4000-8000-000000000d05');
select pg_temp.as_user('00000000-0000-4000-8000-000000000e03');
do $$
begin
  assert '00000000-0000-4000-8000-000000000e10' not in (select a.user_id from public.comment_authors('00000000-0000-4000-8000-000000000eb2') a),
    'caso 10: comment_authors da a la mencionada de un borrado';
  assert (select l.mentions from public.list_comments('00000000-0000-4000-8000-000000000eb2') l
          where l.id = '00000000-0000-4000-8000-000000000d05') is null, 'caso 10: list_comments da menciones de un borrado';
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-000000000e10');
do $$
declare
  box jsonb := public.mentions_inbox();
begin
  assert (box ->> 'unread')::int = 0, 'caso 10: el borrado sigue contando';
  assert (box -> 'rows' -> 0 ->> 'gone')::boolean and (select count(*) from jsonb_object_keys(box -> 'rows' -> 0)) = 3,
    format('caso 10: el borrado no llega gone: %s', box);
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 11. Con 55 sin leer, la campana cuenta 10 y trae como mucho 50 filas
-- ---------------------------------------------------------------------------------------------------
-- ad no ve s: mencionarla ahí se descarta. Después se le da Ver.
select pg_temp.as_user('00000000-0000-4000-8000-000000000e01');
do $$
begin
  perform public.add_comment('00000000-0000-4000-8000-000000000d09', '00000000-0000-4000-8000-000000000eb4', null, null, '@mn-ad');
  assert public.set_comment_mentions('00000000-0000-4000-8000-000000000d09',
    jsonb_build_array(pg_temp.m('00000000-0000-4000-8000-000000000e02', 'mn-ad'))) = '[]'::jsonb, 'caso 2: ad no ve s y se la menciona';
end;
$$;
select set_config('role', 'postgres', true);
insert into public.grants (user_id, page_id, level, granted_by) values
  ('00000000-0000-4000-8000-000000000e02', '00000000-0000-4000-8000-000000000eb4', 'view', '00000000-0000-4000-8000-000000000e01');
select pg_temp.as_user('00000000-0000-4000-8000-000000000e01');
do $$
declare
  k uuid;
begin
  for i in 1..55 loop
    k := gen_random_uuid();
    perform public.add_comment(k, '00000000-0000-4000-8000-000000000eb4', null, null, '@mn-ad ' || i);
    perform public.set_comment_mentions(k, jsonb_build_array(pg_temp.m('00000000-0000-4000-8000-000000000e02', 'mn-ad')));
  end loop;
end;
$$;
select pg_temp.as_user('00000000-0000-4000-8000-000000000e02');
do $$
begin
  assert pg_temp.unread() = 10, format('caso 11: con 55 sin leer no cuenta 10: %s', pg_temp.unread());
  assert jsonb_array_length(public.mentions_inbox(null, 1000) -> 'rows') = 50, 'caso 11: el tope de filas no es 50';
  assert jsonb_array_length(public.mentions_inbox(null, 0) -> 'rows') = 1, 'caso 11: el mínimo de filas no es 1';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 12. Leídas: solo las propias
-- ---------------------------------------------------------------------------------------------------
-- ad intenta marcar las de mv (k1) por id y todas hasta ahora: no toca las de nadie más.
select pg_temp.as_user('00000000-0000-4000-8000-000000000e02');
do $$
declare
  n int;
begin
  n := public.mark_mentions_read(array[gen_random_uuid()]);
  assert n = 0, 'caso 12: marca un id que no existe';
  n := public.mark_mentions_read(null, now());
  assert n = 55, format('caso 12: con p_up_to no marca sus 55: %s', n);
  assert pg_temp.unread() = 0, 'caso 12: le quedan sin leer';
  assert public.mark_mentions_read(null, now()) = 0, 'caso 12: repetir marca de nuevo';
  perform pg_temp.expect_error($q$select public.mark_mentions_read(array(select gen_random_uuid() from generate_series(1, 501)))$q$,
    'ids_invalid', 'caso 12: 501 ids');
end;
$$;
select set_config('role', 'postgres', true);
create temp table mv_mention as
  select id from public.comment_mentions where user_id = '00000000-0000-4000-8000-000000000e04'
    and comment_id = '00000000-0000-4000-8000-000000000d01';
grant select on mv_mention to authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000e02');
select public.mark_mentions_read(array(select id from mv_mention));
select set_config('role', 'postgres', true);
do $$
begin
  assert (select read_at from public.comment_mentions where id = (select id from mv_mention)) is null,
    'caso 12: ad marcó leída una mención de mv';
  assert (select count(*) from public.comment_mentions where user_id = '00000000-0000-4000-8000-000000000e04' and read_at is not null) = 0,
    'caso 12: p_up_to de ad tocó las de mv';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 13. Nadie lee ni escribe la tabla; anon no ejecuta nada
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-000000000e01');
select pg_temp.expect_error('select * from public.comment_mentions', '42501', 'caso 13: la dueña lee la tabla');
select pg_temp.expect_error($q$insert into public.comment_mentions (comment_id, page_id, user_id, label) values
  ('00000000-0000-4000-8000-000000000d01', '00000000-0000-4000-8000-000000000eb2', '00000000-0000-4000-8000-000000000e02', 'x')$q$,
  '42501', 'caso 13: la dueña inserta');
select pg_temp.expect_error('update public.comment_mentions set read_at = now()', '42501', 'caso 13: la dueña cambia la tabla');
select pg_temp.expect_error('delete from public.comment_mentions', '42501', 'caso 13: la dueña borra de la tabla');
select set_config('role', 'postgres', true);
do $$
begin
  assert not has_table_privilege('anon', 'public.comment_mentions', 'select'), 'caso 13: anon lee la tabla';
  assert not has_table_privilege('authenticated', 'public.comment_mentions', 'select'), 'caso 13: authenticated lee la tabla';
  assert not has_function_privilege('anon', 'public.mention_candidates(uuid)', 'execute'), 'caso 13: anon pide candidatos';
  assert not has_function_privilege('anon', 'public.set_comment_mentions(uuid, jsonb)', 'execute'), 'caso 13: anon menciona';
  assert not has_function_privilege('anon', 'public.mentions_inbox(timestamptz, int)', 'execute'), 'caso 13: anon ve la campana';
  assert not has_function_privilege('anon', 'public.mentions_index()', 'execute'), 'caso 13: anon ve el índice';
  assert not has_function_privilege('anon', 'public.mark_mentions_read(uuid[], timestamptz)', 'execute'), 'caso 13: anon marca leídas';
  assert not has_function_privilege('anon', 'public.list_comments(uuid, timestamptz)', 'execute'), 'caso 13: anon lista comentarios';
  assert not has_function_privilege('anon', 'public.comment_authors(uuid)', 'execute'), 'caso 13: anon ve autores';
  assert not has_function_privilege('authenticated', 'private.mention_allowed(uuid, uuid, uuid)', 'execute'), 'caso 13: la regla se llama desde la API';
  assert not has_function_privilege('authenticated', 'private.mention_label(text)', 'execute'), 'caso 13: el rótulo se llama desde la API';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 14. `list_comments`: las columnas del link público y después `mentions`
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  assert pg_get_function_result('public.list_comments(uuid, timestamptz)'::regprocedure) like
    '%imported_by uuid, plink_id uuid, plink_author text, mentions jsonb)', 'caso 14: list_comments no termina en plink_id, plink_author, mentions';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 15. La versión mínima: sin header, `set_comment_mentions` da app_outdated salvo el reintento idéntico
-- ---------------------------------------------------------------------------------------------------
update public.workspace_settings set min_app_version = 9.000;
select pg_temp.as_session('00000000-0000-4000-8000-000000000e03', '[{"method": "otp"}]');
select set_config('request.headers', '{}', true);
do $$
begin
  perform pg_temp.expect_error($q$select public.set_comment_mentions('00000000-0000-4000-8000-000000000d01',
    jsonb_build_array(pg_temp.m('00000000-0000-4000-8000-000000000e01', 'mn-ow')))$q$, 'app_outdated', 'caso 15: sin header escribe');
  -- Un conjunto distinto aunque no cambie nada (m0 se descartaría): también app_outdated (la función mira la
  -- versión antes de escribir, no solo el disparador de `comments`).
  perform pg_temp.expect_error($q$select public.set_comment_mentions('00000000-0000-4000-8000-000000000d01',
    jsonb_build_array(pg_temp.m('00000000-0000-4000-8000-000000000e04', 'mn-mv'),
                      pg_temp.m('00000000-0000-4000-8000-000000000e06', 'mn-m0')))$q$, 'app_outdated', 'caso 15: sin header, conjunto distinto');
  perform public.set_comment_mentions('00000000-0000-4000-8000-000000000d01',
    jsonb_build_array(pg_temp.m('00000000-0000-4000-8000-000000000e04', 'mn-mv')));
  perform public.mark_mentions_read(null, now());
end;
$$;
select set_config('role', 'postgres', true);
update public.workspace_settings set min_app_version = null;

-- ---------------------------------------------------------------------------------------------------
-- 16. Importar nunca menciona
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-000000000e01');
select public.import_comment('00000000-0000-4000-8000-000000000d08', '00000000-0000-4000-8000-000000000eb2', null, null,
  '@mn-mc y @[Ana](superhuman://users/123)', '2025-01-02T00:00:00Z', null, 'coda', null, null);
select set_config('role', 'postgres', true);
do $$
begin
  assert not exists (select 1 from public.comment_mentions where comment_id = '00000000-0000-4000-8000-000000000d08'),
    'caso 16: importar crea menciones';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 17. Una sesión con contraseña no menciona ni ve la campana
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_session('00000000-0000-4000-8000-000000000e03', '[{"method": "password"}]');
do $$
begin
  perform pg_temp.expect_error($q$select * from public.mention_candidates('00000000-0000-4000-8000-000000000eb2')$q$,
    'page_not_found', 'caso 17: con contraseña recibe la lista');
  assert (public.mentions_inbox() ->> 'unread')::int = 0 and jsonb_array_length(public.mentions_inbox() -> 'rows') = 0,
    'caso 17: con contraseña ve la campana';
  assert jsonb_array_length(public.mentions_index()) = 0, 'caso 17: con contraseña ve el índice';
  perform pg_temp.expect_error($q$select public.set_comment_mentions('00000000-0000-4000-8000-000000000d01', '[]'::jsonb)$q$,
    'comment_not_found', 'caso 17: con contraseña cambia las menciones');
end;
$$;
-- Y la regla, aun llamada con el id de alguien con sesión de contraseña como quien escribe, no lo deja.
select set_config('role', 'postgres', true);

rollback;
select 'ok' as result;
