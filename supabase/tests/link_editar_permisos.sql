-- Pruebas del link público, entrega 2a: Can edit (20261027120000_link_editar.sql, Docs/Doc_Link_Publico.md, E2.14).
-- El visitante escribe con el rol anon y el token en `x-shotdocs-link`: lo que manda va a la sala de espera
-- (`public_link_updates`), nunca a `page_updates`, con topes por bytes que no suman lo rechazado y con idempotencia antes
-- de los topes. Un editor que ve lo borrado lo admite en orden (`link_admit_pages`, `link_admit_work`, `link_admit`): la
-- base mueve los bytes a `page_updates` con `created_by` nulo y el nombre del visitante, o los aparta con el motivo.
-- Revocar, Reset y sacar a quien lo creó apartan lo que esperaba (`link_revoked`); lo que puede volver (vencer, la
-- papelera, la página afuera, Can view) queda retenido y no traba a nadie. El interruptor `link_edit_min_version` manda
-- en todo. Corre dentro de una transacción que se deshace al final: no deja usuarios ni datos. Si todo pasa, devuelve
-- una fila con result = 'ok'.

begin;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-00000000' || s)::uuid;
$$;

create function pg_temp.as_user(s text, ver text default '9.999') returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', pg_temp.u(s), 'role', 'authenticated')::text, true),
         set_config('request.headers', json_build_object('x-shotdocs-version', ver)::text, true);
$$;

create function pg_temp.as_anon(tok text, dev text default 'devAAAAAAAAAAAAAAAAAAAA', ver text default '9.999')
returns void language sql as $$
  select set_config('role', 'anon', true),
         set_config('request.jwt.claims', '{"role": "anon"}', true),
         set_config('request.headers',
                    jsonb_strip_nulls(jsonb_build_object('x-shotdocs-link', tok, 'x-shotdocs-device', dev,
                                                         'x-shotdocs-version', ver))::text, true);
$$;

create function pg_temp.as_postgres() returns void language sql as $$
  select set_config('role', 'postgres', true),
         set_config('request.jwt.claims', '', true),
         set_config('request.headers', '', true);
$$;

-- Corre `stmt` y devuelve 'ok' o 'error:<mensaje>[:<detail>]' (el mensaje de `app_outdated` de PostgREST, leído).
create function pg_temp.try(stmt text) returns text language plpgsql as $$
declare
  d text;
  m text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  m := sqlerrm;
  if sqlstate = 'PGRST' then
    m := (sqlerrm::json ->> 'message');
  end if;
  return 'error:' || m || coalesce(':' || nullif(d, ''), '');
end;
$$;

create function pg_temp.check(got text, want text, what text) returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FALLA: % (dio %, se esperaba %)', what, got, want;
  end if;
end;
$$;

-- Los tokens de la prueba, por nombre (como definer: el visitante no lee la tabla).
create temp table tk (name text primary key, id uuid, token text);
create function pg_temp.save(n text, j jsonb) returns void language sql security definer as $$
  insert into pg_temp.tk values (n, (j ->> 'id')::uuid, j ->> 'token')
  on conflict (name) do update set id = excluded.id, token = excluded.token;
$$;
create function pg_temp.tok(n text) returns text language sql security definer as $$
  select token from pg_temp.tk where name = n;
$$;
create function pg_temp.lid(n text) returns uuid language sql security definer as $$
  select id from pg_temp.tk where name = n;
$$;

-- El visitante escribe (como la app: `plink_push_page_update`), con su token, dispositivo y versión.
create function pg_temp.push(tok text, page text, cid text, b64 text, ver text default '9.999', who text default 'Ana',
                             dev text default 'devAAAAAAAAAAAAAAAAAAAA')
returns text language plpgsql as $$
declare
  r text;
begin
  perform pg_temp.as_anon(tok, dev, ver);
  r := pg_temp.try(format('select public.plink_push_page_update(%L, %L, %L, %L, %L)',
                          pg_temp.u(page), pg_temp.u(cid), b64, ver, who));
  perform pg_temp.as_postgres();
  return r;
end;
$$;

-- Lo que cuenta un link hoy.
create function pg_temp.used(p_name text, p_kind text) returns bigint language sql security definer as $$
  select coalesce((select u.n from public.public_link_usage u where u.link_id = pg_temp.lid(p_name)
                   and u.day = current_date and u.kind = p_kind), 0);
$$;
create function pg_temp.used_bytes(p_name text, p_kind text) returns bigint language sql security definer as $$
  select coalesce((select u.bytes from public.public_link_usage u where u.link_id = pg_temp.lid(p_name)
                   and u.day = current_date and u.kind = p_kind), 0);
$$;
create function pg_temp.limits(j text) returns void language sql security definer as $$
  update public.workspace_settings set link_limits = j::jsonb where id;
$$;

-- La fila de la sala de un pedido del visitante (por client_update_id).
create function pg_temp.room(cid text) returns public.public_link_updates language sql security definer as $$
  select * from public.public_link_updates where client_update_id = pg_temp.u(cid);
$$;
create function pg_temp.room_count(p_name text) returns bigint language sql security definer as $$
  select count(*) from public.public_link_updates where link_id = pg_temp.lid(p_name);
$$;
create function pg_temp.rows_of(page text) returns bigint language sql security definer as $$
  select count(*) from public.page_updates where page_id = pg_temp.u(page);
$$;
create function pg_temp.seq_of(page text) returns bigint language sql security definer as $$
  select update_seq from public.pages where id = pg_temp.u(page);
$$;

-- Una decisión para `link_admit`.
create function pg_temp.dec(cid text, ok boolean, reason text default null, media jsonb default '[]')
returns jsonb language sql security definer as $$
  select jsonb_strip_nulls(jsonb_build_object('id', (pg_temp.room(cid)).id, 'ok', ok, 'reason', reason, 'media', media));
