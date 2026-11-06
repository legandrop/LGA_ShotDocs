-- LGA Shot Docs · *Share scenes*: compartir escenas de un proyecto con una persona de afuera (Docs/Doc_Compartir_Escenas.md,
-- entrega B-1, D843).
--
-- Una escena compartida es un permiso de Ver o Comentar **sobre la página de la escena**, el de siempre (`grants`): vale
-- para ella y lo de adentro (sus fichas) y nunca para lo de arriba ni para las hermanas. La RLS de lectura no cambia. Lo
-- nuevo es darlos de a muchos a una persona, con estos frenos (las condiciones de las auditorías, sección 8 del doc):
--
-- - `project_page_shares(proyecto)`: quién tiene qué en el proyecto (permisos vivos por página, también sobre páginas en
--   la papelera, con `in_trash`, y sobre el proyecto entero, de miembros activos; y las páginas vivas o el proyecto de las
--   invitaciones vivas). Solo dueño o admin del workspace que además puede compartir el proyecto.
-- - `set_page_shares(proyecto, correo, agregar, sacar, nivel)`: todo o nada. Solo dueño o admin que puede compartir el
--   proyecto; pide el interruptor de la privacidad de lo borrado (`clean_off`); nivel `view` o `comment`; hasta 200
--   páginas por llamada. Cada página es del proyecto y quien llama la puede compartir; cada una que se agrega además
--   está viva y tiene la marca de escena (si no, un único `page_invalid` que no dice cuál), no es ella misma una carpeta
--   de entidades y no tiene adentro otra página marcada como escena, locación, día o decorado, ni una carpeta que las
--   guarde (`scene_contains_entities`, sin decir cuál). Sacar anda también con una página en la papelera. El candado por correo se toma antes de decidir entre
--   miembro e invitación. A un miembro activo: un permiso propio que nunca baja un nivel (ni en una carrera), y sacar
--   revoca solo un Ver o Comentar sobre esa misma página; si el correo tiene además una invitación viva,
--   `invitation_exists` (al aceptarla, le volvería lo que se sacó). A alguien que no es miembro: una invitación de
--   **invitado** (solo agregar; una viva de otra persona o con otro rol, error; hasta 200 permisos por invitación).
-- - `pages_with_outside_readers(proyecto)`: las páginas del proyecto que ven personas de afuera (invitados, o Ver o
--   Comentar) por un permiso o una invitación sobre ellas, para la marca del árbol. Para quien puede compartir el
--   proyecto y no es invitado.
-- - `page_has_outside_readers(página)`: sí o no, para quien puede editar la página (no un invitado): si ella o una de
--   arriba la ven personas de afuera. Para el aviso al crear o mover de quien no puede compartir el proyecto.
-- - Un trigger en `pages` (`pages_scene_share_guard`): **nada de afuera entra moviéndolo** a una escena que ven personas
--   de afuera (`moved_into_shared_scene`; adentro de la misma escena, o sacarlo, sí); una página marcada como escena,
--   locación, día o decorado, o una carpeta de entidades (`settings.holds`, `settings.dayReports`), no se crea ni se
--   marca adentro (`entity_in_shared_scene`); y la escena compartida no deja de ser escena ni pasa a ser carpeta. Lo
--   frena también para una versión vieja de la app.
--
-- No toca `share`, `create_invitation` ni la RLS. Compatible con las versiones publicadas: solo suma funciones y un
-- trigger que no cambia nada de lo que ya está. Sube `schema_version` a 28: la app ofrece *Share scenes* y la marca del
-- árbol desde ahí.

-- ---------------------------------------------------------------------------------------------------
-- 0. Las piezas de adentro
-- ---------------------------------------------------------------------------------------------------
-- ¿Los ajustes de una página la marcan como carpeta de entidades? `settings.holds` (un texto: lo que guarda) o
-- `settings.dayReports` (un objeto: la carpeta de los reportes del día, Doc_Plantillas.md). `holds: false` («nada», a
-- mano) o vacío no cuenta. Lo de adentro de una carpeta así es una entidad aunque no tenga marca propia (`holdsOf` de
-- src/relations/kind.ts: lo importado o lo de antes de las marcas).
create function private.folder_marked(s jsonb)
returns boolean
language sql immutable set search_path = ''
as $$
  -- Siempre verdadero o falso (una clave que no está no deja un nulo que un `not` daría vuelta en nulo).
  select coalesce(jsonb_typeof(s -> 'holds') = 'string' and s ->> 'holds' <> '', false)
      or coalesce(jsonb_typeof(s -> 'dayReports') = 'object', false);
