-- LGA Shot Docs · comentarios importados (Docs/Doc_Importar_Coda.md, "3. Comentarios").
--
-- Los comentarios que vienen de otra herramienta (hoy, Coda) pueden ser de personas que no tienen cuenta en la
-- app y que no tienen por qué enterarse: no se les crea cuenta ni se les manda nada. Un comentario importado
-- guarda el nombre y el correo que da la herramienta (`imported_author`, `imported_author_email`) y queda sin
-- autor en la app (`author_id` nulo): nadie lo edita, y lo borra quien hoy borra comentarios ajenos (4). Si el
-- comentario es de quien importa (su mismo correo), la app lo manda sin autor externo y queda a su nombre, como
-- uno propio. En los dos casos `imported_from` dice de dónde vino, `imported_by` quién lo importó (la app lo
-- muestra), y `created_at` guarda la fecha original.
--
-- Se escribe solo con `import_comment`, que pide editar y crear páginas (4) en la página: importar es armar
-- contenido con autores y fechas de otra herramienta, algo que no hace quien solo edita (un invitado, por
-- ejemplo). `list_comments` y `comments_view` suman las columnas nuevas, y `comment_authors` suma a quien
-- importó. Los que ven la página ven también el correo del autor importado (decisión de Lega, como los correos
-- del equipo en `comment_authors`).
--
-- Compatible con la app publicada: suma columnas (vacías en todo lo que ya existe), una función, y columnas al
-- final de lo que devuelven `list_comments` y `comments_view`, que la app publicada ignora. Un comentario
-- importado de otra persona se le ve como de una cuenta borrada, sin perder nada.

-- ---------------------------------------------------------------------------------------------------
-- Tabla
-- ---------------------------------------------------------------------------------------------------
alter table public.comments
  -- Los orígenes que se conocen. Uno nuevo se suma con su migración.
  add column imported_from         text check (imported_from in ('coda')),
  add column imported_author       text check (char_length(imported_author) between 1 and 200
                                               and imported_author ~ '[^[:space:]]'),
  add column imported_author_email text check (char_length(imported_author_email) between 3 and 320),
  add column imported_by           uuid references auth.users (id) on delete set null;

alter table public.comments
  -- Un autor externo solo en un comentario importado, y sin autor de la app.
  add constraint comments_imported_author check (
    imported_author is null or (imported_from is not null and author_id is null)),
  add constraint comments_imported_email check (imported_author_email is null or imported_author is not null),
  add constraint comments_imported_by check (imported_by is null or imported_from is not null);

-- Las columnas nuevas se leen como las demás (sin el texto, que sigue saliendo solo por las funciones).
grant select (imported_from, imported_author, imported_author_email, imported_by)
  on public.comments to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Lectura: la vista y `list_comments` suman las columnas (al final); `comment_authors`, a quien importó
-- ---------------------------------------------------------------------------------------------------
create or replace view public.comments_view
with (security_invoker = true)
as
  select c.id, c.page_id, c.block_id, c.thread_id,
         case when c.deleted_at is null then private.comment_body(c.id) end as body,
         c.author_id, c.created_at, c.edited_at, c.resolved_at, c.resolved_by, c.deleted_at, c.deleted_by,
         c.updated_at, c.imported_from, c.imported_author, c.imported_author_email, c.imported_by
  from public.comments c;

-- Cambia lo que devuelve: hay que borrarla y crearla de nuevo (en la misma transacción de la migración).
drop function public.list_comments(uuid, timestamptz);

create function public.list_comments(p_page_id uuid, p_since timestamptz default null)
returns table (id uuid, page_id uuid, block_id text, thread_id uuid, body text, author_id uuid,
               created_at timestamptz, edited_at timestamptz, resolved_at timestamptz, resolved_by uuid,
               deleted_at timestamptz, deleted_by uuid, updated_at timestamptz,
               imported_from text, imported_author text, imported_author_email text, imported_by uuid)
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
           c.updated_at, c.imported_from, c.imported_author, c.imported_author_email, c.imported_by
    from public.comments c
    where c.page_id = p_page_id and (p_since is null or c.updated_at >= p_since)
    order by c.updated_at, c.id;
end;
$$;

-- Lo mismo que antes, más quien importó comentarios en la página (para mostrar "Imported by").
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
      select c.imported_by from public.comments c where c.page_id = p_page_id)
    order by u.email, u.id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Escritura: `import_comment`