$$;

-- Lo que devuelve `link_admit` para cada fila, como texto ("admitted:3,aside:foreign_media,held").
create function pg_temp.admit(who text, page text, decisions jsonb, ver text default '9.999') returns text
language plpgsql as $$
declare
  r jsonb;
  t text;
begin
  perform pg_temp.as_user(who, ver);
  begin
    r := public.link_admit(pg_temp.u(page), ver, decisions);
    select string_agg(x ->> 'decision' || coalesce(':' || (x ->> 'seq'), '') || coalesce(':' || (x ->> 'reason'), ''), ','
                      order by o)
    into t from jsonb_array_elements(r) with ordinality as a (x, o);
  exception when others then
    t := 'error:' || sqlerrm;
  end;
  perform pg_temp.as_postgres();
  return coalesce(t, '');
end;
$$;

-- Las páginas que `link_admit_pages` le da a una persona (por título, con cuántas esperan).
create function pg_temp.admit_pages(who text, ver text default '9.999') returns text language plpgsql as $$
declare
  t text;
begin
  perform pg_temp.as_user(who, ver);
  select string_agg(pg.title || ':' || a.waiting, ',' order by pg.title) into t
  from public.link_admit_pages(ver) a join public.pages pg on pg.id = a.page_id;
  perform pg_temp.as_postgres();
  return coalesce(t, '');
end;
$$;

create function pg_temp.cid_of(p_id uuid) returns uuid language sql security definer as $$
  select client_update_id from public.public_link_updates where id = p_id;
$$;

-- Lo que `link_admit_work` le da a una persona para estas páginas: los client_update_id (los 4 últimos dígitos).
create function pg_temp.admit_work(who text, pages text[], ver text default '9.999') returns text language plpgsql as $$
declare
  t text;
begin
  perform pg_temp.as_user(who, ver);
  begin
    select string_agg(right(pg_temp.cid_of(w.id)::text, 4), ',' order by w.page_id, w.link_id, w.n) into t
    from public.link_admit_work(ver, (select array_agg(pg_temp.u(p)) from unnest(pages) p)) w;
  exception when others then
    t := 'error:' || sqlerrm;
  end;
  perform pg_temp.as_postgres();
  return coalesce(t, '');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Datos
