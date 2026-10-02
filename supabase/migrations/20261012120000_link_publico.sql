-- LGA Shot Docs · link público, entrega 1: "Anyone with the link" con Can view (que comenta). Diseño:
-- Docs/Doc_Link_Publico.md (secciones 3 y 4).
--
-- Un link le da a quien lo tiene, sin cuenta, Comentar sobre una página y lo de abajo (nunca lo de arriba ni lo del
-- costado). El token viaja en el header `x-shotdocs-link` con el rol `anon` de Supabase y se valida en cada pedido
-- (`private.current_plink`). Ninguna tabla se abre a `anon`: el visitante lee y comenta solo por las funciones `plink_*`,
-- que cuentan lo que gastan (topes por link, por día, de todos los links y de por vida; `workspace_settings.link_limits`).
-- Recibe siempre la base limpia de D14 (nunca filas de `page_updates`): por eso un link solo se crea con el interruptor
-- de D14 prendido (D33). Nada se borra: un link revocado queda con `revoked_at`.
--
-- La entrega 2 (Can edit: escribir y subir archivos, con la cuarentena) no está acá: `create_public_link` solo acepta
-- 'comment'.
--
-- Compatible con las versiones publicadas: todas las funciones son nuevas salvo `list_comments` (suma dos columnas al
-- final, que una versión anterior ignora: muestra un comentario de un link como de una cuenta borrada),
-- `private.can_share` (misma regla, ahora en `private.user_can_share_page`, más "nunca un invitado"), `remove_member`
-- (además revoca los links de quien se va), `private.has_plain_readers` y `clean_work` (las ramas con link también
-- arman bases). Necesita `pgcrypto` (`extensions.digest`, `extensions.gen_random_bytes`), que Supabase ya trae.

-- ---------------------------------------------------------------------------------------------------
-- 1. Links, uso y topes
-- ---------------------------------------------------------------------------------------------------
create table public.public_links (
  -- Lo crea el dispositivo: reintentar con el mismo id no crea otro.
  id                  uuid primary key,
  page_id             uuid not null references public.pages (id),
  -- `sdl_` + 43 caracteres base64url (32 bytes al azar, los genera la base). Se guarda para que quien comparte lo
  -- vuelva a copiar (`get_public_link`); se busca por la huella.
  token               text not null unique check (token ~ '^sdl_[A-Za-z0-9_-]{43}$'),
  token_hash          bytea not null unique check (octet_length(token_hash) = 32),
  level               text not null check (level in ('comment', 'edit')),
  -- Nulo: la cuenta se borró y el link no anda.
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz check (expires_at is null or expires_at > created_at),
  revoked_at          timestamptz,
  revoked_by          uuid references auth.users (id) on delete set null,
  -- De por vida (entrega 2 para lo que sube; los comentarios desde ya).
  push_bytes_total    bigint not null default 0,
  files_total         int not null default 0,
  upload_bytes_total  bigint not null default 0,
  comment_bytes_total bigint not null default 0,
  constraint public_links_revoked_by check (revoked_by is null or revoked_at is not null)
);
-- Un link vivo por página.
create unique index public_links_one_live on public.public_links (page_id) where revoked_at is null;
create index public_links_created_by_idx on public.public_links (created_by) where revoked_at is null;

-- Por link, día y tipo: cuántas veces y cuántos bytes.
create table public.public_link_usage (
  link_id uuid not null references public.public_links (id),
  day     date not null,
  kind    text not null check (kind in ('open', 'pull', 'pass', 'comment', 'push', 'file', 'upload')),
  n       bigint not null default 0,
  bytes   bigint not null default 0,
  primary key (link_id, day, kind)
);

-- Lo mismo sumando todos los links (los topes totales y el mensual de bajadas).
create table public.public_link_usage_all (
  day   date not null,
  kind  text not null check (kind in ('open', 'pull', 'pass', 'comment', 'push', 'file', 'upload')),
  n     bigint not null default 0,
  bytes bigint not null default 0,
  primary key (day, kind)
);

-- El tamaño de las bases, recordado 10 minutos (`private.db_bytes`).
create table private.db_guard (
  id    boolean primary key default true check (id),
  bytes bigint not null,
  at    timestamptz not null
);

alter table public.public_links enable row level security;
alter table public.public_link_usage enable row level security;
alter table public.public_link_usage_all enable row level security;
alter table private.db_guard enable row level security;
-- Todo por funciones: ninguna política, ningún permiso.
revoke all on public.public_links from public, anon, authenticated;
revoke all on public.public_link_usage from public, anon, authenticated;
revoke all on public.public_link_usage_all from public, anon, authenticated;
revoke all on private.db_guard from public, anon, authenticated;

-- Los topes (Doc_Link_Publico.md, 3.13, con N1 y N2 de la re-verificación). Una clave con el nombre del tipo es la
-- cantidad por link y día; `<tipo>_bytes`, los bytes por link y día; `all_<...>`, lo mismo sumando todos los links;
-- `life_<...>`, de por vida por link; `all_month_pull_bytes`, las bajadas de todos los links en el mes (para dejar
-- margen en los 5 GB de egress del plan gratis); `db_guard_bytes`, el tamaño de las bases (todas, como mide Supabase)
-- desde el que nada que escriba un link entra.
alter table public.workspace_settings add column link_limits jsonb not null default '{}'::jsonb
  check (jsonb_typeof(link_limits) = 'object');

create function private.plink_limit(p_key text)
returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select case when jsonb_typeof(s.link_limits -> p_key) = 'number' then (s.link_limits ->> p_key)::numeric::bigint end
     from public.workspace_settings s where s.id),
    ('{"open": 300, "pull_bytes": 52428800, "all_pull_bytes": 157286400, "all_month_pull_bytes": 2147483648,
       "pass": 3000, "all_pass": 20000, "comment": 200, "comment_bytes": 1048576, "life_comment_bytes": 10485760,
       "push": 2000, "push_bytes": 20971520, "all_push_bytes": 52428800, "life_push_bytes": 104857600,
       "push_max_bytes": 1048576, "file": 100, "life_files": 500, "upload_bytes": 1073741824,
       "life_upload_bytes": 5368709120, "db_guard_bytes": 367001600}'::jsonb ->> p_key)::bigint);
$$;

