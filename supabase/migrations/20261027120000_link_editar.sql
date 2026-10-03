-- LGA Shot Docs · link público, entrega 2a: Can edit (escribir). Diseño: Docs/Doc_Link_Publico.md, "Entrega 2: Can
-- edit (rediseño 2026-10-02)", E2.2 a E2.11.
--
-- Lo que escribe un link NO entra a `page_updates`: va a una sala de espera (`public_link_updates`), con topes por
-- bytes. El dispositivo de un editor que ya arma las bases limpias (D14) lo prueba en orden sobre las filas del
-- servidor y se lo dice a la base (`link_admit`): la base mueve los bytes de la sala a `page_updates` (con `plink_id`
-- y el nombre del visitante) o anota la fila como apartada, con el motivo. Una sola decisión, guardada en la base, para
-- todos los dispositivos. Nada se borra: lo apartado y lo retenido quedan en la sala con sus bytes.
--
-- Se prende con su propio interruptor (`workspace_settings.link_edit_min_version`), que esta migración deja APAGADO:
-- con él nulo, Can edit no se puede elegir (`edit_off`), `plink_push_page_update` rechaza y `plink_open` da Can view.
-- No se prende hasta que la barrera de error alrededor del editor de la página esté publicada (R4 del diseño).
--
-- Compatible con las versiones publicadas: no cambia ninguna función que usen para bajar o subir contenido
-- (`pull_page_updates`, `pull_page_content`, `push_page_update`, `push_clean_base`, compactar); las filas admitidas son
-- filas comunes con `created_by` nulo; `page_history` suma una columna al final (la versión publicada la ignora).

-- ---------------------------------------------------------------------------------------------------
-- 1. El interruptor y la versión
-- ---------------------------------------------------------------------------------------------------
alter table public.workspace_settings
  add column link_edit_min_version numeric(8,3) check (link_edit_min_version is null or link_edit_min_version > 0);

-- La versión de la app como número, o nula si no tiene la forma.
create function private.version_num(p_version text)
returns numeric
language sql immutable set search_path = ''
as $$
  select case when p_version ~ '^[0-9]{1,4}(\.[0-9]{1,3})?$' then p_version::numeric end;
$$;

-- ¿Esta versión puede escribir por un link, o admitir? La mínima del workspace y el interruptor de Can edit.
create function private.link_edit_version_allowed(p_version text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select s.link_edit_min_version is not null
       and private.app_version_allowed(p_version)
       and coalesce(private.version_num(p_version) >= s.link_edit_min_version, false)
    from public.workspace_settings s where s.id), false);
$$;

-- Los topes de la entrega 1 y dos claves más: lo que espera sin decidir por link (`waiting_bytes`, 20 MB) y el tamaño de
-- un archivo de un link (`file_max_bytes`, para la entrega 2b).
create or replace function private.plink_limit(p_key text)
returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select case when jsonb_typeof(s.link_limits -> p_key) = 'number' then (s.link_limits ->> p_key)::numeric::bigint end
     from public.workspace_settings s where s.id),
    ('{"open": 300, "pull_bytes": 52428800, "all_pull_bytes": 157286400, "all_month_pull_bytes": 2147483648,
       "pass": 3000, "all_pass": 20000, "comment": 200, "comment_bytes": 1048576, "life_comment_bytes": 10485760,
       "push": 2000, "push_bytes": 20971520, "all_push_bytes": 52428800, "life_push_bytes": 104857600,
       "push_max_bytes": 1048576, "waiting_bytes": 20971520, "file": 100, "life_files": 500,
       "upload_bytes": 1073741824, "life_upload_bytes": 5368709120, "file_max_bytes": 524288000,
       "db_guard_bytes": 367001600}'::jsonb ->> p_key)::bigint);
$$;

