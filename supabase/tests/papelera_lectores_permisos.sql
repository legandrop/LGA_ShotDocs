-- Pruebas de la papelera de páginas para quien solo ve (20261009120000_papelera_lectores.sql, D21): una página en la
-- papelera, y lo que cuelga de ella, no se ve con Ver ni con Comentar ni siendo invitado (título, contenido,
-- comentarios, archivos), por ningún camino; quien puede editar y no es invitado, y el dueño, sí. Restaurar devuelve
-- el acceso. Corre dentro de una transacción que se deshace al final: no deja usuarios ni datos. Si todo pasa,
-- devuelve una fila con result = 'ok'.

begin;

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
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

-- Páginas: R (raíz) › T (en la papelera) › T2; R › K (viva); S (raíz, en la papelera, compartida sola).
-- Ids: R …b2a0, T …b2a1, T2 …b2a2, K …b2a3, S …b2a4. Archivos: f1 (solo en T2), f2 (en T2 y en K).
create function pg_temp.visible_titles() returns text language sql as $$
  select coalesce(string_agg(title, ',' order by title), '') from public.pages
  where workspace_id = '00000000-0000-4000-8000-00000000b2e9';
$$;

-- Lo que NO tiene que ver quien no puede ver la papelera: ni T ni T2 ni S, por ningún camino.
create function pg_temp.expect_hidden(label text) returns void language plpgsql as $$
declare
  t  constant uuid := '00000000-0000-4000-8000-00000000b2a1';
  t2 constant uuid := '00000000-0000-4000-8000-00000000b2a2';
  s  constant uuid := '00000000-0000-4000-8000-00000000b2a4';
  f1 constant uuid := '00000000-0000-4000-8000-00000000b2f1';
begin
  assert (select count(*) from public.pages where id in (t, t2, s)) = 0, label || ': ve la fila de una página en la papelera';
  assert not private.can_view_page(t) and not private.can_view_page(t2) and not private.can_view_page(s),
    label || ': can_view_page da sí en la papelera';
  assert private.page_level(t2) = 0, label || ': nivel de T2 no es 0';
  perform pg_temp.expect_error(format('select * from public.pull_page_updates(%L, 0)', t2), 'page_not_found',
    label || ': baja el contenido de T2');
  perform pg_temp.expect_error(format('select * from public.pull_page_updates(%L, 0)', t), 'page_not_found',
    label || ': baja el contenido de T');
  perform pg_temp.expect_error(format('select * from public.pull_page_updates(%L, 0)', s), 'page_not_found',
    label || ': baja el contenido de S');
  assert (select count(*) from public.page_updates where page_id in (t, t2, s)) = 0, label || ': lee page_updates directo';
  perform pg_temp.expect_error(format('select * from public.list_comments(%L)', t2), 'page_not_found',
    label || ': lee los comentarios de T2');
  assert (select count(*) from public.comments where page_id = t2) = 0, label || ': lee la tabla de comentarios de T2';
  perform pg_temp.expect_error(format('select * from public.comment_authors(%L)', t2), 'page_not_found',
    label || ': lee los autores de los comentarios de T2');
  perform pg_temp.expect_error(
    format($q$select public.add_comment(gen_random_uuid(), %L, null, null, 'hola')$q$, t2), 'page_not_found',
    label || ': comenta en T2');
  assert private.file_level(f1) = 0, label || ': nivel del archivo de T2 no es 0';
  assert public.media_file(f1) is null, label || ': el portero le serviría el archivo de T2';
  assert (select count(*) from public.files where id = f1) = 0, label || ': ve la fila del archivo de T2';
  assert (select count(*) from public.page_files where page_id in (t, t2)) = 0, label || ': ve los usos de T2';
end;
$$;