-- Autoría sin cuenta (como los comentarios importados): `author_id` queda nulo. La huella del id de dispositivo sirve
-- para "este comentario es mío" (editar y borrar los propios), nunca da permisos.
alter table public.comments
  add column plink_id          uuid references public.public_links (id),
  add column plink_author      text check (char_length(plink_author) between 1 and 60),
  add column plink_device_hash bytea check (octet_length(plink_device_hash) = 32),
  add constraint comments_plink check ((plink_id is null) = (plink_author is null)),
  add constraint comments_plink_no_author check (plink_id is null or author_id is null);
create index comments_plink_idx on public.comments (plink_id) where plink_id is not null;
-- Como las demás columnas sin texto: se leen con la tabla (la política de `comments`). El nombre es lo que se muestra.
grant select (plink_id, plink_author) on public.comments to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 2. Quién comparte una página: UNA regla, para `can_share` y para que un link siga vivo
-- ---------------------------------------------------------------------------------------------------
-- Nivel 4 sobre la página, miembro activo que no es invitado, y dueño o admin del workspace o dueño del proyecto.
-- Para la sesión (`can_share`), `user_page_level` y `workspace_role` miran además que no haya entrado con contraseña.
create function private.user_can_share_page(p uuid, uid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select uid is not null
     and coalesce(private.workspace_role(uid) <> 'guest', false)
     and private.user_page_level(p, uid) >= 4
     and (coalesce(private.workspace_role(uid) in ('owner', 'admin'), false)
          or exists (select 1 from public.pages pg join public.workspaces w on w.id = pg.workspace_id
                     where pg.id = p and w.owner_id = uid));
$$;

revoke all on function private.user_can_share_page(uuid, uuid) from public, anon, authenticated;

-- Como en la migración del equipo; la rama de página llama a la regla única.
create or replace function private.can_share(p_project uuid, p_page uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    when (p_project is null) = (p_page is null) then false
    when p_project is not null then
      private.project_level(p_project) >= 4
      and (coalesce(private.workspace_role() in ('owner', 'admin'), false)
           or exists (select 1 from public.workspaces w where w.id = p_project and w.owner_id = (select auth.uid())))
    else
      private.user_can_share_page(p_page, (select auth.uid()))
  end;
$$;

-- Sacar a alguien del workspace revoca sus links (si vuelve, no reviven). Como en la migración del equipo, con eso.
create or replace function public.remove_member(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  my_role     text := private.workspace_role();
  cur         public.members;
  ws          uuid;
  heir        uuid;
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
  update public.public_links set revoked_at = now(), revoked_by = auth.uid()
  where created_by = p_user and revoked_at is null;

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
-- 3. El link del pedido y su nivel
-- ---------------------------------------------------------------------------------------------------
-- El token del header, solo si tiene la forma exacta (si no, ni se calcula la huella). Sin `security definer`: la
-- llama la política de `thumbs` con el rol `anon`.
create function private.plink_token()
returns text
language sql stable set search_path = ''
as $$
  select t
  from (select nullif(current_setting('request.headers', true), '')::json ->> 'x-shotdocs-link' as t) s
  where t ~ '^sdl_[A-Za-z0-9_-]{43}$';
$$;

-- El link vivo del pedido: existe, no se revocó, no venció y quien lo creó todavía puede compartir su página (en vivo:
-- si le bajan el permiso o el rol, se apaga; si se lo devuelven, vuelve). Todo lo demás da ninguna fila.
create function private.current_plink()
returns public.public_links
language sql stable security definer set search_path = ''
as $$
  select l.*
  from public.public_links l
  where l.token_hash = extensions.digest(private.plink_token(), 'sha256')
    and l.revoked_at is null
    and (l.expires_at is null or l.expires_at > now())
    and l.created_by is not null
    and private.user_can_share_page(l.page_id, l.created_by);
$$;

-- El nivel del link del pedido sobre una página: 2 (Can view: ver y comentar) o 3 (Can edit) si la raíz del link está
-- en la cadena de `p` hacia arriba, ni `p` ni ninguna de arriba (hasta la raíz del proyecto) está en la papelera y el
-- proyecto no está borrado; si no, 0. Una sola recorrida por los padres, como `user_page_level`.
create function private.plink_page_level(p uuid)
returns int
language plpgsql stable security definer set search_path = ''
as $$
declare
  l        public.public_links := private.current_plink();
  under    boolean;
  in_trash boolean;
  pdel     boolean;
begin
  if l.id is null or p is null then
    return 0;
  end if;
  with recursive chain (id, parent_id, deleted_at, depth) as (
    select pg.id, pg.parent_id, pg.deleted_at, 0 from public.pages pg where pg.id = p
    union all
    select pg.id, pg.parent_id, pg.deleted_at, c.depth + 1
    from public.pages pg
    join chain c on pg.id = c.parent_id
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

-- Las páginas vivas de la rama del link del pedido (la raíz y lo que cuelga de ella sin pasar por la papelera); nada
-- si el link no anda o su raíz quedó en la papelera.
create function private.plink_branch()
returns setof uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  l public.public_links := private.current_plink();
begin
  if l.id is null or private.plink_page_level(l.page_id) = 0 then
    return;
  end if;
  return query
    with recursive sub (id, depth) as (
      select l.page_id, 0
      union
      select pg.id, s.depth + 1
      from public.pages pg
      join sub s on pg.parent_id = s.id
      where pg.deleted_at is null and s.depth < 10000
    )
    select s.id from sub s;
end;
$$;

-- El nivel del link sobre un archivo: el de la rama, si una página viva de la rama lo usa sin `removed_at` (las fotos
-- sacadas no cuentan, D14) y el uso no es de otro proyecto (`is_foreign`); si no, 0.
create function private.plink_file_level(p_file uuid)
returns int
language plpgsql stable security definer set search_path = ''
as $$
declare
  l public.public_links := private.current_plink();
begin
  if l.id is null or p_file is null then
    return 0;
  end if;
  if exists (
    select 1 from public.page_files pf
    where pf.file_id = p_file and pf.removed_at is null and not pf.is_foreign
      and pf.page_id in (select private.plink_branch())) then
    return case l.level when 'edit' then 3 else 2 end;
  end if;
  return 0;
end;
$$;

-- Los nombres de las miniaturas (`<archivo>.jpg` del bucket `thumbs`) que el link del pedido puede leer. La política
-- de `thumbs` lo llama una vez por consulta (`(select …)`), no una vez por objeto.
create function private.plink_thumbs()
returns text[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(distinct pf.file_id::text || '.jpg'), '{}')
  from public.page_files pf
  where pf.removed_at is null and not pf.is_foreign
    and pf.page_id in (select private.plink_branch());
$$;

-- El tamaño de todas las bases del servidor (como lo mide Supabase para el tope de 500 MB del plan gratis), recordado
-- 10 minutos: `pg_database_size` recorre los archivos. VOLATILE: escribe el recuerdo.
create function private.db_bytes()
returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare
  b bigint;
begin
  select g.bytes into b from private.db_guard g where g.id and g.at > now() - interval '10 minutes';
  if b is null then
    select coalesce(sum(pg_database_size(d.datname)), 0)::bigint into b from pg_database d;
    insert into private.db_guard as g (id, bytes, at) values (true, b, now())
    on conflict (id) do update set bytes = excluded.bytes, at = excluded.at;
  end if;
  return b;
end;
$$;

-- Cuenta lo que gasta el link del pedido (VOLATILE: escribe). Por link y día, y para todos los links; si pasa un tope:
-- `link_rate_limited` (P0001, con el tope en `detail`). Lo rechazado no suma: el error deshace la transacción entera.
create function private.plink_count(p_kind text, p_n bigint default 1, p_bytes bigint default 0)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  l  public.public_links := private.current_plink();
  n  bigint;
  b  bigint;
  an bigint;
  ab bigint;
  lim bigint;
begin
  if l.id is null then
    raise exception 'link_not_found' using errcode = 'P0002';
  end if;
  insert into public.public_link_usage as u (link_id, day, kind, n, bytes)
  values (l.id, current_date, p_kind, p_n, p_bytes)
  on conflict (link_id, day, kind) do update set n = u.n + excluded.n, bytes = u.bytes + excluded.bytes
  returning u.n, u.bytes into n, b;
  insert into public.public_link_usage_all as u (day, kind, n, bytes)
  values (current_date, p_kind, p_n, p_bytes)
  on conflict (day, kind) do update set n = u.n + excluded.n, bytes = u.bytes + excluded.bytes
  returning u.n, u.bytes into an, ab;

  lim := private.plink_limit(p_kind);
  if lim is not null and n > lim then
    raise exception 'link_rate_limited' using errcode = 'P0001', detail = p_kind;
  end if;
  lim := private.plink_limit(p_kind || '_bytes');
  if lim is not null and b > lim then
    raise exception 'link_rate_limited' using errcode = 'P0001', detail = p_kind || '_bytes';
  end if;
  lim := private.plink_limit('all_' || p_kind);
  if lim is not null and an > lim then
    raise exception 'link_rate_limited' using errcode = 'P0001', detail = 'all_' || p_kind;
  end if;
  lim := private.plink_limit('all_' || p_kind || '_bytes');
  if lim is not null and ab > lim then
    raise exception 'link_rate_limited' using errcode = 'P0001', detail = 'all_' || p_kind || '_bytes';
  end if;
  lim := private.plink_limit('all_month_' || p_kind || '_bytes');
  if lim is not null and p_bytes > 0 and (
       select coalesce(sum(a.bytes), 0) from public.public_link_usage_all a
       where a.kind = p_kind and a.day >= date_trunc('month', current_date)::date) > lim then
    raise exception 'link_rate_limited' using errcode = 'P0001', detail = 'all_month_' || p_kind || '_bytes';
  end if;
end;
$$;

-- Lo que escribe un link no entra con las bases por encima de la guarda (350 MB de los 500 del plan gratis: pasarlos
-- deja todo en solo lectura para el equipo).
create function private.plink_db_guard()
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if private.db_bytes() > private.plink_limit('db_guard_bytes') then
    raise exception 'link_rate_limited' using errcode = 'P0001', detail = 'db_guard';
  end if;
end;
$$;

-- La huella del id de dispositivo del pedido (`x-shotdocs-device`); nula si no viene o no tiene la forma.
create function private.plink_device_hash()
returns bytea
language sql stable security definer set search_path = ''
as $$
  select extensions.digest(d, 'sha256')
  from (select nullif(current_setting('request.headers', true), '')::json ->> 'x-shotdocs-device' as d) s
  where d ~ '^[A-Za-z0-9_-]{16,128}$';
$$;

-- El formato de hoja que hereda una página (el suyo o el de la primera de arriba que lo tiene).
create function private.page_effective_format(p uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with recursive chain (id, parent_id, settings, depth) as (
    select pg.id, pg.parent_id, pg.settings, 0 from public.pages pg where pg.id = p
    union all
    select pg.id, pg.parent_id, pg.settings, c.depth + 1
    from public.pages pg join chain c on pg.id = c.parent_id
    where c.depth < 10000
  )
  select c.settings -> 'format' from chain c where c.settings ? 'format' order by c.depth limit 1;
$$;

revoke all on function private.plink_limit(text) from public, anon, authenticated;
revoke all on function private.plink_token() from public, anon, authenticated;
revoke all on function private.current_plink() from public, anon, authenticated;
revoke all on function private.plink_page_level(uuid) from public, anon, authenticated;
revoke all on function private.plink_branch() from public, anon, authenticated;
revoke all on function private.plink_file_level(uuid) from public, anon, authenticated;
revoke all on function private.plink_thumbs() from public, anon, authenticated;
revoke all on function private.db_bytes() from public, anon, authenticated;
revoke all on function private.plink_count(text, bigint, bigint) from public, anon, authenticated;
revoke all on function private.plink_db_guard() from public, anon, authenticated;
revoke all on function private.plink_device_hash() from public, anon, authenticated;
revoke all on function private.page_effective_format(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 4. Lo que llama el visitante (rol anon, por POST: las que cuentan son VOLATILE)
-- ---------------------------------------------------------------------------------------------------
-- Errores comunes: `link_not_found` (P0002) para todo link que no anda (sin header, mal formado, inexistente,
-- revocado, vencido, creador sin permiso de compartir, raíz en la papelera), siempre igual; `page_not_found` (P0002)
-- para una página fuera de la rama; `link_rate_limited` (P0001) al pasar un tope; `app_outdated` (P0001, 503) al
-- escribir con una versión más vieja que la mínima.

-- Abrir: cuenta una apertura y devuelve lo que la app necesita para arrancar. Nunca el nombre del workspace ni el del
-- proyecto, ni correos.
create function public.plink_open(p_app_version text default null)
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
    'level', l.level,
    'expires_at', l.expires_at,
    'min_app_version', s.min_app_version,
    'schema_version', s.schema_version,
    'clean_on', s.clean_min_version is not null,
    'media_url', s.media_url,
    'outdated', p_app_version is not null and not private.app_version_allowed(p_app_version));
end;
$$;

-- El árbol del link: la raíz (sin padre) y lo que cuelga de ella fuera de la papelera, con una lista cerrada de
-- columnas: en el lugar del proyecto, el id del link; de los ajustes, solo la hoja y el encabezado (la raíz trae el
-- formato que hereda). `update_seq` no es el del servidor: para el visitante, "al día" es `clean_seq`, y el número
-- de ediciones no es suyo; va `clean_seq`, o 1 si la página tiene contenido sin base todavía ("en preparación").
-- `p_sig`: la firma de la última respuesta; si el árbol no cambió, no devuelve nada ni cuenta (lo de cada ciclo). Si
-- cambió, cuenta sus bytes como una bajada (`pull`, N2 de la re-verificación).
create function public.plink_tree(p_sig text default null)
returns table (id uuid, workspace_id uuid, parent_id uuid, title text, icon text, sort_key text, settings jsonb,
               update_seq bigint, clean_seq bigint, created_at timestamptz, updated_at timestamptz, sig text)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  l    public.public_links := private.current_plink();
  out_rows jsonb;
  s    text;
begin
  if l.id is null or private.plink_page_level(l.page_id) = 0 then
    raise exception 'link_not_found' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', pg.id,
           'parent_id', case when pg.id = l.page_id then null else pg.parent_id end,
           'title', pg.title, 'icon', pg.icon, 'sort_key', pg.sort_key,
           'settings', jsonb_strip_nulls(jsonb_build_object(
              'header', pg.settings -> 'header',
              'format', case when pg.id = l.page_id then private.page_effective_format(pg.id) else pg.settings -> 'format' end)),
           'update_seq', case when pg.clean_seq > 0 then pg.clean_seq when pg.update_seq > 0 then 1 else 0 end,
           'clean_seq', pg.clean_seq,
           'created_at', pg.created_at, 'updated_at', pg.updated_at) order by pg.id), '[]'::jsonb)
  into out_rows
  from public.pages pg
  where pg.id in (select private.plink_branch());
  s := l.level || ':' || md5(out_rows::text);
  if s is not distinct from p_sig then
    return;
  end if;
  perform private.plink_count('pull', 1, octet_length(out_rows::text));
  return query
    select (r ->> 'id')::uuid, l.id, (r ->> 'parent_id')::uuid, r ->> 'title', r ->> 'icon', r ->> 'sort_key',
           r -> 'settings', (r ->> 'update_seq')::bigint, (r ->> 'clean_seq')::bigint,
           (r ->> 'created_at')::timestamptz, (r ->> 'updated_at')::timestamptz, s
    from jsonb_array_elements(out_rows) r;
end;
$$;

-- El contenido de una página de la rama: la base limpia vigente (D14), como una sola fila, si llega más allá de
-- `p_after_seq`; nunca filas de `page_updates`. Sin base vigente o con el interruptor apagado, nada (la página dice "en
-- preparación"). Cuenta los bytes solo cuando devuelve la base.
create function public.plink_pull_page(p_page_id uuid, p_after_seq bigint)
returns table (seq bigint, update text)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  b public.page_clean_bases;
begin
  if private.plink_page_level(p_page_id) < 1 then
    if (private.current_plink()).id is null then
      raise exception 'link_not_found' using errcode = 'P0002';
    end if;
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  if private.clean_min_version() is null then
    return;
  end if;
  b := private.current_clean_base(p_page_id);
  if b.page_id is not null and b.to_seq > coalesce(p_after_seq, 0) then
    perform private.plink_count('pull', 1, octet_length(b.state));
    return query select b.to_seq, translate(encode(b.state, 'base64'), E'\n', '');
  end if;
end;
$$;

-- Los archivos que el link ve (las filas que la app guarda para mostrar fotos y videos): solo lo que pide y ve. La rama
-- se calcula UNA vez por pedido (no una por archivo: con 200 ids costaba medio segundo de la base) y cuenta como una
-- bajada (`pull`: una vez y los bytes de lo devuelto, para los topes y el contador de Share). VOLATILE: escribe la
-- cuenta.
create function public.plink_media_files(p_ids uuid[])
returns table (id uuid, name text, mime text, size bigint, width int, height int, duration real,
               thumb_at timestamptz, drive_id text)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  out_rows jsonb;
begin
  if (private.current_plink()).id is null then
    raise exception 'link_not_found' using errcode = 'P0002';
  end if;
  if coalesce(array_length(p_ids, 1), 0) > 200 then
    raise exception 'too_many_files' using errcode = '22023';
  end if;
  with br as materialized (select b as page_id from private.plink_branch() b)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', f.id, 'name', f.name, 'mime', f.mime, 'size', f.size, 'width', f.width, 'height', f.height,
           'duration', f.duration, 'thumb_at', f.thumb_at, 'drive_id', f.drive_id) order by f.id), '[]'::jsonb)
  into out_rows
  from public.files f
  where f.id = any (p_ids)
    and exists (
      select 1 from public.page_files pf
      where pf.file_id = f.id and pf.removed_at is null and not pf.is_foreign
        and pf.page_id in (select br.page_id from br));
  perform private.plink_count('pull', 1, octet_length(out_rows::text));
  return query
    select (r ->> 'id')::uuid, r ->> 'name', r ->> 'mime', (r ->> 'size')::bigint, (r ->> 'width')::int,
           (r ->> 'height')::int, (r ->> 'duration')::real, (r ->> 'thumb_at')::timestamptz, r ->> 'drive_id'
    from jsonb_array_elements(out_rows) r;
