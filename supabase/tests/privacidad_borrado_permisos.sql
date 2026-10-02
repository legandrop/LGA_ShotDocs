-- Pruebas de la privacidad de lo borrado (20261010120000_privacidad_borrado.sql, Docs/Doc_Privacidad_Borrado.md,
-- sección 9, prueba 5). Con el interruptor apagado todos bajan filas como siempre; prendido, Ver, Comentar y los
-- invitados reciben solo la base limpia (o nada sin base vigente) y quien edita sin ser invitado, las filas. La columna
-- `update` no se lee directo; `push_clean_base` controla la forma; compartir, invitar y mover reinician; los usos sacados
-- de un archivo no dan permiso a quien no ve lo borrado; la papelera de archivos no es para invitados. Corre dentro de
-- una transacción que se deshace al final: no deja usuarios ni datos. Si todo pasa, devuelve una fila con result = 'ok'.

begin;

-- El interruptor empieza apagado (la prueba lo prende más abajo).
update public.workspace_settings set clean_min_version = null where id;

-- El interruptor no se prende por encima de la mínima de la app, ni sin mínima; y prendido, la mínima no baja de él.
do $$
declare
  min_before numeric := (select min_app_version from public.workspace_settings where id);
begin
  update public.workspace_settings set min_app_version = 0.4 where id;
  begin
    update public.workspace_settings set clean_min_version = 0.5 where id;
    raise exception 'FALLA: prende el interruptor por encima de la mínima';
  exception when check_violation then null;
  end;
  update public.workspace_settings set min_app_version = null where id;
  begin
    update public.workspace_settings set clean_min_version = 0.5 where id;
    raise exception 'FALLA: prende el interruptor sin mínima';
  exception when check_violation then null;
  end;
  update public.workspace_settings set min_app_version = 0.5 where id;
  update public.workspace_settings set clean_min_version = 0.5 where id;
  assert (select clean_min_version from public.workspace_settings where id) = 0.5, 'no prende con la mínima igual';
  update public.workspace_settings set min_app_version = 0.6 where id;
  begin
    update public.workspace_settings set min_app_version = 0.4 where id;
    raise exception 'FALLA: baja la mínima por debajo del interruptor';
  exception when check_violation then null;
  end;
  update public.workspace_settings set clean_min_version = null where id;
  update public.workspace_settings set min_app_version = min_before where id;
end;
$$;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-00000000' || s)::uuid;
$$;