-- Personas: a (creó el proyecto: 4), e (Editar), c (Comentar), v (Ver el proyecto), vp (Ver R), vs (Ver S), g
-- (invitado con Editar), gp (invitado con Editar y crear páginas) y d (admin con Editar).
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-00000000b2aa', 'tr-a@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000b2ee', 'tr-e@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000b2cc', 'tr-c@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000b2f0', 'tr-v@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000b2f2', 'tr-vp@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000b2f3', 'tr-vs@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000b2bb', 'tr-g@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000b2b2', 'tr-gp@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000b2dd', 'tr-d@test.invalid', 'authenticated', 'authenticated');
insert into public.members (user_id, role) values
  ('00000000-0000-4000-8000-00000000b2aa', 'member'),
  ('00000000-0000-4000-8000-00000000b2ee', 'member'),
  ('00000000-0000-4000-8000-00000000b2cc', 'member'),
  ('00000000-0000-4000-8000-00000000b2f0', 'member'),
  ('00000000-0000-4000-8000-00000000b2f2', 'member'),
  ('00000000-0000-4000-8000-00000000b2f3', 'member'),
  ('00000000-0000-4000-8000-00000000b2bb', 'guest'),
  ('00000000-0000-4000-8000-00000000b2b2', 'guest'),
  ('00000000-0000-4000-8000-00000000b2dd', 'admin');
insert into public.workspaces (id, owner_id, name) values
  ('00000000-0000-4000-8000-00000000b2e9', '00000000-0000-4000-8000-00000000b2aa', 'P');
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  ('00000000-0000-4000-8000-00000000b2a0', '00000000-0000-4000-8000-00000000b2e9', null, 'R', 'a0'),
  ('00000000-0000-4000-8000-00000000b2a1', '00000000-0000-4000-8000-00000000b2e9', '00000000-0000-4000-8000-00000000b2a0', 'T', 'a1'),
  ('00000000-0000-4000-8000-00000000b2a2', '00000000-0000-4000-8000-00000000b2e9', '00000000-0000-4000-8000-00000000b2a1', 'T2', 'a2'),
  ('00000000-0000-4000-8000-00000000b2a3', '00000000-0000-4000-8000-00000000b2e9', '00000000-0000-4000-8000-00000000b2a0', 'K', 'a3'),
  ('00000000-0000-4000-8000-00000000b2a4', '00000000-0000-4000-8000-00000000b2e9', null, 'S', 'a4');
insert into public.grants (user_id, project_id, page_id, level) values
  ('00000000-0000-4000-8000-00000000b2ee', '00000000-0000-4000-8000-00000000b2e9', null, 'edit'),
  ('00000000-0000-4000-8000-00000000b2cc', '00000000-0000-4000-8000-00000000b2e9', null, 'comment'),
  ('00000000-0000-4000-8000-00000000b2f0', '00000000-0000-4000-8000-00000000b2e9', null, 'view'),
  ('00000000-0000-4000-8000-00000000b2f2', null, '00000000-0000-4000-8000-00000000b2a0', 'view'),
  ('00000000-0000-4000-8000-00000000b2f3', null, '00000000-0000-4000-8000-00000000b2a4', 'view'),
  ('00000000-0000-4000-8000-00000000b2bb', '00000000-0000-4000-8000-00000000b2e9', null, 'edit'),
  ('00000000-0000-4000-8000-00000000b2b2', '00000000-0000-4000-8000-00000000b2e9', null, 'edit_pages'),
  ('00000000-0000-4000-8000-00000000b2dd', '00000000-0000-4000-8000-00000000b2e9', null, 'edit');

-- Contenido y comentarios de verdad, con la sesión de a (con la versión '9.999', para pasar cualquier mínima).
select pg_temp.as_user('00000000-0000-4000-8000-00000000b2aa');
select public.push_page_update('00000000-0000-4000-8000-00000000b2a1', '00000000-0000-4000-8000-00000000b201', 'AAA=', '9.999');
select public.push_page_update('00000000-0000-4000-8000-00000000b2a2', '00000000-0000-4000-8000-00000000b202', 'AAA=', '9.999');
select public.push_page_update('00000000-0000-4000-8000-00000000b2a3', '00000000-0000-4000-8000-00000000b203', 'AAA=', '9.999');
select public.push_page_update('00000000-0000-4000-8000-00000000b2a4', '00000000-0000-4000-8000-00000000b204', 'AAA=', '9.999');
select public.add_comment('00000000-0000-4000-8000-00000000b2c1', '00000000-0000-4000-8000-00000000b2a2', null, null, 'nota interna');
select public.add_comment('00000000-0000-4000-8000-00000000b2c2', '00000000-0000-4000-8000-00000000b2a3', null, null, 'nota de K');