-- ---------------------------------------------------------------------------------------------------
-- 2. La sala de espera
-- ---------------------------------------------------------------------------------------------------
create table public.public_link_updates (
  id               uuid primary key default gen_random_uuid(),
  -- El orden de llegada (la admisión va en este orden por página y link).
  n                bigint generated always as identity unique,
  link_id          uuid not null references public.public_links (id),
  page_id          uuid not null references public.pages (id),
  client_update_id uuid not null,
  update           bytea check (update is null or octet_length(update) between 1 and 8388608),
  bytes            int not null check (bytes > 0),
  author           text not null check (char_length(author) between 1 and 60),
  device_hash      bytea check (octet_length(device_hash) = 32),
  app_version      numeric(8,3) not null,
  created_at       timestamptz not null default now(),
  decided_at       timestamptz,
  decided_by       uuid references auth.users (id) on delete set null,
  decision         text check (decision in ('admitted', 'aside')),
  reason           text check (char_length(reason) between 1 and 40),
  admitted_seq     bigint,
  constraint plu_once unique (link_id, page_id, client_update_id),
  constraint plu_decided check ((decided_at is null) = (decision is null)),
  -- Admitida: los bytes se movieron a page_updates. Si no: siguen acá, para siempre.
  constraint plu_bytes check (case when decision = 'admitted' then update is null and admitted_seq is not null
                                   else update is not null end)
);
create index plu_waiting_idx on public.public_link_updates (page_id, link_id, n) where decided_at is null;
create index plu_link_waiting_idx on public.public_link_updates (link_id) where decided_at is null;
create index plu_aside_idx on public.public_link_updates (page_id) where decision = 'aside';
create index plu_link_idx on public.public_link_updates (link_id, decision);
alter table public.public_link_updates enable row level security;
-- Todo por funciones: ninguna política, ningún permiso.
revoke all on public.public_link_updates from public, anon, authenticated;

-- La autoría de una fila admitida (como los comentarios del link): `created_by` nulo.
alter table public.page_updates
  add column plink_id        uuid references public.public_links (id),
  add column plink_author    text check (char_length(plink_author) between 1 and 60),
  add column plink_update_id uuid unique references public.public_link_updates (id),
  add constraint page_updates_plink check ((plink_id is null) = (plink_author is null)
                                           and (plink_id is null) = (plink_update_id is null)),
  add constraint page_updates_plink_no_author check (plink_id is null or created_by is null);

-- ---------------------------------------------------------------------------------------------------
-- 3. El nivel de un link dado (sin el header): lo usan el visitante (con su link) y la admisión (con el de la fila)
-- ---------------------------------------------------------------------------------------------------
-- 2 (Can view) o 3 (Can edit) si el link anda (sin revocar, sin vencer, su creador todavía comparte la página), su raíz
-- está en la cadena de `p` hacia arriba, nada de la cadena está en la papelera y el proyecto no está borrado; si no, 0.
create function private.link_page_level(l public.public_links, p uuid)
returns int
language plpgsql stable security definer set search_path = ''
as $$
declare
  under    boolean;
  in_trash boolean;
  pdel     boolean;
begin
  if l.id is null or p is null or l.revoked_at is not null
     or (l.expires_at is not null and l.expires_at <= now())
     or l.created_by is null or not private.user_can_share_page(l.page_id, l.created_by) then
    return 0;
  end if;
  with recursive chain (id, parent_id, deleted_at, depth) as (
    select pg.id, pg.parent_id, pg.deleted_at, 0 from public.pages pg where pg.id = p
    union all
    select pg.id, pg.parent_id, pg.deleted_at, c.depth + 1
    from public.pages pg join chain c on pg.id = c.parent_id
    where c.depth < 10000
  )
  select exists (select 1 from chain c where c.id = l.page_id),
         exists (select 1 from chain c where c.deleted_at is not null),
         (select w.deleted_at is not null
          from public.pages pg join public.workspaces w on w.id = pg.workspace_id where pg.id = p)
  into under, in_trash, pdel;
  if not coalesce(under, false) or in_trash or coalesce(pdel, true) then
    return 0;
  end if;
  return case l.level when 'edit' then 3 else 2 end;
end;
$$;

