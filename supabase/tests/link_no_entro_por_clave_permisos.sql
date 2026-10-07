-- Pruebas de lo que no entró de un link en una página, pedido por clave (20261114120000_link_no_entro_por_clave.sql):
-- `public_link_updates_page`, recorrida desde la última fila recibida, da a quien ve lo borrado de la página exactamente
-- las filas de `public_link_updates_of` (las primeras 500) y todas las que siguen, cada una una sola vez y en su orden,
-- con cualquier tamaño de página y aunque la API le recorte cada respuesta; `total` dice cuántas quedaban; lo que cambia
-- entre dos pedidos no corre ni saltea las demás; a quien no ve lo borrado no le da nada; y `public_link_updates_of`
-- sigue igual. Corre dentro de una transacción que se deshace al final: no deja usuarios ni datos. Si todo pasa,
-- devuelve una fila con result = 'ok'.

begin;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-00000000' || s)::uuid;
$$;

create function pg_temp.as_user(s text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(s), 'role', 'authenticated')::text, true),
         set_config('request.headers', '{"x-shotdocs-version": "9.999"}', true);
$$;

create function pg_temp.as_postgres() returns void language sql as $$
  select set_config('role', 'postgres', true),
         set_config('request.jwt.claims', '', true),
         set_config('request.headers', '', true);
$$;