end;
$$;

-- Lo que pregunta el portero (por POST, con la clave publicable y el header del link): como `media_file`, con el
-- nivel del link. Cuenta un pase. `null` si el link no ve el archivo. En el lugar del proyecto, el id del link.
create function public.plink_media_file(p_file uuid)
returns json
language plpgsql volatile security definer set search_path = ''
as $$
declare
  l   public.public_links := private.current_plink();
  lvl int;
  r   json;
begin
  if l.id is null then
    raise exception 'link_not_found' using errcode = 'P0002';
  end if;
  lvl := private.plink_file_level(p_file);
  if lvl < 1 then
    return null;
  end if;
  perform private.plink_count('pass');
  select json_build_object(
    'id', f.id, 'project_id', l.id, 'project_name', '', 'name', f.name, 'mime', f.mime, 'size', f.size,
    'drive_id', f.drive_id, 'created_at', f.created_at, 'level', lvl, 'trashed_at', f.trashed_at,
    'purged_at', f.purged_at, 'drive_trashed_at', f.drive_trashed_at, 'created_by', null, 'via_link', true)
  into r
  from public.files f
  where f.id = p_file;
  return r;
end;
$$;

-- Los comentarios de una página de la rama. Ningún correo: los del equipo por la parte antes de la @, los importados
-- por su nombre (nunca `imported_author_email`), los del link por su nombre (la app suma "(via link)"). `mine`: los
-- escribió este link desde este dispositivo. Sin ids de personas. Si devuelve algo, cuenta sus bytes como una bajada
-- (N2); con `p_since` y nada nuevo, nada.
create function public.plink_list_comments(p_page_id uuid, p_since timestamptz default null)
returns table (id uuid, page_id uuid, block_id text, thread_id uuid, body text, author_name text, author_kind text,
               mine boolean, created_at timestamptz, edited_at timestamptz, resolved_at timestamptz,
               deleted_at timestamptz, updated_at timestamptz)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  l    public.public_links := private.current_plink();
  dev  bytea := private.plink_device_hash();
  out_rows jsonb;
