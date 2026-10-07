-- Pruebas de la papelera de archivos pedida de a páginas por clave (20261110120000_papelera_archivos_por_clave.sql):
-- `trashed_files_page`, recorrida página por página desde la última fila recibida, da a cada persona exactamente las
-- filas de `trashed_files_all()` (y, con un proyecto, las de `trashed_files`), cada una una sola vez y en su orden, con
-- cualquier tamaño de página y aunque la API le recorte cada página; termina con la fila sin proyecto; lo que cambia
-- entre dos páginas no corre ni saltea las demás filas; y `trashed_files` sigue dando lo mismo que antes. Corre dentro
-- de una transacción que se deshace al final: no deja usuarios ni datos. Si todo pasa, devuelve una fila con
-- result = 'ok'.

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

-- La lista entera como la junta la app: pide de a `page_rows` filas desde la última que recibió, con el orden escrito
-- en el pedido, y corta con la fila sin proyecto o con una página vacía. `keep`: la API le entrega solo las primeras
-- tantas filas de cada página (un tope de filas por pedido menor que la página). `n`: el orden de llegada. Falla si
-- una página trae más filas que las pedidas, o si hacen falta más pedidos de los que podría necesitar.
create function pg_temp.walk(page_rows int, keep int default null, only_project uuid default null)
returns table (n bigint, project_id uuid, id uuid, name text, row_json jsonb) language plpgsql as $$
declare
  r     record;
  at    bigint := 0;
  got   int;
  pages int := 0;
  ended boolean := false;
  ap    uuid;
  at_ts timestamptz;
  ai    uuid;
begin
  loop
    pages := pages + 1;
    if pages > 500 then
      raise exception 'FALLA: la lista no termina';
    end if;
    got := 0;
    for r in
      select q.project_id as pid, q.id as fid, q.name as fname, q.trashed_at as ftrashed, to_jsonb(q) as j,
             count(*) over () as total
      from (select a.* from public.trashed_files_page(only_project, ap, at_ts, ai, page_rows) a
            order by a.project_id asc nulls last, a.trashed_at desc nulls last, a.id asc
            limit keep) q
    loop
      if r.total > greatest(least(coalesce(page_rows, 1000), 1000), 1) then
        raise exception 'FALLA: una página trae % filas y se pidieron %', r.total, page_rows;
      end if;
      got := got + 1;
      if r.pid is null then
        ended := true;
        exit;
      end if;
      at := at + 1;
      n := at; project_id := r.pid; id := r.fid; name := r.fname; row_json := r.j;
      return next;
      ap := r.pid; at_ts := r.ftrashed; ai := r.fid;
    end loop;
    exit when ended or got = 0;
  end loop;
end;
$$;

-- Lo que da `trashed_files_all()` a la sesión, en el orden de las páginas: la referencia.
create function pg_temp.reference() returns jsonb language sql as $$
  select coalesce(jsonb_agg(to_jsonb(a) order by a.project_id, a.trashed_at desc nulls last, a.id), '[]'::jsonb)
  from public.trashed_files_all() a;
$$;

create function pg_temp.walked(page_rows int, keep int default null, only_project uuid default null) returns jsonb language sql as $$
  select coalesce(jsonb_agg(w.row_json order by w.n), '[]'::jsonb) from pg_temp.walk(page_rows, keep, only_project) w;
$$;

create function pg_temp.project_name(p uuid) returns text language sql security definer as $$
  select w.name from public.workspaces w where w.id = p;
$$;

-- "P1[e.pdf,a.jpg,…] P2[] …" en el orden de llegada (`[]`: la ve y está vacía).
create function pg_temp.summary(page_rows int, keep int default null, only_project uuid default null) returns text language sql as $$
  select coalesce(string_agg(format('%s[%s]', q.pname, q.files), ' ' order by q.first), '')
  from (
    select pg_temp.project_name(w.project_id) as pname, min(w.n) as first,
           coalesce(string_agg(w.name, ',' order by w.n) filter (where w.id is not null), '') as files
    from pg_temp.walk(page_rows, keep, only_project) w
    group by w.project_id) q;
$$;