-- El error tiene que ser ese, con su mensaje **y** su código (la app decide por el código: `P0002` es definitivo).
create function pg_temp.expect_error(stmt text, expected text, what text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate || ' ' || sqlerrm = expected then
      return;
    end if;
    raise exception 'FALLA: % (dio % %)', what, sqlstate, sqlerrm;
  end;
  raise exception 'FALLA: %', what;
end;
$$;

-- La lista entera como la junta la app: pide de a `page_rows` filas desde la última que recibió (`n`), con el orden
-- escrito en el pedido, y termina cuando lo recibido en una respuesta alcanza el `total` que traen sus filas, o con una
-- respuesta vacía; nunca por haber recibido pocas. `keep`: la API le entrega solo las primeras tantas filas de cada
-- respuesta (un tope de filas por pedido menor que la página). `requests`: cuántos pedidos hicieron falta.
create function pg_temp.walk(who text, page uuid, page_rows int, keep int default null)
returns table (ord bigint, id uuid, n bigint, state text, requests int) language plpgsql as $$
declare
  r       record;
  after_n bigint;
  got     bigint := 0;
  in_page int;
  left_   bigint;
  reqs    int := 0;
begin
  perform pg_temp.as_user(who);
  loop
    reqs := reqs + 1;
    if reqs > 3000 then
      raise exception 'FALLA: la lista no termina';
    end if;
    in_page := 0;
    left_ := 0;
    for r in
      select q.id as rid, q.n as rn, q.state as rstate, q.total as rtotal
      from (select a.* from public.public_link_updates_page(page, after_n, page_rows) a order by a.n limit keep) q
      order by q.n
    loop
      in_page := in_page + 1;
      got := got + 1;
      left_ := r.rtotal;
      after_n := r.rn;
      ord := got; id := r.rid; n := r.rn; state := r.rstate; requests := reqs;
      return next;
    end loop;
    exit when in_page = 0 or in_page = left_;
  end loop;
  perform pg_temp.as_postgres();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Datos
-- ---------------------------------------------------------------------------------------------------
-- Personas: a (miembro, crea P y comparte S), e (Editar P: ve lo borrado), g (invitado con Editar P), c (Comentar P),
-- x (miembro sin nada en P). P: R › S (la del link) › H.
update public.members set removed_at = now() where role = 'owner' and removed_at is null;
update public.workspace_settings
set min_app_version = 0.5, clean_min_version = 0.5, link_edit_min_version = 0.5, link_limits = '{}' where id;
insert into auth.users (id, email, aud, role) values
  (pg_temp.u('d1a0'), 'lk-o@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('d1a1'), 'lk-a@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('d1a5'), 'lk-g@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('d1a6'), 'lk-e@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('d1a7'), 'lk-c@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('d1a8'), 'lk-x@test.invalid', 'authenticated', 'authenticated');
insert into public.members (user_id, role) values
  (pg_temp.u('d1a0'), 'owner'), (pg_temp.u('d1a1'), 'member'), (pg_temp.u('d1a5'), 'guest'),
  (pg_temp.u('d1a6'), 'member'), (pg_temp.u('d1a7'), 'member'), (pg_temp.u('d1a8'), 'member');
insert into public.workspaces (id, owner_id, name) values (pg_temp.u('d1e0'), pg_temp.u('d1a1'), 'P');
insert into public.pages (id, workspace_id, parent_id, title, sort_key, settings) values
  (pg_temp.u('d1b0'), pg_temp.u('d1e0'), null, 'R', 'a0', '{}'),
  (pg_temp.u('d1b2'), pg_temp.u('d1e0'), pg_temp.u('d1b0'), 'S', 'a0', '{}'),
  (pg_temp.u('d1b3'), pg_temp.u('d1e0'), pg_temp.u('d1b2'), 'H', 'a0', '{}');
insert into public.grants (user_id, project_id, page_id, level) values
  (pg_temp.u('d1a5'), pg_temp.u('d1e0'), null, 'edit_pages'),
  (pg_temp.u('d1a6'), pg_temp.u('d1e0'), null, 'edit'),
  (pg_temp.u('d1a7'), pg_temp.u('d1e0'), null, 'comment');

create temp table lk (id uuid);
do $$
declare
  made jsonb;
begin
  perform pg_temp.as_user('d1a1');
  made := public.create_public_link(pg_temp.u('d1c0'), pg_temp.u('d1b2'), 'edit');
  perform pg_temp.as_postgres();
  insert into lk values ((made ->> 'id')::uuid);
end;
$$;

-- En S, 1203 filas en orden de llegada: de cada tres, una apartada y dos que esperan; y cada 50, una ya admitida (no
-- es de la lista). En H, 7 que esperan.
insert into public.public_link_updates (link_id, page_id, client_update_id, update, bytes, author, app_version,
                                        decided_at, decision, reason)
select (select id from lk), pg_temp.u('d1b2'), gen_random_uuid(), '\x01'::bytea, 1 + i % 9, 'Ana ' || i, 1.0,
       case when i % 3 = 0 then now() end, case when i % 3 = 0 then 'aside' end, case when i % 3 = 0 then 'bad_shape' end
from generate_series(1, 1203) i;
insert into public.public_link_updates (link_id, page_id, client_update_id, update, bytes, author, app_version,
                                        decided_at, decision, admitted_seq)
select (select id from lk), pg_temp.u('d1b2'), gen_random_uuid(), null, 1, 'Entró', 1.0, now(), 'admitted', i
from generate_series(1, 24) i;
insert into public.public_link_updates (link_id, page_id, client_update_id, update, bytes, author, app_version)
select (select id from lk), pg_temp.u('d1b3'), gen_random_uuid(), '\x01'::bytea, 1, 'Beto', 1.0 from generate_series(1, 7);

-- ---------------------------------------------------------------------------------------------------
-- Las mismas filas que `public_link_updates_of`, y todas las que esa corta
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  old_rows jsonb;
  new_rows jsonb;
  tmin     bigint;
  tmax     bigint;
  last_n   bigint;
  reqs     int;
  cnt      bigint;
  dcnt     bigint;
  cfg      record;
  want     jsonb;
  got      jsonb;
begin
  perform pg_temp.as_user('d1a6');
  select jsonb_agg(jsonb_build_array(o.id, o.link_id, o.author, o.created_at, o.bytes, o.state, o.reason) order by ord) into old_rows
  from public.public_link_updates_of(pg_temp.u('d1b2')) with ordinality as o (id, link_id, author, created_at, bytes, state, reason, ord);
  select jsonb_agg(jsonb_build_array(p.id, p.link_id, p.author, p.created_at, p.bytes, p.state, p.reason) order by ord), min(p.total), max(p.total)
  into new_rows, tmin, tmax
  from public.public_link_updates_page(pg_temp.u('d1b2')) with ordinality as p (id, link_id, author, created_at, bytes, state, reason, n, total, ord);
  assert jsonb_array_length(old_rows) = 500, 'public_link_updates_of ya no corta en 500';
  assert new_rows = old_rows, 'la primera página no trae las filas de public_link_updates_of, con sus valores y en su orden';
  assert tmin = 1203 and tmax = 1203, format('el total de la primera página no es 1203 (%s a %s)', tmin, tmax);
  assert (select count(*) from public.public_link_updates_page(pg_temp.u('d1b2'), null, 0)) = 1, 'p_limit 0 no da una fila';
  assert (select count(*) from public.public_link_updates_page(pg_temp.u('d1b2'), null, 5000)) = 1000, 'p_limit no tiene techo en 1000';
  assert (select count(*) from public.public_link_updates_page(pg_temp.u('d1b2'), null, null)) = 500, 'sin p_limit no da 500';
  -- Desde la fila 500: quedan 703, y la primera es la 501.
  select max(p.n) into last_n from public.public_link_updates_page(pg_temp.u('d1b2'), null, 500) p;
  assert (select min(p.total) from public.public_link_updates_page(pg_temp.u('d1b2'), last_n, 10) p) = 703, 'el total no cuenta desde p_after';
  perform pg_temp.as_postgres();

  -- Todas, una vez cada una y en orden de llegada, con cada tamaño de página y cada tope de la API; sin un pedido de más.
  select jsonb_agg(u.id order by u.n) into want
  from public.public_link_updates u
  where u.page_id = pg_temp.u('d1b2') and (u.decided_at is null or u.decision = 'aside');
  assert jsonb_array_length(want) = 1203, 'los datos de la prueba';
  for cfg in select * from (values (1000, null::int), (500, null), (137, null), (1000, 137), (500, 137)) v (page_rows, keep) loop
    select jsonb_agg(w.id order by w.ord), max(w.requests) into got, reqs from pg_temp.walk('d1a6', pg_temp.u('d1b2'), cfg.page_rows, cfg.keep) w;
    assert got = want, format('con páginas de %s y tope %s la lista no llega entera, una vez y en orden', cfg.page_rows, cfg.keep);
    assert reqs = ceil(1203.0 / least(cfg.page_rows, coalesce(cfg.keep, 1000))),
      format('con páginas de %s y tope %s hicieron falta %s pedidos', cfg.page_rows, cfg.keep, reqs);
  end loop;
  -- De a una fila (un tope de 1): las 7 de H, en 7 pedidos.
  for cfg in select * from (values (1000, 1), (1, null::int)) v (page_rows, keep) loop
    select count(*), count(distinct w.id), max(w.requests) into cnt, dcnt, reqs from pg_temp.walk('d1a6', pg_temp.u('d1b3'), cfg.page_rows, cfg.keep) w;
    assert cnt = 7 and dcnt = 7 and reqs = 7, format('de a una fila: %s filas (%s distintas) en %s pedidos', cnt, dcnt, reqs);
  end loop;
  -- Los estados: lo apartado, lo que espera y, si el link deja de editar la página, lo retenido.
  assert (select jsonb_object_agg(s.state, s.c) from (select w.state, count(*) as c from pg_temp.walk('d1a6', pg_temp.u('d1b2'), 1000) w group by 1) s)
         = '{"aside": 401, "waiting": 802}', 'los estados de S';
  update public.public_links set level = 'comment' where id = (select id from lk);
  assert (select jsonb_object_agg(s.state, s.c) from (select w.state, count(*) as c from pg_temp.walk('d1a6', pg_temp.u('d1b2'), 1000) w group by 1) s)
         = '{"aside": 401, "held": 802}', 'lo retenido de S';
  update public.public_links set level = 'edit' where id = (select id from lk);
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Lo que cambia entre dos pedidos no corre ni saltea las demás filas
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  first_ids uuid[];
  rest_ids  uuid[];
  last_n    bigint;
  gone      uuid;
  fresh     uuid := gen_random_uuid();
begin
  perform pg_temp.as_user('d1a6');
  select array_agg(p.id order by p.n), max(p.n) into first_ids, last_n from public.public_link_updates_page(pg_temp.u('d1b2'), null, 400) p;
  perform pg_temp.as_postgres();
  -- Entre los dos pedidos: una fila ya recibida y otra por recibir se admiten (salen de la lista), y llega una nueva.
  update public.public_link_updates set decided_at = now(), decision = 'admitted', admitted_seq = 901, update = null where id = first_ids[2];
  select u.id into gone from public.public_link_updates u
  where u.page_id = pg_temp.u('d1b2') and u.decided_at is null and u.n > last_n order by u.n offset 40 limit 1;
  update public.public_link_updates set decided_at = now(), decision = 'admitted', admitted_seq = 902, update = null where id = gone;
  insert into public.public_link_updates (id, link_id, page_id, client_update_id, update, bytes, author, app_version)
  values (fresh, (select id from lk), pg_temp.u('d1b2'), gen_random_uuid(), '\x01'::bytea, 1, 'Nueva', 1.0);
  perform pg_temp.as_user('d1a6');
  select array_agg(p.id order by p.n) into rest_ids from public.public_link_updates_page(pg_temp.u('d1b2'), last_n, 1000) p;
  assert (select min(p.total) from public.public_link_updates_page(pg_temp.u('d1b2'), last_n, 1000) p) = 803, 'el total después del cambio';
  perform pg_temp.as_postgres();
  assert not (first_ids && rest_ids), 'una fila llegó dos veces';
  assert not gone = any (rest_ids), 'llegó una fila que ya entró a la página';
  assert rest_ids[array_length(rest_ids, 1)] = fresh, 'la fila nueva no llegó al final';
  assert array_length(rest_ids, 1) = 803, 'el segundo pedido no trae las 803 que siguen';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Quién la ve, permisos y lo que no cambió
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  who text;
begin
  -- Quien comparte la página también la ve; un invitado con Editar, quien comenta y quien no tiene nada, no.
  perform pg_temp.as_user('d1a1');
  assert (select count(*) from public.public_link_updates_page(pg_temp.u('d1b3'))) = 7, 'quien comparte no ve lo de H';
  foreach who in array array['d1a5', 'd1a7', 'd1a8'] loop
    perform pg_temp.as_user(who);
    perform pg_temp.expect_error(format('select * from public.public_link_updates_page(%L)', pg_temp.u('d1b2')), 'P0002 page_not_found',
                                 format('%s recibe lo que no entró de un link', who));
    perform pg_temp.expect_error(format('select * from public.public_link_updates_of(%L)', pg_temp.u('d1b2')), 'P0002 page_not_found',
                                 format('%s recibe public_link_updates_of', who));
  end loop;
  perform pg_temp.expect_error(format('select * from public.public_link_updates_page(%L)', pg_temp.u('d1ff')), 'P0002 page_not_found',
                               'una página que no existe da filas');
  perform pg_temp.expect_error('select * from public.public_link_updates_page(null)', 'P0002 page_not_found', 'sin página da filas');
  perform pg_temp.as_postgres();

  assert not has_function_privilege('anon', 'public.public_link_updates_page(uuid, bigint, int)', 'execute'), 'anon la ejecuta';
  assert has_function_privilege('authenticated', 'public.public_link_updates_page(uuid, bigint, int)', 'execute'), 'una cuenta no la ejecuta';
  assert not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                     where p.oid = 'public.public_link_updates_page(uuid, bigint, int)'::regprocedure and a.grantee = 0), 'PUBLIC la ejecuta';
  -- Los mismos permisos que la función de siempre, rol por rol.
  assert (select array_agg(a.grantee::regrole::text || ':' || a.privilege_type order by 1) from pg_proc p, aclexplode(p.proacl) a
          where p.oid = 'public.public_link_updates_page(uuid, bigint, int)'::regprocedure)
         = (select array_agg(a.grantee::regrole::text || ':' || a.privilege_type order by 1) from pg_proc p, aclexplode(p.proacl) a
            where p.oid = 'public.public_link_updates_of(uuid)'::regprocedure), 'los permisos no son los de public_link_updates_of';
  assert (select p.provolatile = 's' and p.prosecdef and p.proconfig = array['search_path=""'] from pg_proc p
          where p.oid = 'public.public_link_updates_page(uuid, bigint, int)'::regprocedure), 'no es STABLE, SECURITY DEFINER y con search_path vacío';
  -- La de siempre: la misma firma, las mismas columnas y los mismos permisos.
  assert pg_get_function_result('public.public_link_updates_of(uuid)'::regprocedure)
         = 'TABLE(id uuid, link_id uuid, author text, created_at timestamp with time zone, bytes integer, state text, reason text)',
         'public_link_updates_of cambió de columnas';
  assert not has_function_privilege('anon', 'public.public_link_updates_of(uuid)', 'execute')
         and has_function_privilege('authenticated', 'public.public_link_updates_of(uuid)', 'execute'), 'public_link_updates_of cambió de permisos';
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'public_link_updates_page') = 1, 'hay más de una public_link_updates_page';
end;
$$;

rollback;
select 'ok' as result;
