-- Pruebas del link público, entrega 2c (20261029120000_link_apartado.sql, Docs/Doc_Link_Publico.md, "Cómo quedó la 2c"):
-- `public_link_aside()` (lo apartado para Share y el árbol: solo a quien ve lo borrado de la página, también lo de un link
-- reseteado, sin bytes) y el orden de la admisión por (página, link, dispositivo) (O3: una fila con una versión inventada
-- traba solo lo que sigue de su dispositivo, no lo de los demás visitantes del link). Corre dentro de una transacción que
-- se deshace al final: no deja usuarios ni datos. Si todo pasa, devuelve una fila con result = 'ok'.

begin;

create or replace function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-00000000' || s)::uuid;
$$;

create or replace function pg_temp.as_user(s text, ver text default '9.999') returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', pg_temp.u(s), 'role', 'authenticated')::text, true),
         set_config('request.headers', json_build_object('x-shotdocs-version', ver)::text, true);
$$;

create or replace function pg_temp.as_anon(tok text, dev text, ver text) returns void language sql as $$
  select set_config('role', 'anon', true),
         set_config('request.jwt.claims', '{"role": "anon"}', true),
         set_config('request.headers',
                    jsonb_build_object('x-shotdocs-link', tok, 'x-shotdocs-device', dev, 'x-shotdocs-version', ver)::text,
                    true);
$$;

create or replace function pg_temp.as_postgres() returns void language sql as $$
  select set_config('role', 'postgres', true),
         set_config('request.jwt.claims', '', true),
         set_config('request.headers', '', true);
$$;