begin
  if private.plink_page_level(p_page_id) < 1 then
    if l.id is null then
      raise exception 'link_not_found' using errcode = 'P0002';
    end if;
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'page_id', c.page_id, 'block_id', c.block_id, 'thread_id', c.thread_id,
           'body', case when c.deleted_at is null then c.body end,
           'author_name', case
              when c.plink_id is not null then c.plink_author
              when c.imported_from is not null then c.imported_author
              else nullif(split_part(u.email, '@', 1), '') end,
           'author_kind', case
              when c.plink_id is not null then 'link'
              when c.imported_from is not null then 'imported'
              else 'team' end,
           'mine', c.plink_id = l.id and dev is not null and c.plink_device_hash = dev,
           'created_at', c.created_at, 'edited_at', c.edited_at, 'resolved_at', c.resolved_at,
           'deleted_at', c.deleted_at, 'updated_at', c.updated_at) order by c.updated_at, c.id), '[]'::jsonb)
  into out_rows
  from public.comments c
  left join auth.users u on u.id = c.author_id
  where c.page_id = p_page_id and (p_since is null or c.updated_at >= p_since);
  if jsonb_array_length(out_rows) = 0 then
    return;
  end if;
  perform private.plink_count('pull', 1, octet_length(out_rows::text));
  return query
    select (r ->> 'id')::uuid, (r ->> 'page_id')::uuid, r ->> 'block_id', (r ->> 'thread_id')::uuid, r ->> 'body',
           r ->> 'author_name', r ->> 'author_kind', coalesce((r ->> 'mine')::boolean, false),
           (r ->> 'created_at')::timestamptz, (r ->> 'edited_at')::timestamptz, (r ->> 'resolved_at')::timestamptz,
           (r ->> 'deleted_at')::timestamptz, (r ->> 'updated_at')::timestamptz
    from jsonb_array_elements(out_rows) r;
