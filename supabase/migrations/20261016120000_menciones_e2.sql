-- LGA Shot Docs · menciones en comentarios, entrega 2 (P.21; Docs/Doc_Menciones.md, secciones 4, 9 y ME2). Va
-- después de la entrega 1 (schema 15): sube `schema_version` a 16.
--
-- ME2: el dueño y los admins que pueden compartir una página ven en la lista del `@` también a los miembros activos
-- que NO la ven (`has_access = false`) y, al elegir a uno, se la comparten con *Can comment* y lo mencionan. Nadie más
-- recibe esas filas: ni un miembro común que sea dueño de un proyecto (`can_share` es verdadera para él y le daría los
-- correos de todo el workspace, que hoy no ve), ni un admin que no puede compartir esa página. El dueño y los admins
-- ya ven a todo el workspace con `list_members`: la lista no les cuenta nada nuevo.
--
-- Compartir desde la mención es `share_for_mention(página, persona)`: siempre *Can comment*, siempre sobre esa página
-- (alcanza a las de abajo, como todo permiso, y nunca a las de arriba ni al proyecto), solo a quien hoy no la ve (no
-- sube ni baja el permiso de nadie que ya la ve) y nunca sobre una página en la papelera. Escribe con `public.share`,
-- así hace lo mismo que *Share* (también el reinicio de la privacidad de lo borrado).
--
-- Compatible con las versiones publicadas: la entrega 1 ya descarta las filas `has_access = false`
-- (`commentsRemote.ts`), y la función nueva solo la llama la app nueva.

-- ---------------------------------------------------------------------------------------------------
-- 1. La lista del `@`, con la parte "sin acceso" para el dueño y los admins que pueden compartir la página
-- ---------------------------------------------------------------------------------------------------
create or replace function public.mention_candidates(p_page_id uuid)
returns table (user_id uuid, email text, label text, has_access boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  lvl int := private.page_level(p_page_id);
  outsiders boolean;
begin
  if lvl < 1 then raise exception 'page_not_found' using errcode = 'P0002'; end if;
  if lvl < 2 then raise exception 'comment_denied' using errcode = '42501'; end if;
  -- Las filas sin acceso: solo el dueño y los admins (no alcanza `can_share`: ver arriba), que además pueden
  -- compartir esta página, y nunca sobre una página en la papelera (no hay nada que compartir ahí).
  outsiders := coalesce(private.workspace_role() in ('owner', 'admin'), false)
               and private.can_share(null, p_page_id)
               and not private.page_in_trash(p_page_id);
  return query
    select m.user_id, u.email::text, private.mention_label(u.email::text), true
    from public.members m join auth.users u on u.id = m.user_id
    where m.removed_at is null and private.mention_allowed(p_page_id, uid, m.user_id)
    union all
    select m.user_id, u.email::text, private.mention_label(u.email::text), false
    from public.members m join auth.users u on u.id = m.user_id
    where outsiders and m.removed_at is null and m.user_id <> uid
      and private.user_page_level(p_page_id, m.user_id) < 1
    order by 4 desc, 2;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 2. Compartir desde la mención
-- ---------------------------------------------------------------------------------------------------
-- Comparte la página con *Can comment* con quien hoy no la ve, para mencionarlo. Lo puede hacer solo quien recibe
-- las filas sin acceso de la lista (dueño o admin que puede compartir la página). Devuelve
-- `{"shared": true, "grant_id": …}` o, si la persona ya la ve (un reintento, o le compartieron por otro lado),
-- `{"shared": false}` sin tocar nada.
-- Errores: `not_authenticated` (28000), `page_not_found` (P0002), `not_allowed` (42501), `page_in_trash` (42501),
-- `member_not_found` (P0002).
create function public.share_for_mention(p_page_id uuid, p_user uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  gid uuid;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if private.page_level(p_page_id) < 1 then raise exception 'page_not_found' using errcode = 'P0002'; end if;
  if not coalesce(private.workspace_role() in ('owner', 'admin'), false) or not private.can_share(null, p_page_id) then
    raise exception 'not_allowed' using errcode = '42501', hint = 'Only the owner and admins who can share the page.';
  end if;
  if private.page_in_trash(p_page_id) then
    raise exception 'page_in_trash' using errcode = '42501';
  end if;
  if p_user is null or private.workspace_role(p_user) is null then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
  -- Ya la ve (o es uno mismo): nada que hacer. Nunca cambia el permiso de quien ya la ve.
  if p_user = uid or private.user_page_level(p_page_id, p_user) >= 1 then
    return jsonb_build_object('shared', false);
  end if;
  -- Solo esta página y solo Comentar: `share` vuelve a activar con Comentar un permiso que se había quitado.
  gid := public.share(p_user, null, p_page_id, 'comment');
  return jsonb_build_object('shared', true, 'grant_id', gid);
end;
$$;

revoke all on function public.share_for_mention(uuid, uuid) from public, anon;
grant execute on function public.share_for_mention(uuid, uuid) to authenticated;

update public.workspace_settings set schema_version = 16 where id and schema_version < 16;
notify pgrst, 'reload schema';