create function pg_temp.as_user(s text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', pg_temp.u(s), 'role', 'authenticated')::text, true),
         -- Como la app desde v0.099: con la versión en el header (la base frena el árbol sin él).
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

-- Lo que baja la sesión: "seq:base64,seq:base64…".
create function pg_temp.pulled(page text, after bigint default 0) returns text language sql as $$
  select coalesce(string_agg(r.seq || ':' || r.update, ',' order by r.seq), '')
  from public.pull_page_updates(pg_temp.u(page), after) r;
$$;

-- Las filas de la página tal como están en la tabla (como postgres), en el mismo formato.
create function pg_temp.rows_of(page text) returns text language sql security definer as $$
  select coalesce(string_agg(u.seq || ':' || translate(encode(u.update, 'base64'), E'\n', ''), ',' order by u.seq), '')
  from public.page_updates u where u.page_id = pg_temp.u(page);
$$;

-- El id de la fila `seq` de la página (la columna `id` se lee desde la API).
create function pg_temp.row_id(page text, s bigint) returns bigint language sql as $$
  select u.id from public.page_updates u where u.page_id = pg_temp.u(page) and u.seq = s;
$$;

-- La huella SHA-256 (hexadecimal) de un contenido en base64.
create function pg_temp.sha(b64 text) returns text language sql security definer as $$
  select encode(extensions.digest(decode(b64, 'base64'), 'sha256'), 'hex');
$$;

-- Sube una base con la versión '1.000' y devuelve lo que contesta.
create function pg_temp.push_base(id_suffix text, page text, to_seq bigint, b64 text) returns text language sql as $$
  select public.push_clean_base(pg_temp.u(id_suffix), pg_temp.u(page), to_seq, pg_temp.row_id(page, to_seq),
                                b64, pg_temp.sha(b64), '1.000');
$$;

create function pg_temp.clean(page text) returns record language sql security definer as $$
  select pg.clean_seq, pg.clean_reset_seq, pg.update_seq from public.pages pg where pg.id = pg_temp.u(page);
$$;

create function pg_temp.clean_seq(page text) returns bigint language sql security definer as $$
  select pg.clean_seq from public.pages pg where pg.id = pg_temp.u(page);
$$;

create function pg_temp.reset_seq(page text) returns bigint language sql security definer as $$
  select pg.clean_reset_seq from public.pages pg where pg.id = pg_temp.u(page);
$$;

-- ¿`clean_work` le pide a la sesión armar esta página?
create function pg_temp.in_work(page text) returns boolean language sql as $$
  select exists (select 1 from public.clean_work('1.000') w where w.page_id = pg_temp.u(page));
$$;

-- Personas: a (creó P y Q), e (Editar P), ep (Editar y crear P), c (Comentar P), v (Ver P), g (invitado, Editar P),
-- gp (invitado, Editar y crear P), ad (admin, Editar y crear P), x (sin permiso), vq (Ver QR), nw (para compartir
-- después), ge (miembro con Editar sobre QR, que después pasa a invitado).
insert into auth.users (id, email, aud, role) values
  (pg_temp.u('c1a0'), 'pb-a@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('c1a1'), 'pb-e@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('c1a2'), 'pb-ep@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('c1a3'), 'pb-c@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('c1a4'), 'pb-v@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('c1a5'), 'pb-g@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('c1a6'), 'pb-gp@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('c1a7'), 'pb-ad@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('c1a8'), 'pb-x@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('c1a9'), 'pb-vq@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('c1aa'), 'pb-nw@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('c1ab'), 'pb-ge@test.invalid', 'authenticated', 'authenticated');
insert into public.members (user_id, role) values
  (pg_temp.u('c1a0'), 'member'), (pg_temp.u('c1a1'), 'member'), (pg_temp.u('c1a2'), 'member'),
  (pg_temp.u('c1a3'), 'member'), (pg_temp.u('c1a4'), 'member'), (pg_temp.u('c1a5'), 'guest'),
  (pg_temp.u('c1a6'), 'guest'), (pg_temp.u('c1a7'), 'admin'), (pg_temp.u('c1a8'), 'member'),
  (pg_temp.u('c1a9'), 'member'), (pg_temp.u('c1aa'), 'member'), (pg_temp.u('c1ab'), 'member');
insert into public.workspaces (id, owner_id, name) values
  (pg_temp.u('c1e0'), pg_temp.u('c1a0'), 'P'),
  (pg_temp.u('c1e1'), pg_temp.u('c1a0'), 'Q');
-- P: R › R1, K. Q: QR, QM, QN (raíces).
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  (pg_temp.u('c1b0'), pg_temp.u('c1e0'), null, 'R', 'a0'),
  (pg_temp.u('c1b1'), pg_temp.u('c1e0'), pg_temp.u('c1b0'), 'R1', 'a1'),
  (pg_temp.u('c1b2'), pg_temp.u('c1e0'), null, 'K', 'a2'),
  (pg_temp.u('c1b3'), pg_temp.u('c1e1'), null, 'QR', 'a0'),
  (pg_temp.u('c1b4'), pg_temp.u('c1e1'), null, 'QM', 'a1'),
  (pg_temp.u('c1b5'), pg_temp.u('c1e1'), null, 'QN', 'a2');
insert into public.grants (user_id, project_id, page_id, level) values
  (pg_temp.u('c1a1'), pg_temp.u('c1e0'), null, 'edit'),
  (pg_temp.u('c1a2'), pg_temp.u('c1e0'), null, 'edit_pages'),
  (pg_temp.u('c1a3'), pg_temp.u('c1e0'), null, 'comment'),
  (pg_temp.u('c1a4'), pg_temp.u('c1e0'), null, 'view'),
  (pg_temp.u('c1a5'), pg_temp.u('c1e0'), null, 'edit'),
  (pg_temp.u('c1a6'), pg_temp.u('c1e0'), null, 'edit_pages'),
  (pg_temp.u('c1a7'), pg_temp.u('c1e0'), null, 'edit_pages'),
  (pg_temp.u('c1a7'), pg_temp.u('c1e1'), null, 'edit_pages'),
  (pg_temp.u('c1a9'), null, pg_temp.u('c1b3'), 'view'),
  (pg_temp.u('c1ab'), null, pg_temp.u('c1b3'), 'edit');

-- Contenido: R tiene 3 filas, las demás una. Bytes cualquiera (la base no lee Yjs).
select pg_temp.as_user('c1a0');
select public.push_page_update(pg_temp.u('c1b0'), pg_temp.u('c101'), 'AQ==', '9.999');
select public.push_page_update(pg_temp.u('c1b0'), pg_temp.u('c102'), 'Ag==', '9.999');
select public.push_page_update(pg_temp.u('c1b0'), pg_temp.u('c103'), 'Aw==', '9.999');
select public.push_page_update(pg_temp.u('c1b1'), pg_temp.u('c104'), 'BA==', '9.999');
select public.push_page_update(pg_temp.u('c1b2'), pg_temp.u('c105'), 'BQ==', '9.999');
select public.push_page_update(pg_temp.u('c1b3'), pg_temp.u('c106'), 'Bg==', '9.999');
select public.push_page_update(pg_temp.u('c1b4'), pg_temp.u('c107'), 'Bw==', '9.999');
select public.push_page_update(pg_temp.u('c1b5'), pg_temp.u('c108'), 'CA==', '9.999');

-- Archivos de P: f1 usado en R, f2 sacado de R (uso con `removed_at`).
select pg_temp.as_postgres();
insert into public.files (id, project_id, name, mime, size, created_by) values
  (pg_temp.u('c1f1'), pg_temp.u('c1e0'), 'activo.jpg', 'image/jpeg', 1, pg_temp.u('c1a0')),
  (pg_temp.u('c1f2'), pg_temp.u('c1e0'), 'sacado.jpg', 'image/jpeg', 1, pg_temp.u('c1a0'));
insert into public.page_files (page_id, file_id, removed_at) values
  (pg_temp.u('c1b0'), pg_temp.u('c1f1'), null),
  (pg_temp.u('c1b0'), pg_temp.u('c1f2'), now());

-- ---------------------------------------------------------------------------------------------------
-- La columna `update` no se lee directo, para nadie; las demás sí
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  s text;
begin
  foreach s in array array['c1a0', 'c1a1', 'c1a4', 'c1a5', 'c1a7'] loop
    perform pg_temp.as_user(s);
    perform pg_temp.expect_error('select update from public.page_updates', '42501', s || ' lee la columna update');
    perform pg_temp.expect_error('select * from public.page_updates', '42501', s || ' lee la fila entera');
    assert (select count(*) from public.page_updates where page_id = pg_temp.u('c1b0')) = 3, s || ': no cuenta las filas';
    assert pg_temp.row_id('c1b0', 3) is not null, s || ': no lee el id';
  end loop;
  perform pg_temp.as_postgres();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Interruptor apagado: todos bajan las filas, como siempre; no se arma nada
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  s    text;
  rows text := pg_temp.rows_of('c1b0');
begin
  assert rows = '1:AQ==,2:Ag==,3:Aw==', 'las filas de R no son las esperadas: ' || rows;
  foreach s in array array['c1a0', 'c1a1', 'c1a3', 'c1a4', 'c1a5', 'c1a6'] loop
    perform pg_temp.as_user(s);
    assert pg_temp.pulled('c1b0') = rows, s || ' apagado: no baja las filas (' || pg_temp.pulled('c1b0') || ')';
  end loop;
  perform pg_temp.as_user('c1a1');
  assert (select count(*) from public.clean_work('1.000')) = 0, 'apagado: clean_work devuelve páginas';
  perform pg_temp.expect_error($q$select pg_temp.push_base('c1d0', 'c1b0', 3, 'AQID')$q$, 'clean_off', 'apagado: acepta una base');
  perform pg_temp.as_postgres();
  assert not exists (select 1 from public.page_clean_bases where page_id = pg_temp.u('c1b0')), 'apagado: guardó una base';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Prendido, sin base: quien no ve lo borrado no baja nada; quien lo ve, las filas
-- ---------------------------------------------------------------------------------------------------
update public.workspace_settings set min_app_version = greatest(coalesce(min_app_version, 0), 0.5), clean_min_version = 0.5 where id;
do $$
declare
  s text;
begin
  foreach s in array array['c1a3', 'c1a4', 'c1a5', 'c1a6'] loop
    perform pg_temp.as_user(s);
    assert pg_temp.pulled('c1b0') = '', s || ' sin base: baja algo (' || pg_temp.pulled('c1b0') || ')';
  end loop;
  foreach s in array array['c1a0', 'c1a1', 'c1a2', 'c1a7'] loop
    perform pg_temp.as_user(s);
    assert pg_temp.pulled('c1b0') = '1:AQ==,2:Ag==,3:Aw==', s || ' prendido: no baja las filas';
    assert pg_temp.pulled('c1b0', 2) = '3:Aw==', s || ' prendido: no baja desde el cursor';
  end loop;
  perform pg_temp.as_user('c1a8');
  perform pg_temp.expect_error($q$select pg_temp.pulled('c1b0')$q$, 'page_not_found', 'x baja R');
  perform pg_temp.as_postgres();
end;
$$;

-- has_plain_readers: con permisos por proyecto, por página, revocados, invitados y miembros con Editar.
do $$
begin
  assert private.has_plain_readers(pg_temp.u('c1b0')), 'R: Ver, Comentar e invitados sobre P no cuentan';
  assert private.has_plain_readers(pg_temp.u('c1b3')), 'QR: Ver sobre la página no cuenta';
  assert not private.has_plain_readers(pg_temp.u('c1b4')), 'QM: sin lectores da sí';
  -- ge (miembro con Editar sobre QR) no es lector; sin vq, QR no tiene lectores.
  update public.grants set revoked_at = now() where user_id = pg_temp.u('c1a9');
  assert not private.has_plain_readers(pg_temp.u('c1b3')), 'QR: un permiso revocado cuenta, o Editar cuenta como lector';
  update public.grants set revoked_at = null where user_id = pg_temp.u('c1a9');
  -- ge pasa a invitado: con Editar, es lector.
  update public.grants set revoked_at = now() where user_id = pg_temp.u('c1a9');
  update public.members set role = 'guest' where user_id = pg_temp.u('c1ab');
  assert private.has_plain_readers(pg_temp.u('c1b3')), 'QR: un invitado con Editar no cuenta';
  update public.members set role = 'member' where user_id = pg_temp.u('c1ab');
  update public.grants set revoked_at = null where user_id = pg_temp.u('c1a9');
  -- Sacado del workspace: no cuenta.
  update public.members set removed_at = now() where user_id = pg_temp.u('c1a9');
  assert not private.has_plain_readers(pg_temp.u('c1b3')), 'QR: alguien sacado cuenta';
  update public.members set removed_at = null where user_id = pg_temp.u('c1a9');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- push_clean_base: quién y la forma
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  s text;
begin
  -- Quien no ve lo borrado no arma: Ver, Comentar e invitados (también con Editar y crear).
  foreach s in array array['c1a3', 'c1a4', 'c1a5', 'c1a6'] loop
    perform pg_temp.as_user(s);
    perform pg_temp.expect_error($q$select pg_temp.push_base('c1d0', 'c1b0', 3, 'AQID')$q$, 'not_allowed', s || ' arma una base');
    assert (select count(*) from public.clean_work('1.000')) = 0, s || ': clean_work le devuelve páginas';
  end loop;
  perform pg_temp.as_user('c1a8');
  -- (x no lee ni el id de la fila: se lo da la prueba.)
  perform pg_temp.expect_error(
    format('select public.push_clean_base(%L, %L, 3, 1, %L, %L, %L)', pg_temp.u('c1d0'), pg_temp.u('c1b0'),
           'AQID', pg_temp.sha('AQID'), '1.000'), 'page_not_found', 'x arma una base');

  perform pg_temp.as_user('c1a1');
  -- La versión: menor que la del interruptor, o ilegible.
  perform pg_temp.expect_error(
    format('select public.push_clean_base(%L, %L, 3, %s, %L, %L, %L)', pg_temp.u('c1d0'), pg_temp.u('c1b0'),
           pg_temp.row_id('c1b0', 3), 'AQID', pg_temp.sha('AQID'), '0.400'), 'app_outdated', 'una versión vieja arma');
  perform pg_temp.expect_error(
    format('select public.push_clean_base(%L, %L, 3, %s, %L, %L, null)', pg_temp.u('c1d0'), pg_temp.u('c1b0'),
           pg_temp.row_id('c1b0', 3), 'AQID', pg_temp.sha('AQID')), 'app_outdated', 'sin versión arma');
  assert (select count(*) from public.clean_work('0.400')) = 0, 'clean_work con una versión vieja';
  -- La fila final con otro id, más allá de update_seq, o cero.
  perform pg_temp.expect_error(
    format('select public.push_clean_base(%L, %L, 3, %s, %L, %L, %L)', pg_temp.u('c1d0'), pg_temp.u('c1b0'),
           pg_temp.row_id('c1b0', 2), 'AQID', pg_temp.sha('AQID'), '1.000'), 'clean_row_mismatch', 'la fila final con otro id');
  perform pg_temp.expect_error(
    format('select public.push_clean_base(%L, %L, 4, %s, %L, %L, %L)', pg_temp.u('c1d0'), pg_temp.u('c1b0'),
           pg_temp.row_id('c1b0', 3), 'AQID', pg_temp.sha('AQID'), '1.000'), 'clean_row_mismatch', 'to_seq más allá de update_seq');
  perform pg_temp.expect_error(
    format('select public.push_clean_base(%L, %L, 0, %s, %L, %L, %L)', pg_temp.u('c1d0'), pg_temp.u('c1b0'),
           pg_temp.row_id('c1b0', 1), 'AQID', pg_temp.sha('AQID'), '1.000'), 'clean_row_mismatch', 'to_seq cero');
  -- Otra huella, contenido vacío o de más de 8 MB, base64 inválido.
  perform pg_temp.expect_error(
    format('select public.push_clean_base(%L, %L, 3, %s, %L, %L, %L)', pg_temp.u('c1d0'), pg_temp.u('c1b0'),
           pg_temp.row_id('c1b0', 3), 'AQID', pg_temp.sha('AQIE'), '1.000'), 'sha256_mismatch', 'otra huella');
  perform pg_temp.expect_error(
    format('select public.push_clean_base(%L, %L, 3, %s, %L, %L, %L)', pg_temp.u('c1d0'), pg_temp.u('c1b0'),
           pg_temp.row_id('c1b0', 3), '', pg_temp.sha(''), '1.000'), 'state_size_invalid', 'una base vacía');
  perform pg_temp.expect_error(
    format('select public.push_clean_base(%L, %L, 3, %s, encode(decode(repeat(%L, 8388609), %L), %L), %L, %L)',
           pg_temp.u('c1d0'), pg_temp.u('c1b0'), pg_temp.row_id('c1b0', 3), '00', 'hex', 'base64', repeat('0', 64), '1.000'),
    'state_size_invalid', 'una base de más de 8 MB');
  perform pg_temp.expect_error(
    format('select public.push_clean_base(%L, %L, 3, %s, %L, %L, %L)', pg_temp.u('c1d0'), pg_temp.u('c1b0'),
           pg_temp.row_id('c1b0', 3), '!!!', pg_temp.sha('AQID'), '1.000'), 'clean_invalid', 'base64 inválido');

  -- clean_work: R no tiene base, así que entra ya (también QR); QM no tiene lectores.
  assert exists (select 1 from public.clean_work('1.000') w where w.page_id = pg_temp.u('c1b0') and w.update_seq = 3
                 and w.last_update_id = pg_temp.row_id('c1b0', 3) and w.clean_seq = 0), 'clean_work no devuelve R';
  assert not exists (select 1 from public.clean_work('1.000') w where w.page_id = pg_temp.u('c1b4')), 'clean_work devuelve QM';
  assert (select count(*) from public.clean_work('1.000', array[pg_temp.u('c1b2')])) = 1, 'clean_work no limita a p_pages';

  -- La buena: 'ok', y clean_seq la nombra. Reintentar con el mismo id: 'ok'. Otra igual o más vieja: 'clean_old'.
  assert pg_temp.push_base('c1d0', 'c1b0', 2, 'AQID') = 'ok', 'no acepta una base válida';
  assert pg_temp.clean_seq('c1b0') = 2, 'clean_seq no es el to_seq de la base';
  assert pg_temp.push_base('c1d0', 'c1b0', 2, 'AQID') = 'ok', 'el reintento con el mismo id no da ok';
  assert pg_temp.push_base('c1d1', 'c1b0', 2, 'AQIE') = 'clean_old', 'acepta otra base igual de nueva';
  assert pg_temp.push_base('c1d1', 'c1b0', 1, 'AQIE') = 'clean_old', 'acepta una base más vieja';
  -- Con una base vigente y la última fila recién subida, R no entra hasta la pausa o los 2 minutos; urgente, sí.
  assert not exists (select 1 from public.clean_work('1.000') w where w.page_id = pg_temp.u('c1b0')),
    'clean_work devuelve R sin esperar la pausa';
  assert exists (select 1 from public.clean_work('1.000', null, true) w where w.page_id = pg_temp.u('c1b0')),
    'clean_work urgente no devuelve R';
  perform pg_temp.as_postgres();
  update public.page_updates set created_at = now() - interval '30 seconds' where page_id = pg_temp.u('c1b0');
  perform pg_temp.as_user('c1a1');
  assert exists (select 1 from public.clean_work('1.000') w where w.page_id = pg_temp.u('c1b0')),
    'clean_work no devuelve R después de la pausa de 20 s';
  perform pg_temp.as_postgres();
end;
$$;

-- Bajar con base: quien no ve lo borrado recibe solo la base (una fila, seq = to_seq, que no es ninguna fila); desde el
-- to_seq, nada. Quien la ve, las filas.
do $$
declare
  s text;
begin
  foreach s in array array['c1a3', 'c1a4', 'c1a5', 'c1a6'] loop
    perform pg_temp.as_user(s);
    assert pg_temp.pulled('c1b0') = '2:AQID', s || ' no baja solo la base (' || pg_temp.pulled('c1b0') || ')';
    assert pg_temp.pulled('c1b0', 1) = '2:AQID', s || ' no baja la base desde atrás';
    assert pg_temp.pulled('c1b0', 2) = '', s || ' baja algo desde el to_seq de la base';
    assert pg_temp.pulled('c1b1') = '', s || ' baja algo de R1 sin base';
  end loop;
  foreach s in array array['c1a0', 'c1a1', 'c1a2'] loop
    perform pg_temp.as_user(s);
    assert pg_temp.pulled('c1b0') = '1:AQ==,2:Ag==,3:Aw==', s || ' con base: no baja las filas';
  end loop;
  perform pg_temp.as_postgres();
end;
$$;

-- La base vigente se mira con la fila final: una copia restaurada (otra fila con ese seq) no la sirve.
do $$
begin
  update public.page_clean_bases set last_update_id = -1 where page_id = pg_temp.u('c1b0');
  perform pg_temp.as_user('c1a4');
  assert pg_temp.pulled('c1b0') = '', 'sirve una base cuya fila final cambió de id';
  perform pg_temp.as_postgres();
  update public.page_clean_bases set last_update_id = pg_temp.row_id('c1b0', 2) where page_id = pg_temp.u('c1b0');
  -- Una copia que vuelve `update_seq` atrás dejando la fila: la base llega más allá de la página y tampoco se sirve.
  update public.pages set update_seq = 1 where id = pg_temp.u('c1b0');
  perform pg_temp.as_user('c1a4');
  assert pg_temp.pulled('c1b0') = '', 'sirve una base que llega más allá de update_seq';
  perform pg_temp.as_postgres();
  update public.pages set update_seq = 3 where id = pg_temp.u('c1b0');
  perform pg_temp.as_user('c1a4');
  assert pg_temp.pulled('c1b0') = '2:AQID', 'la base no vuelve con update_seq';
  perform pg_temp.as_postgres();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Compartir, invitar y mover reinician
-- ---------------------------------------------------------------------------------------------------
-- R tiene base en 2 y 3 filas. Más filas (4, 5) y después a comparte R con nw (Ver): R y R1 se reinician en su
-- update_seq; la base en 2 deja de servirse; una base anterior al reinicio se rechaza ('clean_stale', B3).
select pg_temp.as_user('c1a0');
select public.push_page_update(pg_temp.u('c1b0'), pg_temp.u('c109'), 'CQ==', '9.999');
select public.push_page_update(pg_temp.u('c1b0'), pg_temp.u('c10a'), 'Cg==', '9.999');
select public.share(pg_temp.u('c1aa'), null, pg_temp.u('c1b0'), 'view');
do $$
begin
  assert pg_temp.reset_seq('c1b0') = 5 and pg_temp.clean_seq('c1b0') = 0, 'compartir con Ver no reinicia R';
  assert pg_temp.reset_seq('c1b1') = 1 and pg_temp.clean_seq('c1b1') = 0, 'compartir con Ver no reinicia R1';
  assert pg_temp.reset_seq('c1b2') = 0, 'compartir R reinició K';
  perform pg_temp.as_user('c1a4');
  assert pg_temp.pulled('c1b0') = '', 'sirve una base anterior a compartir';
  perform pg_temp.as_user('c1a1');
  assert pg_temp.push_base('c1d2', 'c1b0', 4, 'AQIF') = 'clean_stale', 'acepta una base anterior a compartir (vista atrasada)';
  assert pg_temp.push_base('c1d0', 'c1b0', 2, 'AQID') = 'ok', 'el reintento de la base vieja con su id no da ok';
  perform pg_temp.as_user('c1a4');
  assert pg_temp.pulled('c1b0') = '', 'el reintento revive la base vieja';
  perform pg_temp.as_user('c1a1');
  assert pg_temp.push_base('c1d3', 'c1b0', 5, 'AQIG') = 'ok', 'no acepta la base que llega al reinicio';
  perform pg_temp.as_user('c1a4');
  assert pg_temp.pulled('c1b0') = '5:AQIG', 'no sirve la base nueva';
  perform pg_temp.as_postgres();
end;
$$;

-- Compartir de nuevo con una base que ya llega hasta update_seq la deja vigente (es la página como se comparte).
select pg_temp.as_user('c1a0');
select public.share(pg_temp.u('c1aa'), null, pg_temp.u('c1b0'), 'comment');
do $$
begin
  assert pg_temp.clean_seq('c1b0') = 5 and pg_temp.reset_seq('c1b0') = 5, 'compartir borró una base al día';
  perform pg_temp.as_user('c1a4');
  assert pg_temp.pulled('c1b0') = '5:AQIG', 'compartir de nuevo dejó de servir la base al día';
  perform pg_temp.as_postgres();
end;
$$;

-- Compartir con Editar a un miembro no reinicia nada; con Editar a un invitado, sí.
select pg_temp.as_user('c1a0');
select public.push_page_update(pg_temp.u('c1b2'), pg_temp.u('c10b'), 'Cw==', '9.999');
select public.share(pg_temp.u('c1aa'), null, pg_temp.u('c1b2'), 'edit');
do $$
begin
  assert pg_temp.reset_seq('c1b2') = 0, 'compartir con Editar a un miembro reinicia';
end;
$$;
select public.share(pg_temp.u('c1a5'), null, pg_temp.u('c1b2'), 'edit');
do $$
begin
  assert pg_temp.reset_seq('c1b2') = 2, 'compartir con Editar a un invitado no reinicia';
end;
$$;

-- Invitar: a un invitado (con cualquier nivel) o con Ver o Comentar reinicia al invitar; a un miembro con Editar, no.
select pg_temp.as_user('c1a7');
select public.create_invitation('pb-new1@test.invalid', 'member', jsonb_build_array(jsonb_build_object('page_id', pg_temp.u('c1b5'), 'level', 'edit')));
do $$
begin
  assert pg_temp.reset_seq('c1b5') = 0, 'invitar a un miembro con Editar reinicia';
end;
$$;
select public.create_invitation('pb-new2@test.invalid', 'guest', jsonb_build_array(jsonb_build_object('page_id', pg_temp.u('c1b5'), 'level', 'edit')));
do $$
begin
  assert pg_temp.reset_seq('c1b5') = 1, 'invitar a un invitado no reinicia';
end;
$$;
select pg_temp.as_postgres();
update public.pages set clean_reset_seq = 0 where id = pg_temp.u('c1b5');
-- QR con una base en 1 y una fila más (2): al reiniciar el proyecto, la base ya no llega y `clean_seq` vuelve a 0.
select pg_temp.as_user('c1a0');
select public.push_page_update(pg_temp.u('c1b3'), pg_temp.u('c10c'), 'DA==', '9.999');
select pg_temp.as_user('c1a7');
do $$
begin
  assert pg_temp.push_base('c1d4', 'c1b3', 1, 'AQIH') = 'ok', 'no acepta la base de QR';
  assert pg_temp.clean_seq('c1b3') = 1, 'clean_seq de QR no es 1';
end;
$$;
select public.create_invitation('pb-new3@test.invalid', 'member', jsonb_build_array(jsonb_build_object('project_id', pg_temp.u('c1e1'), 'level', 'view')));
do $$
begin
  assert pg_temp.reset_seq('c1b5') = 1 and pg_temp.reset_seq('c1b3') = 2 and pg_temp.reset_seq('c1b4') = 1,
    'invitar con Ver al proyecto no reinicia todas sus páginas';
  assert pg_temp.clean_seq('c1b3') = 0, 'reiniciar el proyecto deja clean_seq en una base que ya no llega';
  perform pg_temp.as_postgres();
  update public.pages set clean_reset_seq = 0 where workspace_id = pg_temp.u('c1e1');
end;
$$;

-- Mover: QM adentro de QR (que tiene un lector, vq) reinicia QM; mover QN adentro de QM, también (QM ya está en la
-- rama de QR); devolver QN a la raíz (sin lectores) no.
select pg_temp.as_user('c1a0');
update public.pages set parent_id = pg_temp.u('c1b3') where id = pg_temp.u('c1b4');
do $$
begin
  assert pg_temp.reset_seq('c1b4') = 1, 'mover a una rama con lectores no reinicia';
  assert pg_temp.reset_seq('c1b5') = 0, 'mover QM reinició QN';
end;
$$;
update public.pages set title = 'QN otra' where id = pg_temp.u('c1b5');
do $$
begin
  assert pg_temp.reset_seq('c1b5') = 0, 'cambiar el título reinicia';
end;
$$;
select pg_temp.as_postgres();
update public.pages set clean_reset_seq = 0 where workspace_id = pg_temp.u('c1e1');
select pg_temp.as_user('c1a0');
update public.pages set parent_id = pg_temp.u('c1b4') where id = pg_temp.u('c1b5');
update public.pages set parent_id = null where id = pg_temp.u('c1b4');
do $$
begin
  assert pg_temp.reset_seq('c1b5') = 1, 'mover adentro de una página con lectores no reinicia';
  assert pg_temp.reset_seq('c1b4') = 0, 'mover a la raíz sin lectores reinicia';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Fotos y archivos sacados
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  s text;
begin
  -- Quien no ve lo borrado: f1 sí, f2 (sacado de R) no, por ningún camino.
  foreach s in array array['c1a3', 'c1a4', 'c1a5', 'c1a6'] loop
    perform pg_temp.as_user(s);
    assert private.file_level(pg_temp.u('c1f1')) >= 1, s || ': no ve f1';
    assert private.file_level(pg_temp.u('c1f2')) = 0, s || ': file_level de f2';
    assert not private.can_view_file(pg_temp.u('c1f2'), null), s || ': can_view_file de f2';
    assert public.media_file(pg_temp.u('c1f2')) is null, s || ': el portero le daría f2';
    assert (select count(*) from public.files where id = pg_temp.u('c1f2')) = 0, s || ': ve la fila de f2';
    assert (select count(*) from public.page_files where file_id = pg_temp.u('c1f2')) = 0, s || ': ve el uso sacado de f2';
    assert (select count(*) from public.page_files where file_id = pg_temp.u('c1f1')) = 1, s || ': no ve el uso de f1';
    -- La política de `thumbs` pide file_level >= 1 del archivo que nombra el objeto.
    assert private.file_level(private.thumb_file_id(pg_temp.u('c1f2')::text || '.jpg')) = 0, s || ': miniatura de f2';
  end loop;
  -- Quien ve lo borrado: f2 también.
  foreach s in array array['c1a0', 'c1a1', 'c1a7'] loop
    perform pg_temp.as_user(s);
    assert private.file_level(pg_temp.u('c1f2')) >= 3, s || ': no ve f2';
    assert public.media_file(pg_temp.u('c1f2')) is not null, s || ': el portero no le da f2';
    assert (select count(*) from public.page_files where file_id = pg_temp.u('c1f2')) = 1, s || ': no ve el uso sacado';
  end loop;
  -- La papelera de archivos: f2 está (ninguna página lo usa). Un invitado con Editar y crear sobre P no la ve (R2);
  -- la admin sí.
  perform pg_temp.as_user('c1a6');
  perform pg_temp.expect_error($q$select * from public.trashed_files(pg_temp.u('c1e0'))$q$, 'not_allowed', 'un invitado ve la papelera de archivos');
  perform pg_temp.as_user('c1a7');
  assert exists (select 1 from public.trashed_files(pg_temp.u('c1e0')) t where t.id = pg_temp.u('c1f2')), 'la admin no ve f2 en la papelera';
  perform pg_temp.as_postgres();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Un proyecto borrado no sirve nada, ni filas ni base
-- ---------------------------------------------------------------------------------------------------
update public.workspaces set deleted_at = now() where id = pg_temp.u('c1e0');
do $$
declare
  s text;
begin
  foreach s in array array['c1a1', 'c1a4'] loop
    perform pg_temp.as_user(s);
    perform pg_temp.expect_error($q$select pg_temp.pulled('c1b0')$q$, 'page_not_found', s || ' baja R de un proyecto borrado');
    assert (select count(*) from public.clean_work('1.000') w where w.page_id = pg_temp.u('c1b0')) = 0, s || ': clean_work con el proyecto borrado';
  end loop;
  perform pg_temp.as_postgres();
end;
$$;
update public.workspaces set deleted_at = null where id = pg_temp.u('c1e0');

-- ---------------------------------------------------------------------------------------------------
-- Qué pide armar clean_work: hijas de una página compartida, páginas que solo ve un invitado, y que las que nadie
-- puede armar (papelera, proyecto borrado) o que arma otro editor no tapen a las demás
-- ---------------------------------------------------------------------------------------------------
-- Personas: o (creó V, W e Y), vr (Ver sobre la página A de V), gs (invitado, Editar solo sobre S de V), ey (Editar
-- sobre Y y nada más), vw (Ver W y Ver Y, y Editar sobre la página L4 de Y), ew (Editar solo sobre la página L2 de W).
insert into auth.users (id, email, aud, role) values
  (pg_temp.u('c2a0'), 'pb-o@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('c2a1'), 'pb-vr@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('c2a2'), 'pb-gs@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('c2a3'), 'pb-ey@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('c2a4'), 'pb-vw@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('c2a5'), 'pb-ew@test.invalid', 'authenticated', 'authenticated');
insert into public.members (user_id, role) values
  (pg_temp.u('c2a0'), 'member'), (pg_temp.u('c2a1'), 'member'), (pg_temp.u('c2a2'), 'guest'),
  (pg_temp.u('c2a3'), 'member'), (pg_temp.u('c2a4'), 'member'), (pg_temp.u('c2a5'), 'member');
insert into public.workspaces (id, owner_id, name) values
  (pg_temp.u('c2e0'), pg_temp.u('c2a0'), 'V'),
  (pg_temp.u('c2e1'), pg_temp.u('c2a0'), 'W'),
  (pg_temp.u('c2e2'), pg_temp.u('c2a0'), 'Y');
-- V: A › A1, S. Y: L, L4. W: L2, XP (sus 221 hijas se crean más abajo).
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  (pg_temp.u('c2b0'), pg_temp.u('c2e0'), null, 'A', 'a0'),
  (pg_temp.u('c2b1'), pg_temp.u('c2e0'), pg_temp.u('c2b0'), 'A1', 'a1'),
  (pg_temp.u('c2b2'), pg_temp.u('c2e0'), null, 'S', 'a2'),
  (pg_temp.u('c2b3'), pg_temp.u('c2e2'), null, 'L', 'a0'),
  (pg_temp.u('c2b4'), pg_temp.u('c2e1'), null, 'XP', 'a0'),
  (pg_temp.u('c2b5'), pg_temp.u('c2e1'), null, 'L2', 'a1'),
  (pg_temp.u('c2b6'), pg_temp.u('c2e2'), null, 'L4', 'a1');
insert into public.grants (user_id, project_id, page_id, level) values
  (pg_temp.u('c2a1'), null, pg_temp.u('c2b0'), 'view'),
  (pg_temp.u('c2a2'), null, pg_temp.u('c2b2'), 'edit'),
  (pg_temp.u('c2a3'), pg_temp.u('c2e2'), null, 'edit'),
  (pg_temp.u('c2a4'), pg_temp.u('c2e1'), null, 'view'),
  (pg_temp.u('c2a4'), pg_temp.u('c2e2'), null, 'view'),
  (pg_temp.u('c2a5'), null, pg_temp.u('c2b5'), 'edit'),
  (pg_temp.u('c2a4'), null, pg_temp.u('c2b6'), 'edit');
select pg_temp.as_user('c2a0');
select public.push_page_update(pg_temp.u('c2b0'), pg_temp.u('c201'), 'AQ==', '9.999');
select public.push_page_update(pg_temp.u('c2b1'), pg_temp.u('c202'), 'Ag==', '9.999');
select public.push_page_update(pg_temp.u('c2b1'), pg_temp.u('c203'), 'Aw==', '9.999');
select public.push_page_update(pg_temp.u('c2b2'), pg_temp.u('c204'), 'BA==', '9.999');
select public.push_page_update(pg_temp.u('c2b3'), pg_temp.u('c205'), 'BQ==', '9.999');
select public.push_page_update(pg_temp.u('c2b3'), pg_temp.u('c206'), 'Bg==', '9.999');
select public.push_page_update(pg_temp.u('c2b5'), pg_temp.u('c208'), 'DQ==', '9.999');
select public.push_page_update(pg_temp.u('c2b5'), pg_temp.u('c209'), 'Dg==', '9.999');
select public.push_page_update(pg_temp.u('c2b6'), pg_temp.u('c20a'), 'Dw==', '9.999');
select pg_temp.as_postgres();

-- La hija de una página compartida con Ver se arma, y su lector baja solo la base.
do $$
begin
  assert private.has_plain_readers(pg_temp.u('c2b1')), 'A1: el lector de la página de arriba no cuenta';
  perform pg_temp.as_user('c2a1');
  assert pg_temp.pulled('c2b1') = '', 'vr baja filas de A1 sin base';
  perform pg_temp.as_user('c2a0');
  assert pg_temp.in_work('c2b1'), 'clean_work no devuelve A1 (hija de una página compartida con Ver)';
  assert pg_temp.push_base('c2d0', 'c2b1', 2, 'AQIDCA==') = 'ok', 'no acepta la base de A1';
  perform pg_temp.as_user('c2a1');
  assert pg_temp.pulled('c2b1') = '2:AQIDCA==', 'vr no baja solo la base de A1';
  perform pg_temp.as_postgres();
end;
$$;

-- L4: su único lector por el proyecto (vw) tiene Editar sobre ella: no tiene lectores y no se pide armar.
do $$
begin
  assert not private.has_plain_readers(pg_temp.u('c2b6')), 'L4: alguien con Editar cuenta como lector';
  perform pg_temp.as_user('c2a0');
  assert not exists (select 1 from public.clean_work('1.000', array[pg_temp.u('c2b6')])),
    'clean_work pide armar una página sin lectores (quien la ve por el proyecto la edita)';
  assert exists (select 1 from public.clean_work('1.000', array[pg_temp.u('c2b3')])), 'clean_work no devuelve L (sin base)';
  perform pg_temp.as_postgres();
end;
$$;

-- Una página que solo ve un invitado con Editar se arma; el invitado no baja filas, sube las suyas y no arma.
do $$
begin
  assert private.has_plain_readers(pg_temp.u('c2b2')), 'S: el invitado con Editar no cuenta';
  perform pg_temp.as_user('c2a0');
  assert pg_temp.in_work('c2b2'), 'clean_work no devuelve S (solo la ve un invitado con Editar)';
  perform pg_temp.as_user('c2a2');
  assert pg_temp.pulled('c2b2') = '', 'el invitado con Editar baja filas';
  assert public.push_page_update(pg_temp.u('c2b2'), pg_temp.u('c207'), 'CQ==', '9.999') = 2, 'el invitado no sube';
  perform pg_temp.expect_error($q$select pg_temp.push_base('c2d1', 'c2b2', 2, 'AQI=')$q$, 'not_allowed', 'el invitado arma');
  assert (select count(*) from public.clean_work('1.000')) = 0, 'clean_work le da páginas al invitado';
  perform pg_temp.as_postgres();
end;
$$;

-- L (en Y) tiene una base en 1 y una fila después, de hace 30 s: le toca armar. W tiene XP y 221 hijas con una fila
-- cada una y sin base, compartidas con Ver: más que el corte de 200 que tenía la primera versión de clean_work.
insert into public.pages (id, workspace_id, parent_id, title, sort_key)
  select ('00000000-0000-4000-8000-0000000' || lpad(to_hex(49152 + i), 5, '0'))::uuid, pg_temp.u('c2e1'),
         pg_temp.u('c2b4'), 'X' || i, 'b' || lpad(i::text, 4, '0')
  from generate_series(0, 220) i;
select pg_temp.as_user('c2a0');
do $$
declare
  i int;
begin
  perform public.push_page_update(pg_temp.u('c2b4'), gen_random_uuid(), 'Cg==', '9.999');
  for i in 0..220 loop
    perform public.push_page_update(('00000000-0000-4000-8000-0000000' || lpad(to_hex(49152 + i), 5, '0'))::uuid,
                                    gen_random_uuid(), 'Cw==', '9.999');
  end loop;
  assert pg_temp.push_base('c2d2', 'c2b3', 1, 'AQIDCQ==') = 'ok', 'no acepta la base de L';
  assert pg_temp.push_base('c2d3', 'c2b5', 1, 'AQIDCg==') = 'ok', 'no acepta la base de L2';
end;
$$;
select pg_temp.as_postgres();
update public.page_updates set created_at = now() - interval '30 seconds' where page_id in (pg_temp.u('c2b3'), pg_temp.u('c2b5'));
do $$
begin
  -- ey edita Y y no ve W: las 222 de W (sin base, las arma o) no le tapan L.
  perform pg_temp.as_user('c2a3');
  assert pg_temp.in_work('c2b3'), 'con 222 páginas que arma otro editor, clean_work no le devuelve L a ey';
  assert not pg_temp.in_work('c2b4'), 'clean_work le pide a ey una página que no ve';
  -- ew edita solo L2, en el mismo proyecto que las 222: no las puede armar y no le tapan L2.
  perform pg_temp.as_user('c2a5');
  assert pg_temp.in_work('c2b5'), 'con 222 páginas del mismo proyecto que no puede armar, clean_work no le devuelve L2 a ew';
  assert (select count(*) from public.clean_work('1.000')) = 1, 'clean_work le pide a ew páginas que no edita';
  -- XP a la papelera (sus hijas cuelgan de ella): nadie que no edite las ve, nadie las arma, y no tapan L.
  perform pg_temp.as_postgres();
  update public.pages set deleted_at = now() where id = pg_temp.u('c2b4');
  perform pg_temp.as_user('c2a0');
  assert pg_temp.in_work('c2b3'), 'con 222 páginas en la papelera de un proyecto compartido, clean_work no devuelve L';
  assert not pg_temp.in_work('c2b4'), 'clean_work pide armar una página en la papelera';
  assert not pg_temp.in_work('c000'), 'clean_work pide armar una hija de una página en la papelera';
  -- Fuera de la papelera, con el proyecto W borrado: lo mismo.
  perform pg_temp.as_postgres();
  update public.pages set deleted_at = null where id = pg_temp.u('c2b4');
  update public.workspaces set deleted_at = now() where id = pg_temp.u('c2e1');
  perform pg_temp.as_user('c2a0');
  assert pg_temp.in_work('c2b3'), 'con 222 páginas de un proyecto borrado, clean_work no devuelve L';
  assert not pg_temp.in_work('c2b4'), 'clean_work pide armar una página de un proyecto borrado';
  perform pg_temp.as_postgres();
  update public.workspaces set deleted_at = null where id = pg_temp.u('c2e1');
  -- Con W vivo, o arma sus páginas sin base (de a 50, primero las que no tienen base).
  perform pg_temp.as_user('c2a0');
  assert (select count(*) from public.clean_work('1.000')) = 50, 'clean_work no devuelve 50';
  assert pg_temp.in_work('c000'), 'clean_work no devuelve las hijas de XP con W vivo';
  perform pg_temp.as_postgres();
end;
$$;

-- Nada se borró: las filas de R siguen enteras.
do $$
begin
  assert pg_temp.rows_of('c1b0') = '1:AQ==,2:Ag==,3:Aw==,4:CQ==,5:Cg==', 'las filas de R cambiaron';
  assert (select schema_version from public.workspace_settings where id) >= 12, 'schema_version no es 12';
end;
$$;

rollback;
select 'ok' as result;
