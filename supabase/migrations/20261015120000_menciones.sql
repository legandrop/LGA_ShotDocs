-- LGA Shot Docs · menciones en comentarios (P.21, entrega 1; Docs/Doc_Menciones.md). Va después del link público
-- (schema 14): sube `schema_version` a 15.
--
-- Una mención es una fila de `comment_mentions`: quién fue mencionado en qué comentario, con el rótulo que se escribió
-- (`@lega`). El texto del comentario no cambia de forma: sigue siendo texto plano, y una versión vieja de la app ve
-- `@lega` como texto. Nadie lee ni escribe la tabla desde la API: todo pasa por funciones.
--
-- Permisos: la regla única es `private.mention_allowed` (miembro activo que ve la página; los invitados mencionados o
-- que mencionan, con condiciones: sección 4 del doc). Escribe solo el autor del comentario, con Comentar. Cada uno lee
-- solo sus menciones, y solo mientras ve la página. Nada se borra. Los visitantes de un link público no mencionan ni
-- se los menciona: las funciones `plink_*` no tocan esta tabla y `mention_allowed` pide un miembro activo.
--
-- Compatible con las versiones publicadas: suma una tabla y funciones, una columna al final de `list_comments` (que
-- las versiones publicadas ignoran) y las mencionadas a `comment_authors`.

