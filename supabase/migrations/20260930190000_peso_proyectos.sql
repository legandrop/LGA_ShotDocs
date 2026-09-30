-- LGA Shot Docs · cuánto ocupa cada proyecto en el Drive (P.7 del roadmap; Docs/Doc_Peso_Proyectos.md).
--
-- Una sola función, `public.project_sizes()`, que devuelve de una vez el peso de todos los proyectos cuya
-- papelera de archivos ve la sesión (`private.can_see_file_trash`: el dueño y los admins con algún permiso
-- sobre el proyecto entero, y quien tiene editar y crear páginas sobre el proyecto entero). Suma
-- `files.size` agrupado por `files.project_id`, sin preguntarle a Drive: el portero sube exactamente ese
-- peso (rechaza un tamaño que no coincide). No se une con `page_files`: un uso en otro proyecto
-- (`is_foreign`) no suma dos veces, cuenta en el proyecto dueño del archivo.
--
-- Cada archivo cae en un solo estado, mirado en este orden:
--   (a) `drive_trashed_at` puesto: si está subido y `greatest(drive_trashed_at, uploaded_at)` es de hace
--       menos de 30 días, "en la papelera de Drive" (sigue ocupando hasta que Google la vacía); si no, no
--       cuenta (Google ya lo borró, o nunca llegó a Drive).
--   (b) `trashed_at` puesto: "en la papelera de la app" (el mismo conjunto que `trashed_files`, así el total
--       coincide con el de la papelera).
--   (c) `drive_id` nulo: registrado y todavía sin subir (esperando a un dispositivo).
--   (d) El resto: en uso.
-- El número principal (`drive_bytes`, `drive_files`) es (d) más lo de (b) que está subido (`drive_id`
-- puesto): lo que la app tiene en Drive fuera de la papelera de Drive. Así baja al vaciar la papelera de la
-- app, y un archivo que fue a la papelera antes de subirse no suma lo que no está en Drive. (b) entero, (a) y
-- (c) vienen aparte.
--
-- La puerta se calcula una vez por proyecto (CTE materializado), nunca por fila de `files`. Devuelve
-- también los proyectos permitidos sin archivos (en cero). Solo al dueño (con una sesión válida:
-- `workspace_role()` ya descarta la de contraseña), una fila más con `project_id` nulo: el total de los
-- proyectos cuya papelera no ve (privados de otros, o compartidos con él solo por páginas sueltas), sin
-- nombres. Esa fila sale solo si hay algún proyecto así.
--
-- Compatible con la app publicada: solo agrega una función, que la app publicada no llama. No cambia
-- ninguna fila.

create function public.project_sizes()
returns table (project_id uuid,
               drive_bytes bigint, drive_files int,
               trash_bytes bigint, trash_files int,
               drive_trash_bytes bigint, drive_trash_files int,
               pending_bytes bigint, pending_files int)
language sql stable security definer set search_path = ''
as $$
  with gate as materialized (
    select w.id, private.can_see_file_trash(w.id) as allowed
    from public.workspaces w
  ),
  me as materialized (
    select coalesce(private.workspace_role() = 'owner', false) as is_owner
  ),
  state as (
    select f.project_id, f.size, f.drive_id is not null as uploaded,
           case
             when f.drive_trashed_at is not null then
               case when f.drive_id is not null
                         and greatest(f.drive_trashed_at, f.uploaded_at) > now() - interval '30 days'
                    then 'drive_trash' end
             when f.trashed_at is not null then 'trash'
             when f.drive_id is null then 'pending'
             else 'live'
           end as st
    from public.files f
    join gate g on g.id = f.project_id
    where g.allowed or (select me.is_owner from me)
  ),
  per_project as (
    select s.project_id,
           coalesce(sum(s.size) filter (where s.st = 'live' or (s.st = 'trash' and s.uploaded)), 0)::bigint as drive_bytes,
           (count(*) filter (where s.st = 'live' or (s.st = 'trash' and s.uploaded)))::int as drive_files,
           coalesce(sum(s.size) filter (where s.st = 'trash'), 0)::bigint as trash_bytes,
           (count(*) filter (where s.st = 'trash'))::int as trash_files,
           coalesce(sum(s.size) filter (where s.st = 'drive_trash'), 0)::bigint as drive_trash_bytes,
           (count(*) filter (where s.st = 'drive_trash'))::int as drive_trash_files,
           coalesce(sum(s.size) filter (where s.st = 'pending'), 0)::bigint as pending_bytes,
           (count(*) filter (where s.st = 'pending'))::int as pending_files
    from state s
    group by s.project_id
  )
  select g.id,
         coalesce(p.drive_bytes, 0::bigint), coalesce(p.drive_files, 0),
         coalesce(p.trash_bytes, 0::bigint), coalesce(p.trash_files, 0),
         coalesce(p.drive_trash_bytes, 0::bigint), coalesce(p.drive_trash_files, 0),
         coalesce(p.pending_bytes, 0::bigint), coalesce(p.pending_files, 0)
  from gate g
  left join per_project p on p.project_id = g.id
  where g.allowed
  union all
  -- Los que no ve, todos juntos y sin nombres: solo el dueño.
  select null::uuid,
         coalesce(sum(p.drive_bytes), 0)::bigint, coalesce(sum(p.drive_files), 0)::int,
         coalesce(sum(p.trash_bytes), 0)::bigint, coalesce(sum(p.trash_files), 0)::int,
         coalesce(sum(p.drive_trash_bytes), 0)::bigint, coalesce(sum(p.drive_trash_files), 0)::int,
         coalesce(sum(p.pending_bytes), 0)::bigint, coalesce(sum(p.pending_files), 0)::int
  from gate g
  left join per_project p on p.project_id = g.id
  where not g.allowed and (select me.is_owner from me)
  having count(*) > 0;
$$;

revoke all on function public.project_sizes() from public, anon;
grant execute on function public.project_sizes() to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Versión de la base
-- ---------------------------------------------------------------------------------------------------
update public.workspace_settings set schema_version = 7 where id and schema_version < 7;

notify pgrst, 'reload schema';
