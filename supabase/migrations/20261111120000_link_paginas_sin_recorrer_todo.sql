-- LGA Shot Docs · la lista de páginas con link público deja de mirar el permiso link por link (Docs/Doc_Link_Publico.md,
-- "La lista de páginas con link, sin recorrer todos los links").
--
-- `public_link_pages()` (el ícono del árbol; la app la pide cada 2 minutos) llamaba, por cada link vivo del workspace,
-- a `private.can_share` de su página (la cadena de páginas de arriba y los permisos de la sesión) y, por cada uno que
-- pasaba, a lo mismo para quien lo creó. Medido en una copia sembrada con 608 links: 750 ms para quien comparte y 240 a
-- 390 ms para un miembro que no recibe nada.
--
-- Contesta **exactamente lo mismo a cada sesión** (las mismas filas con los mismos valores), con menos trabajo:
--
--   - Si la sesión no es miembro (o entró con contraseña) o es invitada, nada de entrada: `private.user_can_share_page`
--     pide un miembro que no sea invitado.
--   - Si no es dueña ni admin del workspace, solo mira los links de los proyectos que creó: la regla pide ser dueño o
--     admin del workspace, o dueño del proyecto.
--   - De un proyecto borrado nadie tiene nivel sobre ninguna página: sus links no se miran.
--   - El permiso se mira **una vez por proyecto**: con nivel 4 sobre el proyecto entero (su dueño, o Editar y crear
--     páginas sobre el proyecto) lo tiene sobre cada página, también en la papelera. Solo cuando no alcanza (un admin
--     con el permiso dado página por página) se mira la página, con la regla de siempre.
--   - Lo mismo para si el link anda (`alive`): quien lo creó se mira una vez por persona y proyecto.
--
-- El atajo vale mientras `private.user_page_level` dé, a quien no es invitado, por lo menos el nivel que tiene sobre el
-- proyecto entero (20261009120000_papelera_lectores.sql). La prueba compara, para cada persona, la lista con lo que da
-- la regla de siempre link por link: si esa regla cambia y el atajo no, falla.
--
-- Permisos: ninguno nuevo; no cambia a quién le contesta qué. `anon` sigue sin poder llamarla.
--
-- Compatible con la app publicada: la firma, las columnas (con `page_id` primero), los valores y los permisos son los
-- de 20261107120000_link_paginas_quien_comparte.sql. No sube `schema_version`.

create or replace function public.public_link_pages()
returns table (page_id uuid, level text, created_by_name text, alive boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  uid      constant uuid := auth.uid();
  my_role  text;
  is_admin boolean;
begin
  if uid is null then
    return;
  end if;
  -- El rol de la sesión (nulo si entró con contraseña), una vez.
  my_role := private.workspace_role(uid);
  if my_role is null or my_role = 'guest' then
    return;
  end if;
  is_admin := my_role in ('owner', 'admin');
  return query
    with live as materialized (
      select pl.page_id, pl.level, pl.created_by, pg.workspace_id as ws
      from public.public_links pl
      join public.pages pg on pg.id = pl.page_id
      join public.workspaces w on w.id = pg.workspace_id
      where pl.revoked_at is null and (pl.expires_at is null or pl.expires_at > now())
        and w.deleted_at is null
        and (is_admin or w.owner_id = uid)
    ),
    -- La sesión sobre cada proyecto con links: ¿nivel 4 sobre el proyecto entero?
    projects as materialized (
      select p.ws, private.user_project_level(p.ws, uid) >= 4 as whole
      from (select distinct l.ws from live l) p
    ),
    shared as materialized (
      select l.page_id, l.level, l.created_by, l.ws
      from live l
      join projects m on m.ws = l.ws
      where case when m.whole then true else private.user_can_share_page(l.page_id, uid) end
    ),
    -- Quien creó cada link, una vez por persona y proyecto: ¿comparte todas las páginas del proyecto?
    creators as materialized (
      select c.created_by, c.ws,
             coalesce(private.workspace_role(c.created_by) <> 'guest', false)
               and private.user_project_level(c.ws, c.created_by) >= 4
               and (coalesce(private.workspace_role(c.created_by) in ('owner', 'admin'), false)
                    or exists (select 1 from public.workspaces w where w.id = c.ws and w.owner_id = c.created_by)) as whole
      from (select distinct s.created_by, s.ws from shared s where s.created_by is not null) c
    )
    select s.page_id,
           s.level,
           (select nullif(split_part(u.email, '@', 1), '') from auth.users u where u.id = s.created_by),
           -- Anda hoy: quien lo creó todavía puede compartir la página (lo vencido no se lista). Como `public_link_json`.
           coalesce(s.created_by is not null
                    and case when c.whole then true else private.user_can_share_page(s.page_id, s.created_by) end, false)
    from shared s
    left join creators c on c.created_by = s.created_by and c.ws = s.ws;
end;
$$;

revoke all on function public.public_link_pages() from public, anon;
grant execute on function public.public_link_pages() to authenticated;

notify pgrst, 'reload schema';
