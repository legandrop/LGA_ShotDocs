-- LGA Shot Docs · comentarios (paso 10 de Docs/Plan_Workspaces.md, secciones 4 y 11).
--
-- Los comentarios viven en una tabla propia, anclados al id de un bloque de la página (o a la página entera),
-- y no dentro del documento: así quien solo comenta no escribe el documento, y una versión de la app que no
-- los conoce no puede borrar nada. Un hilo es un comentario sin `thread_id` y sus respuestas; lo que se
-- resuelve es el hilo (su primer comentario).
--
-- Permisos (la escala de `private.page_level`): se ven los comentarios de las páginas que se ven (1); comentar,
-- responder y resolver piden comentar (2); editar un comentario, solo quien lo escribió (con 2); borrarlo,
-- quien lo escribió (con 2) o quien tiene editar y crear páginas (4). Desde la API la tabla solo se lee, y sin
-- la columna del texto: la app lee los comentarios de una página con `list_comments` (calcula el permiso una
-- sola vez y puede pedir solo lo cambiado desde una fecha, con `updated_at`), que da el texto vacío si el
-- comentario se borró; la vista `comments_view` da lo mismo y queda para compatibilidad (calcula el permiso
-- en cada fila). Nada se borra de verdad: borrar marca `deleted_at` y el texto queda en la base.
--
-- Invitados (`guest`): no hay nada especial para ellos; valen los permisos por página del paso 9. Con comentar
-- en una página, un invitado comenta y responde ahí y en lo de abajo, pero no edita el contenido ni sube
-- archivos; con editar, sube archivos (`register_file`) pero no crea páginas.
--
-- Compatible con la app publicada: solo suma una tabla, una vista y funciones.