end;
$$;

-- Lo que escribe un comentario de un link: la versión, el nombre, la guarda de la base, el tope de por vida y el del
-- día (cantidad y bytes, N1). `p_bytes`: lo que suma el texto.
create function private.plink_comment_checks(p_bytes bigint)
returns public.public_links
language plpgsql volatile security definer set search_path = ''
as $$
declare
  l    public.public_links := private.current_plink();
  over boolean;
begin
  if l.id is null then
    raise exception 'link_not_found' using errcode = 'P0002';
  end if;
  perform private.require_write_version();
  perform private.plink_db_guard();
  update public.public_links set comment_bytes_total = comment_bytes_total + greatest(p_bytes, 0)
  where id = l.id
  returning comment_bytes_total > private.plink_limit('life_comment_bytes') into over;
  if over then
    raise exception 'link_rate_limited' using errcode = 'P0001', detail = 'life_comment_bytes';
  end if;
  perform private.plink_count('comment', 1, greatest(p_bytes, 0));
  return l;
end;
$$;

revoke all on function private.plink_comment_checks(bigint) from public, anon, authenticated;

-- Comentar o responder (nunca resolver). Idempotente por `p_id`. `p_author`: el nombre que escribió el visitante (1 a
-- 60 caracteres, sin controles ni marcas de dirección).
create function public.plink_add_comment(
  p_id uuid, p_page_id uuid, p_block_id text, p_thread_id uuid, p_body text, p_author text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  l    public.public_links := private.current_plink();
  dev  bytea := private.plink_device_hash();
  name text := btrim(p_author);
  blk  text := p_block_id;
  root public.comments;
  cur  public.comments;
begin
  if l.id is null then
    raise exception 'link_not_found' using errcode = 'P0002';
  end if;
  select * into cur from public.comments c where c.id = p_id;
  if found and cur.plink_id = l.id and cur.page_id = p_page_id and cur.body = p_body
     and cur.thread_id is not distinct from p_thread_id
     and (cur.block_id is not distinct from p_block_id or (p_thread_id is not null and p_block_id is null)) then
    return;
  end if;
  if p_id is null or private.plink_page_level(p_page_id) < 2 then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  if name is null or char_length(name) not between 1 and 60
     or name ~ '[[:cntrl:]\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2069\ufeff]' then
    raise exception 'author_invalid' using errcode = '22023';
  end if;
  if p_thread_id is not null then
    if p_thread_id = p_id then
      raise exception 'thread_invalid' using errcode = '22023';
    end if;
    select * into root from public.comments c where c.id = p_thread_id;
    if not found then
      raise exception 'thread_not_found' using errcode = 'P0002';
    end if;
    if root.page_id <> p_page_id then
      raise exception 'thread_other_page' using errcode = 'P0001';
    end if;
    if root.thread_id is not null or (blk is not null and blk is distinct from root.block_id) then
      raise exception 'thread_invalid' using errcode = '22023';
    end if;
    blk := root.block_id;
  end if;
  perform private.plink_comment_checks(octet_length(coalesce(p_body, '')));

  insert into public.comments (id, page_id, block_id, thread_id, body, author_id, plink_id, plink_author, plink_device_hash)
  values (p_id, p_page_id, blk, p_thread_id, p_body, null, l.id, name, dev)
  on conflict (id) do nothing;
  if found then
    return;
  end if;
  raise exception 'comment_conflict' using errcode = 'P0001';
end;
$$;

-- Editar uno propio: del mismo link y desde el mismo dispositivo.
create function public.plink_edit_comment(p_id uuid, p_body text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  l   public.public_links := private.current_plink();
  dev bytea := private.plink_device_hash();
  cur public.comments;
begin
  if l.id is null then
    raise exception 'link_not_found' using errcode = 'P0002';
  end if;
  select * into cur from public.comments c where c.id = p_id for update;
  if not found or private.plink_page_level(cur.page_id) < 1 then
    raise exception 'comment_not_found' using errcode = 'P0002';
  end if;
  if cur.plink_id is distinct from l.id or dev is null or cur.plink_device_hash is distinct from dev then
    raise exception 'not_allowed' using errcode = '42501', hint = 'Only the author edits a comment.';
  end if;
  if cur.deleted_at is not null then
    raise exception 'comment_deleted' using errcode = 'P0001';
  end if;
  if cur.body = p_body then
    return;
  end if;
  if private.plink_page_level(cur.page_id) < 2 then
    raise exception 'comment_denied' using errcode = '42501';
  end if;
  perform private.plink_comment_checks(octet_length(coalesce(p_body, '')));
  update public.comments set body = p_body, edited_at = now(), updated_at = now() where id = p_id;
end;
$$;

-- Borrar uno propio (queda en la tabla con `deleted_at`, como siempre).
create function public.plink_delete_comment(p_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  l   public.public_links := private.current_plink();
  dev bytea := private.plink_device_hash();
  cur public.comments;
begin
  if l.id is null then
    raise exception 'link_not_found' using errcode = 'P0002';
  end if;
  select * into cur from public.comments c where c.id = p_id for update;
  if not found or private.plink_page_level(cur.page_id) < 1 then
    raise exception 'comment_not_found' using errcode = 'P0002';
  end if;
  if cur.plink_id is distinct from l.id or dev is null or cur.plink_device_hash is distinct from dev then
    raise exception 'not_allowed' using errcode = '42501',
      hint = 'The author or someone with "edit and create pages" on the page deletes a comment.';
  end if;
  if cur.deleted_at is not null then
    return;
  end if;
  perform private.require_write_version();
  perform private.plink_count('comment', 1, 0);
  update public.comments set deleted_at = now(), updated_at = now() where id = p_id;
end;
$$;

revoke all on function public.plink_open(text) from public, authenticated;
revoke all on function public.plink_tree(text) from public, authenticated;
revoke all on function public.plink_pull_page(uuid, bigint) from public, authenticated;
revoke all on function public.plink_media_files(uuid[]) from public, authenticated;
revoke all on function public.plink_media_file(uuid) from public, authenticated;
revoke all on function public.plink_list_comments(uuid, timestamptz) from public, authenticated;
revoke all on function public.plink_add_comment(uuid, uuid, text, uuid, text, text) from public, authenticated;
revoke all on function public.plink_edit_comment(uuid, text) from public, authenticated;
revoke all on function public.plink_delete_comment(uuid) from public, authenticated;
grant execute on function public.plink_open(text) to anon;
grant execute on function public.plink_tree(text) to anon;
grant execute on function public.plink_pull_page(uuid, bigint) to anon;
grant execute on function public.plink_media_files(uuid[]) to anon;
grant execute on function public.plink_media_file(uuid) to anon;
grant execute on function public.plink_list_comments(uuid, timestamptz) to anon;
grant execute on function public.plink_add_comment(uuid, uuid, text, uuid, text, text) to anon;
grant execute on function public.plink_edit_comment(uuid, text) to anon;
grant execute on function public.plink_delete_comment(uuid) to anon;

-- Las miniaturas del link (plan A, después de la prueba de caché de la entrega 0: Storage revisa la política en cada
-- pedido aunque el objeto esté en la caché). La guarda del token va primero: sin header, la política no hace nada más.
-- `anon` necesita `usage` de `private` y `execute` solo de las dos funciones que llama.
grant usage on schema private to anon;
grant execute on function private.plink_token() to anon;
grant execute on function private.plink_thumbs() to anon;
create policy thumbs_select_link on storage.objects
  for select to anon
  using (bucket_id = 'thumbs' and private.plink_token() is not null
         and name = any ((select private.plink_thumbs())::text[]));

-- ---------------------------------------------------------------------------------------------------
-- 5. Lo que llama quien comparte (authenticated, con `can_share`)
-- ---------------------------------------------------------------------------------------------------
-- El link de una página, con su token, para quien la comparte (el de una página de arriba va sin token, ver get_public_link).
create function private.public_link_json(l public.public_links)
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
                                         or u.bytes >= private.plink_limit('comment_bytes'))))),
    'comments', (select count(*) from public.comments c where c.plink_id = l.id and c.deleted_at is null));