select set_config('role', 'postgres', true);
insert into public.files (id, project_id, name, mime, size, created_by) values
  ('00000000-0000-4000-8000-00000000b2f1', '00000000-0000-4000-8000-00000000b2e9', 'interna.jpg', 'image/jpeg', 1, '00000000-0000-4000-8000-00000000b2aa'),
  ('00000000-0000-4000-8000-00000000b2f4', '00000000-0000-4000-8000-00000000b2e9', 'comun.jpg', 'image/jpeg', 1, '00000000-0000-4000-8000-00000000b2aa');
insert into public.page_files (page_id, file_id) values
  ('00000000-0000-4000-8000-00000000b2a2', '00000000-0000-4000-8000-00000000b2f1'),
  ('00000000-0000-4000-8000-00000000b2a2', '00000000-0000-4000-8000-00000000b2f4'),
  ('00000000-0000-4000-8000-00000000b2a3', '00000000-0000-4000-8000-00000000b2f4');

-- ---------------------------------------------------------------------------------------------------
-- Antes de la papelera: todos ven todo (lo de siempre)
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-00000000b2f0');
do $$
begin
  assert pg_temp.visible_titles() = 'K,R,S,T,T2', 'v antes: no ve todo (' || pg_temp.visible_titles() || ')';
  assert (select count(*) from public.list_comments('00000000-0000-4000-8000-00000000b2a2')) = 1, 'v antes: comentarios de T2';
  assert private.file_level('00000000-0000-4000-8000-00000000b2f1') = 1, 'v antes: archivo de T2';
end;
$$;

-- Manda T y S a la papelera, con la sesión de a (4), por la API como la app.
select pg_temp.as_user('00000000-0000-4000-8000-00000000b2aa');
update public.pages set deleted_at = now()
where id in ('00000000-0000-4000-8000-00000000b2a1', '00000000-0000-4000-8000-00000000b2a4');

-- ---------------------------------------------------------------------------------------------------
-- Ver (sobre el proyecto, sobre R, sobre S misma), Comentar e invitado con Editar: nada de la papelera
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-00000000b2f0');
select pg_temp.expect_hidden('Ver el proyecto');
do $$
begin
  assert pg_temp.visible_titles() = 'K,R', 'Ver el proyecto: ve ' || pg_temp.visible_titles();
  -- Lo vivo sigue igual: K, su contenido, su comentario y el archivo que comparte con T2.
  assert (select count(*) from public.pull_page_updates('00000000-0000-4000-8000-00000000b2a3', 0)) = 1, 'Ver: K sin contenido';
  assert (select count(*) from public.list_comments('00000000-0000-4000-8000-00000000b2a3')) = 1, 'Ver: K sin comentario';
  assert private.file_level('00000000-0000-4000-8000-00000000b2f4') = 1, 'Ver: el archivo de K';
  assert public.media_file('00000000-0000-4000-8000-00000000b2f4') is not null, 'Ver: el portero no sirve el archivo de K';
  -- El uso de T2 del archivo compartido no se ve (solo el de K).
  assert (select count(*) from public.page_files where file_id = '00000000-0000-4000-8000-00000000b2f4') = 1,
    'Ver: ve el uso de T2 del archivo compartido';
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-00000000b2f2');
select pg_temp.expect_hidden('Ver R');
do $$ begin assert pg_temp.visible_titles() = 'K,R', 'Ver R: ve ' || pg_temp.visible_titles(); end; $$;

