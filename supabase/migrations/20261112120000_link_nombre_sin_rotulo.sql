-- LGA Shot Docs · el nombre del visitante de un link no puede traer «(via link)» (Docs/Doc_Link_Publico.md, "El nombre
-- del visitante sin el rótulo, también en la base").
--
-- El equipo ve a quien escribe por un link como `Ana (via link)`: el rótulo lo pone la app al lado del nombre que el
-- visitante escribió. Desde v0.215 la app saca ese rótulo del nombre antes de mandarlo; la base lo guardaba tal cual,
-- así que llamando a la API a mano (o con una app anterior) un nombre podía llevarlo y verse dos veces.
--
-- `private.plink_author_name` limpia el nombre con la regla de la app (`cleanVisitorName`): saca «(via link)» y
-- «(vía link)», con las mayúsculas, los espacios y los paréntesis (también los anchos) que sean, las veces que haga
-- falta (sacar uno puede dejar armado otro), y deja un solo espacio donde quedaron varios. La usan las dos funciones
-- que guardan ese nombre: `plink_add_comment` (`comments.plink_author`) y `plink_push_page_update`
-- (`public_link_updates.author`, que la admisión copia a `page_updates.plink_author`).
--
-- **Limpia, no rechaza.** Un comentario o una edición con el rótulo en el nombre se guardan igual, con el nombre
-- limpio: rechazarlos dejaría sin entregar para siempre lo que mandó una app anterior a v0.215 (el error del nombre es
-- definitivo y esa app no sabe corregirlo). Si el nombre era solo el rótulo, queda `-`. Todo lo que hoy se acepta se
-- sigue aceptando, y un nombre sin el rótulo se guarda exactamente como antes.
--
-- Lo que no cambia: los controles y las marcas de dirección se siguen rechazando (`author_invalid`), y el largo (1 a
-- 60) se mide después de limpiar. `import_comment` no se toca: el nombre de un comentario importado puede traer el
-- rótulo a propósito (la app lo escribe al importar un archivo exportado que tenía comentarios hechos por un link).
-- Tampoco se reescribe lo ya guardado.
--
-- Permisos: ninguno nuevo. Las dos funciones conservan la firma, el resultado, los errores y los permisos (`anon`, con
-- el token del link). No sube `schema_version`.

-- El nombre que se guarda de un visitante: sin el rótulo. Sin el rótulo adentro, lo de siempre (`btrim`).
create or replace function private.plink_author_name(p_name text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  -- Lo que cuenta como un espacio adentro del rótulo: el espacio y los espacios de ancho fijo. No los controles (el
  -- tabulador, el salto de línea), que el nombre no admite en ningún lado.
  sp    constant text := '[ \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]';
  label constant text := '[(（]' || sp || '*[vV][iIíÍ][aA]' || sp || '+[lL][iI][nN][kK]' || sp || '*[)）]';
  clean text := p_name;
  prev  text;
begin
  if p_name is null or p_name !~ label then
    return btrim(p_name);
  end if;
  loop
    prev := clean;
    clean := regexp_replace(clean, label, ' ', 'g');
    exit when clean = prev;
  end loop;
  clean := btrim(regexp_replace(clean, sp || '+', ' ', 'g'));
  return case when clean = '' then '-' else clean end;
end;
$$;

revoke all on function private.plink_author_name(text) from public, anon, authenticated;

-- `plink_add_comment` como en 20261012120000_link_publico.sql, con el nombre limpio.
create or replace function public.plink_add_comment(
  p_id uuid, p_page_id uuid, p_block_id text, p_thread_id uuid, p_body text, p_author text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  l    public.public_links := private.current_plink();
  dev  bytea := private.plink_device_hash();
  name text := private.plink_author_name(p_author);
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

-- `plink_push_page_update` como en 20261028120000_link_editar.sql, con el nombre limpio. (Los caracteres que el
-- nombre no admite van escritos por su código, como en `plink_add_comment`: son los mismos.)
create or replace function public.plink_push_page_update(
  p_page_id uuid, p_client_update_id uuid, p_update text, p_app_version text, p_author text)
returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare
  l    public.public_links := private.current_plink();
  name text := private.plink_author_name(p_author);
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
     or name ~ '[[:cntrl:]\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2069\ufeff]' then
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

notify pgrst, 'reload schema';