$$;

-- ¿Los ajustes de una página la marcan como escena, locación, día o decorado, o como carpeta de entidades?
-- (`settings.entity.kind`, Doc_Relaciones.md, y `folder_marked`.) Una marca `false` o vacía no cuenta.
create function private.entity_marked(s jsonb)
returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(s -> 'entity' ->> 'kind', '') in ('scene', 'location', 'day', 'set')
      or private.folder_marked(s);
$$;

-- ¿Ven la página personas de afuera por un permiso o una invitación puestos **sobre ella**? Un invitado (cualquier
-- nivel) o un miembro que la ve con Ver o Comentar (su nivel real, como `has_plain_readers`), o una invitación viva de
-- invitado o de Ver o Comentar. Un permiso sobre el proyecto entero no cuenta: lo dice *Share* del proyecto.
create function private.page_outside_readers(p uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
           select 1
           from public.grants g
           join public.members m on m.user_id = g.user_id and m.removed_at is null
           where g.page_id = p and g.revoked_at is null
             and (m.role = 'guest' or private.user_page_level(p, g.user_id) between 1 and 2))
      or exists (
           select 1
           from public.invitations i
           cross join lateral jsonb_array_elements(i.grants) el
           where i.used_at is null and i.revoked_at is null and i.expires_at > now()
             and exists (select 1 from public.members m
                         where m.user_id = i.invited_by and m.removed_at is null and m.role in ('owner', 'admin'))
             and el ->> 'page_id' = p::text
             and (i.role = 'guest' or el ->> 'level' in ('view', 'comment')));
$$;

-- ¿La página o una de arriba la ven personas de afuera? (`only_scenes`: solo cuentan las de arriba marcadas como
-- escena: el freno del trigger.) Recorre la cadena hacia arriba una vez; mira los permisos solo donde hace falta.
create function private.chain_outside_readers(p uuid, only_scenes boolean)
returns boolean
language sql stable security definer set search_path = ''
as $$
  with recursive chain (id, parent_id, settings, depth) as (
    select pg.id, pg.parent_id, pg.settings, 0 from public.pages pg where pg.id = p
    union all
    select pg.id, pg.parent_id, pg.settings, c.depth + 1
    from public.pages pg
    join chain c on pg.id = c.parent_id
    where c.depth < 10000
  )
  select exists (
    select 1 from chain c
    where (not only_scenes or coalesce(c.settings -> 'entity' ->> 'kind', '') = 'scene')
      and private.page_outside_readers(c.id));
$$;

