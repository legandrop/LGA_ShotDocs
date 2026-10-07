-- Pruebas del nombre del visitante sin el rótulo (20261112120000_link_nombre_sin_rotulo.sql): la base saca
-- «(via link)» del nombre con que un link comenta (`plink_add_comment`) y escribe (`plink_push_page_update`), sin
-- rechazar nada que antes aceptara; un nombre sin el rótulo se guarda exactamente como antes; lo que no admitía (vacío,
-- largo, controles, marcas de dirección) lo sigue rechazando; y las dos funciones siguen siendo de quien eran. Corre
-- dentro de una transacción que se deshace al final: no deja usuarios ni datos. Si todo pasa, devuelve una fila con
-- result = 'ok'.

begin;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-00000000' || s)::uuid;
$$;

create function pg_temp.as_user(s text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(s), 'role', 'authenticated')::text, true),
         set_config('request.headers', '{"x-shotdocs-version": "9.999"}', true);
$$;

-- El visitante del link de la prueba: el rol anon con su token, su dispositivo y la versión de la app.
create function pg_temp.as_visitor(ver text default '9.999') returns void language sql as $$
  select set_config('role', 'anon', true),
         set_config('request.jwt.claims', '{"role": "anon"}', true),
         set_config('request.headers',
                    json_build_object('x-shotdocs-link', 'sdl_' || rpad('d7c0', 43, 'x'), 'x-shotdocs-device', 'devAAAAAAAAAAAAAAAAAAAA',
                                      'x-shotdocs-version', ver)::text, true);
$$;

create function pg_temp.as_console() returns void language sql as $$
  select set_config('role', 'postgres', true),
         set_config('request.jwt.claims', '', true),
         set_config('request.headers', '', true);
$$;

-- Corre `stmt` como el visitante y devuelve 'ok' o 'error:<mensaje>'.
create function pg_temp.visitor(stmt text) returns text language plpgsql as $$
declare
  r text := 'ok';
begin
  perform pg_temp.as_visitor();
  begin
    execute stmt;
  exception when others then
    r := 'error:' || sqlerrm;
  end;
  perform pg_temp.as_console();
  return r;
end;
$$;

-- Comentar y escribir con un nombre: lo que contesta la base y el nombre que quedó guardado (`-` si no guardó nada).
create function pg_temp.comment_as(n int, who text) returns text language plpgsql as $$
declare
  cid constant uuid := pg_temp.u('d7' || lpad(n::text, 2, '0'));
  r   text;
begin
  r := pg_temp.visitor(format('select public.plink_add_comment(%L, %L, null, null, %L, %L)', cid, pg_temp.u('d7b0'), 'texto ' || n, who));
  return r || '|' || coalesce((select c.plink_author from public.comments c where c.id = cid), '(nada)');
end;
$$;

create function pg_temp.push_as(n int, who text) returns text language plpgsql as $$
declare
  cid constant uuid := pg_temp.u('d8' || lpad(n::text, 2, '0'));
  r   text;
begin
  r := pg_temp.visitor(format('select public.plink_push_page_update(%L, %L, %L, %L, %L)', pg_temp.u('d7b0'), cid, 'CgsM', '9.999', who));
  return r || '|' || coalesce((select u.author from public.public_link_updates u where u.client_update_id = cid), '(nada)');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Datos: una persona que creó el proyecto, una página y su link Can edit.
-- ---------------------------------------------------------------------------------------------------
update public.members set removed_at = now() where role = 'owner' and removed_at is null;
update public.workspace_settings
set min_app_version = 0.5, clean_min_version = 0.5, link_edit_min_version = 0.5, link_limits = '{}' where id;
insert into auth.users (id, email, aud, role) values
  (pg_temp.u('d7a0'), 'lnr-o@test.invalid', 'authenticated', 'authenticated');
