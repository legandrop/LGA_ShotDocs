-- LGA Shot Docs · link público, entrega 2c: lo apartado a la vista. Diseño: Docs/Doc_Link_Publico.md, "Entrega 2: Can
-- edit (rediseño 2026-10-02)", E2.13, y "Cómo quedó la 2c".
--
-- 1. `public_link_aside()`: lo apartado de los links (también de links revocados o reseteados) en las páginas que
--    quien pregunta ve con lo borrado, con la página raíz de su link. Lo usan la lista de Share (lo de los links de esa
--    página), el historial y el ícono del árbol (las páginas con algo apartado). Sin bytes: se bajan de a una con
--    `public_link_update_bytes`, como el aviso de la página. Hasta 200 por página (las más nuevas), no un tope para todo
--    el workspace: un Reset de un link con miles de filas no deja sin lista a las demás páginas (O3 de su auditoría).
-- 2. El orden de la admisión pasa a ser por (página, link, dispositivo) y no por (página, link) (O3 de la auditoría de la
--    2a): una fila que ningún editor decide nunca (el visitante inventó una versión, `'9999'`) trababa lo que mandaran
--    después todos los visitantes de ese link en esa página. Ahora traba solo lo que sigue de ese dispositivo. Es seguro:
--    lo de otro dispositivo nunca depende de lo que este no tiene admitido (cada visitante escribe sobre las bases, que
--    solo traen lo admitido). La base no sabe cuál es la versión publicada más nueva, así que un techo de versión o
--    rechazaba a un visitante honesto apenas se publica o dejaba pasar una inventada un poco más chica.
--
-- Compatible con la versión publicada (2a): las tres funciones de la admisión conservan nombre, argumentos y respuesta.