-- ---------------------------------------------------------------------------------------------------
-- Personas: o (dueña del workspace), a (miembro, creó P: comparte), ad (admin, Editar y crear P), e (Editar P: ve lo
-- borrado y admite), g (invitado con Editar y crear P: no ve lo borrado), c (Comentar P), x (sin permiso), e2 (Editar
-- solo en Sib: no ve S).
update public.members set removed_at = now() where role = 'owner' and removed_at is null;
update public.workspace_settings
set min_app_version = 0.5, clean_min_version = 0.5, link_edit_min_version = null, link_limits = '{}' where id;
insert into auth.users (id, email, aud, role) values
  (pg_temp.u('d2a0'), 'le-o@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('d2a1'), 'le-a@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('d2a2'), 'le-ad@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('d2a5'), 'le-g@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('d2a6'), 'le-e@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('d2a7'), 'le-c@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('d2a8'), 'le-x@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('d2a9'), 'le-e2@test.invalid', 'authenticated', 'authenticated');
insert into public.members (user_id, role) values
  (pg_temp.u('d2a0'), 'owner'), (pg_temp.u('d2a1'), 'member'), (pg_temp.u('d2a2'), 'admin'),
  (pg_temp.u('d2a5'), 'guest'), (pg_temp.u('d2a6'), 'member'), (pg_temp.u('d2a7'), 'member'),
  (pg_temp.u('d2a8'), 'member'), (pg_temp.u('d2a9'), 'member');
insert into public.workspaces (id, owner_id, name) values
  (pg_temp.u('d2e0'), pg_temp.u('d2a1'), 'P'),
  (pg_temp.u('d2e1'), pg_temp.u('d2a0'), 'Q');
-- P: R › A › S (la del link) › H; S › T; S › M (se mueve afuera); A › Sib; R › K (ordena primero, la de las 2000
-- retenidas). Q: QX.
insert into public.pages (id, workspace_id, parent_id, title, sort_key, settings) values
  (pg_temp.u('d2b0'), pg_temp.u('d2e0'), null, 'R', 'a0', '{}'),
  (pg_temp.u('d2b1'), pg_temp.u('d2e0'), pg_temp.u('d2b0'), 'A', 'a0', '{}'),
  (pg_temp.u('d2b2'), pg_temp.u('d2e0'), pg_temp.u('d2b1'), 'S', 'a0', '{}'),
  (pg_temp.u('d2b3'), pg_temp.u('d2e0'), pg_temp.u('d2b2'), 'H', 'a0', '{}'),
  (pg_temp.u('d2b5'), pg_temp.u('d2e0'), pg_temp.u('d2b2'), 'T', 'a1', '{}'),
  (pg_temp.u('d2b6'), pg_temp.u('d2e0'), pg_temp.u('d2b2'), 'M', 'a2', '{}'),
  (pg_temp.u('d2b7'), pg_temp.u('d2e0'), pg_temp.u('d2b1'), 'Sib', 'a1', '{}'),
  (pg_temp.u('0001'), pg_temp.u('d2e0'), pg_temp.u('d2b0'), 'K', 'a2', '{}'),
  (pg_temp.u('d2b9'), pg_temp.u('d2e1'), null, 'QX', 'a0', '{}');
insert into public.grants (user_id, project_id, page_id, level) values
  (pg_temp.u('d2a2'), pg_temp.u('d2e0'), null, 'edit_pages'),
  (pg_temp.u('d2a5'), pg_temp.u('d2e0'), null, 'edit_pages'),
  (pg_temp.u('d2a6'), pg_temp.u('d2e0'), null, 'edit'),
  (pg_temp.u('d2a7'), pg_temp.u('d2e0'), null, 'comment'),
  (pg_temp.u('d2a9'), null, pg_temp.u('d2b7'), 'edit');

-- Contenido del equipo: S una fila, H una.
select pg_temp.as_user('d2a1');
select public.push_page_update(pg_temp.u('d2b2'), pg_temp.u('d201'), 'AQID', '9.999');
select public.push_page_update(pg_temp.u('d2b3'), pg_temp.u('d202'), 'BAUG', '9.999');
select pg_temp.as_postgres();

-- Archivos de P: f1 usado en S, f2 sacado de S, f3 usado en A (arriba), f4 de Q usado en QX, f6 usado en H.
insert into public.files (id, project_id, name, mime, size, created_by) values
  (pg_temp.u('d2f1'), pg_temp.u('d2e0'), 'activo.jpg', 'image/jpeg', 10, pg_temp.u('d2a1')),
  (pg_temp.u('d2f2'), pg_temp.u('d2e0'), 'sacado.jpg', 'image/jpeg', 10, pg_temp.u('d2a1')),
  (pg_temp.u('d2f3'), pg_temp.u('d2e0'), 'arriba.jpg', 'image/jpeg', 10, pg_temp.u('d2a1')),
  (pg_temp.u('d2f4'), pg_temp.u('d2e1'), 'ajeno.jpg', 'image/jpeg', 10, pg_temp.u('d2a0')),
  (pg_temp.u('d2f6'), pg_temp.u('d2e0'), 'hija.jpg', 'image/jpeg', 10, pg_temp.u('d2a1'));
insert into public.page_files (page_id, file_id, removed_at, is_foreign) values
  (pg_temp.u('d2b2'), pg_temp.u('d2f1'), null, false),
  (pg_temp.u('d2b2'), pg_temp.u('d2f2'), now(), false),
  (pg_temp.u('d2b1'), pg_temp.u('d2f3'), null, false),
  (pg_temp.u('d2b9'), pg_temp.u('d2f4'), null, false),
  (pg_temp.u('d2b3'), pg_temp.u('d2f6'), null, false);

-- ---------------------------------------------------------------------------------------------------
-- El interruptor: apagado, Can edit no se crea ni se elige
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  j jsonb;
begin
  perform pg_temp.as_user('d2a1');
  perform pg_temp.check(pg_temp.try(format('select public.create_public_link(%L, %L, %L)', pg_temp.u('d2c0'), pg_temp.u('d2b2'), 'edit')),
    'error:edit_off', 'crea Can edit con el interruptor apagado');
  perform pg_temp.check(pg_temp.try(format('select public.create_public_link(%L, %L, %L)', pg_temp.u('d2c0'), pg_temp.u('d2b2'), 'admin')),
    'error:level_invalid', 'crea un nivel que no existe');
  perform pg_temp.save('S', public.create_public_link(pg_temp.u('d2c0'), pg_temp.u('d2b2'), 'comment'));
  perform pg_temp.check(pg_temp.try(format('select public.set_public_link(%L, %L)', pg_temp.u('d2b2'), 'edit')),
    'error:edit_off', 'pasa a Can edit con el interruptor apagado');
  assert public.get_public_link(pg_temp.u('d2b2')) ->> 'edit_on' = 'false', 'Share no sabe que Can edit está apagado';
  j := public.get_public_link(pg_temp.u('d2b2')) -> 'link' -> 'edits';
  assert j ->> 'waiting' = '0' and j ->> 'aside' = '0' and j ->> 'held' = '0', 'los números de Share sin escrituras';

  -- Prendido: se elige.
  perform pg_temp.as_postgres();
  update public.workspace_settings set link_edit_min_version = 0.5 where id;
  perform pg_temp.as_user('d2a1');
  assert public.get_public_link(pg_temp.u('d2b2')) ->> 'edit_on' = 'true', 'Share no ve el interruptor';
  perform pg_temp.save('S', public.set_public_link(pg_temp.u('d2b2'), 'edit'));
  assert public.get_public_link(pg_temp.u('d2b2')) -> 'link' ->> 'level' = 'edit', 'set no pasa a Can edit';
  -- Pasar a Can edit no reinicia la rama (los dos niveles reciben solo bases).
  perform pg_temp.as_postgres();
  assert (select clean_reset_seq from public.pages where id = pg_temp.u('d2b2')) = 1, 'pasar a Can edit reinicia S';
  -- Otros links: uno Can view en H (otro creador), uno Can edit en Sib, uno Can edit en K.
  perform pg_temp.as_user('d2a2');
  perform pg_temp.save('Sib', public.create_public_link(pg_temp.u('d2c2'), pg_temp.u('d2b7'), 'edit'));
  perform pg_temp.save('K', public.create_public_link(pg_temp.u('d2c3'), pg_temp.u('0001'), 'edit'));
  perform pg_temp.as_postgres();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- plink_open: el nivel que la versión puede usar
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.as_anon(pg_temp.tok('S'));
  assert public.plink_open('9.999') ->> 'level' = 'edit', 'plink_open no da Can edit';
  assert public.plink_open('9.999') ->> 'link_level' = 'edit', 'plink_open no da el nivel del link';
  perform pg_temp.as_postgres();
  update public.workspace_settings set link_edit_min_version = 2.0 where id;
  perform pg_temp.as_anon(pg_temp.tok('S'), ver => '1.000');
  assert public.plink_open('1.000') ->> 'level' = 'comment', 'una versión más vieja que el interruptor ve Can edit';
  assert public.plink_open(null) ->> 'level' = 'comment', 'sin versión ve Can edit';
  perform pg_temp.as_postgres();
  update public.workspace_settings set link_edit_min_version = null where id;
  perform pg_temp.as_anon(pg_temp.tok('S'));
  assert public.plink_open('9.999') ->> 'level' = 'comment', 'con el interruptor apagado ve Can edit';
  perform pg_temp.as_postgres();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Escribir: a la sala, nunca a page_updates; cada rechazo
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  rows_before bigint := pg_temp.rows_of('d2b2');
  seq_before  bigint := pg_temp.seq_of('d2b2');
  big         text := encode(convert_to(repeat('a', 1048577), 'UTF8'), 'base64');
  r           public.public_link_updates;
begin
  -- Con el interruptor apagado (o una versión vieja): app_outdated.
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'd2b2', 'e001', 'AQ=='), 'error:app_outdated', 'escribe con el interruptor apagado');
  update public.workspace_settings set link_edit_min_version = 1.0 where id;
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'd2b2', 'e001', 'AQ==', '0.900'), 'error:app_outdated',
    'escribe con una versión más vieja que el interruptor');
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'd2b2', 'e001', 'AQ==', '0.100'), 'error:app_outdated',
    'escribe con una versión más vieja que la mínima');
  update public.workspace_settings set link_edit_min_version = 0.5 where id;

  -- Dónde no: otra página que no es de la rama (arriba, costado, otro proyecto), la papelera, Can view, otro link.
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'd2b1', 'e002', 'AQ=='), 'error:page_not_found', 'escribe arriba');
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'd2b7', 'e002', 'AQ=='), 'error:page_not_found', 'escribe al costado');
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'd2b9', 'e002', 'AQ=='), 'error:page_not_found', 'escribe en otro proyecto');
  perform pg_temp.check(pg_temp.push(pg_temp.tok('Sib'), 'd2b2', 'e002', 'AQ=='), 'error:page_not_found', 'el link de Sib escribe en S');
  update public.pages set deleted_at = now() where id = pg_temp.u('d2b5');
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'd2b5', 'e002', 'AQ=='), 'error:page_not_found', 'escribe en la papelera');
  update public.pages set deleted_at = null where id = pg_temp.u('d2b5');
  perform pg_temp.check(pg_temp.push('sdl_' || repeat('A', 43), 'd2b2', 'e002', 'AQ=='), 'error:link_not_found', 'un token al azar escribe');
  perform pg_temp.check(pg_temp.push(null, 'd2b2', 'e002', 'AQ=='), 'error:link_not_found', 'sin token escribe');

  -- El nombre.
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'd2b2', 'e002', 'AQ==', who => '   '), 'error:author_invalid', 'sin nombre');
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'd2b2', 'e002', 'AQ==', who => E'An‮a'), 'error:author_invalid', 'nombre con controles');
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'd2b2', 'e002', 'AQ==', who => repeat('n', 61)), 'error:author_invalid', 'nombre largo');
  -- El tamaño.
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'd2b2', 'e002', big), 'error:update_size_invalid', '1 MB + 1');
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'd2b2', 'e002', ''), 'error:update_size_invalid', 'vacío');
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'd2b2', 'e002', null), 'error:update_size_invalid', 'nulo');
  assert pg_temp.room_count('S') = 0 and pg_temp.used('S', 'push') = 0, 'un rechazo escribió o contó';

  -- La que entra: a la sala, con el autor, el dispositivo y la versión; nada en page_updates.
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'd2b2', 'e010', 'CgsM', who => '  Ana  '), 'ok', 'escribe');
  r := pg_temp.room('e010');
  assert r.author = 'Ana' and r.bytes = 3 and r.update = '\x0a0b0c'::bytea and r.app_version = 9.999
         and r.device_hash = extensions.digest('devAAAAAAAAAAAAAAAAAAAA', 'sha256') and r.decided_at is null,
    'la fila de la sala';
  assert pg_temp.rows_of('d2b2') = rows_before and pg_temp.seq_of('d2b2') = seq_before, 'escribir tocó page_updates';
  assert pg_temp.used('S', 'push') = 1 and pg_temp.used_bytes('S', 'push') = 3
         and (select push_bytes_total from public.public_links where id = pg_temp.lid('S')) = 3, 'escribir no contó';
  -- Devuelve 0 (no hay seq todavía).
  perform pg_temp.as_anon(pg_temp.tok('S'));
  assert public.plink_push_page_update(pg_temp.u('d2b2'), pg_temp.u('e011'), 'DQ==', '9.999', 'Ana') = 0, 'no devuelve 0';
  -- El mismo pedido otra vez: 0, sin contar ni escribir.
  assert public.plink_push_page_update(pg_temp.u('d2b2'), pg_temp.u('e011'), 'DQ==', '9.999', 'Ana') = 0, 'repetir no devuelve 0';
  perform pg_temp.as_postgres();
  assert pg_temp.room_count('S') = 2 and pg_temp.used('S', 'push') = 2, 'repetir contó o escribió';
  -- En la hija también (la rama).
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'd2b3', 'e012', 'Dg=='), 'ok', 'escribe en la hija');

  -- Topes: el del día (cantidad) y, con el tope lleno, repetir igual devuelve 0 sin contar.
  perform pg_temp.limits('{"push": 3}');
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'd2b2', 'e013', 'Dw=='), 'error:link_rate_limited:push', 'tope del día');
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'd2b2', 'e011', 'DQ=='), 'ok', 'repetir con el tope lleno');
  assert pg_temp.used('S', 'push') = 3 and pg_temp.room('e013') is null, 'el tope sumó';
  perform pg_temp.limits('{"push_bytes": 5}');
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'd2b2', 'e013', 'Dw=='), 'error:link_rate_limited:push_bytes', 'tope de bytes del día');
  perform pg_temp.limits('{"all_push_bytes": 5}');
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'd2b2', 'e013', 'Dw=='), 'error:link_rate_limited:all_push_bytes', 'tope de todos los links');
  perform pg_temp.limits('{"life_push_bytes": 5}');
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'd2b2', 'e013', 'Dw=='), 'error:link_rate_limited:life_push_bytes', 'tope de por vida');
  perform pg_temp.limits('{"db_guard_bytes": 1}');
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'd2b2', 'e013', 'Dw=='), 'error:link_rate_limited:db_guard', 'la guarda de la base');
  perform pg_temp.limits('{"waiting_bytes": 5}');
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'd2b2', 'e013', 'Dw=='), 'error:link_rate_limited:waiting_bytes', 'lo que espera');
  perform pg_temp.limits('{"push_max_bytes": 2}');
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'd2b2', 'e013', 'Dw8P'), 'error:update_size_invalid', 'el tope de una subida');
  assert pg_temp.used('S', 'push') = 3 and pg_temp.used_bytes('S', 'push') = 5
         and (select push_bytes_total from public.public_links where id = pg_temp.lid('S')) = 5
         and pg_temp.room('e013') is null, 'un tope sumó o escribió';
  perform pg_temp.limits('{}');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- plink_push_status: las de este link y este dispositivo; cuenta como un pase
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  w int;
  passes bigint := pg_temp.used('S', 'pass');
