-- LGA Shot Docs · lo que no entró de un link en una página, pedido por clave (Docs/Doc_Link_Publico.md, "Las listas
-- del link, enteras (v0.226)"; Docs/Doc_Sincronizacion.md, "Las listas largas").
--
-- `public_link_updates_of(p_page_id)` (el aviso de la página: lo apartado, lo retenido y lo que espera) corta en 500
-- filas **adentro** y no dice cuántas había: con más (un link molesto, reseteado), el aviso contaba y descargaba de
-- menos, sin avisar. La API no puede dar el total de una lista que la función ya recortó.
--
-- `public_link_updates_page` da **las mismas filas con los mismos valores**, pedidas desde donde quedó la app:
--
--   - El orden es el de siempre: por `n`, el orden de llegada. `p_after`: solo lo que sigue a esa fila (nulo: desde el
--     principio). `p_limit`: cuántas como mucho (entre 1 y 1000; 500 si no se dice).
--   - Dos columnas más al final: `n` (desde dónde seguir) y `total`, cuántas filas quedaban desde `p_after` contando
--     las de esta respuesta (se cuenta antes del límite). La app termina cuando lo recibido alcanza ese total, no por
--     haber recibido pocas filas: si la API le recorta la respuesta, sigue pidiendo desde la última que recibió.
--
-- Permisos: ninguno nuevo. La misma regla que `public_link_updates_of` (`private.sees_deleted` de la página; si no,
-- `page_not_found`), así que quien recibe una fila por acá la recibe por allá. Solo lee (`stable`); `security definer`
-- como aquella, que lee una tabla sin permisos para nadie. `anon` no la ejecuta. `n` ya lo recibe la misma gente en
-- `link_admit_work`.
--
-- Compatible con la app publicada: `public_link_updates_of` no se toca (firma, columnas, tope, errores y permisos). No
-- sube `schema_version`: la app nueva prueba `public_link_updates_page` y, si la base no la tiene, pide como antes.

create or replace function public.public_link_updates_page(p_page_id uuid, p_after bigint default null, p_limit int default 500)
returns table (id uuid, link_id uuid, author text, created_at timestamptz, bytes int, state text, reason text,
               n bigint, total bigint)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.sees_deleted(p_page_id) then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  -- El cuerpo de `public_link_updates_of` (20261028120000_link_editar.sql): el nivel una vez por link de la página.
  return query
    with lv as (
      select l.id, private.link_page_level(l, p_page_id) as level
      from public.public_links l
      where l.id in (select distinct x.link_id from public.public_link_updates x
                     where x.page_id = p_page_id and x.decided_at is null)
    )
    select u.id, u.link_id, u.author, u.created_at, u.bytes,
           case when u.decision = 'aside' then 'aside'
                when coalesce((select lv.level from lv where lv.id = u.link_id), 0) < 3 then 'held'
                else 'waiting' end,
           u.reason, u.n, count(*) over ()
    from public.public_link_updates u
    where u.page_id = p_page_id and (u.decided_at is null or u.decision = 'aside')
      and u.n > coalesce(p_after, 0)
    order by u.n
    limit greatest(least(coalesce(p_limit, 500), 1000), 1);
end;
$$;

revoke all on function public.public_link_updates_page(uuid, bigint, int) from public, anon;
grant execute on function public.public_link_updates_page(uuid, bigint, int) to authenticated;

notify pgrst, 'reload schema';