-- La huella de lo que las funciones leen: no pueden cambiar nada.
create function pg_temp.fingerprint() returns text language sql security definer as $$
  select md5(coalesce((select string_agg(f::text, '|' order by f.id) from public.files f
                       where f.project_id in (select w.id from public.workspaces w where w.name like 'ppc-%')), '')
             || '#' || coalesce((select string_agg(pf::text, '|' order by pf.page_id, pf.file_id) from public.page_files pf
                                 join public.files f on f.id = pf.file_id
                                 where f.project_id in (select w.id from public.workspaces w where w.name like 'ppc-%')), ''));
$$;

-- ---------------------------------------------------------------------------------------------------
-- Datos
-- ---------------------------------------------------------------------------------------------------
-- Personas: o (dueña del workspace; creó P1, P2, P4, P5 y P6), ad (admin; creó P3, privado, y tiene Ver sobre P1), m4
-- (miembro, Editar y crear sobre P1 y P2), me (miembro, Editar sobre P1), g (invitado, Editar y crear sobre P1), x
-- (miembro sin permisos).
update public.members set removed_at = now() where role = 'owner' and removed_at is null;
update public.workspace_settings set min_app_version = null where id;
insert into auth.users (id, email, aud, role) values
  (pg_temp.u('f3a0'), 'ppc-o@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('f3a1'), 'ppc-ad@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('f3a3'), 'ppc-m4@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('f3a4'), 'ppc-me@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('f3a5'), 'ppc-g@test.invalid', 'authenticated', 'authenticated'),
  (pg_temp.u('f3a6'), 'ppc-x@test.invalid', 'authenticated', 'authenticated');
update public.workspace_settings set owner_id = pg_temp.u('f3a0') where id;
insert into public.members (user_id, role, removed_at) values
  (pg_temp.u('f3a0'), 'owner', null), (pg_temp.u('f3a1'), 'admin', null), (pg_temp.u('f3a3'), 'member', null),
  (pg_temp.u('f3a4'), 'member', null), (pg_temp.u('f3a5'), 'guest', null), (pg_temp.u('f3a6'), 'member', null);
-- P1: con archivos (dos con la misma hora). P2: sin archivos. P3: privado de la admin. P4: borrado. P5: archivado.
-- P6: con archivos, el último por id.
insert into public.workspaces (id, owner_id, name) values
  (pg_temp.u('f3e1'), pg_temp.u('f3a0'), 'ppc-P1'),
  (pg_temp.u('f3e2'), pg_temp.u('f3a0'), 'ppc-P2'),
  (pg_temp.u('f3e3'), pg_temp.u('f3a1'), 'ppc-P3'),
  (pg_temp.u('f3e4'), pg_temp.u('f3a0'), 'ppc-P4'),
  (pg_temp.u('f3e5'), pg_temp.u('f3a0'), 'ppc-P5'),
  (pg_temp.u('f3e6'), pg_temp.u('f3a0'), 'ppc-P6');
insert into public.pages (id, workspace_id, parent_id, title, sort_key) values
  (pg_temp.u('f3b0'), pg_temp.u('f3e1'), null, 'viva', 'a0'),
  (pg_temp.u('f3b1'), pg_temp.u('f3e1'), null, 'en la papelera', 'a1');
update public.pages set deleted_at = now() where id = pg_temp.u('f3b1');
insert into public.grants (user_id, project_id, page_id, level) values
  (pg_temp.u('f3a1'), pg_temp.u('f3e1'), null, 'view'),
  (pg_temp.u('f3a3'), pg_temp.u('f3e1'), null, 'edit_pages'),
  (pg_temp.u('f3a3'), pg_temp.u('f3e2'), null, 'edit_pages'),
  (pg_temp.u('f3a4'), pg_temp.u('f3e1'), null, 'edit'),
  (pg_temp.u('f3a5'), pg_temp.u('f3e1'), null, 'edit_pages');
