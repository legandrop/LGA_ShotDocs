-- LGA Shot Docs · fase 1: correcciones de la auditoría de cierre.

-- Dos movimientos simultáneos (por ejemplo, dos dispositivos que recuperan la red a la vez) podían pasar
-- los dos el chequeo de ciclos, porque cada uno recorría los ancestros sin ver el cambio del otro. Ahora
-- los cambios de padre de un mismo espacio se hacen de a uno: el segundo espera al primero y, como la
-- función es volátil, su recorrido ve lo que el primero ya confirmó.
create or replace function private.pages_check_tree()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  cur   uuid := new.parent_id;
  depth int  := 0;
begin
  if tg_op = 'UPDATE' then
    new.workspace_id := old.workspace_id;
    new.created_by   := old.created_by;
    new.created_at   := old.created_at;
    if (new.title, new.icon, new.parent_id, new.sort_key, new.deleted_at, new.template_id)
       is distinct from
       (old.title, old.icon, old.parent_id, old.sort_key, old.deleted_at, old.template_id) then
      new.updated_at := now();
    end if;
  end if;

  if new.parent_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.parent_id is not distinct from old.parent_id then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('pages_tree:' || new.workspace_id::text, 0));

  if not exists (
    select 1 from public.pages where id = new.parent_id and workspace_id = new.workspace_id
  ) then
    raise exception 'page_parent_invalid' using errcode = '23503';
  end if;

  while cur is not null loop
    if cur = new.id then
      raise exception 'page_cycle' using errcode = '23514';
    end if;
    depth := depth + 1;
    if depth > 10000 then
      raise exception 'page_cycle' using errcode = '23514';
    end if;
    select parent_id into cur from public.pages where id = cur;
  end loop;
  return new;
end;
$$;

-- Una función de trigger no necesita EXECUTE para nadie.
revoke all on function private.pages_check_tree() from public, anon, authenticated;

-- Topes de largo que faltaban.
alter table public.pages add constraint pages_sort_key_length check (length(sort_key) <= 128);
alter table public.workspaces add constraint workspaces_name_length check (length(name) <= 200);

-- Solo imágenes raster: un SVG se muestra desde el mismo origen que la app y puede traer scripts.
update storage.buckets
set allowed_mime_types = array[
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/heic', 'image/heif'
]
where id = 'page-files';

-- Las tablas que se creen en `public` no le dan TRUNCATE a nadie por defecto. Cada migración nueva
-- igual hace su `revoke all` y da solo los permisos que hacen falta.
alter default privileges for role postgres in schema public revoke truncate on tables from anon, authenticated;