-- La de la entrega 1, sobre la regla única (mismo resultado: `current_plink` ya filtra lo que no anda).
create or replace function private.plink_page_level(p uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select private.link_page_level(private.current_plink(), p);
$$;

-- La rama de un link dado: la raíz y lo que cuelga de ella sin pasar por la papelera; nada si el link no anda.
create function private.link_branch(l public.public_links)
returns setof uuid
language plpgsql stable security definer set search_path = ''
as $$
begin
  if l.id is null or private.link_page_level(l, l.page_id) = 0 then
    return;
  end if;
  return query
    with recursive sub (id, depth) as (
      select l.page_id, 0
      union
      select pg.id, s.depth + 1 from public.pages pg join sub s on pg.parent_id = s.id
      where pg.deleted_at is null and s.depth < 10000
    )
    select s.id from sub s;
end;
$$;

create or replace function private.plink_branch()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select private.link_branch(private.current_plink());
$$;

-- ¿El link puede poner este archivo en una fila? Lo usa HOY una página de su rama (sin `removed_at` ni `is_foreign`;
-- LE9-B). En la 2b, también lo que registró él (`files.plink_id`). Lo de afuera de la rama nunca, ni una foto sacada:
-- el editor que reconcilia la vincularía y `plink_file_level` se la abriría al link (B4 de la auditoría: el id de una
-- foto sacada con anotaciones queda en la base limpia, en la clave borrada de `photoMarkup`).
create function private.link_media_allowed(l public.public_links, f uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.page_files pf
    where pf.file_id = f and pf.removed_at is null and not pf.is_foreign
      and pf.page_id in (select private.link_branch(l)));
$$;

-- Lo que espera sin decidir de un link, solo en las páginas donde hoy edita (lo retenido de una página que salió de la
-- rama no frena para siempre). El nivel, una vez por página distinta.
create function private.link_waiting_bytes(l public.public_links)
returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(w.bytes), 0)::bigint
  from (select u.page_id, sum(u.bytes) as bytes
        from public.public_link_updates u
        where u.link_id = l.id and u.decided_at is null
        group by u.page_id) w
  where private.link_page_level(l, w.page_id) = 3;
$$;

-- Revocar y Reset: lo que espera de ese link pasa a apartado con `link_revoked`, en la misma transacción (B1 de la
-- auditoría). Revocar es final y Reset crea un link nuevo: lo del viejo no se admite nunca, ni traba nada. Sigue con sus
-- bytes, para bajar.
create function private.plink_aside_revoked(p_link uuid)
returns void
language sql volatile security definer set search_path = ''
as $$
  update public.public_link_updates
  set decided_at = now(), decided_by = auth.uid(), decision = 'aside', reason = 'link_revoked'
  where link_id = p_link and decided_at is null;
$$;

revoke all on function private.version_num(text) from public, anon, authenticated;
revoke all on function private.link_edit_version_allowed(text) from public, anon, authenticated;
revoke all on function private.link_page_level(public.public_links, uuid) from public, anon, authenticated;
revoke all on function private.link_branch(public.public_links) from public, anon, authenticated;
revoke all on function private.link_media_allowed(public.public_links, uuid) from public, anon, authenticated;
revoke all on function private.link_waiting_bytes(public.public_links) from public, anon, authenticated;
revoke all on function private.plink_aside_revoked(uuid) from public, anon, authenticated;