create or replace function pg_temp.try(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'ok';
exception when others then
  return 'error:' || case when sqlstate = 'PGRST' then sqlerrm::json ->> 'message' else sqlerrm end;
end;
$$;

create or replace function pg_temp.check(got text, want text, what text) returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FALLA: % (dio %, se esperaba %)', what, got, want;
  end if;
end;
$$;

create temp table tk2c (name text primary key, id uuid, token text);
create or replace function pg_temp.save(n text, j jsonb) returns void language sql security definer as $$
  insert into pg_temp.tk2c values (n, (j ->> 'id')::uuid, j ->> 'token')
  on conflict (name) do update set id = excluded.id, token = excluded.token;
$$;
create or replace function pg_temp.tok(n text) returns text language sql security definer as $$
  select token from pg_temp.tk2c where name = n;
$$;
create or replace function pg_temp.lid(n text) returns uuid language sql security definer as $$
  select id from pg_temp.tk2c where name = n;
$$;

-- El visitante escribe con su token, su dispositivo y su versión.
create or replace function pg_temp.push(tok text, page text, cid text, dev text, ver text default '1.000')
returns text language plpgsql as $$
declare
  r text;
begin
  perform pg_temp.as_anon(tok, dev, ver);
  r := pg_temp.try(format('select public.plink_push_page_update(%L, %L, %L, %L, %L)',
                          pg_temp.u(page), pg_temp.u(cid), 'AQ==', ver, 'Ana'));
  perform pg_temp.as_postgres();
  return r;
end;
$$;

create or replace function pg_temp.room(cid text) returns public.public_link_updates language sql security definer as $$
  select * from public.public_link_updates where client_update_id = pg_temp.u(cid);
$$;

create or replace function pg_temp.dec(cid text, ok boolean, reason text default null) returns jsonb
language sql security definer as $$
  select jsonb_strip_nulls(jsonb_build_object('id', (pg_temp.room(cid)).id, 'ok', ok, 'reason', reason));
$$;

create or replace function pg_temp.admit(who text, page text, decisions jsonb) returns text language plpgsql as $$
declare
  r jsonb;
  t text;
begin
  perform pg_temp.as_user(who);
  begin
    r := public.link_admit(pg_temp.u(page), '9.999', decisions);
    select string_agg(x ->> 'decision' || coalesce(':' || (x ->> 'reason'), ''), ',' order by o)
    into t from jsonb_array_elements(r) with ordinality as a (x, o);
  exception when others then
    t := 'error:' || sqlerrm;
  end;
  perform pg_temp.as_postgres();
  return coalesce(t, '');
end;
$$;

create or replace function pg_temp.cid_of(p_id uuid) returns uuid language sql security definer as $$
  select client_update_id from public.public_link_updates where id = p_id;
$$;

-- Lo que `link_admit_work` le da a una persona para S: los client_update_id (los 4 últimos dígitos), en orden.
create or replace function pg_temp.work(who text) returns text language plpgsql as $$
declare
  t text;
begin
  perform pg_temp.as_user(who);
  select string_agg(right(pg_temp.cid_of(w.id)::text, 4), ',' order by w.page_id, w.link_id, w.n) into t
  from public.link_admit_work('9.999', array[pg_temp.u('c2b2')]) w;
  perform pg_temp.as_postgres();
  return coalesce(t, '');
end;
$$;

-- Lo que `public_link_aside` le da a una persona: "<página>/<raíz del link>:<motivo>", ordenado (en una transacción todo
-- tiene la misma hora).
create or replace function pg_temp.aside(who text) returns text language plpgsql as $$
declare
  t text;
begin
  perform pg_temp.as_user(who);
  select string_agg(p.title || '/' || r.title || ':' || coalesce(a.reason, 'sin motivo'), ',' order by p.title, a.reason) into t
  from public.public_link_aside() a
  join public.pages p on p.id = a.page_id
  join public.pages r on r.id = a.link_page_id;
  perform pg_temp.as_postgres();
  return coalesce(t, '');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Datos
-- ---------------------------------------------------------------------------------------------------
-- Personas: a (miembro, crea P y comparte S), e (Editar P: ve lo borrado y admite), g (invitado con Editar P), c
-- (Comentar P), e2 (Editar solo en Sib).
update public.members set removed_at = now() where role = 'owner' and removed_at is null;
update public.workspace_settings
set min_app_version = 0.5, clean_min_version = 0.5, link_edit_min_version = 0.5, link_limits = '{}' where id;
insert into auth.users (id, email, aud, role) values
  (pg_temp.u('c2a0'), 'la-o@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('c2a1'), 'la-a@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('c2a5'), 'la-g@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('c2a6'), 'la-e@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('c2a7'), 'la-c@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('c2a9'), 'la-e2@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('c2a8'), 'la-h@test.invalid', 'authenticated', 'authenticated');
insert into public.members (user_id, role) values
  (pg_temp.u('c2a0'), 'owner'), (pg_temp.u('c2a1'), 'member'), (pg_temp.u('c2a5'), 'guest'),
  (pg_temp.u('c2a6'), 'member'), (pg_temp.u('c2a7'), 'member'), (pg_temp.u('c2a9'), 'member'),
  (pg_temp.u('c2a8'), 'member');
insert into public.workspaces (id, owner_id, name) values (pg_temp.u('c2e0'), pg_temp.u('c2a1'), 'P');
-- P: R › S (la del link) › H; R › Sib.
insert into public.pages (id, workspace_id, parent_id, title, sort_key, settings) values
  (pg_temp.u('c2b0'), pg_temp.u('c2e0'), null, 'R', 'a0', '{}'),
  (pg_temp.u('c2b2'), pg_temp.u('c2e0'), pg_temp.u('c2b0'), 'S', 'a0', '{}'),
  (pg_temp.u('c2b3'), pg_temp.u('c2e0'), pg_temp.u('c2b2'), 'H', 'a0', '{}'),
  (pg_temp.u('c2b7'), pg_temp.u('c2e0'), pg_temp.u('c2b0'), 'Sib', 'a1', '{}');
insert into public.grants (user_id, project_id, page_id, level) values
  (pg_temp.u('c2a5'), pg_temp.u('c2e0'), null, 'edit_pages'),
  (pg_temp.u('c2a6'), pg_temp.u('c2e0'), null, 'edit'),
  (pg_temp.u('c2a7'), pg_temp.u('c2e0'), null, 'comment'),
  (pg_temp.u('c2a9'), null, pg_temp.u('c2b7'), 'edit'),
  (pg_temp.u('c2a8'), null, pg_temp.u('c2b3'), 'edit');

do $$
begin
  perform pg_temp.as_user('c2a1');
  perform pg_temp.save('S', public.create_public_link(pg_temp.u('c2c0'), pg_temp.u('c2b2'), 'edit'));
  perform pg_temp.as_postgres();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- O3: una versión inventada traba solo su dispositivo
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  devx text := 'devXXXXXXXXXXXXXXXXXXXX';
  devy text := 'devYYYYYYYYYYYYYYYYYYYY';
begin
  -- X manda con una versión que ninguna app tiene; después Y, honesto, dos filas.
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'c2b2', 'f001', devx, '9999'), 'ok', 'X no escribe con 9999');
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'c2b2', 'f002', devy), 'ok', 'Y no escribe');
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'c2b2', 'f003', devy), 'ok', 'Y no escribe la segunda');
  assert (pg_temp.room('f001')).app_version = 9999, 'la versión inventada no quedó como vino';

  -- La página aparece para admitir (lo de Y), y los bytes son solo los de Y.
  perform pg_temp.as_user('c2a6');
  assert (select a.waiting from public.link_admit_pages('9.999') a where a.page_id = pg_temp.u('c2b2')) = 2,
    'link_admit_pages no da lo de Y (la versión de X lo escondía)';
  perform pg_temp.as_postgres();
  perform pg_temp.check(pg_temp.work('c2a6'), 'f002,f003', 'link_admit_work no da lo de Y detrás de X');
  perform pg_temp.check(pg_temp.admit('c2a6', 'c2b2', jsonb_build_array(pg_temp.dec('f002', true), pg_temp.dec('f003', true))),
    'admitted,admitted', 'lo de Y no entra (admit_out_of_order por lo de X)');

  -- Lo que sigue de X sí queda trabado (su orden): ni se baja ni se decide.
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'c2b2', 'f004', devx), 'ok', 'X no escribe la segunda');
  perform pg_temp.check(pg_temp.work('c2a6'), '', 'link_admit_work da lo de X detrás de su fila sin decidir');
  perform pg_temp.check(pg_temp.admit('c2a6', 'c2b2', jsonb_build_array(pg_temp.dec('f004', true))),
    'error:admit_out_of_order', 'lo de X entra saltando su fila sin decidir');
  -- Y sigue entrando.
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'c2b2', 'f005', devy), 'ok', 'Y no escribe la tercera');
  perform pg_temp.check(pg_temp.work('c2a6'), 'f005', 'lo nuevo de Y no se baja');
  -- Una fila apartada (por la prueba) de Y, y otra en H.
  perform pg_temp.check(pg_temp.admit('c2a6', 'c2b2', jsonb_build_array(pg_temp.dec('f005', false, 'bad_shape'))),
    'aside:bad_shape', 'no aparta lo de Y');
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'c2b3', 'f006', devy), 'ok', 'Y no escribe en H');
  perform pg_temp.check(pg_temp.admit('c2a6', 'c2b3', jsonb_build_array(pg_temp.dec('f006', false, 'pending'))),
    'aside:pending', 'no aparta lo de Y en H');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- public_link_aside: quién lo ve y qué trae
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  old_id uuid := pg_temp.lid('S');
  r      record;