-- P1, de lo último a lo primero: e (lo usa una página de la papelera), a, s1 y s2 (misma hora: desempata el id), b
-- (pedido a Drive). c sigue en uso y d ya llegó a la papelera de Drive: no se listan. P3: g. P4: h. P5: k. P6: m, n.
insert into public.files (id, project_id, name, mime, size, drive_id, uploaded_at, trashed_at, purged_at, drive_trashed_at) values
  (pg_temp.u('f3c0'), pg_temp.u('f3e1'), 'a.jpg', 'image/jpeg', 1000, 'drive_ppc_a_xxxxx', now() - interval '9 days', now() - interval '3 days', null, null),
  (pg_temp.u('f3c1'), pg_temp.u('f3e1'), 'b.mov', 'video/quicktime', 5000000000, 'drive_ppc_b_xxxxx', now() - interval '9 days', now() - interval '40 days', now() - interval '1 day', null),
  (pg_temp.u('f3c2'), pg_temp.u('f3e1'), 'c.jpg', 'image/jpeg', 30, 'drive_ppc_c_xxxxx', now() - interval '9 days', null, null, null),
  (pg_temp.u('f3c3'), pg_temp.u('f3e1'), 'd.jpg', 'image/jpeg', 40, 'drive_ppc_d_xxxxx', now() - interval '9 days', now() - interval '5 days', now() - interval '4 days', now() - interval '4 days'),
  (pg_temp.u('f3c4'), pg_temp.u('f3e1'), 'e.pdf', 'application/pdf', 50, null, null, now() - interval '2 days', null, null),
  (pg_temp.u('f3c8'), pg_temp.u('f3e1'), 's1.jpg', 'image/jpeg', 51, 'drive_ppc_s1_xxxx', now() - interval '9 days', now() - interval '6 days', null, null),
  (pg_temp.u('f3c9'), pg_temp.u('f3e1'), 's2.jpg', 'image/jpeg', 52, 'drive_ppc_s2_xxxx', now() - interval '9 days', now() - interval '6 days', null, null),
  (pg_temp.u('f3c5'), pg_temp.u('f3e3'), 'g.jpg', 'image/jpeg', 60, 'drive_ppc_g_xxxxx', now() - interval '9 days', now() - interval '1 day', null, null),
  (pg_temp.u('f3c6'), pg_temp.u('f3e4'), 'h.jpg', 'image/jpeg', 70, 'drive_ppc_h_xxxxx', now() - interval '9 days', now() - interval '1 day', null, null),
  (pg_temp.u('f3c7'), pg_temp.u('f3e5'), 'k.jpg', 'image/jpeg', 80, 'drive_ppc_k_xxxxx', now() - interval '9 days', now() - interval '1 day', null, null),
  (pg_temp.u('f3ca'), pg_temp.u('f3e6'), 'm.jpg', 'image/jpeg', 90, 'drive_ppc_m_xxxxx', now() - interval '9 days', now() - interval '1 day', null, null),
  (pg_temp.u('f3cb'), pg_temp.u('f3e6'), 'n.jpg', 'image/jpeg', 91, 'drive_ppc_n_xxxxx', now() - interval '9 days', now() - interval '2 days', null, null);
insert into public.page_files (page_id, file_id) values
  (pg_temp.u('f3b0'), pg_temp.u('f3c2')),
  (pg_temp.u('f3b1'), pg_temp.u('f3c4'));
update public.workspaces set deleted_at = now(), deleted_by = pg_temp.u('f3a0') where id = pg_temp.u('f3e4');
update public.workspaces set archived_at = now(), archived_by = pg_temp.u('f3a0') where id = pg_temp.u('f3e5');

do $$
begin
  -- Lo que la prueba supone de los datos: c sigue en uso y los demás de P1, en la papelera.
  assert (select trashed_at is null from public.files where id = pg_temp.u('f3c2')), 'c entró a la papelera';
  assert (select count(*) from public.files where project_id = pg_temp.u('f3e1') and trashed_at is not null) = 6, 'faltan archivos en la papelera de P1';
  perform set_config('test.print', pg_temp.fingerprint(), true);
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Las funciones: lo que devuelven, cómo corren y quién las ejecuta.
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  f    constant regprocedure := 'public.trashed_files_page(uuid, uuid, timestamptz, uuid, int)'::regprocedure;
  rows constant regprocedure := 'private.trashed_files_rows(uuid, timestamptz, uuid, int)'::regprocedure;
  one  constant regprocedure := 'public.trashed_files(uuid)'::regprocedure;
  every constant regprocedure := 'public.trashed_files_all()'::regprocedure;
