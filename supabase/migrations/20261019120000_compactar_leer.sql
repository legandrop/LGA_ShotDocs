-- LGA Shot Docs · compactar el contenido, entrega 1: LEER snapshots (Docs/Doc_Compactar.md, secciones 4, 5, 10, 12 y 13).
--
-- Un snapshot es el contenido de una página hasta la fila `up_to_seq` de `page_updates` en un solo update de Yjs (las
-- filas aplicadas en orden en un documento sin GC: conserva lo borrado). Un dispositivo que no tiene la página baja el
-- snapshot y las filas siguientes en vez de todas las filas. Esta migración agrega:
--
--   - la tabla `page_snapshots` (sin permisos directos: todo pasa por funciones) y su estado por página: en `pages`,
--     `snapshot_seq` (pista para el árbol) y `content_epoch` (sube al invalidar; nunca vuelve atrás); la reserva y el
--     "no reintentar" de compactar van en una tabla aparte, `page_compaction`, que nadie lee desde la API;
--   - el interruptor `workspace_settings.snapshot_min_version` (null: apagados; con un número, la versión mínima de la
--     app que arma snapshots, y ninguna cadena armada por una versión anterior se sirve). Esta migración lo deja
--     APAGADO;
--   - `pull_page_content` (bajar: el snapshot si conviene y las filas siguientes, con la época de la página leída en la
--     misma consulta), y las funciones de quien compacta (`claim_page_compaction`, `push_page_snapshot`,
--     `pull_page_snapshot`, `confirm_page_snapshot`, `skip_page_compaction`) y `invalidate_page_snapshot`. En esta
--     entrega nadie las llama: la app solo lee.
--
-- Reglas que no se rompen: ninguna fila de `page_updates` se borra ni se modifica; un snapshot se sirve solo
-- confirmado y válido (`private.current_snapshot`), y solo a quien ve lo borrado (`private.sees_deleted`, D14: el
-- snapshot conserva lo borrado; quien no lo ve baja lo de siempre, que con la privacidad prendida es la base limpia).
--
-- No toca `page_updates`, `push_page_update` ni `pull_page_updates`: las versiones anteriores de la app no se enteran.
-- Con el interruptor apagado (o sin ningún snapshot), `pull_page_content` devuelve exactamente lo que devuelve
-- `pull_page_updates` (lo llama). Sube `schema_version` a 16: desde ahí la app pide `snapshot_seq` y `content_epoch`
-- con el árbol. Necesita `pgcrypto` (`extensions.digest`), que Supabase ya trae.

-- ---------------------------------------------------------------------------------------------------
-- 1. La tabla y el estado por página
-- ---------------------------------------------------------------------------------------------------
create table public.page_snapshots (
  id                uuid primary key default gen_random_uuid(),
  page_id           uuid not null references public.pages (id) on delete cascade,
  -- La última fila cubierta, y su `page_updates.id`: después de restaurar una copia, otra fila puede tener ese `seq`,
  -- y entonces el snapshot no vale (el contador de `id` nunca vuelve atrás).
  up_to_seq         bigint not null check (up_to_seq > 0),
  last_update_id    bigint not null,
  -- El snapshot sobre el que se armó (sin FK: los viejos se limpian; la cadena la sigue `chain_id`).
  base_id           uuid,
  -- El id del primer eslabón de la cadena (el que no tiene base): invalidar alcanza a todos los de la cadena.
  chain_id          uuid not null,
  -- La versión más vieja de la app que armó un eslabón de la cadena: subir `snapshot_min_version` la deja afuera.
  chain_min_version numeric(8, 3) not null,
  state             bytea not null check (octet_length(state) between 1 and 8388608),
  -- El vector de estado (diagnóstico).
  state_sv          bytea not null,
  sha256            bytea not null check (octet_length(sha256) = 32),
  state_bytes       int generated always as (octet_length(state)) stored,
  app_version       numeric(8, 3) not null,
  created_by        uuid default auth.uid() references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  confirmed_at      timestamptz,
  invalid_at        timestamptz,
  invalid_reason    text
);

-- Un solo snapshot VÁLIDO por tramo: uno invalidado no impide volver a compactar el mismo tramo.
create unique index page_snapshots_tramo_key on public.page_snapshots (page_id, up_to_seq) where invalid_at is null;
create index page_snapshots_chain_idx on public.page_snapshots (chain_id);

