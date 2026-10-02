-- LGA Shot Docs · la papelera de páginas no se lee con permiso de Ver (Docs/Doc_Supabase.md, "La papelera de páginas
-- y quién la ve"; decisión del 2026-10-02).
--
-- Hasta ahora `private.user_page_level` miraba solo si el PROYECTO estaba borrado: una página en la papelera (o
-- adentro de una) se seguía leyendo entera con Ver o Comentar sobre ella o sobre una de arriba (título, contenido,
-- comentarios, archivos, miniaturas, el portero). Un cliente bajaba así una nota interna que se mandó a la papelera
-- antes de compartirle la rama.
--
-- Regla nueva: sobre una página que está en la papelera, o que cuelga de una que está, el nivel es 0 para quien
-- tiene menos de 3 (Ver, Comentar) y para los invitados (`guest`), tengan el nivel que tengan. Quien puede editar
-- (3 o más) y no es invitado la sigue viendo como hoy (para verla en la Papelera; restaurar sigue pidiendo 4, como
-- dice el trigger `pages_permissions`). Mandar a la papelera sigue pidiendo 4, también a un invitado, que después
-- deja de verla. Restaurar devuelve el acceso de todos: no se toca ningún permiso ni fila.
--
--   - `user_page_level` (y con ella `page_level`, `can_view_page`, `can_edit_page`, `file_level`, `can_view_file`,
--     las políticas de `page_updates`, `page_files`, `files`, `comments` y de los buckets, `pull_page_updates`,
--     `push_page_update`, las funciones de comentarios, `media_file` del portero) aplica la regla.
--   - `can_view_page_row` (la política de lectura de `pages`): con un permiso sobre el proyecto entero alcanzaba para
--     ver cualquier fila, también las de la papelera. Aplica la misma regla.
--
-- Rendimiento: las dos se llaman una vez por fila. Pasan de SQL a PL/pgSQL (Postgres 17 vuelve a planificar una
-- función SQL que no se puede expandir en cada llamada; PL/pgSQL guarda el plan en la sesión) y recorren la cadena de
-- padres una sola vez, con `deleted_at`, en la misma consulta que junta los permisos. Medido en la base real (en una
-- transacción deshecha): Docs/Doc_Supabase.md.
--
-- Lo que no cambia: las versiones `_any` (quién puede restaurar un proyecto borrado, invitaciones), la papelera de
-- archivos (`page_alive`), `page_history` (ya negaba la papelera), quién ve el nombre del proyecto, y los archivos
-- que una persona subió ella misma (los sigue viendo mientras pueda editar alguna página del proyecto, como hoy).
--
-- Compatible con la app publicada: las funciones conservan firma y resultado; la app ya maneja una página que deja de
-- llegar (como cuando sacan un permiso). No sube `schema_version`: la app no necesita saber si está.

-- Escala de siempre: 0 nada, 1 ver, 2 comentar, 3 editar, 4 editar y crear páginas.
create or replace function private.user_page_level(p uuid, uid uuid)
returns int
language plpgsql stable security definer set search_path = ''
as $$
declare
  member_role  text;
  proj_deleted boolean;
  is_owner     boolean;
  granted      int;
  in_trash     boolean;
  lvl          int;
begin
  if uid is null then
    return 0;
  end if;
  member_role := private.workspace_role(uid);
  if member_role is null then
    return 0;
  end if;

  -- La página y las de arriba, una sola vez: los permisos por página y si alguna está en la papelera.
  with recursive chain (id, parent_id, deleted_at, depth) as (
    select pg.id, pg.parent_id, pg.deleted_at, 0 from public.pages pg where pg.id = p
    union all
    select pg.id, pg.parent_id, pg.deleted_at, c.depth + 1
    from public.pages pg
    join chain c on pg.id = c.parent_id
    where c.depth < 10000
  )
  select w.deleted_at is not null,
         w.owner_id = uid,
         (select max(private.grant_level_value(g.level))
          from public.grants g
          where g.user_id = uid and g.revoked_at is null
            and (g.project_id = pg.workspace_id or g.page_id in (select c.id from chain c))),
         exists (select 1 from chain c where c.deleted_at is not null)
  into proj_deleted, is_owner, granted, in_trash
  from public.pages pg
  join public.workspaces w on w.id = pg.workspace_id
  where pg.id = p;

  -- Sin la página, o con el proyecto borrado (migración de archivar y borrar proyectos): 0.
  if not found or proj_deleted then
    return 0;
  end if;
  lvl := greatest(case when is_owner then 4 else 0 end, coalesce(granted, 0));
  -- En la papelera (ella o una de arriba): solo quien puede editar y no es invitado.
  if lvl > 0 and in_trash and (lvl < 3 or member_role = 'guest') then
    return 0;
  end if;
  return lvl;
end;
$$;

revoke all on function private.user_page_level(uuid, uuid) from public, anon, authenticated;

-- La política de lectura de `pages` decide con los datos de la fila: `insert ... on conflict do nothing` (así crea
-- páginas la app) la evalúa sobre la fila nueva, que puede no estar en la tabla o chocar con otra. Se ve con permiso
-- sobre el proyecto de la fila, sobre ella o sobre una de arriba (como antes: `project_level`, `page_level` de la
-- página y del padre), y con la regla de la papelera de `user_page_level`. Si la fila está en la papelera se mira
-- su `deleted_at` en la tabla (no el de la fila nueva): así quien la manda a la papelera con 4 recibe la respuesta
-- del `update ... returning` aunque después deje de verla (un invitado).
create or replace function private.can_view_page_row(p_id uuid, p_workspace_id uuid, p_parent_id uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  uid          uuid := auth.uid();
  member_role  text;
  proj_deleted boolean;
  is_owner     boolean;
  granted      int;
  in_trash     boolean;
  lvl          int;
begin
  if uid is null then
    return false;
  end if;
  member_role := private.workspace_role(uid);
  if member_role is null then
    return false;
  end if;

  with recursive up (id, parent_id, deleted_at, depth) as (
    select p_id, p_parent_id, (select pg.deleted_at from public.pages pg where pg.id = p_id), 0
    union all
    select pg.id, pg.parent_id, pg.deleted_at, u.depth + 1
    from public.pages pg
    join up u on pg.id = u.parent_id
    where u.depth < 10000
  )
  select w.deleted_at is not null,
         w.owner_id = uid,
         (select max(private.grant_level_value(g.level))
          from public.grants g
          where g.user_id = uid and g.revoked_at is null
            and (g.project_id = p_workspace_id or g.page_id in (select u.id from up u))),
         exists (select 1 from up u where u.deleted_at is not null)
  into proj_deleted, is_owner, granted, in_trash
  from public.workspaces w
  where w.id = p_workspace_id;

  if not found or proj_deleted then
    return false;
  end if;
  lvl := greatest(case when is_owner then 4 else 0 end, coalesce(granted, 0));
  if lvl = 0 then
    return false;
  end if;
  -- La misma regla que `user_page_level`.
  return not (in_trash and (lvl < 3 or member_role = 'guest'));
end;
$$;
