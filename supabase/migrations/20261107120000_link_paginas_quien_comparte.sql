-- LGA Shot Docs · la lista de páginas con link público contesta solo a quien las comparte (Docs/Doc_Link_Publico.md,
-- "Restos del link (v0.215)" y "La lista de páginas con link, solo para quien comparte").
--
-- `public_link_pages()` (el ícono del árbol) listaba las páginas con un link vivo que la sesión **ve** (nivel 1): un
-- invitado, o un miembro con Ver, que la llamaba a mano se enteraba de que una página que ya ve tiene un link público.
-- La app no se lo mostraba a nadie que no compartiera (confirmaba cada página con `get_public_link`), pero la base lo
-- entregaba.
--
-- Ahora lista solo las páginas que la sesión **puede compartir** (`private.can_share`, la regla de `get_public_link` y
-- de todo lo demás del link) y suma, al final, lo que dice el ícono: el nivel del link, quién lo creó (la parte del
-- correo antes de la @, como en *Share*) y si anda hoy. Nunca el token. Con eso el ícono sale de un solo pedido.
--
-- Permisos: ninguno nuevo. Quien recibe una fila ya podía leer lo mismo, y más, con `get_public_link` de esa página.
-- Quien ve la página sin poder compartirla deja de recibir su fila. `anon` sigue sin poder llamarla.
--
-- Compatible con la app publicada: lee solo `page_id` (las columnas nuevas van al final) y confirma cada página con
-- `get_public_link`, que ya contestaba solo a quien comparte: recibe las mismas páginas que terminaba mostrando. La
-- exportación usa la lista igual (pide después el link de cada página). No sube `schema_version`: la app nueva reconoce
-- las columnas en la respuesta y, con una base sin esta migración, confirma página por página como antes.
--
-- Cambia lo que devuelve: drop y create (los permisos se dan de nuevo).

drop function public.public_link_pages();

create function public.public_link_pages()
returns table (page_id uuid, level text, created_by_name text, alive boolean)
language sql stable security definer set search_path = ''
as $$
  select pl.page_id,
         pl.level,
         (select nullif(split_part(u.email, '@', 1), '') from auth.users u where u.id = pl.created_by),
         -- Anda hoy: quien lo creó todavía puede compartir la página (lo vencido no se lista). Como `public_link_json`.
         coalesce(pl.created_by is not null and private.user_can_share_page(pl.page_id, pl.created_by), false)
  from public.public_links pl
  where pl.revoked_at is null and (pl.expires_at is null or pl.expires_at > now())
    and private.can_share(null, pl.page_id);
$$;

revoke all on function public.public_link_pages() from public, anon;
grant execute on function public.public_link_pages() to authenticated;

notify pgrst, 'reload schema';