begin
  -- Las columnas de `trashed_files_all()`, en el mismo orden y con los mismos tipos (las de `trashed_files` con el
  -- proyecto adelante): si `trashed_files` suma una columna, las tres la tienen que sumar.
  assert (select a.proargnames[6:] = e.proargnames and a.proallargtypes[6:] = e.proallargtypes
                 and a.proargnames[1:5] = array['p_project', 'p_after_project', 'p_after_trashed_at', 'p_after_id', 'p_limit']
                 and a.pronargdefaults = 5
          from pg_proc a, pg_proc e where a.oid = f and e.oid = every),
    'las columnas no son las de trashed_files_all, o cambiaron los argumentos';
  assert (select r.proargnames[5:] = o.proargnames[2:] and r.proallargtypes[5:] = o.proallargtypes[2:]
          from pg_proc r, pg_proc o where r.oid = rows and o.oid = one),
    'private.trashed_files_rows no devuelve las columnas de trashed_files';
  assert (select count(*) = 3 from pg_proc p
          where p.oid in (f, rows, one) and p.prosecdef and p.provolatile = 's' and p.proconfig @> array['search_path=""']),
    'alguna no es security definer, stable y con search_path vacío';
  assert has_function_privilege('authenticated', f, 'execute'), 'authenticated no ejecuta trashed_files_page';
  assert has_function_privilege('authenticated', one, 'execute'), 'authenticated no ejecuta trashed_files';
  assert not has_function_privilege('anon', f, 'execute') and not has_function_privilege('anon', one, 'execute'), 'anon las ejecuta';
  assert not has_function_privilege('authenticated', rows, 'execute') and not has_function_privilege('anon', rows, 'execute'),
    'alguien ejecuta la consulta sin permisos';
  assert not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid in (f, rows, one) and a.grantee = 0), 'PUBLIC las ejecuta';
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Cada persona: lo mismo que `trashed_files_all()`, con cualquier tamaño de página.
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  who   text;
  ref   jsonb;
  size  int;
  cut   int;
  p     uuid;
  one   jsonb;