-- Sacar a alguien del workspace revoca sus links y aparta lo que esperaba de ellos. Como en la entrega 1, con eso.
create or replace function public.remove_member(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  my_role     text := private.workspace_role();
  cur         public.members;
  ws          uuid;
  heir        uuid;
  lid         uuid;
  transferred jsonb := '[]'::jsonb;
  orphans     jsonb := '[]'::jsonb;
begin
  if my_role is null or my_role not in ('owner', 'admin') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select * into cur from public.members m where m.user_id = p_user for update;
  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
  if cur.removed_at is not null then
    return jsonb_build_object('transferred', transferred, 'without_heir', orphans);
  end if;
  if cur.role = 'owner' then
    raise exception 'owner_cannot_change' using errcode = '42501';
  end if;
  if cur.role = 'admin' and my_role <> 'owner' then
    raise exception 'not_allowed' using errcode = '42501', hint = 'Only the owner of the workspace removes admins.';
  end if;

  update public.members set removed_at = now() where user_id = p_user;
  for lid in
    update public.public_links set revoked_at = now(), revoked_by = auth.uid()
    where created_by = p_user and revoked_at is null
    returning id
  loop
    perform private.plink_aside_revoked(lid);
  end loop;

  for ws in select w.id from public.workspaces w where w.owner_id = p_user order by w.created_at, w.id loop
    continue when not exists (
      select 1 from public.grants g
      join public.members m on m.user_id = g.user_id and m.removed_at is null
      where g.user_id <> p_user and g.revoked_at is null
        and (g.project_id = ws
             or g.page_id in (select pg.id from public.pages pg where pg.workspace_id = ws)));
    heir := null;
    select g.user_id into heir
    from public.grants g
    join public.members m on m.user_id = g.user_id and m.removed_at is null and m.role in ('owner', 'admin')
    where g.user_id <> p_user and g.revoked_at is null and g.project_id = ws
    order by private.grant_level_value(g.level) desc, (m.role = 'owner') desc, g.created_at, g.user_id
    limit 1;
    if heir is not null then
      update public.workspaces set owner_id = heir where id = ws;
      transferred := transferred || jsonb_build_object('project_id', ws, 'to', heir);
    else
      orphans := orphans || to_jsonb(ws);
    end if;
  end loop;
  return jsonb_build_object('transferred', transferred, 'without_heir', orphans);
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 4. Lo que llama el visitante
-- ---------------------------------------------------------------------------------------------------
-- Escribir: a la sala, nunca a page_updates. Devuelve 0 (no hay seq todavía). Idempotente antes de cualquier tope (el
-- mismo pedido otra vez no cuenta nada). En una transacción: lo rechazado no suma.
create function public.plink_push_page_update(
  p_page_id uuid, p_client_update_id uuid, p_update text, p_app_version text, p_author text)
returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare
  l    public.public_links := private.current_plink();
  name text := btrim(p_author);
  bin  bytea;
  over boolean;
begin
  if l.id is null then
    raise exception 'link_not_found' using errcode = 'P0002';
  end if;
  if p_client_update_id is null or private.link_page_level(l, p_page_id) < 3 then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  -- Dos pedidos iguales a la vez: el segundo espera y sale por la idempotencia.
  perform pg_advisory_xact_lock(hashtextextended('plink_push:' || l.id::text || p_page_id::text, 0));
  if exists (select 1 from public.public_link_updates u
             where u.link_id = l.id and u.page_id = p_page_id and u.client_update_id = p_client_update_id) then
    return 0;
  end if;
  if not private.link_edit_version_allowed(p_app_version) then
    raise exception 'app_outdated' using errcode = 'P0001',
      hint = 'This version of the app is too old for this workspace. Reload the app to update it.';
  end if;
  if name is null or char_length(name) not between 1 and 60
     or name ~ '[[:cntrl:]؜​-‏  ‪-‮⁠-⁩﻿]' then
    raise exception 'author_invalid' using errcode = '22023';
  end if;
  bin := decode(p_update, 'base64');
  if bin is null or length(bin) = 0 or length(bin) > private.plink_limit('push_max_bytes') then
    raise exception 'update_size_invalid' using errcode = '22023';
  end if;
  perform private.plink_db_guard();
  if private.link_waiting_bytes(l) + length(bin) > private.plink_limit('waiting_bytes') then
    raise exception 'link_rate_limited' using errcode = 'P0001', detail = 'waiting_bytes';
  end if;
  update public.public_links set push_bytes_total = push_bytes_total + length(bin)
  where id = l.id
  returning push_bytes_total > private.plink_limit('life_push_bytes') into over;
  if over then
    raise exception 'link_rate_limited' using errcode = 'P0001', detail = 'life_push_bytes';
  end if;
  perform private.plink_count('push', 1, length(bin));
  insert into public.public_link_updates (link_id, page_id, client_update_id, update, bytes, author, device_hash,
                                          app_version)
  values (l.id, p_page_id, p_client_update_id, bin, length(bin), name, private.plink_device_hash(),
          private.version_num(p_app_version));
  return 0;
end;
$$;

-- Cómo van las de este link y este dispositivo, por página: cuántas esperan y cuántas se apartaron. Cuenta como un pase
-- (`pass`, que tiene tope de cantidad por día; observación 7 y R2 de la re-verificación). VOLATILE: escribe la cuenta.
create function public.plink_push_status()
returns table (page_id uuid, waiting int, aside int)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  l   public.public_links := private.current_plink();
  dev bytea := private.plink_device_hash();
  out_rows jsonb;
begin
  if l.id is null then
    raise exception 'link_not_found' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('page_id', s.page_id, 'waiting', s.waiting, 'aside', s.aside)), '[]')
  into out_rows
  from (select u.page_id, (count(*) filter (where u.decided_at is null))::int as waiting,
               (count(*) filter (where u.decision = 'aside'))::int as aside
        from public.public_link_updates u
        where u.link_id = l.id and dev is not null and u.device_hash = dev
          and (u.decided_at is null or u.decision = 'aside')
        group by u.page_id
        limit 500) s;
  perform private.plink_count('pass', 1, octet_length(out_rows::text));
  return query
    select (r ->> 'page_id')::uuid, (r ->> 'waiting')::int, (r ->> 'aside')::int
    from jsonb_array_elements(out_rows) r;
end;
$$;