-- ---------------------------------------------------------------------------------------------------
-- 1. La tabla
-- ---------------------------------------------------------------------------------------------------
create table public.comment_mentions (
  id           uuid primary key default gen_random_uuid(),
  comment_id   uuid not null,
  page_id      uuid not null references public.pages (id),
  user_id      uuid not null references auth.users (id) on delete cascade,
  mentioned_by uuid references auth.users (id) on delete set null,
  label        text not null check (char_length(label) between 1 and 64 and label !~ '[[:space:][:cntrl:]@]'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  removed_at   timestamptz,                       -- se sacó del comentario al editarlo
  read_at      timestamptz,                       -- la mencionada la leyó
  constraint comment_mentions_comment_fk foreign key (comment_id, page_id) references public.comments (id, page_id),
  constraint comment_mentions_once unique (comment_id, user_id)
);
create index comment_mentions_inbox_idx on public.comment_mentions (user_id, updated_at);
create index comment_mentions_unread_idx on public.comment_mentions (user_id, created_at)
  where read_at is null and removed_at is null;

alter table public.comment_mentions enable row level security;
revoke all on public.comment_mentions from public, anon, authenticated;
-- Sin políticas ni permisos: la API no la lee ni la escribe.

-- ---------------------------------------------------------------------------------------------------
-- 2. A quién se puede mencionar
-- ---------------------------------------------------------------------------------------------------
-- ¿`caller` puede mencionar a `target` en la página `p`? (Docs/Doc_Menciones.md, sección 4.)
--   - Siempre: miembro activo que ve la página, y no es uno mismo.
--   - Dueño o admin: a cualquiera que la vea (ya ven a todo el workspace con `list_members`).
--   - Miembro: al equipo que ve la página; a un invitado, solo si ya participa en sus comentarios (ME10, mientras
--     Lega no decida otra cosa: no le cuenta qué clientes ven la página).
--   - Invitado: a quien participa en los comentarios de la página o le compartió algo (ME3).
-- `workspace_role(caller)` mira la sesión cuando caller es quien llama: una sesión con contraseña no menciona.
create function private.mention_allowed(p uuid, caller uuid, target uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  caller_role text := private.workspace_role(caller);
  target_role text := private.workspace_role(target);
begin
  if target is null or caller is null or target = caller or caller_role is null or target_role is null
     or private.user_page_level(p, target) < 1 then
    return false;
  end if;
  if caller_role in ('owner', 'admin') or (caller_role <> 'guest' and target_role <> 'guest') then
    return true;
  end if;
  -- Queda: un miembro que menciona a un invitado, o un invitado que menciona a cualquiera.
  if exists (select 1 from public.comments c
             where c.page_id = p and c.deleted_at is null
               and target in (c.author_id, c.resolved_by, c.imported_by)) then
    return true;
  end if;
  return caller_role = 'guest' and (
    exists (select 1 from public.grants g
            where g.user_id = caller and g.revoked_at is null and g.granted_by = target)
    or exists (select 1 from public.invitations i where i.used_by = caller and i.invited_by = target));
end;
$$;
revoke all on function private.mention_allowed(uuid, uuid, uuid) from public, anon, authenticated;

-- El rótulo que propone la lista: la parte del correo antes de la @, sin lo que el rótulo no admite.
create function private.mention_label(email text)
returns text
language sql immutable set search_path = ''
as $$
  select coalesce(nullif(left(regexp_replace(split_part(email, '@', 1), '[[:space:][:cntrl:]"@]', '', 'g'), 64), ''),
                  'user');
$$;
revoke all on function private.mention_label(text) from public, anon, authenticated;

-- La lista del `@`: quienes `mention_allowed` deja. Pide Comentar. En la entrega 1 todas las filas son
-- `has_access = true`; la parte "sin acceso" (ME2) llega con la entrega 2, solo para el dueño y los admins.
create function public.mention_candidates(p_page_id uuid)
returns table (user_id uuid, email text, label text, has_access boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  lvl int := private.page_level(p_page_id);
begin
  if lvl < 1 then raise exception 'page_not_found' using errcode = 'P0002'; end if;
  if lvl < 2 then raise exception 'comment_denied' using errcode = '42501'; end if;
  return query
    select m.user_id, u.email::text, private.mention_label(u.email::text), true
    from public.members m join auth.users u on u.id = m.user_id
    where m.removed_at is null and private.mention_allowed(p_page_id, uid, m.user_id)
    order by 2;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 3. Escribir: el conjunto entero de las menciones de un comentario propio
-- ---------------------------------------------------------------------------------------------------
-- Las nuevas se agregan, las que faltan se marcan `removed_at`, las que vuelven se reactivan conservando `read_at`
-- (no se avisa dos veces). Quien no pasa `mention_allowed` se descarta sin error. Devuelve los ids aceptados.
-- Errores: `mentions_invalid` (22023), `comment_not_found` (P0002), `not_allowed` y `comment_denied` (42501),
-- `comment_deleted` (P0001), `app_outdated` (503, por la versión mínima).
create function public.set_comment_mentions(p_comment_id uuid, p_mentions jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  uid      uuid := auth.uid();
  cur      public.comments;
  lvl      int;
  e        jsonb;
  target   uuid;
  lbl      text;
  wanted   uuid[] := '{}';
  accepted uuid[] := '{}';
  changed  boolean := false;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_mentions is null or jsonb_typeof(p_mentions) <> 'array' or jsonb_array_length(p_mentions) > 20
     or length(p_mentions::text) > 4000 then
    raise exception 'mentions_invalid' using errcode = '22023';
  end if;
  -- La forma de cada una, también el rótulo (1 a 64, sin espacios, controles ni @), antes de escribir nada.
  for e in select x from jsonb_array_elements(p_mentions) x loop
    if jsonb_typeof(e) <> 'object' or (select count(*) from jsonb_object_keys(e)) <> 2
       or coalesce(e ->> 'user_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(e -> 'label') is distinct from 'string'
       or char_length(btrim(e ->> 'label')) not between 1 and 64
       or btrim(e ->> 'label') ~ '[[:space:][:cntrl:]@]' then
      raise exception 'mentions_invalid' using errcode = '22023';
    end if;
    wanted := wanted || (e ->> 'user_id')::uuid;
  end loop;

  select * into cur from public.comments c where c.id = p_comment_id;
  -- El reintento de algo que ya está (mismo conjunto activo, sin contar a uno mismo) da bien antes de mirar el
  -- permiso, como `add_comment`: la cola lo reintenta aunque mientras tanto bajaran el permiso o la versión mínima.
  if found and cur.author_id = uid and cur.deleted_at is null and not exists (
       select 1 from public.comment_mentions m where m.comment_id = cur.id and m.removed_at is null
         and not (m.user_id = any (wanted)))
     and not exists (select 1 from unnest(wanted) w where w <> uid and not exists (
       select 1 from public.comment_mentions m where m.comment_id = cur.id and m.user_id = w and m.removed_at is null)) then
    return coalesce((select jsonb_agg(m.user_id order by m.created_at) from public.comment_mentions m
                     where m.comment_id = cur.id and m.removed_at is null), '[]'::jsonb);
  end if;

  if found then lvl := private.page_level(cur.page_id); end if;
  if coalesce(lvl, 0) < 1 then raise exception 'comment_not_found' using errcode = 'P0002'; end if;
  if cur.author_id is distinct from uid then
    raise exception 'not_allowed' using errcode = '42501', hint = 'Only the author sets the mentions of a comment.';
  end if;
  if lvl < 2 then raise exception 'comment_denied' using errcode = '42501'; end if;
  if cur.deleted_at is not null then raise exception 'comment_deleted' using errcode = 'P0001'; end if;
  perform private.require_session_write_version();

  for e in select x from jsonb_array_elements(p_mentions) x loop
    target := (e ->> 'user_id')::uuid;
    lbl := btrim(e ->> 'label');
    continue when target = any (accepted) or not private.mention_allowed(cur.page_id, uid, target);
    insert into public.comment_mentions (comment_id, page_id, user_id, mentioned_by, label)
    values (cur.id, cur.page_id, target, uid, lbl)
    on conflict (comment_id, user_id) do update
      set removed_at = null, label = excluded.label, updated_at = now()
      where public.comment_mentions.removed_at is not null or public.comment_mentions.label <> excluded.label;
    changed := changed or found;
    accepted := accepted || target;
  end loop;

  update public.comment_mentions set removed_at = now(), updated_at = now()
  where comment_id = cur.id and removed_at is null and not (user_id = any (accepted));
  changed := changed or found;

  -- Los demás dispositivos bajan el comentario con su `mentions` nuevo.
  if changed then
    update public.comments set updated_at = now() where id = cur.id;
  end if;
  return to_jsonb(accepted);
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 4. La campana
-- ---------------------------------------------------------------------------------------------------
-- El número sin leer que la sesión puede ver, contado HASTA 10 (la campana muestra 9+), y lo cambiado desde
-- `p_since`, hasta `p_limit` filas (30 por defecto, 50 como mucho). Una fila que ya no se ve llega solo con `id`,
-- `gone` y `updated_at`.
create function public.mentions_inbox(p_since timestamptz default null, p_limit int default 30)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or private.workspace_role() is null then
    return jsonb_build_object('now', now(), 'unread', 0, 'rows', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'now', now(),
    'unread', (select count(*) from (
                 select 1 from public.comment_mentions m join public.comments c on c.id = m.comment_id
                 where m.user_id = uid and m.read_at is null and m.removed_at is null and c.deleted_at is null
                   and private.user_page_level(m.page_id, uid) >= 1
                 order by m.created_at desc
                 limit 10) t),
    'rows', coalesce((
      select jsonb_agg(r.j order by r.updated_at desc) from (
        select m.updated_at,
               case when v.gone then jsonb_build_object('id', m.id, 'gone', true, 'updated_at', m.updated_at)
               else jsonb_build_object(
                 'id', m.id, 'gone', false, 'updated_at', m.updated_at, 'created_at', m.created_at,
                 'read_at', m.read_at, 'comment_id', m.comment_id, 'page_id', m.page_id,
                 'thread_id', c.thread_id, 'block_id', c.block_id, 'label', m.label,
                 'mentioned_by', m.mentioned_by,
                 'mentioned_by_email', (select u.email::text from auth.users u where u.id = m.mentioned_by),
                 'snippet', left(c.body, 280),
                 'resolved', c.resolved_at is not null
                   or exists (select 1 from public.comments t where t.id = c.thread_id and t.resolved_at is not null),
                 'page_title', pg.title, 'project_id', pg.workspace_id)
               end as j
        from public.comment_mentions m
        join public.comments c on c.id = m.comment_id
        join public.pages pg on pg.id = m.page_id
        cross join lateral (select m.removed_at is not null or c.deleted_at is not null
                                   or private.user_page_level(m.page_id, uid) < 1 as gone) v
        where m.user_id = uid and (p_since is null or m.updated_at >= p_since)
        order by m.updated_at desc
        limit least(greatest(coalesce(p_limit, 30), 1), 50)) r), '[]'::jsonb));
end;
$$;

-- El índice liviano para conciliar lo guardado en el dispositivo: las últimas 200 menciones (por fecha de creación),
-- cada una como [id, gone, leída]. Sin texto ni títulos.
create function public.mentions_index()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or private.workspace_role() is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_array(r.id, r.gone, r.read) order by r.created_at desc) from (
      select m.id, m.created_at, m.read_at is not null as read,
             m.removed_at is not null or c.deleted_at is not null
               or private.user_page_level(m.page_id, uid) < 1 as gone
      from public.comment_mentions m join public.comments c on c.id = m.comment_id
      where m.user_id = uid
      order by m.created_at desc
      limit 200) r), '[]'::jsonb);
end;
$$;

-- Marca leídas las menciones propias: las de `p_ids` o todas las creadas hasta `p_up_to`. Devuelve cuántas cambió.
-- No mira la versión mínima: es el estado de la propia persona y no toca nada de otros.
create function public.mark_mentions_read(p_ids uuid[], p_up_to timestamptz default null)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  if auth.uid() is null or private.workspace_role() is null then return 0; end if;
  if coalesce(cardinality(p_ids), 0) > 500 then raise exception 'ids_invalid' using errcode = '22023'; end if;
  update public.comment_mentions set read_at = now(), updated_at = now()
  where user_id = auth.uid() and read_at is null
    and (id = any (coalesce(p_ids, '{}')) or (p_up_to is not null and created_at <= p_up_to));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 5. Lo que ya leían los comentarios: `list_comments` suma `mentions` y `comment_authors` a las mencionadas
-- ---------------------------------------------------------------------------------------------------
-- `list_comments` cambia lo que devuelve: se borra y se crea en la misma transacción, sobre el cuerpo del link
-- público (con `plink_id` y `plink_author`), con `mentions` al final: las activas, `[{user_id, label}]`; nulo si el
-- comentario se borró.
drop function public.list_comments(uuid, timestamptz);

create function public.list_comments(p_page_id uuid, p_since timestamptz default null)
returns table (id uuid, page_id uuid, block_id text, thread_id uuid, body text, author_id uuid,
               created_at timestamptz, edited_at timestamptz, resolved_at timestamptz, resolved_by uuid,
               deleted_at timestamptz, deleted_by uuid, updated_at timestamptz,
               imported_from text, imported_author text, imported_author_email text, imported_by uuid,
               plink_id uuid, plink_author text, mentions jsonb)
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
           c.plink_id, c.plink_author,
           case when c.deleted_at is null then coalesce((
             select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'label', m.label) order by m.created_at)
             from public.comment_mentions m where m.comment_id = c.id and m.removed_at is null), '[]'::jsonb) end
    from public.comments c
    where c.page_id = p_page_id and (p_since is null or c.updated_at >= p_since)
    order by c.updated_at, c.id;
