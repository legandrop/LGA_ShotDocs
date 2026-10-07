-- LGA Shot Docs · la papelera de archivos pedida de a páginas por clave (Docs/Doc_Proyectos_Borrar.md, "La papelera de
-- archivos, de a páginas por clave"; Docs/Plan_Workspaces.md, paso 11).
--
-- `trashed_files_all()` devuelve todo y la app la pedía de a tramos (`limit` y `offset` sobre el resultado): cada tramo
-- corría la función entera, un cambio entre dos tramos corría las filas un lugar (podía faltar un archivo, o un
-- proyecto verse como sin acceso), y la app daba por última una página con menos de 1000 filas, que con un tope de
-- filas por pedido menor a 1000 (un workspace con su propio Supabase) cortaba la lista sin aviso. `trashed_files`, la
-- de un proyecto, tiene el mismo corte en el tope de filas.
--
-- `trashed_files_page` recibe **desde dónde seguir** (la última fila que la app ya tiene: proyecto, `trashed_at`, id) y
-- **cuántas filas** quiere, y trabaja solo por esa página:
--
--   - El orden es fijo: por proyecto (id) y, adentro, como `trashed_files` (lo último primero, después el id).
--   - Las filas son las de `trashed_files_all()`: `project_id` adelante y las columnas de `trashed_files`; de un
--     proyecto cuya papelera la sesión ve y está vacía, una fila con solo `project_id`; de uno que no ve, borrado o
--     inexistente, nada.
--   - Cuando no queda nada más, agrega **una fila sin proyecto** (todo nulo): la lista terminó. La app corta solo ahí
--     (o con una página vacía), nunca por haber recibido pocas filas: si la API le recorta la página, esa fila no
--     llega y la app sigue pidiendo desde la última que recibió.
--   - `p_project`: solo ese proyecto (lo que `trashed_files` da de una vez, sin el corte del tope de filas). Si la
--     sesión no ve su papelera no hay ninguna fila antes de la del final; `trashed_files` responde ahí `not_allowed`.
--
-- Para no escribir dos veces la consulta de la papelera, pasa a `private.trashed_files_rows` (la misma, más desde
-- dónde y cuántas) y `trashed_files` la llama entera: las tres funciones dan siempre las mismas filas.
--
-- Permisos: ninguno nuevo. Cada proyecto pasa por `private.can_see_file_trash`, la regla de `trashed_files`: quien
-- recibe una fila por acá la recibe por allá. Solo lee (`stable`). `security definer` como `trashed_files`, que lee
-- tablas que la sesión no lee enteras. `anon` no la ejecuta, y `private.trashed_files_rows` (que no mira permisos) no
-- la ejecuta nadie más que las funciones de la base.
--
-- Compatible con la app publicada: `trashed_files` y `trashed_files_all()` conservan la firma, el resultado, el orden,
-- los errores y los permisos. No sube `schema_version`: la app nueva prueba `trashed_files_page` y, si la base no la
-- tiene, pide como antes.

-- Las filas de la papelera de archivos de un proyecto, sin mirar permisos (lo hace quien la llama): lo que no llegó a
-- la papelera de Drive, lo último primero. `p_after_trashed_at` y `p_after_id`: solo lo que sigue a esa fila.
-- `p_limit`: cuántas como mucho (nulo: todas). La consulta es la de `trashed_files`
-- (20261101120000_proyectos_purgar.sql), con el corte antes de buscar la página de la papelera de cada archivo.
create or replace function private.trashed_files_rows(p_project uuid, p_after_trashed_at timestamptz, p_after_id uuid, p_limit int)
returns table (id uuid, name text, mime text, size bigint, thumb_at timestamptz, trashed_at timestamptz,
               days_left int, purged_at timestamptz, in_trashed_page boolean, trashed_page_title text,
               in_deleted_project boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  return query
    select f.id, f.name, f.mime, f.size, f.thumb_at, f.trashed_at,
           greatest(0, ceil(extract(epoch from (f.trashed_at + interval '30 days' - now())) / 86400))::int,
           f.purged_at, tp.id is not null, tp.title, private.file_in_deleted_project(f.id)
    from (
      select fl.id, fl.name, fl.mime, fl.size, fl.thumb_at, fl.trashed_at, fl.purged_at
      from public.files fl
      where fl.project_id = p_project and fl.trashed_at is not null and fl.drive_trashed_at is null
        and (p_after_trashed_at is null
             or fl.trashed_at < p_after_trashed_at
             or (fl.trashed_at = p_after_trashed_at and fl.id > p_after_id))
      order by fl.trashed_at desc, fl.id
      limit p_limit
    ) f
    left join lateral (
      -- El título solo si la sesión ve esa página (puede ser de otro proyecto): si no, null.
      select pg.id, case when private.page_level(pg.id) >= 1 then pg.title end as title
      from public.page_files pf
      join public.pages pg on pg.id = pf.page_id
      join public.workspaces pw on pw.id = pg.workspace_id
      where pf.file_id = f.id and pf.removed_at is null and pw.purged_at is null and not private.page_alive(pf.page_id)
      order by private.page_level(pg.id) >= 1 desc, pg.title, pg.id
      limit 1
    ) tp on true
    order by f.trashed_at desc, f.id;
end;
$$;

revoke all on function private.trashed_files_rows(uuid, timestamptz, uuid, int) from public, anon, authenticated;

-- `trashed_files` como en 20261101120000_proyectos_purgar.sql, con la consulta en un solo lugar.
create or replace function public.trashed_files(p_project uuid)
returns table (id uuid, name text, mime text, size bigint, thumb_at timestamptz, trashed_at timestamptz,
               days_left int, purged_at timestamptz, in_trashed_page boolean, trashed_page_title text,
               in_deleted_project boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_project is null or not private.can_see_file_trash(p_project) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return query
    select t.id, t.name, t.mime, t.size, t.thumb_at, t.trashed_at, t.days_left, t.purged_at, t.in_trashed_page,
           t.trashed_page_title, t.in_deleted_project
    from private.trashed_files_rows(p_project, null, null, null) t
    order by t.trashed_at desc, t.id;
end;
$$;

create or replace function public.trashed_files_page(
  p_project uuid default null, p_after_project uuid default null, p_after_trashed_at timestamptz default null,
  p_after_id uuid default null, p_limit int default 1000)
returns table (project_id uuid, id uuid, name text, mime text, size bigint, thumb_at timestamptz,
               trashed_at timestamptz, days_left int, purged_at timestamptz, in_trashed_page boolean,
               trashed_page_title text, in_deleted_project boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  w    uuid;
  got  int;
  -- Cuántas filas faltan para llenar la página: entre 1 y 1000 (el tope de filas por pedido de la API de fábrica).
  room int := least(greatest(coalesce(p_limit, 1000), 1), 1000);
begin
  -- Desde dónde seguir: nada, un proyecto solo (la fila de una papelera vacía) o un archivo entero.
  if (p_after_trashed_at is null) <> (p_after_id is null) or (p_after_project is null and p_after_id is not null) then
    raise exception 'after_invalid' using errcode = '22023';
  end if;
  for w in
    select ws.id from public.workspaces ws
    where ws.deleted_at is null
      and (p_project is null or ws.id = p_project)
      -- Los proyectos que siguen; el de la última fila, solo si era un archivo (pueden quedarle más).
      and (p_after_project is null or ws.id > p_after_project or (ws.id = p_after_project and p_after_id is not null))
    order by ws.id
  loop
    continue when not private.can_see_file_trash(w);
    if w is not distinct from p_after_project then
      -- El proyecto donde quedó la página anterior: lo que sigue a su última fila. Si no queda nada, nada (ya se
      -- sabe que la sesión lo ve: no lleva la fila de papelera vacía).
      return query
        select w, t.id, t.name, t.mime, t.size, t.thumb_at, t.trashed_at, t.days_left, t.purged_at,
               t.in_trashed_page, t.trashed_page_title, t.in_deleted_project
        from private.trashed_files_rows(w, p_after_trashed_at, p_after_id, room) t
        order by t.trashed_at desc, t.id;
      get diagnostics got = row_count;
    else
      return query
        select w, t.id, t.name, t.mime, t.size, t.thumb_at, t.trashed_at, t.days_left, t.purged_at,
               t.in_trashed_page, t.trashed_page_title, t.in_deleted_project
        from private.trashed_files_rows(w, null, null, room) t
        order by t.trashed_at desc, t.id;
      get diagnostics got = row_count;
      if got = 0 then
        -- La ve y está vacía: solo el proyecto.
        return query
          select w, null::uuid, null::text, null::text, null::bigint, null::timestamptz, null::timestamptz, null::int,
                 null::timestamptz, null::boolean, null::text, null::boolean;
        got := 1;
      end if;
    end if;
    room := room - got;
    -- La página se llenó: puede haber más (lo dirá el pedido siguiente).
    if room <= 0 then
      return;
    end if;
  end loop;
  -- No queda nada: la fila del final, sin proyecto.
  return query
    select null::uuid, null::uuid, null::text, null::text, null::bigint, null::timestamptz, null::timestamptz, null::int,
           null::timestamptz, null::boolean, null::text, null::boolean;
end;
$$;

revoke all on function public.trashed_files_page(uuid, uuid, timestamptz, uuid, int) from public, anon;
grant execute on function public.trashed_files_page(uuid, uuid, timestamptz, uuid, int) to authenticated;

notify pgrst, 'reload schema';