begin
  -- La dueña: P1 (sin lo que está en uso ni lo que ya fue a Drive), P2 vacío, P5 archivado y P6. No el privado de la
  -- admin (P3) ni el borrado (P4). Adentro de cada proyecto, lo último primero; con la misma hora, por id.
  perform pg_temp.as_user('f3a0');
  assert pg_temp.summary(1000) = 'ppc-P1[e.pdf,a.jpg,s1.jpg,s2.jpg,b.mov] ppc-P2[] ppc-P5[k.jpg] ppc-P6[m.jpg,n.jpg]',
    format('la dueña recibe %s', pg_temp.summary(1000));
  -- `trashed_files`, la de un proyecto, en el orden en que salen las filas (sin ordenarlas acá): lo último primero y,
  -- con la misma hora (s1 y s2), por id.
  assert (select array_agg(t.name order by t.n) from public.trashed_files(pg_temp.u('f3e1')) with ordinality
            as t (id, name, mime, size, thumb_at, trashed_at, days_left, purged_at, in_trashed_page, trashed_page_title, in_deleted_project, n))
         = array['e.pdf', 'a.jpg', 's1.jpg', 's2.jpg', 'b.mov'],
    format('trashed_files da P1 en otro orden: %s', (select array_agg(t.name order by t.n) from public.trashed_files(pg_temp.u('f3e1')) with ordinality
            as t (id, name, mime, size, thumb_at, trashed_at, days_left, purged_at, in_trashed_page, trashed_page_title, in_deleted_project, n)));
  -- Entra en una página: un solo pedido, que trae la fila del final (sin proyecto, todo nulo) después de las demás.
  assert (select count(*) = 10 and count(*) filter (where a.project_id is null) = 1
                 and bool_and(to_jsonb(a) = jsonb_build_object('project_id', null, 'id', null, 'name', null, 'mime', null,
                   'size', null, 'thumb_at', null, 'trashed_at', null, 'days_left', null, 'purged_at', null,
                   'in_trashed_page', null, 'trashed_page_title', null, 'in_deleted_project', null)) filter (where a.project_id is null)
          from public.trashed_files_page() a), 'entera no trae sus 9 filas y la del final';
  -- Las columnas llegan con su valor (como en `trashed_files_all()`).
  assert (select a.size = 5000000000 and a.days_left = 0 and a.purged_at is not null and a.in_trashed_page = false
          from public.trashed_files_page() a where a.id = pg_temp.u('f3c1')), 'b no llega con su peso, sus días y su pedido';
  assert (select a.in_trashed_page and a.trashed_page_title = 'en la papelera' and a.days_left = 28
          from public.trashed_files_page() a where a.id = pg_temp.u('f3c4')), 'e no dice la página de la papelera que lo usa';

  foreach who in array array['f3a0', 'f3a1', 'f3a3', 'f3a4', 'f3a5', 'f3a6'] loop
    perform pg_temp.as_user(who);
    ref := pg_temp.reference();
    -- De a 1, 2, 3, 4, 5, 9 (justo las de la dueña), 1000 y sin decir cuántas: siempre lo mismo, cada fila una vez.
    foreach size in array array[1, 2, 3, 4, 5, 9, 1000, null] loop
      assert pg_temp.walked(size) = ref, format('%s, de a %s: %s en vez de %s', who, size, pg_temp.walked(size), ref);
    end loop;
    -- La API recorta cada página (un tope de filas por pedido menor que lo pedido): igual llega todo.
    foreach cut in array array[1, 2, 3, 7] loop
      assert pg_temp.walked(1000, cut) = ref, format('%s, con páginas recortadas a %s: %s en vez de %s', who, cut, pg_temp.walked(1000, cut), ref);
      assert pg_temp.walked(5, cut) = ref, format('%s, de a 5 recortadas a %s', who, cut);
    end loop;
    -- Un proyecto solo: lo que da `trashed_files` (más la fila de la papelera vacía); nada donde responde
    -- `not_allowed`, ni del borrado.
    foreach p in array array[pg_temp.u('f3e1'), pg_temp.u('f3e2'), pg_temp.u('f3e3'), pg_temp.u('f3e4'), pg_temp.u('f3e5'), pg_temp.u('f3e6')] loop
      begin
        select coalesce(jsonb_agg(jsonb_build_object('project_id', p) || to_jsonb(t) order by t.trashed_at desc, t.id),
                        jsonb_build_array(jsonb_build_object('project_id', p, 'id', null, 'name', null, 'mime', null, 'size', null,
                          'thumb_at', null, 'trashed_at', null, 'days_left', null, 'purged_at', null, 'in_trashed_page', null,
                          'trashed_page_title', null, 'in_deleted_project', null)))
          into one from public.trashed_files(p) t;
      exception when insufficient_privilege then
        one := '[]'::jsonb;
      end;
      foreach size in array array[1, 2, 1000] loop
        assert pg_temp.walked(size, null, p) = one, format('%s, el proyecto %s de a %s: %s en vez de %s', who, p, size, pg_temp.walked(size, null, p), one);
      end loop;
      assert pg_temp.walked(1000, 2, p) = one, format('%s, el proyecto %s con páginas recortadas', who, p);
    end loop;
  end loop;

  -- Quién recibe qué (la regla de `trashed_files`): la admin, el suyo y P1; el miembro con Editar y crear, P1 y P2;
  -- nada el miembro con Editar, el invitado con Editar y crear ni el miembro sin permisos (solo la fila del final).
  perform pg_temp.as_user('f3a1');
  assert pg_temp.summary(2) = 'ppc-P1[e.pdf,a.jpg,s1.jpg,s2.jpg,b.mov] ppc-P3[g.jpg]', format('la admin recibe %s', pg_temp.summary(2));
  perform pg_temp.as_user('f3a3');
  assert pg_temp.summary(2) = 'ppc-P1[e.pdf,a.jpg,s1.jpg,s2.jpg,b.mov] ppc-P2[]', format('el miembro con Editar y crear recibe %s', pg_temp.summary(2));
  foreach who in array array['f3a4', 'f3a5', 'f3a6'] loop
    perform pg_temp.as_user(who);
    assert (select count(*) = 1 and bool_and(a.project_id is null) from public.trashed_files_page() a), format('%s recibe algo de una papelera de archivos', who);
    assert (select count(*) = 1 and bool_and(a.project_id is null) from public.trashed_files_page(pg_temp.u('f3e1')) a), format('%s recibe algo de P1', who);
    perform pg_temp.expect_error(format('select * from public.trashed_files(%L)', pg_temp.u('f3e1')), 'not_allowed', format('%s lee la papelera de P1', who));
  end loop;

  -- Con contraseña, la dueña no es miembro de nada; una sesión sin persona, tampoco.
  perform pg_temp.as_user('f3a0', '[{"method": "password"}]');
  assert (select count(*) = 1 and bool_and(a.project_id is null) from public.trashed_files_page() a), 'una sesión con contraseña recibe papeleras';
  perform set_config('request.jwt.claims', '{"role": "authenticated"}', true);
  assert (select count(*) = 1 and bool_and(a.project_id is null) from public.trashed_files_page() a), 'una sesión sin persona recibe papeleras';

  -- anon no la llama, ni la consulta sin permisos.
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  perform pg_temp.expect_error('select * from public.trashed_files_page()', '42501', 'anon llama a la papelera de a páginas');
  perform pg_temp.expect_error(format('select * from private.trashed_files_rows(%L, null, null, null)', pg_temp.u('f3e1')), '42501', 'anon llama a la consulta sin permisos');
  perform pg_temp.as_user('f3a0');
  perform pg_temp.expect_error(format('select * from private.trashed_files_rows(%L, null, null, null)', pg_temp.u('f3e3')), '42501', 'una sesión llama a la consulta sin permisos');
  perform pg_temp.as_console();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- La página: cuántas filas trae, desde dónde sigue y qué no acepta.
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  a_at timestamptz;
  s_at timestamptz;
  n_at timestamptz;