-- ---------------------------------------------------------------------------------------------------
-- Tabla
-- ---------------------------------------------------------------------------------------------------
-- Sin cascade en las referencias a páginas (como `files`): nada se borra, y una página con comentarios no se
-- puede borrar por debajo. Las personas, `on delete set null` (como `pages.created_by`): si se borra una
-- cuenta en el panel, sus comentarios quedan sin autor.
create table public.comments (
  id          uuid primary key,                                   -- lo genera el dispositivo (cola sin red)
  page_id     uuid not null references public.pages (id),
  -- El id del bloque de BlockNote (uuid, o `initialBlockId` en la semilla); null: la página entera. Una
  -- respuesta lleva el del hilo.
  block_id    text check (block_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  thread_id   uuid,                                               -- null: abre un hilo
  body        text not null check (char_length(body) between 1 and 10000 and body ~ '[^[:space:]]'),
  author_id   uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  edited_at   timestamptz,                                        -- la última edición del texto
  resolved_at timestamptz,                                        -- solo en el primer comentario del hilo
  resolved_by uuid references auth.users (id) on delete set null,
  deleted_at  timestamptz,                                        -- borrado: el texto queda en la base
  deleted_by  uuid references auth.users (id) on delete set null,
  -- El último cambio (alta, edición, borrado, resolver o volver a abrir): `list_comments` pide lo posterior.
  updated_at  timestamptz not null default now(),
  constraint comments_id_page_key unique (id, page_id),
  -- Una respuesta cuelga de un comentario de la misma página.
  constraint comments_thread_fk foreign key (thread_id, page_id) references public.comments (id, page_id),
  constraint comments_thread_not_self check (thread_id <> id),
  constraint comments_resolved_thread check (resolved_at is null or thread_id is null),
  constraint comments_resolved_by check (resolved_by is null or resolved_at is not null),
  constraint comments_deleted_by check (deleted_by is null or deleted_at is not null)
);
create index comments_page_idx on public.comments (page_id, created_at);
create index comments_page_updated_idx on public.comments (page_id, updated_at);
create index comments_thread_idx on public.comments (thread_id) where thread_id is not null;

-- ---------------------------------------------------------------------------------------------------
-- Lectura: Row Level Security y la vista con el texto
-- ---------------------------------------------------------------------------------------------------

alter table public.comments enable row level security;

create policy comments_select on public.comments
  for select to authenticated using (private.page_level(page_id) >= 1);

-- La tabla se lee sin `body` (pedir esa columna, o `*`, da 42501). El texto sale por `list_comments` y por
-- `comments_view`.
revoke all on public.comments from public, anon, authenticated;
grant select (id, page_id, block_id, thread_id, author_id, created_at, edited_at, resolved_at, resolved_by,
              deleted_at, deleted_by, updated_at)
  on public.comments to authenticated;

-- El texto de un comentario que no se borró, a quien ve su página; null en cualquier otro caso. Corre como
-- definer porque la sesión no tiene permiso sobre la columna `body`.
create function private.comment_body(p_id uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select c.body
  from public.comments c
  where c.id = p_id and c.deleted_at is null and private.page_level(c.page_id) >= 1;
$$;

revoke all on function private.comment_body(uuid) from public, anon;
grant execute on function private.comment_body(uuid) to authenticated;

-- La tabla con el texto, para compatibilidad (la app usa `list_comments`, que es más rápida). Corre con los
-- permisos de quien consulta (`security_invoker`), así que las filas las filtra la política de la tabla. Un
-- comentario borrado sigue apareciendo (para que los dispositivos se enteren y el hilo no quede cortado), con
-- `body` vacío.
create view public.comments_view
with (security_invoker = true)
as
  select c.id, c.page_id, c.block_id, c.thread_id,
         case when c.deleted_at is null then private.comment_body(c.id) end as body,
         c.author_id, c.created_at, c.edited_at, c.resolved_at, c.resolved_by, c.deleted_at, c.deleted_by,
         c.updated_at
  from public.comments c;

revoke all on public.comments_view from public, anon, authenticated;
grant select on public.comments_view to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- API (RPC)
-- ---------------------------------------------------------------------------------------------------
-- Errores: `page_not_found`, `comment_not_found` y `thread_not_found` (P0002) cuando no existe o la sesión no
-- ve su página (no dicen cuál de las dos); `comment_denied` (42501) si la ve pero no tiene comentar;
-- `not_allowed` (42501) si edita un comentario ajeno o borra uno sin permiso; `thread_other_page`,
-- `comment_conflict` y `comment_deleted` (P0001); `thread_invalid` y `resolved_invalid` (22023), y los de las
-- restricciones de la tabla (23514) si el texto o el bloque no tienen la forma esperada.

-- Los comentarios de una página: lo mismo que `comments_view` (el texto vacío si se borró) más `updated_at`,
-- calculando el permiso una sola vez. Con `p_since`, solo los que cambiaron desde esa fecha (incluida): la
-- app pide desde el último `updated_at` que tiene menos un margen (una transacción larga puede guardar una
-- fecha anterior a la de otra que ya terminó), y volver a recibir un comentario no cambia nada. En orden de
-- cambio. `page_not_found` si la sesión no ve la página.
create function public.list_comments(p_page_id uuid, p_since timestamptz default null)
returns table (id uuid, page_id uuid, block_id text, thread_id uuid, body text, author_id uuid,
               created_at timestamptz, edited_at timestamptz, resolved_at timestamptz, resolved_by uuid,
               deleted_at timestamptz, deleted_by uuid, updated_at timestamptz)
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
           c.updated_at
    from public.comments c
    where c.page_id = p_page_id and (p_since is null or c.updated_at >= p_since)
    order by c.updated_at, c.id;
end;
$$;

-- Agrega un comentario (o una respuesta, con `p_thread_id`: el id del primer comentario del hilo, que tiene
-- que ser de la misma página; la respuesta toma el bloque del hilo). Pide comentar en la página. Reintentar
-- (la cola sin red) con el mismo id y el mismo contenido no hace nada, también si el comentario ya se borró;
-- con otro contenido, o de otra persona, es `comment_conflict`: la app no junta el alta con una edición.
-- El reintento se reconoce antes de mirar el permiso: si la respuesta se perdió y después le bajaron el
-- permiso (o la sacaron), el alta ya estaba hecha y da bien. No filtra nada: solo coincide para su autor y
-- con el texto exacto.
create function public.add_comment(
  p_id uuid, p_page_id uuid, p_block_id text, p_thread_id uuid, p_body text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid  uuid := auth.uid();
  lvl  int;
  blk  text := p_block_id;
  root public.comments;
  cur  public.comments;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into cur from public.comments c where c.id = p_id;
  if found and cur.author_id = uid and cur.page_id = p_page_id and cur.body = p_body
     and cur.thread_id is not distinct from p_thread_id
     and (cur.block_id is not distinct from p_block_id or (p_thread_id is not null and p_block_id is null)) then
    return;
  end if;

  lvl := private.page_level(p_page_id);
  if p_id is null or lvl < 1 then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  if lvl < 2 then
    raise exception 'comment_denied' using errcode = '42501',
      hint = 'Commenting needs the "comment" permission on the page.';
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
    -- Se responde al primer comentario del hilo, no a una respuesta; y la respuesta va en el bloque del hilo.
    if root.thread_id is not null or (blk is not null and blk is distinct from root.block_id) then
      raise exception 'thread_invalid' using errcode = '22023';
    end if;
    blk := root.block_id;
  end if;

  insert into public.comments (id, page_id, block_id, thread_id, body, author_id)
  values (p_id, p_page_id, blk, p_thread_id, p_body, uid)
  on conflict (id) do nothing;
  if found then
    return;
  end if;

  select * into cur from public.comments c where c.id = p_id;
  if (cur.author_id, cur.page_id, cur.block_id, cur.thread_id, cur.body)
     is distinct from (uid, p_page_id, blk, p_thread_id, p_body) then
    raise exception 'comment_conflict' using errcode = 'P0001';
  end if;
end;
$$;

-- Cambia el texto de un comentario: solo quien lo escribió, mientras tenga comentar en la página. El mismo
-- texto no cambia nada (tampoco `edited_at`), y se reconoce antes de mirar el permiso (el reintento de una
-- edición que ya se hizo). Un comentario borrado no se edita (`comment_deleted`).
create function public.edit_comment(p_id uuid, p_body text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  cur public.comments;
  lvl int;
begin
  select * into cur from public.comments c where c.id = p_id for update;
  if found and cur.author_id = auth.uid() and cur.deleted_at is null and cur.body = p_body then
    return;
  end if;
  if found then
    lvl := private.page_level(cur.page_id);
  end if;
  if coalesce(lvl, 0) < 1 then
    raise exception 'comment_not_found' using errcode = 'P0002';
  end if;
  if cur.author_id is distinct from auth.uid() then
    raise exception 'not_allowed' using errcode = '42501', hint = 'Only the author edits a comment.';
  end if;
  if lvl < 2 then
    raise exception 'comment_denied' using errcode = '42501';
  end if;
  if cur.deleted_at is not null then
    raise exception 'comment_deleted' using errcode = 'P0001';
  end if;
  update public.comments set body = p_body, edited_at = now(), updated_at = now() where id = p_id;
end;
$$;

-- Borra un comentario: lo marca (`deleted_at`, `deleted_by`) y el texto queda en la base, pero la vista ya no
-- lo devuelve. Lo hace quien lo escribió (con comentar) o quien tiene editar y crear páginas en la página.
-- Borrar uno ya borrado no hace nada; si lo borró la misma persona, da bien antes de mirar el permiso (el
-- reintento de un borrado que ya se hizo). Las respuestas de un hilo no se tocan.
create function public.delete_comment(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  cur public.comments;
  lvl int;
begin
  select * into cur from public.comments c where c.id = p_id for update;
  if found and cur.deleted_at is not null and cur.deleted_by = uid then
    return;
  end if;
  if found then
    lvl := private.page_level(cur.page_id);
  end if;
  if coalesce(lvl, 0) < 1 then
    raise exception 'comment_not_found' using errcode = 'P0002';
  end if;
  if not ((coalesce(cur.author_id = uid, false) and lvl >= 2) or lvl >= 4) then
    raise exception 'not_allowed' using errcode = '42501',
      hint = 'The author or someone with "edit and create pages" on the page deletes a comment.';
  end if;
  if cur.deleted_at is null then
    update public.comments set deleted_at = now(), deleted_by = uid, updated_at = now() where id = p_id;
  end if;
end;
$$;

-- Resuelve un hilo (o lo vuelve a abrir) con comentar en la página. `p_thread_id` es el primer comentario del
-- hilo. Resolver uno ya resuelto (o abrir uno abierto) no cambia nada: queda quién y cuándo lo resolvió.
create function public.resolve_thread(p_thread_id uuid, p_resolved boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  root public.comments;
  lvl  int;
begin
  if p_resolved is null then
    raise exception 'resolved_invalid' using errcode = '22023';
  end if;
  select * into root from public.comments c where c.id = p_thread_id for update;
  if found then
    lvl := private.page_level(root.page_id);
  end if;
  if coalesce(lvl, 0) < 1 then
    raise exception 'thread_not_found' using errcode = 'P0002';
  end if;
  if root.thread_id is not null then
    raise exception 'thread_invalid' using errcode = '22023';
  end if;
  if lvl < 2 then
    raise exception 'comment_denied' using errcode = '42501';
  end if;
  if p_resolved and root.resolved_at is null then
    update public.comments set resolved_at = now(), resolved_by = auth.uid(), updated_at = now()
    where id = p_thread_id;
  elsif not p_resolved and root.resolved_at is not null then
    update public.comments set resolved_at = null, resolved_by = null, updated_at = now()
    where id = p_thread_id;
  end if;
end;
$$;

-- Quiénes aparecen en los comentarios de una página (quien escribió, resolvió o borró alguno), con su correo,
-- para mostrar sus nombres. Decisión de Lega: los clientes ven los nombres y correos del equipo en los
-- comentarios (`list_members` a un invitado le da solo su fila). Solo a quien ve la página; si no,
-- `page_not_found`. Incluye a quienes ya no son miembros: lo que escribieron sigue ahí.
create function public.comment_authors(p_page_id uuid)
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
      select c.deleted_by from public.comments c where c.page_id = p_page_id)
    order by u.email, u.id;
end;
$$;

revoke all on function public.list_comments(uuid, timestamptz) from public, anon;
revoke all on function public.add_comment(uuid, uuid, text, uuid, text) from public, anon;
revoke all on function public.edit_comment(uuid, text) from public, anon;
revoke all on function public.delete_comment(uuid) from public, anon;
revoke all on function public.resolve_thread(uuid, boolean) from public, anon;
revoke all on function public.comment_authors(uuid) from public, anon;
grant execute on function public.list_comments(uuid, timestamptz) to authenticated;
grant execute on function public.add_comment(uuid, uuid, text, uuid, text) to authenticated;
grant execute on function public.edit_comment(uuid, text) to authenticated;
grant execute on function public.delete_comment(uuid) to authenticated;
grant execute on function public.resolve_thread(uuid, boolean) to authenticated;
grant execute on function public.comment_authors(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Versión de la base
-- ---------------------------------------------------------------------------------------------------
update public.workspace_settings set schema_version = 5 where id and schema_version < 5;

notify pgrst, 'reload schema';