begin
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'd2b2', 'e020', 'EA==', dev => 'devBBBBBBBBBBBBBBBBBBBB'), 'ok', 'otro dispositivo escribe');
  perform pg_temp.as_anon(pg_temp.tok('S'));
  select s.waiting into w from public.plink_push_status() s where s.page_id = pg_temp.u('d2b2');
  assert w = 2, format('estado del dispositivo A en S: %s', w);
  perform pg_temp.as_anon(pg_temp.tok('S'), 'devBBBBBBBBBBBBBBBBBBBB');
  select s.waiting into w from public.plink_push_status() s where s.page_id = pg_temp.u('d2b2');
  assert w = 1, 'estado del dispositivo B';
  perform pg_temp.as_postgres();
  assert pg_temp.used('S', 'pass') = passes + 2, 'el estado no cuenta como pase';
  perform pg_temp.limits('{"pass": 1}');
  perform pg_temp.as_anon(pg_temp.tok('S'));
  perform pg_temp.check(pg_temp.try('select * from public.plink_push_status()'), 'error:link_rate_limited:pass', 'el estado sin tope');
  perform pg_temp.as_postgres();
  perform pg_temp.limits('{}');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Quién admite: solo quien ve lo borrado de la página, con la versión y los dos interruptores
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  p text;
begin
  -- e (Editar P) ve S:3 (e010, e011, e020) y H:1.
  perform pg_temp.check(pg_temp.admit_pages('d2a6'), 'H:1,S:3', 'las páginas de e');
  perform pg_temp.check(pg_temp.admit_pages('d2a1'), 'H:1,S:3', 'las páginas de a');
  -- c (Comentar), g (invitado con Editar y crear), x (sin permiso), e2 (Editar en Sib): nada.
  foreach p in array array['d2a7', 'd2a5', 'd2a8', 'd2a9'] loop
    perform pg_temp.check(pg_temp.admit_pages(p), '', 'las páginas de ' || p);
    perform pg_temp.check(pg_temp.admit_work(p, array['d2b2']), '', 'el trabajo de ' || p);
    perform pg_temp.check(pg_temp.admit(p, 'd2b2', jsonb_build_array(pg_temp.dec('e010', true))), 'error:page_not_found', 'admite ' || p);
  end loop;
  -- Una versión más vieja que la fila (la escribió 9.999): no la ve ni la decide.
  perform pg_temp.check(pg_temp.admit_pages('d2a6', '9.000'), '', 'una versión vieja ve la fila');
  perform pg_temp.check(pg_temp.admit_work('d2a6', array['d2b2'], '9.000'), '', 'una versión vieja baja la fila');
  perform pg_temp.check(pg_temp.admit('d2a6', 'd2b2', jsonb_build_array(pg_temp.dec('e010', true)), '9.000'),
    'error:admit_version', 'una versión vieja decide la fila');
  -- Sin los interruptores: nada.
  update public.workspace_settings set link_edit_min_version = null where id;
  perform pg_temp.check(pg_temp.admit_pages('d2a6'), '', 'admite sin el interruptor de Can edit');
  perform pg_temp.check(pg_temp.admit_work('d2a6', array['d2b2']), '', 'baja sin el interruptor de Can edit');
  perform pg_temp.check(pg_temp.admit('d2a6', 'd2b2', jsonb_build_array(pg_temp.dec('e010', true))), 'error:page_not_found', 'decide sin el interruptor');
  update public.workspace_settings set link_edit_min_version = 0.5, clean_min_version = null where id;
  perform pg_temp.check(pg_temp.admit_pages('d2a6'), '', 'admite sin el interruptor de D14');
  update public.workspace_settings set link_edit_min_version = 9.999, clean_min_version = 0.5 where id;
  perform pg_temp.check(pg_temp.admit_pages('d2a6', '9.998'), '', 'admite con una versión más vieja que el interruptor');
  update public.workspace_settings set link_edit_min_version = 0.5 where id;
  -- anon no llama a ninguna.
  perform pg_temp.as_anon(pg_temp.tok('S'));
  perform pg_temp.check(pg_temp.try('select * from public.link_admit_pages(''9.999'')'), 'error:permission denied for function link_admit_pages', 'anon pide páginas');
  perform pg_temp.check(pg_temp.try(format('select * from public.link_admit_work(%L, array[%L]::uuid[])', '9.999', pg_temp.u('d2b2'))),
    'error:permission denied for function link_admit_work', 'anon pide el trabajo');
  perform pg_temp.check(pg_temp.try(format('select public.link_admit(%L, %L, %L)', pg_temp.u('d2b2'), '9.999', '[]')),
    'error:permission denied for function link_admit', 'anon admite');
  perform pg_temp.check(pg_temp.try(format('select * from public.public_link_updates_of(%L)', pg_temp.u('d2b2'))),
    'error:permission denied for function public_link_updates_of', 'anon ve lo apartado');
  perform pg_temp.check(pg_temp.try('select count(*) from public.public_link_updates'), 'error:permission denied for table public_link_updates', 'anon lee la sala');
  perform pg_temp.as_user('d2a6');
  perform pg_temp.check(pg_temp.try('select count(*) from public.public_link_updates'), 'error:permission denied for table public_link_updates', 'una cuenta lee la sala');
  perform pg_temp.as_postgres();
  -- link_admit_pages no lleva bytes: solo página, cuántas y cuánto pesan.
  assert pg_get_function_result('public.link_admit_pages(text)'::regprocedure) = 'TABLE(page_id uuid, waiting integer, bytes bigint)',
    'link_admit_pages devuelve otra cosa';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- El trabajo: solo las páginas pedidas, en orden; admitir mueve los bytes
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  seq0 bigint := pg_temp.seq_of('d2b2');
  pu   public.page_updates;
  j    jsonb;