begin
  perform pg_temp.as_user('f3a0');
  select trashed_at into a_at from public.trashed_files_page() where id = pg_temp.u('f3c0');
  select trashed_at into s_at from public.trashed_files_page() where id = pg_temp.u('f3c8');
  select trashed_at into n_at from public.trashed_files_page() where id = pg_temp.u('f3cb');
  -- Una página llena no trae la fila del final (puede haber más); la que agota la lista, sí.
  assert (select count(*) = 3 and count(*) filter (where p.project_id is null) = 0 from public.trashed_files_page(p_limit => 3) p), 'una página llena no trae 3 filas de archivos';
  assert (select array_agg(p.name order by p.trashed_at desc, p.id) = array['s1.jpg', 's2.jpg', 'b.mov']
          from public.trashed_files_page(null, pg_temp.u('f3e1'), a_at, pg_temp.u('f3c0'), 3) p), 'después de a no siguen s1, s2 y b';
  -- Con la misma hora, sigue por id: después de s1 viene s2 y no se repite s1.
  assert (select array_agg(p.name order by p.trashed_at desc, p.id) = array['s2.jpg', 'b.mov']
          from public.trashed_files_page(null, pg_temp.u('f3e1'), s_at, pg_temp.u('f3c8'), 2) p), 'con la misma hora no sigue por el id';
  -- Después de la fila de una papelera vacía sigue el proyecto siguiente, sin repetirla.
  assert (select array_agg(coalesce(p.name, '-') order by p.project_id nulls last, p.trashed_at desc nulls last) = array['k.jpg', 'm.jpg', 'n.jpg', '-']
          from public.trashed_files_page(null, pg_temp.u('f3e2'), null, null, 1000) p), 'después de la papelera vacía no siguen P5 y P6';
  -- Después de la última fila de todas: solo la del final. Y después de un proyecto que no existe o que no ve, lo que
  -- sigue por id (el lugar es solo un lugar: no da ni quita permisos).
  assert (select count(*) = 1 and bool_and(p.project_id is null)
          from public.trashed_files_page(null, pg_temp.u('f3e6'), n_at, pg_temp.u('f3cb'), 1000) p),
    'después de la última fila llega algo más que la del final';
  assert (select array_agg(p.name order by p.name) = array['k.jpg', 'm.jpg', 'n.jpg']
          from public.trashed_files_page(null, pg_temp.u('f3e3'), null, null, 1000) p where p.id is not null), 'después de un proyecto que no ve no sigue con los que ve';
  -- Cuántas: entre 1 y 1000; 0, un negativo o nulo no rompen (1, 1 y 1000), y más de 1000 son 1000.
  assert (select count(*) = 1 from public.trashed_files_page(p_limit => 0)), 'con 0 no trae una fila';
  assert (select count(*) = 1 from public.trashed_files_page(p_limit => -5)), 'con un negativo no trae una fila';
  assert (select count(*) = 10 from public.trashed_files_page(p_limit => null)), 'con nulo no trae todo';
  assert (select count(*) = 10 from public.trashed_files_page(p_limit => 100000)), 'con más de 1000 no trae todo';
  -- Un lugar a medias (la hora sin el id, el id sin la hora, un archivo sin proyecto) no se acepta.
  perform pg_temp.expect_error(format('select * from public.trashed_files_page(null, %L, now(), null, 10)', pg_temp.u('f3e1')), 'after_invalid', 'acepta la hora sin el id');
  perform pg_temp.expect_error(format('select * from public.trashed_files_page(null, %L, null, %L, 10)', pg_temp.u('f3e1'), pg_temp.u('f3c0')), 'after_invalid', 'acepta el id sin la hora');
  perform pg_temp.expect_error(format('select * from public.trashed_files_page(null, null, now(), %L, 10)', pg_temp.u('f3c0')), 'after_invalid', 'acepta un archivo sin proyecto');
  perform pg_temp.as_console();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Lo que cambia entre dos páginas no corre ni saltea las demás filas.
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  first_names text[];
  rest_names  text[];
  last_row    record;