-- La escena compartida más cercana hacia arriba (la página misma incluida): la primera con la marca de escena y un
-- permiso o una invitación de afuera sobre ella, o nulo. El freno de los movimientos compara la del destino con la del
-- origen.
create function private.nearest_shared_scene(p uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  with recursive chain (id, parent_id, settings, depth) as (
    select pg.id, pg.parent_id, pg.settings, 0 from public.pages pg where pg.id = p
    union all
    select pg.id, pg.parent_id, pg.settings, c.depth + 1
    from public.pages pg
    join chain c on pg.id = c.parent_id
    where c.depth < 10000
  )
  select c.id from chain c
  where coalesce(c.settings -> 'entity' ->> 'kind', '') = 'scene'
    and private.page_outside_readers(c.id)
  order by c.depth
  limit 1;
$$;

-- ¿Hay adentro de la página (sin contarla a ella) otra marcada como escena, locación, día o decorado, o una carpeta de
-- entidades? También en la papelera: al restaurarla volvería a estar adentro. Si la página misma es una carpeta de
-- entidades, cualquier cosa adentro es una entidad (por la carpeta); lo de adentro de una carpeta de más abajo ya cuenta
-- por la carpeta misma, que tiene la marca.
create function private.branch_has_entities(p uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  with recursive sub (id, settings, depth) as (
    select pg.id, pg.settings, 1 from public.pages pg where pg.parent_id = p
    union all
    select pg.id, pg.settings, s.depth + 1
    from public.pages pg
    join sub s on pg.parent_id = s.id
    where s.depth < 10000
  )
  select exists (select 1 from sub where private.entity_marked(sub.settings))
      or (exists (select 1 from sub)
          and exists (select 1 from public.pages pg where pg.id = p and private.folder_marked(pg.settings)));
$$;

revoke all on function private.folder_marked(jsonb) from public, anon, authenticated;
revoke all on function private.entity_marked(jsonb) from public, anon, authenticated;
revoke all on function private.nearest_shared_scene(uuid) from public, anon, authenticated;
revoke all on function private.page_outside_readers(uuid) from public, anon, authenticated;
revoke all on function private.chain_outside_readers(uuid, boolean) from public, anon, authenticated;
revoke all on function private.branch_has_entities(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 1. Quién tiene qué en un proyecto
-- ---------------------------------------------------------------------------------------------------
-- Una fila por permiso vivo de un miembro activo sobre el proyecto (`page_id` nulo) o sobre una página del proyecto (en
-- la papelera, ella o una de arriba: `in_trash`, para poder sacarlo), y una por cada proyecto o página viva del proyecto
-- en una invitación viva (la de `live_invitations`: sin usar, sin revocar, sin vencer y de un dueño o admin activo).
-- `row_key` es único (la app pide la lista de a partes por esa clave). Costo: los permisos del proyecto más los de cada
-- invitación viva, con `page_alive` (la cadena hacia arriba) por cada permiso sobre una página; nunca recorre el árbol.
create function public.project_page_shares(p_project uuid)
returns table (row_key text, email text, user_id uuid, role text, page_id uuid, level text, grant_id uuid,
               invitation_id uuid, in_trash boolean)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_project is null
     or not coalesce(private.workspace_role() in ('owner', 'admin'), false)
     or not private.can_share(p_project, null) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  return query
    select 'g:' || g.id::text, u.email::text, g.user_id, m.role, null::uuid, g.level, g.id, null::uuid, false
    from public.grants g
    join public.members m on m.user_id = g.user_id and m.removed_at is null
    join auth.users u on u.id = g.user_id
    where g.revoked_at is null and g.project_id = p_project
    union all
    select 'g:' || g.id::text, u.email::text, g.user_id, m.role, g.page_id, g.level, g.id, null::uuid,
           not private.page_alive(g.page_id)
    from public.grants g
    join public.pages pg on pg.id = g.page_id
    join public.members m on m.user_id = g.user_id and m.removed_at is null
    join auth.users u on u.id = g.user_id
    where g.revoked_at is null and pg.workspace_id = p_project
    union all
    select 'i:' || i.id::text || ':' || coalesce(el ->> 'page_id', 'project'), i.email, null::uuid, i.role,
           (el ->> 'page_id')::uuid, el ->> 'level', null::uuid, i.id, false
    from public.invitations i
    cross join lateral jsonb_array_elements(i.grants) el
    where i.used_at is null and i.revoked_at is null and i.expires_at > now()
      and exists (select 1 from public.members m
                  where m.user_id = i.invited_by and m.removed_at is null and m.role in ('owner', 'admin'))
      and ((el ? 'project_id' and el ->> 'project_id' = p_project::text)
           or (el ? 'page_id'
               and exists (select 1 from public.pages pg
                           where pg.id = (el ->> 'page_id')::uuid and pg.workspace_id = p_project)
               and private.page_alive((el ->> 'page_id')::uuid)));
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 2. Compartir y sacar escenas con una persona
-- ---------------------------------------------------------------------------------------------------
-- Devuelve `{"result": "member" | "invited", "pages": n}`: `n`, cuántas páginas vivas del proyecto quedaron compartidas
-- por página con esa persona (sus permisos vivos, o las páginas de su invitación viva). Cada página se valida una sola
-- vez, antes de escribir nada; cualquier error deshace todo el pedido.
create function public.set_page_shares(p_project uuid, p_email text, p_add uuid[], p_remove uuid[], p_level text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_role    text := private.workspace_role();
  v_email   text := lower(btrim(p_email));
  v_adds    uuid[] := coalesce(p_add, '{}'::uuid[]);
  v_rems    uuid[] := coalesce(p_remove, '{}'::uuid[]);
  v_all     uuid[];
  v_page    uuid;
  v_adding  boolean;
  v_ws      uuid;
  v_kind    text;
  v_target  uuid;
  v_inv     public.invitations;
  v_grants  jsonb;
  v_inv_id  uuid;
  v_count   int;
begin
  -- Quién llama: dueño o admin activo (con sesión permitida) que puede compartir el proyecto.
  if p_project is null or v_uid is null or v_role is null or v_role not in ('owner', 'admin')
     or not private.can_share(p_project, null) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  -- Sin el interruptor de la privacidad de lo borrado, quien solo ve bajaría también lo que se borró.
  if private.clean_min_version() is null then
    raise exception 'clean_off' using errcode = 'P0001',
      hint = 'Sharing scenes needs the workspace setting that keeps deleted text out of shared pages.';
  end if;
  if p_level is null or p_level not in ('view', 'comment') then
    raise exception 'level_invalid' using errcode = '22023';
  end if;
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' or length(v_email) > 320 then
    raise exception 'email_invalid' using errcode = '22023';
  end if;

  -- Las listas: algo que hacer, hasta 200 en total, sin nulos, sin repetidas y ninguna en las dos.
  v_all := v_adds || v_rems;
  if cardinality(v_all) > 200 then
    raise exception 'too_many_pages' using errcode = '22023', hint = 'Up to 200 pages at a time.';
  end if;
  if cardinality(v_all) = 0
     or exists (select 1 from unnest(v_all) x where x is null)
     or (select count(distinct x) from unnest(v_all) x) <> cardinality(v_all) then
    raise exception 'pages_invalid' using errcode = '22023';
  end if;

  -- Cada página, una vez: existe, es del proyecto y quien llama la puede compartir (quien comparte el proyecto la puede
  -- compartir también en la papelera: así se saca un permiso que quedó ahí); si se agrega, además está viva y es una
  -- escena marcada. Una sola respuesta para todo: no dice cuál ni si existe.
  for v_page, v_adding in
    select x.id, true from unnest(v_adds) as x(id)
    union all
    select x.id, false from unnest(v_rems) as x(id)
  loop
    select pg.workspace_id, coalesce(pg.settings -> 'entity' ->> 'kind', '')
      into v_ws, v_kind
      from public.pages pg where pg.id = v_page;
    if not found or v_ws is distinct from p_project
       or not private.user_can_share_page(v_page, v_uid)
       or (v_adding and (not private.page_alive(v_page) or v_kind <> 'scene')) then
      raise exception 'page_invalid' using errcode = '22023';
    end if;
  end loop;
  -- Solo esa escena: no es ella misma una carpeta de entidades (tenga algo adentro o no), y nada adentro marcado como
  -- otra escena, una locación, un día, un decorado o una carpeta de ellas.
  foreach v_page in array v_adds loop
    if private.branch_has_entities(v_page)
       or exists (select 1 from public.pages pg where pg.id = v_page and private.folder_marked(pg.settings)) then
      raise exception 'scene_contains_entities' using errcode = 'P0001',
        hint = 'A scene to share has another scene, a location, a day or a set inside.';
    end if;
  end loop;

  -- El mismo candado que `create_invitation`, antes de decidir: miembro o invitación no cambia hasta el final.
  perform pg_advisory_xact_lock(hashtextextended('invitation:' || v_email, 0));

  -- ¿Es un miembro activo? (Una cuenta sacada del workspace entra como alguien nuevo: con una invitación.)
  select u.id into v_target
  from auth.users u
  where lower(u.email::text) = v_email and private.workspace_role(u.id) is not null
  order by u.created_at, u.id
  limit 1;

  if v_target is not null then
    -- Con una invitación viva para el mismo correo, aceptarla le volvería a dar lo que se saca acá.
    if exists (select 1 from private.live_invitations(v_email)) then
      raise exception 'invitation_exists' using errcode = 'P0001',
        hint = 'This email also has a pending invitation. Revoke it in Members first.';
    end if;
    -- Agregar: un permiso propio solo si sube el nivel. Un Editar sobre la página, sobre una de arriba o sobre el
    -- proyecto se queda como está, y el upsert tampoco baja la fila en una carrera (como `accept_invitations`).
    foreach v_page in array v_adds loop
      if private.user_page_level(v_page, v_target) < private.grant_level_value(p_level) then
        insert into public.grants as g (user_id, page_id, level, granted_by)
        values (v_target, v_page, p_level, v_uid)
        on conflict (user_id, page_id) where page_id is not null
        do update set level = excluded.level, granted_by = excluded.granted_by, revoked_at = null, revoked_by = null
        where g.revoked_at is not null
           or private.grant_level_value(excluded.level) > private.grant_level_value(g.level);
        -- Ver, Comentar o un invitado: la rama empieza de una base limpia nueva (como `share`).
        perform private.clean_reset(null, v_page);
      end if;
    end loop;
    -- Sacar: solo un Ver o Comentar puesto sobre esa misma página (como `unshare`: se marca, no se borra). Un permiso
    -- sobre el proyecto, sobre otra página o de Editar no se toca.
    foreach v_page in array v_rems loop
      update public.grants g
      set revoked_at = now(), revoked_by = v_uid
      where g.user_id = v_target and g.page_id = v_page and g.revoked_at is null and g.level in ('view', 'comment');
    end loop;
    select count(distinct g.page_id)::int into v_count
    from public.grants g
    join public.pages pg on pg.id = g.page_id
    where g.user_id = v_target and g.revoked_at is null and pg.workspace_id = p_project
      and private.page_alive(g.page_id);
    return jsonb_build_object('result', 'member', 'pages', v_count);
  end if;

  -- Alguien nuevo: una invitación de invitado, solo para agregar.
  if cardinality(v_rems) > 0 then
    raise exception 'invitation_remove' using errcode = 'P0001',
      hint = 'This person has not joined yet. Revoke the invitation and invite again.';
  end if;
  select * into v_inv from private.live_invitations(v_email) i order by i.created_at, i.id limit 1;
  if found then
    if v_inv.invited_by is distinct from v_uid then
      raise exception 'invitation_exists' using errcode = 'P0001',
        hint = 'Someone else already invited this email. They can add to their invitation, or revoke it.';
    end if;
    if v_inv.role <> 'guest' then
      raise exception 'invitation_role' using errcode = 'P0001',
        hint = 'This email has a pending invitation with another role. Revoke it and invite again.';
    end if;
  end if;
  select jsonb_agg(jsonb_build_object('page_id', x.id, 'level', p_level) order by x.id)
    into v_grants
    from unnest(v_adds) as x(id);
  if jsonb_array_length(private.merge_invitation_grants(coalesce(v_inv.grants, '[]'::jsonb), v_grants)) > 200 then
    raise exception 'too_many_pages' using errcode = '22023', hint = 'An invitation can hold up to 200 pages.';
  end if;
  -- `create_invitation` vuelve a tomar el candado (el mismo, en la misma transacción), vuelve a pedir dueño o admin y 4
  -- sobre cada página, suma a la invitación propia sin bajar ningún nivel y reinicia la base limpia de lo que comparte.
  v_inv_id := public.create_invitation(v_email, 'guest', v_grants);
  select count(*)::int into v_count
  from public.invitations i
  cross join lateral jsonb_array_elements(i.grants) el
  where i.id = v_inv_id and el ? 'page_id'
    and exists (select 1 from public.pages pg where pg.id = (el ->> 'page_id')::uuid and pg.workspace_id = p_project)
    and private.page_alive((el ->> 'page_id')::uuid);
  return jsonb_build_object('result', 'invited', 'pages', v_count);
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 3. Las páginas que ven personas de afuera, para la marca del árbol
-- ---------------------------------------------------------------------------------------------------
-- Una fila por página viva del proyecto con un permiso vivo de un invitado (cualquier nivel) o de un miembro que la ve
-- con Ver o Comentar (su nivel real sobre ella, como `has_plain_readers`), o con una invitación viva de invitado o de
-- Ver o Comentar sobre ella; `readers`, cuántas personas o invitaciones. Lo de adentro lo marca la app (lo ven por esa
-- página). Un permiso sobre el proyecto entero no marca ninguna página: lo ve todo y lo dice *Share* del proyecto.
-- Costo: un `user_page_level` (la cadena hacia arriba) por cada permiso sobre una página del proyecto, como
-- `has_plain_readers` por cada candidato; con los permisos de hoy (decenas), milisegundos. La app lo pide como mucho cada
-- 2 minutos y solo quien puede compartir el proyecto.
create function public.pages_with_outside_readers(p_project uuid)
returns table (page_id uuid, readers int)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_project is null or coalesce(private.workspace_role(), 'guest') = 'guest'
     or not private.can_share(p_project, null) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  return query
    with direct (pid, who) as (
      select g.page_id, 'u:' || g.user_id::text
      from public.grants g
      join public.pages pg on pg.id = g.page_id
      join public.members m on m.user_id = g.user_id and m.removed_at is null
      where g.revoked_at is null and pg.workspace_id = p_project
        and (m.role = 'guest' or private.user_page_level(g.page_id, g.user_id) between 1 and 2)
      union
      select (el ->> 'page_id')::uuid, 'i:' || i.id::text
      from public.invitations i
      cross join lateral jsonb_array_elements(i.grants) el
      where i.used_at is null and i.revoked_at is null and i.expires_at > now()
        and exists (select 1 from public.members m
                    where m.user_id = i.invited_by and m.removed_at is null and m.role in ('owner', 'admin'))
        and el ? 'page_id'
        and (i.role = 'guest' or el ->> 'level' in ('view', 'comment'))
        and exists (select 1 from public.pages pg
                    where pg.id = (el ->> 'page_id')::uuid and pg.workspace_id = p_project)
    )
    select d.pid, count(distinct d.who)::int
    from direct d
    where private.page_alive(d.pid)
    group by d.pid;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 4. Sí o no, para quien edita: ¿esta página la ven personas de afuera?
-- ---------------------------------------------------------------------------------------------------
-- Para el aviso al crear o mover de quien edita pero no puede compartir el proyecto: si la página o una de arriba la
-- ven personas de afuera (por un permiso o una invitación sobre ellas, como la marca del árbol). Solo sí o no: ni quién,
-- ni cuántos, ni cuál de arriba. A quien no puede editar la página (o es invitado) siempre le dice que no, exista o no.
create function public.page_has_outside_readers(p_page uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_page is null or coalesce(private.workspace_role(), 'guest') = 'guest' or not private.can_edit_page(p_page) then
    return false;
  end if;
  return private.chain_outside_readers(p_page, false);
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 5. Nada marcado puede quedar adentro de una escena que ven personas de afuera
-- ---------------------------------------------------------------------------------------------------
-- Una escena compartida con personas de afuera (una de arriba con la marca de escena y un permiso o una invitación de
-- afuera sobre ella) no recibe nada de afuera (D843, la regla de los movimientos):
-- - **mover**: se rechaza (`moved_into_shared_scene`) si la escena compartida más cercana del destino no es la misma que
--   la del origen, sea lo que sea lo que se mueve, con marca o sin ella. Mover adentro de la misma escena compartida, o
--   sacar algo de ella, sí. Para meter algo: dejar de compartirla, moverlo y volver a compartir (y ahí
--   `scene_contains_entities` y la ventana lo vuelven a mirar);
-- - **crear** adentro una página marcada como escena, locación, día o decorado, o una carpeta de entidades, no
--   (`entity_in_shared_scene`); una página sin marca, sí;
-- - **marcar** adentro (una marca nueva; cambiar los ajustes de una que ya la tenía no se frena: lo que ya estaba se
--   queda), no;
-- - y la escena compartida misma: no deja de ser escena (desmarcarla, mover algo adentro y volver a marcarla), no pasa a
--   ser carpeta de entidades, y una página que ven de afuera no pasa a ser escena con entidades adentro.
-- Solo las escenas compartidas frenan (una carpeta de locaciones compartida con *Share* sigue recibiendo locaciones).
-- Costo: crear sin marca no hace nada (lo filtra el `when`); cambiar ajustes, unas comparaciones de jsonb y, solo si
-- cambia una marca, la cadena hacia arriba o los permisos de esa página; mover, la cadena hacia arriba del destino y,
-- solo si hay una escena compartida en ella, la del origen.
create function private.pages_scene_share_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_old_scene boolean;
  v_new_scene boolean;
  v_dest uuid;
begin
  if tg_op = 'INSERT' then
    if new.parent_id is not null and private.chain_outside_readers(new.parent_id, true) then
      raise exception 'entity_in_shared_scene' using errcode = 'P0001',
        hint = 'People outside the team see this scene: a scene, location, day or set cannot go inside it.';
    end if;
    return new;
  end if;

  if new.parent_id is distinct from old.parent_id then
    -- Moverla: a una escena compartida, solo desde adentro de esa misma escena.
    if new.parent_id is not null then
      v_dest := private.nearest_shared_scene(new.parent_id);
      if v_dest is not null
         and (old.parent_id is null or v_dest is distinct from private.nearest_shared_scene(old.parent_id)) then
        raise exception 'moved_into_shared_scene' using errcode = 'P0001',
          hint = 'This scene is shared with people outside the team. To move a page into it, stop sharing it first.';
      end if;
    end if;
    if new.settings is not distinct from old.settings then
      return new;
    end if;
  end if;

  -- Cambiar los ajustes.
  v_old_scene := coalesce(old.settings -> 'entity' ->> 'kind', '') = 'scene';
  v_new_scene := coalesce(new.settings -> 'entity' ->> 'kind', '') = 'scene';
  -- Una escena compartida no deja de ser escena (se podría mover algo adentro y volver a marcarla).
  if v_old_scene and not v_new_scene and private.page_outside_readers(new.id) then
    raise exception 'entity_in_shared_scene' using errcode = 'P0001',
      hint = 'People outside the team see this scene: it has to stay a scene.';
  end if;
  -- Una página que ven de afuera no pasa a ser escena con entidades adentro.
  if v_new_scene and not v_old_scene and private.page_outside_readers(new.id) and private.branch_has_entities(new.id) then
    raise exception 'entity_in_shared_scene' using errcode = 'P0001',
      hint = 'People outside the team see this page: it cannot become a scene with a scene, location, day or set inside.';
  end if;
  -- Una carpeta de entidades nueva adentro de una escena compartida, o la escena compartida misma.
  if private.folder_marked(new.settings) and not private.folder_marked(old.settings)
     and private.chain_outside_readers(new.id, true) then
    raise exception 'entity_in_shared_scene' using errcode = 'P0001',
      hint = 'People outside the team see this scene: a scene, location, day or set cannot go inside it.';
  end if;
  -- Una marca nueva adentro de una escena compartida.
  if new.parent_id is not null and private.entity_marked(new.settings) and not private.entity_marked(old.settings)
     and private.chain_outside_readers(new.parent_id, true) then
    raise exception 'entity_in_shared_scene' using errcode = 'P0001',
      hint = 'People outside the team see this scene: a scene, location, day or set cannot go inside it.';
  end if;
  return new;
end;
$$;

revoke all on function private.pages_scene_share_guard() from public, anon, authenticated;

create trigger pages_scene_share_guard_insert
before insert on public.pages
for each row
when (new.parent_id is not null
      and (coalesce(new.settings -> 'entity' ->> 'kind', '') in ('scene', 'location', 'day', 'set')
           or (jsonb_typeof(new.settings -> 'holds') = 'string' and new.settings ->> 'holds' <> '')
           or jsonb_typeof(new.settings -> 'dayReports') = 'object'))
execute function private.pages_scene_share_guard();

-- Sin `parent_id is not null` para los ajustes: una escena compartida puede estar en la raíz del proyecto.
create trigger pages_scene_share_guard_update
before update of parent_id, settings on public.pages
for each row
when ((new.parent_id is distinct from old.parent_id and new.parent_id is not null)
      or new.settings is distinct from old.settings)
execute function private.pages_scene_share_guard();

revoke all on function public.project_page_shares(uuid) from public, anon;
revoke all on function public.set_page_shares(uuid, text, uuid[], uuid[], text) from public, anon;
revoke all on function public.pages_with_outside_readers(uuid) from public, anon;
revoke all on function public.page_has_outside_readers(uuid) from public, anon;
grant execute on function public.project_page_shares(uuid) to authenticated;
grant execute on function public.set_page_shares(uuid, text, uuid[], uuid[], text) to authenticated;
grant execute on function public.pages_with_outside_readers(uuid) to authenticated;
grant execute on function public.page_has_outside_readers(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 6. Versión de la base: la app ofrece *Share scenes* y la marca del árbol desde la 28.
-- ---------------------------------------------------------------------------------------------------
update public.workspace_settings set schema_version = 28 where id and schema_version < 28;

notify pgrst, 'reload schema';