begin
  perform pg_temp.check(pg_temp.aside('c2a6'), 'H/S:pending,S/S:bad_shape', 'lo apartado para quien ve lo borrado');
  perform pg_temp.check(pg_temp.aside('c2a1'), 'H/S:pending,S/S:bad_shape', 'lo apartado para quien comparte');
  -- Quien no ve lo borrado de esas páginas: nada.
  perform pg_temp.check(pg_temp.aside('c2a5'), '', 'un invitado con Editar ve lo apartado');
  perform pg_temp.check(pg_temp.aside('c2a7'), '', 'quien comenta ve lo apartado');
  perform pg_temp.check(pg_temp.aside('c2a9'), '', 'quien edita solo al costado ve lo apartado');
  -- Sin bytes en la lista, con lo que muestra Share.
  perform pg_temp.as_user('c2a6');
  select * into r from public.public_link_aside() a where a.reason = 'bad_shape';
  assert r.link_id = old_id and r.author = 'Ana' and r.bytes = 1 and r.decided_at is not null, 'la fila apartada sin sus datos';
  perform pg_temp.as_postgres();

  -- Reset: lo que esperaba de X queda apartado (link_revoked) y sigue en la lista, con la raíz del link viejo.
  perform pg_temp.as_user('c2a1');
  perform pg_temp.save('S', public.reset_public_link(pg_temp.u('c2b2'), pg_temp.u('c2c1')));
  perform pg_temp.as_postgres();
  perform pg_temp.check(pg_temp.aside('c2a6'),
    'H/S:pending,S/S:bad_shape,S/S:link_revoked,S/S:link_revoked', 'lo del link reseteado no está en la lista');
  -- Los bytes se siguen bajando de a uno (como el aviso de la página).
  perform pg_temp.as_user('c2a6');
  assert public.public_link_update_bytes((pg_temp.room('f004')).id) = 'AQ==', 'no se bajan los bytes de lo apartado';
  perform pg_temp.as_postgres();
  -- Una página en la papelera: quien la ve sin la papelera no la ve en la lista.
  update public.pages set deleted_at = now() where id = pg_temp.u('c2b3');
  perform pg_temp.check(pg_temp.aside('c2a9'), '', 'la papelera abre lo apartado a otro');
  update public.pages set deleted_at = null where id = pg_temp.u('c2b3');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- O3 de la auditoría de la 2c: el tope es por página (un Reset con miles de filas en H no vacía la lista de S) y la raíz