begin
  assert pg_temp.fingerprint() = current_setting('test.print'), 'pedirla cambió algo';

  -- La dueña pide de a 2: llegan e y a.
  perform pg_temp.as_user('f3a0');
  select array_agg(p.name order by p.trashed_at desc, p.id) into first_names from public.trashed_files_page(p_limit => 2) p;
  assert first_names = array['e.pdf', 'a.jpg'], format('la primera página trae %s', first_names);
  select p.project_id, p.trashed_at, p.id into last_row from public.trashed_files_page(p_limit => 2) p where p.id = pg_temp.u('f3c0');
  perform pg_temp.as_console();
  -- Antes de la segunda: e (ya recibido) llega a la papelera de Drive y sale de la lista, entra uno nuevo a P1 (lo
  -- último: iría primero) y P2 deja de estar vacío. Pedida por tramos, lo que sigue se correría un lugar.
  update public.files set purged_at = now(), drive_trashed_at = now() where id = pg_temp.u('f3c4');
  insert into public.files (id, project_id, name, mime, size, drive_id, uploaded_at, trashed_at) values
    (pg_temp.u('f3cc'), pg_temp.u('f3e1'), 'nuevo.jpg', 'image/jpeg', 1, 'drive_ppc_nv_xxxx', now() - interval '9 days', now()),
    (pg_temp.u('f3cd'), pg_temp.u('f3e2'), 'p2.jpg', 'image/jpeg', 2, 'drive_ppc_p2_xxxx', now() - interval '9 days', now());
  perform pg_temp.as_user('f3a0');
  select array_agg(coalesce(p.name, '(fin)') order by p.project_id nulls last, p.trashed_at desc nulls last, p.id) into rest_names
  from public.trashed_files_page(null, last_row.project_id, last_row.trashed_at, last_row.id, 1000) p;
  assert rest_names = array['s1.jpg', 's2.jpg', 'b.mov', 'p2.jpg', 'k.jpg', 'm.jpg', 'n.jpg', '(fin)'],
    format('después del cambio, lo que sigue es %s', rest_names);
  perform pg_temp.as_console();

  -- Entre dos páginas la dueña deja de ver P5 (pasa a ser de la admin, privado): P6 llega entero igual.
  perform pg_temp.as_user('f3a0');
  select p.project_id, p.trashed_at, p.id into last_row
  from public.trashed_files_page(null, pg_temp.u('f3e2'), null, null, 1) p;
  assert last_row.project_id = pg_temp.u('f3e5') and last_row.id = pg_temp.u('f3c7'), 'después de P2 no sigue k, de P5';
  perform pg_temp.as_console();
  update public.workspaces set owner_id = pg_temp.u('f3a1') where id = pg_temp.u('f3e5');
  perform pg_temp.as_user('f3a0');
  select array_agg(coalesce(p.name, '(fin)') order by p.project_id nulls last, p.trashed_at desc nulls last, p.id) into rest_names
  from public.trashed_files_page(null, last_row.project_id, last_row.trashed_at, last_row.id, 1000) p;
  assert rest_names = array['m.jpg', 'n.jpg', '(fin)'], format('después de perder P5, lo que sigue es %s', rest_names);
  -- Y la lista entera, de a páginas, sigue siendo la de `trashed_files_all()`.
  assert pg_temp.walked(2) = pg_temp.reference(), 'después de los cambios, de a 2 no da lo de trashed_files_all';
  assert pg_temp.summary(3) = 'ppc-P1[nuevo.jpg,a.jpg,s1.jpg,s2.jpg,b.mov] ppc-P2[p2.jpg] ppc-P6[m.jpg,n.jpg]', format('después de los cambios la dueña recibe %s', pg_temp.summary(3));
  perform pg_temp.as_console();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- El tope de una página: 1000 filas, se pidan las que se pidan.