-- Abrir: el cuerpo de la entrega 1 y un cambio en lo que devuelve: `level` es el nivel que esta versión puede usar (una
-- app más vieja que el interruptor, o con el interruptor apagado, ve Can view); `link_level`, el del link.
create or replace function public.plink_open(p_app_version text default null)
returns json
language plpgsql volatile security definer set search_path = ''
as $$
declare
  l public.public_links := private.current_plink();
  s record;
  pg_row record;
begin
  if l.id is null or private.plink_page_level(l.page_id) = 0 then
    raise exception 'link_not_found' using errcode = 'P0002';
  end if;
  perform private.plink_count('open');
  select ws.min_app_version, ws.schema_version, ws.clean_min_version, ws.media_url
  into s from public.workspace_settings ws where ws.id;
  select pg.title into pg_row from public.pages pg where pg.id = l.page_id;
  return json_build_object(
    'link_id', l.id,
    'page_id', l.page_id,
    'title', pg_row.title,
    'level', case when l.level = 'edit' and private.link_edit_version_allowed(p_app_version) then 'edit' else 'comment' end,
    'link_level', l.level,
    'expires_at', l.expires_at,
    'min_app_version', s.min_app_version,
    'schema_version', s.schema_version,
    'clean_on', s.clean_min_version is not null,
    'media_url', s.media_url,
    'outdated', p_app_version is not null and not private.app_version_allowed(p_app_version));
end;
$$;

revoke all on function public.plink_push_page_update(uuid, uuid, text, text, text) from public, authenticated;
revoke all on function public.plink_push_status() from public, authenticated;
grant execute on function public.plink_push_page_update(uuid, uuid, text, text, text) to anon;
grant execute on function public.plink_push_status() to anon;

-- ---------------------------------------------------------------------------------------------------
-- 5. La admisión (authenticated: quien ve lo borrado y arma bases), en dos pasos (B2 de la auditoría)
-- ---------------------------------------------------------------------------------------------------
-- Paso 1, sin bytes: las páginas con algo para decidir. Agrupa por (página, link) entre las filas sin decidir de links
-- vigentes y filtra el permiso y el nivel por grupo ANTES del tope (B1: el tope de filas antes de filtrar dejaba que lo
-- retenido de una página trabara a todo el workspace). Lo retenido (link vencido, sin permiso, página afuera o en la
-- papelera, Can view) no aparece y no ocupa lugar. Una versión más vieja que la primera fila del grupo no la ve.
create function public.link_admit_pages(p_app_version text)
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
      group by u.page_id, u.link_id
    )
    select g.page_id, sum(g.waiting)::int, sum(g.bytes)::bigint
    from g join public.public_links l on l.id = g.link_id
    where g.first_version <= v and private.sees_deleted(g.page_id) and private.link_page_level(l, g.page_id) = 3
    group by g.page_id
    order by min(g.first_version), g.page_id
    limit 50;
end;
$$;

-- Paso 2, con bytes: solo de las páginas que el motor tiene listas (al día y sin nada propio sin subir). En orden por
-- (página, link); si una fila no se puede decidir (versión, link retenido), tampoco las siguientes de su (página,
-- link). Hasta 20 páginas y unos 4 MB.
create function public.link_admit_work(p_app_version text, p_pages uuid[])
returns table (id uuid, page_id uuid, link_id uuid, n bigint, data text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v       numeric := private.version_num(p_app_version);
  r       record;
  blocked text[] := '{}';
  allowed text[] := '{}';
  total   bigint := 0;
  k       text;
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
    select u.id, u.page_id, u.link_id, u.n, u.app_version, u.bytes, u.update, l as lk
    from public.public_link_updates u
    join public.public_links l on l.id = u.link_id
    where u.decided_at is null and u.page_id = any (p_pages)
      and l.revoked_at is null and l.level = 'edit' and (l.expires_at is null or l.expires_at > now())
    order by u.page_id, u.link_id, u.n
  loop
    k := r.page_id::text || r.link_id::text;
    continue when k = any (blocked);
    -- El permiso y el link, una vez por (página, link).
    if not k = any (allowed) then
      if not private.sees_deleted(r.page_id) or private.link_page_level(r.lk, r.page_id) < 3 then
        blocked := blocked || k;
        continue;
      end if;
      allowed := allowed || k;
    end if;
    if r.app_version > v then
      blocked := blocked || k;
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

-- Decidir, en orden, las filas de una página. `p_decisions`: [{"id", "ok": true|false, "reason", "media": [ids]}].
-- Devuelve [{"id", "decision": "admitted"|"aside"|"held", "seq"?, "reason"?}]. Si otro editor ya decidió una fila,
-- devuelve su decisión (dos editores a la vez no se pisan). Al admitir, los bytes se MUEVEN de la sala a `page_updates`
-- (el editor nunca los vuelve a subir ni los puede cambiar), con `created_by` nulo.
-- Corta (no decide nada más de la lista) en la primera retenida y en la primera cuya decisión no es la que pidió el
-- editor (otro ya la decidió distinto, o un archivo no vale): lo que sigue se probó sobre una página que no es la real,
-- y el editor lo vuelve a probar en la vuelta siguiente.
create function public.link_admit(p_page_id uuid, p_app_version text, p_decisions jsonb)
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
               where x.page_id = u.page_id and x.link_id = u.link_id and x.n < u.n and x.decided_at is null) then
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