begin
  -- Pedida S: solo S, en orden de llegada por link. Nunca H, que no se pidió; nunca una página sin permiso.
  perform pg_temp.check(pg_temp.admit_work('d2a6', array['d2b2']), 'e010,e011,e020', 'el trabajo de S');
  perform pg_temp.check(pg_temp.admit_work('d2a6', array['d2b3']), 'e012', 'el trabajo de H');
  perform pg_temp.check(pg_temp.admit_work('d2a9', array['d2b2', 'd2b7']), '', 'e2 baja S');
  perform pg_temp.check(pg_temp.admit_work('d2a6', array[]::text[]), '', 'sin páginas');
  perform pg_temp.check(pg_temp.admit_work('d2a6', array['d2b2','d2b2','d2b2','d2b2','d2b2','d2b2','d2b2','d2b2','d2b2','d2b2',
                                                        'd2b2','d2b2','d2b2','d2b2','d2b2','d2b2','d2b2','d2b2','d2b2','d2b2','d2b2']),
    'error:too_many_pages', '21 páginas');
  -- Fuera de orden: la segunda antes de la primera.
  perform pg_temp.check(pg_temp.admit('d2a6', 'd2b2', jsonb_build_array(pg_temp.dec('e011', true))), 'error:admit_out_of_order', 'fuera de orden');
  -- La fila de otra página.
  perform pg_temp.check(pg_temp.admit('d2a6', 'd2b2', jsonb_build_array(pg_temp.dec('e012', true))), 'error:admit_not_found', 'la fila de otra página');
  -- Un archivo de afuera aunque el editor diga que sí; uno de arriba; uno sacado; uno de otro proyecto.
  perform pg_temp.check(pg_temp.admit('d2a6', 'd2b2', jsonb_build_array(pg_temp.dec('e010', true, null, jsonb_build_array(pg_temp.u('d2f3'))))),
    'aside:foreign_media', 'una foto de arriba');
  assert (pg_temp.room('e010')).update = '\x0a0b0c'::bytea, 'lo apartado perdió sus bytes';
  -- La segunda decisión de la misma fila devuelve la primera.
  perform pg_temp.check(pg_temp.admit('d2a1', 'd2b2', jsonb_build_array(pg_temp.dec('e010', true))), 'aside:foreign_media', 'la segunda decisión');
  -- La que sigue, con una foto de la rama (f1 en S, f6 en la hija): entra.
  perform pg_temp.check(pg_temp.admit('d2a6', 'd2b2',
      jsonb_build_array(pg_temp.dec('e011', true, null, jsonb_build_array(pg_temp.u('d2f1'), pg_temp.u('d2f6'))))),
    'admitted:' || (seq0 + 1), 'admite con fotos de la rama');
  -- Al admitir: el seq correlativo, created_by nulo, el nombre, los bytes de la sala, la sala sin bytes.
  select * into pu from public.page_updates where page_id = pg_temp.u('d2b2') and seq = seq0 + 1;
  assert pu.created_by is null and pu.plink_author = 'Ana' and pu.plink_id = pg_temp.lid('S')
         and pu.plink_update_id = (pg_temp.room('e011')).id and pu.update = '\x0d'::bytea, 'la fila admitida';
  assert (pg_temp.room('e011')).update is null and (pg_temp.room('e011')).decision = 'admitted'
         and (pg_temp.room('e011')).admitted_seq = seq0 + 1 and (pg_temp.room('e011')).decided_by = pg_temp.u('d2a6'),
    'la sala después de admitir';
  assert pg_temp.seq_of('d2b2') = seq0 + 1, 'update_seq no subió';
  -- Una foto sacada (B4) y una de otro proyecto: apartadas. Una dirección mal formada, también.
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'd2b2', 'e030', 'EQ=='), 'ok', 'escribe e030');
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'd2b2', 'e031', 'Eg=='), 'ok', 'escribe e031');
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'd2b2', 'e032', 'Ew=='), 'ok', 'escribe e032');
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'd2b2', 'e033', 'FA=='), 'ok', 'escribe e033');
  perform pg_temp.check(pg_temp.admit('d2a6', 'd2b2', jsonb_build_array(
      pg_temp.dec('e020', true),
      pg_temp.dec('e030', true, null, jsonb_build_array(pg_temp.u('d2f2'))),
      pg_temp.dec('e031', true, null, jsonb_build_array(pg_temp.u('d2f4'))),
      pg_temp.dec('e032', true, null, '["../../x"]'::jsonb),
      pg_temp.dec('e033', false, 'bad_shape'))),
    'admitted:' || (seq0 + 2) || ',aside:foreign_media,aside:foreign_media,aside:foreign_media,aside:bad_shape', 'varias en orden');
  -- El historial: el nombre del visitante.
  perform pg_temp.as_user('d2a6');
  assert (select h.plink_author from public.page_history(pg_temp.u('d2b2'), seq0, 10) h where h.seq = seq0 + 1) = 'Ana',
    'page_history no da el nombre';
  assert (select h.plink_author from public.page_history(pg_temp.u('d2b2'), 0, 10) h where h.seq = 1) is null,
    'page_history da un nombre a una fila del equipo';
  -- Lo apartado, para quien ve lo borrado; los bytes para bajar.
  assert (select count(*) from public.public_link_updates_of(pg_temp.u('d2b2')) x where x.state = 'aside') = 5,
    'public_link_updates_of no da lo apartado';
  assert public.public_link_update_bytes((pg_temp.room('e033')).id) = 'FA==', 'los bytes de lo apartado';
  perform pg_temp.check(pg_temp.try(format('select public.public_link_update_bytes(%L)', (pg_temp.room('e011')).id)),
    'error:not_found', 'los bytes de una admitida');
  perform pg_temp.as_user('d2a7');
  perform pg_temp.check(pg_temp.try(format('select * from public.public_link_updates_of(%L)', pg_temp.u('d2b2'))),
    'error:page_not_found', 'Comentar ve lo apartado');
  perform pg_temp.check(pg_temp.try(format('select public.public_link_update_bytes(%L)', (pg_temp.room('e033')).id)),
    'error:not_found', 'Comentar baja lo apartado');
  perform pg_temp.as_user('d2a5');
  perform pg_temp.check(pg_temp.try(format('select * from public.public_link_updates_of(%L)', pg_temp.u('d2b2'))),
    'error:page_not_found', 'el invitado ve lo apartado');
  -- Share: los números.
  perform pg_temp.as_user('d2a1');
  j := public.get_public_link(pg_temp.u('d2b2')) -> 'link' -> 'edits';
  assert j ->> 'aside' = '5' and j ->> 'admitted_today' = '2' and j ->> 'waiting' = '1' and j ->> 'held' = '0',
    format('los números de Share: %s', j);
  -- El estado del visitante: en S, nada esperando de A y 5 apartadas.
  perform pg_temp.as_anon(pg_temp.tok('S'));
  assert (select s.aside from public.plink_push_status() s where s.page_id = pg_temp.u('d2b2')) = 5, 'el estado no ve lo apartado';
  perform pg_temp.as_postgres();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Lo retenido (vencer, la papelera, afuera, Can view) no se decide ni traba; vuelve si el link vuelve
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  -- H tiene e012 esperando. Vencer el link: retenida (no aparece, no se baja, link_admit la devuelve 'held').
  update public.public_links set expires_at = now() - interval '1 minute', created_at = now() - interval '1 hour'
  where id = pg_temp.lid('S');
  perform pg_temp.check(pg_temp.admit_pages('d2a6'), '', 'lo de un link vencido aparece');
  perform pg_temp.check(pg_temp.admit_work('d2a6', array['d2b3']), '', 'lo de un link vencido se baja');
  perform pg_temp.check(pg_temp.admit('d2a6', 'd2b3', jsonb_build_array(pg_temp.dec('e012', true))), 'held', 'lo de un link vencido se decide');
  assert (pg_temp.room('e012')).decided_at is null, 'lo retenido se decidió';
  perform pg_temp.as_user('d2a6');
  assert (select x.state from public.public_link_updates_of(pg_temp.u('d2b3')) x) = 'held', 'lo retenido no se ve retenido';
  -- Revivirlo (set_public_link con otro vencimiento) reinicia la rama y lo retenido vuelve.
  perform pg_temp.as_user('d2a1');
  perform public.set_public_link(pg_temp.u('d2b2'), 'edit', now() + interval '1 day');
  perform pg_temp.as_postgres();
  assert (select clean_reset_seq from public.pages where id = pg_temp.u('d2b3')) = 1, 'revivir no reinicia la rama';
  perform pg_temp.check(pg_temp.admit_pages('d2a6'), 'H:1', 'lo retenido no vuelve');
  -- Can view: retenido.
  perform pg_temp.as_user('d2a1');
  perform public.set_public_link(pg_temp.u('d2b2'), 'comment');
  perform pg_temp.check(pg_temp.admit_pages('d2a6'), '', 'lo de un Can view aparece');
  perform pg_temp.as_user('d2a1');
  perform public.set_public_link(pg_temp.u('d2b2'), 'edit');
  -- La hija en la papelera: retenida; el resto sigue.
  perform pg_temp.as_postgres();
  update public.pages set deleted_at = now() where id = pg_temp.u('d2b3');
  perform pg_temp.check(pg_temp.admit_pages('d2a6'), '', 'lo de la papelera aparece');
  update public.pages set deleted_at = null where id = pg_temp.u('d2b3');
  -- Admitir H (e012), que vuelve.
  perform pg_temp.check(pg_temp.admit('d2a6', 'd2b3', jsonb_build_array(pg_temp.dec('e012', true))), 'admitted:2', 'lo retenido no entra al volver');

  -- waiting_bytes no cuenta lo retenido de una página que salió de la rama (observación 4).
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'd2b6', 'e040', 'FRUV'), 'ok', 'escribe en M');
  update public.pages set parent_id = pg_temp.u('d2b0') where id = pg_temp.u('d2b6');
  perform pg_temp.as_postgres();
  perform pg_temp.limits('{"waiting_bytes": 2}');
  -- Lo que espera de S en su rama: nada (e040 quedó afuera, retenida). 2 bytes entran; 1 más, no.
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'd2b2', 'e041', 'FhY='), 'ok', 'lo retenido de M frena');
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'd2b2', 'e042', 'Fw=='), 'error:link_rate_limited:waiting_bytes', 'waiting_bytes no frena');
  perform pg_temp.limits('{}');
  update public.pages set parent_id = pg_temp.u('d2b2') where id = pg_temp.u('d2b6');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- B1: 2000 retenidas en la página que ordena primero no traban la admisión de las demás
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  insert into public.public_link_updates (link_id, page_id, client_update_id, update, bytes, author, app_version)
  select pg_temp.lid('K'), pg_temp.u('0001'), gen_random_uuid(), '\x01'::bytea, 1, 'Molesto', 9.999
  from generate_series(1, 2000);
  -- Con el link vigente, K aparece (y ordena primero por id).
  assert pg_temp.admit_pages('d2a6') like 'K:2000,%', 'K no aparece';
  -- Vencido: K no aparece ni ocupa lugar; S y M siguen.
  update public.public_links set expires_at = now() - interval '1 minute', created_at = now() - interval '1 hour'
  where id = pg_temp.lid('K');
  perform pg_temp.check(pg_temp.admit_pages('d2a6'), 'M:1,S:1', 'lo retenido de K traba a los demás');
  perform pg_temp.check(pg_temp.admit_work('d2a6', array['0001', 'd2b2']), 'e041', 'lo retenido de K traba el trabajo');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Revocar, Reset y sacar a quien creó el link apartan lo que esperaba (link_revoked)
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  j jsonb;
begin
  -- Reset de S (con e040 y e041 esperando): el token viejo no escribe y lo suyo queda apartado.
  perform pg_temp.as_user('d2a1');
  j := public.reset_public_link(pg_temp.u('d2b2'), pg_temp.u('d2c9'));
  perform pg_temp.as_postgres();
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S'), 'd2b2', 'e050', 'GA=='), 'error:link_not_found', 'el token viejo escribe');
  assert (pg_temp.room('e041')).decision = 'aside' and (pg_temp.room('e041')).reason = 'link_revoked'
         and (pg_temp.room('e041')).decided_by = pg_temp.u('d2a1') and (pg_temp.room('e040')).reason = 'link_revoked',
    'Reset no aparta lo que esperaba';
  assert (pg_temp.room('e041')).update is not null, 'apartar al resetear perdió los bytes';
  perform pg_temp.check(pg_temp.admit_pages('d2a6'), '', 'lo de un link reseteado aparece');
  perform pg_temp.check(pg_temp.admit('d2a6', 'd2b2', jsonb_build_array(pg_temp.dec('e041', true))), 'aside:link_revoked', 'lo de un link reseteado se admite');
  -- El nuevo escribe; lo del viejo no pasa al nuevo.
  perform pg_temp.save('S2', j);
  perform pg_temp.check(pg_temp.push(pg_temp.tok('S2'), 'd2b2', 'e051', 'GQ=='), 'ok', 'el link nuevo escribe');
  perform pg_temp.check(pg_temp.admit_pages('d2a6'), 'S:1', 'lo del link nuevo');
  -- Revocar: aparta.
  perform pg_temp.as_user('d2a1');
  perform public.revoke_public_link(pg_temp.u('d2b2'));
  perform pg_temp.as_postgres();
  assert (pg_temp.room('e051')).reason = 'link_revoked', 'revocar no aparta';
  -- Las 2000 de K: revivir y sacar al admin que lo creó las aparta.
  update public.public_links set expires_at = null where id = pg_temp.lid('K');
  perform pg_temp.as_user('d2a0');
  perform public.remove_member(pg_temp.u('d2a2'));
  perform pg_temp.as_postgres();
  assert (select count(*) from public.public_link_updates where link_id = pg_temp.lid('K') and reason = 'link_revoked') = 2000,
    'remove_member no aparta';
  assert (select count(*) from public.public_link_updates where link_id = pg_temp.lid('K') and update is not null) = 2000,
    'remove_member perdió bytes';
  -- Nada quedó sin decidir de un link revocado.
  assert not exists (select 1 from public.public_link_updates u join public.public_links l on l.id = u.link_id
                     where l.revoked_at is not null and u.decided_at is null), 'quedó algo sin decidir de un link revocado';
  -- Ninguna fila del link se escribió en page_updates sin pasar por la admisión.
  assert (select count(*) from public.page_updates where plink_id is not null)
       = (select count(*) from public.public_link_updates where decision = 'admitted'), 'filas del link sin admitir en page_updates';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- anon: exactamente las funciones del visitante; las dos nuevas, VOLATILE
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  assert (select string_agg(p.proname || ':' || p.provolatile::text, ',' order by p.proname)
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname in ('plink_push_page_update', 'plink_push_status'))
       = 'plink_push_page_update:v,plink_push_status:v', 'las del visitante no son VOLATILE';
  assert not has_function_privilege('authenticated', 'public.plink_push_page_update(uuid, uuid, text, text, text)', 'execute'),
    'una cuenta escribe como link';
  assert not has_function_privilege('anon', 'private.link_page_level(public.public_links, uuid)', 'execute'), 'anon ve link_page_level';
  assert not has_function_privilege('authenticated', 'private.plink_aside_revoked(uuid)', 'execute'), 'una cuenta aparta';
  assert (select schema_version from public.workspace_settings where id) >= 19, 'schema_version';
end;
$$;

rollback;
select 'ok' as result;