update public.workspace_settings set owner_id = pg_temp.u('d7a0') where id;
insert into public.members (user_id, role) values (pg_temp.u('d7a0'), 'owner');
insert into public.workspaces (id, owner_id, name) values (pg_temp.u('d7e0'), pg_temp.u('d7a0'), 'P');
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values (pg_temp.u('d7b0'), pg_temp.u('d7e0'), null, 'A', 'a0');
insert into public.public_links (id, page_id, token, token_hash, level, created_by, created_at)
values (pg_temp.u('d7c0'), pg_temp.u('d7b0'), 'sdl_' || rpad('d7c0', 43, 'x'), extensions.digest('sdl_' || rpad('d7c0', 43, 'x'), 'sha256'),
        'edit', pg_temp.u('d7a0'), now() - interval '2 days');

-- ---------------------------------------------------------------------------------------------------
-- La limpieza del nombre.
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  f constant regprocedure := 'private.plink_author_name(text)'::regprocedure;
  t record;
  nb constant text := chr(160);     -- el espacio que no corta
  em constant text := chr(8195);    -- un espacio ancho
  ideo constant text := chr(12288); -- el espacio ideográfico
begin
  assert (select p.provolatile = 'i' and not p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = f),
    'la limpieza no es immutable y con search_path vacío';
  assert not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute'), 'alguien la llama desde la API';
  assert not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = f and a.grantee = 0), 'PUBLIC la ejecuta';

  for t in
    select * from (values
      -- Con el rótulo: sale, las veces que esté y como esté escrito.
      ('Ana (via link)', 'Ana'),
      ('Ana (vía link)', 'Ana'),
      ('Ana (VÍA LINK)', 'Ana'),
      ('Ana ( VIA   Link ) Pérez', 'Ana Pérez'),
      ('(via link)(via link) Ana', 'Ana'),
      ('Ana (via link)(vía link)', 'Ana'),
      ('Ana （via link）', 'Ana'),
      ('Ana (via' || nb || 'link)', 'Ana'),
      ('Ana (' || em || 'via' || ideo || 'link' || nb || ')', 'Ana'),
      -- Sacar uno deja armado otro: también sale.
      ('(via (via link) link) Ana', 'Ana'),
      ('Ana (v(via link)ia link)', 'Ana (v ia link)'),
      ('(via ((via link)via link) link)', '-'),
      -- Donde había varios espacios por lo sacado queda uno.
      ('Ana   (via link)   Pérez', 'Ana Pérez'),
      -- Solo el rótulo: no queda vacío (no se rechaza), queda un guion.
      ('(via link)', '-'),
      ('  (via link) (VIA LINK)  ', '-'),
      -- Sin el rótulo: exactamente lo de antes (`btrim`), también con espacios adentro.
      ('Ana', 'Ana'),
      ('  Ana  ', 'Ana'),
      ('Ana  Pérez', 'Ana  Pérez'),
      ('Ana (cliente)', 'Ana (cliente)'),
      ('Olivia Linker', 'Olivia Linker'),
      ('via link', 'via link'),
      ('(via linkedin)', '(via linkedin)'),
      ('(vialink)', '(vialink)'),
      ('(via' || chr(9) || 'link)', '(via' || chr(9) || 'link)'),
      ('', ''),
      ('   ', '')) v (raw, want)
  loop
    assert private.plink_author_name(t.raw) = t.want, format('«%s» queda «%s» y se esperaba «%s»', t.raw, private.plink_author_name(t.raw), t.want);
    if t.raw !~* 'v[ií]a.+link' or t.raw ~ 'linkedin' or t.raw = 'via link' then
      assert private.plink_author_name(t.raw) = btrim(t.raw), format('«%s» sin rótulo no queda como antes', t.raw);
    end if;
  end loop;
  assert private.plink_author_name(null) is null, 'un nombre nulo no queda nulo';
  -- Lo que queda nunca trae el rótulo.
  assert not exists (
    select 1 from (values ('Ana (via link)'), ('(via (via link) link) Ana'), ('(via ((via link)via link) link)'), ('x (VIA  LINK)(vía link) y')) v (raw)
    where private.plink_author_name(v.raw) ~* '[(（]\s*v[ií]a\s+link\s*[)）]'), 'queda un rótulo después de limpiar';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Comentar y escribir por el link: se guarda el nombre limpio; lo que se rechazaba se sigue rechazando.
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  code int;
  bad  text;