$$;

revoke all on function private.public_link_json(public.public_links) from public, anon, authenticated;

-- Un token nuevo: `sdl_` + 32 bytes al azar en base64url (43 caracteres).
create function private.new_link_token()
returns text
language sql volatile security definer set search_path = ''
as $$
  select 'sdl_' || translate(encode(extensions.gen_random_bytes(32), 'base64'), E'+/=\n', '-_');
$$;

revoke all on function private.new_link_token() from public, anon, authenticated;

-- Lo que piden crear, cambiar y revocar: compartir la página, que no esté en la papelera y la versión.
create function private.public_link_guard(p_page uuid)
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_page is null or private.page_level(p_page) < 1 then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  if not private.can_share(null, p_page) then
    raise exception 'not_allowed' using errcode = '42501',
      hint = 'Sharing with a link needs "edit and create pages" on the page and being an owner or admin of the workspace or the creator of the project.';
  end if;
  if private.page_in_trash(p_page) then
    raise exception 'page_in_trash' using errcode = 'P0001';
  end if;
  perform private.require_write_version();
end;
$$;

revoke all on function private.public_link_guard(uuid) from public, anon, authenticated;

-- Crea el link vivo de la página (o devuelve el que ya hay: dos dispositivos que crean a la vez terminan con el mismo).
-- Pide el interruptor de D14 prendido (`clean_off` si no, D33): el link solo recibe bases limpias. Solo 'comment' en
-- esta entrega. Reinicia la base de la rama (como compartir con alguien que no ve lo borrado).
create function public.create_public_link(p_id uuid, p_page uuid, p_level text, p_expires timestamptz default null)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  l public.public_links;
  t text;
