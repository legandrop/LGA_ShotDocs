-- Pruebas de la papelera de archivos de todos los proyectos (20261108120000_papelera_archivos_todos.sql):
-- `trashed_files_all()` da, para cada persona, exactamente lo que le da `trashed_files` proyecto por proyecto (las
-- mismas filas, con el proyecto adelante), una fila con solo el proyecto por cada papelera que ve y está vacía, y nada
-- de los proyectos donde `trashed_files` responde `not_allowed`, de los borrados ni de los privados de otra persona.
-- Corre dentro de una transacción que se deshace al final: no deja usuarios ni datos. Si todo pasa, devuelve una fila
-- con result = 'ok'.

begin;

create function pg_temp.u(s text) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-00000000' || s)::uuid;
$$;

-- La sesión de una persona. `amr`: cómo entró (con contraseña no es miembro de nada).
create function pg_temp.as_user(s text, amr jsonb default '[{"method": "otp"}]') returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
                    json_build_object('sub', pg_temp.u(s), 'role', 'authenticated', 'aal', 'aal1', 'amr', amr)::text, true),
         set_config('request.headers', '{"x-shotdocs-version": "9.999"}', true);
$$;

create function pg_temp.as_console() returns void language sql as $$
  select set_config('role', 'postgres', true),
         set_config('request.jwt.claims', '', true),
         set_config('request.headers', '', true);
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

-- Los proyectos de la prueba, por nombre (como definer: la sesión no los ve todos).
create function pg_temp.projects() returns table (id uuid, name text) language sql security definer as $$
  select w.id, w.name from public.workspaces w
  where w.id in (pg_temp.u('f2e1'), pg_temp.u('f2e2'), pg_temp.u('f2e3'), pg_temp.u('f2e4'), pg_temp.u('f2e5'))
  order by w.name;
$$;

-- Lo que da la función nueva a la sesión, resumido: "P1[a.jpg,b.mov,…] P2[] …" (`[]`: la ve y está vacía).
create function pg_temp.all_summary() returns text language sql as $$
  select coalesce(string_agg(format('%s[%s]', q.name, q.files), ' ' order by q.name), '')
  from (
    select p.name, coalesce(string_agg(a.name, ',' order by a.name) filter (where a.id is not null), '') as files
    from public.trashed_files_all() a
    join pg_temp.projects() p on p.id = a.project_id
    group by p.name) q;
$$;

-- Cada fila de la función nueva, entera (sin el proyecto), contra `trashed_files` de cada proyecto de la prueba: lo que
-- una da y la otra no. Vacío si coinciden. Un proyecto donde `trashed_files` responde `not_allowed` no puede traer nada.
create function pg_temp.differences() returns text language plpgsql as $$
declare
  p     record;
  one   jsonb;
  every jsonb;
  marks int;
  r     text := '';
begin
  for p in select * from pg_temp.projects() loop
    select coalesce(jsonb_agg(to_jsonb(a) - 'project_id' order by a.trashed_at desc, a.id) filter (where a.id is not null), '[]'::jsonb),
           count(*) filter (where a.id is null)
      into every, marks
      from public.trashed_files_all() a where a.project_id = p.id;
    begin
      select coalesce(jsonb_agg(to_jsonb(t) order by t.trashed_at desc, t.id), '[]'::jsonb) into one from public.trashed_files(p.id) t;
      if one <> every then
        r := r || format(' %s: distintas filas', p.name);
      end if;
      -- La marca, si y solo si la ve y está vacía; nunca junto con archivos.
      if marks <> (case when one = '[]'::jsonb then 1 else 0 end) then
        r := r || format(' %s: %s marcas', p.name, marks);
      end if;
    exception when insufficient_privilege then
      if every <> '[]'::jsonb or marks <> 0 then
        r := r || format(' %s: trae algo de una papelera que no ve', p.name);
      end if;
    end;
  end loop;
  return btrim(r);
end;
$$;