begin
  -- Con el rótulo: entra, con el nombre limpio. Nunca un error.
  assert pg_temp.comment_as(1, 'Ana (via link)') = 'ok|Ana', format('comentar con el rótulo: %s', pg_temp.comment_as(1, 'Ana (via link)'));
  assert pg_temp.push_as(1, 'Ana (vía link)') = 'ok|Ana', format('escribir con el rótulo: %s', pg_temp.push_as(1, 'Ana (vía link)'));
  assert pg_temp.comment_as(2, '  Ana ( VIA  Link ) Pérez ') = 'ok|Ana Pérez', 'comentar con el rótulo en el medio';
  assert pg_temp.push_as(2, '(via (via link) link) Ana') = 'ok|Ana', 'escribir con un rótulo adentro de otro';
  -- Solo el rótulo: entra igual (no se pierde lo escrito), a nombre de un guion.
  assert pg_temp.comment_as(3, '(via link)') = 'ok|-', format('comentar con solo el rótulo: %s', pg_temp.comment_as(3, '(via link)'));
  assert pg_temp.push_as(3, ' (VÍA LINK) ') = 'ok|-', 'escribir con solo el rótulo';
  -- 60 caracteres más el rótulo: antes se rechazaba por largo; ahora entra con los 60.
  assert pg_temp.comment_as(4, repeat('x', 60) || ' (via link)') = 'ok|' || repeat('x', 60), 'comentar con 60 caracteres y el rótulo';
  assert pg_temp.push_as(4, repeat('x', 60) || ' (via link)') = 'ok|' || repeat('x', 60), 'escribir con 60 caracteres y el rótulo';
  -- Sin el rótulo: como antes, tal cual (solo sin los espacios de las puntas).
  assert pg_temp.comment_as(5, '  Ana  Pérez (cliente) ') = 'ok|Ana  Pérez (cliente)', 'comentar sin rótulo cambió el nombre';
  assert pg_temp.push_as(5, '  Ana  Pérez (cliente) ') = 'ok|Ana  Pérez (cliente)', 'escribir sin rótulo cambió el nombre';
  -- El mismo comentario otra vez, con el nombre como lo mandó: no es un conflicto.
  assert pg_temp.visitor(format('select public.plink_add_comment(%L, %L, null, null, %L, %L)', pg_temp.u('d701'), pg_temp.u('d7b0'), 'texto 1', 'Ana (via link)')) = 'ok',
    'repetir el comentario con el rótulo da un error';
  assert pg_temp.push_as(1, 'Ana (vía link)') = 'ok|Ana', 'repetir lo escrito con el rótulo da un error';

  -- Lo que no se admite, igual que antes: vacío, más de 60, nulo.
  assert pg_temp.comment_as(10, '   ') = 'error:author_invalid|(nada)', 'comenta sin nombre';
  assert pg_temp.push_as(10, '') = 'error:author_invalid|(nada)', 'escribe sin nombre';
  assert pg_temp.comment_as(11, repeat('x', 61)) = 'error:author_invalid|(nada)', 'comenta con 61 caracteres';
  assert pg_temp.push_as(11, repeat('x', 61)) = 'error:author_invalid|(nada)', 'escribe con 61 caracteres';
  assert pg_temp.push_as(12, repeat('x', 61) || ' (via link)') = 'error:author_invalid|(nada)', 'escribe con 61 caracteres y el rótulo';
  assert pg_temp.visitor(format('select public.plink_add_comment(%L, %L, null, null, %L, null)', pg_temp.u('d713'), pg_temp.u('d7b0'), 'x')) = 'error:author_invalid',
    'comenta con el nombre nulo';
  -- Los controles y cada marca de dirección o carácter invisible de la lista, en las dos funciones, solos y junto al
  -- rótulo (limpiar no los deja pasar).
  foreach code in array array[1, 9, 10, 13, 127, 1564, 8203, 8204, 8205, 8206, 8207, 8232, 8233, 8234, 8235, 8236, 8237, 8238,
                              8288, 8289, 8290, 8291, 8292, 8293, 8294, 8295, 8296, 8297, 65279] loop
    bad := 'An' || chr(code) || 'a';
    assert pg_temp.comment_as(20, bad) = 'error:author_invalid|(nada)', format('comenta con el carácter %s', code);
    assert pg_temp.push_as(20, bad) = 'error:author_invalid|(nada)', format('escribe con el carácter %s', code);
    assert pg_temp.comment_as(20, bad || ' (via link)') = 'error:author_invalid|(nada)', format('comenta con el carácter %s y el rótulo', code);
    assert pg_temp.push_as(20, '(via' || chr(code) || ' link) Ana') = 'error:author_invalid|(nada)', format('escribe con el carácter %s adentro del rótulo', code);
  end loop;

  -- Lo guardado: ninguna fila del link trae el rótulo, ni en los comentarios ni en la sala.
  assert (select count(*) = 5 and count(*) filter (where c.plink_author ~* 'link') = 0 from public.comments c where c.plink_id = pg_temp.u('d7c0')),
    'los comentarios del link no son los cinco aceptados, o alguno trae el rótulo';
  assert (select count(*) = 5 and count(*) filter (where u.author ~* 'link') = 0 from public.public_link_updates u where u.link_id = pg_temp.u('d7c0')),
    'lo escrito por el link no son las cinco aceptadas, o alguna trae el rótulo';
  -- Lo que lee el visitante: su nombre limpio.
  perform pg_temp.as_visitor();
  assert (select count(*) = 5 and count(*) filter (where c.author_name ~* 'link') = 0
                 and count(*) filter (where c.author_name in ('Ana', 'Ana Pérez', '-')) = 3
          from public.plink_list_comments(pg_temp.u('d7b0'), null) c), 'el visitante no lee los cinco nombres limpios';
  perform pg_temp.as_console();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Las dos funciones siguen siendo de quien eran.
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  c constant regprocedure := 'public.plink_add_comment(uuid, uuid, text, uuid, text, text)'::regprocedure;
  p constant regprocedure := 'public.plink_push_page_update(uuid, uuid, text, text, text)'::regprocedure;