-- ---------------------------------------------------------------------------------------------------
-- Un proyecto de la dueña con 1001 archivos en la papelera.
insert into public.workspaces (id, owner_id, name) values (pg_temp.u('f3e7'), pg_temp.u('f3a0'), 'ppc-P7');
insert into public.files (id, project_id, name, mime, size, drive_id, uploaded_at, trashed_at)
  select ('00000000-0000-4000-8001-' || lpad(k::text, 12, '0'))::uuid, pg_temp.u('f3e7'), 'g' || k || '.jpg', 'image/jpeg', 1,
         'drive_ppc_big_' || lpad(k::text, 5, '0'), now() - interval '9 days', now() - make_interval(secs => k)
  from generate_series(1, 1001) k;

do $$
declare
  last_row record;
begin
  perform pg_temp.as_user('f3a0');
  -- Con más de 1000 pedidas, o sin decir cuántas: 1000 justas, todas archivos (la página está llena: sin la fila del
  -- final), y la que sigue trae el que faltaba y la fila del final.
  assert (select count(*) = 1000 and count(*) filter (where p.id is null) = 0 from public.trashed_files_page(pg_temp.u('f3e7'), p_limit => 100000) p),
    'con más de 1000 pedidas la página no trae 1000 archivos';
  assert (select count(*) = 1000 from public.trashed_files_page(pg_temp.u('f3e7'), p_limit => null) p), 'sin decir cuántas la página no trae 1000 filas';
  assert (select count(*) = 1000 from public.trashed_files_page(pg_temp.u('f3e7'), p_limit => 1001) p), 'con 1001 pedidas la página no trae 1000 filas';
  select p.project_id, p.trashed_at, p.id into last_row from public.trashed_files_page(pg_temp.u('f3e7'), p_limit => 100000) p
  order by p.trashed_at asc, p.id desc limit 1;
  assert (select count(*) = 2 and count(*) filter (where p.name = 'g1001.jpg') = 1 and count(*) filter (where p.project_id is null) = 1
          from public.trashed_files_page(pg_temp.u('f3e7'), last_row.project_id, last_row.trashed_at, last_row.id, 100000) p),
    'después de las 1000 no llegan el archivo que faltaba y la fila del final';
  -- `trashed_files`, que no pagina, sigue dando las 1001 (el corte ahí lo pone la API, no la base).
  assert (select count(*) = 1001 from public.trashed_files(pg_temp.u('f3e7'))), 'trashed_files no da los 1001';
  perform pg_temp.as_console();
end;
$$;

rollback;

select 'ok' as result;
