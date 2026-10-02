-- Pruebas de los snapshots de compactar, entrega 1 (20261019120000_compactar_leer.sql, Docs/Doc_Compactar.md, sección 15,
-- prueba 5). Con los snapshots apagados, o sin ninguno, `pull_page_content` devuelve lo mismo que `pull_page_updates`;
-- un snapshot se sirve solo confirmado y válido, y solo a quien ve lo borrado (nunca a Ver, Comentar ni a un invitado,
-- tampoco con la privacidad de lo borrado prendida); nadie lee las tablas directo; reservar, subir, confirmar, saltear
-- e invalidar controlan quién y la forma; invalidar alcanza a toda la cadena y sube la época; subir la versión mínima
-- deja afuera las cadenas viejas; un proyecto borrado no sirve nada; ninguna fila de `page_updates` cambia. Corre dentro
-- de una transacción que se deshace al final: no deja usuarios ni datos. Si todo pasa, devuelve una fila con
-- result = 'ok'.

begin;

-- Todo apagado al empezar (la prueba prende cada interruptor más abajo).
update public.workspace_settings set clean_min_version = null, snapshot_min_version = null where id;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-00000000' || s)::uuid;
$$;

create function pg_temp.as_user(s text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', pg_temp.u(s), 'role', 'authenticated')::text, true),
         set_config('request.headers', '{"x-shotdocs-version": "9.999"}', true);
$$;

create function pg_temp.as_postgres() returns void language sql as $$
  select set_config('role', 'postgres', true);
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
    raise exception 'FALLA: % (dio % %)', what, sqlstate, sqlerrm;
  end;
  raise exception 'FALLA: %', what;
end;
$$;

-- Lo que baja la sesión con cada función, como texto comparable: "seq:base64[:s]:época,…" (`:s` si es un snapshot).
create function pg_temp.content(page text, after bigint default 0, lim int default 200) returns text language sql as $$
  select coalesce(string_agg(r.seq || ':' || r.update || case when r.snapshot_id is not null then ':s' else '' end
                             || ':' || r.content_epoch, ',' order by r.seq), '')
  from public.pull_page_content(pg_temp.u(page), after, lim) r;
$$;

create function pg_temp.epoch(page text) returns int language sql security definer as $$
  select pg.content_epoch from public.pages pg where pg.id = pg_temp.u(page);
$$;

-- Lo mismo con `pull_page_updates`, con la época que tiene la página (para comparar con `content`).
create function pg_temp.updates_as_content(page text, after bigint default 0, lim int default 200) returns text
language sql as $$
  select coalesce(string_agg(r.seq || ':' || r.update || ':' || pg_temp.epoch(page), ',' order by r.seq), '')
  from public.pull_page_updates(pg_temp.u(page), after, lim) r;
$$;

create function pg_temp.snap_seq(page text) returns bigint language sql security definer as $$
  select pg.snapshot_seq from public.pages pg where pg.id = pg_temp.u(page);
$$;

-- ¿Lo que baja la sesión empieza con un snapshot? Devuelve su `seq`, o null.
create function pg_temp.snap_served(page text, after bigint default 0) returns bigint language sql as $$
  select r.seq from public.pull_page_content(pg_temp.u(page), after) r where r.snapshot_id is not null;
$$;

-- El id de la fila `seq` de la página (la columna `id` se lee desde la API).
create function pg_temp.row_id(page text, s bigint) returns bigint language sql as $$
  select u.id from public.page_updates u where u.page_id = pg_temp.u(page) and u.seq = s;
$$;

-- Las filas tal como están en la tabla (como postgres).
create function pg_temp.rows_of(page text) returns text language sql security definer as $$
  select coalesce(string_agg(u.seq || ':' || u.id || ':' || md5(u.update), ',' order by u.seq), '')
  from public.page_updates u where u.page_id = pg_temp.u(page);
$$;

-- La huella SHA-256 (hexadecimal) de un contenido en base64.
create function pg_temp.sha(b64 text) returns text language sql security definer as $$
  select encode(extensions.digest(decode(b64, 'base64'), 'sha256'), 'hex');
$$;

-- Sube un snapshot (vector 'AA==') y devuelve "resultado" o el id: `push(page, base, up_to, b64, version)`.
create function pg_temp.push(page text, base uuid, up_to bigint, b64 text, ver text default '1.000') returns record
language sql as $$
  select r.snapshot_id, r.result
  from public.push_page_snapshot(pg_temp.u(page), base, up_to, pg_temp.row_id(page, up_to), b64, 'AA==',
                                 pg_temp.sha(b64), ver) r;
$$;

create function pg_temp.push_id(page text, base uuid, up_to bigint, b64 text, ver text default '1.000') returns uuid
language sql as $$
  select r.snapshot_id
  from public.push_page_snapshot(pg_temp.u(page), base, up_to, pg_temp.row_id(page, up_to), b64, 'AA==',
                                 pg_temp.sha(b64), ver) r;
$$;

create function pg_temp.push_result(page text, base uuid, up_to bigint, b64 text, ver text default '1.000') returns text
language sql as $$
  select r.result
  from public.push_page_snapshot(pg_temp.u(page), base, up_to, pg_temp.row_id(page, up_to), b64, 'AA==',
                                 pg_temp.sha(b64), ver) r;
$$;

create function pg_temp.snap(id uuid) returns public.page_snapshots language sql security definer as $$
  select * from public.page_snapshots where page_snapshots.id = snap.id;
$$;

-- Personas: a (creó P y Q), e (Editar P), ep (Editar y crear P), c (Comentar P), v (Ver P), g (invitado, Editar P),
-- x (sin permiso), ek (miembro con Editar solo sobre K).
insert into auth.users (id, email, aud, role) values
  (pg_temp.u('d1a0'), 'sn-a@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('d1a1'), 'sn-e@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('d1a2'), 'sn-ep@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('d1a3'), 'sn-c@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('d1a4'), 'sn-v@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('d1a5'), 'sn-g@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('d1a6'), 'sn-x@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('d1a7'), 'sn-ek@test.invalid', 'authenticated', 'authenticated');
insert into public.members (user_id, role) values
  (pg_temp.u('d1a0'), 'member'), (pg_temp.u('d1a1'), 'member'), (pg_temp.u('d1a2'), 'member'),
  (pg_temp.u('d1a3'), 'member'), (pg_temp.u('d1a4'), 'member'), (pg_temp.u('d1a5'), 'guest'),
  (pg_temp.u('d1a6'), 'member'), (pg_temp.u('d1a7'), 'member');
insert into public.workspaces (id, owner_id, name) values
  (pg_temp.u('d1e0'), pg_temp.u('d1a0'), 'P'),
  (pg_temp.u('d1e1'), pg_temp.u('d1a0'), 'Q');
-- P: R (120 filas de 600 bytes), K (3 filas), T (120 filas, después a la papelera). Q: D (120 filas).
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  (pg_temp.u('d1b0'), pg_temp.u('d1e0'), null, 'R', 'a0'),
  (pg_temp.u('d1b1'), pg_temp.u('d1e0'), null, 'K', 'a1'),
  (pg_temp.u('d1b2'), pg_temp.u('d1e0'), null, 'T', 'a2'),
  (pg_temp.u('d1b4'), pg_temp.u('d1e0'), null, 'M', 'a3'),
  (pg_temp.u('d1b3'), pg_temp.u('d1e1'), null, 'D', 'a0');
insert into public.grants (user_id, project_id, page_id, level) values
  (pg_temp.u('d1a1'), pg_temp.u('d1e0'), null, 'edit'),
  (pg_temp.u('d1a2'), pg_temp.u('d1e0'), null, 'edit_pages'),
  (pg_temp.u('d1a3'), pg_temp.u('d1e0'), null, 'comment'),
  (pg_temp.u('d1a4'), pg_temp.u('d1e0'), null, 'view'),
  (pg_temp.u('d1a5'), pg_temp.u('d1e0'), null, 'edit'),
  (pg_temp.u('d1a7'), null, pg_temp.u('d1b1'), 'edit');

-- El contenido, como postgres (la base no lee Yjs: bytes cualquiera). Cada fila de R, T y D pesa 600 bytes: 120 filas
-- son 72 000 bytes de cola, más que los 64 KB que pide reservar.
insert into public.page_updates (page_id, seq, client_update_id, update)
select pg_temp.u(p), n, gen_random_uuid(), decode(repeat(lpad(to_hex(n), 4, '0'), 300), 'hex')
from unnest(array['d1b0', 'd1b2', 'd1b3']) p, generate_series(1, 120) n;
insert into public.page_updates (page_id, seq, client_update_id, update) values
  (pg_temp.u('d1b1'), 1, gen_random_uuid(), '\x01'), (pg_temp.u('d1b1'), 2, gen_random_uuid(), '\x02'),
  (pg_temp.u('d1b1'), 3, gen_random_uuid(), '\x03');
update public.pages set update_seq = 120 where id in (pg_temp.u('d1b0'), pg_temp.u('d1b2'), pg_temp.u('d1b3'));
update public.pages set update_seq = 3 where id = pg_temp.u('d1b1');
-- M: 50 filas de 2000 bytes (100 KB de cola, pero menos de 100 filas).
insert into public.page_updates (page_id, seq, client_update_id, update)
select pg_temp.u('d1b4'), n, gen_random_uuid(), decode(repeat('ab', 2000), 'hex') from generate_series(1, 50) n;
update public.pages set update_seq = 50 where id = pg_temp.u('d1b4');

create temp table rows_before as select pg_temp.rows_of('d1b0') as r, pg_temp.rows_of('d1b1') as k;
grant all on rows_before to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Nadie lee las tablas nuevas ni ejecuta las funciones auxiliares; el árbol sí lee las dos columnas de `pages`
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  s text;
begin
  foreach s in array array['d1a0', 'd1a1', 'd1a4'] loop
    perform pg_temp.as_user(s);
    perform pg_temp.expect_error('select * from public.page_snapshots', '42501', s || ' lee page_snapshots');
    perform pg_temp.expect_error('select * from public.page_compaction', '42501', s || ' lee page_compaction');
    perform pg_temp.expect_error('select private.current_snapshot(' || quote_literal(pg_temp.u('d1b0')) || ')', '42501',
                                 s || ' ejecuta current_snapshot');
    perform pg_temp.expect_error('select private.snapshots_allowed(''1.000'')', '42501', s || ' ejecuta snapshots_allowed');
    perform pg_temp.expect_error(format('select private.invalidate_snapshot_chain(%L, %L, %L)', pg_temp.u('d1b0'),
                                        pg_temp.u('d1b0'), 'x'), '42501', s || ' ejecuta invalidate_snapshot_chain');
    perform pg_temp.expect_error(format('update public.pages set content_epoch = 5 where id = %L', pg_temp.u('d1b0')),
                                 '42501', s || ' cambia content_epoch');
    perform pg_temp.expect_error(format('update public.pages set snapshot_seq = 5 where id = %L', pg_temp.u('d1b0')),
                                 '42501', s || ' cambia snapshot_seq');
    assert (select pg.snapshot_seq = 0 and pg.content_epoch = 0 from public.pages pg where pg.id = pg_temp.u('d1b0')),
      s || ': no lee snapshot_seq y content_epoch con el árbol';
  end loop;
  perform pg_temp.as_postgres();
  -- anon no ejecuta nada de esto.
  assert not has_function_privilege('anon', 'public.pull_page_content(uuid, bigint, int)', 'execute'), 'anon baja contenido';
  assert not has_function_privilege('anon', 'public.pull_page_snapshot(uuid)', 'execute'), 'anon baja un snapshot';
  assert not has_function_privilege('anon', 'public.push_page_snapshot(uuid, uuid, bigint, bigint, text, text, text, text)', 'execute'),
    'anon sube un snapshot';
  assert not has_function_privilege('anon', 'public.claim_page_compaction(uuid, text)', 'execute'), 'anon reserva';
  assert not has_function_privilege('anon', 'public.invalidate_page_snapshot(uuid, text)', 'execute'), 'anon invalida';
  assert has_function_privilege('authenticated', 'public.pull_page_content(uuid, bigint, int)', 'execute'),
    'authenticated no baja contenido';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Apagados: `pull_page_content` es `pull_page_updates` (con la época), para todos; no se reserva ni se sube nada
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  s text;
begin
  foreach s in array array['d1a0', 'd1a1', 'd1a2', 'd1a3', 'd1a4', 'd1a5'] loop
    perform pg_temp.as_user(s);
    assert pg_temp.content('d1b0') = pg_temp.updates_as_content('d1b0'), s || ' apagado: no baja lo mismo que pull_page_updates';
    assert pg_temp.content('d1b0', 100, 5) = pg_temp.updates_as_content('d1b0', 100, 5), s || ' apagado: cursor y lote';
    assert pg_temp.content('d1b1', 1) = pg_temp.updates_as_content('d1b1', 1), s || ' apagado: K';
    assert pg_temp.content('d1b0', 200) = '', s || ' apagado: baja algo después del final';
  end loop;
  -- Un lote de más de 1000 se corta en 1000, y uno de 0 o null, como pull_page_updates.
  perform pg_temp.as_user('d1a0');
  assert pg_temp.content('d1b0', 0, 0) = pg_temp.updates_as_content('d1b0', 0, 0), 'apagado: lote 0';
  assert (select count(*) from public.pull_page_content(pg_temp.u('d1b0'), null, null)) = 120, 'apagado: lote null';
  perform pg_temp.as_user('d1a1');
  assert (select count(*) from public.claim_page_compaction(pg_temp.u('d1b0'), '1.000')) = 0, 'apagado: reserva';
  perform pg_temp.expect_error($q$select pg_temp.push('d1b0', null, 120, 'AQID')$q$, 'snapshot_off', 'apagado: sube');
  perform pg_temp.as_user('d1a6');
  perform pg_temp.expect_error($q$select pg_temp.content('d1b0')$q$, 'page_not_found', 'x baja R');
  perform pg_temp.as_user('d1a7');
  perform pg_temp.expect_error($q$select pg_temp.content('d1b0')$q$, 'page_not_found', 'ek baja R');
  assert pg_temp.content('d1b1') = pg_temp.updates_as_content('d1b1'), 'ek no baja K';
  perform pg_temp.as_postgres();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Prendidos y sin ningún snapshot: lo mismo que pull_page_updates
-- ---------------------------------------------------------------------------------------------------
update public.workspace_settings set snapshot_min_version = 0.5 where id;
do $$
declare
  s text;
begin
  foreach s in array array['d1a0', 'd1a1', 'd1a2', 'd1a3', 'd1a4', 'd1a5'] loop
    perform pg_temp.as_user(s);
    assert pg_temp.content('d1b0') = pg_temp.updates_as_content('d1b0'), s || ' prendido sin snapshots: no baja lo mismo';
    assert pg_temp.content('d1b0', 7, 3) = pg_temp.updates_as_content('d1b0', 7, 3), s || ' prendido sin snapshots: cursor';
  end loop;
  perform pg_temp.as_postgres();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Reservar: quién, cuándo y cuánto
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  s text;
  r record;
begin
  -- Quien no ve lo borrado no reserva: Comentar, Ver, un invitado con Editar.
  foreach s in array array['d1a3', 'd1a4', 'd1a5'] loop
    perform pg_temp.as_user(s);
    assert (select count(*) from public.claim_page_compaction(pg_temp.u('d1b0'), '1.000')) = 0, s || ' reserva R';
  end loop;
  perform pg_temp.as_user('d1a6');
  perform pg_temp.expect_error(format('select * from public.claim_page_compaction(%L, %L)', pg_temp.u('d1b0'), '1.000'),
                               'page_not_found', 'x reserva R');
  perform pg_temp.as_user('d1a1');
  -- Una versión vieja, ilegible o sin versión: nada.
  assert (select count(*) from public.claim_page_compaction(pg_temp.u('d1b0'), '0.400')) = 0, 'reserva con 0.400';
  assert (select count(*) from public.claim_page_compaction(pg_temp.u('d1b0'), 'x')) = 0, 'reserva con una versión ilegible';
  assert (select count(*) from public.claim_page_compaction(pg_temp.u('d1b0'), null)) = 0, 'reserva sin versión';
  -- M tiene 100 KB de cola en 50 filas: menos de 100 filas.
  assert (select count(*) from public.claim_page_compaction(pg_temp.u('d1b4'), '1.000')) = 0, 'reserva M con 50 filas';
  -- K tiene 3 filas: menos de 100.
  assert (select count(*) from public.claim_page_compaction(pg_temp.u('d1b1'), '1.000')) = 0, 'reserva K con 3 filas';
  -- R: el tramo entero, sin base.
  select * into r from public.claim_page_compaction(pg_temp.u('d1b0'), '1.000');
  assert r.base_id is null and r.base_seq = 0 and r.up_to_seq = 120 and r.last_update_id = pg_temp.row_id('d1b0', 120),
    'la reserva de R no es el tramo entero';
  -- Mientras dura, otro editor no la toma; el mismo, sí.
  perform pg_temp.as_user('d1a2');
  assert (select count(*) from public.claim_page_compaction(pg_temp.u('d1b0'), '1.000')) = 0, 'ep toma la reserva de e';
  perform pg_temp.as_user('d1a1');
  assert (select count(*) from public.claim_page_compaction(pg_temp.u('d1b0'), '1.000')) = 1, 'e no vuelve a reservar';
  -- Vencida (más de 10 minutos), otro editor la toma.
  perform pg_temp.as_postgres();
  update public.page_compaction set claim_at = now() - interval '11 minutes' where page_id = pg_temp.u('d1b0');
  perform pg_temp.as_user('d1a2');
  assert (select count(*) from public.claim_page_compaction(pg_temp.u('d1b0'), '1.000')) = 1, 'ep no toma una reserva vencida';
  -- Una cola de menos de 64 KB: nada (como postgres se achican las filas de T, que tiene 120).
  perform pg_temp.as_postgres();
  update public.page_updates set update = '\x01' where page_id = pg_temp.u('d1b2') and seq > 10;
  perform pg_temp.as_user('d1a1');
  assert (select count(*) from public.claim_page_compaction(pg_temp.u('d1b2'), '1.000')) = 0, 'reserva una cola de menos de 64 KB';
  perform pg_temp.as_postgres();
  update public.page_updates set update = decode(repeat('00', 600), 'hex') where page_id = pg_temp.u('d1b2');
  -- En la papelera: nada.
  update public.pages set deleted_at = now() where id = pg_temp.u('d1b2');
  perform pg_temp.as_user('d1a1');
  assert (select count(*) from public.claim_page_compaction(pg_temp.u('d1b2'), '1.000')) = 0, 'reserva una página en la papelera';
  perform pg_temp.as_postgres();
  update public.pages set deleted_at = null where id = pg_temp.u('d1b2');
  -- Saltear: Comentar no puede; e sí, y la página no se vuelve a reservar (ni por otro) hasta que vence.
  perform pg_temp.as_user('d1a3');
  perform pg_temp.expect_error(format('select public.skip_page_compaction(%L, %L)', pg_temp.u('d1b2'), 'x'),
                               'not_allowed', 'c saltea T');
  perform pg_temp.as_user('d1a1');
  assert (select count(*) from public.claim_page_compaction(pg_temp.u('d1b2'), '1.000')) = 1, 'e no reserva T';
  perform public.skip_page_compaction(pg_temp.u('d1b2'), 'too large');
  assert (select count(*) from public.claim_page_compaction(pg_temp.u('d1b2'), '1.000')) = 0, 'reserva T salteada';
  perform pg_temp.as_user('d1a2');
  assert (select count(*) from public.claim_page_compaction(pg_temp.u('d1b2'), '1.000')) = 0, 'ep reserva T salteada';
  perform pg_temp.as_postgres();
  assert (select skip_why = 'too large' and skip_until > now() + interval '23 hours' and claim_at is null
          from public.page_compaction where page_id = pg_temp.u('d1b2')), 'saltear no anota el motivo ni suelta la reserva';
  update public.page_compaction set skip_until = now() - interval '1 minute' where page_id = pg_temp.u('d1b2');
  perform pg_temp.as_user('d1a2');
  assert (select count(*) from public.claim_page_compaction(pg_temp.u('d1b2'), '1.000')) = 1, 'no reserva T vencido el salteo';
  perform pg_temp.as_postgres();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Subir: quién y la forma
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  s text;
begin
  foreach s in array array['d1a3', 'd1a4', 'd1a5'] loop
    perform pg_temp.as_user(s);
    perform pg_temp.expect_error($q$select pg_temp.push('d1b0', null, 120, 'AQID')$q$, 'not_allowed', s || ' sube un snapshot');
  end loop;
  perform pg_temp.as_user('d1a6');
  perform pg_temp.expect_error(
    format('select * from public.push_page_snapshot(%L, null, 120, 1, %L, %L, %L, %L)', pg_temp.u('d1b0'), 'AQID', 'AA==',
           pg_temp.sha('AQID'), '1.000'), 'page_not_found', 'x sube un snapshot');
  perform pg_temp.as_user('d1a1');
  perform pg_temp.expect_error($q$select pg_temp.push('d1b0', null, 120, 'AQID', '0.400')$q$, 'app_outdated', 'una versión vieja sube');
  perform pg_temp.expect_error($q$select pg_temp.push('d1b0', null, 120, 'AQID', null)$q$, 'app_outdated', 'sin versión sube');
  perform pg_temp.expect_error(
    format('select * from public.push_page_snapshot(%L, null, 120, %s, %L, %L, %L, %L)', pg_temp.u('d1b0'),
           pg_temp.row_id('d1b0', 120), 'AQID', 'AA==', pg_temp.sha('AQIE'), '1.000'), 'sha256_mismatch', 'otra huella');
  perform pg_temp.expect_error(
    format('select * from public.push_page_snapshot(%L, null, 120, %s, %L, %L, %L, %L)', pg_temp.u('d1b0'),
           pg_temp.row_id('d1b0', 120), '', 'AA==', pg_temp.sha(''), '1.000'), 'state_size_invalid', 'un snapshot vacío');
  perform pg_temp.expect_error(
    format('select * from public.push_page_snapshot(%L, null, 120, %s, encode(decode(repeat(%L, 8388609), %L), %L), %L, %L, %L)',
           pg_temp.u('d1b0'), pg_temp.row_id('d1b0', 120), '00', 'hex', 'base64', 'AA==', repeat('0', 64), '1.000'),
    'state_size_invalid', 'un snapshot de más de 8 MB');
  perform pg_temp.expect_error(
    format('select * from public.push_page_snapshot(%L, null, 120, %s, %L, %L, %L, %L)', pg_temp.u('d1b0'),
           pg_temp.row_id('d1b0', 120), '!!!', 'AA==', pg_temp.sha('AQID'), '1.000'), 'snapshot_invalid', 'base64 inválido');
  perform pg_temp.expect_error(
    format('select * from public.push_page_snapshot(%L, null, 120, %s, %L, null, %L, %L)', pg_temp.u('d1b0'),
           pg_temp.row_id('d1b0', 120), 'AQID', pg_temp.sha('AQID'), '1.000'), 'snapshot_invalid', 'sin vector');
  -- La fila final con otro id, más allá de update_seq, o cero.
  perform pg_temp.expect_error(
    format('select * from public.push_page_snapshot(%L, null, 120, %s, %L, %L, %L, %L)', pg_temp.u('d1b0'),
           pg_temp.row_id('d1b0', 119), 'AQID', 'AA==', pg_temp.sha('AQID'), '1.000'), 'snapshot_row_mismatch', 'la fila final con otro id');
  perform pg_temp.expect_error(
    format('select * from public.push_page_snapshot(%L, null, 121, %s, %L, %L, %L, %L)', pg_temp.u('d1b0'),
           pg_temp.row_id('d1b0', 120), 'AQID', 'AA==', pg_temp.sha('AQID'), '1.000'), 'snapshot_row_mismatch', 'más allá de update_seq');
  perform pg_temp.expect_error(
    format('select * from public.push_page_snapshot(%L, null, 0, %s, %L, %L, %L, %L)', pg_temp.u('d1b0'),
           pg_temp.row_id('d1b0', 1), 'AQID', 'AA==', pg_temp.sha('AQID'), '1.000'), 'snapshot_row_mismatch', 'up_to_seq cero');
  -- Sobre una base que no es la vigente (no hay ninguna).
  perform pg_temp.expect_error($q$select pg_temp.push('d1b0', gen_random_uuid(), 120, 'AQID')$q$, 'snapshot_base_stale',
                               'sube sobre una base que no existe');
  perform pg_temp.as_postgres();
  assert not exists (select 1 from public.page_snapshots), 'un rechazo guardó un snapshot';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Subir, bajar la vuelta y confirmar; recién ahí se sirve, y solo a quien ve lo borrado
-- ---------------------------------------------------------------------------------------------------
create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated;

do $$
declare
  s1 uuid;
  s  text;
begin
  perform pg_temp.as_user('d1a1');
  s1 := pg_temp.push_id('d1b0', null, 120, 'AQID');
  insert into ids values ('s1', s1);
  assert pg_temp.push_result('d1b0', null, 120, 'AQID') = 'ok' and pg_temp.push_id('d1b0', null, 120, 'AQID') = s1,
    'reintentar no devuelve el mismo';
  -- Sin confirmar no se sirve a nadie.
  foreach s in array array['d1a0', 'd1a1', 'd1a2'] loop
    perform pg_temp.as_user(s);
    assert pg_temp.snap_served('d1b0') is null, s || ': se sirve sin confirmar';
  end loop;
  -- La vuelta: quien lo subió, sí; otro editor, no (sin confirmar); quien no ve lo borrado, tampoco.
  perform pg_temp.as_user('d1a1');
  assert public.pull_page_snapshot(s1) = 'AQID', 'e no baja su snapshot sin confirmar';
  perform pg_temp.as_user('d1a2');
  perform pg_temp.expect_error(format('select public.pull_page_snapshot(%L)', s1), 'snapshot_not_found', 'ep baja uno ajeno sin confirmar');
  perform pg_temp.as_user('d1a4');
  perform pg_temp.expect_error(format('select public.pull_page_snapshot(%L)', s1), 'not_allowed', 'v baja un snapshot');
  perform pg_temp.as_user('d1a6');
  perform pg_temp.expect_error(format('select public.pull_page_snapshot(%L)', s1), 'snapshot_not_found', 'x baja un snapshot');
  -- Confirmar: solo quien lo subió, con su huella.
  perform pg_temp.as_user('d1a2');
  perform pg_temp.expect_error(format('select public.confirm_page_snapshot(%L, %L)', s1, pg_temp.sha('AQID')), 'not_allowed',
                               'ep confirma uno ajeno');
  perform pg_temp.as_user('d1a4');
  perform pg_temp.expect_error(format('select public.confirm_page_snapshot(%L, %L)', s1, pg_temp.sha('AQID')), 'not_allowed',
                               'v confirma');
  perform pg_temp.as_user('d1a1');
  perform pg_temp.expect_error(format('select public.confirm_page_snapshot(%L, %L)', s1, pg_temp.sha('AQIE')), 'sha256_mismatch',
                               'confirma con otra huella');
  assert public.confirm_page_snapshot(s1, pg_temp.sha('AQID')), 'no confirma';
  assert public.confirm_page_snapshot(s1, pg_temp.sha('AQID')), 'confirmar dos veces da false';
  assert pg_temp.snap_seq('d1b0') = 120, 'snapshot_seq no es 120';
  perform pg_temp.as_postgres();
  assert (select claim_at is null from public.page_compaction where page_id = pg_temp.u('d1b0')), 'confirmar no suelta la reserva';
end;
$$;

do $$
declare
  s    text;
  s1   uuid := (select id from ids where name = 's1');
begin
  -- Quien ve lo borrado (el dueño, Editar, Editar y crear) baja el snapshot en vez de las 120 filas.
  foreach s in array array['d1a0', 'd1a1', 'd1a2'] loop
    perform pg_temp.as_user(s);
    assert pg_temp.content('d1b0') = '120:AQID:s:0', s || ': no baja el snapshot (' || left(pg_temp.content('d1b0'), 80) || ')';
    assert public.pull_page_snapshot(s1) = 'AQID', s || ': no baja el vigente por id';
    -- Con el cursor en 119, la cola (600 bytes) pesa más que el snapshot (3): igual el snapshot.
    assert pg_temp.snap_served('d1b0', 119) = 120, s || ': cursor en 119';
    assert pg_temp.content('d1b0', 120) = '', s || ': baja algo con el cursor al final';
  end loop;
  -- Quien no ve lo borrado (Comentar, Ver, invitado con Editar): nunca el snapshot; lo mismo que pull_page_updates.
  foreach s in array array['d1a3', 'd1a4', 'd1a5'] loop
    perform pg_temp.as_user(s);
    assert pg_temp.snap_served('d1b0') is null, s || ': recibe el snapshot';
    assert pg_temp.content('d1b0') = pg_temp.updates_as_content('d1b0'), s || ': no baja lo mismo que pull_page_updates';
    perform pg_temp.expect_error(format('select public.pull_page_snapshot(%L)', s1), 'not_allowed', s || ' baja el snapshot por id');
  end loop;
  perform pg_temp.as_user('d1a7');
  perform pg_temp.expect_error($q$select pg_temp.content('d1b0')$q$, 'page_not_found', 'ek baja R con snapshot');
  perform pg_temp.expect_error(format('select public.pull_page_snapshot(%L)', s1), 'snapshot_not_found', 'ek baja el snapshot de R');
  perform pg_temp.as_postgres();
end;
$$;

-- Con la privacidad de lo borrado prendida (D14): quien no la ve recibe la base limpia (o nada), nunca el snapshot.
update public.workspace_settings set min_app_version = greatest(coalesce(min_app_version, 0), 0.5), clean_min_version = 0.5 where id;
do $$
declare
  s text;
begin
  foreach s in array array['d1a3', 'd1a4', 'd1a5'] loop
    perform pg_temp.as_user(s);
    assert pg_temp.snap_served('d1b0') is null, s || ' con D14: recibe el snapshot';
    assert pg_temp.content('d1b0') = pg_temp.updates_as_content('d1b0'), s || ' con D14: no baja lo mismo que pull_page_updates';
    assert pg_temp.content('d1b0') = '', s || ' con D14 sin base limpia: baja algo';
  end loop;
  -- Con una base limpia vigente, la reciben a ella.
  perform pg_temp.as_user('d1a1');
  perform public.push_clean_base(pg_temp.u('d1c0'), pg_temp.u('d1b0'), 120, pg_temp.row_id('d1b0', 120), 'BAUG',
                                 pg_temp.sha('BAUG'), '1.000');
  foreach s in array array['d1a3', 'd1a4', 'd1a5'] loop
    perform pg_temp.as_user(s);
    assert pg_temp.content('d1b0') = '120:BAUG:0', s || ' con D14: no recibe la base limpia (' || pg_temp.content('d1b0') || ')';
  end loop;
  -- Quien ve lo borrado sigue bajando el snapshot.
  perform pg_temp.as_user('d1a1');
  assert pg_temp.content('d1b0') = '120:AQID:s:0', 'e con D14: no baja el snapshot';
  perform pg_temp.as_postgres();
end;
$$;
update public.workspace_settings set clean_min_version = null where id;

-- ---------------------------------------------------------------------------------------------------
-- El snapshot y las filas siguientes; cuándo conviene; el lote
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.as_user('d1a0');
  perform public.push_page_update(pg_temp.u('d1b0'), pg_temp.u('d121'), 'BQ==', '9.999');
  perform public.push_page_update(pg_temp.u('d1b0'), pg_temp.u('d122'), 'Bg==', '9.999');
  assert pg_temp.content('d1b0') = '120:AQID:s:0,121:BQ==:0,122:Bg==:0', 'no baja el snapshot y la cola: ' || left(pg_temp.content('d1b0'), 120);
  assert pg_temp.content('d1b0', 0, 1) = '120:AQID:s:0', 'lote de uno: no baja solo el snapshot';
  assert pg_temp.content('d1b0', 0, 2) = '120:AQID:s:0,121:BQ==:0', 'lote de dos';
  assert pg_temp.content('d1b0', 120) = '121:BQ==:0,122:Bg==:0', 'con el cursor en el snapshot no baja la cola';
  assert pg_temp.content('d1b0', 121) = '122:Bg==:0', 'con el cursor en 121';
  -- Lo que hay después de la página entera no cambia con un snapshot (pull_page_updates sigue igual).
  assert (select count(*) from public.pull_page_updates(pg_temp.u('d1b0'), 0, 1000)) = 122, 'pull_page_updates cambió';
  perform pg_temp.as_postgres();
end;
$$;

-- Un snapshot más pesado que las filas que reemplaza no se sirve: las filas.
do $$
declare
  big text := encode(decode(repeat('ab', 2000), 'hex'), 'base64');
  t1 uuid;
begin
  perform pg_temp.as_user('d1a0');
  t1 := pg_temp.push_id('d1b3', null, 120, big);
  assert public.confirm_page_snapshot(t1, pg_temp.sha(big)), 'no confirma t1';
  insert into ids values ('t1', t1);
  -- D: 120 filas de 600 bytes (72 000) contra 2000 bytes: el snapshot. Con el cursor en 117 (1800 bytes de cola), filas.
  assert pg_temp.snap_served('d1b3') = 120, 'D: no sirve el snapshot desde 0';
  assert pg_temp.snap_served('d1b3', 117) is null, 'D: sirve un snapshot más pesado que la cola';
  assert pg_temp.content('d1b3', 117) = pg_temp.updates_as_content('d1b3', 117), 'D: la cola desde 117 no es la de siempre';
  assert pg_temp.snap_served('d1b3', 116) = 120, 'D: con 2400 bytes de cola no sirve el snapshot';
  perform pg_temp.as_postgres();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- El mismo tramo: misma huella, otra huella con la misma versión (invalida), otra versión (snapshot_exists)
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  s1 uuid := (select id from ids where name = 's1');
  bad uuid;
  s2 uuid;
begin
  perform pg_temp.as_user('d1a2');
  -- Otra versión de la app, otra huella: 'snapshot_exists', no invalida nada.
  assert pg_temp.push_result('d1b0', null, 120, 'AQIF', '1.001') = 'snapshot_exists', 'otra versión no da snapshot_exists';
  assert pg_temp.snap_served('d1b0') = 120, 'snapshot_exists invalidó';
  -- Misma versión, otra huella: 'snapshot_mismatch'; el nuevo queda invalidado y el otro (con su cadena) también.
  assert pg_temp.push_result('d1b0', null, 120, 'AQIG', '1.000') = 'snapshot_mismatch', 'misma versión no da snapshot_mismatch';
  assert pg_temp.snap_served('d1b0') is null, 'después de snapshot_mismatch se sigue sirviendo';
  assert pg_temp.epoch('d1b0') = 1 and pg_temp.snap_seq('d1b0') = 0, 'snapshot_mismatch no sube la época';
  assert pg_temp.content('d1b0', 119) = '120:' || (select r.update from public.pull_page_updates(pg_temp.u('d1b0'), 119, 1) r) || ':1,121:BQ==:1,122:Bg==:1',
    'después de invalidar no baja las filas con la época nueva';
  perform pg_temp.as_postgres();
  assert (select invalid_at is not null and invalid_reason = 'snapshot_mismatch' from public.page_snapshots where id = s1),
    'snapshot_mismatch no invalida el otro';
  select id into bad from public.page_snapshots where page_id = pg_temp.u('d1b0') and sha256 = decode(pg_temp.sha('AQIG'), 'hex');
  assert (select invalid_at is not null from public.page_snapshots where id = bad), 'el de snapshot_mismatch no queda invalidado';
  -- Ni quien lo subió baja uno invalidado sin confirmar.
  perform pg_temp.as_user('d1a2');
  perform pg_temp.expect_error(format('select public.pull_page_snapshot(%L)', bad), 'snapshot_not_found', 'ep baja su invalidado');
  perform pg_temp.as_user('d1a1');
  perform pg_temp.expect_error(format('select public.pull_page_snapshot(%L)', s1), 'snapshot_not_found', 'baja uno invalidado');
  -- Confirmar uno invalidado: false.
  assert not public.confirm_page_snapshot(s1, pg_temp.sha('AQID')), 'confirma uno invalidado';
  -- El mismo tramo se puede volver a compactar (el índice único es solo de los válidos).
  s2 := pg_temp.push_id('d1b0', null, 122, 'AQIH');
  assert public.confirm_page_snapshot(s2, pg_temp.sha('AQIH')), 'no confirma s2';
  insert into ids values ('s2', s2);
  assert pg_temp.content('d1b0') = '122:AQIH:s:1', 's2 no se sirve con la época 1: ' || left(pg_temp.content('d1b0'), 80);
  perform pg_temp.as_postgres();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- La cadena: un eslabón sobre la base vigente; base vieja; invalidar un eslabón invalida todos
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  s2 uuid := (select id from ids where name = 's2');
  s3 uuid;
  s4 uuid;
  i  int;
begin
  perform pg_temp.as_user('d1a0');
  for i in 123..125 loop
    perform public.push_page_update(pg_temp.u('d1b0'), gen_random_uuid(), 'Bw==', '9.999');
  end loop;
  perform pg_temp.as_user('d1a1');
  -- Sin base (arrancar otra cadena) con una vigente: base vieja.
  perform pg_temp.expect_error($q$select pg_temp.push('d1b0', null, 124, 'CAkK')$q$, 'snapshot_base_stale', 'sin base con una vigente');
  -- Un tramo que no pasa del vigente: base vieja.
  perform pg_temp.expect_error(format($q$select pg_temp.push('d1b0', %L, 121, 'CAkK')$q$, s2), 'snapshot_base_stale',
                               'un tramo que no pasa del vigente');
  s3 := pg_temp.push_id('d1b0', s2, 124, 'CAkK', '1.002');
  perform pg_temp.as_postgres();
  assert (pg_temp.snap(s3)).chain_id = (pg_temp.snap(s2)).chain_id, 'el eslabón no hereda la cadena';
  assert (pg_temp.snap(s3)).chain_min_version = 1.000, 'chain_min_version no es la más vieja';
  -- Mientras s3 (hasta 124) está sin confirmar, se confirma otro sobre la misma base (s4, hasta 123): s3 llega más
  -- lejos, pero su base ya no es la vigente: no se confirma.
  perform pg_temp.as_user('d1a2');
  s4 := pg_temp.push_id('d1b0', s2, 123, 'CwwN');
  assert public.confirm_page_snapshot(s4, pg_temp.sha('CwwN')), 'no confirma s4';
  perform pg_temp.as_user('d1a1');
  assert not public.confirm_page_snapshot(s3, pg_temp.sha('CAkK')), 'confirma un eslabón sobre una base que ya no es la vigente';
  assert pg_temp.content('d1b0') = '123:CwwN:s:1,124:Bw==:1,125:Bw==:1', 's4 no se sirve: ' || left(pg_temp.content('d1b0'), 80);
  -- Invalidar: Comentar no; un invitado con Editar sí (puede editar la página); invalida s2 y s4 (la cadena entera).
  perform pg_temp.as_user('d1a3');
  perform pg_temp.expect_error(format('select public.invalidate_page_snapshot(%L, %L)', s2, 'x'), 'not_allowed', 'c invalida');
  perform pg_temp.as_user('d1a6');
  perform pg_temp.expect_error(format('select public.invalidate_page_snapshot(%L, %L)', s2, 'x'), 'snapshot_not_found', 'x invalida');
  perform pg_temp.as_user('d1a5');
  assert public.invalidate_page_snapshot(s2, 'test'), 'g no invalida';
  assert not public.invalidate_page_snapshot(s2, 'test'), 'invalidar dos veces da true';
  perform pg_temp.as_postgres();
  assert (pg_temp.snap(s4)).invalid_at is not null, 'invalidar s2 no invalida s4 (la cadena)';
  assert pg_temp.epoch('d1b0') = 2 and pg_temp.snap_seq('d1b0') = 0, 'invalidar no sube la época ni pone snapshot_seq en 0';
  perform pg_temp.as_user('d1a1');
  assert pg_temp.snap_served('d1b0') is null, 'después de invalidar la cadena se sirve algo';
  -- La próxima reserva arranca desde la fila 1.
  assert (select r.base_id is null and r.base_seq = 0 from public.claim_page_compaction(pg_temp.u('d1b0'), '1.000') r),
    'después de invalidar, la reserva no arranca desde la fila 1';
  perform pg_temp.as_postgres();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Subir snapshot_min_version deja de servir las cadenas en las que participó una versión anterior
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  a uuid;
  b uuid;
begin
  perform pg_temp.as_user('d1a1');
  a := pg_temp.push_id('d1b0', null, 123, 'DQ4P', '0.600');
  assert public.confirm_page_snapshot(a, pg_temp.sha('DQ4P')), 'no confirma a';
  b := pg_temp.push_id('d1b0', a, 125, 'EBES', '0.800');
  assert public.confirm_page_snapshot(b, pg_temp.sha('EBES')), 'no confirma b';
  assert pg_temp.snap_served('d1b0') = 125, 'b no se sirve';
  perform pg_temp.as_postgres();
  assert (pg_temp.snap(b)).chain_min_version = 0.600, 'b no lleva la versión de a';
  -- Limpieza al confirmar b: quedan b y su base; los invalidados de hace menos de 30 días también.
  assert exists (select 1 from public.page_snapshots where id = a), 'la limpieza borró la base';
  update public.workspace_settings set snapshot_min_version = 0.7 where id;
  perform pg_temp.as_user('d1a1');
  assert pg_temp.snap_served('d1b0') is null, 'con la mínima en 0.7 sirve una cadena de 0.6';
  -- Y la reserva arranca desde la fila 1 (la cadena no vale).
  assert (select r.base_id is null from public.claim_page_compaction(pg_temp.u('d1b0'), '1.000') r), 'reserva sobre una cadena vieja';
  -- No se puede subir sobre ella.
  perform pg_temp.expect_error(format($q$select pg_temp.push('d1b0', %L, 124, 'ExQV')$q$, b), 'snapshot_base_stale',
                               'sube sobre una cadena que ya no vale');
  perform pg_temp.as_postgres();
  update public.workspace_settings set snapshot_min_version = 0.5 where id;
  perform pg_temp.as_user('d1a1');
  assert pg_temp.snap_served('d1b0') = 125, 'con la mínima de vuelta en 0.5 no se sirve';
  -- Apagados: nada, aunque haya uno válido; lo mismo que pull_page_updates.
  perform pg_temp.as_postgres();
  update public.workspace_settings set snapshot_min_version = null where id;
  perform pg_temp.as_user('d1a1');
  assert pg_temp.snap_served('d1b0') is null, 'apagados se sirve un snapshot';
  assert pg_temp.content('d1b0') = pg_temp.updates_as_content('d1b0'), 'apagados no baja lo mismo que pull_page_updates';
  perform pg_temp.expect_error(format('select public.pull_page_snapshot(%L)', b), 'snapshot_not_found', 'apagados baja uno por id');
  perform pg_temp.expect_error(format('select public.confirm_page_snapshot(%L, %L)', b, pg_temp.sha('EBES')), 'snapshot_off',
                               'apagados confirma');
  perform pg_temp.as_postgres();
  update public.workspace_settings set snapshot_min_version = 0.5 where id;
  insert into ids values ('b', b);
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Una copia restaurada: la fila final con otro id, o update_seq menor que el tramo
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  b uuid := (select id from ids where name = 'b');
  upd bytea;
begin
  perform pg_temp.as_user('d1a1');
  assert pg_temp.snap_served('d1b0') = 125, 'b no se sirve antes de restaurar';
  perform pg_temp.as_postgres();
  -- La fila 125 vuelve con otro id (como al restaurar una copia que no la tenía y otra subida tomó ese seq).
  select update into upd from public.page_updates where page_id = pg_temp.u('d1b0') and seq = 125;
  delete from public.page_updates where page_id = pg_temp.u('d1b0') and seq = 125;
  insert into public.page_updates (page_id, seq, client_update_id, update) values (pg_temp.u('d1b0'), 125, gen_random_uuid(), upd);
  perform pg_temp.as_user('d1a1');
  -- b ya no vale; su base (a, hasta 123, con sus filas intactas) sí.
  assert pg_temp.snap_served('d1b0') = 123, 'sirve un snapshot cuya fila final cambió de id (o no vuelve a su base)';
  perform pg_temp.as_postgres();
  -- update_seq menor que el tramo (una copia más vieja): tampoco.
  update public.pages set update_seq = 100 where id = pg_temp.u('d1b3');
  perform pg_temp.as_user('d1a0');
  assert pg_temp.snap_served('d1b3') is null, 'sirve un snapshot que pasa de update_seq';
  perform pg_temp.as_postgres();
  update public.pages set update_seq = 120 where id = pg_temp.u('d1b3');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- La limpieza al confirmar: los anteriores a la base, los sin confirmar de más de un día, los invalidados de más de 30
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  c1 uuid;
  c2 uuid;
  c3 uuid;
  old_unconfirmed uuid;
  old_invalid uuid;
  recent_invalid uuid;
begin
  -- K: 3 filas. c1 hasta 1, c2 hasta 2, c3 hasta 3 (la cadena c1 → c2 → c3).
  perform pg_temp.as_user('d1a0');
  old_unconfirmed := pg_temp.push_id('d1b1', null, 3, 'AAEC');
  perform pg_temp.as_postgres();
  update public.page_snapshots set created_at = now() - interval '2 days' where id = old_unconfirmed;
  -- Otro sin confirmar viejo ocupa el tramo 3: se invalida a mano para dejar compactar el tramo (y queda viejo).
  update public.page_snapshots set invalid_at = now() - interval '31 days' where id = old_unconfirmed;
  old_invalid := old_unconfirmed;
  perform pg_temp.as_user('d1a0');
  old_unconfirmed := pg_temp.push_id('d1b1', null, 2, 'AAED');
  perform pg_temp.as_postgres();
  update public.page_snapshots set created_at = now() - interval '2 days' where id = old_unconfirmed;
  -- Un invalidado reciente se queda.
  update public.page_snapshots set invalid_at = now() - interval '2 days' where id = old_unconfirmed;
  recent_invalid := old_unconfirmed;
  perform pg_temp.as_user('d1a0');
  old_unconfirmed := pg_temp.push_id('d1b1', null, 1, 'AAEE');
  perform pg_temp.as_postgres();
  update public.page_snapshots set created_at = now() - interval '2 days' where id = old_unconfirmed;
  perform pg_temp.as_user('d1a0');
  c1 := pg_temp.push_id('d1b1', null, 2, 'AQEB');
  assert public.confirm_page_snapshot(c1, pg_temp.sha('AQEB')), 'no confirma c1';
  perform pg_temp.as_postgres();
  assert not exists (select 1 from public.page_snapshots where id = old_unconfirmed), 'no borra el sin confirmar de más de un día';
  assert not exists (select 1 from public.page_snapshots where id = old_invalid), 'no borra el invalidado de más de 30 días';
  assert exists (select 1 from public.page_snapshots where id = recent_invalid), 'borra un invalidado reciente';
  perform pg_temp.as_user('d1a0');
  c2 := pg_temp.push_id('d1b1', c1, 3, 'AgIC');
  assert public.confirm_page_snapshot(c2, pg_temp.sha('AgIC')), 'no confirma c2';
  perform pg_temp.as_postgres();
  assert exists (select 1 from public.page_snapshots where id = c1), 'borra la base del vigente';
  -- Un eslabón más (la fila 4): c1 queda anterior a la base (c2) y se borra.
  perform pg_temp.as_user('d1a0');
  perform public.push_page_update(pg_temp.u('d1b1'), gen_random_uuid(), 'BA==', '9.999');
  c3 := pg_temp.push_id('d1b1', c2, 4, 'AwMD');
  assert public.confirm_page_snapshot(c3, pg_temp.sha('AwMD')), 'no confirma c3';
  perform pg_temp.as_postgres();
  assert not exists (select 1 from public.page_snapshots where id = c1), 'no borra el anterior a la base';
  assert exists (select 1 from public.page_snapshots where id = c2), 'borra la base';
  -- Invalidar c3 alcanza a c1 aunque ya no esté (la cadena sigue por chain_id) y a c2.
  perform pg_temp.as_user('d1a6');
  perform pg_temp.expect_error(format('select public.invalidate_page_snapshot(%L, %L)', c3, 'x'), 'snapshot_not_found',
                               'x invalida en K');
  perform pg_temp.as_user('d1a7');
  assert public.invalidate_page_snapshot(c3, 'test'), 'ek no invalida c3';
  perform pg_temp.as_postgres();
  assert (pg_temp.snap(c2)).invalid_at is not null, 'invalidar c3 no invalida c2';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Un proyecto borrado no sirve nada
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  t1 uuid := (select id from ids where name = 't1');
begin
  perform pg_temp.as_postgres();
  update public.workspaces set deleted_at = now() where id = pg_temp.u('d1e1');
  perform pg_temp.as_user('d1a0');
  perform pg_temp.expect_error($q$select pg_temp.content('d1b3')$q$, 'page_not_found', 'baja de un proyecto borrado');
  perform pg_temp.expect_error(format('select public.pull_page_snapshot(%L)', t1), 'snapshot_not_found', 'baja un snapshot de un proyecto borrado');
  perform pg_temp.expect_error(format('select * from public.claim_page_compaction(%L, %L)', pg_temp.u('d1b3'), '1.000'),
                               'page_not_found', 'reserva en un proyecto borrado');
  perform pg_temp.expect_error(format('select public.invalidate_page_snapshot(%L, %L)', t1, 'x'), 'snapshot_not_found',
                               'invalida en un proyecto borrado');
  perform pg_temp.as_postgres();
  update public.workspaces set deleted_at = null where id = pg_temp.u('d1e1');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Nada de page_updates cambió (salvo lo agregado por push_page_update y la fila 125 que la prueba rehízo)
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.as_postgres();
  assert left(pg_temp.rows_of('d1b0'), length((select r from rows_before))) = (select r from rows_before),
    'las filas de R cambiaron';
  assert left(pg_temp.rows_of('d1b1'), length((select k from rows_before))) = (select k from rows_before),
    'las filas de K cambiaron';
  assert (select schema_version from public.workspace_settings where id) >= 17, 'schema_version no es 17';
end;
$$;

rollback;
select 'ok' as result;