-- del link solo a quien la ve
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  hn int;
  sn int;
begin
  -- 250 filas apartadas más en H, más nuevas que todo lo de S (como un Reset de un link molesto).
  insert into public.public_link_updates (link_id, page_id, client_update_id, update, bytes, author, app_version,
                                          decided_at, decision, reason)
  select pg_temp.lid('S'), pg_temp.u('c2b3'), gen_random_uuid(), '\x01'::bytea, 1, 'Molesto', 1.0, now(), 'aside', 'link_revoked'
  from generate_series(1, 250);
  perform pg_temp.as_user('c2a6');
  select count(*) filter (where a.page_id = pg_temp.u('c2b3')), count(*) filter (where a.page_id = pg_temp.u('c2b2'))
  into hn, sn from public.public_link_aside() a;
  perform pg_temp.as_postgres();
  assert hn = 200, format('el tope por página no es 200 (H: %s)', hn);
  assert sn = 3, format('las filas de H dejaron sin lista a S (S: %s)', sn);
  -- Quien edita solo H ve lo apartado de H, pero no la raíz del link (S): ni su id.
  perform pg_temp.as_user('c2a8');
  assert (select count(*) from public.public_link_aside() a where a.page_id = pg_temp.u('c2b3')) = 200, 'quien edita H no ve lo de H';
  assert not exists (select 1 from public.public_link_aside() a where a.page_id <> pg_temp.u('c2b3')), 'quien edita H ve lo de S';
  assert not exists (select 1 from public.public_link_aside() a where a.link_page_id is not null), 'quien no ve la raíz recibe su id';
  perform pg_temp.as_postgres();
  -- Quien la ve, sí.
  perform pg_temp.as_user('c2a6');
  assert not exists (select 1 from public.public_link_aside() a where a.link_page_id is distinct from pg_temp.u('c2b2')), 'la raíz falta para quien la ve';
  perform pg_temp.as_postgres();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Permisos y volatilidad
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  assert not has_function_privilege('anon', 'public.public_link_aside()', 'execute'), 'anon pide lo apartado';
  assert has_function_privilege('authenticated', 'public.public_link_aside()', 'execute'), 'una cuenta no pide lo apartado';
  assert (select p.provolatile from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'public_link_aside') = 's', 'public_link_aside no es STABLE';
  assert (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'public_link_aside'), 'public_link_aside no es SECURITY DEFINER';
  assert not has_function_privilege('anon', 'public.link_admit(uuid, text, jsonb)', 'execute'), 'anon admite';
  assert has_function_privilege('authenticated', 'public.link_admit_work(text, uuid[])', 'execute'), 'se perdió el permiso de admitir';
  assert (select schema_version from public.workspace_settings where id) >= 20, 'schema_version';
end;
$$;

rollback;
select 'ok' as result;