end;
$$;

revoke all on function public.list_comments(uuid, timestamptz) from public, anon;
grant execute on function public.list_comments(uuid, timestamptz) to authenticated;

-- La vista de compatibilidad, igual: `mentions` al final (la vista y `list_comments` dan lo mismo). La vista es
-- `security_invoker` y la tabla no se lee desde la API: las menciones salen por una función, como el texto.
create function private.comment_mentions_json(p_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'label', m.label) order by m.created_at)
    from public.comment_mentions m where m.comment_id = c.id and m.removed_at is null), '[]'::jsonb)
  from public.comments c
  where c.id = p_id and c.deleted_at is null and private.page_level(c.page_id) >= 1;
$$;
revoke all on function private.comment_mentions_json(uuid) from public, anon, authenticated;
grant execute on function private.comment_mentions_json(uuid) to authenticated;

create or replace view public.comments_view
with (security_invoker = true)
as
  select c.id, c.page_id, c.block_id, c.thread_id,
         case when c.deleted_at is null then private.comment_body(c.id) end as body,
         c.author_id, c.created_at, c.edited_at, c.resolved_at, c.resolved_by, c.deleted_at, c.deleted_by,
         c.updated_at, c.imported_from, c.imported_author, c.imported_author_email, c.imported_by,
         c.plink_id, c.plink_author,
         case when c.deleted_at is null then private.comment_mentions_json(c.id) end as mentions
  from public.comments c;