-- ---------------------------------------------------------------------------------------------------
-- Importa un comentario (o una respuesta, con `p_thread_id`, como `add_comment`). Pide editar y crear páginas
-- (4) en la página: `import_denied` (42501) si la ve pero no tiene eso. `p_created_at` es la fecha original (ni
-- futura ni anterior a 2000: `created_invalid`, 22023); `updated_at` queda en el momento de importar, así los
-- dispositivos lo bajan con su sincronización de siempre. `p_resolved_at`, solo en el primer comentario del hilo
-- (`resolved_invalid`): el hilo entra resuelto, sin quién (la herramienta de origen no lo dice).
-- `p_author_name` nulo: el comentario queda a nombre de quien importa (era suyo); si no, queda sin autor de la
-- app, con ese nombre y `p_author_email` (en minúsculas).
--
-- Reintentar con el mismo id y el mismo contenido no hace nada (la cola sin red), y se reconoce antes de mirar
-- el permiso, como `add_comment`. El mismo comentario importado de nuevo por la misma persona (mismo origen,
-- página, hilo, fecha y autor) tampoco es un conflicto aunque cambie su bloque o su texto: al seguir una
-- importación cortada la página se vuelve a escribir y sus bloques cambian de id, así que el hilo pasa al bloque
-- nuevo (con sus respuestas) si no se borró y el bloque nuevo no es nulo; el texto no cambia (lo que tiene la
-- base, quizás editado, gana).
-- Cualquier otra diferencia, u otra persona, es `comment_conflict`.
create function public.import_comment(
  p_id uuid, p_page_id uuid, p_block_id text, p_thread_id uuid, p_body text,
  p_created_at timestamptz, p_resolved_at timestamptz, p_source text,
  p_author_name text, p_author_email text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid     uuid := auth.uid();
  lvl     int;
  blk     text := p_block_id;
  v_name  text := nullif(btrim(p_author_name), '');
  v_email text := lower(nullif(btrim(p_author_email), ''));
  author  uuid;
  root    public.comments;
  cur     public.comments;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if v_name is null then
    v_email := null;
    author := uid;
  end if;

  select * into cur from public.comments c where c.id = p_id;
  if found and cur.imported_by = uid and cur.page_id = p_page_id and cur.body = p_body
     and cur.thread_id is not distinct from p_thread_id
     and (cur.block_id is not distinct from p_block_id or (p_thread_id is not null and p_block_id is null))
     and cur.created_at = p_created_at and cur.imported_from = p_source
     and cur.author_id is not distinct from author and cur.imported_author is not distinct from v_name
     and cur.imported_author_email is not distinct from v_email then
    return;
  end if;

  lvl := private.page_level(p_page_id);
  if p_id is null or lvl < 1 then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  if lvl < 4 then
    raise exception 'import_denied' using errcode = '42501',
      hint = 'Importing comments needs the "edit and create pages" permission on the page.';
  end if;
  if p_created_at is null or p_created_at > now() + interval '5 minutes' or p_created_at < '2000-01-01'::timestamptz then
    raise exception 'created_invalid' using errcode = '22023';
  end if;
  if p_resolved_at is not null and (p_thread_id is not null or p_resolved_at > now() + interval '5 minutes'
                                    or p_resolved_at < '2000-01-01'::timestamptz) then
    raise exception 'resolved_invalid' using errcode = '22023';
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

  insert into public.comments (id, page_id, block_id, thread_id, body, author_id, created_at, updated_at,
                               resolved_at, imported_from, imported_author, imported_author_email, imported_by)
  values (p_id, p_page_id, blk, p_thread_id, p_body, author, p_created_at, now(),
          p_resolved_at, p_source, v_name, v_email, uid)
  on conflict (id) do nothing;
  if found then
    return;
  end if;

  select * into cur from public.comments c where c.id = p_id for update;
  if (cur.imported_by, cur.page_id, cur.thread_id, cur.created_at, cur.imported_from,
      cur.author_id, cur.imported_author, cur.imported_author_email)
     is distinct from (uid, p_page_id, p_thread_id, p_created_at, p_source, author, v_name, v_email) then
    raise exception 'comment_conflict' using errcode = 'P0001';
  end if;
  -- El mismo comentario, importado de nuevo: el hilo va al bloque de ahora, con sus respuestas. Si esta vez no
  -- se encontró su texto (`blk` nulo), queda donde estaba: su bloque puede seguir ahí.
  if cur.thread_id is null and cur.deleted_at is null and blk is not null and cur.block_id is distinct from blk then
    update public.comments set block_id = blk, updated_at = now()
    where id = p_id or (thread_id = p_id and page_id = p_page_id);
  end if;
end;
$$;

revoke all on function public.list_comments(uuid, timestamptz) from public, anon;
revoke all on function public.comment_authors(uuid) from public, anon;
revoke all on function public.import_comment(uuid, uuid, text, uuid, text, timestamptz, timestamptz, text, text, text)
  from public, anon;
grant execute on function public.list_comments(uuid, timestamptz) to authenticated;
grant execute on function public.comment_authors(uuid) to authenticated;
grant execute on function public.import_comment(uuid, uuid, text, uuid, text, timestamptz, timestamptz, text, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Versión de la base
-- ---------------------------------------------------------------------------------------------------
update public.workspace_settings set schema_version = 8 where id and schema_version < 8;

notify pgrst, 'reload schema';