begin
  assert (select count(*) = 2 from pg_proc f where f.oid in (c, p) and f.prosecdef and f.provolatile = 'v' and f.proconfig @> array['search_path=""']),
    'alguna dejó de ser security definer, volatile y con search_path vacío';
  assert (select f.prorettype = 'void'::regtype from pg_proc f where f.oid = c) and (select f.prorettype = 'bigint'::regtype from pg_proc f where f.oid = p),
    'cambió lo que devuelven';
  assert has_function_privilege('anon', c, 'execute') and has_function_privilege('anon', p, 'execute'), 'el visitante ya no las ejecuta';
  assert not has_function_privilege('authenticated', c, 'execute') and not has_function_privilege('authenticated', p, 'execute'), 'una sesión las ejecuta';
  assert not exists (select 1 from pg_proc f, aclexplode(f.proacl) a where f.oid in (c, p) and a.grantee = 0), 'PUBLIC las ejecuta';
  -- Sin el token de un link, nada; con una sesión, tampoco.
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  perform set_config('request.headers', '{"x-shotdocs-version": "9.999"}', true);
  begin
    perform public.plink_add_comment(pg_temp.u('d730'), pg_temp.u('d7b0'), null, null, 'x', 'Ana');
    raise exception 'FALLA: comenta sin el token de un link';
  exception when no_data_found then null;
  end;
  perform pg_temp.as_user('d7a0');
  begin
    perform public.plink_add_comment(pg_temp.u('d730'), pg_temp.u('d7b0'), null, null, 'x', 'Ana (via link)');
    raise exception 'FALLA: una sesión comenta como visitante';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.as_console();
end;
$$;

rollback;

select 'ok' as result;