-- Los correos para el tooltip de cada `@rótulo`: suma a las mencionadas en comentarios sin borrar (ME3: quien
-- escribe decide a quién nombra delante de un cliente).
create or replace function public.comment_authors(p_page_id uuid)
returns table (user_id uuid, email text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if private.page_level(p_page_id) < 1 then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  return query
    select u.id, u.email::text
    from auth.users u
    where u.id in (
      select c.author_id from public.comments c where c.page_id = p_page_id
      union
      select c.resolved_by from public.comments c where c.page_id = p_page_id
      union
      select c.deleted_by from public.comments c where c.page_id = p_page_id
      union
      select c.imported_by from public.comments c where c.page_id = p_page_id
      union
      select m.user_id from public.comment_mentions m join public.comments c on c.id = m.comment_id
      where m.page_id = p_page_id and m.removed_at is null and c.deleted_at is null)
    order by u.email, u.id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 6. Permisos de las funciones nuevas
-- ---------------------------------------------------------------------------------------------------
revoke all on function public.mention_candidates(uuid) from public, anon;
revoke all on function public.set_comment_mentions(uuid, jsonb) from public, anon;
revoke all on function public.mentions_inbox(timestamptz, int) from public, anon;
revoke all on function public.mentions_index() from public, anon;
revoke all on function public.mark_mentions_read(uuid[], timestamptz) from public, anon;
revoke all on function public.comment_authors(uuid) from public, anon;
grant execute on function public.mention_candidates(uuid) to authenticated;
grant execute on function public.set_comment_mentions(uuid, jsonb) to authenticated;
grant execute on function public.mentions_inbox(timestamptz, int) to authenticated;
grant execute on function public.mentions_index() to authenticated;
grant execute on function public.mark_mentions_read(uuid[], timestamptz) to authenticated;
grant execute on function public.comment_authors(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 7. Versión de la base: la app muestra la campana y la lista del `@` desde la 15
-- ---------------------------------------------------------------------------------------------------
update public.workspace_settings set schema_version = 15 where id and schema_version < 15;

notify pgrst, 'reload schema';