select pg_temp.as_user('00000000-0000-4000-8000-00000000b2f3');
select pg_temp.expect_hidden('Ver S');
do $$ begin assert pg_temp.visible_titles() = '', 'Ver S: ve ' || pg_temp.visible_titles(); end; $$;

select pg_temp.as_user('00000000-0000-4000-8000-00000000b2cc');
select pg_temp.expect_hidden('Comentar');
do $$ begin assert pg_temp.visible_titles() = 'K,R', 'Comentar: ve ' || pg_temp.visible_titles(); end; $$;

select pg_temp.as_user('00000000-0000-4000-8000-00000000b2bb');
select pg_temp.expect_hidden('invitado con Editar');
select pg_temp.expect_error(
  $q$select public.push_page_update('00000000-0000-4000-8000-00000000b2a2', gen_random_uuid(), 'AAA=', '9.999')$q$,
  'page_not_found', 'invitado con Editar: escribe en T2');
do $$
begin
  update public.pages set title = 'robado' where id = '00000000-0000-4000-8000-00000000b2a2';
  assert not found, 'invitado con Editar: renombra T2';
  assert pg_temp.visible_titles() = 'K,R', 'invitado: ve ' || pg_temp.visible_titles();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Editar (no invitado), admin con Editar y el dueño: la ven (para la Papelera), como hoy
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-00000000b2ee');
do $$
begin
  assert pg_temp.visible_titles() = 'K,R,S,T,T2', 'Editar: no ve la papelera (' || pg_temp.visible_titles() || ')';
  assert private.page_level('00000000-0000-4000-8000-00000000b2a2') = 3, 'Editar: nivel de T2';
  assert (select count(*) from public.pull_page_updates('00000000-0000-4000-8000-00000000b2a2', 0)) = 1, 'Editar: contenido de T2';
  assert (select count(*) from public.list_comments('00000000-0000-4000-8000-00000000b2a2')) = 1, 'Editar: comentarios de T2';
  assert private.file_level('00000000-0000-4000-8000-00000000b2f1') = 3, 'Editar: archivo de T2';
  assert public.media_file('00000000-0000-4000-8000-00000000b2f1') is not null, 'Editar: el portero no le sirve el archivo de T2';
end;
$$;
-- Restaurar sigue pidiendo 4.
select pg_temp.expect_error(
  $q$update public.pages set deleted_at = null where id = '00000000-0000-4000-8000-00000000b2a1'$q$,
  'page_trash_denied', 'Editar: restaura T');

select pg_temp.as_user('00000000-0000-4000-8000-00000000b2dd');
do $$
begin
  assert pg_temp.visible_titles() = 'K,R,S,T,T2', 'admin con Editar: no ve la papelera';
  assert public.media_file('00000000-0000-4000-8000-00000000b2f1') is not null, 'admin: el portero no le sirve el archivo de T2';
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-00000000b2aa');
do $$
begin
  assert pg_temp.visible_titles() = 'K,R,S,T,T2', 'dueño: no ve la papelera';
  assert private.page_level('00000000-0000-4000-8000-00000000b2a2') = 4, 'dueño: nivel de T2';
  -- Crear adentro de una página de la papelera (como la app: on conflict do nothing) y verla.
  insert into public.pages (id, workspace_id, parent_id, title, sort_key)
  values ('00000000-0000-4000-8000-00000000b2a5', '00000000-0000-4000-8000-00000000b2e9',
          '00000000-0000-4000-8000-00000000b2a1', 'T3', 'a5')
  on conflict (id) do nothing;
  assert pg_temp.visible_titles() = 'K,R,S,T,T2,T3', 'dueño: no ve la que creó adentro de T';
end;
$$;

-- Editar solo sobre T2 (que cuelga de T, en la papelera): ve T2 y no T.
select set_config('role', 'postgres', true);
insert into public.grants (user_id, page_id, level) values
  ('00000000-0000-4000-8000-00000000b2f2', '00000000-0000-4000-8000-00000000b2a2', 'edit');