alter table public.page_snapshots enable row level security;
-- Sin políticas ni permisos: si se pudiera leer, se verían también los sin confirmar y los invalidados.
revoke all on public.page_snapshots from public, anon, authenticated;

alter table public.pages
  -- El `up_to_seq` del snapshot vigente (0: ninguno). Solo una pista para el árbol: las funciones deciden siempre con
  -- `private.current_snapshot`.
  add column snapshot_seq  bigint not null default 0 check (snapshot_seq >= 0),
  -- Sube cada vez que se invalida una cadena: un dispositivo que aplicó un snapshot de esta página y ve otra época
  -- vuelve a bajarla. Nunca vuelve atrás (tampoco al restaurar una copia: lo hace el script de restaurar).
  add column content_epoch int    not null default 0 check (content_epoch >= 0);
-- Las dos se leen con el árbol (`pages` tiene `grant select` de tabla) y no se escriben desde la API (los `grant
-- update` de `pages` son por columna y no las nombran). Las cambian solo las funciones de abajo, que corren como su
-- dueño: el trigger de permisos de `pages` no las frena y `updated_at` no cambia.

-- La reserva y el "no reintentar" de compactar, aparte de `pages`: nadie los lee desde la API (quién compacta qué no
-- es asunto de quien solo ve la página).
create table public.page_compaction (
  page_id    uuid primary key references public.pages (id) on delete cascade,
  claim_at   timestamptz,
  claim_by   uuid,
  -- Una página que no se puede compactar (más de 8 MB, una fila ilegible, una comprobación que falla) no se vuelve a
  -- reservar hasta acá, y queda el motivo para mirarlo.
  skip_until timestamptz,
  skip_why   text
);

alter table public.page_compaction enable row level security;
revoke all on public.page_compaction from public, anon, authenticated;

alter table public.workspace_settings
  -- El interruptor: null, apagados (nadie arma ni recibe snapshots). Con un número, la versión mínima de la app que
  -- arma snapshots, y solo se sirven las cadenas armadas enteras por esa versión o una más nueva.
  add column snapshot_min_version numeric(8, 3) check (snapshot_min_version >= 0);

-- ---------------------------------------------------------------------------------------------------
-- 2. Funciones auxiliares (nadie las ejecuta desde la API)
-- ---------------------------------------------------------------------------------------------------
create function private.snapshot_min_version()
returns numeric
language sql stable security definer set search_path = ''
as $$
  select s.snapshot_min_version from public.workspace_settings s where s.id;
$$;

