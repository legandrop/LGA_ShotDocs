-- Pruebas del link público, entrega 1 (20261012120000_link_publico.sql, Docs/Doc_Link_Publico.md, sección 6.1). El
-- visitante entra con el rol anon y el token en el header `x-shotdocs-link` (como manda supabase-js, con
-- `x-shotdocs-version` y `x-shotdocs-device`): ve la página del link y lo de abajo, nunca lo de arriba ni lo del
-- costado, ni la papelera, ni filas de `page_updates`, ni correos; comenta con nombre; todo cuenta contra los topes; el
-- link muere al revocarlo, vencer, resetearlo, mandar su raíz a la papelera o perder su creador el permiso de compartir
-- (sacarlo lo revoca para siempre). Crear un link pide `can_share` y el interruptor de D14 (D33). Corre dentro de una
-- transacción que se deshace al final: no deja usuarios ni datos. Si todo pasa, devuelve una fila con result = 'ok'.

begin;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-00000000' || s)::uuid;
$$;

create function pg_temp.as_user(s text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', pg_temp.u(s), 'role', 'authenticated')::text, true),
         set_config('request.headers', '{"x-shotdocs-version": "9.999"}', true);
$$;

-- El visitante: rol anon, sin sesión, con los headers que manda la app en modo link.
create function pg_temp.as_anon(tok text, dev text default 'devAAAAAAAAAAAAAAAAAAAA', ver text default '9.999')
returns void language sql as $$
  select set_config('role', 'anon', true),
         set_config('request.jwt.claims', '{"role": "anon"}', true),
         set_config('request.headers',
                    jsonb_strip_nulls(jsonb_build_object('x-shotdocs-link', tok, 'x-shotdocs-device', dev,
                                                         'x-shotdocs-version', ver))::text, true);
$$;

-- Como postgres pero con los headers del link (para mirar las funciones privadas).
create function pg_temp.as_postgres(tok text default null) returns void language sql as $$
  select set_config('role', 'postgres', true),
         set_config('request.jwt.claims', '', true),
         set_config('request.headers', coalesce(jsonb_build_object('x-shotdocs-link', tok)::text, ''), true);
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

-- `link_rate_limited` con el tope que se esperaba en `detail`.
create function pg_temp.expect_limit(stmt text, which text, what text) returns void language plpgsql as $$
declare
  d text;
begin
  begin
    execute stmt;
  exception when others then
    get stacked diagnostics d = pg_exception_detail;
    if sqlerrm = 'link_rate_limited' and d = which then
      return;
    end if;
    raise exception 'FALLA: % (dio % % / %)', what, sqlstate, sqlerrm, d;
  end;
  raise exception 'FALLA: % (no cortó)', what;
end;
$$;

create function pg_temp.expect_outdated(stmt text, what text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate = 'PGRST' and (sqlerrm::json ->> 'message') = 'app_outdated' then
      return;
    end if;
    raise exception 'FALLA: % (dio % %)', what, sqlstate, sqlerrm;
  end;
  raise exception 'FALLA: % (no rechazó)', what;
end;
$$;

-- Los tokens de la prueba, por nombre (como definer: el visitante no lee la tabla).
create temp table tk (name text primary key, id uuid, token text);
create function pg_temp.tok(n text) returns text language sql security definer as $$
  select token from pg_temp.tk where name = n;
$$;
create function pg_temp.save(n text, j jsonb) returns void language sql security definer as $$
  insert into pg_temp.tk values (n, (j ->> 'id')::uuid, j ->> 'token')
  on conflict (name) do update set id = excluded.id, token = excluded.token;
$$;

create function pg_temp.lid(n text) returns uuid language sql security definer as $$
  select id from pg_temp.tk where name = n;
$$;

-- El árbol que ve un token, por títulos ("error:<mensaje>" si no anda).
create function pg_temp.tree(tok text) returns text language plpgsql as $$
declare
  r text;
begin
  perform pg_temp.as_anon(tok);
  begin
    select string_agg(t.title, ',' order by t.title) into r from public.plink_tree() t;
  exception when others then
    r := 'error:' || sqlerrm;
  end;
  perform pg_temp.as_postgres();
  return r;
end;
$$;

-- El nivel del link sobre una página (función privada: como postgres con el header).
create function pg_temp.lvl(tok text, page text) returns int language plpgsql as $$
declare
  r int;
begin
  perform pg_temp.as_postgres(tok);
  r := private.plink_page_level(pg_temp.u(page));
  perform pg_temp.as_postgres();
  return r;
end;
$$;

-- Lo que cuenta un link hoy (n y bytes de un tipo).
create function pg_temp.used(p_name text, p_kind text) returns bigint language sql security definer as $$
  select coalesce((select u.n from public.public_link_usage u where u.link_id = (select tk.id from pg_temp.tk where tk.name = p_name)
                   and u.day = current_date and u.kind = p_kind), 0);
$$;
create function pg_temp.used_bytes(p_name text, p_kind text) returns bigint language sql security definer as $$
  select coalesce((select u.bytes from public.public_link_usage u where u.link_id = (select tk.id from pg_temp.tk where tk.name = p_name)
                   and u.day = current_date and u.kind = p_kind), 0);
$$;

create function pg_temp.limits(j text) returns void language sql security definer as $$
  update public.workspace_settings set link_limits = j::jsonb where id;
$$;

create function pg_temp.sha(b64 text) returns text language sql security definer as $$
  select encode(extensions.digest(decode(b64, 'base64'), 'sha256'), 'hex');
$$;
create function pg_temp.row_id(page text, s bigint) returns bigint language sql security definer as $$
  select u.id from public.page_updates u where u.page_id = pg_temp.u(page) and u.seq = s;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Datos
-- ---------------------------------------------------------------------------------------------------
-- Personas: o (dueña del workspace), a (miembro, creó P), ad (admin, Editar y crear P), ad2 (admin, para sacar a
-- otros), m4 (miembro con Editar y crear P: no es admin ni creó P), g (invitado con Editar y crear P), e (Editar P),
-- c (Comentar P), x (sin permiso).
update public.members set removed_at = now() where role = 'owner' and removed_at is null;
-- El interruptor de Can edit apagado (lo que supone esta prueba; la base puede tenerlo prendido): como link_editar_permisos.sql.
update public.workspace_settings set min_app_version = null, clean_min_version = null, link_edit_min_version = null, link_limits = '{}' where id;
insert into auth.users (id, email, aud, role) values
  (pg_temp.u('d1a0'), 'lp-o@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('d1a1'), 'lp-a@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('d1a2'), 'lp-ad@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('d1a3'), 'lp-ad2@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('d1a4'), 'lp-m4@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('d1a5'), 'lp-g@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('d1a6'), 'lp-e@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('d1a7'), 'lp-c@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('d1a8'), 'lp-x@test.invalid', 'authenticated', 'authenticated');
insert into public.members (user_id, role) values
  (pg_temp.u('d1a0'), 'owner'), (pg_temp.u('d1a1'), 'member'), (pg_temp.u('d1a2'), 'admin'),
  (pg_temp.u('d1a3'), 'admin'), (pg_temp.u('d1a4'), 'member'), (pg_temp.u('d1a5'), 'guest'),
  (pg_temp.u('d1a6'), 'member'), (pg_temp.u('d1a7'), 'member'), (pg_temp.u('d1a8'), 'member');
insert into public.workspaces (id, owner_id, name) values
  (pg_temp.u('d1e0'), pg_temp.u('d1a1'), 'P secreto'),
  (pg_temp.u('d1e1'), pg_temp.u('d1a0'), 'Q');
-- P: R › A › S (la del link) › H › N; S › T (papelera) › TT; A › Sib; R2 (otra raíz). Q: QX.
insert into public.pages (id, workspace_id, parent_id, title, sort_key, settings) values
  (pg_temp.u('d1b0'), pg_temp.u('d1e0'), null, 'R', 'a0', '{}'),
  (pg_temp.u('d1b1'), pg_temp.u('d1e0'), pg_temp.u('d1b0'), 'A', 'a0', '{"format": {"size": "A4"}}'),
  (pg_temp.u('d1b2'), pg_temp.u('d1e0'), pg_temp.u('d1b1'), 'S', 'a0', '{"split": true}'),
  (pg_temp.u('d1b3'), pg_temp.u('d1e0'), pg_temp.u('d1b2'), 'H', 'a0', '{}'),
  (pg_temp.u('d1b4'), pg_temp.u('d1e0'), pg_temp.u('d1b3'), 'N', 'a0', '{}'),
  (pg_temp.u('d1b5'), pg_temp.u('d1e0'), pg_temp.u('d1b2'), 'T', 'a1', '{}'),
  (pg_temp.u('d1b6'), pg_temp.u('d1e0'), pg_temp.u('d1b5'), 'TT', 'a0', '{}'),
  (pg_temp.u('d1b7'), pg_temp.u('d1e0'), pg_temp.u('d1b1'), 'Sib', 'a1', '{}'),
  (pg_temp.u('d1b8'), pg_temp.u('d1e0'), null, 'R2', 'a1', '{}'),
  (pg_temp.u('d1b9'), pg_temp.u('d1e1'), null, 'QX', 'a0', '{}'),
  (pg_temp.u('d1ba'), pg_temp.u('d1e0'), null, 'Z', 'a2', '{}');
-- T y Z (otra raíz de P) en la papelera.
update public.pages set deleted_at = now() where id in (pg_temp.u('d1b5'), pg_temp.u('d1ba'));
insert into public.grants (user_id, project_id, page_id, level) values
  (pg_temp.u('d1a2'), pg_temp.u('d1e0'), null, 'edit_pages'),
  (pg_temp.u('d1a3'), pg_temp.u('d1e0'), null, 'edit_pages'),
  (pg_temp.u('d1a4'), pg_temp.u('d1e0'), null, 'edit_pages'),
  (pg_temp.u('d1a5'), pg_temp.u('d1e0'), null, 'edit_pages'),
  (pg_temp.u('d1a6'), pg_temp.u('d1e0'), null, 'edit'),
  (pg_temp.u('d1a7'), pg_temp.u('d1e0'), null, 'comment');

-- Contenido: S tiene 2 filas (la 2 "borra" lo de la 1), H una.
select pg_temp.as_user('d1a1');
select public.push_page_update(pg_temp.u('d1b2'), pg_temp.u('d101'), 'U0VDUkVUTw==', '9.999');
select public.push_page_update(pg_temp.u('d1b2'), pg_temp.u('d102'), 'Ag==', '9.999');
select public.push_page_update(pg_temp.u('d1b3'), pg_temp.u('d103'), 'Aw==', '9.999');

-- Archivos de P: f1 usado en S, f2 sacado de S, f3 usado en A (arriba), f5 usado en T (papelera). f4 es de Q y está
-- pegado en H (uso ajeno, no da permiso).
select pg_temp.as_postgres();
insert into public.files (id, project_id, name, mime, size, created_by) values
  (pg_temp.u('d1f1'), pg_temp.u('d1e0'), 'activo.jpg', 'image/jpeg', 10, pg_temp.u('d1a1')),
  (pg_temp.u('d1f2'), pg_temp.u('d1e0'), 'sacado.jpg', 'image/jpeg', 10, pg_temp.u('d1a1')),
  (pg_temp.u('d1f3'), pg_temp.u('d1e0'), 'arriba.jpg', 'image/jpeg', 10, pg_temp.u('d1a1')),
  (pg_temp.u('d1f4'), pg_temp.u('d1e1'), 'ajeno.jpg', 'image/jpeg', 10, pg_temp.u('d1a0')),
  (pg_temp.u('d1f5'), pg_temp.u('d1e0'), 'papelera.jpg', 'image/jpeg', 10, pg_temp.u('d1a1'));
insert into public.page_files (page_id, file_id, removed_at, is_foreign) values
  (pg_temp.u('d1b2'), pg_temp.u('d1f1'), null, false),
  (pg_temp.u('d1b2'), pg_temp.u('d1f2'), now(), false),
  (pg_temp.u('d1b1'), pg_temp.u('d1f3'), null, false),
  (pg_temp.u('d1b3'), pg_temp.u('d1f4'), null, true),
  (pg_temp.u('d1b5'), pg_temp.u('d1f5'), null, false);
insert into storage.objects (bucket_id, name) values
  ('thumbs', pg_temp.u('d1f1') || '.jpg'), ('thumbs', pg_temp.u('d1f2') || '.jpg'),
  ('thumbs', pg_temp.u('d1f3') || '.jpg'), ('thumbs', pg_temp.u('d1f4') || '.jpg'),
  ('thumbs', pg_temp.u('d1f5') || '.jpg');

-- ---------------------------------------------------------------------------------------------------
-- Crear: D33 (sin el interruptor no se crea), can_share, papelera, nivel, vencimiento
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.as_user('d1a1');
  perform pg_temp.expect_error(format('select public.create_public_link(%L, %L, %L)', pg_temp.u('d1c0'), pg_temp.u('d1b2'), 'comment'),
    'clean_off', 'crea un link con el interruptor apagado');
  assert public.get_public_link(pg_temp.u('d1b2')) ->> 'clean_on' = 'false', 'Share no sabe que está apagado';
  perform pg_temp.as_postgres();
  update public.workspace_settings set min_app_version = 0.5, clean_min_version = 0.5 where id;

  -- Quién no puede: sin permiso, con Editar, miembro común con 4, invitado con 4, con Comentar.
  perform pg_temp.as_user('d1a8');
  perform pg_temp.expect_error(format('select public.create_public_link(%L, %L, %L)', pg_temp.u('d1c0'), pg_temp.u('d1b2'), 'comment'),
    'page_not_found', 'x crea un link');
  perform pg_temp.as_user('d1a6');
  perform pg_temp.expect_error(format('select public.create_public_link(%L, %L, %L)', pg_temp.u('d1c0'), pg_temp.u('d1b2'), 'comment'),
    'not_allowed', 'Editar crea un link');
  perform pg_temp.as_user('d1a4');
  perform pg_temp.expect_error(format('select public.create_public_link(%L, %L, %L)', pg_temp.u('d1c0'), pg_temp.u('d1b2'), 'comment'),
    'not_allowed', 'un miembro común con 4 (no admin ni dueño del proyecto) crea un link');
  assert public.get_public_link(pg_temp.u('d1b2')) is null, 'm4 ve el link en Share';
  perform pg_temp.as_user('d1a5');
  perform pg_temp.expect_error(format('select public.create_public_link(%L, %L, %L)', pg_temp.u('d1c0'), pg_temp.u('d1b2'), 'comment'),
    'not_allowed', 'un invitado crea un link');
  perform pg_temp.as_user('d1a7');
  perform pg_temp.expect_error(format('select public.create_public_link(%L, %L, %L)', pg_temp.u('d1c0'), pg_temp.u('d1b2'), 'comment'),
    'not_allowed', 'Comentar crea un link');

  -- El dueño del proyecto: no en la papelera, no 'edit' con el interruptor de Can edit apagado (entrega 2a:
  -- `edit_off`; antes, `level_invalid`), no vencido.
  perform pg_temp.as_user('d1a1');
  perform pg_temp.expect_error(format('select public.create_public_link(%L, %L, %L)', pg_temp.u('d1c0'), pg_temp.u('d1b5'), 'comment'),
    'page_in_trash', 'crea un link en la papelera');
  perform pg_temp.expect_error(format('select public.create_public_link(%L, %L, %L)', pg_temp.u('d1c0'), pg_temp.u('d1b2'), 'edit'),
    'edit_off', 'crea un Can edit con el interruptor apagado');
  perform pg_temp.expect_error(format('select public.create_public_link(%L, %L, %L, now() - interval %L)', pg_temp.u('d1c0'), pg_temp.u('d1b2'), 'comment', '1 hour'),
    'link_invalid', 'crea un link vencido');
  -- Con la app vieja para el workspace: no.
  perform set_config('request.headers', '{"x-shotdocs-version": "0.001"}', true);
  perform pg_temp.expect_outdated(format('select public.create_public_link(%L, %L, %L)', pg_temp.u('d1c0'), pg_temp.u('d1b2'), 'comment'),
    'crea un link con la app vieja');
  perform pg_temp.as_user('d1a1');

  perform pg_temp.save('S', public.create_public_link(pg_temp.u('d1c0'), pg_temp.u('d1b2'), 'comment'));
  assert pg_temp.tok('S') ~ '^sdl_[A-Za-z0-9_-]{43}$', 'el token no tiene la forma';
  -- Uno vivo por página: otro pedido (otro id) devuelve el mismo.
  assert public.create_public_link(pg_temp.u('d1c9'), pg_temp.u('d1b2'), 'comment') ->> 'token' = pg_temp.tok('S'),
    'crea un segundo link vivo en la misma página';
  -- Get: el token a quien comparte; el admin también lo ve.
  assert public.get_public_link(pg_temp.u('d1b2')) -> 'link' ->> 'token' = pg_temp.tok('S'), 'get no da el token';
  perform pg_temp.as_user('d1a2');
  assert public.get_public_link(pg_temp.u('d1b2')) -> 'link' ->> 'token' = pg_temp.tok('S'), 'el admin no ve el link';
  -- Otro link en la hija, del admin: independiente. La hija ve el de arriba (sin token).
  perform pg_temp.save('H', public.create_public_link(pg_temp.u('d1c1'), pg_temp.u('d1b3'), 'comment'));
  assert public.get_public_link(pg_temp.u('d1b4')) -> 'above' ->> 'page_id' = pg_temp.u('d1b3')::text, 'la nieta no ve el link de arriba';
  assert public.get_public_link(pg_temp.u('d1b4')) -> 'link' = 'null'::jsonb, 'la nieta tiene link propio';
  assert (public.get_public_link(pg_temp.u('d1b4')) -> 'above') ? 'token' = false, 'el de arriba trae el token';
  assert (select count(*) from public.public_link_pages() p where p.page_id in (pg_temp.u('d1b2'), pg_temp.u('d1b3'))) = 2,
    'public_link_pages no da las dos';
  perform pg_temp.as_postgres();
  -- Crear reinicia la base de la rama (como compartir).
  assert (select clean_reset_seq from public.pages where id = pg_temp.u('d1b2')) = 2, 'crear no reinicia S';
  assert (select clean_reset_seq from public.pages where id = pg_temp.u('d1b3')) = 1, 'crear no reinicia H';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- El nivel: la página y lo de abajo, nunca arriba, al costado, la papelera ni otro proyecto
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  p text;
  w int;
begin
  foreach p in array array['d1b2:2', 'd1b3:2', 'd1b4:2', 'd1b1:0', 'd1b0:0', 'd1b7:0', 'd1b5:0', 'd1b6:0', 'd1b8:0', 'd1b9:0'] loop
    w := split_part(p, ':', 2)::int;
    assert pg_temp.lvl(pg_temp.tok('S'), split_part(p, ':', 1)) = w, format('nivel de S sobre %s', p);
  end loop;
  assert pg_temp.lvl(pg_temp.tok('H'), 'd1b2') = 0, 'el link de la hija ve la madre';
  assert pg_temp.lvl(pg_temp.tok('H'), 'd1b4') = 2, 'el link de la hija no ve la nieta';
  assert pg_temp.tree(pg_temp.tok('S')) = 'H,N,S', 'el árbol de S';
  assert pg_temp.tree(pg_temp.tok('H')) = 'H,N', 'el árbol de H';
end;
$$;

-- Tokens que no sirven: todos dan lo mismo.
do $$
declare
  t text;
begin
  foreach t in array array[null, 'sdl_' || repeat('A', 43), 'sdl_corto', ' ' || pg_temp.tok('S'), upper(pg_temp.tok('S')),
                           pg_temp.tok('S') || ' ', 'Bearer ' || pg_temp.tok('S')] loop
    if upper(coalesce(t, '')) = pg_temp.tok('S') then
      continue;   -- (si el token fuera todo mayúsculas, el caso no prueba nada)
    end if;
    assert pg_temp.tree(t) = 'error:link_not_found', format('el token %s abre algo', coalesce(left(t, 12), 'null'));
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- anon: ninguna tabla, ninguna función de siempre, de private solo las dos de la política
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  t text;
begin
  perform pg_temp.as_anon(pg_temp.tok('S'));
  foreach t in array array['public.pages', 'public.page_updates', 'public.comments', 'public.comments_view', 'public.files',
                           'public.page_files', 'public.public_links', 'public.public_link_usage', 'public.public_link_usage_all',
                           'public.workspace_settings', 'public.page_clean_bases', 'public.grants', 'public.members',
                           'public.workspaces', 'private.db_guard'] loop
    perform pg_temp.expect_error(format('select count(*) from %s', t), '42501', 'anon lee ' || t);
  end loop;
  foreach t in array array[
    format('select * from public.pull_page_updates(%L, 0)', pg_temp.u('d1b2')),
    format('select * from public.list_comments(%L)', pg_temp.u('d1b2')),
    format('select public.media_file(%L)', pg_temp.u('d1f1')),
    format('select public.share(%L, null, %L, %L)', pg_temp.u('d1a8'), pg_temp.u('d1b2'), 'view'),
    format('select public.create_public_link(%L, %L, %L)', pg_temp.u('d1c8'), pg_temp.u('d1b2'), 'comment'),
    format('select public.get_public_link(%L)', pg_temp.u('d1b2')),
    format('select public.add_comment(%L, %L, null, null, %L)', pg_temp.u('d1c8'), pg_temp.u('d1b2'), 'hola'),
    format('select public.resolve_thread(%L, true)', pg_temp.u('d1c8')),
    format('select private.plink_page_level(%L)', pg_temp.u('d1b2')),
    'select private.current_plink()', 'select private.plink_count(''open'')', 'select private.db_bytes()',
    format('select private.user_can_share_page(%L, %L)', pg_temp.u('d1b2'), pg_temp.u('d1a1'))] loop
    perform pg_temp.expect_error(t, '42501', 'anon corre ' || left(t, 60));
  end loop;
  perform pg_temp.as_postgres();
  -- Lo que anon puede ejecutar en public y private: exactamente esto (`private.mcp_pre_request` es el pre-request de
  -- PostgREST, que corre en todo pedido, 20261027120000_mcp_plan_b.sql; las dos de escribir, de la entrega 2a).
  assert (select string_agg(n.nspname || '.' || p.proname, ',' order by n.nspname, p.proname)
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute'))
       = 'private.mcp_pre_request,private.plink_thumbs,private.plink_token,public.plink_add_comment,public.plink_delete_comment,public.plink_edit_comment,public.plink_list_comments,public.plink_media_file,public.plink_media_files,public.plink_open,public.plink_pull_page,public.plink_push_page_update,public.plink_push_status,public.plink_tree',
    'anon ejecuta otras funciones';
  -- Y ninguna de las del visitante para una cuenta (authenticated).
  assert not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname like 'plink\_%' and has_function_privilege('authenticated', p.oid, 'execute')),
    'authenticated ejecuta plink_*';
  -- Todas cuentan, así que todas son VOLATILE (PostgREST corre las STABLE en solo lectura y contar fallaría).
  assert (select string_agg(p.proname || ':' || p.provolatile::text, ',' order by p.proname)
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname like 'plink\_%')
       = 'plink_add_comment:v,plink_delete_comment:v,plink_edit_comment:v,plink_list_comments:v,plink_media_file:v,plink_media_files:v,plink_open:v,plink_pull_page:v,plink_push_page_update:v,plink_push_status:v,plink_tree:v',
    'volatilidad de plink_*';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- plink_open y plink_tree: lo que devuelven y nada más
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  j   json;
  r   record;
  sig text;
  n   bigint;
begin
  perform pg_temp.as_anon(pg_temp.tok('S'));
  j := public.plink_open('9.999');
  assert j ->> 'page_id' = pg_temp.u('d1b2')::text and j ->> 'level' = 'comment' and j ->> 'clean_on' = 'true', 'plink_open';
  assert j::text !~ 'P secreto' and j::text !~ '@' and j::text !~ pg_temp.u('d1e0')::text, 'plink_open dice el proyecto o un correo';
  assert (public.plink_open('0.001') ->> 'outdated') = 'true', 'plink_open no avisa la versión vieja';
  -- Las columnas, exactamente estas.
  perform pg_temp.as_postgres();
  assert pg_get_function_result('public.plink_tree(text)'::regprocedure)
       = 'TABLE(id uuid, workspace_id uuid, parent_id uuid, title text, icon text, sort_key text, settings jsonb, update_seq bigint, clean_seq bigint, created_at timestamp with time zone, updated_at timestamp with time zone, sig text)',
    'columnas de plink_tree';
  perform pg_temp.as_anon(pg_temp.tok('S'));
  for r in select * from public.plink_tree() loop
    assert r.workspace_id = pg_temp.lid('S'), 'el árbol trae el id del proyecto';
    assert (r.parent_id is null) = (r.id = pg_temp.u('d1b2')), 'la raíz trae padre (o una hija no)';
    assert r.settings - 'format' - 'header' = '{}'::jsonb, 'el árbol trae otros ajustes';
    if r.id = pg_temp.u('d1b2') then
      assert r.settings -> 'format' ->> 'size' = 'A4', 'la raíz no trae el formato que hereda';
      assert r.update_seq = 1 and r.clean_seq = 0, 'update_seq de la raíz sin base';
    end if;
    sig := r.sig;
  end loop;
  -- Sin cambios: nada y no cuenta.
  n := pg_temp.used('S', 'pull');
  assert (select count(*) from public.plink_tree(sig)) = 0, 'el árbol sin cambios vuelve';
  assert pg_temp.used('S', 'pull') = n, 'el árbol sin cambios cuenta';
  assert (select count(*) from public.plink_tree('otra')) = 3 and pg_temp.used('S', 'pull') = n + 1, 'el árbol que cambió no cuenta';
  perform pg_temp.as_postgres();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- plink_pull_page: solo la base limpia, nunca filas; contada; nada con el interruptor apagado
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  base text := 'QkFTRS1MSU1QSUE=';
  got  text;
  n    bigint;
begin
  perform pg_temp.as_anon(pg_temp.tok('S'));
  assert (select count(*) from public.plink_pull_page(pg_temp.u('d1b2'), 0)) = 0, 'sin base devuelve algo';
  perform pg_temp.expect_error(format('select * from public.plink_pull_page(%L, 0)', pg_temp.u('d1b1')), 'page_not_found', 'baja la de arriba');
  perform pg_temp.expect_error(format('select * from public.plink_pull_page(%L, 0)', pg_temp.u('d1b9')), 'page_not_found', 'baja otro proyecto');
  perform pg_temp.as_anon(null);
  perform pg_temp.expect_error(format('select * from public.plink_pull_page(%L, 0)', pg_temp.u('d1b2')), 'link_not_found', 'baja sin token');
  -- La dueña del proyecto arma la base de S (hasta la fila 2).
  perform pg_temp.as_user('d1a1');
  assert public.push_clean_base(pg_temp.u('d1d0'), pg_temp.u('d1b2'), 2, pg_temp.row_id('d1b2', 2), base, pg_temp.sha(base), '1.000') = 'ok',
    'no se arma la base';
  perform pg_temp.as_anon(pg_temp.tok('S'));
  n := pg_temp.used_bytes('S', 'pull');
  select string_agg(p.seq || ':' || p.update, ',') into got from public.plink_pull_page(pg_temp.u('d1b2'), 0) p;
  assert got = '2:' || base, format('no baja la base (dio %s)', got);
  assert got !~ 'U0VDUkVUTw', 'baja una fila de page_updates';
  assert pg_temp.used_bytes('S', 'pull') = n + 11, 'no cuenta los bytes de la base';
  -- Al día: nada y no cuenta.
  assert (select count(*) from public.plink_pull_page(pg_temp.u('d1b2'), 2)) = 0, 'al día devuelve algo';
  assert pg_temp.used_bytes('S', 'pull') = n + 11, 'al día cuenta';
  -- La hija (sin base) nunca da filas.
  assert (select count(*) from public.plink_pull_page(pg_temp.u('d1b3'), 0)) = 0, 'H sin base da filas';
  -- El árbol ahora dice clean_seq 2.
  assert (select t.clean_seq || '/' || t.update_seq from public.plink_tree() t where t.id = pg_temp.u('d1b2')) = '2/2', 'clean_seq en el árbol';
  -- Con el interruptor apagado (lo apagan después de crear el link): nada, aunque haya base.
  perform pg_temp.as_postgres();
  update public.workspace_settings set clean_min_version = null where id;
  perform pg_temp.as_anon(pg_temp.tok('S'));
  assert (select count(*) from public.plink_pull_page(pg_temp.u('d1b2'), 0)) = 0, 'con el interruptor apagado baja algo';
  perform pg_temp.as_postgres();
  update public.workspace_settings set clean_min_version = 0.5 where id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Mover y papelera
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.as_postgres();
  update public.pages set parent_id = pg_temp.u('d1b2') where id = pg_temp.u('d1b7');
  assert pg_temp.lvl(pg_temp.tok('S'), 'd1b7') = 2, 'Sib movida adentro no se ve';
  update public.pages set parent_id = pg_temp.u('d1b1') where id = pg_temp.u('d1b7');
  assert pg_temp.lvl(pg_temp.tok('S'), 'd1b7') = 0, 'Sib movida afuera se ve';
  -- La raíz del link bajo otra página viva: sigue, y la nueva de arriba no se ve.
  update public.pages set parent_id = pg_temp.u('d1b8') where id = pg_temp.u('d1b2');
  assert pg_temp.tree(pg_temp.tok('S')) = 'H,N,S', 'la raíz movida bajo otra no anda';
  assert pg_temp.lvl(pg_temp.tok('S'), 'd1b8') = 0, 'la nueva de arriba se ve';
  -- Bajo una de la papelera: muere; de vuelta: vuelve.
  update public.pages set parent_id = pg_temp.u('d1ba') where id = pg_temp.u('d1b2');
  assert pg_temp.tree(pg_temp.tok('S')) = 'error:link_not_found', 'la raíz bajo la papelera anda';
  update public.pages set parent_id = pg_temp.u('d1b1') where id = pg_temp.u('d1b2');
  assert pg_temp.tree(pg_temp.tok('S')) = 'H,N,S', 'la raíz devuelta no anda';
  -- Una de arriba en la papelera: muere.
  update public.pages set deleted_at = now() where id = pg_temp.u('d1b1');
  assert pg_temp.tree(pg_temp.tok('S')) = 'error:link_not_found', 'con la de arriba en la papelera anda';
  update public.pages set deleted_at = null where id = pg_temp.u('d1b1');
  -- Una hija en la papelera: sale del árbol (y sus hijas).
  update public.pages set deleted_at = now() where id = pg_temp.u('d1b3');
  assert pg_temp.tree(pg_temp.tok('S')) = 'S', 'la hija en la papelera sigue en el árbol';
  assert pg_temp.lvl(pg_temp.tok('S'), 'd1b4') = 0, 'la nieta bajo la papelera se ve';
  update public.pages set deleted_at = null where id = pg_temp.u('d1b3');
  -- El proyecto borrado: muere.
  update public.workspaces set deleted_at = now() where id = pg_temp.u('d1e0');
  assert pg_temp.tree(pg_temp.tok('S')) = 'error:link_not_found', 'con el proyecto borrado anda';
  update public.workspaces set deleted_at = null where id = pg_temp.u('d1e0');
  assert pg_temp.tree(pg_temp.tok('S')) = 'H,N,S', 'no volvió';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Archivos: el pase del portero y la política de thumbs
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  j json;
  n bigint;
  b bigint;
begin
  perform pg_temp.as_anon(pg_temp.tok('S'));
  n := pg_temp.used('S', 'pass');
  j := public.plink_media_file(pg_temp.u('d1f1'));
  assert j ->> 'level' = '2' and j ->> 'project_id' = pg_temp.lid('S')::text, 'el pase de f1';
  assert j::text !~ 'P secreto' and j ->> 'created_by' is null, 'el pase dice el proyecto o quién lo subió';
  assert pg_temp.used('S', 'pass') = n + 1, 'el pase no cuenta';
  assert public.plink_media_file(pg_temp.u('d1f2')) is null, 'pase de una foto sacada';
  assert public.plink_media_file(pg_temp.u('d1f3')) is null, 'pase de una foto de arriba';
  assert public.plink_media_file(pg_temp.u('d1f4')) is null, 'pase de una foto ajena (is_foreign)';
  assert public.plink_media_file(pg_temp.u('d1f5')) is null, 'pase de una foto de la papelera';
  assert pg_temp.used('S', 'pass') = n + 1, 'los pases negados cuentan';
  assert (select string_agg(f.name, ',') from public.plink_media_files(array[pg_temp.u('d1f1'), pg_temp.u('d1f2'), pg_temp.u('d1f3'), pg_temp.u('d1f4'), pg_temp.u('d1f5')]) f) = 'activo.jpg',
    'plink_media_files da otros archivos';
  -- Cuenta como una bajada (los topes y el contador de Share la ven): una vez y los bytes de lo devuelto, también si
  -- no devuelve nada; sin token, no.
  n := pg_temp.used('S', 'pull');
  b := pg_temp.used_bytes('S', 'pull');
  perform public.plink_media_files(array[pg_temp.u('d1f1')]);
  assert pg_temp.used('S', 'pull') = n + 1 and pg_temp.used_bytes('S', 'pull') > b + 50, 'plink_media_files no cuenta';
  perform public.plink_media_files(array[pg_temp.u('d1f3')]);
  assert pg_temp.used('S', 'pull') = n + 2, 'plink_media_files sin resultados no cuenta';
  perform pg_temp.as_anon(null);
  perform pg_temp.expect_error(format('select * from public.plink_media_files(array[%L::uuid])', pg_temp.u('d1f1')),
    'link_not_found', 'plink_media_files sin token');
  perform pg_temp.as_anon(pg_temp.tok('S'));
  perform pg_temp.expect_error(format('select * from public.plink_media_files(array_fill(%L::uuid, array[201]))', pg_temp.u('d1f1')),
    'too_many_files', 'plink_media_files con 201 ids');
  -- La política de thumbs: con el link, solo f1; sin header, nada; con otro token, nada.
  assert (select string_agg(o.name, ',') from storage.objects o where o.bucket_id = 'thumbs' and o.name like '00000000-0000-4000-8000-00000000d1f%')
       = pg_temp.u('d1f1') || '.jpg', 'thumbs con el link';
  perform pg_temp.as_anon(null);
  assert (select count(*) from storage.objects o where o.bucket_id = 'thumbs') = 0, 'thumbs sin header';
  perform pg_temp.as_anon('sdl_' || repeat('B', 43));
  assert (select count(*) from storage.objects o where o.bucket_id = 'thumbs') = 0, 'thumbs con un token al azar';
  perform pg_temp.as_anon(pg_temp.tok('H'));
  assert (select count(*) from storage.objects o where o.bucket_id = 'thumbs' and o.name = pg_temp.u('d1f1') || '.jpg') = 0,
    'thumbs: el link de la hija lee la de la madre';
  -- anon no sube ni borra miniaturas.
  perform pg_temp.as_anon(pg_temp.tok('S'));
  perform pg_temp.expect_error(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'thumbs', pg_temp.u('d1f1') || 'x.jpg'),
    '42501', 'anon sube una miniatura');
  -- (Storage además frena el borrado directo; con o sin ese freno, la política no deja.)
  begin
    delete from storage.objects o where o.bucket_id = 'thumbs' and o.name = pg_temp.u('d1f1') || '.jpg';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.as_postgres();
  assert exists (select 1 from storage.objects o where o.name = pg_temp.u('d1f1') || '.jpg'), 'anon borró una miniatura';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Comentarios: con nombre, sin resolver, los propios por dispositivo, ningún correo
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_postgres();
insert into public.comments (id, page_id, body, imported_from, imported_author, imported_author_email)
values (pg_temp.u('d1cf'), pg_temp.u('d1b2'), 'importado', 'coda', 'Pepe Coda', 'pepe@coda.invalid');
select pg_temp.as_user('d1a1');
select public.add_comment(pg_temp.u('d1ce'), pg_temp.u('d1b2'), null, null, 'del equipo');

do $$
declare
  j  jsonb;
  d1 text := 'dev1AAAAAAAAAAAAAAAAAAAA';
  d2 text := 'dev2BBBBBBBBBBBBBBBBBBBB';
begin
  perform pg_temp.as_anon(pg_temp.tok('S'), d1);
  perform public.plink_add_comment(pg_temp.u('d1c2'), pg_temp.u('d1b2'), null, null, 'hola', 'Ana');
  -- Idempotente.
  perform public.plink_add_comment(pg_temp.u('d1c2'), pg_temp.u('d1b2'), null, null, 'hola', 'Ana');
  perform public.plink_add_comment(pg_temp.u('d1c3'), pg_temp.u('d1b2'), null, pg_temp.u('d1c2'), 'respuesta', 'Ana');
  perform public.plink_add_comment(pg_temp.u('d1c4'), pg_temp.u('d1b3'), null, null, 'en la hija', 'Ana');
  perform pg_temp.expect_error(format('select public.plink_add_comment(%L, %L, null, null, %L, %L)', pg_temp.u('d1c5'), pg_temp.u('d1b1'), 'x', 'Ana'),
    'page_not_found', 'comenta arriba');
  perform pg_temp.expect_error(format('select public.plink_add_comment(%L, %L, null, null, %L, %L)', pg_temp.u('d1c5'), pg_temp.u('d1b2'), 'x', '   '),
    'author_invalid', 'comenta sin nombre');
  perform pg_temp.expect_error(format('select public.plink_add_comment(%L, %L, null, null, %L, %L)', pg_temp.u('d1c5'), pg_temp.u('d1b2'), 'x', repeat('n', 61)),
    'author_invalid', 'comenta con un nombre de 61');
  perform pg_temp.expect_error(format('select public.plink_add_comment(%L, %L, null, null, %L, %L)', pg_temp.u('d1c5'), pg_temp.u('d1b2'), 'x', 'Ana' || chr(8238) || 'knil'),
    'author_invalid', 'comenta con una marca de dirección');
  perform pg_temp.expect_error(format('select public.plink_add_comment(%L, %L, null, null, %L, %L)', pg_temp.u('d1c5'), pg_temp.u('d1b2'), 'x', 'Ana' || chr(10)),
    'author_invalid', 'comenta con un salto de línea en el nombre');
  -- Las mismas marcas que limpia el portero: dirección árabe (U+061C) y los separadores de línea y de párrafo.
  perform pg_temp.expect_error(format('select public.plink_add_comment(%L, %L, null, null, %L, %L)', pg_temp.u('d1c5'), pg_temp.u('d1b2'), 'x', 'Ana' || chr(1564)),
    'author_invalid', 'comenta con U+061C en el nombre');
  perform pg_temp.expect_error(format('select public.plink_add_comment(%L, %L, null, null, %L, %L)', pg_temp.u('d1c5'), pg_temp.u('d1b2'), 'x', 'Ana' || chr(8232) || 'Z'),
    'author_invalid', 'comenta con U+2028 en el nombre');
  perform pg_temp.expect_error(format('select public.plink_add_comment(%L, %L, null, null, %L, %L)', pg_temp.u('d1c5'), pg_temp.u('d1b2'), 'x', 'Ana' || chr(8233) || 'Z'),
    'author_invalid', 'comenta con U+2029 en el nombre');
  -- Lo que ve: nombres, ningún correo, ningún id de persona.
  select jsonb_agg(to_jsonb(c)) into j from public.plink_list_comments(pg_temp.u('d1b2')) c;
  assert j::text !~ '@', 'plink_list_comments trae un correo';
  assert j::text !~ pg_temp.u('d1a1')::text, 'plink_list_comments trae un id de persona';
  assert (select string_agg(x ->> 'author_name' || '/' || (x ->> 'author_kind') || '/' || (x ->> 'mine'), ',' order by x ->> 'body')
          from jsonb_array_elements(j) x)
       = 'lp-a/team/false,Ana/link/true,Pepe Coda/imported/false,Ana/link/true', format('autores (dio %s)', j);
  -- Leer comentarios: solo de la rama; arriba, al costado, otro proyecto, la papelera y sin token no.
  perform pg_temp.expect_error(format('select * from public.plink_list_comments(%L)', pg_temp.u('d1b1')), 'page_not_found', 'lee los comentarios de la de arriba');
  perform pg_temp.expect_error(format('select * from public.plink_list_comments(%L)', pg_temp.u('d1b7')), 'page_not_found', 'lee los comentarios de la hermana');
  perform pg_temp.expect_error(format('select * from public.plink_list_comments(%L)', pg_temp.u('d1b9')), 'page_not_found', 'lee los comentarios de otro proyecto');
  perform pg_temp.expect_error(format('select * from public.plink_list_comments(%L)', pg_temp.u('d1b5')), 'page_not_found', 'lee los comentarios de una en la papelera');
  perform pg_temp.as_anon(null, d1);
  perform pg_temp.expect_error(format('select * from public.plink_list_comments(%L)', pg_temp.u('d1b2')), 'link_not_found', 'lee comentarios sin token');
  -- Otro dispositivo: no son suyos, no los edita ni los borra.
  perform pg_temp.as_anon(pg_temp.tok('S'), d2);
  assert not exists (select 1 from public.plink_list_comments(pg_temp.u('d1b2')) c where c.mine), 'otro dispositivo los ve como suyos';
  perform pg_temp.expect_error(format('select public.plink_edit_comment(%L, %L)', pg_temp.u('d1c2'), 'cambio'), 'not_allowed', 'edita desde otro dispositivo');
  perform pg_temp.expect_error(format('select public.plink_delete_comment(%L)', pg_temp.u('d1c2')), 'not_allowed', 'borra desde otro dispositivo');
  perform pg_temp.expect_error(format('select public.plink_edit_comment(%L, %L)', pg_temp.u('d1ce'), 'cambio'), 'not_allowed', 'edita uno del equipo');
  perform pg_temp.expect_error(format('select public.plink_delete_comment(%L)', pg_temp.u('d1ce')), 'not_allowed', 'borra uno del equipo');
  -- Sin id de dispositivo: tampoco.
  perform pg_temp.as_anon(pg_temp.tok('S'), null);
  perform pg_temp.expect_error(format('select public.plink_edit_comment(%L, %L)', pg_temp.u('d1c2'), 'cambio'), 'not_allowed', 'edita sin dispositivo');
  -- El link de la hija no edita los de S aunque tenga el mismo dispositivo.
  perform pg_temp.as_anon(pg_temp.tok('H'), d1);
  perform pg_temp.expect_error(format('select public.plink_edit_comment(%L, %L)', pg_temp.u('d1c4'), 'cambio'), 'not_allowed', 'otro link edita');
  -- El mismo dispositivo y link: sí.
  perform pg_temp.as_anon(pg_temp.tok('S'), d1);
  perform public.plink_edit_comment(pg_temp.u('d1c2'), 'hola editado');
  perform public.plink_delete_comment(pg_temp.u('d1c3'));
  perform pg_temp.as_postgres();
  assert (select body || '/' || (edited_at is not null) from public.comments where id = pg_temp.u('d1c2')) = 'hola editado/true', 'no editó';
  assert (select deleted_at is not null from public.comments where id = pg_temp.u('d1c3')), 'no borró';
  assert (select author_id is null and plink_author = 'Ana' and plink_id = pg_temp.lid('S')
          from public.comments where id = pg_temp.u('d1c2')), 'la autoría del link';
  -- Resolver: no hay función para el link, y la del equipo no es para anon (probado arriba).
  -- El equipo los ve con el nombre; quien tiene 4 los borra; Editar (3) no.
  perform pg_temp.as_user('d1a1');
  assert (select l.plink_author from public.list_comments(pg_temp.u('d1b2')) l where l.id = pg_temp.u('d1c2')) = 'Ana', 'list_comments sin el autor del link';
  perform pg_temp.as_user('d1a6');
  perform pg_temp.expect_error(format('select public.delete_comment(%L)', pg_temp.u('d1c2')), 'not_allowed', 'Editar borra un comentario del link');
  perform pg_temp.expect_error(format('select public.edit_comment(%L, %L)', pg_temp.u('d1c2'), 'x'), 'not_allowed', 'el equipo edita uno del link');
  perform pg_temp.expect_error(format('select public.delete_public_link_comments(%L)', pg_temp.lid('S')),
    'link_not_found', 'Editar borra los comentarios del link');
  perform pg_temp.as_user('d1a1');
  perform public.resolve_thread(pg_temp.u('d1c2'), true);
  assert public.delete_public_link_comments(pg_temp.lid('S')) = 2, 'no borra los del link (el de S y el de la hija)';
  perform public.resolve_thread(pg_temp.u('d1c2'), false);
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Topes (cada uno, y lo rechazado no suma), con dos links
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  n bigint;
begin
  -- Aperturas por link y día.
  perform pg_temp.limits('{"open": 3}');
  perform pg_temp.as_anon(pg_temp.tok('S'));
  n := pg_temp.used('S', 'open');
  while pg_temp.used('S', 'open') < 3 loop
    perform public.plink_open();
  end loop;
  perform pg_temp.expect_limit('select public.plink_open()', 'open', 'la apertura de más');
  assert pg_temp.used('S', 'open') = 3, 'lo rechazado sumó';
  -- El otro link tiene su propia cuenta.
  perform pg_temp.as_anon(pg_temp.tok('H'));
  perform public.plink_open();
  -- Pases de todos los links.
  perform pg_temp.as_postgres();
  perform pg_temp.limits(format('{"all_pass": %s}', (select coalesce(sum(a.n), 0) + 1 from public.public_link_usage_all a where a.day = current_date and a.kind = 'pass')));
  perform pg_temp.as_anon(pg_temp.tok('S'));
  perform public.plink_media_file(pg_temp.u('d1f1'));
  perform pg_temp.as_anon(pg_temp.tok('H'));
  perform pg_temp.as_postgres();
  insert into public.page_files (page_id, file_id) values (pg_temp.u('d1b3'), pg_temp.u('d1f1'));
  perform pg_temp.as_anon(pg_temp.tok('H'));
  perform pg_temp.expect_limit(format('select public.plink_media_file(%L)', pg_temp.u('d1f1')), 'all_pass', 'el pase de más entre todos');
  -- Bajadas: bytes por link y día, de todos los links y del mes.
  perform pg_temp.as_postgres();
  perform pg_temp.limits(format('{"pull_bytes": %s}', pg_temp.used_bytes('S', 'pull') + 5));
  perform pg_temp.as_anon(pg_temp.tok('S'));
  perform pg_temp.expect_limit(format('select * from public.plink_pull_page(%L, 0)', pg_temp.u('d1b2')), 'pull_bytes', 'la bajada de más del link');
  perform pg_temp.as_postgres();
  perform pg_temp.limits(format('{"all_pull_bytes": %s}', (select coalesce(sum(a.bytes), 0) + 5 from public.public_link_usage_all a where a.day = current_date and a.kind = 'pull')));
  perform pg_temp.as_anon(pg_temp.tok('S'));
  perform pg_temp.expect_limit(format('select * from public.plink_pull_page(%L, 0)', pg_temp.u('d1b2')), 'all_pull_bytes', 'la bajada de más entre todos');
  perform pg_temp.expect_limit('select * from public.plink_tree(''x'')', 'all_pull_bytes', 'el árbol de más entre todos');
  perform pg_temp.as_postgres();
  perform pg_temp.limits(format('{"all_month_pull_bytes": %s}', (select coalesce(sum(a.bytes), 0) + 5 from public.public_link_usage_all a where a.day >= date_trunc('month', current_date) and a.kind = 'pull')));
  perform pg_temp.as_anon(pg_temp.tok('S'));
  perform pg_temp.expect_limit(format('select * from public.plink_list_comments(%L)', pg_temp.u('d1b2')), 'all_month_pull_bytes', 'la lista de comentarios de más del mes');
  -- Comentarios: cantidad, bytes del día, de por vida y la guarda de la base (N1).
  perform pg_temp.as_postgres();
  perform pg_temp.limits('{}');
  perform pg_temp.as_anon(pg_temp.tok('S'));
  perform public.plink_add_comment(pg_temp.u('d1cc'), pg_temp.u('d1b2'), null, null, 'propio', 'Ana');
  perform pg_temp.as_postgres();
  perform pg_temp.limits(format('{"comment": %s}', pg_temp.used('S', 'comment')));
  perform pg_temp.as_anon(pg_temp.tok('S'));
  perform pg_temp.expect_limit(format('select public.plink_add_comment(%L, %L, null, null, %L, %L)', pg_temp.u('d1c6'), pg_temp.u('d1b2'), 'x', 'Ana'),
    'comment', 'el comentario de más');
  perform pg_temp.as_postgres();
  perform pg_temp.limits(format('{"comment_bytes": %s}', pg_temp.used_bytes('S', 'comment') + 10));
  perform pg_temp.as_anon(pg_temp.tok('S'));
  perform pg_temp.expect_limit(format('select public.plink_add_comment(%L, %L, null, null, %L, %L)', pg_temp.u('d1c6'), pg_temp.u('d1b2'), repeat('x', 11), 'Ana'),
    'comment_bytes', 'los bytes de más del día');
  perform pg_temp.expect_limit(format('select public.plink_edit_comment(%L, %L)', pg_temp.u('d1cc'), repeat('y', 11)),
    'comment_bytes', 'editar con bytes de más');
  perform public.plink_add_comment(pg_temp.u('d1c6'), pg_temp.u('d1b2'), null, null, repeat('x', 10), 'Ana');
  perform pg_temp.as_postgres();
  perform pg_temp.limits(format('{"life_comment_bytes": %s}', (select comment_bytes_total + 3 from public.public_links where id = pg_temp.lid('S'))));
  perform pg_temp.as_anon(pg_temp.tok('S'));
  perform pg_temp.expect_limit(format('select public.plink_add_comment(%L, %L, null, null, %L, %L)', pg_temp.u('d1c7'), pg_temp.u('d1b2'), 'cuatro', 'Ana'),
    'life_comment_bytes', 'los bytes de por vida');
  perform pg_temp.as_postgres();
  perform pg_temp.limits('{"db_guard_bytes": 1}');
  perform pg_temp.as_anon(pg_temp.tok('S'));
  perform pg_temp.expect_limit(format('select public.plink_add_comment(%L, %L, null, null, %L, %L)', pg_temp.u('d1c7'), pg_temp.u('d1b2'), 'x', 'Ana'),
    'db_guard', 'la guarda de la base');
  perform pg_temp.as_postgres();
  -- La guarda mide todas las bases, como Supabase.
  assert (select bytes from private.db_guard) >= (select sum(pg_database_size(datname)) from pg_database) - 1048576,
    'la guarda no mide todas las bases';
  assert not exists (select 1 from public.comments where id in (pg_temp.u('d1c7'))), 'un comentario rechazado quedó';
  perform pg_temp.limits('{}');
  -- La app vieja no comenta (como las cuentas).
  perform pg_temp.as_anon(pg_temp.tok('S'), 'devAAAAAAAAAAAAAAAAAAAA', '0.001');
  perform pg_temp.expect_outdated(format('select public.plink_add_comment(%L, %L, null, null, %L, %L)', pg_temp.u('d1c7'), pg_temp.u('d1b2'), 'x', 'Ana'),
    'comenta con la app vieja');
  perform pg_temp.as_postgres();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Vencer, cambiar, resetear, revocar
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  old text := pg_temp.tok('S');
  j   jsonb;
begin
  perform pg_temp.as_user('d1a1');
  j := public.set_public_link(pg_temp.u('d1b2'), 'comment', now() + interval '1 day');
  assert j ->> 'token' = old and j ->> 'expires_at' is not null, 'set cambia el token';
  assert pg_temp.tree(old) = 'H,N,S', 'con vencimiento futuro no anda';
  perform pg_temp.as_postgres();
  update public.public_links set created_at = now() - interval '2 days', expires_at = now() - interval '1 second'
  where id = pg_temp.lid('S');
  assert pg_temp.tree(old) = 'error:link_not_found', 'vencido anda';
  perform pg_temp.as_user('d1a1');
  perform public.set_public_link(pg_temp.u('d1b2'), 'comment', null);
  assert pg_temp.tree(old) = 'H,N,S', 'sin vencimiento no vuelve';
  -- Quién cambia, resetea o revoca: lo mismo que crear (nadie sin 4, ni con 4 si no es admin/dueño del proyecto, ni
  -- un invitado; sin permiso, ni se entera de que la página existe). Y Reset pide el interruptor de D14 (D33).
  declare
    who text;
    fn  text;
    st  text;
  begin
    foreach who in array array['d1a8:page_not_found', 'd1a7:not_allowed', 'd1a6:not_allowed', 'd1a4:not_allowed', 'd1a5:not_allowed'] loop
      perform pg_temp.as_user(split_part(who, ':', 1));
      foreach fn in array array['set', 'reset', 'revoke'] loop
        st := case fn
          when 'set' then format('select public.set_public_link(%L, %L, null)', pg_temp.u('d1b2'), 'comment')
          when 'reset' then format('select public.reset_public_link(%L, %L)', pg_temp.u('d1b2'), pg_temp.u('d1cd'))
          else format('select public.revoke_public_link(%L)', pg_temp.u('d1b2')) end;
        perform pg_temp.expect_error(st, split_part(who, ':', 2), format('%s con %s', fn, split_part(who, ':', 1)));
      end loop;
    end loop;
    perform pg_temp.as_postgres();
    assert (select count(*) from public.public_links where page_id = pg_temp.u('d1b2') and revoked_at is null) = 1,
      'alguien sin permiso tocó el link de S';
    assert pg_temp.tree(old) = 'H,N,S', 'alguien sin permiso cortó el link de S';
    update public.workspace_settings set clean_min_version = null where id;
    perform pg_temp.as_user('d1a1');
    perform pg_temp.expect_error(format('select public.reset_public_link(%L, %L)', pg_temp.u('d1b2'), pg_temp.u('d1cd')),
      'clean_off', 'resetea con el interruptor apagado');
    perform pg_temp.as_postgres();
    update public.workspace_settings set clean_min_version = 0.5 where id;
    assert pg_temp.tree(old) = 'H,N,S', 'el reset rechazado cortó el link';
  end;
  -- Reset: el viejo deja de andar en el acto; reintentar no crea un tercero. Y el link nuevo no recibe la base armada
  -- antes de que el editor borrara algo (como crear): la base de S llega a la fila 2 y la fila 3 se sube después.
  perform pg_temp.as_user('d1a1');
  perform public.push_page_update(pg_temp.u('d1b2'), pg_temp.u('d104'), 'BA==', '9.999');
  perform pg_temp.as_anon(old);
  assert (select count(*) from public.plink_pull_page(pg_temp.u('d1b2'), 0)) = 1, 'control: el link viejo no baja la base';
  perform pg_temp.as_user('d1a2');
  j := public.reset_public_link(pg_temp.u('d1b2'), pg_temp.u('d1ca'));
  perform pg_temp.as_postgres();
  assert (select clean_reset_seq from public.pages where id = pg_temp.u('d1b2')) = 3, 'reset no reinicia S';
  assert (select clean_reset_seq from public.pages where id = pg_temp.u('d1b3')) = (select update_seq from public.pages where id = pg_temp.u('d1b3')),
    'reset no reinicia la hija';
  perform pg_temp.as_anon(j ->> 'token');
  assert (select count(*) from public.plink_pull_page(pg_temp.u('d1b2'), 0)) = 0, 'el link nuevo baja la base de antes del borrado';
  assert (select t.clean_seq from public.plink_tree() t where t.id = pg_temp.u('d1b2')) = 0, 'el árbol del link nuevo dice que la base está al día';
  perform pg_temp.as_user('d1a2');
  assert j ->> 'token' <> old, 'reset no cambia el token';
  assert public.reset_public_link(pg_temp.u('d1b2'), pg_temp.u('d1ca')) ->> 'token' = j ->> 'token', 'reset reintentado crea otro';
  perform pg_temp.save('S', j);
  assert pg_temp.tree(old) = 'error:link_not_found', 'el viejo anda después del reset';
  assert pg_temp.tree(pg_temp.tok('S')) = 'H,N,S', 'el nuevo no anda';
  -- Los comentarios del link viejo no los edita el nuevo.
  perform pg_temp.as_anon(pg_temp.tok('S'), 'dev1AAAAAAAAAAAAAAAAAAAA');
  perform pg_temp.expect_error(format('select public.plink_edit_comment(%L, %L)', pg_temp.u('d1c2'), 'z'), 'not_allowed', 'el link nuevo edita los del viejo');
  -- Revocar.
  perform pg_temp.as_user('d1a1');
  perform public.revoke_public_link(pg_temp.u('d1b2'));
  assert pg_temp.tree(pg_temp.tok('S')) = 'error:link_not_found', 'revocado anda';
  perform pg_temp.as_user('d1a1');
  assert public.get_public_link(pg_temp.u('d1b2')) -> 'link' = 'null'::jsonb, 'Share muestra el revocado';
  perform pg_temp.save('S', public.create_public_link(pg_temp.u('d1cb'), pg_temp.u('d1b2'), 'comment'));
  assert pg_temp.tree(pg_temp.tok('S')) = 'H,N,S', 'el creado de nuevo no anda';
  perform pg_temp.as_postgres();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- El creador: la regla de compartir en vivo; sacarlo lo revoca para siempre
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  -- H es del admin ad. Pasa a miembro común (sigue con 4 pero no es admin ni dueño del proyecto): no anda.
  perform pg_temp.as_postgres();
  update public.members set role = 'member' where user_id = pg_temp.u('d1a2');
  assert pg_temp.tree(pg_temp.tok('H')) = 'error:link_not_found', 'el link de alguien que ya no comparte anda';
  update public.members set role = 'admin' where user_id = pg_temp.u('d1a2');
  assert pg_temp.tree(pg_temp.tok('H')) = 'H,N', 'el link no vuelve con el rol';
  -- Sin el permiso sobre la página: no anda; con el permiso de vuelta, sí.
  update public.grants set revoked_at = now() where user_id = pg_temp.u('d1a2');
  assert pg_temp.tree(pg_temp.tok('H')) = 'error:link_not_found', 'el link sin el permiso del creador anda';
  update public.grants set revoked_at = null where user_id = pg_temp.u('d1a2');
  assert pg_temp.tree(pg_temp.tok('H')) = 'H,N', 'el link no vuelve con el permiso';
  -- Invitado: no.
  update public.members set role = 'guest' where user_id = pg_temp.u('d1a2');
  assert pg_temp.tree(pg_temp.tok('H')) = 'error:link_not_found', 'el link de un invitado anda';
  update public.members set role = 'admin' where user_id = pg_temp.u('d1a2');
  -- Sacarlo: lo revoca (con quién), y volver a sumarlo no lo revive.
  perform pg_temp.as_user('d1a0');
  perform public.remove_member(pg_temp.u('d1a2'));
  perform pg_temp.as_postgres();
  assert (select revoked_at is not null and revoked_by = pg_temp.u('d1a0') from public.public_links where id = pg_temp.lid('H')),
    'sacar no revoca';
  update public.members set removed_at = null where user_id = pg_temp.u('d1a2');
  assert pg_temp.tree(pg_temp.tok('H')) = 'error:link_not_found', 'el link revive al volver';
  -- El de S (de a) sigue.
  assert pg_temp.tree(pg_temp.tok('S')) = 'H,N,S', 'sacar a otro apagó S';
  -- a creó el proyecto; si pasa a invitado, nunca comparte: su link se apaga (y vuelve con el rol).
  update public.members set role = 'guest' where user_id = pg_temp.u('d1a1');
  assert pg_temp.tree(pg_temp.tok('S')) = 'error:link_not_found', 'el link del dueño del proyecto pasado a invitado anda';
  perform pg_temp.as_user('d1a1');
  assert not private.can_share(null, pg_temp.u('d1b2')), 'el dueño del proyecto invitado comparte';
  perform pg_temp.as_postgres();
  update public.members set role = 'member' where user_id = pg_temp.u('d1a1');
  assert pg_temp.tree(pg_temp.tok('S')) = 'H,N,S', 'no volvió con el rol';
  -- can_share: lo mismo que antes para las personas de la prueba (y nunca un invitado).
  perform pg_temp.as_user('d1a1');
  assert private.can_share(null, pg_temp.u('d1b2')), 'a no comparte';
  perform pg_temp.as_user('d1a3');
  assert private.can_share(null, pg_temp.u('d1b2')), 'el admin no comparte';
  perform pg_temp.as_user('d1a4');
  assert not private.can_share(null, pg_temp.u('d1b2')), 'm4 comparte';
  perform pg_temp.as_user('d1a5');
  assert not private.can_share(null, pg_temp.u('d1b2')), 'el invitado comparte';
  perform pg_temp.as_postgres();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Las bases se arman para las ramas con link: has_plain_readers, clean_work y mover adentro
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.as_postgres();
  -- Sin lectores personas en P (Comentar y el invitado sobre todo el proyecto), solo el link.
  update public.grants set revoked_at = now() where user_id in (pg_temp.u('d1a5'), pg_temp.u('d1a7'));
  assert private.has_plain_readers(pg_temp.u('d1b4')), 'una página con link arriba no tiene lectores';
  assert not private.has_plain_readers(pg_temp.u('d1b8')), 'R2 tiene lectores';
  -- H no tiene base y tiene contenido: clean_work se la pide a quien edita P.
  perform pg_temp.as_user('d1a1');
  assert exists (select 1 from public.clean_work('1.000') w where w.page_id = pg_temp.u('d1b3')), 'clean_work no pide H';
  assert not exists (select 1 from public.clean_work('1.000') w where w.page_id = pg_temp.u('d1b8')), 'clean_work pide R2';
  -- Mover R2 adentro de la rama con link la reinicia.
  perform pg_temp.as_postgres();
  perform pg_temp.as_user('d1a1');
  perform public.push_page_update(pg_temp.u('d1b8'), pg_temp.u('d1d8'), 'CQ==', '9.999');
  perform pg_temp.as_postgres();
  assert (select clean_reset_seq from public.pages where id = pg_temp.u('d1b8')) = 0, 'R2 ya estaba reiniciada';
  update public.pages set parent_id = pg_temp.u('d1b3') where id = pg_temp.u('d1b8');
  assert (select clean_reset_seq from public.pages where id = pg_temp.u('d1b8')) = 1, 'mover adentro no reinicia';
end;
$$;

rollback;
select 'ok' as result;