begin
  perform private.public_link_guard(p_page);
  if p_level is null or p_level <> 'comment' then
    raise exception 'level_invalid' using errcode = '22023';
  end if;
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

-- Cambia el vencimiento (y el nivel, solo 'comment' en esta entrega) del link vivo; conserva el token.
create function public.set_public_link(p_page uuid, p_level text, p_expires timestamptz default null)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  l public.public_links;
begin
  perform private.public_link_guard(p_page);
  if p_level is null or p_level <> 'comment' then
    raise exception 'level_invalid' using errcode = '22023';
  end if;
  if p_expires is not null and p_expires <= now() then
    raise exception 'link_invalid' using errcode = '22023';
  end if;
  update public.public_links pl set level = p_level, expires_at = p_expires
  where pl.page_id = p_page and pl.revoked_at is null
  returning * into l;
  if not found then
    raise exception 'link_not_found' using errcode = 'P0002';
  end if;
  return private.public_link_json(l);
end;
$$;

-- Reset link: revoca el vivo y crea otro con el mismo nivel y vencimiento (si todavía no pasó); el viejo deja de
-- andar en el acto. Quien lo resetea queda como creador. Pide el interruptor, como crear.
create function public.reset_public_link(p_page uuid, p_new_id uuid)
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
  if p_new_id is null or exists (select 1 from public.public_links pl where pl.id = p_new_id) then
    raise exception 'link_invalid' using errcode = '22023';
  end if;
  t := private.new_link_token();
  insert into public.public_links (id, page_id, token, token_hash, level, created_by, expires_at)
  values (p_new_id, p_page, t, extensions.digest(t, 'sha256'), old.level, auth.uid(),
          case when old.expires_at > now() then old.expires_at end)
  returning * into l;
  -- Como crear: el link nuevo no recibe una base armada antes de lo que se borró después (el reset es justo para
  -- cuando un link se escapó y se limpió la página).
  perform private.clean_reset(null, p_page);
  return private.public_link_json(l);
end;
$$;

-- Apaga el link vivo (Restricted). Idempotente: sin link vivo no hace nada.
create function public.revoke_public_link(p_page uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  perform private.public_link_guard(p_page);
  update public.public_links set revoked_at = now(), revoked_by = auth.uid()
  where page_id = p_page and revoked_at is null;
end;
$$;

-- Lo que muestra Share: el link de la página (con el token), o el de la página de arriba más cercana que tenga uno
-- (sin token; con su título solo si la sesión la ve), el uso de hoy y si el interruptor está prendido. `null` si la
-- sesión no puede compartir la página.
create function public.get_public_link(p_page uuid)
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
    'link', case when l.id is not null then private.public_link_json(l) end,
    'above', case when above.id is not null then jsonb_build_object(
      'page_id', above.page_id, 'level', above.level,
      'title', case when private.page_level(above.page_id) >= 1
                    then (select pg.title from public.pages pg where pg.id = above.page_id) end) end);
end;
$$;

-- Las páginas que la sesión ve y tienen un link vivo propio (el ícono del árbol).
create function public.public_link_pages()
returns table (page_id uuid)
language sql stable security definer set search_path = ''
as $$
  select pl.page_id from public.public_links pl
  where pl.revoked_at is null and (pl.expires_at is null or pl.expires_at > now())
    and private.page_level(pl.page_id) >= 1;
$$;

-- Borra (marca) de una vez los comentarios de un link: pide 4 sobre su raíz. Devuelve cuántos.
create function public.delete_public_link_comments(p_link uuid)
returns int
language plpgsql volatile security definer set search_path = ''
as $$
declare
  root uuid;
  n    int;
begin
  select pl.page_id into root from public.public_links pl where pl.id = p_link;
  if root is null or private.page_level(root) < 4 then
    raise exception 'link_not_found' using errcode = 'P0002';
  end if;
  perform private.require_write_version();
  update public.comments set deleted_at = now(), deleted_by = auth.uid(), updated_at = now()
  where plink_id = p_link and deleted_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.create_public_link(uuid, uuid, text, timestamptz) from public, anon;