-- Lo apartado, lo retenido y lo que espera en una página, para quien la ve con lo borrado (el aviso de la página).
create function public.public_link_updates_of(p_page_id uuid)
returns table (id uuid, link_id uuid, author text, created_at timestamptz, bytes int, state text, reason text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.sees_deleted(p_page_id) then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  -- El nivel una vez por link de la página, no por fila (observación 6).
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
           u.reason
    from public.public_link_updates u
    where u.page_id = p_page_id and (u.decided_at is null or u.decision = 'aside')
    order by u.n
    limit 500;
end;
$$;

-- Los bytes de una fila apartada o retenida, para "Download it" (nunca se aplican).
create function public.public_link_update_bytes(p_id uuid)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  u public.public_link_updates;
begin
  select * into u from public.public_link_updates x where x.id = p_id;
  if not found or u.update is null or not private.sees_deleted(u.page_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return translate(encode(u.update, 'base64'), E'\n', '');
end;
$$;

revoke all on function public.link_admit_pages(text) from public, anon;
revoke all on function public.link_admit_work(text, uuid[]) from public, anon;
revoke all on function public.link_admit(uuid, text, jsonb) from public, anon;
revoke all on function public.public_link_updates_of(uuid) from public, anon;
revoke all on function public.public_link_update_bytes(uuid) from public, anon;
grant execute on function public.link_admit_pages(text) to authenticated;
grant execute on function public.link_admit_work(text, uuid[]) to authenticated;
grant execute on function public.link_admit(uuid, text, jsonb) to authenticated;
grant execute on function public.public_link_updates_of(uuid) to authenticated;
grant execute on function public.public_link_update_bytes(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 6. Quien comparte: Can edit con el interruptor prendido
-- ---------------------------------------------------------------------------------------------------
-- El nivel que piden crear o cambiar. 'edit' solo con el interruptor (`edit_off` si no).
create function private.public_link_level_ok(p_level text)
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_level is null or p_level not in ('comment', 'edit') then
    raise exception 'level_invalid' using errcode = '22023';
  end if;
  if p_level = 'edit' and (select s.link_edit_min_version from public.workspace_settings s where s.id) is null then
    raise exception 'edit_off' using errcode = 'P0001',
      hint = 'Editing through a link is not turned on for this workspace yet.';
  end if;
end;
$$;

revoke all on function private.public_link_level_ok(text) from public, anon, authenticated;

-- El link de una página, con su token, para quien la comparte. Como la entrega 1, con lo de escribir: `limited` cuenta
-- también las subidas, y `edits` dice cuánto espera, cuánto está retenido, cuánto se apartó y cuánto entró hoy (el nivel,
-- una vez por página distinta, no por fila: observación 6). Lo de un link revocado ya está apartado (`link_revoked`).
create or replace function private.public_link_json(l public.public_links)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', l.id, 'page_id', l.page_id, 'level', l.level, 'created_at', l.created_at, 'expires_at', l.expires_at,
    'created_by', l.created_by,
    'created_by_name', (select nullif(split_part(u.email, '@', 1), '') from auth.users u where u.id = l.created_by),
    'token', l.token,
    -- Anda hoy: no venció y quien lo creó todavía puede compartir (la raíz en la papelera, aparte).
    'alive', (l.expires_at is null or l.expires_at > now()) and l.created_by is not null
             and private.user_can_share_page(l.page_id, l.created_by),
    'usage_today', coalesce((
      select jsonb_object_agg(u.kind, jsonb_build_object('n', u.n, 'bytes', u.bytes))
      from public.public_link_usage u where u.link_id = l.id and u.day = current_date), '{}'::jsonb),
    'limited', exists (
      select 1 from public.public_link_usage u
      where u.link_id = l.id and u.day = current_date
        and ((u.kind = 'open' and u.n >= private.plink_limit('open'))
             or (u.kind = 'pull' and u.bytes >= private.plink_limit('pull_bytes'))
             or (u.kind = 'pass' and u.n >= private.plink_limit('pass'))
             or (u.kind = 'comment' and (u.n >= private.plink_limit('comment')
                                         or u.bytes >= private.plink_limit('comment_bytes')))
             or (u.kind = 'push' and (u.n >= private.plink_limit('push')
                                      or u.bytes >= private.plink_limit('push_bytes'))))),
    'comments', (select count(*) from public.comments c where c.plink_id = l.id and c.deleted_at is null),
    'edits', (select jsonb_build_object(
        'waiting', coalesce(sum(x.n) filter (where x.state = 'waiting'), 0),
        'held', coalesce(sum(x.n) filter (where x.state = 'held'), 0),
        'aside', (select count(*) from public.public_link_updates a where a.link_id = l.id and a.decision = 'aside'),
        'admitted_today', (select count(*) from public.public_link_updates a
                           where a.link_id = l.id and a.decision = 'admitted' and a.decided_at >= current_date),
        'push_bytes_total', l.push_bytes_total)
      from (select case when private.link_page_level(l, w.page_id) = 3 then 'waiting' else 'held' end as state, w.n
            from (select u.page_id, count(*) as n from public.public_link_updates u
                  where u.link_id = l.id and u.decided_at is null group by u.page_id) w) x));
$$;

-- Crea el link vivo de la página (o devuelve el que ya hay). Como la entrega 1, con 'edit' si el interruptor está
-- prendido. Reinicia la base de la rama (como compartir con alguien que no ve lo borrado).
create or replace function public.create_public_link(p_id uuid, p_page uuid, p_level text, p_expires timestamptz default null)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  l public.public_links;
  t text;
begin
  perform private.public_link_guard(p_page);
  perform private.public_link_level_ok(p_level);
  if private.clean_min_version() is null then
    raise exception 'clean_off' using errcode = 'P0001',
      hint = 'Links need the workspace setting that keeps deleted text out of shared pages.';
  end if;
  if p_id is null or (p_expires is not null and p_expires <= now()) then
    raise exception 'link_invalid' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('public_link:' || p_page::text, 0));
  select * into l from public.public_links pl where pl.page_id = p_page and pl.revoked_at is null;
  if found then
    return private.public_link_json(l);
  end if;
  if exists (select 1 from public.public_links pl where pl.id = p_id) then
    raise exception 'link_invalid' using errcode = '22023';
  end if;
  t := private.new_link_token();
  insert into public.public_links (id, page_id, token, token_hash, level, created_by, expires_at)
  values (p_id, p_page, t, extensions.digest(t, 'sha256'), p_level, auth.uid(), p_expires)
  returning * into l;
  perform private.clean_reset(null, p_page);
  return private.public_link_json(l);
end;
$$;

-- Cambia el nivel ('edit' con el interruptor) y el vencimiento del link vivo; conserva el token. Pasar de 'edit' a
-- 'comment' o al revés no reinicia nada (los dos niveles reciben solo bases). Revivir un link vencido sí reinicia la
-- rama: no sirve la base de antes (observación del roadmap).
create or replace function public.set_public_link(p_page uuid, p_level text, p_expires timestamptz default null)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  l   public.public_links;
  was timestamptz;
begin
  perform private.public_link_guard(p_page);
  perform private.public_link_level_ok(p_level);
  if p_expires is not null and p_expires <= now() then
    raise exception 'link_invalid' using errcode = '22023';
  end if;
  select pl.expires_at into was from public.public_links pl where pl.page_id = p_page and pl.revoked_at is null for update;
  update public.public_links pl set level = p_level, expires_at = p_expires
  where pl.page_id = p_page and pl.revoked_at is null
  returning * into l;
  if not found then
    raise exception 'link_not_found' using errcode = 'P0002';
  end if;
  if was is not null and was <= now() then
    perform private.clean_reset(null, p_page);
  end if;
  return private.public_link_json(l);
end;
$$;

-- Reset link: revoca el vivo, aparta lo que esperaba de él (`link_revoked`) y crea otro con el mismo nivel y
-- vencimiento; el viejo deja de andar en el acto. Como la entrega 1, con lo de apartar.
create or replace function public.reset_public_link(p_page uuid, p_new_id uuid)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  old public.public_links;
  l   public.public_links;
  t   text;
begin
  perform private.public_link_guard(p_page);
  if private.clean_min_version() is null then
    raise exception 'clean_off' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('public_link:' || p_page::text, 0));
  -- Reintentar el mismo reset no crea un tercero.
  select * into l from public.public_links pl where pl.id = p_new_id and pl.page_id = p_page and pl.revoked_at is null;
  if found then
    return private.public_link_json(l);
  end if;
  update public.public_links pl set revoked_at = now(), revoked_by = auth.uid()
  where pl.page_id = p_page and pl.revoked_at is null
  returning * into old;
  if not found then
    raise exception 'link_not_found' using errcode = 'P0002';
  end if;
  perform private.plink_aside_revoked(old.id);
  if p_new_id is null or exists (select 1 from public.public_links pl where pl.id = p_new_id) then
    raise exception 'link_invalid' using errcode = '22023';
  end if;
  t := private.new_link_token();
  insert into public.public_links (id, page_id, token, token_hash, level, created_by, expires_at)
  values (p_new_id, p_page, t, extensions.digest(t, 'sha256'), old.level, auth.uid(),
          case when old.expires_at > now() then old.expires_at end)
  returning * into l;
  -- Como crear: el link nuevo no recibe una base armada antes de lo que se borró después.
  perform private.clean_reset(null, p_page);
  return private.public_link_json(l);
