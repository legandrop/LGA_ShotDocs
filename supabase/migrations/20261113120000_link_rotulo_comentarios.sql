-- LGA Shot Docs · de qué link vino cada comentario (Docs/Doc_Link_Publico.md, 3.7 y "De qué link vino cada comentario").
--
-- Un comentario hecho por un link público guarda el id del link (`comments.plink_id`) y `list_comments` lo entrega,
-- pero ninguna función decía el nivel ni quién creó un link **por su id**: `get_public_link` es por página y solo del
-- link vivo, y un comentario puede ser de un link ya renovado, apagado o vencido. Quien administra el link no podía
-- saber de cuál vino un comentario para decidir cuál cerrar.
--
-- `public_link_labels(p_ids)` contesta, para una lista de ids de link, lo mínimo para el rótulo: el nivel, quién lo
-- creó (la parte del correo antes de la @, como en *Share*) y cómo está: `revoked` (se apagó o se renovó), `expired`
-- (venció) y `alive` (anda hoy: ni apagado ni vencido, y quien lo creó todavía puede compartir la página; la misma
-- cuenta que `public_link_pages`). **Nunca el token, la página ni nada que sirva para entrar.**
--
-- A quién: **solo a quien puede compartir la página raíz del link**. El resultado es, sesión por sesión, el de
-- `private.can_share(null, página)` (la regla de `get_public_link` y de `public_link_pages`) mirado link por link. De
-- un link que la sesión no comparte, o que no existe, no devuelve fila ni error: **las filas no dicen si el id
-- existe**. Quien no es miembro, entró con contraseña o es invitado no recibe nada, de entrada.
--
-- Cómo llega a ese resultado con poco trabajo (como `public_link_pages` desde
-- 20261111120000_link_paginas_sin_recorrer_todo.sql): el permiso se mira **una vez por proyecto**.
--
--   - Un proyecto borrado no se mira: nadie tiene nivel sobre ninguna de sus páginas.
--   - Tampoco uno donde la sesión no puede compartir nada: la regla pide ser quien creó el proyecto, o dueño o admin
--     del workspace con «Editar y crear páginas» (nivel 4) sobre la página, y el nivel 4 de quien no creó el proyecto
--     sale solo de un permiso de ese nivel sobre el proyecto o sobre una página suya. Sin ninguno, ninguna página.
--   - Con nivel 4 sobre el proyecto entero lo tiene sobre cada página (también en la papelera): no se mira ninguna.
--   - Solo cuando no alcanza (un admin con el permiso dado página por página) se mira la página, con la regla de
--     siempre, una vez por página (varios links de la misma página, por *Reset link*, cuestan una sola cuenta).
--
-- Así, para quien no comparte nada en un proyecto, un link ajeno cuesta casi lo mismo que uno que no existe (no se
-- recorre ninguna cadena de páginas). La diferencia de tiempo no es cero: medida con 200 ids, es del orden de 1 ms
-- por pedido, en cualquiera de los dos sentidos según el plan que elija la base. Un admin que ya comparte alguna
-- página de ese proyecto sí hace mirar las páginas de los links que pide, y eso se nota en el tiempo. El atajo vale mientras `private.user_page_level` dé, a quien no es invitado, por lo menos el
-- nivel que tiene sobre el proyecto entero, y mientras el nivel 4 salga solo de crear el proyecto o de un permiso
-- «Editar y crear páginas»: la prueba compara cada sesión con la regla mirada link por link y cuenta los permisos de
-- página que se miran; si la regla cambia y el atajo no, falla.
--
-- `alive` se mira solo para el link sin apagar ni vencer (uno por página como mucho). Hasta 200 ids por pedido
-- (`ids_invalid` con más: depende solo de lo que se manda, no de lo que hay en la base); los nulos y los repetidos no
-- cuentan como filas.
--
-- Permisos: solo `authenticated`; `anon` no la llama (tampoco con el header de un link). Solo lectura (`stable`).
--
-- Compatible con la app publicada: es una función nueva; nada de lo que existe cambia de firma, de columnas, de
-- errores ni de permisos. No sube `schema_version`: la app nueva la pide y, con una base sin esta migración
-- (`PGRST202`), muestra los comentarios como antes.

create or replace function public.public_link_labels(p_ids uuid[])
returns table (id uuid, level text, created_by_name text, revoked boolean, expired boolean, alive boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  uid      constant uuid := auth.uid();
  my_role  text;
  is_admin boolean;
begin
  if uid is null or p_ids is null then
    return;
  end if;
  if cardinality(p_ids) > 200 then
    raise exception 'ids_invalid' using errcode = '22023';
  end if;
  -- El rol de la sesión (nulo si entró con contraseña), una vez: `private.user_can_share_page` pide un miembro que no
  -- sea invitado.
  my_role := private.workspace_role(uid);
  if my_role is null or my_role = 'guest' then
    return;
  end if;
  is_admin := my_role in ('owner', 'admin');
  return query
    with asked as materialized (
      select pl.id as link_id, pl.page_id as root, pg.workspace_id as ws, pl.level as link_level, pl.created_by as creator,
             pl.revoked_at is not null as is_revoked,
             pl.expires_at is not null and pl.expires_at <= now() as is_expired
      from public.public_links pl
      join public.pages pg on pg.id = pl.page_id
      where pl.id = any (p_ids)
    ),
    -- Los proyectos de esos links donde la sesión puede compartir algo: el que creó, o (dueña o admin del workspace)
    -- uno donde tiene algún «Editar y crear páginas», sobre el proyecto o sobre una página suya. Y si lo tiene sobre
    -- el proyecto entero (`whole`), comparte todas sus páginas.
    projects as materialized (
      select w.id as ws, private.user_project_level(w.id, uid) >= 4 as whole
      from public.workspaces w
      where w.id in (select a.ws from asked a)
        and w.deleted_at is null
        and (w.owner_id = uid
             or (is_admin and exists (
                   select 1
                   from public.grants g
                   left join public.pages gp on gp.id = g.page_id
                   where g.user_id = uid and g.revoked_at is null and private.grant_level_value(g.level) >= 4
                     and (g.project_id = w.id or gp.workspace_id = w.id))))
    ),
    -- La sesión sobre la página raíz de cada link, una vez por página: si el proyecto no alcanza para decidir, la
    -- regla de `get_public_link`.
    roots as materialized (
      select r.root, case when m.whole then true else private.can_share(null, r.root) end as mine
      from (select distinct a.root, a.ws from asked a) r
      join projects m on m.ws = r.ws
    )
    select a.link_id,
           a.link_level,
           (select nullif(split_part(u.email, '@', 1), '') from auth.users u where u.id = a.creator),
           a.is_revoked,
           a.is_expired,
           -- Anda hoy, como `alive` de `public_link_pages` y de `public_link_json`. El `case` asegura que a quien lo creó
           -- se lo mire solo cuando hace falta.
           case when a.is_revoked or a.is_expired or a.creator is null then false
                else coalesce(private.user_can_share_page(a.root, a.creator), false) end
    from asked a
    join roots r on r.root = a.root
    where r.mine;
end;
$$;

revoke all on function public.public_link_labels(uuid[]) from public, anon;
grant execute on function public.public_link_labels(uuid[]) to authenticated;

notify pgrst, 'reload schema';