revoke all on function public.set_public_link(uuid, text, timestamptz) from public, anon;
revoke all on function public.reset_public_link(uuid, uuid) from public, anon;
revoke all on function public.revoke_public_link(uuid) from public, anon;
revoke all on function public.get_public_link(uuid) from public, anon;
revoke all on function public.public_link_pages() from public, anon;
revoke all on function public.delete_public_link_comments(uuid) from public, anon;
grant execute on function public.create_public_link(uuid, uuid, text, timestamptz) to authenticated;
grant execute on function public.set_public_link(uuid, text, timestamptz) to authenticated;
grant execute on function public.reset_public_link(uuid, uuid) to authenticated;
grant execute on function public.revoke_public_link(uuid) to authenticated;
grant execute on function public.get_public_link(uuid) to authenticated;
grant execute on function public.public_link_pages() to authenticated;
grant execute on function public.delete_public_link_comments(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 6. Lo que cambia de lo que ya existe
-- ---------------------------------------------------------------------------------------------------
-- Una página con un link vivo en su cadena (ella o una de arriba) tiene lectores que no ven lo borrado: se le arman
-- bases. Como en la privacidad de lo borrado, más el link. De acá salen `clean_work` y el reinicio al mover.
create or replace function private.has_plain_readers(p uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  with recursive chain (id, parent_id, depth) as (
    select pg.id, pg.parent_id, 0 from public.pages pg where pg.id = p
    union all
    select pg.id, pg.parent_id, c.depth + 1
    from public.pages pg
    join chain c on pg.id = c.parent_id
    where c.depth < 10000
  ),
  cand as (
    select distinct g.user_id
    from public.grants g
    where g.revoked_at is null
      and (g.project_id = (select pg.workspace_id from public.pages pg where pg.id = p)
           or g.page_id in (select c.id from chain c))
  )
  select exists (
    select 1 from public.public_links pl
    where pl.revoked_at is null and (pl.expires_at is null or pl.expires_at > now())
      and pl.page_id in (select c.id from chain c))
  or exists (
    select 1
    from cand c
    join public.members m on m.user_id = c.user_id and m.removed_at is null
    where (m.role = 'guest' and private.user_page_level(p, c.user_id) >= 1)
       or (m.role <> 'guest' and private.user_page_level(p, c.user_id) between 1 and 2));
$$;

-- Como en la privacidad de lo borrado, con las raíces de los links vivos en `reach`.
create or replace function public.clean_work(p_app_version text, p_pages uuid[] default null, p_urgent boolean default false)
returns table (page_id uuid, update_seq bigint, last_update_id bigint, clean_seq bigint, base_bytes int)
language plpgsql stable security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  r  record;
  n  int := 0;
begin
  if private.workspace_role() is null or private.history_denied_for_guest()
     or not private.clean_version_allowed(p_app_version) then
    return;
  end if;
  for r in
    with recursive reader_grants as (
      select g.project_id, g.page_id
      from public.grants g
      join public.members m on m.user_id = g.user_id and m.removed_at is null
      where g.revoked_at is null and (g.level in ('view', 'comment') or m.role = 'guest')
      union all
      -- Un link vivo es un lector de su página y lo de abajo.
      select null::uuid, pl.page_id
      from public.public_links pl
      where pl.revoked_at is null and (pl.expires_at is null or pl.expires_at > now())
    ),
    mine (ws) as (
      select w.id from public.workspaces w where w.owner_id = me
      union
      select coalesce(g.project_id, gp.workspace_id)
      from public.grants g
      left join public.pages gp on gp.id = g.page_id
      where g.user_id = me and g.revoked_at is null and g.level in ('edit', 'edit_pages')
    ),
    reach (id) as (
      select pg.id
      from public.pages pg
      join public.workspaces w on w.id = pg.workspace_id and w.deleted_at is null
      where pg.parent_id is null and pg.deleted_at is null
        and pg.workspace_id in (select rg.project_id from reader_grants rg where rg.project_id is not null)
        and pg.workspace_id in (select mi.ws from mine mi)
      union
      select pg.id
      from public.pages pg
      join public.workspaces w on w.id = pg.workspace_id and w.deleted_at is null
      where pg.id in (select rg.page_id from reader_grants rg where rg.page_id is not null)
        and pg.workspace_id in (select mi.ws from mine mi)
        and not private.page_in_trash(pg.id)
      union
      select pg.id
      from public.pages pg
      join reach rc on pg.parent_id = rc.id
      where pg.deleted_at is null
    ),
    cand as (
      select pg.id, pg.update_seq, pg.clean_seq, pg.clean_at, u.id as last_id, u.created_at as last_at,
             cb.page_id is not null as has_base, coalesce(octet_length(b.state), 0) as bytes
      from public.pages pg
      join reach rc on rc.id = pg.id
      join public.page_updates u on u.page_id = pg.id and u.seq = pg.update_seq
      left join lateral (select (private.current_clean_base(pg.id)).page_id) cb (page_id) on true
      left join public.page_clean_bases b on b.page_id = pg.id
      where pg.update_seq > 0
        and (p_pages is null or pg.id = any (p_pages))
        and (cb.page_id is null or pg.update_seq > pg.clean_seq)
    )
    select c.*
    from cand c
    where not c.has_base
       or coalesce(p_urgent, false)
       or c.last_at < now() - make_interval(secs => 20 * greatest(1, c.bytes / 102400.0))
       or c.clean_at is null
       or c.clean_at < now() - make_interval(secs => 120 * greatest(1, c.bytes / 102400.0))
    order by c.has_base, c.clean_at nulls first, c.id
  loop
    if private.sees_deleted(r.id) and private.has_plain_readers(r.id) then
      page_id := r.id;
      update_seq := r.update_seq;
      last_update_id := r.last_id;
      clean_seq := r.clean_seq;
      base_bytes := r.bytes::int;
      return next;
      n := n + 1;
      exit when n >= 50;
    end if;
  end loop;
end;
$$;

-- `list_comments` suma al final quién escribió un comentario de un link (`plink_id`, `plink_author`); la versión
-- publicada ignora las columnas nuevas.
drop function public.list_comments(uuid, timestamptz);

create function public.list_comments(p_page_id uuid, p_since timestamptz default null)
returns table (id uuid, page_id uuid, block_id text, thread_id uuid, body text, author_id uuid,
               created_at timestamptz, edited_at timestamptz, resolved_at timestamptz, resolved_by uuid,
               deleted_at timestamptz, deleted_by uuid, updated_at timestamptz,
               imported_from text, imported_author text, imported_author_email text, imported_by uuid,
               plink_id uuid, plink_author text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if private.page_level(p_page_id) < 1 then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  return query
    select c.id, c.page_id, c.block_id, c.thread_id,
           case when c.deleted_at is null then c.body end,
           c.author_id, c.created_at, c.edited_at, c.resolved_at, c.resolved_by, c.deleted_at, c.deleted_by,
           c.updated_at, c.imported_from, c.imported_author, c.imported_author_email, c.imported_by,
           c.plink_id, c.plink_author
    from public.comments c
    where c.page_id = p_page_id and (p_since is null or c.updated_at >= p_since)
    order by c.updated_at, c.id;
end;
$$;

revoke all on function public.list_comments(uuid, timestamptz) from public, anon;
grant execute on function public.list_comments(uuid, timestamptz) to authenticated;

-- La vista de compatibilidad, igual: las dos columnas al final.
create or replace view public.comments_view
with (security_invoker = true)
as
  select c.id, c.page_id, c.block_id, c.thread_id,
         case when c.deleted_at is null then private.comment_body(c.id) end as body,
         c.author_id, c.created_at, c.edited_at, c.resolved_at, c.resolved_by, c.deleted_at, c.deleted_by,
         c.updated_at, c.imported_from, c.imported_author, c.imported_author_email, c.imported_by,
         c.plink_id, c.plink_author
  from public.comments c;

-- O16 de la auditoría: la función del disparador de eventos de Supabase (`rls_auto_enable`) no es para `anon`.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 7. Versión de la base: la app ofrece "Anyone with the link" desde la 14
-- ---------------------------------------------------------------------------------------------------
update public.workspace_settings set schema_version = 14 where id and schema_version < 14;

notify pgrst, 'reload schema';