end;
$$;

-- Apaga el link vivo (Restricted) y aparta lo que esperaba de él. Idempotente: sin link vivo no hace nada.
create or replace function public.revoke_public_link(p_page uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  lid uuid;
begin
  perform private.public_link_guard(p_page);
  for lid in
    update public.public_links set revoked_at = now(), revoked_by = auth.uid()
    where page_id = p_page and revoked_at is null
    returning id
  loop
    perform private.plink_aside_revoked(lid);
  end loop;
end;
$$;

-- Lo que muestra Share. Como la entrega 1, con `edit_on`: el interruptor de Can edit está prendido.
create or replace function public.get_public_link(p_page uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  l     public.public_links;
  above public.public_links;
begin
  if p_page is null or not private.can_share(null, p_page) then
    return null;
  end if;
  select * into l from public.public_links pl where pl.page_id = p_page and pl.revoked_at is null;
  with recursive chain (id, parent_id, depth) as (
    select pg.id, pg.parent_id, 0 from public.pages pg where pg.id = p_page
    union all
    select pg.id, pg.parent_id, c.depth + 1
    from public.pages pg join chain c on pg.id = c.parent_id
    where c.depth < 10000
  )
  select pl.* into above
  from chain c join public.public_links pl on pl.page_id = c.id and pl.revoked_at is null
  where c.depth > 0
  order by c.depth
  limit 1;
  return jsonb_build_object(
    'clean_on', private.clean_min_version() is not null,
    'edit_on', (select s.link_edit_min_version is not null from public.workspace_settings s where s.id),
    'link', case when l.id is not null then private.public_link_json(l) end,
    'above', case when above.id is not null then jsonb_build_object(
      'page_id', above.page_id, 'level', above.level,
      'title', case when private.page_level(above.page_id) >= 1
                    then (select pg.title from public.pages pg where pg.id = above.page_id) end) end);
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 7. El historial: quién escribió una fila del link (al final; la versión publicada lo ignora)
-- ---------------------------------------------------------------------------------------------------
drop function public.page_history(uuid, bigint, int);

create function public.page_history(p_page_id uuid, p_after_seq bigint, p_limit int default 500)
returns table (id bigint, seq bigint, created_by uuid, created_at timestamptz, update text, plink_author text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.check_history(p_page_id);
  return query
    select u.id, u.seq, u.created_by, u.created_at, translate(encode(u.update, 'base64'), E'\n', ''), u.plink_author
    from public.page_updates u
    where u.page_id = p_page_id and u.seq > p_after_seq
    order by u.seq
    limit least(greatest(p_limit, 1), 1000);
end;
$$;

revoke all on function public.page_history(uuid, bigint, int) from public, anon;
grant execute on function public.page_history(uuid, bigint, int) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 8. Versión de la base: la app ofrece Can edit y admite desde la 19 (la 18 ya la usa
-- `20261026120000_comentarios_archivo.sql`). El interruptor queda apagado.
-- ---------------------------------------------------------------------------------------------------
update public.workspace_settings set schema_version = 19 where id and schema_version < 19;

notify pgrst, 'reload schema';