-- ---------------------------------------------------------------------------------------------------
-- 1. Lo apartado, para Share y el árbol
-- ---------------------------------------------------------------------------------------------------
create function public.public_link_aside()
returns table (id uuid, page_id uuid, link_id uuid, link_page_id uuid, author text, created_at timestamptz,
               decided_at timestamptz, bytes int, reason text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if private.workspace_role() is null or private.history_denied_for_guest() then
    return;
  end if;
  -- El permiso una vez por página distinta (sees_deleted), no por fila; el tope, por página.
  return query
    with pages_aside as (
      select distinct u.page_id from public.public_link_updates u where u.decision = 'aside'
    ), seen as (
      select pa.page_id from pages_aside pa where private.sees_deleted(pa.page_id)
    ), ranked as (
      select u.id, u.n, u.page_id, u.link_id, u.author, u.created_at, u.decided_at, u.bytes, u.reason,
             row_number() over (partition by u.page_id order by u.n desc) as k
      from public.public_link_updates u
      join seen s on s.page_id = u.page_id
      where u.decision = 'aside'
    ), roots as (
      -- La raíz del link, solo si quien pregunta la ve (si no, nula: ni su id). Una vez por link.
      select l.id, case when private.page_level(l.page_id) >= 1 then l.page_id end as root
      from public.public_links l
      where l.id in (select distinct r.link_id from ranked r where r.k <= 200)
    )
    select r.id, r.page_id, r.link_id, ro.root, r.author, r.created_at, r.decided_at, r.bytes, r.reason
    from ranked r
    join roots ro on ro.id = r.link_id
    where r.k <= 200
    order by r.n desc;
end;
$$;

revoke all on function public.public_link_aside() from public, anon;
grant execute on function public.public_link_aside() to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 2. La admisión en orden por (página, link, dispositivo) (O3)
-- ---------------------------------------------------------------------------------------------------
-- Paso 1, sin bytes (el cuerpo de 20261028120000_link_editar.sql): la versión más vieja se mira por dispositivo, así un
-- grupo que esta versión no puede decidir no esconde la página para lo de los demás dispositivos.
create or replace function public.link_admit_pages(p_app_version text)
returns table (page_id uuid, waiting int, bytes bigint)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v numeric := private.version_num(p_app_version);
begin
  if private.workspace_role() is null or private.history_denied_for_guest()
     or not private.clean_version_allowed(p_app_version) or not private.link_edit_version_allowed(p_app_version) then
    return;
  end if;
  return query
    with g as (
      select u.page_id, u.link_id, count(*)::int as waiting, sum(u.bytes)::bigint as bytes,
             min(u.app_version) as first_version
      from public.public_link_updates u
      join public.public_links l on l.id = u.link_id
      where u.decided_at is null and l.revoked_at is null and l.level = 'edit'
        and (l.expires_at is null or l.expires_at > now())
      group by u.page_id, u.link_id, u.device_hash
    )
    select g.page_id, sum(g.waiting)::int, sum(g.bytes)::bigint
    from g join public.public_links l on l.id = g.link_id
    where g.first_version <= v and private.sees_deleted(g.page_id) and private.link_page_level(l, g.page_id) = 3
    group by g.page_id
    order by min(g.first_version), g.page_id
    limit 50;
end;
$$;

-- Paso 2, con bytes (el mismo cuerpo): lo que no se puede decidir (una versión más nueva que la de quien admite) traba
-- solo lo que sigue de su (página, link, dispositivo). El permiso y el link, una vez por (página, link).
create or replace function public.link_admit_work(p_app_version text, p_pages uuid[])
returns table (id uuid, page_id uuid, link_id uuid, n bigint, data text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v       numeric := private.version_num(p_app_version);
  r       record;
  blocked text[] := '{}';
  stopped text[] := '{}';
  allowed text[] := '{}';
  total   bigint := 0;
  k       text;
  kd      text;
begin
  if private.workspace_role() is null or private.history_denied_for_guest()
     or not private.clean_version_allowed(p_app_version) or not private.link_edit_version_allowed(p_app_version)
     or coalesce(array_length(p_pages, 1), 0) = 0 then
    return;
  end if;
  if array_length(p_pages, 1) > 20 then
    raise exception 'too_many_pages' using errcode = '22023';
  end if;
  for r in
    select u.id, u.page_id, u.link_id, u.n, u.app_version, u.bytes, u.update, u.device_hash, l as lk
    from public.public_link_updates u
    join public.public_links l on l.id = u.link_id
    where u.decided_at is null and u.page_id = any (p_pages)
      and l.revoked_at is null and l.level = 'edit' and (l.expires_at is null or l.expires_at > now())
    order by u.page_id, u.link_id, u.n
  loop
    k := r.page_id::text || r.link_id::text;
    kd := k || coalesce(encode(r.device_hash, 'hex'), '-');
    continue when k = any (blocked) or kd = any (stopped);
    -- El permiso y el link, una vez por (página, link).
    if not k = any (allowed) then
      if not private.sees_deleted(r.page_id) or private.link_page_level(r.lk, r.page_id) < 3 then
        blocked := blocked || k;
        continue;
      end if;
      allowed := allowed || k;
    end if;
    if r.app_version > v then
      stopped := stopped || kd;
      continue;
    end if;
    exit when total > 0 and total + r.bytes > 4194304;
    total := total + r.bytes;
    id := r.id; page_id := r.page_id; link_id := r.link_id; n := r.n;
    data := translate(encode(r.update, 'base64'), E'\n', '');
    return next;
    exit when total >= 4194304;
  end loop;
end;
$$;

-- Decidir (el mismo cuerpo): el orden se exige dentro de (página, link, dispositivo).
create or replace function public.link_admit(p_page_id uuid, p_app_version text, p_decisions jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v   numeric := private.version_num(p_app_version);
  d   jsonb;
  u   public.public_link_updates;
  l   public.public_links;
  s   bigint;
  m   text;
  ok  boolean;
  why text;
  res jsonb := '[]'::jsonb;
begin
  if p_page_id is null or not private.sees_deleted(p_page_id) or not private.clean_version_allowed(p_app_version)
     or not private.link_edit_version_allowed(p_app_version) then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  perform private.require_write_version();
  if jsonb_typeof(p_decisions) is distinct from 'array' or jsonb_array_length(p_decisions) > 200 then
    raise exception 'decisions_invalid' using errcode = '22023';
  end if;
  -- Como push_page_update: la fila de la página bloqueada, el seq correlativo.
  perform 1 from public.pages where id = p_page_id for update;
  for d in select x from jsonb_array_elements(p_decisions) x loop
    select * into u from public.public_link_updates x where x.id = (d ->> 'id')::uuid and x.page_id = p_page_id for update;
    if not found then
      raise exception 'admit_not_found' using errcode = 'P0002';
    end if;
    if u.decided_at is not null then
      -- Otro editor ya la decidió: su decisión vale.
      res := res || jsonb_strip_nulls(jsonb_build_object('id', u.id, 'decision', u.decision, 'seq', u.admitted_seq,
                                                         'reason', u.reason));
      exit when (u.decision = 'admitted') is distinct from coalesce((d ->> 'ok')::boolean, false);
      continue;
    end if;
    if exists (select 1 from public.public_link_updates x
               where x.page_id = u.page_id and x.link_id = u.link_id and x.device_hash is not distinct from u.device_hash
                 and x.n < u.n and x.decided_at is null) then
      raise exception 'admit_out_of_order' using errcode = 'P0001';
    end if;
    if u.app_version > v then
      raise exception 'admit_version' using errcode = 'P0001';
    end if;
    select * into l from public.public_links x where x.id = u.link_id;
    if private.link_page_level(l, u.page_id) < 3 then
      -- El link dejó de editar esta página por algo que puede volver (vencido, permiso, papelera, afuera, Can view):
      -- queda retenida, sin decidir.
      res := res || jsonb_build_object('id', u.id, 'decision', 'held');
      exit;
    end if;
    ok := coalesce((d ->> 'ok')::boolean, false);
    why := nullif(left(btrim(coalesce(d ->> 'reason', '')), 40), '');
    if ok then
      -- Cada archivo de la fila otra vez, en la base: el editor no decide solo qué archivos se abren al link.
      for m in select jsonb_array_elements_text(case when jsonb_typeof(d -> 'media') = 'array' then d -> 'media'
                                                     else '[]'::jsonb end) loop
        if m !~ '^[0-9a-f-]{36}$' or not private.link_media_allowed(l, m::uuid) then
          ok := false;
          why := 'foreign_media';
          exit;
        end if;
      end loop;
      if not ok then
        -- Apartada aunque el editor dijo que sí: se corta acá (lo que sigue se probó con esta fila adentro).
        update public.public_link_updates
        set decided_at = now(), decided_by = auth.uid(), decision = 'aside', reason = why
        where id = u.id;
        res := res || jsonb_build_object('id', u.id, 'decision', 'aside', 'reason', why);
        exit;
      end if;
    end if;
    if ok then
      update public.pages set update_seq = update_seq + 1 where id = p_page_id returning update_seq into s;
      insert into public.page_updates (page_id, seq, client_update_id, update, created_by, plink_id, plink_author,
                                       plink_update_id)
      values (p_page_id, s, u.id, u.update, null, u.link_id, u.author, u.id);
      update public.public_link_updates
      set decided_at = now(), decided_by = auth.uid(), decision = 'admitted', admitted_seq = s, update = null
      where id = u.id;
      res := res || jsonb_build_object('id', u.id, 'decision', 'admitted', 'seq', s);
    else
      update public.public_link_updates
      set decided_at = now(), decided_by = auth.uid(), decision = 'aside', reason = coalesce(why, 'unspecified')
      where id = u.id;
      res := res || jsonb_build_object('id', u.id, 'decision', 'aside', 'reason', coalesce(why, 'unspecified'));
    end if;
  end loop;
  return res;
end;
$$;

-- El índice de lo que espera, con el dispositivo (el orden de `link_admit` mira por él).
create index plu_waiting_device_idx on public.public_link_updates (page_id, link_id, device_hash, n) where decided_at is null;

-- ---------------------------------------------------------------------------------------------------
-- 3. Versión de la base: la app pide lo apartado desde la 20. Nada cambia para la versión publicada.
-- ---------------------------------------------------------------------------------------------------
update public.workspace_settings set schema_version = 20 where id and schema_version < 20;

notify pgrst, 'reload schema';