select pg_temp.as_user('00000000-0000-4000-8000-00000000b2f2');
do $$
begin
  assert pg_temp.visible_titles() = 'K,R,T2', 'Ver R y Editar T2: ve ' || pg_temp.visible_titles();
  assert (select count(*) from public.pull_page_updates('00000000-0000-4000-8000-00000000b2a2', 0)) = 1, 'Editar T2: sin contenido';
end;
$$;
select set_config('role', 'postgres', true);
update public.grants set revoked_at = now()
where user_id = '00000000-0000-4000-8000-00000000b2f2' and page_id = '00000000-0000-4000-8000-00000000b2a2';

-- Un invitado con crear que reintenta la creación de una página que ya existe y quedó en la papelera: no la ve ni la
-- pisa (on conflict do nothing sigue sin error sobre su propio proyecto, como en fase1).
select pg_temp.as_user('00000000-0000-4000-8000-00000000b2b2');
do $$
begin
  insert into public.pages (id, workspace_id, parent_id, title, sort_key)
  values ('00000000-0000-4000-8000-00000000b2a5', '00000000-0000-4000-8000-00000000b2e9', null, 'pisada', 'a9')
  on conflict (id) do nothing;
  assert (select count(*) from public.pages where id = '00000000-0000-4000-8000-00000000b2a5') = 0,
    'invitado con crear: ve T3 de la papelera';
end;
$$;
select set_config('role', 'postgres', true);
do $$
begin
  assert (select title from public.pages where id = '00000000-0000-4000-8000-00000000b2a5') = 'T3', 'T3 pisada';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Invitado con Editar y crear páginas: manda K a la papelera (puede) y deja de verla; no la puede restaurar
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-00000000b2b2');
select pg_temp.expect_hidden('invitado con Editar y crear');
do $$
begin
  assert pg_temp.visible_titles() = 'K,R', 'invitado con crear: ve ' || pg_temp.visible_titles();
  update public.pages set deleted_at = now() where id = '00000000-0000-4000-8000-00000000b2a3';
  assert found, 'invitado con crear: no pudo mandar K a la papelera';
  assert pg_temp.visible_titles() = 'R', 'invitado con crear: sigue viendo K en la papelera';
  update public.pages set deleted_at = null where id = '00000000-0000-4000-8000-00000000b2a3';
  assert not found, 'invitado con crear: restauró K sin verla';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Restaurar devuelve el acceso a todos
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-00000000b2aa');
update public.pages set deleted_at = null
where id in ('00000000-0000-4000-8000-00000000b2a1', '00000000-0000-4000-8000-00000000b2a3', '00000000-0000-4000-8000-00000000b2a4');

select pg_temp.as_user('00000000-0000-4000-8000-00000000b2f0');
do $$
begin
  assert pg_temp.visible_titles() = 'K,R,S,T,T2,T3', 'Ver después de restaurar: ve ' || pg_temp.visible_titles();
  assert (select count(*) from public.pull_page_updates('00000000-0000-4000-8000-00000000b2a2', 0)) = 1, 'Ver: T2 sin contenido';
  assert (select count(*) from public.list_comments('00000000-0000-4000-8000-00000000b2a2')) = 1, 'Ver: T2 sin comentarios';
  assert public.media_file('00000000-0000-4000-8000-00000000b2f1') is not null, 'Ver: el archivo de T2 no vuelve';
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-00000000b2bb');
do $$
begin
  assert pg_temp.visible_titles() = 'K,R,S,T,T2,T3', 'invitado después de restaurar: ve ' || pg_temp.visible_titles();
  perform public.push_page_update('00000000-0000-4000-8000-00000000b2a2', gen_random_uuid(), 'AAA=', '9.999');
end;
$$;

select pg_temp.as_user('00000000-0000-4000-8000-00000000b2cc');
select public.add_comment(gen_random_uuid(), '00000000-0000-4000-8000-00000000b2a2', null, null, 'de vuelta');

rollback;

select 'ok' as result;