-- ¿Esta versión de la app puede armar snapshots? Prendidos, la mínima del workspace y la de los snapshots.
create function private.snapshots_allowed(p_version text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.snapshot_min_version() is not null
     and private.app_version_allowed(p_version)
     and coalesce(p_version ~ '^[0-9]{1,4}(\.[0-9]{1,3})?$', false)
     and (case when p_version ~ '^[0-9]{1,4}(\.[0-9]{1,3})?$' then p_version::numeric else -1 end)
         >= private.snapshot_min_version();
$$;

-- El snapshot vigente de una página, si es válido: confirmado, no invalidado, no pasa de `update_seq`, su última fila
-- sigue teniendo su id y toda su cadena es de una versión permitida. Nada si los snapshots están apagados.
create function private.current_snapshot(p uuid)
returns public.page_snapshots
language sql stable security definer set search_path = ''
as $$
  select s.*
  from public.page_snapshots s
  join public.pages pg on pg.id = s.page_id
  where s.page_id = p
    and s.confirmed_at is not null
    and s.invalid_at is null
    and private.snapshot_min_version() is not null
    and s.chain_min_version >= private.snapshot_min_version()
    and s.up_to_seq <= pg.update_seq
    and exists (
      select 1 from public.page_updates u
      where u.page_id = p and u.seq = s.up_to_seq and u.id = s.last_update_id)
  order by s.up_to_seq desc
  limit 1;
$$;

-- Invalida la cadena entera (un error en un eslabón pasa a los que se armaron encima): `snapshot_seq` a 0 y la época
-- de contenido de la página sube. Devuelve cuántos invalidó.
create function private.invalidate_snapshot_chain(p_page uuid, p_chain uuid, p_reason text)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  update public.page_snapshots
  set invalid_at = now(), invalid_reason = left(coalesce(p_reason, 'invalidated'), 500)
  where chain_id = p_chain and invalid_at is null;
  get diagnostics n = row_count;
  if n > 0 then
    update public.pages set snapshot_seq = 0, content_epoch = content_epoch + 1 where id = p_page;
  end if;
  return n;
end;
$$;

revoke all on function private.snapshot_min_version() from public, anon, authenticated;
revoke all on function private.snapshots_allowed(text) from public, anon, authenticated;
revoke all on function private.current_snapshot(uuid) from public, anon, authenticated;
revoke all on function private.invalidate_snapshot_chain(uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 3. Bajar
-- ---------------------------------------------------------------------------------------------------
-- Como `pull_page_updates` (la llama: misma respuesta, también la base limpia para quien no ve lo borrado), con dos
-- columnas más: `snapshot_id` y la época de contenido de la página, leída en la misma consulta. Si hay un snapshot
-- vigente que llega más allá de `p_after_seq`, quien llama ve lo borrado y el snapshot pesa menos que las filas que
-- reemplaza: primero el snapshot (con `seq = up_to_seq`) y después las filas siguientes, hasta `p_limit` en total.
create function public.pull_page_content(p_page_id uuid, p_after_seq bigint, p_limit int default 200)
returns table (seq bigint, update text, snapshot_id uuid, content_epoch int)
language plpgsql stable security definer set search_path = ''
as $$
declare
  s        public.page_snapshots;
  ep       int;
  from_seq bigint := coalesce(p_after_seq, 0);
  lim      int := least(greatest(coalesce(p_limit, 200), 1), 1000);
begin
  if not private.can_view_page(p_page_id) then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  select pg.content_epoch into ep from public.pages pg where pg.id = p_page_id;
  if private.sees_deleted(p_page_id) then
    s := private.current_snapshot(p_page_id);
    if s.id is not null and s.up_to_seq > from_seq
       and s.state_bytes < (select coalesce(sum(octet_length(u.update)), 0) from public.page_updates u
                            where u.page_id = p_page_id and u.seq > from_seq and u.seq <= s.up_to_seq) then
      return query select s.up_to_seq, translate(encode(s.state, 'base64'), E'\n', ''), s.id, ep;
      lim := lim - 1;
      if lim = 0 then
        return;
      end if;
      return query
        select u.seq, translate(encode(u.update, 'base64'), E'\n', ''), null::uuid, ep
        from public.page_updates u
        where u.page_id = p_page_id and u.seq > s.up_to_seq
        order by u.seq
        limit lim;
      return;
    end if;
  end if;
  return query
    select r.seq, r.update, null::uuid, ep
    from public.pull_page_updates(p_page_id, from_seq, lim) r;
end;
$$;

-- Un snapshot por id, para quien compacta: el vigente (la base del próximo) o uno propio sin confirmar todavía (la
-- vuelta antes de confirmar). Nunca uno invalidado ni de otra persona sin confirmar.
create function public.pull_page_snapshot(p_id uuid)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  s   public.page_snapshots;
  cur public.page_snapshots;
begin
  select * into s from public.page_snapshots ps where ps.id = p_id;
  if not found or not private.can_view_page(s.page_id) then
    raise exception 'snapshot_not_found' using errcode = 'P0002';
  end if;
  if not private.sees_deleted(s.page_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if s.invalid_at is not null then
    raise exception 'snapshot_not_found' using errcode = 'P0002';
  end if;
  if s.confirmed_at is null then
    if s.created_by is distinct from auth.uid() then
      raise exception 'snapshot_not_found' using errcode = 'P0002';
    end if;
  else
    cur := private.current_snapshot(s.page_id);
    if cur.id is distinct from s.id then
      raise exception 'snapshot_not_found' using errcode = 'P0002';
    end if;
  end if;
  return translate(encode(s.state, 'base64'), E'\n', '');
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 4. Compactar: reservar, subir, confirmar, saltear (la app las usa desde la entrega 2)
-- ---------------------------------------------------------------------------------------------------
-- Devuelve el tramo a compactar o nada. Pide: ver lo borrado (el snapshot se arma con las filas del servidor, con lo
-- borrado), los snapshots prendidos y una versión que alcanza, la página fuera de la papelera, sin reserva vigente de
-- otra persona ni bloqueo por un intento fallido, al menos 100 filas después del snapshot vigente y una cola de al
-- menos 64 KB y de al menos la mitad de lo que pesa ese snapshot. Anota la reserva por 10 minutos.
create function public.claim_page_compaction(p_page_id uuid, p_app_version text)
returns table (base_id uuid, base_seq bigint, up_to_seq bigint, last_update_id bigint)
language plpgsql security definer set search_path = ''
as $$
declare
  me    uuid := auth.uid();
  top_seq bigint;
  cur   public.page_snapshots;
  c     public.page_compaction;
  tail  bigint;
  last_id bigint;
  bseq  bigint;
begin
  if not private.can_view_page(p_page_id) then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  if not private.sees_deleted(p_page_id) or not private.snapshots_allowed(p_app_version)
     or private.page_in_trash(p_page_id) then
    return;
  end if;
  -- Con la fila de la página bloqueada: dos reservas (o una reserva y una subida) no se cruzan.
  select pg.update_seq into top_seq from public.pages pg where pg.id = p_page_id for update;
  select * into c from public.page_compaction pc where pc.page_id = p_page_id;
  if c.skip_until is not null and c.skip_until > now() then
    return;
  end if;
  if c.claim_at is not null and c.claim_at > now() - interval '10 minutes' and c.claim_by is distinct from me then
    return;
  end if;
  cur := private.current_snapshot(p_page_id);
  bseq := coalesce(cur.up_to_seq, 0);
  if top_seq - bseq < 100 then
    return;
  end if;
  select coalesce(sum(octet_length(u.update)), 0) into tail
  from public.page_updates u where u.page_id = p_page_id and u.seq > bseq and u.seq <= top_seq;
  if tail < 65536 or tail < coalesce(cur.state_bytes, 0) / 2 then
    return;
  end if;
  select u.id into last_id from public.page_updates u where u.page_id = p_page_id and u.seq = top_seq;
  if last_id is null then
    return;
  end if;
  insert into public.page_compaction (page_id, claim_at, claim_by) values (p_page_id, now(), me)
  on conflict (page_id) do update set claim_at = now(), claim_by = me;
  base_id := cur.id;
  base_seq := bseq;
  up_to_seq := top_seq;
  last_update_id := last_id;
  return next;
end;
$$;

-- Sube un snapshot SIN confirmar (el update de Yjs y su vector en base64, la huella SHA-256 en hexadecimal). Devuelve
-- `(id, 'ok')`; reintentar lo mismo devuelve el mismo id. Si ya hay uno válido para el mismo tramo y la misma base con
-- otra huella: armado por la misma versión de la app, guarda el nuevo ya invalidado, invalida la cadena del otro y
-- devuelve `snapshot_mismatch` (dos dispositivos calcularon distinto lo mismo); por otra versión, `snapshot_exists`.
-- Errores: `snapshot_invalid`, `state_size_invalid`, `sha256_mismatch` (22023), `page_not_found` (P0002),
-- `not_allowed` (42501), `snapshot_off`, `app_outdated`, `snapshot_row_mismatch`, `snapshot_base_stale` (P0001).
create function public.push_page_snapshot(
  p_page_id uuid, p_base_id uuid, p_up_to_seq bigint, p_last_update_id bigint, p_state text, p_sv text,
  p_sha256 text, p_app_version text)
returns table (snapshot_id uuid, result text)
language plpgsql security definer set search_path = ''
as $$
declare
  top_seq    bigint;
  cur    public.page_snapshots;
  base   public.page_snapshots;
  other  public.page_snapshots;
  bin    bytea;
  sv     bytea;
  hash   bytea;
  ver    numeric;
  new_id uuid := gen_random_uuid();
begin
  if p_page_id is null or p_up_to_seq is null or p_last_update_id is null or p_state is null or p_sv is null
     or p_sha256 is null then
    raise exception 'snapshot_invalid' using errcode = '22023';
  end if;
  if not private.can_view_page(p_page_id) then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  if not private.sees_deleted(p_page_id) then
    raise exception 'not_allowed' using errcode = '42501',
      hint = 'Only someone who can edit the page and is not a guest compacts it.';
  end if;
  if private.snapshot_min_version() is null then
    raise exception 'snapshot_off' using errcode = 'P0001';
  end if;
  if not private.snapshots_allowed(p_app_version) then
    raise exception 'app_outdated' using errcode = 'P0001',
      hint = 'This version of the app is too old for this workspace. Reload the app to update it.';
  end if;
  ver := p_app_version::numeric;

  select pg.update_seq into top_seq from public.pages pg where pg.id = p_page_id for update;

  begin
    bin := decode(p_state, 'base64');
    sv := decode(p_sv, 'base64');
    hash := decode(p_sha256, 'hex');
  exception when others then
    raise exception 'snapshot_invalid' using errcode = '22023';
  end;
  if octet_length(bin) = 0 or octet_length(bin) > 8 * 1024 * 1024 then
    raise exception 'state_size_invalid' using errcode = '22023';
  end if;
  if hash is distinct from extensions.digest(bin, 'sha256') then
    raise exception 'sha256_mismatch' using errcode = '22023';
  end if;
  if p_up_to_seq < 1 or p_up_to_seq > top_seq or not exists (
       select 1 from public.page_updates u
       where u.page_id = p_page_id and u.seq = p_up_to_seq and u.id = p_last_update_id) then
    raise exception 'snapshot_row_mismatch' using errcode = 'P0001';
  end if;

  -- El mismo tramo sobre la misma base: reintento, o dos dispositivos que compactaron lo mismo.
  select * into other from public.page_snapshots ps
  where ps.page_id = p_page_id and ps.up_to_seq = p_up_to_seq and ps.invalid_at is null;
  if found then
    if other.base_id is not distinct from p_base_id and other.sha256 = hash then
      snapshot_id := other.id;
      result := 'ok';
      return next;
      return;
    end if;
    if other.base_id is not distinct from p_base_id and other.app_version = ver then
      insert into public.page_snapshots (id, page_id, up_to_seq, last_update_id, base_id, chain_id, chain_min_version,
                                         state, state_sv, sha256, app_version, invalid_at, invalid_reason)
      values (new_id, p_page_id, p_up_to_seq, p_last_update_id, p_base_id, new_id, ver, bin, sv, hash, ver, now(),
              'snapshot_mismatch');
      perform private.invalidate_snapshot_chain(p_page_id, other.chain_id, 'snapshot_mismatch');
      snapshot_id := new_id;
      result := 'snapshot_mismatch';
      return next;
      return;
    end if;
    snapshot_id := other.id;
    result := 'snapshot_exists';
    return next;
    return;
  end if;

  -- Nunca sobre una base vieja: la base es el snapshot vigente (o ninguno, y entonces no hay vigente).
  cur := private.current_snapshot(p_page_id);
  if cur.id is distinct from p_base_id or p_up_to_seq <= coalesce(cur.up_to_seq, 0) then
    raise exception 'snapshot_base_stale' using errcode = 'P0001';
  end if;
  base := cur;

  insert into public.page_snapshots (id, page_id, up_to_seq, last_update_id, base_id, chain_id, chain_min_version,
                                     state, state_sv, sha256, app_version)
  values (new_id, p_page_id, p_up_to_seq, p_last_update_id, p_base_id, coalesce(base.chain_id, new_id),
          least(coalesce(base.chain_min_version, ver), ver), bin, sv, hash, ver);
  snapshot_id := new_id;
  result := 'ok';
  return next;
end;
$$;

-- Confirma un snapshot propio que el dispositivo bajó entero y comprobó: la huella coincide, su base sigue siendo la
-- vigente y su última fila sigue con su id. Desde ahí se sirve. Limpia los de la página anteriores a su base, los sin
-- confirmar de más de un día y los invalidados de más de 30 días. `true` si quedó confirmado (también si ya lo
-- estaba); `false` si ya no vale (invalidado, base vieja, fila cambiada).
create function public.confirm_page_snapshot(p_id uuid, p_sha256 text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  s    public.page_snapshots;
  cur  public.page_snapshots;
  base public.page_snapshots;
  top_seq  bigint;
  hash bytea;
begin
  select * into s from public.page_snapshots ps where ps.id = p_id;
  if not found or not private.can_view_page(s.page_id) then
    raise exception 'snapshot_not_found' using errcode = 'P0002';
  end if;
  if not private.sees_deleted(s.page_id) or s.created_by is distinct from auth.uid() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if private.snapshot_min_version() is null then
    raise exception 'snapshot_off' using errcode = 'P0001';
  end if;
  begin
    hash := decode(p_sha256, 'hex');
  exception when others then
    raise exception 'snapshot_invalid' using errcode = '22023';
  end;
  if hash is distinct from s.sha256 then
    raise exception 'sha256_mismatch' using errcode = '22023';
  end if;

  select pg.update_seq into top_seq from public.pages pg where pg.id = s.page_id for update;
  -- Otra vez, con la página bloqueada.
  select * into s from public.page_snapshots ps where ps.id = p_id;
  if s.invalid_at is not null then
    return false;
  end if;
  if s.confirmed_at is not null then
    return true;
  end if;
  cur := private.current_snapshot(s.page_id);
  if cur.id is distinct from s.base_id or s.up_to_seq <= coalesce(cur.up_to_seq, 0) or s.up_to_seq > top_seq
     or not exists (select 1 from public.page_updates u
                    where u.page_id = s.page_id and u.seq = s.up_to_seq and u.id = s.last_update_id)
     or s.chain_min_version < private.snapshot_min_version() then
    return false;
  end if;

  update public.page_snapshots set confirmed_at = now() where id = s.id;
  update public.pages set snapshot_seq = s.up_to_seq where id = s.page_id;
  update public.page_compaction set claim_at = null, claim_by = null where page_id = s.page_id;
  -- Limpieza: todo se puede volver a armar desde `page_updates`. Quedan este y su base.
  base := cur;
  delete from public.page_snapshots ps
  where ps.page_id = s.page_id and ps.id <> s.id and ps.id is distinct from base.id
    and ((ps.confirmed_at is not null and ps.invalid_at is null and ps.up_to_seq < coalesce(base.up_to_seq, s.up_to_seq))
         or (ps.confirmed_at is null and ps.invalid_at is null and ps.created_at < now() - interval '1 day')
         or (ps.invalid_at is not null and ps.invalid_at < now() - interval '30 days'));
  return true;
end;
$$;

-- No se pudo compactar (más de 8 MB, una fila ilegible, la comprobación falló): la página no se vuelve a reservar
-- por 24 horas, con el motivo para mirarlo.
create function public.skip_page_compaction(p_page_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.can_view_page(p_page_id) then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  if not private.sees_deleted(p_page_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  insert into public.page_compaction (page_id, skip_until, skip_why)
  values (p_page_id, now() + interval '24 hours', left(coalesce(p_reason, 'skipped'), 500))
  on conflict (page_id) do update
    set skip_until = excluded.skip_until, skip_why = excluded.skip_why, claim_at = null, claim_by = null;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 5. Si un snapshot sale mal: invalidar la cadena entera (también a mano, desde el SQL Editor)
-- ---------------------------------------------------------------------------------------------------
-- Pide poder editar la página (nivel 3). `true` si invalidó algo. Los dispositivos que usaron un snapshot de esta
-- página ven otra `content_epoch` y la vuelven a bajar.
create function public.invalidate_page_snapshot(p_id uuid, p_reason text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  s public.page_snapshots;
begin
  select * into s from public.page_snapshots ps where ps.id = p_id;
  if not found or not private.can_view_page(s.page_id) then
    raise exception 'snapshot_not_found' using errcode = 'P0002';
  end if;
  if not private.can_edit_page(s.page_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform 1 from public.pages pg where pg.id = s.page_id for update;
  return private.invalidate_snapshot_chain(s.page_id, s.chain_id, p_reason) > 0;
end;
$$;

revoke all on function public.pull_page_content(uuid, bigint, int) from public, anon;
revoke all on function public.pull_page_snapshot(uuid) from public, anon;
revoke all on function public.claim_page_compaction(uuid, text) from public, anon;
revoke all on function public.push_page_snapshot(uuid, uuid, bigint, bigint, text, text, text, text) from public, anon;
revoke all on function public.confirm_page_snapshot(uuid, text) from public, anon;
revoke all on function public.skip_page_compaction(uuid, text) from public, anon;
revoke all on function public.invalidate_page_snapshot(uuid, text) from public, anon;
grant execute on function public.pull_page_content(uuid, bigint, int) to authenticated;
grant execute on function public.pull_page_snapshot(uuid) to authenticated;
grant execute on function public.claim_page_compaction(uuid, text) to authenticated;
grant execute on function public.push_page_snapshot(uuid, uuid, bigint, bigint, text, text, text, text) to authenticated;
grant execute on function public.confirm_page_snapshot(uuid, text) to authenticated;
grant execute on function public.skip_page_compaction(uuid, text) to authenticated;
grant execute on function public.invalidate_page_snapshot(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 6. Versión de la base: la app pide `snapshot_seq` y `content_epoch` con el árbol desde la 16
-- ---------------------------------------------------------------------------------------------------
update public.workspace_settings set schema_version = 16 where id and schema_version < 16;

notify pgrst, 'reload schema';