-- La lista pedida de a páginas de `page_rows` filas, con el orden que manda la app, numeradas como van llegando.
create function pg_temp.paged(page_rows int) returns table (n bigint, project_id uuid, id uuid, name text) language plpgsql as $$
declare
  at  int := 0;
  got int;
begin
  loop
    return query
      select at + row_number() over (), q.project_id, q.id, q.name
      from (select a.project_id, a.id, a.name from public.trashed_files_all() a
            order by a.project_id asc, a.trashed_at desc nulls last, a.id asc
            limit page_rows offset at) q;
    get diagnostics got = row_count;
    exit when got < page_rows;
    at := at + page_rows;
  end loop;
end;
$$;

-- La huella de lo que la función lee: no puede cambiar nada.
create function pg_temp.fingerprint() returns text language sql security definer as $$
  select md5(coalesce((select string_agg(f::text, '|' order by f.id) from public.files f
                       where f.project_id in (select id from pg_temp.projects())), '')
             || '#' || coalesce((select string_agg(pf::text, '|' order by pf.page_id, pf.file_id) from public.page_files pf
                                 join public.files f on f.id = pf.file_id
                                 where f.project_id in (select id from pg_temp.projects())), ''));
$$;

-- ---------------------------------------------------------------------------------------------------
-- Datos
-- ---------------------------------------------------------------------------------------------------
-- Personas: o (dueña del workspace; creó P1, P2, P4 y P5), ad (admin; creó P3, privado, y tiene Ver sobre P1), ad0
-- (admin sin ningún permiso), m4 (miembro, Editar y crear sobre P1 y P2), me (miembro, Editar sobre P1), g (invitado,
-- Editar y crear sobre P1), x (miembro sin permisos), rm (admin, Editar y crear sobre P1, sacada del workspace).
update public.members set removed_at = now() where role = 'owner' and removed_at is null;
update public.workspace_settings set min_app_version = null where id;
insert into auth.users (id, email, aud, role) values
  (pg_temp.u('f2a0'), 'pat-o@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('f2a1'), 'pat-ad@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('f2a2'), 'pat-ad0@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('f2a3'), 'pat-m4@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('f2a4'), 'pat-me@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('f2a5'), 'pat-g@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('f2a6'), 'pat-x@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('f2a7'), 'pat-rm@test.invalid', 'authenticated', 'authenticated');
update public.workspace_settings set owner_id = pg_temp.u('f2a0') where id;
insert into public.members (user_id, role, removed_at) values
  (pg_temp.u('f2a0'), 'owner', null), (pg_temp.u('f2a1'), 'admin', null), (pg_temp.u('f2a2'), 'admin', null),
  (pg_temp.u('f2a3'), 'member', null), (pg_temp.u('f2a4'), 'member', null), (pg_temp.u('f2a5'), 'guest', null),
  (pg_temp.u('f2a6'), 'member', null), (pg_temp.u('f2a7'), 'admin', now());
-- P1: con archivos. P2: sin archivos. P3: privado de la admin. P4: borrado. P5: archivado.
insert into public.workspaces (id, owner_id, name) values
  (pg_temp.u('f2e1'), pg_temp.u('f2a0'), 'P1'),
  (pg_temp.u('f2e2'), pg_temp.u('f2a0'), 'P2'),
  (pg_temp.u('f2e3'), pg_temp.u('f2a1'), 'P3'),
  (pg_temp.u('f2e4'), pg_temp.u('f2a0'), 'P4'),
  (pg_temp.u('f2e5'), pg_temp.u('f2a0'), 'P5');
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  (pg_temp.u('f2b0'), pg_temp.u('f2e1'), null, 'viva', 'a0'),
  (pg_temp.u('f2b1'), pg_temp.u('f2e1'), null, 'en la papelera', 'a1'),
  (pg_temp.u('f2b2'), pg_temp.u('f2e2'), null, 'sola', 'a0');
update public.pages set deleted_at = now() where id = pg_temp.u('f2b1');
insert into public.grants (user_id, project_id, page_id, level) values
  (pg_temp.u('f2a1'), pg_temp.u('f2e1'), null, 'view'),
  (pg_temp.u('f2a3'), pg_temp.u('f2e1'), null, 'edit_pages'),
  (pg_temp.u('f2a3'), pg_temp.u('f2e2'), null, 'edit_pages'),
  (pg_temp.u('f2a4'), pg_temp.u('f2e1'), null, 'edit'),
  (pg_temp.u('f2a5'), pg_temp.u('f2e1'), null, 'edit_pages'),
  (pg_temp.u('f2a7'), pg_temp.u('f2e1'), null, 'edit_pages');
-- P1: a (papelera), b (papelera, pedido a Drive), c (en uso), d (ya en la papelera de Drive: no se lista), e (lo usa
-- una página de la papelera de páginas). P3: g. P4: h. P5: k.
insert into public.files (id, project_id, name, mime, size, drive_id, uploaded_at, trashed_at, purged_at, drive_trashed_at) values
  (pg_temp.u('f2c0'), pg_temp.u('f2e1'), 'a.jpg', 'image/jpeg', 1000, 'drive_pat_a_xxxxx', now() - interval '9 days', now() - interval '3 days', null, null),
  (pg_temp.u('f2c1'), pg_temp.u('f2e1'), 'b.mov', 'video/quicktime', 5000000000, 'drive_pat_b_xxxxx', now() - interval '9 days', now() - interval '40 days', now() - interval '1 day', null),
  (pg_temp.u('f2c2'), pg_temp.u('f2e1'), 'c.jpg', 'image/jpeg', 30, 'drive_pat_c_xxxxx', now() - interval '9 days', null, null, null),
  (pg_temp.u('f2c3'), pg_temp.u('f2e1'), 'd.jpg', 'image/jpeg', 40, 'drive_pat_d_xxxxx', now() - interval '9 days', now() - interval '5 days', now() - interval '4 days', now() - interval '4 days'),
  (pg_temp.u('f2c4'), pg_temp.u('f2e1'), 'e.pdf', 'application/pdf', 50, null, null, now() - interval '2 days', null, null),
  (pg_temp.u('f2c5'), pg_temp.u('f2e3'), 'g.jpg', 'image/jpeg', 60, 'drive_pat_g_xxxxx', now() - interval '9 days', now() - interval '1 day', null, null),
  (pg_temp.u('f2c6'), pg_temp.u('f2e4'), 'h.jpg', 'image/jpeg', 70, 'drive_pat_h_xxxxx', now() - interval '9 days', now() - interval '1 day', null, null),
  (pg_temp.u('f2c7'), pg_temp.u('f2e5'), 'k.jpg', 'image/jpeg', 80, 'drive_pat_k_xxxxx', now() - interval '9 days', now() - interval '1 day', null, null);
insert into public.page_files (page_id, file_id) values
  (pg_temp.u('f2b0'), pg_temp.u('f2c2')),
  (pg_temp.u('f2b1'), pg_temp.u('f2c4'));
update public.workspaces set deleted_at = now(), deleted_by = pg_temp.u('f2a0') where id = pg_temp.u('f2e4');
update public.workspaces set archived_at = now(), archived_by = pg_temp.u('f2a0') where id = pg_temp.u('f2e5');

do $$
begin
  -- Lo que la prueba supone de los datos: c sigue en uso y los demás, en la papelera.
  assert (select trashed_at is null from public.files where id = pg_temp.u('f2c2')), 'c entró a la papelera';
  assert (select count(*) from public.files where project_id = pg_temp.u('f2e1') and trashed_at is not null) = 4, 'faltan archivos en la papelera de P1';
  perform set_config('test.print', pg_temp.fingerprint(), true);
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- La función: lo que devuelve, cómo corre y quién la ejecuta.
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  f   constant regprocedure := 'public.trashed_files_all()'::regprocedure;
  one constant regprocedure := 'public.trashed_files(uuid)'::regprocedure;
begin
  -- El proyecto adelante y después, en el mismo orden y con los mismos tipos, las columnas de `trashed_files`: si
  -- `trashed_files` suma una columna, esta función la tiene que sumar.
  assert (select a.proargnames[1] = 'project_id' and a.proallargtypes[1] = 'uuid'::regtype
                 and a.proargnames[2:] = o.proargnames[2:] and a.proallargtypes[2:] = o.proallargtypes[2:]
          from pg_proc a, pg_proc o where a.oid = f and o.oid = one),
    'las columnas no son project_id más las de trashed_files';
  assert (select p.prosecdef and p.provolatile = 's' and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = f),
    'no es security definer, stable y con search_path vacío';
  assert has_function_privilege('authenticated', f, 'execute'), 'authenticated no la ejecuta';
  assert not has_function_privilege('anon', f, 'execute'), 'anon la ejecuta';
  assert not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = f and a.grantee = 0), 'PUBLIC la ejecuta';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Cada persona: lo mismo que proyecto por proyecto.
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  who text;
begin
  -- La dueña: P1 (sin lo que está en uso ni lo que ya fue a Drive), P2 vacío y P5 archivado. No el privado de la
  -- admin (P3) ni el borrado (P4).
  perform pg_temp.as_user('f2a0');
  assert pg_temp.all_summary() = 'P1[a.jpg,b.mov,e.pdf] P2[] P5[k.jpg]', format('la dueña recibe %s', pg_temp.all_summary());
  assert pg_temp.differences() = '', format('la dueña: %s', pg_temp.differences());
  -- Nada de un proyecto que no es de la prueba (no ve ninguno más).
  assert (select count(*) from public.trashed_files_all() a where a.project_id not in (select id from pg_temp.projects())) = 0,
    'la dueña recibe proyectos que no ve';
  -- Las columnas llegan con su valor: el peso entero, los días, lo pedido, la página de la papelera y su título.
  assert (select a.size = 5000000000 and a.days_left = 0 and a.purged_at is not null and a.in_trashed_page = false
          from public.trashed_files_all() a where a.id = pg_temp.u('f2c1')), 'b no llega con su peso, sus días y su pedido';
  assert (select a.in_trashed_page and a.trashed_page_title = 'en la papelera' and a.days_left = 28 and a.project_id = pg_temp.u('f2e1')
          from public.trashed_files_all() a where a.id = pg_temp.u('f2c4')), 'e no dice la página de la papelera que lo usa';
  -- La fila de una papelera vacía: solo el proyecto.
  assert (select count(*) = 1 and bool_and(to_jsonb(a) - 'project_id' = jsonb_build_object(
            'id', null, 'name', null, 'mime', null, 'size', null, 'thumb_at', null, 'trashed_at', null, 'days_left', null,
            'purged_at', null, 'in_trashed_page', null, 'trashed_page_title', null, 'in_deleted_project', null))
          from public.trashed_files_all() a where a.project_id = pg_temp.u('f2e2')), 'la fila de la papelera vacía trae algo más que el proyecto';
  -- De a páginas, como la pide la app cuando no entra en un pedido (la API corta a las 1000 filas): con el orden
  -- escrito en el pedido (proyecto; adentro, lo último primero; el id), las páginas juntas dan cada fila una sola vez.
  assert (
    select count(*) = (select count(*) from public.trashed_files_all())
       and count(distinct (pg.project_id, pg.id)) = count(*)
       and not exists (select a.project_id, a.id from public.trashed_files_all() a
                       except select x.project_id, x.id from pg_temp.paged(2) x)
    from pg_temp.paged(2) pg), 'pedida de a páginas no da cada fila una sola vez';
  assert (select array_agg(pg.name order by pg.n) from pg_temp.paged(2) pg where pg.project_id = pg_temp.u('f2e1'))
         = array['e.pdf', 'a.jpg', 'b.mov'], 'adentro de un proyecto las páginas no siguen el orden de trashed_files';

  -- La admin: el suyo (P3) y P1, que ve. No P2 ni P5 (privados de la dueña).
  perform pg_temp.as_user('f2a1');
  assert pg_temp.all_summary() = 'P1[a.jpg,b.mov,e.pdf] P3[g.jpg]', format('la admin recibe %s', pg_temp.all_summary());
  assert pg_temp.differences() = '', format('la admin: %s', pg_temp.differences());

  -- El miembro con Editar y crear páginas sobre P1 y P2.
  perform pg_temp.as_user('f2a3');
  assert pg_temp.all_summary() = 'P1[a.jpg,b.mov,e.pdf] P2[]', format('el miembro con Editar y crear recibe %s', pg_temp.all_summary());
  assert pg_temp.differences() = '', format('el miembro con Editar y crear: %s', pg_temp.differences());

  -- Nada: el admin sin permisos, el miembro con Editar, el invitado con Editar y crear, el miembro sin permisos y la
  -- admin sacada. Ni filas ni la marca de un proyecto.
  foreach who in array array['f2a2', 'f2a4', 'f2a5', 'f2a6', 'f2a7'] loop
    perform pg_temp.as_user(who);
    assert (select count(*) from public.trashed_files_all()) = 0, format('%s recibe algo de una papelera de archivos', who);
    assert pg_temp.differences() = '', format('%s: %s', who, pg_temp.differences());
    perform pg_temp.expect_error(format('select * from public.trashed_files(%L)', pg_temp.u('f2e1')), 'not_allowed',
      format('%s lee la papelera de P1', who));
  end loop;

  -- Con contraseña, la dueña no es miembro de nada; una sesión sin persona, tampoco.
  perform pg_temp.as_user('f2a0', '[{"method": "password"}]');
  assert (select count(*) from public.trashed_files_all()) = 0, 'una sesión con contraseña recibe papeleras';
  perform set_config('request.jwt.claims', '{"role": "authenticated"}', true);
  assert (select count(*) from public.trashed_files_all()) = 0, 'una sesión sin persona recibe papeleras';

  -- anon no la llama.
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  perform pg_temp.expect_error('select * from public.trashed_files_all()', '42501', 'anon llama a la papelera de todos');
  perform pg_temp.as_console();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Lo que cambia: vaciar una papelera, restaurar el proyecto borrado, perder y ganar permisos.
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  assert pg_temp.fingerprint() = current_setting('test.print'), 'llamarla cambió algo';

  -- El archivo de P5 llega a la papelera de Drive: P5 queda vacío (la marca). El borrado vuelve: aparece con el suyo.
  update public.files set purged_at = now(), drive_trashed_at = now() where id = pg_temp.u('f2c7');
  update public.workspaces set deleted_at = null, deleted_by = null where id = pg_temp.u('f2e4');
  perform pg_temp.as_user('f2a0');
  assert pg_temp.all_summary() = 'P1[a.jpg,b.mov,e.pdf] P2[] P4[h.jpg] P5[]', format('después de los cambios la dueña recibe %s', pg_temp.all_summary());
  assert pg_temp.differences() = '', format('después de los cambios, la dueña: %s', pg_temp.differences());
  perform pg_temp.as_console();

  -- El invitado pasa a miembro: con Editar y crear sobre P1, la ve. El miembro pierde P2 y baja a Editar en P1: nada.
  update public.members set role = 'member' where user_id = pg_temp.u('f2a5');
  update public.grants set revoked_at = now() where user_id = pg_temp.u('f2a3') and project_id = pg_temp.u('f2e2');
  update public.grants set level = 'edit' where user_id = pg_temp.u('f2a3') and project_id = pg_temp.u('f2e1');
  perform pg_temp.as_user('f2a5');
  assert pg_temp.all_summary() = 'P1[a.jpg,b.mov,e.pdf]', format('el que pasó a miembro recibe %s', pg_temp.all_summary());
  assert pg_temp.differences() = '', format('el que pasó a miembro: %s', pg_temp.differences());
  perform pg_temp.as_user('f2a3');
  assert (select count(*) from public.trashed_files_all()) = 0, 'quien bajó a Editar sigue recibiendo papeleras';
  assert pg_temp.differences() = '', format('quien bajó a Editar: %s', pg_temp.differences());
  perform pg_temp.as_console();
end;
$$;

rollback;

select 'ok' as result;
