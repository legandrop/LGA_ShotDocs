-- LGA Shot Docs · la papelera de páginas no se lee con permiso de Ver (Docs/Doc_Supabase.md, "Permisos";
-- decisión D21 del 2026-10-02).
--
-- Hasta ahora `private.user_page_level` miraba solo si el PROYECTO estaba borrado: una página en la papelera (o
-- adentro de una) se seguía leyendo entera con Ver o Comentar sobre ella o sobre una de arriba (título, contenido,
-- comentarios, archivos, miniaturas, el portero). Un cliente bajaba así una nota interna que se mandó a la papelera
-- antes de compartirle la rama.
--
-- Regla nueva: sobre una página que está en la papelera, o que cuelga de una que está, el nivel es 0 para quien
-- tiene menos de 3 (Ver, Comentar) y para los invitados (`guest`), tengan el nivel que tengan. Quien puede editar
-- (3 o más) y no es invitado la sigue viendo como hoy (para verla en la Papelera; restaurar sigue pidiendo 4, como
-- dice el trigger `pages_permissions`). Restaurar devuelve el acceso de todos: no se toca ningún permiso ni fila.
--
--   - `user_page_level` (y con ella `page_level`, `can_view_page`, `can_edit_page`, `file_level`, `can_view_file`,
--     las políticas de `pages`, `page_updates`, `page_files`, `files`, `comments` y de los buckets, `pull_page_updates`,
--     `push_page_update`, las funciones de comentarios, `media_file` del portero) aplica la regla. Recorre la cadena
--     de padres una sola vez: la misma que ya recorría para los permisos por página, ahora con `deleted_at`.
--   - La política de lectura de `pages` (`can_view_page_row`): con un permiso sobre el proyecto entero alcanzaba para
--     ver cualquier fila, también las de la papelera; ahora mira también `deleted_at` de la fila (abajo).
--
-- Lo que no cambia: las versiones `_any` (quién puede restaurar un proyecto borrado, invitaciones), la papelera de
-- archivos (`page_alive`), `page_history` (ya negaba la papelera), quién ve el nombre del proyecto, y los archivos
-- que una persona subió ella misma (los sigue viendo mientras pueda editar alguna página del proyecto, como hoy).
--
-- Compatible con la app publicada: las funciones conservan firma y resultado (`can_view_page_row` suma un argumento,
-- solo la usa la política); la app ya maneja una página que deja de llegar (como cuando sacan un permiso). No sube
-- `schema_version`: la app no necesita saber si está.

create or replace function private.user_page_level(p uuid, uid uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  with recursive chain (id, parent_id, deleted_at, depth) as (
    select pg.id, pg.parent_id, pg.deleted_at, 0 from public.pages pg where pg.id = p
    union all
    select pg.id, pg.parent_id, pg.deleted_at, c.depth + 1
    from public.pages pg
    join chain c on pg.id = c.parent_id
    where c.depth < 10000
  ),
  target as (
    select pg.workspace_id, w.owner_id, w.deleted_at as project_deleted_at
    from public.pages pg
    join public.workspaces w on w.id = pg.workspace_id
    where pg.id = p
  ),
  who as (
    select private.workspace_role(uid) as role
  ),
  base as (
    select case
      when uid is null or (select w.role from who w) is null then 0
      -- Un proyecto borrado: 0 para todos (migración de archivar y borrar proyectos).
      when exists (select 1 from target t where t.project_deleted_at is not null) then 0
      else greatest(
        coalesce((select 4 from target t where t.owner_id = uid), 0),
        coalesce((
          select max(private.grant_level_value(g.level))
          from public.grants g
          where g.user_id = uid and g.revoked_at is null
            and (g.project_id = (select t.workspace_id from target t)
                 or g.page_id in (select c.id from chain c))
        ), 0))
    end as lvl
  )
  -- En la papelera (ella o una de arriba): solo quien puede editar y no es invitado.
  select case
    when b.lvl > 0
         and (b.lvl < 3 or (select w.role from who w) = 'guest')
         and exists (select 1 from chain c where c.deleted_at is not null) then 0
    else b.lvl
  end
  from base b;
$$;

revoke all on function private.user_page_level(uuid, uuid) from public, anon, authenticated;

-- La política de lectura de `pages` sigue decidiendo con los datos de la fila (`insert ... on conflict do nothing`
-- la evalúa sobre la fila nueva, que puede no estar en la tabla o chocar con otra), ahora también con `deleted_at`:
--   - fila en la papelera: solo con `page_level >= 1` sobre ella (que ya aplica la regla);
--   - fila que cuelga de una en la papelera: con `page_level >= 1` sobre ella o sobre el padre (los dos la aplican);
--   - si no, como siempre: el proyecto entero, la página o su padre.
-- Antes el permiso sobre el proyecto entero alcanzaba para ver cualquier fila, también las de la papelera.
create function private.can_view_page_row(p_id uuid, p_workspace_id uuid, p_parent_id uuid, p_deleted_at timestamptz)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    when p_deleted_at is not null then private.page_level(p_id) >= 1
    when p_parent_id is not null and private.page_in_trash(p_parent_id)
      then private.page_level(p_id) >= 1 or private.page_level(p_parent_id) >= 1
    else private.project_level(p_workspace_id) >= 1
      or private.page_level(p_id) >= 1
      or (p_parent_id is not null and private.page_level(p_parent_id) >= 1)
  end;
$$;

revoke all on function private.can_view_page_row(uuid, uuid, uuid, timestamptz) from public, anon;
grant execute on function private.can_view_page_row(uuid, uuid, uuid, timestamptz) to authenticated;

drop policy pages_select on public.pages;
create policy pages_select on public.pages
  for select to authenticated using (private.can_view_page_row(id, workspace_id, parent_id, deleted_at));

-- La de tres argumentos ya no la usa nada.
drop function private.can_view_page_row(uuid, uuid, uuid);
